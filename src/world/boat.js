// The player's voxel fishing boat: a hand-modelled trawler (planked hull in the player's paint colour, white
// wheelhouse with lit windows, mast with a waving flag, rigging, rod holders, fenders, life ring, lantern,
// anchor, crates and a smoking stovepipe). It rides the simulated surface (biome waves + the water sim), rolls
// with the slope, can be grabbed and dragged along the surface (leaving a wake), and carries the fisherman
// (drawCharacter) on its working deck, between the hull and the near bulwark.
//
// API (docs/ARCHITECTURE.md "Boat"): update(dt, inp), draw(ctx, env) (world space), hit(wx, wy), rodTip(),
// fields x, y (waterline), dir, dragging, bob, pose, poseT, holdFish. Extras: drawLights(ctx, dark) (after the
// lighting pass), lights() (light sources for the lighting pass), deck() (where the fisherman stands).

import { VoxelModel } from '../gfx/voxel.js';
import { drawCharacter } from '../gfx/character.js';
import { makeLayer, resizeLayer } from '../core/canvas.js';
import { clamp, clamp01, damp, smoothstep, hash2, TAU } from '../core/math.js';
import { mix, shade } from '../core/color.js';
import { rng } from '../core/rng.js';
import { rollModel, mirrorModel, idOverlay, idPaint, renderModel } from './voxkit.js';
import { glowSprite } from './scenery.js';

const VS = 2;            // px per voxel
const YAW = 10, PITCH = 16;
const ROLLS = [-9, -6, -3, 0, 3, 6, 9];
const X0 = 10, LEN = 64; // hull spans x = X0 .. X0 + LEN - 1
const ZC = 11, NZ = 23;
const WL = 6;            // waterline (voxel y)
const DECK = 10;         // deck plank layer
const PIVOT = [X0 + LEN / 2, WL];
const ANCH = { stand: [X0 + 33, DECK + 1, ZC], lantern: [16, 24, ZC + 6], mast: [X0 + 40, 57, ZC], chimney: [20, 37, 8], flag: [X0 + 40, 56, ZC] };

// ------------------------------------------------------------------ model

function buildModel(paint) {
  const m = new VoxelModel(90, 70, NZ);
  const C = (hex, o = {}) => m.color(hex, o);
  const pal = {
    bottom: C(mix(paint, '#1c2034', 0.72), { jitter: 0.12 }),
    boot: C('#f2ead6', { jitter: 0.05 }),
    paint: C(paint, { jitter: 0.1 }),
    seam: C(shade(paint, -0.16), { jitter: 0.06 }),
    strake: C('#efe2c2', { jitter: 0.05 }),
    cap: C('#8a5a32', { jitter: 0.1 }),
    rail: C('#e8dcc0', { jitter: 0.04 }),
    deck: C('#c99a62', { jitter: 0.14 }),
    deckSeam: C('#a07246', { jitter: 0.08 }),
    wall: C('#f1ebdc', { jitter: 0.06 }),
    trim: C('#7e5230', { jitter: 0.08 }),
    roof: C(mix('#2f7f8f', paint, 0.12), { jitter: 0.08 }),
    roofRim: C('#e8e0cc', { jitter: 0.04 }),
    glass: C('#86c8e4', { jitter: 0.02, spec: 0.8, edge: 0.4 }),
    glassHi: C('#dff6ff', { jitter: 0 }),
    metal: C('#4c505e', { jitter: 0.06, spec: 0.5 }),
    brass: C('#d8a84a', { jitter: 0.04, spec: 0.9 }),
    rope: C('#d8c08a', { jitter: 0.1 }),
    red: C('#e2483a', { jitter: 0.06 }),
    white: C('#f4f0e6', { jitter: 0.04 }),
    lamp: C('#ffe08a', { emissive: 0.85 }),
    mastLamp: C('#fff6d8', { emissive: 1 }),
    tip: C('#ff5a4a', { emissive: 1 }),
    wood: C('#9a6a3c', { jitter: 0.1 }),
    crate: C('#b8864e', { jitter: 0.14 }),
    crateDark: C('#7a5230', { jitter: 0.08 }),
    barrel: C('#8a5a34', { jitter: 0.1 }),
    hoop: C('#5a5e6a', { jitter: 0.05 }),
    net: C('#5aa070', { jitter: 0.2 }),
    fish: C('#9ad0e0', { jitter: 0.1, spec: 0.6 }),
    bucket: C('#3e8acc', { jitter: 0.06 }),
    orange: C('#ff8a2a', { jitter: 0.06 }),
  };
  const sm = (a, b, v) => smoothstep(a, b, v);
  const keel = (u) => 2 * (1 - sm(0, 8, u)) + 9 * Math.pow(sm(40, 63, u), 1.8);
  const sheer = (u) => 11.4 + 0.9 * (1 - sm(0, 18, u)) + 5.2 * Math.pow(sm(30, 64, u), 1.5);
  const beam = (u) => (u < 34 ? 8.2 + 1.3 * sm(0, 26, u) : 9.5 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 34) / 30.5, 2))));
  const deckAt = (u) => DECK + Math.floor(Math.max(0, u - 46) * 0.22);
  // ---- hull
  for (let u = 0; u < LEN; u++) {
    const x = X0 + u, yb = Math.round(keel(u)), ys = Math.round(sheer(u)), hb = beam(u), dk = deckAt(u);
    for (let y = yb; y <= ys; y++) {
      const t = (y - yb) / Math.max(1, ys - yb);
      const w = Math.max(0.6, hb * (0.3 + 0.7 * Math.pow(t, 0.5)));
      for (let z = 0; z < NZ; z++) {
        const dz = Math.abs(z + 0.5 - ZC - 0.5);
        if (dz > w) continue;
        const shell = dz > w - 1.25;
        if (y > dk && !shell) continue; // open deck well above the planks
        let c;
        if (!shell && y === dk) c = (z % 3 === 0) ? pal.deckSeam : pal.deck;
        else if (y === ys) c = pal.cap;
        else if (y === ys - 1) c = pal.strake;
        else if (y <= WL - 1) c = pal.bottom;
        else if (y <= WL + 1) c = pal.boot;
        else c = (y - WL) % 3 === 0 ? pal.seam : pal.paint;
        m.set(x, y, z, c);
      }
    }
    // keel strip
    m.set(x, yb, ZC, pal.trim);
  }
  // stem post, transom edge, bowsprit
  for (let y = Math.round(keel(LEN - 1)); y <= Math.round(sheer(LEN - 1)) + 2; y++) m.set(X0 + LEN - 1, y, ZC, pal.cap);
  for (let y = 2; y <= 12; y++) for (let z = ZC - 7; z <= ZC + 7; z++) if (m.get(X0, y, z)) m.set(X0, y, z, y >= 12 ? pal.cap : y <= WL - 1 ? pal.bottom : pal.trim);
  m.line(X0 + LEN - 2, 17, ZC, X0 + LEN + 8, 19, ZC, pal.cap, 0.7);
  // railing posts + rail on both sides
  for (let u = 2; u < LEN - 4; u++) {
    const x = X0 + u, ys = Math.round(sheer(u)), hb = beam(u);
    for (const side of [-1, 1]) {
      const z = Math.round(ZC + side * (hb - 0.6));
      if (u % 5 === 0) { m.set(x, ys + 1, z, pal.rail); m.set(x, ys + 2, z, pal.rail); }
      m.set(x, ys + 3, z, pal.rail);
    }
  }
  // ---- wheelhouse
  const cx0 = X0 + 6, cx1 = X0 + 24, cz0 = ZC - 6, cz1 = ZC + 5, cy0 = DECK + 1, cy1 = DECK + 17;
  m.box(cx0, cy0, cz0, cx1, cy1, cz1, (x, y, z) => {
    if (y === cy0) return pal.trim;
    const edgeX = x === cx0 || x === cx1, edgeZ = z === cz0 || z === cz1;
    if (edgeX && edgeZ) return pal.trim;
    return pal.wall;
  });
  // side windows (near face) with frames and a highlight
  for (const wx of [cx0 + 2, cx0 + 7, cx0 + 12]) {
    m.box(wx - 1, cy0 + 7, cz1, wx + 4, cy0 + 14, cz1, pal.trim);
    m.box(wx, cy0 + 8, cz1, wx + 3, cy0 + 13, cz1, pal.glass);
    m.set(wx, cy0 + 13, cz1, pal.glassHi); m.set(wx + 1, cy0 + 12, cz1, pal.glassHi);
  }
  // windscreen (bow face)
  m.box(cx1, cy0 + 7, cz0 + 1, cx1, cy0 + 14, cz1 - 1, pal.trim);
  m.box(cx1, cy0 + 8, cz0 + 2, cx1, cy0 + 13, cz1 - 2, pal.glass);
  // nameboard stripe under the windows
  m.box(cx0 + 1, cy0 + 4, cz1, cx1 - 1, cy0 + 4, cz1, (x) => (x % 2 ? pal.paint : pal.seam));
  // roof with overhang and rim
  m.box(cx0 - 2, cy1 + 1, cz0 - 1, cx1 + 2, cy1 + 1, cz1 + 1, pal.roofRim);
  m.box(cx0 - 1, cy1 + 2, cz0, cx1 + 1, cy1 + 2, cz1, pal.roof);
  // stovepipe, searchlight, antenna
  m.cylinder(cx0 + 4, cz0 + 3, cy1 + 3, cy1 + 8, 1.2, pal.metal);
  m.box(cx0 + 3, cy1 + 9, cz0 + 2, cx0 + 5, cy1 + 9, cz0 + 4, pal.metal);
  m.box(cx1 - 3, cy1 + 3, cz1 - 3, cx1 - 1, cy1 + 4, cz1 - 1, pal.white);
  m.box(cx1, cy1 + 3, cz1 - 3, cx1, cy1 + 4, cz1 - 1, pal.glassHi);
  m.line(cx0 + 9, cy1 + 3, cz0 + 2, cx0 + 9, cy1 + 15, cz0 + 2, pal.metal, 0);
  m.line(cx0 + 7, cy1 + 12, cz0 + 2, cx0 + 11, cy1 + 12, cz0 + 2, pal.metal, 0);
  m.set(cx0 + 9, cy1 + 16, cz0 + 2, pal.tip);
  // hanging lantern under the stern overhang
  const [lx, ly, lz] = ANCH.lantern;
  m.line(lx, ly + 4, lz, lx, ly + 2, lz, pal.metal, 0);
  m.box(lx - 1, ly - 2, lz - 1, lx + 1, ly + 1, lz + 1, pal.lamp);
  m.box(lx - 1, ly + 2, lz - 1, lx + 1, ly + 2, lz + 1, pal.metal);
  m.box(lx - 1, ly - 3, lz - 1, lx + 1, ly - 3, lz + 1, pal.metal);
  for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let y = ly - 2; y <= ly + 1; y++) m.set(lx + ax, y, lz + az, pal.metal);
  // ---- mast, spreader, masthead lamp, stays, boom with a net
  const mx = ANCH.mast[0];
  m.cylinder(mx, ZC, DECK + 1, 55, 0.9, pal.wood);
  m.box(mx, 47, ZC - 5, mx, 47, ZC + 5, pal.wood);
  m.set(mx, 56, ZC, pal.mastLamp);
  m.line(mx, 54, ZC, X0 + LEN, 18, ZC, pal.rope, 0);
  m.line(mx, 54, ZC, cx1 + 1, cy1 + 2, ZC, pal.rope, 0);
  m.line(mx, 47, ZC - 5, mx + 6, DECK + 2, ZC - 7, pal.rope, 0);
  m.line(mx, 47, ZC + 5, mx + 6, DECK + 2, ZC + 7, pal.rope, 0);
  m.line(mx, 19, ZC, mx + 13, 27, ZC, pal.wood, 0.6);
  m.line(mx + 13, 27, ZC, mx + 13, 22, ZC, pal.rope, 0);
  m.ellipsoid(mx + 13, 20, ZC, 2.2, 2.8, 2, pal.net);
  m.set(mx + 13, 19, ZC + 2, pal.fish); m.set(mx + 12, 21, ZC + 2, pal.orange);
  // ---- deck cargo: crates, barrel, coiled rope, fish bucket
  m.box(X0 + 46, DECK + 1, ZC - 6, X0 + 51, DECK + 6, ZC - 1, (x, y, z) => (x === X0 + 46 || x === X0 + 51 || y === DECK + 6 || y === DECK + 1 ? pal.crateDark : pal.crate));
  m.box(X0 + 47, DECK + 7, ZC - 5, X0 + 50, DECK + 10, ZC - 2, (x, y) => (y === DECK + 10 || x === X0 + 47 || x === X0 + 50 ? pal.crateDark : pal.crate));
  m.cylinder(X0 + 54, ZC + 3, DECK + 1, DECK + 7, 2.2, (x, y) => (y === DECK + 2 || y === DECK + 6 ? pal.hoop : pal.barrel));
  for (let a = 0; a < TAU; a += 0.3) m.set(X0 + 30 + Math.round(Math.cos(a) * 2), DECK + 1, ZC - 5 + Math.round(Math.sin(a) * 2), pal.rope);
  m.cylinder(X0 + 3, ZC + 4, DECK + 1, DECK + 4, 1.6, pal.bucket);
  m.set(X0 + 3, DECK + 5, ZC + 4, pal.fish);
  // ---- rod holders with spare rods leaning over the stern
  for (const [hx, hz, tx, ty] of [[X0 + 2, ZC + 6, 2, 38], [X0 + 3, ZC - 5, 5, 41]]) {
    m.line(hx, DECK + 1, hz, hx, DECK + 5, hz, pal.metal, 0);
    m.line(hx, DECK + 4, hz, tx, ty, hz, pal.trim, 0);
    m.set(hx - 1, DECK + 7, hz, pal.brass);
    m.set(tx, ty, hz, pal.red);
  }
  // ---- fenders (buoys) and a life ring on the near side
  for (const [u, col] of [[14, pal.red], [27, pal.white], [44, pal.orange]]) {
    const z = Math.round(ZC + beam(u) + 0.8), x = X0 + u, top = Math.round(sheer(u)) + 2;
    m.line(x, top, z - 1, x, 11, z, pal.rope, 0);
    m.cylinder(x, z, 6, 10, 1.3, (xx, y) => (y === 8 && col !== pal.white ? pal.white : col), 'y');
  }
  {
    const u = 33, x = X0 + u, z = Math.round(ZC + beam(u) + 0.6), cy = 10.5;
    for (let a = 0; a < TAU; a += 0.12) {
      const px = x + Math.cos(a) * 2.6, py = cy + Math.sin(a) * 2.6;
      m.set(px, py, z, Math.floor(((a + 0.4) / TAU) * 4) % 2 ? pal.red : pal.white);
    }
  }
  // ---- portholes
  for (const u of [8, 16, 50]) {
    const x = X0 + u, z = Math.round(ZC + beam(u) * (0.3 + 0.7 * Math.pow((8.5 - keel(u)) / Math.max(1, sheer(u) - keel(u)), 0.5)));
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) m.set(x + dx, 9 + dy, z, pal.brass);
    m.set(x, 9, z, pal.glass);
  }
  // ---- anchor at the bow
  {
    const x = X0 + 58, z = Math.round(ZC + beam(58) + 0.4);
    m.line(x, 13, z, x, 8, z, pal.metal, 0);
    m.line(x - 1, 12, z, x + 1, 12, z, pal.metal, 0);
    m.line(x - 2, 9, z, x, 7, z, pal.metal, 0); m.line(x + 2, 9, z, x, 7, z, pal.metal, 0);
    m.set(x - 2, 10, z, pal.metal); m.set(x + 2, 10, z, pal.metal);
  }
  // near bulwark/rail/fender voxels become "front" twins (drawn over the fisherman's feet)
  const twins = new Map();
  const front = new Set();
  for (const k of ['paint', 'seam', 'strake', 'cap', 'rail', 'rope', 'red', 'white', 'orange', 'brass', 'metal', 'glass']) {
    const pe = m.palette[pal[k]];
    const idx = m.color(pe.color, { ...pe });
    twins.set(pal[k], idx);
    front.add(idx);
  }
  for (let x = cx1 + 1; x < 90; x++) for (let y = DECK + 1; y < 70; y++) for (let z = ZC + 4; z < NZ; z++) {
    const v = m.get(x, y, z);
    if (v && twins.has(v)) m.set(x, y, z, twins.get(v));
  }
  const night = new Map([[pal.glass, '#ffcf6e'], [twins.get(pal.glass), '#ffcf6e'], [pal.glassHi, '#ffe9b0'], [pal.lamp, '#fff0b8'], [pal.mastLamp, '#ffffff'], [pal.tip, '#ff6a50']]);
  return { m, front, night };
}

function buildFlag(paint) {
  const w = 12, h = 8;
  const m = new VoxelModel(w, h, 1);
  const field = m.color('#f6f0e2', { jitter: 0.04 }), edge = m.color(paint, { jitter: 0.05 }), fishC = m.color(mix(paint, '#1a2a4a', 0.35), { jitter: 0.04 }), eye = m.color('#f6f0e2');
  const rows = [
    '............',
    '.....###....',
    '...######..#',
    '..#######.##',
    '..########..',
    '...######.##',
    '.....###...#',
    '............',
  ];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[h - 1 - y][x];
    m.set(x, y, 0, x === 0 || y === 0 || y === h - 1 ? edge : ch === '#' ? fishC : field);
  }
  m.set(4, 4, 0, eye);
  return renderModel(m, { scale: VS, yaw: 0, pitch: 0, outline: true, edges: 0, sideEdges: 0 });
}

// ------------------------------------------------------------------ boat

export class Boat {
  constructor(game) {
    this.game = game;
    this.x = Math.round((game.screen?.W || 960) * 0.56);
    this.y = 0;
    this.vx = 0; this.vy = 0;
    this.dir = 1;
    this.roll = 0; this.rollV = 0;
    this.bob = 0;
    this.lift = 0;
    this.dragging = false;
    this.hover = false;
    this.grabDX = 0;
    this.pose = 'idle'; this.poseT = 0; this.lastPose = 'idle';
    this.holdFish = null;
    this.facing = 1;
    this.t = 0;
    this.turnT = 0;
    this.wakeT = 0;
    this.smoke = [];
    this.smokeT = 0;
    this.cache = new Map();
    this.paint = null;
    this.layer = makeLayer(8, 8);
    this.anchors = null;
    this.placed = false;
    this.visible = false;
  }

  get ocean() { return this.game.ocean; }

  paintColor() { return this.game.state?.character?.boat || '#c8583a'; }

  // ---------------------------------------------------------------- sprites
  ensureModel() {
    const paint = this.paintColor();
    if (paint === this.paint && this.base) return;
    this.paint = paint;
    this.cache.clear();
    const b = buildModel(paint);
    this.base = b;
    this.mirror = { m: mirrorModel(b.m), front: b.front, night: b.night };
    this.flag = buildFlag(paint);
  }

  sprite(dir, ri) {
    this.ensureModel();
    const key = dir + ':' + ri;
    let s = this.cache.get(key);
    if (s) return s;
    const src = dir > 0 ? this.base : this.mirror;
    const sp = Math.sin((PITCH * Math.PI) / 180), cp = Math.cos((PITCH * Math.PI) / 180);
    const comp = (Math.atan((sp * Math.tan((YAW * Math.PI) / 180)) / cp) * 180) / Math.PI;
    const yaw = dir > 0 ? YAW : -YAW;
    const deg = ROLLS[ri] + (dir > 0 ? comp : -comp);
    const mx = (x) => (dir > 0 ? x : 90 - x);
    const pv = [mx(PIVOT[0]), PIVOT[1]];
    const { model, map } = rollModel(src.m, deg, pv[0], pv[1]);
    const r = renderModel(model, { scale: VS, yaw, pitch: PITCH, jitter: 0.18 });
    const P = (p) => { const [x, y] = map(mx(p[0]), p[1]); return r.project(x, y, p[2]); };
    const piv = P([PIVOT[0], PIVOT[1], ZC + 0.5]);
    const rel = (p) => { const q = P(p); return [q[0] - piv[0], q[1] - piv[1]]; };
    s = {
      r, canvas: r.canvas, px: Math.round(piv[0]), py: Math.round(piv[1]),
      front: idOverlay(r, src.front, true),
      night: idPaint(r, src.night),
      stand: rel([ANCH.stand[0], ANCH.stand[1], ANCH.stand[2] + 0.5]),
      lantern: rel([ANCH.lantern[0] + 0.5, ANCH.lantern[1], ANCH.lantern[2] + 0.5]),
      mast: rel([ANCH.mast[0] + 0.5, ANCH.mast[1] + 1, ANCH.mast[2] + 0.5]),
      chimney: rel([ANCH.chimney[0] + 0.5, ANCH.chimney[1], ANCH.chimney[2] + 0.5]),
      flag: rel([ANCH.flag[0] + 0.5, ANCH.flag[1] + 0.5, ANCH.flag[2] + 0.5]),
      bow: rel([X0 + LEN, WL, ZC]), stern: rel([X0, WL, ZC]),
      top: rel([X0 + 16, DECK + 20, ZC]), keel: rel([X0 + 30, 0, ZC]),
    };
    this.cache.set(key, s);
    return s;
  }

  // ---------------------------------------------------------------- water
  level() { return this.ocean?.waterLevel?.() ?? null; }

  waterAt(x) {
    const o = this.ocean;
    const base = o?.waveAt ? o.waveAt(x) : this.level();
    if (base === null || base === undefined) return null;
    return base - (this.game.water?.surfaceOffset?.(x) || 0);
  }

  // ---------------------------------------------------------------- update
  update(dt, inp) {
    this.t += dt;
    if (this.pose !== this.lastPose) { this.lastPose = this.pose; this.poseT = 0; }
    this.poseT += dt;
    const g = this.game;
    const lvl = this.level();
    this.visible = lvl !== null && g.state.view === 'ocean' && !g.ocean?.travelState;
    if (lvl === null) return;
    const W = g.screen.W;
    const cur = g.world.cursor;
    // grab / drag along the surface
    this.hover = !!inp && !this.dragging && this.hit(cur.x, cur.y);
    if (inp && inp.pressed && !this.dragging && this.hit(cur.x, cur.y)) {
      this.dragging = true;
      this.grabDX = this.x - cur.x;
      inp.consume();
      g.audio?.play?.('splash_small', { vol: 0.35, pitch: 1.3 });
      g.water?.splash?.(this.x, 0.6, 30);
    }
    if (this.dragging && (!inp || !inp.down || !g.input.down)) {
      this.dragging = false;
      g.water?.splash?.(this.x, 0.5, 26);
    }
    const margin = 70;
    if (this.dragging) {
      const tx = clamp(cur.x + this.grabDX, margin, W - margin);
      const ax = (tx - this.x) * 38 - this.vx * 11;
      this.vx += ax * dt;
      this.vx = clamp(this.vx, -420, 420);
      this.lift = damp(this.lift, clamp((lvl - 10 - cur.y) * 0.08, -2, 5), 6, dt);
    } else {
      this.vx = damp(this.vx, 0, 1.6, dt);
      this.lift = damp(this.lift, 0, 4, dt);
    }
    this.x += this.vx * dt;
    if (this.x < margin) { this.x = margin; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x > W - margin) { this.x = W - margin; this.vx = -Math.abs(this.vx) * 0.3; }
    // turn to face the direction of travel
    if (Math.abs(this.vx) > 40 && Math.sign(this.vx) !== this.dir) {
      this.turnT += dt;
      if (this.turnT > 0.25) { this.dir = Math.sign(this.vx); this.turnT = 0; g.water?.splash?.(this.x, 0.4, 24); }
    } else this.turnT = 0;
    // buoyancy: sit on the water under the hull, roll with its slope
    const half = 52;
    const ws = this.waterAt(this.x - half), wm = this.waterAt(this.x), wb = this.waterAt(this.x + half);
    const target = (ws + wm * 2 + wb) / 4 - this.lift;
    if (!this.placed) { this.y = target; this.placed = true; }
    this.vy += ((target - this.y) * 60 - this.vy * 9) * dt;
    this.y += this.vy * dt;
    this.bob = this.y - target;
    const slope = (wb - ws) / (half * 2);
    const rollT = clamp(-Math.atan(slope) * 57.3 * 1.15 - this.vx * 0.012 - (this.dragging ? (cur.x + this.grabDX - this.x) * 0.02 : 0), -10, 10);
    this.rollV += ((rollT - this.roll) * 40 - this.rollV * 7) * dt;
    this.roll += this.rollV * dt;
    // wake + bow wave while moving, gentle lapping while still
    this.wakeT -= dt;
    const sp = Math.abs(this.vx);
    if (this.wakeT <= 0) {
      this.wakeT = sp > 10 ? 0.06 : 0.45;
      const water = g.water;
      if (water) {
        if (sp > 10) {
          const k = Math.min(1, sp / 260);
          water.disturb(this.x - this.dir * 58, lvl + 4, 0.35 + k * 0.9, 7 + k * 6);
          water.surf.impulse(this.x + this.dir * 60, -(12 + k * 70), 14);
          water.surf.impulse(this.x - this.dir * 62, 10 + k * 40, 18);
          if (k > 0.35 && rng.chance(0.5)) g.particles?.burst?.(this.x + this.dir * 62, lvl - 2, 3, { colors: ['#ffffff', '#d8f4ff'], speed: 50 * k, up: 40, g: 200, life: 0.6, flat: 0.6 });
        } else {
          water.disturb(this.x + rng.float(-40, 40), lvl + 6, 0.12, 6);
        }
      }
    }
    // chimney smoke
    this.smokeT -= dt;
    if (this.smokeT <= 0 && this.anchorsWorld) {
      this.smokeT = 0.32 + rng.float(0, 0.2);
      const c = this.anchorsWorld.chimney;
      this.smoke.push({ x: c[0], y: c[1], t: 0, life: rng.float(2.2, 3.2), r: rng.float(1.2, 2), ph: rng.float(0, TAU) });
    }
    for (const p of this.smoke) { p.t += dt; p.y -= (12 - p.t * 2) * dt; p.x += (-this.dir * 4 - this.vx * 0.3 + Math.sin(p.ph + p.t * 2) * 3) * dt; }
    this.smoke = this.smoke.filter((p) => p.t < p.life);
    // facing of the fisherman: toward the hook when it is out, else forward
    const h = g.fishing?.hook;
    const tx = h && h.visible ? h.x : null;
    if (tx !== null && Math.abs(tx - this.x) > 12) this.facing = Math.sign(tx - this.x);
    else if (!h?.visible) this.facing = this.dir;
  }

  // ---------------------------------------------------------------- queries
  rollIndex() {
    let best = 0, bd = 1e9;
    for (let i = 0; i < ROLLS.length; i++) { const d = Math.abs(ROLLS[i] - this.roll); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  current() {
    if (this.level() === null) return null;
    return this.sprite(this.dir, this.rollIndex());
  }

  bounds() {
    const s = this.current();
    if (!s) return null;
    const x0 = this.x + Math.min(s.stern[0], s.bow[0]), x1 = this.x + Math.max(s.stern[0], s.bow[0]);
    return { x: x0, y: this.y + s.top[1], w: x1 - x0, h: s.keel[1] - s.top[1] + 4 };
  }

  hit(wx, wy) {
    if (!this.visible) return false;
    const b = this.bounds();
    return !!b && wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
  }

  deck() {
    const s = this.current();
    if (!s) return [this.x, this.y - 20];
    return [this.x + s.stand[0], this.y + s.stand[1]];
  }

  rodTip() {
    if (this.anchorsWorld?.rodTip) return this.anchorsWorld.rodTip;
    const [x, y] = this.deck();
    return [x + this.facing * 18, y - 26];
  }

  lights() {
    const a = this.anchorsWorld;
    if (!a || !this.visible) return [];
    return [
      { x: a.lantern[0], y: a.lantern[1], r: 78, color: '#ffcf70', a: 0.95 },
      { x: a.mast[0], y: a.mast[1], r: 34, color: '#fff6d8', a: 0.6 },
      { x: this.x, y: this.y - 20, r: 56, color: '#ffc870', a: 0.45 },
    ];
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx, env) {
    if (!this.visible) return;
    const s = this.current();
    if (!s) return;
    const g = this.game;
    const L = this.layer;
    const pad = 64;
    const w = s.canvas.width + pad * 2, h = s.canvas.height + pad * 2;
    if (L.w !== w || L.h !== h) resizeLayer(L, w, h);
    const lc = L.ctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, w, h);
    const bx = Math.round(this.x), by = Math.round(this.y);
    const ox = bx - s.px - pad, oy = by - s.py - pad; // world position of the layer's top-left
    lc.drawImage(s.canvas, pad, pad);
    // fisherman on the working deck
    const sx = bx + Math.round(s.stand[0]) - ox, sy = by + Math.round(s.stand[1]) - oy;
    let an = null;
    try {
      an = drawCharacter(lc, sx, sy, { pose: this.pose || 'idle', t: this.poseT, facing: this.facing, look: g.state.character, fish: this.holdFish, scale: 1 });
    } catch (e) {
      if (!this.charErr) { this.charErr = true; console.warn('drawCharacter failed', e); }
    }
    if (s.front) lc.drawImage(s.front, pad, pad);
    // submerged part of the hull: tint below the live waterline
    const tint = g.ocean?.biome?.fogColor || '#2a7aa0';
    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = tint;
    lc.globalAlpha = 0.5;
    const x0 = Math.max(0, pad - 2), x1 = Math.min(w, pad + s.canvas.width + 2);
    for (let x = x0; x < x1; x += 2) {
      const wy = this.waterAt(ox + x);
      if (wy === null) continue;
      const yy = Math.round(wy - oy) + 1;
      if (yy < h) lc.fillRect(x, yy, 2, h - yy);
    }
    lc.globalAlpha = 0.25;
    for (let x = x0; x < x1; x += 2) {
      const wy = this.waterAt(ox + x);
      if (wy === null) continue;
      const yy = Math.round(wy - oy) + 6;
      if (yy < h) lc.fillRect(x, yy, 2, h - yy);
    }
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    // smoke behind, flag on the mast
    this.drawSmoke(ctx, env);
    ctx.drawImage(L.canvas, ox, oy);
    this.drawFlag(ctx, bx + s.flag[0], by + s.flag[1]);
    // foam where the hull cuts the water
    this.drawFoam(ctx, s, bx, by);
    // anchors in world space (for the line, lights, smoke)
    const A = {
      lantern: [bx + s.lantern[0], by + s.lantern[1]],
      mast: [bx + s.mast[0], by + s.mast[1]],
      chimney: [bx + s.chimney[0], by + s.chimney[1]],
      deck: [bx + s.stand[0], by + s.stand[1]],
    };
    if (an?.rodTip) A.rodTip = [an.rodTip[0] + ox, an.rodTip[1] + oy];
    if (an?.hands) A.hands = [an.hands[0] + ox, an.hands[1] + oy];
    if (an?.head) A.head = [an.head[0] + ox, an.head[1] + oy];
    this.anchorsWorld = A;
    this.anchors = an;
    this.drawOrigin = [ox + pad, oy + pad];
  }

  drawFlag(ctx, x, y) {
    const f = this.flag;
    if (!f) return;
    const c = f.canvas, w = c.width, h = c.height;
    const dir = -this.dir; // streams toward the stern
    const t = this.t;
    const wind = 1 + Math.min(1.5, Math.abs(this.vx) / 120);
    for (let col = 0; col < w; col += VS) {
      const k = col / w;
      const off = Math.round(Math.sin(t * 5 * wind - col * 0.35) * k * 2.2 + k * k * 2 * (1.6 - wind * 0.5));
      const dx = dir > 0 ? Math.round(x) + col : Math.round(x) - col - VS;
      const sx = dir > 0 ? col : w - col - VS;
      ctx.drawImage(c, sx, 0, VS, h, dx, Math.round(y) - h + 4 + off, VS, h);
    }
  }

  drawSmoke(ctx) {
    if (!this.smoke.length) return;
    const night = this.game.world?.night;
    ctx.fillStyle = night ? '#5a6070' : '#e8eef2';
    for (const p of this.smoke) {
      const k = p.t / p.life;
      const r = Math.max(1, Math.round(p.r + k * 4));
      ctx.globalAlpha = (1 - k) * 0.55;
      const x = Math.round(p.x), y = Math.round(p.y);
      ctx.fillRect(x - r + 1, y - r, r * 2 - 2, r * 2);
      ctx.fillRect(x - r, y - r + 1, r * 2, r * 2 - 2);
    }
    ctx.globalAlpha = 1;
  }

  drawFoam(ctx, s, bx, by) {
    const sp = Math.abs(this.vx);
    ctx.fillStyle = '#f4fffc';
    const ends = [[s.stern[0], -1], [s.bow[0], 1]];
    for (const [ex, side] of ends) {
      const x = bx + ex;
      const wy = this.waterAt(x);
      if (wy === null) continue;
      const n = 2 + Math.round(Math.min(6, sp / 40));
      for (let i = 0; i < n; i++) {
        const fx = Math.round(x + side * (i * 2 + ((this.t * 9 + i) % 2)));
        const k = hash2(i, Math.floor(this.t * 8), side + 3);
        if (k < 0.35) continue;
        ctx.globalAlpha = 0.9 - i * 0.12;
        ctx.fillRect(fx, Math.round(this.waterAt(fx)) - (k > 0.8 ? 1 : 0), 2, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Emissive windows, lantern and masthead light (drawn after the darkness pass).
  drawLights(ctx, dark) {
    if (!this.visible || dark < 0.08 || !this.drawOrigin) return;
    const s = this.current();
    if (!s || !s.night) return;
    const a = clamp01((dark - 0.08) * 2.2);
    ctx.globalAlpha = a;
    ctx.drawImage(s.night, this.drawOrigin[0], this.drawOrigin[1]);
    ctx.globalAlpha = 1;
    const A = this.anchorsWorld;
    if (!A) return;
    const flick = 0.85 + 0.15 * Math.sin(this.t * 9) * Math.sin(this.t * 3.3);
    const glow = (x, y, r, col, al) => {
      const gs = glowSprite(r, col);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = al;
      ctx.drawImage(gs, Math.round(x) - r, Math.round(y) - r);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };
    glow(A.lantern[0], A.lantern[1], 12, '#ffcf70', a * 0.75 * flick);
    glow(A.mast[0], A.mast[1], 6, '#fff6d8', a * 0.6);
  }
}

