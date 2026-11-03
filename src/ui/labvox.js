// The Lab's VOXEL scenery (OWNER: Lab agent). Everything in the lab interior is a front-facing voxel model rendered
// with src/gfx/voxel.js and cached: the tiled walls, the floor, the window frame and the eco world outside it
// (curved green hill, glass city in a water bubble, green glass globe, sun, white arcs, clouds, a pond), glass pipes,
// flasks, the bench, a shelf, a clock, a potted plant, glossy leaf sprigs and the boat-dock sea. Only effects
// (sun rays, bubbles, glints) are drawn in 2D on top by the panel.
//   voxBudget(ms)                      per-frame build budget (big pieces still build whole once started)
//   voxPiece(key, build, force) -> {canvas, glow, project(x,y,z)} | null while waiting for budget
//   pieces: roomChunk(h, o) + floorChunk(depthPx) (56 px columns, tiled), windowFrame(w, h), windowView(w, h), bench(w), flask(size, level, color), pipe(h, len),
//           shelf(w), clock(), plant(), sprig(len, angleDeg, seed), seaScene(w, h)
//   drawPiece(ctx, piece, x, y, ax, ay, az) draws so that model point (ax, ay, az) lands on screen (x, y)
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { hash2, hash3, clamp } from '../core/math.js';
import { mix, shade } from '../core/color.js';

export const VS = 2, PITCH = 12;
const COS = Math.cos((PITCH * Math.PI) / 180);

const cache = new Map();
let budget = 8, t0 = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export function voxBudget(ms = 8) { budget = ms; t0 = now(); }
export function voxReady(key) { return cache.has(key); }

export function voxPiece(key, build, force = false) {
  const c = cache.get(key);
  if (c) return c;
  if (!force && now() - t0 > budget) return null;
  let r = null;
  try { r = build(); } catch (e) { console.error('lab voxel piece', key, e); r = { canvas: null, project: () => [0, 0] }; }
  cache.set(key, r);
  if (cache.size > 160) cache.delete(cache.keys().next().value);
  return r;
}

const render = (m, o = {}) => renderVoxels(m, { scale: o.scale ?? VS, yaw: 0, pitch: o.pitch ?? PITCH, outline: o.outline ?? true, groundAO: false, depthLines: o.depthLines ?? true, glowRadius: o.glowRadius });

export function drawPiece(ctx, p, x, y, ax = 0, ay = 0, az = 0) {
  if (!p?.canvas) return false;
  const [px, py] = p.project(ax, ay, az);
  const dx = Math.round(x - px), dy = Math.round(y - py);
  if (p.glow) {
    const g = ctx.globalCompositeOperation, a = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.55;
    ctx.drawImage(p.glow, dx, dy);
    ctx.globalCompositeOperation = g; ctx.globalAlpha = a;
  }
  ctx.drawImage(p.canvas, dx, dy);
  return true;
}

const vx = (px) => Math.max(1, Math.round(px / VS));
const vy = (px) => Math.max(1, Math.round(px / (VS * COS)));

// ---------------------------------------------------------------- the room: tiled walls, aqua wainscot, floor
// Built as one 56 px wide column (wall panels, tiles, rail, floor) that the panel repeats across the room.
// o: {tileY: px from the top where the wainscot starts, floorY: px where the floor starts}
export const ROOM_CHUNK = 56;
export function roomChunk(h, o) {
  return voxPiece(`roomc|${h}|${o.tileY}|${o.floorY}`, () => {
    const nx = ROOM_CHUNK / VS, ny = vy(o.floorY), tileV = ny - vy(o.tileY);
    const m = new VoxelModel(nx, ny + 1, 5);
    const wall = m.color('#f6fcff', { jitter: 0.03 }), wall2 = m.color('#e8f7fd', { jitter: 0.03 }), groove = m.color('#b8e2f2', {});
    const tileA = m.color('#8fe0fa', { jitter: 0.04, spec: 1.1, specPow: 10 }), tileB = m.color('#b8efff', { jitter: 0.04, spec: 1.1, specPow: 10 }), grout = m.color('#f2fcff', {});
    const rail = m.color('#ffffff', { spec: 1.4, specPow: 14 }), railB = m.color('#4fb8e4', {});
    const cornice = m.color('#5ccaf4', { spec: 1.2 }), corniceL = m.color('#c8f4ff', {}), base = m.color('#7cc8ea', {});
    for (let y = tileV; y <= ny; y++) for (let x = 0; x < nx; x++) {
      const gx = x === 0, gy = (ny - y) % 22 === 0;
      const c = gx || gy ? groove : Math.floor((ny - y) / 22) % 2 ? wall : wall2;
      m.set(x, y, 0, c);
      if (!gx && !gy) m.set(x, y, 1, c);
    }
    for (let x = 0; x < nx; x++) for (let k = 0; k < 3; k++) { m.set(x, ny - k, 2, k === 0 ? corniceL : cornice); m.set(x, ny - k, 1, cornice); }
    for (let y = 0; y < tileV; y++) for (let x = 0; x < nx; x++) {
      const gx = x % 7 === 0, gy = y % 5 === 0;
      m.set(x, y, 0, grout); m.set(x, y, 1, grout);
      if (!gx && !gy) m.set(x, y, 2, (Math.floor(x / 7) + Math.floor(y / 5)) % 2 ? tileA : tileB);
    }
    for (let x = 0; x < nx; x++) { for (let z = 0; z < 5; z++) m.set(x, tileV, z, z >= 3 ? rail : railB); m.set(x, tileV + 1, 0, rail); m.set(x, 0, 1, base); m.set(x, 0, 2, base); }
    const r = render(m, { outline: false, depthLines: false });
    r.ny = ny;
    return r;
  });
}
export function floorChunk(depthPx) {
  return voxPiece(`floorc|${depthPx}`, () => {
    const nx = ROOM_CHUNK / VS, nz = Math.max(4, Math.round(depthPx / (VS * Math.sin((40 * Math.PI) / 180))));
    const m = new VoxelModel(nx, 2, nz);
    const a = m.color('#e4f8ff', { jitter: 0.03, spec: 1.3, specPow: 12 }), b = m.color('#bce8f8', { jitter: 0.03, spec: 1.3, specPow: 12 }), edge = m.color('#7cc8ea', {});
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { m.set(x, 1, z, (Math.floor(x / 7) + Math.floor(z / 4)) % 2 ? a : b); m.set(x, 0, z, edge); }
    return renderVoxels(m, { scale: VS, yaw: 0, pitch: 40, outline: false, groundAO: false, depthLines: false });
  });
}

// ---------------------------------------------------------------- window frame (white, rounded, with sill + mullion)
export function windowFrame(w, h) {
  return voxPiece(`wframe|${w}|${h}`, () => {
    const nx = vx(w) + 6, ny = vy(h) + 6;
    const m = new VoxelModel(nx, ny + 4, 9);
    const white = m.color('#ffffff', { spec: 1.3, specPow: 12, jitter: 0.02 }), lip = m.color('#7fd0f0', {}), sill = m.color('#f2fbff', { spec: 1.2 });
    const R = 5;
    const inRound = (x, y, x0, y0, x1, y1, r) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    };
    for (let y = 4; y < ny + 4; y++) for (let x = 0; x < nx; x++) {
      const outer = inRound(x, y, 0, 4, nx - 1, ny + 3, R + 2), inner = inRound(x, y, 3, 7, nx - 4, ny, R);
      if (outer && !inner) { for (let z = 0; z < 4; z++) m.set(x, y, z, z === 3 && inRound(x, y, 2, 6, nx - 3, ny + 1, R + 1) ? lip : white); }
    }
    // mullion
    const mx = Math.floor(nx / 2);
    for (let y = 7; y <= ny; y++) for (let z = 1; z < 3; z++) { m.set(mx, y, z, white); m.set(mx + 1, y, z, white); }
    // sill
    for (let x = -2; x < nx + 2; x++) for (let z = 0; z < 9; z++) for (let y = 2; y < 5; y++) m.set(x, y, z, y === 4 ? sill : white);
    const r = render(m, { outline: true });
    r.inner = { x0: 3, y1: ny }; // model coords of the glass opening's top-left
    return r;
  });
}

// ---------------------------------------------------------------- the eco world outside the window (8.jpg)
export function windowView(w, h) {
  return voxPiece(`wview|${w}|${h}`, () => {
    const nx = vx(w), ny = vy(h), nz = 16;
    const m = new VoxelModel(nx, ny, nz);
    const sky = ['#0f5fd8', '#2f8ff0', '#5cb8fa', '#9fdcff', '#d4f2ff'].map((c) => m.color(c, { jitter: 0.02, light: 0.3 }));
    const sun = m.color('#ffffff', { emissive: 1 }), sunR = m.color('#fff4b0', { emissive: 0.7 }), arc = m.color('#dff4ff', { light: 0.6 });
    const cloud = m.color('#ffffff', { jitter: 0.04, smooth: 0.8 }), cloudS = m.color('#d8eefc', {});
    const grass = m.color('#5cc832', { jitter: 0.08, smooth: 0.5 }), grassL = m.color('#9be85a', { jitter: 0.06 }), grassD = m.color('#3aa52a', { jitter: 0.06 }), rim = m.color('#d8ff8a', { emissive: 0.2 });
    const path = m.color('#e4f8b0', {}), trunk = m.color('#8a5a30', {}), leaf = m.color('#4fc032', { jitter: 0.1 }), leafL = m.color('#8fe04a', { jitter: 0.08 });
    const tower = [m.color('#5a8ab8', { spec: 1.2 }), m.color('#8fc4ea', { spec: 1.2 }), m.color('#3a6a9a', { spec: 1.1 })], winL = m.color('#e8fbff', { emissive: 0.5 });
    const bubble = m.color('#e8fbff', { emissive: 0.35 }), bubbleD = m.color('#9fe0f8', {});
    const globe = m.color('#4cc832', { spec: 1.6, specPow: 16, smooth: 1 }), globeL = m.color('#b8f87a', { spec: 1.6, specPow: 16, smooth: 1 }), land = m.color('#effff0', { spec: 1.4, smooth: 1 }), mer = m.color('#dfffd0', { smooth: 1 });
    const water = m.color('#38c0f0', { spec: 1.4, specPow: 14, jitter: 0.03 }), foam = m.color('#ffffff', { emissive: 0.2 }), drop = m.color('#c8f6ff', { emissive: 0.3 });
    // sky (back slab) in soft bands
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y / ny + (hash2(x, y, 3) - 0.5) * 0.05;
      const i = k > 0.82 ? 0 : k > 0.62 ? 1 : k > 0.44 ? 2 : k > 0.28 ? 3 : 4;
      m.set(x, y, 0, sky[i]);
    }
    // white arcs
    const ax = nx * 0.64, ay = -ny * 0.15;
    for (let i = 0; i < 3; i++) {
      const rx = nx * (0.55 + i * 0.1), ry = ny * (0.9 + i * 0.1);
      for (let a = Math.PI * 0.6; a < Math.PI * 0.95; a += 0.004) m.set(ax + Math.cos(a) * rx, ay + Math.sin(a) * ry, 0, arc);
    }
    // sun
    const sx = nx * 0.36, sy = ny * 0.62;
    m.cylinder(sx, sy, 1, 2, 7.5, sunR, 'z'); m.cylinder(sx, sy, 2, 3, 5.5, sun, 'z');
    // clouds
    const puff = (x, y, s) => { for (let i = 0; i < 5; i++) m.ellipsoid(x + (i - 2) * s * 0.7, y - Math.abs(i - 2) * s * 0.18, 3, s * (0.75 - Math.abs(i - 2) * 0.12), s * 0.45, 1.6, cloud); m.ellipsoid(x, y - s * 0.3, 2, s * 1.6, s * 0.2, 1, cloudS); };
    puff(nx * 0.12, ny * 0.85, ny * 0.07); puff(nx * 0.88, ny * 0.88, ny * 0.06); puff(nx * 0.6, ny * 0.78, ny * 0.04);
    // curved hill (a little planet)
    const R = nx * 1.5, hcx = nx * 0.32, hcy = ny * 0.36 - R;
    const hillTop = (x) => hcy + Math.sqrt(Math.max(0, R * R - (x - hcx) ** 2));
    for (let x = 0; x < nx; x++) {
      const top = Math.floor(hillTop(x));
      for (let y = 0; y <= Math.min(ny - 1, top); y++) {
        const d = top - y;
        const c = d === 0 ? rim : d < 2 ? grassL : y < ny * 0.12 ? grassD : (hash2(x, y, 9) < 0.08 ? grassL : grass);
        for (let z = 5; z < 9; z++) m.set(x, y, z, c);
        if (d === 0 && hash2(x, 1, 5) < 0.3) m.set(x, y + 1, 6 + Math.floor(hash2(x, 2, 6) * 3), grassL);
      }
    }
    for (let y = 0; y < ny * 0.3; y++) { const px = nx * 0.27 + Math.sin(y * 0.15) * 3 - (ny * 0.3 - y) * 0.15; m.set(px, y, 9, path); m.set(px + 1, y, 9, path); }
    // tree on the horizon
    const tx = nx * 0.53, ty = hillTop(tx);
    m.line(tx, ty, 7, tx, ty + ny * 0.08, 7, trunk, 0.8);
    m.ellipsoid(tx, ty + ny * 0.12, 7, ny * 0.06, ny * 0.06, 2.5, leaf); m.ellipsoid(tx - ny * 0.04, ty + ny * 0.1, 8, ny * 0.045, ny * 0.045, 2, leafL); m.ellipsoid(tx + ny * 0.04, ty + ny * 0.1, 8, ny * 0.045, ny * 0.045, 2, leaf);
    // glass city in a water bubble
    const bx = nx * 0.15, by = hillTop(nx * 0.15) + ny * 0.1, br = ny * 0.2;
    const heights = [0.6, 1.0, 0.75, 1.25, 0.85, 1.05, 0.6];
    heights.forEach((hh, i) => {
      const x0 = Math.round(bx - br * 0.78 + i * br * 0.24), tw = Math.max(2, Math.round(br * 0.18)), th = Math.round(br * hh);
      const y0 = Math.round(by - br * 0.55);
      const c = tower[i % 3];
      for (let y = y0; y < y0 + th; y++) for (let x = x0; x < x0 + tw; x++) {
        if ((x - bx) ** 2 + (y - by) ** 2 > (br - 1) ** 2) continue;
        for (let z = 9; z < 11; z++) m.set(x, y, z, (y - y0) % 3 === 1 && x > x0 && x < x0 + tw - 1 && z === 10 ? winL : c);
      }
    });
    for (let a = 0; a < Math.PI * 2; a += 0.01) {
      const x = bx + Math.cos(a) * br, y = by + Math.sin(a) * br;
      const lit = Math.sin(a) > -0.2 && Math.cos(a) < 0.5;
      m.set(x, y, 13, lit ? bubble : bubbleD);
      if (lit && Math.sin(a + 0.6) > 0.7) m.set(x + Math.cos(a) * -1.2, y + Math.sin(a) * -1.2, 14, bubble);
    }
    for (let i = 0; i < 10; i++) { const a = Math.PI * (1.1 + hash2(i, 0, 4) * 0.8), d = br * (1.1 + hash2(i, 1, 4) * 0.3); m.set(bx + Math.cos(a) * d, by + Math.sin(a) * d, 14, drop); }
    // green glass globe with a splash
    const gx = nx * 0.8, gy = ny * 0.48, gr = ny * 0.26;
    m.ellipsoid(gx, gy, 9, gr, gr, 5, (x, y, z) => {
      const dx = (x + 0.5 - gx) / gr, dy = (y + 0.5 - gy) / gr;
      const lon = Math.asin(clamp(dx / Math.max(0.2, Math.sqrt(1 - dy * dy)), -1, 1)), lat = Math.asin(clamp(dy, -1, 1));
      const f = Math.sin(lon * 3 + 1.3) * Math.cos(lat * 2.2) + 0.55 * Math.sin(lon * 5 - lat * 3 + 0.4);
      if (Math.abs(lat) < 0.03 || Math.abs(lon) < 0.03) return mer;
      if (f > 0.55) return land;
      return dy > 0.3 && dx < 0.15 ? globeL : globe;
    });
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * (-0.1 + hash2(i, 3, 8) * 0.8), d = gr * (1.05 + hash2(i, 4, 8) * 0.45);
      m.set(gx + Math.cos(a) * d * 0.9, gy - Math.abs(Math.sin(a)) * d * 0.9, 14, i % 3 ? drop : foam);
    }
    // pond at the bottom right
    for (let x = Math.floor(nx * 0.4); x < nx; x++) {
      const top = Math.floor(ny * 0.1 + Math.sin((x / nx) * 3.2) * 2 + (x / nx) * 3);
      for (let y = 0; y <= top; y++) for (let z = 11; z < 16; z++) m.set(x, y, z, y === top ? foam : water);
    }
    const r = render(m, { outline: false, glowRadius: 4 });
    r.sun = [sx, sy, 3]; r.nx = nx; r.ny = ny;
    return r;
  });
}

// ---------------------------------------------------------------- the lab bench
export function bench(w) {
  return voxPiece(`bench|${w}`, () => {
    const nx = vx(w), ny = 26, nz = 14;
    const m = new VoxelModel(nx + 4, ny, nz);
    const white = m.color('#f8fdff', { spec: 1.3, specPow: 12, jitter: 0.02 }), whiteS = m.color('#d8eef8', {}), top = m.color('#38c0f0', { spec: 1.6, specPow: 16 }), topL = m.color('#bff2ff', { spec: 1.5 });
    const stripe = m.color('#7ee85a', { emissive: 0.25 }), handle = m.color('#9fc8dc', { spec: 1.4 }), panel = m.color('#e4f6fc', {});
    const ledG = m.color('#5fd23a', { emissive: 1 }), ledY = m.color('#ffd23a', { emissive: 1 }), ledB = m.color('#35c8ff', { emissive: 1 });
    // body
    m.box(2, 0, 0, nx + 1, ny - 4, nz - 3, white);
    m.box(2, 0, nz - 3, nx + 1, 1, nz - 3, whiteS);
    // worktop (overhangs)
    m.box(0, ny - 3, 0, nx + 3, ny - 1, nz - 1, top);
    m.box(0, ny - 1, 0, nx + 3, ny - 1, nz - 1, topL);
    // green stripe and drawers
    m.box(3, ny - 7, nz - 2, nx, ny - 6, nz - 2, stripe);
    for (const k of [0.22, 0.78]) { const hx = Math.round(nx * k); m.box(hx - 4, ny - 13, nz - 2, hx + 4, ny - 12, nz - 2, handle); }
    // control panel with lights
    const cx = Math.round(nx / 2);
    m.box(cx - 9, ny - 18, nz - 2, cx + 9, ny - 10, nz - 2, panel);
    m.set(cx - 6, ny - 14, nz - 1, ledG); m.set(cx - 3, ny - 14, nz - 1, ledY); m.set(cx, ny - 14, nz - 1, ledB);
    m.box(cx + 3, ny - 16, nz - 1, cx + 7, ny - 12, nz - 1, ledB);
    const r = render(m, { glowRadius: 2 });
    r.top = ny; r.front = nz;
    return r;
  });
}

// ---------------------------------------------------------------- flask (Erlenmeyer), open-fronted so the liquid shows
// size: 'sm' | 'md' | 'lg'; level 0..1 (quantised to 8 steps); color: liquid hex
export function flask(size, level, color) {
  const L = Math.round(clamp(level, 0, 1) * 8);
  return voxPiece(`flask|${size}|${L}|${color}`, () => {
    const D = size === 'lg' ? 1.8 : size === 'sm' ? 0.8 : 1;
    const H = Math.round(16 * D), B = Math.round(7 * D), N = Math.max(2, Math.round(2.2 * D)), NH = Math.round(5 * D);
    const S = B * 2 + 4;
    const m = new VoxelModel(S, H + 3, S);
    const glass = m.color('#e8fbff', { spec: 1.6, specPow: 18, light: 0.4 }), glassE = m.color('#9fdcf4', { spec: 1.2 }), rim = m.color('#ffffff', { spec: 1.6 });
    const liq = m.color(color, { spec: 1.4, specPow: 14, jitter: 0.03, emissive: 0.15 }), liqT = m.color(mix(color, '#ffffff', 0.45), { emissive: 0.3 });
    const c = S / 2;
    const rAt = (y) => (y >= H - NH ? N : N + (B - N) * Math.min(1, (H - NH - y) / (H - NH - 2)));
    const lv = Math.round((H - NH - 1) * (L / 8));
    for (let y = 0; y < H; y++) {
      const r = rAt(y);
      for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - c, z + 0.5 - c);
        if (d > r) continue;
        const shell = d > r - 1.2 || y === 0;
        const front = z + 0.5 > c + 0.5; // open front half of the glass
        if (shell && (!front || y === 0)) m.set(x, y, z, d > r - 0.6 ? glassE : glass);
        else if (!shell && y > 0 && y <= lv) m.set(x, y, z, y === lv ? liqT : liq);
      }
    }
    // rim + front glass edge ring (so the silhouette reads as a flask)
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      m.set(c + Math.cos(a) * (N + 0.4), H, c + Math.sin(a) * (N + 0.4), rim);
      m.set(c + Math.cos(a) * (N + 0.4), H + 1, c + Math.sin(a) * (N + 0.4), rim);
    }
    for (let y = 1; y < H - NH; y += 1) { const r = rAt(y); for (const s of [-1, 1]) m.set(c + s * (r - 0.5), y, c + 0.5, glassE); }
    const r = render(m, { pitch: 16, glowRadius: 1 });
    r.h = H; r.c = c;
    return r;
  });
}

// ---------------------------------------------------------------- glass pipe: up the wall then along the ceiling
export function pipe(h, len) {
  return voxPiece(`pipe|${h}|${len}`, () => {
    const ny = vy(h), nx = vx(len) + 6;
    const m = new VoxelModel(nx, ny, 7);
    const glass = m.color('#e8fbff', { spec: 1.6, specPow: 18, light: 0.4 }), water = m.color('#38c8f8', { emissive: 0.25, spec: 1.3 }), clampC = m.color('#9fc8dc', { spec: 1.4 });
    const cx = 3;
    for (let y = 0; y < ny - 3; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) {
      const d = Math.hypot(x + 0.5 - cx - 0.5, z + 0.5 - 3.5);
      if (d > 3.2) continue;
      if (d > 2.2) { if (z <= 3) m.set(x, y, z, glass); } else m.set(x, y, z, water);
    }
    for (let x = 0; x < nx; x++) for (let y = ny - 7; y < ny; y++) for (let z = 0; z < 7; z++) {
      const d = Math.hypot(y + 0.5 - (ny - 3.5), z + 0.5 - 3.5);
      if (d > 3.2 || (x < 7 && y < ny - 3)) continue;
      if (d > 2.2) { if (z <= 3) m.set(x, y, z, glass); } else m.set(x, y, z, water);
    }
    for (let y = 6; y < ny - 8; y += 24) m.box(0, y, 0, 6, y + 1, 6, clampC);
    const r = render(m, { glowRadius: 2 });
    r.ny = ny;
    return r;
  });
}

// ---------------------------------------------------------------- a white wall shelf with little flasks
export function shelf(w) {
  return voxPiece(`shelf|${w}`, () => {
    const nx = vx(w);
    const m = new VoxelModel(nx, 16, 8);
    const board = m.color('#ffffff', { spec: 1.3, specPow: 12 }), edge = m.color('#7fc4e4', {}), glass = m.color('#e8fbff', { spec: 1.6, light: 0.4 });
    m.box(0, 0, 0, nx - 1, 1, 7, board); m.box(0, 0, 7, nx - 1, 0, 7, edge);
    const cols = ['#ff74b4', '#ffd23a', '#6fd23f', '#35c8ff', '#a98aff'];
    const n = Math.max(3, Math.floor(nx / 16));
    for (let i = 0; i < n; i++) {
      const x = Math.round(6 + (i * (nx - 12)) / Math.max(1, n - 1)), liq = m.color(cols[i % cols.length], { emissive: 0.2, spec: 1.3 });
      const hgt = 7 + (i % 3) * 2;
      for (let y = 2; y < 2 + hgt; y++) {
        const r = y > hgt - 1 ? 1 : Math.min(3, 1 + (hgt - y) * 0.5);
        for (let z = 1; z < 7; z++) for (let xx = x - 4; xx <= x + 4; xx++) {
          const d = Math.hypot(xx + 0.5 - x, z + 0.5 - 4);
          if (d > r) continue;
          if (d > r - 1 && z <= 4) m.set(xx, y, z, glass);
          else if (d <= r - 1 && y < 2 + hgt * 0.6) m.set(xx, y, z, liq);
        }
      }
    }
    return render(m, { pitch: 18 });
  });
}

// ---------------------------------------------------------------- wall clock (hands at a cheerful 10:10)
export function clock() {
  return voxPiece('clock', () => {
    const m = new VoxelModel(17, 17, 4);
    const face = m.color('#ffffff', { spec: 1.4 }), rim = m.color('#35b4e8', { spec: 1.5 }), hand = m.color('#0c3a52', {}), tick = m.color('#9fc8dc', {}), pin = m.color('#ff74b4', {});
    m.cylinder(8.5, 8.5, 0, 1, 8.4, rim, 'z'); m.cylinder(8.5, 8.5, 1, 2, 7, face, 'z');
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; m.set(8.5 + Math.cos(a) * 5.8, 8.5 + Math.sin(a) * 5.8, 3, tick); }
    m.line(8.5, 8.5, 3, 5, 10.5, 3, hand); m.line(8.5, 8.5, 3, 12.5, 11.5, 3, hand); m.set(8, 8, 3, pin);
    return render(m, { pitch: 8 });
  });
}

// ---------------------------------------------------------------- potted plant (glossy white pot, leafy)
export function plant() {
  return voxPiece('plant', () => {
    const m = new VoxelModel(30, 40, 20);
    const pot = m.color('#ffffff', { spec: 1.5, specPow: 14 }), potB = m.color('#38c0f0', { spec: 1.4 }), soil = m.color('#7a5432', {});
    const lf = [m.color('#5cc832', { spec: 1.5, specPow: 14, jitter: 0.06 }), m.color('#9be85a', { spec: 1.5, specPow: 14 }), m.color('#3aa52a', { spec: 1.3 })];
    m.cone(15, 10, 0, 10, 5, 7, pot); m.cylinder(15, 10, 9, 10, 7.4, potB); m.cylinder(15, 10, 10, 10, 6, soil);
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i / 8 - 0.5) * 2.4, len = 12 + (i % 3) * 4;
      const ex = 15 + Math.cos(a + Math.PI / 2) * len * 0.8, ey = 11 + Math.abs(Math.sin(a + Math.PI / 2)) * len + 4, ez = 10 + ((i * 5) % 7) - 3;
      m.line(15, 11, 10, ex, ey, ez, lf[2], 0.6);
      m.ellipsoid(ex, ey, ez, 3.2, 2, 1.6, lf[i % 2]);
    }
    return render(m, { pitch: 14 });
  });
}

// ---------------------------------------------------------------- glossy leaf sprigs (frame the panel)
// angle: growth direction in screen degrees (0 = right, 90 = down); the stem starts at model point (2, 2+..)
export function sprig(len, angle, seed = 1) {
  return voxPiece(`sprig|${len}|${angle}|${seed}`, () => {
    const L = Math.round(len / VS);
    const S = L * 2 + 8;
    const m = new VoxelModel(S, S, 10);
    const stem = m.color('#3f8a22', {}), mid = m.color('#e4ffb0', { spec: 1.2 });
    const tones = [m.color('#7edc34', { spec: 1.8, specPow: 18, smooth: 0.8, jitter: 0.04 }), m.color('#b8f25a', { spec: 1.8, specPow: 18, smooth: 0.8 }), m.color('#3fae2a', { spec: 1.5, specPow: 14, smooth: 0.8 })];
    const a = (-angle * Math.PI) / 180; // model y is up
    const ox = S / 2, oy = S / 2;
    const P = (k) => { const bend = Math.sin(k * Math.PI) * 0.35; const aa = a + bend * (seed % 2 ? 1 : -1); return [ox + Math.cos(aa) * L * k, oy + Math.sin(aa) * L * k]; };
    for (let i = 0; i < 24; i++) { const [x0, y0] = P(i / 24), [x1, y1] = P((i + 1) / 24); m.line(x0, y0, 4, x1, y1, 4, stem, 0.7); }
    const leafAt = (k, side, size) => {
      const [x, y] = P(k), [x2, y2] = P(Math.min(1, k + 0.02));
      const da = Math.atan2(y2 - y, x2 - x) + side * (0.7 + ((seed * 7 + k * 13) % 1) * 0.3);
      const ll = size, lw = size * 0.38;
      const ux = Math.cos(da), uy = Math.sin(da);
      for (let u = 0; u <= ll; u += 0.5) for (let v = -lw; v <= lw; v += 0.5) {
        const half = lw * Math.pow(Math.sin(Math.PI * Math.min(1, u / ll)), 0.75);
        if (Math.abs(v) > half) continue;
        const px = x + ux * u - uy * v, py = y + uy * u + ux * v;
        const zc = 4 + Math.round((1 - (v / lw) ** 2) * 2);
        const tone = Math.abs(v) < 0.6 && u < ll * 0.9 ? mid : v * side > 0 ? tones[1] : Math.abs(v) > half - 0.8 ? tones[2] : tones[0];
        for (let z = zc - 1; z <= zc; z++) m.set(px, py, z, tone);
      }
    };
    for (let i = 0; i < 6; i++) { const k = 0.16 + i * 0.14; leafAt(k, i % 2 ? 1 : -1, L * (0.34 - k * 0.14)); }
    leafAt(1, 0, L * 0.26);
    const r = render(m, { pitch: 18 });
    r.anchor = [ox, oy, 4];
    return r;
  });
}

// ---------------------------------------------------------------- the boat dock: sea, hill, sky (Boats tab)
export function seaScene(w, h) {
  return voxPiece(`sea|${w}|${h}`, () => {
    const s = 4, P = 45, cp = Math.cos((P * Math.PI) / 180), sp = Math.sin((P * Math.PI) / 180);
    const nx = Math.max(1, Math.round(w / s)) + 1, skyV = Math.round((h * 0.46) / (s * cp)), nz = Math.round((h * 0.56) / (s * sp)) + 2;
    const horizon = 2, ny = horizon + skyV;
    const m = new VoxelModel(nx, ny, nz);
    const sky = ['#0f5fd8', '#2f8ff0', '#5cb8fa', '#9fdcff', '#d4f2ff'].map((c) => m.color(c, { jitter: 0.02, light: 0.3 }));
    const sun = m.color('#ffffff', { emissive: 1 }), sunR = m.color('#fff4b0', { emissive: 0.7 });
    const cloud = m.color('#ffffff', { jitter: 0.04, smooth: 0.8 });
    const grass = m.color('#5cc832', { jitter: 0.08 }), rim = m.color('#d8ff8a', {}), sand = m.color('#f6e2a8', { jitter: 0.05 }), palm = m.color('#3aa52a', {});
    const sea = m.color('#2fb8ee', { spec: 1.6, specPow: 14, jitter: 0.03 }), seaD = m.color('#1f8ad8', { spec: 1.4, jitter: 0.03 }), seaL = m.color('#7fdcff', { spec: 1.6 }), foam = m.color('#ffffff', { emissive: 0.15 });
    for (let y = horizon; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = (y - horizon) / (ny - horizon) + (hash2(x, y, 3) - 0.5) * 0.06;
      m.set(x, y, 0, sky[k > 0.8 ? 0 : k > 0.55 ? 1 : k > 0.33 ? 2 : k > 0.15 ? 3 : 4]);
    }
    m.cylinder(nx * 0.2, horizon + skyV * 0.72, 1, 2, 6, sunR, 'z'); m.cylinder(nx * 0.2, horizon + skyV * 0.72, 2, 3, 4.4, sun, 'z');
    for (const [cx, cy, cs] of [[0.55, 0.8, 5], [0.82, 0.62, 4], [0.36, 0.5, 3.4]]) for (let i = 0; i < 4; i++) m.ellipsoid(nx * cx + (i - 1.5) * cs, horizon + skyV * cy - Math.abs(i - 1.5) * 1, 3, cs * 0.8, cs * 0.42, 1.5, cloud);
    // an island on the horizon
    for (let x = 0; x < nx; x++) {
      const d = (x - nx * 0.8) / (nx * 0.26);
      if (Math.abs(d) > 1) continue;
      const top = horizon + Math.round((1 - d * d) * skyV * 0.16);
      for (let y = horizon - 1; y <= top; y++) for (let z = 2; z < 6; z++) m.set(x, y, z, y === top ? rim : y <= horizon ? sand : grass);
    }
    m.line(nx * 0.76, horizon + skyV * 0.15, 4, nx * 0.78, horizon + skyV * 0.3, 4, sand, 0.5);
    m.ellipsoid(nx * 0.78, horizon + skyV * 0.31, 4, 4, 1.2, 2, palm);
    // the sea: a flat slab toward the viewer, deeper blue up close, sparse foam crests
    for (let z = 3; z < nz; z++) for (let x = 0; x < nx; x++) {
      const crest = z % 3 === 0 && hash2(x >> 2, z, 4) < 0.04 && (x & 3) < 3;
      const shine = hash2(x, z >> 1, 6) < 0.03;
      m.set(x, horizon - 1, z, crest ? foam : shine ? seaL : z > nz * 0.55 ? seaD : sea);
      if (crest) m.set(x, horizon, z, foam);
    }
    const r = renderVoxels(m, { scale: s, yaw: 0, pitch: P, outline: false, groundAO: false, depthLines: false, glowRadius: 3 });
    r.horizon = horizon; r.nz = nz; r.nx = nx; r.ny = ny; r.sun = [nx * 0.2, horizon + skyV * 0.72, 2];
    return r;
  });
}

void shade;
