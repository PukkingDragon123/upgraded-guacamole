// Layered fish rig: cached raster layers (tail / back fins / body / front fins) that animate on
// independent phases, composited with plain integer offsets, plus a dynamic expressive face (eyes that
// look, blink and emote; a mouth that talks) drawn on top every frame from small cached sprites.
//
// drawFishRig(ctx, compiled, st) -> anchors in world coords. See docs/ARCHITECTURE.md "Fish rig".
// Extra st fields understood here: pose (iconfish mimic pose), chain ([{x,y}] head-first for chain kinds).
// The game may call beginRigFrame() once per frame; otherwise the raster budget window resets itself.

import { rigLayers, rigGeom, rasterLayer, paintEye, paintMouth, eyeBox, mouthBox, isKind, chainSegment, chainHeadSprite, chainRadius, defaultChainPoints, realCues } from './fishart.js';
import { PixelBuffer } from './pixel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

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

export function setRigBudget(ms) { budgetMs = ms; }
export function beginRigFrame() { spent = 0; windowStart = now(); }
export function rigStats() { return { items: cache.size, spent, rasterized: statRaster, fallbacks: statFallback }; }
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
  const gxq = Math.round((fs.gx || 0) * n), gyq = Math.round((fs.gy || 0) * n);
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

export function drawFishRig(ctx, c, st) {
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

  const facing = st.facing ?? 1;
  const sx = facing * (st.turn ?? 1);
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
    for (const [cv, dx, dy] of items) { x0 = Math.min(x0, dx); y0 = Math.min(y0, dy); x1 = Math.max(x1, dx + cv.width); y1 = Math.max(y1, dy + cv.height); }
    if (!isFinite(x0)) return;
    const w = x1 - x0, h = y1 - y0;
    const sc = scratchFor(w, h);
    const g = sc._g;
    for (const [cv, dx, dy] of items) g.drawImage(cv, dx - x0, dy - y0);
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
    for (const [cv, dx, dy] of items) ctx.drawImage(cv, dx, dy);
    ctx.restore();
  }
  const gs = sil ? 0 : st.glow ?? (c.glow ? 1 : 0);
  if (gs > 0.01 && glows.length) {
    ctx.save();
    ctx.translate(X, Y);
    if (scx !== 1 || scy !== 1) ctx.scale(scx, scy);
    const prevOp = ctx.globalCompositeOperation, prevA = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    for (const [cv, dx, dy] of glows) {
      ctx.globalAlpha = Math.min(1, gs) * 0.12;
      ctx.drawImage(cv, dx - 1, dy); ctx.drawImage(cv, dx + 1, dy); ctx.drawImage(cv, dx, dy - 1); ctx.drawImage(cv, dx, dy + 1);
      ctx.globalAlpha = Math.min(1, gs) * 0.45;
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
