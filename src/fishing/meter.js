// [simple24] The fight HUD: ONE centred meter, the catch tube under it and the big SHOCK button.
// [fishui30] Restyled as square pixel art that is part of the ocean (no rounded shapes, no soft round glows):
//   console  one stepped-corner steel panel holds the meter and the catch tube.
//   meter    a strip of pixel-art WATER seen from the side: banded depth, a sandy floor, gently scrolling surface
//            crests and caustic dashes (two cached periodic strips, parallax), kelp fronds swaying at both ends (8
//            cached frames, faster when the fish thrashes), rising pixel bubbles. The sweet ZONE is a patch of calm
//            teal water between two bracket posts that shimmers while the marker is in it; the ends tint coral (it
//            RUNS) and amber (the line SNAPS) in dithered steps. The MARKER is the hooked fish itself (its voxel icon)
//            swimming in the strip, tail wiggling (the icon is drawn in 4 sheared slices), hanging on a 1 px line from a
//            caret on the frame and leaving a little foam wake when it moves. Lunges: foam chevrons race through the
//            water. Shield (bosses / mimics): the zone turns to riveted steel, LOCKED.
//   beat     a GOLD notch pillar at the centre and a pixel spark sweeping across: press as it crosses the notch.
//   tube     the catch bar: a glass tube that fills with calm water from the left, a sloshing meniscus at its head,
//            bubbles inside, a red ghost of lost progress, the percentage in crisp pixel text.
//   button   the big SHOCK button: a chunky octagonal pixel button (steel bezel, gold face, a side for depth), the
//            gold rising inside it as it recharges, the voxel bolt, diamond charge pips, a MK plaque and a SPACE keycap.
// 3D voxel words (NOW!, SPIN!, LOCKED ...) stay for the pop-ups. Per frame: a few drawImage calls of cached art plus
// a few dozen fillRects; nothing is allocated.
//
//   meterLayout(F) -> {S, u, cx, cy, w, h, x0, x1, by, bh, btn: {cx, cy, r}, panel: {x, y, w, h}}
//   drawMeter(ctx, F, B)          meterRect(F, kind)  kind: 'meter' | 'bar' | 'shock' | 'all'
//   hitShockButton(F, x, y) -> bool

import { TAU, clamp, clamp01, lerp, ease, hash2, bayer } from '../core/math.js';
import { rgba } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText } from '../gfx/font.js';
import { voxelFishIcon } from '../fish/fishicon.js';
import { word3D } from './cinematics.js';
import { drawIcon3d } from './icons3d.js';
import { PAL, pxFrame, pxHalo, pxDiamond, pxCaret, unitOf } from './pixui.js';

const INK = PAL.ink;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixRgb = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const shadeRgb = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

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
  w -= w % 2;
  const h = Math.round(32 * S);
  const cy = Math.round(H - 80 * S);
  const x0 = cx - Math.round(w / 2), x1 = x0 + w;
  const by = cy + Math.round(h / 2 + 9 * S), bh = Math.round(13 * S);
  const pad = Math.round(8 * S);
  const panel = { x: x0 - pad, y: cy - Math.round(h / 2) - Math.round(7 * S), w: w + pad * 2, h: 0 };
  panel.h = by + bh + Math.round(7 * S) - panel.y;
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

// The button is an octagon: a square hit box (with a little slack) is fair and simple.
export function hitShockButton(F, x, y) {
  const b = meterLayout(F).btn;
  return Math.abs(x - b.cx) <= b.r + 6 && Math.abs(y - b.cy) <= b.r + 8;
}

// meter units (-1..1) -> screen x
const mx = (L, u) => L.cx + clamp(u, -1.15, 1.15) * (L.w / 2 - L.h * 0.35);

const C = {
  coral: hex('#ff7a66'), amber: hex('#ffa63a'), white: hex('#ffffff'), ink: hex(INK),
  sand: [hex('#f4e2a8'), hex('#d8bc78'), hex('#a88a50')],
  w: PAL.water.map(hex), calm: PAL.calm.map(hex), steel: PAL.steel.map(hex), gold: PAL.gold.map(hex),
};

// ------------------------------------------------------------------ the water strip (cached per zone width)
// Banded depth (dithered seams), a sandy floor, the calm zone, dithered danger tints toward the ends, tick marks.
function trackSprite(L, zoneW, kind) {
  const zq = Math.round(zoneW * 50) / 50;
  return art(`trk|${L.w}|${L.h}|${zq}|${kind}`, () => {
    const W = L.w, H = L.h, u = L.u;
    const half = W / 2 - H * 0.35;
    const floor = H - 3 * u;
    return paint(W, H, (x, y) => {
      const m = (x + 0.5 - W / 2) / half, a = Math.abs(m);
      const b = bayer(x, y);
      // sand floor with pebbles
      if (y >= floor) {
        const sy = (y - floor) / (3 * u);
        let c = C.sand[sy < 0.34 ? 0 : sy < 0.67 ? 1 : 2];
        if (hash2(Math.floor(x / u), Math.floor(y / u), 7) > 0.9) c = C.sand[2];
        if (kind === 'shield' && a <= zq) c = C.steel[3];
        return c;
      }
      const v = y / floor; // 0 surface .. 1 floor
      // depth bands (water ramp 1..4) with a checker dither at each seam
      const bandF = 1 + v * 3.6 + (b - 0.5) * 0.35;
      const bi = Math.min(4, Math.max(1, Math.floor(bandF)));
      let c = C.w[bi];
      if (y < u) c = C.w[0]; // the bright surface row
      if (a <= zq) {
        if (kind === 'shield') {
          const rv = ((Math.floor(x / (3 * u)) + Math.floor(y / (3 * u))) % 2) ? 2 : 1;
          c = C.steel[y < u ? 0 : rv + (v > 0.7 ? 1 : 0)];
          if ((x % (8 * u)) < u && (y % (8 * u)) < u) c = C.steel[0]; // rivets
        } else {
          const ci = Math.min(4, Math.max(1, Math.floor(1 + v * 3.4 + (b - 0.5) * 0.35)));
          c = y < u ? C.calm[0] : C.calm[ci];
        }
      } else {
        // danger tint in three dithered steps toward each end
        const d = clamp01((a - zq) / Math.max(0.05, 1 - zq));
        const step = d + (b - 0.5) * 0.18;
        const k = step > 0.72 ? 0.62 : step > 0.42 ? 0.38 : step > 0.14 ? 0.16 : 0;
        if (k > 0) c = mixRgb(c, m < 0 ? C.coral : C.amber, k);
      }
      // ticks every eighth of the meter on the sand line
      const tick = Math.round((m + 1) * 8) / 8 - 1, tx = W / 2 + tick * half;
      if (Math.abs(tick) > 0.01 && x >= Math.round(tx) && x < Math.round(tx) + u && y >= floor - 2 * u) c = shadeRgb(c, 0.35);
      return c;
    });
  });
}

// Periodic overlays: surface crests (fast) and caustic dashes (slow), P px period, alpha pixels on transparent.
const PER = 48;
function crestSprite(L) {
  return art(`crest|${L.w}|${L.h}`, () => {
    const u = L.u, P = PER * u, W = L.w + P;
    return paint(W, 3 * u, (x, y) => {
      const ph = (x / P) * TAU * 2;
      const top = Math.round((1 + Math.sin(ph)) * u * 0.9);
      if (y === top || (y === top + u && Math.sin(ph) > 0.6)) return [255, 255, 255, y === top ? 210 : 120];
      return null;
    });
  });
}
function causticSprite(L) {
  return art(`caus|${L.w}|${L.h}`, () => {
    const u = L.u, P = PER * u, W = L.w + P, H = L.h - 3 * u;
    return paint(W, H, (x, y) => {
      if (y < 3 * u || y > H - 3 * u) return null;
      const cx = Math.floor((x % P) / u), cy = Math.floor(y / u);
      // short horizontal dashes at hashed spots of a tile, denser near the surface
      const h0 = hash2(Math.floor(cx / 5), cy, 31);
      if (h0 < 0.86 - (1 - y / H) * 0.08) return null;
      if (cx % 5 > 2 + Math.floor(h0 * 10) % 2) return null;
      return [255, 255, 255, 70 + Math.round((1 - y / H) * 60)];
    });
  });
}

// Kelp fronds (3 blades, leaflets, ink outline), 8 sway frames.
function kelpSprite(hh, u, fr, flip) {
  return art(`kelp|${hh}|${u}|${fr}|${flip}`, () => {
    const w = 18 * u, c = makeCanvas(w, hh), g = ctxOf(c);
    const blades = [[4, 0.95, 0], [9, 0.72, 2.1], [13, 0.84, 4.2]];
    const K = PAL.kelp;
    for (let pass = 0; pass < 2; pass++) {
      for (const [bx, hk, ph] of blades) {
        const bh = Math.round(hh * hk);
        for (let y = 0; y < bh; y += u) {
          const k = y / bh;
          const sway = Math.sin((fr / 8) * TAU + ph + k * 2.4) * 3 * u * Math.pow(k, 1.3);
          let x = Math.round(bx * u + sway);
          if (flip) x = w - x - 2 * u;
          const yy = hh - y - u;
          const bw = k > 0.85 ? u : 2 * u;
          if (pass === 0) { g.fillStyle = INK; g.fillRect(x - 1, yy - 1, bw + 2, u + 2); }
          else {
            g.fillStyle = k > 0.6 ? K[1] : K[2]; g.fillRect(x, yy, bw, u);
            g.fillStyle = K[0]; g.fillRect(x, yy, Math.max(1, Math.round(u / 2)), u);
          }
          // a leaflet every few rows, alternating sides
          if ((y / u) % 5 === 2 && k > 0.12 && k < 0.9) {
            const side = ((y / u) % 10 === 2) ? -1 : 1, lx = side < 0 ? x - 2 * u : x + bw;
            if (pass === 0) { g.fillStyle = INK; g.fillRect(lx - 1, yy - u - 1, 2 * u + 2, 2 * u + 2); }
            else { g.fillStyle = K[1]; g.fillRect(lx, yy - u, 2 * u, u); g.fillStyle = K[2]; g.fillRect(lx, yy, 2 * u, u); }
          }
        }
      }
    }
    return c;
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
function buttonSprite(r, face, u) {
  return art(`btn|${r}|${face}|${u}`, () => {
    const n = r * 2, cut = Math.round(r * 0.52), step = 2 * u;
    const q = (v) => Math.floor(v / step) * step; // stepped diagonal
    const inside = (x, y, inset) => {
      const ex = Math.min(x, n - 1 - x) - inset, ey = Math.min(y, n - 1 - y) - inset;
      return ex >= 0 && ey >= 0 && q(ex) + q(ey) >= cut - inset;
    };
    const P = face === 'red' ? PAL.coral.map(hex) : face === 'steel' ? C.steel : face === 'beat' ? [hex('#ffffff'), ...C.gold.slice(0, 4)] : C.gold;
    const bez = C.steel;
    const bw = 3 * u;
    return paint(n, n, (x, y) => {
      if (!inside(x, y, 0)) return null;
      if (!inside(x, y, u)) return [...C.ink, 255];
      if (!inside(x, y, u + bw)) {
        if (inside(x, y, bw)) return [...C.ink, 255]; // the inner ink line
        const lit = (x + y) < n - 1, outer = !inside(x, y, 2 * u);
        return [...bez[lit ? (outer ? 0 : 1) : (outer ? 4 : 3)], 255];
      }
      // the face: bands by height, a lit upper-left facet, a shaded lower-right rim, a hard gloss block
      const fy = y / n;
      let i = fy < 0.36 ? 1 : fy < 0.7 ? 2 : 3;
      const edgeL = !inside(x - u, y, u + bw) || !inside(x, y - u, u + bw);
      const edgeD = !inside(x + u, y, u + bw) || !inside(x, y + u, u + bw);
      if (edgeL) i = 0; else if (edgeD) i = 4;
      if (x > n * 0.26 && x < n * 0.42 && y > n * 0.2 && y < n * 0.28) i = 0; // gloss
      return [...P[Math.min(P.length - 1, i)], 255];
    });
  });
}

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
  // the console: one steel panel holding the meter and the tube
  const P = L.panel;
  pxFrame(ctx, P.x, P.y, P.w, P.h, { u: L.u, step: 2, fill: PAL.navy, rim: PAL.rim });
  drawTrack(ctx, F, B, L, t);
  drawBar(ctx, F, B, L, t);
  drawButton(ctx, F, B, L, t);
  ctx.restore();
}

function drawTrack(ctx, F, B, L, t) {
  const S = L.S, u = L.u, zoneW = B.zoneW, shield = !!(B.boss?.shielded || B.shielded); // [crate26] a mimic's shield too
  const y0 = Math.round(L.cy - L.h / 2), x0 = L.x0;
  const beat = B.beat;
  // the water window: an ink rim, then the strip
  ctx.fillStyle = INK; ctx.fillRect(x0 - u, y0 - u, L.w + 2 * u, L.h + 2 * u);
  ctx.drawImage(trackSprite(L, zoneW, shield ? 'shield' : 'plain'), x0, y0);
  // scrolling caustics (slow) and surface crests (faster): one blit each from a periodic strip
  const P = PER * u;
  const cs = causticSprite(L);
  ctx.drawImage(cs, Math.floor((t * 6 * u) % P), 0, L.w, cs.height, x0, y0, L.w, cs.height);
  const cr = crestSprite(L);
  ctx.drawImage(cr, Math.floor(P - ((t * 14 * u) % P)), 0, L.w, cr.height, x0, y0, L.w, cr.height);
  const zx0 = Math.round(mx(L, -zoneW)), zx1 = Math.round(mx(L, zoneW));
  // the calm zone shimmers while the marker is in it, flashes gold on a beat
  if (!shield && (B.inZone || beat)) {
    const a = beat ? 0.2 + 0.16 * (Math.floor(t * 12) % 2) : 0.1 + 0.08 * Math.sin(t * 6) + B.steady * 0.12;
    ctx.fillStyle = rgba(beat ? '#ffe46a' : '#e6fff4', a);
    ctx.fillRect(zx0, y0, zx1 - zx0, L.h - 3 * u);
    // twinkles: little plus sparkles at hashed spots of the calm water
    ctx.fillStyle = beat ? '#fff6c0' : '#ffffff';
    for (let i = 0; i < 5; i++) {
      const ph = (t * 1.3 + i * 0.37) % 1;
      if (ph > 0.5) continue;
      const cell = Math.floor(t * 1.3 + i * 0.37);
      const sx = zx0 + 2 * u + Math.floor(hash2(i, cell, 3) * Math.max(1, zx1 - zx0 - 4 * u)), sy = y0 + 3 * u + Math.floor(hash2(cell, i, 5) * (L.h - 9 * u));
      ctx.fillRect(sx - u, sy, 3 * u, u); ctx.fillRect(sx, sy - u, u, 3 * u);
    }
  }
  // kelp fronds at both ends (sway faster with the commotion)
  const kh = Math.round(L.h * 0.86);
  const spd = 6 + (B.lunge ? 10 : 0) + Math.abs(B.mv || 0) * 6 + (B.stunned ? 8 : 0);
  const fr = Math.floor(t * spd) % 8;
  ctx.drawImage(kelpSprite(kh, u, fr, false), x0 + u, y0 + L.h - kh - u);
  ctx.drawImage(kelpSprite(kh, u, (fr + 3) % 8, true), L.x1 - 19 * u, y0 + L.h - kh - u);
  // rising pixel bubbles (deterministic: no state, no allocation)
  const hW = L.h - 4 * u;
  for (let i = 0; i < 9; i++) {
    const sp = 7 + hash2(i, 1, 11) * 9, ph = hash2(i, 2, 11);
    const k = (t * sp / hW + ph) % 1;
    const bx = Math.round(x0 + 6 * u + hash2(i, 3, 11) * (L.w - 12 * u) + Math.sin(t * 2 + i) * u);
    const by = Math.round(y0 + L.h - 4 * u - k * hW);
    if (i % 3 === 0) { // a 3x3 ring bubble with a highlight
      ctx.fillStyle = 'rgba(230,252,255,0.85)';
      ctx.fillRect(bx, by - u, u, u); ctx.fillRect(bx - u, by, u, u); ctx.fillRect(bx + u, by, u, u); ctx.fillRect(bx, by + u, u, u);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - u, by - u, u, u);
    } else { ctx.fillStyle = 'rgba(230,252,255,0.75)'; ctx.fillRect(bx, by, u, u); }
  }
  // zone bracket posts: ink, a light core, square caps above and below the water
  const postCol = shield ? '#d8f0ff' : beat ? '#fff6a0' : B.inZone ? '#e6fff4' : '#ffffff';
  for (const zx of [zx0, zx1]) {
    const px = zx - u;
    ctx.fillStyle = INK; ctx.fillRect(px - u, y0 - 4 * u, 4 * u, L.h + 8 * u);
    ctx.fillStyle = postCol; ctx.fillRect(px, y0 - 3 * u, 2 * u, L.h + 6 * u);
    ctx.fillStyle = shield ? '#8aa4bc' : '#3ccc9c'; ctx.fillRect(px + u, y0 - 3 * u, u, L.h + 6 * u);
    ctx.fillStyle = INK; ctx.fillRect(px - 2 * u, y0 - 5 * u, 6 * u, 2 * u); ctx.fillRect(px - 2 * u, y0 + L.h + 3 * u, 6 * u, 2 * u);
  }
  // the centre mark: a short dashed line in the calm water
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let yy = y0 + 2 * u; yy < y0 + L.h - 4 * u; yy += 3 * u) ctx.fillRect(L.cx, yy, u, u * 2);
  if (shield) word3D(ctx, 'LOCKED', L.cx, L.cy, { t, scale: 0.5 * S, pal: 'white', wobble: 0.4, alpha: 0.9 });
  if (B.twist) drawTwist(ctx, F, B, L, t); // [deep28] the deep fish's personality on the meter
  // lunge warning: foam chevrons racing through the water on the side the fish will shove the marker
  const lu = B.lunge;
  if (lu) {
    const side = -lu.dir; // dir +1 = toward you (the marker goes right) / -1 = away (left)
    const dirS = side < 0 ? -1 : 1;
    const col = lu.stage === 'tele' ? (Math.floor(t * 10) % 2 ? '#ffd23a' : '#ffffff') : '#ff7a66';
    const ch = chevron(Math.round(L.h * 0.62), col, dirS);
    for (let i = 0; i < 3; i++) {
      const ph = (t * 2.5 + i / 3) % 1;
      const uu = dirS * (zoneW + 0.08 + ph * (0.8 - zoneW));
      ctx.globalAlpha = 1 - ph * 0.7;
      ctx.drawImage(ch, Math.round(mx(L, uu) - ch.width / 2), Math.round(L.cy - u - ch.height / 2));
    }
    ctx.globalAlpha = 1;
    if (lu.stage === 'tele') word3D(ctx, dirS < 0 ? 'IT WILL RUN!' : 'IT WILL RUSH!', mx(L, dirS * 0.62), y0 - Math.round(22 * S), { t, scale: 0.45 * S, pal: 'sun', wobble: 0.8 });
  }
  // the beat: the gold notch pillar + the sweeping spark
  if (beat) {
    const cw = Math.max(3 * u, Math.round(mx(L, B.critW) - L.cx));
    const pulse = Math.floor(t * 14) % 2;
    const ny0 = y0 - 6 * u, nh = L.h + 12 * u;
    pxHalo(ctx, L.cx, L.cy, cw * 2, nh, '#ffe46a', 0.7, u);
    const nx = Math.round(L.cx - cw), nw = cw * 2;
    // a gold glass pillar: solid ink / gold rails, the water showing through its middle
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
      // the trail: shrinking squares behind the spark (meter units back along its path)
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
  drawMarker(ctx, F, B, L, t);
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
    ctx.fillRect(zx0, y0 - Math.round(6 * S), zx1 - zx0, L.h + Math.round(12 * S));
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
function drawMarker(ctx, F, B, L, t) {
  const S = L.S, u = L.u, y0 = Math.round(L.cy - L.h / 2);
  const m = B.marker;
  const x = Math.round(mx(L, m));
  const inZ = B.inZone && !B.boss?.shielded && !B.shielded;
  const red = B.redFlash > 0.3 && Math.floor(t * 16) % 2;
  const col = red ? '#ff3a4a' : B.stunned ? '#bff8ff' : inZ ? (B.centre ? '#ffffff' : '#e6fff4') : Math.abs(m) > 0.8 ? '#ff8a7a' : '#ffffff';
  const vanta = B.vanta || 0; // [deep28] the blackdragon turns ultra-black: only its chin light shows
  const fw = Math.round(48 * S), fh = Math.round(30 * S);
  const facing = (B.mv || 0) < -0.05 ? -1 : (B.mv || 0) > 0.05 ? 1 : m < -0.05 ? -1 : 1;
  const ic = B.markerIcon?.(fw, fh, facing, t) || voxelFishIcon(F.sp, fw, fh, { dir: facing }); // [crate26] a crate rides as itself
  const crate = !!B.markerIcon;
  const fy = Math.round(L.cy - u - (ic ? ic.height / 2 : fh / 2)); // the icon's top
  // the wake: foam dashes on the surface and bubble pixels behind the fish when it moves
  const spd = Math.abs(B.mv || 0);
  if (spd > 0.12 && ic && vanta < 0.5) {
    const back = -Math.sign(B.mv), n = Math.min(5, 1 + Math.floor(spd * 4));
    for (let i = 0; i < n; i++) {
      const wx = Math.round(x + back * (ic.width * 0.42 + i * 5 * u + ((t * 30) % (5 * u))));
      ctx.fillStyle = rgba('#ffffff', 0.75 - i * 0.13);
      ctx.fillRect(wx - u, y0 + u, 3 * u, u);
      if (i % 2 === 0) ctx.fillRect(wx, Math.round(L.cy + Math.sin(t * 9 + i) * 2 * u), u, u);
    }
  }
  if (vanta > 0.02) ctx.globalAlpha = 1 - vanta * 0.94;
  // the line: from a caret on the panel's top edge straight down to the fish
  const lineTop = L.panel.y + 2 * u;
  ctx.fillStyle = INK; ctx.fillRect(x - u, lineTop, 3 * u, Math.max(0, fy + 4 * u - lineTop));
  ctx.fillStyle = col; ctx.fillRect(x, lineTop, u, Math.max(0, fy + 4 * u - lineTop));
  pxCaret(ctx, x, L.panel.y + 4 * u, 4 * u, 'down', col);
  // the fish, its tail wiggling: four vertical slices sheared up / down (the tail slice the most)
  if (inZ) pxHalo(ctx, x, L.cy - u, ic ? ic.width * 0.6 : fw * 0.6, ic ? ic.height * 0.5 : fh * 0.5, B.centre ? '#ffffff' : '#c8ffe4', 0.35 + 0.15 * Math.sin(t * 8), u);
  if (ic) {
    const bob = B.stunned ? Math.round(Math.sin(t * 40) * 1.5) : Math.round(Math.sin(t * (inZ ? 3 : 7)) * u);
    const ix = Math.round(x - ic.width / 2), iy = fy + bob;
    if (crate) {
      ctx.drawImage(ic, ix, iy);
    } else {
      const fq = B.stunned ? 30 : B.lunge?.stage === 'go' ? 22 : inZ ? 8 : 14;
      const amp = (B.stunned ? 1 : B.lunge ? 2.2 : 1.4) * u;
      const n = 4, sw = Math.ceil(ic.width / n);
      for (let j = 0; j < n; j++) {
        const tail = facing > 0 ? j : n - 1 - j; // 0 = tail slice
        const k = [1, 0.55, 0.2, 0][tail];
        const off = Math.round(Math.sin(t * fq - tail * 0.9) * amp * k);
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

// The catch tube: calm water filling a glass tube from the left with a sloshing head.
function drawBar(ctx, F, B, L, t) {
  const S = L.S, u = L.u;
  const p = clamp01(B.progress), g = clamp01(B.ghost ?? p);
  const x0 = L.x0, y = L.by, w = L.w, h = L.bh;
  // the tube: ink, dark glass with a faint grid every 10 %
  pxFrame(ctx, x0 - 2 * u, y - 2 * u, w + 4 * u, h + 4 * u, { u, step: 1, fill: ['#0c3354', '#0a2a48', '#08223c'], rim: ['#2a6a9a', '#0a2a48', '#06182c'] });
  ctx.fillStyle = 'rgba(160,220,255,0.16)';
  for (let i = 1; i < 10; i++) ctx.fillRect(Math.round(x0 + (w * i) / 10), y + u, u, h - 2 * u);
  const head = (k) => Math.round(x0 + w * k);
  const rows = Math.max(1, Math.floor(h / u));
  const slosh = (r) => Math.round(Math.sin(t * 7 + r * 0.9) * 1.4 * u + Math.sin(t * 3.1) * u);
  // ghost: lost progress as dim red water
  if (g > p + 0.003) {
    ctx.fillStyle = 'rgba(240,88,74,0.55)';
    ctx.fillRect(head(p), y, Math.max(u, head(g) - head(p)), h);
  }
  if (p > 0.002) {
    const stun = B.stunned && Math.floor(t * 14) % 2;
    const pal = stun ? ['#ffffff', '#c8fbff', '#7ff0ff', '#2fc8e8'] : ['#f0fff4', '#9ff2c8', '#4cd89e', '#22a878'];
    for (let r = 0; r < rows; r++) {
      const ry = y + r * u, fr = r / rows;
      ctx.fillStyle = r === 0 ? pal[0] : fr < 0.4 ? pal[1] : fr < 0.75 ? pal[2] : pal[3];
      const hx = Math.min(x0 + w, Math.max(x0, head(p) + (p < 0.995 ? slosh(r) : 0)));
      ctx.fillRect(x0, ry, hx - x0, u);
    }
    // the meniscus: a bright foam column at the head
    if (p < 0.995) {
      ctx.fillStyle = '#ffffff';
      for (let r = 0; r < rows; r += 2) ctx.fillRect(Math.min(x0 + w - u, head(p) + slosh(r)), y + r * u, u, u);
    }
    // bubbles rising inside the water
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const fillW = head(p) - x0;
    for (let i = 0; i < 5; i++) {
      if (fillW < 8 * u) break;
      const k = (t * (0.9 + hash2(i, 4, 2) * 0.8) + hash2(i, 5, 2)) % 1;
      ctx.fillRect(Math.round(x0 + 2 * u + hash2(i, 6, 2) * (fillW - 4 * u)), Math.round(y + h - u - k * (h - u)), u, u);
    }
  }
  // the glass: a gloss line along the top and a short bright dash
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x0, y + u, w, u);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x0 + 4 * u, y + u, 14 * u, u);
  // the percentage, crisp pixel text riding the head of the water
  const txt = Math.round(p * 100) + '%';
  const tw = measureText(txt, 'normal', u);
  const tx = clamp(head(p) + 4 * u, x0 + 2 * u, x0 + w - tw - 3 * u);
  drawText(ctx, txt, tx, y + Math.round((h - 7 * u) / 2), { scale: u, color: '#ffffff', outline: INK });
  if (B.inZone && !B.beat && B.steady > 0.98) word3D(ctx, 'STEADY x1.35', L.x1 - Math.round(52 * S), L.by + L.bh + Math.round(13 * S), { t, scale: 0.4 * S, pal: 'leaf', wobble: 0.5 });
}

function drawButton(ctx, F, B, L, t) {
  const S = L.S, u = L.u, b = L.btn, r = b.r;
  const ready = B.charges > 0, beat = B.beat?.stage === 'sweep';
  const fill = ready ? 1 : clamp01(B.chargeK ?? 0);
  const bad = F.btnBad > 0;
  const press = F.btnPress || 0;
  const depth = Math.round(7 * S), pd = Math.round(press * 5 * S);
  const x = b.cx - r, y = b.cy - r + pd;
  // the halo: stepped squares, pulsing on a beat
  if (beat || B.beat) pxHalo(ctx, b.cx, y + r, r * 2, r * 2, '#ffe46a', 0.55 + 0.35 * (Math.floor(t * 12) % 2), u);
  else if (ready) pxHalo(ctx, b.cx, y + r, r * 2, r * 2, '#ffe46a', 0.25 + 0.1 * Math.sin(t * 4), u);
  // the button's side (its depth): the octagon in dark bronze, a little lower
  const sideSpr = art(`btnside|${r}|${u}`, () => {
    const c = makeCanvas(r * 2, r * 2), g = ctxOf(c);
    g.drawImage(buttonSprite(r, 'steel', u), 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#5a3208'; g.fillRect(0, 0, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  for (let d = depth - pd; d > 0; d -= u) ctx.drawImage(sideSpr, x, y + d);
  ctx.drawImage(sideSpr, x, y + depth - pd + u); // bottom ink-ish edge
  // the face: steel while charging, the gold rising in it from the bottom (a sloshing top line)
  const faceKind = bad ? 'red' : beat ? 'beat' : 'gold';
  if (ready || bad || beat) ctx.drawImage(buttonSprite(r, faceKind, u), x, y);
  else {
    ctx.drawImage(buttonSprite(r, 'steel', u), x, y);
    const inner = 4 * u, ih = r * 2 - inner * 2;
    const lvl = Math.round(ih * fill);
    if (lvl > 0) {
      const gy = y + inner + ih - lvl;
      const gold = buttonSprite(r, 'gold', u);
      ctx.drawImage(gold, 0, gy - y, r * 2, r * 2 - (gy - y), x, gy, r * 2, r * 2 - (gy - y));
      // the sloshing surface: a bright line with 1-unit bumps travelling across
      const cut = Math.round(r * 0.52);
      const yy = gy - y, ey = Math.min(yy, r * 2 - 1 - yy);
      const inset = Math.max(inner, cut - Math.floor(ey / (2 * u)) * 2 * u + u);
      ctx.fillStyle = '#fffbd0';
      ctx.fillRect(x + inset, gy, r * 2 - inset * 2, u);
      for (let xx = x + inset; xx < x + r * 2 - inset - 2 * u; xx += 6 * u) {
        const bump = Math.floor((xx / u + t * 10) / 3) % 2;
        if (bump) ctx.fillRect(xx, gy - u, 3 * u, u);
      }
    }
  }
  const den = F.btnDenied > 0 ? Math.round(Math.sin(t * 60) * 3 * F.btnDenied) : 0;
  drawIcon3d(ctx, ready ? 'bolt' : 'bolt_off', b.cx + den, y + r, Math.round(r * 1.2), Math.sin(t * 2) * 0.5);
  // charge pips: diamonds under the button
  const n = B.shockMax, pr = Math.max(3, Math.round(4 * S)), gap = pr * 2 + Math.round(5 * S);
  const px0 = Math.round(b.cx - ((n - 1) * gap) / 2), py = Math.round(b.cy + r + depth + 7 * S);
  for (let i = 0; i < n; i++) pxDiamond(ctx, px0 + i * gap, py, pr, i < B.charges ? '#ffd23a' : '#3a4a58', { lite: i < B.charges ? '#fffbd0' : '#56687a' });
  // the weapon level on a small plaque above
  const mk = 'MK ' + ROMAN[B.level || 1];
  const mw = measureText(mk, 'small', u) + 12 * u, mh = 9 * u;
  pxFrame(ctx, b.cx - mw / 2, b.cy - r - mh - Math.round(4 * S), mw, mh, { u, step: 1, fill: B.chain ? ['#ffe46a', '#ffc81e', '#e8920a'] : PAL.navy, rim: B.chain ? ['#fffbd0', '#ffc81e', '#a85a06'] : PAL.rim });
  drawText(ctx, mk, b.cx, b.cy - r - mh - Math.round(4 * S) + 2 * u, { font: 'small', align: 'center', scale: u, color: B.chain ? '#3a1e06' : '#e8fbff' });
  // the SPACE keycap (pressed and lit during the sweep)
  const kw = Math.round(36 * S), kh = Math.round(16 * S), kx = Math.round(b.cx - r - 10 * S - kw), ky = Math.round(b.cy - kh / 2) + (beat ? u : 0);
  ctx.globalAlpha = ready ? 1 : 0.6;
  if (!beat) { ctx.fillStyle = INK; ctx.fillRect(kx + u, ky + kh, kw - 2 * u, 2 * u); }
  pxFrame(ctx, kx, ky, kw, kh, { u, step: 1, fill: beat ? ['#fffbd0', '#ffe46a', '#ffc81e'] : ['#f0f8ff', '#c2d6e6', '#8aa4bc'], rim: beat ? ['#ffffff', '#ffe46a', '#e8920a'] : ['#ffffff', '#c2d6e6', '#5a7490'] });
  drawText(ctx, 'SPACE', kx + kw / 2, ky + Math.round((kh - 5 * u) / 2), { font: 'small', align: 'center', scale: u, color: beat ? '#3a1e06' : '#1a3048' });
  ctx.globalAlpha = 1;
  if (beat) word3D(ctx, 'SHOCK!', b.cx, y + r, { t, scale: 0.55 * S, pal: 'sun', wobble: 1.4, alpha: 0.9 });
}

export { TAU, lerp };
