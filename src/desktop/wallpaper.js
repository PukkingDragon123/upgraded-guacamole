// The "ordinary" desktop wallpaper shown before the ocean floods in (and in mini mode): the classic rolling
// green hill under a deep blue sky with cumulus, as an original glossy Frutiger Aero voxel landscape.
// Also owns the rising-water reveal used by the opening (waterline, clip, glossy surface line).
//
//   renderLandscape(W, H, {seed, sun}) -> canvas   cached per size; reused by the intro (window view, monitor)
//   new Wallpaper(game): draw(ctx, dt, dim), waterline(x), clipOcean(ctx), drawWaterline(ctx), layer.canvas

import { makeCanvas, ctxOf, makeLayer, resizeLayer } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack, mix } from '../core/color.js';
import { bayer, fbm2, hash2, clamp, clamp01, lerp, smoothstep } from '../core/math.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { RNG } from '../core/rng.js';

const SKY = ['#0b4fb8', '#1361c8', '#1d74d6', '#2b88e0', '#3f9ce8', '#58aef0', '#74c0f4', '#93d0f7', '#b3dffa', '#d2edfc', '#e8f6fe'];
const GRASS = ['#17561a', '#1f6a1c', '#2a7e20', '#378f25', '#45a12a', '#56b22f', '#69c134', '#7fce3a', '#97da44', '#b2e553'];
const HAZE = '#9fd2ee';
const CLOUD = ['#b6c8e8', '#c4d4ee', '#d4e1f4', '#e3ecf9', '#f1f6fd', '#ffffff'];

const smax = (a, b, k) => { const h = clamp01(0.5 + (b - a) / (2 * k)); return lerp(a, b, h) + k * h * (1 - h); };
const bell = (r) => (r >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * r));

// ---------------------------------------------------------------------------------------------- sky
function drawSky(g, W, H, horizon, sun) {
  const buf = new PixelBuffer(W, H);
  const cols = SKY.map((h) => pack(h));
  const n = cols.length - 1;
  const sx = W * 0.1, sy = H * 0.06, sr = H * 0.62;
  for (let y = 0; y < H; y++) {
    const k = clamp01(y / horizon);
    const f = Math.pow(k, 1.35) * n;
    for (let x = 0; x < W; x++) {
      // a gentle diagonal lift toward the sun (upper left), dithered like the rest of the sky
      const lift = (1 - x / W) * 0.55 * (1 - k);
      const d = sun ? Math.max(0, 1 - Math.hypot(x - sx, (y - sy) * 1.2) / sr) : 0;
      const v = f + lift + d * d * 4.2 + (bayer(x, y) - 0.5);
      buf.data[y * W + x] = cols[clamp(Math.round(v), 0, n)];
    }
  }
  g.drawImage(buf.toCanvas(), 0, 0);
}

// --------------------------------------------------------------------------------------------- clouds
function cumulus(seed, w, s) {
  const r = new RNG(seed);
  const h = Math.round(w * 0.55), d = Math.round(w * 0.42);
  const m = new VoxelModel(w + 4, h + 4, d + 4);
  const P = CLOUD.map((c, i) => m.color(c, { smooth: 0.9, jitter: 0.04, edge: 0, aoMul: 0.4, spec: i > 3 ? 0.25 : 0, specPow: 10 }));
  const base = Math.round(h * 0.18);
  const puffs = [];
  const n = 4 + Math.floor(w / 14);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cx = 2 + w * (0.12 + 0.76 * t) + r.float(-2, 2);
    const mid = 1 - Math.abs(t - 0.5) * 2;
    const rad = w * (0.1 + 0.13 * mid + r.float(0, 0.06));
    puffs.push([cx, base + rad * r.float(0.55, 0.9), 2 + d / 2 + r.float(-d * 0.12, d * 0.12), rad]);
  }
  // a couple of tall towers on top
  for (let i = 0; i < 3; i++) {
    const p = puffs[1 + Math.floor(r.float(0, puffs.length - 2))];
    puffs.push([p[0] + r.float(-w * 0.06, w * 0.06), p[1] + p[3] * r.float(0.5, 0.8), p[2], p[3] * r.float(0.55, 0.8)]);
  }
  for (const [cx, cy, cz, rad] of puffs) m.ellipsoid(cx, cy, cz, rad, rad * 0.86, Math.min(rad, d * 0.5), 1);
  m.sub(() => m.box(0, 0, 0, m.nx - 1, base - 1, m.nz - 1, 1));
  // shade by height and toward the sun (upper left): bright crowns, soft blue bellies
  m.recolor((x, y, z) => {
    const k = clamp01((y - base) / (h * 0.75)) * 0.85 + (1 - x / m.nx) * 0.22 + (z / m.nz) * 0.12;
    return P[clamp(Math.round(k * (P.length - 1) + (bayer(x, z + y) - 0.5) * 0.9), 0, P.length - 1)];
  });
  return renderVoxels(m, { scale: s, yaw: 0, pitch: 8, outline: false, depthLines: false, edges: 0, sideEdges: 0, ao: 0.45, groundAO: false, light: { top: 3.6, lit: 3.3, dark: 3, bottom: 2.9 } });
}

// -------------------------------------------------------------------------------------------- terrain
function terrain(W, H, s, seed) {
  const r = new RNG(seed);
  const nx = Math.ceil(W / s) + 6, nz = 190, ny = 76;
  const m = new VoxelModel(nx, ny, nz);
  const hills = [
    // [cx, cz, rx, rz, height] in model units
    { cx: nx * 0.64, cz: nz * 0.36, rx: nx * 0.72, rz: nz * 0.5, a: 56 },   // the big rolling hill
    { cx: nx * 0.02, cz: nz * 0.16, rx: nx * 0.42, rz: nz * 0.3, a: 30 },   // the softer hill behind, left
    { cx: nx * 0.2, cz: nz * 0.86, rx: nx * 0.5, rz: nz * 0.3, a: 12 },    // a low swell in front
  ];
  const far = [];
  for (let i = 0; i < 7; i++) far.push({ cx: nx * (i / 6) + r.float(-nx * 0.05, nx * 0.05), cz: r.float(2, 12), rx: nx * r.float(0.16, 0.26), rz: 16, a: r.float(16, 26) });
  const hgt = new Float32Array(nx * nz);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    let h = 4 + fbm2(x * 0.02, z * 0.03, 2, seed) * 3;
    for (const f of far) h = smax(h, f.a * bell(Math.hypot((x - f.cx) / f.rx, (z - f.cz) / f.rz)), 3);
    for (const q of hills) h = smax(h, q.a * bell(Math.hypot((x - q.cx) / q.rx, (z - q.cz) / q.rz)), 6);
    hgt[z * nx + x] = h + fbm2(x * 0.05, z * 0.07, 3, seed + 3) * 1.6;
  }
  const at = (x, z) => hgt[clamp(z, 0, nz - 1) * nx + clamp(x, 0, nx - 1)];
  // palette: grass shades x haze levels (aerial perspective toward the back)
  const HZ = 4;
  const pal = [];
  for (let hz = 0; hz < HZ; hz++) pal.push(GRASS.map((c) => m.color(mix(c, HAZE, hz * 0.2), { jitter: 0.04, smooth: 0.55, edge: 0.3, aoMul: 0.7, spec: 0.18, specPow: 14 })));
  const flowers = ['#fff6a0', '#ffffff', '#ffd0e8'].map((c) => m.color(c, { jitter: 0.02 }));
  const L = [-0.55, 0.72, 0.42];
  { const l = Math.hypot(...L); L[0] /= l; L[1] /= l; L[2] /= l; }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const h = at(x, z);
    const top = Math.max(1, Math.round(h));
    const gx = (at(x + 1, z) - at(x - 1, z)) / 2, gz = (at(x, z + 1) - at(x, z - 1)) / 2;
    const nl = Math.hypot(gx, 1, gz);
    let b = (-gx * L[0] + L[1] - gz * L[2]) / nl;               // lambert toward the sun
    b = (b - 0.5) / 0.5;
    b += (h / 56) * 0.32 + fbm2(x * 0.06, z * 0.09, 2, seed + 9) * 0.18 - 0.12; // sunlit crowns, soft patches
    const shadeI = clamp(Math.round(b * (GRASS.length - 1) + (bayer(x, z) - 0.5) * 1.1), 0, GRASS.length - 1);
    const hz = clamp(Math.round((1 - z / 34) * (HZ - 1) + (bayer(x + 2, z) - 0.5) * 0.8), 0, HZ - 1);
    const c = pal[hz][shadeI];
    for (let y = Math.max(0, top - 3); y < top && y < ny; y++) m.set(x, y, z, c);
    for (let y = 0; y < top - 3 && y < ny; y++) m.set(x, y, z, pal[hz][Math.max(0, shadeI - 2)]);
    if (z > nz * 0.62 && top + 1 < ny && hash2(x, z, seed) < 0.0018) m.set(x, top, z, flowers[Math.floor(hash2(z, x, 3) * 3)]);
  }
  const rr = renderVoxels(m, { scale: s, yaw: 0, pitch: 27, outline: false, depthLines: false, edges: 0.35, sideEdges: 0, ao: 0.55, jitter: 0.04, light: { top: 3.15, lit: 2.7, dark: 2.2, bottom: 1.5 } });
  return { r: rr, nx, nz, crest: rr.project(hills[0].cx, hills[0].a, hills[0].cz), far: rr.project(nx / 2, 22, 6), front: rr.project(nx / 2, 0, nz) };
}

// ----------------------------------------------------------------------------------------- landscape
const CACHE = new Map();

export function renderLandscape(W, H, opts = {}) {
  W = Math.max(16, Math.round(W)); H = Math.max(16, Math.round(H));
  const seed = opts.seed ?? 11;
  const key = W + 'x' + H + ':' + seed + ':' + (opts.sun !== false);
  let c = CACHE.get(key);
  if (c) return c;
  const u = H / 540;
  const s = Math.max(1, Math.round(3 * u));
  c = makeCanvas(W, H);
  const g = ctxOf(c);
  const horizon = H * 0.6;
  drawSky(g, W, H, horizon, opts.sun !== false);
  // cumulus: big soft ones low, smaller ones high
  const r = new RNG(seed * 7 + 1);
  const clouds = [
    [0.2, 0.2, 64], [0.55, 0.12, 48], [0.83, 0.26, 72], [0.4, 0.36, 40], [0.95, 0.07, 34], [0.06, 0.42, 36], [0.68, 0.43, 30],
  ];
  for (const [fx, fy, w] of clouds) {
    const cw = Math.max(10, Math.round(w * u * 3 / s));
    const cr = cumulus(seed * 31 + Math.round(fx * 100), cw, s);
    g.drawImage(cr.canvas, Math.round(fx * W - cr.w / 2 + r.float(-W * 0.02, W * 0.02)), Math.round(fy * H));
  }
  // the hills: place so the far ridge sits on the horizon line and the front fills the bottom
  const T = terrain(W, H, s, seed);
  const dy = Math.round(horizon * 0.94 - T.far[1]);
  const scaleY = (H + 6 - (T.front[1] + dy));
  g.drawImage(T.r.canvas, Math.round(W / 2 - T.r.w / 2), dy);
  if (scaleY > 0) { g.fillStyle = GRASS[2]; g.fillRect(0, T.front[1] + dy, W, scaleY); }
  // a whisper of Aero gloss: bright sheen over the sky top
  const sh = g.createLinearGradient(0, 0, 0, H * 0.35);
  sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sh; g.fillRect(0, 0, W, H * 0.35);
  CACHE.set(key, c);
  if (CACHE.size > 8) CACHE.delete(CACHE.keys().next().value);
  return c;
}

// ------------------------------------------------------------------------------------------ wallpaper
export class Wallpaper {
  constructor(game) {
    this.game = game;
    this.layer = makeLayer(8, 8);
    this.built = '';
    this.t = 0;
  }

  onResize() { this.built = ''; }

  build() {
    const { W, H } = this.game.screen;
    const key = W + 'x' + H;
    if (this.built === key) return;
    this.built = key;
    resizeLayer(this.layer, W, H);
    this.layer.ctx.drawImage(renderLandscape(W, H), 0, 0);
  }

  draw(ctx, dt, dim = false) {
    this.build();
    this.t += dt || 0;
    ctx.drawImage(this.layer.canvas, 0, 0);
    if (dim) { ctx.fillStyle = 'rgba(10,30,50,0.08)'; ctx.fillRect(0, 0, this.game.screen.W, this.game.screen.H); }
  }

  waterline(x) {
    const { H } = this.game.screen;
    const r = this.game.ocean.reveal;
    const base = lerp(H + 14, -34, r);
    return base + Math.sin(x * 0.03 + this.t * 2.2) * 4 + Math.sin(x * 0.011 - this.t * 1.3) * 6;
  }

  clipOcean(ctx) {
    const { W, H } = this.game.screen;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, this.waterline(x));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.clip();
  }

  // Glossy Aero surface line: a bright specular crest, an aqua band and a soft light falloff beneath.
  drawWaterline(ctx) {
    const { W } = this.game.screen;
    const rv = this.game.ocean.reveal;
    if (rv <= 0 || rv >= 1) return;
    const t = this.t;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, this.waterline(0));
    for (let x = 6; x <= W; x += 6) ctx.lineTo(x, this.waterline(x));
    for (let x = W; x >= 0; x -= 6) ctx.lineTo(x, this.waterline(x) + 26);
    ctx.closePath();
    const y0 = this.waterline(W / 2);
    const gr = ctx.createLinearGradient(0, y0 - 8, 0, y0 + 30);
    gr.addColorStop(0, 'rgba(200,250,255,0.55)'); gr.addColorStop(0.35, 'rgba(90,210,240,0.25)'); gr.addColorStop(1, 'rgba(60,180,230,0)');
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.restore();
    for (let x = 0; x < W; x++) {
      const y = Math.round(this.waterline(x));
      const glint = (Math.sin(x * 0.21 + t * 3) + Math.sin(x * 0.057 - t * 1.7)) > 1.1;
      ctx.fillStyle = glint ? '#ffffff' : 'rgba(255,255,255,0.85)';
      ctx.fillRect(x, y - 1, 1, glint ? 2 : 1);
      ctx.fillStyle = 'rgba(140,235,255,0.75)';
      ctx.fillRect(x, y + 1, 1, 2);
    }
  }
}
