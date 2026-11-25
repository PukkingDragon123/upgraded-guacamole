// [cel29] Cel (toon) shading: ONE tuning block for every 3D / voxel renderer.
//
//   TOON                      the look: band thresholds, hue-shifted shadow / highlight colours, rim, specular size
//   setShading('cel' | 'classic'), celOn()   the global mode (Settings > Shading; boot sets it before any sprite bakes)
//   toonRamp7(hex, contrast)  7-step CEL ramp for the CPU voxel ray renderer (src/gfx/voxel.js), same index meaning as
//                             ramp7: 0 deep core, 1 deep shadow, 2 shadow, 3 base (mid), 4 lit, 5 highlight, 6 specular
//   TOON.gl / TOON.intro      the uniform values the GLSL toon blocks read (lowpoly.js sprites / scenes, voxgl.js intro)
//   ?shading=classic          (any page URL) starts in the classic look: handy for A/B screenshots
//
// Model (the same in all renderers): one top-left key light. Light is quantised into clean bands: LIT (warm), MID (the
// painted colour), SHADOW (cooler, purpler, a little more saturated) and an optional DEEP core (bottoms, creases); a
// cool ambient floor lifts the darks so nothing goes muddy. Glossy materials get a small hard-edged specular shape;
// the silhouette edge facing away from the key light gets a thin rim band. Emissive parts stay unshaded and bright.
// Band edges are crisp: on the CPU they are pixel-exact thresholds of a smooth light field (voxel jitter is damped
// so they do not fray); on the GPU they are smoothstepped over one pixel (fwidth) so they never alias or band.

import { hexToHsl, hslToHex } from '../core/color.js';

export const TOON = {
  // --- CPU voxel renderer (voxel.js): thresholds on its tone scale (ramp steps: 3 = the base colour)
  vox: {
    deep: 1.3,        // below: DEEP shadow (bottoms, deep AO)
    shadow: 2.62,     // below: SHADOW (the side turned from the light: ~2.3 at the default camera)
    lit: 3.62,        // at / above: LIT (top faces: ~4.3)
    hi: 4.9,          // at / above: HIGHLIGHT (lit convex edges)
    jitter: 0.4,      // per-voxel tone jitter multiplier (clean bands; a whisper of hand-placed texture stays)
    ao: 0.95,         // AO multiplier (contact shadows still fall into the shadow band)
    specCut: 0.55,    // a glint (spec * pow(n.h, specPow)) above this becomes the hard specular shape
    specPow: 2.2,     // multiplies each material's specPow: higher = smaller highlight shapes
    rim: 1,           // rim band on / off (1 = on)
    smoothAdd: 0.4,   // materials with smoothed normals get this much more smoothing (clean band contours)
  },
  // --- band colours (CPU ramps); hue shifts in degrees, toward the shadow / light hues
  shadowHue: 255,     // shadows drift toward blue-violet ...
  shadowShift: 22,    // ... by this many degrees
  shadowL: 0.7,       // shadow lightness (x base)
  shadowSat: 0.04,    // shadow saturation lift (grey colours get more: they have none of their own)
  deepShift: 34,
  deepL: 0.5,
  coreL: 0.34,
  floorL: 0.085,      // ambient floor: shadows never fall below this lightness (unless the base itself is darker)
  litHue: 48,         // highlights drift warm
  litShift: 9,
  litL: 0.2,          // lit = base + (1 - base) * litL
  hiL: 0.42,
  specL: 0.74,
  // --- rim (CPU: a 1-device-px band inside the outline on the side turned from the light; GPU: fresnel band)
  rimColor: '#c8f4ff',
  rimMix: 0.38,       // CPU: rim colour = lit tone mixed toward rimColor by this
  // --- GPU (lowpoly.js sprites / scenes, voxgl.js intro): thresholds on half-lambert light (0 = back, 1 = facing)
  gl: {
    deep: 0.28,       // half-lambert (n.l * 0.5 + 0.5) below: DEEP (undersides)
    shadow: 0.6,      // below: SHADOW (n.l < 0.2: the side turned from the light)
    lit: 0.86,        // above: LIT (n.l > 0.72: faces turned up toward the key light)
    soft: 0.014,      // band edge half-width in light units (~1 px on a sprite): crisp but never stair-stepped
    shadowTint: [0.64, 0.6, 0.9],    // multiplies the colour in shadow (cool / purple)
    shadowAdd: [0.018, 0.012, 0.05], // ambient floor (cool lift so darks stay clean)
    deepTint: [0.46, 0.41, 0.78],
    deepAdd: [0.025, 0.015, 0.07],
    litTint: [1.06, 1.03, 0.96],     // warm lit ...
    litLift: 0.17,                   // ... x (1 + 2 * litLift) in its own hue, then 35 % of litLift toward white
    litAdd: [0.03, 0.02, 0.0],
    rim: 0.75,        // rim band strength (x the material's rim)
    rimWidth: 0.24,   // rim band: 1 - n.v above (1 - rimWidth)
    spec: 0.9,        // hard specular strength
    specSize: 1.0,    // highlight size multiplier
    env: 0.35,        // glossy env reflection kept on opaque parts (glass keeps more)
    voxSmooth: 0.78,  // voxel meshes: this much of the smoothed surface normal (clean band shapes), the rest face normal
  },
  // --- the WebGL intro's voxel world (voxgl.js): thresholds on half-lambert x AO (shares the gl tints)
  intro: { deep: 0.25, shadow: 0.45, lit: 0.66 },
};

let mode = 'cel';
// dev A/B: any page with ?shading=classic starts in the classic look
try { if (typeof location !== 'undefined' && /[?&]shading=classic\b/.test(location.search)) mode = 'classic'; } catch { /* no location */ }
export function setShading(m) { mode = m === 'classic' ? 'classic' : 'cel'; }
export function shadingMode() { return mode; }
export function celOn() { return mode === 'cel'; }

function hueToward(h, target, amount) {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}
// grey colours have no hue to shift: they take the target hue with a little saturation instead
function shifted(hex, target, deg, satAdd, lMul, lAdd) {
  const [h0, s0, l0] = hexToHsl(hex);
  const grey = s0 < 0.08;
  const h = grey ? target : hueToward(h0, target, deg);
  // (very saturated colours lose a little in shadow: a darker HSL colour at full saturation glows instead of shading)
  const s = grey ? Math.min(0.24, s0 + Math.max(0, satAdd) * 3) : Math.min(1, s0 + (satAdd > 0 ? satAdd * (1.2 - s0) - (lMul < 1 ? Math.max(0, s0 - 0.6) * 0.4 : 0) : satAdd));
  const l = l0 * lMul + (1 - l0) * lAdd;
  return hslToHex(h, s, l);
}

const rampCache = new Map();
export function toonRamp7(hex, contrast = 1) {
  const key = hex + '|' + contrast;
  let r = rampCache.get(key);
  if (r) return r;
  const T = TOON, c = contrast;
  const l0 = hexToHsl(hex)[2];
  const floor = Math.min(l0 * 0.8, T.floorL);
  const dark = (lm, deg, sat) => {
    const lMul = Math.max(1 - (1 - lm) * c, l0 > 0 ? floor / l0 : 0);
    return shifted(hex, T.shadowHue, deg * Math.min(1.4, c), sat, lMul, 0);
  };
  const light = (la, deg, sat) => shifted(hex, T.litHue, deg * Math.min(1.4, c), sat, 1, Math.min(0.95, la * c));
  r = [dark(T.coreL, T.deepShift + 6, T.shadowSat + 0.04), dark(T.deepL, T.deepShift, T.shadowSat + 0.03), dark(T.shadowL, T.shadowShift, T.shadowSat), hex,
    light(T.litL, T.litShift, -0.02), light(T.hiL, T.litShift + 6, -0.07), light(T.specL, T.litShift + 10, -0.25)];
  rampCache.set(key, r);
  if (rampCache.size > 4096) rampCache.delete(rampCache.keys().next().value);
  return r;
}
