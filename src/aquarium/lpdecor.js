// 3D models of every aquarium decoration (the props.js decor ids), authored at natural size in centimetres for a
// mid-size tank (the aquarium scales them with the tank). Base on y = 0, facing +z (toward the front glass).
// Phase 8: every model is turned into a polished, high-count VOXEL model (lpkit voxelize: ~30-40 voxels tall,
// per-voxel colour jitter, lit tops), so the decor reads as hand-built voxel art.
//
//   decorModel(id, variant) -> {mesh, glow: [{mesh, col}], part: {mesh, pivot, anim, speed} | null,
//                               r (footprint radius), h (height), top: [x, y, z]}   cached
//   Unknown ids fall back to a model picked by the prop's tags.

import { Geo, rgb, mixc, shadec, srand, voxelize } from './lpkit.js';
import { PROPS } from '../gfx/props.js';

const CACHE = new Map();

export function decorModel(id, variant = 0) {
  const key = id + '|' + variant;
  let m = CACHE.get(key);
  if (m) return m;
  const g = new Geo(), glow = new Geo(), part = new Geo();
  const ctx = { g, glow, part, rnd: srand(hashStr(id) + variant * 97), v: variant | 0, glowCol: '#bff8ff', partPivot: [0, 0, 0], anim: null, speed: 1 };
  g.jit = 0.12; g.seed = hashStr(id);
  const fn = MODELS[id] || byTags(id);
  fn(ctx);
  const b = g.bounds();
  const gb = glow.n ? glow.bounds() : null;
  const pb = part.n ? part.bounds() : null;
  const maxY = Math.max(b.max[1], gb?.max[1] ?? -1, pb?.max[1] ?? -1);
  const ext = Math.max(maxY, b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const vs = Math.max(0.16, Math.min(0.5, ext / 36));
  const vg = voxelize(g, vs, { maxCells: 9000 }), vgl = glow.n ? voxelize(glow, vs, { jitter: 0 }) : null, vp = part.n ? voxelize(part, vs, { maxCells: 4000 }) : null;
  m = {
    mesh: vg.build(),
    glow: vgl ? [{ mesh: vgl.build(), col: rgb(ctx.glowCol) }] : [],
    part: vp ? { mesh: vp.build(), pivot: ctx.partPivot, anim: ctx.anim || 'spinY', speed: ctx.speed } : null,
    vs,
    r: Math.max(1.5, Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[2]), Math.abs(b.max[2])) * 0.85),
    h: Math.max(1.5, maxY),
  };
  m.top = [0, m.h, 0];
  CACHE.set(key, m);
  return m;
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function byTags(id) {
  const tags = PROPS[id]?.tags || [];
  if (tags.includes('coral')) return MODELS.coral_branch;
  if (tags.includes('rock')) return MODELS.rock_big;
  if (tags.includes('crystal')) return MODELS.crystal_cluster;
  if (tags.includes('ruin')) return MODELS.pillar_ruin;
  if (tags.includes('treasure')) return MODELS.treasure_chest;
  if (tags.includes('glow')) return MODELS.lava_lamp;
  if (tags.includes('build')) return MODELS.castle;
  return MODELS.rock_small;
}

// ------------------------------------------------------------------ helpers
const at = (g, x, y, z, f) => { g.push(); g.at(x, y, z); f(); g.pop(); };
const rock = (c, r, col, o = {}) => c.g.rock(r, Math.floor(c.rnd() * 9999), col, o);
const CORAL = [['#ff6a9a', '#ffb0c8'], ['#ffa83a', '#ffe08a'], ['#a86aff', '#d8b8ff'], ['#3ad8c8', '#a8fff0'], ['#ff5a5a', '#ffb08a']];
const coralCol = (v) => CORAL[v % CORAL.length];

function branch(g, x, y, z, a, len, r, depth, col, tip, rnd) {
  const ex = x + Math.cos(a.h) * Math.sin(a.v) * len, ey = y + Math.cos(a.v) * len, ez = z + Math.sin(a.h) * Math.sin(a.v) * len;
  g.tube([[x, y, z], [ex, ey, ez]], [r, r * 0.72], 5, depth > 1 ? col : tip, { caps: depth <= 1 });
  if (depth <= 1) { g.push(); g.at(ex, ey, ez); g.sphere(r * 0.9, 0, tip); g.pop(); return; }
  const n = 2 + (rnd() > 0.6 ? 1 : 0);
  for (let i = 0; i < n; i++) branch(g, ex, ey, ez, { h: a.h + (i - (n - 1) / 2) * 1.4 + rnd() * 0.6, v: Math.min(1.1, a.v + 0.25 + rnd() * 0.25) }, len * 0.72, r * 0.72, depth - 1, col, tip, rnd);
}

// ------------------------------------------------------------------ models
const MODELS = {
  rock_small: (c) => { rock(c, 3.2, '#8e98a8', { sy: 0.7 }); at(c.g, 1.6, 0, 1.2, () => rock(c, 1.6, '#a8b0bc')); },
  rock_big: (c) => { rock(c, 6, '#8a94a4', { sy: 0.85 }); at(c.g, 4, 0, 2, () => rock(c, 3, '#9aa2b0')); at(c.g, -3.5, 0, 2.5, () => rock(c, 2.4, '#7c8698')); at(c.g, 0, 4.6, 0, () => c.g.sphere(1.2, 0, '#5ac85a', { jit: 0.3 })); },
  rock_arch: (c) => {
    const g = c.g;
    at(g, -7, 0, 0, () => rock(c, 4.5, '#8e98a8', { sy: 1.8, sz: 0.8 }));
    at(g, 7, 0, 0, () => rock(c, 4.5, '#8a94a4', { sy: 1.8, sz: 0.8 }));
    for (let i = 0; i <= 6; i++) { const a = Math.PI * (i / 6); at(g, -Math.cos(a) * 7, 6 + Math.sin(a) * 6, 0, () => rock(c, 3, i % 2 ? '#98a0ae' : '#8490a0', { flat: -1 })); }
    at(g, 0, 13, 0, () => g.sphere(1.6, 0, '#5ac85a', { jit: 0.3 }));
  },
  starfish_rock: (c) => {
    const g = c.g; rock(c, 4, '#a8a090', { sy: 0.8 });
    g.push(); g.at(0.5, 2.9, 1.2); g.rotX(-0.5);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28; g.tube([[0, 0, 0], [Math.cos(a) * 2.2, 0.15, Math.sin(a) * 2.2]], [0.6, 0.15], 4, '#ff7a3a'); }
    g.sphere(0.7, 0, '#ffa04a');
    g.pop();
  },
  coral_branch: (c) => { const [col, tip] = coralCol(c.v); rock(c, 2, '#a89a8a', { sy: 0.5 }); for (let i = 0; i < 3; i++) branch(c.g, 0, 0.8, 0, { h: i * 2.1, v: 0.2 }, 3.2, 0.55, 3, col, tip, c.rnd); },
  coral_staghorn: (c) => { const [col, tip] = coralCol(c.v + 2); rock(c, 3, '#a89a8a', { sy: 0.5 }); for (let i = 0; i < 6; i++) branch(c.g, (c.rnd() - 0.5) * 3, 0.8, (c.rnd() - 0.5) * 3, { h: i * 1.05, v: 0.45 }, 4, 0.5, 3, col, tip, c.rnd); },
  coral_fan: (c) => {
    const g = c.g, [col, tip] = coralCol(c.v + 1);
    rock(c, 1.8, '#a89a8a', { sy: 0.5 });
    const pts = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * (0.1 + 0.8 * i / 12); pts.push([Math.cos(a) * 7, 1 + Math.sin(a) * 9, Math.sin(i * 1.3) * 0.4]); }
    g.fan([[0, 0.8, 0], ...pts], col);
    for (let i = 0; i <= 12; i += 2) g.tube([[0, 0.8, 0], pts[i]], 0.18, 3, tip);
  },
  coral_brain: (c) => {
    const [col] = coralCol(c.v === 1 ? 3 : c.v === 2 ? 0 : 1);
    c.g.push(); c.g.scale(1, 0.62, 1);
    c.g.sphere(4.2, 2, (i, a) => (Math.sin(a[0] * 9 + a[2] * 7) > 0 ? col : shadec(col, -0.25)), { jit: 0.08, cut: -0.1 });
    c.g.pop();
  },
  coral_tube: (c) => { const [col, tip] = coralCol(c.v + 3); rock(c, 2, '#a89a8a', { sy: 0.5 }); for (let i = 0; i < 4; i++) { const a = i * 1.6, h = 4 + c.rnd() * 5; at(c.g, Math.cos(a) * 1.4, 0.4, Math.sin(a) * 1.4, () => { c.g.cyl(0.9, 1.2, h, 7, col, { caps: false }); c.g.at(0, h, 0); c.g.cyl(1.2, 1.3, 0.4, 7, tip, { caps: false }); }); } },
  anemone_base: (c) => {
    const g = c.g, [col, tip] = coralCol(c.v + 4);
    rock(c, 2.5, '#a89a8a', { sy: 0.5 });
    g.push(); g.at(0, 1.4, 0); g.cyl(2.2, 2.6, 1.6, 10, col);
    for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.28, r = 1.4 + (i % 2) * 0.8; g.tube([[Math.cos(a) * r, 1.6, Math.sin(a) * r], [Math.cos(a) * (r + 1), 3.6, Math.sin(a) * (r + 1)], [Math.cos(a) * (r + 1.8), 4.6 + (i % 3) * 0.4, Math.sin(a) * (r + 1.8)]], [0.35, 0.25, 0.15], 4, tip); }
    g.pop();
  },
  circuit_coral: (c) => { const g = c.g; rock(c, 2.4, '#5a6a7a', { sy: 0.5 }); for (let i = 0; i < 4; i++) branch(g, 0, 0.8, 0, { h: i * 1.6, v: 0.3 }, 3, 0.45, 3, '#2a3a4a', '#3affd8', c.rnd); c.glowCol = '#3affd8'; for (let i = 0; i < 6; i++) at(c.glow, Math.cos(i) * 3, 4 + (i % 3) * 2, Math.sin(i) * 3, () => c.glow.sphere(0.4, 0, '#ffffff')); },
  sandcastle: (c) => {
    const g = c.g, s = '#f0d898', d = '#d8bc7a';
    g.box(-6, 0, -4, 6, 4, 4, { top: s, side: d });
    for (const [x, z] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) at(g, x, 4, z, () => { g.cyl(1.8, 1.6, 4, 8, s); g.at(0, 4, 0); g.cyl(1.9, 0, 2.2, 8, d); });
    at(g, 0, 4, 0, () => { g.cyl(2.6, 2.2, 6, 8, s); g.at(0, 6, 0); g.cyl(2.6, 0, 2.6, 8, d); });
    g.box(-1, 0.2, 3.9, 1, 2.6, 4.2, '#8a6a4a');
    at(g, 0, 14.4, 0, () => { g.cyl(0.08, 0.08, 2.5, 3, '#ffffff'); g.at(0, 1.8, 0); g.box(0, 0, 0, 1.4, 0.8, 0.06, '#ff5a5a'); });
  },
  treasure_chest: (c) => {
    const g = c.g, w = '#a8642a', m = '#ffd23a';
    g.box(-4, 0, -2.6, 4, 3.4, 2.6, { top: w, side: shadec(w, -0.1), front: w });
    g.push(); g.at(0, 3.4, -2.6); g.rotX(-0.6);
    g.box(-4, 0, 0, 4, 1.6, 5.2, { top: shadec(w, 0.1), side: w });
    g.pop();
    for (const x of [-3, 3]) g.box(x - 0.35, 0, 2.55, x + 0.35, 3.5, 2.75, m);
    g.box(-0.6, 2, 2.6, 0.6, 3, 2.9, m);
    c.glowCol = '#ffe27a';
    for (let i = 0; i < 9; i++) at(c.glow, (c.rnd() - 0.5) * 6, 3.4 + c.rnd() * 0.8, (c.rnd() - 0.5) * 3, () => c.glow.cyl(0.7, 0.7, 0.2, 7, '#ffffff'));
  },
  clam_pearl: (c) => {
    const g = c.g, col = '#e8b4d8';
    g.push(); g.scale(1, 0.35, 0.8); g.sphere(4, 1, col, { cut: 0 }); g.pop();
    g.push(); g.at(0, 0.6, -2.8); g.rotX(-0.9); g.scale(1, 0.3, 0.8); g.sphere(4, 1, shadec(col, 0.1), { cut: 0 }); g.pop();
    c.glowCol = '#fff6ff';
    at(c.glow, 0, 1.6, 0.6, () => c.glow.sphere(1.2, 1, '#ffffff', { smooth: true }));
  },
  message_bottle: (c) => {
    const g = c.g;
    g.push(); g.at(-3, 1.3, 0); g.rotZ(-Math.PI / 2 + 0.15);
    g.lathe([[0.2, 0], [1.3, 0.3], [1.3, 4.5], [0.6, 5.6], [0.5, 6.8]], 8, '#6ad8a8', { capBot: true });
    g.at(0, 6.8, 0); g.cyl(0.55, 0.5, 0.9, 6, '#a8743a');
    g.pop();
    g.push(); g.at(-0.5, 1.3, 0); g.rotZ(Math.PI / 2); g.cyl(0.7, 0.7, 2.6, 6, '#f8f0d8'); g.pop();
  },
  anchor: (c) => {
    const g = c.g, m = '#5a6a7a';
    g.push(); g.rotZ(0.35); g.at(0, 0.8, 0);
    g.box(-0.5, 0, -0.5, 0.5, 11, 0.5, m);
    g.box(-3, 9, -0.4, 3, 9.8, 0.4, m);
    g.tube([[-5, 3.5, 0], [-3.5, 0.8, 0], [0, 0, 0], [3.5, 0.8, 0], [5, 3.5, 0]], 0.6, 5, m);
    for (const s of [-1, 1]) at(g, s * 5, 3.5, 0, () => g.cyl(0.9, 0, 1.6, 4, m));
    at(g, 0, 11.6, 0, () => { g.rotX(Math.PI / 2); g.cyl(1.1, 1.1, 0.5, 8, m); });
    g.pop();
    for (let i = 0; i < 6; i++) at(g, 2 + i * 0.9, 0.3, 1 + Math.sin(i) * 0.6, () => g.sphere(0.45, 0, '#4a5a6a'));
  },
  barrel: (c) => {
    const g = c.g;
    g.push(); g.at(0, 2.8, 0); g.rotZ(Math.PI / 2); g.rotX(0.2); g.at(0, -4, 0);
    g.lathe([[2.4, 0], [2.9, 2], [3, 4], [2.9, 6], [2.4, 8]], 10, (i, j) => (j % 2 ? '#a8743a' : '#946430'), { capTop: '#7a5028', capBot: '#7a5028' });
    for (const y of [1.2, 6.8]) at(g, 0, y, 0, () => g.cyl(2.75, 2.75, 0.5, 10, '#5a5a62', { caps: false }));
    g.pop();
  },
  pillar_ruin: (c) => { const g = c.g; g.box(-3, 0, -3, 3, 1.4, 3, '#c8c0b0'); g.cyl(2, 2, 12, 10, (j) => (j % 2 ? '#d8d0c0' : '#c4bcac')); at(g, 0, 12, 0, () => g.box(-2.8, 0, -2.8, 2.8, 1.4, 2.8, '#c8c0b0')); c.glowCol = '#9affff'; at(c.glow, 0, 6, 2.05, () => c.glow.box(-0.6, -1.5, 0, 0.6, 1.5, 0.1, '#ffffff')); },
  pillar_broken: (c) => { const g = c.g; g.box(-3, 0, -3, 3, 1.4, 3, '#c8c0b0'); g.cyl(2, 2, 6, 10, '#d0c8b8'); g.push(); g.at(5, 2, 1); g.rotZ(Math.PI / 2 - 0.1); g.cyl(2, 2, 7, 10, '#c4bcac'); g.pop(); },
  arch_ruin: (c) => {
    const g = c.g;
    for (const s of [-1, 1]) at(g, s * 7, 0, 0, () => { g.box(-2.5, 0, -2.5, 2.5, 1.4, 2.5, '#b8b0a0'); g.cyl(1.8, 1.8, 14, 8, '#c8c0b0'); });
    g.box(-10, 14, -2.2, 10, 17, 2.2, '#c0b8a8');
    c.glowCol = '#9affff';
    for (let i = 0; i < 5; i++) at(c.glow, -6 + i * 3, 15.5, 2.25, () => c.glow.box(-0.5, -0.6, 0, 0.5, 0.6, 0.1, '#ffffff'));
  },
  glyph_stone: (c) => { const g = c.g; g.push(); g.scale(1, 1, 0.5); g.cyl(3.2, 2.6, 9, 6, '#6a7488'); g.pop(); c.glowCol = ['#7affea', '#ff9af0', '#ffe27a'][c.v % 3]; for (let i = 0; i < 3; i++) at(c.glow, 0, 2.5 + i * 2.2, 1.45, () => c.glow.box(-1, -0.4, 0, 1, 0.4, 0.1, '#ffffff')); },
  crystal_cluster: (c) => {
    const g = c.g; rock(c, 2.6, '#4a4a6a', { sy: 0.5 });
    const cols = [['#a86aff', '#e0c8ff'], ['#3ad8ff', '#c8f8ff'], ['#ff5ab4', '#ffc8e8'], ['#5aff9a', '#c8ffd8'], ['#ffd23a', '#fff4b0']][c.v % 5];
    for (let i = 0; i < 6; i++) { g.push(); g.at((c.rnd() - 0.5) * 3, 0.8, (c.rnd() - 0.5) * 3); g.rotZ((c.rnd() - 0.5) * 0.9); g.rotX((c.rnd() - 0.5) * 0.9); const h = 3 + c.rnd() * 6; g.cyl(0.9, 0.9, h, 6, cols[0]); g.at(0, h, 0); g.cyl(0.9, 0, 1.6, 6, cols[1]); g.pop(); }
    c.glowCol = cols[1];
    at(c.glow, 0, 4, 0, () => c.glow.sphere(0.6, 0, '#ffffff'));
  },
  glow_mushroom: (c) => {
    const g = c.g, cols = [['#3affd8', '#2a6a8a'], ['#ff6ad8', '#6a2a8a'], ['#d8ff3a', '#4a6a2a']][c.v % 3];
    rock(c, 2, '#3a4a5a', { sy: 0.4 });
    for (let i = 0; i < 4; i++) { const h = 2 + c.rnd() * 4, r = 1 + c.rnd() * 1.5; at(g, (c.rnd() - 0.5) * 3, 0, (c.rnd() - 0.5) * 3, () => { g.cyl(0.35, 0.3, h, 6, '#e8f0f0'); g.at(0, h, 0); g.push(); g.scale(1, 0.55, 1); g.sphere(r, 1, cols[1], { cut: 0 }); g.pop(); }); }
    c.glowCol = cols[0];
    for (let i = 0; i < 8; i++) at(c.glow, (c.rnd() - 0.5) * 4, 2.5 + c.rnd() * 3.5, (c.rnd() - 0.5) * 4, () => c.glow.sphere(0.25, 0, '#ffffff'));
  },
  tube_worms: (c) => { const g = c.g; rock(c, 2.4, '#5a4a4a', { sy: 0.5 }); for (let i = 0; i < 7; i++) { const h = 3 + c.rnd() * 6; at(g, (c.rnd() - 0.5) * 3.6, 0.5, (c.rnd() - 0.5) * 3.6, () => { g.cyl(0.4, 0.45, h, 6, '#f0e8d8', { caps: false }); g.at(0, h, 0); g.sphere(0.7, 0, '#ff3a4a', { jit: 0.4 }); }); } },
  ribcage: (c) => {
    const g = c.g, b = '#f0e8d8';
    g.tube([[-10, 1, 0], [-4, 1.6, 0], [4, 1.6, 0], [10, 1, 0]], 0.8, 6, b);
    for (let i = 0; i < 7; i++) { const x = -8 + i * 2.6, h = 9 - Math.abs(i - 3) * 1.2; for (const s of [-1, 1]) g.tube([[x, 1.6, 0], [x, h * 0.6, s * 4], [x + 0.4, h, s * 2.5], [x + 0.6, h + 1.4, s * 0.6]], [0.5, 0.45, 0.35, 0.2], 5, b); }
  },
  giant_skull: (c) => {
    const g = c.g, b = '#f0e8d8';
    g.push(); g.at(0, 5, 0); g.sphere(5, 1, b, { jit: 0.08 }); g.pop();
    g.box(-3.4, 0, 0.5, 3.4, 3, 4.6, b);
    for (const s of [-1, 1]) at(g, s * 2, 5.2, 4.2, () => g.sphere(1.5, 0, '#1a1a24'));
    c.glowCol = '#7affea';
    for (const s of [-1, 1]) at(c.glow, s * 2, 5.2, 4.9, () => c.glow.sphere(0.5, 0, '#ffffff'));
    for (let i = 0; i < 5; i++) g.box(-2.2 + i * 1.05, 0.2, 4.5, -1.6 + i * 1.05, 1.6, 4.8, '#fff8e8');
  },
  castle: (c) => {
    const g = c.g, s = '#f4f0ff', r = '#ff6aa8', b = '#a8d8ff';
    g.box(-7, 0, -4, 7, 6, 4, { top: s, side: shadec(s, -0.05) });
    for (const [x, z] of [[-7, -4], [7, -4], [-7, 4], [7, 4]]) at(g, x, 0, z, () => { g.cyl(2, 2, 10, 8, s); g.at(0, 10, 0); g.cyl(2.4, 0, 4.5, 8, r); });
    at(g, 0, 6, 0, () => { g.cyl(3, 3, 9, 8, s); g.at(0, 9, 0); g.cyl(3.4, 0, 6, 8, b); });
    g.box(-1.5, 0, 3.9, 1.5, 4, 4.3, '#7a4a8a');
    c.glowCol = '#fff2a8';
    for (const [x, y] of [[-3.5, 4], [3.5, 4], [0, 11]]) at(c.glow, x, y, x === 0 ? 3.05 : 4.05, () => c.glow.box(-0.6, -0.8, 0, 0.6, 0.8, 0.1, '#ffffff'));
  },
  moai_head: (c) => {
    const g = c.g, st = '#8a8a96';
    g.box(-3.4, 0, -2.6, 3.4, 13, 2.6, { top: shadec(st, 0.1), side: st });
    g.box(-1, 5, 2.6, 1, 9.6, 4.4, shadec(st, 0.05));
    g.box(-3.6, 10.2, 1.4, 3.6, 11.6, 3, shadec(st, -0.15));
    g.box(-2.2, 2.6, 2.6, 2.2, 3.4, 3.4, shadec(st, -0.2));
    for (const s of [-1, 1]) g.box(s * 3.4 - 0.6, 4, -1, s * 3.4 + 0.6, 10, 1, shadec(st, -0.08));
  },
  diver_helmet: (c) => {
    const g = c.g, br = '#e0a84a';
    g.push(); g.at(0, 5, 0); g.sphere(4.6, 1, br, { smooth: true }); g.pop();
    g.cyl(4.8, 4.4, 1.6, 12, shadec(br, -0.2));
    at(g, 0, 5, 3.8, () => { g.rotX(Math.PI / 2); g.cyl(2.2, 2.2, 1.2, 12, shadec(br, -0.1)); });
    at(g, 0, 5, 5, () => { g.rotX(Math.PI / 2); g.cyl(1.7, 1.7, 0.1, 12, '#3a5a7a'); });
    for (const s of [-1, 1]) at(g, s * 4, 5, 0, () => { g.rotZ(s * Math.PI / 2); g.cyl(1.3, 1.3, 0.8, 10, shadec(br, -0.1)); });
  },
  pirate_ship: (c) => {
    const g = c.g, w = '#a0642a';
    g.push(); g.rotZ(0.12); g.at(0, 1, 0);
    g.lathe([[0.5, 0], [3.2, 1.5], [3.8, 4.5]], 8, w);
    g.box(-11, 0.5, -3, 9, 4.5, 3, { top: '#c8884a', side: w });
    g.box(5, 4.5, -3, 11, 7.5, 3, { top: '#c8884a', side: shadec(w, -0.1) });
    g.box(9, 0.5, -1.5, 13, 4.5, 1.5, w);
    for (const x of [-5, 2]) at(g, x, 4.5, 0, () => { g.cyl(0.35, 0.3, 14, 6, '#7a4a20'); g.at(0, 8, 0); g.box(-0.1, -3, -3.5, 0.1, 3.5, 3.5, '#f4f0e0'); });
    at(g, 2, 18.5, 0, () => g.box(0, 0, -0.05, 2.2, 1.3, 0.05, '#1a1a24'));
    for (let i = 0; i < 4; i++) at(g, -8 + i * 3.4, 2.4, 3.05, () => { g.rotX(Math.PI / 2); g.cyl(0.5, 0.5, 0.6, 6, '#1a1a24'); });
    g.pop();
    c.glowCol = '#ffd27a';
    at(c.glow, 8, 6, 3.05, () => c.glow.box(-0.5, -0.5, 0, 0.5, 0.5, 0.1, '#ffffff'));
  },
  sunken_pc: (c) => {
    const g = c.g, b = '#e8e0c8';
    g.push(); g.rotZ(-0.12);
    g.box(-4.5, 0, -3.5, 4.5, 7, 3.5, b);
    g.box(-3.8, 1, 3.5, 3.8, 6.2, 3.9, '#3a4a5a');
    g.box(-6, 0, -3, -4.6, 8, 3, shadec(b, -0.08));
    g.pop();
    at(g, 4, 0, 5, () => { g.rotY(0.4); g.box(-4, 0, -1.2, 4, 0.8, 1.2, b); });
    c.glowCol = '#7affd0';
    c.glow.push(); c.glow.rotZ(-0.12); c.glow.box(-3.4, 1.4, 3.92, 3.4, 5.8, 3.98, '#ffffff'); c.glow.pop();
  },
  lava_lamp: (c) => lavaLamp(c, 1, ['#ff5a3a', '#ff3a9a', '#3ad8ff', '#ffd23a', '#9a5aff', '#5aff9a'][c.v % 6], '#c8d0e0'),
  lava_lamp_giant: (c) => lavaLamp(c, 1.9, ['#ff5a3a', '#ff3a9a', '#3ad8ff', '#ffd23a', '#9a5aff', '#5aff9a'][c.v % 6], '#c8d0e0'),
  lava_lamp_slime: (c) => lavaLamp(c, 1, '#8aff3a', '#4a5a4a'),
  lava_lamp_galaxy: (c) => lavaLamp(c, 1.1, '#b48aff', '#d8c890'),
  rubber_duck: (c) => {
    const g = c.g, y = '#ffd83a';
    g.push(); g.at(0, 2, 0); g.scale(1.25, 0.85, 1); g.sphere(2.6, 1, y, { smooth: true }); g.pop();
    at(g, 1.6, 4.4, 0, () => g.sphere(1.7, 1, y, { smooth: true }));
    at(g, 3.1, 4.2, 0, () => { g.scale(1.3, 0.45, 0.9); g.sphere(0.8, 0, '#ff8a2a'); });
    for (const s of [-1, 1]) at(g, 2.4, 5, s * 1.1, () => g.sphere(0.32, 0, '#1a1a24', { smooth: true }));
    at(g, -2.6, 3, 0, () => { g.rotZ(0.8); g.cyl(0.9, 0.2, 1.4, 6, y); });
  },
  pagoda_lantern: (c) => {
    const g = c.g, st = '#a8a8b0';
    g.cyl(2.4, 2.4, 1, 6, st); at(g, 0, 1, 0, () => g.cyl(0.9, 0.9, 4, 6, st));
    at(g, 0, 5, 0, () => { g.box(-2, 0, -2, 2, 3, 2, st); g.at(0, 3, 0); g.cyl(4, 0.5, 2.4, 6, shadec(st, -0.1)); g.at(0, 2.4, 0); g.sphere(0.7, 0, st); });
    c.glowCol = '#ffd27a';
    at(c.glow, 0, 6.5, 0, () => c.glow.box(-1.6, -1, -2.05, 1.6, 1, 2.05, '#ffffff'));
  },
  mushroom_house: (c) => {
    const g = c.g;
    g.cyl(3.4, 3, 7, 10, '#f8f0e0');
    at(g, 0, 6.4, 0, () => { g.push(); g.scale(1, 0.62, 1); g.sphere(6.4, 1, (i, a) => (Math.sin(a[0] * 7) * Math.sin(a[2] * 7) > 0.35 ? '#ffffff' : '#ff4a5a'), { cut: -0.05 }); g.pop(); });
    g.box(-1.2, 0, 3.0, 1.2, 3.6, 3.4, '#a8743a');
    c.glowCol = '#fff2a8';
    at(c.glow, 2.6, 4.6, 1.8, () => c.glow.box(-0.6, -0.6, 0, 0.6, 0.6, 0.1, '#ffffff'));
    at(c.glow, -2.6, 4.6, 1.8, () => c.glow.box(-0.6, -0.6, 0, 0.6, 0.6, 0.1, '#ffffff'));
  },
  tiki_head: (c) => {
    const g = c.g, w = '#a8743a';
    g.cyl(2.8, 3, 11, 8, w);
    for (const s of [-1, 1]) at(g, s * 1.2, 7.4, 2.6, () => g.box(-0.8, -0.6, 0, 0.8, 0.6, 0.6, '#ffffff'));
    g.box(-1.8, 3.4, 2.7, 1.8, 4.6, 3.3, '#7a4a20');
    at(g, 0, 11, 0, () => { for (let i = 0; i < 5; i++) { const a = (i / 5) * 3.14 - 1.57; g.blade([[0, 0, 0], [Math.sin(a) * 2, 3, Math.cos(a) * 0.5], [Math.sin(a) * 4, 4.4, Math.cos(a) * 0.8]], [1, 1.2, 0], '#5ac85a', [Math.cos(a), 0, -Math.sin(a)]); } });
  },
  bridge: (c) => {
    const g = c.g, w = '#ff6a5a';
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([-10 + t * 20, Math.sin(t * Math.PI) * 6, 0]); }
    for (let i = 0; i < 10; i++) { const a = pts[i], b = pts[i + 1]; g.quad([a[0], a[1], -2.5], [a[0], a[1], 2.5], [b[0], b[1], 2.5], [b[0], b[1], -2.5], w); g.quad([a[0], a[1] - 0.6, 2.5], [a[0], a[1] - 0.6, -2.5], [b[0], b[1] - 0.6, -2.5], [b[0], b[1] - 0.6, 2.5], shadec(w, -0.3)); }
    for (const z of [-2.4, 2.4]) { g.tube(pts.map(([x, y]) => [x, y + 2, z]), 0.2, 4, '#ffd23a'); for (let i = 1; i < 10; i += 2) g.tube([[pts[i][0], pts[i][1], z], [pts[i][0], pts[i][1] + 2, z]], 0.15, 3, '#ffd23a'); }
  },
  toilet: (c) => {
    const g = c.g, w = '#f4f8ff';
    g.cyl(1.6, 2.2, 3, 10, w);
    at(g, 0.8, 3, 0, () => { g.push(); g.scale(1.25, 1, 1); g.cyl(2.6, 2.8, 1.4, 12, w); g.pop(); g.at(0, 1.4, 0); g.push(); g.scale(1.25, 1, 1); g.cyl(2.7, 2.7, 0.35, 12, '#e0e8f0'); g.pop(); });
    g.box(-3.6, 3, -2.2, -1.6, 9, 2.2, w);
    at(g, -2.6, 9, 0, () => g.box(-1.1, 0, -2.4, 1.1, 0.5, 2.4, '#e0e8f0'));
    at(g, -1.55, 8, 1.2, () => g.box(0, 0, -0.3, 0.3, 0.3, 0.3, '#c8d0dc'));
  },
  garden_gnome: (c) => {
    const g = c.g;
    g.cyl(2, 1.6, 4, 8, '#3a8aff');
    at(g, 0, 4, 0, () => { g.sphere(1.6, 1, '#ffd8b8', { smooth: true }); g.at(0, 1, 0); g.cyl(1.7, 0, 4, 8, '#ff3a3a'); });
    at(g, 0, 3, 1.2, () => { g.scale(1, 1.1, 0.6); g.sphere(1.5, 0, '#ffffff'); });
    at(g, 0, 4.1, 1.55, () => g.sphere(0.45, 0, '#ff9a8a'));
    for (const s of [-1, 1]) at(g, s * 0.8, 0, 0.6, () => g.box(-0.5, 0, -0.5, 0.5, 0.6, 1, '#6a4a2a'));
  },
  plastic_flamingo: (c) => {
    const g = c.g, p = '#ff7ab4';
    for (const s of [-1, 1]) g.tube([[s * 0.4, 0, 0], [s * 0.4, 5, 0]], 0.18, 4, '#2a2a34');
    at(g, 0, 6, 0, () => { g.scale(1.5, 0.9, 0.9); g.sphere(2, 1, p, { smooth: true }); });
    g.tube([[2.4, 6.5, 0], [3.2, 9, 0], [2.4, 11, 0], [3.4, 12, 0]], 0.5, 5, p);
    at(g, 3.6, 12, 0, () => g.sphere(0.9, 0, p));
    at(g, 4.6, 11.8, 0, () => { g.rotZ(-0.6); g.cyl(0.45, 0.1, 1.4, 5, '#1a1a24'); });
  },
  toaster: (c) => {
    const g = c.g;
    g.slab(-3.6, 0, -2.2, 3.6, 5, 2.2, 1, { top: '#e8eef4', side: '#c8d4e0' });
    for (const x of [-1.4, 1.4]) g.box(x - 0.5, 5, -1.6, x + 0.5, 5.05, 1.6, '#2a2a34');
    at(g, -1.4, 4.4, 0, () => g.box(-0.4, 0, -1.5, 0.4, 2.2, 1.5, '#e8b46a'));
    g.box(3.6, 2, -0.3, 4.2, 2.6, 0.3, '#2a2a34');
  },
  disco_ball: (c) => {
    const g = c.g;
    g.tube([[0, 0, 0], [0, 4, 0]], 0.2, 4, '#c8d0dc');
    g.cyl(1.6, 1.8, 0.6, 8, '#c8d0dc');
    c.partPivot = [0, 7.6, 0]; c.anim = 'spinY'; c.speed = 1.2;
    c.part.push(); c.part.at(0, 7.6, 0); c.part.sphere(3.6, 1, (i) => (['#f4f8ff', '#b8c8e0', '#e0f0ff', '#d8b8ff', '#b8fff0'][i % 5])); c.part.pop();
  },
  tiny_piano: (c) => {
    const g = c.g, b = '#1a1a24';
    for (const [x, z] of [[-3, -2], [3, -2], [0, 3]]) at(g, x, 0, z, () => g.cyl(0.35, 0.3, 3.4, 5, b));
    g.push(); g.at(0, 3.4, 0);
    g.slab(-5, 0, -3.5, 5, 2.2, 3.5, 1.6, b);
    g.box(-4.6, 2.2, 2.2, 4.6, 2.6, 3.4, '#ffffff');
    for (let i = 0; i < 6; i++) g.box(-4.2 + i * 1.6, 2.6, 2.4, -3.6 + i * 1.6, 2.8, 3.2, b);
    g.at(-5, 2.2, -3.5); g.rotZ(0.6); g.box(0, 0, 0, 9.5, 0.2, 6, '#2a2a34');
    g.pop();
  },
  retro_tv: (c) => {
    const g = c.g, w = '#a8743a';
    for (const s of [-1, 1]) g.tube([[s * 2.5, 0, 0], [s * 2.2, 2, 0]], 0.25, 4, '#2a2a34');
    g.slab(-4.4, 2, -3, 4.4, 9, 3, 0.8, { top: w, side: shadec(w, -0.1) });
    g.box(-3.6, 3, 3, 1.8, 8, 3.3, '#2a3440');
    for (const y of [4, 6.5]) at(g, 3, y, 3, () => { g.rotX(Math.PI / 2); g.cyl(0.5, 0.5, 0.5, 8, '#e0e0e8'); });
    for (const s of [-1, 1]) g.tube([[0, 9, 0], [s * 2.5, 13, -0.5]], 0.12, 3, '#c8d0dc');
    c.glowCol = '#9adcff';
    at(c.glow, -0.9, 5.5, 3.32, () => c.glow.box(-2.4, -2.1, 0, 2.4, 2.1, 0.05, '#ffffff'));
  },
  bathtub: (c) => {
    const g = c.g, w = '#f4f8ff';
    g.slab(-6, 1, -3.4, 6, 5.4, 3.4, 2.2, w);
    for (const [x, z] of [[-5, -2.6], [5, -2.6], [-5, 2.6], [5, 2.6]]) at(g, x, 0, z, () => g.cyl(0.6, 0.8, 1, 6, '#ffd23a'));
    at(g, -5.2, 5.4, 0, () => g.tube([[0, 0, 0], [0, 2.4, 0], [1, 3, 0]], 0.3, 5, '#d8dee8'));
    for (let i = 0; i < 9; i++) at(g, (c.rnd() - 0.5) * 9, 5.8 + c.rnd() * 1.2, (c.rnd() - 0.5) * 5, () => g.sphere(1 + c.rnd(), 0, '#ffffff'));
  },
  traffic_cone: (c) => { const g = c.g; g.box(-2.6, 0, -2.6, 2.6, 0.6, 2.6, '#ff6a1a'); g.cyl(2, 0.4, 8, 10, (j) => '#ff7a2a'); for (const y of [2.6, 5]) at(g, 0, y, 0, () => g.cyl(1.6 - (y - 2.6) * 0.2, 1.4 - (y - 2.6) * 0.2, 1.1, 10, '#ffffff', { caps: false })); },
  phone_booth: (c) => {
    const g = c.g, r = '#e83a3a';
    g.box(-3, 0, -3, 3, 1, 3, r);
    for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) at(g, x, 1, z, () => g.box(-0.4, 0, -0.4, 0.4, 13, 0.4, r));
    g.box(-3, 14, -3, 3, 15.5, 3, r); at(g, 0, 15.5, 0, () => g.slab(-2.6, 0, -2.6, 2.6, 0.8, 2.6, 1, r));
    g.box(-2.2, 1, -2.6, 2.2, 13, -2.2, shadec(r, -0.2));
    c.glowCol = '#fff6c8';
    at(c.glow, 0, 14.4, 3.02, () => c.glow.box(-2, -0.4, 0, 2, 0.4, 0.05, '#ffffff'));
  },
  mini_volcano: (c) => {
    const g = c.g;
    g.lathe([[7, 0], [5.5, 2.5], [3.5, 6], [2, 8.5], [1.4, 8.6]], 9, (i) => (i < 2 ? '#7a5a4a' : '#5a4a44'));
    c.glowCol = '#ff7a2a';
    c.glow.lathe([[1.5, 8.3], [1.2, 8.62]], 9, '#ffffff', { capTop: true });
    for (let i = 0; i < 4; i++) { const a = i * 1.7; c.glow.tube([[Math.cos(a) * 1.4, 8.4, Math.sin(a) * 1.4], [Math.cos(a) * 3, 5.5, Math.sin(a) * 3], [Math.cos(a) * 4.4, 3, Math.sin(a) * 4.4]], 0.35, 4, '#ffffff'); }
  },
  windmill: (c) => {
    const g = c.g;
    g.cyl(3.6, 2.2, 13, 8, '#f4f0e8');
    at(g, 0, 13, 0, () => g.cyl(2.8, 0, 3.4, 8, '#ff6a5a'));
    g.box(-0.9, 0, 3.1, 0.9, 2.6, 3.4, '#a8743a');
    c.partPivot = [0, 12, 3.4]; c.anim = 'spinZ'; c.speed = 0.8;
    const p = c.part;
    for (let i = 0; i < 4; i++) { p.push(); p.at(0, 12, 3.6); p.rotZ(i * Math.PI / 2); p.box(-0.3, 0, -0.1, 0.3, 7, 0.1, '#a8743a'); p.box(0.3, 1.5, -0.05, 2, 7, 0.05, '#f8f8f0'); p.pop(); }
  },
  drawbridge_keep: (c) => {
    const g = c.g, s = '#c8c0d8';
    g.box(-8, 0, -5, 8, 10, 5, { top: shadec(s, 0.1), side: s });
    for (let i = 0; i < 8; i++) g.box(-8 + i * 2.2, 10, 4, -7 + i * 2.2, 11.4, 5, s);
    for (const x of [-8, 8]) at(g, x, 0, 4, () => { g.cyl(2.4, 2.4, 14, 8, shadec(s, -0.05)); g.at(0, 14, 0); g.cyl(2.8, 0, 4, 8, '#5a6aff'); });
    at(g, 0, 0, 5.2, () => { g.rotX(1.3); g.box(-2.6, 0, -0.3, 2.6, 6, 0.3, '#a8743a'); });
    c.glowCol = '#fff2a8';
    at(c.glow, 0, 7.4, 5.05, () => c.glow.box(-1.2, -1, 0, 1.2, 1, 0.05, '#ffffff'));
  },
  dance_robot: (c) => {
    const g = c.g, m = '#d8e0ec';
    for (const s of [-1, 1]) at(g, s * 1.2, 0, 0, () => g.box(-0.7, 0, -0.9, 0.7, 3.6, 0.9, shadec(m, -0.1)));
    g.slab(-2.6, 3.6, -1.8, 2.6, 8, 1.8, 0.8, m);
    at(g, 0, 8.4, 0, () => g.slab(-1.8, 0, -1.6, 1.8, 3, 1.6, 0.6, m));
    for (const s of [-1, 1]) g.tube([[s * 2.6, 7.4, 0], [s * 4, 6, 0.8], [s * 4.4, 8.6, 1.2]], 0.45, 5, shadec(m, -0.15));
    c.glowCol = '#3affd8';
    for (const s of [-1, 1]) at(c.glow, s * 0.75, 10, 1.62, () => c.glow.box(-0.4, -0.3, 0, 0.4, 0.3, 0.05, '#ffffff'));
    at(c.glow, 0, 6, 1.82, () => c.glow.box(-1.4, -0.6, 0, 1.4, 0.6, 0.05, '#ffffff'));
  },
  ufo: (c) => {
    const g = c.g;
    g.tube([[0, 0, 0], [0, 3, 0]], 0.3, 4, '#a8b4c4');
    c.partPivot = [0, 6, 0]; c.anim = 'hover'; c.speed = 1;
    const p = c.part;
    p.push(); p.at(0, 6, 0);
    p.lathe([[0.5, -1.4], [4, -0.6], [6.4, 0], [4, 0.8], [2.4, 1]], 14, (i) => (i === 2 ? '#a8b4c4' : '#d8e0ec'));
    p.at(0, 0.9, 0); p.sphere(2.5, 1, '#8adcff', { cut: 0, smooth: true });
    p.pop();
    c.glowCol = '#8affb0';
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; at(c.glow, Math.cos(a) * 5, 5.9, Math.sin(a) * 5, () => c.glow.sphere(0.4, 0, '#ffffff')); }
  },
  pizza_slice: (c) => {
    const g = c.g;
    g.push(); g.rotX(-0.25);
    g.quad2([0, 0, 0], [-4.5, 0, 10], [4.5, 0, 10], [0, 0, 0], '#ffd27a');
    g.tri([0, 0.8, 0], [-4.5, 0.8, 10], [4.5, 0.8, 10], '#ffc84a');
    g.tri([0, 0, 0], [4.5, 0, 10], [-4.5, 0, 10], '#e8a84a');
    g.tube([[-4.6, 0.6, 10], [0, 0.9, 10.6], [4.6, 0.6, 10]], 0.9, 6, '#d8944a');
    for (let i = 0; i < 6; i++) at(g, (c.rnd() - 0.5) * 4 * (0.4 + i / 8), 0.9, 3 + i, () => { g.scale(1, 0.25, 1); g.sphere(0.8, 0, '#e83a3a'); });
    g.pop();
  },
  burger: (c) => {
    const g = c.g;
    g.cyl(4.2, 4.4, 1.4, 12, '#e8a84a');
    at(g, 0, 1.4, 0, () => g.cyl(4.6, 4.6, 1.3, 12, '#6a3a1a'));
    at(g, 0, 2.7, 0, () => g.cyl(4.9, 4.9, 0.4, 12, '#ffd23a'));
    at(g, 0, 3.1, 0, () => g.cyl(4.9, 4.7, 0.5, 12, '#5ac85a'));
    at(g, 0, 3.6, 0, () => { g.push(); g.scale(1, 0.62, 1); g.sphere(4.5, 1, '#f0b05a', { cut: 0, smooth: true }); g.pop(); });
    for (let i = 0; i < 6; i++) at(g, Math.cos(i * 2.4) * 2.4, 6.1, Math.sin(i * 2.4) * 2.4, () => g.sphere(0.25, 0, '#fff4d8'));
  },
  cactus_pot: (c) => {
    const g = c.g;
    g.cyl(2.6, 3.4, 4, 10, '#e8743a');
    g.cyl(2.5, 2.5, 4.2, 10, '#6a4a2a', { caps: true, bottom: false });
    at(g, 0, 4, 0, () => { g.cyl(1.4, 1.2, 7, 8, '#4ac85a'); g.at(0, 7, 0); g.sphere(1.2, 0, '#4ac85a'); });
    g.tube([[1.2, 7, 0], [2.6, 7.4, 0], [2.8, 9.6, 0]], 0.7, 6, '#4ac85a');
    at(g, 0, 11.6, 0, () => g.sphere(0.6, 0, '#ff6aa8'));
  },
  snowman: (c) => {
    const g = c.g, w = '#ffffff';
    at(g, 0, 3, 0, () => g.sphere(3.2, 1, w, { smooth: true }));
    at(g, 0, 7.4, 0, () => g.sphere(2.4, 1, w, { smooth: true }));
    at(g, 0, 10.6, 0, () => g.sphere(1.7, 1, w, { smooth: true }));
    at(g, 0, 10.6, 1.6, () => { g.rotX(Math.PI / 2); g.cyl(0.4, 0, 1.8, 5, '#ff8a2a'); });
    at(g, 0, 12, 0, () => { g.cyl(1.9, 1.9, 0.3, 10, '#1a1a24'); g.cyl(1.2, 1.2, 2.2, 10, '#1a1a24'); });
    g.push(); g.at(0, 8.9, 0); g.cyl(2, 2, 0.8, 10, '#ff3a5a', { caps: false }); g.pop();
  },
  telescope: (c) => {
    const g = c.g, br = '#e0a84a';
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.28; g.tube([[Math.cos(a) * 3, 0, Math.sin(a) * 3], [0, 6, 0]], 0.25, 4, '#7a4a20'); }
    g.push(); g.at(0, 6.4, 0); g.rotZ(0.6); g.at(0, -4, 0);
    g.cyl(0.9, 1.2, 4, 8, br); g.at(0, 4, 0); g.cyl(1.3, 1.6, 5, 8, shadec(br, -0.05));
    g.pop();
  },
  campfire: (c) => {
    const g = c.g;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; at(g, Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6, () => rock(c, 0.9, '#8a8a96')); }
    for (let i = 0; i < 3; i++) { g.push(); g.at(0, 0.6, 0); g.rotY(i * 1.05); g.rotZ(Math.PI / 2); g.at(0, -2.6, 0); g.cyl(0.45, 0.45, 5.2, 6, '#7a4a20'); g.pop(); }
    c.glowCol = '#ffa83a';
    c.partPivot = [0, 1, 0]; c.anim = 'flicker'; c.speed = 1;
    c.part.push(); c.part.at(0, 0.8, 0); c.part.cyl(1.6, 0, 4.4, 6, '#ffb03a'); c.part.at(0.4, 0, 0.3); c.part.cyl(1, 0, 3, 5, '#ff6a2a'); c.part.pop();
    at(c.glow, 0, 1, 0, () => c.glow.sphere(0.9, 0, '#ffffff'));
  },
  arcade_cabinet: (c) => {
    const g = c.g, b = '#3a2a8a';
    g.box(-3.2, 0, -3, 3.2, 13, 3, { top: b, side: b, front: shadec(b, 0.1) });
    g.box(-3.4, 8.6, 2.6, 3.4, 9.2, 4.4, '#2a2a34');
    for (let i = 0; i < 3; i++) at(g, -1.6 + i * 1.6, 9.2, 3.6, () => g.sphere(0.35, 0, ['#ff3a5a', '#3ad8ff', '#ffd23a'][i]));
    c.glowCol = '#8affea';
    at(c.glow, 0, 11, 3.02, () => c.glow.box(-2.4, -1.6, 0, 2.4, 1.6, 0.05, '#ffffff'));
    at(c.glow, 0, 12.6, 3.02, () => c.glow.box(-2.8, -0.3, 0, 2.8, 0.3, 0.05, '#ffffff'));
  },
  jukebox: (c) => {
    const g = c.g, w = '#a8743a';
    g.box(-3.6, 0, -2.4, 3.6, 7, 2.4, w);
    at(g, 0, 7, 0, () => { g.rotX(Math.PI / 2); g.at(0, -2.4, 0); g.cyl(3.6, 3.6, 4.8, 12, w); });
    c.glowCol = '#ff9ae8';
    c.glow.tube(Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (i / 8); return [-Math.cos(a) * 3.2, 7 + Math.sin(a) * 3.2, 2.45]; }), 0.35, 4, '#ffffff');
    at(c.glow, 0, 4, 2.42, () => c.glow.box(-2.4, -1.5, 0, 2.4, 1.5, 0.05, '#ffffff'));
  },
  beach_set: (c) => {
    const g = c.g;
    g.tube([[0, 0, 0], [0.4, 10, 0]], 0.25, 4, '#ffffff');
    at(g, 0.4, 10, 0, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28, b = ((i + 1) / 8) * 6.28; g.tri2([0, 1.4, 0], [Math.cos(a) * 6, -0.4, Math.sin(a) * 6], [Math.cos(b) * 6, -0.4, Math.sin(b) * 6], i % 2 ? '#ff5a5a' : '#ffffff'); } });
    at(g, 3, 0, 2, () => { g.rotY(-0.4); g.box(-2.4, 0.2, -1.2, 2.4, 0.5, 1.2, '#3ac4f8'); g.box(-2.4, 0.5, -1.2, -2, 3, 1.2, '#3ac4f8'); });
    at(g, -3.4, 1.2, 2.4, () => g.sphere(1.2, 1, (i) => ['#ff5a5a', '#ffffff', '#3ac4f8', '#ffd23a'][i % 4]));
  },
  trampoline: (c) => {
    const g = c.g;
    for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + 0.4; g.tube([[Math.cos(a) * 5, 0, Math.sin(a) * 5], [Math.cos(a) * 5.4, 3, Math.sin(a) * 5.4]], 0.25, 4, '#c8d0dc'); }
    at(g, 0, 3, 0, () => { g.cyl(5.8, 5.8, 0.6, 16, '#3ac4f8', { caps: false }); g.cyl(5.2, 5.2, 0.4, 16, '#1a2430'); });
  },
  fish_statue: (c) => {
    const g = c.g, gd = '#ffd23a';
    g.box(-3.4, 0, -3.4, 3.4, 2, 3.4, { top: '#f4f8ff', side: '#d8e0ec' });
    g.tube([[0, 2, 0], [0, 4, 0]], 0.5, 6, gd);
    g.push(); g.at(0, 8, 0); g.rotZ(0.5); g.scale(1.6, 1, 0.6); g.sphere(3, 1, gd, { smooth: true }); g.pop();
    g.push(); g.at(-4.2, 5.4, 0); g.rotZ(0.5); g.fan([[0, 0, 0], [-3, 2.4, 0], [-2, 0, 0], [-3, -2.4, 0]], gd); g.pop();
    at(g, 3.2, 10, 1.2, () => g.sphere(0.5, 0, '#1a1a24'));
  },
  giant_sneaker: (c) => {
    const g = c.g, w = '#ffffff';
    g.slab(-7, 0, -3, 7, 1.6, 3, 1.4, '#e8eef4');
    g.push(); g.at(-1, 1.6, 0); g.scale(1.7, 0.85, 0.85); g.sphere(3.8, 1, w, { cut: 0 }); g.pop();
    at(g, -3, 1.6, 0, () => g.cyl(2.8, 2.4, 6.4, 10, w));
    g.box(-3, 4.6, -2.9, 3, 5.2, 2.9, '#3ac4f8');
    for (let i = 0; i < 4; i++) g.box(-0.8 + i * 1.2, 4, 2.1, -0.4 + i * 1.2, 5.6, 2.8, '#d0d8e0');
  },
  bowling_pins: (c) => {
    const g = c.g;
    for (let r = 0; r < 3; r++) for (let i = 0; i <= r; i++) at(g, (i - r / 2) * 2.4, 0, -r * 2.2, () => g.lathe([[0.6, 0], [1.1, 1.4], [0.9, 3.2], [0.5, 4.2], [0.75, 5.2], [0.5, 6], [0.05, 6.3]], 8, (k) => (k === 3 ? '#ff3a3a' : '#ffffff'), { capBot: true }));
    at(g, 3.6, 1.6, 2.6, () => g.sphere(1.6, 1, '#3a5aff', { smooth: true }));
  },
  hot_tub: (c) => {
    const g = c.g, w = '#a8743a';
    g.cyl(6, 6, 4.4, 14, (j) => (j % 2 ? w : shadec(w, -0.08)), { caps: false });
    g.cyl(5.4, 5.4, 4.2, 14, '#e8eef4', { caps: false });
    c.glowCol = '#7ae8ff';
    at(c.glow, 0, 3.6, 0, () => c.glow.cyl(5.3, 5.3, 0.2, 14, '#ffffff'));
    for (let i = 0; i < 8; i++) at(g, (c.rnd() - 0.5) * 7, 4, (c.rnd() - 0.5) * 7, () => g.sphere(0.6, 0, '#f4ffff'));
  },
  map_table: (c) => {
    const g = c.g, w = '#a8743a';
    for (const [x, z] of [[-4, -2.6], [4, -2.6], [-4, 2.6], [4, 2.6]]) at(g, x, 0, z, () => g.cyl(0.4, 0.4, 5, 6, shadec(w, -0.2)));
    g.box(-5, 5, -3.4, 5, 5.8, 3.4, w);
    g.box(-3.6, 5.8, -2.4, 3.6, 5.9, 2.4, '#f4e2b0');
    g.box(0.8, 5.9, -0.4, 1.8, 5.95, 0.6, '#e83a3a');
    at(g, -2.6, 5.8, 1.4, () => { g.rotZ(Math.PI / 2); g.cyl(0.25, 0.25, 2, 6, '#e0a84a'); });
  },
  plasma_globe: (c) => {
    const g = c.g;
    g.cyl(2.6, 3, 2.4, 10, '#1a1a24');
    c.glowCol = '#d88aff';
    at(c.glow, 0, 6.6, 0, () => c.glow.sphere(0.9, 1, '#ffffff'));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; c.glow.tube([[0, 6.6, 0], [Math.cos(a) * 2, 7 + Math.sin(i * 3) * 1.4, Math.sin(a) * 2], [Math.cos(a) * 3.8, 6.6 + Math.sin(i) * 2.2, Math.sin(a) * 3.8]], 0.12, 3, '#ffffff'); }
    c.partPivot = [0, 6.6, 0]; c.anim = 'none';
    c.part.push(); c.part.at(0, 6.6, 0); c.part.sphere(4.2, 2, '#c8b8ff', { smooth: true }); c.part.pop();
    c.partAlpha = 0.35;
  },
  crystal_throne: (c) => {
    const g = c.g, cr = '#8adcff';
    g.box(-4, 0, -3.4, 4, 4, 3.4, { top: '#c8f0ff', side: cr });
    g.box(-4, 4, -3.4, 4, 13, -1.6, cr);
    for (const s of [-1, 1]) g.box(s * 4 - 0.8, 4, -3.4, s * 4 + 0.8, 7, 3.4, shadec(cr, -0.1));
    for (let i = 0; i < 5; i++) at(g, -3.2 + i * 1.6, 13, -2.5, () => { g.cyl(0.8, 0, 2.4 + (i % 2) * 1.6, 5, '#e8fbff'); });
    c.glowCol = '#bff8ff';
    at(c.glow, 0, 9, -1.55, () => c.glow.box(-1.2, -1.2, 0, 1.2, 1.2, 0.05, '#ffffff'));
  },
  sunken_car: (c) => {
    const g = c.g, b = '#3ac4f8';
    g.push(); g.rotZ(0.08);
    g.slab(-8, 1.6, -3.6, 8, 5, 3.6, 1.6, b);
    g.push(); g.at(0, 5, 0); g.scale(1.4, 0.9, 0.75); g.sphere(4.2, 1, b, { cut: 0 }); g.pop();
    for (const [x, z] of [[-5, -3.6], [5, -3.6], [-5, 3.6], [5, 3.6]]) at(g, x, 1.6, z, () => { g.rotX(Math.PI / 2); g.at(0, -0.8, 0); g.cyl(1.6, 1.6, 1.6, 10, '#2a2a34'); });
    g.pop();
    c.glowCol = '#fff6c8';
    for (const z of [-2.4, 2.4]) at(c.glow, 8.05, 3.6, z, () => c.glow.box(0, -0.6, -0.8, 0.1, 0.6, 0.8, '#ffffff'));
  },
  rocket_ship: (c) => {
    const g = c.g, w = '#f4f8ff', r = '#ff4a5a';
    g.lathe([[2.4, 2], [2.8, 6], [2.6, 10], [1.8, 13], [0.1, 15.5]], 10, (i) => (i === 3 ? r : w), { capBot: '#c8d0dc' });
    for (let i = 0; i < 3; i++) { g.push(); g.rotY((i / 3) * 6.28); g.fan([[2.4, 2, 0], [5, 0, 0], [4.4, 3.5, 0], [2.7, 6, 0]], r); g.pop(); }
    at(g, 0, 9, 2.6, () => { g.rotX(Math.PI / 2); g.cyl(1, 1, 0.4, 10, '#3ac4f8'); });
    c.glowCol = '#ffb03a';
    at(c.glow, 0, 1.4, 0, () => c.glow.cyl(1.4, 2, 0.8, 8, '#ffffff'));
  },
  cuckoo_clock: (c) => {
    const g = c.g, w = '#8a5a2a';
    g.box(-0.4, 0, -0.4, 0.4, 5, 0.4, '#5a3a1a');
    g.box(-3.4, 5, -1.6, 3.4, 11, 1.6, w);
    at(g, 0, 11, 0, () => { g.rotZ(0); g.tri2([-4.2, 0, 1.8], [4.2, 0, 1.8], [0, 4, 1.8], '#6a4a20'); g.quad([-4.2, 0, 1.8], [0, 4, 1.8], [0, 4, -1.8], [-4.2, 0, -1.8], '#6a4a20'); g.quad([4.2, 0, -1.8], [0, 4, -1.8], [0, 4, 1.8], [4.2, 0, 1.8], '#6a4a20'); });
    at(g, 0, 8, 1.6, () => { g.rotX(Math.PI / 2); g.cyl(2.2, 2.2, 0.2, 12, '#f4f0e0'); });
    g.box(-0.1, 8, 1.85, 0.1, 9.6, 1.95, '#1a1a24'); g.box(-0.1, 7.9, 1.85, 1.2, 8.1, 1.95, '#1a1a24');
    at(g, 0, 12.4, 1.6, () => { g.scale(1, 1, 0.7); g.sphere(0.8, 0, '#ffd23a'); });
  },
  gumball_machine: (c) => {
    const g = c.g;
    g.cyl(1.8, 2.4, 1.4, 10, '#ff3a5a');
    at(g, 0, 1.4, 0, () => g.cyl(1, 1, 4, 8, '#ff3a5a'));
    at(g, 0, 5.4, 0, () => { g.slab(-2, 0, -2, 2, 1.6, 2, 0.6, '#ff3a5a'); g.box(-0.5, 0.3, 2, 0.5, 1.2, 2.3, '#d0d8e0'); });
    c.partPivot = [0, 10, 0]; c.anim = 'none';
    for (let i = 0; i < 16; i++) { const a = i * 2.4, r = 1.6 + (i % 3) * 0.6; at(g, Math.cos(a) * r * 0.6, 8 + (i % 4) * 1.1, Math.sin(a) * r * 0.6, () => g.sphere(0.6, 0, ['#ff5a8a', '#ffd23a', '#3ad8ff', '#8ae84a', '#a86aff'][i % 5])); }
    c.part.push(); c.part.at(0, 9.6, 0); c.part.sphere(3.4, 1, '#e8fbff', { smooth: true }); c.part.pop();
    c.partAlpha = 0.3;
    at(g, 0, 13, 0, () => g.cyl(1.2, 1.2, 0.8, 8, '#ff3a5a'));
  },
};

function lavaLamp(c, s, blob, metal) {
  const g = c.g;
  g.lathe([[2.4 * s, 0], [1.6 * s, 3 * s]], 10, metal, { capBot: true });
  g.lathe([[1.4 * s, 7.6 * s], [0.9 * s, 9.4 * s]], 10, metal, { capTop: true });
  c.glowCol = blob;
  c.glow.push(); c.glow.at(0, 4.4 * s, 0); c.glow.sphere(0.9 * s, 1, '#ffffff'); c.glow.at(0.2 * s, 2.1 * s, 0); c.glow.sphere(0.6 * s, 1, '#ffffff'); c.glow.pop();
  c.partPivot = [0, 0, 0]; c.anim = 'none';
  c.part.lathe([[1.6 * s, 3 * s], [1.9 * s, 5 * s], [1.4 * s, 7.6 * s]], 10, mixc(blob, '#ffffff', 0.55), { smooth: true });
  c.partAlpha = 0.45;
}

export function decorPartAlpha(id) {
  return ['lava_lamp', 'lava_lamp_giant', 'lava_lamp_slime', 'lava_lamp_galaxy', 'plasma_globe', 'gumball_machine'].includes(id) ? 0.4 : 1;
}
