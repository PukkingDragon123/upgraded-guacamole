// Depth zones (phase 6, Oceans agent). Every ocean continues far below its seabed shelf: under the shelf's rocky lip
// the camera, the hook and the fish go down through stacked zones, each with its own look, light and fish.
//
//   sunlit    the ocean's own scene (sky, surface, the shelf seabed with its plants); the (OS)cean's is the meadow
//   twilight  blue-violet water, canyon walls with sea fans, fewer plants, bioluminescent sparks
//   midnight  near-black, glowing creatures and growths
//   abyss     pitch dark: only a light radius around the hook / lantern, distant eyes, huge silhouettes, the floor
//
// World space (see camera.js): the old world spans [ocean.top, H] (H = screen height, the shelf seabed at the bottom).
// The deep column starts at the shelf lip (y = H) and runs down to `bottom`; zone heights are world px per ocean.
//   layoutZones(oceanId, H, surfaceY) -> {zones: [{id, name, y0, y1, m0, m1, top, ...style}], shelf, lip, bottom,
//                                         floorTop, floorH}
//   zoneAt(layout, y) -> zone           metresAt(layout, y) -> depth in m (0 above the surface)
//   speciesZones(sp, oceanId) -> ['sunlit', ...]   which zones a species lives in (sp.zone / sp.depthM override)
//   ZONE_POP                            population target multiplier per zone (deeper = sparser, scarier)
// Species may declare `zone: 'midnight' | ['twilight', 'midnight']` or `depthM: [min, max]` (metres, this ocean's
// scale); without either a heuristic places them by rarity and glow (deeper = rarer and scarier).

import { clamp, clamp01, lerp } from '../core/math.js';

export const ZONE_IDS = ['sunlit', 'twilight', 'midnight', 'abyss'];
export const ZONE_NAMES = { sunlit: 'Sunlit Zone', twilight: 'Twilight Zone', midnight: 'Midnight Zone', abyss: 'The Abyss' };
export const ZONE_POP = { sunlit: 1, twilight: 0.75, midnight: 0.55, abyss: 0.4 };
// rarity weight multipliers per zone: the deep favours the rare
export const ZONE_RARITY = {
  sunlit: { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1 },
  twilight: { common: 0.7, uncommon: 1.1, rare: 1.6, epic: 1.6, legendary: 1.2 },
  midnight: { common: 0.45, uncommon: 0.9, rare: 1.9, epic: 2.4, legendary: 1.8 },
  abyss: { common: 0.25, uncommon: 0.6, rare: 1.8, epic: 3, legendary: 3.5 },
};

// Per ocean: metres at the zone boundaries [sunlit top, twilight, midnight, abyss, bottom], deep zone heights in world
// px (twilight, midnight, abyss incl. the floor), and colours: water (top, bottom) per deep zone, rock (lit tone) per
// deep zone, the glow palette of its bioluminescence and the colour of the lantern light.
const DEF = {
  water: {
    twilight: ['#1f5c9e', '#2a2a76'], midnight: ['#1a1650', '#07071c'], abyss: ['#04040f', '#010103'],
  },
  rock: { twilight: ['#7484bc', '#5e58a0'], midnight: ['#46427a', '#2e2c4c'], abyss: ['#2c2a38', '#22202a'] },
  sponge: ['#ff9a5a', '#ff6a9a', '#ffd25a', '#c87aff', '#5ad8c8'],
  glow: ['#5affff', '#7affb0', '#c87aff', '#7aa8ff', '#ff7ad8'],
  lamp: '#ffe8b8',
  sediment: [[40, 38, 52], [52, 50, 66], [64, 60, 78]],
};
export const OCEAN_DEPTHS = {
  oscean: {
    m: [0, 15, 120, 600, 1500], px: [400, 440, 560],
    water: { twilight: ['#1c74a0', '#2c3486'], midnight: ['#191a58', '#080920'], abyss: ['#05050f', '#010103'] },
    rock: { twilight: ['#6a94a8', '#6a6cb0'], midnight: ['#3e4078', '#2c2c4c'], abyss: ['#28283a', '#202030'] },
    glow: ['#7affea', '#9ad8ff', '#c8ff9a', '#ff9ae8', '#5affff'],
    lip: { top: '#3cae3a', soil: ['#6a4a2e', '#5a3c26', '#4a3424'], rock: ['#5e6670', '#4e5560'] },
    floorProps: ['giant_skull', 'ribcage', 'sunken_pc', 'tube_worms', 'diver_helmet', 'glow_mushroom', 'anchor', 'vent_chimney'],
  },
  shallows: {
    m: [0, 40, 200, 1000, 4000], px: [460, 520, 620],
    lip: { top: '#e8cf95', soil: ['#c8a870', '#b08c58', '#8a6a44'], rock: ['#7a7a86', '#62626e'] },
    floorProps: ['sunken_boat', 'giant_skull', 'ribcage', 'anchor', 'tube_worms', 'glow_mushroom', 'diver_helmet', 'treasure_chest', 'vent_chimney'],
  },
  fjord: {
    m: [0, 60, 400, 1200, 2400], px: [540, 520, 560],
    water: { twilight: ['#1e4a72', '#22306a'], midnight: ['#141a4a', '#060a1c'], abyss: ['#03050e', '#010103'] },
    rock: { twilight: ['#5a6a86', '#4a5478'], midnight: ['#3a4060', '#2a2e44'], abyss: ['#262a34', '#1e2028'] },
    lip: { top: '#c8d8e0', soil: ['#7a8490', '#6a7380', '#58606c'], rock: ['#6a7280', '#565e6c'] },
    floorProps: ['anchor', 'giant_skull', 'ribcage', 'tube_worms', 'crystal_cluster', 'glow_mushroom', 'barrel', 'vent_chimney'],
  },
  junkyard: {
    m: [0, 35, 250, 1100, 3800], px: [480, 560, 640],
    water: { twilight: ['#2a5a6a', '#2a2e66'], midnight: ['#16163e', '#08081a'], abyss: ['#04040a', '#010102'] },
    rock: { twilight: ['#5e6a7a', '#4e4e78'], midnight: ['#3c3c5a', '#2e2c44'], abyss: ['#2a2830', '#201e26'] },
    lip: { top: '#9a8a6a', soil: ['#7a6a52', '#665844', '#524638'], rock: ['#6a6670', '#57545e'] },
    floorProps: ['crt_pile', 'server_rack', 'broken_robot', 'giant_skull', 'tire', 'tube_worms', 'glow_mushroom', 'satellite_dish', 'vent_chimney'],
  },
  metropolis: {
    m: [0, 50, 500, 2000, 6000], px: [520, 600, 700],
    water: { twilight: ['#1c3a7a', '#2a2676'], midnight: ['#16124a', '#07061c'], abyss: ['#040410', '#010103'] },
    glow: ['#ff5ad8', '#5affff', '#ffd25a', '#7aa8ff', '#9a7aff'],
    lip: { top: '#8a96b0', soil: ['#6a7490', '#5a6280', '#4a5070'], rock: ['#5a6280', '#4a5070'] },
    floorProps: ['pillar_ruin', 'statue_head', 'arch_ruin', 'pillar_broken', 'crystal_cluster', 'giant_skull', 'glow_mushroom', 'vent_chimney'],
  },
  volcano: {
    m: [0, 45, 350, 1800, 7000], px: [520, 600, 720],
    water: { twilight: ['#4a3a6a', '#3a2252'], midnight: ['#24102a', '#0e0410'], abyss: ['#080204', '#020001'] },
    rock: { twilight: ['#5e4a5a', '#4e3a4e'], midnight: ['#3e2a34', '#2e2028'], abyss: ['#2a1c1e', '#221618'] },
    glow: ['#ff8a3a', '#ffd25a', '#ff5a3a', '#c87aff', '#5affff'],
    lamp: '#ffd8a8',
    sediment: [[46, 30, 30], [58, 38, 36], [72, 46, 40]],
    lip: { top: '#3a2a2a', soil: ['#4a3030', '#3a2424', '#2a1c1c'], rock: ['#4a3a3a', '#3a2c2c'] },
    floorProps: ['vent_chimney', 'vent_chimney', 'crystal_cluster', 'giant_skull', 'ribcage', 'tube_worms', 'glow_mushroom', 'pillar_broken'],
  },
  abyss: {
    // The Deep Ocean: its own scene is already the twilight zone; the column below goes midnight -> abyss
    m: [0, 0, 1000, 4000, 10900], px: [0, 640, 860], noSunlit: true,
    water: { twilight: ['#0c1a40', '#0a1438'], midnight: ['#0a1030', '#040818'], abyss: ['#020208', '#000001'] },
    rock: { twilight: ['#3a4270', '#30385e'], midnight: ['#2e3458', '#242844'], abyss: ['#22222e', '#1a1a24'] },
    lip: { top: '#4a5484', soil: ['#3a4270', '#30385e', '#282e4e'], rock: ['#3a4270', '#30385e'] },
    floorProps: ['giant_skull', 'ribcage', 'statue_head', 'pillar_broken', 'vent_chimney', 'crystal_cluster', 'glow_mushroom', 'tube_worms', 'arch_ruin'],
  },
};
export const depthDef = (id) => ({ ...DEF, ...(OCEAN_DEPTHS[id] || OCEAN_DEPTHS.shallows), water: { ...DEF.water, ...(OCEAN_DEPTHS[id]?.water || {}) }, rock: { ...DEF.rock, ...(OCEAN_DEPTHS[id]?.rock || {}) } });

export const LIP_H = 46;      // nominal thickness of the shelf's rocky lip (world px)
export const FLOOR_H = 230;   // the abyss floor's perspective frame (horizon .. front) at the bottom of the column

// Zone layout for an ocean at screen height H. surfaceY = the still waterline (null: none in view, e.g. the abyss).
export function layoutZones(oceanId, H, surfaceY = null) {
  const d = depthDef(oceanId);
  const [pT, pM, pA] = d.px;
  const shelf = H;
  const s = Number.isFinite(surfaceY) ? surfaceY : -40;
  const zones = [];
  let y = shelf;
  if (!d.noSunlit) zones.push({ id: 'sunlit', y0: s, y1: shelf, m0: d.m[0], m1: d.m[1], top: s, deep: false });
  else zones.push({ id: 'twilight', y0: s, y1: shelf, m0: d.m[0], m1: d.m[2], top: s, deep: false, native: true });
  if (pT > 0) { zones.push({ id: 'twilight', y0: y, y1: y + pT, m0: d.m[1], m1: d.m[2], top: y + LIP_H + 14, deep: true }); y += pT; }
  zones.push({ id: 'midnight', y0: y, y1: y + pM, m0: d.m[2], m1: d.m[3], top: y + (pT > 0 ? 0 : LIP_H + 14), deep: true }); y += pM;
  zones.push({ id: 'abyss', y0: y, y1: y + pA, m0: d.m[3], m1: d.m[4], top: y, deep: true }); y += pA;
  for (const z of zones) z.name = ZONE_NAMES[z.id];
  const bottom = y;
  return { id: oceanId, def: d, zones, shelf, lip: shelf, bottom, floorTop: bottom - FLOOR_H, floorH: FLOOR_H, H };
}

export function zoneAt(L, y) {
  const zs = L.zones;
  for (let i = zs.length - 1; i >= 0; i--) if (y >= zs[i].y0) return zs[i];
  return zs[0];
}

export function metresAt(L, y) {
  const zs = L.zones;
  if (y <= zs[0].y0) return 0;
  for (const z of zs) if (y < z.y1) return lerp(z.m0, z.m1, clamp01((y - z.y0) / Math.max(1, z.y1 - z.y0)));
  return zs[zs.length - 1].m1;
}

// 0 at the top of the deep column .. 1 at its bottom (for colour ramps); negative above the shelf.
export function deepK(L, y) { return (y - L.shelf) / Math.max(1, L.bottom - L.shelf); }

// Colour / darkness ramps through the deep zones: each zone runs from its own top value to the next zone's top value
// (the last zone to its own bottom value), so the column has no seams at the zone boundaries.
function ramp(L, y, table, fallback) {
  const zs = L.zones;
  let i = zs.length - 1;
  while (i > 0 && y < zs[i].y0) i--;
  const z = zs[i], nx = zs[i + 1];
  const a = table[z.id] || table[fallback], b = nx ? (table[nx.id] || a) : a;
  const k = clamp01((y - z.y0) / Math.max(1, z.y1 - z.y0));
  return [a[0], nx ? b[0] : a[1], k, z];
}

// Water colour at world y, as [r, g, b].
export function waterAt(L, y) {
  const [a, b, k] = ramp(L, y, L.def.water, 'twilight');
  return mixRGB(hex(a), hex(b), k);
}
export function rockAt(L, y) {
  const [a, b, k] = ramp(L, y, L.def.rock, 'twilight');
  return mixRGB(hex(a), hex(b), k);
}

// Darkness (0..1) and its tint at world y below the shelf (the biome's own light rules above it).
const DARK = { twilight: [0.34, 0.7], midnight: [0.82, 0.92], abyss: [0.955, 0.985] };
const TINT = { twilight: [28, 22, 84], midnight: [6, 6, 26], abyss: [0, 0, 2] };
const TINTR = { twilight: [TINT.twilight, TINT.midnight], midnight: [TINT.midnight, TINT.abyss], abyss: [TINT.abyss, TINT.abyss] };
export function deepDark(L, y) {
  const z = zoneAt(L, y);
  if (!z.deep) return null;
  const [a, b, k] = ramp(L, y, DARK, 'twilight');
  const t = TINTR[z.id] || TINTR.twilight;
  return { dark: lerp(a, b, k), tint: mixRGB(t[0], t[1], k) };
}

// Which zones a species lives in.
export function speciesZones(sp, oceanId, L = null) {
  if (sp.zone) return Array.isArray(sp.zone) ? sp.zone : [sp.zone];
  if (Array.isArray(sp.depthM) && L) {
    const [a, b] = sp.depthM;
    const out = L.zones.filter((z) => z.m1 > a && z.m0 < b).map((z) => z.id);
    if (out.length) return out;
  }
  const q = new Set(sp.quirks || []);
  if (q.has('intro') || q.has('commuter') || q.has('thief') || q.has('mimic') || sp.spawn?.requires) return oceanId === 'abyss' ? ['twilight'] : ['sunlit'];
  const glow = q.has('glow') || q.has('lure') || q.has('halo') || q.has('pulse');
  const r = sp.rarity;
  if (oceanId === 'abyss') {
    if (r === 'legendary') return ['abyss'];
    if (r === 'epic') return ['midnight', 'abyss'];
    if (glow || r === 'rare') return ['twilight', 'midnight'];
    return ['twilight'];
  }
  if (r === 'legendary') return ['abyss'];
  if (r === 'epic') return glow ? ['midnight', 'abyss'] : ['midnight'];
  if (glow) return ['twilight', 'midnight'];
  if (r === 'rare') return ['sunlit', 'twilight'];
  if (sp.activity === 'night' && r === 'uncommon') return ['sunlit', 'twilight'];
  return ['sunlit'];
}

// ------------------------------------------------------------------ small colour helpers (no allocations per call)
export function hex(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function mixRGB(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
export function rgbHex(c) { return '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
