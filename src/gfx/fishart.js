// Procedural pixel-art fish rasteriser.
//
// Every output pixel is inverse-mapped into the fish's local space and tested
// against the body profile, fins, tail, eyes and extras. That lets us render
// clean pixel art at any rotation / scale / animation phase, then cache it.
// The fish faces +x (right); local y points down; origin = body centre.

import { TAU, clamp, clamp01, lerp, smoothstep, bayer, hash2, noise2, fract } from '../core/math.js';
import { pack, ramp, shade, mix, adjust, invert, hexToHsl, hslToHex } from '../core/color.js';
import { PixelBuffer } from './pixel.js';

const SHAPES = {
  oval: { nose: 2.2, peak: 0.4, tailW: 0.3, taper: 1 },
  torpedo: { nose: 1.6, peak: 0.35, tailW: 0.22, taper: 0.9 },
  round: { nose: 3.2, peak: 0.48, tailW: 0.35, taper: 1.3 },
  disc: { nose: 2.6, peak: 0.45, tailW: 0.25, taper: 1.1 },
  long: { nose: 1.8, peak: 0.25, tailW: 0.45, taper: 0.6 },
  box: { nose: 6, peak: 0.3, tailW: 0.4, taper: 1.6 },
  blunt: { nose: 4.5, peak: 0.3, tailW: 0.3, taper: 1 },
  pointy: { nose: 1.2, peak: 0.45, tailW: 0.25, taper: 1 },
};

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
    default:
      break;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Compile a look description into a fast raster spec.

export function compileLook(look, variant = null) {
  const b = look.body || {};
  const shape = { ...SHAPES[b.shape || 'oval'], ...b };
  const col = look.col || {};
  const vc = (h, role) => variantColor(h, variant, role);
  const bodyHex = vc(col.body || '#ff9944');
  const backHex = vc(col.back || shade(col.body || '#ff9944', -0.25));
  const bellyHex = vc(col.belly || shade(col.body || '#ff9944', 0.45));
  const finHex = vc(col.fin || shade(col.body || '#ff9944', 0.1));
  const contrast = look.contrast ?? 1;
  const toRamp = (hex) => ramp(hex, contrast).map((h) => pack(h));
  const c = {
    kind: look.kind || 'fish',
    look,
    variant,
    L: b.len ?? 16,
    H: b.h ?? 9,
    shape,
    hump: b.hump ?? 0,
    belly: b.belly ?? 0.05,
    wave: b.wave ?? 0.5,
    bodyR: toRamp(bodyHex),
    backR: toRamp(backHex),
    bellyR: toRamp(bellyHex),
    finR: toRamp(finHex),
    bodyHex,
    finHex,
    outline: col.outline ? pack(vc(col.outline)) : null,
    outlineHex: col.outline ? vc(col.outline) : shade(backHex, -0.75),
    alpha: look.translucent ? Math.round(255 * (look.translucent === true ? 0.5 : look.translucent)) : 255,
    finAlpha: look.finAlpha ?? 0.75,
    scales: look.scales ?? (b.len ?? 16) >= 18,
    shine: look.shine ?? true,
    patterns: (look.pattern || []).map((p) => ({ ...p, R: toRamp(vc(p.color || '#ffffff', 'pattern')) })),
    tail: { type: 'fork', len: (b.len ?? 16) * 0.38, spread: (b.h ?? 9) * 0.55, flap: 0.32, ...(look.tail || {}) },
    fins: [],
    eyes: [],
    mouth: { type: 'small', v: 0.18, ...(look.mouth || {}) },
    extras: (look.extras || []).map((e) => ({ ...e })),
    glow: false,
  };
  c.tail.R = toRamp(vc(look.tail?.color || finHex));
  c.mouth.R = toRamp(vc(look.mouth?.color || '#e86a7a'));

  const fin = (spec, slot) => {
    if (!spec || spec.type === 'none') return;
    c.fins.push({
      slot,
      type: spec.type || 'tri',
      from: spec.from ?? 0.3,
      to: spec.to ?? 0.65,
      h: spec.h ?? c.H * 0.4,
      lean: spec.lean ?? 0.6,
      R: toRamp(vc(spec.color || finHex)),
      rays: spec.rays ?? true,
      count: spec.count ?? 4,
    });
  };
  fin(look.dorsal === undefined ? { type: 'tri' } : look.dorsal, 'top');
  fin(look.anal === undefined ? { type: 'tri', from: 0.55, to: 0.78, h: c.H * 0.25 } : look.anal, 'bottom');
  if (look.dorsal2) fin(look.dorsal2, 'top');
  c.pectoral = look.pectoral === null ? null : {
    u: 0.34, v: 0.25, len: Math.max(2.5, c.H * 0.38), w: 0.42, angle: 0.5, ...(look.pectoral || {}),
  };
  if (c.pectoral) c.pectoral.R = toRamp(vc(look.pectoral?.color || finHex));

  const eye = { u: 0.17, v: -0.2, r: Math.max(1, c.H * 0.16), type: 'normal', ...(look.eye || {}) };
  const eyeCol = vc(eye.color || '#1a1424', 'eye');
  const irisCol = eye.iris ? vc(eye.iris, 'eye') : null;
  c.eyes.push({ ...eye, pupil: pack(eyeCol), iris: irisCol ? pack(irisCol) : null, glowHex: eye.type === 'glow' ? vc(eye.glow || '#9ffcff', 'eye') : null });
  for (const e of look.moreEyes || []) {
    c.eyes.push({ type: 'normal', ...e, pupil: pack(vc(e.color || eye.color || '#1a1424', 'eye')), iris: e.iris ? pack(vc(e.iris, 'eye')) : null, glowHex: e.type === 'glow' ? vc(e.glow || '#9ffcff', 'eye') : null });
  }
  for (const e of c.eyes) if (e.type === 'glow') c.glow = true;
  for (const p of c.patterns) if (p.glow) c.glow = true;
  for (const e of c.extras) {
    if (e.color) e.P = pack(vc(e.color, 'extra'));
    if (e.color2) e.P2 = pack(vc(e.color2, 'extra'));
    if (e.glow) c.glow = true;
  }
  if (variant?.mutation === 'neon') c.glow = true;
  if (variant?.mutation === 'galaxy') {
    c.patterns.push({ type: 'galaxy', R: toRamp('#2a1b55') });
  }
  if (variant?.pattern) {
    const pc = variant.patternColor || shade(bodyHex, variant.pattern === 'spots' ? 0.5 : -0.45);
    c.patterns.push({ type: variant.pattern, color: pc, R: toRamp(pc), count: 3, size: 1.4, seed: variant.seed || 3 });
  }
  c.outlineP = c.outline ?? pack(c.outlineHex);
  return c;
}

// ---------------------------------------------------------------------------
// Body profile helpers.

function profile(c, u, inflate) {
  const s = c.shape;
  let peak = s.peak, nose = s.nose, tailW = s.tailW, taper = s.taper;
  if (inflate > 0) {
    peak = lerp(peak, 0.5, inflate);
    nose = lerp(nose, 2.4, inflate);
    tailW = lerp(tailW, 0.2, inflate);
    taper = lerp(taper, 1.6, inflate);
  }
  if (u < 0 || u > 1) return 0;
  if (u <= peak) {
    const t = u / peak;
    return Math.pow(1 - Math.pow(1 - t, nose), 1 / nose);
  }
  const t = (u - peak) / (1 - peak);
  return tailW + (1 - tailW) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * t), taper);
}

function finShape(type, t, phase, count) {
  switch (type) {
    case 'sail': return Math.pow(Math.sin(Math.PI * clamp01(t)), 0.6);
    case 'spiky': return (0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * count))) * Math.sin(Math.PI * clamp01(t)) ** 0.3;
    case 'long': return Math.min(1, t * 6, (1 - t) * 5);
    case 'round': return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    case 'wave': return Math.min(1, t * 6, (1 - t) * 5) * (0.75 + 0.25 * Math.sin(t * 9 - phase * TAU * 2));
    case 'tri':
    default:
      return t < 0.28 ? t / 0.28 : Math.pow((1 - t) / 0.72, 0.85);
  }
}

// Tail membership test. a: distance behind the tail base (>=0), b: perpendicular offset.
function tailHit(type, a, b, TL, TS, base, phase) {
  if (a < -0.5) return false;
  const s = a / TL;
  if (s > 1.08) return false;
  const ab = Math.abs(b);
  switch (type) {
    case 'none': return false;
    case 'round': {
      if (s > 1) return false;
      const outer = base + (TS - base) * Math.sqrt(Math.max(0, s)) * 1.05;
      return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 2 * 0.25;
    }
    case 'veil': {
      const edge = 1 + 0.1 * Math.sin(b * 1.3 + phase * TAU);
      if (s > edge) return false;
      const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.45) * 1.1;
      return ab <= outer;
    }
    case 'truncate': {
      if (s > 1) return false;
      return ab <= base + (TS - base) * s;
    }
    case 'lyre': {
      if (s > 1) return false;
      const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.55);
      const inner = s < 0.35 ? -1 : (outer - 1.6) * smoothstep(0.35, 0.8, s);
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

// ---------------------------------------------------------------------------
// Main raster entry. Returns { canvas, ox, oy, anchors, glowCanvas }.

export function rasterFish(c, p = {}) {
  switch (c.kind) {
    case 'crab': return rasterCrab(c, p);
    case 'jelly': return rasterJelly(c, p);
    case 'pudding': return rasterPudding(c, p);
    case 'seahorse': return rasterSeahorse(c, p);
    case 'ray': return rasterRay(c, p);
    case 'squid': return rasterSquid(c, p);
    case 'isopod': return rasterIsopod(c, p);
    case 'blob': return rasterBlob(c, p);
    case 'iconfish': return rasterIconFish(c, p);
    default: return rasterGeneric(c, p);
  }
}

function makeXform(angle, scale, ox, oy) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  return {
    toLocal(px, py) {
      const dx = px + 0.5 - ox, dy = py + 0.5 - oy;
      return [(dx * ca + dy * sa) / scale, (-dx * sa + dy * ca) / scale];
    },
    toCanvas(lx, ly) {
      const x = lx * scale, y = ly * scale;
      return [ox + x * ca - y * sa, oy + x * sa + y * ca];
    },
  };
}

function boundsFor(extent, angle, scale) {
  // extent: [minX, minY, maxX, maxY] in local units
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

function rampPick(R, b, x, y, dither = 0.85) {
  const idx = clamp(Math.floor(b * 4.999 + (bayer(x, y) - 0.5) * dither), 0, 4);
  return R[idx];
}

function rasterGeneric(c, p) {
  const phase = p.phase || 0;
  const scale = p.scale || 1;
  const angle = p.angle || 0;
  const inflate = p.inflate || 0;
  const L = c.L * (1 + 0.3 * inflate);
  const H = c.H * (1 + 1.0 * inflate);
  const halfL = L / 2;
  const TL = c.tail.type === 'none' ? 0 : c.tail.len * (1 - 0.2 * inflate);
  const TS = c.tail.spread;
  const spikeLen = c.look.spikes ? c.look.spikes * inflate : 0;

  let maxFin = 0;
  for (const f of c.fins) maxFin = Math.max(maxFin, f.h);
  let exTop = 0, exFront = 0;
  for (const e of c.extras) {
    if (e.type === 'lure') { exTop = Math.max(exTop, e.h ?? H * 0.9); exFront = Math.max(exFront, e.reach ?? L * 0.35); }
    if (e.type === 'whiskers') exFront = Math.max(exFront, 2);
    if (e.type === 'cap' || e.type === 'antennae') exTop = Math.max(exTop, 4);
  }
  const extent = [
    -halfL - TL - 2,
    -H / 2 - maxFin - exTop - spikeLen - 2,
    halfL + exFront + 2,
    H / 2 + maxFin + spikeLen + 3,
  ];
  if (c.pectoral) extent[3] = Math.max(extent[3], H / 2 + c.pectoral.len);
  const bb = boundsFor(extent, angle, scale);
  const buf = new PixelBuffer(bb.w, bb.h);
  const glow = c.glow ? new PixelBuffer(bb.w, bb.h) : null;
  const X = makeXform(angle, scale, bb.ox, bb.oy);

  const wave = c.wave * (p.still ? 0 : 1);
  const spine = (u) => wave * Math.sin(TAU * phase - u * 3.2) * u * u;
  const halfTop = (u) => (H / 2) * profile(c, u, inflate) * (1 + c.hump * Math.sin(Math.PI * clamp01(u * 1.4)));
  const halfBot = (u) => (H / 2) * profile(c, u, inflate) * (1 + c.belly * Math.sin(Math.PI * clamp01(u * 1.2)));

  // tail transform
  const flapA = p.still ? 0 : Math.sin(TAU * phase + 0.7) * c.tail.flap;
  const fore = p.still ? 1 : 1 - 0.22 * Math.abs(Math.sin(TAU * phase + 0.7));
  const t0x = -halfL, t0y = spine(1);
  const tbx = -Math.cos(flapA), tby = Math.sin(flapA);
  const tpx = Math.sin(flapA), tpy = Math.cos(flapA);
  const tailBase = Math.max(0.8, halfTop(0.985) * 0.9);

  // pectoral transform
  const pec = c.pectoral;
  let pecX = 0, pecY = 0, pecA = 0;
  if (pec) {
    pecX = halfL - pec.u * L;
    const hu = pec.u;
    pecY = spine(hu) + pec.v * halfBot(hu);
    pecA = pec.angle + (p.still ? 0 : Math.sin(TAU * phase * 2) * 0.45);
  }

  // eye positions
  const eyes = c.eyes.map((e) => {
    const ex = halfL - e.u * L;
    const ey = spine(e.u) + e.v * (e.v < 0 ? halfTop(e.u) : halfBot(e.u));
    return { ...e, x: ex, y: ey, r: e.r * (1 + 0.15 * inflate) };
  });

  const mouthX = halfL, mouthY = spine(0) + c.mouth.v * (H / 2) * 0.6;
  const mouthOpen = p.mouth || 0;

  const alphaBody = c.alpha;
  const shiny = c.variant?.shiny;
  const blink = p.blink;
  const expr = p.expr || 'normal';
  const sil = !!p.silhouette;

  for (let py = 0; py < bb.h; py++) {
    for (let px = 0; px < bb.w; px++) {
      const [lx, ly] = X.toLocal(px, py);
      let col = 0;
      let isBody = false;
      let glowCol = 0;
      const u = (halfL - lx) / L;
      // ---- body
      if (u >= 0 && u <= 1) {
        const sy = spine(u);
        const top = halfTop(u), bot = halfBot(u);
        const ry = ly - sy;
        if (ry >= -top && ry <= bot) {
          isBody = true;
          const v = ry < 0 ? ry / Math.max(0.5, top) : ry / Math.max(0.5, bot); // -1..1
          // region colours: back / body / belly with dithered boundaries
          const d = bayer(px, py) - 0.5;
          let R = c.bodyR;
          if (v < -0.42 + d * 0.25) R = c.backR;
          else if (v > 0.3 + d * 0.25) R = c.bellyR;
          // lighting: top lit, bottom shaded, slight front highlight
          let light = 0.5 - v * 0.42 + (1 - u) * 0.06;
          if (v > 0.72) light -= 0.18;
          if (v < -0.8) light += 0.08;
          // patterns
          for (const pat of c.patterns) {
            const pr = patternHit(pat, u, v, lx, ly, L, H, phase, px, py);
            if (pr) { R = pat.R; if (pat.glow) glowCol = pat.R[3]; if (pr === 2) light -= 0.25; }
          }
          // scales texture
          if (c.scales && v > -0.6 && v < 0.55 && u > 0.22 && u < 0.92 && ((px + (py >> 1) * 2) & 3) === 0 && ((py & 1) === 0)) light -= 0.2;
          col = rampPick(R, clamp01(light), px, py);
          // specular shine streak
          if (c.shine && v > -0.78 && v < -0.5 && u > 0.18 && u < 0.5 && ((px + py) & 1) === 0) col = R[4];
          // gill line
          const gu = (eyes[0]?.u ?? 0.17) + 0.13;
          if (L >= 13 && Math.abs(u - gu - v * v * 0.04) < 0.5 / L && v > -0.55 && v < 0.6) col = R[1];
          // spine undulation hint for transparency
          if (alphaBody < 255) {
            col = (col & 0x00ffffff) | (alphaBody << 24);
          }
          // organs for glass fish
          if (c.look.organs) {
            const oc = organHit(c, u, v, phase, lx, ly, L, H);
            if (oc) col = oc;
          }
          // mouth
          if (Math.abs(ry - mouthY + sy) < 0.6 + mouthOpen * 1.2 && u < 0.05 + mouthOpen * 0.06 && c.mouth.type !== 'none') {
            col = mouthOpen > 0.3 ? pack('#2a0f1c') : c.mouth.R[1];
            if (mouthOpen > 0.3 && Math.abs(ry - mouthY + sy) < 0.5 && u < 0.04) col = 0;
          }
          if (c.mouth.type === 'beak' && u < 0.12 && v > -0.2) col = rampPick(c.mouth.R, 0.65 - v * 0.2, px, py);
          if (c.mouth.type === 'lips' && u < 0.05 && Math.abs(ry - mouthY + sy) < 1.6) col = c.mouth.R[2];
          if (c.mouth.type === 'big' && u < 0.32 && Math.abs(ry - (mouthY - sy) - u * 2) < 0.55) col = pack('#1b0c14');
          if (c.mouth.type === 'fangs' && u < 0.2 && Math.abs(ry - (mouthY - sy)) < 0.55) col = pack('#1b0c14');
        }
      }
      // ---- front extras that overlay body (tie, bolts, mask...)
      if (isBody) {
        for (const e of c.extras) {
          const r = extraOnBody(e, u, (ly - spine(u)), lx, ly, L, H, halfTop(u), halfBot(u), px, py, phase);
          if (r) { col = r; if (e.glow) glowCol = r; }
        }
      }
      // ---- pectoral fin (in front of body, translucent)
      if (pec) {
        const dx = lx - pecX, dy = ly - pecY;
        const ca = Math.cos(pecA), sa = Math.sin(pecA);
        const a = -(dx * ca - dy * sa);
        const b = dx * sa + dy * ca;
        if (a >= -0.3 && a <= pec.len) {
          const s = a / pec.len;
          const wdt = pec.len * pec.w * Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2)) * (s < 0.5 ? 1 : 1);
          if (Math.abs(b) <= wdt + 0.3) {
            const ray = (Math.floor(b * 1.3 + s * 2) & 1) === 0;
            const fc = pec.R[ray ? 2 : 3];
            col = isBody ? blendPacked(col, fc, c.finAlpha) : (fc & 0x00ffffff) | (Math.round(255 * Math.min(1, c.finAlpha + 0.2)) << 24);
            if (!isBody) isBody = true;
          }
        }
      }
      // ---- eyes
      for (const e of eyes) {
        const dx = lx - e.x, dy = ly - e.y;
        const d2 = dx * dx + dy * dy;
        const er = e.r;
        if (d2 > (er + 0.9) ** 2) continue;
        const ec = eyePixel(e, dx, dy, er, px, py, blink, expr, c);
        if (ec !== null) {
          col = ec;
          isBody = true;
          if (e.type === 'glow' && ec) glowCol = ec;
        }
      }
      // ---- back parts: fins & tail & spikes (only where body is empty)
      if (!col) {
        // dorsal / anal fins
        for (const f of c.fins) {
          const lean = f.lean;
          const top = f.slot === 'top';
          // vertical distance from body edge
          const uu = (halfL - lx) / L;
          const edgeY0 = top ? spine(clamp01(uu)) - halfTop(clamp01(uu)) : spine(clamp01(uu)) + halfBot(clamp01(uu));
          const dist = top ? edgeY0 - ly : ly - edgeY0;
          if (dist < -1 || dist > f.h + 0.5) continue;
          const ue = uu - (lean * Math.max(0, dist)) / L;
          const t = (ue - f.from) / (f.to - f.from);
          if (t < 0 || t > 1) continue;
          const fh = f.h * finShape(f.type, t, phase, f.count) * (p.still ? 1 : 1 + 0.08 * Math.sin(TAU * phase * 2 - t * 6));
          if (dist <= fh) {
            const ray = f.rays && (Math.floor(t * f.count * 2.2) & 1) === 0;
            col = f.R[ray ? 2 : 3];
            if (dist > fh - 1.2) col = f.R[ray ? 3 : 4];
            col = (col & 0x00ffffff) | (Math.round(255 * Math.min(1, c.finAlpha + 0.25)) << 24);
            break;
          }
        }
      }
      if (!col && TL > 0) {
        const dx = lx - t0x, dy = ly - t0y;
        const a = (dx * tbx + dy * tby) / fore;
        const b = dx * tpx + dy * tpy;
        if (tailHit(c.tail.type, a + 0.6, b, TL, TS, tailBase, phase)) {
          const s = a / TL;
          const ang = Math.atan2(b, a + 2);
          const ray = (Math.floor(ang * 5) & 1) === 0;
          col = c.tail.R[ray ? 2 : 3];
          if (s > 0.82) col = c.tail.R[ray ? 3 : 4];
          if (s < 0.12) col = c.tail.R[1];
          col = (col & 0x00ffffff) | (Math.round(255 * Math.min(1, c.finAlpha + 0.25)) << 24);
        }
      }
      if (!col && spikeLen > 0.3) {
        const nx = lx / (L / 2), ny = ly / (H / 2);
        const rn = Math.hypot(nx, ny);
        const avgR = (L / 2 + H / 2) / 2;
        const d = (rn - 1) * avgR;
        if (d > -0.5 && d < spikeLen) {
          const ang = Math.atan2(ny, nx);
          const N = 14;
          const k = Math.round((ang / TAU) * N);
          const da = Math.abs(ang - (k * TAU) / N) * avgR;
          if (da < (1 - d / spikeLen) * 1.1 + 0.2) col = c.bodyR[d > spikeLen * 0.6 ? 4 : 3];
        }
      }
      // ---- extras behind (lure stalk, whiskers, antennae, cap)
      if (!col) {
        for (const e of c.extras) {
          const r = extraFree(e, lx, ly, L, H, halfL, phase, p);
          if (r) { col = r; if (e.glow) glowCol = r; break; }
        }
      }
      if (col) {
        if (sil) col = 0xff000000 | 0x332010;
        buf.data[py * bb.w + px] = col;
        if (glow && glowCol) glow.data[py * bb.w + px] = glowCol;
      }
    }
  }

  // outline
  if (!sil) {
    const outlineAlpha = c.alpha < 255 ? Math.min(255, c.alpha + 90) : 255;
    const oc = (c.outlineP & 0x00ffffff) | (outlineAlpha << 24);
    buf.outline(() => oc);
    if (c.variant?.mutation === 'neon' && glow) {
      // neon glow rim
      const rim = pack(shade(c.bodyHex, 0.5));
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i] === oc) glow.data[i] = rim;
    }
  } else {
    buf.outline(() => 0xff000000 | 0x221508);
  }

  // anchors
  const [mx, my] = X.toCanvas(mouthX + 0.5, mouthY);
  const [tx, ty] = X.toCanvas(-halfL - TL * 0.8, spine(1));
  const [hx, hy] = X.toCanvas(halfL * 0.2, -H / 2 - maxFin * 0.6);
  const [bx, by] = X.toCanvas(0, H / 2);
  const anchors = {
    mouth: [mx, my],
    tail: [tx, ty],
    top: [hx, hy],
    bottom: [bx, by],
    eyes: eyes.map((e) => {
      const [ex, ey] = X.toCanvas(e.x, e.y);
      return { x: ex, y: ey, r: e.r * scale, type: e.type };
    }),
  };
  for (const e of c.extras) {
    if (e.type === 'lure') {
      const [lx2, ly2] = lureTip(e, L, H, halfL, phase, p);
      const [cx2, cy2] = X.toCanvas(lx2, ly2);
      anchors.lure = [cx2, cy2];
    }
    if (e.type === 'briefcase') {
      const [cx2, cy2] = X.toCanvas(halfL * 0.25, H / 2 + 0.5);
      anchors.hand = [cx2, cy2];
    }
  }
  if (shiny) anchors.shiny = true;
  return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, ox: bb.ox, oy: bb.oy, anchors, w: bb.w, h: bb.h };
}

function blendPacked(a, b, t) {
  const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
  const br = b & 255, bg = (b >>> 8) & 255, bb2 = (b >>> 16) & 255;
  const r = ar + (br - ar) * t, g = ag + (bg - ag) * t, bl = ab + (bb2 - ab) * t;
  const al = Math.max(a >>> 24, b >>> 24);
  return ((al << 24) | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

// Returns 1 for pattern hit, 2 for "hit + darken", 0 none.
function patternHit(pat, u, v, lx, ly, L, H, phase, px, py) {
  switch (pat.type) {
    case 'bands': {
      for (const at of pat.at || [0.4]) {
        const w = (pat.width ?? 0.08) * (1 - 0.15 * v * v);
        const wav = (pat.wavy ?? 0.02) * Math.sin(v * 4);
        if (Math.abs(u - at - wav) < w) {
          if (pat.edge && Math.abs(Math.abs(u - at - wav) - w) < 0.9 / L) return 2;
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
      const sz = pat.size ?? 1.5;
      const cell = sz * 3.2;
      const cx = Math.floor(lx / cell), cy = Math.floor(ly / cell);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const hx = cx + i, hy = cy + j;
        if (hash2(hx, hy, pat.seed ?? 7) > (pat.density ?? 0.55)) continue;
        const ox = (hx + 0.2 + hash2(hx, hy, 11) * 0.6) * cell;
        const oy = (hy + 0.2 + hash2(hx, hy, 13) * 0.6) * cell;
        const r = sz * (0.7 + 0.5 * hash2(hx, hy, 17));
        if ((lx - ox) ** 2 + (ly - oy) ** 2 < r * r) return (pat.only === 'top' && v > 0.2) ? 0 : 1;
      }
      return 0;
    }
    case 'patches': {
      const n = noise2(lx * (pat.freq ?? 0.22) + (pat.seed ?? 3) * 9.1, ly * (pat.freq ?? 0.22));
      return n > (pat.threshold ?? 0.58) ? 1 : 0;
    }
    case 'gradient': {
      const t = pat.dir === 'v' ? (v + 1) / 2 : u;
      return t + (bayer(px, py) - 0.5) * 0.15 > (pat.from ?? 0.55) ? 1 : 0;
    }
    case 'checker': {
      const s = pat.size ?? 2;
      return ((Math.floor(lx / s) + Math.floor(ly / s)) & 1) === 0 && u > 0.2 ? 1 : 0;
    }
    case 'mask':
      return Math.abs(u - (pat.at ?? 0.18)) < (pat.width ?? 0.09) && v < 0.35 ? 1 : 0;
    case 'face':
      return u < (pat.to ?? 0.3) ? 1 : 0;
    case 'tailend':
      return u > (pat.from ?? 0.8) ? 1 : 0;
    case 'suit':
      // white shirt front + suit elsewhere: hit = shirt region
      return u < 0.42 && u > 0.08 && v > -0.05 + (u - 0.08) * 0.4 ? 1 : 0;
    case 'lines': {
      const k = pat.count ?? 5;
      const t = fract(u * k + Math.sin(v * 3) * 0.08);
      return t < (pat.width ?? 0.18) && u > 0.15 ? 1 : 0;
    }
    case 'circuit': {
      const gx = Math.floor(lx / 3), gy = Math.floor(ly / 3);
      const hx = hash2(gx, gy, 5);
      const onLine = (Math.abs(ly - gy * 3 - 1.5) < 0.5 && hx < 0.45) || (Math.abs(lx - gx * 3 - 1.5) < 0.5 && hx > 0.75);
      return onLine && u > 0.2 ? 1 : 0;
    }
    case 'galaxy': {
      const st = hash2(Math.floor(lx * 1.3 + 50), Math.floor(ly * 1.3 + 50), 77);
      return st > 0.94 ? 0 : 1;
    }
    case 'glowspots': {
      const k = pat.count ?? 5;
      for (let i = 0; i < k; i++) {
        const su = 0.2 + (i / k) * 0.7, sv = pat.v ?? 0.55;
        if (Math.abs(u - su) * L < 0.8 && Math.abs(v - sv) < 0.22) return 1;
      }
      return 0;
    }
    case 'belt':
      return Math.abs(v - (pat.at ?? 0.3)) < (pat.width ?? 0.12) ? 1 : 0;
    case 'rust': {
      const n = noise2(lx * 0.35 + 3.3, ly * 0.35 + 1.7);
      return n > (pat.threshold ?? 0.62) ? 1 : 0;
    }
    case 'zigzag': {
      const t = fract(u * (pat.count ?? 4));
      return Math.abs(v - (Math.abs(t - 0.5) * 2 - 0.5) * 0.9) < (pat.width ?? 0.14) ? 1 : 0;
    }
    case 'chevron': {
      const k = pat.count ?? 3;
      const t = fract(u * k - Math.abs(v) * 0.25);
      return t < (pat.width ?? 0.22) && u > 0.18 ? 1 : 0;
    }
    default:
      return 0;
  }
}

function organHit(c, u, v, phase, lx, ly, L, H) {
  const o = c.look.organs;
  // spine
  if (Math.abs(v - 0.02) < 0.09 && u > 0.12 && u < 0.98) return pack(o.bone || '#f4f1ff', 230);
  // ribs
  if (u > 0.28 && u < 0.78 && Math.abs(fract(u * L / 2.2) - 0.5) < 0.18 && Math.abs(v) < 0.6 && Math.abs(v) > 0.12) return pack(o.bone || '#f4f1ff', 170);
  // heart (pulses)
  const pulse = 0.5 + 0.5 * Math.sin(phase * TAU * 2);
  if ((u - 0.27) ** 2 * L * L + (v - 0.42) ** 2 * H * H * 0.25 < 1.2 + pulse) return pack('#ff4466', 255);
  // stomach
  if ((u - 0.45) ** 2 * L * L * 0.4 + (v - 0.32) ** 2 * H * H * 0.25 < 2.2) return pack(o.stomach || '#9ad66b', 230);
  // brain
  if ((u - 0.1) ** 2 * L * L + (v + 0.35) ** 2 * H * H * 0.25 < 0.9) return pack('#ffb3d0', 220);
  return 0;
}

function eyePixel(e, dx, dy, r, px, py, blink, expr, c) {
  const d = Math.hypot(dx, dy);
  if (e.type === 'dot' || r < 1.2) {
    if (blink) return Math.abs(dy) < 0.5 && Math.abs(dx) < 1 ? c.bodyR[0] : null;
    if (d <= 0.75) return e.pupil;
    return null;
  }
  if (e.type === 'glow') {
    if (d > r + 0.4) return null;
    if (blink) return Math.abs(dy) < 0.6 ? c.bodyR[0] : null;
    const g = e.glowHex;
    return d < r * 0.45 ? pack('#ffffff') : pack(g);
  }
  if (d > r + 0.45) return null;
  if (blink || expr === 'sleep') {
    if (Math.abs(dy - (expr === 'sleep' ? 0.4 : 0)) < 0.55 && Math.abs(dx) < r) return c.bodyR[0];
    return c.bodyR[1];
  }
  if (expr === 'happy') {
    // ^ shape
    const yy = -Math.abs(dx) * 0.7 + 0.3;
    if (Math.abs(dy - yy) < 0.6 && Math.abs(dx) < r) return c.bodyR[0];
    return c.bodyR[2];
  }
  if (expr === 'dizzy') {
    if ((Math.abs(dx - dy) < 0.6 || Math.abs(dx + dy) < 0.6) && d < r) return pack('#1a1424');
    return pack('#ffffff');
  }
  // sclera
  const sclera = pack(e.sclera || '#ffffff');
  const rimC = pack('#d8e4f0');
  if (e.type === 'googly') {
    if (d > r - 0.55) return pack('#1a1424');
    return d > r - 1.4 && dy > 0 ? rimC : sclera;
  }
  let pr = r * (e.pupilSize ?? 0.55);
  let pxo = r * 0.28, pyo = r * 0.05;
  if (expr === 'shock') { pr = Math.max(0.6, r * 0.25); pxo = 0; pyo = 0; }
  const pd = Math.hypot(dx - pxo, dy - pyo);
  if (e.iris && pd <= pr + 0.9 && expr !== 'shock') {
    if (pd <= pr * 0.6) return e.pupil;
    // highlight
    if (Math.abs(dx - pxo + pr * 0.45) < 0.6 && Math.abs(dy - pyo + pr * 0.45) < 0.6) return pack('#ffffff');
    return e.iris;
  }
  if (pd <= pr) {
    if (r >= 2 && Math.abs(dx - pxo + pr * 0.5) < 0.55 && Math.abs(dy - pyo + pr * 0.5) < 0.55) return pack('#ffffff');
    return e.pupil;
  }
  if (expr === 'angry' && dy < -r * 0.25 && dy < -dx * 0.6 - r * 0.1) return c.bodyR[1];
  if (d > r - 0.5 && r >= 2.4) return dy > 0 ? rimC : sclera;
  return sclera;
}

function extraOnBody(e, u, ry, lx, ly, L, H, top, bot, px, py, phase) {
  switch (e.type) {
    case 'tie': {
      // knot + kite under the "chin"
      const cu = e.u ?? 0.24;
      const du = (u - cu) * L;
      const v = ry / Math.max(0.5, bot);
      if (ry > 0 && v < 1.05) {
        const t = v;
        const wdt = t < 0.25 ? 0.9 : 0.6 + (t - 0.25) * 1.6 * (t < 0.75 ? 1 : (1 - t) * 3);
        if (Math.abs(du) <= wdt) return t < 0.25 ? (e.P2 || e.P) : (Math.abs(du) > wdt - 0.6 ? e.P2 || e.P : e.P);
      }
      return 0;
    }
    case 'bolts': {
      const gx = Math.round(lx / 4) * 4, gy = Math.round(ly / 4) * 4;
      if (hash2(gx, gy, 9) > 0.55 && Math.abs(lx - gx) < 0.5 && Math.abs(ly - gy) < 0.5 && u > 0.18) return e.P || pack('#d8dde6');
      return 0;
    }
    case 'scar': {
      if (Math.abs((u - (e.u ?? 0.5)) * L - (ry * 0.6)) < 0.5 && Math.abs(ry) < top * 0.7) return e.P || pack('#f3d6d0');
      return 0;
    }
    case 'mustache': {
      const v = ry / Math.max(0.5, bot);
      if (u < 0.16 && u > 0.02 && Math.abs(v - (e.v ?? 0.15) - Math.sin(u * 40) * 0.05) < 0.16) return e.P || pack('#3a2410');
      return 0;
    }
    case 'blush': {
      if (Math.abs(u - (e.u ?? 0.24)) * L < 1.1 && Math.abs(ry / Math.max(0.5, bot) - 0.15) < 0.18) return e.P || pack('#ff8fa8');
      return 0;
    }
    case 'screen': {
      // scanlines over the body (screen dweller)
      if ((py & 1) === 0) return e.P || pack('#0a3a1f', 200);
      return 0;
    }
    default:
      return 0;
  }
}

function lureTip(e, L, H, halfL, phase, p) {
  const sway = p.still ? 0 : Math.sin(phase * TAU) * 0.8;
  const reach = e.reach ?? L * 0.35;
  const h = e.h ?? H * 0.9;
  return [halfL - L * 0.12 + reach + sway * 0.4, -H / 2 - h * 0.55 + sway];
}

function extraFree(e, lx, ly, L, H, halfL, phase, p) {
  switch (e.type) {
    case 'lure': {
      // quadratic bezier stalk from forehead to tip
      const sx = halfL - L * 0.15, sy = -H * 0.42;
      const [tx, ty] = lureTip(e, L, H, halfL, phase, p);
      const cx = sx - 1, cy = ty - 2;
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const bx = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t * t * tx;
        const by = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t * t * ty;
        if (Math.abs(lx - bx) < 0.55 && Math.abs(ly - by) < 0.55) return e.P || pack('#5a5f70');
      }
      return 0;
    }
    case 'whiskers': {
      for (const side of [0, 1]) {
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const bx = halfL - 0.5 - t * (e.len ?? 5) * 0.6;
          const by = H * 0.1 + t * (e.len ?? 5) * (0.5 + side * 0.25) + Math.sin(phase * TAU + t * 3) * t * 0.8;
          if (Math.abs(lx - bx) < 0.5 && Math.abs(ly - by) < 0.5) return e.P || pack('#3b2a22');
        }
      }
      return 0;
    }
    case 'antennae': {
      for (const off of [0, 1.5]) {
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          const bx = halfL - L * 0.2 - off + t * 2.5;
          const by = -H * 0.4 - t * 4 + Math.sin(phase * TAU + off) * t * 0.6;
          if (Math.abs(lx - bx) < 0.5 && Math.abs(ly - by) < 0.5) return t > 0.85 ? (e.P2 || pack('#ff5577')) : (e.P || pack('#333344'));
        }
      }
      return 0;
    }
    case 'cap': {
      const cx = halfL - L * (e.u ?? 0.3), cy = -H * 0.48;
      const dx = lx - cx, dy = ly - cy;
      if (dy < 0.5 && dy > -2.6 && Math.abs(dx) < 2.6 + (dy > -0.5 ? 0.6 : 0)) {
        if (dy > -0.5 && ((Math.floor(lx) & 1) === 0)) return e.P2 || pack('#c0c6d2');
        return e.P || pack('#d93a3a');
      }
      return 0;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Special creatures. All return the same structure as rasterGeneric.

function finish(buf, glow, ox, oy, anchors, outlineP) {
  buf.outline(() => outlineP);
  return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, ox, oy, anchors, w: buf.w, h: buf.h };
}

function rasterCrab(c, p) {
  // Side-on crab. look.shell: 'round' | 'mouse' | 'mech'
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const L = c.L, H = c.H;
  const w = Math.ceil(L * s + 10 * s), h = Math.ceil(H * s + 10 * s);
  const buf = new PixelBuffer(w, h);
  const ox = Math.floor(w / 2), oy = Math.floor(h * 0.55);
  const R = c.bodyR, F = c.finR, B = c.bellyR;
  const shell = c.look.shell || 'round';
  const walk = p.still ? 0 : phase * TAU;
  const bob = Math.round(Math.sin(walk * 2) * 0.6 * s);
  // legs (behind)
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const lx0 = ox + side * (L * 0.18 + i * L * 0.07) * s;
      const ph = walk + i * 1.3 + (side > 0 ? Math.PI : 0);
      const lift = Math.max(0, Math.sin(ph)) * 1.5 * s;
      const kx = lx0 + side * (L * 0.16) * s;
      const ky = oy - 1 * s - lift + bob;
      const fx = lx0 + side * (L * 0.28 + Math.cos(ph) * 1.2) * s;
      const fy = oy + H * 0.45 * s - lift * 0.5;
      buf.line(lx0, oy + bob, kx, ky, R[1]);
      buf.line(kx, ky, fx, fy, R[1]);
    }
  }
  // body/shell
  const cx = ox, cy = oy - H * 0.15 * s + bob;
  const rx = (L / 2) * s, ry = (H / 2) * s;
  for (let y = Math.floor(cy - ry - 2); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      let inside;
      if (shell === 'mouse') inside = ny < 0.55 && (nx * nx) / 1 + (ny * ny) / (ny < 0 ? 1 : 0.35) <= 1;
      else if (shell === 'mech') inside = Math.abs(nx) < 0.95 && ny > -0.95 && ny < 0.55 && !(Math.abs(nx) > 0.7 && ny < -0.6);
      else inside = ny < 0.55 && nx * nx + ny * ny <= 1;
      if (!inside) continue;
      const light = 0.55 - ny * 0.45 - nx * 0.08;
      let col = rampPick(R, clamp01(light), x, y);
      if (ny > 0.25) col = rampPick(B, clamp01(light), x, y);
      if (shell === 'mouse') {
        // button split line + scroll wheel
        if (Math.abs(nx - 0.25) < 0.6 / rx && ny < -0.15) col = R[0];
        if (Math.abs(nx - 0.25) < 1.2 / rx && Math.abs(ny + 0.55) < 0.22) col = pack('#555a66');
        if (ny > -0.15 && ny < -0.05) col = R[1];
      }
      if (shell === 'mech') {
        if ((Math.abs(nx) > 0.82 || ny < -0.85) && hash2(x, y, 3) > 0.5) col = pack('#c9cfd8');
        if (Math.abs(ny + 0.3) < 0.08) col = R[0];
        if (Math.hypot(nx + 0.4, ny + 0.45) < 0.12 || Math.hypot(nx - 0.4, ny + 0.45) < 0.12) col = pack('#e6ebf2');
      }
      buf.set(x, y, col);
    }
  }
  // cable tail for mouse shell
  if (shell === 'mouse') {
    let tx = cx - rx, ty = cy + ry * 0.2;
    for (let i = 0; i < 9 * s; i++) {
      const nx2 = tx - 1, ny2 = ty + Math.sin(i * 0.7 + walk) * 0.8;
      buf.line(tx, ty, nx2, ny2, pack('#3d3f4a'));
      tx = nx2; ty = ny2;
    }
  }
  // claws (front)
  const clawOpen = p.mouth ? 1 : 0.3 + 0.3 * Math.sin(walk * 0.5);
  for (const side of [1, -0.6]) {
    const ax = cx + side * rx * 0.8, ay = cy + ry * 0.2;
    const hx = ax + side * 3 * s, hy = ay - 3 * s;
    buf.line(ax, ay, hx, hy, R[1]);
    const cr = (side > 0 ? 2.2 : 1.6) * s;
    buf.fillCircle(hx + side * cr * 0.6, hy - cr * 0.4, cr, F[3]);
    // pincer gap
    const gx = hx + side * cr * 1.2, gy = hy - cr * 0.4;
    buf.line(gx - side * cr * 0.8, gy, gx + side * 0.2, gy - clawOpen * 1.5 * s, 0);
    buf.set(Math.round(hx + side * cr * 0.4), Math.round(hy - cr * 0.9), F[4]);
  }
  // eye stalks
  const eyes = [];
  for (const side of [0.25, -0.05]) {
    const ex = cx + rx * side + rx * 0.3, ey = cy - ry - 2.5 * s;
    buf.line(ex, cy - ry * 0.8, ex, ey + 1, R[1]);
    if (p.blink) buf.line(ex - 1, ey, ex + 1, ey, R[0]);
    else {
      buf.fillCircle(ex + 0.5, ey + 0.5, 1.4 * s, pack('#ffffff'));
      buf.set(Math.round(ex + 0.5 * s), Math.round(ey), c.eyes[0].pupil);
    }
    eyes.push({ x: ex + 0.5, y: ey + 0.5, r: 1.4 * s, type: 'stalk' });
  }
  if (c.look.mustache) {
    buf.line(cx + rx * 0.5, cy + ry * 0.05, cx + rx * 0.95, cy + ry * 0.1, pack('#2a1810'));
    buf.line(cx + rx * 0.45, cy + ry * 0.12, cx + rx * 0.2, cy + ry * 0.2, pack('#2a1810'));
  }
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  return finish(buf, null, ox, oy, { mouth: [cx + rx + 3 * s, cy - 2 * s], top: [cx, cy - ry - 5 * s], tail: [cx - rx, cy], bottom: [cx, oy + H * 0.45 * s], eyes }, c.outlineP);
}

function rasterJelly(c, p) {
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const L = c.L, H = c.H;
  const pulse = p.still ? 0 : Math.sin(phase * TAU);
  const bw = (L / 2) * (1 + 0.12 * pulse) * s;
  const bh = (H * 0.55) * (1 - 0.12 * pulse) * s;
  const tl = (c.look.tentacles ?? H * 1.3) * s;
  const w = Math.ceil(bw * 2 + 8), h = Math.ceil(bh + tl + 8);
  const buf = new PixelBuffer(w, h);
  const glow = new PixelBuffer(w, h);
  const ox = Math.floor(w / 2), oy = Math.ceil(bh + 3);
  const R = c.bodyR, F = c.finR;
  const a = c.alpha;
  // tentacles
  const n = c.look.tentacleCount ?? 5;
  for (let i = 0; i < n; i++) {
    const tx0 = ox + (((i + 0.5) / n) * 2 - 1) * bw * 0.8;
    let lx = tx0, ly = oy;
    for (let k = 1; k <= tl; k++) {
      const t = k / tl;
      const x = tx0 + Math.sin(phase * TAU + i * 1.7 + t * 4) * 2 * t * s;
      const y = oy + k;
      buf.line(lx, ly, x, y, (F[t > 0.7 ? 3 : 2] & 0x00ffffff) | (Math.round(a * (1 - t * 0.5)) << 24));
      lx = x; ly = y;
    }
  }
  // oral arms (frilly)
  for (let k = 0; k < tl * 0.6; k++) {
    const x = ox + Math.sin(phase * TAU * 1.3 + k * 0.5) * 1.5 * s;
    buf.set(x, oy + k, F[3]);
    buf.set(x + 1, oy + k, (F[4] & 0x00ffffff) | (180 << 24));
  }
  // bell
  for (let y = Math.floor(oy - bh - 1); y <= oy + 1; y++) {
    for (let x = Math.floor(ox - bw - 1); x <= ox + bw + 1; x++) {
      const nx = (x + 0.5 - ox) / bw, ny = (y + 0.5 - oy) / bh;
      if (ny > 0.05 || nx * nx + ny * ny > 1) continue;
      const rim = nx * nx + ny * ny > 0.72;
      let col = rampPick(R, clamp01(0.55 - ny * 0.25 - Math.abs(nx) * 0.2), x, y);
      if (rim) col = R[3];
      if (ny > -0.15) col = R[4];
      // inner pattern (4 rings like moon jelly)
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI + Math.PI / 8;
        const cxk = Math.cos(ang) * 0.45, cyk = -0.35 - Math.sin(ang) * 0.1;
        if (Math.hypot(nx - cxk * 0.9, (ny - cyk) * 1.3) < 0.18) col = pack(c.look.gonad || '#ff9fd6');
      }
      const al = rim ? Math.min(255, a + 60) : a;
      buf.set(x, y, (col & 0x00ffffff) | (al << 24));
      if (rim || ny > -0.15) glow.set(x, y, R[4]);
    }
  }
  // face
  const ey = oy - bh * 0.45;
  if (!c.look.noFace) {
    if (p.blink) { buf.set(ox - 2 * s, ey, R[0]); buf.set(ox + 2 * s, ey, R[0]); }
    else {
      buf.rect(ox - 2 * s - 1, ey - 1, 1 * s, 2 * s, pack('#1a1424'));
      buf.rect(ox + 2 * s, ey - 1, 1 * s, 2 * s, pack('#1a1424'));
    }
    buf.set(ox - 3 * s, ey + 2, pack('#ff7aa8'));
    buf.set(ox + 3 * s, ey + 2, pack('#ff7aa8'));
  }
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  const outline = (c.outlineP & 0x00ffffff) | (Math.min(255, a + 80) << 24);
  return finish(buf, glow, ox, oy - bh * 0.4, { mouth: [ox, oy + 2], top: [ox, oy - bh - 2], tail: [ox, oy + tl], bottom: [ox, oy + tl * 0.5], eyes: [] }, outline);
}

function rasterPudding(c, p) {
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const L = c.L, H = c.H;
  const wob = p.still ? 0 : Math.sin(phase * TAU * 2);
  const sq = p.squash || 0;
  const w = Math.ceil(L * s * 1.5 + 10), h = Math.ceil(H * s * 1.6 + 10);
  const buf = new PixelBuffer(w, h);
  const ox = Math.floor(w / 2), base = Math.floor(h - 4);
  const hh = H * s * (1 - 0.08 * wob - sq * 0.2);
  const botW = (L / 2) * s * (1 + 0.05 * wob + sq * 0.2);
  const topW = botW * 0.68;
  const R = c.bodyR;
  const caramel = c.finR;
  const skew = wob * 1.2 * s;
  for (let y = Math.floor(base - hh - 2); y <= base; y++) {
    const t = (base - y) / hh; // 0 bottom .. 1 top
    if (t > 1.02) continue;
    const half = lerp(botW, topW, t) - (t > 0.9 ? (t - 0.9) * 8 : 0);
    const cxr = ox + skew * t;
    for (let x = Math.floor(cxr - half - 1); x <= cxr + half + 1; x++) {
      const nx = (x + 0.5 - cxr) / Math.max(1, half);
      if (Math.abs(nx) > 1) continue;
      let col = rampPick(R, clamp01(0.62 - nx * 0.3 + t * 0.15), x, y);
      if (t > 0.72 + Math.sin(nx * 5 + phase * TAU) * 0.05) col = rampPick(caramel, clamp01(0.55 - nx * 0.3 + (t - 0.72) * 0.8), x, y);
      if (nx < -0.55 && nx > -0.75 && t > 0.2 && t < 0.65) col = R[4];
      buf.set(x, y, col);
    }
  }
  // cherry on top
  if (c.look.cherry !== false) {
    const chx = ox + skew, chy = base - hh - 2 * s;
    buf.fillCircle(chx, chy, 1.8 * s, pack('#e8304a'));
    buf.set(Math.round(chx - 0.6 * s), Math.round(chy - 0.6 * s), pack('#ffd0d8'));
    buf.line(chx, chy - 1.5 * s, chx + 1.5 * s, chy - 3.5 * s, pack('#3f7a2a'));
  }
  // face
  const fy = base - hh * 0.42;
  const fx = ox + skew * 0.42;
  if (p.blink) {
    buf.line(fx - 3 * s, fy, fx - 2 * s, fy, pack('#3a1a10'));
    buf.line(fx + 2 * s, fy, fx + 3 * s, fy, pack('#3a1a10'));
  } else if (p.expr === 'happy') {
    buf.set(fx - 3 * s, fy, pack('#3a1a10')); buf.set(fx - 2 * s, fy - 1, pack('#3a1a10'));
    buf.set(fx + 2 * s, fy - 1, pack('#3a1a10')); buf.set(fx + 3 * s, fy, pack('#3a1a10'));
  } else {
    buf.rect(Math.round(fx - 3 * s), Math.round(fy - 1), Math.max(1, s), 2 * s, pack('#3a1a10'));
    buf.rect(Math.round(fx + 2 * s), Math.round(fy - 1), Math.max(1, s), 2 * s, pack('#3a1a10'));
  }
  buf.set(fx - 4 * s, fy + 2, pack('#ff8a8a'));
  buf.set(fx + 4 * s, fy + 2, pack('#ff8a8a'));
  const mo = p.mouth ? 1 : 0;
  buf.line(fx - 1, fy + 2, fx + 1, fy + 2 + mo, pack('#3a1a10'));
  // plate
  buf.line(ox - botW - 2, base + 1, ox + botW + 2, base + 1, pack('#e8f0f6'));
  buf.line(ox - botW, base + 2, ox + botW, base + 2, pack('#b9c6d2'));
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  return finish(buf, null, ox, base - hh / 2, { mouth: [fx, fy + 2], top: [ox, base - hh - 5 * s], tail: [ox - botW, base], bottom: [ox, base + 2], eyes: [] }, c.outlineP);
}

function rasterSeahorse(c, p) {
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const H = c.H; // height of seahorse
  const w = Math.ceil(H * 0.9 * s + 8), h = Math.ceil(H * 1.25 * s + 8);
  const buf = new PixelBuffer(w, h);
  const ox = Math.floor(w * 0.45), oy = Math.floor(h * 0.45);
  const R = c.bodyR, B = c.bellyR, F = c.finR;
  const bob = Math.sin(phase * TAU) * 0.6;
  // spine path (S-curve) param t: 0 = head top, 1 = tail tip
  const pt = (t) => {
    const yy = (t * 1.05 - 0.45) * H * s;
    let xx = Math.sin(t * Math.PI * 1.2 + 0.2) * H * 0.18 * s;
    if (t > 0.72) {
      // curl
      const k = (t - 0.72) / 0.28;
      const ang = k * Math.PI * 1.6;
      const r = H * 0.14 * s * (1 - k * 0.5);
      return [ox + xx - Math.sin(ang) * r * 0.8 + r * 0.2, oy + (0.72 * 1.05 - 0.45) * H * s + (1 - Math.cos(ang)) * r + bob];
    }
    return [ox + xx, oy + yy + bob];
  };
  const thick = (t) => (t < 0.12 ? 0.11 : t < 0.55 ? 0.17 - (t - 0.12) * 0.05 : 0.15 * (1 - (t - 0.55) / 0.55) + 0.025) * H * s;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const [x, y] = pt(t);
    const r = thick(t);
    for (let yy = Math.floor(y - r - 1); yy <= y + r + 1; yy++) for (let xx = Math.floor(x - r - 1); xx <= x + r + 1; xx++) {
      const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
      if (dx * dx + dy * dy > r * r) continue;
      const nx = dx / Math.max(0.5, r);
      let col = rampPick(R, clamp01(0.55 - nx * 0.35), xx, yy);
      if (nx > 0.35 && t > 0.15 && t < 0.6) col = rampPick(B, clamp01(0.5 - nx * 0.2), xx, yy);
      if (t > 0.1 && t < 0.7 && (Math.floor(t * 30) & 1) === 0 && nx > 0.1) col = R[1];
      buf.set(xx, yy, col);
    }
  }
  // snout
  const [hx, hy] = pt(0.06);
  for (let k = 0; k < 4 * s; k++) buf.rect(Math.round(hx + 2 * s + k), Math.round(hy + 1), 1, Math.max(1, s), R[2]);
  // crown/coronet
  buf.set(hx - 1, hy - thick(0.05) - 1, R[3]);
  buf.set(hx, hy - thick(0.05) - 1.5, R[3]);
  // dorsal fin flutter
  const [dx0, dy0] = pt(0.45);
  for (let k = 0; k < 4 * s; k++) {
    const fl = Math.sin(phase * TAU * 4 + k) * 1;
    buf.set(dx0 - thick(0.45) - 1 - fl, dy0 - 2 + k, F[3]);
  }
  // eye
  if (p.blink) buf.set(hx + 1, hy, R[0]);
  else {
    buf.set(hx + 1, hy - 0.5, pack('#ffffff'));
    buf.set(hx + 1, hy + 0.5, c.eyes[0].pupil);
  }
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  const [tx, ty] = pt(1);
  return finish(buf, null, ox, oy, { mouth: [hx + 5 * s, hy + 1], top: [hx, hy - 5], tail: [tx, ty], bottom: [tx, ty], eyes: [{ x: hx + 1, y: hy, r: 1, type: 'dot' }] }, c.outlineP);
}

function rasterRay(c, p) {
  // A gliding ray seen from a raised 3/4 angle: wings flap up/down.
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const L = c.L, H = c.H;
  const w = Math.ceil(L * s * 1.5 + 12), h = Math.ceil(H * s * 2.2 + 12);
  const buf = new PixelBuffer(w, h);
  const glow = c.glow ? new PixelBuffer(w, h) : null;
  const ox = Math.floor(w * 0.5), oy = Math.floor(h * 0.5);
  const R = c.bodyR, B = c.bellyR;
  const flap = p.still ? 0 : Math.sin(phase * TAU);
  const span = H * s;
  const len = L * 0.5 * s;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - ox), dy = (y + 0.5 - oy);
      const u = dx / len; // -1 tail .. 1 nose
      if (u > 1 || u < -1.1) continue;
      // diamond with wings bending
      const wingRaise = flap * Math.abs(dy) * 0.35;
      const yy = dy;
      const half = span * (1 - Math.abs(u - 0.15) * 0.95) * (c.look.square ? 1.15 : 1);
      if (Math.abs(yy) > half) continue;
      const xxs = dx - wingRaise * Math.sign(dy) * 0.0;
      void xxs;
      const v = yy / Math.max(1, half);
      let light = 0.55 - (flap * v) * 0.25 - Math.abs(v) * 0.15;
      let col = rampPick(R, clamp01(light), x, y);
      if (c.look.square) {
        // floppy disk: shutter + label
        if (u > 0.2 && u < 0.75 && Math.abs(v) < 0.35) col = rampPick(B, 0.6, x, y);
        if (u < -0.15 && u > -0.65 && Math.abs(v) < 0.55) col = pack('#f2f2ea');
        if (u < -0.3 && u > -0.5 && Math.abs(v) < 0.4 && ((y & 1) === 0)) col = pack('#9aa4b8');
      }
      if (c.look.bsod) {
        if (Math.abs(u - 0.15) < 0.4 && Math.abs(v) < 0.6) col = rampPick(R, 0.6, x, y);
        // ":(" face
        if ((Math.abs(dx - len * 0.35) < 0.6 && (Math.abs(dy + 2 * s) < 0.6 || Math.abs(dy - 2 * s) < 0.6))) col = pack('#ffffff');
        if (Math.abs(Math.hypot(dx - len * 0.05, dy) - 2.6 * s) < 0.6 && dx < len * 0.05 - 1 && Math.abs(dy) < 2.2 * s) col = pack('#ffffff');
        if (u < -0.05 && u > -0.8 && Math.abs(v) < 0.5 && ((y % 3) === 0) && hash2(x >> 1, y, 4) > 0.35) col = pack('#c8d8ff');
        if (glow) glow.set(x, y, R[3]);
      }
      buf.set(x, y, col);
    }
  }
  // tail whip
  let tx = ox - len, ty = oy;
  for (let k = 0; k < L * 0.7 * s; k++) {
    const nx = tx - 1, ny = oy + Math.sin(phase * TAU + k * 0.25) * k * 0.08;
    buf.line(tx, ty, nx, ny, R[1]);
    tx = nx; ty = ny;
  }
  // eyes
  if (!c.look.bsod) {
    const ex = ox + len * 0.55;
    if (p.blink) { buf.set(ex, oy - 2 * s, R[0]); buf.set(ex, oy + 2 * s, R[0]); }
    else {
      buf.set(ex, oy - 2 * s, pack('#ffffff')); buf.set(ex + 1, oy - 2 * s, c.eyes[0].pupil);
      buf.set(ex, oy + 2 * s, pack('#ffffff')); buf.set(ex + 1, oy + 2 * s, c.eyes[0].pupil);
    }
  }
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  return finish(buf, glow, ox, oy, { mouth: [ox + len, oy], top: [ox, oy - span - 3], tail: [tx, ty], bottom: [ox, oy + span], eyes: [] }, c.outlineP);
}

function rasterSquid(c, p) {
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const L = c.L, H = c.H;
  const w = Math.ceil(L * s * 1.8 + 10), h = Math.ceil(H * s * 1.6 + 10);
  const buf = new PixelBuffer(w, h);
  const glow = c.glow ? new PixelBuffer(w, h) : null;
  const ox = Math.floor(w * 0.42), oy = Math.floor(h * 0.5);
  const R = c.bodyR, F = c.finR;
  const pulse = p.still ? 0 : Math.sin(phase * TAU);
  // mantle points right? Squid swims mantle-first; mantle to the right.
  const ml = L * 0.55 * s, mh = (H / 2) * s * (1 - 0.15 * pulse);
  for (let y = Math.floor(oy - mh - 2); y <= oy + mh + 2; y++) for (let x = ox; x <= ox + ml + 2; x++) {
    const u = (x + 0.5 - ox) / ml; // 0 head .. 1 tip
    const half = mh * Math.sqrt(Math.max(0, 1 - u * u)) * (u < 0.15 ? 0.9 + u : 1);
    if (Math.abs(y + 0.5 - oy) > half || u > 1) continue;
    const v = (y + 0.5 - oy) / Math.max(1, half);
    let col = rampPick(R, clamp01(0.58 - v * 0.35), x, y);
    if (hash2(x, y, 2) > 0.9 && u > 0.2) col = R[0];
    buf.set(x, y, col);
  }
  // fins (ear-like)
  for (const side of [-1, 1]) {
    const fx = ox + ml * 0.85, fy = oy + side * mh * 0.6;
    buf.fillEllipse(fx, fy + side * (1 + pulse * 0.5) * s, 2.2 * s, 1.5 * s, F[3]);
  }
  // cape web + arms to the left
  const n = 6;
  for (let i = 0; i < n; i++) {
    const off = ((i + 0.5) / n - 0.5) * mh * 1.6;
    let lx = ox, ly = oy + off * 0.5;
    for (let k = 1; k <= L * 0.6 * s; k++) {
      const t = k / (L * 0.6 * s);
      const x = ox - k;
      const y = oy + off * (0.5 + t * (0.8 - pulse * 0.6)) + Math.sin(phase * TAU + i + t * 5) * t * 1.2 * s;
      buf.line(lx, ly, x, y, F[t > 0.8 ? 4 : 2]);
      lx = x; ly = y;
    }
  }
  if (c.look.cape) {
    // dark web between arms
    for (let y = Math.floor(oy - mh); y <= oy + mh; y++) for (let x = Math.floor(ox - L * 0.35 * s); x < ox; x++) {
      const t = (ox - x) / (L * 0.35 * s);
      if (Math.abs(y - oy) < mh * (0.6 + t * 0.4) * (1 - pulse * 0.3)) {
        if (!buf.get(x, y)) buf.set(x, y, (F[0] & 0x00ffffff) | (230 << 24));
      }
    }
  }
  // eye
  const ex = ox + 1 * s, ey = oy - mh * 0.25;
  if (p.blink) buf.line(ex - 1, ey, ex + 1, ey, R[0]);
  else {
    buf.fillCircle(ex + 0.5, ey + 0.5, 1.6 * s, pack(c.look.eyeGlow ? '#b8fff2' : '#ffffff'));
    buf.set(ex + 1, ey, c.eyes[0].pupil);
    if (glow && c.look.eyeGlow) glow.fillCircle(ex + 0.5, ey + 0.5, 1.6 * s, pack('#7affea'));
  }
  if (glow && c.look.photophores) for (let k = 0; k < 6; k++) {
    const gx = ox + ml * (0.2 + k * 0.12), gy = oy + mh * 0.55;
    buf.set(gx, gy, pack('#8ff3ff'));
    glow.set(gx, gy, pack('#8ff3ff'));
  }
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  return finish(buf, glow, ox + ml * 0.3, oy, { mouth: [ox - 2, oy], top: [ox + ml * 0.5, oy - mh - 3], tail: [ox + ml, oy], bottom: [ox, oy + mh], eyes: [] }, c.outlineP);
}

function rasterIsopod(c, p) {
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const L = c.L, H = c.H;
  const w = Math.ceil(L * s + 10), h = Math.ceil(H * s + 10);
  const buf = new PixelBuffer(w, h);
  const ox = Math.floor(w / 2), oy = Math.floor(h * 0.62);
  const R = c.bodyR;
  const walk = p.still ? 0 : phase * TAU;
  // legs
  const legs = 7;
  for (let i = 0; i < legs; i++) {
    const lx = ox - L * 0.4 * s + (i / (legs - 1)) * L * 0.8 * s;
    const ph = walk * 2 + i * 0.9;
    buf.line(lx, oy, lx + Math.cos(ph) * 1.5 * s, oy + 2.5 * s - Math.max(0, Math.sin(ph)) * s, R[0]);
  }
  // segmented dome
  const rx = (L / 2) * s, ry = H * 0.6 * s;
  for (let y = Math.floor(oy - ry); y <= oy + 1; y++) for (let x = Math.floor(ox - rx - 1); x <= ox + rx + 1; x++) {
    const nx = (x + 0.5 - ox) / rx, ny = (y + 0.5 - oy) / ry;
    if (ny > 0.05 || nx * nx + ny * ny > 1) continue;
    let col = rampPick(R, clamp01(0.62 + ny * -0.1 - Math.abs(nx) * 0.25 + (ny < -0.6 ? 0.15 : 0)), x, y);
    if (Math.abs(fract((nx + 1) * 4.5) - 0.5) > 0.42 && Math.abs(nx) < 0.8) col = R[1];
    buf.set(x, y, col);
  }
  // head + antennae
  const hx = ox + rx * 0.95, hy = oy - ry * 0.35;
  buf.fillEllipse(hx, hy, 2.2 * s, 2 * s, R[2]);
  buf.line(hx + 1, hy - 1, hx + 4 * s, hy - 3 * s + Math.sin(walk) * 0.8, R[1]);
  buf.line(hx + 1, hy, hx + 5 * s, hy - 1 * s + Math.cos(walk) * 0.8, R[1]);
  if (!p.blink) { buf.set(hx + 1, hy - 1, pack('#111')); buf.set(hx + 1, hy - 2, pack('#ffffff')); }
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  return finish(buf, null, ox, oy - ry * 0.4, { mouth: [hx + 3, hy + 1], top: [ox, oy - ry - 3], tail: [ox - rx, oy], bottom: [ox, oy + 3], eyes: [] }, c.outlineP);
}

function rasterBlob(c, p) {
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const L = c.L, H = c.H;
  const w = Math.ceil(L * s * 1.4 + 10), h = Math.ceil(H * s * 1.5 + 10);
  const buf = new PixelBuffer(w, h);
  const ox = Math.floor(w / 2), oy = Math.floor(h / 2);
  const R = c.bodyR;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - ox) / ((L / 2) * s), dy = (y + 0.5 - oy) / ((H / 2) * s);
    const ang = Math.atan2(dy, dx);
    const rr = 1 + 0.12 * Math.sin(ang * 5 + phase * TAU) + 0.08 * Math.sin(ang * 3 - phase * TAU * 2);
    if (dx * dx + dy * dy > rr * rr) continue;
    let col = rampPick(R, clamp01(0.55 - dy * 0.3 - dx * 0.05), x, y);
    if (hash2(x >> 1, y >> 1, 5) > 0.88) col = c.finR[3]; // bits of trash
    if (hash2(x >> 1, y >> 1, 9) > 0.94) col = pack('#c8b25a');
    buf.set(x, y, col);
  }
  // stuck-on junk: a can tab & a sticker
  buf.rect(ox - (L / 2) * s * 0.6, oy - (H / 2) * s * 0.9, 3 * s, 2 * s, pack('#b9c4cc'));
  // droopy eyes
  const ex = ox + L * 0.18 * s, ey = oy - H * 0.12 * s;
  for (const k of [-1, 1]) {
    buf.fillCircle(ex + k * 2.2 * s, ey, 1.6 * s, pack('#f4f0d0'));
    if (!p.blink) buf.set(ex + k * 2.2 * s + 0.5, ey + 0.6 * s, pack('#1a1424'));
    buf.line(ex + k * 2.2 * s - 1.5 * s, ey - 1.2 * s, ex + k * 2.2 * s + 1.5 * s, ey - 0.6 * s, R[0]);
  }
  buf.line(ex - 2 * s, ey + 3 * s, ex + 2 * s, ey + 3.5 * s, pack('#2a1018'));
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  return finish(buf, null, ox, oy, { mouth: [ex + 2, ey + 3], top: [ox, oy - H * 0.6 * s], tail: [ox - L * 0.6 * s, oy], bottom: [ox, oy + H * 0.5 * s], eyes: [] }, c.outlineP);
}

function rasterIconFish(c, p) {
  // A rounded square "app icon" with fins: the Shortcut Fish.
  const phase = p.phase || 0;
  const s = p.scale || 1;
  const size = c.L * s;
  const w = Math.ceil(size + 14), h = Math.ceil(size + 10);
  const buf = new PixelBuffer(w, h);
  const ox = Math.floor(w * 0.55), oy = Math.floor(h / 2);
  const R = c.bodyR;
  const posing = p.expr === 'pose';
  const half = size / 2;
  // tail (hidden while posing)
  if (!posing) {
    const fl = Math.sin(phase * TAU) * 2;
    buf.fillPoly([[ox - half, oy - 2], [ox - half - 6 * s, oy - 4 * s + fl], [ox - half - 5 * s, oy + fl * 0.3], [ox - half - 6 * s, oy + 4 * s + fl], [ox - half, oy + 2]], c.finR[3]);
  }
  for (let y = Math.floor(oy - half); y < oy + half; y++) for (let x = Math.floor(ox - half); x < ox + half; x++) {
    const dx = Math.abs(x + 0.5 - ox) - (half - 2.5), dy = Math.abs(y + 0.5 - oy) - (half - 2.5);
    if (dx > 0 && dy > 0 && dx * dx + dy * dy > 6.25) continue;
    const t = (y - (oy - half)) / size;
    let col = rampPick(R, clamp01(0.8 - t * 0.6), x, y);
    buf.set(x, y, col);
  }
  // glyph: a fish symbol pretending to be an app
  const g = pack('#ffffff');
  buf.fillEllipse(ox + 1, oy, half * 0.45, half * 0.28, g);
  buf.fillPoly([[ox - half * 0.35, oy], [ox - half * 0.65, oy - half * 0.25], [ox - half * 0.65, oy + half * 0.25]], g);
  if (!posing) {
    // shifty eye
    const look = Math.sin(phase * TAU) > 0 ? 1 : 0;
    buf.set(ox + half * 0.25 + look, oy - 1, pack('#1a1424'));
  } else buf.set(ox + half * 0.25, oy - 1, R[0]);
  // shortcut arrow badge
  buf.rect(ox - half, oy + half - 4, 4, 4, pack('#ffffff'));
  buf.line(ox - half + 1, oy + half - 1, ox - half + 3, oy + half - 3, pack('#2a5aa8'));
  if (p.silhouette) for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 0xff000000 | 0x332010;
  return finish(buf, null, ox, oy, { mouth: [ox + half, oy + 1], top: [ox, oy - half - 3], tail: [ox - half - 5, oy], bottom: [ox, oy + half], eyes: [] }, c.outlineP);
}
