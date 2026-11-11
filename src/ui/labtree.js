// THE LAB's research tree (phase 7/8, OWNER: Lab agent): one tree that grows out of the middle.
// The root hub sits in the centre and the 8 branches grow outward as spokes (layout data lives in src/game/lab.js:
// nd.pos / nd.depth / nd.lane). Nodes are chunky pixel-art glass tiles with animated icons; the camera is zoomed in
// and glides (drag, wheel, +/- and branch focus buttons, click a node to glide to it).
// FOG OF WAR: only researched nodes and the ones you can research next are revealed. The next ones are BLACK
// silhouettes with a "?" (no name, icon or cost) and deeper ones fade into the blocky pixel darkness. Researching
// unveils the next tiles: the ink clears from the middle out, pixel ink drops fly off, sparkles and bubbles pop.
// Phase 8: pixel/voxel-art look, bigger text, no ring/circle effects (only pixel particles).
//   new LabTree(panel)
//   tree.update(ui, view, dt)  tree.draw(ctx, ui, view, dt)  tree.drawCard(ctx, ui)  (card on top of header/footer)
//   tree.focus(id, {highlight, zoom})  tree.select(id)  tree.focusBranch(branch)  tree.home(instant)  tree.zoomBy(f)
//   tree.tileRect(id) -> screen rect | null      tree.btnRect: the card's Research button (panel.confirmRect)
//   tree.plan -> [selected id] while its Research button shows (the tutorial then points at panel.confirmRect)
import { clamp, clamp01, TAU, hash1, ease, lerp, bayer } from '../core/math.js';
import { rgba, mix, shade, pack, hexToRgb } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { alagardReady, alagardBitmap } from '../gfx/alagard.js';
import { aeroSurface, aeroCached, toneFrom, drawAeroBubble, drawSparkle, drawAeroBar, fmtAero, drawAeroGlow } from './aero.js';
import {
  LAB_NODES, LAB_BY_ID, BRANCHES, BRANCH_ORDER, ROOT_ID, EFFECT_INFO, BOAT_ORDER, LAB_R1, LAB_NODE, LAB_ROOT, LAB_EXTENT,
  ensureLab, labCheck, labTime, labProgress, labRemaining, labQueued, labSlots, instantCost, instantFinish, cancelResearch,
  confirmResearch, fmtEffect, fmtTime, nodeFor, TANK_ORDER, labGoal, labGoalNeed,
} from '../game/lab.js';
import { roundRectPath } from './labart.js';
import { icon, anyIcon, pill, costTiles, costTilesHeight, chip, INK, INK_SOFT, OK, BAD } from './labkit.js';
import { drawAnimIcon, unlockInfo } from './labrows.js';
import { HI, hiFromBuffer, dualArt, withHi, hiCtx } from '../gfx/hires.js'; // [phase9:ui]
import { drawPop3D } from './pop3d.js'; // [phase9:ui]
import { drawIcon3D } from '../gfx/icons3d.js'; // [phase9:ui]
import { nodeTile, qMark, microBubble, gemTex, pipeJoint, GEM_CUT } from './labtiles.js'; // [phase9:ui]
import { drawLabRoom } from './labroom.js'; // [lab13]
const GOAL_MARK = { title: 'Next goal', goal: true }; // [balance] questMarks() value for the next main-track upgrade

const NODES = LAB_NODES.filter((n) => n.id !== ROOT_ID).sort((a, b) => a.depth - b.depth);
const NODE_R = LAB_NODE / 2, ROOT_R = LAB_ROOT / 2;
const LABEL_R = Math.round((ROOT_R + LAB_R1 - NODE_R) / 2);
const TOTAL = NODES.length;
const CARD_W = 248, ZMIN = 0.34, ZMAX = 1.8, Z_HOME = 1.05;
const REVEALED = new Set(['done', 'researching', 'queued', 'available']);
const branchCol = (b) => BRANCHES[b]?.color || '#35c8ff';
const SIL_ALPHA = [1, 1, 0.5, 0.2, 0.07];

// ------------------------------------------------------------------ static connector geometry (tree units)
function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}
const EDGES = [];
for (const nd of NODES) {
  const p = LAB_BY_ID[nd.req[0]];
  if (!p) continue;
  const a0 = p.id === ROOT_ID ? nd.ang : p.ang, a3 = nd.ang;
  const P0 = p.pos, P3 = nd.pos, L = Math.hypot(P3[0] - P0[0], P3[1] - P0[1]);
  const P1 = [P0[0] + Math.cos(a0) * L * 0.45, P0[1] + Math.sin(a0) * L * 0.45], P2 = [P3[0] - Math.cos(a3) * L * 0.45, P3[1] - Math.sin(a3) * L * 0.45];
  const r0 = (p.id === ROOT_ID ? ROOT_R : NODE_R) + 1, r3 = NODE_R + 1;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const q = bez(P0, P1, P2, P3, i / 24);
    if (Math.hypot(q[0] - P0[0], q[1] - P0[1]) < r0 || Math.hypot(q[0] - P3[0], q[1] - P3[1]) < r3) continue;
    pts.push(q);
  }
  if (pts.length >= 2) EDGES.push({ from: p.id, to: nd.id, branch: nd.branch, pts });
}


// ------------------------------------------------------------------ [phase9:ui] full-res backdrop + pipe geometry
// An ornamental divider: a hairline that fades toward both ends with a tiny gem in the middle.
function divider(ctx, x, y, w, col) {
  const ga = ctx.globalAlpha;
  for (let i = 0; i < w; i += 2) {
    const k = 1 - Math.abs(i / w - 0.5) * 2;
    ctx.globalAlpha = ga * (0.15 + 0.75 * k);
    ctx.fillStyle = '#7fbedd'; ctx.fillRect(x + i, y, 2, 0.5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x + i, y + 0.5, 2, 0.5);
  }
  ctx.globalAlpha = ga;
  const g = gemTex(2, col || '#35c8ff', 'diamond');
  ctx.drawImage(g, Math.round((x + w / 2 - g.width / 2) * 2) / 2, Math.round((y + 0.25 - g.height / 2) * 2) / 2);
}

// Arc-length sampler over a screen polyline: at(d) -> [x, y, nx, ny] (n = unit normal toward the light, up-left)
function arc(pts) {
  // resampled once every half pixel along the polyline (stamping then just walks the array)
  const out = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l <= 0) continue;
    let nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    if (nx + ny > 0) { nx = -nx; ny = -ny; }
    let d = carry;
    for (; d < l; d += 0.5) { const k = d / l; out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, nx, ny]); }
    carry = d - l;
  }
  if (!out.length) out.push([pts[0][0], pts[0][1], 0, -1]);
  const len = (out.length - 1) / 2;
  return { len, pts: out, at(d) { return out[Math.max(0, Math.min(out.length - 1, Math.round(d * 2)))]; } };
}

// A web of caustic light lines (transparent), brightest at the top, for the upper part of the view.
function causticWeb(w, h) {
  const W = w * HI, H = h * HI;
  const b = new PixelBuffer(W, H);
  for (let y = 0; y < H; y++) {
    const fade = 1 - y / H;
    for (let x = 0; x < W; x++) {
      const X = x / HI, Y = y / HI;
      const n1 = Math.sin(X * 0.052 + Math.sin(Y * 0.041) * 2.4), n2 = Math.sin(Y * 0.067 + Math.sin(X * 0.033) * 2.1);
      const n3 = Math.sin((X + Y) * 0.029 + Math.sin(X * 0.071) * 1.3);
      const web = Math.max(0, 1 - Math.abs(n1 + n2) * 3.2) * 0.7 + Math.max(0, 1 - Math.abs(n3 + n1 * 0.6) * 4) * 0.5;
      const a = web * fade * fade;
      const q = Math.floor(a * 3 + bayer(x, y) * 0.999) / 3;
      if (q <= 0) continue;
      b.data[y * W + x] = ((Math.round(q * 0.42 * 255) << 24) | (255 << 16) | (252 << 8) | 225) >>> 0;
    }
  }
  return hiFromBuffer(b);
}

// ------------------------------------------------------------------ pixel-art tile textures
const texCache = new Map();
function cachedTex(key, build) {
  let c = texCache.get(key);
  if (!c) { c = build(); texCache.set(key, c); if (texCache.size > 900) texCache.delete(texCache.keys().next().value); }
  return c;
}
// look: 'open' (white glass, branch frame) | 'done' (filled with the branch colour) | 'brew' | 'sil' (black)
function tileTex(S, look, col) {
  return cachedTex(`tile|${S}|${look}|${col}`, () => {
    const b = new PixelBuffer(S, S);
    const rc = Math.max(3, Math.round(S * 0.24)), f = Math.max(2, Math.round(S * 0.1)), ri = Math.max(2, rc - f + 1);
    const inRR = (x, y, x0, y0, w, h, r) => {
      if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
      const cx = x < x0 + r ? x0 + r : x >= x0 + w - r ? x0 + w - r - 1 : null;
      const cy = y < y0 + r ? y0 + r : y >= y0 + h - r ? y0 + h - r - 1 : null;
      if (cx === null || cy === null) return true;
      const dx = x - cx, dy = y - cy;
      return dx * dx + dy * dy <= r * r + r * 0.5;
    };
    const sil = look === 'sil';
    const C = sil
      ? { out: '#000000', fl: '#22364c', fm: '#0d1522', fd: '#05080e', a: '#0c1320', m: '#070b13', d: '#020408' }
      : { out: shade(col, -0.68), fl: mix(col, '#ffffff', 0.6), fm: col, fd: shade(col, -0.36),
        ...(look === 'done' ? { a: mix(col, '#ffffff', 0.55), m: mix(col, '#ffffff', 0.18), d: shade(col, -0.12) }
          : look === 'brew' ? { a: '#f2ffff', m: '#c8f6ff', d: '#8cdcf4' }
            : { a: '#ffffff', m: mix(col, '#f2fbff', 0.86), d: mix(col, '#d2f0ff', 0.62) }) };
    const iw = S - f * 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!inRR(x, y, 0, 0, S, S, rc)) continue;
      const edge = !inRR(x - 1, y, 0, 0, S, S, rc) || !inRR(x + 1, y, 0, 0, S, S, rc) || !inRR(x, y - 1, 0, 0, S, S, rc) || !inRR(x, y + 1, 0, 0, S, S, rc);
      if (edge) { b.set(x, y, pack(C.out)); continue; }
      if (inRR(x, y, f, f, iw, iw, ri)) {
        const k = (y - f) / Math.max(1, iw - 1);
        let c = k < 0.42 ? C.a : k < 0.8 ? C.m : C.d;
        // checker dither on the band edges for a hand-made pixel look
        if (Math.abs(k - 0.42) < 0.04 && (x + y) % 2) c = C.m;
        if (Math.abs(k - 0.8) < 0.04 && (x + y) % 2) c = C.d;
        // inner shadow under the frame (top and left), light lip at the bottom
        if (!inRR(x, y - 1, f, f, iw, iw, ri) || !inRR(x - 1, y, f, f, iw, iw, ri)) c = sil ? '#000000' : shade(C.m, -0.22);
        else if (!inRR(x, y + 2, f, f, iw, iw, ri)) c = sil ? C.m : mix(C.a, '#ffffff', 0.5);
        b.set(x, y, pack(c));
        continue;
      }
      // the bevelled frame: lit top-left, dark bottom-right
      const lit = (x + y) / (S * 2 - 2);
      b.set(x, y, pack(lit < 0.36 ? C.fl : lit < 0.7 ? C.fm : C.fd));
    }
    // gloss cap + a 2x2 shine pixel
    if (!sil) {
      const gh = Math.round(iw * 0.3);
      for (let y = f + 2; y < f + 2 + gh; y++) for (let x = f + 3; x < S - f - 3; x++) {
        if (!inRR(x, y, f + 3, f + 2, iw - 6, gh, Math.max(1, ri - 2))) continue;
        const i = y * S + x, c0 = b.data[i];
        const r = c0 & 255, g = (c0 >> 8) & 255, bl = (c0 >> 16) & 255, k = 0.42 * (1 - (y - f - 2) / gh);
        b.data[i] = (255 << 24) | (Math.round(bl + (255 - bl) * k) << 16) | (Math.round(g + (255 - g) * k) << 8) | Math.round(r + (255 - r) * k);
      }
      const sx = f + 2, sy = f + 2;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) b.set(sx + dx, sy + dy, pack('#ffffff'));
    } else {
      // a faint cold rim on the top-left so the black shape still reads in the dark
      for (let x = rc; x < S - rc; x++) b.set(x, 1, pack('#3c5c7c'));
      for (let y = rc; y < S - rc; y++) b.set(1, y, pack('#2a4460'));
    }
    return b.toCanvas();
  });
}
// The blocky "?" for the next silhouettes.
function qTex(S) {
  return cachedTex('q|' + S, () => {
    if (alagardReady()) return alagardBitmap('?', { size: S >= 44 ? 32 : 16, color: '#5f8db8' });
    const c = makeCanvas(12, 14);
    drawText(ctxOf(c), '?', 1, 1, { font: 'big', color: '#5f8db8' });
    return c;
  });
}
const inkCache = new WeakMap();
function inkBox(c) {
  let r = inkCache.get(c);
  if (r) return r;
  const d = ctxOf(c).getImageData(0, 0, c.width, c.height).data;
  let top = c.height, bot = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { top = Math.min(top, y); bot = Math.max(bot, y); }
  r = { top, bot: Math.max(top, bot) };
  inkCache.set(c, r);
  return r;
}
// Alagard title with a dark outline (falls back to the big pixel font).
export function titleBmp(text, color = '#ffffff', outline = '#0a3a6e', size = 16) {
  return aeroCached(`labttl|${size}|${color}|${outline}|${text}`, () => {
    if (!alagardReady()) {
      const w = measureText(text, 'big') + 4, c = makeCanvas(w, 16);
      drawText(ctxOf(c), text, 2, 2, { font: 'big', color, outline });
      return c;
    }
    const w0 = alagardBitmap(text, { size, color }), o = alagardBitmap(text, { size, color: outline });
    const box = inkBox(w0);
    const h = box.bot - box.top + 1;
    const c = makeCanvas(w0.width + 2, h + 4), g = ctxOf(c);
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2], [1, 3], [0, 3], [2, 3]]) g.drawImage(o, dx, dy - box.top);
    g.drawImage(w0, 1, 1 - box.top);
    // [phase9:ui] the 2x twin: the same glyphs with a rounder 2 device-px outline, a deeper drop and a hairline gloss
    return withHi(c, () => {
      const W2 = alagardBitmap(text, { size: size * 2, color }), O2 = alagardBitmap(text, { size: size * 2, color: outline });
      const hc = makeCanvas(c.width * HI, c.height * HI), hg = ctxOf(hc), top = box.top * 2;
      for (let dy = -2; dy <= 4; dy++) for (let dx = -2; dx <= 2; dx++) { if (dx * dx + Math.min(dy, 2) ** 2 > 5 && dy <= 2) continue; hg.drawImage(O2, 2 + dx, 2 + dy - top); }
      hg.drawImage(W2, 2, 2 - top);
      hg.globalCompositeOperation = 'source-atop';
      hg.fillStyle = 'rgba(255,255,255,0.5)';
      const tmp = makeCanvas(hc.width, hc.height), tg = ctxOf(tmp);
      tg.drawImage(W2, 2, 2 - top); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#e8fbff'; tg.fillRect(0, 0, tmp.width, Math.round((h * 2) * 0.32) + 2);
      hg.globalCompositeOperation = 'source-over';
      hg.drawImage(tmp, 0, 0);
      return hc;
    });
  });
}

// ------------------------------------------------------------------ the view
export class LabTree {
  constructor(panel) {
    this.p = panel;
    this.t = 0;
    this.cam = { x: 0, y: 0, z: Z_HOME };
    this.tgt = { x: 0, y: 0, z: Z_HOME };
    this.sel = null;
    this.cardId = null;
    this.cardK = 0;
    this.hover = null;
    this.drag = null;
    this.anim = new Map();
    this.fx = [];
    this.S = {};
    this.hd = {};
    this.prev = null;
    this.hl = null;
    this.view = null;
    this.cardRect = null;
    this.btnRect = null;
    this.btnKind = null;
    this.ctrlRects = [];
    this.fresh = true;
    this.pending = { home: true };
    this.lastClick = { id: null, t: -9 };
    this.hintK = 1;
    this.used = false;
    this.fog = null;
  }

  get game() { return this.p.game; }
  get plan() { return this.sel && this.btnKind === 'research' && this.btnRect ? [this.sel] : []; }

  a(id) {
    let o = this.anim.get(id);
    if (!o) { o = { hov: 0, pop: 0, shake: 0, rv: 1, delay: 0, sa: 0, ph: hash1(id.length * 13 + id.charCodeAt(0), 3) * 6.28 + id.charCodeAt(id.length - 1) * 0.37 }; this.anim.set(id, o); }
    return o;
  }

  // ---------------------------------------------------------------- camera
  X(wx) { return this.view.x + this.view.w / 2 + (wx - this.cam.x) * this.cam.z; }
  Y(wy) { return this.view.y + this.view.h / 2 + (wy - this.cam.y) * this.cam.z; }

  glideTo(wx, wy, z, o = {}) {
    z = clamp(z ?? this.tgt.z, ZMIN, ZMAX);
    const off = o.card ? (CARD_W + 16) / 2 / z : 0;
    this.tgt.x = wx + off; this.tgt.y = wy; this.tgt.z = z;
    this.clampTgt();
    if (o.instant) Object.assign(this.cam, this.tgt);
  }

  clampTgt() {
    const E = LAB_EXTENT * 0.92;
    this.tgt.x = clamp(this.tgt.x, -E, E); this.tgt.y = clamp(this.tgt.y, -E, E); this.tgt.z = clamp(this.tgt.z, ZMIN, ZMAX);
  }

  zoomAt(sx, sy, f) {
    const v = this.view;
    if (!v) { this.tgt.z = clamp(this.tgt.z * f, ZMIN, ZMAX); return; }
    const z0 = this.tgt.z, z1 = clamp(z0 * f, ZMIN, ZMAX);
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const wx = this.tgt.x + (sx - cx) / z0, wy = this.tgt.y + (sy - cy) / z0;
    this.tgt.x = wx - (sx - cx) / z1; this.tgt.y = wy - (sy - cy) / z1; this.tgt.z = z1;
    this.clampTgt();
    this.used = true;
  }

  zoomBy(f) { const v = this.view; this.zoomAt(v ? v.x + v.w / 2 : 0, v ? v.y + v.h / 2 : 0, f); }

  // Frame the root and the current frontier (what can be researched next).
  home(instant = false) {
    const v = this.view;
    if (!v) { this.pending.home = true; return; }
    this.computeStatus();
    let pts = NODES.filter((n) => this.S[n.id] === 'available' || this.S[n.id] === 'researching' || this.S[n.id] === 'queued').map((n) => n.pos);
    if (!pts.length) pts = NODES.filter((n) => this.S[n.id] === 'done').map((n) => n.pos);
    pts.push([0, 0]);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const m = LAB_NODE + 30;
    const z = clamp(Math.min((v.w - 30) / (x1 - x0 + m * 2), (v.h - 30) / (y1 - y0 + m * 2)), 0.85, Z_HOME);
    this.sel = null;
    this.glideTo((x0 + x1) / 2, (y0 + y1) / 2, z, { instant });
  }

  select(id, o = {}) {
    const nd = id === ROOT_ID ? { pos: [0, 0] } : LAB_BY_ID[id];
    if (!nd) return;
    this.sel = id;
    const A = this.a(id);
    A.pop = 0.6;
    const z = Math.max(this.tgt.z, o.zoom ?? 0.95);
    this.glideTo(nd.pos[0], nd.pos[1], z, { card: true, instant: o.instant });
  }

  focus(id, o = {}) {
    if (!LAB_BY_ID[id]) return;
    this.select(id, { zoom: o.zoom ?? 1 });
    if (o.highlight !== false) this.hl = { id, t: 0 };
  }

  focusBranch(b) {
    this.computeStatus();
    const ids = NODES.filter((n) => n.branch === b);
    const front = ids.filter((n) => this.S[n.id] === 'available' || this.S[n.id] === 'researching' || this.S[n.id] === 'queued').sort((p, q) => p.depth - q.depth);
    const done = ids.filter((n) => this.S[n.id] === 'done').sort((p, q) => q.depth - p.depth);
    const nd = front[0] || done[0] || ids[0];
    if (nd) this.select(nd.id, { zoom: 1 });
    this.used = true;
  }

  tileRect(id) {
    const v = this.view;
    if (!v) return null;
    const nd = id === ROOT_ID ? { pos: [0, 0] } : LAB_BY_ID[id];
    if (!nd) return null;
    const s = (id === ROOT_ID ? LAB_ROOT : LAB_NODE) * this.cam.z;
    const x = this.X(nd.pos[0]), y = this.Y(nd.pos[1]);
    if (x < v.x - s / 2 || y < v.y - s / 2 || x > v.x + v.w + s / 2 || y > v.y + v.h + s / 2) return null;
    return { x: Math.round(x - s / 2), y: Math.round(y - s / 2), w: Math.round(s), h: Math.round(s) };
  }

  // ---------------------------------------------------------------- status + fog of war
  computeStatus() {
    const L = ensureLab(this.game.state);
    const slots = new Set(L.slots.map((s) => s.id)), queue = new Set(L.queue.map((q) => q.id));
    const S = this.S, hd = this.hd;
    S[ROOT_ID] = 'done'; hd[ROOT_ID] = 0;
    for (const nd of NODES) {
      const id = nd.id;
      const s = L.done[id] ? 'done' : queue.has(id) ? 'queued' : slots.has(id) ? 'researching' : nd.req.every((r) => L.done[r]) ? 'available' : 'locked';
      S[id] = s;
      hd[id] = s !== 'locked' ? 0 : 1 + Math.min(...nd.req.map((r) => hd[r] ?? 9));
    }
    return L;
  }

  revealed(id) { return REVEALED.has(this.S[id]); }

  // The revealed node a hidden one waits behind.
  gate(id) {
    let nd = LAB_BY_ID[id];
    for (let i = 0; i < 20 && nd && !this.revealed(nd.id); i++) nd = LAB_BY_ID[nd.req[0]];
    return nd && nd.id !== ROOT_ID ? nd : null;
  }

  unveil(id, delay, label = false) {
    const A = this.a(id);
    A.rv = 0; A.delay = delay; A.newLabel = label;
  }

  // ---------------------------------------------------------------- plan / research
  research(id) {
    const g = this.game, st = g.state, nd = LAB_BY_ID[id];
    if (!nd) return false;
    const c = labCheck(st, nd, g.stats);
    if (c.ok) return this.p.research(id);
    if (c.reqOk && c.gateOk && c.paid && c.slots <= 0) {
      const r = confirmResearch(g, [id]);
      if (r.queued.length) {
        g.audio.play('ui_unlock'); this.burst(id, 'start'); this.a(id).pop = 1;
        g.toast?.('Queued: it starts when a bench frees up.', 'clock');
        return true;
      }
    }
    this.reject(id, !c.reqOk ? 'Research the one before it first.' : !c.gateOk ? c.gate : !c.aero.ok ? 'Not enough Aero for that one!' : !c.paid ? 'Missing ingredients!' : 'All benches are busy.');
    return false;
  }

  reject(id, reason) {
    this.a(id).shake = 1;
    this.game.audio.play('ui_error');
    this.game.toast?.(reason, 'cross');
  }

  // ---------------------------------------------------------------- particles (tree units, pixel sprites only)
  burst(id, kind, o = {}) {
    const nd = id === ROOT_ID ? { pos: [0, 0], branch: null } : LAB_BY_ID[id];
    if (!nd) return;
    const [x, y] = nd.pos;
    const col = branchCol(nd.branch);
    const add = (o) => this.fx.push({ x, y, t: 0, ...o });
    if (kind === 'done') {
      add({ kind: 'label', dur: 1.7, text: 'UNLOCKED!' });
      for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU + hash1(i, 7) * 0.3, v = 50 + hash1(i, 9) * 70; add({ kind: 'spark', dur: 0.7 + hash1(i, 3) * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, g: 90, col: i % 3 ? '#ffffff' : i % 2 ? '#fff6a0' : mix(col, '#ffffff', 0.4), size: 1 + (i % 3 === 0) }); }
      for (let i = 0; i < 10; i++) add({ kind: 'confetti', dur: 1.2 + hash1(i, 4) * 0.6, vx: (hash1(i, 5) - 0.5) * 120, vy: -70 - hash1(i, 6) * 60, g: 160, col: [col, '#ffffff', '#fff6a0', '#7dff9a'][i % 4], rot: hash1(i, 2) * 6 });
      for (let i = 0; i < 6; i++) add({ kind: 'bubble', dur: 1.3 + hash1(i, 4), vx: (hash1(i, 5) - 0.5) * 30, vy: -34 - hash1(i, 6) * 30, g: -10, r: 1.5 + hash1(i, 8) * 2 });
    } else if (kind === 'start') {
      for (let i = 0; i < 8; i++) add({ kind: 'bubble', dur: 1 + hash1(i, 3) * 0.6, vx: (hash1(i, 5) - 0.5) * 40, vy: -40 - hash1(i, 4) * 30, g: -5, r: 1.5 + hash1(i, 8) * 1.5 });
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; add({ kind: 'spark', dur: 0.5, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, g: 0, col: '#d6ff8a', size: 1 }); }
    } else if (kind === 'reveal') {
      // ink drops fly off the black shell, then the sparkles
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU + hash1(i, 11), v = 40 + hash1(i, 12) * 60; add({ kind: 'ink', dur: 0.6 + hash1(i, 13) * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 70, size: 2 + (i % 3) }); }
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + 0.2, v = 30 + hash1(i, 9) * 40; add({ kind: 'spark', dur: 0.8, delay: 0.25 + hash1(i, 2) * 0.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, g: 30, col: i % 2 ? '#ffffff' : mix(col, '#ffffff', 0.5), size: 1 + (i % 4 === 0) }); }
      if (o.label) add({ kind: 'label', dur: 1.4, delay: 0.3, text: 'NEW!' });
    } else if (kind === 'nope') {
      for (let i = 0; i < 6; i++) add({ kind: 'ink', dur: 0.4, vx: (hash1(i, 5) - 0.5) * 50, vy: -20 - hash1(i, 6) * 30, g: 120, size: 2 });
    }
  }

  // ---------------------------------------------------------------- input + animation
  update(ui, view, dt) {
    const inp = ui.inp, g = this.game, st = g.state;
    this.t += dt;
    this.view = view;
    const L = this.computeStatus();
    const S = this.S;
    // the first frame after the Lab opens: unveil what was revealed while the Lab was closed
    if (this.fresh) {
      this.fresh = false;
      L.seen ||= {};
      let n = 0;
      for (const nd of NODES) {
        if (!this.revealed(nd.id)) continue;
        const A = this.a(nd.id);
        if (L.seen[nd.id]) { if (A.rv >= 1 || A.delay <= 0) { A.rv = Math.max(A.rv, 1); } continue; }
        L.seen[nd.id] = 1;
        this.unveil(nd.id, 0.35 + n++ * 0.11);
      }
    }
    if (this.pending.home) { this.pending.home = false; this.home(true); }
    if (this.pending.focus) { const f = this.pending.focus; this.pending.focus = null; this.focus(f.id, f); }
    // status changes while open: bursts and unveils
    if (this.prev) {
      for (const nd of NODES) {
        const a = this.prev[nd.id], b = S[nd.id];
        if (a === b || !a) continue;
        if (b === 'done') { this.burst(nd.id, 'done'); this.a(nd.id).pop = 1.2; g.audio.play('sparkle', { vol: 0.5 }); }
        else if (a === 'locked') { (L.seen ||= {})[nd.id] = 1; this.unveil(nd.id, 0.55, true); }
      }
    }
    this.prev = { ...S };
    // ---- input
    const over = (r) => r && inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h;
    const inside = over(view);
    const blocked = (this.cardK > 0.5 && over(this.cardRect)) || this.ctrlRects.some(over);
    this.hover = inside && !blocked && !this.drag?.moved ? this.pick(inp.x, inp.y) : null;
    if (this.hover && this.hover !== this.lastHover) g.audio.play('ui_hover', { vol: 0.45, pitch: 0.9 + (LAB_BY_ID[this.hover]?.depth || 0) * 0.04 });
    this.lastHover = this.hover;
    if (inside && !blocked && inp.wheel) { this.zoomAt(inp.x, inp.y, Math.pow(1.12, -inp.wheel)); inp.wheel = 0; }
    if (inside && !blocked && inp.pressed) {
      inp.pressed = false;
      this.drag = { x: inp.x, y: inp.y, cx: this.tgt.x, cy: this.tgt.y, moved: false, id: this.hover };
    }
    if (this.drag) {
      const d = this.drag;
      if (inp.down) {
        if (!d.moved && Math.hypot(inp.x - d.x, inp.y - d.y) > 4) { d.moved = true; this.used = true; }
        if (d.moved) {
          this.tgt.x = d.cx - (inp.x - d.x) / this.cam.z; this.tgt.y = d.cy - (inp.y - d.y) / this.cam.z;
          this.clampTgt();
          this.cam.x = this.tgt.x; this.cam.y = this.tgt.y;
        }
      } else {
        if (!d.moved) this.click(d.id);
        this.drag = null;
      }
    }
    // keyboard: arrows/WASD pan, +/- zoom, Home recentres, Enter researches the selected node
    const kp = (k) => inp.keyPressed?.(k), kd = (k) => inp.keys?.has?.(k);
    const pan = 340 * dt / this.cam.z;
    if (kd('ArrowLeft')) this.tgt.x -= pan;
    if (kd('ArrowRight')) this.tgt.x += pan;
    if (kd('ArrowUp')) this.tgt.y -= pan;
    if (kd('ArrowDown')) this.tgt.y += pan;
    if (kp('+') || kp('=')) this.zoomBy(1.25);
    if (kp('-')) this.zoomBy(0.8);
    if (kp('Home') || kp('h')) this.home();
    if (kp('Enter') && this.sel && S[this.sel] === 'available') this.research(this.sel);
    this.clampTgt();
    // ---- camera glide (zoom in log space)
    const k = 1 - Math.exp(-dt * 8);
    this.cam.x += (this.tgt.x - this.cam.x) * k;
    this.cam.y += (this.tgt.y - this.cam.y) * k;
    this.cam.z = Math.exp(lerp(Math.log(this.cam.z), Math.log(this.tgt.z), k));
    // ---- per-node animation
    for (const nd of NODES) {
      const A = this.a(nd.id);
      A.hov += ((this.hover === nd.id ? 1 : 0) - A.hov) * Math.min(1, dt * 14);
      A.pop = Math.max(0, A.pop - dt * 2.4);
      A.shake = Math.max(0, A.shake - dt * 2.5);
      if (A.rv < 1) {
        if (A.delay > 0) A.delay -= dt;
        else {
          if (A.rv === 0) { this.burst(nd.id, 'reveal', { label: A.newLabel }); g.audio.play('sparkle', { vol: 0.35, pitch: 1.2 + hash1(nd.depth, 2) * 0.3 }); g.audio.play('bubble', { vol: 0.4, pitch: 1.5 }); }
          A.rv = Math.min(1, A.rv + dt / 1.1);
        }
      }
      const hd = this.hd[nd.id];
      const want = hd === 0 ? 0 : SIL_ALPHA[Math.min(4, hd)];
      A.sa += (want - A.sa) * Math.min(1, dt * 3);
    }
    const R = this.a(ROOT_ID);
    R.hov += ((this.hover === ROOT_ID ? 1 : 0) - R.hov) * Math.min(1, dt * 14);
    R.pop = Math.max(0, R.pop - dt * 2.4);
    for (const f of this.fx) {
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt;
      if (f.vx !== undefined) { f.vy += (f.g || 0) * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 1 - dt * 1.5; if (f.rot !== undefined) f.rot += dt * 8; }
    }
    this.fx = this.fx.filter((f) => f.t < f.dur);
    if (this.hl) { this.hl.t += dt; if (this.hl.t > 6) this.hl = null; }
    this.cardK += ((this.sel ? 1 : 0) - this.cardK) * Math.min(1, dt * 12);
    if (this.used || this.t > 14) this.hintK = Math.max(0, this.hintK - dt * 0.8);
    void st;
  }

  pick(mx, my) {
    const z = this.cam.z;
    let best = null, bd = 1e9;
    const test = (id, pos, r) => {
      const dx = Math.abs(this.X(pos[0]) - mx), dy = Math.abs(this.Y(pos[1]) - my);
      if (dx <= r && dy <= r && dx + dy < bd) { bd = dx + dy; best = id; }
    };
    test(ROOT_ID, [0, 0], ROOT_R * z + 2);
    for (const nd of NODES) {
      if (!this.revealed(nd.id) && this.a(nd.id).sa < 0.3) continue;
      test(nd.id, nd.pos, NODE_R * z + 2);
    }
    return best;
  }

  click(id) {
    const g = this.game;
    if (!id) { if (this.sel) { this.sel = null; g.audio.play('ui_click', { pitch: 0.8 }); } return; }
    this.used = true;
    const dbl = this.lastClick.id === id && this.t - this.lastClick.t < 0.38;
    this.lastClick = { id, t: this.t };
    const s = this.S[id];
    if (dbl && s === 'available') { this.research(id); return; }
    this.select(id);
    if (id !== ROOT_ID && !this.revealed(id)) { this.a(id).shake = 0.6; this.burst(id, 'nope'); g.audio.play('bubble', { pitch: 0.6 }); }
    else g.audio.play('ui_click', { pitch: 1.05 });
  }

  // ---------------------------------------------------------------- drawing
  // [lab14] the underwater voxel scene behind the tree (src/ui/labroom.js): seabed, reefs, kelp, fish, caustics,
  // with parallax from the tree camera (pan in screen px, zoom delta)
  drawBackground(ctx, v) {
    const cam = this.cam;
    drawLabRoom(ctx, v, this.t, { x: cam.x * cam.z, y: cam.y * cam.z, z: cam.z - Z_HOME }, 'tree');
  }

  // rising bubbles (two depths) and drifting motes over the room, under the fog
  drawShelf(ctx, v) {
    const t = this.t, cam = this.cam;
    for (let i = 0; i < 18; i++) {
      const far = i % 3 === 0;
      const q = (t * (0.02 + hash1(i, 6) * 0.04) * (far ? 0.6 : 1) + hash1(i, 7)) % 1;
      const px = ((hash1(i, 8) * v.w - cam.x * cam.z * (far ? 0.08 : 0.22)) % v.w + v.w) % v.w;
      const bx = v.x + px + Math.sin(t * (far ? 0.8 : 1.3) + i) * 3, by = v.y + v.h + 10 - q * (v.h + 30);
      if (far) { ctx.save(); ctx.globalAlpha = 0.35; ctx.drawImage(microBubble(1 + (i % 2) * 0.5), Math.round(bx * 2) / 2, Math.round(by * 2) / 2); ctx.restore(); }
      else drawAeroBubble(ctx, bx, by, 1.5 + hash1(i, 9) * 2.5, 0.45);
    }
    ctx.fillStyle = '#e8fbff';
    for (let i = 0; i < 24; i++) {
      const mx = v.x + ((hash1(i, 51) * v.w + t * (2 + hash1(i, 52) * 4) - cam.x * cam.z * 0.15) % v.w + v.w) % v.w, my = v.y + ((hash1(i, 53) * v.h + Math.sin(t * 0.5 + i) * 8) % v.h);
      ctx.globalAlpha = 0.2 + 0.3 * Math.max(0, Math.sin(t * 1.4 + i * 1.7));
      ctx.fillRect(Math.round(mx * 2) / 2, Math.round(my * 2) / 2, 0.5, 0.5);
    }
    ctx.globalAlpha = 1;
  }

  drawFog(ctx, v) {
    // the fog of war: a half-res dark-sea layer (nearest, 4 device px blocks) with light where you have explored
    const F = 2, fw = Math.ceil(v.w / F), fh = Math.ceil(v.h / F);
    if (!this.fog || this.fog.width !== fw || this.fog.height !== fh) this.fog = makeCanvas(fw, fh);
    const f = ctxOf(this.fog), z = this.cam.z;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fw, fh);
    const fg = f.createLinearGradient(0, 0, 0, fh);
    fg.addColorStop(0, 'rgba(3,14,34,0.26)'); fg.addColorStop(1, 'rgba(1,6,18,0.34)'); // [lab14] the sea shows through, dimmed
    f.fillStyle = fg;
    f.fillRect(0, 0, fw, fh);
    f.globalCompositeOperation = 'destination-out';
    const light = (wx, wy, r, a = 1) => {
      const x = (this.X(wx) - v.x) / F, y = (this.Y(wy) - v.y) / F, rr = (r * z) / F;
      if (x + rr < 0 || y + rr < 0 || x - rr > fw || y - rr > fh || rr < 1) return;
      const gr = f.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.5, `rgba(0,0,0,${a * 0.94})`); gr.addColorStop(0.78, `rgba(0,0,0,${a * 0.5})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = gr; f.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    };
    light(0, 0, 280, 0.55);
    for (const nd of NODES) {
      if (!this.revealed(nd.id)) continue;
      const A = this.a(nd.id), k = A.delay > 0 && A.rv === 0 ? 0 : ease.outCubic(clamp01(A.rv));
      if (k > 0) light(nd.pos[0], nd.pos[1], (this.S[nd.id] === 'done' ? 125 : 150) * k, 0.55);
    }
    // [lab13] a soft vignette in the same pass: darker edges, the tree's middle stays clear
    f.globalCompositeOperation = 'source-over';
    if (!this.vig || this.vig.w !== fw || this.vig.h !== fh) {
      const r = f.createRadialGradient(fw / 2, fh * 0.48, Math.min(fw, fh) * 0.25, fw / 2, fh * 0.48, Math.max(fw, fh) * 0.7);
      r.addColorStop(0, 'rgba(3,14,32,0)'); r.addColorStop(0.6, 'rgba(3,14,32,0.14)'); r.addColorStop(1, 'rgba(2,8,22,0.42)');
      const l = f.createLinearGradient(0, 0, 0, fh);
      l.addColorStop(0, 'rgba(2,10,26,0.3)'); l.addColorStop(0.12, 'rgba(2,10,26,0)'); l.addColorStop(0.85, 'rgba(2,10,26,0)'); l.addColorStop(1, 'rgba(2,10,26,0.26)');
      this.vig = { w: fw, h: fh, r, l };
    }
    f.fillStyle = this.vig.r; f.fillRect(0, 0, fw, fh);
    f.fillStyle = this.vig.l; f.fillRect(0, 0, fw, fh);
    ctx.drawImage(this.fog, v.x, v.y, fw * F, fh * F);
  }

  // [phase9:ui] Stamps squares along a screen-space polyline at half-pixel precision (crisp on the full-res layer).
  // Samples are spaced `step` apart along the arc; `from`/`to` (0..1) limit the stretch drawn.
  stamp(ctx, S, w, col, o = {}) {
    const from = o.from ?? 0, to = o.to ?? 1, gap = o.gap || 0, dash = o.dash || 1;
    const L = S.len;
    if (L <= 0) return;
    ctx.fillStyle = col;
    const ww = Math.max(0.5, Math.round(w * 2) / 2), h2 = ww / 2;
    const off = o.off || 0;
    const P = S.pts, i0 = Math.round(L * from * 2), i1 = Math.min(P.length - 1, Math.round(L * to * 2)), st = Math.max(1, Math.round((o.step || 1) * 2));
    let lx = -1e9, ly = -1e9;
    for (let i = i0; i <= i1; i += st) {
      if (gap) { const d = i / 2; if (d % (dash + gap) > dash) continue; }
      const p = P[i];
      const x = Math.round((p[0] - h2 + off * p[2]) * 2) / 2, y = Math.round((p[1] - h2 + off * p[3]) * 2) / 2;
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      ctx.fillRect(x, y, ww, ww);
    }
  }

  // [phase9:ui] glowing glass pipes: a soft branch glow, dark outline, pale glass, the water running down to the child
  // (filled when done, rising while brewing), a hairline highlight, chrome joints, bubbles and light flowing along.
  drawEdges(ctx, v) {
    const z = this.cam.z, t = this.t, st = this.game.state;
    for (const e of EDGES) {
      const pts = e.pts.map(([x, y]) => [this.X(x), this.Y(y)]);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (x1 < v.x - 8 || y1 < v.y - 8 || x0 > v.x + v.w + 8 || y0 > v.y + v.h + 8) continue;
      const S = arc(pts);
      const sTo = this.S[e.to], col = branchCol(e.branch);
      const A = this.a(e.to);
      if (!this.revealed(e.to)) {
        if (A.sa < 0.04) continue;
        ctx.save(); ctx.globalAlpha = A.sa * 0.85;
        const w = Math.max(2, Math.round(3 * z * 2) / 2);
        this.stamp(ctx, S, w + 1, '#010308', { gap: Math.max(2, 4 * z), dash: Math.max(2, 3 * z) });
        this.stamp(ctx, S, Math.max(1, w - 1), '#0e1a2c', { gap: Math.max(2, 4 * z), dash: Math.max(2, 3 * z) });
        ctx.restore();
        continue;
      }
      const rk = A.delay > 0 && A.rv === 0 ? 0.25 : 0.25 + 0.75 * ease.outCubic(clamp01(A.rv));
      const w = clamp(Math.round(6.5 * z * 2) / 2, 3, 10);
      const water = sTo === 'done' ? 1 : sTo === 'researching' ? 0.1 + 0.9 * labProgress(st, e.to) : sTo === 'queued' ? 0.06 : 0;
      ctx.save(); ctx.globalAlpha *= rk;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + A.ph);
      // the static pipe body is cached per edge while the camera zoom holds still (panning just moves it)
      const still = ctx.__hi && Math.abs(this.cam.z - this.tgt.z) < 0.0015 && (water === 0 || water === 1);
      if (still) {
        const sp = this.pipeSprite(e, z, w, col, sTo, water);
        ctx.drawImage(sp, Math.round((this.X(e.pts[0][0]) + sp.ox) * 2) / 2, Math.round((this.Y(e.pts[0][1]) + sp.oy) * 2) / 2);
      } else this.pipeBody(ctx, S, w, col, sTo, water);
      if (water > 0 && water < 1) { const p = S.at(water * S.len); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round((p[0] - 1) * 2) / 2, Math.round((p[1] - 1) * 2) / 2, 2, 2); }
      if (sTo === 'available') {
        // an empty glass pipe waiting: a faint charge of light pulsing through it
        ctx.globalAlpha = rk * (0.2 + 0.3 * pulse);
        this.stamp(ctx, S, Math.max(0.5, w - 4.5), mix(col, '#ffffff', 0.6), { step: 1 });
        ctx.globalAlpha = rk;
      }
      // flowing: bubbles riding the water, sparkles of light trickling toward an available node
      const runs = sTo === 'available' ? 3 : water > 0 ? Math.max(2, Math.round(S.len / 40)) : 0;
      for (let i = 0; i < runs; i++) {
        const q = (t * (sTo === 'available' ? 0.5 : 0.32) * (60 / Math.max(40, S.len)) * 1.6 + i / runs + hash1(e.to.length, i) * 0.2) % 1;
        if (water > 0 && q > water) continue;
        const p = S.at(q * S.len);
        if (sTo === 'available') {
          ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(p[0] * 2) / 2 - 0.5, Math.round(p[1] * 2) / 2 - 0.5, 1, 1);
          drawSparkle(ctx, p[0], p[1], 1, 0.9, '#fff6a0');
        } else {
          const br = w >= 6 ? 1.5 : 1;
          ctx.drawImage(microBubble(br), Math.round((p[0] - br - 1) * 2) / 2, Math.round((p[1] - br - 1) * 2) / 2);
        }
      }
      ctx.restore();
    }
  }

  // the pipe body: glow, outline, glass, the water (to `water`), hairline highlight, round chrome joints
  pipeBody(ctx, S, w, col, sTo, water) {
    if (sTo === 'available' || water > 0) {
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * (sTo === 'available' ? 0.14 : 0.16);
      this.stamp(ctx, S, w + 6, col, { step: 2 });
      ctx.globalAlpha = ga;
    }
    const deep = shade(col, -0.62);
    this.stamp(ctx, S, w + 1.5, deep);
    this.stamp(ctx, S, w, mix(col, '#ffffff', sTo === 'available' ? 0.7 : 0.55));
    this.stamp(ctx, S, w - 2, mix(col, '#082e5c', 0.5));
    if (water > 0) {
      this.stamp(ctx, S, w - 2, mix(col, '#ffffff', 0.08), { to: water });
      this.stamp(ctx, S, Math.max(0.5, w - 4.5), mix(col, '#ffffff', 0.45), { to: water });
    }
    this.stamp(ctx, S, 0.5, '#ffffff', { off: w / 2 - 1.25, step: 0.5 });
    const jt = pipeJoint(w + 3, col, water >= 1);
    const joints = [2, S.len - 2];
    if (S.len > 130) joints.push(S.len / 2);
    for (const d of joints) { const p = S.at(d); ctx.drawImage(jt, Math.round((p[0] - jt.width / 2) * 2) / 2, Math.round((p[1] - jt.height / 2) * 2) / 2); }
  }

  pipeSprite(e, z, w, col, sTo, water) {
    const key = e.to + '|' + sTo + '|' + water;
    if (!this.pipes || this.pipesZ !== z) { this.pipes = new Map(); this.pipesZ = z; }
    let c = this.pipes.get(key);
    if (c) return c;
    // the edge in screen units relative to its first point (depends on the zoom only)
    const o = e.pts[0];
    const rel = e.pts.map(([x, y]) => [(x - o[0]) * z, (y - o[1]) * z]);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of rel) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = w + 8;
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad);
    const W = Math.ceil(x1 + pad - x0), H = Math.ceil(y1 + pad - y0);
    c = makeCanvas(W * HI, H * HI);
    const g = hiCtx(c, HI);
    const S = arc(rel.map(([x, y]) => [x - x0, y - y0]));
    this.pipeBody(g, S, w, col, sTo, water);
    const out = makeCanvas(W, H);
    Object.defineProperty(out, 'hi', { value: c, configurable: true });
    out.ox = x0; out.oy = y0;
    this.pipes.set(key, out);
    return out;
  }

  drawRoot(ctx) {
    const z = this.cam.z, t = this.t, A = this.a(ROOT_ID);
    let S = Math.round(LAB_ROOT * z * (1 + 0.06 * A.hov + Math.sin(Math.min(1, A.pop) * Math.PI) * 0.12 * (A.pop > 0)));
    S += S % 2;
    const x = Math.round(this.X(0)), y = Math.round(this.Y(0) + Math.sin(t * 1.6) * 1.5 * z);
    // a halo of light behind the hub, then a soft drop shadow
    drawAeroGlow(ctx, x, y, S * 0.9, '#bfffd0', 0.22 + 0.06 * Math.sin(t * 1.7));
    ctx.fillStyle = 'rgba(2,20,52,0.35)'; ctx.fillRect(x - Math.round(S * 0.38), y + Math.round(S / 2) + 2, Math.round(S * 0.76), Math.max(2, Math.round(S * 0.06)));
    const tile = nodeTile(S, 'root', null);
    ctx.drawImage(tile, x - S / 2 - tile.pad, y - S / 2 - tile.pad);
    this.shine(ctx, x, y, S, 0.4, 2.6);
    // the 8 branch gems around the hub, each in its branch's cut, twinkling in turn
    const gr = Math.max(2, Math.round(4.5 * z * 2) / 2);
    BRANCH_ORDER.forEach((b, i) => {
      const a = (BRANCHES[b].angle * Math.PI) / 180, r = S / 2 + gr * 0.3;
      const gx = x + Math.cos(a) * r, gy = y + Math.sin(a) * r;
      const g = gemTex(gr, branchCol(b), GEM_CUT[b]);
      ctx.drawImage(g, Math.round((gx - g.width / 2) * 2) / 2, Math.round((gy - g.height / 2) * 2) / 2);
      if (((t * 0.5 + i / 8) % 1) < 0.06) drawSparkle(ctx, gx - gr * 0.3, gy - gr * 0.4, 1, 1);
    });
    drawAnimIcon(ctx, 'beaker', x, y + 1, Math.round(S * 0.6), t, 0.5, { hover: 0.3 });
    for (let i = 0; i < 4; i++) { const q = (t * 0.5 + i / 4) % 1; ctx.drawImage(microBubble(1 + q), Math.round((x + Math.sin(t * 2 + i * 2) * S * 0.12) * 2) / 2, Math.round((y - S * 0.1 - q * S * 0.42) * 2) / 2); }
    if (((t * 0.4) % 1) < 0.15) drawSparkle(ctx, x + S * 0.28, y - S * 0.28, 2, 1, '#fff6a0');
    // researched count plate under the hub
    if (z > 0.5) {
      const L = ensureLab(this.game.state);
      const n = NODES.reduce((s, nd) => s + (L.done[nd.id] ? 1 : 0), 0);
      const txt = `${n} / ${TOTAL}`;
      const tw = measureText(txt, 'big'), w = tw + 20, h = 17;
      const px = x - Math.round(w / 2), py = y + Math.round(S / 2) + 6;
      ctx.drawImage(aeroSurface(w, h, { top: '#fff8d8', mid: '#ffe08a', bot: '#f2b23a', edge: '#6a3c08', a: [1, 1], r: 'pill', gloss: 0.7, glossH: 7, curve: 1, rim: 0.85, glow: 0.5 }), px, py);
      drawText(ctx, txt, px + 10, py + 4, { font: 'big', color: '#5a3206', shadow: '#fff6d0' });
    }
  }

  // a glare that sweeps diagonally across a tile's glass now and then (period p s, phase ph)
  shine(ctx, x, y, S, ph = 0, p = 3.4) {
    const q = ((this.t + ph) % p) / 0.9;
    if (q >= 1) return;
    const f = Math.max(2.5, S * 0.135), iw = S - f * 2, x0 = x - S / 2 + f, y0 = y - S / 2 + f;
    ctx.save();
    roundRectPath(ctx, x0, y0, iw, iw, Math.max(2, iw * 0.2)); ctx.clip();
    const sx = x0 - iw + q * iw * 2.6;
    ctx.globalAlpha = 0.55 * Math.sin(q * Math.PI);
    ctx.fillStyle = '#ffffff';
    for (let yy = 0; yy < iw; yy += 0.5) {
      const xx = sx + yy * 0.6;
      ctx.fillRect(Math.round(xx * 2) / 2, y0 + yy, Math.max(1, iw * 0.12), 0.5);
      ctx.fillRect(Math.round((xx + iw * 0.2) * 2) / 2, y0 + yy, 0.5 + iw * 0.03, 0.5);
    }
    ctx.restore();
  }

  drawBranchLabels(ctx) {
    const z = this.cam.z;
    const k = clamp01((z - 0.42) / 0.16);
    if (k <= 0) return;
    ctx.save(); ctx.globalAlpha *= k;
    for (const b of BRANCH_ORDER) {
      const B = BRANCHES[b], a = (B.angle * Math.PI) / 180, col = branchCol(b);
      const cx = this.X(Math.cos(a) * LABEL_R), cy = this.Y(Math.sin(a) * LABEL_R);
      const txt = B.name.toUpperCase();
      const gr = 3.5, w = measureText(txt, 'big') + 22, h = 17;
      const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
      ctx.fillStyle = 'rgba(2,20,52,0.3)'; ctx.fillRect(x + 3, y + h, w - 6, 2);
      ctx.drawImage(aeroSurface(w, h, { tone: toneFrom(col), r: 5, gloss: 0.8, glossH: 7, curve: 1, rim: 0.85, glow: 0.6 }), x, y);
      const g = gemTex(gr, mix(col, '#ffffff', 0.25), GEM_CUT[b]);
      ctx.drawImage(g, Math.round((x + 9 - g.width / 2) * 2) / 2, Math.round((y + h / 2 - g.height / 2) * 2) / 2);
      drawText(ctx, txt, x + 16, y + 4, { font: 'big', color: '#ffffff', shadow: shade(col, -0.65) });
    }
    ctx.restore();
  }

  drawSil(ctx, nd) {
    const A = this.a(nd.id), z = this.cam.z, t = this.t;
    if (A.sa < 0.03) return;
    const hd = this.hd[nd.id] || 1;
    let S = Math.round(LAB_NODE * z * (hd <= 1 ? 0.94 : 0.84) * (1 + 0.08 * A.hov));
    S += S % 2;
    if (S < 6) return;
    const shake = A.shake > 0 ? Math.sin(A.shake * 40) * 2.5 * A.shake : 0;
    const x = Math.round(this.X(nd.pos[0]) + shake), y = Math.round(this.Y(nd.pos[1]));
    ctx.save(); ctx.globalAlpha *= A.sa;
    // next-up silhouettes keep a faint branch-coloured aura so you can tell where they lead
    if (hd <= 1) drawAeroGlow(ctx, x, y, S * 0.75, branchCol(nd.branch), 0.12 + 0.05 * Math.sin(t * 2 + A.ph));
    const tile = nodeTile(S, hd <= 1 ? 'sil' : 'deep', nd.branch);
    ctx.drawImage(tile, x - S / 2 - tile.pad, y - S / 2 - tile.pad);
    if (hd <= 1) {
      const q = qMark(S);
      const box = inkBox(q);
      const bob = Math.round(Math.sin(t * 2.2 + A.ph) * 1.2 * 2) / 2;
      ctx.globalAlpha *= 0.78 + 0.22 * Math.sin(t * 2 + A.ph);
      ctx.drawImage(q, Math.round(x - q.width / 2), Math.round(y - (box.top + box.bot) / 2) + bob);
    }
    ctx.restore();
    if (this.sel === nd.id) this.drawBrackets(ctx, x, y, S, '#9fc8ec');
  }

  // selection marker: four pixel corner brackets that breathe in and out (no rings)
  drawBrackets(ctx, x, y, S, col = '#ffffff') {
    const o = Math.round(S / 2 + 3 + Math.abs(Math.sin(this.t * 4)) * 3), l = Math.max(5, Math.round(S * 0.2)), w = 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = x + sx * o, cy = y + sy * o;
      ctx.fillStyle = '#062a50';
      ctx.fillRect(Math.min(cx, cx - sx * l) - 1, cy - (sy > 0 ? w : 0) - 1, l + 2, w + 2);
      ctx.fillRect(cx - (sx > 0 ? w : 0) - 1, Math.min(cy, cy - sy * l) - 1, w + 2, l + 2);
      ctx.fillStyle = col;
      ctx.fillRect(Math.min(cx, cx - sx * l), cy - (sy > 0 ? w : 0), l, w);
      ctx.fillRect(cx - (sx > 0 ? w : 0), Math.min(cy, cy - sy * l), w, l);
    }
  }

  drawNode(ctx, nd) {
    const A = this.a(nd.id), t = this.t, z = this.cam.z, st = this.game.state;
    const s = this.S[nd.id], col = branchCol(nd.branch);
    const waiting = A.delay > 0 && A.rv === 0;
    if (waiting) { A.sa = Math.max(A.sa, 1); this.drawSil(ctx, nd); return; }
    const k = ease.outCubic(clamp01(A.rv));
    const pop = (A.pop > 0 ? Math.sin(Math.min(1, A.pop) * Math.PI) * 0.18 : 0) + (A.rv < 1 ? Math.sin(k * Math.PI) * 0.16 : 0);
    const sel = this.sel === nd.id;
    let S = Math.round(LAB_NODE * z * (1 + 0.1 * A.hov + pop + (sel ? 0.05 : 0)));
    S += S % 2;
    if (S < 6) return;
    const shake = A.shake > 0 ? Math.sin(A.shake * 40) * 2.5 * A.shake : 0;
    const bob = s === 'available' ? Math.round(Math.sin(t * 2.2 + A.ph) * 1.2 * z) : 0;
    const x = Math.round(this.X(nd.pos[0]) + shake), y = Math.round(this.Y(nd.pos[1]) + bob);
    const x0 = x - S / 2, y0 = y - S / 2;
    const f = Math.max(2.5, Math.round(S * 0.135 * 2) / 2), iw = S - f * 2;
    const afford = s === 'available' && (() => { const c = labCheck(st, nd, this.game.stats); return c.paid && c.gateOk; })();
    // pixel drop shadow
    ctx.fillStyle = 'rgba(2,20,52,0.32)'; ctx.fillRect(x - Math.round(S * 0.36), y0 + S + 1, Math.round(S * 0.72), Math.max(2, Math.round(S * 0.07)));
    const look = s === 'done' ? 'done' : s === 'researching' || s === 'queued' ? 'brew' : 'open';
    if (s === 'available') drawAeroGlow(ctx, x, y, S * 0.85, col, (afford ? 0.22 : 0.12) + 0.08 * Math.sin(t * 2.4 + A.ph));
    else if (s === 'done') drawAeroGlow(ctx, x, y, S * 0.7, col, 0.14);
    const tile = nodeTile(S, look, nd.branch);
    ctx.drawImage(tile, x0 - tile.pad, y0 - tile.pad);
    // brewing: pixel water rising inside the window
    if (s === 'researching' || s === 'queued') {
      const p = s === 'queued' ? 0.05 : labProgress(st, nd.id);
      const top = Math.round(y0 + f + iw * (1 - (0.1 + 0.88 * p)));
      ctx.save(); roundRectPath(ctx, x0 + f, y0 + f, iw, iw, Math.max(2, Math.round(iw * 0.18))); ctx.clip();
      for (let xx = 0; xx < iw; xx += 0.5) {
        const h = Math.round(Math.sin(t * 5 + xx * 0.35 + A.ph) * 1.4 * 2) / 2;
        ctx.fillStyle = mix(col, '#5fe08a', 0.55); ctx.fillRect(x0 + f + xx, top + h, 0.5, y0 + f + iw - top - h);
        ctx.fillStyle = '#e8fff0'; ctx.fillRect(x0 + f + xx, top + h, 0.5, 0.5);
        ctx.fillStyle = '#a8f8c0'; ctx.fillRect(x0 + f + xx, top + h + 0.5, 0.5, 0.5);
      }
      ctx.restore();
      for (let i = 0; i < 4; i++) { const q = (t * 0.8 + i * 0.25 + A.ph) % 1; ctx.save(); ctx.globalAlpha *= 1 - q * 0.6; ctx.drawImage(microBubble(i % 2 ? 1 : 1.5), Math.round((x + Math.sin(t * 3 + i * 2) * iw * 0.28 - 2) * 2) / 2, Math.round((y0 + S - f - 4 - q * iw * 0.6) * 2) / 2); ctx.restore(); }
    }
    // the icon
    drawAnimIcon(ctx, nd.icon, x, y, Math.round(iw * 0.86), t, A.ph, { hover: A.hov + (afford ? 0.25 : 0), still: s === 'queued' });
    // the unveil: black ink shrinking away from the middle of the tile
    if (A.rv < 1) {
      const holeR = Math.round(S * 0.72 * k);
      ctx.save();
      ctx.globalAlpha *= 1 - k * 0.15;
      const sil = nodeTile(S, 'sil', nd.branch);
      ctx.beginPath(); ctx.rect(x0 - S * 0.12, y0 - S * 0.12, S * 1.24, S * 1.24);
      // a blocky (8-sided) hole so the ink clears in pixel steps
      for (let i = 8; i >= 0; i--) { const a = (i / 8) * TAU + Math.PI / 8; const px = Math.round(x + Math.cos(a) * holeR), py = Math.round(y + Math.sin(a) * holeR); if (i === 8) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.clip('evenodd');
      ctx.drawImage(sil, x0 - sil.pad, y0 - sil.pad);
      ctx.restore();
    }
    if (s === 'available' || s === 'done') this.shine(ctx, x, y, S, A.ph, s === 'done' ? 5.5 : 3.2);
    // the crest gem twinkles now and then
    if (((t * 0.33 + A.ph * 0.1) % 1) < 0.07 && s !== 'queued') drawSparkle(ctx, x - S * 0.03, y0 + S * 0.03, 1, 1);
    // affordable + available: twinkling pixel sparkles around the tile (no rings)
    if (afford) for (let i = 0; i < 2; i++) { const q = (t * 0.7 + i * 0.5 + A.ph * 0.1) % 1; if (q < 0.35) { const a = A.ph + i * 2.6 + Math.floor(t * 0.7 + i * 0.5) * 1.9; drawSparkle(ctx, x + Math.cos(a) * S * 0.62, y + Math.sin(a) * S * 0.62, q < 0.18 ? 2 : 1, 1, i ? '#ffffff' : '#fff6a0'); } }
    // done: a check stamp + a glint now and then
    if (s === 'done') {
      const ck = getUiIcon('check');
      if (ck && S >= 26) {
        const bs = ck.width + 4, bx = x0 + S - bs + 2, by = y0 + S - bs + 2;
        ctx.drawImage(aeroSurface(bs, bs, { tone: 'green', r: 3, gloss: 0.8, glossH: 4, curve: 1, rim: 0.8, glow: 0.4, edge: '#ffffff', edgeA: 1 }), bx, by);
        ctx.drawImage(ck, bx + 2, by + 2);
      }
      if (((t * 0.3 + A.ph * 0.13) % 1) < 0.1) drawSparkle(ctx, x0 + S - 5, y0 + 5, 2, 1);
    }
    if (s === 'queued') { const ci = getUiIcon('clock'); if (ci) ctx.drawImage(ci, x0 + S - ci.width + 2, y0 - 3); }
    // an active quest wants this one (or something behind it): a bouncing "!" tag
    if (this.questMark?.[nd.id] && s !== 'done') {
      const ex = getUiIcon('exclaim');
      const by = Math.round(y0 - 6 - Math.abs(Math.sin(t * 4 + A.ph)) * 3);
      ctx.drawImage(aeroSurface(12, 14, { tone: this.questMark[nd.id] === GOAL_MARK ? 'green' : 'orange', r: 3, gloss: 0.8, glossH: 6, curve: 1, rim: 0.8, glow: 0.6, edge: '#ffffff', edgeA: 1 }), x0 - 4, by);
      if (ex) ctx.drawImage(ex, x0 - 4 + Math.round((12 - ex.width) / 2), by + Math.round((14 - ex.height) / 2));
      else drawText(ctx, '!', x0, by + 3, { font: 'big', color: '#ffffff', shadow: '#843a04' });
    }
    // tutorial / focus pointer: a bouncing pixel arrow above
    if (this.hl?.id === nd.id) {
      const ar = getUiIcon('arrow_d');
      if (ar) ctx.drawImage(ar, Math.round(x - ar.width / 2), Math.round(y0 - ar.height - 8 - Math.abs(Math.sin(t * 5)) * 4));
    }
    if (sel) this.drawBrackets(ctx, x, y, S);
    nd.__S = S;
  }

  drawLabel(ctx, nd) {
    const s = this.S[nd.id], A = this.a(nd.id), z = this.cam.z;
    const front = s === 'available' || s === 'researching' || s === 'queued';
    const show = A.hov > 0.3 || this.sel === nd.id || (front && z >= 0.72) || (s === 'done' && z >= 1.3);
    if (!show || A.rv < 0.5 || (A.delay > 0 && A.rv === 0)) return;
    const st = this.game.state;
    const lines = (nd.__lines ||= wrapText(nd.name, 84, 'big').slice(0, 2));
    let sub = null, subCol = '#a6ffcf';
    if (s === 'researching') sub = fmtTime(labRemaining(st, nd.id));
    else if (s === 'queued') { sub = 'QUEUED #' + labQueued(st, nd.id); subCol = '#e0c8ff'; }
    const all = sub ? [...lines, sub] : lines;
    const w = Math.max(...all.map((l, i) => measureText(l, i < lines.length ? 'big' : 'normal'))) + 8;
    const h = lines.length * 12 + (sub ? 10 : 0) + 4;
    const x = Math.round(this.X(nd.pos[0]) - w / 2), y = Math.round(this.Y(nd.pos[1]) + (nd.__S || LAB_NODE * z) / 2 + 4);
    ctx.drawImage(aeroSurface(w, h, { top: '#1c4a7c', mid: '#0c2c56', bot: '#06203f', edge: '#020c1c', a: [0.82, 0.86], r: 4, gloss: 0.18, glossH: 5, curve: 1, rim: 0.4, glow: 0.3, glowColor: '#3ab0ff' }), x, y);
    lines.forEach((l, i) => drawText(ctx, l, x + Math.round((w - measureText(l, 'big')) / 2), y + 3 + i * 12, { font: 'big', color: '#ffffff', shadow: '#03142c' }));
    if (sub) drawText(ctx, sub, x + Math.round((w - measureText(sub, 'normal')) / 2), y + 3 + lines.length * 12, { color: subCol, shadow: '#03142c' });
  }

  drawFx(ctx) {
    const z = this.cam.z;
    for (const f of this.fx) {
      if (f.delay > 0) continue;
      const k = clamp01(f.t / f.dur), x = this.X(f.x), y = this.Y(f.y);
      if (f.kind === 'spark') drawSparkle(ctx, x, y, (f.size || 1) + (k < 0.4 ? 1 : 0), 1 - k, f.col);
      else if (f.kind === 'bubble') drawAeroBubble(ctx, x, y, f.r, 1 - k);
      else if (f.kind === 'ink') {
        const s = Math.max(1, Math.round((f.size || 2) * (1 - k * 0.6) * Math.max(0.7, z)));
        ctx.fillStyle = rgba('#02050b', 1 - k * k); ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
        ctx.fillStyle = rgba('#3a5878', (1 - k) * 0.6); ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), 1, 1);
      } else if (f.kind === 'confetti') {
        const w = Math.abs(Math.cos(f.rot)) > 0.5 ? 3 : 1;
        ctx.fillStyle = rgba(f.col, 1 - k * k); ctx.fillRect(Math.round(x), Math.round(y), w, 2);
      } else if (f.kind === 'label') {
        const yy = y - LAB_NODE * z * 0.75 - ease.outCubic(k) * 16;
        // [phase9:ui] the label pops up as extruded 3D voxel letters
        if (!drawPop3D(ctx, f.text, x, yy - 4, { t: this.t, pop: clamp01(f.t / 0.35), alpha: 1 - clamp01((k - 0.6) / 0.4), palette: f.text === 'NEW!' ? 'aqua' : 'gold', size: 16, depth: 3, wobble: 0.7, glowColor: '#03142c' })) {
          ctx.globalAlpha = 1 - clamp01((k - 0.6) / 0.4);
          drawText(ctx, f.text, Math.round(x - measureText(f.text, 'big') / 2), Math.round(yy - 10), { font: 'big', color: '#fff6a0', outline: '#5a3a06' });
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // Lab nodes that an active quest asks for -> the revealed node on the way there gets the "!"
  questMarks() {
    const out = {};
    this.quest = {};
    const book = this.game.quests?.book;
    if (!book?.active) return out;
    try {
      for (const q of book.active()) {
        for (const o of q.objectives) {
          const ob = book.realObj ? book.realObj(o) : o;
          let id = null;
          if (ob.t === 'research' && ob.id) id = ob.id;
          else if (ob.t === 'tank') id = nodeFor('tank', TANK_ORDER[ob.tier])?.id;
          else if (ob.t === 'boat') id = nodeFor('boat', BOAT_ORDER[ob.tier])?.id;
          else if (ob.t === 'visit') id = nodeFor('biome', ob.biome)?.id;
          if (!id || this.S[id] === 'done') continue;
          this.quest[id] ||= q;
          const m = this.revealed(id) ? LAB_BY_ID[id] : this.gate(id);
          if (m) { out[m.id] = q; this.quest[m.id] ||= q; }
        }
      }
    } catch { /* quests are optional */ }
    // [balance] the next main-track upgrade (rod / tank / boat / ocean) gets a green tag when no quest points at it
    this.goalId = null;
    try {
      const gl = labGoal(this.game.state);
      if (gl && !this.quest[gl.id] && this.revealed(gl.id)) { out[gl.id] ||= GOAL_MARK; this.goalId = gl.id; }
    } catch { /* optional */ }
    return out;
  }

  draw(ctx, ui, view, dt) {
    const v = view, z = this.cam.z;
    ctx.save();
    roundRectPath(ctx, v.x, v.y, v.w, v.h, 8); ctx.clip();
    this.drawBackground(ctx, v);
    this.drawFog(ctx, v);
    this.drawShelf(ctx, v);
    this.questMark = this.questMarks();
    this.drawEdges(ctx, v);
    this.drawBranchLabels(ctx);
    this.drawRoot(ctx);
    const m = LAB_NODE * z;
    const vis = (nd) => { const x = this.X(nd.pos[0]), y = this.Y(nd.pos[1]); return x > v.x - m && y > v.y - m && x < v.x + v.w + m && y < v.y + v.h + m; };
    const shown = NODES.filter(vis);
    for (const nd of shown) if (!this.revealed(nd.id)) this.drawSil(ctx, nd);
    const rev = shown.filter((nd) => this.revealed(nd.id)).sort((a, b) => (this.a(a.id).hov + (this.sel === a.id)) - (this.a(b.id).hov + (this.sel === b.id)));
    for (const nd of rev) this.drawNode(ctx, nd);
    for (const nd of rev) this.drawLabel(ctx, nd);
    if (this.sel === ROOT_ID) { const s = Math.round(LAB_ROOT * z); this.drawBrackets(ctx, Math.round(this.X(0)), Math.round(this.Y(0)), s); }
    this.drawFx(ctx);
    // first-visit hint
    if (this.hintK > 0.01) {
      const txt = 'DRAG TO EXPLORE   SCROLL TO ZOOM   CLICK A GLOWING TILE';
      const tw = measureText(txt, 'normal');
      ctx.globalAlpha = this.hintK;
      const hx = Math.round(v.x + v.w / 2 - tw / 2 - 8 - (this.cardK * (CARD_W + 16)) / 2), hy = v.y + v.h - 26;
      ctx.drawImage(aeroSurface(tw + 16, 16, { top: '#1c4a7c', mid: '#0c2c56', bot: '#06203f', edge: '#9fe6ff', edgeA: 0.6, a: [0.85, 0.88], r: 'pill', gloss: 0.25, glossH: 6, rim: 0.4, glow: 0.3 }), hx, hy);
      drawText(ctx, txt, hx + 8, hy + 4, { color: '#dff9ff' });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // zoom + home controls (bottom left of the view)
    const bx = v.x + 8, by = v.y + v.h - 30, bs = 24;
    this.ctrlRects = [{ x: bx, y: by - (bs + 4) * 2, w: bs, h: bs * 3 + 8 }];
    if (pill(ui, ctx, bx, by - (bs + 4) * 2, bs, bs, '', { tone: 'aqua', icon: getUiIcon('plus'), tip: 'Zoom in (+)' })) { this.zoomBy(1.3); this.used = true; }
    if (pill(ui, ctx, bx, by - (bs + 4), bs, bs, '', { tone: 'aqua', icon: getUiIcon('minus'), tip: 'Zoom out (-)' })) { this.zoomBy(1 / 1.3); this.used = true; }
    if (pill(ui, ctx, bx, by, bs, bs, '', { tone: 'green', icon: getUiIcon('home'), tip: 'Back to the frontier (Home)' })) this.home();
    void dt;
  }

  // ---------------------------------------------------------------- the glossy detail card
  drawCard(ctx, ui) {
    const v = this.view;
    this.cardRect = null; this.btnRect = null; this.btnKind = null;
    if (this.sel) this.cardId = this.sel;
    const id = this.cardId;
    if (!v || !id || this.cardK < 0.03) { this.p.confirmRect = null; return; }
    const g = this.game, st = g.state, t = this.t;
    const k = this.cardK;
    const W = CARD_W, pad = 10, IW = W - pad * 2;
    const isRoot = id === ROOT_ID, nd = isRoot ? null : LAB_BY_ID[id];
    const s = isRoot ? 'root' : this.S[id];
    const hidden = !isRoot && !this.revealed(id);
    const col = isRoot ? '#46c23a' : hidden ? '#1a2638' : branchCol(nd.branch);
    const rows = [];
    const add = (h, fn) => rows.push({ h, fn });
    const text = (str, color = INK_SOFT, max = 4) => {
      const lines = wrapText(str, IW, 'big').slice(0, max);
      add(lines.length * 13 + 4, (x, y) => lines.forEach((l, i) => drawText(ctx, l, x, y + i * 13, { font: 'big', color })));
    };
    const buttons = [];
    let title, sub;
    if (isRoot) {
      const L = ensureLab(st), n = NODES.reduce((a, q) => a + (L.done[q.id] ? 1 : 0), 0);
      const ready = NODES.filter((q) => this.S[q.id] === 'available').length;
      title = 'The Lab'; sub = 'RESEARCH HQ';
      text('Professor Fizz\'s lab. Every discovery grows out from here.');
      add(30, (x, y) => {
        drawText(ctx, 'RESEARCHED', x, y, { color: INK_SOFT });
        drawText(ctx, `${n} / ${TOTAL}`, x + IW - measureText(`${n} / ${TOTAL}`, 'big'), y - 1, { font: 'big', color: INK });
        drawAeroBar(ctx, x, y + 13, IW, 8, n / TOTAL, { color: '#5fd23a' });
      });
      add(18, (x, y) => {
        drawText(ctx, `BENCHES ${labSlots(st, g.stats)}`, x, y + 2, { color: INK_SOFT });
        drawText(ctx, `READY ${ready}`, x + IW - measureText(`READY ${ready}`), y + 2, { color: OK });
      });
      buttons.push({ label: 'Show next', tone: 'aqua', icon: getUiIcon('home'), fn: () => this.home() });
      // [balance] the next main-track upgrade and what it still needs
      const gl = labGoal(st);
      if (gl) {
        const need = labGoalNeed(st, gl);
        text(`Next goal: ${gl.node.name}${gl.status === 'researching' ? ' (brewing)' : need ? '. ' + need : '. Ready!'}`, '#1d6fa8', 4);
        buttons.push({ label: 'Go to goal', tone: 'green', icon: getUiIcon('arrow_r'), fn: () => this.select(gl.id) });
      }
    } else if (hidden) {
      const gt = this.gate(id);
      title = '???'; sub = 'UNDISCOVERED';
      text('Something new waits in the dark.', INK_SOFT);
      if (gt) text((this.S[gt.id] === 'available' ? 'Research ' : 'Finish ') + gt.name + ' to light the way.', '#1d6fa8', 3);
      if (gt) buttons.push({ label: 'Go there', tone: 'aqua', icon: getUiIcon('arrow_r'), fn: () => this.select(gt.id) });
    } else {
      title = nd.name; sub = `${(BRANCHES[nd.branch]?.name || '').toUpperCase()}  TIER ${nd.tier}`;
      text(nd.desc);
      const effects = Object.entries(nd.effect);
      if (effects.length) {
        const per = 1, rH = 17;
        add(Math.ceil(effects.length / per) * rH + 2, (x, y) => effects.forEach(([k2, val], i) => {
          const info = EFFECT_INFO[k2];
          chip(ctx, x, y + i * rH, anyIcon(info?.[0] || 'star', 10), `${info?.[1] || k2} ${fmtEffect(k2, val)}`, { bg: rgba('#effff0', 0.95), edge: rgba('#7ad08a', 0.9), color: '#1d7a32' });
        }));
      }
      const unl = nd.unlock.filter((u) => !(u.kind === 'bait' && nd.unlock.some((x2) => x2.kind === 'recipe' && x2.id === 'bait_' + u.id)));
      if (unl.length) {
        const sz = 22, per = Math.floor((IW + 3) / (sz + 3)), nrow = Math.min(2, Math.ceil(unl.length / per));
        add(14 + nrow * (sz + 3), (x, y) => {
          drawText(ctx, 'UNLOCKS', x, y, { color: INK_SOFT });
          if (unl.length === 1) drawText(ctx, unlockInfo(unl[0]).name.slice(0, 24), x + sz + 6, y + 19, { color: INK });
          unl.slice(0, per * 2).forEach((u, i) => {
            const info = unlockInfo(u), ux = x + (i % per) * (sz + 3), uy = y + 12 + Math.floor(i / per) * (sz + 3);
            ctx.drawImage(aeroSurface(sz, sz, { tone: 'white', r: 5, gloss: 0.6, glossH: 8, curve: 1, rim: 0.8, glow: 0.4 }), ux, uy);
            drawAnimIcon(ctx, info.key, ux + sz / 2, uy + sz / 2, sz - 4, t, i * 1.7, {});
            if (ui.hover({ x: ux, y: uy, w: sz, h: sz })) ui.tip = info.name;
          });
        });
      }
      const c = labCheck(st, nd, g.stats);
      if (s === 'available') {
        const cr = [];
        if (c.aero.need) cr.push({ kind: 'aero', id: 'aero', ...c.aero });
        for (const it of c.items) cr.push({ kind: 'item', ...it });
        for (const fi of c.fish) cr.push({ kind: 'fish', id: fi.key, ...fi });
        add(16 + costTilesHeight(cr.length, IW, 72), (x, y) => {
          divider(ctx, x, y, IW, col);
          drawText(ctx, 'COST', x, y + 5, { color: INK_SOFT });
          const tm = fmtTime(labTime(st, nd, g.stats)), ci = getUiIcon('clock');
          const tw = measureText(tm, 'big');
          drawText(ctx, tm, x + IW - tw, y + 4, { font: 'big', color: INK });
          if (ci) ctx.drawImage(ci, x + IW - tw - ci.width - 3, y + 4);
          costTiles(ctx, ui, cr, x, y + 17, IW, { tileW: 72 });
        });
        const benchFree = c.slots > 0;
        if (!c.gateOk) text(c.gate, BAD, 2); // [balance] boss gate
        else if (!c.paid) text('Need more ingredients.', BAD, 1);
        else if (!benchFree) text('All benches busy: it will queue.', '#6a3ab8', 2);
        buttons.push({ kind: 'research', label: benchFree || !c.paid ? 'Research' : 'Queue it', tone: benchFree || !c.paid ? 'green' : 'purple', icon: getUiIcon(benchFree ? 'check' : 'clock'), disabled: !c.paid || !c.gateOk, sound: 'ui_unlock', tip: 'Start this research (Enter)', fn: () => this.research(id) });
      } else if (s === 'researching') {
        add(30, (x, y) => {
          drawText(ctx, 'BREWING', x, y, { color: '#b8640a' });
          const rem = fmtTime(labRemaining(st, id));
          drawText(ctx, rem + ' left', x + IW - measureText(rem + ' left', 'big'), y - 1, { font: 'big', color: INK });
          drawAeroBar(ctx, x, y + 14, IW, 9, labProgress(st, id), { color: '#5fd23a' });
        });
        const cost = instantCost(st, id);
        buttons.push({ label: `Finish ${fmtAero(cost)}`, tone: 'orange', icon: getUiIcon('aero') || getUiIcon('coin'), disabled: (st.coins || 0) < cost, sound: 'ui_unlock', tip: 'Finish it right now for Aero', fn: () => { if (instantFinish(g, id)) g.audio.play('ui_unlock'); } });
        buttons.push({ label: 'Stop', tone: 'glass', icon: getUiIcon('cross'), tip: 'Stop it (refund)', fn: () => cancelResearch(g, id) });
      } else if (s === 'queued') {
        text(`Queued #${labQueued(st, id)}: it starts when a bench frees up.`, '#6a3ab8', 2);
        buttons.push({ label: 'Unqueue', tone: 'glass', icon: getUiIcon('cross'), tip: 'Take it out of the queue (refund)', fn: () => cancelResearch(g, id) });
      } else if (s === 'done') {
        add(18, (x, y) => { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, x, y + 2); drawText(ctx, 'Researched!', x + 14, y + 1, { font: 'big', color: OK }); });
        const p = this.p;
        if (nd.unlock.some((u) => u.kind === 'rod')) buttons.push({ label: 'Rod rack', tone: 'aqua', icon: icon('rod:glass', 12), fn: () => { p.rodSel = nd.unlock.find((u) => u.kind === 'rod').id; p.setTab('rods'); } });
        else if (nd.unlock.some((u) => u.kind === 'recipe')) buttons.push({ label: 'Craft it', tone: 'aqua', icon: icon('hammer', 12), fn: () => p.openCraft?.(nd.unlock.find((u) => u.kind === 'recipe')?.id) });
        else if (nd.unlock.some((u) => u.kind === 'boat')) buttons.push({ label: 'Boat dock', tone: 'aqua', icon: icon('boat:skiff', 12), fn: () => { p.boatSel = BOAT_ORDER.indexOf(nd.unlock.find((u) => u.kind === 'boat').id); p.setTab('boats'); } });
        else if (nd.unlock.some((u) => u.kind === 'biome')) buttons.push({ label: 'Travel', tone: 'aqua', icon: getUiIcon('map'), fn: () => { g.ui.close(); g.ui.open('map'); } });
      }
      const qq = this.quest?.[id];
      if (qq && s !== 'done') text('Quest: ' + qq.title, '#c86a0a', 2);
      else if (this.goalId === id && s !== 'done') text('Your next big upgrade!', '#1d8a3a', 2); // [balance]
    }
    // ---- measure + place
    const HEAD = 62, BTN = buttons.length ? 34 : 0;
    let H = HEAD + 8 + rows.reduce((a, r) => a + r.h + 4, 0) + BTN + 6;
    H = Math.min(H, v.h - 16);
    const x = Math.round(v.x + v.w - W - 10 + (1 - k) * 30), y = v.y + 10;
    const r = this.cardRect = { x, y, w: W, h: H };
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.fillStyle = 'rgba(2,26,56,0.35)'; ctx.fillRect(x + 4, y + 5, W, H);
    ctx.drawImage(aeroSurface(W, H, { tone: 'frost', r: 8, gloss: 0.35, glossH: 30, curve: 2, rim: 0.9, glow: 0.4, glowColor: '#bfeaff', bubbles: 3, seed: 11 }), x, y);
    ctx.drawImage(aeroSurface(W - 8, HEAD - 4, { tone: hidden ? { top: '#2a3a52', mid: '#121c2c', bot: '#05080e', edge: '#000000', a: [1, 1] } : toneFrom(col), r: 6, gloss: hidden ? 0.25 : 0.75, glossH: 22, curve: 2, rim: 0.85, glow: 0.5, streak: true, seed: 5 }), x + 4, y + 4);
    // [phase9:ui] ornate card: a fine branch-coloured inner trim, corner gems, light behind the hero tile
    {
      const tc = hidden ? '#3c5a7c' : mix(col, '#ffffff', 0.35);
      ctx.fillStyle = tc; ctx.globalAlpha *= 0.7;
      ctx.fillRect(x + 9, y + HEAD + 1.5, W - 18, 0.5);
      ctx.fillRect(x + 3.5, y + 12, 0.5, H - 24); ctx.fillRect(x + W - 4, y + 12, 0.5, H - 24);
      ctx.fillRect(x + 12, y + H - 4, W - 24, 0.5);
      ctx.globalAlpha /= 0.7;
      const cut = isRoot ? 'round' : GEM_CUT[nd?.branch] || 'round';
      for (const [gx, gy] of [[x + 3.5, y + H - 4], [x + W - 4, y + H - 4]]) { const g = gemTex(2.5, hidden ? '#2a3a52' : col, cut, hidden); ctx.drawImage(g, Math.round((gx - g.width / 2) * 2) / 2, Math.round((gy - g.height / 2) * 2) / 2); }
      if (!hidden) drawAeroGlow(ctx, x + 33, y + 31, 34, mix(col, '#ffffff', 0.5), 0.45 + 0.1 * Math.sin(t * 2));
    }
    // hero tile
    const hs = 46, hx = x + 10, hy = y + 8;
    if (hidden) {
      const tl = nodeTile(hs, 'sil', nd?.branch); ctx.drawImage(tl, hx - tl.pad, hy - tl.pad);
      const q = qMark(hs), b = inkBox(q);
      ctx.drawImage(q, Math.round(hx + hs / 2 - q.width / 2), Math.round(hy + hs / 2 - (b.top + b.bot) / 2));
    } else {
      const tl = nodeTile(hs, isRoot ? 'root' : s === 'done' ? 'done' : s === 'researching' || s === 'queued' ? 'brew' : 'open', nd?.branch); ctx.drawImage(tl, hx - tl.pad, hy - tl.pad);
      drawAnimIcon(ctx, isRoot ? 'beaker' : nd.icon, hx + hs / 2, hy + hs / 2, 36, t, this.a(id).ph, { hover: 0.5 });
      this.shine(ctx, hx + hs / 2, hy + hs / 2, hs, 0.7, 3.8);
    }
    // title (Alagard) + subtitle
    const tx = hx + hs + 8, tmax = x + W - 10 - tx;
    const tl = [];
    const full = titleBmp(title, '#ffffff', shade(col, -0.65));
    if (full.width <= tmax) tl.push(full);
    else { const ws = title.split(' '), half = Math.ceil(ws.length / 2); tl.push(titleBmp(ws.slice(0, half).join(' '), '#ffffff', shade(col, -0.65)), titleBmp(ws.slice(half).join(' '), '#ffffff', shade(col, -0.65))); }
    let ty = y + (tl.length > 1 ? 9 : 14);
    for (const b of tl) { ctx.drawImage(b, tx, ty, Math.min(b.width, tmax), b.height); ty += b.height + 1; }
    drawText(ctx, sub, tx, ty + 3, { color: hidden ? '#7f9ab8' : mix(col, '#ffffff', 0.85), shadow: shade(col, -0.7) });
    // tier pips: one little gem per tier in the branch's cut
    if (nd && !hidden) {
      const px0 = tx + measureText(sub) + 6;
      for (let i = 0; i < Math.min(6, nd.tier || 1); i++) drawIcon3D(ctx, 'star', px0 + i * 10 + 3, ty + 4, 11, { t, phase: i * 0.9 }); // [phase9:ui] 3D tier stars
    }
    // body
    ctx.save(); ctx.beginPath(); ctx.rect(x, y + HEAD, W, H - HEAD - BTN - 4); ctx.clip();
    let yy = y + HEAD + 8;
    for (const row of rows) { row.fn(x + pad, yy); yy += row.h + 4; }
    ctx.restore();
    // buttons
    if (buttons.length) {
      const by = y + H - BTN - 2, bw = Math.floor((IW - (buttons.length - 1) * 6) / buttons.length);
      buttons.forEach((B, i) => {
        const bx = x + pad + i * (bw + 6);
        if (B.kind === 'research') { this.btnRect = { x: bx, y: by, w: bw, h: 28 }; this.btnKind = 'research'; }
        if (B.kind === 'research' && !B.disabled && ((t * 0.8) % 1) < 0.3) drawSparkle(ctx, bx + bw - 6, by + 4, 2, 1, '#fff6a0');
        if (pill(ui, ctx, bx, by, bw, 28, B.label, { tone: B.tone, icon: B.icon, disabled: B.disabled, tip: B.tip, sound: B.sound, onDisabled: () => g.toast?.('Missing ingredients!', 'cross') })) B.fn();
      });
    }
    // close x
    if (pill(ui, ctx, x + W - 22, y + 6, 16, 16, '', { tone: 'glass', icon: getUiIcon('cross'), tip: 'Close' })) this.sel = null;
    ctx.restore();
    this.p.confirmRect = this.btnRect;
    if (ui.hover(r)) { ui.markHot?.('labcard'); if (ui.inp.pressed) ui.inp.pressed = false; if (ui.inp.wheel) ui.inp.wheel = 0; }
  }
}
