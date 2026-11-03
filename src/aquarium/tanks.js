// Aquarium tank tiers (phase 3) and the scene layout that places the tank in the Aero room.
//
//   TANK_TIERS[i]          {id, name, shape: 'round'|'box'|'wall', cap (extra fish over stats.tankCap),
//                           rate (income multiplier), offlineH (offline earnings cap, hours), fish (fish scale
//                           in the full view), plants [back, side, front, tufts], water: 'aero'|'reef'}
//   tankTier(state)        0..5 (state.tank.tier, raised to the best Lab unlock 'tank:<id>')
//   tierCapBonus(state)    extra tank capacity of the current tier (game.recomputeStats adds it to tankCap)
//   aeroRate(rec, sp, stats, tier) -> Aero per minute for one fish (rarity, size, mutations, happiness, tier)
//   sceneSize(key, tier, W, H) -> {sw, sh} scene (room) size for a view: 'full' | 'window' | 'mini'
//   sceneLayout(key, tier, sw, sh) -> {tank: {x, y, w, h}, deskY, u, fishScale, decorScale, ...}
//     tank = the inner glass rect (TankSpace W x H) in scene coordinates.

import { clamp, clamp01 } from '../core/math.js';
import { unlocked } from '../game/lab.js';
import { valueMultiplier } from '../fish/traits.js';
import * as shop from '../game/shopdata.js';

export const TANK_IDS = ['jar', 'bowl', 'smalltank', 'bigtank', 'reeftank', 'wallaquarium'];

export const TANK_TIERS = [
  { id: 'jar', name: 'Goldfish Jar', shape: 'round', cap: 0, rate: 1, offlineH: 4, fish: 0.5, plants: [1, 0, 1, 2], water: 'aero' },
  { id: 'bowl', name: 'Bubble Bowl', shape: 'round', cap: 2, rate: 1.15, offlineH: 5, fish: 0.56, plants: [2, 1, 1, 3], water: 'aero' },
  { id: 'smalltank', name: 'Glass Tank', shape: 'box', cap: 4, rate: 1.3, offlineH: 6, fish: 0.62, plants: [4, 2, 2, 3], water: 'aero' },
  { id: 'bigtank', name: 'Big Tank', shape: 'box', cap: 7, rate: 1.5, offlineH: 7, fish: 0.72, plants: [6, 2, 2, 4], water: 'aero' },
  { id: 'reeftank', name: 'Reef Tank', shape: 'box', cap: 10, rate: 1.75, offlineH: 8, fish: 0.84, plants: [7, 3, 3, 5], water: 'reef' },
  { id: 'wallaquarium', name: 'Wall Aquarium', shape: 'wall', cap: 14, rate: 2.1, offlineH: 10, fish: 0.96, plants: [9, 4, 3, 6], water: 'aero' },
];

// Aero per minute by rarity (falls back to the shop table when the Lab rebalances it).
const RATE = { common: 2, uncommon: 3.5, rare: 6, epic: 10, legendary: 20 };

export function tankTier(state) {
  let t = clamp(Math.floor(Number(state?.tank?.tier) || 0), 0, TANK_TIERS.length - 1);
  try {
    for (let i = TANK_IDS.length - 1; i > t; i--) if (unlocked(state, 'tank', TANK_IDS[i])) { t = i; break; }
  } catch { /* lab not ready */ }
  return t;
}

export function tierCapBonus(state) { return TANK_TIERS[tankTier(state)].cap; }

export function aeroRate(rec, sp, stats = {}, tier = 0, bonus = 1) {
  const base = shop.COIN_RATE?.[sp?.rarity] ?? RATE[sp?.rarity] ?? 2;
  const happy = clamp01(rec.happiness ?? 0.7);
  return base * valueMultiplier(rec) * (0.6 + 0.8 * happy) * (TANK_TIERS[tier]?.rate || 1) * (stats.coinMul || 1) * bonus;
}

// ------------------------------------------------------------------ scene sizes

const WIN_W = [250, 266, 290, 326, 362, 404];
export const FRAME = { window: { lid: 15, side: 4, base: 14 }, mini: { lid: 10, side: 3, base: 3 } };

export function sceneSize(key, tier, W, H, taskbar = 24) {
  if (key === 'full') return { sw: W, sh: H - taskbar };
  if (key === 'mini') return { sw: 176, sh: 112 };
  const sw = Math.min(WIN_W[tier] || 300, W - 40);
  return { sw, sh: Math.round(sw * 0.64) };
}

// Reference full scene is 960 x 516 (1920 x 1080 at 2x minus the taskbar).
const REF_W = 960, REF_H = 516;
// Full-view tank sizes in reference px: [width, height, lid, base, deskY (fraction of sh)]
const FULL = [
  [236, 222, 0, 0, 0.8],
  [318, 236, 0, 0, 0.8],
  [384, 228, 13, 12, 0.81],
  [536, 288, 15, 13, 0.83],
  [668, 330, 14, 15, 0.86],
  [826, 398, 14, 14, 0.9],
];

export function sceneLayout(key, tier, sw, sh) {
  const T = TANK_TIERS[tier];
  const [fw, fh, lid0, base0, deskF] = FULL[tier];
  const out = { key, tier, sw, sh, shape: T.shape, id: T.id };
  if (key === 'full') {
    const u = Math.min(sw / REF_W, sh / REF_H);
    const w = Math.round(fw * u), h = Math.round(fh * u);
    const lid = Math.round(lid0 * u), base = Math.round(base0 * u);
    const deskY = Math.round(sh * deskF);
    const x = Math.round((sw - w) / 2);
    let y;
    if (T.shape === 'wall') y = Math.round(sh * 0.47 - h / 2);
    else y = deskY - base - h - (T.shape === 'round' ? Math.round(3 * u) : 0);
    Object.assign(out, { u, deskY, tank: { x, y, w, h }, lid, base, zoom: 1 });
    out.fishScale = T.fish * clamp(u, 0.8, 1.25);
  } else {
    // close-up: the tank fills most of the scene, the room shows around it
    const deskY = Math.round(sh * (T.shape === 'wall' ? 0.97 : 0.88));
    const frac = [0.84, 0.82, 0.8, 0.84, 0.88, 0.92][tier];
    let w, h;
    if (T.shape === 'round') {
      h = Math.round((deskY - sh * 0.1) * (tier === 0 ? 0.98 : 0.92));
      w = Math.round(h * fw / fh);
      if (w > sw * frac) { w = Math.round(sw * frac); h = Math.round(w * fh / fw); }
    } else {
      w = Math.round(sw * frac);
      h = Math.round(w * fh / fw);
    }
    const k = w / fw;
    const lid = Math.max(lid0 ? 3 : 0, Math.round(lid0 * k)), base = Math.max(base0 ? 3 : 0, Math.round(base0 * k));
    const maxH = (T.shape === 'wall' ? sh - 8 : deskY - 6) - lid - base;
    if (h > maxH) { h = maxH; w = Math.round(h * fw / fh); }
    const x = Math.round((sw - w) / 2);
    let y;
    if (T.shape === 'wall') y = Math.round((sh - h) / 2);
    else y = deskY - base - h - (T.shape === 'round' ? 1 : 0);
    const u = w / fw; // room props scale with the tank so the close-up stays in proportion
    Object.assign(out, { u, deskY, tank: { x, y, w, h }, lid, base, zoom: 2 });
    const fullW = FULL[tier][0];
    out.fishScale = clamp(T.fish * (w / fullW), key === 'mini' ? 0.22 : 0.28, 0.7);
  }
  out.decorScale = Math.max(out.fishScale * 0.7, out.tank.w / 960);
  return out;
}

// TankSpace options for a tier (interior geometry), given the inner glass size.
export function tankOpts(tier, iw, ih, key) {
  const T = TANK_TIERS[tier];
  const small = key === 'mini' ? 0.5 : key === 'window' ? 0.75 : 1;
  const cell = clamp(Math.round(iw / (T.shape === 'round' ? 70 : 130)), 2, 7);
  const step = Math.max(1, Math.round(cell / 2.3));
  if (T.shape === 'round') {
    // glass silhouette ellipse resting on the bottom of the rect; its top is cut by the opening at y = 0
    const rx = iw / 2 - 1, ry = tier === 0 ? Math.min(iw / 2, ih * 0.53) - 1 : ih * 0.56;
    return {
      shape: 'round', K: 0.13, vpy: -0.3, surf: Math.round(ih * (tier === 0 ? 0.2 : 0.17)),
      floorFront: Math.round(ih * 0.85), slope: Math.round(ih * 0.03), cell, step, seed: 7 + tier,
      edgeRise: 0, bowl: 0.15, water: T.water,
      ell: { cx: iw / 2, cy: ih - ry - 1, rx, ry },
      detail: small,
    };
  }
  return {
    shape: 'box', K: 0.5, vpy: 0.44, surf: Math.max(3, Math.round(ih * 0.05)), floorFront: ih - Math.max(8, Math.round(ih * 0.13)),
    slope: Math.max(5, Math.round(ih * 0.075)), cell, step, seed: 7 + tier, edgeRise: 0.75, bowl: 0.4, water: T.water, detail: small,
  };
}
