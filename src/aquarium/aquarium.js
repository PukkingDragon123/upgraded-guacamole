// The aquarium: a 3D glass box (one-point perspective, see tank3d.js) holding the player's fish,
// voxel decor, swaying plants, a voxel sand floor, Oxidized Coins that pile up in 3D, a snail janitor
// and a coin crab. Shown as a floating window on the desktop, as the full-screen desktop background
// (state.view === 'aquarium') and as a tiny tank in mini mode. One simulation; switching views
// re-maps it into the new tank size.
//
// API used by the game: addFish(rec), update(dt, inpOrNull), hit(x, y), drawFull, drawWindow, drawMini,
// windowRect(), toggleWindow(), openWindow(force), closeWindow(), forceCoin(), offlineCoins(sec), onResize().
// Extra: addDecor(id) (shop), storedDecor(), placeStored(id), tankSummary().

import { clamp, clamp01, lerp, dist, ease, rectContains, smoothstep, TAU } from '../core/math.js';
import { rng, RNG } from '../core/rng.js';
import { mix, rgba } from '../core/color.js';
import { makeCanvas, ctxOf, tinted } from '../core/canvas.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { drawText } from '../gfx/font.js';
import { getUiIcon, UI_ICON_NAMES } from '../gfx/uiicons.js';
import { drawButton, drawPlank } from '../ui/panels.js';
import { getProp, PROPS } from '../gfx/props.js';
import { Fish } from '../fish/fish.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { rollIndividual, valueMultiplier } from '../fish/traits.js';
import { COIN_RATE } from '../game/shopdata.js';
import { TASKBAR_H } from '../desktop/desktop.js';
import { CoinPile, coinSheet, pumpCoinSheets, frameOf, glintSprite, DENOMS, COIN_R } from './coins.js';
import { TankSpace, renderBackdrop, renderGlass, renderFrame, brassButton, shaftSprite, causticFrames, FOG_SLABS, WATER } from './tank3d.js';
import { plantFrames, SWAY_FRAMES } from './plants.js';
import { Snail, CoinCrab, drawEggs, eggColor } from './critters.js';

const COIN_CAP = 150;
const HUNGER_RATE = 1 / 2000; // 0 -> 0.6 ("hungry") in 20 minutes
const ICONS = new Set(UI_ICON_NAMES);
const EMOTE_ICON = { '!': 'exclaim', '!!': 'exclaim', '?': 'question', $: 'dollar' };
const STARTER_DECOR = [{ id: 'rock_arch', x: 0.3, z: 0.62 }, { id: 'coral_fan', x: 0.74, z: 0.38 }];

// Per-view tank geometry and detail level.
const CFG = {
  full: { vpy: 0.46, surf: 10, floorPad: 44, slope: 24, cell: 5, step: 2, shafts: 7, caustics: true, slabs: 4, bubbles: 16, plants: [8, 4, 3, 6] },
  window: { vpy: 0.44, surf: 6, floorPad: 18, slope: 12, cell: 3, step: 1, shafts: 4, caustics: true, slabs: 4, bubbles: 7, plants: [5, 2, 2, 3] },
  mini: { vpy: 0.44, surf: 4, floorPad: 11, slope: 7, cell: 2, step: 1, shafts: 2, caustics: false, slabs: 2, bubbles: 3, plants: [3, 0, 1, 1] },
};
const FRAME = { window: { lid: 16, side: 5, base: 15 }, mini: { lid: 9, side: 3, base: 8 } };

export class Aquarium {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.fish = [];
    this.food = [];
    this.bubbles = [];
    this.glints = [];
    this.decor = [];
    this.colliders = [];
    this.coins = new CoinPile();
    this.coins.onBounce = (v, c) => this.onCoinBounce(v, c);
    this.particles = new Particles(360);
    this.views = new Map();
    this.view = null;
    this.drag = null;
    this.combo = 0; this.comboT = 0;
    this.winAnim = 1;
    this.visibleKey = null;
    this.hoverFish = null;
    this.hoverBtn = null;
    this.syncT = 0; this.moodT = 0; this.saveT = 0; this.feederT = 20;
    this.coinsDirty = false;
    this.snail = null; this.crab = null;
    this.prevCursor = null;
    this.world = this.makeWorld();
    this.load();
    this.warm = ['window', 'full'];
  }

  // Background warm-up: one heavy job per frame (backdrop art, then plant frames) so the first
  // switch between views does not hitch.
  prewarm() {
    if (!this.warmJobs) this.warmJobs = [];
    if (!this.warmJobs.length && this.warm.length) {
      const key = this.warm.shift();
      if (this.game.mini && key === 'full') return;
      const v = this.buildView(key);
      this.warmJobs.push(() => this.artFor(v));
      for (const p of v.plants) this.warmJobs.push(() => { if (!p.frames) p.frames = plantFrames(p.kind, p.h * v.T.s(p.z), p.seed); });
      for (let d = 0; d < 3; d++) this.warmJobs.push(() => coinSheet(d, COIN_R[d] * v.coinScale, true));
      for (const d of this.decor) {
        this.warmJobs.push(() => {
          const sc = this.decorScale(d, clamp(d.rec.z ?? 0.5, 0.04, 0.95), v);
          if (d.props.has(sc)) return;
          try { const p = getProp(d.rec.id, { scale: sc, variant: d.rec.v || 0 }); p.scale = sc; d.props.set(sc, p); } catch { /* unknown prop */ }
        });
      }
    }
    const job = this.warmJobs.shift();
    if (job) job();
  }

  // ------------------------------------------------------------------ state
  get st() { return this.game.state; }
  get stats() { return this.game.stats || {}; }

  ensureState() {
    const st = this.st;
    st.tank ||= {};
    const tk = st.tank;
    tk.decor ||= [];
    tk.eggs ||= [];
    tk.stored ||= [];
    tk.coins ||= [];
    if (!tk.starter) {
      if (!tk.decor.length) tk.decor.push(...STARTER_DECOR.map((d) => ({ ...d })));
      tk.starter = true;
    }
    for (const d of tk.decor) if (d.z === undefined) d.z = 0.3 + ((d.x * 997) % 1) * 0.5;
    st.tankWindow ||= { open: false, x: 0, y: 0 };
  }

  load() {
    this.stateRef = this.game.state;
    this.ensureState();
    this.fish.length = 0;
    this.food.length = 0;
    this.coins.list.length = 0;
    this.decor = this.st.tank.decor.filter((d) => PROPS[d.id]).map((rec) => ({ rec, props: new Map() }));
    this.view = null;
    this.applyView(this.simKey());
    this.syncFish();
    this.restoreCoins();
  }

  makeWorld() {
    const self = this;
    return {
      W: 300, H: 200, surfaceY: 6,
      floorAt: (x, z = 0) => self.T.floorAt(x, z),
      cursor: { x: -999, y: -999, vx: 0, vy: 0, speed: 0, inWorld: false },
      hook: null, fishes: this.fish, icons: [], windows: [], particles: this.particles,
      audio: { play: (n, o) => self.sfx(n, o) },
      desktop: null, biome: 'tank', night: false, dusk: false, weather: 'calm', hour: 12,
      secrets: {}, rarityBoost: 1, calmMul: 1, isTank: true, glowLevel: 0, rollMods: {}, lowPower: false, populationMul: 1,
      food: this.food, decorSpots: [],
      onEat: (f, food) => self.onEat(f, food),
      onCourt: (a, b) => self.onCourt(a, b),
      canCourt: (f) => self.canCourt(f),
      requestNibble: () => false,
    };
  }

  sfx(name, opts) {
    if (!this.visibleKey) return;
    try { audio.play(name, opts); } catch { /* audio not ready */ }
  }

  // ------------------------------------------------------------------ views & geometry
  simKey() {
    const g = this.game;
    if (g.mini) return 'mini';
    return g.state.view === 'aquarium' ? 'full' : 'window';
  }

  shownKey() {
    const g = this.game;
    if (g.mini) return 'mini';
    if (g.state.view === 'aquarium') return 'full';
    return g.state.tankWindow?.open ? 'window' : null;
  }

  innerSize(key) {
    const { W, H } = this.game.screen;
    if (key === 'full') return { iw: W, ih: H - TASKBAR_H + 8 };
    if (key === 'mini') return { iw: 176, ih: 104 };
    const cap = this.stats.tankCap || 4;
    const iw = clamp(Math.round(256 + (cap - 4) * 9), 256, Math.min(420, W - 40));
    return { iw, ih: Math.round(iw * 0.6) };
  }

  buildView(key) {
    const { iw, ih } = this.innerSize(key);
    const vk = key + '|' + iw + 'x' + ih;
    let v = this.views.get(vk);
    if (v) return v;
    const c = CFG[key];
    const T = new TankSpace(iw, ih, { vpy: c.vpy, surf: c.surf, floorFront: ih - c.floorPad, slope: c.slope, cell: c.cell, step: c.step, seed: 7 });
    const fishScale = key === 'full' ? 1 : key === 'mini' ? 0.34 : clamp((iw / 960) * 1.35, 0.42, 0.62);
    v = {
      key, vk, iw, ih, T, cfg: c, fishScale,
      coinScale: key === 'full' ? 1 : key === 'mini' ? 0.5 : clamp(fishScale * 1.2, 0.55, 0.75),
      decorScale: key === 'full' ? 1 : clamp((iw / 960) * 1.35, 0.28, 0.6),
      frame: FRAME[key] ? renderFrame(iw, ih, FRAME[key]) : null,
      art: null,
    };
    v.plants = this.layoutPlants(v);
    v.shafts = [];
    for (let i = 0; i < c.shafts; i++) {
      v.shafts.push({ X: (0.1 + (i + rng.float(0.2, 0.8)) / c.shafts * 0.82) * iw, z: rng.float(0.25, 0.92), w: rng.float(0.05, 0.11) * iw, a: rng.float(0.22, 0.38), ph: rng.float(0, TAU) });
    }
    v.stone = { X: iw * 0.1, z: 0.84 };
    for (const [k, old] of this.views) if (old.key === key && old !== this.view) this.views.delete(k);
    this.views.set(vk, v);
    return v;
  }

  // Heavy art is built on first draw.
  artFor(v) {
    if (v.art) return v.art;
    const T = v.T;
    const bd = renderBackdrop(T);
    const fog = makeCanvas(1, T.H);
    const fg = ctxOf(fog);
    for (let y = 0; y < T.H; y++) {
      const t = 0.8 - 0.44 * clamp01((y - T.surf) / (T.floorFront - T.surf));
      fg.fillStyle = WATER[clamp(Math.round(lerp(t, 0.5, 0.35) * 12), 0, 12)];
      fg.fillRect(0, y, 1, 1);
    }
    v.art = {
      backdrop: bd.canvas, glass: renderGlass(T, { edges: v.key === 'full' }), fog,
      floorPoly: bd.floorPoly, ceilPoly: bd.ceilPoly, floorTopY: Math.min(...bd.floorTop),
      layer: makeCanvas(T.W, T.H), caustics: v.cfg.caustics,
    };
    v.art.lg = ctxOf(v.art.layer);
    return v.art;
  }

  layoutPlants(v) {
    const r = new RNG(1234 + v.iw);
    const [nBack, nSide, nFront, nTuft] = v.cfg.plants;
    const sc = v.fishScale;
    const out = [];
    const add = (kind, X, z, h) => out.push({ kind, X, z, h, seed: r.int(1, 9999), ph: r.float(0, 1), frames: null });
    for (let i = 0; i < nBack; i++) add(r.pick(['vallis', 'vallis', 'cabomba', 'rotala']), (0.06 + (i + r.float(0.1, 0.9)) / nBack * 0.88) * v.iw, r.float(0.86, 0.97), r.float(170, 250) * sc);
    for (let i = 0; i < nSide; i++) add(r.pick(['rotala', 'sword', 'fern', 'cabomba']), (i % 2 ? r.float(0.88, 0.96) : r.float(0.04, 0.12)) * v.iw, r.float(0.35, 0.72), r.float(100, 150) * sc);
    for (let i = 0; i < nFront; i++) add(r.pick(['fern', 'sword', 'hairgrass']), (i % 2 ? r.float(0.9, 0.97) : r.float(0.03, 0.1)) * v.iw, r.float(0.04, 0.12), r.float(40, 70) * sc);
    for (let i = 0; i < nTuft; i++) add('hairgrass', r.float(0.15, 0.85) * v.iw, r.float(0.15, 0.75), r.float(16, 28) * sc);
    return out;
  }

  // Map the live simulation from the current view into view `key`.
  applyView(key) {
    const nv = this.buildView(key);
    const ov = this.view;
    if (ov === nv) return;
    const T = nv.T;
    if (ov) {
      const O = ov.T;
      const sx = T.W / O.W;
      for (const f of this.fish) {
        const z = f.z;
        const X = O.X(f.x, z) * sx;
        const fy = clamp01((O.Y(f.y, z) - O.surf) / (O.groundZ(X / sx, z) - O.surf));
        f.x = T.sx(X, z);
        f.y = T.sy(T.surf + fy * (T.groundZ(X, z) - T.surf), z);
        f.target = null; f.bed = null; f.vx *= 0.5; f.vy *= 0.5;
      }
      const sd = T.DEPTH / O.DEPTH;
      for (const c of this.coins.list) {
        const above = O.ground(c.X, c.D) - c.Y;
        c.X *= sx; c.D *= sd;
        c.Y = T.ground(c.X, c.D) - above * sx;
      }
      for (const f of this.food) { f.X *= sx; const above = O.groundZ(f.X / sx, f.z) - f.Y; f.Y = T.groundZ(f.X, f.z) - above * sx; }
      this.snail?.rescale(sx);
      this.crab?.rescale(sx);
      this.bubbles.length = 0;
      this.particles.clear();
    }
    this.view = nv;
    this.T = T;
    const w = this.world;
    w.W = T.W; w.H = T.H; w.surfaceY = T.surf;
    for (const f of this.fish) this.scaleFish(f);
    this.layoutDecor();
    this.coins.setTank({ W: T.W, DEPTH: T.DEPTH, ground: (X, D) => T.ground(X, D), slope: (X, D) => T.slopeAt(X, D), colliders: this.colliders }, nv.coinScale);
    if (ov) for (let i = 0; i < 30; i++) this.coins.step(1 / 60);
    this.particles.surfaceY = T.surf;
  }

  scaleFish(f) {
    const vs = this.view.fishScale;
    f.scale = f.baseScale * vs;
    f.cruise = f.cruise0 * (0.35 + 0.65 * vs);
    f.burst = f.burst0 * (0.35 + 0.65 * vs);
  }

  // ------------------------------------------------------------------ decor
  decorScale(d, z, v = this.view) {
    const size = PROPS[d.rec.id]?.decor?.size || 1;
    const base = v.decorScale * [1.0, 0.92, 0.84][size - 1];
    return Math.max(0.1, Math.round(base * v.T.s(z) * 25) / 25);
  }

  layoutDecor() {
    const T = this.T;
    this.colliders.length = 0;
    const spots = [];
    for (const d of this.decor) {
      d.X = clamp(d.rec.x, 0.03, 0.97) * T.W;
      d.z = clamp(d.rec.z ?? 0.5, 0.04, 0.95);
      d.scale = this.decorScale(d, d.z);
      d.prop = d.props.get(d.scale) || null;
      if (!d.prop) this.queueProp(d, d.scale);
      this.addCollider(d);
      const meta = PROPS[d.rec.id];
      const p = d.prop || [...d.props.values()][0];
      const h = p ? p.h / (p.scale || 1) * d.scale : 40 * this.view.fishScale;
      const gy = T.groundZ(d.X, d.z);
      const hide = meta?.tags?.some((t) => t === 'swimthrough' || t === 'home' || t === 'rock' || t === 'wreck' || t === 'build');
      spots.push({ x: T.sx(d.X, d.z), y: T.sy(gy - h * 0.35 / T.s(d.z), d.z), z: d.z, kind: hide ? 'hide' : 'visit', decor: d });
    }
    this.world.decorSpots = spots;
  }

  addCollider(d) {
    const p = d.prop;
    if (!p) return;
    const s = this.T.s(d.z);
    this.colliders.push({ X: d.X, D: d.z * this.T.DEPTH, R: Math.max(3, (p.w * 0.3) / s), H: Math.max(3, (p.h * 0.72) / s), base: this.T.groundZ(d.X, d.z), d });
  }

  queueProp(d, scale) {
    (this.propQueue ||= []);
    if (!this.propQueue.some((q) => q.d === d && q.scale === scale)) this.propQueue.push({ d, scale });
  }

  pumpProps() {
    const q = this.propQueue;
    if (!q?.length) return;
    const job = q.shift();
    const d = job.d;
    if (!this.decor.includes(d) || d.props.has(job.scale)) return;
    try {
      const p = getProp(d.rec.id, { scale: job.scale, variant: d.rec.v || 0 });
      p.scale = job.scale;
      d.props.set(job.scale, p);
    } catch (e) { console.warn('decor', d.rec.id, e); this.decor = this.decor.filter((x) => x !== d); return; }
    if (d.scale === job.scale) {
      d.prop = d.props.get(job.scale);
      this.layoutDecor();
      this.coins.wakeAll();
    }
  }

  // Shop entry point: place a decoration in the tank. Returns true on success.
  addDecor(id, opts = {}) {
    const meta = PROPS[id];
    if (!meta?.decor) return false;
    const tk = this.st.tank;
    let best = null, bs = -1;
    for (let i = 0; i < 40; i++) {
      const x = rng.float(0.08, 0.92), z = rng.float(0.2, 0.85);
      let m = 9;
      for (const d of tk.decor) m = Math.min(m, Math.abs(d.x - x) + Math.abs((d.z ?? 0.5) - z) * 0.6);
      if (m > bs) { bs = m; best = { x, z }; }
    }
    const rec = { id, x: opts.x ?? best.x, z: opts.z ?? best.z };
    if (opts.v) rec.v = opts.v;
    tk.decor.push(rec);
    this.decor.push({ rec, props: new Map() });
    this.layoutDecor();
    this.coins.wakeAll();
    this.game.save?.();
    return true;
  }

  storedDecor() { return this.st.tank.stored.slice(); }

  // Put a packed-away decoration back into the tank (the first one when no id is given).
  placeStored(id) {
    const st = this.st.tank.stored;
    const i = id ? st.indexOf(id) : st.length - 1;
    if (i < 0) return false;
    const [pid] = st.splice(i, 1);
    if (this.addDecor(pid)) { this.sfx('box_close', { vol: 0.5 }); return true; }
    st.push(pid);
    return false;
  }

  storeDecor(d) {
    const tk = this.st.tank;
    tk.decor = tk.decor.filter((r) => r !== d.rec);
    tk.stored.push(d.rec.id);
    this.decor = this.decor.filter((x) => x !== d);
    this.layoutDecor();
    this.coins.wakeAll();
    this.game.toast?.(`${PROPS[d.rec.id]?.name || 'Decoration'} packed away. Use "Unpack" at the top to place it again.`, 'tank');
    this.sfx('ui_close');
    this.game.save?.();
  }

  // ------------------------------------------------------------------ fish
  addFish(rec, opts = {}) {
    if (this.fish.some((f) => f.rec === rec)) return;
    const f = this.makeFish(rec, { splash: opts.splash ?? true, ...opts });
    if (f) this.game.emit?.('tankFish', rec);
  }

  makeFish(rec, opts = {}) {
    const sp = SPECIES_BY_ID[rec.species];
    if (!sp) return null;
    rec.hunger ??= 0.3; rec.happiness ??= 0.75; rec.coinT ??= 0;
    const z = opts.z ?? rng.float(0.08, 0.6);
    const f = new Fish(rec, sp, this.world, { z });
    f.z = z;
    f.baseScale = f.scale; f.cruise0 = f.cruise; f.burst0 = f.burst;
    this.scaleFish(f);
    const T = this.T;
    if (opts.at) { f.x = opts.at.x; f.y = opts.at.y; f.z = opts.at.z; }
    else {
      f.x = lerp(T.left(z), T.right(z), rng.float(0.2, 0.8));
      f.y = opts.splash ? T.top(z) + 3 : lerp(T.top(z), T.floorAt(f.x, z), rng.float(0.2, 0.75));
    }
    if (opts.splash) {
      f.vy = 90 * this.view.fishScale;
      f.target = { x: f.x + rng.float(-30, 30) * this.view.fishScale, y: lerp(T.top(f.z), T.floorAt(f.x, f.z), rng.float(0.35, 0.6)), z: f.z };
      f.wanderT = 4;
      this.particles.splash(f.x, T.top(f.z), 0.5 * this.view.fishScale + 0.2);
      this.sfx('splash_small', { vol: 0.6 });
    }
    if (opts.baby) { f.scale *= 0.7; f.baby = 40; }
    f.setState('wander');
    this.fish.push(f);
    return f;
  }

  syncFish() {
    const recs = this.st.fish || [];
    for (const rec of recs) if (rec.inTank && !this.fish.some((f) => f.rec === rec)) this.makeFish(rec, { splash: false });
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      if (!f.rec.inTank || !recs.includes(f.rec)) this.fish.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ window / views API
  frameDims(key = 'window') {
    const { iw, ih } = this.innerSize(key);
    const f = FRAME[key];
    return { w: iw + f.side * 2, h: ih + f.lid + f.base, ...f, iw, ih };
  }

  windowRect() {
    const g = this.game;
    if (g.mini || g.state.view !== 'ocean' || !g.state.tankWindow?.open) return null;
    const d = this.frameDims('window');
    const tw = g.state.tankWindow;
    return { x: tw.x, y: tw.y, w: d.w, h: d.h };
  }

  miniRect() {
    const d = this.frameDims('mini');
    const { W, H } = this.game.screen;
    return { x: W - d.w - 10, y: H - TASKBAR_H - d.h - 8, w: d.w, h: d.h };
  }

  clampWindow() {
    const tw = this.st.tankWindow;
    const d = this.frameDims('window');
    const { W, H } = this.game.screen;
    tw.x = Math.round(clamp(tw.x, 4 - d.w * 0.6, W - d.w * 0.4));
    tw.y = Math.round(clamp(tw.y, 0, H - TASKBAR_H - 20));
  }

  openWindow(force = false) {
    const g = this.game;
    const tw = g.state.tankWindow;
    const was = tw.open && g.state.view === 'ocean';
    tw.open = true;
    const d = this.frameDims('window');
    const { W, H } = g.screen;
    if (force || (!tw.x && !tw.y) || tw.x > W - 40 || tw.y > H - 60) {
      tw.x = Math.round(W * 0.38 - d.w / 2);
      tw.y = Math.round(H - TASKBAR_H - d.h - 46);
    }
    this.clampWindow();
    if (!was) { this.winAnim = 0; audio.play('ui_open'); }
  }

  closeWindow() {
    const tw = this.st.tankWindow;
    if (tw?.open) { tw.open = false; if (this.game.state.view === 'ocean') audio.play('ui_close'); }
    if (this.drag?.kind === 'window') this.drag = null;
  }

  toggleWindow() {
    const g = this.game;
    if (g.state.view === 'aquarium') { g.setView?.('ocean'); this.openWindow(); return; }
    if (g.state.tankWindow.open) this.closeWindow(); else this.openWindow();
  }

  onResize() {
    if (this.st.tankWindow) this.clampWindow();
  }

  // Inner (glass) rect origin on screen for the shown view.
  innerOrigin(key) {
    if (key === 'full') return { x: 0, y: 0 };
    if (key === 'mini') { const r = this.miniRect(); return { x: r.x + FRAME.mini.side, y: r.y + FRAME.mini.lid }; }
    const tw = this.st.tankWindow;
    return { x: tw.x + FRAME.window.side, y: tw.y + FRAME.window.lid + this.slideOff() };
  }

  slideOff() { return Math.round((1 - ease.outCubic(clamp01(this.winAnim))) * 14); }

  hit(x, y) {
    const g = this.game;
    if (g.mini) return rectContains(this.miniRect(), x, y);
    if (g.state.view === 'aquarium') {
      if (this.drag) return true;
      if (g.desktop?.hit?.(x, y)) return false;
      return x >= 0 && y >= 0 && x < g.screen.W && y < g.screen.H - TASKBAR_H;
    }
    if (!g.state.tankWindow?.open) return false;
    if (this.drag) return true;
    const r = this.windowRect();
    if (!r || !rectContains(r, x, y)) return false;
    const d = g.desktop?.hit?.(x, y);
    return !(d === 'window' || d === 'taskbar' || d === 'start');
  }

  // ------------------------------------------------------------------ economy hooks
  fishRate(f) {
    const rec = f.rec, sp = f.sp;
    const happy = clamp01(rec.happiness ?? 0.7);
    return (COIN_RATE[sp.rarity] || 2) * valueMultiplier(rec) * (0.6 + 0.8 * happy) * (this.stats.coinMul || 1);
  }

  forceCoin() {
    const f = this.fish[0];
    if (f) this.dropCoin(f, 0, true);
    else {
      const T = this.T;
      this.coins.spawn(T.W / 2, T.surf + 6, T.DEPTH * 0.15, 0, { vy: 10 }).hint = true;
      this.coinsDirty = true;
    }
  }

  dropCoin(f, d, forced = false) {
    const T = this.T;
    const X = clamp(T.X(f.x, f.z), 4, T.W - 4), Y = Math.max(T.surf + 4, T.Y(f.y, f.z) + 2), D = f.z * T.DEPTH;
    const c = this.coins.spawn(X, Y, D, d, { vx: rng.float(-14, 14), vy: -rng.float(18, 36), vd: rng.float(-6, 6) });
    if (forced) { c.hint = true; c.D = Math.min(c.D, T.DEPTH * 0.2); }
    this.sfx('coin_spawn', { vol: forced ? 0.7 : 0.4 * (1 - f.z * 0.5), pitch: [1.15, 1, 0.86][d] });
    this.particles.ring(f.x, f.y + 2, 0.15 + 0.25 * this.view.fishScale * T.s(f.z), 'rgba(255,236,170,0.9)');
    f.squashV += 4;
    if (!f.emote) f.feel('happy', 0.8);
    this.coinsDirty = true;
    this.capCoins();
  }

  // Beyond the cap, five small coins melt into the next denomination.
  capCoins() {
    const list = this.coins.list;
    let guard = 8;
    while (list.length > COIN_CAP && guard-- > 0) {
      let merged = false;
      for (const d of [0, 1]) {
        const cand = list.filter((c) => c.d === d && c.value === DENOMS[d]);
        if (cand.length < 5) continue;
        const a = cand.reduce((m, c) => (c.sleep && c.id < m.id ? c : m), cand[0]);
        cand.sort((p, q) => (p.X - a.X) ** 2 + (p.D - a.D) ** 2 + (p.Y - a.Y) ** 2 - ((q.X - a.X) ** 2 + (q.D - a.D) ** 2 + (q.Y - a.Y) ** 2));
        const grp = cand.slice(0, 5);
        let X = 0, Y = 0, D = 0;
        for (const c of grp) { X += c.X / 5; Y = Math.min(Y || c.Y, c.Y); D += c.D / 5; this.coins.remove(c); }
        this.coins.spawn(X, Y - 2, D, d + 1, { vy: -20 });
        const sp = this.toLocal(X, Y, D);
        if (this.visibleKey) for (let i = 0; i < 5; i++) this.particles.sparkle(sp.x + rng.float(-4, 4), sp.y + rng.float(-4, 4), '#9affd8');
        merged = true;
        break;
      }
      if (!merged) {
        const big = list.filter((c) => c.d === 2).sort((p, q) => p.value - q.value);
        if (big.length < 2) break;
        big[1].value += big[0].value;
        this.coins.remove(big[0]);
      }
    }
  }

  toLocal(X, Y, D) {
    const z = D / this.T.DEPTH;
    return { x: this.T.sx(X, z), y: this.T.sy(Y, z), z };
  }

  collectCoin(c, by = 'player') {
    if (!this.coins.list.includes(c)) return;
    this.coins.remove(c);
    this.coinsDirty = true;
    const p = this.toLocal(c.X, c.Y, c.D);
    const vk = this.visibleKey;
    let sx, sy;
    if (vk) { const o = this.innerOrigin(vk); sx = o.x + p.x; sy = o.y + p.y; }
    this.game.addCoins?.(c.value, sx, sy);
    if (vk) {
      this.combo = this.comboT > 0 ? this.combo + 1 : 0;
      this.comboT = 0.45;
      this.sfx('coin_collect', { vol: by === 'player' ? 0.45 : 0.25, pitch: 1 + Math.min(12, this.combo) * 0.045 });
      for (let i = 0; i < 3; i++) this.particles.sparkle(p.x + rng.float(-3, 3), p.y + rng.float(-3, 3), '#fff2b0');
      if (c.value > 1 || by !== 'player') this.particles.text(p.x, p.y - 6, '+' + c.value, { font: 'small', color: c.d === 2 ? '#ffe27a' : '#b8ffe0', layer: 'fg', life: 0.9, vy: -16 });
    }
    this.game.emit?.('coinCollected', { value: c.value, by });
  }

  onCoinBounce(v, c) {
    if (!this.visibleKey) return;
    const z = c.D / this.T.DEPTH;
    this.sfx('coin_bounce', { vol: clamp(v / 170, 0.04, 0.32) * (1 - z * 0.5), pitch: clamp(0.78 + v / 240, 0.75, 1.5) * [1.15, 1, 0.86][c.d] });
  }

  onEat(f, food) {
    const rec = f.rec;
    rec.hunger = Math.max(0, (rec.hunger ?? 0.5) - 0.16);
    rec.happiness = Math.min(1, (rec.happiness ?? 0.7) + 0.015);
    food.eaten = true;
    this.particles.burst(food.x, food.y, 3, { colors: [food.c, '#ffe0a0'], speed: 12, g: 10, life: 0.4, size: 1 });
  }

  canCourt(f) {
    const s = this.stats;
    if (!s.breeding || this.world.night) return false;
    const rec = f.rec;
    if ((rec.happiness ?? 0) < 0.62 || (rec.hunger ?? 1) > 0.6 || f.baby > 0) return false;
    if ((rec.breedAt || 0) > Date.now()) return false;
    return this.st.tank.eggs.length < 2;
  }

  onCourt(a, b) {
    const T = this.T;
    const X = (T.X(a.x, a.z) + T.X(b.x, b.z)) / 2, z = clamp((a.z + b.z) / 2, 0.08, 0.85);
    const egg = { species: a.sp.id, x: clamp(X / T.W, 0.05, 0.95), z, t: 0, dur: 180 / (this.stats.hatchSpeed || 1), n: rng.int(3, 6), color: eggColor(a.sp), parents: [a.rec.uid, b.rec.uid] };
    this.st.tank.eggs.push(egg);
    const later = Date.now() + 6 * 60 * 1000;
    a.rec.breedAt = later; b.rec.breedAt = later;
    a.say('heart', 1.5); b.say('heart', 1.5);
    this.sfx('magic', { vol: 0.5 });
    this.game.toast?.(`${a.rec.name} & ${b.rec.name} laid eggs! They hatch in a few minutes.`, 'heart');
  }

  hatch(egg) {
    const g = this.game;
    const sp = SPECIES_BY_ID[egg.species];
    if (!sp) return;
    const s = this.stats;
    const rolled = rollIndividual(sp, { mutationChance: (s.mutationChance ?? 0.05) * 3, shinyChance: (s.shinyChance ?? 1 / 220) * 3, sizeBonus: -0.05 });
    const inTank = this.fish.length < (s.tankCap || 4);
    const rec = { ...rolled, inTank, happiness: 0.85, hunger: 0.2, coinT: 0, bornAt: Date.now(), caughtAt: Date.now(), rarity: sp.rarity, bred: true, parents: egg.parents };
    (g.state.fish ||= []).push(rec);
    const T = this.T;
    const X = egg.x * T.W;
    if (inTank) this.makeFish(rec, { splash: false, baby: true, at: { x: T.sx(X, egg.z), y: T.floorAt(T.sx(X, egg.z), egg.z) - 4, z: egg.z } });
    const p = this.toLocal(X, T.groundZ(X, egg.z) - 2, egg.z * T.DEPTH);
    this.particles.burst(p.x, p.y, 10, { colors: ['#fff6e8', egg.color, '#ffffff'], speed: 30, g: 30, life: 0.7, up: 10 });
    this.sfx('sparkle', { vol: 0.6 });
    const trait = rec.variant?.shiny ? 'a SHINY ' : rec.variant?.mutation ? 'a mutated ' : 'a baby ';
    g.toast?.(`${trait}${sp.name} hatched${inTank ? '!' : ' - the tank is full, it went to the holding bucket.'}`, 'heart');
    g.emit?.('hatched', rec);
    g.save?.();
  }

  offlineCoins(seconds) {
    const st = this.st, s = this.stats;
    let rate = 0;
    for (const rec of st.fish || []) {
      if (!rec.inTank) continue;
      const sp = SPECIES_BY_ID[rec.species];
      if (!sp) continue;
      rate += (COIN_RATE[sp.rarity] || 2) * valueMultiplier(rec) * (0.6 + 0.8 * clamp01(rec.happiness ?? 0.7)) * (s.coinMul || 1);
      rec.hunger = Math.min(s.feeder ? 0.45 : 1, (rec.hunger ?? 0.3) + seconds * HUNGER_RATE);
    }
    for (const e of st.tank.eggs) e.t += seconds;
    const amount = Math.floor((rate / 60) * seconds * (s.offlineMul ?? 0.35));
    if (amount <= 0) return 0;
    // up to ~70 physical coins land in the tank as a welcome-back pile; the rest goes straight to the purse
    let left = Math.min(amount, 900);
    const direct = amount - left;
    if (direct > 0) this.game.addCoins?.(direct);
    const T = this.T;
    let n = 0;
    while (left > 0 && n < 70) {
      const per = left / (70 - n);
      const d = per >= 25 || left >= 400 ? 2 : per >= 5 || left >= 60 ? 1 : 0;
      const val = Math.min(left, d === 2 ? Math.max(25, Math.round(per / 25) * 25) : DENOMS[d]);
      const z = rng.float(0.04, 0.5);
      this.coins.spawn(rng.float(0.15, 0.85) * T.W, T.surf + rng.float(10, 60), z * T.DEPTH, d, { value: val });
      left -= val; n++;
    }
    if (left > 0) this.game.addCoins?.(left);
    for (let i = 0; i < 120; i++) this.coins.step(1 / 40);
    this.coinsDirty = true;
    return amount;
  }

  saveCoins() {
    const T = this.T;
    this.st.tank.coins = this.coins.list.map((c) => [Math.round((c.X / T.W) * 1000) / 1000, Math.round((c.D / T.DEPTH) * 1000) / 1000, c.d, c.value]);
    this.coinsDirty = false;
  }

  restoreCoins() {
    const T = this.T;
    for (const [x, z, d, v] of this.st.tank.coins || []) {
      if (!(d >= 0 && d <= 2)) continue;
      this.coins.spawn(x * T.W, T.groundZ(x * T.W, z) - 8 - rng.float(0, 10), z * T.DEPTH, d, { value: v });
    }
    for (let i = 0; i < 90; i++) this.coins.step(1 / 40);
  }

  tankSummary() {
    const n = this.fish.length;
    const happy = n ? this.fish.reduce((a, f) => a + (f.rec.happiness ?? 0.7), 0) / n : 0;
    const rate = this.fish.reduce((a, f) => a + this.fishRate(f), 0);
    return { fish: n, cap: this.stats.tankCap || 4, happiness: happy, coinsPerMin: rate, coins: this.coins.list.length, decor: this.decor.length };
  }

  // ------------------------------------------------------------------ update
  update(dt, inp) {
    const g = this.game;
    if (this.stateRef !== g.state) this.load();
    this.t += dt;
    pumpCoinSheets(3);
    this.pumpProps();
    if (this.t > 1.2 && (this.warm.length || this.warmJobs?.length)) this.prewarm();
    const key = this.simKey();
    const sz = this.innerSize(key);
    if (!this.view || this.view.key !== key || this.view.iw !== sz.iw || this.view.ih !== sz.ih) this.applyView(key);
    const shown = this.shownKey();
    this.visibleKey = shown === key ? shown : null;
    if (this.visibleKey === 'window') this.winAnim = Math.min(1, this.winAnim + dt * 5);
    const w = this.world;
    const clock = g.clock;
    w.night = clock ? clock.isNight() : false;
    w.dusk = clock ? clock.isDusk() : false;
    w.hour = clock ? clock.hour() : 12;
    w.glowLevel = clock ? clamp01(1 - clock.daylight()) * 0.8 : 0;
    w.calmMul = this.stats.calm || 1;
    this.comboT = Math.max(0, this.comboT - dt);

    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 0.5; this.syncFish(); }

    this.handleInput(dt, inp);
    this.updateFood(dt);
    this.updateFish(dt);
    this.updateEconomy(dt);
    this.coins.step(dt);
    this.updateEggs(dt);
    this.updateHelpers(dt);
    this.updateBubbles(dt);
    this.particles.update(dt);

    this.saveT -= dt;
    if (this.saveT <= 0 && this.coinsDirty) { this.saveT = 1; this.saveCoins(); }
  }

  handleInput(dt, inp) {
    const g = this.game;
    const vk = this.visibleKey;
    const cur = this.world.cursor;
    this.hoverFish = null;
    this.hoverBtn = null;
    this.hoverDecor = null;
    if (!inp || !vk) {
      cur.inWorld = false;
      if (this.drag && (!inp || !inp.down)) this.endDrag();
      this.prevCursor = null;
      return;
    }
    const o = this.innerOrigin(vk);
    const v = this.view, T = this.T;
    const lx = inp.x - o.x, ly = inp.y - o.y;

    // window chrome: drag by the lid, close / expand buttons
    if (vk === 'window' || vk === 'mini') {
      const tw = g.state.tankWindow;
      if (this.drag?.kind === 'window') {
        if (inp.down) { tw.x = Math.round(inp.x - this.drag.dx); tw.y = Math.round(inp.y - this.drag.dy); this.clampWindow(); }
        else this.drag = null;
        return;
      }
      const fr = FRAME[vk];
      const r = vk === 'window' ? this.windowRect() : this.miniRect();
      const btns = this.chromeButtons(vk, r);
      for (const b of btns) if (rectContains(b, inp.x, inp.y)) this.hoverBtn = b.id;
      if (inp.y < r.y + fr.lid + (vk === 'window' ? this.slideOff() : 0)) {
        if (this.hoverBtn) g.desktop && (g.desktop.tooltip = btns.find((b) => b.id === this.hoverBtn).tip);
        if (inp.pressed) {
          inp.consume();
          if (this.hoverBtn === 'close') this.closeWindow();
          else if (this.hoverBtn === 'expand') g.command?.('tank');
          else if (this.hoverBtn === 'restore') g.setMini?.(false);
          else if (vk === 'window') this.drag = { kind: 'window', dx: inp.x - tw.x, dy: inp.y - tw.y };
        }
        cur.inWorld = false;
        return;
      }
      if (lx < 0 || lx >= v.iw || ly >= v.ih) { cur.inWorld = false; if (inp.pressed) inp.consume(); return; }
    }
    if (vk === 'full') {
      const lay = this.fullLayout();
      if (rectContains(lay.btn, inp.x, inp.y)) {
        this.hoverBtn = 'back';
        if (inp.pressed) { inp.consume(); g.setView?.('ocean'); }
        cur.inWorld = false;
        return;
      }
      if (this.st.tank.stored.length && rectContains(lay.unpack, inp.x, inp.y)) {
        this.hoverBtn = 'unpack';
        if (g.desktop) g.desktop.tooltip = `Place a stored decoration (${PROPS[this.st.tank.stored.at(-1)]?.name || 'decor'})`;
        if (inp.pressed) { inp.consume(); this.placeStored(); }
        cur.inWorld = false;
        return;
      }
    }

    // cursor in tank space (fish curiosity / fear use it)
    cur.x = lx; cur.y = ly; cur.vx = inp.vx; cur.vy = inp.vy; cur.speed = inp.speed;
    cur.inWorld = lx >= 0 && ly >= T.surf && lx < v.iw && ly < v.ih;

    // decor dragging (full view)
    if (this.drag?.kind === 'decor') {
      const d = this.drag.d;
      if (inp.down) {
        const pk = T.pickFloor(lx, ly + this.drag.dy);
        d.rec.x = clamp(pk.X / T.W, 0.04, 0.96);
        d.rec.z = clamp(pk.z, 0.05, 0.92);
        d.X = d.rec.x * T.W; d.z = d.rec.z;
        g.desktop && (g.desktop.tooltip = null);
      } else this.endDrag();
      return;
    }
    if (vk === 'full') {
      const hd = this.decorAt(lx, ly);
      if (hd) {
        this.hoverDecor = hd;
        if (g.desktop) g.desktop.tooltip = `${PROPS[hd.rec.id]?.name || 'Decoration'}\n{mouse_l} drag to move  {mouse_r} store`;
        if (inp.rpressed) { this.storeDecor(hd); inp.rpressed = false; return; }
        if (inp.pressed) {
          inp.consume();
          const base = T.floorAt(T.sx(hd.X, hd.z), hd.z);
          this.drag = { kind: 'decor', d: hd, dy: base - ly };
          this.sfx('icon_pickup', { vol: 0.5 });
          return;
        }
      }
    }

    // coins: hover magnet + click/drag sweeps
    const rad = this.stats.collectRadius || 14;
    const p0 = this.prevCursor || { x: lx, y: ly };
    const sweep = inp.down;
    for (let i = this.coins.list.length - 1; i >= 0; i--) {
      const c = this.coins.list[i];
      const p = this.toLocal(c.X, c.Y, c.D);
      const rr = (sweep ? rad * 1.35 : rad) + c.vr * T.s(p.z) * 0.5;
      const d = sweep ? segDist(p.x, p.y, p0.x, p0.y, lx, ly) : dist(p.x, p.y, lx, ly);
      if (d < rr) this.collectCoin(c, 'player');
    }
    this.prevCursor = { x: lx, y: ly };

    // fish hover tooltip and petting
    let best = null, bd = Infinity;
    for (const f of this.fish) {
      const s = T.s(f.z);
      const r = (11 * f.scale + 5) * s;
      const d = dist(f.x, f.y, lx, ly) + f.z * 10;
      if (dist(f.x, f.y, lx, ly) < r && d < bd) { bd = d; best = f; }
    }
    this.hoverFish = best;
    if (best && g.desktop && !this.hoverDecor) g.desktop.tooltip = this.fishTip(best);
    if (inp.pressed && cur.inWorld) {
      inp.consume();
      if (best) this.pet(best);
      else this.sprinkle(lx, ly);
    }
  }

  chromeButtons(vk, r) {
    if (vk === 'mini') return [{ id: 'restore', x: r.x + r.w - 12, y: r.y + 1, w: 8, h: 8, tip: 'Back to full size (M)', icon: 'expand' }];
    const y = r.y + 3 + this.slideOff();
    return [
      { id: 'close', x: r.x + r.w - 15, y, w: 11, h: 11, tip: 'Close', icon: 'cross' },
      { id: 'expand', x: r.x + r.w - 28, y, w: 11, h: 11, tip: 'Full-screen aquarium (A)', icon: 'expand' },
    ];
  }

  // Full view: a hanging plank with the tank stats and an "Ocean" button beside it.
  fullLayout() {
    const W = this.game.screen.W;
    const pw = Math.min(W - 140, 246);
    const px = Math.round(W / 2 - (pw + 64) / 2);
    return { plank: { x: px, y: 8, w: pw, h: 18 }, btn: { x: px + pw + 6, y: 9, w: 58, h: 16 }, unpack: { x: px - 84, y: 9, w: 78, h: 16 } };
  }

  fullButton() { return this.fullLayout().btn; }

  endDrag() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind !== 'decor') return;
    const T = this.T;
    this.layoutDecor();
    this.coins.wakeAll();
    const p = { x: T.sx(d.d.X, d.d.z), y: T.floorAt(T.sx(d.d.X, d.d.z), d.d.z) };
    this.particles.burst(p.x, p.y, 10, { colors: ['#f0b070', '#d88a48', '#fff0c8'], speed: 26, g: 40, life: 0.6, up: 8, flat: 0.4 });
    this.sfx('box_close', { vol: 0.5 });
    this.game.save?.();
  }

  decorAt(lx, ly) {
    const T = this.T;
    const list = this.decor.slice().sort((a, b) => a.z - b.z);
    for (const d of list) {
      const p = d.prop;
      if (!p) continue;
      const x = Math.round(T.sx(d.X, d.z) - p.ox), y = Math.round(T.sy(T.groundZ(d.X, d.z), d.z) - p.oy);
      const px = Math.floor(lx - x), py = Math.floor(ly - y);
      if (px < 0 || py < 0 || px >= p.canvas.width || py >= p.canvas.height) continue;
      if (alphaAt(p.canvas, px, py) > 40) return d;
    }
    return null;
  }

  fishTip(f) {
    const rec = f.rec, sp = f.sp;
    const h = clamp01(rec.happiness ?? 0.7);
    const n = Math.round(h * 5);
    const hearts = '{heart}'.repeat(n) + '{heart_empty}'.repeat(5 - n);
    let status = 'Content';
    if (f.state === 'sleep') status = '{zzz} Sleeping';
    else if ((rec.hunger ?? 0) > 0.62) status = '{food} Hungry!';
    else if (h > 0.82) status = 'Very happy!';
    else if (h < 0.4) status = 'Unhappy...';
    const rate = this.fishRate(f);
    return `${rec.name}${rec.bred ? ' (tank-born)' : ''}\n${sp.name}\n${hearts}\n${status}  {coin}${rate.toFixed(1)}/min`;
  }

  pet(f) {
    f.say('heart', 1.2);
    f.feel(rng.chance(0.5) ? 'love' : 'happy', 1.2);
    f.squashV += 7;
    f.rec.happiness = Math.min(1, (f.rec.happiness ?? 0.7) + 0.01);
    this.sfx(f.sp.sound || 'blub', { vol: 0.35, pitch: 1.2 / Math.max(0.6, f.baseScale) });
  }

  sprinkle(lx, ly, n = rng.int(5, 7)) {
    const T = this.T;
    if (this.food.length > 60) return;
    const cols = ['#e86a3a', '#f0a040', '#c8503a', '#8ac04a', '#e8c070'];
    for (let i = 0; i < n; i++) {
      const z = clamp(rng.float(0.05, 0.45), 0, 0.9);
      const X = clamp(T.X(lx + rng.float(-5, 5), z), 3, T.W - 3);
      const Y = clamp(T.Y(ly + rng.float(-3, 3), z), T.surf + 1, T.groundZ(X, z) - 2);
      this.food.push({ X, Y, z, vy: rng.float(4, 9), t: 0, c: rng.pick(cols), x: 0, y: 0, eaten: false, wob: rng.float(0, TAU), landed: false });
    }
    this.particles.ring(lx, Math.max(ly, T.surf + 2), 0.3 * this.view.fishScale + 0.1, 'rgba(255,240,200,0.8)');
    this.sfx('bubble', { vol: 0.35, pitch: 1.4 });
  }

  // ------------------------------------------------------------------ simulation
  updateFood(dt) {
    const T = this.T;
    const f = this.food;
    let w = 0;
    for (let i = 0; i < f.length; i++) {
      const p = f[i];
      p.t += dt;
      if (p.eaten || p.t > 40) continue;
      if (!p.landed) {
        p.wob += dt * 3;
        p.Y += p.vy * dt;
        p.X += Math.sin(p.wob) * 4 * dt;
        const gy = T.groundZ(p.X, p.z) - 1;
        if (p.Y >= gy) { p.Y = gy; p.landed = true; }
      }
      p.x = T.sx(p.X, p.z); p.y = T.sy(p.Y, p.z);
      f[w++] = p;
    }
    f.length = w;
  }

  updateFish(dt) {
    const T = this.T;
    const vs = this.view.fishScale;
    for (const f of this.fish) {
      if (f.baby > 0) { f.baby -= dt; f.scale = f.baseScale * vs * (0.7 + 0.3 * clamp01(1 - f.baby / 40)); }
      // tank behaviours steer depth too
      if (f.state === 'eat') {
        let best = null, bd = Infinity;
        for (const p of this.food) { if (p.eaten) continue; const d = dist(p.x, p.y, f.x, f.y); if (d < bd) { bd = d; best = p; } }
        if (best) f.target = { x: best.x, y: best.y, z: best.z };
      } else if (f.state === 'decor' && f.decorSpot) f.target = { x: f.decorSpot.x, y: f.decorSpot.y, z: f.decorSpot.z };
      else if (f.state === 'play' && f.playmate) f.target = { x: f.playmate.x, y: f.playmate.y, z: f.playmate.z };
      else if (f.state === 'court' && f.mate) f.target = { x: f.mate.x, y: f.mate.y, z: (f.z + f.mate.z) / 2 };
      else if (f.state === 'sleep' && f.bed) f.target = { x: f.bed.x, y: f.bed.y, z: f.bed.z ?? f.z };
      if (f.target && f.target.z !== undefined) f.target.z = clamp(f.target.z, 0, 0.85);
      f.update(dt);
      // keep inside the glass box at its depth
      const z = (f.z = clamp(f.z, 0, 0.85));
      const s = T.s(z);
      const m = (8 * f.scale + 3) * s;
      const L = T.left(z) + m, R = T.right(z) - m;
      if (f.x < L) { f.x = L; if (f.vx < 0) f.vx *= -0.3; }
      if (f.x > R) { f.x = R; if (f.vx > 0) f.vx *= -0.3; }
      const top = T.top(z) + (4 * f.scale + 2) * s;
      if (f.y < top) { f.y = top; if (f.vy < 0) f.vy = 0; }
      const fl = T.floorAt(f.x, z) - (3 * f.scale + 1) * s;
      if (f.y > fl) { f.y = fl; if (f.vy > 0) f.vy = 0; }
      if (f.target && f.state === 'wander') {
        if (f.target !== f.lastTarget) { f.lastTarget = f.target; f.target.z = Math.pow(rng.next(), 1.35) * 0.82; }
        const tz = clamp(f.target.z ?? z, 0, 0.85);
        f.target.x = clamp(f.target.x, T.left(tz) + m, T.right(tz) - m);
        f.target.y = clamp(f.target.y, T.top(tz) + m, T.floorAt(f.target.x, tz) - m);
      }
      if (f.state === 'sleep' && f.bed && f.bed.z === undefined) f.bed.z = z;
    }
  }

  updateEconomy(dt) {
    const s = this.stats;
    const n = this.fish.length;
    for (const f of this.fish) {
      const rec = f.rec;
      rec.hunger = Math.min(1, (rec.hunger ?? 0.3) + dt * HUNGER_RATE);
      const rate = this.fishRate(f);
      const d = rate < 6 ? 0 : rate < 30 ? 1 : 2;
      const val = DENOMS[d];
      rec.coinT = Math.min(val * 3, (rec.coinT || 0) + (rate / 60) * dt);
      if (rec.coinT >= val) { rec.coinT -= val; this.dropCoin(f, d); }
      if (rec.hunger > 0.62 && rng.chance(dt * 0.04) && !f.emote && f.state !== 'sleep') f.say('food', 1.6);
      else if ((rec.happiness ?? 0) > 0.85 && rng.chance(dt * 0.015) && !f.emote && f.state !== 'sleep') f.say('heart', 1.2);
    }
    // happiness drifts toward a target from hunger, crowding, decor and companions
    this.moodT -= dt;
    if (this.moodT <= 0) {
      const step = 0.5 - this.moodT;
      this.moodT = 0.5;
      const cap = s.tankCap || 4;
      const crowd = 1 - clamp01((n / cap - 0.65) / 0.7) * 0.6;
      const decor = clamp01(this.decor.length / (1.5 + n * 0.35));
      const k = 1 - Math.exp(-step / 40);
      for (const f of this.fish) {
        const rec = f.rec;
        const fed = 1 - smoothstep(0.35, 1, rec.hunger ?? 0.3);
        const same = this.fish.filter((o) => o.sp === f.sp).length - 1;
        const comp = same >= 1 ? 1 : f.sp.move?.school > 0 ? 0.3 : 0.6;
        const target = 0.38 * fed + 0.2 * crowd + 0.24 * decor + 0.18 * comp;
        rec.happiness = clamp01((rec.happiness ?? 0.7) + (target - (rec.happiness ?? 0.7)) * k);
      }
    }
    // auto-feeder
    if (s.feeder && n) {
      this.feederT -= dt;
      if (this.feederT <= 0) {
        this.feederT = 40;
        const avg = this.fish.reduce((a, f) => a + (f.rec.hunger ?? 0), 0) / n;
        if (avg > 0.4 && this.food.length < 6) {
          const T = this.T;
          this.sprinkle(T.W * 0.82, T.surf + 3, 8);
          this.feederFlash = 0.6;
          this.sfx('click', { vol: 0.4 });
        }
      }
    }
    this.feederFlash = Math.max(0, (this.feederFlash || 0) - dt);
  }

  updateEggs(dt) {
    const eggs = this.st.tank.eggs;
    for (let i = eggs.length - 1; i >= 0; i--) {
      const e = eggs[i];
      e.t += dt;
      if (e.t >= e.dur) { eggs.splice(i, 1); this.hatch(e); }
    }
  }

  updateHelpers(dt) {
    const ac = this.stats.autoCollect || 0;
    if (ac >= 1 && !this.snail) this.snail = new Snail(this);
    if (ac >= 2 && !this.crab) this.crab = new CoinCrab(this);
    if (ac < 1) this.snail = null;
    if (ac < 2) this.crab = null;
    this.snail?.update(this, dt);
    this.crab?.update(this, dt);
  }

  updateBubbles(dt) {
    const T = this.T, v = this.view;
    if (this.visibleKey) {
      this.bubT = (this.bubT || 0) - dt;
      while (this.bubT < 0) {
        this.bubT += 1 / v.cfg.bubbles;
        const st = v.stone;
        this.bubbles.push({ X: st.X + rng.float(-2, 2), Y: T.groundZ(st.X, st.z) - 3, z: st.z + rng.float(-0.02, 0.02), vy: -rng.float(20, 34) * (0.5 + v.fishScale * 0.5), r: rng.pick([1, 1, 1, 2, 2, 3]), wob: rng.float(0, TAU) });
      }
    }
    const b = this.bubbles;
    let w = 0;
    for (let i = 0; i < b.length; i++) {
      const p = b[i];
      p.wob += dt * 5;
      p.vy = Math.max(p.vy - 10 * dt, -60);
      p.Y += p.vy * dt;
      p.X += Math.sin(p.wob) * 6 * dt;
      if (p.Y < T.surf + 1) continue;
      b[w++] = p;
    }
    b.length = w;
  }

  // ------------------------------------------------------------------ drawing
  drawFull(ctx, dt) {
    if (this.view?.key !== 'full') return;
    this.drawTank(ctx, 0, 0);
    // top plaque: tank stats + back to the ocean
    const sm = this.tankSummary();
    const label = `My Aquarium  {fish}${sm.fish}/${sm.cap}  {heart}${sm.fish ? Math.round(sm.happiness * 100) + '%' : '--'}  {coin}${sm.coinsPerMin.toFixed(1)}/min`;
    const { plank: p, btn: b, unpack: u } = this.fullLayout();
    const nStored = this.st.tank.stored.length;
    if (nStored) drawButton(ctx, u.x, u.y, u.w, u.h, { label: `Unpack ${nStored}`, icon: getUiIcon('tank'), state: this.hoverBtn === 'unpack' ? 'hover' : 'normal', style: 'glass' });
    drawPlank(ctx, p.x, p.y, p.w, p.h, { rope: 8 });
    drawText(ctx, label, p.x + p.w / 2, p.y + 6, { align: 'center', color: '#fff3dc', shadow: '#2a160a' });
    drawButton(ctx, b.x, b.y, b.w, b.h, { label: 'Ocean', icon: getUiIcon('arrow_l'), state: this.hoverBtn === 'back' ? 'hover' : 'normal', style: 'glass' });
  }

  drawWindow(ctx, dt) {
    if (this.visibleKey !== 'window' || this.view?.key !== 'window') return;
    const r = this.windowRect();
    const v = this.view;
    const off = this.slideOff();
    const a = clamp01(this.winAnim * 1.6);
    if (a < 1) ctx.globalAlpha = a;
    // soft drop shadow on the desktop
    ctx.fillStyle = 'rgba(4,14,24,0.28)';
    ctx.fillRect(r.x + 4, r.y + off + r.h, r.w - 2, 4);
    ctx.fillRect(r.x + r.w, r.y + off + 5, 4, r.h - 1);
    this.drawTank(ctx, r.x + v.frame.ix, r.y + v.frame.iy + off);
    ctx.drawImage(v.frame.canvas, r.x, r.y + off);
    this.drawChrome(ctx, 'window', r, off);
    ctx.globalAlpha = 1;
  }

  drawMini(ctx, dt) {
    if (this.view?.key !== 'mini') return;
    const r = this.miniRect();
    const v = this.view;
    ctx.fillStyle = 'rgba(4,14,24,0.28)';
    ctx.fillRect(r.x + 3, r.y + r.h, r.w - 2, 3);
    this.drawTank(ctx, r.x + v.frame.ix, r.y + v.frame.iy);
    ctx.drawImage(v.frame.canvas, r.x, r.y);
    this.drawChrome(ctx, 'mini', r, 0);
  }

  drawChrome(ctx, vk, r, off) {
    const v = this.view;
    const sm = this.tankSummary();
    for (const b of this.chromeButtons(vk, r)) {
      const hov = this.hoverBtn === b.id;
      const spr = brassButton(b.w, hov);
      ctx.drawImage(spr, b.x, b.y);
      const ic = getUiIcon(b.icon);
      if (ic && b.w >= 10) ctx.drawImage(ic, Math.round(b.x + (b.w - ic.width) / 2), Math.round(b.y + (b.h - ic.height) / 2) + (hov ? 0 : 0));
    }
    if (vk === 'window') {
      // brass name plate on the lid, stats plate on the cabinet
      const label = 'AQUARIUM';
      const lw = 52;
      const lx = Math.round(r.x + r.w / 2 - lw / 2), ly = r.y + off + 3;
      plate(ctx, lx, ly, lw, 9);
      drawText(ctx, label, lx + lw / 2, ly + 2, { font: 'small', align: 'center', color: '#5a3410' });
      const by = r.y + off + v.frame.iy + v.ih + 4;
      const txt = `{fish}${sm.fish}/${sm.cap}  {heart}${sm.fish ? Math.round(sm.happiness * 100) + '%' : '--'}`;
      drawText(ctx, txt, r.x + 8, by, { color: '#ffe8b8', shadow: '#1a0c06' });
      const rt = `{coin}${sm.coinsPerMin.toFixed(1)}/min`;
      drawText(ctx, rt, r.x + r.w - 8, by, { align: 'right', color: '#ffe8b8', shadow: '#1a0c06' });
      // feeder hopper on the lid when the auto-feeder is owned
      if (this.stats.feeder) {
        const fx = Math.round(r.x + v.frame.ix + v.iw * 0.78), fy = r.y + off - 5;
        ctx.fillStyle = '#5a3a1c'; ctx.fillRect(fx - 1, fy - 1, 14, 9);
        ctx.fillStyle = '#c89a3a'; ctx.fillRect(fx, fy, 12, 7);
        ctx.fillStyle = '#f0d070'; ctx.fillRect(fx, fy, 12, 1);
        ctx.fillStyle = this.feederFlash > 0 ? '#ffe27a' : '#e86a3a'; ctx.fillRect(fx + 3, fy + 2, 6, 3);
      }
    }
  }

  // The whole tank interior at screen offset (ox, oy).
  drawTank(ctx, ox, oy) {
    const v = this.view, T = this.T;
    const art = this.artFor(v);
    const t = this.t;
    const g = this.game;
    const clock = g.clock;
    const night = clock ? clamp01(1 - clock.daylight()) : 0;
    const dusk = clock ? clock.dusk() : 0;
    ox = Math.round(ox); oy = Math.round(oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, v.iw, v.ih);
    ctx.clip();
    ctx.translate(ox, oy);
    ctx.drawImage(art.backdrop, 0, 0);
    if (art.caustics) this.drawCaustics(ctx, v, art, night);
    this.drawShadows(ctx, v);
    this.drawShafts(ctx, v, night, 0.3, 2);

    // ---- objects, back to front, with depth fog between slabs (only over the dirty box)
    const lg = art.lg;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.globalAlpha = 1;
    const db = art.dirty;
    if (db) lg.clearRect(db.x0, db.y0, db.x1 - db.x0, db.y1 - db.y0);
    const box = (this.box = { x0: v.iw, y0: v.ih, x1: 0, y1: 0 });
    const items = this.collectItems();
    const slabs = v.cfg.slabs === 2 ? [0.66, 0.33] : FOG_SLABS;
    let si = 0;
    const fogA = v.cfg.slabs === 2 ? 0.16 : 0.115;
    for (const it of items) {
      while (si < slabs.length && it.z <= slabs[si]) { this.fogFill(lg, art, v, fogA); si++; }
      this.drawItem(lg, it);
    }
    while (si < slabs.length) { this.fogFill(lg, art, v, fogA); si++; }
    box.x0 = Math.max(0, Math.floor(box.x0)); box.y0 = Math.max(0, Math.floor(box.y0));
    box.x1 = Math.min(v.iw, Math.ceil(box.x1)); box.y1 = Math.min(v.ih, Math.ceil(box.y1));
    if (box.x1 > box.x0 && box.y1 > box.y0) {
      ctx.drawImage(art.layer, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      art.dirty = { ...box };
    } else art.dirty = null;

    this.drawShafts(ctx, v, night, 0, 0.3);
    this.particles.draw(ctx, 'fg', t);
    this.drawEmotes(ctx);
    this.drawGlints(ctx);
    // a bobbing arrow points at the tutorial coin
    for (const c of this.coins.list) {
      if (!c.hint) continue;
      const p = this.toLocal(c.X, c.Y, c.D);
      const a = getUiIcon('arrow_d');
      ctx.drawImage(a, Math.round(p.x - a.width / 2), Math.round(p.y - c.vr - 6 - a.height + Math.sin(t * 7) * 2));
      if (rng.chance(0.08)) this.particles.sparkle(p.x + rng.float(-3, 3), p.y + rng.float(-3, 3), '#fff2b0');
    }

    // ---- lighting: night (moonlight blue), dusk (warm), lamp + glowing decor
    if (night > 0.02 || dusk > 0.05) {
      ctx.globalCompositeOperation = 'multiply';
      const c = mix(mix('#ffffff', '#ffd2a8', dusk * 0.35), '#3a4c90', night * 0.62);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, v.iw, v.ih);
      ctx.globalCompositeOperation = 'lighter';
      if (night > 0.2) {
        ctx.globalAlpha = night * 0.85;
        for (const d of this.decor) {
          if (!d.prop?.glow) continue;
          const x = Math.round(T.sx(d.X, d.z) - d.prop.ox), y = Math.round(T.sy(T.groundZ(d.X, d.z), d.z) - d.prop.oy);
          ctx.drawImage(d.prop.glow, x, y);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // auto-feeder clamped to the top rim (the window draws its hopper on the lid)
    if (this.stats.feeder && v.key !== 'window') {
      const fx = Math.round(v.iw * 0.82) - 7, k = v.key === 'mini' ? 0.6 : 1;
      ctx.fillStyle = '#3a2410'; ctx.fillRect(fx - 1, 0, Math.round(16 * k), Math.round(10 * k) + 1);
      ctx.fillStyle = '#c89a3a'; ctx.fillRect(fx, 0, Math.round(14 * k), Math.round(9 * k));
      ctx.fillStyle = '#f6d672'; ctx.fillRect(fx, 0, Math.round(14 * k), 1);
      ctx.fillStyle = this.feederFlash > 0 ? '#ffe27a' : '#e86a3a'; ctx.fillRect(fx + Math.round(4 * k), Math.round(3 * k), Math.round(6 * k), Math.round(3 * k));
      ctx.fillStyle = '#7a5418'; ctx.fillRect(fx + Math.round(5 * k), Math.round(9 * k), Math.round(4 * k), T.surf - Math.round(9 * k) + 1);
    }
    // lamp strip just under the lid / top glass
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(night > 0.5 ? '#6a8aff' : '#fff0c0', 0.22);
    ctx.fillRect(0, 0, v.iw, Math.max(2, T.surf - 1));
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(art.glass, 0, 0);
    // glitter running along the waterline
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < Math.ceil(v.iw / 60); i++) {
      const x = ((i * 97.3 + t * (i % 2 ? 14 : -11)) % v.iw + v.iw) % v.iw;
      if (Math.sin(t * 2 + i) > 0.2) ctx.fillRect(Math.round(x), T.surf, 2 + (i % 3), 1);
    }
    // the collecting magnet ring around the cursor
    if (this.world.cursor.inWorld && this.coins.list.length && !this.drag && v.key !== 'mini') {
      const c = this.world.cursor;
      const rad = this.stats.collectRadius || 14;
      ctx.fillStyle = 'rgba(255,240,180,0.28)';
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * TAU + t * 0.8;
        ctx.fillRect(Math.round(c.x + Math.cos(a) * rad), Math.round(c.y + Math.sin(a) * rad), 1, 1);
      }
    }
    ctx.restore();
  }

  // Soft contact shadows on the sand under fish (fainter the higher they swim).
  drawShadows(ctx, v) {
    const T = this.T;
    for (const f of this.fish) {
      const s = T.s(f.z);
      const fl = T.floorAt(f.x, f.z);
      const hgt = fl - f.y;
      const k = clamp01(1 - hgt / (T.floorFront * 0.55));
      if (k <= 0.05) continue;
      const rx = Math.max(2, Math.round((14 + 8 * k) * f.scale * s)), ry = Math.max(1, Math.round(rx * 0.28));
      ctx.globalAlpha = 0.22 * k * (1 - f.z * 0.4);
      ctx.drawImage(shadowSprite(rx, ry), Math.round(f.x - rx), Math.round(fl - ry));
    }
    ctx.globalAlpha = 1;
  }

  fogFill(lg, art, v, a) {
    const b = this.box;
    if (b.x1 <= b.x0 || b.y1 <= b.y0) return;
    const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0));
    const w = Math.min(v.iw, Math.ceil(b.x1)) - x0, h = Math.min(v.ih, Math.ceil(b.y1)) - y0;
    if (w <= 0 || h <= 0) return;
    lg.globalCompositeOperation = 'source-atop';
    lg.globalAlpha = a;
    lg.drawImage(art.fog, 0, y0, 1, h, x0, y0, w, h);
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'source-over';
  }

  collectItems() {
    const items = (this.itemBuf ||= []);
    let n = 0;
    const T = this.T;
    const push = (z, kind, o, y = 0) => {
      let it = items[n];
      if (!it) items[n] = it = { z: 0, kind: '', o: null, y: 0 };
      it.z = z; it.kind = kind; it.o = o; it.y = y;
      n++;
    };
    for (const d of this.decor) push(d.z, 'decor', d);
    for (const p of this.view.plants) push(p.z, 'plant', p);
    for (const f of this.fish) {
      let z = f.z;
      if (f.hideInDecor && f.state === 'decor' && f.decorSpot) z = f.decorSpot.z + 0.015;
      push(z, 'fish', f, f.y);
    }
    for (const c of this.coins.list) push(c.D / T.DEPTH, 'coin', c, c.Y);
    for (const p of this.food) push(p.z, 'food', p);
    for (const e of this.st.tank.eggs) push(e.z, 'egg', e);
    if (this.snail) push(this.snail.depth(), 'snail', this.snail);
    if (this.crab) push(this.crab.depth(), 'crab', this.crab);
    push(this.view.stone.z, 'stone', this.view.stone);
    for (const b of this.bubbles) push(b.z - 0.001, 'bubble', b);
    items.length = n;
    items.sort((a, b) => b.z - a.z || a.y - b.y);
    return items;
  }

  grow(x0, y0, x1, y1) {
    const b = this.box;
    if (x0 < b.x0) b.x0 = x0; if (y0 < b.y0) b.y0 = y0;
    if (x1 > b.x1) b.x1 = x1; if (y1 > b.y1) b.y1 = y1;
  }

  drawItem(g, it) {
    const T = this.T;
    const o = it.o;
    switch (it.kind) {
      case 'decor': {
        let p = o.prop, sc = 1;
        if (!p || this.drag?.d === o) {
          // missing exact size (or dragged to a new depth): scale the nearest render
          const want = this.decorScale(o, o.z);
          p = o.props.get(want) || p || [...o.props.values()][0];
          if (!p) return;
          sc = want / p.scale;
          if (Math.abs(sc - 1) > 0.01 && this.drag?.d !== o) this.queueProp(o, want);
        }
        const bx = T.sx(o.X, o.z), by = T.sy(T.groundZ(o.X, o.z), o.z) - (this.drag?.d === o ? 4 : 0);
        this.grow(bx - p.ox * sc, by - p.oy * sc, bx + (p.canvas.width - p.ox) * sc, by + (p.canvas.height - p.oy) * sc);
        if (sc === 1) g.drawImage(p.canvas, Math.round(bx - p.ox), Math.round(by - p.oy));
        else g.drawImage(p.canvas, Math.round(bx - p.ox * sc), Math.round(by - p.oy * sc), Math.round(p.canvas.width * sc), Math.round(p.canvas.height * sc));
        if (this.hoverDecor === o && !this.drag) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.18 + 0.08 * Math.sin(this.t * 6);
          g.drawImage(tinted(p.canvas, '#fff4c8'), Math.round(bx - p.ox), Math.round(by - p.oy));
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case 'plant': {
        if (!o.frames) o.frames = plantFrames(o.kind, o.h * T.s(o.z), o.seed);
        const fr = o.frames;
        const i = Math.floor((this.t / 5 + o.ph) * SWAY_FRAMES) % SWAY_FRAMES;
        const cv = fr.frames[i], px = Math.round(T.sx(o.X, o.z) - fr.ox), py = Math.round(T.sy(T.groundZ(o.X, o.z), o.z) - fr.oy + 1);
        g.drawImage(cv, px, py);
        this.grow(px, py, px + cv.width, py + cv.height);
        break;
      }
      case 'fish': {
        o.draw(g, null, this.t);
        const r = 48 * o.scale * T.s(o.z) + 8;
        this.grow(o.x - r, o.y - r, o.x + r, o.y + r);
        break;
      }
      case 'coin': {
        const z = o.D / T.DEPTH, s = T.s(z);
        const sh = coinSheet(o.d, o.vr * s);
        const [i, j] = frameOf(o);
        const x = Math.round(T.sx(o.X, z)) - sh.half, y = Math.round(T.sy(o.Y, z)) - sh.half;
        g.drawImage(sh.canvas, i * sh.cell, j * sh.cell, sh.cell, sh.cell, x, y, sh.cell, sh.cell);
        this.grow(x, y, x + sh.cell, y + sh.cell);
        if (o.sleep && o.glint < 0) {
          o.glint = rng.float(3, 12);
          if (this.glints.length < 12 && z < 0.6) this.glints.push({ x: x + sh.half + rng.int(-1, 1), y: y + sh.half - 1, t: 0 });
        }
        break;
      }
      case 'food': {
        const s = T.s(o.z);
        g.fillStyle = o.c;
        g.fillRect(Math.round(o.x), Math.round(o.y), s > 0.8 ? 2 : 1, 1);
        this.grow(o.x - 1, o.y - 1, o.x + 3, o.y + 3);
        if (s > 0.7) { g.fillStyle = 'rgba(40,16,8,0.6)'; g.fillRect(Math.round(o.x), Math.round(o.y) + 1, 2, 1); }
        break;
      }
      case 'egg': {
        const X = o.x * T.W;
        drawEggs(g, this, { X, z: o.z, t: o.t, dur: o.dur, n: o.n, color: o.color });
        { const ex = T.sx(X, o.z), ey = T.floorAt(ex, o.z); this.grow(ex - 12, ey - 12, ex + 12, ey + 4); }
        break;
      }
      case 'snail': case 'crab': {
        o.draw(g, this);
        const z = o.depth(), ex = T.sx(o.X, z), ey = T.floorAt(ex, z);
        this.grow(ex - 30, ey - (o.mode === 'glass' ? o.climb + 30 : 30), ex + 30, ey + 6);
        break;
      }
      case 'stone': {
        // bubbler: airline tube down the back corner into a little air stone
        const s = T.s(o.z), x = Math.round(T.sx(o.X, o.z)), y = Math.round(T.sy(T.groundZ(o.X, o.z), o.z));
        g.fillStyle = 'rgba(200,240,236,0.35)';
        g.fillRect(x - 1, Math.round(T.top(o.z)) - 2, 1, y - Math.round(T.top(o.z)));
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillRect(x, Math.round(T.top(o.z)) - 2, 1, y - Math.round(T.top(o.z)));
        const w = Math.max(3, Math.round(7 * s * this.view.fishScale)), h = Math.max(2, Math.round(w * 0.55));
        g.fillStyle = '#3a3a48'; g.fillRect(x - w / 2 - 1, y - h - 1, w + 2, h + 1);
        g.fillStyle = '#8a8ea0'; g.fillRect(x - w / 2, y - h, w, h);
        g.fillStyle = '#c4c8d4'; g.fillRect(x - w / 2, y - h, w, 1);
        this.grow(x - w, T.top(o.z) - 3, x + w, y + 2);
        break;
      }
      case 'bubble': {
        const s = T.s(o.z);
        const r = Math.max(1, Math.round(o.r * s * (0.5 + this.view.fishScale * 0.5)));
        const bx = Math.round(T.sx(o.X, o.z)) - r, by = Math.round(T.sy(o.Y, o.z)) - r;
        g.drawImage(bubbleSprite(r), bx, by);
        this.grow(bx, by, bx + 2 * r + 1, by + 2 * r + 1);
        break;
      }
      default: break;
    }
  }

  // Animated caustic network clipped to the floor's lit top and the underside of the surface.
  drawCaustics(ctx, v, art, night) {
    const frames = causticFrames();
    const T = v.T;
    const sc = v.iw / 960;
    ctx.save();
    ctx.beginPath();
    for (const poly of [art.floorPoly, art.ceilPoly]) {
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
    }
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const a = 0.3 * (1 - night * 0.7);
    const fy0 = art.floorTopY, fy1 = T.floorFront;
    // bands: far floor (small, faint), near floor (large), ceiling
    const bands = [[fy0, lerp(fy0, fy1, 0.4), 1, 0.45, a * 0.6], [lerp(fy0, fy1, 0.4), fy1 + 2, 1.5, 0.7, a], [T.surf, T.top(1) + 1, 2, 0.7, a * 0.3]];
    const fi = (Math.floor(this.t * 8) % frames.length + frames.length) % frames.length;
    for (const [y0, y1, sx, sy, al] of bands) {
      const tw = Math.max(16, Math.round(64 * sx * Math.max(0.5, sc))), th = Math.max(6, Math.round(32 * sy * Math.max(0.5, sc)));
      const strip = causticStrip(frames, fi, tw, th);
      const offx = Math.round((this.t * 3 * sx) % tw);
      ctx.globalAlpha = al;
      for (let y = Math.floor(y0); y < y1; y += th) for (let x = -offx; x < v.iw; x += strip.width) ctx.drawImage(strip, x, y);
    }
    ctx.restore();
  }

  drawShafts(ctx, v, night, z0, z1) {
    const T = v.T;
    const spr = tinted(shaftSprite(), night > 0.5 ? '#8ab0ff' : '#fff0c4');
    ctx.globalCompositeOperation = 'lighter';
    for (const s of v.shafts) {
      if (s.z < z0 || s.z >= z1) continue;
      const sc = T.s(s.z);
      const X = s.X + Math.sin(this.t * 0.13 + s.ph) * v.iw * 0.02;
      const w = Math.max(3, Math.round(s.w * sc));
      const x = Math.round(T.sx(X, s.z) - w / 2), y0 = Math.round(T.top(s.z));
      const y1 = Math.round(T.floorAt(x + w / 2, s.z));
      ctx.globalAlpha = clamp01(s.a * (0.65 + 0.35 * Math.sin(this.t * 0.6 + s.ph)) * (1 - night * 0.6) * (z0 === 0 ? 0.6 : 1));
      ctx.drawImage(spr, x, y0, w, Math.max(4, y1 - y0));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawEmotes(ctx) {
    const T = this.T;
    for (const f of this.fish) {
      if (!f.emote) continue;
      const top = f.anchors?.top || [f.x, f.y - 10 * f.scale];
      const k = f.emote.t / f.emote.max;
      const name = EMOTE_ICON[f.emote.icon] || f.emote.icon;
      const y = Math.round(top[1] - 4 - Math.min(1, f.emote.t * 6) * 3 * T.s(f.z));
      ctx.globalAlpha = Math.min(1, (1 - k) * 4) * (1 - f.z * 0.4);
      if (ICONS.has(name)) {
        const ic = getUiIcon(name);
        ctx.drawImage(ic, Math.round(top[0] - ic.width / 2), y - ic.height);
      } else drawText(ctx, f.emote.icon, top[0], y - 8, { align: 'center', color: '#ffffff', outline: '#14202c' });
      ctx.globalAlpha = 1;
    }
    if (this.hoverFish && this.view.key !== 'mini') {
      const f = this.hoverFish;
      const s = T.s(f.z), r = Math.round((12 * f.scale + 4) * s);
      ctx.fillStyle = 'rgba(255,248,210,0.55)';
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + this.t * 2;
        ctx.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r * 0.7), 2, 1);
      }
    }
  }

  drawGlints(ctx) {
    const spr = glintSprite();
    ctx.globalCompositeOperation = 'lighter';
    let w = 0;
    for (const gl of this.glints) {
      gl.t += 1 / 60;
      if (gl.t > 0.5) continue;
      ctx.globalAlpha = Math.sin((gl.t / 0.5) * Math.PI);
      ctx.drawImage(spr, gl.x - 3, gl.y - 3);
      this.glints[w++] = gl;
    }
    this.glints.length = w;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ------------------------------------------------------------------ helpers

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

const alphaCache = new WeakMap();
function alphaAt(cv, x, y) {
  let a = alphaCache.get(cv);
  if (!a) {
    const d = ctxOf(cv).getImageData(0, 0, cv.width, cv.height).data;
    a = new Uint8Array(cv.width * cv.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    alphaCache.set(cv, a);
  }
  return a[y * cv.width + x];
}

// Caustic frames pre-scaled into wide strips (4 tiles) so a band needs only a few draws per row.
const stripCache = new Map();
function causticStrip(frames, fi, tw, th) {
  const key = tw + 'x' + th;
  let arr = stripCache.get(key);
  if (!arr) stripCache.set(key, (arr = []));
  let c = arr[fi];
  if (!c) {
    c = makeCanvas(tw * 4, th);
    const g = ctxOf(c);
    for (let i = 0; i < 4; i++) g.drawImage(frames[fi], i * tw, 0, tw, th);
    arr[fi] = c;
  }
  return c;
}

const shadowCache = new Map();
function shadowSprite(rx, ry) {
  const key = rx * 100 + ry;
  let c = shadowCache.get(key);
  if (c) return c;
  c = makeCanvas(rx * 2 + 1, ry * 2 + 1);
  const g = ctxOf(c);
  for (let y = 0; y <= ry * 2; y++) for (let x = 0; x <= rx * 2; x++) {
    const d = ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2;
    if (d > 1) continue;
    g.fillStyle = d < 0.45 ? 'rgba(40,20,30,1)' : (x + y) % 2 ? 'rgba(40,20,30,0.6)' : 'rgba(0,0,0,0)';
    g.fillRect(x, y, 1, 1);
  }
  shadowCache.set(key, c);
  return c;
}

const bubbleCache = new Map();
function bubbleSprite(r) {
  let c = bubbleCache.get(r);
  if (c) return c;
  const s = r * 2 + 1;
  c = makeCanvas(s, s);
  const g = ctxOf(c);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - r, y - r);
    if (d > r + 0.3) continue;
    g.fillStyle = d > r - 0.8 ? 'rgba(220,250,255,0.8)' : 'rgba(170,235,255,0.16)';
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillRect(Math.max(0, r - Math.ceil(r / 2)), Math.max(0, r - Math.ceil(r / 2)), 1, 1);
  bubbleCache.set(r, c);
  return c;
}

function plate(ctx, x, y, w, h) {
  ctx.fillStyle = '#5a3410'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#d8a83a'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f6d672'; ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = '#a27420'; ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillStyle = '#fffbe2'; ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + w - 2, y + 1, 1, 1);
}
