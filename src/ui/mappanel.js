// Travel map: a hand-built 3D voxel diorama of the whole ocean, cut like an aquarium slice and set on a wooden
// plinth. Six mini locations sit on / under a translucent water block whose glass front shows the depth zones.
// The diorama is ray-cast once per yaw angle by voxel.js (cached, pre-warmed in idle time after boot); a custom
// water pass then tints every pixel by the exact distance its view ray travels through water (hit voxels are
// recovered through renderVoxels' keepVoxel callback), adds caustics, surface waves and glass edges, and keeps a
// depth buffer so runtime effects (boat, fish, bubbles, sparkles) can be depth-tested against the bake.
// Drag / wheel / arrows rotate between the pre-rendered yaws; hover highlights a location (outline + info card),
// locked ones are fogged and chained with a requirement checklist. Travel sails the boat there, then
// game.travel(id) runs and the panel closes.

import { clamp, clamp01, lerp, ease, hash1, hash2, hash3, noise2, fbm2, bayer, smoothstep, TAU, formatCommas } from '../core/math.js';
import { rgba, shade, mix, hexToRgb } from '../core/color.js';
import { RNG } from '../core/rng.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawButton, drawWood, drawPaper, drawBar } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SKILLS, SKILL_BY_ID } from '../game/skills.js';
import { SPECIES } from '../fish/species.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- diorama geometry (voxels)
const M = 4, BX = 168, BZ = 100, NX = BX + 2 * M, NZ = BZ + 2 * M, NY = 100;
const XR = M + BX, ZF = M + BZ;             // water block x / z end (exclusive)
const Y0 = 6, SEA = 68;                     // plinth top, water surface plane (water fills y < SEA)
const PITCH = 32;
export const MAP_YAWS = [-40, -24, -8, 8, 24, 40];
const YAW0 = 4;
// stylised depth scale: metres -> voxel y
const DEPTH_KNOTS = [[0, SEA], [8, SEA - 6], [60, SEA - 14], [140, SEA - 24], [450, SEA - 38], [900, SEA - 46], [3200, Y0 + 2]];
function depthY(m) {
  for (let i = 0; i < DEPTH_KNOTS.length - 1; i++) {
    const [a, ya] = DEPTH_KNOTS[i], [b, yb] = DEPTH_KNOTS[i + 1];
    if (m <= b) return lerp(ya, yb, (m - a) / (b - a));
  }
  return Y0 + 2;
}
const ZONE1 = SEA - depthY(200), ZONE2 = SEA - depthY(1000); // sunlight / twilight / midnight boundaries (depth in voxels)

// ---------------------------------------------------------------- locations
// geo: block-local (u, w) centre, regional seabed height h, blend sigma s, territory radius rad
// pin / focus / sea: block-local [u, y, w] anchors (pin floats above, focus = what the leader line points at,
// sea = where the boat moors on the surface)
export const MAP_LOCATIONS = [
  {
    id: 'shallows', name: 'Sunny Shallows', sub: 'Crystal-clear tropical lagoon', depth: 8, color: '#ffc24a', skill: null,
    geo: { u: 24, w: 26, h: SEA - 6, s: 17, rad: 34 }, pin: [19, SEA + 17, 21], focus: [19, SEA + 6, 21], sea: [40, 22],
    desc: 'Warm, bright and friendly. Perfect for new anglers and very curious fish.',
    weathers: ['sunny', 'cloudy', 'rain', 'storm'],
  },
  {
    id: 'fjord', name: 'Frosty Fjord', sub: 'Glaciers, ice caves & auroras', depth: 60, color: '#8ae2ff', skill: 'exp7',
    geo: { u: 86, w: 18, h: SEA - 14, s: 15, rad: 34 }, pin: [87, SEA + 22, 14], focus: [87, SEA + 6, 14], sea: [87, 34],
    desc: 'Ice-cold, crystal water under shimmering northern lights. Frosty fish with frosty attitudes.',
    weathers: ['snowfall', 'aurora', 'seafog', 'blizzard'],
  },
  {
    id: 'junkyard', name: 'Junkyard Reef', sub: 'Where old computers go to sleep', depth: 140, color: '#a6e05a', skill: 'exp1',
    geo: { u: 30, w: 76, h: SEA - 24, s: 17, rad: 34 }, pin: [30, SEA + 3, 76], focus: [30, SEA - 16, 76], sea: [44, 97],
    desc: 'A reef of sunken hardware. Glitchy, mechanical and slightly rusty fish.',
    weathers: ['murky', 'static', 'oil', 'datarain'],
  },
  {
    id: 'metropolis', name: 'Sunken Metropolis', sub: 'A drowned neon city', depth: 450, color: '#ff6ae0', skill: 'exp8',
    geo: { u: 90, w: 77, h: SEA - 38, s: 17, rad: 34 }, pin: [87, SEA + 12, 78], focus: [87, SEA - 6, 78], sea: [106, 95],
    desc: 'Skyscrapers still glowing under 450 m of water. The fish here never sleep.',
    weathers: ['neonrain', 'blackout', 'static', 'rushhour'],
  },
  {
    id: 'volcano', name: 'Lava Rift', sub: 'Volcanic vents & magma glow', depth: 900, color: '#ff7a3a', skill: 'exp9',
    geo: { u: 146, w: 28, h: SEA - 46, s: 17, rad: 34 }, pin: [146, SEA + 35, 28], focus: [146, SEA + 23, 28], sea: [124, 44],
    desc: 'Black glass, boiling vents and rivers of magma. Fireproof fish only.',
    weathers: ['ashfall', 'eruption', 'heathaze', 'embers'],
  },
  {
    id: 'abyss', name: 'The Deep Ocean', sub: 'Something down here is watching', depth: 3200, color: '#8a9aff', skill: 'exp3',
    geo: { u: 146, w: 80, h: SEA - 32, s: 17, rad: 30 }, pin: [148, SEA + 4, 90], focus: [149, 16, 92], sea: [132, 95],
    desc: 'Pitch black and ancient. Bring a light. Bring courage. Bring snacks.',
    weathers: ['still', 'snow', 'current', 'glowtide'],
  },
];
const LOCS = MAP_LOCATIONS;
const LOC_BY_ID = Object.fromEntries(LOCS.map((L) => [L.id, L]));

const WEATHER = {
  sunny: ['sun', 'Sunny'], clear: ['sun', 'Clear'], cloudy: ['cloud', 'Cloudy'], rain: ['rain', 'Rain'], storm: ['storm', 'Storm'], calm: ['sun', 'Calm'],
  murky: ['cloud', 'Murky'], static: ['storm', 'Static Storm'], oil: ['cloud', 'Oil Slick'], datarain: ['rain', 'Data Rain'],
  still: ['moon', 'Still Water'], snow: ['cloud', 'Marine Snow'], current: ['arrow_r', 'Deep Current'], glowtide: ['sparkle', 'Glow Tide'],
  snowfall: ['cloud', 'Snowfall'], aurora: ['sparkle', 'Aurora'], seafog: ['cloud', 'Sea Fog'], blizzard: ['storm', 'Blizzard'],
  neonrain: ['rain', 'Neon Rain'], blackout: ['moon', 'Blackout'], rushhour: ['clock', 'Rush Hour'],
  ashfall: ['cloud', 'Ash Fall'], eruption: ['storm', 'Eruption'], heathaze: ['sun', 'Heat Haze'], embers: ['sparkle', 'Ember Storm'],
};

// ---------------------------------------------------------------- small geometry helpers
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function polyDist(px, py, pts) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}
const angAbs = (a, b) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);

// Implicit shape over a bounding box: test(x, y, z) at voxel centres.
function shape(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
  }
}

// Pointed prism from p0 along dir.
function shard(m, p0, dir, len, r, c) {
  const dl = Math.hypot(...dir), d = dir.map((v) => v / dl);
  const R = r + 1, end = [p0[0] + d[0] * len, p0[1] + d[1] * len, p0[2] + d[2] * len];
  shape(m, Math.min(p0[0], end[0]) - R, Math.min(p0[1], end[1]) - R, Math.min(p0[2], end[2]) - R, Math.max(p0[0], end[0]) + R, Math.max(p0[1], end[1]) + R, Math.max(p0[2], end[2]) + R, (x, y, z) => {
    const px = x - p0[0], py = y - p0[1], pz = z - p0[2];
    const t = px * d[0] + py * d[1] + pz * d[2];
    if (t < -0.5 || t > len) return false;
    const ex = px - d[0] * t, ey = py - d[1] * t, ez = pz - d[2] * t;
    const rr = t > len * 0.55 ? r * (len - t) / (len * 0.45) : r;
    return Math.abs(ex) + Math.abs(ey) * 0.6 + Math.abs(ez) <= rr * 1.25 && ex * ex + ey * ey + ez * ez <= rr * rr;
  }, c);
}

// Torus in the plane normal to `axis`, centred at (cx, cy, cz); arc(angle) limits the sweep.
function torus(m, cx, cy, cz, R, r, c, axis = 'y', arc = null) {
  const e = R + r + 1;
  shape(m, cx - e, cy - e, cz - e, cx + e, cy + e, cz + e, (x, y, z) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    let a, b, h;
    if (axis === 'y') { a = dx; b = dz; h = dy; } else if (axis === 'x') { a = dy; b = dz; h = dx; } else { a = dx; b = dy; h = dz; }
    if (arc && !arc(Math.atan2(b, a))) return false;
    const q = Math.hypot(a, b) - R;
    return q * q + h * h <= r * r;
  }, c);
}

// ---------------------------------------------------------------- the diorama model
const AUTO = 0, SAND = 1, GRASS = 2, ROCK = 3, SNOW = 4, ICE = 5, CREV = 6, BASALT = 7, LAVA = 8, LAVAHOT = 9, CRUST = 10, RIFT = 11, PLAZA = 12, ROAD = 13, ROADLINE = 14;
const CRACKS = [
  [[116, 30], [123, 37], [130, 40], [136, 46], [143, 47], [151, 44], [158, 48], [164, 47], [168, 50]],
  [[124, 12], [120, 19], [124, 27], [121, 33]],
];
const ROAD_U = [70, 81, 92, 103], ROAD_W = [62, 73, 84];
const VC = [146, 28]; // volcano centre (block-local)
const SMOKERS = [[118, 42, 7], [128, 52, 5], [163, 58, 8], [114, 26, 6], [136, 60, 4]];

// Terrain column height + surface material for block-local (u, w).
function landAt(u, w) {
  let ws = 0, hs = 0;
  for (const L of LOCS) {
    const g = L.geo, d2 = (u - g.u) ** 2 + (w - g.w) ** 2, k = Math.exp(-d2 / (2 * g.s * g.s)) + 1e-12;
    ws += k; hs += k * g.h;
  }
  let h = Math.round((hs / ws + (fbm2(u * 0.05, w * 0.05, 3, 5) - 0.5) * 7) / 2) * 2;
  const base = h;
  let mt = AUTO;
  // --- shallows: sandy island with a grassy hill, sand shelf around it
  {
    const du = u - 20, dw = w - 22, r = Math.hypot(du, dw), a = Math.atan2(dw, du);
    const R = 11.5 + (noise2(Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 + 7, 3) - 0.5) * 6, rr = r / R;
    if (rr < 2.1) {
      const shelf = Math.round(lerp(SEA - 2, h, smoothstep(1.0, 2.0, rr)));
      if (shelf > h) h = shelf;
      if (rr < 1.5) mt = SAND;
      if (rr < 1.02) h = Math.max(h, SEA);
      const rh = Math.hypot(u - 17, w - 19) / 7.5;
      if (rh < 1) {
        h = Math.max(h, SEA + 1 + Math.round(5 * (1 - rh * rh) + (noise2(u * 0.3, w * 0.3, 9) - 0.5) * 2));
        if (rh < 0.82) mt = GRASS;
      }
    }
  }
  // --- fjord: two snowy mountains + back ridge, channel carved between, glacier at the channel head
  {
    const mtn = (cu, cw, R, peak) => {
      const r = Math.hypot(u - cu, w - cw) / R;
      if (r >= 1) return -99;
      return SEA - 20 + (peak - SEA + 20) * Math.pow(1 - r, 1.2) + (fbm2(u * 0.11, w * 0.11, 3, 21) - 0.5) * 12 * (1 - r);
    };
    let mh = Math.max(mtn(63, 4, 27, SEA + 28), mtn(111, 5, 25, SEA + 22), mtn(87, -8, 22, SEA + 19));
    const cu = 87 + Math.sin(w * 0.15) * 1.5, cd = Math.abs(u - cu);
    if (w < 52) mh = Math.min(mh, lerp(SEA - 14, mh, smoothstep(5, 12, cd)));
    if (mh > h) {
      h = Math.round(mh);
      mt = h > SEA + 12 + (noise2(u * 0.2, w * 0.2, 4) - 0.5) * 7 ? SNOW : ROCK;
    }
    if (w < 20) {
      const gw = 8.5 - w * 0.12, side = smoothstep(gw, gw + 3.5, cd);
      const gt = SEA + 15 - w * 0.55 + (noise2(u * 0.25, w * 0.25, 6) - 0.5) * 1.5 - cd * 0.12;
      const gh = Math.round(lerp(gt, Math.max(h, gt - 6), side));
      if (side < 0.85 && gh >= h - 1) {
        h = Math.max(h, gh);
        mt = w < 5 + noise2(u * 0.3, 1, 2) * 3 ? SNOW : (w + Math.sin(u * 0.7) * 1.4 + 40) % 5 < 0.9 ? CREV : ICE;
      }
    }
  }
  // --- lava rift: volcano cone (cut by the right face), lava streams, glowing cracks in the seabed
  {
    const du = u - VC[0], dw = w - VC[1], r = Math.hypot(du, dw);
    if (r < 38) {
      const Rc = 5, Rr = Rc + 1.8, Rw = 18, top = SEA + 22;
      let vh;
      if (r < Rc) vh = top - 2;
      else if (r < Rr) vh = top + 1;
      else if (r < Rw) vh = top - (top - SEA) * Math.pow((r - Rr) / (Rw - Rr), 0.85);
      else vh = SEA - 46 * Math.pow((r - Rw) / (38 - Rw), 0.7);
      vh += (fbm2(u * 0.17, w * 0.17, 2, 33) - 0.5) * 4 * Math.min(1, r / 9);
      if (vh > h) {
        h = Math.round(vh);
        mt = r < Rc ? LAVAHOT : BASALT;
        if (r >= Rc) {
          const a = Math.atan2(dw, du);
          for (const [sa, len, ph] of [[2.3, 24, 0], [1.55, 21, 2], [3.0, 19, 4]]) {
            const off = angAbs(a, sa + Math.sin(r * 0.32 + ph) * 0.16) * r;
            const wd = 1.7 - (r / len) * 0.6;
            if (r < len && off < wd) mt = off < wd * 0.45 ? LAVAHOT : LAVA;
            else if (r < len + 1.5 && off < wd + 1 && mt === BASALT) mt = CRUST;
          }
        }
      }
    }
    if (u > 110 && w < 60) {
      const cd = Math.min(polyDist(u, w, CRACKS[0]), polyDist(u, w, CRACKS[1]));
      if (cd < 2.3 && h < SEA - 30) {
        if (cd < 0.85) { mt = RIFT; h -= 1; } else mt = CRUST;
      }
    }
  }
  // --- metropolis: flattened city floor with a road grid
  {
    const r = Math.hypot(u - 90, w - 77);
    if (r < 30) {
      h = Math.round(lerp(SEA - 38, h, smoothstep(19, 29, r)));
      if (r < 23) {
        mt = PLAZA;
        for (const ru of ROAD_U) if (u >= ru && u <= ru + 1) mt = u === ru && w % 4 < 2 ? ROADLINE : ROAD;
        for (const rw of ROAD_W) if (w >= rw && w <= rw + 1) mt = w === rw && u % 4 < 2 ? ROADLINE : ROAD;
      }
    }
  }
  // --- abyss trench, cut through the front face
  {
    const cu = 147 + Math.sin(w * 0.09) * 3.5, d = Math.abs(u - cu);
    const head = smoothstep(44, 60, w);
    if (head > 0 && d < 22) {
      let th = lerp(Y0 + 2, h, smoothstep(5, 20, d));
      th = Math.floor((th - Y0 - 2) / 3) * 3 + Y0 + 2;
      th = Math.round(lerp(h, th, head));
      if (th < h) { h = th; if (mt === RIFT || mt === CRUST) mt = AUTO; }
    }
  }
  return [h, mt, base];
}

function buildDiorama() {
  const t0 = performance.now();
  const m = new VoxelModel(NX, NY, NZ);
  const own = new Uint8Array(256);
  const pc = new Map();
  const P = (hex, opts = {}, o = 0) => {
    const key = hex + '|' + o + '|' + JSON.stringify(opts);
    let i = pc.get(key);
    if (i === undefined) { i = m.color(hex, opts); own[i] = o; pc.set(key, i); }
    return i;
  };
  const LI = {};
  LOCS.forEach((L, i) => (LI[L.id] = i + 1));
  const NC = NX * NZ;
  const hm = new Int16Array(NC).fill(-1), mat = new Uint8Array(NC), base = new Int16Array(NC), terr = new Uint8Array(NC);
  const ci = (x, z) => x + NX * z;

  // ------------------------------------------------ heightfield + territory
  for (let w = 0; w < BZ; w++) for (let u = 0; u < BX; u++) {
    const i = ci(u + M, w + M);
    const [h, mt, b] = landAt(u, w);
    hm[i] = clamp(h, Y0 + 1, NY - 2); mat[i] = mt; base[i] = b;
    let best = 1, bd = 1e9;
    LOCS.forEach((L, k) => {
      const g = L.geo;
      const d = Math.hypot(u - g.u, w - g.w) / g.rad + (noise2(u * 0.09, w * 0.09, k * 7 + 1) - 0.5) * 0.22;
      if (d < bd) { bd = d; best = k + 1; }
    });
    terr[i] = best;
  }

  // ------------------------------------------------ palettes
  const SURF = {
    shallows: ['#ecd49a', '#dcc28a'], fjord: ['#7e889c', '#6a7488'], junkyard: ['#8c8270', '#7a705e'],
    metropolis: ['#566c78', '#4a5e6a'], volcano: ['#4c4250', '#3c3442'], abyss: ['#45427a', '#38356a'],
  };
  const TP = {};
  for (const L of LOCS) {
    const s = SURF[L.id];
    TP[L.id] = { a: P(s[0], { jitter: 0.24 }), b: P(s[1], { jitter: 0.24 }), sub: P(shade(s[0], -0.24), { jitter: 0.2 }) };
  }
  const o = LI;
  const LF = {
    sand: P('#f2da9e', { jitter: 0.18 }, o.shallows), sand2: P('#e4c88a', { jitter: 0.18 }, o.shallows), sandD: P('#c8a874', { jitter: 0.15 }, o.shallows),
    grass: P('#6ccc58', { jitter: 0.2 }, o.shallows), grass2: P('#4cae4c', { jitter: 0.2 }, o.shallows),
    rock: P('#7a8498', { jitter: 0.22 }, o.fjord), rock2: P('#646e84', { jitter: 0.22 }, o.fjord), rockD: P('#4e566c', { jitter: 0.2 }, o.fjord),
    snow: P('#f2f8fc', { jitter: 0.08 }, o.fjord), ice: P('#b8e0f2', { jitter: 0.12, spec: 0.3 }, o.fjord), crev: P('#5aa2d2', { jitter: 0.08 }, o.fjord),
    basalt: P('#3c3446', { jitter: 0.2 }, o.volcano), ash: P('#5c5262', { jitter: 0.2 }, o.volcano), basaltD: P('#2a2432', { jitter: 0.15 }, o.volcano),
    lava: P('#ff6a1c', { emissive: 1, jitter: 0.1 }, o.volcano), lavaHot: P('#ffc63a', { emissive: 1, jitter: 0.1 }, o.volcano),
    crust: P('#6a2c24', { emissive: 0.25, jitter: 0.2 }, o.volcano), rift: P('#ff8a2c', { emissive: 1, jitter: 0.1 }, o.volcano),
    plaza: P('#5e6e78', { jitter: 0.12 }, o.metropolis), road: P('#2e3440', { jitter: 0.08 }, o.metropolis),
    roadLine: P('#ffd25a', { emissive: 0.7 }, o.metropolis), metroD: P('#3e4a54', { jitter: 0.1 }, o.metropolis),
  };
  const ST = {
    hi: [P('#c49e6c', { jitter: 0.14 }), P('#ae885c', { jitter: 0.14 }), P('#d6b47e', { jitter: 0.14 })],
    mid: [P('#8c7c74', { jitter: 0.14 }), P('#786a6a', { jitter: 0.14 }), P('#9c8c80', { jitter: 0.14 })],
    lo: [P('#5c5274', { jitter: 0.14 }), P('#4c4466', { jitter: 0.14 }), P('#3e3858', { jitter: 0.14 })],
    bed: P('#2c2642', { jitter: 0.1 }),
  };
  const strata = (u, w, y) => {
    if (y <= Y0) return ST.bed;
    const wy = y + (fbm2(u * 0.035 + 3, w * 0.035, 2, 77) - 0.5) * 9 + (hash3(u, y, w, 5) - 0.5) * 1.1;
    const band = Math.floor(wy / 3);
    const set = wy > 46 ? ST.hi : wy > 26 ? ST.mid : ST.lo;
    return set[((band % 3) + 3) % 3];
  };
  const surfColor = (mt, tr, u, w, y) => {
    const patch = noise2(u * 0.16, w * 0.16, 12) > 0.56;
    switch (mt) {
      case SAND: return patch ? LF.sand2 : LF.sand;
      case GRASS: return hash2(u, w, 4) < 0.35 ? LF.grass2 : LF.grass;
      case ROCK: return patch || hash2(u, w, 2) < 0.25 ? LF.rock2 : LF.rock;
      case SNOW: return LF.snow;
      case ICE: return LF.ice;
      case CREV: return LF.crev;
      case BASALT: return (y + noise2(u * 0.2, w * 0.2, 8) * 3) % 5 < 1.6 ? LF.ash : LF.basalt;
      case LAVA: return LF.lava;
      case LAVAHOT: return LF.lavaHot;
      case CRUST: return LF.crust;
      case RIFT: return LF.rift;
      case PLAZA: return LF.plaza;
      case ROAD: return LF.road;
      case ROADLINE: return LF.roadLine;
      default: return patch ? TP[tr].b : TP[tr].a;
    }
  };
  const subColor = (mt, tr, u, w, y) => {
    if (mt === SAND || mt === GRASS) return LF.sandD;
    if (mt === ROCK || mt === SNOW || mt === ICE || mt === CREV) return mt === ICE || mt === CREV ? LF.ice : LF.rockD;
    if (mt >= BASALT && mt <= RIFT) return (y + hash2(u, w, 1) * 2) % 4 < 1 ? LF.ash : LF.basaltD;
    if (mt >= PLAZA) return LF.metroD;
    return TP[tr].sub;
  };

  // ------------------------------------------------ plinth (dark wood + brass trim)
  const wood = P('#6e4428', { jitter: 0.1 }), woodD = P('#4c2c1a', { jitter: 0.1 }), woodL = P('#94603a', { jitter: 0.1 });
  const brass = P('#e2b250', { spec: 0.9, jitter: 0.04 }), brassD = P('#a8762a', { jitter: 0.04 });
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const edge = x === 0 || z === 0 || x === NX - 1 || z === NZ - 1;
    for (let y = 0; y < Y0; y++) {
      let c = (x * 0.9 + z * 0.35 + noise2(x * 0.15, z * 0.6, 3) * 6) % 7 < 2 ? woodD : wood;
      if (y === Y0 - 1) c = edge ? brass : woodL;
      else if (y === 0) c = edge ? brassD : woodD;
      else if (y === 2 && edge) c = woodD;
      m.set(x, y, z, c);
    }
  }
  // brass name plate on the front of the plinth
  for (let x = NX / 2 - 16; x <= NX / 2 + 15; x++) for (let y = 1; y <= 4; y++) {
    const border = x === NX / 2 - 16 || x === NX / 2 + 15 || y === 1 || y === 4;
    m.set(x, y, NZ - 1, border ? brassD : brass);
  }

  // ------------------------------------------------ terrain fill
  for (let w = 0; w < BZ; w++) for (let u = 0; u < BX; u++) {
    const i = ci(u + M, w + M), top = hm[i], mt = mat[i], tr = LOCS[terr[i] - 1].id, b0 = base[i];
    for (let y = Y0; y <= top; y++) {
      const d = top - y;
      let c;
      if (d === 0) c = surfColor(mt, tr, u, w, y);
      else if (d <= 2 + (hash2(u, w, 3) < 0.5 ? 1 : 0) || (mt !== AUTO && y > b0 - 2)) c = subColor(mt, tr, u, w, y);
      else c = strata(u, w, y);
      m.set(u + M, y, w + M, c);
    }
  }

  const ground = (u, w) => {
    const x = Math.round(u) + M, z = Math.round(w) + M;
    for (let y = NY - 1; y >= 0; y--) if (m.get(x, y, z)) return y;
    return Y0;
  };
  const ctx = { m, P, LI, hm, mat, ground, ci };
  buildShallows(ctx, o.shallows);
  buildFjord(ctx, o.fjord);
  buildVolcano(ctx, o.volcano);
  buildJunkyard(ctx, o.junkyard);
  buildMetropolis(ctx, o.metropolis);
  buildAbyss(ctx, o.abyss);
  buildFaceArt(ctx);

  // ------------------------------------------------ column tops + screen extents per yaw (for layout)
  const top = new Int16Array(NC).fill(-1);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    for (let y = NY - 1; y >= 0; y--) if (m.get(x, y, z)) { top[ci(x, z)] = y; break; }
  }
  const C = [NX / 2, Y0, NZ / 2];
  const ext = { left: 0, right: 0, up: 0, down: 0 };
  for (const yaw of MAP_YAWS) {
    const { R, U } = camVec(yaw);
    for (let z = 0; z < NZ; z += 1) for (let x = 0; x < NX; x += 1) {
      const ty = top[ci(x, z)];
      if (ty < 0) continue;
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (const yy of [0, ty + 1]) {
        const px = x + dx - C[0], py = yy - C[1], pz = z + dz - C[2];
        const sx = px * R[0] + py * R[1] + pz * R[2], sy = -(px * U[0] + py * U[1] + pz * U[2]);
        if (-sx > ext.left) ext.left = -sx; if (sx > ext.right) ext.right = sx;
        if (-sy > ext.up) ext.up = -sy; if (sy > ext.down) ext.down = sy;
      }
    }
  }
  // 'plain' = unowned palette entries that are not seabed surface (strata, plinth, buried treasures)
  const plain = new Uint8Array(256), surfSet = new Set(Object.values(TP).flatMap((q) => [q.a, q.b]));
  for (let i = 1; i < m.palette.length; i++) plain[i] = own[i] === 0 && !surfSet.has(i) ? 1 : 0;
  return { model: m, own, plain, terr, LI, ext, C, ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- location models
function buildShallows({ m, P, ground }, o) {
  const rng = new RNG(4101);
  const X = (u) => u + M, Z = (w) => w + M;
  const trunk = P('#b8844a', { jitter: 0.1 }, o), trunk2 = P('#8e5e30', { jitter: 0.1 }, o);
  const leaf = P('#5ed052', { jitter: 0.14 }, o), leaf2 = P('#3a9e48', { jitter: 0.12 }, o), nut = P('#6a4626', {}, o);
  // palms
  const palm = (u, w, h, lx, lz) => {
    const x = X(u) + 0.5, z = Z(w) + 0.5, y = ground(u, w) + 1;
    const pts = [];
    for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push([x + lx * t * t * h * 0.4, y + t * h, z + lz * t * t * h * 0.4, 0.95]); }
    m.tube(pts, (xx, yy) => (yy % 2 ? trunk : trunk2), 3);
    const tp = pts[4];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.35 + rng.float(-0.15, 0.15), len = 5.5 + (k % 2) * 1.8;
      const fp = [];
      for (let j = 0; j <= 5; j++) { const t = j / 5; fp.push([tp[0] + Math.cos(a) * len * t, tp[1] + 1 + t * 1.8 - t * t * 4.6, tp[2] + Math.sin(a) * len * t, 0.7]); }
      m.tube(fp, (xx, yy, zz) => (hash3(xx, yy, zz, 3) < 0.35 || yy < tp[1] - 1 ? leaf2 : leaf), 3);
    }
    m.sphere(tp[0] + 0.9, tp[1] - 0.6, tp[2] + 0.5, 0.9, nut);
    m.sphere(tp[0] - 0.6, tp[1] - 0.9, tp[2] + 0.9, 0.9, nut);
  };
  palm(14, 18, 10, -0.6, -0.3);
  palm(21, 15, 12, 0.3, -0.5);
  palm(12, 28, 8, -0.7, 0.6);
  palm(26, 25, 9, 0.7, 0.4);
  // beach hut with a straw roof
  {
    const hw = P('#c8904e', { jitter: 0.12 }, o), hwD = P('#8a5a30', {}, o), straw = P('#ecc85a', { jitter: 0.2 }, o), straw2 = P('#c8a03c', { jitter: 0.2 }, o);
    const u0 = 22, w0 = 19, y = ground(24, 21) + 1;
    m.box(X(u0), y, Z(w0), X(u0 + 4), y + 3, Z(w0 + 4), hw);
    m.box(X(u0 + 2), y, Z(w0 + 4), X(u0 + 2), y + 2, Z(w0 + 4), hwD);
    m.box(X(u0 + 4), y + 2, Z(w0 + 2), X(u0 + 4), y + 2, Z(w0 + 2), hwD);
    for (let k = 0; k < 4; k++) m.box(X(u0 - 1 + k), y + 4 + k, Z(w0 - 1 + k), X(u0 + 5 - k), y + 4 + k, Z(w0 + 5 - k), (xx, yy, zz) => ((xx + zz + yy) % 3 ? straw : straw2));
  }
  // pier out into the lagoon
  {
    const pw = P('#a8784a', { jitter: 0.1 }, o), pw2 = P('#8a603a', { jitter: 0.1 }, o), post = P('#5a3c24', {}, o);
    for (let w = 30; w <= 45; w++) {
      m.box(X(24), SEA, Z(w), X(26), SEA, Z(w), w % 2 ? pw : pw2);
      if (w % 4 === 1 || w === 45) for (const u of [24, 26]) m.box(X(u), ground(u, w) + 1 > SEA ? SEA : ground(u, w) + 1, Z(w), X(u), SEA - 1, Z(w), post);
    }
  }
  // beach umbrella + towel
  {
    const pole = P('#f4f0e6', {}, o), red = P('#ff5a4a', { jitter: 0.06 }, o), towel = P('#4ab0ff', {}, o);
    const u = 10, w = 22, y = ground(u, w) + 1;
    m.box(X(u), y, Z(w), X(u), y + 5, Z(w), pole);
    shape(m, X(u) - 5, y + 4, Z(w) - 5, X(u) + 5, y + 7, Z(w) + 5, (x, yy, z) => {
      const dx = x - X(u) - 0.5, dz = z - Z(w) - 0.5, r = Math.hypot(dx, dz);
      return r < 4.3 && Math.abs(yy - (y + 7 - r * 0.55)) < 0.6;
    }, (x, yy, z) => (Math.floor(((Math.atan2(z - Z(w) - 0.5, x - X(u) - 0.5) + Math.PI) / TAU) * 8) % 2 ? red : pole));
    m.box(X(u + 2), ground(u + 3, w + 1) + 1, Z(w + 1), X(u + 4), ground(u + 3, w + 1) + 1, Z(w + 2), towel);
  }
  // coral reef ring in the lagoon
  const pink = P('#ff7aa8', { jitter: 0.12 }, o), pinkD = P('#d8507e', {}, o), orange = P('#ff9a44', { jitter: 0.12 }, o), orangeL = P('#ffc87a', {}, o);
  const purple = P('#b46aff', { jitter: 0.12 }, o), yellow = P('#ffd84a', { jitter: 0.12 }, o), grass = P('#48b45a', { jitter: 0.15 }, o);
  const star = P('#ff6a3a', {}, o), anem = P('#5ad8b8', {}, o), anemT = P('#ff8ad0', {}, o);
  const placed = [];
  for (let n = 0, tries = 0; n < 34 && tries < 400; tries++) {
    const a = rng.float(0, TAU), r = rng.float(12.5, 27);
    const u = 20 + Math.cos(a) * r * 1.1, w = 22 + Math.sin(a) * r;
    if (u < 2 || u > 50 || w < 2 || w > 46 || (u > 22 && u < 28 && w > 28)) continue;
    const gy = ground(u, w);
    if (gy > SEA - 3 || gy < SEA - 14) continue;
    if (placed.some(([pu, pw]) => Math.hypot(pu - u, pw - w) < 3.6)) continue;
    placed.push([u, w]);
    n++;
    const x = X(Math.round(u)) + 0.5, z = Z(Math.round(w)) + 0.5, y = gy + 1;
    const kind = rng.int(0, 5);
    if (kind === 0) m.sphere(x, y + 1.2, z, rng.float(1.8, 2.6), (xx, yy, zz) => ((xx + zz * 2 + yy) % 3 === 0 ? pinkD : pink));
    else if (kind === 1) {
      for (let b = 0; b < 5; b++) {
        const ba = rng.float(0, TAU), h = rng.float(2.5, 5);
        m.tube([[x, y, z, 0.8], [x + Math.cos(ba) * 1.2, y + h * 0.55, z + Math.sin(ba) * 1.2, 0.7], [x + Math.cos(ba) * 2.2, y + h, z + Math.sin(ba) * 2.2, 0.6]], (xx, yy) => (yy >= y + h - 1 ? orangeL : orange), 2);
      }
    } else if (kind === 2) {
      const fa = rng.float(0, Math.PI);
      for (let i = -3; i <= 3; i++) for (let j = 0; j <= 5; j++) {
        if ((i / 3.3) ** 2 + ((j - 2.6) / 2.8) ** 2 > 1) continue;
        if ((i + j) % 2 && Math.abs(i) < 3 && j > 0 && j < 5) continue;
        m.put(Math.floor(x + Math.cos(fa) * i), y + j, Math.floor(z + Math.sin(fa) * i), purple);
      }
    } else if (kind === 3) {
      for (let k = 0; k < 3; k++) {
        const tx = x + rng.float(-1.5, 1.5), tz = z + rng.float(-1.5, 1.5), th = rng.int(3, 5);
        m.cylinder(tx, tz, y, y + th, 1, yellow);
        m.sub(() => m.set(Math.floor(tx), y + th, Math.floor(tz), 0));
      }
    } else if (kind === 4) {
      for (let k = 0; k < 6; k++) {
        const gx = x + rng.float(-2, 2), gz = z + rng.float(-2, 2), gh = rng.int(2, 4);
        m.line(gx, y, gz, gx + rng.float(-0.6, 0.6), y + gh, gz, grass);
      }
    } else {
      m.sphere(x, y + 0.6, z, 1.4, anem);
      for (let k = 0; k < 5; k++) m.put(Math.floor(x + Math.cos(k * 1.3) * 1.4), y + 2, Math.floor(z + Math.sin(k * 1.3) * 1.4), anemT);
    }
  }
  // starfish on the sand shelf
  for (const [u, w] of [[33, 30], [8, 36], [30, 8]]) {
    const gy = ground(u, w) + 1, x = X(u), z = Z(w);
    m.set(x, gy, z, star);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; for (let r = 1; r <= 2; r++) m.put(Math.round(x + Math.cos(a) * r), gy, Math.round(z + Math.sin(a) * r), star); }
  }
}

function buildFjord({ m, P, ground, hm, mat, ci }, o) {
  const rng = new RNG(5202);
  const X = (u) => u + M, Z = (w) => w + M;
  const pine = P('#2e6c50', { jitter: 0.12 }, o), pine2 = P('#22583e', { jitter: 0.12 }, o), snow = P('#f2f8fc', { jitter: 0.08 }, o), bark = P('#5a3e2a', {}, o);
  // pines on the lower slopes
  const trees = [];
  for (let tries = 0; tries < 900 && trees.length < 22; tries++) {
    const u = rng.int(36, 136), w = rng.int(1, 46);
    const i = ci(X(u), Z(w)), h = hm[i];
    if (mat[i] !== 3 || h < SEA + 1 || h > SEA + 13) continue;
    if (trees.some(([a, b]) => Math.hypot(a - u, b - w) < 4.2)) continue;
    trees.push([u, w]);
    const x = X(u) + 0.5, z = Z(w) + 0.5, y = h + 1, th = rng.int(6, 9);
    m.box(X(u), y, Z(w), X(u), y + 1, Z(w), bark);
    for (let tier = 0; tier < 3; tier++) {
      const ty = y + 1 + tier * (th / 4), r0 = 2.6 - tier * 0.6;
      m.cone(x, z, ty, ty + th / 3 + 1, r0, 0.3, (xx, yy, zz) => (yy >= ty + th / 3 - 0.2 && hash3(xx, yy, zz, 1) < 0.7 ? snow : (xx + zz) % 3 ? pine : pine2));
    }
    m.set(X(u), Math.round(y + th + 0.5), Z(w), snow);
  }
  // red fisherman's cabin on the shore
  {
    const red = P('#c03a30', { jitter: 0.1 }, o), trim = P('#f2ece0', {}, o), roof = P('#3a3e4c', { jitter: 0.1 }, o), win = P('#ffd98a', { emissive: 0.7 }, o);
    let best = null;
    for (let w = 14; w <= 30; w++) for (let u = 66; u <= 80; u++) {
      const h = hm[ci(X(u), Z(w))];
      if (h < SEA || h > SEA + 3) continue;
      let flat = true;
      for (let a = 0; a < 6 && flat; a++) for (let b = 0; b < 5; b++) if (Math.abs(hm[ci(X(u + a), Z(w + b))] - h) > 2) { flat = false; break; }
      if (flat && (!best || w > best[1])) best = [u, w, h];
    }
    if (best) {
      const [u, w, h] = best, y = h + 1;
      m.box(X(u), h - 1, Z(w), X(u + 5), h, Z(w + 4), roof);
      m.box(X(u), y, Z(w), X(u + 5), y + 3, Z(w + 4), red);
      for (const [a, b] of [[0, 0], [5, 0], [0, 4], [5, 4]]) m.box(X(u + a), y, Z(w + b), X(u + a), y + 3, Z(w + b), trim);
      m.box(X(u + 2), y + 1, Z(w + 4), X(u + 3), y + 2, Z(w + 4), win);
      m.box(X(u + 5), y + 1, Z(w + 2), X(u + 5), y + 2, Z(w + 2), win);
      for (let k = 0; k < 3; k++) m.box(X(u - 1), y + 4 + k, Z(w - 1 + k), X(u + 6), y + 4 + k, Z(w + 5 - k), k === 2 ? snow : roof);
      m.box(X(u + 4), y + 5, Z(w + 1), X(u + 4), y + 7, Z(w + 1), trim);
    }
  }
  // icebergs drifting down the channel
  const berg = P('#f0faff', { jitter: 0.08, spec: 0.3 }, o), bergB = P('#9ed8f2', { jitter: 0.08 }, o);
  for (const [u, w, r] of [[85, 27, 3.8], [91, 37, 2.8], [83, 45, 2.3], [96, 52, 1.8]]) {
    const x = X(u) + 0.5, z = Z(w) + 0.5;
    shape(m, x - r - 1, SEA - r, z - r - 1, x + r + 1, SEA + 3, z + r + 1, (xx, yy, zz) => {
      const d = ((xx - x) / r) ** 2 + ((yy - SEA + 0.5) / (r * 0.9)) ** 2 + ((zz - z) / (r * 0.85)) ** 2;
      return d < 1 + (hash3(xx, yy, zz, 9) - 0.5) * 0.3 && yy < SEA + 1.6 + (r > 3 ? 1 : 0);
    }, (xx, yy) => (yy >= SEA ? berg : bergB));
  }
  // ice cave in the glacier front
  {
    const cx = X(87) + 0.5, cy = SEA - 1.5, cz = Z(19.5);
    m.sub(() => m.ellipsoid(cx, cy, cz, 4.5, 4.2, 4.5));
    const glow = P('#86e8ff', { emissive: 0.45, jitter: 0.1 }, o);
    m.recolor((x, y, z) => (Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.1, z + 0.5 - cz) < 6.2 && m.exposed(x, y, z) ? glow : null));
  }
}

function buildVolcano({ m, P, ground }, o) {
  const rng = new RNG(6303);
  const X = (u) => u + M, Z = (w) => w + M;
  const smoker = P('#2c2632', { jitter: 0.15 }, o), smokerT = P('#ffa640', { emissive: 0.95 }, o), obsidian = P('#1e1a2c', { spec: 0.9, specPow: 12, jitter: 0.06 }, o);
  const chamber = P('#ff5a14', { emissive: 1, jitter: 0.15 }, o), conduit = P('#ffb43a', { emissive: 1, jitter: 0.1 }, o);
  // black smokers around the base
  for (const [u, w, h] of SMOKERS) {
    const gy = ground(u, w);
    const x = X(u) + 0.5, z = Z(w) + 0.5;
    m.cone(x, z, gy - 1, gy + h, 1.9, 1.1, smoker);
    m.cylinder(x, z, gy + h, gy + h, 0.9, smokerT);
  }
  // obsidian shards jutting from the flanks
  for (let k = 0; k < 9; k++) {
    const a = rng.float(1.2, 3.6), r = rng.float(10, 24);
    const u = VC[0] + Math.cos(a) * r, w = VC[1] + Math.sin(a) * r;
    if (u < 2 || u > BX - 2 || w < 1 || w > BZ - 1) continue;
    const gy = ground(u, w);
    shard(m, [X(u) + 0.5, gy, Z(w) + 0.5], [Math.cos(a) * 0.5 + rng.float(-0.3, 0.3), 1, Math.sin(a) * 0.5], rng.float(4, 7), rng.float(1, 1.5), obsidian);
  }
  // magma chamber + conduit, exposed by the right-hand cut face
  m.paint(() => {
    m.ellipsoid(XR - 3, 17, Z(27), 9, 6.5, 12, chamber);
    m.tube([[XR - 1.5, 20, Z(28), 2], [XR - 1.5, 34, Z(26), 1.7], [XR - 2.5, 46, Z(29), 1.6], [X(156), 60, Z(28), 1.5], [X(149), 78, Z(28), 1.4], [X(VC[0]), SEA + 21, Z(28), 1.4]], conduit, 4);
    m.tube([[XR - 1, 22, Z(17), 0.8], [XR - 1, 30, Z(11), 0.7], [XR - 1, 38, Z(8), 0.6]], conduit, 3);
    m.tube([[XR - 1, 24, Z(37), 0.8], [XR - 1, 33, Z(43), 0.7], [XR - 1, 40, Z(42), 0.6]], conduit, 3);
  });
}

function buildJunkyard({ m, P, ground }, o) {
  const rng = new RNG(7404);
  const X = (u) => u + M, Z = (w) => w + M;
  const soil = P('#6a6050', { jitter: 0.2 }, o);
  const beige = P('#dccfb0', { jitter: 0.08 }, o), beige2 = P('#b4a686', { jitter: 0.08 }, o), screen = P('#1c2c2a', {}, o);
  const glowG = P('#5affa0', { emissive: 0.75 }, o), glowB = P('#6ac8ff', { emissive: 0.75 }, o), gun = P('#5a6072', { jitter: 0.08 }, o);
  const tire = P('#2a2a30', { jitter: 0.06 }, o), barrelY = P('#eab430', { jitter: 0.1 }, o), barrelR = P('#b4552e', { jitter: 0.1 }, o), hoop = P('#3a3a40', {}, o);
  const rust = P('#94502c', { jitter: 0.2 }, o), led = P('#7aff7a', { emissive: 1 }, o);
  const cases = [P('#3ab4d8', { jitter: 0.06, spec: 0.4 }, o), P('#ff8a3a', { jitter: 0.06, spec: 0.4 }, o), P('#a870e0', { jitter: 0.06, spec: 0.4 }, o), P('#7ad85a', { jitter: 0.06, spec: 0.4 }, o)];
  // junk mound
  const cx = X(30) + 0.5, cz = Z(76) + 0.5, gy = ground(30, 76);
  shape(m, cx - 17, gy - 2, cz - 14, cx + 17, gy + 8, cz + 14, (x, y, z) => {
    const d = ((x - cx) / 15.5) ** 2 + ((y - gy + 1) / 7) ** 2 + ((z - cz) / 12) ** 2;
    return d < 1 + (fbm2(x * 0.2, z * 0.2, 2, 40) - 0.5) * 0.6;
  }, soil);
  const topAt = (x, z) => { for (let y = NY - 1; y >= 0; y--) if (m.get(x, y, z)) return y; return Y0; };
  // rotated put: local (lx, ly, lz) rotated by f * 90 degrees around y
  const putR = (x, y, z, f, lx, ly, lz, c) => {
    const [a, b] = f === 0 ? [lx, lz] : f === 1 ? [-lz, lx] : f === 2 ? [-lx, -lz] : [lz, -lx];
    m.put(x + a, y + ly, z + b, c);
  };
  const crt = (x, y, z, f, glowing) => {
    for (let lx = -2; lx <= 2; lx++) for (let ly = 0; ly <= 4; ly++) for (let lz = -2; lz <= 2; lz++) {
      const front = lz === 2, inner = Math.abs(lx) <= 1 && ly >= 1 && ly <= 3;
      putR(x, y, z, f, lx, ly, lz, front && inner ? (glowing ? (glowing === 1 ? glowG : glowB) : screen) : ly === 0 || Math.abs(lx) === 2 ? beige2 : beige);
    }
    for (let lx = -1; lx <= 1; lx++) for (let ly = 1; ly <= 3; ly++) putR(x, y, z, f, lx, ly, -3, beige2);
  };
  const tower = (x, y, z, f) => {
    const c = rng.chance(0.55) ? rng.pick(cases) : rng.chance(0.5) ? beige : gun;
    for (let lx = 0; lx <= 1; lx++) for (let ly = 0; ly <= 4; ly++) for (let lz = -2; lz <= 1; lz++) putR(x, y, z, f, lx, ly, lz, ly === 3 && lz === 1 ? screen : c);
    putR(x, y, z, f, 1, 1, 1, led);
  };
  const barrel = (x, y, z) => {
    const c = rng.chance(0.5) ? barrelY : barrelR;
    m.cylinder(x + 0.5, z + 0.5, y, y + 4, 1.7, (xx, yy) => (yy === y + 1 || yy === y + 3 ? hoop : c));
  };
  const tyre = (x, y, z, up) => torus(m, x + 0.5, y + (up ? 2.2 : 0.8), z + 0.5, 1.9, 0.95, tire, up ? 'z' : 'y');
  for (let n = 0; n < 46; n++) {
    const a = rng.float(0, TAU), r = Math.sqrt(rng.next());
    const u = 30 + Math.cos(a) * r * 15, w = 76 + Math.sin(a) * r * 12;
    const x = X(Math.round(u)), z = Z(Math.round(w));
    const y = topAt(x, z) + (rng.chance(0.4) ? 0 : 1);
    const f = rng.int(0, 3), kind = rng.next();
    if (kind < 0.36) crt(x, y, z, f, rng.chance(0.5) ? rng.int(1, 2) : 0);
    else if (kind < 0.54) tower(x, y, z, f);
    else if (kind < 0.7) barrel(x, y, z);
    else if (kind < 0.84) tyre(x, y, z, rng.chance(0.4));
    else for (let lx = -3; lx <= 3; lx++) for (let lz = -1; lz <= 1; lz++) putR(x, y, z, f, lx, 0, lz, (lx + lz) % 2 ? screen : beige);
  }
  // rust patches
  const rustable = new Set([beige, beige2, gun, barrelY, barrelR, hoop, ...cases]);
  m.recolor((x, y, z, c) => (rustable.has(c) && fbm2(x * 0.3, (y + z) * 0.3, 2, 66) > 0.64 ? rust : null));
  // giant floppy disk leaning in the heap
  {
    const blue = P('#3a5ab4', { jitter: 0.06 }, o), silver = P('#c8ccd8', { spec: 0.7 }, o), label = P('#f2eee2', {}, o);
    const x0 = X(36), z0 = Z(84), y0 = topAt(x0 + 4, z0) - 1;
    for (let ly = 0; ly < 11; ly++) for (let lx = 0; lx < 11; lx++) {
      const z = z0 - Math.floor(ly / 3);
      let c = blue;
      if (ly >= 7 && lx >= 3 && lx <= 7) c = silver;
      if (ly >= 1 && ly <= 4 && lx >= 2 && lx <= 8) c = label;
      if (ly === 10 && lx === 10) continue;
      m.set(x0 + lx, y0 + ly, z, c);
      m.set(x0 + lx, y0 + ly, z - 1, blue);
    }
  }
  // recycle bin
  {
    const bin = P('#8e96a8', { jitter: 0.08, spec: 0.3 }, o), binD = P('#6a7284', {}, o);
    const x = X(16) + 0.5, z = Z(70) + 0.5, y = ground(16, 70) + 1;
    m.cylinder(x, z, y, y + 7, 3, (xx, yy, zz) => (Math.floor((Math.atan2(zz + 0.5 - z, xx + 0.5 - x) + Math.PI) * 2.4) % 2 ? bin : binD));
    m.sub(() => m.cylinder(x, z, y + 2, y + 7, 2));
    m.cylinder(x + 0.6, z, y + 8, y + 8, 3.4, binD);
    crt(Math.floor(x), y + 3, Math.floor(z), 1, 2);
  }
  // tower crane rising out of the sea, its hook still holding a monitor
  {
    const yel = P('#f2b62c', { jitter: 0.08 }, o), yel2 = P('#c88a1e', { jitter: 0.08 }, o), cw = P('#7c7c84', { jitter: 0.1 }, o);
    const cab = P('#ece6d6', {}, o), glass = P('#8ad4f2', { spec: 0.8 }, o), cable = P('#3a3a3a', {}, o), redL = P('#ff3a2a', { emissive: 1 }, o);
    const cx0 = X(10), cz0 = Z(88), base = ground(11, 89) + 1, top = SEA + 12;
    for (let y = base; y <= top; y++) {
      for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]]) m.set(cx0 + dx, y, cz0 + dz, yel);
      const k = (y - base) % 6, b = k < 3 ? k : 6 - k;
      m.set(cx0 + b, y, cz0, yel2); m.set(cx0 + 3 - b, y, cz0 + 3, yel2); m.set(cx0, y, cz0 + b, yel2); m.set(cx0 + 3, y, cz0 + 3 - b, yel2);
    }
    for (let x = cx0 - 7; x <= cx0 + 22; x++) {
      m.set(x, top, cz0 + 1, yel); m.set(x, top, cz0 + 2, yel);
      if (x >= cx0) {
        m.set(x, top + 2, cz0 + 1, yel);
        if (x % 2 === 0) m.set(x, top + 1, cz0 + 1 + (x % 4 === 0 ? 1 : 0), yel2);
      }
    }
    m.box(cx0 - 7, top - 3, cz0, cx0 - 4, top - 1, cz0 + 3, cw);
    m.box(cx0 + 2, top - 3, cz0 + 3, cx0 + 4, top - 1, cz0 + 5, cab);
    m.box(cx0 + 2, top - 2, cz0 + 5, cx0 + 4, top - 2, cz0 + 5, glass);
    m.line(cx0 + 1.5, top + 1, cz0 + 1.5, cx0 + 1.5, top + 7, cz0 + 1.5, yel, 0.6);
    m.line(cx0 + 1.5, top + 7, cz0 + 1.5, cx0 + 22, top + 2.5, cz0 + 1.5, cable);
    m.line(cx0 + 1.5, top + 7, cz0 + 1.5, cx0 - 6, top + 0.5, cz0 + 1.5, cable);
    m.set(cx0 + 1, top + 8, cz0 + 1, redL);
    const hx = cx0 + 17;
    m.line(hx + 0.5, top, cz0 + 1.5, hx + 0.5, SEA + 5, cz0 + 1.5, cable);
    m.box(hx, SEA + 3, cz0 + 1, hx + 1, SEA + 4, cz0 + 2, yel2);
    crt(hx, SEA - 2, cz0 + 1, 0, 1);
    m.recolor((x, y, z, c) => ((c === yel || c === yel2) && y < SEA - 2 && hash3(x, y, z, 4) < 0.45 + (SEA - y) * 0.02 ? rust : null));
  }
  // circuit-board coral with glowing traces
  {
    const board = P('#2a7a4a', { jitter: 0.08 }, o), trace = P('#8affb8', { emissive: 0.8 }, o);
    for (const [u, w, f] of [[8, 62, 0], [46, 86, 1], [12, 90, 0]]) {
      const x = X(u), z = Z(w), y = ground(u, w);
      for (let ly = 0; ly < 7; ly++) for (let lx = 0; lx < 5; lx++) {
        if (ly > 4 && (lx === 0 || lx === 4)) continue;
        const tr = (ly === 2 && lx > 0) || (lx === 2 && ly > 2) || (ly === 5 && lx === 1);
        putR(x, y + ly, z, f, lx, 0, 0, tr ? trace : board);
      }
    }
  }
}

function buildMetropolis({ m, P, ground }, o) {
  const rng = new RNG(8505);
  const X = (u) => u + M, Z = (w) => w + M;
  const walls = [P('#6a8698', { jitter: 0.08 }, o), P('#4c5c78', { jitter: 0.08 }, o), P('#8c806c', { jitter: 0.08 }, o), P('#5c4c70', { jitter: 0.08 }, o)];
  const win = P('#1a2638', {}, o), lit = P('#ffd98a', { emissive: 0.85 }, o), litC = P('#86f2ff', { emissive: 0.85 }, o), roof = P('#3a4452', { jitter: 0.08 }, o);
  const neon = [P('#ff4ad2', { emissive: 1 }, o), P('#3af2ff', { emissive: 1 }, o), P('#a86aff', { emissive: 1 }, o)];
  const kelp = P('#3aa45e', { jitter: 0.15 }, o), lamp = P('#fff0b0', { emissive: 1 }, o), post = P('#2a2e38', {}, o);
  const floor = ground(90, 77);
  const facade = (x0, z0, x1, z1, y0, y1, wall) => (x, y, z) => {
    const onX = x === x0 || x === x1, onZ = z === z0 || z === z1;
    if (!onX && !onZ) return wall;
    if (onX && onZ) return wall;
    if ((y - y0) % 3 === 0 || y >= y1) return wall;
    const a = onX ? z : x;
    if (a % 2 === 0) return wall;
    const h = hash3(x, y, z, 31);
    return h < 0.16 ? lit : h < 0.24 ? litC : win;
  };
  // tiers: [[heightTop, inset]], neon: {face: 'x'|'z', color, y0, y1}
  const tower = (u0, w0, u1, w1, tiers, wall, opts = {}) => {
    let y = floor + 1, i0 = 0;
    for (const [h, inset] of tiers) {
      const x0 = X(u0) + inset, z0 = Z(w0) + inset, x1 = X(u1) - inset, z1 = Z(w1) - inset, yt = floor + h;
      m.box(x0, y, z0, x1, yt, z1, facade(x0, z0, x1, z1, y, yt, wall));
      m.box(x0, yt, z0, x1, yt, z1, roof);
      if (opts.ring && i0 === tiers.length - 1) {
        for (let x = x0; x <= x1; x++) { m.set(x, yt + 1, z0, opts.ring); m.set(x, yt + 1, z1, opts.ring); }
        for (let z = z0; z <= z1; z++) { m.set(x0, yt + 1, z, opts.ring); m.set(x1, yt + 1, z, opts.ring); }
      }
      y = yt + 1; i0++;
    }
    if (opts.neon) for (const n of opts.neon) {
      if (n.face === 'z') for (let yy = floor + n.y0; yy <= floor + n.y1; yy++) m.set(X(n.at), yy, Z(w1) + 1, n.c);
      else for (let yy = floor + n.y0; yy <= floor + n.y1; yy++) m.set(X(u1) + 1, yy, Z(n.at), n.c);
    }
    if (opts.kelp) for (let k = 0; k < 3; k++) {
      const kx = X(u0) + 1 + k * 2, kz = Z(w0) + 1 + (k % 2), ky = y;
      m.tube([[kx, ky, kz, 0.5], [kx + 0.6, ky + 2, kz, 0.5], [kx - 0.4, ky + 4, kz + 0.5, 0.5], [kx + 0.3, ky + 5.5, kz, 0.4]], kelp, 2);
    }
    return y - 1;
  };
  tower(73, 64, 79, 70, [[18, 0]], walls[1], { neon: [{ face: 'z', at: 76, y0: 6, y1: 15, c: neon[0] }], kelp: true });
  tower(84, 64, 90, 71, [[16, 0], [26, 1]], walls[0], { ring: neon[2] });
  tower(95, 63, 101, 70, [[13, 0]], walls[2], { kelp: true });
  tower(73, 75, 79, 82, [[21, 0]], walls[3], { neon: [{ face: 'x', at: 78, y0: 8, y1: 18, c: neon[1] }] });
  // central skyscraper whose spire still breaks the surface
  const ct = tower(84, 75, 90, 82, [[24, 0], [32, 1], [37, 2]], walls[0], { neon: [{ face: 'z', at: 87, y0: 3, y1: 22, c: neon[1] }, { face: 'x', at: 78, y0: 26, y1: 31, c: neon[0] }] });
  {
    const steel = P('#c4ccd8', { spec: 0.8 }, o), tip = P('#ff3a3a', { emissive: 1 }, o);
    m.cylinder(X(87) + 0.5, Z(78) + 0.5, ct + 1, SEA + 7, 0.8, steel);
    m.cylinder(X(87) + 0.5, Z(78) + 0.5, ct + 1, ct + 2, 1.6, steel);
    m.set(X(87), SEA + 8, Z(78), tip);
  }
  // glass dome
  {
    const glass = P('#8ad8f0', { spec: 0.9, specPow: 10, jitter: 0.04 }, o), rib = P('#d8e2ec', {}, o);
    const top = tower(95, 75, 101, 82, [[6, 0]], walls[2]);
    const cx = X(98) + 0.5, cz = Z(78) + 1;
    shape(m, cx - 4, top + 1, cz - 4, cx + 4, top + 5, cz + 4, (x, y, z) => Math.hypot(x - cx, y - top - 0.5, z - cz) < 4, (x, y, z) => (Math.abs(x + 0.5 - cx) < 0.6 || Math.abs(z + 0.5 - cz) < 0.6 ? rib : glass));
  }
  tower(62, 69, 67, 77, [[10, 0]], walls[1], { ring: neon[0], kelp: true });
  tower(106, 67, 111, 75, [[15, 0]], walls[3], { neon: [{ face: 'z', at: 108, y0: 4, y1: 12, c: neon[2] }] });
  tower(106, 78, 111, 84, [[9, 0]], walls[0], { kelp: true });
  tower(73, 87, 79, 93, [[12, 0]], walls[2], { ring: neon[1] });
  // dollhouse office block, cut open by the front glass
  {
    const x0 = X(84), x1 = X(91), z0 = Z(88), y0 = floor + 1, y1 = floor + 20;
    const wall = walls[1], room = P('#ffcf8a', { emissive: 0.55 }, o), roomB = P('#8ab8ff', { emissive: 0.5 }, o), slab = P('#9aa4b0', {}, o), dark = P('#2a3240', {}, o);
    for (let y = y0; y <= y1; y++) for (let z = z0; z < ZF; z++) for (let x = x0; x <= x1; x++) {
      const shell = x === x0 || x === x1 || z === z0;
      const fl = (y - y0) % 4 === 0;
      if (shell) m.set(x, y, z, facade(x0, z0, x1, ZF + 5, y0, y1, wall)(x, y, z));
      else if (fl || y === y1) m.set(x, y, z, slab);
      else if (z === z0 + 1) {
        const story = Math.floor((y - y0) / 4);
        m.set(x, y, z, hash1(story * 7 + Math.floor((x - x0) / 4), 3) < 0.6 ? (story % 2 ? room : roomB) : dark);
      }
    }
    m.box(x0 + 2, y0 + 5, z0 + 3, x0 + 3, y0 + 5, z0 + 4, dark);
    m.box(x0 + 4, y0 + 13, z0 + 4, x0 + 5, y0 + 14, z0 + 4, dark);
  }
  // fallen tower leaning on its neighbour
  {
    const wall = walls[3], cx = X(97), cz = Z(91), ang = -0.42;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    shape(m, cx - 8, floor, cz - 4, cx + 22, floor + 22, cz + 4, (x, y, z) => {
      const dx = x - cx, dy = y - floor - 1;
      const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
      return lx >= 0 && lx < 5 && ly >= 0 && ly < 20 && Math.abs(z - cz) < 2.6;
    }, (x, y, z) => (hash3(x, y, z, 2) < 0.18 ? win : wall));
  }
  // street lamps at the crossings
  for (const ru of ROAD_U) for (const rw of ROAD_W) {
    if (rng.chance(0.35)) continue;
    const x = X(ru + 2), z = Z(rw + 2), y = ground(ru + 2, rw + 2) + 1;
    if (m.get(x, y, z)) continue;
    m.box(x, y, z, x, y + 2, z, post);
    m.set(x, y + 3, z, lamp);
  }
}

function buildAbyss({ m, P, ground }, o) {
  const rng = new RNG(9606);
  const X = (u) => u + M, Z = (w) => w + M;
  const stone = P('#6a68a4', { jitter: 0.14 }, o), stone2 = P('#504e88', { jitter: 0.14 }, o), rune = P('#5ff4ff', { emissive: 1 }, o);
  const bone = P('#e4dccc', { jitter: 0.08 }, o), bone2 = P('#bcb2a0', { jitter: 0.08 }, o);
  const capT = P('#3af0d0', { emissive: 0.9 }, o), capP = P('#c46aff', { emissive: 0.9 }, o), stem = P('#c8c0e0', {}, o), crystal = P('#b48aff', { emissive: 0.8, spec: 0.5 }, o);
  const fl = ground(149, 94);
  // temple platform at the trench floor
  m.box(X(140), fl, Z(86), X(159), fl + 1, ZF - 1, (x, y, z) => ((x + z) % 4 === 0 ? stone2 : stone));
  m.box(X(142), fl + 2, Z(88), X(157), fl + 2, ZF - 1, stone2);
  const column = (u, w, h, intact) => {
    const x = X(u) + 0.5, z = Z(w) + 0.5, y = fl + 3;
    m.box(Math.floor(x) - 2, y, Math.floor(z) - 2, Math.floor(x) + 2, y, Math.floor(z) + 2, stone2);
    m.cylinder(x, z, y + 1, y + h, 1.7, (xx, yy, zz) => ((yy - y) % 3 === 1 && (zz >= Math.floor(z) + 1 || xx >= Math.floor(x) + 1) && hash3(xx, yy, zz, 8) < 0.6 ? rune : (yy % 2 ? stone : stone2)));
    if (intact) m.box(Math.floor(x) - 2, y + h + 1, Math.floor(z) - 2, Math.floor(x) + 2, y + h + 1, Math.floor(z) + 2, stone);
    else m.sub(() => m.sphere(x + 1.5, y + h + 0.5, z + 0.8, 1.6));
  };
  column(144, 91, 14, true); column(154, 91, 14, true); column(144, 98, 8, false); column(154, 98, 5, false);
  m.box(X(142), fl + 18, Z(89), X(156), fl + 19, Z(93), (x, y, z) => (y === fl + 18 && x % 3 === 0 ? rune : stone));
  // fallen column across the floor
  m.cylinder(X(150) + 0.5, Z(85) + 0.5, X(136), X(147), 1.5, stone2, 'x');
  // arch further up the trench
  {
    const ay = ground(147, 70), cx = X(147) + 0.5, cz = Z(70) + 0.5;
    for (const dx of [-5, 5]) m.box(Math.floor(cx + dx) - 1, ay, Math.floor(cz) - 1, Math.floor(cx + dx) + 1, ay + 7, Math.floor(cz) + 1, stone);
    torus(m, cx, ay + 8, cz, 5, 1.6, (x, y, z) => (hash3(x, y, z, 5) < 0.2 ? rune : stone2), 'z', (a) => a > -0.1 && a < Math.PI + 0.1);
  }
  // giant skull half buried in the trench wall
  {
    const x = X(156) + 0.5, z = Z(80) + 0.5, y = ground(156, 80) + 3;
    m.ellipsoid(x, y, z, 5.4, 5, 5.2, bone);
    m.box(x - 3.5, y - 6, z - 1, x + 3.5, y - 3, z + 4.5, bone2);
    m.sub(() => { m.sphere(x - 2.2, y + 0.3, z + 4.6, 1.8); m.sphere(x + 2.2, y + 0.3, z + 4.6, 1.8); m.box(x - 0.5, y - 2.5, z + 4, x + 0.5, y - 1.5, z + 6); });
    m.sphere(x - 2.2, y + 0.3, z + 3.6, 0.9, rune);
    m.sphere(x + 2.2, y + 0.3, z + 3.6, 0.9, rune);
    for (let k = -3; k <= 3; k += 2) m.set(Math.floor(x + k), Math.floor(y - 3), Math.floor(z + 4.5), bone);
  }
  // bioluminescent mushrooms + crystals on the trench walls
  for (let n = 0, tries = 0; n < 16 && tries < 300; tries++) {
    const u = rng.int(130, 166), w = rng.int(56, 99);
    const gy = ground(u, w);
    if (gy > SEA - 26 || gy < fl + 3) continue;
    const x = X(u) + 0.5, z = Z(w) + 0.5;
    if (n % 3 === 2) shard(m, [x, gy, z], [rng.float(-0.5, 0.5), 1, rng.float(-0.5, 0.5)], rng.float(3, 5), 1, crystal);
    else {
      const h = rng.int(1, 3);
      m.box(Math.floor(x), gy + 1, Math.floor(z), Math.floor(x), gy + h, Math.floor(z), stem);
      m.ellipsoid(x, gy + h + 1, z, 1.9, 0.9, 1.9, n % 2 ? capT : capP);
    }
    n++;
  }
}

// Little stories hidden in the strata of the front cut face.
function buildFaceArt({ m, P }) {
  const zf = ZF - 1, X = (u) => u + M;
  const fossil = P('#ece0c6', { jitter: 0.05 }), shell = P('#d8b48a', { jitter: 0.06 });
  const coin = P('#ffd84a', { emissive: 0.45, spec: 0.6 }), chestW = P('#7a4a26', {}), chestB = P('#e2b250', { spec: 0.7 });
  const gem = P('#c48aff', { emissive: 0.7 }), gem2 = P('#5af0ff', { emissive: 0.7 });
  const setF = (u, y, c, d = 1) => { for (let k = 0; k < d; k++) if (m.get(X(u), y, zf - k)) m.set(X(u), y, zf - k, c); };
  // fossil fish
  const fx = 58, fy = 20;
  for (let u = 0; u <= 13; u++) setF(fx + u, fy, fossil);
  for (let u = 2; u <= 10; u += 2) { const r = 3 - Math.abs(u - 6) * 0.35; for (let k = 1; k <= r; k++) { setF(fx + u, fy + k, fossil); setF(fx + u, fy - k, fossil); } }
  for (let k = -2; k <= 2; k++) setF(fx - 1 - Math.abs(k), fy + k, fossil);
  for (let k = -2; k <= 2; k++) for (let j = 0; j < 3 - Math.abs(k); j++) setF(fx + 14 + j, fy + k, fossil);
  // ammonite
  for (let a = 0; a < TAU * 2.2; a += 0.08) { const r = 0.6 + a * 0.55; setF(Math.round(26 + Math.cos(a) * r), Math.round(32 + Math.sin(a) * r), shell); }
  // buried treasure chest with spilled coins
  const cx = 110, cy = 17;
  for (let u = 0; u < 8; u++) for (let y = 0; y < 5; y++) setF(cx + u, cy + y, y === 3 || u === 0 || u === 7 ? chestB : chestW, 3);
  for (let u = 2; u < 6; u++) setF(cx + u, cy + 5, coin, 2);
  for (const [du, dy] of [[-2, 0], [-3, 1], [9, 0], [10, 1], [11, 0], [-1, 2]]) setF(cx + du, cy + dy, coin);
  // crystal geode near the trench
  for (let a = 0; a < TAU; a += 0.2) for (let r = 1; r <= 3.4; r += 0.7) setF(Math.round(128 + Math.cos(a) * r * 1.3), Math.round(13 + Math.sin(a) * r), r > 2.5 ? gem2 : gem, r > 2.5 ? 1 : 2);
}

// ---------------------------------------------------------------- bake: render + water pass + masks
function camVec(yaw) {
  const a = yaw * DEG, b = PITCH * DEG, cy = Math.cos(a), sy = Math.sin(a), cp = Math.cos(b), sp = Math.sin(b);
  return { R: [cy, 0, -sy], U: [-sp * sy, cp, -sp * cy], D: [-sy * cp, -sp, -cy * cp] };
}

let _t0 = 0, _t1 = 0, _ax = 0;
function slab(ox, oy, oz, ix, iy, iz, x0, x1, y0, y1, z0, z1) {
  let a = (x0 - ox) * ix, b = (x1 - ox) * ix;
  if (a > b) { const q = a; a = b; b = q; }
  let t0 = a, t1 = b, ax = 0;
  a = (y0 - oy) * iy; b = (y1 - oy) * iy;
  if (a > b) { const q = a; a = b; b = q; }
  if (a > t0) { t0 = a; ax = 1; }
  if (b < t1) t1 = b;
  a = (z0 - oz) * iz; b = (z1 - oz) * iz;
  if (a > b) { const q = a; a = b; b = q; }
  if (a > t0) { t0 = a; ax = 2; }
  if (b < t1) t1 = b;
  _t0 = t0; _t1 = t1; _ax = ax;
  return t0 < t1;
}

const RGB = (h) => hexToRgb(h);
const TOPG = [[0, RGB('#86f2e2')], [5, RGB('#3ad2da')], [12, RGB('#28a6d6')], [24, RGB('#1e78c4')], [40, RGB('#1a58aa')], [62, RGB('#16408e')]];
function grad(G, v, out) {
  let i = 0;
  while (i < G.length - 2 && v > G[i + 1][0]) i++;
  const [a, ca] = G[i], [b, cb] = G[i + 1], k = clamp01((v - a) / (b - a));
  out[0] = ca[0] + (cb[0] - ca[0]) * k; out[1] = ca[1] + (cb[1] - ca[1]) * k; out[2] = ca[2] + (cb[2] - ca[2]) * k;
}
const GLASS = [
  [RGB('#4ac8ea'), RGB('#2a94d2'), 0.3],
  [RGB('#2068b6'), RGB('#1a4692'), 0.46],
  [RGB('#142c6e'), RGB('#0c1a48'), 0.6],
];

function bakeView(dio, yaw, scale) {
  const t0 = performance.now();
  let rec = new Int16Array(3 << 17), n = 0;
  const keepVoxel = (x, y, z) => {
    if (n + 3 > rec.length) { const r2 = new Int16Array(rec.length * 2); r2.set(rec); rec = r2; }
    rec[n++] = x; rec[n++] = y; rec[n++] = z;
    return true;
  };
  const r = renderVoxels(dio.model, { scale, yaw, pitch: PITCH, keepVoxel, jitter: 0.2, glowRadius: 4 });
  const t1 = performance.now();
  const W = r.w, H = r.h, N = W * H, ids = r.ids;
  const [p0x, p0y] = r.project(0, 0, 0);
  const cam = camVec(yaw), { R, U, D } = cam;
  let hits = 0;
  for (let p = 0; p < N; p++) if (ids[p]) hits++;
  const ok = hits * 3 === n;
  const hitT = new Float32Array(N).fill(1e9), entT = new Float32Array(N).fill(1e9);
  const obj = new Uint8Array(N), terr = new Uint8Array(N), surf = new Uint8Array(N);
  const g = ctxOf(r.canvas), img = g.getImageData(0, 0, W, H), px = new Uint32Array(img.data.buffer);
  const ix = Math.abs(D[0]) < 1e-9 ? 1e12 : 1 / D[0], iy = 1 / D[1], iz = Math.abs(D[2]) < 1e-9 ? 1e12 : 1 / D[2];
  const wc = [0, 0, 0], tmp = [0, 0, 0];
  let k = 0;
  for (let py = 0; py < H; py++) {
    const Y = (py + 0.5 - p0y) / scale;
    for (let qx = 0; qx < W; qx++) {
      const p = py * W + qx, X = (qx + 0.5 - p0x) / scale;
      const ox = X * R[0] - Y * U[0], oy = X * R[1] - Y * U[1], oz = X * R[2] - Y * U[2];
      let th = 1e9, hx = 0, hy = 0, hz = 0, topFace = false;
      if (ok && ids[p]) {
        hx = rec[k]; hy = rec[k + 1]; hz = rec[k + 2]; k += 3;
        slab(ox, oy, oz, ix, iy, iz, hx, hx + 1, hy, hy + 1, hz, hz + 1);
        th = _t0; topFace = _ax === 1;
        hitT[p] = th;
        obj[p] = dio.own[ids[p]];
        if (hx >= M && hx < XR && hz >= M && hz < ZF) terr[p] = dio.terr[hx + NX * hz];
      }
      if (!slab(ox, oy, oz, ix, iy, iz, M, XR, Y0, SEA, M, ZF)) continue;
      const tw0 = _t0, tw1 = _t1, ax = _ax;
      const thick = Math.min(tw1, th) - tw0;
      if (thick <= 0.02) continue;
      entT[p] = tw0;
      const ex = ox + D[0] * tw0, ey = oy + D[1] * tw0, ez = oz + D[2] * tw0;
      const bq = bayer(qx, py);
      let a, cr, cg, cb;
      if (ax === 1) {
        surf[p] = 1;
        const exi = Math.floor(ex), ezi = Math.floor(ez);
        if (exi >= M && exi < XR && ezi >= M && ezi < ZF) terr[p] = dio.terr[exi + NX * ezi];
        const dh = ids[p] ? SEA - hy - 1 : 62;
        grad(TOPG, dh, wc);
        a = Math.min(0.64, 0.14 + thick * 0.0095);
        const wv = Math.sin(ex * 0.45 + Math.sin(ez * 0.23) * 2.2) + Math.sin(ez * 0.38 - ex * 0.12 + 1.3);
        if (wv + bq * 0.5 > 1.72) { wc[0] = lerp(wc[0], 236, 0.3); wc[1] = lerp(wc[1], 252, 0.3); wc[2] = lerp(wc[2], 255, 0.3); a = Math.max(a, 0.36); }
        else if (wv - bq * 0.5 < -1.7) { wc[0] *= 0.9; wc[1] *= 0.92; wc[2] *= 0.95; a += 0.04; }
      } else {
        const dz = SEA - ey + (bq - 0.5) * 2.2;
        const band = dz < ZONE1 ? 0 : dz < ZONE2 ? 1 : 2;
        const [ca, cb2, a0] = GLASS[band];
        const lo = band === 0 ? 0 : band === 1 ? ZONE1 : ZONE2, hi = band === 0 ? ZONE1 : band === 1 ? ZONE2 : SEA - Y0;
        const kk = clamp01((dz - lo) / (hi - lo));
        wc[0] = lerp(ca[0], cb2[0], kk); wc[1] = lerp(ca[1], cb2[1], kk); wc[2] = lerp(ca[2], cb2[2], kk);
        a = Math.min(0.9, a0 + thick * 0.0045);
        const dzr = SEA - ey;
        if (dzr < 0.55) { wc[0] = 214; wc[1] = 252; wc[2] = 255; a = 0.75; }
        else if ((Math.abs(dzr - ZONE1) < 0.32 || Math.abs(dzr - ZONE2) < 0.32) && Math.floor(ex + ez) % 3) { wc[0] = lerp(wc[0], 220, 0.5); wc[1] = lerp(wc[1], 240, 0.5); wc[2] = lerp(wc[2], 255, 0.5); a += 0.14; }
        else if (band === 0 && ((ex + ez * 0.6 - ey * 0.9) % 26 + 26) % 26 < 3) { wc[0] = lerp(wc[0], 200, 0.25); wc[1] = lerp(wc[1], 240, 0.25); wc[2] = lerp(wc[2], 255, 0.25); }
      }
      const aq = Math.min(1, Math.floor(a * 12 + bq) / 12);
      const v = px[p];
      let br = v & 255, bg = (v >>> 8) & 255, bb = (v >>> 16) & 255;
      if (!ids[p]) { br = 10; bg = 22; bb = 64; }
      br += (wc[0] - br) * aq; bg += (wc[1] - bg) * aq; bb += (wc[2] - bb) * aq;
      // caustics on shallow upward faces
      if (ax === 1 && topFace && ids[p]) {
        const dh = SEA - hy - 1;
        if (dh < 16) {
          const cs = Math.abs(Math.sin(hx * 0.55 + Math.sin(hz * 0.4) * 1.8) + Math.sin(hz * 0.5 + Math.sin(hx * 0.33) * 1.6));
          if (cs < 0.24) { const kq = 0.42 * (1 - dh / 16); br += (240 - br) * kq; bg += (255 - bg) * kq; bb += (248 - bb) * kq; }
        }
      }
      px[p] = (0xff000000 | (Math.round(bb) << 16) | (Math.round(bg) << 8) | Math.round(br)) >>> 0;
    }
  }
  // glass edges of the water block (depth tested)
  const edge = (a, b, col, alpha) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), steps = Math.ceil(len * scale * 1.5);
    const [cr, cg, cb] = RGB(col);
    for (let i = 0; i <= steps; i++) {
      const q = i / steps;
      tmp[0] = lerp(a[0], b[0], q); tmp[1] = lerp(a[1], b[1], q); tmp[2] = lerp(a[2], b[2], q);
      const sx = Math.floor((tmp[0] * R[0] + tmp[1] * R[1] + tmp[2] * R[2]) * scale + p0x), sy = Math.floor(-(tmp[0] * U[0] + tmp[1] * U[1] + tmp[2] * U[2]) * scale + p0y);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const p = sy * W + sx, tq = tmp[0] * D[0] + tmp[1] * D[1] + tmp[2] * D[2];
      if (entT[p] > 1e8 || tq > Math.min(hitT[p], entT[p]) + 0.4) continue;
      const v = px[p];
      const br = v & 255, bg = (v >>> 8) & 255, bb = (v >>> 16) & 255;
      px[p] = (0xff000000 | (Math.round(bb + (cb - bb) * alpha) << 16) | (Math.round(bg + (cg - bg) * alpha) << 8) | Math.round(br + (cr - br) * alpha)) >>> 0;
    }
  };
  for (const [a, b] of [[[M, SEA, M], [XR, SEA, M]], [[XR, SEA, M], [XR, SEA, ZF]], [[XR, SEA, ZF], [M, SEA, ZF]], [[M, SEA, ZF], [M, SEA, M]]]) edge(a, b, '#e4fcff', 0.8);
  for (const [xx, zz] of [[M, ZF], [XR, ZF], [XR, M], [M, M]]) edge([xx, Y0, zz], [xx, SEA, zz], '#b4ecff', 0.5);
  g.putImageData(img, 0, 0);

  // glow: baked at half strength, plus per-location crops pulsed at runtime
  const anchors = LOCS.map((L) => {
    const f = L.focus, x = f[0] + M, y = f[1], z = f[2] + M;
    return [(x * R[0] + y * R[1] + z * R[2]) * scale + p0x, -(x * U[0] + y * U[1] + z * U[2]) * scale + p0y];
  });
  const glows = [];
  if (r.glow) {
    const gimg = ctxOf(r.glow).getImageData(0, 0, W, H), gp = new Uint32Array(gimg.data.buffer);
    const bufs = LOCS.map(() => ({ x0: W, y0: H, x1: -1, y1: -1 }));
    const ownerOf = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (!(gp[p] >>> 24)) continue;
      let ow = obj[p] || terr[p];
      if (!ow) {
        const x = p % W, y = (p / W) | 0;
        let bd = 70 * 70;
        anchors.forEach(([ax2, ay2], i) => { const d = (ax2 - x) ** 2 + (ay2 - y) ** 2; if (d < bd) { bd = d; ow = i + 1; } });
      }
      ownerOf[p] = ow;
      if (ow) { const b = bufs[ow - 1], x = p % W, y = (p / W) | 0; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
    }
    bufs.forEach((b, i) => {
      if (b.x1 < 0) { glows.push(null); return; }
      const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, c = makeCanvas(w, h), cg = ctxOf(c), im = cg.createImageData(w, h), out = new Uint32Array(im.data.buffer);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y + b.y0) * W + x + b.x0; if (ownerOf[p] === i + 1) out[y * w + x] = gp[p]; }
      cg.putImageData(im, 0, 0);
      glows.push({ canvas: c, x: b.x0, y: b.y0 });
    });
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5;
    g.drawImage(r.glow, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  // visible sea-surface pixels for sparkles
  const surfList = [];
  for (let p = 0; p < N; p++) if (surf[p] && hash1(p, 77) < 0.012) surfList.push(p);
  const C = dio.C;
  const proj = (x, y, z) => [(x * R[0] + y * R[1] + z * R[2]) * scale + p0x, -(x * U[0] + y * U[1] + z * U[2]) * scale + p0y];
  const [cx, cy] = proj(C[0], C[1], C[2]);
  return {
    canvas: r.canvas, W, H, scale, yaw, cam, hitT, obj, terr, surf, surfList, glows, anchors, proj, cx, cy, ids, plain: dio.plain,
    outlines: {}, fogs: {}, ok, ms: [Math.round(t1 - t0), Math.round(performance.now() - t1)],
    // canvas-space point + visibility against the baked depth (water is not an occluder)
    vis(x, y, z) {
      const [sx, sy] = proj(x, y, z);
      const qx = Math.floor(sx), qy = Math.floor(sy);
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) return null;
      if (x * D[0] + y * D[1] + z * D[2] > hitT[qy * W + qx] + 0.8) return null;
      return [sx, sy];
    },
  };
}

// Hover outline for location li (1-based): bright rim around its visible voxels + faint fill.
function outlineFor(bk, li) {
  if (bk.outlines[li]) return bk.outlines[li];
  const { W, H, obj } = bk;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let p = 0; p < W * H; p++) if (obj[p] === li) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return (bk.outlines[li] = null);
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, c = makeCanvas(w, h), cg = ctxOf(c), im = cg.createImageData(w, h), out = new Uint32Array(im.data.buffer);
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? obj[y * W + x] === li : false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x + x0, Y = y + y0;
    if (at(X, Y)) out[y * w + x] = 0x30ffffff;
    else if (at(X - 1, Y) || at(X + 1, Y) || at(X, Y - 1) || at(X, Y + 1)) out[y * w + x] = 0xffffffff;
  }
  cg.putImageData(im, 0, 0);
  return (bk.outlines[li] = { canvas: c, x: x0, y: y0 });
}

// Fog bank over a locked location's territory (soft, dithered, drifting at runtime).
function fogFor(bk, li) {
  if (bk.fogs[li]) return bk.fogs[li];
  const { W, H, obj, terr, surf, ids, plain } = bk;
  const inMask = (p) => obj[p] === li || (!obj[p] && terr[p] === li && (surf[p] || !plain[ids[p]]));
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let p = 0; p < W * H; p++) if (inMask(p)) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return (bk.fogs[li] = null);
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad * 2); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  // distance-to-mask (chamfer) for soft edges
  const dist = new Float32Array(w * h).fill(99);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inMask((y + y0) * W + x + x0)) dist[y * w + x] = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - w] + 1);
      dist[i] = d;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < h - 1) d = Math.min(d, dist[i + w] + 1);
      dist[i] = d;
    }
  }
  const c = makeCanvas(w, h), cg = ctxOf(c), im = cg.createImageData(w, h), out = new Uint32Array(im.data.buffer);
  const A = RGB('#e4ecf4'), B = RGB('#8090ac');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, d = dist[i];
    const n = fbm2((x + x0) * 0.04, (y + y0) * 0.075, 3, li * 13);
    let a = 0.7 * smoothstep(pad + 1, 0, d) * (0.4 + n * 0.85);
    a = Math.floor(a * 6 + bayer(x, y)) / 6;
    if (a <= 0) continue;
    const k = clamp01(n * 1.6 - 0.3);
    const cr = lerp(B[0], A[0], k), cgr = lerp(B[1], A[1], k), cb = lerp(B[2], A[2], k);
    out[i] = ((Math.round(clamp01(a) * 255) << 24) | (Math.round(cb) << 16) | (Math.round(cgr) << 8) | Math.round(cr)) >>> 0;
  }
  cg.putImageData(im, 0, 0);
  return (bk.fogs[li] = { canvas: c, x: x0, y: y0 });
}

// ---------------------------------------------------------------- small sprites
const SPR = {};
function sprite(key, build) { return SPR[key] || (SPR[key] = build()); }

function pinSprite(color) {
  return sprite('pin' + color, () => {
    const m = new VoxelModel(9, 15, 9);
    const head = m.color(color, { smooth: 0.8, spec: 0.5, jitter: 0.04 }), steel = m.color('#d4d8e4', { spec: 0.7, jitter: 0.02 }), hi = m.color(mix(color, '#ffffff', 0.7), { smooth: 0.8 });
    m.cone(4.5, 4.5, 0, 6, 0.35, 1.3, steel);
    m.sphere(4.5, 10, 4.5, 4.1, head);
    m.sphere(3.2, 11.6, 6.4, 1.1, hi);
    return renderVoxels(m, { scale: 1.25, yaw: 30, pitch: 18 });
  });
}

function padlockSprite() {
  return sprite('padlock', () => {
    const m = new VoxelModel(12, 17, 6);
    const gold = m.color('#f2b832', { spec: 0.7, jitter: 0.04 }), goldD = m.color('#c4841c', { jitter: 0.04 }), steel = m.color('#cdd4e0', { spec: 0.9, smooth: 0.6 }), hole = m.color('#2a1a10', {});
    m.box(1, 0, 1, 10, 8, 4, (x, y) => (y === 2 || y === 6 ? goldD : gold));
    m.sub(() => { for (const [x, y] of [[1, 0], [10, 0], [1, 8], [10, 8]]) m.box(x, y, 1, x, y, 4); });
    m.box(5, 3, 4, 6, 5, 4, hole);
    m.set(5, 2, 4, hole); m.set(6, 2, 4, hole);
    for (let a = 0; a <= Math.PI; a += 0.12) m.sphere(5.5 + Math.cos(a) * 3.3, 9 + Math.sin(a) * 4.4, 2.5, 1.05, steel);
    return renderVoxels(m, { scale: 1.25, yaw: 18, pitch: 14 });
  });
}

function cloudSprite(seed) {
  return sprite('cloud' + seed, () => {
    const rng = new RNG(seed), m = new VoxelModel(34, 14, 18);
    const c = m.color('#ffffff', { smooth: 0.7, jitter: 0.04 }), c2 = m.color('#dce8f6', { smooth: 0.6, jitter: 0.04 });
    const n = rng.int(4, 6);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), r = 3 + Math.sin(t * Math.PI) * 3.4 + rng.float(-0.5, 0.8);
      m.ellipsoid(5 + t * 24, 2 + r * 0.75, 9 + rng.float(-2, 2), r * 1.2, r, r * 0.95, c);
    }
    m.sub(() => m.box(0, 0, 0, 33, 1, 17));
    m.paint(() => m.box(0, 2, 0, 33, 2, 17, c2));
    return renderVoxels(m, { scale: 1.5, yaw: 24, pitch: 20, outline: false, edges: 0.3, sideEdges: 0, ao: 0.6, light: { top: 5.2, lit: 4.4, dark: 3.4, bottom: 2.6 } });
  });
}

function boatSprite(yaw) {
  const key = Math.round(((yaw % 360) + 360) % 360 / 22.5) % 16;
  return sprite('boat' + key, () => {
    const m = new VoxelModel(16, 13, 9);
    const red = m.color('#e2483a', { jitter: 0.06 }), white = m.color('#f4eee0', { jitter: 0.04 }), deck = m.color('#c99a62', { jitter: 0.1 });
    const teal = m.color('#2f8f9f', { jitter: 0.06 }), glass = m.color('#86c8e4', { spec: 0.8 }), mast = m.color('#8a5a32', {}), flag = m.color('#ffd84a', {});
    for (let x = 0; x < 16; x++) {
      const hw = x > 10 ? Math.max(0.4, 3.2 - (x - 10) * 0.6) : x < 1 ? 2.6 : 3.2;
      for (let z = 0; z < 9; z++) {
        if (Math.abs(z + 0.5 - 4.5) > hw) continue;
        for (let y = 0; y <= 3; y++) {
          const inner = Math.abs(z + 0.5 - 4.5) < hw - 1 && x > 0 && x < 14;
          if (y === 3 && inner) m.set(x, y, z, deck);
          else if (y <= 1 && Math.abs(z + 0.5 - 4.5) > hw - 1.2 + y * 0.6) continue;
          else m.set(x, y, z, y === 3 ? white : red);
        }
      }
    }
    m.box(3, 4, 2, 7, 6, 6, white);
    m.box(7, 5, 3, 7, 5, 5, glass);
    m.box(2, 7, 1, 8, 7, 7, teal);
    m.box(11, 4, 4, 11, 11, 4, mast);
    m.box(12, 9, 4, 14, 10, 4, flag);
    return renderVoxels(m, { scale: 1.5, yaw: key * 22.5, pitch: PITCH });
  });
}

function discSprite(r, color) {
  return sprite(`disc${r}${color}`, () => {
    const b = new PixelBuffer(r * 2 + 1, r * 2 + 1);
    b.fillCircle(r, r, r, packHex(color));
    return b.toCanvas();
  });
}
const packHex = (h) => { const [r, g, b] = RGB(h); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };

// Painted backdrop for the view window (cached per size).
function backdrop(w, h, night) {
  return sprite(`bg${w}x${h}${night ? 'n' : 'd'}`, () => {
    const b = new PixelBuffer(w, h);
    const top = RGB(night ? '#0a1a34' : '#1a4a7c'), mid = RGB(night ? '#1e4472' : '#3a7cb0'), bot = RGB(night ? '#3e7aa6' : '#7ab8d8');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y / h + (bayer(x, y) - 0.5) * 0.06;
      const [ca, cb, t] = k < 0.55 ? [top, mid, k / 0.55] : [mid, bot, (k - 0.55) / 0.45];
      const rad = Math.hypot((x - w * 0.47) / (w * 0.5), (y - h * 0.62) / (h * 0.55));
      const glow = Math.max(0, 1 - rad) * 0.22;
      let r = lerp(ca[0], cb[0], t), g = lerp(ca[1], cb[1], t), bb = lerp(ca[2], cb[2], t);
      r += (150 - r) * glow; g += (220 - g) * glow; bb += (240 - bb) * glow;
      b.set(x, y, ((255 << 24) | (Math.round(bb) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0);
    }
    for (let i = 0; i < (night ? 80 : 0); i++) {
      const x = Math.floor(hash1(i, 3) * w), y = Math.floor(hash1(i, 4) ** 1.6 * h * 0.5);
      b.set(x, y, hash1(i, 5) < 0.3 ? packHex('#fff6d8') : packHex('#9ec4e8'));
    }
    return b.toCanvas();
  });
}

// ---------------------------------------------------------------- panel
const INK = '#4a2e18', INK_L = '#7a5a3c', RED = '#b8302a';
const idle = (f) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 80));

let DIO = null;
const BAKES = new Map();
function getDio() { return DIO || (DIO = buildDiorama()); }
function getBake(scale, yaw) {
  const key = scale + '|' + yaw;
  let b = BAKES.get(key);
  if (!b) {
    for (const k of BAKES.keys()) if (!k.startsWith(scale + '|')) BAKES.delete(k);
    b = bakeView(getDio(), yaw, scale);
    BAKES.set(key, b);
  }
  return b;
}

export class MapPanel {
  constructor() {
    this.id = 'map';
    this.modal = true;
    this.sound = 'ui_page';
    this.t = 0;
    this.yawI = YAW0;
    this.prev = null;
    this.fade = 1;
    if (typeof window !== 'undefined') setTimeout(() => this.warm(), 2500);
  }

  // Pre-build the model and every yaw in idle time so the first open is instant.
  warm() {
    if (!this.game?.screen) return;
    const steps = [() => getDio(), () => getBake(this.layout().s, MAP_YAWS[this.yawI])];
    const order = MAP_YAWS.map((y, i) => i).filter((i) => i !== this.yawI).sort((a, b) => Math.abs(a - this.yawI) - Math.abs(b - this.yawI));
    for (const i of order) steps.push(() => getBake(this.layout().s, MAP_YAWS[i]));
    steps.push(() => { LOCS.forEach((L) => pinSprite(L.color)); padlockSprite(); [1, 2, 3].forEach(cloudSprite); });
    const run = () => {
      const f = steps.shift();
      if (!f) return;
      try { f(); } catch (e) { console.error(e); return; }
      setTimeout(() => idle(run), 250);
    };
    idle(run);
  }

  open(data) {
    const g = this.game;
    this.t = 0;
    this.sel = (data && LOC_BY_ID[data]) ? data : this.current();
    this.hover = null;
    this.drag = null;
    this.sail = null;
    this.prev = null;
    this.fade = 1;
    this.layout();
    getBake(this.layout().s, MAP_YAWS[this.yawI]);
    g.ui && (g.ui.tip = null);
  }

  close() { this.sail = null; this.drag = null; }

  unlocked(id) { return this.game.state.unlockedBiomes?.includes(id) ?? id === 'shallows'; }
  current() { const id = this.game.ocean?.biome?.id || this.game.state.biome; return LOC_BY_ID[id] ? id : 'shallows'; }

  skillFor(L) { return SKILLS.find((s) => s.effect?.unlockBiome === L.id) || (L.skill && SKILL_BY_ID[L.skill]) || null; }

  requirements(L) {
    const st = this.game.state, sk = this.skillFor(L);
    if (!sk) return [{ text: `${L.name} expedition skill`, sub: 'coming soon', ok: false }];
    const found = this.game.speciesFound?.() ?? 0;
    const out = (sk.req || []).map((r) => ({ text: SKILL_BY_ID[r]?.name || r, sub: 'skill', ok: !!st.skills?.[r] }));
    if (sk.needSpecies) out.push({ text: `Discover ${sk.needSpecies} species`, sub: `${Math.min(found, sk.needSpecies)}/${sk.needSpecies}`, ok: found >= sk.needSpecies });
    out.push({ text: `Grow '${sk.name}'`, sub: `${formatCommas(sk.cost)}{coin}`, ok: !!st.skills?.[sk.id] });
    return out;
  }

  fishCount(L) {
    const j = this.game.state.journal || {};
    const list = SPECIES.filter((s) => s.biome === L.id);
    return [list.filter((s) => j[s.id]?.caught > 0).length, list.length];
  }

  layout() {
    const g = this.game, SW = g.screen.W, SH = g.screen.H;
    const w = Math.min(SW - 12, 960), h = Math.min(SH - 10, 532);
    const r = { x: Math.round((SW - w) / 2), y: Math.round((SH - h) / 2), w, h };
    const cardW = clamp(Math.round(w * 0.245), 186, 232);
    const view = { x: r.x + 9, y: r.y + 9, w: w - cardW - 25, h: h - 18 };
    const card = { x: view.x + view.w + 7, y: r.y + 34, w: cardW, h: h - 43 };
    const ext = getDio().ext;
    const s = clamp(Math.floor(Math.min((view.w - 40) / (ext.left + ext.right), (view.h - 58) / (ext.up + ext.down)) * 10) / 10, 1.2, 3.4);
    const ax = Math.round(view.x + view.w / 2 + ((ext.left - ext.right) / 2) * s + 8);
    const ay = Math.round(view.y + view.h - 8 - ext.down * s);
    return { r, view, card, s, ax, ay };
  }

  setYaw(i) {
    i = clamp(i, 0, MAP_YAWS.length - 1);
    if (i === this.yawI) return;
    const L = this.layout();
    this.prev = getBake(L.s, MAP_YAWS[this.yawI]);
    this.yawI = i;
    getBake(L.s, MAP_YAWS[i]);
    this.fade = 0;
    this.game.audio.play('ui_tab', { vol: 0.35, pitch: 0.9 + i * 0.04 });
  }

  // Location under the cursor: pins first, then the baked territory map.
  pick(bk, ox, oy, mx, my) {
    for (const h of this.pinHits || []) if (mx >= h.x && my >= h.y && mx < h.x + h.w && my < h.y + h.h) return h.id;
    const x = Math.floor(mx - ox), y = Math.floor(my - oy);
    if (x < 0 || y < 0 || x >= bk.W || y >= bk.H) return null;
    const p = y * bk.W + x, li = bk.obj[p] || bk.terr[p];
    return li ? LOCS[li - 1].id : null;
  }

  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input, st = g.state;
    dt = Math.max(0, Math.min(0.1, dt));
    this.t += dt;
    const t = this.t;
    const reduced = !!st.settings?.reducedMotion;
    const Lay = this.layout(), { r, view, card } = Lay;
    this.rect = r;
    const bk = getBake(Lay.s, MAP_YAWS[this.yawI]);
    const ox = Math.round(Lay.ax - bk.cx), oy = Math.round(Lay.ay - bk.cy);
    this.fade = Math.min(1, this.fade + dt / 0.14);
    const cur = this.current();

    // ------------------------------------------------ frame
    drawWood(ctx, r.x, r.y, r.w, r.h, { tone: 'dark' });
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(view.x - 1, view.y - 1, view.w + 2, view.h + 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(view.x, view.y, view.w, view.h); ctx.clip();
    const night = !!g.clock?.isNight?.();
    ctx.drawImage(backdrop(view.w, view.h, night), view.x, view.y);

    // ------------------------------------------------ input: hover, drag-rotate, click-select, wheel
    const inView = ui.hover(view) && !this.sail;
    if (this.drag) {
      if (!inp.down) {
        if (!this.drag.moved && this.drag.hit) this.select(this.drag.hit);
        this.drag = null;
      } else {
        const dx = inp.x - this.drag.x0;
        if (Math.abs(dx) > 4) this.drag.moved = true;
        if (this.drag.moved) this.setYaw(this.drag.i0 + Math.round(dx / 46));
      }
    }
    let hov = null;
    if (inView && !this.drag?.moved) hov = this.pick(bk, ox, oy, inp.x, inp.y);
    if (inView && inp.pressed && !this.overControl(inp.x, inp.y, Lay)) {
      inp.pressed = false;
      this.drag = { x0: inp.x, i0: this.yawI, moved: false, hit: hov };
      if (inp.dblclick && hov) { this.select(hov); this.trySail(LOC_BY_ID[hov], true); }
    }
    if (inView && inp.wheel) { this.setYaw(this.yawI + Math.sign(inp.wheel)); inp.wheel = 0; }
    if (!this.sail && inp.keyPressed?.('ArrowLeft')) this.setYaw(this.yawI - 1);
    if (!this.sail && inp.keyPressed?.('ArrowRight')) this.setYaw(this.yawI + 1);
    if (this.listHover) hov = this.listHover;
    if (this.debugHover !== undefined) hov = this.debugHover;
    if (hov !== this.hover) { this.hover = hov; if (hov) g.audio.play('ui_hover', { vol: 0.3 }); }
    if (this.drag?.moved) ui.tip = null;

    // ------------------------------------------------ scene
    this.drawSky(ctx, Lay, bk, ox, oy, t, reduced, night);
    ctx.drawImage(bk.canvas, ox, oy);
    if (this.prev && this.fade < 1 && this.prev !== bk) {
      ctx.globalAlpha = 1 - this.fade;
      ctx.drawImage(this.prev.canvas, Math.round(Lay.ax - this.prev.cx), Math.round(Lay.ay - this.prev.cy));
      ctx.globalAlpha = 1;
    }
    this.drawLife(ctx, bk, ox, oy, t, reduced);
    this.drawLocks(ctx, bk, ox, oy, t);
    const focus = this.hover || this.sel;
    for (const id of new Set([this.sel, this.hover])) {
      if (!id) continue;
      const ol = outlineFor(bk, LOCS.findIndex((L) => L.id === id) + 1);
      if (!ol) continue;
      ctx.globalAlpha = id === this.hover ? 0.55 + 0.25 * Math.sin(t * 6) : 0.35;
      ctx.drawImage(ol.canvas, ox + ol.x, oy + ol.y);
      ctx.globalAlpha = 1;
    }
    this.drawBoat(ctx, bk, ox, oy, t, dt, reduced);
    this.drawRuler(ctx, bk, ox, oy);
    this.drawPins(ctx, bk, ox, oy, t, reduced, cur);
    this.drawControls(ctx, ui, Lay);
    ctx.restore();

    // ------------------------------------------------ title + card + close
    this.drawBanner(ctx, view.x + view.w / 2, r.y + 3, 'WORLD MAP');
    this.listHover = null;
    this.drawCard(ctx, ui, card, LOC_BY_ID[focus] || LOC_BY_ID[cur], t);
    if (ui.button(ctx, r.x + r.w - 27, r.y + 8, 18, 17, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) ui.close(this.id);
    if (!this.sail && this.sel && (inp.keyPressed?.('Enter'))) this.trySail(LOC_BY_ID[this.sel]);

    // ------------------------------------------------ sailing -> travel
    if (this.sail) {
      this.sail.t += dt;
      if (this.sail.t >= this.sail.dur && !this.sail.done) {
        this.sail.done = true;
        const id = this.sail.to;
        const ok = g.travel?.(id);
        if (ok === false) { this.sail = null; g.audio.play('ui_error'); g.ui?.toast?.('The boat cannot sail right now.', 'map'); }
        else if (g.ui?.isOpen?.(this.id)) g.ui.close(this.id);
      }
    }
  }

  select(id) {
    if (this.sel !== id) { this.sel = id; this.game.audio.play('ui_click'); }
  }

  overControl(x, y, Lay) {
    const c = this.ctrlRect;
    return c && x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h;
  }

  trySail(L, sound = false) {
    if (!L || this.sail || L.id === this.current() || !this.unlocked(L.id)) return;
    if (sound) this.game.audio.play('travel_whoosh');
    const reduced = !!this.game.state.settings?.reducedMotion;
    this.sail = { from: this.current(), to: L.id, t: 0, dur: reduced ? 0.5 : 1.5 };
  }

  // Sky behind the diorama: aurora over the fjord, drifting voxel clouds, sun.
  drawSky(ctx, Lay, bk, ox, oy, t, reduced, night) {
    const { view } = Lay;
    const tt = reduced ? 0 : t;
    // sun / moon
    const sx = view.x + view.w - 64, sy = view.y + 46;
    ctx.globalAlpha = 0.14;
    ctx.drawImage(discSprite(22, night ? '#cfe0ff' : '#fff2b0'), sx - 22, sy - 22);
    ctx.globalAlpha = 0.25;
    ctx.drawImage(discSprite(16, night ? '#cfe0ff' : '#fff2b0'), sx - 16, sy - 16);
    ctx.globalAlpha = 1;
    if (night) {
      ctx.drawImage(discSprite(11, '#eef2fa'), sx - 11, sy - 11);
      ctx.drawImage(discSprite(3, '#c4cce0'), sx - 5, sy - 3);
      ctx.drawImage(discSprite(2, '#c4cce0'), sx + 3, sy + 2);
      ctx.drawImage(discSprite(1, '#c4cce0'), sx + 2, sy - 6);
    } else {
      ctx.fillStyle = '#ffe48a';
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU + tt * 0.1, r0 = 15, r1 = k % 2 ? 19 : 22;
        for (let q = r0; q <= r1; q++) ctx.fillRect(Math.round(sx + Math.cos(a) * q), Math.round(sy + Math.sin(a) * q), 1, 1);
      }
      ctx.drawImage(discSprite(12, '#ffe48a'), sx - 12, sy - 12);
      ctx.drawImage(discSprite(10, '#fff4c0'), sx - 11, sy - 11);
    }
    // aurora curtains above the fjord
    const fj = LOC_BY_ID.fjord, [ax, ay] = bk.proj(fj.pin[0] + M, SEA + 26, fj.pin[2] + M - 6);
    for (let i = 0; i < 60; i++) {
      const x = Math.round(ox + ax - 90 + i * 3);
      const wave = Math.sin(i * 0.22 + tt * 0.9) * 8 + Math.sin(i * 0.07 - tt * 0.5) * 6;
      const top = Math.round(oy + ay - 70 + wave), len = 34 + Math.round(Math.sin(i * 0.31 + tt * 1.3) * 10);
      const fadeE = Math.min(1, i / 10, (59 - i) / 10);
      for (let j = 0; j < len; j += 2) {
        const k = j / len;
        ctx.fillStyle = k < 0.3 ? '#c48aff' : '#5affb4';
        ctx.globalAlpha = fadeE * 0.22 * Math.sin(k * Math.PI) * (0.6 + 0.4 * Math.sin(i * 0.5 + tt * 2));
        ctx.fillRect(x, top + j, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
    // clouds (back layer)
    for (let i = 0; i < 4; i++) {
      const c = cloudSprite(1 + (i % 3));
      const span = view.w + c.w;
      const x = view.x - c.w + ((hash1(i, 21) * span + tt * (4 + i * 1.5)) % span);
      const y = view.y + 18 + i * 21 + Math.round(Math.sin(tt * 0.4 + i) * 2);
      ctx.globalAlpha = 0.55 + i * 0.1;
      ctx.drawImage(c.canvas, Math.round(x), Math.round(y));
    }
    ctx.globalAlpha = 1;
  }

  // Glow pulses, sparkles, waves, fish, bubbles, smoke: everything that moves on the diorama.
  drawLife(ctx, bk, ox, oy, t, reduced) {
    const tt = reduced ? 0 : t;
    // per-location glow pulses
    const pulse = {
      shallows: 0, fjord: 0.25 + 0.18 * Math.sin(tt * 1.7),
      junkyard: 0.25 + 0.2 * Math.sin(tt * 5) * (hash1(Math.floor(tt * 6), 3) < 0.15 ? 0 : 1),
      metropolis: 0.42 + 0.18 * Math.sin(tt * 2.4) - (hash1(Math.floor(tt * 9), 5) < 0.06 ? 0.3 : 0),
      volcano: 0.45 + 0.3 * Math.sin(tt * 1.6) + 0.1 * Math.sin(tt * 7.3), abyss: 0.35 + 0.3 * Math.sin(tt * 1.1),
    };
    ctx.globalCompositeOperation = 'lighter';
    LOCS.forEach((L, i) => {
      const gl = bk.glows[i];
      if (!gl || !this.unlocked(L.id)) return;
      ctx.globalAlpha = clamp01(pulse[L.id]);
      if (ctx.globalAlpha > 0.01) ctx.drawImage(gl.canvas, ox + gl.x, oy + gl.y);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // sea surface: blinking sparkles + drifting wave crests
    ctx.fillStyle = '#f4feff';
    const W = bk.W;
    bk.surfList.forEach((p, i) => {
      const ph = (tt * 0.55 + hash1(i, 9)) % 1;
      if (ph > 0.22) return;
      const x = p % W, y = (p / W) | 0, l = ph < 0.08 || ph > 0.16 ? 1 : 3;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(ox + x - (l >> 1), oy + y, l, 1);
    });
    ctx.globalAlpha = 0.32;
    for (let i = 0; i < 44; i++) {
      const x = M + ((hash1(i, 31) * BX + tt * (1.5 + hash1(i, 32) * 1.5)) % BX), z = M + hash1(i, 33) * BZ;
      const [sx, sy] = bk.proj(x, SEA, z);
      const qx = Math.floor(sx), qy = Math.floor(sy);
      if (qx < 0 || qy < 0 || qx >= W || qy >= bk.H || !bk.surf[qy * W + qx]) continue;
      ctx.fillRect(ox + qx - 1, oy + qy, 3, 1);
    }
    ctx.globalAlpha = 1;
    // fish schools
    LOCS.forEach((L, li) => {
      if (!this.unlocked(L.id)) return;
      const f = L.focus, fishCol = mix(L.color, '#1a4a8a', 0.35);
      const cyY = Math.min(SEA - 4, f[1] + 7);
      for (let k = 0; k < 5; k++) {
        const a = tt * (0.35 + (k % 2) * 0.1) + k * 0.5 + li;
        const x = f[0] + M + Math.cos(a) * (9 + (k % 3)), z = f[2] + M + Math.sin(a) * 6, y = cyY + Math.sin(a * 2 + k) * 1.5;
        const pt = bk.vis(x, y, z);
        if (!pt) continue;
        const dir = -Math.sin(a) * bk.cam.R[0] + Math.cos(a) * bk.cam.R[2] < 0 ? -1 : 1;
        const sx = Math.round(ox + pt[0]), sy = Math.round(oy + pt[1]);
        ctx.fillStyle = fishCol;
        ctx.fillRect(sx - 1, sy, 3, 2);
        ctx.fillRect(sx - 1 - dir * 2, sy, 1, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx + dir, sy, 1, 1);
      }
    });
    // bubbles from vents, the junk heap and the ruins
    ctx.fillStyle = '#c8f4ff';
    const vents = [[SMOKERS[0][0], SMOKERS[0][1], 0.5], [SMOKERS[2][0], SMOKERS[2][1], 0.6], [SMOKERS[1][0], SMOKERS[1][1], 0.4], [149, 92, 0.7], [30, 76, 0.4], [87, 78, 0.5]];
    vents.forEach(([u, w, sp], vi) => {
      const L = LOCS[[4, 4, 4, 5, 2, 3][vi]];
      if (!this.unlocked(L.id)) return;
      const gy = vi === 3 ? 12 : vi === 4 ? SEA - 16 : vi === 5 ? SEA - 2 : SEA - 38;
      for (let k = 0; k < 4; k++) {
        const ph = (tt * sp * 0.25 + k / 4 + vi * 0.13) % 1;
        const y = gy + ph * (SEA - gy);
        const pt = bk.vis(u + M + Math.sin(ph * 12 + k) * 0.8, y, w + M);
        if (!pt) continue;
        ctx.globalAlpha = 0.8;
        if (k % 2) ctx.fillRect(Math.round(ox + pt[0]), Math.round(oy + pt[1]), 1, 1);
        else { const bx = Math.round(ox + pt[0]), by = Math.round(oy + pt[1]); ctx.fillRect(bx, by - 1, 1, 1); ctx.fillRect(bx - 1, by, 1, 1); ctx.fillRect(bx + 1, by, 1, 1); ctx.fillRect(bx, by + 1, 1, 1); }
      }
    });
    ctx.globalAlpha = 1;
    // volcano smoke + embers
    if (this.unlocked('volcano') || true) {
      const [vx, vy] = bk.proj(VC[0] + M, SEA + 22, VC[1] + M);
      for (let k = 0; k < 9; k++) {
        const ph = (tt * 0.18 + k / 9) % 1;
        const rr = Math.round(2 + ph * 6);
        ctx.globalAlpha = (1 - ph) * 0.55;
        const c = discSprite(rr, ph < 0.25 ? '#6a5a64' : '#9a92a4');
        ctx.drawImage(c, Math.round(ox + vx - rr + Math.sin(ph * 5 + k) * 3 - ph * 18), Math.round(oy + vy - rr - ph * 48));
      }
      ctx.globalAlpha = 1;
      for (let k = 0; k < 6; k++) {
        const ph = (tt * 0.7 + hash1(k, 61)) % 1;
        ctx.fillStyle = ph < 0.5 ? '#ffd24a' : '#ff6a2a';
        ctx.globalAlpha = 1 - ph;
        ctx.fillRect(Math.round(ox + vx + (hash1(k, 62) - 0.5) * 14 * ph * 2), Math.round(oy + vy - ph * 26 + ph * ph * 10), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    // blinking warning lights (crane top, spire tip)
    if (Math.floor(tt * 1.6) % 2 === 0) {
      for (const [x, y, z] of [[M + 11, SEA + 20, M + 89], [M + 87, SEA + 8, M + 78]]) {
        const pt = bk.vis(x + 0.5, y + 0.5, z + 0.5);
        if (!pt) continue;
        ctx.globalAlpha = 0.6;
        ctx.drawImage(discSprite(3, '#ff5a4a'), Math.round(ox + pt[0] - 3), Math.round(oy + pt[1] - 3));
        ctx.globalAlpha = 1;
      }
    }
    // seagulls around the island
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 2; k++) {
      const a = tt * 0.5 + k * 3;
      const [gx, gy] = bk.proj(20 + M + Math.cos(a) * 14, SEA + 22 + k * 4, 22 + M + Math.sin(a) * 9);
      const flap = Math.floor(tt * 6 + k) % 2;
      const x = Math.round(ox + gx), y = Math.round(oy + gy);
      ctx.fillRect(x - 2, y - flap, 2, 1); ctx.fillRect(x + 1, y - flap, 2, 1); ctx.fillRect(x, y, 1, 1);
    }
  }

  drawLocks(ctx, bk, ox, oy, t) {
    LOCS.forEach((L, i) => {
      if (this.unlocked(L.id)) return;
      const fg = fogFor(bk, i + 1);
      if (fg) {
        ctx.globalAlpha = 0.9 + 0.1 * Math.sin(t * 0.8 + i);
        ctx.drawImage(fg.canvas, ox + fg.x + Math.round(Math.sin(t * 0.3 + i) * 1.5), oy + fg.y);
        ctx.globalAlpha = 1;
      }
    });
  }

  drawBoat(ctx, bk, ox, oy, t, dt, reduced) {
    const at = (id) => { const s = LOC_BY_ID[id].sea; return [s[0] + M, s[1] + M]; };
    let [x, z] = at(this.current()), heading = 200;
    let moving = false;
    if (this.sail) {
      const a = at(this.sail.from), b = at(this.sail.to);
      const k = ease.inOutCubic ? ease.inOutCubic(clamp01(this.sail.t / this.sail.dur)) : clamp01(this.sail.t / this.sail.dur);
      const mx = (a[0] + b[0]) / 2 + (b[1] - a[1]) * 0.25, mz = (a[1] + b[1]) / 2 - (b[0] - a[0]) * 0.25;
      const q = (u) => [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * mx + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * mz + u * u * b[1]];
      [x, z] = q(k);
      const [x2, z2] = q(Math.min(1, k + 0.02));
      heading = Math.atan2(z2 - z, x2 - x) / DEG;
      moving = true;
      // wake
      ctx.fillStyle = '#e8fcff';
      for (let i = 1; i < 14; i++) {
        const [wx, wz] = q(Math.max(0, k - i * 0.012));
        const [sx, sy] = bk.proj(wx, SEA, wz);
        ctx.globalAlpha = 0.7 * (1 - i / 14);
        ctx.fillRect(Math.round(ox + sx) - 1, Math.round(oy + sy), 2 + (i % 3 === 0 ? 1 : 0), 1);
      }
      ctx.globalAlpha = 1;
    }
    const spr = boatSprite(MAP_YAWS[this.yawI] + heading);
    const [sx, sy] = bk.proj(x, SEA, z);
    const bob = reduced ? 0 : Math.round(Math.sin(t * 2.4) * (moving ? 1.5 : 1));
    if (!moving && !reduced) {
      // idle ripples
      const ph = (t * 0.6) % 1, rr = 6 + ph * 10;
      ctx.strokeStyle = rgba('#e8fcff', 0.5 * (1 - ph));
      ctx.fillStyle = rgba('#e8fcff', 0.45 * (1 - ph));
      for (let a = 0; a < TAU; a += 0.35) ctx.fillRect(Math.round(ox + sx + Math.cos(a) * rr), Math.round(oy + sy + 1 + Math.sin(a) * rr * 0.45), 1, 1);
    }
    ctx.drawImage(spr.canvas, Math.round(ox + sx - spr.ox), Math.round(oy + sy - spr.oy + 2 + bob));
    this.boatPos = [ox + sx, oy + sy];
  }

  // Depth ruler on the silhouette's front vertical edge + depth-zone names on the glass.
  drawRuler(ctx, bk, ox, oy) {
    const left = MAP_YAWS[this.yawI] >= 0;
    const ex = left ? M : XR, side = left ? -1 : 1;
    const [tx0, ty0] = bk.proj(ex, SEA, ZF), [tx1, ty1] = bk.proj(ex, Y0, ZF);
    const x0 = Math.round(ox + tx0) + side * 5;
    ctx.fillStyle = rgba('#e8f6ff', 0.55);
    ctx.fillRect(x0, Math.round(oy + ty0), 1, Math.round(ty1 - ty0));
    for (const [d, label] of [[0, '0 m'], [8, '8'], [60, '60'], [140, '140'], [450, '450'], [900, '900'], [3200, '3,200']]) {
      const [, yy] = bk.proj(ex, depthY(d), ZF);
      const y = Math.round(oy + yy);
      ctx.fillStyle = '#e8f6ff';
      ctx.fillRect(left ? x0 - 3 : x0, y, 4, 1);
      drawText(ctx, label, x0 + side * 6, y - 2, { font: 'small', align: left ? 'right' : 'left', color: '#e8f6ff', shadow: rgba('#06121e', 0.8) });
    }
    const zones = [['SUNLIGHT ZONE', 0, ZONE1], ['TWILIGHT ZONE', ZONE1, ZONE2], ['MIDNIGHT ZONE', ZONE2, SEA - Y0]];
    for (const [name, a, b] of zones) {
      const [zx, zy] = bk.proj(left ? M + 3 : XR - 3, SEA - (a + b) / 2, ZF);
      drawText(ctx, name, Math.round(ox + zx) - side * 3, Math.round(oy + zy) - 2, { font: 'small', align: left ? 'left' : 'right', color: rgba('#e8f6ff', 0.75) });
    }
  }

  drawPins(ctx, bk, ox, oy, t, reduced, cur) {
    const hits = [];
    const rank = (L) => (L.id === this.hover ? 1e4 : L.id === this.sel ? 5e3 : 0) + bk.proj(L.pin[0] + M, L.pin[1], L.pin[2] + M)[1];
    const order = LOCS.map((L, i) => [L, i]).sort((a, b) => rank(a[0]) - rank(b[0]));
    for (const [L, i] of order) {
      const open = this.unlocked(L.id), isH = this.hover === L.id, isS = this.sel === L.id;
      const [px, py] = bk.proj(L.pin[0] + M, L.pin[1], L.pin[2] + M);
      const [fx, fy] = bk.proj(L.focus[0] + M, L.focus[1], L.focus[2] + M);
      const bob = reduced ? 0 : Math.round(Math.sin(t * 2.2 + i * 1.3) * 1.5);
      const x = Math.round(ox + px), y = Math.round(oy + py) + bob - (isH ? 2 : 0);
      // leader line down to the location
      const fy2 = Math.round(oy + fy);
      ctx.fillStyle = rgba(open ? '#ffffff' : '#c8d2e0', isH || isS ? 0.75 : 0.4);
      for (let yy = y + 2; yy < fy2; yy += 3) ctx.fillRect(Math.round(lerp(x, ox + fx, (yy - y) / Math.max(1, fy2 - y))), yy, 1, 1);
      let top;
      if (open) {
        const spr = pinSprite(L.color);
        ctx.drawImage(spr.canvas, x - spr.ox, y - spr.oy);
        top = y - spr.oy;
        if (isS) {
          ctx.fillStyle = rgba('#ffffff', 0.5 + 0.3 * Math.sin(t * 5));
          const rr = 7 + Math.sin(t * 5) * 1;
          for (let a = 0; a < TAU; a += 0.3) ctx.fillRect(Math.round(x + Math.cos(a) * rr), Math.round(oy + fy + Math.sin(a) * rr * 0.45), 1, 1);
        }
      } else {
        // padlock with chains draped down to the location
        const lk = padlockSprite();
        const lx = x - Math.round(lk.w / 2), ly = y - lk.h + 4;
        for (const dx of [-14, 14]) this.drawChain(ctx, x + dx * 0.15, ly + lk.h - 6, x + dx, Math.min(fy2, ly + lk.h + 22));
        ctx.drawImage(lk.canvas, lx, ly);
        top = ly;
      }
      // label plate
      const name = L.name, depth = `${formatCommas(L.depth)} m`;
      const nw = measureText(name), dw = measureText(depth, 'small');
      const w = nw + dw + 16, h = 13;
      const lx = Math.round(x - w / 2), ly = top - h - 2;
      ctx.fillStyle = rgba('#06121e', isH ? 0.92 : 0.72);
      ctx.fillRect(lx + 1, ly, w - 2, h); ctx.fillRect(lx, ly + 1, w, h - 2);
      ctx.fillStyle = open ? L.color : '#7a8494';
      ctx.fillRect(lx + 1, ly + h - 1, w - 2, 1);
      if (isH || isS) { ctx.fillStyle = rgba(open ? L.color : '#c8d2e0', 0.9); ctx.fillRect(lx + 1, ly - 1, w - 2, 1); }
      drawText(ctx, name, lx + 5, ly + 3, { color: open ? '#ffffff' : '#a8b2c2' });
      drawText(ctx, depth, lx + 10 + nw, ly + 4, { font: 'small', color: open ? mix(L.color, '#ffffff', 0.4) : '#8a94a4' });
      if (L.id === cur) {
        drawText(ctx, 'YOU ARE HERE', x, ly - 8, { font: 'small', align: 'center', color: '#ffe08a', shadow: rgba('#06121e', 0.9) });
      }
      hits.push({ id: L.id, x: lx, y: ly - 2, w, h: Math.max(h + 4, y - ly + 4) });
    }
    this.pinHits = hits;
  }

  drawChain(ctx, x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.floor(len / 3));
    for (let i = 0; i <= n; i++) {
      const k = i / n, sag = Math.sin(k * Math.PI) * 3;
      const x = Math.round(lerp(x0, x1, k)), y = Math.round(lerp(y0, y1, k) + sag);
      if (i % 2) { ctx.fillStyle = '#3a4252'; ctx.fillRect(x - 1, y - 1, 3, 3); ctx.fillStyle = '#c8d0dc'; ctx.fillRect(x - 1, y - 1, 2, 1); ctx.fillStyle = '#7a8496'; ctx.fillRect(x, y, 1, 1); }
      else { ctx.fillStyle = '#3a4252'; ctx.fillRect(x, y - 1, 1, 3); ctx.fillStyle = '#e0e6f0'; ctx.fillRect(x, y - 1, 1, 1); }
    }
  }

  // Rotate arrows + a little compass that turns with the diorama.
  drawControls(ctx, ui, Lay) {
    const { view } = Lay;
    const x = view.x + 8, y = view.y + view.h - 30;
    this.ctrlRect = { x, y, w: 92, h: 22 };
    ctx.fillStyle = rgba('#06121e', 0.55);
    ctx.fillRect(x - 2, y - 2, 96, 26);
    if (ui.button(ctx, x, y, 22, 20, '', { icon: 'arrow_l', style: 'shell', tip: 'Rotate (drag the map, wheel or arrow keys)', disabled: this.yawI === 0 })) this.setYaw(this.yawI - 1);
    if (ui.button(ctx, x + 70, y, 22, 20, '', { icon: 'arrow_r', style: 'shell', tip: 'Rotate (drag the map, wheel or arrow keys)', disabled: this.yawI === MAP_YAWS.length - 1 })) this.setYaw(this.yawI + 1);
    const cx = x + 46, cy = y + 10, a = -MAP_YAWS[this.yawI] * DEG;
    ctx.fillStyle = '#e8d8b0';
    for (let k = 0; k < TAU; k += 0.2) ctx.fillRect(Math.round(cx + Math.cos(k) * 9), Math.round(cy + Math.sin(k) * 9), 1, 1);
    for (let k = 0; k < 4; k++) {
      const aa = a + (k * Math.PI) / 2 - Math.PI / 2;
      for (let s = 1; s <= (k === 0 ? 8 : 5); s++) {
        ctx.fillStyle = k === 0 ? '#ff6a5a' : '#f4ead0';
        ctx.fillRect(Math.round(cx + Math.cos(aa) * s), Math.round(cy + Math.sin(aa) * s), 1, 1);
      }
    }
    for (let i = 0; i < MAP_YAWS.length; i++) {
      ctx.fillStyle = i === this.yawI ? '#ffe08a' : rgba('#f4ead0', 0.4);
      ctx.fillRect(x + 25 + i * 7, y + 23, 4, 1);
    }
  }

  drawBanner(ctx, cx, y, text) {
    const tw = measureText(text, 'normal', 2) + 26;
    const x = Math.round(cx - tw / 2);
    ctx.fillStyle = shade(RED, -0.45);
    ctx.fillRect(x - 10, y + 6, 14, 12); ctx.fillRect(x + tw - 4, y + 6, 14, 12);
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(x - 10, y + 10, 3, 4); ctx.fillRect(x + tw + 7, y + 10, 3, 4);
    ctx.fillStyle = '#2a0a08';
    ctx.fillRect(x, y, tw, 21);
    ctx.fillStyle = RED;
    ctx.fillRect(x + 1, y + 1, tw - 2, 19);
    ctx.fillStyle = shade(RED, 0.35);
    ctx.fillRect(x + 1, y + 1, tw - 2, 2);
    drawText(ctx, text, Math.round(cx), y + 4, { align: 'center', scale: 2, color: '#fff0d8', shadow: shade(RED, -0.6) });
  }

  drawCard(ctx, ui, rc, L, t) {
    const g = this.game, st = g.state;
    const open = this.unlocked(L.id), here = L.id === this.current();
    drawPaper(ctx, rc.x, rc.y, rc.w, rc.h, { aged: true });
    const x = rc.x + 9, w = rc.w - 18;
    let y = rc.y + 8;
    // header band
    const band = open ? L.color : '#8a92a2';
    ctx.fillStyle = shade(band, -0.55);
    ctx.fillRect(x, y, w, 32);
    ctx.fillStyle = shade(band, -0.25);
    ctx.fillRect(x + 1, y + 1, w - 2, 30);
    ctx.fillStyle = rgba('#ffffff', 0.18);
    ctx.fillRect(x + 1, y + 1, w - 2, 2);
    if (open) { const pin = pinSprite(L.color); ctx.drawImage(pin.canvas, x + 4, y + 4); } else { const lk = padlockSprite(); ctx.drawImage(lk.canvas, x + 3, y + 5); }
    const big = measureText(L.name, 'normal', 2) <= w - 26;
    drawText(ctx, L.name, x + 22, y + (big ? 4 : 6), { scale: big ? 2 : 1, color: '#ffffff', shadow: shade(band, -0.7) });
    drawText(ctx, L.sub.toUpperCase(), x + 22, y + (big ? 22 : 18), { font: 'small', color: mix(band, '#ffffff', 0.7) });
    y += 40;
    // stats
    const row = (label, value, yy) => {
      drawText(ctx, label, x, yy, { font: 'small', color: INK_L });
      drawText(ctx, value, x + w, yy - 1, { align: 'right', color: INK });
    };
    row('DEPTH', `${formatCommas(L.depth)} m`, y);
    drawBar(ctx, x, y + 9, w, 6, clamp01(Math.log10(L.depth + 1) / Math.log10(3201)), { color: '#3a7ac8', back: '#d8c8a0' });
    y += 22;
    const [got, tot] = this.fishCount(L);
    row('FISH DISCOVERED', tot ? `${got} / ${tot}` : '? / ?', y);
    drawBar(ctx, x, y + 9, w, 6, tot ? got / tot : 0, { color: open ? shade(L.color, -0.15) : '#9a9aa4', back: '#d8c8a0' });
    y += 22;
    // weather
    drawText(ctx, 'WEATHER', x, y, { font: 'small', color: INK_L });
    y += 9;
    if (here && g.ocean) {
      const wid = g.ocean.weather || 'calm', wdef = WEATHER[wid] || ['cloud', g.ocean.weatherName?.() || 'Calm'];
      ctx.drawImage(getUiIcon(wdef[0]) || getUiIcon('cloud'), x, y);
      let txt = g.ocean.weatherName?.() || wdef[1];
      if (g.stats?.forecast) txt += `  ~${Math.max(1, Math.round((g.ocean.weatherT || 0) / 60))} min`;
      drawText(ctx, txt, x + 14, y + 2, { color: INK });
      y += 14;
    } else {
      const ws = L.weathers.map((id) => WEATHER[id] || ['cloud', id]);
      let wx = x;
      for (const [icon] of ws) { ctx.drawImage(getUiIcon(icon) || getUiIcon('cloud'), wx, y); wx += 13; }
      const names = ws.map((q) => q[1]).join(', ');
      const lines = wrapText(names, w - (wx - x) - 2, 'small');
      lines.slice(0, 2).forEach((l, i) => drawText(ctx, l.toUpperCase(), wx + 2, y + 1 + i * 7, { font: 'small', color: INK_L }));
      y += 18;
    }
    if (g.stats?.forecast && open) {
      const rare = SPECIES.filter((s) => s.biome === L.id && s.spawn?.weather);
      if (rare.length) {
        const txt = 'RARE: ' + rare.slice(0, 3).map((s) => `${st.journal?.[s.id]?.caught ? s.name : '???'} (${(WEATHER[s.spawn.weather] || ['', s.spawn.weather])[1]})`).join(', ');
        wrapText(txt.toUpperCase(), w, 'small').slice(0, 2).forEach((l, i) => drawText(ctx, l, x, y + i * 7, { font: 'small', color: RED }));
        y += 16;
      }
    }
    ctx.fillStyle = rgba(INK_L, 0.4);
    ctx.fillRect(x, y, w, 1);
    y += 6;
    // description or unlock checklist
    if (open) {
      wrapText(L.desc, w).slice(0, 4).forEach((l, i) => drawText(ctx, l, x, y + i * 10, { color: INK_L }));
      y += Math.min(4, wrapText(L.desc, w).length) * 10 + 4;
    } else {
      drawText(ctx, 'TO SAIL HERE YOU NEED:', x, y, { font: 'small', color: RED });
      y += 9;
      for (const q of this.requirements(L)) {
        ctx.drawImage(getUiIcon(q.ok ? 'check' : 'cross'), x, y - 1);
        const sub = q.sub === 'skill' ? '' : ` (${q.sub})`;
        const lines = wrapText(q.text + sub, w - 14);
        lines.slice(0, 2).forEach((l, i) => drawText(ctx, l, x + 13, y + 1 + i * 9, { color: q.ok ? '#3a6a2a' : INK }));
        y += 9 * Math.min(2, lines.length) + 3;
      }
      drawText(ctx, 'UNLOCK IT IN THE SKILL TREE', x, y + 1, { font: 'small', color: INK_L });
      y += 10;
    }
    // travel button
    const bw = w, bh = 24, bx = x, by = rc.y + rc.h - bh - 9;
    // destinations list (also a way to select without hunting on the diorama)
    const rowH = 15, listH = LOCS.length * rowH + 12;
    const ly = by - listH - 6;
    if (ly > y + 4) {
      ctx.fillStyle = rgba(INK_L, 0.4);
      ctx.fillRect(x, ly, w, 1);
      drawText(ctx, 'DESTINATIONS', x, ly + 4, { font: 'small', color: INK_L });
      LOCS.forEach((D, i) => {
        const ry = ly + 12 + i * rowH, rr = { x: x - 2, y: ry - 1, w: w + 4, h: rowH - 1 };
        const isOpen = this.unlocked(D.id), isSel = this.sel === D.id, isHere = D.id === this.current();
        const hv = !this.sail && ui.hover(rr);
        if (hv) { this.listHover = D.id; ui.tip = null; }
        if (isSel || hv) { ctx.fillStyle = rgba(isSel ? D.color : '#ffffff', isSel ? 0.28 : 0.35); ctx.fillRect(rr.x, rr.y, rr.w, rr.h); }
        if (isOpen) { ctx.fillStyle = shade(D.color, -0.45); ctx.fillRect(x + 1, ry + 2, 7, 7); ctx.fillStyle = D.color; ctx.fillRect(x + 2, ry + 3, 5, 5); ctx.fillStyle = mix(D.color, '#ffffff', 0.6); ctx.fillRect(x + 3, ry + 4, 2, 1); }
        else ctx.drawImage(getUiIcon('lock'), x, ry + 1);
        drawText(ctx, D.name, x + 12, ry + 2, { color: isOpen ? INK : '#9a8a74' });
        const right = isHere ? 'HERE' : `${formatCommas(D.depth)} M`;
        drawText(ctx, right, x + w, ry + 3, { font: 'small', align: 'right', color: isHere ? RED : INK_L });
        if (hv && g.input.pressed) {
          g.input.pressed = false;
          this.select(D.id);
          if (g.input.dblclick) this.trySail(D, true);
        }
      });
    }
    if (this.sail) {
      drawButton(ctx, bx, by, bw, bh, { label: 'Sailing...', icon: getUiIcon('map'), state: 'down', style: 'wood' });
    } else if (here) {
      drawButton(ctx, bx, by, bw, bh, { label: 'You are here', icon: getUiIcon('home'), state: 'disabled', style: 'wood' });
    } else if (open) {
      if (ui.button(ctx, bx, by, bw, bh, `Sail to ${L.name.replace('The ', '')}`, { icon: 'map', style: 'wood', sound: 'travel_whoosh', tip: `Travel to ${L.name}` })) {
        this.sel = L.id;
        this.trySail(L);
      }
    } else {
      drawButton(ctx, bx, by, bw, bh, { label: 'Locked', icon: getUiIcon('lock'), state: 'disabled', style: 'wood' });
      if (ui.hover({ x: bx, y: by, w: bw, h: bh })) {
        ui.tip = 'Unlock it in the Skill Tree (Expeditions)';
        if (g.input.pressed) { g.input.pressed = false; g.audio.play('ui_error'); }
      }
    }
  }
}

// Dev hooks (src/dev/mapview.js).
export const __mapDev = { buildDiorama, bakeView, getDio, getBake, outlineFor, fogFor, BAKES };
