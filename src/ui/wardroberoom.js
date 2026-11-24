// [wardrobe26] The Wardrobe's backdrop: a cosy VOXEL BOUTIQUE on a dock (OWNER: Wardrobe). Everything solid is a real
// voxel model rendered with src/gfx/voxel.js (black ink outline, AO, ramps), seen straight on from slightly above:
//   back wall: white panelled wainscot, chair rail, striped aqua wallpaper with little raised drops, crown moulding,
//     two brass portholes (the sea, a bare sandy island, drifting voxel clouds and a sailboat show through), a life ring,
//     string lights draped along the top (emissive bulbs that twinkle);
//   floor: honey wood planks with grooves, an oval Aero rug under the stage;
//   props: a shelving wardrobe cabinet (hat boxes, folded stacks, drawers), a cheval full-length mirror (glints sweep
//     across it), a hat stand with three hats and a scarf, a wall clothes rail with six tiny outfits on hangers (they
//     sway), a shoe bench with pairs of shoes, a tufted pouf, glossy potted plants (no trees);
//   the stage: a white-and-aqua turntable with a ring of bulbs; it turns with the character (12 cached frames).
// Soft light only: warm pools on the rug, bulb glows, a gentle vignette, drifting dust motes. No light rays, no rings.
//
// The scene is built once per stage size and device resolution (the full-res UI layer renders it at 2x) by a step
// generator (~7 ms a frame; pieces appear as they finish) into three canvases (wall+floor, back props, front props) plus
// animated sprites (garment sway frames, turntable frames, window-view sprites). A frame is a handful of drawImage calls.
//   const R = drawWardrobeRoom(ctx, v, t, {spin})   v = stage rect (logical), spin = character yaw in degrees
//     -> {feet: [x, y] (turntable top centre, logical), u (logical px per voxel), ready, front(ctx)}  call R.front(ctx)
//        after drawing the character to put the front props, motes and the vignette on top.
//   wardrobeRoomPending() -> true while a scene is still building (for tests / warmers)
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { rgba } from '../core/color.js';
import { hash1, hash2, TAU } from '../core/math.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const BUDGET = 7;
const RW = 440; // room width in voxels
const PITCH = 28, SP = Math.sin((PITCH * Math.PI) / 180), CP = Math.cos((PITCH * Math.PI) / 180);
const TX = 136; // turntable centre x (the panel keeps its UI column right of it)
const R_OPT = { yaw: 0, pitch: PITCH, outline: true, edges: 0.55, sideEdges: 0.35, ao: 1.15, jitter: 0.05, depthLines: true, glowRadius: 4 };
const BULBS = ['#ffe27a', '#ff9ad0', '#7affff', '#b4f06a', '#ffb05a'];

// ------------------------------------------------------------------ geometry
function geom(wd, hd) {
  const s = wd / RW, Hv = hd / s;
  const FD = Math.round((Hv * 0.32) / SP);
  const WH = Math.ceil((Hv - FD * SP) / CP) + 2;
  return { s, Hv, FD, WH, offY: WH * CP * s, TZ: Math.round(FD * 0.46), wd, hd };
}
const sx = (G, X) => X * G.s;
const sy = (G, Y, Z) => (Z * SP - Y * CP) * G.s + G.offY;

// upper half of an ellipsoid (y >= cy)
function dome(m, cx, cy, cz, rx, ry, rz, c) {
  for (let y = Math.floor(cy); y <= Math.ceil(cy + ry); y++) for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
    if (dx * dx + dy * dy + dz * dz <= 1) m.put(x, y, z, c);
  }
}
function render(m, G, o = {}) { return renderVoxels(m, { ...R_OPT, scale: G.s, ...o }); }

// draw a rendered piece whose local origin sits at world (X0, Y0, Z0) into a layer canvas (device px)
function place(g, r, G, X0, Y0, Z0, crop) {
  const [px, py] = r.project(0, 0, 0);
  const dx = Math.round(sx(G, X0) - px), dy = Math.round(sy(G, Y0, Z0) - py);
  if (crop) {
    const a = Math.round(sx(G, crop[0])), b = Math.round(sx(G, crop[1]));
    const srcX = a - dx;
    g.drawImage(r.canvas, srcX, 0, b - a, r.canvas.height, a, dy, b - a, r.canvas.height);
    if (r.glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55; g.drawImage(r.glow, srcX, 0, b - a, r.canvas.height, a, dy, b - a, r.canvas.height); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
    return;
  }
  g.drawImage(r.canvas, dx, dy);
  if (r.glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55; g.drawImage(r.glow, dx, dy); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
}
function sprite(r) { const [px, py] = r.project(0, 0, 0); return { canvas: r.canvas, glow: r.glow, px, py }; }

// soft contact shadow on the floor (device px)
function shadowOn(g, G, cx, cz, rx, rz, a = 0.28) {
  const x = sx(G, cx), y = sy(G, 0, cz), RX = rx * G.s, RY = Math.max(2, rz * SP * G.s);
  g.save();
  g.translate(x, y); g.scale(1, RY / RX);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, RX);
  gr.addColorStop(0, `rgba(30,36,70,${a})`); gr.addColorStop(0.7, `rgba(30,36,70,${a * 0.6})`); gr.addColorStop(1, 'rgba(30,36,70,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, RX, 0, TAU); g.fill();
  g.restore();
}

// ------------------------------------------------------------------ room shell (wall + floor), built in strips
const PORTS = [{ x: TX, y: 126, r: 26 }, { x: 352, y: 126, r: 22 }];
const LIFE = { x: 232, y: 138, R: 11, r: 3.4 };

function roomPal(m) {
  const P = {};
  P.fa = m.color('#dca46a', { jitter: 0.35 }); P.fb = m.color('#cf9258', { jitter: 0.35 }); P.fc = m.color('#e6b47c', { jitter: 0.35 });
  P.fd = m.color('#a86a3c', { jitter: 0.2 });
  P.rw = m.color('#fbfdff', { jitter: 0.15 }); P.ra = m.color('#3cc0e0', { jitter: 0.2 }); P.rd = m.color('#1f86c0', { jitter: 0.2 });
  P.rl = m.color('#9be84a', { jitter: 0.2 }); P.rc = m.color('#bff0fa', { jitter: 0.2 });
  P.sk = m.color('#e4ece8'); P.wn = m.color('#f6f7f1', { jitter: 0.08 }); P.wf = m.color('#ffffff');
  P.cr = m.color('#ffffff'); P.pa = m.color('#a6e0ea', { jitter: 0.1 }); P.pb = m.color('#cdf2f4', { jitter: 0.1 }); P.pd = m.color('#ffffff');
  P.br = m.color('#f2b640', { spec: 0.7 }); P.bd = m.color('#b8782a', { spec: 0.4 });
  P.wi = m.color('#3a3650'); P.bulbs = BULBS.map((c) => m.color(c, { emissive: 1 }));
  P.lr = m.color('#ff5a4e'); P.lw = m.color('#fbfbf6'); P.rope = m.color('#e8d2a0');
  return P;
}

function lights(G) {
  // catenary string lights along the top of the wall: wire y(X) and bulbs
  const top = G.WH - 16, span = 74, sag = 13, bulbs = [];
  const wire = (X) => { const k = ((X - 6) % span + span) % span / span; return top - sag * 4 * k * (1 - k); };
  let i = 0;
  for (let X = 11; X < RW - 4; X += 9) { const k = ((X - 6) % span) / span; if (k < 0.06 || k > 0.94) continue; bulbs.push({ x: X, y: Math.round(wire(X)) - 3, c: i++ % BULBS.length }); }
  const byX = new Map();
  for (const b of bulbs) for (let d = -1; d <= 1; d++) byX.set(b.x + d, b);
  return { wire, bulbs, byX, top, span };
}

function floorVox(G, P, X, Y, Z) {
  const row = Math.floor(Z / 8), off = Math.floor(hash1(row, 3) * 56);
  const groove = Z % 8 === 0 || (X + off) % 56 === 0;
  if (Y === -1 && groove) return 0;
  if (Y < -1) return P.fd;
  const h = hash2(row, Math.floor((X + off) / 56), 5);
  return h < 0.34 ? P.fa : h < 0.67 ? P.fb : P.fc;
}

function rugVox(G, P, X, Z) {
  const u = (X + 0.5 - TX) / 80, v = (Z + 0.5 - G.TZ) / (G.FD * 0.3);
  const d = Math.hypot(u, v);
  if (d > 1) return 0;
  if (d > 0.93) return P.rw;
  if (d > 0.87) return P.rd;
  if (d > 0.84) return P.rw;
  const a = Math.atan2(v, u);
  if (d > 0.66 && d < 0.78) return Math.abs(Math.sin(a * 9)) > 0.55 ? P.rl : P.ra;
  if (d < 0.22) return d < 0.12 ? P.rw : P.rc;
  return Math.abs(d - 0.45 - 0.05 * Math.sin(a * 7)) < 0.04 ? P.rw : P.ra;
}

function wallVox(G, P, L, X, Y, Z) {
  const WH = G.WH;
  for (const p of PORTS) {
    const dx = X + 0.5 - p.x, dy = Y + 0.5 - p.y;
    if (dx > p.r + 6 || dx < -p.r - 6 || dy > p.r + 6 || dy < -p.r - 6) continue;
    const d = Math.hypot(dx, dy);
    if (d < p.r) return 0;
    if (d < p.r + 5.5) {
      const k = (d - p.r) / 5.5, zt = 6 + Math.round(4 * Math.sin(Math.PI * Math.min(1, k * 1.1)));
      if (Z > zt) return 0;
      if (k < 0.18) return P.bd;
      const a = Math.atan2(dy, dx), b = Math.round(a / (TAU / 10)) * (TAU / 10);
      if (Z >= zt - 1 && k > 0.35 && k < 0.75 && Math.abs(a - b) * d < 1.2) return P.bd;
      return P.br;
    }
  }
  if (Math.abs(X + 0.5 - LIFE.x) < 16 && Math.abs(Y + 0.5 - LIFE.y) < 16) { // life ring
    const dx = X + 0.5 - LIFE.x, dy = Y + 0.5 - LIFE.y, rr = Math.hypot(dx, dy);
    const q = Math.hypot(rr - LIFE.R, Z + 0.5 - 9);
    if (q < LIFE.r) { const a = Math.atan2(dy, dx) + TAU; return Math.floor(a / (TAU / 8)) % 2 ? P.lw : P.lr; }
    if (Z === 8 && rr > LIFE.R - 1 && rr < LIFE.R + 1 && Math.abs(Math.atan2(dy, dx) - Math.PI / 4) % (Math.PI / 2) < 0.12) return P.rope;
  }
  // string lights
  if (Z >= 8 && Z <= 10) {
    const b = L.byX.get(X);
    if (b && Y >= b.y - 2 && Y <= b.y + 1) {
      if (Y === b.y + 1) return Z === 9 && X === b.x ? P.wi : 0;
      if ((X - b.x) ** 2 + ((Y - b.y + 0.5) / 1.6) ** 2 <= 1.6) return P.bulbs[b.c];
    }
    if (Z === 9 && Y === Math.round(L.wire(X))) return P.wi;
    if (Z <= 9 && Y >= L.top - 1 && Y <= L.top && ((X - 6) % L.span + L.span) % L.span === 0) return P.br;
  }
  if (Y >= WH - 11) { // crown moulding
    const k = Y - (WH - 11), zt = k < 3 ? 6 : k < 6 ? 7 : k < 9 ? 8 : 9;
    if (Z > zt) return 0;
    if (k >= 4 && k <= 5 && Z === zt && X % 5 >= 3) return 0;
    return P.cr;
  }
  if (Y >= 51) { // wallpaper
    const m = ((X % 18) + 18) % 18;
    if (Z <= 5) return m < 11 ? P.pa : P.pb;
    if (Z === 6 && m === 14) { const yy = Y % 20; if (yy >= 8 && yy <= 10) return P.pd; if (yy === 11) return P.pd; }
    return 0;
  }
  if (Y >= 47) return Z <= (Y === 47 || Y === 50 ? 7 : 8) ? P.cr : 0; // chair rail
  if (Y >= 8) { // wainscot panels
    const px = ((X % 44) + 44) % 44;
    const inP = px >= 5 && px <= 39 && Y >= 13 && Y <= 41;
    const frame = inP && (px <= 6 || px >= 38 || Y <= 14 || Y >= 40);
    if (Z <= 5) return frame ? P.wf : P.wn;
    if (Z === 6 && frame) return P.wf;
    return 0;
  }
  return Z <= (Y === 7 ? 6 : 7) ? P.sk : 0; // skirting
}

function stripModel(G, L, xa, xb, kind) {
  const M0 = 2, nx = xb - xa + M0 * 2;
  if (kind === 'floor') {
    const m = new VoxelModel(nx, 6, G.FD + 1);
    const P = roomPal(m);
    for (let lx = 0; lx < nx; lx++) {
      const X = xa - M0 + lx;
      for (let Z = 0; Z <= G.FD; Z++) {
        for (let Y = -4; Y <= -1; Y++) { const c = floorVox(G, P, X, Y, Z); if (c) m.set(lx, Y + 4, Z, c); }
        const rc = rugVox(G, P, X, Z);
        if (rc) m.set(lx, 4, Z, rc);
      }
    }
    return m;
  }
  const m = new VoxelModel(nx, G.WH + 2, 14);
  const P = roomPal(m);
  for (let lx = 0; lx < nx; lx++) {
    const X = xa - M0 + lx;
    for (let Y = 0; Y <= G.WH; Y++) for (let Z = 0; Z <= 13; Z++) { const c = wallVox(G, P, L, X, Y, Z); if (c) m.set(lx, Y, Z, c); }
  }
  return m;
}

// ------------------------------------------------------------------ props (local origin = floor contact, back-left)
function cabinet() {
  const m = new VoxelModel(68, 148, 32);
  const W = m.color('#f8f5ee', { jitter: 0.1 }), Wd = m.color('#e6ded0'), IN = m.color('#3aaed4', { jitter: 0.12 }), SH = m.color('#fbfaf6');
  const K = m.color('#f2c03a', { spec: 0.8 });
  const C = ['#ff7a6a', '#8be04a', '#ffd23a', '#5aa8f0', '#ff9ad0', '#b48aff', '#2fd3e8', '#ffffff'].map((c) => m.color(c, { jitter: 0.15 }));
  const HB1 = m.color('#ff9ad0'), HB2 = m.color('#ffffff'), HB3 = m.color('#7ad8ff'), RIB = m.color('#ff5a7a');
  // carcass
  m.box(2, 0, 2, 65, 127, 29, W);
  m.sub(() => m.box(6, 42, 4, 61, 123, 29, 1));
  m.box(6, 42, 2, 61, 123, 3, IN);
  m.box(0, 124, 0, 67, 128, 31, Wd); m.box(1, 129, 1, 66, 130, 30, W); // crown
  m.box(3, 0, 3, 64, 3, 27, Wd); // plinth
  for (const y of [72, 98]) m.box(6, y, 4, 61, y + 2, 29, SH);
  m.box(6, 40, 4, 61, 41, 29, SH);
  // drawers
  for (const [y0, y1] of [[5, 21], [23, 39]]) {
    m.box(5, y0, 30, 62, y1, 30, W);
    m.box(7, y0 + 2, 31, 60, y1 - 2, 31, Wd);
    m.sphere(33.5, (y0 + y1) / 2 + 0.5, 31.5, 1.8, K);
  }
  // folded stacks (middle shelf)
  let ci = 0;
  for (const sx0 of [8, 26, 44]) {
    let y = 42;
    const n = 4 + (sx0 === 26 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const c = C[ci++ % C.length];
      m.box(sx0, y, 8, sx0 + 15, y + 4, 26, c);
      m.box(sx0 + 1, y + 5, 9, sx0 + 14, y + 5, 25, c);
      m.paint(() => m.box(sx0, y + 2, 26, sx0 + 15, y + 2, 26, Wd));
      y += 6;
    }
  }
  // hat boxes + a straw hat (upper shelf)
  m.cylinder(18, 16, 75, 88, 9, HB1); m.cylinder(18, 16, 89, 90, 10, HB2);
  m.paint(() => m.fill((x, y, z) => (y >= 76 && y <= 87 && (x - 17.5) ** 2 + (z - 15.5) ** 2 <= 82 && Math.floor((Math.atan2(z - 16, x - 18) + 4) * 3) % 2 === 0 ? HB2 : null)));
  m.box(17, 91, 15, 19, 92, 17, RIB);
  m.cylinder(46, 16, 75, 76, 11, C[2]); m.cylinder(46, 16, 77, 81, 6, C[2]); dome(m, 46, 81, 16, 6, 3.5, 6, C[2]);
  m.cylinder(46, 16, 77, 78, 6.4, RIB);
  // top shelf: rolled scarves
  for (let i = 0; i < 5; i++) m.cylinder(13 + i * 10.5, 20, 101, 108, 4.2, C[(i + 3) % C.length], 'y');
  // on top: two hat boxes
  m.cylinder(20, 15, 131, 141, 10, HB3); m.cylinder(20, 15, 142, 143, 11, HB2);
  m.cylinder(46, 16, 131, 137, 8, HB1); m.cylinder(46, 16, 138, 139, 9, HB2); m.box(45, 140, 15, 47, 141, 17, RIB);
  return m;
}

function mirror() {
  const m = new VoxelModel(36, 118, 16);
  const F = m.color('#ffffff', { jitter: 0.06 }), Fd = m.color('#dfe9f0'), G = m.color('#f2c03a', { spec: 0.8 });
  const glass = ['#f4feff', '#dff6ff', '#c8eefc', '#b0e2f6', '#9ad6f0', '#8acbe8'].map((c) => m.color(c, { spec: 0.6, jitter: 0.04 }));
  const cx = 17.5, cy = 66, rx = 12.5, ry = 44;
  // feet + posts
  for (const x of [3, 32]) {
    m.box(x - 2, 0, 1, x + 1, 2, 14, Fd); m.box(x - 1, 3, 6, x, 4, 9, Fd);
    m.cylinder(x - 0.5, 7.5, 3, 80, 1.6, F);
    m.sphere(x - 0.5, 82, 7.5, 2.4, G);
    m.sphere(x - 0.5, cy, 7.5, 2, G);
  }
  m.box(3, 18, 7, 32, 19, 8, Fd); // stretcher
  for (let y = cy - ry - 3; y <= cy + ry + 3; y++) for (let x = 0; x < 36; x++) {
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, d = Math.hypot(u, v);
    if (d <= 1) { const k = Math.min(5, Math.floor(((y - (cy - ry)) / (2 * ry)) * 6)); m.box(x, y, 7, x, y, 8, glass[5 - k]); }
    else if (d <= 1.2) { m.box(x, y, 6, x, y, 9, d < 1.07 ? G : F); }
  }
  // diagonal bright streak baked into the glass
  const GL = new Set(glass);
  m.paint(() => m.fill((x, y, z, p) => { const t = x * 0.9 + y * 0.35; return GL.has(p) && ((t > 52 && t < 55) || (t > 58 && t < 59.5)) ? glass[0] : null; }));
  m.sphere(cx, cy + ry + 3, 8.5, 2.2, G);
  return { m, glass: { cx, cy, rx, ry, z: 9 } };
}

function hatStand() {
  const m = new VoxelModel(34, 110, 26);
  const Wd = m.color('#8a5232', { jitter: 0.15 }), Wl = m.color('#a8683e'), K = m.color('#f2c03a', { spec: 0.8 });
  const ST = m.color('#f0d38a', { jitter: 0.2 }), BAND = m.color('#ff6a5a'), BE = m.color('#e8503e', { jitter: 0.2 }), BW = m.color('#ffffff');
  const CAP = m.color('#2fb8e8'), CAPd = m.color('#1a7ab8'), SC = m.color('#9be84a', { jitter: 0.1 }), SC2 = m.color('#ffffff');
  const c = 17, z = 13;
  m.line(c - 11, 1, z, c + 11, 1, z, Wd, 1.3); m.line(c, 1, z - 10, c, 1, z + 10, Wd, 1.3);
  m.cylinder(c, z, 0, 4, 3, Wl);
  m.cylinder(c, z, 4, 92, 1.5, Wd);
  for (const y of [30, 60]) m.cylinder(c, z, y, y + 1, 2.4, Wl);
  m.sphere(c, 94, z, 2.6, K);
  // hooks
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, 1]]) { m.line(c, 80, z, c + dx * 6, 85, z + dz * 6, Wl, 0.9); m.sphere(c + dx * 6, 85.5, z + dz * 6, 1.2, K); }
  // straw sun hat on top
  m.cylinder(c, z, 95, 96, 11.5, ST); m.cylinder(c, z, 96, 103, 6.2, ST); m.ellipsoid(c, 103, z, 6.2, 2.6, 6.2, ST);
  m.cylinder(c, z, 97, 99, 6.6, BAND);
  // beanie hanging on the left hook (pom pom)
  m.cylinder(c - 8, z, 75, 79, 4.6, BE); dome(m, c - 8, 79, z, 4.6, 4.2, 4.4, BE); m.cylinder(c - 8, z, 74, 76, 5, BW);
  m.sphere(c - 8, 84.5, z, 2.2, BW);
  // aqua cap on the right hook
  dome(m, c + 8, 78, z, 4.8, 4.4, 4.6, CAP); m.box(c + 5, 78, z + 2, c + 12, 78, z + 8, CAPd); m.sphere(c + 8, 82.6, z, 1, CAPd);
  // scarf draped over the front hook
  m.tube([[c - 3, 84, z + 7, 1.6], [c - 5, 70, z + 8, 1.8], [c - 4, 58, z + 8, 1.8]], SC, 5);
  m.tube([[c + 3, 84, z + 7, 1.6], [c + 4, 74, z + 8, 1.8], [c + 3, 66, z + 8, 1.8]], SC, 5);
  m.paint(() => m.fill((x, y, zz, p) => (p === SC && y % 6 === 0 ? SC2 : null)));
  return m;
}

function rail() {
  const m = new VoxelModel(80, 10, 20);
  const CH = m.color('#dbe6f0', { spec: 0.9 }), BR = m.color('#9aa8bb');
  for (const x of [2, 76]) { m.box(x - 1, 1, 0, x + 1, 7, 2, BR); m.line(x, 4, 1, x, 5, 15, BR, 1.1); }
  m.cylinder(5, 15, 0, 79, 1.4, CH, 'x');
  m.sphere(0.8, 5, 15, 1.8, CH); m.sphere(79, 5, 15, 1.8, CH);
  return m;
}

// six tiny outfits on hangers; base model hook top at (12, 41); sway frames shear around the hook
const OUTFITS = [
  { kind: 'tee', c: '#ffffff', c2: '#2fd3e8' },
  { kind: 'dress', c: '#ff8ac8', c2: '#ffffff' },
  { kind: 'hoodie', c: '#5aa8f0', c2: '#dff4ff' },
  { kind: 'coat', c: '#ffd23a', c2: '#e8922a' },
  { kind: 'sailor', c: '#ffffff', c2: '#1a3a7a' },
  { kind: 'tux', c: '#24345a', c2: '#ffffff' },
];
function garment(o) {
  const m = new VoxelModel(26, 44, 9);
  const H = m.color('#d8e4ee', { spec: 0.9 }), C = m.color(o.c, { jitter: 0.12 }), C2 = m.color(o.c2, { jitter: 0.08 }), R = m.color('#ff4a5a'), A = m.color('#2fd3e8');
  // hook + hanger
  for (const [x, y] of [[12, 41], [13, 41], [14, 40], [14, 39], [13, 38], [12, 37], [12, 36]]) m.set(x, y, 4, H);
  m.line(12, 35, 4, 3, 30, 4, H); m.line(12, 35, 4, 21, 30, 4, H); m.line(3, 30, 4, 21, 30, 4, H);
  const body = (x0, x1, y0, y1, c, zf = 6) => m.box(x0, y0, 2, x1, y1, zf, c);
  if (o.kind === 'dress') {
    for (let y = 4; y <= 29; y++) { const w = 4 + Math.round((29 - y) * 0.27); m.box(12 - w, y, 2, 12 + w, y, y > 20 ? 5 : 6, C); }
    m.box(8, 29, 3, 9, 31, 4, C); m.box(15, 29, 3, 16, 31, 4, C);
    m.box(7, 19, 6, 17, 20, 7, C2);
    m.paint(() => m.fill((x, y, z) => (z >= 5 && y < 18 && (x * 3 + y * 5) % 9 === 0 ? C2 : null)));
  } else if (o.kind === 'coat') {
    body(6, 18, 2, 29, C); body(2, 5, 12, 28, C, 5); body(19, 22, 12, 28, C, 5);
    m.box(10, 24, 7, 14, 30, 7, C2); m.box(12, 3, 7, 12, 22, 7, C2);
    for (const y of [8, 13, 18]) { m.set(10, y, 7, C2); m.set(14, y, 7, C2); }
  } else {
    const long = o.kind === 'hoodie' || o.kind === 'tux';
    body(6, 18, 8, 29, C);
    body(2, 5, long ? 10 : 22, 29, C, 5); body(19, 22, long ? 10 : 22, 29, C, 5);
    m.box(1, long ? 9 : 22, 3, 1, long ? 12 : 23, 5, C); m.box(23, long ? 9 : 22, 3, 23, long ? 12 : 23, 5, C);
    if (o.kind === 'tee') { m.sub(() => m.box(10, 27, 6, 14, 30, 6, 1)); m.ellipsoid(12, 20, 6.5, 2.2, 3, 1, C2); m.set(12, 23, 7, C2); }
    if (o.kind === 'hoodie') { m.ellipsoid(12, 29, 3, 6, 4, 3, C); m.box(8, 10, 7, 16, 14, 7, C2); m.set(10, 22, 7, C2); m.set(14, 22, 7, C2); m.box(10, 18, 7, 10, 21, 7, C2); m.box(14, 18, 7, 14, 21, 7, C2); }
    if (o.kind === 'sailor') {
      m.paint(() => m.fill((x, y, z, p) => (p === C && y % 4 === 0 && y < 24 ? A : null)));
      m.box(6, 25, 6, 18, 29, 7, C2); m.sub(() => m.box(10, 24, 7, 14, 29, 7, 1)); m.box(11, 21, 7, 13, 24, 7, R); m.set(12, 20, 7, R);
    }
    if (o.kind === 'tux') { m.box(10, 14, 7, 14, 29, 7, C2); m.box(10, 26, 8, 14, 27, 8, A); m.set(12, 22, 8, C); m.set(12, 18, 8, C); m.box(6, 8, 6, 9, 9, 6, C); m.box(15, 8, 6, 18, 9, 6, C); }
  }
  return m;
}
const SWAY = [-5, -3.3, -1.6, 0, 1.6, 3.3, 5];
function swayFrame(src, deg) {
  const S = 4, m = new VoxelModel(src.nx + S * 2, src.ny, src.nz);
  m.palette = src.palette.slice();
  const tn = Math.tan((deg * Math.PI) / 180), top = src.ny - 3;
  for (let z = 0; z < src.nz; z++) for (let y = 0; y < src.ny; y++) {
    const dx = Math.round((top - y) * tn);
    for (let x = 0; x < src.nx; x++) { const v = src.get(x, y, z); if (v) m.set(x + S + dx, y, z, v); }
  }
  return m;
}

function shoeBench() {
  const m = new VoxelModel(76, 36, 26);
  const Wd = m.color('#f4efe4', { jitter: 0.08 }), Wk = m.color('#dcd2c0'), CU = m.color('#ff9ad0', { jitter: 0.15 }), CB = m.color('#ffffff');
  const col = (h) => m.color(h, { jitter: 0.12 });
  const SN = col('#ffffff'), SA = col('#2fd3e8'), RB = col('#ff5a4e'), YB = col('#ffd23a'), PS = col('#ffb0d8'), LF = col('#8be04a'), SO = col('#3a3a4a');
  for (const x of [1, 72]) m.box(x, 0, 2, x + 2, 28, 23, Wd);
  m.box(1, 2, 2, 74, 3, 23, Wk); m.box(1, 15, 2, 74, 16, 23, Wd);
  m.box(0, 27, 1, 75, 29, 24, Wd);
  m.box(2, 30, 3, 73, 33, 22, CU);
  for (const x of [14, 30, 46, 62]) m.sphere(x, 34, 12.5, 1, CB);
  const shoe = (x, y, c, c2, boot) => {
    for (const dx of [0, 6]) {
      m.box(x + dx, y, 6, x + dx + 4, y + 1, 18, SO);
      m.box(x + dx, y + 2, 7, x + dx + 4, y + (boot ? 9 : 4), 17, c);
      m.ellipsoid(x + dx + 2.5, y + 2.5, 17, 2.6, 2.4, 2.4, c);
      if (c2) m.box(x + dx, y + 3, 13, x + dx + 4, y + 3, 15, c2);
    }
  };
  shoe(6, 4, SN, SA); shoe(24, 4, RB, null, true); shoe(42, 4, YB, null, true); shoe(59, 4, LF, SN);
  shoe(6, 17, PS, CB); shoe(24, 17, SN, RB); shoe(42, 17, SA, SN); shoe(59, 17, SO, SN);
  return m;
}

function pouf() {
  const m = new VoxelModel(30, 20, 30);
  const P = m.color('#ff7a8a', { jitter: 0.12 }), Pd = m.color('#e8506a'), B = m.color('#ffffff'), S1 = m.color('#9be84a'), S2 = m.color('#5aa8f0');
  m.cylinder(15, 15, 0, 1, 12, Pd); m.cylinder(15, 15, 2, 10, 13, P); m.ellipsoid(15, 10, 15, 13, 3, 13, P);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; m.sphere(15 + Math.cos(a) * 7, 12.5, 15 + Math.sin(a) * 7, 0.9, B); }
  m.sphere(15, 13.2, 15, 1, B);
  m.box(7, 13, 8, 22, 15, 21, S1); m.box(8, 16, 9, 21, 17, 20, S2);
  return m;
}

function plant(seed, size = 1) {
  const m = new VoxelModel(Math.round(56 * size), Math.round(70 * size), Math.round(40 * size));
  const PT = m.color('#fbfdff', { jitter: 0.06 }), PB = m.color('#2fb8e8'), SO = m.color('#5a3a26');
  const G1 = m.color('#4cc23a', { jitter: 0.15, spec: 0.35 }), G2 = m.color('#2f9a2c', { jitter: 0.12, spec: 0.25 }), G3 = m.color('#9be84a', { spec: 0.4 });
  const cx = m.nx / 2, cz = m.nz / 2, pr = 9 * size, ph = 15 * size;
  m.cone(cx, cz, 0, ph, pr * 0.82, pr, PT);
  m.cylinder(cx, cz, ph - 3 * size, ph, pr + 0.8, PT);
  m.paint(() => m.fill((x, y) => (y >= ph * 0.35 && y <= ph * 0.35 + 2 * size ? PB : null)));
  m.cylinder(cx, cz, ph - 1, ph - 0.5, pr - 1, SO);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * 0.92 + (i / (n - 1)) * Math.PI * 0.84 + (hash1(i, seed) - 0.5) * 0.25;
    const dz = (hash1(i, seed + 7) - 0.4) * 0.9;
    const L = (18 + hash1(i, seed + 3) * 12) * size, Wd = L * 0.42;
    const bx = cx + Math.cos(a) * 3, by = ph, bz = cz + dz * 4;
    const ex = cx + Math.cos(a) * L * 0.7, ey = by - Math.sin(a) * L * 0.9 + 4 * size, ez = cz + dz * L * 0.6;
    m.line(bx, by, bz, ex, ey - 2, ez, G2, 0.8);
    // leaf blade: a fat heart-ish ellipse along the direction, with monstera slits
    const ux = Math.cos(a) * 0.6, uy = -Math.sin(a) * 0.9 + 0.25, uz = dz * 0.5, ul = Math.hypot(ux, uy, uz);
    const dx = ux / ul, dy = uy / ul, dz2 = uz / ul;
    const px = -dy, py = dx; // perpendicular in the x-y plane
    for (let u = 0; u <= L * 0.75; u += 0.5) {
      const k = u / (L * 0.75), w = Wd * Math.sin(Math.PI * Math.min(1, k * 1.05)) * (k < 0.15 ? 0.7 + k * 2 : 1);
      for (let v = -w; v <= w; v += 0.5) {
        const slit = Math.abs(v) > w * 0.35 && Math.floor(u / (2.6 * size)) % 2 === 0 && k > 0.2 && k < 0.85;
        if (slit) continue;
        const x = ex + dx * u + px * v, y = ey + dy * u + py * v, z = ez + dz2 * u + Math.abs(v) * 0.15;
        m.put(Math.floor(x), Math.floor(y), Math.floor(z), Math.abs(v) < 0.7 ? G3 : v > 0 ? G1 : G2);
      }
    }
  }
  return m;
}

function turntable(phase) {
  const R = 35, m = new VoxelModel(R * 2 + 2, 10, R * 2 + 2);
  const c = R + 1;
  const SIDE = m.color('#2aa8d8', { jitter: 0.08 }), SD = m.color('#1878b0'), WT = m.color('#ffffff'), TA = m.color('#8fe6fa'), TW = m.color('#fbfeff'), HUB = m.color('#f2c03a', { spec: 0.8 });
  const BL = [m.color('#fff2a0', { emissive: 1 }), m.color('#ff9ad0', { emissive: 1 })];
  for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
    const dx = x + 0.5 - c, dz = z + 0.5 - c, d = Math.hypot(dx, dz);
    if (d > R) continue;
    const a = Math.atan2(dz, dx) + phase;
    m.box(x, 0, z, x, 0, z, SD);
    if (d <= R - 1) {
      // side band with a ring of bulbs
      const bulb = d > R - 2.2 && Math.abs(((a / TAU) * 16 % 1 + 1) % 1 - 0.5) < 0.12;
      for (let y = 1; y <= 5; y++) m.set(x, y, z, bulb && (y === 3 || y === 2) ? BL[Math.floor(((a / TAU) * 16 + 160) % 2)] : y === 5 ? WT : SIDE);
    }
    if (d <= R - 2) {
      const seg = Math.floor((((a / TAU) * 8) % 8 + 8) % 8);
      const col = d < 4.5 ? HUB : d > R - 5 ? TW : seg % 2 ? TA : TW;
      m.set(x, 6, z, col); m.set(x, 7, z, d > R - 3.2 ? TW : col);
      if (d > R - 3.2) m.set(x, 8, z, TW);
    }
  }
  return { m, R, c, top: 8 };
}

// window view sprites (rendered at the scene scale x 0.6: they are far away)
function island() {
  const m = new VoxelModel(60, 12, 14);
  const S = m.color('#f2dc9a', { jitter: 0.2 }), G = m.color('#7ad04a', { jitter: 0.2 }), R = m.color('#b0a08a');
  for (let x = 0; x < 60; x++) for (let z = 0; z < 14; z++) {
    const k = (x - 30) / 30, h = Math.max(0, (1 - k * k) * 9 + Math.sin(x * 0.4) * 0.8 - (z - 7) ** 2 * 0.08);
    for (let y = 0; y < h; y++) m.set(x, y, z, y > h - 2 && h > 4 ? G : y < 2 && Math.abs(k) > 0.7 ? R : S);
  }
  return m;
}
function cloud(seed) {
  const m = new VoxelModel(34, 14, 12);
  const W = m.color('#ffffff', { jitter: 0.05 }), B = m.color('#e2f2ff');
  for (let i = 0; i < 6; i++) m.ellipsoid(6 + i * 4.4 + hash1(i, seed) * 2, 4 + hash1(i, seed + 2) * 4, 6, 4 + hash1(i, seed + 4) * 3, 3.5 + hash1(i, seed + 5) * 2, 4, W);
  m.paint(() => m.fill((x, y) => (y < 3 ? B : null)));
  return m;
}
function sailboat() {
  const m = new VoxelModel(22, 22, 8);
  const H = m.color('#ffffff'), HB = m.color('#2fb8e8'), S = m.color('#fff8ea'), S2 = m.color('#ff7a6a'), MS = m.color('#8a5a3a');
  for (let y = 0; y < 4; y++) m.box(2 + (3 - y), y, 2, 19 - (3 - y) + (y > 1 ? 1 : 0), y, 5, y < 2 ? HB : H);
  m.box(10, 4, 3, 10, 20, 3, MS);
  for (let y = 6; y <= 19; y++) { const w = Math.round((19 - y) * 0.55); m.box(11, y, 3, 11 + w, y, 3, y % 5 === 0 ? S2 : S); }
  for (let y = 8; y <= 16; y++) { const w = Math.round((16 - y) * 0.45); m.box(9 - w, y, 3, 9, y, 3, S); }
  return m;
}

// ------------------------------------------------------------------ scene
const scenes = new Map();
function sceneFor(wd, hd) {
  const key = wd + 'x' + hd;
  let S = scenes.get(key);
  if (!S) {
    const G = geom(wd, hd);
    const mk = () => { const c = makeCanvas(wd, hd); return { c, g: ctxOf(c) }; };
    S = { key, G, L: lights(G), wall: mk(), back: mk(), front: mk(), garments: [], table: [], view: null, mirror: null, done: false, n: 0, born: now(), gen: null };
    S.gen = buildScene(S);
    scenes.set(key, S);
    if (scenes.size > 3) scenes.delete(scenes.keys().next().value);
  }
  return S;
}

function* buildScene(S) {
  const { G, L } = S;
  // window view first (behind the wall)
  const V = { clouds: [], boat: null, island: null };
  V.island = sprite(render(island(), { ...G, s: G.s * 0.55 }, { outline: true, glowRadius: 0 }));
  yield;
  for (let i = 0; i < 2; i++) { V.clouds.push(sprite(render(cloud(i * 11 + 3), { ...G, s: G.s * 0.55 }, { outline: true })) ); yield; }
  V.boat = sprite(render(sailboat(), { ...G, s: G.s * 0.55 }, { outline: true }));
  S.view = V;
  yield;
  // shell strips: the floor first (the wall's base covers its back edge), then the wall
  for (const kind of ['floor', 'wall']) {
    const SW = kind === 'floor' ? 40 : 22;
    for (let xa = 0; xa < RW; xa += SW) {
      const xb = Math.min(RW, xa + SW);
      const m = stripModel(G, L, xa, xb, kind);
      yield;
      place(S.wall.g, render(m, G, kind === 'floor' ? { edges: 0.4, depthLines: false } : {}), G, xa - 2, kind === 'floor' ? -4 : 0, 0, [xa, xb]);
      S.n++;
      yield;
    }
    if (kind === 'floor') { // a soft contact shadow where the floor meets the wall
      const g = S.wall.g, y0 = sy(G, 0, 7), gr = g.createLinearGradient(0, y0 - 2 * G.s, 0, y0 + 10 * G.s);
      gr.addColorStop(0, 'rgba(60,40,40,0.35)'); gr.addColorStop(1, 'rgba(60,40,40,0)');
      g.fillStyle = gr; g.fillRect(0, y0 - 2 * G.s, G.wd, 12 * G.s);
    }
  }
  // clothes rail (behind the garments)
  { const r = render(rail(), G); place(S.wall.g, r, G, 194, 106, 0); yield; }
  // garments: sway frames
  for (let i = 0; i < OUTFITS.length; i++) {
    const src = garment(OUTFITS[i]);
    const frames = [];
    for (const d of SWAY) { frames.push(sprite(render(swayFrame(src, d), G))); yield; }
    S.garments.push({ x: 202 + i * 11.4, y: 111 - 41, z: 11 + (i % 2), frames, ph: hash1(i, 9) * TAU, sp: 0.7 + hash1(i, 4) * 0.5 });
    yield;
  }
  // back props, back to front
  const B = S.back.g;
  { const m = cabinet(); yield; shadowOn(B, G, 36, 22, 40, 22); place(B, render(m, G), G, 2, 0, 6); yield; }
  { const m = shoeBench(); yield; shadowOn(B, G, 232, 16, 44, 16, 0.22); place(B, render(m, G), G, 194, 0, 4); yield; }
  { const r = render(plant(5, 1.1), G); shadowOn(B, G, 306, 46, 16, 9); place(B, r, G, 306 - 31, 0, 46 - 22); yield; }
  { const r = render(pouf(), G); shadowOn(B, G, 392, 60, 17, 10); place(B, r, G, 392 - 15, 0, 60 - 15); yield; }
  { const { m, glass } = mirror(); yield; const X0 = 70, Z0 = Math.round(G.TZ * 0.42);
    shadowOn(B, G, X0 + 17, Z0 + 8, 20, 9, 0.22); place(B, render(m, G), G, X0, 0, Z0);
    S.mirror = { cx: X0 + glass.cx, cy: glass.cy, z: Z0 + glass.z, rx: glass.rx, ry: glass.ry }; yield; }
  { const X0 = 172, Z0 = Math.round(G.TZ * 0.5) - 13; const r = render(hatStand(), G); shadowOn(B, G, X0 + 17, Z0 + 13, 14, 10); place(B, r, G, X0, 0, Z0); yield; }
  { const r = render(pouf(), G); shadowOn(B, G, 40, G.TZ + 8, 17, 10); place(B, r, G, 40 - 15, 0, G.TZ + 8 - 15); yield; }
  { const r = render(plant(17, 0.95), G); const X = 250, Z = Math.round(G.FD * 0.72); shadowOn(B, G, X, Z, 14, 8); place(B, r, G, X - Math.round(56 * 0.95) / 2, 0, Z - Math.round(40 * 0.95) / 2); yield; }
  // front props
  { const r = render(plant(29, 1.35), G); const X = 12, Z = G.FD - 10; shadowOn(S.front.g, G, X, Z, 18, 10); place(S.front.g, r, G, X - Math.round(56 * 1.35) / 2, 0, Z - Math.round(40 * 1.35) / 2); yield; }
  // turntable frames
  for (let f = 0; f < 12; f++) { const T = turntable((f / 12) * (TAU / 8) * 2); S.table.push({ ...sprite(render(T.m, G)), R: T.R, c: T.c, top: T.top }); yield; }
  S.done = true;
}

function stepScene(S) {
  if (S.done || !S.gen) return;
  const t0 = now();
  try {
    while (now() - t0 < BUDGET) {
      const a = now(), r = S.gen.next(), d = now() - a;
      if (d > (S.maxStep || 0)) { S.maxStep = d; S.maxAt = S.steps; }
      if (d > 12) (S.slow ||= []).push((S.steps || 0) + ":" + Math.round(d));
      S.steps = (S.steps || 0) + 1;
      if (r.done) { S.done = true; S.gen = null; S.ms = now() - S.born; break; }
    }
  } catch (e) { console.error(e); S.done = true; S.gen = null; }
}

export function wardrobeRoomStats() { return [...scenes.values()].map((S) => ({ key: S.key, done: S.done, steps: S.steps, maxStep: Math.round(S.maxStep || 0), maxAt: S.maxAt, ms: Math.round(S.ms || 0), slow: (S.slow || []).join(" ") })); }
export function wardrobeRoomPending() { for (const S of scenes.values()) if (!S.done) return true; return false; }

// ------------------------------------------------------------------ per-frame drawing
const glowCache = new Map();
function glowDot(col, r) {
  const key = col + r;
  let c = glowCache.get(key);
  if (!c) {
    c = makeCanvas(r * 2, r * 2);
    const g = ctxOf(c), gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, rgba(col, 0.9)); gr.addColorStop(0.35, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
    glowCache.set(key, c);
  }
  return c;
}
const vigCache = new Map();
function vignette(w, h) {
  const key = w + 'x' + h;
  let c = vigCache.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    const g = ctxOf(c);
    const gr = g.createRadialGradient(w * 0.32, h * 0.62, Math.min(w, h) * 0.25, w * 0.4, h * 0.55, Math.max(w, h) * 0.78);
    gr.addColorStop(0, 'rgba(20,24,60,0)'); gr.addColorStop(1, 'rgba(20,24,60,0.34)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const top = g.createLinearGradient(0, 0, 0, h * 0.25);
    top.addColorStop(0, 'rgba(30,30,70,0.18)'); top.addColorStop(1, 'rgba(30,30,70,0)');
    g.fillStyle = top; g.fillRect(0, 0, w, h * 0.25);
    vigCache.set(key, c);
    if (vigCache.size > 4) vigCache.delete(vigCache.keys().next().value);
  }
  return c;
}

export function drawWardrobeRoom(ctx, v, t, o = {}) {
  const Rz = ctx.__hi || 1;
  const wd = Math.round(v.w * Rz), hd = Math.round(v.h * Rz);
  const S = sceneFor(wd, hd);
  stepScene(S);
  const { G } = S, k = 1 / Rz;
  const ox = v.x, oy = v.y;
  const D = (c, dx, dy, w = c.width, h = c.height) => ctx.drawImage(c, ox + dx * k, oy + dy * k, w * k, h * k);
  ctx.save();
  ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.clip();
  // base tone while the shell builds
  ctx.fillStyle = '#bfe6ee'; ctx.fillRect(v.x, v.y, v.w, v.h * 0.68);
  ctx.fillStyle = '#d8a56c'; ctx.fillRect(v.x, v.y + v.h * 0.68, v.w, v.h * 0.32);
  // window views
  for (const p of PORTS) drawView(ctx, S, p, t, ox, oy, k);
  D(S.wall.c, 0, 0);
  // garments (sway)
  for (const gm of S.garments) {
    const a = Math.sin(t * gm.sp + gm.ph) * 0.5 + Math.sin(t * gm.sp * 2.3 + gm.ph * 2) * 0.15;
    const fi = Math.max(0, Math.min(SWAY.length - 1, Math.round(((a + 0.65) / 1.3) * (SWAY.length - 1))));
    const f = gm.frames[fi];
    const dx = Math.round(sx(G, gm.x - 12 - 4) - f.px), dy = Math.round(sy(G, gm.y, gm.z) - f.py);
    D(f.canvas, dx, dy);
  }
  D(S.back.c, 0, 0);
  // bulb glows (twinkle)
  const gr = Math.max(4, Math.round(G.s * 5));
  ctx.globalCompositeOperation = 'lighter';
  S.L.bulbs.forEach((b, i) => {
    const tw = 0.45 + 0.35 * Math.sin(t * (1.3 + (i % 5) * 0.37) + i * 1.7) + (Math.sin(t * 0.7 + i) > 0.96 ? 0.4 : 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, tw));
    const c = glowDot(BULBS[b.c], gr);
    D(c, sx(G, b.x + 0.5) - gr, sy(G, b.y, 9) - gr);
  });
  // warm light pool on the rug around the stage
  ctx.globalAlpha = 0.5 + 0.06 * Math.sin(t * 0.8);
  { const c = glowDot('#fff2c8', 64); const rx = 92 * G.s, ry = G.FD * 0.3 * SP * G.s * 1.4; D(c, sx(G, TX) - rx, sy(G, 0, G.TZ) - ry, rx * 2, ry * 2); }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // mirror glints
  if (S.mirror) drawMirrorGlint(ctx, S, t, ox, oy, k);
  // turntable
  const spin = (o.spin || 0) * (Math.PI / 180);
  const feet = [ox + sx(G, TX) * k, oy + sy(G, 9, G.TZ) * k];
  if (S.table.length) {
    const per = TAU / 4; // the pattern repeats every 90 degrees
    const fi = Math.floor((((-spin % per) + per) % per) / per * 12) % S.table.length;
    const f = S.table[fi];
    const dx = Math.round(sx(G, TX - f.c) - f.px), dy = Math.round(sy(G, 0, G.TZ - f.c) - f.py);
    D(f.canvas, dx, dy);
    if (f.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; D(f.glow, dx, dy); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  }
  ctx.restore();
  const front = (c2 = ctx) => {
    c2.save();
    c2.beginPath(); c2.rect(v.x, v.y, v.w, v.h); c2.clip();
    c2.drawImage(S.front.c, ox, oy, S.front.c.width * k, S.front.c.height * k);
    // dust motes drifting in the warm light
    c2.fillStyle = '#fff6d8';
    for (let i = 0; i < 16; i++) {
      const ph = (t * (0.02 + hash1(i, 3) * 0.02) + hash1(i, 5)) % 1;
      const x = ox + (0.08 + hash1(i, 7) * 0.55) * v.w + Math.sin(t * 0.5 + i) * 6;
      const y = oy + v.h * (0.85 - ph * 0.7);
      c2.globalAlpha = Math.sin(ph * Math.PI) * (0.35 + 0.35 * Math.sin(t * 2 + i * 3));
      c2.fillRect(Math.round(x * Rz) / Rz, Math.round(y * Rz) / Rz, k, k);
    }
    c2.globalAlpha = 1;
    c2.drawImage(vignette(Math.round(v.w), Math.round(v.h)), ox, oy, v.w, v.h);
    c2.restore();
  };
  return { feet, u: G.s * k, ready: S.done, front, mirror: S.mirror };
}

function drawView(ctx, S, p, t, ox, oy, k) {
  const { G } = S, V = S.view;
  const cx = ox + sx(G, p.x) * k, cy = oy + sy(G, p.y, 6) * k;
  const rx = (p.r + 1.5) * G.s * k, ry = (p.r + 1.5) * G.s * k * CP + 4 * k;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.clip();
  const hz = cy + ry * 0.18;
  const sky = ctx.createLinearGradient(0, cy - ry, 0, hz);
  sky.addColorStop(0, '#3aa6ec'); sky.addColorStop(0.7, '#8fd8ff'); sky.addColorStop(1, '#d8f6ff');
  ctx.fillStyle = sky; ctx.fillRect(cx - rx, cy - ry, rx * 2, hz - (cy - ry));
  const sea = ctx.createLinearGradient(0, hz, 0, cy + ry);
  sea.addColorStop(0, '#2fb8e8'); sea.addColorStop(1, '#1670c0');
  ctx.fillStyle = sea; ctx.fillRect(cx - rx, hz, rx * 2, cy + ry - hz);
  if (V) {
    const vk = k;
    const isl = V.island;
    const ix = cx + (p.x > 200 ? rx * 0.3 : -rx * 0.25) - isl.canvas.width * vk * 0.5;
    ctx.drawImage(isl.canvas, Math.round(ix / k) * k, Math.round((hz - isl.canvas.height * vk + 3 * k) / k) * k, isl.canvas.width * vk, isl.canvas.height * vk);
    V.clouds.forEach((c, i) => {
      const cw = c.canvas.width * vk, span = rx * 2 + cw;
      const x = cx - rx - cw + ((t * (2.5 + i * 1.4) + i * 47 + p.x * 0.7) % span);
      ctx.drawImage(c.canvas, Math.round(x / k) * k, cy - ry * (0.66 - i * 0.3), cw, c.canvas.height * vk);
    });
    // a sailboat crosses now and then
    const per = 34, ph = ((t + p.x * 0.1) % per) / per;
    if (ph < 0.6) {
      const b = V.boat, bw = b.canvas.width * vk, x = cx - rx - bw + (ph / 0.6) * (rx * 2 + bw);
      const bob = Math.round(Math.sin(t * 2.2) * 1) * k;
      ctx.drawImage(b.canvas, Math.round(x / k) * k, hz - b.canvas.height * vk + 3 * k + bob, bw, b.canvas.height * vk);
    }
  }
  // sea glitter and wave dashes (pixel effects)
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 14; i++) {
    const yy = hz + 3 * k + (i % 5) * (ry * 0.16);
    const xx = cx - rx + ((hash1(i, 2) * rx * 2 + t * (4 + (i % 3) * 2)) % (rx * 2));
    if (Math.sin(t * 3 + i * 1.9) > 0.2) ctx.fillRect(Math.round(xx / k) * k, Math.round(yy / k) * k, (2 + (i % 3)) * k, k);
  }
  // glass sheen: two soft diagonal streaks (static)
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.moveTo(cx - rx * 0.7, cy - ry * 0.2); ctx.lineTo(cx - rx * 0.2, cy - ry); ctx.lineTo(cx, cy - ry); ctx.lineTo(cx - rx * 0.6, cy + ry * 0.05); ctx.fill();
  ctx.restore();
}

function drawMirrorGlint(ctx, S, t, ox, oy, k) {
  const { G } = S, M = S.mirror;
  const cx = ox + sx(G, M.cx) * k, cy = oy + sy(G, M.cy, M.z) * k;
  const rx = M.rx * G.s * k * 0.94, ry = M.ry * G.s * k * CP * 0.97;
  const ph = (t % 5.5) / 5.5;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.clip();
  if (ph < 0.32) {
    const q = ph / 0.32, y = cy + ry * 1.3 - q * ry * 2.8;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.beginPath(); ctx.moveTo(cx - rx, y + rx * 0.9); ctx.lineTo(cx + rx, y - rx * 0.5); ctx.lineTo(cx + rx, y - rx * 0.5 + 5 * G.s * k); ctx.lineTo(cx - rx, y + rx * 0.9 + 5 * G.s * k); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.moveTo(cx - rx, y + rx * 0.9 + 8 * G.s * k); ctx.lineTo(cx + rx, y - rx * 0.5 + 8 * G.s * k); ctx.lineTo(cx + rx, y - rx * 0.5 + 9.5 * G.s * k); ctx.lineTo(cx - rx, y + rx * 0.9 + 9.5 * G.s * k); ctx.fill();
  }
  ctx.restore();
  // a star glint on the frame now and then (4-point sparkle in pixels)
  const sp = (t % 3.7) / 3.7;
  if (sp < 0.22) {
    const a = Math.sin((sp / 0.22) * Math.PI), x = Math.round((cx - rx * 0.55) / k) * k, y = Math.round((cy - ry * 0.62) / k) * k, n = Math.round(1 + a * 3);
    ctx.fillStyle = `rgba(255,255,255,${0.6 + a * 0.4})`;
    ctx.fillRect(x - n * k, y, (n * 2 + 1) * k, k); ctx.fillRect(x, y - n * k, k, (n * 2 + 1) * k);
  }
}

