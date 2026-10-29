// Layered fish rig: cached raster layers (tail / back fins / body / front fins) that animate on
// independent phases, composited with plain integer offsets, plus a dynamic expressive face (eyes that
// look, blink and emote; a mouth that talks) drawn on top every frame from small cached sprites.
//
// drawFishRig(ctx, compiled, st) -> anchors in world coords. See docs/ARCHITECTURE.md "Fish rig".
// Two styles share this entry point: 'voxel' (default; 3D voxel sculptures from voxelfish.js that turn
// through yaw, with the same dynamic face sprites as overlays) and 'pixel' (the layered 2D rig).
// setFishStyle(style) switches globally; st.style overrides per call.
// Extra st fields: pose (iconfish mimic pose), chain ([{x,y}] head-first for chain kinds), heading (deg,
// + = swimming away from the viewer: the voxel fish turns its head into the scene), lod (0 near, 1 far:
// fewer swim frames), pri (voxel build priority bonus), style.
// turn is the world-space scaleX (-1..1) during a turn-around; turn: 1 with facing: -1 means "facing left".
// The game may call beginRigFrame() once per frame; otherwise the raster budget window resets itself.

import { rigLayers, rigGeom, rasterLayer, paintEye, paintMouth, eyeBox, mouthBox, isKind, chainSegment, chainHeadSprite, chainRadius, defaultChainPoints, realCues } from './fishart.js';
import { PixelBuffer } from './pixel.js';
import { makeCanvas, ctxOf, tinted } from '../core/canvas.js';
import { voxelFrame, chainBall, setVoxelFishBudget, SWIM_N } from './voxelfish.js';

let fishStyle = 'voxel';
export function setFishStyle(style) { fishStyle = style === 'pixel' ? 'pixel' : 'voxel'; }
export function getFishStyle() { return fishStyle; }
if (typeof window !== 'undefined') { window.__fishStyle = setFishStyle; window.__rigStats = () => rigStats(); } // debug / perf

const ANGLE_STEP = Math.PI / 12;
const MAX_ITEMS = 7000;
const cache = new Map();      // key -> layer / sprite result (LRU by re-insertion)
const families = new Map();   // family key -> Set(frame index)
let nextId = 1;
let budgetMs = 6, spent = 0, windowStart = 0;
let statRaster = 0, statFallback = 0;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const fract = (v) => v - Math.floor(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

export function setRigBudget(ms) { budgetMs = ms; setVoxelFishBudget(Math.max(1.5, ms * 0.75)); }
export function beginRigFrame() { spent = 0; windowStart = now(); }
let drawMs = 0, drawCalls = 0;
export function rigStats() { return { items: cache.size, spent, rasterized: statRaster, fallbacks: statFallback, drawMs, drawCalls }; }
export function clearRigCache() { cache.clear(); families.clear(); }

function idOf(c) {
  if (c.id == null && c._rid == null) c._rid = 'r' + nextId++;
  return c.id ?? c._rid;
}

function overBudget() {
  const t = now();
  if (t - windowStart > 14) { windowStart = t; spent = 0; }
  return spent >= budgetMs;
}

function timed(fn) {
  const t0 = now();
  const r = fn();
  spent += now() - t0;
  statRaster++;
  return r;
}

function cacheGet(key) {
  const r = cache.get(key);
  if (r !== undefined) { cache.delete(key); cache.set(key, r); }
  return r;
}

function cachePut(key, val, fam, frame) {
  cache.set(key, val);
  if (fam != null) {
    let s = families.get(fam);
    if (!s) families.set(fam, (s = new Set()));
    s.add(frame);
  }
  if (cache.size > MAX_ITEMS) {
    const it = cache.keys();
    for (let i = 0; i < 400; i++) {
      const k = it.next().value;
      cache.delete(k);
      const bar = k.lastIndexOf('#');
      if (bar > 0) families.get(k.slice(0, bar))?.delete(Number(k.slice(bar + 1)));
    }
  }
}

// Layer frame with budget fallback to the nearest cached frame of the same family.
function getLayer(c, layer, frames, frame, q, famKey) {
  const key = famKey + '#' + frame;
  let r = cacheGet(key);
  if (r) return r;
  const fam = families.get(famKey);
  if (fam && fam.size && overBudget()) {
    let best = -1, bd = 99;
    for (const f of fam) {
      const d = Math.min(Math.abs(f - frame), frames - Math.abs(f - frame));
      if (d < bd) { bd = d; best = f; }
    }
    r = cache.get(famKey + '#' + best);
    if (r) { statFallback++; return r; }
  }
  r = timed(() => rasterLayer(c, layer, { ...q, ph: frame / frames }));
  cachePut(key, r, famKey, frame);
  return r;
}

let scratch = null;
function scratchFor(w, h) {
  if (!scratch || scratch.width < w || scratch.height < h) {
    scratch = makeCanvas(Math.max(w, scratch?.width || 0, 64), Math.max(h, scratch?.height || 0, 64));
    scratch._g = ctxOf(scratch);
  }
  const g = scratch._g;
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  return scratch;
}

// ---- face sprites

const ANIM_EMO = { dizzy: 1, sad: 1, scared: 1, tired: 1, angry: 1 };

function eyeSprite(c, ev, fs, ang) {
  const R = ev.r;
  const n = Math.max(2, Math.round(R * 0.7));
  const lxq = Math.round(clamp(fs.lx, -1, 1) * n), lyq = Math.round(clamp(fs.ly, -1, 1) * n);
  const googly = ev.e.type === 'googly';
  const gxq = googly ? Math.round((fs.gx || 0) * n) : 0, gyq = googly ? Math.round((fs.gy || 0) * n) : 0;
  const bq = Math.round(clamp(fs.blink, 0, 1) * 4);
  const tq = ANIM_EMO[fs.emotion] || ev.e.type === 'googly' ? Math.floor(fs.time * 8) % 24 : 0;
  const pq = Math.round((fs.pupil || 1) * 10), dq = Math.round((fs.dim || 0) * 10);
  const key = `${idOf(c)}|e|${ev.idx}|${Math.round(ang * 100)}|${Math.round(R * 4)}|${fs.emotion}|${bq}|${lxq},${lyq}|${gxq},${gyq}|${tq}|${ev.mirror ? 1 : 0}${ev.cheek ? 1 : 0}${ev.main ? 1 : 0}|${pq}|${dq}`;
  let r = cacheGet(key);
  if (r) return r;
  r = timed(() => {
    const hb = eyeBox(R);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    const glow = ev.e.type === 'glow' ? new PixelBuffer(hb * 2, hb * 2) : null;
    paintEye(buf, glow, hb, hb, c, ev.e, {
      emotion: fs.emotion, blink: bq / 4, lx: lxq / n, ly: lyq / n, gx: gxq / n, gy: gyq / n, time: tq / 8,
      mirror: ev.mirror, cheek: ev.cheek, main: ev.main, pupil: pq / 10, dim: dq / 10,
    }, ang, R);
    return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, o: hb };
  });
  cachePut(key, r);
  return r;
}

function mouthSprite(c, mo, fs) {
  const W = mo.w;
  const oq = Math.round(clamp(fs.open, 0, 1) * 6);
  const key = `${idOf(c)}|m|${Math.round((mo.angle || 0) * 100)}|${Math.round(W * 4)}|${fs.emotion}|${oq}|${mo.front ? 1 : 0}|${mo.m.type}|${mo.m.lineP}`;
  let r = cacheGet(key);
  if (r) return r;
  r = timed(() => {
    const hb = mouthBox(W);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    paintMouth(buf, hb, hb, c, mo.m, { emotion: fs.emotion, open: oq / 6, time: 0 }, mo.angle || 0, W, mo.front);
    return { canvas: buf.toCanvas(), o: hb };
  });
  cachePut(key, r);
  return r;
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

const GILL = [P_('#3a0610'), P_('#8a1a2c'), P_('#c03a4a')];
function P_(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
}

function gillSprite(c, geo, gkey, w) {
  const key = gkey + '|gill|' + w;
  let r = cacheGet(key);
  if (r !== undefined) return r;
  const { pts, nx, ny } = geo.gill;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 = Math.floor(x0 - 4); y0 = Math.floor(y0 - 4); x1 = Math.ceil(x1 + 4); y1 = Math.ceil(y1 + 4);
  const buf = new PixelBuffer(x1 - x0, y1 - y0);
  pts.forEach(([x, y], i) => {
    const edge = i < 2 || i > pts.length - 3;
    for (let k = 0; k < (edge ? Math.min(1, w) : w); k++) buf.set(Math.round(x + nx * k) - x0, Math.round(y + ny * k) - y0, GILL[Math.min(2, k + (k === w - 1 && w > 1 ? 1 : 0))]);
  });
  r = { canvas: buf.toCanvas(), x: x0, y: y0 };
  cachePut(key, r);
  return r;
}

// ---- main entry

// World-space scaleX of the creature: -1 facing left .. 1 facing right (through 0 mid-turn).
function worldTurn(st) {
  const facing = st.facing ?? 1;
  const turn = st.turn;
  if (turn == null) return facing;
  if (turn === 1 && facing === -1) return -1;
  return clamp(turn, -1, 1);
}

export function drawFishRig(ctx, c, st) {
  const t0 = now();
  const a = drawFishRigInner(ctx, c, st);
  drawMs += now() - t0;
  drawCalls++;
  return a;
}

function drawFishRigInner(ctx, c, st) {
  if ((st.style || fishStyle) === 'voxel') {
    const a = c.kind === 'chain' ? drawVoxelChain(ctx, c, st) : drawVoxelRig(ctx, c, st);
    if (a) return a;
  }
  if (c.kind === 'chain') return drawChainRig(ctx, c, st);
  const kind = isKind(c);
  const s = Math.max(1, Math.round((st.scale ?? 1) * 8)) / 8;
  const angle = kind ? 0 : st.angle || 0;
  let a = clamp(Math.round(angle / ANGLE_STEP), -6, 6);
  const inf = kind ? 0 : Math.round(clamp(st.inflate || 0, 0, 1) * 4) / 4;
  const pose = !!(st.pose || st.emotion === 'pose');
  const t = st.time || 0;
  const sw = st.swimPhase ?? t * 1.2;
  const tp = st.tailPhase ?? sw;
  const fp = st.finPhase ?? sw;
  const id = idOf(c);
  const layers = rigLayers(c);
  const fam = (L, aa) => `${id}|${L}|${aa}|${s}|${inf}|${pose ? 1 : 0}`;
  // over budget and this angle bucket not ready: snap to the nearest bucket whose body exists
  if (!kind && !families.get(fam('body', a))?.size && overBudget()) {
    for (let d = 1; d <= 12; d++) {
      const cand = [a - d, a + d].find((v) => v >= -6 && v <= 6 && families.get(fam('body', v))?.size);
      if (cand !== undefined) { a = cand; statFallback++; break; }
    }
  }
  const ang = a * ANGLE_STEP;
  const fsw = Math.floor(fract(sw) * 8);
  const gkey = `${id}|g|${a}|${s}|${inf}|${fsw}|${pose ? 1 : 0}`;
  let geo = cacheGet(gkey);
  if (!geo) { geo = rigGeom(c, { sw: fsw / 8, angle: ang, scale: s, inflate: inf, pose }); geo.toon = !!c.toon; geo.rest = c.mouth?.rest || 0; cachePut(gkey, geo); }

  const sx = worldTurn(st);
  const sq = clamp(st.squash || 0, -1, 1);
  const kx = 1 + 0.22 * sq, ky = 1 - 0.2 * sq;
  const fs = faceState(st, ang, sx, st.x, st.y, geo);
  const cue = fs.cue;
  const twitch = cue.twitch && !st.silhouette ? ((Math.floor(t * 23) % 3) - 1) * (Math.floor(t * 7) & 1) : 0;
  const X = Math.round(st.x) + twitch, Y = Math.round(st.y + (st.bob || 0));
  const raise = kind ? 0 : (st.raise ?? cue.raise ?? 0) > 0.5 ? 1 : 0;

  // collect draw items in bucket coords (relative to geo origin)
  const items = [];
  const glows = [];
  const q = { angle: ang, scale: s, inflate: inf, pose };
  for (const L of layers) {
    const ph = L.phase === 'tail' ? tp : L.phase === 'fin' ? fp : sw;
    const frame = Math.floor(fract(ph) * L.frames) % L.frames;
    const lr = L.id === 'back' && raise;
    const r = getLayer(c, L.id, L.frames, frame, lr ? { ...q, raise: 1 } : q, fam(L.id, a) + (lr ? '|R' : ''));
    if (!r.canvas) continue;
    const off = geo.offsets?.[L.id] || [0, 0];
    items.push([r.canvas, r.x + off[0] - geo.ox, r.y + off[1] - geo.oy]);
    if (r.glowCanvas) glows.push([r.glowCanvas, r.x + off[0] - geo.ox, r.y + off[1] - geo.oy]);
  }
  if (!st.silhouette && geo.gill) {
    // breathing: the gill slit flares open, faster and wider when stressed
    const rate = 0.7 * (cue.breath || 1);
    const fl = 0.5 + 0.5 * Math.sin(t * TAU * rate);
    const w = fl > 0.86 ? 2 : fl > 0.5 ? 1 : 0;
    if (w) {
      const gs = gillSprite(c, geo, gkey, w + ((cue.breath || 1) >= 2 && w ? 1 : 0));
      if (gs) items.push([gs.canvas, gs.x - geo.ox, gs.y - geo.oy]);
    }
  }
  if (!st.silhouette) {
    for (const ev of geo.eyes) {
      const sp = eyeSprite(c, ev, fs, ev.angle ?? ang);
      const dx = Math.round(ev.x - sp.o) - geo.ox, dy = Math.round(ev.y - sp.o) - geo.oy;
      items.push([sp.canvas, dx, dy]);
      if (sp.glowCanvas) glows.push([sp.glowCanvas, dx, dy]);
    }
    if (geo.mouth && geo.mouth.m && geo.mouth.m.type !== 'none') {
      const sp = mouthSprite(c, geo.mouth, fs);
      items.push([sp.canvas, Math.round(geo.mouth.x - sp.o) - geo.ox, Math.round(geo.mouth.y - sp.o) - geo.oy]);
    }
  }
  const flush = !c.toon && cue.flush && !st.silhouette ? cue.flush : null;
  compose(ctx, items, glows, X, Y, sx * kx, ky, flush ? { ...st, flush } : st, c, geo.w + 40, geo.h + 40);

  // anchors -> world
  const toW = (p) => [X + (p[0] - geo.ox) * sx * kx, Y + (p[1] - geo.oy) * ky];
  const out = {};
  for (const [k, v] of Object.entries(geo.anchors)) if (Array.isArray(v)) out[k] = toW(v);
  out.eyes = geo.eyes.map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r * Math.abs(sx * kx), type: e.e.type }; });
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
      g.globalAlpha = sil ? 1 : Math.min(1, wash.alpha);
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

// ---- chain creatures: segments along st.chain (head first), rotated head sprite, dynamic face.

function drawChainRig(ctx, c, st) {
  const s = Math.max(1, Math.round((st.scale ?? 1) * 8)) / 8;
  const t = st.time || 0;
  const sw = st.swimPhase ?? t * 1.2;
  const facing = st.facing ?? 1;
  const pts = st.chain && st.chain.length >= 2 ? st.chain : defaultChainPoints(c, s, sw, st.x, st.y, facing);
  const id = idOf(c);
  const items = [];
  const n = pts.length;
  const X = Math.round(pts[0].x), Y = Math.round(pts[0].y);
  // tail -> head, interpolated so the body stays continuous
  for (let i = n - 1; i >= 1; i--) {
    const a = pts[i], b = pts[i - 1];
    const ra = chainRadius(c, i, n, s), rb = chainRadius(c, i - 1, n, s);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / Math.max(1, Math.min(ra, rb) * 0.6)));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const r = ra + (rb - ra) * u;
      const seg = chainSegment(c, r);
      items.push([seg.canvas, Math.round(a.x + (b.x - a.x) * u - seg.o) - X, Math.round(a.y + (b.y - a.y) * u - seg.o) - Y]);
    }
  }
  const dir = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
  const ab = Math.round(dir / ANGLE_STEP);
  const ang = ab * ANGLE_STEP;
  const hkey = `${id}|ch|${ab}|${s}`;
  let head = cacheGet(hkey);
  if (!head) { head = timed(() => chainHeadSprite(c, ang, s, 0)); cachePut(hkey, head); }
  items.push([head.canvas, -head.o, -head.o]);
  const fs = faceState({ ...st, x: X, y: Y }, 0, 1, X, Y, { toon: !!c.toon });
  if (st.lookX == null) { fs.lx = Math.cos(ang) * 0.5; fs.ly = Math.sin(ang) * 0.5; }
  else {
    // face-local look: rotate world look by -ang
    const dx = st.lookX - X, dy = st.lookY - Y, m = Math.hypot(dx, dy) || 1;
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const k = Math.min(1, m / 24) / m;
    fs.lx = (dx * ca - dy * sa) * k; fs.ly = (dx * sa + dy * ca) * k;
  }
  if (!st.silhouette) {
    for (const ev of head.face.eyes) {
      const sp = eyeSprite(c, ev, fs, ang);
      items.push([sp.canvas, Math.round(ev.x - head.o - sp.o), Math.round(ev.y - head.o - sp.o)]);
    }
    const mo = head.face.mouth;
    if (mo) {
      const sp = mouthSprite(c, mo, fs);
      items.push([sp.canvas, Math.round(mo.x - head.o - sp.o), Math.round(mo.y - head.o - sp.o)]);
    }
  }
  compose(ctx, items, [], X, Y, 1, 1, st, c, 0, 0);
  const last = pts[n - 1];
  const nose = [X + head.face.nose[0] - head.o, Y + head.face.nose[1] - head.o];
  return {
    mouth: nose,
    top: [X, Y - c.chain.r * s * 2],
    bottom: [X, Y + c.chain.r * s * 2],
    tail: [last.x, last.y],
    eyes: head.face.eyes.map((e) => ({ x: X + e.x - head.o, y: Y + e.y - head.o, r: e.r, type: e.e.type })),
  };
}

// ---- voxel style: cached voxel frame + dynamic face overlays, through the same compositor

const DEG = Math.PI / 180;


function drawVoxelRig(ctx, c, st) {
  const kind = isKind(c);
  const tau = worldTurn(st);
  // world yaw 0..180 through the front; side-on poses sit in a slight 3/4 view so the volume reads
  const Yw = Math.acos(clamp(tau, -1, 1)) / DEG;
  const mirror = Yw > 90;
  let yaw = mirror ? 180 - Yw : Yw;
  const base = st.yawBase ?? BASE_YAW;
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
  const items = [[f.canvas, -f.ax, -f.ay]];
  const glows = f.glow ? [[f.glow, -f.ax, -f.ay, undefined, undefined, true]] : [];
  // face overlays on the flank facing the camera (foreshortened with the yaw)
  const cy = Math.cos(f.yaw * YAW_DEG);
  if (!st.silhouette && lod < 2 && cy > 0.42) {
    for (const ev of f.eyes) {
      if (ev.r < 0.9) continue;
      const sp = eyeSprite(c, ev, fs, fang);
      const w = sp.canvas.width * cy;
      const dx = ev.x - sp.o * cy, dy = Math.round(ev.y - sp.o);
      items.push([sp.canvas, dx, dy, w, sp.canvas.height]);
      if (sp.glowCanvas) glows.push([sp.glowCanvas, dx, dy, w, sp.canvas.height]);
    }
    if (f.mouth && f.mouth.m && f.mouth.m.type !== 'none' && cy > 0.6 && f.mouth.w >= 1.5) {
      const sp = mouthSprite(c, { w: f.mouth.w, m: f.mouth.m, front: f.mouth.front, angle: fang }, fs);
      items.push([sp.canvas, f.mouth.x - sp.o * cy, Math.round(f.mouth.y - sp.o), sp.canvas.width * cy, sp.canvas.height]);
    }
  }
  const scx = (mirror ? -1 : 1) * kx;
  const flush = !c.toon && cue.flush && !st.silhouette ? cue.flush : null;
  const st2 = flush ? { ...st, flush } : st;
  const translucent = (c.alpha ?? 255) < 255 && !st.silhouette;
  const prevA = ctx.globalAlpha;
  if (translucent) ctx.globalAlpha = prevA * Math.max(0.35, c.alpha / 255);
  composeVoxel(ctx, f, items, glows, X, Y, scx, ky, st2, c);
  ctx.globalAlpha = prevA;
  const toW = (p) => [X + p[0] * scx, Y + p[1] * ky];
  const out = {};
  for (const [key, v] of Object.entries(f.anchors)) out[key] = toW(v);
  out.eyes = f.eyes.map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r * Math.abs(kx), type: e.e.type }; });
  out.w = f.W * Math.abs(kx); out.h = f.H * ky;
  if (c.variant?.shiny) out.shiny = true;
  return out;
}
const YAW_DEG = DEG;

// Voxel compositor: frame + overlays drawn straight through the transform; fog / darkness / colour flush
// are a cached tinted silhouette of the frame drawn over it (no per-fish scratch compositing).
function composeVoxel(ctx, f, items, glows, X, Y, scx, scy, st, c) {
  const wash = st.wash && st.wash.alpha > 0.01 ? st.wash : null;
  const sil = st.silhouette;
  const prevA = ctx.globalAlpha;
  ctx.save();
  ctx.translate(X, Y);
  if (scx !== 1 || scy !== 1) ctx.scale(scx, scy);
  if (sil) {
    ctx.drawImage(tinted(f.canvas, typeof sil === 'string' ? sil : '#102033'), items[0][1], items[0][2]);
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
const BASE_YAW = 15;

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
  if (!st.silhouette) {
    for (const ev of f.eyes) {
      const sp = eyeSprite(c, { ...ev, r: ev.r * k }, fs, f.pitch * DEG);
      items.push([sp.canvas, Math.round(ev.x * k - sp.o), Math.round(ev.y * k - sp.o)]);
    }
    if (f.mouth && f.mouth.m && f.mouth.m.type !== 'none') {
      const sp = mouthSprite(c, { w: f.mouth.w * k, m: f.mouth.m, front: f.mouth.front, angle: f.pitch * DEG }, fs);
      items.push([sp.canvas, Math.round(f.mouth.x * k - sp.o), Math.round(f.mouth.y * k - sp.o)]);
    }
  }
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
