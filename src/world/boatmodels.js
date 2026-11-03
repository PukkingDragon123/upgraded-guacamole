// Voxel boats (phase 3, Frutiger Aero; OWNER: Character agent). Glossy white + aqua eco-tech boats, one per Lab tier
// (ids match lab.js BOAT_ORDER, state.boat.tier = index):
//   0 raft       Bubble Raft     glossy pontoon floats, bamboo deck, leaf sail, bubble lamp
//   1 dinghy     Bubble Dinghy   inflatable white tube collar, little outboard, bow lamp
//   2 skiff      Aero Skiff      sleek glossy runabout, curved glass windshield, chrome rail
//   3 hydrofoil  Hydrofoil       hull lifted on chrome struts and aqua foils, glass canopy, wing
//   4 yacht      Glass Yacht     wraparound glass decks, solar roof, planters, radar dome
//   5 catamaran  Eco Catamaran   twin hulls, two SPINNING wind turbines, solar cabin, leaf sail
//   6 submarine  Bubble Sub      surfaced sub with a glass bubble dome cockpit, glowing portholes, bubble jets
//
// Parts (state.boat = {tier, parts: {hull, sail, flag, engine, decal}}, ids from BOAT_PARTS[slot][i].id; missing or
// unknown ids fall back to the tier default): hull paint (+ trim), sail (masted tiers), flag, engine (outboard /
// turbine / solar / bubble jet / paddle wheel) and hull decal.
//
// API
//   BOAT_TIERS[i] = {id, name, desc, build}                     (BOAT_TIERS.length = 7)
//   BOAT_PARTS = {hull:[{id,name,color,trim,rarity}], sail:[...], flag:[...], engine:[...], decal:[...]}, BOAT_PART_SLOTS
//   buildBoatModel(tier, paint, trim = '#ffffff', parts = null) -> T   (paint/trim are overridden by parts.hull when set)
//     T = {m, front: Set<palette idx drawn over the character>, night: Map<idx, hex>, wl, zc, pivot:[x, y],
//          A: {stand, flag, bow, stern, top, keel, lantern?, mast?, cabin?, sub?, under?, turbine0.., bubbles0..},
//          lights: [[anchorKey, radius, color, alpha]], flagScale, spin: [{at, r, n, color, speed}], bubbles: [anchorKey],
//          flag: flag part id, parts (resolved), tier}
//     Model axes: x stern -> bow, y up, z far -> near. No chimney: eco boats don't smoke.
//   buildFlagModel(flagId, paint) -> VoxelModel (1 voxel deep, render flat; rows top -> bottom)
//   drawBoatAnim(ctx, T, A, bx, by, t, dir, vs = 2)   spinning turbine blades + bubble jets; A = screen anchors
//     relative to (bx, by) (boat.js's sprite.A), call after the boat sprite and the character are drawn.
//   resolveBoat(state) -> {tier, parts, paint, trim, key}   (key changes whenever the model must be rebuilt)
//   renderBoatPreview(tier, parts, {scale, t}) -> {canvas, front, px, py, stand:[x,y], A, drawFront(ctx, bx, by, t, dir)}
//     (wardrobe Boat tab / Lab / dev; cached)
//   ensureBoat(state) normalises state.boat.

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { smoothstep, hash3, TAU, clamp } from '../core/math.js';
import { mix, shade } from '../core/color.js';

const sm = smoothstep;

// ------------------------------------------------------------------ parts

const P_ = (id, name, rarity, extra = {}) => ({ id, name, rarity, ...extra });
export const BOAT_PARTS = {
  hull: [
    P_('aqua', 'Aqua Gloss', 'common', { color: '#2fb8e8', trim: '#ffffff' }),
    P_('white', 'Pearl White', 'common', { color: '#f2f8fc', trim: '#2fd3e8' }),
    P_('sky', 'Sky Blue', 'common', { color: '#59a8f0', trim: '#ffffff' }),
    P_('lime', 'Lime Pop', 'uncommon', { color: '#8be04a', trim: '#ffffff' }),
    P_('leaf', 'Leaf Green', 'uncommon', { color: '#3fae2a', trim: '#e8ffd0' }),
    P_('coral', 'Coral Reef', 'uncommon', { color: '#ff7a6a', trim: '#ffffff' }),
    P_('sunny', 'Sunshine', 'rare', { color: '#ffd23a', trim: '#ffffff' }),
    P_('navy', 'Deep Navy', 'rare', { color: '#1a3a7a', trim: '#7affff' }),
    P_('bubblegum', 'Bubblegum', 'rare', { color: '#ff8ac8', trim: '#ffffff' }),
    P_('chrome', 'Chrome', 'epic', { color: '#c8d8e6', trim: '#2fd3e8' }),
    P_('tomato', 'Retro Tomato', 'common', { color: '#c8583a', trim: '#f2e6c8' }),
    P_('gold', 'Gilded', 'legendary', { color: '#f2c03a', trim: '#ffffff' }),
  ],
  sail: [
    P_('none', 'No Sail', 'common'), P_('white', 'Classic White', 'common'), P_('stripe', 'Aqua Stripes', 'common'), P_('leaf', 'Leaf Sail', 'uncommon'),
    P_('bubble', 'Glass Sail', 'rare'), P_('rainbow', 'Rainbow', 'rare'), P_('solar', 'Solar Sail', 'epic'),
  ],
  flag: [
    P_('fish', 'Fish Flag', 'common'), P_('drop', 'Water Drop', 'common'), P_('leaf', 'Leaf', 'common'), P_('heart', 'Heart', 'uncommon'),
    P_('star', 'Star', 'uncommon'), P_('smile', 'Smiley', 'rare'), P_('rainbow', 'Rainbow', 'rare'), P_('bubble', 'Bubble', 'epic'),
  ],
  engine: [
    P_('none', 'No Motor', 'common'), P_('outboard', 'Aero Outboard', 'common'), P_('turbine', 'Wind Turbine', 'uncommon'), P_('solar', 'Solar Canopy', 'rare'),
    P_('bubble', 'Bubble Jet', 'epic'), P_('paddle', 'Paddle Wheel', 'rare'),
  ],
  decal: [
    P_('none', 'Plain', 'common'), P_('swoosh', 'Aqua Swoosh', 'common'), P_('wave', 'Wave', 'common'), P_('leaves', 'Leaves', 'uncommon'),
    P_('bubbles', 'Bubbles', 'uncommon'), P_('stripes', 'Racing Stripes', 'rare'), P_('dolphin', 'Dolphins', 'rare'),
  ],
};
export const BOAT_PART_SLOTS = [
  { id: 'hull', name: 'Paint' }, { id: 'sail', name: 'Sail' }, { id: 'flag', name: 'Flag' }, { id: 'engine', name: 'Engine' }, { id: 'decal', name: 'Decal' },
];
const PART_BY = Object.fromEntries(Object.entries(BOAT_PARTS).map(([k, list]) => [k, Object.fromEntries(list.map((p) => [p.id, p]))]));

// Tier defaults (what you get when a slot is unset).
const DEFAULTS = [
  { hull: 'aqua', sail: 'leaf', flag: 'fish', engine: 'none', decal: 'none' },
  { hull: 'aqua', sail: 'none', flag: 'drop', engine: 'outboard', decal: 'bubbles' },
  { hull: 'white', sail: 'none', flag: 'fish', engine: 'outboard', decal: 'swoosh' },
  { hull: 'white', sail: 'none', flag: 'star', engine: 'none', decal: 'stripes' },
  { hull: 'white', sail: 'none', flag: 'drop', engine: 'solar', decal: 'wave' },
  { hull: 'white', sail: 'leaf', flag: 'leaf', engine: 'none', decal: 'leaves' },
  { hull: 'aqua', sail: 'none', flag: 'bubble', engine: 'bubble', decal: 'bubbles' },
];
const MASTED = [true, true, true, false, true, true, false];

export function resolveParts(tier, parts) {
  const d = DEFAULTS[tier] || DEFAULTS[0];
  const out = {};
  for (const k of Object.keys(d)) out[k] = parts && typeof parts[k] === 'string' && PART_BY[k][parts[k]] ? parts[k] : d[k];
  return out;
}

export function ensureBoat(state) {
  const b = (state.boat ||= { tier: 0, parts: {} });
  b.tier = clamp(Math.round(Number(b.tier) || 0), 0, BOAT_TIERS.length - 1);
  if (!b.parts || typeof b.parts !== 'object') b.parts = {};
  for (const k of Object.keys(b.parts)) if (!PART_BY[k]?.[b.parts[k]]) delete b.parts[k];
  return b;
}

export function resolveBoat(state) {
  const b = state?.boat || {};
  const tier = clamp(Math.round(Number(b.tier) || 0), 0, BOAT_TIERS.length - 1);
  const parts = resolveParts(tier, b.parts);
  const H = PART_BY.hull[parts.hull];
  return { tier, parts, paint: H.color, trim: H.trim, key: tier + '|' + JSON.stringify(parts) };
}

// ------------------------------------------------------------------ helpers

function palette(m, defs) {
  const out = {};
  for (const [k, v] of Object.entries(defs)) out[k] = Array.isArray(v) ? m.color(v[0], v[1] || {}) : m.color(v, {});
  return out;
}

// Shared Aero palette for a boat.
function aeroPal(m, paint, trim) {
  return palette(m, {
    paint: [paint, { jitter: 0.06, spec: 1.1, specPow: 12, smooth: 0.5 }], paintD: [shade(paint, -0.16), { jitter: 0.05, spec: 0.8 }], paintL: [mix(paint, '#ffffff', 0.35), { jitter: 0.04, spec: 1 }],
    bottom: [mix(paint, '#0a3a6e', 0.6), { jitter: 0.08 }], trim: [trim, { jitter: 0.03, spec: 1.1 }],
    white: ['#f6fbff', { jitter: 0.03, spec: 1.2, specPow: 12, smooth: 0.5 }], whiteD: ['#d2e4f0', { jitter: 0.04 }], aqua: ['#2fd3e8', { spec: 1.2 }], aquaD: ['#1890c0', { spec: 0.8 }],
    lime: ['#8be04a', { spec: 1 }], leaf: ['#4cb82e', { spec: 0.9 }], leafL: ['#9be84a', { spec: 1 }], vein: ['#d8f8a0', { jitter: 0 }],
    deck: ['#f4dca0', { jitter: 0.1 }], deckD: ['#d8b878', { jitter: 0.08 }], bamboo: ['#c8e078', { jitter: 0.1 }], bambooD: ['#98b850', { jitter: 0.06 }],
    glass: ['#8ee4ff', { jitter: 0, spec: 1.6, specPow: 16, smooth: 0.8 }], glassHi: ['#e8fbff', { jitter: 0, spec: 1.6 }], glassD: ['#4ab4e8', { jitter: 0, spec: 1.4 }],
    chrome: ['#e2eaf2', { jitter: 0, spec: 1.7, specPow: 8 }], chromeD: ['#9fb4c8', { jitter: 0, spec: 1.2 }], solar: ['#1a3a7a', { jitter: 0.02, spec: 1.5, specPow: 16 }], solarL: ['#6a9ae8', { jitter: 0, spec: 1.4 }],
    rope: ['#f2e2b8', { jitter: 0.08 }], red: ['#ff5a5a', { spec: 0.8 }], navy: ['#13284a', { spec: 1 }], orange: ['#ff9a2a', { spec: 0.8 }], fish: ['#ffb84a', { spec: 0.6 }],
    lamp: ['#fff2b0', { emissive: 0.85, jitter: 0 }], led: ['#7affff', { emissive: 0.9, jitter: 0 }], ledG: ['#a8ff6a', { emissive: 0.9, jitter: 0 }], ledR: ['#ff6a6a', { emissive: 0.9, jitter: 0 }],
  });
}

function hull(m, s) {
  const vee = s.vee ?? 0.3, thick = s.thick ?? 1.25;
  for (let u = 0; u < s.len; u++) {
    const x = s.x0 + u, yb = Math.round(s.keel(u)), ys = Math.round(s.sheer(u)), hb = s.beam(u), dk = s.deck(u);
    for (let y = yb; y <= ys; y++) {
      const t = (y - yb) / Math.max(1, ys - yb);
      const w = Math.max(0.6, hb * (vee + (1 - vee) * Math.pow(t, s.round ?? 0.5)));
      for (let z = 0; z < m.nz; z++) {
        const dz = Math.abs(z - s.zc);
        if (dz > w) continue;
        const shell = dz > w - thick;
        if (y > dk && !shell) continue;
        let c;
        if (!shell && y === dk) c = s.deckC(x, z, u);
        else if (s.inner && y > dk && y < ys && z < s.zc) c = s.inner;
        else c = s.skin(y, u, ys, yb, z);
        m.set(x, y, z, c);
      }
    }
  }
}
const deckFn = (base, sheer, bulwark) => (u) => Math.max(base, Math.round(sheer(u)) - bulwark);

function railing(m, s, c, o = {}) {
  const { from = 2, to = s.len - 4, every = 5, h = 3, sides = [-1, 1], post = c } = o;
  for (let u = from; u < to; u++) {
    const x = s.x0 + u, ys = Math.round(s.sheer(u)), hb = s.beam(u);
    for (const side of sides) {
      const z = Math.round(s.zc + side * (hb - 0.6));
      if (u % every === 0) for (let k = 1; k < h; k++) m.set(x, ys + k, z, post);
      m.set(x, ys + h, z, c);
    }
  }
}

function twinFront(m, keys, test) {
  const twins = new Map();
  for (const k of keys) {
    const pe = m.palette[k];
    if (!pe || twins.has(k)) continue;
    twins.set(k, m.color(pe.color, { ...pe }));
  }
  for (let z = 0; z < m.nz; z++) for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
    const v = m.get(x, y, z);
    if (v && twins.has(v) && test(x, y, z)) m.set(x, y, z, twins.get(v));
  }
  return new Set(twins.values());
}

function ringZ(m, cx, cy, z, r, cA, cB, quarters = 4) {
  for (let a = 0; a < TAU; a += 0.5 / r) m.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, Math.floor(((a + 0.4) / TAU) * quarters) % 2 ? cA : cB);
}
function porthole(m, x, y, z, rim, glass) {
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) m.set(x + dx, y + dy, z, rim);
  m.set(x, y, z, glass);
}
function shapeIn(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
}
// Recolour hull-side voxels (both sides, outermost layer) with a decal pattern fn(x, y) -> idx | null.
function sideDecal(m, zc, x0, x1, y0, y1, ok, fn) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    for (const s of [1, -1]) {
      let z = s > 0 ? m.nz - 1 : 0;
      for (; s > 0 ? z > zc : z < zc; z -= s) if (m.get(x, y, z)) break;
      const v = m.get(x, y, z);
      if (!v || !ok.has(v)) continue;
      const c = fn(x, y);
      if (c) m.set(x, y, z, c);
    }
  }
}
function applyDecal(m, p, id, zc, x0, x1, y0, y1) {
  if (id === 'none') return;
  const ok = new Set([p.paint, p.paintD, p.white, p.trim, p.paintL]);
  const L = x1 - x0, mid = (y0 + y1) / 2, h = y1 - y0;
  if (id === 'swoosh') sideDecal(m, zc, x0, x1, y0, y1, ok, (x, y) => { const u = (x - x0) / L; const c = y0 + h * (0.25 + 0.55 * u * u); return Math.abs(y - c) < 0.9 + u * 0.8 ? p.aqua : Math.abs(y - c - 1.6 - u) < 0.5 ? p.white : null; });
  else if (id === 'wave') sideDecal(m, zc, x0, x1, y0, y1, ok, (x, y) => (Math.abs(y - mid - Math.sin(x * 0.4) * h * 0.22) < 0.6 ? p.white : y < mid + Math.sin(x * 0.4) * h * 0.22 - 0.6 ? p.aquaD : null));
  else if (id === 'stripes') sideDecal(m, zc, x0, x1, y0, y1, ok, (x, y) => { const c = mid + (x - x0) * 0.08; return Math.abs(y - c) < 0.6 ? p.aqua : Math.abs(y - c - 1.6) < 0.5 ? p.lime : null; });
  else if (id === 'bubbles') sideDecal(m, zc, x0, x1, y0, y1, ok, (x, y) => {
    for (let i = 0; i < L / 5; i++) { const bx = x0 + 3 + i * 5 + hash3(i, 1, 2, 3) * 2, by = y0 + 1 + hash3(i, 4, 5, 6) * (h - 2), r = 0.9 + hash3(i, 7, 8, 9) * 1.4; const d = Math.hypot(x - bx, y - by); if (d < r + 0.5 && d > r - 0.5) return p.white; if (d < 0.6 && r > 1.5) return p.white; }
    return null;
  });
  else if (id === 'leaves') sideDecal(m, zc, x0, x1, y0, y1, ok, (x, y) => {
    for (let i = 0; i < L / 7; i++) { const bx = x0 + 4 + i * 7, by = mid + (i % 2 ? 0.8 : -0.8); const u = (x - bx) * 0.7 + (y - by) * 0.7, v = -(x - bx) * 0.7 + (y - by) * 0.7; if ((u / 3) ** 2 + (v / 1.3) ** 2 < 1) return Math.abs(v) < 0.4 ? p.vein : i % 2 ? p.leaf : p.leafL; }
    return null;
  });
  else if (id === 'dolphin') {
    const D = ['......##..', '....####..', '.#########', '##########', '.########.', '..#...##..'];
    sideDecal(m, zc, x0, x1, y0, y1, ok, (x, y) => {
      for (const bx of [x0 + Math.round(L * 0.3), x0 + Math.round(L * 0.65)]) { const i = x - bx, j = Math.round(mid + 3) - y; if (i >= 0 && i < 10 && j >= 0 && j < 6 && D[j][i] === '#') return p.white; }
      return null;
    });
  }
}

// Mast + sail. The sail is a 1-voxel plane at z = zc spanning aft of the mast.
function mastSail(m, p, id, mx, y0, y1, zc, aft, flagTop = true) {
  for (let y = y0; y <= y1; y++) m.set(mx, y, zc, y % 6 === 0 ? p.chromeD : p.chrome);
  m.set(mx, y1 + 1, zc, p.aqua);
  if (id === 'none') return [mx + 0.5, y1 + 1.5, zc + 0.5];
  const H = y1 - y0 - 3, by = y0 + 3;
  m.line(mx, by, zc, mx - aft, by, zc, p.chromeD, 0);
  for (let y = by + 1; y <= y1 - 1; y++) {
    const k = (y - by) / H;
    let w = aft * (1 - k) * (id === 'leaf' ? 0.55 + 0.6 * Math.sin(k * Math.PI) : 1);
    if (id === 'bubble') w = aft * Math.sqrt(Math.max(0, 1 - ((k - 0.42) / 0.62) ** 2)) * 0.95;
    for (let x = mx - 1; x >= mx - w; x--) {
      const u = (mx - x) / Math.max(1, aft);
      let c = p.white;
      if (id === 'stripe') c = Math.floor(k * 9) % 2 ? p.aqua : p.white;
      else if (id === 'leaf') c = Math.abs(u - (1 - k) * 0.45) < 0.035 ? p.vein : (x + y) % 5 === 0 ? p.leaf : p.leafL;
      else if (id === 'rainbow') c = [p.red, p.orange, p.lamp, p.lime, p.aqua, p.solarL][Math.floor(u * 6) % 6];
      else if (id === 'solar') c = (x % 4 === 0 || y % 3 === 0) ? p.solarL : p.solar;
      else if (id === 'bubble') c = (x + y) % 9 === 0 ? p.glassHi : p.glass;
      if (x <= mx - w + 0.8 && id !== 'leaf' && id !== 'bubble') c = id === 'solar' ? p.chrome : p.trim;
      m.set(x, y, zc, c);
    }
  }
  if (id === 'rainbow') for (let x = 0; x < m.nx; x++) for (let y = 0; y < m.ny; y++) { const v = m.get(x, y, zc); if (v === p.lamp) m.set(x, y, zc, p.deck); }
  return [mx + 0.5, y1 + 1.5, zc + 0.5];
}

// Stern engine part. Returns extra anchors {turbine?, bubbles?}.
function engine(m, p, id, x, y, zc, A, spin, bubbles, o = {}) {
  if (id === 'outboard') {
    m.box(x - 3, y, zc - 2, x, y + 5, zc + 2, p.white);
    m.box(x - 3, y + 2, zc - 2, x, y + 2, zc + 2, p.aqua);
    m.box(x - 2, y - 7, zc, x - 1, y, zc, p.chromeD);
    m.box(x - 3, y - 8, zc - 1, x - 1, y - 7, zc + 1, p.chromeD);
    m.set(x - 4, y + 4, zc, p.navy);
  } else if (id === 'turbine') {
    const h = o.poleH ?? 18;
    m.line(x, y, zc, x, y + h, zc, p.white, 0.6);
    m.ellipsoid(x, y + h, zc, 2.2, 1.4, 1.4, p.white);
    m.set(x + 2, y + h, zc, p.aqua);
    m.set(x, y + h, zc + 2, p.lime);
    A.turbineE = [x + 0.5, y + h + 0.5, zc + 2.5];
    spin.push({ at: 'turbineE', r: 8, n: 3, speed: 5 });
  } else if (id === 'solar') {
    const x0 = o.x0 ?? x + 2, x1 = o.x1 ?? x + 16, top = y + (o.h ?? 22);
    for (const px of [x0, x1]) for (const pz of [zc - 6, zc + 6]) m.line(px, y, pz, px, top, pz, p.chrome, 0.4);
    m.box(x0 - 1, top, zc - 7, x1 + 1, top + 1, zc + 7, (xx, yy, zz) => (yy > top ? ((xx + zz) % 4 === 0 ? p.solarL : p.solar) : p.chrome));
  } else if (id === 'bubble') {
    m.sphere(x - 1, y + 3, zc, 3.4, p.glass);
    m.sphere(x - 2, y + 4, zc + 1.6, 1, p.glassHi);
    m.box(x - 1, y, zc - 1, x + 1, y + 1, zc + 1, p.chrome);
    m.set(x - 1, y + 3, zc + 3, p.led);
    A.bubbles0 = [x - 3.5, y - 1, zc + 0.5];
    bubbles.push('bubbles0');
  } else if (id === 'paddle') {
    const cy = y + 1;
    for (let a = 0; a < TAU; a += 0.14) { m.set(x - 4 + Math.cos(a) * 5, cy + Math.sin(a) * 5, zc - 3, p.red); m.set(x - 4 + Math.cos(a) * 5, cy + Math.sin(a) * 5, zc + 3, p.red); }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; m.box(x - 4 + Math.cos(a) * 4.6, cy + Math.sin(a) * 4.6, zc - 3, x - 4 + Math.cos(a) * 4.6, cy + Math.sin(a) * 4.6, zc + 3, p.white); }
    m.box(x - 5, cy - 1, zc - 3, x - 3, cy + 1, zc + 3, p.chrome);
  }
}

function bubbleLamp(m, p, x, y, z, h) {
  m.line(x, y, z, x, y + h, z, p.chrome, 0.4);
  m.sphere(x, y + h + 1.6, z, 1.6, p.lamp);
  m.set(x - 1, y + h + 2, z + 1, p.glassHi);
}

const finish = (o) => ({ flagScale: 1, spin: [], bubbles: [], lights: [], night: new Map(), ...o });

// ------------------------------------------------------------------ 0 raft

function raft(paint, trim, parts) {
  const m = new VoxelModel(64, 56, 22);
  const p = aeroPal(m, paint, trim);
  const X0 = 10, LEN = 40, ZC = 11, WL = 3, DECK = 6;
  const A = {}, spin = [], bubbles = [];
  // two glossy pontoon floats with white bands
  for (const s of [-1, 1]) {
    const z = ZC + s * 5.5;
    shapeIn(m, X0 - 2, 0, z - 4, X0 + LEN + 3, 7, z + 4, (x, y, zz) => {
      const u = (x - X0) / LEN, end = Math.min(1, Math.min(u, 1 - u) * 8 + 0.15);
      const r = 2.7 * Math.sqrt(Math.max(0, end));
      return u > -0.02 && u < 1.02 && Math.hypot(y - 3.4, zz - z) <= r;
    }, (x) => ((x - X0) % 9 === 0 ? p.trim : (x - X0) % 9 === 1 ? p.paintL : p.paint));
  }
  // bamboo deck slats + lashings
  for (let x = X0 + 2; x <= X0 + LEN - 2; x++) for (let z = ZC - 8; z <= ZC + 8; z++) m.set(x, DECK, z, x % 3 === 0 ? p.bambooD : z === ZC - 8 || z === ZC + 8 ? p.bambooD : p.bamboo);
  for (const x of [X0 + 2, X0 + LEN - 2]) for (let z = ZC - 8; z <= ZC + 8; z++) m.set(x, DECK + 1, z, p.bambooD);
  for (const x of [X0 + 8, X0 + 20, X0 + 32]) for (const s of [-1, 1]) m.set(x, DECK - 1, ZC + s * 5.5, p.rope);
  applyDecal(m, p, parts.decal, ZC, X0, X0 + LEN, 1, 6);
  // mast + sail, cooler, bubble lamp, a little potted sprout (eco!)
  const mx = X0 + 28;
  A.flag = mastSail(m, p, parts.sail, mx, DECK + 1, DECK + 30, ZC, 14);
  A.mast = A.flag;
  m.box(X0 + 33, DECK + 1, ZC - 3, X0 + 37, DECK + 4, ZC + 1, p.white);
  m.box(X0 + 33, DECK + 5, ZC - 3, X0 + 37, DECK + 5, ZC + 1, p.aqua);
  bubbleLamp(m, p, X0 + 3, DECK + 1, ZC - 6, 8);
  A.lantern = [X0 + 3.5, DECK + 10.5, ZC - 5.5];
  m.cylinder(X0 + 6, ZC + 5, DECK + 1, DECK + 3, 1.4, p.white);
  m.line(X0 + 6, DECK + 3, ZC + 5, X0 + 6, DECK + 6, ZC + 5, p.leaf, 0);
  m.set(X0 + 5, DECK + 6, ZC + 5, p.leafL); m.set(X0 + 7, DECK + 7, ZC + 5, p.leafL);
  engine(m, p, parts.engine, X0 + 1, DECK + 1, ZC, A, spin, bubbles, { x0: X0 + 4, x1: X0 + 20, h: 22 });
  return finish({
    m, front: new Set(), wl: WL, zc: ZC, spin, bubbles,
    A: { ...A, stand: [X0 + 15, DECK + 1, ZC], bow: [X0 + LEN + 2, WL, ZC], stern: [X0 - 2, WL, ZC], top: [X0 + 20, DECK + 30, ZC], keel: [X0 + 20, 0, ZC] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.6, night: new Map([[p.lamp, '#fff2b0']]), lights: [['lantern', 70, '#fff2b0', 0.9]],
  });
}

// ------------------------------------------------------------------ 1 dinghy (inflatable bubble collar)

function dinghy(paint, trim, parts) {
  const m = new VoxelModel(72, 56, 24);
  const p = aeroPal(m, paint, trim);
  const X0 = 12, LEN = 46, ZC = 12, WL = 3, DECK = 4;
  const A = {}, spin = [], bubbles = [];
  const beam = (u) => (u < 30 ? 7.4 : 7.4 * Math.sqrt(Math.max(0, 1 - ((u - 30) / 16.5) ** 2)));
  // rigid hull below the tube
  hull(m, { x0: X0, len: LEN, zc: ZC, vee: 0.4, keel: (u) => 0.6 + 2.6 * Math.pow(sm(30, 46, u), 1.6), sheer: () => 5, beam: (u) => beam(u) * 0.9, deck: () => DECK, skin: (y) => (y < 2 ? p.bottom : p.paintD), deckC: (x) => (x % 3 ? p.deck : p.deckD) });
  // inflatable tube collar (white + paint band) following the outline, closed at the transom
  for (let u = 0; u <= LEN; u += 0.5) {
    const w = beam(u), x = X0 + u, rise = 2.4 * Math.pow(sm(30, 46, u), 1.4);
    for (const s of [-1, 1]) m.sphere(x, 6.2 + rise, ZC + s * (w - 0.6), 2.3, (xx, y) => (y < 5 + rise ? p.paint : p.trim === p.white ? p.white : p.white));
  }
  for (let z = -6; z <= 6; z += 0.5) m.sphere(X0 + 0.5, 6.2, ZC + z, 2.3, p.white);
  sideDecal(m, ZC, X0, X0 + LEN, 4, 9, new Set([p.white]), (x, y) => (y === 6 && (x - X0) % 2 === 0 ? p.paintL : null));
  applyDecal(m, p, parts.decal, ZC, X0 + 2, X0 + LEN - 6, 1, 4);
  // bench, bucket with a fish, bow lamp
  m.box(X0 + 20, DECK + 2, ZC - 6, X0 + 23, DECK + 2, ZC + 6, p.white);
  m.cylinder(X0 + 30, ZC - 3, DECK + 1, DECK + 3, 1.5, p.aqua);
  m.set(X0 + 30, DECK + 4, ZC - 3, p.fish);
  bubbleLamp(m, p, X0 + 41, 9, ZC, 7);
  A.lantern = [X0 + 41.5, 17.5, ZC + 0.5];
  if (MASTED[1] && parts.sail !== 'none') A.flag = mastSail(m, p, parts.sail, X0 + 33, DECK + 1, DECK + 24, ZC, 12);
  else { m.line(X0 + 1, 8, ZC - 5, X0 + 1, 22, ZC - 5, p.chrome, 0); A.flag = [X0 + 1.5, 22.5, ZC - 4.5]; }
  engine(m, p, parts.engine, X0, DECK + 3, ZC, A, spin, bubbles, { x0: X0 + 4, x1: X0 + 22, h: 18, poleH: 16 });
  const front = twinFront(m, [p.white, p.paint, p.paintL], (x, y, z) => z >= ZC + 3 && y >= 5);
  return finish({
    m, front, wl: WL, zc: ZC, spin, bubbles,
    A: { ...A, stand: [X0 + 13, DECK + 1, ZC], bow: [X0 + LEN, WL, ZC], stern: [X0 - 2, WL, ZC], top: [X0 + 20, 22, ZC], keel: [X0 + 20, 0, ZC] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.7, night: new Map([[p.lamp, '#fff2b0']]), lights: [['lantern', 70, '#fff2b0', 0.9]],
  });
}

// ------------------------------------------------------------------ 2 skiff

function skiff(paint, trim, parts) {
  const m = new VoxelModel(86, 56, 24);
  const p = aeroPal(m, paint, trim);
  const X0 = 12, LEN = 60, ZC = 12, WL = 3, DECK = 6;
  const A = {}, spin = [], bubbles = [];
  const s = {
    x0: X0, len: LEN, zc: ZC, vee: 0.3,
    keel: (u) => 1 + 5 * Math.pow(sm(36, 60, u), 1.7),
    sheer: (u) => 9 + 3.2 * Math.pow(sm(30, 60, u), 1.5),
    beam: (u) => (u < 34 ? 8.4 : 8.4 * Math.sqrt(Math.max(0, 1 - ((u - 34) / 26.5) ** 2))),
    skin: (y, u, ys) => (y === ys ? p.trim : y <= WL ? p.bottom : y <= WL + 2 ? p.paint : p.white),
    deckC: (x) => (x % 2 ? p.deck : p.deckD),
  };
  s.deck = deckFn(DECK, s.sheer, 3);
  s.inner = p.whiteD;
  hull(m, s);
  applyDecal(m, p, parts.decal, ZC, X0 + 2, X0 + LEN - 4, WL + 3, 11);
  railing(m, s, p.chrome, { from: 36, to: LEN - 3, every: 6, h: 2 });
  // console + curved glass windshield
  const cx = X0 + 30;
  m.box(cx, DECK + 1, ZC - 3, cx + 5, DECK + 7, ZC + 3, (x, y) => (y === DECK + 7 ? p.aqua : p.white));
  for (let z = -6; z <= 6; z++) for (let k = 0; k < 6; k++) { const x = cx + 6 + Math.round(k * 0.6 + (z * z) / 14); m.set(x, DECK + 7 + k, ZC + z, k === 5 ? p.chrome : (k + z) % 5 === 0 ? p.glassHi : p.glass); }
  m.box(cx + 1, DECK + 8, ZC - 1, cx + 3, DECK + 9, ZC + 1, p.navy);
  m.set(cx + 2, DECK + 10, ZC, p.chrome);
  // bench seat + cooler
  m.box(X0 + 8, DECK + 1, ZC - 6, X0 + 12, DECK + 3, ZC + 6, p.white);
  m.box(X0 + 8, DECK + 4, ZC - 6, X0 + 9, DECK + 7, ZC + 6, p.aqua);
  // whip antenna with the flag + nav lights
  m.line(X0 + 4, DECK + 1, ZC - 5, X0 + 4, DECK + 26, ZC - 5, p.chrome, 0);
  A.flag = [X0 + 4.5, DECK + 26.5, ZC - 4.5];
  m.set(X0 + LEN - 6, 13, ZC + 7, p.ledG); m.set(X0 + LEN - 6, 13, ZC - 7, p.ledR);
  if (parts.sail !== 'none') A.flag = mastSail(m, p, parts.sail, X0 + 44, DECK + 1, DECK + 28, ZC, 12);
  engine(m, p, parts.engine, X0, DECK + 2, ZC, A, spin, bubbles, { x0: X0 + 6, x1: X0 + 26, h: 18, poleH: 16 });
  const front = twinFront(m, [p.white, p.trim, p.paint, p.chrome, p.aqua, p.paintL, p.paintD], (x, y, z) => z >= ZC + 5 && y > DECK);
  return finish({
    m, front, wl: WL, zc: ZC, spin, bubbles,
    A: { ...A, stand: [X0 + 20, DECK + 1, ZC], bow: [X0 + LEN, WL, ZC], stern: [X0 - 2, WL, ZC], top: [X0 + 30, DECK + 22, ZC], keel: [X0 + 30, 0, ZC], lantern: [X0 + LEN - 5.5, 13.5, ZC + 7.5] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.8, night: new Map([[p.ledG, '#a8ff6a'], [p.ledR, '#ff6a6a'], [p.lamp, '#fff2b0']]), lights: [['lantern', 40, '#a8ff6a', 0.6]],
  });
}

// ------------------------------------------------------------------ 3 hydrofoil

function hydrofoil(paint, trim, parts) {
  const m = new VoxelModel(92, 56, 28);
  const p = aeroPal(m, paint, trim);
  const X0 = 12, LEN = 64, ZC = 14, WL = 4, LIFT = 7, DECK = LIFT + 6;
  const A = {}, spin = [], bubbles = [];
  const s = {
    x0: X0, len: LEN, zc: ZC, vee: 0.25,
    keel: (u) => LIFT + 1 + 5 * Math.pow(sm(36, 64, u), 1.6),
    sheer: (u) => LIFT + 9 + 2.6 * Math.pow(sm(34, 64, u), 1.4),
    beam: (u) => (u < 36 ? 8.6 : 8.6 * Math.sqrt(Math.max(0, 1 - ((u - 36) / 28.5) ** 2))),
    skin: (y, u, ys) => (y === ys ? p.trim : y <= LIFT + 3 ? p.paint : y <= LIFT + 4 ? p.aqua : p.white),
    deckC: (x) => (x % 2 ? p.white : p.whiteD),
  };
  s.deck = deckFn(DECK, s.sheer, 3);
  s.inner = p.whiteD;
  hull(m, s);
  applyDecal(m, p, parts.decal, ZC, X0 + 2, X0 + LEN - 4, LIFT + 4, LIFT + 9);
  // struts + foils (front and back), chrome
  for (const [u, span] of [[12, 13], [50, 9]]) {
    const x = X0 + u;
    for (const sd of [-1, 1]) m.line(x, s.keel(u) + 1, ZC + sd * 5, x + 1, 1.5, ZC + sd * (span - 1), p.chrome, 0.6);
    m.box(x - 3, 1, ZC - span, x + 3, 1, ZC + span, p.aqua);
    m.box(x - 2, 0, ZC - span, x + 2, 0, ZC + span, p.aquaD);
    for (const sd of [-1, 1]) m.box(x - 3, 1, ZC + sd * span, x + 3, 3, ZC + sd * span, p.white);
  }
  // glass bubble canopy forward of the cockpit
  const cx = X0 + 34;
  shapeIn(m, cx, DECK, ZC - 8, cx + 18, DECK + 9, ZC + 8, (x, y, z) => ((x - cx - 6) / 11) ** 2 + ((y - DECK) / 7.4) ** 2 + ((z - ZC) / 6.4) ** 2 <= 1 && y > DECK, (x, y, z) => ((x + y) % 7 === 0 ? p.glassHi : y > DECK + 5 ? p.glassD : p.glass));
  m.box(cx - 1, DECK + 1, ZC - 6, cx, DECK + 6, ZC + 6, p.chrome);
  // stern wing
  for (const sd of [-1, 1]) m.line(X0 + 3, DECK + 1, ZC + sd * 5, X0 + 1, DECK + 7, ZC + sd * 5, p.white, 0.5);
  m.box(X0 - 1, DECK + 7, ZC - 7, X0 + 4, DECK + 8, ZC + 7, (x, y) => (y === DECK + 8 ? p.aqua : p.white));
  A.flag = [X0 + 1.5, DECK + 9, ZC - 6.5];
  m.line(X0 + 1, DECK + 8, ZC - 7, X0 + 1, DECK + 20, ZC - 7, p.chrome, 0);
  A.flag = [X0 + 1.5, DECK + 20.5, ZC - 6.5];
  m.set(X0 + LEN - 4, LIFT + 7, ZC + 6, p.led); m.set(X0 + LEN - 4, LIFT + 7, ZC - 6, p.led);
  engine(m, p, parts.engine, X0, DECK + 2, ZC, A, spin, bubbles, { x0: X0 + 6, x1: X0 + 26, h: 16, poleH: 14 });
  const front = twinFront(m, [p.white, p.trim, p.whiteD, p.aqua], (x, y, z) => z >= ZC + 6 && y > DECK && x < cx - 1);
  return finish({
    m, front, wl: WL, zc: ZC, spin, bubbles,
    A: { ...A, stand: [X0 + 20, DECK + 1, ZC], bow: [X0 + LEN, WL, ZC], stern: [X0 - 2, WL, ZC], top: [X0 + 30, DECK + 18, ZC], keel: [X0 + 30, 0, ZC], under: [X0 + 30, 2, ZC + 10], lantern: [X0 + LEN - 3.5, LIFT + 7.5, ZC + 6.5] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.8, night: new Map([[p.led, '#7affff'], [p.glass, '#bff6ff']]), lights: [['under', 60, '#7affff', 0.5], ['lantern', 40, '#7affff', 0.6]],
  });
}

// ------------------------------------------------------------------ 4 glass yacht

function yacht(paint, trim, parts) {
  const m = new VoxelModel(116, 72, 30);
  const p = aeroPal(m, paint, trim);
  const X0 = 14, LEN = 86, ZC = 15, WL = 5, DECK = 12;
  const A = {}, spin = [], bubbles = [];
  const s = {
    x0: X0, len: LEN, zc: ZC, vee: 0.3,
    keel: (u) => 1 + 7 * Math.pow(sm(50, 86, u), 1.7),
    sheer: (u) => 14.4 + 4 * Math.pow(sm(46, 86, u), 1.5),
    beam: (u) => (u < 46 ? 11.4 : 11.4 * Math.sqrt(Math.max(0, 1 - ((u - 46) / 40.5) ** 2))),
    skin: (y, u, ys) => (y === ys ? p.chrome : y <= WL - 1 ? p.bottom : y <= WL + 1 ? p.paint : y === WL + 2 ? p.trim : p.white),
    deckC: (x) => (x % 2 ? p.deck : p.deckD),
  };
  s.deck = deckFn(DECK, s.sheer, 2);
  s.inner = p.whiteD;
  hull(m, s);
  applyDecal(m, p, parts.decal, ZC, X0 + 4, X0 + LEN - 8, WL + 4, 13);
  for (let u = 26; u < 74; u += 7) porthole(m, X0 + u, WL + 5, Math.round(ZC + s.beam(u) * 0.97), p.chrome, p.glass);
  railing(m, s, p.chrome, { from: 2, to: 20, every: 4, h: 3 });
  railing(m, s, p.chrome, { from: 64, to: LEN - 3, every: 4, h: 3 });
  // lower glass salon (curved wraparound windows) + upper glass flybridge
  const bx0 = X0 + 24, bx1 = X0 + 62;
  shapeIn(m, bx0, DECK + 1, ZC - 10, bx1 + 6, DECK + 11, ZC + 10, (x, y, z) => {
    const fx = x - bx1; const lim = fx > 0 ? 9.6 - fx * 1.6 : 9.6;
    return Math.abs(z - ZC) <= lim && x >= bx0 && y <= DECK + 10 - Math.max(0, fx) * 0.8;
  }, (x, y, z) => (y <= DECK + 2 || y >= DECK + 9 ? p.white : (x + y * 2) % 11 === 0 ? p.glassHi : y > DECK + 6 ? p.glassD : p.glass));
  shapeIn(m, bx0 + 6, DECK + 11, ZC - 8, bx1 - 2, DECK + 19, ZC + 8, (x, y, z) => { const fx = x - (bx1 - 8); const lim = fx > 0 ? 7.6 - fx * 1.5 : 7.6; return Math.abs(z - ZC) <= lim && y <= DECK + 18 - Math.max(0, fx) * 0.9; }, (x, y) => (y <= DECK + 12 || y >= DECK + 17 ? p.white : (x + y) % 9 === 0 ? p.glassHi : p.glass));
  // radar arch + dome + mast lights
  for (const sd of [-1, 1]) m.line(bx0 + 10, DECK + 19, ZC + sd * 6, bx0 + 14, DECK + 26, ZC + sd * 3, p.white, 0.8);
  m.box(bx0 + 13, DECK + 26, ZC - 4, bx0 + 16, DECK + 27, ZC + 4, p.white);
  m.sphere(bx0 + 15, DECK + 29, ZC, 2.4, p.white);
  m.set(bx0 + 15, DECK + 29, ZC + 2, p.aqua);
  A.mast = [bx0 + 15.5, DECK + 32, ZC + 0.5];
  // planters with little trees (eco), sun loungers on the aft deck
  for (const x of [bx0 - 3, bx1 + 9]) { m.box(x - 2, DECK + 1, ZC + 4, x + 2, DECK + 3, ZC + 8, p.white); m.sphere(x, DECK + 6, ZC + 6, 2.6, p.leaf); m.sphere(x - 1, DECK + 7, ZC + 6.5, 1.4, p.leafL); }
  for (const z of [ZC - 6, ZC - 2]) { m.box(X0 + 4, DECK + 1, z, X0 + 12, DECK + 2, z + 2, p.white); m.box(X0 + 4, DECK + 3, z, X0 + 6, DECK + 4, z + 2, p.aqua); }
  m.cylinder(X0 + 9, ZC - 8, DECK + 1, DECK + 12, 0.4, p.chrome);
  shapeIn(m, X0 + 3, DECK + 12, ZC - 14, X0 + 15, DECK + 14, ZC - 2, (x, y, z) => ((x - X0 - 9) / 6) ** 2 + ((z - ZC + 8) / 6) ** 2 <= 1 && y <= DECK + 14 - Math.hypot(x - X0 - 9, z - ZC + 8) * 0.3, (x, y, z) => (Math.floor(Math.atan2(z - ZC + 8, x - X0 - 9) * 3) % 2 ? p.aqua : p.white));
  // flag staff at the stern + nav lights + underwater LEDs
  m.line(X0 + 1, DECK + 1, ZC, X0 - 1, DECK + 16, ZC, p.chrome, 0);
  A.flag = [X0 - 0.5, DECK + 16.5, ZC + 0.5];
  if (parts.sail !== 'none') A.flag = mastSail(m, p, parts.sail, X0 + 74, DECK + 1, DECK + 40, ZC, 12);
  for (let u = 10; u < 80; u += 8) m.set(X0 + u, WL - 1, Math.round(ZC + s.beam(u) * 0.95), p.led);
  engine(m, p, parts.engine, X0 + 2, DECK + 1, ZC, A, spin, bubbles, { x0: X0 + 2, x1: X0 + 20, h: 20, poleH: 20 });
  const front = twinFront(m, [p.white, p.chrome, p.whiteD], (x, y, z) => z >= ZC + 8 && y > DECK && x < bx0 - 4);
  return finish({
    m, front, wl: WL, zc: ZC, spin, bubbles,
    A: { ...A, stand: [X0 + 17, DECK + 1, ZC + 2], bow: [X0 + LEN, WL, ZC], stern: [X0 - 2, WL, ZC], top: [X0 + 40, DECK + 30, ZC], keel: [X0 + 40, 0, ZC], cabin: [(bx0 + bx1) / 2, DECK + 6, ZC + 10], under: [X0 + 40, WL - 1, ZC + 11] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.9, night: new Map([[p.glass, '#ffe2a0'], [p.glassD, '#ffd27a'], [p.led, '#7affff']]), lights: [['cabin', 80, '#ffe2a0', 0.5], ['under', 90, '#7affff', 0.45]],
  });
}

// ------------------------------------------------------------------ 5 eco catamaran (spinning turbines)

function catamaran(paint, trim, parts) {
  const m = new VoxelModel(104, 76, 36);
  const p = aeroPal(m, paint, trim);
  const X0 = 14, LEN = 74, ZC = 18, WL = 4, DECK = 10;
  const A = {}, spin = [], bubbles = [];
  // two slim hulls
  for (const sd of [-1, 1]) {
    const zc = ZC + sd * 10;
    hull(m, {
      x0: X0, len: LEN, zc, vee: 0.35,
      keel: (u) => 1 + 5 * Math.pow(sm(50, 74, u), 1.6), sheer: (u) => DECK + 1 + 2 * Math.pow(sm(50, 74, u), 1.4),
      beam: (u) => (u < 52 ? 3.8 : 3.8 * Math.sqrt(Math.max(0, 1 - ((u - 52) / 22.5) ** 2))), deck: () => DECK + 1,
      skin: (y, u, ys) => (y === ys ? p.trim : y <= WL - 1 ? p.bottom : y <= WL + 1 ? p.paint : p.white), deckC: () => p.white,
    });
  }
  applyDecal(m, p, parts.decal, ZC, X0 + 3, X0 + LEN - 6, WL + 2, DECK);
  // bridge deck (trampoline net forward)
  for (let x = X0 + 2; x <= X0 + 58; x++) for (let z = ZC - 9; z <= ZC + 9; z++) m.set(x, DECK, z, x > X0 + 44 ? ((x + z) % 2 ? p.rope : 0) : x % 3 ? p.deck : p.deckD);
  // cabin with wraparound glass + solar roof
  const cx0 = X0 + 22, cx1 = X0 + 44;
  m.box(cx0, DECK + 1, ZC - 7, cx1, DECK + 9, ZC + 7, (x, y, z) => (y <= DECK + 2 || y >= DECK + 8 ? p.white : (x + y) % 8 === 0 ? p.glassHi : p.glass));
  m.box(cx0 - 2, DECK + 10, ZC - 9, cx1 + 2, DECK + 10, ZC + 9, p.chrome);
  m.box(cx0 - 1, DECK + 11, ZC - 8, cx1 + 1, DECK + 11, ZC + 8, (x, y, z) => ((x + z) % 4 === 0 ? p.solarL : p.solar));
  // two wind turbines on the stern corners (blades spin as an overlay)
  for (const [k, sd] of [[0, -1], [1, 1]]) {
    const tx = X0 + 6, tz = ZC + sd * 8, top = DECK + 30 + k * 2;
    m.line(tx, DECK + 1, tz, tx, top, tz, p.white, 0.7);
    m.ellipsoid(tx + 1, top, tz, 2.6, 1.5, 1.5, p.white);
    m.set(tx + 3, top, tz, p.aqua);
    m.set(tx, top + 1, tz + 1, p.lime);
    A['turbine' + k] = [tx + 3.5, top + 0.5, tz + 2.5];
    spin.push({ at: 'turbine' + k, r: 10, n: 3, speed: 4 + k * 0.7 });
  }
  // mast + sail forward
  A.flag = mastSail(m, p, parts.sail, X0 + 50, DECK + 1, DECK + 40, ZC, 18);
  A.mast = A.flag;
  // planters along the cabin
  for (let x = cx0 + 2; x < cx1; x += 5) { m.box(x, DECK + 1, ZC + 8, x + 2, DECK + 2, ZC + 9, p.white); m.sphere(x + 1, DECK + 4, ZC + 8.5, 1.6, p.leafL); }
  m.set(X0 + LEN - 6, DECK, ZC + 14, p.ledG); m.set(X0 + LEN - 6, DECK, ZC - 14, p.ledR);
  engine(m, p, parts.engine === 'turbine' ? 'none' : parts.engine, X0, DECK + 1, ZC, A, spin, bubbles, { x0: X0 + 4, x1: X0 + 18, h: 16, poleH: 16 });
  const front = twinFront(m, [p.white, p.trim, p.leafL], (x, y, z) => z >= ZC + 7 && y > DECK && x >= cx0 - 1);
  return finish({
    m, front, wl: WL, zc: ZC, spin, bubbles,
    A: { ...A, stand: [X0 + 13, DECK + 1, ZC + 1], bow: [X0 + LEN, WL, ZC], stern: [X0 - 2, WL, ZC], top: [X0 + 40, DECK + 40, ZC], keel: [X0 + 40, 0, ZC], cabin: [(cx0 + cx1) / 2, DECK + 5, ZC + 8], lantern: [X0 + LEN - 5.5, DECK + 0.5, ZC + 14.5] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.9, night: new Map([[p.glass, '#ffe2a0'], [p.ledG, '#a8ff6a'], [p.ledR, '#ff6a6a']]), lights: [['cabin', 70, '#ffe2a0', 0.5], ['lantern', 40, '#a8ff6a', 0.6]],
  });
}

// ------------------------------------------------------------------ 6 bubble submarine

function submarine(paint, trim, parts) {
  const m = new VoxelModel(112, 64, 32);
  const p = aeroPal(m, paint, trim);
  const X0 = 14, LEN = 84, ZC = 16, WL = 9, CY = 7, R = 8.6;
  const A = {}, spin = [], bubbles = [];
  // cigar body: paint below, white top band, aqua stripe
  shapeIn(m, X0 - 2, 0, ZC - 10, X0 + LEN + 2, CY + R + 1, ZC + 10, (x, y, z) => {
    const u = (x - X0) / LEN;
    if (u < 0 || u > 1) return false;
    const prof = u < 0.2 ? Math.sqrt(1 - ((0.2 - u) / 0.2) ** 2) : u > 0.75 ? Math.sqrt(Math.max(0, 1 - ((u - 0.75) / 0.25) ** 2)) * 0.98 + 0.02 : 1;
    const r = R * Math.max(0.25, prof);
    return Math.hypot(y - CY, (z - ZC) * 1.05) <= r;
  }, (x, y) => (y > CY + 4.4 ? p.white : y > CY + 3.2 ? p.aqua : y < CY - 4 ? p.bottom : p.paint));
  applyDecal(m, p, parts.decal, ZC, X0 + 6, X0 + LEN - 10, CY - 3, CY + 3);
  for (let u = 18; u < 70; u += 9) porthole(m, X0 + u, CY, Math.round(ZC + R * 0.95), p.chrome, p.led);
  // glass bubble dome cockpit (open ribs at the front so the pilot shows), flat deck inside
  const dx = X0 + 30, dTop = CY + R - 1;
  for (let x = dx - 9; x <= dx + 9; x++) for (let z = ZC - 6; z <= ZC + 6; z++) m.set(x, dTop, z, p.white);
  shapeIn(m, dx - 11, dTop, ZC - 11, dx + 11, dTop + 12, ZC + 11, (x, y, z) => { const d = Math.hypot(x - dx, y - dTop, z - ZC); return d <= 10.6 && d > 9.6 && y > dTop; }, (x, y, z) => {
    const front = z > ZC + 1.5;
    const rib = Math.abs(Math.round((x - dx) / 4) * 4 - (x - dx)) < 0.6 || Math.abs(y - dTop - 1) < 0.6;
    if (front) return rib ? p.chrome : null;
    return rib ? p.chrome : (x + y) % 7 === 0 ? p.glassHi : p.glass;
  });
  // periscope, dive fins, tail fin + propeller shroud, nose light
  m.line(dx + 14, dTop, ZC - 2, dx + 14, dTop + 8, ZC - 2, p.chrome, 0.6);
  m.line(dx + 14, dTop + 8, ZC - 2, dx + 17, dTop + 8, ZC - 2, p.chrome, 0.6);
  for (const [u, w] of [[64, 6], [10, 5]]) for (const sd of [-1, 1]) m.box(X0 + u - 3, CY, ZC + sd * (R - 1), X0 + u + 2, CY, ZC + sd * (R + w), p.aqua);
  m.box(X0 + 2, CY, ZC, X0 + 7, CY + R + 4, ZC, p.aqua);
  for (let a = 0; a < TAU; a += 0.2) m.set(X0 - 2, CY + Math.sin(a) * 3.6, ZC + Math.cos(a) * 3.6, p.chrome);
  m.sphere(X0 + LEN, CY + 1, ZC, 1.6, p.lamp);
  A.flag = [dx + 14.5, dTop + 8.5, ZC - 1.5];
  if (parts.engine !== 'none') engine(m, p, parts.engine === 'outboard' ? 'bubble' : parts.engine, X0 + 1, CY + R - 2, ZC, A, spin, bubbles, { x0: X0 + 10, x1: X0 + 22, h: 12, poleH: 14 });
  if (!A.bubbles0) { A.bubbles0 = [X0 - 3, CY, ZC + 0.5]; bubbles.push('bubbles0'); }
  const front = twinFront(m, [p.chrome], (x, y, z) => z > ZC + 1.5 && y > dTop);
  return finish({
    m, front, wl: WL, zc: ZC, spin, bubbles,
    A: { ...A, stand: [dx, dTop + 1, ZC], bow: [X0 + LEN, WL, ZC], stern: [X0 - 3, WL, ZC], top: [dx, dTop + 12, ZC], keel: [X0 + 40, 0, ZC], sub: [X0 + LEN, CY + 1, ZC + 2], under: [X0 + 40, CY, ZC + 10], lantern: [X0 + LEN + 0.5, CY + 1.5, ZC + 1.5] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.8, night: new Map([[p.led, '#9affff'], [p.lamp, '#ffffff'], [p.glass, '#bff6ff']]), lights: [['sub', 60, '#ffffff', 0.6], ['under', 90, '#7affff', 0.5]],
  });
}

export const BOAT_TIERS = [
  { id: 'raft', name: 'Bubble Raft', desc: 'Pontoons, bamboo and a leaf sail.', build: raft },
  { id: 'dinghy', name: 'Bubble Dinghy', desc: 'Bouncy inflatable with a little motor.', build: dinghy },
  { id: 'skiff', name: 'Aero Skiff', desc: 'Sleek, glossy and quick.', build: skiff },
  { id: 'hydrofoil', name: 'Hydrofoil', desc: 'Flies over the waves on foils.', build: hydrofoil },
  { id: 'yacht', name: 'Glass Yacht', desc: 'Two decks of shining glass.', build: yacht },
  { id: 'catamaran', name: 'Eco Catamaran', desc: 'Twin hulls, wind turbines, solar roof.', build: catamaran },
  { id: 'submarine', name: 'Bubble Submarine', desc: 'A glass dome cockpit. Dive with the fish!', build: submarine },
];
export const BOAT_TIER_BY_ID = Object.fromEntries(BOAT_TIERS.map((b, i) => [b.id, i]));

export function buildBoatModel(tier, paint, trim = '#ffffff', parts = null) {
  const i = Math.max(0, Math.min(BOAT_TIERS.length - 1, tier | 0));
  const P2 = resolveParts(i, parts);
  if (parts?.hull && PART_BY.hull[parts.hull]) { paint = PART_BY.hull[parts.hull].color; trim = PART_BY.hull[parts.hull].trim; }
  const T = BOAT_TIERS[i].build(paint || '#2fb8e8', trim || '#ffffff', P2);
  T.flag = P2.flag; T.parts = P2; T.tier = i;
  return T;
}

// ------------------------------------------------------------------ flags

const FLAG_ROWS = {
  fish: ['............', '.....###....', '...######..#', '..#######.##', '..########..', '...######.##', '.....###...#', '............'],
  drop: ['............', '.....#......', '....###.....', '...#####....', '...#####....', '...#####....', '....###.....', '............'],
  leaf: ['............', '.......###..', '.....#####..', '...###o###..', '..##o####...', '..#o####....', '.o..##......', '............'],
  heart: ['............', '..##..##....', '.########...', '.########...', '..######....', '...####.....', '....##......', '............'],
  star: ['............', '.....#......', '....###.....', '.#########..', '...#####....', '...##.##....', '..#.....#...', '............'],
  smile: ['............', '...######...', '..#.#..#.#..', '..########..', '..#.####.#..', '..##....##..', '...######...', '............'],
  bubble: ['............', '....####....', '...#o..##...', '..#o....#...', '..#......#..', '...#....#...', '....####....', '............'],
  rainbow: ['RRRRRRRRRRRR', 'OOOOOOOOOOOO', 'YYYYYYYYYYYY', 'GGGGGGGGGGGG', 'BBBBBBBBBBBB', 'VVVVVVVVVVVV', 'RRRRRRRRRRRR', 'OOOOOOOOOOOO'],
};
export function buildFlagModel(id, paint = '#2fb8e8') {
  const rows = FLAG_ROWS[id] || FLAG_ROWS.fish;
  const w = rows[0].length, h = rows.length;
  const m = new VoxelModel(w, h, 1);
  const field = m.color('#ffffff', { jitter: 0.03 }), edge = m.color(id === 'leaf' ? '#3fae2a' : paint, { jitter: 0.04 });
  const ink = m.color(id === 'leaf' ? '#5cc832' : id === 'heart' ? '#ff4a8a' : id === 'star' ? '#ffcf3a' : id === 'bubble' ? '#59c3ff' : id === 'smile' ? '#ffd23a' : mix(paint, '#0a3a6e', 0.25), { jitter: 0.03 });
  const hi = m.color(id === 'leaf' ? '#d8f8a0' : '#ffffff', { jitter: 0 });
  const RB = { R: '#ff5a6a', O: '#ffb02a', Y: '#ffe24a', G: '#5cd84a', B: '#3fa8ff', V: '#a070ff' };
  const rb = Object.fromEntries(Object.entries(RB).map(([k, v]) => [k, m.color(v, { jitter: 0.02 })]));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[h - 1 - y][x];
    m.set(x, y, 0, rb[ch] || (x === 0 ? edge : ch === '#' ? ink : ch === 'o' ? hi : field));
  }
  if (id === 'fish') m.set(4, 4, 0, field);
  return m;
}

// ------------------------------------------------------------------ live bits: turbines + bubbles

// A: screen anchors relative to (bx, by); vs = px per voxel of the boat sprite.
export function drawBoatAnim(ctx, T, A, bx, by, t, dir = 1, vs = 2) {
  if (!T || !A) return;
  for (const s of T.spin || []) {
    const a = A[s.at];
    if (!a) continue;
    const hx = Math.round(bx + a[0]), hy = Math.round(by + a[1]);
    const L = s.r * vs;
    for (let i = 0; i < s.n; i++) {
      const ang = t * s.speed * dir + (i / s.n) * TAU;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let k = 1.5; k <= L; k += 0.8) {
        const w = k < L * 0.35 ? 2 : k > L * 0.85 ? 1 : 2;
        ctx.fillStyle = k > L * 0.82 ? '#2fd3e8' : '#f6fbff';
        ctx.fillRect(Math.round(hx + ca * k - w / 2), Math.round(hy + sa * k * 0.92 - w / 2), w, w);
      }
    }
    ctx.fillStyle = '#9fb4c8'; ctx.fillRect(hx - 1, hy - 1, 3, 3);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(hx - 1, hy - 1, 1, 1);
  }
  for (const k of T.bubbles || []) {
    const a = A[k];
    if (!a) continue;
    for (let i = 0; i < 6; i++) {
      const ph = (t * 0.8 + i / 6) % 1;
      const x = Math.round(bx + a[0] - dir * ph * 18 + Math.sin(t * 3 + i * 2) * 2), y = Math.round(by + a[1] - ph * 10);
      const r = 1 + (i % 2);
      ctx.globalAlpha = 1 - ph;
      ctx.fillStyle = '#e8ffff';
      ctx.fillRect(x - r, y, 1, 1); ctx.fillRect(x + r, y, 1, 1); ctx.fillRect(x, y - r, 1, 1); ctx.fillRect(x, y + r, 1, 1);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ previews (wardrobe Boat tab, Lab, dev)

const PREV = new Map();
const PREVIEW_YAW = 0, PREVIEW_PITCH = 24;
export function renderBoatPreview(tier, parts = null, o = {}) {
  const i = Math.max(0, Math.min(BOAT_TIERS.length - 1, tier | 0));
  const vs = 2 * (o.scale ?? 1);
  const P2 = resolveParts(i, parts);
  const key = i + '|' + JSON.stringify(P2) + '|' + vs;
  let pv = PREV.get(key);
  if (!pv) {
    const T = buildBoatModel(i, null, null, P2);
    const r = renderVoxels(T.m, { scale: vs, yaw: PREVIEW_YAW, pitch: PREVIEW_PITCH, outline: true, jitter: 0.18, glowRadius: 2 });
    const front = T.front.size ? renderVoxels(T.m, { scale: vs, yaw: PREVIEW_YAW, pitch: PREVIEW_PITCH, outline: true, jitter: 0.18, keepVoxel: (x, y, z) => T.front.has(T.m.get(x, y, z)) }).canvas : null;
    const piv = r.project(T.pivot[0], T.pivot[1], T.zc + 0.5);
    const A = {};
    for (const [k, p] of Object.entries(T.A)) if (p) { const q = r.project(p[0], p[1], p[2]); A[k] = [q[0] - piv[0], q[1] - piv[1]]; }
    const flagM = buildFlagModel(T.flag, PART_BY.hull[P2.hull].color);
    const flag = renderVoxels(flagM, { scale: vs * 0.5 * (T.flagScale || 1) * 1.6, yaw: 0, pitch: 0, outline: true, edges: 0, sideEdges: 0 }).canvas;
    pv = {
      T, canvas: r.canvas, glow: r.glow, front, flag, px: Math.round(piv[0]), py: Math.round(piv[1]), A, stand: A.stand, vs,
      drawFront(ctx, bx, by, t = 0, dir = 1) {
        if (this.front) ctx.drawImage(this.front, Math.round(bx - this.px), Math.round(by - this.py));
        if (this.A.flag) {
          const f = this.flag, w = f.width, h = f.height, fx = Math.round(bx + this.A.flag[0]), fy = Math.round(by + this.A.flag[1]);
          const st = Math.max(1, Math.round(vs / 2));
          for (let c = 0; c < w; c += st) { const k = c / w; const off = Math.round(Math.sin(t * 5 - c * 0.35) * k * 2.2); ctx.drawImage(f, c, 0, st, h, fx - c - st, fy - h + 4 + off, st, h); }
        }
        drawBoatAnim(ctx, this.T, this.A, bx, by, t, dir, vs);
      },
    };
    PREV.set(key, pv);
    if (PREV.size > 40) PREV.delete(PREV.keys().next().value);
  }
  return pv;
}
