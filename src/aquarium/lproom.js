// The Frutiger Aero room around the 3D tank (phase 6), all low-poly: pale aqua walls with a white wainscot, a
// light plank floor with a round aqua rug, a huge white-framed window onto rolling green hills (round trees, white
// wind turbines with spinning rotors, a glass city in a water bubble, puffy clouds), a side window, shelves,
// potted plants (monstera, snake plant, trailing pothos), a desk lamp, and the tier's furniture: a glossy desk
// (jar, bowl, Aqua Lamp), an aquarium cabinet (big / reef tanks) or a partition wall the Wall Aquarium is built into.
// The sky behind the windows is a 2D gradient + sun flare drawn by the view (light only).
//
//   buildRoom(tier, kit) -> {opaque: LPMesh, glow: [{mesh, col}], glass: [{mesh, pos, a}], rotors: [{mesh, pos, yaw, speed}],
//                            clouds: [{mesh, pos, speed}], floorY, bounds: {x0, x1, z0, z1, y1}, yawLimit, sun: [x, y, z] dir}

import { Geo, rgb, mixc, shadec, srand } from './lpkit.js';

const WALL = '#e6f4fb', WAIN = '#cfe9f5', TRIM = '#ffffff', WOOD = ['#e8c89a', '#e2c090', '#eccfa4', '#dcb886'];
const CHROME = '#dfe8f0', AQUA = '#3ac4f8', GLOSS = '#f8fcff';
const GRASS = ['#5cc832', '#6ad43a', '#4ab82a', '#86e04a', '#3aa82a'];

export function buildRoom(tier, kit) {
  const T = kit.shape;
  const wall = T.d.stand === 'wall';
  const g = new Geo(), glow = new Geo(), out = new Geo();
  const rnd = srand(555 + tier);
  const fy = wall ? -96 : T.d.stand === 'cabinet' ? -80 : -76;
  const R = { x0: -380, x1: 380, z0: -330, z1: 340, y1: 205 };
  const room = { glow: [], glass: [], rotors: [], clouds: [], floorY: fy, bounds: R, yawLimit: wall ? 1.15 : null, sun: norm([0.42, 0.42, -1]) };
  g.jit = 0.05; g.seed = 3;

  // ---- floor planks + rug
  const pw = 22;
  for (let x = R.x0, i = 0; x < R.x1; x += pw, i++) {
    for (let z = R.z0, j = 0; z < R.z1; j++) {
      const len = 90 + ((i * 7 + j * 3) % 4) * 25;
      const z1 = Math.min(R.z1, z + len);
      g.quad([x, fy, z1], [x + pw, fy, z1], [x + pw, fy, z], [x, fy, z], WOOD[(i + j * 3) % 4]);
      z = z1;
    }
  }
  const rugR = Math.max(110, (T.round ? 60 : T.W * 0.9));
  const rugZ = wall ? T.D / 2 + rugR * 0.9 : 0;
  ringDisk(g, 0, fy + 0.3, rugZ, rugR, 0, 32, '#7fd8f0');
  ringDisk(g, 0, fy + 0.4, rugZ, rugR * 0.86, rugR * 0.8, 32, '#ffffff');
  ringDisk(g, 0, fy + 0.4, rugZ, rugR * 0.5, rugR * 0.44, 32, '#bff0ff');

  // ---- walls (with window openings)
  const wy0 = fy, wy1 = R.y1;
  const win = { x0: -230, x1: 230, y0: fy + 70, y1: 168 };
  // back wall around the window
  wallRect(g, [R.x0, wy0, R.z0], [R.x1, wy1, R.z0], 'z', 1, win, fy);
  // side windows on the left wall
  const sw = { z0: -200, z1: 60, y0: fy + 80, y1: 160 };
  wallRectX(g, R.x0, R.z0, R.z1, wy0, wy1, 1, sw, fy);
  wallRectX(g, R.x1, R.z0, R.z1, wy0, wy1, -1, null, fy);
  wallRect(g, [R.x0, wy0, R.z1], [R.x1, wy1, R.z1], 'z', -1, null, fy);
  // ceiling + a round glossy light
  g.quad([R.x0, R.y1, R.z0], [R.x1, R.y1, R.z0], [R.x1, R.y1, R.z1], [R.x0, R.y1, R.z1], '#f6fbff');
  glow.push(); glow.at(0, R.y1 - 1.5, 40); glow.cyl(46, 46, 1.2, 20, '#ffffff'); glow.pop();
  g.push(); g.at(0, R.y1 - 3, 40); g.cyl(50, 50, 3, 20, CHROME); g.pop();

  // ---- window frames (back + side) and sills
  frameZ(g, win, R.z0, 3);
  frameX(g, sw, R.x0, 3);
  room.glass.push(paneZ(win, R.z0 + 1), paneX(sw, R.x0 + 1));

  // ---- the view outside: rolling hills ring, trees, turbines, a bubble city, clouds
  outside(out, room, rnd, fy);

  // ---- furniture for the tier
  if (T.d.stand === 'wall') partition(g, T, fy, R);
  else if (T.d.stand === 'cabinet') cabinet(g, T, fy);
  else desk(g, glow, T, fy, rnd);

  // ---- room decoration: shelves, plants, a beanbag, a poster
  shelves(g, R, fy, rnd);
  bigPlant(g, [R.x1 - 70, fy, R.z0 + 70], 1.15, rnd);
  bigPlant(g, [R.x0 + 60, fy, R.z1 - 80], 0.9, rnd);
  snakePlant(g, [-250, fy, R.z0 + 45], rnd);
  snakePlant(g, [R.x1 - 60, fy, R.z1 - 60], rnd);
  beanbag(g, [-180, fy, 200]);
  poster(g, glow, R, fy);

  room.opaque = mergeBuild(g, out);
  room.glow.push({ mesh: glow.build(), col: [1, 1, 0.97] });
  return room;
}

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
function mergeBuild(a, b) { a.merge(b); return a.build(); }

function ringDisk(g, x, y, z, r1, r0, seg, col) {
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
    const P = (r, t) => [x + Math.cos(t) * r, y, z + Math.sin(t) * r];
    if (r0 <= 0) g.tri([x, y, z], P(r1, b), P(r1, a), col);
    else g.quad(P(r0, a), P(r0, b), P(r1, b), P(r1, a), col);
  }
}

// a wall in the x/y plane at z = a[2], facing `dir` (+1 = +z), with an optional window hole
function wallRect(g, a, b, _ax, dir, hole, fy) {
  const z = a[2];
  const quad = (x0, y0, x1, y1, col) => {
    if (x1 <= x0 || y1 <= y0) return;
    if (dir > 0) g.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], col);
    else g.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], col);
  };
  const split = (x0, y0, x1, y1) => {
    // wainscot below y = fy + 90, a white trim line, wall above
    const w0 = fy + 88;
    quad(x0, y0, x1, Math.min(y1, w0), WAIN);
    quad(x0, Math.max(y0, w0 + 4), x1, y1, WALL);
    if (y0 < w0 + 4 && y1 > w0) { quad(x0, Math.max(y0, w0), x1, Math.min(y1, w0 + 4), TRIM); }
  };
  if (!hole) { split(a[0], a[1], b[0], b[1]); baseboard(g, a[0], b[0], z, dir, fy); return; }
  split(a[0], a[1], hole.x0, b[1]);
  split(hole.x1, a[1], b[0], b[1]);
  split(hole.x0, a[1], hole.x1, hole.y0);
  split(hole.x0, hole.y1, hole.x1, b[1]);
  baseboard(g, a[0], b[0], z, dir, fy);
}
function wallRectX(g, x, z0, z1, y0, y1, dir, hole, fy) {
  const quad = (za, ya, zb, yb, col) => {
    if (zb <= za || yb <= ya) return;
    if (dir > 0) g.quad([x, ya, zb], [x, ya, za], [x, yb, za], [x, yb, zb], col);
    else g.quad([x, ya, za], [x, ya, zb], [x, yb, zb], [x, yb, za], col);
  };
  const split = (za, ya, zb, yb) => {
    const w0 = fy + 88;
    quad(za, ya, zb, Math.min(yb, w0), WAIN);
    quad(za, Math.max(ya, w0 + 4), zb, yb, WALL);
    if (ya < w0 + 4 && yb > w0) quad(za, Math.max(ya, w0), zb, Math.min(yb, w0 + 4), TRIM);
  };
  if (!hole) split(z0, y0, z1, y1);
  else { split(z0, y0, hole.z0, y1); split(hole.z1, y0, z1, y1); split(hole.z0, y0, hole.z1, hole.y0); split(hole.z0, hole.y1, hole.z1, y1); }
  g.box(dir > 0 ? x : x - 2, fy, z0, dir > 0 ? x + 2 : x, fy + 9, z1, TRIM);
}
function baseboard(g, x0, x1, z, dir, fy) { g.box(x0, fy, dir > 0 ? z : z - 2, x1, fy + 9, dir > 0 ? z + 2 : z, TRIM); }

function frameZ(g, w, z, d) {
  const t = 7;
  g.box(w.x0 - t, w.y0 - t, z - d, w.x1 + t, w.y0, z + d + 2, TRIM);
  g.box(w.x0 - t, w.y1, z - d, w.x1 + t, w.y1 + t, z + d + 2, TRIM);
  g.box(w.x0 - t, w.y0, z - d, w.x0, w.y1, z + d + 2, TRIM);
  g.box(w.x1, w.y0, z - d, w.x1 + t, w.y1, z + d + 2, TRIM);
  for (const u of [1 / 3, 2 / 3]) { const x = w.x0 + (w.x1 - w.x0) * u; g.box(x - 2.5, w.y0, z - 1.5, x + 2.5, w.y1, z + 1.5, TRIM); }
  g.box(w.x0, (w.y0 + w.y1) / 2 + 18, z - 1, w.x1, (w.y0 + w.y1) / 2 + 21, z + 1, TRIM);
  // sill
  g.box(w.x0 - t - 6, w.y0 - t - 2, z, w.x1 + t + 6, w.y0 - t + 1, z + 16, { top: GLOSS, side: '#e8f2f8' });
}
function frameX(g, w, x, d) {
  const t = 7;
  g.box(x - d, w.y0 - t, w.z0 - t, x + d + 2, w.y0, w.z1 + t, TRIM);
  g.box(x - d, w.y1, w.z0 - t, x + d + 2, w.y1 + t, w.z1 + t, TRIM);
  g.box(x - d, w.y0, w.z0 - t, x + d + 2, w.y1, w.z0, TRIM);
  g.box(x - d, w.y0, w.z1, x + d + 2, w.y1, w.z1 + t, TRIM);
  const zm = (w.z0 + w.z1) / 2;
  g.box(x - 1.5, w.y0, zm - 2.5, x + 1.5, w.y1, zm + 2.5, TRIM);
  g.box(x, w.y0 - t - 2, w.z0 - t - 6, x + 14, w.y0 - t + 1, w.z1 + t + 6, { top: GLOSS, side: '#e8f2f8' });
}
function paneZ(w, z) {
  const g = new Geo();
  const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
  g.quad([w.x0 - cx, w.y0 - cy, 0], [w.x1 - cx, w.y0 - cy, 0], [w.x1 - cx, w.y1 - cy, 0], [w.x0 - cx, w.y1 - cy, 0], '#e8fbff');
  // reflection streaks
  for (let i = 0; i < 3; i++) { const x = -150 + i * 140; g.quad([x, w.y0 - cy, 0.3], [x + 30, w.y0 - cy, 0.3], [x + 110, w.y1 - cy, 0.3], [x + 80, w.y1 - cy, 0.3], '#ffffff'); }
  return { mesh: g.build(), pos: [cx, cy, z], a: 0.07 };
}
function paneX(w, x) {
  const g = new Geo();
  const cz = (w.z0 + w.z1) / 2, cy = (w.y0 + w.y1) / 2;
  g.quad([0, w.y0 - cy, w.z1 - cz], [0, w.y0 - cy, w.z0 - cz], [0, w.y1 - cy, w.z0 - cz], [0, w.y1 - cy, w.z1 - cz], '#e8fbff');
  return { mesh: g.build(), pos: [x, cy, cz], a: 0.07 };
}

// ------------------------------------------------------------------ outside
function hillH(x, z, fy) {
  const r = Math.hypot(x, z);
  const k = Math.max(0, r - 420);
  return fy - 30 + k * 0.08 + Math.sin(x * 0.004 + 1.3) * k * 0.05 + Math.sin(z * 0.006 + x * 0.002) * k * 0.04 + Math.sin(x * 0.0017 - z * 0.0021) * k * 0.06;
}
function outside(g, room, rnd, fy) {
  // terrain: a polar grid around the house, coloured in bands of glossy grass
  const rings = [420, 520, 650, 820, 1050, 1350, 1750, 2300, 3000, 4000];
  const seg = 48;
  const P = (i, j) => { const r = rings[i], a = (j / seg) * Math.PI * 2; const x = Math.cos(a) * r, z = Math.sin(a) * r; return [x, hillH(x, z, fy), z]; };
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
    const col = GRASS[(i * 3 + j * 7 + (j % 3)) % GRASS.length];
    g.tri(a, b, c, col); g.tri(a, c, d, shadec(col, 0.04));
  }
  // round trees
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, r = 480 + rnd() * 1300;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = hillH(x, z, fy), s = 0.8 + rnd() * 0.9;
    g.push(); g.at(x, y, z); g.scale(s);
    g.cyl(4, 3, 30, 6, '#8a5a3a');
    g.at(0, 42, 0); g.sphere(24, 1, (i) => GRASS[i % 3], { jit: 0.2, seed: k });
    g.pop();
  }
  // wind turbines on the far hills
  for (let k = 0; k < 4; k++) {
    const a = -Math.PI / 2 + (k - 1.5) * 0.32 + rnd() * 0.1, r = 1500 + k * 260;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = hillH(x, z, fy);
    const h = 260 + rnd() * 60;
    g.push(); g.at(x, y, z); g.cyl(7, 4, h, 8, '#f8fcff'); g.at(0, h, 0); g.box(-8, -6, -16, 8, 6, 8, '#f0f6fa'); g.pop();
    const rg = new Geo();
    for (let b = 0; b < 3; b++) { rg.push(); rg.rotZ((b / 3) * Math.PI * 2); rg.blade([[0, 0, 0], [0, 50, 0], [0, 110, 0]], [10, 9, 2], '#ffffff', [1, 0, 0]); rg.pop(); }
    rg.sphere(6, 0, '#e8f0f8');
    room.rotors.push({ mesh: rg.build(), pos: [x, y + h, z + 10], yaw: Math.atan2(-x, -z) * 0, speed: 0.8 + rnd() * 0.5 });
  }
  // glass city inside a water bubble
  const ca = -Math.PI / 2 + 0.55, cr = 1250;
  const cx = Math.cos(ca) * cr, cz = Math.sin(ca) * cr, cyy = hillH(cx, cz, fy);
  for (let k = 0; k < 9; k++) {
    const h = 60 + rnd() * 170, w = 18 + rnd() * 16;
    const x = cx + (rnd() - 0.5) * 150, z = cz + (rnd() - 0.5) * 120;
    g.box(x - w / 2, cyy, z - w / 2, x + w / 2, cyy + h, z + w / 2, { top: '#e8fbff', side: k % 2 ? '#8adcff' : '#b8ecff' });
  }
  const dome = new Geo();
  dome.sphere(170, 2, '#c8f4ff', { smooth: true, cut: -0.15 });
  room.glass.push({ mesh: dome.build(), pos: [cx, cyy + 10, cz], a: 0.22 });
  // clouds
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, r = 1700 + rnd() * 1300;
    const cg = new Geo();
    for (let p = 0; p < 5; p++) { cg.push(); cg.at((p - 2) * 45 + rnd() * 20, Math.sin(p) * 12, rnd() * 30); cg.sphere(40 + rnd() * 30, 1, '#ffffff', { jit: 0.15, seed: p + k * 5 }); cg.pop(); }
    room.clouds.push({ mesh: cg.build(), pos: [Math.cos(a) * r, 520 + rnd() * 380, Math.sin(a) * r], speed: 4 + rnd() * 6 });
  }
}

// ------------------------------------------------------------------ furniture
function desk(g, glow, T, fy, rnd) {
  const w = Math.max(150, (T.W || 40) + 90), d = Math.max(76, (T.D || 30) + 46);
  g.slab(-w / 2, -4, -d / 2, w / 2, 0, d / 2, 3, { top: '#d2e6f4', side: '#c4dcec', bottom: '#b0c6d8' });
  g.box(-w / 2 + 2, -4.6, d / 2 - 3, w / 2 - 2, -4, d / 2 - 1, AQUA);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { g.push(); g.at(sx * (w / 2 - 8), fy, sz * (d / 2 - 8)); g.cyl(2.2, 2.2, -4 - fy, 8, CHROME); g.pop(); }
  for (const sx of [-1, 1]) { g.push(); g.at(sx * (w / 2 - 8), fy + 18, -d / 2 + 8); g.rotX(Math.PI / 2); g.cyl(1.4, 1.4, d - 16, 6, CHROME); g.pop(); }
  // desk lamp
  g.push(); g.at(-w / 2 + 22, 0, -d / 2 + 18);
  g.cyl(7, 7.5, 1.6, 12, CHROME);
  g.tube([[0, 1.6, 0], [3, 22, -3], [14, 34, 4]], 0.9, 6, CHROME);
  g.at(15, 33, 5); g.rotZ(-0.9); g.lathe([[2, 0], [5, -3], [8, -8]], 12, GLOSS, { inside: false });
  g.pop();
  glow.push(); glow.at(-w / 2 + 22 + 15, 33, -d / 2 + 18 + 5); glow.rotZ(-0.9); glow.at(0, -6, 0); glow.sphere(3, 1, '#ffffff'); glow.pop();
  // small succulent, a stack of books, a glossy speaker orb
  g.push(); g.at(w / 2 - 20, 0, -d / 2 + 16); g.cyl(5, 4, 8, 10, '#ffffff'); g.at(0, 8, 0);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; g.blade([[0, 0, 0], [Math.cos(a) * 4, 4, Math.sin(a) * 4], [Math.cos(a) * 7, 9, Math.sin(a) * 7]], [2.4, 3.2, 0], i % 2 ? '#5ac85a' : '#86e04a', [-Math.sin(a), 0, Math.cos(a)]); }
  g.pop();
  const bx = w / 2 - 34;
  [['#3ac4f8', 3.2], ['#8ae84a', 2.8], ['#ffffff', 3]].reduce((y, [c, h], i) => { g.box(bx - 10 + i, y, d / 2 - 22, bx + 10 - i, y + h, d / 2 - 8, { top: c, side: shadec(c, -0.12) }); return y + h; }, 0);
  g.push(); g.at(-w / 2 + 40, 6, d / 2 - 16); g.sphere(6, 1, '#6ad8ff', { smooth: true }); g.pop();
  void rnd;
}

function cabinet(g, T, fy) {
  const w = T.W + 6, d = T.D + 6;
  g.slab(-w / 2, fy, -d / 2, w / 2, -1.6, d / 2, 1.5, { top: GLOSS, side: '#eaf3fa', front: '#f4f9fd' });
  g.box(-w / 2, fy, -d / 2, w / 2, fy + 6, d / 2, { top: '#d8e6f0', side: '#c8dae8' });
  g.box(-w / 2 - 0.1, -10, d / 2, w / 2 + 0.1, -8.6, d / 2 + 0.2, AQUA);
  const doors = T.W > 90 ? 3 : 2;
  for (let i = 0; i < doors; i++) {
    const x0 = -w / 2 + 4 + i * (w - 8) / doors, x1 = x0 + (w - 8) / doors - 2;
    g.box(x0, fy + 9, d / 2, x1, -14, d / 2 + 0.6, '#f8fcff');
    g.push(); g.at(i % 2 ? x0 + 4 : x1 - 4, (fy - 14) / 2 + 6, d / 2 + 0.6); g.box(-0.6, -6, 0, 0.6, 6, 1.4, CHROME); g.pop();
  }
}

function partition(g, T, fy, R) {
  const W = T.W, H = T.H, b = 9;
  const zf = T.D / 2 + 3, zb = -T.D / 2 - 16;
  const box = (x0, y0, x1, y1) => g.box(x0, y0, zb, x1, y1, zf, { top: WALL, side: WALL, front: WALL });
  box(R.x0, fy, -W / 2 - b, R.y1);
  box(W / 2 + b, fy, R.x1, R.y1);
  box(-W / 2 - b, fy, W / 2 + b, -b);
  box(-W / 2 - b, H + b, W / 2 + b, R.y1);
  // wainscot + trims on the front face
  g.box(R.x0, fy, zf, R.x1, fy + 9, zf + 2, TRIM);
  g.box(R.x0, fy + 88, zf, -W / 2 - b, fy + 92, zf + 1, TRIM);
  g.box(W / 2 + b, fy + 88, zf, R.x1, fy + 92, zf + 1, TRIM);
  // a low glossy bench in front
  g.slab(-W * 0.35, fy + 36, zf + 30, W * 0.35, fy + 42, zf + 62, 3, { top: GLOSS, side: '#e2eef6' });
  for (const s of [-1, 1]) { g.push(); g.at(s * W * 0.3, fy, zf + 46); g.cyl(2, 2, 36, 8, CHROME); g.pop(); }
}

function shelves(g, R, fy, rnd) {
  const x = R.x1 - 2;
  for (let k = 0; k < 3; k++) {
    const y = fy + 110 + k * 32;
    g.box(x - 26, y, -120, x, y + 3, 40, { top: GLOSS, side: '#e2eef6' });
    for (let i = 0; i < 5; i++) {
      const z = -110 + i * 30 + rnd() * 6, h = 14 + rnd() * 10;
      if ((i + k) % 3 === 0) { g.push(); g.at(x - 13, y + 3, z); g.cyl(5, 4, 8, 8, '#ffffff'); g.at(0, 8, 0); g.sphere(7, 1, (j) => GRASS[j % 4], { jit: 0.3, seed: i + k * 9 }); g.pop(); }
      else if ((i + k) % 3 === 1) { const c = ['#3ac4f8', '#8ae84a', '#ffd23a', '#ff8ab4'][(i + k) % 4]; g.box(x - 22, y + 3, z - 3, x - 4, y + 3 + h, z + 3, { top: c, side: shadec(c, -0.1) }); g.box(x - 22, y + 3, z + 3.5, x - 4, y + 3 + h * 0.8, z + 8, { top: '#ffffff', side: '#e8eef4' }); }
      else { g.push(); g.at(x - 13, y + 9, z); g.sphere(6, 1, '#7ae0ff', { smooth: true }); g.pop(); }
    }
  }
  // trailing pothos from the top shelf
  for (let i = 0; i < 4; i++) {
    const z = -100 + i * 40, pts = [];
    for (let k = 0; k < 7; k++) pts.push([x - 20 - k * 0.6, fy + 177 - k * 13, z + Math.sin(k + i) * 6]);
    g.tube(pts, 0.6, 4, '#3a8a3a', { caps: false });
    for (let k = 1; k < 7; k++) { const p = pts[k]; g.push(); g.at(p[0], p[1], p[2]); g.rotY(k * 2.1); g.blade([[0, 0, 0], [-3, -2, 2], [-6, -1, 3]], [0.5, 4, 0], k % 2 ? '#5ac85a' : '#86e04a', [0, 1, 0]); g.pop(); }
  }
}

function bigPlant(g, p, s, rnd) {
  g.push(); g.at(p[0], p[1], p[2]); g.scale(s);
  g.lathe([[16, 0], [20, 28], [21, 32], [19, 32]], 14, '#ffffff', { capTop: '#6a4a2a' });
  g.cyl(21, 21, 2, 14, AQUA, { caps: false });
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.3, len = 50 + rnd() * 40, up = 0.7 + rnd() * 0.5;
    const sx = Math.cos(a), sz = Math.sin(a);
    const stem = [[0, 30, 0], [sx * len * 0.3, 30 + len * up * 0.8, sz * len * 0.3], [sx * len * 0.6, 30 + len * up, sz * len * 0.6]];
    g.tube(stem, 0.9, 4, '#3a8a3a', { caps: false });
    const e = stem[2];
    g.push(); g.at(e[0], e[1], e[2]); g.rotY(-a); g.rotZ(-0.6 - rnd() * 0.5);
    // monstera leaf: a wide heart blade with notches
    const L = 24 + rnd() * 10, W = L * 0.8;
    const pts = [[0, 0, 0], [L * 0.25, 0, 0], [L * 0.55, 0, 0], [L * 0.8, 0, 0], [L, 0, 0]];
    g.blade(pts, [W * 0.4, W * 0.9, W, W * 0.7, 0], (k) => (k % 2 ? '#3cb84a' : '#2ea040'), [0, 0, 1]);
    g.pop();
  }
  g.pop();
}

function snakePlant(g, p, rnd) {
  g.push(); g.at(p[0], p[1], p[2]);
  g.cyl(13, 11, 26, 10, '#f4f8ff');
  g.cyl(13.2, 13.2, 3, 10, '#8ae84a', { caps: false });
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 7, h = 60 + rnd() * 50;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, lean = (rnd() - 0.5) * 12;
    g.blade([[x, 24, z], [x + lean * 0.3, 24 + h * 0.5, z], [x + lean, 24 + h, z + lean * 0.3]], [6, 7, 0], (k) => (k % 2 ? '#3a9a4a' : '#5ab85a'), [Math.cos(a + 1.57), 0, Math.sin(a + 1.57)]);
  }
  g.pop();
}

function beanbag(g, p) {
  g.push(); g.at(p[0], p[1] + 18, p[2]); g.scale(1.3, 0.62, 1.2);
  g.sphere(32, 2, (i) => (i % 5 ? '#8ae84a' : '#a8f06a'), { jit: 0.08, smooth: false });
  g.pop();
}

function poster(g, glow, R, fy) {
  // an eco-tech poster on the front wall: a framed glossy globe + leaf (low-poly relief)
  const z = R.z1 - 1, cx = 140, cy = fy + 150;
  g.box(cx - 46, cy - 34, z - 2, cx + 46, cy + 34, z, '#ffffff');
  g.quadG([cx + 42, cy - 30, z - 2.1], [cx - 42, cy - 30, z - 2.1], [cx - 42, cy + 30, z - 2.1], [cx + 42, cy + 30, z - 2.1], '#8ae84a', '#8ae84a', '#3ac4f8', '#3ac4f8');
  g.push(); g.at(cx, cy + 4, z - 9); g.sphere(18, 2, (i, a) => (a[1] > 0.1 && Math.sin(a[0] * 5) > -0.2 ? '#5cc832' : '#3ac4f8'), { smooth: true }); g.pop();
  void glow;
}

export { mixc, rgb };
