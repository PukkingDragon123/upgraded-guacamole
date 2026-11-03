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

import { VoxelModel } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { clamp, clamp01, lerp, smoothstep, bayer, hash2, TAU } from '../core/math.js';
import { hexToRgb, packRGB, mix, shade, hslToRgb } from '../core/color.js';
import { renderModel } from './voxkit.js';
import { paint, todWeights, quality } from './scenery.js';
import { skyBodies } from './sky.js';

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
    const r = renderModel(m, { scale, outline: true, jitter: 0.04, ao: 0.8, edges: 0.4, light: { top: 5, lit: 4, dark: 2.6, bottom: 1.6 } });
    const hub = r.project(cx - 0.5, h + 1.6, cz + 7.4);
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
export function swayAnim(key, dims, build, o = {}) {
  const frames = o.frames ?? 8, scale = o.scale ?? 1;
  return memo('sway|' + key + '|' + frames + '|' + scale, () => {
    const out = [], nights = [];
    for (let f = 0; f < frames; f++) {
      const m = new VoxelModel(dims[0], dims[1], dims[2]);
      const glowIds = build(m, [dims[0] / 2, 0, dims[2] / 2], (f / frames) * TAU, new RNG(o.seed ?? 1)) || null;
      const r = renderModel(m, { scale, outline: true, jitter: 0.05, ao: 1, edges: 0.7, light: { top: 5, lit: 3.8, dark: 2.3, bottom: 1.2 }, ...(o.render || {}) });
      const p = r.project(dims[0] / 2, 0, dims[2] / 2);
      out.push({ canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) });
      nights.push(glowIds ? idGlow(r, glowIds) : null);
    }
    const minX = Math.min(...out.map((q) => -q.ox)), minY = Math.min(...out.map((q) => -q.oy));
    const maxX = Math.max(...out.map((q) => q.canvas.width - q.ox)), maxY = Math.max(...out.map((q) => q.canvas.height - q.oy));
    const W = maxX - minX, Hh = maxY - minY;
    const box = (src, q) => { if (!src) return null; const c = makeCanvas(W, Hh); ctxOf(c).drawImage(src, -minX - q.ox, -minY - q.oy); return c; };
    return { frames: out.map((q) => box(q.canvas, q)), nights: out.map((q, i) => box(nights[i], q)), ox: -minX, oy: -minY, n: frames, P: o.period ?? 3.2 };
  });
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

// ------------------------------------------------------------------ the glossy layer for every ocean

// look: {bloom, bloomColor, bubbles, bubbleRim, sparkle, sparkleColor, bokeh: [colors], bokehA, flare, deepGlow}
export const AERO_LOOKS = {
  shallows: { bloom: 0.42, bloomColor: '#e8fffc', bubbles: 1, bubbleRim: '#c8fbff', sparkle: 1, bokeh: ['#ffffff', '#c8f6ff', '#e0ffd8'], bokehA: 0.1, flare: 1 },
  fjord: { bloom: 0.4, bloomColor: '#f0fdff', bubbles: 0.7, bubbleRim: '#dff8ff', sparkle: 1.3, sparkleColor: '#e8fbff', bokeh: ['#ffffff', '#c8ecff'], bokehA: 0.1, flare: 0.95 },
  junkyard: { bloom: 0.3, bloomColor: '#d8ffe8', bubbles: 0.9, bubbleRim: '#c8ffe4', sparkle: 0.6, sparkleColor: '#d8ffe8', bokeh: ['#b8ffd8', '#8affd0', '#e8ffd0'], bokehA: 0.09, flare: 0.7 },
  metropolis: { bloom: 0.22, bloomColor: '#c8d8ff', bubbles: 0.7, bubbleRim: '#c8e0ff', sparkle: 0.7, sparkleColor: '#e8e0ff', bokeh: ['#ff7ae8', '#7ae8ff', '#b48aff', '#ffd27a'], bokehA: 0.14, flare: 0.6, deep: true },
  volcano: { bloom: 0.18, bloomColor: '#ffd8b8', bubbles: 1, bubbleRim: '#ffe0c8', sparkle: 0.6, sparkleColor: '#ffd890', bokeh: ['#ffb070', '#ff8a4a', '#ffe08a'], bokehA: 0.12, flare: 0.5, deep: true },
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

  update(dt, env) {
    const b = this.b, look = this.look;
    if (!b.W) return;
    if (b.W !== this.W || b.H !== this.H) this.seed();
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
      const a = look.bloom * lightK;
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
      const spr = bokehDisc(far ? Math.round(k.r * 0.6) : k.r, k.c);
      ctx.globalAlpha = a;
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
    this.drawFlare(ctx, env, tod);
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
    const pv = 0.28 * ((env.scroll ?? 0) - (env.ref ?? 0));
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
    const st = flareStar(46, dusk ? '#ffd0a0' : '#fff8e0');
    ctx.globalAlpha = 0.55 * k * (0.9 + 0.1 * Math.sin(this.t * 1.7));
    ctx.drawImage(st, Math.round(sx - 46), Math.round(sy - 46));
    const sk = flareStreak(150, dusk ? '#ffc890' : '#bfeaff');
    ctx.globalAlpha = 0.45 * k;
    ctx.drawImage(sk, Math.round(sx - 150), Math.round(sy - 2));
    const ghosts = [
      [0.32, flareHex(9, '#a8ffe0'), 0.35], [0.52, flareDisc(5, '#fff0b0'), 0.5], [0.74, flareRing(16, '#9ad8ff'), 0.45],
      [1.0, flareHex(13, '#d0b0ff'), 0.28], [1.22, flareDisc(3, '#ffffff'), 0.6], [1.45, flareRing(26, '#b8ffe8'), 0.32], [1.8, flareHex(19, '#9ae8ff'), 0.2],
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
