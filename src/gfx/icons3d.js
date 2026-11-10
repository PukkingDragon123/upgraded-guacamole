// [phase9:ui] 3D icons for the whole UI (no 2D pixel icons): glossy low-poly models for every small UI icon name
// (src/gfx/uiicons.js) and the Lab's stat glyphs, rendered smooth at full resolution through bigicons.modelFrame
// (lowpoly.js WebGL, 2x twins). Units -1..1, y up, +z toward the camera.
//   ICON3D { name: () => model }        model = {mesh, over?, glass?, glassAlpha?, yaw, pitch, spin: 'full'|'wobble'}
//   has3D(name) -> bool
//   icon3d(name, w, h) -> canvas | null           a still (logical w x h, `.hi` twin, `.__icon3d = name`)
//   icon3dFrame(name, px, turn) -> {canvas, ox, oy} | null      one turn step (idle wobble / hover spin)
//   drawIcon3D(ctx, name, cx, cy, px, {t, hover 0..1, phase}) -> bool   centred, gently rocking, spinning on hover
import { MeshBuilder } from './lowpoly.js';
import { lathe, prism, ringPrism, sphere, tube, box, jit, ICON_MODELS, GEM_MODEL } from './iconmeshes.js';
import { modelFrame, modelSpin } from './bigicons.js';
import { mix, shade } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { HI } from './hires.js';

const TAU = Math.PI * 2;
const circ = (n, r, cx = 0, cy = 0, a0 = 0, sy = 1) => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * TAU; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]; });
const starPts = (n, r1, r2, cx = 0, cy = 0, a0 = Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => { const a = a0 + (i / (n * 2)) * TAU, r = i % 2 ? r2 : r1; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const heartPts = (n, s = 1, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => { const t = (i / n) * TAU; const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); return [cx + (x / 17) * s, cy + (y / 17) * s + 0.08 * s]; });
const rot = (pts, a, cx = 0, cy = 0) => pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
// thick extruded badge shape: front face lighter, sides darker
const slab = (mb, pts, d, col, o = {}) => prism(mb, pts, -d, d, col, { front: (i) => jit(mix(col, '#ffffff', o.light ?? 0.18), i, 0.04), side: shade(col, -0.22), back: shade(col, -0.35) });
const M = (mb, o = {}) => ({ mesh: mb.build(o.smooth ? { smooth: o.smooth } : {}), yaw: o.yaw ?? 0.42, pitch: o.pitch ?? 0.22, spin: o.spin || 'wobble', ...(o.extra || {}) });
const W = 'wobble', F = 'full';

// a coin-like disc facing the camera (extruded circle), radius r, half-depth d
function disc(mb, r, d, col, cx = 0, cy = 0) { return prism(mb, circ(20, r, cx, cy), -d, d, col, { front: (i) => jit(mix(col, '#ffffff', 0.15), i, 0.03), side: shade(col, -0.25) }); }

// arrow pointing right, then rotated
function arrow(a, col = '#35c8ff') {
  return () => { const mb = new MeshBuilder(); slab(mb, rot([[-0.8, -0.24], [0.1, -0.24], [0.1, -0.62], [0.86, 0], [0.1, 0.62], [0.1, 0.24], [-0.8, 0.24]], a), 0.2, col); return M(mb); };
}
function cloudInto(mb, col = '#ffffff', y = 0.1) {
  for (const [x, yy, r] of [[-0.45, y - 0.08, 0.36], [0, y + 0.12, 0.48], [0.45, y - 0.04, 0.38], [0.1, y - 0.16, 0.4]]) sphere(mb, [x, yy, 0], [r, r * 0.9, r * 0.75], 1, (c, i) => jit(c[1] > 0 ? col : shade(col, -0.12), i, 0.04));
}
function boltPts(s = 1, cx = 0, cy = 0) { return [[0.18, 0.95], [-0.5, -0.08], [-0.04, -0.08], [-0.22, -0.95], [0.52, 0.12], [0.06, 0.12]].map(([x, y]) => [cx + x * s, cy + y * s]); }
function crossPts(t = 0.24, L = 0.86) {
  const p = [[t, 0], [L, L - t], [L - t, L], [0, t], [-(L - t), L], [-L, L - t], [-t, 0], [-L, -(L - t)], [-(L - t), -L], [0, -t], [L - t, -L], [L, -(L - t)]];
  return p;
}
function face2(mb, eyes = '#1c2c44', mouth = 'smile', z = 0.62) {
  for (const s of [-1, 1]) { sphere(mb, [s * 0.27, 0.16, z], [0.11, 0.16, 0.1], 1, eyes); sphere(mb, [s * 0.27 - 0.04, 0.22, z + 0.08], 0.04, 0, '#ffffff'); }
  const R = 0.075;
  if (mouth === 'smile') tube(mb, [[-0.3, -0.12, z - 0.06], [-0.15, -0.3, z], [0.15, -0.3, z], [0.3, -0.12, z - 0.06]], R, 5, '#7a1e3a');
  else if (mouth === 'frown') tube(mb, [[-0.26, -0.36, z - 0.06], [-0.1, -0.22, z], [0.1, -0.22, z], [0.26, -0.36, z - 0.06]], R, 5, '#3a2a5a');
  else if (mouth === 'flat') tube(mb, [[-0.22, -0.26, z - 0.02], [0.22, -0.26, z - 0.02]], R, 5, '#3a2a5a');
  else sphere(mb, [0, -0.27, z - 0.02], [0.17, 0.19, 0.1], 1, '#c8344c');
}

export const ICON3D = {
  // ---- marks
  check: () => { const mb = new MeshBuilder(); slab(mb, [[-0.86, 0.06], [-0.6, 0.32], [-0.22, -0.06], [0.62, 0.8], [0.88, 0.54], [-0.22, -0.6]], 0.2, '#4cc83a'); return M(mb); },
  cross: () => { const mb = new MeshBuilder(); slab(mb, crossPts(), 0.2, '#ff4f5e'); return M(mb); },
  plus: () => { const mb = new MeshBuilder(); slab(mb, [[-0.24, 0.8], [0.24, 0.8], [0.24, 0.24], [0.8, 0.24], [0.8, -0.24], [0.24, -0.24], [0.24, -0.8], [-0.24, -0.8], [-0.24, -0.24], [-0.8, -0.24], [-0.8, 0.24], [-0.24, 0.24]], 0.2, '#4cc83a'); return M(mb); },
  minus: () => { const mb = new MeshBuilder(); slab(mb, [[-0.8, -0.24], [0.8, -0.24], [0.8, 0.24], [-0.8, 0.24]], 0.2, '#35a8f0'); return M(mb); },
  star: () => { const mb = new MeshBuilder(); const o = starPts(5, 0.95, 0.42, 0, -0.05); slab(mb, o, 0.16, '#ffc93a'); sphere(mb, [0, -0.05, 0.12], [0.3, 0.3, 0.14], 1, '#ffe98a'); return M(mb, { spin: F }); },
  star_empty: () => { const mb = new MeshBuilder(); ringPrism(mb, starPts(5, 0.95, 0.42, 0, -0.05), starPts(5, 0.62, 0.27, 0, -0.05), -0.14, 0.14, '#c8d8e8', { front: (i) => jit('#eef6fc', i, 0.04) }); return M(mb, { spin: F }); },
  sparkle: () => { const mb = new MeshBuilder(); slab(mb, starPts(4, 0.95, 0.24, 0, 0, 0), 0.14, '#fff2a0', { light: 0.5 }); slab(mb, starPts(4, 0.36, 0.1, 0.62, 0.62, 0), 0.1, '#ffffff'); return M(mb, { spin: F }); },
  heart: () => { const mb = new MeshBuilder(); slab(mb, heartPts(28, 0.9), 0.22, '#ff4f7a'); sphere(mb, [-0.36, 0.32, 0.18], [0.14, 0.1, 0.06], 0, '#ffd0dc'); return M(mb, { spin: F }); },
  heart_empty: () => { const mb = new MeshBuilder(); ringPrism(mb, heartPts(28, 0.92), heartPts(28, 0.58), -0.16, 0.16, '#ff8aa8', { front: (i) => jit('#ffb0c8', i, 0.04) }); return M(mb, { spin: F }); },
  exclaim: () => { const mb = new MeshBuilder(); slab(mb, [[-0.2, 0.92], [0.2, 0.92], [0.13, -0.32], [-0.13, -0.32]], 0.18, '#ffa83c'); sphere(mb, [0, -0.7, 0], 0.2, 1, '#ffa83c'); return M(mb); },
  question: () => { const mb = new MeshBuilder(); const p = []; for (let i = 0; i <= 10; i++) { const a = Math.PI * 1.05 - (i / 10) * Math.PI * 1.45; p.push([Math.cos(a) * 0.44, 0.42 + Math.sin(a) * 0.44, 0]); } p.push([0, -0.2, 0]); tube(mb, p, 0.15, 7, (i, j) => jit('#35c8ff', i + j, 0.05)); sphere(mb, [0, -0.7, 0], 0.19, 1, '#35c8ff'); return M(mb); },
  info: () => { const mb = new MeshBuilder(); disc(mb, 0.9, 0.14, '#2f9ef0'); box(mb, -0.12, -0.55, 0.12, 0.12, 0.15, 0.24, '#ffffff'); sphere(mb, [0, 0.42, 0.18], 0.15, 1, '#ffffff'); return M(mb, { spin: F }); },
  // ---- arrows
  arrow_r: arrow(0), arrow_l: arrow(Math.PI), arrow_u: arrow(Math.PI / 2), arrow_d: arrow(-Math.PI / 2),
  play: () => { const mb = new MeshBuilder(); slab(mb, [[-0.6, -0.8], [0.8, 0], [-0.6, 0.8]], 0.2, '#4cc83a'); return M(mb); },
  pause: () => { const mb = new MeshBuilder(); for (const x of [-0.36, 0.36]) box(mb, x - 0.18, -0.75, -0.18, x + 0.18, 0.75, 0.18, '#35a8f0'); return M(mb); },
  minimize: () => { const mb = new MeshBuilder(); box(mb, -0.75, -0.7, -0.16, 0.75, -0.36, 0.16, '#35a8f0'); return M(mb); },
  expand: () => { const mb = new MeshBuilder(); ringPrism(mb, [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]], [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], -0.16, 0.16, '#35a8f0'); return M(mb); },
  // ---- money
  coin: () => ICON_MODELS.coin(), aero: () => ICON_MODELS.coin(), coin_big: () => ICON_MODELS.coin(), aero_big: () => ICON_MODELS.coin(),
  dollar: () => { const mb = new MeshBuilder(); disc(mb, 0.9, 0.16, '#ffc23a'); disc(mb, 0.62, 0.2, '#ffe066'); box(mb, -0.06, -0.5, 0.18, 0.06, 0.5, 0.24, '#d8901c'); return M(mb, { spin: F }); },
  // ---- fishing
  hook: () => { const mb = new MeshBuilder(); const p = [[0.1, 0.9, 0], [0.1, -0.25, 0]]; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 1.15; p.push([-0.22 + Math.cos(a) * 0.32, -0.25 - Math.sin(a) * 0.42, 0]); } tube(mb, p, 0.09, 6, (i, j) => jit('#c8d8e8', i + j, 0.06)); lathe(mb, [[0.2, -0.06], [0.2, 0.06]], 8, '#8ea8c0', { x: 0.1, y: 0.96, capTop: true, capBottom: true }); slab(mb, [[-0.6, -0.12], [-0.4, -0.02], [-0.5, 0.18]], 0.06, '#e8f4fc'); return M(mb); },
  line: () => { const mb = new MeshBuilder(); lathe(mb, [[0.62, -0.5], [0.62, -0.4], [0.36, -0.36], [0.4, 0.36], [0.62, 0.4], [0.62, 0.5]], 14, (i, j) => (i === 2 ? jit('#ffffff', j, 0.05) : jit('#ff9d2e', j, 0.05)), { capTop: true, capBottom: true, capCol: '#ffc06a' }); tube(mb, [[0.4, 0.1, 0.2], [0.9, 0.7, 0.1]], 0.025, 4, '#ffffff'); return { ...M(mb, { spin: F }), pitch: 0.3 }; },
  reel: () => { const mb = new MeshBuilder(); disc(mb, 0.85, 0.18, '#2486e0'); disc(mb, 0.5, 0.24, '#5cc6ff'); tube(mb, [[0, 0, 0.26], [0.5, 0.45, 0.3]], 0.08, 5, '#dceaf6'); sphere(mb, [0.55, 0.5, 0.36], 0.16, 1, '#ff5a6a'); return M(mb, { spin: F }); },
  net: () => { const mb = new MeshBuilder(); const rim = circ(14, 0.55, 0.15, 0.25).map(([x, y]) => [x, y, 0]); rim.push(rim[0]); tube(mb, rim, 0.07, 5, '#c8a070', { caps: false }); tube(mb, [[-0.25, -0.15, 0], [-0.85, -0.85, 0]], 0.08, 5, '#a8784a'); for (let i = -2; i <= 2; i++) { tube(mb, [[0.15 + i * 0.2, 0.75, -0.02], [0.15 + i * 0.2, -0.25, -0.02]], 0.018, 3, '#ffffff', { caps: false }); tube(mb, [[-0.35, 0.25 + i * 0.2, -0.02], [0.65, 0.25 + i * 0.2, -0.02]], 0.018, 3, '#ffffff', { caps: false }); } return M(mb); },
  bait: () => ICON_MODELS.bait(),
  worm: () => { const mb = new MeshBuilder(); const p = []; for (let i = 0; i <= 14; i++) { const k = i / 14; p.push([-0.85 + k * 1.7, Math.sin(k * TAU * 1.2) * 0.32, Math.cos(k * TAU) * 0.1]); } tube(mb, p, (i) => 0.19 - Math.abs(i - 7) * 0.006, 7, (i, j) => jit(i % 3 ? '#ff8ab0' : '#e0507e', i * 7 + j, 0.05)); sphere(mb, [0.78, Math.sin(1.2 * TAU) * 0.32 + 0.06, 0.18], 0.06, 0, '#1c2c44'); return M(mb, { spin: W }); },
  coral: () => { const mb = new MeshBuilder(); const br = (a, b, r) => tube(mb, [a, b], r, 6, (i, j) => jit('#ff74b4', j, 0.08)); br([0, -0.9, 0], [0, 0.1, 0], 0.16); br([0, -0.2, 0], [-0.55, 0.45, 0.05], 0.11); br([0, 0, 0], [0.5, 0.7, -0.05], 0.11); br([-0.55, 0.45, 0.05], [-0.5, 0.85, 0], 0.08); br([0, 0.1, 0], [0.05, 0.75, 0.1], 0.1); for (const p of [[-0.5, 0.85, 0], [0.5, 0.7, -0.05], [0.05, 0.75, 0.1]]) sphere(mb, p, 0.13, 1, '#ffb0d8'); return M(mb, { spin: F }); },
  // ---- tools & objects
  book: () => ICON_MODELS.journal(),
  map: () => ICON_MODELS.map(), globe: () => ICON_MODELS.map(),
  shop: () => ICON_MODELS.shop(),
  tank: () => ICON_MODELS.aquarium(),
  gear: () => { const mb = new MeshBuilder(); const out = [], inn = []; const n = 32; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const tooth = Math.floor(i / 2) % 2 === 0; out.push([Math.cos(a) * (tooth ? 0.95 : 0.74), Math.sin(a) * (tooth ? 0.95 : 0.74)]); inn.push([Math.cos(a) * 0.3, Math.sin(a) * 0.3]); } ringPrism(mb, out, inn, -0.2, 0.2, '#b4c8dc', { front: (i) => jit('#e4f0fa', i, 0.05) }); return M(mb, { spin: F }); },
  settings: () => ICON_MODELS.settings(),
  hammer: () => { const mb = new MeshBuilder(); tube(mb, [[-0.1, -0.95, 0], [0.05, 0.45, 0]], 0.1, 6, (i, j) => jit('#c8904a', j, 0.06)); box(mb, -0.55, 0.38, -0.22, 0.6, 0.8, 0.22, { top: '#e4eef8', front: '#b8c8d8', side: '#8ea2b8', back: '#7a8ea4' }); return M(mb); },
  trash: () => { const mb = new MeshBuilder(); lathe(mb, [[0.5, -0.9], [0.62, 0.5]], 10, (i, j) => jit(j % 2 ? '#9aaabb' : '#b8c8d8', j, 0.04), { capBottom: true }); lathe(mb, [[0.72, 0.5], [0.72, 0.66], [0.2, 0.7], [0.2, 0.86]], 10, '#d8e4f0', { capTop: true }); return M(mb, { spin: F }); },
  home: () => { const mb = new MeshBuilder(); box(mb, -0.62, -0.85, -0.5, 0.62, 0.15, 0.5, { top: '#ffffff', front: '#fff4dc', side: '#e8d4b0', back: '#d8c4a0' }); prism(mb, [[-0.85, 0.1], [0, 0.85], [0.85, 0.1]], -0.62, 0.62, '#ff5a5a', { front: '#ff7a6a', side: '#d83a3a' }); box(mb, -0.18, -0.85, 0.5, 0.18, -0.25, 0.56, '#8a5a30'); box(mb, 0.28, -0.4, 0.5, 0.5, -0.15, 0.56, '#7fdcfa'); return M(mb); },
  lock: () => { const mb = new MeshBuilder(); box(mb, -0.62, -0.85, -0.3, 0.62, 0.15, 0.3, { top: '#ffe98a', front: '#ffc23a', side: '#d8901c', back: '#b0700a' }); const p = []; for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; p.push([Math.cos(a) * 0.38, 0.15 + Math.sin(a) * 0.55, 0]); } tube(mb, p, 0.09, 6, '#c8d8e8'); sphere(mb, [0, -0.32, 0.3], [0.1, 0.14, 0.05], 0, '#5a3206'); return M(mb); },
  unlock: () => { const mb = new MeshBuilder(); box(mb, -0.62, -0.85, -0.3, 0.62, 0.15, 0.3, { top: '#d8ffa0', front: '#7ed957', side: '#4cb424', back: '#2c961c' }); const p = []; for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; p.push([0.38 + Math.cos(a) * 0.38, 0.45 + Math.sin(a) * 0.5, 0]); } tube(mb, p, 0.09, 6, '#c8d8e8'); return M(mb); },
  camera: () => { const mb = new MeshBuilder(); box(mb, -0.85, -0.55, -0.35, 0.85, 0.45, 0.35, { top: '#5a6a80', front: '#3c4a5c', side: '#2a3444', back: '#2a3444' }); box(mb, -0.6, 0.45, -0.25, -0.2, 0.62, 0.25, '#3c4a5c'); disc(mb, 0.38, 0.5, '#1c2c44', 0, -0.05); disc(mb, 0.26, 0.56, '#5cc6ff', 0, -0.05); return M(mb); },
  trophy: () => { const mb = new MeshBuilder(); lathe(mb, [[0.42, -0.95], [0.42, -0.8], [0.12, -0.7], [0.1, -0.3], [0.3, -0.2], [0.62, 0.3], [0.68, 0.8]], 12, (i, j) => jit(i < 2 ? '#b0700a' : '#ffc93a', i * 12 + j, 0.05), { capBottom: true, capTop: true, capCol: '#e8a020' }); for (const s of [-1, 1]) tube(mb, [[s * 0.62, 0.6, 0], [s * 0.92, 0.45, 0], [s * 0.82, 0.1, 0], [s * 0.5, 0.0, 0]], 0.06, 5, '#ffd84a'); return M(mb, { spin: F }); },
  crown: () => { const mb = new MeshBuilder(); prism(mb, [[-0.85, -0.55], [0.85, -0.55], [0.9, 0.55], [0.45, 0.05], [0, 0.7], [-0.45, 0.05], [-0.9, 0.55]], -0.3, 0.3, '#ffc93a', { front: (i) => jit('#ffe066', i, 0.05), side: '#d8901c' }); for (const [x, y, c] of [[-0.9, 0.62, '#ff5a6a'], [0, 0.78, '#5cc6ff'], [0.9, 0.62, '#7ed957']]) sphere(mb, [x, y, 0], 0.13, 1, c); sphere(mb, [0, -0.22, 0.32], 0.14, 1, '#ff5a6a'); return M(mb, { spin: F }); },
  food: () => { const mb = new MeshBuilder(); lathe(mb, [[0.5, -0.9], [0.55, 0.3], [0.45, 0.42]], 10, (i, j) => jit('#ff9d2e', i * 10 + j, 0.05), { capBottom: true }); lathe(mb, [[0.5, 0.42], [0.5, 0.7]], 10, '#5cc6ff', { capTop: true, capCol: '#a8ecff' }); for (let i = 0; i < 6; i++) sphere(mb, [Math.cos(i * 1.1) * 0.28, -0.2 + (i % 3) * 0.2, 0.5], 0.08, 0, ['#ffe066', '#ff5a5a', '#7ed957'][i % 3]); box(mb, -0.4, -0.3, 0.5, 0.4, 0.1, 0.54, '#ffffff'); return M(mb, { spin: F }); },
  bubble: () => { const glass = new MeshBuilder(); sphere(glass, [0, 0, 0], 0.85, 2, '#c8f6ff'); const mb = new MeshBuilder(); sphere(mb, [-0.32, 0.36, 0.62], [0.2, 0.14, 0.08], 1, '#ffffff'); return { mesh: mb.build(), glass: glass.build(), glassAlpha: 0.45, yaw: 0, pitch: 0.1, spin: F }; },
  skull: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0.1, 0], [0.72, 0.68, 0.64], 1, (c, i) => jit('#f4f0e4', i, 0.04)); box(mb, -0.36, -0.75, -0.3, 0.36, -0.35, 0.36, '#e8e0cc'); for (const s of [-1, 1]) sphere(mb, [s * 0.26, 0.08, 0.52], [0.17, 0.2, 0.12], 0, '#2a1830'); return M(mb, { spin: W }); },
  clock: () => { const mb = new MeshBuilder(); disc(mb, 0.95, 0.16, '#35a8f0'); disc(mb, 0.78, 0.2, '#ffffff'); box(mb, -0.05, -0.04, 0.2, 0.05, 0.6, 0.26, '#1c2c44'); box(mb, -0.04, -0.05, 0.2, 0.45, 0.05, 0.26, '#1c2c44'); sphere(mb, [0, 0, 0.26], 0.08, 0, '#ff5a6a'); return M(mb); },
  eye: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0, 0], [0.9, 0.55, 0.45], 1, (c, i) => jit('#ffffff', i, 0.03)); sphere(mb, [0, 0, 0.32], [0.34, 0.34, 0.16], 1, '#2486e0'); sphere(mb, [0, 0, 0.42], [0.16, 0.16, 0.08], 0, '#0c1a2c'); sphere(mb, [-0.12, 0.12, 0.48], 0.05, 0, '#ffffff'); return M(mb, { yaw: 0.2 }); },
  music: () => { const mb = new MeshBuilder(); for (const x of [-0.45, 0.4]) { sphere(mb, [x, -0.6, 0], [0.28, 0.22, 0.2], 1, '#a674f4'); box(mb, x + 0.18, -0.6, -0.06, x + 0.28, 0.65, 0.06, '#7448c8'); } box(mb, -0.27, 0.48, -0.08, 0.68, 0.72, 0.08, '#a674f4'); return M(mb); },
  sound: () => { const mb = new MeshBuilder(); box(mb, -0.85, -0.3, -0.25, -0.45, 0.3, 0.25, '#5a6a80'); prism(mb, [[-0.45, -0.3], [0.05, -0.75], [0.05, 0.75], [-0.45, 0.3]], -0.3, 0.3, '#8ea2b8'); for (const r of [0.3, 0.55]) { const p = []; for (let i = 0; i <= 8; i++) { const a = -0.8 + (i / 8) * 1.6; p.push([0.15 + Math.cos(a) * r, Math.sin(a) * r, 0]); } tube(mb, p, 0.06, 4, '#35c8ff'); } return M(mb); },
  mute: () => { const mb = new MeshBuilder(); box(mb, -0.85, -0.3, -0.25, -0.45, 0.3, 0.25, '#5a6a80'); prism(mb, [[-0.45, -0.3], [0.05, -0.75], [0.05, 0.75], [-0.45, 0.3]], -0.3, 0.3, '#8ea2b8'); prism(mb, crossPts(0.1, 0.32).map(([x, y]) => [x + 0.55, y]), -0.12, 0.12, '#ff4f5e'); return M(mb); },
  mouse: mouseModel(0), mouse_l: mouseModel(-1), mouse_r: mouseModel(1), mouse_hold: mouseModel(-1, true),
  sun: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0, 0], 0.5, 1, (c, i) => jit('#ffd23a', i, 0.05)); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; prism(mb, rot([[0.6, -0.12], [0.95, 0], [0.6, 0.12]], a), -0.08, 0.08, '#ffb21a'); } return M(mb, { spin: F }); },
  moon: () => { const mb = new MeshBuilder(); const o = []; for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + (i / 16) * Math.PI; o.push([Math.cos(a) * 0.85, Math.sin(a) * 0.85]); } for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 - (i / 16) * Math.PI; o.push([0.3 + Math.cos(a) * 0.62, Math.sin(a) * 0.85]); } slab(mb, o, 0.2, '#ffe066'); return M(mb); },
  cloud: () => { const mb = new MeshBuilder(); cloudInto(mb); return M(mb, { spin: W }); },
  rain: () => { const mb = new MeshBuilder(); cloudInto(mb, '#dceaf6', 0.3); for (const x of [-0.4, 0, 0.4]) lathe(mb, [[0, -0.95], [0.1, -0.78], [0, -0.55]], 6, '#35c8ff', { x, z: 0.1 }); return M(mb, { spin: W }); },
  storm: () => { const mb = new MeshBuilder(); cloudInto(mb, '#8ea2b8', 0.3); slab(mb, boltPts(0.55, 0.05, -0.45), 0.1, '#ffe066'); return M(mb, { spin: W }); },
  bolt: () => { const mb = new MeshBuilder(); slab(mb, boltPts(1), 0.2, '#ffd23a', { light: 0.3 }); return M(mb); },
  battery: () => { const mb = new MeshBuilder(); box(mb, -0.42, -0.9, -0.3, 0.42, 0.7, 0.3, { top: '#e4eef8', front: '#b8c8d8', side: '#8ea2b8', back: '#7a8ea4' }); box(mb, -0.16, 0.7, -0.12, 0.16, 0.88, 0.12, '#dceaf6'); box(mb, -0.32, -0.8, 0.3, 0.32, 0.25, 0.34, '#5fd23a'); box(mb, -0.32, 0.3, 0.3, 0.32, 0.6, 0.33, '#2a4a3a'); return M(mb); },
  zzz: () => { const mb = new MeshBuilder(); const z = (s, cx, cy) => slab(mb, [[-0.5, 0.5], [0.5, 0.5], [0.5, 0.3], [-0.2, -0.32], [0.5, -0.32], [0.5, -0.5], [-0.5, -0.5], [-0.5, -0.3], [0.2, 0.32], [-0.5, 0.32]].map(([x, y]) => [cx + x * s, cy + y * s]), 0.12, '#a674f4'); z(0.9, -0.4, -0.4); z(0.6, 0.35, 0.25); z(0.4, 0.75, 0.75); return M(mb); },
  anger: () => { const mb = new MeshBuilder(); for (let i = 0; i < 4; i++) slab(mb, rot([[0.12, 0.14], [0.8, 0.14], [0.8, 0.36], [0.36, 0.36], [0.36, 0.8], [0.14, 0.8]], (i * Math.PI) / 2), 0.14, '#ff4f5e'); return M(mb); },
  sweat: () => { const mb = new MeshBuilder(); lathe(mb, [[0, -0.85], [0.45, -0.6], [0.55, -0.25], [0.38, 0.2], [0, 0.9]], 10, (i, j) => jit('#7fdcfa', i * 10 + j, 0.04)); return M(mb, { spin: F }); },
  // ---- lab glyphs
  magnet: () => { const mb = new MeshBuilder(); const p = []; for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI; p.push([Math.cos(a) * 0.5, -0.1 + Math.sin(a) * 0.55, 0]); } tube(mb, [[-0.5, 0.75, 0], ...p, [0.5, 0.75, 0]], 0.2, 7, (i) => (i === 0 || i === 12 ? '#e8f4fc' : '#ff4f5e')); return M(mb); },
  sonar: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0, 0], 0.2, 1, '#7ef0ff'); for (const r of [0.45, 0.72]) { const p = circ(16, r).map(([x, y]) => [x, y, 0]); p.push(p[0]); tube(mb, p, 0.06, 4, '#35c8ff', { caps: false }); } return M(mb, { spin: F }); },
  radar: () => { const mb = new MeshBuilder(); lathe(mb, [[0, -0.15], [0.6, 0], [0.95, 0.4]], 14, (i, j) => jit(j % 2 ? '#dceaf6' : '#b8c8d8', j, 0.05), { y: 0.1 }); tube(mb, [[0, -0.9, 0], [0, 0, 0]], 0.08, 5, '#8ea2b8'); sphere(mb, [0, 0.35, 0], 0.1, 0, '#ff5a6a'); return M(mb, { spin: F, pitch: 0.4 }); },
  lantern: () => { const mb = new MeshBuilder(); lathe(mb, [[0.42, -0.6], [0.5, -0.2], [0.42, 0.4]], 8, '#ffe066', { capTop: true, capBottom: true }); lathe(mb, [[0.5, -0.8], [0.5, -0.6]], 8, '#5a6a80', { capBottom: true, capTop: true }); lathe(mb, [[0.5, 0.4], [0.3, 0.6]], 8, '#5a6a80', { capTop: true }); const p = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; p.push([Math.cos(a) * 0.25, 0.65 + Math.sin(a) * 0.25, 0]); } tube(mb, p, 0.04, 4, '#8ea2b8'); return M(mb, { spin: F }); },
  engine: () => { const mb = new MeshBuilder(); box(mb, -0.75, -0.6, -0.4, 0.45, 0.4, 0.4, { top: '#e4eef8', front: '#b8c8d8', side: '#8ea2b8', back: '#7a8ea4' }); lathe(mb, [[0.3, -0.2], [0.3, 0.2]], 10, '#35a8f0', { x: 0.65, y: -0.1, capTop: true, capBottom: true }); box(mb, -0.5, 0.4, -0.2, -0.1, 0.65, 0.2, '#ff9d2e'); return M(mb); },
  compass: () => { const mb = new MeshBuilder(); disc(mb, 0.92, 0.14, '#c8a070'); disc(mb, 0.76, 0.18, '#fff8e8'); prism(mb, [[0, 0.68], [0.17, 0], [-0.17, 0]], 0.18, 0.28, '#ff4f5e'); prism(mb, [[0, -0.68], [-0.17, 0], [0.17, 0]], 0.18, 0.28, '#5a6a80'); sphere(mb, [0, 0, 0.3], 0.09, 0, '#ffd23a'); return M(mb); },
  people: () => ICON_MODELS.multiplayer(),
  egg: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0, 0], [0.62, 0.85, 0.62], 2, (c, i) => (Math.abs(c[1] - 0.2) < 0.18 && i % 3 ? '#ff9ed2' : jit('#fffbf0', i, 0.03))); return M(mb, { spin: W, smooth: 60 }); },
  dna: () => { const mb = new MeshBuilder(); const a = [], b = []; for (let i = 0; i <= 16; i++) { const k = i / 16, y = -0.9 + k * 1.8, ang = k * TAU * 1.1; a.push([Math.cos(ang) * 0.45, y, Math.sin(ang) * 0.45]); b.push([-Math.cos(ang) * 0.45, y, -Math.sin(ang) * 0.45]); if (i % 2 === 0 && i > 0 && i < 16) tube(mb, [a[i], b[i]], 0.04, 4, i % 4 ? '#ff5a6a' : '#7ed957', { caps: false }); } tube(mb, a, 0.08, 5, '#35c8ff'); tube(mb, b, 0.08, 5, '#a674f4'); return M(mb, { spin: F }); },
  clover: () => { const mb = new MeshBuilder(); for (let i = 0; i < 4; i++) slab(mb, rot(heartPts(18, 0.5).map(([x, y]) => [x, y + 0.45]), (i * Math.PI) / 2 + Math.PI), 0.1, i % 2 ? '#4cb424' : '#5fd23a'); tube(mb, [[0, 0, -0.05], [0.25, -0.6, -0.05], [0.4, -0.95, -0.05]], 0.06, 5, '#2c961c'); return M(mb, { spin: F }); },
  horseshoe: () => { const mb = new MeshBuilder(); const p = [[-0.6, -0.85, 0]]; for (let i = 0; i <= 12; i++) { const a = Math.PI - (i / 12) * Math.PI; p.push([Math.cos(a) * 0.6, -0.1 + Math.sin(a) * 0.75, 0]); } p.push([0.6, -0.85, 0]); tube(mb, p, 0.17, 7, (i, j) => jit('#ffc93a', i * 7 + j, 0.05)); return M(mb, { spin: W }); },
  rainbow: () => { const mb = new MeshBuilder(); ['#ff5a6a', '#ff9d2e', '#ffe066', '#7ed957', '#35c8ff'].forEach((c, k) => { const r = 0.9 - k * 0.15, p = []; for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI; p.push([Math.cos(a) * r, -0.45 + Math.sin(a) * r, 0]); } tube(mb, p, 0.075, 5, c); }); cloudInto(mb, '#ffffff', -0.55); return M(mb); },
  wifi: () => { const mb = new MeshBuilder(); for (const r of [0.35, 0.62, 0.9]) { const p = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.25 + (i / 8) * Math.PI * 0.5; p.push([Math.cos(a) * r, -0.7 + Math.sin(a) * r, 0]); } tube(mb, p, 0.08, 5, '#35c8ff'); } sphere(mb, [0, -0.62, 0], 0.13, 1, '#35c8ff'); return M(mb); },
  beaker: () => ICON_MODELS.lab(),
  decor: () => { const mb = new MeshBuilder(); lathe(mb, [[0.38, -0.95], [0.48, -0.45]], 8, '#c8784a', { capBottom: true, capTop: true }); tube(mb, [[0, -0.45, 0], [0, 0.35, 0]], 0.05, 4, '#4cb424'); slab(mb, rot(heartPts(14, 0.3), -0.8, 0, 0).map(([x, y]) => [x + 0.22, y - 0.1]), 0.05, '#5fd23a'); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; sphere(mb, [Math.cos(a) * 0.24, 0.55 + Math.sin(a) * 0.24, 0], 0.17, 1, '#ff9ed2'); } sphere(mb, [0, 0.55, 0.08], 0.13, 1, '#ffe066'); return M(mb, { spin: F }); },
  box: () => { const mb = new MeshBuilder(); box(mb, -0.75, -0.65, -0.6, 0.75, 0.55, 0.6, { top: '#e8b878', front: '#c8904a', side: '#a8743a', back: '#8a5a30' }); for (const x of [-0.45, 0.45]) box(mb, x - 0.08, -0.66, -0.61, x + 0.08, 0.56, 0.61, '#6a4a2a'); box(mb, -0.12, -0.1, 0.6, 0.12, 0.15, 0.64, '#ffd23a'); return M(mb); },
  snail: () => { const mb = new MeshBuilder(); sphere(mb, [-0.1, 0.1, 0], [0.6, 0.6, 0.45], 1, (c, i) => jit(Math.floor(Math.hypot(c[0], c[1]) * 4) % 2 ? '#ff9ed2' : '#e0549c', i, 0.03)); tube(mb, [[-0.8, -0.55, 0], [0.7, -0.55, 0], [0.8, -0.1, 0]], 0.17, 6, '#7ef0ff'); for (const z of [-0.1, 0.1]) { tube(mb, [[0.8, -0.1, z], [0.9, 0.3, z]], 0.03, 3, '#7ef0ff'); sphere(mb, [0.9, 0.32, z], 0.06, 0, '#1c2c44'); } return M(mb, { spin: W }); },
  crab: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0, 0], [0.62, 0.4, 0.45], 1, (c, i) => jit('#ff5a3a', i, 0.05)); for (const s of [-1, 1]) { tube(mb, [[s * 0.5, 0.05, 0.1], [s * 0.85, 0.35, 0.1]], 0.08, 5, '#ff5a3a'); sphere(mb, [s * 0.9, 0.48, 0.1], [0.2, 0.16, 0.14], 1, '#ff7a5a'); for (let i = 0; i < 3; i++) tube(mb, [[s * 0.4, -0.15, -0.2 + i * 0.2], [s * 0.8, -0.6, -0.2 + i * 0.2]], 0.04, 3, '#d83a2a'); tube(mb, [[s * 0.18, 0.3, 0.3], [s * 0.2, 0.55, 0.3]], 0.03, 3, '#ff5a3a'); sphere(mb, [s * 0.2, 0.6, 0.32], 0.08, 0, '#ffffff'); } return M(mb, { spin: W }); },
  // ---- items without a voxel model (workshop materials, Aero, blueprint scroll)
  coins: () => ICON_MODELS.coin(),
  scroll: () => { const mb = new MeshBuilder(); tube(mb, [[-0.75, 0.55, 0], [0.75, 0.55, 0]], 0.17, 8, (i, j) => jit('#f6e2b0', j, 0.05)); box(mb, -0.68, -0.6, -0.04, 0.68, 0.5, 0.04, { top: '#fff4dc', front: '#f6e8c8', side: '#e0c898', back: '#d8bc88' }); tube(mb, [[-0.75, -0.62, 0], [0.75, -0.62, 0]], 0.14, 8, '#e8cc98'); for (let i = 0; i < 3; i++) box(mb, -0.45, 0.25 - i * 0.22, 0.04, i === 2 ? 0.05 : 0.45, 0.31 - i * 0.22, 0.06, '#2f6ab0'); return M(mb); },
  fish_scale: () => { const mb = new MeshBuilder(); const o = circ(16, 0.8, 0, 0, 0, 1.05).map(([x, y]) => [x, y > 0.2 ? y : y * 0.85]); prism(mb, o, -0.08, 0.08, '#7fdcfa', { front: (i) => jit(i % 3 ? '#b8f0ff' : '#ffd0f0', i, 0.08), side: '#3aa0d0' }); for (const r of [0.55, 0.3]) { const p = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.15 + (i / 8) * Math.PI * 0.7; p.push([Math.cos(a) * r, -0.5 + Math.sin(a) * r * 1.6, 0.1]); } tube(mb, p, 0.03, 3, '#ffffff', { caps: false }); } return M(mb, { spin: F }); },
  fin_ribbon: () => { const mb = new MeshBuilder(); for (let i = 0; i < 9; i++) { const k = i / 8, k2 = (i + 1) / 8; const y = (q) => 0.7 - q * 1.5, x = (q) => Math.sin(q * 5) * 0.4, w = (q) => 0.35 * (1 - q * 0.5); const col = i % 2 ? '#ff9ed2' : '#a674f4'; mb.quad([x(k) - w(k), y(k), Math.cos(k * 5) * 0.2], [x(k) + w(k), y(k), Math.cos(k * 5) * 0.2], [x(k2) + w(k2), y(k2), Math.cos(k2 * 5) * 0.2], [x(k2) - w(k2), y(k2), Math.cos(k2 * 5) * 0.2], col); mb.quad([x(k2) - w(k2), y(k2), Math.cos(k2 * 5) * 0.2], [x(k2) + w(k2), y(k2), Math.cos(k2 * 5) * 0.2], [x(k) + w(k), y(k), Math.cos(k * 5) * 0.2], [x(k) - w(k), y(k), Math.cos(k * 5) * 0.2], shade(col, -0.2)); } return M(mb, { spin: F }); },
  glow_bulb: () => { const mb = new MeshBuilder(); sphere(mb, [0, -0.15, 0], 0.62, 2, (c, i) => jit(c[1] > 0 ? '#c8fff0' : '#5ff4d0', i, 0.05)); tube(mb, [[0, 0.45, 0], [0.1, 0.75, 0], [0.4, 0.9, 0]], 0.06, 5, '#2a8a7a'); sphere(mb, [-0.22, 0.08, 0.5], 0.12, 0, '#ffffff'); return { ...M(mb, { spin: F, smooth: 50 }), look: { spec: 0.9, shine: 26 } }; },
  clover_leaf: () => ICON3D.clover(),
  ice_shard: () => { const mb = new MeshBuilder(); prism(mb, [[0, 0.95], [0.38, 0.2], [0.24, -0.9], [-0.28, -0.85], [-0.4, 0.15]], -0.25, 0.25, '#bfe8ff', { front: (i) => jit(i % 2 ? '#e8faff' : '#a8dcff', i, 0.06), side: '#7ab8e8' }); prism(mb, [[0.5, 0.4], [0.75, -0.2], [0.55, -0.85], [0.35, -0.3]], -0.18, 0.18, '#d8f4ff', { side: '#8ec8f0' }); return { ...M(mb, { spin: F }), look: { spec: 1, shine: 30 } }; },
  spring_coil: () => { const mb = new MeshBuilder(); const p = []; for (let i = 0; i <= 60; i++) { const k = i / 60, a = k * TAU * 5; p.push([Math.cos(a) * 0.42, -0.85 + k * 1.7, Math.sin(a) * 0.42]); } tube(mb, p, 0.075, 5, (i, j) => jit(i % 6 < 3 ? '#dceaf6' : '#9aaabb', i + j, 0.05)); return M(mb, { spin: F }); },
  magnet_stone: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0, 0], [0.82, 0.62, 0.6], 1, (c, i) => jit(c[0] > 0.15 ? '#ff5a6a' : c[0] < -0.15 ? '#4a8ae8' : '#5a6a80', i, 0.08)); for (let i = 0; i < 5; i++) sphere(mb, [Math.cos(i * 1.3) * 0.9, Math.sin(i * 1.3) * 0.7, 0.2], 0.06, 0, '#c8d8e8'); return M(mb, { spin: F }); },
  lava_glass: () => { const mb = new MeshBuilder(); prism(mb, [[-0.3, 0.85], [0.45, 0.6], [0.8, -0.1], [0.4, -0.85], [-0.5, -0.75], [-0.85, 0.05]], -0.3, 0.3, '#3a1a2a', { front: (i) => jit(i % 2 ? '#ff6a2a' : '#ffb22a', i, 0.08), side: '#5a1e1a' }); sphere(mb, [-0.15, 0.1, 0.3], [0.28, 0.2, 0.08], 0, '#ffe066'); return { ...M(mb, { spin: F }), look: { spec: 1, shine: 28 } }; },
  // ---- workshop: tackle, boat parts, tank gear, category tabs, tools
  reel_spin: reelM('#2486e0', '#5cc6ff'), reel_turbo: reelM('#e8452a', '#ffb22a'), reel_gold: reelM('#d8901c', '#ffe066'),
  line_braid: lineM('#7ed957'), line_glow: lineM('#7ef0ff', true), line_titan: lineM('#9aaabb'),
  lure_spoon: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0.05, 0], [0.42, 0.75, 0.14], 1, (c, i) => jit(c[0] < 0 ? '#f4fbff' : '#b8c8d8', i, 0.05)); sphere(mb, [-0.12, 0.3, 0.12], [0.1, 0.18, 0.04], 0, '#ff5a6a'); hookInto(mb, 0, -0.75); ringInto(mb, 0, 0.85); return M(mb, { spin: F }); },
  lure_frog: () => { const mb = new MeshBuilder(); sphere(mb, [0, 0, 0], [0.62, 0.42, 0.5], 1, (c, i) => jit(c[1] > 0 ? '#7ed957' : '#fff4a0', i, 0.05)); for (const s of [-1, 1]) { sphere(mb, [s * 0.25, 0.38, 0.3], 0.14, 1, '#ffffff'); sphere(mb, [s * 0.25, 0.4, 0.42], 0.06, 0, '#1c2c44'); tube(mb, [[s * 0.4, -0.2, -0.1], [s * 0.75, -0.55, -0.2]], 0.07, 4, '#4cb424'); } hookInto(mb, 0, -0.65); return M(mb, { spin: W }); },
  lure_squid: () => { const mb = new MeshBuilder(); lathe(mb, [[0, 0.95], [0.3, 0.6], [0.36, 0.1], [0.32, -0.1]], 10, (i, j) => jit('#ff9ed2', i * 10 + j, 0.05), { capBottom: true }); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; tube(mb, [[Math.cos(a) * 0.25, -0.1, Math.sin(a) * 0.25], [Math.cos(a) * 0.4, -0.55, Math.sin(a) * 0.4], [Math.cos(a) * 0.3, -0.9, Math.sin(a) * 0.3]], 0.06, 4, '#ff74b4'); } for (const s of [-1, 1]) sphere(mb, [s * 0.16, 0.25, 0.3], 0.08, 0, '#1c2c44'); return M(mb, { spin: F }); },
  charm_heart: charmM((mb) => slab(mb, heartPts(22, 0.55, 0, -0.2), 0.12, '#ff4f7a')),
  charm_clover: charmM((mb) => { for (let i = 0; i < 4; i++) slab(mb, rot(heartPts(14, 0.3).map(([x, y]) => [x, y + 0.26]), (i * Math.PI) / 2 + Math.PI).map(([x, y]) => [x, y - 0.2]), 0.08, '#5fd23a'); }),
  charm_star: charmM((mb) => slab(mb, starPts(5, 0.58, 0.26, 0, -0.22), 0.12, '#ffc93a')),
  charm_pearl: charmM((mb) => sphere(mb, [0, -0.22, 0], 0.45, 2, (c, i) => jit(c[1] > -0.1 ? '#ffffff' : '#e4dcf4', i, 0.03))),
  gem: () => ({ ...GEM_MODEL('#5fd8ff'), spin: F }),
  key: () => { const mb = new MeshBuilder(); const r = circ(14, 0.32, -0.45, 0.35).map(([x, y]) => [x, y, 0]); r.push(r[0]); tube(mb, r, 0.11, 6, '#ffc93a', { caps: false }); tube(mb, [[-0.2, 0.1, 0], [0.75, -0.75, 0]], 0.1, 6, '#ffc93a'); tube(mb, [[0.5, -0.5, 0], [0.68, -0.32, 0]], 0.08, 5, '#e8a020'); tube(mb, [[0.66, -0.66, 0], [0.84, -0.48, 0]], 0.08, 5, '#e8a020'); return M(mb, { spin: W }); },
  anvil: () => { const mb = new MeshBuilder(); prism(mb, [[-0.95, 0.35], [0.7, 0.35], [0.95, 0.15], [0.5, 0.05], [0.3, -0.25], [0.45, -0.7], [-0.45, -0.7], [-0.3, -0.25], [-0.5, 0.05], [-0.95, 0.15]], -0.32, 0.32, '#5a6a80', { front: (i) => jit('#7a8aa2', i, 0.05), side: '#3c4a5c' }); box(mb, -0.6, 0.35, -0.32, 0.6, 0.42, 0.32, '#b4c2d4'); return M(mb); },
  boat_hull: () => { const mb = new MeshBuilder(); prism(mb, [[-0.95, 0.25], [0.95, 0.25], [0.7, -0.45], [-0.75, -0.45]], -0.4, 0.4, '#2486e0', { front: (i) => jit('#3cb8f4', i, 0.04), side: '#1660b0' }); box(mb, -0.95, 0.25, -0.42, 0.95, 0.38, 0.42, '#f4fbff'); return M(mb); },
  boat_sail: () => { const mb = new MeshBuilder(); tube(mb, [[-0.2, -0.95, 0], [-0.2, 0.95, 0]], 0.06, 5, '#c8904a'); prism(mb, [[-0.15, 0.85], [0.75, -0.6], [-0.15, -0.6]], -0.05, 0.05, '#ffffff', { front: (i) => jit('#f4fbff', i, 0.03) }); prism(mb, [[-0.25, 0.7], [-0.85, -0.5], [-0.25, -0.5]], -0.04, 0.04, '#5cc6ff'); return M(mb); },
  boat_flag: () => { const mb = new MeshBuilder(); tube(mb, [[-0.6, -0.95, 0], [-0.6, 0.9, 0]], 0.06, 5, '#dceaf6'); sphere(mb, [-0.6, 0.95, 0], 0.1, 0, '#ffd23a'); const f = []; for (let i = 0; i <= 6; i++) { const k = i / 6; f.push([-0.55 + k * 1.3, 0.85 - k * 0.1 + Math.sin(k * 5) * 0.08]); } for (let i = 6; i >= 0; i--) { const k = i / 6; f.push([-0.55 + k * 1.3, 0.2 - k * 0.1 + Math.sin(k * 5) * 0.08]); } slab(mb, f, 0.04, '#ff5a6a'); return M(mb); },
  boat_engine: () => ICON3D.engine(), boat_decal: () => ICON3D.star(),
  tank_filter: () => { const mb = new MeshBuilder(); box(mb, -0.5, -0.9, -0.35, 0.5, 0.6, 0.35, { top: '#e4eef8', front: '#b8c8d8', side: '#8ea2b8', back: '#7a8ea4' }); for (let i = 0; i < 4; i++) box(mb, -0.38, -0.7 + i * 0.3, 0.35, 0.38, -0.6 + i * 0.3, 0.4, '#5a6a80'); tube(mb, [[0.3, 0.6, 0], [0.3, 0.85, 0], [0.75, 0.85, 0], [0.75, 0.4, 0]], 0.08, 5, '#7fdcfa'); return M(mb); },
  tank_heater: () => { const mb = new MeshBuilder(); lathe(mb, [[0.2, -0.95], [0.22, 0.6], [0.16, 0.7]], 8, (i, j) => jit(i < 1 ? '#ff7a4a' : '#dceaf6', j, 0.05), { capBottom: true, capTop: true }); box(mb, -0.3, 0.6, -0.25, 0.3, 0.95, 0.25, '#3c4a5c'); sphere(mb, [0, 0.78, 0.26], 0.08, 0, '#ff3a3a'); return M(mb, { spin: F }); },
  tank_light: () => { const mb = new MeshBuilder(); box(mb, -0.95, 0.3, -0.3, 0.95, 0.6, 0.3, { top: '#e4eef8', front: '#b8c8d8', side: '#8ea2b8', back: '#7a8ea4' }); box(mb, -0.85, 0.22, -0.2, 0.85, 0.3, 0.2, '#fff6a0'); for (const x of [-0.6, 0, 0.6]) prism(mb, [[x - 0.1, 0.2], [x + 0.1, 0.2], [x + 0.25, -0.85], [x - 0.25, -0.85]], -0.02, 0.02, '#fffbe0'); return { ...M(mb), glassAlpha: 0.3 }; },
  tank_air: () => { const mb = new MeshBuilder(); box(mb, -0.6, -0.95, -0.3, 0.2, -0.45, 0.3, '#5cc6ff'); tube(mb, [[0.2, -0.7, 0], [0.55, -0.7, 0], [0.55, 0.0, 0]], 0.05, 4, '#dceaf6'); for (const [y, r] of [[0.2, 0.14], [0.5, 0.18], [0.85, 0.12]]) sphere(mb, [0.55 + (y - 0.5) * 0.3, y, 0], r, 1, '#bff4ff'); return M(mb); },
  tank_sand: () => { const mb = new MeshBuilder(); sphere(mb, [0, -0.3, 0], [0.9, 0.42, 0.6], 1, (c, i) => jit(c[1] > -0.2 ? '#fff0c0' : '#e8c878', i, 0.06)); for (const [x, c] of [[-0.4, '#ff9ed2'], [0.1, '#ffffff'], [0.45, '#7fdcfa']]) sphere(mb, [x, 0.0, 0.3], 0.13, 1, c); return M(mb, { spin: F }); },
  cat_rods: () => ICON3D.hook(), cat_tackle: () => ICON3D.reel_spin(), cat_upgrade: () => ICON3D.arrow_u(), cat_bait: () => ICON3D.worm(),
  cat_decor: () => ICON3D.decor(), cat_boat: () => ICON3D.boat_hull(), cat_tank: () => ICON3D.tank(), cat_build: () => ICON3D.home(),
  // ---- moods (fish manager) and rarity gems
  mood_love: moodModel('#ff9ed2', 'love'), mood_happy: moodModel('#ffd84a', 'smile'), mood_ok: moodModel('#a8ec6a', 'flat'),
  mood_hungry: moodModel('#ffa83c', 'open'), mood_sad: moodModel('#8fc4ff', 'frown'),
  gem_common: () => ({ ...GEM_MODEL('#c9d4dc'), spin: F }), gem_uncommon: () => ({ ...GEM_MODEL('#7ee07a'), spin: F }), gem_rare: () => ({ ...GEM_MODEL('#5fb8ff'), spin: F }),
  gem_epic: () => ({ ...GEM_MODEL('#d27bff'), spin: F }), gem_legendary: () => ({ ...GEM_MODEL('#ffd04a'), spin: F }),
};

function reelM(c1, c2) { return () => { const mb = new MeshBuilder(); disc(mb, 0.85, 0.2, c1); disc(mb, 0.5, 0.26, c2); tube(mb, [[0, 0, 0.28], [0.5, 0.45, 0.3]], 0.08, 5, '#dceaf6'); sphere(mb, [0.55, 0.5, 0.36], 0.16, 1, '#ffffff'); return M(mb, { spin: F }); }; }
function lineM(col, glow = false) { return () => { const mb = new MeshBuilder(); lathe(mb, [[0.62, -0.5], [0.62, -0.4], [0.36, -0.36], [0.4, 0.36], [0.62, 0.4], [0.62, 0.5]], 14, (i, j) => (i === 2 ? jit(col, j, 0.06) : jit('#dceaf6', j, 0.05)), { capTop: true, capBottom: true, capCol: '#f4fbff' }); tube(mb, [[0.4, 0.1, 0.2], [0.9, 0.7, 0.1]], 0.03, 4, col); return { ...M(mb, { spin: F }), pitch: 0.3, ...(glow ? { look: { spec: 1, shine: 30 } } : {}) }; }; }
function hookInto(mb, x, y) { const p = [[x, y + 0.1, 0]]; for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 1.1; p.push([x - 0.12 + Math.cos(a) * 0.14, y - 0.05 - Math.sin(a) * 0.2, 0]); } tube(mb, p, 0.04, 4, '#c8d8e8'); }
function ringInto(mb, x, y) { const r = circ(10, 0.1, x, y).map(([a, b]) => [a, b, 0]); r.push(r[0]); tube(mb, r, 0.035, 4, '#dceaf6', { caps: false }); }
function charmM(body) { return () => { const mb = new MeshBuilder(); const r = circ(12, 0.16, 0, 0.72).map(([a, b]) => [a, b, 0]); r.push(r[0]); tube(mb, r, 0.05, 4, '#ffd84a', { caps: false }); tube(mb, [[0, 0.56, 0], [0, 0.3, 0]], 0.04, 4, '#ffd84a'); body(mb); return M(mb, { spin: F }); }; }

function moodModel(col, mouth) {
  return () => {
    const mb = new MeshBuilder();
    sphere(mb, [0, 0, 0], 0.8, 2, (c, i) => jit(c[1] > 0.2 ? mix(col, '#ffffff', 0.25) : col, i, 0.03));
    if (mouth === 'love') { for (const s of [-1, 1]) prism(mb, heartPts(14, 0.3, s * 0.28, 0.14), 0.68, 0.82, '#e0304c'); face2(mb, 'rgba(0,0,0,0)' && '#e0304c', 'smile', 0.72); }
    else face2(mb, '#1c2c44', mouth, 0.72);
    if (mouth === 'smile' || mouth === 'love') for (const s of [-1, 1]) sphere(mb, [s * 0.5, -0.1, 0.55], [0.12, 0.08, 0.05], 0, '#ff8aa8');
    if (mouth === 'frown') sphere(mb, [0.4, -0.02, 0.62], [0.06, 0.1, 0.05], 0, '#4aa8f0');
    return { mesh: mb.build({ smooth: 40 }), yaw: 0.25, pitch: 0.15, spin: W };
  };
}

function mouseModel(side, hold = false) {
  return () => {
    const mb = new MeshBuilder();
    sphere(mb, [0, -0.1, 0], [0.62, 0.85, 0.42], 1, (c, i) => (c[1] > 0.15 && side && Math.sign(c[0]) === side ? (hold ? '#ff9d2e' : '#35c8ff') : jit('#f4f8fc', i, 0.03)));
    box(mb, -0.03, 0.15, 0.2, 0.03, 0.72, 0.42, '#8ea2b8');
    return M(mb, { yaw: 0.25, pitch: 0.45 });
  };
}

export function has3D(name) { return !!ICON3D[name]; }

// still render fitted into a w x h logical box (no layout changes for callers that sized around the 2D icons)
const stills = new Map();
export function icon3d(name, w, h = w) {
  const make = ICON3D[name];
  if (!make) return null;
  const key = name + '|' + w + 'x' + h;
  let c = stills.get(key);
  if (c !== undefined) return c;
  const px = Math.max(w, h) + 2;
  const f = modelFrame('ui3d:' + name, make, px, 0);
  if (!f) return null; // the renderer is not up yet: callers fall back (and ask again later)
  c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(f.canvas, Math.round(w / 2 - f.ox), Math.round(h / 2 - f.oy));
  const hc = makeCanvas(w * HI, h * HI);
  ctxOf(hc).drawImage(f.canvas.hi, Math.round((w / 2 - f.ox) * HI), Math.round((h / 2 - f.oy) * HI));
  Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  c.__icon3d = name;
  stills.set(key, c);
  return c;
}

export function icon3dFrame(name, px, turn = 0) {
  const make = ICON3D[name];
  return make ? modelFrame('ui3d:' + name, make, px, turn) : null;
}

// Gentle idle rock (wobble models) or slow turn (round ones), a full spin while hovered.
export function drawIcon3D(ctx, name, cx, cy, px, o = {}) {
  const make = ICON3D[name];
  if (!make) return false;
  const t = o.t ?? performance.now() / 1000, hov = o.hover || 0, ph = o.phase || 0;
  const mode = modelSpin('ui3d:' + name, make);
  let turn;
  if (mode === 'full') turn = hov > 0.5 ? t * 0.9 + ph : Math.sin(t * 0.8 + ph) * 0.05;
  else turn = hov > 0.5 ? Math.sin(t * 7 + ph) * 0.9 : Math.sin(t * 1.3 + ph) * 0.22;
  const f = modelFrame('ui3d:' + name, make, Math.round(px), turn);
  if (!f) return false;
  const bob = hov > 0.5 ? -1 : 0;
  ctx.drawImage(f.canvas, Math.round((cx - f.ox) * 2) / 2, Math.round((cy - f.oy + bob) * 2) / 2);
  return true;
}

export { GEM_MODEL };
