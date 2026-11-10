// Plants with physics (phase 6, Oceans agent): kelp, seagrass, meadow grass, flowers, fronds, sea whips, glowing
// stalks and hanging roots, each a chain of segments with angular springs. They sway in the current, bend away
// when fish, the hook, the line or the boat push through them, and spring back.
//
//   const field = new PlantField();
//   field.add({kind, x, y, z, s, cols, head, layer, seed, ...})    base point (x, y) in world px, z = depth (0 near)
//   field.update(dt, {t, view, pushers, lines, flow, dx, dy})      pushers [{x, y, r, vx, vy, k, z}], lines [[x0,y0,x1,y1]]
//   field.draw(ctx, layer, {dx, dy, view})                          low-poly faceted ribbons under the world camera
//   field.drawGlows(ctx, {dx, dy, view, a})                         emissive tips (after the darkness pass)
//   field.active                                                    segments simulated last frame (perf readout)
//
// Physics: joint i carries a bend angle a[i] (relative to the segment below) with a spring toward its rest curl and
// damping. Node forces (buoyancy or weight, the current, pushers) become joint torques  sum_j>i cross(p_j - p_i, F_j)
// over the joint's moment of inertia  sum_j>i |p_j - p_i|^2, so long kelp is lazy and short grass is snappy. Only
// plants near the camera view are simulated (the rest keep their last pose); budget ~300+ active segments.
// Drawing (phase 7): crisp voxel segments on the world voxel grid (see draw()): lit / shaded facet voxels, bright top
// faces, dark undersides, flecks and a 1 px selective outline, colour-batched into a handful of Path2D fills per frame.

import { clamp, clamp01, lerp, TAU, hash2 } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { mix, shade } from '../core/color.js';

// n segments, segment length, width at base / tip, joint stiffness (1/s^2), damping, buoyancy (px/s^2 per node,
// negative = hangs), current pickup, rest curl spread
export const PLANT_KINDS = {
  grass: { n: [4, 5], len: [3, 4.6], w: [2, 0.25], stiff: 90, damp: 7, buoy: 260, flow: 1, curl: 0.09 },
  seagrass: { n: [5, 6], len: [4, 5.6], w: [2.4, 0.4], stiff: 55, damp: 5, buoy: 220, flow: 1.3, curl: 0.07, twist: true },
  kelp: { n: [10, 14], len: [7, 9.5], w: [3.6, 2.2], stiff: 22, damp: 2.6, buoy: 150, flow: 1.8, curl: 0.035, twist: true, bulbs: true, leaves: true },
  frond: { n: [6, 8], len: [4, 5.4], w: [1.3, 0.5], stiff: 48, damp: 5, buoy: 200, flow: 1.2, curl: 0.06, leaflets: true },
  flower: { n: [5, 7], len: [3.2, 4.2], w: [1.1, 0.8], stiff: 70, damp: 6, buoy: 260, flow: 0.9, curl: 0.05 },
  whip: { n: [8, 11], len: [5, 7], w: [1.6, 0.35], stiff: 34, damp: 3.6, buoy: 170, flow: 1.4, curl: 0.03 },
  glow: { n: [5, 8], len: [4, 5.6], w: [1.3, 0.55], stiff: 40, damp: 4, buoy: 190, flow: 1.1, curl: 0.05 },
  fan: { n: [4, 5], len: [3, 4], w: [1.6, 0.6], stiff: 60, damp: 6, buoy: 220, flow: 0.8, curl: 0.12, leaflets: true },
  root: { n: [5, 9], len: [3.4, 5], w: [1.4, 0.35], stiff: 16, damp: 2.8, buoy: -170, flow: 1.4, curl: 0.05, leaflets: 'sparse' },
};

const LIGHT = [-0.6, -0.8];

export class PlantField {
  constructor(seed = 1) {
    this.list = [];
    this.rng = new RNG(seed);
    this.active = 0;
    this.paths = new Map();
    this.rims = new Map();
  }

  add(o) {
    const K = PLANT_KINDS[o.kind] || PLANT_KINDS.seagrass;
    const r = o.rng || this.rng;
    const s = o.s ?? 1;
    const n = o.n ?? r.int(K.n[0], K.n[1]);
    const sizeK = (o.size ?? 1) * s;
    const p = {
      kind: o.kind, K, x: o.x, y: o.y, z: o.z ?? 0, s, n, layer: o.layer || 'front',
      base: o.base ?? (K.buoy < 0 ? Math.PI : 0) + r.float(-0.12, 0.12),
      len: new Float32Array(n), w: new Float32Array(n + 1), a: new Float32Array(n), v: new Float32Array(n), rest: new Float32Array(n),
      px: new Float32Array(n + 1), py: new Float32Array(n + 1), fx: new Float32Array(n + 1), fy: new Float32Array(n + 1),
      cols: o.cols, head: o.head || null, glow: o.glow || null, ph: r.float(0, TAU), stiff: K.stiff * (o.stiff ?? 1) * r.float(0.85, 1.15),
      buoy: K.buoy * (o.buoy ?? 1), flowK: K.flow * (o.flow ?? 1), x0: 0, y0: 0, x1: 0, y1: 0, sleep: 0, twist: K.twist ? r.int(0, 3) : -1,
      leafSeed: r.int(0, 9999), hidden: false,
    };
    const curl = (o.curl ?? K.curl) * (r.chance(0.5) ? 1 : -1);
    const [w0, w1] = o.w || K.w;
    for (let i = 0; i < n; i++) {
      const u = i / Math.max(1, n - 1);
      p.len[i] = lerp(K.len[0], K.len[1], r.next()) * sizeK * (o.kind === 'kelp' ? 1 - u * 0.25 : 1);
      p.rest[i] = curl * (0.4 + u) + r.float(-0.03, 0.03);
      p.a[i] = p.rest[i];
    }
    for (let j = 0; j <= n; j++) {
      const u = j / n;
      let w = lerp(w0, w1, u);
      if (o.kind === 'kelp') w = lerp(w0, w1, u) * (0.75 + Math.sin(u * Math.PI) * 0.45);
      if (j === n && !p.head && o.kind !== 'kelp') w = 0;
      p.w[j] = w * sizeK;
    }
    this.fk(p);
    this.list.push(p);
    return p;
  }

  // forward kinematics: node positions + bounding box
  fk(p) {
    let ang = p.base, x = p.x, y = p.y;
    p.px[0] = x; p.py[0] = y;
    let x0 = x, x1 = x, y0 = y, y1 = y;
    for (let i = 0; i < p.n; i++) {
      ang += p.a[i];
      x += Math.sin(ang) * p.len[i];
      y -= Math.cos(ang) * p.len[i];
      p.px[i + 1] = x; p.py[i + 1] = y;
      if (x < x0) x0 = x; else if (x > x1) x1 = x;
      if (y < y0) y0 = y; else if (y > y1) y1 = y;
    }
    const m = (p.w[0] + 4) * 1.5;
    p.x0 = x0 - m; p.x1 = x1 + m; p.y0 = y0 - m; p.y1 = y1 + m;
  }

  // o: {t, view, pushers, lines, flow (global drift), dx, dy (parallax offset of the plants' layer)}
  update(dt, o = {}) {
    dt = Math.min(0.05, Math.max(0, dt));
    if (dt <= 0) return;
    const v = o.view, t = o.t || 0, pad = 40;
    const pushers = o.pushers || [], lines = o.lines || [];
    const drift = o.flow || 0;
    let active = 0;
    const ns = dt > 0.022 ? 2 : 1, h = dt / ns;
    for (const p of this.list) {
      if (p.hidden) continue;
      if (v && (p.x1 + (o.dx || 0) < v.x0 - pad || p.x0 + (o.dx || 0) > v.x1 + pad || p.y1 + (o.dy || 0) < v.y0 - pad || p.y0 + (o.dy || 0) > v.y1 + pad)) continue;
      active += p.n;
      const ox = o.dx || 0, oy = o.dy || 0;
      // who is close enough to matter this frame
      let near = null;
      for (const q of pushers) {
        if (q.z !== undefined && Math.abs(q.z - p.z) > 0.32) continue;
        const qx = q.x - ox, qy = q.y - oy;
        if (qx + q.r < p.x0 || qx - q.r > p.x1 || qy + q.r < p.y0 || qy - q.r > p.y1) continue;
        (near ||= []).push(q);
      }
      let nearL = null;
      if (p.z < 0.35) {
        for (const L of lines) {
          const lx0 = Math.min(L[0], L[2]) - ox, lx1 = Math.max(L[0], L[2]) - ox, ly0 = Math.min(L[1], L[3]) - oy, ly1 = Math.max(L[1], L[3]) - oy;
          if (lx1 + 5 < p.x0 || lx0 - 5 > p.x1 || ly1 + 5 < p.y0 || ly0 - 5 > p.y1) continue;
          (nearL ||= []).push(L);
        }
      }
      for (let s = 0; s < ns; s++) this.step(p, h, t + s * h, near, nearL, drift, ox, oy);
    }
    this.active = active;
  }

  step(p, h, t, near, nearL, drift, ox, oy) {
    const n = p.n, px = p.px, py = p.py, fx = p.fx, fy = p.fy;
    this.fk(p);
    // node forces
    const flow = (Math.sin(t * 0.8 + p.x * 0.011 + p.ph * 0.2) * 0.8 + Math.sin(t * 1.9 + p.x * 0.047 + p.y * 0.02) * 0.35 + drift) * p.flowK;
    for (let j = 1; j <= n; j++) {
      const u = j / n;
      fx[j] = flow * (60 + 140 * u);
      fy[j] = -p.buoy;
    }
    if (near) {
      for (const q of near) {
        const qx = q.x - ox, qy = q.y - oy, r = q.r, r2 = r * r, k = q.k ?? 1;
        for (let j = 1; j <= n; j++) {
          const dx = px[j] - qx, dy = py[j] - qy, d2 = dx * dx + dy * dy;
          if (d2 >= r2) continue;
          const d = Math.sqrt(d2) || 0.01, f = 1 - d / r;
          const push = 5200 * f * f * k;
          fx[j] += (dx / d) * push + (q.vx || 0) * 9 * f * k;
          fy[j] += (dy / d) * push + (q.vy || 0) * 9 * f * k;
        }
      }
    }
    if (nearL) {
      for (const L of nearL) {
        const ax = L[0] - ox, ay = L[1] - oy, bx = L[2] - ox, by = L[3] - oy;
        const ex = bx - ax, ey = by - ay, ee = ex * ex + ey * ey || 1;
        for (let j = 1; j <= n; j++) {
          const k = clamp01(((px[j] - ax) * ex + (py[j] - ay) * ey) / ee);
          const cx = ax + ex * k, cy = ay + ey * k;
          const dx = px[j] - cx, dy = py[j] - cy, d2 = dx * dx + dy * dy;
          if (d2 >= 30) continue;
          const d = Math.sqrt(d2) || 0.01, f = 1 - d / 5.5;
          const push = 3600 * f * f;
          fx[j] += (dx / d) * push; fy[j] += (dy / d) * push;
        }
      }
    }
    // joint torques / inertia -> angular acceleration
    for (let i = 0; i < n; i++) {
      let tq = 0, I = 0;
      const bx = px[i], by = py[i];
      for (let j = i + 1; j <= n; j++) {
        const rx = px[j] - bx, ry = py[j] - by;
        tq += rx * fy[j] - ry * fx[j];
        I += rx * rx + ry * ry;
      }
      const acc = tq / (I + 4) - p.stiff * (p.a[i] - p.rest[i]) - p.K.damp * p.v[i];
      p.v[i] += acc * h;
    }
    for (let i = 0; i < n; i++) {
      p.a[i] += p.v[i] * h;
      if (p.a[i] > 1.25) { p.a[i] = 1.25; p.v[i] *= -0.2; } else if (p.a[i] < -1.25) { p.a[i] = -1.25; p.v[i] *= -0.2; }
    }
  }

  // ------------------------------------------------------------------ drawing (phase 7: crisp voxel segments)
  // Every visible plant is rasterised each frame onto the world voxel grid (VS world px per voxel: 2/3 on the near
  // layers = 2 screen px at the 3x camera, 1 further back): the spine is a chain of tapered capsules, each voxel lit or
  // shaded by the facet it falls on (the old low-poly ribbon halves), voxels with open sky above get a bright top face,
  // open below a dark underside, a few get mineral flecks, and the silhouette gets a 1 px dark selective outline.
  // Horizontal runs of one colour merge into one rect; rects are colour-batched into Path2D fills.
  path(map, key) {
    let pa = map.get(key);
    if (!pa) { pa = new Path2D(); map.set(key, pa); }
    return pa;
  }

  draw(ctx, layer, o = {}) {
    const v = o.view, dx = o.dx || 0, dy = o.dy || 0;
    const paths = this.paths, rims = this.rims;
    paths.clear(); rims.clear();
    const vs = layer === 'front' || layer === 'deepFront' ? 2 / 3 : 1;
    let any = false;
    for (const p of this.list) {
      if (p.layer !== layer || p.hidden) continue;
      if (v && (p.x1 + dx < v.x0 || p.x0 + dx > v.x1 || p.y1 + dy < v.y0 || p.y0 + dy > v.y1)) continue;
      this.fk(p);
      this.voxPlant(p, dx, dy, vs);
      any = true;
    }
    if (!any) return;
    for (const [col, pa] of rims) { ctx.fillStyle = col; ctx.fill(pa); } // outlines first
    for (const [col, pa] of paths) { ctx.fillStyle = col; ctx.fill(pa); }
  }

  // rasterise one plant into a cell grid, then emit shaded runs
  voxPlant(p, dx, dy, vs) {
    const iv = 1 / vs;
    const gx0 = Math.floor((p.x0 + dx) * iv) - 1, gy0 = Math.floor((p.y0 + dy) * iv) - 1;
    const gw = Math.ceil((p.x1 + dx) * iv) - gx0 + 2, gh = Math.ceil((p.y1 + dy) * iv) - gy0 + 2;
    if (gw <= 0 || gh <= 0 || gw * gh > 60000) return;
    const N = gw * gh;
    if (!this.grid || this.grid.length < N) this.grid = new Uint8Array(Math.max(N, 4096));
    const G = this.grid;
    G.fill(0, 0, N);
    const pal = this.pal || (this.pal = []);
    pal.length = 1;
    const pi = (c) => { let i = pal.indexOf(c); if (i < 0) { i = pal.length; pal.push(c); } return i; };
    const C = p.cols;
    const iLit = pi(C.lit), iDark = pi(C.dark);
    // capsule from (ax, ay) to (bx, by), half widths ha -> hb; colour fn(side) -> palette index
    const cap = (ax, ay, bx, by, ha, hb, ci, cj) => {
      ax += dx; ay += dy; bx += dx; by += dy;
      const m = Math.max(ha, hb) + vs;
      const cx0 = Math.max(0, Math.floor((Math.min(ax, bx) - m) * iv) - gx0), cx1 = Math.min(gw - 1, Math.ceil((Math.max(ax, bx) + m) * iv) - gx0);
      const cy0 = Math.max(0, Math.floor((Math.min(ay, by) - m) * iv) - gy0), cy1 = Math.min(gh - 1, Math.ceil((Math.max(ay, by) + m) * iv) - gy0);
      const ex = bx - ax, ey = by - ay, ee = ex * ex + ey * ey || 1e-6;
      const minH = vs * 0.52;
      for (let cy = cy0; cy <= cy1; cy++) {
        const wy = (cy + gy0 + 0.5) * vs;
        for (let cx = cx0; cx <= cx1; cx++) {
          const wx = (cx + gx0 + 0.5) * vs;
          const qx = wx - ax, qy = wy - ay;
          const t = clamp01((qx * ex + qy * ey) / ee);
          const rx = qx - ex * t, ry = qy - ey * t;
          const hw = Math.max(minH, ha + (hb - ha) * t);
          if (rx * rx + ry * ry > hw * hw) continue;
          G[cy * gw + cx] = cj === undefined ? ci : (ex * qy - ey * qx > 0 ? ci : cj);
        }
      }
    };
    const disc = (x, y, r, fn) => {
      x += dx; y += dy;
      const cx0 = Math.max(0, Math.floor((x - r) * iv) - gx0 - 1), cx1 = Math.min(gw - 1, Math.ceil((x + r) * iv) - gx0 + 1);
      const cy0 = Math.max(0, Math.floor((y - r) * iv) - gy0 - 1), cy1 = Math.min(gh - 1, Math.ceil((y + r) * iv) - gy0 + 1);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const qx = (cx + gx0 + 0.5) * vs - x, qy = (cy + gy0 + 0.5) * vs - y;
        const d = Math.hypot(qx, qy);
        if (d > r) continue;
        const c = fn(qx, qy, d);
        if (c) G[cy * gw + cx] = c;
      }
    };
    const n = p.n, px = p.px, py = p.py, w = p.w;
    for (let j = 0; j < n; j++) {
      const ax = px[j], ay = py[j], bx = px[j + 1], by = py[j + 1];
      const tx = bx - ax, ty = by - ay, tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      let litLeft = nx * LIGHT[0] + ny * LIGHT[1] > 0;
      if (p.twist >= 0 && ((j + 1 + p.twist) & 2)) litLeft = !litLeft;
      // left of travel (cross > 0 in screen coords) = +n side
      cap(ax, ay, bx, by, w[j] * 0.5, w[j + 1] * 0.5, litLeft ? iDark : iLit, litLeft ? iLit : iDark);
      const k = j + 1;
      if (k < n) {
        if (p.K.leaves && k % 3 === 1) this.voxLeaf(p, k, cap, disc, iLit, iDark, pi);
        if (p.K.leaflets && (p.K.leaflets !== 'sparse' || (k + p.leafSeed) % 3 === 0)) this.voxLeaflets(p, k, cap, iLit, iDark);
      }
    }
    if (p.head) this.voxHead(p, cap, disc, pi);
    // emit runs
    const shades = this.shades || (this.shades = new Map());
    const sh = (c) => {
      let q = shades.get(c);
      if (!q) { q = [c, shade(c, 0.2), shade(c, -0.22), shade(c, 0.1), mix(shade(c, -0.62), '#140c22', 0.35)]; shades.set(c, q); if (shades.size > 600) shades.clear(); }
      return q;
    };
    const rims = this.rims, paths = this.paths, e = vs * 0.5;
    for (let cy = 0; cy < gh; cy++) {
      const row = cy * gw;
      let runC = null, runX = 0;
      const flush = (end) => {
        if (runC === null) return;
        const x = (runX + gx0) * vs, y = (cy + gy0) * vs, ww = (end - runX) * vs;
        this.path(paths, runC).rect(x, y, ww, vs);
        runC = null;
      };
      let outStart = -1, outCol = null;
      for (let cx = 0; cx <= gw; cx++) {
        const v = cx < gw ? G[row + cx] : 0;
        let col = null;
        if (v) {
          const q = sh(pal[v]);
          const up = cy > 0 ? G[row - gw + cx] : 0, dn = cy < gh - 1 ? G[row + gw + cx] : 0;
          if (!up) col = q[1];
          else if (!dn) col = q[2];
          else if (cx < gw - 1 && !G[row + cx + 1]) col = q[2];
          else if (hash2(cx + gx0, cy + gy0, 977) < 0.09) col = q[3];
          else col = q[0];
          if (outStart < 0) { outStart = cx; outCol = q[4]; }
        } else if (outStart >= 0) {
          // silhouette outline: the run's rect grown by half a voxel (drawn underneath)
          this.path(rims, outCol).rect((outStart + gx0) * vs - e, (cy + gy0) * vs - e, (cx - outStart) * vs + 2 * e, vs + 2 * e);
          outStart = -1;
        }
        if (col !== runC) { flush(cx); if (col) { runC = col; runX = cx; } }
      }
      flush(gw);
    }
  }

  voxLeaf(p, j, cap, disc, iLit, iDark, pi) {
    const C = p.cols, side = ((j + p.leafSeed) & 1) ? 1 : -1, s = p.s * (p.size ?? 1);
    const cx = p.px[j], cy = p.py[j];
    const ja = Math.max(0, j - 1), jb = Math.min(p.n, j + 1);
    let tx = p.px[jb] - p.px[ja], ty = p.py[jb] - p.py[ja];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty * side, ny = tx * side;
    const L = 7 * s;
    const bx = cx + nx * 1.5, by = cy + ny * 1.5;
    const mx = bx + (nx * 0.55 + tx * 0.85) * L * 0.5, my = by + (ny * 0.55 + ty * 0.85) * L * 0.5;
    const ex = bx + (nx * 0.55 + tx * 0.85) * L, ey = by + (ny * 0.55 + ty * 0.85) * L;
    cap(bx, by, mx, my, 0.5 * s, 1.15 * s, iLit, iDark);
    cap(mx, my, ex, ey, 1.15 * s, 0.15, iLit, iDark);
    if (C.bulb) { const ib = pi(C.bulb), ih = pi(shade(C.bulb, 0.35)); disc(bx, by, 1.2 * s, (qx, qy, d) => (qx + qy < -0.6 * s && d < 0.8 * s ? ih : ib)); }
  }

  voxLeaflets(p, j, cap, iLit, iDark) {
    const s = p.s * (p.size ?? 1), L = (p.kind === 'fan' ? 3.2 : 2.6) * s * (1 - (j / p.n) * 0.45);
    const cx = p.px[j], cy = p.py[j];
    const ja = Math.max(0, j - 1), jb = Math.min(p.n, j + 1);
    let tx = p.px[jb] - p.px[ja], ty = p.py[jb] - p.py[ja];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    for (const side of [1, -1]) {
      const ax = -ty * side, ay = tx * side;
      cap(cx, cy, cx + (ax * 0.8 + tx * 0.6) * L, cy + (ay * 0.8 + ty * 0.6) * L, 0.55 * s, 0.2, side > 0 ? iLit : iDark);
    }
  }

  voxHead(p, cap, disc, pi) {
    const n = p.n, H = p.head;
    const x = p.px[n], y = p.py[n];
    const tx = p.px[n] - p.px[n - 1], ty = p.py[n] - p.py[n - 1], tl = Math.hypot(tx, ty) || 1;
    const ux = tx / tl, uy = ty / tl, vx = -uy, vy = ux;
    const s = p.s * (H.size ?? 1);
    const iL = pi(H.lit), iD = pi(H.dark), iC = pi(H.core), iS = pi(H.shine || '#ffffff');
    if (H.type === 'daisy' || H.type === 'star') {
      const np = H.type === 'daisy' ? 8 : 5, R = (H.type === 'daisy' ? 3.4 : 3.6) * s, Wd = (H.type === 'daisy' ? 0.75 : 1.5) * s;
      const rot = Math.atan2(uy, ux) + 0.2;
      for (let i = 0; i < np; i++) {
        const a = rot + (i / np) * TAU;
        const ex = x + Math.cos(a) * R, ey = y + Math.sin(a) * R;
        cap(x, y, ex, ey, Wd, 0.25, i % 2 ? iD : iL);
      }
      const rc = 1.3 * s;
      disc(x, y, rc, (qx, qy, d) => (qx + qy < -0.5 * rc && d > rc * 0.3 ? iS : iC));
    } else if (H.type === 'tulip') {
      const L = 4.2 * s, Wd = 2.2 * s;
      const bx = x - ux * 0.6 * s, by = y - uy * 0.6 * s;
      // three petals: left lit, right dark, a middle cup
      cap(bx, by, bx + ux * L * 0.95 - vx * Wd * 0.75, by + uy * L * 0.95 - vy * Wd * 0.75, Wd * 0.45, Wd * 0.35, iL);
      cap(bx, by, bx + ux * L * 0.95 + vx * Wd * 0.75, by + uy * L * 0.95 + vy * Wd * 0.75, Wd * 0.45, Wd * 0.35, iD);
      cap(bx, by, bx + ux * L * 0.75, by + uy * L * 0.75, Wd * 0.55, Wd * 0.4, iC);
      cap(bx + ux * L * 0.35 - vx * Wd * 0.6, by + uy * L * 0.35 - vy * Wd * 0.6, bx + ux * L * 0.65 - vx * Wd * 0.7, by + uy * L * 0.65 - vy * Wd * 0.7, 0.3 * s, 0.25 * s, iS);
    } else if (H.type === 'bulb' || H.type === 'pod') {
      const r = (H.type === 'pod' ? 1.6 : 1.8) * s;
      disc(x, y, r * 1.08, (qx, qy, d) => {
        if (qx < -0.15 * r && qy < -0.15 * r && d > r * 0.25 && d < r * 0.7) return iS;
        return qx + qy * 1.2 < 0.1 * r ? iL : iD;
      });
    } else if (H.type === 'feather') {
      const rot = Math.atan2(uy, ux);
      for (let i = 0; i < 7; i++) {
        const a = rot + (i - 3) * 0.42 + Math.sin(p.ph + i) * 0.1;
        const L = 5.5 * s;
        cap(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 0.55 * s, 0.2, i < 4 ? iL : iD);
      }
    }
    void vx; void vy;
  }

  // Emissive tips and spots (call after the darkness pass, under the world camera).
  drawGlows(ctx, o = {}) {
    const v = o.view, dx = o.dx || 0, dy = o.dy || 0, a = o.a ?? 1, t = o.t || 0, glow = o.glow;
    if (!glow) return;
    for (const p of this.list) {
      if (!p.glow || p.hidden) continue;
      if (v && (p.x1 + dx < v.x0 || p.x0 + dx > v.x1 || p.y1 + dy < v.y0 || p.y0 + dy > v.y1)) continue;
      const k = (0.65 + 0.35 * Math.sin(t * 1.7 + p.ph)) * a;
      glow(ctx, p.px[p.n] + dx, p.py[p.n] + dy, Math.round(4 + 3 * p.s), p.glow, k);
      if (p.kind === 'glow' || p.kind === 'whip') for (let j = 2; j < p.n; j += 2) glow(ctx, p.px[j] + dx, p.py[j] + dy, 2, p.glow, k * 0.45);
    }
  }

  // Tip positions of glowing plants in view (for real light pools).
  glowLights(v, max = 4, out = []) {
    for (const p of this.list) {
      if (!p.glow || p.hidden || out.length >= max) continue;
      if (v && (p.x1 < v.x0 || p.x0 > v.x1 || p.y1 < v.y0 || p.y0 > v.y1)) continue;
      out.push({ x: p.px[p.n], y: p.py[p.n], color: p.glow });
    }
    return out;
  }
}

// Palette for a plant from a base colour, fogged toward fog colour by f (0..1).
export function plantCols(base, fog = null, f = 0, o = {}) {
  const b = fog && f > 0 ? mix(base, fog, clamp(f, 0, 0.9)) : base;
  return {
    lit: shade(b, 0.16), dark: shade(b, -0.24), rim: o.rim === false ? null : mix(shade(b, 0.45), '#ffffff', 0.35),
    bulb: o.bulb ? (fog && f > 0 ? mix(o.bulb, fog, clamp(f, 0, 0.9)) : o.bulb) : null,
  };
}

export function headCols(petal, core = '#ffd23a', fog = null, f = 0) {
  const q = (c) => (fog && f > 0 ? mix(c, fog, clamp(f, 0, 0.9)) : c);
  return { lit: q(shade(petal, 0.12)), dark: q(shade(petal, -0.16)), core: q(core), shine: q('#ffffff') };
}
