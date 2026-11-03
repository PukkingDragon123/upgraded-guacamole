// The aquarium (phase 3, Frutiger Aero): a glass tank of the current tier (goldfish jar -> bowl -> glass
// tanks -> reef -> wall aquarium, see tanks.js) standing in a bright Aero room (room.js: big window onto
// rolling green hills, glass desk, lamp, plants, sun shafts). Inside: the player's fish, voxel decor,
// swaying plants, a gravel / sand floor and glossy Aero drops (drops.js) that fish puff out; they float up
// and pop into Aero when hovered, clicked, swept or auto-collected. Shown as the full-screen scene
// (state.view === 'aquarium'), as a floating Aero glass window on the desktop and as a tiny mini window.
// One simulation; switching views or tiers re-maps it into the new tank. Upgrading the tier plays a pour
// (upgrade.js): the old tank lifts, tilts and pours water and fish into the new one.
//
// API used by the game: addFish(rec), update(dt, inpOrNull), hit(x, y), drawFull, drawWindow, drawMini,
// windowRect(), toggleWindow(), openWindow(force), closeWindow(), forceCoin(), offlineCoins(sec) (returns
// the Aero earned while away; the "While you were away" popup (away.js) credits it), onResize().
// Extra: addDecor(id), storedDecor(), placeStored(id), tankSummary(), interact(decorOrId), openFull(),
// capacity(), tier, syncFish(), evolveFish(dt). Events via game.emit: 'tankFish', 'coinCollected'
// ({value, by}), 'decorPlayed', 'fishEvolved', 'hatched', 'tankUpgraded' ({from, to}).

import { clamp, clamp01, lerp, dist, ease, rectContains, smoothstep, TAU } from '../core/math.js';
import { rng, RNG } from '../core/rng.js';
import { mix, rgba } from '../core/color.js';
import { makeCanvas, ctxOf, tinted } from '../core/canvas.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon, UI_ICON_NAMES } from '../gfx/uiicons.js';
import { getProp, PROPS } from '../gfx/props.js';
import { Fish } from '../fish/fish.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { rollIndividual } from '../fish/traits.js';
import { TASKBAR_H } from '../desktop/desktop.js';
import { AERO, fmtAero, drawAeroCoin, drawAeroBubble, drawAeroSurface, drawAeroButton, drawSparkle, drawAeroGlow } from '../ui/aero.js';
import { AeroDrops, DENOMS } from './drops.js';
import { TankSpace, renderBackdrop, renderGlass, shaftSprite, causticFrames, FOG_SLABS } from './tank3d.js';
import { TANK_TIERS, tankTier, aeroRate, sceneSize, sceneLayout, tankOpts, FRAME } from './tanks.js';
import { roomArt, drawRoomBack, drawRoomFront, RoomAmbient, roomHit } from './room.js';
import { shellArt } from './shell.js';
import { reefDiorama, reefDrum } from './reefvox.js';
import { startUpgrade, updateUpgrade, drawUpgradeBack, drawUpgradeFront, upgradeHidesFish, upgradeFill, upgradeScale } from './upgrade.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { voxPlant, plantFrame, pumpVoxPlants, PLANT_FRAMES } from './voxplants.js';
import { drawEggs, eggColor } from './critters.js';
import { GlassSnail } from './helpers.js';
import { drawVoxelFish, beginVoxelFishFrame, warmVoxelFish, voxelFishStats, setVoxelFishBudget } from '../gfx/voxelfish.js';
import { playDecor, updateDecor, decorDrawState, queueDecorFrames, cleanupFish, specOf, forceUse } from './decoranim.js';

const HUNGER_RATE = 1 / 2000; // 0 -> 0.6 ("hungry") in 20 minutes
const ICONS = new Set(UI_ICON_NAMES);
const EMOTE_ICON = { '!': 'exclaim', '!!': 'exclaim', '?': 'question', $: 'dollar' };
const STARTER_DECOR = [];
// auto-collect: seconds a drop bobs at the surface before it pops by itself (by stats.autoCollect level)
const AUTO_POP = [Infinity, 14, 7, 3.5, 2];

// Per-view detail.
const CFG = {
  full: { shafts: 6, caustics: true, slabs: 4, bubbles: 9, detail: 1 },
  window: { shafts: 3, caustics: true, slabs: 4, bubbles: 5, detail: 0.75 },
  mini: { shafts: 2, caustics: false, slabs: 2, bubbles: 3, detail: 0.5 },
};

export class Aquarium {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.fish = [];
    this.food = [];
    this.bubbles = [];
    this.decor = [];
    this.colliders = [];
    this.coins = new AeroDrops();
    this.coins.onMerge = (c) => this.onDropMerge(c);
    this.particles = new Particles(360);
    this.room = new RoomAmbient();
    this.views = new Map();
    this.view = null;
    this.drag = null;
    this.combo = 0; this.comboT = 0;
    this.winAnim = 1;
    this.visibleKey = null;
    this.hoverFish = null;
    this.hoverBtn = null;
    this.hoverToy = null;
    this.syncT = 0; this.moodT = 0; this.saveT = 0; this.feederT = 20;
    this.coinsDirty = false;
    this.prevCursor = null;
    this.par = { x: 0, y: 0 }; this.parT = { x: 0, y: 0 };
    this.lampOn = true;
    this.toyT = {};
    this.upgrade = null;
    this.world = this.makeWorld();
    this.load();
    this.warm = ['window', 'full'];
  }

  // Background warm-up: one heavy job per frame (room art, tank shell, backdrop, then plant frames) so the
  // first switch between views does not hitch.
  prewarm() {
    if (!this.warmJobs) this.warmJobs = [];
    if (!this.warmJobs.length && this.warm.length) {
      const key = this.warm.shift();
      if (this.game.mini && key === 'full') return;
      const v = this.buildView(key);
      this.warmJobs.push(() => roomArt(v.L));
      this.warmJobs.push(() => shellArt(v.L, v.T.ell));
      this.warmJobs.push(() => this.artFor(v));
      for (const p of v.plants) this.warmJobs.push(() => { if (!p.vp) p.vp = voxPlant(p.kind, p.h * v.T.s(p.z), p.seed); });
      for (const f of this.fish) for (const z of [0.1, 0.45, 0.8]) this.warmJobs.push(() => warmVoxelFish(f.c, f.baseScale * v.fishScale * v.T.s(z)));
      for (const d of this.decor) {
        this.warmJobs.push(() => {
          const sc = this.decorScale(d, clamp(d.rec.z ?? 0.5, 0.04, 0.95), v);
          if (!d.props.has(sc)) {
            try { const p = getProp(d.rec.id, { scale: sc, variant: d.rec.v || 0 }); p.scale = sc; d.props.set(sc, p); } catch { return; /* unknown prop */ }
          }
          if (key === 'full') queueDecorFrames(this, d, sc);
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
    if (!Number.isFinite(tk.tier)) tk.tier = 0;
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
    this.tier = tankTier(this.st);
    this.fish.length = 0;
    this.food.length = 0;
    this.coins.list.length = 0;
    this.upgrade = null;
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

  capacity() { return this.stats.tankCap || 4; }
  tierInfo() { return TANK_TIERS[this.tier] || TANK_TIERS[0]; }

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

  sceneDims(key, tier = this.tier) {
    const { W, H } = this.game.screen;
    return sceneSize(key, tier, W, H, TASKBAR_H);
  }

  buildView(key) {
    const tier = this.tier;
    const { sw, sh } = this.sceneDims(key, tier);
    const vk = `${key}|${tier}|${sw}x${sh}`;
    let v = this.views.get(vk);
    if (v) return v;
    const L = sceneLayout(key, tier, sw, sh);
    const iw = L.tank.w, ih = L.tank.h;
    const T = new TankSpace(iw, ih, tankOpts(tier, iw, ih, key));
    const c = CFG[key];
    v = {
      key, vk, tier, sw, sh, L, iw, ih, T, cfg: c, fishScale: L.fishScale, decorScale: L.decorScale,
      coinScale: key === 'full' ? 1 : key === 'mini' ? 0.42 : 0.68, art: null,
    };
    v.plants = this.layoutPlants(v);
    v.shafts = [];
    const ns = T.round ? Math.max(1, c.shafts - 2) : c.shafts;
    for (let i = 0; i < ns; i++) {
      v.shafts.push({ X: (0.12 + (i + rng.float(0.2, 0.8)) / ns * 0.78) * iw, z: rng.float(0.25, 0.92), w: rng.float(0.07, 0.14) * iw, a: rng.float(0.3, 0.48), ph: rng.float(0, TAU) });
    }
    v.stone = tier === 0 ? null : T.round ? this.floorPoint(T, 0.78, 0.72) : { X: iw * 0.1, z: 0.84 };
    for (const [k, old] of this.views) if (old.key === key && old !== this.view) this.views.delete(k);
    this.views.set(vk, v);
    return v;
  }

  // A floor point {X, z} at fraction t across the visible floor (inside the round glass) at depth z.
  floorPoint(T, t, z, m = 4) {
    if (!T.round) return { X: lerp(m, T.W - m, t), z };
    const Y = T.groundZ(T.W / 2, z) - 2;
    const [a, b] = T.span(Y, z, m);
    return { X: b > a ? lerp(a, b, t) : T.W / 2, z };
  }

  // Keep a floor X inside the round glass at depth z (box tanks: inside the walls).
  fitFloorX(T, X, z, m = 4) {
    if (!T.round) return clamp(X, m, T.W - m);
    const [a, b] = T.span(T.groundZ(clamp(X, 0, T.W - 1), z) - 2, z, m);
    return b > a ? clamp(X, a, b) : T.W / 2;
  }

  // Heavy tank-interior art is built on first draw.
  artFor(v) {
    if (v.art) return v.art;
    const T = v.T;
    const bd = renderBackdrop(T);
    const fog = makeCanvas(1, T.H);
    const fg = ctxOf(fog);
    for (let y = 0; y < T.H; y++) {
      const t = 0.72 - 0.44 * clamp01((y - T.surf) / (T.floorFront - T.surf));
      fg.fillStyle = T.water[clamp(Math.round(lerp(t, 0.5, 0.35) * 12), 0, 12)];
      fg.fillRect(0, y, 1, 1);
    }
    const back = bd.back;
    v.art = {
      backdrop: bd.canvas, floor: bd.floor, back, dio: v.L.shape === 'lamp' ? null : reefDiorama(back.x1 - back.x0, back.y1 - back.y0, 3 + v.tier, T.round ? 0.8 : 1), glass: renderGlass(T), fog,
      floorPoly: bd.floorPoly, ceilPoly: bd.ceilPoly, floorTopY: Math.min(...bd.floorTop),
      layer: makeCanvas(T.W, T.H), caustics: v.cfg.caustics,
    };
    v.art.lg = ctxOf(v.art.layer);
    return v.art;
  }

  layoutPlants(v) {
    const T = v.T;
    const r = new RNG(1234 + v.iw + v.tier * 77);
    const tierP = TANK_TIERS[v.tier].plants;
    const det = v.cfg.detail;
    const [nBack, nSide, nFront, nTuft] = tierP.map((n, i) => (i === 0 ? Math.max(1, Math.round(n * (0.5 + det * 0.5))) : Math.round(n * det)));
    const ih = v.ih * (T.round ? 0.72 : 1);
    const out = [];
    const add = (kind, t, z, h) => {
      const p = this.floorPoint(T, t, z, 6);
      out.push({ kind, X: p.X, z, h, seed: r.int(1, 9999), ph: r.float(0, 1), vp: null });
    };
    const backKinds = T.round ? ['cabomba', 'rotala', 'vallis'] : ['vallis', 'kelp', 'cabomba', 'rotala', 'vallis'];
    for (let i = 0; i < nBack; i++) add(r.pick(backKinds), nBack === 1 ? r.float(0.55, 0.7) : (0.06 + (i + r.float(0.1, 0.9)) / nBack * 0.88), T.round ? r.float(0.5, 0.75) : r.float(0.86, 0.97), ih * r.float(0.42, 0.66));
    for (let i = 0; i < nSide; i++) add(r.pick(['rotala', 'sword', 'fern', 'cabomba']), i % 2 ? r.float(0.86, 0.95) : r.float(0.05, 0.14), r.float(0.35, 0.72), ih * r.float(0.26, 0.4));
    for (let i = 0; i < nFront; i++) add(r.pick(['fern', 'sword', 'hairgrass']), i % 2 ? r.float(0.85, 0.95) : r.float(0.05, 0.15), r.float(0.04, 0.14), ih * r.float(0.1, 0.17));
    for (let i = 0; i < nTuft; i++) add('hairgrass', r.float(0.15, 0.85), r.float(0.15, 0.75), ih * r.float(0.04, 0.07));
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
      const sy = (T.floorFront - T.surf) / Math.max(1, O.floorFront - O.surf);
      for (const f of this.fish) {
        const z = f.z;
        const X = O.X(f.x, z) * sx;
        const fy = clamp01((O.Y(f.y, z) - O.surf) / Math.max(1, O.groundZ(X / sx, z) - O.surf));
        f.x = T.sx(X, z);
        f.y = T.sy(T.surf + fy * (T.groundZ(X, z) - T.surf), z);
        const q = T.clampSwim(f.x, f.y, z, 4);
        f.x = q[0]; f.y = q[1];
        f.target = null; f.bed = null; f.vx *= 0.5; f.vy *= 0.5;
      }
      const sd = T.DEPTH / O.DEPTH;
      for (const c of this.coins.list) { c.X *= sx; c.D *= sd; c.Y = T.surf + (c.Y - O.surf) * sy; c.hintY = undefined; }
      for (const f of this.food) { f.X *= sx; f.Y = T.surf + (f.Y - O.surf) * sy; }
      if (this.snail) this.snail.x *= sx;
      this.bubbles.length = 0;
      this.particles.clear?.();
      for (const f of this.fish) if (f.use || f.state === 'script') { cleanupFish(f); f.setState('wander'); }
    }
    this.view = nv;
    this.T = T;
    const w = this.world;
    w.W = T.W; w.H = T.H; w.surfaceY = T.surf;
    for (const f of this.fish) this.scaleFish(f);
    this.layoutDecor();
    this.coins.setTank(T, nv.coinScale);
    if (ov) for (let i = 0; i < 20; i++) this.coins.step(1 / 60);
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
      d.z = clamp(d.rec.z ?? 0.5, 0.04, 0.95);
      const p0 = d.props.get(this.decorScale(d, d.z)) || [...d.props.values()][0];
      const half = p0 ? (p0.w / (p0.scale || 1)) * this.decorScale(d, d.z) * 0.35 / T.s(d.z) : 6;
      d.X = this.fitFloorX(T, clamp(d.rec.x, 0.03, 0.97) * T.W, d.z, half);
      d.scale = this.decorScale(d, d.z);
      d.prop = d.props.get(d.scale) || null;
      if (!d.prop) this.queueProp(d, d.scale);
      else queueDecorFrames(this, d, d.scale);
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

  // Decor renders are built one per frame (urgent ones first: a clicked decoration's animation frames).
  queueProp(d, scale, frame = 0, urgent = false) {
    const q = (this.propQueue ||= []);
    const i = q.findIndex((j) => j.d === d && j.scale === scale && j.frame === frame);
    if (i >= 0) {
      if (urgent && i > 0) { const [j] = q.splice(i, 1); j.urgent = true; q.unshift(j); }
      return;
    }
    const job = { d, scale, frame, urgent };
    if (urgent) q.unshift(job); else q.push(job);
  }

  pumpProps() {
    const q = this.propQueue;
    if (!q?.length) return;
    const t0 = performance.now();
    for (let n = 0; n < 3; n++) {
      // Hidden tank: only base renders and urgent frames (animation frames wait until it is shown).
      const i = this.visibleKey ? 0 : q.findIndex((j) => !j.frame || j.urgent);
      if (i < 0 || (n > 0 && (!q[i].urgent || performance.now() - t0 > 10))) return;
      const [job] = q.splice(i, 1);
      this.runPropJob(job);
      if (!q.length) return;
    }
  }

  runPropJob(job) {
    const d = job.d;
    if (!this.decor.includes(d)) return;
    if (job.frame) {
      let arr = d.frames?.get(job.scale);
      if (arr?.[job.frame]) return;
      try {
        const p = getProp(d.rec.id, { scale: job.scale, variant: d.rec.v || 0, frame: job.frame });
        p.scale = job.scale;
        d.frames ||= new Map();
        if (!arr) d.frames.set(job.scale, (arr = []));
        arr[job.frame] = p;
      } catch (e) { console.warn('decor frame', d.rec.id, job.frame, e); }
      return;
    }
    if (d.props.has(job.scale)) return;
    try {
      const p = getProp(d.rec.id, { scale: job.scale, variant: d.rec.v || 0 });
      p.scale = job.scale;
      d.props.set(job.scale, p);
    } catch (e) { console.warn('decor', d.rec.id, e); this.decor = this.decor.filter((x) => x !== d); return; }
    if (d.scale === job.scale) {
      d.prop = d.props.get(job.scale);
      this.layoutDecor();
    }
  }

  // Place a decoration in the tank (Lab recipes, crates). Returns true on success.
  addDecor(id, opts = {}) {
    const meta = PROPS[id];
    if (!meta?.decor) return false;
    const tk = this.st.tank;
    let best = null, bs = -1;
    for (let i = 0; i < 40; i++) {
      const x = rng.float(0.12, 0.88), z = rng.float(0.2, 0.8);
      let m = 9;
      for (const d of tk.decor) m = Math.min(m, Math.abs(d.x - x) + Math.abs((d.z ?? 0.5) - z) * 0.6);
      if (m > bs) { bs = m; best = { x, z }; }
    }
    const rec = { id, x: opts.x ?? best.x, z: opts.z ?? best.z };
    if (opts.v) rec.v = opts.v;
    tk.decor.push(rec);
    this.decor.push({ rec, props: new Map() });
    this.layoutDecor();
    this.game.save?.();
    return true;
  }

  storedDecor() { return this.st.tank.stored.slice(); }

  // Put a packed-away decoration back into the tank (the last one when no id is given).
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
    this.game.toast?.(`${PROPS[d.rec.id]?.name || 'Decoration'} packed away.`, 'tank');
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
    let f;
    try { f = new Fish(rec, sp, this.world, { z }); } catch (e) { console.warn('tank fish', rec.species, e); return null; }
    f.z = z;
    f.baseScale = f.scale; f.cruise0 = f.cruise; f.burst0 = f.burst;
    this.scaleFish(f);
    const T = this.T;
    if (opts.at) { f.x = opts.at.x; f.y = opts.at.y; f.z = opts.at.z; }
    else {
      f.x = lerp(T.left(z), T.right(z), rng.float(0.3, 0.7));
      f.y = opts.splash ? T.top(z) + 3 : lerp(T.top(z), T.floorAt(f.x, z), rng.float(0.25, 0.7));
      const q = T.clampSwim(f.x, f.y, z, 4);
      f.x = q[0]; f.y = q[1];
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

  // Species with evolve: {into, afterMinutes} transform after enough time in the tank (Flopikarp -> Dragon-Karp).
  // Guarded: species ids may change, so a missing target species simply never evolves.
  evolveFish(dt) {
    for (const f of this.fish.slice()) {
      const ev = f.sp?.evolve;
      if (!ev || !ev.into || !SPECIES_BY_ID[ev.into]) continue;
      const rec = f.rec;
      rec.tankAge = (rec.tankAge || 0) + dt;
      if (rec.tankAge < (ev.afterMinutes ?? 30) * 60) continue;
      const g = this.game, into = SPECIES_BY_ID[ev.into];
      rec.species = into.id; rec.tankAge = 0;
      if (g.state.journal) {
        const j = (g.state.journal[into.id] ||= { seen: true, caught: 0, maxSize: 0, minSize: 9999, first: Date.now(), variants: {} });
        j.caught = (j.caught || 0) + 1; j.maxSize = Math.max(j.maxSize || 0, rec.sizeCm || 0); j.minSize = Math.min(j.minSize ?? 9999, rec.sizeCm || 9999);
      }
      this.fish.splice(this.fish.indexOf(f), 1);
      const nf = this.makeFish(rec, { splash: false, at: { x: f.x, y: f.y, z: f.z } });
      if (this.visibleKey) {
        this.particles.shockwave(f.x, f.y, 26, '#bff6ff');
        this.particles.aeroConfetti ? this.particles.aeroConfetti(f.x, f.y, 26) : this.particles.confetti(f.x, f.y, 24);
        for (let i = 0; i < 10; i++) this.particles.sparkle(f.x + rng.float(-10, 10), f.y + rng.float(-8, 8), '#bff8ff');
      }
      this.sfx('catch_epic', { vol: 0.7 });
      g.toast?.(`Your ${f.sp.name} evolved into ${into.name}!`, 'sparkle', 5);
      g.emit?.('fishEvolved', { rec, from: f.sp.id, into: into.id, fish: nf });
      g.save?.();
    }
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
    const { sw, sh } = this.sceneDims(key);
    const f = FRAME[key];
    return { w: sw + f.side * 2, h: sh + f.lid + f.base, ...f, sw, sh };
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
    if (!was) { this.winAnim = 0; try { audio.play('ui_open'); } catch { /* no audio */ } }
  }

  closeWindow() {
    const tw = this.st.tankWindow;
    if (tw?.open) { tw.open = false; if (this.game.state.view === 'ocean') try { audio.play('ui_close'); } catch { /* no audio */ } }
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

  // Scene (room) origin on screen for a view.
  sceneOrigin(key) {
    if (key === 'full') return { x: 0, y: 0 };
    if (key === 'mini') { const r = this.miniRect(); return { x: r.x + FRAME.mini.side, y: r.y + FRAME.mini.lid }; }
    const tw = this.st.tankWindow;
    return { x: tw.x + FRAME.window.side, y: tw.y + FRAME.window.lid + this.slideOff() };
  }

  // Inner (glass) rect origin on screen for the shown view.
  innerOrigin(key) {
    const o = this.sceneOrigin(key);
    const L = this.view.L;
    return { x: o.x + L.tank.x, y: o.y + L.tank.y };
  }

  slideOff() { return Math.round((1 - ease.outCubic(clamp01(this.winAnim))) * 14); }

  hit(x, y) {
    const g = this.game;
    if (this.zoom || this.press) return true;
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

  // Tank-local point inside the glass (round tanks: inside the globe, below the opening)?
  inGlass(lx, ly) {
    const T = this.T;
    if (T.round) {
      const e = T.ell;
      return ly >= 0 && ((lx - e.cx) / e.rx) ** 2 + ((ly - e.cy) / e.ry) ** 2 <= 1;
    }
    return lx >= 0 && ly >= 0 && lx < T.W && ly < T.H;
  }

  // ------------------------------------------------------------------ economy hooks
  fishRate(f) {
    return aeroRate(f.rec, f.sp, this.stats, this.tier, this.game.coinMulBonus || 1);
  }

  // Tutorial: a drop that hovers low in the water until it is popped.
  forceCoin() {
    const T = this.T;
    const f = this.fish[0];
    let X = T.W / 2, z = 0.12;
    if (f) { X = clamp(T.X(f.x, f.z), T.W * 0.3, T.W * 0.7); }
    X = this.fitFloorX(T, X, z, 10);
    const c = this.coins.spawn(X, T.surf + (T.floorFront - T.surf) * 0.75, z * T.DEPTH, 1, { value: DENOMS[0] });
    c.hint = true;
    this.coinsDirty = true;
    if (f) { f.say?.('$', 1.4); f.feel?.('happy', 1); }
  }

  // A fish puffs out an Aero drop at its mouth.
  dropCoin(f, d, forced = false) {
    const T = this.T;
    const mouth = f.anchors?.mouth;
    const sx = mouth ? mouth[0] : f.x + (f.facing || 1) * 6 * f.scale, sy = mouth ? mouth[1] : f.y;
    const X = clamp(T.X(sx, f.z), 4, T.W - 4), Y = Math.max(T.surf + 4, T.Y(sy, f.z)), D = f.z * T.DEPTH;
    const c = this.coins.spawn(X, Y, D, d, { vx: (f.facing || 1) * rng.float(6, 16), vy: -rng.float(4, 10), vd: rng.float(-4, 4), hold: 0.35 });
    if (forced) { c.hint = true; c.D = Math.min(c.D, T.DEPTH * 0.2); }
    this.sfx('bubble', { vol: forced ? 0.6 : 0.3 * (1 - f.z * 0.5), pitch: [1.35, 1.15, 0.95][d] });
    this.particles.ring(sx, sy, 0.12 + 0.2 * this.view.fishScale * T.s(f.z), 'rgba(200,250,255,0.9)');
    f.squashV += 4;
    if (!f.emote) f.feel('happy', 0.8);
    this.coinsDirty = true;
  }

  onDropMerge(c) {
    if (!this.visibleKey) return;
    const p = this.toLocal(c.X, c.Y, c.D);
    for (let i = 0; i < 3; i++) this.particles.sparkle(p.x + rng.float(-3, 3), p.y + rng.float(-3, 3), '#bff8ff');
  }

  toLocal(X, Y, D) {
    const z = D / this.T.DEPTH;
    return { x: this.T.sx(X, z), y: this.T.sy(Y, z), z };
  }

  // Pop a drop into Aero (by: 'player' | 'auto' | 'helper').
  collectCoin(c, by = 'player') {
    if (!this.coins.list.includes(c)) return;
    this.coins.remove(c);
    this.coinsDirty = true;
    const p = this.toLocal(c.X, c.Y, c.D);
    const vk = this.visibleKey;
    let sx, sy;
    if (vk) { const o = this.innerOrigin(vk); sx = o.x + p.x; sy = o.y + p.y; }
    if (by === 'player') this.lastGrabT = this.t;
    this.game.addCoins?.(c.value, sx, sy);
    if (vk) {
      this.combo = this.comboT > 0 ? this.combo + 1 : 0;
      this.comboT = 0.45;
      this.sfx('bubble', { vol: by === 'player' ? 0.5 : 0.25, pitch: 1.5 + Math.min(12, this.combo) * 0.06 });
      this.sfx('coin_collect', { vol: by === 'player' ? 0.3 : 0.15, pitch: 1.1 + Math.min(12, this.combo) * 0.045 });
      const r = c.r * this.T.s(p.z);
      this.particles.ring(p.x, p.y, 0.15 + r * 0.05, 'rgba(220,255,255,0.95)');
      this.particles.glints ? this.particles.glints(p.x, p.y, 2, { w: r, h: r }) : this.particles.sparkle(p.x, p.y, '#ffffff');
      for (let i = 0; i < 3; i++) this.particles.sparkle(p.x + rng.float(-3, 3), p.y + rng.float(-3, 3), '#bff8ff');
      if (c.value > 1 || by !== 'player') this.particles.text(p.x, p.y - 6, '+' + fmtAero(c.value), { font: 'small', color: '#e8fdff', layer: 'fg', life: 0.9, vy: -16 });
    }
    this.game.emit?.('coinCollected', { value: c.value, by });
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
    const z = clamp((a.z + b.z) / 2, 0.08, 0.85);
    const X = this.fitFloorX(T, (T.X(a.x, a.z) + T.X(b.x, b.z)) / 2, z, 8);
    const egg = { species: a.sp.id, x: clamp(X / T.W, 0.05, 0.95), z, t: 0, dur: 180 / (this.stats.hatchSpeed || 1), n: rng.int(3, 6), color: eggColor(a.sp), parents: [a.rec.uid, b.rec.uid] };
    this.st.tank.eggs.push(egg);
    const later = Date.now() + 6 * 60 * 1000;
    a.rec.breedAt = later; b.rec.breedAt = later;
    a.say('heart', 1.5); b.say('heart', 1.5);
    this.sfx('magic', { vol: 0.5 });
    this.game.toast?.(`${a.rec.name} & ${b.rec.name} laid eggs!`, 'heart');
  }

  hatch(egg) {
    const g = this.game;
    const sp = SPECIES_BY_ID[egg.species];
    if (!sp) return;
    const s = this.stats;
    const rolled = rollIndividual(sp, { mutationChance: (s.mutationChance ?? 0.05) * 3, shinyChance: (s.shinyChance ?? 1 / 220) * 3, sizeBonus: -0.05 });
    const inTank = this.fish.length < this.capacity();
    const rec = { ...rolled, inTank, happiness: 0.85, hunger: 0.2, coinT: 0, bornAt: Date.now(), caughtAt: Date.now(), rarity: sp.rarity, bred: true, parents: egg.parents };
    (g.state.fish ||= []).push(rec);
    const T = this.T;
    const X = this.fitFloorX(T, egg.x * T.W, egg.z, 6);
    if (inTank) this.makeFish(rec, { splash: false, baby: true, at: { x: T.sx(X, egg.z), y: T.floorAt(T.sx(X, egg.z), egg.z) - 4, z: egg.z } });
    const p = this.toLocal(X, T.groundZ(X, egg.z) - 2, egg.z * T.DEPTH);
    this.particles.burst(p.x, p.y, 10, { colors: ['#ffffff', egg.color, '#bff8ff'], speed: 30, g: 30, life: 0.7, up: 10 });
    this.sfx('sparkle', { vol: 0.6 });
    const trait = rec.variant?.shiny ? 'A SHINY ' : rec.variant?.mutation ? 'A mutated ' : 'A baby ';
    g.toast?.(`${trait}${sp.name} hatched${inTank ? '!' : ' - the tank is full, it went to the holding bucket.'}`, 'heart');
    g.emit?.('hatched', rec);
    g.save?.();
  }

  // Aero per minute of the whole tank right now.
  ratePerMin() { return this.fish.reduce((a, f) => a + this.fishRate(f), 0); }

  // Offline earnings: what the tank made while the game was closed (capped by tier, scaled by
  // stats.offlineMul). Returns the amount; the "While you were away" popup credits it.
  offlineCoins(seconds) {
    const st = this.st, s = this.stats;
    const tier = tankTier(st);
    const cap = (TANK_TIERS[tier]?.offlineH || 4) * 3600;
    const sec = Math.max(0, Math.min(seconds, cap));
    let rate = 0;
    for (const rec of st.fish || []) {
      if (!rec.inTank) continue;
      const sp = SPECIES_BY_ID[rec.species];
      if (!sp) continue;
      rate += aeroRate(rec, sp, s, tier, this.game.coinMulBonus || 1);
      rec.hunger = Math.min(s.feeder ? 0.45 : 1, (rec.hunger ?? 0.3) + seconds * HUNGER_RATE);
    }
    for (const e of st.tank?.eggs || []) e.t += seconds;
    const amount = Math.floor((rate / 60) * sec * (s.offlineMul ?? 0.35));
    this.lastOffline = { seconds, capped: sec, rate, amount, tier };
    return Math.max(0, amount);
  }

  saveCoins() {
    const T = this.T;
    this.st.tank.coins = this.coins.list.filter((c) => !c.hint).map((c) => [Math.round((c.X / T.W) * 1000) / 1000, Math.round((c.D / T.DEPTH) * 1000) / 1000, c.d, c.value]);
    this.coinsDirty = false;
  }

  restoreCoins() {
    const T = this.T;
    for (const [x, z, d, v] of this.st.tank.coins || []) {
      if (!(d >= 0 && d <= 2)) continue;
      const c = this.coins.spawn(x * T.W, T.surf + rng.float(0, 4), z * T.DEPTH, d, { value: v });
      c.Y = T.surf + c.r * 0.55;
    }
    for (let i = 0; i < 30; i++) this.coins.step(1 / 40);
  }

  // Debug/profiling: voxel fish cache stats and render budget (ms per frame).
  voxStats() { return voxelFishStats(); }
  setVoxBudget(ms) { setVoxelFishBudget(ms); }

  tankSummary() {
    const n = this.fish.length;
    const happy = n ? this.fish.reduce((a, f) => a + (f.rec.happiness ?? 0.7), 0) / n : 0;
    return { fish: n, cap: this.capacity(), happiness: happy, coinsPerMin: this.ratePerMin(), aeroPerMin: this.ratePerMin(), coins: this.coins.list.length, decor: this.decor.length, tier: this.tier, tank: this.tierInfo().name };
  }

  // ------------------------------------------------------------------ update
  update(dt, inp) {
    const g = this.game;
    if (this.stateRef !== g.state) this.load();
    this.t += dt;
    pumpVoxPlants(this.visibleKey ? 4 : 2);
    this.pumpProps();
    if (this.t > 1.2 && (this.warm.length || this.warmJobs?.length)) this.prewarm();
    // tier changes (Lab unlocks or a direct state.tank.tier change)
    const tier = tankTier(this.st);
    if (tier !== this.tier) this.changeTier(tier);
    const key = this.simKey();
    const { sw, sh } = this.sceneDims(key);
    if (!this.view || this.view.key !== key || this.view.tier !== this.tier || this.view.sw !== sw || this.view.sh !== sh) this.applyView(key);
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
    if (this.syncT <= 0) { this.syncT = 0.5; this.syncFish(); this.evolveFish(0.5); }

    if (this.zoom && this.shownKey() !== this.zoom.vk) this.zoom = null;
    this.updateZoom(dt);
    this.zoomIn = Math.max(0, (this.zoomIn || 0) - dt);
    this.handleInput(dt, inp);
    if (this.upgrade) updateUpgrade(this, dt);
    this.updateFood(dt);
    this.updateFish(dt);
    updateDecor(this, dt);
    this.updateEconomy(dt);
    this.coins.step(dt);
    this.updateHelpers(dt);
    this.autoCollect(dt);
    this.updateEggs(dt);
    this.updateBubbles(dt);
    this.particles.update(dt);
    // the room: parallax follows the pointer, motes and soap bubbles drift
    const k = Math.min(1, dt * 3);
    this.par.x += (this.parT.x - this.par.x) * k;
    this.par.y += (this.parT.y - this.par.y) * k;
    for (const id in this.toyT) this.toyT[id] = Math.max(0, this.toyT[id] - dt);
    // the back-glass reef picture turns slowly (stops when the lamp tank is switched off)
    this.reefSpeed = lerp(this.reefSpeed ?? 1, this.st.tank.lampOff ? 0 : 1, Math.min(1, dt * 2));
    this.reefOff = (this.reefOff || 0) + dt * 5 * this.reefSpeed;
    if (this.visibleKey) {
      this.room.update(dt, roomArt(this.view.L));
      this.updateBgFish(dt);
      // the Aqua Lamp's drum: render one more frame of its ring per tick until all are cached
      const vv = this.view;
      if (vv.L.shape === 'lamp') {
        if (!vv.drum && vv.art) { const b = vv.art.back; vv.drum = reefDrum((b.x1 - b.x0) * 1.04, (b.y1 - b.y0) * 1.3, 5, vv.key === 'full' ? 2 : 1, vv.key === 'mini' ? 32 : 48); }
        if (vv.drum && !vv.drum.ready) vv.drum.warm();
      }
    }

    this.saveT -= dt;
    if (this.saveT <= 0 && this.coinsDirty) { this.saveT = 1; this.saveCoins(); }
  }

  // New tank tier: rebuild the views; when the tank is on screen and the tier went up, play the pour.
  changeTier(tier) {
    const from = this.tier;
    const vk = this.visibleKey;
    const anim = vk && this.view && tier > from && !this.zoom ? startUpgrade(this, from, tier) : null;
    this.tier = tier;
    this.applyView(this.simKey());
    this.upgrade = anim;
    if (anim) anim.begin(this);
    this.game.recomputeStats?.();
    if (tier > from) {
      this.game.toast?.(`Tank upgraded: ${TANK_TIERS[tier].name}!`, 'tank', 4);
      this.game.emit?.('tankUpgraded', { from, to: tier });
    }
  }

  handleInput(dt, inp) {
    const g = this.game;
    const vk = this.visibleKey;
    const cur = this.world.cursor;
    this.hoverFish = null;
    this.hoverBtn = null;
    this.hoverDecor = null;
    this.hoverToy = null;
    if (this.zoom) { cur.inWorld = false; if (inp?.pressed) inp.consume(); return; }
    if (!inp || !vk) {
      cur.inWorld = false;
      if (this.drag && (!inp || !inp.down)) this.endDrag();
      if (!inp || !inp.down) this.press = null;
      this.prevCursor = null;
      this.parT.x = 0; this.parT.y = 0;
      return;
    }
    const v = this.view, T = this.T, L = v.L;
    const so = this.sceneOrigin(vk);
    const o = { x: so.x + L.tank.x, y: so.y + L.tank.y };
    const lx = inp.x - o.x, ly = inp.y - o.y;
    const scx = inp.x - so.x, scy = inp.y - so.y;
    this.parT.x = clamp((scx / v.sw - 0.5) * 2, -1, 1);
    this.parT.y = clamp((scy / v.sh - 0.5) * 2, -1, 1);
    const tip = (t) => { if (g.desktop) g.desktop.tooltip = t; };

    // A pending press becomes a drag once the pointer moves, or a click when released in place.
    const pr = this.press;
    if (pr) {
      if (Math.hypot(inp.x - pr.x, inp.y - pr.y) > 4) pr.moved = true;
      if (inp.down) {
        if (pr.moved && pr.kind === 'lid' && vk === 'window') {
          const tw = g.state.tankWindow;
          this.drag = { kind: 'window', dx: pr.x - tw.x, dy: pr.y - tw.y };
          this.press = null;
        } else if (pr.moved && pr.kind === 'decorFull' && this.decor.includes(pr.d)) {
          this.drag = { kind: 'decor', d: pr.d, dy: pr.dy };
          this.press = null;
          this.sfx('icon_pickup', { vol: 0.5 });
        }
      } else {
        this.press = null;
        if (!pr.moved && !pr.collected) {
          // (a click that just popped a drop, or one during the tank / coin tutorial, stays a drop grab)
          const tut = g.tutorial?.active && (g.tutorial.step === 'tank' || g.tutorial.step === 'coin');
          const grab = pr.kind === 'glass' && (tut || this.t - (this.lastGrabT ?? -9) < 0.6);
          if ((pr.kind === 'decor' || pr.kind === 'decorFull') && this.decor.includes(pr.d)) this.interact(pr.d);
          else if ((pr.kind === 'lid' && !tut) || (pr.kind === 'glass' && !grab)) { this.openFull(); return; }
        }
      }
    }

    // window chrome: drag by the title bar (click it to dive in), close / expand buttons
    if (vk === 'window' || vk === 'mini') {
      const tw = g.state.tankWindow;
      if (this.drag?.kind === 'window') {
        if (inp.down) { tw.x = Math.round(inp.x - this.drag.dx); tw.y = Math.round(inp.y - this.drag.dy); this.clampWindow(); }
        else this.drag = null;
        return;
      }
      const fr = FRAME[vk];
      const r = vk === 'window' ? this.windowRect() : this.miniRect();
      if (!r) { cur.inWorld = false; return; }
      const btns = this.chromeButtons(vk, r);
      for (const b of btns) if (rectContains(b, inp.x, inp.y)) this.hoverBtn = b.id;
      if (inp.y < r.y + fr.lid + (vk === 'window' ? this.slideOff() : 0)) {
        if (this.hoverBtn) tip(btns.find((b) => b.id === this.hoverBtn).tip);
        else if (!this.press) tip(vk === 'window' ? '{mouse_l} Dive into the aquarium\n{mouse_hold} Drag to move' : '{mouse_l} Dive into the aquarium');
        if (inp.pressed) {
          inp.consume();
          if (this.hoverBtn === 'close') this.closeWindow();
          else if (this.hoverBtn === 'expand') this.openFull();
          else if (this.hoverBtn === 'restore') g.setMini?.(false);
          else this.press = { kind: 'lid', x: inp.x, y: inp.y };
        }
        cur.inWorld = false;
        return;
      }
      if (scx < 0 || scx >= v.sw || scy >= v.sh) { cur.inWorld = false; if (inp.pressed) inp.consume(); return; }
    }
    if (vk === 'full') {
      const lay = this.fullLayout();
      if (rectContains(lay.btn, inp.x, inp.y)) {
        this.hoverBtn = 'back';
        if (inp.pressed) { inp.consume(); g.setView?.('ocean'); }
        cur.inWorld = false;
        return;
      }
      if (rectContains(lay.pill, inp.x, inp.y)) {
        this.hoverBtn = 'pill';
        const ti = this.tierInfo();
        tip(`${ti.name}\n{fish} ${this.fish.length}/${this.capacity()}  {coin} ${this.ratePerMin().toFixed(1)} Aero/min`);
        cur.inWorld = false;
        return;
      }
      if (this.st.tank.stored.length && rectContains(lay.unpack, inp.x, inp.y)) {
        this.hoverBtn = 'unpack';
        tip(`Place ${PROPS[this.st.tank.stored.at(-1)]?.name || 'decoration'}`);
        if (inp.pressed) { inp.consume(); this.placeStored(); }
        cur.inWorld = false;
        return;
      }
    }

    // the Aqua Lamp's rocker switch: light + scrolling reef on / off
    const shl = shellArt(L, T.ell);
    if (shl.switch && !this.drag && rectContains({ x: shl.switch.x - 2, y: shl.switch.y - 2, w: shl.switch.w + 4, h: shl.switch.h + 4 }, scx, scy)) {
      this.hoverBtn = 'lampswitch';
      tip(this.st.tank.lampOff ? '{mouse_l} Lamp on' : '{mouse_l} Lamp off');
      if (inp.pressed) {
        inp.consume();
        this.st.tank.lampOff = !this.st.tank.lampOff;
        this.toyT.lampswitch = 0.25;
        this.sfx('click', { vol: 0.6, pitch: this.st.tank.lampOff ? 0.8 : 1.25 });
        this.game.save?.();
      }
      cur.inWorld = false;
      return;
    }
    const inGlass = this.inGlass(lx, ly);
    // cursor in tank space (fish curiosity / fear use it)
    cur.x = lx; cur.y = ly; cur.vx = inp.vx; cur.vy = inp.vy; cur.speed = inp.speed;
    cur.inWorld = inGlass && ly >= T.surf;

    // decor dragging (full view)
    if (this.drag?.kind === 'decor') {
      const d = this.drag.d;
      if (inp.down) {
        const pk = T.pickFloor(lx, ly + this.drag.dy);
        const z = clamp(pk.z, 0.05, 0.92);
        const X = this.fitFloorX(T, pk.X, z, 6);
        d.rec.x = clamp(X / T.W, 0.04, 0.96);
        d.rec.z = z;
        d.X = X; d.z = z;
        tip(null);
      } else this.endDrag();
      return;
    }

    // decorations: hover glow + click to play in every view; the full view also drags / stores them
    const hd = this.press || !inGlass ? null : this.decorAt(lx, ly);
    if (hd) {
      this.hoverDecor = hd;
      const name = PROPS[hd.rec.id]?.name || 'Decoration', verb = specOf(hd)?.verb || 'Poke';
      tip(vk === 'full' ? `${name}\n{mouse_l} ${verb}  {mouse_hold} move  {mouse_r} store` : `${name}\n{mouse_l} ${verb}`);
      if (vk === 'full' && inp.rpressed) { this.storeDecor(hd); inp.rpressed = false; return; }
      if (inp.pressed) {
        inp.consume();
        const base = T.floorAt(T.sx(hd.X, hd.z), hd.z);
        this.press = { kind: vk === 'full' ? 'decorFull' : 'decor', d: hd, x: inp.x, y: inp.y, dy: base - ly };
        return;
      }
    }

    // Aero drops: hover pops them, a click / drag sweeps a wider path
    const rad = (this.stats.collectRadius || 14) * (vk === 'full' ? 1 : vk === 'window' ? 0.9 : 0.7);
    const p0 = this.prevCursor || { x: lx, y: ly };
    const sweep = inp.down;
    let got = 0;
    for (let i = this.coins.list.length - 1; i >= 0; i--) {
      const c = this.coins.list[i];
      const p = this.toLocal(c.X, c.Y, c.D);
      const rr = (sweep ? rad * 1.35 : rad) * 0.6 + c.vr * T.s(p.z) + (c.hint ? 18 : 0);
      const d = sweep ? segDist(p.x, p.y, p0.x, p0.y, lx, ly) : dist(p.x, p.y, lx, ly);
      if (d < rr) { this.collectCoin(c, 'player'); got++; }
    }
    if (got && this.press) this.press.collected = true;
    this.prevCursor = { x: lx, y: ly };

    // fish hover tooltip and petting (full view); the window / mini tank opens the full view on click
    let best = null, bd = Infinity;
    if (inGlass) {
      for (const f of this.fish) {
        if (f.alpha === 0 || (this.upgrade && upgradeHidesFish(this, f))) continue;
        const s = T.s(f.z);
        const r = (11 * f.scale + 5) * s;
        const d = dist(f.x, f.y, lx, ly) + f.z * 10;
        if (dist(f.x, f.y, lx, ly) < r && d < bd) { bd = d; best = f; }
      }
    }
    this.hoverFish = best;
    if (best && !this.hoverDecor) tip(this.fishTip(best) + (vk === 'full' ? '' : '\n{mouse_l} Dive in'));
    if (vk === 'full') {
      if (!inGlass && !hd) {
        // the room around the tank: the lamp switches, plants wiggle
        const toy = roomHit(roomArt(L), scx, scy);
        if (toy) {
          this.hoverToy = toy;
          tip(toy === 'lamp' || toy === 'floorlamp' ? '{mouse_l} Lamp' : '{mouse_l} Plant');
          if (inp.pressed) { inp.consume(); this.pokeToy(toy, scx, scy); }
        }
        return;
      }
      if (inp.pressed && cur.inWorld) {
        inp.consume();
        if (best) this.pet(best);
        else this.sprinkle(lx, ly);
      }
    } else {
      const inScene = scx >= 0 && scy >= 0 && scx < v.sw && scy < v.sh;
      this.glassHover = inScene && !best && !hd && !inp.down ? (this.glassHover || 0) + dt : 0;
      if (this.glassHover > 0.6 && !this.coins.list.length) tip('{mouse_l} Dive into the aquarium');
      if (inp.pressed && inScene) {
        inp.consume();
        this.press = { kind: 'glass', x: inp.x, y: inp.y, collected: got > 0 };
      }
    }
  }

  pokeToy(toy, x, y) {
    this.toyT[toy] = 0.5;
    if (toy === 'lamp' || toy === 'floorlamp') {
      this.lampOn = !this.lampOn;
      this.sfx('click', { vol: 0.5, pitch: this.lampOn ? 1.2 : 0.9 });
    } else {
      this.sfx('puff', { vol: 0.4, pitch: 1.3 });
      this.sceneFx = this.sceneFx || [];
      for (let i = 0; i < 5; i++) this.sceneFx.push({ x: x + rng.float(-6, 6), y: y + rng.float(-6, 2), vx: rng.float(-20, 20), vy: -rng.float(20, 45), t: 0, life: rng.float(0.7, 1.2), c: rng.pick(['#8be04a', '#3fae2a', '#c8f56a']) });
    }
  }

  // Click on a decoration: play its animation, sounds and particles (fish react).
  interact(d) {
    if (typeof d === 'string') d = this.decor.find((q) => q.rec.id === d);
    if (!d) return false;
    playDecor(this, d);
    return true;
  }

  // Dev / debug: send a fish to use a decoration right away.
  useDecor(d) {
    if (typeof d === 'string') d = this.decor.find((q) => q.rec.id === d);
    return d ? forceUse(this, d) : false;
  }

  // Window / mini tank -> full scene, with a zoom of the window filling the screen.
  openFull() {
    const g = this.game;
    const vk = this.visibleKey;
    if (this.zoom) return;
    if (vk !== 'window' && vk !== 'mini') { if (g.mini) g.setMini?.(false); g.setView?.('aquarium'); return; }
    const r = vk === 'mini' ? this.miniRect() : this.windowRect();
    if (!r) { g.setView?.('aquarium'); return; }
    this.press = null;
    this.drag = null;
    this.zoom = { t: 0, dur: 0.5, vk, r: { x: r.x, y: r.y + (vk === 'window' ? this.slideOff() : 0), w: r.w, h: r.h } };
    this.sfx('window_open', { vol: 0.45 });
  }

  updateZoom(dt) {
    const z = this.zoom;
    if (!z) return;
    z.t += dt;
    if (z.t < z.dur) return;
    this.zoom = null;
    const g = this.game;
    if (g.mini) g.setMini?.(false);
    g.setView?.('aquarium');
    this.zoomIn = 0.4;
    this.visibleKey = null; // the full view takes over from the next update
  }

  // Food dropped by a decoration (toaster crumbs, pizza toppings) at a tank-local point.
  dropFood(lx, ly, n = 4, z = 0.4) {
    const T = this.T;
    if (this.food.length > 60) return;
    const cols = ['#e8b46a', '#c8803a', '#f0d090', '#e86a3a', '#8ac04a'];
    for (let i = 0; i < n; i++) {
      const fz = clamp(z - 0.04 + rng.float(-0.03, 0.03), 0.02, 0.9);
      const X = this.fitFloorX(T, T.X(lx + rng.float(-6, 6), fz), fz, 3);
      const Y = clamp(T.Y(ly + rng.float(-3, 3), fz), T.surf + 1, T.groundZ(X, fz) - 2);
      this.food.push({ X, Y, z: fz, vy: rng.float(3, 7), t: 0, c: rng.pick(cols), x: 0, y: 0, eaten: false, wob: rng.float(0, TAU), landed: false });
    }
  }

  chromeButtons(vk, r) {
    if (vk === 'mini') return [{ id: 'restore', x: r.x + r.w - 14, y: r.y + 1, w: 12, h: 8, tip: 'Back to full size (M)', icon: 'expand', tone: 'aqua' }];
    const y = r.y + 2 + this.slideOff();
    return [
      { id: 'close', x: r.x + r.w - 25, y, w: 21, h: 11, tip: 'Close', icon: 'cross', tone: 'red' },
      { id: 'expand', x: r.x + r.w - 44, y, w: 18, h: 11, tip: 'Full-screen aquarium (A)', icon: 'expand', tone: 'aqua' },
    ];
  }

  // Full view: a glossy stats pill at the top with an "Ocean" button beside it.
  fullLayout() {
    const W = this.game.screen.W;
    const pw = 196, bw = 62;
    const px = Math.round(W / 2 - (pw + bw + 6) / 2);
    return { pill: { x: px, y: 6, w: pw, h: 20 }, btn: { x: px + pw + 6, y: 7, w: bw, h: 18 }, unpack: { x: px - 70, y: 7, w: 64, h: 18 } };
  }

  fullButton() { return this.fullLayout().btn; }

  endDrag() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind !== 'decor') return;
    const T = this.T;
    this.layoutDecor();
    const p = { x: T.sx(d.d.X, d.d.z), y: T.floorAt(T.sx(d.d.X, d.d.z), d.d.z) };
    this.particles.burst(p.x, p.y, 10, { colors: ['#ffffff', '#bfeaff', '#c8f56a'], speed: 26, g: 40, life: 0.6, up: 8, flat: 0.4 });
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
    let status = '';
    if (f.state === 'sleep') status = '{zzz}';
    else if ((rec.hunger ?? 0) > 0.62) status = '{food}!';
    const rate = this.fishRate(f);
    return `${rec.name || sp.name}${rec.bred ? ' {sparkle}' : ''}\n${sp.name}\n${hearts} ${status}\n{coin}${rate.toFixed(1)} Aero/min`;
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
      const X = this.fitFloorX(T, T.X(lx + rng.float(-5, 5), z), z, 3);
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
        if (T.round) p.X = this.fitFloorX(T, p.X, p.z, 2);
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
      if (f.use && f.state !== 'script') cleanupFish(f);
      // keep inside the glass (a box, or the round globe) at its depth
      const z = (f.z = clamp(f.z, 0, 0.85));
      const s = T.s(z);
      const m = (7 * f.scale + 3) * s;
      const [x, y, hx, hy] = T.clampSwim(f.x, f.y, z, m);
      f.x = x; f.y = y;
      if (hx && Math.sign(f.vx) === hx) f.vx *= -0.3;
      if (hy && Math.sign(f.vy) === hy) f.vy = 0;
      if (f.target && f.state === 'wander') {
        if (f.target !== f.lastTarget) {
          // a fresh wander target: pick somewhere inside this (maybe small, maybe round) tank
          f.lastTarget = f.target;
          const tz = (f.target.z = Math.pow(rng.next(), 1.35) * 0.82);
          if (T.W < 520 || T.round) f.target.x = lerp(T.left(tz), T.right(tz), rng.float(0.12, 0.88));
          f.target.y = lerp(T.top(tz), T.floorAt(f.target.x, tz), rng.float(0.15, 0.85));
        }
        const tz = clamp(f.target.z ?? z, 0, 0.85);
        const q = T.clampSwim(f.target.x, f.target.y, tz, m);
        f.target.x = q[0]; f.target.y = q[1];
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
      if (rec.coinT >= val && !(this.upgrade && upgradeHidesFish(this, f))) { rec.coinT -= val; this.dropCoin(f, d); }
      if (rec.hunger > 0.62 && rng.chance(dt * 0.04) && !f.emote && f.state !== 'sleep') f.say('food', 1.6);
      else if ((rec.happiness ?? 0) > 0.85 && rng.chance(dt * 0.015) && !f.emote && f.state !== 'sleep') f.say('heart', 1.2);
    }
    // happiness drifts toward a target from hunger, crowding, decor, companions and the tank itself
    this.moodT -= dt;
    if (this.moodT <= 0) {
      const step = 0.5 - this.moodT;
      this.moodT = 0.5;
      const cap = this.capacity();
      const crowd = 1 - clamp01((n / cap - 0.65) / 0.7) * 0.6;
      const decor = clamp01((this.decor.length + this.view.plants.length * 0.25 + this.tier * 0.5) / (1.5 + n * 0.35));
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
          const p = this.floorPoint(T, 0.75, 0.2);
          this.sprinkle(T.sx(p.X, 0.2), T.top(0.2) + 3, 8);
          this.feederFlash = 0.6;
          this.sfx('click', { vol: 0.4 });
        }
      }
    }
    this.feederFlash = Math.max(0, (this.feederFlash || 0) - dt);
  }

  // The snail janitor (any auto-collect level) slurps drops along the waterline.
  updateHelpers(dt) {
    const ac = this.stats.autoCollect || 0;
    if (ac >= 1 && !this.snail) this.snail = new GlassSnail(this);
    if (ac < 1) this.snail = null;
    this.snail?.update(this, dt);
  }

  // stats.autoCollect: drops resting at the surface pop by themselves after a while.
  autoCollect(dt) {
    const ac = Math.min(AUTO_POP.length - 1, Math.max(0, Math.floor(this.stats.autoCollect || 0)));
    if (!ac) return;
    const wait = AUTO_POP[ac];
    this.autoT = (this.autoT || 0) - dt;
    if (this.autoT > 0) return;
    this.autoT = 0.15;
    for (const c of this.coins.list) {
      if (c.hint || c.rest < wait) continue;
      this.collectCoin(c, 'auto');
      break;
    }
  }

  updateEggs(dt) {
    const eggs = this.st.tank.eggs;
    for (let i = eggs.length - 1; i >= 0; i--) {
      const e = eggs[i];
      e.t += dt;
      if (e.t >= e.dur) { eggs.splice(i, 1); this.hatch(e); }
    }
  }

  updateBubbles(dt) {
    const T = this.T, v = this.view;
    if (this.visibleKey) {
      this.bubT = (this.bubT || 0) - dt;
      while (this.bubT < 0) {
        this.bubT += 1 / v.cfg.bubbles * (v.stone ? 1 : 3);
        const st = v.stone || this.floorPoint(T, rng.float(0.2, 0.8), rng.float(0.1, 0.7));
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
    this.drawScene(ctx, 0, 0);
    // the tail of the zoom-in from the window: a bright flash settling
    if (this.zoomIn > 0) {
      ctx.fillStyle = rgba('#e8fbff', (this.zoomIn / 0.4) * 0.5);
      ctx.fillRect(0, 0, this.view.sw, this.view.sh);
    }
    this.drawHud(ctx);
  }

  drawWindow(ctx, dt) {
    if (this.visibleKey !== 'window' || this.view?.key !== 'window') return;
    if (this.zoom) { this.drawZoom(ctx); return; }
    const r = this.windowRect();
    if (!r) return; // closed / switched view since the last update
    const off = this.slideOff();
    const a = clamp01(this.winAnim * 1.6);
    if (a < 1) ctx.globalAlpha = a;
    this.drawFramed(ctx, 'window', { x: r.x, y: r.y + off, w: r.w, h: r.h });
    ctx.globalAlpha = 1;
  }

  drawMini(ctx, dt) {
    if (this.view?.key !== 'mini') return;
    if (this.zoom) { this.drawZoom(ctx); return; }
    this.drawFramed(ctx, 'mini', this.miniRect());
  }

  // Aero glass window frame + the scene inside it.
  drawFramed(ctx, vk, r) {
    const f = FRAME[vk];
    // soft drop shadow on the desktop
    ctx.fillStyle = 'rgba(6,40,80,0.22)';
    ctx.fillRect(r.x + 4, r.y + r.h, r.w - 4, 3);
    ctx.fillRect(r.x + r.w, r.y + 6, 3, r.h - 3);
    ctx.fillStyle = 'rgba(6,40,80,0.12)';
    ctx.fillRect(r.x + 6, r.y + r.h + 3, r.w - 6, 2);
    drawAeroSurface(ctx, r.x, r.y, r.w, r.h, { tone: 'sky', r: vk === 'mini' ? 5 : 7, gloss: 0.7, glossH: f.lid + 1, curve: 2, rim: 0.85, glow: 0.6, streak: vk === 'window' });
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + f.side, r.y + f.lid, r.w - f.side * 2, r.h - f.lid - f.base);
    ctx.clip();
    this.drawScene(ctx, r.x + f.side, r.y + f.lid);
    ctx.restore();
    // inner glass edge around the scene
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(r.x + f.side - 1, r.y + f.lid - 1, r.w - f.side * 2 + 2, 1);
    ctx.fillStyle = 'rgba(10,70,130,0.45)';
    ctx.fillRect(r.x + f.side - 1, r.y + r.h - f.base, r.w - f.side * 2 + 2, 1);
    this.drawChrome(ctx, vk, r);
  }

  // Title, buttons and the stats bar of the window / mini frames.
  drawChrome(ctx, vk, r) {
    const sm = this.tankSummary();
    for (const b of this.chromeButtons(vk, { ...r, y: r.y - (vk === 'window' ? this.slideOff() : 0) })) {
      const hov = this.hoverBtn === b.id;
      drawAeroButton(ctx, b.x, b.y, b.w, b.h, { tone: b.tone, state: hov ? 'hover' : 'normal', radius: 4 });
      const ic = getUiIcon(b.icon);
      if (ic && b.h >= 8) {
        const k = b.h < 10 ? 0 : 0;
        ctx.drawImage(ic, Math.round(b.x + (b.w - ic.width) / 2), Math.round(b.y + (b.h - ic.height) / 2) + k);
      }
    }
    if (vk === 'mini') return;
    const f = FRAME.window;
    // title: a little drop icon and the tank's name
    drawAeroCoin(ctx, r.x + 11, r.y + 8, 3.5, this.t);
    drawText(ctx, this.tierInfo().name, r.x + 18, r.y + 4, { color: '#ffffff', shadow: '#0a3e74' });
    // stats bar along the bottom
    const by = r.y + r.h - f.base + 3;
    let x = r.x + 7;
    const fi = getUiIcon('fish');
    if (fi) { ctx.drawImage(fi, x, by - 1); x += fi.width + 2; }
    drawText(ctx, `${sm.fish}/${sm.cap}`, x, by + 1, { color: '#ffffff', shadow: '#0a3e74' });
    x += measureText(`${sm.fish}/${sm.cap}`) + 8;
    const hi = getUiIcon('heart');
    if (hi && sm.fish) { ctx.drawImage(hi, x, by - 1); x += hi.width + 2; drawText(ctx, `${Math.round(sm.happiness * 100)}%`, x, by + 1, { color: '#ffffff', shadow: '#0a3e74' }); }
    const rt = `${sm.aeroPerMin.toFixed(1)}/min`;
    const rw = measureText(rt);
    drawText(ctx, rt, r.x + r.w - 7 - rw, by + 1, { color: '#ffffff', shadow: '#0a3e74' });
    drawAeroCoin(ctx, r.x + r.w - 13 - rw, by + 4, 3.5, this.t);
    if (this.stats.feeder && this.feederFlash > 0) drawSparkle(ctx, r.x + r.w / 2, by + 3, 2, this.feederFlash / 0.6);
  }

  // Full view: the stats pill and the Ocean button.
  drawHud(ctx) {
    const sm = this.tankSummary();
    const { pill: p, btn: b, unpack: u } = this.fullLayout();
    const nStored = this.st.tank.stored.length;
    if (nStored) drawAeroButton(ctx, u.x, u.y, u.w, u.h, { label: `+${nStored}`, icon: getUiIcon('tank'), state: this.hoverBtn === 'unpack' ? 'hover' : 'normal', tone: 'green' });
    drawAeroSurface(ctx, p.x, p.y, p.w, p.h, { tone: 'frost', r: 'pill', gloss: 0.75, glossH: 9, curve: 2, rim: 0.9, glow: 0.5 });
    const ink = AERO.ink;
    let x = p.x + 10;
    const ty = p.y + 7;
    const fi = getUiIcon('fish');
    if (fi) { ctx.drawImage(fi, x, p.y + 5); x += fi.width + 3; }
    const fs = `${sm.fish}/${sm.cap}`;
    drawText(ctx, fs, x, ty, { color: ink });
    x += measureText(fs) + 10;
    const hi = getUiIcon('heart');
    if (hi) { ctx.drawImage(hi, x, p.y + 5); x += hi.width + 3; }
    const hs = sm.fish ? `${Math.round(sm.happiness * 100)}%` : '--';
    drawText(ctx, hs, x, ty, { color: ink });
    x += measureText(hs) + 10;
    drawAeroCoin(ctx, x + 4, p.y + 10, 4.5, this.t);
    x += 12;
    drawText(ctx, `${sm.aeroPerMin.toFixed(1)}/min`, x, ty, { color: ink });
    drawAeroButton(ctx, b.x, b.y, b.w, b.h, { label: 'Ocean', icon: getUiIcon('arrow_l'), state: this.hoverBtn === 'back' ? 'hover' : 'normal', tone: 'aqua' });
  }

  // Zoom transition: the whole window (frame + scene) rendered off-screen, then scaled so its scene
  // grows from the window to the full screen, fading into a bright flash.
  drawZoom(ctx) {
    const z = this.zoom, v = this.view, f = FRAME[z.vk], r = z.r;
    let cv = this.zoomCv;
    if (!cv || cv.width !== r.w || cv.height !== r.h) cv = this.zoomCv = makeCanvas(r.w, r.h);
    const zg = ctxOf(cv);
    zg.clearRect(0, 0, r.w, r.h);
    this.drawFramed(zg, z.vk, { x: 0, y: 0, w: r.w, h: r.h });
    const k = ease.inOutCubic(clamp01(z.t / z.dur));
    const { W, H } = this.game.screen;
    const fh = H - TASKBAR_H;
    const sx = lerp(1, W / v.sw, k), sy = lerp(1, fh / v.sh, k);
    const ix = lerp(r.x + f.side, 0, k), iy = lerp(r.y + f.lid, 0, k);
    ctx.fillStyle = rgba('#0a3060', 0.2 * k);
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(cv, Math.round(ix - f.side * sx), Math.round(iy - f.lid * sy), Math.round(r.w * sx), Math.round(r.h * sy));
    if (k > 0.55) {
      ctx.fillStyle = rgba('#e8fbff', ((k - 0.55) / 0.45) * 0.5);
      ctx.fillRect(Math.round(ix), Math.round(iy), Math.round(v.sw * sx), Math.round(v.sh * sy));
    }
  }

  // The room, the tank and its glass shell at scene origin (sx, sy).
  drawScene(ctx, sx, sy) {
    const v = this.view, L = v.L, T = v.T;
    const art = roomArt(L);
    const sh = shellArt(L, T.ell);
    const t = this.t;
    const clock = this.game.clock;
    const night = clock ? clamp01(1 - clock.daylight()) : 0;
    sx = Math.round(sx); sy = Math.round(sy);
    drawRoomBack(ctx, art, sx, sy, t, this.par);
    if (night > 0.02) {
      // evening: the room dims to a cool blue (the lamp and the tank glow on top)
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = mix('#ffffff', '#4a5ca8', night * 0.6);
      ctx.fillRect(sx, sy, v.sw, v.sh);
      ctx.globalCompositeOperation = 'source-over';
    }
    const up = this.upgrade;
    const gs = up ? upgradeScale(this) : 1;
    if (gs !== 1) {
      // the new tank pops in: scale about the bottom centre of the glass
      const cx = sx + L.tank.x + L.tank.w / 2, cy = sy + L.tank.y + L.tank.h + (L.base || 0);
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(gs, gs); ctx.translate(-cx, -cy);
    }
    if (sh.under) ctx.drawImage(sh.under.canvas, sx + sh.under.x, sy + sh.under.y);
    if (up) drawUpgradeBack(this, ctx, sx, sy);
    if (sh.back) ctx.drawImage(sh.back.canvas, sx + sh.back.x, sy + sh.back.y);
    this.drawTank(ctx, sx + L.tank.x, sy + L.tank.y);
    ctx.drawImage(sh.front.canvas, sx + sh.front.x, sy + sh.front.y);
    if (sh.switch) this.drawLampParts(ctx, sx, sy, sh);
    if (this.stats.feeder) this.drawFeeder(ctx, sx, sy);
    if (gs !== 1) ctx.restore();
    drawRoomFront(ctx, art, sx, sy, t, this.par, this.lampOn, night);
    this.room.draw(ctx, art, sx, sy);
    if (up) drawUpgradeFront(this, ctx, sx, sy);
    this.drawSceneFx(ctx, sx, sy);
  }

  // Aqua Lamp: the blue light strip under the hood and the black rocker switch (on = '|' side down).
  drawLampParts(ctx, sx, sy, sh) {
    const on = !this.st.tank.lampOff;
    const L = this.view.L, u = L.u;
    const hd = sh.hood;
    const ly = Math.round(sy + L.tank.y);
    if (on) {
      const fl = 0.85 + 0.15 * Math.sin(this.t * 3.1) * Math.sin(this.t * 1.3);
      ctx.fillStyle = rgba('#7fd0ff', 0.95 * fl);
      ctx.fillRect(Math.round(sx + L.tank.x + 2), ly, L.tank.w - 4, Math.max(1, Math.round(1.5 * u)));
      ctx.globalCompositeOperation = 'lighter';
      drawAeroGlow(ctx, sx + L.tank.x + L.tank.w * 0.3, ly, L.tank.w * 0.22, '#5ab4ff', 0.35 * fl);
      drawAeroGlow(ctx, sx + L.tank.x + L.tank.w * 0.7, ly, L.tank.w * 0.22, '#5ab4ff', 0.35 * fl);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.fillStyle = 'rgba(40,60,90,0.8)';
      ctx.fillRect(Math.round(sx + L.tank.x + 2), ly, L.tank.w - 4, Math.max(1, Math.round(1.5 * u)));
    }
    void hd;
    const s = sh.switch;
    const x = Math.round(sx + s.x), y = Math.round(sy + s.y), w = s.w, h = s.h;
    const hov = this.hoverBtn === 'lampswitch';
    ctx.fillStyle = '#0c1016';
    ctx.fillRect(x, y, w, h);
    const half = Math.floor(w / 2);
    // rocker: the pressed half sits low and dark, the raised half catches the light
    ctx.fillStyle = on ? '#1c222c' : '#3a4452';
    ctx.fillRect(x + 1, y + 1, half - 1, h - 2);
    ctx.fillStyle = on ? '#3a4452' : '#1c222c';
    ctx.fillRect(x + half, y + 1, w - half - 1, h - 2);
    ctx.fillStyle = on ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(on ? x + half : x + 1, y + 1, on ? w - half - 1 : half - 1, 1);
    ctx.fillStyle = '#e8eef4';
    const mh = Math.max(2, Math.round(h * 0.4));
    ctx.fillRect(x + Math.round(half / 2), y + Math.round((h - mh) / 2), 1, mh);                  // '|'
    const ox = x + half + Math.round((w - half) / 2) - 1, oy = y + Math.round(h / 2) - 1;
    ctx.fillRect(ox, oy - 1, 2, 1); ctx.fillRect(ox, oy + 2, 2, 1); ctx.fillRect(ox - 1, oy, 1, 2); ctx.fillRect(ox + 2, oy, 1, 2); // 'o'
    if (hov) { ctx.fillStyle = 'rgba(191,246,255,0.5)'; ctx.fillRect(x - 1, y - 1, w + 2, 1); ctx.fillRect(x - 1, y + h, w + 2, 1); }
  }

  // Auto-feeder: a glossy little hopper clipped to the rim.
  drawFeeder(ctx, sx, sy) {
    const L = this.view.L, k = this.view.key === 'mini' ? 0.6 : this.view.key === 'window' ? 0.8 : 1;
    const x = Math.round(sx + L.tank.x + L.tank.w * 0.74), y = Math.round(sy + L.tank.y - (L.lid || 0) - 7 * k);
    const w = Math.round(12 * k), h = Math.round(9 * k);
    drawAeroSurface(ctx, x, y, w, h, { tone: this.feederFlash > 0 ? 'orange' : 'green', r: 3, gloss: 0.8, glossH: Math.ceil(h * 0.45), rim: 0.7, glow: 0.5 });
  }

  drawSceneFx(ctx, sx, sy) {
    const fx = this.sceneFx;
    if (!fx?.length) return;
    let w = 0;
    for (const p of fx) {
      p.t += 1 / 60;
      if (p.t > p.life) continue;
      p.vy += 60 / 60; p.x += p.vx / 60; p.y += p.vy / 60;
      ctx.globalAlpha = clamp01((p.life - p.t) * 3);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(sx + p.x), Math.round(sy + p.y), 2, 1);
      fx[w++] = p;
    }
    fx.length = w;
    ctx.globalAlpha = 1;
  }

  // Clip to the inside of the glass (round globe cut by its opening; box rect), above the fill level.
  clipGlass(ctx, v) {
    const T = v.T;
    const top = this.upgrade ? Math.round(lerp(v.ih, 0, upgradeFill(this))) : 0;
    ctx.beginPath();
    ctx.rect(0, top, v.iw, v.ih - top);
    ctx.clip();
    if (T.round) {
      const e = T.ell;
      ctx.beginPath();
      ctx.ellipse(e.cx, e.cy, e.rx + 0.5, e.ry + 0.5, 0, 0, TAU);
      ctx.clip();
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
    beginVoxelFishFrame();
    ctx.save();
    ctx.translate(ox, oy);
    this.clipGlass(ctx, v);
    ctx.drawImage(art.backdrop, 0, 0);
    this.drawPanorama(ctx, v, art, night);
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
    const fogA = (v.cfg.slabs === 2 ? 0.16 : 0.115) * (T.round ? 0.6 : 1);
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
    if (this.snail) this.snail.draw(ctx, this);
    this.particles.draw(ctx, 'fg', t);
    this.drawEmotes(ctx);
    // a bobbing arrow points at the tutorial drop
    for (const c of this.coins.list) {
      if (!c.hint) continue;
      const p = this.toLocal(c.X, c.Y, c.D);
      const a = getUiIcon('arrow_d');
      if (a) ctx.drawImage(a, Math.round(p.x - a.width / 2), Math.round(p.y - c.vr - 6 - a.height + Math.sin(t * 7) * 2));
      if (rng.chance(0.08)) this.particles.sparkle(p.x + rng.float(-3, 3), p.y + rng.float(-3, 3), '#bff8ff');
    }

    // ---- lighting: night (moonlight blue), dusk (warm), glowing decor
    if (night > 0.02 || dusk > 0.05) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = mix(mix('#ffffff', '#ffd2a8', dusk * 0.35), '#3a4c90', night * 0.55);
      ctx.fillRect(0, 0, v.iw, v.ih);
      ctx.globalCompositeOperation = 'lighter';
      if (night > 0.2) {
        ctx.globalAlpha = night * 0.85;
        for (const d of this.decor) {
          const q = d.drawP;
          if (q?.glow) ctx.drawImage(q.glow, d.drawX, d.drawY, d.drawW, d.drawH);
          if (d.drawPart?.c.glow) ctx.drawImage(d.drawPart.c.glow, d.drawPart.x, d.drawPart.y);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // the Aqua Lamp: blue light from the hood when on, a dim tank when off
    if (v.L.shape === 'lamp') {
      if (this.st.tank.lampOff) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = '#5a6a94';
        ctx.fillRect(0, 0, v.iw, v.ih);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(lampGlow(v.ih), 0, 0, v.iw, Math.round(v.ih * 0.45));
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // hood light pooling just under the lid (box tanks)
    if (!T.round) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(night > 0.5 ? '#6a8aff' : v.L.id === 'reeftank' ? '#9ad0ff' : '#e8fff8', 0.12);
      ctx.fillRect(0, 0, v.iw, Math.max(2, T.surf + 2));
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(art.glass, 0, 0);
    }
    // glitter running along the waterline
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    let gx0 = 0, gx1 = v.iw;
    if (T.round) { const [a, b] = T.span(T.surf, 0, 2); gx0 = T.sx(a, 0); gx1 = T.sx(b, 0); }
    const gw = gx1 - gx0;
    for (let i = 0; i < Math.ceil(gw / 50); i++) {
      const x = gx0 + ((i * 97.3 + t * (i % 2 ? 14 : -11)) % gw + gw) % gw;
      if (Math.sin(t * 2 + i) > 0.2) ctx.fillRect(Math.round(x), T.surf, 2 + (i % 3), 1);
    }
    // the popping magnet ring around the cursor
    if (this.world.cursor.inWorld && this.coins.list.length && !this.drag && v.key !== 'mini') {
      const c = this.world.cursor;
      const rad = (this.stats.collectRadius || 14) * 0.6 + 3;
      ctx.fillStyle = 'rgba(200,250,255,0.45)';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + t * 0.8;
        ctx.fillRect(Math.round(c.x + Math.cos(a) * rad), Math.round(c.y + Math.sin(a) * rad), 1, 1);
      }
    }
    ctx.restore();
  }

  // Voxel reef behind the fish: a coral diorama on the back glass, or (Aqua Lamp) the rotating voxel reef
  // drum; the floor is drawn again on top so the reef stands behind it.
  drawPanorama(ctx, v, art, night) {
    const b = art.back, T = v.T;
    if (b.x1 <= b.x0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.clip();
    if (art.dio) ctx.drawImage(art.dio.canvas, Math.round(b.x0), Math.round(b.y1 - art.dio.h));
    else if (v.drum) {
      const q = v.drum.get(this.reefOff * 1.2);
      if (q) {
        const cx = Math.round((b.x0 + b.x1) / 2), by = Math.round(b.y1 + 2);
        ctx.drawImage(q.a.canvas, cx - q.a.ax, by - q.a.by);
        if (q.b && q.k > 0.02) { ctx.globalAlpha = q.k; ctx.drawImage(q.b.canvas, cx - q.b.ax, by - q.b.by); ctx.globalAlpha = 1; }
      }
    }
    // water between the glass and the reef: depth haze, darker toward the top
    ctx.fillStyle = rgba(T.water[8], T.round ? 0.3 : 0.2);
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.restore();
    ctx.drawImage(art.floor, 0, 0);
    void night;
  }

  // A small school of real voxel fish drifting slowly across the back of the tank (not interactive).
  updateBgFish(dt) {
    const T = this.T, v = this.view;
    if (!this.bgFish) {
      this.bgFish = [];
      const pool = SPECIES.filter((s) => s.look && s.look.kind !== 'chain' && !(s.quirks || []).includes('intro') && (s.move?.style ?? 'swim') === 'swim' && !s.spawn?.never && (s.rarity === 'common' || s.rarity === 'uncommon'));
      const r = new RNG(77);
      for (let i = 0; i < 8 && pool.length; i++) {
        const sp = pool[r.int(0, pool.length - 1)];
        try {
          const rec = rollIndividual(sp, { mutationChance: 0, shinyChance: 0 });
          const f = new Fish(rec, sp, this.world, { z: 0.96 });
          f.baseScale = f.scale;
          f.bg = { u: r.next(), yk: r.float(0.12, 0.62), sp: r.float(0.012, 0.024) * (r.chance(0.5) ? 1 : -1), ph: r.float(0, TAU) };
          this.bgFish.push(f);
        } catch { /* species without a voxel look */ }
      }
    }
    const n = Math.min(this.bgFish.length, [2, 3, 3, 4, 5, 6][this.tier] ?? 3);
    this.bgN = n;
    const z = T.round ? 0.88 : 0.97;
    for (let i = 0; i < n; i++) {
      const f = this.bgFish[i], b = f.bg;
      b.u += b.sp * dt * (520 / Math.max(200, T.W));
      if (b.u > 1.15) b.u = -0.15; else if (b.u < -0.15) b.u = 1.15;
      b.ph += dt;
      const L = T.left(z), R = T.right(z);
      f.z = z;
      f.scale = f.baseScale * v.fishScale * 0.55;
      f.x = lerp(L - 20 * f.scale, R + 20 * f.scale, b.u);
      f.y = lerp(T.top(z) + 8, T.floorAt(clamp(f.x, 0, T.W - 1), z) - 10, b.yk) + Math.sin(b.ph * 0.7) * 3;
      f.facing = b.sp > 0 ? 1 : -1; f.turn = f.facing; f.vx = b.sp * 400; f.vz = 0; f.angle = Math.sin(b.ph * 0.7) * 0.06;
      f.tailPhase = ((f.tailPhase || 0) + dt * 1.1) % 1; f.swimPhase = f.tailPhase; f.finPhase = f.tailPhase;
      f.speed01 = 0.4; f.emotion = 'happy'; f.age = (f.age || 0) + dt;
    }
  }

  // Soft contact shadows on the floor under fish (fainter the higher they swim).
  drawShadows(ctx, v) {
    const T = this.T;
    for (const f of this.fish) {
      if (this.upgrade && upgradeHidesFish(this, f)) continue;
      const s = T.s(f.z);
      const fl = T.floorAt(f.x, f.z);
      const hgt = fl - f.y;
      const k = clamp01(1 - hgt / (T.floorFront * 0.55));
      if (k <= 0.05) continue;
      const rx = Math.max(2, Math.round((14 + 8 * k) * f.scale * s)), ry = Math.max(1, Math.round(rx * 0.28));
      ctx.globalAlpha = 0.2 * k * (1 - f.z * 0.4);
      ctx.drawImage(shadowSprite(rx, ry), Math.round(f.x - rx), Math.round(fl - ry));
    }
    ctx.globalAlpha = 1;
    void v;
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
    for (const d of this.decor) {
      push(d.z, 'decor', d);
      if (d.user?.front && d.drawP?.front) push(d.z - 0.008, 'decorFront', d);
    }
    for (const p of this.view.plants) push(p.z, 'plant', p);
    const up = this.upgrade;
    for (const f of this.fish) {
      if (up && upgradeHidesFish(this, f)) continue;
      let z = f.z;
      if (f.useZ != null) z = f.useZ;
      else if (f.hideInDecor && f.state === 'decor' && f.decorSpot) z = f.decorSpot.z + 0.015;
      push(z, 'fish', f, f.y);
    }
    for (const c of this.coins.list) push(c.D / T.DEPTH - 0.002, 'coin', c, c.Y);
    for (const p of this.food) push(p.z, 'food', p);
    for (const e of this.st.tank.eggs) push(e.z, 'egg', e);
    if (this.view.stone) push(this.view.stone.z, 'stone', this.view.stone);
    for (let i = 0; i < (this.bgN || 0); i++) push(this.bgFish[i].z + 0.02, 'bgfish', this.bgFish[i], this.bgFish[i].y);
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
        // current animation frame (pre-rendered), squash on click, flying part (rocket)
        const ds = decorDrawState(this, o, p, Math.abs(sc - 1) < 0.01 ? 1 : sc);
        const q = ds.p;
        const bx = T.sx(o.X, o.z) + ds.ox, by = T.sy(T.groundZ(o.X, o.z), o.z) - (this.drag?.d === o ? 4 : 0);
        const kx = sc * ds.sx, ky = sc * ds.sy;
        const x = Math.round(bx - q.ox * kx), y = Math.round(by - q.oy * ky);
        const w = Math.round(q.canvas.width * kx), h = Math.round(q.canvas.height * ky);
        o.drawP = q; o.drawK = sc; o.drawX = x; o.drawY = y; o.drawW = w; o.drawH = h; o.drawPart = null;
        this.grow(x, y, x + w, y + h);
        if (kx === 1 && ky === 1) g.drawImage(q.canvas, x, y);
        else g.drawImage(q.canvas, x, y, w, h);
        if (ds.part) {
          const py = Math.round(y + ds.dy);
          g.drawImage(ds.part.canvas, x, py);
          this.grow(x, py, x + ds.part.canvas.width, py + ds.part.canvas.height);
          o.drawPart = { c: ds.part, x, y: py };
        }
        if (this.hoverDecor === o && !this.drag) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.18 + 0.08 * Math.sin(this.t * 6);
          g.drawImage(tinted(q.canvas, '#e8fbff'), x, y, w, h);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case 'decorFront': {
        // front walls of a tub redrawn over the fish soaking in it
        const fc = o.drawP?.front;
        if (fc) g.drawImage(fc, o.drawX, o.drawY, o.drawW, o.drawH);
        break;
      }
      case 'plant': {
        if (!o.vp) o.vp = voxPlant(o.kind, o.h * T.s(o.z), o.seed);
        // ping-pong through the sway frames for a smooth back-and-forth
        const k = ((this.t / 4.5 + o.ph) % 1) * (PLANT_FRAMES * 2 - 2);
        const i = Math.floor(k < PLANT_FRAMES ? k : PLANT_FRAMES * 2 - 2 - k);
        const fr = plantFrame(o.vp, Math.min(PLANT_FRAMES - 1, i));
        if (!fr) break;
        const px = Math.round(T.sx(o.X, o.z) - fr.ax), py = Math.round(T.sy(T.groundZ(o.X, o.z), o.z) - fr.ay + 1);
        g.drawImage(fr.canvas, px, py);
        this.grow(px, py, px + fr.canvas.width, py + fr.canvas.height);
        break;
      }
      case 'fish': {
        let alpha = o.alpha ?? 1;
        if (o.rec.variant?.mutation === 'ghost') alpha *= 0.65;
        const a = drawVoxelFish(g, o, { scale: o.scale * T.s(o.z), glow: this.world.glowLevel + (o.c.glow ? 0.35 : 0), alpha });
        o.anchors = a;
        const aw = a?.w ?? 30 * o.scale, ah = a?.h ?? 20 * o.scale;
        this.grow(o.x - aw * 0.6 - 4, o.y - ah * 0.6 - 4, o.x + aw * 0.6 + 4, o.y + ah * 0.6 + 4);
        if (o.rec.variant?.shiny && rng.chance(0.05)) this.particles.sparkle(o.x + rng.float(-8, 8) * o.scale, o.y + rng.float(-5, 5) * o.scale, '#fff6b0');
        break;
      }
      case 'bgfish': {
        const a = drawVoxelFish(g, o, { scale: o.scale * T.s(o.z), glow: 0, alpha: 1 });
        const aw = a?.w ?? 30 * o.scale, ah = a?.h ?? 20 * o.scale;
        this.grow(o.x - aw * 0.6 - 2, o.y - ah * 0.6 - 2, o.x + aw * 0.6 + 2, o.y + ah * 0.6 + 2);
        break;
      }
      case 'coin': {
        // an Aero drop in a soap-bubble skin; it wobbles while rising and bobs at the surface
        const z = o.D / T.DEPTH, s = T.s(z);
        const r = Math.max(2.5, o.r * s);
        const x = T.sx(o.X, z), y = T.sy(o.Y, z);
        const wob = o.sleep ? 0 : Math.sin(o.ph * 1.7) * 0.4;
        drawAeroBubble(g, x, y, r + 1.5 + wob, o.hint ? 0.95 : 0.75);
        drawAeroCoin(g, x, y, r, this.t + o.id * 0.37);
        if (o.d === 2 || o.hint) drawAeroGlow(g, x, y, r * 2.4, '#bff8ff', 0.18 + 0.08 * Math.sin(this.t * 3 + o.id));
        this.grow(x - r * 2.5, y - r * 2.5, x + r * 2.5, y + r * 2.5);
        break;
      }
      case 'food': {
        const s = T.s(o.z);
        g.fillStyle = o.c;
        g.fillRect(Math.round(o.x), Math.round(o.y), s > 0.8 ? 2 : 1, 1);
        this.grow(o.x - 1, o.y - 1, o.x + 3, o.y + 3);
        if (s > 0.7) { g.fillStyle = 'rgba(40,16,8,0.5)'; g.fillRect(Math.round(o.x), Math.round(o.y) + 1, 2, 1); }
        break;
      }
      case 'egg': {
        const X = this.fitFloorX(T, o.x * T.W, o.z, 6);
        drawEggs(g, this, { X, z: o.z, t: o.t, dur: o.dur, n: o.n, color: o.color });
        { const ex = T.sx(X, o.z), ey = T.floorAt(ex, o.z); this.grow(ex - 12, ey - 12, ex + 12, ey + 4); }
        break;
      }
      case 'stone': {
        // bubbler: a clear airline down the back into a glossy aqua air stone
        const s = T.s(o.z), x = Math.round(T.sx(o.X, o.z)), y = Math.round(T.sy(T.groundZ(o.X, o.z), o.z));
        const top = Math.round(T.top(o.z)) - 2;
        g.fillStyle = 'rgba(220,250,255,0.4)';
        g.fillRect(x - 1, top, 1, y - top);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x, top, 1, y - top);
        const st = airStone(Math.max(2, Math.round(5 * s * this.view.fishScale)));
        g.drawImage(st.canvas, x - st.ax, y - st.ay + 1);
        this.grow(x - st.canvas.width, top - 1, x + st.canvas.width, y + 4);
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
    const sc = Math.max(v.iw, 400) / 960;
    ctx.save();
    ctx.beginPath();
    for (const poly of [art.floorPoly, art.ceilPoly]) {
      if (!poly) continue;
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
    }
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const a = 0.26 * (1 - night * 0.7);
    const fy0 = art.floorTopY, fy1 = T.floorFront;
    // bands: far floor (small, faint), near floor (large), ceiling
    const bands = [[fy0, lerp(fy0, fy1, 0.4), 1, 0.45, a * 0.6], [lerp(fy0, fy1, 0.4), fy1 + 2, 1.5, 0.7, a]];
    if (art.ceilPoly) bands.push([T.surf, T.top(1) + 1, 2, 0.7, a * 0.16]);
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
    const spr = tinted(shaftSprite(), night > 0.5 ? '#8ab0ff' : '#fffbe8');
    ctx.globalCompositeOperation = 'lighter';
    for (const s of v.shafts) {
      if (s.z < z0 || s.z >= z1) continue;
      const sc = T.s(s.z);
      const X = s.X + Math.sin(this.t * 0.13 + s.ph) * v.iw * 0.02;
      const w = Math.max(3, Math.round(s.w * sc));
      const x = Math.round(T.sx(X, s.z) - w / 2), y0 = Math.round(T.top(s.z));
      const y1 = Math.round(T.floorAt(x + w / 2, s.z));
      ctx.globalAlpha = clamp01(s.a * (0.65 + 0.35 * Math.sin(this.t * 0.6 + s.ph)) * (1 - night * 0.6) * (z0 === 0 ? 0.6 : 1));
      // pre-scaled once per size (scaled additive blits are slow without a GPU)
      const hh = Math.max(4, Math.round((y1 - y0) / 4) * 4);
      ctx.drawImage(scaledShaft(spr, w, hh), x, y0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawEmotes(ctx) {
    const T = this.T;
    for (const f of this.fish) {
      if (!f.emote || (this.upgrade && upgradeHidesFish(this, f))) continue;
      const top = f.anchors?.top || [f.x, f.y - 10 * f.scale];
      const k = f.emote.t / f.emote.max;
      const name = EMOTE_ICON[f.emote.icon] || f.emote.icon;
      const y = Math.round(top[1] - 4 - Math.min(1, f.emote.t * 6) * 3 * T.s(f.z));
      ctx.globalAlpha = Math.min(1, (1 - k) * 4) * (1 - f.z * 0.4);
      if (name === 'dollar' || name === 'coin') drawAeroCoin(ctx, top[0], y - 5, 4, this.t);
      else if (ICONS.has(name)) {
        const ic = getUiIcon(name);
        ctx.drawImage(ic, Math.round(top[0] - ic.width / 2), y - ic.height);
      } else drawText(ctx, f.emote.icon, top[0], y - 8, { align: 'center', color: '#ffffff', outline: '#0c3a52' });
      ctx.globalAlpha = 1;
    }
    if (this.hoverFish && this.view.key !== 'mini') {
      const f = this.hoverFish;
      const s = T.s(f.z), r = Math.round((12 * f.scale + 4) * s);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + this.t * 2;
        drawSparkle(ctx, f.x + Math.cos(a) * r, f.y + Math.sin(a) * r * 0.7, 1, 0.8);
      }
    }
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

// Voxel air stone (a glossy aqua glass puck with a white cap), cached per size.
const stoneCache = new Map();
function airStone(r) {
  let c = stoneCache.get(r);
  if (c) return c;
  const n = r * 2 + 4, h = Math.max(3, Math.round(r * 1.2)) + 3;
  const m = new VoxelModel(n, h, n);
  const glass = m.color('#5fd6e8', { spec: 1.4, smooth: 0.6 }), pore = m.color('#2fa7c0', { jitter: 0.1 });
  const cap = m.color('#f4fbff', { spec: 1.3 }), tube = m.color('#e8fbff', { jitter: 0 });
  const cx = n / 2;
  for (let y = 0; y < h - 3; y++) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cx);
    if (d > r + (y === 0 ? -0.3 : 0)) continue;
    m.set(x, y, z, ((x * 7 + y * 3 + z * 5) % 7 === 0) ? pore : glass);
  }
  m.set(Math.floor(cx), h - 3, Math.floor(cx), cap);
  m.set(Math.floor(cx), h - 2, Math.floor(cx), cap);
  m.set(Math.floor(cx), h - 1, Math.floor(cx), tube);
  const rr = renderVoxels(m, { scale: 2, yaw: 30, pitch: 22, groundAO: true, edges: 0.6 });
  const [ax, ay] = rr.project(cx, 0, cx);
  c = { canvas: rr.canvas, ax: Math.round(ax), ay: Math.round(ay) };
  stoneCache.set(r, c);
  return c;
}

const shaftCache = new Map();
function scaledShaft(spr, w, h) {
  const key = w + 'x' + h + (spr.width === 24 ? '' : 'n');
  let c = shaftCache.get(spr)?.get(key);
  if (c) return c;
  let m = shaftCache.get(spr);
  if (!m) shaftCache.set(spr, (m = new Map()));
  c = makeCanvas(w, h);
  const g = ctxOf(c);
  g.imageSmoothingEnabled = true;
  g.drawImage(spr, 0, 0, w, h);
  m.set(key, c);
  if (m.size > 80) m.delete(m.keys().next().value);
  return c;
}

// Vertical blue glow from the lamp hood (additive), 1 px wide, stretched across the tank.
let lampGlowCv = null;
function lampGlow(h) {
  if (lampGlowCv) return lampGlowCv;
  const n = 64;
  lampGlowCv = makeCanvas(1, n);
  const g = ctxOf(lampGlowCv);
  for (let y = 0; y < n; y++) {
    const k = Math.pow(1 - y / n, 2.2);
    g.fillStyle = `rgba(70,150,255,${(k * 0.45).toFixed(3)})`;
    g.fillRect(0, y, 1, 1);
  }
  void h;
  return lampGlowCv;
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
    g.fillStyle = d < 0.45 ? 'rgba(20,50,80,1)' : (x + y) % 2 ? 'rgba(20,50,80,0.6)' : 'rgba(0,0,0,0)';
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
    g.fillStyle = d > r - 0.8 ? 'rgba(230,252,255,0.85)' : 'rgba(180,240,255,0.16)';
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillRect(Math.max(0, r - Math.ceil(r / 2)), Math.max(0, r - Math.ceil(r / 2)), 1, 1);
  bubbleCache.set(r, c);
  return c;
}
