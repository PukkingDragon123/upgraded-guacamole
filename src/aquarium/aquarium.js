// The aquarium (phase 10: YOUR TANK IS 2D SIDE-SCROLLING, LIKE THE OCEAN, AND YOU CAN ONLY BUILD IN IT).
// A side view into a big glass tank in a Frutiger Aero room (scene2d.js, voxel art in tankart.js): front glass edges,
// a voxel substrate in three depth planes (front / mid / back), rocks, swaying physics plants, light shafts, caustics,
// bubbles, voxel tank equipment (filter, heater, light, air stones, substrate) and your fish swimming in it (drawFishRig).
// Bigger tiers are WIDER than the screen: scroll with drag, wheel, A / D / arrows or by resting the cursor at an edge.
// A Lab tank unlock grows the tank with a bouncy expansion. Idle Aero drops (sweep the cursor over them), offline
// earnings, feeding, breeding, evolution and auto-collect all live here.
//
// Building happens ONLY here (build2d.js, dock 'Build', key U anywhere): a catalog of decorations and blueprints, a
// ghost that snaps to the floor of the front / mid / back plane or to the back glass, move, flip, store, undo. Seabed
// buildings (state.buildings) stand in the tank (b.tank = {u, l, h, f}) and keep their bonuses (src/build/build.js).
//
// Shown as the full-screen scene (state.view === 'aquarium') and as a floating Aero glass window over the ocean (a live
// close-up camera that follows your fish). Fish management (src/ui/fishmgr.js) uses: fishOf(rec), moveFish(rec,
// toTank), releaseFish(rec), feedAll(), breedPair(recA, recB), focusFish(rec), canBreed(rec), rateOf(rec).
// API used by the game: addFish(rec), update(dt, inpOrNull), hit(x, y), drawFull, drawWindow, drawMini, windowRect(),
// toggleWindow(), openWindow(force), closeWindow(), forceCoin(), hintPoint(), offlineCoins(sec), onResize(),
// addDecor(id), storedDecor(), placeStored(id), tankSummary(), interact(decorOrId), openFull(), openBuild(o),
// capacity(), tier, syncFish(), evolveFish(dt), buyGear(id), pieceScreen(rec), editing, view.rebuild().
// Events via game.emit: 'tankFish', 'coinCollected' ({value, by}), 'decorPlayed', 'fishEvolved', 'hatched',
// 'tankUpgraded' ({from, to}), 'gearBought', 'tankFed', 'tankBuilt'.
// state.tank: {tier, decor: [{id, u, l, h, f, v}], stored: [ids], eggs, coins, gear, lampOff}. l: 0 front, 1 mid,
// 2 back, 3 the back glass (h = height 0..1).

import { clamp, clamp01, lerp, rectContains, smoothstep, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon, UI_ICON_NAMES } from '../gfx/uiicons.js';
import { PROPS, propInteract } from '../gfx/props.js';
import { compiled } from '../gfx/spritecache.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { rollIndividual, sizeScaleOf } from '../fish/traits.js';
import { nodeFor } from '../game/lab.js';
import { AERO, fmtAero, drawAeroCoin, drawAeroSurface, drawAeroButton, drawSparkle, drawAeroPanel, uiK, drawPixelBrackets, aeroCached, aeroSurface, drawAeroGlow, drawVoxDecor } from '../ui/aero.js';
import { TANK_TIERS, TANK_IDS, tankTier, aeroRate, GEAR, gearLevel, gearCost, gearMul, gearHappy } from './tanks.js';
import { SideShape, TankFish, Drops3D, Ripples, DENOMS } from './sim2d.js';
import { TankScene } from './scene2d.js';
import { Build2D } from './build2d.js';
import { FoodSim, FOODS, FOOD_IDS, foodIcon, shakerSprite } from './food.js';
import { drawIcon3D, has3D } from '../gfx/icons3d.js';
import { iconFrame } from '../gfx/bigicons.js';
import { drawPop3D, text3dCanvas } from '../ui/pop3d.js';
import { mix, shade, rgba } from '../core/color.js';

const HUNGER_RATE = 1 / 2000; // 0 -> 0.6 ("hungry") in 20 minutes
const AUTO_POP = [Infinity, 14, 7, 3.5, 2];
const ICONS = new Set(UI_ICON_NAMES);
const EMOTE_ICON = { '!': 'exclaim', '!!': 'exclaim', '?': 'question', $: 'dollar' };
const FRAME = { lid: 15, side: 4, base: 14 };
const WIN_W = [250, 266, 290, 326, 362, 404];

export class Aquarium {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.fish = [];
    this.feed = new FoodSim(this);
    this.bubbles = [];
    this.decor = []; // pieces: {kind: 'decor'|'building', rec, id, v, l, x, wy, flip, squash, ...}
    this.drops = new Drops3D();
    this.ripples = new Ripples();
    this.particles = new Particles(240);
    this.scene = new TankScene(this);
    this.camX = 0; this.camV = 0;
    this.winCam = { x: 0, y: 0 };
    this.visibleKey = null;
    this.build = new Build2D(this);
    this.panel = null; // 'gear' | null
    this.press = null; this.drag = null;
    this.hoverFish = null; this.hoverDecor = null; this.hoverBtn = null;
    this.combo = 0; this.comboT = 0;
    this.moodT = 0; this.saveT = 0; this.feederT = 20; this.syncT = 0;
    this.growAnim = null; this.pendingGrow = null;
    this.sfxQ = [];
    this.winAnim = 1;
    this.coinsDirty = false;
    // compat: the old 3D view object (workshop.js calls view.rebuild(); fxAt / overlays use project)
    this.view = { rebuild: () => this.scene.invalidate(), invalidate: () => this.scene.invalidate(), ok: true, project: (p) => this.project(p), ppu: () => this.scene.Z };
    this.load();
  }

  // ------------------------------------------------------------------ state
  get st() { return this.game.state; }
  get stats() { return this.game.stats || {}; }
  get coins() { return this.drops; }
  get arrange() { return this.build.on; }
  get editing() { return this.visibleKey === 'full' && this.build.on; }
  get swim() { return null; } // swimming retired in phase 10
  get food() { return this.feed.items; }
  get foodType() { const f = this.st.tank?.food; return FOODS[f] ? f : 'flakes'; }

  ensureState() {
    const st = this.st;
    st.tank ||= {};
    const tk = st.tank;
    tk.decor ||= [];
    tk.eggs ||= [];
    tk.stored ||= [];
    tk.coins ||= [];
    tk.gear ||= {};
    if (!Number.isFinite(tk.tier)) tk.tier = 0;
    // phase 10 migration: old cube decor {x, z, r, lift} -> side view {u, l}
    for (const d of tk.decor) {
      if (d.u === undefined) { d.u = clamp01(d.x ?? 0.5); d.l = (d.z ?? 0.5) < 0.34 ? 0 : (d.z ?? 0.5) < 0.67 ? 1 : 2; d.f = (d.r || 0) < 0; delete d.x; delete d.z; delete d.r; delete d.lift; }
      d.l = clamp(d.l | 0, 0, 3);
    }
    delete tk.paint; delete tk.baseOff;
    st.tankWindow ||= { open: false, x: 0, y: 0 };
  }

  load() {
    this.stateRef = this.game.state;
    this.ensureState();
    this.tier = tankTier(this.st);
    this.shape = new SideShape(this.tier);
    this.fish.length = 0; this.feed.clear(); this.bubbles.length = 0;
    this.drops.list.length = 0;
    this.growAnim = null; this.pendingGrow = null;
    this.drops.setScale(6);
    this.camX = 0;
    this.syncPieces();
    this.scene.invalidate();
    this.syncFish();
    this.restoreCoins();
  }

  capacity() { return this.stats.tankCap || 4; }
  tierInfo() { return TANK_TIERS[this.tier] || TANK_TIERS[0]; }
  sfx(name, opts) { if (!this.visibleKey) return; try { audio.play(name, opts); } catch { /* audio not ready */ } }

  // ------------------------------------------------------------------ pieces (decor + buildings in the tank)
  tankBuildings() { return (this.st.buildings || []).filter((b) => b.tank); }
  // rebuild the piece list from the save, keeping per-piece animation state
  syncPieces() {
    const old = new Map(this.decor.map((p) => [p.rec, p]));
    const out = [];
    const T = this.shape;
    const mk = (kind, rec, id, v, pl) => {
      const p = old.get(rec) || { kind, rec, squash: 0, squashV: 0, hop: 0, shake: 0, lift: 0, vy: 0 };
      p.kind = kind; p.id = id; p.v = v || 0; p.l = clamp(pl.l | 0, 0, 3); p.flip = !!pl.f;
      p.x = (clamp01(pl.u ?? 0.5) - 0.5) * (T.W - 40);
      p.wy = lerp(T.planeH(2, p.x) + 16, T.waterY - 30, clamp01(pl.h ?? 0.5));
      p.order = out.length;
      out.push(p);
    };
    for (const d of this.st.tank.decor) if (PROPS[d.id]) mk('decor', d, d.id, d.v, d);
    for (const b of this.tankBuildings()) mk('building', b, b.id, 0, b.tank);
    this.decor = out;
    this.pieceKey = this.st.tank.decor.length + '|' + this.tankBuildings().length;
  }
  pieces() {
    const g = this.build.ghostPiece();
    return g ? [...this.decor, g] : this.decor;
  }
  pieceOf(rec) { return this.decor.find((p) => p.rec === rec) || null; }
  // screen position of a placed record (buildings use it for pop-up effects)
  pieceScreen(rec) {
    const p = this.pieceOf(rec);
    if (!p?.screen || !this.visibleKey) return null;
    return [p.screen.x + p.screen.w / 2, p.screen.y + p.screen.h * 0.3];
  }

  insertDecorRec(rec, o = {}) {
    this.st.tank.decor.push(rec);
    this.syncPieces();
    const p = this.pieceOf(rec);
    if (p && o.drop) { p.lift = this.shape.H * 0.55; p.vy = 0; }
    if (p) p.squashV = 4;
    return p;
  }
  removeDecorRec(rec, fx = 'puff') {
    const tk = this.st.tank;
    const p = this.pieceOf(rec);
    tk.decor = tk.decor.filter((r) => r !== rec);
    if (p) this.pieceFx(p, fx);
    this.syncPieces();
    this.sfx('ui_close', { vol: 0.5 });
    return p;
  }
  pieceFx(p, fx = 'puff') {
    const wp = this.pieceWorld(p);
    if (fx === 'puff') this.puff(wp, 14, 8); else this.fxAt([wp[0], wp[1] + 20, wp[2]], 'burst', 10);
  }
  pieceWorld(p) {
    const T = this.shape, z = this.scene.layerZ(p.l);
    return [p.x, p.l === 3 ? p.wy : T.planeH(p.l, p.x), z];
  }

  // a free spot for a new piece: the widest gap on a plane
  freeSpot(l = null) {
    let best = { u: 0.5, l: l ?? 1 }, bs = -1;
    for (let i = 0; i < 40; i++) {
      const u = rng.float(0.08, 0.92), ll = l ?? rng.pick([1, 1, 2, 0]);
      let m = 9;
      for (const d of this.decor) m = Math.min(m, Math.abs((d.x / (this.shape.W - 40) + 0.5) - u) + (d.l === ll ? 0 : 0.15));
      if (m > bs) { bs = m; best = { u, l: ll }; }
    }
    return best;
  }

  addDecor(id, opts = {}) {
    if (!PROPS[id]?.decor) return false;
    const spot = this.freeSpot(opts.l ?? null);
    const rec = { id, u: opts.u ?? spot.u, l: opts.l ?? spot.l, h: opts.h ?? 0.5, f: opts.f ?? rng.chance(0.5) };
    if (opts.v) rec.v = opts.v;
    this.insertDecorRec(rec, { drop: true });
    this.game.save?.();
    return true;
  }

  storedDecor() { return this.st.tank.stored.slice(); }

  placeStored(id, at = null) {
    const st = this.st.tank.stored;
    const i = id ? st.indexOf(id) : st.length - 1;
    if (i < 0) return false;
    const [pid] = st.splice(i, 1);
    if (this.addDecor(pid, at || {})) { this.sfx('box_close', { vol: 0.5 }); return true; }
    st.push(pid);
    return false;
  }

  storeDecor(d) {
    this.removeDecorRec(d.rec, 'burst');
    this.st.tank.stored.push(d.rec.id);
    this.game.toast?.(`${PROPS[d.rec.id]?.name || 'Decoration'} packed away.`, 'tank');
    this.game.save?.();
  }

  // a pixel-art sand puff where something lands or lifts off (+ a few real bubbles)
  puff(p, r = 8, n = 6) {
    for (let i = 0; i < Math.min(5, n); i++) this.addBubble([p[0] + rng.float(-r, r) * 0.6, p[1] + 2, p[2]], rng.float(0.8, 1.8));
    if (!this.visibleKey) return;
    const sp = this.project(p);
    if (!sp) return;
    this.px('dust', sp[0], sp[1], Math.round(5 + n), { speed: [10, 26 + r], up: 10, w: r * 0.6, h: 1, ramps: ['dust', 'white'] });
    this.px('puff', sp[0], sp[1] - 1, Math.round(2 + n / 3), { speed: [6, 18], w: r * 0.4, ramp: 'white' });
  }
  px(kind, x, y, n, o = {}) {
    const P = this.particles;
    if (P.pixelBurst) return P.pixelBurst(kind, x, y, n, o);
    for (let i = 0; i < n; i++) P.sparkle(x + rng.float(-4, 4), y + rng.float(-4, 4), '#ffffff');
  }

  // ------------------------------------------------------------------ fish
  makeFish(rec, opts = {}) {
    const sp = SPECIES_BY_ID[rec.species];
    if (!sp) return null;
    rec.hunger ??= 0.3; rec.happiness ??= 0.75; rec.coinT ??= 0;
    let c;
    try { c = compiled(sp.look, rec.variant, sp.id); } catch (e) { console.warn('tank fish', rec.species, e); return null; }
    const T = this.shape;
    const L = (c.L || 30) * (c.kind === 'chain' ? 1.6 : 1.3);
    let k = clamp(sizeScaleOf(rec, sp), 0.5, 2.2);
    const maxLen = T.H * 0.38, minLen = 30;
    if (L * k > maxLen) k = maxLen / L;
    if (L * k < minLen) k = minLen / L;
    let f;
    try { f = new TankFish(rec, sp, L * k); } catch (e) { console.warn('tank fish', rec.species, e); return null; }
    f.c = c; f.drawScale = k;
    if (opts.at) f.p = opts.at.slice();
    else if (opts.splash) { f.p = [rng.float(-0.3, 0.3) * T.W, T.waterY - f.len * 0.5, rng.float(-0.2, 0.2) * T.D]; f.pitch = -0.6; f.speed = f.cruise * 2; }
    else f.p = T.swimPoint(Math.random, rng.float(0.2, 0.8), f.len);
    T.clamp(f.p, f.len * 0.45);
    if (opts.splash) {
      this.ripples.add(f.p[0], f.p[2], 1.2);
      for (let i = 0; i < 8; i++) this.addBubble([f.p[0] + rng.float(-1, 1) * f.len * 0.3, f.p[1], f.p[2]], rng.float(0.8, 2));
      this.sfx('splash_small', { vol: 0.6 });
    }
    if (opts.baby) f.baby = 40;
    this.fish.push(f);
    return f;
  }

  addFish(rec, opts = {}) {
    if (this.fish.some((f) => f.rec === rec)) return;
    const f = this.makeFish(rec, { splash: opts.splash ?? true, ...opts });
    if (f) this.game.emit?.('tankFish', rec);
  }

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
      const nf = this.makeFish(rec, { splash: false, at: f.p });
      if (nf) { nf.yaw = f.yaw; nf.say('!', 1.5); }
      this.fxAt(f.p, 'evolve', 1);
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
  winDims() {
    const sw = Math.min(WIN_W[this.tier] || 300, this.game.screen.W - 40);
    const sh = Math.round(sw * 0.64);
    return { w: sw + FRAME.side * 2, h: sh + FRAME.lid + FRAME.base, sw, sh };
  }
  windowRect() {
    const g = this.game;
    if (g.state.view !== 'ocean' || !g.state.tankWindow?.open) return null;
    const d = this.winDims(), tw = g.state.tankWindow;
    return { x: tw.x, y: tw.y, w: d.w, h: d.h };
  }
  clampWindow() {
    const tw = this.st.tankWindow, d = this.winDims(), { W, H } = this.game.screen;
    tw.x = Math.round(clamp(tw.x, 4 - d.w * 0.6, W - d.w * 0.4));
    tw.y = Math.round(clamp(tw.y, 0, H - 20));
  }
  openWindow(force = false) {
    const g = this.game, tw = g.state.tankWindow;
    const was = tw.open && g.state.view === 'ocean';
    tw.open = true;
    const d = this.winDims(), { W, H } = g.screen;
    if (force || (!tw.x && !tw.y) || tw.x > W - 40 || tw.y > H - 60) { tw.x = Math.round(W * 0.38 - d.w / 2); tw.y = Math.round(H - d.h - 64); }
    this.clampWindow();
    if (!was) { this.winAnim = 0; this.winCam.snap = true; try { audio.play('ui_open'); } catch { /* no audio */ } }
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
  onResize() { if (this.st.tankWindow) this.clampWindow(); this.scene.invalidate(); }
  openFull() {
    const g = this.game;
    this.press = null; this.drag = null;
    g.setView?.('aquarium');
  }
  // open the tank's build mode (from anywhere: key U, blueprints, the Workshop)
  openBuild(o = {}) {
    const g = this.game;
    if (g.fishing?.fighting) { g.toast?.('Finish the fight first!', 'hook'); return false; }
    g.ui?.close?.();
    if (g.state.view !== 'aquarium') this.openFull();
    this.pendingBuild = o;
    if (this.visibleKey === 'full') { this.build.enter(o); this.pendingBuild = null; }
    return true;
  }

  shownKey() {
    const g = this.game;
    if (g.state.view === 'aquarium') return 'full';
    return g.state.tankWindow?.open && g.state.view === 'ocean' ? 'window' : null;
  }

  hit(x, y) {
    const g = this.game;
    if (g.state.view === 'aquarium') return true;
    if (!g.state.tankWindow?.open) return false;
    if (this.drag) return true;
    const r = this.windowRect();
    return !!r && rectContains(r, x, y);
  }

  // ------------------------------------------------------------------ cameras & projection
  hudBottom() {
    const g = this.game, H = g.screen.H;
    try { const h = g.hud; const m = h.m || h.metrics(); return H - m.trayH - m.margin - Math.round(m.B * 0.36) - 4; } catch { return H - 80; }
  }
  fullCam() {
    const g = this.game;
    const L = this.fullLayout();
    // the tank sits left of the dock column, under the top plate
    this.scene.view = { x0: 0, x1: L.dock.x - 4 };
    this.scene.topY = L.top + 2;
    this.scene.layout(g.screen.W, g.screen.H, this.layoutBottom ?? this.hudBottom());
    return this.scene.cam(this.camX);
  }
  winInner() {
    const r = this.windowRect();
    if (!r) return null;
    const d = this.winDims();
    return { x: r.x + FRAME.side, y: r.y + FRAME.lid + this.slideOff(), w: d.sw, h: d.sh };
  }
  winCamera() {
    const ir = this.winInner();
    if (!ir) return null;
    return this.scene.windowCam(ir, this.winCam.x, this.winCam.y);
  }
  curCam() { return this.visibleKey === 'window' ? this.winCamera() : this.visibleKey === 'full' ? this.fullCam() : null; }
  // screen [x, y, depth] of a tank point under the visible camera (null when hidden)
  project(p) {
    const c = this.curCam();
    if (!c) return null;
    const q = this.scene.proj(p[0], p[1], p[2], c);
    return [q.x, q.y, p[2]];
  }
  hintPoint() {
    const c = this.drops.list.find((d) => d.hint);
    return c?.screen && this.visibleKey ? [c.screen.x, c.screen.y] : null;
  }

  // ------------------------------------------------------------------ economy
  gearMul() { return gearMul(this.st); }
  fishRate(f) { return aeroRate(f.rec, f.sp, this.stats, this.tier, this.game.coinMulBonus || 1, this.gearMul()); }
  ratePerMin() { return this.fish.reduce((a, f) => a + this.fishRate(f), 0); }

  // Tutorial: a drop that hovers low in the water until it is popped.
  forceCoin() {
    const T = this.shape;
    const f = this.fish[0];
    const p = f ? f.p.slice() : T.swimPoint(Math.random, 0.4, 2);
    p[2] = T.D * 0.3;
    T.clamp(p, 4);
    const c = this.drops.spawn(p, 0, { value: DENOMS[0] });
    c.hint = true;
    this.coinsDirty = true;
    if (f) f.say('$', 1.4);
  }

  dropCoin(f, d) {
    const dir = f.dir;
    const p = [f.p[0] + dir[0] * f.len * 0.5, f.p[1] + dir[1] * f.len * 0.5, f.p[2] + dir[2] * f.len * 0.3];
    this.shape.clamp(p, 3);
    this.drops.spawn(p, d, { v: [dir[0] * 10, 2, dir[2] * 4], hold: 0.35 });
    this.sfx('bubble', { vol: 0.3, pitch: [1.35, 1.15, 0.95][d] });
    f.poke(3);
    for (let i = 0; i < 3; i++) this.addBubble(p, rng.float(0.8, 1.5));
    this.coinsDirty = true;
  }

  // Pop a drop into Aero (by: 'player' | 'auto' | 'helper').
  collectCoin(c, by = 'player') {
    if (!this.drops.list.includes(c)) return;
    this.drops.remove(c);
    this.coinsDirty = true;
    const vk = this.visibleKey;
    const sp = vk ? this.project(c.p) : null;
    if (by === 'player') this.lastGrabT = this.t;
    this.game.addCoins?.(c.value, sp?.[0], sp?.[1]);
    if (vk) {
      this.combo = this.comboT > 0 ? this.combo + 1 : 0;
      this.comboT = 0.45;
      this.sfx('bubble', { vol: by === 'player' ? 0.5 : 0.25, pitch: 1.5 + Math.min(12, this.combo) * 0.06 });
      this.sfx('coin_collect', { vol: by === 'player' ? 0.3 : 0.15, pitch: 1.1 + Math.min(12, this.combo) * 0.045 });
      this.fxAt(c.p, 'pop', c.value, c.r);
    }
    this.ripples.add(c.p[0], c.p[2], 0.3);
    this.game.emit?.('coinCollected', { value: c.value, by });
  }

  // a fish nibbles a piece of food: hunger down, crumbs and chomp bubbles, a gulp when it is all gone
  onEat(f, food) {
    if (food.eaten || !food.wet || (f.biteT || 0) > this.t) return;
    f.biteT = this.t + rng.float(0.28, 0.46);
    const F = FOODS[food.type] || FOODS.flakes;
    const rec = f.rec;
    rec.hunger = Math.max(0, (rec.hunger ?? 0.5) - F.feed / F.bites);
    rec.happiness = Math.min(1, (rec.happiness ?? 0.7) + 0.012);
    const done = this.feed.bite(f, food);
    f.poke(done ? 7 : 4);
    f.chomp = 0.3;
    const mouth = food.p.slice();
    this.addBubble([mouth[0], mouth[1] + 1, mouth[2]], rng.float(0.6, 1.1));
    if (done) this.addBubble([mouth[0] + rng.float(-2, 2), mouth[1] + 2, mouth[2]], rng.float(0.8, 1.4));
    if ((this.eatSfxT || 0) < this.t) {
      this.eatSfxT = this.t + 0.08;
      if (done) this.sfx(food.type === 'worms' ? 'worm_squish' : 'gulp', { vol: food.type === 'worms' ? 0.22 : 0.3, pitch: rng.float(1.25, 1.6) });
      else this.sfx('nibble', { vol: 0.22, pitch: rng.float(1.4, 1.9) });
    }
    if (this.visibleKey) {
      const sp = this.project(mouth);
      if (sp) {
        const col = F.cols[food.v % F.cols.length];
        this.px('sparkle', sp[0], sp[1], done ? 3 : 1, { ramps: [col, 'white'], speed: [12, 36], w: 3, h: 3 });
        if (done) this.px('puff', sp[0], sp[1], 2, { ramp: 'white', speed: [6, 16], w: 2, h: 2 });
      }
    }
    if (done && (rec.hunger ?? 0) < 0.08 && !f.emote && rng.chance(0.3)) f.say('heart', 1.2);
    if (done) this.game.emit?.('tankAte', { species: f.sp.id, food: food.type });
  }

  // food hits the water: a little splash, ripples and a bubble trail
  foodSplash(p) {
    const T = this.shape;
    this.ripples.add(p.p[0], p.p[2], p.type === 'pellets' ? 0.45 : 0.3);
    if (rng.chance(0.7)) this.addBubble([p.p[0] + rng.float(-1, 1), T.waterY - 3, p.p[2]], rng.float(0.6, 1.3));
    if (!this.visibleKey) return;
    const sp = this.project([p.p[0], T.waterY, p.p[2]]);
    if (sp) {
      this.px('drop', sp[0], sp[1] - 1, rng.int(2, 3), { ramp: 'aqua', speed: [25, 60], spread: 0.9 });
      if (rng.chance(0.5)) this.px('foam', sp[0], sp[1], 1, { speed: [4, 10] });
    }
    if (this.feed.splashT <= 0) { this.feed.splashT = 0.07; this.sfx('splash_small', { vol: 0.16, pitch: rng.float(1.4, 1.9) }); }
  }
  // food settles on the gravel (pellets bounce once)
  foodLand(p, bounce) {
    if (!this.visibleKey) return;
    const sp = this.project(p.p);
    if (!sp) return;
    this.px('dust', sp[0], sp[1] + 1, bounce ? 3 : 2, { speed: [6, 16], up: 4, w: 2, h: 1, ramps: ['dust', 'white'] });
    if (bounce && (this.landSfxT || 0) < this.t) { this.landSfxT = this.t + 0.1; this.sfx('click', { vol: 0.12, pitch: rng.float(1.6, 2.1) }); }
  }

  canCourt(f) {
    const s = this.stats;
    if (!s.breeding || this.nightK > 0.5) return false;
    const rec = f.rec;
    if ((rec.happiness ?? 0) < 0.62 || (rec.hunger ?? 1) > 0.6 || f.baby > 0) return false;
    if ((rec.breedAt || 0) > Date.now()) return false;
    return this.st.tank.eggs.length < 2;
  }

  onCourt(a, b) {
    const T = this.shape;
    const [u, v] = T.toUV((a.p[0] + b.p[0]) / 2, (a.p[2] + b.p[2]) / 2);
    const species = a.breedSp || b.breedSp || a.sp.id;
    a.breedSp = b.breedSp = null;
    const egg = { species, x: u, z: v, t: 0, dur: 180 / (this.stats.hatchSpeed || 1), n: rng.int(3, 6), color: a.sp.look?.col?.belly || '#ffd8a8', parents: [a.rec.uid, b.rec.uid] };
    this.st.tank.eggs.push(egg);
    const later = Date.now() + 6 * 60 * 1000;
    a.rec.breedAt = later; b.rec.breedAt = later;
    a.say('heart', 1.5); b.say('heart', 1.5);
    this.sfx('magic', { vol: 0.5 });
    this.game.toast?.(`${a.rec.name || a.sp.name} & ${b.rec.name || b.sp.name} laid eggs!`, 'heart');
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
    const p = this.shape.floorPoint(egg.x, egg.z, 4);
    if (inTank) this.makeFish(rec, { splash: false, baby: true, at: [p[0], p[1] + 8, p[2]] });
    this.fxAt(p, 'burst', 10);
    this.sfx('sparkle', { vol: 0.6 });
    const trait = rec.variant?.shiny ? 'A SHINY ' : rec.variant?.mutation ? 'A mutated ' : 'A baby ';
    g.toast?.(`${trait}${sp.name} hatched${inTank ? '!' : ' - the tank is full, it went to the holding bucket.'}`, 'heart');
    g.emit?.('hatched', rec);
    g.save?.();
  }

  offlineCoins(seconds) {
    const st = this.st, s = this.stats;
    const tier = tankTier(st);
    const cap = (TANK_TIERS[tier]?.offlineH || 4) * 3600;
    const sec = Math.max(0, Math.min(seconds, cap));
    let rate = 0;
    const gm = gearMul(st);
    for (const rec of st.fish || []) {
      if (!rec.inTank) continue;
      const sp = SPECIES_BY_ID[rec.species];
      if (!sp) continue;
      rate += aeroRate(rec, sp, s, tier, this.game.coinMulBonus || 1, gm);
      rec.hunger = Math.min(s.feeder ? 0.45 : 1, (rec.hunger ?? 0.3) + seconds * HUNGER_RATE);
    }
    for (const e of st.tank?.eggs || []) e.t += seconds;
    const amount = Math.floor((rate / 60) * sec * (s.offlineMul ?? 0.35));
    this.lastOffline = { seconds, capped: sec, rate, amount, tier };
    return Math.max(0, amount);
  }

  saveCoins() {
    const T = this.shape;
    this.st.tank.coins = this.drops.list.filter((c) => !c.hint).map((c) => { const [u, v] = T.toUV(c.p[0], c.p[2]); return [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000, c.d, c.value]; });
    this.coinsDirty = false;
  }
  restoreCoins() {
    const T = this.shape;
    for (const [u, v, d, val] of this.st.tank.coins || []) {
      if (!(d >= 0 && d <= 2)) continue;
      const p = T.floorPoint(clamp01(u), clamp01(v), 6);
      p[1] = T.waterY - 2;
      const c = this.drops.spawn(p, d, { value: val });
      c.sleep = true;
    }
    for (let i = 0; i < 20; i++) this.drops.step(1 / 40, T, null);
  }

  tankSummary() {
    const n = this.fish.length;
    const happy = n ? this.fish.reduce((a, f) => a + (f.rec.happiness ?? 0.7), 0) / n : 0;
    return { fish: n, cap: this.capacity(), happiness: happy, coinsPerMin: this.ratePerMin(), aeroPerMin: this.ratePerMin(), coins: this.drops.list.length, decor: this.decor.length, tier: this.tier, tank: this.tierInfo().name };
  }

  // ------------------------------------------------------------------ fish management (src/ui/fishmgr.js)
  fishOf(rec) { return this.fish.find((f) => f.rec === rec) || null; }
  tankCount() { return (this.st.fish || []).filter((r) => r.inTank).length; }
  rateOf(rec) { const sp = SPECIES_BY_ID[rec.species]; return sp ? aeroRate(rec, sp, this.stats, this.tier, this.game.coinMulBonus || 1, this.gearMul()) : 0; }
  moveFish(rec, toTank) {
    if (!!rec.inTank === !!toTank) return { ok: true };
    if (toTank && this.tankCount() >= this.capacity()) return { ok: false, why: `The tank is full (${this.capacity()} fish). Upgrade it in The Lab!` };
    rec.inTank = !!toTank;
    if (toTank) this.addFish(rec, { splash: true });
    else { const f = this.fishOf(rec); if (f) { this.fxAt(f.p, 'burst', 6); this.fish.splice(this.fish.indexOf(f), 1); } }
    this.sfx(toTank ? 'splash_small' : 'bubble', { vol: 0.5 });
    this.game.save?.();
    return { ok: true };
  }
  releaseFish(rec) {
    const st = this.st, i = (st.fish || []).indexOf(rec);
    if (i < 0) return 0;
    const f = this.fishOf(rec);
    if (f) { this.fxAt(f.p, 'burst', 8); this.fish.splice(this.fish.indexOf(f), 1); }
    st.fish.splice(i, 1);
    const g = this.game;
    return g.releaseFish ? g.releaseFish(rec, g.input?.x, g.input?.y) : 0;
  }
  feedAll() {
    const T = this.shape;
    for (let i = 0; i < 4; i++) this.feed.drop(this.foodType, (0.15 + i * 0.23 - 0.5) * T.W * 0.8 + this.camX * 0.5, rng.float(-0.2, 0.2) * T.D, null, { delay: i * 0.18 });
    for (const f of this.fish) f.rec.hunger = Math.max(0, (f.rec.hunger ?? 0.4) - 0.3);
    this.sfx('bubble', { vol: 0.5, pitch: 1.2 });
    this.game.emit?.('tankFed', { n: this.fish.length });
  }
  canBreed(rec) {
    if (!this.stats.breeding) return 'Research breeding in The Lab first.';
    if (!rec.inTank) return 'Both fish must be in the tank.';
    if ((rec.breedAt || 0) > Date.now()) return `${rec.name || SPECIES_BY_ID[rec.species]?.name || 'This fish'} needs a rest (${Math.ceil(((rec.breedAt || 0) - Date.now()) / 60000)} min).`;
    if (this.st.tank.eggs.length >= 2) return 'The tank already has two clutches of eggs.';
    return null;
  }
  breedPair(a, b) {
    if (a === b) return { ok: false, why: 'Pick two different fish.' };
    const why = this.canBreed(a) || this.canBreed(b);
    if (why) return { ok: false, why };
    const fa = this.fishOf(a), fb = this.fishOf(b);
    if (!fa || !fb) return { ok: false, why: 'Both fish must be in the tank.' };
    fa.setState('court'); fa.mate = fb; fb.setState('court'); fb.mate = fa;
    fa.say('heart', 2); fb.say('heart', 2);
    if (rng.chance(0.5)) fa.breedSp = fb.sp.id;
    this.sfx('magic', { vol: 0.5 });
    return { ok: true };
  }
  // the camera scrolls to a fish and follows it for a moment (switches to the tank view first)
  focusFish(rec) {
    if (!rec?.inTank) return false;
    this.pendingFocus = rec; this.pendingFocusT = 3;
    if (this.game.state.view !== 'aquarium') this.game.setView?.('aquarium');
    return true;
  }

  // ------------------------------------------------------------------ gear (Aero upgrades)
  buyGear(id) {
    const g = GEAR.find((q) => q.id === id);
    if (!g) return false;
    const lv = gearLevel(this.st, id);
    if (lv >= g.levels.length - 1) return false;
    const cost = gearCost(id, lv + 1);
    if (!this.game.spendCoins?.(cost)) { this.game.toast?.('Not enough Aero.', 'coin'); return false; }
    this.st.tank.gear[id] = lv + 1;
    this.scene.invalidate();
    this.sfx('ui_unlock', { vol: 0.7 });
    this.fxAt([this.camX, this.shape.waterY * 0.6, 0], 'confetti', 24);
    this.game.toast?.(`${g.levels[lv + 1]} installed!`, 'sparkle');
    this.game.emit?.('gearBought', { id, level: lv + 1 });
    this.game.save?.();
    return true;
  }

  // ------------------------------------------------------------------ update
  update(dt, inp) {
    const g = this.game;
    if (this.stateRef !== g.state) this.load();
    this.t += dt;
    this.dtLast = dt;
    const tier = tankTier(this.st);
    if (tier !== this.tier) this.changeTier(tier);
    const pk = this.st.tank.decor.length + '|' + this.tankBuildings().length;
    if (pk !== this.pieceKey) this.syncPieces();
    const shown = this.shownKey();
    const was = this.visibleKey;
    this.visibleKey = shown;
    if (shown === 'window') this.winAnim = Math.min(1, this.winAnim + dt * 5);
    if (shown !== 'full') { this.panel = null; if (this.build.on) this.build.exit(); }
    if (shown === 'full' && was !== 'full') {
      if (!this.build.on) this.layoutBottom = this.hudBottom();
      if (this.pendingGrow) { this.startGrow(this.pendingGrow); this.pendingGrow = null; }
      if (this.pendingBuild) { const o = this.pendingBuild; this.pendingBuild = null; this.build.enter(o); }
    }
    if (shown === 'full' && this.pendingFocus) {
      const f = this.fish.find((q) => q.rec === this.pendingFocus);
      if (f) { this.follow = f; this.followT = 4; f.say('heart', 1.6); }
      if (f || !this.pendingFocusT || (this.pendingFocusT -= dt) <= 0) this.pendingFocus = null;
    }
    // F: the fish manager (anywhere in the game)
    const I = g.input;
    if (I?.keyPressed('f') && !g.ui?.active && !g.tutorial?.active && !this.build.on && g.ui?.panels?.fishmgr) { g.ui.open('fishmgr'); I.keysPressed?.delete?.('f'); }
    const clock = g.clock;
    this.nightK = clock ? clamp01(1 - clock.daylight()) : 0;
    this.comboT = Math.max(0, this.comboT - dt);
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 0.5; this.syncFish(); this.evolveFish(0.5); }
    if (this.growAnim) {
      // wait (briefly) for the bigger tank's substrate to be built so the expansion plays with its full art
      const ga = this.growAnim;
      const ready = (!this.scene.planes.some((p) => !p) && this.scene.frameReady()) || ga.wait > 5;
      if (!ready && ga.t < 0.2) { ga.wait = (ga.wait || 0) + dt; this.scene.pump(22); } else { ga.t += dt; this.updateGrow(); }
    }

    if (shown === 'full') this.updateScroll(dt, inp);
    if (shown === 'window') this.updateWinCam(dt);
    if (this.build.on) this.build.update(dt);
    this.handleInput(dt, inp);
    this.ripples.step(dt);
    this.updateFood(dt);
    this.updateFish(dt);
    this.updateDecor(dt);
    this.updateEconomy(dt);
    this.drops.step(dt, this.shape, this.ripples);
    this.updateSnail(dt);
    this.autoCollect(dt);
    this.updateEggs(dt);
    this.updateBubbles(dt);
    this.particles.update(dt);
    this.runSfxQueue(dt);
    if (shown) {
      const cam = this.curCam();
      if (cam) this.scene.update(dt, cam);
      this.scene.pump(shown === 'full' ? 10 : 5);
    } else if (this.t > 3) { this.fullCam(); this.scene.ensure(); this.scene.pump(2.5); } // quietly pre-build the tank's art in the background
    this.saveT -= dt;
    if (this.saveT <= 0 && this.coinsDirty) { this.saveT = 1; this.saveCoins(); }
  }

  // horizontal scrolling: drag (handleInput), wheel, A / D / arrows, edge pan, inertia; the camera follows a focused fish
  updateScroll(dt, inp) {
    const g = this.game, I = g.input;
    const max = this.scene.scrollMax();
    let push = 0;
    const typing = g.ui?.active && g.ui?.stack?.some((p) => p.modal !== false);
    if (I && !typing && !g.tutorial?.active) {
      if (I.key('a') || I.key('ArrowLeft')) push -= 1;
      if (I.key('d') || I.key('ArrowRight')) push += 1;
      if (max > 0) I.keysPressed?.delete?.('a'); // A scrolls a wide tank (instead of leaving it)
    }
    if (inp && inp.inside && !this.press && !this.hoverBtn && !this.panel && max > 0) {
      const W = g.screen.W, e = 22;
      if (inp.x < e && inp.y > 40) push -= (e - inp.x) / e;
      else if (inp.x > W - e && inp.y > 40) push += (inp.x - (W - e)) / e;
    }
    const Z = this.scene.Z;
    if (push) { this.camV = lerp(this.camV, push * 520 / Z, Math.min(1, dt * 8)); this.follow = null; }
    else if (!this.press?.panning) this.camV *= Math.exp(-dt * 5);
    if (this.follow && this.followT > 0) {
      this.followT -= dt;
      if (!this.fish.includes(this.follow)) this.follow = null;
      else this.camX = lerp(this.camX, this.follow.p[0], Math.min(1, dt * 3));
    }
    this.camX += this.camV * dt;
    if (this.camX < -max) { this.camX = -max; this.camV = 0; }
    if (this.camX > max) { this.camX = max; this.camV = 0; }
  }

  // the floating window's camera glides after your fish (or the tutorial's drop)
  updateWinCam(dt) {
    const T = this.shape, wc = this.winCam;
    const hint = this.drops.list.find((c) => c.hint);
    let tx = 0, ty = T.H * 0.42;
    if (hint) { tx = hint.p[0]; ty = hint.p[1]; }
    else if (this.fish.length) { tx = this.fish.reduce((a, f) => a + f.p[0], 0) / this.fish.length; ty = this.fish.reduce((a, f) => a + f.p[1], 0) / this.fish.length; }
    const ir = this.winInner();
    if (ir) {
      const Z = this.scene.Z, s0 = this.scene.sOf(0);
      const hwW = ir.w / 2 / (Z * s0), hhW = ir.h / 2 / (Z * s0);
      tx = clamp(tx, -T.W / 2 + hwW - 10, T.W / 2 - hwW + 10);
      if (hwW * 2 > T.W) tx = 0;
      ty = clamp(ty, hhW - 6, T.H - hhW + 4);
    }
    const k = wc.snap ? 1 : Math.min(1, dt * 1.5);
    wc.snap = false;
    wc.x = lerp(wc.x, tx, k); wc.y = lerp(wc.y, ty, k);
  }

  // New tank tier: re-map the tank's contents; when visible (or the next time it is) the tank grows.
  changeTier(tier) {
    const from = this.tier;
    const old = this.shape;
    const T = new SideShape(tier);
    const map = (p) => {
      const u = p[0] / old.W, fy = old.floorY(p[0], p[2]);
      const y01 = clamp01((p[1] - fy) / Math.max(1, old.waterY - fy));
      const x = u * T.W, z = (p[2] / old.D) * T.D;
      return [x, lerp(T.floorY(x, z), T.waterY, y01), z];
    };
    for (const f of this.fish) { f.p = map(f.p); f.target = null; }
    for (const c of this.drops.list) c.p = map(c.p);
    for (const p of this.food) p.p = map(p.p);
    this.bubbles.length = 0;
    this.tier = tier;
    this.shape = T;
    for (const f of this.fish) T.clamp(f.p, f.len * 0.45);
    this.camX = clamp(this.camX * (T.W / old.W), -T.W / 2, T.W / 2);
    this.syncPieces();
    this.scene.invalidate();
    const grow = tier > from ? { from: [old.W / T.W, old.H / T.H, old.waterY / T.waterY].map((k) => clamp(k, 0.2, 1)) } : null;
    if (grow && this.visibleKey === 'full') this.startGrow(grow);
    else if (grow) this.pendingGrow = grow;
    this.game.recomputeStats?.();
    if (tier > from) {
      this.game.toast?.(`Tank upgraded: ${TANK_TIERS[tier].name}!`, 'tank', 4);
      this.game.emit?.('tankUpgraded', { from, to: tier });
    }
  }

  startGrow(grow) {
    this.growAnim = { t: 0, from: grow.from, fx: 0 };
    this.sfx('ui_unlock', { vol: 0.8 });
    this.sfx('travel_whoosh', { vol: 0.5 });
  }
  // the box grows with an elastic overshoot; the water rises a beat later
  growK() {
    const a = this.growAnim;
    if (!a) return null;
    const u = clamp01((a.t - 0.3) / 1.6), w = clamp01((a.t - 0.7) / 1.5);
    // slide out with a little bounce at the end; the water rises a beat later
    const io = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const e = io + 0.07 * Math.sin(Math.PI * clamp01((u - 0.55) / 0.45)) * (u < 1 ? 1 : 0);
    const ew = 1 - Math.pow(1 - w, 3);
    return [lerp(a.from[0], 1, e), lerp(a.from[1], 1, Math.min(1, e * 1.02)), lerp(a.from[2] * a.from[1], 1, ew)];
  }
  updateGrow() {
    const a = this.growAnim, T = this.shape;
    if (a.fx === 0 && a.t > 0.6) {
      a.fx = 1; this.sfx('splash_big', { vol: 0.6 }); this.sfx('bubbles', { vol: 0.5 });
      for (let i = 0; i < 40; i++) this.addBubble([rng.float(-0.5, 0.5) * T.W, rng.float(10, T.waterY * 0.5), rng.float(-0.4, 0.4) * T.D], rng.float(1, 3));
    }
    if (a.fx === 1 && a.t > 1.6) { a.fx = 2; this.fxAt([this.camX, T.top * 0.8, T.D / 2], 'confetti', 40); this.sfx('sparkle', { vol: 0.7 }); }
    if (a.t > 3) this.growAnim = null;
  }

  // ------------------------------------------------------------------ input
  slideOff() { return Math.round((1 - clamp01(this.winAnim) ** 0.5) * 14); }

  handleInput(dt, inp) {
    const g = this.game;
    const vk = this.visibleKey;
    this.hoverFish = null; this.hoverDecor = null; this.hoverBtn = null;
    const tip = (t) => { if (g.desktop) g.desktop.tooltip = t; };
    if (!inp || !vk) {
      if (this.drag && (!inp || !inp.down)) this.drag = null;
      if (!inp || !inp.down) this.press = null;
      this.prevCur = null;
      return;
    }
    if (vk === 'window') { this.windowInput(dt, inp, tip); return; }
    if (this.build.on) { this.build.input(inp, tip); this.prevCur = null; return; }
    // ---- full view: HUD first
    for (const b of this.fullButtons()) {
      if (!rectContains(b, inp.x, inp.y)) continue;
      this.hoverBtn = b.id;
      if (b.tip) tip(b.tip);
      if (inp.pressed) { inp.consume(); this.press = null; b.run(); }
      this.prevCur = null;
      return;
    }
    if (this.panel && g.input?.keyPressed('Escape')) { this.panel = null; g.input.keysPressed?.delete?.('Escape'); this.sfx('ui_close', { vol: 0.35 }); }
    if (this.panel === 'gear') {
      const pr = this.gearPanelRect();
      if (rectContains(pr, inp.x, inp.y)) { this.panelInput(inp, tip); return; }
      if (inp.pressed) { this.panel = null; inp.consume(); return; }
    }
    if (this.panel === 'feed' && this.feedPanelInput(inp, tip)) { this.prevCur = null; return; }
    const cam = this.fullCam();
    const Z = cam.Z;
    // ---- press: a click (feed, pet, poke, open a building) or a drag (scroll the tank)
    const pr = this.press;
    if (pr) {
      const dx = inp.x - pr.lx;
      if (Math.hypot(inp.x - pr.x, inp.y - pr.y) > 5) pr.moved = true;
      if (inp.down) {
        if (pr.moved && this.scene.scrollMax() > 0) { pr.panning = true; this.camX -= dx / Z; this.camV = -dx / Z / Math.max(1 / 120, dt); this.follow = null; }
      } else {
        this.press = null;
        if (!pr.moved && !pr.collected) this.click(pr, inp.x, inp.y, cam);
      }
      if (this.press) { this.press.lx = inp.x; this.press.ly = inp.y; }
    }
    // ---- hover: pieces, fish, drops
    const [wx, wy] = this.scene.unproj(inp.x, inp.y, this.shape.D / 2 - 8, cam);
    this.cursor3 = { p: [wx, clamp(wy, 0, this.shape.waterY), this.shape.D / 2 - 10], speed: inp.speed || 0, t: this.t };
    const feeding = this.panel === 'feed';
    const hf = feeding ? null : this.pickFish(inp.x, inp.y);
    const hd = hf || feeding ? null : this.pickPiece(inp.x, inp.y);
    this.hoverDecor = hd; this.hoverFish = hf;
    this.shakeCur = feeding && this.inWater(inp.x, inp.y, cam) ? { x: inp.x, y: inp.y } : null;
    if (this.shakeCur && !pr?.panning) tip(`{mouse_l} Sprinkle ${FOODS[this.foodType].name}`);
    else if (hd && !pr?.panning) {
      if (hd.kind === 'building') tip(`${this.buildingName(hd)}\n{mouse_l} Open`);
      else tip(`${PROPS[hd.id]?.name || 'Decoration'}\n{mouse_l} ${propInteract(hd.id)?.verb || 'Poke'}`);
    } else if (hf) tip(this.fishTip(hf));
    if (inp.wheel && this.scene.scrollMax() > 0) { this.camV += inp.wheel * 260 / Z; this.follow = null; }
    this.sweepDrops(inp.x, inp.y, inp.down && !pr?.panning);
    if (inp.pressed && !this.press) {
      inp.consume();
      this.press = { x: inp.x, y: inp.y, lx: inp.x, ly: inp.y, moved: false, collected: false };
      this.camV = 0;
    }
    if (inp.rpressed) inp.rpressed = false;
  }

  // the screen point is over the tank's water (or the air gap under the lid)
  inWater(x, y, cam) {
    const b = this.scene.box;
    if (!b || x < b.fx0 || x > b.fx1 || y < b.fy0 || y > b.fy1) return false;
    const [wx, wy] = this.scene.unproj(x, y, 0, cam);
    return Math.abs(wx) < this.shape.W / 2 && wy > this.shape.floorY(wx, 0) - 6;
  }

  buildingName(p) { return this.game.build?.defName?.(p.id) || p.id; }

  click(pr, x, y, cam) {
    if (this.scene.hoodRect && rectContains(this.scene.hoodRect, x, y) && y < this.scene.hoodRect.y + this.scene.hoodRect.h - 2) {
      this.st.tank.lampOff = !this.st.tank.lampOff;
      this.sfx('click', { vol: 0.6, pitch: this.st.tank.lampOff ? 0.8 : 1.25 });
      this.game.save?.();
      return;
    }
    if (this.panel === 'feed' && this.inWater(x, y, cam)) {
      const [wx] = this.scene.unproj(x, y, 0, cam);
      this.sprinkle(clamp(wx, -this.shape.W / 2 + 6, this.shape.W / 2 - 6), rng.float(-0.25, 0.25) * this.shape.D);
      return;
    }
    const f = this.pickFish(x, y);
    if (f) { this.pet(f); return; }
    const d = this.pickPiece(x, y);
    if (d) {
      if (d.kind === 'building') { d.squashV += 5; this.sfx('click', { vol: 0.5 }); this.game.build?.interact?.(d.rec); return; }
      this.interact(d);
      return;
    }
    // in the water: sprinkle food where you clicked
    const [wx, wy] = this.scene.unproj(x, y, 0, cam);
    if (wy > 0 && Math.abs(wx) < this.shape.W / 2) this.sprinkle(wx, rng.float(-0.25, 0.25) * this.shape.D);
  }

  // drops pop when the cursor passes over them (a held button sweeps a wider path)
  sweepDrops(lx, ly, sweep) {
    const rad = (this.stats.collectRadius || 14) * (this.visibleKey === 'window' ? 0.85 : 1);
    const p0 = this.prevCur || { x: lx, y: ly };
    for (let i = this.drops.list.length - 1; i >= 0; i--) {
      const c = this.drops.list[i];
      const sc = c.screen;
      if (!sc) continue;
      const rr = (sweep ? rad * 1.35 : rad) * 0.6 + sc.r + (c.hint ? 18 : 0);
      const d = sweep ? segDist(sc.x, sc.y, p0.x, p0.y, lx, ly) : Math.hypot(sc.x - lx, sc.y - ly);
      if (d < rr) { this.collectCoin(c, 'player'); if (this.press) this.press.collected = true; }
    }
    this.prevCur = { x: lx, y: ly };
  }

  pickFish(x, y) {
    let best = null, bd = Infinity;
    for (const f of this.fish) {
      const s = f.screen;
      if (!s) continue;
      const d = Math.hypot((s.x - x) * 0.8, s.y - y);
      if (d < s.r * 0.75 + 3 && d < bd) { bd = d; best = f; }
    }
    return best;
  }
  // pixel-accurate pick of a placed piece (front-most first)
  pickPiece(x, y, ex = null) {
    const list = this.decor.filter((d) => d !== ex && d.screen).sort((a, b) => (a.l - b.l) || (b.order - a.order));
    for (const d of list) {
      const s = d.screen;
      if (x < s.x || y < s.y || x >= s.x + s.w || y >= s.y + s.h) continue;
      if (alphaAt(s.canvas, (x - s.x) / s.k, (y - s.y) / s.k) > 40) return d;
    }
    return null;
  }

  windowInput(dt, inp, tip) {
    const g = this.game, tw = g.state.tankWindow;
    const r = this.windowRect();
    if (!r) return;
    if (this.drag?.kind === 'window') {
      if (inp.down) { tw.x = Math.round(inp.x - this.drag.dx); tw.y = Math.round(inp.y - this.drag.dy); this.clampWindow(); }
      else this.drag = null;
      return;
    }
    const btns = this.chromeButtons(r);
    for (const b of btns) if (rectContains(b, inp.x, inp.y)) this.hoverBtn = b.id;
    const pr = this.press;
    if (pr) {
      if (Math.hypot(inp.x - pr.x, inp.y - pr.y) > 4) pr.moved = true;
      if (inp.down) {
        if (pr.moved && pr.kind === 'lid') { this.drag = { kind: 'window', dx: pr.x - tw.x, dy: pr.y - tw.y }; this.press = null; }
      } else {
        this.press = null;
        if (!pr.moved && !pr.collected) {
          const tut = g.tutorial?.active && (g.tutorial.step === 'tank' || g.tutorial.step === 'coin');
          const grab = pr.kind === 'glass' && (tut || this.t - (this.lastGrabT ?? -9) < 0.6);
          if ((pr.kind === 'lid' && !tut) || (pr.kind === 'glass' && !grab)) { this.openFull(); return; }
        }
      }
    }
    if (inp.y < r.y + FRAME.lid + this.slideOff()) {
      if (this.hoverBtn) tip(btns.find((b) => b.id === this.hoverBtn).tip);
      else if (!this.press) tip('{mouse_l} Open the aquarium\n{mouse_hold} Drag to move');
      if (inp.pressed) {
        inp.consume();
        if (this.hoverBtn === 'close') this.closeWindow();
        else if (this.hoverBtn === 'expand') this.openFull();
        else this.press = { kind: 'lid', x: inp.x, y: inp.y };
      }
      return;
    }
    const ir = this.winInner();
    const inScene = ir && rectContains(ir, inp.x, inp.y);
    if (!inScene) { if (inp.pressed) inp.consume(); return; }
    this.sweepDrops(inp.x, inp.y, inp.down);
    const hf = this.pickFish(inp.x, inp.y);
    this.hoverFish = hf;
    if (hf) tip(this.fishTip(hf) + '\n{mouse_l} Open the aquarium');
    if (inp.pressed) { inp.consume(); this.press = { kind: 'glass', x: inp.x, y: inp.y, collected: false }; }
  }

  chromeButtons(r) {
    const y = r.y + 2 + this.slideOff();
    return [
      { id: 'close', x: r.x + r.w - 25, y, w: 21, h: 11, tip: 'Close', icon: 'cross', tone: 'red' },
      { id: 'expand', x: r.x + r.w - 44, y, w: 18, h: 11, tip: 'Full-screen aquarium (A)', icon: 'expand', tone: 'aqua' },
    ];
  }

  // HUD size factor: follows the game's UI size setting (uiK()), clamped to fit the screen
  hudK() { let k = 1.25; try { k = uiK(); } catch { /* aero not ready */ } return clamp(Math.min(k, this.game.screen.W / 620, this.game.screen.H / 380), 1, 2.2); }
  statFont() { return this.hudK() >= 1.4 ? 'big' : 'normal'; }
  // the top plate: [tank name in voxel letters][fish][happiness][Aero/min] wells, the Ocean button beside it and the
  // scroll rail under it; the right dock column of voxel tiles (Build, Feed, Fish, Gear, Light)
  fullLayout() {
    const key = this.t + '|' + this.game.screen.W + '|' + this.game.screen.H + '|' + this.tier;
    if (this.layKey === key && this.lay) return this.lay;
    this.layKey = key;
    return (this.lay = this.computeLayout());
  }
  computeLayout() {
    const { W, H } = this.game.screen, k = this.hudK();
    const R = Math.round;
    const sm = this.tankSummary();
    const font = this.statFont();
    const ph = R(26 * k), y = 5;
    const nameC = text3dCanvas(this.tierInfo().name, { palette: 'white', size: 16, depth: 2 });
    const nameW = R(Math.max(nameC ? nameC.width : measureText(this.tierInfo().name, 'big') + 12, 40) + 14 * k);
    const icW = R(13 * k), wellPad = R(6 * k), wh = ph - R(9 * k);
    const vals = [`${sm.fish}/${sm.cap}`, sm.fish ? `${Math.round(sm.happiness * 100)}%` : '--', `${sm.aeroPerMin.toFixed(1)}/min`];
    const wells = vals.map((v, i) => ({ v, w: icW + R(4 * k) + Math.max(measureText(i === 2 ? '000.0/min' : i === 1 ? '100%' : '00/00', font), measureText(v, font)) + wellPad * 2, h: wh, icon: ['fish', 'heart', 'coin'][i] }));
    const pad = R(7 * k), gap = R(4 * k);
    const pw = pad * 2 + nameW + wells.reduce((a, q) => a + q.w + gap, 0);
    const bw = R(66 * k), bgap = R(6 * k);
    const x0 = R(W / 2 - (pw + bgap + bw) / 2);
    const plate = { x: x0, y, w: pw, h: ph, nameW };
    let wx = x0 + pad + nameW + gap;
    for (const q of wells) { q.x = wx; q.y = y + R((ph - R(3 * k) - wh) / 2); wx += q.w + gap; }
    const btn = { x: x0 + pw + bgap, y: y + R(1 * k), w: bw, h: ph - R(2 * k) };
    const rail = { x: R(plate.x + plate.w * 0.16), y: y + ph + R(3 * k), w: R(plate.w * 0.68), h: Math.max(5, R(5 * k)) };
    // dock
    const kd = clamp(Math.min(k, (H - 150) / (5 * 46)), 0.8, 2);
    const B = R(30 * kd), lab = R(10 * kd), dpad = R(5 * kd), dgap = R(4 * kd);
    const cell = B + lab + dgap;
    const dw = B + dpad * 2, dh = 5 * cell - dgap + dpad * 2;
    // a full-height tool rail at the right edge (it hides the room behind it, so no slivers peek past the tank)
    const dx = W - dw - R(3 * kd);
    const top = rail.y + rail.h + R(4 * k);
    const dy = top + R(4 * kd), dhFull = Math.max(dh, this.hudBottom() - dy - R(6 * kd));
    const dock = { x: dx, y: dy, w: dw, h: dhFull, B, lab, pad: dpad, cell, kd, ty: dy + R((dhFull - dh) / 2) };
    return { k, plate, wells, btn, rail, dock, font, top };
  }
  fullButton() { return this.fullLayout().btn; }

  fullButtons() {
    const g = this.game;
    const L = this.fullLayout();
    const out = [{ id: 'back', ...L.btn, run: () => g.setView?.('ocean'), tip: 'Back to the ocean' }];
    out.push({ id: 'pill', ...L.plate, run: () => {}, tip: `${this.tierInfo().name}\n{fish} ${this.fish.length}/${this.capacity()}  {coin} ${this.ratePerMin().toFixed(1)} Aero/min` });
    const D = L.dock;
    const lampOff = this.st.tank.lampOff;
    const dock = [
      { id: 'build', icon: 'hammer', label: 'Build', tip: 'Build & decorate your tank (U)', run: () => { this.panel = null; this.build.enter(); }, tint: '#5ccc3c' },
      { id: 'feed', icon: 'food', label: 'Feed', tip: `Feed your fish: ${FOODS[this.foodType].name}\nClick the water to sprinkle more`, run: () => this.toggleFeed(), on: this.panel === 'feed', tint: '#ff9a3a' },
      { id: 'fish', icon: 'fishdex', label: 'Fish', tip: 'Manage your fish (F)', run: () => { this.panel = null; if (g.ui?.panels?.fishmgr) g.ui.open('fishmgr'); }, tint: '#38b8f2' },
      { id: 'gear', icon: 'gear', label: 'Gear', tip: 'Upgrade & expand the tank', run: () => { this.panel = this.panel === 'gear' ? null : 'gear'; this.sfx(this.panel ? 'ui_open' : 'ui_close', { vol: 0.4 }); }, on: this.panel === 'gear', tint: '#a674f4' },
      { id: 'light', icon: lampOff ? 'moon' : 'sun', label: 'Light', tip: lampOff ? 'Light on' : 'Light off', run: () => { this.st.tank.lampOff = !this.st.tank.lampOff; this.sfx('click', { vol: 0.6, pitch: this.st.tank.lampOff ? 0.8 : 1.25 }); this.game.save?.(); }, tint: lampOff ? '#6a7ae8' : '#ffc83a' },
    ];
    dock.forEach((b, i) => out.push({ ...b, x: D.x + D.pad, y: D.ty + D.pad + i * D.cell, w: D.B, h: D.B + D.lab, tile: D.B, dock: true, kd: D.kd }));
    return out;
  }

  // ------------------------------------------------------------------ feeding tray
  toggleFeed() {
    if (this.panel === 'feed') { this.panel = null; this.sfx('ui_close', { vol: 0.35 }); return; }
    this.panel = 'feed';
    this.sfx('ui_open', { vol: 0.35 });
    this.feedHere();
  }
  // a pinch over the middle of the view (near the fish when they are around)
  feedHere(type = this.foodType) {
    const T = this.shape, c = this.fullCam();
    const vw = (this.scene.viewW() / c.Z) * 0.5;
    const near = this.fish.filter((f) => Math.abs(f.p[0] - this.camX) < vw);
    const cx = near.length ? near.reduce((a, f) => a + f.p[0], 0) / near.length : this.camX;
    const x = clamp(cx + rng.float(-0.15, 0.15) * vw, this.camX - vw * 0.8, this.camX + vw * 0.8);
    this.sprinkle(clamp(x, -T.W / 2 + 10, T.W / 2 - 10), rng.float(-0.2, 0.2) * T.D, null, type);
    this.shakeAt = null;
  }
  feedPanelRect() {
    const L = this.fullLayout(), D = L.dock, kd = D.kd;
    const R = Math.round;
    const fb = this.fullButtons().find((b) => b.id === 'feed');
    const pad = R(6 * kd), gap = R(5 * kd), B = D.B, titleH = R(12 * kd);
    const w = pad * 2 + FOOD_IDS.length * (B + gap) - gap, h = pad * 2 + titleH + B + D.lab;
    const x = D.x - R(8 * kd) - w, y = R(clamp(fb.y + fb.h / 2 - h / 2 - titleH / 2, L.top + 4, this.game.screen.H - h - 10));
    const chips = FOOD_IDS.map((id, i) => ({ id, x: x + pad + i * (B + gap), y: y + pad + titleH, w: B, h: B + D.lab, B }));
    return { x, y, w, h, kd, pad, titleH, chips };
  }
  feedPanelInput(inp, tip) {
    const r = this.feedPanelRect();
    if (!rectContains(r, inp.x, inp.y)) return false;
    for (const c of r.chips) {
      if (!rectContains(c, inp.x, inp.y)) continue;
      this.hoverBtn = 'food:' + c.id;
      tip(`${FOODS[c.id].name}\n${FOODS[c.id].tip}`);
      if (inp.pressed) {
        inp.consume();
        this.st.tank.food = c.id;
        this.chipPop = { id: c.id, t: this.t };
        this.sfx('ui_click', { vol: 0.5, pitch: 1.1 + FOOD_IDS.indexOf(c.id) * 0.08 });
        this.feedHere(c.id);
      }
      return true;
    }
    if (inp.pressed) inp.consume();
    return true;
  }

  // ------------------------------------------------------------------ gear panel
  panelK() { return clamp(Math.min(this.hudK(), (this.game.screen.H - 60) / (34 + 58 + GEAR.length * 34 + 16)), 1, 2); }
  gearPanelRect() {
    const { W, H } = this.game.screen;
    const k = this.panelK();
    const D = this.fullLayout().dock;
    const w = Math.round(300 * k), h = Math.min(H - 50, Math.round((34 + 58 + GEAR.length * 34 + 16) * k));
    return { x: (D ? D.x : W - 42) - 10 - w, y: Math.max(36, Math.round(H / 2 - h / 2)), w, h, k };
  }
  gearRows() {
    const r = this.gearPanelRect(), k = r.k;
    const rows = [];
    let y = r.y + Math.round(34 * k);
    rows.push({ kind: 'tier', x: r.x + 8, y, w: r.w - 16, h: Math.round(52 * k), k });
    y += Math.round(58 * k);
    for (const gdef of GEAR) { rows.push({ kind: 'gear', g: gdef, x: r.x + 8, y, w: r.w - 16, h: Math.round(30 * k), k }); y += Math.round(34 * k); }
    return rows;
  }
  panelInput(inp, tip) {
    for (const row of this.gearRows()) {
      const b = this.rowButton(row);
      if (!b || !rectContains(b, inp.x, inp.y)) continue;
      this.hoverBtn = 'row:' + (row.g?.id || 'tier');
      if (b.tip) tip(b.tip);
      if (inp.pressed) { inp.consume(); b.run(); }
      return;
    }
    if (inp.pressed) inp.consume();
  }
  rowButton(row) {
    const k = row.k || 1;
    const bw = Math.round(92 * k), bh = Math.round(20 * k), bx = row.x + row.w - bw - 4;
    if (row.kind === 'tier') {
      const next = this.tier + 1;
      if (next >= TANK_TIERS.length) return null;
      const nd = nodeFor('tank', TANK_IDS[next]);
      return { x: bx, y: row.y + row.h - bh - 4, w: bw, h: bh, label: 'Open Lab', tip: `Research ${nd?.name || TANK_TIERS[next].name} in The Lab to expand`, run: () => { this.panel = null; this.game.command?.('lab'); } };
    }
    const lv = gearLevel(this.st, row.g.id);
    if (lv >= row.g.levels.length - 1) return null;
    const cost = gearCost(row.g.id, lv + 1);
    return { x: bx, y: Math.round(row.y + (row.h - bh) / 2), w: bw, h: bh, label: fmtAero(cost), cost, tip: `${row.g.levels[lv + 1]}\n${row.g.desc}`, run: () => this.buyGear(row.g.id) };
  }

  // ------------------------------------------------------------------ simulation
  simWorld() {
    const decor = this.decor.map((d) => ({ p: this.pieceWorld(d), r: d.screen ? d.screen.w / 2 / Math.max(0.3, this.scene.Z * this.scene.sOf(this.scene.layerZ(d.l))) * 0.6 : 14, h: d.screen ? d.screen.h / Math.max(0.3, this.scene.Z) * 0.8 : 30 }));
    return {
      tank: this.shape, fish: this.fish, food: this.feed.live(), decor: decor.filter((d) => d.p[2] > -this.shape.D / 2 + 6), night: this.nightK > 0.6,
      avatar: null,
      cursor: this.visibleKey === 'full' && !this.build.on && this.cursor3 && this.t - this.cursor3.t < 0.5 ? this.cursor3 : null,
      onEat: (f, food) => this.onEat(f, food), canCourt: (f) => this.canCourt(f), onCourt: (a, b) => this.onCourt(a, b),
      onStartle: (f) => { for (let i = 0; i < 3; i++) this.addBubble(f.p, rng.float(0.8, 1.6)); },
    };
  }

  pet(f) {
    f.say('heart', 1.2);
    f.poke(7);
    f.rec.happiness = Math.min(1, (f.rec.happiness ?? 0.7) + 0.01);
    this.sfx(f.sp.sound || 'blub', { vol: 0.35, pitch: 1.2 });
    this.fxAt(f.p, 'hearts', 2);
  }

  // shake a pinch of the chosen food into the water over (x, z); n = pieces (default: the food's pinch)
  sprinkle(x, z, n = null, type = this.foodType) {
    if (this.feed.items.length > 80) return;
    this.feed.drop(type, x, z, n ?? null);
    this.shakeT = 0.45;
    // the shaker rattles a few times
    for (let i = 0; i < 3; i++) this.sfxQ.push({ at: i * 0.09, name: 'click', o: { vol: 0.16, pitch: rng.float(1.9, 2.4) } });
    this.sfxQ.push({ at: 0.22, name: 'bubble', o: { vol: 0.2, pitch: 1.5 } });
    if (this.visibleKey === 'full') this.fedT = this.t;
  }

  addBubble(p, r) {
    if (this.bubbles.length > 160) this.bubbles.shift();
    this.bubbles.push({ p: p.slice(), r: Math.max(0.6, r), vy: 0, wob: rng.float(0, TAU) });
  }

  updateFood(dt) {
    this.feed.step(dt);
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
  }

  updateFish(dt) {
    const W = this.simWorld();
    for (const f of this.fish) { f.update(dt, W); if (f.chomp > 0) f.chomp -= dt; }
  }

  updateDecor(dt) {
    for (const d of this.decor) {
      // pieces dropped into the tank sink to the floor and land with a squash and a sand puff
      if (d.lift > 0) {
        d.vy = Math.max(-260, (d.vy || 0) - 420 * dt);
        d.lift += d.vy * dt;
        if (d.lift <= 0) { d.lift = 0; if (d.vy < -40) { d.squashV += Math.min(9, -d.vy * 0.03); this.puff(this.pieceWorld(d), 14, 8); this.sfx('box_close', { vol: 0.3, pitch: 0.8 }); } d.vy = 0; }
      }
      d.squashV += (-d.squash * 160 - d.squashV * 9) * dt;
      d.squash = clamp(d.squash + d.squashV * dt, -0.45, 0.45);
      if (d.hop > 0) d.hop = Math.max(0, d.hop - dt * 14);
      if (d.shake > 0) d.shake = Math.max(0, d.shake - dt);
      if (d.coinCd > 0) d.coinCd -= dt;
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
      if (rec.coinT >= val && !this.growAnim) { rec.coinT -= val; this.dropCoin(f, d); }
      if (rec.hunger > 0.62 && rng.chance(dt * 0.04) && !f.emote && f.state !== 'sleep') f.say('food', 1.6);
      else if ((rec.happiness ?? 0) > 0.85 && rng.chance(dt * 0.015) && !f.emote && f.state !== 'sleep') f.say('heart', 1.2);
      if (rng.chance(dt * 0.25)) this.addBubble(f.p, rng.float(0.6, 1.2));
    }
    this.moodT -= dt;
    if (this.moodT <= 0) {
      const step = 0.5 - this.moodT;
      this.moodT = 0.5;
      const cap = this.capacity();
      const crowd = 1 - clamp01((n / cap - 0.65) / 0.7) * 0.6;
      const decor = clamp01((this.decor.length + (TANK_TIERS[this.tier]?.plants || 4) * 0.2) / (1.5 + n * 0.35) + this.tier * 0.06);
      const gh = gearHappy(this.st);
      const k = 1 - Math.exp(-step / 40);
      for (const f of this.fish) {
        const rec = f.rec;
        const fed = 1 - smoothstep(0.35, 1, rec.hunger ?? 0.3);
        const same = this.fish.filter((o) => o.sp === f.sp).length - 1;
        const comp = same >= 1 ? 1 : f.sp.move?.school > 0 ? 0.3 : 0.6;
        const target = clamp01(0.38 * fed + 0.2 * crowd + 0.24 * decor + 0.18 * comp + gh);
        rec.happiness = clamp01((rec.happiness ?? 0.7) + (target - (rec.happiness ?? 0.7)) * k);
      }
    }
    if (s.feeder && n) {
      this.feederT -= dt;
      if (this.feederT <= 0) {
        this.feederT = 40;
        const avg = this.fish.reduce((a, f) => a + (f.rec.hunger ?? 0), 0) / n;
        if (avg > 0.4 && this.food.length < 6) { this.sprinkle(this.shape.W * 0.25, 0, 8); this.sfx('click', { vol: 0.4 }); }
      }
    }
  }

  // The snail janitor (stats.autoCollect >= 1) glides along the front glass under the waterline and slurps drops.
  updateSnail(dt) {
    const ac = this.stats.autoCollect || 0;
    if (ac < 1) { this.snail = null; return; }
    const T = this.shape;
    const s = (this.snail ||= { x: 0, dir: 1, t: 0 });
    s.t += dt;
    const rest = this.drops.list.filter((c) => c.sleep && !c.hint);
    let tx = Math.sin(s.t * 0.05) * T.W * 0.4;
    if (rest.length) { rest.sort((a, b) => Math.abs(a.p[0] - s.x) - Math.abs(b.p[0] - s.x)); tx = rest[0].p[0]; }
    const sp = 22 * (1 + ac * 0.2);
    s.dir = tx > s.x ? 1 : -1;
    s.x += clamp(tx - s.x, -sp * dt, sp * dt);
    s.x = clamp(s.x, -T.W / 2 + 10, T.W / 2 - 10);
    s.p = [s.x, T.waterY - 9, T.D / 2 - 1];
    for (const c of rest) if (Math.abs(c.p[0] - s.x) < c.r + 6) { this.collectCoin(c, 'helper'); break; }
  }

  autoCollect(dt) {
    const ac = Math.min(AUTO_POP.length - 1, Math.max(0, Math.floor(this.stats.autoCollect || 0)));
    if (!ac) return;
    this.autoT = (this.autoT || 0) - dt;
    if (this.autoT > 0) return;
    this.autoT = 0.15;
    for (const c of this.drops.list) { if (c.hint || c.rest < AUTO_POP[ac]) continue; this.collectCoin(c, 'auto'); break; }
  }

  updateEggs(dt) {
    const eggs = this.st.tank.eggs;
    for (let i = eggs.length - 1; i >= 0; i--) { const e = eggs[i]; e.t += dt; if (e.t >= e.dur) { eggs.splice(i, 1); this.hatch(e); } }
  }

  updateBubbles(dt) {
    const T = this.shape;
    let w = 0;
    for (const b of this.bubbles) {
      b.wob += dt * 5;
      b.vy = Math.min(b.vy + dt * 60, 30 + b.r * 14);
      b.p[1] += b.vy * dt;
      b.p[0] += Math.sin(b.wob) * 5 * dt;
      if (b.p[1] >= T.waterY - b.r * 0.5) { if (b.r > 1.6) this.ripples.add(b.p[0], b.p[2], 0.12); continue; }
      this.bubbles[w++] = b;
    }
    this.bubbles.length = w;
  }

  // ------------------------------------------------------------------ decor interactions
  interact(d, quiet = false) {
    if (typeof d === 'string') d = this.decor.find((q) => q.id === d);
    if (!d) return false;
    if (quiet) { d.squashV += 3; this.sfx('click', { vol: 0.35, pitch: 1.2 }); return true; }
    const spec = propInteract(d.id) || { sfx: [], fx: [], squash: 0.1 };
    d.squashV += (spec.squash ?? 0.1) * 40 + 3;
    d.hop = spec.squash > 0.15 ? 3 : 0;
    if (spec.shake) d.shake = spec.shake;
    for (const e of spec.sfx || []) this.sfxQ.push({ at: e.at || 0, name: e.name, o: { vol: e.vol ?? 0.6, pitch: e.pitch } });
    const wp = this.pieceWorld(d);
    const h = d.screen ? d.screen.h / Math.max(0.3, this.scene.Z) : 30;
    const top = [wp[0], wp[1] + h * 0.9, wp[2]];
    for (const f of spec.fx || []) this.sfxQ.push({ at: f.at || 0, fx: f.kind, p: f.from === 'center' ? [wp[0], wp[1] + h * 0.5, wp[2]] : top, n: f.n || 6, text: f.text });
    const near = this.fish.filter((f) => Math.abs(f.p[0] - wp[0]) < this.shape.H * 0.8);
    if (spec.fish === 'gather' || spec.fish === 'dance') for (const f of near) { f.setState('gather'); f.gather = { p: [wp[0], wp[1] + h * 0.7, wp[2]], r: h * 0.5 + f.len, time: 4, dance: spec.fish === 'dance' }; }
    if (spec.fish === 'flee') for (const f of near) { const away = [f.p[0] * 2 - wp[0], f.p[1] + 20, f.p[2]]; this.shape.clamp(away, f.len); f.setState('flee', away); f.say('!', 1); }
    if (spec.coin && !(d.coinCd > 0)) { d.coinCd = spec.coin.cooldown || 30; this.sfxQ.push({ at: spec.coin.at || 0.3, coin: true, p: top }); }
    this.game.emit?.('decorPlayed', { id: d.id });
    return true;
  }
  useDecor(d) { return this.interact(d); }

  runSfxQueue(dt) {
    if (!this.sfxQ.length) return;
    for (const e of this.sfxQ) e.at -= dt;
    const due = this.sfxQ.filter((e) => e.at <= 0);
    this.sfxQ = this.sfxQ.filter((e) => e.at > 0);
    for (const e of due) {
      if (e.name) this.sfx(e.name, e.o);
      if (e.fx) this.fxAt(e.p, e.fx, e.n, 0, e.text);
      if (e.coin) { const p = e.p.slice(); this.shape.clamp(p, 4); this.drops.spawn(p, 1, { v: [0, 6, 0] }); }
    }
  }

  // effects at a tank point: real bubbles in the water + screen-space pixel particles
  fxAt(p, kind, n = 6, r = 0, text = null) {
    if (kind === 'food') { this.sprinkle(p[0], p[2], Math.min(8, n)); return; }
    if (kind === 'bubbles' || kind === 'foam' || kind === 'steam' || kind === 'smoke') { for (let i = 0; i < n; i++) this.addBubble([p[0] + rng.float(-6, 6), p[1], p[2]], rng.float(0.8, 2.4)); return; }
    if (!this.visibleKey) return;
    const sp = this.project(p);
    if (!sp) return;
    const [x, y] = sp;
    const P = this.particles;
    switch (kind) {
      case 'pop': {
        const rr = Math.max(2, r * this.scene.Z);
        this.px('drop', x, y, 5, { ramp: 'aqua', speed: [30, 70], spread: 1.4 });
        this.px('sparkle', x, y, 3, { ramp: 'aqua', w: rr * 0.5, h: rr * 0.5 });
        if (n > 1) P.text(x, y - 6, '+' + fmtAero(n), { font: 'small', color: '#e8fdff', layer: 'fg', life: 0.9, vy: -16 });
        break;
      }
      case 'hearts': this.px('heart', x, y - 4, Math.max(1, n), {}); break;
      case 'text': if (text) P.text(x, y - 8, text, { font: 'small', color: '#ffffff', layer: 'fg', life: 1.6, vy: -10 }); break;
      case 'confetti': if (P.pixelBurst) this.px('confetti', x, y, n, {}); else P.confetti(x, y, n); break;
      case 'evolve': this.px('star', x, y, 10, {}); this.px('confetti', x, y, 24, {}); this.px('sparkle', x, y, 12, { ramp: 'aqua' }); break;
      case 'burst': this.px('sparkle', x, y, n, { ramps: ['aqua', 'white', 'gold'] }); this.px('puff', x, y, 3, { ramp: 'white' }); break;
      default: this.px('sparkle', x, y, Math.min(14, n), { ramps: ['aqua', 'white', 'gold'], w: 6, h: 5 }); break;
    }
    if (kind !== 'pop' && kind !== 'text') for (let i = 0; i < 3; i++) this.addBubble(p, rng.float(0.8, 1.6));
  }

  fishTip(f) {
    const rec = f.rec, sp = f.sp;
    const h = clamp01(rec.happiness ?? 0.7);
    const n = Math.round(h * 5);
    const hearts = '{heart}'.repeat(n) + '{heart_empty}'.repeat(5 - n);
    let status = '';
    if (f.state === 'sleep') status = '{zzz}';
    else if ((rec.hunger ?? 0) > 0.62) status = '{food}!';
    return `${rec.name || sp.name}${rec.bred ? ' {sparkle}' : ''}\n${sp.name}\n${hearts} ${status}\n{coin}${this.fishRate(f).toFixed(1)} Aero/min`;
  }

  // ------------------------------------------------------------------ drawing
  drawFull(ctx) {
    if (this.visibleKey !== 'full') return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cam = this.fullCam();
    this.scene.draw(ctx, cam, { grow: this.growK(), noFood: true });
    this.drawWorldMarks(ctx, cam);
    ctx.restore();
  }

  // [phase10 polish] everything over the tank in the full view draws on the full-res UI layer (game.js calls this
  // before the game HUD): the food, emotes, particles, the shaker, the top plate, the dock, panels and build mode
  drawUi(ctx) {
    if (this.visibleKey !== 'full') return;
    const cam = this.fullCam();
    const b = this.scene.box;
    if (b) {
      ctx.save();
      ctx.beginPath(); ctx.rect(b.fx0, b.fy0, b.fx1 - b.fx0, b.fy1 - b.fy0); ctx.clip();
      this.feed.draw(ctx, cam, { dark: b.dark, hi: true });
      ctx.restore();
    }
    this.drawEmotes(ctx, cam);
    this.particles.draw(ctx, 'fg', this.t);
    this.drawShaker(ctx, cam);
    this.drawHud(ctx, cam);
  }

  drawWindow(ctx) {
    if (this.visibleKey !== 'window') return;
    const r = this.windowRect();
    if (!r) return;
    const off = this.slideOff();
    const a = clamp01(this.winAnim * 1.6);
    if (a < 1) ctx.globalAlpha = a;
    const d = this.winDims();
    ctx.fillStyle = 'rgba(6,40,80,0.22)';
    ctx.fillRect(r.x + 4, r.y + off + r.h, r.w - 4, 3);
    ctx.fillRect(r.x + r.w, r.y + off + 6, 3, r.h - 3);
    drawAeroSurface(ctx, r.x, r.y + off, r.w, r.h, { tone: 'sky', r: 7, gloss: 0.7, glossH: FRAME.lid + 1, curve: 2, rim: 0.85, glow: 0.6, streak: true });
    const ir = this.winInner();
    const cam = this.winCamera();
    if (cam) {
      this.scene.draw(ctx, cam, {});
      ctx.save();
      ctx.beginPath(); ctx.rect(ir.x, ir.y, ir.w, ir.h); ctx.clip();
      this.drawOverlays(ctx, cam);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(ir.x - 1, ir.y - 1, d.sw + 2, 1);
    const sm = this.tankSummary();
    for (const b of this.chromeButtons(r)) {
      drawAeroButton(ctx, b.x, b.y, b.w, b.h, { tone: b.tone, state: this.hoverBtn === b.id ? 'hover' : 'normal', radius: 4 });
      const ic = getUiIcon(b.icon);
      if (ic) ctx.drawImage(ic, Math.round(b.x + (b.w - ic.width) / 2), Math.round(b.y + (b.h - ic.height) / 2));
    }
    drawAeroCoin(ctx, r.x + 11, r.y + off + 8, 3.5, this.t);
    drawText(ctx, this.tierInfo().name, r.x + 18, r.y + off + 4, { color: '#ffffff', shadow: '#0a3e74' });
    const by = r.y + off + r.h - FRAME.base + 3;
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
    ctx.globalAlpha = 1;
  }

  drawMini() { /* the mini window is gone (phase 4) */ }

  // overlays of the floating window view: emotes, world marks (snail, eggs) and particles
  drawOverlays(ctx, cam) {
    this.drawWorldMarks(ctx, cam);
    this.drawEmotes(ctx, cam);
    this.particles.draw(ctx, 'fg', this.t);
  }

  // emotes as little voxel icons over the fish, hover sparkles, the tutorial arrow
  drawEmotes(ctx, cam) {
    const t = this.t;
    void cam;
    for (const f of this.fish) {
      if (!f.emote || !f.screen) continue;
      const sx = f.screen.x, sy = f.screen.y - f.screen.r * 0.7;
      const k = f.emote.t / f.emote.max;
      const name = EMOTE_ICON[f.emote.icon] || f.emote.icon;
      const pop = Math.min(1, f.emote.t * 6);
      const y = Math.round(sy - 6 - pop * 4);
      ctx.globalAlpha = Math.min(1, (1 - k) * 4);
      if (name === 'dollar' || name === 'coin') drawAeroCoin(ctx, sx, y - 5, 4, t);
      else if (has3D(name) && drawIcon3D(ctx, name, sx, y - 6, 11 + (1 - pop) * 4, { t, phase: f.phase * 6 })) { /* voxel icon */ }
      else if (ICONS.has(name)) { const ic = getUiIcon(name); ctx.drawImage(ic, Math.round(sx - ic.width / 2), y - ic.height); }
      else drawText(ctx, f.emote.icon, sx, y - 8, { align: 'center', color: '#ffffff', outline: '#0c3a52' });
      ctx.globalAlpha = 1;
    }
    const hf = this.hoverFish;
    if (hf?.screen) { const r = hf.screen.r + 3; drawSparkle(ctx, hf.screen.x - r, hf.screen.y - r * 0.6, (t * 3) % 1 < 0.5 ? 2 : 1, 0.9); drawSparkle(ctx, hf.screen.x + r * 0.8, hf.screen.y + r * 0.4, (t * 3 + 0.5) % 1 < 0.5 ? 2 : 1, 0.8); }
    const hd = this.hoverDecor;
    if (hd?.screen && !this.build.on) drawSparkle(ctx, hd.screen.x + hd.screen.w / 2, hd.screen.y - 2 + Math.sin(t * 5) * 1.5, 2, 0.9);
    for (const c of this.drops.list) {
      if (!c.hint || !c.screen) continue;
      const a = getUiIcon('arrow_d');
      if (a) ctx.drawImage(a, Math.round(c.screen.x - a.width / 2), Math.round(c.screen.y - c.screen.r - 6 - a.height + Math.sin(t * 7) * 2));
      if (rng.chance(0.08)) this.particles.sparkle(c.screen.x + rng.float(-3, 3), c.screen.y + rng.float(-3, 3), '#bff8ff');
    }
  }

  // things that live in the tank's world layer: the snail janitor and egg clutches
  drawWorldMarks(ctx, cam) {
    const t = this.t, S = this.scene;
    if (this.snail?.p) {
      const q = S.proj(this.snail.p[0], this.snail.p[1], this.snail.p[2], cam);
      drawSnail(ctx, q.x, q.y, Math.max(6, 14 * cam.Z), this.snail.dir, t);
    }
    for (const e of this.st.tank.eggs) {
      const p = this.shape.floorPoint(e.x, e.z, 4);
      const q = S.proj(p[0], p[1], p[2], cam);
      for (let i = 0; i < Math.min(6, e.n || 4); i++) {
        ctx.fillStyle = i % 2 ? '#ffffff' : e.color || '#ffd8a8';
        ctx.fillRect(Math.round(q.x + (i - 2) * 3), Math.round(q.y - 3 - (i % 2) * 2 + Math.sin(t * 2 + i) * 0.5), 2, 2);
      }
    }
  }

  // the food shaker: follows the cursor over the water while the feeding tray is open and tips over to pour
  drawShaker(ctx, cam) {
    const sc = this.shakeCur;
    if (!sc || this.build.on) return;
    const pour = this.shakeT > 0;
    const s = shakerSprite(pour ? -0.75 : -0.18);
    if (!s) return;
    const w = s.width / 2, h = s.height / 2;
    const jig = pour ? Math.round(Math.sin(this.t * 48) * 1.5) : 0;
    const bob = pour ? 0 : Math.sin(this.t * 3) * 1;
    // the lid points down-left at the cursor
    const x = sc.x + 3 + jig, y = sc.y - h - 4 + bob;
    ctx.fillStyle = 'rgba(4,30,60,0.18)';
    ctx.fillRect(Math.round(x + 2), Math.round(y + h + 1), Math.round(w - 4), 2);
    ctx.drawImage(s, Math.round(x * 2) / 2, Math.round(y * 2) / 2, w, h);
    if (pour && rng.chance(0.5)) {
      const F = FOODS[this.foodType];
      this.px('sparkle', sc.x + rng.float(-2, 2), sc.y + rng.float(-1, 3), 1, { ramps: [F.cols[rng.int(0, F.cols.length - 1)]], speed: [4, 14], w: 2, h: 2 });
    }
    void cam;
  }

  // a square voxel tile for the dock / tray (lit = active)
  tileTex(D, tint, lit) {
    return aeroCached(`tanktile|${D}|${tint}|${lit ? 1 : 0}`, () => {
      const top = mix(tint, '#ffffff', lit ? 0.85 : 0.72), mid = mix(tint, '#ffffff', lit ? 0.42 : 0.24), bot = shade(tint, lit ? -0.02 : -0.16);
      const c = aeroSurface(D, D, { top, mid, bot, edge: shade(tint, -0.62), r: Math.max(5, Math.round(D * 0.24)), gloss: 0.72, glossH: Math.round(D * 0.42), curve: Math.round(D * 0.06), rim: 1, glow: 0.6, glowColor: mix(tint, '#ffffff', 0.75), sparkle: 2 });
      return c;
    });
  }
  drawTile(ctx, x, y, D, tint, o = {}) {
    const hov = o.hover ? 1 : 0, on = !!o.on;
    const lift = hov ? -2 : on ? 1 : 0;
    ctx.fillStyle = rgba(shade(tint, -0.7), 0.4);
    ctx.fillRect(Math.round(x + 3), Math.round(y + D + 1), Math.round(D - 6), 2);
    if (hov || on) drawAeroGlow(ctx, x + D / 2, y + D / 2 + lift, Math.round(D * 0.8), mix(tint, '#ffffff', 0.5), on ? 0.55 : 0.45);
    ctx.drawImage(this.tileTex(D, tint, hov || on), Math.round(x), Math.round(y + lift));
    return lift;
  }
  // a voxel icon by name (3D UI icons first, then the big menu models, then the inline icon)
  drawIcon(ctx, name, cx, cy, px, o = {}) {
    if (has3D(name) && drawIcon3D(ctx, name, cx, cy, px, { t: this.t, hover: o.hover ? 1 : 0, phase: o.phase || 0 })) return true;
    let f = null;
    try { f = iconFrame(name, Math.round(px), o.hover ? (this.t * 0.6) % 1 : Math.sin(this.t * 0.8 + (o.phase || 0)) * 0.05); } catch { f = null; }
    if (f) { ctx.drawImage(f.canvas, Math.round((cx - f.ox) * 2) / 2, Math.round((cy - f.oy) * 2) / 2); return true; }
    const ic = getUiIcon(name, 2);
    if (ic) ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(cy - ic.height / 2));
    return !!ic;
  }

  drawHud(ctx, cam) {
    const g = this.game;
    const { W, H } = g.screen;
    const t = this.t;
    if (this.build.on) { this.build.draw(ctx, cam); return; }
    const L = this.fullLayout();
    const { k, plate: p, font } = L;
    const R = Math.round;
    // ---- the top plate: a chunky aqua voxel slab with the tank's name in voxel letters and three stat wells
    ctx.fillStyle = 'rgba(3,38,74,0.2)';
    ctx.fillRect(p.x + 6, p.y + p.h + 1, p.w - 12, R(2 * k));
    drawAeroSurface(ctx, p.x, p.y, p.w, p.h, { top: '#d4f8ff', mid: '#48bcf0', bot: '#1270c0', a: [0.96, 0.98], edge: '#0b4a8a', r: R(9 * k), gloss: 0.6, glossH: R(p.h * 0.42), curve: R(2 * k), rim: 0.9, glow: 0.7, glowColor: '#8ff6ff', depth: 2, bubbles: 2, seed: 11, streak: true });
    const nameCx = p.x + R(7 * k) + p.nameW / 2;
    drawAeroSurface(ctx, p.x + R(5 * k), L.wells[0].y, p.nameW + R(4 * k), L.wells[0].h, { tone: 'deep', r: R(5 * k), inset: true, gloss: 0.25, rim: 0.5, glow: 0.4, glowColor: '#3ab0ff' });
    if (!drawPop3D(ctx, this.tierInfo().name, nameCx, L.wells[0].y + L.wells[0].h / 2 - R(1 * k), { t, palette: 'white', size: 16, depth: 2, wobble: 0.25, glow: false, sparkle: true, phase: 1.3 }))
      drawText(ctx, this.tierInfo().name, nameCx, R(p.y + p.h / 2 - 5), { align: 'center', font: 'big', color: '#ffffff', shadow: '#0a4680' });
    const ink = AERO.ink, th = font === 'big' ? 9 : 7;
    L.wells.forEach((q, i) => {
      drawAeroSurface(ctx, q.x, q.y, q.w, q.h, { tone: 'frost', r: R(5 * k), inset: true, gloss: 0.35, rim: 0.7, glow: 0.3 });
      const icx = q.x + R(5 * k) + R(6 * k), icy = q.y + q.h / 2;
      if (q.icon === 'coin') drawAeroCoin(ctx, icx, icy, R(5 * k), t);
      else if (q.icon === 'fish') { const ic = getUiIcon('fish', 2); if (ic) ctx.drawImage(ic, R(icx - ic.width / 2), R(icy - ic.height / 2)); }
      else this.drawIcon(ctx, q.icon, icx, icy, R(12 * k), { phase: i });
      drawText(ctx, q.v, q.x + R(5 * k) + R(13 * k) + R(3 * k), R(q.y + (q.h - th) / 2), { color: ink, font });
    });
    // ---- the Ocean button (a voxel button with a voxel hook)
    const bb = L.btn;
    drawAeroButton(ctx, bb.x, bb.y, bb.w, bb.h, { label: 'Ocean', icon: getUiIcon('hook'), state: this.hoverBtn === 'back' ? 'hover' : 'normal', tone: 'aqua', radius: R(8 * k) });
    this.drawScrollbar(ctx, cam, L);
    this.drawDock(ctx, this.fullButtons().filter((b) => b.dock), L);
    if (this.panel === 'feed') this.drawFeedPanel(ctx);
    if (this.panel === 'gear') this.drawGearPanel(ctx);
    const ga = this.growAnim;
    if (ga && ga.t > 0.3 && ga.t < 2.9) {
      const a = clamp01(Math.min((ga.t - 0.3) * 3, (2.9 - ga.t) * 3));
      const pop = clamp01((ga.t - 0.3) * 2.5);
      if (!drawPop3D(ctx, 'Tank expanded!', W / 2, Math.round(H * 0.2), { t, pop, alpha: a, palette: 'aqua', size: 32, depth: 4 }))
        drawText(ctx, 'Tank expanded!', W / 2, Math.round(H * 0.16), { align: 'center', color: '#ffffff', outline: '#0a3e74', scale: 2 });
      drawPop3D(ctx, this.tierInfo().name, W / 2, Math.round(H * 0.2) + 30, { t: t + 0.5, pop: clamp01(pop * 1.4 - 0.4), alpha: a, palette: 'white', size: 16, depth: 3, sparkle: false });
    }
  }

  // a voxel rail under the top plate when the tank is wider than the screen: the knob shows the view, orange
  // studs show where your fish are
  drawScrollbar(ctx, cam, L) {
    const max = this.scene.scrollMax();
    if (max <= 0) return;
    const T = this.shape, r = L.rail;
    drawAeroSurface(ctx, r.x, r.y, r.w, r.h, { tone: 'deep', r: 3, inset: true, gloss: 0.2, rim: 0.5, glow: 0 });
    const vis = clamp01((this.scene.viewW() / cam.Z) / (T.W + 68));
    const kw = Math.max(14, Math.round(r.w * vis));
    const kx = Math.round(r.x + ((this.camX + max) / (2 * max)) * (r.w - kw));
    drawAeroSurface(ctx, kx, r.y - 1, kw, r.h + 2, { tone: 'aqua', r: 3, gloss: 0.8, rim: 0.9, glow: 0.6 });
    for (const f of this.fish) {
      const u = clamp01(f.p[0] / T.W + 0.5);
      const fx = Math.round(r.x + 2 + u * (r.w - 4));
      ctx.fillStyle = '#7a3a06'; ctx.fillRect(fx - 1, r.y + 1, 2, r.h - 2);
      ctx.fillStyle = '#ffb43a'; ctx.fillRect(fx - 0.5, r.y + 1.5, 1, r.h - 3);
    }
  }

  // the dock: a column of voxel tiles with voxel icons on an aqua slab, labels under the tiles
  drawDock(ctx, dock, L) {
    if (!dock.length) return;
    const D = L.dock, R = Math.round, kd = D.kd;
    ctx.fillStyle = 'rgba(3,38,74,0.22)';
    ctx.fillRect(D.x + 6, D.y + D.h + 1, D.w - 12, R(3 * kd));
    drawAeroSurface(ctx, D.x, D.y, D.w, D.h, { top: '#d4f8ff', mid: '#48bcf0', bot: '#1270c0', a: [0.95, 0.98], edge: '#0b4a8a', r: R(9 * kd), gloss: 0.45, glossH: R(16 * kd), curve: R(2 * kd), rim: 0.9, glow: 0.7, glowColor: '#8ff6ff', depth: 2, bubbles: 3, seed: 23 });
    // voxel ornaments in the rail's spare space: bubbles on top, a starfish at the foot
    const spare = D.ty - D.y;
    if (spare > 26) {
      drawVoxDecor(ctx, 'bubbles', D.x + D.w / 2, D.y + spare / 2 + 2, Math.min(R(spare * 0.8), R(D.w * 0.62)), { t: this.t, phase: 0.6 });
      drawVoxDecor(ctx, 'starfish', D.x + D.w / 2, D.y + D.h - spare / 2 - 2, Math.min(R(spare * 0.8), R(D.w * 0.62)), { t: this.t, phase: 2.1 });
    }
    const lf = kd >= 1.2 ? 'normal' : 'small';
    dock.forEach((b, i) => {
      const hov = this.hoverBtn === b.id;
      const lift = this.drawTile(ctx, b.x, b.y, b.tile, b.tint, { hover: hov, on: b.on });
      const px = R(b.tile * 0.62);
      this.drawIcon(ctx, b.icon, b.x + b.tile / 2, b.y + b.tile / 2 + lift, px, { hover: hov, phase: i * 1.7 });
      if (b.on) drawPixelBrackets(ctx, b.x - 1, b.y - 1 + lift, b.tile + 2, b.tile + 2, this.t, { k: kd >= 1.4 ? 2 : 1 });
      if (b.id === 'feed' && this.fish.some((f) => (f.rec.hunger ?? 0) > 0.62) && !b.on) {
        // hungry fish: the feed tile bobs a little voxel bubble with a "!"
        const bx = b.x + b.tile - 2, by = b.y + 2 + Math.sin(this.t * 5) * 1.5;
        this.drawIcon(ctx, 'exclaim', bx, by, R(9 * kd), {});
      }
      drawText(ctx, b.label, b.x + b.tile / 2, R(b.y + b.tile + (D.lab - (lf === 'normal' ? 7 : 5)) / 2 + 1), { font: lf, align: 'center', color: '#ffffff', shadow: '#0a3e74' });
    });
  }

  // the feeding tray: four foods as voxel tiles; the chosen one glows
  drawFeedPanel(ctx) {
    const r = this.feedPanelRect(), R = Math.round, kd = r.kd;
    ctx.fillStyle = 'rgba(3,38,74,0.2)';
    ctx.fillRect(r.x + 6, r.y + r.h + 1, r.w - 12, R(3 * kd));
    drawAeroSurface(ctx, r.x, r.y, r.w, r.h, { tone: 'frost', r: R(9 * kd), gloss: 0.5, glossH: R(12 * kd), rim: 0.9, glow: 0.5, depth: 2, bubbles: 2, seed: 31 });
    // a little pointer toward the Feed tile
    const fb = this.fullButtons().find((b) => b.id === 'feed');
    if (fb) { const py = R(fb.y + fb.tile / 2); ctx.fillStyle = '#86c4e6'; for (let i = 0; i < 4; i++) ctx.fillRect(r.x + r.w + i, py - 4 + i, 1, 8 - i * 2); }
    const lf = kd >= 1.2 ? 'normal' : 'small';
    drawText(ctx, 'Pick a food, then click the water', r.x + r.w / 2, r.y + r.pad - 1, { font: 'small', align: 'center', color: AERO.ink });
    for (const c of r.chips) {
      const F = FOODS[c.id], on = this.foodType === c.id, hov = this.hoverBtn === 'food:' + c.id;
      const lift = this.drawTile(ctx, c.x, c.y, c.B, on ? '#ff9a3a' : '#6ac8f0', { hover: hov, on });
      const ic = foodIcon(c.id, clamp(Math.round((c.B * 2 * 0.72) / 13), 3, 7));
      if (ic) {
        const pop = this.chipPop?.id === c.id ? clamp01((this.t - this.chipPop.t) * 5) : 1;
        const s = 0.5 * (pop < 1 ? 1 + Math.sin(pop * Math.PI) * 0.25 : 1);
        const w = ic.width * s, h = ic.height * s;
        const bob = hov ? Math.sin(this.t * 6) * 1 : 0;
        ctx.drawImage(ic, Math.round((c.x + c.B / 2 - w / 2) * 2) / 2, Math.round((c.y + c.B / 2 - h / 2 + lift + bob) * 2) / 2, w, h);
      }
      if (on) drawPixelBrackets(ctx, c.x - 1, c.y - 1 + lift, c.B + 2, c.B + 2, this.t, { k: kd >= 1.4 ? 2 : 1 });
      drawText(ctx, F.short, c.x + c.B / 2, R(c.y + c.B + 2), { font: lf, align: 'center', color: on ? '#c0500a' : AERO.ink });
    }
  }

  drawGearPanel(ctx) {
    const r = this.gearPanelRect(), k = r.k;
    drawAeroPanel(ctx, r.x, r.y, r.w, r.h, { tone: 'glass', radius: 10, title: 'Tank Gear' });
    const ink = AERO.ink;
    const big = k >= 1.4, f1 = big ? 'big' : 'normal', f2 = big ? 'normal' : 'small';
    const L = (v) => Math.round(v * k);
    const icon = (name, x, y) => this.drawIcon(ctx, name, x + L(7), y + L(6), L(14), { phase: x * 0.1 });
    for (const row of this.gearRows()) {
      const b = this.rowButton(row);
      if (row.kind === 'tier') {
        drawAeroSurface(ctx, row.x, row.y, row.w, row.h, { tone: 'frost', r: 6, gloss: 0.5, rim: 0.8 });
        const ti = this.tierInfo();
        icon('tank', row.x + L(6), row.y + L(6));
        drawText(ctx, `${ti.name}  (size ${this.tier + 1}/${TANK_TIERS.length})`, row.x + L(24), row.y + L(6), { color: ink, font: f1 });
        drawText(ctx, `{fish} ${this.capacity()} fish  x${ti.rate.toFixed(2)} Aero`, row.x + L(8), row.y + L(22), { font: f2, color: ink });
        const next = TANK_TIERS[this.tier + 1];
        if (next) {
          const unlocked = tankTier(this.st) > this.tier;
          drawText(ctx, `Next: ${next.name}  +${next.cap - ti.cap} fish  x${next.rate.toFixed(2)}`, row.x + L(8), row.y + L(36), { font: f2, color: '#2a7a3a' });
          if (b) drawAeroButton(ctx, b.x, b.y, b.w, b.h, { label: unlocked ? 'Expanding...' : 'Open Lab', icon: getUiIcon('expand'), tone: 'green', state: this.hoverBtn === 'row:tier' ? 'hover' : 'normal' });
        } else drawText(ctx, 'The biggest tank there is!', row.x + L(8), row.y + L(36), { font: f2, color: '#2a7a3a' });
        continue;
      }
      const lv = gearLevel(this.st, row.g.id);
      drawAeroSurface(ctx, row.x, row.y, row.w, row.h, { tone: 'frost', r: 6, gloss: 0.4, rim: 0.7 });
      icon(has3D('tank_' + row.g.id) ? 'tank_' + row.g.id : row.g.icon, row.x + L(6), row.y + L(8));
      drawText(ctx, row.g.name, row.x + L(24), row.y + L(5), { color: ink, font: f1 });
      drawText(ctx, row.g.levels[lv], row.x + L(24), row.y + L(18), { font: f2, color: '#3a6a8a' });
      const bx0 = (b ? b.x : row.x + row.w - L(96)) - L(10);
      for (let i = 0; i < row.g.levels.length - 1; i++) {
        ctx.fillStyle = i < lv ? '#3ac4f8' : 'rgba(10,60,110,0.25)';
        ctx.fillRect(bx0 - (row.g.levels.length - 1 - i) * L(6), row.y + L(12), L(4), L(6));
      }
      if (b) {
        const afford = (this.st.coins || 0) >= b.cost;
        drawAeroButton(ctx, b.x, b.y, b.w, b.h, { label: b.label, icon: getUiIcon('coin'), tone: afford ? 'aqua' : 'glass', state: !afford ? 'disabled' : this.hoverBtn === 'row:' + row.g.id ? 'hover' : 'normal' });
      } else drawText(ctx, 'MAX', row.x + row.w - L(50), row.y + L(11), { color: '#2a7a3a', align: 'center', font: f1 });
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

// alpha masks for pixel-accurate clicks
const masks = new WeakMap();
export function alphaAt(canvas, x, y) {
  let m = masks.get(canvas);
  if (!m) {
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    m = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
    masks.set(canvas, m);
  }
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return 0;
  return m[(y | 0) * canvas.width + (x | 0)];
}

// the snail janitor as a little hand-drawn pixel sprite
const SNAIL = [
  '....aaa....',
  '..abbbba...',
  '.abccccba..',
  '.abcbbcba..',
  '.abcbdcba.e',
  '.abccccba.e',
  'ffabbbbaffg',
  'fffffffffff',
];
const SNAIL_COL = { a: '#1f6a9a', b: '#3ac4f8', c: '#bff4ff', d: '#ffffff', e: '#7ad83a', f: '#9be84a', g: '#ffffff' };
function drawSnail(ctx, x, y, s, dir, t) {
  const k = Math.max(1, Math.round(s / 8));
  const w = SNAIL[0].length, h = SNAIL.length;
  const x0 = Math.round(x - (w * k) / 2), y0 = Math.round(y - h * k) + (Math.sin(t * 3) > 0.92 ? -k : 0);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = SNAIL[j][dir >= 0 ? i : w - 1 - i];
    if (ch === '.') continue;
    ctx.fillStyle = SNAIL_COL[ch];
    ctx.fillRect(x0 + i * k, y0 + j * k, k, k);
  }
}
