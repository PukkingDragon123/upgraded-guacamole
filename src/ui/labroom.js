// [lab15] THE LAB's backdrop: a SPACE SCENE in crisp 2D pixel art (OWNER: Lab agent). Used behind the research tree
// and the Rods / Boats tabs. Glossy and cute (Frutiger Aero night sky), never grim.
//
// Art grid: 1 art pixel = 1 logical px (2 device px on the hi-res UI layer, src/gfx/hires.js); the tiniest stars,
// sparkle tips and glitter use single device px. No smooth gradients: colour ramps are posterised with 4x4 Bayer
// dithering, every disc is a hard pixel circle.
//
// Depth, back to front (each layer has its own parallax, softly capped by its padding):
//   bg    : deep space gradient (navy -> indigo -> violet), dithered glow pools at the edges, a calmer middle
//   far   : 1 device px star field, a distant pixel spiral galaxy           twinkles, a space whale drifting by
//   neb   : dithered nebula clouds (violet / pink / aqua, dust lanes) bright toward the edges   shooting stars
//   mid   : brighter stars, a fish-shaped constellation, a comet              twinkles + big 4-point glints
//   near  : a ringed planet, a tiny pink planet; Boats: the limb of an ocean planet with its atmosphere
//           a rotating ocean planet with little continents + an orbiting moon, drifting stardust / glitter
//   Boats : a glowing orbit line (no parallax) the boats float on, with light pulses running along it
// No light rays / god rays / spotlights, no expanding ring effects.
//
// Every static layer is built ONCE per view size (a step generator run ~6 ms per frame; layers fade in as they
// finish) at the hi-res factor into an offscreen canvas with a `.hi` twin, so a frame is a few big drawImage calls
// plus a few hundred tiny particles (no per-frame allocations).
//   drawLabRoom(ctx, v, t, cam, kind)   v = view rect, cam = {x, y, z} (pan in screen px, zoom delta) for parallax
//                                       (omitted: a slow idle drift), kind 'tree' | 'rods' | 'boats'
//   labRoomScene(v, kind) -> {wl, orbit}  Boats: the orbit line (view-relative): wl = its y at the centre,
//                                       orbit(x) = its y at view-relative x
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { HI } from '../gfx/hires.js';
import { RNG } from '../core/rng.js';
import { clamp, hash1, hash2, hash3, fbm2, TAU, bayer } from '../core/math.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const BUDGET = 6; // ms of scene building per frame
const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

// ------------------------------------------------------------------ palette (glossy aero night)
const SKY = [[0, [10, 16, 52]], [0.3, [17, 26, 86]], [0.62, [30, 34, 112]], [0.85, [46, 36, 128]], [1, [62, 40, 140]]];
const NEB_A = [null, [62, 30, 134, 0.36], [102, 44, 172, 0.5], [162, 62, 202, 0.6], [230, 102, 214, 0.72], [255, 178, 234, 0.86]]; // violet -> pink
const NEB_B = [null, [14, 50, 146, 0.34], [14, 84, 196, 0.48], [18, 132, 226, 0.58], [36, 186, 244, 0.7], [130, 232, 255, 0.84]]; // aqua
const NEB_M = [null, [56, 50, 162, 0.38], [92, 84, 216, 0.52], [136, 126, 246, 0.62], [188, 168, 255, 0.74], [232, 214, 255, 0.86]]; // periwinkle
const STAR_COLS = [[236, 248, 255], [176, 236, 255], [255, 206, 238], [255, 240, 186], [214, 200, 255]];
const TINTS = [[176, 240, 255], [255, 168, 228], [255, 228, 150], [204, 184, 255]];

// ------------------------------------------------------------------ pixel art buffer (device px), logical twin
// Art(w, h): w x h logical px; px() paints one art pixel (HI x HI device px), dot() one device px.
class Art {
  constructor(w, h) {
    this.w = Math.max(1, Math.round(w)); this.h = Math.max(1, Math.round(h));
    this.W = this.w * HI; this.H = this.h * HI;
    this.img = new ImageData(this.W, this.H); this.d = this.img.data;
  }
  dot(X, Y, c, a = 1) {
    X |= 0; Y |= 0;
    if (X < 0 || Y < 0 || X >= this.W || Y >= this.H || a <= 0.004) return;
    const d = this.d, i = (Y * this.W + X) * 4;
    if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; return; }
    const da = d[i + 3] / 255, oa = a + da * (1 - a), k = a / oa;
    d[i] = c[0] * k + d[i] * (1 - k); d[i + 1] = c[1] * k + d[i + 1] * (1 - k); d[i + 2] = c[2] * k + d[i + 2] * (1 - k);
    d[i + 3] = oa * 255;
  }
  px(x, y, c, a = 1) {
    x = Math.floor(x); y = Math.floor(y);
    for (let j = 0; j < HI; j++) for (let i = 0; i < HI; i++) this.dot(x * HI + i, y * HI + j, c, a);
  }
  canvas() {
    const hc = makeCanvas(this.W, this.H);
    ctxOf(hc).putImageData(this.img, 0, 0);
    return twin(hc);
  }
}
function twin(hc) {
  const c = makeCanvas(hc.width / HI, hc.height / HI);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(hc, 0, 0, c.width, c.height);
  Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  return c;
}

// 3D value noise (seamless planet textures)
const sm = (t) => t * t * (3 - 2 * t);
function noise3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz);
  const L = (a, b, k) => a + (b - a) * k;
  const h = (i, j, k) => hash3(ix + i, iy + j, iz + k, s);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), fx), L(h(0, 1, 0), h(1, 1, 0), fx), fy), L(L(h(0, 0, 1), h(1, 0, 1), fx), L(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
function fbm3(x, y, z, o, s) {
  let v = 0, a = 0.5, n = 0, f = 1;
  for (let i = 0; i < o; i++) { v += noise3(x * f, y * f, z * f, s + i * 13) * a; n += a; a *= 0.5; f *= 2; }
  return v / n;
}

// ------------------------------------------------------------------ planet shading (stepped, dithered terminator)
const LIGHT = (() => { const l = [-0.56, -0.62, 0.55], m = Math.hypot(...l); return l.map((v) => v / m); })();
const SHADE_K = [0.34, 0.52, 0.72, 0.92, 1.1];
const NIGHT = [36, 26, 104];
function shadeCol(c, nx, ny, nz, x, y, out) {
  const diff = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  const lvl = clamp(Math.floor(diff * 3.4 + 1.5 + (bayer(x, y) - 0.5) * 0.9), 0, 4);
  const k = SHADE_K[lvl], nm = lvl < 2 ? 0.45 - lvl * 0.2 : 0;
  for (let i = 0; i < 3; i++) out[i] = clamp(c[i] * k * (1 - nm) + NIGHT[i] * nm + (lvl === 4 ? 14 : 0), 0, 255);
  return lvl;
}
// glossy Frutiger highlight: a crisp pixel crescent near the top-left of a sphere of radius r
function gloss(A, cx, cy, r, ox = 0, oy = 0) {
  const hx = -0.42 * r, hy = -0.46 * r, ax = 0.34 * r, ay = 0.17 * r, ca = Math.cos(-0.7), sa = Math.sin(-0.7);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const px = x + 0.5, py = y + 0.5;
    if (px * px + py * py > (r - 1.2) * (r - 1.2)) continue;
    const u = (px - hx) * ca - (py - hy) * sa, v = (px - hx) * sa + (py - hy) * ca;
    const e = (u / ax) ** 2 + (v / ay) ** 2;
    if (e < 1) A.px(cx + x + ox, cy + y + oy, [255, 255, 255], e < 0.35 ? 0.62 : 0.34);
  }
}
const inDisc = (x, y, r) => (x + 0.5) ** 2 + (y + 0.5) ** 2 <= r * r;

// ------------------------------------------------------------------ sprite cache (size independent)
const SPR = new Map();
function cached(key, make) { let s = SPR.get(key); if (!s) { s = make(); SPR.set(key, s); } return s; }

// sparkle sprites, authored in device px on an odd N x N grid; kind 0 = tiny plus .. 3 = big 4-point glint
const SPARK_N = [3, 7, 11, 21];
function sparkShape(kind, ax, ay) { // -> [white?, alpha] at |dx|, |dy| device px from the centre
  const d = ax + ay, on = ax === 0 || ay === 0, m = Math.max(ax, ay);
  if (kind === 0) return d === 0 ? [1, 1] : d === 1 ? [0, 0.75] : null;
  if (kind === 1) {
    if (d === 0) return [1, 1];
    if (on) return m === 1 ? [1, 0.95] : m === 2 ? [0, 0.8] : m === 3 ? [0, 0.35] : null;
    return ax === 1 && ay === 1 ? [0, 0.4] : null;
  }
  if (kind === 2) {
    if (d === 0) return [1, 1];
    if (on) return m <= 2 ? [1, 1] : m === 3 ? [0, 0.9] : m === 4 ? [0, 0.55] : m === 5 ? [0, 0.25] : null;
    if (ax === 1 && ay === 1) return [1, 0.6];
    if (ax === 2 && ay === 2) return [0, 0.3];
    return null;
  }
  // big glint: long tapered axis arms (3 px thick near the core), short diagonals
  const mn = Math.min(ax, ay);
  if (mn === 0) return m <= 2 ? [1, 1] : m <= 5 ? [0, 0.95] : m <= 7 ? [0, 0.6] : m <= 10 ? [0, 0.26] : null;
  if (mn === 1) return m === 1 ? [1, 0.95] : m <= 3 ? [1, 0.7] : m <= 5 ? [0, 0.38] : null;
  if (ax === 2 && ay === 2) return [0, 0.6];
  if (ax === 3 && ay === 3) return [0, 0.28];
  return null;
}
function sparkSprite(kind, ti) {
  return cached('spark|' + kind + '|' + ti, () => {
    const N = SPARK_N[kind], D = N + 1, c0 = (N - 1) / 2, tint = TINTS[ti];
    const hc = makeCanvas(D, D), g = ctxOf(hc), img = g.createImageData(D, D), d = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const s = sparkShape(kind, Math.abs(x - c0), Math.abs(y - c0));
      if (!s) continue;
      const c = s[0] ? [255, 255, 255] : tint, i = (y * D + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.round(s[1] * 255);
    }
    g.putImageData(img, 0, 0);
    const c = twin(hc);
    c.o = c0 / HI; // logical offset of the centre
    return c;
  });
}

// the rotating ocean planet: an equirectangular texture (seamless 3D noise) sampled per frame
const OCEAN = { deep: [28, 92, 204], sea: [44, 140, 236], shal: [96, 214, 244], sand: [246, 230, 168], grass: [112, 214, 102], wood: [46, 160, 96], ice: [236, 248, 255] };
function oceanTex() {
  return cached('otex', () => {
    const TW = 160, TH = 80, land = new Uint8Array(TW * TH), cloud = new Uint8Array(TW * TH);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const lon = (i / TW) * TAU, lat = (j / TH - 0.5) * Math.PI;
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const n = fbm3(x * 2.1 + 5, y * 2.1, z * 2.1, 4, 31);
      const ice = Math.abs(lat) > 1.18 + (fbm3(x * 4, y * 4, z * 4, 2, 9) - 0.5) * 0.3;
      land[j * TW + i] = ice ? 6 : n > 0.69 ? 5 : n > 0.645 ? 4 : n > 0.625 ? 3 : n > 0.585 ? 2 : n > 0.43 ? 1 : 0;
      const cn = fbm3(x * 2.6 + 1, y * 5.2, z * 2.6, 4, 77);
      cloud[j * TW + i] = cn > 0.64 ? 2 : cn > 0.6 ? 1 : 0;
    }
    return { TW, TH, land, cloud };
  });
}
const OCEAN_IDX = ['deep', 'sea', 'shal', 'sand', 'grass', 'wood', 'ice'];
function oceanFrame(r, f, NF) {
  const T = oceanTex(), pad = 2, D = r * 2 + pad * 2, A = new Art(D, D), c = r + pad, out = [0, 0, 0];
  const rot = (f / NF) * TAU, crot = rot * 2;
  for (let y = -r; y < r; y++) for (let x = -r; x < r; x++) {
    if (!inDisc(x, y, r)) continue;
    const nx = (x + 0.5) / r, ny = (y + 0.5) / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const lat = Math.asin(clamp(ny, -1, 1)), lon = Math.atan2(nx, nz);
    const tj = clamp(Math.floor((lat / Math.PI + 0.5) * T.TH), 0, T.TH - 1);
    const ti = (((Math.floor(((lon + rot) / TAU) * T.TW) % T.TW) + T.TW) % T.TW);
    const tc = (((Math.floor(((lon + crot) / TAU) * T.TW) % T.TW) + T.TW) % T.TW);
    let col = OCEAN[OCEAN_IDX[T.land[tj * T.TW + ti]]];
    const cl = T.cloud[tj * T.TW + tc];
    if (cl === 2 || (cl === 1 && bayer(x + 64, y + 64) < 0.5)) col = [246, 252, 255];
    const lvl = shadeCol(col, nx, ny, nz, x + 64, y + 64, out);
    A.px(c + x, c + y, out);
    // rim: aqua atmosphere on the lit side, a pink back-light on the night side
    if (!inDisc(x, y, r - 1.1)) {
      if (lvl >= 2) A.px(c + x, c + y, [150, 244, 255], 0.75);
      else if (nx + ny > 0.3) A.px(c + x, c + y, [255, 140, 220], 0.55);
    }
  }
  // 1 px atmosphere halo outside the disc (lit side only)
  for (let y = -r - 1; y <= r; y++) for (let x = -r - 1; x <= r; x++) {
    if (inDisc(x, y, r) || !inDisc(x, y, r + 1)) continue;
    const k = -((x + 0.5) * LIGHT[0] + (y + 0.5) * LIGHT[1]) / r;
    if (k < -0.1) A.px(c + x, c + y, [110, 220, 255], 0.45);
  }
  gloss(A, c, c, r);
  const cv = A.canvas(); cv.o = c;
  return cv;
}
function ringedPlanet(r) {
  return cached('ringed|' + r, () => {
    const RO = r * 2.05, RI = r * 1.32, FL = 0.3, TILT = -0.32, pad = 2;
    const D = Math.ceil(RO * 2 + pad * 2), A = new Art(D, Math.ceil(r * 2 + pad * 2 + RO * 0.5)), cx = Math.floor(D / 2), cy = Math.floor(A.h / 2), out = [0, 0, 0];
    const BANDS = [[255, 186, 146], [255, 150, 186], [206, 162, 255], [255, 224, 186], [255, 168, 150], [190, 150, 240]];
    const RING = [[255, 236, 200, 0.9], [196, 236, 255, 0.85], null, [214, 186, 255, 0.85], [255, 206, 236, 0.75], [176, 150, 240, 0.6]];
    const ca = Math.cos(TILT), sa = Math.sin(TILT);
    const ringAt = (x, y) => {
      const px = x + 0.5, py = y + 0.5, u = px * ca + py * sa, v = -px * sa + py * ca;
      const rr = Math.hypot(u, v / FL);
      if (rr < RI || rr > RO) return null;
      const k = Math.floor(((rr - RI) / (RO - RI)) * RING.length);
      const rc = RING[clamp(k, 0, RING.length - 1)];
      return rc ? { c: rc, front: v > 0, u } : null;
    };
    for (let y = -cy; y < A.h - cy; y++) for (let x = -cx; x < D - cx; x++) {
      const ring = ringAt(x, y), inP = inDisc(x, y, r);
      if (inP && !(ring && ring.front)) {
        const nx = (x + 0.5) / r, ny = (y + 0.5) / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        // bands follow the ring's tilt, wobbling a little
        const bl = (-nx * sa + ny * ca) * 3.1 + Math.sin(nx * 5 + ny * 3) * 0.12 + hash2(x, y, 4) * 0.08;
        const col = BANDS[((Math.floor(bl * 2 + 6) % BANDS.length) + BANDS.length) % BANDS.length];
        let lvl = shadeCol(col, nx, ny, nz, x + 64, y + 64, out);
        // the ring's shadow across the planet: a darker stripe just under the ring
        const sv = -(x + 0.5) * sa + (y + 0.5) * ca, su = (x + 0.5) * ca + (y + 0.5) * sa;
        const sr = Math.hypot(su, (sv - r * 0.22) / FL);
        if (sv > 0 && sr > RI && sr < RO && lvl > 0) { shadeCol(col, nx, ny, nz * 0.2 - 0.3, x + 64, y + 64, out); lvl = 1; }
        A.px(cx + x, cy + y, out);
        if (!inDisc(x, y, r - 1.1)) {
          if (lvl >= 2) A.px(cx + x, cy + y, [255, 236, 214], 0.6);
          else if (nx + ny > 0.3) A.px(cx + x, cy + y, [150, 236, 255], 0.5);
        }
      } else if (ring) {
        // ring brightness: lit on the left, dimmer on the right; the planet shades the far right of the back half
        const lit = ring.u < r * 0.4 ? 1 : 0.72;
        const shadow = !ring.front && ring.u > 0 && Math.abs(-(x + 0.5) * sa + (y + 0.5) * ca) < r * 0.9 && ring.u < r * 1.6;
        const k = shadow ? 0.45 : lit;
        A.px(cx + x, cy + y, [ring.c[0] * k, ring.c[1] * k, ring.c[2] * k + (1 - k) * 60], ring.c[3]);
      }
    }
    gloss(A, cx, cy, r);
    const cv = A.canvas(); cv.ox = cx; cv.oy = cy;
    return cv;
  });
}
function moonSprite(r) {
  return cached('moon|' + r, () => {
    const D = r * 2 + 2, A = new Art(D, D), c = r + 1, out = [0, 0, 0];
    const craters = [[-0.3, -0.1, 0.32], [0.35, 0.3, 0.26], [0.1, -0.5, 0.18], [-0.2, 0.5, 0.2]];
    for (let y = -r; y < r; y++) for (let x = -r; x < r; x++) {
      if (!inDisc(x, y, r)) continue;
      const nx = (x + 0.5) / r, ny = (y + 0.5) / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      let col = [206, 202, 236];
      for (const [qx, qy, qr] of craters) { const d = Math.hypot(nx - qx, ny - qy); if (d < qr) col = d > qr * 0.6 ? [226, 224, 250] : [160, 152, 206]; }
      shadeCol(col, nx, ny, nz, x + 64, y + 64, out);
      A.px(c + x, c + y, out);
    }
    A.px(c - Math.round(r * 0.45), c - Math.round(r * 0.5), [255, 255, 255], 0.8);
    const cv = A.canvas(); cv.o = c;
    return cv;
  });
}
function smallPlanet(r, cols, seed) {
  return cached('sp|' + r + '|' + seed, () => {
    const D = r * 2 + 2, A = new Art(D, D), c = r + 1, out = [0, 0, 0];
    for (let y = -r; y < r; y++) for (let x = -r; x < r; x++) {
      if (!inDisc(x, y, r)) continue;
      const nx = (x + 0.5) / r, ny = (y + 0.5) / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const n = fbm3(nx * 2 + seed, ny * 2, nz * 2, 3, seed);
      shadeCol(cols[n > 0.55 ? 1 : 0], nx, ny, nz, x + 64, y + 64, out);
      A.px(c + x, c + y, out);
    }
    if (r >= 5) gloss(A, c, c, r);
    const cv = A.canvas(); cv.o = c;
    return cv;
  });
}

// a cute space whale (2 tail frames), pixel art built from a body profile: dark indigo with a glossy top rim,
// a pale belly with grooves, a little fin, an eye and a few glitter freckles
function whaleSprite(fr) {
  return cached('whale|' + fr, () => {
    const W = 60, H = 28, A = new Art(W, H), M = new Uint8Array(W * H), cy = 13, L = 41;
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) M[y * W + x] = v; };
    for (let x = 1; x < L; x++) {
      const u = x / L;
      // a big round head tapering into the tail stalk; the belly sags a little
      const top = Math.max(1.4, 9 * (u < 0.27 ? Math.sqrt(Math.max(0, 1 - ((0.27 - u) / 0.28) ** 2)) : Math.pow(1 - (u - 0.27) / 0.73, 0.85)));
      const bot = Math.max(1, 7 * (u < 0.22 ? Math.sqrt(Math.max(0, 1 - ((0.22 - u) / 0.23) ** 2)) : Math.pow(1 - (u - 0.22) / 0.78, 1.05)));
      for (let y = Math.round(cy - top); y <= Math.round(cy + bot); y++) set(x, y, y > cy + bot * 0.2 ? 2 : 1);
    }
    for (let x = L; x < L + 5; x++) for (let y = cy - 1; y <= cy + (x < L + 2 ? 1 : 0); y++) set(x, y, 1); // tail stalk
    const lift = fr ? -2 : 1; // the fluke flaps
    for (let i = 0; i < 11; i++) {
      const x = L + 4 + i, up = Math.round(cy - 1 + lift - i * 0.62 - (i > 6 ? (i - 6) * 0.5 : 0)), dn = Math.round(cy + lift * 0.5 + i * 0.5);
      for (let y = up; y <= Math.min(dn, up + 3 + (i < 4 ? 2 : 0)); y++) set(x, y, 1);
      if (i > 3) for (let y = dn - 1; y <= dn; y++) set(x, y, 1);
    }
    for (const [dy, a, b] of [[0, 0, 4], [1, 1, 5], [2, 2, 6], [3, 4, 7], [4, 6, 8]]) for (let x = 13 + a; x <= 13 + b; x++) set(x, cy + 5 + dy, 3); // flipper
    const COL = { 1: [44, 42, 122], 2: [92, 104, 196], 3: [64, 62, 156] };
    const OUT = [22, 18, 70];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = M[y * W + x];
      if (!v) {
        const nb = (x > 0 && M[y * W + x - 1]) || (x < W - 1 && M[y * W + x + 1]) || (y > 0 && M[(y - 1) * W + x]) || (y < H - 1 && M[(y + 1) * W + x]);
        if (nb) A.px(x, y, OUT, 0.9);
        continue;
      }
      let c = COL[v];
      const above = y > 0 && M[(y - 1) * W + x];
      if (v === 1 && !above) c = [120, 140, 236]; // glossy top rim
      else if (v === 1 && y > 0 && !(y > 1 && M[(y - 2) * W + x])) c = [72, 76, 170];
      if (v === 2 && (y + Math.floor(x / 3)) % 3 === 0 && x > 6 && x < L - 8) c = [70, 80, 172]; // belly grooves
      A.px(x, y, c);
    }
    for (let x = 2; x < 11; x++) A.px(x, cy + 1 + (x > 7 ? 1 : 0), [34, 30, 96]); // smile
    A.px(7, cy - 2, [30, 24, 80]); A.px(8, cy - 2, [30, 24, 80]); A.px(7, cy - 1, [30, 24, 80]); A.px(8, cy - 1, [30, 24, 80]); // eye
    A.dot(7 * HI, (cy - 2) * HI, [240, 252, 255]); A.dot(7 * HI + 1, (cy - 2) * HI, [240, 252, 255]);
    A.px(9, cy + 3, [255, 150, 210], 0.75); A.px(10, cy + 3, [255, 150, 210], 0.5); // blush
    for (const [x, y] of [[18, cy - 5], [24, cy - 6], [30, cy - 4], [14, cy - 6], [27, cy - 1], [20, cy - 2], [34, cy - 2]]) A.dot(x * HI + 1, y * HI, [190, 240, 255], 0.95);
    return A.canvas();
  });
}

// ------------------------------------------------------------------ scene geometry (shared with labRoomScene)
function boatsGeo(w, h) {
  const limb = Math.round(h * 0.82), R = w * 1.5, cx = w / 2, cy = limb + R, wl = Math.round(h * 0.58), RO = cy - wl;
  return { limb, R, cx, cy, wl, RO, orbit: (x) => cy - Math.sqrt(Math.max(0, RO * RO - (x - cx) * (x - cx))) };
}
// how "edge" a point is: 0 in the calm middle (where the tree / tiles / boats live), 1 at the bright edges
function edgeOf(S, x, y) {
  const { w, h } = S;
  if (S.boats) {
    const band = Math.abs(y - h * 0.47) / (h * 0.26);
    return clamp(Math.max(sstep(0.55, 1.2, band) * (y < h * 0.47 ? 1 : 0.4), sstep(0.3, 0.5, Math.abs(x / w - 0.5)) * 0.8), 0, 1);
  }
  const ex = (x - w / 2) / (w * 0.4), ey = (y - h * 0.48) / (h * 0.5);
  return sstep(0.45, 1.25, Math.sqrt(ex * ex + ey * ey));
}

// ------------------------------------------------------------------ the scene
const scenes = new Map();
function sceneFor(w, h, kind) {
  const v = kind === 'boats' || kind === 'rods' ? kind : 'tree';
  const key = w + '|' + h + '|' + v;
  let S = scenes.get(key);
  if (!S) {
    S = makeScene(w, h, v);
    scenes.set(key, S);
    if (scenes.size > 3) scenes.delete(scenes.keys().next().value);
  }
  return S;
}

// layer paddings (logical px) = the parallax room on each side; parallax rates
const PAD = { far: 18, neb: 30, mid: 44, near: 70 };
const PAR = { far: 0.018, neb: 0.034, mid: 0.06, near: 0.1 };

function makeScene(w, h, kind) {
  const boats = kind === 'boats';
  const S = {
    w, h, kind, boats, L: {}, ready: {}, done: false, gen: null, bg: null,
    tw: [], dust: null, ocean: null, moon: null, whale: null, orbit: null,
    off: { far: { x: 0, y: 0 }, neb: { x: 0, y: 0 }, mid: { x: 0, y: 0 }, near: { x: 0, y: 0 }, dust: { x: 0, y: 0 } },
  };
  if (boats) S.geo = boatsGeo(w, h);
  S.lay = layout(S);
  S.gen = buildScene(S);
  return S;
}

// where things go (view-relative logical px)
function layout(S) {
  const { w, h, boats } = S;
  const pr = Math.round(clamp(h * 0.072, 18, 32)), po = Math.round(clamp(h * 0.056, 14, 26));
  if (boats) return {
    galaxy: [w * 0.1, h * 0.15], ringed: [w * 0.87, h * 0.19, Math.round(pr * 0.85)], ocean: null,
    tiny: [w * 0.24, h * 0.36, 4], comet: [w * 0.6, h * 0.1], fish: [w * 0.38, h * 0.13, 0.8],
    whaleY: h * 0.3,
    neb: [[0.08, 0.1, 0.32, 0.34, 'A'], [0.86, 0.06, 0.3, 0.3, 'B'], [0.5, 0.0, 0.3, 0.16, 'A'], [0.98, 0.5, 0.18, 0.3, 'A'], [0.02, 0.56, 0.16, 0.3, 'B']],
  };
  // Rods: the rod grid fills the top-left, so the planets gather in the free bottom-right
  if (S.kind === 'rods') return {
    galaxy: [w * 0.68, h * 0.73], ringed: [w * 0.57, h * 0.87, Math.round(pr * 0.8)], ocean: [w * 0.885, h * 0.74, po],
    tiny: [w * 0.97, h * 0.5, 4], comet: [w * 0.8, h * 0.06], fish: [w * 0.78, h * 0.9, 0.75],
    whaleY: h * 0.95,
    neb: [[0.04, 0.9, 0.3, 0.3, 'A'], [0.5, 1.02, 0.3, 0.16, 'A'], [0.96, 0.95, 0.3, 0.3, 'B'], [0.98, 0.3, 0.16, 0.3, 'B'], [0.3, -0.02, 0.3, 0.14, 'A'], [0.8, -0.02, 0.24, 0.14, 'B']],
  };
  return {
    galaxy: [w * 0.12, h * 0.18], ringed: [w * 0.065, h * 0.78, pr], ocean: [w * 0.925, h * 0.27, po],
    tiny: [w * 0.79, h * 0.9, 5], comet: [w * 0.78, h * 0.06], fish: [w * 0.875, h * 0.68, 1],
    whaleY: h * 0.9,
    neb: [[0.06, 0.82, 0.3, 0.36, 'A'], [0.1, 0.12, 0.24, 0.26, 'A'], [0.84, 0.0, 0.24, 0.2, 'B'], [0.94, 0.8, 0.26, 0.3, 'B'], [1.02, 0.42, 0.1, 0.2, 'B'], [0.5, 1.02, 0.34, 0.14, 'A'], [0.5, -0.04, 0.3, 0.12, 'B']],
  };
}

// the sky: posterised, Bayer-dithered gradient + soft glow pools at the edges, darker / calmer in the middle
function* skySteps(S) {
  const { w, h } = S, A = new Art(w, h);
  const pools = S.boats
    ? [[0.08, 0.12, 0.36, 0.42, [70, 30, 120]], [0.9, 0.1, 0.34, 0.4, [10, 70, 120]], [0.5, 0.78, 0.6, 0.22, [20, 80, 150]]]
    : [[0.04, 0.86, 0.4, 0.5, [80, 30, 120]], [0.96, 0.14, 0.36, 0.44, [12, 74, 128]], [0.08, 0.1, 0.3, 0.3, [50, 24, 100]], [0.96, 0.9, 0.3, 0.36, [20, 60, 120]]];
  const sky = new Float32Array(3);
  const Q = 6;
  for (let y = 0; y < h; y++) {
    const k = y / h;
    for (let i = 1; i < SKY.length; i++) if (k <= SKY[i][0] || i === SKY.length - 1) {
      const [a, ca] = SKY[i - 1], [b, cb] = SKY[i], q = clamp((k - a) / (b - a), 0, 1);
      for (let c = 0; c < 3; c++) sky[c] = ca[c] + (cb[c] - ca[c]) * q;
      break;
    }
    for (let x = 0; x < w; x++) {
      let r = sky[0], g = sky[1], b = sky[2];
      for (const [px, py, rx, ry, col] of pools) {
        const dx = (x / w - px) / rx, dy = (y / h - py) / ry, d = 1 - (dx * dx + dy * dy);
        if (d > 0) { const f = d * d; r += col[0] * f; g += col[1] * f; b += col[2] * f; }
      }
      const calm = 1 - (1 - edgeOf(S, x, y)) * 0.22;
      const bd = bayer(x, y);
      const R = Math.floor((r * calm) / Q + bd) * Q, G = Math.floor((g * calm) / Q + bd) * Q, B = Math.floor((b * calm) / Q + bd) * Q;
      const c = [clamp(R, 0, 255), clamp(G, 0, 255), clamp(B, 0, 255)];
      A.px(x, y, c);
    }
    if ((y & 15) === 15) yield;
  }
  S.bg = A.canvas();
  S.ready.bg = -1;
}

// the far star field + a pixel spiral galaxy
function* farSteps(S, r) {
  const { w, h } = S, P = PAD.far, LW = w + P * 2, A = new Art(LW, h);
  const n = Math.round((LW * h) / 170);
  for (let i = 0; i < n; i++) {
    const x = r.float(0, LW), y = r.float(0, h), e = edgeOf(S, x - P, y);
    const c = STAR_COLS[r.int(0, STAR_COLS.length - 1)], a = r.float(0.35, 1) * (0.6 + 0.4 * e);
    if (r.chance(0.07)) { A.px(x, y, c, Math.min(1, a + 0.2)); }
    else A.dot(x * HI, y * HI, c, a);
    if ((i & 511) === 511) yield;
  }
  S.L.far = { c: A.canvas(), x: -P, y: 0 };
  S.ready.far = -1;
}

// a distant spiral galaxy: two arms splatted into a density grid, posterised into a cool -> warm ramp, bright core
function galaxy(A, gx, gy) {
  const GW = 110, GH = 64, G = new Float32Array(GW * GH), rr = new RNG(9);
  const tilt = -0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let i = 0; i < 2600; i++) {
    const arm = i & 1, tt = Math.pow(rr.next(), 0.75) * 3.3 * Math.PI, rad = 2 + tt * 3.1;
    const sc = (rr.next() + rr.next() + rr.next() - 1.5) * (1.1 + rad * 0.09);
    const th = tt + arm * Math.PI + sc * 0.06;
    let x = Math.cos(th) * (rad + sc), y = Math.sin(th) * (rad + sc) * 0.42;
    [x, y] = [x * ct - y * st, x * st + y * ct];
    const ix = Math.round(GW / 2 + x), iy = Math.round(GH / 2 + y);
    if (ix >= 0 && iy >= 0 && ix < GW && iy < GH) G[iy * GW + ix] += 1 / (1 + rad * 0.02);
  }
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const dx = (x - GW / 2) / 7, dy = (y - GH / 2) / 3.6;
    G[y * GW + x] += 9 * Math.exp(-(dx * dx + dy * dy));
  }
  const RAMP = [[60, 70, 180, 0.32], [96, 96, 214, 0.45], [150, 130, 240, 0.58], [214, 160, 250, 0.72], [255, 196, 236, 0.85], [255, 236, 214, 0.95], [255, 255, 244, 1]];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const v = G[y * GW + x];
    if (v < 0.25) continue;
    const lv = Math.log2(1 + v) * 1.55 + bayer(x, y) - 0.75;
    const k = Math.floor(clamp(lv, -1, RAMP.length - 1));
    if (k < 0) continue;
    const c = RAMP[k];
    A.px(gx - GW / 2 + x, gy - GH / 2 + y, c, c[3]);
  }
  for (let i = 0; i < 26; i++) {
    const x = gx + rr.float(-30, 30), y = gy + rr.float(-12, 12);
    A.dot(x * HI, y * HI, [255, 255, 255], rr.float(0.5, 1));
  }
}

// nebula clouds: domain-warped fbm on a coarse grid, bilinear per art pixel, posterised + Bayer dithered
function* nebSteps(S) {
  const { w, h } = S, P = PAD.neb, LW = w + P * 2, A = new Art(LW, h);
  const CS = 3, gw = Math.ceil(LW / CS) + 2, gh = Math.ceil(h / CS) + 2;
  const GA = new Float32Array(gw * gh), GB = new Float32Array(gw * gh), GL = new Float32Array(gw * gh);
  const regs = S.lay.neb;
  const sc = 1 / Math.max(260, Math.min(w, h * 1.6));
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const X = i * CS, Y = j * CS;
      const wx = X + (fbm2(X * 0.005, Y * 0.005, 3, 7) - 0.5) * 110, wy = Y + (fbm2(X * 0.005 + 9, Y * 0.005 + 3, 3, 8) - 0.5) * 70;
      const a = fbm2(wx * sc * 2.4, wy * sc * 3.4, 5, 11), b = fbm2(wx * sc * 2.6 + 20, wy * sc * 3.6, 5, 12);
      const dust = fbm2(wx * 0.022, wy * 0.034, 3, 13);
      let ra = 0, rb = 0;
      for (const [px, py, rx, ry, k] of regs) {
        const dx = ((X - P) / w - px) / rx, dy = (Y / h - py) / ry, d = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
        if (k === 'A') ra = Math.max(ra, d); else rb = Math.max(rb, d);
      }
      const e = edgeOf(S, X - P, Y), lane = Math.max(0, dust - 0.55) * 2.6;
      // ridged filaments add bright wisps inside the clouds
      const fil = Math.pow(1 - Math.abs(2 * fbm2(wx * 0.011, wy * 0.017, 4, 15) - 1), 5) * 0.42;
      const va = sstep(0.42, 0.84, a * 0.72 + ra * 0.56 + fil * ra) * (0.25 + 0.75 * e), vb = sstep(0.42, 0.84, b * 0.72 + rb * 0.56 + fil * rb) * (0.25 + 0.75 * e);
      GA[j * gw + i] = clamp(va - lane, 0, 1);
      GB[j * gw + i] = clamp(vb - lane, 0, 1);
      GL[j * gw + i] = Math.max(va, vb) > 0.25 ? clamp(lane * 1.4, 0, 1) : 0;
    }
    if ((j & 7) === 7) yield;
  }
  const smp = (G, x, y) => {
    const fx = x / CS, fy = y / CS, ix = Math.floor(fx), iy = Math.floor(fy), kx = fx - ix, ky = fy - iy, o = iy * gw + ix;
    return (G[o] * (1 - kx) + G[o + 1] * kx) * (1 - ky) + (G[o + gw] * (1 - kx) + G[o + gw + 1] * kx) * ky;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < LW; x++) {
      const da = smp(GA, x, y), db = smp(GB, x, y), dl = smp(GL, x, y), bd = bayer(x, y);
      // dark dust lanes cutting through the clouds
      if (dl > 0.12 && bd < dl * 1.6) A.px(x, y, [18, 10, 52], 0.42);
      if (da < 0.04 && db < 0.04) continue;
      const la = clamp(Math.floor(Math.pow(da, 1.25) * 5.4 + bd - 0.2), 0, 5), lb = clamp(Math.floor(Math.pow(db, 1.25) * 5.4 + bd - 0.2), 0, 5);
      if (!la && !lb) continue;
      let c = la >= 2 && lb >= 2 ? NEB_M[Math.min(5, Math.max(la, lb))] : la >= lb ? NEB_A[la] : NEB_B[lb];
      A.px(x, y, c, c[3]);
      // bright glitter specks in the dense parts
      if (Math.max(la, lb) >= 4 && hash2(x, y, 21) < 0.05) A.dot(x * HI + (hash2(x, y, 22) < 0.5 ? 0 : 1), y * HI, [255, 255, 255], 0.9);
    }
    if ((y & 7) === 7) yield;
  }
  galaxy(A, S.lay.galaxy[0] + P, S.lay.galaxy[1]);
  S.L.neb = { c: A.canvas(), x: -P, y: 0 };
  S.ready.neb = -1;
}

// brighter mid stars, the fish constellation and a comet; registers the twinkles / glints
function* midSteps(S, r) {
  const { w, h } = S, P = PAD.mid, LW = w + P * 2, A = new Art(LW, h);
  const n = Math.round((LW * h) / 1500);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r.float(0, LW)), y = Math.floor(r.float(0, h)), e = edgeOf(S, x - P, y);
    if (r.next() > 0.35 + 0.65 * e) continue;
    const c = STAR_COLS[r.int(0, STAR_COLS.length - 1)], a = r.float(0.55, 1);
    A.px(x, y, c, a);
    if (r.chance(0.18)) { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) A.px(x + dx, y + dy, c, a * 0.35); }
  }
  // a few little open star clusters toward the edges
  for (let i = 0; i < (S.boats ? 3 : 4); i++) {
    let cx, cy, k = 0;
    do { cx = r.float(0.04, 0.96) * w; cy = r.float(0.05, 0.95) * h; } while (edgeOf(S, cx, cy) < 0.75 && ++k < 30);
    for (let j = 0; j < 16; j++) {
      const a = r.float(0, TAU), d = Math.pow(r.next(), 1.6) * 16, x = Math.round(cx + Math.cos(a) * d + P), y = Math.round(cy + Math.sin(a) * d * 0.8);
      const c = STAR_COLS[r.int(0, 2)];
      if (j < 4) { A.px(x, y, [255, 255, 255]); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) A.px(x + dx, y + dy, c, 0.5); }
      else if (j < 9) A.px(x, y, c, 0.9);
      else A.dot(x * HI + (j & 1), y * HI, c, 0.9);
    }
    S.tw.push({ x: cx, y: cy, d: 'mid', big: 0, ti: i % 4, sp: 1.3, ph: i * 2, k: 2 });
  }
  yield;
  // twinkles (drawn animated on top; a dim base dot stays in the layer) and the big glints
  const nt = Math.round(clamp((w * h) / 2800, 60, 170));
  for (let i = 0; i < nt; i++) {
    let x = r.float(0, w), y = r.float(0, h);
    for (let k = 0; k < 4 && r.next() > 0.25 + 0.75 * edgeOf(S, x, y); k++) { x = r.float(0, w); y = r.float(0, h); }
    const far = i % 3 === 0;
    S.tw.push({ x, y, d: far ? 'far' : 'mid', big: 0, ti: r.int(0, 3), sp: r.float(0.5, 1.6), ph: r.float(0, TAU), k: far ? 1 : r.chance(0.4) ? 2 : 1 });
    if (!far) A.dot((x + P) * HI, y * HI, [220, 240, 255], 0.6);
  }
  const ng = S.boats ? 5 : 8;
  for (let i = 0; i < ng; i++) {
    let x, y, k = 0;
    do { x = r.float(0.03, 0.97) * w; y = r.float(0.04, 0.96) * h; } while (edgeOf(S, x, y) < 0.7 && ++k < 30);
    S.tw.push({ x, y, d: 'mid', big: 1, ti: i % 4, sp: r.float(0.35, 0.7), ph: r.float(0, TAU), k: 3 });
  }
  // the fish constellation (facing left): stars joined by faint dotted device-px lines
  {
    const [fx, fy, fs] = S.lay.fish, W = 92 * fs, H = 46 * fs;
    const pts = [[0, 0.52], [0.24, 0.14], [0.56, 0.08], [0.76, 0.42], [1, 0.06], [0.95, 0.94], [0.76, 0.6], [0.52, 0.94], [0.22, 0.86]];
    const P2 = pts.map(([u, v]) => [Math.round(fx - W / 2 + u * W) + P, Math.round(fy - H / 2 + v * H)]);
    const seg = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3], [6, 7], [7, 8], [8, 0], [2, 7]];
    for (const [a, b] of seg) {
      const [x0, y0] = P2[a], [x1, y1] = P2[b], L = Math.hypot(x1 - x0, y1 - y0) * HI;
      for (let s = 3; s < L - 3; s += 3) A.dot((x0 * HI + 1) + ((x1 - x0) * HI * s) / L, (y0 * HI + 1) + ((y1 - y0) * HI * s) / L, [150, 226, 255], 0.5);
    }
    P2.forEach(([x, y], i) => {
      A.px(x, y, [236, 250, 255]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) A.px(x + dx, y + dy, [160, 230, 255], 0.45);
      if (i % 2 === 0) S.tw.push({ x: x - P + 0.5, y: y + 0.5, d: 'mid', big: 0, ti: 0, sp: 0.9 + i * 0.13, ph: i * 1.7, k: 2 });
    });
    // its eye
    const ex = Math.round(fx - W / 2 + 0.17 * W) + P, ey = Math.round(fy - H / 2 + 0.42 * H);
    A.px(ex, ey, [255, 220, 150]);
  }
  yield;
  // a comet (tail up-right, falling down-left)
  {
    const [cx0, cy0] = S.lay.comet, hx = cx0 + P, hy = cy0, dir = [0.86, -0.5], nrm = [0.5, 0.86];
    for (let s = 0; s < 52; s++) {
      const wdt = 0.6 + s * 0.085, f = s / 52;
      for (let o = -Math.ceil(wdt); o <= Math.ceil(wdt); o++) {
        const x = Math.round(hx + dir[0] * s + nrm[0] * o), y = Math.round(hy + dir[1] * s + nrm[1] * o);
        const dens = (1 - f) * (1 - Math.abs(o) / (wdt + 1));
        if (dens < bayer(x, y) * 0.9 + 0.05) continue;
        const c = f < 0.12 ? [236, 252, 255] : f < 0.4 ? [130, 226, 255] : f < 0.7 ? [140, 150, 250] : [190, 130, 240];
        A.px(x, y, c, 0.35 + dens * 0.6);
      }
    }
    A.px(hx, hy, [255, 255, 255]); A.px(hx + 1, hy, [255, 255, 255]); A.px(hx, hy + 1, [255, 255, 255]); A.px(hx + 1, hy + 1, [220, 250, 255]);
    for (const [dx, dy] of [[-1, 0], [-1, 1], [0, 2], [1, 2], [0, -1], [2, 1]]) A.px(hx + dx, hy + dy, [150, 236, 255], 0.6);
    S.tw.push({ x: cx0 + 1, y: cy0 + 1, d: 'mid', big: 0, ti: 0, sp: 2.2, ph: 0, k: 2 });
  }
  S.L.mid = { c: A.canvas(), x: -P, y: 0 };
  S.ready.mid = -1;
}

// the near layer: the ringed planet, a tiny planet; Boats: the ocean planet's limb with its stepped atmosphere
function* nearSteps(S) {
  const { w, h } = S, P = PAD.near, LW = w + P * 2;
  const L = makeCanvas(LW * HI, h * HI), g = ctxOf(L);
  const put = (c, x, y, ox, oy) => g.drawImage(c.hi, Math.round((x + P - ox) * HI), Math.round((y - oy) * HI));
  const [rx, ry, rr] = S.lay.ringed;
  const rp = ringedPlanet(rr);
  yield;
  put(rp, rx, ry, rp.ox, rp.oy);
  const [tx, ty, trr] = S.lay.tiny, tp = smallPlanet(trr, [[255, 150, 196], [255, 214, 150]], 5);
  put(tp, tx, ty, tp.o, tp.o);
  yield;
  if (S.boats) {
    const { limb, R, cx, cy } = S.geo, A = new Art(LW, h - limb + 12), y0 = limb - 10, out = [0, 0, 0];
    for (let yy = 0; yy < A.h; yy++) {
      const Y = y0 + yy;
      for (let x = 0; x < LW; x++) {
        const X = x - P, dx = X + 0.5 - cx, dy = Y + 0.5 - cy, dist = Math.sqrt(dx * dx + dy * dy) - R;
        if (dist > 0) {
          // stepped, dithered atmosphere above the limb
          const bd = bayer(x, Y);
          if (dist < 1) A.px(x, yy, [200, 252, 255], 0.95);
          else if (dist < 2.5) A.px(x, yy, [120, 230, 255], 0.75);
          else if (dist < 4.5) A.px(x, yy, [70, 170, 250], 0.45);
          else if (dist < 8 && bd < 0.5) A.px(x, yy, [80, 130, 240], 0.32);
          else if (dist < 11 && bd < 0.25) A.px(x, yy, [90, 110, 230], 0.25);
          continue;
        }
        const nx = dx / R, ny = dy / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const s = -dist; // depth below the limb
        const v = Math.sqrt(2 * R * s), u = X;
        const n = fbm2(u * 0.02 + 3, v * 0.055, 5, 41), cl = fbm2(u * 0.016 + 40, v * 0.05 + u * 0.004, 4, 42);
        let col = n > 0.7 ? OCEAN.wood : n > 0.655 ? OCEAN.grass : n > 0.635 ? OCEAN.sand : n > 0.6 ? OCEAN.shal : n > 0.44 ? OCEAN.sea : OCEAN.deep;
        if (cl > 0.67 || (cl > 0.64 && bayer(x, Y) < 0.5)) col = [246, 252, 255];
        else if (cl > 0.62 && cl < 0.66 && n <= 0.6) col = [32, 104, 210]; // cloud shadow on the sea
        // haze toward the limb, light from the left, the far right turning toward night
        const lit = -nx * 1.5 + 0.3 * nz + 0.42;
        const lvl = clamp(Math.floor(lit * 3 + 1.6 + (bayer(x, Y) - 0.5) * 0.9), 0, 4);
        const k = SHADE_K[lvl];
        for (let i = 0; i < 3; i++) out[i] = clamp(col[i] * k + (lvl === 4 ? 12 : 0), 0, 255);
        const haze = s < 1.5 ? 0.7 : s < 3.5 ? 0.45 : s < 7 ? (bayer(x, Y) < 0.5 ? 0.3 : 0.15) : 0;
        if (haze) for (let i = 0; i < 3; i++) out[i] += ([170, 240, 255][i] - out[i]) * haze;
        A.px(x, yy, out);
      }
      if ((yy & 7) === 7) yield;
    }
    // little sparkling sea glints on the lit side
    const rr2 = new RNG(5);
    for (let i = 0; i < 40; i++) {
      const X = rr2.float(0, w * 0.6), Y = limb + rr2.float(6, h - limb), dx = X - cx, dy = Y - cy;
      if (Math.hypot(dx, dy) > R - 4) continue;
      A.dot((X + P) * HI, (Y - y0) * HI, [255, 255, 255], 0.8);
    }
    const cv = A.canvas();
    g.drawImage(cv.hi, 0, y0 * HI);
  }
  S.L.near = { c: twin(L), x: -P, y: 0 };
  S.ready.near = -1;
}

// the Boats' glowing orbit line (no parallax: the boats sit on it)
function orbitLine(S) {
  const { w, h } = S, { orbit } = S.geo, A = new Art(w, h);
  let py = orbit(0);
  for (let X = 0; X < w * HI; X++) {
    const x = (X + 0.5) / HI, y = orbit(x), Y = Math.round(y * HI);
    const y0 = Math.round(py * HI);
    // core 2 device px (plus fill between steps), stepped glow above / below
    for (let yy = Math.min(Y, y0); yy <= Math.max(Y, y0); yy++) { A.dot(X, yy, [226, 252, 255], 1); A.dot(X, yy + 1, [150, 236, 255], 1); }
    A.dot(X, Y - 1, [110, 220, 255], 0.55); A.dot(X, Y + 2, [110, 220, 255], 0.55);
    A.dot(X, Y - 2, [120, 150, 255], 0.3); A.dot(X, Y + 3, [120, 150, 255], 0.3);
    if (((X >> 1) & 3) === 0) { A.dot(X, Y - 3, [170, 140, 255], 0.22); A.dot(X, Y + 4, [170, 140, 255], 0.22); }
    py = y;
  }
  return A.canvas();
}

function* buildScene(S) {
  const r = new RNG(1977);
  yield* skySteps(S);
  yield* farSteps(S, r);
  yield* nebSteps(S);
  yield* midSteps(S, r);
  yield* nearSteps(S);
  // animated sprites
  if (S.lay.ocean) {
    const [, , po] = S.lay.ocean, NF = 96, fr = [];
    oceanTex();
    yield;
    for (let f = 0; f < NF; f++) { fr.push(cached('ocean|' + po + '|' + f, () => oceanFrame(po, f, NF))); if ((f & 7) === 7) yield; }
    S.ocean = fr;
  }
  S.moon = moonSprite(S.boats ? 5 : 6);
  S.whale = [whaleSprite(0), whaleSprite(1)];
  for (let k = 0; k < 4; k++) for (let ti = 0; ti < 4; ti++) sparkSprite(k, ti);
  yield;
  // stardust / glitter: drifting device-px specks (a few bigger), colours pre-baked as style strings per alpha step
  {
    const N = Math.round(clamp((S.w * S.h) / 1700, 90, 260));
    const D = { n: N, x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), ph: new Float32Array(N), sp: new Float32Array(N), c: new Uint8Array(N), big: new Uint8Array(N) };
    for (let i = 0; i < N; i++) {
      let x = r.float(0, S.w), y = r.float(0, S.h);
      for (let k = 0; k < 3 && r.next() > 0.3 + 0.7 * edgeOf(S, x, y); k++) { x = r.float(0, S.w); y = r.float(0, S.h); }
      D.x[i] = x; D.y[i] = y; D.vx[i] = r.float(-5, -1.5); D.vy[i] = r.float(-1.2, 1.2);
      D.ph[i] = r.float(0, TAU); D.sp[i] = r.float(1, 3.5); D.c[i] = r.int(0, 3); D.big[i] = r.chance(0.3) ? 1 : 0;
    }
    D.styles = TINTS.map((c) => [0.15, 0.35, 0.6, 0.9].map((a) => `rgba(${Math.round(c[0] + (255 - c[0]) * 0.4)},${Math.round(c[1] + (255 - c[1]) * 0.4)},${Math.round(c[2] + (255 - c[2]) * 0.4)},${a})`));
    S.dust = D;
  }
  // shooting-star trail styles (white head -> aqua -> violet)
  S.trail = [];
  for (let k = 0; k < 30; k++) {
    const f = k / 30, a = (1 - f) * (1 - f) * 0.95;
    const c = f < 0.15 ? [255, 255, 255] : f < 0.5 ? [150, 236, 255] : [176, 150, 255];
    S.trail.push(`rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`);
  }
  if (S.boats) {
    S.orbit = orbitLine(S);
    S.ready.orbit = -1;
  }
  S.done = true;
}

function stepScene(S) {
  if (S.done || !S.gen) return;
  const t0 = now();
  do {
    const r = S.gen.next();
    if (r.done) { S.done = true; S.gen = null; break; }
  } while (now() - t0 < BUDGET);
}

// ------------------------------------------------------------------ drawing
const snap = (v) => Math.round(v * 2) / 2;

export function drawLabRoom(ctx, v, t, cam, kind = 'tree') {
  const w = Math.round(v.w), h = Math.round(v.h);
  if (w < 8 || h < 8) return;
  const S = sceneFor(w, h, kind);
  stepScene(S);
  // parallax: pan in screen px -> softly clamped layer offsets; zoom pushes the near layers outward a touch
  const cx = cam ? cam.x || 0 : Math.sin(t * 0.06) * 240, cy = cam ? cam.y || 0 : Math.sin(t * 0.045) * 70, cz = cam ? cam.z || 0 : 0;
  for (const name in PAD) {
    const P = PAD[name], f = PAR[name], o = S.off[name];
    o.x = P * 0.92 * Math.tanh((-cx * f) / P);
    o.y = 8 * Math.tanh((-cy * f * 0.5) / 8) + cz * f * 30;
  }
  S.off.dust.x = S.off.near.x * 1.4; S.off.dust.y = S.off.near.y * 1.4;
  const x0 = v.x, y0 = v.y;
  const fade = (name) => {
    if (S.ready[name] === undefined) return 0;
    if (S.ready[name] < 0) S.ready[name] = t;
    return clamp((t - S.ready[name]) / 0.5, 0, 1);
  };
  const ga = ctx.globalAlpha;
  const lay = (name) => {
    const Lr = S.L[name];
    if (!Lr) return 0;
    const a = fade(name);
    if (a <= 0) return 0;
    const o = S.off[name];
    ctx.globalAlpha = ga * a;
    ctx.drawImage(Lr.c, snap(x0 + Lr.x + o.x), snap(y0 + Lr.y + o.y));
    ctx.globalAlpha = ga;
    return a;
  };

  ctx.fillStyle = '#121a52'; ctx.fillRect(x0, y0, w, h);
  if (S.bg) { const a = fade('bg'); ctx.globalAlpha = ga * a; ctx.drawImage(S.bg, x0, y0); ctx.globalAlpha = ga; }
  const aFar = lay('far');
  if (aFar) drawTwinkles(ctx, S, t, x0, y0, 'far', aFar * ga);
  if (S.whale && aFar) drawWhale(ctx, S, t, x0, y0, aFar * ga);
  const aNeb = lay('neb');
  if (aNeb && S.trail) drawShooting(ctx, S, t, x0, y0, aNeb * ga);
  const aMid = lay('mid');
  if (aMid) drawTwinkles(ctx, S, t, x0, y0, 'mid', aMid * ga);
  const aNear = lay('near');
  if (aNear) drawPlanets(ctx, S, t, x0, y0, aNear * ga);
  if (S.dust && aNear) drawDust(ctx, S, t, x0, y0, aNear * ga);
  if (S.orbit) {
    const a = fade('orbit');
    ctx.globalAlpha = ga * a; ctx.drawImage(S.orbit, x0, y0);
    drawPulses(ctx, S, t, x0, y0, ga * a);
  }
  ctx.globalAlpha = ga;
}

function drawTwinkles(ctx, S, t, x0, y0, d, a0) {
  const o = S.off[d];
  for (let i = 0; i < S.tw.length; i++) {
    const T = S.tw[i];
    if (T.d !== d) continue;
    const q = 0.5 + 0.5 * Math.sin(t * T.sp + T.ph);
    let k;
    if (T.big) k = q < 0.3 ? 1 : q < 0.6 ? 2 : 3;
    else { if (q < 0.4) continue; k = Math.min(T.k, q < 0.65 ? 0 : q < 0.88 ? 1 : 2); }
    const sp = sparkSprite(k, T.ti);
    ctx.globalAlpha = a0 * (T.big ? 0.85 + q * 0.15 : 0.55 + q * 0.45);
    ctx.drawImage(sp, snap(x0 + T.x + o.x - sp.o), snap(y0 + T.y + o.y - sp.o));
  }
  ctx.globalAlpha = a0;
}

function drawWhale(ctx, S, t, x0, y0, a0) {
  const o = S.off.neb, span = S.w + 200;
  const x = span - ((t * 5 + 40) % span) - 100, y = S.lay.whaleY + Math.sin(t * 0.4) * 3 - 13;
  const fr = S.whale[Math.floor(t * 1.4) & 1];
  ctx.globalAlpha = a0 * 0.9;
  ctx.drawImage(fr, snap(x0 + x + o.x), snap(y0 + y + o.y));
  // glitter trail behind the tail
  ctx.fillStyle = '#bff4ff';
  for (let i = 0; i < 6; i++) {
    const q = (t * 0.7 + i / 6) % 1;
    ctx.globalAlpha = a0 * (1 - q) * 0.8;
    ctx.fillRect(snap(x0 + x + o.x + 58 + q * 26), snap(y0 + y + o.y + 12 + Math.sin(q * 7 + i) * 2), 0.5, 0.5);
  }
  ctx.globalAlpha = a0;
}

// shooting stars: each slot fires once per period at a hashed spot, a 2:1 stair-step pixel trail
const SHOOT = [[6.7, 0], [9.3, 1], [13.1, 2]];
function drawShooting(ctx, S, t, x0, y0, a0) {
  const o = S.off.neb, w = S.w, h = S.h;
  for (const [per, s] of SHOOT) {
    const n = Math.floor((t + s * 2.3) / per), q = (t + s * 2.3) - n * per, life = 1.15;
    if (q > life) continue;
    const sx = (0.15 + hash1(n, 40 + s) * 0.95) * w, sy = (hash1(n, 50 + s) * 0.45 - 0.05) * h, dir = hash1(n, 60 + s) < 0.7 ? -1 : 1;
    const dist = q * 300, hx = Math.round(sx + dir * dist), hy = Math.round(sy + dist * 0.5);
    const fa = q < 0.12 ? q / 0.12 : q > life - 0.3 ? (life - q) / 0.3 : 1;
    ctx.globalAlpha = a0 * fa;
    const len = Math.min(S.trail.length, Math.floor(dist / 2)), bx = snap(x0 + o.x), by = snap(y0 + o.y);
    for (let k = len - 1; k >= 0; k--) {
      ctx.fillStyle = S.trail[k];
      ctx.fillRect(bx + hx - dir * (k * 2) - (dir < 0 ? 0 : 1), by + hy - k, 2, 1);
    }
    const sp = sparkSprite(1, 0);
    ctx.drawImage(sp, snap(x0 + o.x + hx + 0.5 - sp.o), snap(y0 + o.y + hy + 0.5 - sp.o));
  }
  ctx.globalAlpha = a0;
}

function drawPlanets(ctx, S, t, x0, y0, a0) {
  const o = S.off.near;
  ctx.globalAlpha = a0;
  const [cx, cy, r0] = S.ocean ? S.lay.ocean : S.lay.ringed, r = S.ocean ? r0 : r0 * 1.5;
  const ang = t * 0.22, mx = cx + Math.cos(ang) * r * 1.75, my = cy + Math.sin(ang) * r * 0.42 - r * 0.15;
  const behind = Math.sin(ang) < 0;
  if (!S.ocean && behind && Math.hypot(mx - cx, my - cy) < r0 + 7) return; // hidden behind the ringed planet
  const moon = () => { if (S.moon) ctx.drawImage(S.moon, snap(x0 + o.x + Math.round(mx) - S.moon.o), snap(y0 + o.y + Math.round(my) - S.moon.o)); };
  if (behind) moon();
  if (S.ocean) {
    const f = S.ocean[Math.floor(t * 1.6) % S.ocean.length];
    ctx.drawImage(f, snap(x0 + o.x + Math.round(cx) - f.o), snap(y0 + o.y + Math.round(cy) - f.o));
  }
  if (!behind) moon();
}

function drawDust(ctx, S, t, x0, y0, a0) {
  const D = S.dust, o = S.off.dust, W = S.w + 16, H = S.h + 16;
  ctx.globalAlpha = a0;
  for (let i = 0; i < D.n; i++) {
    const q = 0.5 + 0.5 * Math.sin(t * D.sp[i] + D.ph[i]);
    const lv = q < 0.25 ? 0 : q < 0.55 ? 1 : q < 0.85 ? 2 : 3;
    const x = ((((D.x[i] + D.vx[i] * t + o.x) % W) + W) % W) - 8, y = ((((D.y[i] + D.vy[i] * t + Math.sin(t * 0.3 + D.ph[i]) * 4 + o.y) % H) + H) % H) - 8;
    ctx.fillStyle = D.styles[D.c[i]][lv];
    const sx = snap(x0 + x), sy = snap(y0 + y);
    if (D.big[i] && lv >= 2) { // a tiny device-px plus
      ctx.fillRect(sx - 0.5, sy, 1.5, 0.5); ctx.fillRect(sx, sy - 0.5, 0.5, 1.5);
      if (lv === 3) { ctx.fillRect(sx - 1, sy, 0.5, 0.5); ctx.fillRect(sx + 1, sy, 0.5, 0.5); ctx.fillRect(sx, sy - 1, 0.5, 0.5); ctx.fillRect(sx, sy + 1, 0.5, 0.5); }
    } else ctx.fillRect(sx, sy, 0.5, 0.5);
  }
  ctx.globalAlpha = a0;
}

// light pulses running along the Boats' orbit line
function drawPulses(ctx, S, t, x0, y0, a0) {
  const { orbit } = S.geo, w = S.w;
  for (let i = 0; i < 3; i++) {
    const x = ((t * 34 + (i * w) / 3) % (w + 40)) - 20;
    for (let k = 0; k < 10; k++) {
      const xx = x - k * 1.5, yy = orbit(xx);
      ctx.globalAlpha = a0 * (1 - k / 10) * 0.9;
      ctx.fillStyle = k < 2 ? '#ffffff' : '#bff6ff';
      ctx.fillRect(snap(x0 + xx), snap(y0 + yy) - 0.5, 1, 1.5);
    }
    const sp = sparkSprite(1, 0);
    ctx.globalAlpha = a0;
    ctx.drawImage(sp, snap(x0 + x + 0.25 - sp.o), snap(y0 + orbit(x) + 0.25 - sp.o));
  }
  ctx.globalAlpha = a0;
}

// Where the Boats tab floats its boats: the orbit line (view-relative)
export function labRoomScene(v, kind) {
  if (kind !== 'boats') return { wl: 0, orbit: () => 0 };
  const G = boatsGeo(Math.round(v.w), Math.round(v.h));
  return { wl: G.wl, orbit: G.orbit };
}

// A boat's hover glow on the orbit line: stepped pixel rows (no soft gradient) brightening toward the line; the
// sailing boat's is golden with two little twinkles, the selected one white.
export function drawOrbitPad(ctx, x, y, hw, t, o = {}) {
  x = snap(x); y = snap(y);
  const col = o.cur ? '#fff0a0' : o.sel ? '#ffffff' : '#9ff0ff', a0 = ctx.globalAlpha, k = o.sel || o.cur ? 1 : 0.6;
  ctx.fillStyle = col;
  for (let i = 0; i < 4; i++) {
    const ww = snap(hw * (1 - i * 0.24) * (o.sel ? 1.15 : 1));
    ctx.globalAlpha = a0 * k * (0.5 - i * 0.1);
    ctx.fillRect(x - ww, y - 1 - i, ww * 2, 1);
  }
  ctx.globalAlpha = a0 * k * 0.8;
  ctx.fillRect(x - snap(hw * 0.5), y - 0.5, snap(hw * 0.5) * 2, 1.5);
  if (o.cur || o.sel) {
    for (let i = 0; i < 2; i++) {
      const q = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 2.1);
      if (q < 0.3) continue;
      const sp = sparkSprite(q > 0.75 ? 2 : 1, o.cur ? 2 : 0);
      ctx.globalAlpha = a0;
      ctx.drawImage(sp, snap(x + (i ? hw * 0.9 : -hw * 0.85) - sp.o), snap(y - 6 - i * 5 - sp.o));
    }
  }
  ctx.globalAlpha = a0;
}
