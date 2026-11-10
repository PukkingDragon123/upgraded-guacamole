// The deep column under every ocean (phase 6, Oceans agent): the shelf's rocky lip, canyon walls with ledges,
// far pinnacles, the twilight / midnight / abyss water, bioluminescence, the abyss floor, plants with physics, and
// the scary stuff at the bottom (a light radius around the hook only, distant eyes, huge silhouettes, rumbles and
// the occasional jump-scare-lite). Ocean.make installs it on every biome, after the Aero / sky / water installers:
//
//   installDeep(biome)      idempotent; biome.deep = DeepSea. Wraps update / drawBack / drawSeabed / drawNear /
//                           drawFront / lighting. The biome's own passes are skipped while the view is entirely in
//                           the deep, and the deep passes while it is entirely above the shelf.
//   deep.L                  zone layout (depthzones.js layoutZones)
//   deep.floorAt(x, z)      the abyss floor (perspective DepthScene at the bottom of the column)
//   deep.floorUnder(x, y, z)  the floor below a point: the shelf seabed above the lip, the abyss floor below it
//   deep.drawGlowPass(ctx)  emissive things after the darkness pass (Ocean.applyLighting calls it)
//   deep.zoneAtY(y), deep.metres(y)
// Everything heavy (lip, walls, pinnacles, the floor and its hi-res bands) is painted in a background generator a few
// ms per frame, nearest to the camera first; missing pieces draw as flat fills until they are ready.

import { clamp, clamp01, lerp, smoothstep, hash2, fbm2, TAU, damp } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { mix, shade } from '../core/color.js';
import { makeCanvas, ctxOf, makeLayer, resizeLayer } from '../core/canvas.js';
import { dpack, drawGlow, glowSprite, DepthScene, BandSet, qscale, FogCache } from './scenery.js';
import { worldProp } from './voxkit.js';
import { PlantField, plantCols, headCols } from './plants.js';
import { DRESS, dressSprite } from './deepdress.js'; // [phase7:env] fine voxel props on the deep ledges
import {
  layoutZones, zoneAt, metresAt, waterAt, rockAt, deepDark, LIP_H, ZONE_POP, ZONE_RARITY, speciesZones, rgbHex, hex, mixRGB,
} from './depthzones.js';
import { SPECIES } from '../fish/species.js';
import { Fish } from '../fish/fish.js';
import { rollIndividual } from '../fish/traits.js';
import { drawFishRig } from '../gfx/fishrig.js';

export const DEEP_R = 3;           // hi-res pixels per world px for the deep's near layers (the camera sits at ~3x)
const CHUNK = 128;                 // wall chunk height (world px)
const CELL = 2;                    // relief voxel size (world px) of the far pinnacles
const FINE_CELL = 1;               // [phase7:env] relief voxel size of the lip, walls and sea stacks (3 hi px per voxel)

// ------------------------------------------------------------------ relief painter
// A rock face seen from the front: cells (CELL world px) with a height toward the viewer and a colour, shaded like
// voxels (lambert from the height gradient, lit top / left lips, dark bottom / right lips, ordered dither) at R hi px
// per world px. sample(wx, wy) -> null | [h, r, g, b, flag] (flag 1 = glows, 2 = sediment top).
function* reliefSteps(x0, y0, w, h, R, sample, out, CELL = FINE_CELL) {
  const gw = Math.ceil(w / CELL), gh = Math.ceil(h / CELL), N = gw * gh;
  const H = new Float32Array(N), C = new Float32Array(N * 3), F = new Uint8Array(N);
  let t0 = performance.now();
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      const s = sample(x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL);
      if (!s) { H[k] = -1e9; continue; }
      // [phase7:env] voxel terraces + loose grains
      H[k] = Math.round(s[0] / 1.5) * 1.5 + (hash2(i, j + y0 * 3, 73) < 0.06 ? 1.5 : 0); C[k * 3] = s[1]; C[k * 3 + 1] = s[2]; C[k * 3 + 2] = s[3]; F[k] = s[4] | 0;
    }
    if (performance.now() - t0 > 3) { yield; t0 = performance.now(); }
  }
  const cw = CELL * R, PW = gw * cw, PH = gh * cw;
  const canvas = makeCanvas(PW, PH), g = ctxOf(canvas);
  const img = g.createImageData(PW, PH), d = new Uint32Array(img.data.buffer);
  const E = -1e8;
  const glows = [];
  const pk = (r, gg, b, m) => (255 << 24 | clamp(Math.round(b * m), 0, 255) << 16 | clamp(Math.round(gg * m), 0, 255) << 8 | clamp(Math.round(r * m), 0, 255)) >>> 0;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i, hc = H[k];
      if (hc < E) continue;
      const hl = i > 0 ? H[k - 1] : hc, hr = i < gw - 1 ? H[k + 1] : hc, hu = j > 0 ? H[k - gw] : hc, hd = j < gh - 1 ? H[k + gw] : hc;
      const el = hl < E, er = hr < E, eu = hu < E, ed = hd < E;
      const gx = ((er ? hc - 8 : hr) - (el ? hc - 8 : hl)) / (2 * CELL), gy = ((ed ? hc - 8 : hd) - (eu ? hc - 8 : hu)) / (2 * CELL);
      const nl = Math.hypot(gx, gy, 1);
      const lam = Math.max(0, (gx * 0.5 + gy * 0.62 + 0.6) / nl);
      let base = 0.5 + 0.62 * lam + (hash2(i, j + y0, 71) - 0.5) * 0.1;
      if (!eu && hu > hc + 1.5) base *= 0.8; // overhang shadow
      const f = F[k];
      const r = C[k * 3], gg = C[k * 3 + 1], b = C[k * 3 + 2];
      if (f & 1) { base = 1.15; glows.push([x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL, rgbHex([r, gg, b])]); }
      const topLit = eu || hu < hc - 0.6, leftLit = el || hl < hc - 0.6, botDark = ed || hd < hc - 0.6, rightDark = er || hr < hc - 0.6;
      // one packed colour per cell, a second one for an ordered-dither speckle, and the lit / shaded lips
      const c0 = pk(r, gg, b, base), c1 = pk(r, gg, b, base * 0.93);
      const cT = pk(r, gg, b, base * (f & 2 ? 1.32 : 1.24)), cB = pk(r, gg, b, base * 0.66), cL = pk(r, gg, b, base * 1.12), cR = pk(r, gg, b, base * 0.8);
      const px0 = i * cw, py0 = j * cw;
      for (let yy = 0; yy < cw; yy++) {
        const row = (py0 + yy) * PW + px0;
        const top = yy === 0 && topLit, bot = yy === cw - 1 && botDark;
        for (let xx = 0; xx < cw; xx++) {
          let c;
          if (top) c = cT;
          else if (bot) c = cB;
          else if (xx === 0 && leftLit) c = cL;
          else if (xx === cw - 1 && rightDark) c = cR;
          else c = ((px0 + xx) & 1) ^ ((py0 + yy) & 1) && ((xx * 7 + yy * 5 + i) % 5 === 0) ? c1 : c0;
          d[row + xx] = c;
        }
      }
    }
    if (performance.now() - t0 > 4) { yield; t0 = performance.now(); }
  }
  g.putImageData(img, 0, 0);
  out.canvas = canvas; out.glows = glows; out.R = R;
  return out;
}

// ------------------------------------------------------------------ install
export function installDeep(b) {
  if (!b || b.__deep) return b?.deep || null;
  b.__deep = true;
  const D = new DeepSea(b);
  b.deep = D;
  const up = b.update.bind(b), back = b.drawBack.bind(b), seabed = b.drawSeabed.bind(b), front = b.drawFront.bind(b), light = b.lighting.bind(b);
  const near = typeof b.drawNear === 'function' ? b.drawNear.bind(b) : null;
  const vis = (env) => D.vis(env);
  b.update = (dt, env) => { up(dt, env); try { D.update(dt, env); } catch (e) { D.fail(e); } };
  b.drawBack = (ctx, env) => {
    const v = vis(env);
    if (v.shallow) back(ctx, env);
    if (v.deep) try { D.drawBack(ctx, env); } catch (e) { D.fail(e); }
  };
  b.drawSeabed = (ctx, env) => {
    const v = vis(env);
    if (v.shallow) { seabed(ctx, env); try { D.drawShelf(ctx, env, 'back'); } catch (e) { D.fail(e); } }
    if (v.deep) try { D.drawMid(ctx, env); } catch (e) { D.fail(e); }
  };
  b.drawNear = (ctx, env) => {
    const v = vis(env);
    if (v.shallow) { near?.(ctx, env); try { D.drawShelf(ctx, env, 'front'); } catch (e) { D.fail(e); } }
    if (v.deep) try { D.drawNearDeep(ctx, env); } catch (e) { D.fail(e); }
  };
  b.drawFront = (ctx, env) => {
    const v = vis(env);
    if (v.shallow) front(ctx, env);
    if (v.deep) try { D.drawFrontDeep(ctx, env); } catch (e) { D.fail(e); }
  };
  b.lighting = (env) => {
    const L = light(env);
    try { return D.light(L, env); } catch (e) { D.fail(e); return L; }
  };
  return D;
}

const L0glow = (d) => (d.kind === 'vent' ? '#ff9a4a' : d.kind === 'worms' ? '#ff6a6a' : '#7affe0');

// ------------------------------------------------------------------ the deep sea
export class DeepSea {
  constructor(b) {
    this.b = b;
    this.game = b.game;
    this.key = null;
    this.L = null;
    this.t = 0;
    this.fog = new FogCache();
    this.warned = false;
    this.eyes = [];
    this.eyeT = 3;
    this.giant = null; this.giantT = 14;
    this.scare = null; this.scareT = 50;
    this.rumbleT = 8;
    this.zoneId = null;
    this.vignette = null;
    this.glowSpots = [];
    this.drifts = [];
  }

  fail(e) {
    if (!this.warned) { this.warned = true; console.warn('deep sea', e); }
  }

  get W() { return this.b.W; }
  get H() { return this.b.H; }

  // which halves of the world the view touches
  vis(env) {
    const v = env?.view, H = this.H || this.game.screen?.H || 540;
    if (!this.L || !v || this.game.ocean?.travelState) return { shallow: true, deep: !!this.L && !v };
    return { shallow: v.y0 < H + 8, deep: v.y1 > H - 8 };
  }

  ensure() {
    const b = this.b;
    if (!b.W || !b.H || b.ready === false) return false;
    const key = b.W + 'x' + b.H + (this.game.lowPower ? 'l' : '');
    if (key !== this.key) this.reset(b.W, b.H, key);
    return true;
  }

  surfaceLevel() {
    const b = this.b;
    let s = null;
    try { s = b.boatLevel ? b.boatLevel({ flood: 0 }) : b.baseSurface?.(b.H); } catch { s = null; }
    if (!Number.isFinite(s)) { try { s = b.baseSurface?.(b.H); } catch { s = null; } }
    return Number.isFinite(s) ? s : null;
  }

  reset(W, H, key) {
    this.key = key;
    const L = this.L = layoutZones(this.b.id, H, this.surfaceLevel());
    this.R = this.game.lowPower ? 2 : DEEP_R;
    this.deepH = L.bottom - H + 1;
    this.rng = new RNG(hash2(W, H, 7) * 1e9 + this.b.id.length * 131);
    this.buildEdges();
    this.lip = { x0: 0, y0: H - 6, w: W, h: Math.ceil(this.lipMax - H + 10), canvas: null, glows: [] };
    this.walls = [];
    for (const side of [-1, 1]) {
      for (let y = H; y < L.bottom; y += CHUNK) {
        const h = Math.min(CHUNK, L.bottom - y);
        let wmax = 0;
        for (let k = 0; k < h; k++) wmax = Math.max(wmax, this.edgeAt(side, y + k));
        const ww = Math.ceil(wmax + 6);
        this.walls.push({ side, x0: side < 0 ? 0 : W - ww, y0: y, w: ww, h, canvas: null, glows: [] });
      }
    }
    // free-standing sea stacks rising from the abyss floor into the open canyon (mid layer, chunked like the walls)
    this.pillars = [];
    {
      const r = new RNG(W * 3 + L.bottom), tw = L.zones.find((z) => z.deep) || L.zones[1];
      const n = 5 + (W > 1100 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const cx = lerp(W * 0.2, W * 0.8, (i + r.float(0.2, 0.8)) / n), w = r.int(30, 58);
        const top = lerp(tw.y0 + 90, L.bottom - 480, (i % 2 ? 0.55 : 0) + r.float(0, 0.45));
        const p = { cx, w, top, bot: L.bottom - 70 - r.int(0, 30), seed: r.int(1, 999), ledges: [] };
        for (let y = top + r.int(60, 120); y < p.bot - 80; y += r.int(120, 220)) p.ledges.push({ y, side: r.chance(0.5) ? -1 : 1, d: r.int(12, 22), th: r.int(8, 14) });
        p.half = (y) => {
          const u = (y - p.top) / Math.max(1, p.bot - p.top);
          let h = p.w * 0.5 * (0.55 + 0.75 * fbm2(y * 0.011, p.seed, 3, 201)) * (0.5 + 0.5 * smoothstep(0, 0.1, u)) * (1 + smoothstep(0.82, 1, u) * 0.8);
          h *= 0.85 + 0.3 * Math.abs(Math.sin(y * 0.031 + p.seed));
          if (u < 0.04) h *= Math.sqrt(Math.max(0, u / 0.04));
          return h;
        };
        p.bump = (y, side) => { let b = 0; for (const l of p.ledges) { const dy = y - l.y; if (l.side === side && dy >= 0 && dy < l.th) b = Math.max(b, l.d * (1 - Math.pow(dy / l.th, 1.7))); } return b; };
        p.chunks = [];
        for (let y = Math.floor(top); y < p.bot; y += CHUNK) {
          const h = Math.min(CHUNK, p.bot - y);
          let mw = 0;
          for (let k = 0; k < h; k += 2) mw = Math.max(mw, p.half(y + k) + 46);
          p.chunks.push({ pillar: p, x0: Math.floor(cx - mw - 4), y0: y, w: Math.ceil(mw * 2 + 8), h, canvas: null, glows: [] });
        }
        this.pillars.push(p);
      }
    }
    this.placeDress(W, L);
    this.far = [];
    this.floor = null;
    this.strip = null;
    this.stripY = H - 8;
    this.buildPlants();
    this.gen = this.buildSteps();
    this.genDone = false;
    this.t0 = performance.now();
    this.vignette = null;
    this.glowSpots = [];
    this.glowChunks = null;
  }

  // ------------------------------------------------------------------ voxel dressing (phase 7)
  // Fine voxel props per zone (deepdress.js) on every sea-stack ledge and top and on the canyon walls' ledges.
  placeDress(W, L) {
    const r = new RNG(W * 7 + L.bottom * 3 + this.b.id.length);
    const out = this.dress = [];
    const add = (x, y) => {
      const z = zoneAt(L, y);
      if (!z.deep || y > L.bottom - 60) return;
      const kinds = DRESS[z.id] || DRESS.twilight;
      out.push({ kind: kinds[r.int(0, kinds.length - 1)], x, y, zone: z.id, v: r.int(0, 3), s: null });
    };
    for (const p of this.pillars) {
      const cxAt = (y) => p.cx + Math.sin(y * 0.007 + p.seed) * 14 + (fbm2(y * 0.02, p.seed, 2, 205) - 0.5) * 10;
      add(cxAt(p.top + 6), p.top + 6);
      for (const l of p.ledges) {
        const n = r.chance(0.55) ? 2 : 1;
        for (let i = 0; i < n; i++) add(cxAt(l.y) + l.side * (p.half(l.y) + r.float(3, Math.max(4, l.d * 0.75))), l.y + 1);
      }
    }
    for (const l of this.ledges) {
      const n = r.int(1, 2);
      for (let i = 0; i < n; i++) add(r.float(l.x0 + 3, l.x1 - 3), l.wy + 1);
    }
    out.sort((a, b) => a.y - b.y);
  }

  dressCols(zone) {
    const L = this.L, z = L.zones.find((q) => q.id === zone && q.deep) || L.zones[1];
    const rc = rgbHex(rockAt(L, (z.y0 + z.y1) / 2).map((c) => c * 1.1));
    const moss = { twilight: '#4a6a7a', midnight: '#2e3456', abyss: '#2a2832' }[zone] || '#3e5a4a';
    return { rock: [shade(rc, -0.18), rc, shade(rc, 0.12), shade(rc, -0.06)], moss, sponge: L.def.sponge, glows: L.def.glow, pale: '#d8f0ff', noGlow: zone === 'twilight' };
  }

  *dressSteps() {
    const cols = {};
    for (;;) {
      const cy = this.camY();
      let best = null, bd = Infinity;
      for (const d of this.dress) if (!d.s) { const dd = Math.abs(d.y - cy); if (dd < bd) { bd = dd; best = d; } }
      if (!best) break;
      const c = cols[best.zone] || (cols[best.zone] = this.dressCols(best.zone));
      try { best.s = dressSprite(best.kind, 4100 + best.v * 31 + best.kind.length, c, this.R, this.b.id + best.zone); } catch (e) { this.fail(e); best.s = { canvas: null }; }
      yield;
    }
  }

  drawDress(ctx, v, glow = false) {
    const R = this.R;
    for (const d of this.dress) {
      const s = d.s;
      if (!s?.canvas) continue;
      const x = d.x - s.ox / R, y = d.y - s.oy / R, w = s.w / R, h = s.h / R;
      if (v && (x > v.x1 || x + w < v.x0 || y > v.y1 || y + h < v.y0)) continue;
      if (glow) {
        if (!s.glow) continue;
        ctx.globalAlpha = 0.85 + 0.15 * Math.sin(this.t * 1.3 + d.x);
        ctx.drawImage(s.glow, x, y, w, h);
        ctx.globalAlpha = 1;
      } else ctx.drawImage(s.canvas, x, y, w, h);
    }
  }

  // ------------------------------------------------------------------ geometry
  buildEdges() {
    const W = this.W, H = this.H, L = this.L, n = this.deepH + 2, r = this.rng;
    const seed = this.b.id.length * 17;
    this.edges = [new Float32Array(n), new Float32Array(n)];
    this.ledges = [];
    for (const [si, side] of [[0, -1], [1, 1]]) {
      // ledges every 110-210 px
      const list = [];
      for (let y = 90 + r.int(0, 60); y < n - 260; y += r.int(110, 210)) list.push({ y, d: r.int(20, 44), th: r.int(12, 22), side });
      const e = this.edges[si];
      for (let y = 0; y < n; y++) {
        const wy = H + y, k = y / n;
        let v = lerp(70, 150, smoothstep(0, 1, k)) * (side < 0 ? 1 : 0.92);
        v += (fbm2(wy * 0.0062, si * 5.3 + seed, 3, 91) - 0.5) * 120;
        v += (fbm2(wy * 0.034, si * 3.1 + seed, 2, 92) - 0.5) * 22;
        for (const l of list) {
          const dy = y - l.y;
          if (dy >= 0 && dy < l.th) v += l.d * (1 - Math.pow(dy / l.th, 1.7));
        }
        // the top tucks under the shelf lip
        v = Math.max(18, v) + Math.max(0, 1 - y / 70) * 30;
        e[y] = Math.min(W * 0.42, v);
      }
      for (const l of list) {
        const ex = e[l.y + 1];
        l.wy = H + l.y;
        l.x0 = side < 0 ? ex - l.d * 0.85 : W - ex + 3;
        l.x1 = side < 0 ? ex - 3 : W - ex + l.d * 0.85;
        this.ledges.push(l);
      }
    }
    // the shelf's lip: jagged underside with dripping spikes
    const lb = this.lipB = new Float32Array(W + 2);
    const spikes = [];
    for (let x = r.int(4, 20); x < W; x += r.int(14, 42)) spikes.push({ x, w: r.float(4, 10), l: r.float(6, 22) });
    let mx = 0;
    for (let x = 0; x <= W + 1; x++) {
      let v = H + LIP_H * (0.55 + 0.5 * fbm2(x * 0.011, seed, 3, 77)) + (fbm2(x * 0.08, seed, 2, 78) - 0.5) * 6;
      for (const s of spikes) { const q = 1 - Math.abs(x - s.x) / s.w; if (q > 0) v += s.l * Math.pow(q, 1.5); }
      lb[x] = v;
      mx = Math.max(mx, v);
    }
    this.lipMax = mx;
  }

  edgeAt(side, wy) {
    const e = this.edges[side < 0 ? 0 : 1];
    const i = clamp(Math.round(wy - this.H), 0, e.length - 1);
    return e[i];
  }

  lipBottom(x) { return this.lipB[clamp(Math.round(x), 0, this.lipB.length - 1)]; }

  // rock face sample for the canyon walls
  wallSample(side, wx, wy) {
    const W = this.W, L = this.L;
    const e = this.edgeAt(side, wy);
    const dist = side < 0 ? e - wx : wx - (W - e);
    if (dist < 0) return null;
    const rim = Math.min(dist, 14);
    let h = 16 + (fbm2(wx * 0.045, wy * 0.045, 3, 17) - 0.5) * 18 - (14 - rim) * (14 - rim) * 0.06;
    const band = Math.floor((wy + fbm2(wx * 0.02, wy * 0.012, 2, 18) * 30) / 10);
    h += band & 1 ? 2.5 : 0;
    if (hash2(wx >> 2, wy >> 3, 19) < 0.035) h -= 5;
    const rc = rockAt(L, wy), wc = waterAt(L, wy);
    const tn = fbm2(wx * 0.07, wy * 0.07, 2, 23);
    let k = 0.84 + tn * 0.3 + (band % 3 === 0 ? -0.07 : 0);
    let c = [rc[0] * k, rc[1] * k, rc[2] * k];
    let flag = 0;
    // sediment / growth on top surfaces
    const above = this.edgeAt(side, wy - CELL * 1.5);
    const aboveDist = side < 0 ? above - wx : wx - (W - above);
    if (aboveDist < 0) { flag = 2; c = mixRGB(c, [176, 170, 196], 0.45); }
    const z = zoneAt(L, wy);
    if ((z.id === 'midnight' || z.id === 'abyss') && hash2(wx >> 1, wy >> 1, 29) < (z.id === 'abyss' ? 0.0022 : 0.004) && rim > 3) {
      flag = 1; c = hex(L.def.glow[Math.floor(hash2(wx, wy, 31) * L.def.glow.length)]);
    } else {
      // encrusting sponges and soft corals in the twilight: bright knobbly patches
      const sp = z.id === 'twilight' ? fbm2(wx * 0.09, wy * 0.09, 2, 37) : 0;
      if (sp > 0.68) {
        const sc = hex(L.def.sponge[Math.floor(hash2(wx >> 4, wy >> 4, 38) * L.def.sponge.length)]);
        c = mixRGB(c, sc, 0.7); h += 3 + (sp - 0.68) * 30;
      }
      c = mixRGB(c, wc, 0.2);
    }
    return [h, c[0], c[1], c[2], flag];
  }

  lipSample(wx, wy) {
    const H = this.H, lip = this.L.def.lip || {};
    const bot = this.lipBottom(wx);
    if (wy > bot || wy < H - 6) return null;
    const dy = wy - (H - 6), dist = bot - wy;
    let h = 14 + (fbm2(wx * 0.05, wy * 0.06, 3, 41) - 0.5) * 14 - Math.max(0, 6 - dist) ** 2 * 0.28;
    if (dy < 4) h += 4;
    let c;
    const soil = lip.soil || ['#7a6a52', '#665844', '#524638'], rock = lip.rock || ['#6a6670', '#57545e'];
    const n = fbm2(wx * 0.04, wy * 0.09, 2, 43);
    if (dy < 4.5) c = hex(lip.top || '#9a8a6a').map((v) => v * (0.92 + n * 0.2));
    else if (dy < 14 + n * 8) c = hex(soil[Math.floor((wy + n * 12) / 5) % soil.length]);
    else c = hex(rock[Math.floor((wy + wx * 0.1 + n * 20) / 7) % rock.length]);
    // darker toward the underside, faint fog toward the water below
    const k = 1 - smoothstep(10, 50, dy) * 0.3;
    c = [c[0] * k, c[1] * k, c[2] * k];
    if (dist < 8) c = mixRGB(c, waterAt(this.L, H + 30), 0.18);
    return [h, c[0], c[1], c[2], dy < 4.5 ? 2 : 0];
  }

  // far pinnacles: tall low-contrast rock spires in the twilight / upper midnight haze
  pinnacleSample(p, wx, wy) {
    const u = (wy - p.y0) / p.h;
    if (u < 0 || u > 1) return null;
    const half = p.w * (0.18 + 0.82 * Math.pow(u, 0.7)) * (0.86 + 0.28 * fbm2(wy * 0.03, p.seed, 2, 51)) / 2;
    const dx = wx - p.cx - Math.sin(u * 3 + p.seed) * p.w * 0.12;
    if (Math.abs(dx) > half) return null;
    const h = 12 + Math.sqrt(Math.max(0, 1 - (dx / half) ** 2)) * 14 + (fbm2(wx * 0.06, wy * 0.06, 2, 53) - 0.5) * 8;
    const rc = rockAt(this.L, wy), wc = waterAt(this.L, wy);
    const c = mixRGB(rc, wc, 0.62 + u * 0.25);
    return [h, c[0], c[1], c[2], 0];
  }

  // sea stack sample: a rough column with ledges, lit on its left flank
  pillarSample(p, wx, wy) {
    const hw = p.half(wy);
    const dx = wx - p.cx - Math.sin(wy * 0.007 + p.seed) * 14 - (fbm2(wy * 0.02, p.seed, 2, 205) - 0.5) * 10;
    const side = dx < 0 ? -1 : 1;
    const ext = hw + p.bump(wy, side);
    if (Math.abs(dx) > ext) return null;
    const L = this.L, rim = ext - Math.abs(dx);
    let h = 18 + Math.sqrt(Math.max(0, 1 - (dx / ext) ** 2)) * 10 + (fbm2(wx * 0.05, wy * 0.05, 3, 211) - 0.5) * 14 - Math.max(0, 6 - rim) ** 2 * 0.2;
    const band = Math.floor((wy + fbm2(wx * 0.03, wy * 0.01, 2, 212) * 24) / 9);
    h += band & 1 ? 2 : 0;
    const rc = rockAt(L, wy), wc = waterAt(L, wy);
    const tn = fbm2(wx * 0.08, wy * 0.08, 2, 213);
    const k = 0.82 + tn * 0.3 + (band % 3 === 0 ? -0.06 : 0);
    let c = [rc[0] * k, rc[1] * k, rc[2] * k];
    let flag = 0;
    const up = p.half(wy - 3) + p.bump(wy - 3, side);
    if (Math.abs(dx) > up || wy - p.top < 3) { flag = 2; c = mixRGB(c, [176, 170, 196], 0.4); }
    const z = zoneAt(L, wy);
    if ((z.id === 'midnight' || z.id === 'abyss') && hash2(wx >> 1, wy >> 1, 219) < 0.004 && rim > 2) { flag = 1; c = hex(L.def.glow[Math.floor(hash2(wx, wy, 31) * L.def.glow.length)]); }
    else {
      const sp = z.id === 'twilight' ? fbm2(wx * 0.1, wy * 0.1, 2, 237) : 0;
      if (sp > 0.7) { c = mixRGB(c, hex(L.def.sponge[Math.floor(hash2(wx >> 4, wy >> 4, 238) * L.def.sponge.length)]), 0.65); h += 3; }
      c = mixRGB(c, wc, 0.28);
    }
    return [h, c[0], c[1], c[2], flag];
  }

  // ------------------------------------------------------------------ background build
  *buildSteps() {
    const L = this.L, W = this.W, H = this.H, R = this.R;
    yield;
    // water gradient strip at R x resolution (smooth dithered steps under the 3x camera)
    {
      const h = (L.bottom - this.stripY + 4), sw = 4 * R, sh = Math.ceil(h * R);
      const c = makeCanvas(sw, sh), g = ctxOf(c), img = g.createImageData(sw, sh), d = new Uint32Array(img.data.buffer);
      for (let y = 0; y < sh; y++) {
        const wy = this.stripY + y / R;
        const col = waterAt(L, Math.max(H + 1, wy));
        for (let x = 0; x < sw; x++) d[y * sw + x] = dpack(col[0], col[1], col[2], x, y, 4);
        if ((y & 255) === 255) yield;
      }
      g.putImageData(img, 0, 0);
      this.strip = c;
    }
    yield;
    // lip, then the wall chunks nearest to the camera first
    yield* reliefSteps(0, this.lip.y0, W, this.lip.h, R, (x, y) => this.lipSample(x, y), this.lip);
    yield* this.dressSteps();
    // far pinnacles in the twilight / upper midnight
    const r = new RNG(L.bottom * 7 + W);
    const tw = L.zones.find((z) => z.id === 'twilight' && z.deep) || L.zones.find((z) => z.id === 'midnight');
    const mid = L.zones.find((z) => z.id === 'midnight');
    const span0 = (tw || mid).y0 + 40, span1 = mid ? mid.y0 + (mid.y1 - mid.y0) * 0.6 : span0 + 400;
    for (let i = 0; i < 7; i++) {
      const w = r.int(36, 86), h = r.int(170, 360);
      const p = { cx: lerp(W * 0.12, W * 0.88, (i + r.float(0.1, 0.9)) / 7), y0: r.float(span0, span1), w, h, seed: r.int(1, 999), par: r.float(0.25, 0.5) };
      p.x0 = Math.floor(p.cx - w / 2 - 6); p.ww = w + 12;
      const out = {};
      yield* reliefSteps(p.x0, p.y0, p.ww, h, Math.min(R, 2), (x, y) => this.pinnacleSample(p, x, y), out, CELL);
      p.canvas = out.canvas; p.R = out.R;
      this.far.push(p);
      yield;
    }
    const all = [...this.walls, ...this.pillars.flatMap((p) => p.chunks)];
    for (;;) {
      const cy = this.camY(), cx = this.camX();
      let best = null, bd = Infinity;
      for (const w of all) if (!w.canvas && !w.busy) { const dd = Math.abs(w.y0 + w.h / 2 - cy) + Math.abs(w.x0 + w.w / 2 - cx) * 0.5; if (dd < bd) { bd = dd; best = w; } }
      if (!best) break;
      best.busy = true;
      const fn = best.pillar ? (x, y) => this.pillarSample(best.pillar, x, y) : (x, y) => this.wallSample(best.side, x, y);
      yield* reliefSteps(best.x0, best.y0, best.w, best.h, R, fn, best);
      best.busy = false;
      yield;
    }
    // the abyss floor (props + 1x terrain now; its hi-res pass waits for the camera)
    while (this.camY() < this.L.zones.find((z) => z.id === 'midnight').y0 - 200 && !this.floorNow) yield 'wait';
    yield* this.floorSteps();
    this.genDone = true;
    this.buildMs = Math.round(performance.now() - this.t0);
  }

  camY() {
    const v = this.game.world?.view;
    return v ? (v.y0 + v.y1) / 2 : this.H;
  }
  camX() {
    const v = this.game.world?.view;
    return v ? (v.x0 + v.x1) / 2 : this.W / 2;
  }

  *floorSteps() {
    const L = this.L, W = this.W, Hf = L.floorH, def = L.def;
    const D = new DepthScene(W, Hf, { yFront: Hf - 36, yFar: Hf - 96, pad: 24, zFar: 1.9, fogStart: -0.25, fog: 0.92 });
    const sed = def.sediment;
    const seed = this.b.id.length * 31;
    yield;
    const floorH = (X, z) => {
      let h = (fbm2(X * 0.006, z * 1.3 + seed, 3, 141) - 0.45) * 10;
      h += Math.max(0, fbm2(X * 0.03, z * 4, 2, 142) - 0.64) * 30;
      const rp = Math.sin(z * 46 + fbm2(X * 0.02, z * 2, 2, 143) * 6);
      if (rp > 0.75) h += 2;
      return Math.max(-2, h * (0.5 + 0.5 * smoothstep(0, 0.5, z)));
    };
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.64, diffuse: 0.5, ao: 0.08, jitter: 0.08,
      micro: { ripple: 0.7, pebble: 1.3, shell: 1, pebbles: sed.map((c) => c.map((q) => q * 1.35)).concat([sed[0].map((q) => q * 0.7)]), shells: [[196, 188, 170], [170, 160, 150]] }, // [phase7:env]
      height: floorH, floorHeight: floorH,
      color: (X, z, h) => {
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 166);
        if (hs < 0.006) return [196, 188, 170]; // bone shards
        const n = fbm2(X * 0.025, z * 4, 2, 145);
        const c = n < 0.36 ? sed[0] : n > 0.64 ? sed[2] : sed[1];
        return h > 10 ? [c[0] * 0.8, c[1] * 0.8, c[2] * 0.9] : c;
      },
      glow: (X, z) => {
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 167);
        if (hs < 0.0025) { const g = hex(def.glow[Math.floor(hs * 4000) % def.glow.length]); return g; }
        return null;
      },
    });
    yield;
    const r = new RNG(seed + 5);
    const ids = def.floorProps || ['giant_skull', 'ribcage', 'tube_worms', 'glow_mushroom'];
    const spots = [];
    for (let i = 0; i < 16; i++) spots.push([r.float(0.06, 0.94), r.pick([0.06, 0.16, 0.3, 0.46, 0.62, 0.8, 1.0, 1.2])]);
    let k = 0;
    for (const [xf, z] of spots) {
      const id = ids[k++ % ids.length];
      try {
        const big = id === 'giant_skull' || id === 'ribcage' || id === 'sunken_boat' || id === 'arch_ruin' || id === 'statue_head';
        const p0 = worldProp(id, { scale: qscale((big ? 1.1 : 0.7) * D.s(z)), variant: r.int(0, 3) });
        // a plain copy without the 3x twin: the floor's hi pass re-renders only the terrain (it is mostly in the dark)
        const p = p0?.canvas ? { canvas: p0.canvas, ox: p0.ox, oy: p0.oy, w: p0.w, h: p0.h, lights: p0.lights || [], glow: p0.glow || null } : null;
        if (p) { const it = D.add({ sprite: p, x: Math.round(xf * W), z, id }); it.p = p; }
      } catch { /* prop missing */ }
      yield;
    }
    // fog toward the abyss water
    const strip = makeCanvas(8, Hf), sg = ctxOf(strip);
    const top = waterAt(L, L.bottom - Hf + 10), bot = waterAt(L, L.bottom - 4);
    const gr = sg.createLinearGradient(0, 0, 0, Hf);
    gr.addColorStop(0, rgbHex(top)); gr.addColorStop(1, rgbHex(bot));
    sg.fillStyle = gr; sg.fillRect(0, 0, 8, Hf);
    D.render([{ key: 'day', strip }]);
    yield;
    const oy = L.bottom - Hf;
    const lights = [];
    for (const it of D.items) {
      if (!it.p?.lights?.length || it.z > 0.9) continue;
      const l = it.p.lights.slice().sort((a, b) => b.r - a.r)[0];
      lights.push({ x: it.x - it.p.ox + l.x, y: oy + it.y - it.p.oy + l.y, r: clamp(l.r * 1.2 + 12, 22, 60) * D.s(it.z), color: l.color, z: it.z, ph: r.float(0, TAU), vent: it.id === 'vent_chimney' });
    }
    this.floor = { D, bands: new BandSet(D), oy, lights: lights.slice(0, 6), hi: false };
    // floor plants (glowing stalks, crinoids) in front
    this.addFloorPlants();
    yield;
    if (!this.game.lowPower) {
      // the floor's hi-res terrain only once the camera heads that way
      while (this.camY() < this.L.bottom - 700) yield 'wait';
      try { yield* D.hiSteps(this.R); this.floor.hi = !!D.hi; } catch (e) { this.fail(e); }
    }
  }

  // ------------------------------------------------------------------ plants
  buildPlants() {
    const b = this.b, W = this.W, L = this.L, def = L.def, id = b.id;
    const r = new RNG(W * 13 + id.length * 977);
    this.shelfFront = new PlantField(3);
    this.shelfBack = new PlantField(4);
    this.deepPlants = new PlantField(5);
    const fogC = b.fogColor || '#2a7aa0';
    const fogAt = (z) => clamp01(z * (b.fogAmount ?? 0.6) * 0.9);
    const shelfY = (x, z) => { try { const y = b.floorAt(x, z); return Number.isFinite(y) ? y : null; } catch { return null; } };
    const add = (kind, x, z, o = {}) => {
      const y = shelfY(x, z);
      if (y === null || y > this.H + 2) return null;
      const s = 1 - z * 0.5;
      const field = z < 0.33 ? this.shelfFront : this.shelfBack;
      return field.add({ kind, x, y: y + 1, z, s, layer: z < 0.33 ? 'front' : 'back', rng: r, ...o, cols: o.cols || plantCols(o.color || '#3a9a4a', fogC, fogAt(z), o) });
    };
    const zs = () => r.float(-0.4, 0.62);
    const recipe = SHELF[id] || SHELF.shallows;
    const lowK = this.game.lowPower ? 0.5 : 1;
    for (const [kind, count, opts] of recipe) {
      for (let i = 0; i < Math.round(count * lowK); i++) {
        const x = r.float(6, W - 6), z = opts.z ? r.float(opts.z[0], opts.z[1]) : zs();
        const color = r.pick(opts.colors);
        const o = { color, size: r.float(...(opts.size || [0.9, 1.15])), bulb: opts.bulb };
        if (kind === 'flower') {
          const hk = r.pick(opts.heads || ['daisy', 'tulip', 'star']);
          const petal = r.pick(opts.petals || ['#ffffff', '#ff7ab0', '#ffd23a', '#ff5a5a', '#b88aff']);
          o.head = { type: hk, size: r.float(1.25, 1.7), ...headCols(hk === 'daisy' ? '#ffffff' : petal, hk === 'daisy' ? '#ffd23a' : shade(petal, -0.3), fogC, fogAt(z)) };
        }
        if (opts.clump) {
          const n = r.int(opts.clump[0], opts.clump[1]);
          for (let k = 0; k < n; k++) add(kind, x + r.float(-5, 5), z + r.float(-0.04, 0.04), { ...o, base: r.float(-0.35, 0.35) });
        } else add(kind, x, z, o);
      }
    }
    // hanging roots / strands under the lip
    const hang = HANG[id] || HANG.shallows;
    for (let x = r.int(3, 12); x < W - 3; x += r.int(5, 15)) {
      const y = this.lipBottom(x) - 1.5;
      this.deepPlants.add({ kind: 'root', x, y, z: 0.1, s: 1, layer: 'deepFront', rng: r, size: r.float(0.8, 1.5), n: r.int(4, 9), cols: plantCols(r.pick(hang), null, 0, { rim: false }) });
    }
    this.addPillarPlants(r);
    // ledge growth on the canyon walls: sparse in the twilight, glowing deeper down
    for (const l of this.ledges) {
      const z = zoneAt(L, l.wy);
      const n = z.id === 'twilight' ? r.int(3, 5) : z.id === 'midnight' ? r.int(1, 3) : r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const x = r.float(l.x0, l.x1), y = l.wy + 1;
        const wc = rgbHex(waterAt(L, y));
        if (z.id === 'twilight') {
          const kind = r.pick(['whip', 'whip', 'fan', 'kelp', 'frond']);
          const col = r.pick(['#c86a8a', '#e0905a', '#9a6ac8', '#6a9ac8', '#d8b05a']);
          this.deepPlants.add({ kind, x, y, z: 0.4, s: 1, layer: 'deepMid', rng: r, size: kind === 'kelp' ? 0.8 : r.float(1.3, 1.9), n: kind === 'kelp' ? r.int(6, 9) : undefined, cols: plantCols(col, wc, 0.2) });
        } else {
          const col = r.pick(def.glow);
          const crin = r.chance(0.35);
          this.deepPlants.add({
            kind: crin ? 'whip' : 'glow', x, y, z: 0.4, s: 0.9, layer: 'deepMid', rng: r, glow: col,
            head: crin ? { type: 'feather', ...headCols(mix(col, '#ffffff', 0.3), col) } : { type: 'bulb', ...headCols(col, col) },
            cols: plantCols(z.id === 'abyss' ? '#3a3448' : '#4a4a6a', wc, 0.2),
          });
        }
      }
    }
  }

  addPillarPlants(r) {
    const L = this.L, def = L.def;
    for (const p of this.pillars) {
      for (const l of p.ledges) {
        const z = zoneAt(L, l.y), wc = rgbHex(waterAt(L, l.y));
        const a = p.half(l.y), n = z.id === 'abyss' ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const x = p.cx + Math.sin(l.y * 0.007 + p.seed) * 14 + (fbm2(l.y * 0.02, p.seed, 2, 205) - 0.5) * 10 + l.side * (a + r.float(2, l.d * 0.8)), y = l.y + 1;
          if (z.id === 'twilight') {
            const col = r.pick(['#c86a8a', '#e0905a', '#9a6ac8', '#d8b05a']);
            this.deepPlants.add({ kind: r.pick(['whip', 'fan', 'frond']), x, y, z: 0.5, s: 1, layer: 'deepMid', rng: r, size: r.float(1.2, 1.7), cols: plantCols(col, wc, 0.28) });
          } else {
            const col = r.pick(def.glow);
            this.deepPlants.add({ kind: 'glow', x, y, z: 0.5, s: 0.85, layer: 'deepMid', rng: r, glow: col, head: { type: 'bulb', ...headCols(col, col) }, cols: plantCols('#3a3a58', wc, 0.25) });
          }
        }
      }
    }
  }

  addFloorPlants() {
    const F = this.floor, D = F.D, L = this.L, W = this.W, r = new RNG(L.bottom + 11);
    for (let i = 0; i < 12; i++) {
      const x = r.float(10, W - 10), z = r.float(-0.05, 0.5);
      const y = D.floorAt(x, z) + F.oy;
      const col = r.pick(L.def.glow);
      const crin = r.chance(0.3);
      this.deepPlants.add({
        kind: crin ? 'whip' : 'glow', x, y: y + 1, z, s: 1 - z * 0.5, layer: 'deepFront', rng: r, glow: col, size: r.float(0.8, 1.3),
        head: crin ? { type: 'feather', ...headCols(mix(col, '#ffffff', 0.25), col) } : { type: 'bulb', ...headCols(col, col) },
        cols: plantCols('#3e3a52', '#06060c', z * 0.6),
      });
    }
  }

  parOf(band) {
    const p = this.b.par;
    if (!p) return [0, 0];
    return band === 0 ? [p.x * 4, p.y] : [p.x * 3, p.y * 0.8];
  }

  // ------------------------------------------------------------------ layout queries
  zoneAtY(y) { return this.L ? zoneAt(this.L, y) : null; }
  metres(y) { return this.L ? metresAt(this.L, y) : 0; }
  get bottom() { return this.L ? this.L.bottom : this.H; }

  floorAt(x, z = 0) {
    const F = this.floor;
    if (F) return F.D.floorAt(x, z) + F.oy;
    return this.L ? this.L.bottom - 40 + z * 30 : this.H;
  }

  floorUnder(x, y, z = 0) {
    if (!this.L || y < this.H - 2) {
      try { const v = this.b.floorAt(x, z); if (Number.isFinite(v)) return v; } catch { /* not built */ }
      return this.H - 40;
    }
    return this.floorAt(x, z);
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    if (!this.ensure()) return;
    this.t += dt;
    const g = this.game, v = env?.view;
    // background build: harder when the camera already looks at missing pieces
    if (this.gen) {
      const cam = g.camera;
      const urgent = v && v.y1 > this.H && (!this.wallsReadyIn(v) || (!this.floor && v.y1 > this.L.bottom - 400));
      const budget = g.lowPower ? 3 : urgent ? 12 : (cam?.open && v && v.y1 > this.H - 200 ? 7 : this.b.hiDone ? 4 : 2); // [phase7:env]
      const t0 = performance.now();
      try {
        while (performance.now() - t0 < budget) {
          const r = this.gen.next();
          if (r.done) { this.gen = null; break; }
          if (r.value === 'wait') break; // parked until the camera heads deeper
        }
      } catch (e) { this.fail(e); this.gen = null; }
    }
    if (!v || g.ocean?.travelState) return;
    // far fish and boxes fog toward the zone's own water while the camera is down here
    const b = this.b, cy = (v.y0 + v.y1) / 2;
    if (cy > this.H + 30) {
      if (!this.fogSaved) { this.fogSaved = true; this.fog0 = b.fogColor; this.fogAmt0 = b.fogAmount; }
      b.fogColor = this.fogNow = rgbHex(waterAt(this.L, cy).map((c) => c * 1.15));
      b.fogAmount = 0.65;
    } else if (this.fogSaved) {
      this.fogSaved = false;
      if (b.fogColor === this.fogNow) b.fogColor = this.fog0;
      b.fogAmount = this.fogAmt0;
    }
    const deepIn = v.y1 > this.H - 8, shallowIn = v.y0 < this.H + 8;
    this.dt = dt;
    const pushers = this.pushers(v), lines = this.lines();
    const flow = env.weather === 'current' ? 0.8 : env.weather === 'storm' ? 0.5 : 0;
    if (shallowIn) {
      const [fx, fy] = this.parOf(0), [bx, by] = this.parOf(1);
      this.shelfFront.update(dt, { t: this.t, view: v, pushers, lines, flow, dx: fx, dy: fy });
      this.shelfBack.update(dt, { t: this.t, view: v, pushers, lines, flow, dx: bx, dy: by });
    }
    if (deepIn) this.deepPlants.update(dt, { t: this.t, view: v, pushers, lines, flow: flow * 0.5 });
    this.updateScary(dt, v);
  }

  wallsReadyIn(v) {
    if (!this.lip.canvas && v.y0 < this.lipMax && v.y1 > this.H) return false;
    for (const w of this.walls) if (!w.canvas && w.y0 < v.y1 && w.y0 + w.h > v.y0) return false;
    for (const p of this.pillars) for (const c of p.chunks) if (!c.canvas && c.y0 < v.y1 && c.y0 + c.h > v.y0 && c.x0 < v.x1 && c.x0 + c.w > v.x0) return false; // [phase7:env]
    return true;
  }

  pushers(v) {
    const g = this.game, out = [];
    const pad = 50;
    for (const f of g.school?.fishes || []) {
      if (!(f.alpha > 0.2) || f.x < v.x0 - pad || f.x > v.x1 + pad || f.y < v.y0 - pad || f.y > v.y1 + pad) continue;
      const s = (f.scale || 1) * (1 - (f.z || 0) * 0.5);
      out.push({ x: f.x, y: f.y, r: 7 + 9 * s, vx: f.vx || 0, vy: f.vy || 0, k: 1, z: f.z || 0 });
    }
    const h = g.fishing?.hook;
    if (h?.visible) {
      const px = this.prevHook?.[0] ?? h.x, py = this.prevHook?.[1] ?? h.y;
      const iv = 1 / Math.max(1 / 120, this.dt || 1 / 60);
      out.push({ x: h.x, y: h.y, r: 8, vx: clamp((h.x - px) * iv, -600, 600), vy: clamp((h.y - py) * iv, -600, 600), k: 1.3, z: 0.05 });
      this.prevHook = [h.x, h.y];
    } else this.prevHook = null;
    const boat = g.boat;
    if (boat?.visible !== false && Number.isFinite(boat?.x) && Number.isFinite(boat?.y) && boat.y + 30 > v.y0) out.push({ x: boat.x, y: boat.y + 8, r: 36, vx: boat.vx || 0, vy: 0, k: 1, z: 0.1 });
    return out;
  }

  lines() {
    const g = this.game, h = g.fishing?.hook, boat = g.boat;
    if (!h?.visible || !boat?.rodTip || boat.visible === false) return [];
    try {
      const [rx, ry] = boat.rodTip();
      if (Number.isFinite(rx) && Number.isFinite(ry)) return [[rx, ry, h.x, h.y]];
    } catch { /* no rod */ }
    return [];
  }

  // ------------------------------------------------------------------ scary stuff
  updateScary(dt, v) {
    const g = this.game, L = this.L;
    const cy = (v.y0 + v.y1) / 2;
    const z = zoneAt(L, cy);
    const deep = z.deep ? z.id : null;
    const h = g.fishing?.hook;
    const busy = !!g.fishing?.fighting || !!g.fishing?.cine || g.ui?.blocking || !!g.tutorial?.active;
    const reduced = !!g.state?.settings?.reducedMotion;
    // distant eyes: pairs of glints in the dark that blink, watch the hook and vanish when it comes close
    this.eyeT -= dt;
    const maxEyes = deep === 'abyss' ? 4 : deep === 'midnight' ? 2 : 0;
    if (this.eyeT <= 0) {
      this.eyeT = deep === 'abyss' ? 2.5 + Math.random() * 4 : 6 + Math.random() * 8;
      if (this.eyes.length < maxEyes) {
        const big = Math.random() < (deep === 'abyss' ? 0.3 : 0.12);
        const x = lerp(v.x0 + 12, v.x1 - 12, Math.random()), y = lerp(v.y0 + 14, v.y1 - 14, Math.random());
        const far = !h?.visible || Math.hypot(x - h.x, y - h.y) > 90;
        if (far && y > this.H + 60) {
          const col = big ? (Math.random() < 0.5 ? '#ffe86a' : '#ff5a4a') : L.def.glow[Math.floor(Math.random() * L.def.glow.length)];
          this.eyes.push({ x, y, sep: big ? 12 + Math.random() * 16 : 3 + Math.random() * 3, r: big ? 2 : 1, col, t: 0, life: 4 + Math.random() * 7, a: 0, dx: 0, blink: 0, big });
        }
      }
    }
    for (const e of this.eyes) {
      e.t += dt;
      const near = h?.visible && Math.hypot(e.x - h.x, e.y - h.y) < (e.big ? 70 : 52);
      if (near && !e.flee) { e.flee = true; e.life = e.t + 0.25; }
      const fadeIn = clamp01(e.t / 1.2), fadeOut = clamp01((e.life - e.t) / (e.flee ? 0.25 : 0.8));
      e.a = Math.min(fadeIn, fadeOut) * (deep ? 1 : 0);
      e.blink = Math.max(0, e.blink - dt);
      if (Math.random() < dt * 0.35) e.blink = 0.14;
      if (h?.visible) e.dx = damp(e.dx, clamp((h.x - e.x) * 0.02, -1, 1), 2, dt);
      e.x += Math.sin(this.t * 0.3 + e.sep) * dt * 1.5;
    }
    this.eyes = this.eyes.filter((e) => e.t < e.life && e.y > v.y0 - 40 && e.y < v.y1 + 40);
    // the huge silhouette: a deep giant cruising through the dark (drawn against the faint glow haze)
    this.giantT -= dt;
    if (this.giant) {
      const G = this.giant;
      G.x += G.dir * G.v * dt;
      G.f.x = G.x; G.f.y = G.y + Math.sin(this.t * 0.4) * 6; G.f.vx = G.dir * G.v; G.f.vy = 0;
      try { G.f.animate?.(dt); } catch { /* rig not ready */ }
      if ((G.dir > 0 && G.x - G.len > v.x1 + 80) || (G.dir < 0 && G.x + G.len < v.x0 - 80) || Math.abs(G.y - cy) > 400) this.giant = null;
    } else if (this.giantT <= 0 && (deep === 'midnight' || deep === 'abyss') && !busy) {
      this.giantT = 30 + Math.random() * 40;
      this.spawnGiant(v, deep);
    }
    // keep the next giant / lunge creature warm while down there (their low-poly frames build ahead of time)
    if (deep === 'midnight' || deep === 'abyss') {
      const W = this.warm ||= { giant: null, lunge: null, t: 0 };
      W.t -= dt;
      if (W.t <= 0) {
        W.t = 0.6;
        if (!W.giant) W.giant = this.creature(deep === 'abyss' ? 380 : 270);
        if (deep === 'abyss' && !W.lunge) W.lunge = this.creature(170, 'big');
        this.warmUp(W.giant, v);
        if (W.lunge) this.warmUp(W.lunge, v);
      }
    }
    // rumbles, creaks and moans
    this.rumbleT -= dt;
    if (this.rumbleT <= 0) {
      this.rumbleT = deep === 'abyss' ? 7 + Math.random() * 10 : deep === 'midnight' ? 12 + Math.random() * 14 : 20;
      const a = g.audio;
      if (deep === 'abyss' || deep === 'midnight') {
        const pick = Math.random();
        const pan = Math.random() * 1.6 - 0.8;
        if (pick < 0.4) a?.play?.('thunder', { vol: deep === 'abyss' ? 0.35 : 0.2, pitch: 0.32 + Math.random() * 0.1, pan });
        else if (pick < 0.7) a?.play?.('ice_crack', { vol: 0.16, pitch: 0.28 + Math.random() * 0.12, pan });
        else a?.play?.('whale_call', { vol: deep === 'abyss' ? 0.3 : 0.18, pitch: 0.38 + Math.random() * 0.12, pan });
        if (deep === 'abyss' && pick < 0.4) g.camera?.shake?.(reduced ? 0.4 : 1.2);
      }
    }
    // jump-scare-lite: a pair of huge eyes opens right beside the light, or something big lunges through it
    this.scareT -= dt;
    if (this.scare) {
      const S = this.scare;
      S.t += dt;
      if (S.kind === 'lunge' && S.f) {
        S.x += S.dir * S.v * dt;
        S.f.x = S.x; S.f.y = S.y + Math.sin(S.t * 6) * 3; S.f.vx = S.dir * S.v;
        try { S.f.animate?.(dt); } catch { /* rig not ready */ }
      }
      if (S.t > S.dur) this.scare = null;
    } else if (this.scareT <= 0 && deep === 'abyss' && h?.visible && !busy) {
      this.scareT = 70 + Math.random() * 80;
      this.startScare(h, v, reduced);
    }
  }

  giantSpecies() {
    const id = this.b.id;
    const big = (s) => Math.max(s.look?.body?.len || 0, (s.look?.body?.h || 0) * 0.8);
    const ok = (s) => s.look && s.look.kind !== 'chain' && s.move?.style !== 'crawl' && s.move?.style !== 'hop' && !s.quirks?.includes?.('intro');
    let pool = SPECIES.filter((s) => ok(s) && (s.biome === id || s.biome === 'abyss') && big(s) >= 40);
    if (!pool.length) pool = SPECIES.filter((s) => ok(s) && big(s) >= 40);
    pool.sort((a, b) => big(b) - big(a));
    return pool.slice(0, 6);
  }

  makeCreature(sp) {
    const g = this.game;
    const rec = rollIndividual(sp, { mutationChance: 0, shinyChance: 0, giantChance: 0, patternChance: 0 });
    const f = new Fish(rec, sp, g.world, { fadeIn: false });
    f.hero = true; f.controlled = true; f.alpha = 1; f.z = 0.5;
    return f;
  }

  // A creature for a silhouette pass, sized to `want` world px. Pre-built so its first frames are ready in time.
  creature(want, pick = 'any') {
    const pool = this.giantSpecies();
    if (!pool.length) return null;
    const sp = pick === 'big' ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
    let f;
    try { f = this.makeCreature(sp); } catch (e) { this.fail(e); return null; }
    const len = Math.max(sp.look.body?.len || 40, (sp.look.body?.h || 30) * 0.8);
    f.scale = want / len;
    return { f, sp, len: want };
  }

  // draw a waiting creature once into the offscreen layer so the rig builds its frames before it is needed
  warmUp(c, v) {
    if (!c?.f || !v) return;
    const cam = this.game.camera;
    if (!cam?.xform) return;
    const W = this.game.screen?.W || 960, H = this.game.screen?.H || 540;
    let L = this.giantLayer;
    if (!L) L = this.giantLayer = makeLayer(W, H);
    if (L.w !== W || L.h !== H) resizeLayer(L, W, H);
    const [z, ox, oy] = cam.xform();
    const g = L.ctx, f = c.f, px = f.x, py = f.y;
    f.x = (v.x0 + v.x1) / 2; f.y = (v.y0 + v.y1) / 2;
    g.setTransform(z, 0, 0, z, ox, oy);
    this.drawCreature(g, f, 1, this.t, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, L.w, L.h);
    f.x = px; f.y = py;
  }

  spawnGiant(v, deep) {
    const want = deep === 'abyss' ? 300 + Math.random() * 160 : 220 + Math.random() * 100;
    let c = this.warm?.giant;
    if (c) { c.f.scale *= want / c.len; c.len = want; this.warm.giant = null; } else c = this.creature(want);
    if (!c) return;
    const { f, sp } = c;
    const dir = Math.random() < 0.5 ? 1 : -1;
    f.facing = dir; f.turn = dir;
    const x = dir > 0 ? v.x0 - want * 0.7 : v.x1 + want * 0.7;
    const y = lerp(v.y0, v.y1, 0.3 + Math.random() * 0.4);
    this.giant = { f, x, y, dir, v: 14 + Math.random() * 10, len: want, sp };
    this.game.audio?.play?.('whale_call', { vol: 0.32, pitch: 0.3, pan: -dir * 0.6 });
  }

  startScare(h, v, reduced) {
    const g = this.game;
    const kind = Math.random() < 0.55 ? 'eyes' : 'lunge';
    const side = h.x > (v.x0 + v.x1) / 2 ? -1 : 1;
    if (kind === 'eyes') {
      this.scare = { kind, t: 0, dur: 2.6, x: h.x + side * (54 + Math.random() * 16), y: h.y - 6 + Math.random() * 12, sep: 16 + Math.random() * 6 };
      g.audio?.play?.('roar', { vol: 0.42, pitch: 0.3 });
    } else {
      const want = 170;
      const c = this.warm?.lunge || this.creature(want, 'big');
      if (this.warm) this.warm.lunge = null;
      if (!c) return;
      const f = c.f;
      f.facing = side; f.turn = side; f.z = 0.2;
      const x = h.x - side * (want + 80);
      this.scare = { kind, t: 0, dur: 1.6, f, x, y: h.y - 10, dir: side, v: (want * 2 + 160) / 1.4, len: want };
      g.audio?.play?.('roar', { vol: 0.5, pitch: 0.26 });
    }
    g.camera?.shake?.(reduced ? 1 : 3.5);
  }

  // ------------------------------------------------------------------ lighting
  light(L, env) {
    const v = env?.view;
    if (!this.L || !v || this.game.ocean?.travelState || v.y1 < this.H - 2) return L;
    const H = this.H, Z = this.L;
    const bd = L.dark || 0;
    const bt = hex(L.tint || '#1a2440');
    const prof = (y) => {
      if (y < H) return { dark: bd, tint: bt };
      const d = deepDark(Z, y);
      if (!d) return { dark: bd, tint: bt };
      // blend from the biome's own light into the deep over the lip
      const k = clamp01((y - H) / 70);
      return { dark: Math.max(lerp(bd, d.dark, k), bd), tint: mixRGB(bt, d.tint, k) };
    };
    const cy = (v.y0 + v.y1) / 2;
    const c = prof(cy), bot = prof(v.y1);
    const out = { ...L, profile: prof, dark: Math.max(c.dark, bot.dark), tint: rgbHex(c.tint), lights: v.y0 > H + 20 ? [] : (L.lights || []).slice() };
    // the hook's lantern: the only real light down here
    const g = this.game, h = g.fishing?.hook;
    if (h?.visible) {
      const hz = zoneAt(Z, h.y);
      if (hz.deep) {
        const lantern = !!g.stats?.lantern;
        const base = hz.id === 'abyss' ? 64 : hz.id === 'midnight' ? 58 : 46;
        const flick = 1 + Math.sin(this.t * 13) * 0.02 + Math.sin(this.t * 31.7) * 0.015;
        out.lights.push({ x: h.x, y: h.y, r: base * (lantern ? 1.45 : 1) * flick, color: Z.def.lamp, a: 1 });
        out.lights.push({ x: h.x, y: h.y, r: 18, color: '#ffffff', a: 0.5 });
        out.hookLit = true;
      }
    }
    // glowing growths and floor emitters nearby
    // glowing growths cast small pools (fewer and fainter in the abyss: it stays pitch dark)
    const abyssK = zoneAt(Z, cy).id === 'abyss' ? 0.35 : 1;
    const gl = this.deepPlants.glowLights(v, abyssK < 1 ? 2 : 5);
    for (const p of gl) out.lights.push({ x: p.x, y: p.y, r: 16, color: p.color, a: 0.45 * abyssK });
    let nd = 0;
    for (const d of this.dress) {
      if (nd >= 5 || !d.s?.glow || d.y < v.y0 - 20 || d.y > v.y1 + 30 || d.x < v.x0 - 30 || d.x > v.x1 + 30) continue;
      const l = d.s.lights[0];
      if (!l) continue;
      nd++;
      out.lights.push({ x: d.x + (l.x - d.s.ox) / this.R, y: d.y + (l.y - d.s.oy) / this.R, r: 30, color: L0glow(d), a: 0.42 * (abyssK < 1 ? 0.8 : 1) });
    }
    if (this.floor && v.y1 > this.floor.oy) for (const l of this.floor.lights) out.lights.push({ x: l.x, y: l.y, r: l.r * 0.7, color: l.color, a: (0.5 + 0.2 * Math.sin(this.t * 1.3 + l.ph)) * (1 - l.z * 0.7) * (l.vent ? 1 : 0.4) });
    if (this.scare?.kind === 'eyes') out.lights.push({ x: this.scare.x, y: this.scare.y, r: 26, color: '#ffe86a', a: 0.35 * this.scareK() });
    return out;
  }

  scareK() {
    const S = this.scare;
    if (!S) return 0;
    return Math.min(clamp01(S.t / 0.35), clamp01((S.dur - S.t) / 0.4));
  }

  // ------------------------------------------------------------------ drawing
  drawBack(ctx, env) {
    if (!this.L) return;
    const v = env.view, H = this.H, L = this.L, R = this.R;
    const x0 = v ? v.x0 - 2 : 0, x1 = v ? v.x1 + 2 : this.W;
    const y0 = Math.max(v ? v.y0 - 2 : H, H - 6), y1 = Math.min(v ? v.y1 + 2 : L.bottom, L.bottom + 4);
    if (y1 <= y0) return;
    if (this.strip) {
      const pat = ctx.createPattern(this.strip, 'repeat');
      pat.setTransform(new DOMMatrix([1 / R, 0, 0, 1 / R, 0, this.stripY]));
      ctx.fillStyle = pat;
    } else ctx.fillStyle = rgbHex(waterAt(L, (y0 + y1) / 2));
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // far pinnacles (parallax: they pan slower than the world)
    const cx = v ? (v.x0 + v.x1) / 2 : this.W / 2, cy = v ? (v.y0 + v.y1) / 2 : H;
    for (const p of this.far) {
      const dx = (cx - this.W / 2) * p.par, dy = (cy - (p.y0 + p.h / 2)) * p.par * 0.35;
      const px = p.x0 + dx, py = p.y0 + dy;
      if (v && (px > v.x1 || px + p.ww < v.x0 || py > v.y1 || py + p.h < v.y0)) continue;
      ctx.drawImage(p.canvas, Math.round(px * R) / R, Math.round(py * R) / R, p.canvas.width / p.R, p.canvas.height / p.R);
    }
    // far marine snow (dim) and a faint light shaft remnant at the top of the twilight
    this.drawSnow(ctx, v, 0.55, 44, 2, 0.7);
    // the last sunlight: slanted shafts fading through the twilight
    const tz = L.zones.find((q) => q.id === 'twilight' && q.deep);
    if (tz && v.y0 < tz.y1) {
      ctx.globalCompositeOperation = 'lighter';
      const len = tz.y1 - H;
      for (let i = 0; i < 7; i++) {
        const sx = ((i * 157 + 60) % (this.W + 120)) - 60 + Math.sin(this.t * 0.17 + i * 2.1) * 26;
        const w0 = 14 + (i * 37) % 26;
        const gr = ctx.createLinearGradient(0, H, 0, H + len);
        const a = 0.13 * (0.6 + 0.4 * Math.sin(this.t * 0.45 + i * 1.7));
        gr.addColorStop(0, `rgba(170,200,255,${a})`); gr.addColorStop(0.5, `rgba(130,150,255,${a * 0.4})`); gr.addColorStop(1, 'rgba(110,120,255,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(sx, H); ctx.lineTo(sx + w0, H); ctx.lineTo(sx + w0 + len * 0.42, H + len); ctx.lineTo(sx + len * 0.36, H + len);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // stateless marine snow: hashed points per world cell drifting down; a = alpha, cs = cell, n = per cell, size
  drawSnow(ctx, v, a, cs, n, speed, size = 1, col = '#c8d4f0') {
    if (!v) return;
    const H = this.H;
    const iy0 = Math.floor(Math.max(v.y0, H) / cs) - 1, iy1 = Math.floor(v.y1 / cs) + 1;
    const ix0 = Math.floor(v.x0 / cs) - 1, ix1 = Math.floor(v.x1 / cs) + 1;
    const t = this.t;
    ctx.fillStyle = col;
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let k = 0; k < n; k++) {
          const h1 = hash2(ix * 3 + k, iy, 501), h2 = hash2(ix, iy * 3 + k, 502), h3 = hash2(ix + k, iy + k, 503);
          const y = iy * cs + ((h2 * cs + t * speed * (2 + h3 * 5)) % cs);
          if (y < H + 4) continue;
          const x = ix * cs + h1 * cs + Math.sin(t * 0.4 + h3 * 9) * 3;
          ctx.globalAlpha = a * (0.4 + h3 * 0.6);
          ctx.fillRect(x, y, size * (h3 > 0.85 ? 1.5 : 1), size);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawMid(ctx, env) {
    if (!this.L) return;
    const v = env.view, R = this.R;
    // sea stacks
    for (const p of this.pillars) {
      if (v && (p.cx + p.w * 2 < v.x0 || p.cx - p.w * 2 > v.x1 || p.top > v.y1 || p.bot < v.y0)) continue;
      for (const c of p.chunks) {
        if (v && (c.y0 > v.y1 || c.y0 + c.h < v.y0)) continue;
        if (c.canvas) ctx.drawImage(c.canvas, c.x0, c.y0, c.canvas.width / R, c.canvas.height / R);
        else {
          ctx.fillStyle = rgbHex(mixRGB(rockAt(this.L, c.y0), waterAt(this.L, c.y0), 0.4));
          ctx.beginPath();
          for (let y = c.y0; y <= c.y0 + c.h; y += 4) ctx.lineTo(p.cx - p.half(y), y);
          for (let y = c.y0 + c.h; y >= c.y0; y -= 4) ctx.lineTo(p.cx + p.half(y), y);
          ctx.fill();
        }
      }
    }
    // canyon walls
    for (const w of this.walls) {
      if (v && (w.y0 > v.y1 || w.y0 + w.h < v.y0 || w.x0 > v.x1 || w.x0 + w.w < v.x0)) continue;
      if (w.canvas) ctx.drawImage(w.canvas, w.x0, w.y0, w.canvas.width / R, w.canvas.height / R);
      else {
        // placeholder silhouette until the chunk is painted
        ctx.fillStyle = rgbHex(rockAt(this.L, w.y0 + w.h / 2).map((c) => c * 0.8));
        ctx.beginPath();
        const sx = w.side < 0 ? 0 : this.W;
        ctx.moveTo(sx, w.y0);
        for (let y = w.y0; y <= w.y0 + w.h; y += 4) { const e = this.edgeAt(w.side, y); ctx.lineTo(w.side < 0 ? e : this.W - e, y); }
        ctx.lineTo(sx, w.y0 + w.h);
        ctx.fill();
      }
    }
    this.drawDress(ctx, v);
    // the abyss floor (far + mid bands)
    const F = this.floor;
    if (F && (!v || v.y1 > F.oy + F.D.hz - 4)) {
      ctx.save();
      ctx.translate(0, F.oy);
      F.bands.draw(ctx, 2, null);
      F.bands.draw(ctx, 1, null);
      ctx.restore();
    } else if (!F && v && v.y1 > this.L.bottom - 160) {
      ctx.fillStyle = '#0a0a10';
      ctx.fillRect(v.x0, this.L.bottom - 150, v.x1 - v.x0, 160);
    }
    this.deepPlants.draw(ctx, 'deepMid', { view: v });
  }

  drawNearDeep(ctx, env) {
    if (!this.L) return;
    const v = env.view, R = this.R, H = this.H;
    const F = this.floor;
    if (F && (!v || v.y1 > F.oy + F.D.bands[0].y)) {
      ctx.save();
      ctx.translate(0, F.oy);
      F.bands.draw(ctx, 0, null);
      ctx.restore();
    }
    this.deepPlants.draw(ctx, 'deepFront', { view: v });
    // the shelf's lip (in front of the hanging roots' bases)
    if (!v || v.y0 < this.lipMax + 2) {
      const lp = this.lip;
      if (lp.canvas) ctx.drawImage(lp.canvas, 0, lp.y0, lp.canvas.width / R, lp.canvas.height / R);
      else {
        ctx.fillStyle = (this.L.def.lip?.soil || ['#5a4a3a'])[1];
        ctx.beginPath();
        ctx.moveTo(0, H - 4);
        for (let x = 0; x <= this.W; x += 4) ctx.lineTo(x, this.lipBottom(x));
        ctx.lineTo(this.W, H - 4);
        ctx.fill();
      }
    }
    // near marine snow
    this.drawSnow(ctx, v, 0.7, 70, 1, 1.4, 1.5, '#e8f0ff');
  }

  // the shelf plants (sunlit seabed): 'back' after the mid band, 'front' after the near band
  drawShelf(ctx, env, layer) {
    if (!this.L) return;
    const v = env.view;
    const [dx, dy] = this.parOf(layer === 'front' ? 0 : 1);
    (layer === 'front' ? this.shelfFront : this.shelfBack).draw(ctx, layer, { view: v, dx, dy });
  }

  // after the darkness pass (Ocean.applyLighting), under the world camera
  drawGlowPass(ctx, env) {
    if (!this.L || !env?.view || env.view.y1 < this.H) return;
    const v = env.view, L = this.L, t = this.t;
    const cy = (v.y0 + v.y1) / 2, z = zoneAt(L, cy);
    if (!z.deep) return;
    const deepK = z.id === 'abyss' ? 1 : z.id === 'midnight' ? 0.7 : 0.35;
    // a faint far glow haze the giants pass in front of
    if (z.id !== 'twilight') {
      const hx = (v.x0 + v.x1) / 2 + Math.sin(t * 0.05) * 60, hy = cy + 30;
      drawGlow(ctx, hx, hy, 110, z.id === 'abyss' ? '#1a3a5a' : '#2a2a6a', 0.3 + 0.08 * Math.sin(t * 0.3));
    }
    // bioluminescent sparks (stateless, world-anchored)
    const cs = 40, glow = L.def.glow;
    const iy0 = Math.floor(Math.max(v.y0, this.H + 30) / cs), iy1 = Math.floor(v.y1 / cs);
    const ix0 = Math.floor(v.x0 / cs), ix1 = Math.floor(v.x1 / cs);
    ctx.globalCompositeOperation = 'lighter';
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const h = hash2(ix, iy, 611);
        const zc = zoneAt(L, iy * cs);
        const dens = zc.id === 'twilight' ? 0.4 : zc.id === 'midnight' ? 0.75 : zc.id === 'abyss' ? 0.3 : 0;
        if (h > dens) continue;
        const ph = hash2(ix, iy, 612) * TAU, sp = 0.6 + hash2(ix, iy, 613) * 1.8;
        const k = Math.max(0, Math.sin(t * sp + ph));
        if (k < 0.15) continue;
        const x = ix * cs + hash2(ix, iy, 614) * cs + Math.sin(t * 0.3 + ph) * 6, y = iy * cs + hash2(ix, iy, 615) * cs + Math.cos(t * 0.25 + ph) * 4;
        const c = glow[Math.floor(hash2(ix, iy, 616) * glow.length)];
        ctx.globalAlpha = k;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
        if (h < dens * 0.6) { const gs = glowSprite(h < dens * 0.2 ? 5 : 3, c); ctx.globalAlpha = k * 0.6; ctx.drawImage(gs, Math.round(x + 0.5) - (gs.width >> 1), Math.round(y + 0.5) - (gs.height >> 1)); }
      }
    }
    // bioluminescent drifts: chains of light curling through the midnight water
    if (z.id === 'midnight' || z.id === 'abyss') {
      for (let i = 0; i < 5; i++) {
        const dir = i % 2 ? -1 : 1, sp = 5 + i * 1.7;
        const span = this.W + 300;
        const bx = dir > 0 ? ((i * 337 + t * sp) % span) - 150 : this.W + 150 - ((i * 337 + t * sp) % span);
        const by = Math.round(cy / 140) * 140 - 90 + i * 46 + Math.sin(t * 0.2 + i) * 24;
        if (bx < v.x0 - 60 || bx > v.x1 + 60 || by < v.y0 - 20 || by > v.y1 + 20) continue;
        const c = glow[i % glow.length], n = 10 + (i % 3) * 3;
        for (let k = 0; k < n; k++) {
          const x = bx - dir * k * 3.4, y = by + Math.sin(t * 1.2 - k * 0.5 + i) * 5;
          const a = (0.45 + 0.55 * Math.sin(t * 3 - k * 0.7 + i)) * (1 - k / (n + 2)) * deepK;
          if (a < 0.05) continue;
          ctx.globalAlpha = a; ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
          if (k % 3 === 0) { const gs = glowSprite(3, c); ctx.globalAlpha = a * 0.5; ctx.drawImage(gs, Math.round(x + 0.5) - (gs.width >> 1), Math.round(y + 0.5) - (gs.height >> 1)); }
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // glowing wall specks and floor glows
    for (const w of this.glowChunks || (this.glowChunks = [...this.walls, ...this.pillars.flatMap((p) => p.chunks)])) {
      if (!w.glows.length || w.y0 > v.y1 || w.y0 + w.h < v.y0) continue;
      for (const [x, y, c] of w.glows) {
        if (x < v.x0 - 4 || x > v.x1 + 4) continue;
        drawGlow(ctx, x, y, 3, c, 0.45 + 0.35 * Math.sin(t * 1.3 + x * 0.7 + y));
      }
    }
    this.drawDress(ctx, v, true);
    this.deepPlants.drawGlows(ctx, { view: v, t, glow: drawGlow, a: 0.9 });
    // the giant silhouette: composited offscreen with the hook's light pool cut out (it passes behind it)
    const G = this.giant;
    if (G) this.drawGiant(ctx, G, t);
    // distant eyes
    for (const e of this.eyes) {
      if (e.a < 0.02 || e.blink > 0) continue;
      const ox = e.dx * (e.big ? 1.2 : 0.4);
      for (const s of [-1, 1]) {
        const x = e.x + s * e.sep / 2 + ox, y = e.y;
        drawGlow(ctx, x, y, e.big ? 6 : 3, e.col, e.a * 0.5);
        ctx.globalAlpha = e.a;
        ctx.fillStyle = e.col;
        ctx.fillRect(Math.round(x - e.r / 2), Math.round(y - e.r / 2), e.r + (e.big ? 1 : 0), e.r);
        ctx.globalAlpha = 1;
      }
    }
    // jump scare: huge eyes opening beside the light
    const S = this.scare;
    if (S?.kind === 'eyes') {
      const k = this.scareK();
      const open = clamp01(S.t / 0.25) * (S.t > S.dur - 0.5 && S.t < S.dur - 0.38 ? 0 : 1);
      for (const s of [-1, 1]) {
        const x = S.x + s * S.sep / 2, y = S.y;
        drawGlow(ctx, x, y, 12, '#ffd84a', 0.6 * k);
        ctx.globalAlpha = k;
        ctx.fillStyle = '#fff6a8';
        const hh = Math.max(0.5, 3.4 * open);
        ctx.beginPath(); ctx.ellipse(x, y, 4.2, hh, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#120804';
        const lx = clamp((this.game.fishing?.hook?.x ?? x) - x, -1.6, 1.6);
        ctx.fillRect(x - 0.6 + lx, y - hh * 0.9, 1.2, hh * 1.8);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawCreature(ctx, f, a, t, len = 0, col = '#000000') {
    if (!f?.c) return;
    try {
      const st = f.rigState({ silhouette: col, wash: null, glow: 0, time: t, noCull: false });
      ctx.globalAlpha = a;
      const an = drawFishRig(ctx, f.c, st);
      ctx.globalAlpha = 1;
      // a pale glint of an eye near the head
      let eye = an?.eyes?.[0];
      if (!eye && len) eye = { x: f.x + f.facing * len * 0.36, y: f.y - len * 0.04, r: len * 0.012 };
      if (eye && col === '#000000') {
        const k = 0.6 + 0.3 * Math.sin(t * 2.2);
        drawGlow(ctx, eye.x, eye.y, Math.max(4, Math.round((eye.r || 2) * 2.2)), '#d8f0ff', k * 0.7);
        ctx.fillStyle = '#eaf6ff'; ctx.globalAlpha = k;
        ctx.fillRect(Math.round(eye.x) - 1, Math.round(eye.y) - 1, 2, 2);
        ctx.globalAlpha = 1;
      }
    } catch (e) { ctx.globalAlpha = 1; this.fail(e); }
  }

  drawGiant(ctx, G, t) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    let L = this.giantLayer;
    if (!L) L = this.giantLayer = makeLayer(W, H);
    if (L.w !== W || L.h !== H) resizeLayer(L, W, H);
    const g = L.ctx, m = ctx.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
    g.setTransform(m);
    // a faint cold rim along its back (as if something far above lit it), then the body as a black void
    const fx = G.f.x, fy = G.f.y;
    G.f.x = fx - 1.2; G.f.y = fy - 1.4;
    this.drawCreature(g, G.f, 0.5, t, 0, '#3a5a86');
    G.f.x = fx; G.f.y = fy;
    this.drawCreature(g, G.f, 1, t, G.len);
    // the lantern's pool stays clear: the giant glides behind what the light shows
    const h = this.game.fishing?.hook;
    if (h?.visible) {
      const z = Math.hypot(m.a, m.b), x = h.x * z + m.e, y = h.y * z + m.f, r = 56 * z;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.94;
    ctx.drawImage(L.canvas, 0, 0);
    ctx.restore();
  }

  drawFrontDeep(ctx, env) {
    if (!this.L || !env?.view) return;
    const v = env.view, L = this.L, cy = (v.y0 + v.y1) / 2, z = zoneAt(L, cy);
    // the lunging scare passes in front of everything
    if (this.scare?.kind === 'lunge') this.drawCreature(ctx, this.scare.f, 0.96, this.t, this.scare.len);
    if (!z.deep) return;
    // vignette (screen space): the abyss closes in at the edges
    const k = z.id === 'abyss' ? 0.8 : z.id === 'midnight' ? 0.5 : 0.22;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    let vg = this.vignette;
    if (!vg || vg.width !== W || vg.height !== H) {
      vg = this.vignette = makeCanvas(W, H);
      const g = ctxOf(vg);
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.56);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.6, 'rgba(0,0,6,0.45)'); gr.addColorStop(1, 'rgba(0,0,8,0.95)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = k;
    ctx.drawImage(vg, 0, 0);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ shelf plant recipes per ocean
// [kind, count, {colors, size, z: [z0, z1], clump: [n0, n1], heads, petals}]
const SHELF = {
  oscean: [
    ['grass', 72, { colors: ['#3cb43a', '#4ac84a', '#2e9a36', '#62d24a'], clump: [3, 5], size: [1, 1.5] }],
    ['flower', 50, { colors: ['#2e9a36', '#3aa83e'], heads: ['daisy', 'tulip', 'star', 'daisy'], petals: ['#ff6aa8', '#ffd23a', '#ff5a5a', '#b88aff', '#ffffff', '#ff9a3a'], size: [1.1, 1.6] }],
  ],
  shallows: [
    ['seagrass', 46, { colors: ['#3a9a46', '#4ab04e', '#2e8a3e'], clump: [3, 5] }],
    ['kelp', 22, { colors: ['#8a8a2c', '#9a922c', '#7a7a26'], z: [0.05, 0.6], size: [0.9, 1.25], bulb: '#c8b84a' }],
    ['frond', 26, { colors: ['#4ab45a', '#5ac06a', '#3aa060'], clump: [1, 3] }],
  ],
  fjord: [
    ['kelp', 30, { colors: ['#6a5a2a', '#7a6a30', '#5a4a24'], z: [0.0, 0.6], size: [1, 1.35], bulb: '#a89048' }],
    ['frond', 30, { colors: ['#a8404e', '#c05a5a', '#8a3040'], clump: [1, 3] }],
    ['seagrass', 26, { colors: ['#6a2232', '#8a3a3a'], clump: [2, 4] }],
  ],
  junkyard: [
    ['seagrass', 40, { colors: ['#6a8a3a', '#5a7a32', '#7a9a44'], clump: [2, 5] }],
    ['kelp', 14, { colors: ['#6a6a30', '#7a7a3a'], z: [0.1, 0.6], bulb: '#a8a050' }],
    ['frond', 16, { colors: ['#5a8a4a', '#6a9a50'], clump: [1, 2] }],
  ],
  metropolis: [
    ['kelp', 20, { colors: ['#2a4e8a', '#3a6aa8', '#2a5a9a'], z: [0.05, 0.6], bulb: '#9ac8ff' }],
    ['seagrass', 34, { colors: ['#3a6a9a', '#4a7ab0', '#2a5a8a'], clump: [2, 4] }],
    ['frond', 18, { colors: ['#5a7ac8', '#6a8ad8'], clump: [1, 2] }],
  ],
  volcano: [
    ['frond', 26, { colors: ['#8a3a1e', '#a8482a', '#6a2a1a'], clump: [1, 3] }],
    ['seagrass', 22, { colors: ['#4a2416', '#6a3420'], clump: [2, 4] }],
    ['whip', 14, { colors: ['#c85a2a', '#e0703a'], z: [0.1, 0.5] }],
  ],
  abyss: [
    ['whip', 26, { colors: ['#4a5a8a', '#5a6aa0', '#6a5a9a'], z: [0.0, 0.55] }],
    ['frond', 20, { colors: ['#3a5a7a', '#4a6a8a'], clump: [1, 2] }],
  ],
};
const HANG = {
  oscean: ['#6a4a2e', '#7a5a34', '#4a8a3a', '#5a9a3e'],
  shallows: ['#4a7a3a', '#5a8a40', '#7a6a3a'],
  fjord: ['#5a4a2a', '#8a3a3a', '#6a5a30'],
  junkyard: ['#5a6a3a', '#4a4a3a', '#6a7a40'],
  metropolis: ['#3a5a8a', '#4a6a9a', '#3a4a6a'],
  volcano: ['#4a2a1a', '#3a2018', '#6a3a1e'],
  abyss: ['#3a4a6a', '#2a3a5a', '#4a5a7a'],
};

// ------------------------------------------------------------------ fish zones (game.world.zones, used by school.js)
// allow(sp) / rarityMul(sp) / place(fish, sp, opts) / popMul() / inZone(f) / expire(f)
export class ZoneSpawner {
  constructor(ocean) {
    this.ocean = ocean;
    this.cache = new Map();
  }

  get deep() { return this.ocean.biome?.deep || null; }

  // the zone the player is looking at (fish spawn around the view)
  zone() {
    const D = this.deep;
    if (!D?.L) return null;
    const v = this.ocean.game.world?.view;
    if (!v) return D.L.zones[0];
    return zoneAt(D.L, (v.y0 + v.y1) / 2);
  }

  zonesOf(sp) {
    const D = this.deep, id = this.ocean.biome?.id;
    return speciesZones(sp, id, D?.L);
  }

  // zones that actually have species in this ocean (empty zones borrow the nearest shallower one)
  liveZone(zid) {
    const id = this.ocean.biome?.id;
    const key = id + '|' + zid;
    if (this.cache.has(key)) return this.cache.get(key);
    const pool = SPECIES.filter((s) => s.biome === id && !s.spawn?.never);
    const order = ['sunlit', 'twilight', 'midnight', 'abyss'];
    let i = order.indexOf(zid), out = zid;
    while (i >= 0) {
      const z = order[i];
      if (pool.some((s) => this.zonesOf(s).includes(z))) { out = z; break; }
      i--;
    }
    this.cache.set(key, out);
    return out;
  }

  allow(sp) {
    const z = this.zone();
    if (!z) return true;
    const want = this.liveZone(z.id);
    const zs = this.zonesOf(sp);
    if (!zs.includes(want)) return false;
    // crawlers need a floor: the sunlit shelf or the abyss floor
    if ((sp.move?.style === 'crawl' || sp.move?.style === 'hop') && z.deep && z.id !== 'abyss') return false;
    return true;
  }

  rarityMul(sp) {
    const z = this.zone();
    if (!z) return 1;
    return ZONE_RARITY[z.id]?.[sp.rarity] ?? 1;
  }

  popMul() {
    const z = this.zone();
    return z ? ZONE_POP[z.id] ?? 1 : 1;
  }

  band(z) {
    const D = this.deep;
    return { top: z.top + 8, bot: z.id === 'abyss' ? D.L.bottom - 20 : z.y1 - 12 };
  }

  // move a freshly spawned fish into the zone the player is looking at and keep it there
  place(fish, sp, opts = {}) {
    const z = this.zone(), D = this.deep;
    if (!z || !D) return;
    fish.depthZone = z.id;
    if (!z.deep) return;
    const B = this.band(z);
    const inBand = fish.y >= B.top && fish.y <= B.bot;
    if (!(opts.x !== undefined && inBand) && !opts.hero) {
      const [d0, d1] = sp.move?.depth || [0.15, 0.85];
      const k = d0 + Math.random() * (d1 - d0);
      if (z.id === 'abyss' && (sp.move?.style === 'crawl' || sp.move?.style === 'hop')) fish.y = D.floorAt(fish.x, fish.z) - 6;
      else fish.y = lerp(B.top + 6, (z.id === 'abyss' ? D.floorAt(clamp(fish.x, 0, D.W), fish.z) - 12 : B.bot), k);
    }
    if (opts.hero) {
      // map the sunlit framing into the zone so a school of heroes keeps its formation
      const s0 = D.L.zones[0].y0, s1 = D.H;
      const m = (y) => lerp(B.top + 20, B.bot - 30, clamp01((y - s0) / Math.max(1, s1 - s0)));
      fish.y = m(fish.y);
      if (fish.passTarget) fish.passTarget.y = m(fish.passTarget.y);
    }
    if (fish.enterTarget) fish.enterTarget.y = fish.y;
    if (fish.passTarget) fish.passTarget.y = clamp(fish.passTarget.y, B.top, B.bot);
    if (fish.target) fish.target.y = fish.y;
    const base = fish.world, zw = Object.create(base);
    Object.defineProperty(zw, 'surfaceY', { get: () => B.top - 10, configurable: true });
    zw.floorAt = (x, zz = 0) => (z.id === 'abyss' ? D.floorAt(clamp(x, 0, D.W), zz) : B.bot + 6);
    zw.depthZone = z.id;
    fish.world = zw;
  }

  inZone(f) {
    const z = this.zone();
    if (!z) return true;
    return (f.depthZone || 'sunlit') === z.id || (!f.depthZone && !z.deep);
  }

  // fish far from the zone in view may leave early (keeps the population near the player)
  expire(f) {
    if (f.controlled || f.hero) return false;
    const v = this.ocean.game.world?.view;
    if (!v) return false;
    return !this.inZone(f) && (f.y < v.y0 - 200 || f.y > v.y1 + 200);
  }
}
