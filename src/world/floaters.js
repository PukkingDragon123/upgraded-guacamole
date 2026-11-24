// Floating boxes you can fish up (phase 3; replaces fish carrying packages). OWNER: World agent.
//   new Floaters(game); update(dt); draw(ctx, layer /* 'far'|'mid'|'near' */)
//   list: [{id, kind:'crate'|'capsule'|'bottle'|'orb', tier /* build/items.js TIER_ORDER */, x, y, z, hooked:false}]
//   hitHook(wx, wy, r) -> floater|null      world-space test used by fishing
//   take(f)                                 remove it (fishing calls game.onBoxCaught(f) after reeling it in)
//
// Details: (x, y) is the centre of the box in world space, z the depth plane (0 near .. 1 far, same perspective as
// the fish: drawn at scale 1 - z / 2 and fogged toward the biome fog). Layers: 'far' z >= 0.66 (after the biome's
// drawBack), 'mid' 0.33..0.66 (after drawSeabed), 'near' z < 0.33 (after drawNear). Everything is drawn into the
// world layer, so the water shader refracts the submerged half of surface boxes and the darkness pass shades them.
// While f.hooked is true the fishing system owns f.x / f.y (the box stops drifting and just wobbles); f.r is the
// hit radius in world px, f.surface marks boxes bobbing on the waterline. 1-4 boxes per screen; higher tiers are
// rarer and show up deeper (lower in the water column and in the deeper oceans).
// Look: glossy voxel crates (driftwood / chrome / gold), Aero capsules (glass half with goodies inside), message
// bottles in sea glass and swirling glass orbs, all on the shared world camera, with sparkles and a soft halo.
// [crate26] SURPRISE crates (kind 'crate' only, rolled at spawn: f.surprise = 'legs' | 'mimic' | null; ~15 % / ~8 % in the
// (OS)cean, more in later oceans and the deep zones; rollSurprise()). Tells for observant players: a legs crate twitches
// (a hop with leg tips poking out), a mimic lifts its lid a crack now and then and an eye peeks out. Fishing drives the
// show through fields on the floater: f.legs (0..1 legs grown), f.walk (leg phase), f.mimic (lid open 0..1),
// f.chomp (teeth snapping), f.shield (armoured lid), f.flash (zap flash), f.hop (px), f.rollCtl (fishing owns f.roll),
// f.running (escaping across the seabed: legs keep walking). Variant sprites are real voxel models (crab legs in walk
// frames, the lid hinged open with teeth, a tongue and eyes), cached per frame and scale.
//   spawn(o?) o: {kind, tier, surprise, x, y, z, surface} overrides (dev / tests); forceSurprise = 'legs' | 'mimic'
//   crateIcon(f, h) -> canvas  the floater as a small voxel icon (the meter marker)

import { VoxelModel } from '../gfx/voxel.js';
import * as Items from '../build/items.js';
import { RNG } from '../core/rng.js';
import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { mix, shade } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { renderModel, rollModel } from './voxkit.js';
import { CANON_ORDER } from './biomes/index.js';
import { sparkleStar, glassBubble } from './aerokit.js';
import { voxBall } from './voxcritters.js';
import { drawGlow } from './scenery.js';

const TIERS_FALLBACK = ['crate', 'iron', 'golden', 'orb'];
const tierOrder = () => (Array.isArray(Items.TIER_ORDER) && Items.TIER_ORDER.length ? Items.TIER_ORDER : TIERS_FALLBACK);

// Per-tier finish. Unknown tiers (new ones from items.js) borrow by their position in TIER_ORDER.
const FINISH = {
  crate: { body: '#f2d39c', dark: '#c8975a', strap: '#36cff0', strapL: '#bff6ff', mark: '#7ae04a', halo: '#bff6ff', glass: '#9ef0ff', cap: '#ffffff' },
  iron: { body: '#c2d6ea', dark: '#7f98b6', strap: '#3a8cff', strapL: '#a8d4ff', mark: '#ffffff', halo: '#9ad8ff', glass: '#a8ecff', cap: '#9fb8d2' },
  golden: { body: '#ffd24a', dark: '#d8961a', strap: '#ffffff', strapL: '#fff6d0', mark: '#ff5aa8', halo: '#fff0a0', glass: '#fff2b0', cap: '#ffc83a' },
  orb: { body: '#c08aff', dark: '#7a4ad0', strap: '#ff9ae8', strapL: '#ffe0f6', mark: '#ffffff', halo: '#ff9ae8', glass: '#d8b8ff', cap: '#c08aff', core: '#ff8ae0' },
};
const finishOf = (tier) => FINISH[tier] || FINISH[TIERS_FALLBACK[clamp(tierOrder().indexOf(tier), 0, 3)]] || FINISH.crate;
const KINDS = { crate: [['crate', 0.55], ['bottle', 0.45]], iron: [['crate', 0.6], ['capsule', 0.4]], golden: [['capsule', 0.5], ['crate', 0.5]], orb: [['orb', 1]] };
const BASE_W = [70, 22, 6.5, 1.5];
const ROLLS = [-14, -7, 0, 7, 14];
const SCALES = [2, 1.5, 1];

// ------------------------------------------------------------------ voxel models

function crateModel(F) {
  const n = 10, h = 9;
  const m = new VoxelModel(n, h, n);
  const C = (c, o = {}) => m.color(c, { jitter: 0.04, ...o });
  const body = C(F.body, { spec: 0.45, specPow: 14 }), top = C(mix(F.body, '#ffffff', 0.35), { spec: 0.7, specPow: 10 }), gap = C(F.dark);
  const strap = C(F.strap, { spec: 0.85, specPow: 8, smooth: 0.5 }), strapL = C(F.strapL, { spec: 0.9 }), mark = C(F.mark, { spec: 0.6, emissive: 0.2 });
  for (let z = 0; z < n; z++) for (let y = 0; y < h; y++) for (let x = 0; x < n; x++) {
    const ex = x === 0 || x === n - 1, ez = z === 0 || z === n - 1, ey = y === 0 || y === h - 1;
    if ((ex && ez) || (ex && ey) || (ez && ey)) continue; // rounded edges
    let c = y === h - 1 ? top : y % 3 === 2 ? gap : body;
    if (x === 2 || x === n - 3) c = y === h - 1 || y === h - 2 ? strapL : strap;
    m.set(x, y, z, c);
  }
  // emblem on the front face: a little glossy plus
  const fz = n - 1, cx = 5, cy = 4;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(cx + dx - 0.5, cy + dy, fz, mark);
  return m;
}

function capsuleModel(F) {
  const L = 15, R = 3.6;
  const m = new VoxelModel(L, 9, 9);
  const C = (c, o = {}) => m.color(c, { jitter: 0.03, ...o });
  const glass = C(F.glass, { spec: 0.95, specPow: 8, smooth: 0.8, emissive: 0.12 }), glassL = C('#ffffff', { spec: 1, smooth: 0.8 });
  const shell = C(F.cap, { spec: 0.8, specPow: 10, smooth: 0.8 }), band = C(F.strap, { spec: 0.9, smooth: 0.6 });
  const goods = [C('#ffd23a', { spec: 0.7, emissive: 0.3 }), C('#ff6ab4', { spec: 0.7, emissive: 0.3 }), C('#6ae84a', { spec: 0.7, emissive: 0.3 })];
  const cy = 4.5, cz = 4.5;
  for (let x = 0; x < L; x++) {
    const u = x + 0.5;
    const r = u < R ? Math.sqrt(Math.max(0, R * R - (R - u) ** 2)) : u > L - R ? Math.sqrt(Math.max(0, R * R - (u - (L - R)) ** 2)) : R;
    for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) {
      const dy = y + 0.5 - cy, dz = z + 0.5 - cz;
      if (dy * dy + dz * dz > r * r) continue;
      const c = x === 7 ? band : x < 7 ? (dy > 1.6 && dz > 0.5 ? glassL : glass) : shell;
      m.set(x, y, z, c);
    }
  }
  // goodies seen through the glass half (front-most layer)
  m.set(2, 3, 8, goods[0]); m.set(3, 4, 8, goods[1]); m.set(4, 3, 8, goods[2]); m.set(5, 5, 8, goods[0]);
  return m;
}

function bottleModel(F) {
  const L = 17;
  const m = new VoxelModel(L, 8, 8);
  const C = (c, o = {}) => m.color(c, { jitter: 0.03, ...o });
  const tint = F === FINISH.iron ? '#8ad8ff' : '#7ae8c4';
  const glass = C(tint, { spec: 0.95, specPow: 8, smooth: 0.8, emissive: 0.08 }), glassD = C(shade(tint, -0.25), { spec: 0.7, smooth: 0.8 });
  const glassL = C('#f0fffa', { spec: 1, smooth: 0.8 });
  const cork = C('#c8925a', { jitter: 0.08 }), paper = C('#fff4cc', { jitter: 0.04 }), ribbon = C('#ff5a7a', { spec: 0.5 });
  const cy = 3.5, cz = 3.5;
  for (let x = 0; x < L; x++) {
    const r = x < 10 ? 3.3 : x < 12 ? lerp(3.3, 1.6, (x - 9) / 3) : x < 15 ? 1.5 : 1.7;
    for (let y = 0; y < 8; y++) for (let z = 0; z < 8; z++) {
      const dy = y + 0.5 - cy, dz = z + 0.5 - cz;
      if (dy * dy + dz * dz > r * r) continue;
      let c = x >= 15 ? cork : x === 0 ? glassD : dy > 1.4 && dz > -0.5 && x > 1 && x < 10 ? glassL : glass;
      m.set(x, y, z, c);
    }
  }
  // the rolled message seen through the glass
  for (let x = 2; x < 9; x++) { m.set(x, 3, 7, paper); m.set(x, 2, 7, paper); }
  m.set(5, 3, 7, ribbon); m.set(5, 2, 7, ribbon);
  return m;
}

const MODELS = { crate: crateModel, capsule: capsuleModel, bottle: bottleModel };

// ------------------------------------------------------------------ [crate26] surprise crates: legs and mimics
// d: 0 ((OS)cean) .. 1 (the last ocean); deep: extra in the twilight / midnight / abyss zones.
export function rollSurprise(r, d = 0, deep = 0) {
  const legs = 0.13 + 0.07 * d + 0.03 * deep, mimic = 0.06 + 0.06 * d + 0.04 * deep;
  const u = r.float(0, 1);
  return u < mimic ? 'mimic' : u < mimic + legs ? 'legs' : null;
}

const LEG = { c: '#ff7a4a', l: '#ffc09a', d: '#b8402a', tip: '#5a1e14' };
const MOUTH = { flesh: '#c8344a', dark: '#4a0a1a', throat: '#1e0610', tongue: '#ff7aa8', tongueL: '#ffb0cc', tooth: '#fff8ec', eye: '#fff27a', pupil: '#14080a' };
const PX = 5, PB = 5, PT = 11, PZB = 3, PZF = 3; // padding around the 10 x 9 x 10 crate (x, below, above, back, front)

// o: {leg: null | 0..3 (walk frame), grow: 0..1, open: lid angle (deg), eye: bool, shield: bool}
function crateVariantModel(F, o) {
  const n = 10, h = 9, lidY = 6;
  const m = new VoxelModel(n + PX * 2, h + PB + PT, n + PZB + PZF);
  const C = (c, op = {}) => m.color(c, { jitter: 0.04, ...op });
  const sh = !!o.shield;
  const bodyC = sh ? mix(F.body, '#a8c8e8', 0.6) : F.body;
  const body = C(bodyC, { spec: 0.45, specPow: 14 }), top = C(mix(bodyC, '#ffffff', 0.35), { spec: 0.7, specPow: 10 }), gap = C(sh ? '#5a7898' : F.dark);
  const strap = C(sh ? '#9ae8ff' : F.strap, { spec: 0.85, specPow: 8, smooth: 0.5, emissive: sh ? 0.45 : 0 }), strapL = C(sh ? '#e8fbff' : F.strapL, { spec: 0.9, emissive: sh ? 0.3 : 0 });
  const mark = C(F.mark, { spec: 0.6, emissive: 0.2 });
  const flesh = C(MOUTH.flesh, { spec: 0.5, specPow: 8 }), dark = C(MOUTH.dark), throat = C(MOUTH.throat);
  const tongue = C(MOUTH.tongue, { spec: 0.7, specPow: 8, smooth: 0.6 }), tongueL = C(MOUTH.tongueL, { spec: 0.8 });
  const tooth = C(MOUTH.tooth, { spec: 0.9, specPow: 6 }), eye = C(MOUTH.eye, { emissive: 0.8, spec: 0.9 }), pupil = C(MOUTH.pupil);
  const legC = C(LEG.c, { spec: 0.6, specPow: 10 }), legL = C(LEG.l, { spec: 0.7 }), legD = C(LEG.d), legT = C(LEG.tip);
  const ox = PX, oy = PB, oz = PZB;
  const open = Math.max(0, o.open || 0) * Math.PI / 180;
  const crate = (x, y, z) => {
    const ex = x === 0 || x === n - 1, ez = z === 0 || z === n - 1, ey = y === 0 || y === h - 1;
    if ((ex && ez) || (ex && ey) || (ez && ey)) return 0;
    let c = y === h - 1 ? top : y % 3 === 2 ? gap : body;
    if (x === 2 || x === n - 3) c = y === h - 1 || y === h - 2 ? strapL : strap;
    return c;
  };
  const mouthOpen = open > 0.05;
  // the body (and the closed lid)
  for (let z = 0; z < n; z++) for (let y = 0; y < h; y++) for (let x = 0; x < n; x++) {
    if (mouthOpen && y >= lidY) continue;
    let c = crate(x, y, z);
    if (!c) continue;
    if (mouthOpen && y >= 2 && x > 0 && x < n - 1 && z > 0 && z < n - 1) c = y === 2 ? (z > 5 ? flesh : dark) : 0; // the mouth cavity
    m.set(x + ox, y + oy, z + oz, c);
  }
  if (!mouthOpen && o.shield) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(5 + dx - 0.5 + ox, 4 + dy + oy, n - 1 + oz, strapL);
  else if (!mouthOpen) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(5 + dx - 0.5 + ox, 4 + dy + oy, n - 1 + oz, mark);
  if (mouthOpen) {
    // the throat, the rim teeth and the tongue lolling out over the front
    for (let z = 2; z < n - 2; z++) for (let x = 2; x < n - 2; x++) if (z < 4) m.set(x + ox, 2 + oy, z + oz, throat);
    for (let x = 1; x < n - 1; x += 2) { m.set(x + ox, lidY + oy, n - 1 + oz, tooth); m.set(x + ox, lidY + oy, oz, tooth); }
    for (let z = 2; z < n - 2; z += 3) { m.set(ox, lidY + oy, z + oz, tooth); m.set(n - 1 + ox, lidY + oy, z + oz, tooth); }
    for (let z = 3; z < n; z++) for (const x of [4, 5]) m.set(x + ox, 3 + oy, z + oz, z % 3 ? tongue : tongueL);
    for (const x of [4, 5]) { m.set(x + ox, 6 + oy, n - 1 + oz, tongue); m.set(x + ox, 6 + oy, n + oz, tongue); }
    const droop = 1 + Math.round(Math.min(1, open / 1.2) * 3);
    for (let k = 0; k < droop; k++) for (const x of [4, 5]) m.set(x + ox, 5 - k + oy, n + 1 + oz, k === droop - 1 ? tongueL : tongue);
    // the lid, hinged on the back top edge: lid-local (x, dy, dz), dy -1 = teeth / eyes under it
    const lid = (x, dy, dz) => {
      if (x < 0 || x >= n || dz < 0 || dz >= n || dy < -1 || dy > 2) return 0;
      if (dy === -1) {
        if (dz === n - 2 && x > 0 && x < n - 1 && x % 2 === 0) return tooth; // fangs along the front
        if ((x === 2 || x === 3 || x === 6 || x === 7) && dz >= 3 && dz <= 5) return dz === 4 && (x === 3 || x === 6) ? pupil : eye; // big eyes on the underside
        return 0;
      }
      const c = crate(x, dy + lidY, dz);
      if (!c) return 0;
      if (dy === 0 && x > 0 && x < n - 1 && dz > 0 && dz < n - 1) return flesh; // the gums under the lid
      return c;
    };
    const co = Math.cos(open), si = Math.sin(open);
    const yh = lidY + oy, zh = oz;
    for (let tz = 0; tz < m.nz; tz++) for (let ty = yh - 2; ty < m.ny; ty++) for (let tx = ox; tx < ox + n; tx++) {
      const dz1 = tz + 0.5 - zh, dy1 = ty + 0.5 - yh;
      const dz = dz1 * co + dy1 * si, dy = -dz1 * si + dy1 * co;
      const c = lid(tx - ox, Math.floor(dy), Math.floor(dz));
      if (c) m.set(tx, ty, tz, c);
    }
  }
  // the peek: an eye glinting in the gap under a barely lifted lid
  if (o.eye && mouthOpen && open < 0.35) { m.set(4 + ox, 5 + oy, n - 2 + oz, eye); m.set(5 + ox, 5 + oy, n - 2 + oz, eye); m.set(5 + ox, 5 + oy, n - 1 + oz, pupil); }
  // crab legs: three a side, knees up, tips walking
  if (o.leg !== null && o.leg !== undefined) {
    const g = clamp01(o.grow ?? 1);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const z = oz + 2 + i * 3;
      const ax = side < 0 ? ox + 1 : ox + n - 2, ay = oy + 1;
      const ph = (o.leg / 4) * TAU + i * 2.1 + (side > 0 ? Math.PI : 0);
      const lift = Math.max(0, Math.cos(ph)) * 1.6 * g, sw = Math.sin(ph) * 1.4 * g;
      const kx = ax + side * 3.2 * g, ky = ay + 2.4 * g;
      const tx = ax + side * (4.4 + sw) * g, ty = ay - (5 - lift) * g;
      m.line(ax + 0.5, ay + 0.5, z + 0.5, kx + 0.5, ky + 0.5, z + 0.5, legC, 0.75);
      m.line(kx + 0.5, ky + 0.5, z + 0.5, tx + 0.5, ty + 0.5, z + 0.5, legC, 0.6);
      m.set(kx, ky + 1, z, legL);
      m.set(kx, ky, z, legD);
      if (g > 0.5) m.set(tx, ty, z, legT);
    }
  }
  return m;
}

// Variant sprite: {canvas, w, h, ox, oy} anchored on the crate body centre (lines up with the plain crate sprite).
const varCache = new Map();
function variantSprite(tier, o, scale) {
  const key = [tier, o.leg ?? '-', Math.round((o.grow ?? 1) * 3), Math.round(o.open || 0), o.eye ? 1 : 0, o.shield ? 1 : 0, scale].join('|');
  let s = varCache.get(key);
  if (s) return s;
  if (varCache.size > 220) varCache.clear();
  const M = crateVariantModel(finishOf(tier), o);
  const r = renderModel(M, { scale, outline: true, jitter: 0.04, ao: 0.6, edges: 0.6, light: { top: 5.2, lit: 4.3, dark: 2.8, bottom: 2 } });
  const [ax, ay] = r.project(PX + 5, PB + 4.5, PZB + 5);
  s = { canvas: r.canvas, w: r.w, h: r.h, ox: ax, oy: ay };
  varCache.set(key, s);
  return s;
}

// What a floater looks like right now (fishing sets these fields; the tells run in Floaters.update).
function variantOf(f) {
  if (f.kind !== 'crate') return null;
  const legs = f.legs || 0, mim = f.mimic || 0, peek = f.peek || 0;
  if (legs < 0.05 && mim < 0.03 && peek < 0.05 && !f.shield) return null;
  const o = { leg: null, grow: 1, open: 0, eye: false, shield: !!f.shield && mim < 0.03 };
  if (legs >= 0.05) { o.leg = Math.floor(f.walk || 0) & 3; o.grow = legs < 0.4 ? 0.34 : legs < 0.75 ? 0.67 : 1; }
  if (mim >= 0.03) {
    const ang = mim * 95 + (f.chomp ? Math.max(0, Math.sin(f.chomp)) * -40 : 0);
    o.open = [12, 30, 50, 70, 90].reduce((b, v) => (Math.abs(v - ang) < Math.abs(b - ang) ? v : b), 12);
    o.eye = true;
  } else if (peek >= 0.05) { o.open = 12; o.eye = true; }
  return o;
}

// The floater as a small voxel icon of height ~h (the fight meter's marker).
const iconCache = new Map();
export function crateIcon(f, h = 30) {
  const tier = f?.tier || 'crate', kind = f?.kind || 'crate';
  const v = variantOf(f || {});
  const scale = clamp(Math.round((h / 13) * 2) / 2, 1, 4);
  if (v) return variantSprite(tier, v, scale * 0.8).canvas;
  const key = kind + '|' + tier + '|' + scale;
  let c = iconCache.get(key);
  if (!c) { c = boxSprite(kind, tier, 0, scale).canvas; iconCache.set(key, c); }
  return c;
}

// ------------------------------------------------------------------ sprites (lazy, cached)

const cache = new Map();
function boxSprite(kind, tier, roll, scale) {
  const key = kind + '|' + tier + '|' + roll + '|' + scale;
  let s = cache.get(key);
  if (s) return s;
  const F = finishOf(tier);
  if (kind === 'orb') {
    const b = voxBall(Math.max(3, Math.round(6 * scale)), F.body, { emissive: 0.35, spec: 0.95 });
    s = { canvas: b.canvas, ox: b.ox, oy: b.oy, w: b.w, h: b.h };
  } else {
    const M = (cache.get('model|' + kind + '|' + tier) || (() => { const mm = (MODELS[kind] || crateModel)(F); cache.set('model|' + kind + '|' + tier, mm); return mm; })());
    const { model } = rollModel(M, roll, M.nx / 2, M.ny / 2);
    const r = renderModel(model, { scale, outline: true, jitter: 0.04, ao: 0.6, edges: 0.6, light: { top: 5.2, lit: 4.3, dark: 2.8, bottom: 2 } });
    s = { canvas: r.canvas, w: r.w, h: r.h, ox: r.w / 2, oy: r.h / 2 };
  }
  cache.set(key, s);
  return s;
}

// Fogged copies (toward the biome water colour) keyed by sprite + colour + amount.
const fogCache = new Map();
function fogged(spr, color, a) {
  if (a < 0.03) return spr.canvas;
  const q = Math.round(a * 20) / 20;
  let byS = fogCache.get(spr);
  if (!byS) { byS = new Map(); fogCache.set(spr, byS); }
  const key = color + q;
  let c = byS.get(key);
  if (c) return c;
  if (byS.size > 6) byS.clear();
  c = makeCanvas(spr.canvas.width, spr.canvas.height);
  const g = ctxOf(c);
  g.drawImage(spr.canvas, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = q;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  byS.set(key, c);
  return c;
}

// ------------------------------------------------------------------ manager

let nextId = 1;

export class Floaters {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.t = 0;
    this.biomeId = null;
    this.spawnT = 3;
    this.want = 2;
    this.rng = new RNG((Math.random() * 2 ** 31) >>> 0);
  }

  get W() { return this.game.screen?.W || 960; }
  get H() { return this.game.screen?.H || 540; }

  live() {
    const g = this.game, o = g.ocean;
    return !!o?.biome && (!o.travelState || !!o.travelState.live) && (g.state?.view ?? 'ocean') === 'ocean' && !g.mini; // [travel17]
  }

  surfaceY() {
    try { const s = this.game.ocean.waterLevel(); return Number.isFinite(s) ? s : null; } catch { return null; }
  }

  waveAt(x) {
    try { const v = this.game.ocean.waveAt(x); return Number.isFinite(v) ? v : this.surfaceY(); } catch { return this.surfaceY(); }
  }

  floorAt(x, z) {
    try { const v = this.game.ocean.floorAt(x, z); return Number.isFinite(v) ? v : this.H - 40; } catch { return this.H - 40; }
  }

  floorUnder(x, y, z) {
    try { const v = this.game.ocean.floorUnder?.(x, y, z); if (Number.isFinite(v)) return v; } catch { /* older ocean */ }
    return this.floorAt(x, z);
  }

  // surface span the boxes may use (the (OS)cean pier fences off its end)
  span() {
    const W = this.W;
    let lo = 70, hi = W - 40;
    try { const br = this.game.ocean.biome.boatRange?.(W); if (br) { lo = Math.max(lo, br[0] + 20); hi = Math.min(hi, br[1] - 10); } } catch { /* optional */ }
    return [lo, Math.max(lo + 40, hi)];
  }

  // 0 (oscean) .. 1 (abyss)
  depthK() {
    const id = this.game.ocean?.biome?.id;
    const i = CANON_ORDER.indexOf(id);
    return i < 0 ? 0.3 : i / Math.max(1, CANON_ORDER.length - 1);
  }

  pickTier(colDepth, extra = 0) {
    const order = tierOrder();
    const d = this.depthK() + extra, k = clamp01(colDepth); // extra: [phase6:oceans] deeper zones hide better boxes
    const luck = clamp(Number(this.game.stats?.crateLuck) || 0, 0, 3);
    const boost = [0, 1.4 * d + 1.1 * k, 3 * d + 2.2 * k, 6 * d + 3.5 * k];
    const items = order.map((t, i) => [t, (BASE_W[Math.min(i, 3)] ?? 1) * (1 + (boost[Math.min(i, 3)] || 0)) * (i >= 2 ? 1 + luck : 1)]);
    return this.rng.weighted(items, (x) => x[1])[0];
  }

  spawn(o = {}) {
    const r = this.rng, W = this.W, H = this.H;
    const s = this.surfaceY();
    // [phase6:oceans] while the camera is down in a deep zone, boxes drift there (rarer tiers deeper)
    let zone = null, extra = 0;
    try { zone = this.game.ocean?.camZone?.(); } catch { zone = null; }
    const deep = !!zone?.deep;
    const surface = s !== null && s > -40 && r.chance(deep ? 0.08 : 0.55);
    let x, y, z, colDepth;
    if (deep && !surface) {
      const v = this.game.world?.view;
      x = clamp(v ? r.float(v.x0 + 24, v.x1 - 24) : r.float(80, W - 50), 80, W - 50); z = r.float(0.1, 0.75);
      const bot = zone.id === 'abyss' ? (this.game.ocean.deepBottom?.() ?? zone.y1) - 70 : zone.y1 - 30;
      y = r.float(zone.top + 30, Math.max(zone.top + 40, bot));
      colDepth = 1;
      extra = { twilight: 0.3, midnight: 0.7, abyss: 1.3 }[zone.id] || 0;
    } else if (surface) {
      const [lo, hi] = this.span();
      x = r.float(lo, hi); z = r.float(0.04, 0.26); colDepth = 0; y = s;
    } else {
      x = r.float(80, W - 50); z = r.float(0.1, 0.9);
      const top = s === null ? 40 : s + 46;
      const bot = Math.max(top + 20, this.floorAt(x, z) - 34 - (1 - z) * 10);
      colDepth = r.float(0, 1) ** 0.8;
      y = lerp(top, bot, colDepth);
    }
    const tier = this.pickTier(surface ? 0 : colDepth, extra);
    const kinds = KINDS[tier] || KINDS[TIERS_FALLBACK[clamp(tierOrder().indexOf(tier), 0, 3)]] || KINDS.crate;
    let kind = r.weighted(kinds, (k) => k[1])[0];
    if (kind === 'bottle' && !surface && r.chance(0.5)) kind = 'crate';
    // [crate26] dev / test overrides
    if (o.kind) kind = o.kind;
    const tierO = o.tier || tier;
    const surp = kind === 'crate' ? (o.surprise !== undefined ? o.surprise : this.forceSurprise || rollSurprise(r, this.depthK(), extra)) : null;
    const f = {
      id: nextId++, kind, tier, x, y, z, hooked: false, surface, y0: y, vx: r.float(3, 8) * r.sign(), ph: r.float(0, TAU),
      age: 0, fade: 0, out: false, life: r.float(140, 240), r: kind === 'orb' ? 8 : 10, roll: 0, rollV: 0, sparkT: r.float(0.5, 2),
      rise: surface ? 14 : 0, sx: 0,
      surprise: surp, legs: 0, walk: 0, mimic: 0, peek: 0, hop: 0, flash: 0, tellT: r.float(2, 5), // [crate26]
    };
    f.tier = tierO;
    if (Number.isFinite(o.x)) f.x = o.x;
    if (Number.isFinite(o.y)) { f.y = f.y0 = o.y; f.surface = !!o.surface; f.rise = 0; }
    if (Number.isFinite(o.z)) f.z = o.z;
    f.r *= 1 - z * 0.5;
    this.list.push(f);
    return f;
  }

  reset() {
    this.list = [];
    this.biomeId = this.game.ocean?.biome?.id ?? null;
    this.want = this.rng.weighted([[1, 2], [2, 4], [3, 3], [4, 1.5]], (x) => x[1])[0];
    this.spawnT = this.rng.float(1.5, 4);
  }

  update(dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    this.t += dt;
    const o = this.game.ocean;
    if (!o?.biome) return;
    if (o.biome.id !== this.biomeId && (!o.travelState || o.travelState.live)) this.reset(); // [travel17]
    if (!this.live()) return;
    const W = this.W, s = this.surfaceY(), boat = this.game.boat;
    const [lo, hi] = this.span();
    // keep 1-4 on screen
    this.spawnT -= dt;
    const v = this.game.world?.view, cy = v ? (v.y0 + v.y1) / 2 : 0;
    const active = this.list.filter((f) => !f.out && (!v || f.surface || Math.abs(f.y - cy) < 360)).length; // [phase6:oceans] per depth
    if (this.spawnT <= 0) {
      if (active < this.want) this.spawn();
      this.spawnT = active + 1 < this.want ? this.rng.float(1.5, 4) : this.rng.float(7, 16);
    }
    let w = 0;
    for (const f of this.list) {
      f.age += dt;
      f.flash = Math.max(0, (f.flash || 0) - dt * 4); // [crate26]
      if (f.hooked) { f.fade = 1; f.out = false; if (!f.rollCtl) f.roll = Math.sin(this.t * 6 + f.ph) * 9; this.list[w++] = f; continue; }
      if (f.running && f.legs > 0) f.walk = (f.walk || 0) + dt * 14; // [crate26] an escaped legs crate keeps scuttling
      if (f.surprise && !f.running) this.tell(f, dt);
      f.fade = f.out ? f.fade - dt * 0.6 : Math.min(1, f.fade + dt * 0.8);
      if (f.out && f.fade <= 0) continue;
      if (f.age > f.life) f.out = true;
      f.x += f.vx * dt;
      if (f.surface) {
        if (s === null) { f.surface = false; f.y0 = f.y + 40; }
        else {
          if (f.x < lo) f.vx = Math.abs(f.vx);
          if (f.x > hi) f.vx = -Math.abs(f.vx);
          // nudge away from the boat
          if (boat && Number.isFinite(boat.x) && Math.abs(f.x - boat.x) < 46) f.x += Math.sign(f.x - boat.x || 1) * dt * 30;
          const wl = this.waveAt(f.x) ?? s;
          const sl = ((this.waveAt(f.x + 6) ?? wl) - (this.waveAt(f.x - 6) ?? wl)) / 12;
          f.rise = Math.max(0, f.rise - dt * 9);
          // [phase5:water] a bobbing box laps the water: a nudge on the surface sim and a soft ring now and then
          f.lapT = (f.lapT ?? this.rng.float(0, 1.4)) - dt;
          if (f.lapT <= 0) {
            f.lapT = this.rng.float(1, 2.2);
            const ws = this.game.water?.sim;
            ws?.impulse?.(f.x, -5 - (f.big ? 4 : 0), 6);
            ws?.ring?.(f.x, 0.2 + this.rng.float(0, 0.12), 0.35, { speed: 8, life: 1.4, r0: 5 });
          }
          f.y = wl + 1 + f.rise + Math.sin(this.t * 1.9 + f.ph) * 1.2;
          const tr = clamp(Math.atan(sl) * 57 + Math.sin(this.t * 1.3 + f.ph) * 5, -16, 16);
          f.rollV += ((tr - f.roll) * 30 - f.rollV * 6) * dt;
          f.roll += f.rollV * dt;
        }
      } else {
        if (f.running) { f.y = f.y0 - Math.abs(Math.sin(this.t * 16 + f.ph)) * 3; f.roll = Math.sin(this.t * 30) * 4; } // [crate26] scuttling off
        else {
          f.y = f.y0 + Math.sin(this.t * 0.45 + f.ph) * 5 - (f.out ? (1 - f.fade) * 10 : 0);
          f.roll = Math.sin(this.t * 0.7 + f.ph) * 8;
          const fl = this.floorUnder(f.x, f.y0, f.z) - 24; // [phase6:oceans] the floor under the box (shelf or abyss)
          if (f.y > fl) f.y0 -= f.y - fl;
        }
        if (s !== null && f.y < s + 30) f.y0 += s + 30 - f.y;
        if (f.x < -40 || f.x > W + 40) { f.out = true; f.fade = 0; }
      }
      f.sparkT -= dt;
      if (f.sparkT <= 0) { f.sparkT = this.rng.float(1.2, 3.2) / (1 + tierOrder().indexOf(f.tier) * 0.5); f.sx = this.rng.float(-0.5, 0.3); f.sy = this.rng.float(-0.6, 0); f.sk = 0; }
      if (f.sk !== undefined) f.sk += dt;
      this.list[w++] = f;
    }
    this.list.length = w;
  }

  draw(ctx, layer = 'near') {
    if (!this.list.length || !this.live()) return;
    const z0 = layer === 'far' ? 0.66 : layer === 'mid' ? 0.33 : -1, z1 = layer === 'far' ? 9 : layer === 'mid' ? 0.66 : 0.33;
    const b = this.game.ocean.biome;
    const fogC = b.fogColor || '#2a7aa0', fogK = b.fogAmount ?? 0.75;
    const a0 = ctx.globalAlpha, op0 = ctx.globalCompositeOperation;
    const ti = (f) => tierOrder().indexOf(f.tier);
    for (const f of this.list) {
      if (f.z < z0 || f.z >= z1) continue;
      const k = 1 - f.z * 0.5;
      const si = k > 0.86 ? 0 : k > 0.68 ? 1 : 2;
      const ri = f.kind === 'orb' ? 2 : ROLLS.reduce((bi, r, i) => (Math.abs(r - f.roll) < Math.abs(ROLLS[bi] - f.roll) ? i : bi), 0);
      const vo = variantOf(f); // [crate26] legs / mimic / shield / peek (f.size: a revealed mimic swells up)
      const spr = vo ? variantSprite(f.tier, vo, Math.max(1, Math.round(SCALES[si] * (f.size || 1) * 2) / 2)) : boxSprite(f.kind, f.tier, ROLLS[ri], SCALES[si]);
      const img = fogged(spr, fogC, Math.min(0.8, f.z * fogK));
      const x = Math.round(f.x - spr.ox), y = Math.round(f.y - spr.oy - (f.hop || 0));
      const a = a0 * clamp01(f.fade);
      const rank = ti(f);
      // soft halo for the rarer tiers
      if (rank >= 1) drawGlow(ctx, f.x, f.y, Math.round(spr.w * (0.55 + rank * 0.12)), finishOf(f.tier).halo, a * (0.12 + rank * 0.1) * (0.8 + 0.2 * Math.sin(this.t * 2 + f.ph)));
      ctx.globalAlpha = a;
      ctx.drawImage(img, x, y);
      if (f.flash > 0.02 && Math.floor(this.t * 24) % 2 === 0) { // [crate26] zapped: a white-hot flicker
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * Math.min(1, f.flash) * 0.7;
        ctx.drawImage(img, x, y);
        ctx.globalCompositeOperation = op0;
        ctx.globalAlpha = a;
      }
      // waterline ring + a few bubbles under surface boxes
      if (f.surface && !f.hooked) {
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = '#ffffff';
        const wl = Math.round(f.y + 1), hw = Math.round(spr.w * 0.62);
        ctx.fillRect(Math.round(f.x - hw), wl, 2, 1); ctx.fillRect(Math.round(f.x + hw - 2), wl, 2, 1);
        const bt = (this.t * 0.8 + f.ph) % 1;
        const bb = glassBubble(1, '#e0fbff');
        ctx.globalAlpha = a * (1 - bt);
        ctx.drawImage(bb, Math.round(f.x + Math.sin(f.ph * 3) * 4) - 2, Math.round(f.y + 10 - bt * 8) - 2);
      }
      // sparkle
      if (f.sk !== undefined && f.sk < 0.6) {
        const kk = Math.sin((f.sk / 0.6) * Math.PI);
        const st = sparkleStar(rank >= 2 ? 4 : 3, rank >= 2 ? '#fff6c8' : '#ffffff');
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * kk * 0.95;
        ctx.drawImage(st, Math.round(f.x + f.sx * spr.w) - (st.width >> 1), Math.round(f.y + f.sy * spr.h) - (st.height >> 1));
        ctx.globalCompositeOperation = op0;
      }
    }
    ctx.globalAlpha = a0;
    ctx.globalCompositeOperation = op0;
  }

  // [crate26] the tells: a legs crate twitches (a hop, leg tips poke out), a mimic lifts its lid a crack and an eye peeks.
  tell(f, dt) {
    f.tellT -= dt;
    const tt = f.tellK;
    if (tt !== undefined) {
      f.tellK += dt;
      const k = f.tellK;
      if (f.surprise === 'legs') {
        f.hop = k < 0.35 ? Math.sin((k / 0.35) * Math.PI) * 3 : 0;
        f.legs = k < 0.5 ? 0.3 : 0;
        f.walk = (f.walk || 0) + dt * 18;
        if (k > 0.5) { f.tellK = undefined; f.hop = 0; f.legs = 0; }
      } else {
        f.peek = k < 1.1 ? 1 : 0;
        if (k > 1.1) { f.tellK = undefined; f.peek = 0; }
      }
      return;
    }
    if (f.tellT <= 0 && f.fade > 0.9) {
      f.tellT = f.surprise === 'legs' ? this.rng.float(2.5, 5.5) : this.rng.float(3.5, 7);
      f.tellK = 0;
      if (f.surprise === 'mimic' && this.rng.chance(0.5)) { try { this.game.particles?.aeroBubbles?.(f.x + 2, f.y - 6, 1, { w: 2 }); } catch { /* cosmetic */ } }
    }
  }

  // [crate26] dev preview of a surprise-crate sprite: o as crateVariantModel ({leg, grow, open, eye, shield})
  preview(tier, o, scale = 2) { return variantSprite(tier, o, scale); }

  // Nearest catchable box whose body is within r of the world point.
  hitHook(wx, wy, r = 8) {
    let best = null, bd = Infinity;
    for (const f of this.list) {
      if (f.hooked || f.out || f.fade < 0.5) continue;
      const d = Math.hypot(f.x - wx, f.y - wy) - f.r;
      if (d <= r && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  take(f) {
    this.list = this.list.filter((q) => q !== f);
    if (f && Number.isFinite(f.x)) {
      try {
        const p = this.game.particles;
        p?.glints?.(f.x, f.y, 5, { color: finishOf(f.tier).halo });
        p?.aeroBubbles?.(f.x, f.y, 5);
      } catch { /* cosmetic */ }
    }
    this.spawnT = Math.min(this.spawnT, this.rng.float(4, 9));
  }
}
