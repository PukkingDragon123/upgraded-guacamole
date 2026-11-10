// Aquarium plants that sway (phase 6; phase 8: every plant is a voxel model). Each tier gets a planted layout (tall
// vallisneria / kelp / cabomba at the back, sword plants, java fern and red-tipped rotala at the sides, hairgrass
// tufts and moss balls in front), plus the plants the player paints with the build brush. All plants live in one
// rest mesh; every frame the vertices bend with height (a slow two-wave sway with per-plant phase) and get pushed
// aside by the swimmer, then the merged mesh is written straight into a DynMesh.
//
//   new PlantField(shape, tier, count, painted?, hidden?)  painted: [{k: kind, x, z (0..1 floor uv), h (0..1), s (seed)}]
//                                       hidden: Set of base-layout indices the eraser removed
//   .frame(dyn, t, pushers [{p, r}]) -> LPMesh   .list (plant spots: {kind, p, h, seed, base (index) | painted (rec)})
//   PLANT_KINDS                          brush kinds with display names

import { Geo, rgb, mixc, srand, voxelize } from './lpkit.js';

const GREENS = ['#2fa84a', '#3cc25a', '#58d468', '#8ae84a', '#1f8a5a', '#46b86e'];

const VCACHE = new Map();
// one plant's geometry at the origin (build mode thumbnails)
export function plantGeo(g, kind, h, k, seed) { (PLANTS[kind] || PLANTS.hair)(g, h, k, srand(seed)); return g; }

export const PLANT_KINDS = { hair: 'Hairgrass', moss: 'Moss Ball', sword: 'Sword Plant', fern: 'Java Fern', rotala: 'Rotala', vallis: 'Vallisneria', cabomba: 'Cabomba', kelp: 'Kelp' };

export class PlantField {
  constructor(T, tier, count, painted = [], hidden = null) {
    this.T = T;
    const rnd = srand(9001 + tier * 31);
    const k = Math.max(0.35, T.minDim / 30);
    const H = T.waterY - T.floorY(0, 0);
    const spots = [];
    let bi = 0;
    const add = (kind, u, v, h) => { const p = T.floorPoint(u, v, 1.2 * k); const s = { kind, p, h, seed: Math.floor(rnd() * 99999), sway: 0.6 + rnd() * 0.5, base: bi++ }; if (!hidden?.has(s.base)) spots.push(s); };
    const nBack = Math.max(1, Math.round(count * 0.42)), nSide = Math.round(count * 0.3), nFront = Math.max(1, count - nBack - nSide);
    const backKinds = tier >= 4 ? ['vallis', 'kelp', 'cabomba', 'vallis', 'rotala'] : ['vallis', 'cabomba', 'rotala', 'vallis'];
    for (let i = 0; i < nBack; i++) {
      const u = nBack === 1 ? 0.3 : 0.05 + (i + rnd() * 0.8) / nBack * 0.9;
      add(backKinds[i % backKinds.length], u, 0.82 + rnd() * 0.14, H * (0.55 + rnd() * 0.35));
    }
    for (let i = 0; i < nSide; i++) add(['sword', 'fern', 'rotala', 'sword'][i % 4], i % 2 ? 0.86 + rnd() * 0.1 : 0.04 + rnd() * 0.1, 0.3 + rnd() * 0.45, H * (0.3 + rnd() * 0.22));
    for (let i = 0; i < nFront; i++) add(i % 3 === 2 ? 'moss' : 'hair', 0.1 + rnd() * 0.8, 0.05 + rnd() * 0.4, H * (0.06 + rnd() * 0.06));
    for (const r of painted) {
      if (!PLANTS[r.k]) continue;
      const p = T.floorPoint(r.x, r.z, 0.8 * k);
      spots.push({ kind: r.k, p, h: H * r.h, seed: r.s, sway: 0.6 + (r.s % 50) / 100, painted: r });
    }
    this.list = spots;
    // rest geometry: each plant built, then voxelised (a budget of voxels shared by all plants keeps the sway cheap)
    const g = new Geo();
    const meta = []; // per vertex: [weight, plant index, amp, rootX, rootZ]
    const per = Math.max(260, Math.min(1500, Math.round(16000 / Math.max(1, spots.length))));
    const vs = Math.max(0.18, 0.42 * k);
    spots.forEach((s, si) => {
      const n0 = g.n;
      // each plant is voxelised once at the origin (cached), then dropped in at a grid-aligned spot
      const key = s.kind + '|' + s.seed + '|' + Math.round(s.h * 4) + '|' + Math.round(k * 50) + '|' + per;
      let loc = VCACHE.get(key);
      if (!loc) {
        const t = new Geo();
        t.rotY(srand(s.seed)() * 6.28);
        PLANTS[s.kind](t, s.h, k, srand(s.seed));
        const v = voxelize(t, vs, { maxCells: s.kind === 'moss' ? per * 0.5 : per, jitter: 0.1 });
        loc = v.d.slice(0, v.n);
        VCACHE.set(key, loc);
        if (VCACHE.size > 400) VCACHE.delete(VCACHE.keys().next().value);
      }
      const ox = Math.round(s.p[0] / vs) * vs, oy = Math.round((s.p[1] - 0.2) / vs) * vs, oz = Math.round(s.p[2] / vs) * vs;
      g.grow(loc.length);
      g.d.set(loc, g.n);
      for (let i = g.n; i < g.n + loc.length; i += 11) { g.d[i] += ox; g.d[i + 1] += oy; g.d[i + 2] += oz; }
      g.n += loc.length;
      const amp = s.sway * Math.min(3.5, s.h * 0.09) * (s.kind === 'hair' ? 0.6 : 1);
      for (let i = n0; i < g.n; i += 11) {
        const y = g.d[i + 1] - s.p[1];
        const w = Math.max(0, Math.min(1, y / Math.max(0.5, s.h)));
        meta.push(s.kind === 'moss' ? 0 : w, si, amp, s.p[0], s.p[2]);
      }
    });
    this.rest = g.d.slice(0, g.n);
    this.meta = new Float32Array(meta);
    this.count = g.n / 11;
  }

  frame(dyn, t, push = []) {
    const g = dyn.begin();
    g.grow(this.rest.length);
    const src = this.rest, M = this.meta, out = g.d;
    const n = this.count;
    out.set(src, 0);
    // per-plant sway this frame (two waves), then per vertex only multiply-adds
    const SX = this.sx || (this.sx = new Float32Array(this.list.length)), SZ = this.sz || (this.sz = new Float32Array(this.list.length));
    for (let k = 0; k < this.list.length; k++) {
      const ph = (this.list[k].seed % 628) / 100;
      SX[k] = Math.sin(t * 0.85 + ph) + 0.4 * Math.sin(t * 2.1 + ph * 2.3);
      SZ[k] = Math.cos(t * 0.7 + ph * 1.3) * 0.55;
    }
    // pushers (the swimmer, nearby fish) only bend plants they are actually close to
    const near = this.near || (this.near = this.list.map(() => []));
    for (let k = 0; k < this.list.length; k++) {
      const s = this.list[k], arr = near[k];
      arr.length = 0;
      for (const p of push) {
        const reach = p.r * 2.2 + s.h * 0.6;
        if (Math.abs(p.p[0] - s.p[0]) < reach && Math.abs(p.p[2] - s.p[2]) < reach && p.p[1] < s.p[1] + s.h + p.r * 2.2) arr.push(p);
      }
    }
    for (let v = 0; v < n; v++) {
      const w = M[v * 5];
      if (w <= 0) continue;
      const i = v * 11;
      const k = M[v * 5 + 1], amp = M[v * 5 + 2] * w * w * (1.6 - 0.6 * w);
      const y = src[i + 1];
      let dx = SX[k] * amp;
      let dz = SZ[k] * amp;
      const pk = near[k];
      for (let q = 0; q < pk.length; q++) {
        const p = pk[q];
        const ox = src[i] - p.p[0], oz = src[i + 2] - p.p[2], oy = y - p.p[1];
        const d2 = ox * ox + oz * oz + oy * oy * 0.5;
        const r = p.r * 2.2;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2) || 0.01, f = (1 - d / r) * w * p.r * 0.9;
        dx += ox / d * f; dz += oz / d * f;
      }
      out[i] = src[i] + dx; out[i + 2] = src[i + 2] + dz; out[i + 1] = y - (dx * dx + dz * dz) * 0.04;
    }
    g.n = this.rest.length;
    return dyn.end();
  }
}

// ------------------------------------------------------------------ plant builders (root at the origin, y up)
const grad = (a, b, n) => (i) => mixc(a, b, i / Math.max(1, n - 1));

function vallis(g, h, k, rnd) {
  const n = 5 + Math.floor(rnd() * 4);
  for (let b = 0; b < n; b++) {
    const a = rnd() * 6.28, lean = 0.05 + rnd() * 0.2, hh = h * (0.6 + rnd() * 0.45);
    const pts = [], side = [];
    const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, tw = a + t * 1.2;
      pts.push([Math.cos(a) * (lean * hh * t * t + 0.3 * k), t * hh, Math.sin(a) * (lean * hh * t * t + 0.3 * k)]);
      side.push([Math.cos(tw + 1.57), 0, Math.sin(tw + 1.57)]);
    }
    const base = GREENS[Math.floor(rnd() * 3)];
    g.blade(pts, pts.map((_, i) => (i === segs ? 0 : 0.75 * k * (1 - i / segs * 0.25))), grad(mixc(base, '#1a6a3a', 0.35), mixc(base, '#d8ff8a', 0.35), segs), side);
  }
}

function kelp(g, h, k, rnd) {
  const n = 2 + Math.floor(rnd() * 2);
  for (let b = 0; b < n; b++) {
    const a = rnd() * 6.28, hh = h * (0.8 + rnd() * 0.3);
    const pts = [], side = [], wid = [];
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, tw = a + Math.sin(t * 6 + b) * 0.5;
      pts.push([Math.cos(a) * t * hh * 0.08 + Math.sin(t * 9) * 0.6 * k, t * hh, Math.sin(a) * t * hh * 0.08]);
      side.push([Math.cos(tw + 1.57), 0.15 * Math.sin(t * 13), Math.sin(tw + 1.57)]);
      wid.push(i === segs ? 0.4 * k : (1.4 + Math.sin(t * 3.14) * 1.8 + (i % 2) * 0.5) * k);
    }
    g.blade(pts, wid, (i) => (i % 2 ? '#5ad46a' : '#3cb85a'), side);
    g.tube(pts.slice(0, 3), 0.18 * k, 4, '#2a8a4a', { caps: false });
  }
}

function sword(g, h, k, rnd) {
  const n = 8 + Math.floor(rnd() * 5);
  for (let b = 0; b < n; b++) {
    const a = (b / n) * 6.28 + rnd() * 0.4, out = 0.35 + rnd() * 0.3, hh = h * (0.7 + rnd() * 0.4);
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const r = (out * t + 0.1) * hh * 0.55, y = Math.sin(t * 1.7) * hh * 0.9;
      pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    const sd = [-Math.sin(a), 0, Math.cos(a)];
    g.blade(pts, [0.15, 1.1, 1.6, 1.5, 1.0, 0].map((w) => w * k * (h / 14 + 0.6)), grad('#2a9a3a', '#7ae05a', 6), sd);
  }
}

function fern(g, h, k, rnd) {
  g.push(); g.scale(1, 0.6, 1); g.rock(1.4 * k, Math.floor(rnd() * 99), '#7a6a5a'); g.pop();
  const n = 5 + Math.floor(rnd() * 3);
  for (let b = 0; b < n; b++) {
    const a = rnd() * 6.28, hh = h * (0.7 + rnd() * 0.4), lean = 0.15 + rnd() * 0.25;
    const pts = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push([Math.cos(a) * lean * hh * t, 0.6 * k + t * hh, Math.sin(a) * lean * hh * t]); }
    g.blade(pts, [0.3, 1.2, 1.5, 1.3, 0.8, 0].map((w) => w * k), grad('#1f6a3a', '#3caa4a', 6), [-Math.sin(a), 0, Math.cos(a)]);
  }
}

function rotala(g, h, k, rnd) {
  const n = 3 + Math.floor(rnd() * 3);
  for (let s = 0; s < n; s++) {
    const ox = (rnd() - 0.5) * 2 * k, oz = (rnd() - 0.5) * 2 * k, hh = h * (0.7 + rnd() * 0.35);
    const pts = [[ox, 0, oz], [ox + 0.3 * k, hh * 0.5, oz], [ox + 0.5 * k, hh, oz + 0.2 * k]];
    g.tube(pts, 0.12 * k, 4, '#3a8a3a', { caps: false });
    const leaves = Math.floor(hh / (1.1 * k));
    for (let i = 1; i <= leaves; i++) {
      const t = i / leaves, y = t * hh, a = i * 1.7;
      const c = t > 0.7 ? mixc('#7ae05a', '#ff6a8a', (t - 0.7) / 0.3) : '#5ac85a';
      for (const sgn of [1, -1]) {
        const dx = Math.cos(a) * sgn, dz = Math.sin(a) * sgn;
        const bx = ox + 0.4 * k * t, L = 1.1 * k * (1 - t * 0.3);
        g.blade([[bx, y, oz], [bx + dx * L * 0.6, y + 0.25 * k, oz + dz * L * 0.6], [bx + dx * L, y + 0.4 * k, oz + dz * L]], [0.2 * k, 0.55 * k, 0], c, [-dz, 0, dx]);
      }
    }
  }
}

function cabomba(g, h, k, rnd) {
  const n = 2 + Math.floor(rnd() * 3);
  for (let s = 0; s < n; s++) {
    const ox = (rnd() - 0.5) * 2.4 * k, oz = (rnd() - 0.5) * 2.4 * k, hh = h * (0.75 + rnd() * 0.3);
    g.tube([[ox, 0, oz], [ox, hh, oz + 0.3 * k]], 0.1 * k, 4, '#4aa84a', { caps: false });
    const whorls = Math.floor(hh / (1.6 * k));
    for (let i = 1; i <= whorls; i++) {
      const y = (i / whorls) * hh, R = 1.3 * k * (1 - i / whorls * 0.35);
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * 6.28 + i * 0.5;
        g.tri2([ox, y, oz], [ox + Math.cos(a) * R, y + 0.5 * k, oz + Math.sin(a) * R], [ox + Math.cos(a + 0.35) * R, y + 0.3 * k, oz + Math.sin(a + 0.35) * R], i % 2 ? '#8ae84a' : '#6ad45a');
      }
    }
  }
}

function hair(g, h, k, rnd) {
  const n = 10 + Math.floor(rnd() * 10);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.28, r = rnd() * 1.4 * k, hh = h * (0.5 + rnd() * 0.7);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, lean = (rnd() - 0.5) * 0.6 * k;
    g.tri2([x - 0.12 * k, 0, z], [x + 0.12 * k, 0, z], [x + lean, hh, z + lean * 0.5], i % 3 ? '#6ad45a' : '#a8f06a');
  }
}

function moss(g, h, k, rnd) {
  const r = Math.max(0.8 * k, h * 0.45);
  const old = g.jit; g.jit = 0.3; g.seed = Math.floor(rnd() * 999);
  g.push(); g.at(0, r * 0.8, 0); g.sphere(r, 1, '#3caa4a', { jit: 0.25, seed: g.seed }); g.pop();
  g.jit = old;
}

const PLANTS = { vallis, kelp, sword, fern, rotala, cabomba, hair, moss };
export { rgb };
