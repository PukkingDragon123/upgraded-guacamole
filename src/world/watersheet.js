// Water surface sheet (phase 5, Water agent). Every ocean draws the receding water plane at its waterline in its back
// pass (installWater wraps the biome, so boats, boxes, fish and splashes drawn later stay in front of it):
//   camera above the water -> a perspective band ABOVE the near waterline whose depth grows with the camera height:
//     a wobbling Fresnel-weighted mirror reflection of the scene behind it, a custom animated normal-mapped water
//     texture (procedural, tileable, baked per ocean palette), sun / moon glints gathered on the light's path,
//     ripple rings, rain pocks and wake trails from the water sim as perspective ellipses, a foam line on the crests
//     and a glossy Frutiger Aero rim;
//   camera under the water -> the surface's underside BELOW the waterline: a total-internal-reflection mirror of
//     the water below, bright wave light and rings seen from beneath.
// The two blend through zero as the camera crosses the surface, which is the smooth above/below-water transition.
// installWater also folds the water sim (Gerstner swell + simulated waves) into the biome's live waterline
// (biome.ys), so everything that reads ocean.waveAt(x) (boat, floaters, particles, buoys, the WebGL pass) rides
// one simulated surface.
//
//   installWater(biome)               idempotent; adds biome.drawWaterSheet(ctx, env), which a biome may call itself at
//                                     the right depth of its back pass (before the things floating at its waterline);
//                                     otherwise the above-water sheet is drawn at the end of drawBack. The underside
//                                     (camera under water) is always drawn at the end of drawBack, over the biome's
//                                     own under-surface glow. biome.drawOverSheet(ctx, env), if defined, runs last.
//   drawWaterSheet(biome, ctx, env, part = 'top' | 'under')   ctx under the world camera transform

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { clamp, clamp01, bayer, hash2 } from '../core/math.js';
import { hexToRgb, mix } from '../core/color.js';
import { todWeights } from './scenery.js';
import { skyBodies } from './sky.js';
import { waterPalette } from './watersim.js';

const TAU = Math.PI * 2;
const TW = 256, TH = 32, NF = 24;   // texture tile, rows (far -> near), frames per loop
const MAXB = 18, MAXU = 10;          // band depth caps (world px) above / below the water
const KB = 0.36, KU = 0.12;          // band depth per world px of camera height above / below the surface

// ------------------------------------------------------------------ the custom water texture
// Height field of five directional wave trains over a perspective strip (row 0 = far edge, TH-1 = near edge).
// Horizontal frequencies foreshorten with depth; each row cross-fades the two nearest whole harmonics, so every row
// still tiles across TW. The shading term is stored per frame (palette independent) and coloured per ocean.
const WAVES = [
  { m: 3, n: 1.3, c: 1, a: 1.0, p: 0.2 }, { m: 5, n: -2.2, c: -1, a: 0.62, p: 1.9 }, { m: 8, n: 3.4, c: 2, a: 0.4, p: 3.1 },
  { m: 13, n: -4.6, c: 2, a: 0.24, p: 4.4 }, { m: 21, n: 6.3, c: -3, a: 0.13, p: 0.7 },
];
const fields = [];
function buildField(f) {
  const H = new Float32Array(TW * (TH + 2));
  for (let r = -1; r <= TH; r++) {
    const v = clamp01((r + 0.5) / TH), Zp = 1 / (0.16 + 0.84 * v);
    const row = (r + 1) * TW;
    for (const w of WAVES) {
      const M = w.m * Math.pow(Zp, 0.55), M0 = Math.floor(M), fM = M - M0;
      const psi = TAU * (w.n * Zp * 0.3 + (w.c * f) / NF) + w.p;
      const k0 = (TAU * M0) / TW, k1 = (TAU * (M0 + 1)) / TW;
      const a0 = w.a * (1 - fM), a1 = w.a * fM;
      for (let u = 0; u < TW; u++) H[row + u] += a0 * Math.sin(k0 * u + psi) + a1 * Math.sin(k1 * u + psi);
    }
  }
  const I = new Int8Array(TW * TH);
  for (let r = 0; r < TH; r++) {
    const v = (r + 0.5) / TH;
    for (let u = 0; u < TW; u++) {
      const c = (r + 1) * TW;
      const sx = H[c + ((u + 1) % TW)] - H[c + ((u + TW - 1) % TW)];
      const sz = H[c + TW + u] - H[c - TW + u];
      // faces tilted toward the viewer catch the sky, crests get a little lift, troughs shade
      const k = (-sz * (1.6 - v * 0.7) + sx * 0.35 + H[c + u] * 0.22) * (0.75 + v * 0.35);
      I[r * TW + u] = Math.max(-127, Math.min(127, Math.round(k * 64)));
    }
  }
  fields[f] = I;
}

const frameCache = { key: '', frames: [] };
// coloured frame f for palette pal (built lazily, a few per call)
function sheetFrame(pal, f) {
  const key = pal.sheen + pal.trough + pal.glint;
  if (frameCache.key !== key) { frameCache.key = key; frameCache.frames = []; }
  const fr = frameCache.frames;
  let built = 0;
  for (let i = 0; i < NF && built < 3; i++) {
    if (fr[i]) continue;
    if (!fields[i]) buildField(i);
    fr[i] = colourFrame(fields[i], pal);
    built++;
  }
  let i = ((f % NF) + NF) % NF;
  while (!fr[i] && i > 0) i--;
  return fr[i] || null;
}

function colourFrame(I, pal) {
  const c = makeCanvas(TW, TH), g = ctxOf(c);
  const img = g.createImageData(TW, TH), d = img.data;
  const S = hexToRgb(pal.sheen), T = hexToRgb(pal.trough), G = hexToRgb(pal.glint);
  for (let r = 0; r < TH; r++) {
    const v = (r + 0.5) / TH;
    for (let u = 0; u < TW; u++) {
      const k = I[r * TW + u] / 64, o = (r * TW + u) * 4, b = bayer(u, r);
      if (k > 0.3) {
        // three quantised highlight levels, dithered between
        const lv = Math.min(3, Math.floor((k - 0.3) * 3.2 + b));
        if (lv <= 0) continue;
        const col = lv >= 3 ? G : S;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
        d[o + 3] = Math.round([0, 96, 168, 245][lv] * (0.45 + v * 0.55));
      } else if (k < -0.45) {
        const lv = Math.min(2, Math.floor((-k - 0.45) * 2.6 + b));
        if (lv <= 0) continue;
        d[o] = T[0]; d[o + 1] = T[1]; d[o + 2] = T[2];
        d[o + 3] = Math.round([0, 64, 116][lv] * (0.5 + v * 0.5));
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ crisp pixel ellipses (ripple rings)
const ringCache = new Map();
function ringSprite(rx, ry, col, dark = null) {
  rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
  const key = rx + '|' + ry + col + dark;
  let c = ringCache.get(key);
  if (c) return c;
  c = makeCanvas(rx * 2 + 3, ry * 2 + 3);
  const g = ctxOf(c);
  const plot = (Rx, Ry, colour, near, far, side) => {
    const steps = Math.max(12, Math.round((Rx + Ry) * 2.4));
    const seen = new Set();
    g.fillStyle = colour;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU;
      const x = Math.round(rx + 1 + Math.cos(a) * Rx), y = Math.round(ry + 1 + Math.sin(a) * Ry);
      const k = x + y * 1000;
      if (seen.has(k)) continue;
      seen.add(k);
      // the near half (lower) faces the viewer and catches more light than the far half
      g.globalAlpha = Math.sin(a) > 0.2 ? near : Math.sin(a) < -0.45 ? far : side;
      g.fillRect(x, y, 1, 1);
    }
  };
  // a shaded trough just inside the bright crest makes the ripple read as a raised ring
  if (dark && ry >= 3 && rx >= 5) plot(rx - 1, ry - 1, dark, 0.5, 0.25, 0.35);
  plot(rx, ry, col, 1, 0.7, 0.85);
  if (ringCache.size > 900) ringCache.clear();
  ringCache.set(key, c);
  return c;
}

const glintCache = new Map();
function glintSprite(n, col) {
  const key = n + col;
  let c = glintCache.get(key);
  if (c) return c;
  const s = n * 2 + 1;
  c = makeCanvas(s, s);
  const g = ctxOf(c);
  g.fillStyle = col;
  g.fillRect(n, n, 1, 1);
  for (let i = 1; i <= n; i++) {
    g.globalAlpha = i === n ? 0.45 : 0.85;
    g.fillRect(n - i, n, 1, 1); g.fillRect(n + i, n, 1, 1);
    if (i < n) { g.fillRect(n, n - i, 1, 1); g.fillRect(n, n + i, 1, 1); }
  }
  glintCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ install

let liftBuf = null;
let warned = false;
function foldLift(b) {
  const sim = b.game?.water?.sim, ys = b.ys;
  if (!sim || !ys || !b.W) return;
  if (!liftBuf || liftBuf.length < ys.length) liftBuf = new Int16Array(ys.length + 8);
  sim.fillLift(liftBuf, Math.min(b.W, ys.length - 1));
  for (let x = 0; x <= b.W && x < ys.length; x++) ys[x] -= liftBuf[x];
  if (ys.length > b.W + 1) ys[b.W + 1] = ys[b.W];
}

export function installWater(biome) {
  if (!biome || biome.__water) return;
  biome.__water = true;
  const up = biome.update.bind(biome), back = biome.drawBack.bind(biome);
  biome.update = (dt, env) => { up(dt, env); foldLift(biome); };
  const safe = (ctx, env, part) => {
    try { drawWaterSheet(biome, ctx, env, part); } catch (e) { if (!warned) { warned = true; console.warn('water sheet', e); } }
  };
  biome.drawWaterSheet = (ctx, env) => safe(ctx, env, 'top');
  biome.drawBack = (ctx, env) => {
    biome.__sheetDone = false;
    back(ctx, env);
    if (!biome.__sheetDone) safe(ctx, env, 'top');
    safe(ctx, env, 'under');
    if (biome.drawOverSheet) { try { biome.drawOverSheet(ctx, env); } catch (e) { if (!warned) { warned = true; console.warn('water sheet', e); } } }
  };
}

// ------------------------------------------------------------------ drawing

const tmp = { c: null, g: null };
function scratch(w, h) {
  if (!tmp.c || tmp.c.width < w || tmp.c.height < h) {
    tmp.c = makeCanvas(Math.max(w, tmp.c?.width || 0), Math.max(h, tmp.c?.height || 0));
    tmp.g = ctxOf(tmp.c);
  }
  return tmp;
}

export function drawWaterSheet(b, ctx, env, part = 'top') {
  if (part === 'top') b.__sheetDone = true;
  const g = b.game, water = g?.water, sim = water?.sim;
  let s = null;
  try { s = b.ocean?.waterLevel?.(); } catch { s = null; }
  const ys = b.ys;
  if (!Number.isFinite(s) || !ys || !b.W || g?.state?.view === 'aquarium' || water?.sheetOff) return;
  const m = ctx.getTransform();
  const z = Math.hypot(m.a, m.b) || 1, ox = m.e, oy = m.f;
  const CW = ctx.canvas.width, CH = ctx.canvas.height;
  const e = s - (CH / 2 - oy) / z; // camera height above the still surface (world px)
  if ((part === 'top') !== (e > -2)) return;
  const W = b.W;
  const tod = todWeights(env);
  const pal = waterPalette(b.waterPaletteId || b.id, env.daylight ?? 1, tod.dusk);
  const t = water?.time ?? env.time ?? 0;
  const lowQ = !!g?.lowPower;
  const S = {
    b, ctx, ys, s, z, ox, oy, CW, CH, W, pal, t, lowQ, sim, env, tod,
    x0: clamp(Math.floor(-ox / z) - 1, 0, W), x1: clamp(Math.ceil((CW - ox) / z) + 1, 0, W),
    YS: Math.round(s * z + oy),
    xs: (x) => Math.round(x * z + ox),
    yn: (x) => Math.round(ys[x] * z + oy),
  };
  if (S.x1 <= S.x0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (e > 2) drawTop(S, Math.min(MAXB, (e - 2) * KB));
  else if (e < -2) drawUnder(S, Math.min(MAXU, (-e - 2) * KU));
  drawRim(S, e);
  ctx.restore();
}

// --- camera above the water: the far water plane rises from the near waterline to the far edge
function drawTop(S, hb) {
  const { ctx, z, oy, CW, CH, pal, t, lowQ, x0, x1, xs, yn, ys, s } = S;
  const hbS = Math.round(hb * z);
  if (hbS < 2) return;
  const YF = Math.round((s - hb) * z + oy);
  if (YF >= CH || S.YS + 24 * z < 0) return;
  // clip: flat far edge on top, the live wave line at the bottom
  const path = new Path2D();
  path.moveTo(xs(x0), YF);
  path.lineTo(xs(x1 + 1), YF);
  let maxY = YF + 1;
  for (let x = x1; x >= x0;) {
    let x2 = x;
    while (x2 - 1 >= x0 && ys[x2 - 1] === ys[x]) x2--;
    const y = Math.max(YF + 1, yn(x));
    path.lineTo(xs(x + 1), y);
    path.lineTo(xs(x2), y);
    if (y > maxY) maxY = y;
    x = x2 - 1;
  }
  path.closePath();
  const L = xs(x0), R = xs(x1 + 1), BH = maxY - YF;
  // the reflection source: rows right above the far edge, copied before we paint over anything
  let refl = null;
  const RH = Math.min(BH + 1, YF);
  if (!lowQ && RH > 1 && pal.reflect > 0) {
    refl = scratch(CW, RH);
    refl.g.clearRect(0, 0, CW, RH);
    refl.g.drawImage(ctx.canvas, 0, YF - RH, CW, RH, 0, 0, CW, RH);
  }
  ctx.save();
  ctx.clip(path);
  // body: grazing horizon sheen far away, open-water blue near
  const gr = ctx.createLinearGradient(0, YF, 0, YF + hbS);
  gr.addColorStop(0, pal.horizon);
  gr.addColorStop(0.3, mix(pal.horizon, pal.surface, 0.62));
  gr.addColorStop(0.72, pal.surface);
  gr.addColorStop(1, mix(pal.surface, pal.deep, 0.3));
  ctx.fillStyle = gr;
  ctx.fillRect(L, YF, R - L, BH + 1);
  // mirror: wobbling rows, strong at grazing angles (far), weaker looking down (near)
  if (refl) {
    for (let r = 0; r < BH; r++) {
      const v = clamp01(r / hbS);
      const src = RH - 1 - Math.min(RH - 1, r);
      const wob = Math.round(Math.sin(r * 0.83 - t * 2.4) * (0.4 + v * 1.6) + Math.sin(r * 0.31 + t * 1.3 + 1.7) * (0.3 + v * 1.4));
      ctx.globalAlpha = pal.reflect * (0.82 - 0.68 * v);
      ctx.drawImage(refl.c, 0, src, CW, 1, wob, YF + r, CW, 1);
    }
    ctx.globalAlpha = 1;
  }
  // the animated normal-mapped texture (pans with the world, drifts with the wind)
  const fr = sheetFrame(pal, Math.floor(t * 11));
  if (fr) {
    const pat = ctx.createPattern(fr, 'repeat');
    pat.setTransform(new DOMMatrix([z / 2, 0, 0, hbS / TH, Math.round(S.ox + t * 4 * z), YF]));
    ctx.fillStyle = pat;
    ctx.fillRect(L, YF, R - L, BH + 1);
  }
  // a soft white haze line at the far edge (where the plane meets the distance)
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = pal.horizon;
  ctx.fillRect(L, YF, R - L, 1);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  drawGlints(S, YF, hbS, false);
  ctx.globalCompositeOperation = 'source-over';
  drawRings(S, hb, hbS, false);
  ctx.restore();
}

// --- camera under the water: the underside of the surface hangs below the waterline down to its far edge
function drawUnder(S, hu) {
  const { ctx, z, oy, CW, CH, pal, t, lowQ, x0, x1, xs, yn, ys, s } = S;
  const huS = Math.round(hu * z);
  if (huS < 2) return;
  const YB = Math.round((s + hu) * z + oy);
  if (YB <= 0 || S.YS - 24 * z > CH) return;
  const path = new Path2D();
  let minY = YB - 1;
  path.moveTo(xs(x0), YB);
  for (let x = x0; x <= x1;) {
    let x2 = x;
    while (x2 + 1 <= x1 && ys[x2 + 1] === ys[x]) x2++;
    const y = Math.min(YB - 1, yn(x) + Math.max(1, Math.round(z)));
    path.lineTo(xs(x), y);
    path.lineTo(xs(x2 + 1), y);
    if (y < minY) minY = y;
    x = x2 + 1;
  }
  path.lineTo(xs(x1 + 1), YB);
  path.closePath();
  const L = xs(x0), R = xs(x1 + 1), BH = YB - minY;
  let refl = null;
  const RH = Math.min(BH + 1, CH - YB);
  if (!lowQ && RH > 1) {
    refl = scratch(CW, RH);
    refl.g.clearRect(0, 0, CW, RH);
    refl.g.drawImage(ctx.canvas, 0, YB, CW, RH, 0, 0, CW, RH);
  }
  ctx.save();
  ctx.clip(path);
  const gr = ctx.createLinearGradient(0, YB - huS, 0, YB);
  gr.addColorStop(0, mix(pal.under, pal.surface, 0.25));
  gr.addColorStop(1, mix(pal.under, pal.surface, 0.6));
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = gr;
  ctx.fillRect(L, minY, R - L, BH + 1);
  if (refl) {
    // total internal reflection: the water below, mirrored about the far edge
    for (let r = 0; r < BH; r++) {
      const v = clamp01(r / huS); // 0 at the far edge .. 1 at the waterline
      const wob = Math.round(Math.sin(r * 0.9 + t * 2.1) * (0.5 + v * 1.4) + Math.sin(r * 0.4 - t * 1.2) * v);
      ctx.globalAlpha = 0.55 * (1 - v * 0.4);
      ctx.drawImage(refl.c, 0, Math.min(RH - 1, r), CW, 1, wob, YB - 1 - r, CW, 1);
    }
  }
  ctx.globalAlpha = 1;
  const fr = sheetFrame(pal, Math.floor(t * 11));
  if (fr) {
    // seen from below: the same waves, flipped: bright crests and shaded troughs
    ctx.globalAlpha = 0.9;
    const pat = ctx.createPattern(fr, 'repeat');
    pat.setTransform(new DOMMatrix([z / 2, 0, 0, -huS / TH, Math.round(S.ox + t * 4 * z), YB]));
    ctx.fillStyle = pat;
    ctx.fillRect(L, minY, R - L, BH + 1);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    drawGlints(S, YB, -huS, true);
    ctx.globalCompositeOperation = 'source-over';
  }
  drawRings(S, hu, huS, true);
  ctx.restore();
}

// sun / moon glints: twinkling stars gathered on the light's reflection path plus a scatter across the sheet
function drawGlints(S, Y0, hS, under) {
  const { ctx, b, s, W, pal, t, lowQ, tod, env, xs } = S;
  const B = skyBodies(env.hour ?? 12, W, b.top ?? -400, s);
  const night = tod.night > 0.5;
  const light = night ? B.moon : B.sun;
  const k0 = (night ? 0.45 : 0.75 + tod.day * 0.25) * (light.up ? 1 : 0.4) * (under ? 0.55 : 1) * (b.wx?.clear ?? 1);
  if (k0 < 0.05) return;
  const n = lowQ ? 12 : 30;
  const H = Math.abs(hS);
  for (let i = 0; i < n; i++) {
    const rate = 0.7 + (i % 7) * 0.13;
    const ph = t * rate + i * 0.618;
    const ep = Math.floor(ph);
    const k = Math.sin((ph - ep) * Math.PI);
    if (k < 0.2) continue;
    const h1 = hash2(i, ep, 31), h2 = hash2(i, ep, 32), h3 = hash2(i, ep, 33);
    const onPath = i % 3 !== 0;
    const wx = onPath ? light.x + (h1 - 0.5) * (40 + h2 * 140) : h1 * W;
    const v = onPath ? 0.15 + h2 * 0.85 : h2;
    const x = xs(wx), y = Math.round(Y0 + Math.sign(hS) * v * (H - 1));
    const size = k > 0.8 && h3 > 0.55 ? 2 : k > 0.5 ? 1 : 0;
    const spr = glintSprite(size, h3 > 0.7 ? pal.glint : pal.sheen);
    ctx.globalAlpha = k * k0 * (0.55 + v * 0.45);
    ctx.drawImage(spr, x - size, y - size);
  }
  ctx.globalAlpha = 1;
}

// ripple rings, rain pocks and wakes from the sim as perspective ellipses on the sheet
function drawRings(S, hb, hS, under) {
  const { ctx, sim, z, pal, ys, s, xs, x0, x1 } = S;
  if (!sim?.rings?.length) return;
  const flat0 = 0.14 + 0.32 * clamp01(hb / (under ? MAXU : MAXB));
  const sgn = under ? 1 : -1;
  for (const r of sim.rings) {
    if (r.t < 0) continue;
    const k = r.t / r.life;
    if (k >= 1 || r.x < x0 - 60 || r.x > x1 + 60) continue;
    const zr = r.z, sc = 1 - zr * 0.7;
    const rad = (r.r0 + r.speed * r.t) * z * sc;
    const rx = Math.max(1, Math.round(rad)), ry = Math.max(1, Math.round(rad * flat0 * (0.55 + 0.45 * sc)));
    const xi = clamp(Math.round(r.x), 0, S.W);
    // near rings ride the live wave, far ones sit on the flat distant plane
    const yLive = (ys[xi] - s) * z * (1 - zr);
    const cy = Math.round(S.YS + yLive + sgn * zr * Math.abs(hS) + (under ? Math.round(z) : -1));
    const fade = Math.pow(1 - k, 1.1);
    const a = r.a * fade;
    if (a < 0.03) continue;
    const col = r.kind === 'rain' ? pal.sheen : pal.crest;
    const cx = xs(r.x);
    // [phase7:env] no expanding rings: a pixel-art splash instead - droplets hop out along the (perspective) ripple
    // front and land as foam specks that drift outward and fade
    const n = r.kind === 'rain' ? 2 : clamp(Math.round(rx / 2.2), 5, 16);
    const seed = Math.round(r.x * 7 + (r.z || 0) * 1000 + r.life * 100);
    for (let i = 0; i < n; i++) {
      const h1 = hash2(i, seed, 41), h2 = hash2(i, seed, 42);
      const ang = (i / n) * TAU + h1 * 0.7;
      const rr = 0.55 + 0.45 * h2;
      const px = Math.round(cx + Math.cos(ang) * rx * rr), py0 = Math.round(cy + Math.sin(ang) * ry * rr);
      const hopK = clamp01(k / 0.4), hop = !under && r.kind !== 'rain' && hopK < 1 ? Math.round(Math.sin(hopK * Math.PI) * (2 + h1 * 4) * Math.max(1, z * 0.6)) : 0;
      const sz = hop > 0 && h2 > 0.55 ? 2 : 1;
      ctx.globalAlpha = Math.min(1, a * (hop ? 1 : 0.8));
      ctx.fillStyle = hop ? col : (i & 1 ? pal.sheen : col);
      ctx.fillRect(px, py0 - hop, sz, sz);
      if (!hop && sz === 1 && rx > 8 && h1 > 0.6) ctx.fillRect(px + (Math.cos(ang) > 0 ? 1 : -1), py0, 1, 1);
    }
    if (r.kind === 'rain' && r.t < 0.12 && !under) {
      // the drop's own little jump
      ctx.globalAlpha = 0.9 * (1 - r.t / 0.12);
      ctx.fillStyle = pal.crest;
      ctx.fillRect(cx, cy - 1 - Math.round(r.t * 30), 1, Math.max(1, Math.round(z * 0.5)));
    }
  }
  ctx.globalAlpha = 1;
}

// the glossy rim and foam along the near waterline (both views)
function drawRim(S, e) {
  const { ctx, z, pal, x0, x1, xs, yn, ys, sim, t, lowQ } = S;
  const above = e > -2;
  // glossy rim: a crisp 1 px highlight on top of the near edge (on its underside when looking from below)
  ctx.fillStyle = pal.crest;
  ctx.globalAlpha = above ? 0.85 : 0.6;
  for (let x = x0; x <= x1;) {
    let x2 = x;
    while (x2 + 1 <= x1 && ys[x2 + 1] === ys[x]) x2++;
    const y = yn(x) + (above ? -1 : Math.round(z) + 1);
    ctx.fillRect(xs(x), y, xs(x2 + 1) - xs(x), 1);
    x = x2 + 1;
  }
  if (!sim) { ctx.globalAlpha = 1; return; }
  // foam on steep / fast crests: dithered white caps riding the near edge (whitecaps on every crest in rough weather)
  ctx.fillStyle = pal.foam;
  const step = lowQ ? 2 : 1;
  let swA = 0;
  for (const w of sim.swell || []) swA += w.A;
  const rough = clamp01((swA - 2.2) / 3);
  for (let x = x0; x <= x1; x += step) {
    const yl = ys[Math.max(0, x - 4)], yr = ys[Math.min(S.W, x + 4)];
    const sl = Math.abs((ys[Math.min(S.W, x + 2)] ?? ys[x]) - (ys[Math.max(0, x - 2)] ?? ys[x])) * 0.25;
    const crest = rough > 0 ? clamp01((yl + yr - 2 * ys[x]) * 0.4) * rough : 0;
    const f = Math.min(1, sim.foamAt(x) * 1.2 + (sl > 0.7 ? (sl - 0.7) * 0.6 : 0) + crest);
    if (f < 0.12) continue;
    const y0 = yn(x), px = xs(x), w = Math.max(1, xs(x + 1) - px);
    const hgt = Math.round(f * 2.4 * Math.max(1, z * 0.75)) + 1;
    for (let j = 0; j < hgt; j++) {
      const k = 1 - j / (hgt + 0.5);
      for (let i = 0; i < w; i++) {
        if (bayer(px + i + Math.floor(t * 6), y0 + j) > f * k * 1.1) continue;
        ctx.globalAlpha = 0.95;
        ctx.fillRect(px + i, above ? y0 - 1 - j : y0 + j, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
}
