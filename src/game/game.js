// FISHTOP game orchestrator: owns every system, routes input top-down, draws the layered scene.

import { clamp, clamp01, lerp, dist, damp, rectContains } from '../core/math.js';
import { rng } from '../core/rng.js';
import { RARITY } from '../core/color.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { Screen } from './screen.js';
import { Camera } from './camera.js';
import { loadState, saveState, resetState } from './state.js';
import { computeStats, SKILL_BY_ID, skillStatus } from './skills.js';
import { BAITS, RELEASE_VALUE, CATCH_BONUS } from './shopdata.js';
import { Particles } from '../gfx/particles.js';
import { drawText } from '../gfx/font.js';
import { registerUiIcons, getUiIcon, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { getMiniIcon } from '../desktop/icons.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';
import { Desktop, fileBait } from '../desktop/desktop.js';
import { School } from '../fish/school.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { rollIndividual, valueMultiplier } from '../fish/traits.js';
import { Fishing } from '../fishing/fishing.js';
import { BaitEffects } from '../fishing/baiteffects.js';
import { UI } from '../ui/ui.js';
import { registerPanels } from '../ui/registry.js';
import { Aquarium } from '../aquarium/aquarium.js';
import { Tutorial } from './tutorial.js';
import { Wallpaper } from '../desktop/wallpaper.js';
import { Dock } from '../ui/dock.js';
import { host } from '../platform/host.js';

export class Game {
  constructor(canvas, params) {
    this.params = params;
    this.canvas = canvas;
    this.mode = host.mode || params.get('mode') || 'window';
    this.overlay = this.mode === 'overlay' || this.mode === 'wallpaper';
    this.screen = new Screen(canvas, { scale: Number(params.get('scale')) || 0 });
    this.input = new Input(canvas, this.screen.toLogical);
    this.state = params.has('fresh') ? resetState() : loadState();
    this.recomputeStats();
    this.audio = audio;
    this.particles = new Particles(900);
    this.camera = new Camera(this);
    this.clock = new Clock(this);
    this.events = {};
    this.time = 0;
    this.timeScale = 1; this.timeScaleTarget = 1;
    this.paused = false;
    this.overlayFishing = false;
    this.interactive = null;
    this.muted = false;
    this.mini = this.mode === 'mini';
    this.lowPower = this.mini || !!this.state.settings.lowPower;
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
    this.desktop = new Desktop(this);
    this.world.desktop = this.desktop;
    this.school = new School(this.world);
    this.fishing = new Fishing(this);
    this.baitFx = new BaitEffects(this);
    this.aquarium = new Aquarium(this);
    this.wallpaper = new Wallpaper(this);
    this.ui = new UI(this);
    this.dock = new Dock(this);
    registerUiIcons();
    registerPanels(this.ui);
    this.tutorial = new Tutorial(this);
    this.ocean.setBiome(this.state.biome);
    this.screen.onResize(() => this.onResize());
    this.onResize();
    this.bindHost();
    this.bindGlobal();
    this.saveT = 10;
    this.offline();
    // the opening plays on the simulated desktop; the real-desktop overlay starts straight in the ocean
    if (!this.state.tutorialDone && !params.has('skipintro') && !this.overlay) this.tutorial.start();
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

  recomputeStats() {
    this.stats = computeStats(this.state.skills);
  }

  onResize() {
    const { W, H } = this.screen;
    this.world.W = W; this.world.H = H;
    this.ocean.onResize();
    this.desktop.onResize();
    this.aquarium.onResize?.();
    this.wallpaper.onResize?.();
  }

  bindHost() {
    host.onShortcut?.((id, ev) => {
      if (id === 'toggle-fishing') {
        this.overlayFishing = !this.overlayFishing;
        this.toast(this.overlayFishing ? 'Fishing ON - your mouse is a hook.' : 'Fishing OFF - clicks go to your desktop.', 'hook');
      }
      if (id === 'pause') this.command('pause');
      if (id === 'mini') this.command('mini');
      if (id === 'cycle-overlay' && ev?.nextMode) host.setMode(ev.nextMode);
    });
    host.onCursor?.((x, y) => {
      const [lx, ly] = this.screen.toLogical(x, y);
      this.input.setExternalCursor(lx, ly);
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
    if (!this.spendCoins(sk.cost)) { this.toast('Not enough coins.', 'coin'); return false; }
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
  currentBait() {
    const e = this.state.equipped;
    if (!e) return null;
    if (e.kind === 'icon') {
      const ic = this.desktop.iconById(e.id);
      if (!ic || !this.state.baitBox.includes(e.id)) return null;
      return { kind: 'icon', type: ic.type, id: ic.id, mini: getMiniIcon(ic.icon), label: ic.label };
    }
    if (e.kind === 'file') {
      const f = this.state.files.find((x) => x.id === e.id);
      return f ? { kind: 'icon', type: f.type, id: f.id, mini: getMiniIcon(f.icon), label: f.name } : null;
    }
    if (e.kind === 'special') {
      if ((this.state.baits[e.id] || 0) <= 0) return null;
      return { kind: 'special', type: e.id, id: e.id, label: BAITS[e.id]?.name };
    }
    return null;
  }

  equip(kind, id) {
    this.state.equipped = { kind, id };
    audio.play('ui_click');
    this.baitFx.onEquip(this.currentBait());
  }

  consumeBait(type) {
    const b = this.state.baits;
    if (!b[type]) return;
    b[type]--;
    if (b[type] <= 0) {
      delete b[type];
      if (this.state.equipped?.kind === 'special' && this.state.equipped.id === type) {
        this.state.equipped = this.state.baitBox.length ? { kind: 'icon', id: this.state.baitBox[0] } : null;
        this.toast(`Out of ${BAITS[type]?.name || type}.`, 'bait');
      }
      this.baitFx.onEquip(this.currentBait());
    }
  }

  buyBait(id) {
    const it = BAITS[id];
    if (!it || !this.stats.unlockBait.has(id)) return false;
    if (!this.spendCoins(it.price)) { this.toast('Not enough coins.', 'coin'); return false; }
    this.state.baits[id] = (this.state.baits[id] || 0) + it.qty;
    audio.play('ui_buy');
    this.emit('buy', id);
    return true;
  }

  addFileBait(name, isDir, forceType) {
    const fb = fileBait(name, isDir);
    if (forceType) fb.type = forceType;
    if (!this.state.files.some((f) => f.id === fb.id)) {
      this.state.files.push(fb);
      if (this.state.files.length > 24) this.state.files.shift();
    }
    this.state.equipped = { kind: 'file', id: fb.id };
    audio.play('icon_box');
    this.toast(`"${name}" became virtual bait (${fb.type}). Your file is untouched.`, 'bait');
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
    // return stolen icons
    if (fish.carry) { this.desktop.returnIcon(fish.carry); fish.carry = null; }
    const bonus = Math.round((CATCH_BONUS[sp.rarity] || 2) * valueMultiplier(rec));
    this.addCoins(bonus, fish.x, fish.y);
    const bait = this.currentBait();
    if (bait?.kind === 'special') this.consumeBait(bait.type);
    audio.play(sp.rarity === 'legendary' ? 'catch_legendary' : sp.rarity === 'epic' ? 'catch_epic' : sp.rarity === 'rare' ? 'catch_rare' : 'catch');
    if (sp.sound) setTimeout(() => audio.play(sp.sound, { pitch: 1 / Math.max(0.6, fish.scale) }), 250);
    this.camera.flash('#ffffff', sp.rarity === 'legendary' ? 0.9 : 0.5);
    this.emit('caught', { rec, sp, isNew, record });
    const data = { rec, sp, isNew, record, bonus, emotion: fish.emotion };
    if (!this.tutorial.onCaught(fish, data)) this.ui.open('reveal', data);
    this.save();
  }

  onFishEscaped(fish, reason) {
    this.emit('escaped', { fish, reason });
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
      case 'journal': case 'skills': case 'shop': case 'map': case 'bait': case 'settings':
        if (ui.panels[id]) ui.toggle(id); else this.toast('Coming soon!', 'info');
        break;
      case 'tank':
        this.setView(this.state.view === 'aquarium' ? 'ocean' : 'aquarium');
        break;
      case 'tankwindow':
        this.aquarium.toggleWindow();
        break;
      case 'pause':
        this.paused = !this.paused;
        this.toast(this.paused ? 'Fishing paused. Your desktop is all yours.' : 'Fishing resumed!', this.paused ? 'pause' : 'play');
        if (this.paused && this.fishing.busy) this.fishing.releaseFish(true);
        break;
      case 'mini':
        this.setMini(!this.mini);
        break;
      case 'restore':
        this.desktop.restoreAll();
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
    if (v === 'aquarium') { this.fishing.releaseFish(false); this.aquarium.closeWindow?.(); }
    audio.play('travel_whoosh', { vol: 0.5 });
    audio.setMusic(this.musicFor());
    this.camera.flash('#bfefff', 0.35);
  }

  musicFor() {
    if (this.mini) return null;
    if (this.state.view === 'aquarium') return 'aquarium';
    if (this.ocean.reveal < 1) return 'desktop';
    return this.ocean.biome?.music || 'shallows';
  }

  musicTrackName() {
    const t = this.musicFor();
    return { desktop: 'Desktop Lullaby', shallows: 'Sunny Shallows Groove', junkyard: 'Junkyard Glitch-Hop', abyss: 'Midnight Abyss Drone', aquarium: 'Aquarium Dreams' }[t] || 'Silence';
  }

  setMini(on) {
    this.mini = on;
    this.lowPower = on || !!this.state.settings.lowPower;
    if (on) { this.fishing.releaseFish(false); this.ui.stack = []; }
    host.setMode?.(on ? 'mini' : 'window');
    audio.setMusic(this.musicFor());
    this.toast(on ? 'Mini mode: a quiet little aquarium while you work. Press M to expand.' : 'Welcome back to the ocean!', on ? 'minimize' : 'expand');
  }

  biomeName() { return this.ocean.biome?.name || 'Ocean'; }

  travel(id) {
    if (!this.state.unlockedBiomes.includes(id) || this.ocean.travelState) return false;
    if (this.fishing.busy) this.fishing.releaseFish(false);
    this.ui.stack = [];
    this.setView('ocean');
    this.ocean.travel(id, () => {
      this.state.biome = id;
      this.world.biome = id;
      this.save();
    });
    return true;
  }

  handleIconOpen(ic) {
    return false;
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
    this.camera.update(dtReal);
    this.timeScale = damp(this.timeScale, this.timeScaleTarget * this.camera.timeScale(), 10, dtReal);
    const dt = dtReal * this.timeScale;
    this.time += dt;
    this.state.stats.playTime += dtReal;

    // world env sync
    const w = this.world, cur = w.cursor;
    cur.x = inp.x; cur.y = inp.y; cur.vx = inp.vx; cur.vy = inp.vy; cur.speed = inp.speed;
    w.night = this.clock.isNight(); w.dusk = this.clock.isDusk(); w.hour = this.clock.hour();
    w.weather = this.ocean.weather; w.biome = this.ocean.biome.id;
    w.rarityBoost = this.stats.rarityBoost * this.baitFx.rarityMul();
    w.calmMul = this.stats.calm;
    w.lowPower = this.lowPower;
    w.populationMul = this.baitFx.populationMul();
    w.rollMods = { mutationChance: this.stats.mutationChance, shinyChance: this.stats.shinyChance };
    w.icons = this.desktop.iconRects();
    w.windows = this.desktop.windowRects().concat(this.aquarium.windowRect ? [this.aquarium.windowRect()] : []).filter(Boolean);
    w.isTank = false;
    w.surfaceY = this.ocean.reveal < 1 ? null : this.ocean.surfaceY();
    this.particles.surfaceY = this.state.view === 'ocean' ? w.surfaceY : null;
    w.glowLevel = this.ocean.biome.lighting(this.ocean.env).dark;

    this.ui.update(dtReal);
    this.ocean.update(dt);
    this.baitFx.update(dt);

    // ---- input routing (top-most first)
    const fighting = this.fishing.fighting;
    let layer = null;
    if (this.tutorial.capturesInput?.()) layer = 'tutorial';
    else if (this.ui.hit(inp.x, inp.y) && !fighting) layer = 'ui';
    else if (!fighting) layer = this.aquarium.hit?.(inp.x, inp.y) ? 'tank' : this.overlay ? (this.desktop.overBox(inp.x, inp.y) ? 'box' : null) : this.desktop.hit(inp.x, inp.y);
    if (this.desktop.drag && !fighting) layer = 'drag';
    if (this.mini) layer = this.aquarium.hit?.(inp.x, inp.y) ? 'tank' : 'mini';
    this.layer = layer;
    // Desktop overlay (Electron): stay click-through unless fishing or the pointer is on game UI.
    if (host.clickThrough) {
      const want = this.mode === 'overlay' && ((this.overlayFishing && !this.paused) || this.fishing.busy || layer === 'ui' || this.ui.blocking || !!this.desktop.drag);
      if (want !== this.interactive) { this.interactive = want; host.setInteractive(want); }
    }
    cur.inWorld = (layer === null || fighting) && this.state.view === 'ocean' && inp.inside;

    if (!this.mini && layer !== 'tutorial') {
      const deskLayer = layer === 'ui' || layer === 'tank' ? 'ui' : layer === 'drag' ? null : layer;
      this.desktop.update(dt, inp, deskLayer === 'ui' ? 'ui-blocked' : deskLayer);
    }
    this.aquarium.update(dt, layer === 'tank' ? inp : null);

    // dropped files become bait
    if (inp.files && !this.mini) {
      for (const f of inp.files.slice(0, 3)) this.addFileBait(f.name, f.isDir);
    }

    const worldInput = (layer === null || fighting) && this.state.view === 'ocean' && !this.mini && (!host.clickThrough || this.overlayFishing || fighting) && (this.ocean.reveal >= 1 || this.tutorial.allowFishing) && !this.ocean.travelState;
    // double-clicking a posing Shortcut Fish unmasks it
    if (worldInput && inp.dblclick && !fighting) {
      for (const f of this.school.fishes) if (f.posing && dist(f.x, f.y, inp.x, inp.y) < 18) { f.unmask(); inp.consume(); }
    }
    if (this.state.view === 'ocean' && !this.mini) {
      this.school.update(dt);
      this.fishing.update(dt, worldInput);
      // secrets
      if (worldInput && inp.pressed && !this.fishing.busy) {
        const sid = this.ocean.biome.secretAt?.(inp.x, inp.y);
        if (sid) this.ocean.biome.onSecret?.(sid, this);
      }
    }
    this.tutorial.update(dt);
    this.particles.update(dt);
    this.handleKeys();

    // autosave
    this.saveT -= dtReal;
    if (this.saveT <= 0) { this.saveT = 15; this.save(); }
  }

  handleKeys() {
    const inp = this.input;
    if (this.input.lastKeyEvent && this.desktop.windows.length && this.desktop.windows[this.desktop.windows.length - 1].app === 'terminal') return;
    const map = { j: 'journal', k: 'skills', s: 'shop', t: 'map', b: 'bait', p: 'pause', m: 'mini', a: 'tank' };
    for (const [k, cmd] of Object.entries(map)) {
      if (inp.keyPressed(k)) {
        if (this.tutorial.active && cmd !== 'pause') continue;
        this.command(cmd);
      }
    }
    if (inp.keyPressed('F3')) this.state.settings.showFps = !this.state.settings.showFps;
  }

  // ------------------------------------------------------------------ drawing
  draw(dt) {
    const ctx = this.screen.ctx;
    const W = this.screen.W, H = this.screen.H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.mini) { this.drawMini(ctx, dt); return; }
    const realDesktop = this.overlay; // Electron overlay / wallpaper: the real desktop replaces the simulated one
    if (realDesktop) ctx.clearRect(0, 0, W, H);

    const ocean = this.ocean;
    const view = this.state.view;
    // adjustable transparency: overlay shows the real desktop through the water; on web the classic wallpaper
    const opacity = this.mode === 'overlay' ? this.state.settings.overlayOpacity ?? 0.25 : this.state.settings.oceanOpacity ?? 1;
    if (!realDesktop && opacity < 1 && view === 'ocean') this.wallpaper.draw(ctx, dt);
    this.camera.apply(ctx);
    let L = { dark: 0, tint: '#000000', lights: [] };
    if (view === 'aquarium') {
      this.aquarium.drawFull(ctx, dt);
    } else if (ocean.travelState) {
      ocean.drawTravel(ctx);
    } else {
      const env = ocean.env;
      const sorted = this.school.sorted();
      this.sortedCache = sorted;
      if (ocean.reveal < 1) this.wallpaper.draw(ctx, dt);
      if (ocean.reveal > 0) {
        if (ocean.reveal < 1) { ctx.save(); this.wallpaper.clipOcean(ctx); }
        ctx.globalAlpha = opacity;
        ocean.biome.drawBack(ctx, env);
        L = ocean.lighting();
        ctx.globalAlpha = 1;
        this.drawFishRange(ctx, sorted, 0.66, 2, L);
        ctx.globalAlpha = opacity;
        ocean.biome.drawSeabed(ctx, env);
        ctx.globalAlpha = 1;
        this.drawFishRange(ctx, sorted, 0.33, 0.66, L);
        this.particles.draw(ctx, 'bg', this.time);
        if (!realDesktop) ocean.applyLighting(ctx, L);
        if (ocean.reveal < 1) { ctx.restore(); this.wallpaper.drawWaterline(ctx); }
      } else {
        this.drawFishRange(ctx, sorted, 0.33, 2, L);
      }
    }
    this.camera.reset(ctx);

    // desktop icons sit above the ocean (kept readable)
    if ((view === 'ocean' || view === 'aquarium') && !realDesktop) {
      this.baitFx.drawUnderIcons(ctx);
      this.desktop.drawIcons(ctx);
      if (this.tutorial.boxVisible()) this.desktop.drawBox(ctx, this.tutorial.boxOffset());
    }

    this.camera.apply(ctx);
    if (view === 'ocean' && !ocean.travelState) {
      this.drawFishRange(ctx, this.sortedCache || [], -1, 0.33, L);
      this.particles.draw(ctx, 'fg', this.time);
      if (ocean.reveal > 0) ocean.biome.drawFront(ctx, ocean.env);
      this.baitFx.drawWorld(ctx);
      this.fishing.drawWorld(ctx);
    } else {
      this.particles.draw(ctx, 'fg', this.time);
    }
    this.camera.reset(ctx);

    this.tutorial.drawWorld?.(ctx);
    if (this.mode === 'wallpaper') return;
    if (realDesktop) this.desktop.drawBox(ctx);
    this.dock.draw(ctx, dt);
    this.aquarium.drawWindow?.(ctx, dt);
    if (!realDesktop) {
      this.desktop.drawWindows(ctx);
      this.desktop.drawDragged(ctx);
      this.desktop.drawTaskbar(ctx);
    }
    this.fishing.drawHud(ctx);
    this.ui.drawHud(ctx, dt);
    ocean.drawTitleCard(ctx, dt);
    this.ui.drawPanels(ctx, dt);
    this.tutorial.drawUi?.(ctx);
    this.particles.draw(ctx, 'ui', this.time);
    this.ui.drawToasts(ctx);
    this.desktop.drawTooltip(ctx, this.input);
    this.ui.drawTip(ctx);
    this.camera.drawFlash(ctx);
    if (this.paused) drawText(ctx, 'FISHING PAUSED (P)', W / 2, 6, { align: 'center', color: '#ffe8a8', outline: '#1a0e06' });
    if (this.state.settings.showFps) drawText(ctx, `${Math.round(this.fps)} fps  ${this.school.fishes.length} fish  ${this.particles.list.length} p`, 4, H - 36, { font: 'small', color: '#ffffff', outline: '#000' });
    this.drawCursor(ctx);
  }

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
    if (f.carry) {
      const m = f.anchors?.mouth || [f.x, f.y];
      ctx.drawImage(getMiniIcon(f.carry.icon), Math.round(m[0] - 7 + f.facing * 4), Math.round(m[1] - 4));
    }
    if (f.posing) {
      drawText(ctx, 'fish.exe', f.x, f.y + 20, { align: 'center', color: '#ffffff', outline: '#0b1a2a' });
    }
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

  drawMini(ctx, dt) {
    this.wallpaper.draw(ctx, dt, true);
    this.desktop.drawIcons(ctx);
    this.aquarium.drawMini?.(ctx, dt);
    this.desktop.drawTaskbar(ctx);
    this.ui.drawToasts(ctx);
    this.drawCursor(ctx);
  }

  drawCursor(ctx) {
    const inp = this.input;
    if (!inp.inside) return;
    const x = Math.round(inp.x), y = Math.round(inp.y);
    const fishingCursor = this.world.cursor.inWorld && !this.paused && this.state.view === 'ocean' && !this.mini && (this.ocean.reveal >= 1 || this.tutorial.allowFishing);
    if (fishingCursor && !this.fishing.fighting) return; // the hook itself is the cursor
    let name = 'cursor';
    if (this.desktop.drag) name = 'cursor_grab';
    else if (this.layer === 'icon' || this.layer === 'box' || this.ui.dockHover >= 0) name = 'cursor_hand';
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
      dt = Math.min(dt, 1 / 20);
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
