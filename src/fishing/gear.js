// The GEAR (phase 6): the heart of the fishing minigame. [simple24] In a meter fight (B.gearMode 'meter') it is
// just the spin control: the gear in its housing, a spin hint and the controls plaque (the meter, catch bar and SHOCK
// button live in meter.js); circling the mouse, the mouse wheel and holding / tapping W / Up / R all spin it. Box
// reels keep the full gauge HUD below. [gear25] A big VOXEL ART steel gear (18 chunky teeth, 6 ridged spokes, a rim
// with an aqua enamel channel and brass rivets, a bolted hub with a hex nut and an aqua gem) in a voxel housing (dark
// backplate, a blue ring with 12 lamps that light up with the spin speed), rendered by the shared voxel pipeline
// (voxicon renderLayers: ramps, glints, AO, edge highlights, ink outline) in the lower-right corner. The gear repeats
// every 60 degrees, so its spin is a ring of 24 cached frames (the model re-voxelised at each angle), at 1x and at the
// full-res UI layer's 2x, warmed up while you wait for a bite.
// It spins with real momentum: circling the mouse (anywhere) grips and drives it, the fish's pull drags it back
// (and spins it backwards, stripping line, when you let go), bearings let it coast. Jolts knock it about, it smears
// with motion-blur ghosts, throws sparks and glints at speed and crackles with arcs while a shock charges.
//
// Around it, big and readable:
//   RPM gauge      outer 240-degree arc: the moving green SWEET BAND (the hook-set band during a bite), the red
//                  RIP / strain zone above it and a chrome needle at the gear's RPM (big number underneath)
//   progress ring  catch progress (lime) / hook-set meter (gold) with the bite window ticking down inside it
//   tension tube   glossy glass capsule on the left (aqua -> green -> yellow -> red, flashing before a snap)
//   shock          3D bolt icons on glossy orbs above the gear (charges + cooldown sweep), 3D mouse / Space key hold
//                  hints ([phase9:fishing] no 2D pixel glyphs; labels are 3D voxel words); while charging, a ring on the gear face
//                  with the PERFECT window (release in it), the overcharge zone in red
//
// API: new Gear(F); update(dt, B); draw(ctx, B, k); layout(W, H); reset(); kick(n); jolt(rpm)
//   B = the controller (HookSpin, Battle or BoxReel) or null: gearMode 'hook' | 'fight' | 'box', band {lo, hi, rip?},
//   progress, ghost, tension, snapT, grace, stunned, surging, charge {k}, chargeWin {lo, hi}, charges, shockMax,
//   shockCd, shockCdMax, canCharge, bandDir (-1 | 0 | 1: where the band is heading), set / timeK (hook mode).
//   Gear fields: rpm (signed, + winds line), p = max(0, rpm) / RPM_UNIT (the old crank-power scale), load (rpm/s the
//   fish drags it back with, set by B each frame), brake (holding against a surge: no backspin), dir (+1 clockwise).
//   Old Reel compat: strain, snapped, denied, fire, lay {cx, cy, R, bx, by, br}.

import { TAU, clamp, clamp01, damp, lerp, ease } from '../core/math.js';
import { rgba } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { VoxelModel } from '../gfx/voxel.js';
import { renderLayers } from '../gfx/voxicon.js';
import { HI, HI_ON, isHi } from '../gfx/hires.js';
import { glowSprite, drawBolt, boltPoints, pixelLine } from '../gfx/particles.js';
import { drawText, measureText, lineHeight } from '../gfx/font.js';
import { glossText, word3D } from './cinematics.js';
import { drawIcon3d } from './icons3d.js'; // [phase9:fishing] 3D icons + 3D voxel words on the gear HUD
import { pxFrame, PAL as PXPAL } from './pixui.js'; // [fishui30]

export const RPM_UNIT = 150; // gear rpm that equals crank power 1
export const RPM_MAX = 240; // gauge full scale
const GRIP = 7; // how hard a circling hand drives the gear toward its own speed (1/s)
const INK = '#0c3a52';
const G0 = Math.PI * (5 / 6), G1 = Math.PI * (13 / 6); // gauge arc: lower-left -> over the top -> lower-right

// ------------------------------------------------------------------------------------------------ voxel art
// [gear25] The gear is a hand-built VoxelModel (src/gfx/voxel.js) rendered by voxicon renderLayers: 7-step ramps,
// glossy normals + glints, AO, edge highlights, depth lines, the dark ink outline and a soft shadow. 18 chunky
// teeth, a rim with an aqua enamel channel and 12 brass rivets, 6 ridged spokes, a hub with 6 bolts, a hex nut and an
// aqua gem. The gear repeats every 60 degrees (6 spokes), so its spin is a ring of NF cached frames over one period,
// each one the model re-voxelised at that angle (crisp voxels at every angle). A static voxel housing (a dark
// backplate behind the gear, a chunky blue ring with 12 lamp sockets) sits around it; lit voxel lamps are overlaid.
// Frames exist at 1x (logical) and HI x (the full-res UI layer), built lazily within a time budget.
const N_TEETH = 18, N_SPOKES = 6, N_LAMPS = 12;
const SYM = TAU / N_SPOKES, NF = 24; // 2.5 degrees per cached frame
const VPX = 2; // logical px per voxel
const VIEW = { yaw: -0.26, pitch: 0.42 }; // radians (voxicon convention): from above and a little to the right
const ZC = 9; // model z index of the gear's mid-plane

const METAL = { spec: 1, specPow: 5, smooth: 0.55, jitter: 0, edge: 1 };
const ENAMEL = { spec: 0.9, specPow: 9, smooth: 0.7, jitter: 0 };
const GEMM = { spec: 1.3, specPow: 12, smooth: 0.85, jitter: 0, aoMul: 0.4 };
const memoPal = (m) => {
  const map = new Map();
  return (hex, o) => { const k = hex + (o === ENAMEL ? 'e' : o === GEMM ? 'g' : 'm'); let c = map.get(k); if (c === undefined) { c = m.color(hex, o || METAL); map.set(k, c); } return c; };
};
const fract = (v) => v - Math.floor(v);

// The gear at spin angle th (model y up: + = counter-clockwise), RV voxels to the tooth tips.
function gearModel(RV, th) {
  const C = RV + 4, N = 2 * C, NZ = ZC * 2 + 1;
  const m = new VoxelModel(N, N, NZ);
  const P = memoPal(m);
  const steel = P('#93adc2'), steelB = P('#a3bccf'), steelL = P('#d2e4f0'), steelD = P('#6a879f');
  const enamel = P('#2fb4e4', ENAMEL), enamelL = P('#5fd8f6', ENAMEL);
  const brass = P('#f2c24a'), brassL = P('#fff0a8');
  const nut = P('#6d8499'), nutL = P('#9fb4c6'), gem = P('#7ff2ff', GEMM), gemL = P('#e8ffff', GEMM);
  const R_ROOT = 0.85, R_RIM = 0.65, R_HUB = 0.25, R_BOSS = 0.165;
  const tooth = TAU / N_TEETH, spokeA = TAU / N_SPOKES;
  const put = (x, y, z0, z1, c) => { for (let z = z0; z <= z1; z++) m.set(x, y, ZC + z, c); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - C, dy = y + 0.5 - C, r = Math.hypot(dx, dy), rf = r / RV;
    if (rf > 1.0) continue;
    const a = Math.atan2(dy, dx) - th; // material angle
    if (rf >= R_ROOT - 0.02) {
      // teeth: trapezoids (wide root, narrow land), a chamfered land and front corners
      const u = fract(a / tooth) - 0.5, hw = lerp(0.36, 0.24, clamp01((rf - R_ROOT) / (1 - R_ROOT)));
      const tw = Math.abs(u) * r * tooth; // voxels from the tooth's centre line
      const edge = (hw - Math.abs(u)) * r * tooth; // voxels in from the tooth's flank
      if (rf >= R_ROOT && edge < 0) continue;
      const land = rf > 1 - 1.3 / RV;
      const z1 = land || edge < 1 ? 2 : 3;
      put(x, y, -3, z1 - 1, steelD);
      m.set(x, y, ZC + z1, land ? steelL : tw < 1.2 ? steelL : steel);
      continue;
    }
    if (rf >= R_RIM) {
      // rim: an outer and an inner bead (raised), an aqua enamel channel between them, 12 brass rivets in it
      const bead = rf > 0.785 || rf < 0.705;
      put(x, y, -3, 2, steelD);
      if (bead) {
        const ring = Math.floor(r) % 2 ? steelB : steel; // machined rings
        m.set(x, y, ZC + 3, ring);
        m.set(x, y, ZC + 4, rf > 0.815 || rf < 0.68 ? steelL : ring);
      } else {
        m.set(x, y, ZC + 3, enamel);
        // rivets sit between the spokes
        const ra = (Math.round(a / (TAU / 12) - 0.5) + 0.5) * (TAU / 12);
        const rr = 0.745 * RV, d = Math.hypot(dx - Math.cos(ra + th) * rr, dy - Math.sin(ra + th) * rr);
        if (d < 1.75) { m.set(x, y, ZC + 4, brass); if (d < 0.9) m.set(x, y, ZC + 5, brassL); }
        else if (fract(rf * RV / 2) < 0.08) m.set(x, y, ZC + 3, enamelL);
      }
      continue;
    }
    if (rf >= R_HUB - 0.02) {
      // spokes: chunky bars tapering toward the rim, a raised ridge, fillets where they meet the rim and the hub
      const k = Math.round(a / spokeA), da = a - k * spokeA;
      const perp = Math.abs(Math.sin(da)) * r, along = Math.cos(da) * r;
      let half = lerp(3.1, 2.3, clamp01((rf - R_HUB) / (R_RIM - R_HUB)));
      half += Math.max(0, rf - (R_RIM - 0.08)) * RV * 0.9 + Math.max(0, R_HUB + 0.06 - rf) * RV * 0.9;
      if (along <= 0 || perp > half) {
        if (rf < R_HUB) { put(x, y, -3, 3, steel); }
        continue;
      }
      put(x, y, -2, 1, steelD);
      m.set(x, y, ZC + 2, perp > half - 1 ? steel : steelB);
      if (perp < 1.05) m.set(x, y, ZC + 3, steelL);
      continue;
    }
    // hub: a drum with a chamfered edge, 6 brass bolts, a raised boss, a hex nut and the aqua gem
    put(x, y, -3, 2, steelD);
    if (rf > R_HUB - 1.2 / RV) { m.set(x, y, ZC + 3, steel); continue; }
    const ba = (Math.round(a / spokeA - 0.5) + 0.5) * spokeA, br = 0.205 * RV;
    const bd = Math.hypot(dx - Math.cos(ba + th) * br, dy - Math.sin(ba + th) * br);
    if (rf > R_BOSS) {
      m.set(x, y, ZC + 3, steelB); m.set(x, y, ZC + 4, Math.floor(r) % 2 ? steel : steelB);
      if (bd < 1.45) { m.set(x, y, ZC + 4, brass); m.set(x, y, ZC + 5, bd < 0.8 ? brassL : brass); }
      continue;
    }
    put(x, y, 3, 4, steelB);
    m.set(x, y, ZC + 5, rf > R_BOSS - 1.1 / RV ? steelL : steel);
    // hex nut (flat-to-flat 0.2 RV), turning with the gear
    let hx = 0;
    for (let i = 0; i < 3; i++) { const na = th + i * (TAU / 6); hx = Math.max(hx, Math.abs(dx * Math.cos(na) + dy * Math.sin(na))); }
    if (hx < 0.105 * RV) {
      m.set(x, y, ZC + 6, hx > 0.105 * RV - 1.1 ? nutL : nut);
      if (r < 0.06 * RV) { m.set(x, y, ZC + 7, gem); if (r < 0.035 * RV) m.set(x, y, ZC + 8, gemL); }
    }
  }
  return { m, c: [C, C, ZC + 0.5] };
}

// The static housing: a dark backplate behind the gear, a chunky blue voxel ring round it with 12 lamp sockets and
// silver rivets between them. Lamp sockets sit at the lamp() positions.
// [fishui30] The housing is an OCTAGON (square pixel art, no round chrome): distances use the octagon norm, the lamps
// and rivets sit on the octagon's ring (octPt), and the lamps are square voxel blocks.
const lampR = (RV) => RV + 5.5;
const oct = (dx, dy) => { const ax = Math.abs(dx), ay = Math.abs(dy); return Math.max(ax, ay, (ax + ay) * 0.7071); };
const octPt = (a, r) => { const c = Math.cos(a), s = Math.sin(a), k = r / oct(c, s); return [c * k, s * k]; };
function housingModel(RV) {
  const C = RV + 13, N = 2 * C, NZ = ZC * 2 + 1;
  const m = new VoxelModel(N, N, NZ);
  const P = memoPal(m);
  const back = P('#174d72', ENAMEL), backL = P('#21638f', ENAMEL), backD = P('#134466', ENAMEL);
  const ring = P('#2f6fa4', ENAMEL), ringB = P('#3a7db4', ENAMEL), ringL = P('#a8dcf8', ENAMEL), ringD = P('#1c4b78', ENAMEL);
  const lens = P('#0f3550', GEMM), lensL = P('#3f7896', GEMM), riv = P('#dcebf5');
  const r0 = RV + 2.6, r1 = RV + 8.6, lr = lampR(RV);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - C, dy = y + 0.5 - C, r = oct(dx, dy);
    if (r > r1) continue;
    const a = Math.atan2(dy, dx);
    if (r < r0) {
      // the backplate: recessed, faint concentric rings and a block texture
      const z = -6;
      const ringy = Math.abs(fract(r / 7) - 0.5) < 0.08;
      const chk = ((x >> 2) + (y >> 2)) % 2;
      m.set(x, y, ZC + z - 1, backD);
      m.set(x, y, ZC + z, ringy ? backL : chk ? back : backD);
      continue;
    }
    // the ring: a raised inner bead, a flat face, a bevelled outer edge
    const z1 = r < r0 + 1.1 ? 5 : r > r1 - 1.2 ? 3 : 4;
    for (let z = -6; z < z1; z++) m.set(x, y, ZC + z, ringD);
    let c = r < r0 + 1.1 ? ringL : r > r1 - 1.2 ? ring : Math.floor(r) % 2 ? ring : ringB;
    m.set(x, y, ZC + z1, c);
    // lamp sockets: dark glass lenses
    const la = Math.round(a / (TAU / N_LAMPS)) * (TAU / N_LAMPS);
    const [lx, ly] = octPt(la, lr);
    const ld = Math.max(Math.abs(dx - lx), Math.abs(dy - ly)); // square sockets
    if (ld < 2.2) { m.set(x, y, ZC + 4, ld < 1.6 ? lens : ringD); if (ld < 0.9) m.set(x, y, ZC + 4, lensL); }
    // silver rivets between the lamps
    const ra = (Math.round(a / (TAU / N_LAMPS) - 0.5) + 0.5) * (TAU / N_LAMPS);
    const [qx, qy] = octPt(ra, lr);
    const rd = Math.max(Math.abs(dx - qx), Math.abs(dy - qy));
    if (rd < 1) m.set(x, y, ZC + 5, riv);
  }
  return { m, c: [C, C, ZC + 0.5] };
}

// A lit lamp: a small glowing voxel dome in colour `hex`.
function lampModel(hex) {
  const m = new VoxelModel(5, 5, 3);
  const c = m.color(hex, { spec: 1.2, specPow: 8, smooth: 0.8, jitter: 0, light: 1 }), w = m.color('#ffffff', { light: 1, jitter: 0 });
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { // [fishui30] a square lamp block (corners stepped)
    if ((x === 0 || x === 4) && (y === 0 || y === 4)) continue;
    m.set(x, y, 0, c); m.set(x, y, 1, c);
    if (x > 0 && x < 4 && y > 0 && y < 4) m.set(x, y, 2, x === 1 && y === 3 ? w : c);
  }
  return { m, c: [2.5, 2.5, 0] };
}

// Projected offset (px at s px per voxel) of a model-space point relative to the model centre, at VIEW.
function projOff(px, py, pz, s) {
  const Y = -VIEW.yaw, cy = Math.cos(Y), sy = Math.sin(Y), cp = Math.cos(VIEW.pitch), sp = Math.sin(VIEW.pitch);
  return [(px * cy - pz * sy) * s, -(px * -sp * sy + py * cp + pz * -sp * cy) * s];
}

// renderLayers of one model into an S x S canvas (k = 1 logical, HI = the full-res twin)
function renderVox(v, S, k, shadow = true) {
  return renderLayers({ base: v.m, over: null, glass: null, c: v.c }, { S: S * k, s: VPX * k, yaw: VIEW.yaw, pitch: VIEW.pitch, T: k > 1 ? 2 : 1, shadow });
}

const LAMP_COL = { aqua: '#4fd8f0', green: '#7ff04a', orange: '#ff9d2e', red: '#ff4f5e', gold: '#ffd23a', white: '#f4ffff' };
const LAMPS = new Map();
function lampSprite(col, k) {
  const key = col + k;
  let c = LAMPS.get(key);
  if (!c) { c = renderVox(lampModel(LAMP_COL[col]), 12, k, false); LAMPS.set(key, c); }
  return c;
}

// ------------------------------------------------------------------------------------------------ 2D art
const ART = new Map();
function art(key, make) {
  let c = ART.get(key);
  if (!c) { c = make(); ART.set(key, c); }
  return c;
}
function paint(w, h, fn) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    if (!v) continue;
    const i = (y * w + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v[3] ?? 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RAMPS = {
  track: ['#5d8fae', '#86b4cf', '#b4d9ec', '#e2f4fc', '#ffffff'],
  lime: ['#2f7a1e', '#3fae2a', '#6cd03a', '#a6ec5a', '#e2ffb0'],
  band: ['#1f8a3a', '#2fc85a', '#6cf08a', '#b8ffc8', '#ffffff'],
  red: ['#7a1a1a', '#c8303a', '#ff5a4a', '#ff9a7a', '#ffe0d0'],
  orange: ['#8a3a06', '#d8701a', '#ff9d2e', '#ffc870', '#fff0d0'],
  gold: ['#a86a00', '#e0a000', '#ffd23a', '#fff07a', '#fffbe0'],
  aqua: ['#0a5f88', '#1fb8dc', '#4fd8f0', '#8ff0ff', '#e8fdff'],
  white: ['#7fa4bc', '#b4d0e2', '#e2f2fc', '#ffffff', '#ffffff'],
  dark: ['#06243a', '#0c3a52', '#164e6c', '#21627f', '#3a7a98'],
  grey: ['#3a4a58', '#56687a', '#7a8c9c', '#a4b4c2', '#d4e0ea'],
};
const RAMP_RGB = Object.fromEntries(Object.entries(RAMPS).map(([k, v]) => [k, v.map(hex)]));
const rampAt = (ramp, l) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(clamp01(l) * (ramp.length - 1))))];

// Glossy tube ring (a torus seen face-on): radius r, thickness th, lit from the top-left, dark outline.
function tubeRing(r, th, rampName, alpha = 255) {
  return art(`ring${r}|${th}|${rampName}|${alpha}`, () => {
    const C = r + th, S = C * 2 + 1, ramp = RAMP_RGB[rampName], hw = th / 2;
    return paint(S, S, (x, y) => {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      const u = (d - r) / hw;
      if (Math.abs(u) > 1.12) return null;
      if (Math.abs(u) > 0.86) return [12, 58, 82, Math.min(255, alpha + 40)];
      const nx = dx / (d || 1), ny = dy / (d || 1);
      const facing = -(nx * -0.6 + ny * -0.8); // > 0 on the side away from the light
      const nz = Math.sqrt(Math.max(0, 1 - u * u));
      let l = 0.3 + 0.5 * nz - 0.28 * u * facing;
      if (u < -0.15 && u > -0.6 && facing < 0.2) l = Math.max(l, 0.95); // specular streak on the lit side
      return [...rampAt(ramp, l), alpha];
    });
  });
}

// Glass disc behind the whole gear HUD: keeps it readable over the bright sky and the dark abyss alike.
function plateSprite(r) {
  return art('plate' + r, () => {
    const S = r * 2 + 3, C = r + 1;
    return paint(S, S, (x, y) => {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      if (d > r + 0.5) return null;
      if (d > r - 1.2) return [12, 58, 82, 210];
      if (d > r - 2.4) return [255, 255, 255, 200];
      const k = d / r;
      // glass lip: a bright aqua band round the edge, lit at the top-left
      if (d > r - 7) { const lit = clamp01(0.5 - (dx + dy) / (r * 2.2)); return [Math.round(lerp(120, 235, lit)), Math.round(lerp(205, 252, lit)), 255, Math.round(lerp(120, 200, lit))]; }
      const top = dy < 0 && Math.hypot(dx + r * 0.22, dy + r * 0.3) < r * 0.66 && Math.hypot(dx + r * 0.08, dy + r * 0.02) > r * 0.64;
      if (top) return [255, 255, 255, 80];
      return [Math.round(lerp(150, 30, k * 0.8)), Math.round(lerp(215, 105, k * 0.7)), 255, Math.round(lerp(80, 150, k))];
    });
  });
}

// Glossy sphere (orbs, knobs).
function sphere(r, rampName) {
  return art(`sph${r}|${rampName}`, () => {
    const ramp = RAMP_RGB[rampName], s = r * 2 + 1;
    return paint(s, s, (x, y) => {
      const dx = (x - r) / (r + 0.35), dy = (y - r) / (r + 0.35);
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) return null;
      if (d2 > 0.8) return [12, 58, 82, 255];
      const nz = Math.sqrt(1 - d2);
      let l = clamp01(0.15 + 0.85 * Math.max(0, (dx * -0.5 + dy * -0.6 + nz * 0.62) / 0.94));
      const hx = (dx + 0.36) / 0.28, hy = (dy + 0.42) / 0.18;
      if (hx * hx + hy * hy < 1) return [255, 255, 255, 255];
      if (dy > 0.35 && d2 < 0.6) l = Math.min(1, l + 0.15);
      return [...rampAt(ramp, l), 255];
    });
  });
}

// Tension capsule: a glass tube with a left-edge gloss stripe (drawn over the fill).
function tubeGlass(w, h, front) {
  return art(`tube${w}|${h}|${front}`, () => {
    const r = w / 2;
    return paint(w + 2, h + 2, (x, y) => {
      const cx = x - 1 - r + 0.5, yy = y - 1;
      const dyc = yy < r ? r - yy - 0.5 : yy > h - r ? yy - (h - r) + 0.5 : 0;
      const d = Math.hypot(cx, dyc);
      if (d > r + 0.5) return null;
      if (d > r - 0.7) return front ? [12, 58, 82, 255] : null;
      const u = cx / r;
      if (front) {
        if (u > -0.62 && u < -0.28 && yy > r * 0.6 && yy < h - r * 0.8) return [255, 255, 255, 150];
        if (u > 0.5 && u < 0.7 && yy > r && yy < h - r) return [255, 255, 255, 50];
        return null;
      }
      return [190, 235, 255, 90];
    });
  });
}

// Draws a ring sprite clipped to the clockwise arc a0 -> a1 (canvas angles: 0 = right, clockwise).
function arcSprite(ctx, spr, cx, cy, a0, a1, alpha = 1) {
  if (a1 <= a0 + 1e-4) return;
  const C = (spr.width - 1) / 2;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (a1 - a0 < TAU - 1e-3) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, C + 4, a0, a1);
    ctx.closePath();
    ctx.clip();
  }
  ctx.drawImage(spr, Math.round(cx - C), Math.round(cy - C));
  ctx.restore();
}

// A small glossy glass pill (readouts), centred at cx.
function drawPillGlass(ctx, cx, y, w, h) {
  const x = Math.round(cx - w / 2), r = Math.floor(h / 2);
  for (let i = 0; i < h; i++) {
    const dy = i < r ? r - i - 0.5 : i >= h - r ? i - (h - r) + 0.5 : 0;
    const inset = dy > 0 ? Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy))) : 0;
    const k = i / Math.max(1, h - 1);
    ctx.fillStyle = INK; ctx.fillRect(x + inset - 1, y + i, w - inset * 2 + 2, 1);
    ctx.fillStyle = k < 0.45 ? `rgba(${Math.round(lerp(120, 60, k))},${Math.round(lerp(200, 150, k))},235,0.92)` : `rgba(12,${Math.round(lerp(70, 40, k))},${Math.round(lerp(110, 80, k))},0.92)`;
    ctx.fillRect(x + inset, y + i, w - inset * 2, 1);
  }
  ctx.fillStyle = INK; ctx.fillRect(x + r, y - 1, w - 2 * r, 1); ctx.fillRect(x + r, y + h, w - 2 * r, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + r, y + 1, w - 2 * r, 1);
}

const TENSION_COLS = ['#2fd3e8', '#4fe0c8', '#8be04a', '#c8f56a', '#ffd23a', '#ff9d2e', '#ff4f5e'];
function tensionColor(k) {
  return TENSION_COLS[Math.min(TENSION_COLS.length - 1, Math.max(0, Math.floor(k * TENSION_COLS.length * 0.999)))];
}
const glowRgb = (h) => hex(h).map((v) => v / 255);

// ------------------------------------------------------------------------------------------------ the gear
export class Gear {
  constructor(F) {
    this.F = F;
    this.t = 0;
    this.rpm = 0; this.rpmShown = 0; this.p = 0;
    this.hand = 0;
    this.load = 0; this.brake = false;
    this.dir = 1;
    this.angle = 0;
    this.hist = [0, 0, 0, 0];
    this.jam = 0;
    this.show = 0;
    this.pop = 0; // 0..1 entrance flip
    this.tiltX = 0; this.tiltY = 0; this.tiltVX = 0; this.tiltVY = 0;
    this.heat = 0; // strain glow
    this.flash = 0; this.flashCol = '#ffffff';
    this.strain = 0; this.snapped = 0; this.denied = 0; this.fire = 0; this.btnPress = 0; this.kickK = 0;
    this.lay = null; this.layW = 0; this.layH = 0;
    this.cache = null; this.img = null;
    this.mode = null;
    this.prog = 0;
    this.sparkT = 0; this.glintT = 0;
  }

  reset() {
    this.strain = 0; this.snapped = 0; this.denied = 0; this.fire = 0; this.kickK = 0;
    this.prog = 0; this.jam = 0; this.brake = false;
  }

  kick(n = 1) { this.kickK = Math.max(this.kickK, n); this.tiltVY += 2.2 * n; this.tiltVX -= 1.2 * n; }
  // A sudden change of speed (backfire, snag): the gear lurches and tilts.
  jolt(drpm) { this.rpm += drpm; this.tiltVX += drpm * 0.025; this.tiltVY -= drpm * 0.018; }
  flashOn(col, k = 1) { this.flash = Math.max(this.flash, k); this.flashCol = col; }
  idle(dt) { this.update(dt, null); }

  layout(W, H) {
    if (this.lay && this.layW === W && this.layH === H) return this.lay;
    const S = H / 540;
    const R = Math.round(clamp(H * 0.158, 62, 150));
    const cx = Math.round(W - R - 78 * S), cy = Math.round(H - R - 52 * S);
    const rp = R + Math.round(10 * S), tp = Math.max(6, Math.round(8 * S)); // progress ring
    const rg = R + Math.round(26 * S), tg = Math.max(8, Math.round(11 * S)); // gauge
    const tw = Math.max(14, Math.round(20 * S)), th = Math.round(R * 1.75);
    const tx = Math.round(cx - rg - tg - 10 * S - tw), ty = Math.round(cy - th * 0.6);
    this.lay = { S, R, cx, cy, rp, tp, rg, tg, tw, th, tx, ty, size: 2 * Math.ceil(R * 1.22) + 2, bx: cx, by: Math.round(cy - rg - 26 * S), br: Math.round(9 * S) };
    this.layW = W; this.layH = H;
    return this.lay;
  }

  hitShock() { return false; }

  // Screen rect of the whole gear HUD (gauge included) while it is up, else null (the guide points at it).
  rect() {
    if (this.show < 0.5 || !this.lay) return null;
    const L = this.lay, r = L.rg + L.tg;
    return { x: L.cx - r, y: L.cy - r, w: r * 2, h: r * 2 };
  }

  // [tut16] Screen rects of the gear HUD's parts (the fishing lesson brackets them): 'gauge' (the RPM gauge and
  // gear), 'tension' (the glass tube), 'shock' (the bolt orbs and the hold hint), 'readout' (the RPM pill).
  partRect(kind, B = null) {
    if (this.show < 0.5 || !this.lay) return null;
    const L = this.lay, S = L.S;
    if (kind === 'tension') return { x: L.tx - 4, y: L.ty - 4, w: L.tw + 8, h: L.th + Math.round(16 * S) + 8 };
    if (kind === 'shock') {
      const n = Math.max(1, B?.shockMax ?? 1), r = Math.max(8, Math.round(12 * S)), gap = r * 2 + Math.round(6 * S);
      const y = Math.round(L.cy - L.rg - L.tg - r - 10 * S), x0 = Math.round(L.cx - ((n - 1) * gap) / 2);
      const x1 = x0 + (n - 1) * gap + r + Math.round(46 * S + 13 * S);
      return { x: x0 - r - 3, y: y - r - 3, w: x1 - (x0 - r - 3), h: r * 2 + Math.round(14 * S) + 6 };
    }
    if (kind === 'readout') { const y = Math.round(L.cy + L.rg + L.tg * 0.2), w = Math.round(84 * S); return { x: L.cx - w / 2, y: y - Math.round(14 * S), w, h: Math.round(28 * S) }; }
    return this.rect();
  }

  // ---------------------------------------------------------------- physics + fx
  update(dt, B) {
    const F = this.F, cr = F.crank;
    this.t += dt;
    const L = this.layout(F.W, F.H);
    const active = !!B;
    this.mode = B?.gearMode || null;
    this.show = clamp01(this.show + dt * (active ? 3.2 : -2.5));
    this.pop = active ? Math.min(1, this.pop + dt * 2.2) : 0;
    // the hand: circling speed (rpm) while the circle is big enough to count
    const rk = clamp01((cr.radius - 3) / 9);
    const jammed = cr.stun > 0 || this.jam > 0;
    let hand = jammed ? 0 : (cr.speed || 0) * 60 * rk;
    // [simple24] other ways to spin: hold W / Up / R (a steady crank), tap them, or roll the mouse wheel
    const inp = F.input;
    // [polish32] no battle (the gear sliding in / out, a boss intro) = the meter housing too, not the old round RPM gauge
    const meter = !B || B.gearMode === 'meter';
    if (meter && !jammed && inp) {
      const keys = ['w', 'ArrowUp', 'r'];
      if (keys.some((k) => inp.key?.(k))) hand = Math.max(hand, 135);
      if (keys.some((k) => inp.keyPressed?.(k))) this.rpm += 26;
      if (inp.wheel) { this.rpm += Math.min(3, Math.abs(inp.wheel)) * 20; this.wheelT = 0.25; }
    }
    this.wheelT = Math.max(0, (this.wheelT || 0) - dt);
    this.hand = hand;
    const drive = active && hand > 14;
    if (drive && cr.dir) this.dir = cr.dir;
    let acc = -this.rpm * (drive ? 0.15 : this.wheelT > 0 ? 0.3 : 0.7) - (active ? this.load : 0);
    if (drive) acc += GRIP * (hand - this.rpm);
    this.rpm += acc * dt;
    if (meter && this.rpm < 0) this.rpm = damp(this.rpm, 0, 8, dt); // the meter fight never spins the gear backwards
    if (!active) this.rpm = damp(this.rpm, 0, 3, dt);
    if (this.brake && this.rpm < 0) this.rpm = damp(this.rpm, 0, 14, dt);
    this.rpm = clamp(this.rpm, -180, 330);
    this.jam = Math.max(0, this.jam - dt);
    this.p = Math.max(0, this.rpm) / RPM_UNIT;
    this.rpmShown = damp(this.rpmShown, this.rpm, 12, dt);
    // spin (clockwise on screen when circling clockwise) + motion-blur history
    const dA = this.dir * (this.rpm / 60) * TAU * dt;
    this.angle -= dA;
    this.spinV = -dA / Math.max(dt, 1e-3);
    // 3D tilt: a spring kicked by jolts (hook-set, backfire, won counters); it rests at the cached view
    this.tiltVX += (-this.tiltX * 70 - this.tiltVX * 9) * dt;
    this.tiltVY += (-this.tiltY * 70 - this.tiltVY * 9) * dt;
    this.tiltX += this.tiltVX * dt; this.tiltY += this.tiltVY * dt;
    if (Math.abs(this.tiltX) + Math.abs(this.tiltVX) * 0.05 < 0.004) { this.tiltX = 0; this.tiltVX = 0; }
    if (Math.abs(this.tiltY) + Math.abs(this.tiltVY) * 0.05 < 0.004) { this.tiltY = 0; this.tiltVY = 0; }
    // states
    const T = B ? clamp(B.tension ?? 0, 0, 1.2) : 0;
    const over = B?.band && this.rpm > B.band.hi;
    this.heat = damp(this.heat, T > 0.88 || (over && B.gearMode === 'fight') ? 1 : 0, 5, dt);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.strain = Math.max(0, this.strain - dt * 2.2);
    this.denied = Math.max(0, this.denied - dt * 4);
    this.fire = Math.max(0, this.fire - dt * 3);
    this.kickK = Math.max(0, this.kickK - dt * 2.5);
    this.btnPress = Math.max(0, this.btnPress - dt * 6);
    if (B) this.prog = damp(this.prog, clamp01(B.gearMode === 'hook' ? B.set ?? 0 : B.progress ?? 0), 10, dt);
    if (!active || this.show < 0.5) return;
    // ---- screen fx at speed: sparks flicking off the teeth, glints racing round the rim
    const fx = F.fx, R = L.R, rpmA = Math.abs(this.rpm);
    this.sparkT -= dt;
    if (rpmA > 120 && this.sparkT <= 0) {
      this.sparkT = lerp(0.12, 0.02, clamp01((rpmA - 120) / 140));
      const a = Math.random() * TAU;
      const x = L.cx + Math.cos(a) * R, y = L.cy + Math.sin(a) * R * 0.92;
      const tang = a + (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const hot = this.heat > 0.4;
      fx.sparks(x, y, hot ? 2 : 1, { dir: tang, spread: 0.35, speed: [80, 200], g: 240, colors: hot ? ['#ffffff', '#ffd23a', '#ff9a3a', '#ff5a4a'] : ['#ffffff', '#bff8ff', '#fff6a0'] });
    }
    this.glintT -= dt;
    if (this.glintT <= 0) {
      this.glintT = rpmA > 60 ? 0.18 : 0.9;
      const a = -Math.PI * 0.75 + (Math.random() - 0.5) * 0.7;
      fx.glint(L.cx + Math.cos(a) * R * 0.93, L.cy + Math.sin(a) * R * 0.93, { len: rpmA > 120 ? 7 : 5, color: '#ffffff' });
    }
    // charging: arcs crawl over the teeth
    const ch = B.charge;
    if (ch && ch.k > 0.1 && Math.random() < dt * (8 + ch.k * 30)) {
      const a0 = Math.random() * TAU, a1 = a0 + (Math.random() - 0.5) * 1.6;
      fx.arc(L.cx + Math.cos(a0) * R * 0.95, L.cy + Math.sin(a0) * R * 0.95, L.cx + Math.cos(a1) * (R + 12 + ch.k * 16), L.cy + Math.sin(a1) * (R + 12 + ch.k * 16), { jag: 4, color: ch.k > (B.chargeWin?.hi ?? 1) ? '#ff9a7a' : '#fff07a', life: 0.12 });
    }
  }

  // ---------------------------------------------------------------- voxel render [gear25]
  // Voxels to the tooth tips for the current layout.
  rv(L) { return Math.max(16, Math.round(L.R / VPX)); }

  // The cached spin frames (NF over the 60-degree symmetry) at scale k (1 | HI) for the current size.
  frames(L, k = 1) {
    const key = L.size + '|' + k;
    if (!this.cache || this.cache.key0 !== L.size) this.cache = { key0: L.size, sets: new Map(), housing: new Map() };
    let c = this.cache.sets.get(key);
    if (!c) { c = { list: new Array(NF).fill(null), n: 0 }; this.cache.sets.set(key, c); }
    return c;
  }

  frame(L, i, k = 1) {
    const c = this.frames(L, k);
    i = ((i % NF) + NF) % NF;
    if (!c.list[i]) {
      c.list[i] = renderVox(gearModel(this.rv(L), (i / NF) * SYM), L.size, k);
      c.n++;
    }
    return c.list[i];
  }

  // The frame nearest to i that is already built (or i itself, built now, within a small per-frame budget).
  frameNear(L, i, k) {
    const c = this.frames(L, k);
    i = ((i % NF) + NF) % NF;
    if (c.list[i]) return c.list[i];
    // a missing frame is built at most every few game frames (the nearest built one stands in meanwhile)
    const now = performance.now();
    if (!c.n || now - (this.buildT || 0) > 60) { const f = this.frame(L, i, k); this.buildT = performance.now(); return f; }
    for (let d = 1; d <= NF / 2; d++) for (const j of [i - d, i + d]) { const f = c.list[((j % NF) + NF) % NF]; if (f) return f; }
    return this.frame(L, i, k);
  }

  housing(L, k = 1) {
    this.frames(L, k);
    let h = this.cache.housing.get(k);
    if (!h) { h = renderVox(housingModel(this.rv(L)), L.size + 28, k); this.cache.housing.set(k, h); }
    return h;
  }

  // Render a few missing frames (call while the player waits for a bite) so the first spin never hitches.
  warm(n = 1) {
    // throttled: at most one voxel frame every few game frames, so the wait for a bite stays smooth
    const now = performance.now();
    if (now - (this.buildT || 0) < 45) return;
    const F = this.F, L = this.layout(F.W, F.H);
    const ks = HI_ON.on ? [1, HI] : [1];
    for (const k of ks) {
      if (n <= 0) break;
      if (!this.cache?.housing?.get(k)) { this.housing(L, k); n--; continue; }
      const c = this.frames(L, k);
      for (let i = 0; i < NF && n > 0; i++) if (!c.list[i]) { this.frame(L, i, k); n--; }
    }
    if (n <= 0) this.buildT = performance.now();
  }

  // The gear's look this frame at scale k: a cached spin frame (+ motion-blur ghosts) with a state tint.
  renderGear(L, B, k) {
    const S = L.size * k;
    if (!this.comp || this.comp.width !== S) { this.comp = makeCanvas(S, S); this.compCtx = ctxOf(this.comp); }
    const g = this.compCtx;
    g.clearRect(0, 0, S, S);
    const fa = ((this.angle % SYM) + SYM) % SYM / SYM * NF;
    const i0 = Math.round(fa);
    // motion blur: the frames the gear just swept through, fainter and behind
    const blur = clamp01((Math.abs(this.rpm) - 45) / 150);
    if (blur > 0) {
      const lag = clamp((this.spinV * 0.03) / (SYM / NF), -3, 3);
      for (let q = 3; q >= 1; q--) {
        g.globalAlpha = blur * (0.5 - q * 0.12);
        g.drawImage(this.frameNear(L, Math.round(fa - lag * q * 0.6), k), 0, 0);
      }
      g.globalAlpha = 1;
    }
    g.drawImage(this.frameNear(L, i0, k), 0, 0);
    // state tint (charge, strain, stun, flashes) over the steel
    const ch = B?.charge?.k || 0;
    let tc = null, ta = 0;
    if (ch > 0) { tc = ch > (B.chargeWin?.hi ?? 1) ? '#ff7a5a' : '#fff07a'; ta = 0.12 + ch * 0.3 + (Math.random() < 0.2 ? 0.15 : 0); }
    else if (this.heat > 0.05) { tc = '#ff7a2a'; ta = this.heat * (0.15 + 0.08 * Math.sin(this.t * 30)); } // red-hot strain
    else if (B?.stunned) { tc = '#bff8ff'; ta = 0.1 + (Math.floor(this.t * 20) % 2) * 0.12; }
    else if (this.state(B) === 'sweet') { tc = '#8be04a'; ta = 0.05 + 0.03 * Math.sin(this.t * 9); }
    if (this.flash > 0 && this.flash * 0.6 > ta) { tc = this.flashCol; ta = this.flash * 0.6; }
    if (tc && ta > 0.01) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(tc, Math.min(0.85, ta));
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
    }
    return this.comp;
  }

  // The housing's 12 voxel lamps: a speed gauge (lit clockwise from the top as the gear speeds up) in the state's
  // colour; a slow aqua chase while the gear rests; all flash with the gear.
  drawLamps(ctx, cx, cy, L, B, st, k) {
    const RV = this.rv(L), lr = lampR(RV), t = this.t;
    const spd = clamp01(Math.abs(this.rpm) / 240);
    let col = this.heat > 0.4 || st === 'rip' ? 'red' : B?.stunned ? (Math.floor(t * 10) % 2 ? 'white' : 'aqua') : B?.charge ? 'gold' : st === 'sweet' ? 'green' : st === 'over' ? 'orange' : 'aqua';
    let lit = Math.round(spd * N_LAMPS);
    let chase = -1;
    if (B && Math.abs(this.rpm) < 8 && !B.stunned) { lit = 0; chase = Math.floor(t * 6) % N_LAMPS; }
    if (this.flash > 0.25) { lit = N_LAMPS; col = 'white'; }
    const blink = spd > 0.85 && Math.floor(t * 12) % 2;
    for (let j = 0; j < N_LAMPS; j++) {
      const on = j < lit || j === chase;
      if (!on) continue;
      // j = 0 at the top, going clockwise on screen
      const phi = Math.PI / 2 - j * (TAU / N_LAMPS);
      const [px, py] = octPt(phi, lr); // [fishui30] on the octagon
      const [ox, oy] = projOff(px, py, 4.5, VPX);
      const head = j === lit - 1 && spd < 0.98;
      const spr = lampSprite(head || (blink && j % 2) ? 'white' : col, k);
      const w = spr.width / k;
      ctx.drawImage(spr, Math.round(cx + ox - w / 2), Math.round(cy + oy - w / 2), w, w);
    }
  }

  state(B) {
    if (B?.gearMode === 'meter') return Math.abs(this.rpm) < 8 ? 'idle' : B.inZone ? 'sweet' : B.marker > B.zoneW ? 'over' : 'slow';
    const band = B?.band;
    if (!band || Math.abs(this.rpm) < 8) return 'idle';
    if (band.rip !== undefined && this.rpm > band.rip) return 'rip';
    return this.rpm > band.hi ? 'over' : this.rpm >= band.lo ? 'sweet' : 'slow';
  }

  // ---------------------------------------------------------------- HUD
  // k: slide-in 0..1
  draw(ctx, B, k = 1) {
    const F = this.F, t = this.t;
    const L = this.layout(F.W, F.H);
    const vis = Math.min(k, ease.outCubic(this.show));
    if (vis <= 0.01) return;
    const slide = Math.round((1 - vis) * (L.R * 2 + 120));
    const shake = this.heat > 0.3 || this.denied > 0 ? (Math.random() - 0.5) * (this.heat * 3 + this.denied * 4) : 0;
    const cx = L.cx + slide + Math.round(shake), cy = L.cy + Math.round(slide * 0.4);
    const { R, S } = L;
    const st = this.state(B);
    const T = B ? clamp(B.tension ?? 0, 0, 1.2) : 0;
    ctx.save();
    ctx.globalAlpha = clamp01(vis * 1.4);
    // [polish32] no battle (the gear sliding in / out, a boss intro) = the meter housing too, not the old round RPM gauge
    const meter = !B || B.gearMode === 'meter';
    const kk = isHi(ctx) ? HI : 1;
    // ---- box reels: the glass plate under the RPM gauge and the progress ring
    if (!meter) {
      const plate = plateSprite(L.rg + L.tg + Math.round(8 * S));
      ctx.drawImage(plate, cx - (plate.width - 1) / 2, cy - (plate.height - 1) / 2);
      this.drawGauge(ctx, cx, cy, L, B, st);
      this.drawProgress(ctx, cx, cy, L, B);
    }
    // ---- [gear25] the voxel housing (backplate + ring) and its lamps (box reels keep the gauge instead), then the
    // voxel gear (a jolt knocks it about)
    if (meter || !B) {
      const hs = this.housing(L, kk), hw = hs.width / kk;
      ctx.drawImage(hs, Math.round(cx - hw / 2), Math.round(cy - hw / 2), hw, hw);
      this.drawLamps(ctx, cx, cy, L, B, st, kk);
    }
    const jx = Math.round(clamp(this.tiltY, -0.5, 0.5) * R * 0.1), jy = Math.round(clamp(-this.tiltX, -0.5, 0.5) * R * 0.1);
    const img = this.renderGear(L, B, kk);
    ctx.drawImage(img, Math.round(cx - L.size / 2) + jx, Math.round(cy - L.size / 2) + jy, L.size, L.size);
    // speed streaks: bright arcs racing round the teeth
    const sp = clamp01((Math.abs(this.rpm) - 70) / 170);
    if (sp > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const a0 = -this.angle + (i * TAU) / 3;
        for (let j = 0; j < 14; j++) {
          const a = a0 - this.dir * j * 0.045;
          ctx.fillStyle = rgba('#ffffff', sp * (0.7 - j * 0.045));
          ctx.fillRect(Math.round(cx + Math.cos(a) * (R + 2)), Math.round(cy + Math.sin(a) * (R * 0.95 + 2)), 2, 2);
        }
      }
      ctx.restore();
    }
    // stunned fish: arcs crackle across the face
    if (B?.stunned && Math.random() < 0.5) {
      const a0 = Math.random() * TAU, a1 = a0 + 0.8 + Math.random() * 1.5;
      drawBolt(ctx, boltPoints(cx + Math.cos(a0) * R * 0.3, cy + Math.sin(a0) * R * 0.3, cx + Math.cos(a1) * R * 0.85, cy + Math.sin(a1) * R * 0.85, 4, (Math.random() * 1e9) >>> 0), 0.85);
    }
    if (meter) { this.drawSpinHint(ctx, cx, cy, L, B); ctx.restore(); return; }
    if (B?.charge) this.drawCharge(ctx, cx, cy, L, B);
    this.drawReadout(ctx, cx, cy, L, B, st);
    if (B && B.gearMode !== 'hook') this.drawTension(ctx, L.tx + slide, L.ty + Math.round(slide * 0.4), L, B, T);
    if (B && B.shockMax > 0) this.drawShock(ctx, cx, cy, L, B);
    ctx.restore();
  }

  // Outer gauge: track, sweet band, rip / strain zone, needle.
  drawGauge(ctx, cx, cy, L, B, st) {
    const t = this.t;
    const ang = (rpm) => G0 + clamp01(rpm / RPM_MAX) * (G1 - G0);
    arcSprite(ctx, tubeRing(L.rg, L.tg, 'dark', 200), cx, cy, G0, G1);
    // ticks every 30 rpm
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let r = 0; r <= RPM_MAX; r += 30) {
      const a = ang(r), big = r % 60 === 0;
      for (let d = -2; d <= (big ? 3 : 1); d++) ctx.fillRect(Math.round(cx + Math.cos(a) * (L.rg + d)), Math.round(cy + Math.sin(a) * (L.rg + d)), 1, 1);
    }
    const band = B?.band;
    if (band) {
      // the danger zone above the band
      const top = band.rip !== undefined ? band.rip : band.hi;
      const dangerSpr = tubeRing(L.rg, L.tg, band.rip !== undefined ? 'red' : 'orange', 235);
      arcSprite(ctx, dangerSpr, cx, cy, ang(top), G1, band.rip !== undefined ? 0.95 : 0.55);
      // the sweet band (pulses when the needle is inside it)
      const inside = st === 'sweet';
      if (inside || B.gearMode === 'hook') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= inside ? 0.6 + 0.25 * Math.sin(t * 14) : 0.3;
        const am = ang((band.lo + band.hi) / 2), gr = Math.round(L.tg * 2.2);
        ctx.drawImage(glowSprite(gr, '#8be04a'), Math.round(cx + Math.cos(am) * L.rg - gr), Math.round(cy + Math.sin(am) * L.rg - gr));
        ctx.restore();
      }
      arcSprite(ctx, tubeRing(L.rg, L.tg, 'band', 255), cx, cy, ang(band.lo), ang(band.hi));
      // band edge brackets
      for (const r of [band.lo, band.hi]) {
        const a = ang(r);
        ctx.fillStyle = INK;
        pixelLine(ctx, cx + Math.cos(a) * (L.rg - L.tg * 0.75), cy + Math.sin(a) * (L.rg - L.tg * 0.75), cx + Math.cos(a) * (L.rg + L.tg * 0.75), cy + Math.sin(a) * (L.rg + L.tg * 0.75), 3);
        ctx.fillStyle = '#ffffff';
        pixelLine(ctx, cx + Math.cos(a) * (L.rg - L.tg * 0.6), cy + Math.sin(a) * (L.rg - L.tg * 0.6), cx + Math.cos(a) * (L.rg + L.tg * 0.6), cy + Math.sin(a) * (L.rg + L.tg * 0.6), 1);
      }
      // where the band is heading (surges): chevrons running along the gauge
      if (B.bandDir) {
        const am = ang(B.bandDir > 0 ? band.hi : band.lo), dirA = B.bandDir > 0 ? 1 : -1;
        for (let i = 0; i < 3; i++) {
          const ph = ((t * 3 + i / 3) % 1);
          const a = am + dirA * (0.08 + ph * 0.3);
          const x = cx + Math.cos(a) * (L.rg + L.tg + 6 * L.S), y = cy + Math.sin(a) * (L.rg + L.tg + 6 * L.S);
          ctx.fillStyle = rgba('#ffd23a', 1 - ph);
          ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
          ctx.fillStyle = rgba('#ffffff', 1 - ph);
          ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        }
      }
    }
    // needle: a white bar across the gauge and a glossy knob outside
    const rpm = clamp(this.rpmShown, 0, RPM_MAX);
    const a = ang(rpm);
    const ca = Math.cos(a), sa = Math.sin(a);
    const r0 = L.rg - L.tg, r1 = L.rg + L.tg + 3 * L.S;
    ctx.fillStyle = INK;
    pixelLine(ctx, cx + ca * r0, cy + sa * r0, cx + ca * r1, cy + sa * r1, 4);
    ctx.fillStyle = '#ffffff';
    pixelLine(ctx, cx + ca * (r0 + 1), cy + sa * (r0 + 1), cx + ca * (r1 - 1), cy + sa * (r1 - 1), 2);
    const kr = Math.max(4, Math.round(5 * L.S));
    const knob = sphere(kr, st === 'sweet' ? 'band' : st === 'over' ? 'orange' : st === 'rip' ? 'red' : 'aqua');
    const kx = Math.round(cx + ca * (r1 + kr)), ky = Math.round(cy + sa * (r1 + kr));
    ctx.drawImage(knob, kx - kr, ky - kr);
    if (st === 'sweet') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5;
      ctx.drawImage(glowSprite(kr * 3, '#8be04a'), kx - kr * 3, ky - kr * 3);
      ctx.restore();
    }
  }

  // Inner ring: catch progress (fight / box) or the hook-set meter + the bite window (hook).
  drawProgress(ctx, cx, cy, L, B) {
    if (!B) return;
    const top = -Math.PI / 2, t = this.t;
    arcSprite(ctx, tubeRing(L.rp, L.tp, 'dark', 190), cx, cy, 0, TAU);
    const k = this.prog;
    if (B.gearMode === 'hook') {
      // hook-set meter (gold) and the window running out (thin white -> red arc just inside)
      arcSprite(ctx, tubeRing(L.rp, L.tp, 'gold', 255), cx, cy, top, top + k * TAU);
      const tk = clamp01(B.timeK ?? 1);
      const rr = L.rp - L.tp - Math.round(3 * L.S);
      const blink = tk < 0.3 && Math.floor(t * 10) % 2;
      ctx.fillStyle = blink ? '#ffffff' : tk < 0.3 ? '#ff5a4a' : '#ffffff';
      const n = Math.round(rr * TAU * tk * 0.7);
      for (let i = 0; i <= n; i++) {
        const a = top + (i / Math.max(1, n)) * tk * TAU;
        ctx.fillRect(Math.round(cx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr) - 1, 2, 2);
      }
      return;
    }
    // line lost (ghost) in red behind the lime fill
    const ghost = clamp01(B.ghost ?? 0);
    if (ghost > k + 0.003) arcSprite(ctx, tubeRing(L.rp, L.tp, 'red', 255), cx, cy, top + k * TAU, top + ghost * TAU, 0.8);
    arcSprite(ctx, tubeRing(L.rp, L.tp, B.stunned ? 'aqua' : 'lime', 255), cx, cy, top, top + k * TAU);
    if (this.kickK > 0.05) arcSprite(ctx, tubeRing(L.rp, L.tp, 'white', 255), cx, cy, top, top + k * TAU, this.kickK * 0.7);
    // the head of the fill: a glossy bead with a glint
    if (k > 0.01) {
      const a = top + k * TAU, br = Math.max(3, Math.round(L.tp * 0.62));
      const bx = Math.round(cx + Math.cos(a) * L.rp), by = Math.round(cy + Math.sin(a) * L.rp);
      ctx.drawImage(sphere(br, 'white'), bx - br, by - br);
    }
  }

  // The charge ring over the gear face: fill, the PERFECT window and the overcharge zone.
  drawCharge(ctx, cx, cy, L, B) {
    const c = B.charge, w = B.chargeWin || { lo: 0.7, hi: 0.85 };
    const t = this.t, top = -Math.PI / 2;
    const r = Math.round(L.R * 0.5), th = Math.max(7, Math.round(9 * L.S));
    arcSprite(ctx, tubeRing(r, th, 'dark', 230), cx, cy, 0, TAU);
    arcSprite(ctx, tubeRing(r, th, 'red', 200), cx, cy, top + w.hi * TAU, top + TAU, 0.75);
    const inWin = c.k >= w.lo && c.k <= w.hi;
    arcSprite(ctx, tubeRing(r, th, 'gold', 255), cx, cy, top, top + Math.min(c.k, w.lo) * TAU);
    if (c.k > w.hi) arcSprite(ctx, tubeRing(r, th, 'red', 255), cx, cy, top + w.hi * TAU, top + c.k * TAU);
    // the perfect window: bright white band, glowing while the charge is inside it
    arcSprite(ctx, tubeRing(r, th, 'white', 255), cx, cy, top + w.lo * TAU, top + w.hi * TAU, inWin ? 1 : 0.65);
    if (inWin) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= 0.7 + 0.3 * Math.sin(t * 40);
      ctx.drawImage(glowSprite(Math.round(r * 1.3), '#fff6c0'), cx - Math.round(r * 1.3), cy - Math.round(r * 1.3));
      ctx.restore();
    }
    // pointer
    const a = top + Math.min(1, c.k) * TAU;
    const kr = Math.max(4, Math.round(th * 0.6));
    const px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r);
    ctx.drawImage(sphere(kr, c.k > w.hi ? 'red' : inWin ? 'white' : 'gold'), px - kr, py - kr);
    // a crackle between the pointer and the teeth
    if (Math.random() < 0.6) drawBolt(ctx, boltPoints(px, py, cx + Math.cos(a + 0.4) * L.R, cy + Math.sin(a + 0.4) * L.R, 4, (Math.random() * 1e9) >>> 0), 0.8, c.k > w.hi ? '#ff9a7a' : '#fff07a');
    // RELEASE! / overcharge warning over the hub
    const label = inWin ? 'NOW!' : c.k > w.hi ? 'TOO MUCH!' : '';
    if (label) word3D(ctx, label, cx, cy, { t, scale: (inWin ? 1.1 : 0.8) * L.S, pal: inWin ? 'sun' : 'red', wobble: 1.2 });
  }

  // [simple24] Meter fights: a 3D mouse circling the gear (and the wheel / W hint) while the gear is slow, a speed
  // streak of pixel chevrons along the rim while it spins; during a beat the gear rests ('STOP' is the meter's job).
  drawSpinHint(ctx, cx, cy, L, B) {
    const t = this.t, S = L.S, R = L.R;
    const slow = !!B && this.rpm < 40 && !B.beat && !B.stunned;
    if (slow) {
      const a = t * 6;
      const rr = R * 0.62;
      drawIcon3d(ctx, 'mouse', cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.round(28 * S), Math.sin(t * 5) * 0.6);
      word3D(ctx, 'SPIN ME!', cx, Math.round(cy - R - 27 * S), { t, scale: 0.7 * S, pal: 'aqua', wobble: 1.2, alpha: 0.75 + 0.25 * Math.sin(t * 6) });
    }
    this.drawPlaque(ctx, cx, Math.round(cy + R + 21 * S), 'CIRCLE  WHEEL  W');
  }

  // [gear25] The controls label: crisp pixel text on a small navy voxel plaque bolted under the housing.
  drawPlaque(ctx, cx, cy, text) {
    const tw = Math.ceil(measureText(text, 'small')), th = Math.ceil(lineHeight('small'));
    const w = tw + 18, h = th + 7, x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
    pxFrame(ctx, x, y, w, h, { u: 1, step: 2, fill: PXPAL.navy, rim: PXPAL.rim }); // [fishui30] the shared pixel kit frame
    for (const bx of [x + 4, x + w - 6]) { ctx.fillStyle = '#dcebf5'; ctx.fillRect(bx, y + Math.floor(h / 2) - 1, 2, 2); ctx.fillStyle = '#6a879f'; ctx.fillRect(bx + 1, y + Math.floor(h / 2), 1, 1); }
    drawText(ctx, text, cx, y + 4, { font: 'small', align: 'center', color: '#e8fbff', shadow: '#081c2c' });
  }

  // Big glossy RPM number on a glass pill in the gauge's gap, with a spin prompt while the gear is too slow.
  drawReadout(ctx, cx, cy, L, B, st) {
    const t = this.t, S = L.S;
    const rpm = Math.max(0, Math.round(this.rpmShown));
    const pal = st === 'sweet' ? 'lime' : st === 'over' ? 'sun' : st === 'rip' ? 'red' : 'aqua';
    const ds = Math.max(2, Math.round(3 * S));
    // 3D voxel digits (each digit is one cached model, so a changing number stays cheap)
    const str = String(rpm), dw = Math.round(12 * S * (ds / 3));
    const tw = str.length * dw;
    const y = Math.round(cy + L.rg + L.tg * 0.2);
    const ph = 7 * ds + 10, pw = Math.max(tw + 26, Math.round(64 * S));
    drawPillGlass(ctx, cx, y - Math.round(ph / 2), pw, ph);
    for (let i = 0; i < str.length; i++) word3D(ctx, str[i], Math.round(cx - tw / 2 + dw * (i + 0.5)), y, { t: 0, scale: 0.75 * S, pal: pal, wobble: 0 });
    word3D(ctx, 'RPM', cx + Math.round(pw / 2) + Math.round(16 * S), y, { t: 0, scale: 0.4 * S, pal: 'white', wobble: 0 });
    // spin prompt: circling arrows beside the gauge while the gear is too slow
    if (B && (st === 'idle' || st === 'slow') && !B.charge && !B.stunned && B.gearMode !== 'box') {
      // a 3D mouse circling beside the gauge: "circle the mouse"
      const rr = Math.round(12 * S), a = t * 7 * (this.dir || 1);
      const gx = Math.round(cx - L.rg - L.tg - 24 * S), gy = Math.round(cy + L.rg * 0.45);
      drawIcon3d(ctx, 'mouse', gx + Math.cos(a) * rr, gy + Math.sin(a) * rr, Math.round(24 * S), Math.sin(t * 5) * 0.6);
      if (B.gearMode === 'hook') word3D(ctx, 'SPIN!', cx, Math.round(cy - L.rg - L.tg - 26 * S), { t, scale: (1.3 + Math.max(0, Math.sin(t * 9)) * 0.1) * S, pal: 'sun' });
    }
  }

  // Tension: a tall glossy glass capsule left of the gear.
  drawTension(ctx, x, y, L, B, T) {
    const w = L.tw, h = L.th, t = this.t;
    const back = tubeGlass(w, h, false), front = tubeGlass(w, h, true);
    ctx.drawImage(back, x - 1, y - 1);
    const lvl = clamp01(T);
    const fillH = Math.round((h - 4) * lvl);
    const danger = T > 0.9;
    for (let i = 0; i < fillH; i++) {
      const yy = y + h - 2 - i;
      const k = i / (h - 4);
      const r = w / 2;
      const dyc = yy - y < r ? r - (yy - y) - 0.5 : yy - y > h - r ? (yy - y) - (h - r) + 0.5 : 0;
      const half = Math.floor(Math.sqrt(Math.max(0, (r - 1.5) ** 2 - dyc * dyc)));
      if (half <= 0) continue;
      let col = tensionColor(k);
      if (danger && Math.floor(t * 12) % 2) col = i > fillH - 6 ? '#ffffff' : '#ff4f5e';
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x + r - half), yy, half * 2, 1);
      if (i === fillH - 1 || i === fillH - 2) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(Math.round(x + r - half), yy, half * 2, 1); }
    }
    // the red line near the top: past it the line can snap
    const ry = Math.round(y + 2 + (h - 4) * 0.1);
    ctx.fillStyle = INK; ctx.fillRect(x - 3, ry - 1, w + 6, 3);
    ctx.fillStyle = '#ff4f5e'; ctx.fillRect(x - 2, ry, w + 4, 1);
    ctx.drawImage(front, x - 1, y - 1);
    if (danger) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= 0.45 + 0.35 * Math.sin(t * 24);
      const gr = Math.round(w * 1.6);
      ctx.drawImage(glowSprite(gr, '#ff4f5e'), Math.round(x + w / 2 - gr), Math.round(y + 6 - gr));
      ctx.restore();
    }
    // snap timer: a red flare growing at the top
    if (B.snapT > 0) {
      const k = clamp01(B.snapT / (B.grace || 1));
      const r = Math.round(6 + k * 14 * L.S);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= k;
      ctx.drawImage(glowSprite(r, '#ff4f5e'), Math.round(x + w / 2 - r), Math.round(y - r));
      ctx.restore();
    }
    // a little line-and-hook glyph under the tube
    const gx = Math.round(x + w / 2), gy = y + h + Math.round(5 * L.S);
    ctx.fillStyle = INK; ctx.fillRect(gx - 1, gy - 1, 3, 8); ctx.fillRect(gx - 4, gy + 4, 3, 5); ctx.fillRect(gx - 4, gy + 7, 8, 3);
    ctx.fillStyle = '#e8f6fc'; ctx.fillRect(gx, gy, 1, 8); ctx.fillRect(gx - 3, gy + 5, 1, 3); ctx.fillRect(gx - 3, gy + 8, 6, 1);
  }

  // Shock charges as glossy bolt orbs above the gear, a cooldown sweep and the hold hint.
  drawShock(ctx, cx, cy, L, B) {
    const t = this.t, S = L.S;
    const n = B.shockMax;
    const r = Math.max(8, Math.round(12 * S)), gap = r * 2 + Math.round(6 * S);
    const y = Math.round(cy - L.rg - L.tg - r - 10 * S);
    const ready = !!B.canCharge;
    const cdK = B.shockCdMax ? clamp01(B.shockCd / B.shockCdMax) : 0;
    const x0 = Math.round(cx - ((n - 1) * gap) / 2);
    for (let i = 0; i < n; i++) {
      const has = i < B.charges;
      const x = x0 + i * gap;
      const charging = B.charge && i === B.charges - 1;
      const orb = sphere(r, has ? (charging && B.charge.k > (B.chargeWin?.hi ?? 1) ? 'red' : 'gold') : 'grey');
      const den = this.denied > 0 ? Math.round(Math.sin(t * 60) * 2 * this.denied) : 0;
      if (has && (ready || charging)) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= (charging ? 0.5 + B.charge.k * 0.5 : 0.3 + 0.2 * Math.sin(t * 6 + i)) + this.fire * 0.5;
        ctx.drawImage(glowSprite(r + 8, '#ffe27a'), x - r - 8, y - r - 8);
        ctx.restore();
      }
      ctx.drawImage(orb, x - r + den, y - r);
      // cooldown sweep on the next orb
      if (has && i === B.charges - 1 && cdK > 0) {
        ctx.fillStyle = 'rgba(12,58,82,0.55)';
        const a1 = -Math.PI / 2 + cdK * TAU;
        for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
          if (xx * xx + yy * yy > r * r) continue;
          let a = Math.atan2(yy, xx);
          if (a < -Math.PI / 2) a += TAU;
          if (a <= a1) ctx.fillRect(x + xx, y + yy, 1, 1);
        }
      }
      drawIcon3d(ctx, has ? 'bolt' : 'bolt_off', x + den, y, Math.round(r * 1.5), Math.sin(t * 2 + i) * 0.5);
    }
    // hold hint: the mouse / Space glyphs, lit while charging
    if (ready || B.charge) {
      const lit = !!B.charge || Math.floor(t * 3) % 2 === 0;
      const hx = Math.round(x0 + (n - 1) * gap + r + 16 * S);
      drawIcon3d(ctx, lit ? 'mouse_lit' : 'mouse', hx, y, Math.round(22 * S), Math.sin(t * 2) * 0.4);
      drawIcon3d(ctx, lit ? 'space_lit' : 'space', hx + Math.round(30 * S), y, Math.round(26 * S), 0);
      if (!B.charge) word3D(ctx, 'HOLD', hx + Math.round(14 * S), y + Math.round(16 * S), { t, scale: 0.45 * S, pal: 'sun', wobble: 0.5 });
    }
  }
}

