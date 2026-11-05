// (OS)cean (id 'oscean', 4 m): the classic default desktop wallpaper - a smooth rolling green hill under a bright
// blue sky with soft cumulus - has flooded, styled after an eco Aero wallpaper. An original landscape (no photo, no
// logos), voxel on the shared world camera. Above the surface: a saturated Aero sky (sun rays, a big lens flare, white
// arc lines, voxel cumulus, aurora ribbons, a rainbow after the rain), the CURVED grass horizon of a little planet with
// spinning white wind turbines, a lone round tree and a glass city inside a giant water bubble, a floating green glass
// globe dripping into the sea, glossy leafy branches framing the top corners, splashes on the surface and a glossy pier
// where NPCs hang out. Underwater: the glossy grass hill continues as the seabed under vivid aquarium-lamp blue, with
// a grass-and-flower meadow, clouds made of bubbles, light shafts, wind turbines turning in the current, glass orbs
// and chrome droplets, big glossy leaves in the corners, flowers, aqua bubble plants, app-like crystal plants and a
// passing dolphin pod.
// Weathers: sunny, bubble breeze, glossy rain, aurora night. Static art is baked in build() (also exposed as a
// step generator, steps(W, H), so the Ocean can spread the work over frames while travelling).

import { Biome, worldTop } from './base.js';
import { SkyDome, skyBodies } from '../sky.js';
import { VoxelGiant } from '../giants.js';
import { voxAnim, placeAnim } from '../coral.js';
import { hazed } from '../horizon.js';
import { renderModel } from '../voxkit.js';
import { clamp, clamp01, lerp, smoothstep, ease, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack } from '../../core/color.js';
import { flipCanvas } from '../../gfx/pixel.js';
import { voxBall, voxCloudSprite } from '../voxcritters.js';
import { makeCanvas, ctxOf } from '../../core/canvas.js';
import { VoxelModel } from '../../gfx/voxel.js';
import * as NPC from '../../gfx/npcs.js';
import { MUSIC_TRACKS } from '../../core/audio.js';
import {
  paint, gradientStrip, Blend, FogLayer, fillWith, drawWobble, makeRays, drawGlow, twinkle, Caustics, lumaMask, waveLine,
  waveRuns, Motes, Bubbles, todWeights, quality, inRect, streakTile, DepthScene, BandSet, DepthDecor, qscale, waterColorAt,
  FogCache, hazeMask, zoomOf,
} from '../scenery.js';
import {
  AeroOverlay, AERO_LOOKS, glassOrb, chromeDrop, soapBubble, bubbleCloud, rainbowArc, auroraRibbon, turbineTower, rotorFrames,
  swayAnim, buildLeaves, buildFlowers, pierModel, sparkleStar, bloomStrip, waterGloss,
  skyArcs, sunRays, GlassGlobe, voxWaterBubble, voxDrop, glassCity, roundTree, splashFrames, leafBranch, planetEdge,
} from '../aerokit.js';

const SKY = {
  day: [[0, '#0646c8'], [0.34, '#1676f0'], [0.66, '#3ea8ff'], [0.88, '#9adcff'], [1, '#f0fcff']],
  dusk: [[0, '#16246a'], [0.4, '#45449a'], [0.68, '#c46aa8'], [0.86, '#ff9e8a'], [1, '#ffe2a8']],
  night: [[0, '#020816'], [0.55, '#071840'], [0.85, '#112e6a'], [1, '#1c4686']],
};
const SKYHZ = { day: '#c8ecff', dusk: '#f2b6a6', night: '#16305e' };
const OVERCAST = {
  day: [[0, '#7aa6d6'], [1, '#d8ecfa']],
  dusk: [[0, '#54508a'], [1, '#c8a2b6']],
  night: [[0, '#060c1c'], [1, '#182844']],
};
const WATER = {
  day: [[0, '#d6fbff'], [0.05, '#78dcff'], [0.22, '#38b2ff'], [0.6, '#1e8cf2'], [1, '#166ee0']],
  dusk: [[0, '#ffd6c2'], [0.04, '#c2b6e2'], [0.14, '#6aa0da'], [0.5, '#3a68b8'], [1, '#283f8e']],
  night: [[0, '#4a8ed0'], [0.1, '#2e6eb0'], [0.5, '#1e5094'], [1, '#133676']],
};
const ORB_TINTS = ['#7fdcff', '#8af0a8', '#ffffff', '#ffd27a', '#c8a8ff'];
// Parallax (fraction of the camera scroll away from the surface view): distant sky things follow the camera so the
// default underwater view still shows a slice of Aero sky (sun, flare, arcs, clouds, the globe) above a thin curved
// grass horizon; scrolled up to the boat everything sits at its full layout.
const PAR = { sun: 0.92, sky: 0.5, clouds: [0.5, 0.92], arcs: 0.62, globe: 0.46, sink: 0.25, aurora: 0.6 };

const qmix = (a, b, t) => mix(a, b, Math.round(clamp01(t) * 32) / 32);
const tri = (a, b, c, w) => qmix(qmix(a, b, w.dusk / Math.max(0.001, w.day + w.dusk)), c, w.night);

// ------------------------------------------------------------------ biome

export class OsceanBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'oscean'; this.name = '(OS)cean'; this.subtitle = 'Rolling green hills, flooded'; // [phase4:shell]
    this.music = MUSIC_TRACKS?.includes?.('oscean') ? 'oscean' : 'shallows';
    this.ambient = 'shallows';
    this.weathers = [
      { id: 'sunny', name: 'Sunny', weight: 5, icon: 'sun' }, { id: 'bubbles', name: 'Bubble Breeze', weight: 2, icon: 'star' },
      { id: 'glossyrain', name: 'Glossy Rain', weight: 1.6, icon: 'cloud' }, { id: 'aurora', name: 'Aurora Night', weight: 1.2, icon: 'star' },
    ];
    this.fogColor = '#5cc4f2';
    this.fogAmount = 0.5;
    this.t = 0;
    this.tod = { day: 1, dusk: 0, night: 0 };
    this.wx = { bubbles: 0, rain: 0, aurora: 0, clear: 1, cloud: 0, storm: 0 };
    this.par = { x: 0, y: 0 };
    this.cols = { crest: '#ffffff', sub: '#b8f6ff' };
    this.fresh = true;
    this.ownAero = true;
    this.aero = new AeroOverlay(this, AERO_LOOKS.oscean);
    this.fog = new FogCache();
    this.depthM = 4;
    this.sunPar = PAR.sun;
  }

  baseSurface(H) { return Math.round(H * 0.12); }
  surfaceAt(env) { return Math.round(lerp(this.baseSurface(this.H), -6, ease.inOutCubic(clamp01(env?.flood || 0)))); }
  boatLevel(env) { return this.surfaceAt(env); }
  // the boat stays clear of the pier
  boatRange(W) { return this.pier ? [0, this.pier.x0 - 24] : [0, W]; }

  // ------------------------------------------------------------------ build
  build(W, H) {
    const it = this.steps(W, H);
    while (!it.next().done) { /* run every step */ }
  }

  *steps(W, H) {
    this.W = W; this.H = H;
    this.ready = false;
    this.base = this.baseSurface(H);
    this.top = worldTop(H);
    this.ys = new Int16Array(W + 2);
    this.ys.fill(this.base);
    this.waterBlend = new Blend(); this.ocBlend = new Blend();
    this.rainbow = null; this.aurora = null;
    const prof = {};
    let t0 = performance.now();
    const lap = (k) => { const t1 = performance.now(); prof[k] = Math.round(t1 - t0); t0 = t1; };
    yield* this.skySteps(); lap('sky');
    yield;
    const wo = { y0: this.base - 2, y1: H, levels: 24 };
    this.water = { day: gradientStrip(H, WATER.day, wo), dusk: gradientStrip(H, WATER.dusk, wo), night: gradientStrip(H, WATER.night, wo) };
    this.terrain(); lap('terrain');
    yield;
    this.placeProps(); lap('props');
    yield;
    this.D.render([{ key: 'day', strip: this.water.day }, { key: 'dusk', strip: this.water.dusk }, { key: 'night', strip: this.water.night }]);
    this.bands = new BandSet(this.D);
    this.masks = [0, 1].map((b) => lumaMask(this.D.bands[b].canvases.day, { gamma: 2, gain: 1.15 }));
    this.hazeY = Math.round(this.D.hz - 40);
    this.haze = new FogLayer(hazeMask(W, 80, { peak: 0.6, alpha: 0.55 }), 0, this.hazeY);
    lap('render');
    yield;
    this.buildLife(); lap('life');
    yield;
    this.buildFx(); lap('fx');
    this.buildMs = prof;
    this.ready = true;
    this.fresh = true;
  }

  buildSky() { const it = this.skySteps(); while (!it.next().done) { /* all */ } }

  *skySteps() {
    const W = this.W, base = this.base, top = this.top;
    const P = (this.skyMs = {});
    let t0 = performance.now();
    const lap = (k) => { const t1 = performance.now(); P[k] = Math.round(t1 - t0); t0 = t1; };
    this.sky = new SkyDome({ W, top, base, seed: 31, stops: SKY, stars: 80, haze: 0.2, par: PAR.sun, clouds: { n: 8, size: [26, 60], y: [top + 30, base - 60], scale: 2, par: PAR.clouds } });
    const so = { levels: 10, y0: 0, y1: base + 4 - top };
    const oh = this.sky.h;
    this.overcast = { day: gradientStrip(oh, OVERCAST.day, so), dusk: gradientStrip(oh, OVERCAST.dusk, so), night: gradientStrip(oh, OVERCAST.night, so) };
    const hz = (k) => ({ day: [SKYHZ.day, k], dusk: [SKYHZ.dusk, k + 0.08], night: [SKYHZ.night, Math.min(0.85, k + 0.3)] });
    // the curved grass horizon of a little planet, with its set pieces baked on (turbine rotors spin live)
    lap('dome');
    yield;
    this.edge = this.buildEdge(hz(0.1));
    lap('edge');
    yield;
    for (const h of this.edge.hubs) h.R = rotorFrames(h.L, 1, 10);
    lap('rotors');
    this.arcs = skyArcs(Math.round(W * 0.66), 210);
    this.rays = [sunRays(150, 3), sunRays(150, 7, 18)];
    lap('arcsrays');
    this.globe = new GlassGlobe(54, 24, 4);
    this.globe.frame(0);
    lap('globe');
    this.globePos = { x: Math.round(W * 0.72), y: Math.round(base - 196) };
    const br = leafBranch(2, 78, 2), bl = leafBranch(5, 56, 2, '#3cc84a');
    this.branches = [{ c: br.canvas, x: W - br.w + 6, y: top + 52, ph: 0 }, { c: flipCanvas(bl.canvas), x: -6, y: top + 50, ph: 2 }];
    lap('branches');
    this.splashF = splashFrames(9, 6, 2);
    this.splashes = [];
    this.globeDrops = [];
    this.rainTile = streakTile(96, 48, 26, '#f2fbff', { seed: 3, alpha: 0.85 });
    this.rainTile2 = streakTile(128, 64, 14, '#bfefff', { seed: 8, len: [5, 9], alpha: 0.7 });
    // the rainbow and the aurora ribbons are built the first time their weather shows up
    lap('rest');
  }

  // Curved planet-edge horizon + glass city in a water bubble + lone tree + turbines, composed into one sprite with
  // day / dusk / night haze variants. Returns {w, h, ox, oy (waterline at the left end), hubs, day, dusk, night}.
  buildEdge(haze) {
    const W = this.W;
    const E = planetEdge(W, { peak: 0.38, height: 46, chord: 0.58 });
    const items = [];
    const city = glassCity(3, 2), tree = roundTree(2, 5);
    const towers = [[0.29, 34], [0.62, 40], [0.73, 30]].map(([xf, th]) => ({ xf, T: turbineTower(th, 1) }));
    let minX = 0, minY = 0, maxX = E.w, maxY = E.h;
    const put = (spr, xf, dy = 0) => {
      const [cx, cy] = E.crest(xf);
      const it = { spr, x: Math.round(cx - spr.ox), y: Math.round(cy - spr.oy + dy) };
      items.push(it);
      minX = Math.min(minX, it.x); minY = Math.min(minY, it.y); maxX = Math.max(maxX, it.x + spr.w); maxY = Math.max(maxY, it.y + spr.h);
      return it;
    };
    const cityIt = put(city, 0.13, 4);
    const treeIt = put(tree, 0.5, 3);
    const tw = towers.map((t) => ({ ...t, it: put({ canvas: t.T.canvas, ox: t.T.ox, oy: t.T.oy, w: t.T.w, h: t.T.h }, t.xf, 2) }));
    const bubR = Math.round(city.w * 0.62);
    const bub = voxWaterBubble(bubR);
    const [bcx, bcy0] = E.crest(0.13, 0.3);
    const bc = { x: bcx, y: Math.round(bcy0 - bubR * 0.62) };
    minY = Math.min(minY, bc.y - bub.sy - 4, bc.y - bub.ry - 4); minX = Math.min(minX, bc.x - bub.sx, bc.x - bub.rx);
    const L = 18;
    minY -= L + 2;
    const w = maxX - minX, h = maxY - minY;
    const comp = makeCanvas(w, h);
    const g = ctxOf(comp);
    // the voxel glass shell (faint, behind), the city seen through water, then the edge, then the shell again + its ribbon
    g.globalAlpha = 0.22;
    g.drawImage(bub.shell, bc.x - bub.sx - minX, bc.y - bub.sy - minY);
    g.globalAlpha = 1;
    g.drawImage(city.canvas, cityIt.x - minX, cityIt.y - minY);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.18;
    g.fillStyle = '#7ad8ff';
    g.fillRect(cityIt.x - minX, cityIt.y - minY, city.w, city.h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(E.canvas, -minX, -minY);
    g.drawImage(tree.canvas, treeIt.x - minX, treeIt.y - minY);
    const hubs = [];
    const r = new RNG(12);
    for (const t of tw) {
      g.drawImage(t.T.canvas, t.it.x - minX, t.it.y - minY);
      hubs.push({ x: t.it.x - minX + t.T.hub[0], y: t.it.y - minY + t.T.hub[1], L: Math.max(5, Math.round(t.T.h * 0.36)), ph: r.float(0, TAU), v: r.float(1.6, 2.4) });
    }
    g.globalAlpha = 0.3;
    g.drawImage(bub.shell, bc.x - bub.sx - minX, bc.y - bub.sy - minY);
    g.globalAlpha = 1;
    g.drawImage(bub.ribbon, bc.x - bub.rx - minX, bc.y - bub.ry - minY);
    const out = { w, h, ox: E.ox - minX, oy: E.oy - minY, hubs };
    for (const [k, [col, a]] of Object.entries(haze)) out[k] = hazed(comp, col, a);
    out.blend = new Blend();
    return out;
  }

  // The flooded wallpaper: a voxel heightfield of rolling grass hills (front meadow, a shoulder on the left, the big
  // glossy hill to the right, a periodic far range), shaded with a specular sheen and sprinkled with flowers.
  terrain() {
    const W = this.W, H = this.H;
    const D = new DepthScene(W, H, { yFront: H - 62, yFar: H - 168, pad: 24, zFar: 1.9, fogStart: -0.2, fog: 0.6 });
    this.D = D;
    const cx = D.cx;
    const span = (W / 2 + D.pad + 6) / D.s(1.25), X0 = cx - span, per = (Math.ceil((2 * span) / 2) + 2) * 2;
    const HX = cx + W * 0.24, LX = cx - W * 0.62;
    const smoothH = (X, z) => {
      const dx = (X - HX) / (W * 0.56), dz = (z - 1.04) / 0.38;
      let h = 290 * Math.exp(-dx * dx - dz * dz);
      const dx2 = (X - LX) / (W * 0.42), dz2 = (z - 0.8) / 0.3;
      h += 110 * Math.exp(-dx2 * dx2 - dz2 * dz2);
      h += smoothstep(0.22, 0.8, z) * (0.5 + 0.5 * Math.sin(X * 0.0062 + 0.6)) * 24;
      const ph = ((X - X0) / per) * TAU;
      h += smoothstep(1.02, 1.5, z) * (150 + 58 * Math.sin(ph * 2 + 0.7) + 34 * Math.sin(ph * 5 + 2.1));
      return h;
    };
    this.smoothH = smoothH;
    let lastS = 0;
    const height = (X, z) => {
      let h = (lastS = smoothH(X, z));
      const front = 1 - smoothstep(0.0, 0.45, z);
      h += (fbm2(X * 0.0045, z * 1.6, 3, 21) - 0.5) * 16 * (1 - front * 0.55) + Math.sin(X * 0.011 + z * 5) * 2 * front;
      return Math.max(-2, h);
    };
    // gloss: half vector between the top-left light and the viewer
    const Lv = [-0.42, 0.85, -0.32], V = [0, 0.4, -1];
    let Hx = Lv[0] + V[0], Hy = Lv[1] + V[1], Hz = Lv[2] + V[2];
    { const l = Math.hypot(Hx, Hy, Hz); Hx /= l; Hy /= l; Hz /= l; }
    const G0 = [38, 150, 46], G1 = [74, 196, 58], G2 = [148, 228, 80], GL = [190, 244, 110];
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.72, diffuse: 0.4, ao: 0.05, jitter: 0.02, wall: 0.95, side: 0.97, crest: 1.045, fullHeight: true,
      height,
      color: (X, z, h) => {
        const k = clamp01(h / 300);
        let c = k < 0.5 ? [lerp(G0[0], G1[0], k * 2), lerp(G0[1], G1[1], k * 2), lerp(G0[2], G1[2], k * 2)] : [lerp(G1[0], G2[0], (k - 0.5) * 2), lerp(G1[1], G2[1], (k - 0.5) * 2), lerp(G1[2], G2[2], (k - 0.5) * 2)];
        const n = fbm2(X * 0.012, z * 3.2, 2, 5);
        if (n > 0.6) c = [lerp(c[0], GL[0], 0.45), lerp(c[1], GL[1], 0.45), lerp(c[2], GL[2], 0.45)];
        else if (n < 0.36) c = [c[0] * 0.86, c[1] * 0.9, c[2] * 0.84];
        // glossy sheen from the smooth hill shape (forward differences; the far range is fogged anyway)
        if (z < 1.25) {
          const dX = (smoothH(X + 4, z) - lastS) / 4, dZ = (smoothH(X, z + 0.04) - lastS) / 8;
          let nx = -dX, ny = 1, nz = -dZ;
          const nl = Math.hypot(nx, ny, nz);
          nx /= nl; ny /= nl; nz /= nl;
          const hd = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
          const sp = Math.pow(hd, 22) * 0.9 + Math.pow(hd, 6) * 0.12;
          if (sp > 0.02) c = [lerp(c[0], 236, sp), lerp(c[1], 255, sp), lerp(c[2], 196, sp)];
        }
        // flowers and clover in the near meadow
        if (z < 0.7) {
          const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 5);
          const f = 0.012 * (1 - z);
          if (hs < f * 0.4) return [255, 255, 255];
          if (hs < f * 0.65) return [255, 226, 64];
          if (hs < f * 0.8) return [255, 140, 196];
          if (hs < f) return [140, 214, 255];
        }
        return c;
      },
    });
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = D.floorAt(x, 0);
  }

  placeProps() {
    const W = this.W, D = this.D;
    // underwater wind turbines (towers baked, rotors live)
    this.turbines = [];
    for (const [xf, z, th, sc] of [[0.13, 0.36, 74, 1.7], [0.78, 0.9, 64, 1.05], [0.6, 1.12, 56, 0.8]]) {
      const s = qscale(sc, 0.05, 0.4);
      const T = turbineTower(th, s);
      // double-resolution twin for the zoomed-in camera (DepthScene hi-res pass)
      if (!T.hi) Object.defineProperty(T, 'hi', { value: () => turbineTower(th, s * 2), enumerable: false });
      const x = Math.round(xf * W);
      const it = D.add({ sprite: T, x, z, dy: 2 });
      const L = Math.round(th * 0.4);
      this.turbines.push({ x: it.x - T.ox + T.hub[0], y: it.y - T.oy + T.hub[1], z, band: it.band, R: rotorFrames(L, s, 10), L, s, R2: null, ph: xf * 9, v: 0.25 + (1 - z) * 0.1 });
    }
    // glass orbs resting in the grass
    this.restOrbs = [];
    for (const [xf, z, r, ti] of [[0.47, 0.12, 9, 0], [0.505, 0.06, 5, 1], [0.27, 0.42, 7, 2], [0.86, 0.22, 8, 3], [0.68, 0.6, 6, 4], [0.215, 0.05, 4, 0]]) {
      const b = voxBall(r, ORB_TINTS[ti], { spec: 0.95 });
      const spr = { canvas: b.canvas, ox: b.ox, oy: b.h - 1 };
      spr.hi = () => { const b2 = voxBall(r * 2, ORB_TINTS[ti], { spec: 0.95 }); return { canvas: b2.canvas, ox: b2.ox, oy: b2.h - 2 }; };
      const it = D.add({ sprite: spr, x: Math.round(xf * W), z, dy: 2 });
      this.restOrbs.push({ x: it.x, y: it.y - r - 1, r, z, band: it.band, tint: ORB_TINTS[ti] });
    }
    // the meadow is a grass-and-flower field (no coral here): plants are placed in buildLife()
    const big = this.restOrbs[0];
    this.orbSecret = { x: big.x - big.r - 2, y: big.y - big.r - 2, w: big.r * 2 + 4, h: big.r * 2 + 4, cx: big.x, cy: big.y };
  }

  buildLife() {
    const W = this.W, H = this.H, D = this.D;
    const r = new RNG(9);
    this.decor = new DepthDecor(D);
    this.glowDecor = [];
    const sc = (z, step = 0.2) => qscale(1.5 * D.s(z), step, 0.3);
    const add = (A, x, z, glow = false) => {
      const it = this.decor.add({ anim: placeAnim(A, x, Math.round(D.floorAt(x, z)) + 1), z, off: r.int(0, A.n - 1) });
      if (glow && A.nights[0]) this.glowDecor.push({ anim: it.anim, off: it.off, band: it.band, z });
      return it;
    };
    // swaying grass tufts all over the meadow and up the hill
    const tufts = [[0.09, 0.12], [0.16, -0.18], [0.24, 0.2], [0.31, -0.06], [0.39, 0.16], [0.44, -0.2], [0.55, 0.1], [0.61, -0.14], [0.66, 0.22],
      [0.74, -0.04], [0.8, 0.14], [0.88, -0.16], [0.2, 0.5], [0.33, 0.6], [0.5, 0.45], [0.62, 0.58], [0.75, 0.5], [0.9, 0.62], [0.12, 0.7]];
    for (const [xf, z] of tufts) add(voxAnim('seagrass', 1 + r.int(0, 2), 'oscean', 8, sc(z), 8), Math.round(xf * W), z);
    // flowers, glossy leaves, aqua bubble plants, app-like crystal plants
    // each plant also knows its double-detail twin (o.hi), built in the background for the zoomed-in camera
    const flower = (seed, xf, z, size) => { const k = sc(z); const s = Math.round(size * k), s2 = s * 2; add(swayAnim('flw' + seed + '|' + s, [s * 3 + 10, s * 2 + 12, 12], buildFlowers(s), { seed, frames: 6, period: 3.6, hi: { key: 'flw' + seed + '|' + s2, dims: [s2 * 3 + 20, s2 * 2 + 24, 24], build: buildFlowers(s2) } }), Math.round(xf * W), z); };
    const leaves = (seed, xf, z, size, hue, frames = 6) => { const k = sc(z); const s = Math.round(size * k), s2 = s * 2; add(swayAnim('lvs' + seed + '|' + s + hue, [s * 3 + 10, s * 2 + 10, 16], buildLeaves(s, hue), { seed, frames, period: 4.2, hi: { key: 'lvs' + seed + '|' + s2 + hue, dims: [s2 * 3 + 20, s2 * 2 + 20, 32], build: buildLeaves(s2, hue) } }), Math.round(xf * W), z); };
    flower(1, 0.065, 0.02, 12); flower(2, 0.345, -0.12, 11); flower(3, 0.585, 0.06, 12); flower(5, 0.97, 0.12, 11); flower(7, 0.83, 0.38, 12);
    // big glossy leaves framing the bottom corners, smaller clumps on the meadow
    leaves(11, 0.01, -0.36, 30, '#26c83a', 4); leaves(13, 0.99, -0.34, 32, '#22c040', 4); leaves(12, 0.405, 0.04, 13, '#4ad85a'); leaves(14, 0.56, 0.36, 13, '#5ae06a');
    // a meadow of only grass and flowers: dense flower patches and extra grass across the whole hill
    let fs = 40;
    for (const [xf, z, size] of [[0.15, 0.08, 10], [0.22, -0.1, 11], [0.29, 0.3, 10], [0.37, 0.12, 12], [0.47, -0.16, 10], [0.5, 0.28, 11], [0.6, 0.44, 10],
      [0.69, -0.06, 12], [0.73, 0.3, 11], [0.79, -0.2, 10], [0.9, 0.3, 11], [0.25, 0.62, 10], [0.4, 0.58, 11], [0.55, 0.7, 10], [0.7, 0.66, 11], [0.86, 0.56, 10]]) flower(fs++, xf, z, size);
    for (const [xf, z] of [[0.04, 0.3], [0.13, 0.36], [0.27, -0.24], [0.35, 0.38], [0.48, 0.04], [0.57, -0.24], [0.64, 0.32], [0.71, 0.08], [0.84, -0.08],
      [0.94, 0.42], [0.18, 0.86], [0.38, 0.84], [0.58, 0.9], [0.78, 0.86], [0.96, 0.9]]) add(voxAnim('seagrass', 1 + r.int(0, 2), 'oscean', 8, sc(z), 8), Math.round(xf * W), z);
    // floating glass orbs and chrome droplets in the open water
    const sy = this.base;
    this.orbs = [];
    for (let i = 0; i < 6; i++) this.orbs.push({ x: r.float(0, W), y: r.float(sy + 40, H * 0.55), r: r.pick([4, 5, 6, 8, 10]), tint: ORB_TINTS[i % ORB_TINTS.length], ph: r.float(0, TAU), vx: r.float(-3, 3), far: i < 2 });
    this.drops = [];
    for (let i = 0; i < 4; i++) this.drops.push({ x: r.float(40, W - 40), y: r.float(sy + 60, H * 0.7), h: r.pick([9, 11, 14]), ph: r.float(0, TAU), vx: r.float(-2, 2) });
    // clouds made of bubbles drifting through the "sky" water above the hill
    this.bclouds = [];
    for (let i = 0; i < 5; i++) {
      const w = r.int(70, 140), h = Math.round(w * r.float(0.34, 0.42));
      this.bclouds.push({ spr: voxCloudSprite(40 + i, w, h, 'day'), x: r.float(-40, W), y: Math.round(lerp(sy + 24, sy + 170, i / 4)) + r.int(-10, 10), v: r.float(1.5, 3.2) });
    }
    // particles
    this.plankton = new Motes(90, { x0: 0, y0: sy + 4, x1: W, y1: H - 60 }, { seed: 3, vx: [-3, 3], vy: [-2.5, 1.5], sizes: [1, 1, 1, 2], colors: ['#ffffff', '#e0fbff', '#d8ffd0', '#fff6c8'], alpha: [0.25, 0.8], wob: 5 });
    this.nearMotes = new Motes(24, { x0: 0, y0: sy + 10, x1: W, y1: H - 30 }, { seed: 8, vx: [-5, 5], vy: [-3, 3], sizes: [2, 2, 3], colors: ['#ffffff', '#d8faff'], alpha: [0.14, 0.32], wob: 8 });
    this.glowMotes = new Motes(36, { x0: 0, y0: sy + 20, x1: W, y1: H - 50 }, { seed: 12, vx: [-4, 4], vy: [-2, 2], sizes: [1], colors: ['#7affea', '#9ad8ff', '#c8ff9a', '#ff9ae8'], alpha: [0.5, 1], wob: 6 });
    this.bubbles = new Bubbles(80, '#e8fdff');
    this.emitT = { tuft: 1, orb: 2 };
    this.soap = [];
    this.soapT = 0;
    this.airSoap = [];
    this.rain = [];
    this.fallDrops = [];
    this.dolphin = new VoxelGiant('dolphin');
    this.pod = null;
    this.podT = 6;
    this.giantFog = new FogCache();
    // the glossy pier on the right and its NPCs
    const P = pierModel(104, 26, 2);
    const x0 = W - 200;
    const deckY = this.base - 8;
    this.pier = { P, x0, x: x0 - P.deckL[0], y: deckY - P.deckL[1], deckY };
    const cut = clamp(Math.round(this.base + 2 - this.pier.y), 0, P.h);
    this.pier.top = cropRows(P.canvas, 0, cut);
    this.pier.under = hazed(cropRows(P.canvas, cut, P.h), '#4ab4ea', 0.5);
    this.pier.cut = cut;
    this.npcs = [{ id: 'marina', x: x0 + 46, facing: -1, ph: 0, pose: 'wave' }, { id: 'fizz', x: x0 + 132, facing: -1, ph: 2.1, pose: 'idle' }];
    this.secretT = 0;
  }

  buildFx() {
    const W = this.W, H = this.H;
    const rh = H - this.base;
    this.raysA = new FogLayer(makeRays(W, rh, { seed: 14, count: 9, sunX: W * 0.72, sunY: -H * 0.8, minW: 12, maxW: 40, len: 1, color: '#ffffff', alpha: 0.55, levels: 6 }));
    this.raysB = new FogLayer(makeRays(W, rh, { seed: 19, count: 16, sunX: W * 0.7, sunY: -H * 0.7, minW: 3, maxW: 10, len: 0.8, color: '#ffffff', alpha: 0.65, levels: 4 }));
    this.caustics = new Caustics({ tw: 240, th: 64, cx: 9, cy: 4, seed: 17, color: '#ffffff', thick: 0.55, core: 0.7, rim: 0.2 });
    this.shimmer = makeShimmer(W);
  }

  floorAt(x, z = 0) { return this.D ? this.D.floorAt(x, z) : super.floorAt(x); }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    if (!this.ready) return;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    const t = this.t, W = this.W, H = this.H;
    const tod = todWeights(env);
    this.tod = tod;
    const snap = this.fresh;
    const k = snap ? 1 : 1 - Math.exp(-dt * 0.6);
    const w = env.weather, wx = this.wx;
    wx.bubbles += ((w === 'bubbles' ? 1 : 0) - wx.bubbles) * k;
    wx.rain += ((w === 'glossyrain' ? 1 : 0) - wx.rain) * k;
    wx.aurora += ((w === 'aurora' ? 1 : 0) - wx.aurora) * k;
    wx.cloud = wx.rain * 0.55;
    wx.clear = clamp01(1 - wx.rain * 0.55);
    const c = env.cursor;
    const tx = c && c.x > -50 ? clamp((c.x / W - 0.5) * -2, -1, 1) : 0, ty = c && c.y > -50 ? clamp((c.y / H - 0.5) * -2, -1, 1) : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    this.cols.crest = tri('#ffffff', '#ffe8cc', '#b8d8ff', tod);
    this.cols.sub = tri('#b8f6ff', '#e0b8c0', '#5a90d0', tod);
    this.fogColor = tri('#5cc4f2', '#5a7ac0', '#1e4c90', tod);
    const fkey = Math.round(tod.day * 40) + ',' + Math.round(tod.dusk * 40);
    this.decor.refog((y) => waterColorAt(WATER, tod, y, this.base - 2, H), fkey);
    const q = quality(env);
    const sy = this.surfaceAt(env);
    const wind = 1 + wx.bubbles * 1.6 + wx.rain * 0.5;
    this.sky.update(dt, wind);
    // waves + rain on the surface
    waveLine(this.ys, W, sy, t, 1.3 + wx.rain * 0.7 + wx.bubbles * 0.4, 0.3 + wx.rain * 0.5, 1 + wx.bubbles * 0.3);
    this.applySimLift(this.ys);
    const water = this.game?.water;
    if (wx.rain > 0.05) {
      let n = 22 * wx.rain * q * dt;
      while (n > 0) {
        if (Math.random() < n) {
          const d = { x: Math.random() * W, t: 0, big: Math.random() < 0.25 };
          this.rain.push(d);
          if (water) { water.surf.impulse(d.x, d.big ? -12 : -6, 4); if (Math.random() < 0.4) water.disturb(d.x, sy + 4 + Math.random() * 20, d.big ? 0.2 : 0.1, 3); }
        }
        n -= 1;
      }
      if (Math.random() < dt * 0.8 * wx.rain && this.fallDrops.length < 6) this.fallDrops.push({ x: 40 + Math.random() * (W - 80), y: this.top + 40 + Math.random() * 60, vy: 120, h: Math.random() < 0.5 ? 9 : 12 });
    }
    for (const d of this.rain) d.t += dt;
    this.rain = this.rain.filter((d) => d.t < 0.6);
    for (const d of this.fallDrops) {
      d.vy += 260 * dt; d.y += d.vy * dt;
      if (d.y >= this.waveAt(d.x) - 2 && !d.splashed) { d.splashed = true; water?.splash?.(d.x, 0.5, 6); this.game?.particles?.splash?.(d.x, sy, 0.4); }
    }
    this.fallDrops = this.fallDrops.filter((d) => !d.splashed);
    // particles
    const cur = Math.sin(t * 0.21) * 3 + wx.bubbles * 5;
    this.plankton.update(dt, cur, 0);
    this.nearMotes.update(dt, cur * 1.4, 0);
    this.glowMotes.update(dt, cur, 0);
    this.bubbles.update(dt, sy);
    const e = this.emitT;
    e.tuft -= dt; e.orb -= dt;
    if (e.tuft <= 0) { e.tuft = 0.6 + Math.random() * 1.2; const x = Math.random() * W; this.bubbles.emit(x, this.floorAt(x, Math.random() * 0.3) + 2, { r: Math.random() < 0.2 ? 2 : 1 }); }
    if (e.orb <= 0) { e.orb = 1.5 + Math.random() * 2; const o = this.restOrbs[Math.floor(Math.random() * 3)]; this.bubbles.emit(o.x + (Math.random() - 0.5) * o.r, o.y - o.r, { r: 1 }); }
    for (const cl of this.bclouds) { cl.x += cl.v * dt * (1 + wx.bubbles); if (cl.x > W + 10) cl.x = -cl.spr.width - 10; }
    for (const o of this.orbs) { o.x += o.vx * dt; if (o.x < -20) o.x = W + 20; if (o.x > W + 20) o.x = -20; }
    for (const d of this.drops) { d.x += d.vx * dt; if (d.x < -20) d.x = W + 20; if (d.x > W + 20) d.x = -20; }
    // soap bubbles: underwater (rising) and in the air (bubble breeze)
    this.soapT -= dt * (0.25 + wx.bubbles * 2.5) * q;
    if (this.soapT <= 0) {
      this.soapT = 1;
      if (this.soap.length < 14) this.soap.push({ x: Math.random() * W, y: H - 30 - Math.random() * 60, r: 4 + Math.floor(Math.random() * 7), vy: -(10 + Math.random() * 10), ph: Math.random() * TAU });
      if (wx.bubbles > 0.2 && this.airSoap.length < 24) this.airSoap.push({ x: -20 - Math.random() * 40, y: sy - 10 - Math.random() * 120, r: 3 + Math.floor(Math.random() * 8), vx: 18 + Math.random() * 26, vy: -(2 + Math.random() * 6), ph: Math.random() * TAU, life: 0 });
    }
    for (const b of this.soap) { b.y += b.vy * dt; b.x += Math.sin(t * 0.9 + b.ph) * dt * 6; }
    this.soap = this.soap.filter((b) => b.y > sy + b.r + 2);
    for (const b of this.airSoap) { b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(t * 1.3 + b.ph) * dt * 8; b.life += dt; }
    this.airSoap = this.airSoap.filter((b) => b.x < W + 30 && b.life < 30);
    // turbines
    for (const tb of this.turbines) tb.ph += dt * tb.v * (1 + wx.bubbles * 0.8);
    for (const h of this.edge.hubs) h.ph += dt * h.v * (1 + wx.bubbles * 1.2 + wx.rain * 0.4);
    this.globe.warm();
    // the globe drips into the sea; splashes pop up along the surface
    const gp = this.globePos, gr = this.globe.r;
    this.globeY = gp.y + Math.sin(t * 0.6) * 4 + PAR.globe * ((env.scroll ?? 0) - (env.ref ?? 0));
    const dip = this.globeY + gr - this.waveAt(gp.x);
    if (dip < -6) { if (Math.random() < dt * 0.9 && this.globeDrops.length < 4) this.globeDrops.push({ x: gp.x + (Math.random() - 0.5) * 50, y: this.globeY + gr * 0.7, vy: 20, h: Math.random() < 0.5 ? 7 : 9 }); }
    else if (Math.random() < dt * 3 * q) {
      // dipping into the sea: splashes where the glass meets the water
      const hw = Math.sqrt(Math.max(0, gr * gr - (gr - dip) ** 2));
      this.addSplash(gp.x + (Math.random() < 0.5 ? -1 : 1) * (hw + Math.random() * 4), 0.6 + Math.random() * 0.5);
    }
    for (const d of this.globeDrops) {
      d.vy += 240 * dt; d.y += d.vy * dt;
      if (d.y >= this.waveAt(d.x) - 1) { d.done = true; this.addSplash(d.x, 0.7); water?.splash?.(d.x, 0.35, 5); }
    }
    this.globeDrops = this.globeDrops.filter((d) => !d.done);
    if (Math.random() < dt * (0.5 + wx.bubbles + wx.rain * 2) * q) this.addSplash(Math.random() * W, 0.5 + Math.random() * 0.5);
    for (const sp of this.splashes) sp.t += dt;
    this.splashes = this.splashes.filter((sp) => sp.t < sp.dur);
    // dolphin pod in the far water
    if (this.pod) {
      this.dolphin.warm();
      const p = this.pod;
      p.x += p.dir * p.v * dt;
      p.ph += dt * 3.2;
      if (p.x < -260 || p.x > W + 260) { this.pod = null; this.podT = 20 + Math.random() * 30; }
    } else {
      this.podT -= dt;
      if (this.podT <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.pod = { dir, x: dir > 0 ? -160 : W + 160, y: H * (0.26 + Math.random() * 0.12), v: 26 + Math.random() * 10, ph: 0 };
      }
    }
    for (const n of this.npcs) n.ph += dt;
    this.secretT = Math.max(0, this.secretT - dt);
    this.aero.update(dt, env);
  }

  addSplash(x, k = 1) {
    if (this.splashes.length > 10) return;
    if (this.pier && x > this.pier.x0 - 8) return;
    this.splashes.push({ x, t: 0, dur: 0.55 + k * 0.25, k });
  }

  secrets() { return this.game?.state?.secrets || {}; }

  // ------------------------------------------------------------------ draw: sky & surface
  drawAir(g, env) {
    const W = this.W, t = this.t, tod = this.tod, wx = this.wx, sky = this.sky;
    const view = env.view;
    const sp = sky.span(view);
    if (!sp) return;
    const [y0, y1] = sp;
    const scroll = env.scroll ?? 0, ref = env.ref ?? 0;
    g.save();
    g.beginPath();
    g.rect(0, y0, W, y1 - y0);
    g.clip();
    sky.drawGradient(g, tod, view, PAR.sky * (scroll - ref));
    // aurora / Aero light ribbons
    const au = wx.aurora * (0.28 + 0.72 * tod.night) + tod.night * 0.08;
    if (au > 0.02) {
      g.globalCompositeOperation = 'lighter';
      this.aurora ||= [auroraRibbon(480, 130, 5), auroraRibbon(400, 110, 9, ['#a8ffd8', '#7ad8ff', '#ff9ae0'])];
      this.aurora.forEach((spr, i) => {
        const pat = g.createPattern(spr, 'repeat-x');
        const ox = (t * (i ? -7 : 5)) % spr.width;
        const yy = this.top + 40 + i * 50 + Math.round(PAR.aurora * (scroll - ref));
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, yy]));
        g.globalAlpha = au * (0.75 + 0.25 * Math.sin(t * 0.6 + i * 2)) * (i ? 0.7 : 1);
        g.fillStyle = pat;
        g.fillRect(0, yy, W, spr.height);
      });
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    const clear = wx.clear;
    // sun rays fanning out behind everything
    const B = skyBodies(env.hour ?? 12, W, this.top, this.base);
    const pv = Math.round(PAR.sun * (scroll - ref));
    const ra = clear * (tod.day + tod.dusk * 0.7) * (B.sun.up ? 1 : 0);
    if (ra > 0.02) {
      g.globalCompositeOperation = 'lighter';
      this.rays.forEach((spr, i) => {
        g.globalAlpha = ra * (i ? 0.5 + 0.5 * Math.sin(t * 0.21) : 0.5 - 0.5 * Math.sin(t * 0.21)) * 0.75;
        g.drawImage(spr, Math.round(B.sun.x - (spr.width >> 1)), Math.round(B.sun.y + pv - (spr.height >> 1)));
      });
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    sky.drawBodies(g, env, tod, clear, scroll, ref);
    // white arc lines sweeping across the sky
    const aa = (0.55 + tod.day * 0.35) * (1 - tod.night * 0.6) * (1 - wx.rain * 0.4);
    if (aa > 0.03) {
      g.globalAlpha = aa * (0.85 + 0.15 * Math.sin(t * 0.5));
      g.drawImage(this.arcs, Math.round(W * 0.2), this.base - 250 + Math.round(PAR.arcs * (scroll - ref)));
      g.globalAlpha = 1;
    }
    // rainbow after the glossy rain
    const rb = wx.rain * (tod.day + tod.dusk * 0.4) * 0.9;
    if (rb > 0.02) {
      g.globalAlpha = rb * (0.7 + 0.2 * Math.sin(t * 0.4));
      this.rainbow ||= rainbowArc(Math.round(W * 0.42), 4);
      g.drawImage(this.rainbow, Math.round(W * 0.42 - this.rainbow.width / 2), this.base - this.rainbow.height + 4 + Math.round(0.1 * (scroll - ref)));
      g.globalAlpha = 1;
    }
    sky.drawClouds(g, tod, scroll, ref, wx.rain * 0.35, 1, view);
    const oc = wx.rain * 0.45;
    if (oc > 0.01) {
      g.globalAlpha = oc;
      const strip = this.ocBlend.get([[this.overcast.day, tod.day], [this.overcast.dusk, tod.dusk], [this.overcast.night, tod.night]]);
      const pat = g.createPattern(strip, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, 0, this.top]));
      g.fillStyle = pat;
      g.fillRect(0, y0, W, y1 - y0);
      g.globalAlpha = 1;
    }
    // the floating green glass globe (drips into the sea)
    this.drawGlobe(g, scroll, ref);
    // the curved grass horizon with its city bubble, tree and turbines
    const E = this.edge;
    {
      const c = E.blend.get([[E.day, tod.day], [E.dusk, tod.dusk], [E.night, tod.night]]);
      // the planet sinks behind the horizon as the camera dives (a thin curved band in the default view)
      const x = -E.ox, y = this.base + 2 - E.oy + Math.round(clamp(PAR.sink * (scroll - ref), 0, 86));
      g.drawImage(c, x, y);
      g.globalAlpha = 1 - tod.night * 0.35;
      for (const h of E.hubs) {
        const R = h.R, f = R.frames[Math.floor(((h.ph / (TAU / 3)) * R.n) % R.n + R.n) % R.n];
        g.drawImage(f, Math.round(x + h.x - R.cx), Math.round(y + h.y - R.cy));
      }
      g.globalAlpha = 1;
    }
    // soap bubbles riding the breeze
    for (const b of this.airSoap) {
      const spr = soapBubble(b.r);
      g.drawImage(spr, Math.round(b.x - b.r - 1), Math.round(b.y - b.r - 1));
    }
    // glossy rain
    if (wx.rain > 0.05) {
      for (const [tile, a, v] of [[this.rainTile, 0.55, 170], [this.rainTile2, 0.35, 240]]) {
        const oy = Math.floor((t * v) % tile.height), ox = Math.floor((oy / 3) % tile.width);
        const pat = g.createPattern(tile, 'repeat');
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, -ox, oy]));
        g.globalAlpha = wx.rain * a;
        g.fillStyle = pat;
        g.fillRect(0, y0, W, y1 - y0);
      }
      g.globalAlpha = 1;
      for (const d of this.fallDrops) { const spr = chromeDrop(d.h); g.drawImage(spr, Math.round(d.x - spr.width / 2), Math.round(d.y - d.h)); }
    }
    // glossy leafy branches framing the top corners
    for (const b of this.branches) {
      const sway = Math.round(Math.sin(t * 0.7 + b.ph) * 1.5 * (1 + wx.bubbles));
      g.globalAlpha = 1 - tod.night * 0.3;
      g.drawImage(b.c, b.x + sway, b.y + Math.round(0.35 * (scroll - ref)) + Math.round(Math.sin(t * 0.5 + b.ph)));
    }
    g.globalAlpha = 1;
    g.restore();
  }

  drawGlobe(g, scroll, ref) {
    const G = this.globe, P = this.globePos, tod = this.tod;
    const spr = G.get(Math.floor(this.t / 0.42));
    const x = P.x - (spr.width >> 1), y = Math.round(this.globeY ?? P.y) - (spr.height >> 1);
    drawGlow(g, P.x, y + (spr.height >> 1), 70, '#c8ffb0', (0.25 + tod.day * 0.15) * (1 - tod.night * 0.5));
    g.globalAlpha = 1 - tod.night * 0.3;
    g.drawImage(spr, x, y);
    g.globalAlpha = 1;
    for (const d of this.globeDrops) { const c = chromeDrop(d.h, '#7af0a8'); g.drawImage(c, Math.round(d.x - c.width / 2), Math.round(d.y - d.h)); }
  }

  drawBack(ctx, env) {
    this.nearHooked = !!this.nearSeen;
    this.nearSeen = false;
    if (!this.ready) { super.drawBack(ctx, env); return; }
    const W = this.W, H = this.H, tod = this.tod;
    const sy = this.surfaceAt(env);
    const ys = this.ys;
    let top = H;
    for (let x = 0; x <= W; x++) if (ys[x] < top) top = ys[x];
    const water = this.waterBlend.get([[this.water.day, tod.day], [this.water.dusk, tod.dusk], [this.water.night, tod.night]]);
    const view = env.view;
    const hasAir = !view || view.y0 < top + 2;
    if (hasAir) {
      this.drawAir(ctx, env);
      const wp = new Path2D();
      wp.moveTo(0, H);
      waveRuns(ys, W, (x0, len, y) => { wp.lineTo(x0, y); wp.lineTo(x0 + len, y); });
      wp.lineTo(W, H);
      wp.closePath();
      ctx.fillStyle = ctx.createPattern(water, 'repeat');
      ctx.fill(wp);
    } else fillWith(ctx, water, 0, -10, W, H + 10);
    const t = this.t, px = this.par.x, py = this.par.y;
    const wob = quality(env) >= 1 ? 1 : 0;
    const key = this.waterBlend.key;
    // clouds made of bubbles in the open "sky" water
    const ca = 0.55 - tod.night * 0.3;
    ctx.globalAlpha = ca;
    for (const cl of this.bclouds) drawWobble(ctx, cl.spr, cl.x + px * 0.6, cl.y + py * 0.3, t + cl.x * 0.01, wob, 3, 1, 0.08);
    ctx.globalAlpha = 1;
    // distant orbs
    for (const o of this.orbs) if (o.far) this.drawOrb(ctx, o, 0.45, px * 0.8, py * 0.4);
    this.drawPod(ctx);
    // far band of the hills
    this.bands.draw(ctx, 2, tod, px * 2, py * 0.6);
    ctx.drawImage(this.haze.tint(water, 1, key), 0, this.hazeY);
    this.drawRotors(ctx, 2, px * 2, py * 0.6);
    this.decor.draw(ctx, 2, t, px * 2, py * 0.6, 1 + this.wx.bubbles * 0.6);
    this.drawWaterSheet?.(ctx, env); // [phase5:water] the water sheet sits behind the near-surface details (the pier stands in front)
    if (hasAir) this.drawPier(ctx, env, sy);
    this.drawSurface(ctx, env, sy);
    this.aero.drawBack(ctx, env);
  }

  drawOrb(ctx, o, fogA, dx, dy) {
    const b = voxBall(o.r, o.tint, { spec: 0.95 });
    const y = o.y + Math.sin(this.t * 0.8 + o.ph) * 4;
    const col = waterColorAt(WATER, this.tod, y, this.base - 2, this.H);
    ctx.drawImage(this.fog.get(b.canvas, col, fogA), Math.round(o.x + dx - b.ox), Math.round(y + dy - b.oy));
  }

  drawPod(ctx) {
    const p = this.pod;
    if (!p) return;
    const col = waterColorAt(WATER, this.tod, p.y, this.base - 2, this.H);
    for (const [ox, oy, k] of [[0, 0, 0], [-46, 14, 1.3], [-80, -6, 2.4]]) {
      const f = this.dolphin.frame(p.ph + k, p.dir);
      const c = this.giantFog.get(f.canvas, col, 0.55);
      const y = p.y + oy + Math.sin(p.ph * 0.25 + k) * 5;
      ctx.drawImage(c, Math.round(p.x + ox * p.dir - f.ox + this.par.x), Math.round(y - f.oy + this.par.y * 0.5), f.w, f.h); // [phase6:creatures] hi-res low-poly dolphin
    }
  }

  drawRotors(ctx, band, dx, dy) {
    const tod = this.tod;
    const hi = zoomOf(ctx) > 1.3;
    for (const tb of this.turbines) {
      if (tb.band !== band) continue;
      const R2 = hi ? tb.R2 : null, R = R2 || tb.R, f = R.frames[Math.floor(((tb.ph / (TAU / 3)) * R.n) % R.n + R.n) % R.n];
      const col = waterColorAt(WATER, tod, tb.y, this.base - 2, this.H);
      const c = this.fog.get(f, col, this.D.fog(tb.z));
      if (R2) ctx.drawImage(c, Math.round(tb.x + dx) - R2.cx / 2, Math.round(tb.y + dy) - R2.cy / 2, c.width / 2, c.height / 2);
      else ctx.drawImage(c, Math.round(tb.x + dx - R.cx), Math.round(tb.y + dy - R.cy));
    }
  }

  // Ocean.hiPass extra: double-detail rotors for the zoomed-in camera (one turbine per step).
  *hiExtraSteps() {
    for (const tb of this.turbines || []) { if (!tb.R2) tb.R2 = rotorFrames(tb.L * 2, tb.s, 10); yield; }
  }

  drawPier(ctx, env, sy) {
    const p = this.pier;
    if (!p) return;
    const lift = sy - this.base;
    const x = p.x, y = p.y + lift;
    ctx.drawImage(p.under, x, y + p.cut);
    ctx.drawImage(p.top, x, y);
    // NPCs standing on the deck (drawNPC is owned by the character module)
    const deck = p.deckY + lift;
    for (const n of this.npcs) {
      // same size as the fisherman on the boat; Marina waves now and then
      const pose = n.pose === 'wave' && (n.ph % 9) > 6.5 ? 'wave' : 'idle';
      // under the zoomed camera the NPCs render at twice the resolution and draw back at half size (crisp)
      const R = zoomOf(ctx) > 1.3 ? 2 : 1;
      if (R > 1) { ctx.save(); ctx.scale(1 / R, 1 / R); }
      try { NPC.drawNPC?.(ctx, n.id, { x: n.x * R, y: deck * R, t: n.ph, scale: 0.62 * R, facing: n.facing, pose, mood: 'happy', id: 'pier_' + n.id }); } catch { /* npc art pending */ }
      if (R > 1) ctx.restore();
    }
    const tod = this.tod;
    if (tod.night + tod.dusk * 0.5 > 0.15) drawGlow(ctx, x + p.P.lamp[0], y + p.P.lamp[1], 9, '#fff2b0', clamp01(tod.night + tod.dusk * 0.5) * (0.85 + 0.1 * Math.sin(this.t * 3)));
  }

  waveAt(x) {
    const i = Math.max(0, Math.min(this.W, Math.round(x)));
    return this.ys ? this.ys[i] : this.base;
  }

  waterLook() {
    const tod = this.tod, wx = this.wx;
    return {
      refract: 13 + wx.rain * 4, caustic: 11 * (0.35 + tod.day * 0.65) * (0.5 + wx.clear * 0.5), chroma: true, foam: 1,
      causticColor: tri('#3a5a50', '#463a30', '#102040', tod), foamColor: this.cols.crest, crestColor: tri('#ffffff', '#ffecd0', '#c0d8ff', tod),
      ...waterGloss(AERO_LOOKS.oscean, { daylight: tod.day + tod.dusk * 0.5, dusk: tod.dusk }),
      glossColor: tri('#ffffff', '#fff0d8', '#c8e0ff', tod), pattern: (0.35 + tod.day * 0.4) * wx.clear,
    };
  }

  drawSurface(ctx, env, sy) {
    if (sy < -8) return;
    const W = this.W, ys = this.ys, t = this.t, tod = this.tod, wx = this.wx;
    const crest = new Path2D(), sub = new Path2D(), band = new Path2D();
    const sh = this.shimmer, shH = sh.height;
    waveRuns(ys, W, (x0, len, y) => { crest.rect(x0, y, len, 1); sub.rect(x0, y + 1, len, 2); band.rect(x0, y + 2, len, shH + 2); });
    ctx.fillStyle = this.cols.sub;
    ctx.globalAlpha = 0.6;
    ctx.fill(sub);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    const a1 = (0.6 - tod.night * 0.3) * (1 - wx.rain * 0.3);
    const o1 = Math.floor((t * 9) % 256), o2 = Math.floor((256 - ((t * 5) % 256)) % 256);
    const p1 = ctx.createPattern(sh, 'repeat-x');
    p1.setTransform(new DOMMatrix([1, 0, 0, 1, -o1, sy + 2]));
    ctx.globalAlpha = a1;
    ctx.fillStyle = p1;
    ctx.fill(band);
    const p2 = ctx.createPattern(sh, 'repeat-x');
    p2.setTransform(new DOMMatrix([1, 0, 0, 1, -o2, sy + 1]));
    ctx.globalAlpha = a1 * 0.6;
    ctx.fillStyle = p2;
    ctx.fill(band);
    // sun / moon glitter on the surface
    const B = skyBodies(env.hour ?? 12, W, this.top, this.base);
    const s = tod.night > 0.5 ? B.moon : B.sun;
    ctx.fillStyle = tod.night > 0.5 ? '#c8dcff' : tod.dusk > 0.4 ? '#ffd090' : '#ffffff';
    for (let i = 0; i < 30; i++) {
      const ph = Math.floor(t * 3 + i * 0.61);
      const x = Math.round(s.x + (hash2(i, ph, 5) - 0.5) * (44 + i * 3));
      if (x < 0 || x >= W) continue;
      const k = Math.sin(((t * 3 + i * 0.61) % 1) * Math.PI);
      ctx.globalAlpha = k * wx.clear * 0.95;
      ctx.fillRect(x, ys[x] + 1 + Math.floor(hash2(i, ph, 6) * 6), 2 + Math.floor(hash2(i, ph, 7) * 4), 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.cols.crest;
    ctx.fill(crest);
    if (this.rain.length) {
      for (const d of this.rain) {
        const x = Math.round(d.x), y = ys[clamp(x, 0, W)];
        const k = d.t / 0.6;
        ctx.fillStyle = this.cols.crest;
        ctx.globalAlpha = 1 - k;
        if (d.t < 0.12) ctx.fillRect(x, y - 2 - Math.round(d.t * 20), 1, d.big ? 2 : 1);
        const rr = Math.round(1 + k * (d.big ? 6 : 4));
        ctx.fillRect(x - rr, y + 1, 1, 1); ctx.fillRect(x + rr, y + 1, 1, 1);
        ctx.globalAlpha = (1 - k) * 0.6;
        ctx.fillRect(x - rr + 1, y + 2 + Math.round(k * 2), rr * 2 - 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    // splash crowns
    const F = this.splashF;
    for (const sp of this.splashes) {
      const f = F[Math.min(F.length - 1, Math.floor((sp.t / sp.dur) * F.length))];
      ctx.globalAlpha = 0.9 * (1 - tod.night * 0.3);
      const x = Math.round(sp.x), y = ys[clamp(x, 0, W)];
      ctx.drawImage(f.canvas, x - f.ox, y + 1 - f.oy);
    }
    ctx.globalAlpha = 1;
    // aurora shimmer on the water at night
    const au = this.wx.aurora * tod.night;
    if (au > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = au * 0.35;
      const pat = ctx.createPattern(bloomStrip(40, '#7affc8', 0.8), 'repeat-x');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, 0, sy + 2]));
      ctx.fillStyle = pat;
      ctx.fillRect(0, sy + 2, W, 40);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ draw: seabed
  drawSeabed(ctx, env) {
    if (!this.ready) return;
    const t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const q = quality(env);
    const px = this.par.x, py = this.par.y;
    const rayA = (tod.day * 1 + tod.dusk * 0.8 + tod.night * 0.3) * (0.3 + wx.clear * 0.7);
    if (rayA > 0.02) {
      const rc = tri('#ffffff', '#ffc890', '#a8c8ff', tod);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = rayA * (0.8 + 0.2 * Math.sin(t * 0.37));
      ctx.drawImage(this.raysA.tint(rc, 1, rc), Math.round(Math.sin(t * 0.06) * 16), sy - 2);
      ctx.globalAlpha = rayA * (0.65 + 0.35 * Math.sin(t * 0.53 + 2));
      ctx.drawImage(this.raysB.tint(rc, 1, rc), Math.round(Math.sin(t * 0.045 + 1) * 24), sy - 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    this.plankton.draw(ctx, t, 0.6 + tod.day * 0.4, q, 0.6);
    const dx = px * 3, dy = py * 0.8;
    this.bands.draw(ctx, 1, tod, dx, dy);
    const ca = this.causticA(q);
    if (ca > 0.01) this.caustics.draw(ctx, this.masks[1], -this.D.pad + dx, this.D.bands[1].y + dy, t, ca * 0.8, { fps: 8, drift: 3, offset: 5 });
    this.drawRotors(ctx, 1, dx, dy);
    this.decor.draw(ctx, 1, t, dx, dy, 1 + wx.bubbles * 0.6);
    for (const o of this.orbs) if (!o.far) this.drawOrb(ctx, o, 0.15, px * 1.6, py * 0.6);
    for (const d of this.drops) {
      const spr = voxDrop(d.h).canvas;
      const y = d.y + Math.sin(t * 1.1 + d.ph) * 5;
      ctx.drawImage(spr, Math.round(d.x + px * 1.6 - spr.width / 2), Math.round(y + py * 0.6 - spr.height / 2));
      const k = Math.sin(t * 1.7 + d.ph * 3);
      if (k > 0.85) twinkle(ctx, d.x + px * 1.6 - d.h * 0.18, y + py * 0.6 - d.h * 0.25, (k - 0.85) / 0.15, '#ffffff');
    }
    if (!this.nearHooked) this.paintNear(ctx, env);
  }

  causticA(q) {
    if (q < 0.75) return 0;
    const tod = this.tod;
    return (tod.day * 0.42 + tod.dusk * 0.25 + tod.night * 0.1) * (0.3 + this.wx.clear * 0.7);
  }

  drawNear(ctx, env) {
    this.nearSeen = true;
    if (this.nearHooked && this.ready) this.paintNear(ctx, env);
  }

  paintNear(ctx, env) {
    const t = this.t, tod = this.tod, q = quality(env);
    const dx = this.par.x * 4, dy = this.par.y;
    this.bands.draw(ctx, 0, tod, dx, dy);
    const ca = this.causticA(q);
    if (ca > 0.01) this.caustics.draw(ctx, this.masks[0], -this.D.pad + dx, this.D.bands[0].y + dy, t, ca, { fps: 8, drift: 4 });
    this.drawRotors(ctx, 0, dx, dy);
    this.decor.draw(ctx, 0, t, dx, dy, 1 + this.wx.bubbles * 0.6);
    // glints on the resting orbs
    for (const [i, o] of this.restOrbs.entries()) {
      if (o.band !== 0) continue;
      const k = ((t + i * 1.7) % 4) / 4;
      if (k < 0.12) twinkle(ctx, o.x + dx - o.r * 0.4, o.y + dy - o.r * 0.5, Math.sin((k / 0.12) * Math.PI), '#ffffff');
    }
    if (this.secretT > 0) {
      const s = this.orbSecret;
      const k = this.secretT / 1.5;
      drawGlow(ctx, s.cx + dx, s.cy + dy, 16, '#bff6ff', k * 0.8);
    }
    this.bubbles.draw(ctx, t);
  }

  drawFront(ctx, env) {
    if (!this.ready) return;
    const t = this.t, tod = this.tod, q = quality(env);
    this.nearMotes.draw(ctx, t, 0.8 + tod.day * 0.3, q);
    for (const b of this.soap) {
      const spr = soapBubble(b.r, 0.8);
      ctx.drawImage(spr, Math.round(b.x - b.r - 1 + Math.sin(t * 2 + b.ph) * 1.5), Math.round(b.y - b.r - 1));
    }
    // night: crystal plants and bubble plants glow, bioluminescent motes drift
    const ga = (tod.night * 0.75 + this.wx.aurora * 0.2) * (0.8 + 0.2 * Math.sin(t * 0.8));
    if (ga > 0.03) {
      ctx.globalCompositeOperation = 'lighter';
      const px = this.par.x, py = this.par.y;
      for (const g of this.glowDecor) {
        const img = g.anim.night(t, g.off);
        if (!img) continue;
        const ox = g.band === 0 ? px * 4 : g.band === 1 ? px * 3 : px * 2, oy = g.band === 0 ? py : g.band === 1 ? py * 0.8 : py * 0.6;
        ctx.globalAlpha = ga * (1 - this.D.fog(g.z) * 0.7);
        ctx.drawImage(img, Math.round(g.anim.x + ox), Math.round(g.anim.y + oy));
      }
      ctx.globalAlpha = 1;
      if (tod.night > 0.3) {
        const n = Math.round(this.glowMotes.list.length * q);
        for (let i = 0; i < n; i++) {
          const p = this.glowMotes.list[i];
          const k = 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);
          if (k < 0.2) continue;
          const x = p.x + Math.sin(t * 0.7 + p.ph) * 6, y = p.y + Math.cos(t * 0.5 + p.ph) * 3;
          drawGlow(ctx, x, y, 3, p.c, k * tod.night * 0.8);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    this.aero.drawFront(ctx, env);
  }

  // ------------------------------------------------------------------ lighting
  lighting(env) {
    const tod = todWeights(env);
    const wx = this.wx;
    const dark = clamp(tod.night * 0.48 + tod.dusk * 0.1 + wx.rain * 0.06, 0, 0.6);
    const tint = qmix('#b07a8a', '#1e3478', tod.night / Math.max(0.001, tod.night + tod.dusk));
    const lights = [];
    if (dark > 0.04 && this.ready) {
      const n = tod.night;
      const sy = this.surfaceAt(env);
      const m = skyBodies(env.hour ?? 23, this.W, this.top, this.base).moon;
      if (n > 0.2) lights.push({ x: m.x, y: Math.max(0, sy) + 10, r: 160, color: '#8aaae8', a: 0.45 * n });
      for (const g of this.glowDecor) lights.push({ x: g.anim.x + g.anim.frames[0].width / 2, y: g.anim.y + g.anim.frames[0].height * 0.4, r: 34 * this.D.s(g.z) + 10, color: '#7af0ff', a: 0.5 * n * (1 - this.D.fog(g.z) * 0.6) });
      for (const o of this.restOrbs) lights.push({ x: o.x, y: o.y, r: o.r * 3 + 8, color: o.tint, a: 0.35 * n });
      if (this.pier) lights.push({ x: this.pier.x + this.pier.P.lamp[0], y: this.pier.y + this.pier.P.lamp[1], r: 70, color: '#fff2c0', a: 0.75 * n });
    }
    return { dark, tint, lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    if (this.orbSecret && inRect(x, y, this.orbSecret, 3)) return 'osorb';
    return null;
  }

  onSecret(id, game) {
    if (id !== 'osorb') return;
    const st = game.state;
    st.secrets ||= {};
    this.secretT = 1.5;
    const s = this.orbSecret;
    game.audio?.play?.('sparkle', { vol: 0.6 });
    for (let i = 0; i < 8; i++) game.particles?.sparkle?.(s.cx + (Math.random() - 0.5) * 24, s.cy - Math.random() * 20, '#bff6ff');
    for (let i = 0; i < 5; i++) this.bubbles.emit(s.cx + (Math.random() - 0.5) * 8, s.cy - 6 - i * 3, { r: 1 + (i % 2) });
    if (!st.secrets.osorb) {
      st.secrets.osorb = true;
      game.addCoins?.(25, s.cx, s.cy - 10);
      game.save?.();
    }
  }
}

// Under-surface shimmer streaks (tiled horizontally).
function makeShimmer(W0) {
  const W = W0 + 256, h = 16;
  const r = new RNG(23);
  const acc = new Float32Array(W * h);
  for (let i = 0; i < W * 0.55; i++) {
    const y = Math.floor(Math.pow(r.next(), 1.7) * h);
    const len = r.int(3, 16 - Math.min(10, y));
    const x = r.int(0, W - 1);
    const a = (1 - y / h) * r.float(0.4, 1);
    for (let k = 0; k < len; k++) acc[y * W + ((x + k) % W)] = Math.max(acc[y * W + ((x + k) % W)], a * (k === 0 || k === len - 1 ? 0.5 : 1));
  }
  return paint(W, h, (x, y) => {
    const v = acc[y * W + x];
    if (v < 0.05) return 0;
    return pack(v > 0.6 ? '#ffffff' : '#c8faff', Math.round(Math.min(1, v) * 210));
  });
}

function cropRows(src, y0, y1) {
  const h = Math.max(1, y1 - y0);
  const c = makeCanvas(src.width, h);
  ctxOf(c).drawImage(src, 0, y0, src.width, h, 0, 0, src.width, h);
  return c;
}

void rgba; void sparkleStar;
