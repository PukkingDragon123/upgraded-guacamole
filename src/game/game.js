// FISHTOP game orchestrator: owns every system, routes input top-down, draws the layered scene.
// Phase 4: a standalone Frutiger Aero fishing game. The simulated desktop is gone; the game menu is the Aero HUD
// (src/ui/hud.js, game.hud) and bait is bought at Dot's Bait Shop (src/store/, game.store, panel 'baitshop').

import { clamp, clamp01, lerp, dist, damp, rectContains } from '../core/math.js';
import { rng } from '../core/rng.js';
import { RARITY } from '../core/color.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { Screen } from './screen.js';
import { Camera } from './camera.js';
import { loadState, saveState, resetState } from './state.js';
import { computeStats, SKILL_BY_ID, skillStatus } from './skills.js';
import { RELEASE_VALUE, CATCH_BONUS } from './shopdata.js';
import { Particles } from '../gfx/particles.js';
import { drawText } from '../gfx/font.js';
import { registerUiIcons, getUiIcon, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';
import { biomesReady, BIOMES } from '../world/biomes/index.js';
import { School } from '../fish/school.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { rollIndividual, valueMultiplier } from '../fish/traits.js';
import { Fishing } from '../fishing/fishing.js';
import { BaitEffects } from '../fishing/baiteffects.js';
import { UI } from '../ui/ui.js';
import { registerPanels } from '../ui/registry.js';
import { Aquarium } from '../aquarium/aquarium.js';
import { Tutorial } from './tutorial.js';
import { Hud } from '../ui/hud.js'; // [phase4:shell] the Aero game HUD replaces the desktop icons
import { host } from '../platform/host.js';
import { installBrowserBridge } from './browserbridge.js';
import { Boat } from '../world/boat.js';
import { Build } from '../build/build.js';
import { boatBonus, installStore, openStore, ShopPanel } from '../store/index.js'; // [phase4:shell] Dot's Bait Shop
import { WaterFX } from '../gfx/watergl.js';
import { makeLayer, resizeLayer } from '../core/canvas.js';
import { Floaters } from '../world/floaters.js'; // [phase3:world]
import { installNet } from '../net/index.js'; // [phase3:online] multiplayer (opt-in)
import { currentBait as currentBait3 } from '../store/bait.js'; // [phase3:online] consumable bait
import { consumeBait as consumeBait3, equipBait } from '../store/bait.js'; // [phase3:fishing] one bait used per hook-set

export class Game {
  constructor(canvas, params) {
    this.params = params;
    this.canvas = canvas;
    this.mode = host.mode || 'window'; // 'window' | 'fullscreen' (Electron); the overlay modes are gone
    this.screen = new Screen(canvas, { scale: Number(params.get('scale')) || 0 });
    this.input = new Input(canvas, this.screen.toLogical);
    this.state = params.has('fresh') ? resetState() : loadState();
    this.recomputeStats();
    this.audio = audio;
    this.particles = new Particles(900);
    this.camera = new Camera(this);
    this.clock = new Clock(this);
    this.events = {};
    this.on('boatUpgraded', () => this.recomputeStats());
    this.time = 0;
    this.timeScale = 1; this.timeScaleTarget = 1;
    this.paused = false;
    this.muted = false;
    this.mini = false; // kept for older readers (mini mode is gone)
    this.lowPower = !!this.state.settings.lowPower;
    this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
    const self = this;
    this.world = {
      W: this.screen.W, H: this.screen.H, surfaceY: 0,
      floorAt: (x, z = 0) => self.ocean.floorAt(x, z),
      cursor: { x: -100, y: -100, vx: 0, vy: 0, speed: 0, inWorld: false },
      hook: { x: 0, y: 0, active: false, inWater: false, bait: null, radiusMul: 1 },
      fishes: [], icons: [], windows: [], particles: this.particles, audio,
      desktop: null, biome: this.state.biome, night: false, dusk: false, weather: 'calm', hour: 12,
      secrets: this.state.secrets, rarityBoost: 1, calmMul: 1, isTank: false, glowLevel: 0,
      requestNibble: (f) => self.fishing.requestNibble(f),
      rollMods: {},
    };
    this.ocean = new Ocean(this);
    const wgl = params.get('watergl');
    this.water = new WaterFX(this, { force: wgl === 'force' || wgl === '1', disabled: wgl === '0' || this.state.settings.waterFx === false });
    this.worldLayer = makeLayer(8, 8);
    this.boat = new Boat(this);
    this.floaters = new Floaters(this); // [phase3:world] floating boxes to fish up
    this.wireSplashes();
    this.hud = new Hud(this); // [phase4:shell] Aero HUD: hotbar, gear pod, location chip
    this.desktop = this.hud.compat(); // [phase4:shell] tiny stand-in for older callers (iconRect, box, windows)
    this.school = new School(this.world);
    this.fishing = new Fishing(this);
    this.baitFx = new BaitEffects(this);
    this.aquarium = new Aquarium(this);
    this.ui = new UI(this);
    registerUiIcons();
    registerPanels(this.ui);
    this.ui.register(new ShopPanel()); // [phase4:shell] 'baitshop'
    installStore(this); // [phase4:shell] game.store: Dot's Bait Shop (stock, restock, prices)
    this.tutorial = new Tutorial(this);
    try { this.build = new Build(this); } catch (e) { console.error(e); this.build = null; }
    installNet(this); // [phase3:online] game.net: multiplayer, opt-in (Multiplayer panel)
    this.ocean.setBiome(this.state.biome);
    // optional biomes register asynchronously; switch once the saved one is available
    biomesReady.then(() => { if (this.ocean.biome?.id !== this.state.biome && BIOMES[this.state.biome] && !this.ocean.travelState) this.ocean.setBiome(this.state.biome); });
    this.screen.onResize(() => this.onResize());
    this.onResize();
    this.bindHost();
    this.bindGlobal();
    installBrowserBridge(this);
    this.saveT = 10;
    this.offline();
    if (this.pendingWelcome) setTimeout(() => this.ui.open('welcome'), 1500);
    if (!this.state.tutorialDone && !params.has('skipintro')) this.tutorial.start();
    else {
      this.ocean.reveal = 1;
      if (!this.state.tutorialDone) this.tutorial.skip();
    }
    window.FISHTOP = this;
  }

  // ------------------------------------------------------------------ events
  on(ev, fn) { (this.events[ev] ||= []).push(fn); }
  off(ev, fn) { this.events[ev] = (this.events[ev] || []).filter((f) => f !== fn); }
  emit(ev, data) { for (const f of this.events[ev] || []) f(data); }

  // Every particle splash also kicks the water sim (surface waves + ripples).
  wireSplashes() {
    const ps = this.particles;
    if (!ps || typeof ps.splash !== 'function' || ps.__water) return;
    const orig = ps.splash.bind(ps);
    ps.__water = true;
    ps.splash = (x, y, power = 1, ...rest) => {
      const r = orig(x, y, power, ...rest);
      const w = this.water;
      if (w && Number.isFinite(x) && Number.isFinite(y)) {
        const s = w.surfaceY;
        if (s !== null && Math.abs(y - s) < 16) w.splash(x, 0.6 + power * 0.9, 8 + power * 10);
        else w.disturb(x, y + 3, 0.6 + power * 0.8, 6 + power * 6);
      }
      return r;
    };
  }

  recomputeStats() {
    const s = this.stats = computeStats(this.state); // [phase3:lab] whole save: Lab effects + aquarium tier space
    // boat perks (Barnaby's Boatyard)
    const b = (k) => boatBonus(this.state, k);
    s.boxSlots += b('baitSlots');
    s.reelSpeed *= b('reel');
    s.collectRadius *= b('coinMagnet');
    s.rarityBoost *= b('rarity');
  }

  onResize() {
    const { W, H } = this.screen;
    this.world.W = W; this.world.H = H;
    this.ocean.onResize();
    this.surfaceScroll = -Math.round(H * 0.62);
    this.camera.setScrollRange(this.surfaceScroll, 0);
    this.aquarium.onResize?.();
  }

  bindHost() {
    host.onShortcut?.((id) => {
      if (id === 'pause') this.command('pause');
      if (id === 'fullscreen') this.command('fullscreen');
    });
  }

  bindGlobal() {
    const unlock = () => { audio.unlock(); this.applyVolumes(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('beforeunload', () => this.save());
  }

  applyVolumes() {
    const s = this.state.settings;
    audio.setVolumes({ master: this.muted ? 0 : s.master, music: s.music, sfx: s.sfx, ambience: s.ambience });
  }

  save() { saveState(this.state); }

  toast(text, icon) { this.ui.toast(text, icon); }

  // ------------------------------------------------------------------ economy
  addCoins(n, x, y) {
    n = Math.max(0, n);
    this.state.coins += n;
    this.state.totalCoins += n;
    this.state.stats.coinsCollected += n;
    if (x !== undefined) {
      const k = Math.min(6, Math.ceil(n / 3));
      for (let i = 0; i < k; i++) this.ui.coinFly(x + rng.float(-4, 4), y + rng.float(-4, 4), n / k);
    }
  }

  spendCoins(n) {
    if (this.state.coins < n) { audio.play('ui_error'); return false; }
    this.state.coins -= n;
    return true;
  }

  coinDisplay() { return Math.floor(this.ui.coinShown).toLocaleString('en'); }

  speciesFound() { return Object.values(this.state.journal).filter((j) => j.caught > 0).length; }

  unlockSkill(id) {
    const sk = SKILL_BY_ID[id];
    if (!sk) return false;
    const st = skillStatus(sk, this.state, this.speciesFound());
    if (st.status !== 'available') { audio.play('ui_error'); this.toast(st.reason || 'Locked', 'lock'); return false; }
    if (!this.spendCoins(sk.cost)) { this.toast('Not enough Aero.', 'coin'); return false; }
    this.state.skills[id] = true;
    this.recomputeStats();
    audio.play('ui_unlock');
    if (sk.effect.unlockBiome) {
      if (!this.state.unlockedBiomes.includes(sk.effect.unlockBiome)) this.state.unlockedBiomes.push(sk.effect.unlockBiome);
      audio.play('unlock_biome');
      this.toast(`New ocean unlocked! Open the Travel Map.`, 'map');
    }
    this.emit('skill', id);
    this.save();
    return true;
  }

  // ------------------------------------------------------------------ bait
  // Consumable bait (src/store/bait.js): bought at the Bait Shop or mixed in the Bait panel. [phase4:shell]
  currentBait() {
    return currentBait3(this.state); // [phase3:online] consumable bait inventory
  }

  equip(kind, id) {
    if (!equipBait(this.state, kind === 'bait' || kind === 'special' ? id : kind)) return;
    audio.play('ui_click');
    this.baitFx.onEquip(this.currentBait());
  }

  consumeBait() {
    if (!this.currentBait()) return false;
    const ok = consumeBait3(this.state); // [phase3:fishing] one-time bait, used at hook-set
    const now = this.currentBait();
    if (!now) this.toast('Out of bait! Visit the Bait Shop.', 'bait');
    this.baitFx.onEquip(now);
    return ok;
  }

  // Legacy entry (old shop ids): buys that bait at the Bait Shop.
  buyBait(id) {
    const r = this.store?.buy?.(id);
    if (r?.ok) this.emit('buy', id);
    return !!r?.ok;
  }

  // ------------------------------------------------------------------ catching
  onHooked(fish) {
    this.emit('hooked', fish);
  }

  onFishCaught(fish) {
    const sp = fish.sp;
    this.school.remove(fish);
    const rec = { ...fish.rec, caughtAt: Date.now(), biome: this.ocean.biome.id, rarity: sp.rarity };
    const st = this.state;
    st.stats.caught++;
    const j = (st.journal[sp.id] ||= { seen: true, caught: 0, maxSize: 0, minSize: 9999, first: Date.now(), variants: {} });
    const isNew = j.caught === 0;
    const record = rec.sizeCm > j.maxSize && j.caught > 0;
    j.caught++;
    j.maxSize = Math.max(j.maxSize, rec.sizeCm);
    j.minSize = Math.min(j.minSize, rec.sizeCm);
    if (rec.variant?.mutation) j.variants[rec.variant.mutation] = true;
    if (rec.variant?.shiny) j.variants.shiny = true;
    fish.carry = null;
    const bonus = Math.round((CATCH_BONUS[sp.rarity] || 2) * valueMultiplier(rec));
    this.addCoins(bonus, fish.x, fish.y);
    // buildings: samples, carried crates, bait saves (before the bait is consumed)
    let loot = null;
    try { loot = this.build?.onCatch?.(fish, sp, rec) ?? null; } catch (e) { console.error(e); }
    audio.play(sp.rarity === 'legendary' ? 'catch_legendary' : sp.rarity === 'epic' ? 'catch_epic' : sp.rarity === 'rare' ? 'catch_rare' : 'catch');
    if (sp.sound) setTimeout(() => audio.play(sp.sound, { pitch: 1 / Math.max(0.6, fish.scale) }), 250);
    this.camera.flash('#ffffff', sp.rarity === 'legendary' ? 0.9 : 0.5);
    this.emit('caught', { rec, sp, isNew, record });
    const data = { rec, sp, isNew, record, bonus, emotion: fish.emotion, loot };
    if (!this.tutorial.onCaught(fish, data)) this.ui.open('reveal', data);
    this.save();
  }

  onFishEscaped(fish, reason) {
    this.emit('escaped', { fish, reason });
  }

  // [phase3:fishing] a floating box reeled in by the line: take it, loot via build (items.rollCrate), glossy pop-up
  onBoxCaught(f) {
    try { this.floaters?.take?.(f); } catch (e) { console.error(e); }
    let loot = null;
    try { loot = this.build?.onBoxCaught?.(f) ?? null; } catch (e) { console.error(e); }
    this.fishing.showBoxLoot?.(f, loot);
    return loot;
  }

  tankCount() { return this.state.fish.filter((f) => f.inTank).length; }

  keepFish(rec) {
    const inTank = this.tankCount() < this.stats.tankCap;
    const owned = { ...rec, inTank, happiness: 0.75, hunger: 0.3, coinT: 0 };
    this.state.fish.push(owned);
    if (inTank) this.aquarium.addFish(owned);
    else this.toast('Tank is full - fish sent to the holding bucket. Upgrade your tank!', 'tank');
    this.emit('kept', owned);
    this.save();
  }

  releaseFish(rec, x, y) {
    const sp = SPECIES_BY_ID[rec.species];
    const v = Math.round((RELEASE_VALUE[sp?.rarity] || 4) * valueMultiplier(rec));
    this.addCoins(v, x ?? this.screen.W / 2, y ?? this.screen.H / 2);
    this.state.stats.released++;
    audio.play('splash_small');
    this.emit('released', rec);
    this.save();
    return v;
  }

  // ------------------------------------------------------------------ commands & travel
  command(id) {
    const ui = this.ui;
    switch (id) {
      case 'journal': case 'skills': case 'map': case 'bait': case 'settings': case 'lab': case 'wardrobe': case 'multiplayer': case 'inventory':
        if (ui.panels[id]) ui.toggle(id); else this.toast('Coming soon!', 'info');
        break;
      case 'baitshop': case 'shop': case 'store': case 'appsea': // [phase4:shell] Dot's Bait Shop
        if (ui.isOpen('baitshop')) ui.close('baitshop'); else openStore(this);
        break;
      case 'tank':
        this.setView(this.state.view === 'aquarium' ? 'ocean' : 'aquarium');
        break;
      case 'tankwindow':
        this.aquarium.toggleWindow();
        break;
      case 'pause':
        this.paused = !this.paused;
        this.toast(this.paused ? 'Paused. Press P to fish again.' : 'Back to fishing!', this.paused ? 'pause' : 'play');
        if (this.paused && this.fishing.busy) this.fishing.releaseFish(true);
        break;
      case 'fullscreen': // [phase4:shell] Electron toggles its window; the browser uses the Fullscreen API
        if (host.toggleFullscreen) host.toggleFullscreen();
        else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
        break;
      case 'mute':
        this.muted = !this.muted;
        this.applyVolumes();
        break;
      default:
        break;
    }
  }

  setView(v) {
    if (this.fishing.fighting) return;
    this.state.view = v;
    if (v !== 'ocean') this.camera.scrollTo(0, true);
    if (v === 'aquarium') { this.fishing.releaseFish(false); this.aquarium.closeWindow?.(); }
    audio.play('travel_whoosh', { vol: 0.5 });
    audio.setMusic(this.musicFor());
    this.camera.flash('#bfefff', 0.35);
  }

  musicFor() {
    if (this.state.view === 'aquarium') return 'aquarium';
    return this.ocean.biome?.music || 'shallows'; // [phase4:intro] no "desktop before the flood" track any more
  }

  musicTrackName() {
    const t = this.musicFor();
    return { desktop: 'Bubble Lullaby', oscean: '(OS)cean Startup Chime', shallows: 'Sunny Shallows Groove', fjord: 'Frosty Fjord Aurora', junkyard: 'Junkyard Glitch-Hop', metropolis: 'Metropolis Neon Nights', volcano: 'Lava Rift Rumble', abyss: 'Deep Ocean Drone', aquarium: 'Aquarium Dreams' }[t] || 'Silence';
  }

  biomeName() { return this.ocean.biome?.name || 'Ocean'; }

  travel(id) {
    if (!this.state.unlockedBiomes.includes(id) || this.ocean.travelState) return false;
    if (this.fishing.busy) this.fishing.releaseFish(false);
    this.ui.stack = [];
    this.setView('ocean');
    this.camera.scrollTo(0, true);
    this.ocean.travel(id, () => {
      this.state.biome = id;
      this.world.biome = id;
      this.save();
    });
    return true;
  }

  debugSpawnRandom() {
    const pool = SPECIES.filter((s) => s.biome === this.ocean.biome.id);
    if (pool.length) this.school.spawn(rng.pick(pool), { fromFog: false });
  }

  clockTooltip() {
    const h = this.clock.hour();
    return `${this.biomeName()} - ${this.ocean.weatherName()} - ${this.clock.isNight() ? 'night' : h < 8 ? 'dawn' : h > 17 ? 'evening' : 'day'}`;
  }

  // ------------------------------------------------------------------ offline progress
  offline() {
    const away = (Date.now() - (this.state.lastSeen || Date.now())) / 1000;
    if (away > 120 && this.state.tutorialDone) {
      const coins = this.aquarium.offlineCoins?.(Math.min(away, 8 * 3600)) || 0;
      if (coins > 0) {
        this.pendingWelcome = { away, coins };
      }
    }
  }

  // ------------------------------------------------------------------ main update
  update(dtReal) {
    const inp = this.input;
    inp.update(dtReal);
    const cam = this.camera;
    const view = this.state.view;
    const ocean = this.ocean;
    // the camera may only leave the default view in the open ocean
    const canScroll = view === 'ocean' && ocean.reveal >= 1 && !ocean.travelState && !this.tutorial.active;
    cam.setScrollRange(canScroll ? this.surfaceScroll : 0, 0);
    cam.update(dtReal);
    this.timeScale = damp(this.timeScale, this.timeScaleTarget * cam.timeScale(), 10, dtReal);
    const dt = dtReal * this.timeScale;
    this.time += dt;
    this.state.stats.playTime += dtReal;

    // world env sync (the world cursor lives in world space; the input stays in screen space)
    const w = this.world, cur = w.cursor;
    const [z] = cam.xform();
    const [cwx, cwy] = cam.screenToWorld(inp.x, inp.y);
    cur.x = cwx; cur.y = cwy; cur.vx = inp.vx / z; cur.vy = inp.vy / z; cur.speed = inp.speed / z;
    w.night = this.clock.isNight(); w.dusk = this.clock.isDusk(); w.hour = this.clock.hour();
    w.weather = ocean.weather; w.biome = ocean.biome.id;
    const bm = this.currentBait()?.mods; // AppSea bait power (bigger downloads = better fish)
    w.rarityBoost = this.stats.rarityBoost * this.baitFx.rarityMul() * (bm?.rarity || 1) * (1 + this.bonus('rarity') + (w.night ? this.bonus('nightRarity') : 0));
    w.rarityBoost *= this.net?.partyLuck?.() || 1; // [phase3:online] party buff: +10% per player in this ocean (max +30%)
    w.rarityBoost *= this.fishing.luckMul?.() || 1; // [phase3:fishing] rod luck (rodStats().luck x bait luck)
    w.calmMul = this.stats.calm;
    w.lowPower = this.lowPower;
    w.populationMul = this.baitFx.populationMul();
    w.rollMods = { mutationChance: this.stats.mutationChance * (1 + this.bonus('mutation')), shinyChance: this.stats.shinyChance * (1 + this.bonus('shiny')), ...(bm ? { sizeBonus: bm.sizeBonus, giantChance: 0.04 * bm.giantMul } : {}) };
    w.icons = []; // [phase4:shell] no desktop icons / windows for fish to perch on, steal or hide behind
    w.windows = [];
    w.isTank = false;
    w.surfaceY = ocean.reveal < 1 ? null : ocean.surfaceY();
    this.particles.surfaceY = view === 'ocean' ? w.surfaceY : null;
    w.glowLevel = ocean.biome.lighting(ocean.env).dark;
    ocean.env.view = cam.view();
    ocean.env.top = ocean.top;
    ocean.env.scroll = cam.scrollY;
    ocean.env.ref = this.surfaceScroll;
    w.boat = this.boat;
    w.water = this.water;

    this.ui.update(dtReal);
    ocean.update(dt);
    this.floaters?.update(dt); // [phase3:world]
    this.baitFx.update(dt);
    this.net?.update(dtReal); // [phase3:online]
    this.storeT = (this.storeT || 0) - dtReal;
    if (this.storeT <= 0) { this.storeT = 0.5; try { this.store?.tick?.(); } catch (e) { console.error(e); } } // [phase4:shell] shop restocks

    // ---- input routing (top-most first)
    const fighting = this.fishing.fighting;
    const openWater = view === 'ocean' && ocean.reveal >= 1 && !ocean.travelState;
    let layer = null;
    if (this.tutorial.capturesInput?.()) layer = 'tutorial';
    else if (this.ui.hit(inp.x, inp.y) && !fighting) layer = 'ui';
    else if (!fighting && this.hud.hit(inp.x, inp.y)) layer = 'hud'; // [phase4:shell] the Aero HUD
    else if (!fighting && this.aquarium.hit?.(inp.x, inp.y)) layer = 'tank';
    // world objects under the cursor: build mode / buildings, then the boat
    if (layer === null && !fighting && openWater && inp.inside) {
      let bh = false;
      try { bh = !!(this.build?.active || this.build?.hit?.(cur.x, cur.y)); } catch (e) { bh = false; }
      if (bh) layer = 'build';
      else if (this.boat.dragging || (!this.fishing.busy && this.boat.hit(cur.x, cur.y))) layer = 'boat';
    }
    if (this.boat.dragging && !fighting) layer = 'boat';
    this.layer = layer;
    cur.inWorld = (layer === null || fighting) && view === 'ocean' && inp.inside;

    // mouse wheel over open water scrolls between the underwater view and the surface/boat view
    if (inp.wheel && canScroll && (layer === null || layer === 'boat') && !fighting && !cam.focusOn) {
      cam.scrollBy(inp.wheel * this.screen.H * 0.11);
    }
    if (canScroll && !fighting) {
      if (inp.keyPressed('PageUp') || inp.keyPressed('Home')) cam.scrollTo(this.surfaceScroll);
      if (inp.keyPressed('PageDown') || inp.keyPressed('End')) cam.scrollTo(0);
    }

    this.hud.update(dtReal, inp, layer === 'hud'); // [phase4:shell]
    this.aquarium.update(dt, layer === 'tank' ? inp : null);

    const worldInput = (layer === null || fighting) && view === 'ocean' && (ocean.reveal >= 1 || this.tutorial.allowFishing) && !ocean.travelState;
    // double-clicking a posing Shortcut Fish unmasks it
    if (worldInput && inp.dblclick && !fighting) {
      for (const f of this.school.fishes) if (f.posing && dist(f.x, f.y, cur.x, cur.y) < 18) { f.unmask(); inp.consume(); }
    }
    // the boat and the building system (world space)
    this.boat.update(dt, layer === 'boat' ? inp : null);
    try { this.build?.update?.(dt, inp, layer); } catch (e) { if (!this.buildErr) { this.buildErr = true; console.error(e); } }
    if (view === 'ocean') {
      this.school.update(dt);
      this.fishing.update(dt, worldInput);
      const rb = this.bonus('baitRadius');
      if (rb) w.hook.radiusMul = (w.hook.radiusMul || 1) * (1 + rb);
      // secrets
      if (worldInput && inp.pressed && !this.fishing.busy) {
        const sid = ocean.biome.secretAt?.(cur.x, cur.y);
        if (sid) ocean.biome.onSecret?.(sid, this);
      }
    }
    this.updateWater(dt);
    this.tutorial.update(dt);
    this.particles.update(dt);
    this.handleKeys();

    // autosave
    this.saveT -= dtReal;
    if (this.saveT <= 0) { this.saveT = 15; this.save(); }
  }

  // Feed the water sim: hook trail, the line cutting the surface, fish wakes and jumps, then step it.
  updateWater(dt) {
    const water = this.water, ocean = this.ocean;
    if (!water) return;
    const live = this.state.view === 'ocean' && ocean.reveal >= 1 && !ocean.travelState;
    const level = live ? ocean.waterLevel() : null;
    water.update(dt, { surfaceY: level, top: ocean.top, W: this.screen.W, H: this.screen.H, waveAt: (x) => ocean.waveAt(x) });
    if (!live) return;
    this.waterT = (this.waterT || 0) + dt;
    const tick = this.waterT >= 1 / 30;
    if (tick) this.waterT = 0;
    const h = this.fishing.hook;
    if (h?.visible && tick) {
      const hx = h.x, hy = h.y;
      const px = this.prevHook?.[0] ?? hx, py = this.prevHook?.[1] ?? hy;
      const sp = Math.hypot(hx - px, hy - py) * 30;
      if (sp > 25 && (level === null || hy > level + 2)) water.disturb(hx, hy, Math.min(0.9, sp / 520), 4 + Math.min(4, sp / 200));
      // where the line crosses the surface
      if (level !== null && this.boat.visible && hy > level) {
        const [rx, ry] = this.boat.rodTip();
        if (ry < level) {
          const k = (level - ry) / Math.max(1, hy - ry);
          const lx = rx + (hx - rx) * k;
          const plx = this.prevLineX ?? lx;
          const lsp = Math.abs(lx - plx) * 30;
          if (lsp > 20) water.surf.impulse(lx, -Math.min(40, lsp * 0.12), 6);
          this.prevLineX = lx;
        }
      }
      this.prevHook = [hx, hy];
    } else if (!h?.visible) this.prevHook = null;
    // fish: wakes near the surface, faint trails when dashing, splashes when they break the surface
    const s = level;
    for (const f of this.school.fishes) {
      const fy = f.y, py = f.__wy ?? fy;
      f.__wy = fy;
      if (s === null) continue;
      if ((py > s) !== (fy > s) && Math.abs(fy - py) < 60) {
        const k = Math.min(1.6, (f.scale || 1) * 0.8 + Math.abs(fy - py) * 0.04);
        water.splash(f.x, 0.6 + k, 10 + k * 10);
        water.disturb(f.x, s + 4, 0.8 * k, 8 + k * 6);
        continue;
      }
      if (!tick) continue;
      const v = Math.hypot(f.vx || 0, f.vy || 0);
      const depth = fy - s;
      if (depth > 0 && depth < 26 && v > 14 && f.z < 0.7) {
        water.surf.impulse(f.x, -(4 + v * 0.06) * (1 - depth / 26), 8 + (f.scale || 1) * 6);
        if (Math.random() < 0.25) water.disturb(f.x - Math.sign(f.vx || 1) * 8, fy, 0.18, 5);
      } else if (v > 70 && f.z < 0.5 && Math.random() < 0.2) water.disturb(f.x - Math.sign(f.vx || 1) * 10 * (f.scale || 1), fy, 0.12, 5);
    }
  }

  handleKeys() {
    const inp = this.input;
    const map = { j: 'journal', l: 'lab', k: 'lab', t: 'map', b: 'bait', s: 'baitshop', w: 'wardrobe', o: 'multiplayer', p: 'pause', a: 'tank' };
    for (const [k, cmd] of Object.entries(map)) {
      if (inp.keyPressed(k)) {
        if (this.tutorial.active && cmd !== 'pause') continue;
        this.command(cmd);
      }
    }
    if (inp.keyPressed('F3')) this.state.settings.showFps = !this.state.settings.showFps;
    // Esc with nothing open: the settings / pause menu (an open panel closes itself on Esc)
    if (inp.keyPressed('Escape') && !this.ui.active && !this.fishing.fighting && !this.tutorial.intro) { this.command('settings'); inp.keysPressed?.delete?.('Escape'); }
    if (!this.tutorial.active) {
      if (inp.keyPressed('u')) { try { this.build?.toggle?.(); } catch (e) { console.error(e); } }
      if (inp.keyPressed('i') && this.ui.panels?.inventory) this.ui.toggle('inventory');
    }
  }

  // ------------------------------------------------------------------ drawing
  // Layers: [world A: biome back/seabed/near + far & mid fish, offscreen when the water shader runs]
  //   -> water post-process -> boat -> darkness pass -> boat lights
  //   -> [world B: near fish, fg particles, biome front, bait fx, line & hook, cinematics] -> aquarium window, HUD, UI.
  draw(dt) {
    const ctx = this.screen.ctx;
    const W = this.screen.W, H = this.screen.H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.tutorial.intro?.opaque) { this.tutorial.drawUi(ctx); this.drawCursor(ctx); return; } // [phase3:intro] the opening covers the frame

    const ocean = this.ocean;
    const view = this.state.view;
    const cam = this.camera;
    if (view === 'ocean') { ctx.fillStyle = '#0b1622'; ctx.fillRect(0, 0, W, H); }
    const liveOcean = view === 'ocean' && !ocean.travelState && ocean.reveal >= 1;
    const shader = liveOcean && !this.lowPower && this.water?.available;
    let wctx = ctx;
    if (shader) {
      const Lw = this.worldLayer;
      if (Lw.w !== W || Lw.h !== H) resizeLayer(Lw, W, H);
      Lw.ctx.setTransform(1, 0, 0, 1, 0, 0);
      Lw.ctx.globalAlpha = 1;
      Lw.ctx.globalCompositeOperation = 'source-over';
      Lw.ctx.clearRect(0, 0, W, H);
      wctx = Lw.ctx;
    }
    cam.apply(wctx);
    let L = { dark: 0, tint: '#000000', lights: [] };
    const env = ocean.env;
    if (view === 'aquarium') {
      this.aquarium.drawFull(wctx, dt);
    } else if (ocean.travelState) {
      ocean.drawTravel(wctx);
    } else {
      env.view = cam.view();
      const sorted = this.school.sorted();
      this.sortedCache = sorted;
      if (ocean.reveal > 0) {
        ocean.biome.drawBack(wctx, env);
        L = ocean.lighting();
        try { this.build?.addLights?.(L); } catch (e) { if (!this.buildLightErr) { this.buildLightErr = true; console.error(e); } }
        wctx.globalAlpha = 1;
        this.floaters?.draw(wctx, 'far'); // [phase3:world]
        this.drawFishRange(wctx, sorted, 0.66, 2, L);
        ocean.biome.drawSeabed(wctx, env);
        this.floaters?.draw(wctx, 'mid'); // [phase3:world]
        this.drawBuildings(wctx, env, 'far');
        this.drawFishRange(wctx, sorted, 0.33, 0.66, L);
        ocean.biome.drawNear?.(wctx, env);
        this.floaters?.draw(wctx, 'near'); // [phase3:world]
        this.drawBuildings(wctx, env, 0);
        this.particles.draw(wctx, 'bg', this.time);
      } else {
        this.drawFishRange(wctx, sorted, 0.33, 2, L);
      }
    }
    cam.reset(wctx);
    if (shader) {
      const out = this.water.render(this.worldLayer.canvas, cam, ocean.biome.waterLook?.(env) || {});
      ctx.drawImage(out || this.worldLayer.canvas, 0, 0);
    }
    // the boat rides the processed waterline; then the darkness pass and the boat's own lights
    if (liveOcean) {
      cam.apply(ctx);
      this.net?.draw(ctx, 'boats'); // [phase3:online] other players' boats (world space)
      this.boat.draw(ctx, env);
      cam.reset(ctx);
      if (L.dark > 0.02) L.lights.push(...this.boat.lights());
    }
    if (view === 'ocean' && !ocean.travelState && ocean.reveal > 0) ocean.applyLighting(ctx, L);
    if (liveOcean) {
      cam.apply(ctx);
      this.boat.drawLights(ctx, L.dark);
      cam.reset(ctx);
      this.net?.draw(ctx, 'tags'); // [phase3:online] name tags, emotes, catch pop-ups (screen space call)
    }

    if (view === 'ocean') this.baitFx.drawUnderIcons(ctx);

    cam.apply(ctx);
    if (view === 'ocean' && !ocean.travelState) {
      this.drawFishRange(ctx, this.sortedCache || [], -1, 0.33, L);
      this.particles.draw(ctx, 'fg', this.time);
      if (ocean.reveal > 0) ocean.biome.drawFront(ctx, env);
      this.baitFx.drawWorld(ctx);
      this.fishing.drawWorld(ctx);
      this.fishing.drawCinematic?.(ctx);
    } else {
      this.particles.draw(ctx, 'fg', this.time);
    }
    cam.reset(ctx);

    this.tutorial.drawWorld?.(ctx);
    this.aquarium.drawWindow?.(ctx, dt);
    this.hud.draw(ctx); // [phase4:shell] hotbar, gear pod, location chip
    this.fishing.drawHud(ctx);
    try { this.build?.drawUi?.(ctx); } catch (e) { if (!this.buildUiErr) { this.buildUiErr = true; console.error(e); } }
    this.ui.drawHud(ctx, dt);
    cam.drawBars(ctx);
    this.fishing.drawCinematicHud?.(ctx);
    ocean.drawTitleCard(ctx, dt);
    this.ui.drawPanels(ctx, dt);
    this.tutorial.drawUi?.(ctx);
    this.particles.draw(ctx, 'ui', this.time);
    this.ui.drawToasts(ctx);
    this.hud.drawTooltip(ctx, this.input);
    this.ui.drawTip(ctx);
    cam.drawFlash(ctx);
    if (this.paused) drawText(ctx, 'PAUSED (P)', W / 2, 8, { align: 'center', color: '#ffffff', shadow: '#0a3e74' });
    if (this.state.settings.showFps) drawText(ctx, `${Math.round(this.fps)} fps  ${this.school.fishes.length} fish  ${this.particles.list.length} p  water:${this.water?.active ? this.water.kind : '2d'}`, 4, H - 36, { font: 'small', color: '#ffffff', outline: '#000' });
    this.drawCursor(ctx);
  }

  drawBuildings(ctx, env, band) {
    try { this.build?.drawWorld?.(ctx, env, band); } catch (e) { if (!this.buildDrawErr) { this.buildDrawErr = true; console.error(e); } }
  }

  bonus(key) {
    try { return Number(this.build?.bonus?.(key)) || 0; } catch { return 0; }
  }

  // aquarium coin production multiplier from buildings
  get coinMulBonus() { return 1 + this.bonus('coinMul'); }

  drawFishRange(ctx, list, z0, z1, L) {
    const ocean = this.ocean;
    const fogColor = ocean.biome.fogColor || '#2a7aa0';
    for (const f of list) {
      if (f.z < z0 || f.z >= z1) continue;
      let wash = null;
      const fog = clamp(f.z * (ocean.biome.fogAmount ?? 0.75), 0, 0.85);
      const lit = ocean.lightAt(f.x, f.y, L);
      if (z0 < 0 && L.dark > 0.02) wash = { color: L.tint || '#0a1030', alpha: clamp01((1 - lit) * 0.9) };
      else if (fog > 0.03) wash = { color: fogColor, alpha: fog };
      f.draw(ctx, wash, this.time);
      this.drawFishExtras(ctx, f);
    }
  }

  drawFishExtras(ctx, f) {
    if (f.emote && f.z < 0.5) {
      const top = f.anchors?.top || [f.x, f.y - 14];
      const k = f.emote.t / f.emote.max;
      const y = Math.round(top[1] - 10 - Math.min(1, f.emote.t * 6) * 4);
      const icon = { '!': null, '!!': null, '?': null, '...': null }[f.emote.icon] === null ? null : getUiIcon(f.emote.icon);
      ctx.globalAlpha = Math.min(1, (1 - k) * 4);
      if (icon) ctx.drawImage(icon, Math.round(top[0] - icon.width / 2), y - icon.height);
      else drawText(ctx, f.emote.icon, top[0], y - 8, { align: 'center', color: f.emote.icon === '!' || f.emote.icon === '!!' ? '#ffe27a' : '#ffffff', outline: '#14202c', scale: f.emote.icon.startsWith('!') ? 2 : 1 });
      ctx.globalAlpha = 1;
    }
    if (f.rec.variant?.shiny && rng.chance(0.06)) this.particles.sparkle(f.x + rng.float(-10, 10) * f.scale, f.y + rng.float(-6, 6) * f.scale, '#fff6b0');
    if (this.stats.sonar && (f.sp.rarity === 'epic' || f.sp.rarity === 'legendary' || f.sp.rarity === 'rare') && rng.chance(0.02)) this.particles.sparkle(f.x, f.y - 8, '#9affff');
  }

  drawCursor(ctx) {
    const inp = this.input;
    if (!inp.inside) return;
    const x = Math.round(inp.x), y = Math.round(inp.y);
    const fishingCursor = this.world.cursor.inWorld && !this.paused && this.state.view === 'ocean' && (this.ocean.reveal >= 1 || this.tutorial.allowFishing);
    if (fishingCursor && !this.fishing.fighting) return; // the hook itself is the cursor
    let name = 'cursor';
    if (this.boat.dragging) name = 'cursor_grab';
    else if (this.layer === 'boat' || this.layer === 'hud') name = 'cursor_hand';
    if (this.fishing.fighting) name = 'cursor_reel';
    const spr = getUiIcon(name) || getUiIcon('arrow_u');
    const hs = CURSOR_HOTSPOT[name] || [0, 0];
    ctx.drawImage(spr, x - hs[0], y - hs[1]);
  }

  // ------------------------------------------------------------------ loop
  start() {
    let last = performance.now();
    let acc = 0;
    const frame = (now) => {
      requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      const target = this.lowPower ? 1 / 24 : 0;
      if (target && dt < target - 0.002) return;
      last = now;
      dt = Math.max(0, Math.min(dt, 1 / 20));
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
      try {
        this.update(dt);
        this.draw(dt);
      } catch (e) {
        console.error(e);
        if (!this.crashed) { this.crashed = true; this.toast('Oops: ' + e.message, 'skull'); }
      }
      this.input.endFrame();
      void acc;
    };
    requestAnimationFrame(frame);
  }
}
