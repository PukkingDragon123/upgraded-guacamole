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
// Drawing: each segment is two facets split along the spine (lit / shaded by their facing to the top-left light),
// colour-batched into a handful of Path2D fills per frame, with a glossy rim on the near layer.

import { clamp, clamp01, lerp, TAU } from '../core/math.js';
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

  // ------------------------------------------------------------------ drawing
  path(map, key) {
    let pa = map.get(key);
    if (!pa) { pa = new Path2D(); map.set(key, pa); }
    return pa;
  }

  draw(ctx, layer, o = {}) {
    const v = o.view, dx = o.dx || 0, dy = o.dy || 0;
    const paths = this.paths, rims = this.rims;
    paths.clear(); rims.clear();
    const rimOn = layer === 'front' && o.rim !== false;
    const order = [];
    for (const p of this.list) {
      if (p.layer !== layer || p.hidden) continue;
      if (v && (p.x1 + dx < v.x0 || p.x0 + dx > v.x1 || p.y1 + dy < v.y0 || p.y0 + dy > v.y1)) continue;
      this.fk(p);
      this.ribbon(p, dx, dy, rimOn);
      if (p.head) order.push(p);
    }
    for (const [col, pa] of paths) { ctx.fillStyle = col; ctx.fill(pa); }
    if (rims.size) {
      ctx.lineWidth = 0.55;
      ctx.lineCap = 'round';
      for (const [col, pa] of rims) { ctx.strokeStyle = col; ctx.stroke(pa); }
    }
    if (order.length) {
      paths.clear();
      for (const p of order) this.headOf(p, dx, dy);
      for (const [col, pa] of paths) { ctx.fillStyle = col; ctx.fill(pa); }
    }
  }

  ribbon(p, dx, dy, rimOn) {
    const n = p.n, px = p.px, py = p.py, w = p.w, C = p.cols;
    const lit = this.path(this.paths, C.lit), dark = this.path(this.paths, C.dark);
    let pLx = 0, pLy = 0, pRx = 0, pRy = 0;
    const rim = rimOn && C.rim ? this.path(this.rims, C.rim) : null;
    for (let j = 0; j <= n; j++) {
      // tangent: average of the adjacent segments
      const ja = Math.max(0, j - 1), jb = Math.min(n, j + 1);
      let tx = px[jb] - px[ja], ty = py[jb] - py[ja];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const nx = -ty, ny = tx, hw = w[j] * 0.5;
      const cx = px[j] + dx, cy = py[j] + dy;
      const Lx = cx + nx * hw, Ly = cy + ny * hw, Rx = cx - nx * hw, Ry = cy - ny * hw;
      if (j > 0) {
        const qx = px[j - 1] + dx, qy = py[j - 1] + dy;
        // which facet faces the light (the left normal points to +n)
        let litLeft = nx * LIGHT[0] + ny * LIGHT[1] > 0;
        if (p.twist >= 0 && ((j + p.twist) & 2)) litLeft = !litLeft;
        const A = litLeft ? lit : dark, B = litLeft ? dark : lit;
        A.moveTo(pLx, pLy); A.lineTo(Lx, Ly); A.lineTo(cx, cy); A.lineTo(qx, qy); A.closePath();
        B.moveTo(qx, qy); B.lineTo(cx, cy); B.lineTo(Rx, Ry); B.lineTo(pRx, pRy); B.closePath();
        if (rim && j < n) { const sx = litLeft ? pLx : pRx, sy = litLeft ? pLy : pRy; rim.moveTo(sx, sy); rim.lineTo(litLeft ? Lx : Rx, litLeft ? Ly : Ry); }
        // kelp: side blades every few nodes, bulbs at the blade roots; fronds / roots: little leaflets
        if (p.K.leaves && j % 3 === 1 && j < n) this.leaf(p, cx, cy, tx, ty, nx, ny, j, dx, dy);
        if (p.K.leaflets && j < n && j > 0 && (p.K.leaflets !== 'sparse' || (j + p.leafSeed) % 3 === 0)) this.leaflet(p, cx, cy, tx, ty, nx, ny, j);
      }
      pLx = Lx; pLy = Ly; pRx = Rx; pRy = Ry;
    }
  }

  leaf(p, cx, cy, tx, ty, nx, ny, j) {
    const C = p.cols, side = ((j + p.leafSeed) & 1) ? 1 : -1, s = p.s * (p.size ?? 1);
    const L = 7 * s, Wd = 2.2 * s;
    const ax = nx * side, ay = ny * side;
    const bx = cx + ax * 1.5, by = cy + ay * 1.5;
    const tipx = bx + (ax * 0.55 + tx * 0.85) * L, tipy = by + (ay * 0.55 + ty * 0.85) * L;
    const mx = (bx + tipx) / 2, my = (by + tipy) / 2;
    const lit = this.path(this.paths, C.lit), dark = this.path(this.paths, C.dark);
    lit.moveTo(bx, by); lit.lineTo(mx + tx * Wd, my + ty * Wd); lit.lineTo(tipx, tipy); lit.closePath();
    dark.moveTo(bx, by); dark.lineTo(tipx, tipy); dark.lineTo(mx - tx * Wd, my - ty * Wd); dark.closePath();
    if (C.bulb) { const b = this.path(this.paths, C.bulb); b.moveTo(bx + 1.1 * s, by); b.arc(bx, by, 1.1 * s, 0, TAU); }
  }

  leaflet(p, cx, cy, tx, ty, nx, ny, j) {
    const C = p.cols, s = p.s * (p.size ?? 1), L = (p.kind === 'fan' ? 3.2 : 2.6) * s * (1 - (j / p.n) * 0.45);
    const lit = this.path(this.paths, C.lit), dark = this.path(this.paths, C.dark);
    for (const side of [1, -1]) {
      const ax = nx * side, ay = ny * side;
      const ex = cx + (ax * 0.8 + tx * 0.6) * L, ey = cy + (ay * 0.8 + ty * 0.6) * L;
      const P = side > 0 ? lit : dark;
      P.moveTo(cx, cy); P.lineTo(ex, ey); P.lineTo(cx + tx * L * 0.55, cy + ty * L * 0.55); P.closePath();
    }
  }

  headOf(p, dx, dy) {
    const n = p.n, H = p.head;
    const x = p.px[n] + dx, y = p.py[n] + dy;
    const tx = p.px[n] - p.px[n - 1], ty = p.py[n] - p.py[n - 1], tl = Math.hypot(tx, ty) || 1;
    const ux = tx / tl, uy = ty / tl, vx = -uy, vy = ux;
    const s = p.s * (H.size ?? 1);
    if (H.type === 'daisy' || H.type === 'star') {
      const np = H.type === 'daisy' ? 8 : 5, R = (H.type === 'daisy' ? 3.4 : 3.6) * s, Wd = (H.type === 'daisy' ? 0.9 : 1.6) * s;
      const rot = Math.atan2(uy, ux);
      for (let i = 0; i < np; i++) {
        const a = rot + (i / np) * TAU + 0.2;
        const cx = Math.cos(a), cy = Math.sin(a);
        const P = this.path(this.paths, i % 2 ? H.dark : H.lit);
        const ex = x + cx * R, ey = y + cy * R;
        P.moveTo(x - cy * Wd, y + cx * Wd); P.lineTo(ex, ey); P.lineTo(x + cy * Wd, y - cx * Wd); P.closePath();
      }
      const c = this.path(this.paths, H.core);
      const r = 1.25 * s;
      c.moveTo(x + r, y);
      for (let i = 1; i <= 6; i++) c.lineTo(x + Math.cos((i / 6) * TAU) * r, y + Math.sin((i / 6) * TAU) * r);
      c.closePath();
      const hl = this.path(this.paths, H.shine || '#ffffff');
      hl.moveTo(x - 0.5 * s, y - 0.6 * s); hl.lineTo(x, y - 0.9 * s); hl.lineTo(x + 0.1 * s, y - 0.3 * s); hl.closePath();
    } else if (H.type === 'tulip') {
      // a faceted cup opening along the stem
      const L = 4.2 * s, Wd = 2.3 * s;
      const bx = x - ux * 0.6 * s, by = y - uy * 0.6 * s;
      const pts = [[-Wd, 0.2], [-Wd * 1.05, 0.75], [-Wd * 0.45, 1.05], [0, 0.78], [Wd * 0.45, 1.05], [Wd * 1.05, 0.75], [Wd, 0.2]];
      const P = (q) => [bx + vx * q[0] + ux * q[1] * L, by + vy * q[0] + uy * q[1] * L];
      const lit = this.path(this.paths, H.lit), dark = this.path(this.paths, H.dark), mid = this.path(this.paths, H.core);
      const p0 = P([0, 0]);
      const ps = pts.map(P);
      lit.moveTo(p0[0], p0[1]); for (let i = 0; i < 4; i++) lit.lineTo(ps[i][0], ps[i][1]); lit.closePath();
      dark.moveTo(p0[0], p0[1]); for (let i = 3; i < 7; i++) dark.lineTo(ps[i][0], ps[i][1]); dark.closePath();
      mid.moveTo(ps[2][0], ps[2][1]); mid.lineTo(ps[3][0], ps[3][1]); mid.lineTo(ps[4][0], ps[4][1]); mid.lineTo(p0[0] + ux * L * 0.55, p0[1] + uy * L * 0.55); mid.closePath();
      const hl = this.path(this.paths, H.shine || '#ffffff');
      const a = P([-Wd * 0.7, 0.35]), b = P([-Wd * 0.75, 0.7]), c = P([-Wd * 0.45, 0.62]);
      hl.moveTo(a[0], a[1]); hl.lineTo(b[0], b[1]); hl.lineTo(c[0], c[1]); hl.closePath();
    } else if (H.type === 'bulb' || H.type === 'pod') {
      const r = (H.type === 'pod' ? 1.6 : 1.8) * s;
      const P = this.path(this.paths, H.lit), D = this.path(this.paths, H.dark);
      // a faceted gem-like bulb: upper-left facets lit, lower-right dark
      const pts = [];
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 1.15]); }
      for (let i = 0; i < 6; i++) {
        const a = pts[i], b = pts[(i + 1) % 6];
        const T = (a[0] + b[0]) / 2 - x < -0.2 * r || (a[1] + b[1]) / 2 - y < -0.3 * r ? P : D;
        T.moveTo(x, y); T.lineTo(a[0], a[1]); T.lineTo(b[0], b[1]); T.closePath();
      }
      const hl = this.path(this.paths, H.shine || '#ffffff');
      hl.moveTo(x - r * 0.55, y - r * 0.5); hl.lineTo(x - r * 0.1, y - r * 0.85); hl.lineTo(x - r * 0.2, y - r * 0.35); hl.closePath();
    } else if (H.type === 'feather') {
      // crinoid / sea lily crown: arms fanning out of the tip
      const P = this.path(this.paths, H.lit), D = this.path(this.paths, H.dark);
      const rot = Math.atan2(uy, ux);
      for (let i = 0; i < 7; i++) {
        const a = rot + (i - 3) * 0.42 + Math.sin(p.ph + i) * 0.1;
        const L = 5.5 * s, ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
        const T = i < 4 ? P : D;
        T.moveTo(x, y); T.lineTo(ex - Math.sin(a) * 0.7 * s, ey + Math.cos(a) * 0.7 * s); T.lineTo(ex, ey); T.closePath();
      }
    }
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
