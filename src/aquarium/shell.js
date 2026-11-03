// Glossy glass shells for every tank tier, painted once per scene layout and cached:
//   jar / bowl   a round glass globe: thick refracting rim, rolled lip, big curved window highlight,
//                thick glass bottom, a caustic light pool and a soft shadow on the desk
//   small / big  a glass box with a glossy white hood (aqua LED strip), chrome-trimmed plinth, bright
//                glass edges, glare and streaks
//   reef         as above with a deep blue LED hood
//   wall         a wide glossy white bezel set into the wall
//
//   shellArt(L, ell) -> {under, back, front: {canvas, x, y} | null}   (scene coordinates; ell = round glass
//                       ellipse in tank-local coordinates from tankOpts)
// Draw order: room, under, back, tank interior, front.

import { Paint, C, setMix, grad, sdRR } from './paint.js';
import { clamp01, smoothstep } from '../core/math.js';

const COL = {
  white: C('#ffffff'), glassA: C('#e8fffb'), glassB: C('#9ff0e0'), glassC: C('#3cc4b4'), glassD: C('#1f8f9a'),
  edge: C('#2c7fa8'), edgeD: C('#1a5a80'), aqua: C('#7ff6ff'), aquaD: C('#20b8d8'), shadow: C('#3a6e8e'),
  hoodA: C('#ffffff'), hoodB: C('#eaf5fb'), hoodC: C('#c4dcea'), chrome0: C('#6a8094'), chrome1: C('#b8cad8'), chrome2: C('#f4fbff'),
  navyA: C('#3a78c0'), navyB: C('#1c4a8c'), navyC: C('#0c2a5a'), blueLed: C('#8ac8ff'), lime: C('#a8ec5a'), sun: C('#fffbe8'),
};

const cache = new Map();

export function shellArt(L, ell) {
  const key = [L.key, L.tier, L.sw, L.sh, L.tank.x, L.tank.y, L.tank.w, L.tank.h].join('|');
  let a = cache.get(key);
  if (a) return a;
  if (L.shape === 'round') a = roundShell(L, ell);
  else if (L.shape === 'wall') a = wallShell(L);
  else a = boxShell(L);
  cache.set(key, a);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  return a;
}

const out = (P, x, y, q = 4) => ({ canvas: P.toCanvas(q), x, y });

// ------------------------------------------------------------------ round (jar, bowl)

function roundShell(L, e) {
  const { tank, u } = L;
  const th = Math.max(2, Math.round(3.2 * u));
  const pad = th + Math.round(8 * u) + 4;
  const ox = tank.x - pad, oy = tank.y - pad;
  const W = tank.w + pad * 2, H = tank.h + pad * 2;
  // ellipse in canvas coordinates
  const cx = e.cx + pad, cy = e.cy + pad, rx = e.rx, ry = e.ry;
  const lipY = pad + 1;
  const dyl = (lipY - cy) / ry;
  const hw = rx * Math.sqrt(Math.max(0.02, 1 - dyl * dyl));
  const lipRx = hw + th * 0.7, lipRy = Math.max(2, hw * (L.tier === 0 ? 0.13 : 0.1));
  const lipT = Math.max(2, Math.round(th * (L.tier === 0 ? 1.15 : 0.9)));
  const c0 = [0, 0, 0];

  // ---- back: far half of the rolled lip, faint back glass
  const B = new Paint(W, H);
  {
    const c = B.c;
    B.each(cx - lipRx - lipT, lipY - lipRy - lipT, cx + lipRx + lipT, lipY + 1, (x, y) => {
      const d = Math.hypot((x - cx) / lipRx, (y - lipY) / lipRy);
      const dt = (d - 1) * Math.min(lipRx, lipRy * 4);
      if (y > lipY || dt < -lipT * 0.6 || dt > lipT * 0.6) return 0;
      setMix(c, COL.glassB, COL.glassC, clamp01(0.5 + dt / lipT));
      return 0.6;
    });
  }

  // ---- front: refracting rim, highlights, thick bottom, front half of the lip
  const F = new Paint(W, H);
  const c = F.c;
  const Rx = rx + th, Ry = ry + th;
  F.each(cx - Rx - 1, lipY - 1, cx + Rx + 1, cy + Ry + 1, (x, y) => {
    if (y < lipY) return 0;
    const nx = (x - cx) / rx, ny = (y - cy) / ry;
    const d = Math.hypot(nx, ny);
    const dOut = Math.hypot((x - cx) / Rx, (y - cy) / Ry);
    if (dOut > 1) return 0;
    const lit = clamp01(0.5 - nx * 0.45 - ny * 0.35); // upper left = toward the window
    if (d >= 1) {
      // the glass wall seen edge-on: bright aqua-green, dark outer line
      const w = (dOut - 1 / (1 + th / Math.min(rx, ry))) * Math.min(Rx, Ry);
      if (dOut > 1 - 1.2 / Math.min(Rx, Ry)) { setMix(c, COL.edge, COL.edgeD, 1 - lit); return 0.9; }
      grad(c, [[0, COL.glassD], [0.45, COL.glassC], [0.8, COL.glassB], [1, COL.glassA]], lit);
      if (w < 1.2) setMix(c, c, COL.white, 0.35 * lit);
      return 0.72;
    }
    let a = 0;
    c[0] = 255; c[1] = 255; c[2] = 255;
    // inner refraction: a bright band just inside the rim, stronger lower right (light focusing)
    const band = smoothstep(1 - 5 / Math.min(rx, ry), 1, d);
    if (band > 0) { setMix(c, COL.aqua, COL.white, lit); a = Math.max(a, band * (0.18 + 0.25 * (1 - lit))); }
    // big curved window highlight on the upper left
    const ang = Math.atan2(ny, nx);
    if (d > 0.7 && d < 0.9 && ang > -2.85 && ang < -1.75) {
      const k = Math.min(smoothstep(-2.85, -2.55, ang), 1 - smoothstep(-2.05, -1.75, ang)) * Math.min(smoothstep(0.7, 0.75, d), 1 - smoothstep(0.85, 0.9, d));
      if (k > 0.05) { c[0] = 255; c[1] = 255; c[2] = 255; a = Math.max(a, 0.62 * k); }
    }
    if (d > 0.62 && d < 0.67 && ang > -2.6 && ang < -2.15) { c[0] = 255; c[1] = 255; c[2] = 255; a = Math.max(a, 0.45); }
    // reflected window panes, upper right
    for (const [px, py] of [[0.38, -0.5], [0.56, -0.38]]) {
      const qx = (nx - px) / 0.1, qy = (ny - py) / 0.15;
      const sd = Math.max(Math.abs(qx), Math.abs(qy));
      if (sd < 1) { c[0] = 255; c[1] = 255; c[2] = 255; a = Math.max(a, sd > 0.75 ? 0.4 : 0.16); }
    }
    // rim light on the right edge
    if (d > 0.9 && ang > -0.6 && ang < 0.5) { setMix(c, COL.white, COL.aqua, 0.3); a = Math.max(a, 0.3 * smoothstep(0.9, 0.97, d)); }
    // thick glass bottom
    if (ny > 0.8) {
      const k = smoothstep(0.8, 0.95, ny);
      setMix(c, COL.glassB, COL.white, 0.25);
      a = Math.max(a, 0.22 * k);
      if (ny > 0.93 && ny < 0.955) { c[0] = 255; c[1] = 255; c[2] = 255; a = Math.max(a, 0.45); }
    }
    return a;
  });
  // sparkle on the highlight
  {
    const sx = Math.round(cx - rx * 0.62), sy = Math.round(cy - ry * 0.55);
    const s = Math.max(2, Math.round(3 * u));
    for (let i = -s; i <= s; i++) {
      const k = 1 - Math.abs(i) / (s + 1);
      F.over(sx + i, sy, COL.white, k);
      F.over(sx, sy + i, COL.white, k);
    }
  }
  // front half of the rolled lip
  F.each(cx - lipRx - lipT, lipY - lipRy - lipT, cx + lipRx + lipT, lipY + lipRy + lipT, (x, y) => {
    const d = Math.hypot((x - cx) / lipRx, (y - lipY) / lipRy);
    const dt = (d - 1) * Math.min(lipRx, lipRy * 4);
    if (dt < -lipT * 0.6 || dt > lipT * 0.6) return 0;
    if (y < lipY) {
      // top surface of the rolled lip (both halves): bright
      setMix(c, COL.white, COL.glassA, clamp01(dt / lipT + 0.5));
      return 0.8;
    }
    const lit = clamp01(0.6 - (x - cx) / lipRx * 0.5);
    grad(c, [[0, COL.glassC], [0.5, COL.glassB], [1, COL.white]], lit * (1 - clamp01(dt / lipT + 0.5) * 0.6));
    if (Math.abs(dt) > lipT * 0.45) setMix(c, c, COL.edge, 0.55);
    return 0.88;
  });

  // ---- under: shadow and a caustic light pool on the desk (light from the window, upper left)
  const deskY = L.deskY - L.tank.y + pad;
  const U = new Paint(W + Math.round(30 * u), H);
  {
    const cu = U.c;
    const sRx = rx * 0.95, sRy = Math.max(2, 4.5 * u);
    U.each(cx - sRx - 2, deskY - sRy - 2, cx + sRx + 2, deskY + sRy + 2, (x, y) => {
      const d = Math.hypot((x - cx) / sRx, (y - deskY) / sRy);
      if (d > 1) return 0;
      cu[0] = c0[0] + 40; cu[1] = 90; cu[2] = 120;
      return 0.3 * (1 - d * d);
    });
    const pcx = cx + rx * 0.45, pRx = rx * 0.55, pRy = Math.max(2, 3.5 * u);
    U.each(pcx - pRx - 2, deskY - pRy - 1, pcx + pRx + 2, deskY + pRy + 2, (x, y) => {
      const d = Math.hypot((x - pcx) / pRx, (y - deskY - 1) / pRy);
      if (d > 1) return 0;
      setMix(cu, COL.aqua, COL.white, 1 - d);
      return 0.5 * (1 - d) + (d < 0.35 ? 0.25 : 0);
    });
  }
  return { under: out(U, ox, oy), back: out(B, ox, oy), front: out(F, ox, oy), lip: { y: tank.y + 1, hw } };
}

// ------------------------------------------------------------------ box (small, big, reef)

function boxShell(L) {
  const { tank, u, lid, base } = L;
  const reef = L.id === 'reeftank';
  const th = Math.max(2, Math.round(3 * u));
  const pad = th + 3;
  const ox = tank.x - pad, oy = tank.y - lid - pad;
  const W = tank.w + pad * 2, H = tank.h + lid + base + pad * 2 + Math.round(6 * u);
  const x0 = pad, y0 = pad + lid; // inner glass rect in canvas coords
  const x1 = x0 + tank.w, y1 = y0 + tank.h;
  const F = new Paint(W, H);
  const c = F.c;
  // side glass edges (green-aqua glass seen edge-on)
  for (const [a, b, left] of [[x0 - th, x0, true], [x1, x1 + th, false]]) {
    F.each(a, y0, b, y1, (x, y) => {
      const t = (x - a) / th;
      if ((left && x < a + 1) || (!left && x > b - 1)) { setMix(c, COL.edge, COL.edgeD, left ? 0.2 : 0.6); return 0.95; }
      grad(c, [[0, COL.glassA], [0.5, COL.glassB], [1, COL.glassC]], left ? t : 1 - t);
      const v = (y - y0) / tank.h;
      if (v < 0.4) setMix(c, c, COL.white, 0.35 * (1 - v / 0.4));
      return 0.82;
    });
  }
  // front pane: edge lines, top-left glare, diagonal streaks, silicone at the bottom
  F.each(x0, y0, x1, y1, (x, y) => {
    const lx = x - x0, ly = y - y0;
    if (lx < 1 || lx > tank.w - 1) { c[0] = 255; c[1] = 255; c[2] = 255; return 0.45; }
    if (ly > tank.h - Math.max(2, 2.5 * u)) { setMix(c, COL.glassB, COL.white, 0.3); return 0.4; }
    let a = 0;
    c[0] = 255; c[1] = 255; c[2] = 255;
    const g = 1 - (lx / (tank.w * 0.32) + ly / (tank.h * 0.55));
    if (g > 0) a = Math.max(a, 0.16 * g * g);
    const s = (lx + ly * 0.7) / Math.max(40, tank.w * 0.5);
    const f = ((s % 1) + 1) % 1;
    if (f > 0.62 && f < 0.7) a = Math.max(a, 0.1);
    if (f > 0.74 && f < 0.755) a = Math.max(a, 0.12);
    if (lx < 2.5 * u + 2 && ly < tank.h * 0.6) a = Math.max(a, 0.28 * (1 - ly / (tank.h * 0.6)));
    return a;
  });
  // hood (lid)
  if (lid > 0) {
    const hx0 = x0 - th - 1, hx1 = x1 + th + 1, hy0 = y0 - lid, hy1 = y0;
    const r = Math.min(lid * 0.5, 6 * u + 1);
    const hcx = (hx0 + hx1) / 2, hcy = (hy0 + hy1) / 2 + r / 2;
    F.each(hx0, hy0, hx1, hy1 + 1, (x, y) => {
      const d = sdRR(x, y, hcx, hcy, (hx1 - hx0) / 2, (hy1 - hy0) / 2 + r / 2, r);
      if (d > 0 || y > hy1) return 0;
      const t = (y - hy0) / lid;
      if (reef) grad(c, [[0, COL.navyA], [0.45, COL.navyB], [1, COL.navyC]], t);
      else grad(c, [[0, COL.hoodA], [0.5, COL.hoodB], [1, COL.hoodC]], t);
      if (d > -1) setMix(c, c, reef ? COL.navyC : COL.chrome0, 0.6);
      else if (y < hy0 + Math.max(1.5, lid * 0.18)) setMix(c, c, COL.white, reef ? 0.35 : 0.8);
      // LED strip along the bottom of the hood
      if (y > hy1 - Math.max(1.5, 2 * u)) { setMix(c, reef ? COL.blueLed : COL.aqua, COL.white, 0.25); return 1; }
      // glossy sheen band
      if (t > 0.18 && t < 0.42) setMix(c, c, COL.white, reef ? 0.12 : 0.3);
      return 1;
    });
    // little glossy power button on the hood
    const bx = hx1 - Math.round(10 * u) - 3, by = Math.round(hy0 + lid * 0.45);
    const br = Math.max(1.5, 2.2 * u);
    F.each(bx - br - 1, by - br - 1, bx + br + 1, by + br + 1, (x, y) => {
      const d = Math.hypot(x - bx, y - by) / br;
      if (d > 1) return 0;
      setMix(c, COL.lime, COL.white, d < 0.45 && y < by ? 0.8 : 0);
      return 1;
    });
  }
  // plinth (base)
  if (base > 0) {
    const bx0 = x0 - th - 1, bx1 = x1 + th + 1, by0 = y1, by1 = y1 + base;
    const r = Math.min(base * 0.4, 5 * u + 1);
    F.each(bx0, by0, bx1, by1, (x, y) => {
      const d = sdRR(x, y, (bx0 + bx1) / 2, (by0 + by1) / 2 - r / 2, (bx1 - bx0) / 2, (by1 - by0) / 2 + r / 2, r);
      if (d > 0) return 0;
      const t = (y - by0) / base;
      if (reef) grad(c, [[0, COL.navyA], [0.5, COL.navyB], [1, COL.navyC]], t);
      else grad(c, [[0, COL.white], [0.35, COL.hoodB], [1, COL.hoodC]], t);
      if (t < 0.22) setMix(c, COL.chrome2, COL.chrome1, t / 0.22);
      if (d > -1) setMix(c, c, reef ? COL.navyC : COL.chrome0, 0.55);
      if (Math.abs(t - 0.62) < 0.08) setMix(c, c, COL.aquaD, 0.55);
      return 1;
    });
    // power LED
    const lx = bx1 - Math.round(8 * u) - 2, ly = Math.round(by0 + base * 0.62);
    F.over(lx, ly, COL.lime, 1); F.over(lx + 1, ly, COL.lime, 1);
  }
  // under: soft shadow on the desk below the plinth
  const U = new Paint(W + Math.round(12 * u), H + Math.round(10 * u));
  {
    const cu = U.c;
    const sy = y1 + base, sx0 = x0 - th, sx1 = x1 + th + Math.round(6 * u);
    U.each(sx0, sy - 1, sx1, sy + Math.max(3, 5 * u), (x, y) => {
      const k = 1 - (y - sy + 1) / Math.max(3, 5 * u);
      cu[0] = 40; cu[1] = 90; cu[2] = 120;
      const fx = Math.min(1, (x - sx0) / 6, (sx1 - x) / 6);
      return 0.26 * k * fx;
    });
  }
  return { under: out(U, ox, oy), back: null, front: out(F, ox, oy) };
}

// ------------------------------------------------------------------ wall aquarium

function wallShell(L) {
  const { tank, u } = L;
  const bz = Math.max(4, Math.round(13 * u));
  const pad = bz + Math.round(8 * u) + 2;
  const ox = tank.x - pad, oy = tank.y - pad;
  const W = tank.w + pad * 2, H = tank.h + pad * 2;
  const ix0 = pad, iy0 = pad, ix1 = pad + tank.w, iy1 = pad + tank.h;
  const cx = W / 2, cy = H / 2;
  const R = Math.round(10 * u) + 2, r = Math.max(2, Math.round(4 * u));
  const U = new Paint(W, H);
  {
    const cu = U.c;
    U.each(0, 0, W, H, (x, y) => {
      const d = sdRR(x, y, cx + 2 * u, cy + 4 * u, tank.w / 2 + bz, tank.h / 2 + bz, R);
      if (d < 0 || d > 8 * u) return 0;
      cu[0] = 70; cu[1] = 120; cu[2] = 150;
      return 0.22 * (1 - d / (8 * u));
    });
  }
  const F = new Paint(W, H);
  const c = F.c;
  F.each(0, 0, W, H, (x, y) => {
    const dO = sdRR(x, y, cx, cy, tank.w / 2 + bz, tank.h / 2 + bz, R);
    const dI = sdRR(x, y, cx, cy, tank.w / 2, tank.h / 2, r);
    if (dO > 0) return 0;
    if (dI <= 0) {
      // front glass over the water: glare at the top left, a streak, edge line
      const lx = x - ix0, ly = y - iy0;
      c[0] = 255; c[1] = 255; c[2] = 255;
      if (dI > -1.2) return 0.5;
      const g = 1 - (lx / (tank.w * 0.3) + ly / (tank.h * 0.5));
      let a = g > 0 ? 0.14 * g * g : 0;
      const f = (((lx + ly * 0.8) / Math.max(60, tank.w * 0.45)) % 1 + 1) % 1;
      if (f > 0.6 && f < 0.66) a = Math.max(a, 0.08);
      return a;
    }
    // bezel: glossy white, lit from the top, chrome inner trim, aqua glow strip at the bottom
    const t = (y - (iy0 - bz)) / (tank.h + bz * 2);
    grad(c, [[0, COL.white], [0.5, COL.hoodB], [1, COL.hoodC]], t);
    if (dO > -1) setMix(c, c, COL.chrome0, 0.6);
    else if (dO > -2.5 && y < cy) setMix(c, c, COL.white, 0.9);
    if (dI < 2 * u + 1) setMix(c, COL.chrome1, COL.chrome2, clamp01((cy - y) / tank.h + 0.5));
    if (y > iy1 && dI < bz * 0.55 && dI > bz * 0.3) setMix(c, c, COL.aqua, 0.6);
    // glossy sheen on the top bar
    if (y < iy0 && y > iy0 - bz * 0.7 && y < iy0 - bz * 0.35) setMix(c, c, COL.white, 0.4);
    return 1;
  });
  void ix1;
  return { under: out(U, ox, oy), back: null, front: out(F, ox, oy) };
}
