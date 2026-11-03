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
import { aeroCached, drawAeroButton, drawAeroBubble, drawAeroGlow, drawSparkle } from '../ui/aero.js';

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
  const c = aeroCached(`globe|${r}`, () => globeTex(r));
  drawAeroGlow(ctx, cx, cy, r * 1.6, '#d8ffb0', 0.35);
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
  const ph = (t * 0.35) % 1;
  if (ph < 0.12) drawSparkle(ctx, cx - r * 0.45, cy - r * 0.5, r > 10 ? 3 : 2, 1 - ph * 6);
}

// ---------------------------------------------------------------- sky
function skyTex(w, h, o) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#1a86dc'); gr.addColorStop(0.55, '#4cb8f6'); gr.addColorStop(1, '#bfeaff');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const [sx, sy] = [o.sun[0] * w, o.sun[1] * h];
  // white arcs fanning from behind the sun
  if (o.arcs !== false) {
    g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const rr = h * 0.9 + i * Math.max(4, h * 0.09);
      g.beginPath(); g.arc(sx + w * 0.18, sy + rr * 0.95, rr, Math.PI * 1.08, Math.PI * 1.62); g.stroke();
    }
  }
  // clouds
  if (o.clouds !== false) {
    for (let i = 0; i < 5; i++) {
      const cx = hash1(i, 3) * w, cy = h * (0.12 + hash1(i, 7) * 0.4), s = 6 + hash1(i, 9) * h * 0.18;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + (k - 1.5) * s * 0.7, cy + Math.sin(k * 2.1) * s * 0.15, s * 0.6, s * 0.35, 0, 0, TAU); g.fill(); }
    }
  }
  // sun bloom
  const sg = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h) * 0.45);
  sg.addColorStop(0, 'rgba(255,255,255,1)'); sg.addColorStop(0.12, 'rgba(255,255,240,0.85)'); sg.addColorStop(0.4, 'rgba(255,255,255,0.25)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sg; g.fillRect(0, 0, w, h);
  // curved grass horizon
  if (o.grass) {
    const gy = h - o.grass;
    g.beginPath();
    g.moveTo(0, gy + o.grass * 0.55);
    g.quadraticCurveTo(w * 0.45, gy - o.grass * 0.55, w, gy + o.grass * 0.2);
    g.lineTo(w, h); g.lineTo(0, h); g.closePath();
    const gg = g.createLinearGradient(0, gy - o.grass * 0.3, 0, h);
    gg.addColorStop(0, '#b8f05a'); gg.addColorStop(0.35, '#6ccf34'); gg.addColorStop(1, '#2e8e1c');
    g.fillStyle = gg; g.fill();
    g.strokeStyle = 'rgba(240,255,200,0.9)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, gy + o.grass * 0.55 + 1); g.quadraticCurveTo(w * 0.45, gy - o.grass * 0.55 + 1, w, gy + o.grass * 0.2 + 1); g.stroke();
    // grass blades
    g.strokeStyle = 'rgba(40,120,20,0.35)';
    for (let i = 0; i < w; i += 3) {
      const u = i / w, by = (1 - u) * (1 - u) * (gy + o.grass * 0.55) + 2 * (1 - u) * u * (gy - o.grass * 0.55) + u * u * (gy + o.grass * 0.2);
      const bh = 2 + hash1(i, 5) * 3;
      g.beginPath(); g.moveTo(i, by + 3 + bh); g.lineTo(i + 1, by + 3); g.stroke();
    }
  }
  return c;
}

export function ecoSky(ctx, x, y, w, h, t = 0, o = {}) {
  const opt = { sun: o.sun || [0.3, 0.25], arcs: o.arcs, clouds: o.clouds, grass: o.grass || 0 };
  w = Math.round(w); h = Math.round(h);
  const c = aeroCached(`sky|${w}|${h}|${opt.sun}|${opt.arcs}|${opt.clouds}|${opt.grass}`, () => skyTex(w, h, opt));
  ctx.drawImage(c, Math.round(x), Math.round(y));
  // slowly turning flare rays
  const sx = x + opt.sun[0] * w, sy = y + opt.sun[1] * h;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 10; i++) {
    const a = t * 0.05 + (i / 10) * TAU, len = Math.max(w, h) * (0.35 + 0.25 * hash1(i, 2)), half = 0.035;
    ctx.fillStyle = `rgba(255,255,230,${0.07 + 0.05 * Math.sin(t * 0.7 + i)})`;
    ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(a - half) * len, sy + Math.sin(a - half) * len);
    ctx.lineTo(sx + Math.cos(a + half) * len, sy + Math.sin(a + half) * len);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  drawSparkle(ctx, sx, sy, 4, 0.9);
  // lens-flare ghosts along the diagonal
  for (const [k, r, a] of [[0.35, 4, 0.25], [0.6, 2.5, 0.3], [0.85, 6, 0.15]]) drawAeroGlow(ctx, sx + (x + w * 0.85 - sx) * k, sy + (y + h * 0.8 - sy) * k, r, '#e8fff0', a);
  if (o.globe) ecoGlobe(ctx, x + w - o.globe - 10, y + h * 0.48, o.globe, t);
  ctx.restore();
}

export function ecoBubbles(ctx, x, y, w, h, t, n = 8) {
  for (let i = 0; i < n; i++) {
    const sp = 6 + hash1(i, 4) * 10;
    const bx = x + hash1(i, 1) * w + Math.sin(t * 1.4 + i) * 3;
    const by = y + h - ((t * sp + hash1(i, 6) * h) % (h + 10)) + 5;
    drawAeroBubble(ctx, bx, by, 1.5 + hash1(i, 8) * 3, 0.85);
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
  if (!o.disabled) splash(ctx, x + w / 2, y + h + 1, w * (hov ? 1.12 : 1.0), t, hov ? 1 : 0.85);
  drawAeroButton(ctx, x, y + (o.down ? 1 : 0), w, h, { label, icon: o.icon || null, tone: o.disabled ? 'grey' : o.tone || 'aqua', state: o.disabled ? 'disabled' : o.down ? 'down' : hov || o.active ? 'hover' : 'normal' });
  if (hov) for (let i = 0; i < 3; i++) drawAeroBubble(ctx, x + 6 + ((i * 29 + t * 18) % Math.max(1, w - 12)), y - 2 - ((t * 14 + i * 7) % 8), 1.5, 0.8);
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
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
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
