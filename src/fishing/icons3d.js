// [phase9:fishing] 3D icons for the fishing HUD and the boss UI (no 2D pixel glyphs): glossy low-poly models built
// with the icon toolkit (src/gfx/iconmeshes.js) and rendered through bigicons.modelFrame (full-res `.hi` twins).
//   icon3d(id, px, turn = 0) -> {canvas, ox, oy} | null   ids: bolt, bolt_off, mouse, mouse_lit, space, space_lit,
//                                                         trophy, chest, chest_gold, chest_orb, skull, heart
//   drawIcon3d(ctx, id, x, y, px, turn = 0, alpha = 1) -> bool   (centred on x, y)
import { CHEST_VOX } from '../gfx/iconvox.js';
import { MeshBuilder } from '../gfx/lowpoly.js';
import { lathe, prism, box, sphere, tube, jit } from '../gfx/iconmeshes.js';
import { modelFrame } from '../gfx/bigicons.js';

const BOLT = [[0.18, 0.95], [-0.42, -0.05], [-0.04, -0.05], [-0.22, -0.95], [0.46, 0.12], [0.06, 0.12], [0.3, 0.95]];

function bolt(lit = true) {
  const mb = new MeshBuilder();
  const c = lit ? '#ffd23a' : '#9aaabc';
  prism(mb, BOLT, -0.14, 0.14, c, { front: (i) => jit(lit ? '#ffe46a' : '#c0ccd8', i, 0.05), side: lit ? '#d88a10' : '#6a7a8c' });
  return { mesh: mb.build(), yaw: -0.3, pitch: 0.15, spin: 'wobble', look: { spec: 0.9, shine: 26 } };
}

function mouse(lit = false) {
  const mb = new MeshBuilder();
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; prof.push([Math.sin(a) * 0.62, -Math.cos(a) * 0.95]); }
  prof[0][0] = 0; prof[8][0] = 0;
  lathe(mb, prof, 10, (i, j) => jit(i > 4 && j > 2 && j < 6 ? (lit ? '#ffd23a' : '#e8f4fc') : '#f4fbff', i * 10 + j, 0.04));
  box(mb, -0.03, 0.15, -0.66, 0.03, 0.95, 0.66, '#3a6f8a');
  tube(mb, [[0, 0.98, 0], [0.1, 1.25, 0.05], [0.3, 1.4, 0]], 0.05, 4, '#3a6f8a');
  return { mesh: mb.build(), yaw: 0.35, pitch: 0.5, spin: 'wobble', look: { spec: 0.8, shine: 20 } };
}

function space(lit = false) {
  const mb = new MeshBuilder();
  const top = lit ? '#ffd23a' : '#f4fbff', side = lit ? '#d88a10' : '#a8c8dc';
  box(mb, -1, -0.32, -0.3, 1, 0.32, 0.3, { top, front: lit ? '#ffe46a' : '#e8f4fc', side, back: side });
  return { mesh: mb.build(), yaw: 0, pitch: 0.55, spin: 'wobble', look: { spec: 0.7, shine: 18 } };
}

function trophy() {
  const mb = new MeshBuilder();
  const cup = [[0, 0.1], [0.2, 0.12], [0.42, 0.3], [0.56, 0.6], [0.62, 0.95], [0.56, 0.95]];
  lathe(mb, cup, 12, (i, j) => jit(i < 2 ? '#e0a020' : '#ffd23a', i * 12 + j, 0.05), { capTop: true, capCol: '#c8800e' });
  lathe(mb, [[0.1, -0.45], [0.1, 0.12]], 8, '#e0a020');
  lathe(mb, [[0.46, -0.95], [0.46, -0.75], [0.3, -0.62], [0.1, -0.45]], 10, (i, j) => jit('#3a7ad0', i * 10 + j, 0.05), { capBottom: true });
  for (const s of [-1, 1]) tube(mb, [[s * 0.58, 0.82, 0], [s * 0.86, 0.72, 0], [s * 0.82, 0.45, 0], [s * 0.5, 0.36, 0]], 0.07, 5, '#ffc22a');
  sphere(mb, [0, 0.66, 0.5], 0.12, 0, '#fff6c0');
  return { mesh: mb.build(), yaw: 0.2, pitch: 0.18, spin: 'wobble', look: { spec: 1, shine: 30 } };
}


function skull() {
  const mb = new MeshBuilder();
  sphere(mb, [0, 0.15, 0], [0.72, 0.68, 0.66], 1, (c, i) => jit('#f4f0e8', i, 0.05));
  box(mb, -0.42, -0.72, -0.3, 0.42, -0.3, 0.42, '#e8e0d0');
  for (const s of [-1, 1]) sphere(mb, [s * 0.26, 0.12, 0.55], [0.18, 0.2, 0.08], 0, '#2a1a3a');
  prism(mb, [[-0.08, -0.12], [0.08, -0.12], [0, 0.02]], 0.5, 0.62, '#2a1a3a');
  return { mesh: mb.build(), yaw: 0.25, pitch: 0.1, spin: 'wobble', look: { spec: 0.5, shine: 14 } };
}

function heart() {
  const mb = new MeshBuilder();
  const pts = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([0.9 * Math.pow(Math.sin(a), 3), 0.75 * Math.cos(a) - 0.3 * Math.cos(2 * a) - 0.12 * Math.cos(3 * a) - 0.05 * Math.cos(4 * a)]); }
  prism(mb, pts, -0.2, 0.2, '#ff4f6e', { front: (i) => jit('#ff6a86', i, 0.05), side: '#c8203e' });
  return { mesh: mb.build(), yaw: -0.3, pitch: 0.1, spin: 'wobble', look: { spec: 0.9, shine: 24 } };
}

const MAKERS = {
  bolt: () => bolt(true), bolt_off: () => bolt(false), mouse: () => mouse(false), mouse_lit: () => mouse(true),
  space: () => space(false), space_lit: () => space(true), trophy, chest: () => CHEST_VOX('iron'), chest_crate: () => CHEST_VOX('crate'),
  chest_gold: () => CHEST_VOX('golden'), chest_orb: () => CHEST_VOX('orb'), skull, heart, // [icons15] detailed voxel chests
};

export function icon3d(id, px, turn = 0) {
  const make = MAKERS[id];
  if (!make) return null;
  try { return modelFrame('fish3d:' + id, make, px, turn); } catch (e) { return null; }
}

export function drawIcon3d(ctx, id, x, y, px, turn = 0, alpha = 1) {
  const f = icon3d(id, px, turn);
  if (!f) return false;
  const a = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = a * alpha;
  ctx.drawImage(f.canvas, Math.round(x - f.ox), Math.round(y - f.oy));
  ctx.globalAlpha = a;
  return true;
}

export function chestIconId(itemId) {
  return itemId === 'pkg_golden' ? 'chest_gold' : itemId === 'pkg_orb' ? 'chest_orb' : itemId === 'pkg_crate' ? 'chest_crate' : 'chest';
}
