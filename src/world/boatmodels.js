// Voxel models for the player's boat, one per upgrade tier (state.boat.tier 0..4):
//   0 dinghy (clinker rowboat, shipped oars, bow lantern, pennant)
//   1 fishing boat (wheelhouse, mast, stays, rod holders, fenders, life ring, net boom)
//   2 trawler (steel hull, forward wheelhouse, funnel, A-frame gantry with nets and floats, net drum, knuckle crane)
//   3 yacht (white hull with accent cove stripe and hull windows, two-level superstructure, flybridge, radar arch,
//     dressing line of signal flags and string lights, sun loungers and parasol, swim platform, underwater LEDs)
//   4 research vessel / submarine hybrid (rounded submarine lower hull with glowing viewports, dive planes and
//     propeller shroud, tall bridge, radome and sonar dish mast, stern A-frame with a hanging mini-sub, labs)
// Model axes: x stern -> bow, y up, z far -> near (toward the viewer). Each builder returns
//   { m, front: Set<palette idx drawn over the fisherman>, night: Map<idx, hex>, A: anchors, pivot, ... }.

import { VoxelModel } from '../gfx/voxel.js';
import { RNG } from '../core/rng.js';
import { smoothstep, hash3, TAU } from '../core/math.js';
import { mix, shade } from '../core/color.js';

const sm = smoothstep;

// ------------------------------------------------------------------ helpers

function palette(m, defs) {
  const out = {};
  for (const [k, v] of Object.entries(defs)) out[k] = Array.isArray(v) ? m.color(v[0], v[1] || {}) : m.color(v, {});
  return out;
}

// Planked hull from profile functions. spec: {x0, len, zc, keel(u), sheer(u), beam(u), deck(u), vee, skin, deckC}
// skin(y, u, ys, yb, z) -> palette idx for shell voxels; deckC(x, z, u) -> idx for the deck top layer.
function hull(m, s) {
  const vee = s.vee ?? 0.3, thick = s.thick ?? 1.25;
  for (let u = 0; u < s.len; u++) {
    const x = s.x0 + u, yb = Math.round(s.keel(u)), ys = Math.round(s.sheer(u)), hb = s.beam(u), dk = s.deck(u);
    for (let y = yb; y <= ys; y++) {
      const t = (y - yb) / Math.max(1, ys - yb);
      const w = Math.max(0.6, hb * (vee + (1 - vee) * Math.pow(t, s.round ?? 0.5)));
      for (let z = 0; z < m.nz; z++) {
        const dz = Math.abs(z - s.zc);
        if (dz > w) continue;
        const shell = dz > w - thick;
        if (y > dk && !shell) continue;
        let c;
        if (!shell && y === dk) c = s.deckC(x, z, u);
        else if (s.inner && y > dk && y < ys && z < s.zc) c = s.inner;
        else c = s.skin(y, u, ys, yb, z);
        m.set(x, y, z, c);
      }
    }
  }
}

// Deck height: flat at `base`, rising as a forecastle so the bulwark stays `bulwark` voxels tall.
const deckFn = (base, sheer, bulwark) => (u) => Math.max(base, Math.round(sheer(u)) - bulwark);

// Posts + top rail following the sheer on both sides.
function railing(m, s, c, o = {}) {
  const { from = 2, to = s.len - 4, every = 5, h = 3, sides = [-1, 1], post = c } = o;
  for (let u = from; u < to; u++) {
    const x = s.x0 + u, ys = Math.round(s.sheer(u)), hb = s.beam(u);
    for (const side of sides) {
      const z = Math.round(s.zc + side * (hb - 0.6));
      if (u % every === 0) for (let k = 1; k < h; k++) m.set(x, ys + k, z, post);
      m.set(x, ys + h, z, c);
    }
  }
}

// Turn palette entries inside `test` into duplicate "front" entries (drawn over the fisherman).
function twinFront(m, keys, test) {
  const twins = new Map();
  for (const k of keys) {
    const pe = m.palette[k];
    if (!pe || twins.has(k)) continue;
    twins.set(k, m.color(pe.color, { ...pe }));
  }
  for (let z = 0; z < m.nz; z++) for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
    const v = m.get(x, y, z);
    if (v && twins.has(v) && test(x, y, z)) m.set(x, y, z, twins.get(v));
  }
  return { set: new Set(twins.values()), twins };
}

function ring(m, cx, cy, z, r, cA, cB, quarters = 4) {
  for (let a = 0; a < TAU; a += 0.5 / r) m.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, Math.floor(((a + 0.4) / TAU) * quarters) % 2 ? cA : cB);
}

function porthole(m, x, y, z, rim, glass) {
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) m.set(x + dx, y + dy, z, rim);
  m.set(x, y, z, glass);
}

function fender(m, x, z, yTop, y0, y1, rope, col, band) {
  m.line(x, yTop, z - 1, x, y1 + 1, z, rope, 0);
  m.cylinder(x, z, y0, y1, 1.3, (xx, y) => (band && y === Math.round((y0 + y1) / 2) ? band : col), 'y');
}

function lantern(m, x, y, z, frame, glass) {
  m.box(x - 1, y - 2, z - 1, x + 1, y + 1, z + 1, glass);
  m.box(x - 1, y + 2, z - 1, x + 1, y + 2, z + 1, frame);
  m.box(x - 1, y - 3, z - 1, x + 1, y - 3, z + 1, frame);
  m.set(x, y + 3, z, frame);
  for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let yy = y - 2; yy <= y + 1; yy++) m.set(x + ax, yy, z + az, frame);
}

function rodInHolder(m, hx, hz, base, tx, ty, metal, rod, reel, tip) {
  m.line(hx, base, hz, hx, base + 4, hz, metal, 0);
  m.line(hx, base + 3, hz, tx, ty, hz, rod, 0);
  m.set(hx - 1, base + 6, hz, reel);
  m.set(tx, ty, hz, tip);
}

function crate(m, x0, y0, z0, x1, y1, z1, c, dark) {
  m.box(x0, y0, z0, x1, y1, z1, (x, y, z) => (x === x0 || x === x1 || y === y1 || y === y0 || z === z0 || z === z1) && ((x === x0 || x === x1) + (y === y0 || y === y1) + (z === z0 || z === z1) >= 2) ? dark : c);
}

// ------------------------------------------------------------------ tier 0: dinghy

function dinghy(paint, trim) {
  const m = new VoxelModel(72, 44, 19);
  const X0 = 10, LEN = 46, ZC = 9, WL = 3, FLOOR = 3;
  const p = palette(m, {
    bottom: [mix(paint, '#1c2034', 0.62), { jitter: 0.12 }], paint: [paint, { jitter: 0.1 }], paintD: [shade(paint, -0.18), { jitter: 0.08 }],
    trim: [trim, { jitter: 0.05 }], cap: ['#8a5a32', { jitter: 0.1 }], floor: ['#c99a62', { jitter: 0.14 }], floorD: ['#a07246', { jitter: 0.08 }],
    wood: ['#a8743e', { jitter: 0.12 }], metal: ['#4c505e', { spec: 0.5 }], brass: ['#d8a84a', { spec: 0.9 }], rope: ['#d8c08a', { jitter: 0.1 }],
    glass: ['#ffe08a', { emissive: 0.85 }], inner: ['#b8844a', { jitter: 0.1 }], red: '#e2483a', blue: '#3e8acc', orange: ['#ff8a2a', { jitter: 0.06 }], white: '#f4f0e6', fish: ['#9ad0e0', { spec: 0.6 }],
  });
  const s = {
    x0: X0, len: LEN, zc: ZC, vee: 0.35,
    keel: (u) => 1.5 * (1 - sm(0, 5, u)) + 5.5 * Math.pow(sm(30, 46, u), 1.6),
    sheer: (u) => 8 + 0.8 * (1 - sm(0, 10, u)) + 3.4 * Math.pow(sm(26, 46, u), 1.4),
    beam: (u) => (u < 18 ? 6 + 1.4 * sm(0, 18, u) : 7.4 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 18) / 28.5, 2)))),
    deck: () => FLOOR, inner: null,
    skin: (y, u, ys) => (y === ys ? p.cap : y === ys - 1 ? p.trim : y < WL ? p.bottom : (y - WL) % 2 ? p.paintD : p.paint),
    deckC: (x) => (x % 3 === 0 ? p.floorD : p.floor),
  };
  s.inner = p.inner;
  hull(m, s);
  for (let y = 2; y <= 9; y++) for (let z = ZC - 7; z <= ZC + 7; z++) if (m.get(X0, y, z)) m.set(X0, y, z, y >= 8 ? p.cap : p.wood);
  for (let y = 4; y <= 12; y++) m.set(X0 + LEN - 1, y, ZC, p.cap);
  // thwarts
  for (const u of [7, 27]) {
    const ys = Math.round(s.sheer(u)), hb = s.beam(u);
    m.box(X0 + u, ys - 2, ZC - Math.floor(hb) + 1, X0 + u + 2, ys - 2, ZC + Math.floor(hb) - 1, p.wood);
  }
  // shipped oars along both sides, blades forward
  for (const side of [-1, 1]) {
    const z = ZC + side * 4;
    m.line(X0 + 4, 9, z, X0 + 38, 10, z, p.wood, 0);
    m.box(X0 + 33, 10, z - 1, X0 + 40, 10, z + 1, p.wood);
    m.set(X0 + 22, Math.round(s.sheer(22)) + 1, ZC + side * 7, p.brass);
  }
  // bow lantern pole + pennant
  const lx = X0 + 37;
  m.line(lx, FLOOR + 1, ZC, lx, 21, ZC, p.wood, 0);
  m.line(lx, 20, ZC, lx + 3, 20, ZC, p.metal, 0);
  m.line(lx + 3, 20, ZC, lx + 3, 18, ZC, p.metal, 0);
  lantern(m, lx + 3, 15, ZC, p.metal, p.glass);
  // bucket with a fish, tackle box, rope coil, spare rod, a float
  m.cylinder(X0 + 3, ZC + 3, FLOOR + 1, FLOOR + 3, 1.5, p.blue);
  m.set(X0 + 3, FLOOR + 4, ZC + 3, p.fish);
  m.box(X0 + 13, FLOOR + 1, ZC - 3, X0 + 16, FLOOR + 2, ZC - 1, p.red);
  m.box(X0 + 13, FLOOR + 3, ZC - 3, X0 + 16, FLOOR + 3, ZC - 1, p.metal);
  for (let a = 0; a < TAU; a += 0.35) m.set(X0 + 29 + Math.round(Math.cos(a) * 1.6), FLOOR + 1, ZC - 2 + Math.round(Math.sin(a) * 1.6), p.rope);
  rodInHolder(m, X0 + 2, ZC - 4, FLOOR + 1, 1, 24, p.metal, p.cap, p.brass, p.red);
  m.sphere(X0 + 1, 6, ZC + 7, 1.4, p.orange);
  m.line(X0 + 1, 7, ZC + 7, X0 + 2, 8, ZC + 6, p.rope, 0);
  const tw = twinFront(m, [p.paint, p.paintD, p.trim, p.cap, p.orange, p.brass, p.rope], (x, y, z) => z >= ZC + 3 && y > FLOOR);
  return {
    m, front: tw.set, night: new Map([[p.glass, '#fff0b8']]), wl: WL, zc: ZC,
    A: { stand: [X0 + 18, FLOOR + 1, ZC], lantern: [lx + 3.5, 15, ZC + 0.5], mast: [lx + 0.5, 21, ZC + 0.5], flag: [lx + 0.5, 21.5, ZC + 0.5], chimney: null,
      bow: [X0 + LEN, WL, ZC], stern: [X0, WL, ZC], top: [X0 + 20, 14, ZC], keel: [X0 + 20, 0, ZC] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.6, lights: [['lantern', 70, '#ffcf70', 0.95]],
  };
}

// ------------------------------------------------------------------ tier 1: fishing boat

function fishingBoat(paint, trim) {
  const m = new VoxelModel(92, 72, 23);
  const X0 = 10, LEN = 66, ZC = 11, WL = 6, DECK = 10;
  const p = palette(m, {
    bottom: [mix(paint, '#1c2034', 0.72), { jitter: 0.12 }], boot: ['#f2ead6', { jitter: 0.05 }], paint: [paint, { jitter: 0.1 }], seam: [shade(paint, -0.16), { jitter: 0.06 }],
    strake: [trim, { jitter: 0.05 }], cap: ['#8a5a32', { jitter: 0.1 }], rail: ['#e8dcc0', { jitter: 0.04 }], deck: ['#c99a62', { jitter: 0.14 }], deckSeam: ['#a07246', { jitter: 0.08 }],
    wall: ['#f1ebdc', { jitter: 0.06 }], trim: ['#7e5230', { jitter: 0.08 }], roof: [mix('#2f7f8f', paint, 0.12), { jitter: 0.08 }], roofRim: ['#e8e0cc', { jitter: 0.04 }],
    glass: ['#86c8e4', { jitter: 0.02, spec: 0.8, edge: 0.4 }], glassHi: '#dff6ff', metal: ['#4c505e', { jitter: 0.06, spec: 0.5 }], brass: ['#d8a84a', { spec: 0.9 }],
    rope: ['#d8c08a', { jitter: 0.1 }], red: ['#e2483a', { jitter: 0.06 }], white: '#f4f0e6', lamp: ['#ffe08a', { emissive: 0.85 }], mastLamp: ['#fff6d8', { emissive: 1 }],
    tip: ['#ff5a4a', { emissive: 1 }], wood: ['#9a6a3c', { jitter: 0.1 }], crate: ['#b8864e', { jitter: 0.14 }], crateD: ['#7a5230', { jitter: 0.08 }],
    barrel: ['#8a5a34', { jitter: 0.1 }], hoop: '#5a5e6a', net: ['#5aa070', { jitter: 0.2 }], fish: ['#9ad0e0', { spec: 0.6 }], bucket: '#3e8acc', orange: ['#ff8a2a', { jitter: 0.06 }],
  });
  const s = {
    x0: X0, len: LEN, zc: ZC,
    keel: (u) => 2 * (1 - sm(0, 8, u)) + 9 * Math.pow(sm(42, 66, u), 1.8),
    sheer: (u) => 11.4 + 0.9 * (1 - sm(0, 18, u)) + 5.4 * Math.pow(sm(32, 66, u), 1.5),
    beam: (u) => (u < 34 ? 8.2 + 1.3 * sm(0, 26, u) : 9.5 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 34) / 32.5, 2)))),
    skin: (y, u, ys) => (y === ys ? p.cap : y === ys - 1 ? p.strake : y <= WL - 1 ? p.bottom : y <= WL + 1 ? p.boot : (y - WL) % 3 === 0 ? p.seam : p.paint),
    deckC: (x, z) => (z % 3 === 0 ? p.deckSeam : p.deck),
  };
  s.deck = deckFn(DECK, s.sheer, 2);
  s.inner = p.rail;
  hull(m, s);
  for (let y = Math.round(s.keel(LEN - 1)); y <= Math.round(s.sheer(LEN - 1)) + 2; y++) m.set(X0 + LEN - 1, y, ZC, p.cap);
  for (let y = 2; y <= 12; y++) for (let z = ZC - 7; z <= ZC + 7; z++) if (m.get(X0, y, z)) m.set(X0, y, z, y >= 12 ? p.cap : y <= WL - 1 ? p.bottom : p.trim);
  m.line(X0 + LEN - 2, 17, ZC, X0 + LEN + 8, 19, ZC, p.cap, 0.7);
  railing(m, s, p.rail, { from: 2, to: LEN - 4, every: 5, h: 3 });
  // wheelhouse
  const cx0 = X0 + 6, cx1 = X0 + 25, cz0 = ZC - 6, cz1 = ZC + 5, cy0 = DECK + 1, cy1 = DECK + 21;
  m.box(cx0, cy0, cz0, cx1, cy1, cz1, (x, y, z) => (y === cy0 || ((x === cx0 || x === cx1) && (z === cz0 || z === cz1)) ? p.trim : p.wall));
  for (const wx of [cx0 + 2, cx0 + 8, cx0 + 14]) {
    m.box(wx - 1, cy0 + 10, cz1, wx + 4, cy0 + 18, cz1, p.trim);
    m.box(wx, cy0 + 11, cz1, wx + 3, cy0 + 17, cz1, p.glass);
    m.set(wx, cy0 + 17, cz1, p.glassHi); m.set(wx + 1, cy0 + 16, cz1, p.glassHi);
  }
  m.box(cx1, cy0 + 10, cz0 + 1, cx1, cy0 + 18, cz1 - 1, p.trim);
  m.box(cx1, cy0 + 11, cz0 + 2, cx1, cy0 + 17, cz1 - 2, p.glass);
  m.box(cx0 + 1, cy0 + 6, cz1, cx1 - 1, cy0 + 7, cz1, (x) => (x % 2 ? p.paint : p.seam));
  porthole(m, cx0 + 4, cy0 + 3, cz1, p.brass, p.glass);
  m.box(cx0 - 2, cy1 + 1, cz0 - 1, cx1 + 2, cy1 + 1, cz1 + 1, p.roofRim);
  m.box(cx0 - 1, cy1 + 2, cz0, cx1 + 1, cy1 + 2, cz1, p.roof);
  m.cylinder(cx0 + 4, cz0 + 3, cy1 + 3, cy1 + 8, 1.2, p.metal);
  m.box(cx0 + 3, cy1 + 9, cz0 + 2, cx0 + 5, cy1 + 9, cz0 + 4, p.metal);
  m.box(cx1 - 3, cy1 + 3, cz1 - 3, cx1 - 1, cy1 + 4, cz1 - 1, p.white);
  m.box(cx1, cy1 + 3, cz1 - 3, cx1, cy1 + 4, cz1 - 1, p.glassHi);
  m.line(cx0 + 10, cy1 + 3, cz0 + 2, cx0 + 10, cy1 + 15, cz0 + 2, p.metal, 0);
  m.line(cx0 + 8, cy1 + 12, cz0 + 2, cx0 + 12, cy1 + 12, cz0 + 2, p.metal, 0);
  m.set(cx0 + 10, cy1 + 16, cz0 + 2, p.tip);
  const LT = [cx0 + 1, cy1 - 3, ZC + 6];
  m.line(LT[0], LT[1] + 4, LT[2], LT[0], LT[1] + 2, LT[2], p.metal, 0);
  lantern(m, LT[0], LT[1], LT[2], p.metal, p.lamp);
  // mast, spreader, stays, boom with a net
  const mx = X0 + 46;
  m.cylinder(mx, ZC, DECK + 1, 61, 0.9, p.wood);
  m.box(mx, 52, ZC - 5, mx, 52, ZC + 5, p.wood);
  m.set(mx, 62, ZC, p.mastLamp);
  m.line(mx, 59, ZC, X0 + LEN, 18, ZC, p.rope, 0);
  m.line(mx, 59, ZC, cx1 + 1, cy1 + 2, ZC, p.rope, 0);
  m.line(mx, 52, ZC - 5, mx + 6, DECK + 2, ZC - 7, p.rope, 0);
  m.line(mx, 52, ZC + 5, mx + 6, DECK + 2, ZC + 7, p.rope, 0);
  m.line(mx, 20, ZC, mx + 13, 29, ZC, p.wood, 0.6);
  m.line(mx + 13, 29, ZC, mx + 13, 24, ZC, p.rope, 0);
  m.ellipsoid(mx + 13, 22, ZC, 2.2, 2.8, 2, p.net);
  m.set(mx + 13, 21, ZC + 2, p.fish); m.set(mx + 12, 23, ZC + 2, p.orange);
  // cargo: crates, barrel, coiled rope, fish bucket
  crate(m, X0 + 50, DECK + 1, ZC - 6, X0 + 55, DECK + 6, ZC - 1, p.crate, p.crateD);
  crate(m, X0 + 51, DECK + 7, ZC - 5, X0 + 54, DECK + 10, ZC - 2, p.crate, p.crateD);
  m.cylinder(X0 + 57, ZC + 3, DECK + 1, DECK + 7, 2.2, (x, y) => (y === DECK + 2 || y === DECK + 6 ? p.hoop : p.barrel));
  for (let a = 0; a < TAU; a += 0.3) m.set(X0 + 31 + Math.round(Math.cos(a) * 2), DECK + 1, ZC - 5 + Math.round(Math.sin(a) * 2), p.rope);
  m.cylinder(X0 + 3, ZC + 4, DECK + 1, DECK + 4, 1.6, p.bucket);
  m.set(X0 + 3, DECK + 5, ZC + 4, p.fish);
  rodInHolder(m, X0 + 2, ZC + 6, DECK + 1, 2, 40, p.metal, p.trim, p.brass, p.red);
  rodInHolder(m, X0 + 3, ZC - 5, DECK + 1, 5, 43, p.metal, p.trim, p.brass, p.red);
  // fenders, life ring, portholes, anchor
  for (const [u, col] of [[14, p.red], [29, p.white], [44, p.orange]]) fender(m, X0 + u, Math.round(ZC + s.beam(u) + 0.8), Math.round(s.sheer(u)) + 2, 6, 10, p.rope, col, col !== p.white ? p.white : null);
  ring(m, X0 + 36, 10.5, Math.round(ZC + s.beam(36) + 0.6), 2.6, p.red, p.white);
  for (const u of [10, 18, 54]) porthole(m, X0 + u, 9, Math.round(ZC + s.beam(u) * (0.3 + 0.7 * Math.pow(Math.max(0, 8.5 - s.keel(u)) / Math.max(1, s.sheer(u) - s.keel(u)), 0.5))), p.brass, p.glass);
  {
    const x = X0 + 60, z = Math.round(ZC + s.beam(60) + 0.4);
    m.line(x, 13, z, x, 8, z, p.metal, 0); m.line(x - 1, 12, z, x + 1, 12, z, p.metal, 0);
    m.line(x - 2, 9, z, x, 7, z, p.metal, 0); m.line(x + 2, 9, z, x, 7, z, p.metal, 0);
  }
  const tw = twinFront(m, [p.paint, p.seam, p.strake, p.cap, p.rail, p.rope, p.red, p.white, p.orange, p.brass, p.metal, p.glass], (x, y, z) => x > cx1 && z >= ZC + 4 && y > DECK);
  return {
    m, front: tw.set, wl: WL, zc: ZC,
    night: new Map([[p.glass, '#ffcf6e'], [tw.twins.get(p.glass), '#ffcf6e'], [p.glassHi, '#ffe9b0'], [p.lamp, '#fff0b8'], [p.mastLamp, '#ffffff'], [p.tip, '#ff6a50']]),
    A: { stand: [X0 + 36, DECK + 1, ZC], lantern: [LT[0] + 0.5, LT[1], LT[2] + 0.5], mast: [mx + 0.5, 63, ZC + 0.5], flag: [mx + 0.5, 61.5, ZC + 0.5], chimney: [cx0 + 4.5, cy1 + 10, cz0 + 3.5],
      bow: [X0 + LEN, WL, ZC], stern: [X0, WL, ZC], top: [X0 + 16, cy1 + 3, ZC], keel: [X0 + 30, 0, ZC] },
    pivot: [X0 + LEN / 2, WL], flagScale: 1, lights: [['lantern', 78, '#ffcf70', 0.95], ['mast', 34, '#fff6d8', 0.6], ['cabin', 56, '#ffc870', 0.45]],
    cabin: [(cx0 + cx1) / 2, cy0 + 12, cz1],
  };
}

// ------------------------------------------------------------------ tier 2: trawler

function trawler(paint, trim) {
  const m = new VoxelModel(116, 86, 27);
  const X0 = 12, LEN = 86, ZC = 13, WL = 7, DECK = 12;
  const r = new RNG(77);
  const p = palette(m, {
    bottom: ['#a83a32', { jitter: 0.12 }], boot: ['#f2ead6', { jitter: 0.05 }], paint: [paint, { jitter: 0.12 }], rust: [mix(paint, '#7a3a20', 0.45), { jitter: 0.14 }],
    seam: [shade(paint, -0.18), { jitter: 0.06 }], strake: [trim, { jitter: 0.05 }], steel: ['#5a6070', { jitter: 0.08 }], deck: ['#8a8478', { jitter: 0.12 }], deckD: ['#6e6a62', { jitter: 0.08 }],
    wall: ['#f0eadc', { jitter: 0.06 }], wallD: ['#c8c0ae', { jitter: 0.06 }], glass: ['#7ab8d8', { spec: 0.8, edge: 0.4 }], glassHi: '#dff6ff', roof: ['#3e4654', { jitter: 0.06 }],
    yel: ['#e8a83a', { jitter: 0.08 }], yelD: ['#b07a2a', { jitter: 0.06 }], black: '#24262e', net: ['#3e8a5a', { jitter: 0.25 }], netL: ['#6ab878', { jitter: 0.2 }], float: ['#ff7a2a', { jitter: 0.06 }],
    metal: ['#4c505e', { spec: 0.5 }], rope: ['#d8c08a', { jitter: 0.1 }], tyre: ['#2a2a30', { jitter: 0.1 }], white: '#f4f0e6', blue: ['#3e7acc', { jitter: 0.06 }], fish: ['#9ad0e0', { spec: 0.6 }],
    lamp: ['#fff2b0', { emissive: 1 }], red: ['#ff4a3a', { emissive: 1 }], green: ['#4aff7a', { emissive: 1 }], radar: '#d8dce4',
  });
  const s = {
    x0: X0, len: LEN, zc: ZC, vee: 0.38,
    keel: (u) => 2 * (1 - sm(0, 10, u)) + 11 * Math.pow(sm(58, 86, u), 1.8),
    sheer: (u) => 15 + 1 * (1 - sm(0, 20, u)) + 6.5 * Math.pow(sm(46, 86, u), 1.5),
    beam: (u) => (u < 40 ? 10.5 + 1.5 * sm(0, 30, u) : 12 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 40) / 46.5, 2)))),
    skin: (y, u, ys, yb, z) => {
      if (y === ys) return p.steel;
      if (y === ys - 1) return p.strake;
      if (y < WL) return p.bottom;
      if (y <= WL + 1) return p.boot;
      if (hash3(u, 0, z, 9) < 0.08 && y < ys - 2 && hash3(u, y >> 2, 0, 3) < 0.6) return p.rust;
      return (y - WL) % 4 === 0 ? p.seam : p.paint;
    },
    deckC: (x, z) => ((x + z) % 7 === 0 ? p.deckD : p.deck),
  };
  s.deck = deckFn(DECK, s.sheer, 3);
  s.inner = p.wallD;
  hull(m, s);
  for (let y = 2; y <= 16; y++) for (let z = ZC - 10; z <= ZC + 10; z++) if (m.get(X0, y, z)) m.set(X0, y, z, y < WL ? p.bottom : y >= 15 ? p.steel : p.paint);
  // forward wheelhouse with bridge, mast, radar, lights
  const wx0 = X0 + 52, wx1 = X0 + 68, wz0 = ZC - 8, wz1 = ZC + 7, wy0 = DECK + 1, wy1 = DECK + 22;
  m.box(wx0, wy0, wz0, wx1, wy1, wz1, (x, y, z) => (y < wy0 + 2 ? p.wallD : p.wall));
  for (let k = 0; k < 4; k++) { const x = wx0 + 2 + k * 4; m.box(x, wy1 - 7, wz1, x + 2, wy1 - 2, wz1, p.glass); m.set(x, wy1 - 2, wz1, p.glassHi); }
  m.box(wx1, wy1 - 7, wz0 + 1, wx1, wy1 - 2, wz1 - 1, p.glass);
  for (const u of [55, 59]) porthole(m, X0 + u, wy0 + 6, wz1, p.metal, p.glass);
  m.box(wx0 - 1, wy1 + 1, wz0 - 1, wx1 + 2, wy1 + 1, wz1 + 1, p.roof);
  railing(m, { x0: wx0, len: wx1 - wx0 + 1, zc: ZC, sheer: () => wy1 + 1, beam: () => 8.4 }, p.white, { from: 0, to: wx1 - wx0 + 1, every: 4, h: 3 });
  const mx = wx0 + 6;
  m.cylinder(mx, ZC, wy1 + 2, wy1 + 26, 0.9, p.white);
  m.box(mx - 5, wy1 + 16, ZC - 1, mx + 5, wy1 + 17, ZC + 1, p.radar);
  m.box(mx - 1, wy1 + 20, ZC - 6, mx + 1, wy1 + 20, ZC + 6, p.white);
  m.set(mx, wy1 + 27, ZC, p.lamp); m.set(mx, wy1 + 20, ZC + 6, p.green); m.set(mx, wy1 + 20, ZC - 6, p.red);
  m.cylinder(wx0 + 12, ZC - 4, wy1 + 2, wy1 + 4, 2.2, p.white); // life raft canister
  // funnel
  const fx = X0 + 47;
  m.cylinder(fx, ZC - 2, DECK + 1, DECK + 28, 2.8, (x, y) => (y > DECK + 25 ? p.black : y > DECK + 21 && y < DECK + 24 ? p.strake : p.paint));
  // stern A-frame gantry with hanging net and floats
  const gx = X0 + 4;
  for (const side of [-1, 1]) m.line(gx + 3, DECK + 1, ZC + side * 10, gx - 2, 46, ZC + side * 9, p.yel, 1);
  m.line(gx - 2, 46, ZC - 9, gx - 2, 46, ZC + 9, p.yel, 1.1);
  m.box(gx - 3, 43, ZC - 1, gx - 1, 45, ZC + 1, p.yelD);
  m.line(gx - 2, 43, ZC, gx - 1, 30, ZC, p.metal, 0);
  m.ellipsoid(gx, 25, ZC, 4.5, 6, 4, (x, y, z) => ((x + y + z) % 3 ? p.net : p.netL));
  for (let k = 0; k < 5; k++) m.sphere(gx - 3 + k * 1.6, 31 - k * 0.4, ZC + 4, 1.1, p.float);
  m.set(gx - 2, 47, ZC + 9, p.lamp); m.set(gx - 2, 47, ZC - 9, p.lamp);
  // net drum
  const dx = X0 + 17;
  for (let z = ZC - 7; z <= ZC + 7; z++) {
    const flange = z === ZC - 7 || z === ZC + 7;
    m.cylinder(dx, DECK + 7, z, z, flange ? 5 : 4, (x, y) => (flange ? p.yelD : (x + y + z) % 3 ? p.net : p.netL), 'z');
  }
  m.box(dx - 1, DECK + 1, ZC - 8, dx + 1, DECK + 7, ZC - 8, p.yel); m.box(dx - 1, DECK + 1, ZC + 8, dx + 1, DECK + 7, ZC + 8, p.yel);
  // knuckle-boom crane
  const kx = X0 + 36, kz = ZC + 7;
  m.cylinder(kx, kz, DECK + 1, DECK + 8, 1.6, p.yel);
  m.line(kx, DECK + 8, kz, kx + 8, DECK + 22, kz, p.yel, 1);
  m.line(kx + 8, DECK + 22, kz, kx + 14, DECK + 16, kz, p.yelD, 0.8);
  m.line(kx + 14, DECK + 16, kz, kx + 14, DECK + 9, kz, p.metal, 0);
  m.box(kx + 13, DECK + 7, kz - 1, kx + 15, DECK + 8, kz + 1, p.metal);
  // fish boxes, hatch, coiled ropes, tyre fenders
  for (let k = 0; k < 3; k++) {
    crate(m, X0 + 24 + k * 5, DECK + 1, ZC - 9, X0 + 28 + k * 5, DECK + 3, ZC - 5, p.blue, p.white);
    m.set(X0 + 26 + k * 5, DECK + 4, ZC - 7, p.fish);
  }
  crate(m, X0 + 25, DECK + 4, ZC - 9, X0 + 29, DECK + 6, ZC - 5, p.blue, p.white);
  m.box(X0 + 28, DECK + 1, ZC - 2, X0 + 33, DECK + 2, ZC + 3, p.steel);
  for (const u of [20, 42, 62]) {
    const z = Math.round(ZC + s.beam(u) + 0.5);
    ring(m, X0 + u, 10, z, 2.2, p.tyre, p.tyre);
    m.line(X0 + u, 12, z, X0 + u, Math.round(s.sheer(u)), z - 1, p.rope, 0);
  }
  for (const u of [8, 14]) for (let z = ZC - 2; z <= ZC + 2; z++) m.set(X0 + u, 9 + (z % 2), Math.round(ZC + s.beam(u) + 0.3), p.white);
  // bow anchor
  {
    const x = X0 + 76, z = Math.round(ZC + s.beam(76) + 0.4);
    m.line(x, 17, z, x, 11, z, p.metal, 0); m.line(x - 2, 12, z, x, 10, z, p.metal, 0); m.line(x + 2, 12, z, x, 10, z, p.metal, 0);
  }
  void r;
  const tw = twinFront(m, [p.paint, p.seam, p.rust, p.strake, p.steel, p.white, p.rope, p.tyre], (x, y, z) => x > X0 + 8 && x < wx0 && z >= ZC + 6 && y > DECK);
  return {
    m, front: tw.set, wl: WL, zc: ZC,
    night: new Map([[p.glass, '#ffcf6e'], [p.glassHi, '#ffe9b0'], [p.lamp, '#ffffff'], [p.red, '#ff6a50'], [p.green, '#6aff8a']]),
    A: { stand: [X0 + 27, DECK + 1, ZC + 1], lantern: [gx - 1.5, 47.5, ZC + 9.5], mast: [mx + 0.5, wy1 + 28, ZC + 0.5], flag: [mx + 0.5, wy1 + 26.5, ZC + 0.5], chimney: [fx + 0.5, DECK + 29, ZC - 1.5],
      bow: [X0 + LEN, WL, ZC], stern: [X0, WL, ZC], top: [X0 + 40, wy1 + 2, ZC], keel: [X0 + 40, 0, ZC] },
    pivot: [X0 + LEN / 2, WL], flagScale: 1, lights: [['lantern', 90, '#fff2c8', 0.9], ['mast', 40, '#ffffff', 0.6], ['cabin', 60, '#ffc870', 0.5]],
    cabin: [(wx0 + wx1) / 2, wy1 - 4, wz1],
  };
}

// ------------------------------------------------------------------ tier 3: yacht

function yacht(paint) {
  const m = new VoxelModel(120, 74, 27);
  const X0 = 14, LEN = 90, ZC = 13, WL = 6, DECK = 11;
  const p = palette(m, {
    bottom: ['#1e2a44', { jitter: 0.08 }], hull: ['#f6f4ee', { jitter: 0.02, spec: 0.2 }], hullS: ['#dcdad4', { jitter: 0.02 }], accent: [paint, { jitter: 0.06, spec: 0.4 }],
    hullWin: ['#1e2c3e', { spec: 0.9 }], teak: ['#c08a52', { jitter: 0.12 }], teakD: ['#9a6a3a', { jitter: 0.08 }], chrome: ['#d8dee8', { spec: 0.4, jitter: 0.02 }],
    tint: ['#243848', { spec: 1, edge: 0.6 }], tintHi: '#8ab8d8', white: ['#fbfaf6', { jitter: 0.03 }], canopy: ['#e8e6e0', { jitter: 0.03 }], cushion: [mix(paint, '#ffffff', 0.35), { jitter: 0.05 }],
    para: [paint, { jitter: 0.05 }], paraW: '#fbf6ea', pole: '#8a8a90', led: ['#5affff', { emissive: 1 }], lampW: ['#fffbe0', { emissive: 1 }],
    l1: ['#ff5a5a', { emissive: 1 }], l2: ['#ffd84a', { emissive: 1 }], l3: ['#5aff8a', { emissive: 1 }], l4: ['#5ab4ff', { emissive: 1 }],
    f1: '#e8403a', f2: '#f8d040', f3: '#3a7ae0', f4: '#f4f0e6', rope: '#d8d0c0', dark: '#2a2e38', rubber: ['#3a3e48', { jitter: 0.06 }], ringR: '#e2483a',
  });
  const s = {
    x0: X0, len: LEN, zc: ZC, vee: 0.3,
    keel: (u) => 1.5 * (1 - sm(0, 8, u)) + 10 * Math.pow(sm(46, 90, u), 1.5),
    sheer: (u) => 12 + 4.5 * Math.pow(sm(40, 90, u), 1.3),
    beam: (u) => (u < 36 ? 10.5 + 1.5 * sm(0, 28, u) : 12 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 36) / 54.5, 2)))),
    skin: (y, u, ys) => {
      if (y === ys) return p.chrome;
      if (y < WL - 1) return p.bottom;
      if (y === WL - 1) return p.accent;
      if (y === 9 || y === 10) return u > 6 && u < 82 ? p.accent : p.hull;
      if (y === 7 && u > 30 && u < 62 && (u - 30) % 11 < 8) return p.hullWin;
      return y > ys - 3 ? p.hull : p.hullS;
    },
    deckC: (x, z) => (z % 2 ? p.teakD : p.teak),
  };
  s.deck = deckFn(DECK, s.sheer, 1);
  s.inner = p.hull;
  hull(m, s);
  // swim platform + ladder at the stern
  m.box(X0 - 6, 5, ZC - 9, X0, 6, ZC + 9, (x, y) => (y === 6 ? p.teak : p.white));
  for (let y = 1; y <= 5; y++) m.set(X0 - 5, y, ZC + 6, y % 2 ? p.chrome : p.chrome);
  // main superstructure with tinted window band and raked front
  const sx0 = X0 + 18, sx1 = X0 + 64, sz0 = ZC - 9, sz1 = ZC + 8, sy0 = DECK + 1, sy1 = DECK + 10;
  for (let x = sx0; x <= sx1; x++) {
    const rake = Math.max(0, x - (sx1 - 10)) * 0.9;
    const yt = Math.round(sy1 - rake);
    for (let y = sy0; y <= yt; y++) for (let z = sz0; z <= sz1; z++) {
      const band = y >= sy0 + 3 && y <= sy1 - 2 && x > sx0 + 1;
      m.set(x, y, z, band && (z === sz1 || z === sz0 || x >= sx1 - 12) ? (y === sy1 - 2 && (x % 6 === 0) ? p.tintHi : p.tint) : p.white);
    }
  }
  // flybridge with canopy and radar arch
  const fx0 = X0 + 26, fx1 = X0 + 52, fy = sy1 + 1;
  m.box(fx0, fy, ZC - 7, fx1, fy, ZC + 6, p.white);
  m.box(fx0 + 1, fy + 1, ZC - 6, fx0 + 6, fy + 3, ZC + 5, p.white);
  m.box(fx0 + 12, fy + 1, ZC - 2, fx0 + 15, fy + 4, ZC + 1, p.dark);
  railing(m, { x0: fx0, len: fx1 - fx0 + 1, zc: ZC, sheer: () => fy, beam: () => 7.2 }, p.chrome, { from: 0, to: fx1 - fx0 + 1, every: 4, h: 3 });
  const ax = X0 + 30;
  for (const side of [-1, 1]) m.line(ax, fy + 1, ZC + side * 7, ax + 3, fy + 12, ZC + side * 5, p.white, 0.9);
  m.box(ax + 2, fy + 12, ZC - 6, ax + 5, fy + 13, ZC + 6, p.white);
  m.box(ax + 4, fy + 11, ZC - 6, fx1 - 4, fy + 11, ZC + 6, p.canopy);
  m.sphere(ax + 3, fy + 16, ZC, 2.2, p.white);
  m.line(ax + 6, fy + 14, ZC, ax + 6, fy + 22, ZC, p.chrome, 0);
  m.set(ax + 6, fy + 23, ZC, p.lampW);
  // bow chrome rail, sun loungers, parasol
  railing(m, s, p.chrome, { from: 64, to: LEN - 8, every: 4, h: 2 });
  railing(m, s, p.chrome, { from: 1, to: 18, every: 3, h: 3 });
  for (const [x, z] of [[X0 + 67, ZC - 4], [X0 + 67, ZC + 2]]) {
    const dk = s.deck(x - X0 + 4);
    m.box(x, dk + 1, z - 2, x + 9, dk + 1, z + 1, p.white);
    m.box(x, dk + 2, z - 2, x + 7, dk + 2, z + 1, p.cushion);
    for (let k = 0; k < 4; k++) m.box(x - k * 0.5, dk + 2 + k, z - 2, x + 1 - k * 0.5, dk + 2 + k, z + 1, p.cushion);
  }
  const px = X0 + 80;
  const pdk = s.deck(px - X0);
  m.line(px, pdk + 1, ZC, px, pdk + 14, ZC, p.pole, 0);
  for (let y = 0; y < 3; y++) m.cylinder(px, ZC, pdk + 15 - y, pdk + 15 - y, 1.5 + y * 2, (x, yy, z) => (Math.floor((Math.atan2(z - ZC, x - px) + Math.PI) / (Math.PI / 3)) % 2 ? p.para : p.paraW));
  // dressing line: signal flags + string lights from the bow over the arch to the stern
  const lines = [[[X0 + LEN - 1, s.sheer(LEN - 1) + 2], [ax + 6, fy + 22]], [[ax + 6, fy + 22], [X0 + 1, DECK + 7]]];
  let k = 0;
  for (const [[x0, y0], [x1, y1]] of lines) {
    const n = Math.round(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 1; i < n; i++) {
      const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 3);
      m.set(x, y, ZC, p.rope);
      if (i % 4 === 0) { k++; m.set(x, y - 1, ZC, [p.l1, p.l2, p.l3, p.l4][k % 4]); }
      else if (i % 4 === 2) { const fc = [p.f1, p.f2, p.f3, p.f4][(i >> 2) % 4]; m.box(x, y - 2, ZC, x + 1, y - 1, ZC, fc); }
    }
  }
  // ensign staff, life ring, fenders, underwater LEDs
  m.line(X0 + 1, DECK + 1, ZC, X0 - 1, DECK + 12, ZC, p.chrome, 0);
  ring(m, X0 + 12, DECK + 5, ZC + 10, 2.4, p.ringR, p.white);
  for (const u of [24, 40, 56]) fender(m, X0 + u, Math.round(ZC + s.beam(u) + 0.8), Math.round(s.sheer(u)) + 1, 5, 9, p.rope, p.white, null);
  for (let u = 6; u < 80; u += 9) m.set(X0 + u, 3, Math.round(ZC + s.beam(u) * 0.62), p.led);
  // tender on the stern platform
  m.ellipsoid(X0 - 3, 8, ZC - 3, 4, 1.6, 2.6, p.rubber);
  const tw = twinFront(m, [p.chrome, p.hull, p.hullS, p.accent, p.rope, p.white, p.ringR], (x, y, z) => (x < sx0 || x > sx1) && z >= ZC + 6 && y > DECK);
  return {
    m, front: tw.set, wl: WL, zc: ZC,
    night: new Map([[p.tint, '#ffd58a'], [p.tintHi, '#fff0c0'], [p.hullWin, '#ffcf80'], [p.led, '#5affff'], [p.lampW, '#ffffff'], [p.l1, '#ff6a6a'], [p.l2, '#ffe070'], [p.l3, '#6aff9a'], [p.l4, '#6ac4ff']]),
    A: { stand: [X0 + 9, DECK + 1, ZC], lantern: [ax + 6.5, fy + 23, ZC + 0.5], mast: [ax + 6.5, fy + 23, ZC + 0.5], flag: [X0 - 0.5, DECK + 12.5, ZC + 0.5], chimney: null,
      bow: [X0 + LEN, WL, ZC], stern: [X0 - 6, WL, ZC], top: [X0 + 36, fy + 12, ZC], keel: [X0 + 40, 0, ZC] },
    pivot: [X0 + LEN / 2, WL], flagScale: 0.8, lights: [['lantern', 50, '#fffbe0', 0.7], ['cabin', 80, '#ffd58a', 0.6], ['under', 70, '#5affff', 0.5]],
    cabin: [(sx0 + sx1) / 2, sy0 + 6, sz1], under: [X0 + 40, 3, ZC + 8],
  };
}

// ------------------------------------------------------------------ tier 4: research vessel / submarine hybrid

function research(paint, trim) {
  const m = new VoxelModel(132, 96, 31);
  const X0 = 16, LEN = 96, ZC = 15, WL = 9, DECK = 16;
  const p = palette(m, {
    sub: ['#2a3040', { jitter: 0.06, spec: 0.4 }], subL: ['#3a4256', { jitter: 0.06 }], paint: [paint, { jitter: 0.08 }], paintD: [shade(paint, -0.2), { jitter: 0.06 }],
    band: [trim, { jitter: 0.02 }], white: ['#f2f0ea', { jitter: 0.02 }], whiteD: ['#cfccc4', { jitter: 0.02 }], deck: ['#7a8a8a', { jitter: 0.1 }], deckD: ['#5e6c6c', { jitter: 0.08 }],
    view: ['#3a6a8a', { spec: 0.9 }], viewRim: ['#9aa4b4', { spec: 0.8 }], glass: ['#1e3a52', { spec: 1, edge: 0.6 }], glassHi: '#9ad0f0', black: '#22242c',
    yel: ['#f0b832', { jitter: 0.06 }], yelD: ['#c08a22', { jitter: 0.06 }], subBody: ['#ffd23a', { jitter: 0.05, spec: 0.5 }], dome: ['#bfefff', { spec: 1 }], metal: ['#4c505e', { spec: 0.5 }],
    radome: ['#f6f6f2', { smooth: 0.7 }], dish: ['#e4e6ea', { smooth: 0.4, spec: 0.6 }], blue: '#2e6ac8', orange: ['#ff7a2a', { jitter: 0.05 }],
    lamp: ['#fff6d0', { emissive: 1 }], red: ['#ff4a3a', { emissive: 1 }], green: ['#4aff7a', { emissive: 1 }], subLamp: ['#bfffff', { emissive: 1 }], rope: '#d8c08a',
  });
  const s = {
    x0: X0, len: LEN, zc: ZC, vee: 0.5, round: 0.35,
    keel: (u) => 3 * (1 - sm(0, 12, u)) + 12 * Math.pow(sm(66, 96, u), 1.7),
    sheer: (u) => 19 + 1 * (1 - sm(0, 20, u)) + 6 * Math.pow(sm(58, 96, u), 1.4),
    beam: (u) => (u < 46 ? 12 + 1.5 * sm(0, 30, u) : 13.5 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 46) / 50.5, 2)))),
    skin: (y, u, ys) => {
      if (y === ys) return p.white;
      if (y >= ys - 2) return p.band;
      if (y < WL - 1) return y % 3 === 0 ? p.subL : p.sub;
      if (y === WL - 1 || y === WL) return p.band;
      return (y - WL) % 4 === 0 ? p.paintD : p.paint;
    },
    deckC: (x, z) => ((x + z) % 5 === 0 ? p.deckD : p.deck),
  };
  s.deck = deckFn(DECK, s.sheer, 3);
  s.inner = p.whiteD;
  hull(m, s);
  // glowing viewports on the submarine lower hull, dive planes, propeller shroud and rudder
  for (let u = 12; u < 80; u += 9) {
    const yb = s.keel(u), ys = s.sheer(u), t = (5 - yb) / Math.max(1, ys - yb);
    const z = Math.round(ZC + s.beam(u) * (0.5 + 0.5 * Math.pow(Math.max(0, t), 0.35)));
    porthole(m, X0 + u, 5, z, p.viewRim, p.view);
  }
  for (const [u, y] of [[86, 6], [6, 4]]) m.box(X0 + u - 3, y, ZC - 16, X0 + u + 2, y, ZC + 16, p.subL);
  for (let a = 0; a < TAU; a += 0.2) m.set(X0 - 3, 5 + Math.sin(a) * 3.4, ZC + Math.cos(a) * 3.4, p.metal);
  m.box(X0 - 2, 4, ZC, X0 - 2, 6, ZC, p.yel);
  m.box(X0 - 6, 1, ZC, X0 - 4, 10, ZC, p.sub);
  for (let y = 2; y <= 20; y++) for (let z = ZC - 12; z <= ZC + 12; z++) if (m.get(X0, y, z)) m.set(X0, y, z, y < WL ? p.sub : y >= 18 ? p.band : p.paint);
  // superstructure: accommodation + bridge with wraparound windows + wings
  const bx0 = X0 + 58, bx1 = X0 + 80, bz0 = ZC - 10, bz1 = ZC + 9;
  m.box(bx0, DECK + 1, bz0, bx1, DECK + 13, bz1, (x, y, z) => (y === DECK + 1 ? p.whiteD : p.white));
  for (let x = bx0 + 2; x < bx1 - 1; x += 3) for (const y of [DECK + 5, DECK + 10]) porthole(m, x, y, bz1, p.whiteD, p.glass);
  m.box(bx0 + 2, DECK + 14, bz0 - 2, bx1 + 1, DECK + 22, bz1 + 2, (x, y, z) => (y >= DECK + 16 && y <= DECK + 20 && (z === bz1 + 2 || x === bx1 + 1 || z === bz0 - 2) ? ((x + y) % 7 === 0 ? p.glassHi : p.glass) : p.white));
  m.box(bx0 + 1, DECK + 23, bz0 - 3, bx1 + 2, DECK + 23, bz1 + 3, p.black);
  // mast with radome, sonar dish, antennas, lights
  const mx = bx0 + 10;
  m.box(mx - 1, DECK + 24, ZC - 1, mx + 1, DECK + 52, ZC + 1, (x, y) => (y % 4 === 0 ? p.whiteD : p.white));
  m.box(mx - 7, DECK + 38, ZC, mx + 7, DECK + 38, ZC, p.white);
  m.sphere(mx + 6, DECK + 43, ZC, 3.4, p.radome);
  m.line(mx + 6, DECK + 38, ZC, mx + 6, DECK + 40, ZC, p.white, 0);
  // sonar / satellite dish (shallow paraboloid facing up-left)
  {
    const cx = mx - 7, cy = DECK + 44, cz = ZC;
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const r2 = i * i + j * j;
      if (r2 > 36) continue;
      const d = r2 * 0.09;
      m.set(cx + Math.round(i * 0.7 + d * 0.5), cy + Math.round(i * 0.7 - d * 0.7), cz + j, p.dish);
    }
    m.line(cx + 2, cy - 2, cz, mx - 1, DECK + 38, cz, p.metal, 0.5);
    m.line(cx, cy, cz, cx - 3, cy + 4, cz, p.metal, 0);
  }
  for (const [dx, h] of [[-3, 8], [3, 6]]) m.line(mx + dx, DECK + 52, ZC, mx + dx, DECK + 52 + h, ZC, p.metal, 0);
  m.set(mx, DECK + 53, ZC, p.lamp); m.set(mx - 3, DECK + 61, ZC, p.red); m.set(mx + 7, DECK + 38, ZC, p.green); m.set(mx - 7, DECK + 38, ZC, p.red);
  // funnel
  const fx = X0 + 50;
  m.cylinder(fx, ZC - 3, DECK + 1, DECK + 24, 3.2, (x, y) => (y > DECK + 21 ? p.black : y > DECK + 16 && y < DECK + 20 ? p.paint : p.white));
  // labs + ROV on deck
  for (const [x, z] of [[X0 + 32, ZC - 9], [X0 + 42, ZC - 9]]) crate(m, x, DECK + 1, z, x + 8, DECK + 7, z + 6, p.white, p.blue);
  m.box(X0 + 34, DECK + 1, ZC + 2, X0 + 39, DECK + 5, ZC + 6, p.orange);
  m.box(X0 + 35, DECK + 2, ZC + 7, X0 + 38, DECK + 4, ZC + 7, p.black);
  // stern A-frame with the yellow mini-sub dangling over the water
  const gx = X0 + 6;
  for (const side of [-1, 1]) m.line(gx + 4, DECK + 1, ZC + side * 12, gx - 5, 60, ZC + side * 11, p.yel, 1.2);
  m.line(gx - 5, 60, ZC - 11, gx - 5, 60, ZC + 11, p.yel, 1.3);
  m.set(gx - 5, 62, ZC + 11, p.lamp); m.set(gx - 5, 62, ZC - 11, p.lamp);
  const sx = gx - 7, sy = 33;
  m.ellipsoid(sx, sy, ZC, 11, 4.8, 4.8, (x) => (Math.abs(x + 0.5 - sx) < 1.5 ? p.white : p.subBody));
  m.sub(() => m.box(sx + 7, sy - 5, ZC - 5, sx + 12, sy + 5, ZC + 5, 1));
  m.sphere(sx + 7, sy, ZC, 4, p.dome);
  m.box(sx - 3, sy + 4, ZC - 1, sx + 2, sy + 7, ZC + 1, p.subBody);
  m.box(sx - 2, sy + 8, ZC - 1, sx + 1, sy + 8, ZC + 1, p.metal);
  m.box(sx - 13, sy - 4, ZC, sx - 10, sy + 4, ZC, p.yelD);
  m.box(sx - 13, sy, ZC - 4, sx - 10, sy, ZC + 4, p.yelD);
  for (let a = 0; a < TAU; a += 0.3) m.set(sx - 14, sy + Math.sin(a) * 2.5, ZC + Math.cos(a) * 2.5, p.metal);
  for (const dz of [-3, 3]) { m.box(sx - 7, sy - 7, ZC + dz, sx + 6, sy - 7, ZC + dz, p.metal); m.line(sx - 4, sy - 7, ZC + dz, sx - 4, sy - 4, ZC + dz, p.metal, 0); m.line(sx + 3, sy - 7, ZC + dz, sx + 3, sy - 4, ZC + dz, p.metal, 0); }
  m.set(sx + 3, sy - 3, ZC + 4, p.subLamp); m.set(sx + 3, sy - 3, ZC - 4, p.subLamp); m.set(sx - 1, sy + 9, ZC, p.red);
  for (const dz of [-1, 1]) m.line(gx - 5, 58, ZC + dz, sx, sy + 9, ZC + dz, p.metal, 0);
  // rails, ring buoys
  railing(m, s, p.white, { from: 2, to: 56, every: 4, h: 3 });
  ring(m, X0 + 54, DECK + 4, Math.round(ZC + s.beam(54) + 0.5), 2.4, p.orange, p.white);
  const tw = twinFront(m, [p.white, p.band, p.paint, p.paintD, p.orange], (x, y, z) => x > X0 + 8 && x < bx0 && z >= ZC + 7 && y > DECK);
  return {
    m, front: tw.set, wl: WL, zc: ZC,
    night: new Map([[p.glass, '#ffd58a'], [p.glassHi, '#fff0c0'], [p.view, '#9affff'], [p.lamp, '#ffffff'], [p.red, '#ff6a50'], [p.green, '#6aff8a'], [p.subLamp, '#d8ffff'], [p.dome, '#9affff']]),
    A: { stand: [X0 + 24, DECK + 1, ZC + 1], lantern: [gx - 4.5, 62.5, ZC + 11.5], mast: [mx + 0.5, DECK + 54, ZC + 0.5], flag: [mx + 0.5, DECK + 52.5, ZC + 0.5], chimney: [fx + 0.5, DECK + 25, ZC - 2.5],
      bow: [X0 + LEN, WL, ZC], stern: [X0 - 6, WL, ZC], top: [X0 + 60, DECK + 23, ZC], keel: [X0 + 40, 0, ZC] },
    pivot: [X0 + LEN / 2, WL], flagScale: 1, lights: [['lantern', 100, '#fff6d0', 0.9], ['mast', 44, '#ffffff', 0.6], ['cabin', 70, '#ffd58a', 0.5], ['sub', 50, '#bfffff', 0.6], ['under', 80, '#9affff', 0.5]],
    cabin: [(bx0 + bx1) / 2, DECK + 18, bz1 + 2], sub: [sx + 8, sy, ZC + 4], under: [X0 + 40, 5, ZC + 12],
  };
}

export const BOAT_TIERS = [
  { name: 'Dinghy', build: dinghy },
  { name: 'Fishing Boat', build: fishingBoat },
  { name: 'Trawler', build: trawler },
  { name: 'Yacht', build: yacht },
  { name: 'Research Vessel', build: research },
];

export function buildBoatModel(tier, paint, trim = '#efe2c2') {
  const T = BOAT_TIERS[Math.max(0, Math.min(BOAT_TIERS.length - 1, tier | 0))];
  return T.build(paint, trim);
}
