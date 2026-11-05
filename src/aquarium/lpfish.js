// Low-poly 3D fish for the aquarium. Uses the Creatures agent's fishMesh(sp, rec, {phase}) + addFishToScene from
// src/fish/lowpolyfish.js (feature-detected), built under a small per-frame budget (a fish shows its nearest built
// swim frame, or the placeholder, until its frames exist). The placeholder is a lofted body from the species look
// (proportions, colours, tail and fin types; crabs, jellies, rays and eels get their own simple bodies), 1 unit long,
// facing +x, centred, at FISH_PHASES swim phases.
//
//   fishFor(sp, rec, phase) -> {mesh, L (model length), real (true = a lowpolyfish mesh: add it with addFish)}
//   addFish(scene, item, model, o)   adds a fish (all of its parts) to an LPScene
//   beginFishFrame(budgetMs)         call once per frame before fishFor
//   fishKind(sp) -> 'fish' | 'crab' | 'jelly' | 'ray' | 'eel' | 'blob'
//   FISH_PHASES

import { Geo, rgb, mixc, shadec } from './lpkit.js';
import { MUTATIONS } from '../fish/traits.js';
import * as LPFM from '../fish/lowpolyfish.js';

export const FISH_PHASES = 8;
const REAL = typeof LPFM.fishMesh === 'function';
const PLACE = new Map();     // placeholder frames per species + variant
const BUILT = new Map();     // real meshes per key + frame (null = failed)
let budget = 0, spent = 0, t0 = 0;
let failed = false;

let built = 0;
export function beginFishFrame(ms = 6) { budget = ms; spent = 0; built = 0; t0 = performance.now(); }

export function fishKind(sp) {
  const k = sp?.look?.kind;
  if (k === 'crab' || k === 'isopod' || k === 'star') return 'crab';
  if (k === 'jelly' || k === 'pudding') return 'jelly';
  if (k === 'ray') return 'ray';
  if (k === 'chain' || sp?.move?.style === 'chain') return 'eel';
  if (k === 'blob' || k === 'octopus' || k === 'squid') return 'blob';
  return 'fish';
}

function variantKey(rec) {
  const v = rec?.variant || {};
  return (v.mutation || '') + '|' + (v.shiny ? 's' : '') + '|' + (v.pattern || '');
}

function placeholderFrames(sp, rec) {
  const key = sp.id + '|' + variantKey(rec);
  let e = PLACE.get(key);
  if (!e) { e = []; for (let i = 0; i < FISH_PHASES; i++) e.push(placeholder(sp, rec, i / FISH_PHASES)); PLACE.set(key, e); }
  return e;
}

export function fishFor(sp, rec, phase) {
  const fi = Math.floor((((phase % 1) + 1) % 1) * FISH_PHASES) % FISH_PHASES;
  if (REAL && !failed && fishKind(sp) !== 'eel') {
    const key = sp.id + '|' + variantKey(rec);
    let arr = BUILT.get(key);
    if (!arr) BUILT.set(key, (arr = new Array(FISH_PHASES).fill(undefined)));
    if (arr[fi] === undefined && performance.now() - t0 < budget && built < 2) {
      built++;
      try { arr[fi] = LPFM.fishMesh(sp, rec, { phase: fi / FISH_PHASES, frames: FISH_PHASES }) || null; }
      catch (err) { arr[fi] = null; if (!failed) { failed = true; console.warn('fishMesh failed, using placeholder fish', err); } }
    }
    let m = arr[fi];
    if (!m) for (let k = 1; k < FISH_PHASES && !m; k++) m = arr[(fi + k) % FISH_PHASES] || arr[(fi - k + FISH_PHASES) % FISH_PHASES];
    if (m) return { mesh: m, L: m.L || boundsLen(m), real: true };
  }
  return { mesh: placeholderFrames(sp, rec)[fi], L: 1, real: false };
}

// Background warm-up (the tank is hidden): build one missing swim frame of this fish. Returns true if it built one.
export function warmFishFrame(sp, rec) {
  if (!REAL || failed || fishKind(sp) === 'eel') return false;
  const key = sp.id + '|' + variantKey(rec);
  let arr = BUILT.get(key);
  if (!arr) BUILT.set(key, (arr = new Array(FISH_PHASES).fill(undefined)));
  const fi = arr.indexOf(undefined);
  if (fi < 0) return false;
  try { arr[fi] = LPFM.fishMesh(sp, rec, { phase: fi / FISH_PHASES, frames: FISH_PHASES }) || null; } catch { arr[fi] = null; }
  return true;
}

export function addFish(scene, item, model, o = {}) {
  if (item.real && typeof LPFM.addFishToScene === 'function') LPFM.addFishToScene(scene, item.mesh, model, o);
  else scene.add(item.mesh, model, { spec: 0.45, shine: 30, env: 0.3, iri: 0.1, ...o });
}

function boundsLen(m) { const b = m.bounds; return Math.max(0.01, b.max[0] - b.min[0]); }
void spent;

// ------------------------------------------------------------------ placeholder bodies
function palette(sp, rec) {
  const L = sp.look || {};
  const R = L.real?.col || {};
  const c = L.col || {};
  let body = rgb(R.flank || c.body || '#ff8a3a');
  let back = rgb(R.back || c.back || shadec(body, -0.3));
  let belly = rgb(R.belly || c.belly || shadec(body, 0.45));
  let fin = rgb(R.fin || L.tail?.color || c.fin || shadec(body, 0.25));
  const v = rec?.variant || {};
  const tint = (col) => {
    switch (v.mutation) {
      case 'albino': return mixc(col, '#fff4f0', 0.75);
      case 'melanistic': return mixc(col, '#1a1a2a', 0.7);
      case 'golden': return mixc(col, '#ffd23a', 0.65);
      case 'neon': return mixc(col, '#3affd8', 0.5);
      case 'pastel': return mixc(col, '#ffe0f4', 0.5);
      case 'ghost': return mixc(col, '#dff4ff', 0.6);
      case 'crimson': return mixc(col, '#e0203a', 0.6);
      case 'ocean': return mixc(col, '#2a8cff', 0.55);
      case 'galaxy': return mixc(col, '#5a2aa8', 0.6);
      case 'inverted': return [1 - col[0], 1 - col[1], 1 - col[2]];
      default: return col;
    }
  };
  if (v.mutation && MUTATIONS?.[v.mutation] !== undefined) { body = tint(body); back = tint(back); belly = tint(belly); fin = tint(fin); }
  if (v.shiny) { body = mixc(body, '#fff6b0', 0.25); fin = mixc(fin, '#ffffff', 0.3); }
  return { body, back, belly, fin };
}

function placeholder(sp, rec, phase) {
  const kind = fishKind(sp);
  const col = palette(sp, rec);
  const g = new Geo();
  g.jit = 0.1;
  g.seed = sp.id.length * 77;
  const sw = Math.sin(phase * Math.PI * 2);
  if (kind === 'crab') crab(g, col, sw);
  else if (kind === 'jelly') jelly(g, col, phase);
  else if (kind === 'ray') ray(g, col, sw);
  else if (kind === 'eel') eel(g, col, phase);
  else if (kind === 'blob') blob(g, col, phase);
  else fishBody(g, sp, col, sw);
  // scale to 1 unit long, centred
  const b = g.bounds();
  const L = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) || 1;
  const d = g.d;
  for (let i = 0; i < g.n; i += 11) { d[i] = (d[i] - b.center[0]) / L; d[i + 1] = (d[i + 1] - b.center[1]) / L; d[i + 2] = (d[i + 2] - b.center[2]) / L; }
  return g.build();
}

// classic fish: lofted body (nose +x), forked/round tail that sweeps with the phase, dorsal, pectorals, eyes
function fishBody(g, sp, col, sw) {
  const L = sp.look || {};
  const hk = Math.min(0.9, Math.max(0.28, (L.body?.h || 20) / (L.body?.len || 40)));
  const shape = L.body?.shape || 'oval';
  const wk = shape === 'disc' ? 0.38 : shape === 'round' ? 0.85 : shape === 'long' || shape === 'torpedo' ? 0.62 : 0.55;
  const N = 9, seg = 10;
  const rings = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1); // 0 = nose, 1 = tail root
    const x = 1 - t * 2;
    let r = Math.sin(Math.pow(t, 0.62) * Math.PI) * (1 - t * 0.55);
    if (shape === 'round') r = Math.sin(Math.pow(t, 0.75) * Math.PI) * 0.95;
    if (shape === 'box') r = Math.min(1, r * 1.2);
    const ry = Math.max(0.03, r * hk), rz = Math.max(0.025, r * hk * wk);
    // the rear third bends with the swim phase
    const bend = Math.pow(Math.max(0, t - 0.45) / 0.55, 2) * sw * 0.16;
    rings.push({ x, ry, rz, cy: 0, bz: bend });
  }
  const pts = rings.map((r) => {
    const out = [];
    for (let j = 0; j < seg; j++) { const a = (j / seg) * Math.PI * 2; out.push([r.x, Math.cos(a) * r.ry, Math.sin(a) * r.rz + r.bz]); }
    return out;
  });
  const colAt = (i, j) => {
    const up = Math.cos((j + 0.5) / seg * Math.PI * 2); // 1 top .. -1 bottom
    const base = up > 0.45 ? col.back : up < -0.35 ? col.belly : col.body;
    return i === 0 ? shadec(base, 0.05) : base;
  };
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    g.quad(pts[i][j], pts[i + 1][j], pts[i + 1][j2], pts[i][j2], colAt(i, j));
  }
  const nose = [1.06, 0, rings[0].bz];
  for (let j = 0; j < seg; j++) g.tri(nose, pts[0][j], pts[0][(j + 1) % seg], colAt(0, j));
  const tail = rings[N - 1];
  const tr = [tail.x, 0, tail.bz];
  for (let j = 0; j < seg; j++) g.tri(tr, pts[N - 1][(j + 1) % seg], pts[N - 1][j], colAt(N - 2, j));
  // tail fin
  const tt = L.tail?.type || 'fork';
  const tz = tail.bz + sw * 0.22;
  const tl = 0.42 * Math.min(1.3, Math.max(0.7, (L.tail?.len || 14) / ((L.body?.len || 40) * 0.38)));
  const sp_ = 0.42 * hk / 0.55;
  let outline;
  if (tt === 'round' || tt === 'fan') outline = [[-0.98, 0], [-0.98 - tl * 0.6, sp_ * 0.8], [-0.98 - tl, sp_ * 0.4], [-0.98 - tl * 1.05, 0], [-0.98 - tl, -sp_ * 0.4], [-0.98 - tl * 0.6, -sp_ * 0.8]];
  else if (tt === 'truncate') outline = [[-0.98, 0], [-0.98 - tl * 0.8, sp_], [-0.98 - tl * 0.85, -sp_]];
  else if (tt === 'veil' || tt === 'lyre') outline = [[-0.98, 0], [-0.98 - tl * 1.3, sp_ * 1.3], [-0.98 - tl * 0.7, 0], [-0.98 - tl * 1.3, -sp_ * 1.3]];
  else if (tt === 'none') outline = null;
  else outline = [[-0.98, 0], [-0.98 - tl, sp_ * 1.05], [-0.98 - tl * 0.6, 0], [-0.98 - tl, -sp_ * 1.05]];
  if (outline) g.fan(outline.map(([x, y], k) => [x, y, k === 0 ? tail.bz : tz]), col.fin);
  // dorsal
  if (L.dorsal && L.dorsal.type !== 'none') {
    const dh = Math.min(0.5, (L.dorsal.h || 8) / (L.body?.len || 40) * 2.2);
    const x0 = 1 - (L.dorsal.from ?? 0.3) * 2, x1 = 1 - (L.dorsal.to ?? 0.65) * 2;
    const top = (x) => { const t = (1 - x) / 2; return Math.sin(Math.pow(t, 0.62) * Math.PI) * (1 - t * 0.55) * hk * 0.95; };
    g.fan([[x0, top(x0), 0], [x0 - (x0 - x1) * 0.25, top(x0) + dh, 0], [x1, top(x1) + dh * 0.4, 0], [x1, top(x1), 0]], mixc(col.fin, col.back, 0.3));
  }
  // anal / belly fin
  g.fan([[-0.35, -hk * 0.55, 0], [-0.55, -hk * 0.55 - 0.16, 0], [-0.7, -hk * 0.35, 0]], col.fin);
  // pectorals (angled out)
  for (const s of [1, -1]) {
    const pz = s * hk * wk * 0.8;
    g.tri([0.42, -hk * 0.25, pz], [0.12, -hk * 0.42, pz + s * 0.2], [0.18, -hk * 0.12, pz + s * 0.12], col.fin);
    g.tri([0.42, -hk * 0.25, pz], [0.18, -hk * 0.12, pz + s * 0.12], [0.12, -hk * 0.42, pz + s * 0.2], col.fin);
  }
  // eyes: small glossy dark discs with a white glint
  for (const s of [1, -1]) {
    g.push(); g.at(0.68, hk * 0.22, s * hk * wk * 0.72);
    g.sphere(0.075, 0, '#141a26', { smooth: true });
    g.at(0.035, 0.035, s * 0.04);
    g.sphere(0.025, 0, '#ffffff', { smooth: true });
    g.pop();
  }
}

function crab(g, col, sw) {
  g.push(); g.scale(1, 0.45, 0.75);
  g.sphere(0.5, 1, col.body, { cut: -0.2 });
  g.pop();
  for (const s of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const x = 0.25 - k * 0.25, ph = sw * (k % 2 ? 1 : -1) * 0.08;
      g.tube([[x, 0.02, s * 0.3], [x + 0.05 + ph, 0.12, s * 0.55], [x + 0.08 + ph, -0.18, s * 0.7]], 0.04, 4, shadec(col.body, -0.2));
    }
    g.tube([[0.35, 0.05, s * 0.25], [0.62, 0.12, s * 0.42], [0.8, 0.1, s * 0.3]], 0.06, 5, col.back);
    g.push(); g.at(0.85, 0.12, s * 0.3); g.sphere(0.11, 0, col.fin); g.pop();
    g.push(); g.at(0.42, 0.28, s * 0.12); g.sphere(0.06, 0, '#141a26', { smooth: true }); g.pop();
  }
}

function jelly(g, col, phase) {
  const p = 1 + Math.sin(phase * Math.PI * 2) * 0.12;
  g.lathe([[0.02, -0.05], [0.4 * p, 0], [0.48 * p, 0.18], [0.38, 0.38], [0.2, 0.5], [0.01, 0.53]], 10, (i) => (i < 2 ? col.belly : col.body));
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2, r = 0.3 * p;
    const pts = [];
    for (let s = 0; s < 5; s++) pts.push([Math.cos(a) * r * (1 - s * 0.08) + Math.sin(phase * 6.28 + s + k) * 0.04, -0.05 - s * 0.16, Math.sin(a) * r * (1 - s * 0.08)]);
    g.tube(pts, 0.018, 3, col.fin);
  }
  g.rotZ(-Math.PI / 2);
}

function ray(g, col, sw) {
  const f = sw * 0.12;
  const top = col.back, bot = col.belly;
  const P = { n: [0.7, 0, 0], l: [0, f, 0.75], r: [0, f, -0.75], t: [-0.55, 0, 0], c: [0.05, 0.12, 0], cb: [0.05, -0.06, 0] };
  g.tri(P.n, P.l, P.c, top); g.tri(P.l, P.t, P.c, top); g.tri(P.t, P.r, P.c, top); g.tri(P.r, P.n, P.c, top);
  g.tri(P.n, P.cb, P.l, bot); g.tri(P.l, P.cb, P.t, bot); g.tri(P.t, P.cb, P.r, bot); g.tri(P.r, P.cb, P.n, bot);
  g.tube([[-0.5, 0, 0], [-0.8, 0.02, sw * 0.05], [-1.1, 0.03, sw * 0.12]], [0.03, 0.02, 0.005], 4, col.fin);
  for (const s of [1, -1]) { g.push(); g.at(0.35, 0.1, s * 0.12); g.sphere(0.04, 0, '#141a26'); g.pop(); }
}

function eel(g, col, phase) {
  const pts = [], rs = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([1 - t * 2, 0, Math.sin(phase * Math.PI * 2 - t * 5) * 0.12 * t]);
    rs.push(0.09 * Math.sin(Math.min(1, t * 1.4 + 0.2) * Math.PI * 0.95) + 0.01);
  }
  g.tube(pts, rs, 7, (i) => (i % 3 === 0 ? col.back : col.body));
  for (const s of [1, -1]) { g.push(); g.at(0.86, 0.04, s * 0.06); g.sphere(0.03, 0, '#141a26'); g.pop(); }
  g.fan([[0.6, 0.08, 0], [-0.9, 0.06, pts[9][2]], [-0.9, 0.14, pts[9][2]], [0.3, 0.16, 0]], col.fin);
}

function blob(g, col, phase) {
  const p = 1 + Math.sin(phase * Math.PI * 2) * 0.06;
  g.push(); g.scale(1, 0.8 * p, 0.85);
  g.sphere(0.5, 1, (i, a) => (a[1] < -0.2 ? col.belly : col.body), { smooth: true });
  g.pop();
  for (const s of [1, -1]) { g.push(); g.at(0.4, 0.12, s * 0.16); g.sphere(0.07, 0, '#141a26', { smooth: true }); g.pop(); }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    g.tube([[0, -0.3, 0], [Math.cos(a) * 0.3 - 0.2, -0.45, Math.sin(a) * 0.3], [Math.cos(a) * 0.45 - 0.45 + Math.sin(phase * 6.28 + k) * 0.05, -0.4, Math.sin(a) * 0.45]], 0.05, 4, col.fin);
  }
}
