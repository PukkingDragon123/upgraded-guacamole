// Color helpers tuned for pixel art: hue-shifted ramps, mixing, packing.

import { clamp, clamp01 } from './math.js';

const rgbCache = new Map();

export function hexToRgb(hex) {
  let c = rgbCache.get(hex);
  if (c) return c;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, c);
  return c;
}

const toHex2 = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
export const rgbToHex = (r, g, b) => '#' + toHex2(r) + toHex2(g) + toHex2(b);

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const hexToHsl = (hex) => rgbToHsl(...hexToRgb(hex));
export const hslToHex = (h, s, l) => rgbToHex(...hslToRgb(h, clamp01(s), clamp01(l)));

export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

// Move hue h toward target by up to `amount` degrees (shortest way).
function hueToward(h, target, amount) {
  let d = ((target - h + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), amount);
  return h + step;
}

// Pixel-art shading: darker shades drift toward blue/purple, lighter toward warm yellow.
export function shade(hex, amount) {
  const [h, s, l] = hexToHsl(hex);
  if (amount < 0) {
    const a = -amount;
    return hslToHex(hueToward(h, 250, 28 * a), clamp01(s + 0.08 * a), clamp01(l * (1 - 0.75 * a)));
  }
  const a = amount;
  return hslToHex(hueToward(h, 55, 22 * a), clamp01(s - 0.1 * a), clamp01(l + (1 - l) * 0.65 * a));
}

// 5-step ramp: [deep shadow, shadow, base, light, highlight]
export function ramp(hex, contrast = 1) {
  return [shade(hex, -0.62 * contrast), shade(hex, -0.3 * contrast), hex, shade(hex, 0.32 * contrast), shade(hex, 0.62 * contrast)];
}

export function adjust(hex, { h = 0, s = 0, l = 0, sMul = 1, lMul = 1 } = {}) {
  const [H, S, L] = hexToHsl(hex);
  return hslToHex(H + h, clamp01(S * sMul + s), clamp01(L * lMul + l));
}

export function invert(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(255 - r, 255 - g, 255 - b);
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const rgbaCache = new Map();
export function rgba(hex, a = 1) {
  const key = hex + '|' + a.toFixed(3);
  let s = rgbaCache.get(key);
  if (!s) {
    const [r, g, b] = hexToRgb(hex);
    s = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    if (rgbaCache.size > 4000) rgbaCache.clear();
    rgbaCache.set(key, s);
  }
  return s;
}

// Pack to the Uint32 layout used by ImageData on little-endian machines (ABGR).
export function pack(hex, a = 255) {
  const [r, g, b] = hexToRgb(hex);
  return ((a & 255) << 24) | (b << 16) | (g << 8) | r;
}

export function packRGB(r, g, b, a = 255) {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function unpack(c) {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255];
}

export function mixPacked(c1, c2, t) {
  const a = unpack(c1), b = unpack(c2);
  return packRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
}

export const RARITY = {
  common: { name: 'Common', color: '#c9d4dc', dark: '#5d6b78', stars: 1, weight: 60 },
  uncommon: { name: 'Uncommon', color: '#7ee07a', dark: '#2f7a3c', stars: 2, weight: 26 },
  rare: { name: 'Rare', color: '#5fb8ff', dark: '#2a5aa8', stars: 3, weight: 10 },
  epic: { name: 'Epic', color: '#d27bff', dark: '#6a2fa0', stars: 4, weight: 3.2 },
  legendary: { name: 'Legendary', color: '#ffd04a', dark: '#a86a12', stars: 5, weight: 0.8 },
};
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
