// Realistic voxel creatures (phase 4): anatomy specs (src/fish/anatomy.js) become voxel models for the
// voxelfish.js ray-caster. Every model is built in "look px" (lp, the species' body length L = look.body.len)
// and sampled at a resolution r (voxels per lp) chosen by the renderer from the on-screen size.
//
// Body plans
//  - 'fish' (bilateral column model): the side view is sampled into 2D maps (body mask, half-thickness T,
//    albedo, role, glow) from an analytic anatomy: dorsal / ventral contours, a width profile and a
//    superellipse cross-section, a rounded snout, optional bill and cephalofoil. Albedo = countershading +
//    natural patterns + anatomy marks (operculum and preopercle edges, lateral line, gape line, nostril,
//    staggered scale rows, shark gill slits). Unpaired fins (dorsals, adipose, finlets, anal, caudal) are
//    translucent membranes with opaque rays in the centre plane (sharks: thick fleshy fins). Per swim frame
//    the spine bends along a travelling wave (arc-length compressed), paired fins (pectorals, pelvics) are
//    stamped in 3D and flap, barbels sway, and natural eyes (dark pupil, coloured iris ring, catchlight)
//    sit flush in both flanks. Flatfish and rays use the same model rolled toward the camera (look.flat).
//  - 'solid': crabs, jellyfish, octopus, squid, starfish, isopods and the Wakka chomper are unions of
//    voxelised primitives (ellipsoids, capsules, shells) with per-frame animation.
// The output grids match the voxelfish.js grid format (data / zmin / zmax / palette indices).

import { clamp, clamp01, lerp, smoothstep, fbm2, noise2, hash2 } from '../core/math.js';

export const R_BODY = 0, R_FIN = 1, R_EYE = 2, R_MOUTH = 3, R_THIN = 4, R_LIMB = 5, R_SPEC = 6, R_GLASS = 7, R_PUPIL = 8, R_CHROME = 9;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
export const SWIM_FRAMES = 6;

// ------------------------------------------------------------------ colour helpers (packed ABGR)

export function hexRGB(h) {
  if (Array.isArray(h)) return h;
  const n = parseInt(String(h).slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const cl8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const packRGB = (c, a = 255) => (((a & 255) << 24) | (cl8(c[2]) << 16) | (cl8(c[1]) << 8) | cl8(c[0])) >>> 0;
const mix3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
const tone3 = (o, k) => {
  // k > 0 lighten toward warm white, k < 0 darken toward cool deep blue (hue-shifted like the ramps)
  if (k >= 0) { o[0] += (255 - o[0]) * k; o[1] += (252 - o[1]) * k; o[2] += (240 - o[2]) * k; }
  else { const d = -k; o[0] += (o[0] * 0.25 + 8 - o[0]) * d; o[1] += (o[1] * 0.3 + 12 - o[1]) * d; o[2] += (o[2] * 0.45 + 34 - o[2]) * d; }
  return o;
};
const lum3 = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

// ------------------------------------------------------------------ curves

// Cubic Hermite through [[u, v], ...] (Catmull-Rom tangents); clamped outside the knots.
export function knotFn(pts) {
  const n = pts.length;
  if (n === 1) return () => pts[0][1];
  return (u) => {
    if (u <= pts[0][0]) return pts[0][1];
    if (u >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (i < n - 2 && u > pts[i + 1][0]) i++;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const h = p2[0] - p1[0];
    const t = (u - p1[0]) / h;
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * h;
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}

// Named fin outlines: height fraction along the fin base (t 0 front .. 1 back).
const FIN_SHAPES = {
  tri: [[0, 0.35], [0.18, 1], [0.55, 0.62], [1, 0.22]],
  round: [[0, 0.3], [0.25, 0.86], [0.55, 1], [0.85, 0.82], [1, 0.32]],
  long: [[0, 0.4], [0.1, 0.92], [0.5, 1], [0.9, 0.92], [1, 0.45]],
  sail: [[0, 0.55], [0.07, 1], [0.25, 0.88], [0.55, 0.5], [1, 0.18]],
  sickle: [[0, 0.45], [0.14, 1], [0.4, 0.38], [1, 0.12]],
  spiny: [[0, 0.45], [0.18, 1], [0.6, 0.85], [1, 0.45]],
  trail: [[0, 0.3], [0.35, 0.7], [0.8, 1], [1, 0.75]],
  low: [[0, 0.5], [0.2, 1], [0.8, 1], [1, 0.5]],
  rise: [[0, 0.25], [0.6, 0.85], [1, 1]],
  fall: [[0, 1], [0.4, 0.8], [1, 0.3]],
};
function finHeightFn(f) {
  if (Array.isArray(f.shape)) return knotFn(f.shape);
  return knotFn(FIN_SHAPES[f.shape || 'tri'] || FIN_SHAPES.tri);
}

// ------------------------------------------------------------------ body profile

// Profile parameters (L units, y up, u 0 = snout tip .. 1 = caudal peduncle): D max depth, up share of the
// depth above the axis, at / atB u of the deepest point (top / bottom), ped peduncle depth (fraction of D),
// pc peduncle centre, tip snout tip height, fore / chin snout front exponents (1 = straight wedge, >1 bulging,
// <1 dished), back / backB rear taper exponents, hump dorsal hump, sag belly sag. Or knots top/bot.
function profileOf(B, infl) {
  if (B.top && B.bot && !infl) return { top: knotFn(B.top), bot: knotFn(B.bot) };
  let D = B.D ?? 0.24, up = B.up ?? 0.54, at = B.at ?? 0.36, atB = B.atB ?? (B.at ?? 0.36) + 0.04;
  let ped = B.ped ?? 0.3, pc = B.pc ?? 0, tip = B.tip ?? 0, fore = B.fore ?? 1.8, chin = B.chin ?? 1.8;
  let back = B.back ?? 1, backB = B.backB ?? back, hump = B.hump ?? 0, sag = B.sag ?? 0;
  if (B.top && B.bot) {
    // knot profiles inflate around their own shape
    const t0 = knotFn(B.top), b0 = knotFn(B.bot);
    const R = 0.44 * infl;
    return {
      top: (u) => lerp(t0(u), Math.max(t0(u), R * Math.sqrt(Math.max(0, 1 - ((u - 0.45) / 0.55) ** 2)) + 0.02), infl),
      bot: (u) => lerp(b0(u), Math.min(b0(u), -R * Math.sqrt(Math.max(0, 1 - ((u - 0.45) / 0.55) ** 2)) - 0.02), infl),
    };
  }
  if (infl > 0) {
    // pufferfish: the body balloons into a sphere (the tail stays small)
    D = lerp(D, 0.86, infl); up = lerp(up, 0.5, infl); at = lerp(at, 0.46, infl); atB = lerp(atB, 0.48, infl);
    ped = lerp(ped, 0.1, infl); fore = lerp(fore, 2.6, infl); chin = lerp(chin, 2.6, infl); back = lerp(back, 0.7, infl); backB = back;
    tip = lerp(tip, 0, infl); hump *= 1 - infl; sag *= 1 - infl;
  }
  const Dt = D * up, Db = D * (1 - up);
  const pt = pc + D * ped * 0.5, pb = pc - D * ped * 0.5;
  const topF = (u) => {
    let y;
    if (u < at) { const s = u / at; y = tip + (Dt - tip) * (1 - Math.pow(1 - s, fore)); }
    else { const s = (u - at) / (1 - at); y = pt + (Dt - pt) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * s), back); }
    return y + hump * D * Math.sin(Math.PI * clamp01((u - 0.05) / 0.75));
  };
  const botF = (u) => {
    let y;
    if (u < atB) { const s = u / atB; y = tip - (Db + tip) * (1 - Math.pow(1 - s, chin)); }
    else { const s = (u - atB) / (1 - atB); y = pb - (Db + pb) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * s), backB); }
    return y - sag * D * Math.sin(Math.PI * clamp01((u - 0.1) / 0.75));
  };
  return { top: topF, bot: botF };
}

function widthOf(B, infl) {
  let W = B.W ?? 0.075, at = B.atW ?? (B.at ?? 0.36) - 0.04, wt = B.wTip ?? W * 0.25, pw = B.pw ?? W * 0.32, e = B.wFore ?? 1.6;
  let f;
  if (B.wid) f = knotFn(B.wid);
  else f = (u) => (u < at ? wt + (W - wt) * (1 - Math.pow(1 - u / at, e)) : pw + (W - pw) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * (u - at) / (1 - at)), B.wBack ?? 0.9));
  if (!infl) return f;
  return (u) => lerp(f(u), Math.max(f(u), 0.42 * Math.sqrt(Math.max(0, 1 - ((u - 0.46) / 0.56) ** 2))), infl);
}

// ------------------------------------------------------------------ model (lp units)

// Resolved creature model (cached per compiled creature and inflate step).
export function fishModel(c, infl = 0) {
  const key = Math.round(infl * 12);
  if (!c._rm) c._rm = new Map();
  let M = c._rm.get(key);
  if (M) return M;
  const S = c.real;
  const L = c.L;
  const B = S.body || {};
  const P = profileOf(B, infl);
  const wid = widthOf(B, infl);
  const nose = (B.nose ?? 0.03) * (1 - infl * 0.5);
  const xN = L / 2;
  // nose rounding: half height about the centre line shrinks toward the tip like a circular cap
  const yc0 = (u) => (P.top(u) + P.bot(u)) / 2;
  const topL0 = (u) => {
    if (u < nose) { const k = Math.sqrt(Math.max(0, 1 - (1 - u / nose) ** 2)); const c0 = yc0(u); return (c0 + (P.top(u) - c0) * k) * L; }
    return P.top(u) * L;
  };
  const botL0 = (u) => {
    if (u < nose) { const k = Math.sqrt(Math.max(0, 1 - (1 - u / nose) ** 2)); const c0 = yc0(u); return (c0 + (P.bot(u) - c0) * k) * L; }
    return P.bot(u) * L;
  };
  // bake the contours into lookup tables (the layout and fin sampling call them a lot)
  const NT = 1024, tT = new Float32Array(NT + 2), tB = new Float32Array(NT + 2);
  for (let i = 0; i <= NT + 1; i++) { const u = Math.min(1, i / NT); tT[i] = topL0(u); tB[i] = botL0(u); }
  const topL = (u) => { if (u <= 0) return tT[0]; if (u >= 1) return tT[NT]; const f = u * NT, i = f | 0; return tT[i] + (tT[i + 1] - tT[i]) * (f - i); };
  const botL = (u) => { if (u <= 0) return tB[0]; if (u >= 1) return tB[NT]; const f = u * NT, i = f | 0; return tB[i] + (tB[i + 1] - tB[i]) * (f - i); };
  const tail = S.tail && S.tail.type !== 'none' ? { len: 0.22, spread: 0.18, fork: 0.3, rays: 14, type: 'fork', ...S.tail } : null;
  if (tail && infl) { tail.len *= 1 - 0.25 * infl; tail.spread *= 1 - 0.2 * infl; }
  const bill = S.bill ? { len: 0.3, h: 0.025, w: 0.02, y: 0, ...S.bill } : null;
  const ceph = S.ceph || null;
  // extents (lp)
  let xmax = xN + (bill ? bill.len * L : 0) + 1, xmin = -L / 2 - (tail ? tail.len * L * (tail.type === 'whip' ? 1.02 : 1.08) : 0) - 1;
  if (S.flukes) xmin = Math.min(xmin, -L / 2 - S.flukes.len * L - 2);
  let ymax = -1e9, ymin = 1e9;
  for (let i = 0; i <= 40; i++) { const u = i / 40; ymax = Math.max(ymax, topL(u)); ymin = Math.min(ymin, botL(u)); }
  for (const f of S.fins || []) {
    const H = (f.h ?? 0.1) * L * (f.spiny ? 1.08 : 1) * (1 - 0.3 * infl);
    if (f.at === 'bot') ymin = Math.min(ymin, botL((f.from + f.to) / 2) - H * 1.05);
    else ymax = Math.max(ymax, topL((f.from + f.to) / 2) + H * 1.05);
    if (f.from < 0.05) xmax = Math.max(xmax, xN + 2);
  }
  if (tail && tail.type !== 'whip') {
    const pt = P.top(1) * L, pb = P.bot(1) * L;
    ymax = Math.max(ymax, (pt + pb) / 2 + tail.spread * L * (1 + Math.max(0, tail.lobe || 0)) + 1);
    ymin = Math.min(ymin, (pt + pb) / 2 - tail.spread * L * (1 + Math.max(0, -(tail.lobe || 0))) - 1);
  }
  // paired fins and appendages may hang below / reach out
  if (S.pel) ymin = Math.min(ymin, botL(S.pel.u) - (S.pel.len || 0.1) * L * 0.9);
  if (S.pec) { const pl = (S.pec.len || 0.15) * L; ymin = Math.min(ymin, botL(S.pec.u) - pl * 0.5); xmin = Math.min(xmin, xN - S.pec.u * L - pl - 2); ymax = Math.max(ymax, topL(S.pec.u) + (S.pec.up ? pl : 0)); }
  for (const b of S.barbels || []) { ymin = Math.min(ymin, botL(b.u) - b.len * L * 0.9 - 2); ymax = Math.max(ymax, topL(b.u) + (b.up ? b.len * L : 0) + 1); xmax = Math.max(xmax, xN + (b.fwd ? b.len * L : 0) + 2); }
  if (S.lure) { ymax = Math.max(ymax, topL(S.lure.u) + S.lure.len * L * 1.1 + S.lure.bulb * L + 2); xmax = Math.max(xmax, xN + S.lure.len * L * 0.8 + 2); }
  const spK = S.spines ? Math.max(infl, S.spines.always ? 0.6 : 0) : 0;
  if (spK > 0) { const sl = S.spines.len * L * spK; ymax += sl; ymin -= sl; xmax += sl; }
  ymax += 1; ymin -= 1;
  const tW = new Float32Array(NT + 2);
  for (let i = 0; i <= NT + 1; i++) tW[i] = wid(Math.min(1, i / NT));
  const widF = (u) => { if (u <= 0) return tW[0]; if (u >= 1) return tW[NT]; const f = u * NT, i = f | 0; return tW[i] + (tW[i + 1] - tW[i]) * (f - i); };
  M = { S, L, xN, P, topL, botL, wid: widF, nose, tail, bill, ceph, infl, xmin, xmax, ymin, ymax, flat: S.flat || null };
  M.uOf = (X) => (xN - X) / L;
  // fin bounding boxes (lp), so the layout only tests the fins that can cover a cell
  M.finBB = (S.fins || []).map((f) => {
    const H = (f.h ?? 0.1) * L * 1.1 + 1;
    const rake = f.rake ?? 0.4;
    let y0 = 1e9, y1 = -1e9;
    for (let k = 0; k <= 8; k++) { const u = f.from + (f.to - f.from) * (k / 8); const y = f.at === 'bot' ? botL(u) : topL(u); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0: xN - f.to * L - rake * H - 1, x1: xN - f.from * L + 1, y0: f.at === 'bot' ? y0 - H : y0 - 1, y1: f.at === 'bot' ? y1 + 1 : y1 + H };
  });
  c._rm.set(key, M);
  return M;
}

// ------------------------------------------------------------------ albedo painting

const SCR = [0, 0, 0], SCR2 = [0, 0, 0];

// spots on a jittered grid: returns the spot strength (0 none, 1 core) at (a, b) in L units
function spotAt(a, b, size, density, seed, ar = 1) {
  const cs = size * 2.2;
  const ia = Math.floor(a / cs), ib = Math.floor(b / cs);
  let best = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const ca = ia + i, cb = ib + j;
    if (hash2(ca, cb, seed) > density) continue;
    const ja = (ca + 0.2 + 0.6 * hash2(ca, cb, seed + 7)) * cs, jb = (cb + 0.2 + 0.6 * hash2(ca, cb, seed + 13)) * cs;
    const rr = size * (0.55 + 0.5 * hash2(ca, cb, seed + 21));
    const d = Math.hypot((a - ja) * ar, b - jb) / rr;
    if (d < 1) best = Math.max(best, 1 - d);
  }
  return best;
}

// Apply one pattern layer to colour o (rgb) at body coordinates. q: {u, v, x (L units, forward), y (L
// units, up), side (+1 / -1)}. Returns true when the layer marks the pixel as glowing.
function applyPattern(p, o, q, pc) {
  const { u, v, y } = q;
  if (p.umin != null && u < p.umin) return false;
  if (p.umax != null && u > p.umax) return false;
  if (p.vmin != null && v < p.vmin) return false;
  if (p.vmax != null && v > p.vmax) return false;
  const col = pc.col;
  let a = 0;
  switch (p.type) {
    case 'spots': {
      // features smaller than about a voxel would only read as noise at this resolution: grow them a little
      const sz = Math.max(p.size ?? 0.02, 1.1 / q.res);
      const s = spotAt(u, y, sz, p.density ?? 0.5, p.seed ?? 1, p.ar ?? 1);
      if (s > 0) a = s > (p.soft ?? 0) ? 1 : 0;
      if (a && p.ring && s < 0.38) { mix3(o, o, hexRGB(p.ring), p.amt ?? 1); return false; }
      break;
    }
    case 'ocelli': {
      // eye spots: dark core ringed by a pale ring
      const s = spotAt(u, y, Math.max(p.size ?? 0.03, 2.2 / q.res), p.density ?? 0.4, p.seed ?? 3);
      if (s > 0.42) a = 1;
      else if (s > 0.12) { mix3(o, o, pc.ring, p.amt ?? 1); return false; }
      break;
    }
    case 'bars': {
      const w = p.width ?? 0.05;
      for (const at of p.at) {
        const d = Math.abs(u - at - (p.slant ?? 0) * (v - 0.5) - (p.wavy ?? 0) * Math.sin(v * 9 + at * 20));
        if (d < w / 2) { a = 1; if (p.edge && d > w / 2 - (p.edgeW ?? 0.012)) { mix3(o, o, pc.edge, 1); return false; } break; }
      }
      break;
    }
    case 'stripes': {
      const w = p.width ?? 0.08;
      for (const at of p.at) {
        const d = Math.abs(v - at - (p.slope ?? 0) * (u - 0.5) - (p.wavy ?? 0) * Math.sin(u * (p.freq ?? 18)));
        if (d < w / 2) { a = 1; if (p.edge && d > w / 2 - (p.edgeW ?? 0.03)) { mix3(o, o, pc.edge, 1); return false; } break; }
      }
      if (a && p.fade) a = smoothstep(p.fade[0], p.fade[1], u) * (1 - smoothstep(p.fade[2] ?? 2, p.fade[3] ?? 3, u));
      break;
    }
    case 'band': {
      // lateral band following the body axis, soft edges
      const d = Math.abs(v - (p.at ?? 0.5)) / ((p.width ?? 0.2) / 2);
      a = d < 1 ? (p.hard ? 1 : clamp01((1 - d) * 2.2)) : 0;
      if (p.fade) a *= smoothstep(p.fade[0], p.fade[1], u);
      break;
    }
    case 'mottle': {
      const n = fbm2(u * (p.scale ?? 14) + 3.1, y * (p.scale ?? 14) * (p.ar ?? 1), 3, p.seed ?? 5);
      a = clamp01((n - (p.thresh ?? 0.52)) / (p.soft ?? 0.06));
      a *= p.amt ?? 1;
      break;
    }
    case 'patches': {
      const n = fbm2(u * (p.scale ?? 6) + 7.7, y * (p.scale ?? 6), 3, p.seed ?? 9);
      a = n > (p.thresh ?? 0.55) ? 1 : 0;
      break;
    }
    case 'reticulate': {
      const n = fbm2(u * (p.scale ?? 16), y * (p.scale ?? 16), 2, p.seed ?? 4);
      a = Math.abs(n - 0.5) < (p.width ?? 0.035) ? 1 : 0;
      break;
    }
    case 'lines': {
      // wavy oblique lines (mackerel tiger bars, wrasse face lines)
      const f = p.freq ?? 22, w = p.width ?? 0.3;
      const ph = u * f + y * f * (p.slope ?? 1.2) + Math.sin(y * (p.wfreq ?? 60) + u * 7) * (p.wavy ?? 0.4);
      a = (ph - Math.floor(ph)) < w ? 1 : 0;
      break;
    }
    case 'grad': {
      // colour gradient along the body (u0 -> u1)
      a = smoothstep(p.u0 ?? 0, p.u1 ?? 1, u) * (p.amt ?? 1);
      break;
    }
    case 'vgrad': {
      a = smoothstep(p.v0 ?? 0, p.v1 ?? 1, v) * (p.amt ?? 1);
      break;
    }
    case 'blotch': {
      const d = Math.hypot((u - p.u) / (p.rx ?? 0.04), (v - p.v) / (p.ry ?? 0.12));
      a = d < 1 ? 1 : 0;
      if (a && p.ring && d > 1 - (p.ringW ?? 0.3)) { mix3(o, o, pc.ring, 1); return false; }
      break;
    }
    case 'saddles': {
      const w = p.width ?? 0.06;
      for (const at of p.at) if (Math.abs(u - at) < w / 2 * (1 - (1 - v) * 0.6) && v > (p.from ?? 0.55)) { a = 1; break; }
      break;
    }
    case 'speckle': {
      const h = hash2(Math.floor(q.gx / (p.cell ?? 1)), Math.floor(q.gy / (p.cell ?? 1)), p.seed ?? 11);
      a = h < (p.density ?? 0.06) ? 1 : 0;
      break;
    }
    case 'photophores': {
      // rows of glowing dots along the belly (lanternfish, hatchetfish, dragonfish)
      for (const r of p.rows) {
        if (u < r.u0 || u > r.u1) continue;
        const k = (u - r.u0) / Math.max(0.01, r.u1 - r.u0) * r.n;
        const du = (k - Math.round(k)) * (r.u1 - r.u0) / r.n;
        const vv = r.v + (r.dv ?? 0) * (u - r.u0) / Math.max(0.01, r.u1 - r.u0);
        if (Math.hypot(du * 1.0, (v - vv) * (q.h || 0.2)) < (p.size ?? 0.009)) { a = 1; break; }
      }
      break;
    }
    case 'scalenet': {
      // bold scale outlines (pineapplefish plates, mirror-carp scales, arowana)
      const s = p.size ?? 0.05;
      const rb = y / (s * 0.8), row = Math.floor(rb);
      const ua = u / s + (row & 1) * 0.5;
      const fa = ua - Math.floor(ua), fb = rb - row;
      const d = Math.hypot((fa - 0.62) * 1.1, (fb - 0.5) * 1.25);
      a = d > (p.inner ?? 0.48) && fa < 0.75 ? 1 : 0;
      break;
    }
    case 'hex': {
      // boxfish carapace plates: hexagon outlines
      const s = p.size ?? 0.06;
      const qx = u / s, qy = y / (s * 0.866);
      const row = Math.floor(qy), off = (row & 1) * 0.5;
      const fx = qx + off - Math.floor(qx + off) - 0.5, fy = qy - row - 0.5;
      const d = Math.max(Math.abs(fx) * 1.0, Math.abs(fy) * 1.15 + Math.abs(fx) * 0.35);
      a = d > (p.inner ?? 0.42) ? 1 : 0;
      if (!a && p.dot) { const dd = Math.hypot(fx, fy); if (dd < p.dot) { mix3(o, o, pc.ring, 1); return false; } }
      break;
    }
    default:
      return false;
  }
  if (a <= 0) return false;
  if (p.tone != null) tone3(o, p.tone * a);
  else mix3(o, o, col, a * (p.alpha ?? 1));
  return !!p.glow && a >= 0.5;
}

// ------------------------------------------------------------------ layout (2D maps at resolution r)

const PAD = 3;

/**
 * Sample the creature's side view at r voxels per lp. Returns the layout record used by realGrid():
 * body mask / half-thickness T (voxels) / albedo / role / glow maps, fin maps, eyes, mouth, gill points,
 * anchors and spine extents. infl = pufferfish inflation 0..1.
 */
export function realLayout(c, r, infl = 0) {
  const M = fishModel(c, infl);
  const S = M.S, L = M.L;
  const GW = Math.ceil((M.xmax - M.xmin) * r) + PAD * 2, GH = Math.ceil((M.ymax - M.ymin) * r) + PAD * 2;
  const N = GW * GH;
  const mask = new Uint8Array(N), T = new Float32Array(N).fill(-1);
  const col = new Uint32Array(N), role = new Uint8Array(N), glow = new Uint8Array(N), core = new Float32Array(N), coreCol = new Uint32Array(N);
  const fin = new Uint32Array(N), finGlow = new Uint8Array(N);
  const X0 = M.xmin, Y1 = M.ymax;
  const gX = (gx) => X0 + (gx - PAD + 0.5) / r, gY = (gy) => Y1 - (gy - PAD + 0.5) / r;
  const toGX = (X) => (X - X0) * r + PAD, toGY = (Y) => (Y1 - Y) * r + PAD;
  const C = S.col;
  const back = hexRGB(C.back), flank = hexRGB(C.flank), belly = hexRGB(C.belly);
  const head = C.head ? hexRGB(C.head) : null;
  const vb = C.vb ?? 0.66, vbel = C.vbel ?? 0.34, soft = C.soft ?? 0.12;
  const finRGB = hexRGB(C.fin || C.flank);
  const pats = (S.pat || []).map((p) => ({ p, pc: { col: hexRGB(p.color || '#000000'), ring: hexRGB(p.ring || '#ffffff'), edge: hexRGB(p.edge || '#101018') } }));
  const B = S.body || {};
  const xs = B.xs ?? 2, wy = B.wy ?? 0.46;
  const op = S.op ? { u: 0.24, top: 0.86, bot: 0.1, bulge: 0.025, ...S.op } : null;
  const lat = S.lateral ? { v0: 0.74, v1: 0.52, u0: (op?.u ?? 0.24) + 0.01, u1: 1, tone: -0.22, ...S.lateral } : null;
  const sc = S.scales ? { size: 0.022, k: 0.07, ...S.scales } : null;
  const scV = sc ? sc.size * L * r : 0;  // scale size in voxels
  const scK = sc ? sc.k * clamp01((scV - 1.6) / 2.2) : 0;
  const mouth = S.mouth ? { u: 0.1, v: 0.45, drop: 0, lip: 0.18, ...S.mouth } : null;
  const eyeSpec = S.eye ? { u: 0.08, v: 0.62, r: 0.03, ...S.eye } : null;
  const flatSide = M.flat ? 1 : 0;
  const glassBody = (S.mat?.glass ?? 0) >= 0.5 && !S.glassCore;
  const tmp = [0, 0, 0];

  // mouth gape line: tip (u ~ 0, at height v of the snout) -> corner (mouth.u)
  let mTipY = 0, mCornerY = 0;
  if (mouth) {
    const ut = 0.002;
    mTipY = M.botL(ut) + (M.topL(ut) - M.botL(ut)) * mouth.v;
    if (mouth.type === 'inferior') mTipY = M.botL(mouth.u0 ?? 0.05) + 0.25;
    mCornerY = mTipY + mouth.drop * L;
  }
  const mouthY = (u) => {
    const k = clamp01(u / mouth.u);
    if (mouth.type === 'inferior') {
      const ub = (mouth.u0 ?? 0.05) + k * (mouth.u - (mouth.u0 ?? 0.05));
      return M.botL(ub) + (mouth.lift ?? 0.012) * L * Math.sin(Math.PI * k);
    }
    return mTipY + (mCornerY - mTipY) * k - (mouth.curve ?? 0.006) * L * Math.sin(Math.PI * k);
  };

  for (let gy = 0; gy < GH; gy++) {
    const Y = gY(gy);
    for (let gx = 0; gx < GW; gx++) {
      const X = gX(gx);
      const u = M.uOf(X);
      const i = gy * GW + gx;
      let top, bot, inBody = false, hw = 0, isBill = false;
      if (u >= 0 && u <= 1) {
        top = M.topL(u); bot = M.botL(u);
        if (Y <= top && Y >= bot) inBody = true;
        hw = M.wid(u) * L;
        // hammerhead cephalofoil: a flat wing across the head
        if (M.ceph && u < M.ceph.u1) {
          const yc = (top + bot) / 2 + (M.ceph.y ?? 0) * L;
          const hh = M.ceph.h * L * (u < M.ceph.u0 ? 0.6 + 0.4 * u / M.ceph.u0 : 1);
          if (Math.abs(Y - yc) <= hh) { inBody = true; const k2 = u < M.ceph.u0 ? 1 : 1 - (u - M.ceph.u0) / (M.ceph.u1 - M.ceph.u0); hw = Math.max(hw, M.ceph.w * L * Math.sqrt(clamp01(k2)) * Math.sqrt(Math.max(0, 1 - ((Y - yc) / hh) ** 2))); }
        }
      } else if (u < 0 && M.bill && u >= -M.bill.len) {
        // bill / rostrum ahead of the snout (upper jaw)
        const k = 1 + u / M.bill.len;
        const yc = M.topL(0.004) * 0.5 + M.botL(0.004) * 0.5 + M.bill.y * L;
        const hh = M.bill.h * L * Math.pow(k, 0.8) + 0.3 / r;
        if (Math.abs(Y - yc) <= hh) { inBody = true; isBill = true; top = yc + hh; bot = yc - hh; hw = M.bill.w * L * Math.pow(k, 0.7) + 0.4 / r; }
      }
      if (inBody) {
        const hgt = top - bot;
        const v = hgt > 0 ? (Y - bot) / hgt : 0.5;
        // cross-section: superellipse, widest at wy of the local height
        const yw = bot + hgt * wy;
        const d = Y >= yw ? (Y - yw) / Math.max(1e-3, top - yw) : (yw - Y) / Math.max(1e-3, yw - bot);
        let tl = hw * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, d), 2)), 1 / xs);
        // the caudal peduncle thins out into the tail fin (no flat end cap)
        if (u > 0.93 && M.tail && M.tail.type !== 'whip') tl *= 0.35 + 0.65 * smoothstep(1.0, 0.93, u);
        mask[i] = 1;
        T[i] = Math.max(0.45, tl * r);
        role[i] = glassBody ? R_GLASS : R_BODY;
        // ---- albedo
        const o = SCR;
        if (v > vb) mix3(o, flank, back, smoothstep(vb - soft, vb + soft, v));
        else mix3(o, belly, flank, smoothstep(vbel - soft, vbel + soft, v));
        if (v > vb - soft && v < vb + soft) mix3(o, o, o, 0);
        if (head && u < (C.headU ?? 0.26)) mix3(o, o, head, smoothstep(C.headU ?? 0.26, (C.headU ?? 0.26) - 0.06, u) * (C.headAmt ?? 1) * (v > 0.25 ? 1 : 0.4));
        if (isBill && C.bill) mix3(o, o, hexRGB(C.bill), 0.8);
        const q = { u, v, x: X / L, y: Y / L, gx, gy, h: hgt / L, res: L * r };
        let gl = false;
        for (const { p, pc } of pats) if (applyPattern(p, o, q, pc)) gl = true;
        // ---- anatomy marks
        if (op && u < op.u + 0.04 && v > op.bot - 0.05 && v < op.top + 0.03) {
          const vv = clamp01((v - op.bot) / (op.top - op.bot));
          const ue = op.u + op.bulge * Math.sin(Math.PI * vv);
          const dv = (u - ue) * L * r;
          if (v >= op.bot && v <= op.top) {
            if (dv > -0.6 && dv <= 0.55) tone3(o, -(op.dark ?? 0.32));
            else if (dv > -1.8 && dv <= -0.6) tone3(o, op.light ?? 0.1);
          }
          // gill cover: a touch brighter, finer texture
          if (dv < -0.6 && op.cover) mix3(o, o, hexRGB(op.cover), op.coverAmt ?? 0.35);
          if (op.pre) {
            const up2 = op.u - op.pre - 0.012 * Math.sin(Math.PI * vv);
            if (Math.abs((u - up2) * L * r) < 0.5 && v > op.bot + 0.05 && v < op.top - 0.15) tone3(o, -0.12);
          }
        }
        if (S.slits) {
          const sl = S.slits;
          for (let k = 0; k < sl.n; k++) {
            const us = sl.u0 + (sl.u1 - sl.u0) * (k / Math.max(1, sl.n - 1));
            if (Math.abs((u - us - (v - 0.4) * 0.03) * L * r) < 0.55 && v > sl.v0 + k * (sl.dv ?? 0) && v < sl.v1) tone3(o, -0.35);
          }
        }
        if (lat && u >= lat.u0 && u <= lat.u1) {
          const vl = lat.v0 + (lat.v1 - lat.v0) * smoothstep(lat.u0, lat.u1, u);
          if (Math.abs((v - vl) * hgt * r) < (lat.w ?? 0.55) && (!lat.dash || (Math.floor(X * r / 1.5) & 1))) {
            if (lat.color) mix3(o, o, hexRGB(lat.color), 0.85); else tone3(o, lat.tone);
          }
        }
        if (mouth && u <= mouth.u + 0.01 && !isBill) {
          const my = mouthY(u);
          const dd = (Y - my) * r;
          if (Math.abs(dd) < 0.6) tone3(o, -(mouth.dark ?? 0.55));
          else if (dd >= 0.6 && dd < 0.6 + Math.max(1, mouth.lip * L * r * 0.12) && mouth.lips) mix3(o, o, hexRGB(mouth.lips), 0.6);
          else if (dd <= -0.6 && dd > -1.8 && mouth.chin) mix3(o, o, hexRGB(mouth.chin), 0.4);
        }
        if (eyeSpec && S.nostril !== false) {
          const nu = eyeSpec.u * (S.nostrilU ?? 0.45), nv = eyeSpec.v + 0.04;
          if (Math.abs((u - nu) * L * r) < 0.55 && Math.abs((v - nv) * hgt * r) < 0.55 && L * r > 30) tone3(o, -0.4);
        }
        // eye socket shading so the eye sits flush
        if (eyeSpec) {
          const eu = eyeSpec.u, ev = eyeSpec.v;
          const de = Math.hypot((u - eu) * L, (v - ev) * hgt) / (eyeSpec.r * L);
          if (de < 1.45 && de > 0.95 && S.orbit !== false) tone3(o, S.orbitTone ?? -0.12);
        }
        // staggered scale rows (exposed posterior edges catch less light)
        if (sc && scK > 0 && u > (op ? op.u + 0.015 : 0.2) && !isBill) {
          const s = sc.size * L;
          const rb = Y / (s * 0.82), row = Math.floor(rb);
          const ua = X / s + (row & 1) * 0.5;
          const fa = ua - Math.floor(ua), fb = rb - row;
          const dsc = Math.hypot((fa - 0.6) * 1.05, (fb - 0.5) * 1.3);
          let k = 0;
          if (dsc > 0.5 && fa < 0.62) k = -scK * 1.2;
          else if (dsc < 0.3) k = scK * 0.7;
          if (k) tone3(o, k * (sc.belly === false ? clamp01((v - 0.25) * 3) : 1));
        }
        // fine skin noise so big flat areas do not band
        tone3(o, (hash2(gx, gy, 77) - 0.5) * (S.grain ?? 0.04));
        col[i] = packRGB(o);
        if (gl) glow[i] = 1;
        // glass bodies with an opaque core (glassfish skeleton, barreleye organs)
        if (S.glassCore) {
          const g = S.glassCore;
          if (u >= (g.u0 ?? 0) && u <= (g.u1 ?? 1)) {
            role[i] = R_GLASS;
            const sp = M.botL(u) + (M.topL(u) - M.botL(u)) * (g.spineV ?? 0.55);
            const dS = Math.abs(Y - sp) * r;
            const rib = g.ribs && u > (g.ribU0 ?? 0.3) && u < (g.ribU1 ?? 0.62) && Y < sp && ((Math.floor((u * L * r) / Math.max(2, (g.ribGap ?? 0.03) * L * r))) % 2 === 0) && Math.abs(((u * L * r) % Math.max(2, (g.ribGap ?? 0.03) * L * r))) < 0.9;
            const gut = g.gut && u > g.gut.u0 && u < g.gut.u1 && v < g.gut.v1 && v > g.gut.v0;
            if (dS < 0.8) { core[i] = Math.max(0.5, 0.06 * L * r); coreCol[i] = packRGB(hexRGB(g.bone || '#e8f0f4')); }
            else if (rib) { core[i] = Math.max(0.5, T[i] * 0.55); coreCol[i] = packRGB(hexRGB(g.bone || '#e8f0f4')); }
            else if (gut) { core[i] = T[i] * 0.6; coreCol[i] = packRGB(hexRGB(g.gut.col || '#d8e0ea')); }
            else if (g.dome && u < g.dome.u1 && v > g.dome.v0) { core[i] = 0; }
            else core[i] = -1;
          }
        }
        continue;
      }
      // ---- unpaired fins (centre plane membranes; thick fleshy fins join the body maps)
      const fc = finAt(M, S, X, Y, u, r, finRGB, pats, tmp, gx, gy);
      if (fc) {
        if (fc.thick > 0) {
          mask[i] = 1; T[i] = Math.max(0.45, fc.thick * r); role[i] = R_BODY; col[i] = fc.col | 0xff000000;
          if (fc.glow) glow[i] = 1;
        } else {
          fin[i] = fc.col;
          if (fc.glow) finGlow[i] = 1;
        }
      }
    }
  }
  // inner shading: the mouth corner and eye socket read better with a touch of depth on T
  let maxT = 0;
  for (let i = 0; i < N; i++) if (T[i] > maxT) maxT = T[i];
  const [Tx, Ty] = thicknessGrad(T, mask, GW, GH);
  // eyes (both flanks unless flatfish)
  const eyes = [];
  if (eyeSpec) {
    const add = (u, v, side, idx, main) => {
      const X = M.xN - u * L;
      const Y = M.botL(u) + (M.topL(u) - M.botL(u)) * v;
      eyes.push({ x: toGX(X), y: toGY(Y), rv: Math.max(0.75, eyeSpec.r * L * r), rLook: eyeSpec.r * L, side, idx, main, e: eyeSpec });
    };
    add(eyeSpec.u, eyeSpec.v, M.flat ? 1 : 0, 0, true);
    if (M.flat && eyeSpec.second) add(eyeSpec.u + eyeSpec.second[0], eyeSpec.v + eyeSpec.second[1], 1, 1, false);
  }
  // gill edge points (for the breathing flare part)
  const gill = op && !S.noGill ? [] : null;
  if (gill) for (let k = 0; k <= 12; k++) {
    const vv = op.bot + (op.top - op.bot) * (k / 12);
    const u = op.u + op.bulge * Math.sin(Math.PI * (k / 12));
    const X = M.xN - u * L, Y = M.botL(u) + (M.topL(u) - M.botL(u)) * vv;
    gill.push([toGX(X), toGY(Y)]);
  }
  // mouth record (gape part + anchors)
  const mx = M.xN - 0.004 * L, my = mouth ? mTipY : 0;
  const mo = mouth ? { x: toGX(mx), y: toGY(my), wLook: Math.max(1.5, mouth.u * L), m: { type: mouth.teeth ? 'fangs' : 'small', teeth: !!mouth.teeth }, front: false } : null;
  let nose = -1, bodyTail = GW, tailEnd = GW;
  for (let i = 0; i < N; i++) if (mask[i]) { const gx = i % GW; if (gx > nose) nose = gx; }
  bodyTail = Math.floor(toGX(-L / 2));
  for (let i = 0; i < N; i++) if (fin[i] || mask[i]) { const gx = i % GW; if (gx < tailEnd) tailEnd = gx; }
  tailEnd = Math.min(tailEnd, bodyTail);
  // anchors (grid coords, y down)
  const midY = (M.topL(0.45) + M.botL(0.45)) / 2;
  const anchors = {
    mouth: [toGX(M.xN + (M.bill ? M.bill.len * L * 0.6 : 0)), toGY(mouth ? my : midY)],
    top: [toGX(M.xN - 0.4 * L), toGY(M.topL(0.4) + 2)],
    bottom: [toGX(M.xN - 0.45 * L), toGY(M.botL(0.45) - 1)],
    tail: [toGX(M.xmin + 2), toGY((M.topL(1) + M.botL(1)) / 2)],
  };
  if (S.lure) {
    const lu = S.lure;
    const bx = M.xN - lu.u * L, by = M.topL(lu.u);
    anchors.lure = [toGX(bx + Math.cos(lu.ang * DEG) * lu.len * L), toGY(by + Math.sin(lu.ang * DEG) * lu.len * L)];
  }
  return {
    c, M, real: true, kind: null, r, GW, GH, PAD, mask, T, Tx, Ty, maxT, col, role, glow, core, coreCol, fin, finGlow,
    eyes, mouth: mo, gill, anchors, nose, bodyTail, tailEnd, origin: [toGX(S.chainHead ? -L * 0.35 : 0), toGY(0)], toGX, toGY, gX, gY,
    wave: S.wave ?? 0.5, flat: M.flat, infl, bytes: N * 34,
    skinP: packRGB(flank), bellyP: packRGB(belly), finP: packRGB(finRGB),
  };
}

// Unpaired fin colour at (X, Y) outside the body, or null. Returns {col (packed, alpha = membrane / ray),
// glow, thick (lp half thickness for fleshy fins)}.
function finAt(M, S, X, Y, u, r, finRGB, pats, o, gx, gy) {
  const L = M.L;
  // dorsal / anal / adipose / finlets
  const fins = S.fins || [];
  for (let fi = 0; fi < fins.length; fi++) {
    const f = fins[fi];
    const bb = M.finBB[fi];
    if (X < bb.x0 || X > bb.x1 || Y < bb.y0 || Y > bb.y1) continue;
    if (!f._h) { f._h = finHeightFn(f); f._col = f.col ? hexRGB(f.col) : null; f._edge = f.edge ? hexRGB(f.edge) : null; f._base = f.base ? hexRGB(f.base) : null; f._spots = f.spots ? hexRGB(f.spots) : null; }
    const top = f.at !== 'bot';
    const rake = f.rake ?? 0.4;
    // shear back to the fin base (rays lean back by `rake`)
    let xb = X;
    for (let it = 0; it < 2; it++) {
      const ub = M.uOf(xb);
      const yb = top ? M.topL(clamp01(ub)) : M.botL(clamp01(ub));
      xb = X + rake * Math.abs(Y - yb);
    }
    const ub = M.uOf(xb);
    if (ub < f.from || ub > f.to) continue;
    const yb = top ? M.topL(ub) : M.botL(ub);
    const hgt = top ? Y - yb : yb - Y;
    if (hgt < -0.5 / r) continue;
    const t = (ub - f.from) / (f.to - f.from);
    let H = f._h(t) * (f.h ?? 0.1) * L;
    if (M.infl) H *= 1 - 0.35 * M.infl;
    if (f.finlets) {
      // separate little triangular finlets
      const k = t * f.finlets, fr = k - Math.floor(k);
      if (fr > 0.75) continue;
      H = (f.h ?? 0.02) * L * (1 - fr / 0.75);
    }
    const n = f.rays ?? 10;
    const tr = t * n, fr = tr - Math.floor(tr);
    const spacingV = ((f.to - f.from) * L * r) / n;
    let Hm = H;
    if (f.spiny) Hm = H * (1 - (f.notch ?? 0.32) * (0.5 - 0.5 * Math.cos(TAU * fr)));
    const rayD = Math.min(fr, 1 - fr) * spacingV;
    const isRay = !f.adipose && (spacingV >= 2.6 || (f.spiny && spacingV >= 1.8)) && rayD < 0.55;
    if (hgt > (isRay && f.spiny ? H * 1.04 : Hm)) continue;
    const ht = clamp01(hgt / Math.max(1e-3, H));
    if (f.thick) {
      const th = f.thick * L * (1 - 0.75 * ht) * (1 - 0.4 * Math.abs(t - 0.4));
      mix3(o, f._col || finRGB, f._edge || f._col || finRGB, f._edge ? smoothstep(0.55, 0.9, ht) : 0);
      if (f.tone) tone3(o, f.tone * ht);
      return { col: packRGB(o), thick: Math.max(0.5 / r, th) };
    }
    const base = f._base || null;
    mix3(o, f._col || finRGB, f._col || finRGB, 0);
    if (base) mix3(o, base, o, smoothstep(0, 0.45, ht));
    if (f._edge && hgt > Hm - (f.edgeW ?? 0.18) * H) mix3(o, o, f._edge, 1);
    if (f._spots && spotAt(X / L, Y / L, f.spotSize ?? 0.012, f.spotDensity ?? 0.5, 41) > 0.1) mix3(o, o, f._spots, 1);
    if (f.bands) for (const b of f.bands) if (Math.abs(ht - b.at) < b.w / 2) mix3(o, o, hexRGB(b.col), 1);
    if (f.adipose) return { col: packRGB(tone3(o, -0.05), 250), thick: (f.h ?? 0.03) * L * 0.25 };
    if (isRay) {
      if (f.rayBands) mix3(o, o, hexRGB(f.rayBands[Math.floor(ht * f.rayBands.length * 2) % f.rayBands.length]), 1);
      else if (f.rayCol) mix3(o, o, hexRGB(f.rayCol), 1);
      else tone3(o, f.rayTone ?? -0.07);
      return { col: packRGB(o, 245) };
    }
    if (f.clear) return { col: packRGB(o, 100) };
    return { col: packRGB(o, 150), glow: false };
  }
  // caudal fin
  const tf = M.tail;
  if (tf && tf.type === 'whip') {
    // a long thin tapering tail (rays, chimaeras, gulpers): fleshy, continues the body axis
    if (u < 1) return null;
    const k = (u - 1) / tf.len;
    if (k > 1) return null;
    const yc = (M.topL(1) + M.botL(1)) / 2 + (tf.y ?? 0) * L * k * k;
    const hh = Math.max(0.55 / r, Math.min((tf.w ?? 0.03) * L, (M.topL(1) - M.botL(1)) / 2) * Math.pow(1 - k, tf.taper ?? 1.4));
    if (Math.abs(Y - yc) > hh) return null;
    if (!tf._col) tf._col = hexRGB(tf.col || S.col.back);
    mix3(o, tf._col, tf._col, 0);
    if (tf.tip && k > 0.88) { mix3(o, o, hexRGB(tf.tip), 1); return { col: packRGB(o), thick: Math.max(0.5 / r, hh * 0.8), glow: !!tf.glowTip }; }
    return { col: packRGB(o), thick: Math.max(0.5 / r, hh * (tf.flat ?? 0.8)) };
  }
  if (tf && u > 0.94) {
    const xp = -L / 2;
    const yc = (M.topL(1) + M.botL(1)) / 2 + (tf.y ?? 0) * L;
    const f0 = (tf.focus ?? 0.05) * L;
    const dx = xp + f0 - X;
    if (dx <= 0) return null;
    const dy = Y - yc;
    const len = tf.len * L + f0, spr = tf.spread * L;
    const lobe = tf.lobe ?? 0; // > 0 upper lobe bigger (sharks)
    const thU = Math.atan2(spr * (1 + Math.max(0, lobe)), len), thD = Math.atan2(spr * (1 + Math.min(0, lobe) * 0.6 - Math.max(0, lobe) * 0.35), len);
    const th = Math.atan2(dy, dx);
    if (th > thU || th < -thD) return null;
    const t = (th + thD) / (thU + thD); // 0 bottom .. 1 top
    const s = 2 * t - 1;
    const dist = Math.hypot(dx, dy);
    let R;
    switch (tf.type) {
      case 'truncate': R = len / Math.cos(th); break;
      case 'round': R = len * (1.02 - 0.28 * s * s) / Math.cos(th * 0.5); break;
      case 'fan': R = len * (1.05 - 0.22 * s * s + 0.06 * Math.sin(t * 40)); break;
      case 'pointed': R = len * (1 - 0.65 * Math.abs(s)); break;
      case 'lunate': R = len * (1 - (tf.fork ?? 0.6) * Math.max(0, 1 - s * s)) / Math.cos(th * 0.85); break;
      case 'hetero': {
        // upper lobe long, a subterminal notch; lower lobe short and triangular
        if (s > 0) R = len * (0.55 + 0.6 * Math.pow(s, 0.7)) * (s > 0.75 && s < 0.86 ? 0.9 : 1);
        else R = len * (0.55 + 0.1 * -s) * (1 - 0.5 * Math.pow(-s, 3));
        break;
      }
      case 'emarginate': R = len * (1 - (tf.fork ?? 0.15) * (1 - s * s)) / Math.cos(th); break;
      case 'lyre': R = len * (1 - 0.35 * (1 - s * s)) * (Math.abs(s) > 0.85 ? 1.35 : 1) / Math.cos(th); break;
      default: R = len * (1 - tf.fork * (1 - Math.abs(s))) / Math.cos(th * 0.7); break;
    }
    if (dist > R || dist < f0 * 0.75) return null;
    if (!tf._col) { tf._col = tf.col ? hexRGB(tf.col) : null; tf._edge = tf.edge ? hexRGB(tf.edge) : null; tf._base = tf.base ? hexRGB(tf.base) : null; tf._upper = tf.upper ? hexRGB(tf.upper) : null; tf._lower = tf.lower ? hexRGB(tf.lower) : null; tf._spots = tf.spots ? hexRGB(tf.spots) : null; }
    const ht = clamp01((dist - f0) / Math.max(1e-3, R - f0));
    mix3(o, tf._col || finRGB, tf._col || finRGB, 0);
    if (tf._base) mix3(o, tf._base, o, smoothstep(0.05, 0.5, ht));
    if (tf._upper && s > 0.15) mix3(o, o, tf._upper, smoothstep(0.15, 0.4, s));
    if (tf._lower && s < -0.15) mix3(o, o, tf._lower, smoothstep(-0.15, -0.4, s));
    if (tf._edge && ht > 1 - (tf.edgeW ?? 0.14)) mix3(o, o, tf._edge, 1);
    if (tf._spots && spotAt(X / L, Y / L, tf.spotSize ?? 0.012, tf.spotDensity ?? 0.5, 43) > 0.1) mix3(o, o, tf._spots, 1);
    if (tf.bars) for (const b of tf.bars) if (Math.abs(ht - b.at) < b.w / 2) mix3(o, o, hexRGB(b.col), 1);
    if (tf.thick) {
      const th2 = tf.thick * L * (1 - 0.8 * ht) * (1 - 0.3 * Math.abs(s));
      return { col: packRGB(o), thick: Math.max(0.5 / r, th2) };
    }
    // rays radiate from the focus
    const n = tf.rays ?? 14;
    const tr = t * n, fr = tr - Math.floor(tr);
    const gap = ((thU + thD) / n) * dist * r;
    const isRay = gap >= 2.6 && Math.min(fr, 1 - fr) * gap < 0.55;
    if (tf.glowTip && ht > 0.8) return { col: packRGB(o, 250), glow: true };
    if (isRay) { tone3(o, tf.rayTone ?? -0.07); return { col: packRGB(o, 245) }; }
    return { col: packRGB(o, 150) };
  }
  return null;
}

// Gradient of the (lightly blurred) thickness field.
function thicknessGrad(T, mask, W, H) {
  const N = W * H;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Math.max(0, T[y * W + x]));
  const B = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    B[i] = (at(x, y) * 4 + at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 8;
  }
  const b = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : B[y * W + x]);
  const Tx = new Float32Array(N), Ty = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    Tx[i] = (b(x + 1, y) - b(x - 1, y)) / 2;
    Ty[i] = (b(x, y + 1) - b(x, y - 1)) / 2;
  }
  return [Tx, Ty];
}

// ------------------------------------------------------------------ grid (3D, per swim frame)

const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

/**
 * Build the 3D voxel grid of a column-model creature for swim frame sw (0..SWIM_FRAMES-1).
 * Lo.pal (voxelfish Pal) must be set. Returns the grid record for the voxelfish renderer.
 */
export function realGrid(Lo, sw) {
  const { c, M, GW, GH, mask, T, col, role, glow, fin, finGlow, maxT, pal, core, coreCol } = Lo;
  const S = M.S, L = M.L, r = Lo.r;
  const ph = sw / SWIM_FRAMES;
  const bodyLen = Math.max(4, Lo.nose - Lo.bodyTail);
  const wave = clamp01(Lo.wave);
  const amp = S.wave === 0 ? 0 : (0.04 + 0.12 * wave) * bodyLen * (S.stiff ? 0.5 : 1);
  const total = Math.max(1, Lo.nose - Lo.tailEnd + 2);
  const k0 = S.waveK ?? 3.2;
  const off = (u) => {
    // travelling wave, mostly in the rear body (u 0 nose .. 1 peduncle); the tail continues straight
    const a = amp * (S.stiff ? Math.pow(u, 3) : u * u);
    if (u <= 1) return a * Math.sin(TAU * ph - u * k0);
    const o1 = amp * Math.sin(TAU * ph - k0);
    const d1 = amp * ((S.stiff ? 3 : 2) * Math.sin(TAU * ph - k0) - k0 * Math.cos(TAU * ph - k0));
    return o1 + d1 * (u - 1);
  };
  const srcOf = new Int32Array(GW), zOf = new Int16Array(GW);
  for (let gx = 0; gx < GW; gx++) { srcOf[gx] = gx; zOf[gx] = 0; }
  if (amp > 0.3) {
    const X = new Float32Array(total + 1), Z = new Float32Array(total + 1);
    X[0] = Lo.nose + 0.5; Z[0] = 0;
    for (let s = 0; s < total; s++) {
      const dz = off((s + 1) / bodyLen) - off(s / bodyLen);
      const th = Math.atan(dz);
      X[s + 1] = X[s] - Math.cos(th);
      Z[s + 1] = Z[s] + Math.sin(th);
    }
    let s = 0;
    for (let tx = Lo.nose; tx >= 0; tx--) {
      const cx = tx + 0.5;
      while (s < total && Math.abs(X[s + 1] - cx) <= Math.abs(X[s] - cx)) s++;
      if (s >= total && X[total] - cx > 0.75) { srcOf[tx] = -1; continue; }
      srcOf[tx] = Lo.nose - s;
      zOf[tx] = Math.round(Z[s]);
    }
  }
  // cetaceans undulate up and down (yOf per column); rays flap their wings (zFlap per row, |y| from the axis)
  const yOf = new Int16Array(GW);
  if (S.vbend) {
    const vamp = S.vbend * bodyLen;
    for (let tx = 0; tx < GW; tx++) {
      const u = (Lo.nose - tx) / bodyLen;
      const a = u <= 1 ? vamp * u * u * Math.sin(TAU * ph - u * 2.6) : vamp * Math.sin(TAU * ph - 2.6) + vamp * (2 * Math.sin(TAU * ph - 2.6) - 2.6 * Math.cos(TAU * ph - 2.6)) * (u - 1);
      yOf[tx] = Math.round(a);
    }
  }
  let flapAt = null, flapMax = 0;
  if (S.flap) {
    const yc = Lo.origin[1], span = Math.max(4, (M.ymax - M.ymin) * r * 0.5);
    flapAt = (tx, gy) => {
      const d = Math.abs(gy - yc) / span;
      const u = (Lo.nose - tx) / bodyLen;
      return Math.round(S.flap * span * Math.pow(d, 1.6) * Math.sin(TAU * ph - u * (S.flapK ?? 1.2)));
    };
    flapMax = Math.ceil(S.flap * span) + 1;
  }
  let bendMax = flapMax;
  for (let gx = 0; gx < GW; gx++) bendMax = Math.max(bendMax, Math.abs(zOf[gx]) + flapMax);
  // paired fin reach + eyes + barbels + spines
  const pecL = S.pec ? (S.pec.len || 0.15) * L * r : 0;
  const pelL = S.pel ? (S.pel.len || 0.1) * L * r : 0;
  let reach = Math.max(pecL * 0.85, pelL * 0.6);
  for (const b of S.barbels || []) reach = Math.max(reach, b.len * L * r * 0.5 + 2);
  const spK = S.spines ? Math.max(Lo.infl, S.spines.always ? 0.6 : 0) : 0;
  if (spK > 0) reach = Math.max(reach, S.spines.len * L * r * spK + 2);
  if (S.flukes) reach = Math.max(reach, S.flukes.span * L * r + 2);
  const NZ = 2 * (Math.ceil(maxT + reach) + bendMax + 4) + 3;
  const zc = NZ >> 1;
  const NX = GW, NY = GH, NXY = NX * NY;
  const data = new Uint16Array(NXY * NZ);
  const zmin = new Int16Array(NXY).fill(32767), zmax = new Int16Array(NXY).fill(-1);
  const set = (x, gy, z, v) => {
    if (yOf[x] && x >= 0 && x < NX) gy += yOf[x];
    if (x < 0 || x >= NX || z < 0 || z >= NZ || gy < 0 || gy >= NY) return;
    const col2 = x + (NY - 1 - gy) * NX;
    data[col2 + z * NXY] = v;
    if (z < zmin[col2]) zmin[col2] = z;
    if (z > zmax[col2]) zmax[col2] = z;
  };
  const get = (x, gy, z) => (x < 0 || x >= NX || z < 0 || z >= NZ || gy < 0 || gy >= NY ? 0 : data[x + (NY - 1 - gy) * NX + z * NXY]);
  const flat = Lo.flat;
  const blindP = flat ? pal.idx(packRGB(hexRGB(flat.blind || '#f4f2ee')), R_BODY, false) : 0;
  // ---- body columns
  const idxCache = new Map();
  const pidx = (p, ro, gl) => {
    const k = p * 32 + ro * 2 + (gl ? 1 : 0);
    let v = idxCache.get(k);
    if (v === undefined) { v = pal.idx(p, ro, gl); idxCache.set(k, v); }
    return v;
  };
  for (let tx = 0; tx < GW; tx++) {
    const gx = srcOf[tx];
    if (gx < 0) continue;
    const zo = zOf[tx];
    for (let gy = 0; gy < GH; gy++) {
      const i = gy * GW + gx;
      if (!mask[i]) continue;
      const t = T[i];
      const zr = Math.max(0, Math.round(t));
      const ro = role[i];
      const pv = pidx(col[i] | 0xff000000, ro, !!glow[i]);
      if (core[i] > 0 || (core[i] === 0 && ro === R_GLASS)) {
        const cr = Math.round(core[i]);
        const pc = core[i] > 0 ? pidx(coreCol[i] | 0xff000000, R_BODY, false) : 0;
        for (let z = -zr; z <= zr; z++) set(tx, gy, zc + z + zo, Math.abs(z) <= cr && pc ? pc : (Math.abs(z) >= zr - 1 ? pv : 0));
        continue;
      }
      if (ro === R_GLASS) {
        // see-through body: a glass skin around an empty inside
        for (let z = -zr; z <= zr; z++) if (Math.abs(z) >= zr - 1) set(tx, gy, zc + z + zo, pv);
        continue;
      }
      const zf = flapAt ? zo + flapAt(tx, gy) : zo;
      if (flat) {
        for (let z = -zr; z <= zr; z++) set(tx, gy, zc + z + zf, z < 0 ? blindP : pv);
      } else for (let z = -zr; z <= zr; z++) set(tx, gy, zc + z + zf, pv);
    }
  }
  // ---- unpaired fins in the centre plane
  for (let tx = 0; tx < GW; tx++) {
    const gx = srcOf[tx];
    if (gx < 0) continue;
    const zo = zOf[tx];
    for (let gy = 0; gy < GH; gy++) {
      const i = gy * GW + gx;
      const p = fin[i];
      if (!p) continue;
      set(tx, gy, zc + zo + (flapAt ? flapAt(tx, gy) : 0), pidx(p, R_FIN, !!finGlow[i]));
    }
  }
  const zAt = (tx) => zOf[clamp(Math.round(tx), 0, NX - 1)];
  const tAt = (gx, gy) => { gx = Math.round(gx); gy = Math.round(gy); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : T[gy * GW + gx]; };
  // body surface z at a layout point, searching inward when the point is just outside the mask
  const surfT = (gx, gy) => {
    let t = tAt(gx, gy);
    for (let k = 1; k < 6 && t < 0; k++) t = Math.max(tAt(gx, gy - k), tAt(gx, gy + k), tAt(gx + k, gy), tAt(gx - k, gy));
    return Math.max(0, t);
  };
  const txOfGx = (gx) => {
    // inverse of srcOf: the bent column showing layout column gx
    let best = gx, bd = 1e9;
    for (let x = 0; x < NX; x++) { const s = srcOf[x]; if (s >= 0) { const d = Math.abs(s - gx); if (d < bd) { bd = d; best = x; } } }
    return best;
  };
  // ---- paired fins (pectorals flap, pelvics trail), stamped on both flanks
  const finPal = (rgb, ray, opaque) => (opaque ? pidx(packRGB(rgb), R_LIMB, false) : pidx(packRGB(rgb, ray ? 245 : 150), R_FIN, false));
  const stampPaired = (F, kind) => {
    if (!F) return;
    const isPec = kind === 'pec';
    const u = F.u, X = M.xN - u * L;
    const yTop = M.topL(u), yBot = M.botL(u);
    const Y = isPec ? yBot + (yTop - yBot) * (F.v ?? 0.3) : yBot + (F.v ?? 0.04) * (yTop - yBot);
    const gx0 = Lo.toGX(X), gy0 = Lo.toGY(Y);
    const tx0 = txOfGx(Math.round(gx0));
    const len = (F.len || 0.12) * L * r, wmax = (F.w || 0.04) * L * r;
    const ang = (F.ang ?? (isPec ? -20 : -60)) * DEG;
    // flap: pectorals beat, pelvics flutter a little
    const flap = (F.flap ?? (isPec ? 1 : 0.4)) * Math.sin(TAU * ph + (isPec ? 1.1 : 2.3));
    const spread = ((F.spread ?? (isPec ? 38 : 22)) + flap * (isPec ? 18 : 8)) * DEG;
    const dX = -Math.cos(ang), dY = Math.sin(ang); // in side view: pointing back (and up/down)
    const pX = -dY, pY = dX; // across the fin
    const rgb = F.col ? hexRGB(F.col) : hexRGB(S.col.fin || S.col.flank);
    const edge = F.edge ? hexRGB(F.edge) : null;
    const base = F.base ? hexRGB(F.base) : null;
    const spots = F.spots ? hexRGB(F.spots) : null;
    const nR = F.rays ?? (isPec ? 12 : 6);
    const shape = F.shape || 'round';
    const T0 = surfT(gx0, gy0);
    const o = [0, 0, 0];
    const step = 0.5;
    for (let s = 0; s <= len; s += step) {
      const k = s / len;
      let wk;
      if (shape === 'long') wk = Math.min(1, Math.sqrt(k / 0.3)) * Math.pow(1 - k, 0.6) * 0.9 + 0.1 * (1 - k);
      else if (shape === 'fan') wk = Math.min(1, k / 0.35 + 0.25) * Math.sqrt(Math.max(0, 1 - Math.pow(k, 6)));
      else if (shape === 'wing') wk = Math.min(1, k / 0.25 + 0.3) * Math.pow(1 - Math.pow(k, 2.2), 0.5);
      else wk = Math.min(1, Math.sqrt(k / 0.45) * 0.85 + 0.15) * Math.sqrt(Math.max(0, 1 - Math.pow(k, 3)));
      const w = wmax * wk;
      for (let q = -w; q <= w; q += step) {
        const tq = (q / Math.max(0.01, w) + 1) / 2;
        const tr = tq * nR, fr = tr - Math.floor(tr);
        const gap = (2 * w) / nR;
        const isRay = gap >= (F.feather ? 1.6 : 2.6) && Math.min(fr, 1 - fr) * gap < 0.5;
        const isSpine = F.spines && Math.min(fr, 1 - fr) * gap < 0.5;
        if (F.ragged && k > 0.55 && !isRay && hash2(Math.round(s), Math.round(q * 3), 5) > 1.2 - k) continue;
        // feathery lionfish fins: membranes only near the base
        if (F.feather && !isRay && k > F.feather) continue;
        mix3(o, rgb, rgb, 0);
        if (base) mix3(o, base, o, smoothstep(0, 0.5, k));
        if (edge && k > 0.82) mix3(o, o, edge, 1);
        if (spots && spotAt((s * 0.7) / (L * r), q / (L * r), 0.012, 0.5, 47) > 0.1) mix3(o, o, spots, 1);
        if (F.bands) for (const b of F.bands) if (Math.abs(k - b.at) < b.w / 2) mix3(o, o, hexRGB(b.col), 1);
        if ((isRay || isSpine) && F.rayBands) mix3(o, o, hexRGB(F.rayBands[Math.floor(k * F.rayBands.length * 2.5) % F.rayBands.length]), 1);
        else if (isRay || isSpine) tone3(o, F.rayTone ?? -0.1);
        const v = finPal(o, isRay || isSpine, F.opaque);
        // fin plane: swing out from the flank by `spread`
        const out = s * Math.sin(spread);
        const px = tx0 + (s * Math.cos(spread)) * dX + q * pX;
        const py = gy0 - ((s * Math.cos(spread)) * dY + q * pY);
        const zz = T0 + 0.6 + out;
        for (const side of [1, -1]) {
          if (flat && side < 0 && !F.both) continue;
          set(Math.round(px), Math.round(py), Math.round(zc + zAt(px) + side * zz), v);
        }
      }
    }
  };
  stampPaired(S.pec, 'pec');
  stampPaired(S.pel, 'pel');
  if (S.flukes) {
    // horizontal tail flukes: a swept-back crescent in the x-z plane at the end of the peduncle
    const fk = S.flukes;
    const X0 = -L / 2;
    const gx0 = Lo.toGX(X0), gy0 = Lo.toGY((M.topL(1) + M.botL(1)) / 2);
    const tx0 = txOfGx(Math.round(gx0));
    const len = fk.len * L * r, span = fk.span * L * r;
    const v = pidx(packRGB(hexRGB(fk.col || S.col.back)), R_BODY, false);
    const vb = pidx(packRGB(hexRGB(S.col.belly)), R_BODY, false);
    for (let a = -span; a <= span; a += 0.5) {
      const k = Math.abs(a) / span;
      const lead = len * 0.15 + len * 0.6 * k * k;           // leading edge sweeps back toward the tips
      const trail = len * (0.62 + 0.2 * k) - len * 0.18 * (1 - k) * (k < 0.15 ? 1 : 0); // notch at the centre
      for (let b = lead; b <= trail; b += 0.5) {
        const px = tx0 - b;
        const py = gy0 + 0;
        set(Math.round(px), Math.round(py), Math.round(zc + zAt(px) + a), v);
        set(Math.round(px), Math.round(py) + 1, Math.round(zc + zAt(px) + a), vb);
      }
    }
  }
  // ---- barbels (whiskers): thin curving filaments from the mouth / chin
  for (const b of S.barbels || []) {
    const X = M.xN - b.u * L;
    const Y = b.top ? M.topL(b.u) : M.botL(b.u) + (M.topL(b.u) - M.botL(b.u)) * (b.v ?? 0.15);
    const gx0 = Lo.toGX(X), gy0 = Lo.toGY(Y);
    const tx0 = txOfGx(Math.round(gx0));
    const T0 = b.mid ? 0 : surfT(gx0, gy0);
    const len = b.len * L * r;
    const a0 = (b.ang ?? -60) * DEG, curl = (b.curl ?? 0.6) * (1 + 0.25 * Math.sin(TAU * ph + b.u * 9));
    const v = pidx(packRGB(hexRGB(b.col || S.col.flank)), R_LIMB, !!b.glow);
    const vt = b.tip ? pidx(packRGB(hexRGB(b.tip)), R_EYE, !!b.glowTip) : v;
    const outZ = b.mid ? 0 : (b.out ?? 0.35);
    for (const side of b.mid ? [0] : [1, -1]) {
      let px = tx0, py = gy0, pz = zc + zAt(tx0) + side * (T0 + 0.5), a = a0;
      for (let s = 0; s < len; s += 0.5) {
        const k = s / len;
        a += (curl / len) * 0.5 * (b.ang > 0 ? -1 : 1) * (b.fwd ? -1 : 1);
        px += Math.cos(a) * 0.5 * (b.fwd ? 1 : -1);
        py -= Math.sin(a) * 0.5;
        pz += side * outZ * 0.5 * (1 - k);
        const vv = k > 0.86 && b.tip ? vt : v;
        set(Math.round(px), Math.round(py), Math.round(pz), vv);
        if (b.w && k < 0.5) set(Math.round(px), Math.round(py) + 1, Math.round(pz), vv);
      }
      if (b.bulb) {
        const R = b.bulb * L * r;
        for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy + dz * dz <= R * R + 0.3) set(Math.round(px + dx), Math.round(py + dy), Math.round(pz + dz), vt);
      }
    }
  }
  // ---- angler lure: an illicium rod from the forehead ending in a glowing esca
  if (S.lure) {
    const lu = S.lure;
    const X = M.xN - lu.u * L, Y = M.topL(lu.u);
    const gx0 = Lo.toGX(X), gy0 = Lo.toGY(Y);
    const tx0 = txOfGx(Math.round(gx0));
    const len = lu.len * L * r;
    const vRod = pidx(packRGB(hexRGB(lu.rod || S.col.back)), R_LIMB, false);
    const vB = pidx(packRGB(hexRGB(lu.col || '#bff8ff')), R_EYE, true);
    const vB2 = pidx(packRGB(hexRGB(lu.col2 || '#ffffff')), R_SPEC, true);
    let px = tx0, py = gy0, a = (lu.ang ?? 60) * DEG;
    const sway = 0.12 * Math.sin(TAU * ph);
    for (let s = 0; s < len; s += 0.5) {
      a -= ((lu.curve ?? 1.4) / len) * 0.5;
      px += Math.cos(a + sway) * 0.5; py -= Math.sin(a + sway) * 0.5;
      const zz = zc + zAt(px);
      set(Math.round(px), Math.round(py), zz, vRod);
      if (s < len * 0.3 && lu.thick) set(Math.round(px), Math.round(py), zz + 1, vRod);
    }
    const R = Math.max(1, lu.bulb * L * r);
    for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R * R + 0.3) continue;
      set(Math.round(px + dx), Math.round(py + dy), Math.round(zc + zAt(px) + dz), d2 < R * R * 0.3 ? vB2 : vB);
    }
    if (lu.filaments) for (let k = 0; k < lu.filaments; k++) {
      let fx = px, fy = py, fa = -0.6 + (k / Math.max(1, lu.filaments - 1)) * 2.4;
      for (let s = 0; s < R * 2.2; s += 0.5) { fx += Math.cos(fa) * 0.5; fy += Math.sin(fa) * 0.5; set(Math.round(fx), Math.round(fy), Math.round(zc + zAt(px)), vB); }
    }
  }
  // ---- teeth: fangs along the jaws, just inside the lips (both flanks)
  if (S.mouth?.teeth && Lo.mouth) {
    const tt = S.mouth.teeth;
    const n = tt.n ?? 6;
    const vT = pidx(packRGB(hexRGB(tt.col || '#f4f8ff')), R_EYE, !!tt.glow);
    const mu = S.mouth.u;
    for (let k = 0; k < n; k++) {
      const u = 0.012 + (mu - 0.02) * (k / Math.max(1, n - 1));
      const X = M.xN - u * L;
      const gx = Lo.toGX(X);
      const tx = txOfGx(Math.round(gx));
      const myL = Lo.toGY(Lo.M.botL(u) + (Lo.M.topL(u) - Lo.M.botL(u)) * S.mouth.v + S.mouth.drop * L * (u / mu));
      const tl = (tt.len ?? 0.03) * L * r * (k % 2 ? 0.6 : 1) * (1 - 0.4 * (k / n));
      const T0 = surfT(gx, myL) * 0.75;
      for (const side of [1, -1]) for (let s = 0; s < tl; s += 0.5) {
        const up = k % 2 === 0 ? 1 : -1; // alternate upper / lower fangs
        set(tx, Math.round(myL - up * (s + 0.5)), Math.round(zc + zAt(tx) + side * T0), vT);
      }
    }
  }
  // ---- puffer spines (inflated): short cones along the outward normals
  if (spK > 0.05) {
    const sl = S.spines.len * L * r * spK;
    const vS = pidx(packRGB(hexRGB(S.spines.col || '#f0e8d0')), R_LIMB, false);
    const step = Math.max(2, (S.spines.gap ?? 0.07) * L * r);
    for (let gy = 1; gy < GH - 1; gy += step) for (let gx = 1; gx < GW - 1; gx += step) {
      const jx = Math.round(gx + (hash2(gx, gy, 3) - 0.5) * step * 0.6), jy = Math.round(gy + (hash2(gx, gy, 5) - 0.5) * step * 0.6);
      const i = jy * GW + jx;
      if (!mask[i] || M.uOf(Lo.gX(jx)) > 0.85) continue;
      const t = T[i];
      const n = norm3(-Lo.Tx[i], Lo.Ty[i], 1);
      const tx = txOfGx(jx);
      for (const side of [1, -1]) {
        for (let s = 0; s < sl; s += 0.5) set(Math.round(tx + n[0] * s), Math.round(jy - n[1] * s), Math.round(zc + zAt(tx) + side * (t + n[2] * s)), vS);
      }
    }
  }
  // ---- eyes: natural fish eyes set flush into the head
  const eyes3 = [];
  const eyesOut = [];
  for (const e of Lo.eyes) {
    const gx = clamp(Math.floor(e.x), 0, GW - 1), gy = clamp(Math.floor(e.y), 0, GH - 1);
    const tx = txOfGx(gx);
    const zo = zAt(tx);
    const T0 = surfT(e.x, e.y);
    const rb = Math.max(0.7, e.rv);
    const sides = e.side ? [e.side] : [1, -1];
    const cx = tx + (e.x - gx), cy = NY - e.y;
    const out = { ...e, rb, flanks: [] };
    const li = gy * GW + gx;
    if (e.e.tube) {
      // barreleye: tubular eyes inside the transparent head dome, gazing up through it
      const vT = pal.idx(packRGB(hexRGB(e.e.tubeCol || '#1a3a2a')), R_BODY, false);
      const vL = pal.idx(packRGB(hexRGB(e.e.lens || '#3aff8a')), R_EYE, true);
      const len = rb * 2.4;
      for (const fl of [1, -1]) {
        const zc2 = zc + 0.5 + zo + fl * rb * 0.9;
        for (let h = 0; h <= len; h += 0.5) for (let a = -rb; a <= rb; a += 0.5) for (let b = -rb; b <= rb; b += 0.5) {
          if (a * a + b * b > rb * rb) continue;
          const top = h > len - 1.2;
          const x = Math.round(cx + a + h * 0.15), y = Math.round(cy - rb + h), z = Math.round(zc2 + b);
          if (x < 0 || x >= NX || y < 0 || y >= NY || z < 0 || z >= NZ) continue;
          const cc = x + y * NX;
          data[cc + z * NXY] = top ? vL : vT;
          if (z < zmin[cc]) zmin[cc] = z;
          if (z > zmax[cc]) zmax[cc] = z;
        }
      }
      eyes3.push({ ...e, rb, flanks: [] });
      eyesOut.push({ ...e, p: [cx, cy, zc + 0.5 + zo + T0 + 1.2] });
      continue;
    }
    for (const fl of sides) {
      // eye axis: mostly out of the flank, a touch forward and up (follows the head surface)
      const n = e.e.top ? norm3(0.15, 0.85, fl * 0.5) : e.e.front ? norm3(0.75, 0.1, fl * 0.66) : norm3(-(Lo.Tx[li] || 0) * 0.6 + 0.12, (Lo.Ty[li] || 0) * 0.6 + 0.04, fl);
      const bulge = e.e.bulge ?? 0.42;
      const cz = zc + 0.5 + zo + fl * Math.max(0, T0 + 0.5 - rb * (1 - bulge));
      const C = [cx + n[0] * 0, cy, cz];
      out.flanks.push({ fl, c: C, n });
      stampRealEye(e.e, rb, C, n, (x, y, z, v) => { if (y >= 0 && y < NY) { const col2 = x + y * NX; if (x < 0 || x >= NX || z < 0 || z >= NZ) return; data[col2 + z * NXY] = v; if (z < zmin[col2]) zmin[col2] = z; if (z > zmax[col2]) zmax[col2] = z; } }, pal, Lo.skinP);
    }
    eyes3.push(out);
    eyesOut.push({ ...e, p: [cx, cy, zc + 0.5 + zo + T0 + 1.2] });
  }
  // occupied bounds
  let x0 = NX, x1 = -1, y0 = NY, y1 = -1, z0 = NZ, z1 = -1;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const cc = x + y * NX;
    if (zmax[cc] < 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (zmin[cc] < z0) z0 = zmin[cc];
    if (zmax[cc] > z1) z1 = zmax[cc];
  }
  if (x1 < 0) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 0; }
  const P3 = (p, zExtra = 0) => {
    const tx = clamp(Math.floor(p[0]), 0, NX - 1);
    return [p[0], NY - p[1], zc + 0.5 + zExtra + zOf[tx]];
  };
  const mouth = Lo.mouth ? { ...Lo.mouth, p: P3([Lo.mouth.x, Lo.mouth.y], Math.max(0, Math.round(surfT(Lo.mouth.x - 1, Lo.mouth.y))) + 0.8) } : null;
  const anchors = {};
  for (const [k2, v] of Object.entries(Lo.anchors)) anchors[k2] = P3(v);
  // analytic body normals: F = |z - zc - zOf| - T(srcOf(x), y)
  const nf = (ix, iy, iz, v) => {
    const ro = pal.role[v];
    if (ro !== R_BODY && ro !== R_GLASS && ro !== R_MOUTH) return null;
    const sxi = srcOf[ix];
    if (sxi < 0) return null;
    const gy = NY - 1 - iy - yOf[ix];
    if (gy < 0 || gy >= GH) return null;
    const li = gy * GW + sxi;
    if (!mask[li]) return null;
    const dz = iz + 0.5 - (zc + 0.5 + zOf[ix] + (flapAt ? flapAt(ix, gy) : 0));
    if (Math.abs(dz) < T[li] - 1.6) return null; // inner core voxels (glass bodies)
    const side = dz >= 0 ? 1 : -1;
    return norm3(-Lo.Tx[li], Lo.Ty[li], side);
  };
  return {
    Lo, data, NX, NY, NZ, NXY, zmin, zmax, pal, x0, x1, y0, y1, z0, z1, srcOf, zOf, yOf, zc, mat: Lo.mat, nf, roll: Lo.roll || 0,
    center: [Lo.origin[0], NY - Lo.origin[1], zc + 0.5],
    eyes: eyesOut, eyes3, mouth, anchors, bytes: data.byteLength + NXY * 4,
  };
}

// ------------------------------------------------------------------ natural eyes

// Eye surface colour for a unit direction from the eyeball centre, gaze axis g. Natural fish eye: a large
// dark pupil, a coloured iris ring (radial gradient, darker toward the top under the orbit), a dark limbus.
export function realEyeColor(e, dx, dy, dz, g) {
  const cosA = dx * g[0] + dy * g[1] + dz * g[2];
  if (cosA <= 0.05) return [e._rim || 0xff202830, R_PUPIL, 0];
  const rho = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pr = e.pupil ?? 0.52;
  if (!e._iris) {
    const ir = hexRGB(e.iris || '#c8a850');
    e._iris = [packRGB(tone3([...ir], -0.35)), packRGB(ir), packRGB(tone3([...ir], 0.28)), packRGB(tone3([...ir], 0.5))];
    e._pup = packRGB(hexRGB(e.pupilCol || '#06080e'));
    e._rim = packRGB(hexRGB(e.rim || '#141820'));
  }
  if (e.glow && rho < pr) return [packRGB(hexRGB(e.glow)), R_EYE, 1];
  if (rho < pr) return [e._pup, R_PUPIL, 0];
  if (rho < pr + 0.06) return [e._iris[0], R_EYE, 0];
  if (rho < 0.88) {
    const k = (rho - pr) / (0.88 - pr);
    const up = dy - g[1] * cosA; // upper iris is shaded by the orbit
    if (up > 0.35 && k > 0.3) return [e._iris[0], R_EYE, 0];
    return [k < 0.45 ? e._iris[2] : k < 0.8 ? e._iris[1] : e._iris[3], R_EYE, 0];
  }
  return [e._rim, R_PUPIL, 0];
}

// Baked eyeball (body grid resolution).
export function stampRealEye(e, rb, C, n, put, pal, skinP) {
  const R = Math.ceil(rb + 1);
  const g = n;
  const sd = norm3(g[0] + 0.35, g[1] + 0.55, g[2] + 0.2 * Math.sign(g[2] || 1));
  let best = -2, bx = 0, by = 0, bz = 0;
  const cache = new Map();
  const pv = (col, role, gl) => { const k = col * 4 + role; let v = cache.get(k); if (v === undefined) { v = pal.idx(col, role, !!gl); cache.set(k, v); } return v; };
  for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.floor(C[0]) + dx, y = Math.floor(C[1]) + dy, z = Math.floor(C[2]) + dz;
    const qx = (x + 0.5 - C[0]) / rb, qy = (y + 0.5 - C[1]) / rb, qz = (z + 0.5 - C[2]) / rb;
    const d = Math.hypot(qx, qy, qz);
    if (d > 1) continue;
    const a = qx * n[0] + qy * n[1] + qz * n[2];
    if (a < -0.3) continue;
    const [col, role, gl] = realEyeColor(e, qx / (d || 1), qy / (d || 1), qz / (d || 1), g);
    put(x, y, z, pv(col, role, gl));
    if (d > 1 - 1.3 / rb && role !== R_EYE || (d > 1 - 1.3 / rb && rb < 2.2)) {
      const sh = (qx * sd[0] + qy * sd[1] + qz * sd[2]) / (d || 1);
      if (sh > best && a > 0.3) { best = sh; bx = x; by = y; bz = z; }
    }
  }
  if (best > -1 && rb >= 1.2) put(bx, by, bz, pv(0xffffffff, R_SPEC, false));
  void skinP;
}

// ------------------------------------------------------------------ geometry for layout / fitting

/** Side-view bounding box + anchors at scale s (canvas coords, origin = top-left), like fishart.rigGeom. */
export function realGeom(c, s = 1, infl = 0) {
  if (c.real.plan === 'solid') {
    const E = solidExtents(c);
    const w = (E.x1 - E.x0) * s, h = (E.y1 - E.y0) * s;
    const P = (x, y) => [(x - E.x0) * s, (E.y1 - y) * s];
    const anchors = { mouth: P(E.mouth[0], E.mouth[1]), top: P(0, E.y1), bottom: P(0, E.y0), tail: P(E.x0, 0) };
    if (E.lure) anchors.lure = P(E.lure[0], E.lure[1]);
    return { w, h, ox: -E.x0 * s, oy: E.y1 * s, eyes: (E.eyes || []).map(([x, y, r]) => ({ x: P(x, y)[0], y: P(x, y)[1], r: r * s, e: { type: 'real' } })), mouth: null, anchors, offsets: null };
  }
  const M = fishModel(c, infl);
  const S = M.S, L = M.L;
  const roll = (M.flat?.roll || 0) * DEG;
  const ky = roll ? Math.max(0.35, Math.abs(Math.cos(roll))) : 1;
  const P = (x, y) => [(x - M.xmin) * s, (M.ymax - y) * ky * s];
  const midU = 0.45;
  const mY = S.mouth ? M.botL(0.004) + (M.topL(0.004) - M.botL(0.004)) * (S.mouth.v ?? 0.45) : (M.topL(0) + M.botL(0)) / 2;
  const anchors = {
    mouth: P(M.xN + (M.bill ? M.bill.len * L * 0.6 : 0), mY),
    top: P(M.xN - 0.4 * L, M.topL(0.4) + 2),
    bottom: P(M.xN - midU * L, M.botL(midU) - 1),
    tail: P(M.xmin + 2, (M.topL(1) + M.botL(1)) / 2),
  };
  if (S.lure) anchors.lure = P(M.xN - S.lure.u * L + Math.cos(S.lure.ang * DEG) * S.lure.len * L, M.topL(S.lure.u) + Math.sin(S.lure.ang * DEG) * S.lure.len * L);
  const eyes = [];
  if (S.eye) {
    const u = S.eye.u ?? 0.08, v = S.eye.v ?? 0.62;
    const [x, y] = P(M.xN - u * L, M.botL(u) + (M.topL(u) - M.botL(u)) * v);
    eyes.push({ x, y, r: (S.eye.r ?? 0.03) * L * s, e: { type: 'real' } });
  }
  return { w: (M.xmax - M.xmin) * s, h: (M.ymax - M.ymin) * ky * s, ox: -M.xmin * s, oy: M.ymax * ky * s, eyes, mouth: null, anchors, offsets: null };
}

// ------------------------------------------------------------------ solid creatures

// Primitive voxeliser: ellipsoids (optionally oriented, shelled, clipped), tapered capsules and flat
// membranes, each with an albedo function and a voxel role; analytic normals per primitive.
class Solid {
  constructor() { this.prims = []; }
  // ellipsoid: c centre, r radii [rx, ry, rz], o: {col, role, glow, axes:[ex,ey,ez], shell, cut:{x0,x1,y0,y1,z0,z1}, under}
  ell(c, r, o) { this.prims.push({ t: 0, c, r, ...o }); return this; }
  // capsule a -> b with radii ra -> rb (lp)
  cap(a, b, ra, rb, o) { this.prims.push({ t: 1, a, b, ra, rb: rb ?? ra, ...o }); return this; }
  // polyline tube through pts [[x,y,z], ...] with radius fn k (0..1) -> r
  tube(pts, rad, o) {
    for (let i = 0; i < pts.length - 1; i++) this.cap(pts[i], pts[i + 1], rad(i / (pts.length - 1)), rad((i + 1) / (pts.length - 1)), { ...o, k0: i / (pts.length - 1), k1: (i + 1) / (pts.length - 1) });
    return this;
  }
  bounds() {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of this.prims) {
      if (p.t === 0) {
        const m = Math.max(p.r[0], p.r[1], p.r[2]);
        x0 = Math.min(x0, p.c[0] - m); x1 = Math.max(x1, p.c[0] + m); y0 = Math.min(y0, p.c[1] - m); y1 = Math.max(y1, p.c[1] + m); z0 = Math.min(z0, p.c[2] - m); z1 = Math.max(z1, p.c[2] + m);
      } else {
        const m = Math.max(p.ra, p.rb);
        for (const q of [p.a, p.b]) { x0 = Math.min(x0, q[0] - m); x1 = Math.max(x1, q[0] + m); y0 = Math.min(y0, q[1] - m); y1 = Math.max(y1, q[1] + m); z0 = Math.min(z0, q[2] - m); z1 = Math.max(z1, q[2] + m); }
      }
    }
    return { x0, x1, y0, y1, z0, z1 };
  }
}

// Inside test + normal for a primitive at model point (x, y, z); writes the normal into N, returns local
// coordinates info in Q (q0..q2 for ellipsoids, k along capsules) or false.
const Qv = [0, 0, 0, 0];
function primHit(p, x, y, z, N) {
  if (p.t === 0) {
    let dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
    let a = dx, b = dy, c = dz;
    if (p.axes) { const [e0, e1, e2] = p.axes; a = dx * e0[0] + dy * e0[1] + dz * e0[2]; b = dx * e1[0] + dy * e1[1] + dz * e1[2]; c = dx * e2[0] + dy * e2[1] + dz * e2[2]; }
    const qa = a / p.r[0], qb = b / p.r[1], qc = c / p.r[2];
    const d2 = qa * qa + qb * qb + qc * qc;
    if (d2 > 1) return false;
    if (p.shell && d2 < (1 - p.shell) * (1 - p.shell)) return false;
    const cu = p.cut;
    if (cu && ((cu.x0 != null && qa < cu.x0) || (cu.x1 != null && qa > cu.x1) || (cu.y0 != null && qb < cu.y0) || (cu.y1 != null && qb > cu.y1) || (cu.z0 != null && qc < cu.z0) || (cu.z1 != null && qc > cu.z1))) return false;
    if (N) {
      let nx = qa / p.r[0], ny = qb / p.r[1], nz = qc / p.r[2];
      if (p.axes) { const [e0, e1, e2] = p.axes; const X = nx * e0[0] + ny * e1[0] + nz * e2[0], Y = nx * e0[1] + ny * e1[1] + nz * e2[1], Z = nx * e0[2] + ny * e1[2] + nz * e2[2]; nx = X; ny = Y; nz = Z; }
      const l = Math.hypot(nx, ny, nz) || 1;
      N[0] = nx / l; N[1] = ny / l; N[2] = nz / l;
    }
    Qv[0] = qa; Qv[1] = qb; Qv[2] = qc; Qv[3] = Math.sqrt(d2);
    return true;
  }
  const ax = p.a[0], ay = p.a[1], az = p.a[2];
  const bx = p.b[0] - ax, by = p.b[1] - ay, bz = p.b[2] - az;
  const L2 = bx * bx + by * by + bz * bz || 1e-6;
  let k = ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / L2;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const cx = ax + bx * k, cy = ay + by * k, cz = az + bz * k;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const d = Math.hypot(dx, dy, dz);
  const rr = p.ra + (p.rb - p.ra) * k;
  if (d > rr) return false;
  if (N) { if (d > 1e-6) { N[0] = dx / d; N[1] = dy / d; N[2] = dz / d; } else { N[0] = 0; N[1] = 1; N[2] = 0; } }
  Qv[0] = k; Qv[1] = d / Math.max(1e-6, rr); Qv[2] = p.k0 != null ? p.k0 + (p.k1 - p.k0) * k : k; Qv[3] = dy / Math.max(1e-6, d);
  return true;
}

// Voxelise a Solid at r voxels per lp into the voxelfish grid format.
function voxelise(sol, r, pal, meta) {
  const B = sol.bounds();
  const PADV = 2;
  const NX = Math.ceil((B.x1 - B.x0) * r) + PADV * 2, NY = Math.ceil((B.y1 - B.y0) * r) + PADV * 2, NZ = Math.ceil((B.z1 - B.z0) * r) + PADV * 2;
  const NXY = NX * NY;
  const data = new Uint16Array(NXY * NZ), pid = new Uint8Array(NXY * NZ);
  const zmin = new Int16Array(NXY).fill(32767), zmax = new Int16Array(NXY).fill(-1);
  const toV = (x, y, z) => [(x - B.x0) * r + PADV, (y - B.y0) * r + PADV, (z - B.z0) * r + PADV];
  const cache = new Map();
  const pv = (col, role, gl) => { const k = (col >>> 0) * 64 + role * 2 + (gl ? 1 : 0); let v = cache.get(k); if (v === undefined) { v = pal.idx(col >>> 0, role, !!gl); cache.set(k, v); } return v; };
  sol.prims.forEach((p, pi) => {
    let x0, x1, y0, y1, z0, z1;
    if (p.t === 0) { const m = Math.max(p.r[0], p.r[1], p.r[2]); [x0, y0, z0] = toV(p.c[0] - m, p.c[1] - m, p.c[2] - m); [x1, y1, z1] = toV(p.c[0] + m, p.c[1] + m, p.c[2] + m); }
    else { const m = Math.max(p.ra, p.rb); [x0, y0, z0] = toV(Math.min(p.a[0], p.b[0]) - m, Math.min(p.a[1], p.b[1]) - m, Math.min(p.a[2], p.b[2]) - m); [x1, y1, z1] = toV(Math.max(p.a[0], p.b[0]) + m, Math.max(p.a[1], p.b[1]) + m, Math.max(p.a[2], p.b[2]) + m); }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); z0 = Math.max(0, Math.floor(z0));
    x1 = Math.min(NX - 1, Math.ceil(x1)); y1 = Math.min(NY - 1, Math.ceil(y1)); z1 = Math.min(NZ - 1, Math.ceil(z1));
    const thin = p.t === 1 && Math.max(p.ra, p.rb) * r < 0.75;
    const role = p.role ?? R_BODY;
    for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const x = B.x0 + (ix - PADV + 0.5) / r, y = B.y0 + (iy - PADV + 0.5) / r, z = B.z0 + (iz - PADV + 0.5) / r;
      let hit = primHit(p, x, y, z, null);
      if (!hit && thin) {
        // keep thin filaments connected: accept the voxel the segment passes through
        const q = { ...p, ra: Math.max(p.ra, 0.62 / r), rb: Math.max(p.rb, 0.62 / r) };
        hit = primHit(q, x, y, z, null);
      }
      if (!hit) continue;
      const vi = ix + iy * NX + iz * NXY;
      if (p.under && data[vi]) continue;
      const col = typeof p.col === 'function' ? p.col(Qv, x, y, z, ix, iy, iz) : p.col;
      if (col === null || col === undefined) continue;
      data[vi] = pv(col, typeof p.roleAt === 'function' ? p.roleAt(Qv) : role, typeof p.glow === 'function' ? p.glow(Qv) : !!p.glow);
      pid[vi] = pi + 1;
      const cc = ix + iy * NX;
      if (iz < zmin[cc]) zmin[cc] = iz;
      if (iz > zmax[cc]) zmax[cc] = iz;
    }
  });
  let x0 = NX, x1 = -1, y0 = NY, y1 = -1, z0 = NZ, z1 = -1;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const cc = x + y * NX;
    if (zmax[cc] < 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (zmin[cc] < z0) z0 = zmin[cc]; if (zmax[cc] > z1) z1 = zmax[cc];
  }
  if (x1 < 0) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 0; }
  const N = [0, 0, 0];
  const nf = (ix, iy, iz) => {
    const k = pid[ix + iy * NX + iz * NXY];
    if (!k) return null;
    const p = sol.prims[k - 1];
    if (p.flatN) return null;
    const x = B.x0 + (ix - PADV + 0.5) / r, y = B.y0 + (iy - PADV + 0.5) / r, z = B.z0 + (iz - PADV + 0.5) / r;
    primHit(p.t === 1 ? { ...p, ra: p.ra + 2 / r, rb: p.rb + 2 / r } : { ...p, shell: 0, cut: null, r: p.r.map((v) => v + 1.5 / r) }, x, y, z, N);
    return [N[0], N[1], N[2]];
  };
  const center = toV(0, 0, 0);
  const P3 = (q) => toV(q[0], q[1], q[2] ?? 0);
  const anchors = {};
  for (const [k, v] of Object.entries(meta.anchors || {})) anchors[k] = P3(v);
  return {
    Lo: { r, c: meta.c, real: true, solid: true, mat: meta.mat, M: null }, data, NX, NY, NZ, NXY, zmin, zmax, pal, x0, x1, y0, y1, z0, z1,
    srcOf: null, zOf: new Int16Array(NX), zc: center[2], mat: meta.mat, nf, roll: meta.roll || 0,
    center, eyes: (meta.eyes || []).map((e) => ({ x: 0, y: 0, r: e[3] || 1, rLook: e[3] || 1, e: { type: 'real' }, p: P3(e) })), eyes3: [], mouth: null, anchors,
    bytes: data.byteLength * 1.5 + NXY * 4,
  };
}

const P = (h) => packRGB(hexRGB(h));
const shadeP = (h, k) => packRGB(tone3([...hexRGB(h)], k));
const vnorm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// A natural eyeball as a primitive (dark pupil, iris ring, catchlight), looking along n.
function eyePrim(sol, c, rad, n, iris = '#c8a050', o = {}) {
  const e = { iris, pupil: o.pupil ?? 0.55 };
  const g = vnorm(...n);
  sol.ell(c, [rad, rad, rad], {
    role: R_EYE,
    col: (q) => {
      const l = Math.hypot(q[0], q[1], q[2]) || 1;
      const [col] = realEyeColor(e, q[0] / l, q[1] / l, q[2] / l, g);
      // catchlight: upper front of the cornea
      const h = (q[0] * (g[0] + 0.3) + q[1] * (g[1] + 0.55) + q[2] * (g[2] + 0.25)) / l;
      if (h > 1.05 && l > 0.7 && rad * 2 > 1.5) return 0xffffffff;
      return col;
    },
    roleAt: (q) => { const l = Math.hypot(q[0], q[1], q[2]) || 1; const h = (q[0] * (g[0] + 0.3) + q[1] * (g[1] + 0.55) + q[2] * (g[2] + 0.25)) / l; return h > 1.05 && l > 0.7 ? R_SPEC : R_EYE; },
    glow: !!o.glow,
  });
}

// ---- builders: each returns {sol, anchors, eyes, roll} for animation phase ph (0..1), in lp (L = body length)

const SOLIDS = {};

// Crab: a wide domed carapace with a toothed front edge, stalked eyes, chelipeds and four pairs of walking
// legs that step in an alternating gait. Front faces +x (the camera sees it near front-on).
SOLIDS.crab = (S, L, ph) => {
  const sol = new Solid();
  const W = L * (S.wide ?? 0.5), Hc = L * (S.domeH ?? 0.2), Dp = L * (S.depth ?? 0.32);
  const C = S.col;
  const top = hexRGB(C.back), side = hexRGB(C.flank), under = hexRGB(C.belly), leg = hexRGB(C.leg || C.flank), claw = hexRGB(C.claw || C.back), tip = hexRGB(C.tip || '#2a2024');
  const spots = C.spots ? hexRGB(C.spots) : null;
  const o3 = [0, 0, 0];
  const cy = L * 0.12;
  // carapace: a flattened dome, rim teeth along the front
  sol.ell([0, cy, 0], [Dp, Hc, W], {
    col: (q, x, y, z, ix, iy, iz) => {
      const v = clamp01((q[1] + 1) / 2);
      mix3(o3, under, side, smoothstep(0.15, 0.4, v));
      mix3(o3, o3, top, smoothstep(0.45, 0.75, v));
      if (spots && v > 0.45 && spotAt(x / L, z / L, 0.03, 0.55, 3) > 0.1) mix3(o3, o3, spots, 0.85);
      // granular shell texture + a groove pattern (cardiac region)
      tone3(o3, (hash2(ix * 7 + iz, iy * 3 + iz * 5, 9) - 0.5) * 0.07);
      if (Math.abs(q[2]) < 0.06 && q[0] < 0.2 && v > 0.6) tone3(o3, -0.12);
      if (Math.abs(Math.hypot(q[0] + 0.15, q[2]) - 0.55) < 0.04 && v > 0.55) tone3(o3, -0.1);
      return packRGB(o3);
    },
    cut: { y0: -0.55 },
  });
  sol.ell([0, cy - Hc * 0.35, 0], [Dp * 0.85, Hc * 0.45, W * 0.86], { col: P(C.belly), under: true });
  for (let k = -3; k <= 3; k++) {
    const a = (k / 3) * 0.9;
    sol.cap([Dp * 0.9 * Math.cos(a), cy + Hc * 0.15, W * 0.92 * Math.sin(a)], [Dp * 1.06 * Math.cos(a), cy + Hc * 0.2, W * 1.05 * Math.sin(a)], L * 0.022, L * 0.005, { col: P(C.back) });
  }
  // eye stalks + eyes
  for (const sd of [1, -1]) {
    const base = [Dp * 0.9, cy + Hc * 0.5, sd * W * 0.18];
    const eye = [Dp * 1.02, cy + Hc * (S.stalk ?? 1.2), sd * W * 0.24];
    sol.cap(base, eye, L * 0.025, L * 0.02, { col: P(C.leg || C.flank) });
    eyePrim(sol, eye, L * (S.eyeR ?? 0.035), [0.8, 0.3, sd * 0.5], C.eye || '#3a3020', { pupil: 0.7 });
  }
  // chelipeds (claws): merus -> carpus -> propodus with a fixed finger and a moving dactyl
  const clawK = S.claw ?? 1;
  for (const sd of [1, -1]) {
    const snap = 0.25 + 0.2 * Math.max(0, Math.sin(TAU * ph * 2 + (sd > 0 ? 0 : 1.5)));
    const s0 = [Dp * 0.7, cy - Hc * 0.2, sd * W * 0.55];
    const s1 = [Dp * 1.25, cy - Hc * 0.05, sd * W * 0.85];
    const s2 = [Dp * 1.55, cy + Hc * 0.05, sd * W * 0.55];
    sol.cap(s0, s1, L * 0.05 * clawK, L * 0.05 * clawK, { col: P(C.claw || C.back) });
    sol.cap(s1, s2, L * 0.055 * clawK, L * 0.06 * clawK, { col: P(C.claw || C.back) });
    // palm
    const pc = add3(s2, [L * 0.12 * clawK, 0, -sd * W * 0.06]);
    sol.ell(pc, [L * 0.14 * clawK, L * 0.09 * clawK, L * 0.07 * clawK], { col: (q) => packRGB(mix3(o3, claw, tone3([...claw], 0.25), smoothstep(-0.2, 0.8, q[1]))) });
    const f0 = add3(pc, [L * 0.12 * clawK, -L * 0.03 * clawK, 0]);
    sol.cap(f0, add3(f0, [L * 0.16 * clawK, -L * 0.03 * clawK, 0]), L * 0.035 * clawK, L * 0.008, { col: (q) => packRGB(q[0] > 0.6 ? tip : claw) });
    const d0 = add3(pc, [L * 0.1 * clawK, L * 0.05 * clawK, 0]);
    sol.cap(d0, add3(d0, [L * 0.17 * clawK * Math.cos(snap), L * 0.17 * clawK * Math.sin(snap) * 0.4, 0]), L * 0.032 * clawK, L * 0.008, { col: (q) => packRGB(q[0] > 0.6 ? tip : claw) });
  }
  // walking legs: 4 per side, three segments, alternating gait
  const legLen = L * (S.legLen ?? 0.42);
  for (const sd of [1, -1]) for (let i = 0; i < 4; i++) {
    const g = TAU * ph + i * Math.PI * 0.5 + (sd > 0 ? 0 : Math.PI);
    const lift = Math.max(0, Math.sin(g)) * L * 0.06, swing = Math.cos(g) * L * 0.05;
    const bx = Dp * (0.45 - i * 0.3);
    const root = [bx, cy - Hc * 0.25, sd * W * 0.82];
    const knee = [bx + swing - i * L * 0.03, cy + Hc * 0.35 + lift, sd * (W + legLen * 0.45)];
    const foot = [bx + swing * 1.4 - i * L * 0.05, cy - Hc * 1.25 - L * 0.02 + lift * 0.6, sd * (W + legLen * 0.85)];
    const r0 = L * 0.032, r1 = L * 0.026;
    sol.cap(root, knee, r0, r1, { col: P(C.leg || C.flank) });
    sol.cap(knee, foot, r1, L * 0.008, { col: (q) => packRGB(q[0] > 0.85 ? tip : leg) });
  }
  return { sol, anchors: { mouth: [Dp * 1.1, cy, 0], top: [0, cy + Hc * 1.2, 0], bottom: [0, cy - Hc * 1.6, 0], tail: [-Dp, cy, 0] }, eyes: [[Dp * 1.02, cy + Hc * 1.2, W * 0.24, L * 0.035]], yawBase: S.yawBase ?? 62 };
};

// Jellyfish: a translucent bell that pulses, a frilled margin, glowing gonads, oral arms and tentacles that
// trail and sway. Radially symmetric (bell up).
SOLIDS.jelly = (S, L, ph) => {
  const sol = new Solid();
  const C = S.col;
  const pulse = Math.sin(TAU * ph);
  const R = L * 0.5 * (1 + 0.06 * pulse), Hb = L * (S.bellH ?? 0.42) * (1 - 0.1 * pulse);
  const bell = hexRGB(C.back), rim = hexRGB(C.flank), gon = hexRGB(C.gonad || C.fin || C.flank);
  const o3 = [0, 0, 0];
  const top = L * 0.25;
  sol.ell([0, top, 0], [R, Hb, R], {
    role: R_GLASS, shell: S.shell ?? 0.22, cut: { y0: S.flat ? -0.05 : -0.1 },
    col: (q) => {
      const v = clamp01(q[1]);
      mix3(o3, rim, bell, smoothstep(0, 0.7, v));
      if (S.warts && hash2(Math.round(q[0] * 14), Math.round(q[2] * 14), 3) > 0.84 && v > 0.2) tone3(o3, 0.25);
      if (S.knob && v > 0.75) mix3(o3, o3, hexRGB(S.knob), smoothstep(0.75, 0.9, v));
      return packRGB(o3);
    },
    // bioluminescence lives in the warts / gonads / margin, the bell itself stays glassy
    glow: S.warts && S.glow ? (q) => hash2(Math.round(q[0] * 14), Math.round(q[2] * 14), 3) > 0.84 && q[1] > 0.2 : false,
  });
  // dome knob (fried-egg jelly) / gonads inside the bell
  if (S.knob) sol.ell([0, top + Hb * 0.55, 0], [R * 0.42, Hb * 0.42, R * 0.42], { col: P(S.knob), role: R_BODY });
  const ng = S.gonads ?? 4;
  for (let i = 0; i < ng; i++) {
    const a = (i / ng) * TAU + 0.4;
    sol.ell([Math.cos(a) * R * 0.32, top + Hb * 0.18, Math.sin(a) * R * 0.32], [R * 0.16, Hb * 0.12, R * 0.16], { col: packRGB(gon), role: R_BODY, glow: !!S.glow });
  }
  // margin: a ring of lappets
  const nm = 16;
  for (let i = 0; i < nm; i++) {
    const a = (i / nm) * TAU;
    sol.ell([Math.cos(a) * R * 0.97, top - Hb * 0.06, Math.sin(a) * R * 0.97], [R * 0.11, Hb * 0.09, R * 0.11], { col: packRGB(rim), role: R_GLASS, glow: !!S.glow });
  }
  // oral arms: thick frilly ribbons hanging from the centre
  const na = S.arms ?? 4;
  for (let i = 0; i < na; i++) {
    const a = (i / na) * TAU + 0.8;
    const pts = [];
    const len = L * (S.armLen ?? 0.9);
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const sway = Math.sin(TAU * ph - t * 3 + i) * L * 0.07 * t;
      pts.push([Math.cos(a) * R * (0.12 + 0.15 * t) + sway, top - Hb * 0.1 - len * t, Math.sin(a) * R * (0.12 + 0.15 * t) + sway * 0.5]);
    }
    sol.tube(pts, (t) => L * (S.armR ?? 0.07) * (1 - 0.6 * t) + L * 0.015, { role: R_GLASS, col: (q, x, y, z, ix, iy, iz) => packRGB(tone3(mix3(o3, gon, rim, 0.4), (hash2(ix, iy * 2 + iz, 5) - 0.5) * 0.3 + (S.armTip && q[2] > 0.7 ? 0 : 0))), glow: !!S.glow });
    if (S.armTip) sol.ell(pts[8], [L * 0.04, L * 0.04, L * 0.04], { col: P(S.armTip), role: R_BODY, glow: !!S.glow });
  }
  // tentacles: thin trailing filaments from the margin
  const nt = S.tentacles ?? 12;
  for (let i = 0; i < nt; i++) {
    const a = (i / nt) * TAU;
    const len = L * (S.tentLen ?? 1.4) * (0.75 + 0.25 * hash2(i, 3, 1));
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const sway = Math.sin(TAU * ph - t * 4 + i * 1.3) * L * 0.08 * t;
      pts.push([Math.cos(a) * R * (0.92 - 0.25 * t) + sway, top - Hb * 0.06 - len * t, Math.sin(a) * R * (0.92 - 0.25 * t)]);
    }
    sol.tube(pts, () => L * 0.008, { role: R_GLASS, col: packRGB(rim), glow: !!S.glow });
  }
  return { sol, anchors: { mouth: [0, top - Hb * 0.2, 0], top: [0, top + Hb, 0], bottom: [0, top - L * 0.9, 0], tail: [0, top - L, 0] }, eyes: [], yawBase: 0 };
};

// Dumbo octopus: a soft mantle with ear-like fins that flap, a webbed skirt of arms with cirri, natural eyes.
SOLIDS.octopus = (S, L, ph) => {
  const sol = new Solid();
  const C = S.col;
  const o3 = [0, 0, 0];
  const body = hexRGB(C.back), under = hexRGB(C.belly), fin = hexRGB(C.fin || C.flank);
  const flap = Math.sin(TAU * ph);
  const mh = L * 0.36;
  sol.ell([0, L * 0.2, 0], [L * 0.32, mh, L * 0.3], { col: (q, x, y, z, ix, iy, iz) => packRGB(tone3(mix3(o3, under, body, smoothstep(-0.6, 0.4, q[1])), (hash2(ix, iy, iz) - 0.5) * 0.05)) });
  // ear fins: paddles sticking out of the mantle sides, flapping up and down
  for (const sd of [1, -1]) {
    const a = 0.45 * flap + 0.25;
    const ax2 = vnorm(0, Math.sin(a), sd * Math.cos(a)); // fin length direction (out + up)
    const c0 = [-L * 0.02, L * 0.3, sd * L * 0.26];
    sol.ell(add3(c0, ax2, L * 0.13), [L * 0.11, L * 0.15, L * 0.035], { col: packRGB(fin), axes: [[1, 0, 0], ax2, vnorm(0, -sd * Math.cos(a), Math.sin(a))] });
  }
  // eyes
  for (const sd of [1, -1]) eyePrim(sol, [L * 0.2, L * 0.12, sd * L * 0.2], L * 0.06, [0.6, 0.15, sd * 0.8], C.eye || '#2a1a20', { pupil: 0.7 });
  // webbed arms: a skirt (flattened ellipsoid shell) plus eight arms
  const open = 0.5 + 0.5 * flap;
  // the web: an umbrella (shell of a squashed sphere, lower half) hanging under the mantle
  sol.ell([0, -L * 0.02, 0], [L * (0.34 + 0.06 * open), L * (0.3 - 0.06 * open), L * (0.34 + 0.06 * open)], { col: packRGB(mix3(o3, under, body, 0.35)), shell: 0.12, cut: { y1: -0.15 } });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const rr = L * (0.1 + (0.3 + 0.08 * open) * Math.sin(t * Math.PI * 0.55));
      pts.push([Math.cos(a) * rr, -L * 0.06 - L * (0.28 - 0.05 * open) * t, Math.sin(a) * rr]);
    }
    sol.tube(pts, (t) => L * 0.05 * (1 - 0.7 * t) + L * 0.008, { col: (q) => packRGB(q[3] < -0.3 ? under : body) });
  }
  return { sol, anchors: { mouth: [0, -L * 0.1, 0], top: [0, L * 0.6, 0], bottom: [0, -L * 0.3, 0], tail: [-L * 0.3, 0, 0] }, eyes: [[L * 0.2, L * 0.12, L * 0.2, L * 0.06]], yawBase: 35 };
};

// Vampire squid: a velvety mantle with paddle fins, eight arms joined by a dark web, huge blue eyes.
SOLIDS.squid = (S, L, ph) => {
  const sol = new Solid();
  const C = S.col;
  const o3 = [0, 0, 0];
  const body = hexRGB(C.back), web = hexRGB(C.fin || C.back), under = hexRGB(C.belly);
  const flap = Math.sin(TAU * ph);
  sol.ell([-L * 0.18, 0, 0], [L * 0.34, L * 0.22, L * 0.22], { col: (q, x, y, z, ix, iy, iz) => packRGB(tone3(mix3(o3, under, body, smoothstep(-0.7, 0.2, q[1])), (hash2(ix, iy, iz) - 0.5) * 0.06)) });
  for (const sd of [1, -1]) {
    const a = 0.3 * flap;
    sol.ell([-L * 0.38, L * 0.04, sd * L * 0.22], [L * 0.1, L * 0.035, L * 0.12], { col: P(C.back), axes: [[1, 0, 0], vnorm(0, Math.cos(a), sd * Math.sin(a)), vnorm(0, -sd * Math.sin(a), Math.cos(a))] });
    if (S.photo) sol.ell([-L * 0.44, L * 0.06, sd * L * 0.27], [L * 0.03, L * 0.03, L * 0.03], { col: P(S.photo), role: R_EYE, glow: true });
  }
  for (const sd of [1, -1]) eyePrim(sol, [L * 0.12, L * 0.07, sd * L * 0.15], L * 0.065, [0.5, 0.2, sd * 0.85], C.eye || '#3a8aff', { pupil: 0.62 });
  // arms + web: a cloak opening and closing
  const open = 0.55 + 0.45 * Math.sin(TAU * ph + 1);
  sol.ell([L * 0.32, -L * 0.02, 0], [L * 0.2, L * (0.14 + 0.1 * open), L * (0.14 + 0.1 * open)], { col: packRGB(web), shell: 0.3, cut: { x0: -0.3 } });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const rr = L * (0.08 + (0.18 + 0.14 * open) * t);
      pts.push([L * (0.2 + 0.32 * t), Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    sol.tube(pts, (t) => L * 0.03 * (1 - 0.6 * t) + L * 0.008, { col: (q) => packRGB(q[2] > 0.85 ? hexRGB(S.armTip || C.back) : web) });
  }
  return { sol, anchors: { mouth: [L * 0.5, 0, 0], top: [0, L * 0.25, 0], bottom: [0, -L * 0.25, 0], tail: [-L * 0.5, 0, 0] }, eyes: [[L * 0.12, L * 0.07, L * 0.15, L * 0.065]], yawBase: 18 };
};

// Starfish: five tapering arms around a central disc, a pebbly texture, tube feet stepping underneath.
// Built in the side map plane and rolled so its back faces the camera.
SOLIDS.star = (S, L, ph) => {
  const sol = new Solid();
  const C = S.col;
  const o3 = [0, 0, 0];
  const top = hexRGB(C.back), side = hexRGB(C.flank), under = hexRGB(C.belly), bump = hexRGB(C.spots || C.flank);
  const R = L * 0.5;
  sol.ell([0, 0, 0], [R * 0.3, R * 0.3, L * 0.09], { col: (q, x, y, z, ix, iy, iz) => packRGB(q[2] < -0.2 ? under : hash2(ix * 3, iy * 5 + iz, 2) > 0.78 ? bump : mix3(o3, side, top, smoothstep(-0.2, 0.6, q[2]))) });
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i / 5) * TAU;
    const curl = 0.08 * Math.sin(TAU * ph + i * 1.3);
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      pts.push([Math.cos(a + curl * t) * R * (0.15 + 0.85 * t), Math.sin(a + curl * t) * R * (0.15 + 0.85 * t), L * 0.02 * Math.sin(t * 3 + ph * 6)]);
    }
    sol.tube(pts, (t) => L * 0.1 * (1 - 0.72 * t) + L * 0.012, {
      col: (q, x, y, z, ix, iy, iz) => {
        const up = (z - pts[0][2]) / (L * 0.1);
        if (up < -0.35) return packRGB(under);
        mix3(o3, side, top, smoothstep(-0.1, 0.5, q[3] * 0 + up));
        if (hash2(ix * 3 + iz, iy * 5, 2) > 0.8) mix3(o3, o3, bump, 0.9);
        return packRGB(o3);
      },
    });
  }
  return { sol, anchors: { mouth: [R * 0.3, 0, 0], top: [0, R, 0], bottom: [0, -R, 0], tail: [-R, 0, 0] }, eyes: [], roll: -62, yawBase: 0 };
};

// Giant isopod: a segmented, armoured dorsal shield (overlapping plates), a fan tail, antennae and seven pairs
// of walking legs underneath.
SOLIDS.isopod = (S, L, ph) => {
  const sol = new Solid();
  const C = S.col;
  const o3 = [0, 0, 0];
  const top = hexRGB(C.back), side = hexRGB(C.flank), under = hexRGB(C.belly);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = L * (0.36 - t * 0.72);
    const w = L * (0.22 + 0.06 * Math.sin(t * Math.PI)) * (i === 0 ? 0.85 : 1);
    sol.ell([x, 0, 0], [L * 0.07, L * 0.14, w], {
      col: (q, X, Y, Z, ix, iy, iz) => {
        mix3(o3, under, side, smoothstep(-0.6, -0.1, q[1]));
        mix3(o3, o3, top, smoothstep(0.1, 0.7, q[1]));
        if (q[0] < -0.6 && q[1] > 0) tone3(o3, -0.18); // plate edge
        tone3(o3, (hash2(ix, iy * 3 + iz, 4) - 0.5) * 0.06);
        return packRGB(o3);
      },
      cut: { y0: -0.5 },
    });
  }
  // pleotelson (tail fan)
  sol.ell([-L * 0.44, -L * 0.01, 0], [L * 0.1, L * 0.06, L * 0.16], { col: P(C.back) });
  for (const sd of [1, -1]) sol.ell([-L * 0.5, -L * 0.03, sd * L * 0.11], [L * 0.08, L * 0.02, L * 0.04], { col: P(C.flank) });
  // head, eyes, antennae
  sol.ell([L * 0.42, -L * 0.01, 0], [L * 0.07, L * 0.1, L * 0.15], { col: P(C.back) });
  for (const sd of [1, -1]) {
    sol.ell([L * 0.44, L * 0.03, sd * L * 0.12], [L * 0.035, L * 0.045, L * 0.04], { col: P(C.eye || '#2a2a24'), role: R_EYE });
    const sw = 0.1 * Math.sin(TAU * ph + (sd > 0 ? 0 : 1));
    sol.tube([[L * 0.47, -L * 0.02, sd * L * 0.06], [L * 0.62, L * 0.0 + L * 0.04 * sw, sd * L * 0.14], [L * 0.75, -L * 0.06, sd * L * 0.24]], (t) => L * 0.014 * (1 - 0.6 * t) + L * 0.004, { col: P(C.flank) });
  }
  // legs (7 pairs) under the body, stepping
  for (let i = 0; i < 7; i++) for (const sd of [1, -1]) {
    const g = TAU * ph + i * 0.9 + (sd > 0 ? 0 : Math.PI);
    const x = L * (0.3 - i * 0.09);
    const lift = Math.max(0, Math.sin(g)) * L * 0.03, sw = Math.cos(g) * L * 0.03;
    sol.tube([[x, -L * 0.06, sd * L * 0.15], [x + sw, -L * 0.1 + lift, sd * L * 0.27], [x + sw * 1.4, -L * 0.18 + lift, sd * L * 0.3]], (t) => L * 0.016 * (1 - 0.5 * t) + L * 0.004, { col: P(C.belly) });
  }
  return { sol, anchors: { mouth: [L * 0.48, -L * 0.05, 0], top: [0, L * 0.16, 0], bottom: [0, -L * 0.2, 0], tail: [-L * 0.55, 0, 0] }, eyes: [[L * 0.44, L * 0.03, L * 0.12, L * 0.04]], yawBase: 20 };
};

// Seahorse: an upright, ringed trunk, a coronet, a long tube snout, a coiled prehensile tail, a fluttering
// dorsal fin and small pectoral fins behind the head.
SOLIDS.seahorse = (S, L, ph) => {
  const sol = new Solid();
  const C = S.col;
  const o3 = [0, 0, 0];
  const body = hexRGB(C.flank), back = hexRGB(C.back), belly = hexRGB(C.belly);
  const Hh = L; // L here = height of the animal
  // spine curve: head at the top, trunk, belly bulge, tail coiling forward at the bottom
  const sp = [];
  for (let k = 0; k <= 22; k++) {
    const t = k / 22;
    let x, y;
    if (t < 0.45) { x = -Hh * 0.06 * Math.sin(t / 0.45 * Math.PI * 0.8); y = Hh * (0.32 - t * 0.9); }
    else { const a = (t - 0.45) / 0.55 * Math.PI * 1.7; const rr = Hh * 0.17 * (1 - (t - 0.45) * 0.9); x = -Hh * 0.06 + Math.sin(a) * rr * 1.1 - rr * 0.1; y = Hh * (0.32 - 0.405) - Hh * 0.08 - (1 - Math.cos(a)) * rr * 0.9; }
    sp.push([x, y, 0]);
  }
  const rad = (t) => (t < 0.08 ? Hh * 0.07 : t < 0.45 ? Hh * (0.085 + 0.03 * Math.sin((t - 0.08) / 0.37 * Math.PI)) : Hh * 0.085 * Math.pow(1 - (t - 0.45) / 0.55, 0.9) + Hh * 0.01);
  sol.tube(sp, rad, {
    col: (q, x, y, z, ix, iy, iz) => {
      // bony rings + countershading (front of the trunk paler)
      const t = q[2];
      mix3(o3, body, back, smoothstep(0.2, 0.9, -q[3] * 0 + (x < sp[Math.round(t * 22)][0] ? 1 : 0) * 0.6));
      if (x > sp[Math.round(t * 22)][0] + rad(t) * 0.4 && t < 0.45) mix3(o3, o3, belly, 0.7);
      if (((t * 60) % 1) < 0.22) tone3(o3, -0.16);
      if (hash2(ix, iy, iz + 3) > 0.9) tone3(o3, 0.22);
      return packRGB(o3);
    },
  });
  // head + snout + coronet
  const hc = [Hh * 0.06, Hh * 0.36, 0];
  sol.ell(hc, [Hh * 0.1, Hh * 0.075, Hh * 0.07], { col: P(C.flank) });
  sol.cap(add3(hc, [Hh * 0.06, -Hh * 0.01, 0]), add3(hc, [Hh * 0.24, -Hh * 0.06, 0]), Hh * 0.035, Hh * 0.028, { col: P(C.flank) });
  sol.cap(add3(hc, [-Hh * 0.02, Hh * 0.05, 0]), add3(hc, [-Hh * 0.04, Hh * 0.13, 0]), Hh * 0.03, Hh * 0.02, { col: P(C.back) });
  for (const sd of [1, -1]) eyePrim(sol, add3(hc, [Hh * 0.02, Hh * 0.02, sd * Hh * 0.055]), Hh * 0.03, [0.4, 0.2, sd], C.eye || '#c89030', { pupil: 0.5 });
  // dorsal fin flutter (on the back of the trunk) + pectorals
  const fin = hexRGB(C.fin || C.flank);
  for (let k = 0; k < 7; k++) {
    const t = 0.22 + k * 0.025;
    const p0 = sp[Math.round(t * 22)];
    const fl = Math.sin(TAU * ph * 2 + k * 0.9) * Hh * 0.02;
    sol.cap([p0[0] - rad(t) * 0.8, p0[1], 0], [p0[0] - rad(t) - Hh * 0.08, p0[1] + Hh * 0.01, fl], Hh * 0.01, Hh * 0.006, { col: packRGB(fin), role: R_FIN });
  }
  for (const sd of [1, -1]) sol.ell(add3(hc, [-Hh * 0.08, -Hh * 0.04, sd * Hh * 0.075]), [Hh * 0.03, Hh * 0.04, Hh * 0.008], { col: packRGB(fin), role: R_FIN });
  return { sol, anchors: { mouth: [hc[0] + Hh * 0.25, hc[1] - Hh * 0.06, 0], top: [0, Hh * 0.5, 0], bottom: [0, -Hh * 0.45, 0], tail: [0, -Hh * 0.3, 0] }, eyes: [[hc[0] + Hh * 0.02, hc[1] + Hh * 0.02, Hh * 0.055, Hh * 0.03]], yawBase: 20 };
};

// Wakka chomper: the one playful round fish, a glossy sphere with a wedge mouth that chomps, realistic
// scales, a natural eye, a little tail and fins.
SOLIDS.chomper = (S, L, ph) => {
  const sol = new Solid();
  const C = S.col;
  const o3 = [0, 0, 0];
  const back = hexRGB(C.back), flank = hexRGB(C.flank), belly = hexRGB(C.belly);
  const R = L * 0.5;
  const gape = (0.12 + 0.55 * Math.abs(Math.sin(Math.PI * ph))) * 0.62; // half angle (rad)
  sol.ell([0, 0, 0], [R, R, R], {
    col: (q, x, y, z, ix, iy, iz) => {
      // mouth wedge cut-out (inner mouth darker)
      const a = Math.atan2(q[1], q[0]);
      if (q[0] > 0 && Math.abs(a) < gape) return null;
      const v = (q[1] + 1) / 2;
      mix3(o3, belly, flank, smoothstep(0.2, 0.45, v));
      mix3(o3, o3, back, smoothstep(0.6, 0.85, v));
      // scale rows
      const sa = Math.atan2(q[2], q[0]) * 5, sb = q[1] * 6;
      const row = Math.floor(sb), fa = (sa + (row & 1) * 0.5) % 1, fb = sb - row;
      if (Math.hypot(((fa + 1) % 1) - 0.55, (fb - 0.5) * 1.2) > 0.48) tone3(o3, -0.1);
      return packRGB(o3);
    },
  });
  // mouth interior
  sol.ell([R * 0.05, 0, 0], [R * 0.9, R * 0.9, R * 0.9], { col: (q) => (Math.abs(Math.atan2(q[1], q[0])) < gape && q[0] > 0 ? P('#4a1426') : null), under: true, role: R_MOUTH });
  for (const sd of [1, -1]) eyePrim(sol, [R * 0.38, R * 0.5, sd * R * 0.66], R * 0.17, [0.45, 0.3, sd * 0.85], C.eye || '#d8a040', { pupil: 0.55 });
  const finC = hexRGB(C.fin || C.flank);
  // tail fin + dorsal + pectoral
  for (let k = -4; k <= 4; k++) {
    const sw = Math.sin(TAU * ph) * R * 0.15;
    sol.cap([-R * 0.92, 0, 0], [-R * 1.45, k * R * 0.11, sw], R * 0.045, R * 0.03, { col: packRGB(finC), role: R_FIN });
  }
  for (let k = 0; k < 5; k++) sol.cap([-R * 0.1 - k * R * 0.12, R * 0.95, 0], [-R * 0.25 - k * R * 0.14, R * 1.28 - k * R * 0.03, 0], R * 0.04, R * 0.025, { col: packRGB(C.dorsal ? hexRGB(C.dorsal) : finC), role: R_FIN });
  return { sol, anchors: { mouth: [R, 0, 0], top: [0, R * 1.2, 0], bottom: [0, -R, 0], tail: [-R * 1.4, 0, 0] }, eyes: [[R * 0.38, R * 0.5, R * 0.66, R * 0.17]], yawBase: 0 };
};

const solidCache = new Map();
function solidSpec(c, ph) {
  const S = c.real;
  const fn = SOLIDS[S.kind] || SOLIDS.crab;
  return fn(S, S.size ?? (S.kind === 'seahorse' ? Math.max(c.L, c.H) : c.L), ph);
}

/** Base yaw of a realistic creature's side view (rays / flatfish lie flat, crabs face the camera). */
export function realYawBase(c) {
  if (!c.real) return undefined;
  if (c.real.yawBase != null) return c.real.yawBase;
  if (c.real.plan === 'solid') return solidExtents(c).yawBase;
  if (c.real.flat) return 0;
  return undefined;
}

// Chain body segment colour (eels): countershaded, with an optional per-ring pattern. dx, dy in -1..1
// (painter coords, y down), x / y = pixel coords of the ball sprite.
export function realSegColor(c, dx, dy, x, y) {
  const g = c.real.seg || {};
  if (!g._t) { g._t = hexRGB(g.top || c.real.col.back); g._s = hexRGB(g.side || c.real.col.flank); g._b = hexRGB(g.belly || c.real.col.belly); g._2 = g.col2 ? hexRGB(g.col2) : null; }
  const o = [0, 0, 0];
  const v = (dy + 1) / 2; // 0 top .. 1 bottom
  mix3(o, g._t, g._s, smoothstep(0.15, 0.45, v));
  mix3(o, o, g._b, smoothstep(0.6, 0.8, v));
  if (g._2) {
    if (g.pattern === 'stripes' && (Math.abs(v - 0.3) < 0.07 || Math.abs(v - 0.62) < 0.06)) mix3(o, o, g._2, 1);
    else if (g.pattern === 'spots' && hash2(x >> 1, y >> 1, 7) > 0.8 && v < 0.7) mix3(o, o, g._2, 1);
    else if (g.pattern === 'dots' && hash2(x, y, 9) > 0.9 && v < 0.6) mix3(o, o, g._2, 1);
  }
  tone3(o, (hash2(x, y, 3) - 0.5) * 0.05);
  return packRGB(o);
}

export function solidExtents(c) {
  const key = c._vid || c.id;
  let E = solidCache.get(key);
  if (E && E.c === c) return E;
  const sp = solidSpec(c, 0);
  const B = sp.sol.bounds();
  const roll = (sp.roll || 0) * DEG;
  const ky = roll ? Math.max(0.4, Math.abs(Math.cos(roll))) : 1;
  E = { c, x0: B.x0, x1: B.x1, y0: B.y0 * ky, y1: B.y1 * ky, mouth: sp.anchors.mouth, eyes: (sp.eyes || []).map((e) => [e[0], e[1], e[3] || 1]), yawBase: sp.yawBase, roll: sp.roll || 0 };
  solidCache.set(key, E);
  if (solidCache.size > 400) solidCache.delete(solidCache.keys().next().value);
  return E;
}

/** Build the voxel grid of a solid creature for animation frame kf (0..SWIM_FRAMES-1). */
export function solidGrid(Lo, kf) {
  const c = Lo.c;
  const sp = solidSpec(c, kf / SWIM_FRAMES);
  return voxelise(sp.sol, Lo.r, Lo.pal, { c, mat: Lo.mat, anchors: sp.anchors, eyes: sp.eyes, roll: sp.roll });
}
