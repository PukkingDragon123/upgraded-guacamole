// FISHTOP browser overlay: the game's real fish (fish/fish.js) swim over a web page through a world
// adapter, and the game's fishing controller (fishing/fishing.js + minigames) runs behind an opt-in
// "fishing mode". The canvas lives in a closed shadow root, ignores the mouse (pointer-events:none)
// unless fishing mode is on, reads page GEOMETRY only (scan.js) and never touches the network.

import { clamp, clamp01, lerp, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { RARITY, rgba } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { drawText, measureText } from '../gfx/font.js';
import { registerUiIcons, getUiIcon, CURSOR_HOTSPOT, UI_ICON_NAMES } from '../gfx/uiicons.js';
import { drawFishRig, setRigBudget } from '../gfx/fishrig.js';
import { Fish } from '../fish/fish.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { rollIndividual } from '../fish/traits.js';
import { Fishing } from '../fishing/fishing.js';
import { computeStats } from '../game/skills.js';
import { OverlayInput } from './input.js';
import { PageScanner } from './scan.js';
import { CRUMB, drawCatchCard, cardRect, renderThumb, CARD_LIFE } from './card.js';
import { ext, DEFAULT_SETTINGS, MAX_FISH } from './ext.js';

const TARGET_W = 960;
const FAR_Z = 0.55;           // fish at or beyond this depth swim BEHIND images and text
const GHOST_TEXT = 0.24;      // how much of a fish shows through the text it hides behind
const NO_AVOID = new Set(['interest', 'sniff', 'script']);
const ICON_SET = new Set(UI_ICON_NAMES);
const HOST_STYLE = 'all:initial!important;display:block!important;position:fixed!important;left:0!important;top:0!important;' +
  'width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;' +
  'z-index:2147483647!important;overflow:hidden!important;contain:strict!important;background:transparent!important;';
const SHADOW_CSS = 'canvas{display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;}' +
  '@media print{:host{display:none!important}}';

// Species that can visit a web page: no secret / special-bait-only fish.
const POOL = SPECIES.filter((s) => !s.spawn?.hidden && !s.spawn?.requires && !s.spawn?.never);

class MiniCamera {
  constructor(reduced) { this.reduced = reduced; this.trauma = 0; this.ox = 0; this.oy = 0; this.slowT = 0; this.slowScale = 1; }
  shake(n) { this.trauma = Math.min(6, this.trauma + n * (this.reduced ? 0.2 : 0.6)); }
  punch() {}
  flash() {}
  slowmo(scale, time) { this.slowScale = scale; this.slowT = time; }
  timeScale() { return this.slowT > 0 ? this.slowScale : 1; }
  update(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 18);
    this.ox = Math.round((Math.random() * 2 - 1) * this.trauma * 0.6);
    this.oy = Math.round((Math.random() * 2 - 1) * this.trauma * 0.6);
    this.slowT = Math.max(0, this.slowT - dt);
  }
}

export class Overlay {
  constructor() {
    this.destroyed = false;
    this.standalone = !ext.alive;
    this.settings = { ...DEFAULT_SETTINGS };
    this.ready = false;
    this.fishingMode = false;
    this.manual = false;
    this.time = 0;
    this.timeScale = 1;
    this.fishes = [];
    this.arrivals = [];
    this.card = null;
    this.waiting = 0;
    this.caughtSpecies = new Set();
    this.subs = [];
    this.errors = 0;
    this.scrollDX = 0; this.scrollDY = 0; this.scrollInner = 0; this.scrollSpeed = 0;
    this.lastScroll = { x: window.scrollX, y: window.scrollY };
    this.innerScroll = new WeakMap();
    this.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.W = TARGET_W; this.H = 540; this.k = 1;
    this.drewSomething = true;

    // ---- DOM: one fixed host element with a closed shadow root holding the canvas
    this.host = document.createElement('fishtop-overlay');
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    this.canvas = document.createElement('canvas');
    this.shadow.append(style, this.canvas);
    this.applyHostStyle();
    document.documentElement.appendChild(this.host);
    this.ctx = ctxOf(this.canvas);

    // ---- systems
    registerUiIcons();
    setRigBudget(3);
    this.stats = computeStats({ hook1: true });
    this.input = new OverlayInput(this.canvas, (x, y) => this.toLogical(x, y));
    this.particles = new Particles(260);
    this.particles.surfaceY = null;
    this.camera = new MiniCamera(this.reduced);
    this.scanner = new PageScanner(this.host);
    this.scratchC = null;
    const self = this;
    this.sound = {
      play(name, opts) { if (self.settings.sound && audio.isUnlocked()) audio.play(name, opts); },
      loop(name) { return self.settings.sound ? audio.loop(name) : { set() {}, stop() {} }; },
    };
    const hour = new Date().getHours();
    this.world = {
      W: this.W, H: this.H, surfaceY: null,
      floorAt: () => this.H - 16,
      cursor: { x: -100, y: -100, vx: 0, vy: 0, speed: 0, inWorld: false },
      hook: { x: 0, y: 0, active: false, inWater: false, bait: null, radiusMul: 1 },
      fishes: this.fishes, icons: [], windows: [], particles: this.particles, audio: this.sound,
      desktop: null, biome: 'browser', night: false, dusk: false, weather: 'clear', hour,
      secrets: {}, rarityBoost: 1, calmMul: this.stats.calm, isTank: false, glowLevel: 0,
      requestNibble: (f) => this.fishingMode && this.fishing.requestNibble(f),
      rollMods: { mutationChance: this.stats.mutationChance, shinyChance: this.stats.shinyChance },
    };
    this.updateClock();
    this.bait = { kind: 'icon', type: 'bread', id: 'crumb', mini: CRUMB, label: 'Page Crumb' };
    this.game = {
      world: this.world, input: this.input, stats: this.stats, audio: this.sound, particles: this.particles,
      camera: this.camera, ui: { blocking: false }, state: { stats: { casts: 0, snapped: 0, escaped: 0, caught: 0 } },
      paused: false, fishingDisabled: false, tutorialActive: false, timeScaleTarget: 1,
      currentBait: () => this.bait,
      consumeBait: () => {},            // page crumbs never run out
      onHooked: () => {},
      onFishEscaped: () => {},
      onFishCaught: (f) => this.onFishCaught(f),
      toast: (text) => this.fishing.message(text, '#ffffff', 2.2),
    };
    this.fishing = new Fishing(this.game);

    // ---- events (all passive except Esc while fishing, which we consume)
    const on = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); this.subs.push(() => t.removeEventListener(type, fn, opts)); };
    on(window, 'resize', () => { this.resize(); this.scanSoon(0.15); }, { passive: true });
    on(document, 'scroll', (e) => this.onScroll(e), { capture: true, passive: true });
    on(document, 'visibilitychange', () => this.onVisibility(), { passive: true });
    on(window, 'keydown', (e) => {
      if (this.fishingMode && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.setFishing(false); }
    }, { capture: true });
    on(window, 'pointerdown', () => { if (this.settings.sound) audio.unlock(); }, { capture: true, passive: true });
    this.subs.push(ext.onMessage((msg) => this.onMessage(msg)));
    this.subs.push(ext.onStorage((ch) => this.onStorage(ch)));

    this.resize();
    this.spawnT = 0.6;
    this.scanT = 0;
    this.statusT = 0;
    this.aliveT = 4;
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
    this.init();
  }

  async init() {
    const st = await ext.getLocal(['settings', 'catches']);
    if (this.destroyed) return;
    this.applySettings(st.settings);
    this.loadCatches(st.catches);
    const hello = await ext.send({ type: 'ft:hello', count: this.fishes.length, hidden: document.hidden, fishing: this.fishingMode });
    if (this.destroyed) return;
    if (hello && hello.ok === false) { this.destroy(); return; }
    if (hello?.manual) this.manual = true;
    this.ready = true;
  }

  applySettings(s) {
    const prevSound = this.settings.sound;
    this.settings = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
    this.settings.fishCount = clamp(Math.round(Number(this.settings.fishCount) || DEFAULT_SETTINGS.fishCount), 1, MAX_FISH);
    if (this.settings.sound && !prevSound) {
      audio.setMusic(null);
      audio.setAmbience('off');
      audio.setVolumes({ master: 0.55, music: 0, ambience: 0, sfx: 0.8 });
    }
    // too many fish for the new count: the extras swim off
    let extra = this.activeCount() - this.settings.fishCount;
    for (const f of this.fishes) {
      if (extra <= 0) break;
      if (!f.controlled && f.state !== 'leave') { f.setState('leave'); extra--; }
    }
  }

  loadCatches(list) {
    const arr = Array.isArray(list) ? list : [];
    this.caughtSpecies = new Set(arr.map((c) => c.species));
    this.waiting = arr.filter((c) => !c.sent).length;
  }

  onStorage(ch) {
    if (ch.settings) this.applySettings(ch.settings.newValue);
    if (ch.catches) this.loadCatches(ch.catches.newValue);
  }

  onMessage(msg) {
    if (this.destroyed) return null;
    switch (msg.type) {
      case 'ft:ping': return { alive: true, fishing: this.fishingMode, count: this.fishes.length, queued: this.arrivals.length, manual: this.manual };
      case 'ft:manual': this.manual = true; return { ok: true };
      case 'ft:set-fishing': this.setFishing(!!msg.on); return { fishing: this.fishingMode };
      case 'ft:toggle-fishing': this.setFishing(!this.fishingMode); return { fishing: this.fishingMode };
      case 'ft:arrive': return { ok: this.acceptArrival(msg.fish) };
      case 'ft:stop': setTimeout(() => this.destroy(), 0); return { stopped: true };
      default: return null;
    }
  }

  // ------------------------------------------------------------------ host / canvas
  applyHostStyle() {
    const fish = this.fishingMode;
    this.host.setAttribute('style', HOST_STYLE + `pointer-events:${fish ? 'auto' : 'none'}!important;cursor:${fish ? 'none' : 'auto'}!important;`);
  }

  resize() {
    const b = this.host.getBoundingClientRect();
    const cssW = b.width || window.innerWidth, cssH = b.height || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const devW = cssW * dpr, devH = cssH * dpr;
    let scale = Math.max(1, Math.round(devW / TARGET_W));
    while (scale > 1 && devH / scale < 420) scale--;
    while (devW / scale > 1400) scale++;
    const W = Math.max(64, Math.ceil(devW / scale)), H = Math.max(64, Math.ceil(devH / scale));
    if (W !== this.W || H !== this.H) {
      const kx = W / this.W, ky = H / this.H;
      for (const f of this.fishes) { f.x *= kx; f.y *= ky; }
      this.input.rescale(kx, ky);
      this.W = W; this.H = H;
      this.world.W = W; this.world.H = H;
    }
    this.cssW = cssW; this.cssH = cssH;
    this.k = W / cssW;
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.drewSomething = true;
  }

  toLogical(cx, cy) {
    return [cx * this.k, cy * (this.H / (this.cssH || this.H))];
  }

  // ------------------------------------------------------------------ page events
  onScroll(e) {
    const t = e.target;
    if (t === document || t === document.documentElement || t === document.scrollingElement) {
      const x = window.scrollX, y = window.scrollY;
      this.scrollDX += x - this.lastScroll.x;
      this.scrollDY += y - this.lastScroll.y;
      this.lastScroll = { x, y };
    } else if (t && t.nodeType === 1) {
      // an inner scroller: weaker current, geometry refreshed by a rescan
      const prev = this.innerScroll.get(t);
      const now = [t.scrollLeft, t.scrollTop];
      if (prev) this.scrollInner += Math.abs(now[1] - prev[1]) + Math.abs(now[0] - prev[0]);
      this.innerScroll.set(t, now);
    }
    this.scanSoon(0.25);
  }

  onVisibility() {
    if (document.hidden) {
      this.input.release();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (!this.raf && !this.destroyed) {
      this.last = performance.now();
      this.lastScroll = { x: window.scrollX, y: window.scrollY };
      this.scanSoon(0);
      this.raf = requestAnimationFrame(this.frame);
    }
    this.sendStatus(true);
  }

  scanSoon(t) { this.scanT = Math.min(this.scanT, t); }

  sendStatus(force) {
    if (!force && this.statusT > 0) return;
    this.statusT = 1;
    this.beatT = (this.beatT ?? 10) - 1;
    const s = `${this.fishes.length}|${document.hidden}|${this.fishingMode}`;
    if (!force && s === this.lastStatus && this.beatT > 0) return; // heartbeat every ~10 s keeps the registry fresh
    this.beatT = 10;
    this.lastStatus = s;
    ext.send({ type: 'ft:status', count: this.fishes.length, hidden: document.hidden, fishing: this.fishingMode });
  }

  // ------------------------------------------------------------------ fishing mode
  setFishing(on) {
    if (on === this.fishingMode || this.destroyed) return;
    this.fishingMode = on;
    this.applyHostStyle();
    if (on) {
      if (this.settings.sound) audio.unlock();
      this.bannerT = 0;
      this.fishing.message('Fishing mode! Your mouse is a hook.', '#ffe8a8', 2.4);
      this.scanSoon(0);
    } else {
      if (this.fishing.busy) this.fishing.releaseFish(true);
      this.fishing.hook.visible = false;
      this.world.hook.active = false;
      this.input.release();
      this.game.timeScaleTarget = 1;
    }
    this.sendStatus(true);
  }

  // ------------------------------------------------------------------ population
  activeCount() {
    let n = 0;
    for (const f of this.fishes) if (f.state !== 'leave' || f.controlled) n++;
    return n;
  }

  updateClock() {
    const h = new Date().getHours();
    const w = this.world;
    w.hour = h;
    w.night = h >= 20 || h < 6;
    w.dusk = (h >= 18 && h < 20) || (h >= 5 && h < 7);
    w.glowLevel = w.night ? 0.25 : 0;
  }

  weightOf(sp) {
    const w = this.world, spawn = sp.spawn || {};
    let wt = (RARITY[sp.rarity]?.weight ?? 10) * (spawn.weight ?? 1);
    if (sp.biome === 'abyss') wt *= w.night ? 1 : 0.06;
    if (sp.activity === 'night') wt *= w.night ? 2 : 0.2;
    if (sp.activity === 'day') wt *= w.night ? 0.2 : 1.3;
    if (sp.activity === 'dusk') wt *= w.dusk ? 3 : 0.4;
    if (spawn.weather && !String(spawn.weather).includes(w.weather)) wt *= 0.05;
    if (spawn.time && spawn.time !== (w.night ? 'night' : 'day')) wt *= 0.1;
    if (sp.bait?.browser) wt *= 1 + sp.bait.browser * 0.5; // internet natives love web pages
    if (sp.rarity === 'legendary' && this.fishes.some((f) => f.sp === sp)) wt = 0;
    return wt;
  }

  pickSpecies() {
    const pool = POOL.map((s) => ({ s, w: this.weightOf(s) })).filter((e) => e.w > 0);
    return pool.length ? rng.weighted(pool).s : null;
  }

  spawn(sp, opts = {}) {
    const w = this.world;
    const rec = opts.rec || rollIndividual(sp, w.rollMods);
    const fish = new Fish(rec, sp, w, { fadeIn: !!opts.fadeIn });
    const [d0, d1] = sp.move?.depth || [0.15, 0.85];
    const left = opts.side ? opts.side === 'left' : rng.chance(0.5);
    fish.z = opts.z ?? (fish.style === 'crawl' ? rng.float(0, 0.3) : rng.float(0, 0.75));
    const top = 16 + 14 * fish.scale, bot = w.floorAt() - 8 * fish.scale;
    fish.y = opts.yFrac !== undefined ? clamp(opts.yFrac * this.H, top, bot) : lerp(top, bot, rng.float(d0, d1));
    if (opts.x !== undefined) {
      fish.x = opts.x; fish.y = opts.y ?? fish.y;
    } else if (fish.style === 'crawl' || fish.style === 'hop') {
      // bottom dwellers walk in along the bottom edge
      fish.x = left ? -30 : this.W + 30;
      fish.y = w.floorAt() - 5 * fish.scale;
      fish.facing = left ? 1 : -1; fish.turn = fish.facing;
      fish.target = { x: left ? rng.float(60, this.W * 0.4) : rng.float(this.W * 0.6, this.W - 60), y: fish.y, z: fish.z };
      fish.wanderT = rng.float(4, 8);
    } else {
      fish.x = left ? -40 : this.W + 40;
      fish.facing = left ? 1 : -1; fish.turn = fish.facing;
      fish.setState('enter');
      fish.enterTarget = { x: left ? rng.float(80, this.W * 0.55) : rng.float(this.W * 0.45, this.W - 80), y: fish.y };
    }
    fish.life = rng.float(50, 160);
    fish.extent = extentOf(sp);
    this.fishes.push(fish);
    return fish;
  }

  // A specific species (used by the test page; harmless otherwise).
  spawnSpecies(id, opts) {
    const sp = SPECIES_BY_ID[id];
    return sp && this.fishes.length < MAX_FISH ? this.spawn(sp, opts) : null;
  }

  updateSpawning(dt) {
    this.spawnT -= dt;
    const target = this.settings.fishCount;
    const active = this.activeCount();
    if (this.spawnT <= 0 && active < target && this.fishes.length < MAX_FISH) {
      const sp = this.pickSpecies();
      if (sp) {
        const room = Math.min(target - active, MAX_FISH - this.fishes.length);
        const n = sp.move?.school > 0.4 ? Math.min(room, rng.int(2, 3)) : 1;
        const lead = this.spawn(sp);
        for (let i = 1; i < n; i++) {
          const f = this.spawn(sp, { side: lead.x < 0 ? 'left' : 'right', z: lead.z, yFrac: (lead.y + rng.float(-20, 20)) / this.H });
          f.x = lead.x + (lead.x < 0 ? -1 : 1) * rng.float(10, 40);
          f.enterTarget = { x: lead.enterTarget.x + rng.float(-30, 30), y: f.y };
        }
      }
      this.spawnT = active < target * 0.5 ? rng.float(1.2, 2.5) : rng.float(4, 9);
    }
    // fish handed over from another tab swim in from the matching edge
    if (this.arrivals.length) {
      this.arriveT = (this.arriveT ?? rng.float(0.4, 1.2)) - dt;
      if (this.arriveT <= 0) {
        this.arriveT = undefined;
        const a = this.arrivals.shift();
        const sp = SPECIES_BY_ID[a.rec.species];
        if (sp && this.fishes.length < MAX_FISH) {
          const f = this.spawn(sp, { rec: a.rec, side: a.side === 'right' ? 'left' : 'right', yFrac: a.yFrac, z: a.z });
          f.hops = (a.hops || 0) + 1;
          f.say(rng.pick(['!', 'heart', 'music', '?']), 1.6);
          const ex = f.x < 0 ? 2 : this.W - 2;
          this.particles.bubbles(ex, f.y, 6, { layer: 'fg' });
        }
      }
    }
  }

  acceptArrival(fish) {
    if (!fish || typeof fish !== 'object' || !fish.rec || typeof fish.rec.uid !== 'string') return false;
    if (!SPECIES_BY_ID[fish.rec.species]) return false;
    if (this.fishes.length + this.arrivals.length >= MAX_FISH) return false;
    if (this.fishes.some((f) => f.rec.uid === fish.rec.uid)) return true;
    this.arrivals.push({ rec: fish.rec, side: fish.side === 'left' ? 'left' : 'right', yFrac: clamp01(Number(fish.yFrac) || 0.5), z: clamp(Number(fish.z) || 0.2, 0, 0.75), hops: fish.hops | 0 });
    return true;
  }

  leaveTab(f) {
    const side = f.x < this.W / 2 ? 'left' : 'right';
    ext.send({ type: 'ft:leave', fish: { rec: f.rec, side, yFrac: f.y / this.H, z: f.z, hops: f.hops || 0 } });
  }

  // ------------------------------------------------------------------ fish behaviour extras
  // Fish in front of the page swim around images: wander targets are moved off them and a fish that
  // touches one is eased back out with a sideways nudge so it slides around the edge.
  avoidMedia(f, dt) {
    if (f.controlled || f.z >= FAR_Z || f.style === 'crawl' || f.style === 'hop' || NO_AVOID.has(f.state)) return;
    const m = 6 + 10 * f.scale;
    for (const r of this.world.icons) {
      const x0 = r.x - m, y0 = r.y - m * 0.7, x1 = r.x + r.w + m, y1 = r.y + r.h + m * 0.7;
      fixPoint(f.target, x0, y0, x1, y1, this.W, this.H);
      fixPoint(f.enterTarget, x0, y0, x1, y1, this.W, this.H);
      if (f.x <= x0 || f.x >= x1 || f.y <= y0 || f.y >= y1) continue;
      const dl = f.x - x0, dr = x1 - f.x, du = f.y - y0, dd = y1 - f.y;
      const mn = Math.min(dl, dr, du, dd);
      const step = Math.min(mn, (90 + mn * 4) * dt);
      const tgt = f.target || { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (mn === dl || mn === dr) {
        const s = mn === dl ? -1 : 1;
        f.x += s * step; f.vx = s > 0 ? Math.max(f.vx, 0) : Math.min(f.vx, 0);
        f.vy += Math.sign((tgt.y - cy) || (f.y - cy) || 1) * 60 * dt * 4;
      } else {
        const s = mn === du ? -1 : 1;
        f.y += s * step; f.vy = s > 0 ? Math.max(f.vy, 0) : Math.min(f.vy, 0);
        f.vx += Math.sign((tgt.x - cx) || (f.x - cx) || 1) * 60 * dt * 4;
      }
    }
  }

  applyCurrent(dt) {
    const dx = this.scrollDX * this.k, dy = this.scrollDY * this.k;
    const inner = this.scrollInner * this.k;
    this.scrollDX = 0; this.scrollDY = 0; this.scrollInner = 0;
    this.scanner.shift(dx, dy);
    const sp = (Math.hypot(dx, dy) + inner * 0.5) / Math.max(dt, 1e-3);
    this.scrollSpeed = damp(this.scrollSpeed, sp, 8, dt);
    if (!dx && !dy && !inner) return;
    const mul = this.reduced ? 0.15 : 0.35;
    for (const f of this.fishes) {
      if (f.controlled) continue;
      const drag = mul * (1 - f.z * 0.5) / Math.max(0.6, f.scale);
      f.x -= dx * drag; f.y -= dy * drag;
      f.vx = clamp(f.vx - (dx / Math.max(dt, 1e-3)) * 0.04, -260, 260);
      f.vy = clamp(f.vy - ((dy || (inner * Math.sign(rng.float(-1, 1)))) / Math.max(dt, 1e-3)) * 0.04, -260, 260);
    }
    // a hard flick of the scroll wheel tumbles the fish around
    if (this.scrollSpeed > 1400 && !this.reduced) {
      for (const f of this.fishes) {
        if (f.controlled || !rng.chance(dt * 2.5)) continue;
        f.feel(rng.pick(['dizzy', 'surprised', 'scared']), 1.4);
        if (rng.chance(0.5)) f.say(rng.pick(['!', '!!', '?']), 1);
        f.squashV += 6;
      }
    }
    if (this.scrollSpeed > 300 && rng.chance(Math.min(1, dt * this.scrollSpeed / 220))) {
      const up = dy > 0;
      this.particles.bubble(rng.float(0, this.W), up ? this.H + 4 : rng.float(0, this.H), { vy: up ? -rng.float(40, 90) : rng.float(-20, 20), layer: 'fg', size: rng.pick([1, 1, 2]) });
    }
  }

  updateFishes(dt) {
    const w = this.world;
    for (const f of this.fishes) {
      f.update(dt);
      if (!f.controlled) {
        this.avoidMedia(f, dt);
        const top = 6 + 12 * f.scale * (1 - f.z * 0.5);
        if (f.y < top) { f.y = damp(f.y, top, 6, dt); f.vy = Math.max(f.vy, 0); }
        if (f.state !== 'leave' && f.age > f.life && f.state !== 'sniff' && f.state !== 'interest' && f.state !== 'hide') f.setState('leave');
        // shy fish now and then slip behind a paragraph
        if (f.state === 'wander' && w.windows.length && f.stateT > 3 && rng.chance(dt * 0.05 * (0.25 + f.shyness))) f.goHide();
      }
    }
    for (let i = this.fishes.length - 1; i >= 0; i--) {
      const f = this.fishes[i];
      if (!f.dead) continue;
      this.fishes.splice(i, 1);
      if (f !== this.fishing.fish) this.leaveTab(f);
    }
  }

  // ------------------------------------------------------------------ catching
  onFishCaught(fish) {
    const sp = fish.sp;
    const i = this.fishes.indexOf(fish);
    if (i >= 0) this.fishes.splice(i, 1);
    const rec = { ...fish.rec, species: sp.id, caughtAt: Date.now() };
    const isNew = !this.caughtSpecies.has(sp.id);
    this.caughtSpecies.add(sp.id);
    this.waiting++;
    const record = { ...rec, rarity: sp.rarity, speciesName: sp.name, source: 'browser', sent: false, thumb: renderThumb(sp, rec) };
    ext.send({ type: 'ft:caught', record });
    this.card = { rec, sp, isNew, t: 0, emotion: fish.emotion && fish.emotion !== 'neutral' ? fish.emotion : 'happy', waiting: this.waiting };
    this.game.state.stats.caught++;
    const snd = sp.rarity === 'legendary' ? 'catch_legendary' : sp.rarity === 'epic' ? 'catch_epic' : sp.rarity === 'rare' ? 'catch_rare' : 'catch';
    this.sound.play(snd);
    if (sp.sound) setTimeout(() => this.sound.play(sp.sound, { pitch: 1 / Math.max(0.6, fish.scale) }), 250);
    this.particles.burst(fish.x, fish.y, 22, { colors: ['#ffffff', '#ffe27a', RARITY[sp.rarity]?.color || '#9af0ff'], speed: 110, g: 40, life: 0.9 });
    this.particles.ring(fish.x, fish.y, 1.2);
    this.sendStatus(true);
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const busy = this.fishingMode || this.card || this.fishing.busy;
    const minDt = busy ? 0 : 1 / 30 - 0.003; // idle swimming runs at ~30 fps to stay cheap
    let dt = (now - this.last) / 1000;
    if (dt < minDt) return;
    this.last = now;
    dt = Math.min(dt, 1 / 20);
    try {
      this.update(dt);
      this.draw();
    } catch (e) {
      this.errors++;
      console.warn('[FISHTOP overlay]', e);
      if (this.errors > 3) this.destroy();
    }
    this.input.endFrame();
  }

  update(dtReal) {
    const inp = this.input, w = this.world, cur = w.cursor;
    inp.update(dtReal);
    this.camera.update(dtReal);
    this.timeScale = damp(this.timeScale, this.game.timeScaleTarget * this.camera.timeScale(), 10, dtReal);
    const dt = dtReal * this.timeScale;
    this.time += dt;
    this.statusT -= dtReal;
    this.aliveT -= dtReal;
    if (this.aliveT <= 0) {
      this.aliveT = 4;
      this.updateClock();
      if (!this.standalone && !ext.alive) { this.destroy(); return; } // extension reloaded or removed
    }

    // card under the cursor swallows clicks in fishing mode
    let overCard = false;
    if (this.card) {
      this.card.t += dtReal;
      const r = cardRect(this.card, this.W, this.H);
      overCard = inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h;
      if (this.fishingMode && overCard && inp.pressed) { this.card.t = Math.max(this.card.t, CARD_LIFE - 0.35); inp.consume(); }
      if (this.card.t >= CARD_LIFE) this.card = null;
    }
    this.overCard = overCard && this.fishingMode;
    cur.x = inp.x; cur.y = inp.y; cur.vx = inp.vx; cur.vy = inp.vy; cur.speed = inp.speed;
    cur.inWorld = inp.inside && !this.overCard;

    // page geometry
    this.applyCurrent(dtReal);
    this.scanT -= dtReal;
    if (this.scanT <= 0 && (this.fishes.length || this.fishingMode)) {
      this.scanT = 1.6;
      this.scanner.scan(this.cssW, this.cssH, this.k);
      w.icons = this.scanner.icons;
      w.windows = this.scanner.windows;
    }

    if (this.ready) this.updateSpawning(dt);
    this.updateFishes(dt);
    const worldInput = this.fishingMode && inp.inside && !this.overCard;
    this.fishing.update(dt, worldInput);
    this.particles.update(dt);
    if (this.fishingMode) this.bannerT = (this.bannerT || 0) + dtReal;
    this.sendStatus(false);
  }

  draw() {
    const ctx = this.ctx;
    const active = this.fishes.length || this.particles.list.length || this.card || this.fishingMode || this.fishing.busy;
    if (!active && !this.drewSomething) return; // nothing on screen: skip the frame entirely
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.W, this.H);
    this.drewSomething = !!active;
    if (!active) return;
    if (this.camera.ox || this.camera.oy) ctx.setTransform(1, 0, 0, 1, this.camera.ox, this.camera.oy);
    this.drawFishes(ctx);
    this.particles.draw(ctx, 'fg', this.time);
    this.fishing.drawWorld(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.fishing.drawHud(ctx);
    this.particles.draw(ctx, 'ui', this.time);
    if (this.card) drawCatchCard(ctx, this.card, this.W, this.H, this.world.cursor);
    if (this.fishingMode) this.drawBanner(ctx);
    this.drawCursor(ctx);
  }

  drawFishes(ctx) {
    const list = this.fishes.slice().sort((a, b) => b.z - a.z);
    for (const f of list) {
      if (f.alpha <= 0) continue;
      if (f.wiggle) f.wiggle = Math.max(0, f.wiggle - 0.02);
      const haze = clamp01((f.z - 0.3) * 0.9) * 0.45;
      const st = f.rigState({ wash: haze > 0.03 ? { color: '#8ab8d8', alpha: haze } : null, glow: this.world.glowLevel, time: this.time });
      let alpha = f.alpha * (1 - f.z * 0.25);
      if (f.camo > 0.05) alpha *= 1 - f.camo * 0.8;
      if (f.rec.variant?.mutation === 'ghost') alpha *= 0.65;
      const hiding = !f.controlled && f.state === 'hide';
      const far = !f.controlled && f.z >= FAR_Z;
      const box = (hiding || far) ? this.boxOf(f, st) : null;
      const occ = box ? this.occluders(box, far, hiding || far) : null;
      if (occ && (occ.media.length || occ.text.length)) this.drawOccluded(ctx, f, st, alpha, box, occ);
      else {
        if (alpha < 1) ctx.globalAlpha = alpha;
        f.anchors = drawFishRig(ctx, f.c, st);
        ctx.globalAlpha = 1;
      }
      this.drawExtras(ctx, f);
    }
  }

  boxOf(f, st) {
    if (f.chain) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of f.chain) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const pad = 16 * st.scale + 6;
      return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2), h: Math.ceil(y1 - y0 + pad * 2) };
    }
    const rx = f.extent[0] * st.scale + 10, ry = f.extent[1] * st.scale * (1 + (f.inflate || 0)) + 10;
    return { x: Math.floor(st.x - rx), y: Math.floor(st.y - ry), w: Math.ceil(rx * 2), h: Math.ceil(ry * 2) };
  }

  occluders(b, media, text) {
    const out = { media: [], text: [] };
    const hit = (r) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y;
    if (media) for (const r of this.world.icons) if (hit(r)) out.media.push(r);
    if (text) for (const r of this.world.windows) if (hit(r)) for (const l of this.scanner.linesOf(r)) if (hit(l)) out.text.push(l);
    return out;
  }

  scratch(w, h) {
    if (!this.scratchC || this.scratchC.width < w || this.scratchC.height < h) {
      this.scratchC = makeCanvas(Math.max(w, this.scratchC?.width || 0, 64), Math.max(h, this.scratchC?.height || 0, 64));
      this.scratchG = ctxOf(this.scratchC);
    }
    this.scratchG.setTransform(1, 0, 0, 1, 0, 0);
    this.scratchG.globalAlpha = 1;
    this.scratchG.globalCompositeOperation = 'source-over';
    this.scratchG.clearRect(0, 0, w, h);
    return this.scratchG;
  }

  // Draw a fish that is behind page content: nothing shows through images, a faint ghost shows
  // through lines of text, and everything outside them is drawn normally.
  drawOccluded(ctx, f, st, alpha, b, occ) {
    const g = this.scratch(b.w, b.h);
    g.save();
    g.translate(-b.x, -b.y);
    f.anchors = drawFishRig(g, f.c, st);
    g.restore();
    const cut = (r) => g.clearRect(Math.round(r.x) - b.x, Math.round(r.y) - b.y, Math.round(r.w), Math.round(r.h));
    for (const r of occ.media) cut(r);
    ctx.globalAlpha = alpha * GHOST_TEXT;
    ctx.drawImage(this.scratchC, 0, 0, b.w, b.h, b.x, b.y, b.w, b.h);
    for (const r of occ.text) cut(r);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.scratchC, 0, 0, b.w, b.h, b.x, b.y, b.w, b.h);
    ctx.globalAlpha = 1;
  }

  drawExtras(ctx, f) {
    if (f.emote && f.z < 0.5) {
      const top = f.anchors?.top || [f.x, f.y - 14];
      const k = f.emote.t / f.emote.max;
      const y = Math.round(top[1] - 10 - Math.min(1, f.emote.t * 6) * 4);
      const name = f.emote.icon;
      ctx.globalAlpha = Math.min(1, (1 - k) * 4) * Math.min(1, f.alpha);
      if (ICON_SET.has(name)) {
        const icon = getUiIcon(name);
        ctx.drawImage(icon, Math.round(top[0] - icon.width / 2), y - icon.height);
      } else {
        drawText(ctx, name, top[0], y - 8, { align: 'center', color: name.startsWith('!') ? '#ffe27a' : '#ffffff', outline: '#14202c', scale: name.startsWith('!') ? 2 : 1 });
      }
      ctx.globalAlpha = 1;
    }
    if (f.rec.variant?.shiny && rng.chance(0.06)) this.particles.sparkle(f.x + rng.float(-10, 10) * f.scale, f.y + rng.float(-6, 6) * f.scale, '#fff6b0');
  }

  drawBanner(ctx) {
    const text = this.fishing.busy ? '{hook} Fishing - Esc to stop' : '{hook} Fishing mode - Esc to stop  {bait} Page Crumb';
    const w = measureText(text) + 12;
    const x = Math.round(this.W / 2 - w / 2), y = 4;
    const a = Math.min(1, (this.bannerT || 0) * 4);
    ctx.globalAlpha = a * 0.82;
    ctx.fillStyle = '#0b1622';
    ctx.fillRect(x + 1, y, w - 2, 15); ctx.fillRect(x, y + 1, w, 13);
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba('#7fd6c8', 0.6);
    ctx.fillRect(x + 1, y + 14, w - 2, 1);
    drawText(ctx, text, x + 6, y + 4, { color: '#ffe8a8' });
    ctx.globalAlpha = 1;
  }

  drawCursor(ctx) {
    if (!this.fishingMode || !this.input.inside) return;
    let name = null;
    if (this.fishing.fighting) name = 'cursor_reel';
    else if (this.overCard) name = 'cursor_hand';
    if (!name) return; // the hook itself is the cursor
    const spr = getUiIcon(name);
    const hs = CURSOR_HOTSPOT[name] || [0, 0];
    ctx.drawImage(spr, Math.round(this.input.x) - hs[0], Math.round(this.input.y) - hs[1]);
  }

  // ------------------------------------------------------------------ teardown
  wake() {
    if (document.hidden || this.raf || this.destroyed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try { if (this.fishing.busy) this.fishing.releaseFish(false); } catch { /* ignore */ }
    for (const off of this.subs) off();
    this.subs.length = 0;
    this.input.destroy();
    this.scanner.clear();
    this.fishes.length = 0;
    this.host.remove();
    ext.send({ type: 'ft:bye' });
    if (window.__FISHTOP_OVERLAY__ === this) window.__FISHTOP_OVERLAY__ = null;
  }
}

// Move a target point that lies on an obstacle to the nearest free side of it.
function fixPoint(p, x0, y0, x1, y1, W, H) {
  if (!p || p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1) return;
  const opts = [
    [x0 - 2, p.y, p.x - x0], [x1 + 2, p.y, x1 - p.x],
    [p.x, y0 - 2, p.y - y0], [p.x, y1 + 2, y1 - p.y],
  ].filter(([x, y]) => x > 12 && x < W - 12 && y > 12 && y < H - 12).sort((a, b) => a[2] - b[2]);
  if (opts.length) { p.x = opts[0][0]; p.y = opts[0][1]; }
}

// Rough half-extent of a species sprite at scale 1 (used to size the occlusion scratch box).
function extentOf(sp) {
  const b = sp.look.body || {};
  const len = (b.len || 40) + (sp.look.tail?.len || 10);
  const h = (b.h || 24) + Math.max(sp.look.dorsal?.h || 0, 6) + Math.max(sp.look.anal?.h || 0, 4);
  return [len * 0.62 + 12, h * 0.62 + 14];
}
