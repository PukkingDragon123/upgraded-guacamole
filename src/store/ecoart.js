// Eco Web 2.0 art (OWNER: Online & AppSea agent), after the user's reference wallpaper: saturated sky blue with a
// sun flare and white arcs, a curved grass horizon, glossy green leaves framing the corners, a green glass globe,
// water splashes and bubbles. Used by AppSea, the Multiplayer panel and the Bait panel. Everything static is
// rasterised once per size into a cached canvas (src/ui/aero.js aeroCached); only flare rays, bubbles and
// droplets are animated live.
//   ecoSky(ctx, x, y, w, h, t, {sun:[fx, fy] (0..1), arcs, clouds, grass /*px*/, globe /*radius*/})
//   leaf(ctx, x, y, len, angleDeg, {tone /*0..2*/})      one glossy leaf, base at (x, y)
//   leafSpray(ctx, x, y, corner /*'tl'|'tr'|'bl'|'br'*/, scale, t)   a sprig of leaves framing a corner
//   ecoGlobe(ctx, cx, cy, r, t)                         green glass globe emblem
//   splash(ctx, cx, cy, w, t, alpha)                    water-splash crown (behind buttons)
//   drawSplashButton(ctx, x, y, w, h, label, {hover, down, disabled, tone, icon, t})
//   splashButton(ui, ctx, x, y, w, h, label, {tone, icon, disabled, tip, sound, active}) -> clicked
//   ecoBubbles(ctx, x, y, w, h, t, n)                   rising soap bubbles (clipped by the caller)

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { hash1 } from '../core/math.js';
import { aeroCached, drawAeroButton, drawAeroBubble, drawAeroGlow, drawSparkle, drawSunFlare, pixelGradient, pixelOrbCanvas, pixelRectPath } from '../ui/aero.js';
import { pixelCloud } from '../gfx/pxsprites.js';

const TAU = Math.PI * 2;
const LEAF = [['#d8ff8a', '#7ed83a', '#2f9a1c', '#1d6312'], ['#e8ffa8', '#9ae84a', '#46b22a', '#22701a'], ['#c8f870', '#5cc832', '#24861a', '#165a10']];

// ---------------------------------------------------------------- leaves
function leafTex(len, ang, tone) {
  const pad = 3, R = len + pad * 2;
  const S = Math.ceil(R * 2);
  const c = makeCanvas(S, S), g = ctxOf(c);
  const cx = S / 2, cy = S / 2;
  const a = (ang * Math.PI) / 180, wid = len * 0.36;
  const P = LEAF[tone % LEAF.length];
  g.translate(cx, cy);
  g.rotate(a);
  const path = () => {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.25, -wid * 1.05, len * 0.72, -wid * 0.85, len, 0);
    g.bezierCurveTo(len * 0.72, wid * 0.85, len * 0.25, wid * 1.05, 0, 0);
    g.closePath();
  };
  path();
  const gr = g.createLinearGradient(0, -wid, 0, wid);
  gr.addColorStop(0, P[0]); gr.addColorStop(0.45, P[1]); gr.addColorStop(1, P[2]);
  g.fillStyle = gr; g.fill();
  g.strokeStyle = P[3]; g.lineWidth = 1; g.stroke();
  // gloss on the upper half
  g.save(); path(); g.clip();
  g.beginPath(); g.ellipse(len * 0.45, -wid * 0.45, len * 0.38, wid * 0.32, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
  g.restore();
  // midrib + veins
  g.strokeStyle = 'rgba(240,255,210,0.85)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(1, 0); g.quadraticCurveTo(len * 0.5, -1, len - 2, 0); g.stroke();
  g.strokeStyle = 'rgba(230,255,200,0.45)';
  for (let i = 1; i <= 3; i++) {
    const x = (len * i) / 4.4;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + len * 0.12, -wid * 0.55); g.stroke();
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + len * 0.12, wid * 0.55); g.stroke();
  }
  return { canvas: c, ox: cx, oy: cy };
}

export function leaf(ctx, x, y, len, ang, o = {}) {
  len = Math.max(6, Math.round(len));
  const q = Math.round(ang / 6) * 6;
  const tone = o.tone | 0;
  const L = aeroCached(`leaf|${len}|${q}|${tone}`, () => leafTex(len, q, tone));
  ctx.drawImage(L.canvas, Math.round(x - L.ox), Math.round(y - L.oy));
}

// A curved stem with leaves, pointing into the frame from a corner. Cached per corner/scale.
function sprayTex(corner, scale) {
  const S = Math.round(110 * scale);
  const c = makeCanvas(S, S), g = ctxOf(c);
  // build in 'tl' space, then mirror for other corners
  const fx = corner === 'tr' || corner === 'br', fy = corner === 'bl' || corner === 'br';
  g.translate(fx ? S : 0, fy ? S : 0);
  g.scale(fx ? -1 : 1, fy ? -1 : 1);
  const k = scale;
  const stem = [[2, 6], [28 * k, 14 * k], [58 * k, 30 * k], [86 * k, 40 * k]];
  g.strokeStyle = '#3c9a22'; g.lineWidth = Math.max(1.5, 2 * k);
  g.beginPath(); g.moveTo(stem[0][0], stem[0][1]); g.bezierCurveTo(stem[1][0], stem[1][1], stem[2][0], stem[2][1], stem[3][0], stem[3][1]); g.stroke();
  g.strokeStyle = 'rgba(220,255,170,0.7)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(stem[0][0], stem[0][1] - 1); g.bezierCurveTo(stem[1][0], stem[1][1] - 1, stem[2][0], stem[2][1] - 1, stem[3][0], stem[3][1] - 1); g.stroke();
  const leaves = [[0.08, 70, 30, 0], [0.22, -30, 34, 1], [0.38, 85, 32, 2], [0.52, -20, 30, 0], [0.66, 75, 26, 1], [0.8, -10, 24, 2], [0.95, 30, 20, 0], [0.3, 140, 22, 1]];
  const bz = (u, i) => (1 - u) ** 3 * stem[0][i] + 3 * (1 - u) ** 2 * u * stem[1][i] + 3 * (1 - u) * u * u * stem[2][i] + u ** 3 * stem[3][i];
  for (const [u, ang, len, tone] of leaves) {
    const L = leafTex(Math.round(len * k), ang, tone);
    // leafTex draws in screen orientation; mirror-compensate so leaves still read naturally
    g.drawImage(L.canvas, bz(u, 0) - L.ox, bz(u, 1) - L.oy);
  }
  return c;
}

export function leafSpray(ctx, x, y, corner = 'tl', scale = 1, t = 0) {
  const c = aeroCached(`spray|${corner}|${scale}`, () => sprayTex(corner, scale));
  const sway = Math.round(Math.sin(t * 1.3 + (corner === 'tr' ? 1 : corner === 'bl' ? 2 : 0)) * 0.6);
  const ox = corner === 'tr' || corner === 'br' ? -c.width : 0, oy = corner === 'bl' || corner === 'br' ? -c.height : 0;
  ctx.drawImage(c, Math.round(x + ox), Math.round(y + oy + sway));
}

// ---------------------------------------------------------------- globe
function globeTex(r) {
  const S = Math.ceil(r * 2) + 4, c0 = S / 2;
  const c = makeCanvas(S, S), g = ctxOf(c);
  g.save();
  g.beginPath(); g.arc(c0, c0, r, 0, TAU); g.clip();
  const body = g.createRadialGradient(c0 - r * 0.35, c0 - r * 0.4, r * 0.1, c0, c0, r);
  body.addColorStop(0, '#f4ffe0'); body.addColorStop(0.35, '#a8f05a'); body.addColorStop(0.8, '#3fae2a'); body.addColorStop(1, '#1d6312');
  g.fillStyle = body; g.fillRect(0, 0, S, S);
  // continents: pale glassy blobs
  g.fillStyle = 'rgba(236,255,220,0.7)';
  const blobs = [[0.15, -0.2, 0.42, 0.26, 0.3], [0.35, 0.25, 0.3, 0.2, -0.4], [-0.35, 0.35, 0.22, 0.14, 0.2], [-0.2, -0.45, 0.2, 0.1, 0]];
  for (const [bx, by, rx, ry, rot] of blobs) { g.beginPath(); g.ellipse(c0 + bx * r, c0 + by * r, rx * r, ry * r, rot, 0, TAU); g.fill(); }
  // grid
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
  for (let i = -2; i <= 2; i++) { g.beginPath(); g.ellipse(c0, c0, Math.abs(i) * r * 0.32 + 0.5, r, 0, 0, TAU); g.stroke(); }
  for (let i = -2; i <= 2; i++) { const yy = c0 + i * r * 0.36; const hw = Math.sqrt(Math.max(0, r * r - (yy - c0) ** 2)); g.beginPath(); g.moveTo(c0 - hw, yy); g.lineTo(c0 + hw, yy); g.stroke(); }
  // specular cap
  const sp = g.createRadialGradient(c0 - r * 0.35, c0 - r * 0.45, 0, c0 - r * 0.35, c0 - r * 0.45, r * 0.7);
  sp.addColorStop(0, 'rgba(255,255,255,0.95)'); sp.addColorStop(0.5, 'rgba(255,255,255,0.35)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp; g.fillRect(0, 0, S, S);
  // bottom bounce light
  const bl = g.createLinearGradient(0, c0 + r * 0.4, 0, c0 + r);
  bl.addColorStop(0, 'rgba(200,255,140,0)'); bl.addColorStop(1, 'rgba(220,255,170,0.6)');
  g.fillStyle = bl; g.fillRect(0, c0 + r * 0.4, S, r);
  g.restore();
  g.beginPath(); g.arc(c0, c0, r - 0.5, 0, TAU); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1; g.stroke();
  return c;
}

export function ecoGlobe(ctx, cx, cy, r, t = 0) {
  r = Math.max(4, Math.round(r));
  const c = pixelOrbCanvas(r, '#4cc83a'); // [pixui30] a stepped pixel orb instead of the round globe
  void globeTex;
  drawAeroGlow(ctx, cx, cy, r * 1.6, '#d8ffb0', 0.35);
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
  const ph = (t * 0.35) % 1;
  if (ph < 0.12) drawSparkle(ctx, cx - r * 0.45, cy - r * 0.5, r > 10 ? 3 : 2, 1 - ph * 6);
}

// ---------------------------------------------------------------- sky
// [pixui30] pixel sky: flat colour bands with checker-dithered seams, pixel clouds, a pixel sun and a stepped grass
// horizon (no arcs, no smooth gradients)
function skyTex(w, h, o) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  g.fillStyle = pixelGradient(g, 0, 0, 0, h, [[0, '#1a86dc'], [0.55, '#4cb8f6'], [1, '#bfeaff']], Math.max(3, Math.min(7, Math.round(h / 12))));
  g.fillRect(0, 0, w, h);
  const [sx, sy] = [o.sun[0] * w, o.sun[1] * h];
  if (o.clouds !== false) {
    for (let i = 0; i < 3; i++) {
      const cl = pixelCloud(Math.round(Math.min(60, w * 0.2) * (0.7 + hash1(i, 9) * 0.5)), i + 3);
      g.globalAlpha = 0.6; g.drawImage(cl, Math.round(hash1(i, 3) * w - cl.width / 2), Math.round(h * (0.1 + hash1(i, 7) * 0.3))); g.globalAlpha = 1;
    }
  }
  drawSunFlare(g, sx, sy, Math.max(8, Math.round(Math.min(w, h) * 0.22)), 0.9);
  if (o.grass) {
    const gy = h - o.grass;
    for (let x = 0; x < w; x++) {
      const u = x / Math.max(1, w - 1);
      const top = Math.round((1 - u) * (1 - u) * (gy + o.grass * 0.55) + 2 * (1 - u) * u * (gy - o.grass * 0.55) + u * u * (gy + o.grass * 0.2));
      g.fillStyle = '#e8ffb0'; g.fillRect(x, top, 1, 1);
      g.fillStyle = '#9ee64e'; g.fillRect(x, top + 1, 1, 2);
      g.fillStyle = '#6ccf34'; g.fillRect(x, top + 3, 1, 4);
      g.fillStyle = '#2e8e1c'; g.fillRect(x, top + 7, 1, Math.max(0, h - top - 7));
    }
  }
  return c;
}

export function ecoSky(ctx, x, y, w, h, t = 0, o = {}) {
  const opt = { sun: o.sun || [0.3, 0.25], arcs: o.arcs, clouds: o.clouds, grass: o.grass || 0 };
  w = Math.round(w); h = Math.round(h);
  const c = aeroCached(`sky|${w}|${h}|${opt.sun}|${opt.arcs}|${opt.clouds}|${opt.grass}`, () => skyTex(w, h, opt));
  ctx.drawImage(c, Math.round(x), Math.round(y));
  // [polish17] a gentle sun twinkle only: no turning ray fan, no lens-flare ghosts
  const sx = x + opt.sun[0] * w, sy = y + opt.sun[1] * h;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  drawSparkle(ctx, sx, sy, 3, 0.75 + 0.2 * Math.sin(t * 1.3));
  if (o.globe) ecoGlobe(ctx, x + w - o.globe - 10, y + h * 0.48, o.globe, t);
  ctx.restore();
}

export function ecoBubbles(ctx, x, y, w, h, t, n = 8) {
  for (let i = 0; i < n; i++) {
    const sp = 6 + hash1(i, 4) * 10;
    const bx = x + hash1(i, 1) * w + Math.sin(t * 1.4 + i) * 3;
    const by = y + h - ((t * sp + hash1(i, 6) * h) % (h + 10)) + 5;
    ctx.fillStyle = 'rgba(232,250,255,0.75)'; ctx.fillRect(Math.round(bx), Math.round(by), 2, 2); // [pixui30] square pixel bubbles
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(bx), Math.round(by), 1, 1);
  }
}

// ---------------------------------------------------------------- splashes
function splashTex(w, f) {
  const h = Math.round(w * 0.3) + 6, W2 = w + 16, c = makeCanvas(W2, h + 6), g = ctxOf(c);
  const cx = W2 / 2, base = h;
  const ph = (f / 6) * TAU;
  // two curling water sheets flaring out from under the ends (the middle hides behind the button)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const u = 0.86 + i * 0.07;
      const x = cx + side * u * w * 0.5;
      const hh = h * (0.45 + 0.55 * (i / 4)) * (0.88 + 0.12 * Math.sin(ph + i * 1.9 + side));
      const tipX = x + side * (4 + i * 2.2);
      const gr = g.createLinearGradient(0, base - hh, 0, base);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(150,226,252,0.88)'); gr.addColorStop(1, 'rgba(28,160,228,0.75)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x - side * 5, base);
      g.quadraticCurveTo(x - side * 1, base - hh * 0.7, tipX, base - hh);
      g.quadraticCurveTo(x + side * 3, base - hh * 0.45, x + side * 4, base);
      g.closePath(); g.fill();
    }
  }
  // droplets thrown up and out
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const p = (hash1(i, 5) + f / 6) % 1;
    const dx = cx + side * (w * 0.42 + p * w * 0.12 + hash1(i, 3) * 6), dy = base - h * (0.5 + 0.6 * Math.sin(p * Math.PI)) - hash1(i, 9) * 3;
    g.fillStyle = 'rgba(240,253,255,0.95)';
    g.beginPath(); g.arc(dx, dy, 0.8 + hash1(i, 7) * 1.2, 0, TAU); g.fill();
    g.fillStyle = 'rgba(80,190,240,0.6)';
    g.fillRect(Math.round(dx), Math.round(dy + 1), 1, 1);
  }
  // foam rim
  const fr = g.createLinearGradient(0, base - 2, 0, base + 3);
  fr.addColorStop(0, 'rgba(255,255,255,0.95)'); fr.addColorStop(1, 'rgba(160,225,250,0.4)');
  g.fillStyle = fr;
  g.beginPath(); g.ellipse(cx, base, w * 0.56, 3, 0, 0, TAU); g.fill();
  return c;
}

export function splash(ctx, cx, cy, w, t = 0, alpha = 1) {
  w = Math.max(16, Math.round(w / 4) * 4);
  const f = Math.floor(t * 6) % 6;
  const c = aeroCached(`splash|${w}|${f}`, () => splashTex(w, f));
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * alpha;
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height + 6));
  ctx.globalAlpha = ga;
}

// A glossy pill riding on a water splash (draw only; o: {hover, down, disabled, tone, icon, active, t}).
export function drawSplashButton(ctx, x, y, w, h, label, o = {}) {
  const t = o.t || 0, hov = !!o.hover && !o.disabled;
  // [pixui30] (no curved water splash under the pixel button)
  drawAeroButton(ctx, x, y + (o.down ? 1 : 0), w, h, { label, icon: o.icon || null, tone: o.disabled ? 'grey' : o.tone || 'aqua', state: o.disabled ? 'disabled' : o.down ? 'down' : hov || o.active ? 'hover' : 'normal' });
  if (hov) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(x + 6 + ((i * 29 + t * 18) % Math.max(1, w - 12))), Math.round(y - 3 - ((t * 14 + i * 7) % 8)), 2, 2); }
}

// Immediate-mode version for panels. Returns true when clicked.
export function splashButton(ui, ctx, x, y, w, h, label, o = {}) {
  const r = { x, y, w, h };
  const hov = !o.disabled && ui.hover(r);
  drawSplashButton(ctx, x, y, w, h, label, { ...o, hover: hov, down: hov && ui.inp?.down, t: ui.time || 0 });
  if (hov && o.tip) ui.tip = o.tip;
  if (!o.disabled && ui.clicked(r)) { ui.game?.audio?.play(o.sound || 'ui_click'); return true; }
  if (o.disabled && ui.hover(r) && ui.inp?.pressed) { ui.inp.pressed = false; ui.game?.audio?.play('ui_error'); }
  return false;
}

// Eco header strip for glass panels: rounded sky band with sun flare, arcs and a grass rim, plus leaf sprigs
// overhanging the panel's top-right and bottom-left corners (draw before the panel's cards so they tuck under).
export function ecoBand(ctx, x, y, w, h, t, o = {}) {
  ctx.save();
  const r = o.r ?? 9;
  pixelRectPath(ctx, Math.round(x), Math.round(y), Math.round(w), Math.round(h), r); // [pixui30] stepped clip
  ctx.clip();
  ecoSky(ctx, x, y, w, h, t, { sun: o.sun || [0.62, 0.2], clouds: false, grass: o.grass ?? 7 });
  ecoBubbles(ctx, x, y, w, h, t, 6);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(Math.round(x + r), Math.round(y), Math.round(w - r * 2), 1);
}

export function ecoCorners(ctx, x, y, w, h, t, scale = 0.6) {
  leafSpray(ctx, x + w + 16, y - 16, 'tr', scale, t);
  leafSpray(ctx, x - 16, y + h + 16, 'bl', scale * 0.85, t);
}
