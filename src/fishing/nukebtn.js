// [nuke31] The SHOCK button as a physical "big red button": a chunky voxel launch console rendered through the
// shared voxel pipeline (cel bands, AO, edge highlights, ink outline) and baked once per size:
//   housing  a gunmetal box on a plinth: a top deck with hex bolts, an octagonal collar whose top ring is painted in
//            yellow / black hazard stripes, a dark well in the collar, hazard-striped front corners, a recessed steel
//            plate on the front face (SHOCK + MK level engraved in pixel text, an 8-segment charge gauge), a lamp
//            strip on the deck's front lip (one square lamp per charge), a warning beacon on the front-right corner
//            and two hinge brackets at the back.
//   cap      the big glossy red dome (a lightning emblem on its top), a separate layer so it really TRAVELS into the
//            collar: the housing is split into a back layer (behind the cap) and a front layer (the collar's front
//            half and everything in front of it) from ONE render (front voxels use twin palette entries, so the ids
//            say which layer a pixel belongs to); the cap is drawn between them, shifted down by whole pixels.
//            Variants by palette swap: dim (charging), red (ready), lit (hover / pulse / beat), white (critical).
//   cover    a hinged safety cover (clear glass panels in a yellow / black striped frame), re-voxelised at 7 hinge
//            angles 0..104 degrees; closed while charging (drawn over everything, the cap seen through the glass),
//            it SNAPS open (spring overshoot) when a charge is ready, swings shut when the last one is spent and
//            rattles on hover.
// Physics (updateNukeButton, called by Fishing.updateFight): Space / a click on the button / any shock press pushes
// the cap down (spring, ~3 frames), it stays down while held, bottoms out with a clunk + a 1-frame squash and pops
// back up on release with an overshoot; hover lifts it a pixel and rattles the cover. Ready: beacon blinks, the cap
// pulses. A critical press flashes the cap white and throws sparks off the housing corners.
// Every layer exists at 1x and at the full-res UI layer's 2x (`.hi` twin). Built lazily: at most one voxel render per
// ~40 ms (warmNukeButton while waiting for a bite builds them all ahead of time); per frame only drawImage + fillRects.
//
//   updateNukeButton(F, B, dt, {fire})   drawNukeButton(ctx, F, B, L, t)   warmNukeButton(F, L)   nukeAnchor(L)

import { clamp, clamp01 } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { HI, HI_ON } from '../gfx/hires.js';
import { drawText, measureText } from '../gfx/font.js';
import { word3D } from './cinematics.js';
import { PAL, pxHalo } from './pixui.js';

const NX = 40, NY = 56, NZ = 46;
const YAW = 0, PITCH = 24;
const CX = 20, ZC = 23; // collar centre (x, z)
const DECK = 10; // the deck's top voxel row
const HY = 21, HZ = 7; // the cover's hinge axis (y, z)
const COVER_ANG = [0, 9, 24, 44, 66, 88, 104]; // hinge angles of the cover frames (degrees)
const BACK_FROM = 3; // cover frames >= this one are drawn behind the cap
const VOX = 2; // logical px per voxel at S = 1
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

const METAL = { spec: 0.9, specPow: 6, smooth: 0.5, jitter: 0.04 };
const PAINT = { spec: 0.5, specPow: 5, smooth: 0.45, jitter: 0.05 };
const GLOSS = { spec: 1.5, specPow: 12, smooth: 0.92, jitter: 0 };
const GLASS = { spec: 1.6, specPow: 14, smooth: 0.9, jitter: 0 };
const oct = (dx, dz) => { const ax = Math.abs(dx), az = Math.abs(dz); return Math.max(ax, az, (ax + az) * 0.7071); };

// ------------------------------------------------------------------ models
function markers(m) { // two invisible corner voxels: every render shares one camera (pixel-identical layers)
  const k = m.color('#000000');
  m.set(0, 0, 0, k); m.set(NX - 1, NY - 1, NZ - 1, k);
  return k;
}

function housingModel() {
  const m = new VoxelModel(NX, NY, NZ);
  const mk = markers(m);
  const mats = () => ({
    plinth: m.color('#3a4a5e', METAL), plinthL: m.color('#56687e', METAL),
    body: m.color('#5c7088', METAL), bodyD: m.color('#4a5c72', METAL), bevel: m.color('#9fb4c8', METAL),
    deck: m.color('#6e849c', METAL), deckL: m.color('#7f96ae', METAL), deckD: m.color('#5e7389', METAL),
    yel: m.color('#ffc81e', PAINT), blk: m.color('#1c2230', PAINT),
    collar: m.color('#45566c', METAL), collarL: m.color('#c8d8e6', METAL),
    well: m.color('#121a26', { jitter: 0 }), wellL: m.color('#25324a', { jitter: 0 }),
    plate: m.color('#b4c6d6', METAL), plateD: m.color('#7e94aa', METAL),
    bolt: m.color('#d2e0ec', METAL), boltD: m.color('#8094a8', METAL),
    socket: m.color('#0e1622', { jitter: 0 }), lens: m.color('#6a1a22', GLASS), lensD: m.color('#3a0c14', GLASS),
  });
  const B = mats(), Fm = mats();
  const frontFrom = Fm.plinth;
  const P = (z) => (z >= ZC ? Fm : B);
  const set = (x, y, z, key) => m.set(x, y, z, P(z)[key]);
  // plinth (a darker foot, one voxel wider)
  for (let z = 5; z <= 44; z++) for (let x = 0; x < NX; x++) for (let y = 0; y <= 1; y++) {
    const corner = (x === 0 || x === NX - 1) && (z === 5 || z === 44);
    if (corner) continue;
    set(x, y, z, y === 1 && (z === 44 || x === 0 || x === NX - 1) ? 'plinthL' : 'plinth');
  }
  // body + deck
  for (let z = 6; z <= 43; z++) for (let x = 1; x <= 38; x++) for (let y = 2; y <= DECK; y++) {
    const cx = (x === 1 || x === 38), cz = (z === 6 || z === 43);
    if (cx && cz) continue; // stepped vertical corners
    const front = z === 43;
    let key = 'body';
    if (y === DECK) key = cx || cz ? 'bevel' : ((x + z) % 7 === 0 ? 'deckL' : 'deck');
    else if (front) {
      // hazard stripes at the front corners, the plate in the middle
      if (x <= 4 || x >= 35) key = ((x + (DECK - y)) >> 1) % 2 ? 'yel' : 'blk';
      else key = y === 2 ? 'bodyD' : 'body';
    } else if (y === 2) key = 'bodyD';
    set(x, y, z, key);
  }
  // the recessed front plate: one voxel in, a darker border
  for (let x = 5; x <= 34; x++) for (let y = 3; y <= 9; y++) {
    m.set(x, y, 43, 0);
    const edge = x === 5 || x === 34 || y === 3 || y === 9;
    set(x, y, 42, edge ? 'plateD' : 'plate');
  }
  // the collar: an octagonal ring, hazard stripes on its top, a pale inner lip; a dark well inside
  for (let z = 6; z <= 43; z++) for (let x = 1; x <= 38; x++) {
    const dx = x + 0.5 - CX, dz = z + 0.5 - ZC, r = oct(dx, dz);
    if (r <= 11.3) { // the well
      for (let y = 8; y <= DECK; y++) m.set(x, y, z, 0);
      set(x, 7, z, r > 10.1 ? 'wellL' : 'well');
      continue;
    }
    if (r > 14.1) continue;
    for (let y = DECK + 1; y <= DECK + 3; y++) {
      let key = 'collar';
      if (y === DECK + 3) {
        if (r < 12.2) key = 'collarL';
        else {
          const a = Math.atan2(dz, dx);
          key = Math.floor((a / (Math.PI * 2)) * 28 + 28) % 2 ? 'yel' : 'blk';
        }
      } else if (r < 12.2) key = 'collarL';
      set(x, y, z, key);
    }
  }
  // hex bolts on the deck corners (a raised head with a slot)
  for (const [bx, bz] of [[3, 39], [6, 39]]) {
    for (let x = bx; x <= bx + 2; x++) for (let z = bz; z <= bz + 2; z++) {
      if ((x === bx || x === bx + 2) && (z === bz || z === bz + 2)) continue;
      set(x, DECK + 1, z, x === bx + 1 ? 'boltD' : 'bolt');
    }
  }
  // the warning beacon (front-right corner): a base and a dark red lens block (lit by an overlay)
  for (let x = 32; x <= 37; x++) for (let z = 39; z <= 42; z++) set(x, DECK + 1, z, 'collar');
  for (let x = 33; x <= 36; x++) for (let z = 40; z <= 41; z++) for (let y = DECK + 2; y <= DECK + 4; y++) set(x, y, z, y === DECK + 4 || x === 33 ? 'lens' : 'lensD');
  // hinge brackets at the back and the barrel along the top
  for (const bx of [1, 2, 37, 38]) for (let z = 5; z <= 8; z++) for (let y = DECK + 1; y <= HY; y++) {
    if (z === 5 || z === 8) { if (y > HY - 2) continue; }
    set(bx, y, z, bx === 1 || bx === 38 ? 'bodyD' : 'body');
  }
  for (let x = 1; x <= 38; x++) for (let z = 6; z <= 7; z++) for (let y = HY - 1; y <= HY; y++) set(x, y, z, y === HY ? 'bevel' : 'body');
  // the lamp strip on the deck's front lip: a dark recessed channel (lamps are overlays)
  for (let x = 10; x <= 29; x++) for (let z = 40; z <= 41; z++) set(x, DECK, z, 'socket');
  return { m, mk, frontFrom };
}

// the cap: a skirt in the well and a big dome, a lightning emblem on top. Variants by palette swap.
const BOLT = [[1.5, -9], [-3.6, 0.6], [-0.2, 0.6], [-2, 9], [3.8, -1.6], [0.6, -1.6], [2.8, -9]];
function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function capModel() {
  const m = new VoxelModel(NX, NY, NZ);
  const mk = markers(m);
  const red = m.color('#e83040', GLOSS), redD = m.color('#b01e30', GLOSS), ring = m.color('#7a1420', METAL);
  const emb = m.color('#ffe46a', GLOSS), embD = m.color('#e8920a', GLOSS), shine = m.color('#ffd8d0', GLOSS);
  const R = 10.4, base = DECK + 3, ry = 5.8;
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const dx = x + 0.5 - CX, dz = z + 0.5 - ZC, d = Math.hypot(dx, dz);
    if (d > R) continue;
    for (let y = 8; y < base; y++) m.set(x, y, z, d > R - 1.2 ? ring : redD); // the skirt (hidden in the well)
    const h = Math.sqrt(Math.max(0, 1 - (d / R) * (d / R))) * ry;
    const top = base + Math.round(h);
    for (let y = base; y <= top; y++) m.set(x, y, z, d > R - 1 && y === base ? ring : red);
    // the emblem on the top of the dome (stretched in z: the deck is seen at a slant)
    if (d < R - 2.2 && inPoly(dx, dz * 0.82, BOLT)) {
      const edge = !inPoly(dx + 0.9, dz * 0.82, BOLT) || !inPoly(dx, (dz + 1) * 0.82, BOLT);
      m.set(x, top, z, edge ? embD : emb);
    }
    // a hard highlight patch on the upper-left shoulder
    if (dx < -2.5 && dx > -6.5 && dz < -1 && dz > -5.5 && d < R - 1.6) m.set(x, top, z, shine);
  }
  return { m, mk, ids: { red, redD, ring, emb, embD, shine } };
}
const CAP_PAL = {
  dim: { red: '#a8283a', redD: '#7c1a2c', shine: '#d88a90', emb: '#c8a040', embD: '#8a5a14' },
  red: { red: '#e83040', redD: '#b01e30', shine: '#ffd8d0', emb: '#ffe46a', embD: '#e8920a' },
  lit: { red: '#ff5a5a', redD: '#e0303c', shine: '#ffffff', emb: '#fffbd0', embD: '#ffc81e' },
  white: { red: '#ffffff', redD: '#ffe8e0', shine: '#ffffff', emb: '#fff6c0', embD: '#ffd23a', ring: '#ffd0c8' },
};

// the safety cover at hinge angle a (degrees): a glass box (top, front, sides) in a yellow / black striped frame
function coverModel(aDeg) {
  const m = new VoxelModel(NX, NY, NZ);
  const mk = markers(m);
  const yel = m.color('#ffc81e', PAINT), blk = m.color('#1c2230', PAINT), glass = m.color('#bff0ff', GLASS), glassD = m.color('#8fd8f0', GLASS);
  const a = (aDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let z = 0; z < NZ; z++) for (let y = DECK; y < NY; y++) {
    const Y = y + 0.5 - HY, Z = z + 0.5 - HZ;
    const ly = Y * ca - Z * sa, lz = Y * sa + Z * ca; // back to the closed lid's frame
    if (ly < -(HY - DECK - 0.4) || ly >= 0 || lz < 0 || lz >= 31.5) continue;
    const top = ly >= -1.6, front = lz >= 29.6;
    for (let x = 3; x <= 36; x++) {
      const side = x <= 3 || x >= 36;
      if (!top && !front && !side) continue;
      // the frame: the top's rim, the front corner posts, the bottom rim of the walls
      const rimTop = top && (x <= 5 || x >= 34 || lz >= 28.5 || lz < 3);
      const post = front && (x <= 5 || x >= 34);
      const rimBot = ly < -(HY - DECK - 2.6) && (front || side);
      const sideRim = side && (lz < 2 || lz >= 28.5);
      if (rimTop || post || rimBot || sideRim) m.set(x, y, z, (Math.floor((x + lz - ly) / 2.2) % 2) ? yel : blk);
      else m.set(x, y, z, front && (x + Math.floor(-ly)) % 11 === 0 ? glassD : glass);
    }
  }
  return { m, mk, glassIds: [glass, glassD] };
}

// ------------------------------------------------------------------ baking
const VIEW = { yaw: YAW, pitch: PITCH, groundAO: false, glowRadius: 0, ao: 0.9, edges: 0.8, sideEdges: 0.5 };
// render a model at px-per-voxel s; returns {r, img (Uint32 pixels), W, H}
function renderAt(model, mk, s, extra) {
  const r = renderVoxels(model, { ...VIEW, scale: s, keepVoxel: (x, y, z) => model.get(x, y, z) !== mk, ...extra });
  const W = r.canvas.width, H = r.canvas.height;
  const img = ctxOf(r.canvas).getImageData(0, 0, W, H);
  return { r, img, W, H };
}
function toCanvasFrom(img, W, H, keep, alphaFn) {
  const c = makeCanvas(W, H), g = ctxOf(c);
  const out = g.createImageData(W, H), src = new Uint32Array(img.data.buffer), dst = new Uint32Array(out.data.buffer);
  for (let i = 0; i < src.length; i++) {
    if (!src[i] || (keep && !keep(i))) continue;
    let v = src[i];
    if (alphaFn) { const a = alphaFn(i, v); if (a <= 0) continue; v = ((v & 0x00ffffff) | (a << 24)) >>> 0; }
    dst[i] = v;
  }
  g.putImageData(out, 0, 0);
  return c;
}

// the bake for one screen scale: px per voxel, the anchor transform and the cached layers
const BAKES = new Map();
function bakeFor(L) {
  const s = Math.max(1.5, VOX * L.S);
  const key = s.toFixed(3);
  let bk = BAKES.get(key);
  if (!bk) {
    if (BAKES.size > 3) BAKES.clear();
    bk = { s, house: null, caps: new Map(), covers: new Array(COVER_ANG.length).fill(null), hi: HI_ON.on, cam: null, buildT: 0, capModel: null };
    BAKES.set(key, bk);
  }
  return bk;
}
function attachHi(lo, hi) { if (hi) Object.defineProperty(lo, 'hi', { value: hi, configurable: true }); return lo; }

// the housing: back / front layers + the camera (project) of the 1x render
function buildHouse(bk) {
  const { m, mk, frontFrom } = housingModel();
  const make = (s) => {
    const R = renderAt(m, mk, s);
    const ids = R.r.ids;
    const back = toCanvasFrom(R.img, R.W, R.H, (i) => ids[i] < frontFrom);
    const front = toCanvasFrom(R.img, R.W, R.H, (i) => ids[i] >= frontFrom);
    return { back, front, project: R.r.project, W: R.W, H: R.H };
  };
  const lo = make(bk.s), hi = HI_ON.on ? make(bk.s * HI) : null;
  bk.cam = { project: lo.project, W: lo.W, H: lo.H, hiProject: hi?.project };
  bk.house = { back: attachHi(lo.back, hi && align(hi.back, lo, hi)), front: attachHi(lo.front, hi && align(hi.front, lo, hi)) };
}
// shift a hi render so that its reference point lands exactly on 2x the 1x one (the two cameras differ by < 1 px)
function align(c, lo, hi) {
  const [lx, ly] = lo.project(CX, 6, ZC), [hx, hy] = hi.project(CX, 6, ZC);
  const dx = Math.round(lx * HI - hx), dy = Math.round(ly * HI - hy);
  const out = makeCanvas(lo.W * HI, lo.H * HI);
  ctxOf(out).drawImage(c, dx, dy);
  return out;
}
function buildCap(bk, variant) {
  if (!bk.capModel) bk.capModel = capModel();
  const { m, mk, ids } = bk.capModel;
  const pal = CAP_PAL[variant];
  for (const k of Object.keys(ids)) m.palette[ids[k]].color = pal[k] || CAP_PAL.red[k] || m.palette[ids[k]].color;
  if (!pal.ring) m.palette[ids.ring].color = '#7a1420';
  const make = (s) => { const R = renderAt(m, mk, s); return { c: toCanvasFrom(R.img, R.W, R.H), project: R.r.project, W: R.W, H: R.H }; };
  const lo = make(bk.s), hi = HI_ON.on ? make(bk.s * HI) : null;
  const c = attachHi(lo.c, hi && align(hi.c, lo, hi));
  bk.caps.set(variant, c);
  return c;
}
function buildCover(bk, i) {
  const { m, mk, glassIds } = coverModel(COVER_ANG[i]);
  const make = (s) => {
    const R = renderAt(m, mk, s);
    const ids = R.r.ids, d = R.img.data;
    // the glass: faint body, rim and glints nearly opaque (like voxicon's glass layer)
    const isGlass = (i2) => ids[i2] === glassIds[0] || ids[i2] === glassIds[1];
    const lum = (i2) => d[i2 * 4] * 0.3 + d[i2 * 4 + 1] * 0.59 + d[i2 * 4 + 2] * 0.11;
    const W = R.W;
    const alpha = (i2) => {
      if (!isGlass(i2)) return 255;
      const edge = !ids[i2 - 1] || !ids[i2 + 1] || !ids[i2 - W] || !ids[i2 + W] || !isGlass(i2 - 1) || !isGlass(i2 + 1) || !isGlass(i2 - W) || !isGlass(i2 + W);
      const l = lum(i2);
      return l > 240 ? 210 : edge ? 130 : l > 215 ? 70 : 40;
    };
    return { c: toCanvasFrom(R.img, R.W, R.H, null, alpha), project: R.r.project, W: R.W, H: R.H };
  };
  const lo = make(bk.s), hi = HI_ON.on ? make(bk.s * HI) : null;
  const c = attachHi(lo.c, hi && align(hi.c, lo, hi));
  bk.covers[i] = c;
  return c;
}

// Bake missing layers within a small per-frame budget (one voxel render at a time, ~40 ms apart). `need` forces.
function ensure(bk, what, force) {
  const now = performance.now();
  const can = force || now - bk.buildT > 40;
  if (what === 'house') { if (!bk.house) { buildHouse(bk); bk.buildT = performance.now(); } return bk.house; }
  if (what.startsWith('cap:')) {
    const v = what.slice(4);
    let c = bk.caps.get(v);
    if (!c && (can || !bk.caps.size)) { c = buildCap(bk, v); bk.buildT = performance.now(); }
    return c || bk.caps.get('red') || bk.caps.values().next().value;
  }
  const i = +what.slice(6);
  let c = bk.covers[i];
  if (!c && (can || bk.covers.every((x) => !x))) { c = buildCover(bk, i); bk.buildT = performance.now(); }
  if (c) return c;
  for (let d = 1; d < COVER_ANG.length; d++) for (const j of [i - d, i + d]) if (bk.covers[j]) return bk.covers[j];
  return null;
}

// Warm everything (call while waiting for a bite; one render per call, throttled).
export function warmNukeButton(F, L) {
  const bk = bakeFor(L);
  if (bk.hi !== HI_ON.on) { BAKES.clear(); return; }
  if (performance.now() - bk.buildT < 45) return;
  if (!bk.house) { ensure(bk, 'house', true); return; }
  for (const v of ['red', 'dim', 'lit', 'white']) if (!bk.caps.get(v)) { ensure(bk, 'cap:' + v, true); return; }
  for (let i = 0; i < COVER_ANG.length; i++) if (!bk.covers[i]) { ensure(bk, 'cover:' + i, true); return; }
}

// ------------------------------------------------------------------ state + physics
function stateOf(F) {
  let st = F.nuke;
  if (!st) {
    st = F.nuke = { travel: 0, vel: 0, push: 0, held: false, hover: 0, hoverOn: false, cover: 0, coverV: 0, coverOpen: false,
      crit: 0, squash: 0, bottomed: false, rattle: 0, readyT: 0 };
  }
  return st;
}
export function resetNukeButton(F) { F.nuke = null; }

// fire: a shock press happened this frame (Space, a click on the button / anywhere during a beat, the right button)
export function updateNukeButton(F, B, dt, o = {}) {
  const st = stateOf(F), inp = F.input;
  dt = Math.min(0.05, Math.max(0, dt));
  const L = o.L;
  const hit = !!(L && inp && o.hit);
  // hover
  if (hit && !st.hoverOn) { st.hoverOn = true; st.rattle = 1; F.sfx?.('ui_hover', { vol: 0.25, pitch: 0.8 }); }
  else if (!hit) st.hoverOn = false;
  st.hover += ((hit ? 1 : 0) - st.hover) * Math.min(1, dt * 14);
  st.rattle = Math.max(0, st.rattle - dt * 2.4);
  // press: pushed for at least 90 ms, held while Space / the mouse stays down on the button
  if (o.fire) { st.push = 0.09; F.sfx?.('click', { vol: 0.45, pitch: 0.7 }); }
  st.push = Math.max(0, st.push - dt);
  st.held = st.push > 0 || !!inp?.key?.(' ') || (!!inp?.down && hit) || (!!inp?.rdown && (st.push > 0 || hit));
  const target = st.held ? 1 : st.hover > 0.5 ? -0.3 : 0;
  // a stiff spring down (bottoms out in ~3 frames), a bouncy one back up
  const k = st.held ? 900 : 420, damp = st.held ? 38 : 16;
  st.vel += ((target - st.travel) * k - st.vel * damp) * dt;
  st.travel += st.vel * dt;
  if (st.travel >= 1) {
    if (!st.bottomed && st.vel > 2) { st.squash = 1; F.sfx?.('chest_hit', { vol: 0.55, pitch: 0.62 }); F.sfx?.('wood_hit', { vol: 0.3, pitch: 1.4 }); }
    st.travel = 1; st.vel = Math.min(0, st.vel); st.bottomed = true;
  } else if (st.travel < 0.7 && st.bottomed) {
    st.bottomed = false;
    F.sfx?.('ui_toggle', { vol: 0.3, pitch: 1.3 }); // the pop back up
  }
  if (st.travel < -0.6) { st.travel = -0.6; st.vel = Math.max(0, st.vel); }
  st.squash = Math.max(0, st.squash - dt * 9);
  // the cover: open while a charge is ready (snaps open with an overshoot), shuts when the last one is spent
  // (it waits a moment after the last charge is spent, so the press and the critical flash are seen)
  st.emptyT = (B?.charges || 0) > 0 ? 0 : (st.emptyT || 0) + dt;
  const want = (B?.charges || 0) > 0 || (st.coverOpen && st.emptyT < 0.75);
  if (want !== st.coverOpen) {
    st.coverOpen = want;
    if (want) { st.coverV = 9; F.sfx?.('chest_hit', { vol: 0.35, pitch: 1.7 }); F.sfx?.('ui_toggle', { vol: 0.4, pitch: 0.9 }); }
    else F.sfx?.('box_close', { vol: 0.35, pitch: 1.5 });
  }
  const ct = want ? 1 : 0;
  st.coverV += ((ct - st.cover) * (want ? 260 : 120) - st.coverV * (want ? 13 : 18)) * dt;
  st.cover = clamp(st.cover + st.coverV * dt, -0.05, 1.12);
  st.crit = Math.max(0, st.crit - dt * 1.8);
  st.readyT = want ? st.readyT + dt : 0;
}
export function nukeCrit(F) { stateOf(F).crit = 1; }

// ------------------------------------------------------------------ drawing
// The voxel housing's reference point (model (CX, 6, ZC)) lands on (cx, cy + dy) on screen.
export function nukeAnchor(L) { const b = L.btn; return [b.cx, Math.round(b.cy + 14 * L.S)]; }

export function drawNukeButton(ctx, F, B, L, t) {
  const st = stateOf(F), bk = bakeFor(L);
  if (bk.hi !== HI_ON.on) { BAKES.clear(); return drawNukeButton(ctx, F, B, L, t); }
  const house = ensure(bk, 'house', true);
  const cam = bk.cam;
  const S = L.S, u = L.u;
  const ready = B.charges > 0, beat = B.beat?.stage === 'sweep', tele = B.beat && !beat;
  const bad = F.btnBad > 0.05, den = F.btnDenied > 0 ? Math.round(Math.sin(t * 60) * 2 * F.btnDenied) * u : 0;
  const [ax, ay] = nukeAnchor(L);
  const [rx, ry] = cam.project(CX, 6, ZC);
  const ox = Math.round(ax - rx) + den, oy = Math.round(ay - ry);
  const P = (x, y, z) => { const p = cam.project(x, y, z); return [ox + p[0], oy + p[1]]; };
  // the hard pixel shadow under the plinth
  {
    const [sx0, sy0] = P(1, 0, 45), [sx1] = P(NX - 1, 0, 45);
    ctx.fillStyle = 'rgba(4,16,36,0.35)';
    ctx.fillRect(Math.round(sx0 + 2 * u), Math.round(sy0 - u), Math.round(sx1 - sx0), 3 * u);
  }
  // the halo while a beat runs (stepped square, no ring)
  if (beat || tele) {
    const [hx, hy] = P(CX, 14, ZC);
    pxHalo(ctx, hx, hy, Math.round(46 * S), Math.round(30 * S), '#ffe46a', 0.45 + 0.35 * (Math.floor(t * 12) % 2), u);
  }
  // the cover frame for this angle (+ a rattle on hover / a denied press while it is shut)
  const rat = (st.rattle + (F.btnDenied || 0)) * (st.cover < 0.2 ? 1 : 0);
  let ci = Math.round(clamp01(st.cover) * (COVER_ANG.length - 1));
  if (st.cover > 1.02) ci = COVER_ANG.length - 1;
  if (rat > 0.05 && Math.floor(t * 30) % 2) ci = Math.min(1, ci + 1);
  if (st.cover > 1.04 && Math.floor(t * 24) % 2) ci = COVER_ANG.length - 2; // overshoot wobble
  const cover = ensure(bk, 'cover:' + ci);
  if (cover && ci >= BACK_FROM) ctx.drawImage(cover, ox, oy);
  ctx.drawImage(house.back, ox, oy);
  // the cap: variant, travel, squash
  let variant = st.crit > 0.55 || (st.crit > 0.15 && Math.floor(t * 16) % 2 === 0) ? 'white' : bad ? 'dim' : beat ? (Math.floor(t * 10) % 2 ? 'lit' : 'red') : !ready ? 'dim' : st.hover > 0.5 ? 'lit' : (Math.floor(st.readyT * 2.2) % 2 && st.readyT < 6) || Math.floor(t * 1.6) % 4 === 0 ? 'lit' : 'red';
  const cap = ensure(bk, 'cap:' + variant);
  if (cap) {
    const travel = Math.round(st.travel * 4 * VOX * S * Math.cos((PITCH * Math.PI) / 180)); // 4 voxels at full press
    const sq = st.squash > 0.4 ? u : 0;
    if (sq) ctx.drawImage(cap, ox - sq, oy + travel + sq * 2, cap.width + sq * 2, cap.height - sq);
    else ctx.drawImage(cap, ox, oy + travel);
  }
  ctx.drawImage(house.front, ox, oy);
  drawPanel(ctx, B, L, t, P);
  if (cover && ci < BACK_FROM) ctx.drawImage(cover, ox, oy);
  // the critical flash: a white stepped halo over the dome
  if (st.crit > 0.5) { const [hx, hy] = P(CX, 15, ZC); pxHalo(ctx, hx, hy, Math.round(30 * S), Math.round(18 * S), '#ffffff', st.crit * 0.7, u); }
  if (beat) { const [wx, wy] = P(CX, 30, ZC); word3D(ctx, 'SHOCK!', wx, wy - Math.round(6 * S), { t, scale: 0.55 * S, pal: 'sun', wobble: 1.4, alpha: 0.95 }); }
  drawKeycap(ctx, B, L, beat, st, u, S);
}

// the plate text, the charge gauge, the charge lamps and the beacon (overlays on the voxel housing)
function drawPanel(ctx, B, L, t, P) {
  const u = L.u, S = L.S;
  const ready = B.charges > 0, beat = B.beat?.stage === 'sweep';
  // the front plate (model x 8..31, y 4..8 at z 40): engraved SHOCK + the MK level, a gauge row below
  const [px0, py0] = P(6, 9, 42), [px1, py1] = P(34, 3, 42);
  const pw = px1 - px0;
  const ty = Math.round(py0 + 1 * u);
  const mk = 'MK ' + ROMAN[B.level || 1];
  const mw = measureText(mk, 'small', u);
  drawText(ctx, 'SHOCK', Math.round(px0 + 2 * u), ty + u, { font: 'small', scale: u, color: '#ffffff' });
  drawText(ctx, 'SHOCK', Math.round(px0 + 2 * u), ty, { font: 'small', scale: u, color: '#1a2434' });
  drawText(ctx, mk, Math.round(px1 - mw - 2 * u), ty + u, { font: 'small', scale: u, color: '#ffffff' });
  drawText(ctx, mk, Math.round(px1 - mw - 2 * u), ty, { font: 'small', scale: u, color: B.chain ? '#c86a06' : '#b01e30' });
  // the gauge: 8 LED segments filling with the recharge, all gold (blinking) when ready
  const n = 8, gy = Math.round(py1 - 3 * u), gx0 = Math.round(px0 + 2 * u), gw = Math.round(pw - 4 * u);
  const segW = Math.max(u, Math.floor((gw - (n - 1) * u) / n));
  const fill = ready ? 1 : clamp01(B.chargeK ?? 0);
  ctx.fillStyle = '#121a26'; ctx.fillRect(gx0 - u, gy - u, (segW + u) * n + u, 3 * u);
  for (let i = 0; i < n; i++) {
    const on = (i + 1) / n <= fill + 1e-6, part = !on && i / n < fill;
    let col = '#24364a';
    if (ready) col = beat ? (Math.floor(t * 14) % 2 ? '#ffffff' : '#ffe46a') : Math.floor(t * 3) % 2 ? '#ffe46a' : '#ffc81e';
    else if (on) col = i >= n - 2 ? '#ffe46a' : '#6ef0a0';
    else if (part) col = Math.floor(t * 8) % 2 ? '#3a8a5a' : '#24364a';
    ctx.fillStyle = col;
    ctx.fillRect(gx0 + i * (segW + u), gy, segW, u);
  }
  // charge lamps on the front lip (one per charge; the next one glows as it fills)
  const nMax = Math.max(1, B.shockMax || 1);
  const [lx0, ly0] = P(10, DECK + 1, 40), [lx1, ly1] = P(30, DECK + 1, 42);
  const lw = lx1 - lx0, lh = Math.max(2 * u, Math.round(ly1 - ly0));
  const gap = u, cell = Math.min(Math.round(8 * S), Math.floor((lw - (nMax - 1) * gap * 2) / nMax));
  const tot = nMax * cell + (nMax - 1) * gap * 2, lxs = Math.round(lx0 + (lw - tot) / 2);
  for (let i = 0; i < nMax; i++) {
    const x = lxs + i * (cell + gap * 2), y = Math.round(ly0);
    const has = i < B.charges, next = i === B.charges ? clamp01(B.chargeK ?? 0) : 0;
    if (has) {
      ctx.fillStyle = beat && Math.floor(t * 14) % 2 ? '#ffffff' : '#ffd23a'; ctx.fillRect(x, y, cell, lh);
      ctx.fillStyle = '#fffbd0'; ctx.fillRect(x, y, cell, u);
      ctx.fillStyle = '#e8920a'; ctx.fillRect(x, y + lh - u, cell, u);
    } else {
      ctx.fillStyle = '#1a2636'; ctx.fillRect(x, y, cell, lh);
      if (next > 0.02) { ctx.fillStyle = '#3ccc9c'; ctx.fillRect(x, y, Math.max(u, Math.round(cell * next)), lh); }
    }
  }
  // the warning beacon: blinks red / amber when ready (fast during a beat), dark while charging
  const [bx0, by0] = P(33, DECK + 5, 40), [bx1, by1] = P(37, DECK + 2, 42);
  const blink = beat ? Math.floor(t * 12) % 2 : ready ? Math.floor(t * 3) % 2 : 0;
  if (blink) {
    const bw = bx1 - bx0, bh = by1 - by0;
    pxHalo(ctx, bx0 + bw / 2, by0 + bh / 2, bw, bh, beat ? '#ffe46a' : '#ff4a3a', 0.8, u);
    ctx.fillStyle = beat ? '#ffd23a' : '#ff3a3a'; ctx.fillRect(Math.round(bx0), Math.round(by0), Math.round(bw), Math.round(bh));
    ctx.fillStyle = beat ? '#ffffff' : '#ffb0a0'; ctx.fillRect(Math.round(bx0), Math.round(by0), Math.round(bw), u);
    ctx.fillRect(Math.round(bx0), Math.round(by0), u, Math.round(bh));
  }
}

// the pixel SPACE keycap left of the housing (pressed while the cap is down, lit during the sweep)
function drawKeycap(ctx, B, L, beat, st, u, S) {
  const b = L.btn;
  const kw = Math.round(34 * S), kh = Math.round(15 * S);
  const kx = Math.round(b.cx - b.r - 12 * S - kw), down = st.travel > 0.5 ? u : 0;
  const ky = Math.round(b.cy + 6 * S - kh / 2) + down;
  const ready = B.charges > 0;
  ctx.globalAlpha = ready ? 1 : 0.65;
  const ink = PAL.ink;
  ctx.fillStyle = ink; ctx.fillRect(kx, ky, kw, kh + 3 * u - down);
  const top = beat ? '#fffbd0' : '#f0f8ff', mid = beat ? '#ffe46a' : '#c2d6e6', side = beat ? '#c86a06' : '#5a7490';
  ctx.fillStyle = side; ctx.fillRect(kx + u, ky + kh - 2 * u, kw - 2 * u, 3 * u - down);
  ctx.fillStyle = mid; ctx.fillRect(kx + u, ky + u, kw - 2 * u, kh - 3 * u);
  ctx.fillStyle = top; ctx.fillRect(kx + 2 * u, ky + u, kw - 4 * u, Math.round((kh - 3 * u) * 0.5));
  ctx.fillStyle = '#ffffff'; ctx.fillRect(kx + u, ky + u, kw - 2 * u, u);
  drawText(ctx, 'SPACE', kx + kw / 2, ky + Math.round((kh - 2 * u - 5 * u) / 2) + u, { font: 'small', align: 'center', scale: u, color: beat ? '#3a1e06' : '#1a3048' });
  ctx.globalAlpha = 1;
}
