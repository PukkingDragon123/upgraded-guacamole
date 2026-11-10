// Bait art (phase 3, OWNER: Online & AppSea agent): the hook sprite plus glossy VOXEL bait.
//   HOOK                         hand-authored hook sprite (used by fishing + tutorial)
//   TYPE_ART[type] = [c1, c2]    app-bait colours per species bait-pref type
//   baitVoxel(art, scale)        cached detailed voxel render {canvas, glow, w, h} (~18 * scale px)
//   baitMini(art)                ~16 px sprite (fine `.hi` twin) for screen-space effects / legacy callers
//   baitIcon(art, px, ph)        sprite fitting ~px: the detailed model (fine `.hi` twin, wriggling creatures at
//                                px >= 40) or, below 22 px, the chunky toy-block icon of the same model
//   baitHook(art, t)             the animated bait on the hook at 2x world resolution {canvas, glow, w, h}
//   drawBaitGloss(ctx, art, cx, cy, px, t, {bubble, aura, bob})  sprite in a glass bubble with scent aura
//   baitSprite(typeOrArt, t)     legacy entry: a bait type/id string or an art object -> mini sprite
// Models: src/fishing/baitmodels.js (one hand-crafted detailed voxel model per bait; flavour lines by art.line).
// Art spec: {shape: 'grub'|'crumbs'|'bread'|'worm'|'sugar'|'chip'|'popup'|'flood'|'lantern'|'golden'|'blackhole'|'relic',
//   line (flavour line id for 'grub'), color, color2 (creature colours / custom tint), tier (0..4 app tier: glitter, glow), charm (star|heart|gem|clover|crown),
//   scale (custom size 0.8..1.25), scent (aura colour), type}

import { spriteFromAscii } from '../gfx/pixel.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { BAIT_MODELS, modelFor, modelKind } from './baitmodels.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { mix, rgba } from '../core/color.js';
import { TAU } from '../core/math.js';
import { HI, withHi, fitHi } from '../gfx/hires.js'; // [phase10:ui]
import { voxelModelFrame } from '../gfx/bigicons.js'; // [phase10:ui]
import { lpAvailable } from '../gfx/lowpoly.js';

const P = {
  k: '#14131c', d: '#5d6677', m: '#9aa6b8', l: '#d8e2ee', w: '#ffffff',
};

export const HOOK = spriteFromAscii(`
..kkk..
.kmlmk.
.kk.kk.
..kmk..
..kmk..
..kmk..
..kmk..
k.kmk..
kmkmk..
kmlmk..
.kmmk..
..kk...
`, P);

export const TYPE_ART = {
  docs: ['#ffd84a', '#fff6c8'], folder: ['#f0b850', '#ffe7a8'], calc: ['#8a9ab8', '#ff9a3a'], calendar: ['#ff5a62', '#ffffff'],
  music: ['#ff6ac8', '#9a6aff'], image: ['#4ac8ff', '#7ae05a'], video: ['#ff4a5a', '#3a3a52'], paint: ['#ff8a3a', '#4ac8ff'],
  game: ['#8a5aff', '#5affa8'], chat: ['#4ad0ff', '#ffffff'], mail: ['#3a8aff', '#ffffff'], browser: ['#2a9aff', '#6ad06a'],
  terminal: ['#24343a', '#5aff8a'], settings: ['#9aa8b8', '#e8f0f8'], computer: ['#3ab85a', '#ffd84a'], trash: ['#6ad84a', '#ff5a5a'],
};
const SPECIAL_SHAPES = new Set(['crumbs', 'bread', 'worm', 'sugar', 'chip', 'popup', 'flood', 'lantern', 'golden', 'blackhole', 'relic']);

// ---------------------------------------------------------------- models (src/fishing/baitmodels.js)
// Every bait is a hand-crafted, highly detailed voxel model. Big views render it large (1x canvas + a lazily built
// `.hi` twin for the 2x UI layer); small hotbar icons (< TOY_PX) use the toy-block voxel icon of the same model.
const TOY_PX = 22;

function charm(m, kind, ox, oy, z = 10, k = 2) {
  const put = (x, y, c, dz = 0) => m.box(ox + x * k, oy + y * k, z + dz * k, ox + x * k + k - 1, oy + y * k + k - 1, z + dz * k + k - 1, c);
  if (kind === 'star') {
    const c = m.color('#ffd23a', { emissive: 0.5, spec: 1, specPow: 4 }), d = m.color('#e8961a', { spec: 0.8 });
    for (const [x, y] of [[2, 4], [1, 3], [2, 3], [3, 3], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 1], [2, 1], [3, 1], [1, 0], [3, 0]]) put(x, y, y === 2 && (x === 0 || x === 4) ? d : c);
  } else if (kind === 'heart') {
    const c = m.color('#ff4a7a', { spec: 1, specPow: 6, smooth: 0.6 }), h = m.color('#ffb0c8', { spec: 1, emissive: 0.3 });
    for (const [x, y] of [[0, 3], [1, 3], [3, 3], [4, 3], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 1], [2, 1], [3, 1], [2, 0]]) put(x, y, c);
    put(1, 3, h, 1);
  } else if (kind === 'gem') {
    const c = m.color('#6af0ff', { emissive: 0.4, spec: 1, specPow: 4 }), d = m.color('#2ab8e0', { spec: 1, specPow: 4 }), w = m.color('#ffffff', { emissive: 0.6 });
    for (const [x, y] of [[1, 3], [2, 3], [3, 3], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 1], [2, 1], [3, 1], [2, 0]]) put(x, y, y < 2 ? d : c);
    put(1, 2, w, 1);
  } else if (kind === 'clover') {
    const c = m.color('#4ad85a', { spec: 0.8, smooth: 0.5 }), d = m.color('#2a9a3a'), s = m.color('#2a7a2a');
    for (const [x, y] of [[0, 3], [1, 3], [3, 3], [4, 3], [0, 4], [1, 4], [3, 4], [4, 4], [0, 1], [1, 1], [3, 1], [4, 1], [0, 0], [1, 0], [3, 0], [4, 0], [2, 2]]) put(x, y + 1, (x + y) % 3 ? c : d);
    put(2, 0, s); put(2, 1, s);
  } else if (kind === 'crown') {
    const c = m.color('#ffc83a', { spec: 1, specPow: 5, emissive: 0.3 }), d = m.color('#d8901a', { spec: 1 }), j = m.color('#ff4a6a', { emissive: 0.5, spec: 1 });
    for (let x = 0; x <= 4; x++) { put(x, 0, d); put(x, 1, c); }
    for (const x of [0, 2, 4]) put(x, 2, c);
    put(2, 1, j, 1);
  }
}

// art -> VoxelModel (at animation phase ph): the bait's own model, an optional custom tint and charm
function buildModel(a, ph = 0) {
  if (a.shape === 'charm') {
    const m = new VoxelModel(12, 14, 6);
    charm(m, a.charm, 1, 1, 2, 2);
    return m;
  }
  const hasCharm = a.charm && a.charm !== 'none';
  const { model: m, kind } = modelFor(a, ph, hasCharm ? 12 : 0);
  // custom tint on special bait: recolour the main voxels toward the chosen colour (keeps glowing accents);
  // flavour creatures already take their colours from art.color
  if (a.custom && a.color && a.shape !== 'grub' && kind !== 'grub') {
    const tint = new Map();
    m.recolor((x, y, z, c) => {
      const pe = m.palette[c];
      if (!pe || pe.emissive >= 0.8) return c;
      let t = tint.get(c);
      if (t === undefined) { t = m.color(mix(pe.color, a.color, 0.4), { ...pe }); tint.set(c, t); }
      return t;
    });
  }
  if (hasCharm) {
    const b = m.bounds();
    charm(m, a.charm, Math.max(0, Math.min(m.nx - 11, (b?.x1 ?? 20) - 8)), Math.min(m.ny - 11, (b?.y1 ?? 10) + 1), Math.round(m.nz / 2));
  }
  return m;
}

function artKey(a) {
  return [a.shape, a.line || '', a.color, a.color2, a.tier, a.charm, a.custom ? 1 : 0].join('|');
}

// models per (art, phase), reused for every size
const MCACHE = new Map();
function modelOf(a, ph) {
  const k = artKey(a) + '@' + ph;
  let m = MCACHE.get(k);
  if (!m) {
    m = buildModel(a, ph);
    MCACHE.set(k, m);
    if (MCACHE.size > 72) MCACHE.delete(MCACHE.keys().next().value);
  }
  return m;
}

function viewOf(a) {
  const d = BAIT_MODELS[modelKind(a)] || BAIT_MODELS.grub;
  return { yaw: d.yaw, pitch: d.pitch, anim: d.anim };
}

// projected extent of a model at scale 1 (the same projection renderVoxels uses)
function extentOf(m, yaw, pitch) {
  const b = m.bounds();
  if (!b) return 1;
  const Y = yaw * Math.PI / 180, Pt = pitch * Math.PI / 180;
  const cy = Math.cos(Y), sy = Math.sin(Y), cp = Math.cos(Pt), sp = Math.sin(Pt);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const px = i & 1 ? b.x1 + 1 : b.x0, py = i & 2 ? b.y1 + 1 : b.y0, pz = i & 4 ? b.z1 + 1 : b.z0;
    const X = px * cy - pz * sy;
    const Yp = -(px * -sp * sy + py * cp + pz * -sp * cy);
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Yp); y1 = Math.max(y1, Yp);
  }
  return Math.max(x1 - x0, y1 - y0, 1);
}

// thicker dark outline for the fine 2x render (matches the chunky toy-block icon outlines)
function thicken(c) {
  const w = c.width, h = c.height;
  const out = makeCanvas(w + 2, h + 2), g = ctxOf(out);
  g.drawImage(c, 1, 1);
  const id = g.getImageData(0, 0, w + 2, h + 2), d = id.data, src = d.slice();
  for (let y = 0; y < h + 2; y++) for (let x = 0; x < w + 2; x++) {
    const i = (y * (w + 2) + x) * 4;
    if (src[i + 3] > 40) continue;
    let n = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w + 2 || yy >= h + 2) continue;
      const j = (yy * (w + 2) + xx) * 4;
      if (src[j + 3] > 200 && src[j] + src[j + 1] + src[j + 2] < 150) { n = true; break; }
    }
    if (n) { d[i] = 20; d[i + 1] = 12; d[i + 2] = 34; d[i + 3] = 255; }
  }
  g.putImageData(id, 0, 0);
  return out;
}

// render budget: new 2x twins wait for a later frame once ~6 ms of renders were spent this frame
let bWin = 0, bSpent = 0;
function budget() { const n = performance.now(); if (n - bWin > 16) { bWin = n; bSpent = 0; } return bSpent < 6; }
function spend(t0) { bSpent += performance.now() - t0; }

function renderFit(a, px, ph = 0, o = {}) {
  const m = modelOf(a, ph);
  const v = viewOf(a);
  const s = (px / extentOf(m, v.yaw, v.pitch)) * (a.scale || 1);
  const ro = { scale: s, yaw: v.yaw, pitch: v.pitch, outline: true, groundAO: false, glowRadius: o.glowR ?? 2 };
  const r = renderVoxels(m, ro);
  const out = { canvas: r.canvas, glow: r.glow, w: r.w || r.canvas.width, h: r.h || r.canvas.height };
  if (o.hi !== false) {
    const lazy = (pick) => () => {
      if (!budget()) return undefined;
      const t0 = performance.now();
      let big = null;
      try {
        const r2 = renderVoxels(modelOf(a, ph), { ...ro, scale: s * HI, glowRadius: (ro.glowRadius || 2) * HI });
        big = pick === 'glow' ? (r2.glow ? fitHi(r.glow, r2.glow, r.ox, r.oy, r2.ox, r2.oy) : null) : fitHi(r.canvas, thicken(r2.canvas), r.ox, r.oy, r2.ox + 1, r2.oy + 1);
      } catch (e) { big = null; }
      spend(t0);
      return big;
    };
    withHi(out.canvas, lazy('main'));
    if (out.glow) withHi(out.glow, lazy('glow'));
  }
  return out;
}

const VCACHE = new Map();
function cached(key, make) {
  let r = VCACHE.get(key);
  if (r) return r;
  const t0 = performance.now();
  try { r = make(); } catch (e) {
    console.error('bait art', e);
    const c = makeCanvas(6, 6), g = ctxOf(c);
    g.fillStyle = '#ffd84a'; g.fillRect(1, 1, 4, 4);
    r = { canvas: c, glow: null, w: 6, h: 6 };
  }
  spend(t0);
  VCACHE.set(key, r);
  if (VCACHE.size > 400) VCACHE.delete(VCACHE.keys().next().value);
  return r;
}

// Detailed render fitting ~px logical pixels (scale = voxel px), kept for older callers.
export function baitVoxel(art, scale = 2) {
  const a = art || { shape: 'crumbs' };
  return cached('v|' + artKey(a) + '|' + scale, () => renderFit(a, 18 * scale));
}

// Small sprite (<= 16 px wide, with a fine `.hi` twin) for screen-space effects and legacy callers.
export function baitMini(art) {
  const a = art || { shape: 'crumbs' };
  return cached('mini|' + artKey(a), () => renderFit(a, 16)).canvas;
}

// Inventory / shop sprite that fits roughly `px`. ph (0..1) animates creature bait in big views.
export function baitIcon(art, px = 28, ph = 0) {
  const a = art || { shape: 'crumbs' };
  if (px < TOY_PX && a.shape !== 'charm' && lpAvailable()) {
    // [phase10:ui] chunky toy-block voxel bait (same style as every small UI icon), built from the same model
    let f = null;
    try { f = voxelModelFrame('bait:' + artKey(a), () => buildModel(a, 0), Math.round(px * 1.15 * (a.scale || 1)), 0, true); } catch { f = null; }
    if (f) return { canvas: f.canvas, glow: null, w: f.canvas.width, h: f.canvas.height };
  }
  const q = Math.max(8, Math.round(px / 2) * 2);
  const frames = viewOf(a).anim && q >= 40 ? 6 : 1;
  const fi = frames > 1 ? Math.floor((((ph % 1) + 1) % 1) * frames) : 0;
  return cached('i|' + artKey(a) + '|' + q + '|' + fi, () => renderFit(a, q, fi / Math.max(1, frames)));
}

// The bait on the hook, rendered at twice the world resolution (draw it at half size under the zoomed camera);
// creature bait wriggles through 8 frames. -> {canvas, w, h} with w / h in world units.
export function baitHook(art, t = 0) {
  const a = art || { shape: 'crumbs' };
  const frames = viewOf(a).anim ? 8 : 1;
  const fi = frames > 1 ? Math.floor((((t / 1.1) % 1) + 1) % 1 * frames) : 0;
  return cached('hook|' + artKey(a) + '|' + fi, () => {
    const r = renderFit(a, 40, fi / frames, { hi: false, glowR: 2 });
    return { canvas: r.canvas, glow: r.glow, w: r.w / 2, h: r.h / 2 };
  });
}

// A bait floating in a glossy glass bubble, with a scent aura and sparkles.
export function drawBaitGloss(ctx, art, cx, cy, px, t = 0, o = {}) {
  const a = art || { shape: 'crumbs' };
  const r = px / 2;
  ctx.save();
  if (o.bubble !== false) {
    // bright glass tinted by the bait's own colour, a white rim and a reflected light along the bottom
    const tint = o.tint || (a.color ? mix(a.color, '#ffffff', 0.62) : '#c8f4ff');
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.5, rgba(tint, 0.42));
    g.addColorStop(1, rgba(o.rim || '#2fb8e0', 0.55));
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1; ctx.stroke();
    if (r >= 8) { ctx.beginPath(); ctx.arc(cx, cy, r - 2, Math.PI * 0.2, Math.PI * 0.8); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke(); }
  }
  const aura = o.aura ?? a.scent;
  if (aura && aura !== '#ffffff') {
    for (let i = 0; i < 6; i++) {
      const ang = t * 1.4 + (i / 6) * TAU, rr = r * (0.62 + 0.12 * Math.sin(t * 3 + i));
      ctx.fillStyle = rgba(aura, 0.55);
      const s = i % 2 ? 2 : 1;
      ctx.fillRect(Math.round(cx + Math.cos(ang) * rr) - (s >> 1), Math.round(cy + Math.sin(ang) * rr * 0.8) - (s >> 1), s, s);
    }
  }
  const spr = baitIcon(a, px * (o.bubble === false ? 0.9 : 0.8), o.anim === false ? 0 : t * 0.7);
  const bob = o.bob === false ? 0 : Math.round(Math.sin(t * 2.2) * 1.2);
  const x = Math.round(cx - spr.w / 2), y = Math.round(cy - spr.h / 2 + bob);
  if (spr.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(spr.glow, x, y); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  ctx.drawImage(spr.canvas, x, y);
  if (o.bubble !== false) {
    ctx.beginPath(); ctx.ellipse(cx - r * 0.28, cy - r * 0.52, r * 0.42, r * 0.18, -0.35, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
  }
  if ((a.tier | 0) >= 3 || a.shape === 'golden' || a.charm === 'star') {
    const k = (t * 1.7) % 1;
    const sx = Math.round(cx + r * 0.45 * Math.cos(t * 0.9)), sy = Math.round(cy - r * 0.4 + r * 0.2 * Math.sin(t * 1.3));
    ctx.fillStyle = `rgba(255,255,240,${(1 - k).toFixed(2)})`;
    ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3);
  }
  ctx.restore();
}

// Legacy: fishing / bait effects call baitSprite(bait.type, t). Accepts an art spec, a special id or a type key.
export function baitSprite(type, t = 0) {
  if (type && typeof type === 'object') return baitMini(type);
  if (SPECIAL_SHAPES.has(type)) return baitMini({ shape: type });
  const c = TYPE_ART[type];
  if (c) return baitMini({ shape: 'grub', color: c[0], color2: c[1] });
  return baitMini({ shape: 'crumbs' });
}
export const BAIT_SPRITES = {};
