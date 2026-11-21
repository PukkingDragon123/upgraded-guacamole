// [simple24] The fight HUD: ONE centred meter, the catch bar under it and the big SHOCK button, in voxel pixel art.
//   meter    a chunky voxel-block track: coral on the left (the fish runs), aqua, the glowing green sweet ZONE in the
//            middle, orange on the right (too tight). The MARKER is the hooked fish itself (its voxel icon) riding a
//            white pin. Centred: the zone glows and sparkles, a tick plays. Outside: a big glossy arrow says SPIN! or
//            EASY! Lunges: chevrons flash on the side the fish will shove. Shield (bosses): steel-blue locked zone.
//   beat     when a shock is ready the zone flashes gold, a GOLD notch appears at the very centre and a voxel spark
//            sweeps across the track: press as it crosses the notch. 3D voxel words (NOW!, CRITICAL!) only.
//   bar      the catch bar under the meter (lime voxel blocks, a bead at the head, red ghost of lost progress).
//   button   the big round voxel SHOCK button left of the meter: a dome that fills with gold as it recharges,
//            the 3D bolt, charge pips, the weapon level (MK I..V), the Space key.
// No rings, no light rays: glows are soft sprites, effects are pixel particles.
//
//   meterLayout(F) -> {S, cx, cy, w, h, x0, x1, by, bh, btn: {cx, cy, r}}
//   drawMeter(ctx, F, B)          meterRect(F, kind)  kind: 'meter' | 'bar' | 'shock' | 'all'
//   hitShockButton(F, x, y) -> bool

import { TAU, clamp, clamp01, lerp, ease } from '../core/math.js';
import { rgba } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { glowSprite } from '../gfx/particles.js';
import { voxelFishIcon } from '../fish/fishicon.js';
import { word3D } from './cinematics.js';
import { drawIcon3d } from './icons3d.js';

const INK = '#0c3a52';
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixRgb = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const shadeRgb = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

const ART = new Map();
function art(key, make) {
  let c = ART.get(key);
  if (!c) { if (ART.size > 120) ART.clear(); c = make(); ART.set(key, c); }
  return c;
}
function paint(w, h, fn) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  const img = g.createImageData(w, h), d = img.data;
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
  const S = H / 540;
  const gl = F.gear?.layout?.(W, H);
  const gearLeft = gl ? gl.cx - gl.R - Math.round(14 * S) : W;
  const r = Math.round(35 * S);
  let w = Math.round(Math.min(W * 0.46, 600 * S));
  const cx = Math.round(W / 2);
  // keep clear of the gear on the right and the button on the left
  const maxHalf = Math.min(gearLeft - cx - Math.round(10 * S), cx - r * 2 - Math.round(64 * S));
  w = Math.min(w, Math.round(maxHalf * 2));
  const h = Math.round(30 * S);
  const cy = Math.round(H - 76 * S);
  const x0 = cx - Math.round(w / 2), x1 = x0 + w;
  const by = cy + Math.round(h / 2 + 9 * S), bh = Math.round(12 * S);
  LAY = { W, H, S, cx, cy, w, h, x0, x1, by, bh, btn: { cx: x0 - r - Math.round(20 * S), cy: Math.round(cy + 2 * S), r } };
  return LAY;
}

export function meterRect(F, kind = 'meter') {
  const L = meterLayout(F), S = L.S;
  if (kind === 'shock') { const b = L.btn, m = Math.round(8 * S), sx = Math.round(40 * S); return { x: b.cx - b.r - m - sx, y: b.cy - b.r - m - Math.round(10 * S), w: (b.r + m) * 2 + sx, h: (b.r + m) * 2 + Math.round(20 * S) }; }
  if (kind === 'bar') return { x: L.x0 - 4, y: L.by - 4, w: L.w + 8, h: L.bh + 8 };
  const top = L.cy - L.h / 2 - Math.round(44 * S);
  if (kind === 'all') { const b = L.btn; return { x: b.cx - b.r - 8, y: top, w: L.x1 - (b.cx - b.r - 8) + 8, h: L.by + L.bh + 8 - top }; }
  return { x: L.x0 - 6, y: top, w: L.w + 12, h: L.cy + L.h / 2 + 6 - top };
}

export function hitShockButton(F, x, y) {
  const b = meterLayout(F).btn;
  return Math.hypot(x - b.cx, y - b.cy) <= b.r + 6;
}

// meter units (-1..1) -> screen x
const mx = (L, u) => L.cx + clamp(u, -1.15, 1.15) * (L.w / 2 - L.h * 0.35);

// ------------------------------------------------------------------ voxel slabs
// A chunky voxel-block slab: block size b, colours from colAt(u, v) (0..1 across / down), each block bevelled (lit
// top-left, shaded bottom-right), stepped corners, a 2 px ink outline.
function slab(w, h, b, colAt, o = {}) {
  const cr = o.corner ?? Math.max(1, Math.round(h / b / 2.6));
  const nbx = Math.ceil(w / b), nby = Math.ceil(h / b);
  return paint(w + 4, h + 4, (px, py) => {
    const x = px - 2, y = py - 2;
    const bx = Math.floor(x / b), byy = Math.floor(y / b);
    // stepped corners in block units
    const inside = (X, Y) => {
      if (X < 0 || Y < 0 || X >= w || Y >= h) return false;
      const qx = Math.floor(X / b), qy = Math.floor(Y / b);
      const ex = Math.min(qx, nbx - 1 - qx), ey = Math.min(qy, nby - 1 - qy);
      return !(ex < cr && ey < cr && (cr - ex) + (cr - ey) > cr + 1);
    };
    if (!inside(x, y)) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 3 && inside(x + dx, y + dy)) return [12, 58, 82, 255];
      return null;
    }
    const u = (bx + 0.5) / nbx, v = (byy + 0.5) / nby;
    let c = colAt(u, v, bx, byy);
    if (!c) return null;
    const ix = x - bx * b, iy = y - byy * b;
    if (iy === 0 || ix === 0) c = shadeRgb(c, iy === 0 ? 0.32 : 0.16);
    else if (iy === b - 1 || ix === b - 1) c = shadeRgb(c, -0.2);
    return [c[0], c[1], c[2], o.alpha ?? 255];
  });
}

const C = {
  coral: hex('#ff6a5a'), coralD: hex('#c8303a'), aqua: hex('#3cc8f4'), aquaD: hex('#1270c0'), navy: hex('#0d3a5c'),
  orange: hex('#ff9d2e'), orangeD: hex('#d8601a'), green: hex('#5ad84a'), greenL: hex('#b8ff8a'), greenD: hex('#2a9a24'),
  steel: hex('#8fb8d8'), steelD: hex('#4a7aa8'), gold: hex('#ffd23a'), goldL: hex('#fff6a0'), goldD: hex('#d88a0a'),
  lime: hex('#a6ec5a'), limeD: hex('#3fae2a'), grey: hex('#8a9aac'), greyD: hex('#56687a'), white: hex('#ffffff'),
};

// The meter track for a zone half-width (quantised), plain or shielded.
function trackSprite(L, zoneW, kind) {
  const b = Math.max(2, Math.round(3 * L.S));
  const zq = Math.round(zoneW * 50) / 50;
  return art(`trk|${L.w}|${L.h}|${zq}|${kind}`, () => {
    const half = L.w / 2 - L.h * 0.35;
    return slab(L.w, L.h, b, (u, v) => {
      const m = ((u * L.w) - L.w / 2) / half; // meter units
      const a = Math.abs(m);
      const lip = v < 0.2 ? 0.18 : v > 0.82 ? -0.22 : 0; // a lit top lip, a shaded bottom
      let c;
      if (a <= zq) {
        if (kind === 'shield') c = mixRgb(C.steel, C.steelD, (Math.floor(u * 40) + Math.floor(v * 4)) % 2 ? 0.25 : 0);
        else c = mixRgb(C.green, C.greenL, clamp01(1 - a / zq) * 0.45);
      } else if (m < 0) c = mixRgb(C.aqua, C.coral, clamp01((a - zq) / (1 - zq)) ** 1.3);
      else c = mixRgb(C.aqua, C.orange, clamp01((a - zq) / (1 - zq)) ** 1.3);
      c = mixRgb(c, C.navy, 0.18);
      return shadeRgb(c, lip);
    });
  });
}

function barSprite(L, kind) {
  const b = Math.max(2, Math.round(3 * L.S));
  return art(`bar|${L.w}|${L.bh}|${kind}`, () => slab(L.w, L.bh, b, (u, v) => {
    if (kind === 'empty') return shadeRgb(C.navy, v < 0.3 ? 0.1 : -0.1);
    if (kind === 'ghost') return shadeRgb(C.coralD, v < 0.3 ? 0.2 : 0);
    if (kind === 'stun') return shadeRgb(mixRgb(C.aqua, C.white, 0.35), v < 0.3 ? 0.3 : 0);
    return shadeRgb(mixRgb(C.limeD, C.lime, 0.5 + 0.5 * Math.sin(u * 30)), v < 0.3 ? 0.35 : v > 0.7 ? -0.15 : 0);
  }, { corner: 1 }));
}

// The SHOCK button dome: voxel blocks, lit top-left; `fill` 0..1 of gold rising from the bottom (recharge), the rest
// steel. kind: 'ready' | 'charge' | 'beat' | 'bad'.
function buttonSprite(r, fillQ, kind) {
  return art(`btn|${r}|${fillQ}|${kind}`, () => {
    const b = Math.max(2, Math.round(r / 11)), S = r * 2 + 7, Cc = r + 3;
    const top = kind === 'bad' ? [C.coral, C.coralD] : kind === 'beat' ? [C.goldL, C.gold] : [C.gold, C.goldD];
    return paint(S, S, (px, py) => {
      const dx = px - Cc, dy = py - Cc, d = Math.hypot(dx, dy);
      if (d > r + 3.2) return null;
      if (d > r + 1.2) return [12, 58, 82, 255];
      if (d > r - b * 0.9) { // bezel ring (static chrome)
        const lit = -(dx + dy) / Math.max(1, d);
        return shadeRgb(hex('#b4d0e2'), lit > 0.3 ? 0.5 : lit < -0.4 ? -0.35 : 0);
      }
      // voxel blocks of the dome
      const bx = Math.floor((px - Cc + r) / b), by = Math.floor((py - Cc + r) / b);
      const qx = (bx + 0.5) * b - r, qy = (by + 0.5) * b - r;
      const nd = Math.hypot(qx, qy) / r;
      const level = 1 - (qy + r) / (2 * r); // 0 bottom .. 1 top
      const gold = kind === 'ready' || kind === 'beat' || kind === 'bad' || level <= fillQ;
      const base = gold ? top : [C.grey, C.greyD];
      const nz = Math.sqrt(Math.max(0, 1 - nd * nd));
      const l = clamp01(0.25 + 0.55 * nz - (qx + qy) / (r * 3));
      let c = mixRgb(base[1], base[0], l);
      const ix = (px - Cc + r) - bx * b, iy = (py - Cc + r) - by * b;
      if (iy === 0 || ix === 0) c = shadeRgb(c, 0.22); else if (iy === b - 1 || ix === b - 1) c = shadeRgb(c, -0.16);
      // a hard gloss patch at the top-left
      const gx = (qx + r * 0.34) / (r * 0.42), gy = (qy + r * 0.42) / (r * 0.24);
      if (gx * gx + gy * gy < 1) c = shadeRgb(c, 0.65);
      if (!gold && Math.abs(level - fillQ) * r * 2 < b) c = shadeRgb(C.gold, 0.4); // the rising gold line
      return [c[0], c[1], c[2], 255];
    });
  });
}

// a 4-point voxel spark (the beat's sweeping spark), size s
function sparkSprite(s, col) {
  return art(`spk|${s}|${col}`, () => {
    const S = s * 2 + 3, Cc = s + 1, cc = hex(col);
    return paint(S, S, (x, y) => {
      const dx = Math.abs(x - Cc), dy = Math.abs(y - Cc);
      const inside = dx + dy * 2.2 <= s || dy + dx * 2.2 <= s || (dx <= 1 && dy <= 1);
      if (!inside) {
        const near = (dx - 1) + dy * 2.2 <= s || dy - 1 + dx * 2.2 <= s;
        return near ? [12, 58, 82, 255] : null;
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
      if (xx >= edge && xx <= edge + th) return xx <= edge + 1 || xx >= edge + th - 1 ? [12, 58, 82, 255] : [...shadeRgb(cc, yy < 0 ? 0.3 : 0), 255];
      return null;
    });
  });
}

function glow(ctx, x, y, r, col, a) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= a;
  ctx.drawImage(glowSprite(r, col), Math.round(x - r), Math.round(y - r));
  ctx.restore();
}

// ------------------------------------------------------------------ drawing
export function drawMeter(ctx, F, B) {
  const L = meterLayout(F), S = L.S, t = F.t;
  const k = ease.outCubic(clamp01(B.hudIn ?? 1));
  if (k <= 0.01) return;
  const dy = Math.round((1 - k) * 120 * S);
  const shake = F.meterShake > 0 ? Math.round((Math.random() - 0.5) * F.meterShake * 6) : 0;
  ctx.save();
  ctx.translate(shake, dy);
  drawTrack(ctx, F, B, L, t);
  drawBar(ctx, F, B, L, t);
  drawButton(ctx, F, B, L, t);
  ctx.restore();
}

function drawTrack(ctx, F, B, L, t) {
  const S = L.S, zoneW = B.zoneW, shield = !!B.boss?.shielded;
  const y0 = L.cy - L.h / 2;
  const beat = B.beat;
  // glass backing plate (readable over sky and abyss alike)
  ctx.fillStyle = rgba('#06223e', 0.42);
  ctx.fillRect(L.x0 - Math.round(8 * S), y0 - Math.round(6 * S), L.w + Math.round(16 * S), L.h + L.bh + Math.round(26 * S));
  const spr = trackSprite(L, zoneW, shield ? 'shield' : 'plain');
  ctx.drawImage(spr, L.x0 - 2, y0 - 2);
  const zx0 = mx(L, -zoneW), zx1 = mx(L, zoneW);
  // the zone: glows while the marker is in it, flashes gold on a beat
  if (!shield && (B.inZone || beat)) {
    const a = beat ? 0.35 + 0.3 * Math.sin(t * 18) : 0.28 + 0.12 * Math.sin(t * 9) + B.steady * 0.2;
    glow(ctx, L.cx, L.cy, Math.round((zx1 - zx0) * 0.55 + 8 * S), beat ? '#ffe27a' : '#8be04a', a);
  }
  // zone edge posts (voxel brackets)
  for (const zx of [zx0, zx1]) {
    const x = Math.round(zx);
    ctx.fillStyle = INK; ctx.fillRect(x - 2, y0 - Math.round(5 * S), 4, L.h + Math.round(10 * S));
    ctx.fillStyle = shield ? '#d8f0ff' : beat ? '#fff6a0' : B.inZone ? '#e2ffb0' : '#ffffff';
    ctx.fillRect(x - 1, y0 - Math.round(4 * S), 2, L.h + Math.round(8 * S));
  }
  // ticks along the track
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = -8; i <= 8; i++) { if (i === 0) continue; const x = Math.round(mx(L, i / 8)); ctx.fillRect(x, y0 + L.h - Math.round(6 * S), 1, Math.round(4 * S)); }
  // the centre line
  ctx.fillStyle = rgba('#ffffff', 0.7); ctx.fillRect(Math.round(L.cx), y0 + 3, 1, L.h - 6);
  if (shield) word3D(ctx, 'LOCKED', L.cx, L.cy, { t, scale: 0.5 * S, pal: 'white', wobble: 0.4, alpha: 0.9 });
  // lunge warning: chevrons racing out on the side the fish will shove the marker
  const lu = B.lunge;
  if (lu) {
    const side = -lu.dir; // dir +1 = toward you (the marker goes right) / -1 = away (left)
    const dirS = side < 0 ? -1 : 1;
    const col = lu.stage === 'tele' ? (Math.floor(t * 10) % 2 ? '#ffd23a' : '#ffffff') : '#ff6a5a';
    const ch = chevron(Math.round(L.h * 0.7), col, dirS);
    for (let i = 0; i < 3; i++) {
      const ph = (t * 2.5 + i / 3) % 1;
      const u = dirS * (zoneW + 0.08 + ph * (0.8 - zoneW));
      ctx.globalAlpha = 1 - ph * 0.7;
      ctx.drawImage(ch, Math.round(mx(L, u) - ch.width / 2), Math.round(L.cy - ch.height / 2));
    }
    ctx.globalAlpha = 1;
    if (lu.stage === 'tele') word3D(ctx, dirS < 0 ? 'IT WILL RUN!' : 'IT WILL RUSH!', mx(L, dirS * 0.62), y0 - Math.round(20 * S), { t, scale: 0.45 * S, pal: 'sun', wobble: 0.8 });
  }
  // the beat: the gold notch + the sweeping spark
  if (beat) {
    const cw = Math.max(3, Math.round(mx(L, B.critW) - L.cx));
    const pulse = Math.floor(t * 14) % 2;
    ctx.fillStyle = INK; ctx.fillRect(Math.round(L.cx - cw - 1), y0 - Math.round(7 * S), cw * 2 + 2, L.h + Math.round(14 * S));
    ctx.fillStyle = pulse ? '#ffc21a' : '#ffe46a'; ctx.fillRect(Math.round(L.cx - cw), y0 - Math.round(6 * S), cw * 2, L.h + Math.round(12 * S));
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(Math.round(L.cx - cw), y0 - Math.round(6 * S), cw * 2, Math.round(3 * S));
    glow(ctx, L.cx, L.cy, Math.round(cw * 2 + 14 * S), '#fff2b8', 0.5);
    if (beat.stage === 'sweep') {
      const s = Math.round(10 * S);
      const inCrit = Math.abs(beat.x) <= B.critW;
      const hist = F.sparkHist || (F.sparkHist = []);
      hist.push(beat.x); if (hist.length > 7) hist.shift();
      for (let i = 0; i < hist.length - 1; i++) {
        const q = (i + 1) / hist.length;
        ctx.fillStyle = rgba('#fff6a0', q * 0.7);
        const hx = mx(L, hist[i]), hs = Math.max(2, Math.round(s * 0.5 * q));
        ctx.fillRect(Math.round(hx - hs / 2), Math.round(L.cy - hs / 2), hs, hs);
      }
      const sx = mx(L, beat.x);
      glow(ctx, sx, L.cy, s * 2, inCrit ? '#ffffff' : '#ffe27a', 0.7);
      const sp = sparkSprite(s, inCrit ? '#ffffff' : '#ffd23a');
      ctx.drawImage(sp, Math.round(sx - sp.width / 2), Math.round(L.cy - sp.height / 2));
      word3D(ctx, inCrit ? 'NOW!' : 'SHOCK...', L.cx, y0 - Math.round(58 * S), { t, scale: (inCrit ? 1.05 : 0.6) * S, pal: inCrit ? 'sun' : 'white', wobble: inCrit ? 1.6 : 0.6 });
    } else {
      F.sparkHist = [];
      word3D(ctx, 'GET READY!', L.cx, y0 - Math.round(58 * S), { t, pop: clamp01(beat.t * 5), scale: 0.62 * S, pal: 'sun', wobble: 1 });
    }
  }
  drawMarker(ctx, F, B, L, t);
}

function drawMarker(ctx, F, B, L, t) {
  const S = L.S, y0 = L.cy - L.h / 2;
  const m = B.marker;
  const x = Math.round(mx(L, m));
  const inZ = B.inZone && !B.boss?.shielded;
  const col = B.stunned ? '#bff8ff' : inZ ? (B.centre ? '#ffffff' : '#e2ffb0') : Math.abs(m) > 0.8 ? '#ff8a7a' : '#ffffff';
  // the pin across the track
  const pw = Math.max(4, Math.round(5 * S));
  ctx.fillStyle = INK; ctx.fillRect(x - Math.ceil(pw / 2) - 1, y0 - Math.round(6 * S), pw + 2, L.h + Math.round(12 * S));
  ctx.fillStyle = col; ctx.fillRect(x - Math.ceil(pw / 2), y0 - Math.round(5 * S), pw, L.h + Math.round(10 * S));
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(x - Math.ceil(pw / 2), y0 - Math.round(5 * S), 1, L.h + Math.round(10 * S));
  // the fish riding on top, facing where it pulls
  const fw = Math.round(56 * S), fh = Math.round(34 * S);
  const facing = m < -0.05 ? -1 : 1;
  const ic = voxelFishIcon(F.sp, fw, fh, { dir: facing });
  const wob = B.stunned ? Math.round(Math.sin(t * 40) * 1.5) : Math.round(Math.sin(t * (inZ ? 4 : 9)) * (inZ ? 1 : 2));
  if (inZ) glow(ctx, x, y0 - fh * 0.5, Math.round(fh * 0.9), B.centre ? '#ffffff' : '#c8f56a', 0.4 + 0.2 * Math.sin(t * 8));
  if (ic) ctx.drawImage(ic, Math.round(x - ic.width / 2 + wob), Math.round(y0 - ic.height - 4 * S));
  // a little down-pointing pixel tip under the fish
  ctx.fillStyle = INK;
  for (let i = 0; i < 4; i++) ctx.fillRect(x - 4 + i, y0 - Math.round(6 * S) - 4 + i, 9 - i * 2, 1);
  // SPIN! / EASY! coaching arrows when the marker strays (not during a beat or stun)
  if (!B.beat && !B.stunned && !B.boss?.shielded && Math.abs(m) > B.zoneW + 0.04 && B.mode !== 'hookset') {
    const right = m < 0; // the marker is left: spin harder to push it right
    const ax = right ? Math.max(x, mx(L, -0.95)) + Math.round(34 * S) : Math.min(x, mx(L, 0.95)) - Math.round(34 * S);
    const blink = Math.floor(t * 4) % 2;
    word3D(ctx, right ? 'SPIN!' : 'EASY!', ax, L.cy, { t, scale: 0.7 * S, pal: right ? 'aqua' : 'coral', wobble: 1, alpha: blink ? 1 : 0.8 });
  }
  if (inZ && Math.random() < 0.08) F.fx.pixelBurst?.('sparkle', x + (Math.random() - 0.5) * 30 * S, L.cy - L.h, 1, { ramp: B.centre ? 'white' : 'lime', layer: 'fg', size: 0 });
}

function drawBar(ctx, F, B, L, t) {
  const S = L.S;
  const p = clamp01(B.progress), g = clamp01(B.ghost ?? p);
  ctx.drawImage(barSprite(L, 'empty'), L.x0 - 2, L.by - 2);
  const clipTo = (k, spr) => {
    if (k <= 0.002) return;
    const w = Math.max(1, Math.round((L.w + 4) * k));
    ctx.drawImage(spr, 0, 0, w, spr.height, L.x0 - 2, L.by - 2, w, spr.height);
  };
  if (g > p + 0.003) clipTo(g, barSprite(L, 'ghost'));
  clipTo(p, barSprite(L, B.stunned ? 'stun' : 'fill'));
  // the head bead + the goal at the end
  if (p > 0.01) {
    const hx = Math.round(L.x0 + L.w * p), r = Math.round(L.bh * 0.55);
    ctx.fillStyle = INK; ctx.fillRect(hx - r - 1, L.by + L.bh / 2 - r - 1, r * 2 + 2, r * 2 + 2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(hx - r, Math.round(L.by + L.bh / 2 - r), r * 2, r * 2);
    ctx.fillStyle = '#c8f56a'; ctx.fillRect(hx - r + 1, Math.round(L.by + L.bh / 2), r * 2 - 2, r - 1);
  }
  if (B.inZone && !B.beat && B.steady > 0.98) word3D(ctx, 'STEADY x1.35', L.x1 - Math.round(52 * S), L.by + L.bh + Math.round(10 * S), { t, scale: 0.4 * S, pal: 'leaf', wobble: 0.5 });
  word3D(ctx, Math.round(p * 100) + '%', L.x1 + Math.round(24 * S), L.by + L.bh / 2, { t: 0, scale: 0.5 * S, pal: 'leaf', wobble: 0 });
}

function drawButton(ctx, F, B, L, t) {
  const S = L.S, b = L.btn, r = b.r;
  const ready = B.charges > 0, beat = B.beat?.stage === 'sweep';
  const fill = ready ? 1 : clamp01(B.chargeK ?? 0);
  const bad = F.btnBad > 0;
  const kind = bad ? 'bad' : beat ? 'beat' : ready ? 'ready' : 'charge';
  const press = F.btnPress || 0;
  const cy = b.cy + Math.round(press * 4 * S);
  // pulse while a beat runs
  if (beat || B.beat) glow(ctx, b.cx, cy, Math.round(r * 1.7), '#ffe27a', 0.45 + 0.35 * Math.sin(t * 16));
  else if (ready) glow(ctx, b.cx, cy, Math.round(r * 1.4), '#ffe27a', 0.18 + 0.1 * Math.sin(t * 4));
  // the button's side (its voxel depth) then the dome
  ctx.fillStyle = INK; ctx.fillRect(b.cx - r + Math.round(r * 0.3), cy + r - 2, Math.round(r * 1.4), Math.round(7 * S) - Math.round(press * 4 * S) + 2);
  ctx.fillStyle = '#7a4a10'; ctx.fillRect(b.cx - r + Math.round(r * 0.32), cy + r - 2, Math.round(r * 1.36), Math.round(5 * S) - Math.round(press * 3 * S));
  const spr = buttonSprite(r, Math.round(fill * 12) / 12, kind);
  ctx.drawImage(spr, Math.round(b.cx - spr.width / 2), Math.round(cy - spr.height / 2));
  const den = F.btnDenied > 0 ? Math.round(Math.sin(t * 60) * 3 * F.btnDenied) : 0;
  drawIcon3d(ctx, ready ? 'bolt' : 'bolt_off', b.cx + den, cy, Math.round(r * 1.25), Math.sin(t * 2) * 0.5);
  // charge pips under it
  const n = B.shockMax, ps = Math.max(5, Math.round(6 * S)), gap = ps + Math.round(4 * S);
  const px0 = Math.round(b.cx - ((n - 1) * gap) / 2);
  const py = Math.round(b.cy + r + 8 * S);
  for (let i = 0; i < n; i++) {
    const on = i < B.charges;
    const x = px0 + i * gap;
    ctx.fillStyle = INK; ctx.fillRect(x - ps / 2 - 1, py - 1, ps + 2, ps + 2);
    ctx.fillStyle = on ? '#ffd23a' : '#3a4a58'; ctx.fillRect(x - ps / 2, py, ps, ps);
    ctx.fillStyle = on ? '#fff6a0' : '#56687a'; ctx.fillRect(x - ps / 2, py, ps, 2);
  }
  // the weapon level and the key
  word3D(ctx, 'MK ' + ROMAN[B.level || 1], b.cx, Math.round(b.cy - r - 11 * S), { t, scale: 0.42 * S, pal: B.chain ? 'sun' : 'white', wobble: 0.4 });
  const kx = Math.round(b.cx - r - 28 * S);
  drawIcon3d(ctx, beat ? 'space_lit' : 'space', kx, b.cy - Math.round(4 * S), Math.round(40 * S), 0, ready ? 1 : 0.6);
  word3D(ctx, 'SPACE', kx, b.cy + Math.round(14 * S), { t: 0, scale: 0.32 * S, pal: beat ? 'sun' : 'white', wobble: 0, alpha: ready ? 1 : 0.6 });
  if (beat) word3D(ctx, 'SHOCK!', b.cx, cy, { t, scale: 0.55 * S, pal: 'sun', wobble: 1.4, alpha: 0.85 });
}

export { TAU, lerp };
