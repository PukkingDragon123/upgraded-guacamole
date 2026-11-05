// The 3D fish tank itself, per tier and gear (phase 6): glass with bright polished edges and reflection streaks, the
// hood / lid light (silver lamp hood, white LED lid, reef pendant, wall bezel), filter, heater, air stones and
// airline, a gravel / sand substrate with pebbles and a visible cross-section through the glass, the water volume,
// the meniscus, caustic overlay, light shafts and the animated surface.
//
//   buildTank(tier, gear) -> kit {
//     shape: TankShape, opaque: LPMesh, glow: [{mesh, col}] (unlit lights), glass: [{mesh, pos, a, inner}],
//     water: {mesh, pos}, caustic: LPMesh (floor overlay, uv-tiled), shafts: [{x, z, w, a, ph}], stones: [[x,y,z]],
//     filterOut: [x,y,z] | null, heater: [x,y,z] | null, lightCol, sub (substrate palette), lid: {y, ...} }
//   surfaceMesh(dyn, kit, ripples, below)   rebuilds the rippling surface into a DynMesh (double sided)
//   causticFrames() -> [canvas]  tileable animated caustic network (alpha), CAUSTIC_TILE (cm per tile)
//   shaftTexture() -> canvas      soft vertical light-shaft gradient

import { Geo, rgb, mixc, shadec, srand } from './lpkit.js';
import { TankShape } from './sim3d.js';

export const SUBSTRATES = [
  { name: 'Aqua Gravel', cols: ['#e8dcb4', '#d8ccA0', '#f0e6c4', '#cfc29a'], peb: ['#6ad8f0', '#bff4ff', '#3aa8e0', '#f4fbff', '#8ae0d0', '#2a8cd0'], side: ['#b8a47a', '#d4c49a'], pebN: 1.4 },
  { name: 'Beach Sand', cols: ['#f4e2b0', '#ecd8a4', '#f8eac4', '#e4d098'], peb: ['#fff0c8', '#dcc08a', '#f8e8c0', '#ffffff'], side: ['#c8a870', '#e0c690'], pebN: 0.35 },
  { name: 'Snow Pebbles', cols: ['#e8eef4', '#dfe8f0', '#eef4f8', '#d8e2ec'], peb: ['#ffffff', '#e8f0f8', '#d0dce8', '#f4f8ff', '#c0d0e0'], side: ['#a8b8cc', '#d0dce8'], pebN: 1.6 },
  { name: 'Rainbow Gravel', cols: ['#e8e0f0', '#dcd8ec', '#f0e8f4', '#d4d0e4'], peb: ['#ff6a8a', '#ffd23a', '#6ae04a', '#3ac4f8', '#a86aff', '#ff9a3a', '#ffffff'], side: ['#9a8ab0', '#c0b4d4'], pebN: 1.6 },
  { name: 'Black Sand', cols: ['#2a2e3a', '#32364a', '#262a36', '#3a3e4e'], peb: ['#3a3e4c', '#1a1e28', '#4a5060', '#2a3240'], side: ['#1a1e28', '#2a2e3a'], pebN: 0.6, glint: '#e8f4ff' },
];
export const LIGHTS = [
  { col: '#eef8ff', shaft: '#fffbe8', n: 2 },
  { col: '#8adcff', shaft: '#d8f6ff', n: 4 },
  { col: 'rainbow', shaft: '#f0e8ff', n: 5 },
  { col: '#fff0c0', shaft: '#fff4d0', n: 7 },
];

export const CAUSTIC_TILE = 18;
const GLASS_EDGE = '#b4f6ee';
const SILVER = '#d4dee8', SILVER_D = '#8e9cac', WHITE = '#f6fbff', AQUA = '#3ac4f8';

export function buildTank(tier, gear = {}) {
  const T = new TankShape(tier);
  const g = new Geo();
  const kit = { shape: T, glow: [], glass: [], shafts: [], stones: [], filterOut: null, heater: null };
  const gl = (id) => Math.max(0, Math.min(9, gear[id] | 0));
  const sub = SUBSTRATES[gl('sand') % SUBSTRATES.length];
  const light = LIGHTS[Math.min(LIGHTS.length - 1, gl('light'))];
  kit.sub = sub; kit.light = light;
  kit.lightCol = light.col === 'rainbow' ? '#e8d8ff' : light.col;
  const rnd = srand(77 + tier * 13);

  substrate(g, T, sub, rnd, tier);
  if (T.round) roundTank(g, kit, T, gear, gl);
  else boxTank(g, kit, T, gear, gl, tier);
  equipment(g, kit, T, gl, rnd);
  kit.opaque = g.build();
  kit.caustic = causticOverlay(T);
  // light shafts: start under the light, spread across the tank
  const n = T.round ? Math.max(1, Math.round(light.n / 2)) : light.n + (tier >= 4 ? 2 : 0);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.3 + rnd() * 0.4) / n;
    const p = T.floorPoint(0.12 + u * 0.76, 0.2 + rnd() * 0.6, 3);
    kit.shafts.push({ x: p[0], z: p[2], w: T.minDim * (0.12 + rnd() * 0.1), a: 0.13 + rnd() * 0.08, ph: rnd() * 6.28, tilt: (rnd() - 0.5) * 0.25 });
  }
  return kit;
}

// ------------------------------------------------------------------ substrate
function substrate(g, T, sub, rnd, tier) {
  const cols = sub.cols.map(rgb);
  // soft sandy base: a slow blend between the palette colours plus a little per-facet grain
  const pick = (x, z) => {
    const n = (Math.sin(x * 0.31 + z * 0.17) * 0.5 + Math.sin(x * 0.07 - z * 0.29 + 1.3) * 0.5) * 0.5 + 0.5;
    const i = Math.min(cols.length - 2, Math.floor(n * (cols.length - 1)));
    const h = Math.sin(x * 91.7 + z * 47.3) * 43758.5;
    return shadec(mixc(cols[i], cols[i + 1], n * (cols.length - 1) - i), ((h - Math.floor(h)) - 0.5) * 0.08);
  };
  if (T.round) {
    // disk of gravel on the globe floor, a skirt down to the glass, pebbles
    const fr = T.floorR + 0.5;
    const rings = 7, seg = 28;
    const pt = (i, j) => {
      const r = fr * (i / rings), a = (j / seg) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      return [x, T.floorY(x, z), z];
    };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j);
      g.tri(a, b, c, pick(a[0] + 1, a[2])); g.tri(a, c, d, pick(d[0], d[2] + 2));
    }
    for (let j = 0; j < seg; j++) {
      const a = pt(rings, j), b = pt(rings, j + 1);
      g.quad2([b[0], 0.4, b[2]], [a[0], 0.4, a[2]], a, b, rgb(sub.side[j % 2]));
    }
    pebbles(g, T, sub, rnd, Math.round(fr * fr * 0.35 * sub.pebN));
    if (tier >= 1) driftwood(g, T.floorPoint(0.3, 0.7, 3), T.minDim * 0.022, 0.6, rnd);
    return;
  }
  const cell = Math.max(1.4, T.W / 64);
  const nx = Math.ceil(T.W / cell), nz = Math.ceil(T.D / cell);
  const X = (i) => -T.W / 2 + (i / nx) * T.W, Z = (j) => -T.D / 2 + (j / nz) * T.D;
  const P = (i, j) => { const x = X(i), z = Z(j); return [x, T.floorY(x, z), z]; };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    g.tri(a, d, c, pick(a[0], a[2])); g.tri(a, c, b, pick(c[0] + 3, c[2]));
  }
  // cross-section seen through the glass: banded layers of substrate
  const band = () => rgb(sub.side[0]);
  for (let i = 0; i < nx; i++) {
    const a = P(i, nz), b = P(i + 1, nz);
    sideStrip(g, [a[0], 0.3, a[2]], [b[0], 0.3, b[2]], a, b, band, cols);
    const c = P(i + 1, 0), d = P(i, 0);
    sideStrip(g, [c[0], 0.3, c[2]], [d[0], 0.3, d[2]], c, d, band, cols);
  }
  for (let j = 0; j < nz; j++) {
    const a = P(nx, j + 1), b = P(nx, j);
    sideStrip(g, [a[0], 0.3, a[2]], [b[0], 0.3, b[2]], a, b, band, cols);
    const c = P(0, j), d = P(0, j + 1);
    sideStrip(g, [c[0], 0.3, c[2]], [d[0], 0.3, d[2]], c, d, band, cols);
  }
  pebbles(g, T, sub, rnd, Math.round(T.W * T.D / 16 * sub.pebN));
  // a few feature rocks (bigger tanks: a rock garden; reef: live-rock pillars at the back)
  const rocks = tier >= 4 ? 9 : tier >= 3 ? 5 : 3;
  for (let i = 0; i < rocks; i++) {
    const p = T.floorPoint(0.08 + rnd() * 0.84, 0.55 + rnd() * 0.42, 4);
    const r = T.minDim * (0.05 + rnd() * 0.07);
    g.push(); g.at(p[0], p[1] - r * 0.2, p[2]); g.rotY(rnd() * 6.28);
    g.rock(r, 31 + i * 7 + tier, rnd() > 0.5 ? '#8e98a8' : '#a8a090', { sy: 0.65 + rnd() * 0.3 });
    g.pop();
  }
  // driftwood: a gnarled branch arching out of the gravel (two for the bigger tanks)
  driftwood(g, T.floorPoint(0.28, 0.72, 4), T.minDim * 0.03, -0.4, rnd);
  if (tier >= 3) driftwood(g, T.floorPoint(0.78, 0.62, 4), T.minDim * 0.025, 2.6, rnd);
  if (tier >= 4) {
    // live rock arch at the back with encrusting colour
    for (let i = 0; i < 7; i++) {
      const u = 0.18 + i * 0.1, p = T.floorPoint(u, 0.9, 3);
      const r = T.minDim * (0.09 + 0.05 * Math.sin(i * 1.7) ** 2);
      g.push(); g.at(p[0], p[1] + (i > 1 && i < 5 ? r * 0.9 : 0), p[2]); g.rotY(i);
      g.rock(r, 300 + i, i % 2 ? '#c88a9a' : '#a8889a', { sy: 0.8 });
      g.pop();
    }
  }
}

function driftwood(g, p, k, yaw, rnd) {
  const wood = (i) => (i % 2 ? '#8a5a3a' : '#7a4e30');
  g.push(); g.at(p[0], p[1] - 0.4 * k, p[2]); g.rotY(yaw);
  const main = [[-14, 0, 0], [-8, 3, 1], [-2, 7, -0.5], [4, 12, 1], [8, 18, 0], [9, 22, 1.5]].map(([x, y, z]) => [x * k, y * k, z * k]);
  g.tube(main, [2.2, 1.9, 1.6, 1.3, 0.9, 0.5].map((r) => r * k), 6, wood);
  const branch = (from, pts, r) => g.tube([main[from], ...pts.map(([x, y, z]) => [x * k, y * k, z * k])], [r * k, r * 0.7 * k, r * 0.35 * k], 5, wood);
  branch(2, [[-6, 12, 3], [-9, 16, 5]], 1.1);
  branch(3, [[10, 14, -3], [14, 15, -5]], 0.9);
  branch(4, [[5, 22, -2], [3, 26, -2.5]], 0.6);
  // roots and a knot
  g.tube([main[0], [-17 * k, -0.5 * k, 3 * k], [-19 * k, -1 * k, 5 * k]], [1.6 * k, 0.9 * k, 0.3 * k], 5, '#6a4228');
  g.push(); g.at(main[2][0], main[2][1], main[2][2]); g.sphere(1.9 * k, 0, '#946238', { jit: 0.3, seed: 5 }); g.pop();
  void rnd;
  g.pop();
}

function sideStrip(g, a0, b0, a1, b1, band, cols) {
  // split vertically into 2 bands for a layered look
  const m = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const am = m(a0, a1, 0.55), bm = m(b0, b1, 0.55);
  const k = Math.sin(a0[0] * 3.1 + a0[2] * 2.3) * 0.04;
  g.quad(a0, b0, bm, am, shadec(band(a0[1], a0[0]), k));
  g.quad(am, bm, b1, a1, shadec(cols[1], k));
}

function pebbles(g, T, sub, rnd, n) {
  const cols = sub.peb;
  const old = g.jit;
  g.jit = 0.15;
  for (let i = 0; i < n; i++) {
    const p = T.floorPoint(rnd(), rnd(), 1);
    const r = T.minDim * (0.008 + rnd() * 0.012) + 0.12;
    g.push(); g.at(p[0], p[1] - r * 0.15, p[2]); g.rotY(rnd() * 6.28); g.scale(1, 0.6, 0.8);
    g.sphere(r, 0, cols[Math.floor(rnd() * cols.length)], { jit: 0.3, seed: i + 5 });
    g.pop();
  }
  if (sub.glint) for (let i = 0; i < n / 3; i++) {
    const p = T.floorPoint(rnd(), rnd(), 1);
    g.push(); g.at(p[0], p[1] + 0.05, p[2]); g.sphere(0.12, 0, sub.glint); g.pop();
  }
  g.jit = old;
}

// ------------------------------------------------------------------ round tanks (jar, bowl)
function roundTank(g, kit, T, gear, gl) {
  const P = T.prof;
  const th = T.d.kind === 'jar' ? 0.55 : 0.45;
  const outer = P.map(([r, y]) => [r + th, y]);
  outer.unshift([P[0][0] * 0.9 + th, 0]);
  // glass: the far half shows its inside, the near half its outside (insertion order keeps it right)
  const gi = new Geo(), go = new Geo();
  gi.lathe(outer, 28, '#dff8ff', { smooth: true, inside: true });
  go.lathe(outer, 28, '#e8fbff', { smooth: true });
  // thick glass base disk
  go.cyl(outer[0][0], outer[0][0], 0.5, 28, '#c8f4f0', { smooth: false });
  kit.glass.push({ mesh: gi.build(), pos: [0, 0, 0], a: 0.16, inner: true });
  kit.glass.push({ mesh: go.build(), pos: [0, 0, 0], a: 0.2 });
  // the classic curved window highlight + a thin rim light on the far side (glossy streaks on the glass)
  const hl = new Geo();
  const band = (a0, a1, y0, y1, push) => {
    // a lens-shaped streak: widest in the middle, tapering to points
    const n = 6, am = (a0 + a1) / 2, hw = (a1 - a0) / 2;
    const R = (y) => T.rAt(y) + th + push;
    const P = (a, y) => [Math.cos(a) * R(y), y, Math.sin(a) * R(y)];
    for (let j = 0; j < n; j++) {
      const ya = y0 + (y1 - y0) * (j / n), yb = y0 + (y1 - y0) * ((j + 1) / n);
      const wa = hw * Math.sin(Math.PI * j / n), wb = hw * Math.sin(Math.PI * (j + 1) / n);
      hl.quad(P(am + wa, ya), P(am - wa, ya), P(am - wb, yb), P(am + wb, yb), '#ffffff');
    }
  };
  band(1.95, 2.22, T.d.water * 0.22, T.d.water * 0.82, 0.06);
  band(2.3, 2.38, T.d.water * 0.3, T.d.water * 0.7, 0.06);
  kit.glass.push({ mesh: hl.build(), pos: [0, 0, 0], a: 0.2, streak: true });
  const top = P[P.length - 1];
  if (T.d.kind === 'jar') {
    // screw neck threads + a glossy aqua lid resting tilted against the jar
    for (let k = 0; k < 2; k++) {
      g.push(); g.at(0, top[1] - 0.9 - k * 0.9, 0);
      ring(g, top[0] + th + 0.06, 0.12, 24, GLASS_EDGE);
      g.pop();
    }
    // the jar's glossy aqua screw lid, lying on the desk beside it
    g.push(); g.at(T.R + top[0] + 4, 0, T.R * 0.5); g.rotZ(0.06);
    g.cyl(top[0] + th + 0.5, top[0] + th + 0.5, 1.5, 20, AQUA, { capCol: '#7fdcff' });
    g.at(0, 1.5, 0); g.cyl(top[0] * 0.72, top[0] * 0.6, 0.3, 20, '#f4fbff');
    g.pop();
  }
  // rolled lip
  g.push(); g.at(0, top[1], 0); ring(g, top[0] + th * 0.5, th * 0.75, 28, GLASS_EDGE); g.pop();
  // base ring catches the light
  g.push(); g.at(0, 0.25, 0); ring(g, outer[0][0] - 0.1, 0.25, 28, GLASS_EDGE); g.pop();
  // the water: a lathe volume (seen from outside), up to the water level
  const wv = new Geo();
  const wp = [];
  for (const [r, y] of P) if (y < T.waterY) wp.push([Math.max(0.1, r - 0.05), Math.max(y, 0.6)]);
  wp.push([T.rAt(T.waterY) - 0.05, T.waterY]);
  wv.lathe(wp, 24, '#3ab8e4', { smooth: true });
  kit.water = { mesh: wv.build(), pos: [0, 0, 0] };
  // meniscus ring on the glass
  const mg = new Geo();
  mg.push(); mg.at(0, T.waterY, 0); ring(mg, T.rAt(T.waterY) - 0.05, 0.12, 32, '#ffffff'); mg.pop();
  kit.glow.push({ mesh: mg.build(), col: [0.93, 1, 1], a: 0.55 });
  // a clip-on lamp for the bowl with light gear
  kit.lid = { y: top[1] };
  if (gl('light') > 0) {
    const lx = -top[0] * 0.2;
    g.push(); g.at(lx, top[1], -top[0] - th);
    g.box(-1.2, -2.5, -0.6, 1.2, 0.8, 0.4, SILVER);
    g.tube([[0, 0.8, 0], [0, 4.2, 0.4], [0, 5.6, 2.6], [0, 5.4, 5.2]], 0.35, 6, SILVER_D);
    g.at(0, 5.2, 5.6); g.slab(-2.4, -0.4, -1.6, 2.4, 0.6, 1.6, 0.5, WHITE);
    g.pop();
    const lg = new Geo();
    lg.push(); lg.at(lx, top[1] + 5.0, -top[0] - th + 5.6); lg.box(-2.1, -0.2, -1.3, 2.1, 0.05, 1.3, '#ffffff'); lg.pop();
    kit.glow.push({ mesh: lg.build(), col: rgb(kit.lightCol), a: 1, light: true });
  }
}

function ring(g, R, r, seg, col) {
  const pts = [];
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([Math.cos(a) * R, 0, Math.sin(a) * R]); }
  g.tube(pts, r, 5, col, { caps: false });
}

// ------------------------------------------------------------------ box tanks
function boxTank(g, kit, T, gear, gl, tier) {
  const W = T.W, H = T.H, D = T.D, t = tier >= 4 ? 1 : 0.7;
  const hood = T.d.hood;
  // glass panes (thin boxes), each its own item so they sort against the water
  const pane = (x0, y0, z0, x1, y1, z1, a) => {
    const pg = new Geo();
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    pg.box(x0 - cx, y0 - cy, z0 - cz, x1 - cx, y1 - cy, z1 - cz, '#e4fbff');
    kit.glass.push({ mesh: pg.build(), pos: [cx, cy, cz], a });
  };
  pane(-W / 2 - t, 0, D / 2, W / 2 + t, H, D / 2 + t, 0.12);   // front
  pane(-W / 2 - t, 0, -D / 2 - t, W / 2 + t, H, -D / 2, 0.12); // back
  pane(-W / 2 - t, 0, -D / 2, -W / 2, H, D / 2, 0.14);         // left
  pane(W / 2, 0, -D / 2, W / 2 + t, H, D / 2, 0.14);           // right
  // reflection streaks on the front glass (slanted glossy bands)
  const st = new Geo();
  const sz = D / 2 + t + 0.05;
  for (const [u, w, k] of [[0.12, 0.05, 1], [0.19, 0.015, 0.8], [0.62, 0.035, 0.9], [0.68, 0.012, 0.7]]) {
    const x0 = -W / 2 + W * u, dx = H * 0.35;
    st.quad([x0, H * 0.05, 0], [x0 + W * w, H * 0.05, 0], [x0 + W * w + dx, H * 0.95 * k, 0], [x0 + dx, H * 0.95 * k, 0], '#ffffff');
  }
  kit.glass.push({ mesh: st.build(), pos: [0, 0, sz], a: 0.16, streak: true });
  // bright polished glass edges (the classic green-aqua edge glow) + silicone seams
  const e = t * 0.55;
  const edge = (x0, y0, z0, x1, y1, z1) => g.box(x0, y0, z0, x1, y1, z1, GLASS_EDGE);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 + t / 2), z = sz * (D / 2 + t / 2);
    edge(x - e, 0, z - e, x + e, H, z + e);
  }
  for (const y of [0, H]) {
    edge(-W / 2 - t, y - e, D / 2, W / 2 + t, y + (y ? 0 : e), D / 2 + t);
    edge(-W / 2 - t, y - e, -D / 2 - t, W / 2 + t, y + (y ? 0 : e), -D / 2);
    edge(-W / 2 - t, y - e, -D / 2, -W / 2, y + (y ? 0 : e), D / 2);
    edge(W / 2, y - e, -D / 2, W / 2 + t, y + (y ? 0 : e), D / 2);
  }
  // bottom glass plate (seen from below the rim)
  g.box(-W / 2 - t, -0.4, -D / 2 - t, W / 2 + t, 0, D / 2 + t, '#9ee8e0');
  // water volume, meniscus
  const wv = new Geo();
  wv.box(-W / 2 + 0.05, 0.2 - T.waterY / 2, -D / 2 + 0.05, W / 2 - 0.05, T.waterY / 2, D / 2 - 0.05, '#3ab8e4');
  kit.water = { mesh: wv.build(), pos: [0, T.waterY / 2, 0] };
  const mg = new Geo();
  const wy = T.waterY, m = 0.12;
  mg.box(-W / 2, wy - m, D / 2 - 0.08, W / 2, wy + m, D / 2 - 0.02, '#ffffff');
  mg.box(-W / 2, wy - m, -D / 2 + 0.02, W / 2, wy + m, -D / 2 + 0.08, '#ffffff');
  mg.box(-W / 2 + 0.02, wy - m, -D / 2, -W / 2 + 0.08, wy + m, D / 2, '#ffffff');
  mg.box(W / 2 - 0.08, wy - m, -D / 2, W / 2 - 0.02, wy + m, D / 2, '#ffffff');
  kit.glow.push({ mesh: mg.build(), col: [0.93, 1, 1], a: 0.6 });

  const lg = new Geo();
  if (hood === 'lamp') {
    // the moving-picture lamp look: brushed silver hood + base, blue light strip, rocker switch
    g.slab(-W / 2 - 2.2, H, -D / 2 - 2.2, W / 2 + 2.2, H + 5.2, D / 2 + 2.2, 1.6, { top: SILVER, side: shadec(SILVER, -0.06), bottom: SILVER_D });
    g.slab(-W / 2 - 1.6, H + 5.2, -D / 2 - 1.6, W / 2 + 1.6, H + 5.9, D / 2 + 1.6, 1.2, '#eef4fa');
    g.slab(-W / 2 - 2.4, -4.6, -D / 2 - 2.4, W / 2 + 2.4, -0.4, D / 2 + 2.4, 1.6, { top: SILVER, side: shadec(SILVER, -0.08), bottom: SILVER_D });
    // screws + the rocker switch
    for (const sx of [-1, 1]) { g.push(); g.at(sx * (W / 2 - 1), H + 2.6, D / 2 + 2.25); g.rotX(Math.PI / 2); g.cyl(0.45, 0.45, 0.15, 8, SILVER_D); g.pop(); }
    g.box(W / 2 - 7, H + 1.4, D / 2 + 2.1, W / 2 - 3.2, H + 3.8, D / 2 + 2.6, '#10141a');
    g.box(W / 2 - 6.8, H + 1.6, D / 2 + 2.5, W / 2 - 5.1, H + 3.6, D / 2 + 2.9, '#2a323e');
    lg.box(-W / 2 + 0.6, H - 0.25, -D / 2 + 0.6, W / 2 - 0.6, H - 0.05, D / 2 - 0.6, '#ffffff');
    kit.lid = { y: H + 5.9, sw: [W / 2 - 5, H + 2.6, D / 2 + 2.8] };
  } else if (hood === 'lid') {
    // glossy white lid with an aqua trim and a long LED bar underneath; black-white bottom trim
    g.slab(-W / 2 - 1.4, H + 0.2, -D / 2 - 1.4, W / 2 + 1.4, H + 3.8, D / 2 + 1.4, 1.1, { top: WHITE, side: '#e8f2fa', bottom: '#b8c8d8' });
    g.box(-W / 2 - 1.42, H + 0.6, D / 2 + 1.3, W / 2 + 1.42, H + 1.1, D / 2 + 1.48, AQUA);
    g.slab(-W / 2 * 0.7, H + 3.8, -D / 2 * 0.5, W / 2 * 0.7, H + 4.3, D / 2 * 0.5, 0.8, '#f0f6fc');
    g.box(-W / 2 - 1.2, -1.6, -D / 2 - 1.2, W / 2 + 1.2, 0, D / 2 + 1.2, { top: '#e8f2fa', side: '#2a3a4a' });
    lg.box(-W / 2 + 1, H - 0.1, -D / 4, W / 2 - 1, H + 0.2, D / 6, '#ffffff');
    kit.lid = { y: H + 4.3 };
  } else if (hood === 'reef') {
    // rimless: a hanging LED pendant on chrome wires, black silicone base trim
    const py = H + 22;
    g.slab(-W / 2 + 4, py, -D / 4, W / 2 - 4, py + 2.4, D / 4, 1.6, { top: '#1c2430', side: '#2a3442', bottom: '#151c26' });
    for (const sx of [-1, 1]) g.tube([[sx * (W / 2 - 10), py + 2.4, 0], [sx * (W / 2 - 10), 220, 0]], 0.15, 4, SILVER);
    g.box(-W / 2 - 0.9, -1.4, -D / 2 - 0.9, W / 2 + 0.9, 0, D / 2 + 0.9, '#1a222c');
    for (let i = 0; i < 6; i++) lg.box(-W / 2 + 6 + i * (W - 12) / 6, py - 0.15, -D / 4 + 1.5, -W / 2 + 6 + (i + 0.8) * (W - 12) / 6, py + 0.05, D / 4 - 1.5, '#ffffff');
    kit.lid = { y: py + 2.4, pendant: py };
  } else if (hood === 'wall') {
    // built into the partition wall: a glossy white bezel all around, LED strip hidden in the top bezel
    const b = 9;
    g.box(-W / 2 - b, -b, D / 2 + 0.7, W / 2 + b, 0, D / 2 + 3, WHITE);
    g.box(-W / 2 - b, H, D / 2 + 0.7, W / 2 + b, H + b, D / 2 + 3, WHITE);
    g.box(-W / 2 - b, 0, D / 2 + 0.7, -W / 2, H, D / 2 + 3, WHITE);
    g.box(W / 2, 0, D / 2 + 0.7, W / 2 + b, H, D / 2 + 3, WHITE);
    g.box(-W / 2 - b, -b + 1, D / 2 + 2.9, W / 2 + b, -b + 1.6, D / 2 + 3.2, AQUA);
    // service hood behind the bezel
    g.box(-W / 2 - 1, H, -D / 2 - 1, W / 2 + 1, H + 12, D / 2 + 0.7, '#e8eef4');
    g.box(-W / 2 - 1, -12, -D / 2 - 1, W / 2 + 1, -0.4, D / 2 + 0.7, '#e8eef4');
    lg.box(-W / 2 + 2, H - 0.1, -D / 3, W / 2 - 2, H + 0.1, D / 6, '#ffffff');
    kit.lid = { y: H + 12 };
  }
  if (lg.n) kit.glow.push({ mesh: lg.build(), col: rgb(kit.lightCol), a: 1, light: true });
}

// ------------------------------------------------------------------ equipment
function equipment(g, kit, T, gl, rnd) {
  const fl = gl('filter'), ht = gl('heater'), air = gl('air');
  const glow = new Geo();
  const k = T.minDim / 30; // equipment scale
  if (T.round) {
    // bowls: a little sponge filter, a mini heater clip, air stone(s)
    if (fl > 0) {
      const p = T.floorPoint(0.22, 0.75, 2);
      g.push(); g.at(p[0], p[1], p[2]);
      g.cyl(1.1, 1.1, 2.6, 10, '#2a3440', { jit: 0.08, seed: 3 });
      g.at(0, 2.6, 0); g.cyl(0.25, 0.25, T.top - p[1] - 1, 6, '#e8f4ff');
      g.pop();
      kit.filterOut = [p[0], T.waterY - 1, p[2]];
    }
    if (ht > 0) {
      const p = T.floorPoint(0.8, 0.7, 2);
      g.push(); g.at(p[0], p[1] + 1.5, p[2]); g.rotZ(0.15);
      g.cyl(0.55, 0.55, T.waterY - p[1] - 1, 8, '#d8f0f8');
      g.pop();
      glow.push(); glow.at(p[0], p[1] + 2, p[2]); glow.rotZ(0.15); glow.cyl(0.35, 0.35, 3.4, 6, '#ffffff'); glow.pop();
      kit.heater = [p[0], p[1] + 3, p[2]];
    }
    const sp = T.floorPoint(0.6, 0.62, 2);
    airStone(g, sp, 0.9, null);
    kit.stones.push([sp[0], sp[1] + 0.6, sp[2]]);
    for (let i = 1; i <= air; i++) {
      const q = T.floorPoint(0.3 + i * 0.15, 0.4, 2);
      airStone(g, q, 0.7, null);
      kit.stones.push([q[0], q[1] + 0.5, q[2]]);
    }
    if (glow.n) kit.glow.push({ mesh: glow.build(), col: rgb('#ff8a3a'), a: 1 });
    return;
  }
  const W = T.W, D = T.D, H = T.H;
  // hang-on-back filter (level 1), canister spraybar (2), turbo (3); level 0: a sponge filter in the corner
  if (fl === 0) {
    const p = T.floorPoint(0.06, 0.94, 2.5 * k);
    g.push(); g.at(p[0], p[1], p[2]);
    g.cyl(1.4 * k, 1.4 * k, 3.4 * k, 10, '#2a3440', { jit: 0.1, seed: 9 });
    g.at(0, 3.4 * k, 0); g.cyl(0.3 * k, 0.3 * k, T.waterY - p[1] - 2 * k, 6, '#e8f4ff');
    g.pop();
    kit.filterOut = [p[0], T.waterY - 1, p[2]];
  } else {
    const fx = W / 2 - 8 * k, fw = (fl >= 2 ? 9 : 7) * k, fh = (fl >= 3 ? 15 : 12) * k;
    g.push(); g.at(fx, H - fh * 0.55, -D / 2 - 0.8);
    g.slab(-fw / 2, 0, -5 * k, fw / 2, fh, 0, 0.8 * k, { top: fl >= 3 ? AQUA : '#f4f8fc', side: fl >= 3 ? '#2a9ad8' : '#e0e8f0', bottom: '#b0c0d0' });
    g.slab(-fw / 2 - 0.2, fh, -5.4 * k, fw / 2 + 0.2, fh + 1 * k, 0.4, 0.6, fl >= 2 ? '#1a2430' : '#d8e4ee');
    g.pop();
    // intake tube with strainer
    g.tube([[fx - fw * 0.3, H + 1, -D / 2 + 1.2 * k], [fx - fw * 0.3, T.floorY(fx, -D / 2) + 6 * k, -D / 2 + 1.2 * k]], 0.5 * k, 6, '#e8f6ff');
    g.push(); g.at(fx - fw * 0.3, T.floorY(fx, -D / 2) + 3 * k, -D / 2 + 1.2 * k); g.cyl(0.8 * k, 0.8 * k, 3 * k, 8, '#2a3440'); g.pop();
    if (fl >= 2) {
      // spraybar along the back
      g.tube([[fx + fw * 0.3, H + 1, -D / 2 + 1.2 * k], [fx + fw * 0.3, T.waterY - 3 * k, -D / 2 + 1.2 * k], [-W / 2 + 10 * k, T.waterY - 3 * k, -D / 2 + 1.2 * k]], 0.45 * k, 6, '#d8f0ff');
    }
    // the waterfall lip
    g.box(fx - fw * 0.35, T.waterY + 0.5, -D / 2 - 0.2, fx + fw * 0.35, T.waterY + 0.8, -D / 2 + 2.2 * k, '#e8f6ff');
    kit.filterOut = [fx, T.waterY - 0.5, -D / 2 + 2.5 * k];
  }
  // heater: glass tube with a glowing element, suction cups; the smart heater has a little display
  if (ht > 0) {
    const hx = -W / 2 + 4 * k, hz = -D / 2 + 2 * k, hl = Math.min(T.waterY * 0.62, 24 * k);
    const y0 = T.waterY - hl - 1.5 * k;
    g.push(); g.at(hx, y0, hz); g.rotZ(-0.08);
    g.cyl(0.9 * k, 0.9 * k, hl, 10, '#d8f0f8', { smooth: true });
    g.at(0, hl, 0); g.cyl(1.1 * k, 1.1 * k, 3 * k, 10, ht >= 2 ? '#1a2430' : '#2a3a4a');
    g.pop();
    for (const yy of [0.25, 0.75]) { g.push(); g.at(hx + 0.4 * k, y0 + hl * yy, hz - 1.0 * k); g.rotX(Math.PI / 2); g.cyl(0.7 * k, 0.2 * k, 0.6 * k, 8, '#f0f8ff'); g.pop(); }
    glow.push(); glow.at(hx, y0 + hl * 0.12, hz); glow.rotZ(-0.08); glow.cyl(0.5 * k, 0.5 * k, hl * 0.7, 6, '#ffffff'); glow.pop();
    if (ht >= 2) { glow.push(); glow.at(hx, y0 + hl + 1.4 * k, hz + 1.12 * k); glow.box(-0.6 * k, -0.4 * k, 0, 0.6 * k, 0.5 * k, 0.05, '#ffffff'); glow.pop(); }
    kit.heater = [hx, y0 + hl * 0.5, hz];
  }
  // air stones + airline; the bubble wall is a bar along the back
  const stones = [[0.78, 0.82], [0.32, 0.78], [0.55, 0.9], [0.15, 0.55]];
  for (let i = 0; i <= Math.min(air, 2); i++) {
    const p = T.floorPoint(stones[i][0], stones[i][1], 3 * k);
    airStone(g, p, 1.3 * k, H + 2, -D / 2 + 1);
    kit.stones.push([p[0], p[1] + 1 * k, p[2]]);
  }
  if (air >= 2) {
    const z = -D / 2 + 2.5 * k, y = T.floorY(0, z - 0.5) + 0.6 * k;
    g.push(); g.at(0, y, z); g.rotZ(Math.PI / 2); g.at(0, -W * 0.35, 0); g.cyl(0.6 * k, 0.6 * k, W * 0.7, 8, '#d8e8f0'); g.pop();
    for (let i = 0; i < 8; i++) kit.stones.push([-W * 0.35 + (i + 0.5) * W * 0.7 / 8, y + 0.6 * k, z]);
  }
  if (air >= 3) for (const u of [0.25, 0.5, 0.75]) { const p = T.floorPoint(u, 0.35, 3 * k); airStone(g, p, 1.6 * k, null); kit.stones.push([p[0], p[1] + 1.2 * k, p[2]], [p[0], p[1] + 1.2 * k, p[2]]); }
  if (glow.n) kit.glow.push({ mesh: glow.build(), col: rgb('#ff7a2a'), a: 1 });
  void rnd;
}

function airStone(g, p, r, lineTop, lineZ = null) {
  g.push(); g.at(p[0], p[1] - r * 0.15, p[2]);
  g.cyl(r, r * 0.92, r * 0.9, 10, '#5fd6e8', { capCol: '#8ae8f4' });
  g.pop();
  if (lineTop != null) {
    const z = lineZ ?? p[2];
    g.tube([[p[0], p[1] + r * 0.6, p[2]], [p[0] + r * 0.6, p[1] + r * 1.5, (p[2] + z) / 2], [p[0] + r, p[1] + r * 3, z], [p[0] + r, lineTop, z]], r * 0.16, 5, '#d8f4ff', { caps: false });
  }
}

// ------------------------------------------------------------------ caustics overlay + textures
function causticOverlay(T) {
  const g = new Geo();
  const tile = CAUSTIC_TILE * Math.max(0.5, T.minDim / 30);
  const cell = tile / 3;
  const ext = T.round ? T.floorR + 1 : null;
  const x0 = T.round ? -ext : -T.W / 2, x1 = T.round ? ext : T.W / 2;
  const z0 = T.round ? -ext : -T.D / 2, z1 = T.round ? ext : T.D / 2;
  const i0 = Math.floor(x0 / cell), i1 = Math.ceil(x1 / cell), j0 = Math.floor(z0 / cell), j1 = Math.ceil(z1 / cell);
  const fr = (v) => v - Math.floor(v);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    let ax = Math.max(x0, i * cell), bx = Math.min(x1, (i + 1) * cell), az = Math.max(z0, j * cell), bz = Math.min(z1, (j + 1) * cell);
    if (bx - ax < 0.05 || bz - az < 0.05) continue;
    if (T.round && Math.hypot((ax + bx) / 2, (az + bz) / 2) > T.floorR) continue;
    const ub = fr(i * cell / tile);
    const u = (x) => ub + (x - i * cell) / tile, vb = fr(j * cell / tile), v = (z) => vb + (z - j * cell) / tile;
    const P = (x, z) => [x, T.floorY(x, z) + 0.12, z];
    g.quad(P(ax, bz), P(bx, bz), P(bx, az), P(ax, az), '#ffffff', [[u(ax), v(bz)], [u(bx), v(bz)], [u(bx), v(az)], [u(ax), v(az)]]);
  }
  return g.build();
}

let CAUSTICS = null, CPTS = null;
const C_N = 20, C_SIZE = 96;
// Tileable caustic network: Voronoi cell borders of points circling in place (loops perfectly). Built lazily, one
// frame per call, so the first view does not hitch; returns the frames built so far.
export function causticFrames() {
  if (CAUSTICS && CAUSTICS.length >= C_N) return CAUSTICS;
  if (!CPTS) {
    const rnd = srand(4242);
    CPTS = [];
    for (let i = 0; i < 14; i++) CPTS.push({ x: rnd(), y: rnd(), r: 0.03 + rnd() * 0.04, ph: rnd() * 6.28, dir: rnd() > 0.5 ? 1 : -1 });
    CAUSTICS = [];
  }
  const pts = CPTS, n = C_N, size = C_SIZE;
  {
    const f = CAUSTICS.length;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const th = (f / n) * Math.PI * 2;
    const P = pts.map((p) => [p.x + Math.cos(th * p.dir + p.ph) * p.r, p.y + Math.sin(th * p.dir + p.ph) * p.r]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let d1 = 9, d2 = 9;
      for (const [px, py] of P) {
        let dx = Math.abs(u - px), dy = Math.abs(v - py);
        dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      const a = Math.max(0, 1 - e / 0.03);
      const k = (y * size + x) * 4;
      const al = Math.round(Math.pow(a, 1.6) * 255);
      img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255; img.data[k + 3] = al > 40 ? al : 0;
    }
    ctx.putImageData(img, 0, 0);
    CAUSTICS.push(cv);
  }
  return CAUSTICS;
}

let SHAFT = null;
export function shaftTexture() {
  if (SHAFT) return SHAFT;
  const w = 16, h = 64;
  SHAFT = document.createElement('canvas');
  SHAFT.width = w; SHAFT.height = h;
  const ctx = SHAFT.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / (h - 1), u = Math.abs(x / (w - 1) - 0.5) * 2;
    const a = Math.pow(1 - v, 1.3) * Math.pow(1 - u * u, 1.5);
    const k = (y * w + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
    img.data[k + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return SHAFT;
}

// light shafts as crossed quads (double sided), built once per kit
export function shaftMesh(kit) {
  const T = kit.shape;
  const g = new Geo();
  for (const s of kit.shafts) {
    const y1 = T.waterY, y0 = T.floorY(s.x, s.z);
    const h = y1 - y0, w = s.w;
    for (const a of [0.35, 0.35 + Math.PI / 2]) {
      const cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2;
      const dx = s.tilt * h;
      const A = [s.x - cx, y1, s.z - cz], B = [s.x + cx, y1, s.z + cz], C = [s.x + cx + dx, y0, s.z + cz], D = [s.x - cx + dx, y0, s.z - cz];
      g.quad(A, B, C, D, '#ffffff', [[0, 0], [1, 0], [1, 1], [0, 1]]);
      g.quad(B, A, D, C, '#ffffff', [[1, 0], [0, 0], [0, 1], [1, 1]]);
    }
  }
  return g.build();
}

// ------------------------------------------------------------------ the rippling surface
export function surfaceMesh(dyn, kit, rip, yOff = 0) {
  const T = kit.shape;
  const g = dyn.begin();
  const y = T.waterY + yOff;
  const top = rgb('#c8f6ff');
  if (T.round) {
    const R = T.rAt(y) - 0.05, rings = 5, seg = 22;
    const P = (i, j) => { const r = R * (i / rings), a = (j / seg) * Math.PI * 2; const x = Math.cos(a) * r, z = Math.sin(a) * r; return [x, y + rip.height(x, z, 0.6) * (i < rings ? 1 : 0.2), z]; };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
      g.tri(a, b, c, top); g.tri(a, c, d, top);
    }
  } else {
    const nx = Math.max(8, Math.round(T.W / 6)), nz = Math.max(4, Math.round(T.D / 6));
    const P = (i, j) => { const x = -T.W / 2 + (i / nx) * T.W, z = -T.D / 2 + (j / nz) * T.D; const edge = i === 0 || j === 0 || i === nx || j === nz; return [x, y + rip.height(x, z) * (edge ? 0.25 : 1), z]; };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      g.tri(a, d, c, top); g.tri(a, c, b, top);
    }
  }
  return dyn.end();
}

export { mixc };
