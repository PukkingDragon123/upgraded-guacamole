// itch.io store art (cover, banner, key art), composed with the game's own renderers: the (OS)cean biome with the
// water shader, the voxel boat + bubble-person fisherman, voxel fish, voxel kelp / coral and the 3D voxel title.
//   node tools/build.mjs --dev keyart && PW_PATH=/opt/node-tools/node_modules/playwright node tools/keyart.mjs
//     -> release/itch/fishtop-{cover-630x500, cover-1260x1000, banner-1920x480, keyart-1920x1080}.png
//   dist/dev/keyart.html?preset=cover|banner|key   (&title=0 hides the title, &grid=1 shows a composition grid,
//     &tv={...} overrides logo options, &hide=boat,line); dev aids: ?preset=titletest&v=[...], ?preset=fishtest&ids=..
// No light-ray fans, spotlight beams or ring effects: the biome's sun rays, underwater shafts, lens flare, sky arcs
// and the water shader's god rays are switched off on the biome instance (game code untouched).
// Each preset renders at its logical size (world zoom `z`), crisp; tools/keyart.mjs grabs the canvas through
// window.__ka.capture(scale) (nearest-neighbour upscale) once window.__ka.ready.
import { ctxOf, makeLayer, makeCanvas } from '../core/canvas.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';
import { biomesReady } from '../world/biomes/index.js';
import { Boat } from '../world/boat.js';
import { WaterFX } from '../gfx/watergl.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { setLowpolySync } from '../fish/lowpolyfish.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { loadAlagard } from '../gfx/alagard.js';
import { buildText3D } from '../gfx/text3d.js';
import { renderVoxels, VoxelModel } from '../gfx/voxel.js';
import { voxAnim, reefSprite } from '../world/coral.js';
import { pixelBubble, pxFrames } from '../gfx/pxsprites.js';
import { baitHook, HOOK } from '../fishing/baitart.js';
import { hash2 } from '../core/math.js';

// World layout reference (960 x 540 world, zoom 1): surface ~y 65, sky up to ~-400, meadow seabed ~430..540.
// Scene coordinates: x = world x, d = depth below the still surface (world units; negative = above it).
// Kelp and reefs stand on the bottom edge of the frame (their bases run out of view).
const PRESETS = {
  // itch cover 630 x 500 (and a 2x copy)
  cover: {
    w: 630, h: 500, z: 2, cx: 384, surf: 0.57,
    boat: { x: 300, tier: 1, pose: 'idle' }, hook: { x: 436, d: 62 },
    fish: [
      { id: 'koi', x: 482, d: 70, s: 0.6, f: -1, emo: 'happy', ph: 0.1 },
      { id: 'betta', x: 352, d: 46, s: 0.55, f: 1, ph: 0.7 },
      { id: 'honk', x: 290, d: 86, s: 0.6, f: 1, ph: 0.4 },
      { id: 'puffer', x: 524, d: 26, s: 0.46, f: -1, ph: 0.3 },
      { id: 'parrot', x: 262, d: 34, s: 0.46, f: 1, ph: 0.55, far: 0.3 },
      { id: 'lionfish', x: 412, d: 96, s: 0.46, f: -1, ph: 0.85, far: 0.12 },
    ],
    kelp: [{ x: 236, seed: 3, size: 11, fg: true }, { x: 252, seed: 7, size: 8 }, { x: 534, seed: 5, size: 10, fg: true }],
    reef: [{ x: 262, seed: 41, k: 0.55 }, { x: 506, seed: 44, k: 0.6, flip: true }],
    bubbles: [[318, 96, 9], [500, 54, 6], [250, 60, 6], [398, 100, 7]],
    jump: [{ id: 'mayorgrouper', x: 500, h: 34, sx: 478, s: 0.36, f: 1, ang: -0.55, drops: 7 }],
    title: { y: 0.2, px: 2, scale: 3, ink: 2, rim: 3, shadow: 5, bounce: 3 },
  },
  // page banner 1920 x 480 (960 x 240 at 2x)
  banner: {
    w: 960, h: 240, z: 2, cx: 330, surf: 0.6,
    boat: { x: 172, tier: 1, pose: 'idle' }, hook: { x: 246, d: 26 },
    fish: [
      { id: 'koi', x: 274, d: 30, s: 0.42, f: -1, emo: 'happy', ph: 0.1 },
      { id: 'betta', x: 120, d: 26, s: 0.4, f: 1, ph: 0.7 },
      { id: 'honk', x: 456, d: 30, s: 0.42, f: -1, ph: 0.4 },
      { id: 'puffer', x: 528, d: 14, s: 0.36, f: -1, ph: 0.3 },
      { id: 'parrot', x: 340, d: 16, s: 0.38, f: 1, ph: 0.55, far: 0.3 },
      { id: 'lionfish', x: 392, d: 38, s: 0.34, f: -1, ph: 0.85, far: 0.1 },
    ],
    school: [{ id: 'neonpunk', x: 190, d: 38, n: 4, s: 0.3, f: 1, w: 34, h: 6, far: 0.1 }],
    kelp: [{ x: 92, seed: 3, size: 7, fg: true }, { x: 568, seed: 5, size: 7, fg: true }, { x: 314, seed: 7, size: 5 }],
    reef: [{ x: 168, seed: 41, k: 0.36 }, { x: 498, seed: 44, k: 0.38, flip: true }],
    bubbles: [[206, 36, 4], [424, 36, 4]],
    title: { y: 0.31, x: 0.6, px: 2, scale: 3, ink: 2, rim: 3, shadow: 4, bounce: 3 },
  },
  // key art 1920 x 1080 (960 x 540 at 2x)
  key: {
    w: 960, h: 540, z: 2, cx: 318, surf: 0.56,
    boat: { x: 210, tier: 1, pose: 'idle' }, hook: { x: 352, d: 80 },
    fish: [
      { id: 'koi', x: 392, d: 86, s: 0.62, f: -1, emo: 'happy', ph: 0.1 },
      { id: 'honk', x: 200, d: 98, s: 0.6, f: 1, ph: 0.4 },
      { id: 'betta', x: 284, d: 70, s: 0.56, f: 1, ph: 0.7 },
      { id: 'puffer', x: 470, d: 52, s: 0.5, f: -1, ph: 0.3 },
      { id: 'parrot', x: 140, d: 60, s: 0.5, f: 1, ph: 0.55, far: 0.25 },
      { id: 'lionfish', x: 318, d: 112, s: 0.5, f: -1, ph: 0.85 },
      { id: 'goldbar', x: 520, d: 96, s: 0.5, f: -1, ph: 0.2 },
    ],
    kelp: [{ x: 92, seed: 3, size: 11, fg: true }, { x: 112, seed: 7, size: 8 }, { x: 552, seed: 5, size: 11, fg: true }],
    reef: [{ x: 170, seed: 41, k: 0.6 }, { x: 470, seed: 44, k: 0.66, flip: true }],
    bubbles: [[240, 112, 9], [410, 60, 6], [130, 70, 6], [330, 116, 7]],
    school: [{ id: 'pixel', x: 456, d: 30, n: 6, s: 0.4, f: -1, w: 64, h: 14 }, { id: 'hydrated', x: 196, d: 30, n: 4, s: 0.4, f: 1, w: 50, h: 12, far: 0.15 }],
    jump: [{ id: 'mayorgrouper', x: 470, h: 40, sx: 446, s: 0.42, f: 1, ang: -0.55 }],
    title: { y: 0.2, px: 2, scale: 4, ink: 3, rim: 3, shadow: 6, bounce: 4 },
  },
};

export function run(params) {
  setLowpolySync(true);
  if (params.get('preset') === 'fishtest') { fishTest(params); return; }
  if (params.get('preset') === 'titletest') { loadAlagard().then(() => titleTest(params)); return; }
  Promise.all([biomesReady, loadAlagard()]).then(() => start(params));
}

function start(params) {
  const P = JSON.parse(JSON.stringify(PRESETS[params.get('preset') || 'key']));
  for (const k of ['w', 'h', 'z', 'cx', 'surf']) if (params.has(k)) P[k] = Number(params.get(k));
  if (params.has('tier')) P.boat.tier = Number(params.get('tier'));
  const W = P.w, H = P.h, z = P.z;
  const WW = 960, WH = 540; // the world is always built at the reference size
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  const css = Number(params.get('css') || 2);
  cv.style.width = W * css + 'px'; cv.style.height = H * css + 'px';
  const ctx = ctxOf(cv);

  const noop = () => {};
  const cam = { open: true, z, shake() {} };
  const game = {
    screen: { W: WW, H: WH }, camera: cam, lowPower: false, mini: false, stats: {},
    world: { cursor: { x: -999, y: -999, vx: 0, vy: 0, speed: 0, inWorld: false } },
    audio: new Proxy({}, { get: (_, k) => (k === 'loop' ? () => ({ set: noop, stop: noop }) : noop) }),
    state: { view: 'ocean', secrets: {}, boat: { tier: P.boat.tier }, settings: { dayCycle: 'day' }, character: undefined },
    fishing: { hook: { visible: true, x: P.hook.x, y: 0 }, busy: false },
    school: { fishes: [] },
    particles: new Proxy({}, { get: () => noop }),
    toast: noop, addCoins: noop, save: noop, musicFor: () => null,
  };
  game.clock = new Clock(game);
  game.clock.override = Number(params.get('hour') ?? 11.5);
  const ocean = new Ocean(game);
  game.ocean = ocean;
  ocean.onResize();
  ocean.setBiome('oscean');
  ocean.weather = 'sunny';
  ocean.weatherT = 1e9;
  const b = ocean.biome;
  // no light-ray fans or spotlight beams: sky sun rays, underwater shafts, lens flare, shader god rays, sky arcs
  const empty = makeCanvas(1, 1);
  b.rays = [];
  b.branches = []; // no leaf slivers poking into the top corners
  b.arcs = empty;
  for (const k of ['raysA', 'raysB']) if (b[k]) b[k] = { tint: () => empty };
  if (b.aero?.look) b.aero.look = { ...b.aero.look, flare: 0, rays: 0, arcs: 0 };
  if (!P.globe) b.drawGlobe = () => {}; // the floating glass globe would sit behind the logo
  const wl = b.waterLook.bind(b);
  b.waterLook = (env) => ({ ...wl(env), rays: 0 });

  // camera: the still surface at P.surf of the height, world P.cx at the centre
  const S0 = ocean.waterLevel();
  const ox = Math.round(W / 2 - P.cx * z), oy = Math.round(H * P.surf - S0 * z);
  Object.assign(cam, {
    xform: () => [z, ox, oy],
    view: () => ({ x0: -ox / z, y0: -oy / z, x1: (W - ox) / z, y1: (H - oy) / z, z }),
    screenToWorld: (x, y) => [(x - ox) / z, (y - oy) / z],
    worldToScreen: (x, y) => [x * z + ox, y * z + oy],
    apply: (g) => g.setTransform(z, 0, 0, z, ox, oy),
    reset: (g) => g.setTransform(1, 0, 0, 1, 0, 0),
  });
  const view = cam.view();
  const yOf = (d) => S0 + d;

  game.water = new WaterFX(game, { force: true });
  game.boat = new Boat(game);
  game.boat.pose = P.boat.pose;
  const layer = makeLayer(W, H);
  const hide = new Set((params.get('hide') || '').split(','));

  const env = ocean.env;
  env.scroll = env.ref = -Math.round(WH * 0.62);

  // scenery sprites at double detail (drawn at half size under the 2x camera: 1 screen px per voxel)
  const HD = z >= 2 ? 2 : 1;
  const kelps = (P.kelp || []).map((k) => ({ ...k, A: voxAnim('kelp', k.seed, k.theme || 'oscean', k.size, HD) }));
  const reefs = (P.reef || []).map((r) => ({ ...r, spr: reefSprite(r.seed, 'shallows', { w: 140, h: 84, d: 54 }, r.k * HD, !!r.flip) }));
  for (const sc of P.school || []) for (let i = 0; i < sc.n; i++) {
    (P.fish ||= []).push({ id: sc.id, x: sc.x + (hash2(i, 11) - 0.5) * sc.w, d: sc.d + (hash2(i, 23) - 0.5) * sc.h, s: sc.s * (0.9 + hash2(i, 5) * 0.2), f: sc.f, ph: hash2(i, 7), far: sc.far });
  }
  const fishes = (P.fish || []).filter((f) => SPECIES_BY_ID[f.id]).map((f) => ({ ...f, sp: SPECIES_BY_ID[f.id], c: compiled(SPECIES_BY_ID[f.id].look, null, f.id) }));
  // a fish leaping out of the water: splash crown under it, droplets streaming off the tail
  const jumps = (P.jump || []).filter((j) => SPECIES_BY_ID[j.id]).map((j) => ({ ...j, sp: SPECIES_BY_ID[j.id], c: compiled(SPECIES_BY_ID[j.id].look, null, j.id) }));
  const drops = pxFrames('drop', 'aqua', 1);
  const drawJump = (g, j) => {
    const fy = S0 - j.h;
    pixelSplash(g, j.sx, S0, j.splash ?? 1.2, j.x * 3);
    for (let i = 0; i < (j.drops ?? 9); i++) {
      const u = (i + 0.5) / (j.drops ?? 9);
      const dx = j.sx + (j.x - j.sx) * u * 0.8 + (hash2(i, 3) - 0.5) * 10, dy = S0 + (fy - S0) * u * 0.9 - Math.sin(u * Math.PI) * 6 + (hash2(i, 9) - 0.5) * 8;
      const f = drops[i % drops.length];
      g.drawImage(f, Math.round(dx - f.width / 2), Math.round(dy - f.height / 2));
    }
    drawFishRig(g, j.c, { x: j.x, y: fy, facing: j.f ?? 1, scale: j.s * (j.sp.scale || 1), angle: j.ang ?? -0.5, time: T, swimPhase: 0.3, tailPhase: 0.3, finPhase: 0.3, speed01: 1, emotion: j.emo || 'happy', noCull: true, pri: 3 });
  };
  const logo = params.get('title') === '0' ? null : logoSprite({ ...P.title, ...(params.has('tv') ? JSON.parse(params.get('tv')) : {}) });

  const dt = 1 / 30;
  let frame = 0, T = 0;
  const warm = Number(params.get('warm') ?? 90);
  window.__ka = { ready: false, preset: P, capture: (k = 1) => capture(cv, k) };

  function step() {
    T += dt;
    env.view = view; env.top = ocean.top;
    ocean.update(dt);
    game.boat.x = P.boat.x; game.boat.vx = 0;
    game.boat.update(dt, null);
    game.boat.x = P.boat.x;
    game.water.update(dt, { surfaceY: ocean.waterLevel(), top: ocean.top, W: WW, H: WH, waveAt: (x) => ocean.waveAt(x) });
  }

  const drawAnim = (g, A, x, y, t) => {
    const i = Math.floor((t / 3) * A.frames.length) % A.frames.length;
    const f = A.frames[i];
    g.drawImage(f, Math.round((x - A.ox / HD) * HD) / HD, Math.round((y - A.oy / HD) * HD) / HD, f.width / HD, f.height / HD);
  };
  const drawKelp = (g, k) => drawAnim(g, k.A, k.x, view.y1 + 4, T + k.seed);
  const drawReef = (g, r) => {
    const s = r.spr;
    g.drawImage(s.canvas, Math.round(r.x - s.ox / HD), Math.round(view.y1 + 6 - s.oy / HD), s.canvas.width / HD, s.canvas.height / HD);
  };
  const drawFish = (g, f, wash) => {
    drawFishRig(g, f.c, {
      x: f.x, y: yOf(f.d), facing: f.f ?? 1, scale: f.s * (f.sp.scale || 1), time: T, swimPhase: f.ph ?? 0, tailPhase: f.ph ?? 0, finPhase: f.ph ?? 0,
      speed01: 0.3, emotion: f.emo || 'neutral', angle: f.ang || 0, wash, noCull: true, pri: 3,
    });
  };

  function draw() {
    const g = layer.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    cam.apply(g);
    b.drawBack(g, env);
    const L = ocean.lighting();
    b.drawSeabed(g, env);
    b.drawNear?.(g, env);
    // background scenery and far fish get the water shader (caustics, refraction, depth tint)
    for (const f of fishes) if (f.far) drawFish(g, f, { color: b.fogColor || '#2a8ab0', alpha: f.far });
    for (const r of reefs) drawReef(g, r);
    for (const k of kelps) if (!k.fg) drawKelp(g, k);
    cam.reset(g);
    const out = game.water.render(layer.canvas, cam, b.waterLook(env));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(out || layer.canvas, 0, 0);
    cam.apply(ctx);
    if (!hide.has('boat')) game.boat.draw(ctx, env);
    cam.reset(ctx);
    ocean.applyLighting(ctx, L);
    cam.apply(ctx);
    if (!hide.has('line')) drawLine(ctx, game.boat.rodTip(), [P.hook.x, yOf(P.hook.d)], S0, T);
    for (const f of fishes) if (!f.far) drawFish(ctx, f, null);
    for (const k of kelps) if (k.fg) drawKelp(ctx, k);
    b.drawFront(ctx, env);
    for (const [x, d, n] of P.bubbles || []) bubbleStream(ctx, x, yOf(d), n, S0, x * 7 + d);
    for (const j of jumps) drawJump(ctx, j);
    cam.reset(ctx);
    if (logo) {
      const tx = Math.round(W * (P.title.x ?? 0.5) - logo.width / 2), ty = Math.round(H * P.title.y - logo.height / 2);
      ctx.drawImage(logo, tx, ty);
      sparkles(ctx, tx, ty, logo.width, logo.height, P.title.scale);
    }
    if (params.get('grid') === '1') { ctx.fillStyle = 'rgba(255,0,0,0.5)'; for (const f of [1 / 3, 2 / 3]) { ctx.fillRect(Math.round(W * f), 0, 1, H); ctx.fillRect(0, Math.round(H * f), W, 1); } }
  }

  function loop() {
    step();
    frame++;
    if (frame < warm) { if (frame % 10 === 0) draw(); requestAnimationFrame(loop); return; }
    draw();
    window.__ka.ready = true;
  }
  requestAnimationFrame(loop);
}

// Fishing line from the rod tip to the hook (the game's sagging 1 px line, plotted in screen space), the hook and
// a glowing worm on it.
function drawLine(ctx, [x0, y0], [x1, y1], surf, t) {
  const m = ctx.getTransform();
  const Z = Math.hypot(m.a, m.b);
  const d = Math.hypot(x1 - x0, y1 - y0);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + Math.min(40, d * 0.14);
  const steps = Math.ceil((d * Z) / 1.2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let px = null, py = null;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const wx = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x1;
    const wy = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * (y1 - 5);
    const x = Math.round(m.a * wx + m.e), y = Math.round(m.d * wy + m.f);
    if (x === px && y === py) continue;
    ctx.fillStyle = 'rgba(12,58,92,0.35)'; ctx.fillRect(x, y + 1, 1, 1);
    ctx.fillStyle = wy > surf ? 'rgba(232,244,255,0.7)' : '#f2f9ff';
    ctx.fillRect(x, y, 1, 1);
    px = x; py = y;
  }
  ctx.restore();
  const hk = baitHook({ shape: 'worm' }, t);
  ctx.save();
  ctx.translate(Math.round(x1 * 2) / 2, Math.round((y1 + 7) * 2) / 2);
  if (hk.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(hk.glow, -hk.w / 2, -hk.h / 2, hk.w, hk.h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  ctx.drawImage(hk.canvas, -hk.w / 2, -hk.h / 2, hk.w, hk.h);
  ctx.restore();
  ctx.drawImage(HOOK, Math.round(x1) - 3, Math.round(y1) - 5);
}

// Splash where a fish broke the surface: a white foam mound on the waterline with a few chunky water tongues
// leaning outward (aqua shade on their right) and round droplets above them. World-space pixels.
function pixelSplash(g, x, surf, k, seed) {
  const W = '#ffffff', A = '#bff2ff', B = '#5ad0ff';
  // foam mound
  for (let i = -12; i <= 12; i++) {
    const h = Math.round((1 - (i / 13) ** 2) * 5 * k + hash2(i, seed) * 2);
    g.fillStyle = W; g.fillRect(Math.round(x + i), Math.round(surf - h + 1), 1, h);
    if (i > 2) { g.fillStyle = A; g.fillRect(Math.round(x + i), Math.round(surf - h + 3), 1, Math.max(1, h - 3)); }
  }
  // tongues: [offset, lean, height, width]
  const T = [[-8, -0.55, 9, 2], [-3, -0.18, 15, 3], [3, 0.2, 13, 3], [8, 0.6, 8, 2]];
  for (const [dx, lean, h0, w0] of T) {
    const h = Math.round(h0 * k);
    for (let t = 0; t < h; t++) {
      const f = t / h, w = Math.max(1, Math.round(w0 * (1 - f * 0.6)));
      const px = Math.round(x + dx + lean * t), py = Math.round(surf - 3 - t);
      g.fillStyle = W; g.fillRect(px, py, w, 1);
      g.fillStyle = B; g.fillRect(px + w, py, 1, 1);
    }
    // a round droplet just above the tip
    const tx = Math.round(x + dx + lean * (h + 4)), ty = Math.round(surf - 3 - h - 4);
    g.fillStyle = W; g.fillRect(tx, ty, 2, 2); g.fillRect(tx - 1, ty + 1, 1, 1);
    g.fillStyle = B; g.fillRect(tx + 1, ty + 1, 1, 1);
  }
}

// A short column of glossy pixel bubbles rising toward the surface.
function bubbleStream(ctx, x, y, n, surf, seed) {
  for (let i = 0; i < n; i++) {
    const h = hash2(seed, i);
    const by = y - i * (6 + h * 7) - 2;
    if (by < surf + 4) break;
    const r = 1 + Math.floor(hash2(i, seed + 3) * 3) + (i % 4 === 0 ? 1 : 0);
    const bx = x + Math.sin(i * 1.3 + seed) * 3;
    const spr = pixelBubble(r);
    ctx.drawImage(spr, Math.round(bx - spr.width / 2), Math.round(by - spr.height / 2));
  }
}

// Twinkling 4-point pixel stars on the title's upper edges.
function sparkles(ctx, x, y, w, h, s) {
  const frames = pxFrames('sparkle', 'white', Math.max(1, Math.round(s / 2)));
  const spots = [[0.06, 0.18], [0.36, 0.08], [0.63, 0.14], [0.93, 0.3], [0.2, 0.86]];
  spots.forEach(([u, v], i) => {
    const f = frames[(i * 2) % frames.length];
    ctx.drawImage(f, Math.round(x + u * w - f.width / 2), Math.round(y + v * h - f.height / 2));
  });
}

function capture(cv, k) {
  const c = makeCanvas(cv.width * k, cv.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(cv, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}


// Contact sheet of candidate species (dev aid): ?preset=fishtest&ids=a,b,c&s=1.5
function fishTest(params) {
  const ids = (params.get('ids') || 'koi,angel,betta,parrot,honk,puffer,lionfish,unicornfish,sunfish,gourami,bubblepuff,sneakerhead,hydrated,zebrafish,grouper,loafer,pixel,cookie,glassghost,dragonkarp,bananafish,neonpunk,goldbar,mayorgrouper,gottagofast,crystalcarp,auroraray,porpoise,bruce,seahorse').split(',');
  const W = 960, H = 540, cv = document.getElementById('screen');
  cv.width = W; cv.height = H; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  g.fillStyle = '#3aa8e0'; g.fillRect(0, 0, W, H);
  const s = Number(params.get('s') || 1);
  const cols = 6;
  ids.forEach((id, i) => {
    const sp = SPECIES_BY_ID[id];
    if (!sp) return;
    const x = 80 + (i % cols) * 160, y = 50 + Math.floor(i / cols) * 100;
    drawFishRig(g, compiled(sp.look, null, sp.id), { x, y, facing: 1, scale: s * (sp.scale || 1), time: 0, swimPhase: 0.2, tailPhase: 0.2, finPhase: 0.2, noCull: true });
    g.fillStyle = '#fff'; g.font = '10px monospace'; g.fillText(id, x - 40, y + 40);
  });
  window.__ka = { ready: true, capture: (k = 1) => capture(cv, k) };
}

// ------------------------------------------------------------------ the title
const TITLE_PALS = {
  // glossy aqua glass: white-hot top face fading to aqua, deep ocean-blue sides, white sticker rim
  aqua: { face: ['#ffffff', '#b4f4ff', '#3ccaf6'], bevelL: '#ffffff', bevelD: '#1890d8', side: '#1068c0', back: '#06367e', outline: '#ffffff' },
  leaf: { face: ['#f8ffe0', '#b4f46a', '#4cc62e'], bevelL: '#ffffff', bevelD: '#2c9c22', side: '#1d7a1a', back: '#0f4a10', outline: '#ffffff' },
  blue: { face: ['#e0f8ff', '#5cc8ff', '#1a7ef0'], bevelL: '#ffffff', bevelD: '#1060cc', side: '#0a48a8', back: '#062a6e', outline: '#ffffff' },
};

// One word (or part) of the logo as a crisp voxel sprite. o = {px, depth, outline, pal, scale, yaw, pitch}
// Alagard's T (hooked bar, curled foot) and I (a flag like a "1") turn into "C" / "1" once extruded and inked at
// logo size, so the logo uses cleaner Alagard-weight masks for those two letters (11 rows, cap height).
const GLYPHS = {
  T: ['.######.', '##.##.##', '#..##..#', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '..####..', '...##...'],
  I: ['####', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####', '.##.'],
};

// A glyph mask (rows top -> bottom) voxelised like text3d.js does (face gradient, lit bevel, side, back).
function glyphModel(rows, px, depth, P) {
  const gw = rows[0].length, gh = rows.length, D = depth * px;
  const nx = gw * px + 2, ny = gh * px + 2, nz = D + 2;
  const m = new VoxelModel(nx, ny, nz);
  const o = { spec: 0.95, specPow: 16, smooth: 1, jitter: 0.012 };
  const ids = { face: P.face.map((c) => m.color(c, o)), bevelL: m.color(P.bevelL, { ...o, spec: 1.2 }), bevelD: m.color(P.bevelD, o), side: m.color(P.side, { ...o, spec: 0.7 }), back: m.color(P.back, { ...o, spec: 0.4 }) };
  const at = (vx, vy) => {
    if (vx < 1 || vy < 1) return false;
    const gx = Math.floor((vx - 1) / px), gy = gh - 1 - Math.floor((vy - 1) / px);
    return gx >= 0 && gy >= 0 && gx < gw && gy < gh && rows[gy][gx] === '#';
  };
  for (let vy = 0; vy < ny; vy++) for (let vx = 0; vx < nx; vx++) {
    if (!at(vx, vy)) continue;
    const k = (vy - 1) / Math.max(1, gh * px - 1);
    const fi = k > 0.62 ? 0 : k > 0.3 ? 1 : 2;
    const up = !at(vx, vy + 1), left = !at(vx - 1, vy), down = !at(vx, vy - 1), right = !at(vx + 1, vy);
    let face = ids.face[fi];
    if (px > 2 && (up || left)) face = ids.bevelL;
    else if (px > 2 && (down || right)) face = ids.bevelD;
    else if (px > 1 && up) face = ids.face[Math.max(0, fi - 1)];
    for (let z = 1; z <= D; z++) m.set(vx, vy, z, z === D ? face : z === 1 ? ids.back : ids.side);
  }
  return m;
}

function wordSprite(text, o) {
  const P = TITLE_PALS[o.pal] || o.pal;
  let model;
  if (o.clean !== false && GLYPHS[text]) model = glyphModel(GLYPHS[text], o.px, o.depth, P);
  else {
    const T = buildText3D(text, { size: o.fsize ?? 16, px: o.px, depth: o.depth, outline: o.outline, palette: P });
    if (!T) return null;
    model = T.model;
  }
  const r = renderVoxels(model, { scale: o.scale, yaw: o.yaw ?? 0, pitch: o.pitch ?? 14, outline: true, ao: 0.6, edges: 0.35, depthLines: false, light: { top: 3.6, lit: 3.2, dark: 2.2, bottom: 1.6 } });
  return r.canvas;
}

// Sticker frame around the whole logo: a dark ink line (r px), a glossy white rim (rim px, pale aqua toward the
// bottom), a thin navy edge and a soft deep-blue drop shadow (shadow px down).
function inked(src, r = 2, shadow = 4, rim = 0) {
  const R = r + (rim ? rim + 1 : 0);
  const pad = R + shadow + 2;
  const W = src.width + pad * 2, H = src.height + pad * 2;
  const g0 = makeCanvas(W, H).getContext('2d', { willReadFrequently: true });
  g0.drawImage(src, pad, pad);
  const a = g0.getImageData(0, 0, W, H).data;
  // squared distance to the nearest ink pixel (capped), brute force over a small disc
  const D = new Float32Array(W * H).fill(1e9);
  const offs = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R + R) offs.push([dx, dy, dx * dx + dy * dy]);
  offs.sort((p, q) => p[2] - q[2]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (a[(y * W + x) * 4 + 3] > 100) { D[y * W + x] = 0; continue; }
    for (const [dx, dy, q] of offs) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H && a[(Y * W + X) * 4 + 3] > 100) { D[y * W + x] = q; break; }
    }
  }
  const lim = (k) => k * k + k;
  const out = makeCanvas(W, H);
  const g = out.getContext('2d');
  const id = g.createImageData(W, H), d = id.data;
  const put = (i, c, al = 255) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = al; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 4, q = D[p];
    if (q === 0) continue;
    const v = y / H;
    if (q <= lim(r)) put(i, [6, 14, 34]);
    else if (rim && q <= lim(r + rim)) put(i, v < 0.55 ? [255, 255, 255] : v < 0.8 ? [226, 248, 255] : [184, 232, 255]);
    else if (rim && q <= lim(R)) put(i, [10, 52, 112]);
    else if (shadow && y - shadow >= 0 && D[p - shadow * W] <= lim(R)) put(i, [4, 40, 96], 120);
  }
  g.putImageData(id, 0, 0);
  g.drawImage(src, pad, pad);
  return out;
}

// The FISHTOP logo, letter by letter (own spacing, a little bounce per letter): "FISH" aqua + "TOP" green like the
// in-game logo, or one palette. o = {px, depth, scale, yaw, pitch, pal1, pal2, split, spacing, bounce, ink, shadow}
export function logoSprite(o = {}) {
  const base = { px: o.px ?? 2, depth: o.depth ?? 9, outline: o.outline ?? 0, scale: o.scale ?? 2, pitch: o.pitch ?? -18 };
  const text = o.text || 'FISHTOP';
  const split = o.split === false ? 99 : (o.splitAt ?? 4);
  const letters = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const yaw = (o.yaw ?? 14) + (o.fan ? (i - (text.length - 1) / 2) * o.fan : 0);
    const c = wordSprite(ch, { ...base, yaw, pal: i < split ? o.pal1 || 'aqua' : o.pal2 || 'leaf' });
    if (!c) return null;
    letters.push(c);
  }
  const sp = Math.round((o.spacing ?? 1.2) * base.scale * base.px);
  const bounce = o.bounce ?? 0;
  const offs = letters.map((_, i) => Math.round(Math.sin(i * 1.7 + 0.6) * bounce));
  const w = letters.reduce((a, c) => a + c.width, 0) + sp * (letters.length - 1);
  const h = Math.max(...letters.map((c) => c.height)) + bounce * 2;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  let x = 0;
  letters.forEach((s, i) => { g.drawImage(s, x, h - bounce - s.height + offs[i]); x += s.width + sp; });
  return inked(c, o.ink ?? 2, o.shadow ?? 4, o.rim ?? 0);
}

function titleTest(params) {
  const W = 960, H = 540, cv = document.getElementById('screen');
  cv.width = W; cv.height = H; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#2a8ef0'); gr.addColorStop(1, '#bfeaff');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const variants = params.get('v') ? JSON.parse(params.get('v')) : [{ scale: 2, rim: 2 }, { scale: 2, rim: 2, split: false }, { scale: 3, rim: 3, ink: 2 }];
  let y = 10;
  for (const v of variants) {
    const s = logoSprite(v);
    if (!s) continue;
    g.drawImage(s, Math.round(W / 2 - s.width / 2), y);
    y += s.height + 6;
  }
  window.__ka = { ready: true, capture: (k = 1) => capture(cv, k) };
}
