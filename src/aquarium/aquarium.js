// The aquarium (phase 6): a real, super-detailed 3D fish tank (low-poly, src/gfx/lowpoly.js LPScene) in a Frutiger
// Aero room. Move around it (drag to orbit, right-drag to pan, wheel to zoom, Front / Top / Close-up presets), go
// swimming inside as your bubble person (WASD / arrows + drag to look, or click to dart; fish react, Aero drops are
// collected by swimming through them, bubbles trail; Esc or the Exit pill leaves), arrange decorations in 3D, buy
// tank gear with Aero and watch the tank swell when the Lab unlocks a bigger tier (goldfish jar -> bowl -> Aqua Lamp ->
// big tank -> reef tank -> wall aquarium). Idle Aero (drops the fish puff out), offline earnings, feeding, breeding,
// evolution and auto-collect keep working. Without WebGL2 a simple 2D front view stands in (flat2d.js).
//
// Shown as the full-screen scene (state.view === 'aquarium') and as a floating Aero glass window over the ocean.
// API used by the game: addFish(rec), update(dt, inpOrNull), hit(x, y), drawFull, drawWindow, drawMini, windowRect(),
// toggleWindow(), openWindow(force), closeWindow(), forceCoin(), offlineCoins(sec), onResize(). Extra: addDecor(id),
// storedDecor(), placeStored(id), tankSummary(), interact(decorOrId), openFull(), capacity(), tier, syncFish(),
// evolveFish(dt), enterSwim(), exitSwim(), setPreset(name), buyGear(id). Events via game.emit: 'tankFish',
// 'coinCollected' ({value, by}), 'decorPlayed', 'fishEvolved', 'hatched', 'tankUpgraded' ({from, to}), 'gearBought'.

import { clamp, clamp01, lerp, rectContains, smoothstep, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon, UI_ICON_NAMES } from '../gfx/uiicons.js';
import { PROPS, propInteract } from '../gfx/props.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { rollIndividual, sizeScaleOf } from '../fish/traits.js';
import { nodeFor } from '../game/lab.js';
import { AERO, fmtAero, drawAeroCoin, drawAeroSurface, drawAeroButton, drawSparkle, drawAeroPanel, drawAeroGlow, uiK } from '../ui/aero.js';
import { TANK_TIERS, TANK_IDS, tankTier, aeroRate, GEAR, gearLevel, gearCost, gearMul, gearHappy } from './tanks.js';
import { TankShape, TankFish, Drops3D, Ripples, DENOMS } from './sim3d.js';
import { TankView } from './view3d.js';
import { decorModel } from './lpdecor.js';
import { warmFishFrame } from './lpfish.js';
import { drawFlat } from './flat2d.js';

const HUNGER_RATE = 1 / 2000; // 0 -> 0.6 ("hungry") in 20 minutes
const AUTO_POP = [Infinity, 14, 7, 3.5, 2];
const ICONS = new Set(UI_ICON_NAMES);
const EMOTE_ICON = { '!': 'exclaim', '!!': 'exclaim', '?': 'question', $: 'dollar' };
const FRAME = { lid: 15, side: 4, base: 14 };
const WIN_W = [250, 266, 290, 326, 362, 404];
const FOOD_COLS = ['#e86a3a', '#f0a040', '#c8503a', '#8ac04a', '#e8c070'];
const v3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export class Aquarium {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.fish = [];
    this.food = [];
    this.bubbles = [];
    this.decor = [];
    this.drops = new Drops3D();
    this.drops.onMerge = (c) => this.fxAt(c.p, 'sparkle', 3);
    this.ripples = new Ripples();
    this.particles = new Particles(240);
    this.view = new TankView(this);
    this.visibleKey = null;
    this.swim = null;
    this.arrange = false;
    this.panel = null; // 'gear' | null
    this.press = null; this.drag = null;
    this.hoverFish = null; this.hoverDecor = null; this.hoverBtn = null;
    this.combo = 0; this.comboT = 0;
    this.moodT = 0; this.saveT = 0; this.feederT = 20; this.syncT = 0;
    this.growAnim = null; this.pendingGrow = null;
    this.sfxQ = [];
    this.winAnim = 1;
    this.coinsDirty = false;
    this.load();
  }

  // ------------------------------------------------------------------ state
  get st() { return this.game.state; }
  get stats() { return this.game.stats || {}; }
  get coins() { return this.drops; } // older readers

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
    for (const d of tk.decor) { if (d.z === undefined) d.z = 0.3 + ((d.x * 997) % 1) * 0.5; }
    st.tankWindow ||= { open: false, x: 0, y: 0 };
  }

  load() {
    this.stateRef = this.game.state;
    this.ensureState();
    this.tier = tankTier(this.st);
    this.shape = new TankShape(this.tier);
    this.fish.length = 0; this.food.length = 0; this.bubbles.length = 0;
    this.drops.list.length = 0;
    this.swim = null; this.growAnim = null; this.pendingGrow = null;
    this.drops.setScale(this.shape.fishLen / 6);
    this.decor = this.st.tank.decor.filter((d) => PROPS[d.id]).map((rec) => ({ rec }));
    this.layoutDecor();
    this.view.invalidate(); // the 3D kit is built on first show
    this.syncFish();
    this.restoreCoins();
  }

  capacity() { return this.stats.tankCap || 4; }
  tierInfo() { return TANK_TIERS[this.tier] || TANK_TIERS[0]; }
  sfx(name, opts) { if (!this.visibleKey) return; try { audio.play(name, opts); } catch { /* audio not ready */ } }

  // ------------------------------------------------------------------ decor
  decorScale(d) {
    const T = this.shape, m = d.model;
    const size = PROPS[d.rec.id]?.decor?.size || 1;
    let k = clamp(T.fishLen / 7.2, 0.42, 1.45) * [0.95, 1, 1.05][size - 1];
    if (m) { k = Math.min(k, (T.waterY * (T.round ? 0.5 : 0.72)) / m.h, (T.minDim * (T.round ? 0.26 : 0.5)) / m.r); }
    return Math.max(0.15, k);
  }

  layoutDecor() {
    const T = this.shape;
    for (const d of this.decor) {
      d.model ||= decorModel(d.rec.id, d.rec.v || 0);
      d.k = this.decorScale(d);
      const p = T.floorPoint(clamp01(d.rec.x ?? 0.5), clamp01(d.rec.z ?? 0.5), d.model.r * d.k * 0.6);
      d.p = [p[0], p[1] - 0.25, p[2]];
      d.yaw = d.rec.r ?? ((((d.rec.x || 0) * 997) % 1) - 0.5) * 0.8;
      d.r = d.model.r * d.k; d.h = d.model.h * d.k;
      d.squash = d.squash || 0; d.squashV = d.squashV || 0;
    }
  }

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
    const d = { rec };
    this.decor.push(d);
    this.layoutDecor();
    d.hop = 6; d.squashV = 4;
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
    const tk = this.st.tank;
    tk.decor = tk.decor.filter((r) => r !== d.rec);
    tk.stored.push(d.rec.id);
    this.decor = this.decor.filter((x) => x !== d);
    this.fxAt([d.p[0], d.p[1] + d.h * 0.5, d.p[2]], 'burst', 10);
    this.game.toast?.(`${PROPS[d.rec.id]?.name || 'Decoration'} packed away.`, 'tank');
    this.sfx('ui_close');
    this.game.save?.();
  }

  // ------------------------------------------------------------------ fish
  fishLen(rec, sp) {
    const T = this.shape;
    const base = T.fishLen * clamp(sizeScaleOf(rec, sp), 0.6, 1.9);
    return Math.min(base, T.minDim * 0.42);
  }

  addFish(rec, opts = {}) {
    if (this.fish.some((f) => f.rec === rec)) return;
    const f = this.makeFish(rec, { splash: opts.splash ?? true, ...opts });
    if (f) this.game.emit?.('tankFish', rec);
  }

  makeFish(rec, opts = {}) {
    const sp = SPECIES_BY_ID[rec.species];
    if (!sp) return null;
    rec.hunger ??= 0.3; rec.happiness ??= 0.75; rec.coinT ??= 0;
    let f;
    try { f = new TankFish(rec, sp, this.fishLen(rec, sp)); } catch (e) { console.warn('tank fish', rec.species, e); return null; }
    const T = this.shape;
    if (opts.at) f.p = opts.at.slice();
    else if (opts.splash) { f.p = [rng.float(-0.3, 0.3) * T.size[0], T.waterY - f.len * 0.5, rng.float(-0.2, 0.2) * T.size[2]]; f.pitch = -0.6; f.speed = f.cruise * 2; }
    else f.p = T.swimPoint(Math.random, rng.float(0.2, 0.8), f.len);
    T.clamp(f.p, f.len * 0.45);
    if (opts.splash) {
      this.ripples.add(f.p[0], f.p[2], 1.2);
      for (let i = 0; i < 8; i++) this.addBubble([f.p[0] + rng.float(-1, 1) * f.len * 0.3, f.p[1], f.p[2] + rng.float(-1, 1) * f.len * 0.3], f.len * 0.06);
      this.sfx('splash_small', { vol: 0.6 });
    }
    if (opts.baby) f.baby = 40;
    this.fish.push(f);
    return f;
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
  onResize() { if (this.st.tankWindow) this.clampWindow(); }
  openFull() {
    const g = this.game;
    this.press = null; this.drag = null;
    g.setView?.('aquarium');
    this.view.setPreset('front');
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

  // ------------------------------------------------------------------ economy
  gearMul() { return gearMul(this.st); }
  fishRate(f) { return aeroRate(f.rec, f.sp, this.stats, this.tier, this.game.coinMulBonus || 1, this.gearMul()); }
  ratePerMin() { return this.fish.reduce((a, f) => a + this.fishRate(f), 0); }

  // Tutorial: a drop that hovers low in the water until it is popped.
  forceCoin() {
    const T = this.shape;
    const f = this.fish[0];
    const p = f ? f.p.slice() : T.swimPoint(Math.random, 0.4, 2);
    p[2] = Math.max(p[2], T.round ? 0 : T.size[2] * 0.15);
    T.clamp(p, 2);
    const c = this.drops.spawn(p, 0, { value: DENOMS[0] });
    c.hint = true;
    this.coinsDirty = true;
    if (f) f.say('$', 1.4);
  }

  dropCoin(f, d) {
    const dir = f.dir;
    const p = [f.p[0] + dir[0] * f.len * 0.5, f.p[1] + dir[1] * f.len * 0.5, f.p[2] + dir[2] * f.len * 0.5];
    this.shape.clamp(p, 1);
    this.drops.spawn(p, d, { v: [dir[0] * 4, 1, dir[2] * 4], hold: 0.35 });
    this.sfx('bubble', { vol: 0.3, pitch: [1.35, 1.15, 0.95][d] });
    f.poke(3);
    for (let i = 0; i < 3; i++) this.addBubble(p, f.len * 0.04);
    this.coinsDirty = true;
  }

  // Pop a drop into Aero (by: 'player' | 'auto' | 'helper').
  collectCoin(c, by = 'player') {
    if (!this.drops.list.includes(c)) return;
    this.drops.remove(c);
    this.coinsDirty = true;
    const vk = this.visibleKey;
    let sx, sy;
    if (vk) {
      const sp = this.view.project(c.p);
      if (sp) { const o = this.viewOrigin(); sx = o.x + sp[0]; sy = o.y + sp[1]; }
    }
    if (by === 'player') this.lastGrabT = this.t;
    this.game.addCoins?.(c.value, sx, sy);
    if (vk) {
      this.combo = this.comboT > 0 ? this.combo + 1 : 0;
      this.comboT = 0.45;
      this.sfx('bubble', { vol: by === 'player' ? 0.5 : 0.25, pitch: 1.5 + Math.min(12, this.combo) * 0.06 });
      this.sfx('coin_collect', { vol: by === 'player' ? 0.3 : 0.15, pitch: 1.1 + Math.min(12, this.combo) * 0.045 });
      this.fxAt(c.p, 'pop', c.value, c.r);
      if (this.swim && by === 'player') this.swim.got += c.value;
    }
    this.ripples.add(c.p[0], c.p[2], 0.3);
    this.game.emit?.('coinCollected', { value: c.value, by });
  }

  onEat(f, food) {
    if (food.eaten) return;
    const rec = f.rec;
    rec.hunger = Math.max(0, (rec.hunger ?? 0.5) - 0.16);
    rec.happiness = Math.min(1, (rec.happiness ?? 0.7) + 0.015);
    food.eaten = true;
    f.poke(4);
    this.sfx('gulp', { vol: 0.35, pitch: 1.4 });
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
    const egg = { species: a.sp.id, x: u, z: v, t: 0, dur: 180 / (this.stats.hatchSpeed || 1), n: rng.int(3, 6), color: a.sp.look?.col?.belly || '#ffd8a8', parents: [a.rec.uid, b.rec.uid] };
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
    const p = this.shape.floorPoint(egg.x, egg.z, 2);
    if (inTank) this.makeFish(rec, { splash: false, baby: true, at: [p[0], p[1] + 2, p[2]] });
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
      const p = T.floorPoint(clamp01(u), clamp01(v), 2);
      p[1] = T.waterY - 0.5;
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

  // ------------------------------------------------------------------ gear (Aero upgrades)
  buyGear(id) {
    const g = GEAR.find((q) => q.id === id);
    if (!g) return false;
    const lv = gearLevel(this.st, id);
    if (lv >= g.levels.length - 1) return false;
    const cost = gearCost(id, lv + 1);
    if (!this.game.spendCoins?.(cost)) { this.game.toast?.('Not enough Aero.', 'coin'); return false; }
    this.st.tank.gear[id] = lv + 1;
    this.view.rebuild();
    this.sfx('ui_unlock', { vol: 0.7 });
    this.fxAt([0, this.shape.waterY * 0.6, 0], 'confetti', 24);
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
    const tier = tankTier(this.st);
    if (tier !== this.tier) this.changeTier(tier);
    const shown = this.shownKey();
    const was = this.visibleKey;
    this.visibleKey = shown;
    if (shown === 'window') this.winAnim = Math.min(1, this.winAnim + dt * 5);
    if (shown !== 'full' && this.swim) this.exitSwim(true);
    if (shown !== 'full') { this.panel = null; this.arrange = false; }
    if (shown === 'full' && was !== 'full') {
      this.view.w = g.screen.W; this.view.h = g.screen.H;
      this.view.setPreset('front', true);
      if (this.pendingGrow) { this.startGrow(this.pendingGrow); this.pendingGrow = null; }
    }
    const clock = g.clock;
    this.nightK = clock ? clamp01(1 - clock.daylight()) : 0;
    this.comboT = Math.max(0, this.comboT - dt);
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 0.5; this.syncFish(); this.evolveFish(0.5); }
    if (this.growAnim) { this.growAnim.t += dt; this.updateGrow(); }

    this.handleInput(dt, inp);
    if (this.swim) this.updateSwim(dt, inp);
    this.view.update(dt);
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
    this.saveT -= dt;
    if (this.saveT <= 0 && this.coinsDirty) { this.saveT = 1; this.saveCoins(); }
    // while the tank is hidden, quietly build the fish's 3D swim frames (one every few frames)
    if (!this.visibleKey && this.view.ok && this.t > 4) {
      this.warmT = (this.warmT || 0) - dt;
      if (this.warmT <= 0) { this.warmT = 0.25; for (const f of this.fish) if (warmFishFrame(f.sp, f.rec)) break; }
    }
  }

  // New tank tier: re-map the tank's contents; when visible (or the next time it is) the tank swells.
  changeTier(tier) {
    const from = this.tier;
    const old = this.shape;
    const T = new TankShape(tier);
    // fish and drops keep their relative place in the bigger tank
    const map = (p) => {
      const [u, v] = old.toUV(p[0], p[2]);
      const fy = old.floorY(p[0], p[2]);
      const y01 = clamp01((p[1] - fy) / Math.max(1, old.waterY - fy));
      const q = T.floorPoint(u, v, 1);
      return [q[0], lerp(q[1], T.waterY, y01), q[2]];
    };
    for (const f of this.fish) { f.p = map(f.p); f.target = null; }
    for (const c of this.drops.list) c.p = map(c.p);
    for (const p of this.food) p.p = map(p.p);
    this.bubbles.length = 0;
    this.tier = tier;
    this.shape = T;
    for (const f of this.fish) { f.baseLen = this.fishLen(f.rec, f.sp); f.len = f.baseLen; T.clamp(f.p, f.len * 0.45); }
    this.drops.setScale(T.fishLen / 6);
    this.layoutDecor();
    const grow = tier > from ? { from: [old.size[0] / T.size[0], old.top / T.top, old.size[2] / T.size[2]].map((k) => clamp(k, 0.2, 1)) } : null;
    if (grow && this.visibleKey === 'full') this.startGrow(grow, true);
    else { if (grow) this.pendingGrow = grow; this.view.rebuild(); }
    if (this.swim) this.exitSwim(true);
    this.game.recomputeStats?.();
    if (tier > from) {
      this.game.toast?.(`Tank upgraded: ${TANK_TIERS[tier].name}!`, 'tank', 4);
      this.game.emit?.('tankUpgraded', { from, to: tier });
    }
  }

  startGrow(grow, rebuilt = false) {
    this.growAnim = { t: 0, from: grow.from, fx: 0 };
    this.view.rebuild();
    void rebuilt;
    this.view.setPreset('front');
    this.sfx('ui_unlock', { vol: 0.8 });
    this.sfx('travel_whoosh', { vol: 0.5 });
  }

  updateGrow() {
    const a = this.growAnim;
    if (a.fx === 0 && a.t > 0.6) { a.fx = 1; this.sfx('splash_big', { vol: 0.6 }); this.sfx('bubbles', { vol: 0.5 }); for (let i = 0; i < 30; i++) this.addBubble(this.shape.swimPoint(Math.random, rng.float(0, 0.3), 1), rng.float(0.2, 0.6)); }
    if (a.fx === 1 && a.t > 1.9) { a.fx = 2; this.fxAt([0, this.shape.top * 0.8, 0], 'confetti', 40); this.sfx('sparkle', { vol: 0.7 }); }
    if (a.t > 3) { this.growAnim = null; this.view.dropOldKit(); }
  }

  // ------------------------------------------------------------------ input
  viewOrigin() {
    if (this.visibleKey === 'window') { const r = this.windowRect(); return r ? { x: r.x + FRAME.side, y: r.y + FRAME.lid + this.slideOff() } : { x: 0, y: 0 }; }
    return { x: 0, y: 0 };
  }
  slideOff() { return Math.round((1 - clamp01(this.winAnim) ** 0.5) * 14); }

  handleInput(dt, inp) {
    const g = this.game;
    const vk = this.visibleKey;
    this.hoverFish = null; this.hoverDecor = null; this.hoverBtn = null;
    const tip = (t) => { if (g.desktop) g.desktop.tooltip = t; };
    if (!inp || !vk) {
      if (this.drag && (!inp || !inp.down)) this.endDrag();
      if (!inp || !inp.down) this.press = null;
      this.prevCur = null;
      return;
    }
    if (vk === 'window') { this.windowInput(dt, inp, tip); return; }
    if (this.swim) { this.swimButtons(inp); return; }
    // ---- full view: HUD first
    const W = g.screen.W;
    for (const b of this.fullButtons()) {
      if (!rectContains(b, inp.x, inp.y)) continue;
      this.hoverBtn = b.id;
      if (b.tip) tip(b.tip);
      if (inp.pressed) { inp.consume(); this.press = null; b.run(); }
      this.prevCur = null;
      return;
    }
    if (this.panel === 'gear') {
      const pr = this.gearPanelRect();
      if (rectContains(pr, inp.x, inp.y)) { this.panelInput(inp, tip); return; }
      if (inp.pressed) { this.panel = null; inp.consume(); return; }
    }
    void W;
    const view = this.view;
    const lx = inp.x, ly = inp.y;
    // keys: camera presets
    if (!g.ui?.active) {
      if (inp.keyPressed('1')) this.view.setPreset('front');
      if (inp.keyPressed('2')) this.view.setPreset('top');
      if (inp.keyPressed('3')) this.view.setPreset('close');
    }
    // ---- dragging (camera or decor)
    const pr = this.press;
    if (pr) {
      const dx = inp.x - pr.lx, dy = inp.y - pr.ly;
      if (Math.hypot(inp.x - pr.x, inp.y - pr.y) > 4) pr.moved = true;
      if (pr.button === 'r') {
        if (inp.rdown) { if (pr.moved) view.pan(dx, dy); }
        else { this.press = null; if (!pr.moved && pr.decor && this.arrange) this.storeDecor(pr.decor); }
      } else if (inp.down) {
        if (pr.moved) {
          if (pr.decor && !this.drag) { this.drag = { kind: 'decor', d: pr.decor }; this.sfx('icon_pickup', { vol: 0.5 }); }
          if (this.drag?.kind === 'decor') this.dragDecor(lx, ly);
          else view.orbit(dx, dy);
        }
      } else {
        this.press = null;
        if (this.drag) this.endDrag();
        else if (!pr.moved) this.click(pr, lx, ly);
      }
      if (this.press) { this.press.lx = inp.x; this.press.ly = inp.y; }
    }
    // ---- hover: decor, fish, drops
    const ray = view.ray(lx, ly);
    // where the cursor meets the water (fish come to look / get startled)
    const th = this.shape.rayHit(ray.o, ray.d);
    if (th !== null) {
      const cp = [ray.o[0] + ray.d[0] * (th + 0.5), ray.o[1] + ray.d[1] * (th + 0.5), ray.o[2] + ray.d[2] * (th + 0.5)];
      this.shape.clamp(cp, 1);
      this.cursor3 = { p: cp, speed: inp.speed || 0, t: this.t };
    }
    const hd = this.drag?.d || this.pickDecor(ray);
    const hf = hd ? null : this.pickFish(ray);
    this.hoverDecor = hd; this.hoverFish = hf;
    if (hd && !this.drag) {
      const name = PROPS[hd.rec.id]?.name || 'Decoration', verb = propInteract(hd.rec.id)?.verb || 'Poke';
      tip(this.arrange ? `${name}\n{mouse_hold} move  wheel: turn  {mouse_r} store` : `${name}\n{mouse_l} ${verb}  {mouse_hold} move`);
    } else if (hf) tip(this.fishTip(hf));
    // wheel: rotate a hovered decoration in arrange mode, otherwise zoom
    if (inp.wheel) {
      if (hd && (this.arrange || this.drag)) { hd.rec.r = (hd.yaw || 0) + inp.wheel * 0.3; this.layoutDecor(); this.game.save?.(); }
      else view.zoom(Math.pow(1.12, inp.wheel));
    }
    this.sweepDrops(lx, ly, inp.down && !this.drag);
    if (inp.pressed && !this.press) {
      inp.consume();
      this.press = { x: inp.x, y: inp.y, lx: inp.x, ly: inp.y, button: 'l', decor: hd, fish: hf, moved: false };
    }
    if (inp.rpressed && !this.press) {
      inp.rpressed = false;
      this.press = { x: inp.x, y: inp.y, lx: inp.x, ly: inp.y, button: 'r', decor: hd, moved: false };
    }
  }

  click(pr, lx, ly) {
    // the Aqua Lamp's rocker switch on the hood
    const sw = this.view.kit?.lid?.sw;
    const sp = sw && this.view.project(sw);
    if (sp && Math.hypot(sp[0] - lx, sp[1] - ly) < Math.max(8, 3 * this.view.ppu(sp[2]))) {
      this.st.tank.lampOff = !this.st.tank.lampOff;
      this.sfx('click', { vol: 0.6, pitch: this.st.tank.lampOff ? 0.8 : 1.25 });
      this.game.save?.();
      return;
    }
    if (pr.decor && this.decor.includes(pr.decor)) { this.interact(pr.decor); return; }
    if (pr.fish && this.fish.includes(pr.fish)) { this.pet(pr.fish); return; }
    // in the water: sprinkle food (or place a stored decoration in arrange mode)
    const ray = this.view.ray(lx, ly);
    const t = this.shape.rayHit(ray.o, ray.d);
    if (t === null) return;
    const p = [ray.o[0] + ray.d[0] * t, 0, ray.o[2] + ray.d[2] * t];
    if (this.arrange && this.st.tank.stored.length) {
      const fp = this.floorHit(ray);
      if (fp) { const [u, v] = this.shape.toUV(fp[0], fp[2]); this.placeStored(null, { x: u, z: v }); }
      return;
    }
    this.sprinkle(p[0], p[2]);
  }

  // drops pop when the cursor passes over them (a held button sweeps a wider path)
  sweepDrops(lx, ly, sweep) {
    const rad = (this.stats.collectRadius || 14) * (this.visibleKey === 'window' ? 0.85 : 1);
    const p0 = this.prevCur || { x: lx, y: ly };
    for (let i = this.drops.list.length - 1; i >= 0; i--) {
      const c = this.drops.list[i];
      const sp = this.view.project(c.p);
      if (!sp) continue;
      const rr = (sweep ? rad * 1.35 : rad) * 0.6 + c.r * this.view.ppu(sp[2]) + (c.hint ? 18 : 0);
      const d = sweep ? segDist(sp[0], sp[1], p0.x, p0.y, lx, ly) : Math.hypot(sp[0] - lx, sp[1] - ly);
      if (d < rr) { this.collectCoin(c, 'player'); if (this.press) this.press.collected = true; }
    }
    this.prevCur = { x: lx, y: ly };
  }

  pickFish(ray) {
    let best = null, bt = Infinity;
    for (const f of this.fish) {
      const t = raySphere(ray, f.p, f.len * 0.55 + 0.6);
      if (t !== null && t < bt) { bt = t; best = f; }
    }
    return best;
  }
  pickDecor(ray) {
    let best = null, bt = Infinity;
    for (const d of this.decor) {
      const c = [d.p[0], d.p[1] + d.h * 0.45, d.p[2]];
      const t = raySphere(ray, c, Math.max(d.r * 0.85, d.h * 0.5));
      if (t !== null && t < bt) { bt = t; best = d; }
    }
    return best;
  }
  floorHit(ray) {
    const T = this.shape;
    let y = T.floorY(0, 0);
    let p = null;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ray.d[1]) < 1e-4) return null;
      const t = (y - ray.o[1]) / ray.d[1];
      if (t < 0) return null;
      p = [ray.o[0] + ray.d[0] * t, y, ray.o[2] + ray.d[2] * t];
      y = T.floorY(p[0], p[2]);
    }
    return p;
  }
  dragDecor(lx, ly) {
    const d = this.drag.d;
    const fp = this.floorHit(this.view.ray(lx, ly));
    if (!fp) return;
    const [u, v] = this.shape.toUV(fp[0], fp[2]);
    d.rec.x = clamp(u, 0.03, 0.97); d.rec.z = clamp(v, 0.03, 0.97);
    this.layoutDecor();
    d.p[1] += 1.2;
  }
  endDrag() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind !== 'decor') return;
    this.layoutDecor();
    d.d.squashV = 5;
    this.fxAt(d.d.p, 'burst', 8);
    this.sfx('box_close', { vol: 0.5 });
    this.game.save?.();
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
      else if (!this.press) tip('{mouse_l} Dive into the aquarium\n{mouse_hold} Drag to move');
      if (inp.pressed) {
        inp.consume();
        if (this.hoverBtn === 'close') this.closeWindow();
        else if (this.hoverBtn === 'expand') this.openFull();
        else this.press = { kind: 'lid', x: inp.x, y: inp.y };
      }
      return;
    }
    const o = this.viewOrigin();
    const lx = inp.x - o.x, ly = inp.y - o.y;
    const d = this.winDims();
    const inScene = lx >= 0 && ly >= 0 && lx < d.sw && ly < d.sh;
    if (!inScene) { if (inp.pressed) inp.consume(); return; }
    this.sweepDrops(lx, ly, inp.down);
    const hf = this.pickFish(this.view.ray(lx, ly));
    this.hoverFish = hf;
    if (hf) tip(this.fishTip(hf) + '\n{mouse_l} Dive in');
    if (inp.pressed) { inp.consume(); this.press = { kind: 'glass', x: inp.x, y: inp.y, collected: false }; }
  }

  chromeButtons(r) {
    const y = r.y + 2 + this.slideOff();
    return [
      { id: 'close', x: r.x + r.w - 25, y, w: 21, h: 11, tip: 'Close', icon: 'cross', tone: 'red' },
      { id: 'expand', x: r.x + r.w - 44, y, w: 18, h: 11, tip: 'Full-screen aquarium (A)', icon: 'expand', tone: 'aqua' },
    ];
  }

  // Full view HUD: the stats pill + Ocean button (top) and a glossy dock on the right.
  // HUD size factor: follows the game's UI size setting (uiK(), the phase 4 HUD = 1), clamped to fit the screen
  hudK() { let k = 1.25; try { k = uiK(); } catch { /* aero not ready */ } return clamp(Math.min(k, this.game.screen.W / 620, this.game.screen.H / 380), 1, 2.2); }
  fullLayout() {
    const W = this.game.screen.W, k = this.hudK();
    const pw = Math.round(200 * k), bw = Math.round(62 * k), ph = Math.round(20 * k);
    const px = Math.round(W / 2 - (pw + bw + 6) / 2);
    return { k, pill: { x: px, y: 6, w: pw, h: ph }, btn: { x: px + pw + 6, y: 7, w: bw, h: ph - 2 } };
  }
  fullButton() { return this.fullLayout().btn; }

  fullButtons() {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    const L = this.fullLayout();
    const out = [{ id: 'back', ...L.btn, run: () => g.setView?.('ocean'), tip: 'Back to the ocean' }];
    out.push({ id: 'pill', ...L.pill, run: () => {}, tip: `${this.tierInfo().name}\n{fish} ${this.fish.length}/${this.capacity()}  {coin} ${this.ratePerMin().toFixed(1)} Aero/min` });
    const kd = clamp(Math.min(this.hudK(), (H - 150) / (9 * 34 + 8)), 0.8, 2);
    const bw = Math.round(34 * kd), bh = Math.round(30 * kd), x = W - bw - 8;
    let y = Math.max(Math.round(56 * kd), Math.round((H - 50) * 0.5 - 4.5 * (bh + 4)));
    const dock = [
      { id: 'front', icon: 'eye', label: 'Front', tip: 'Front view (1)', run: () => this.view.setPreset('front') },
      { id: 'top', icon: 'arrow_d', label: 'Top', tip: 'Top view (2)', run: () => this.view.setPreset('top') },
      { id: 'close', icon: 'plus', label: 'Close', tip: 'Close-up (3)', run: () => this.view.setPreset('close') },
      { id: 'room', icon: 'home', label: 'Room', tip: 'See the whole room', run: () => this.view.setPreset('room') },
      { gap: true },
      { id: 'swim', icon: 'bubble', label: 'Swim', tip: 'Go for a swim inside the tank!', run: () => this.enterSwim(), tone: 'green' },
      { id: 'feed', icon: 'food', label: 'Feed', tip: 'Sprinkle food', run: () => this.sprinkle(rng.float(-0.25, 0.25) * this.shape.size[0], rng.float(-0.2, 0.2) * this.shape.size[2], 9) },
      { id: 'arrange', icon: 'coral', label: 'Decor', tip: this.arrange ? 'Done arranging' : 'Arrange decorations (drag, wheel rotates, right-click stores)', run: () => { this.arrange = !this.arrange; this.panel = null; }, on: this.arrange },
      { id: 'gear', icon: 'gear', label: 'Gear', tip: 'Upgrade & expand the tank', run: () => { this.panel = this.panel === 'gear' ? null : 'gear'; this.arrange = false; }, on: this.panel === 'gear', tone: 'orange' },
      { id: 'light', icon: this.st.tank.lampOff ? 'moon' : 'sun', label: 'Light', tip: this.st.tank.lampOff ? 'Light on' : 'Light off', run: () => { this.st.tank.lampOff = !this.st.tank.lampOff; this.sfx('click', { vol: 0.6, pitch: this.st.tank.lampOff ? 0.8 : 1.25 }); this.game.save?.(); } },
    ];
    for (const b of dock) {
      if (b.gap) { y += Math.round(8 * kd); continue; }
      out.push({ ...b, x, y, w: bw, h: bh, dock: true, kd });
      y += bh + 4;
    }
    if (this.arrange && this.st.tank.stored.length) {
      const n = this.st.tank.stored.length;
      out.push({ id: 'unpack', x: x - Math.round(70 * L.k), y: L.btn.y + L.btn.h + 12, w: Math.round(64 * L.k), h: L.btn.h, label: `+${n}`, tip: `Place ${PROPS[this.st.tank.stored.at(-1)]?.name || 'decoration'}\n(or click the floor)`, run: () => this.placeStored(), tone: 'green' });
    }
    return out;
  }

  swimLayout() {
    const W = this.game.screen.W, k = this.hudK();
    const font = k >= 1.4 ? 'normal' : 'small';
    const msg = 'WASD / arrows swim   Drag: look   Space: up   Shift: down   Click: dart';
    const mw = measureText(msg, font) + 20, h = Math.round(18 * k);
    const ew = Math.round(64 * k);
    const x0 = Math.round(W / 2 - (mw + ew + 6) / 2);
    return { msg, font, pill: { x: x0, y: 7, w: mw, h }, exit: { x: x0 + mw + 6, y: 7, w: ew, h } };
  }

  swimButtons(inp) {
    const r = this.swimLayout().exit;
    if (rectContains(r, inp.x, inp.y)) {
      this.hoverBtn = 'exitswim';
      if (inp.pressed) { inp.consume(); this.exitSwim(); }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ gear panel
  panelK() { return clamp(Math.min(this.hudK(), (this.game.screen.H - 60) / (34 + 58 + GEAR.length * 34 + 16)), 1, 2); }
  gearPanelRect() {
    const { W, H } = this.game.screen;
    const k = this.panelK();
    const dock = this.fullButtons().find((b) => b.dock);
    const w = Math.round(300 * k), h = Math.min(H - 50, Math.round((34 + 58 + GEAR.length * 34 + 16) * k));
    return { x: (dock ? dock.x : W - 42) - 10 - w, y: Math.max(36, Math.round(H / 2 - h / 2)), w, h, k };
  }
  gearRows() {
    const r = this.gearPanelRect(), k = r.k;
    const rows = [];
    let y = r.y + Math.round(34 * k);
    // expansion (tier) first
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

  // ------------------------------------------------------------------ swimming
  enterSwim() {
    if (!this.view.ok) { this.game.toast?.('Swimming needs WebGL2.', 'info'); return; }
    const T = this.shape;
    const r = clamp(T.minDim * 0.14, 1.6, 7);
    const p = [0, lerp(T.floorY(0, 0), T.waterY, 0.6), T.round ? T.size[2] * 0.12 : T.size[2] * 0.32];
    T.clamp(p, r);
    this.swim = { p, v: [0, 0, 0], yaw: Math.PI / 2, pitch: -0.05, roll: 0, r, speed: 0, kick: 0, look: { yaw: Math.PI / 2, pitch: -0.08 }, intro: 0, got: 0, goal: null, bubT: 0 };
    this.panel = null; this.arrange = false; this.camEye = null;
    this.ripples.add(p[0], p[2], 1.4);
    for (let i = 0; i < 14; i++) this.addBubble([p[0] + rng.float(-r, r), p[1] + rng.float(-r, r), p[2] + rng.float(-r, r)], r * rng.float(0.05, 0.15));
    this.sfx('splash_small', { vol: 0.7 });
    this.sfx('bubbles', { vol: 0.5 });
    try { audio.setMuffle?.(0.6); } catch { /* optional */ }
  }

  exitSwim(quiet = false) {
    if (!this.swim) return;
    const s = this.swim;
    this.swim = null;
    try { audio.setMuffle?.(0); } catch { /* optional */ }
    if (quiet) return;
    this.ripples.add(s.p[0], s.p[2], 1.2);
    this.sfx('splash_small', { vol: 0.6 });
    if (s.got) this.game.toast?.(`Swim haul: ${fmtAero(s.got)} Aero!`, 'coin');
    this.view.setPreset('front');
  }

  swimDir(yaw, pitch) { const cp = Math.cos(pitch); return [Math.cos(yaw) * cp, Math.sin(pitch), -Math.sin(yaw) * cp]; }

  updateSwim(dt, inp) {
    const s = this.swim, T = this.shape, g = this.game;
    const I = g.input;
    s.intro = Math.min(1, s.intro + dt * 1.6);
    // keys (the game's hotkeys must not fire while swimming)
    const key = (k) => I.key(k);
    for (const k of ['w', 'a', 's', 'd', 'q', 'e', 'c', ' ', 'Shift', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) I.keysPressed?.delete?.(k);
    if (I.keyPressed('Escape')) { I.keysPressed.delete('Escape'); this.exitSwim(); return; }
    const L = s.look;
    // mouse: drag to look, click to dart toward a point
    if (inp && !this.hoverBtn) {
      const pr = this.press;
      if (pr) {
        if (Math.hypot(inp.x - pr.x, inp.y - pr.y) > 4) pr.moved = true;
        if (inp.down || inp.rdown) {
          if (pr.moved) { L.yaw -= (inp.x - pr.lx) * 0.006; L.pitch = clamp(L.pitch - (inp.y - pr.ly) * 0.005, -1.25, 1.25); }
          pr.lx = inp.x; pr.ly = inp.y;
        } else {
          this.press = null;
          if (!pr.moved) {
            const ray = this.view.ray(inp.x, inp.y);
            let tgt = null;
            // a click near an Aero drop darts straight for it; otherwise toward a fish or into the water
            let bd = 26;
            for (const c of this.drops.list) { const sp = this.view.project(c.p); if (sp) { const d = Math.hypot(sp[0] - inp.x, sp[1] - inp.y); if (d < bd) { bd = d; tgt = c.p.slice(); } } }
            const f = tgt ? null : this.pickFish(ray);
            if (tgt) { /* drop */ } else if (f) tgt = f.p.slice();
            else {
              const tt = T.minDim * 0.6;
              tgt = [ray.o[0] + ray.d[0] * tt, ray.o[1] + ray.d[1] * tt, ray.o[2] + ray.d[2] * tt];
            }
            T.clamp(tgt, s.r);
            s.goal = tgt;
          }
        }
      } else if (inp.pressed || inp.rpressed) { inp.consume(); inp.rpressed = false; this.press = { x: inp.x, y: inp.y, lx: inp.x, ly: inp.y, moved: false }; }
      if (inp.wheel) L.pitch = clamp(L.pitch - inp.wheel * 0.08, -1.25, 1.25);
    }
    const turnK = 1.8;
    if (key('ArrowLeft') || key('a') && key('Alt')) L.yaw += turnK * dt;
    if (key('ArrowRight')) L.yaw -= turnK * dt;
    const fwd = this.swimDir(L.yaw, L.pitch), right = [Math.sin(L.yaw), 0, Math.cos(L.yaw)];
    let mx = 0, my = 0, mz = 0;
    const F = (key('w') || key('ArrowUp') ? 1 : 0) - (key('s') || key('ArrowDown') ? 1 : 0);
    const S = (key('d') ? 1 : 0) - (key('a') ? 1 : 0);
    const U = (key(' ') || key('e') ? 1 : 0) - (key('Shift') || key('c') || key('q') ? 1 : 0);
    if (F || S || U) s.goal = null;
    mx = fwd[0] * F + right[0] * S; my = fwd[1] * F + U; mz = fwd[2] * F + right[2] * S;
    if (s.goal) {
      const d = [s.goal[0] - s.p[0], s.goal[1] - s.p[1], s.goal[2] - s.p[2]];
      const l = Math.hypot(...d);
      if (l < s.r * 0.8) s.goal = null;
      else {
        mx = d[0] / l; my = d[1] / l; mz = d[2] / l;
        L.yaw = lerpAngle(L.yaw, Math.atan2(-d[2], d[0]), Math.min(1, dt * 3));
        L.pitch = lerp(L.pitch, clamp(Math.atan2(d[1], Math.hypot(d[0], d[2])), -1, 1), Math.min(1, dt * 2));
      }
    }
    const ml = Math.hypot(mx, my, mz);
    const vmax = s.r * 3.4 * (key('Shift') && F ? 1 : 1);
    const want = ml > 0.01 ? [mx / ml * vmax, my / ml * vmax, mz / ml * vmax] : [0, 0, 0];
    const acc = ml > 0.01 ? 4 : 2.2;
    for (let i = 0; i < 3; i++) s.v[i] = lerp(s.v[i], want[i], Math.min(1, dt * acc));
    // a gentle bob when idle
    s.v[1] += Math.sin(this.t * 1.8) * s.r * 0.05 * dt;
    for (let i = 0; i < 3; i++) s.p[i] += s.v[i] * dt;
    T.clamp(s.p, s.r * 0.75, s.r * 0.6);
    s.speed = Math.hypot(...s.v);
    s.kick = lerp(s.kick, clamp01(s.speed / vmax), Math.min(1, dt * 4));
    // body heading follows the look while moving, idles toward it otherwise
    s.yaw = lerpAngle(s.yaw, L.yaw, Math.min(1, dt * 5));
    s.pitch = lerp(s.pitch, L.pitch, Math.min(1, dt * 4));
    s.roll = lerp(s.roll, -S * 0.35, Math.min(1, dt * 5));
    // bubble trail
    s.bubT -= dt * (0.6 + s.kick * 3);
    if (s.bubT <= 0) {
      s.bubT = rng.float(0.12, 0.3);
      const hd = this.swimDir(s.yaw, s.pitch);
      this.addBubble([s.p[0] + hd[0] * s.r * 0.9, s.p[1] + s.r * 0.3, s.p[2] + hd[2] * s.r * 0.9], s.r * rng.float(0.05, 0.11));
    }
    if (s.p[1] > T.waterY - s.r * 0.9 && s.speed > s.r) this.ripples.add(s.p[0], s.p[2], 0.15);
    // swim through Aero drops
    for (let i = this.drops.list.length - 1; i >= 0; i--) {
      const c = this.drops.list[i];
      if (v3(c.p, s.p) < s.r * 1.25 + c.r) this.collectCoin(c, 'player');
    }
    // eat-through food? (fish only) ; poke fish you bump into
    for (const f of this.fish) {
      if (v3(f.p, s.p) < s.r + f.len * 0.4 && f.state !== 'flee') { f.poke(5); if (rng.chance(0.3)) f.say(rng.pick(['!', 'heart', '?']), 1); }
    }
  }

  swimCamera() {
    const s = this.swim, T = this.shape;
    const L = s.look;
    const d = this.swimDir(L.yaw, L.pitch);
    const back = s.r * 6.2, up = s.r * 1.7;
    let eye = [s.p[0] - d[0] * back, s.p[1] - d[1] * back + up, s.p[2] - d[2] * back];
    T.clamp(eye, 0.35, 0.3);
    // keep the camera out of decorations: stop before the first one between the swimmer and the eye
    for (let k = 1; k <= 8; k++) {
      const q = [s.p[0] + (eye[0] - s.p[0]) * k / 8, s.p[1] + (eye[1] - s.p[1]) * k / 8, s.p[2] + (eye[2] - s.p[2]) * k / 8];
      const hit = this.decor.some((dd) => q[1] < dd.p[1] + dd.h && Math.hypot(q[0] - dd.p[0], q[2] - dd.p[2]) < dd.r * 0.9);
      if (hit) { const kk = Math.max(0.25, (k - 1) / 8); eye = [s.p[0] + (eye[0] - s.p[0]) * kk, s.p[1] + (eye[1] - s.p[1]) * kk + s.r * 0.6, s.p[2] + (eye[2] - s.p[2]) * kk]; break; }
    }
    const ce = (this.camEye ||= eye.slice());
    for (let i = 0; i < 3; i++) ce[i] = lerp(ce[i], eye[i], 0.25);
    eye = ce.slice();
    const target = [s.p[0] + d[0] * s.r * 1.8, s.p[1] + d[1] * s.r * 1.8 + s.r * 1.0, s.p[2] + d[2] * s.r * 1.8];
    // dive-in: glide from the orbit camera into the water
    const k = smoothstep(0, 1, s.intro);
    if (k < 1) {
      const v = this.view;
      const c = v.cam, cp = Math.cos(c.pitch);
      const oe = [c.target[0] + Math.sin(c.yaw) * cp * c.dist, c.target[1] + Math.sin(c.pitch) * c.dist, c.target[2] + Math.cos(c.yaw) * cp * c.dist];
      return { eye: oe.map((x, i) => lerp(x, eye[i], k)), target: c.target.map((x, i) => lerp(x, target[i], k)) };
    }
    return { eye, target };
  }

  // ------------------------------------------------------------------ simulation
  simWorld() {
    const s = this.swim;
    return {
      tank: this.shape, fish: this.fish, food: this.food, decor: this.decor, night: this.nightK > 0.6,
      avatar: s ? { p: s.p, r: s.r, speed: s.speed } : null,
      cursor: !s && this.cursor3 && this.t - this.cursor3.t < 0.5 ? this.cursor3 : null,
      onEat: (f, food) => this.onEat(f, food), canCourt: (f) => this.canCourt(f), onCourt: (a, b) => this.onCourt(a, b),
      onStartle: (f) => { for (let i = 0; i < 3; i++) this.addBubble(f.p, f.len * 0.05); },
    };
  }

  pet(f) {
    f.say('heart', 1.2);
    f.poke(7);
    f.rec.happiness = Math.min(1, (f.rec.happiness ?? 0.7) + 0.01);
    this.sfx(f.sp.sound || 'blub', { vol: 0.35, pitch: 1.2 });
    this.fxAt(f.p, 'hearts', 2);
  }

  // sprinkle flakes over a point of the water (x, z)
  sprinkle(x, z, n = rng.int(5, 7)) {
    const T = this.shape;
    if (this.food.length > 60) return;
    const r = 0.18 * (T.fishLen / 6) + 0.08;
    for (let i = 0; i < n; i++) {
      const p = [x + rng.float(-1, 1) * T.fishLen * 0.4, T.waterY - 0.2, z + rng.float(-1, 1) * T.fishLen * 0.4];
      T.clamp(p, 0.6);
      this.food.push({ p, vy: rng.float(0.8, 1.6) * (T.fishLen / 6), t: 0, c: rng.pick(FOOD_COLS), eaten: false, wob: rng.float(0, TAU), landed: false, r });
    }
    this.ripples.add(x, z, 0.6);
    this.sfx('bubble', { vol: 0.35, pitch: 1.4 });
  }

  addBubble(p, r) {
    if (this.bubbles.length > 140) this.bubbles.shift();
    this.bubbles.push({ p: p.slice(), r: Math.max(0.08, r), vy: 0, wob: rng.float(0, TAU) });
  }

  updateFood(dt) {
    const T = this.shape;
    let w = 0;
    for (const p of this.food) {
      p.t += dt;
      if (p.eaten || p.t > 40) continue;
      if (!p.landed) {
        p.wob += dt * 3;
        p.p[1] -= p.vy * dt;
        p.p[0] += Math.sin(p.wob) * 0.4 * dt;
        p.p[2] += Math.cos(p.wob * 0.7) * 0.3 * dt;
        const fy = T.floorY(p.p[0], p.p[2]) + p.r;
        if (p.p[1] <= fy) { p.p[1] = fy; p.landed = true; }
        T.clamp(p.p, 0.4, p.r);
      }
      this.food[w++] = p;
    }
    this.food.length = w;
  }

  updateFish(dt) {
    const W = this.simWorld();
    for (const f of this.fish) f.update(dt, W);
  }

  updateDecor(dt) {
    for (const d of this.decor) {
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
      if (rng.chance(dt * 0.25)) this.addBubble(f.p, f.len * 0.035);
    }
    this.moodT -= dt;
    if (this.moodT <= 0) {
      const step = 0.5 - this.moodT;
      this.moodT = 0.5;
      const cap = this.capacity();
      const crowd = 1 - clamp01((n / cap - 0.65) / 0.7) * 0.6;
      const decor = clamp01((this.decor.length + (this.view.plants?.list?.length || 0) * 0.2) / (1.5 + n * 0.35) + this.tier * 0.06);
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
        if (avg > 0.4 && this.food.length < 6) { const p = this.shape.floorPoint(0.75, 0.3, 2); this.sprinkle(p[0], p[2], 8); this.sfx('click', { vol: 0.4 }); }
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
    let tx = Math.sin(s.t * 0.05) * T.size[0] * 0.4;
    if (rest.length) { rest.sort((a, b) => Math.abs(a.p[0] - s.x) - Math.abs(b.p[0] - s.x)); tx = rest[0].p[0]; }
    const sp = T.fishLen * 0.5 * (1 + ac * 0.2);
    s.dir = tx > s.x ? 1 : -1;
    s.x += clamp(tx - s.x, -sp * dt, sp * dt);
    const lim = T.round ? T.rAt(T.waterY - 1) * 0.8 : T.size[0] / 2 - 2;
    s.x = clamp(s.x, -lim, lim);
    const z = T.round ? Math.sqrt(Math.max(0, (T.rAt(T.waterY - 1.5) - 0.6) ** 2 - s.x * s.x)) : T.size[2] / 2 - 0.6;
    s.p = [s.x, T.waterY - 1.4 * (T.fishLen / 6), z];
    for (const c of rest) if (Math.abs(c.p[0] - s.x) < c.r + 1 && Math.abs(c.p[2] - z) < T.size[2] * 0.5) { this.collectCoin(c, 'helper'); break; }
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
    const T = this.shape, kit = this.view.kit;
    if (this.visibleKey && kit) {
      const air = gearLevel(this.st, 'air');
      this.bubT = (this.bubT || 0) - dt * (1 + air * 0.8) * (kit.stones.length ? 1 : 0.3);
      while (this.bubT < 0) {
        this.bubT += 0.09;
        const st = kit.stones[Math.floor(rng.next() * kit.stones.length)] || T.floorPoint(rng.next(), rng.next(), 2);
        this.addBubble([st[0] + rng.float(-0.3, 0.3), st[1], st[2] + rng.float(-0.3, 0.3)], T.fishLen * rng.pick([0.03, 0.04, 0.05, 0.07]) * (air >= 3 && rng.chance(0.2) ? 2 : 1));
      }
      if (kit.filterOut && rng.chance(dt * 6)) this.addBubble([kit.filterOut[0] + rng.float(-1, 1), kit.filterOut[1] - rng.float(0, 2), kit.filterOut[2] + rng.float(0, 1.5)], T.fishLen * 0.03);
    }
    let w = 0;
    for (const b of this.bubbles) {
      b.wob += dt * 5;
      b.vy = Math.min(b.vy + dt * 18 * (0.4 + b.r), 3 + b.r * 18);
      b.p[1] += b.vy * dt;
      b.p[0] += Math.sin(b.wob) * 0.6 * dt;
      b.p[2] += Math.cos(b.wob * 0.8) * 0.4 * dt;
      if (b.p[1] >= T.waterY - b.r * 0.5) { if (b.r > T.fishLen * 0.05) this.ripples.add(b.p[0], b.p[2], 0.12); continue; }
      this.bubbles[w++] = b;
    }
    this.bubbles.length = w;
  }

  // ------------------------------------------------------------------ decor interactions
  interact(d) {
    if (typeof d === 'string') d = this.decor.find((q) => q.rec.id === d);
    if (!d) return false;
    const spec = propInteract(d.rec.id) || { sfx: [], fx: [], squash: 0.1 };
    d.squashV += (spec.squash ?? 0.1) * 40 + 3;
    d.hop = spec.squash > 0.15 ? 3 : 0;
    if (spec.shake) d.shake = spec.shake;
    for (const e of spec.sfx || []) this.sfxQ.push({ at: e.at || 0, name: e.name, o: { vol: e.vol ?? 0.6, pitch: e.pitch } });
    const top = [d.p[0], d.p[1] + d.h, d.p[2]];
    for (const f of spec.fx || []) this.sfxQ.push({ at: f.at || 0, fx: f.kind, p: f.from === 'center' ? [d.p[0], d.p[1] + d.h * 0.5, d.p[2]] : top, n: f.n || 6, text: f.text });
    const near = this.fish.filter((f) => v3(f.p, d.p) < this.shape.minDim * 1.2);
    if (spec.fish === 'gather' || spec.fish === 'dance') for (const f of near) { f.setState('gather'); f.gather = { p: [d.p[0], d.p[1] + d.h * 0.7, d.p[2]], r: d.r + f.len, time: 4, dance: spec.fish === 'dance' }; }
    if (spec.fish === 'flee') for (const f of near) { const away = [f.p[0] * 2 - d.p[0], f.p[1] + 2, f.p[2] * 2 - d.p[2]]; this.shape.clamp(away, f.len); f.setState('flee', away); f.say('!', 1); }
    if (spec.coin && !(d.coinCd > 0)) { d.coinCd = spec.coin.cooldown || 30; this.sfxQ.push({ at: spec.coin.at || 0.3, coin: true, p: top }); }
    this.game.emit?.('decorPlayed', { id: d.rec.id });
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
      if (e.coin) this.drops.spawn(e.p, 1, { v: [0, 2, 0] });
    }
  }

  // effects at a 3D point: real bubbles in the water + screen-space sparkle / text particles
  fxAt(p, kind, n = 6, r = 0, text = null) {
    const T = this.shape;
    if (kind === 'food') { this.sprinkle(p[0], p[2], Math.min(8, n)); return; }
    if (kind === 'bubbles' || kind === 'foam' || kind === 'steam' || kind === 'smoke') { for (let i = 0; i < n; i++) this.addBubble([p[0] + rng.float(-1, 1), p[1], p[2] + rng.float(-1, 1)], T.fishLen * rng.float(0.03, 0.08)); return; }
    if (!this.visibleKey) return;
    const sp = this.view.project(p);
    if (!sp) return;
    const [x, y] = sp;
    const P = this.particles;
    switch (kind) {
      case 'pop': {
        const rr = r * this.view.ppu(sp[2]);
        P.ring(x, y, 0.15 + rr * 0.05, 'rgba(220,255,255,0.95)');
        for (let i = 0; i < 3; i++) P.sparkle(x + rng.float(-3, 3), y + rng.float(-3, 3), '#bff8ff');
        if (n > 1) P.text(x, y - 6, '+' + fmtAero(n), { font: 'small', color: '#e8fdff', layer: 'fg', life: 0.9, vy: -16 });
        break;
      }
      case 'hearts': for (let i = 0; i < n; i++) P.text(x + rng.float(-6, 6), y - 6, '{heart}', { layer: 'fg', life: 1, vy: -14 }); break;
      case 'text': if (text) P.text(x, y - 8, text, { font: 'small', color: '#ffffff', layer: 'fg', life: 1.6, vy: -10 }); break;
      case 'confetti': P.aeroConfetti ? P.aeroConfetti(x, y, n) : P.confetti(x, y, n); break;
      case 'evolve': P.shockwave?.(x, y, 26, '#bff6ff'); P.aeroConfetti ? P.aeroConfetti(x, y, 26) : P.confetti(x, y, 24); break;
      case 'burst': P.burst(x, y, n, { colors: ['#ffffff', '#bfeaff', '#c8f56a'], speed: 26, g: 30, life: 0.6, up: 8 }); break;
      default: for (let i = 0; i < Math.min(14, n); i++) P.sparkle(x + rng.float(-8, 8), y + rng.float(-8, 4), rng.pick(['#bff8ff', '#ffffff', '#fff6b0'])); break;
    }
    if (kind !== 'pop' && kind !== 'text') for (let i = 0; i < 3; i++) this.addBubble(p, T.fishLen * 0.04);
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
    const { W, H } = this.game.screen;
    if (!this.view.render(ctx, 0, 0, W, H)) drawFlat(ctx, this, 0, 0, W, H);
    this.drawOverlays(ctx, 0, 0, W, H);
    this.drawHud(ctx);
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
    const ix = r.x + FRAME.side, iy = r.y + FRAME.lid + off;
    // the window keeps its own gentle, slowly drifting front camera
    const v = this.view;
    const keep = { yaw: v.cam.yaw, pitch: v.cam.pitch, dist: v.cam.dist, target: v.cam.target.slice() };
    const f = v.kit ? v.frame() : null;
    if (f) { v.w = d.sw; v.h = d.sh; const ff = v.frame(); Object.assign(v.cam, { yaw: Math.sin(this.t * 0.12) * 0.28, pitch: 0.14, dist: ff.dist * 0.74, target: ff.target }); }
    ctx.save();
    ctx.beginPath(); ctx.rect(ix, iy, d.sw, d.sh); ctx.clip();
    if (!v.render(ctx, ix, iy, d.sw, d.sh)) drawFlat(ctx, this, ix, iy, d.sw, d.sh);
    this.drawOverlays(ctx, ix, iy, d.sw, d.sh);
    ctx.restore();
    Object.assign(v.cam, keep);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(ix - 1, iy - 1, d.sw + 2, 1);
    // chrome: title, buttons, stats
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

  // 2D overlays projected from the 3D scene: emotes, hover sparkles, the tutorial arrow, the snail, particles
  drawOverlays(ctx, ox, oy, w, h) {
    const v = this.view;
    if (!v.VP) return;
    ctx.save();
    ctx.translate(ox, oy);
    const t = this.t;
    for (const f of this.fish) {
      if (!f.emote) continue;
      const sp = v.project([f.p[0], f.p[1] + f.len * 0.45, f.p[2]]);
      if (!sp || sp[0] < -20 || sp[0] > w + 20) continue;
      const k = f.emote.t / f.emote.max;
      const name = EMOTE_ICON[f.emote.icon] || f.emote.icon;
      const y = Math.round(sp[1] - 4 - Math.min(1, f.emote.t * 6) * 3);
      ctx.globalAlpha = Math.min(1, (1 - k) * 4);
      if (name === 'dollar' || name === 'coin') drawAeroCoin(ctx, sp[0], y - 5, 4, t);
      else if (ICONS.has(name)) { const ic = getUiIcon(name); ctx.drawImage(ic, Math.round(sp[0] - ic.width / 2), y - ic.height); }
      else drawText(ctx, f.emote.icon, sp[0], y - 8, { align: 'center', color: '#ffffff', outline: '#0c3a52' });
      ctx.globalAlpha = 1;
    }
    const hf = this.hoverFish;
    if (hf) {
      const sp = v.project(hf.p);
      if (sp) { const r = hf.len * v.ppu(sp[2]) * 0.6 + 3; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + t * 2; drawSparkle(ctx, sp[0] + Math.cos(a) * r, sp[1] + Math.sin(a) * r * 0.7, 1, 0.8); } }
    }
    const hd = this.hoverDecor;
    if (hd && !this.drag) {
      const sp = v.project([hd.p[0], hd.p[1] + hd.h + 1, hd.p[2]]);
      if (sp) drawSparkle(ctx, sp[0], sp[1] - 2 + Math.sin(t * 5) * 1.5, 2, 0.9);
    }
    // Aero drops get a soft glow + a twinkle so the currency reads at any distance (light only)
    ctx.globalCompositeOperation = 'lighter';
    for (const c of this.drops.list) {
      const sp = v.project(c.p);
      if (!sp || sp[0] < -10 || sp[1] < -10 || sp[0] > w + 10 || sp[1] > h + 10) continue;
      const rr = clamp(c.r * v.ppu(sp[2]), 2, 26);
      drawAeroGlow(ctx, sp[0], sp[1], rr * 2.4, '#9af0ff', 0.22 + 0.08 * Math.sin(t * 3 + c.id));
      if (((t * 0.7 + c.id * 0.37) % 1) < 0.08) drawSparkle(ctx, sp[0] - rr * 0.4, sp[1] - rr * 0.4, rr > 6 ? 2 : 1, 0.9);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const c of this.drops.list) {
      if (!c.hint) continue;
      const sp = v.project(c.p);
      if (!sp) continue;
      const a = getUiIcon('arrow_d');
      const rr = c.r * v.ppu(sp[2]);
      if (a) ctx.drawImage(a, Math.round(sp[0] - a.width / 2), Math.round(sp[1] - rr - 6 - a.height + Math.sin(t * 7) * 2));
      if (rng.chance(0.08)) this.particles.sparkle(sp[0] + rng.float(-3, 3), sp[1] + rng.float(-3, 3), '#bff8ff');
    }
    // the snail janitor: a little glossy 2D sticker on the glass (a helper effect, drawn at its 3D spot)
    if (this.snail?.p) {
      const sp = v.project(this.snail.p);
      if (sp) drawSnail(ctx, sp[0], sp[1], Math.max(3, this.shape.fishLen * 0.35 * v.ppu(sp[2])), this.snail.dir, t);
    }
    this.particles.draw(ctx, 'fg', t);
    ctx.restore();
  }

  drawHud(ctx) {
    const g = this.game;
    const { W, H } = g.screen;
    const t = this.t;
    if (this.swim) {
      const s = this.swim;
      const lay = this.swimLayout(), pl = lay.pill;
      drawAeroSurface(ctx, pl.x, pl.y, pl.w, pl.h, { tone: 'frost', r: 'pill', gloss: 0.75, glossH: 8, rim: 0.9, glow: 0.5 });
      drawText(ctx, lay.msg, pl.x + pl.w / 2, Math.round(pl.y + (pl.h - (lay.font === 'normal' ? 7 : 5)) / 2), { font: lay.font, align: 'center', color: AERO.ink });
      const r = lay.exit;
      drawAeroButton(ctx, r.x, r.y, r.w, r.h, { label: 'Exit', icon: getUiIcon('arrow_u'), state: this.hoverBtn === 'exitswim' ? 'hover' : 'normal', tone: 'aqua' });
      if (s.got) { drawAeroCoin(ctx, W / 2 - 14, 38, 5, t); drawText(ctx, '+' + fmtAero(s.got), W / 2 - 6, 34, { color: '#ffffff', shadow: '#0a3e74' }); }
      // depth gauge
      const T = this.shape, k = clamp01((s.p[1] - T.floorY(s.p[0], s.p[2])) / Math.max(1, T.waterY - T.floorY(s.p[0], s.p[2])));
      drawAeroSurface(ctx, 10, Math.round(H / 2 - 50), 10, 100, { tone: 'glass', r: 5, gloss: 0.6, rim: 0.8 });
      drawAeroCoin(ctx, 15, Math.round(H / 2 + 45 - k * 90), 4, t);
      return;
    }
    const sm = this.tankSummary();
    const { pill: p, k } = this.fullLayout();
    drawAeroSurface(ctx, p.x, p.y, p.w, p.h, { tone: 'frost', r: 'pill', gloss: 0.75, glossH: Math.round(p.h * 0.45), curve: 2, rim: 0.9, glow: 0.5 });
    const ink = AERO.ink, font = k >= 1.4 ? 'big' : 'normal';
    const th = font === 'big' ? 9 : 7;
    let x = p.x + Math.round(10 * k);
    const ty = Math.round(p.y + (p.h - th) / 2);
    const icon = (name) => { const ic = getUiIcon(name); if (!ic) return; const s = k >= 1.4 ? 2 : 1; ctx.drawImage(ic, x, Math.round(p.y + (p.h - ic.height * s) / 2), ic.width * s, ic.height * s); x += ic.width * s + 3; };
    icon('fish');
    const fs = `${sm.fish}/${sm.cap}`;
    drawText(ctx, fs, x, ty, { color: ink, font });
    x += measureText(fs, font) + Math.round(10 * k);
    icon('heart');
    const hs = sm.fish ? `${Math.round(sm.happiness * 100)}%` : '--';
    drawText(ctx, hs, x, ty, { color: ink, font });
    x += measureText(hs, font) + Math.round(10 * k);
    drawAeroCoin(ctx, x + 4 * k, p.y + p.h / 2, 4.5 * k, t);
    x += Math.round(12 * k);
    drawText(ctx, `${sm.aeroPerMin.toFixed(1)}/min`, x, ty, { color: ink, font });
    const btns = this.fullButtons();
    for (const b of btns) {
      if (b.id === 'pill' || b.dock) continue;
      const st = this.hoverBtn === b.id ? 'hover' : 'normal';
      if (b.id === 'back') { drawAeroButton(ctx, b.x, b.y, b.w, b.h, { label: 'Ocean', icon: getUiIcon('arrow_l'), state: st, tone: 'aqua' }); continue; }
      drawAeroButton(ctx, b.x, b.y, b.w, b.h, { label: b.label, icon: getUiIcon('tank'), state: st, tone: b.tone || 'aqua' });
    }
    this.drawDock(ctx, btns.filter((b) => b.dock));
    if (this.arrange) {
      const msg = this.st.tank.stored.length ? 'Drag decor to move - wheel rotates - right-click stores - click the floor to place' : 'Drag decor to move - wheel rotates - right-click stores';
      const L0 = this.fullLayout(), af = L0.k >= 1.4 ? 'normal' : 'small';
      const mw = measureText(msg, af) + 20, mh = Math.round(16 * L0.k), my = L0.pill.y + L0.pill.h + 6;
      drawAeroSurface(ctx, Math.round(W / 2 - mw / 2), my, mw, mh, { tone: 'frost', r: 'pill', gloss: 0.7, glossH: Math.round(mh * 0.45), rim: 0.9 });
      drawText(ctx, msg, Math.round(W / 2), Math.round(my + (mh - (af === 'normal' ? 7 : 5)) / 2), { font: af, align: 'center', color: AERO.ink });
    }
    if (this.panel === 'gear') this.drawGearPanel(ctx);
    const ga = this.growAnim;
    if (ga && ga.t > 0.3 && ga.t < 2.9) {
      const a = clamp01(Math.min((ga.t - 0.3) * 3, (2.9 - ga.t) * 3));
      ctx.globalAlpha = a;
      const name = this.tierInfo().name;
      drawText(ctx, 'Tank expanded!', W / 2, Math.round(H * 0.16), { align: 'center', color: '#ffffff', outline: '#0a3e74', scale: 2 });
      drawText(ctx, name, W / 2, Math.round(H * 0.16) + 22, { align: 'center', color: '#bff8ff', outline: '#0a3e74' });
      ctx.globalAlpha = 1;
    }
    if (!this.view.ok) drawText(ctx, '2D view (WebGL2 unavailable)', 8, H - 40, { font: 'small', color: '#ffffff', outline: '#0a3e74' });
    else if (this.t < 12 && !this.arrange && !this.panel) {
      ctx.globalAlpha = clamp01((12 - this.t) / 2);
      drawText(ctx, 'Drag: orbit   Right-drag: pan   Wheel: zoom   Click water: feed', W / 2, H - Math.round(60 * this.hudK()) - 20, { font: this.hudK() >= 1.4 ? 'normal' : 'small', align: 'center', color: '#ffffff', outline: '#0a3e74' });
      ctx.globalAlpha = 1;
    }
  }

  // the right-hand dock, cached as one canvas until its look changes (hover, toggles, size)
  drawDock(ctx, dock) {
    if (!dock.length) return;
    const x0 = dock[0].x - 4, y0 = dock[0].y - 4, x1 = Math.max(...dock.map((b) => b.x + b.w)) + 4, y1 = Math.max(...dock.map((b) => b.y + b.h)) + 4;
    const key = dock.map((b) => b.id + (b.on ? 1 : 0) + b.icon + (this.hoverBtn === b.id ? 'h' : '') + b.y).join('|');
    let c = this.dockCv;
    if (!c || this.dockKey !== key) {
      c = this.dockCv = this.dockCv && this.dockCv.width === x1 - x0 && this.dockCv.height === y1 - y0 ? this.dockCv : document.createElement('canvas');
      c.width = x1 - x0; c.height = y1 - y0;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, c.width, c.height);
      g.translate(-x0, -y0);
      for (const b of dock) {
        drawAeroButton(g, b.x, b.y, b.w, b.h, { tone: b.on ? 'green' : b.tone || 'glass', state: b.on ? 'down' : this.hoverBtn === b.id ? 'hover' : 'normal', radius: 8 });
        const ic = getUiIcon(b.icon), s = b.kd >= 1.2 ? 2 : 1;
        if (ic) g.drawImage(ic, Math.round(b.x + (b.w - ic.width * s) / 2), b.y + Math.round(4 * b.kd), ic.width * s, ic.height * s);
        const lf = b.kd >= 1.2 ? 'normal' : 'small';
        drawText(g, b.label, b.x + b.w / 2, b.y + b.h - (lf === 'normal' ? 11 : 9), { font: lf, align: 'center', color: '#ffffff', shadow: '#0a3e74' });
      }
      this.dockKey = key;
    }
    ctx.drawImage(c, x0, y0);
  }

  drawGearPanel(ctx) {
    const r = this.gearPanelRect(), k = r.k;
    drawAeroPanel(ctx, r.x, r.y, r.w, r.h, { tone: 'glass', radius: 10, title: 'Tank Gear' });
    const ink = AERO.ink;
    const big = k >= 1.4, f1 = big ? 'big' : 'normal', f2 = big ? 'normal' : 'small';
    const is = big ? 2 : 1;
    const icon = (name, x, y) => { const ic = getUiIcon(name); if (ic) ctx.drawImage(ic, x, y, ic.width * is, ic.height * is); };
    const L = (v) => Math.round(v * k);
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
      icon(row.g.icon, row.x + L(6), row.y + L(8));
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
function raySphere(ray, c, r) {
  const ox = ray.o[0] - c[0], oy = ray.o[1] - c[1], oz = ray.o[2] - c[2];
  const b = ox * ray.d[0] + oy * ray.d[1] + oz * ray.d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
function lerpAngle(a, b, k) { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * k; }

function drawSnail(ctx, x, y, s, dir, t) {
  x = Math.round(x); y = Math.round(y);
  const r = Math.max(2, Math.round(s * 0.45));
  ctx.fillStyle = '#9be84a';
  ctx.fillRect(x - Math.round(s * 0.6), y, Math.round(s * 1.2), Math.max(1, Math.round(s * 0.25)));
  ctx.fillRect(x + dir * Math.round(s * 0.5), y - Math.round(s * 0.35), 1, Math.round(s * 0.35));
  ctx.beginPath(); ctx.arc(x - dir * Math.round(s * 0.1), y - r * 0.6, r, 0, TAU); ctx.fillStyle = '#3ac4f8'; ctx.fill();
  ctx.beginPath(); ctx.arc(x - dir * Math.round(s * 0.1), y - r * 0.6, r * 0.5, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x + dir * Math.round(s * 0.5), y - Math.round(s * 0.4) + (Math.sin(t * 3) > 0.9 ? 1 : 0), 1, 1);
}
