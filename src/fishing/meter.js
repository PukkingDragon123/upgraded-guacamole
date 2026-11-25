// [simple24] The fight HUD: ONE centred meter, the catch tube under it and the big SHOCK button.
// [nuke31] Restyled as a polished slice of the OCEAN in a riveted steel porthole console (square pixel art, no
// rounded UI shapes, no light-ray fans, no expanding rings):
//   console  one chunky steel panel (stepped corners, bevels, rivets, corner screws, hazard-stripe inserts) with a
//            recessed porthole window for the meter and a recess for the catch tube (oceanstrip.js consoleArt).
//   meter    a water cross-section: a strip of sky, a rolling surface (a hazy back swell + the front wave with foam
//            crests, two scrolled periodic strips) with sparkles, banded depth water (sunlit aqua -> deep blue with
//            dithered seams), far / mid reef silhouettes, a dancing caustic light net (8 frames) that also dapples the
//            sand, a seabed of rippled sand, pebbles, shells, coral bits and a starfish, sea grass and little plants
//            swaying along the floor (4 frames), giant kelp on rocks at both ends (8 frames, faster with the
//            commotion), tiny background fish drifting across, rising bubble columns, plankton motes.
//   zone     clearer, calm teal water (dithered edges) with a shimmering dithered glow band while you hold it (gold
//            on a beat), marked by two bobbing BUOYS chained to anchor blocks on the sand. The ends: choppy coral water
//            with whitecaps and spray on the left (it RUNS), dark churned amber water with swirling sediment on the
//            right (the line SNAPS). Shield (bosses / mimics): a steel grate over the zone, LOCKED.
//   marker   the hooked fish itself (its voxel icon) swimming in the water: tail wiggle + tilt with its motion (6
//            sheared slices), a bubbly wake (pooled), the line coming down from the console through the surface.
//   beat     a GOLD notch pillar at the centre and a pixel spark sweeping across: press as it crosses the notch.
//   tube     the catch bar: a glass tube filling with ocean water (banded aqua -> blue, a rolling top surface, a
//            curling foam head, bubbles), a red ghost of lost progress, the percentage in crisp pixel text.
//   button   the physical voxel launch button (nukebtn.js).
// 3D voxel words (NOW!, SPIN!, LOCKED ...) stay for the pop-ups. Static layers are baked once per size (zone layers
// per zone width); per frame: ~20 drawImage calls and ~150 fillRects, nothing allocated.
//
//   meterLayout(F) -> {S, u, cx, cy, w, h, x0, x1, by, bh, btn: {cx, cy, r}, panel: {x, y, w, h}}
//   drawMeter(ctx, F, B)          meterRect(F, kind)  kind: 'meter' | 'bar' | 'shock' | 'all'
//   hitShockButton(F, x, y) -> bool

import { TAU, clamp, clamp01, lerp, ease, hash2 } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { voxelFishIcon } from '../fish/fishicon.js';
import { word3D } from './cinematics.js';
import { PAL, pxFrame, pxHalo, pxCaret, unitOf } from './pixui.js';
import { drawNukeButton } from './nukebtn.js';
import {
  stripGeo, baseArt, causticArt, waveArt, plantsArt, kelpArt, zoneArt, glowArt, grateArt, fishSil, buoyArt,
  consoleArt, tubeWaveArt,
} from './oceanstrip.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

const INK = PAL.ink;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixRgb = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const shadeRgb = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))));

const ART = new Map();
function art(key, make) {
  let c = ART.get(key);
  if (!c) { if (ART.size > 160) ART.clear(); c = make(); ART.set(key, c); }
  return c;
}
function paint(w, h, fn) {
  const c = makeCanvas(Math.max(1, w), Math.max(1, h)), g = ctxOf(c);
  const img = g.createImageData(Math.max(1, w), Math.max(1, h)), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    if (!v) continue;
    const i = (y * w + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v[3] ?? 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ layout
let LAY = null;
export function meterLayout(F) {
  const W = F.W, H = F.H;
  if (LAY && LAY.W === W && LAY.H === H) return LAY;
  const S = H / 540, u = unitOf(S);
  const gl = F.gear?.layout?.(W, H);
  const gearLeft = gl ? gl.cx - gl.R - Math.round(22 * S) : W;
  const r = Math.round(34 * S);
  let w = Math.round(Math.min(W * 0.46, 600 * S));
  const cx = Math.round(W / 2);
  // keep clear of the gear on the right and the button on the left
  const maxHalf = Math.min(gearLeft - cx - Math.round(14 * S), cx - r * 2 - Math.round(70 * S));
  w = Math.min(w, Math.round(maxHalf * 2));
  w -= w % (2 * u);
  const h = Math.round(42 * S / u) * u; // [nuke31] a little taller (was 32): room for the sky, the waves and the seabed
  const cy = Math.round(H - 84 * S);
  const x0 = cx - Math.round(w / 2), x1 = x0 + w;
  const by = cy + Math.round(h / 2 + 9 * S), bh = Math.round(13 * S);
  const pad = Math.round(9 * S);
  const panel = { x: x0 - pad, y: cy - Math.round(h / 2) - Math.round(8 * S), w: w + pad * 2, h: 0 };
  panel.h = by + bh + Math.round(8 * S) - panel.y;
  LAY = { W, H, S, u, cx, cy, w, h, x0, x1, by, bh, panel, btn: { cx: x0 - pad - r - Math.round(22 * S), cy: Math.round(cy + 4 * S), r } };
  return LAY;
}

export function meterRect(F, kind = 'meter') {
  const L = meterLayout(F), S = L.S;
  if (kind === 'shock') { const b = L.btn, m = Math.round(8 * S), sx = Math.round(40 * S); return { x: b.cx - b.r - m - sx, y: b.cy - b.r - m - Math.round(12 * S), w: (b.r + m) * 2 + sx, h: (b.r + m) * 2 + Math.round(22 * S) }; }
  if (kind === 'bar') return { x: L.x0 - 4, y: L.by - 4, w: L.w + 8, h: L.bh + 8 };
  const top = L.cy - L.h / 2 - Math.round(44 * S);
  if (kind === 'all') { const b = L.btn; return { x: b.cx - b.r - 8, y: top, w: L.panel.x + L.panel.w - (b.cx - b.r - 8) + 8, h: L.panel.y + L.panel.h + 4 - top }; }
  return { x: L.panel.x - 2, y: top, w: L.panel.w + 4, h: L.cy + L.h / 2 + 8 - top };
}

// The button is a square hit box (with a little slack): fair and simple.
export function hitShockButton(F, x, y) {
  const b = meterLayout(F).btn;
  return Math.abs(x - b.cx) <= b.r + 6 && Math.abs(y - b.cy) <= b.r + 8;
}

// meter units (-1..1) -> screen x
const mx = (L, u) => L.cx + clamp(u, -1.15, 1.15) * (L.w / 2 - L.h * 0.35);

const C = { white: hex('#ffffff'), ink: hex(INK) };

function sparkSprite(s, col) {
  return art(`spk|${s}|${col}`, () => {
    const S = s * 2 + 3, Cc = s + 1, cc = hex(col);
    return paint(S, S, (x, y) => {
      const dx = Math.abs(x - Cc), dy = Math.abs(y - Cc);
      const inside = dx + dy * 2.2 <= s || dy + dx * 2.2 <= s || (dx <= 1 && dy <= 1);
      if (!inside) {
        const near = (dx - 1) + dy * 2.2 <= s || dy - 1 + dx * 2.2 <= s;
        return near ? [...C.ink, 255] : null;
      }
      const k = 1 - (dx + dy) / (s + 1);
      return k > 0.6 ? [255, 255, 255, 255] : [...mixRgb(cc, C.white, k * 0.6), 255];
    });
  });
}

// a pixel chevron pointing dir (+1 right / -1 left), height hh
function chevron(hh, col, dir) {
  return art(`chev|${hh}|${col}|${dir}`, () => {
    const w = Math.ceil(hh * 0.7) + 4, cc = hex(col);
    return paint(w, hh + 4, (x, y) => {
      const yy = y - 2 - hh / 2, xx = dir > 0 ? x - 2 : w - 3 - x;
      const edge = Math.abs(yy) * 0.7;
      const th = Math.max(3, hh * 0.28);
      if (xx >= edge && xx <= edge + th) return xx <= edge + 1 || xx >= edge + th - 1 ? [...C.ink, 255] : [...shadeRgb(cc, yy < 0 ? 0.3 : 0), 255];
      return null;
    });
  });
}

// The SHOCK button: an octagon (corner cut in 2-px steps). face: 'gold' | 'steel' | 'red' | 'beat'.

// ------------------------------------------------------------------ drawing
export function drawMeter(ctx, F, B) {
  const L = meterLayout(F), S = L.S;
  const k = ease.outCubic(clamp01(B.hudIn ?? 1));
  if (k <= 0.01) return;
  const dy = Math.round((1 - k) * 130 * S);
  const shake = F.meterShake > 0 ? Math.round((Math.random() - 0.5) * F.meterShake * 6) : 0;
  ctx.save();
  ctx.translate(shake, dy);
  const t = F.t;
  ctx.drawImage(consoleArt(L), L.panel.x, L.panel.y); // the riveted steel console (baked)
  drawTrack(ctx, F, B, L, t);
  drawBar(ctx, F, B, L, t);
  drawButton(ctx, F, B, L, t);
  ctx.restore();
}

// the bed layer: base + zone water + floor plants frame f, composited per zone width (the 4 frames of the current
// width are kept; a changing width (wrap twist) only re-composites, nothing is re-painted)
const BED = new Map();
function bedArt(L, z, f) {
  const key = `${L.w}|${L.h}|${L.u}|${z}|${f}`;
  let c = BED.get(key);
  if (!c) {
    if (BED.size > 12) BED.clear();
    const base = baseArt(L);
    c = makeCanvas(base.width, base.height);
    const g = ctxOf(c);
    g.drawImage(base, 0, 0); g.drawImage(zoneArt(L, z), 0, 0); g.drawImage(plantsArt(L, f), 0, 0);
    BED.set(key, c);
  }
  return c;
}
// the porthole glass: a light top row, a shade row at the bottom, two short stepped glints (fillRects, no blit)
function drawGlass(ctx, L, x0, y0) {
  const u = L.u;
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x0, y0, L.w, u);
  ctx.fillStyle = 'rgba(8,32,58,0.35)'; ctx.fillRect(x0, y0 + L.h - u, L.w, u);
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  for (let i = 0; i < 6; i++) ctx.fillRect(x0 + (6 + i * 2) * u, y0 + (6 - i) * u, 2 * u, u);
  for (let i = 0; i < 4; i++) ctx.fillRect(x0 + (13 + i * 2) * u, y0 + (6 - i) * u, 2 * u, u);
}

// Bake the strip's layers ahead of the fight (one per call; call while waiting for a bite).
let warmI = 0, warmKey = '';
export function warmMeter(F) {
  const L = meterLayout(F), key = L.w + '|' + L.h;
  if (key !== warmKey) { warmKey = key; warmI = 0; }
  if (warmI >= 35) return; // all baked (7 + 8 x 3 + 4 jobs)
  const z = zq(0.3);
  const jobs = [() => stripGeo(L), () => baseArt(L), () => waveArt(L, false), () => waveArt(L, true), () => consoleArt(L),
    () => bedArt(L, z, 0), () => tubeWaveArt(L.u, L.w)];
  for (let f = 0; f < 8; f++) jobs.push(() => causticArt(L, f), () => kelpArt(L, f, 'left'), () => kelpArt(L, f, 'right'));
  for (let f = 0; f < 4; f++) jobs.push(() => plantsArt(L, f));
  if (warmI < jobs.length) jobs[warmI++]();
}

// the zone width quantised (the zone layers are cached per width)
const zq = (w) => Math.round(w * 50) / 50;

function drawTrack(ctx, F, B, L, t) {
  const S = L.S, u = L.u, zoneW = B.zoneW, shield = !!(B.boss?.shielded || B.shielded); // [crate26] a mimic's shield too
  const y0 = Math.round(L.cy - L.h / 2), x0 = L.x0, w = L.w;
  const G = stripGeo(L), { W, P, sky, sand, sandY } = G;
  const beat = B.beat;
  const zx0 = Math.round(mx(L, -zoneW)), zx1 = Math.round(mx(L, zoneW));
  const stir = Math.abs(B.mv || 0) + (B.lunge ? 1 : 0) + (B.stunned ? 0.6 : 0); // the commotion
  const leftK = clamp01((-B.marker - zoneW) / Math.max(0.1, 1 - zoneW)), rightK = clamp01((B.marker - zoneW) / Math.max(0.1, 1 - zoneW));
  // the bed: sky, banded water, reef silhouettes, the seabed, the zone / danger water and the swaying floor plants
  // (composited once per zone width x 4 sway frames: one blit)
  ctx.drawImage(bedArt(L, zq(zoneW), Math.floor(t * (3 + Math.min(2, stir) * 3)) % 4), x0, y0, w, L.h);
  // tiny background fish drifting across (behind the light)
  for (let i = 0; i < 4; i++) {
    const big = i % 3 === 0 ? 1 : 0, dir = i % 2 ? -1 : 1;
    const sp = fishSil(big, Math.floor(t * 4 + i) % 2, dir, u);
    const sw = sp.width / u, speed = 5 + hash2(i, 1, 91) * 7;
    let cxl = ((t * speed + hash2(i, 2, 91) * W * 3) % (W + 40)) - 20;
    if (dir < 0) cxl = W - cxl - sw;
    const cyl = sky + 5 + Math.floor(hash2(i, 3, 91) * (sand - sky - 14)) + Math.round(Math.sin(t * 0.8 + i * 2) * 1.2);
    const a = Math.max(0, -cxl), b = Math.max(0, cxl + sw - W);
    if (a + b < sw) ctx.drawImage(sp, a * u, 0, (sw - a - b) * u, sp.height, x0 + Math.round(cxl + a) * u, y0 + cyl * u, (sw - a - b) * u, sp.height);
  }
  // the dancing caustic net (8 frames)
  ctx.drawImage(causticArt(L, Math.floor(t * 7) % 8), x0, y0, w, L.h);
  // the rolling surface: a hazy back swell drifting one way, the front wave rolling the other (periodic strips)
  const offB = (P - (Math.floor(t * 4) % P)) % P, offF = Math.floor(t * 9) % P;
  const wb = waveArt(L, true), wf = waveArt(L, false);
  ctx.drawImage(wb, offB * u, 0, w, wb.height, x0, y0 + G.wTop * u, w, wb.height);
  ctx.drawImage(wf, offF * u, 0, w, wf.height, x0, y0 + G.wTop * u, w, wf.height);
  const surfAt = (cx) => G.surf[(clamp(cx, 0, W - 1) + offF) % (W + P)];
  // the zone water (clear calm teal) and the danger ends (coral chop / amber murk)
  if (!shield && (B.inZone || beat)) {
    const a = beat ? 0.7 + 0.3 * (Math.floor(t * 12) % 2) : clamp01(0.45 + 0.25 * Math.sin(t * 3) + B.steady * 0.3);
    ctx.globalAlpha = a;
    ctx.drawImage(glowArt(L, zq(zoneW), Math.floor(t * 5) % 2), x0, y0, w, L.h);
    ctx.globalAlpha = 1;
    if (beat) { ctx.fillStyle = rgba('#ffe46a', 0.14 + 0.1 * (Math.floor(t * 12) % 2)); ctx.fillRect(zx0, y0 + sky * u, zx1 - zx0, (sand - sky) * u); }
  }
  // the left end: choppy whitecaps and spray (more when the marker is out there)
  const zc0 = Math.round((zx0 - x0) / u), zc1 = Math.round((zx1 - x0) / u);
  {
    const lo = 20, hi = zc0 - 5, n = 5 + Math.round(leftK * 5);
    // the chop: short foam dashes tumbling just under the surface
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    if (hi > lo + 4) for (let k = 0; k < 6 + Math.round(leftK * 6); k++) {
      const cx = lo + Math.floor(hash2(k, Math.floor(t * 6 + k * 0.3), 85) * (hi - lo)), s = surfAt(cx);
      ctx.fillRect(x0 + cx * u, y0 + (s + 1 + (k % 3)) * u, (2 + (k % 2)) * u, u);
    }
    if (hi > lo + 4) for (let k = 0; k < n; k++) {
      const cyc = t * (0.9 + leftK * 0.8) + k * 0.41, cell = Math.floor(cyc), ph = cyc - cell;
      const cx = lo + Math.floor(hash2(k, cell, 81) * (hi - lo)), s = surfAt(cx);
      const fw = 1 + Math.round(Math.sin(ph * Math.PI) * 3);
      ctx.globalAlpha = ph < 0.75 ? 1 : (1 - ph) * 4;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0 + (cx - fw) * u, y0 + (s - 1) * u, (fw * 2 + 1) * u, u);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x0 + (cx - fw - 1) * u, y0 + s * u, (fw * 2 + 3) * u, u);
      // spray beads flung up
      ctx.fillStyle = '#ffffff';
      const up = Math.round(ph * 4);
      ctx.fillRect(x0 + (cx - 2 - up) * u, y0 + (s - 2 - up + Math.round(ph * ph * 4)) * u, u, u);
      ctx.fillRect(x0 + (cx + 2 + up) * u, y0 + (s - 3 - up + Math.round(ph * ph * 5)) * u, u, u);
    }
    ctx.globalAlpha = 1;
  }
  // the right end: dark churning water, swirling sediment
  {
    const lo = zc1 + 5, hi = W - 22, n = 6 + Math.round(rightK * 6);
    if (hi > lo + 4) for (let k = 0; k < n; k++) {
      const cx = lo + hash2(k, 4, 83) * (hi - lo), cyl = sky + 5 + hash2(k, 5, 83) * (sand - sky - 9);
      const ang = t * (1.4 + hash2(k, 6, 83) * 1.6 + rightK * 2) + k * 1.7, r = 2 + hash2(k, 7, 83) * 4;
      const px = Math.round(cx + Math.cos(ang) * r), py = Math.round(cyl + Math.sin(ang) * r * 0.55);
      ctx.fillStyle = 'rgba(40,24,8,0.32)'; ctx.fillRect(x0 + (px - 1) * u, y0 + py * u, 3 * u, u);
      const qx = Math.round(cx - Math.cos(ang) * r * 0.7), qy = Math.round(cyl - Math.sin(ang) * r * 0.4);
      ctx.fillStyle = k % 2 ? 'rgba(232,176,96,0.75)' : 'rgba(255,214,150,0.6)'; ctx.fillRect(x0 + qx * u, y0 + qy * u, u, u);
    }
  }
  // bubble columns rising from the floor, plankton motes drifting
  const span = sand - sky;
  for (let c = 0; c < 3; c++) {
    const sx = Math.floor(W * (0.28 + c * 0.24) + hash2(c, 1, 87) * 18);
    const hh = sandY[sx] - sky - 1;
    for (let i = 0; i < 5; i++) {
      const k = (t * (4 + c) / Math.max(1, hh) * 2.2 + i / 5) % 1;
      const by = Math.round(sandY[sx] - 1 - k * hh), bx = sx + Math.round(Math.sin(t * 3 + i * 2 + k * 6) * 1.2);
      const X = x0 + bx * u, Y = y0 + by * u;
      if (i % 2 === 0 && k > 0.15) { // a ring bubble with a highlight
        ctx.fillStyle = 'rgba(230,252,255,0.85)';
        ctx.fillRect(X, Y - u, u, u); ctx.fillRect(X - u, Y, u, u); ctx.fillRect(X + u, Y, u, u); ctx.fillRect(X, Y + u, u, u);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(X - u, Y - u, u, u);
      } else { ctx.fillStyle = 'rgba(230,252,255,0.8)'; ctx.fillRect(X, Y, u, u); }
    }
  }
  ctx.fillStyle = 'rgba(236,255,250,0.55)';
  for (let i = 0; i < 22; i++) {
    if (i === 11) ctx.fillStyle = 'rgba(200,255,190,0.45)';
    const px = Math.floor((hash2(i, 1, 89) * W + t * (0.8 + hash2(i, 2, 89) * 2.2)) % W);
    const py = sky + 3 + Math.floor(hash2(i, 3, 89) * (span - 6) + Math.sin(t * 0.7 + i) * 2);
    if (Math.floor(t * 2 + i) % 7 === 0) continue; // twinkle
    ctx.fillRect(x0 + px * u, y0 + py * u, u, u);
  }
  // buoys at the zone edges, bobbing on the waves, chained to anchor blocks on the sand
  const bk = shield ? 'steel' : beat ? 'gold' : 'calm';
  const lamp = beat ? Math.floor(t * 12) % 2 === 0 : Math.floor(t * 1.5) % 2 === 0 || B.inZone;
  const buoy = buoyArt(bk, u, lamp);
  for (const zc of [zc0, zc1]) {
    const s = surfAt(zc), byc = s - 6;
    const top = y0 + (byc + 8) * u, bottom = y0 + (sandY[clamp(zc, 0, W - 1)] - 1) * u;
    for (let yy = top; yy < bottom; yy += 2 * u) { ctx.fillStyle = (yy / u) % 4 < 2 ? '#2e3c4e' : '#8aa4bc'; ctx.fillRect(x0 + zc * u, yy, u, u); }
    ctx.fillStyle = INK; ctx.fillRect(x0 + (zc - 2) * u, bottom - u, 5 * u, 3 * u);
    ctx.fillStyle = '#5a7490'; ctx.fillRect(x0 + (zc - 1) * u, bottom, 3 * u, u);
    ctx.drawImage(buoy, x0 + (zc - 3) * u, y0 + byc * u);
  }
  // giant kelp on the rocks at both ends (sway faster with the commotion)
  const kfr = Math.floor(t * (5 + stir * 6)) % 8;
  const kl = kelpArt(L, kfr, 'left'), kr = kelpArt(L, (kfr + 3) % 8, 'right');
  ctx.drawImage(kl, x0 - u, y0);
  ctx.drawImage(kr, x0 + w - kr.width + u, y0);
  // sparkles glinting on the surface
  for (let i = 0; i < 6; i++) {
    const cyc = t * 1.6 + i * 0.29, cell = Math.floor(cyc), ph = cyc - cell;
    if (ph > 0.45) continue;
    const cx = 24 + Math.floor(hash2(i, cell, 93) * (W - 48)), s = surfAt(cx);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0 + cx * u, y0 + (s - 1) * u, u, u);
    if (ph > 0.12 && ph < 0.32) { ctx.fillRect(x0 + (cx - 1) * u, y0 + (s - 1) * u, 3 * u, u); ctx.fillRect(x0 + cx * u, y0 + (s - 2) * u, u, 3 * u); }
  }
  // the centre mark: a faint dotted plumb line in the calm water
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let yy = y0 + (sky + 3) * u; yy < y0 + (sand - 2) * u; yy += 3 * u) ctx.fillRect(L.cx, yy, u, u);
  if (shield) {
    ctx.drawImage(grateArt(L, zq(zoneW)), x0, y0, w, L.h);
    word3D(ctx, 'LOCKED', L.cx, L.cy, { t, scale: 0.5 * S, pal: 'white', wobble: 0.4, alpha: 0.9 });
  }
  if (B.twist) drawTwist(ctx, F, B, L, t); // [deep28] the deep fish's personality on the meter
  // lunge warning: foam chevrons racing through the water on the side the fish will shove the marker
  const lu = B.lunge;
  if (lu) {
    const side = -lu.dir; // dir +1 = toward you (the marker goes right) / -1 = away (left)
    const dirS = side < 0 ? -1 : 1;
    const col = lu.stage === 'tele' ? (Math.floor(t * 10) % 2 ? '#ffd23a' : '#ffffff') : '#ff7a66';
    const ch = chevron(Math.round(L.h * 0.5), col, dirS);
    for (let i = 0; i < 3; i++) {
      const ph = (t * 2.5 + i / 3) % 1;
      const uu = dirS * (zoneW + 0.08 + ph * (0.8 - zoneW));
      ctx.globalAlpha = 1 - ph * 0.7;
      ctx.drawImage(ch, Math.round(mx(L, uu) - ch.width / 2), Math.round(L.cy + u - ch.height / 2));
    }
    ctx.globalAlpha = 1;
    if (lu.stage === 'tele') word3D(ctx, dirS < 0 ? 'IT WILL RUN!' : 'IT WILL RUSH!', mx(L, dirS * 0.62), y0 - Math.round(24 * S), { t, scale: 0.45 * S, pal: 'sun', wobble: 0.8 });
  }
  // the beat: the gold notch pillar + the sweeping spark
  if (beat) {
    const cw = Math.max(3 * u, Math.round(mx(L, B.critW) - L.cx));
    const pulse = Math.floor(t * 14) % 2;
    const ny0 = y0 - 6 * u, nh = L.h + 12 * u;
    pxHalo(ctx, L.cx, L.cy, cw * 2, nh, '#ffe46a', 0.7, u);
    const nx = Math.round(L.cx - cw), nw = cw * 2;
    ctx.fillStyle = INK;
    ctx.fillRect(nx - u, ny0 - u, nw + 2 * u, 3 * u); ctx.fillRect(nx - u, ny0 + nh - 2 * u, nw + 2 * u, 3 * u);
    ctx.fillRect(nx - u, ny0, 3 * u, nh); ctx.fillRect(nx + nw - 2 * u, ny0, 3 * u, nh);
    ctx.fillStyle = rgba('#ffe46a', pulse ? 0.5 : 0.32); ctx.fillRect(nx + 2 * u, ny0 + 2 * u, nw - 4 * u, nh - 4 * u);
    ctx.fillStyle = pulse ? '#ffc81e' : '#ffe46a';
    ctx.fillRect(nx, ny0, nw, 2 * u); ctx.fillRect(nx, ny0 + nh - 2 * u, nw, 2 * u); ctx.fillRect(nx, ny0, u, nh); ctx.fillRect(nx + nw - u, ny0, u, nh);
    ctx.fillStyle = '#fffbd0'; ctx.fillRect(nx, ny0, nw, u);
    ctx.fillStyle = '#e8920a'; ctx.fillRect(nx, ny0 + nh - u, nw, u);
    if (beat.stage === 'sweep') {
      const s = Math.round(10 * S);
      const inCrit = Math.abs(beat.x) <= B.critW;
      for (let i = 1; i <= 6; i++) {
        const q = 1 - i / 7;
        const hx = mx(L, beat.x - i * 0.035), hs = Math.max(u, Math.round(s * 0.5 * q));
        ctx.fillStyle = rgba('#fff6a0', q * 0.8);
        ctx.fillRect(Math.round(hx - hs / 2), Math.round(L.cy - hs / 2), hs, hs);
      }
      const sx = mx(L, beat.x);
      pxHalo(ctx, sx, L.cy, s, s, inCrit ? '#ffffff' : '#ffe27a', 0.8, u);
      const sp = sparkSprite(s, inCrit ? '#ffffff' : '#ffd23a');
      ctx.drawImage(sp, Math.round(sx - sp.width / 2), Math.round(L.cy - sp.height / 2));
      word3D(ctx, inCrit ? 'NOW!' : 'SHOCK...', L.cx, y0 - Math.round(58 * S), { t, scale: (inCrit ? 1.05 : 0.6) * S, pal: inCrit ? 'sun' : 'white', wobble: inCrit ? 1.6 : 0.6 });
    } else {
      word3D(ctx, 'GET READY!', L.cx, y0 - Math.round(58 * S), { t, pop: clamp01(beat.t * 5), scale: 0.62 * S, pal: 'sun', wobble: 1 });
    }
  }
  drawMarker(ctx, F, B, L, t, surfAt);
  drawGlass(ctx, L, x0, y0); // the porthole glass
  // [deep28] a dazzle flash whites the meter out for a moment
  if (B.flash > 0.02) {
    ctx.fillStyle = rgba('#fffbe8', clamp01(B.flash) * 0.85);
    ctx.fillRect(x0 - 2 * u, y0 - 6 * u, L.w + 4 * u, L.h + 12 * u);
  }
}

// [deep28] twist overlays (deeptwist.js): the dark zone of a blink, tentacles squeezing a wrap, alarm lamps, the word
function drawTwist(ctx, F, B, L, t) {
  const S = L.S, u = L.u, y0 = L.cy - L.h / 2, tw = B.twist;
  const b = Math.max(2, Math.round(3 * S));
  // alarm: a blinking red / blue square lamp at both ends of the track
  if (B.alarm > 0.02) {
    const on = Math.floor(t * 8) % 2;
    for (const sd of [-1, 1]) {
      const x = Math.round(sd < 0 ? L.panel.x - 8 * S : L.panel.x + L.panel.w + 8 * S), col = (on ^ (sd > 0 ? 1 : 0)) ? '#ff3a4a' : '#4ab0ff';
      const r = Math.round(6 * S);
      ctx.globalAlpha = B.alarm;
      pxHalo(ctx, x, L.cy, r * 2, r * 2, col, 0.9, u);
      pxFrame(ctx, x - r - u, L.cy - r - u, r * 2 + 2 * u, r * 2 + 2 * u, { u, step: 1, fill: [col, col, col], rim: ['#ffffff', col, INK] });
      ctx.globalAlpha = 1;
    }
  }
  // wrap: tentacles creep in from both ends to the zone posts, a row of pale suckers underneath
  if (B.wrapK > 0.02) {
    for (const sd of [-1, 1]) {
      const xa = mx(L, sd * 1.08), xb = mx(L, sd * (B.zoneW + 0.02));
      const n = 22;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        if (k > B.wrapK) break;
        const x = lerp(xa, xb, k), y = L.cy + Math.sin(t * 4 + k * 9 + sd) * L.h * 0.34 * (0.4 + k * 0.6);
        const r = Math.max(2, Math.round(lerp(6, 2.5, k) * S));
        ctx.fillStyle = INK; ctx.fillRect(Math.round(x - r - 1), Math.round(y - r - 1), r * 2 + 2, r * 2 + 2);
        ctx.fillStyle = i % 2 ? '#c8584a' : '#b04a40'; ctx.fillRect(Math.round(x - r), Math.round(y - r), r * 2, r * 2);
        ctx.fillStyle = '#e8a490'; ctx.fillRect(Math.round(x - r), Math.round(y - r), r * 2, 1);
        if (i % 2 === 0) { ctx.fillStyle = '#f8e4d8'; ctx.fillRect(Math.round(x - 1), Math.round(y + r - 2), 2, 2); }
      }
    }
  }
  // blink: the zone goes dark (blue sparkles left behind by the squid's lights)
  if (B.blind > 0.02) {
    const zx0 = Math.round(mx(L, -(B.zoneW0 ?? B.zoneW) - 0.04)), zx1 = Math.round(mx(L, (B.zoneW0 ?? B.zoneW) + 0.04));
    ctx.fillStyle = rgba('#050a1e', 0.94 * B.blind);
    ctx.fillRect(zx0, y0, zx1 - zx0, L.h); // [nuke31] inside the porthole
    ctx.fillStyle = '#4ab8ff';
    for (let i = 0; i < 7; i++) {
      const ph = (t * 1.7 + i * 0.37) % 1;
      if (ph > B.blind) continue;
      const x = zx0 + ((i * 53 + Math.floor(t * 3) * 17) % Math.max(1, zx1 - zx0)), y = y0 + ((i * 29) % Math.max(1, L.h));
      ctx.globalAlpha = 1 - ph; ctx.fillRect(x, y, b, b);
    }
    ctx.globalAlpha = 1;
  }
  // the dazzle charging: the fish's lights build up on the marker (a growing stepped square halo)
  if (B.dazzleTele > 0.02) { const s = Math.round((10 + 24 * B.dazzleTele) * S); pxHalo(ctx, mx(L, B.marker), y0 - Math.round(12 * S), s, s, '#fff2a0', 0.4 + 0.5 * B.dazzleTele, u); }
  if (tw.wordT > 0 && !B.beat) {
    const pop = clamp01((1.6 - tw.wordT) * 6);
    word3D(ctx, tw.word, L.cx, y0 - Math.round(52 * S), { t, pop: Math.min(1, pop + 0.4), scale: 0.5 * S, pal: tw.pal, wobble: 1.2, alpha: clamp01(tw.wordT * 3) });
  }
}

// The marker: the hooked fish swimming in the water strip, hanging on a line from a caret on the frame.

// The bubbly wake behind the marker fish: a small pool (x, y relative to the strip, age, size), no allocation.
const WN = 24, WAKE = new Float32Array(WN * 4);
let wakeT = -1, wakeAcc = 0, wakeCur = 0;
function stepWake(L, t, x, y, back, spd, on) {
  let dt = wakeT < 0 ? 0 : t - wakeT;
  if (dt < 0 || dt > 0.25) { dt = 0; WAKE.fill(0); }
  wakeT = t;
  for (let i = 0; i < WN; i++) {
    const o = i * 4;
    if (WAKE[o + 2] <= 0) continue;
    WAKE[o + 2] -= dt;
    WAKE[o + 1] -= dt * 9 * L.S; // they rise
    WAKE[o] += back * dt * 4 * L.S;
  }
  if (!on) return;
  wakeAcc += dt * (spd * 26);
  while (wakeAcc >= 1) {
    wakeAcc -= 1;
    const o = (wakeCur++ % WN) * 4;
    WAKE[o] = x - L.x0 + (Math.random() - 0.5) * 3 * L.S; WAKE[o + 1] = y - L.cy + (Math.random() - 0.5) * 8 * L.S;
    WAKE[o + 2] = 0.5 + Math.random() * 0.5; WAKE[o + 3] = Math.random() < 0.35 ? 1 : 0;
  }
}
function drawWake(ctx, L, top) {
  const u = L.u;
  for (let i = 0; i < WN; i++) {
    const o = i * 4, age = WAKE[o + 2];
    if (age <= 0) continue;
    const X = Math.round(L.x0 + WAKE[o]), Y = Math.round(L.cy + WAKE[o + 1]);
    if (Y < top || X < L.x0 || X > L.x1) continue;
    ctx.globalAlpha = Math.min(1, age * 2.5);
    if (WAKE[o + 3]) {
      ctx.fillStyle = 'rgba(230,252,255,0.9)';
      ctx.fillRect(X, Y - u, u, u); ctx.fillRect(X - u, Y, u, u); ctx.fillRect(X + u, Y, u, u); ctx.fillRect(X, Y + u, u, u);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(X - u, Y - u, u, u);
    } else { ctx.fillStyle = '#ffffff'; ctx.fillRect(X, Y, u, u); }
  }
  ctx.globalAlpha = 1;
}

// The marker: the hooked fish swimming in the water, the line coming down to it through the surface.
function drawMarker(ctx, F, B, L, t, surfAt) {
  const S = L.S, u = L.u, y0 = Math.round(L.cy - L.h / 2);
  const m = B.marker;
  const x = Math.round(mx(L, m));
  const inZ = B.inZone && !B.boss?.shielded && !B.shielded;
  const red = B.redFlash > 0.3 && Math.floor(t * 16) % 2;
  const col = red ? '#ff3a4a' : B.stunned ? '#bff8ff' : inZ ? (B.centre ? '#ffffff' : '#e6fff4') : Math.abs(m) > 0.8 ? '#ff8a7a' : '#ffffff';
  const vanta = B.vanta || 0; // [deep28] the blackdragon turns ultra-black: only its chin light shows
  const fw = Math.round(48 * S), fh = Math.round(30 * S);
  const mv = B.mv || 0;
  const facing = mv < -0.05 ? -1 : mv > 0.05 ? 1 : m < -0.05 ? -1 : 1;
  const ic = B.markerIcon?.(fw, fh, facing, t) || voxelFishIcon(F.sp, fw, fh, { dir: facing }); // [crate26] a crate rides as itself
  const crate = !!B.markerIcon;
  const fy = Math.round(L.cy + u - (ic ? ic.height / 2 : fh / 2)); // the icon's top
  const spd = Math.abs(mv);
  // the bubbly wake
  const iw = ic ? ic.width : fw;
  stepWake(L, t, x - facing * iw * 0.42, L.cy + u, -facing, spd + (B.lunge?.stage === 'go' ? 0.8 : 0), spd > 0.1 && vanta < 0.5);
  drawWake(ctx, L, y0 + 8 * u);
  if (vanta > 0.02) ctx.globalAlpha = 1 - vanta * 0.94;
  // the line: from a caret on the console's top rail down through the surface to the fish's mouth
  const lx = crate ? x : Math.round(x + facing * iw * 0.36), mouthY = Math.round(fy + (crate ? 2 * u : (ic ? ic.height : fh) * 0.45));
  const lineTop = L.panel.y + 2 * u;
  ctx.fillStyle = INK; ctx.fillRect(lx - u, lineTop, 3 * u, Math.max(0, mouthY - lineTop));
  ctx.fillStyle = col; ctx.fillRect(lx, lineTop, u, Math.max(0, mouthY - lineTop));
  pxCaret(ctx, lx, L.panel.y + 4 * u, 4 * u, 'down', col);
  if (surfAt) { // the line slices the surface: a little foam dimple
    const s = surfAt(Math.round((lx - L.x0) / u));
    ctx.fillStyle = '#ffffff'; ctx.fillRect(lx - 2 * u, y0 + s * u, 2 * u, u); ctx.fillRect(lx + u, y0 + s * u, 2 * u, u);
  }
  if (inZ) pxHalo(ctx, x, L.cy + u, iw * 0.6, (ic ? ic.height : fh) * 0.5, B.centre ? '#ffffff' : '#c8ffe4', 0.3 + 0.12 * Math.sin(t * 8), u);
  if (ic) {
    const bob = B.stunned ? Math.round(Math.sin(t * 40) * 1.5) : Math.round(Math.sin(t * (inZ ? 3 : 7)) * u);
    const ix = Math.round(x - ic.width / 2), iy = fy + bob;
    if (crate) {
      ctx.drawImage(ic, ix, iy);
    } else {
      // six sheared slices: the tail wiggles, the whole body tilts with the motion (nose up when it surges)
      const fq = B.stunned ? 30 : B.lunge?.stage === 'go' ? 22 : inZ ? 8 : 14;
      const amp = (B.stunned ? 1 : B.lunge ? 2.2 : 1.4) * u;
      const tilt = clamp(mv * 4.5, -3, 3) * u * (B.stunned ? 0.3 : 1);
      const n = 6, sw = Math.ceil(ic.width / n);
      for (let j = 0; j < n; j++) {
        const tail = facing > 0 ? j : n - 1 - j; // 0 = tail slice
        const k = [1, 0.6, 0.28, 0.08, 0, 0][tail];
        const lean = (j / (n - 1)) * 2 - 1; // -1 left .. 1 right
        const off = Math.round(Math.sin(t * fq - tail * 0.8) * amp * k - tilt * lean * (facing > 0 ? 1 : -1) * facing);
        const sx = j * sw, ww = Math.min(sw, ic.width - sx);
        if (ww > 0) ctx.drawImage(ic, sx, 0, ww, ic.height, ix + sx, iy + off, ww, ic.height);
      }
    }
  }
  if (vanta > 0.02) {
    ctx.globalAlpha = 1;
    pxHalo(ctx, x, L.cy, 6 * u, 6 * u, '#ff5ab0', 0.9 * vanta, u);
    ctx.fillStyle = '#ff9ad0'; ctx.fillRect(x - u, Math.round(L.cy) - u, 3 * u, 3 * u);
  }
  if (B.redFlash > 0.3) pxHalo(ctx, x, L.cy, fw * 0.6, fh * 0.6, '#ff3a4a', 0.5 * B.redFlash, u);
  // slime: pale drips sliding down the line and the fish
  if (B.slime > 0.05) {
    const ds = Math.max(2, Math.round(3 * S));
    for (let i = 0; i < 4; i++) {
      const ph = (t * (0.5 + i * 0.13) + i * 0.29) % 1;
      const dx = Math.round(((i * 37) % 9 - 4) * S * 1.6), dy = Math.round(lerp(-fh * 0.7, L.h + 4 * S, ph));
      ctx.globalAlpha = B.slime * (1 - ph * 0.6);
      ctx.fillStyle = INK; ctx.fillRect(x + dx - 1, y0 + dy - 1, ds + 2, ds * 2 + 2);
      ctx.fillStyle = '#e4f6d8'; ctx.fillRect(x + dx, y0 + dy, ds, ds * 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + dx, y0 + dy, 1, ds);
    }
    ctx.globalAlpha = 1;
  }
  // SPIN! / EASY! coaching words when the marker strays (not during a beat or stun)
  if (!B.beat && !B.stunned && !B.boss?.shielded && !B.shielded && Math.abs(m) > B.zoneW + 0.04 && B.mode !== 'hookset') {
    const right = m < 0; // the marker is left: spin harder to push it right
    const ax = right ? Math.max(x, mx(L, -0.95)) + Math.round(40 * S) : Math.min(x, mx(L, 0.95)) - Math.round(40 * S);
    const blink = Math.floor(t * 4) % 2;
    word3D(ctx, right ? 'SPIN!' : 'EASY!', ax, L.cy - u, { t, scale: 0.7 * S, pal: right ? 'aqua' : 'coral', wobble: 1, alpha: blink ? 1 : 0.8 });
  }
}

// The catch tube: ocean water filling a glass tube from the left: banded aqua -> blue, a rolling top surface,
// a curling foam head, bubbles, a red ghost of lost progress, the percentage riding the head.
function drawBar(ctx, F, B, L, t) {
  const S = L.S, u = L.u;
  const p = clamp01(B.progress), g = clamp01(B.ghost ?? p);
  const x0 = L.x0, y = L.by, w = L.w, h = L.bh;
  const head = (k) => Math.round(x0 + w * k);
  const rows = Math.max(1, Math.floor(h / u));
  const slosh = (r) => Math.round(Math.sin(t * 7 + r * 0.9) * 1.2 * u + Math.sin(t * 3.1) * u);
  // ghost: lost progress as dim red water
  if (g > p + 0.003) {
    ctx.fillStyle = 'rgba(240,88,74,0.5)';
    ctx.fillRect(head(p), y + 2 * u, Math.max(u, head(g) - head(p)), h - 2 * u);
  }
  if (p > 0.002) {
    const stun = B.stunned && Math.floor(t * 14) % 2;
    const pal = stun ? ['#ffffff', '#c8fbff', '#7ff0ff', '#2fc8e8'] : ['#7ae4f6', '#42c0ea', '#2a9edc', '#1c78c0'];
    const hx = head(p), fillW = hx - x0;
    // the body in bands under a rolling top surface (one blit of a periodic strip)
    const top = y + 2 * u;
    const b1 = Math.round((h - 2 * u) * 0.35), b2 = Math.round((h - 2 * u) * 0.7);
    for (let r = 2; r < rows; r++) {
      const ry = y + r * u, fr = (r * u - 2 * u) / (h - 2 * u);
      ctx.fillStyle = fr < 0.35 ? pal[1] : fr < 0.7 ? pal[2] : pal[3];
      const ex = Math.min(x0 + w, Math.max(x0, hx + (p < 0.995 ? slosh(r) : 0)));
      ctx.fillRect(x0, ry, ex - x0, u);
    }
    void b1; void b2;
    if (!stun && fillW > u) {
      const tw = tubeWaveArt(u, w), off = Math.floor(t * 10) % 24;
      ctx.drawImage(tw, off * u, 0, Math.min(fillW, w), tw.height, x0, top - 2 * u, Math.min(fillW, w), tw.height);
    } else { ctx.fillStyle = pal[0]; ctx.fillRect(x0, top, fillW, u); }
    // the curling foam head
    if (p < 0.995) {
      for (let r = 1; r < rows; r++) {
        const fx = Math.min(x0 + w - u, hx + slosh(r));
        ctx.fillStyle = r % 2 ? '#ffffff' : '#d8faff';
        ctx.fillRect(fx, y + r * u, u, u);
        if (r <= 3) ctx.fillRect(fx + u, y + r * u, Math.min(2, 4 - r) * u, u); // the lip curls over
      }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.min(x0 + w - u, hx + slosh(1) + 2 * u), y + 2 * u, u, u);
    }
    // bubbles rising in the water
    for (let i = 0; i < 6; i++) {
      if (fillW < 8 * u) break;
      const k = (t * (0.9 + hash2(i, 4, 2) * 0.8) + hash2(i, 5, 2)) % 1;
      const bx = Math.round(x0 + 2 * u + hash2(i, 6, 2) * (fillW - 6 * u)), byy = Math.round(y + h - u - k * (h - 3 * u));
      ctx.fillStyle = i % 3 ? 'rgba(255,255,255,0.8)' : '#ffffff';
      ctx.fillRect(bx, byy, u, u);
      if (i % 3 === 0 && k > 0.3) { ctx.fillStyle = 'rgba(230,252,255,0.7)'; ctx.fillRect(bx + u, byy + u, u, u); }
    }
  }
  // the glass: a gloss line along the top and a short bright dash, a darker line at the bottom
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x0 + 4 * u, y + u, w - 8 * u, u);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x0 + 6 * u, y + u, 14 * u, u); ctx.fillRect(x0 + 22 * u, y + u, 3 * u, u);
  ctx.fillStyle = 'rgba(4,20,40,0.35)'; ctx.fillRect(x0 + 4 * u, y + h - u, w - 8 * u, u);
  // the percentage, crisp pixel text riding the head of the water
  const txt = Math.round(p * 100) + '%';
  const tw = measureText(txt, 'normal', u);
  const tx = clamp(head(p) + 5 * u, x0 + 6 * u, x0 + w - tw - 6 * u);
  drawText(ctx, txt, tx, y + Math.round((h - 7 * u) / 2), { scale: u, color: '#ffffff', outline: INK });
  if (B.inZone && !B.beat && B.steady > 0.98) word3D(ctx, 'STEADY x1.35', L.x1 - Math.round(52 * S), L.by + L.bh + Math.round(13 * S), { t, scale: 0.4 * S, pal: 'leaf', wobble: 0.5 });
}

// [nuke31] the SHOCK button is a physical voxel launch button (nukebtn.js)
function drawButton(ctx, F, B, L, t) { drawNukeButton(ctx, F, B, L, t); }

export { TAU, lerp };
