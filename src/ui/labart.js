// The Lab's procedural Frutiger Aero art (OWNER: Lab agent). Everything static is rasterised once and cached.
//   ecoScene(w, h) -> canvas      window view: deep blue sky, sun + rays, white arcs, clouds, a curved grass horizon,
//                                 a glass city in a water bubble, a glossy green glass globe, a tree, a water splash
//   ecoOrb(r, color, look) -> canvas   glossy eco globe for tree nodes (look: 'done'|'open'|'locked'|'sun')
//   leafSprig(len, seed, flip) -> {canvas, ox, oy}   glossy green leaves on a twig, anchored at the stem (ox, oy)
//   labRoom(w, h, win) -> canvas  white/aqua glossy lab interior with the window cut at win {x, y, w, h}
//   drawTube(ctx, pts, o)          glass tube along a polyline with flowing water + bubbles
//                                  o: {t, water 0..1, color, width, flow (px/s), bubbles, alpha}
//   drawFlask(ctx, x, by, o)       bubbling Erlenmeyer flask standing at (x, by). o: {t, level, color, w, h, glow}
//   drawSplash(ctx, x, y, k, color) water splash ring + droplets (k 0..1 = age)
//   drawRays(ctx, cx, cy, r, t, alpha, n)  slowly turning sun rays
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { mix, shade, rgba } from '../core/color.js';
import { TAU, hash1, clamp01 } from '../core/math.js';

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
function rr(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
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

// ---------------------------------------------------------------- the 8.jpg-like window view
export function ecoScene(w, h) {
  w = Math.round(w); h = Math.round(h);
  return cached(`scene|${w}|${h}`, () => {
    const c = makeCanvas(w, h), g = ctxOf(c);
    // sky
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0f5fd8'); sky.addColorStop(0.45, '#3aa2f4'); sky.addColorStop(0.75, '#a8e2ff'); sky.addColorStop(1, '#e8fbff');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const sx = w * 0.36, sy = h * 0.42;
    // white arcs (latitude lines in the sky)
    g.strokeStyle = rgba('#ffffff', 0.5);
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(w * 0.62, h * 1.05, w * (0.42 + i * 0.07), h * (0.62 + i * 0.07), 0, Math.PI * 1.08, Math.PI * 1.62); g.stroke(); }
    // sun glow + rays
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.8);
    sg.addColorStop(0, rgba('#ffffff', 1)); sg.addColorStop(0.12, rgba('#ffffff', 0.85)); sg.addColorStop(0.4, rgba('#dff6ff', 0.3)); sg.addColorStop(1, rgba('#bfeaff', 0));
    g.fillStyle = sg; g.fillRect(0, 0, w, h);
    drawRays(g, sx, sy, Math.max(w, h) * 0.9, 0, 0.32, 22);
    // clouds
    const cloud = (x, y, s) => {
      g.fillStyle = rgba('#ffffff', 0.9);
      for (let i = 0; i < 5; i++) { ellipse(g, x + (i - 2) * s * 0.7, y + Math.abs(i - 2) * s * 0.18, s * (0.7 - Math.abs(i - 2) * 0.12), s * 0.42); g.fill(); }
      g.fillStyle = rgba('#d8eefc', 0.6);
      ellipse(g, x, y + s * 0.3, s * 1.6, s * 0.18); g.fill();
    };
    cloud(w * 0.12, h * 0.16, h * 0.07); cloud(w * 0.2, h * 0.28, h * 0.045); cloud(w * 0.86, h * 0.12, h * 0.05); cloud(w * 0.58, h * 0.22, h * 0.035);
    // curved grass horizon (a planet)
    const gy = h * 0.66, R = w * 1.6;
    const gcx = w * 0.32, gcy = gy + R;
    const grass = g.createLinearGradient(0, gy - 4, 0, h);
    grass.addColorStop(0, '#b8f25a'); grass.addColorStop(0.18, '#6fd236'); grass.addColorStop(0.7, '#36a51f'); grass.addColorStop(1, '#1f7f16');
    g.fillStyle = grass;
    ellipse(g, gcx, gcy, R, R); g.fill();
    g.strokeStyle = rgba('#e8ffb0', 0.9); g.lineWidth = 1;
    g.beginPath(); g.arc(gcx, gcy, R - 0.5, -Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4); g.stroke();
    // grass blades texture
    g.save(); ellipse(g, gcx, gcy, R, R); g.clip();
    for (let i = 0; i < w * 1.4; i++) {
      const x = hash1(i, 21) * w, y = gy + hash1(i, 22) * (h - gy);
      g.fillStyle = hash1(i, 23) > 0.5 ? rgba('#c8ff7a', 0.35) : rgba('#1f7a14', 0.3);
      g.fillRect(Math.round(x), Math.round(y), 1, 2);
    }
    // path
    g.strokeStyle = rgba('#d8f8a0', 0.55); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(w * 0.27, gy + 2); g.quadraticCurveTo(w * 0.22, h * 0.82, w * 0.3, h); g.stroke();
    g.restore();
    const groundY = (x) => gcy - Math.sqrt(Math.max(0, R * R - (x - gcx) ** 2));
    // glass city in a water bubble (left)
    const bx = w * 0.16, by = groundY(w * 0.16) - h * 0.1, br = h * 0.22;
    g.save();
    ellipse(g, bx, by, br, br); g.clip();
    const bub = g.createRadialGradient(bx - br * 0.3, by - br * 0.3, 1, bx, by, br);
    bub.addColorStop(0, rgba('#ffffff', 0.35)); bub.addColorStop(1, rgba('#7fd8ff', 0.25));
    g.fillStyle = bub; g.fillRect(bx - br, by - br, br * 2, br * 2);
    const towers = [[-0.75, 0.55, 0.22], [-0.5, 0.95, 0.2], [-0.25, 0.7, 0.18], [0.0, 1.2, 0.2], [0.22, 0.8, 0.16], [0.42, 1.0, 0.18], [0.65, 0.6, 0.18]];
    for (const [ox, hh, ww] of towers) {
      const tx = bx + ox * br, tw = ww * br, th = hh * br, ty = by + br * 0.55 - th;
      const tg = g.createLinearGradient(tx, 0, tx + tw, 0);
      tg.addColorStop(0, '#3a6a9a'); tg.addColorStop(0.45, '#9fd2f2'); tg.addColorStop(1, '#2a4a72');
      g.fillStyle = tg; g.fillRect(Math.round(tx), Math.round(ty), Math.max(2, Math.round(tw)), Math.round(th + br));
      g.fillStyle = rgba('#e8fbff', 0.55);
      for (let yy = ty + 2; yy < by + br * 0.5; yy += 3) g.fillRect(Math.round(tx + 1), Math.round(yy), Math.max(1, Math.round(tw) - 2), 1);
    }
    g.fillStyle = '#5cc832'; ellipse(g, bx, by + br * 0.85, br * 1.1, br * 0.35); g.fill();
    g.restore();
    // bubble glass + splash ring
    g.strokeStyle = rgba('#ffffff', 0.85); g.lineWidth = 1.2;
    ellipse(g, bx, by, br, br); g.stroke();
    g.fillStyle = rgba('#ffffff', 0.7);
    ellipse(g, bx - br * 0.45, by - br * 0.5, br * 0.28, br * 0.12, -0.7); g.fill();
    g.strokeStyle = rgba('#e8fbff', 0.8); g.lineWidth = 1;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(bx, by, br + 1.5 + i * 1.6, Math.PI * (0.55 + i * 0.12), Math.PI * (1.25 + i * 0.1)); g.stroke(); }
    // tree on the horizon
    const tx = w * 0.53, ty = groundY(w * 0.53);
    g.fillStyle = '#6a4a2a'; g.fillRect(Math.round(tx - 1), Math.round(ty - h * 0.07), 2, Math.round(h * 0.07));
    for (const [ox, oy, s, col] of [[0, -0.1, 0.06, '#3aa52a'], [-0.03, -0.085, 0.045, '#4fc032'], [0.03, -0.08, 0.045, '#2e8f22'], [0.0, -0.13, 0.04, '#7ed957']]) { g.fillStyle = col; ellipse(g, tx + ox * h, ty + oy * h, s * h, s * h * 0.9); g.fill(); }
    // green glass globe (right) with a water splash
    const gx = w * 0.8, gyy = h * 0.4, gr = h * 0.25;
    globe(g, gx, gyy, gr, '#58d038', { seed: 4 });
    g.strokeStyle = rgba('#ffffff', 0.8); g.lineWidth = 1;
    for (let i = 0; i < 5; i++) { const a = Math.PI * (0.15 + i * 0.12); g.beginPath(); g.moveTo(gx + Math.cos(a) * gr * 0.9, gyy + Math.sin(a) * gr * 0.9); g.quadraticCurveTo(gx + Math.cos(a) * gr * 1.35, gyy + Math.sin(a) * gr * 1.2, gx + Math.cos(a + 0.2) * gr * 1.55, gyy + Math.sin(a + 0.2) * gr * 1.45); g.stroke(); }
    for (let i = 0; i < 14; i++) { const a = Math.PI * (0.1 + hash1(i, 40) * 0.7), d = gr * (1.05 + hash1(i, 41) * 0.5); g.fillStyle = rgba('#ffffff', 0.85); ellipse(g, gx + Math.cos(a) * d, gyy + Math.sin(a) * d, 0.9, 0.9); g.fill(); }
    // water pool at the bottom
    const wy = h * 0.88;
    const wg = g.createLinearGradient(0, wy, 0, h);
    wg.addColorStop(0, '#9ff0ff'); wg.addColorStop(0.4, '#3fc4f0'); wg.addColorStop(1, '#1688d0');
    g.fillStyle = wg;
    g.beginPath(); g.moveTo(w * 0.35, h); g.quadraticCurveTo(w * 0.55, wy - h * 0.05, w * 0.98, wy + h * 0.02); g.lineTo(w, h); g.closePath(); g.fill();
    g.strokeStyle = rgba('#ffffff', 0.9); g.lineWidth = 1;
    g.beginPath(); g.moveTo(w * 0.4, h - 1); g.quadraticCurveTo(w * 0.58, wy - h * 0.03, w * 0.96, wy + h * 0.03); g.stroke();
    // lens flare dots
    for (const [k, s, a] of [[0.35, 3, 0.35], [0.6, 2, 0.3], [0.85, 4, 0.2]]) { g.fillStyle = rgba('#ffffff', a); ellipse(g, sx + (w * 0.85 - sx) * k, sy + (h * 0.8 - sy) * k, s, s); g.fill(); }
    return c;
  });
}

// ---------------------------------------------------------------- eco orbs (tree nodes)
const LOCKED_ORB = '#a9c6dc';
export function ecoOrb(r, color, look = 'done') {
  r = Math.max(3, Math.round(r * 2) / 2);
  return cached(`orb|${r}|${color}|${look}`, () => {
    const pad = 3, S = Math.ceil(r * 2 + pad * 2), c = makeCanvas(S, S), g = ctxOf(c), cx = S / 2, cy = S / 2;
    if (look === 'sun') {
      const sg = g.createRadialGradient(cx, cy, 0, cx, cy, r + pad);
      sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.5, '#fff8c8'); sg.addColorStop(0.8, '#ffd84a'); sg.addColorStop(1, rgba('#ffd84a', 0));
      g.fillStyle = sg; g.fillRect(0, 0, S, S);
      globe(g, cx, cy, r, '#ffe27a', { land: false });
      return c;
    }
    if (look === 'locked') {
      // frosted glass with a pastel hint of the branch colour
      const pale = mix(color, '#ffffff', 0.62);
      const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, 1, cx, cy, r);
      gr.addColorStop(0, rgba('#ffffff', 0.9)); gr.addColorStop(0.6, rgba(pale, 0.85)); gr.addColorStop(1, rgba(mix(pale, LOCKED_ORB, 0.5), 0.9));
      g.fillStyle = gr; ellipse(g, cx, cy, r, r); g.fill();
      g.strokeStyle = rgba('#6f93b0', 0.9); g.lineWidth = 1; ellipse(g, cx, cy, r - 0.5, r - 0.5); g.stroke();
      g.fillStyle = rgba('#ffffff', 0.9); ellipse(g, cx - r * 0.1, cy - r * 0.5, r * 0.6, r * 0.32, -0.25); g.fill();
      return c;
    }
    const base = look === 'open' ? mix(color, '#ffffff', 0.28) : color;
    globe(g, cx, cy, r, base, { seed: Math.round(r * 7 + color.length) });
    return c;
  });
}

// ---------------------------------------------------------------- glossy leaves
function leaf(g, x, y, len, wid, ang, o = {}) {
  g.save();
  g.translate(x, y); g.rotate(ang);
  const path = () => { g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.4, -wid, len, 0); g.quadraticCurveTo(len * 0.4, wid, 0, 0); g.closePath(); };
  const gr = g.createLinearGradient(0, -wid, 0, wid);
  gr.addColorStop(0, o.light || '#d8ff7a'); gr.addColorStop(0.45, o.mid || '#7edc34'); gr.addColorStop(1, o.dark || '#2f9a1e');
  path(); g.fillStyle = gr; g.fill();
  g.strokeStyle = o.edge || '#1d6a14'; g.lineWidth = 1; g.stroke();
  // vein
  g.strokeStyle = rgba('#efffc8', 0.85); g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(1, 0); g.quadraticCurveTo(len * 0.5, -wid * 0.08, len * 0.92, 0); g.stroke();
  g.strokeStyle = rgba('#efffc8', 0.45); g.lineWidth = 0.7;
  for (let i = 1; i < 4; i++) { const px = len * i * 0.22; g.beginPath(); g.moveTo(px, 0); g.lineTo(px + len * 0.12, -wid * 0.45); g.moveTo(px, 0); g.lineTo(px + len * 0.12, wid * 0.45); g.stroke(); }
  // gloss
  g.strokeStyle = rgba('#ffffff', 0.85); g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(len * 0.18, -wid * 0.42); g.quadraticCurveTo(len * 0.45, -wid * 0.78, len * 0.75, -wid * 0.38); g.stroke();
  g.restore();
}

// A twig with glossy leaves growing from the stem point (0,0) along +x (flip mirrors to -x).
export function leafSprig(len = 90, seed = 1, flip = false, bend = 0.4) {
  len = Math.round(len);
  return cached(`sprig|${len}|${seed}|${flip}|${bend}`, () => {
    const W = Math.round(len * 1.25), H = Math.round(len * 0.9), c = makeCanvas(W, H), g = ctxOf(c);
    const ox = flip ? W - 6 : 6, oy = Math.round(H * 0.5), dir = flip ? -1 : 1;
    const pt = (k) => [ox + dir * len * k, oy - Math.sin(k * Math.PI * 0.9) * len * bend * 0.35 + k * k * len * 0.12];
    g.strokeStyle = '#3f8a22'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); for (let i = 0; i <= 20; i++) { const [x, y] = pt(i / 20); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
    g.strokeStyle = rgba('#c8f58a', 0.8); g.lineWidth = 0.8; g.stroke();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = 0.12 + (i / n) * 0.86;
      const [x, y] = pt(k);
      const side = i % 2 ? 1 : -1;
      const s = (1 - k * 0.45) * len * 0.36 * (0.85 + hash1(i, seed) * 0.3);
      const a = (flip ? Math.PI : 0) + dir * side * (0.65 + hash1(i, seed + 3) * 0.4) - dir * 0.15;
      leaf(g, x, y, s, s * 0.38, a);
    }
    leaf(g, ...pt(1), len * 0.3, len * 0.12, flip ? Math.PI + 0.1 : -0.1);
    return { canvas: c, ox, oy };
  });
}

// ---------------------------------------------------------------- lab interior
export function labRoom(w, h, win) {
  w = Math.round(w); h = Math.round(h);
  return cached(`room|${w}|${h}|${win ? [win.x, win.y, win.w, win.h].join(',') : ''}`, () => {
    const c = makeCanvas(w, h), g = ctxOf(c);
    const floorY = Math.round(h * 0.86);
    // walls: glossy white to pale aqua
    const wall = g.createLinearGradient(0, 0, 0, floorY);
    wall.addColorStop(0, '#ffffff'); wall.addColorStop(0.55, '#effbff'); wall.addColorStop(1, '#cdeffa');
    g.fillStyle = wall; g.fillRect(0, 0, w, floorY);
    // soft vertical panels
    for (let x = 0; x < w; x += 56) {
      g.fillStyle = rgba('#ffffff', 0.7); g.fillRect(x, 0, 1, floorY);
      g.fillStyle = rgba('#a8dcf0', 0.25); g.fillRect(x + 1, 0, 1, floorY);
    }
    // aqua tiles wainscot
    const ty = Math.round(h * 0.62);
    const tg = g.createLinearGradient(0, ty, 0, floorY);
    tg.addColorStop(0, '#bff0ff'); tg.addColorStop(1, '#7fd6f2');
    g.fillStyle = tg; g.fillRect(0, ty, w, floorY - ty);
    g.fillStyle = rgba('#ffffff', 0.55);
    for (let y = ty; y < floorY; y += 10) g.fillRect(0, y, w, 1);
    for (let y = ty, row = 0; y < floorY; y += 10, row++) for (let x = (row % 2) * 10; x < w; x += 20) g.fillRect(x, y, 1, 10);
    g.fillStyle = rgba('#ffffff', 0.35);
    for (let y = ty + 1; y < floorY; y += 10) g.fillRect(0, y, w, 3);
    // chrome rail
    g.fillStyle = '#ffffff'; g.fillRect(0, ty - 4, w, 2);
    g.fillStyle = '#9fd8ee'; g.fillRect(0, ty - 2, w, 2);
    g.fillStyle = '#4fb4dc'; g.fillRect(0, ty, w, 1);
    // floor: glossy, reflective
    const fg = g.createLinearGradient(0, floorY, 0, h);
    fg.addColorStop(0, '#e8fbff'); fg.addColorStop(0.3, '#b8e8f8'); fg.addColorStop(1, '#8fd2ee');
    g.fillStyle = fg; g.fillRect(0, floorY, w, h - floorY);
    g.fillStyle = rgba('#ffffff', 0.8); g.fillRect(0, floorY, w, 1);
    g.fillStyle = rgba('#ffffff', 0.25);
    for (let i = 0; i < 6; i++) g.fillRect(Math.round(w * (0.1 + i * 0.16)), floorY + 3, Math.round(w * 0.08), 1);
    // ceiling light strip
    const cg = g.createLinearGradient(0, 0, 0, 12);
    cg.addColorStop(0, '#d8f4ff'); cg.addColorStop(1, rgba('#ffffff', 0));
    g.fillStyle = cg; g.fillRect(0, 0, w, 12);
    if (win) {
      // window frame (glossy white with an aqua inner edge) and the view
      const { x, y, w: ww, h: wh } = win;
      g.fillStyle = rgba('#5aa8cc', 0.3); rr(g, x - 5, y - 4, ww + 10, wh + 11, 9); g.fill();
      const frame = g.createLinearGradient(0, y - 5, 0, y + wh + 5);
      frame.addColorStop(0, '#ffffff'); frame.addColorStop(1, '#cfeaf6');
      g.fillStyle = frame; rr(g, x - 5, y - 5, ww + 10, wh + 10, 9); g.fill();
      g.strokeStyle = '#7fb8d6'; g.lineWidth = 1; rr(g, x - 4.5, y - 4.5, ww + 9, wh + 9, 9); g.stroke();
      g.save(); rr(g, x, y, ww, wh, 6); g.clip();
      g.drawImage(ecoScene(ww, wh), x, y);
      // glass reflections
      g.fillStyle = rgba('#ffffff', 0.18);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + ww * 0.35, y); g.lineTo(x, y + wh * 0.55); g.closePath(); g.fill();
      g.fillStyle = rgba('#ffffff', 0.12);
      g.beginPath(); g.moveTo(x + ww * 0.55, y); g.lineTo(x + ww * 0.68, y); g.lineTo(x + ww * 0.2, y + wh); g.lineTo(x + ww * 0.07, y + wh); g.closePath(); g.fill();
      g.restore();
      g.strokeStyle = '#4fa8d4'; g.lineWidth = 1; rr(g, x - 0.5, y - 0.5, ww + 1, wh + 1, 6); g.stroke();
      // mullion
      g.fillStyle = '#f4fbff'; g.fillRect(Math.round(x + ww / 2 - 1), y, 3, wh);
      g.fillStyle = '#9fd0e6'; g.fillRect(Math.round(x + ww / 2 + 1), y, 1, wh);
      // sill
      g.fillStyle = '#ffffff'; rr(g, x - 9, y + wh + 3, ww + 18, 5, 2); g.fill();
      g.fillStyle = '#a8d8ec'; g.fillRect(x - 8, y + wh + 7, ww + 16, 1);
      // sunlight falling into the room
      g.save();
      g.globalCompositeOperation = 'lighter';
      const lg = g.createLinearGradient(x, y, x + ww * 1.4, y + wh * 2.4);
      lg.addColorStop(0, rgba('#fffbe0', 0.28)); lg.addColorStop(1, rgba('#fffbe0', 0));
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(x + ww * 0.1, y + wh); g.lineTo(x + ww * 0.95, y + wh); g.lineTo(x + ww * 2.1, h); g.lineTo(x + ww * 0.6, h); g.closePath(); g.fill();
      g.restore();
    }
    return c;
  });
}

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
      ctx.strokeStyle = shade(col, -0.15); ctx.lineWidth = Math.max(1, w - 2); strokePath(ctx, fillPts);
      ctx.strokeStyle = mix(col, '#ffffff', 0.35); ctx.lineWidth = Math.max(1, w - 4); strokePath(ctx, fillPts);
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
      ctx.beginPath(); ctx.arc(x + Math.sin(t * 6 + i) * 0.6, y, r, 0, TAU); ctx.fill();
    }
  }
  // glass highlight
  ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = 1;
  ctx.translate(-w * 0.22, -w * 0.22);
  strokePath(ctx, pts);
  ctx.restore();
}

// ---------------------------------------------------------------- flask
export function drawFlask(ctx, x, by, o = {}) {
  const t = o.t || 0, w = o.w || 22, h = o.h || 28, level = clamp01(o.level ?? 0.6), col = o.color || '#35c8ff';
  const neck = Math.max(4, Math.round(w * 0.3)), nh = Math.round(h * 0.32);
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x - neck / 2, by - h); ctx.lineTo(x - neck / 2, by - h + nh);
    ctx.lineTo(x - w / 2, by - 3); ctx.quadraticCurveTo(x - w / 2, by, x - w / 2 + 3, by);
    ctx.lineTo(x + w / 2 - 3, by); ctx.quadraticCurveTo(x + w / 2, by, x + w / 2, by - 3);
    ctx.lineTo(x + neck / 2, by - h + nh); ctx.lineTo(x + neck / 2, by - h); ctx.closePath();
  };
  ctx.save();
  if (o.glow) {
    const gg = ctx.createRadialGradient(x, by - h * 0.35, 1, x, by - h * 0.35, w * 1.2);
    gg.addColorStop(0, rgba(col, 0.45 * o.glow)); gg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gg; ctx.fillRect(x - w * 1.3, by - h * 1.4, w * 2.6, h * 1.6);
  }
  path(); ctx.fillStyle = rgba('#effbff', 0.55); ctx.fill();
  ctx.save(); path(); ctx.clip();
  const ly = by - (h - 2) * level;
  const wobble = Math.sin(t * 3) * 0.8;
  const lg = ctx.createLinearGradient(0, ly, 0, by);
  lg.addColorStop(0, mix(col, '#ffffff', 0.45)); lg.addColorStop(1, shade(col, -0.2));
  ctx.fillStyle = lg;
  ctx.beginPath(); ctx.moveTo(x - w, ly + wobble); ctx.quadraticCurveTo(x, ly - wobble, x + w, ly + wobble); ctx.lineTo(x + w, by + 1); ctx.lineTo(x - w, by + 1); ctx.closePath(); ctx.fill();
  // bubbles
  for (let i = 0; i < 5; i++) {
    const k = ((t * (0.5 + hash1(i, 2) * 0.5) + hash1(i, 5)) % 1);
    const yy = by - 2 - k * (by - ly - 2);
    const xx = x + (hash1(i, 8) - 0.5) * w * 0.55 * (1 - k * 0.5) + Math.sin(t * 5 + i) * 0.8;
    ctx.fillStyle = rgba('#ffffff', 0.9 * (1 - k * 0.4));
    ctx.beginPath(); ctx.arc(xx, yy, 0.8 + hash1(i, 3) * 0.9, 0, TAU); ctx.fill();
  }
  ctx.restore();
  path(); ctx.strokeStyle = '#4f9cc4'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = rgba('#ffffff', 0.85);
  ctx.fillRect(Math.round(x - w / 2 + 3), Math.round(by - h * 0.45), 1, Math.round(h * 0.3));
  ctx.fillRect(Math.round(x - neck / 2 + 1), Math.round(by - h + 1), 1, nh - 2);
  // rim
  ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x - neck / 2 - 1), Math.round(by - h - 1), neck + 2, 2);
  ctx.restore();
  // steam bubbles out of the top
  if (o.active) {
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.7 + i / 3) % 1;
      ctx.fillStyle = rgba('#ffffff', 0.8 * (1 - k));
      ctx.beginPath(); ctx.arc(x + Math.sin(t * 2 + i * 2) * 3 * k, by - h - 3 - k * 14, 1 + k * 1.5, 0, TAU); ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- splash
export function drawSplash(ctx, x, y, k, color = '#5fd8ff') {
  k = clamp01(k);
  ctx.save();
  ctx.globalAlpha *= 1 - k;
  ctx.strokeStyle = rgba('#ffffff', 0.95); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(x, y, 4 + k * 22, 2 + k * 9, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.8); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(x, y, 2 + k * 15, 1 + k * 6, 0, 0, TAU); ctx.stroke();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI * (0.1 + 0.8 * (i / 9)), sp = 20 + hash1(i, 4) * 16;
    const px = x + Math.cos(a) * sp * k, py = y + Math.sin(a) * sp * k + 40 * k * k;
    ctx.fillStyle = i % 2 ? '#ffffff' : color;
    ctx.beginPath(); ctx.arc(px, py, 1.6 * (1 - k * 0.5), 0, TAU); ctx.fill();
  }
  ctx.restore();
}
