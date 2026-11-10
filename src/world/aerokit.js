// Frutiger Aero kit for the ocean worlds.
//
// Painted glass sprites (cached, dithered alpha, crisp pixels): glassOrb, chromeDrop, soapBubble, glassBubble,
// sparkleStar, bokehDisc, flare elements (flareStar / flareRing / flareHex / flareDisc / flareStreak), bubbleCloud,
// rainbowArc, auroraRibbon, bloomStrip.
// Voxel eco-tech (world camera, see voxkit.js): turbineTower / rotorFrames (spinning white wind turbines),
// swayAnim (placeAnim-compatible sway frames) with plant builders: glossy leaves, flowers, app-like crystal plants,
// aqua bubble plants; pierModel (a glossy dock).
// AeroOverlay: the glossy layer every ocean gets (Ocean installs it): an under-surface bloom band, rising glass
// bubbles, twinkling sparkles, soft bokeh orbs and a lens flare when the sun is in view.

import { VoxelModel, refineSteps } from '../gfx/voxel.js';
import { runSteps } from './slabrender.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { clamp, clamp01, lerp, smoothstep, bayer, hash2, TAU } from '../core/math.js';
import { hexToRgb, packRGB, mix, shade, hslToRgb } from '../core/color.js';
import { renderModel } from './voxkit.js';
import { paint, todWeights, quality } from './scenery.js';
import { skyBodies } from './sky.js';
import { flipCanvas } from '../gfx/pixel.js';
import { withSky } from './zoomsky.js';

const cache = new Map();
const memo = (key, fn) => { let v = cache.get(key); if (!v) { v = fn(); cache.set(key, v); } return v; };
const qa = (a, x, y, levels = 6) => Math.min(1, Math.floor(clamp01(a) * levels + bayer(x, y)) / levels);
const L3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255];

// ------------------------------------------------------------------ painted glass

// Glossy glass sphere: fresnel rim, sky-lit top, caustic crescent at the bottom, the classic Aero gloss cap.
export function glassOrb(r, tint = '#7fd8ff', o = {}) {
  r = Math.max(2, Math.round(r));
  const glow = o.glow ?? 0, core = o.core || null;
  return memo('orb|' + r + tint + glow + core, () => {
    const s = r * 2 + 2, c0 = r + 1;
    const T = hexToRgb(tint), D = hexToRgb(shade(tint, -0.5)), Lt = hexToRgb(shade(tint, 0.55)), C = core ? hexToRgb(core) : null;
    return paint(s, s, (x, y) => {
      const dx = (x + 0.5 - c0) / r, dy = (y + 0.5 - c0) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) return 0;
      const d = Math.sqrt(d2);
      let a = 0.3 + 0.55 * d * d * d + glow * 0.25;
      const k = clamp01(0.55 - dy * 0.5 - dx * 0.12);
      let col = L3(D, T, smoothstep(0, 0.55, k));
      col = L3(col, Lt, smoothstep(0.55, 1, k) * 0.7);
      if (C && d < 0.5) { const kc = 1 - d / 0.5; col = L3(col, C, kc * 0.8); a = Math.max(a, 0.5 + kc * 0.4); }
      // focused light: a bright crescent inside the lower rim
      const cres = smoothstep(0.15, 0.6, dy) * smoothstep(0.45, 0.72, d) * (1 - smoothstep(0.86, 0.97, d));
      if (cres > 0.05) { col = L3(col, Lt, cres * 0.85); a += cres * 0.3; }
      // rim
      if (d > 1 - 1.15 / r) {
        const lit = dx + dy < -0.3;
        col = lit ? L3(Lt, WHITE, 0.6) : D;
        a = lit ? 0.95 : 0.9;
      }
      // gloss cap
      const gx = (dx + 0.04) / 0.66, gy = (dy + 0.5) / 0.36;
      const gd = gx * gx + gy * gy;
      if (gd < 1 && d < 0.93) { const ga = lerp(0.95, 0.25, clamp01((dy + 0.8) / 0.6)); col = L3(col, WHITE, 0.85); a = Math.max(a, ga); }
      if (Math.hypot(dx - 0.42, dy - 0.4) < Math.max(0.12, 1 / r)) { col = WHITE; a = 0.85; }
      const q = qa(a, x, y, 7);
      return q <= 0 ? 0 : packRGB(col[0], col[1], col[2], Math.round(q * 255));
    });
  });
}

// Liquid-chrome droplet (teardrop): sky reflection on top, a bright horizon line, a dark band, grass below.
export function chromeDrop(h, tint = '#5ac8ff') {
  h = Math.max(6, Math.round(h));
  return memo('drop|' + h + tint, () => {
    const R = h * 0.36, w = Math.ceil(R * 2) + 2, cx = w / 2, cy = h - R - 0.5;
    const sky = hexToRgb(mix(tint, '#ffffff', 0.55)), skyD = hexToRgb(tint), band = hexToRgb(shade(tint, -0.65)), grass = hexToRgb('#4cc85a'), grassD = hexToRgb('#1e7a52');
    return paint(w, h + 1, (x, y) => {
      const px = x + 0.5 - cx, py = y + 0.5;
      let inside = false, nx, ny;
      const dc = Math.hypot(px, py - cy);
      if (dc <= R) { inside = true; nx = px / R; ny = (py - cy) / R; }
      else if (py < cy) {
        const t = py / cy, hw = R * Math.pow(t, 1.35);
        if (Math.abs(px) <= hw) { inside = true; nx = hw > 0.5 ? px / (hw + 0.5) : 0; ny = -0.75 + t * 0.4; }
      }
      if (!inside) return 0;
      let col;
      if (ny < -0.12) col = L3(sky, skyD, clamp01((ny + 1) / 0.88));
      else if (ny < 0.05) col = WHITE;
      else if (ny < 0.3) col = band;
      else col = L3(grass, grassD, clamp01((ny - 0.3) / 0.6));
      const edge = Math.abs(nx);
      col = L3(col, band, smoothstep(0.7, 1, edge) * 0.55);
      if (Math.hypot(nx + 0.38, ny + 0.32) < 0.2) col = WHITE;
      const a = edge > 0.9 ? 0.9 : 1;
      return packRGB(col[0], col[1], col[2], Math.round(a * 255));
    });
  });
}

// Thin iridescent soap bubble: rainbow rim, nearly clear inside, a window highlight top-left.
export function soapBubble(r, iris = 1) {
  r = Math.max(2, Math.round(r));
  return memo('soap|' + r + '|' + iris, () => {
    const s = r * 2 + 2, c0 = r + 1;
    const rimW = r >= 9 ? 2 : 1;
    return paint(s, s, (x, y) => {
      const dx = (x + 0.5 - c0) / r, dy = (y + 0.5 - c0) / r;
      const d = Math.hypot(dx, dy);
      if (d > 1) return 0;
      const ang = Math.atan2(dy, dx);
      const lit = clamp01(0.5 - (dx + dy) * 0.45);
      if (d > 1 - rimW / r) {
        const hue = ((ang / TAU) * 720 + 200 + d * 90) % 360;
        const rc = hslToRgb(hue, 0.85, 0.72);
        const col = L3(L3([200, 245, 255], rc, iris), WHITE, lit * 0.35);
        return packRGB(col[0], col[1], col[2], Math.round(qa(0.5 + lit * 0.45, x, y) * 255));
      }
      // window highlight
      const hx = (dx + 0.42) / 0.2, hy = (dy + 0.42) / 0.14;
      if (hx * hx + hy * hy < 1 || (r >= 6 && Math.hypot(dx + 0.15, dy + 0.62) < 0.08)) return packRGB(255, 255, 255, 235);
      // faint inner reflection arc bottom-right
      if (r >= 5 && d > 0.62 && d < 0.8 && ang > 0.2 && ang < 1.3) return packRGB(255, 255, 255, Math.round(qa(0.4, x, y) * 255));
      const a = 0.05 + d * d * 0.12;
      const hue = ((ang / TAU) * 360 + 140) % 360;
      const ic = L3([220, 248, 255], hslToRgb(hue, 0.8, 0.8), iris * 0.6);
      const q = qa(a, x, y, 8);
      return q <= 0 ? 0 : packRGB(ic[0], ic[1], ic[2], Math.round(q * 255));
    });
  });
}

// Underwater glass bubble (glossier than the plain scenery bubble).
export function glassBubble(r, rim = '#bff6ff') {
  r = Math.max(1, Math.round(r));
  return memo('gb|' + r + rim, () => {
    const s = r * 2 + 2, c0 = r + 1;
    const R = hexToRgb(rim);
    return paint(s, s, (x, y) => {
      const dx = (x + 0.5 - c0) / r, dy = (y + 0.5 - c0) / r;
      const d = Math.hypot(dx, dy);
      if (d > 1.05) return 0;
      const lit = clamp01(0.5 - (dx + dy) * 0.5);
      if (r <= 1) return packRGB(...L3(R, WHITE, lit), d < 0.5 ? 140 : 220);
      if (d > 1 - 1.1 / r) return packRGB(...L3(R, WHITE, lit * 0.8), Math.round(lerp(120, 245, lit)));
      if (Math.hypot(dx + 0.38, dy + 0.38) < Math.max(0.22, 0.9 / r)) return packRGB(255, 255, 255, 250);
      if (r >= 4 && d > 0.55 && d < 0.8 && dx > 0.15 && dy > 0.15) return packRGB(255, 255, 255, 120);
      const q = qa(0.08 + d * d * 0.18, x, y, 8);
      return q <= 0 ? 0 : packRGB(...L3(R, WHITE, 0.4), Math.round(q * 255));
    });
  });
}

// 4-point twinkle star (draw additively).
export function sparkleStar(n, color = '#ffffff') {
  n = Math.max(2, Math.round(n));
  return memo('spk|' + n + color, () => {
    const s = n * 2 + 1, C = hexToRgb(color);
    return paint(s, s, (x, y) => {
      const dx = Math.abs(x - n), dy = Math.abs(y - n);
      let a = 0;
      if (dx === 0) a = 1 - dy / (n + 1);
      if (dy === 0) a = Math.max(a, 1 - dx / (n + 1));
      if (dx === dy && dx <= n / 3) a = Math.max(a, 0.55 * (1 - dx / (n / 3 + 1)));
      if (dx <= 1 && dy <= 1) a = Math.max(a, 0.85);
      a = Math.pow(a, 1.4);
      const q = qa(a, x, y, 5);
      if (q <= 0) return 0;
      const col = L3(C, WHITE, a > 0.8 ? 0.8 : 0);
      return packRGB(col[0], col[1], col[2], Math.round(q * 255));
    });
  });
}

// Soft bokeh disc with a slightly brighter rim (draw additively at low alpha).
export function bokehDisc(r, color = '#ffffff') {
  r = Math.max(2, Math.round(r));
  return memo('bok|' + r + color, () => {
    const s = r * 2 + 1, C = hexToRgb(color);
    return paint(s, s, (x, y) => {
      const d = Math.hypot(x - r, y - r) / (r + 0.5);
      if (d >= 1) return 0;
      const a = 0.42 + smoothstep(0.7, 0.95, d) * 0.5 - smoothstep(0.95, 1, d) * 0.6;
      const q = qa(a, x, y, 5);
      return q <= 0 ? 0 : packRGB(C[0], C[1], C[2], Math.round(q * 255));
    });
  });
}

// Lens-flare starburst at the light source.
export function flareStar(R, color = '#fff6d8') {
  R = Math.round(R);
  return memo('fst|' + R + color, () => {
    const s = R * 2 + 1, C = hexToRgb(color);
    return paint(s, s, (x, y) => {
      const dx = x - R, dy = y - R;
      const d = Math.hypot(dx, dy) / R;
      if (d >= 1) return 0;
      const ang = Math.atan2(dy, dx);
      let a = Math.pow(1 - d, 3) * 0.9;
      for (let k = 0; k < 6; k++) {
        const th = (k / 6) * Math.PI + 0.26;
        const perp = Math.abs(Math.sin(ang - th)) * d * R;
        a = Math.max(a, Math.exp(-perp * perp * 0.5) * Math.pow(1 - d, 1.6) * (k % 2 ? 0.55 : 0.85));
      }
      const q = qa(a, x, y, 6);
      return q <= 0 ? 0 : packRGB(...L3(C, WHITE, Math.pow(1 - d, 4)), Math.round(q * 255));
    });
  });
}

export function flareStreak(len, color = '#bfe8ff') {
  return memo('fsk|' + len + color, () => {
    const C = hexToRgb(color), h = 5;
    return paint(len * 2 + 1, h, (x, y) => {
      const u = Math.abs(x - len) / len, v = Math.abs(y - 2) / 2.5;
      const a = Math.pow(1 - u, 2.2) * (1 - v * v) * 0.8;
      const q = qa(a, x, y, 5);
      return q <= 0 ? 0 : packRGB(C[0], C[1], C[2], Math.round(q * 255));
    });
  });
}

export function flareRing(r, color) {
  r = Math.round(r);
  return memo('frg|' + r + color, () => {
    const C = hexToRgb(color), s = r * 2 + 3;
    return paint(s, s, (x, y) => {
      const d = Math.abs(Math.hypot(x - r - 1, y - r - 1) - r);
      const a = d < 0.8 ? 0.7 : d < 1.8 ? 0.3 : 0;
      const q = qa(a, x, y, 4);
      return q <= 0 ? 0 : packRGB(C[0], C[1], C[2], Math.round(q * 255));
    });
  });
}

export function flareHex(r, color) {
  r = Math.round(r);
  return memo('fhx|' + r + color, () => {
    const C = hexToRgb(color), s = r * 2 + 1;
    return paint(s, s, (x, y) => {
      const dx = x - r, dy = y - r;
      const ang = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
      const hexR = (r * Math.cos(Math.PI / 6)) / Math.cos(((((ang + Math.PI / 6) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6);
      if (d > hexR) return 0;
      const a = d > hexR - 1.2 ? 0.6 : 0.28;
      const q = qa(a, x, y, 4);
      return q <= 0 ? 0 : packRGB(C[0], C[1], C[2], Math.round(q * 255));
    });
  });
}

export function flareDisc(r, color) {
  r = Math.round(r);
  return memo('fdc|' + r + color, () => {
    const C = hexToRgb(color), s = r * 2 + 1;
    return paint(s, s, (x, y) => {
      const d = Math.hypot(x - r, y - r) / (r + 0.5);
      if (d >= 1) return 0;
      const q = qa(0.3 + d * 0.25, x, y, 4);
      return q <= 0 ? 0 : packRGB(C[0], C[1], C[2], Math.round(q * 255));
    });
  });
}

// Cumulus made of thousands of tiny bubbles (the wallpaper's clouds, now underwater).
export function bubbleCloud(seed, w, h, tint = '#ffffff') {
  return memo('bcl|' + seed + '|' + w + '|' + h + tint, () => {
    const r = new RNG(seed);
    const puffs = [];
    const n = r.int(4, 6);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const big = 1 - Math.abs(u - r.float(0.4, 0.6)) * 1.4;
      const ry = h * r.float(0.3, 0.45) * (0.6 + big * 0.55);
      puffs.push([lerp(w * 0.18, w * 0.82, u) + r.float(-3, 3), h - 2 - ry * 0.75, ry * r.float(1.1, 1.5), ry]);
    }
    const inside = (x, y) => {
      if (y > h - 3) return 0;
      let v = 0;
      for (const [cx, cy, rx, ry] of puffs) { const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; if (q < 1) v = Math.max(v, 1 - q); }
      return v;
    };
    const acc = new Float32Array(w * h);
    const col = new Uint8Array(w * h);
    // soft body
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = inside(x, y); if (v > 0) acc[y * w + x] = 0.1 + v * 0.12 + (1 - y / h) * 0.06; }
    // bubbles
    for (let i = 0; i < w * h * 0.03; i++) {
      const x = r.float(0, w), y = r.float(0, h);
      if (inside(x, y) < 0.04) continue;
      const br = r.pick([1, 1, 1.5, 2, 2.5, 3]);
      for (let yy = Math.floor(y - br - 1); yy <= y + br + 1; yy++) for (let xx = Math.floor(x - br - 1); xx <= x + br + 1; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
        const k = yy * w + xx;
        if (Math.abs(d - br) < 0.6) { const lit = xx < x && yy < y; acc[k] = Math.max(acc[k], lit ? 0.85 : 0.5); if (lit) col[k] = 1; }
        else if (d < br - 0.5 && acc[k] < 0.3) acc[k] = Math.max(acc[k], 0.2);
      }
    }
    const T = hexToRgb(tint);
    return paint(w, h, (x, y) => {
      const a = acc[y * w + x];
      if (a <= 0) return 0;
      const q = qa(a, x, y, 6);
      if (q <= 0) return 0;
      const c = col[y * w + x] ? WHITE : L3(T, [190, 236, 255], 0.35 * (y / h));
      return packRGB(c[0], c[1], c[2], Math.round(q * 255));
    });
  });
}

// Soft rainbow arc (glossy rain), centred at the bottom middle of the sprite.
export function rainbowArc(R, band = 3) {
  return memo('rb|' + R + '|' + band, () => {
    const cols = ['#ff6a8a', '#ffa64a', '#ffe85a', '#7ae86a', '#5ac8ff', '#9a7aff'].map(hexToRgb);
    const w = R * 2 + band * 12, h = R + band * 6;
    const cx = w / 2, cy = h;
    return paint(w, h, (x, y) => {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const i = Math.floor((R + band * 6 - d) / band);
      if (i < 0 || i >= 6) return 0;
      const fade = smoothstep(0, h * 0.55, y) * 0.2 + 0.8;
      const q = qa(0.55 * fade * (1 - smoothstep(h * 0.75, h, y)), x, y, 5);
      return q <= 0 ? 0 : packRGB(...cols[i], Math.round(q * 255));
    });
  });
}

// Aurora / Aero light-ribbon curtain: vertical rays hanging below a wavy ribbon (tile horizontally).
export function auroraRibbon(w, h, seed, cols = ['#7affc0', '#5ae8ff', '#c08aff']) {
  return memo('aur|' + w + '|' + h + '|' + seed + cols.join(), () => {
    const r = new RNG(seed);
    const C = cols.map(hexToRgb);
    const ph = [r.float(0, TAU), r.float(0, TAU), r.float(0, TAU)];
    return paint(w, h, (x, y) => {
      const u = x / w;
      const cy = h * 0.3 + Math.sin(u * TAU * 2 + ph[0]) * h * 0.12 + Math.sin(u * TAU * 5 + ph[1]) * h * 0.05;
      const ray = 0.55 + 0.45 * Math.sin(u * TAU * 23 + ph[2] + Math.sin(u * TAU * 3) * 2);
      const dy = y - cy;
      let a = 0;
      if (dy < 0) a = Math.exp(-(dy * dy) / 18);
      else a = Math.exp(-dy / (h * 0.32)) * ray;
      a *= 0.75 * (0.6 + 0.4 * Math.sin(u * TAU * 3 + ph[1]));
      const q = qa(a, x, y, 6);
      if (q <= 0) return 0;
      const k = clamp01(dy / (h * 0.6));
      const c = k < 0.5 ? L3(C[0], C[1], k * 2) : L3(C[1], C[2], (k - 0.5) * 2);
      return packRGB(c[0], c[1], c[2], Math.round(q * 255));
    });
  });
}

// Vertical additive glow strip (bright at the top) for the luminous layer just under the surface.
export function bloomStrip(h, color = '#ffffff', alpha = 0.5) {
  return memo('bls|' + h + color + alpha, () => {
    const C = hexToRgb(color);
    return paint(8, h, (x, y) => {
      const t = y / h;
      const a = Math.pow(1 - t, 2.2) * alpha;
      const q = qa(a, x, y, 8);
      return q <= 0 ? 0 : packRGB(C[0], C[1], C[2], Math.round(q * 255));
    });
  });
}

// ------------------------------------------------------------------ voxel eco-tech

// White wind turbine tower (+ nacelle, hub). Returns {canvas, ox, oy (ground), hub: [x, y] canvas px}.
export function turbineTower(h, scale = 2, accent = '#3ad0ff') {
  return memo('tow|' + h + '|' + scale + accent, () => {
    const W = 11, D = 13;
    const m = new VoxelModel(W, h + 6, D);
    const white = m.color('#f2f7fc', { jitter: 0.03, spec: 0.35, smooth: 0.5 });
    const shadeW = m.color('#d8e6f2', { jitter: 0.03, spec: 0.2, smooth: 0.5 });
    const acc = m.color(accent, { jitter: 0.04, spec: 0.5 });
    const base = m.color('#9fb4c8', { jitter: 0.05 });
    const cx = W / 2, cz = 4.5;
    m.cylinder(cx, cz, 0, 1, 3.2, base);
    m.cone(cx, cz, 1, h, 2.3, 1.2, (x, y) => (y > 4 && y < 7 ? acc : white), 'y');
    m.box(cx - 2, h, cz - 2, cx + 1, h + 3, cz + 4, (x, y) => (y === h + 3 ? white : shadeW));
    m.sphere(cx - 0.5, h + 1.6, cz + 5.6, 1.8, white);
    const [mm, sc] = fineModel(m, scale, 0.06);
    const k = mm === m ? 1 : 2;
    const r = renderModel(mm, { scale: sc, outline: true, jitter: 0.04, ao: 0.8, edges: 0.4, light: { top: 5, lit: 4, dark: 2.6, bottom: 1.6 } });
    const hub = r.project((cx - 0.5) * k, (h + 1.6) * k, (cz + 7.4) * k);
    return { canvas: r.canvas, ox: r.ox, oy: r.oy, w: r.w, h: r.h, hub: [hub[0], hub[1]] };
  });
}

// n rotor frames over one third of a turn (3 blades). Returns {frames, cx, cy (hub in canvas), n}.
export function rotorFrames(L, scale = 2, n = 12) {
  return memo('rot|' + L + '|' + scale + '|' + n, () => {
    const S = Math.ceil(L) * 2 + 5, c = S / 2;
    const frames = [];
    let cx = 0, cy = 0;
    for (let f = 0; f < n; f++) {
      const m = new VoxelModel(S, S, 4);
      const blade = m.color('#f6faff', { jitter: 0.02, spec: 0.45, smooth: 0.6 });
      const edge = m.color('#cfdeec', { jitter: 0.02 });
      const tip = m.color('#ff7a5a', { jitter: 0.02 });
      const hub = m.color('#ffffff', { spec: 0.6, smooth: 0.8 });
      for (let k = 0; k < 3; k++) {
        const th = Math.PI / 2 + (f / n) * (TAU / 3) + (k * TAU) / 3;
        const ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
        for (let s = 0.8; s <= L; s += 0.35) {
          const t = s / L;
          const chord = (t < 0.25 ? lerp(0.9, 1.7, t / 0.25) : lerp(1.7, 0.5, (t - 0.25) / 0.75)) * (L > 14 ? 1.25 : 0.85);
          for (let q = -chord; q <= chord * 0.6; q += 0.4) {
            const x = c + ux * s + vx * q, y = c + uy * s + vy * q;
            m.set(x, y, 1, t > 0.9 ? tip : q < -chord + 0.6 ? edge : blade);
          }
        }
      }
      m.sphere(c, c, 2, L > 14 ? 2.3 : 1.6, hub);
      const r = renderModel(m, { scale, outline: true, jitter: 0.03, ao: 0.4, edges: 0.3, depthLines: false, light: { top: 5, lit: 4.2, dark: 3.2, bottom: 2.4 } });
      const p = r.project(c, c, 3);
      cx = p[0]; cy = p[1];
      frames.push(r.canvas);
    }
    return { frames, cx: Math.round(cx), cy: Math.round(cy), n };
  });
}

// Generic sway animation from a voxel builder: build(m, origin[x, y, z], phase, rng) fills the model.
// Returns a coral.js voxAnim-compatible object {frames, nights, ox, oy, n, P} (use with placeAnim).
// o.hi = {key, dims, build}: the double-detail twin built by A.hiSteps() for the zoomed-in camera.
export function swayAnim(key, dims, build, o = {}) {
  const frames = o.frames ?? 8, scale = o.scale ?? 1;
  const k = 'sway|' + key + '|' + frames + '|' + scale;
  let A = cache.get(k);
  if (!A) {
    const it = swaySteps(dims, build, o);
    let r = it.next();
    while (!r.done) r = it.next();
    A = r.value;
    cache.set(k, A);
  }
  if (o.hi && !A.hiSteps) {
    Object.defineProperty(A, 'hiSteps', {
      value: function* hiSteps() {
        const hk = 'sway|' + o.hi.key + '|' + frames + '|' + scale;
        let H = cache.get(hk);
        if (!H) { H = yield* swaySteps(o.hi.dims, o.hi.build, { ...o, hi: null }); cache.set(hk, H); }
        return H;
      },
      enumerable: false,
    });
  }
  return A;
}
function* swaySteps(dims, build, o) {
  const frames = o.frames ?? 8, scale = o.scale ?? 1;
  {
    const out = [], nights = [];
    for (let f = 0; f < frames; f++) {
      const m = new VoxelModel(dims[0], dims[1], dims[2]);
      const glowIds = build(m, [dims[0] / 2, 0, dims[2] / 2], (f / frames) * TAU, new RNG(o.seed ?? 1)) || null;
      const r = renderModel(m, { scale, outline: true, jitter: 0.05, ao: 1, edges: 0.7, light: { top: 5, lit: 3.8, dark: 2.3, bottom: 1.2 }, ...(o.render || {}) });
      const p = r.project(dims[0] / 2, 0, dims[2] / 2);
      out.push({ canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) });
      nights.push(glowIds ? idGlow(r, glowIds) : null);
      yield;
    }
    const minX = Math.min(...out.map((q) => -q.ox)), minY = Math.min(...out.map((q) => -q.oy));
    const maxX = Math.max(...out.map((q) => q.canvas.width - q.ox)), maxY = Math.max(...out.map((q) => q.canvas.height - q.oy));
    const W = maxX - minX, Hh = maxY - minY;
    const box = (src, q) => { if (!src) return null; const c = makeCanvas(W, Hh); ctxOf(c).drawImage(src, -minX - q.ox, -minY - q.oy); return c; };
    return { frames: out.map((q) => box(q.canvas, q)), nights: out.map((q, i) => box(nights[i], q)), ox: -minX, oy: -minY, n: frames, P: o.period ?? 3.2 };
  }
}

// Bright copy of the pixels whose voxel id is in `ids` (for additive night glow).
function idGlow(r, ids) {
  const { w, h } = r;
  const src = ctxOf(r.canvas).getImageData(0, 0, w, h).data;
  const set = new Set(ids);
  let any = false;
  const c = paint(w, h, (x, y) => {
    const p = y * w + x;
    if (!set.has(r.ids[p])) return 0;
    any = true;
    return packRGB(Math.min(255, src[p * 4] + 40), Math.min(255, src[p * 4 + 1] + 40), Math.min(255, src[p * 4 + 2] + 40), 255);
  });
  return any ? c : null;
}

const leafCol = (m, base) => ({
  dark: m.color(shade(base, -0.35), { jitter: 0.05, spec: 0.3 }),
  mid: m.color(base, { jitter: 0.05, spec: 0.55, specPow: 18 }),
  light: m.color(shade(base, 0.3), { jitter: 0.04, spec: 0.7, specPow: 14 }),
  rib: m.color(shade(base, 0.55), { jitter: 0.03, spec: 0.4 }),
  stem: m.color(shade(base, -0.15), { jitter: 0.05 }),
});

// Glossy broad-leaf plant: a fan of shiny ovate leaves on curved stems.
export function buildLeaves(size, hue = '#3fcf4a') {
  return (m, [cx, y0, cz], ph, r) => {
    const P = leafCol(m, hue);
    const n = r.int(4, 6);
    for (let i = 0; i < n; i++) {
      const a0 = lerp(-1.05, 1.05, n === 1 ? 0.5 : i / (n - 1)) + r.float(-0.15, 0.15);
      const a = a0 + Math.sin(ph + i * 1.3) * 0.12;
      const sl = size * r.float(0.35, 0.6), ll = size * r.float(0.7, 1);
      const z = cz + r.float(-2, 2);
      // stem
      let x = cx, y = y0;
      for (let s = 0; s < sl; s += 0.5) { x = cx + Math.sin(a) * s; y = y0 + Math.cos(a) * s; m.set(x, y, z, P.stem); }
      // blade along the leaf axis, drooping toward the tip
      const ux = Math.sin(a * 1.25), uy = Math.cos(a * 1.25);
      for (let s = 0; s < ll; s += 0.4) {
        const t = s / ll;
        const wd = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.75) * size * 0.26;
        const droop = t * t * size * 0.25;
        const bx = x + ux * s, by = y + uy * s - droop;
        for (let q = -wd; q <= wd; q += 0.45) {
          const px = bx + uy * q, py = by - ux * q * 0.6, pz = z + Math.abs(q) * 0.3;
          const col = Math.abs(q) < 0.5 ? P.rib : q < -wd * 0.35 ? P.light : q > wd * 0.6 ? P.dark : P.mid;
          m.set(px, py, pz, col);
        }
      }
    }
    return null;
  };
}

// Flower clump: daisies (white petals, golden domes) and glossy tulips, on swaying stems.
export function buildFlowers(size, kinds = ['daisy', 'tulip']) {
  return (m, [cx, y0, cz], ph, r) => {
    const stem = m.color('#3caa3a', { jitter: 0.05 });
    const leaf = m.color('#5ad24a', { jitter: 0.05, spec: 0.5 });
    const petal = m.color('#ffffff', { jitter: 0.03, spec: 0.4 });
    const petalS = m.color('#e2ecff', { jitter: 0.03 });
    const gold = m.color('#ffcc2a', { jitter: 0.05, spec: 0.6 });
    const tul = [m.color('#ff5a8a', { jitter: 0.04, spec: 0.7 }), m.color('#ff9ac0', { jitter: 0.03, spec: 0.8 })];
    const tulY = [m.color('#ffb02a', { jitter: 0.04, spec: 0.7 }), m.color('#ffe07a', { jitter: 0.03, spec: 0.8 })];
    const n = r.int(3, 5);
    for (let i = 0; i < n; i++) {
      const kind = r.pick(kinds);
      const hgt = size * r.float(0.7, 1.15);
      const lean = r.float(-0.25, 0.25), off = r.float(0, TAU);
      const z = cz + r.int(-2, 2);
      let x = cx + r.float(-size * 0.3, size * 0.3), y = y0;
      for (let s = 0; s < hgt; s += 0.5) {
        const t = s / hgt;
        x += Math.sin(lean + Math.sin(ph + off) * 0.25 * t) * 0.5;
        y = y0 + s;
        m.set(x, y, z, stem);
        if (Math.abs(s - hgt * 0.3) < 0.3) for (let k = 1; k < 4; k++) m.set(x + k * (i % 2 ? 1 : -1), y + k * 0.5, z, leaf);
      }
      if (kind === 'daisy') {
        const pr = size * 0.2 + 1.2;
        for (let k = 0; k < 10; k++) {
          const th = (k / 10) * TAU;
          for (let s = 0.8; s <= pr; s += 0.4) m.set(x + Math.cos(th) * s, y + 1 + Math.sin(th) * s * 0.9, z + 1, s > pr * 0.7 && k % 2 ? petalS : petal);
        }
        m.sphere(x, y + 1, z + 1.5, Math.max(1, pr * 0.38), gold);
      } else {
        const C = r.chance(0.6) ? tul : tulY;
        const tr = size * 0.13 + 1;
        m.ellipsoid(x, y + tr, z, tr, tr * 1.3, tr, C[0]);
        m.sub(() => m.box(x - tr * 0.3, y + tr * 1.9, z - tr, x + tr * 0.3, y + tr * 2.6, z + tr, 0));
        m.set(x - tr * 0.5, y + tr * 1.5, z + tr * 0.8, C[1]);
      }
    }
    return null;
  };
}

// App-like crystal plant: glassy stems topped with rounded-square glossy tiles (aqua, lime, orange, sky, pink).
export function buildCrystalApps(size, cols = ['#2ad8ff', '#6ae84a', '#ffb02a', '#4a9aff', '#ff6ab4']) {
  return (m, [cx, y0, cz], ph, r) => {
    const stem = m.color('#8af0ff', { jitter: 0.03, spec: 0.6 });
    const glow = [];
    const tiles = cols.map((c) => {
      const base = m.color(c, { jitter: 0.02, spec: 0.6, specPow: 12, emissive: 0.25 });
      const top = m.color(mix(c, '#ffffff', 0.55), { jitter: 0.02, spec: 0.8, emissive: 0.25 });
      const dark = m.color(shade(c, -0.3), { jitter: 0.02, emissive: 0.15 });
      glow.push(base, top);
      return { base, top, dark };
    });
    const n = r.int(3, 5);
    const ts = Math.max(3, Math.round(size * 0.28));
    for (let i = 0; i < n; i++) {
      const hgt = size * r.float(0.55, 1.2);
      const lean = lerp(-0.5, 0.5, n === 1 ? 0.5 : i / (n - 1)) + r.float(-0.1, 0.1);
      const z = cz + r.int(-2, 2);
      let x = cx, y = y0;
      for (let s = 0; s < hgt; s += 0.5) {
        x = cx + Math.sin(lean + Math.sin(ph + i) * 0.07) * s;
        y = y0 + Math.cos(lean) * s;
        m.set(x, y, z, stem);
      }
      const T = tiles[(i + r.int(0, 4)) % tiles.length];
      const x0 = Math.round(x - ts / 2), yb = Math.round(y);
      for (let yy = 0; yy < ts; yy++) for (let xx = 0; xx < ts; xx++) {
        const corner = (xx === 0 || xx === ts - 1) && (yy === 0 || yy === ts - 1);
        if (corner) continue;
        const c = yy >= ts * 0.55 ? T.top : yy === 0 ? T.dark : T.base;
        m.set(x0 + xx, yb + yy, z, c);
        m.set(x0 + xx, yb + yy, z - 1, T.dark);
      }
    }
    return glow;
  };
}

// Aqua bubble plant: thin stems holding glossy aqua spheres, like a glass grape vine.
export function buildBubblePlant(size) {
  return (m, [cx, y0, cz], ph, r) => {
    const stem = m.color('#2ab8a8', { jitter: 0.04 });
    const ball = m.color('#5ae8f0', { jitter: 0.03, spec: 0.9, specPow: 10, smooth: 0.8, emissive: 0.15 });
    const ballL = m.color('#c8fcff', { jitter: 0.02, spec: 0.9, smooth: 0.8, emissive: 0.2 });
    const n = r.int(3, 4);
    for (let i = 0; i < n; i++) {
      const hgt = size * r.float(0.8, 1.3), lean = r.float(-0.35, 0.35), off = r.float(0, TAU);
      const z = cz + r.int(-2, 2);
      let x = cx;
      for (let s = 0; s < hgt; s += 0.5) {
        const t = s / hgt;
        x = cx + Math.sin(lean + Math.sin(ph + off) * 0.18 * t) * s;
        const y = y0 + s;
        m.set(x, y, z, stem);
        if (s > hgt * 0.35 && Math.abs((s % 3.5) - 1.75) < 0.26) {
          const side = Math.floor(s / 3.5) % 2 ? 1 : -1;
          const br = r.float(1, 1.8);
          m.sphere(x + side * (br + 0.6), y, z + 0.5, br, ball);
          m.set(x + side * (br + 0.6) - 0.6, y + br * 0.5, z + br, ballL);
        }
      }
      m.sphere(x, y0 + hgt + 1, z + 0.5, 1.9, ball);
      m.set(x - 0.6, y0 + hgt + 2, z + 2, ballL);
    }
    return [ball, ballL];
  };
}

// Glossy little dock: white planks with aqua glass trim, chrome posts and rail, an orb lamp and a life ring.
// len in voxels (x), posts reach `deep` voxels below the deck. Returns sprite + anchors.
export function pierModel(len = 90, deep = 30, scale = 2) {
  return memo('pier|' + len + '|' + deep + '|' + scale, () => {
    const D = 12, deckY = deep, H = deep + 30;
    const m = new VoxelModel(len, H, D);
    const plank = [m.color('#f6f2ea', { jitter: 0.04, spec: 0.3 }), m.color('#e8e0d4', { jitter: 0.04, spec: 0.25 })];
    const gap = m.color('#b8b0a6', { jitter: 0.03 });
    const trim = m.color('#3ad0f0', { jitter: 0.03, spec: 0.8, specPow: 10 });
    const trimL = m.color('#b8f6ff', { jitter: 0.02, spec: 0.8 });
    const chrome = m.color('#c8d8e8', { jitter: 0.02, spec: 0.9, specPow: 8, smooth: 0.8 });
    const chromeD = m.color('#7a90aa', { jitter: 0.02, spec: 0.6, smooth: 0.8 });
    const lampG = m.color('#fff6c8', { emissive: 0.9, spec: 0.9, smooth: 0.9 });
    const ringW = m.color('#ffffff', { jitter: 0.02, spec: 0.5 }), ringR = m.color('#ff5a6a', { jitter: 0.02, spec: 0.5 });
    // posts (chrome pillars, pairs)
    for (let x = 4; x < len; x += 14) for (const z of [2, D - 3]) m.cylinder(x, z, 0, deckY - 1, 1.3, (xx, y) => (y % 6 === 0 ? chromeD : chrome), 'y');
    // deck
    m.box(0, deckY, 0, len - 1, deckY + 1, D - 1, (x) => (x % 6 === 5 ? gap : plank[Math.floor(x / 6) % 2]));
    m.box(0, deckY - 1, D - 1, len - 1, deckY, D - 1, (x) => (x % 10 < 5 ? trim : trimL));
    // back rail: white posts and handrail with aqua glass panels (Aero balcony)
    const railW = m.color('#f8fbff', { jitter: 0.02, spec: 0.6, smooth: 0.6 });
    const pane = m.color('#9ee8fa', { jitter: 0.02, spec: 0.9, specPow: 8, smooth: 0.7 }), paneL = m.color('#e6fcff', { jitter: 0.01, spec: 0.9 });
    for (let x = 0; x < len; x++) for (let y = deckY + 2; y <= deckY + 7; y++) {
      const u = (x + (y - deckY) * 1.5) % 13;
      m.set(x, y, 1, u < 1.6 || (u > 3 && u < 3.8) ? paneL : pane);
    }
    for (let x = 2; x < len; x += 10) m.box(x, deckY + 2, 1, x, deckY + 8, 2, railW);
    m.box(0, deckY + 8, 1, len - 1, deckY + 9, 2, railW);
    m.box(0, deckY + 8, 3, len - 1, deckY + 8, 3, trim);
    // orb lamp at the pier end
    m.cylinder(3, 3, deckY + 2, deckY + 20, 0.8, chrome, 'y');
    m.sphere(3.5, deckY + 23, 3.5, 2.9, lampG);
    // life ring on the rail
    const rx = Math.round(len * 0.62);
    for (let a = 0; a < 24; a++) { const th = (a / 24) * TAU; m.set(rx + Math.cos(th) * 3, deckY + 5 + Math.sin(th) * 3, 2, a % 6 < 3 ? ringW : ringR); }
    const r = renderModel(m, { scale, outline: true, jitter: 0.05, ao: 1, edges: 0.6, light: { top: 5, lit: 4, dark: 2.4, bottom: 1.4 } });
    const P = (x, y, z) => { const q = r.project(x, y, z); return [Math.round(q[0]), Math.round(q[1])]; };
    return { canvas: r.canvas, glow: r.glow, w: r.w, h: r.h, deck: P(len / 2, deckY + 2, D / 2), deckL: P(0, deckY + 2, D / 2), water: P(0, deckY - 4, D), lamp: P(3.5, deckY + 23, 3.5), front: P(0, deckY + 2, D) };
  });
}

// ------------------------------------------------------------------ eco Aero wallpaper set pieces (reference 8.jpg)

// White arc lines sweeping across the sky (concentric, fading toward both ends). Centre lies below-left.
export function skyArcs(w, h, n = 9, gap = 7) {
  return memo('arcs|' + w + '|' + h + '|' + n + '|' + gap, () => {
    const cx = w * 0.08, cy = h * 1.9, R0 = Math.hypot(w * 0.55 - cx, h * 0.62 - cy);
    return paint(w, h, (x, y) => {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - R0;
      const k = d / gap;
      const i = Math.round(k);
      if (i < 0 || i >= n || Math.abs(k - i) * gap > 0.55) return 0;
      const u = x / w;
      const a = Math.sin(clamp01((u - 0.05) / 0.9) * Math.PI) * (0.75 - i * 0.045);
      const q = qa(a, x, y, 5);
      return q <= 0 ? 0 : packRGB(255, 255, 255, Math.round(q * 255));
    });
  });
}

// Radial sun rays (draw additively at the sun). Two seeds crossfaded read as slowly turning rays.
export function sunRays(R, seed = 1, n = 22) {
  return memo('rays|' + R + '|' + seed + '|' + n, () => {
    const r = new RNG(seed);
    const rays = Array.from({ length: n }, () => [r.float(0, TAU), r.float(0.012, 0.05), r.float(0.4, 1)]);
    const NB = 1440, lut = new Float32Array(NB);
    for (let i = 0; i < NB; i++) {
      const ang = (i / NB) * TAU - Math.PI;
      let a = 0;
      for (const [th, wdt, k] of rays) {
        let da = Math.abs(ang - th) % TAU;
        if (da > Math.PI) da = TAU - da;
        if (da < wdt * 3) a = Math.max(a, Math.exp(-(da * da) / (wdt * wdt)) * k);
      }
      lut[i] = a;
    }
    const s = R * 2 + 1;
    return paint(s, s, (x, y) => {
      const dx = x - R, dy = y - R, d = Math.hypot(dx, dy) / R;
      if (d >= 1 || d < 0.04) return 0;
      let a = lut[Math.min(NB - 1, Math.floor(((Math.atan2(dy, dx) + Math.PI) / TAU) * NB))];
      if (a < 0.02) return 0;
      a *= Math.pow(1 - d, 1.6) * 0.8;
      const q = qa(a, x, y, 6);
      return q <= 0 ? 0 : packRGB(255, 252, 236, Math.round(q * 255));
    });
  });
}

// Green glass globe (original land shapes from 3D noise, no real map): n frames of one full turn, built lazily.
export class GlassGlobe {
  constructor(r = 56, n = 24, seed = 4) {
    this.r = r; this.n = n; this.frames = new Array(n).fill(null);
    const W = 160, Hh = 80;
    this.map = new Uint8Array(W * Hh);
    this.mw = W; this.mh = Hh;
    for (let j = 0; j < Hh; j++) {
      const lat = (j / (Hh - 1) - 0.5) * Math.PI;
      for (let i = 0; i < W; i++) {
        const lon = (i / W) * TAU;
        const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
        const v = fbm3n(px * 1.6 + 3, py * 1.9, pz * 1.6, seed);
        this.map[j * W + i] = v > 0.56 ? 2 : v > 0.52 ? 1 : 0;
      }
    }
  }

  frame(i) {
    i = ((i % this.n) + this.n) % this.n;
    if (!this.frames[i]) this.frames[i] = this.build(i);
    return this.frames[i];
  }

  // nearest built frame (warm() builds one more per call)
  get(i) {
    i = ((i % this.n) + this.n) % this.n;
    if (this.frames[i]) return this.frames[i];
    for (let d = 1; d < this.n; d++) { const f = this.frames[(i + d) % this.n] || this.frames[(i - d + this.n) % this.n]; if (f) return f; }
    return this.frame(i);
  }

  warm() { const k = this.frames.indexOf(null); if (k >= 0) this.frames[k] = this.build(k); }

  // One frame = a voxel sphere (2 px voxels): green glass sea, pale lime land, white grid lines, a darker rim.
  build(fi) {
    const rv = Math.round(this.r / 1.5), s = rv * 2 + 3, c0 = rv + 1.5, rot = (fi / this.n) * TAU; // [phase7:env] 1.5 px voxels (was 2)
    const m = new VoxelModel(s, s, s);
    const sea = m.color('#2fbf3a', { jitter: 0.02, spec: 0.9, specPow: 9, smooth: 0.9 }), seaD = m.color('#16902e', { jitter: 0.02, spec: 0.8, smooth: 0.9 });
    const land = m.color('#c8f8a0', { jitter: 0.03, spec: 0.7, smooth: 0.8 }), coast = m.color('#8ae46a', { jitter: 0.03, spec: 0.7, smooth: 0.8 });
    const grid = m.color('#f4fff0', { jitter: 0.01, spec: 0.9, smooth: 0.9, emissive: 0.15 });
    const { map, mw, mh } = this;
    const ca = 0.92, sa = 0.39;
    for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const nx = (x + 0.5 - c0) / rv, ny = (y + 0.5 - c0) / rv, nz = (z + 0.5 - c0) / rv;
      const d2 = nx * nx + ny * ny + nz * nz;
      if (d2 > 1 || d2 < 0.8) continue; // hollow shell
      // tilted axis; ny is up in model space
      const ty = ny * ca - nx * sa, tx = nx * ca + ny * sa;
      const dd = Math.sqrt(d2);
      const lat = Math.asin(clamp(ty / dd, -1, 1));
      const lon = Math.atan2(tx, nz) + rot;
      const gl = Math.abs(((lat / (Math.PI / 6)) % 1 + 1) % 1 - 0.5), gm = Math.abs(((lon / (Math.PI / 6)) % 1 + 1) % 1 - 0.5);
      let c;
      if (gl > 0.47 || gm > 0.5 - 0.03 / Math.max(0.3, Math.cos(lat))) c = grid;
      else {
        const mi = Math.floor((((lon / TAU) % 1) + 1) % 1 * mw), mj = clamp(Math.floor((lat / Math.PI + 0.5) * (mh - 1) + 0.5), 0, mh - 1);
        const t = map[mj * mw + mi];
        c = t === 2 ? land : t === 1 ? coast : ny < -0.3 ? seaD : sea;
      }
      m.set(x, y, z, c);
    }
    const r = renderModel(m, { scale: 1.5, outline: true, jitter: 0.02, ao: 0.3, edges: 0.3, light: { top: 5, lit: 4.2, dark: 2.8, bottom: 2.2 } });
    return r.canvas;
  }
}

// Voxel glass shell (draw at low alpha over what it encloses) + an opaque splashing water ribbon around its rim.
export function voxWaterBubble(R) {
  R = Math.round(R);
  return memo('vwb|' + R, () => {
    const rv = Math.round(R / 2), s = rv * 2 + 5, c0 = s / 2;
    const m = new VoxelModel(s, s, s);
    const glass = m.color('#9ae6ff', { jitter: 0.02, spec: 1, specPow: 8, smooth: 0.95 });
    for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.hypot(x + 0.5 - c0, y + 0.5 - c0, z + 0.5 - c0);
      if (d <= rv && d > rv - 1.4 && z + 0.5 >= c0) m.set(x, y, z, glass);
    }
    const shell = renderModel(m, { scale: 2, outline: false, jitter: 0.02, ao: 0.2, edges: 0.6, light: { top: 5.6, lit: 4.8, dark: 3.4, bottom: 2.6 } });
    const rm = new VoxelModel(s, s, s);
    const foam = rm.color('#ffffff', { jitter: 0.02, spec: 0.8 }), aqua = rm.color('#bff4ff', { jitter: 0.02, spec: 0.9 });
    for (let i = 0; i < 160; i++) {
      const a = Math.PI * 0.95 + (i / 160) * Math.PI * 0.95;
      const rr = rv + 0.6 + Math.sin(a * 3 + 1) * 1.1;
      const x = c0 + Math.cos(a) * rr, y = c0 - Math.sin(a) * rr * -1, z = c0 + rv * 0.45 + Math.sin(a * 2) * 1.5;
      rm.set(x, s - 1 - y, z, i % 7 < 3 ? foam : aqua);
      if (i % 3 === 0) rm.set(x + 0.6, s - 1 - y, z + 0.6, aqua);
    }
    const ribbon = renderModel(rm, { scale: 2, outline: true, jitter: 0.02, ao: 0.2, edges: 0.4 });
    const sp = shell.project(c0, c0, c0), rp = ribbon.project(c0, c0, c0);
    return { shell: shell.canvas, ribbon: ribbon.canvas, sx: Math.round(sp[0]), sy: Math.round(sp[1]), rx: Math.round(rp[0]), ry: Math.round(rp[1]) };
  });
}

// Liquid-chrome voxel droplet (sky blue top, white horizon band, green bottom). {canvas, w, h} (tip up).
export function voxDrop(h, tint = '#5ac8ff') {
  h = Math.max(6, Math.round(h));
  return memo('vdrop|' + h + tint, () => {
    const R = h * 0.36, n = Math.ceil(R * 2) + 3, c0 = n / 2;
    const m = new VoxelModel(n, h + 2, n);
    const sky = m.color(mix(tint, '#ffffff', 0.4), { jitter: 0.02, spec: 1, specPow: 8, smooth: 0.9 }), band = m.color('#ffffff', { spec: 1, smooth: 0.9 });
    const dark = m.color(shade(tint, -0.55), { jitter: 0.02, spec: 0.9, smooth: 0.9 }), grass = m.color('#4cc85a', { jitter: 0.02, spec: 0.9, smooth: 0.9 });
    const cy = R + 0.5;
    for (let y = 0; y < h + 1; y++) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c0, dz = z + 0.5 - c0;
      const rr = y + 0.5 <= cy ? Math.sqrt(Math.max(0, R * R - (cy - y - 0.5) ** 2)) : R * Math.pow(Math.max(0, 1 - (y + 0.5 - cy) / (h - cy)), 1.35);
      if (dx * dx + dz * dz > rr * rr) continue;
      const u = (y + 0.5) / h;
      m.set(x, y, z, u > 0.5 ? sky : u > 0.42 ? band : u > 0.3 ? dark : grass);
    }
    const r = renderModel(m, { scale: 1, outline: true, jitter: 0.02, ao: 0.3, edges: 0.5 });
    return { canvas: r.canvas, w: r.w, h: r.h };
  });
}

function fbm3n(x, y, z, seed) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < 4; i++) { v += vnoise3(x * f, y * f, z * f, seed + i * 7) * a; n += a; a *= 0.5; f *= 2.1; }
  return v / n;
}
function vnoise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const h = (i, j, k) => hash2(x0 + i + (z0 + k) * 157, y0 + j, seed);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), sx), l(h(0, 1, 0), h(1, 1, 0), sx), sy), l(l(h(0, 0, 1), h(1, 0, 1), sx), l(h(0, 1, 1), h(1, 1, 1), sx), sy), sz);
}

// A giant water bubble (draw over a voxel city): clear aqua body, splashing rim swirl, gloss window and sparkles.
export function waterBubble(r) {
  r = Math.round(r);
  return memo('wbub|' + r, () => {
    const s = r * 2 + 8, c0 = s / 2;
    const rim = hexToRgb('#bff4ff'), body = hexToRgb('#9ae6ff');
    return paint(s, s, (x, y) => {
      const dx = (x + 0.5 - c0) / r, dy = (y + 0.5 - c0) / r;
      const d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      // swirl ribbon spiralling around the upper-left rim (the splash)
      const sw = 1 + 0.06 * Math.sin(ang * 3 + 1) + 0.035 * Math.sin(ang * 7);
      const onSwirl = ang < 0.2 && ang > -2.9 && Math.abs(d - sw) < 0.05 + 0.04 * Math.sin(ang * 5 + 2) ** 2;
      if (d > 1.12) return 0;
      if (onSwirl) return packRGB(...L3(rim, WHITE, 0.5 + 0.5 * Math.sin(ang * 4) ** 2), Math.round(qa(0.85, x, y) * 255));
      if (d > 1) return 0;
      const lit = clamp01(0.5 - (dx + dy) * 0.45);
      if (d > 1 - 1.6 / r) return packRGB(...L3(rim, WHITE, lit), Math.round(qa(0.55 + lit * 0.4, x, y) * 255));
      // gloss window top-left, soft reflection bottom-right
      const gx = (dx + 0.38) / 0.36, gy = (dy + 0.5) / 0.2;
      if (gx * gx + gy * gy < 1) return packRGB(255, 255, 255, Math.round(qa(0.55 - gy * 0.2, x, y) * 255));
      if (d > 0.72 && d < 0.86 && ang > 0.15 && ang < 1.4) return packRGB(255, 255, 255, Math.round(qa(0.4, x, y) * 255));
      const a = 0.08 + Math.pow(d, 3) * 0.28;
      const q = qa(a, x, y, 8);
      return q <= 0 ? 0 : packRGB(...L3(body, WHITE, 0.3 * (1 - d)), Math.round(q * 255));
    });
  });
}

// Voxel glass skyscrapers (a little eco city). Returns {canvas, ox (centre), oy (ground), w, h}.
export function glassCity(seed = 3, scale = 2) {
  return memo('city|' + seed + '|' + scale, () => {
    const r = new RNG(seed);
    const m = new VoxelModel(58, 64, 22);
    const glass = [m.color('#3a7ad0', { jitter: 0.03, spec: 0.9, specPow: 8, smooth: 0.4 }), m.color('#5aa8f0', { jitter: 0.03, spec: 0.9, specPow: 8 }), m.color('#2a5aa8', { jitter: 0.03, spec: 0.8 })];
    const lite = m.color('#c8ecff', { jitter: 0.02, spec: 0.9 }), frame = m.color('#eaf4ff', { jitter: 0.02, spec: 0.5 }), green = m.color('#5ad24a', { jitter: 0.05 });
    const towers = [[2, 9, 30, 8], [11, 8, 46, 9], [20, 10, 60, 10], [31, 8, 38, 8], [40, 9, 52, 9], [50, 7, 26, 7]];
    for (const [x0, w, h, d] of towers) {
      const z0 = r.int(2, 22 - d - 1), gi = r.int(0, 2);
      m.box(x0, 0, z0, x0 + w - 1, h - 1, z0 + d - 1, (x, y, z) => {
        if (y === h - 1) return frame;
        if ((x === x0 || x === x0 + w - 1) && (z === z0 || z === z0 + d - 1)) return frame;
        if (y % 4 === 3) return lite;
        return (x - x0 + y) % 9 < 2 ? lite : glass[gi];
      });
      if (h > 50) m.box(x0 + (w >> 1), h, z0 + (d >> 1), x0 + (w >> 1), h + 6, z0 + (d >> 1), frame);
      // roof garden
      if (r.chance(0.6)) m.box(x0 + 1, h, z0 + 1, x0 + w - 2, h, z0 + d - 2, green);
    }
    const [mm, sc] = fineModel(m, scale);
    const o = renderModel(mm, { scale: sc, outline: true, jitter: 0.04, ao: 0.6, edges: 0.5, light: { top: 5.2, lit: 4.2, dark: 2.6, bottom: 1.6 } });
    return { canvas: o.canvas, w: o.w, h: o.h, ox: o.ox, oy: o.oy };
  });
}

// [phase7:env] 2x voxel refinement (EPX smoothing + surface grit) for models rendered at >= 2 px per voxel
function fineModel(m, scale, grit = 0.1) {
  if (scale < 2) return [m, scale];
  return [runSteps(refineSteps(m, { grit })), scale / 2];
}

// Round glossy voxel tree (the lone tree on the wallpaper hill).
export function roundTree(scale = 2, seed = 5) {
  return memo('tree|' + scale + '|' + seed, () => {
    const r = new RNG(seed);
    const m = new VoxelModel(30, 34, 24);
    const bark = m.color('#8a5a32', { jitter: 0.08 }), leaf = m.color('#3cbf3a', { jitter: 0.06, spec: 0.5 }), leafL = m.color('#8ef05a', { jitter: 0.05, spec: 0.7 }), leafD = m.color('#1f8a32', { jitter: 0.05 });
    m.cylinder(15, 12, 0, 12, 1.6, bark, 'y');
    for (let i = 0; i < 9; i++) {
      const cx = 15 + r.float(-7, 7), cy = 21 + r.float(-5, 7), cz = 12 + r.float(-5, 5), rr = r.float(5, 8);
      m.sphere(cx, cy, cz, rr, (x, y, z) => (y > cy + rr * 0.35 && x < cx + 2 ? leafL : y < cy - rr * 0.4 ? leafD : leaf));
    }
    const [mm, sc] = fineModel(m, scale, 0.16);
    const o = renderModel(mm, { scale: sc, outline: true, jitter: 0.05, ao: 1, edges: 0.6, light: { top: 5.2, lit: 4, dark: 2.4, bottom: 1.4 } });
    return { canvas: o.canvas, w: o.w, h: o.h, ox: o.ox, oy: o.oy };
  });
}

// Crown splash at the waterline: n frames {canvas, ox (centre), oy (waterline)}.
export function splashFrames(size = 12, n = 6, seed = 2) {
  return memo('spl|' + size + '|' + n + '|' + seed, () => {
    const r = new RNG(seed);
    const drops = Array.from({ length: 9 }, () => ({ a: r.float(-1.25, 1.25), v: r.float(0.6, 1.1), s: r.pick([1, 1, 2]) }));
    const w = size * 4 + 4, h = size * 3 + 4, cx = w / 2, by = h - 3;
    const out = [];
    for (let f = 0; f < n; f++) {
      const k = (f + 0.5) / n;
      const c = makeCanvas(w, h);
      const g = ctxOf(c);
      // crown sheet
      const ch = Math.round(size * 1.2 * Math.sin(Math.min(1, k * 1.6) * Math.PI) + 1), cw = Math.round(size * (0.5 + k * 0.9));
      for (let x = -cw; x <= cw; x++) {
        const u = Math.abs(x) / cw;
        const hh = Math.round(ch * (0.35 + 0.65 * u * u) * (1 - k * 0.5));
        for (let y = 0; y < hh; y++) {
          const edge = y === hh - 1 || Math.abs(x) >= cw - 1;
          g.fillStyle = edge ? '#ffffff' : (x + y) % 3 === 0 ? '#e8fdff' : '#9ae8ff';
          g.globalAlpha = edge ? 0.95 : 0.55 * (1 - k * 0.6);
          g.fillRect(Math.round(cx + x), by - y, 1, 1);
        }
      }
      // droplets on ballistic arcs
      for (const d of drops) {
        const t = k * 1.4;
        const dx = Math.sin(d.a) * d.v * size * 1.7 * t, dy = Math.cos(d.a) * d.v * size * 2.4 * t - 2.8 * size * t * t;
        if (dy < -1) continue;
        g.globalAlpha = 1 - k * 0.5;
        g.fillStyle = '#ffffff';
        g.fillRect(Math.round(cx + dx), Math.round(by - ch * 0.6 - dy), d.s, d.s);
        if (d.s > 1) { g.fillStyle = '#5ad0ff'; g.fillRect(Math.round(cx + dx) + 1, Math.round(by - ch * 0.6 - dy) + 1, 1, 1); }
      }
      out.push({ canvas: c, ox: Math.round(cx), oy: by + 1 });
    }
    return out;
  });
}

// Leafy branch with big glossy leaves (framing the corners). dir 1 = enters from the right edge hanging left.
export function leafBranch(seed = 1, len = 70, scale = 2, hue = '#46d24a') {
  return memo('lbr|' + seed + '|' + len + '|' + scale + hue, () => {
    const r = new RNG(seed);
    const m = new VoxelModel(len + 24, Math.round(len * 0.75) + 20, 14);
    const P = leafCol(m, hue);
    const stem = m.color('#5a9a3a', { jitter: 0.05 });
    // stem: from the right edge, arcing down-left
    const pts = [];
    for (let s = 0; s <= 1; s += 0.01) {
      const x = len + 20 - s * len, y = m.ny - 6 - Math.pow(s, 1.6) * len * 0.5;
      pts.push([x, y]);
      m.set(x, y, 7, stem); m.set(x, y - 1, 7, stem);
    }
    // leaves alternate along the stem, drooping, big near the tip
    const n = 9;
    for (let i = 1; i <= n; i++) {
      const s = i / (n + 0.6);
      const [bx, by] = pts[Math.min(pts.length - 1, Math.round(s * 100))];
      const side = i % 2 ? 1 : -1;
      const L = lerp(9, 18, s) * r.float(0.85, 1.1), Wd = L * 0.42;
      const a = side > 0 ? r.float(-0.9, -0.4) : r.float(-2.6, -2.1); // pointing down-left/down-right
      const ux = Math.cos(a), uy = Math.sin(a);
      const z = 7 + side * 2;
      for (let t = 0; t <= L; t += 0.4) {
        const u = t / L;
        const wd = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.7) * Wd * (1 - u * 0.25);
        const cx = bx + ux * t, cy = by + uy * t - u * u * 2;
        for (let q = -wd; q <= wd; q += 0.45) {
          const px = cx - uy * q, py = cy + ux * q;
          const col = Math.abs(q) < 0.5 ? P.rib : q * side < -wd * 0.3 ? P.light : q * side > wd * 0.6 ? P.dark : P.mid;
          m.set(px, py, z + Math.abs(q) * 0.25, col);
        }
      }
    }
    const o = renderModel(m, { scale, outline: true, jitter: 0.04, ao: 0.8, edges: 0.6, light: { top: 5.3, lit: 4.4, dark: 2.6, bottom: 1.6 } });
    return { canvas: o.canvas, w: o.w, h: o.h };
  });
}

// The curved grass horizon (a planet's edge) with the eco set pieces standing on it. Returns {canvas, w, h, ox, oy
// (waterline left end), top(x) crest height table, anchor(xf) -> [x, y] crest point}.
export function planetEdge(W, o = {}) {
  const peak = o.peak ?? 0.38, Hc = o.height ?? 46, chord = o.chord ?? 0.58, scale = 2;
  return memo('edge|' + W + '|' + peak + '|' + Hc + '|' + chord, () => {
    const nx = Math.ceil(W / scale) + 8, nz = 28, ny = Hc + 4;
    const m = new VoxelModel(nx, ny, nz);
    const C = (c, op = {}) => m.color(c, { jitter: 0.04, ...op });
    const grass = C('#4ccf3c', { spec: 0.45, specPow: 14, smooth: 0.6 }), grassL = C('#8cf05a', { spec: 0.6, specPow: 12, smooth: 0.6 }), grassD = C('#2a9e36', { smooth: 0.4 });
    const sheen = C('#d8ffb0', { spec: 0.8, smooth: 0.7 }), wet = C('#2a8a6a'), flower = C('#ffffff'), flowerY = C('#ffe23a'), flowerP = C('#ff8ad0');
    const px0 = nx * peak, R = ((nx * chord) ** 2 + Hc * Hc) / (2 * Hc);
    const tops = new Float32Array(nx);
    for (let x = 0; x < nx; x++) {
      const dx = x + 0.5 - px0;
      tops[x] = Math.sqrt(Math.max(0, R * R - dx * dx)) - (R - Hc) + Math.sin(x * 0.07) * 0.8;
    }
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      // the surface falls away toward the viewer (front rows lower) so it reads as a curved slope, not a wall
      const zf = z / (nz - 1);
      const fall = Math.pow(smoothstep(0.15, 1, zf), 1.25) * 0.72;
      const h = Math.round(tops[x] * (1 - fall) + (tops[x] > 2 ? 1 : 0));
      const crestK = 1 - fall;
      for (let y = 0; y < h; y++) {
        let c = y < 2 ? wet : y >= h - 1 ? (hash2(x >> 2, z, 3) < 0.5 - (x - px0) / nx ? grassL : grass) : grassD;
        if (y === h - 1 && crestK > 0.8 && crestK < 0.95 && Math.abs(x - px0 + 18) < nx * 0.16) c = sheen;
        if (y === h - 1 && hash2(x, z, 9) < 0.035) c = [flower, flowerY, flowerP][Math.floor(hash2(z, x, 4) * 3)];
        m.set(x, y, z, c);
      }
    }
    const r = renderModel(m, { scale, outline: true, jitter: 0.03, ao: 0.9, edges: 0.4, light: { top: 5.2, lit: 3.9, dark: 2.3, bottom: 1.2 } });
    const water = r.project(0, 1, nz);
    const crest = (xf, zf = 0.3) => {
      const vx = clamp(Math.round(xf * nx), 0, nx - 1), vz = Math.round(zf * (nz - 1));
      const fall = Math.pow(smoothstep(0.15, 1, vz / (nz - 1)), 1.25) * 0.72;
      const p = r.project(vx + 0.5, Math.max(1, Math.round(tops[vx] * (1 - fall))), vz + 0.5);
      return [Math.round(p[0]), Math.round(p[1])];
    };
    return { canvas: r.canvas, w: r.w, h: r.h, ox: Math.round(water[0]), oy: Math.round(water[1]), crest };
  });
}

// ------------------------------------------------------------------ the glossy layer for every ocean

// look: {bloom, bloomColor, bubbles, bubbleRim, sparkle, sparkleColor, bokeh: [colors], bokehA, flare, deep,
//        rays (sun rays in the sky), arcs (white arc lines), leaves (glossy branches framing the top corners)}
export const AERO_LOOKS = {
  shallows: { bloom: 0.42, bloomColor: '#e8fffc', bubbles: 1.2, bubbleRim: '#c8fbff', sparkle: 1, bokeh: ['#ffffff', '#c8f6ff', '#e0ffd8'], bokehA: 0.1, flare: 1.1, rays: 0.8, arcs: 0.7, leaves: true },
  fjord: { bloom: 0.4, bloomColor: '#f0fdff', bubbles: 0.8, bubbleRim: '#dff8ff', sparkle: 1.3, sparkleColor: '#e8fbff', bokeh: ['#ffffff', '#c8ecff'], bokehA: 0.1, flare: 1, rays: 0.7, arcs: 0.5 },
  junkyard: { bloom: 0.34, bloomColor: '#d8ffe8', bubbles: 1, bubbleRim: '#c8ffe4', sparkle: 0.8, sparkleColor: '#d8ffe8', bokeh: ['#b8ffd8', '#8affd0', '#e8ffd0'], bokehA: 0.1, flare: 0.85, rays: 0.6, arcs: 0.5, leaves: true },
  metropolis: { bloom: 0.22, bloomColor: '#c8d8ff', bubbles: 0.8, bubbleRim: '#c8e0ff', sparkle: 0.8, sparkleColor: '#e8e0ff', bokeh: ['#ff7ae8', '#7ae8ff', '#b48aff', '#ffd27a'], bokehA: 0.14, flare: 0.7, deep: true, rays: 0.35, arcs: 0.45 },
  volcano: { bloom: 0.18, bloomColor: '#ffd8b8', bubbles: 1, bubbleRim: '#ffe0c8', sparkle: 0.6, sparkleColor: '#ffd890', bokeh: ['#ffb070', '#ff8a4a', '#ffe08a'], bokehA: 0.12, flare: 0.6, deep: true, rays: 0.5 },
  abyss: { bloom: 0, bubbles: 0.6, bubbleRim: '#9adfff', sparkle: 0.8, sparkleColor: '#9affea', bokeh: ['#7affea', '#9a7aff', '#ff7ae0', '#7ab8ff'], bokehA: 0.16, flare: 0.25, deep: true },
  oscean: { bloom: 0.5, bloomColor: '#ffffff', bubbles: 1.1, bubbleRim: '#d8fcff', sparkle: 1.2, bokeh: ['#ffffff', '#c8f6ff', '#e8ffd0', '#fff2c8'], bokehA: 0.11, flare: 1.15 },
};

export class AeroOverlay {
  constructor(biome, look) {
    this.b = biome;
    this.look = look;
    this.t = 0;
    this.bubbles = [];
    this.sparks = [];
    this.bokeh = [];
    this.emit = 0;
    this.sparkT = 0;
    this.W = 0; this.H = 0;
  }

  surface(env) {
    const b = this.b;
    try {
      const s = b.surfaceAt ? b.surfaceAt(env) : b.boatLevel ? b.boatLevel(env) : null;
      return Number.isFinite(s) ? s : null;
    } catch { return null; }
  }

  seed() {
    const b = this.b, W = b.W, H = b.H, look = this.look;
    this.W = W; this.H = H;
    const r = new RNG(77 + W);
    this.bokeh = [];
    const nb = look.bokeh ? (look.deep ? 9 : 7) : 0;
    for (let i = 0; i < nb; i++) this.bokeh.push({ x: r.float(0, W), y: r.float(H * 0.15, H * 0.9), r: r.int(6, 22), c: r.pick(look.bokeh), vx: r.float(-3, 3), vy: r.float(-2.5, -0.5), ph: r.float(0, TAU), far: r.chance(0.5) });
  }

  // Sun rays and white arc lines go into the biome's sky dome (behind clouds and horizon features).
  patchSky() {
    const sky = this.b.sky;
    if (!sky || sky.__aero || typeof sky.drawBodies !== 'function' || !(this.look.rays || this.look.arcs)) return;
    sky.__aero = true;
    const orig = sky.drawBodies.bind(sky);
    sky.drawBodies = (ctx, env, tod, clear, scroll, ref) => {
      orig(ctx, env, tod, clear, scroll, ref);
      try { this.drawSkyDressing(ctx, sky, env, tod, clear ?? 1, scroll ?? 0, ref ?? 0); } catch { /* cosmetic */ }
    };
  }

  drawSkyDressing(ctx, sky, env, tod, clear, scroll, ref) {
    const look = this.look, W = sky.W || this.b.W, t = this.t;
    const pa = ctx.globalAlpha, po = ctx.globalCompositeOperation;
    const B = skyBodies(env.hour ?? 12, W, sky.top ?? this.b.top ?? -400, sky.base ?? 0);
    if (look.rays && B.sun.up && tod.night < 0.9) {
      const a = look.rays * clamp01(clear) * (tod.day + tod.dusk * 0.7);
      if (a > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        const y = Math.round(B.sun.y + 0.28 * (scroll - ref));
        [sunRays(150, 3), sunRays(150, 7, 18)].forEach((spr, i) => {
          ctx.globalAlpha = a * (i ? 0.5 + 0.5 * Math.sin(t * 0.21) : 0.5 - 0.5 * Math.sin(t * 0.21)) * 0.7;
          ctx.drawImage(spr, Math.round(B.sun.x - (spr.width >> 1)), y - (spr.height >> 1));
        });
      }
    }
    if (look.arcs) {
      const a = look.arcs * (0.55 + tod.day * 0.35) * (1 - tod.night * 0.6) * clamp01(clear);
      if (a > 0.03) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a * (0.85 + 0.15 * Math.sin(t * 0.5));
        ctx.drawImage(skyArcs(Math.round(W * 0.66), 210), Math.round(W * 0.2), Math.round((sky.base ?? 0) - 250 + 0.2 * (scroll - ref)));
      }
    }
    ctx.globalAlpha = pa;
    ctx.globalCompositeOperation = po;
  }

  // Glossy leafy branches hanging into the top corners of the surface view.
  drawLeaves(ctx, env, s) {
    const b = this.b, view = env.view;
    if (!this.look.leaves || s === null || (view && view.y0 > s - 120)) return;
    if (!this.branches) {
      const br = leafBranch(2, 70, 2), bl = leafBranch(5, 50, 2, '#3cc84a');
      this.branches = [{ c: br.canvas, right: true, ph: 0 }, { c: flipCanvas(bl.canvas), right: false, ph: 2 }];
    }
    const top = b.top ?? -400, pv = 0.35 * ((env.scroll ?? 0) - (env.ref ?? 0)), tod = todWeights(env);
    ctx.globalAlpha = 1 - tod.night * 0.35;
    for (const L of this.branches) {
      const x = L.right ? b.W - L.c.width + 6 : -6;
      ctx.drawImage(L.c, x + Math.round(Math.sin(this.t * 0.7 + L.ph) * 1.5), Math.round(top + 52 + pv + Math.sin(this.t * 0.5 + L.ph)));
    }
    ctx.globalAlpha = 1;
  }

  update(dt, env) {
    const b = this.b, look = this.look;
    if (!b.W) return;
    if (b.W !== this.W || b.H !== this.H) this.seed();
    this.patchSky();
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const W = this.W, H = this.H;
    const s = this.surface(env);
    const top = s === null ? -40 : s + 2;
    const q = quality(env);
    // rising glass bubbles from the seabed and the water column
    this.emit -= dt * (look.bubbles || 0) * q;
    while (this.emit < 0) {
      this.emit += 0.32;
      if (this.bubbles.length >= 60) break;
      const x = Math.random() * W;
      let y = H + 4;
      try { y = Math.min(H - 20, b.floorAt(x, Math.random() * 0.6)) + 2; } catch { /* no floor */ }
      const big = Math.random();
      const n = big < 0.25 ? 3 + Math.floor(Math.random() * 4) : 1;
      for (let i = 0; i < n; i++) this.bubbles.push({ x: x + (Math.random() - 0.5) * 6, y: y - i * (4 + Math.random() * 6), r: big < 0.1 ? 4 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 3), vy: -(14 + Math.random() * 16), ph: Math.random() * TAU, wob: 1 + Math.random() * 2 });
    }
    let w = 0;
    for (const p of this.bubbles) {
      p.y += p.vy * dt;
      p.vy -= dt * 4;
      if (p.y <= top + p.r) {
        if (s !== null) this.sparks.push({ x: p.x, y: s + 1, t: 0, life: 0.5, n: 3, pop: true });
        continue;
      }
      this.bubbles[w++] = p;
    }
    this.bubbles.length = w;
    // twinkles: glints near the surface and stars in the water column
    this.sparkT -= dt * (look.sparkle || 0) * (0.6 + 0.4 * q);
    while (this.sparkT < 0) {
      this.sparkT += 0.16;
      if (this.sparks.length > 40) break;
      const nearTop = s !== null && Math.random() < 0.55;
      const y = nearTop ? s + 2 + Math.pow(Math.random(), 2) * 40 : (s ?? 0) + 20 + Math.random() * (H - (s ?? 0) - 40);
      this.sparks.push({ x: Math.random() * W, y, t: 0, life: 0.6 + Math.random() * 0.8, n: nearTop ? 2 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2) });
    }
    w = 0;
    for (const p of this.sparks) { p.t += dt; if (p.t < p.life) this.sparks[w++] = p; }
    this.sparks.length = w;
    for (const k of this.bokeh) {
      k.x += k.vx * dt; k.y += k.vy * dt;
      if (k.y < (s ?? 0) + 10) k.y = H + k.r;
      if (k.x < -k.r) k.x = W + k.r; else if (k.x > W + k.r) k.x = -k.r;
    }
  }

  // Luminous band under the surface + far bokeh (end of drawBack).
  drawBack(ctx, env) {
    const look = this.look;
    const s = this.surface(env);
    const tod = todWeights(env);
    const lightK = tod.day + tod.dusk * 0.6 + tod.night * 0.15;
    if (s !== null && look.bloom > 0) {
      const strip = bloomStrip(70, look.bloomColor || '#ffffff', 0.9);
      const a = look.bloom * lightK * (this.b.__water ? 0.22 : 1); // [phase5:water] softer: the live water sheet + rays carry the surface light
      if (a > 0.02) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        const pat = ctx.createPattern(strip, 'repeat-x');
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, 0, s + 1]));
        ctx.fillStyle = pat;
        ctx.fillRect(0, s + 1, this.b.W, 70);
        ctx.restore();
      }
    }
    this.drawBokeh(ctx, env, true);
    withSky(this.b, ctx, env, (e) => this.drawLeaves(ctx, e, s)); // far layer under the zoomed camera
  }

  drawBokeh(ctx, env, far) {
    const look = this.look;
    if (!look.bokeh || quality(env) < 0.75) return;
    const tod = todWeights(env);
    const base = (look.bokehA || 0.1) * (look.deep ? 0.7 + tod.night * 0.3 : 0.55 + tod.day * 0.45);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const k of this.bokeh) {
      if (k.far !== far) continue;
      const a = base * (0.6 + 0.4 * Math.sin(this.t * 0.7 + k.ph)) * (far ? 0.7 : 1);
      if (a < 0.01) continue;
      // [phase7:env] pixel twinkles instead of soft bokeh circles
      const spr = sparkleStar(Math.max(2, Math.round((far ? k.r * 0.35 : k.r * 0.5))), k.c);
      ctx.globalAlpha = Math.min(1, a * 3);
      ctx.drawImage(spr, Math.round(k.x - spr.width / 2), Math.round(k.y - spr.height / 2));
    }
    ctx.restore();
  }

  // Glass bubbles, sparkles, near bokeh and the lens flare (end of drawFront).
  drawFront(ctx, env) {
    const look = this.look, t = this.t;
    const tod = todWeights(env);
    for (const p of this.bubbles) {
      const spr = glassBubble(p.r, look.bubbleRim || '#c8fbff');
      ctx.drawImage(spr, Math.round(p.x + Math.sin(t * 2.6 + p.ph) * p.wob) - p.r - 1, Math.round(p.y) - p.r - 1);
    }
    if (this.sparks.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const sc = look.sparkleColor || '#ffffff';
      for (const p of this.sparks) {
        const k = Math.sin((p.t / p.life) * Math.PI);
        if (k < 0.05) continue;
        if (p.pop) {
          const rr = 1 + Math.round((p.t / p.life) * 4);
          ctx.globalAlpha = 0.7 * (1 - p.t / p.life);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(Math.round(p.x) - rr, Math.round(p.y), 1, 1); ctx.fillRect(Math.round(p.x) + rr, Math.round(p.y), 1, 1);
          ctx.fillRect(Math.round(p.x), Math.round(p.y) - Math.ceil(rr / 2), 1, 1);
          continue;
        }
        const spr = sparkleStar(Math.max(2, Math.round(p.n * (0.5 + 0.5 * k))), sc);
        ctx.globalAlpha = k * (0.55 + tod.night * 0.25);
        ctx.drawImage(spr, Math.round(p.x) - (spr.width >> 1), Math.round(p.y) - (spr.height >> 1));
      }
      ctx.restore();
    }
    this.drawBokeh(ctx, env, false);
    withSky(this.b, ctx, env, (e) => this.drawFlare(ctx, e, tod)); // the flare lives with the (far) sun
  }

  // Lens flare: starburst + streak at the sun, ghost rings and hexagons along the line through the view centre.
  drawFlare(ctx, env, tod) {
    const look = this.look, b = this.b;
    if (!look.flare) return;
    const s = this.surface(env);
    if (s === null || tod.night > 0.85) return;
    const view = env.view;
    if (view && view.y0 > s - 30) return;
    const B = skyBodies(env.hour ?? 12, b.W, b.top ?? -400, s);
    if (!B.sun.up) return;
    const pv = (b.sunPar ?? 0.28) * ((env.scroll ?? 0) - (env.ref ?? 0));
    const sx = B.sun.x, sy = B.sun.y + pv;
    const vx0 = view ? view.x0 : 0, vy0 = view ? view.y0 : 0, vx1 = view ? view.x1 : b.W, vy1 = view ? view.y1 : b.H;
    if (sy < vy0 - 30 || sy > s) return;
    const clear = b.wx?.clear ?? (b.cloud != null ? 1 - b.cloud : 1);
    const k = look.flare * (1 - tod.night) * clamp01(clear) * (tod.dusk > 0.5 ? 0.8 : 1);
    if (k < 0.03) return;
    const dusk = tod.dusk > 0.45;
    const cx = (vx0 + vx1) / 2, cy = (vy0 + vy1) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const st = flareStar(64, dusk ? '#ffd0a0' : '#fff8e0');
    ctx.globalAlpha = 0.6 * k * (0.9 + 0.1 * Math.sin(this.t * 1.7));
    ctx.drawImage(st, Math.round(sx - 64), Math.round(sy - 64));
    const sk = flareStreak(220, dusk ? '#ffc890' : '#bfeaff');
    ctx.globalAlpha = 0.5 * k;
    ctx.drawImage(sk, Math.round(sx - 220), Math.round(sy - 2));
    // [phase7:env] no ring / hex ghosts: a chain of pixel twinkle stars along the flare axis
    const ghosts = [
      [0.32, sparkleStar(5, '#a8ffe0'), 0.5], [0.52, sparkleStar(3, '#fff0b0'), 0.6], [0.74, sparkleStar(7, '#9ad8ff'), 0.45], [0.88, sparkleStar(4, '#c8ffb0'), 0.4],
      [1.0, sparkleStar(6, '#d0b0ff'), 0.4], [1.22, sparkleStar(3, '#ffffff'), 0.7], [1.45, sparkleStar(9, '#b8ffe8'), 0.35], [1.8, sparkleStar(5, '#9ae8ff'), 0.3],
    ];
    for (const [f, spr, a] of ghosts) {
      const x = sx + (cx - sx) * f, y = sy + (cy - sy) * f;
      ctx.globalAlpha = a * k;
      ctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
    }
    ctx.restore();
  }
}

// Water-shader gloss for a look (see watergl.js): sparkles, bloom, procedural caustics, the glassy band.
export function waterGloss(look, env) {
  const tod = todWeights(env || {});
  const lit = tod.day + tod.dusk * 0.6 + tod.night * 0.2;
  return {
    sparkle: (look.sparkle ?? 1) * (look.deep ? 0.45 : 0.6 + 0.4 * lit),
    bloom: look.deep ? 0.32 : 0.18 + (look.bloom ?? 0.3) * 0.5,
    pattern: look.pattern ?? (look.deep ? 0.12 : 0.55 * lit),
    gloss: look.deep ? 0.25 : 0.7 * lit,
    glossColor: look.sparkleColor || look.bloomColor || '#ffffff',
  };
}

// Wrap a biome's update / drawBack / drawFront with its glossy overlay (idempotent; biomes that manage their own
// overlay set `ownAero`).
export function installAero(biome) {
  if (!biome || biome.__aero || biome.ownAero) return biome?.aero || null;
  const look = AERO_LOOKS[biome.id];
  if (!look) return null;
  const ov = new AeroOverlay(biome, look);
  biome.__aero = true;
  biome.aero = ov;
  const up = biome.update.bind(biome), back = biome.drawBack.bind(biome), front = biome.drawFront.bind(biome);
  biome.update = (dt, env) => { up(dt, env); ov.update(dt, env); };
  biome.drawBack = (ctx, env) => { back(ctx, env); ov.drawBack(ctx, env); };
  biome.drawFront = (ctx, env) => { front(ctx, env); ov.drawFront(ctx, env); };
  // glossy water-shader defaults (the biome's own look wins)
  const wl = typeof biome.waterLook === 'function' ? biome.waterLook.bind(biome) : () => ({});
  biome.waterLook = (env) => ({ ...waterGloss(look, env), ...(wl(env) || {}) });
  return ov;
}

void hash2; void clamp;
