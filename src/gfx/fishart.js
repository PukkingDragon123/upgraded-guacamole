// Procedural pixel-art creature rasteriser: high-res, layered, with expressive dynamic faces.
//
// Every output pixel is inverse-mapped into the creature's local space (faces +x, y down, origin =
// body centre, 1 unit = 1 logical px at scale 1) and tested against body, fins, tail and extras, so
// sprites stay crisp at any rotation / scale / phase and are then cached.
//
// Two APIs share the same painters:
//  - rasterFish(c, p): whole creature baked into one sprite (spritecache.frame(); face baked from
//    p.blink / p.mouth / p.expr).
//  - Layered rig (used by fishrig.js): rigGeom(c, q) gives one shared origin per (angle, scale, inflate)
//    bucket plus face/anchor positions; rasterLayer(c, layer, q) paints 'tail' | 'back' | 'body' | 'front'
//    on their own phases; eyeSprite / mouthSprite paint the dynamic face (look, blink, emotions, talking).
//
// Style: realistic anatomy, 7-tone hue-shifted ramps quantised with a 2x2 checker only between tones,
// countershading (dark back -> pale belly), specular strip along the upper flank, operculum and
// pre-operculum curves, nostril, staggered scale arcs, lateral line, rayed translucent fins with darker
// edges, near-black selective outline, realistic eyes (iris ring, pupil, glint).
//
// Look schema additions (all optional, backwards compatible):
//  toon: true -> cartoon face overlays (lids, brows, blush, sweat, hearts...) for comedic species only;
//    other creatures express emotions realistically (pupil size, look bias, gape, gill flare, dorsal
//    raise, colour flush, twitch) via fishrig.js / realCues().
//  body.tip (snout half-height fraction; profile nose = front roundness exponent, 1 = wedge).
//  shade {back, belly}: countershading band boundaries in v (-1 top .. 1 bottom). spec: specular strength.
//  col.head: separate head colour (e.g. sockeye). head {u (operculum), nostril, preop}. eyeIris default.
//  pattern: every pattern accepts umin/umax/vmin/vmax, tone (shift tones instead of recolouring),
//    keepTone, body (skip head). New types: bars (perch), facets, plates, speckle, ocellus, scribble, dots.
//  fins: pelvic {from,to,h}; fin.spots (colour), fin.alpha, fin.spines; tail.spots; pectoral.spines.
//  eye: lid, brow (false hides brows), mirror, pupilSize, behind (drawn before the others).
//  mouth: type + 'gulper' | 'emoticon' (screen face); w, sag (jaw droop), teeth, rest (resting gape),
//    smile (base curve), line (jaw-line colour).
//  extras: clownnose, monocle (on eye 0), halo, badge (notification), bite (chunk missing), usb (plug snout),
//    feelers (gourami threads), barbel (chin lure), dome (barreleye head), barnacles, bandage, briefcase
//    (anchor only, game draws it), cap {style: cap|beanie|tophat|crown}, antennae {style: bug|rabbit},
//    lure {spinner: true (loading spinner tip), r}, whiskers {len, count}. Fine lines have no outline.
//    Accessories: glasses {style: shades|round|square|patch, both}, sword {len}, hammer {len, w}, guitar {u, size,
//    angle}, horn {u, len, angle}, ears {style: cat|dog}, wings {style: bat}, mane {u, r, w}, arrow {u, v, angle},
//    juggle (three balls), coin, stem, collar {style: fur|vampire}, heart {u, v, r}; cap styles + porkpie, cowboy,
//    pirate, helmet (visor over the head), hood, mohawk; beanie {stripes}. kinds: + 'star' (starfish);
//    chain head + 'box' (cardboard box).
//  look.glitch 0..1 (row slicing + RGB split), look.gills / look.lateral / look.noGill, look.scaleSize.
//  kinds: + 'octopus' (dumbo), 'chain' (head painter + preview); ray {square, bsod, manta};
//    blob {blobfish}; crab {shell: round|mouse|mech}; jelly {glow, tentacleCount, gonad, noFace}.

import { TAU, clamp, clamp01, lerp, smoothstep, bayer, hash2, noise2, fract } from '../core/math.js';
import { pack, ramp, shade, mix, adjust, invert, hexToHsl, hslToHex, unpack } from '../core/color.js';
import { PixelBuffer } from './pixel.js';

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'scared', 'surprised', 'love', 'sleepy', 'dizzy', 'smug', 'determined', 'tired', 'disgust'];

// nose: front curve exponent (low = tapered snout), tip: snout half-height fraction at the mouth,
// peak: deepest point, tailW: caudal peduncle half-height fraction, taper: rear falloff.
const SHAPES = {
  oval: { nose: 2.1, peak: 0.4, tailW: 0.36, taper: 1, tip: 0.2 },
  torpedo: { nose: 1.8, peak: 0.36, tailW: 0.3, taper: 0.9, tip: 0.18 },
  round: { nose: 2.8, peak: 0.46, tailW: 0.38, taper: 1.3, tip: 0.24 },
  disc: { nose: 2.3, peak: 0.45, tailW: 0.3, taper: 1.1, tip: 0.18 },
  long: { nose: 1.9, peak: 0.25, tailW: 0.45, taper: 0.6, tip: 0.25 },
  box: { nose: 6, peak: 0.3, tailW: 0.45, taper: 1.6, tip: 0.5 },
  blunt: { nose: 4, peak: 0.3, tailW: 0.36, taper: 1, tip: 0.42 },
  pointy: { nose: 1.25, peak: 0.45, tailW: 0.28, taper: 1, tip: 0.1 },
};

const withA = (c, a) => ((c & 0x00ffffff) | ((a & 255) << 24)) >>> 0;
const P = (hex, a = 255) => pack(hex, a) >>> 0;

// ---------------------------------------------------------------------------
// Variants (mutations / shiny) transform colours before ramps are built.

export function variantColor(hex, variant, role = 'body') {
  if (!variant || !hex) return hex;
  let c = hex;
  if (variant.shiny) c = adjust(c, { h: variant.shinyHue ?? 150, sMul: 1.15 });
  switch (variant.mutation) {
    case 'albino':
      c = role === 'eye' ? '#ff5a7a' : mix(adjust(c, { sMul: 0.15 }), '#fff2f4', 0.7);
      break;
    case 'melanistic':
      c = role === 'eye' ? '#e8d26a' : adjust(c, { sMul: 0.55, lMul: 0.38 });
      break;
    case 'neon':
      c = role === 'eye' ? c : adjust(c, { sMul: 1.6, s: 0.25, lMul: 1.05, l: 0.05 });
      break;
    case 'pastel':
      c = role === 'eye' ? c : adjust(c, { sMul: 0.5, lMul: 0.55, l: 0.42 });
      break;
    case 'golden': {
      const [, s, l] = hexToHsl(c);
      c = role === 'eye' ? c : hslToHex(44 + (l - 0.5) * 20, 0.75 + s * 0.2, clamp(l * 0.9 + 0.12, 0.2, 0.9));
      break;
    }
    case 'inverted':
      c = role === 'eye' ? c : invert(c);
      break;
    case 'ghost':
      c = role === 'eye' ? '#9ef7ff' : mix(adjust(c, { sMul: 0.3 }), '#dff8ff', 0.55);
      break;
    case 'crimson':
      c = role === 'eye' ? c : adjust(c, { h: 0 - hexToHsl(c)[0] + 355, sMul: 1.2 });
      break;
    case 'ocean':
      c = role === 'eye' ? c : adjust(c, { h: 205 - hexToHsl(c)[0], sMul: 1 });
      break;
    case 'galaxy':
      c = role === 'eye' ? c : mix(c, '#2a1b55', 0.35);
      break;
    default:
      break;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Compile a look description into a fast raster spec.

const MOUTH_W = { small: 0.22, big: 0.38, fangs: 0.32, lips: 0.2, beak: 0.22, none: 0, gulper: 0 };

export function compileLook(look, variant = null) {
  const kind = look.kind || 'fish';
  const b = look.body || {};
  const shape = { ...SHAPES[b.shape || 'oval'], ...b };
  const col = look.col || look.chain?.col || {};
  const vc = (h, role) => variantColor(h, variant, role);
  const base = col.body || '#ff9944';
  const bodyHex = vc(base);
  const backHex = vc(col.back || shade(base, -0.25));
  const bellyHex = vc(col.belly || shade(base, 0.45));
  const finHex = vc(col.fin || shade(base, 0.1));
  const contrast = look.contrast ?? 1;
  const toRamp = (hex) => ramp(hex, contrast).map((h) => P(h));
  const L = b.len ?? 16, H = b.h ?? 9;
  const k = clamp(Math.min(H / 9, L / 18), 1, 8);
  const c = {
    kind, look, variant, vc, L, H, k, shape,
    hump: b.hump ?? 0,
    belly: b.belly ?? 0.05,
    wave: b.wave ?? 0.5,
    bend: (b.wave ?? 0.5) * H * 0.11,
    bodyR: toRamp(bodyHex),
    backR: toRamp(backHex),
    bellyR: toRamp(bellyHex),
    finR: toRamp(finHex),
    bodyHex, backHex, bellyHex, finHex,
    outlineHex: col.outline ? vc(col.outline) : shade(backHex, -0.78),
    alpha: look.translucent ? Math.round(255 * (look.translucent === true ? 0.5 : look.translucent)) : 255,
    finAlpha: look.finAlpha ?? 0.93,
    scales: look.scales ?? L >= 26,
    scaleSize: look.scaleSize ?? clamp(2.4 + k * 0.6, 3, 6),
    shine: look.shine ?? true,
    gills: look.gills ?? L >= 12,
    lateral: look.lateral ?? L >= 30,
    raySp: clamp(1.7 + k * 0.25, 2, 3),
    patterns: (look.pattern || []).map((p) => ({ ...p, R: toRamp(vc(p.color || '#ffffff', 'pattern')), R7: TONES7.map((a) => P(shade(vc(p.color || '#ffffff', 'pattern'), a))) })),
    tail: { type: 'fork', len: L * 0.38, spread: H * 0.55, flap: 0.32, ...(look.tail || {}) },
    fins: [],
    eyes: [],
    mouth: { type: 'small', v: 0.18, ...(look.mouth || {}) },
    extras: (look.extras || []).map((e) => ({ ...e })),
    glow: false,
    toRamp,
  };
  c.outlineP = P(col.outline ? c.outlineHex : mix(shade(backHex, -0.9), '#0b0910', 0.55));
  const R7 = (hex) => TONES7.map((a) => P(shade(satd(hex), a * contrast)));
  c.R7 = R7;
  c.T = { back: R7(backHex), body: R7(bodyHex), belly: R7(bellyHex), head: col.head ? R7(vc(col.head)) : null };
  c.vb = look.shade?.back ?? -0.3;
  c.vbel = look.shade?.belly ?? 0.3;
  c.toon = !!look.toon;
  c.spec = look.spec ?? 1;
  c.tail.R = toRamp(vc(look.tail?.color || finHex));
  c.tail.R7 = TONES7.map((a) => P(shade(satd(vc(look.tail?.color || finHex)), a * contrast)));
  if (c.tail.spots) c.tail.spotP = P(vc(c.tail.spots));
  c.mouth.R = toRamp(vc(look.mouth?.color || '#e86a7a'));
  c.mouth.w = look.mouth?.w ?? (c.mouth.type === 'gulper' ? L * 0.42 : Math.max(1.5, H * (MOUTH_W[c.mouth.type] ?? 0.17)));
  c.mouth.lineP = P(vc(look.mouth?.line || shade(bodyHex, -0.72)));

  const fin = (spec, slot) => {
    if (!spec || spec.type === 'none') return;
    c.fins.push({
      slot,
      type: spec.type || 'tri',
      from: spec.from ?? 0.3,
      to: spec.to ?? 0.65,
      h: spec.h ?? H * 0.4,
      lean: spec.lean ?? 0.6,
      R: toRamp(vc(spec.color || finHex)),
      R7: TONES7.map((a) => P(shade(satd(vc(spec.color || finHex)), a * contrast))),
      spotP: spec.spots ? P(vc(spec.spots)) : 0,
      alpha: spec.alpha,
      rays: spec.rays ?? true,
      count: spec.count ?? 4,
      spines: spec.spines ?? spec.type === 'spiky',
    });
  };
  fin(look.dorsal === undefined ? { type: 'tri' } : look.dorsal, 'top');
  fin(look.anal === undefined ? { type: 'tri', from: 0.55, to: 0.78, h: H * 0.25 } : look.anal, 'bottom');
  if (look.dorsal2) fin(look.dorsal2, 'top');
  if (look.pelvic) fin({ type: 'tri', from: 0.3, to: 0.42, h: H * 0.28, lean: 1.1, ...look.pelvic }, 'bottom');
  c.pectoral = look.pectoral === null ? null : {
    u: 0.34, v: 0.42, len: Math.max(2.5, H * 0.32), w: 0.36, angle: 0.55, ...(look.pectoral || {}),
  };
  if (c.pectoral) {
    c.pectoral.R = toRamp(vc(look.pectoral?.color || finHex));
    c.pectoral.R7 = TONES7.map((a) => P(shade(satd(vc(look.pectoral?.color || finHex)), a * contrast)));
  }

  const lidHex = (e) => vc(e.lid || bodyHex);
  const mkEye = (e, def) => {
    const o = { type: 'normal', ...def, ...e };
    o.pupil = P(vc(o.color || '#0c0a12', 'eye'));
    o.irisR = o.iris ? toRamp(vc(o.iris, 'eye')) : null;
    o.realIris = ramp(adjust(vc(o.iris || look.eyeIris || '#e8bc4a', 'eye'), { l: 0.06, sMul: 1.1 })).map((h) => P(h));
    o.sclera = P(o.sclera || '#ffffff');
    o.glowHex = o.type === 'glow' ? vc(o.glow || '#9ffcff', 'eye') : null;
    o.lidR = ramp(lidHex(o)).map((h) => P(h));
    if (o.type === 'glow') c.glow = true;
    return o;
  };
  c.eyes.push(mkEye(look.eye || {}, { u: 0.17, v: -0.2, r: Math.max(1, H * 0.15) }));
  const e0 = c.eyes[0];
  c.opU = look.head?.u ?? clamp(e0.u + (e0.r * 2.1) / L + 0.04, 0.14, 0.38);
  c.nostril = look.head?.nostril ?? true;
  c.preop = look.head?.preop ?? true;
  if (c.pectoral) {
    if (look.pectoral?.u == null) c.pectoral.u = c.opU + 0.035;
    if (look.pectoral?.v == null) c.pectoral.v = 0.42;
    if (look.pectoral?.len == null) c.pectoral.len = Math.max(2.5, H * 0.3);
  }
  for (const e of look.moreEyes || []) c.eyes.push(mkEye({ color: look.eye?.color, ...e }, { brow: false }));
  for (const p of c.patterns) if (p.glow) c.glow = true;
  for (const e of c.extras) {
    if (e.color) e.P = P(vc(e.color, 'extra'));
    if (e.color2) e.P2 = P(vc(e.color2, 'extra'));
    if (e.glow) c.glow = true;
    if (e.type === 'monocle') c.monocle = e;
    if (e.type === 'glasses') c.glasses = e;
    if (e.type === 'bite') c.hasBite = true;
  }
  if (variant?.mutation === 'neon') c.glow = true;
  if (variant?.mutation === 'galaxy') c.patterns.push({ type: 'galaxy', R: toRamp('#2a1b55'), R7: TONES7.map((a) => P(shade('#2a1b55', a))) });
  if (variant?.pattern) {
    const pc = variant.patternColor || shade(bodyHex, variant.pattern === 'spots' ? 0.5 : -0.45);
    const vp = { type: variant.pattern, color: pc, R: toRamp(pc), R7: TONES7.map((a) => P(shade(pc, a))), count: 3, size: 1.2 * k, seed: variant.seed || 3 };
    if (variant.pattern === 'stripes') { vp.at = [-0.35, 0.05, 0.42]; vp.width = 0.09; }
    if (variant.pattern === 'bands') { vp.at = [0.3, 0.55, 0.78]; vp.width = 0.045; }
    if (variant.pattern === 'spots') vp.density = 0.5;
    c.patterns.push(vp);
  }
  if (kind === 'chain') c.chain = { segs: 14, r: 4, head: 'eel', ...(look.chain || {}) };
  if (kind === 'jelly' && look.glow) c.glow = true;
  if (kind === 'ray' && look.bsod) c.glow = true;
  if (kind === 'squid' && (look.eyeGlow || look.photophores)) c.glow = true;
  if (kind === 'crab' && look.shell === 'mech') c.glow = true;
  if (kind === 'chain' && c.chain.glow) c.glow = true;
  return c;
}

// ---------------------------------------------------------------------------
// Geometry (cached per inflate step).

function profile(s, u, inflate) {
  let peak = s.peak, nose = s.nose, tailW = s.tailW, taper = s.taper, tip = s.tip ?? 0.15;
  if (inflate > 0) {
    peak = lerp(peak, 0.5, inflate);
    nose = lerp(nose, 2.4, inflate);
    tailW = lerp(tailW, 0.2, inflate);
    taper = lerp(taper, 1.6, inflate);
    tip = lerp(tip, 0.25, inflate);
  }
  if (u < 0 || u > 1) return 0;
  if (u <= peak) {
    const t = u / peak;
    const round = Math.sqrt(Math.min(1, u / 0.03));
    return round * (tip + (1 - tip) * (1 - Math.pow(1 - t, nose)));
  }
  const t = (u - peak) / (1 - peak);
  return tailW + (1 - tailW) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * t), taper);
}

function geomOf(c, inflate = 0) {
  const key = Math.round(inflate * 16);
  if (!c._geo) c._geo = new Map();
  let G = c._geo.get(key);
  if (G) return G;
  inflate = key / 16;
  const L = c.L * (1 + 0.3 * inflate), H = c.H * (1 + 1.0 * inflate);
  const N = Math.max(24, Math.ceil(L * 2));
  const top = new Float32Array(N + 2), bot = new Float32Array(N + 2);
  for (let i = 0; i <= N + 1; i++) {
    const u = Math.min(1, i / N);
    const pr = profile(c.shape, u, inflate);
    top[i] = (H / 2) * pr * (1 + c.hump * Math.sin(Math.PI * clamp01((u - 0.04) / 0.78)));
    bot[i] = (H / 2) * pr * (1 + c.belly * Math.sin(Math.PI * clamp01(u * 1.2)));
  }
  const interp = (arr, u) => {
    if (u <= 0) return arr[0];
    if (u >= 1) return arr[N];
    const f = u * N, i = f | 0, t = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  };
  G = {
    L, H, halfL: L / 2, inflate,
    TL: c.tail.type === 'none' ? 0 : c.tail.len * (1 - 0.2 * inflate),
    TS: c.tail.spread,
    spikeLen: c.look.spikes ? c.look.spikes * inflate : 0,
    halfTop: (u) => interp(top, u),
    halfBot: (u) => interp(bot, u),
  };
  G.tailBase = Math.max(0.8, G.halfTop(0.985) * 0.92);
  G.mouthY = c.mouth.v * (H / 2) * 0.6;
  c._geo.set(key, G);
  return G;
}

const spineAt = (c, u, phase) => c.bend * Math.sin(TAU * phase - u * 3.2) * u * u;

// Clean pixel-art quantisation: a 2x2 checker only where a value sits between two tones.
function rampPick(R, b, x, y, dither = 0.85) {
  const n = R.length - 1;
  const chk = VOXM ? 0 : ((x + y) & 1) ? 0.5 : -0.5;
  const idx = clamp(Math.round(b * n + chk * Math.min(0.3, dither * 0.3)), 0, n);
  return R[idx];
}
// 7-tone index pick with checker transitions; idx in tone units (0 darkest .. 6 lightest).
function tone(R, idx, x, y) {
  const chk = VOXM ? 0 : ((x + y) & 1) ? 0.2 : -0.2;
  return R[clamp(Math.round(5 + (idx - 3) * 1.5 + chk), 0, R.length - 1)];
}
// 10 hue-shifted tones per colour (index 5 = base); tone() maps the 0..6 authoring scale onto them.
const TONES7 = [-0.9, -0.75, -0.58, -0.4, -0.21, 0, 0.17, 0.35, 0.54, 0.74];
const satd = (hex, k = 1.12) => adjust(hex, { sMul: k });

function blendPacked(a, b, t) {
  const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
  const br = b & 255, bg = (b >>> 8) & 255, bb2 = (b >>> 16) & 255;
  const r = ar + (br - ar) * t, g = ag + (bg - ag) * t, bl = ab + (bb2 - ab) * t;
  const al = Math.max(a >>> 24, b >>> 24);
  return ((al << 24) | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

// Selective outline: neighbour colour darkened and pulled toward the creature's outline colour.
// Near-black selective outline: the neighbour colour pushed almost to black, keeping a hint of hue.
function outlineFnFor(c) {
  if (c._olFn) return c._olFn;
  const cache = new Map();
  const [or, og, ob] = unpack(c.outlineP);
  c._olFn = (n) => {
    let o = cache.get(n);
    if (o === undefined) {
      const [r, g, b, a] = unpack(n);
      if (a === 253) { cache.set(n, 0); return 0; }
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      const [dr, dg, db] = unpack(P(shade(hex, -0.86)));
      const t = 0.6;
      const oa = a >= 200 ? 255 : Math.min(255, a + 120);
      o = ((oa << 24) | (Math.round(db + (ob - db) * t) << 16) | (Math.round(dg + (og - dg) * t) << 8) | Math.round(dr + (or - dr) * t)) >>> 0;
      cache.set(n, o);
    }
    return o;
  };
  return c._olFn;
}

function boundsFor(extent, angle, scale) {
  const [x0, y0, x1, y1] = extent;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const X = (x * ca - y * sa) * scale, Y = (x * sa + y * ca) * scale;
    mnx = Math.min(mnx, X); mny = Math.min(mny, Y); mxx = Math.max(mxx, X); mxy = Math.max(mxy, Y);
  }
  const pad = 2;
  const w = Math.ceil(mxx - mnx) + pad * 2 + 1;
  const h = Math.ceil(mxy - mny) + pad * 2 + 1;
  return { w, h, ox: Math.floor(-mnx) + pad, oy: Math.floor(-mny) + pad };
}

// Canvas-space rect (clamped) covering a local-space box under rotation/scale about origin (ox, oy).
function rectFor(box, angle, scale, ox, oy, w, h) {
  const [x0, y0, x1, y1] = box;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const X = (x * ca - y * sa) * scale + ox, Y = (x * sa + y * ca) * scale + oy;
    mnx = Math.min(mnx, X); mny = Math.min(mny, Y); mxx = Math.max(mxx, X); mxy = Math.max(mxy, Y);
  }
  return {
    x0: clamp(Math.floor(mnx) - 1, 0, w), y0: clamp(Math.floor(mny) - 1, 0, h),
    x1: clamp(Math.ceil(mxx) + 2, 0, w), y1: clamp(Math.ceil(mxy) + 2, 0, h),
  };
}

// ---------------------------------------------------------------------------
// Generic fish: part painters. Each returns a packed colour (0 = empty). `gOut` receives glow colour.

let gOut = 0;
let patLight = 0;
// Voxel albedo mode (voxelfish.js): no checker dither, no 2D form shading / outline, raw buffers out.
let VOXM = false;

/** Run fn with the painters in voxel albedo mode (flat tones; the voxel renderer does the lighting). */
export function voxAlbedo(fn) {
  const prev = VOXM;
  VOXM = true;
  try { return fn(); } finally { VOXM = prev; }
}

/** rasterLayer in voxel albedo mode: returns {data, glow, w, h, x, y} (packed pixels) or null data. */
export function rasterLayerVox(c, layer, q) {
  return voxAlbedo(() => rasterLayer(c, layer, q));
}

/** Kind/chain head face sprite raw pixels (voxel albedo mode). */
export function chainHeadVox(c, s) {
  return voxAlbedo(() => {
    const r = c.chain.r * s;
    const hb = Math.ceil(r * 4.5 + 6);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    const face = paintChainHead(c, buf, null, hb, hb, 0, s, 0);
    return { data: buf.data, w: buf.w, h: buf.h, o: hb, face };
  });
}

/** Chain segment colour at normalised disc coords (dx, dy in -1..1). */
export function chainSegColor(c, dx, dy, x, y) {
  return voxAlbedo(() => segColor(c, dx, dy, x, y));
}

function finShape(type, t, phase, count) {
  switch (type) {
    case 'sail': return Math.pow(Math.sin(Math.PI * clamp01(t)), 0.6);
    case 'spiky': return (0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * count))) * Math.sin(Math.PI * clamp01(t)) ** 0.35;
    case 'long': return Math.min(1, t * 6, (1 - t) * 5);
    case 'round': return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    case 'wave': return Math.min(1, t * 5, (1 - t) * 4) * (0.72 + 0.28 * Math.sin(t * 9 - phase * TAU * 2));
    case 'trail': return t < 0.84 ? Math.pow(t / 0.84, 0.75) : Math.pow((1 - t) / 0.16, 0.55);
    case 'tri':
    default:
      return t < 0.28 ? t / 0.28 : Math.pow((1 - t) / 0.72, 0.85);
  }
}

// Tail membership. a: distance behind the tail base (>=0), b: perpendicular offset.
function tailHit(type, a, b, TL, TS, base, phase) {
  if (a < -0.5) return false;
  const s = a / TL;
  if (s > 1.35) return false;
  const ab = Math.abs(b);
  switch (type) {
    case 'none': return false;
    case 'round': {
      if (s > 1) return false;
      const outer = base + (TS - base) * Math.sqrt(Math.max(0, s)) * 1.05;
      return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 2 * 0.25;
    }
    case 'veil': {
      const edge = 1 + 0.1 * Math.sin(b * 1.3 / Math.max(1, TS / 6) + phase * TAU);
      if (s > edge) return false;
      const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.45) * 1.1;
      return ab <= outer;
    }
    case 'truncate': {
      if (s > 1) return false;
      return ab <= base + (TS - base) * s;
    }
    case 'lyre': {
      if (s > 1.25) return false;
      const outer = base + (TS - base) * Math.pow(Math.min(1, Math.max(0, s)), 0.55);
      if (s > 1) return ab > outer - Math.max(1.2, TS * 0.12) && ab <= outer;
      const inner = s < 0.35 ? -1 : (outer - Math.max(1.6, TS * 0.18)) * smoothstep(0.35, 0.8, s);
      return ab <= outer && ab >= inner;
    }
    case 'moon': {
      if (s > 1) return false;
      const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.5);
      const inner = TS * 0.8 * Math.max(0, (s - 0.4) / 0.6) ** 1.4;
      return ab <= outer && ab >= inner;
    }
    case 'pointed': {
      if (s > 1) return false;
      return ab <= base * (1 - s) + 0.4;
    }
    case 'whip': {
      if (s > 1) return false;
      return ab <= base * Math.pow(1 - s, 1.6) + 0.45;
    }
    case 'clavus': {
      if (s > 1.05) return false;
      const outer = base + (TS - base) * Math.sqrt(Math.max(0, Math.min(1, s * 1.6)));
      const edge = 0.82 + 0.18 * Math.abs(Math.cos((b / Math.max(1, TS)) * Math.PI * 2.5));
      return ab <= outer && s <= edge;
    }
    case 'lobe': {
      if (s > 1.3) return false;
      if (s > 0.92) return ab <= base * 0.55 * (1.3 - s) / 0.38;
      const outer = base + (TS - base) * Math.sqrt(Math.max(0, s));
      return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 3 * 0.3;
    }
    case 'fan': {
      if (s > 1) return false;
      const outer = base + (TS - base) * Math.sqrt(Math.max(0, s));
      return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 4 * 0.15;
    }
    case 'fork':
    default: {
      if (s > 1) return false;
      const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.8);
      const inner = TS * 0.62 * Math.max(0, (s - 0.5) / 0.5);
      return ab <= outer && ab >= inner;
    }
  }
}

function tailPix(c, G, lx, ly, px, py, s, tp, baseY) {
  if (G.TL <= 0) return 0;
  const flapA = Math.sin(TAU * tp + 0.7) * c.tail.flap;
  const fore = 1 - 0.2 * Math.abs(Math.sin(TAU * tp + 0.7));
  const dx = lx + G.halfL, dy = ly - baseY;
  const ca = Math.cos(flapA), sa = Math.sin(flapA);
  const a = (-dx * ca + dy * sa) / fore;
  const b = dx * sa + dy * ca;
  const bb = b - Math.sin(TAU * tp + 0.7 - 1.2) * c.tail.flap * Math.max(0, a) * 0.25;
  const type = c.tail.type;
  if (!tailHit(type, a + 0.6, bb, G.TL, G.TS, G.tailBase, tp)) return 0;
  const R = c.tail.R7;
  const st = a / G.TL;
  const rr = Math.hypot(bb, a + G.TL * 0.4);
  const ang = Math.atan2(bb, a + G.TL * 0.4);
  const da = ((VOXM ? Math.max(c.raySp, 2.6 / s) : c.raySp) * 1.15) / (G.TL * 1.4);
  const onRay = c.tail.rays !== false && Math.abs(fract(ang / da + 0.5) - 0.5) * da * rr * s < 0.55;
  const e1 = 1 / s;
  const edge = !tailHit(type, a + 0.6 + e1, bb, G.TL, G.TS, G.tailBase, tp) || !tailHit(type, a + 0.6, bb + e1, G.TL, G.TS, G.tailBase, tp) || !tailHit(type, a + 0.6, bb - e1, G.TL, G.TS, G.tailBase, tp);
  let idx = onRay ? 1.7 : 4;
  if (st < 0.14) idx = st < 0.07 ? 1.8 : 2.8;
  if (edge && st > 0.1) idx = 1.4;
  if (!edge && !onRay && st > 0.55 && Math.abs(bb) < G.TS * 0.7 && bb < 0) idx = 4.6;
  if (bb > 0 && !edge && !onRay) idx = 3.6;
  if (c.tail.spotP && !edge && hash2(Math.floor(lx * s / 2), Math.floor(ly * s / 2), 13) < 0.13) return c.tail.spotP;
  const al = onRay || edge || st < 0.14 ? 255 : Math.round(255 * Math.min(1, c.finAlpha));
  if (VOXM) idx = 3.3 + (idx - 3.3) * 0.5;
  return withA(tone(R, idx, px, py), al);
}

function finPix(c, G, lx, ly, px, py, s, fp, sw, still, raise = 0) {
  const uu = (G.halfL - lx) / G.L;
  const uc = clamp01(uu);
  const e1 = 1 / s;
  for (const f of c.fins) {
    const top = f.slot === 'top';
    const hMul = 1 + 0.4 * raise * (top ? 1 : 0.6);
    const lean = f.lean * (1 - 0.45 * raise);
    const sy = sw === null ? 0 : spineAt(c, uc, sw);
    const edgeY0 = top ? sy - G.halfTop(uc) : sy + G.halfBot(uc);
    const dist = top ? edgeY0 - ly : ly - edgeY0;
    const fhMax = f.h * hMul;
    if (dist < -2.5 || dist > fhMax * 1.15 + 1) continue;
    const ue = uu - (lean * Math.max(0, dist)) / G.L;
    const t = (ue - f.from) / (f.to - f.from);
    if (t < 0 || t > 1) continue;
    const wob = still ? 1 : 1 + 0.08 * Math.sin(TAU * fp - t * 7);
    const fh = fhMax * finShape(f.type, t, fp, f.count) * wob;
    const along = (ue - f.from) * G.L;
    let sp = VOXM ? Math.max(c.raySp, 2.6 / s) : c.raySp;
    if (f.spines) sp = Math.max(sp * 1.5, ((f.to - f.from) * G.L) / Math.max(3, f.count * 1.6));
    const rf = fract(along / sp + 0.5) - 0.5;
    const onRay = f.rays && Math.abs(rf) * sp * s < 0.6;
    const R = f.R7;
    if (f.spines) {
      const memb = fh * (1 - 0.42 * Math.pow(Math.abs(rf) * 2, 0.9));
      if (dist > memb && !(onRay && dist <= fh * 1.1)) continue;
      if (dist > memb) return withA(R[1], 255);
      const edge = dist > memb - e1;
      let idx = onRay ? 1.2 : 4;
      if (edge) idx = 1.8;
      if (dist < e1 * 1.2) idx = 2;
      if (f.spotP && !onRay && hash2(Math.floor(lx * s / 2), Math.floor(ly * s / 2), 17) < 0.14) return f.spotP;
      return withA(tone(R, idx, px, py), onRay || edge ? 255 : Math.round(255 * (f.alpha ?? c.finAlpha)));
    }
    if (dist > fh) continue;
    const edge = dist > fh - e1 || t < e1 / Math.max(1, (f.to - f.from) * G.L) || t > 1 - e1 / Math.max(1, (f.to - f.from) * G.L);
    let idx = onRay ? 1.7 : 4;
    if (edge) idx = 1.4;
    else if (dist < e1 * 1.2) idx = 1.9;
    else if (!onRay && dist > fh * 0.6) idx = 4.5;
    if (!top && !edge && !onRay) idx -= 0.4;
    if (f.spotP && !edge && hash2(Math.floor(lx * s / 2), Math.floor(ly * s / 2), 17) < 0.14) return f.spotP;
    const al = onRay || edge ? 255 : Math.round(255 * (f.alpha ?? c.finAlpha));
    if (VOXM) idx = 3.3 + (idx - 3.3) * 0.5;
    return withA(tone(R, idx, px, py), al);
  }
  return 0;
}

function pecPix(c, G, lx, ly, px, py, s, fp, baseY, still) {
  const pec = c.pectoral;
  if (!pec) return 0;
  const pecX = G.halfL - pec.u * G.L;
  const pecY = baseY + pec.v * G.halfBot(pec.u);
  const pecA = pec.angle + (still ? 0 : Math.sin(TAU * fp) * 0.4);
  const dx = lx - pecX, dy = ly - pecY;
  const ca = Math.cos(pecA), sa = Math.sin(pecA);
  const a = -(dx * ca - dy * sa);
  const b = dx * sa + dy * ca;
  if (a < -0.4 || a > pec.len) return 0;
  const st = a / pec.len;
  const wdt = pec.len * pec.w * Math.pow(Math.max(0, st), 0.6) * Math.sqrt(Math.max(0, 1 - Math.pow(st, 3))) * 1.1 + 0.5 * (1 - st);
  if (Math.abs(b) > wdt + 0.3) return 0;
  const ang = Math.atan2(b, a + pec.len * 0.35);
  const rr = Math.hypot(b, a + pec.len * 0.35);
  const da = ((pec.spines ? 2.2 : 1.15) * (VOXM ? Math.max(c.raySp, 2.6 / s) : c.raySp)) / (pec.len * 1.35);
  const rf = fract(ang / da + 0.5) - 0.5;
  const onRay = Math.abs(rf) * da * rr * s < 0.6;
  if (pec.spines && !onRay && st > 1 - 0.45 * Math.abs(rf) * 2) return 0;
  const R = pec.R7;
  const edge = !pec.spines && (Math.abs(b) > wdt - 1 / s || st > 0.97 - 0.04 * Math.abs(b) / Math.max(1, wdt));
  let idx = onRay ? 2.2 : 4.6;
  if (edge) idx = 1.1;
  if (st < 0.12) idx = 2;
  if (VOXM) idx = 3.3 + (idx - 3.3) * 0.5;
  return withA(tone(R, idx, px, py), edge ? 245 : onRay || st < 0.12 ? 215 : Math.round(255 * Math.min(1, c.finAlpha - 0.45)));
}

// Returns 1 hit, 2 hit+darker, 3 hit+lighter, 0 none. May set patLight.
function patternHit(c, pat, u, v, lx, ly, L, H, phase, px, py) {
  const k = c.k;
  switch (pat.type) {
    case 'bands': {
      for (const at of pat.at || [0.4]) {
        const w = (pat.width ?? 0.08) * (1 - 0.15 * v * v);
        const wav = (pat.wavy ?? 0.02) * Math.sin(v * 4);
        const dd = Math.abs(u - at - wav);
        if (dd < w) {
          if (pat.edge && w - dd < (pat.edgeW ?? 1.1) / L * Math.max(1, k * 0.6)) return 2;
          return 1;
        }
      }
      return 0;
    }
    case 'stripes': {
      for (const at of pat.at || [0]) if (Math.abs(v - at) < (pat.width ?? 0.15) && u > (pat.from ?? 0.1) && u < (pat.to ?? 0.95)) return 1;
      return 0;
    }
    case 'spots': {
      const sz = pat.size ?? 1.5 * k;
      const cell = sz * 3.2;
      const cx = Math.floor(lx / cell), cy = Math.floor(ly / cell);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const hx = cx + i, hy = cy + j;
        if (hash2(hx, hy, pat.seed ?? 7) > (pat.density ?? 0.55)) continue;
        const ox = (hx + 0.2 + hash2(hx, hy, 11) * 0.6) * cell;
        const oy = (hy + 0.2 + hash2(hx, hy, 13) * 0.6) * cell;
        const r = sz * (0.7 + 0.5 * hash2(hx, hy, 17));
        const d2 = (lx - ox) ** 2 + (ly - oy) ** 2;
        if (d2 < r * r) {
          if (pat.only === 'top' && v > 0.2) return 0;
          if (pat.ring && d2 < (r - Math.max(1, k * 0.5)) ** 2) return 0;
          return d2 < (r * 0.45) ** 2 && pat.hl ? 3 : 1;
        }
      }
      return 0;
    }
    case 'speckle': {
      if (hash2(Math.floor(lx * (pat.freq ?? 1)), Math.floor(ly * (pat.freq ?? 1)), pat.seed ?? 5) < (pat.density ?? 0.08)) return 1;
      return 0;
    }
    case 'patches': {
      const f = (pat.freq ?? 0.22) / Math.max(1, k * 0.7);
      const n = noise2(lx * f + (pat.seed ?? 3) * 9.1, ly * f);
      return n > (pat.threshold ?? 0.58) ? 1 : 0;
    }
    case 'gradient': {
      const t = pat.dir === 'v' ? (v + 1) / 2 : u;
      return t + (bayer(px, py) - 0.5) * 0.15 > (pat.from ?? 0.55) ? 1 : 0;
    }
    case 'checker': {
      const sz = pat.size ?? 2 * k;
      return ((Math.floor(lx / sz + 100) + Math.floor(ly / sz + 100)) & 1) === 0 && u > (pat.umin ?? 0.2) ? 1 : 0;
    }
    case 'mask':
      return Math.abs(u - (pat.at ?? 0.18)) < (pat.width ?? 0.09) && v < (pat.vmax ?? 0.35) ? 1 : 0;
    case 'face':
      return u < (pat.to ?? 0.3) ? 1 : 0;
    case 'tailend':
      return u > (pat.from ?? 0.8) ? 1 : 0;
    case 'suit': {
      // white shirt front (hit) + lapel edge (darker)
      const edge = -0.05 + (u - 0.08) * 0.55;
      if (u < 0.44 && u > 0.06 && v > edge) return v - edge < 1.6 / H * Math.max(1, k * 0.5) ? 2 : 1;
      return 0;
    }
    case 'lines': {
      const n = pat.count ?? 5;
      const t = fract(u * n + Math.sin(v * 3) * 0.08);
      return t < (pat.width ?? 0.18) && u > 0.15 ? 1 : 0;
    }
    case 'circuit': {
      const g = pat.grid ?? 3 * k * 0.8;
      const gx = Math.floor(lx / g), gy = Math.floor(ly / g);
      const hx = hash2(gx, gy, 5);
      const lw = Math.max(0.5, k * 0.25);
      const onLine = (Math.abs(ly - gy * g - g / 2) < lw && hx < 0.45) || (Math.abs(lx - gx * g - g / 2) < lw && hx > 0.75);
      const pad = hx > 0.88 && Math.hypot(lx - gx * g - g / 2, ly - gy * g - g / 2) < lw * 2.2;
      return (onLine || pad) && u > 0.2 ? (pad ? 3 : 1) : 0;
    }
    case 'galaxy': {
      const st = hash2(Math.floor(lx * 1.3 + 50), Math.floor(ly * 1.3 + 50), 77);
      return st > 0.94 ? 0 : 1;
    }
    case 'glowspots': {
      const n = pat.count ?? 5;
      const sz = pat.size ?? Math.max(0.8, k * 0.55);
      for (let i = 0; i < n; i++) {
        const su = (pat.u0 ?? 0.2) + (i / n) * (pat.span ?? 0.7), sv = pat.v ?? 0.55;
        if (Math.abs(u - su) * L < sz && Math.abs(v - sv) * H * 0.5 < sz * 0.9) return 1;
      }
      return 0;
    }
    case 'dots': {
      // rows of photophore dots along v
      for (const row of pat.rows || [0.6]) {
        const sp = pat.spacing ?? 2.6 * k;
        const xx = (L / 2 - lx) / sp;
        const fi = Math.round(xx);
        const dd = Math.hypot((xx - fi) * sp, (v - row) * H * 0.5);
        if (dd < (pat.size ?? Math.max(0.7, k * 0.4)) && u > (pat.from ?? 0.15) && u < (pat.to ?? 0.9)) return 1;
      }
      return 0;
    }
    case 'bars': {
      for (const at of pat.at || [0.4]) {
        const w = (pat.width ?? 0.05) * (1 - clamp01((v + 0.2) / 1.1) * 0.85) + Math.sin(v * 5 + at * 20) * 0.006;
        if (Math.abs(u - at - v * (pat.slant ?? 0.03)) < w && v < (pat.bottom ?? 0.55)) return 1;
      }
      return 0;
    }
    case 'belt':
      return Math.abs(v - (pat.at ?? 0.3)) < (pat.width ?? 0.12) ? 1 : 0;
    case 'rust': {
      const f = (pat.freq ?? 0.35) / Math.max(1, k * 0.6);
      const n = noise2(lx * f + 3.3, ly * f + 1.7) * 0.75 + noise2(lx * f * 3 + 9, ly * f * 3) * 0.25;
      return n > (pat.threshold ?? 0.62) ? (n > (pat.threshold ?? 0.62) + 0.12 ? 2 : 1) : 0;
    }
    case 'zigzag': {
      const t = fract(u * (pat.count ?? 4));
      return Math.abs(v - (Math.abs(t - 0.5) * 2 - 0.5) * 0.9) < (pat.width ?? 0.14) ? 1 : 0;
    }
    case 'chevron': {
      const n = pat.count ?? 3;
      const t = fract(u * n - Math.abs(v) * 0.25);
      return t < (pat.width ?? 0.22) && u > 0.18 ? 1 : 0;
    }
    case 'ocellus': {
      for (const [ou, ov] of pat.at || [[0.75, -0.2]]) {
        const r = pat.r ?? H * 0.14;
        const d = Math.hypot((u - ou) * L, (v - ov) * H * 0.5);
        if (d < r) return d < r * 0.45 ? 2 : d > r - Math.max(1, k * 0.45) ? 2 : 1;
      }
      return 0;
    }
    case 'facets': {
      // gem cuts: per-cell flat shading, bright cell edges
      const sz = pat.size ?? 4 * k;
      const ax = lx / sz + ly / (sz * 1.7), ay = ly / sz - lx / (sz * 2.3);
      const ix = Math.floor(ax), iy = Math.floor(ay);
      const fx = ax - ix, fy = ay - iy;
      const tri = fx + fy > 1 ? 1 : 0;
      const hsh = hash2(ix * 2 + tri, iy, 31);
      patLight += (hsh - 0.5) * 0.55;
      const edge = Math.min(fx, fy, 1 - fx, 1 - fy, Math.abs(fx + fy - 1) * 0.7);
      if (edge * sz < 0.55) return 3;
      return hsh > 0.94 ? 3 : 0;
    }
    case 'plates': {
      const sz = pat.size ?? 5 * k;
      const rh = sz * 0.8;
      const r = Math.floor(ly / rh + 100);
      const yb = (r - 100) * rh + Math.sin(lx * 0.35 / Math.max(1, k * 0.5) + r) * sz * 0.08;
      if (ly - yb < 0.6 * Math.max(1, k * 0.35)) return 2;
      if (ly - yb < 1.6 * Math.max(1, k * 0.35)) patLight += 0.12;
      const off = (r & 1) * sz * 0.5;
      const i0 = Math.floor((lx - off) / sz);
      for (let i = i0; i <= i0 + 1; i++) {
        const bx = i * sz + off + (hash2(i, r, 61) - 0.5) * sz * 0.45 + (ly - yb) * 0.25;
        const d = lx - bx;
        if (Math.abs(d) < 0.6 * Math.max(1, k * 0.35)) return 2;
        if (d > 0 && d < 1.4 * Math.max(1, k * 0.35)) patLight += 0.08;
      }
      return 0;
    }
    case 'scribble': {
      const n = pat.count ?? 3;
      for (let i = 0; i < n; i++) {
        const vv = -0.45 + (i / Math.max(1, n - 1)) * 0.8;
        const y = vv + 0.12 * Math.sin(u * (18 + i * 5) + i * 2) + 0.06 * Math.sin(u * 41 + i);
        if (Math.abs(v - y) * H * 0.5 < (pat.width ?? Math.max(0.6, k * 0.3)) && u > 0.2 && u < 0.9) return 1;
      }
      return 0;
    }
    default:
      return 0;
  }
}

function organHit(c, u, v, phase, L, H) {
  const o = c.look.organs;
  const k = c.k;
  const vv = v * H * 0.5;   // local px from centre line
  const thin = Math.max(0.5, k * 0.28);
  if (Math.abs(vv - H * 0.01) < thin * 1.2 && u > 0.12 && u < 0.98) return P(o.bone || '#f4f1ff', 235);
  // vertebra ticks along the spine
  if (u > 0.14 && u < 0.97 && Math.abs(fract((u * L) / (2.2 * k)) - 0.5) < 0.12 && Math.abs(vv) < thin * 2.4) return P(o.bone || '#f4f1ff', 235);
  if (u > 0.28 && u < 0.78 && Math.abs(fract((u * L) / (2.6 * k) + vv * 0.04) - 0.5) < 0.1 && Math.abs(v) < 0.62 && Math.abs(v) > 0.1) return P(o.bone || '#f4f1ff', 150);
  const pulse = 0.5 + 0.5 * Math.sin(phase * TAU * 2);
  const hr = H * (0.1 + 0.015 * pulse);
  if (Math.hypot((u - 0.25) * L, vv - H * 0.2) < hr) return P(Math.hypot((u - 0.25) * L + hr * 0.3, vv - H * 0.2 + hr * 0.3) < hr * 0.4 ? '#ff9ab0' : '#ff4466', 255);
  if (((u - 0.45) * L) ** 2 / (H * 0.22) ** 2 + (vv - H * 0.17) ** 2 / (H * 0.13) ** 2 < 1) return P(o.stomach || '#9ad66b', 230);
  if (Math.hypot((u - 0.1) * L, vv + H * 0.15) < H * 0.08) return P('#ffb3d0', 225);
  return 0;
}

// ---- polyline helpers (no allocation in the hot loop)
let pdT = 0;
function polyDist2(pts, x, y) {
  let bd = Infinity;
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
    const l2 = dx * dx + dy * dy || 1e-6;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x, ey = ay + dy * t - y;
    const d = ex * ex + ey * ey;
    if (d < bd) { bd = d; pdT = (i + t) / n; }
  }
  return bd;
}
function curvePts(fn, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(fn(i / n));
  return pts;
}
function bboxOf(pts, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
const inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

function eyeLocal(c, G, e, sw, still = false) {
  const ex = G.halfL - e.u * G.L;
  const ey = (still ? 0 : spineAt(c, e.u, sw)) + e.v * (e.v < 0 ? G.halfTop(e.u) : G.halfBot(e.u));
  return [ex, ey, e.r * (1 + 0.15 * G.inflate)];
}

// Per-raster geometry for extras at this swim phase. still -> no sway.
function prepExtras(c, G, sw, still, s) {
  const { L, H, halfL } = G;
  const k = c.k;
  const px1 = 1 / s; // one canvas pixel in local units
  const sway = still ? 0 : 1;
  const out = [];
  for (const e of c.extras) {
    const q = { e };
    switch (e.type) {
      case 'lure': {
        const sv = Math.sin(sw * TAU) * 0.8 * Math.max(1, k * 0.7) * sway;
        const reach = e.reach ?? L * 0.35, h = e.h ?? H * 0.9;
        const sx = halfL - L * 0.15, sy = -G.halfTop(0.15) * 0.92;
        const tx = halfL - L * 0.12 + reach + sv * 0.4, ty = -H / 2 - h * 0.55 + sv;
        const cx = sx - k, cy = ty - 2 * k;
        q.rb = e.r ?? clamp(H * 0.075, 1.3, 7);
        if (e.spinner) {
          q.rr = e.r ?? Math.max(2.5, H * 0.14);
          q.sc = [tx + q.rr * 0.1, ty - q.rr * 0.95];
        }
        q.tip = [tx, ty];
        q.w = Math.max(px1 * 0.6, k * 0.22);
        q.pts = curvePts((t) => [(1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t * t * tx, (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t * t * ty], 16);
        q.box = bboxOf(q.pts, (q.rr ? q.rr * 2.2 : q.rb + 1) + 1);
        break;
      }
      case 'whiskers': {
        const len = e.len ?? H * 0.6;
        const nb = e.count ?? 2;
        const dirs = [0.75, -0.55, 0.35, -0.2];
        q.lines = Array.from({ length: nb }, (_, side) => curvePts((t) => [
          halfL + 0.3 - side * k * 0.7 + Math.sin(t * 2.2) * len * 0.36 - t * t * len * (0.5 + side * 0.1),
          G.mouthY - (side & 1 ? H * 0.1 : -H * 0.02) + t * len * dirs[side % 4] + Math.sin(sw * TAU + t * 3 + side) * t * 0.8 * k * sway,
        ], 16));
        q.w = px1 * 0.55;
        q.box = bboxOf(q.lines.flat(), 1.5);
        break;
      }
      case 'feelers': {
        const len = e.len ?? L * 0.7, u0 = e.u ?? 0.36;
        const x0 = halfL - L * u0, y0 = G.halfBot(u0) * 0.8;
        q.lines = [0, 1].map((side) => curvePts((t) => [
          x0 - side * k - t * len * 0.8,
          y0 + t * len * (0.5 + side * 0.12) + Math.sin(sw * TAU - t * 4 + side) * t * H * 0.1 * sway,
        ], 16));
        q.w = px1 * 0.6;
        q.box = bboxOf(q.lines.flat(), 2);
        break;
      }
      case 'barbel': {
        const len = e.len ?? H * 0.8;
        const x0 = halfL - L * 0.06, y0 = G.mouthY + H * 0.14;
        q.pts = curvePts((t) => [x0 - t * len * 0.15 + Math.sin(t * Math.PI) * len * 0.22, y0 + t * len * 0.8 + Math.sin(sw * TAU + t * 3) * t * k * sway], 14);
        q.tip = q.pts[q.pts.length - 1];
        q.rb = e.r ?? Math.max(1.2, k * 0.7);
        q.w = Math.max(px1 * 0.55, k * 0.2);
        q.box = bboxOf(q.pts, q.rb + 1.5);
        break;
      }
      case 'antennae': {
        const u0 = e.u ?? 0.22;
        const bx = halfL - L * u0, by = -G.halfTop(u0) + 0.5;
        const len = e.len ?? (e.style === 'rabbit' ? H * 0.75 : H * 0.55);
        if (e.style === 'rabbit') {
          q.lines = [-1, 1].map((sd) => {
            const a = sd * 0.42 + Math.sin(sw * TAU + sd) * 0.05 * sway;
            return curvePts((t) => [bx + Math.sin(a) * len * t, by - Math.cos(a) * len * t], 6);
          });
        } else {
          q.lines = [0, 1].map((o) => curvePts((t) => [bx - o * k * 1.5 + t * len * 0.55, by - t * len + Math.sin(sw * TAU + o + t * 2) * t * k * 0.6 * sway - t * t * len * 0.1], 10));
        }
        q.tips = q.lines.map((l) => l[l.length - 1]);
        q.rb = e.r ?? Math.max(1, k * 0.55);
        q.w = Math.max(px1 * 0.55, k * 0.2);
        q.base = [bx, by];
        q.box = bboxOf(q.lines.flat(), q.rb + 1.5);
        break;
      }
      case 'cap': {
        const u0 = e.u ?? 0.3;
        q.cx = halfL - L * u0;
        q.cy = -G.halfTop(u0) + (e.sink ?? H * 0.06);
        q.w = e.w ?? H * 0.55;
        q.box = [q.cx - q.w * 1.2, q.cy - q.w * 1.3, q.cx + q.w * 1.3, q.cy + q.w * 0.3];
        break;
      }
      case 'halo': {
        const u0 = e.u ?? 0.32;
        const bob = Math.sin(sw * TAU) * Math.max(0.5, k * 0.4) * sway;
        q.cx = halfL - L * u0;
        q.cy = -G.halfTop(u0) - (e.h ?? H * 0.36) + bob;
        q.rx = e.r ?? Math.max(3, L * 0.16);
        q.ry = q.rx * 0.3;
        q.t = Math.max(px1 * 1.2, k * 0.5);
        q.box = [q.cx - q.rx - 2, q.cy - q.ry - 2, q.cx + q.rx + 2, q.cy + q.ry + 2];
        break;
      }
      case 'dome': {
        const u0 = e.u ?? 0.24;
        q.cx = halfL - L * u0;
        q.cy = -G.halfTop(u0) * 0.55;
        q.rx = e.rx ?? L * 0.2;
        q.ry = e.ry ?? H * 0.85;
        q.box = [q.cx - q.rx - 1, q.cy - q.ry - 1, q.cx + q.rx + 1, q.cy + 1];
        break;
      }
      case 'badge': {
        const u0 = e.u ?? 0.45;
        q.r = e.r ?? clamp(H * 0.15, 2.5, 8);
        q.cx = halfL - L * u0;
        q.cy = -G.halfTop(u0) - q.r * 0.15;
        break;
      }
      case 'clownnose': {
        q.r = e.r ?? Math.max(1.5, H * 0.11);
        q.cx = halfL - q.r * 0.15;
        q.cy = G.mouthY - q.r * 1.25;
        break;
      }
      case 'usb': {
        q.len = e.len ?? L * 0.42;
        q.hh = e.h ?? H * 0.17;
        q.y0 = e.v != null ? e.v * H * 0.5 : G.mouthY - H * 0.04;
        q.x0 = halfL - q.len * 0.12;
        break;
      }
      case 'bite': {
        const u0 = e.u ?? 0.6;
        const rb = e.r ?? H * 0.17;
        const y = -G.halfTop(u0) + rb * 0.45;
        q.circles = [-1.05, 0, 1.05].map((o, i) => [halfL - L * u0 + o * rb, y - (i === 1 ? rb * 0.2 : 0), rb * (i === 1 ? 1.05 : 0.85)]);
        break;
      }
      case 'monocle': {
        const [ex, ey, er] = eyeLocal(c, G, c.eyes[0], sw, still);
        const rr = er * 1.28 + k * 0.35;
        const a0 = 2.2;
        const sx = ex + Math.cos(a0) * rr, sy = ey + Math.sin(a0) * rr;
        const tx = ex - rr * 2.2, ty = ey + rr * 2.4 + Math.sin(sw * TAU) * k * 0.3 * sway;
        q.pts = curvePts((t) => [lerp(sx, tx, t), lerp(sy, ty, t) + Math.sin(t * Math.PI) * rr * 0.7], 10);
        q.w = Math.max(px1 * 0.5, k * 0.16);
        q.box = bboxOf(q.pts, 1.5);
        break;
      }
      case 'kype': {
        const rad = e.len ?? H * 0.22;
        const x0 = halfL - L * 0.02, y0 = G.mouthY - H * 0.14;
        q.pts = curvePts((t) => { const a = -Math.PI / 2 + t * 2.3; return [x0 + Math.cos(a) * rad, y0 + rad + Math.sin(a) * rad]; }, 16);
        q.wid = (t) => Math.max(px1 * 0.7, H * (0.085 - 0.055 * t));
        q.jaw = curvePts((t) => [halfL - L * 0.14 + t * (L * 0.14 + rad * 0.5), G.mouthY + H * 0.16 - t * H * 0.08], 10);
        q.jw = Math.max(px1 * 0.7, H * 0.055);
        q.box = bboxOf([...q.pts, ...q.jaw], H * 0.14 + 1);
        break;
      }
      case 'briefcase': {
        if (!e.draw) break;
        const u0 = e.u ?? 0.3;
        q.bw = e.w ?? H * 0.95; q.bh = q.bw * 0.62;
        q.cx = halfL - L * u0;
        q.top = G.halfBot(u0) + Math.max(1.5, H * 0.16) + Math.sin(sw * TAU) * 0.4 * sway;
        q.hy = G.halfBot(u0) - 0.5;
        q.box = [q.cx - q.bw / 2 - 1, q.hy - 1, q.cx + q.bw / 2 + 1, q.top + q.bh + 1];
        break;
      }
      case 'sword': {
        q.len = e.len ?? L * 0.8;
        q.hh = e.h ?? Math.max(1, H * 0.06);
        q.x0 = halfL + 0.4; q.y0 = G.mouthY + (e.dy ?? 0);
        q.box = [q.x0 - 1, q.y0 - q.hh * 3.6, q.x0 + q.len + 1, q.y0 + q.hh * 3.6];
        break;
      }
      case 'hammer': {
        q.len = e.len ?? L * 0.5;
        q.hw = e.w ?? H * 0.42; q.hl = q.hw * 0.62;
        q.hr = Math.max(0.7, H * 0.045);
        q.x0 = halfL + 0.2; q.y0 = G.mouthY;
        q.box = [q.x0 - 1, q.y0 - q.hw - 1, q.x0 + q.len + 1, q.y0 + q.hw + 1];
        break;
      }
      case 'guitar': {
        const u0 = e.u ?? 0.42;
        q.sz = e.size ?? H * 0.42;
        q.cx = halfL - L * u0; q.cy = G.halfBot(u0) * 0.5;
        q.a = e.angle ?? -0.75;
        const r = q.sz * 2.55;
        q.box = [q.cx - r, q.cy - r, q.cx + r, q.cy + r];
        break;
      }
      case 'horn': {
        const u0 = e.u ?? 0.12;
        q.bx = halfL - L * u0; q.by = -G.halfTop(u0) * 0.85;
        q.len = e.len ?? H * 0.62; q.rb = e.r ?? Math.max(1.2, H * 0.085);
        q.a = e.angle ?? -1.1;
        q.box = bboxOf([[q.bx, q.by], [q.bx + Math.cos(q.a) * q.len, q.by + Math.sin(q.a) * q.len]], q.rb + 1.5);
        break;
      }
      case 'ears': {
        if (e.style === 'dog') {
          q.cx = halfL - L * (e.u ?? 0.3); q.cy = -G.halfTop(e.u ?? 0.3) * 0.45;
          q.rx = e.w ?? H * 0.15; q.ry = e.len ?? H * 0.36;
          q.flop = Math.sin(sw * TAU) * 0.12 * sway;
          q.box = [q.cx - q.ry - 1, q.cy - q.rx - 1, q.cx + q.ry + 1, q.cy + q.ry * 2.2 + 1];
        } else {
          q.ears = [e.u ?? 0.1, (e.u ?? 0.1) + (e.gap ?? 0.17)].map((u) => [halfL - L * u, -G.halfTop(u) + H * 0.06]);
          q.w = e.w ?? H * 0.17; q.h = e.len ?? H * 0.34;
          q.box = bboxOf(q.ears.map(([x, y]) => [x, y - q.h]).concat(q.ears), q.w + 1);
        }
        break;
      }
      case 'wings': {
        const u0 = e.u ?? 0.45;
        q.bx = halfL - L * u0; q.by = -G.halfTop(u0) * 0.75;
        q.span = e.len ?? H * 1.05;
        q.a = -2.05 + Math.sin(sw * TAU) * 0.32 * sway;
        q.box = [q.bx - q.span * 1.05, q.by - q.span * 1.05, q.bx + q.span * 0.7, q.by + 2];
        break;
      }
      case 'mane': {
        q.hx = halfL - L * (e.u ?? 0.2); q.hy = G.mouthY * 0.3;
        q.rin = e.r ?? H * 0.33; q.rout = q.rin + (e.w ?? H * 0.34);
        q.box = [q.hx - q.rout * 1.25, q.hy - q.rout * 1.25, q.hx + q.rin * 0.7, q.hy + q.rout * 1.25];
        break;
      }
      case 'arrow': {
        const u0 = e.u ?? 0.55, v0 = e.v ?? -0.25;
        q.ex = halfL - L * u0; q.ey = v0 < 0 ? v0 * G.halfTop(u0) : v0 * G.halfBot(u0);
        q.a = e.angle ?? -2.25; q.len = e.len ?? H * 0.95;
        q.w = Math.max(0.55 / s, k * 0.22);
        q.box = bboxOf([[q.ex, q.ey], [q.ex + Math.cos(q.a) * q.len, q.ey + Math.sin(q.a) * q.len]], H * 0.16 + 1);
        break;
      }
      case 'juggle': {
        q.x0 = halfL - L * 0.12; q.y0 = -G.halfTop(0.12) - H * 0.18;
        q.w = e.w ?? L * 0.2; q.h = e.h ?? H * 0.75; q.r = e.r ?? Math.max(1.3, H * 0.075);
        q.balls = [0, 1, 2].map((i) => {
          const a = TAU * (sw * sway + i / 3);
          return [q.x0 + Math.cos(a) * q.w, q.y0 - q.h * 0.5 - Math.sin(a) * q.h * 0.5, i];
        });
        q.box = [q.x0 - q.w - q.r - 1, q.y0 - q.h - q.r - 1, q.x0 + q.w + q.r + 1, q.y0 + q.r + 1];
        break;
      }
      case 'coin': {
        q.r = e.r ?? Math.max(1.6, H * 0.15);
        q.cx = halfL + q.r * 0.45; q.cy = G.mouthY + q.r * 0.15;
        q.box = [q.cx - q.r - 1, q.cy - q.r - 1, q.cx + q.r + 1, q.cy + q.r + 1];
        break;
      }
      case 'stem': {
        q.len = e.len ?? H * 0.45; q.hh = e.h ?? Math.max(0.9, H * 0.11);
        q.x0 = halfL - L * 0.04; q.y0 = -G.halfTop(0.04) * 0.2;
        q.box = [q.x0 - 1, q.y0 - q.len * 0.6 - q.hh, q.x0 + q.len + 1, q.y0 + q.hh + 1];
        break;
      }
      case 'collar': {
        const u0 = e.u ?? c.opU + 0.03;
        q.x = halfL - L * u0; q.u = u0;
        q.bw = e.w ?? H * 0.2;
        q.top = -G.halfTop(u0); q.bot = G.halfBot(u0);
        q.box = [q.x - q.bw * 2.2 - H * 0.3, q.top - H * 0.62, q.x + q.bw * 1.6, q.bot + H * 0.12];
        break;
      }
      case 'heart': {
        const u0 = e.u ?? 0.5, v0 = e.v ?? 0;
        q.cx = halfL - L * u0; q.cy = v0 < 0 ? v0 * G.halfTop(u0) : v0 * G.halfBot(u0);
        q.r = e.r ?? H * 0.22;
        q.box = [q.cx - q.r * 1.2, q.cy - q.r * 1.2, q.cx + q.r * 1.2, q.cy + q.r * 1.2];
        break;
      }
      case 'mustache': {
        const len = e.len ?? L * 0.26, rc = e.curl ?? H * 0.075;
        const x0 = halfL - L * 0.02, y0 = G.mouthY - H * 0.05;
        const xe = x0 - len, ye = y0 + H * 0.02;
        q.pts = curvePts((t) => {
          if (t <= 0.6) { const k2 = t / 0.6; return [x0 - k2 * len, y0 + Math.sin(k2 * Math.PI) * H * 0.035 + k2 * H * 0.02]; }
          const k2 = (t - 0.6) / 0.4, a2 = k2 * Math.PI * 1.55, rr = rc * (1 - 0.4 * k2);
          return [xe - Math.sin(a2) * rr, ye - rc + Math.cos(a2) * rr];
        }, 24);
        const th = e.thick ?? H * 0.075;
        q.wid = (t) => Math.max(px1 * 0.6, th * (t < 0.2 ? 0.55 + t * 2.25 : t < 0.55 ? 1 : 1 - (t - 0.55) * 1.5));
        q.box = bboxOf(q.pts, th + 1);
        break;
      }
      default:
        break;
    }
    out.push(q);
  }
  return out;
}

// Extras that draw over the body AND outside it (sit on top of the silhouette).
function overlayPix(c, xp, lx, ly, px, py, s, G) {
  for (const q of xp) {
    const e = q.e;
    switch (e.type) {
      case 'kype': {
        if (!inBox(q.box, lx, ly)) break;
        let d2 = polyDist2(q.pts, lx, ly);
        const w = q.wid(pdT);
        if (d2 < w * w) {
          const R = c.T.head || c.T.body;
          return tone(R, 3.4 - pdT * 1.4 - (ly > q.pts[Math.round(pdT * 16)][1] ? 0.8 : 0), px, py);
        }
        d2 = polyDist2(q.jaw, lx, ly);
        if (d2 < q.jw * q.jw) return tone(c._jawR || (c._jawR = c.R7(c.vc(e.color || '#e8e0c8', 'extra'))), 4 - pdT * 0.8, px, py);
        break;
      }
      case 'clownnose': {
        const dx = lx - q.cx, dy = ly - q.cy;
        const d = Math.hypot(dx, dy);
        if (d > q.r) break;
        const hl = Math.hypot(dx + q.r * 0.38, dy + q.r * 0.38);
        if (hl < q.r * 0.26) return P('#fff1f0');
        const R = c._noseR || (c._noseR = ramp(c.vc(e.color || '#ff2b3a', 'extra')).map((h) => P(h)));
        return rampPick(R, clamp01(0.75 - (dx + dy) / q.r * 0.35 - (d / q.r) * 0.25), px, py);
      }
      case 'badge': {
        const dx = lx - q.cx, dy = ly - q.cy;
        const d = Math.hypot(dx, dy);
        if (d > q.r) break;
        const R = c._badgeR || (c._badgeR = ramp(c.vc(e.color || '#ff3048', 'extra')).map((h) => P(h)));
        if (d > q.r - 1 / s) return R[0];
        // the "1"
        const gw = Math.max(0.5 / s, q.r * 0.13);
        if (Math.abs(dx - q.r * 0.05) < gw && Math.abs(dy) < q.r * 0.52) return P('#ffffff');
        if (dy < -q.r * 0.25 && dy > -q.r * 0.52 && dx < 0 && dx > -q.r * 0.3 && Math.abs(dy + q.r * 0.38 + dx * 0.6) < gw) return P('#ffffff');
        return rampPick(R, clamp01(0.7 - dy / q.r * 0.3 - dx / q.r * 0.1), px, py);
      }
      case 'sword': case 'hammer': case 'guitar': case 'coin': case 'stem': case 'collar': case 'heart': case 'mane': case 'arrow': {
        if (!inBox(q.box, lx, ly)) break;
        const r = accessoryPix(c, q, lx, ly, px, py, s, G);
        if (r) return r;
        break;
      }
      case 'ears': {
        if (e.style !== 'dog' || !inBox(q.box, lx, ly)) break;
        const r = accessoryPix(c, q, lx, ly, px, py, s, G);
        if (r) return r;
        break;
      }
      case 'cap': {
        if (e.style !== 'helmet' && e.style !== 'hood') break;
        const r = headgearPix(c, q, lx, ly, px, py, s, G);
        if (r) return r;
        break;
      }
      case 'usb': {
        const x = lx - q.x0, ady = Math.abs(ly - q.y0);
        if (x < 0 || x > q.len * 1.12) break;
        const collar = x < q.len * 0.26;
        const hh = collar ? q.hh * 1.3 : q.hh;
        if (ady > hh) break;
        if (collar) {
          const R = c._usbC || (c._usbC = ramp(c.vc(e.color || '#30343e', 'extra')).map((h) => P(h)));
          return rampPick(R, clamp01(0.62 - (ly - q.y0) / hh * 0.3 - (x > q.len * 0.22 ? 0.25 : 0)), px, py);
        }
        const M = c._usbM || (c._usbM = ramp(c.vc(e.color2 || '#c4ccd8', 'extra')).map((h) => P(h)));
        const tx = (x - q.len * 0.26) / (q.len * 0.86);
        const vy = (ly - q.y0) / hh;
        // two rectangular holes
        for (const hx of [0.35, 0.68]) if (Math.abs(tx - hx) < 0.09 && vy < -0.1 && vy > -0.62) return P('#1a1c24');
        if (vy < -0.8) return M[4];
        if (vy > 0.75) return M[1];
        if (tx > 0.97) return M[2];
        return rampPick(M, clamp01(0.62 - vy * 0.25), px, py);
      }
      default:
        break;
    }
  }
  return 0;
}

function biteCut(xp, lx, ly) {
  let edge = Infinity;
  for (const q of xp) {
    if (q.e.type !== 'bite') continue;
    for (const [cx, cy, r] of q.circles) {
      const d = Math.hypot(lx - cx, ly - cy) - r;
      if (d < 0) return -1;
      edge = Math.min(edge, d);
    }
  }
  return edge;
}

function bodyPix(c, G, xp, lx, ly, px, py, s, sw, still) {
  const u = (G.halfL - lx) / G.L;
  if (u < 0 || u > 1) return 0;
  const sy = still ? 0 : spineAt(c, u, sw);
  const top = G.halfTop(u), bot = G.halfBot(u);
  const ry = ly - sy;
  if (ry < -top || ry > bot) return 0;
  let biteEdge = Infinity;
  if (c.hasBite) {
    biteEdge = biteCut(xp, lx, ly);
    if (biteEdge < 0) return 0;
  }
  const L = G.L, H = G.H;
  const v = ry < 0 ? ry / Math.max(0.5, top) : ry / Math.max(0.5, bot);
  const dT = (ry + top) * s, dB = (bot - ry) * s;
  const chk = ((px + py) & 1) ? 1 : -1;
  const T = c.T;
  // countershading: dark back -> body -> pale belly
  const vb = c.vb, vbel = c.vbel;
  let R, idx;
  if (v < vb + chk * 0.035) { R = T.back; idx = 1.5 + 1.8 * clamp01((v + 1) / (vb + 1)); }
  else if (v < vbel + chk * 0.035) { R = T.body; idx = 2.9 + 0.75 * clamp01((v - vb) / (vbel - vb)); }
  else { R = T.belly; idx = 3.7 + 1.05 * clamp01((v - vbel) / (1 - vbel)); }
  // head: operculum edge curves forward at top and bottom
  const opU = c.opU - 0.11 * v * v + 0.02;
  const inHead = u < opU;
  if (inHead) {
    if (T.head && R !== T.belly) R = T.head;
    if (v > -0.1 && v < 0.75) idx += 0.45;
    if (v < -0.5) idx -= 0.25;
    idx += (opU - u) * 0.8;
  }
  // form shading: dark dorsal ridge, belly core shadow, darker peduncle
  if (!VOXM) {
    if (dT < 1.05) idx -= 1;
    if (dB < 1.2) idx -= 1.9;
    else if (dB < 2.3) idx -= 0.8;
    if (u > 0.82) idx -= (u - 0.82) * 3.5;
  }
  patLight = 0;
  let patHit = false;
  for (const pat of c.patterns) {
    if (pat.umin !== undefined && u < pat.umin) continue;
    if (pat.umax !== undefined && u > pat.umax) continue;
    if (pat.vmin !== undefined && v < pat.vmin) continue;
    if (pat.vmax !== undefined && v > pat.vmax) continue;
    if (pat.body && inHead) continue;
    const pr = patternHit(c, pat, u, v, lx, ly, L, H, sw, px, py);
    if (pr) {
      patHit = true;
      if (pat.tone != null) idx += pat.tone * (pat.fade ? 1 - clamp01((v - pat.fade) / (1 - pat.fade)) : 1);
      else { R = pat.R7; if (pat.keepTone == null) idx = 3 + (idx - 3) * 0.6; }
      if (pat.glow) gOut = pat.R[3];
      if (pr === 2) idx -= 1.2;
      else if (pr === 3) idx += 1.2;
    }
  }
  idx += patLight * 4;
  // scales: staggered rows of small arcs on the flank
  if (c.scales && !inHead && u < 0.93 && v > -0.78 && v < 0.62 && (!VOXM || s >= 1.1)) {
    const sc = c.scaleSize, rh = sc * 0.62;
    const row = Math.floor(ly / rh + 1000);
    const off = (row & 1) * sc * 0.5;
    const fx = fract((lx + off) / sc);
    const fyPx = (ly - (row - 1000) * rh) * s;
    const fade = hash2(Math.floor((lx + off) / sc), row, 23) < 0.12 + Math.max(0, u - 0.8) * 3 + Math.max(0, v - 0.35) * 2;
    if (!fade) {
      if (fyPx < 1 && fx > 0.2 && fx < 0.72) idx -= 0.9;
      else if (fyPx < 2 && (fx > 0.12 && fx <= 0.2 || fx >= 0.72 && fx < 0.8)) idx -= 0.55;
      else if (fyPx >= 1.4 && fyPx < 2.4 && fx > 0.36 && fx < 0.56 && v < 0.35) idx += 0.75;
    }
  }
  // lateral line: light dashes from the operculum to the tail
  if (c.lateral && !inHead && u < 0.95 && (!VOXM || s >= 0.9)) {
    const lv = (c.look.lateralV ?? vb * 0.45 + 0.02) + (u - opU) * 0.12;
    if (Math.abs(v - lv) * (lv < 0 ? top : bot) * s < 0.55 && (Math.floor(lx * s / 2) & 1) === 0) idx += 1.1;
  }
  // operculum + pre-operculum curves, nostril
  if (c.gills && L * s >= 14 && v > -0.5 && v < 0.72) {
    const du = (u - opU) * L * s;
    if (du > -0.55 && du < 0.55) { if (R === T.belly) { R = T.body; idx = Math.min(idx - 1, 2.2); } else idx = Math.min(idx - 1.2, 1.8); }
    else if (du >= 0.55 && du < 1.6 && v > -0.4 && v < 0.6) idx += 0.5;
    const e0 = c.eyes[0];
    if (c.preop && L * s >= 40 && v > 0.1 && v < 0.6) {
      const pu = e0.u + (opU - e0.u) * 0.48 - 0.04 * v;
      if (Math.abs((u - pu) * L * s) < 0.5) idx -= 0.65;
    }
  }
  if (c.nostril && L * s >= 22) {
    const e0 = c.eyes[0];
    const nu = e0.u * 0.42, nv = e0.v * 0.55;
    if (Math.abs((u - nu) * L * s) < 0.55 && Math.abs((v - nv) * top * s) < 0.55) idx = 0.6;
  }
  // specular strip along the upper flank and head
  if (c.shine && c.spec && !VOXM) {
    const sv0 = vb - 0.24, sv1 = vb - 0.02;
    if (v > sv0 && v < sv1 && u > 0.05 && u < 0.7) {
      const dash = u < opU + 0.04 || (Math.floor(lx * s / 2) & 1) === 0;
      if (dash) idx += 2.5 * c.spec * (1 - smoothstep(0.45, 0.7, u));
    }
    if (inHead && v > -0.82 && v < -0.5 && u > 0.04 && u < opU - 0.02) idx += 1.2 * c.spec;
  }
  let col = tone(R, idx, px, py);
  if (biteEdge < 1.6 / s) col = (hash2(px, py, 3) > 0.4) ? R[1] : R[2];
  if (c.alpha < 255) col = withA(col, c.alpha);
  if (c.look.organs) {
    const oc = organHit(c, u, v, sw, L, H);
    if (oc) col = oc;
  }
  if (c.mouth.type === 'beak' && u < 0.13 && v > -0.38) {
    const R2 = c.mouth.R;
    col = rampPick(R2, clamp01(0.68 - v * 0.25 - u * 1.5), px, py);
    if (Math.abs(fract(u * L / Math.max(1.5, c.k)) - 0.5) < 0.12 && v > 0.1) col = R2[1];
  }
  void patHit;
  for (const q of xp) {
    const r = extraOnBody(c, q, u, v, ry, lx, ly, G, top, bot, px, py, sw, s);
    if (r) { col = r; if (q.e.glow) gOut = r; }
  }
  return col;
}

function extraOnBody(c, q, u, v, ry, lx, ly, G, top, bot, px, py, sw, s) {
  const e = q.e;
  const L = G.L, H = G.H, k = c.k;
  switch (e.type) {
    case 'tie': {
      const cu = e.u ?? 0.24;
      const du = (u - cu) * L;
      if (ry > 0 && v < 1.02) {
        const t = v;
        const sc = Math.max(1, k * 0.75);
        const wdt = (t < 0.22 ? 0.95 : 0.6 + (t - 0.22) * 1.7 * (t < 0.75 ? 1 : (1 - t) * 3.4)) * sc;
        if (Math.abs(du) <= wdt) {
          const C1 = e.P || P('#d8283a'), C2 = e.P2 || C1;
          if (t < 0.22) return Math.abs(du) > wdt - 1 / s ? C2 : C1;
          if (Math.abs(du) > wdt - 1 / s) return C2;
          // diagonal stripes on bigger ties
          if (k > 1.6 && fract((du + t * H * 0.5) / (1.8 * sc)) < 0.3) return C2;
          return C1;
        }
      }
      return 0;
    }
    case 'bolts': {
      const g = e.grid ?? 4 * Math.max(1, k * 0.75);
      const gx = Math.round(lx / g) * g, gy = Math.round(ly / g) * g;
      const br = Math.max(0.55, k * 0.38);
      if (hash2(gx, gy, 9) > 0.55 && u > 0.18 && u < 0.95) {
        const dd = Math.hypot(lx - gx, ly - gy);
        if (dd < br) {
          const B = e.P || P('#d8dde6');
          return dd < br * 0.5 && lx < gx && ly < gy ? P('#ffffff') : (lx > gx || ly > gy) && dd > br * 0.5 ? c.bodyR[0] : B;
        }
      }
      return 0;
    }
    case 'scar': {
      const sx = (u - (e.u ?? 0.5)) * L - ry * 0.6;
      if (Math.abs(sx) * s < 0.6 && Math.abs(ry) < top * 0.75) return e.P || P('#f3d6d0');
      // stitches
      if (e.stitches !== false && Math.abs(ry) < top * 0.7 && Math.abs(fract(ry / Math.max(1.5, k * 1.2)) - 0.5) * Math.max(1.5, k * 1.2) * s < 0.5 && Math.abs(sx) < Math.max(1.2, k * 0.7)) return e.P2 || P('#3a2430');
      return 0;
    }
    case 'blush': {
      const cu = e.u ?? 0.24;
      if (Math.hypot((u - cu) * L / 1.6, (v - (e.v ?? 0.15)) * bot / 0.6) < Math.max(1.1, k * 0.9) && bayer(px, py) < 0.6) return e.P || P('#ff8fa8');
      return 0;
    }
    case 'screen': {
      if ((py & 1) === 0) return e.P || P('#0a3a1f', 200);
      return 0;
    }
    case 'barnacles': {
      const cs = e.size ?? clamp(3.2 * k, 3, 6.5);
      const gx = Math.floor(lx / cs), gy = Math.floor(ly / cs);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const hx = gx + i, hy = gy + j;
        if (hash2(hx, hy, 41) > (e.density ?? 0.2)) continue;
        const cx = (hx + 0.5) * cs, cy = (hy + 0.5) * cs;
        const r = cs * (0.28 + hash2(hx, hy, 43) * 0.2);
        const dd = Math.hypot(lx - cx, ly - cy);
        if (dd < r && v < (e.vmax ?? 0.15)) {
          const B = c._barR || (c._barR = ramp(c.vc(e.color || '#b8b0a0', 'extra')).map((h) => P(h)));
          if (dd < r * 0.38) return B[0];
          return rampPick(B, clamp01(0.75 - (ly - cy) / r * 0.3 - (lx - cx) / r * 0.2), px, py);
        }
      }
      return 0;
    }
    case 'bandage': {
      const cu = e.u ?? 0.55, cv = e.v ?? -0.3;
      const ang = e.angle ?? 0.6;
      const dx = (lx - (G.halfL - cu * L)), dy = ly - cv * (cv < 0 ? top : bot);
      const a = dx * Math.cos(ang) + dy * Math.sin(ang), b = -dx * Math.sin(ang) + dy * Math.cos(ang);
      const bl = e.len ?? H * 0.4, bw = bl * 0.3;
      if (Math.abs(a) < bl / 2 && Math.abs(b) < bw / 2) {
        if (Math.abs(a) < bl * 0.17) return P('#f6e2c8');
        return ((Math.floor(a * s) + Math.floor(b * s)) & 3) === 0 ? P('#c8946a') : P('#e8b890');
      }
      return 0;
    }
    case 'mustache': {
      const d2 = polyDist2(q.pts, lx, ly);
      const w = q.wid(pdT);
      if (d2 < w * w) return pdT < 0.6 && ly < q.pts[Math.round(pdT * 24)][1] - w * 0.3 ? (e.P2 || P('#6a4420')) : (e.P || P('#3a2410'));
      return 0;
    }
    default:
      return 0;
  }
}

// Free-standing extras (only where nothing else is drawn).
function freePix(c, G, xp, lx, ly, px, py, s, sw, still) {
  for (const q of xp) {
    const e = q.e;
    if (q.box && !inBox(q.box, lx, ly)) continue;
    switch (e.type) {
      case 'lure': {
        if (q.rr) {
          const [cx, cy] = q.sc;
          const dd = Math.hypot(lx - cx, ly - cy);
          const n = 8;
          const ang = Math.atan2(ly - cy, lx - cx);
          const i = Math.round(((ang / TAU) * n + n) % n) % n;
          const a = (i / n) * TAU;
          const dx = lx - (cx + Math.cos(a) * q.rr), dy = ly - (cy + Math.sin(a) * q.rr);
          const dr = Math.max(0.8, q.rr * 0.24);
          if (dx * dx + dy * dy < dr * dr) {
            const head = Math.floor(fract(sw) * n);
            const age = (head - i + n) % n;
            const cols = ['#ffffff', '#b8fbff', '#6ae4ff', '#3aa8d8', '#2a6a98', '#24507a', '#1e3e60', '#1e3e60'];
            const col = P(c.vc(cols[age], 'extra'));
            if (age < 3) gOut = col;
            return col;
          }
          if (dd < q.rr * 0.45 && dd > q.rr * 0.45 - 1 / s) return P('#3a4658');
        } else {
          const [tx, ty] = q.tip;
          const dd = Math.hypot(lx - tx, ly - ty);
          if (dd < q.rb) {
            const bulb = P(c.vc(e.color2 || (e.glow ? '#c8fff0' : '#fff3b0'), 'extra'));
            const core = dd < q.rb * 0.45 || (lx < tx && ly < ty && dd < q.rb * 0.7);
            const col = core ? P('#ffffff') : bulb;
            if (e.glow) gOut = bulb;
            return col;
          }
        }
        if (polyDist2(q.pts, lx, ly) < q.w * q.w + 0.12) return withA(pdT > 0.9 ? (e.P2 || e.P || P('#6a7080')) : (e.P || P('#5a5f70')), 253);
        break;
      }
      case 'whiskers':
      case 'feelers': {
        for (const pts of q.lines) if (polyDist2(pts, lx, ly) < q.w * q.w * (e.type === 'whiskers' ? 1.25 : 1.6)) return withA(pdT > 0.7 ? (e.P2 || e.P || (e.type === 'feelers' ? c.finR[4] : P('#5a4030'))) : (e.P || (e.type === 'feelers' ? c.finR[2] : P('#3b2a22'))), 253);
        break;
      }
      case 'barbel': {
        const [tx, ty] = q.tip;
        if (Math.hypot(lx - tx, ly - ty) < q.rb) {
          const col = e.P2 || P('#9affe8');
          if (e.glow) gOut = col;
          return Math.hypot(lx - tx + q.rb * 0.3, ly - ty + q.rb * 0.3) < q.rb * 0.4 ? P('#ffffff') : col;
        }
        if (polyDist2(q.pts, lx, ly) < q.w * q.w + 0.1) return withA(e.P || c.bodyR[1], 253);
        break;
      }
      case 'antennae': {
        for (const [tx, ty] of q.tips) {
          if (Math.hypot(lx - tx, ly - ty) < q.rb) {
            const col = e.P2 || P(e.style === 'rabbit' ? '#c8ccd8' : '#ff5577');
            if (e.glow) gOut = col;
            return Math.hypot(lx - tx + q.rb * 0.35, ly - ty + q.rb * 0.35) < q.rb * 0.45 ? P('#ffffff') : col;
          }
        }
        for (const pts of q.lines) if (polyDist2(pts, lx, ly) < q.w * q.w + 0.1) return withA(e.P || P(e.style === 'rabbit' ? '#9aa2b4' : '#333344'), 253);
        if (e.style === 'rabbit') {
          const [bx, by] = q.base;
          const rr = Math.max(1.2, c.k * 0.8);
          if (Math.abs(lx - bx) < rr * 1.6 && ly < by + 0.5 && ly > by - rr) return P('#4a5060');
        }
        break;
      }
      case 'cap': {
        const r = capPix(c, q, lx, ly, px, py, s);
        if (r) return r;
        break;
      }
      case 'horn': case 'wings': case 'juggle': case 'ears': {
        if (e.type === 'ears' && e.style === 'dog') break;
        const r = accessoryPix(c, q, lx, ly, px, py, s, G);
        if (r) return r;
        break;
      }
      case 'halo': {
        const nx = (lx - q.cx) / q.rx, ny = (ly - q.cy) / q.ry;
        const dd = Math.hypot(nx, ny);
        const tk = q.t / q.rx;
        if (Math.abs(dd - 1) < tk * (ny < 0 ? 0.8 : 1.1)) {
          const R = c._haloR || (c._haloR = ramp(c.vc(e.color || '#ffe066', 'extra')).map((h) => P(h)));
          const col = rampPick(R, clamp01(0.62 - ny * 0.3 + (nx < -0.3 && ny < 0 ? 0.3 : 0)), px, py);
          gOut = R[3];
          return col;
        }
        break;
      }
      case 'dome': {
        const nx = (lx - q.cx) / q.rx, ny = (ly - q.cy) / q.ry;
        if (ny > 0) break;
        const dd = Math.hypot(nx, ny);
        if (dd > 1) break;
        // tubular eyes inside
        for (const [ox, sh] of [[-0.32, 0.75], [0.1, 1]]) {
          const ex = q.cx + ox * q.rx;
          const w = q.rx * 0.22 * sh;
          const y0 = q.cy - q.ry * 0.05, y1 = q.cy - q.ry * 0.62 * sh;
          if (Math.abs(lx - ex) < w && ly < y0 && ly > y1 - w * 0.6) {
            if (ly < y1 + w * 0.5) { const cc = P('#0c2a14'); return Math.abs(lx - ex + w * 0.4) < w * 0.3 && ly < y1 ? P('#d8ffd0') : cc; }
            const G2 = c._domeR || (c._domeR = ramp(c.vc(e.color || '#62f07a', 'eye')).map((h) => P(h)));
            const col = rampPick(G2, clamp01(0.7 - (lx - ex) / w * 0.35), px, py);
            gOut = G2[3];
            return sh < 1 ? withA(G2[1], 230) : col;
          }
        }
        if (dd > 1 - 1.2 / (s * q.rx)) return P('#d8f6ff', 200);
        if (nx < -0.2 && ny < -0.35 && Math.abs(dd - 0.78) < 0.08) return P('#ffffff', 210);
        return P(c.vc(e.color2 || '#bfefff', 'extra'), 70);
      }
      case 'monocle': {
        if (polyDist2(q.pts, lx, ly) < q.w * q.w + 0.1 && (Math.floor(pdT * 22) & 1) === 0) return e.P || P('#e8c040');
        break;
      }
      case 'briefcase': {
        if (!e.draw) break;
        const x = lx - q.cx, y = ly - q.top;
        const hw = q.bw / 2;
        const B = c._caseR || (c._caseR = c.R7(c.vc(e.color || '#7a4422', 'extra')));
        // handle
        if (y < 0 && ly > q.hy && Math.abs(Math.abs(x) - hw * 0.28) < 0.6 / s) return B[2];
        if (y < -Math.max(1, q.bh * 0.12) && y > -Math.max(1, q.bh * 0.12) - 1 / s && Math.abs(x) < hw * 0.28) return B[2];
        if (y >= 0 && y <= q.bh && Math.abs(x) <= hw) {
          const ex = hw - Math.abs(x), ey = Math.min(y, q.bh - y);
          if (ex < 0.7 && ey < 0.7) return 0;
          if (Math.abs(x) < Math.max(0.6, q.bw * 0.06) && y < q.bh * 0.3 && y > q.bh * 0.08) return P(c.vc('#ffd23a', 'extra'));
          if (Math.abs(y - q.bh * 0.3) < 0.5 / s) return B[3];
          return tone(B, 3.8 - y / q.bh * 1.5 - (x > hw * 0.7 ? 0.6 : 0) + (y < 1 / s ? 1 : 0), px, py);
        }
        break;
      }
      default:
        break;
    }
  }
  // puffer spikes when inflated
  if (G.spikeLen > 0.3) {
    const nx = lx / G.halfL, ny = ly / (G.H / 2);
    const rn = Math.hypot(nx, ny);
    const avgR = (G.halfL + G.H / 2) / 2;
    const d = (rn - 1) * avgR;
    if (d > -0.5 && d < G.spikeLen) {
      const ang = Math.atan2(ny, nx);
      const N = Math.round(14 + c.k * 3);
      const kk = Math.round((ang / TAU) * N);
      const da = Math.abs(ang - (kk * TAU) / N) * avgR;
      if (da < (1 - d / G.spikeLen) * (0.7 + c.k * 0.35) + 0.2) return c.bodyR[d > G.spikeLen * 0.6 ? 4 : d < G.spikeLen * 0.2 ? 2 : 3];
    }
  }
  return 0;
}

const CAP_COL = { tophat: '#2a2630', crown: '#ffd23a', beanie: '#3a4a6a', porkpie: '#2c2a2e', cowboy: '#b47a42', pirate: '#1e1a22', helmet: '#4e6e2c', hood: '#6a4426', mohawk: '#ff3aa8' };
function capPix(c, q, lx, ly, px, py, s) {
  const e = q.e;
  const style = e.style || 'cap';
  if (style === 'helmet' || style === 'hood') return 0; // drawn over the head (headgearPix)
  const w = q.w, x = lx - q.cx, y = ly - q.cy;
  const C1 = c._capR || (c._capR = ramp(c.vc(e.color || CAP_COL[style] || '#d93a3a', 'extra')).map((h) => P(h)));
  const C2 = e.P2 || P(c.vc(style === 'beanie' ? '#e8e0d0' : style === 'tophat' ? '#c8283a' : style === 'pirate' ? '#e8c040' : '#c0c6d2', 'extra'));
  if (style === 'porkpie') {
    if (Math.abs(y) < Math.max(0.6 / s, w * 0.08) && Math.abs(x) < w * 0.62) return rampPick(C1, 0.45 - x / w * 0.2, px, py);
    if (y < 0 && Math.abs(x) < w * 0.4) {
      const top = -w * 0.46 + (Math.abs(x) < w * 0.24 ? w * 0.06 : 0);
      if (y < top) return 0;
      if (y > -w * 0.15) return C2 === P('#c0c6d2') ? C1[0] : C2;
      return rampPick(C1, clamp01(0.55 - x / w * 0.5 + (y < top + 1 / s ? 0.2 : 0)), px, py);
    }
    return 0;
  }
  if (style === 'cowboy') {
    const ax = Math.abs(x);
    const curl = Math.pow(Math.min(1, ax / (w * 0.95)), 3) * w * 0.3;
    if (ax < w * 0.95 && y < w * 0.05 - curl * 0.2 && y > -w * 0.1 - curl) return rampPick(C1, clamp01(0.5 - x / w * 0.2 + (y < -w * 0.05 - curl ? 0.2 : 0)), px, py);
    if (ax < w * 0.42 && y < 0) {
      const top = -w * 0.68 + w * 0.13 * Math.exp(-((x / (w * 0.12)) ** 2));
      if (y < top) return 0;
      if (y > -w * 0.22 && y < -w * 0.1) return P(c.vc('#4a2a14', 'extra'));
      return rampPick(C1, clamp01(0.62 - x / w * 0.6 - (y > -w * 0.25 ? 0.1 : 0)), px, py);
    }
    return 0;
  }
  if (style === 'pirate') {
    const ax = Math.abs(x);
    const hy = -w * 0.62 * (1 - Math.pow(ax / (w * 0.95), 1.6));
    if (ax < w * 0.95 && y < w * 0.08 && y > hy) {
      if (y > hy && y < hy + 1.1 / s && ax < w * 0.85) return C2;
      // skull
      if (Math.hypot(x, y + w * 0.3) < w * 0.12) return P('#f0ece0');
      if (Math.abs(y + w * 0.14) < w * 0.04 && Math.abs(x) < w * 0.16 && Math.abs(Math.abs(x) - w * 0.1) < w * 0.07) return P('#f0ece0');
      return rampPick(C1, clamp01(0.5 - x / w * 0.25 - y / w * 0.2), px, py);
    }
    return 0;
  }
  if (style === 'mohawk') {
    const ax = x + w * 0.1;
    if (Math.abs(ax) < w * 0.7 && y < w * 0.1) {
      const k = (ax / (w * 0.7) + 1) / 2;
      const spike = fract(k * 5);
      const hh = w * (0.45 + 0.4 * Math.sin(Math.PI * k)) * (1 - Math.abs(spike - 0.5) * 1.2);
      if (-y < hh) return rampPick(C1, clamp01(0.75 - (-y / hh) * 0.4 - (spike > 0.5 ? 0.15 : 0)), px, py);
    }
    return 0;
  }
  if (style === 'beanie') {
    const rx = w * 0.55, ry = w * 0.6;
    if (y <= 0.5 && (x / rx) ** 2 + (y / ry) ** 2 <= 1) {
      if (e.stripes && y <= -w * 0.2 && (Math.floor((-y) / Math.max(1 / s, w * 0.16)) & 1)) return rampPick(ramp(c.vc(e.color2 || '#f4f0ea', 'extra')).map((h) => P(h)), clamp01(0.6 - x / rx * 0.25), px, py);
      if (y > -w * 0.2) return ((Math.floor(lx * s) & 1) === 0) ? C1[1] : C1[0];
      const rib = (Math.floor((x + rx) * s / 2) & 1) === 0;
      return rampPick(C1, clamp01(0.62 - x / rx * 0.25 - (rib ? 0.15 : 0)), px, py);
    }
    const pr = w * 0.17;
    if (Math.hypot(x + w * 0.05, y + ry + pr * 0.6) < pr) return Math.hypot(x + w * 0.05 + pr * 0.3, y + ry + pr * 0.9) < pr * 0.45 ? P('#ffffff') : C2;
    return 0;
  }
  if (style === 'tophat') {
    if (Math.abs(y) < w * 0.09 && Math.abs(x) < w * 0.62) return C1[1];
    if (y < 0 && y > -w * 0.85 && Math.abs(x) < w * 0.36) {
      if (y > -w * 0.25) return C2;
      return rampPick(C1, clamp01(0.55 - x / w), px, py);
    }
    return 0;
  }
  if (style === 'crown') {
    if (y < 0.5 && y > -w * 0.25 && Math.abs(x) < w * 0.45) return rampPick(C1, clamp01(0.6 - x / w), px, py);
    const pts = 3;
    const fx = (x + w * 0.45) / (w * 0.9);
    if (fx >= 0 && fx <= 1 && y <= -w * 0.25) {
      const t = fract(fx * (pts - 1) + 0.5);
      const hh = w * 0.25 + w * 0.4 * (1 - Math.abs(t - 0.5) * 2);
      if (-y < hh) return rampPick(C1, clamp01(0.7 - x / w), px, py);
    }
    return 0;
  }
  // baseball cap: dome + bill
  const rx = w * 0.5, ry = w * 0.48;
  if (y <= 0.5 && (x / rx) ** 2 + (y / ry) ** 2 <= 1) {
    if (Math.abs(x) < Math.max(0.5 / s, w * 0.04) && y < -ry * 0.2) return C1[1];
    return rampPick(C1, clamp01(0.65 - x / rx * 0.25 - y / ry * 0.15), px, py);
  }
  if (Math.hypot(Math.max(0, y + w * 0.02) * 4, 0) < 1 && y > -w * 0.12 && y < w * 0.08 && x > rx * 0.6 && x < rx + w * 0.55) return C2;
  return 0;
}

// ---------------------------------------------------------------------------
// Generic fish: extents, layer boxes, raster driver, face geometry.

// Accessories that draw over and around the body (local fish coords, +x nose, y down).
function accR(c, key, hex) {
  if (!c._acc) c._acc = new Map();
  let r = c._acc.get(key + hex);
  if (!r) { r = c.R7(c.vc(hex, 'extra')); c._acc.set(key + hex, r); }
  return r;
}
function accessoryPix(c, q, lx, ly, px, py, s, G) {
  const e = q.e;
  const px1 = 1 / s;
  switch (e.type) {
    case 'sword': {
      const x = lx - q.x0, y = ly - q.y0, hh = q.hh, L2 = q.len;
      const S7 = accR(c, 'sw', e.color || '#c8d2e0'), G7 = accR(c, 'sg', e.color2 || '#e8b830');
      if (x > L2 * 0.07 && x < L2) {
        const bh = hh * Math.min(1, (L2 - x) / (L2 * 0.16)) + 0.3;
        if (Math.abs(y) > bh) return 0;
        if (Math.abs(y) < 0.5 * px1 && x < L2 * 0.78) return tone(S7, 2.3, px, py);
        if (y < -bh + px1) return tone(S7, 5.4, px, py);
        return tone(S7, y < 0 ? 4.4 : 2.9, px, py);
      }
      if (x >= 0 && x <= L2 * 0.07 && Math.abs(y) < hh * 3.3) return tone(G7, 4.2 - Math.abs(y) / (hh * 3.3) * 1.4 - (y > 0 ? 0.7 : 0), px, py);
      return 0;
    }
    case 'hammer': {
      const x = lx - q.x0, y = ly - q.y0;
      const M7 = accR(c, 'hm', e.color || '#8a929e'), W7 = accR(c, 'hw', e.color2 || '#9a6234');
      if (x > q.len - q.hl && x < q.len && Math.abs(y) < q.hw) {
        if (x > q.len - px1 * 1.2) return tone(M7, 5, px, py);
        if (Math.abs(y) > q.hw - px1) return tone(M7, 1.6, px, py);
        return tone(M7, 3.8 - y / q.hw * 1.2 - (x < q.len - q.hl + px1 ? 1 : 0), px, py);
      }
      if (x >= 0 && x <= q.len - q.hl && Math.abs(y) < q.hr) return tone(W7, y < 0 ? 4.2 : 2.8, px, py);
      return 0;
    }
    case 'guitar': {
      const dx = lx - q.cx, dy = ly - q.cy, ca = Math.cos(q.a), sa = Math.sin(q.a), sz = q.sz;
      const gx = dx * ca + dy * sa, gy = -dx * sa + dy * ca;
      const B7 = accR(c, 'gb', e.color || '#d8342c'), N7 = accR(c, 'gn', '#7a4a24');
      const d1 = Math.hypot(gx + sz * 0.42, gy) / (sz * 0.66), d2 = Math.hypot(gx - sz * 0.28, gy) / (sz * 0.5);
      const waist = gx > -sz * 0.2 && gx < sz * 0.1 && Math.abs(gy) < sz * 0.42;
      if (d1 < 1 || d2 < 1 || waist) {
        const edge = d1 > 1 - px1 / (sz * 0.66) * 1.2 && d2 > 1 - px1 / (sz * 0.5) * 1.2 && !(waist && Math.abs(gy) < sz * 0.42 - px1);
        if (edge) return tone(B7, 1.2, px, py);
        if (Math.hypot(gx - sz * 0.05, gy) < sz * 0.17) return P('#1a1210');
        if (Math.abs(gx + sz * 0.55) < sz * 0.07 && Math.abs(gy) < sz * 0.26) return tone(N7, 1.4, px, py);
        if (gy < -sz * 0.2 && gx < 0 && Math.hypot(gx + sz * 0.42, gy) > sz * 0.5) return P(c.vc('#f4ece0', 'extra'));
        return tone(B7, 3.9 - gy / sz * 0.8 - gx / sz * 0.25, px, py);
      }
      if (gx > sz * 0.5 && gx < sz * 2.15 && Math.abs(gy) < Math.max(0.55 * px1, sz * 0.085)) return fract(gx / (sz * 0.2)) < 0.15 ? P('#e8e0c8') : tone(N7, gy < 0 ? 4 : 2.8, px, py);
      if (gx >= sz * 2.15 && gx < sz * 2.5 && Math.abs(gy) < sz * 0.15) return Math.abs(gy) > sz * 0.1 && (Math.floor(gx / (sz * 0.1)) & 1) ? P('#e8e0d0') : tone(N7, 1.6, px, py);
      return 0;
    }
    case 'horn': {
      const dx = lx - q.bx, dy = ly - q.by, ca = Math.cos(q.a), sa = Math.sin(q.a);
      const al = dx * ca + dy * sa, pr = -dx * sa + dy * ca;
      if (al < -q.rb * 0.4 || al > q.len) return 0;
      const wdt = q.rb * (1 - Math.max(0, al) / q.len) + 0.3 * px1;
      if (Math.abs(pr) > wdt) return 0;
      const H7 = accR(c, 'hn', e.color || '#f4e6b8');
      const band = fract(al / (q.len * 0.16) + pr / q.rb * 0.35) < 0.32;
      return tone(H7, (pr < 0 ? 4.6 : 3.2) - (band ? 1.1 : 0), px, py);
    }
    case 'ears': {
      const E7 = accR(c, 'ea', e.color || c.bodyHex), I7 = accR(c, 'ei', e.color2 || '#ff9ab0');
      if (e.style === 'dog') {
        const dx = lx - q.cx, dy = ly - q.cy;
        const ca = Math.cos(0.35 + q.flop), sa = Math.sin(0.35 + q.flop);
        const ax = dx * ca + dy * sa, ay = -dx * sa + dy * ca;
        const t = ay / q.ry;
        if (t < -0.15 || t > 1) return 0;
        const wdt = q.rx * (0.7 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)));
        if (Math.abs(ax) > wdt) return 0;
        return tone(E7, Math.abs(ax) > wdt - px1 ? 1.3 : 2.6 - t * 0.6 - ax / wdt * 0.4, px, py);
      }
      for (const [bx, by] of q.ears) {
        const t = (by - ly) / q.h;
        if (t < 0 || t > 1) continue;
        const dx = lx - bx + t * q.w * 0.25;
        const wdt = q.w * (1 - t);
        if (Math.abs(dx) > wdt) continue;
        if (Math.abs(dx) < wdt * 0.5 && t < 0.72 && t > 0.08) return tone(I7, 3.6 - t, px, py);
        return tone(E7, Math.abs(dx) > wdt - px1 ? 1.6 : 3.6 - dx / q.w * 0.8, px, py);
      }
      return 0;
    }
    case 'wings': {
      const dx = lx - q.bx, dy = ly - q.by, ca = Math.cos(q.a), sa = Math.sin(q.a);
      const al = dx * ca + dy * sa, pr = -dx * sa + dy * ca;
      const t = al / q.span;
      if (t < 0 || t > 1) return 0;
      const pr2 = -pr;
      const W7 = accR(c, 'wn', e.color || '#4a3a5a');
      const wdt = q.span * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) * (1 - 0.22 * Math.abs(Math.sin(t * Math.PI * 3)));
      if (pr2 < -Math.max(0.6 * px1, q.span * 0.04) || pr2 > wdt) return 0;
      if (pr2 < Math.max(0.6 * px1, q.span * 0.035)) return tone(W7, 1.4, px, py);
      for (const ft of [0.38, 0.7]) if (Math.abs(pr2 / Math.max(0.01, wdt) - (1 - Math.abs(t - ft) * 2.2)) < 0.07 && Math.abs(t - ft) < 0.35) return tone(W7, 1.8, px, py);
      return tone(W7, 3.2 - pr2 / q.span * 1.2, px, py);
    }
    case 'juggle': {
      const cols = ['#ff3a3a', '#ffd23a', '#3a8aff'];
      for (const [bx, by, i] of q.balls) {
        const d = Math.hypot(lx - bx, ly - by);
        if (d > q.r) continue;
        const R7 = accR(c, 'jb' + i, cols[i]);
        if (Math.hypot(lx - bx + q.r * 0.35, ly - by + q.r * 0.35) < q.r * 0.35) return P('#ffffff');
        return tone(R7, 4 - (ly - by) / q.r * 1.2 - (d > q.r - px1 ? 1.4 : 0), px, py);
      }
      return 0;
    }
    case 'coin': {
      const dx = lx - q.cx, dy = ly - q.cy, d = Math.hypot(dx, dy * 1.05);
      if (d > q.r) return 0;
      const G7 = accR(c, 'cn', e.color || '#ffcc33');
      if (d > q.r - px1) return tone(G7, 1.8, px, py);
      if (Math.abs(d - q.r * 0.62) < px1 * 0.6) return tone(G7, 2.6, px, py);
      return tone(G7, 4.3 - (dx + dy) / q.r * 0.9, px, py);
    }
    case 'stem': {
      const x = lx - q.x0, t = x / q.len;
      if (t < 0 || t > 1) return 0;
      const yc = q.y0 - Math.pow(t, 1.6) * q.len * 0.55;
      const hh = q.hh * (1 - 0.35 * t);
      if (Math.abs(ly - yc) > hh) return 0;
      const S7 = accR(c, 'st', e.color || '#5a6a2a');
      return t > 0.9 ? tone(S7, 1.4, px, py) : tone(S7, ly < yc ? 3.8 : 2.4, px, py);
    }
    case 'collar': {
      const x = lx - q.x, uu = (G.halfL - lx) / G.L;
      if (e.style === 'vampire') {
        // tall pointed collar rising behind the head
        const R7 = accR(c, 'cv', e.color || '#1a1420'), I7 = accR(c, 'ci', e.color2 || '#c81a2a');
        const t = (q.top - ly) / (G.H * 0.6);
        if (t >= 0 && t <= 1 && x < q.bw * 0.6 && x > -q.bw * 2.2) {
          const front = q.bw * 0.6 - t * q.bw * 0.4, back = -q.bw * 2.2 + t * q.bw * 1.6;
          if (x < front && x > back + (1 - Math.abs(fract(t * 2.5) - 0.5) * 2) * q.bw * 0.3) return x > front - q.bw * 0.35 ? tone(I7, 3.4 - t, px, py) : tone(R7, 3 - t, px, py);
        }
        if (Math.abs(x) < q.bw * 0.45 && ly >= q.top && ly <= q.bot && uu > 0) return tone(R7, 2.4, px, py);
        return 0;
      }
      const F7 = accR(c, 'cf', e.color || '#e8e4dc');
      const ang = Math.sin(ly * 1.7) * 0.25 + Math.sin(ly * 4.3) * 0.12;
      const half = q.bw * (1 + ang);
      if (Math.abs(x) > half || ly < q.top - G.H * 0.12 || ly > q.bot + G.H * 0.08) return 0;
      const strand = fract(ly / Math.max(1.6 * px1, G.H * 0.07) + x * 0.3) < 0.3;
      return tone(F7, 4 - (strand ? 1.2 : 0) - (Math.abs(x) > half - px1 ? 1.2 : 0) + (ly < 0 ? 0.4 : -0.2), px, py);
    }
    case 'heart': {
      const hx = (lx - q.cx) / q.r, hy = -(ly - q.cy) / q.r + 0.15;
      const v = (hx * hx + hy * hy - 0.42) ** 3 - hx * hx * hy * hy * hy * 1.15;
      if (v >= 0) return 0;
      const H7 = accR(c, 'ht', e.color || '#ff5a9a');
      const edge = ((hx * hx + hy * hy - 0.42) ** 3 - hx * hx * hy * hy * hy * 1.15) > -0.004 * (1 + q.r * s * 0.02);
      return edge ? tone(H7, 1.8, px, py) : tone(H7, 3.8 + hy * 0.9 - hx * 0.3, px, py);
    }
    case 'mane': {
      const dx = lx - q.hx, dy = (ly - q.hy) * 0.92;
      const d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      if (dx > q.rin * 0.45) return 0;
      const shag = q.rout * (1 + 0.1 * Math.sin(ang * 9 + 1) + 0.06 * Math.sin(ang * 23));
      if (d < q.rin || d > shag) return 0;
      const M7 = accR(c, 'mn', e.color || '#c8762a');
      const strand = fract(ang * 18 / TAU + d * 0.05) < 0.35;
      return tone(M7, 3.6 - (strand ? 1 : 0) - (d > shag - px1 * 1.2 ? 1.2 : 0) - dy / q.rout * 0.6, px, py);
    }
    case 'arrow': {
      const dx = lx - q.ex, dy = ly - q.ey, ca = Math.cos(q.a), sa = Math.sin(q.a);
      const al = dx * ca + dy * sa, pr = -dx * sa + dy * ca;
      if (al < 0 || al > q.len) return 0;
      const W7 = accR(c, 'aw', '#8a5a2e');
      const fl = al > q.len * 0.72;
      const fw = fl ? q.w + (al - q.len * 0.72) / (q.len * 0.28) * G.H * 0.13 : 0;
      if (fl && Math.abs(pr) < fw && Math.abs(pr) > q.w * 0.6) return (Math.floor(al / Math.max(px1 * 1.5, q.len * 0.06)) & 1) ? P(c.vc('#f4f0e8', 'extra')) : P(c.vc('#d8342c', 'extra'));
      if (Math.abs(pr) < q.w) return tone(W7, pr < 0 ? 4 : 2.6, px, py);
      return 0;
    }
    default: return 0;
  }
}

// Headgear that covers the head itself (drawn over the body): helmet with visor, monk hood.
function headgearPix(c, q, lx, ly, px, py, s, G) {
  const e = q.e;
  const px1 = 1 / s;
  const hx = G.halfL - G.L * 0.2, hy = -G.H * 0.06;
  if (e.style === 'helmet') {
    const rx = G.L * 0.27, ry = G.H * 0.56;
    const nx = (lx - hx) / rx, ny = (ly - hy) / ry;
    if (nx * nx + ny * ny > 1 || ly > G.mouthY - G.H * 0.02) return 0;
    const A7 = accR(c, 'hl', e.color || '#4e6e2c'), V7 = accR(c, 'hv', e.color2 || '#f0a828');
    const e0 = c.eyes[0];
    const ey = e0.v * G.H / 2;
    if (lx > hx - rx * 0.15 && Math.abs(ly - ey) < G.H * 0.16) {
      if (Math.abs(ly - ey) > G.H * 0.16 - px1) return tone(A7, 1.2, px, py);
      return tone(V7, 4.4 - (ly - ey) / (G.H * 0.16) * 1.4 + ((lx - ly) * s % 7 < 1.2 ? 1.2 : 0), px, py);
    }
    if (nx * nx + ny * ny > 1 - 2.2 * px1 / rx) return tone(A7, 1.5, px, py);
    return tone(A7, 3.8 - ny * 1.3 - nx * 0.4 - (Math.abs(nx + 0.35) < 0.04 ? 1 : 0), px, py);
  }
  // hood: covers the back of the head, leaves a face opening
  const rx = G.L * 0.36, ry = G.H * 0.66;
  const cx = hx - G.L * 0.08;
  const nx = (lx - cx) / rx, ny = (ly - hy) / ry;
  if (nx * nx + ny * ny > 1) return 0;
  const fx = (lx - (hx + G.L * 0.08)) / (G.L * 0.17), fy = (ly - (hy + G.H * 0.08)) / (G.H * 0.36);
  if (fx * fx + fy * fy < 1) return 0;
  const R7 = accR(c, 'hd', e.color || '#6a4426');
  if (fx * fx + fy * fy < 1.25) return tone(R7, 1.3, px, py);
  return tone(R7, 3.4 - ny * 1.1 - (Math.abs(fract(nx * 3) - 0.5) < 0.06 ? 0.8 : 0), px, py);
}

const ACC_TYPES = new Set(['sword', 'hammer', 'guitar', 'horn', 'ears', 'wings', 'mane', 'arrow', 'juggle', 'coin', 'stem', 'collar', 'heart']);
const CAP_WIDE = new Set(['cowboy', 'pirate', 'helmet', 'hood', 'mohawk']);
function genericExtent(c, G) {
  const { L, H, halfL, TL, TS } = G;
  let finTop = 0, finBot = 0, leanBack = 0;
  for (const f of c.fins) {
    if (f.slot === 'top') finTop = Math.max(finTop, f.h * 1.6);
    else finBot = Math.max(finBot, f.h * 1.35);
    leanBack = Math.max(leanBack, f.lean * f.h - (1 - f.to) * L);
  }
  let exTop = 0, exFront = 0, exBot = 0, exBack = 0;
  for (const e of c.extras) {
    switch (e.type) {
      case 'lure': {
        const r = e.spinner ? (e.r ?? Math.max(2.5, H * 0.14)) * 2.4 : (e.r ?? H * 0.08) + 1;
        exTop = Math.max(exTop, (e.h ?? H * 0.9) * 0.55 + r + 2 * c.k + 2);
        exFront = Math.max(exFront, (e.reach ?? L * 0.35) - L * 0.12 + r + 2);
        break;
      }
      case 'whiskers': exFront = Math.max(exFront, 2); exBot = Math.max(exBot, (e.len ?? H * 0.5) * 0.8); break;
      case 'feelers': exBot = Math.max(exBot, (e.len ?? L * 0.7) * 0.7 + H * 0.15); exBack = Math.max(exBack, (e.len ?? L * 0.7) * 0.8 - L * (1 - (e.u ?? 0.36))); break;
      case 'barbel': exBot = Math.max(exBot, (e.len ?? H * 0.8) * 0.85 + 2); break;
      case 'cap': exTop = Math.max(exTop, (e.w ?? H * 0.55) * (e.style === 'cowboy' ? 0.9 : 1.35)); exFront = Math.max(exFront, (e.w ?? H * 0.55) * (e.style === 'cowboy' || e.style === 'pirate' ? 1.0 : 0.5)); break;
      case 'antennae': exTop = Math.max(exTop, (e.len ?? H * 0.75) + 3); break;
      case 'halo': exTop = Math.max(exTop, (e.h ?? H * 0.36) + (e.r ?? L * 0.16) * 0.35 + 3); break;
      case 'dome': exTop = Math.max(exTop, (e.ry ?? H * 0.85) * 0.75); break;
      case 'badge': exTop = Math.max(exTop, (e.r ?? H * 0.15) * 1.3); break;
      case 'usb': exFront = Math.max(exFront, (e.len ?? L * 0.42) * 1.1); break;
      case 'clownnose': exFront = Math.max(exFront, (e.r ?? H * 0.11) * 1.2); break;
      case 'monocle': exBot = Math.max(exBot, c.eyes[0].r * 3); break;
      case 'briefcase': if (e.draw) exBot = Math.max(exBot, (e.w ?? H * 0.95) * 0.62 + H * 0.2 + 2); break;
      case 'kype': exFront = Math.max(exFront, (e.len ?? H * 0.22) + 2); exBot = Math.max(exBot, H * 0.2); break;
      default: break;
    }
  }
  // accessories with explicit boxes (sword, hammer, guitar, horn, ears, wings, mane, arrow, juggle...)
  const ACC = ACC_TYPES;
  if (c.extras.some((e) => ACC.has(e.type) || (e.type === 'cap' && CAP_WIDE.has(e.style)))) {
    for (const q of prepExtras(c, G, 0.25, true, 1)) {
      if (!q.box || !(ACC.has(q.e.type) || (q.e.type === 'cap' && CAP_WIDE.has(q.e.style)))) continue;
      exFront = Math.max(exFront, q.box[2] - halfL);
      exBack = Math.max(exBack, -halfL - q.box[0]);
      exTop = Math.max(exTop, -q.box[1] - H / 2);
      exBot = Math.max(exBot, q.box[3] - H / 2);
    }
  }
  // face extras (open mouth, eye emotion marks) must fit in the baked sprite
  let eyTop = 0, eyBot = 0;
  for (const e of c.eyes) {
    const ey = e.v * H / 2, R = e.r * 2.9 + 2;
    eyTop = Math.max(eyTop, -(ey - R) - H / 2);
    eyBot = Math.max(eyBot, ey + R - H / 2);
  }
  const mw = c.mouth.w;
  exFront = Math.max(exFront, mw * 0.5 + 1);
  exBot = Math.max(exBot, c.mouth.type === 'gulper' ? mw * 0.65 : mw * 0.6);
  const tailV = Math.max(TS, 0) + TL * 0.4;
  const bend = c.bend + 1;
  const pecBot = c.pectoral ? c.pectoral.len : 0;
  const top = H / 2 * (1 + Math.max(0, c.hump)) + Math.max(finTop, exTop, eyTop) + G.spikeLen + bend + 2;
  const bot = H / 2 * (1 + Math.max(0, c.belly)) + Math.max(finBot, exBot, pecBot, eyBot) + G.spikeLen + bend + 3;
  return [-halfL - Math.max(TL * 1.35, leanBack, exBack) - 3, -Math.max(top, tailV + 2), halfL + exFront + G.spikeLen * 0.5 + 3, Math.max(bot, tailV + 2)];
}

function layerBox(c, G, mode, ext) {
  const { halfL, TL, TS, H } = G;
  if (mode === 'tail') { const v = TS + TL * 0.45 + 2; return [-halfL - TL * 1.4 - 2, -v, -halfL + 3, v]; }
  if (mode === 'front') {
    const pec = c.pectoral;
    if (!pec) return [0, 0, 0, 0];
    const x = halfL - pec.u * G.L, y = pec.v * G.halfBot(pec.u), r = pec.len * 1.2 + 2;
    return [x - r, y - r, x + r, y + r];
  }
  if (mode === 'back') {
    let top = 0, bot = 0, lean = 0;
    for (const f of c.fins) { if (f.slot === 'top') top = Math.max(top, f.h * 1.6); else bot = Math.max(bot, f.h * 1.35); lean = Math.max(lean, f.lean * f.h); }
    return [-halfL - lean - 2, -H / 2 * (1 + Math.max(0, c.hump)) - top - 2, halfL + 2, H / 2 * (1 + Math.max(0, c.belly)) + bot + 2];
  }
  return [Math.max(ext[0], -halfL - c.bend - 3 - (c.extras.some((e) => e.type === 'feelers') ? G.L : 0)), ext[1], ext[2], ext[3]];
}

// Paint `mode` ('all' | 'tail' | 'back' | 'body' | 'front') into buf, which covers the shared bounds
// region starting at (bx, by). prm: {sw, tp, fp, still, inflate}.
function paintGeneric(c, buf, glow, bx, by, ox, oy, angle, s, mode, prm, G, rect) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const still = !!prm.still;
  const sw = prm.sw || 0, tp = prm.tp ?? sw, fp = prm.fp ?? sw;
  const all = mode === 'all';
  const bodyish = all || mode === 'body';
  const xp = bodyish ? prepExtras(c, G, sw, still, s) : null;
  const tailBaseY = all && !still ? spineAt(c, 1, sw) : 0;
  const finSw = all && !still ? sw : null;
  const pecBaseY = all && !still && c.pectoral ? spineAt(c, c.pectoral.u, sw) : 0;
  const glitch = bodyish ? c.look.glitch || 0 : 0;
  const gframe = Math.floor(fract(sw) * 8);
  const W = buf.w;
  for (let py = rect.y0; py < rect.y1; py++) {
    let shift = 0, tint = 0;
    if (glitch) {
      const band = py >> 1;
      if (hash2(band, gframe, 77) < glitch * 0.28) shift = Math.round((hash2(band, gframe, 78) - 0.5) * 7 * c.k);
      const th = hash2(band, gframe, 79);
      if (th < glitch * 0.14) tint = th < glitch * 0.07 ? 1 : 2;
    }
    for (let px = rect.x0; px < rect.x1; px++) {
      const dx = px + shift + 0.5 - ox, dy = py + 0.5 - oy;
      const lx = (dx * ca + dy * sa) / s, ly = (-dx * sa + dy * ca) / s;
      gOut = 0;
      let col = 0;
      if (all) {
        const body = overlayPix(c, xp, lx, ly, px, py, s, G) || bodyPix(c, G, xp, lx, ly, px, py, s, sw, still);
        col = body;
        const pc = pecPix(c, G, lx, ly, px, py, s, fp, pecBaseY, still);
        if (pc) col = body ? blendPacked(body, pc, c.finAlpha) : pc;
        if (!col) col = finPix(c, G, lx, ly, px, py, s, fp, finSw, still, prm.raise || 0) || tailPix(c, G, lx, ly, px, py, s, tp, tailBaseY) || freePix(c, G, xp, lx, ly, px, py, s, sw, still);
      } else if (mode === 'body') {
        col = overlayPix(c, xp, lx, ly, px, py, s, G) || bodyPix(c, G, xp, lx, ly, px, py, s, sw, still) || freePix(c, G, xp, lx, ly, px, py, s, sw, still);
      } else if (mode === 'back') col = finPix(c, G, lx, ly, px, py, s, fp, null, still, prm.raise || 0);
      else if (mode === 'tail') col = tailPix(c, G, lx, ly, px, py, s, tp, 0);
      else if (mode === 'front') col = pecPix(c, G, lx, ly, px, py, s, fp, 0, still);
      if (col) {
        if (tint) col = tint === 1 ? ((col & 0xff00ffff) | 0x00ff0000 | (col & 0xff000000)) >>> 0 : ((col & 0xffffff00) | 0xff) >>> 0;
        const i = (py - by) * W + (px - bx);
        buf.data[i] = col;
        if (glow && gOut) glow.data[i] = gOut;
      }
    }
  }
}

// Face + anchors for the generic fish in canvas coords (relative to the bounds origin ox, oy).
function genericFace(c, G, sw, angle, s, ox, oy, still) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const toC = (x, y) => [ox + (x * ca - y * sa) * s, oy + (x * sa + y * ca) * s];
  const sp = (u) => (still ? 0 : spineAt(c, u, sw));
  const eyes = c.eyes.map((e, i) => {
    const [ex, ey, er] = eyeLocal(c, G, e, sw, still);
    const [x, y] = toC(ex, ey);
    return { x, y, r: er * s, e, idx: i, mirror: false, cheek: i === 0, main: i === 0, angle };
  }).sort((a, b) => (b.e.behind ? 1 : 0) - (a.e.behind ? 1 : 0));
  const my = sp(0) + G.mouthY;
  const [mx, myc] = toC(G.halfL - Math.max(0.5, c.mouth.w * 0.1), my);
  let finTop = 0;
  for (const f of c.fins) if (f.slot === 'top') finTop = Math.max(finTop, f.h);
  const anchors = {
    mouth: toC(G.halfL + 0.5, my),
    tail: toC(-G.halfL - G.TL * 0.8, sp(1)),
    top: toC(G.halfL * 0.2, -G.H / 2 - finTop * 0.6),
    bottom: toC(0, G.H / 2),
  };
  for (const e of c.extras) {
    if (e.type === 'lure') {
      const q = prepExtras({ ...c, extras: [e] }, G, sw, still, s)[0];
      anchors.lure = toC(...(q.sc || q.tip));
    }
    if (e.type === 'briefcase') anchors.hand = toC(G.halfL * 0.25, G.H / 2 + 0.5);
  }
  const off = (u) => {
    const d = sp(u);
    return [Math.round(-d * sa * s), Math.round(d * ca * s)];
  };
  // gill slit just behind the operculum edge (the rig flares it for breathing)
  let gill = null;
  if (c.gills && G.L * s >= 14 && !c.look.noGill) {
    const pts = [];
    const n = Math.max(6, Math.ceil(G.H * s * 0.9));
    for (let i = 0; i <= n; i++) {
      const v = -0.42 + (i / n) * 1.06;
      const u = c.opU - 0.11 * v * v + 0.02 + 0.9 / (G.L * s);
      const yy = sp(u) + v * (v < 0 ? G.halfTop(u) : G.halfBot(u)) * 0.96;
      pts.push(toC(G.halfL - u * G.L, yy));
    }
    gill = { pts, nx: -ca, ny: -sa };
  }
  return {
    gill,
    eyes,
    mouth: { x: mx, y: myc, w: c.mouth.w * s, m: c.mouth, front: false, angle },
    anchors,
    offsets: { tail: off(1), back: off(0.5), front: c.pectoral ? off(c.pectoral.u) : [0, 0], body: [0, 0] },
  };
}

// ---------------------------------------------------------------------------
// Expressive face painters. Eye-local coords are normalised by the eye radius; +x = toward the nose
// (the "inner" corner for lids/brows; mirrored for the left eye of front-facing creatures).

// lid: upper-lid line y at x=0, slant: dy per x (+ = lower toward the nose), low: lower lid line,
// pupil: pupil scale, wide: eye scale, brow: [y, slant, style], plus mark flags.
const EMO = {
  neutral: { lid: -0.95, slant: 0, low: 1.2, pupil: 1, wide: 1, brow: null, mouth: { smile: 0.24 } },
  happy: { closed: 'arc', blush: true, brow: [-1.6, 0, 'arch'], mouth: { smile: 0.55, openBias: 0.15, laugh: true } },
  sad: { lid: -0.4, slant: -0.42, low: 1.2, pupil: 1.05, lookY: 0.35, brow: [-1.42, -0.5], tears: true, mouth: { smile: -0.4 } },
  angry: { lid: -0.28, slant: 0.55, low: 0.85, pupil: 0.8, brow: [-1.22, 0.62], vein: true, mouth: { smile: -0.22, teeth: true } },
  scared: { lid: -1.1, slant: 0, low: 1.2, pupil: 0.42, wide: 1.1, brow: [-1.75, -0.35, 'arch'], sweat: true, shake: true, mouth: { wave: 0.11, openBias: 0.1, teeth: true } },
  surprised: { lid: -1.1, slant: 0, low: 1.2, pupil: 0.45, wide: 1.14, brow: [-1.9, 0, 'arch'], mouth: { O: 0.6 } },
  love: { heart: true, blush: true, lid: -0.95, slant: 0, low: 1.2, brow: null, mouth: { smile: 0.4 } },
  sleepy: { lid: 0.05, slant: -0.1, low: 0.9, pupil: 0.9, lookY: 0.45, brow: null, mouth: { O: 0.2 } },
  dizzy: { spiral: true, brow: [-1.5, -0.2, 'wavy'], mouth: { wave: 0.14 } },
  smug: { lid: -0.18, slant: -0.12, low: 0.55, lowCurve: 0.25, pupil: 0.95, lookX: -0.55, brow: [-1.55, -0.28], mouth: { smirk: 0.55 } },
  determined: { lid: -0.45, slant: 0.38, low: 1.0, pupil: 0.85, brow: [-1.3, 0.45], mouth: { smile: -0.06, teeth: true, flat: true } },
  tired: { lid: -0.08, slant: -0.25, low: 1.2, pupil: 0.95, lookY: 0.35, bags: true, sweat: true, brow: [-1.38, -0.22], mouth: { smile: -0.18, openBias: 0.12 } },
  disgust: { lid: -0.42, slant: 0.22, low: 0.48, lowCurve: 0.15, pupil: 0.85, lookX: -0.5, brow: [-1.35, 0.3, 'wavy'], green: true, mouth: { wave: 0.1, tongue: true } },
};
export function emotionParams(name) { return EMO[name] || EMO.neutral; }

// Realistic emotion cues for non-cartoon fish: pupil size, look bias, mouth gape, fin raise,
// breathing (gill flare) rate, twitching and a colour flush [hex, alpha].
const REAL = {
  neutral: {},
  happy: { pupil: 1.05, breath: 0.9 },
  sad: { pupil: 0.95, ly: 0.45, gape: 0.05, breath: 0.8, flush: ['#5a6a80', 0.12] },
  angry: { pupil: 0.66, gape: 0.18, raise: 1, breath: 2, flush: ['#3a0810', 0.2] },
  scared: { pupil: 1.4, gape: 0.2, raise: 1, breath: 3, twitch: 1, flush: ['#e8f4ff', 0.16] },
  surprised: { pupil: 1.45, gape: 0.42, raise: 1, breath: 1.5 },
  love: { pupil: 1.3, breath: 1.2, flush: ['#ff6a8a', 0.1] },
  sleepy: { pupil: 0.8, dim: 0.3, ly: 0.3, breath: 0.45, flush: ['#101828', 0.12] },
  dizzy: { spin: 1, gape: 0.12, breath: 1.4 },
  smug: { pupil: 0.9, lx: -0.55 },
  determined: { pupil: 0.72, gape: 0.08, raise: 1, breath: 1.6, flush: ['#14101c', 0.12] },
  tired: { pupil: 0.9, ly: 0.35, gape: 0.25, breath: 1.4, flush: ['#7a8aa0', 0.12] },
  disgust: { pupil: 0.82, lx: -0.6, gape: 0.35, breath: 2.4, flush: ['#6a8a3a', 0.12] },
};
export function realCues(name) { return REAL[name] || REAL.neutral; }
const MOUTH_IN = [P('#12040a'), P('#280a14'), P('#481424'), P('#7a2a3a'), P('#a04a58')];
const EYE_RING = P('#120c14'), PUPIL_EDGE = P('#2a2234');
const EXPR_MAP = { sleep: 'sleepy', shock: 'surprised', happy: 'happy', dizzy: 'dizzy', angry: 'angry' };

const SCLERA = [P('#a8b4cc'), P('#c8d2e2'), P('#e6ecf6'), P('#ffffff'), P('#ffffff')];
const HEART = ramp('#ff4d7a').map((h) => P(h));
const TEAR = P('#8fd8ff'), TEAR_D = P('#3a8ad0'), WHITE = P('#ffffff');
const VEIN = P('#ff3a3a'), VEIN_D = P('#8a1020');
const BLUSH = P('#ff7a9a', 210);
const GREEN = P('#86c86a', 220);

// Eye sprite half-size (canvas px) for an eye of canvas radius R.
export const eyeBox = (R) => Math.ceil(R * 2.7 + 5);

/**
 * Paint one eye centred at (cx, cy) in buf. f: {emotion, blink 0..1, lx, ly (look dir, |v|<=1),
 * gx, gy (googly pupil offset), time, mirror, cheek, main}. ang: fish rotation, R: canvas radius.
 */
function eyeCore(ex, ey, d, R, e, pxo, pyo, pupR, f, x, y) {
  if (d > 1 - (R < 3.2 ? 0.75 : 1) / R) return EYE_RING;
  const dp = Math.hypot(ex - pxo, ey - pyo);
  const hr = Math.max(0.55 / R, R >= 3.4 ? 0.3 : 0.32);
  const hx = -0.3 + pxo * 0.3, hy = -0.34 + pyo * 0.3;
  if (!f.noGlint && Math.hypot(ex - hx, ey - hy) < hr) return WHITE;
  if (R >= 4 && !f.noGlint && Math.hypot(ex - 0.3 - pxo * 0.3, ey - 0.32 - pyo * 0.3) < 0.55 / R) return P('#e8eef8');
  if (dp < pupR) return dp > pupR - 0.9 / R && R >= 3.2 ? PUPIL_EDGE : e.pupil;
  const b = 0.72 + ey * 0.28 - (dp < pupR + 0.95 / R ? 0.22 : 0) - (f.dim || 0) - (ey < -0.48 ? 0.25 : 0);
  return rampPick(e.realIris, clamp01(b), x, y);
}

export function paintEye(buf, glow, cx, cy, c, e, f, ang, R) {
  const toon = c.toon || e.type === 'googly' || e.type === 'pixel';
  const em = toon ? (EMO[f.emotion] || EMO.neutral) : EMO.neutral;
  const hb = eyeBox(R);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const blink = clamp01(f.blink || 0);
  const tiny = e.type === 'dot' || R < 2.3;
  const wide = tiny ? 1 : em.wide || 1;
  const lidR = e.lidR || c.bodyR;
  const th = Math.max(1, R * 0.17) / R; // 1+ px line in normalised units
  const x0 = Math.floor(cx - hb), x1 = Math.ceil(cx + hb), y0 = Math.floor(cy - hb), y1 = Math.ceil(cy + hb);
  const shake = em.shake ? (Math.floor((f.time || 0) * 30) & 1) * 0.6 / R : 0;
  // look offsets
  let lx = (f.lx || 0) + (em.lookX || 0), ly = (f.ly || 0) + (em.lookY || 0);
  const lm = Math.hypot(lx, ly);
  if (lm > 1) { lx /= lm; ly /= lm; }
  const irisR = e.irisR ? (e.irisSize ?? 0.68) : 0;
  const pupR = Math.min(0.8, R < 3.2 && e.type === 'normal' ? 1 - 1.45 / R : 1, (e.pupilSize ?? 0.48) * (f.pupil || 1) * (toon ? em.pupil || 1 : 1));
  const maxOff = Math.max(0, 1 - pupR - 0.16);
  let pxo = lx * maxOff + shake, pyo = ly * maxOff + (toon ? 0 : blink * 0.18);
  if (!toon && blink > 0.5) f = { ...f, noGlint: true };
  void irisR;
  if (e.type === 'googly') { pxo = (f.gx ?? 0) * 0.42; pyo = (f.gy ?? 0.42) * 0.42; }
  const closedArc = em.closed === 'arc';
  const closedBlink = toon && blink >= 0.86;
  const time = f.time || 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const ex = (dx * ca + dy * sa) / R, ey = (-dx * sa + dy * ca) / R;
      const mx = f.mirror ? -ex : ex;
      const d = Math.hypot(ex, ey) / wide;
      let col = 0, gl = 0;
      if (e.type === 'pixel') {
        const sq = Math.max(Math.abs(ex), Math.abs(ey));
        if (em.spiral) { if (sq < 0.95 && (Math.abs(ex - ey) < 0.4 || Math.abs(ex + ey) < 0.4)) col = e.sclera; }
        else if (closedArc || blink > 0.5 || em.lid > -0.2) { if (sq < 0.95 && Math.abs(ey - 0.2) < 0.38) col = e.sclera; }
        else if (sq < 0.9) col = em.heart ? HEART[3] : e.sclera;
        if (col) buf.set(x, y, col);
        continue;
      }
      if (d <= 1) {
        if (tiny) {
          // tiny dot eye
          if (closedArc) { if (Math.abs(ey + 0.1 - Math.abs(ex) * 0.55) < 0.45) col = lidR[0]; }
          else if (closedBlink) { if (Math.abs(ey - 0.1) < 0.45) col = lidR[0]; }
          else if (em.heart) col = d < 0.95 ? HEART[2] : 0;
          else {
            col = d < 0.95 ? (d > 0.6 && ey > 0.1 ? rampPick(e.realIris, 0.5, x, y) : e.pupil) : 0;
            if (R >= 1.6 && ex < -0.1 && ey < -0.1 && d < 0.75 && !f.noGlint) col = WHITE;
            if (e.type === 'glow') { col = d < 0.5 ? WHITE : P(e.glowHex); gl = P(e.glowHex); }
          }
        } else if ((closedArc && e.type !== 'googly') || closedBlink) {
          // closed eye: lid with lash line
          const yl = closedArc ? -0.12 + 0.62 * Math.abs(ex) ** 1.15 : 0.12 + 0.24 * (1 - ex * ex);
          if (Math.abs(ey - yl) < th * 0.75 && Math.abs(ex) < 0.92) col = c.mouth.lineP;
          else if (ey < yl || closedArc) col = rampPick(lidR, clamp01(0.6 - ey * 0.25), x, y);
          else col = 0;
          if (col && d > 1 - 1 / R && !(Math.abs(ey - yl) < th * 0.75)) col = closedArc && ey > yl ? 0 : lidR[1];
        } else {
          let yU = (em.lid ?? -0.95) + (em.slant || 0) * mx - 0.12 * (1 - mx * mx);
          yU = toon ? Math.max(yU, -1.05 + 2.1 * blink) : -2;
          let yL = toon ? (em.low ?? 1.2) - (em.lowCurve || 0) * mx * mx : 2;
          if (e.type === 'googly') { yU = blink ? -1.05 + 2.1 * blink : -2; yL = 2; }
          if (ey < yU) {
            col = Math.abs(ey - yU) < th ? c.mouth.lineP : rampPick(lidR, clamp01(0.62 - ey * 0.3), x, y);
          } else if (ey > yL) {
            col = Math.abs(ey - yL) < th * 0.8 ? lidR[0] : rampPick(lidR, clamp01(0.5 - ey * 0.15), x, y);
          } else if (e.type === 'googly') {
            const gd = Math.hypot(ex - pxo, ey - pyo);
            if (d > 1 - Math.max(1.6, R * 0.16) / R) col = P('#1a1424');
            else if (gd < 0.5) col = gd < 0.48 && ex - pxo < -0.15 && ey - pyo < -0.15 && gd > 0.2 ? P('#3a3448') : P('#14101c');
            else if (ex < -0.25 && ey < -0.25 && Math.abs(d - 0.62) < 0.1) col = WHITE;
            else col = ex * 0.45 + ey > 0.5 ? SCLERA[2] : SCLERA[3];
          } else if (em.heart) {
            const hx = (ex - pxo * 0.4) / 0.95, hy = -(ey - pyo * 0.4) / 0.95 + 0.15;
            const hv = (hx * hx + hy * hy - 0.42) ** 3 - hx * hx * hy * hy * hy * 1.15;
            if (hv < 0) col = hx < -0.15 && hy > 0.2 && hv < -0.004 && hx > -0.55 ? HEART[4] : rampPick(HEART, clamp01(0.62 + hy * 0.3), x, y);
            else col = d > 1 - 1 / R ? SCLERA[0] : SCLERA[3];
          } else if (em.spiral) {
            const rot = Math.floor(time * 8) * 0.8;
            const t = fract(d * 2.3 - (Math.atan2(ey, ex) + rot) / TAU);
            col = t < 0.32 ? P('#2a1a34') : SCLERA[3];
            if (d > 1 - 1 / R) col = SCLERA[0];
          } else if (e.type === 'glow') {
            const g = P(e.glowHex);
            const gd = Math.hypot(ex - pxo * 0.6, ey - pyo * 0.6);
            col = gd < 0.32 ? WHITE : d > 0.82 ? P(shade(e.glowHex, -0.35)) : g;
            if (e.iris) { const pd = Math.hypot(ex - pxo, ey - pyo); if (pd < 0.22 * (em.pupil || 1)) col = e.pupil; }
            gl = g;
          } else {
            col = eyeCore(ex, ey, d, R, e, pxo, pyo, pupR, f, x, y);
          }
        }
      } else {
        // outside the eyeball: rim, brows, cheeks, marks
        if (!tiny && d <= 1 + 1.05 / R && !closedArc) col = e.type === 'googly' ? P('#1a1424') : 0;
        if (c.monocle && f.main && !tiny) {
          const mr = 1.28 + 0.35 * c.k / R, mt = Math.max(1.2, R * 0.16) / R;
          if (d > mr - mt && d < mr + mt) col = (ex < -0.3 && ey < -0.3) ? P('#fff6c0') : ey > 0.3 ? P('#a87818') : P('#e8c040');
        }
        const brow = toon ? em.brow : null;
        if (brow && e.brow !== false && R >= 2.4 && (f.main || e.brow) && Math.abs(mx) < 0.95) {
          let by = brow[0] * Math.max(1, wide) + brow[1] * mx;
          if (brow[2] === 'arch') by -= 0.28 * (1 - mx * mx);
          if (brow[2] === 'wavy') by += 0.14 * Math.sin(mx * 6.5);
          const bt = Math.max(1.2, R * 0.24) / R * (1 - 0.35 * Math.abs(mx));
          if (Math.abs(ey - by) < bt) col = lidR[0];
        }
        if (f.cheek && (em.blush || (toon && e.blush)) && Math.hypot((mx + 0.35) / 0.9, (ey - 1.5) / 0.4) < 1 && bayer(x, y) < 0.62) col = col || BLUSH;
        if (f.cheek && em.green) for (const gx of [-0.6, -0.15, 0.3]) if (Math.abs(mx - gx) < 0.5 / R + 0.05 && ey > 1.25 && ey < 1.8) col = col || GREEN;
        if (em.bags && ey > 0.95 && ey < 1.4 && Math.abs(Math.hypot(ex, (ey - 0.1) / 1.1) - 1.12) < th * 0.8) col = col || lidR[0];
        if (em.tears && f.cheek) {
          for (let k = 0; k < 3; k++) {
            const ty = 0.95 + fract(time * 0.9 + k / 3) * 1.6;
            const tx = -0.85 - (ty - 0.95) * 0.15;
            const tr = Math.max(0.9, R * 0.22) / R;
            if (Math.hypot(mx - tx, ey - ty) < tr * (k === 0 ? 1.2 : 1)) col = Math.hypot(mx - tx + tr * 0.35, ey - ty + tr * 0.35) < tr * 0.45 ? WHITE : TEAR;
          }
          if (Math.abs(mx + 0.86) < 0.6 / R + 0.04 && ey > 0.9 && ey < 1.3) col = col || TEAR;
        }
        if (em.sweat && f.main) {
          const bob = Math.sin(time * 6) * 0.08;
          const sx = 1.2, sy = -1.25 + bob, sr = Math.max(1.4, R * 0.42) / R;
          const ddx = mx - sx, ddy = ey - sy;
          const inDrop = Math.hypot(ddx, ddy) < sr || (ddy < 0 && ddy > -sr * 2.2 && Math.abs(ddx) < sr * (1 + ddy / (sr * 2.2)));
          const nearDrop = Math.hypot(ddx, ddy) < sr + 1 / R || (ddy < 0 && ddy > -sr * 2.2 - 1 / R && Math.abs(ddx) < sr * (1 + ddy / (sr * 2.2)) + 1 / R);
          if (inDrop) col = ddx < -sr * 0.1 && ddy < -sr * 0.1 && ddy > -sr * 0.9 ? WHITE : TEAR;
          else if (nearDrop) col = TEAR_D;
        }
        if (em.vein && f.main) {
          const pulse = 1 + 0.12 * (Math.floor(time * 6) & 1);
          const vs = 0.62 * pulse * Math.max(1, 3.2 / R);
          const ax = (ex + 0.45) / vs, ay = (ey + 2.15) / vs;
          if (Math.abs(ax) < 1.05 && Math.abs(ay) < 1.05) {
            const vt = Math.max(0.16, 0.9 / (R * vs));
            for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
              const dd = Math.hypot(ax - sx * 0.95, ay - sy * 0.95);
              if (Math.abs(dd - 0.62) < vt && Math.sign(ax) === sx && Math.sign(ay) === sy) col = VEIN;
              else if (Math.abs(dd - 0.62) < vt + 0.9 / (R * vs) && Math.sign(ax) === sx && Math.sign(ay) === sy) col = col || VEIN_D;
            }
          }
        }
      }
      if (c.glasses && (f.main || c.glasses.both)) col = glassesPix(c.glasses, mx, ey, R, col);
      if (col) {
        buf.set(x, y, col);
        if (glow && gl) glow.set(x, y, gl);
      }
    }
  }
}

// Glasses / eye patch painted with the eye (eye-local coords, +mx toward the nose).
const GL_FRAME = P('#16141c'), GL_LENS = P('#12121c'), GL_LENS2 = P('#2c2e40'), GL_GLINT = P('#a8b8d8'), GL_SHINE = P('#eef4ff');
function glassesPix(g, mx, ey, R, col) {
  const style = g.style || 'shades';
  const t = Math.max(1.05, R * 0.2) / R;
  const frame = g.P || (style === 'round' ? P('#3a2a18') : GL_FRAME);
  // arm back toward the ear
  if (style !== 'patch' && mx < -1.25 && mx > -2.65 && Math.abs(ey + 0.3 - (mx + 1.25) * 0.08) < t * 0.75) return frame;
  if (style === 'patch') {
    const dd = Math.hypot(mx / 1.08, (ey - 0.02) / 1.15);
    if (dd < 1) return dd > 1 - t ? P('#05050a') : mx < -0.25 && ey < -0.35 ? P('#34303c') : GL_LENS;
    if (Math.abs(ey + 0.95 + (mx + 0.3) * 0.85) < t * 0.7 && mx < 0.1 && mx > -2.5) return GL_LENS;
    return col;
  }
  if (style === 'square') {
    const ax = Math.abs(mx), ay = Math.abs(ey + 0.05);
    if (ax < 1.42 && ay < 1.12) {
      if (ax > 1.42 - t || ay > 1.12 - t) return frame;
      if (col && Math.abs(mx + ey + 0.5) < 0.13 && ey < 0) return GL_SHINE;
    }
    return col;
  }
  const shades = style === 'shades';
  const dd = Math.hypot(mx, (ey + (shades ? 0.05 : 0)) * (shades ? 1.12 : 1));
  const rr = shades ? 1.45 : 1.36;
  if (dd < rr && !(shades && ey < -1.12)) {
    if (dd > rr - t || (shades && ey < -1.12 + t)) return frame;
    if (shades) return Math.abs(mx + ey + 0.45) < 0.17 && ey < 0.1 ? GL_GLINT : ey < -0.5 ? GL_LENS2 : GL_LENS;
    if (col && Math.abs(mx + ey + 0.6) < 0.12 && ey < 0) return GL_SHINE;
  }
  return col;
}

export const mouthBox = (W) => Math.ceil(W * 1.25 + 5);

/**
 * Paint a mouth. Side view: tip at (mx, my), extends backwards (-x local). Front view: centred.
 * m: compiled mouth {type, w, lineP, R}, f: {emotion, open 0..1, time}, ang: rotation, W: canvas length.
 */
// Realistic side-view jaw: closed = jaw line + lip highlight; open = dropped lower jaw, dark gape.
function realJaw(c, m, t, ux, uy, W, open, sm, x, y) {
  if (t < -0.02 || t > 1.04) return 0;
  const tc = clamp01(t);
  const jaw = W * (m.sag ?? 0.1) * Math.pow(tc, 1.4) - sm * W * 0.3 * tc * tc;
  const line = m.lineP;
  const lips = m.type === 'lips';
  const lipT = lips ? Math.max(1.5, W * 0.22) : 0;
  if (open > 0.06) {
    const low = jaw + open * W * 0.55 * Math.pow(1 - tc, 1.1) + 0.5;
    if (uy > jaw + 0.5 && uy < low) {
      if ((m.type === 'fangs' || m.teeth) && (uy - jaw < 1.6 || low - uy < 1.4) && (Math.floor(-ux / Math.max(1.5, W * 0.12)) & 1) === 0) return WHITE;
      return rampPick(MOUTH_IN, clamp01(0.12 + (uy - jaw) / Math.max(1, low - jaw) * 0.3 + (1 - tc) * 0.25), x, y);
    }
    if (uy >= low && uy < low + 1.2 + lipT * 0.6 && tc < 0.96) return lips ? rampPick(m.R, 0.5, x, y) : c.bellyR[2];
    if (Math.abs(uy - jaw) < 0.6) return line;
    if (lips && uy < jaw && uy > jaw - lipT && tc < 0.55) return rampPick(m.R, 0.7, x, y);
    return 0;
  }
  if (Math.abs(uy - jaw) < 0.6 && t > 0.03) return line;
  if (lips && tc < 0.5 && Math.abs(uy - jaw) < lipT) return rampPick(m.R, uy < jaw ? 0.75 : 0.45, x, y);
  if (m.type === 'fangs') {
    for (const ft of [0.2, 0.55]) {
      const fl = Math.max(1.5, W * 0.2) * (ft < 0.3 ? 1 : 0.8);
      if (Math.abs(t - ft) * W < Math.max(0.6, W * 0.05) * (1 - (uy - jaw) / fl) && uy > jaw && uy < jaw + fl) return WHITE;
    }
  }
  if (uy < jaw - 0.6 && uy > jaw - 1.6 && t > 0.08 && t < 0.7) return c.bodyR[4];
  return 0;
}

export function paintMouth(buf, mx, my, c, m, f, ang, W, front = false) {
  if (!m || m.type === 'none' || W < 1) return;
  const em = (c.toon ? EMO[f.emotion] || EMO.neutral : EMO.neutral).mouth || {};
  const hb = mouthBox(W);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let open = clamp01(f.open || 0);
  if (open > 0.05 && em.openBias) open = Math.min(1, open + em.openBias);
  const O = em.O && open < 0.5 ? em.O * (0.7 + open) : 0;
  const line = m.lineP;
  const inside = P('#2a0b18'), tongue = P('#ff6f8f'), tongueH = P('#ffb0c4');
  const lipsR = m.R;
  const W2 = front ? W / 2 : W;
  const sm = (em.smile || 0) + (m.smile || 0);
  for (let y = Math.floor(my - hb); y <= Math.ceil(my + hb); y++) {
    for (let x = Math.floor(mx - hb); x <= Math.ceil(mx + hb); x++) {
      const dx = x + 0.5 - mx, dy = y + 0.5 - my;
      const ux = dx * ca + dy * sa, uy = -dx * sa + dy * ca;
      let col = 0;
      // t: 0 at tip/centre .. 1 at the corner
      const t = front ? Math.abs(ux) / W2 : -ux / W;
      const curveY = (tt) => {
        let yy = 0;
        if (front) {
          if (sm) yy += sm * W * 0.32 * (1 - tt * tt);
          if (em.smirk) yy += (ux > 0 ? em.smirk * W * 0.35 * (1 - tt * tt) : 0);
          if (em.wave) yy += em.wave * W * Math.sin((ux / W) * TAU * 1.6);
        } else {
          if (sm) yy -= sm * W * 0.42 * tt * tt;
          if (em.smirk) yy -= em.smirk * W * 0.7 * Math.max(0, tt - 0.45) ** 2 / 0.3;
          if (em.wave) yy += em.wave * W * Math.sin(tt * TAU * 1.3);
        }
        return yy;
      };
      const type = m.type;
      if (!front && (type === 'small' || type === 'big' || type === 'fangs' || type === 'lips')) {
        col = realJaw(c, m, t, ux, uy, W, open, c.toon ? sm * 0.6 : (m.smile || 0) * 0.6, x, y);
      } else if (type === 'lips') {
        // pucker / ring lips
        const lx0 = front ? ux : ux + W * 0.05;
        if (open > 0.12 || O) {
          const rr = W * (0.28 + 0.25 * Math.max(open, O));
          const dd = Math.hypot(lx0 / 1.1, uy);
          if (dd < rr * 0.6) col = dd < rr * 0.3 && uy > 0 ? tongue : inside;
          else if (dd < rr) col = rampPick(lipsR, clamp01(0.7 - uy / rr * 0.4), x, y);
        } else {
          const up = Math.hypot((lx0 - W * 0.02) / 1.25, uy + W * 0.13) < W * 0.2;
          const lo = Math.hypot((lx0 - W * 0.0) / 1.2, uy - W * 0.12) < W * 0.19;
          if (Math.abs(uy) < Math.max(0.6, W * 0.04) && Math.abs(lx0) < W * 0.2) col = line;
          else if (up || lo) col = rampPick(lipsR, clamp01((up ? 0.75 : 0.55) - uy / W * 0.6), x, y);
        }
      } else if (type === 'beak' && !front) {
        if (t >= -0.15 && t <= 1) {
          const gap = open * W * 0.32 * (1 - t);
          if (open > 0.08 && Math.abs(uy) < gap) col = Math.abs(uy) < gap * 0.4 && t > 0.3 ? tongue : inside;
          else if (Math.abs(uy - (open > 0.08 ? 0 : curveY(t) * 0.3)) < 0.6 && t > 0) col = line;
        }
      } else if (type === 'gulper' && !front) {
        if (t >= -0.05 && t <= 1.02) {
          const tc = clamp01(t);
          const jaw = W * 0.03 * tc;
          const drop = open > 0.05 ? open * W * 0.62 * Math.pow(Math.max(0, 1 - tc), 0.85) : 0;
          const upLine = -open * W * 0.08 * (1 - tc);
          const pouch = Math.max(drop + W * 0.06, jaw + W * 0.17 * Math.sin(Math.PI * Math.min(1, tc * 1.08)));
          if (open > 0.05 && uy > upLine && uy < drop) {
            col = rampPick([P('#12040c'), P('#2a0a1c'), P('#4a1430'), P('#7a2a48'), P('#a04a66')], clamp01(0.15 + (uy - upLine) / Math.max(1, drop) * 0.5), x, y);
            if (Math.abs(uy - upLine) < 1 && (Math.floor(-ux) % 3) === 0) col = WHITE;
          } else if (uy >= Math.max(jaw, drop) - 0.5 && uy < pouch) {
            col = uy > pouch - 1.2 ? c.bellyR[0] : rampPick(c.bellyR, clamp01(0.55 - (uy - jaw) / Math.max(1, pouch - jaw) * 0.35), x, y);
            if (open <= 0.05 && Math.abs(uy - jaw) < 0.6 && t > 0.02) col = line;
          }
        }
      } else if (type === 'emoticon') {
        // upright text face for screens: "(" sad, ")" happy, "O" surprised, "S" dizzy
        const hh = W / 2, th = Math.max(0.8, (m.thick || 2) * 0.55);
        const e2 = f.emotion;
        if (Math.abs(uy) <= hh) {
          const tt = uy / hh;
          let xc = null;
          const bul = W * 0.22;
          if (open > 0.3 || e2 === 'surprised' || e2 === 'scared') {
            const rr = Math.hypot(ux / (W * 0.24), uy / (hh * (0.6 + 0.4 * Math.max(open, 0.5))));
            if (Math.abs(rr - 1) * W * 0.24 < th) col = line;
          } else {
            if (e2 === 'happy' || e2 === 'love' || e2 === 'smug') xc = bul * (1 - tt * tt) - bul / 2;
            else if (e2 === 'dizzy' || e2 === 'disgust') xc = Math.sin(tt * Math.PI * 1.5) * bul * 0.5;
            else if (e2 === 'determined') xc = 0;
            else xc = -bul * (1 - tt * tt) + bul / 2;
            if (Math.abs(ux - xc) < th) col = line;
          }
        }
      } else {
        // generic: small / big / fangs
        const tk = 0.6 * (m.thick || 1);
        if (O && !front ? true : O && front) {
          const rr = W * 0.3 * (front ? 0.8 : 1) * (0.6 + O * 0.7);
          const cxo = front ? 0 : -W * 0.3;
          const dd = Math.hypot((ux - cxo) / 0.9, uy);
          if (dd < rr) col = dd > rr - 1 ? line : uy > rr * 0.25 ? tongue : inside;
        } else if (open > 0.08) {
          const cxo = front ? 0 : -W * 0.45;
          const rx = (front ? W * 0.45 : W * 0.48) * (0.8 + 0.2 * open);
          const ry = Math.max(1.2, open * W * (type === 'big' ? 0.55 : 0.45) + 0.6);
          const top = em.laugh ? -Math.max(0.5, ry * 0.15) : -ry * 0.55;
          const nx = (ux - cxo) / rx, ny = uy > top ? (uy - top) / (ry - top) : (uy - top) / (ry * 0.55);
          const inE = uy > top ? nx * nx + ny * ny < 1 : nx * nx + ny * ny < 1;
          if (inE) {
            const rim = (nx * nx + ny * ny) > (1 - 2.2 / Math.max(3, rx + ry));
            col = rim ? line : inside;
            if (!rim && ny > 0.35 && Math.abs(nx) < 0.75) col = ny > 0.55 && nx < -0.1 && nx > -0.4 ? tongueH : tongue;
            if (!rim && (em.teeth || type === 'fangs') && uy < top + Math.max(1, ry * 0.22) && uy > top) col = type === 'fangs' && Math.abs(fract(nx * 2.2) - 0.5) > 0.2 ? inside : WHITE;
            if (!rim && type === 'fangs') for (const fx of [-0.45, 0.35]) if (Math.abs(nx - fx) < 0.14 * (1 - (uy - top) / (ry * 0.9)) && uy - top < ry * 0.8) col = WHITE;
            if (!rim && em.teeth && type !== 'fangs' && uy > ry * 0.8 && uy < ry) col = WHITE;
          }
        } else if (t >= (front ? 0 : 0.04) && t <= 1) {
          const yy = curveY(t);
          if (Math.abs(uy - yy) < tk) col = line;
          // corner dimple
          if (!front && t > 0.9 && Math.abs(uy - yy + 0.9) < 0.5 && W > 5 && sm > 0.2) col = line;
          if (type === 'fangs') {
            for (const ft of [0.22, 0.6]) {
              const fl = Math.max(1.5, W * 0.22) * (ft < 0.3 ? 1 : 0.8);
              if (Math.abs(t - ft) * W < Math.max(0.6, W * 0.05) * (1 - (uy - yy) / fl) && uy > yy && uy < yy + fl) col = WHITE;
            }
          }
          if (em.tongue && t > 0.1 && t < 0.5 && uy > yy && uy < yy + W * 0.3 && Math.hypot((t - 0.3) * W, uy - yy - W * 0.12) < W * 0.16) col = tongue;
        }
      }
      if (col) buf.set(x, y, col);
    }
  }
}

// Face state for baked sprites (old frame() API).
function bakedFace(p) {
  const emotion = EXPR_MAP[p.expr] || (EMO[p.expr] ? p.expr : 'neutral');
  return { emotion, blink: p.blink ? 1 : 0, open: p.mouth ? 0.8 : p.rest || 0, lx: 0, ly: 0, gx: 0, gy: 0.5, time: 0 };
}

function paintFaceInto(buf, glow, face, f, offX = 0, offY = 0) {
  for (const ev of face.eyes) {
    const ff = { ...f, mirror: ev.mirror, cheek: ev.cheek, main: ev.main };
    paintEye(buf, glow, ev.x - offX, ev.y - offY, face.c, ev.e, ff, ev.angle ?? face.mouth?.angle ?? 0, ev.r);
  }
  const m = face.mouth;
  if (m) paintMouth(buf, m.x - offX, m.y - offY, face.c, m.m, { emotion: f.emotion, open: f.open, time: f.time }, m.angle || 0, m.w, m.front);
}

// ---------------------------------------------------------------------------
// Custom kinds. Each kind: layers [[id, phaseKey, frames]], ext(c) local extents (unrotated),
// paint(c, part, buf, glow, ox, oy, s, ph, q) and face(c, ph, s, ox, oy, q) -> {eyes, mouth, anchors}.
// Kinds are not rotated (angle ignored); all parts share the kind's fixed bounds.

const KINDS = {};
const rp = (c, hex, role = 'extra') => {
  if (!c._rp) c._rp = new Map();
  let r = c._rp.get(hex + role);
  if (!r) { r = ramp(c.vc(hex, role)).map((h) => P(h)); c._rp.set(hex + role, r); }
  return r;
};
const pk = (c, hex, a = 255) => P(c.vc(hex, 'extra'), a);

// Shaded capsule (limb / stalk / tentacle segment).
function capsule(buf, ax, ay, bx, by, r0, r1, R, opts = {}) {
  const pad = Math.max(r0, r1) + 1;
  const x0 = Math.floor(Math.min(ax, bx) - pad), x1 = Math.ceil(Math.max(ax, bx) + pad);
  const y0 = Math.floor(Math.min(ay, by) - pad), y1 = Math.ceil(Math.max(ay, by) + pad);
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t, cy = ay + dy * t;
    const r = r0 + (r1 - r0) * t;
    const ex = px - cx, ey = py - cy;
    const d = Math.hypot(ex, ey);
    if (d > r) continue;
    const nx = ex / Math.max(0.5, r), ny = ey / Math.max(0.5, r);
    let light = (opts.light ?? 0.55) - ny * 0.35 - nx * 0.12 + (opts.tl ? opts.tl(t) : 0);
    if (r >= 2 && d > r - 0.9 && ny > 0.2) light -= 0.15;
    let col = rampPick(R, clamp01(light), x, y);
    if (opts.alpha != null) col = withA(col, opts.alpha);
    if (opts.under && buf.get(x, y)) continue;
    buf.set(x, y, col);
  }
}

// Shaded ellipse with top-left light. fn(nx, ny, x, y) may override colour (return 0 to keep, -1 to skip).
function shadedEllipse(buf, cx, cy, rx, ry, R, opts = {}) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    const d2 = nx * nx + ny * ny;
    if (d2 > 1) continue;
    let light = (opts.light ?? 0.55) - ny * 0.32 - nx * 0.14 + Math.sqrt(1 - d2) * 0.12;
    if (d2 > 0.82 && ny > 0) light -= 0.12;
    if (opts.rim && d2 > 0.86 && ny < -0.2 && nx < 0.3) light += 0.25;
    let col = rampPick(R, clamp01(light), x, y);
    if (opts.fn) { const o = opts.fn(nx, ny, x, y, col); if (o === -1) continue; if (o) col = o; }
    if (opts.alpha != null) col = withA(col, opts.alpha);
    buf.set(x, y, col);
  }
}

// Pincer claw at (x, y) pointing in dir (+1 right / -1 left), size sz, open 0..1.
function claw(buf, x, y, dir, sz, open, R, metal) {
  shadedEllipse(buf, x, y, sz * 0.62, sz * 0.48, R, { rim: true, fn: (nx, ny, px, py) => (metal && Math.abs(nx) < 0.08 ? R[1] : 0) });
  const tipX = x + dir * sz * 1.25;
  const gap = 0.12 + open * 0.55;
  // upper movable finger (dactyl), lower fixed finger
  capsule(buf, x + dir * sz * 0.35, y - sz * 0.18, tipX, y - sz * (0.1 + gap * 0.9), sz * 0.3, sz * 0.08, R, { light: 0.65 });
  capsule(buf, x + dir * sz * 0.35, y + sz * 0.15, tipX - dir * sz * 0.1, y + sz * (0.12 + gap * 0.3), sz * 0.27, sz * 0.08, R, { light: 0.45 });
  // knuckle highlight
  buf.set(Math.round(x - dir * sz * 0.15), Math.round(y - sz * 0.25), R[4]);
}

KINDS.crab = {
  layers: [['back', 'tail', 12], ['body', 'swim', 8], ['front', 'fin', 8]],
  ext(c) { const L = c.L, H = c.H; return [-L * 0.95 - (c.look.shell === 'mouse' ? L * 0.55 : 0), -H * 1.45, L * 1.0, H * 0.95]; },
  geo(c, s, ph) {
    const L = c.L * s, H = c.H * s;
    const bob = Math.round(Math.sin(ph * TAU * 2) * 0.5 * Math.max(1, c.k * 0.4));
    return { L, H, rx: L / 2, ry: H / 2, cy: -H * 0.12 + bob, bob };
  },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const g = this.geo(c, s, part === 'body' || part === 'all' ? ph : 0);
    const { L, H, rx, ry } = g;
    const shell = c.look.shell || 'round';
    const cx = ox, cy = oy + g.cy;
    const LEG = shell === 'mech' ? rp(c, c.look.legColor || '#8a909c') : (c.look.legColor ? rp(c, c.look.legColor) : c.finR);
    if (part === 'back' || part === 'all') {
      const walk = ph * TAU;
      const lr = Math.max(1.4, H * 0.1);
      for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
        const far = i === 1;
        const bx = cx + side * rx * (0.35 + i * 0.16), by = oy + ry * 0.25 - (far ? H * 0.05 : 0);
        const p2 = walk + i * 2.1 + (side > 0 ? Math.PI : 0);
        const lift = Math.max(0, Math.sin(p2)) * H * 0.12;
        const kx = bx + side * L * 0.16, ky = by - H * 0.18 - lift;
        const fx = bx + side * (L * 0.27 + Math.cos(p2) * L * 0.04), fy = oy + ry * 0.95 - lift * 0.4;
        const RL = far ? LEG.map((v, j) => LEG[Math.max(0, j - 1)]) : LEG;
        capsule(buf, bx, by, kx, ky, lr * 1.15, lr, RL);
        capsule(buf, kx, ky, fx, fy, lr, Math.max(0.6, lr * 0.4), RL, { light: 0.45 });
      }
    }
    if (part === 'body' || part === 'all') {
      // eye stalks (behind shell top)
      for (const [sx, sh] of [[0.18, 1], [0.5, 0.92]]) {
        const ex = cx + rx * sx, top = cy - ry - H * 0.32 * sh;
        capsule(buf, ex, cy - ry * 0.6, ex + H * 0.02, top, Math.max(0.8, H * 0.06), Math.max(0.7, H * 0.05), shell === 'mech' ? rp(c, '#6a707c') : c.bodyR);
      }
      const R = c.bodyR, B = c.bellyR;
      if (shell === 'mouse') {
        // cable tail
        const cr = Math.max(1, H * 0.065);
        const C = rp(c, c.look.cable || '#3a3d48');
        let px0 = cx - rx * 0.98, py0 = cy - ry * 0.18;
        const n = Math.round(L * 0.9);
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const x = cx - rx * 0.98 - t * L * 0.6;
          const y = cy - ry * 0.18 + Math.sin(t * 7 - ph * TAU) * H * 0.16 * t + t * t * H * 0.25;
          capsule(buf, px0, py0, x, y, cr, cr, C);
          px0 = x; py0 = y;
        }
        // plug end
        shadedEllipse(buf, px0 - cr * 0.8, py0, cr * 2, cr * 1.4, rp(c, '#c8ccd4'));
        // mouse shell: egg (narrow at the button end), top surface + side wall
        const MS = c.bodyR;
        for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry * 0.62); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
          const nx = (x + 0.5 - cx) / rx;
          const ryx = ry * (0.8 + 0.2 * clamp(nx, -1, 1) * 0.5 + 0.1);
          const ny = (y + 0.5 - cy) / ryx;
          if (nx * nx + (ny < 0 ? ny * ny : (ny / 0.62) ** 2) > 1) continue;
          const wall = ny > 0.18 + 0.05 * nx;
          let light = wall ? 0.32 - (ny - 0.2) * 0.4 : 0.66 - ny * 0.25 - nx * 0.12;
          const tc = -0.25; // centre line of the top surface
          let col = rampPick(wall ? B : MS, clamp01(light), x, y);
          if (!wall) {
            // button split line + palm seam
            if (nx < -0.12 && Math.abs(ny - tc) * ryx < 0.55) col = MS[0];
            if (Math.abs(nx + 0.12 + (ny - tc) * (ny - tc) * 0.25) * rx < 0.55 && ny > -0.85 && ny < 0.15) col = MS[1];
            // scroll wheel
            const wx = (nx + 0.6) * rx, wy = (ny - tc) * ryx;
            if (Math.abs(wx) < Math.max(1.4, rx * 0.11) && Math.abs(wy) < Math.max(0.9, ryx * 0.13)) {
              col = (Math.floor(wx + 10) & 1) === 0 ? pk(c, '#4a4e5c') : pk(c, '#6e7484');
              if (Math.abs(wy) > Math.max(0.9, ryx * 0.13) - 1) col = pk(c, '#2a2c36');
            }
            // glossy highlight
            if (nx > 0.05 && nx < 0.6 && ny > -0.82 && ny < -0.58 && bayer(x, y) < 0.55) col = MS[4];
          } else if (Math.abs(ny - 0.2 - 0.05 * nx) * ryx < 0.6) col = MS[1];
          buf.set(x, y, col);
        }
        // tiny laser glow underneath
        if (glow) for (let x = -2; x <= 2; x++) glow.set(Math.round(cx + rx * 0.2 + x), Math.round(cy + ry * 0.62), pk(c, '#ff3a3a'));
      } else if (shell === 'mech') {
        const M = R;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry * 0.6); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
          const corner = Math.max(0, Math.abs(nx) - 0.72) / 0.28 + Math.max(0, -ny - 0.62) / 0.38;
          if (corner > 1 || ny > 0.6 || Math.abs(nx) > 1 || ny < -1) continue;
          let light = 0.62 - ny * 0.3 - nx * 0.1;
          if (ny > 0.22) light -= 0.25;
          let col = rampPick(M, clamp01(light), x, y);
          if (Math.abs(ny - 0.22) * ry < 0.6) col = M[0];
          if (Math.abs(nx) * rx < 0.6 && ny < 0.22) col = M[1];
          if (Math.abs(ny + 0.35) * ry < 0.6 && Math.abs(nx) < 0.75) col = M[1];
          if (corner > 0.8) col = M[3];
          for (const [bx2, by2] of [[-0.78, -0.55], [0.78, -0.55], [-0.85, 0.4], [0.85, 0.4], [-0.3, 0.4], [0.3, 0.4]]) {
            const dd = Math.hypot((nx - bx2) * rx, (ny - by2) * ry);
            if (dd < Math.max(0.8, H * 0.05)) col = dd < 0.7 && (nx < bx2) ? P('#ffffff') : pk(c, '#d8dde6');
          }
          buf.set(x, y, col);
        }
        // hazard stripe plate
        for (let y = Math.round(cy + ry * 0.3); y <= Math.round(cy + ry * 0.52); y++) for (let x = Math.round(cx - rx * 0.6); x <= Math.round(cx + rx * 0.6); x++) {
          buf.set(x, y, ((Math.floor((x - y) / Math.max(2, H * 0.1))) & 1) ? pk(c, '#2a2a30') : pk(c, '#ffc83a'));
        }
        // antenna with blinking light
        const ax = cx - rx * 0.45, ay = cy - ry;
        capsule(buf, ax, ay, ax - H * 0.12, ay - H * 0.5, Math.max(0.6, H * 0.03), Math.max(0.6, H * 0.03), rp(c, '#9aa2b0'));
        const on = (Math.floor(ph * 4) & 1) === 0;
        shadedEllipse(buf, ax - H * 0.12, ay - H * 0.52, Math.max(1.2, H * 0.07), Math.max(1.2, H * 0.07), rp(c, on ? '#ff4a4a' : '#7a2020'));
        if (glow && on) glow.set(Math.round(ax - H * 0.12), Math.round(ay - H * 0.52), pk(c, '#ff4a4a'));
        // exhaust pipe
        capsule(buf, cx - rx * 0.95, cy + ry * 0.05, cx - rx * 1.15, cy - ry * 0.35, Math.max(1, H * 0.07), Math.max(1, H * 0.08), rp(c, '#5a5e68'));
      } else {
        // crab carapace with serrated front edge and bumps
        for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry * 0.55); y++) for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
          const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
          const ang = Math.atan2(ny, nx);
          const serr = ny < 0.1 ? 0.06 * Math.max(0, Math.cos(ang * 9)) : 0;
          const r2 = nx * nx + (ny < 0 ? ny * ny : (ny / 0.55) ** 2);
          if (r2 > (1 + serr) ** 2) continue;
          let light = 0.6 - ny * 0.35 - nx * 0.1 + Math.sqrt(Math.max(0, 1 - r2)) * 0.1;
          let col = rampPick(ny > 0.3 ? B : R, clamp01(light), x, y);
          if (r2 < 0.8 && hash2(Math.floor((x - cx) / Math.max(2, c.k)), Math.floor((y - cy) / Math.max(2, c.k)), 4) > 0.86) col = R[3];
          if (ny < -0.55 && nx < 0.1 && nx > -0.6 && bayer(x, y) < 0.4) col = R[4];
          if (Math.abs(ny - 0.3) * ry < 0.6) col = R[1];
          buf.set(x, y, col);
        }
      }
    }
    if (part === 'front' || part === 'all') {
      const open = clamp01((q.mouth || 0) + 0.25 + 0.25 * Math.sin(ph * TAU));
      const CL = shell === 'mech' ? rp(c, '#9aa0ac') : c.finR;
      const sz = H * 0.42;
      const ax = cx + rx * 0.82, ay = cy + ry * 0.15;
      capsule(buf, ax - rx * 0.2, ay, ax + sz * 0.4, ay - sz * 0.55, sz * 0.24, sz * 0.2, CL);
      claw(buf, ax + sz * 0.55, ay - sz * 0.7, 1, sz, open, CL, shell === 'mech');
      const bx = cx - rx * 0.78, by = cy + ry * 0.2;
      capsule(buf, bx + rx * 0.15, by, bx - sz * 0.25, by - sz * 0.45, sz * 0.18, sz * 0.15, CL);
      claw(buf, bx - sz * 0.35, by - sz * 0.6, -1, sz * 0.72, open * 0.7, CL, shell === 'mech');
    }
  },
  face(c, ph, s, ox, oy, q) {
    const g = this.geo(c, s, ph);
    const { rx, ry, H } = g;
    const cx = ox, cy = oy + g.cy;
    const er = Math.max(1.6, (c.eyes[0].r ?? H * 0.12) * (c.look.eye?.r ? s : 1));
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, H * 0.13);
    const eyes = [[0.18, 1], [0.5, 0.92]].map(([sx, sh], i) => ({ x: cx + rx * sx + H * 0.02, y: cy - ry - H * 0.32 * sh - R * 0.4, r: i ? R * 0.92 : R, e: c.eyes[0], idx: i, mirror: false, cheek: false, main: i === 1, angle: 0 }));
    void er;
    return {
      eyes,
      mouth: { x: cx + rx * 0.52, y: cy - ry * 0.05, w: Math.max(3, H * 0.28), m: c.mouth, front: true, angle: 0 },
      anchors: { mouth: [cx + rx + H * 0.3, cy - ry * 0.4], top: [cx, cy - ry - H * 0.6], tail: [cx - rx, cy], bottom: [cx, oy + ry * 0.95] },
    };
  },
};

KINDS.jelly = {
  layers: [['back', 'tail', 12], ['body', 'swim', 8], ['front', 'fin', 8]],
  ext(c) { const L = c.L, H = c.H, tl = c.look.tentacles ?? H * 1.7; return [-L * 0.72, -H * 0.9, L * 0.72, H * 0.25 + tl + 3]; },
  geo(c, s, ph) {
    const pulse = Math.sin(ph * TAU);
    return { bw: (c.L / 2) * (1 + 0.1 * pulse) * s, bh: c.H * 0.62 * (1 - 0.1 * pulse) * s, pulse };
  },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const L = c.L * s, H = c.H * s;
    const a = c.alpha;
    const R = c.bodyR, F = c.finR;
    const glowOn = !!c.look.glow;
    const gonad = rp(c, c.look.gonad || '#ff9fd6');
    if (part === 'back' || part === 'all') {
      const n = c.look.tentacleCount ?? Math.max(5, Math.round(c.L / 5));
      const tl = (c.look.tentacles ?? c.H * 1.7) * s;
      for (let i = 0; i < n; i++) {
        const x0 = ox + (((i + 0.5) / n) * 2 - 1) * L * 0.42;
        const len = tl * (0.75 + 0.25 * hash2(i, 3, 9));
        let lx = x0, ly = oy + H * 0.05;
        for (let k = 1; k <= len; k++) {
          const t = k / len;
          const x = x0 + Math.sin(ph * TAU + i * 1.9 + t * 5) * (1.5 + c.k) * t + (x0 - ox) * t * 0.15;
          const y = oy + H * 0.05 + k;
          const al = Math.round(clamp(a + 40 - t * 150, 40, 255));
          const dot = (k + i * 3) % Math.max(4, Math.round(5 * c.k * 0.5)) === 0;
          const col = withA(dot ? F[4] : F[t > 0.6 ? 3 : 2], dot ? Math.min(255, al + 60) : al);
          buf.line(lx, ly, x, y, col);
          if (glowOn && dot) glow.set(Math.round(x), Math.round(y), F[4]);
          lx = x; ly = y;
        }
      }
    }
    if (part === 'body' || part === 'all') {
      const { bw, bh } = this.geo(c, s, ph);
      const lobes = Math.max(8, Math.round(c.L / 3));
      for (let y = Math.floor(oy - bh - 1); y <= Math.ceil(oy + H * 0.12); y++) for (let x = Math.floor(ox - bw - 2); x <= Math.ceil(ox + bw + 2); x++) {
        const nx = (x + 0.5 - ox) / bw, ny = (y + 0.5 - oy) / bh;
        const ang = Math.atan2(ny, nx);
        const r2 = nx * nx + (ny < 0 ? ny * ny : 0);
        if (r2 > 1) continue;
        // scalloped margin
        const marg = 0.1 + 0.07 * Math.abs(Math.sin(nx * lobes * 0.5 * Math.PI));
        if (ny > marg) continue;
        void ang;
        const rimD = 1 - Math.sqrt(r2);
        const inner = Math.hypot(nx / 0.78, (ny - 0.12) / 0.7) < 1;
        let light = 0.55 - ny * 0.25 - nx * 0.12 + (inner ? -0.12 : 0.05);
        let col = rampPick(R, clamp01(light), x, y);
        let al = inner ? a - 25 : a;
        if (rimD < 0.1 || ny > marg - 0.06) { col = R[4]; al = Math.min(255, a + 70); if (glowOn) glow.set(x, y, R[3]); }
        // radial canals
        const ca2 = Math.atan2(ny - 0.05, nx);
        if (!inner && Math.abs(fract(ca2 / (Math.PI / 8)) - 0.5) < 0.08 && ny < 0) { col = R[3]; al = Math.min(255, a + 30); }
        // gonads: four horseshoes
        for (let k2 = 0; k2 < 4; k2++) {
          const gaa = Math.PI + (k2 + 0.5) * (Math.PI / 4);
          const gx = Math.cos(gaa) * 0.38, gy = -0.3 + Math.sin(gaa) * 0.18;
          const gd = Math.hypot((nx - gx) / 1, (ny - gy) / 1.15);
          if (gd < 0.17 && gd > 0.07) { col = rampPick(gonad, 0.6 - (ny - gy) * 2, x, y); al = Math.min(255, a + 80); if (glowOn) glow.set(x, y, gonad[3]); }
        }
        // specular
        if (nx < -0.35 && nx > -0.62 && ny < -0.45 && ny > -0.8 && bayer(x, y) < 0.5) { col = P('#ffffff'); al = 230; }
        buf.set(x, y, withA(col, al));
      }
    }
    if (part === 'front' || part === 'all') {
      const arms = 4, len = H * 1.0;
      for (let i = 0; i < arms; i++) {
        const x0 = ox + (i - (arms - 1) / 2) * L * 0.07;
        for (let k = 0; k < len * (0.75 + 0.25 * (i & 1)); k++) {
          const t = k / len;
          const sw = Math.sin(ph * TAU + t * 6 + i) * (1 + c.k * 0.8) * (0.3 + t);
          const wdt = Math.max(1, (1 - t * 0.6) * c.k * 0.9);
          for (let w = -wdt; w <= wdt; w++) {
            const ruffle = Math.abs(w) > wdt - 1 && ((k + i) & 1) === 0;
            buf.set(Math.round(x0 + sw + w), Math.round(oy + H * 0.04 + k), withA(ruffle ? F[4] : F[w < 0 ? 3 : 2], Math.min(255, a + 50)));
          }
        }
      }
    }
  },
  face(c, ph, s, ox, oy, q) {
    const { bw, bh } = this.geo(c, s, ph);
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.6, c.L * s * 0.06);
    const ey = oy - bh * 0.42;
    const eyes = c.look.noFace ? [] : [-1, 1].map((sd, i) => ({ x: ox + sd * bw * 0.32, y: ey, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 }));
    return {
      eyes,
      mouth: c.look.noFace ? null : { x: ox, y: ey + R * 1.9, w: Math.max(3, bw * 0.3), m: c.mouth, front: true, angle: 0 },
      anchors: { mouth: [ox, oy + 2], top: [ox, oy - bh - 2], tail: [ox, oy + (c.look.tentacles ?? c.H * 1.7) * s], bottom: [ox, oy + c.H * s * 0.8] },
    };
  },
};

KINDS.pudding = {
  layers: [['body', 'swim', 8]],
  ext(c) { const L = c.L, H = c.H; return [-L * 0.8, -H * 1.45, L * 0.8, H * 0.2 + 3]; },
  geo(c, s, ph, q) {
    const wob = Math.sin(ph * TAU * 2);
    const sq = q?.squash || 0;
    const hh = c.H * s * (1 - 0.07 * wob - sq * 0.2);
    const botW = (c.L / 2) * s * (1 + 0.045 * wob + sq * 0.2);
    return { wob, hh, botW, topW: botW * 0.7, skew: wob * Math.max(1, c.k * 0.6) * s };
  },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const { hh, botW, topW, skew } = this.geo(c, s, ph, q);
    const base = oy;
    const R = c.bodyR, CR = c.finR;
    // plate
    shadedEllipse(buf, ox, base + 1, botW * 1.35, Math.max(2, botW * 0.22), rp(c, c.look.plate || '#e8f0f6'), { light: 0.7, fn: (nx, ny) => (Math.hypot(nx, ny) > 0.8 ? rp(c, '#7ab0d8')[2] : 0) });
    const drips = [[-0.55, 0.35], [-0.05, 0.22], [0.42, 0.45], [0.78, 0.18]];
    for (let y = Math.floor(base - hh - 3); y <= base; y++) {
      const t = (base - y) / hh;
      if (t > 1.03) continue;
      const round = t > 0.86 ? Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.17) ** 2)) : 1;
      const half = lerp(botW, topW, t) * (t > 0.86 ? 0.75 + 0.25 * round : 1);
      const cxr = ox + skew * t;
      for (let x = Math.floor(cxr - half - 1); x <= Math.ceil(cxr + half + 1); x++) {
        const nx = (x + 0.5 - cxr) / Math.max(1, half);
        if (Math.abs(nx) > 1) continue;
        let light = 0.6 - nx * 0.3 + t * 0.15 - (t < 0.08 ? 0.2 : 0);
        let col = rampPick(R, clamp01(light), x, y);
        // caramel cap with drips
        let car = 0.74 + Math.sin(nx * 5 + 1) * 0.03;
        for (const [dx, dl] of drips) if (Math.abs(nx - dx) < 0.09) car = Math.min(car, 0.74 - dl * (1 - (Math.abs(nx - dx) / 0.09) ** 2));
        if (t > car) {
          col = rampPick(CR, clamp01(0.5 - nx * 0.3 + (t - car) * 1.2), x, y);
          if (t > 0.9 && nx < -0.1 && nx > -0.5 && bayer(x, y) < 0.5) col = CR[4];
        } else if (t > car - 0.04) col = CR[1];
        // glossy vertical highlight + cream stripe
        if (nx < -0.55 && nx > -0.78 && t > 0.15 && t < car - 0.08) col = R[4];
        if (nx > 0.7 && t < car) col = R[1];
        buf.set(x, y, col);
      }
    }
    if (c.look.cherry !== false) {
      const chx = ox + skew, chy = base - hh - c.H * s * 0.12;
      const cr = Math.max(1.8, c.H * s * 0.13);
      capsule(buf, chx + cr * 0.2, chy - cr * 0.6, chx + cr * 1.2, chy - cr * 2.3, Math.max(0.5, cr * 0.15), Math.max(0.5, cr * 0.12), rp(c, '#4a8a2a'));
      shadedEllipse(buf, chx, chy, cr, cr * 0.95, rp(c, '#e8304a'), { rim: true, fn: (nx, ny) => (Math.hypot(nx + 0.4, ny + 0.4) < 0.3 ? P('#ffe0e6') : 0) });
    }
  },
  face(c, ph, s, ox, oy, q) {
    const { hh, skew } = this.geo(c, s, ph, q);
    const fy = oy - hh * 0.4;
    const fx = ox + skew * 0.4;
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, c.H * s * 0.09);
    return {
      eyes: [-1, 1].map((sd, i) => ({ x: fx + sd * c.L * s * 0.17, y: fy, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 })),
      mouth: { x: fx, y: fy + R * 1.7, w: Math.max(3, c.L * s * 0.14), m: c.mouth, front: true, angle: 0 },
      anchors: { mouth: [fx, fy + R * 2], top: [ox, oy - hh - c.H * s * 0.3], tail: [ox - c.L * s / 2, oy], bottom: [ox, oy + 2] },
    };
  },
};

KINDS.seahorse = {
  layers: [['back', 'fin', 8], ['body', 'swim', 8], ['front', 'fin', 8]],
  ext(c) { const H = c.H; return [-H * 0.3, -H * 0.56, H * 0.36, H * 0.56]; },
  spine(c, H, ph) {
    const key = Math.round(H * 8) + '|' + Math.floor(fract(ph) * 8);
    if (!c._shSp) c._shSp = new Map();
    let out = c._shSp.get(key);
    if (out) return out;
    const sway = Math.sin(ph * TAU) * 0.012;
    const pts = [[-0.035, -0.29], [-0.065, -0.18], [-0.03, -0.05], [-0.01, 0.07], [-0.04, 0.18], [-0.08 + sway, 0.28], [-0.085 + sway, 0.37]];
    const raw = [];
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < 10; k++) { const t = k / 10; raw.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]); }
    }
    // tail curls forward and up
    const [lx, ly] = pts[pts.length - 1];
    const cR = 0.055 + sway * 0.5;
    const ccx = lx + cR, ccy = ly;
    for (let k = 1; k <= 26; k++) {
      const t = k / 26;
      const ang = Math.PI + t * Math.PI * 1.65;
      const r = cR * (1 - t * 0.6);
      raw.push([ccx + Math.cos(ang) * r, ccy - Math.sin(ang) * r]);
    }
    out = raw.map(([x, y], i) => [x * H, y * H, i / (raw.length - 1)]);
    c._shSp.set(key, out);
    return out;
  },
  thick(t, H) {
    if (t < 0.08) return (0.062 + t * 0.25) * H;
    if (t < 0.38) return (0.082 + (t - 0.08) * 0.13) * H;
    if (t < 0.52) return (0.121 - (t - 0.38) * 0.35) * H;
    return Math.max(0.016, 0.072 - (t - 0.52) * 0.115) * H;
  },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const H = c.H * s;
    const R = c.bodyR, B = c.bellyR, F = c.finR;
    const bob = part === 'body' || part === 'all' ? Math.sin(ph * TAU) * Math.max(0.5, c.k * 0.25) : 0;
    const oyb = oy + bob;
    if (part === 'back' || part === 'all') {
      // dorsal fin fan on the back, rippling
      const fx = ox - H * 0.075, fy = oy + H * 0.02;
      const n = 8;
      for (let k = 0; k < n; k++) {
        const yy = fy + (k - n / 2) * H * 0.016;
        const len = H * (0.085 + 0.03 * Math.sin(ph * TAU * 2 + k * 0.8)) * Math.sin(Math.PI * (k + 0.5) / n) ** 0.5;
        capsule(buf, fx, yy, fx - len, yy - len * 0.25, Math.max(0.6, H * 0.012), Math.max(0.6, H * 0.016), F, { alpha: 225, light: 0.62 });
      }
    }
    if (part === 'body' || part === 'all') {
      const pts = this.spine(c, H, ph);
      const headX = ox + H * 0.025, headY = oyb - H * 0.36;
      const x0 = Math.floor(ox - H * 0.26), x1 = Math.ceil(ox + H * 0.34), y0 = Math.floor(oyb - H * 0.5), y1 = Math.ceil(oyb + H * 0.52);
      const sxA = headX + H * 0.06, syA = headY + H * 0.012, sxB = headX + H * 0.21, syB = headY + H * 0.06;
      const sdx = sxB - sxA, sdy = syB - syA, sl2 = sdx * sdx + sdy * sdy;
      const ringN = 30;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ox, py = y + 0.5 - oyb;
        let best = Infinity, bt = 0, bnx = 0, bny = 0;
        for (const [sx, sy, t] of pts) {
          if (Math.abs(py - sy) > H * 0.14) continue;
          const th = this.thick(t, H);
          const d = Math.hypot(px - sx, py - sy) - th;
          if (d < best) { best = d; bt = t; bnx = (px - sx) / Math.max(0.5, th); bny = (py - sy) / Math.max(0.5, th); }
        }
        const bd = Math.hypot((px - H * 0.035) / (H * 0.085), (py - H * 0.03) / (H * 0.14)) - 1;
        const hd = Math.hypot((x + 0.5 - headX) / (H * 0.095), (y + 0.5 - headY) / (H * 0.07)) - 1;
        let st = ((x + 0.5 - sxA) * sdx + (y + 0.5 - syA) * sdy) / sl2;
        st = clamp01(st);
        const snD = Math.hypot(x + 0.5 - (sxA + sdx * st), y + 0.5 - (syA + sdy * st)) - H * (0.026 + (st > 0.86 ? 0.011 : 0));
        const crX = headX - H * 0.035, crY = headY - H * 0.072;
        const crownD = Math.hypot((x + 0.5 - crX) / (H * 0.04), (y + 0.5 - crY) / (H * 0.045)) - 1;
        const spike = (Math.abs(x + 0.5 - (crX - H * 0.02)) < Math.max(0.6, H * 0.008) && y + 0.5 > crY - H * 0.07 && y + 0.5 < crY) ||
          (Math.abs(x + 0.5 - (crX + H * 0.02)) < Math.max(0.6, H * 0.008) && y + 0.5 > crY - H * 0.055 && y + 0.5 < crY);
        if (best > 0 && bd > 0 && hd > 0 && snD > 0 && crownD > 0 && !spike) {
          // little spines along the back ridge
          if (best < Math.max(1.1, H * 0.022) && bnx < -0.4 && bt > 0.05 && bt < 0.8 && Math.abs(fract(bt * ringN) - 0.5) < 0.14) buf.set(x, y, R[1]);
          continue;
        }
        let col;
        if (hd <= 0 || snD <= 0 || crownD <= 0 || spike) {
          const hx = (x + 0.5 - headX) / (H * 0.1), hy = (y + 0.5 - headY) / (H * 0.075);
          col = rampPick(R, clamp01(0.62 - hx * 0.12 - hy * 0.3), x, y);
          if (crownD <= 0 || spike) col = R[crownD < -0.5 ? 3 : 2];
          if (snD <= 0 && st > 0.86) col = R[1];
          if (snD <= 0 && snD > -0.8 && (y + 0.5) > syA + sdy * st) col = R[1];
          if (hd <= 0 && hx < -0.2 && hy < -0.3 && bayer(x, y) < 0.5) col = R[4];
        } else {
          const belly = bd <= 0 && bnx > -0.25;
          let light = 0.56 - bnx * 0.3 - bny * 0.12;
          if (belly) light = 0.62 - (px - H * 0.035) / (H * 0.085) * 0.25;
          col = rampPick(belly ? B : R, clamp01(light), x, y);
          const ring = Math.abs(fract(bt * ringN) - 0.5) < 0.11;
          if (!belly && bt > 0.04 && bt < 0.97 && ring) col = R[1];
          if (belly && Math.abs(fract(py / Math.max(2, H * 0.04)) - 0.5) < 0.12) col = B[1];
          if (!belly && bnx < -0.45 && bnx > -0.8 && bt > 0.05 && bt < 0.55 && bayer(x, y) < 0.4) col = R[4];
        }
        buf.set(x, y, col);
      }
    }
    if (part === 'front' || part === 'all') {
      const fx = ox - H * 0.02, fy = oy - H * 0.27;
      const fl = Math.sin(ph * TAU * 3) * 0.3;
      for (let k = 0; k < 5; k++) {
        const a = 0.2 + k * 0.32 + fl;
        capsule(buf, fx, fy, fx - Math.cos(a) * H * 0.07, fy + Math.sin(a) * H * 0.06, Math.max(0.5, H * 0.01), Math.max(0.6, H * 0.02), F, { alpha: 210, light: 0.72 });
      }
    }
  },
  face(c, ph, s, ox, oy, q) {
    const H = c.H * s;
    const bob = Math.sin(ph * TAU) * Math.max(0.5, c.k * 0.25);
    const headX = ox + H * 0.025, headY = oy + bob - H * 0.36;
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, H * 0.045);
    return {
      eyes: [{ x: headX + H * 0.012, y: headY - H * 0.008, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: true, main: true, angle: 0 }],
      mouth: { x: headX + H * 0.235, y: headY + H * 0.07, w: Math.max(2, H * 0.045), m: c.mouth, front: false, angle: 0.35 },
      anchors: { mouth: [headX + H * 0.24, headY + H * 0.065], top: [headX, headY - H * 0.15], tail: [ox, oy + H * 0.42], bottom: [ox, oy + H * 0.48] },
    };
  },
};

KINDS.ray = {
  layers: [['back', 'tail', 12], ['body', 'swim', 8]],
  ext(c) { const L = c.L, H = c.H; return [-L * 1.35, -H * 1.25, L * 0.75, H * 1.25]; },
  half(c, u, span) {
    if (c.look.square) return Math.abs(u) <= 1 ? span * 0.9 : 0;
    if (c.look.manta) {
      const ut = -0.08;
      if (u > 1 || u < -0.62) return 0;
      if (u >= ut) return span * (0.2 + 0.8 * Math.pow((1 - u) / (1 - ut), 0.7));
      return span * (0.14 + 0.86 * Math.pow((u + 0.62) / (ut + 0.62), 2.2));
    }
    if (u > 1 || u < -1) return 0;
    if (u > 0.12) return span * Math.pow(Math.max(0, 1 - Math.pow((u - 0.12) / 0.88, 1.7)), 0.7);
    return span * (1 - Math.pow((0.12 - u) / 1.12, 1.25));
  },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const L = c.L * s, span = c.H * s, len = L * 0.5;
    const R = c.bodyR, B = c.bellyR;
    if (part === 'back' || part === 'all') {
      const tl = c.look.manta ? L * 0.45 : L * 0.85;
      let tx = ox - len * (c.look.manta ? 0.7 : c.look.square ? 1 : 0.95), ty = oy;
      const n = Math.ceil(tl);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const nx = ox - len * (c.look.manta ? 0.7 : c.look.square ? 1 : 0.95) - k;
        const ny = oy + Math.sin(ph * TAU - t * 4) * t * span * 0.18;
        capsule(buf, tx, ty, nx, ny, Math.max(0.6, span * 0.045 * (1 - t * 0.8)), Math.max(0.5, span * 0.045 * (1 - t * 0.8)), R, { light: 0.45 });
        tx = nx; ty = ny;
      }
      if (c.look.square) shadedEllipse(buf, tx, ty, Math.max(1.5, span * 0.08), Math.max(1.5, span * 0.08), rp(c, '#c8ccd4'));
    }
    if (part === 'body' || part === 'all') {
      const flap = Math.sin(ph * TAU);
      const sq = c.look.square;
      if (sq) {
        // little side fins flapping
        for (const sd of [-1, 1]) {
          const fy = oy + sd * span * 0.9;
          const ext2 = span * (0.38 + 0.18 * flap * sd);
          for (let x = -len * 0.6; x <= len * 0.5; x++) {
            const t = (x + len * 0.6) / (len * 1.1);
            const hh = ext2 * Math.pow(Math.sin(Math.PI * t), 1.4) * (0.6 + 0.4 * t);
            for (let k = 0; k < hh; k++) buf.set(Math.round(ox + x), Math.round(fy + sd * k), withA(c.finR[k > hh - 1.2 ? 3 : ((Math.round(x) & 3) === 0 ? 1 : 2)], 240));
          }
        }
      }
      for (let y = Math.floor(oy - span * 1.15); y <= Math.ceil(oy + span * 1.15); y++) for (let x = Math.floor(ox - len * 1.1); x <= Math.ceil(ox + len * 1.05); x++) {
        const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
        const u = dx / len;
        const tipShift = c.look.manta ? flap * Math.abs(dy) / span * len * 0.12 : 0;
        const half = this.half(c, u + tipShift / len, span * (1 - 0.06 * Math.abs(flap)));
        if (!half || Math.abs(dy) > half) continue;
        const v = dy / Math.max(1, span);
        if (sq) {
          // rounded corners + write-protect notch
          const cxr = len - Math.abs(dx), cyr = span * 0.9 - Math.abs(dy), rr = span * 0.14;
          if (cxr < rr && cyr < rr && Math.hypot(rr - cxr, rr - cyr) > rr) continue;
          if (dx < -len * 0.72 && dx > -len * 0.88 && dy < -span * 0.62 && dy > -span * 0.8) continue;
        }
        let light = 0.55 - flap * v * 0.28 - Math.abs(v) * 0.12 + (u > 0.6 ? 0.06 : 0);
        if (Math.abs(dy) > half - 1.2 && u > 0) light += 0.25;
        let col = rampPick(R, clamp01(light), x, y);
        if (!sq && !c.look.bsod) {
          if (Math.abs(v) < 0.1 && u < 0.7 && u > -0.85) col = rampPick(R, clamp01(light + 0.18), x, y);
          if (hash2(Math.floor(dx / Math.max(2, c.k)), Math.floor(dy / Math.max(2, c.k)), 6) > 0.9 && Math.abs(v) < 0.8) col = B[2];
        }
        if (sq) {
          const sx = (dx + len * 0.05) / len;
          if (sx > 0.15 && sx < 0.85 && Math.abs(v) < 0.42) {
            col = rampPick(rp(c, '#c8ccd4'), clamp01(0.62 - v * 0.4), x, y);
            if (sx > 0.42 && sx < 0.6 && Math.abs(v) < 0.18) col = rp(c, '#c8ccd4')[0];
          }
          if (sx < -0.18 && sx > -0.85 && Math.abs(v) < 0.6) {
            col = P(c.vc('#f4f2ea', 'extra'));
            if (Math.abs(fract((dy + span) / Math.max(2, span * 0.18)) - 0.5) < 0.12 && Math.abs(v) < 0.48 && sx < -0.25) col = pk(c, '#8aa0c8');
            if (sx > -0.3) col = pk(c, '#e85a5a');
          }
        }
        if (c.look.bsod) {
          // screen text rows
          const rowH = Math.max(3, span * 0.1);
          if (u < -0.14 && u > -0.55 && Math.abs(v) < 0.5 && (Math.floor((dy + span) / rowH) & 1) === 0 && Math.floor((dy + span) / 1) % Math.round(rowH) < 2 && hash2(Math.floor(dx / Math.max(3, c.k * 2)), Math.floor((dy + span) / rowH), 4) > 0.3) col = pk(c, '#a8c0ff');
          if (glow) glow.set(x, y, R[2]);
        }
        buf.set(x, y, col);
      }
      if (c.look.manta) {
        for (const sd of [-1, 1]) {
          const hx = ox + len * 0.92, hy = oy + sd * span * 0.17;
          capsule(buf, hx - len * 0.1, hy, hx + len * 0.2, hy + sd * span * 0.06 * (1 + flap * 0.4), Math.max(1.2, span * 0.07), Math.max(0.8, span * 0.045), R, { light: 0.62 });
        }
      }
    }
  },
  face(c, ph, s, ox, oy, q) {
    const L = c.L * s, span = c.H * s, len = L * 0.5;
    const anchors = { mouth: [ox + len, oy], top: [ox, oy - span - 3], tail: [ox - len * 1.6, oy], bottom: [ox, oy + span] };
    if (c.look.bsod) {
      if (!c._bsodEye) {
        c._bsodEye = { ...c.eyes[0], type: 'pixel', sclera: P('#ffffff'), brow: false };
        c._bsodMouth = { ...c.mouth, type: 'emoticon', lineP: P('#ffffff'), thick: Math.max(2, Math.round(c.k * 0.6)) };
      }
      const R = Math.max(1.5, span * 0.06);
      const fx = ox + len * 0.2, fy = oy;
      return {
        eyes: [-1, 1].map((sd, i) => ({ x: fx - span * 0.12, y: fy + sd * span * 0.13, r: R, e: c._bsodEye, idx: i, mirror: false, cheek: false, main: i === 0, angle: 0 })),
        mouth: { x: fx + span * 0.1, y: fy, w: span * 0.5, m: c._bsodMouth, front: true, angle: 0 },
        anchors,
      };
    }
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, span * 0.11);
    return {
      eyes: [-1, 1].map((sd, i) => ({ x: ox + len * (c.look.square ? 0.62 : 0.5), y: oy + sd * span * (c.look.square ? 0.22 : 0.2), r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: false, main: i === 0, angle: 0 })),
      mouth: c.look.square ? { x: ox + len * 0.86, y: oy, w: span * 0.28, m: c.mouth, front: true, angle: Math.PI / 2 } : null,
      anchors,
    };
  },
};

KINDS.squid = {
  layers: [['back', 'tail', 12], ['body', 'swim', 8]],
  ext(c) { const L = c.L, H = c.H; return [-L * 0.68, -H * 0.95, L * 0.62, H * 0.95]; },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const L = c.L * s, H = c.H * s;
    const R = c.bodyR, F = c.finR;
    const cape = c.look.cape !== false;
    if (part === 'back' || part === 'all') {
      // webbed cloak flaring backwards like a cape: scalloped trailing edge, dark lining band, white cirri
      const open = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ph * TAU));
      const b0 = ox - L * 0.04, Lc = L * 0.46;
      const r0 = H * 0.24, r1 = H * (0.34 + 0.32 * open);
      const rAt = (d) => r0 + (r1 - r0) * Math.pow(clamp01(d / Lc), 1.2);
      const arms = 7;
      const armV = (k2) => (k2 / (arms - 1)) * 1.9 - 0.95;
      const dEnd = (vy) => {
        let near = 1;
        for (let k2 = 0; k2 < arms; k2++) near = Math.min(near, Math.abs(vy - armV(k2)) * (arms - 1) / 1.9);
        return Lc * (0.8 + 0.2 * Math.pow(Math.abs(vy), 1.5)) - Lc * 0.09 * Math.min(1, near * 2);
      };
      const lining = rp(c, c.look.lining || '#2a0c18');
      for (let y = Math.floor(oy - r1 - 2); y <= Math.ceil(oy + r1 + 2); y++) for (let x = Math.floor(b0 - Lc - 2); x <= Math.ceil(b0 + 1); x++) {
        const d = b0 - (x + 0.5), dy = y + 0.5 - oy;
        if (d < 0) continue;
        const rr = rAt(d);
        if (Math.abs(dy) > rr) continue;
        const vy = dy / rr;
        const de = dEnd(vy);
        if (d > de) continue;
        let col = rampPick(R, clamp01(0.5 - vy * 0.3 + (1 - d / Lc) * 0.1), x, y);
        for (let k2 = 0; k2 < arms; k2++) if (Math.abs(vy - armV(k2)) * rr < 0.6) col = R[1];
        if (d > de - Lc * (0.06 + 0.1 * open)) {
          col = rampPick(lining, clamp01(0.35 - vy * 0.2), x, y);
          for (let k2 = 0; k2 < arms; k2++) if (Math.abs(vy - armV(k2)) * rr < 0.7 && ((x + y) & 1) === 0) col = pk(c, '#f4ecf0');
        }
        if (Math.abs(dy) > rr - 1.1 && vy < 0) col = R[3];
        buf.set(x, y, col);
      }
      for (let k2 = 0; k2 < arms; k2++) {
        const vy = armV(k2), de = dEnd(vy), rr = rAt(de);
        const tx = b0 - de, ty = oy + vy * rr;
        const ln = H * (0.14 + 0.05 * Math.sin(ph * TAU + k2));
        capsule(buf, tx + 1, ty, tx - ln * 0.8, ty + vy * ln * 0.6 + Math.sin(ph * TAU * 2 + k2) * H * 0.03, Math.max(0.9, H * 0.035), Math.max(0.5, H * 0.012), rp(c, '#1e0c14'), { light: 0.6 });
      }
    }
    if (part === 'body' || part === 'all') {
      const flap = Math.sin(ph * TAU);
      const m0 = ox - L * 0.02, ml = L * 0.56, mh = H * 0.34;
      // ear fins near the mantle tip
      for (const sd of [-1, 1]) {
        const fx = m0 + ml * 0.66, fy = oy + sd * mh * 0.72;
        const ang = sd * (1.9 - flap * 0.5 * sd);
        const fa = H * 0.3, fb = H * 0.15;
        for (let y = Math.floor(fy - fa - 1); y <= fy + fa + 1; y++) for (let x = Math.floor(fx - fa - 1); x <= fx + fa + 1; x++) {
          const dx = x + 0.5 - fx, dy = y + 0.5 - fy;
          const a = dx * Math.cos(ang) + dy * Math.sin(ang), b = -dx * Math.sin(ang) + dy * Math.cos(ang);
          if (a < 0 || (a / fa) ** 2 + (b / fb) ** 2 > 1) continue;
          let col = rampPick(F, clamp01(0.62 - (b / fb) * 0.3 * sd + (a / fa) * 0.1), x, y);
          if ((a / fa) ** 2 + (b / fb) ** 2 > 0.75) col = F[sd < 0 ? 3 : 1];
          buf.set(x, y, col);
        }
      }
      for (let y = Math.floor(oy - mh - 1); y <= Math.ceil(oy + mh + 1); y++) for (let x = Math.floor(m0 - L * 0.12); x <= Math.ceil(m0 + ml + 1); x++) {
        const u = (x + 0.5 - m0) / ml;
        let half;
        if (u < 0) half = mh * Math.sqrt(Math.max(0, 1 - (u / 0.22) ** 2));
        else half = mh * Math.pow(Math.max(0, 1 - Math.pow(u, 3)), 0.5);
        const dy = y + 0.5 - oy;
        if (Math.abs(dy) > half) continue;
        const v = dy / Math.max(1, half);
        let light = 0.6 - v * 0.34 + (1 - Math.abs(v)) * 0.06 - (u < 0.02 ? 0.06 : 0);
        if (Math.abs(dy) > half - 1.2 && v < 0) light += 0.2;
        let col = rampPick(R, clamp01(light), x, y);
        if (hash2(Math.floor(x / Math.max(1.5, c.k * 0.8)), Math.floor(y / Math.max(1.5, c.k * 0.8)), 2) > 0.92 && u > 0.12) col = R[1];
        if (v < -0.45 && v > -0.8 && u > 0.18 && u < 0.62 && bayer(x, y) < 0.4) col = R[4];
        buf.set(x, y, col);
      }
      if (c.look.photophores && glow) {
        for (const [fx, fy] of [[m0 + ml * 0.95, oy], [m0 + ml * 0.6, oy - mh * 0.55], [m0 + ml * 0.6, oy + mh * 0.55]]) {
          const pr = Math.max(1, H * 0.035);
          shadedEllipse(buf, fx - pr * 0.5, fy, pr, pr, rp(c, '#8ff3ff'), { light: 0.8 });
          glow.fillCircle(fx - pr * 0.5, fy, pr + 0.5, pk(c, '#8ff3ff'));
        }
      }
    }
  },
  face(c, ph, s, ox, oy, q) {
    const L = c.L * s, H = c.H * s;
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, H * 0.15);
    return {
      eyes: [{ x: ox + L * 0.05, y: oy - H * 0.05, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: true, main: true, angle: 0 }],
      mouth: { x: ox - L * 0.045, y: oy + H * 0.16, w: Math.max(3, H * 0.16), m: c.mouth, front: false, angle: Math.PI },
      anchors: { mouth: [ox - L * 0.1, oy], top: [ox + L * 0.2, oy - H * 0.5], tail: [ox - L * 0.5, oy], bottom: [ox, oy + H * 0.5] },
    };
  },
};

KINDS.octopus = {
  layers: [['back', 'tail', 12], ['body', 'swim', 8], ['front', 'fin', 8]],
  ext(c) { const L = c.L, H = c.H; return [-L * 0.95, -H * 0.75, L * 0.95, H * 0.65]; },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const L = c.L * s, H = c.H * s;
    const R = c.bodyR, F = c.finR;
    const a = c.alpha;
    if (part === 'back' || part === 'all') {
      const n = 6;
      const top = oy - H * 0.1;
      for (let y = Math.floor(top); y <= Math.ceil(oy + H * 0.55); y++) for (let x = Math.floor(ox - L * 0.75); x <= Math.ceil(ox + L * 0.75); x++) {
        const dx = x + 0.5 - ox, t = (y + 0.5 - top) / (H * 0.55);
        const w = L * (0.38 + 0.2 * t);
        if (Math.abs(dx) > w) continue;
        let edge = 0.62;
        let armHit = false;
        for (let i = 0; i < n; i++) {
          const xi = ((i + 0.5) / n * 2 - 1) * L * 0.5 + Math.sin(ph * TAU + i) * L * 0.03;
          const bump = Math.max(0, 1 - Math.abs(dx - xi) / (L * 0.08));
          edge = Math.max(edge, 0.62 + 0.38 * bump);
          if (bump > 0.55) armHit = true;
        }
        if (t > edge) continue;
        let col = rampPick(F, clamp01(0.5 - t * 0.25 - dx / L * 0.2 + (armHit ? 0.08 : -0.06)), x, y);
        if (armHit && t > 0.62 && ((x + y) & 3) === 0) col = F[4];
        buf.set(x, y, withA(col, armHit ? Math.min(255, a + 30) : Math.max(120, a - 50)));
      }
    }
    if (part === 'body' || part === 'all') {
      const sq = Math.sin(ph * TAU) * 0.05;
      shadedEllipse(buf, ox, oy - H * 0.16, L * 0.42 * (1 + sq), H * 0.36 * (1 - sq), R, {
        rim: true, alpha: a,
        fn: (nx, ny, x, y) => {
          if (hash2(Math.floor(x / Math.max(2, c.k)), Math.floor(y / Math.max(2, c.k)), 8) > 0.92 && ny < 0.5) return R[1];
          if (nx < -0.25 && nx > -0.6 && ny < -0.35 && ny > -0.75 && bayer(x, y) < 0.45) return R[4];
          return 0;
        },
      });
    }
    if (part === 'front' || part === 'all') {
      const flap = Math.sin(ph * TAU);
      for (const sd of [-1, 1]) {
        const fx = ox + sd * L * 0.34, fy = oy - H * 0.36;
        const ang = sd > 0 ? -0.35 - flap * 0.45 : Math.PI + 0.35 + flap * 0.45;
        for (let y = Math.floor(fy - L * 0.4); y <= fy + L * 0.4; y++) for (let x = Math.floor(fx - L * 0.4); x <= fx + L * 0.4; x++) {
          const dx = x + 0.5 - fx, dy = y + 0.5 - fy;
          const a2 = dx * Math.cos(ang) + dy * Math.sin(ang), b = -dx * Math.sin(ang) + dy * Math.cos(ang);
          if (a2 < -1 || (a2 / (L * 0.24)) ** 2 + (b / (L * 0.15)) ** 2 > 1) continue;
          const vv = b / (L * 0.15) * (sd > 0 ? 1 : -1);
          buf.set(x, y, withA(rampPick(F, clamp01(0.62 - vv * 0.25 + a2 / (L * 0.24) * 0.12), x, y), Math.min(255, a + 40)));
        }
      }
    }
  },
  face(c, ph, s, ox, oy, q) {
    const L = c.L * s, H = c.H * s;
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, L * 0.085);
    return {
      eyes: [-1, 1].map((sd, i) => ({ x: ox + sd * L * 0.17, y: oy - H * 0.12, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 })),
      mouth: { x: ox, y: oy - H * 0.12 + R * 1.9, w: Math.max(3, L * 0.12), m: c.mouth, front: true, angle: 0 },
      anchors: { mouth: [ox, oy + H * 0.05], top: [ox, oy - H * 0.55], tail: [ox, oy + H * 0.55], bottom: [ox, oy + H * 0.55] },
    };
  },
};

KINDS.isopod = {
  layers: [['back', 'tail', 12], ['body', 'swim', 8], ['front', 'fin', 8]],
  ext(c) { const L = c.L, H = c.H; return [-L * 0.68, -H * 1.5, L * 0.95, H * 0.5]; },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const L = c.L * s, H = c.H * s;
    const R = c.bodyR;
    const half = L / 2;
    if (part === 'back' || part === 'all') {
      const legs = 7, lr = Math.max(0.7, H * 0.05);
      for (const far of [1, 0]) for (let i = 0; i < legs; i++) {
        const bx = ox - half * 0.75 + (i / (legs - 1)) * half * 1.5 + (far ? H * 0.12 : 0);
        const p2 = ph * TAU + i * 0.9 + far * Math.PI;
        const lift = Math.max(0, Math.sin(p2)) * H * 0.1;
        const kx = bx + Math.cos(p2) * H * 0.1, ky = oy + H * 0.12 - lift;
        const RL = far ? R.map((v, j) => R[Math.max(0, j - 1)]) : R;
        capsule(buf, bx, oy - H * 0.05, kx, ky, lr, lr * 0.8, RL, { light: 0.4 });
        capsule(buf, kx, ky, kx + H * 0.06, oy + H * 0.32 - lift * 0.3, lr * 0.8, lr * 0.4, RL, { light: 0.35 });
      }
    }
    if (part === 'body' || part === 'all') {
      const segs = 8;
      for (let y = Math.floor(oy - H - 1); y <= Math.ceil(oy + 1); y++) for (let x = Math.floor(ox - half - 2); x <= Math.ceil(ox + half + H * 0.3); x++) {
        const dx = x + 0.5 - ox;
        let nx = dx / half;
        const head = nx > 0.82;
        const hh = head ? H * 0.68 * Math.sqrt(Math.max(0, 1 - ((nx - 0.82) / 0.33) ** 2)) : H * Math.pow(Math.max(0, 1 - nx * nx), 0.45);
        const dy = oy - (y + 0.5);
        if (dy < -0.5 || dy > hh) continue;
        const vy = dy / Math.max(1, hh);
        const segT = (nx + 1) / 2 * segs;
        const fs = fract(segT);
        let light = 0.45 + vy * 0.35 - nx * 0.05 + (head ? 0.05 : 0);
        if (!head) {
          if (fs > 0.82) light -= 0.25;
          else if (fs < 0.18) light += 0.15;
          if (dy > hh - 1.3) light += 0.2;
        }
        if (dy < H * 0.12) light -= 0.15;
        let col = rampPick(R, clamp01(light), x, y);
        if (!head && hash2(x >> 1, y >> 1, 5) > 0.93) col = R[3];
        if (vy > 0.55 && vy < 0.8 && nx > -0.6 && nx < 0.5 && bayer(x, y) < 0.35) col = R[4];
        buf.set(x, y, col);
      }
      // uropods (tail fins)
      for (const sd of [0, 1]) capsule(buf, ox - half * 0.92, oy - H * 0.15, ox - half * 1.12 - sd * H * 0.1, oy - H * (0.05 + sd * 0.15), Math.max(1, H * 0.1), Math.max(0.8, H * 0.06), R, { light: 0.45 + sd * 0.1 });
    }
    if (part === 'front' || part === 'all') {
      const hx = ox + half * 1.02, hy = oy - H * 0.35;
      for (const [k, lenM] of [[0, 1], [1, 0.6]]) {
        let px0 = hx, py0 = hy;
        const n = 10;
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const x = hx + t * H * 0.9 * lenM;
          const y = hy - Math.sin(t * 1.6) * H * 0.6 * lenM + Math.sin(ph * TAU + t * 3 + k) * t * H * 0.12 + t * t * H * 0.3 * lenM;
          capsule(buf, px0, py0, x, y, Math.max(0.5, H * 0.04 * (1 - t * 0.6)), Math.max(0.5, H * 0.035 * (1 - t * 0.6)), R, { light: 0.5 });
          px0 = x; py0 = y;
        }
      }
    }
  },
  face(c, ph, s, ox, oy, q) {
    const L = c.L * s, H = c.H * s;
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, H * 0.16);
    return {
      eyes: [{ x: ox + L * 0.47, y: oy - H * 0.38, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: false, main: true, angle: 0 }],
      mouth: { x: ox + L * 0.57, y: oy - H * 0.1, w: Math.max(2, H * 0.18), m: c.mouth, front: false, angle: 0 },
      anchors: { mouth: [ox + L * 0.58, oy - H * 0.1], top: [ox, oy - H - 3], tail: [ox - L * 0.55, oy], bottom: [ox, oy + 3] },
    };
  },
};

KINDS.blob = {
  layers: [['body', 'swim', 8]],
  ext(c) { const L = c.L, H = c.H; return [-L * 0.75, -H * 0.8, L * 0.75, H * 0.95]; },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const L = c.L * s, H = c.H * s;
    const R = c.bodyR;
    if (c.look.blobfish) {
      // gelatinous blobfish: big sagging head, small tapering body, tiny tail, big droopy nose
      const wob = Math.sin(ph * TAU);
      for (let y = Math.floor(oy - H * 0.6); y <= Math.ceil(oy + H * 0.65); y++) for (let x = Math.floor(ox - L * 0.65); x <= Math.ceil(ox + L * 0.6); x++) {
        const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
        const hy = dy - H * 0.04;
        const head = Math.hypot((dx - L * 0.08) / (L * 0.36), hy / (H * (hy > 0 ? 0.5 : 0.42))) < 1 + 0.03 * Math.sin(ph * TAU + dx * 0.25);
        const t = (-dx - L * 0.05) / (L * 0.5);
        const tailB = t > 0 && t < 1 && Math.abs(dy - H * 0.12 * t) < H * 0.3 * (1 - t * 0.78);
        const fin = t > 0.9 && t < 1.22 && Math.abs(dy - H * 0.12) < H * 0.2 * (t - 0.82) * 3;
        if (!head && !tailB && !fin) continue;
        let col = rampPick(R, clamp01(0.6 - dy / H * 0.55 - dx / L * 0.1), x, y);
        if (fin) col = withA(c.finR[(x & 1) ? 3 : 2], 225);
        if (head && Math.hypot((dx + L * 0.02) / (L * 0.14), (dy + H * 0.27) / (H * 0.08)) < 1 && bayer(x, y) < 0.5) col = R[4];
        if (head && dy > H * 0.25 && Math.abs(fract((dx + wob) / Math.max(3, L * 0.08)) - 0.5) < 0.08) col = R[1];
        if (hash2(x >> 1, y >> 1, 3) > 0.95) col = R[3];
        buf.set(x, y, col);
      }
      shadedEllipse(buf, ox + L * 0.41, oy + H * 0.1 + wob * 0.5, L * 0.13, H * 0.21, rp(c, c.look.nose || '#e0909e'), { rim: true });
      return;
    }
    const pts = [];
    for (let y = Math.floor(oy - H * 0.75); y <= Math.ceil(oy + H * 0.9); y++) for (let x = Math.floor(ox - L * 0.72); x <= Math.ceil(ox + L * 0.72); x++) {
      const dx = (x + 0.5 - ox) / (L / 2), dy = (y + 0.5 - oy) / (H / 2);
      const ang = Math.atan2(dy, dx);
      let rr = 1 + 0.09 * Math.sin(ang * 3 + ph * TAU) + 0.06 * Math.sin(ang * 5 - ph * TAU * 2);
      if (dy > 0) rr *= 1 - 0.12 * dy;
      const inside = dx * dx + dy * dy <= rr * rr;
      // drips
      let drip = false;
      for (const [ddx, dl] of [[-0.45, 0.35], [0.3, 0.55]]) {
        const len = dl * (0.8 + 0.2 * Math.sin(ph * TAU + ddx * 5));
        if (Math.abs(dx - ddx) < 0.07 * (1 - (dy - 0.75) / (len + 0.3)) + 0.03 && dy > 0.6 && dy < 0.75 + len) drip = true;
        if (Math.hypot((dx - ddx) * 1.2, dy - 0.8 - len) < 0.1) drip = true;
      }
      if (!inside && !drip) continue;
      let col = rampPick(R, clamp01(0.55 - dy * 0.3 - dx * 0.08), x, y);
      if (drip && !inside) col = R[1];
      if (dx < -0.35 && dx > -0.7 && dy < -0.3 && dy > -0.55 && bayer(x, y) < 0.45) col = R[4];
      if (hash2(x >> 1, y >> 1, 21) > 0.97) col = R[4];
      pts.push(1);
      buf.set(x, y, col);
    }
    // embedded junk
    const J = (u, v) => [ox + u * L / 2, oy + v * H / 2];
    const [cx1, cy1] = J(-0.55, 0.15);
    const cr = Math.max(2, L * 0.06);
    for (let a2 = 0; a2 < TAU; a2 += 0.15) buf.set(Math.round(cx1 + Math.cos(a2) * cr), Math.round(cy1 + Math.sin(a2) * cr * 0.7), pk(c, '#c8d0d8'));
    const [cx2, cy2] = J(0.5, 0.45);
    shadedEllipse(buf, cx2, cy2, Math.max(2, L * 0.07), Math.max(1.5, L * 0.05), rp(c, '#d83a3a'), { fn: (nx, ny) => (Math.hypot(nx, ny) > 0.78 && (Math.floor(Math.atan2(ny, nx) * 6) & 1) ? rp(c, '#d83a3a')[1] : 0) });
    const [cx3, cy3] = J(-0.1, -0.62);
    for (let i = 0; i < Math.max(4, L * 0.16); i++) buf.set(Math.round(cx3 + i - L * 0.08), Math.round(cy3 + (i & 1)), pk(c, '#eef0e8'));
    for (let i = 0; i < 3; i++) buf.line(cx3 - L * 0.03 + i * L * 0.04, cy3 - 2, cx3 - L * 0.03 + i * L * 0.04, cy3 + 3, pk(c, '#eef0e8'));
    void pts;
  },
  face(c, ph, s, ox, oy, q) {
    const L = c.L * s, H = c.H * s;
    if (c.look.blobfish) {
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.5, H * 0.06);
      return {
        eyes: [{ x: ox + L * 0.27, y: oy - H * 0.12, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: true, main: true, angle: 0 }],
        mouth: { x: ox + L * 0.38, y: oy + H * 0.36, w: Math.max(3, L * 0.18), m: c.mouth, front: false, angle: 0 },
        anchors: { mouth: [ox + L * 0.45, oy + H * 0.25], top: [ox, oy - H * 0.55], tail: [ox - L * 0.6, oy], bottom: [ox, oy + H * 0.5] },
      };
    }
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, L * 0.075);
    const ex = ox + L * 0.12, ey = oy - H * 0.14;
    return {
      eyes: [-1, 1].map((sd, i) => ({ x: ex + sd * L * 0.13, y: ey, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 })),
      mouth: { x: ex, y: ey + R * 2.1, w: Math.max(3, L * 0.16), m: c.mouth, front: true, angle: 0 },
      anchors: { mouth: [ex, ey + R * 2.5], top: [ox, oy - H * 0.6], tail: [ox - L * 0.55, oy], bottom: [ox, oy + H * 0.55] },
    };
  },
};

// Starfish: five tapering arms with tubercles, front-facing face (crawler).
KINDS.star = {
  layers: [['body', 'swim', 8]],
  ext(c) { const r = c.L * 0.55; return [-r * 1.12, -r * 1.12, r * 1.12, r * 1.05]; },
  paint(c, part, buf, glow, ox, oy, s, ph) {
    const Rr = c.L * 0.5 * s;
    const R = c.bodyR;
    const D = rp(c, c.look.col?.back || shade(c.bodyHex, -0.3));
    for (let y = Math.floor(oy - Rr * 1.1); y <= Math.ceil(oy + Rr * 1.05); y++) for (let x = Math.floor(ox - Rr * 1.1); x <= Math.ceil(ox + Rr * 1.1); x++) {
      const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
      const d = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx) + Math.PI / 2;
      const arm = Math.pow(Math.abs(Math.cos(th * 2.5)), 1.5);
      const wig = 0.05 * Math.sin(ph * TAU + th * 5);
      const r = Rr * (0.38 + 0.62 * arm + wig);
      if (d > r) continue;
      const edge = d > r - 1.2;
      let col = rampPick(R, clamp01(0.62 - dy / Rr * 0.3 - dx / Rr * 0.12 - (d / r) * 0.15), x, y);
      if (arm > 0.55 && Math.abs(fract(d / Math.max(2.4, Rr * 0.14)) - 0.5) < 0.18 && d > Rr * 0.3 && hash2(x >> 1, y >> 1, 9) > 0.4) col = D[2];
      if (hash2(x, y, 31) > 0.93) col = R[4];
      if (edge) col = R[1];
      buf.set(x, y, col);
    }
  },
  face(c, ph, s, ox, oy) {
    const Rr = c.L * 0.5 * s;
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.6, Rr * 0.12);
    const ey = oy - Rr * 0.04;
    return {
      eyes: [-1, 1].map((sd, i) => ({ x: ox + sd * Rr * 0.16, y: ey, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 })),
      mouth: { x: ox, y: ey + R * 2.2, w: Math.max(3, Rr * 0.2), m: c.mouth, front: true, angle: 0 },
      anchors: { mouth: [ox, ey + R * 2.4], top: [ox, oy - Rr], tail: [ox - Rr * 0.8, oy + Rr * 0.3], bottom: [ox, oy + Rr * 0.8] },
    };
  },
};

KINDS.iconfish = {
  layers: [['back', 'tail', 12], ['body', 'swim', 8], ['front', 'fin', 8]],
  ext(c) { const z = c.L; return [-z * 1.0, -z * 0.68, z * 0.62, z * 0.68]; },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const size = c.L * s, half = size / 2;
    const R = c.bodyR, F = c.finR;
    const posing = q.pose;
    if ((part === 'back' || part === 'all') && !posing) {
      const fl = Math.sin(ph * TAU) * half * 0.18;
      const bx = ox - half + 1;
      for (let y = Math.floor(oy - half); y <= oy + half; y++) for (let x = Math.floor(bx - half * 0.8); x <= bx; x++) {
        const a = bx - x, t = a / (half * 0.75);
        if (t > 1) continue;
        const dy = y + 0.5 - oy - fl * t;
        const outer = half * (0.18 + 0.42 * Math.sqrt(t));
        const inner = half * 0.42 * Math.max(0, (t - 0.55) / 0.45);
        if (Math.abs(dy) > outer || Math.abs(dy) < inner) continue;
        const ray = (Math.floor(Math.atan2(dy, a + 4) * 6) & 1) === 0;
        buf.set(x, y, F[t > 0.8 ? 4 : ray ? 2 : 3]);
      }
    }
    if (part === 'body' || part === 'all') {
      const r = Math.max(2.5, half * 0.32);
      const GL = rp(c, c.look.glyphColor || '#ffffff');
      for (let y = Math.floor(oy - half); y < oy + half; y++) for (let x = Math.floor(ox - half); x < ox + half; x++) {
        const dx = Math.abs(x + 0.5 - ox) - (half - r), dy = Math.abs(y + 0.5 - oy) - (half - r);
        if (dx > 0 && dy > 0 && dx * dx + dy * dy > r * r) continue;
        const t = (y + 0.5 - (oy - half)) / size;
        let col = rampPick(R, clamp01(0.85 - t * 0.55), x, y);
        const edge = Math.max(dx, dy, dx > 0 && dy > 0 ? Math.hypot(dx, dy) - r : -99);
        if (edge > -1.2 && (y + 0.5 > oy)) col = R[1];
        if (t < 0.45 && edge < -1.5 && bayer(x, y) < 0.35 * (1 - t * 2)) col = R[4];
        buf.set(x, y, col);
      }
      // glyph: a fish symbol pretending to be an app
      const gx = ox + half * 0.04, gy = oy - half * 0.04;
      shadedEllipse(buf, gx + half * 0.06, gy, half * 0.42, half * 0.27, GL, { light: 0.75 });
      buf.fillPoly([[gx - half * 0.3, gy], [gx - half * 0.62, gy - half * 0.27], [gx - half * 0.62, gy + half * 0.27]], GL[3]);
      // shortcut arrow badge
      const bs = Math.max(5, Math.round(half * 0.5));
      const bx0 = Math.round(ox - half + 1), by0 = Math.round(oy + half - bs - 1);
      buf.rect(bx0, by0, bs, bs, P('#ffffff'));
      const A = pk(c, '#2a6ad8');
      for (let i = 1; i < bs - 1; i++) buf.set(bx0 + i, by0 + bs - 1 - i, A);
      buf.line(bx0 + bs - 2, by0 + 1, bx0 + bs - 2, by0 + Math.round(bs * 0.55), A);
      buf.line(bx0 + Math.round(bs * 0.45), by0 + 1, bx0 + bs - 2, by0 + 1, A);
      buf.line(bx0, by0 + bs, bx0 + bs - 1, by0 + bs, P('#9aa8c0'));
    }
    if ((part === 'front' || part === 'all') && !posing) {
      const fl = Math.sin(ph * TAU) * 0.5;
      for (const sd of [1]) {
        const fx = ox + half * 0.1, fy = oy + half * 0.95;
        for (let k = 0; k < half * 0.5; k++) {
          const t = k / (half * 0.5);
          const w = (1 - t) * half * 0.22;
          for (let j = -w; j <= w; j++) buf.set(Math.round(fx - k * 0.6 + j * 0.3), Math.round(fy + k * (0.5 + fl * 0.4) * sd + j * 0.2), F[t > 0.7 ? 4 : 3]);
        }
      }
    }
  },
  face(c, ph, s, ox, oy, q) {
    const half = c.L * s / 2;
    if (q.pose) return { eyes: [], mouth: null, anchors: { mouth: [ox + half, oy], top: [ox, oy - half - 3], tail: [ox - half, oy], bottom: [ox, oy + half] } };
    const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, half * 0.13);
    return {
      eyes: [{ x: ox + half * 0.3, y: oy - half * 0.08, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: false, main: true, angle: 0 }],
      mouth: { x: ox + half * 0.5, y: oy + half * 0.08, w: Math.max(2, half * 0.2), m: c.mouth, front: false, angle: 0 },
      anchors: { mouth: [ox + half, oy + 1], top: [ox, oy - half - 3], tail: [ox - half - 5, oy], bottom: [ox, oy + half] },
    };
  },
};

// ---- chain creatures (noodle eel, cable eel, plain eel). The game supplies body points; these paint
// a segment disc and a rotated head. KINDS.chain renders a preview S-curve for the baked API.

function segColor(c, dx, dy, x, y) {
  const d2 = dx * dx + dy * dy;
  const head = c.chain.head;
  let light = 0.55 - dy * 0.35 - dx * 0.12 + Math.sqrt(Math.max(0, 1 - d2)) * 0.15;
  if (head === 'plug' && Math.abs(dy + 0.35) < 0.15) light += 0.35;
  if (head === 'noodle' && Math.abs(dy + 0.4) < 0.18 && bayer(x, y) < 0.6) light += 0.3;
  return rampPick(dy > 0.45 && head === 'eel' ? c.bellyR : c.bodyR, clamp01(light), x, y);
}

function stampSegment(c, buf, cx, cy, r) {
  r = Math.max(1, r);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
    if (dx * dx + dy * dy <= 1) buf.set(x, y, segColor(c, dx, dy, x, y));
  }
}

export function chainSegment(c, r) {
  r = Math.max(1, r);
  const key = 'seg' + Math.round(r * 4);
  if (!c._segs) c._segs = new Map();
  let out = c._segs.get(key);
  if (out) return out;
  const n = Math.ceil(r * 2 + 3);
  const buf = new PixelBuffer(n, n);
  const cc = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5 - cc) / r, dy = (y + 0.5 - cc) / r;
    if (dx * dx + dy * dy > 1) continue;
    buf.set(x, y, segColor(c, dx, dy, x, y));
  }
  out = { canvas: buf.toCanvas(), o: cc };
  c._segs.set(key, out);
  return out;
}

// Paint a chain head at angle into a buffer; returns face geometry relative to its centre.
function paintChainHead(c, buf, glow, cx, cy, ang, s, ph) {
  const r = c.chain.r * s;
  const head = c.chain.head;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const R = c.bodyR;
  const hb = Math.ceil(r * 4.5 + 4);
  for (let y = Math.floor(cy - hb); y <= cy + hb; y++) for (let x = Math.floor(cx - hb); x <= cx + hb; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const lx = (dx * ca + dy * sa) / r, ly = (-dx * sa + dy * ca) / r;
    let col = 0;
    if (head === 'plug') {
      // housing: rounded box from -1.2..1.6 (x), -1.15..1.15 (y); prongs in front
      const hx = lx - 0.2, bxr = Math.max(0, Math.abs(hx) - 1.0), byr = Math.max(0, Math.abs(ly) - 0.85);
      if (Math.hypot(bxr, byr) < 0.35) {
        const H2 = rp(c, c.chain.housing || '#e8e8ec');
        col = rampPick(H2, clamp01(0.62 - ly * 0.3 - (hx < -0.6 ? 0.18 : 0)), x, y);
        if (hx < -0.55 && Math.abs(fract(hx * 3.2) - 0.5) < 0.18) col = H2[1];
        if (hx > 1.2) col = H2[1];
      } else if (lx > 1.5 && lx < 2.6 && (Math.abs(ly - 0.42) < 0.16 || Math.abs(ly + 0.42) < 0.16)) {
        const M = rp(c, '#d8c060');
        col = M[ly < 0 ? 3 : 2];
        if (lx > 2.0 && lx < 2.2) col = M[0];
      }
    } else if (head === 'box') {
      // a cardboard box with the eel peeking out of the front flap
      const bxr = Math.max(0, Math.abs(lx - 0.1) - 1.25), byr = Math.max(0, Math.abs(ly) - 1.0);
      if (Math.hypot(bxr, byr) < 0.18) {
        const B = rp(c, c.chain.box || '#c89a5a');
        col = rampPick(B, clamp01(0.62 - ly * 0.28 - (lx < -0.6 ? 0.12 : 0)), x, y);
        if (Math.abs(ly + 0.15) < 0.16 && lx < 1.1) col = rp(c, '#e8d8b0')[3];
        if (Math.abs(lx - 0.1) < 0.05 && ly < -0.3) col = B[1];
        if (lx > 1.0 && Math.abs(ly - 0.25) < 0.32) col = P('#1a1008');
        if (Math.abs(lx - 1.36) < 0.06 || Math.abs(ly + 1.05) < 0.06) col = B[1];
      }
    } else if (head === 'noodle') {
      const d = Math.hypot(lx / 1.35, ly);
      if (d < 1) col = rampPick(R, clamp01(0.58 - ly * 0.3 - lx * 0.05 + (Math.abs(ly + 0.45) < 0.15 ? 0.25 : 0)), x, y);
      // naruto slice hat
      const nh = Math.hypot((lx + 0.1) / 0.75, (ly + 1.05) / 0.35);
      if (nh < 1) {
        const sp = fract(Math.hypot(lx + 0.1, (ly + 1.05) * 2.2) * 2.6 - Math.atan2(ly + 1.05, lx + 0.1) / TAU);
        col = sp < 0.3 ? pk(c, '#ff7aa8') : pk(c, '#fff8f0');
        if (nh > 0.82) col = pk(c, '#e8d8d0');
      }
    } else {
      const d = Math.hypot((lx - 0.2) / 1.7, ly / (lx > 0.2 ? 0.95 : 1.05));
      if (d < 1) {
        col = rampPick(ly > 0.35 ? c.bellyR : R, clamp01(0.55 - ly * 0.35 + lx * 0.04), x, y);
        if (Math.abs(lx + 0.5 - ly * ly * 0.3) < 0.08 && Math.abs(ly) < 0.7) col = R[1];
      }
      if (ly < -0.85 && ly > -1.3 && lx < 0.4 && lx > -1.4 && ly > -0.95 - 0.25 * Math.sin((lx + 1.4) * 2.2)) col = c.finR[3];
    }
    if (col) buf.set(x, y, col);
  }
  const toC = (lx, ly) => [cx + (lx * ca - ly * sa) * r, cy + (lx * sa + ly * ca) * r];
  const er = Math.max(1.6, r * (head === 'noodle' ? 0.32 : head === 'plug' ? 0.34 : 0.3));
  const eyes = head === 'noodle'
    ? [[0.35, -0.2, 0], [0.85, -0.2, 1]]
    : head === 'plug' ? [[0.3, -0.35, 0], [0.95, -0.35, 1]] : head === 'box' ? [[1.12, 0.12, 0], [1.42, 0.12, 1]] : [[0.75, -0.3, 0]];
  const mouthAt = head === 'noodle' ? [1.05, 0.38] : head === 'plug' ? [1.25, 0.4] : head === 'box' ? [1.5, 0.55] : [1.85, 0.3];
  return {
    eyes: eyes.map(([lx, ly, i]) => { const [x, y] = toC(lx, ly); return { x, y, r: er, e: c.eyes[0], idx: i, mirror: false, cheek: i === 0, main: i === eyes.length - 1, angle: ang }; }),
    mouth: { x: toC(...mouthAt)[0], y: toC(...mouthAt)[1], w: Math.max(2.5, r * 0.7), m: c.mouth, front: false, angle: ang },
    nose: toC(head === 'plug' ? 2.6 : head === 'box' ? 1.5 : 1.9, 0),
  };
}

export function chainHeadSprite(c, ang, s, ph = 0) {
  const r = c.chain.r * s;
  const hb = Math.ceil(r * 4.5 + 6);
  const buf = new PixelBuffer(hb * 2, hb * 2);
  const face = paintChainHead(c, buf, null, hb, hb, ang, s, ph);
  buf.outline(outlineFnFor(c));
  return { canvas: buf.toCanvas(), o: hb, face };
}

export function defaultChainPoints(c, s = 1, ph = 0, x0 = 0, y0 = 0, facing = 1) {
  const n = c.chain.segs, r = c.chain.r * s;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({ x: x0 - facing * i * r * 1.15, y: y0 + Math.sin(ph * TAU - t * 5) * r * 1.6 * Math.min(1, t * 2.5) });
  }
  return pts;
}

export const chainRadius = (c, i, n, s = 1) => {
  const r = c.chain.r * s;
  const t = i / Math.max(1, n - 1);
  if (c.chain.head === 'plug') return Math.max(1, r * 0.42);
  if (c.chain.head === 'noodle') return Math.max(1, r * (0.62 - 0.15 * t));
  return Math.max(1, r * (0.95 - 0.55 * t * t));
};

KINDS.chain = {
  layers: [['body', 'swim', 8]],
  ext(c) { const n = c.chain.segs, r = c.chain.r; return [-n * r * 1.2 - r * 2, -r * 4.5, r * 4.5, r * 4.5]; },
  paint(c, part, buf, glow, ox, oy, s, ph, q) {
    const pts = defaultChainPoints(c, s, ph, ox, oy, 1);
    const n = pts.length;
    for (let i = n - 1; i >= 1; i--) {
      const a = pts[i], b = pts[i - 1];
      const ra = chainRadius(c, i, n, s), rb = chainRadius(c, i - 1, n, s);
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, Math.min(ra, rb) * 0.6)));
      for (let k = 0; k < steps; k++) {
        const u = k / steps;
        stampSegment(c, buf, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, ra + (rb - ra) * u);
      }
    }
    const ang = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
    q._chainFace = paintChainHead(c, buf, glow, pts[0].x, pts[0].y, ang, s, ph);
  },
  face(c, ph, s, ox, oy, q) {
    const pts = defaultChainPoints(c, s, ph, ox, oy, 1);
    const ang = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
    const scratch = new PixelBuffer(1, 1);
    const f = paintChainHead(c, scratch, null, pts[0].x, pts[0].y, ang, s, ph);
    const last = pts[pts.length - 1];
    return { eyes: f.eyes, mouth: f.mouth, anchors: { mouth: f.nose, top: [pts[0].x, pts[0].y - c.chain.r * s * 2], tail: [last.x, last.y], bottom: [pts[0].x, pts[0].y + c.chain.r * s] } };
  },
};

// ---------------------------------------------------------------------------
// Public raster API.

function finishBuf(c, buf, glow, sil, noOutline = false) {
  if (noOutline && !sil) return;
  if (sil) {
    for (let i = 0; i < buf.data.length; i++) if (buf.data[i] >>> 24) buf.data[i] = 0xff332010 >>> 0;
    buf.outline(() => 0xff221508 >>> 0);
    return;
  }
  const neon = c.variant?.mutation === 'neon' && glow;
  const before = neon ? buf.data.slice() : null;
  buf.outline(outlineFnFor(c));
  if (neon) {
    const rim = P(shade(c.bodyHex, 0.5));
    for (let i = 0; i < buf.data.length; i++) if (!before[i] && buf.data[i]) glow.data[i] = rim;
  }
}

// Raw (voxel mode) crop: packed pixel arrays instead of canvases.
function rawOut(buf, glow) {
  const { w, h, data } = buf;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[y * w + x] >>> 24 || (glow && glow.data[y * w + x])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { data: null, glow: null, w: 0, h: 0, x: 0, y: 0 };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const d = new Uint32Array(cw * ch);
  const g = glow ? new Uint32Array(cw * ch) : null;
  for (let y = 0; y < ch; y++) {
    const so = (y + y0) * w + x0;
    d.set(data.subarray(so, so + cw), y * cw);
    if (g) g.set(glow.data.subarray(so, so + cw), y * cw);
  }
  return { data: d, glow: g, w: cw, h: ch, x: x0, y: y0 };
}

// Crop transparent margins; returns canvases plus the crop offset inside the source buffer.
function cropOut(buf, glow) {
  const { w, h, data } = buf;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[y * w + x] >>> 24 || (glow && glow.data[y * w + x])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { canvas: null, glowCanvas: null, x: 0, y: 0 };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  if (cw === w && ch === h) return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, x: 0, y: 0 };
  const nb = new PixelBuffer(cw, ch);
  const ng = glow ? new PixelBuffer(cw, ch) : null;
  let anyGlow = false;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    nb.data[y * cw + x] = data[(y + y0) * w + x + x0];
    if (ng) { const g = glow.data[(y + y0) * w + x + x0]; ng.data[y * cw + x] = g; if (g) anyGlow = true; }
  }
  return { canvas: nb.toCanvas(), glowCanvas: ng && anyGlow ? ng.toCanvas() : null, x: x0, y: y0 };
}

export const isKind = (c) => !!KINDS[c.kind];

// Layer list for the rig: [{id, phase: 'tail'|'fin'|'swim', frames}] in back-to-front order.
export function rigLayers(c) {
  if (c._layers) return c._layers;
  const K = KINDS[c.kind];
  let out;
  if (K) out = K.layers.map(([id, phase, frames]) => ({ id, phase, frames }));
  else {
    out = [];
    if (c.tail.type !== 'none') out.push({ id: 'tail', phase: 'tail', frames: 12 });
    if (c.fins.length) out.push({ id: 'back', phase: 'fin', frames: 8 });
    out.push({ id: 'body', phase: 'swim', frames: 8 });
    if (c.pectoral) out.push({ id: 'front', phase: 'fin', frames: 8 });
  }
  c._layers = out;
  return out;
}

/**
 * Shared bucket geometry for the rig. q: {sw (swim phase), angle, scale, inflate, still, pose}.
 * Returns {w, h, ox, oy, eyes, mouth, anchors, offsets} in canvas coords of the bucket.
 */
export function rigGeom(c, q) {
  const s = q.scale || 1;
  const K = KINDS[c.kind];
  if (K) {
    const B = boundsFor(K.ext(c), 0, s);
    const f = K.face(c, q.sw || 0, s, B.ox, B.oy, q);
    return { w: B.w, h: B.h, ox: B.ox, oy: B.oy, eyes: f.eyes, mouth: f.mouth, anchors: f.anchors, offsets: null };
  }
  const G = geomOf(c, q.inflate || 0);
  const B = boundsFor(genericExtent(c, G), q.angle || 0, s);
  const f = genericFace(c, G, q.sw || 0, q.angle || 0, s, B.ox, B.oy, !!q.still);
  return { w: B.w, h: B.h, ox: B.ox, oy: B.oy, eyes: f.eyes, mouth: f.mouth, anchors: f.anchors, offsets: f.offsets };
}

/**
 * Rasterise one rig layer. q: {ph (this layer's phase), angle, scale, inflate, still, pose}.
 * Returns {canvas, glowCanvas, x, y}: draw at (bucketX - ox + x, bucketY - oy + y). canvas may be null.
 */
export function rasterLayer(c, layer, q) {
  const s = q.scale || 1;
  const K = KINDS[c.kind];
  if (K) {
    const B = boundsFor(K.ext(c), 0, s);
    const buf = new PixelBuffer(B.w, B.h);
    const glow = c.glow ? new PixelBuffer(B.w, B.h) : null;
    K.paint(c, layer, buf, glow, B.ox, B.oy, s, q.ph || 0, q);
    if (VOXM) return rawOut(buf, glow);
    finishBuf(c, buf, glow, false);
    return cropOut(buf, glow);
  }
  const angle = q.angle || 0;
  const G = geomOf(c, q.inflate || 0);
  const ext = genericExtent(c, G);
  const B = boundsFor(ext, angle, s);
  const rect = rectFor(layerBox(c, G, layer, ext), angle, s, B.ox, B.oy, B.w, B.h);
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  if (w <= 0 || h <= 0) return { canvas: null, glowCanvas: null, x: 0, y: 0 };
  const buf = new PixelBuffer(w, h);
  const glow = c.glow && layer === 'body' ? new PixelBuffer(w, h) : null;
  const ph = q.ph || 0;
  const prm = { still: q.still, inflate: q.inflate, sw: layer === 'body' ? ph : 0, tp: ph, fp: ph, raise: q.raise || 0 };
  paintGeneric(c, buf, glow, rect.x0, rect.y0, B.ox, B.oy, angle, s, layer, prm, G, rect);
  if (VOXM) {
    const raw = rawOut(buf, glow);
    raw.x += rect.x0;
    raw.y += rect.y0;
    return raw;
  }
  finishBuf(c, buf, glow, false, layer === 'front');
  const out = cropOut(buf, glow);
  out.x += rect.x0;
  out.y += rect.y0;
  return out;
}

// Baked whole-creature sprite (old frame() API).
export function rasterFish(c, p = {}) {
  const s = p.scale || 1, angle = p.angle || 0, phase = p.phase || 0;
  const K = KINDS[c.kind];
  const f = bakedFace({ ...p, rest: c.mouth?.rest || 0 });
  const sil = !!p.silhouette;
  let B, buf, glow, face;
  if (K) {
    B = boundsFor(K.ext(c), 0, s);
    buf = new PixelBuffer(B.w, B.h);
    glow = c.glow ? new PixelBuffer(B.w, B.h) : null;
    const q = { mouth: p.mouth ? 1 : 0, pose: p.expr === 'pose', squash: p.squash || 0, sw: phase };
    K.paint(c, 'all', buf, glow, B.ox, B.oy, s, phase, q);
    face = K.face(c, phase, s, B.ox, B.oy, q);
  } else {
    const G = geomOf(c, p.inflate || 0);
    B = boundsFor(genericExtent(c, G), angle, s);
    buf = new PixelBuffer(B.w, B.h);
    glow = c.glow ? new PixelBuffer(B.w, B.h) : null;
    paintGeneric(c, buf, glow, 0, 0, B.ox, B.oy, angle, s, 'all', { sw: phase, tp: phase, fp: phase, still: p.still, inflate: p.inflate, raise: p.raise || 0 }, G, { x0: 0, y0: 0, x1: B.w, y1: B.h });
    face = genericFace(c, G, phase, angle, s, B.ox, B.oy, !!p.still);
  }
  if (!sil) paintFaceInto(buf, glow, { ...face, c }, f);
  finishBuf(c, buf, glow, sil);
  const anchors = { ...face.anchors, eyes: face.eyes.map((e) => ({ x: e.x, y: e.y, r: e.r, type: e.e.type })) };
  if (c.variant?.shiny) anchors.shiny = true;
  return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, ox: B.ox, oy: B.oy, anchors, w: B.w, h: B.h };
}
