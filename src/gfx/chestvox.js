// [chest16] Big, detailed, BREAKABLE voxel chests for the crack-it-open scene (src/ui/chest.js).
// Every voxel carries a piece id, so the chest can be rendered as layers (body, lid, side panels) that wobble,
// swing open and fly apart, and damage is carved into the model itself (splintered planks, popped nails and
// bolts, glowing chiselled seams, cracks running over the orb) and re-rendered.
//
//   chestModel(tier) -> CM   tier: crate | iron | golden | orb
//     CM = {tier, m (VoxelModel), pid (Uint8Array piece ids), ver, anchor [x, y, z] (footprint centre),
//           hits: [[x, y, z]...] (where blows land, in order), pry [x, y, z], seam {...}, hinge [y, z], lidY,
//           weak: [{p, n}] (orb weak points on the sphere), centre (orb), R (orb radius)}
//     piece ids: 1 body, 2 lid, 3 front panel, 4 left panel, 5 right panel, 6 cradle (orb), 7 orb
//   damageChest(cm, i, power) -> {removed: [{x, y, z, col}], popped: [{x, y, z, col, kind}], at: [x, y, z]}
//   class ChestSprite(cm, scale): draw(ctx, X, Y, {lidAngle, lidDx, lidDy, hide: Set(piece ids), orbYaw, t})
//     (X, Y) = screen position of the footprint centre; toScreen(X, Y, [x, y, z]) -> [sx, sy]; facing(n, orbYaw)
//     piece(id) -> {canvas, ax, ay} (layers for the burst); every canvas carries a lazily built `.hi` twin.
import { VoxelModel, renderVoxels } from './voxel.js';
import { withHi, fitHi, HI } from './hires.js';
import { hash3 } from '../core/math.js';

export const CHEST_YAW = -30, CHEST_PITCH = 24;
const RENDER = { ao: 1.0, edges: 0.75, sideEdges: 0.55, jitter: 0.06, depthThreshold: 2.4, glowRadius: 2 };
const WOOD = { smooth: 0.25, jitter: 0.07, spec: 0.15 };
const METAL = { spec: 1.2, specPow: 6, smooth: 0.5, jitter: 0.03 };
const GLOSS = { spec: 1.4, specPow: 10, smooth: 0.8, jitter: 0.02 };
const h3 = (x, y, z, s = 0) => hash3(x, y, z, s);

function builder(nx, ny, nz) {
  const m = new VoxelModel(nx, ny, nz);
  const pid = new Uint8Array(nx * ny * nz);
  const memo = new Map();
  const col = (hex, o = {}) => { const k = hex + JSON.stringify(o); let c = memo.get(k); if (c === undefined) { c = m.color(hex, o); memo.set(k, c); } return c; };
  const idx = (x, y, z) => x + nx * (y + ny * z);
  const put = (x, y, z, c, p = 1) => {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    m.data[idx(x, y, z)] = c; pid[idx(x, y, z)] = c ? p : 0;
  };
  const get = (x, y, z) => m.get(x, y, z);
  return { m, pid, col, put, get, idx };
}


// a heap of treasure inside a chest: gold coins with glints, a few gems and pearls, on a velvet lining
function treasure(B, x0, x1, z0, z1, y0, yTop, velvet) {
  const { col, put } = B;
  const coin = [col('#ffd23a', { ...METAL, emissive: 0.3 }), col('#f0b83c', { ...METAL, emissive: 0.25 }), col('#ffe98a', { ...METAL, emissive: 0.35 }), col('#d8961e', { ...METAL, emissive: 0.15 })];
  const glint = col('#ffffff', { emissive: 1, jitter: 0 });
  const gems = [col('#ff3a6a', { ...GLOSS, emissive: 0.6 }), col('#3ad8ff', { ...GLOSS, emissive: 0.6 }), col('#4ae87a', { ...GLOSS, emissive: 0.5 }), col('#f6f2ff', { ...GLOSS, emissive: 0.4 })];
  const vel = col(velvet, { smooth: 0.6, jitter: 0.04 });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rx = (x1 - x0) / 2 + 1, rz = (z1 - z0) / 2 + 1;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;
    const h = Math.floor(y0 + (yTop - y0) * Math.max(0, 1 - d * 0.85) + (h3(x, z, 1, 61) - 0.5) * 2.2);
    for (let y = y0 - 3; y <= h; y++) put(x, y, z, y <= y0 - 2 ? vel : coin[Math.floor(h3(x, y, z, 62) * 4)], 1);
    const r = h3(x, z, 2, 63);
    if (r < 0.05) put(x, h, z, glint, 1);
    else if (r > 0.975) { const gm = gems[Math.floor(h3(x, z, 3, 64) * 4)]; put(x, h + 1, z, gm, 1); put(x, h, z, gm, 1); }
  }
  // velvet lining on the inner walls above the heap
  for (let y = y0 - 2; y <= yTop + 1; y++) for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    if (x !== x0 - 1 && x !== x1 + 1 && z !== z0 - 1 && z !== z1 + 1) continue;
    put(x, y, z, vel, 1);
  }
}

// ================================================================ crate: a driftwood shipping crate
function crate() {
  const B = builder(42, 38, 34), { m, pid, col, put, get } = B;
  const wd = [col('#c8925a', WOOD), col('#b98450', WOOD), col('#d6a066', WOOD), col('#c08a52', WOOD)];
  const gap = col('#4a2c16', { jitter: 0.03 }), post = col('#a06a3a', WOOD), postD = col('#83522a', WOOD), postL = col('#bf8a52', WOOD);
  const batt = col('#b07a44', WOOD), battL = col('#cf9a62', WOOD), nail = col('#e6eef6', METAL), nailD = col('#8a96a8', METAL);
  const sten = col('#5a3820', { jitter: 0.02 }), label = col('#f6ead0', { jitter: 0.02 }), labelR = col('#ff5a4a', { jitter: 0 }), labelL = col('#8aa0b8', { jitter: 0 });
  const algae = col('#6aa84a', { jitter: 0.08 }), algaeL = col('#9ad86a', { jitter: 0.06 }), barn = col('#eef0e6', { spec: 0.6 });
  const straw = [col('#f2cf6a', { jitter: 0.1 }), col('#e0b450', { jitter: 0.1 }), col('#fff0a0', { jitter: 0.08 })];
  const glow = col('#ffd070', { emissive: 0.85, jitter: 0 }), glowL = col('#fff4c8', { emissive: 1, jitter: 0 });
  const X0 = 2, X1 = 39, Z0 = 2, Z1 = 31, YT = 30;
  const pieceOf = (x, y, z) => (y >= 31 ? 2 : x <= 4 ? 4 : x >= 37 ? 5 : z >= 30 ? 3 : 1);
  const plank = (u, y, s) => { const row = Math.floor(y / 6); return wd[(Math.floor(h3(row, Math.floor(u / 9), s, 4) * 4)) % 4]; };
  // interior: glowing treasure under straw
  for (let y = 2; y <= 29; y++) for (let z = Z0 + 2; z <= Z1 - 2; z++) for (let x = X0 + 2; x <= X1 - 2; x++) {
    const dx = (x - 21) / 13, dy = (y - 13) / 9, dz = (z - 16.5) / 11;
    const top = 24 + Math.floor(h3(x >> 1, 0, z >> 1, 8) * 4) - (Math.abs(x - 21) > 14 ? 1 : 0);
    if (dx * dx + dy * dy + dz * dz < 1) put(x, y, z, dx * dx + dy * dy + dz * dz < 0.35 ? glowL : glow, 1);
    else if (y >= 17 && y <= top) put(x, y, z, straw[Math.floor(h3(x, y, z, 7) * 3)], 1);
    else if (y === top + 1 && h3(x, z, 5, 9) < 0.06) put(x, y, z, straw[2], 1);
  }
  // walls: two layers, horizontal planks with recessed gaps
  for (let y = 0; y <= YT; y++) for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
    const outerX = x === X0 || x === X1, outerZ = z === Z0 || z === Z1, innerX = x === X0 + 1 || x === X1 - 1, innerZ = z === Z0 + 1 || z === Z1 - 1;
    const floor = y <= 1;
    if (!(outerX || outerZ || innerX || innerZ || floor)) continue;
    const isGap = y % 6 === 5;
    const outer = outerX || outerZ;
    if (isGap && outer && !floor) continue;
    const u = outerX || innerX ? z : x;
    put(x, y, z, isGap ? gap : plank(u, y, outerX || innerX ? (x < 20 ? 1 : 2) : (z < 16 ? 3 : 4)), pieceOf(x, y, z));
  }
  // corner posts (protrude one voxel) with rounded, lighter outer edges
  for (const [px, pz] of [[1, 1], [37, 1], [1, 29], [37, 29]]) for (let y = 0; y <= YT; y++) for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
    const x = px + dx, z = pz + dz;
    const edge = (dx === 0 || dx === 3) && (dz === 0 || dz === 3);
    if (edge && (y === 0 || y === YT)) continue;
    put(x, y, z, edge ? postL : (dx + dz + y) % 7 === 0 ? postD : post, pieceOf(x, y, z));
  }
  // battens round the bottom and top, protruding one voxel
  for (const [y0, y1] of [[0, 2], [27, 30]]) for (let y = y0; y <= y1; y++) {
    for (let x = 5; x <= 36; x++) { put(x, y, Z1 + 1, y === y1 ? battL : batt, 3); put(x, y, Z0 - 1, batt, 1); }
    for (let z = 5; z <= 28; z++) { put(X0 - 1, y, z, y === y1 ? battL : batt, 4); put(X1 + 1, y, z, batt, 5); }
  }
  // diagonal braces (front + left)
  for (let y = 3; y <= 26; y++) for (let x = 5; x <= 36; x++) { const d = Math.abs((y - 3) - ((x - 5) * 23) / 31); if (d < 2.1) put(x, y, Z1 + 1, d < 0.8 ? battL : batt, 3); }
  for (let y = 3; y <= 26; y++) for (let z = 5; z <= 28; z++) { const d = Math.abs((y - 3) - ((28 - z) * 23) / 23); if (d < 2.1) put(X0 - 1, y, z, d < 0.8 ? battL : batt, 4); }
  // nails
  const nails = [];
  const nailAt = (x, y, z, p) => { put(x, y, z, nail, p); nails.push([x, y, z]); };
  for (const x of [6, 13, 21, 28, 35]) { nailAt(x, 1, Z1 + 1, 3); nailAt(x, 29, Z1 + 1, 3); }
  for (const z of [6, 12, 18, 24]) { nailAt(X0 - 1, 1, z, 4); nailAt(X0 - 1, 29, z, 4); }
  nailAt(6, 4, Z1 + 1, 3); nailAt(35, 25, Z1 + 1, 3); nailAt(X0 - 1, 4, 27, 4); nailAt(X0 - 1, 25, 6, 4);
  // lid: planks along x with gaps, two battens on top
  for (let y = 31; y <= 33; y++) for (let z = 1; z <= 32; z++) for (let x = 1; x <= 40; x++) {
    const g2 = z % 7 === 6;
    if (g2 && y === 33) continue;
    put(x, y, z, g2 ? gap : (x === 1 || x === 40 || z === 1 || z === 32) && y === 33 ? battL : plank(x, z * 6, 9), 2);
  }
  for (const bx of [4, 35]) for (let z = 1; z <= 32; z++) for (let x = bx; x <= bx + 2; x++) put(x, 34, z, x === bx + 1 ? battL : batt, 2);
  for (const bx of [5, 36]) for (const z of [3, 16, 30]) { put(bx, 35, z, nail, 2); nails.push([bx, 35, z]); }
  // a stencilled fish on the front, a shipping label, algae and barnacles from the sea
  const fishRows = ['  ##   ##', ' ####  # ', '#.#### # ', '########  ', ' ####  # ', '  ##   ##'];
  fishRows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') put(8 + i, 24 - j, Z1, sten, 3); });
  for (let y = 5; y <= 11; y++) for (let x = 25; x <= 34; x++) {
    if ((x === 25 || x === 34) && (y === 5 || y === 11)) continue;
    put(x, y, Z1 + 1, y === 10 ? labelR : (y === 7 || y === 8) && x > 26 && x < 33 && x % 2 ? labelL : label, 3);
  }
  for (let z = 0; z < 34; z++) for (let x = 0; x < 42; x++) for (let y = 0; y <= 4; y++) {
    if (!get(x, y, z) || get(x, y, z) === nail) continue;
    const r = h3(x, y, z, 11);
    if (r < 0.16 - y * 0.03) put(x, y, z, r < 0.06 ? algaeL : algae, pid[B.idx(x, y, z)]);
  }
  for (const [x, y, z] of [[0, 1, 9], [0, 2, 21], [12, 0, 33], [30, 2, 33], [0, 0, 15], [20, 1, 33]]) put(x, y, z, barn, x === 0 ? 4 : 3);
  return {
    tier: 'crate', ...B, lidY: 31, hinge: [31, 1], anchor: [21, 0, 17], nails,
    hits: [[1, 20, 20], [1, 14, 11], [1, 20, 8], [1, 26, 16], [1, 14, 24], [1, 8, 18], [1, 32, 13], [1, 26, 26]],
    splinter: col('#f4cf94', WOOD), splinterD: col('#d8a868', WOOD), crack: gap,
  };
}

// ================================================================ iron: a riveted steel strongbox with a padlock
function iron() {
  const B = builder(44, 36, 34), { pid, col, put, get } = B;
  const st = col('#6f7f9a', METAL), stD = col('#56647e', METAL), stL = col('#93a4bf', METAL), panel = col('#5f6e88', METAL), lidT = col('#5a6984', METAL);
  const br = col('#d08a3a', METAL), brL = col('#f2b866', METAL), brD = col('#9a5a22', METAL), rivet = col('#ffe2a8', { ...METAL, spec: 1.6 });
  const rust = col('#b0603a', { jitter: 0.12 }), rustD = col('#8a4226', { jitter: 0.1 });
  const lockB = col('#ffc23a', { ...METAL, spec: 1.6 }), lockD = col('#c8862a', METAL), hole = col('#1a1424', { jitter: 0 }), shackle = col('#dfe8f2', { ...METAL, spec: 1.8 });
  const glow = col('#bfe8ff', { emissive: 0.9, jitter: 0 }), glowL = col('#ffffff', { emissive: 1, jitter: 0 });
  const X0 = 2, X1 = 41, Z0 = 2, Z1 = 31, YB = 22, YT = 30;
  // interior glow (seen through the gap as the lid lifts)
  treasure(B, X0 + 3, X1 - 3, Z0 + 3, Z1 - 3, 12, YB + 1, '#3a4aa8');
  void glow; void glowL;
  const bodyCol = (x, y, z, face) => {
    const u = face === 'x' ? z : x;
    const band = u <= 4 || u >= (face === 'x' ? 29 : 39) || (face !== 'x' && (u === 13 || u === 14 || u === 29 || u === 30)) || (face === 'x' && (u === 16 || u === 17)) || y <= 2 || y >= YB - 1;
    if (band) return (y === 2 || y === YB - 1) ? brL : (u + y) % 9 === 0 ? brD : br;
    const r = h3(x, y, z, 5);
    if (y < 9 && r < 0.12 + (9 - y) * 0.02) return r < 0.06 ? rustD : rust;
    return (y === 3 || u === 5 || u === (face === 'x' ? 15 : 12) || u === (face === 'x' ? 18 : 15)) ? stL : r < 0.1 ? stD : panel;
  };
  for (let y = 0; y <= YB; y++) for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
    const ox = x === X0 || x === X1, oz = z === Z0 || z === Z1, ix = x === X0 + 1 || x === X1 - 1, iz = z === Z0 + 1 || z === Z1 - 1;
    if (!(ox || oz || ix || iz || y <= 1)) continue;
    put(x, y, z, ox ? bodyCol(x, y, z, 'x') : oz ? bodyCol(x, y, z, 'z') : stD, 1);
  }
  // rivets on the bands
  const rivets = [];
  for (let x = 4; x <= 39; x += 5) for (const y of [1, YB - 1]) { put(x, y, Z1 + 1, rivet, 1); }
  for (let z = 4; z <= 29; z += 5) put(X0 - 1, 1, z, rivet, 1);
  // lid: a bevelled steel slab with brass edging
  for (let y = YB + 1; y <= YT; y++) {
    const ins = y >= YT - 1 ? (y - (YT - 2)) : 0;
    for (let z = Z0 - 1 + ins; z <= Z1 + 1 - ins; z++) for (let x = X0 - 1 + ins; x <= X1 + 1 - ins; x++) {
      const edge = x === X0 - 1 + ins || x === X1 + 1 - ins || z === Z0 - 1 + ins || z === Z1 + 1 - ins;
      const strap = (x >= 12 && x <= 14) || (x >= 29 && x <= 31);
      put(x, y, z, y === YB + 1 ? brD : edge ? (y === YT ? brL : br) : strap ? (y === YT ? brL : br) : y === YT ? ((z >> 1) % 3 === 0 ? st : lidT) : (y + x) % 7 === 0 ? stD : st, 2);
    }
  }
  for (let x = 13; x <= 30; x += 17) for (let z = 4; z <= 29; z += 5) put(x, YT + 1, z, rivet, 2);
  // seam bolts on the left side and front (the crowbar pops these)
  const bolts = [];
  for (const z of [27, 20, 13, 6]) { for (const [dy, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(X0 - 2, YB + dy, z + dz, dy === 1 && dz === 0 ? rivet : brL, 1); bolts.push([X0 - 2, YB, z]); }
  // hasp + padlock hanging on the front
  for (let y = YB - 3; y <= YB + 6; y++) for (let x = 19; x <= 24; x++) put(x, y, Z1 + 2, y === YB + 6 || x === 19 || x === 24 ? brL : br, y > YB ? 2 : 1);
  for (let y = YB - 6; y <= YB - 3; y++) for (const x of [20, 23]) put(x, y, Z1 + 3, shackle, 1);
  put(21, YB - 3, Z1 + 3, shackle, 1); put(22, YB - 3, Z1 + 3, shackle, 1);
  for (let y = YB - 14; y <= YB - 7; y++) for (let x = 18; x <= 25; x++) for (let z = Z1 + 2; z <= Z1 + 4; z++) {
    if ((x === 18 || x === 25) && (y === YB - 14 || y === YB - 7)) continue;
    put(x, y, z, z === Z1 + 4 && (x === 18 || y === YB - 7) ? lockB : z === Z1 + 4 ? (y === YB - 14 ? lockD : lockB) : lockD, 1);
  }
  for (const [x, y] of [[21, YB - 9], [22, YB - 9], [21, YB - 10], [22, YB - 10], [21, YB - 11], [22, YB - 11], [21, YB - 12], [22, YB - 12], [20, YB - 10], [23, YB - 10]]) put(x, y, Z1 + 4, hole, 1);
  // side handle (left)
  for (let z = 12; z <= 21; z++) put(X0 - 1, 12, z, z === 12 || z === 21 ? brD : shackle, 1);
  for (let y = 9; y <= 12; y++) { put(X0 - 1, y, 12, brD, 1); put(X0 - 1, y, 21, brD, 1); }
  for (let z = 12; z <= 21; z++) put(X0 - 2, 9, z, shackle, 1);
  void get; void rivets; void pid;
  return { tier: 'iron', ...B, lidY: YB + 1, hinge: [YB + 1, Z0 - 1], anchor: [21.5, 0, 17], bolts, pry: [X0 - 2, YB + 1, 17], hits: bolts };
}

// ================================================================ golden: an ornate domed treasure chest
function golden() {
  const B = builder(46, 42, 34), { col, put, get, pid } = B;
  const wd = [col('#8a3a2a', WOOD), col('#76301f', WOOD), col('#9a4632', WOOD)], wdD = col('#4e1c14', WOOD);
  const g = col('#f0b83c', { ...METAL, spec: 1.6, specPow: 5 }), gL = col('#fff2b8', { ...METAL, spec: 1.8 }), gD = col('#c08024', METAL), gDD = col('#8a5414', METAL);
  const ruby = col('#ff3a6a', { ...GLOSS, emissive: 0.55 }), sap = col('#3ad8ff', { ...GLOSS, emissive: 0.6 }), emer = col('#4ae87a', { ...GLOSS, emissive: 0.5 });
  const hole = col('#2a0a10', { jitter: 0 }), seamC = col('#fff6d0', { emissive: 1, jitter: 0 });
  const glow = col('#ffe7a0', { emissive: 0.9, jitter: 0 });
  const X0 = 2, X1 = 43, Z0 = 2, Z1 = 31, YB = 21;
  treasure(B, X0 + 3, X1 - 3, Z0 + 3, Z1 - 3, 11, YB + 3, '#a8243a');
  void glow;
  const trim = (u, y, uMax) => u <= 3 || u >= uMax - 3 || y <= 2 || y >= YB - 1;
  for (let y = 0; y <= YB; y++) for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
    const ox = x === X0 || x === X1, oz = z === Z0 || z === Z1, ix = x === X0 + 1 || x === X1 - 1, iz = z === Z0 + 1 || z === Z1 - 1;
    if (!(ox || oz || ix || iz || y <= 1)) continue;
    const u = ox || ix ? z - Z0 : x - X0, uMax = ox || ix ? Z1 - Z0 : X1 - X0;
    let c;
    if (trim(u, y, uMax)) c = (y === YB - 1 || y === 2) ? gL : (u + y) % 6 === 0 ? gD : g;
    else if (!(ox || oz) ) c = wdD;
    else c = u % 4 === 0 ? wdD : wd[Math.floor(h3(Math.floor(u / 4), 0, x + z, 3) * 3)];
    // vertical gold straps on the front
    if (oz && z === Z1 && ((x >= 11 && x <= 13) || (x >= 32 && x <= 34))) c = y % 5 === 0 ? gL : g;
    put(x, y, z, c, 1);
  }
  // ornate corner guards with rubies
  for (const [x, z] of [[X0 - 1, Z1 + 1], [X1 + 1, Z1 + 1], [X0 - 1, Z0 - 1], [X1 + 1, Z0 - 1]]) for (let y = 0; y <= YB; y++) {
    put(x, y, z, y % 4 === 0 ? gL : gD, 1);
    if (y <= 6 || y >= YB - 6) { put(x + (x < 20 ? 1 : -1), y, z, g, 1); put(x, y, z + (z < 16 ? 1 : -1), g, 1); }
  }
  put(X0 - 1, 10, Z1 - 3, ruby, 1); put(X0 - 1, 11, Z1 - 3, ruby, 1); put(X0 + 3, 10, Z1 + 1, ruby, 1); put(X0 + 3, 11, Z1 + 1, ruby, 1);
  put(X1 - 3, 10, Z1 + 1, ruby, 1); put(X1 - 3, 11, Z1 + 1, ruby, 1);
  // domed lid along x
  const cy = YB + 1, cz = (Z0 + Z1 + 1) / 2, R = (Z1 - Z0 + 1) / 2 + 1;
  for (let x = X0 - 1; x <= X1 + 1; x++) for (let y = cy; y <= cy + R + 1; y++) for (let z = Z0 - 1; z <= Z1 + 1; z++) {
    const dy = y + 0.5 - cy, dz = z + 0.5 - cz, d = Math.hypot(dy, dz);
    if (d > R) continue;
    if (d < R - 2.2 && x > X0 && x < X1) continue;
    const a = Math.atan2(dy, dz);
    const endCap = x <= X0 || x >= X1;
    const strap = (x >= 11 && x <= 13) || (x >= 32 && x <= 34);
    let c;
    if (y === cy) c = gL;
    else if (endCap) c = d > R - 1.2 ? gL : g;
    else if (strap) c = d > R - 1 ? (Math.floor(a * 6) % 2 ? gL : g) : gD;
    else c = (a * 3.6) % 1 < 0.1 ? wdD : wd[Math.floor(a * 3.6) % 3];
    put(x, y, z, c, 2);
  }
  // crest on the dome: a gold sunburst with a sapphire
  const crY = cy + Math.round(R * 0.62), crZ = Math.round(cz + R * 0.78);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.abs(dx) + Math.abs(dy);
    if (d <= 3) put(22 + dx, crY + dy, crZ + 1, d <= 1 ? sap : d === 2 ? gL : g, 2);
  }
  for (const [dx, dy] of [[-5, 0], [5, 0], [0, 5], [-4, 3], [4, 3]]) put(22 + dx, crY + dy, crZ + 1, gL, 2);
  put(5, cy + 6, Z1 + 1, emer, 2); put(39, cy + 6, Z1 + 1, emer, 2);
  // the big lock plate with a heart keyhole
  for (let y = YB - 8; y <= YB + 3; y++) for (let x = 18; x <= 26; x++) {
    if ((x === 18 || x === 26) && (y === YB - 8 || y === YB + 3)) continue;
    put(x, y, Z1 + 1, x === 18 || y === YB + 3 ? gL : x === 26 || y === YB - 8 ? gD : g, y > YB ? 2 : 1);
  }
  const heart = [' #.# ', '#####', ' ### ', '  #  ', '  #  '];
  heart.forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === '#') put(20 + i, YB - 1 - j, Z1 + 2, hole, 1); });
  put(22, YB + 1, Z1 + 2, ruby, 2);
  // the seam (top row of the rim band): lights up as it is chiselled, front first then the left side
  const seam = [];
  for (let z = Z0; z <= Z1; z++) seam.push([X0 - (get(X0 - 1, YB, z) ? 1 : 0), YB, z]);
  const corner = seam.length - 1;
  for (let x = X0 + 1; x <= X1; x++) seam.push([x, YB, Z1 + (get(x, YB, Z1 + 1) ? 1 : 0)]);
  void pid;
  return { tier: 'golden', ...B, lidY: YB + 1, hinge: [YB + 1, Z0 - 1], anchor: [22.5, 0, 17], seam, corner, seamC, chiselAt: [X0 - 1, YB, Z1 + 1], laneA: [X0, YB, Z1 + 1], laneB: [X1, YB, Z1 + 1], flake: [g, gL, gD, gDD],
    hits: [[X0, YB, Z1 - 2], [X0, YB, Z1 - 6], [X0 + 4, YB, Z1], [X0, YB, Z1 - 10]] };
}

// ================================================================ orb: a mystery orb in a golden claw cradle
function orb() {
  const B = builder(40, 46, 40), { col, put } = B;
  const g = col('#f0b83c', { ...METAL, spec: 1.6 }), gL = col('#fff2b8', METAL), gD = col('#b07a1c', METAL);
  const glass = col('#6a4ad0', { ...GLOSS, emissive: 0.25 }), glassD = col('#3a2490', { ...GLOSS, emissive: 0.2 }), glassL = col('#a68aff', { ...GLOSS, emissive: 0.3 });
  const sw = [col('#ff8ae8', { emissive: 0.9, jitter: 0 }), col('#8ae8ff', { emissive: 0.9, jitter: 0 })], star = col('#ffffff', { emissive: 1, jitter: 0 });
  const C = [20, 23, 20], Rr = 14;
  for (let y = 0; y < 46; y++) for (let z = 0; z < 40; z++) for (let x = 0; x < 40; x++) {
    const dx = x + 0.5 - C[0], dy = y + 0.5 - C[1], dz = z + 0.5 - C[2], d = Math.hypot(dx, dy, dz);
    if (d > Rr) continue;
    const a = Math.atan2(dz, dx) + dy * 0.16;
    const s = Math.sin(a * 2 + Math.sin(dy * 0.3) * 1.2) * Math.cos(dy * 0.22);
    let c = glass;
    if (s > 0.8) c = sw[(Math.floor((dy + 20) / 6)) % 2];
    else if (s < -0.62) c = glassD;
    else if (h3(x, y, z, 3) < 0.035) c = star;
    else if (dy > 4 && s > 0.45) c = glassL;
    put(x, y, z, c, 7);
  }
  // cradle: stepped round base + four claws
  for (let y = 0; y <= 7; y++) {
    const r = y <= 1 ? 12 : y <= 3 ? 10.5 : y <= 5 ? 8.5 : 7;
    for (let z = 0; z < 40; z++) for (let x = 0; x < 40; x++) {
      const d = Math.hypot(x + 0.5 - C[0], z + 0.5 - C[2]);
      if (d > r) continue;
      put(x, y, z, d > r - 1 ? (y === 1 || y === 3 || y === 5 ? gL : g) : (y + x + z) % 5 === 0 ? gD : g, 6);
    }
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    for (let t = 0; t <= 26; t++) {
      const b = -1.1 + (t / 26) * 1.55;
      const rr = Rr + 1.3, y = C[1] + Math.sin(b) * rr, r = Math.cos(b) * rr;
      const x = C[0] + Math.cos(a) * r, z = C[2] + Math.sin(a) * r;
      for (const [ox, oz] of [[0, 0], [Math.cos(a), Math.sin(a)]]) put(x + ox * 0.7, y, z + oz * 0.7, t > 23 ? gL : g, 6);
      if (y < 8) for (let yy = Math.floor(y); yy >= 5; yy--) put(x, yy, z, gD, 6);
    }
  }
  const weak = [];
  for (let i = 0; i < 6; i++) {
    const lon = i * 2.2 + 0.4, lat = [-0.15, 0.35, 0.05, 0.45, -0.05, 0.25][i];
    const n = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
    weak.push({ n, p: [C[0] + n[0] * (Rr - 0.3), C[1] + n[1] * (Rr - 0.3), C[2] + n[2] * (Rr - 0.3)] });
  }
  return { tier: 'orb', ...B, lidY: 99, hinge: [99, 0], anchor: [20, 0, 20], centre: C, R: Rr, weak,
    crackC: col('#ffffff', { emissive: 1, jitter: 0 }), crackE: col('#ff9ae8', { emissive: 0.85, jitter: 0 }), shards: ['#6a4ad0', '#a68aff', '#ff8ae8', '#8ae8ff', '#3a2490'] };
}

const MAKERS = { crate, iron, golden, orb };
export function chestModel(tier) {
  const cm = (MAKERS[tier] || crate)();
  cm.ver = 0;
  cm.detached = new Set();
  return cm;
}

// ================================================================ damage
const hexOf = (cm, c) => cm.m.palette[c]?.color || '#ffffff';

export function damageChest(cm, i, power = 1) {
  const out = { removed: [], popped: [], at: null };
  const { m, pid, idx } = cm;
  const take = (x, y, z, list = out.removed, kind) => {
    const c = m.get(x, y, z);
    if (!c) return;
    list.push({ x, y, z, col: hexOf(cm, c), kind });
    m.data[idx(x, y, z)] = 0; pid[idx(x, y, z)] = 0;
  };
  if (cm.tier === 'crate') {
    const at = cm.hits[i % cm.hits.length];
    out.at = at;
    const [hx, hy, hz] = at;
    const isWood = (c) => c && c !== cm.crack;
    const hole = new Set();
    if (hy >= 31) {
      // the lid's edge splinters
      const L = 2.5 + power * 2;
      for (let y = 31; y <= 35; y++) for (let z = Math.floor(hz - L - 2); z <= hz + L + 2; z++) for (let x = 0; x <= 2 + Math.round(power * 1.5); x++) {
        const e = L + (h3(x, y, z, 40 + i) - 0.5) * 3;
        if (Math.abs(z - hz) < e && m.get(x, y, z)) { take(x, y, z); hole.add(y + ',' + z); }
      }
    } else {
      // smash a stretch of one plank (between the gaps) in: jagged ends, the inner board too on a big hit
      const row = Math.floor(hy / 6), y0 = row * 6, y1 = row * 6 + 4;
      const L = 2.6 + power * 2.4;
      for (let y = y0; y <= y1; y++) {
        const a = hz - L + (h3(y, 1, i, 41) - 0.5) * 3.5, b = hz + L + (h3(y, 2, i, 42) - 0.5) * 3.5;
        for (let z = Math.max(5, Math.floor(a)); z <= Math.min(28, Math.ceil(b)); z++) {
          for (let x = 0; x <= 2; x++) if (m.get(x, y, z)) take(x, y, z);
          if ((power > 1.1 || h3(y, z, i, 43) < 0.45) && m.get(3, y, z) && Math.abs(z - hz) < L * 0.8) take(3, y, z);
          hole.add(y + ',' + z);
        }
      }
      // splintered ends + a few hanging splinters
      for (let y = y0; y <= y1; y++) for (let z = 4; z <= 29; z++) {
        if (hole.has(y + ',' + z)) continue;
        const near = hole.has(y + ',' + (z - 1)) || hole.has(y + ',' + (z + 1)) || hole.has(y + ',' + (z - 2)) || hole.has(y + ',' + (z + 2));
        if (!near) continue;
        for (let x = 1; x <= 2; x++) { const c = m.get(x, y, z); if (isWood(c) && pid[idx(x, y, z)] !== 1) m.data[idx(x, y, z)] = h3(x, y, z, 2) < 0.45 ? cm.splinterD : cm.splinter; }
      }
      // cracks run along the neighbouring planks
      for (const ry of [y0 - 2, y1 + 2]) {
        if (ry < 2 || ry > 29 || h3(ry, i, 3, 44) < 0.35) continue;
        let z = hz + (h3(ry, i, 45) - 0.5) * 6;
        const n = 4 + Math.floor(h3(ry, i, 46) * 5 + power * 2), dir = h3(ry, i, 47) < 0.5 ? -1 : 1;
        let y = ry;
        for (let s2 = 0; s2 < n; s2++) {
          z += dir; if (h3(s2, ry, i, 48) < 0.25) y += h3(s2, ry, 49) < 0.5 ? -1 : 1;
          const zz = Math.round(z);
          if (zz < 5 || zz > 28) break;
          for (let x = 1; x <= 2; x++) { const c = m.get(x, y, zz); if (isWood(c) && pid[idx(x, y, zz)] !== 1) { m.data[idx(x, y, zz)] = cm.crack; break; } }
        }
      }
    }
    // nails nearby pop out
    for (const nl of cm.nails) {
      if (!m.get(...nl)) continue;
      if (Math.hypot(nl[0] - hx, nl[1] - hy, nl[2] - hz) < 6 + power * 3) take(nl[0], nl[1], nl[2], out.popped, 'nail');
    }
  } else if (cm.tier === 'iron') {
    const b = cm.bolts[i % cm.bolts.length];
    out.at = b;
    for (const [dy, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) take(b[0], b[1] + dy, b[2] + dz, out.popped, 'bolt');
  } else if (cm.tier === 'golden') {
    // light the seam outward from the front-left corner and chip gold flakes off the rim
    const n = cm.seam.length, per = Math.ceil(n / 18);
    const c0 = cm.corner;
    const lo = Math.max(0, c0 - (i + 1) * per), hi = Math.min(n - 1, c0 + (i + 1) * per);
    for (let k = lo; k <= hi; k++) { const [x, y, z] = cm.seam[k]; if (m.get(x, y, z)) m.data[idx(x, y, z)] = cm.seamC; }
    const at = cm.seam[Math.max(lo, Math.min(hi, c0 + (i % 2 ? per : -per) * 0.5 | 0))];
    out.at = at;
    for (let k = 0; k < 3 + power * 2; k++) {
      const s = cm.seam[Math.floor(lo + h3(i, k, 7) * (hi - lo))];
      const x = s[0], y = s[1] - 1 - Math.floor(h3(i, k, 8) * 2), z = s[2];
      const c = m.get(x, y, z);
      if (c && cm.flake.includes(c)) take(x, y, z);
    }
  } else if (cm.tier === 'orb') {
    const w = cm.weak[i % cm.weak.length];
    out.at = w.p;
    const C = cm.centre, R = cm.R;
    const paint = (p, core) => {
      const x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]);
      for (const [ox, oy, oz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]) {
        const c = m.get(x + ox, y + oy, z + oz);
        if (!c || pid[idx(x + ox, y + oy, z + oz)] !== 7) continue;
        if (ox || oy || oz) { if (m.data[idx(x + ox, y + oy, z + oz)] !== cm.crackC) m.data[idx(x + ox, y + oy, z + oz)] = cm.crackE; } else m.data[idx(x, y, z)] = core ? cm.crackC : cm.crackE;
      }
    };
    const walk = (n0, steps, seed) => {
      let n = n0.slice();
      let tx = -n[2], tz = n[0];
      let ang = h3(seed, 1, 2) * Math.PI * 2;
      for (let k = 0; k < steps; k++) {
        ang += (h3(seed, k, 5) - 0.5) * 1.2;
        const up = [0, 1, 0];
        const tA = norm3(cross3(n, up)), tB = cross3(n, tA);
        n = norm3([n[0] + (tA[0] * Math.cos(ang) + tB[0] * Math.sin(ang)) * 0.09, n[1] + (tA[1] * Math.cos(ang) + tB[1] * Math.sin(ang)) * 0.09, n[2] + (tA[2] * Math.cos(ang) + tB[2] * Math.sin(ang)) * 0.09]);
        paint([C[0] + n[0] * (R - 0.6), C[1] + n[1] * (R - 0.6), C[2] + n[2] * (R - 0.6)], true);
        if (k === Math.floor(steps / 2) && seed < 50) walk(n, Math.floor(steps * 0.6), seed + 50);
      }
      void tx; void tz;
    };
    walk(w.n, 9 + Math.floor(power * 4), i * 7 + 1);
    walk(w.n, 7 + Math.floor(power * 3), i * 7 + 3);
  }
  cm.ver++;
  return out;
}
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// a copy of the lid rotated open about its hinge (deg), in a model padded behind / above
const PADZ = 18, PADY = 22;
function lidModel(cm, deg) {
  const { m, pid } = cm;
  const L = new VoxelModel(m.nx, m.ny + PADY, m.nz + PADZ);
  L.palette = m.palette;
  const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const [hy, hz] = cm.hinge;
  for (let y = cm.lidY - 4; y < m.ny + PADY; y++) for (let z = 0; z < m.nz + PADZ; z++) {
    const ty = y + 0.5 - hy, tz = z - PADZ + 0.5 - hz;
    const dz = tz * ca + ty * sa, dy = ty * ca - tz * sa;
    const sy = Math.floor(hy + dy), sz = Math.floor(hz + dz);
    if (sy < 0 || sz < 0 || sy >= m.ny || sz >= m.nz) continue;
    for (let x = 0; x < m.nx; x++) {
      const i = x + m.nx * (sy + m.ny * sz);
      if (pid[i] === 2 && m.data[i]) L.data[x + L.nx * (y + L.ny * z)] = m.data[i];
    }
  }
  return L;
}

// ================================================================ rendering
export class ChestSprite {
  constructor(cm, scale = 2.5) {
    this.cm = cm;
    this.s = scale;
    this.cache = new Map();
  }
  // render `model` (optionally masked) -> {canvas, ax, ay}: (ax, ay) = where `anchor` lands in the canvas
  render(key, model, keep, anchor, yaw = CHEST_YAW) {
    const k = key + '|' + this.cm.ver;
    let r = this.cache.get(k);
    if (r) return r;
    for (const old of this.cache.keys()) if (old.startsWith(key + '|')) this.cache.delete(old);
    const opts = { ...RENDER, scale: this.s, yaw, pitch: CHEST_PITCH, keepVoxel: keep || undefined };
    const R = renderVoxels(model, opts);
    const [ax, ay] = R.project(...anchor);
    const canvas = R.canvas;
    withHi(canvas, () => {
      const R2 = renderVoxels(model, { ...opts, scale: this.s * HI });
      const [bx, by] = R2.project(...anchor);
      return fitHi(canvas, R2.canvas, ax, ay, bx, by);
    });
    r = { canvas, glow: R.glow, ax, ay, project: R.project };
    this.cache.set(k, r);
    if (this.cache.size > 90) this.cache.delete(this.cache.keys().next().value);
    return r;
  }
  // a model holding only the voxels `keep(piece, x, y, z)` accepts (renders see THROUGH removed parts, unlike a mask)
  part(key, keep) {
    const k = key + '|' + this.cm.ver;
    let M = this.parts?.get(k);
    if (M) return M;
    const { m, pid } = this.cm, nx = m.nx, ny = m.ny, nz = m.nz;
    M = new VoxelModel(nx, ny, nz);
    M.palette = m.palette;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = x + nx * (y + ny * z);
      if (m.data[i] && keep(pid[i], x, y, z)) M.data[i] = m.data[i];
    }
    (this.parts ||= new Map()).set(k, M);
    for (const old of this.parts.keys()) if (old.startsWith(key + '|') && old !== k) this.parts.delete(old);
    return M;
  }
  body() {
    const cm = this.cm, det = cm.detached, orb = cm.tier === 'orb', cz = cm.centre?.[2] ?? 0;
    return this.render('body', this.part('body', (p, x, y, z) => p !== 2 && p !== 7 && !det.has(p) && (!orb || z < cz)), null, cm.anchor);
  }
  front() { // orb cradle claws in front of the orb
    const cm = this.cm, cz = cm.centre[2];
    return this.render('front', this.part('front', (p, x, y, z) => p === 6 && z >= cz), null, cm.anchor);
  }
  lid(deg = 0) {
    const cm = this.cm;
    const d = Math.round(deg);
    if (!d) return this.render('lid', this.part('lid', (p) => p === 2), null, cm.anchor);
    const k = 'lid' + d;
    const hit = this.cache.get(k + '|' + cm.ver);
    if (hit) return hit;
    const L = lidModel(cm, d);
    return this.render(k, L, null, [cm.anchor[0], cm.anchor[1], cm.anchor[2] + PADZ]);
  }
  orb(yawDeg) {
    const cm = this.cm, b = Math.round(yawDeg / 10) * 10;
    const yw = ((b % 360) + 360) % 360;
    const r = this.render('orb' + yw, this.part('orb', (p) => p === 7), null, cm.anchor, CHEST_YAW + yw);
    r.yaw = yw;
    return r;
  }
  piece(p) {
    return this.render('piece' + p, this.part('piece' + p, (q) => q === p), null, this.cm.anchor);
  }
  // screen position of a model point while the chest's anchor sits at (X, Y)
  toScreen(X, Y, p, yawOff = 0) {
    const r = yawOff ? this.orb(yawOff) : this.body();
    const q = r.project(p[0], p[1], p[2]);
    return [X - r.ax + q[0], Y - r.ay + q[1]];
  }
  // does a model-space normal face the camera (orb weak points), for an extra yaw of the orb
  facing(n, yawOff = 0) {
    const yaw = ((CHEST_YAW + yawOff) * Math.PI) / 180, p = (CHEST_PITCH * Math.PI) / 180;
    return n[0] * Math.sin(yaw) * Math.cos(p) + n[1] * Math.sin(p) + n[2] * Math.cos(yaw) * Math.cos(p);
  }
  blit(ctx, r, X, Y, dx = 0, dy = 0, glowA = 0) {
    const x = Math.round(X - r.ax + dx), y = Math.round(Y - r.ay + dy);
    ctx.drawImage(r.canvas, x, y);
    if (glowA > 0 && r.glow) {
      const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * glowA;
      ctx.drawImage(r.glow, x, y);
      ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
    }
  }
  draw(ctx, X, Y, o = {}) {
    const cm = this.cm;
    if (cm.tier === 'orb') {
      if (!o.hideOrb) {
        this.blit(ctx, this.body(), X, Y, 0, 0, 0.4);
        this.blit(ctx, this.orb(o.orbYaw || 0), X + (o.orbDx || 0), Y + (o.orbDy || 0), 0, 0, 0.55 + (o.glow || 0) * 0.4);
        this.blit(ctx, this.front(), X, Y);
      } else this.blit(ctx, this.piece(6), X, Y);
      return;
    }
    this.blit(ctx, this.body(), X, Y, 0, 0, 0.35 + (o.glow || 0) * 0.5);
    if (!o.noLid) this.blit(ctx, this.lid(o.lidAngle || 0), X, Y, o.lidDx || 0, o.lidDy || 0, 0.3);
  }
}
