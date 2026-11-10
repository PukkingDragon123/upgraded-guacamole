// [phase9:ui] Hi-res hand-crafted pixel art for THE LAB's research tree (authored at 2x device pixels, see
// src/gfx/hires.js): ornate bevelled node tiles per branch (metal frame with an engraved groove, a gilded trim,
// corner beads, a branch-coloured crest gem in that branch's cut, a glass window per state), black fog-of-war
// silhouettes, faceted gems, lab glassware for the backdrop and the crisp Alagard "?".
//   nodeTile(S, look, branch) -> canvas (S + 2*pad logical, `.hi` twin, `.pad`)   look: open | done | brew | sil | deep | root
//   gemTex(r, color, cut) -> canvas (`.hi`)        cut: round | diamond | square | drop | heart | clover | oval | hex
//   glassware(kind, h, liquid) -> canvas (`.hi`, `.liq` = {x, y, w, h} liquid box in logical px)
//   qMark(S) -> canvas (`.hi`)                     the glowing "?" for silhouettes
//   GEM_CUT[branch]                                each branch's gem cut
import { PixelBuffer } from '../gfx/pixel.js';
import { mix, shade, hexToRgb } from '../core/color.js';
import { bayer, hash2 } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { HI, hiFromBuffer, withHi } from '../gfx/hires.js';
import { alagardReady, alagardBitmap } from '../gfx/alagard.js';
import { drawText } from '../gfx/font.js';
import { BRANCHES } from '../game/lab.js';

export const GEM_CUT = { rods: 'drop', reel: 'diamond', boats: 'square', oceans: 'round', aquarium: 'heart', luck: 'clover', bait: 'oval', crafting: 'hex' };

const rgb = new Map();
const C = (hex) => { let v = rgb.get(hex); if (!v) { v = hexToRgb(hex); rgb.set(hex, v); } return v; };
const P = (r, g, b, a = 255) => (((a & 255) << 24) | ((Math.max(0, Math.min(255, Math.round(b))) & 255) << 16) | ((Math.max(0, Math.min(255, Math.round(g))) & 255) << 8) | (Math.max(0, Math.min(255, Math.round(r))) & 255)) >>> 0;
const PH = (hex, a = 255) => { const [r, g, b] = C(hex); return P(r, g, b, a); };
function lerpHex(list, k) {
  k = Math.max(0, Math.min(list.length - 1.0001, k));
  const i = Math.floor(k), f = k - i, A = C(list[i]), B = C(list[i + 1]);
  return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
}
function over(b, x, y, r, g, bl, a) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h || a <= 0) return;
  const i = y * b.w + x, c = b.data[i], ca = (c >>> 24) / 255;
  if (ca <= 0) { b.data[i] = P(r, g, bl, a * 255); return; }
  const na = a + ca * (1 - a);
  const cr = c & 255, cg = (c >>> 8) & 255, cb = (c >>> 16) & 255;
  b.data[i] = P((r * a + cr * ca * (1 - a)) / na, (g * a + cg * ca * (1 - a)) / na, (bl * a + cb * ca * (1 - a)) / na, na * 255);
}
const cache = new Map();
function cached(key, build) {
  let c = cache.get(key);
  if (!c) { c = build(); cache.set(key, c); if (cache.size > 700) cache.delete(cache.keys().next().value); }
  return c;
}

// ------------------------------------------------------------------ gems
function gemShape(cut, u, v) {
  switch (cut) {
    case 'diamond': return Math.abs(u) * 0.95 + Math.abs(v) <= 1;
    case 'square': return Math.max(Math.abs(u), Math.abs(v)) <= 0.8;
    case 'drop': return (u * u + (v - 0.28) * (v - 0.28) <= 0.52) || (v < 0.28 && v > -1 && Math.abs(u) <= (v + 1) * 0.56);
    case 'heart': { const x = u * 1.15, y = -v * 1.15 + 0.15; const q = x * x + y * y - 1; return q * q * q - x * x * y * y * y <= 0; }
    case 'clover': return [[-0.42, 0], [0.42, 0], [0, -0.42], [0, 0.42]].some(([a, c]) => (u - a) ** 2 + (v - c) ** 2 <= 0.33);
    case 'oval': return (u / 0.72) ** 2 + v * v <= 1;
    case 'hex': return Math.max(Math.abs(u) * 0.866 + Math.abs(v) * 0.5, Math.abs(v)) <= 0.9;
    default: return u * u + v * v <= 1;
  }
}
// a faceted gem rasterised into buffer b (device px), centre (cx, cy), radius R
function gemInto(b, cx, cy, R, color, cut = 'round', dim = false) {
  const base = dim ? ['#05070c', '#0b1220', '#16243a', '#243a56', '#3c5a7c'] : [shade(color, -0.62), shade(color, -0.3), color, mix(color, '#ffffff', 0.45), mix(color, '#ffffff', 0.85)];
  const out = dim ? '#000000' : shade(color, -0.8);
  const ins = (x, y) => gemShape(cut, (x + 0.5 - cx) / R, (y + 0.5 - cy) / R);
  const x0 = Math.floor(cx - R - 2), x1 = Math.ceil(cx + R + 2), y0 = Math.floor(cy - R - 2), y1 = Math.ceil(cy + R + 2);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!ins(x, y)) {
      // 1 px outline around the gem
      if (ins(x - 1, y) || ins(x + 1, y) || ins(x, y - 1) || ins(x, y + 1)) { const [r, g, bl] = C(out); over(b, x, y, r, g, bl, 1); }
      continue;
    }
    const u = (x + 0.5 - cx) / R, v = (y + 0.5 - cy) / R;
    const rr = Math.hypot(u, v);
    let k;
    if (rr < 0.42) k = 3 - (u + v) * 0.9; // the table: bright
    else {
      // crown facets: 8 sectors, lit toward the top-left
      const a = Math.atan2(v, u), sec = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8);
      const na = ((sec + 0.5) / 8) * Math.PI * 2 - Math.PI;
      const lit = -(Math.cos(na) + Math.sin(na)) * 0.707;
      k = 2 + lit * 1.6 + (sec % 2 ? -0.25 : 0.2);
    }
    k += (bayer(x, y) - 0.5) * 0.5;
    const [r, g, bl] = lerpHex(base, k);
    over(b, x, y, r, g, bl, 1);
  }
  if (!dim) {
    // glints: a hard white pixel pair top-left and a tiny sparkle
    const gx = Math.round(cx - R * 0.38), gy = Math.round(cy - R * 0.42);
    over(b, gx, gy, 255, 255, 255, 1); over(b, gx + 1, gy, 255, 255, 255, 0.8); over(b, gx, gy + 1, 255, 255, 255, 0.8);
    if (R >= 5) over(b, Math.round(cx + R * 0.35), Math.round(cy + R * 0.3), 255, 255, 255, 0.55);
  } else {
    over(b, Math.round(cx - R * 0.38), Math.round(cy - R * 0.42), 90, 130, 170, 0.6);
  }
}

export function gemTex(r, color, cut = 'round', dim = false) {
  return cached(`gem|${r}|${color}|${cut}|${dim}`, () => {
    const L = Math.ceil(r * 2 + 3), D = L * HI;
    const b = new PixelBuffer(D, D);
    gemInto(b, D / 2, D / 2, r * HI, color, cut, dim);
    return hiFromBuffer(b);
  });
}

// ------------------------------------------------------------------ node tiles
function inRR(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
  const cx = x < x0 + r ? x0 + r : x >= x0 + w - r ? x0 + w - r : null;
  const cy = y < y0 + r ? y0 + r : y >= y0 + h - r ? y0 + h - r : null;
  if (cx === null || cy === null) return true;
  const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
  return dx * dx + dy * dy <= r * r;
}

function frameRamp(look, col) {
  if (look === 'sil' || look === 'deep') return ['#010204', '#050a14', '#0b1424', '#152238', '#24395a'];
  if (look === 'root') return ['#6a3c08', '#b8741a', '#f2b23a', '#ffe08a', '#fffbe0'];
  if (look === 'done') return [shade(col, -0.62), shade(col, -0.32), shade(col, 0.02), mix(col, '#ffffff', 0.42), mix(col, '#ffffff', 0.82)];
  return [shade(col, -0.58), shade(col, -0.24), mix(col, '#ffffff', 0.12), mix(col, '#ffffff', 0.55), '#ffffff'];
}
function windowRamp(look, col) {
  switch (look) {
    case 'done': return [mix(col, '#ffffff', 0.72), mix(col, '#ffffff', 0.42), mix(col, '#ffffff', 0.12), shade(col, -0.12)];
    case 'brew': return ['#f4ffff', '#d2f8ff', '#9ae4f8', '#5ac4ea'];
    case 'root': return ['#e8ffd0', '#a8ec6a', '#5cc83a', '#2e9a26'];
    case 'sil': return ['#0f1a2b', '#0a1220', '#060b15', '#03060c'];
    case 'deep': return ['#070d17', '#050910', '#03060b', '#020407'];
    default: return ['#ffffff', mix(col, '#ffffff', 0.9), mix(col, '#eaf8ff', 0.74), mix(col, '#cfeeff', 0.56)];
  }
}

// S = logical tile size (even). The canvas is S + 2 * pad so the crest gem can overhang the top.
export function nodeTile(S, look, branch) {
  return cached(`tile|${S}|${look}|${branch || ''}`, () => {
    const col = look === 'root' ? '#46c23a' : BRANCHES[branch]?.color || '#35c8ff';
    const cut = look === 'root' ? 'round' : GEM_CUT[branch] || 'round';
    const pad = Math.max(2, Math.round(S * 0.1));
    const L = S + pad * 2, D = L * HI, T = S * HI, o = pad * HI;
    const b = new PixelBuffer(D, D);
    const dark = look === 'sil' || look === 'deep';
    const rc = Math.max(5, Math.round(T * (look === 'root' ? 0.3 : 0.24)));
    const f = Math.max(5, Math.round(T * (look === 'root' ? 0.15 : 0.135)));
    const trim = Math.max(2, Math.round(T * 0.03));
    const iw = T - f * 2, ri = Math.max(3, rc - f + 2);
    const FR = frameRamp(look, col), WR = windowRamp(look, col);
    const outC = dark ? '#000000' : look === 'root' ? '#3a1e04' : shade(col, -0.78);
    const gold = dark ? ['#0a1220', '#16243a', '#2a4262'] : look === 'done' || look === 'root' ? ['#8a5208', '#f2b83a', '#fff4b8'] : ['#5a7088', '#c8dcec', '#ffffff'];
    const inner = (x, y) => inRR(x, y, o + f, o + f, iw, iw, ri);
    const innerT = (x, y) => inRR(x, y, o + f - trim, o + f - trim, iw + trim * 2, iw + trim * 2, ri + trim);
    const tile = (x, y) => inRR(x, y, o, o, T, T, rc);
    for (let y = o; y < o + T; y++) for (let x = o; x < o + T; x++) {
      if (!tile(x, y)) continue;
      const i = y * D + x;
      if (!tile(x - 1, y) || !tile(x + 1, y) || !tile(x, y - 1) || !tile(x, y + 1)) { b.data[i] = PH(outC); continue; }
      if (inner(x, y)) {
        // ---- the glass window
        const k = (y - o - f) / Math.max(1, iw - 1);
        let wk = k * 3 + (bayer(x, y) - 0.5) * 0.55;
        let [r, g, bl] = lerpHex(WR, wk);
        // inner shadow under the frame (top / left), a lit lip at the bottom / right
        const e1 = !inner(x, y - 1) || !inner(x - 1, y), e2 = !inner(x, y - 2) || !inner(x - 2, y);
        const l1 = !inner(x, y + 1) || !inner(x + 1, y);
        if (e1) { [r, g, bl] = dark ? [0, 0, 2] : C(shade(WR[2], -0.38)); }
        else if (e2) { r *= 0.86; g *= 0.88; bl *= 0.92; }
        else if (l1 && !dark) { r += (255 - r) * 0.6; g += (255 - g) * 0.6; bl += (255 - bl) * 0.6; }
        // reflected glow along the bottom of the glass
        if (!dark && k > 0.7) { const q = (k - 0.7) / 0.3; const gg = Math.floor(q * 3 + bayer(x + 1, y) * 0.99) / 3 * 0.35; r += (255 - r) * gg; g += (255 - g) * gg; bl += (255 - bl) * gg; }
        b.data[i] = P(r, g, bl);
        continue;
      }
      if (innerT(x, y)) {
        // ---- gilded trim between the frame and the glass (lit top-left, shaded bottom-right)
        const nx = x + 0.5 - (o + T / 2), ny = y + 0.5 - (o + T / 2);
        const lit = -(nx + ny) / (T * 0.7);
        const outerPx = !innerT(x - 1, y) || !innerT(x + 1, y) || !innerT(x, y - 1) || !innerT(x, y + 1);
        const [r, g, bl] = C(outerPx ? gold[lit > 0 ? 2 : 1] : gold[lit > 0.15 ? 1 : 0]);
        b.data[i] = P(r, g, bl);
        continue;
      }
      // ---- the bevelled metal frame: normal from the frame's centre line, outer bevel lit top-left,
      // inner bevel lit bottom-right, an engraved groove in the middle, brushed-metal noise
      // rounded-rect SDF: inward distance from the outer edge and the outward normal
      const c0 = o + T / 2, hx = Math.abs(x + 0.5 - c0) - (T / 2 - rc), hy = Math.abs(y + 0.5 - c0) - (T / 2 - rc);
      const sx = Math.sign(x + 0.5 - c0) || 1, sy = Math.sign(y + 0.5 - c0) || 1;
      let nx, ny, dIn;
      if (hx > 0 && hy > 0) { const l = Math.hypot(hx, hy); nx = (hx / l) * sx; ny = (hy / l) * sy; dIn = rc - l; }
      else if (hx > hy) { nx = sx; ny = 0; dIn = rc - hx; }
      else { nx = 0; ny = sy; dIn = rc - hy; }
      const p = Math.max(0, Math.min(1, dIn / Math.max(1, f - trim)));
      const ndl = -(nx + ny) * 0.707;
      let k = p < 0.46 ? 2 + ndl * 1.7 : 2 - ndl * 1.25;
      const groove = Math.abs(p - 0.5) < 0.09;
      if (groove) k = 0.7 + (ndl > 0 ? 0 : 0.5);
      else if (p > 0.5 && p < 0.66) k += 0.45;
      k += (hash2(x >> 1, y, 7) - 0.5) * 0.35 + (bayer(x, y) - 0.5) * 0.45;
      const [r, g, bl] = lerpHex(FR, k);
      b.data[i] = P(r, g, bl);
    }
    // gloss cap on the glass: a soft-edged arc with a hard lower edge, plus a glint
    if (look !== 'deep') {
      const gx = o + T / 2, gy = o + f + iw * 0.06, rx = iw * 0.44, ry = iw * 0.3;
      for (let y = o + f; y < o + f + iw * 0.4; y++) for (let x = o + f; x < o + f + iw; x++) {
        if (!inner(x, y) || !inner(x, y - 2) || !inner(x - 2, y) || !inner(x + 2, y)) continue;
        const ex = (x + 0.5 - gx) / rx, ey = (y + 0.5 - gy) / ry;
        const e = ex * ex + ey * ey;
        if (e > 1 || y < gy - ry * 0.2) continue;
        const a = dark ? 0.07 : (e < 0.55 ? 0.5 : 0.3) * (bayer(x, y) < 0.85 ? 1 : 0.4);
        over(b, x, y, 255, 255, 255, a);
      }
      const sx = o + f + 3, sy = o + f + 3;
      if (!dark) for (const [dx, dy, a] of [[0, 0, 1], [1, 0, 1], [2, 0, 0.8], [3, 0, 0.5], [0, 1, 1], [0, 2, 0.8], [0, 3, 0.5], [1, 1, 0.7]]) over(b, sx + dx, sy + dy, 255, 255, 255, a);
    }
    if (dark) {
      // the faint cold rim light along the top-left so the black shape reads in the dark
      for (let x = o + rc; x < o + T - rc; x++) over(b, x, o + 1, 70, 110, 150, look === 'deep' ? 0.35 : 0.8);
      for (let y = o + rc; y < o + T - rc; y++) over(b, o + 1, y, 50, 86, 124, look === 'deep' ? 0.3 : 0.7);
    }
    // corner beads (rivets) on the frame
    const bead = Math.max(1.6, f * 0.26);
    for (const [ux, uy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const bx = ux ? o + T - f * 0.62 - 1 : o + f * 0.62, by = uy ? o + T - f * 0.62 - 1 : o + f * 0.62;
      const BR = dark ? ['#020408', '#0c1626', '#1e3048'] : look === 'done' || look === 'root' ? ['#7a4806', '#f2c14a', '#fffbe0'] : ['#3c5068', '#dceaf6', '#ffffff'];
      for (let y = Math.floor(by - bead - 1); y <= by + bead + 1; y++) for (let x = Math.floor(bx - bead - 1); x <= bx + bead + 1; x++) {
        const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by);
        if (d > bead + 0.6) continue;
        const lit = -((x + 0.5 - bx) + (y + 0.5 - by)) / (bead * 1.4);
        const c = d > bead - 0.4 ? BR[0] : lit > 0.25 ? BR[2] : BR[1];
        const [r, g, bl] = C(c);
        over(b, x, y, r, g, bl, 1);
      }
    }
    // the crest gem (branch cut) sitting on the top edge, mounted in a little claw setting
    const gr = Math.max(3, Math.round(f * (look === 'root' ? 0.95 : 0.78)));
    const gcx = o + T / 2, gcy = o + f * 0.42;
    {
      const SR = dark ? ['#000000', '#0b1424', '#1e3048'] : look === 'done' || look === 'root' ? ['#5a3404', '#e8a82a', '#fff0a8'] : ['#2a3c52', '#b8ccdc', '#ffffff'];
      const mr = gr + Math.max(2, Math.round(f * 0.22));
      for (let y = Math.floor(gcy - mr - 1); y <= gcy + mr + 1; y++) for (let x = Math.floor(gcx - mr - 1); x <= gcx + mr + 1; x++) {
        const d = Math.hypot((x + 0.5 - gcx) * 0.92, y + 0.5 - gcy);
        if (d > mr) continue;
        const lit = -((x + 0.5 - gcx) + (y + 0.5 - gcy)) / (mr * 1.4);
        const c = d > mr - 1.2 ? SR[0] : lit > 0.1 ? SR[2] : SR[1];
        const [r, g, bl] = C(c);
        over(b, x, y, r, g, bl, 1);
      }
    }
    gemInto(b, gcx, gcy, gr, look === 'root' ? '#ffd23a' : col, cut, dark);
    return withPad(hiFromBuffer(b), pad);
  });
}
function withPad(c, pad) { c.pad = pad; return c; }

// ------------------------------------------------------------------ the "?" (Alagard at device resolution)
export function qMark(S) {
  return cached('q|' + S, () => {
    const size = S >= 64 ? 32 : 16;
    if (alagardReady()) {
      const lo = alagardBitmap('?', { size, color: '#8fc4f0' });
      const hiSrc = alagardBitmap('?', { size: size * 2, color: '#8fc4f0' });
      const shadeHi = alagardBitmap('?', { size: size * 2, color: '#1c3a5c' });
      // the hi twin: a cool outline + a lighter top half (glass-lit) at native device pixels
      const W = lo.width * HI, H = lo.height * HI;
      const hc = makeCanvas(W, H), g = ctxOf(hc);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2]]) g.drawImage(shadeHi, dx, dy);
      g.drawImage(hiSrc, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(230,248,255,0.75)'; g.fillRect(0, 0, W, Math.round(H * 0.42));
      g.globalCompositeOperation = 'source-over';
      const c = makeCanvas(lo.width, lo.height); ctxOf(c).drawImage(lo, 0, 0);
      Object.defineProperty(c, 'hi', { value: hc, configurable: true });
      return c;
    }
    const c = makeCanvas(12, 14);
    drawText(ctxOf(c), '?', 1, 1, { font: 'big', color: '#8fc4f0' });
    return c;
  });
}

// ------------------------------------------------------------------ backdrop glassware
// Profiles: half-width (0..1 of the max) along the height (v = 0 top .. 1 bottom); neck = the narrow top part
const VESSELS = {
  erlen: { w: 0.62, prof: (v) => (v < 0.3 ? 0.22 : 0.22 + (v - 0.3) / 0.7 * 0.78), liq: 0.5, lip: true },
  round: { w: 0.8, prof: (v) => (v < 0.36 ? 0.16 : Math.sqrt(Math.max(0, 1 - ((v - 0.68) / 0.32) ** 2))), liq: 0.62, lip: true },
  beaker: { w: 0.55, prof: () => 1, liq: 0.45, lip: true, marks: true },
  tube: { w: 0.16, prof: (v) => (v > 0.92 ? Math.sqrt(Math.max(0, 1 - ((v - 0.92) / 0.08) ** 2)) : 1), liq: 0.55, lip: true },
  bottle: { w: 0.5, prof: (v) => (v < 0.22 ? 0.3 : v < 0.32 ? 0.3 + (v - 0.22) * 7 : 1), liq: 0.4, lip: true },
};
export function glassware(kind, h, liquid = '#5fe08a') {
  return cached(`glass|${kind}|${h}|${liquid}`, () => {
    const V = VESSELS[kind] || VESSELS.erlen;
    const w = Math.max(6, Math.round(h * V.w)), L = { w: w + 4, h: h + 4 };
    const W = L.w * HI, H = L.h * HI, hw = (w * HI) / 2, cx = W / 2, top = 2 * HI, bot = H - 2 * HI;
    const b = new PixelBuffer(W, H);
    const half = (y) => { const v = (y - top) / (bot - top); return v < 0 || v > 1 ? -1 : V.prof(v) * hw; };
    const liqY = top + (bot - top) * V.liq;
    const LQ = [mix(liquid, '#ffffff', 0.55), liquid, shade(liquid, -0.25), shade(liquid, -0.5)];
    for (let y = top; y < bot; y++) {
      const hh = half(y);
      if (hh <= 0) continue;
      for (let x = Math.floor(cx - hh); x < Math.ceil(cx + hh); x++) {
        const u = (x + 0.5 - cx) / hh;
        const edge = Math.abs(u) > 1 - 2.2 / hh || half(y - 1) < Math.abs(x + 0.5 - cx) || half(y + 1) < Math.abs(x + 0.5 - cx) - 0.5;
        if (edge) { over(b, x, y, 220, 248, 255, 0.85); continue; }
        if (y >= liqY) {
          const k = (y - liqY) / Math.max(1, bot - liqY) * 2.4 + (Math.abs(u) * 0.8) + (bayer(x, y) - 0.5) * 0.5;
          const [r, g, bl] = lerpHex(LQ, 0.6 + k);
          over(b, x, y, r, g, bl, 0.82);
          if (Math.abs(y - liqY) < 1) over(b, x, y, 255, 255, 255, 0.7);
          else if (Math.abs(y - liqY - 1.5) < 1) over(b, x, y, 255, 255, 255, 0.25);
        } else over(b, x, y, 200, 240, 255, 0.12);
        // a vertical specular strip on the left and a thin reflection on the right
        if (u > -0.72 && u < -0.5) over(b, x, y, 255, 255, 255, 0.45);
        else if (u > 0.62 && u < 0.7) over(b, x, y, 255, 255, 255, 0.22);
      }
    }
    if (V.lip) for (let x = Math.floor(cx - half(top + 1) - 3); x < cx + half(top + 1) + 3; x++) for (let y = top - 2; y < top + 2; y++) over(b, x, y, 235, 252, 255, y < top ? 0.95 : 0.6);
    if (V.marks) for (let i = 1; i < 6; i++) { const y = Math.round(top + (bot - top) * (i / 6)); for (let x = Math.round(cx - hw + 4); x < cx - hw + (i % 2 ? 14 : 9); x++) over(b, x, y, 255, 255, 255, 0.7); }
    const c = hiFromBuffer(b);
    c.liq = { x: (cx - hw * 0.8) / HI, y: liqY / HI, w: (hw * 1.6) / HI, h: (bot - liqY) / HI, cx: cx / HI, top: top / HI };
    return c;
  });
}

// A small hi pixel bubble (crisp ring + glint) for pipes and flasks: r in logical px (0.5 steps)
export function microBubble(r) {
  return cached('mb|' + r, () => {
    const L = Math.ceil(r * 2 + 2), D = L * HI, R = r * HI, cx = D / 2;
    const b = new PixelBuffer(D, D);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cx);
      if (d > R) continue;
      const lit = -((x + 0.5 - cx) + (y + 0.5 - cx)) / (R * 1.4);
      if (d > R - 1.1) over(b, x, y, 255, 255, 255, lit > -0.2 ? 0.95 : 0.6);
      else over(b, x, y, 220, 250, 255, 0.18);
    }
    const g = Math.round(cx - R * 0.42);
    over(b, g, g, 255, 255, 255, 1); over(b, g + 1, g, 255, 255, 255, 0.7);
    return hiFromBuffer(b);
  });
}

void withHi;
