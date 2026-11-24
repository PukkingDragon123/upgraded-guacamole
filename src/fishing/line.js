// Fishing line length [crate26]: the hook can only go as deep as your line reaches. Pure data + helpers (no imports
// from the game, so rods.js / lab.js / the UI can use it without cycles).
//
// Line length is measured in ZONES of reach, the same in every ocean: 1 = the whole ocean scene (surface down to the
// shelf seabed, the Sunlit Zone), 2 = through the Twilight Zone, 3 = through the Midnight Zone, 4 = the abyss floor.
// A fractional part reaches that far into the next zone (2.5 = halfway down the Midnight Zone). The first zone of an
// ocean (its own scene, whatever it is called) is always fully reachable, so the shallow fishing (the lesson, the
// smoke test) never meets the limit.
//   rodBaseLine(rod)            base reach of a rods.js rod (by tier; a few rods have a bonus)
//   TACKLE_LINE {tackleId: add} Workshop line spools
//   lineReachOf(rod, stats, tackle[]) -> reach (rod base + Lab `lineReach` + tackle), clamped 1..4
//   reachY(L, reach) -> world y of the deepest point the hook may reach in a depthzones.js layout (Infinity without one)
//   lineLabel(reach) -> 'Sunlit' | 'Twilight' | 'Midnight' | 'Abyss' | 'Hadal' | 'Abyss floor' (the deepest zone it gets into)
//   lineInfo(reach) -> {label, zone, pct}  (pct = how far into that zone)

export const LINE_ZONES = ['sunlit', 'twilight', 'midnight', 'abyss'];
export const LINE_ZONE_NAMES = ['Sunlit', 'Twilight', 'Midnight', 'Abyss'];
export const LINE_MAX = 4;
// [deep28] the Hadal Zone starts this far down (depthzones.js HADAL_K of the abyss zone)
export const HADAL_REACH = 3.7;
// The starter Twig & String reaches the Sunlit Zone and the rocky lip below it; each rod tier spools a little more.
export const LINE_BASE = 1.1;
export const LINE_PER_TIER = 0.07;
const ROD_BONUS = { leviathan: 0.4, glow: 0.15, trident: 0.2 };
export const TACKLE_LINE = { line_braid: 0.15, line_glow: 0.3, line_titan: 0.5 };

export function rodBaseLine(rod) {
  const tier = Math.max(0, Number(rod?.tier) || 0);
  return Math.round((LINE_BASE + tier * LINE_PER_TIER + (ROD_BONUS[rod?.id] || 0)) * 100) / 100;
}

export function lineReachOf(rod, stats = null, tackle = []) {
  let v = rod?.stats?.line ?? rodBaseLine(rod);
  v += Number(stats?.lineReach) || 0;
  for (const t of tackle || []) v += TACKLE_LINE[t?.id] || 0;
  return Math.max(1, Math.min(LINE_MAX, Math.round(v * 100) / 100));
}

export function reachY(L, reach) {
  const zs = L?.zones;
  if (!zs?.length) return Infinity;
  if (reach >= LINE_MAX) return Infinity; // the whole column: down to the floor
  let y = zs[0].y1; // the ocean's own scene is always in reach
  for (let i = 1; i < zs.length; i++) {
    const z = zs[i], ci = LINE_ZONES.indexOf(z.id);
    const k = reach - (ci < 0 ? i : ci);
    if (k <= 0) return y;
    if (k < 1) return z.y0 + (z.y1 - z.y0) * k;
    y = z.y1;
  }
  return Infinity;
}

export function lineInfo(reach) {
  const r = Math.max(1, Math.min(LINE_MAX, Number(reach) || 1));
  if (r >= LINE_MAX - 0.01) return { label: 'Abyss floor', zone: 'abyss', pct: 100 };
  if (r >= HADAL_REACH) return { label: 'Hadal', zone: 'abyss', pct: Math.round(Math.min(1, r - 3) * 100) };
  // the deepest zone the line gets at least 15 % into (the twig's peek over the rocky lip still says Sunlit)
  const i = Math.max(0, Math.min(3, Math.floor(r - 0.15)));
  const pct = i === 0 ? 100 : Math.round(Math.min(1, r - i) * 100);
  return { label: LINE_ZONE_NAMES[i], zone: LINE_ZONES[i], pct };
}
export const lineLabel = (reach) => lineInfo(reach).label;
