// The Lab's 2D UI art and effects (OWNER: Lab agent). The lab SCENERY is voxel (src/ui/labvox.js); this module only
// holds UI chrome and light/water effects, rasterised once and cached where static.
//   ecoOrb(r, color, look) -> canvas   glossy eco-globe button for research-tree nodes (look: 'done'|'open'|'locked'|'sun')
//   drawTube(ctx, pts, o)          the tree's holographic glass tubes with flowing water + bubbles
//                                  o: {t, water 0..1, color, width, flow (px/s), bubbles, alpha}
//   drawSplash(ctx, x, y, k, color) water splash ring + droplets (k 0..1 = age)
//   drawRays(ctx, cx, cy, r, t, alpha, n)  slowly turning sun rays (light shafts)
//   roundRectPath(ctx, x, y, w, h, r)
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { mix, shade, rgba } from '../core/color.js';
import { TAU, hash1, clamp01 } from '../core/math.js';
import { pixelRectPath, pixelOrbCanvas } from './aero.js';

const cache = new Map();
function cached(key, build) {
  let c = cache.get(key);
  if (!c) {
    c = build();
    cache.set(key, c);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
  }
  return c;
}

function ellipse(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }
// [pixui30] the shared 'rounded rect' path is a STEPPED pixel path now (1-3 px notches, no arcs)
function rr(g, x, y, w, h, r) { pixelRectPath(g, x, y, w, h, r); }
export { rr as roundRectPath };

// ---------------------------------------------------------------- sun rays
export function drawRays(ctx, cx, cy, r, t = 0, alpha = 0.35, n = 14) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + t * 0.05 + hash1(i, 3) * 0.2;
    const w = 0.035 + hash1(i, 7) * 0.05;
    const len = r * (0.65 + hash1(i, 11) * 0.45);
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, len);
    gr.addColorStop(0, rgba('#ffffff', alpha));
    gr.addColorStop(1, rgba('#ffffff', 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - w) * len, cy + Math.sin(a - w) * len);
    ctx.lineTo(cx + Math.cos(a + w) * len, cy + Math.sin(a + w) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- glossy green globe (also the eco-orb look)
function globe(g, cx, cy, r, base = '#5ad43a', o = {}) {
  const light = mix(base, '#ffffff', 0.55), dark = shade(base, -0.45);
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  gr.addColorStop(0, light); gr.addColorStop(0.55, base); gr.addColorStop(1, dark);
  g.fillStyle = gr;
  ellipse(g, cx, cy, r, r); g.fill();
  if (o.land !== false && r >= 7) {
    // pale continents
    g.save();
    ellipse(g, cx, cy, r - 0.5, r - 0.5); g.clip();
    g.fillStyle = rgba(mix(base, '#ffffff', 0.75), 0.75);
    const seed = o.seed || 1;
    for (let i = 0; i < 4; i++) {
      const a = hash1(i, seed) * TAU, d = r * (0.2 + hash1(i, seed + 5) * 0.55);
      ellipse(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r * (0.22 + hash1(i, seed + 9) * 0.22), r * (0.14 + hash1(i, seed + 13) * 0.16), hash1(i, seed + 17) * 3);
      g.fill();
    }
    // meridians + parallels
    g.strokeStyle = rgba('#ffffff', 0.28);
    g.lineWidth = Math.max(0.6, r / 22);
    for (let k = -2; k <= 2; k++) { ellipse(g, cx, cy, Math.abs(k) * r * 0.33 + 0.01, r); g.stroke(); }
    for (let k = -2; k <= 2; k++) { g.beginPath(); const y = cy + k * r * 0.36; const hw = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2)); g.moveTo(cx - hw, y); g.lineTo(cx + hw, y); g.stroke(); }
    g.restore();
  }
  // bottom reflected light
  const rg = g.createRadialGradient(cx + r * 0.2, cy + r * 0.75, 0, cx + r * 0.2, cy + r * 0.75, r * 0.7);
  rg.addColorStop(0, rgba(mix(base, '#e8ffd0', 0.6), 0.55)); rg.addColorStop(1, rgba(base, 0));
  g.fillStyle = rg;
  ellipse(g, cx, cy, r, r); g.fill();
  // big glossy highlight
  const hg = g.createLinearGradient(cx, cy - r, cx, cy);
  hg.addColorStop(0, rgba('#ffffff', 0.95)); hg.addColorStop(1, rgba('#ffffff', 0.05));
  g.fillStyle = hg;
  ellipse(g, cx - r * 0.12, cy - r * 0.45, r * 0.7, r * 0.45, -0.25); g.fill();
  g.fillStyle = '#ffffff';
  ellipse(g, cx - r * 0.45, cy - r * 0.55, Math.max(0.8, r * 0.14), Math.max(0.6, r * 0.09), -0.6); g.fill();
  // rim
  g.strokeStyle = rgba(dark, 0.9);
  g.lineWidth = 1;
  ellipse(g, cx, cy, r - 0.5, r - 0.5); g.stroke();
}

// ---------------------------------------------------------------- eco orbs (tree nodes)
const LOCKED_ORB = '#a9c6dc';
// [pixui30] tree-node orbs are stepped pixel octagons (aero.js pixel orb), tinted per look
export function ecoOrb(r, color, look = 'done') {
  r = Math.max(3, Math.round(r * 2) / 2);
  return cached(`orb30|${r}|${color}|${look}`, () => {
    const pad = 3, S = Math.ceil(r * 2 + pad * 2), c = makeCanvas(S, S), g = ctxOf(c);
    const col = look === 'sun' ? '#ffe27a' : look === 'locked' ? mix(color, LOCKED_ORB, 0.45) : look === 'open' ? mix(color, '#ffffff', 0.28) : color;
    const o = pixelOrbCanvas(r, col);
    g.drawImage(o, Math.round((S - o.width) / 2), Math.round((S - o.height) / 2));
    return c;
  });
}
void globe;

// ---------------------------------------------------------------- glass tubes with flowing water
function pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function pointAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= l || i === pts.length - 1) { const k = l ? clamp01(d / l) : 0; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; }
    d -= l;
  }
  return pts[pts.length - 1];
}
function strokePath(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); }

export function drawTube(ctx, pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const w = o.width || 6, t = o.t || 0, water = o.water ?? 1, col = o.color || '#35c8ff', a = o.alpha ?? 1;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha *= a;
  // glass shell
  ctx.strokeStyle = rgba('#3f8fc4', water > 0 ? 0.55 : 0.35); ctx.lineWidth = w + 2; strokePath(ctx, pts);
  ctx.strokeStyle = rgba('#f4fdff', water > 0 ? 0.9 : 0.6); ctx.lineWidth = w; strokePath(ctx, pts);
  const L = pathLen(pts);
  if (water > 0) {
    // water core (partially filled when water < 1)
    const fillPts = water >= 1 ? pts : (() => { const out = [pts[0]]; let d = 0; const lim = L * water; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (d + l >= lim) { out.push(pointAt(pts, lim)); break; } d += l; out.push(pts[i]); } return out; })();
    if (fillPts.length >= 2) {
      ctx.strokeStyle = shade(col, -0.2); ctx.lineWidth = Math.max(1, w - 2); strokePath(ctx, fillPts);
      ctx.strokeStyle = mix(col, '#ffffff', 0.15); ctx.lineWidth = Math.max(1, w - 4); strokePath(ctx, fillPts);
    }
    // bubbles riding the flow
    const n = o.bubbles ?? Math.max(1, Math.floor(L / 26));
    const flow = o.flow ?? 26;
    for (let i = 0; i < n; i++) {
      const d = ((t * flow + (i / n) * L + hash1(i, 9) * 8) % L);
      if (d > L * water) continue;
      const [x, y] = pointAt(pts, d);
      const r = w > 6 ? 1.6 : 1.1;
      ctx.fillStyle = rgba('#ffffff', 0.95);
      const q = Math.round(r * 1.4); ctx.fillRect(Math.round(x + Math.sin(t * 6 + i) * 0.6 - q / 2), Math.round(y - q / 2), q, q); // [pixui30] square pixel bubble
    }
  }
  // glass highlight
  ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = 1;
  ctx.translate(-w * 0.22, -w * 0.22);
  strokePath(ctx, pts);
  ctx.restore();
}

// ---------------------------------------------------------------- splash
// [pixui30] a pixel droplet burst (square drops arcing out and falling; no expanding rings)
export function drawSplash(ctx, x, y, k, color = '#5fd8ff') {
  k = clamp01(k);
  ctx.save();
  ctx.globalAlpha *= 1 - k;
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI * (0.1 + 0.8 * (i / 9)), sp = 20 + hash1(i, 4) * 16;
    const px = x + Math.cos(a) * sp * k, py = y + Math.sin(a) * sp * k + 40 * k * k;
    const s = k < 0.5 ? 2 : 1;
    ctx.fillStyle = i % 2 ? '#ffffff' : color;
    ctx.fillRect(Math.round(px), Math.round(py), s, s);
  }
  ctx.restore();
}
