// The 3D GEAR (phase 6): the heart of the fishing minigame. A big low-poly chrome Frutiger Aero gear (15 bevelled
// teeth, five ridged spokes, a glossy bevelled rim with lime bolts, an aqua glow ring and a glowing gem hub behind
// clear aqua glass) rendered with the shared low-poly renderer in the lower-right corner. The gear repeats every
// 72 degrees, so its spin is a ring of cached renderMesh frames (warmed up while you wait for a bite); it is
// rendered live in 3D only while it flips in and while a jolt tilts it.
// It spins with real momentum: circling the mouse (anywhere) grips and drives it, the fish's pull drags it back
// (and spins it backwards, stripping line, when you let go), bearings let it coast. It tilts and wobbles in 3D,
// smears with motion-blur ghosts, throws sparks and glints at speed and crackles with arcs while a shock charges.
//
// Around it, big and readable:
//   RPM gauge      outer 240-degree arc: the moving green SWEET BAND (the hook-set band during a bite), the red
//                  RIP / strain zone above it and a chrome needle at the gear's RPM (big number underneath)
//   progress ring  catch progress (lime) / hook-set meter (gold) with the bite window ticking down inside it
//   tension tube   glossy glass capsule on the left (aqua -> green -> yellow -> red, flashing before a snap)
//   shock          bolt orbs above the gear (charges + cooldown sweep); while charging, a ring on the gear face
//                  with the PERFECT window (release in it), the overcharge zone in red
//
// API: new Gear(F); update(dt, B); draw(ctx, B, k); layout(W, H); reset(); kick(n); jolt(rpm)
//   B = the controller (HookSpin, Battle or BoxReel) or null: gearMode 'hook' | 'fight' | 'box', band {lo, hi, rip?},
//   progress, ghost, tension, snapT, grace, stunned, surging, charge {k}, chargeWin {lo, hi}, charges, shockMax,
//   shockCd, shockCdMax, canCharge, bandDir (-1 | 0 | 1: where the band is heading), set / timeK (hook mode).
//   Gear fields: rpm (signed, + winds line), p = max(0, rpm) / RPM_UNIT (the old crank-power scale), load (rpm/s the
//   fish drags it back with, set by B each frame), brake (holding against a surge: no backspin), dir (+1 clockwise).
//   Old Reel compat: strain, snapped, denied, fire, lay {cx, cy, R, bx, by, br}.

import { TAU, clamp, clamp01, damp, lerp, ease } from '../core/math.js';
import { rgba } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { MeshBuilder, renderMesh, T4, lpAvailable, ellipsoid } from '../gfx/lowpoly.js';
import { glowSprite, drawBolt, boltPoints, pixelLine } from '../gfx/particles.js';
import { drawText, measureText } from '../gfx/font.js';
import { glossText } from './cinematics.js';

export const RPM_UNIT = 150; // gear rpm that equals crank power 1
export const RPM_MAX = 240; // gauge full scale
const GRIP = 7; // how hard a circling hand drives the gear toward its own speed (1/s)
const INK = '#0c3a52';
const G0 = Math.PI * (5 / 6), G1 = Math.PI * (13 / 6); // gauge arc: lower-left -> over the top -> lower-right

// ------------------------------------------------------------------------------------------------ mesh
// Quad / tri whose normal is forced to point away from `inside` (pieces are convex, so this fixes winding).
function face(mb, pts, col, inside) {
  const [a, b, c] = pts;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  let mx = 0, my = 0, mz = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; mz += p[2]; }
  mx /= pts.length; my /= pts.length; mz /= pts.length;
  const out = nx * (mx - inside[0]) + ny * (my - inside[1]) + nz * (mz - inside[2]) >= 0;
  const q = out ? pts : pts.slice().reverse();
  if (q.length === 3) mb.tri(q[0], q[1], q[2], col);
  else mb.quad(q[0], q[1], q[2], q[3], col);
}

const shadeHex = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
};

// Surface of revolution of a closed (r, z) cross-section; colours per section edge; `seg` facets around.
function lathe(mb, prof, cols, seg, closed = true, centre = null) {
  const n = prof.length;
  const cr = centre || [prof.reduce((s, p) => s + p[0], 0) / n, prof.reduce((s, p) => s + p[1], 0) / n];
  for (let j = 0; j < seg; j++) {
    const a0 = (j / seg) * TAU, a1 = ((j + 1) / seg) * TAU, am = (a0 + a1) / 2;
    const P = (p, a) => [Math.cos(a) * p[0], Math.sin(a) * p[0], p[1]];
    const inside = [Math.cos(am) * cr[0], Math.sin(am) * cr[0], cr[1]];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p = prof[i], q = prof[(i + 1) % n];
      const col = shadeHex(cols[i % cols.length], j % 2 ? 0.95 : 1.02);
      if (p[0] < 1e-6) face(mb, [P(p, a0), P(q, a0), P(q, a1)], col, inside);
      else if (q[0] < 1e-6) face(mb, [P(p, a0), P(q, a0), P(p, a1)], col, inside);
      else face(mb, [P(p, a0), P(q, a0), P(q, a1), P(p, a1)], col, inside);
    }
  }
}

const N_TEETH = 15, N_SPOKES = 5; // 72-degree symmetry: every lathe below uses a multiple of 5 segments
const SYM = TAU / 5, NF = 18; // cached spin frames over one symmetry period (4 degrees apart)
const PITCH = 0.42, YAW = -0.34; // the resting 3D view: from above and the right
const R_IN = 0.64, R_ROOT = 0.84, R_TIP = 1.0;
let MESH = null;
function gearMeshes() {
  if (MESH) return MESH;
  // ---- body: rim + teeth + spokes + hub + bolts (chrome)
  const mb = new MeshBuilder();
  const rimProf = [[R_IN, 0.07], [R_IN + 0.05, 0.15], [R_ROOT - 0.05, 0.15], [R_ROOT, 0.1], [R_ROOT, -0.1], [R_ROOT - 0.05, -0.14], [R_IN + 0.05, -0.14], [R_IN, -0.07]];
  lathe(mb, rimProf, ['#ffffff', '#d4e8f4', '#9fc6dc', '#a8cade', '#7ea4bc', '#6d93ad', '#5f87a2', '#86abc2'], 60);
  // teeth: tapered prisms with a sloped (chamfered) front face and a flat land
  const step = TAU / N_TEETH;
  for (let i = 0; i < N_TEETH; i++) {
    const a = i * step;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = (u, v, z) => [ca * u - sa * v, sa * u + ca * v, z];
    const rb = R_ROOT - 0.03, wb = 0.115, wt = 0.062, zb = 0.1, zt = 0.065;
    const B = [L(rb, -wb, zb), L(rb, wb, zb), L(rb, wb, -zb), L(rb, -wb, -zb)];
    const T = [L(R_TIP, -wt, zt), L(R_TIP, wt, zt), L(R_TIP, wt, -zt), L(R_TIP, -wt, -zt)];
    const inside = L((rb + R_TIP) / 2, 0, 0);
    face(mb, [B[0], B[1], T[1], T[0]], '#eaf6fc', inside); // front (sloped)
    face(mb, [T[0], T[1], T[2], T[3]], '#ffffff', inside); // land
    face(mb, [B[1], B[2], T[2], T[1]], '#93b9d0', inside); // flank
    face(mb, [B[0], T[0], T[3], B[3]], '#6a92ad', inside); // flank
    face(mb, [B[3], T[3], T[2], B[2]], '#5f87a2', inside); // back
  }
  // spokes: ridged pentagon section, tapering toward the rim
  for (let i = 0; i < N_SPOKES; i++) {
    const a = (i / N_SPOKES) * TAU + step / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = (u, v, z) => [ca * u - sa * v, sa * u + ca * v, z];
    const sec = (u, w) => [L(u, -w, 0.03), L(u, 0, 0.09), L(u, w, 0.03), L(u, w, -0.06), L(u, -w, -0.06)];
    const A = sec(0.22, 0.085), Bq = sec(R_IN + 0.02, 0.06);
    const inside = L(0.45, 0, 0);
    const cols = ['#f4fbff', '#c3dceb', '#8fb3cb', '#5e86a2', '#9fc2d8'];
    for (let k = 0; k < 5; k++) face(mb, [A[k], A[(k + 1) % 5], Bq[(k + 1) % 5], Bq[k]], cols[k], inside);
  }
  // hub: chrome drum with a chamfer and a lime accent ring around the gem seat
  lathe(mb, [[0.17, 0.2], [0.24, 0.19], [0.28, 0.13], [0.28, -0.14], [0.17, -0.14]], ['#ffffff', '#c7dfee', '#8fb3cb', '#5f87a2', '#7ea4bc'], 20, true, [0.22, 0.02]);
  lathe(mb, [[0.155, 0.215], [0.175, 0.215], [0.175, 0.185], [0.155, 0.185]], ['#c8f56a', '#6cd03a', '#3fae2a', '#8be04a'], 20, true, [0.165, 0.2]);
  // lime bolts on the rim between the spokes
  for (let i = 0; i < N_SPOKES; i++) {
    const a = (i / N_SPOKES) * TAU;
    const r = (R_IN + R_ROOT) / 2;
    ellipsoid(mb, [Math.cos(a) * r, Math.sin(a) * r, 0.155], [0.04, 0.04, 0.03], 6, 4, (nx, ny, nz) => (nz > 0.7 ? '#e2ffb0' : ny > 0 ? '#8be04a' : '#3fae2a'));
  }
  const body = mb.build();
  // ---- the aqua glow ring (emissive) just inside the rim's lip
  const gb = new MeshBuilder();
  lathe(gb, [[R_IN - 0.045, 0.09], [R_IN + 0.004, 0.09], [R_IN + 0.004, 0.05], [R_IN - 0.045, 0.05]], ['#ffffff'], 40, true, [R_IN - 0.02, 0.07]);
  const glow = gb.build();
  // ---- the gem in the hub (faceted dome)
  const mg = new MeshBuilder();
  lathe(mg, [[0, 0.31], [0.08, 0.29], [0.14, 0.24], [0.16, 0.19], [0, 0.19]], ['#ffffff', '#e8fdff', '#c8f6ff', '#9ff0ff'], 10, true, [0.06, 0.22]);
  const gem = mg.build();
  // ---- clear aqua glass disc behind the spokes
  const mgl = new MeshBuilder();
  lathe(mgl, [[0.26, 0.012], [R_IN + 0.01, 0.012], [R_IN + 0.01, -0.012], [0.26, -0.012]], ['#bff4ff', '#bff4ff', '#bff4ff', '#bff4ff'], 40, true, [0.45, 0]);
  const glass = mgl.build();
  MESH = { body, glow, gem, glass };
  return MESH;
}

// ------------------------------------------------------------------------------------------------ 2D art
const ART = new Map();
function art(key, make) {
  let c = ART.get(key);
  if (!c) { c = make(); ART.set(key, c); }
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
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RAMPS = {
  track: ['#5d8fae', '#86b4cf', '#b4d9ec', '#e2f4fc', '#ffffff'],
  lime: ['#2f7a1e', '#3fae2a', '#6cd03a', '#a6ec5a', '#e2ffb0'],
  band: ['#1f8a3a', '#2fc85a', '#6cf08a', '#b8ffc8', '#ffffff'],
  red: ['#7a1a1a', '#c8303a', '#ff5a4a', '#ff9a7a', '#ffe0d0'],
  orange: ['#8a3a06', '#d8701a', '#ff9d2e', '#ffc870', '#fff0d0'],
  gold: ['#a86a00', '#e0a000', '#ffd23a', '#fff07a', '#fffbe0'],
  aqua: ['#0a5f88', '#1fb8dc', '#4fd8f0', '#8ff0ff', '#e8fdff'],
  white: ['#7fa4bc', '#b4d0e2', '#e2f2fc', '#ffffff', '#ffffff'],
  dark: ['#06243a', '#0c3a52', '#164e6c', '#21627f', '#3a7a98'],
  grey: ['#3a4a58', '#56687a', '#7a8c9c', '#a4b4c2', '#d4e0ea'],
};
const RAMP_RGB = Object.fromEntries(Object.entries(RAMPS).map(([k, v]) => [k, v.map(hex)]));
const rampAt = (ramp, l) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(clamp01(l) * (ramp.length - 1))))];

// Glossy tube ring (a torus seen face-on): radius r, thickness th, lit from the top-left, dark outline.
function tubeRing(r, th, rampName, alpha = 255) {
  return art(`ring${r}|${th}|${rampName}|${alpha}`, () => {
    const C = r + th, S = C * 2 + 1, ramp = RAMP_RGB[rampName], hw = th / 2;
    return paint(S, S, (x, y) => {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      const u = (d - r) / hw;
      if (Math.abs(u) > 1.12) return null;
      if (Math.abs(u) > 0.86) return [12, 58, 82, Math.min(255, alpha + 40)];
      const nx = dx / (d || 1), ny = dy / (d || 1);
      const facing = -(nx * -0.6 + ny * -0.8); // > 0 on the side away from the light
      const nz = Math.sqrt(Math.max(0, 1 - u * u));
      let l = 0.3 + 0.5 * nz - 0.28 * u * facing;
      if (u < -0.15 && u > -0.6 && facing < 0.2) l = Math.max(l, 0.95); // specular streak on the lit side
      return [...rampAt(ramp, l), alpha];
    });
  });
}

// Glass disc behind the whole gear HUD: keeps it readable over the bright sky and the dark abyss alike.
function plateSprite(r) {
  return art('plate' + r, () => {
    const S = r * 2 + 3, C = r + 1;
    return paint(S, S, (x, y) => {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      if (d > r + 0.5) return null;
      if (d > r - 1.2) return [12, 58, 82, 210];
      if (d > r - 2.4) return [255, 255, 255, 200];
      const k = d / r;
      // glass lip: a bright aqua band round the edge, lit at the top-left
      if (d > r - 7) { const lit = clamp01(0.5 - (dx + dy) / (r * 2.2)); return [Math.round(lerp(120, 235, lit)), Math.round(lerp(205, 252, lit)), 255, Math.round(lerp(120, 200, lit))]; }
      const top = dy < 0 && Math.hypot(dx + r * 0.22, dy + r * 0.3) < r * 0.66 && Math.hypot(dx + r * 0.08, dy + r * 0.02) > r * 0.64;
      if (top) return [255, 255, 255, 80];
      return [Math.round(lerp(150, 30, k * 0.8)), Math.round(lerp(215, 105, k * 0.7)), 255, Math.round(lerp(80, 150, k))];
    });
  });
}

// Glossy sphere (orbs, knobs).
function sphere(r, rampName) {
  return art(`sph${r}|${rampName}`, () => {
    const ramp = RAMP_RGB[rampName], s = r * 2 + 1;
    return paint(s, s, (x, y) => {
      const dx = (x - r) / (r + 0.35), dy = (y - r) / (r + 0.35);
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) return null;
      if (d2 > 0.8) return [12, 58, 82, 255];
      const nz = Math.sqrt(1 - d2);
      let l = clamp01(0.15 + 0.85 * Math.max(0, (dx * -0.5 + dy * -0.6 + nz * 0.62) / 0.94));
      const hx = (dx + 0.36) / 0.28, hy = (dy + 0.42) / 0.18;
      if (hx * hx + hy * hy < 1) return [255, 255, 255, 255];
      if (dy > 0.35 && d2 < 0.6) l = Math.min(1, l + 0.15);
      return [...rampAt(ramp, l), 255];
    });
  });
}

// Tension capsule: a glass tube with a left-edge gloss stripe (drawn over the fill).
function tubeGlass(w, h, front) {
  return art(`tube${w}|${h}|${front}`, () => {
    const r = w / 2;
    return paint(w + 2, h + 2, (x, y) => {
      const cx = x - 1 - r + 0.5, yy = y - 1;
      const dyc = yy < r ? r - yy - 0.5 : yy > h - r ? yy - (h - r) + 0.5 : 0;
      const d = Math.hypot(cx, dyc);
      if (d > r + 0.5) return null;
      if (d > r - 0.7) return front ? [12, 58, 82, 255] : null;
      const u = cx / r;
      if (front) {
        if (u > -0.62 && u < -0.28 && yy > r * 0.6 && yy < h - r * 0.8) return [255, 255, 255, 150];
        if (u > 0.5 && u < 0.7 && yy > r && yy < h - r) return [255, 255, 255, 50];
        return null;
      }
      return [190, 235, 255, 90];
    });
  });
}

// Small glyphs: circling arrows (spin), a held mouse button, the Space bar, a lightning bolt.
function spinGlyph() {
  return art('g_spin', () => {
    const c = makeCanvas(17, 17), g = ctxOf(c);
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU * 0.82 - Math.PI * 0.9;
      pts.push([Math.round(8 + Math.cos(a) * 6), Math.round(8 + Math.sin(a) * 6)]);
    }
    g.fillStyle = INK;
    for (const [x, y] of pts) g.fillRect(x - 1, y - 1, 3, 3);
    const [ex, ey] = pts[pts.length - 1];
    g.fillRect(ex - 3, ey - 3, 6, 6);
    g.fillStyle = '#ffffff';
    for (const [x, y] of pts) g.fillRect(x, y, 1, 1);
    g.fillStyle = '#8ff0ff'; g.fillRect(ex - 2, ey - 2, 4, 4);
    g.fillStyle = '#ffffff'; g.fillRect(ex - 2, ey - 2, 2, 2);
    return c;
  });
}
function mouseGlyph(lit) {
  return art('g_mouse' + lit, () => {
    const rows = ['..#####..', '.#LL#..#.', '#LLL#...#', '#LLL#...#', '#####...#', '#.......#', '#.......#', '#.......#', '#.......#', '.#.....#.', '..#####..'];
    const c = makeCanvas(9, rows.length), g = ctxOf(c);
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < 9; x++) {
      const ch = rows[y][x];
      const inner = x > rows[y].indexOf('#') && x < rows[y].lastIndexOf('#');
      if (ch === '#') g.fillStyle = INK;
      else if (ch === 'L') g.fillStyle = lit ? '#ffd23a' : '#d8eef8';
      else if (inner) g.fillStyle = y < 3 ? '#ffffff' : '#e8f6fc';
      else continue;
      g.fillRect(x, y, 1, 1);
    }
    return c;
  });
}
function spaceGlyph(lit) {
  return art('g_space' + lit, () => {
    const c = makeCanvas(21, 9), g = ctxOf(c);
    g.fillStyle = INK; g.fillRect(1, 0, 19, 9); g.fillRect(0, 1, 21, 7);
    g.fillStyle = lit ? '#ffd23a' : '#e8f6fc'; g.fillRect(1, 1, 19, 6);
    g.fillStyle = lit ? '#fff6c0' : '#ffffff'; g.fillRect(2, 1, 17, 2);
    g.fillStyle = INK; g.fillRect(5, 5, 11, 1); g.fillRect(5, 4, 1, 1); g.fillRect(15, 4, 1, 1);
    return c;
  });
}
const BOLT_ROWS = ['....###', '...###.', '..###..', '.######', '#####..', '...##..', '..##...', '.##....', '##.....'];
function boltGlyph(fill) {
  return art('g_bolt' + fill, () => {
    const w = 7, h = BOLT_ROWS.length;
    const c = makeCanvas(w + 2, h + 2), g = ctxOf(c);
    g.fillStyle = '#5a3a00';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (BOLT_ROWS[y][x] === '#') g.fillRect(x, y, 3, 3);
    g.fillStyle = fill;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (BOLT_ROWS[y][x] === '#') g.fillRect(x + 1, y + 1, 1, 1);
    return c;
  });
}

// A crisp 1 px dark outline round a rendered sprite (pixel-art selective outline), in place.
function outlined(c) {
  if (!c) return c;
  const g = c.getContext('2d'), w = c.width, h = c.height;
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 150;
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 40) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) out.push(x, y);
  }
  for (let i = 0; i < out.length; i += 2) { const j = (out[i + 1] * w + out[i]) * 4; d[j] = 12; d[j + 1] = 58; d[j + 2] = 82; d[j + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

// Draws a ring sprite clipped to the clockwise arc a0 -> a1 (canvas angles: 0 = right, clockwise).
function arcSprite(ctx, spr, cx, cy, a0, a1, alpha = 1) {
  if (a1 <= a0 + 1e-4) return;
  const C = (spr.width - 1) / 2;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (a1 - a0 < TAU - 1e-3) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, C + 4, a0, a1);
    ctx.closePath();
    ctx.clip();
  }
  ctx.drawImage(spr, Math.round(cx - C), Math.round(cy - C));
  ctx.restore();
}

// A small glossy glass pill (readouts), centred at cx.
function drawPillGlass(ctx, cx, y, w, h) {
  const x = Math.round(cx - w / 2), r = Math.floor(h / 2);
  for (let i = 0; i < h; i++) {
    const dy = i < r ? r - i - 0.5 : i >= h - r ? i - (h - r) + 0.5 : 0;
    const inset = dy > 0 ? Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy))) : 0;
    const k = i / Math.max(1, h - 1);
    ctx.fillStyle = INK; ctx.fillRect(x + inset - 1, y + i, w - inset * 2 + 2, 1);
    ctx.fillStyle = k < 0.45 ? `rgba(${Math.round(lerp(120, 60, k))},${Math.round(lerp(200, 150, k))},235,0.92)` : `rgba(12,${Math.round(lerp(70, 40, k))},${Math.round(lerp(110, 80, k))},0.92)`;
    ctx.fillRect(x + inset, y + i, w - inset * 2, 1);
  }
  ctx.fillStyle = INK; ctx.fillRect(x + r, y - 1, w - 2 * r, 1); ctx.fillRect(x + r, y + h, w - 2 * r, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + r, y + 1, w - 2 * r, 1);
}

const TENSION_COLS = ['#2fd3e8', '#4fe0c8', '#8be04a', '#c8f56a', '#ffd23a', '#ff9d2e', '#ff4f5e'];
function tensionColor(k) {
  return TENSION_COLS[Math.min(TENSION_COLS.length - 1, Math.max(0, Math.floor(k * TENSION_COLS.length * 0.999)))];
}
const glowRgb = (h) => hex(h).map((v) => v / 255);

// ------------------------------------------------------------------------------------------------ the gear
export class Gear {
  constructor(F) {
    this.F = F;
    this.t = 0;
    this.rpm = 0; this.rpmShown = 0; this.p = 0;
    this.hand = 0;
    this.load = 0; this.brake = false;
    this.dir = 1;
    this.angle = 0;
    this.hist = [0, 0, 0, 0];
    this.jam = 0;
    this.show = 0;
    this.pop = 0; // 0..1 entrance flip
    this.tiltX = 0; this.tiltY = 0; this.tiltVX = 0; this.tiltVY = 0;
    this.heat = 0; // strain glow
    this.flash = 0; this.flashCol = '#ffffff';
    this.strain = 0; this.snapped = 0; this.denied = 0; this.fire = 0; this.btnPress = 0; this.kickK = 0;
    this.lay = null; this.layW = 0; this.layH = 0;
    this.cache = null; this.img = null;
    this.mode = null;
    this.prog = 0;
    this.sparkT = 0; this.glintT = 0;
  }

  reset() {
    this.strain = 0; this.snapped = 0; this.denied = 0; this.fire = 0; this.kickK = 0;
    this.prog = 0; this.jam = 0; this.brake = false;
  }

  kick(n = 1) { this.kickK = Math.max(this.kickK, n); this.tiltVY += 2.2 * n; this.tiltVX -= 1.2 * n; }
  // A sudden change of speed (backfire, snag): the gear lurches and tilts.
  jolt(drpm) { this.rpm += drpm; this.tiltVX += drpm * 0.025; this.tiltVY -= drpm * 0.018; }
  flashOn(col, k = 1) { this.flash = Math.max(this.flash, k); this.flashCol = col; }
  idle(dt) { this.update(dt, null); }

  layout(W, H) {
    if (this.lay && this.layW === W && this.layH === H) return this.lay;
    const S = H / 540;
    const R = Math.round(clamp(H * 0.158, 62, 150));
    const cx = Math.round(W - R - 78 * S), cy = Math.round(H - R - 52 * S);
    const rp = R + Math.round(10 * S), tp = Math.max(6, Math.round(8 * S)); // progress ring
    const rg = R + Math.round(26 * S), tg = Math.max(8, Math.round(11 * S)); // gauge
    const tw = Math.max(14, Math.round(20 * S)), th = Math.round(R * 1.75);
    const tx = Math.round(cx - rg - tg - 10 * S - tw), ty = Math.round(cy - th * 0.6);
    this.lay = { S, R, cx, cy, rp, tp, rg, tg, tw, th, tx, ty, size: 2 * Math.ceil(R * 1.22) + 2, bx: cx, by: Math.round(cy - rg - 26 * S), br: Math.round(9 * S) };
    this.layW = W; this.layH = H;
    return this.lay;
  }

  hitShock() { return false; }

  // Screen rect of the whole gear HUD (gauge included) while it is up, else null (the guide points at it).
  rect() {
    if (this.show < 0.5 || !this.lay) return null;
    const L = this.lay, r = L.rg + L.tg;
    return { x: L.cx - r, y: L.cy - r, w: r * 2, h: r * 2 };
  }

  // ---------------------------------------------------------------- physics + fx
  update(dt, B) {
    const F = this.F, cr = F.crank;
    this.t += dt;
    const L = this.layout(F.W, F.H);
    const active = !!B;
    this.mode = B?.gearMode || null;
    this.show = clamp01(this.show + dt * (active ? 3.2 : -2.5));
    this.pop = active ? Math.min(1, this.pop + dt * 2.2) : 0;
    // the hand: circling speed (rpm) while the circle is big enough to count
    const rk = clamp01((cr.radius - 3) / 9);
    const hand = cr.stun > 0 || this.jam > 0 ? 0 : (cr.speed || 0) * 60 * rk;
    this.hand = hand;
    const drive = active && hand > 14;
    if (drive && cr.dir) this.dir = cr.dir;
    let acc = -this.rpm * (drive ? 0.15 : 0.7) - (active ? this.load : 0);
    if (drive) acc += GRIP * (hand - this.rpm);
    this.rpm += acc * dt;
    if (!active) this.rpm = damp(this.rpm, 0, 3, dt);
    if (this.brake && this.rpm < 0) this.rpm = damp(this.rpm, 0, 14, dt);
    this.rpm = clamp(this.rpm, -180, 330);
    this.jam = Math.max(0, this.jam - dt);
    this.p = Math.max(0, this.rpm) / RPM_UNIT;
    this.rpmShown = damp(this.rpmShown, this.rpm, 12, dt);
    // spin (clockwise on screen when circling clockwise) + motion-blur history
    const dA = this.dir * (this.rpm / 60) * TAU * dt;
    this.angle -= dA;
    this.spinV = -dA / Math.max(dt, 1e-3);
    // 3D tilt: a spring kicked by jolts (hook-set, backfire, won counters); it rests at the cached view
    this.tiltVX += (-this.tiltX * 70 - this.tiltVX * 9) * dt;
    this.tiltVY += (-this.tiltY * 70 - this.tiltVY * 9) * dt;
    this.tiltX += this.tiltVX * dt; this.tiltY += this.tiltVY * dt;
    if (Math.abs(this.tiltX) + Math.abs(this.tiltVX) * 0.05 < 0.004) { this.tiltX = 0; this.tiltVX = 0; }
    if (Math.abs(this.tiltY) + Math.abs(this.tiltVY) * 0.05 < 0.004) { this.tiltY = 0; this.tiltVY = 0; }
    // states
    const T = B ? clamp(B.tension ?? 0, 0, 1.2) : 0;
    const over = B?.band && this.rpm > B.band.hi;
    this.heat = damp(this.heat, T > 0.88 || (over && B.gearMode === 'fight') ? 1 : 0, 5, dt);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.strain = Math.max(0, this.strain - dt * 2.2);
    this.denied = Math.max(0, this.denied - dt * 4);
    this.fire = Math.max(0, this.fire - dt * 3);
    this.kickK = Math.max(0, this.kickK - dt * 2.5);
    this.btnPress = Math.max(0, this.btnPress - dt * 6);
    if (B) this.prog = damp(this.prog, clamp01(B.gearMode === 'hook' ? B.set ?? 0 : B.progress ?? 0), 10, dt);
    if (!active || this.show < 0.5) return;
    // ---- screen fx at speed: sparks flicking off the teeth, glints racing round the rim
    const fx = F.fx, R = L.R, rpmA = Math.abs(this.rpm);
    this.sparkT -= dt;
    if (rpmA > 120 && this.sparkT <= 0) {
      this.sparkT = lerp(0.12, 0.02, clamp01((rpmA - 120) / 140));
      const a = Math.random() * TAU;
      const x = L.cx + Math.cos(a) * R, y = L.cy + Math.sin(a) * R * 0.92;
      const tang = a + (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const hot = this.heat > 0.4;
      fx.sparks(x, y, hot ? 2 : 1, { dir: tang, spread: 0.35, speed: [80, 200], g: 240, colors: hot ? ['#ffffff', '#ffd23a', '#ff9a3a', '#ff5a4a'] : ['#ffffff', '#bff8ff', '#fff6a0'] });
    }
    this.glintT -= dt;
    if (this.glintT <= 0) {
      this.glintT = rpmA > 60 ? 0.18 : 0.9;
      const a = -Math.PI * 0.75 + (Math.random() - 0.5) * 0.7;
      fx.glint(L.cx + Math.cos(a) * R * 0.93, L.cy + Math.sin(a) * R * 0.93, { len: rpmA > 120 ? 7 : 5, color: '#ffffff' });
    }
    // charging: arcs crawl over the teeth
    const ch = B.charge;
    if (ch && ch.k > 0.1 && Math.random() < dt * (8 + ch.k * 30)) {
      const a0 = Math.random() * TAU, a1 = a0 + (Math.random() - 0.5) * 1.6;
      fx.arc(L.cx + Math.cos(a0) * R * 0.95, L.cy + Math.sin(a0) * R * 0.95, L.cx + Math.cos(a1) * (R + 12 + ch.k * 16), L.cy + Math.sin(a1) * (R + 12 + ch.k * 16), { jag: 4, color: ch.k > (B.chargeWin?.hi ?? 1) ? '#ff9a7a' : '#fff07a', life: 0.12 });
    }
  }

  // ---------------------------------------------------------------- 3D render
  // Render options for one view of the gear (orthographic, R px per unit) at spin angle `spin` and tilt.
  gearOpts(L, spin, pitch, yaw, scale = 1) {
    const M = gearMeshes();
    const chrome = { mesh: M.body, spec: 0.95, shine: 30, env: 0.85, rim: 0.6 };
    return {
      w: L.size, h: L.size, matrix: T4.trs([0, 0, 0], pitch, yaw, spin, scale), scale: L.R, center: [0, 0, 0], radius: 1.3,
      light: [-0.55, 0.72, 0.75], ambient: 0.44, sky: '#f6feff', ground: '#0f4a78', rimColor: '#bff8ff',
      parts: [
        chrome,
        { mesh: M.glow, emit: 1, tint: [0.37, 0.96, 1, 0.6], spec: 0.2, env: 0, rim: 0 },
        { mesh: M.gem, emit: 0.5, spec: 1, shine: 60, env: 0.4, tint: [0.45, 0.95, 1, 0.3] },
        { mesh: M.glass, alpha: 0.36, spec: 0.8, shine: 50, env: 0.6, depthWrite: false },
      ],
    };
  }

  // The cached ring of spin frames (NF frames over the 72-degree symmetry) for the current size.
  frames(L) {
    if (!this.cache || this.cache.size !== L.size) this.cache = { size: L.size, list: new Array(NF).fill(null), n: 0 };
    return this.cache;
  }

  frame(L, i) {
    const c = this.frames(L);
    i = ((i % NF) + NF) % NF;
    if (!c.list[i]) {
      c.list[i] = outlined(renderMesh(null, this.gearOpts(L, (i / NF) * SYM, PITCH, YAW)));
      c.n++;
    }
    return c.list[i];
  }

  // Render a few missing frames (call while the player waits for a bite) so the first spin never hitches.
  warm(n = 2) {
    if (!lpAvailable()) return;
    const F = this.F, L = this.layout(F.W, F.H), c = this.frames(L);
    for (let i = 0; i < NF && n > 0; i++) if (!c.list[i]) { this.frame(L, i); n--; }
  }

  // The gear's look this frame: a cached spin frame (+ motion-blur ghosts), or a live 3D render while it tilts.
  render3D(L, B) {
    if (!lpAvailable()) return null;
    const S = L.size;
    if (!this.img || this.img.width !== S) { this.img = makeCanvas(S, S); this.imgCtx = ctxOf(this.img); }
    const g = this.imgCtx;
    g.clearRect(0, 0, S, S);
    const popK = ease.outBack(clamp01(this.pop));
    const live = this.pop < 1 || Math.abs(this.tiltX) + Math.abs(this.tiltY) > 0.03;
    if (live) {
      const yaw = YAW + this.tiltY + (1 - popK) * 1.35;
      const pitch = PITCH + this.tiltX + (1 - clamp01(this.pop * 1.4)) * 0.35;
      renderMesh(null, { ...this.gearOpts(L, this.angle, pitch, yaw, lerp(0.55, 1, popK)), out: this.img, outX: 0, outY: 0 });
    } else {
      const fa = ((this.angle % SYM) + SYM) % SYM / SYM * NF;
      const i0 = Math.round(fa);
      // motion blur: the frames the gear just swept through, fainter and behind
      const blur = clamp01((Math.abs(this.rpm) - 45) / 150);
      if (blur > 0) {
        const lag = clamp((this.spinV * 0.03) / (SYM / NF), -3, 3);
        for (let k = 3; k >= 1; k--) {
          g.globalAlpha = blur * (0.5 - k * 0.12);
          g.drawImage(this.frame(L, Math.round(fa - lag * k * 0.6)), 0, 0);
        }
        g.globalAlpha = 1;
      }
      g.drawImage(this.frame(L, i0), 0, 0);
    }
    // state tint (charge, strain, stun, flashes) over the chrome
    const ch = B?.charge?.k || 0;
    let tc = null, ta = 0;
    if (ch > 0) { tc = ch > (B.chargeWin?.hi ?? 1) ? '#ff7a5a' : '#fff07a'; ta = 0.12 + ch * 0.3 + (Math.random() < 0.2 ? 0.15 : 0); }
    else if (this.heat > 0.05) { tc = '#ff5a4a'; ta = this.heat * (0.22 + 0.12 * Math.sin(this.t * 30)); }
    else if (B?.stunned) { tc = '#bff8ff'; ta = 0.1 + (Math.floor(this.t * 20) % 2) * 0.12; }
    else if (this.state(B) === 'sweet') { tc = '#8be04a'; ta = 0.06 + 0.04 * Math.sin(this.t * 9); }
    if (this.flash > 0 && this.flash * 0.6 > ta) { tc = this.flashCol; ta = this.flash * 0.6; }
    if (tc && ta > 0.01) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(tc, Math.min(0.85, ta));
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    return this.img;
  }

  // 2D stand-in when WebGL2 is not available.
  drawGear2D(ctx, cx, cy, R) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-this.angle);
    ctx.beginPath();
    const step = TAU / N_TEETH;
    for (let i = 0; i < N_TEETH; i++) {
      const a = i * step;
      for (const [da, r] of [[-0.27, R_ROOT], [-0.17, R_TIP], [0.17, R_TIP], [0.27, R_ROOT], [0.5, R_ROOT]]) ctx.lineTo(Math.cos(a + da * step) * r * R, Math.sin(a + da * step) * r * R);
    }
    ctx.closePath();
    const gr = ctx.createLinearGradient(-R, -R, R, R);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#a9cadf'); gr.addColorStop(1, '#5f87a2');
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R_IN * R, 0, TAU); ctx.fillStyle = 'rgba(150,230,255,0.75)'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d4e8f4';
    for (let i = 0; i < N_SPOKES; i++) { ctx.save(); ctx.rotate((i / N_SPOKES) * TAU); ctx.fillRect(0, -R * 0.06, R * R_IN, R * 0.12); ctx.restore(); }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.26, 0, TAU); ctx.fillStyle = '#e8f5fc'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.14, 0, TAU); ctx.fillStyle = '#5ff4ff'; ctx.fill();
    ctx.restore();
  }

  state(B) {
    const band = B?.band;
    if (!band || Math.abs(this.rpm) < 8) return 'idle';
    if (band.rip !== undefined && this.rpm > band.rip) return 'rip';
    return this.rpm > band.hi ? 'over' : this.rpm >= band.lo ? 'sweet' : 'slow';
  }

  // ---------------------------------------------------------------- HUD
  // k: slide-in 0..1
  draw(ctx, B, k = 1) {
    const F = this.F, t = this.t;
    const L = this.layout(F.W, F.H);
    const vis = Math.min(k, ease.outCubic(this.show));
    if (vis <= 0.01) return;
    const slide = Math.round((1 - vis) * (L.R * 2 + 120));
    const shake = this.heat > 0.3 || this.denied > 0 ? (Math.random() - 0.5) * (this.heat * 3 + this.denied * 4) : 0;
    const cx = L.cx + slide + Math.round(shake), cy = L.cy + Math.round(slide * 0.4);
    const { R, S } = L;
    const st = this.state(B);
    const T = B ? clamp(B.tension ?? 0, 0, 1.2) : 0;
    ctx.save();
    ctx.globalAlpha = clamp01(vis * 1.4);
    // ---- glass backplate + state glow
    const plate = plateSprite(L.rg + L.tg + Math.round(8 * S));
    ctx.drawImage(plate, cx - (plate.width - 1) / 2, cy - (plate.height - 1) / 2);
    const gcol = this.heat > 0.4 || st === 'rip' ? '#ff4f5e' : B?.stunned ? '#7ff4ff' : B?.charge ? '#fff07a' : st === 'sweet' ? '#8be04a' : st === 'over' ? '#ff9d2e' : '#59c3ff';
    const gA = this.heat > 0.4 ? 0.45 + 0.3 * Math.sin(t * 22) : B?.charge ? 0.35 + B.charge.k * 0.5 : st === 'sweet' ? 0.4 + 0.12 * Math.sin(t * 9) : 0.22;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= gA;
    const gr = Math.round(R * 1.45);
    ctx.drawImage(glowSprite(gr, gcol), cx - gr, cy - gr);
    ctx.restore();
    // ---- rings
    this.drawGauge(ctx, cx, cy, L, B, st);
    this.drawProgress(ctx, cx, cy, L, B);
    // ---- the gear itself
    const img = this.render3D(L, B);
    if (img) ctx.drawImage(img, Math.round(cx - L.size / 2), Math.round(cy - L.size / 2));
    else this.drawGear2D(ctx, cx, cy, R);
    // speed streaks: bright arcs racing round the teeth
    const sp = clamp01((Math.abs(this.rpm) - 70) / 170);
    if (sp > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const a0 = -this.angle + (i * TAU) / 3;
        for (let j = 0; j < 14; j++) {
          const a = a0 - this.dir * j * 0.045;
          ctx.fillStyle = rgba('#ffffff', sp * (0.7 - j * 0.045));
          ctx.fillRect(Math.round(cx + Math.cos(a) * (R + 2)), Math.round(cy + Math.sin(a) * (R * 0.95 + 2)), 2, 2);
        }
      }
      ctx.restore();
    }
    // stunned fish: arcs crackle across the face
    if (B?.stunned && Math.random() < 0.5) {
      const a0 = Math.random() * TAU, a1 = a0 + 0.8 + Math.random() * 1.5;
      drawBolt(ctx, boltPoints(cx + Math.cos(a0) * R * 0.3, cy + Math.sin(a0) * R * 0.3, cx + Math.cos(a1) * R * 0.85, cy + Math.sin(a1) * R * 0.85, 4, (Math.random() * 1e9) >>> 0), 0.85);
    }
    if (B?.charge) this.drawCharge(ctx, cx, cy, L, B);
    this.drawReadout(ctx, cx, cy, L, B, st);
    if (B && B.gearMode !== 'hook') this.drawTension(ctx, L.tx + slide, L.ty + Math.round(slide * 0.4), L, B, T);
    if (B && B.shockMax > 0) this.drawShock(ctx, cx, cy, L, B);
    ctx.restore();
  }

  // Outer gauge: track, sweet band, rip / strain zone, needle.
  drawGauge(ctx, cx, cy, L, B, st) {
    const t = this.t;
    const ang = (rpm) => G0 + clamp01(rpm / RPM_MAX) * (G1 - G0);
    arcSprite(ctx, tubeRing(L.rg, L.tg, 'dark', 200), cx, cy, G0, G1);
    // ticks every 30 rpm
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let r = 0; r <= RPM_MAX; r += 30) {
      const a = ang(r), big = r % 60 === 0;
      for (let d = -2; d <= (big ? 3 : 1); d++) ctx.fillRect(Math.round(cx + Math.cos(a) * (L.rg + d)), Math.round(cy + Math.sin(a) * (L.rg + d)), 1, 1);
    }
    const band = B?.band;
    if (band) {
      // the danger zone above the band
      const top = band.rip !== undefined ? band.rip : band.hi;
      const dangerSpr = tubeRing(L.rg, L.tg, band.rip !== undefined ? 'red' : 'orange', 235);
      arcSprite(ctx, dangerSpr, cx, cy, ang(top), G1, band.rip !== undefined ? 0.95 : 0.55);
      // the sweet band (pulses when the needle is inside it)
      const inside = st === 'sweet';
      if (inside || B.gearMode === 'hook') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= inside ? 0.6 + 0.25 * Math.sin(t * 14) : 0.3;
        const am = ang((band.lo + band.hi) / 2), gr = Math.round(L.tg * 2.2);
        ctx.drawImage(glowSprite(gr, '#8be04a'), Math.round(cx + Math.cos(am) * L.rg - gr), Math.round(cy + Math.sin(am) * L.rg - gr));
        ctx.restore();
      }
      arcSprite(ctx, tubeRing(L.rg, L.tg, 'band', 255), cx, cy, ang(band.lo), ang(band.hi));
      // band edge brackets
      for (const r of [band.lo, band.hi]) {
        const a = ang(r);
        ctx.fillStyle = INK;
        pixelLine(ctx, cx + Math.cos(a) * (L.rg - L.tg * 0.75), cy + Math.sin(a) * (L.rg - L.tg * 0.75), cx + Math.cos(a) * (L.rg + L.tg * 0.75), cy + Math.sin(a) * (L.rg + L.tg * 0.75), 3);
        ctx.fillStyle = '#ffffff';
        pixelLine(ctx, cx + Math.cos(a) * (L.rg - L.tg * 0.6), cy + Math.sin(a) * (L.rg - L.tg * 0.6), cx + Math.cos(a) * (L.rg + L.tg * 0.6), cy + Math.sin(a) * (L.rg + L.tg * 0.6), 1);
      }
      // where the band is heading (surges): chevrons running along the gauge
      if (B.bandDir) {
        const am = ang(B.bandDir > 0 ? band.hi : band.lo), dirA = B.bandDir > 0 ? 1 : -1;
        for (let i = 0; i < 3; i++) {
          const ph = ((t * 3 + i / 3) % 1);
          const a = am + dirA * (0.08 + ph * 0.3);
          const x = cx + Math.cos(a) * (L.rg + L.tg + 6 * L.S), y = cy + Math.sin(a) * (L.rg + L.tg + 6 * L.S);
          ctx.fillStyle = rgba('#ffd23a', 1 - ph);
          ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
          ctx.fillStyle = rgba('#ffffff', 1 - ph);
          ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        }
      }
    }
    // needle: a white bar across the gauge and a glossy knob outside
    const rpm = clamp(this.rpmShown, 0, RPM_MAX);
    const a = ang(rpm);
    const ca = Math.cos(a), sa = Math.sin(a);
    const r0 = L.rg - L.tg, r1 = L.rg + L.tg + 3 * L.S;
    ctx.fillStyle = INK;
    pixelLine(ctx, cx + ca * r0, cy + sa * r0, cx + ca * r1, cy + sa * r1, 4);
    ctx.fillStyle = '#ffffff';
    pixelLine(ctx, cx + ca * (r0 + 1), cy + sa * (r0 + 1), cx + ca * (r1 - 1), cy + sa * (r1 - 1), 2);
    const kr = Math.max(4, Math.round(5 * L.S));
    const knob = sphere(kr, st === 'sweet' ? 'band' : st === 'over' ? 'orange' : st === 'rip' ? 'red' : 'aqua');
    const kx = Math.round(cx + ca * (r1 + kr)), ky = Math.round(cy + sa * (r1 + kr));
    ctx.drawImage(knob, kx - kr, ky - kr);
    if (st === 'sweet') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5;
      ctx.drawImage(glowSprite(kr * 3, '#8be04a'), kx - kr * 3, ky - kr * 3);
      ctx.restore();
    }
  }

  // Inner ring: catch progress (fight / box) or the hook-set meter + the bite window (hook).
  drawProgress(ctx, cx, cy, L, B) {
    if (!B) return;
    const top = -Math.PI / 2, t = this.t;
    arcSprite(ctx, tubeRing(L.rp, L.tp, 'dark', 190), cx, cy, 0, TAU);
    const k = this.prog;
    if (B.gearMode === 'hook') {
      // hook-set meter (gold) and the window running out (thin white -> red arc just inside)
      arcSprite(ctx, tubeRing(L.rp, L.tp, 'gold', 255), cx, cy, top, top + k * TAU);
      const tk = clamp01(B.timeK ?? 1);
      const rr = L.rp - L.tp - Math.round(3 * L.S);
      const blink = tk < 0.3 && Math.floor(t * 10) % 2;
      ctx.fillStyle = blink ? '#ffffff' : tk < 0.3 ? '#ff5a4a' : '#ffffff';
      const n = Math.round(rr * TAU * tk * 0.7);
      for (let i = 0; i <= n; i++) {
        const a = top + (i / Math.max(1, n)) * tk * TAU;
        ctx.fillRect(Math.round(cx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr) - 1, 2, 2);
      }
      return;
    }
    // line lost (ghost) in red behind the lime fill
    const ghost = clamp01(B.ghost ?? 0);
    if (ghost > k + 0.003) arcSprite(ctx, tubeRing(L.rp, L.tp, 'red', 255), cx, cy, top + k * TAU, top + ghost * TAU, 0.8);
    arcSprite(ctx, tubeRing(L.rp, L.tp, B.stunned ? 'aqua' : 'lime', 255), cx, cy, top, top + k * TAU);
    if (this.kickK > 0.05) arcSprite(ctx, tubeRing(L.rp, L.tp, 'white', 255), cx, cy, top, top + k * TAU, this.kickK * 0.7);
    // the head of the fill: a glossy bead with a glint
    if (k > 0.01) {
      const a = top + k * TAU, br = Math.max(3, Math.round(L.tp * 0.62));
      const bx = Math.round(cx + Math.cos(a) * L.rp), by = Math.round(cy + Math.sin(a) * L.rp);
      ctx.drawImage(sphere(br, 'white'), bx - br, by - br);
    }
  }

  // The charge ring over the gear face: fill, the PERFECT window and the overcharge zone.
  drawCharge(ctx, cx, cy, L, B) {
    const c = B.charge, w = B.chargeWin || { lo: 0.7, hi: 0.85 };
    const t = this.t, top = -Math.PI / 2;
    const r = Math.round(L.R * 0.5), th = Math.max(7, Math.round(9 * L.S));
    arcSprite(ctx, tubeRing(r, th, 'dark', 230), cx, cy, 0, TAU);
    arcSprite(ctx, tubeRing(r, th, 'red', 200), cx, cy, top + w.hi * TAU, top + TAU, 0.75);
    const inWin = c.k >= w.lo && c.k <= w.hi;
    arcSprite(ctx, tubeRing(r, th, 'gold', 255), cx, cy, top, top + Math.min(c.k, w.lo) * TAU);
    if (c.k > w.hi) arcSprite(ctx, tubeRing(r, th, 'red', 255), cx, cy, top + w.hi * TAU, top + c.k * TAU);
    // the perfect window: bright white band, glowing while the charge is inside it
    arcSprite(ctx, tubeRing(r, th, 'white', 255), cx, cy, top + w.lo * TAU, top + w.hi * TAU, inWin ? 1 : 0.65);
    if (inWin) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= 0.7 + 0.3 * Math.sin(t * 40);
      ctx.drawImage(glowSprite(Math.round(r * 1.3), '#fff6c0'), cx - Math.round(r * 1.3), cy - Math.round(r * 1.3));
      ctx.restore();
    }
    // pointer
    const a = top + Math.min(1, c.k) * TAU;
    const kr = Math.max(4, Math.round(th * 0.6));
    const px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r);
    ctx.drawImage(sphere(kr, c.k > w.hi ? 'red' : inWin ? 'white' : 'gold'), px - kr, py - kr);
    // a crackle between the pointer and the teeth
    if (Math.random() < 0.6) drawBolt(ctx, boltPoints(px, py, cx + Math.cos(a + 0.4) * L.R, cy + Math.sin(a + 0.4) * L.R, 4, (Math.random() * 1e9) >>> 0), 0.8, c.k > w.hi ? '#ff9a7a' : '#fff07a');
    // RELEASE! / overcharge warning over the hub
    const label = inWin ? 'NOW!' : c.k > w.hi ? 'TOO MUCH!' : '';
    if (label) {
      const s = Math.max(1, Math.round(2 * L.S));
      drawText(ctx, label, cx, cy - Math.round(4 * s), { scale: s, align: 'center', color: inWin ? '#fff6c0' : '#ffd0c8', outline: inWin ? '#5a3a00' : '#5a0a10' });
    }
  }

  // Big glossy RPM number on a glass pill in the gauge's gap, with a spin prompt while the gear is too slow.
  drawReadout(ctx, cx, cy, L, B, st) {
    const t = this.t, S = L.S;
    const rpm = Math.max(0, Math.round(this.rpmShown));
    const pal = st === 'sweet' ? 'lime' : st === 'over' ? 'sun' : st === 'rip' ? 'red' : 'aqua';
    const ds = Math.max(2, Math.round(3 * S));
    const digits = String(rpm).split('').map((d) => glossText(d, ds, pal));
    const adv = (g) => g.w + ds;
    const tw = digits.reduce((a, g) => a + adv(g), -ds);
    const y = Math.round(cy + L.rg + L.tg * 0.2);
    const ph = 7 * ds + 10, pw = Math.max(tw + 26, Math.round(64 * S));
    drawPillGlass(ctx, cx, y - Math.round(ph / 2), pw, ph);
    let x = Math.round(cx - tw / 2);
    for (const g of digits) { ctx.drawImage(g.c, x - g.ox, Math.round(y - g.h / 2 - g.oy)); x += adv(g); }
    drawText(ctx, 'RPM', cx + Math.round(pw / 2) + 3, y - 2, { font: 'small', scale: Math.max(1, Math.round(S)), color: '#e8fbff', outline: INK });
    // spin prompt: circling arrows beside the gauge while the gear is too slow
    if (B && (st === 'idle' || st === 'slow') && !B.charge && !B.stunned && B.gearMode !== 'box') {
      const g = spinGlyph();
      const gs = Math.max(2, Math.round(S * 2));
      const gx = Math.round(cx - L.rg - L.tg - g.width * gs - 6 * S), gy = Math.round(cy + L.rg * 0.35);
      ctx.save();
      ctx.translate(gx + (g.width * gs) / 2, gy + (g.height * gs) / 2);
      ctx.rotate(Math.floor(t * 8) * (Math.PI / 4) * (this.dir || 1));
      ctx.drawImage(g, Math.round((-g.width * gs) / 2), Math.round((-g.height * gs) / 2), g.width * gs, g.height * gs);
      ctx.restore();
      if (B.gearMode === 'hook') {
        const k = 1 + Math.max(0, Math.sin(t * 9)) * 0.08;
        const sg = glossText('SPIN!', Math.max(3, Math.round(4 * S)), 'sun');
        ctx.save();
        ctx.translate(cx, Math.round(cy - L.rg - L.tg - 26 * S));
        ctx.scale(k, k);
        ctx.drawImage(sg.c, Math.round(-sg.w / 2 - sg.ox), Math.round(-sg.h / 2 - sg.oy));
        ctx.restore();
      }
    }
  }

  // Tension: a tall glossy glass capsule left of the gear.
  drawTension(ctx, x, y, L, B, T) {
    const w = L.tw, h = L.th, t = this.t;
    const back = tubeGlass(w, h, false), front = tubeGlass(w, h, true);
    ctx.drawImage(back, x - 1, y - 1);
    const lvl = clamp01(T);
    const fillH = Math.round((h - 4) * lvl);
    const danger = T > 0.9;
    for (let i = 0; i < fillH; i++) {
      const yy = y + h - 2 - i;
      const k = i / (h - 4);
      const r = w / 2;
      const dyc = yy - y < r ? r - (yy - y) - 0.5 : yy - y > h - r ? (yy - y) - (h - r) + 0.5 : 0;
      const half = Math.floor(Math.sqrt(Math.max(0, (r - 1.5) ** 2 - dyc * dyc)));
      if (half <= 0) continue;
      let col = tensionColor(k);
      if (danger && Math.floor(t * 12) % 2) col = i > fillH - 6 ? '#ffffff' : '#ff4f5e';
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x + r - half), yy, half * 2, 1);
      if (i === fillH - 1 || i === fillH - 2) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(Math.round(x + r - half), yy, half * 2, 1); }
    }
    // the red line near the top: past it the line can snap
    const ry = Math.round(y + 2 + (h - 4) * 0.1);
    ctx.fillStyle = INK; ctx.fillRect(x - 3, ry - 1, w + 6, 3);
    ctx.fillStyle = '#ff4f5e'; ctx.fillRect(x - 2, ry, w + 4, 1);
    ctx.drawImage(front, x - 1, y - 1);
    if (danger) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= 0.45 + 0.35 * Math.sin(t * 24);
      const gr = Math.round(w * 1.6);
      ctx.drawImage(glowSprite(gr, '#ff4f5e'), Math.round(x + w / 2 - gr), Math.round(y + 6 - gr));
      ctx.restore();
    }
    // snap timer: a red flare growing at the top
    if (B.snapT > 0) {
      const k = clamp01(B.snapT / (B.grace || 1));
      const r = Math.round(6 + k * 14 * L.S);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= k;
      ctx.drawImage(glowSprite(r, '#ff4f5e'), Math.round(x + w / 2 - r), Math.round(y - r));
      ctx.restore();
    }
    // a little line-and-hook glyph under the tube
    const gx = Math.round(x + w / 2), gy = y + h + Math.round(5 * L.S);
    ctx.fillStyle = INK; ctx.fillRect(gx - 1, gy - 1, 3, 8); ctx.fillRect(gx - 4, gy + 4, 3, 5); ctx.fillRect(gx - 4, gy + 7, 8, 3);
    ctx.fillStyle = '#e8f6fc'; ctx.fillRect(gx, gy, 1, 8); ctx.fillRect(gx - 3, gy + 5, 1, 3); ctx.fillRect(gx - 3, gy + 8, 6, 1);
  }

  // Shock charges as glossy bolt orbs above the gear, a cooldown sweep and the hold hint.
  drawShock(ctx, cx, cy, L, B) {
    const t = this.t, S = L.S;
    const n = B.shockMax;
    const r = Math.max(8, Math.round(12 * S)), gap = r * 2 + Math.round(6 * S);
    const y = Math.round(cy - L.rg - L.tg - r - 10 * S);
    const ready = !!B.canCharge;
    const cdK = B.shockCdMax ? clamp01(B.shockCd / B.shockCdMax) : 0;
    const x0 = Math.round(cx - ((n - 1) * gap) / 2);
    for (let i = 0; i < n; i++) {
      const has = i < B.charges;
      const x = x0 + i * gap;
      const charging = B.charge && i === B.charges - 1;
      const orb = sphere(r, has ? (charging && B.charge.k > (B.chargeWin?.hi ?? 1) ? 'red' : 'gold') : 'grey');
      const den = this.denied > 0 ? Math.round(Math.sin(t * 60) * 2 * this.denied) : 0;
      if (has && (ready || charging)) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= (charging ? 0.5 + B.charge.k * 0.5 : 0.3 + 0.2 * Math.sin(t * 6 + i)) + this.fire * 0.5;
        ctx.drawImage(glowSprite(r + 8, '#ffe27a'), x - r - 8, y - r - 8);
        ctx.restore();
      }
      ctx.drawImage(orb, x - r + den, y - r);
      // cooldown sweep on the next orb
      if (has && i === B.charges - 1 && cdK > 0) {
        ctx.fillStyle = 'rgba(12,58,82,0.55)';
        const a1 = -Math.PI / 2 + cdK * TAU;
        for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
          if (xx * xx + yy * yy > r * r) continue;
          let a = Math.atan2(yy, xx);
          if (a < -Math.PI / 2) a += TAU;
          if (a <= a1) ctx.fillRect(x + xx, y + yy, 1, 1);
        }
      }
      const gl = boltGlyph(has ? '#ffffff' : '#c8d4dc');
      ctx.drawImage(gl, x - Math.floor(gl.width / 2) + den, y - Math.floor(gl.height / 2));
    }
    // hold hint: the mouse / Space glyphs, lit while charging
    if (ready || B.charge) {
      const lit = !!B.charge || Math.floor(t * 3) % 2 === 0;
      const ms = mouseGlyph(lit), sg = spaceGlyph(lit);
      const hx = Math.round(x0 + (n - 1) * gap + r + 6 * S);
      const s = Math.max(1, Math.round(S));
      ctx.drawImage(ms, hx, y - Math.round(ms.height * s / 2), ms.width * s, ms.height * s);
      ctx.drawImage(sg, hx + ms.width * s + 3, y - Math.round(sg.height * s / 2), sg.width * s, sg.height * s);
      if (!B.charge) drawText(ctx, 'HOLD', hx, y + Math.round(7 * s), { font: 'small', scale: s, color: '#fff6c0', outline: INK });
    }
  }
}

export function gearPreviewMeshes() { return gearMeshes(); }
void measureText;
