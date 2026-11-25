// [nuke31] Baked pixel-art layers for the fight meter's slice of the ocean (meter.js draws them). Every layer is
// painted once per size at CELL resolution (1 cell = the HUD pixel unit u) and scaled up by nearest neighbour; the
// per-frame cost is a handful of drawImage calls (each layer is one blit, animated ones pick a cached frame or a
// scroll offset) plus a few dozen fillRects. Nothing here allocates per frame.
//
//   stripGeo(L)          rows (cells): sky (mean waterline), amp (wave amplitude), wTop / wH (wave strip), sand,
//                        P (wave / caustic period), W / H (cells), sandY (Int16Array per column), surf (Int8Array
//                        per column of the front wave, period P)
//   baseArt(L)           sky + banded depth water + far / mid reef silhouettes + the seabed (rippled sand, pebbles,
//                        shells, coral bits, a starfish, rocks under the kelp at both ends)
//   causticArt(L, f)     8 frames of a caustic light net (Voronoi cell edges, denser / brighter near the surface,
//                        warm light patches on the sand)
//   waveArt(L, back)     the rolling surface (front wave with foam crests, a hazier back swell), period P, scrolled
//   plantsArt(L, f)      4 sway frames of sea-grass tufts and little plants along the floor
//   kelpArt(L, f, side)  8 sway frames of a giant kelp clump (stipes, long blades, gas bulbs) for each end
//   zoneArt(L, zq)       alpha overlay: calm, clearer teal water in the sweet zone (dithered edges), choppy coral
//                        water toward the left end, dark churned amber water toward the right end
//   glowArt(L, zq, f)    2 frames of a dithered shimmering glow band in the zone
//   grateArt(L, zq)      the steel grate over a LOCKED (shielded) zone
//   fishSil(n, f, dir)   tiny background fish silhouettes (2 sizes, 2 tail frames)
//   buoyArt(kind, u)     the zone marker buoys (calm / gold / steel)
//   consoleArt(L)        the chunky riveted steel console (stepped corners, recessed porthole window for the strip,
//                        the tube's recess with metal end collars, hazard-stripe inserts, corner screws)
//   tubeWaveArt(u)       the rolling top surface of the catch tube's water (period 24 cells)

import { TAU, clamp, clamp01, hash2, fbm2, bayer } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PAL } from './pixui.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

export const OC = {
  sky: ['#a6e2f8', '#c6eefc', '#e2f9ff'].map(hex),
  wb: ['#52d2f2', '#40c4ee', '#38b8e8', '#249ad8', '#1a7ac4', '#145ea8', '#0f4688'].map(hex),
  deep: hex('#0b3468'),
  sand: ['#fff2c4', '#f2da96', '#e0c47e', '#caa866', '#ab8a4e'].map(hex),
  calm: hex('#a8fff0'), coral: hex('#ff6a5a'), murk: hex('#5a3812'), amber: hex('#ffa63a'),
  rock: ['#9aacbc', '#768a9c', '#56687a', '#3c4c5e'].map(hex), moss: ['#a8e070', '#5aa04a'].map(hex),
};
export const WAVE_TOP = '#f4ffff';

const ART = new Map();
function art(key, make) {
  let c = ART.get(key);
  if (!c) { if (ART.size > 220) ART.clear(); c = make(); ART.set(key, c); }
  return c;
}
// paint a w x h cell image with fn(x, y) -> [r, g, b, a?] | null, upscaled by u (nearest)
function paintCells(w, h, u, fn, after) {
  const c = makeCanvas(Math.max(1, w), Math.max(1, h)), g = ctxOf(c);
  const img = g.createImageData(Math.max(1, w), Math.max(1, h)), d = img.data;
  if (fn) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    if (!v) continue;
    const i = (y * w + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v[3] ?? 255;
  }
  g.putImageData(img, 0, 0);
  if (after) after(g);
  if (u === 1) return c;
  const o = makeCanvas(w * u, h * u), og = ctxOf(o);
  og.drawImage(c, 0, 0, w * u, h * u);
  return o;
}

// ------------------------------------------------------------------ geometry
export function stripGeo(L) {
  return art(`geo|${L.w}|${L.h}|${L.u}`, () => {
    const u = L.u, W = Math.max(8, Math.round(L.w / u)), H = Math.max(12, Math.round(L.h / u)), S = L.S / u;
    const sky = Math.max(4, Math.round(7 * S)), amp = Math.max(1, Math.round(1.7 * S));
    const wTop = sky - amp - 2, wH = amp * 2 + 6;
    const sand = H - Math.max(4, Math.round(7 * S));
    const P = 64;
    const sandY = new Int16Array(W);
    for (let x = 0; x < W; x++) sandY[x] = sand + Math.round((fbm2(x / 13, 3.7, 3, 5) - 0.5) * 4);
    const surf = new Int8Array(W + P);
    for (let x = 0; x < W + P; x++) {
      const a = (x / P) * TAU;
      surf[x] = sky + Math.round(amp * (0.55 * Math.sin(a) + 0.32 * Math.sin(2 * a + 1.3)) + 0.55 * Math.sin(4 * a + 0.4));
    }
    return { u, W, H, S, sky, amp, wTop, wH, sand, P, sandY, surf };
  });
}

// ------------------------------------------------------------------ the static base
export function baseArt(L) {
  return art(`base|${L.w}|${L.h}|${L.u}`, () => {
    const G = stripGeo(L), { W, H, sky, amp, sandY } = G;
    const far = new Int16Array(W), mid = new Int16Array(W);
    const span = G.sand - sky;
    for (let x = 0; x < W; x++) {
      far[x] = Math.round(G.sand - (0.16 + 0.42 * fbm2(x / 30, 1.5, 3, 7)) * span);
      mid[x] = Math.round(G.sand - (0.02 + 0.3 * fbm2(x / 17, 8.5, 3, 11)) * span);
    }
    const lit = hex('#7ee4f6');
    const img = (x, y) => {
      if (y >= sandY[x]) {
        const d = y - sandY[x];
        if (d === 0) return OC.sand[0];
        if (d === 1) return OC.sand[1];
        const rip = (x + d * 3 + Math.floor(d / 2)) % 9 < 2;
        const k = 2 + (d > 3 ? 1 : 0) + (d > 5 && bayer(x, y) > 0.5 ? 1 : 0);
        return rip ? OC.sand[Math.max(1, k - 1)] : OC.sand[Math.min(4, k)];
      }
      if (y <= sky + amp) { // the sky (mostly hidden by the waves) with a few flat pixel clouds
        const k = y < (sky - amp) * 0.45 ? 0 : y < sky - amp ? 1 : 2;
        const cl = fbm2(x / 16, y / 3, 2, 17);
        if (y < sky - amp - 1 && cl > 0.64) return cl > 0.7 ? [255, 255, 255] : [240, 252, 255];
        return OC.sky[k];
      }
      const v = (y - sky) / Math.max(1, span);
      const idx = clamp(Math.floor(v * 6.6 + (bayer(x, y) - 0.5) * 0.7), 0, 6);
      let c = OC.wb[idx];
      if (y >= mid[x]) c = y === mid[x] ? mix(c, lit, 0.18) : mix(c, OC.deep, 0.34);
      else if (y >= far[x]) c = y === far[x] ? mix(c, lit, 0.1) : mix(c, OC.deep, 0.17);
      return c;
    };
    return paintCells(W, H, G.u, img, (g) => decorate(g, G));
  });
}

function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

// pebbles, shells, coral, a starfish, rocks at both ends
function decorate(g, G) {
  const { W, sandY } = G;
  const R = OC.rock.map((c) => css(c));
  // rocks under the kelp at both ends: stepped lumps with moss
  for (const [x0, w] of [[0, 22], [W - 22, 22]]) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i, k = 1 - Math.abs((i + 0.5) / w - 0.5) * 2;
      const hgt = Math.max(1, Math.round(1 + k * 6 + hash2(x, 1, 41) * 1.5));
      const top = sandY[x] - hgt + 1;
      px(g, x, top, 1, hgt + 1, R[2]);
      px(g, x, top, 1, 1, i < w * 0.55 ? R[0] : R[1]);
      if (hgt > 2) px(g, x, top + 1, 1, 1, R[1]);
      if (hgt > 3) px(g, x, top + hgt - 1, 1, 2, R[3]);
      if (hash2(x, 2, 41) > 0.6) px(g, x, top - 1, 1, 1, css(OC.moss[hash2(x, 3, 41) > 0.5 ? 0 : 1]));
    }
  }
  const okX = (x) => x > 24 && x < W - 26;
  // pebbles
  for (let i = 0; i < W / 8; i++) {
    const x = Math.floor(hash2(i, 5, 43) * W);
    if (!okX(x)) continue;
    const s = hash2(i, 6, 43) > 0.7 ? 3 : 2, y = sandY[x] - (s - 1) + (hash2(i, 7, 43) > 0.5 ? 1 : 0);
    const tone = hash2(i, 8, 43) > 0.5;
    px(g, x, y, s, s - 1, tone ? '#9aa8b4' : '#b0a08a');
    px(g, x, y + s - 1, s, 1, tone ? '#6a7886' : '#80705c');
    px(g, x, y, 1, 1, '#e0e8ee');
  }
  // shells: scallops and spirals
  for (let i = 0; i < W / 40; i++) {
    const x = Math.floor(hash2(i, 9, 47) * W), y = sandY[x] - 2;
    if (!okX(x)) continue;
    if (hash2(i, 10, 47) > 0.45) {
      px(g, x + 1, y, 3, 1, '#ffe4dc'); px(g, x, y + 1, 5, 1, '#ffb8a8'); px(g, x + 1, y + 1, 1, 1, '#e0807a'); px(g, x + 3, y + 1, 1, 1, '#e0807a');
      px(g, x + 1, y + 2, 3, 1, '#d87068');
    } else {
      px(g, x, y + 1, 3, 2, '#fff0d8'); px(g, x + 1, y, 2, 1, '#fff8ec'); px(g, x + 1, y + 1, 1, 1, '#c89868'); px(g, x + 2, y + 2, 1, 1, '#d8b088');
    }
  }
  // coral bits: little branching corals with lit tips
  const COR = [['#ff7a8a', '#ffc0c8', '#c84a60'], ['#ff9a4a', '#ffd8a0', '#c86a2a'], ['#c070e0', '#ecc0ff', '#8a40a8'], ['#ff5a6a', '#ffb0a8', '#b83048']];
  for (let i = 0; i < W / 46; i++) {
    const x = Math.floor(24 + hash2(i, 11, 53) * (W - 50)), base = sandY[x];
    const [c, l, d] = COR[Math.floor(hash2(i, 12, 53) * COR.length)];
    const h = 3 + Math.floor(hash2(i, 13, 53) * 4);
    px(g, x, base - h, 1, h, c); px(g, x + 1, base - h + 1, 1, h - 1, d);
    px(g, x - 1, base - h + 1, 1, 2, c); px(g, x - 2, base - h, 1, 1, l);
    px(g, x + 2, base - h + 2, 1, 2, c); px(g, x + 3, base - h + 1, 1, 1, l);
    px(g, x, base - h - 1, 1, 1, l);
  }
  // a starfish or two
  for (let i = 0; i < 2; i++) {
    const x = Math.floor(W * (0.3 + i * 0.4) + hash2(i, 14, 59) * 20), y = sandY[x] - 1;
    px(g, x - 2, y, 5, 1, '#ff9a4a'); px(g, x, y - 2, 1, 3, '#ff9a4a'); px(g, x - 1, y + 1, 1, 1, '#e8702a'); px(g, x + 1, y + 1, 1, 1, '#e8702a');
    px(g, x, y, 1, 1, '#ffd8a0');
  }
}

// ------------------------------------------------------------------ caustics (8 frames)
const NPT = 15;
export function causticArt(L, f) {
  return art(`caus|${L.w}|${L.h}|${L.u}|${f}`, () => {
    const G = stripGeo(L), { W, H, sky, amp, sandY, P } = G;
    const span = G.sand - sky, ph = (f / 8) * TAU;
    const pts = [];
    for (let i = 0; i < NPT; i++) {
      const a = ph + hash2(i, 1, 61) * TAU, r = 1.5 + hash2(i, 2, 61) * 2;
      pts.push([hash2(i, 3, 61) * P + Math.cos(a) * r, sky + 2 + hash2(i, 4, 61) * (H - sky) + Math.sin(a * (i % 2 ? 1 : -1)) * r * 0.6]);
    }
    const tile = new Uint8Array(P * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < P; x++) {
      let f1 = 1e9, f2 = 1e9;
      for (const [qx, qy] of pts) for (const o of [-P, 0, P]) {
        const dx = x + 0.5 - (qx + o), dy = (y + 0.5 - qy) * 2.2, d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      tile[y * P + x] = f2 - f1 < 0.9 ? 2 : f2 - f1 < 1.7 ? 1 : 0;
    }
    return paintCells(W, H, G.u, (x, y) => {
      if (y <= sky + amp + 1) return null;
      const v = tile[y * P + (x % P)];
      if (!v) return null;
      if (y >= sandY[x]) return y - sandY[x] < 3 ? [255, 246, 208, v === 2 ? 150 : 70] : null;
      const d = (y - sky) / span;
      const a = d < 0.3 ? 120 : d < 0.62 ? 72 : 38;
      return [235, 255, 255, v === 2 ? a : a * 0.35];
    });
  });
}

// ------------------------------------------------------------------ the rolling surface
export function waveArt(L, back) {
  return art(`wave|${L.w}|${L.h}|${L.u}|${back ? 1 : 0}`, () => {
    const G = stripGeo(L), { W, P, surf, wTop, wH, sky, amp } = G;
    const n = W + P;
    const top = hex(WAVE_TOP), lite = hex('#9ae8f8'), body = OC.wb[0];
    const bTop = hex('#b8eefa'), bBody = hex('#86dcf4');
    return paintCells(n, wH, G.u, (x, yy) => {
      const y = yy + wTop;
      if (back) {
        const s = surf[(x + Math.round(P * 0.37)) % n] - 1 - (Math.sin((x / P) * TAU * 3) > 0.4 ? 1 : 0);
        if (y < s || y > s + 3) return null;
        return y === s ? bTop : bBody;
      }
      const s = surf[x];
      // foam on the high crests: a cap above and white on the crest row
      let crest = s <= sky - amp + 1;
      if (crest) for (let k = -2; k <= 2; k++) if (surf[(x + k + n) % n] < s) crest = false;
      if (crest && y === s - 1) return [255, 255, 255];
      if (y < s) {
        if (crest && y === s - 2 && hash2(x, 3, 71) > 0.6) return [255, 255, 255, 200];
        return null;
      }
      if (y === s) return crest ? [255, 255, 255] : top;
      if (y === s + 1) return crest || surf[(x + 1) % n] < s - 1 ? top : lite;
      return body;
    });
  });
}

// ------------------------------------------------------------------ floor plants (4 frames)
export function plantsArt(L, f) {
  return art(`plants|${L.w}|${L.h}|${L.u}|${f}`, () => {
    const G = stripGeo(L), { W, H, sandY } = G;
    return paintCells(W, H, G.u, null, (g) => {
      const n = Math.floor(W / 34);
      for (let i = 0; i < n; i++) {
        const x0 = Math.floor(26 + ((i + hash2(i, 1, 73) * 0.7) / n) * (W - 52)), base = sandY[x0];
        const kind = hash2(i, 2, 73);
        if (kind < 0.62) { // a tuft of sea grass
          const nb = 3 + Math.floor(hash2(i, 3, 73) * 3);
          for (let b = 0; b < nb; b++) {
            const bx = x0 + b - Math.floor(nb / 2), h = 4 + Math.floor(hash2(i, 10 + b, 73) * 6);
            for (let y = 0; y < h; y++) {
              const k = y / h, sw = Math.round(Math.sin((f / 4) * TAU + i + b * 0.8) * 1.2 * k * k);
              px(g, bx + sw, base - 1 - y, 1, 1, k > 0.75 ? '#b8e860' : k > 0.4 ? '#6cc23a' : '#3a8a2a');
            }
          }
        } else { // a little round-leaf plant
          const h = 3 + Math.floor(hash2(i, 4, 73) * 3), sw = Math.round(Math.sin((f / 4) * TAU + i) * 0.7);
          px(g, x0, base - h, 1, h, '#2e7a3a');
          for (let y = 1; y < h; y += 2) { px(g, x0 - 2 + (y > h / 2 ? sw : 0), base - h + y, 2, 1, '#5ac06a'); px(g, x0 + 1 + (y > h / 2 ? sw : 0), base - h + y - 1, 2, 1, '#86dc8a'); }
          px(g, x0 - 1 + sw, base - h - 1, 3, 1, '#a8f0a0');
        }
      }
    });
  });
}

// ------------------------------------------------------------------ giant kelp at the ends (8 frames)
const KELP = { left: ['#c8ec70', '#7ccc44', '#3e9430', '#1f5a22'], right: ['#ecd270', '#c0a040', '#8a6e24', '#4e3c12'] };
export function kelpArt(L, f, side) {
  return art(`kelp|${L.h}|${L.u}|${L.S}|${f}|${side}`, () => {
    const G = stripGeo(L), H = G.H, w = 22, K = KELP[side];
    const flip = side === 'right';
    return paintCells(w, H, G.u, null, (g) => {
      const stipes = [[6, 0.94, 0, 0], [11, 0.78, 2.1, 1], [15, 0.88, 4.2, 3]];
      const top0 = G.sky + 2;
      for (let pass = 0; pass < 2; pass++) {
        for (const [bx, hk, ph, si] of stipes) {
          const bottom = H - 3, len = Math.round((bottom - top0) * hk);
          for (let i = 0; i < len; i++) {
            const k = i / len, y = bottom - i;
            const sway = Math.sin((f / 8) * TAU + ph + k * 2.6) * 2.6 * Math.pow(k, 1.25);
            let x = Math.round(bx + sway);
            if (flip) x = w - 1 - x;
            if (pass === 0) { px(g, x - 1, y - 1, 3, 3, css(hex(PAL.ink), 1)); continue; }
            px(g, x, y, 1, 1, K[k > 0.6 ? 1 : 2]);
            // long blades every 4 rows, alternating sides, with a gas bulb at the base
            if ((i + si) % 4 === 2 && k > 0.12 && k < 0.95) {
              const sd = ((i + si) % 8 === 2 ? -1 : 1) * (flip ? -1 : 1), bl = 3 + (k > 0.5 ? 1 : 0);
              const lx = sd < 0 ? x - bl : x + 1;
              px(g, lx, y - 1, bl, 1, K[1]); px(g, lx, y, bl, 1, K[2]);
              px(g, sd < 0 ? lx : lx + bl - 1, y - 2, 1, 1, K[0]);
              px(g, sd < 0 ? x - 1 : x + 1, y + 1, 1, 1, '#d8b848');
            }
          }
          // the tip leaf
          let tx = Math.round(bx + Math.sin((f / 8) * TAU + ph + 2.6) * 2.6);
          if (flip) tx = w - 1 - tx;
          if (pass === 1) { px(g, tx - 1, bottom - len, 3, 1, K[0]); px(g, tx, bottom - len - 1, 1, 1, K[0]); }
        }
      }
    });
  });
}

// ------------------------------------------------------------------ the zone overlay, glow and grate
// meter units of column x (cells): the same mapping as meter.js mx()
const unitOfCol = (L, G, x) => ((x + 0.5) * G.u - L.w / 2) / (L.w / 2 - L.h * 0.35);

export function zoneArt(L, zq) {
  return art(`zone|${L.w}|${L.h}|${L.u}|${zq}`, () => {
    const G = stripGeo(L), { W, H, sky, sandY } = G;
    const span = G.sand - sky;
    return paintCells(W, H, G.u, (x, y) => {
      const m = unitOfCol(L, G, x), a = Math.abs(m);
      const b = bayer(x, y);
      const water = y >= sky - 1 && y < sandY[x];
      const edgeDist = (a - zq) * (L.w / 2 - L.h * 0.35) / G.u; // cells outside the zone edge (negative = inside)
      if (edgeDist < 0 || (edgeDist < 2 && b > edgeDist / 2)) {
        if (!water) return null;
        const v = (y - sky) / span;
        return [OC.calm[0], OC.calm[1], OC.calm[2], v < 0.35 ? 64 : v < 0.7 ? 48 : 34];
      }
      const d = clamp01((a - zq) / Math.max(0.05, 1 - zq)) + (b - 0.5) * 0.16;
      const lvl = d > 0.7 ? 3 : d > 0.4 ? 2 : d > 0.12 ? 1 : 0;
      if (!lvl) return null;
      if (y <= sky + G.amp) return null; // never tint the sky between the crests
      if (m < 0) { // choppy coral water: a warm tint, stronger toward the surface
        const k = [0, 0.1, 0.18, 0.27][lvl] * (y >= sandY[x] ? 0.5 : 1) * (y < sky + 7 ? 1.2 : 1);
        return [OC.coral[0], OC.coral[1], OC.coral[2], Math.round(255 * k)];
      }
      // dark churned water: murky amber, darker toward the floor
      const v = clamp01((y - sky) / span);
      const k = [0, 0.16, 0.3, 0.46][lvl] * (0.75 + v * 0.45) * (y >= sandY[x] ? 0.5 : 1);
      const c = mix(OC.murk, OC.amber, 0.35 - v * 0.3);
      return [c[0], c[1], c[2], Math.round(255 * Math.min(0.62, k))];
    });
  });
}

export function glowArt(L, zq, f) {
  return art(`glow|${L.w}|${L.h}|${L.u}|${zq}|${f}`, () => {
    const G = stripGeo(L), { W, sky } = G;
    const mid = sky + (G.sand - sky) * 0.42, half = (G.sand - sky) * 0.5;
    return paintCells(W, G.H, G.u, (x, y) => {
      const a = Math.abs(unitOfCol(L, G, x));
      if (a > zq || y <= sky + 1 || y >= G.sandY[x]) return null;
      const edge = clamp01((zq - a) * (L.w / 2 - L.h * 0.35) / G.u / 6);
      const gv = (1 - Math.abs(y - mid) / half) * edge;
      return gv * 0.85 > bayer(x + f * 2, y + f) ? [236, 255, 250, gv > 0.6 ? 70 : 44] : null;
    });
  });
}

export function grateArt(L, zq) {
  return art(`grate|${L.w}|${L.h}|${L.u}|${zq}`, () => {
    const G = stripGeo(L), { W, H } = G;
    const st = PAL.steel.map(hex);
    return paintCells(W, H, G.u, (x, y) => {
      const a = Math.abs(unitOfCol(L, G, x));
      if (a > zq + 0.01) return null;
      const lx = Math.floor(((x + 0.5) * G.u - (L.w / 2 - zq * (L.w / 2 - L.h * 0.35))) / G.u);
      const bar = lx % 6;
      const rail = y === 1 || y === 2 || y === H - 3 || y === H - 2 || y === Math.floor(H / 2);
      if (rail) return st[y === 1 || y === Math.floor(H / 2) ? 1 : 2];
      if (bar === 0) return st[3];
      if (bar === 1) return st[1];
      if (bar === 2) return [...st[3], 120];
      return [40, 60, 90, 70];
    });
  });
}

// ------------------------------------------------------------------ small sprites
export function fishSil(n, f, dir, u) {
  return art(`sil|${n}|${f}|${dir}|${u}`, () => {
    const w = n ? 13 : 9, h = n ? 5 : 4;
    return paintCells(w, h, u, (x, y) => {
      const xx = dir > 0 ? x : w - 1 - x; // nose at the right when dir > 0
      const tail = n ? 3 : 2;
      if (xx < tail) { // the tail fork, flapping
        const off = f ? 0 : 1;
        return (y === off || y === h - 2 + off - 1) && xx <= tail - 1 ? [22, 84, 140, 150] : null;
      }
      const bx = (xx - tail) / (w - tail - 1), half = Math.sin(Math.PI * Math.min(1, bx * 0.95 + 0.05)) * (h / 2);
      return Math.abs(y + 0.5 - h / 2) <= half ? [20, 82, 140, 135] : null;
    });
  });
}

const BUOY = [
  '...L...',
  '..oLo..',
  '.oAAAo.',
  '.oBBBo.',
  'oAAAAAo',
  'oBBBBBo',
  'oAAAAAo',
  'oDDDDDo',
  '.ooooo.',
];
const BUOY_PAL = {
  calm: { A: '#f4fdff', B: '#e83040', D: '#8a1a2a', L: '#ffe46a' },
  gold: { A: '#fffbd0', B: '#ffc81e', D: '#a85a06', L: '#ffffff' },
  steel: { A: '#f0f8ff', B: '#5a7490', D: '#3a5068', L: '#8ff0ff' },
};
export function buoyArt(kind, u, lampOn) {
  return art(`buoy|${kind}|${u}|${lampOn ? 1 : 0}`, () => {
    const p = BUOY_PAL[kind];
    return paintCells(7, BUOY.length, u, (x, y) => {
      const ch = BUOY[y][x];
      if (ch === '.') return null;
      if (ch === 'o') return hex(PAL.ink);
      if (ch === 'L') return lampOn ? hex(p.L) : hex('#56687a');
      const c = hex(p[ch]);
      return x <= 2 ? mix(c, [255, 255, 255], 0.18) : x >= 5 ? mix(c, [10, 20, 50], 0.22) : c;
    });
  });
}

// ------------------------------------------------------------------ the console + glass + tube surface
export function consoleArt(L) {
  return art(`console|${L.w}|${L.h}|${L.u}|${L.panel.w}|${L.panel.h}`, () => {
    const P = L.panel, u = L.u, S = L.S;
    const w = P.w, h = P.h, c = makeCanvas(w, h), g = ctxOf(c);
    const ink = PAL.ink, st = 3;
    const R = (x, y, ww, hh, col) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); };
    // the ink silhouette with stepped corners, then the steel body bands
    for (let i = 0; i <= st; i++) R((st - i) * u, i * u, w - 2 * (st - i) * u, h - 2 * i * u, ink);
    const ix = u, iy = u, iw = w - 2 * u, ih = h - 2 * u;
    const inside = (x0, y0, ww, hh, col) => { // a body rect clipped to the stepped inner shape
      for (let yy = y0; yy < y0 + hh; yy += u) {
        const r = Math.min((yy - iy) / u, (iy + ih - u - yy) / u);
        const cut = r < st - 1 ? (st - 1 - r) * u : 0;
        const a = Math.max(x0, ix + cut), b = Math.min(x0 + ww, ix + iw - cut);
        if (b > a) R(a, yy, b - a, u, col);
      }
    };
    inside(ix, iy, iw, Math.round(ih * 0.3), '#6e849c');
    inside(ix, iy + Math.round(ih * 0.3), iw, Math.round(ih * 0.45), '#5c7088');
    inside(ix, iy + Math.round(ih * 0.75), iw, ih - Math.round(ih * 0.75), '#4a5c72');
    // bevels: lit top / left, dark bottom / right (stepping round the corners)
    for (let yy = iy; yy < iy + ih; yy += u) {
      const r = Math.min((yy - iy) / u, (iy + ih - u - yy) / u);
      const cut = r < st - 1 ? (st - 1 - r) * u : 0;
      R(ix + cut, yy, u, u, yy < iy + ih / 2 ? '#c8d8e6' : '#8aa4bc');
      R(ix + iw - cut - u, yy, u, u, yy < iy + ih / 2 ? '#4a5c72' : '#2e3c4e');
    }
    inside(ix, iy, iw, u, '#c8d8e6'); inside(ix, iy + u, iw, u, '#9fb4c8');
    inside(ix, iy + ih - u, iw, u, '#2e3c4e'); inside(ix, iy + ih - 2 * u, iw, u, '#3a4a5e');
    const ox = P.x, oy = P.y;
    // the porthole window for the strip: a recessed ink frame, shaded top-left, lit bottom-right
    const y0 = Math.round(L.cy - L.h / 2) - oy, x0 = L.x0 - ox;
    R(x0 - 3 * u, y0 - 3 * u, L.w + 6 * u, L.h + 6 * u, '#2e3c4e');
    R(x0 - 3 * u, y0 + L.h + 2 * u, L.w + 6 * u, u, '#9fb4c8'); R(x0 + L.w + 2 * u, y0 - 2 * u, u, L.h + 5 * u, '#8aa4bc');
    R(x0 - 2 * u, y0 - 2 * u, L.w + 4 * u, L.h + 4 * u, ink);
    // the tube recess
    const ty = L.by - oy;
    R(x0 - 3 * u, ty - 3 * u, L.w + 6 * u, L.bh + 6 * u, '#2e3c4e');
    R(x0 - 3 * u, ty + L.bh + 2 * u, L.w + 6 * u, u, '#9fb4c8');
    R(x0 - 2 * u, ty - 2 * u, L.w + 4 * u, L.bh + 4 * u, ink);
    R(x0 - u, ty - u, L.w + 2 * u, L.bh + 2 * u, '#0a2238');
    // the tube's dark glass: a faint grid every 10 %, metal end collars
    for (let i = 1; i < 10; i++) R(Math.round(x0 + (L.w * i) / 10), ty, u, L.bh, '#123452');
    for (const ex of [x0 - u, x0 + L.w - 4 * u]) {
      R(ex, ty - 2 * u, 5 * u, L.bh + 4 * u, ink);
      R(ex + u, ty - u, 3 * u, L.bh + 2 * u, '#8aa4bc');
      R(ex + u, ty - u, 3 * u, u, '#e4eef6'); R(ex + u, ty - u, u, L.bh + 2 * u, '#c8d8e6');
      R(ex + 3 * u, ty, u, L.bh + u, '#5a7490');
      R(ex + 2 * u, ty + Math.round(L.bh / 2) - u, u, 2 * u, '#3a4a5e');
    }
    // rivets along the top rail and under the tube
    const rivet = (x, y) => { R(x, y, 2 * u, 2 * u, '#9fb4c8'); R(x, y, u, u, '#f0f8ff'); R(x + 2 * u, y + u, u, 2 * u, '#2e3c4e'); R(x + u, y + 2 * u, 2 * u, u, '#2e3c4e'); };
    const gap = Math.round(24 * S);
    for (let x = x0 + Math.round(gap / 2); x < x0 + L.w - u; x += gap) {
      rivet(x, Math.max(2 * u, Math.round((y0 - 3 * u) / 2) - u));
      rivet(x, Math.round(ty + L.bh + 3 * u + (h - (ty + L.bh + 3 * u)) / 2) - 2 * u);
    }
    // hazard-stripe inserts at both ends, beside the window and the tube
    const hz = (hx, hy, hw, hh) => {
      R(hx - u, hy - u, hw + 2 * u, hh + 2 * u, ink);
      for (let yy = 0; yy < hh; yy += u) for (let xx = 0; xx < hw; xx += u) R(hx + xx, hy + yy, u, u, Math.floor((xx + yy) / (2 * u)) % 2 ? '#ffc81e' : '#1c2230');
    };
    const sw = Math.max(2 * u, x0 - 3 * u - 3 * u);
    hz(2 * u + u, y0 + 2 * u, sw - u, L.h - 4 * u);
    hz(x0 + L.w + 4 * u, y0 + 2 * u, sw - u, L.h - 4 * u);
    // corner screws
    for (const [sx, sy] of [[3 * u, 3 * u], [w - 6 * u, 3 * u], [3 * u, h - 6 * u], [w - 6 * u, h - 6 * u]]) {
      R(sx, sy, 3 * u, 3 * u, '#2e3c4e'); R(sx, sy, 2 * u, 2 * u, '#c8d8e6'); R(sx + u, sy, u, 2 * u, '#5a7490');
    }
    return c;
  });
}

export function tubeWaveArt(u, maxW) {
  return art(`twave|${u}|${maxW}`, () => {
    const P = 24, n = Math.ceil(maxW / u) + P;
    const top = hex('#e8ffff'), lite = hex('#a8f0fa'), body = hex('#7ae4f6');
    return paintCells(n, 4, u, (x, y) => {
      const s = 1 + Math.round(Math.sin((x / P) * TAU) * 0.9 + Math.sin((x / P) * TAU * 3 + 1) * 0.35);
      if (y < s) return null;
      if (y === s) return (x % P) === 5 || (x % P) === 6 ? [255, 255, 255] : top;
      return y === s + 1 ? lite : body;
    });
  });
}
