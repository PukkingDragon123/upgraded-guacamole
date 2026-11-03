// The opening and the first-session tutorial (phase 4, Intro agent).
// 1. The 3D opening (intro3d.js) plays over the live game: a Frutiger Aero fishing trailer (the island, the boat,
//    under the water, a big fish strike, the FISHTOP logo); it dissolves into the (OS)cean.
// 2. Goldie (gfx/npcs.js voxel NPC, floating in a glass bubble) guides a short, visual, skill-focused first session
//    with icon bubbles, pulsing rings and bobbing arrows (world things are pointed at through camera.worldToScreen):
//      bait     grab the free starter bait at Dot's Bait Shop (HUD 'baitshop'), or a gift when there is no shop
//      cast     drop the hook into the water        wait  jiggle the lure until something bites
//      hook     click on the bite (hook-set)         fight crank by circling, Shock (Space / right click), and
//                                                           hold + drag against the surge
//      card     the catch card: keep it              tank  it swims into the goldfish jar
//      coin     collect the jar's Aero               lab   open The Lab       research  start the first research
//    (step ids 'tank' / 'coin' are what aquarium.js checks to keep jar clicks as drop grabs)
//      done
//    A row of glossy dots at the top shows the progress. The HUD asks dockVisible(id) which buttons to show.
//    skip() ends everything (and hands out the starter bait).
//
// Used by game.js: start(), skip(), update(dt), drawWorld(ctx), drawUi(ctx), onCaught(fish, data) -> handled,
//   capturesInput(), boxVisible(), boxOffset(), dockVisible(id), active, step, allowFishing, intro (.opaque).

import { clamp, clamp01, lerp, damp, ease, TAU } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import * as UIC from '../gfx/uiicons.js';
import * as AE from '../ui/aero.js';
import * as NPC from '../gfx/npcs.js';
import { Intro3D } from './intro3d.js';
import * as BAIT from '../store/bait.js';
import * as LAB from './lab.js';
import * as ITEMS from '../build/items.js';
import * as WORLD from '../world/biomes/index.js';
import * as STORE from '../store/index.js';

const START_BIOME = 'oscean';
const START_BAIT = 'crumbs';
const ALIAS = { skills: 'lab', tank: 'aquarium', store: 'baitshop', shop: 'baitshop', appsea: 'baitshop' };
// HUD buttons revealed so far, per step
const SHOWN = {
  intro: [],
  bait: ['baitshop'],
  cast: ['baitshop', 'bait'], wait: ['baitshop', 'bait'], hook: ['baitshop', 'bait'], fight: ['baitshop', 'bait'],
  card: ['baitshop', 'bait', 'aquarium'], tank: ['baitshop', 'bait', 'aquarium'], coin: ['baitshop', 'bait', 'aquarium'],
  lab: ['baitshop', 'bait', 'aquarium', 'lab'], research: ['baitshop', 'bait', 'aquarium', 'lab'],
};
// the progress dots (wait and hook share the cast/hook-set dots)
const DOTS = ['bait', 'cast', 'hook', 'fight', 'card', 'tank', 'coin', 'lab', 'research'];
const DOT_OF = { bait: 0, cast: 1, wait: 1, hook: 2, fight: 3, card: 4, tank: 5, coin: 6, lab: 7, research: 8, done: 9 };

// Bubble contents: very short, icon-led ({name} = inline UI icon). `g` = a little animated glyph drawn first.
const SAY = {
  bait: { lines: ['Free bait!', '{shop} {mouse_l}'] },
  baitPick: { lines: ['{bait} Take it!'] },
  gift: { lines: ['A gift! {bait}'] },
  cast: { lines: ['{hook} into the water'] },
  again: { lines: ['Again!', '{hook} into the water'] },
  wait: { lines: ['Wait for {exclaim}', '{mouse_l} jiggle'] },
  nibble: { lines: ['Steady...'] },
  hook: { lines: ['{mouse_l} NOW!'], big: true },
  missed: { lines: ['Too slow! Again'] },
  crank: { lines: ['Circle = reel'], g: 'crank' },
  shock: { lines: ['= Shock!'], g: 'key' },
  surge: { lines: ['Hold + drag!'], g: 'hold' },
  card: { lines: ['{tank} Keep it!'] },
  tank: { lines: ['Into my jar!'] },
  coin: { lines: ['{mouse_l} {aero}!'] },
  lab: { lines: ['{mouse_l} The Lab'] },
  research: { lines: ['Start a research!'] },
  done: { lines: ['Go fish! {fish}'] },
};

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = null;
    this.t = 0;
    this.intro = null;
    this.guide = { x: -60, y: 120, show: 0, facing: 1, key: null, say: null, sayT: 0, talk: 0 };
    this.fishTries = 0;
    this.fightT = 0;
    this.shockUsed = false;
    this.done = { bait: false };
    this.dotAnim = 0;
    game.on?.('baitBought', () => this.onBait());
    game.on?.('baitDownloaded', () => this.onBait());
    game.on?.('hooked', () => { if (['cast', 'wait', 'hook'].includes(this.step)) this.go('fight'); });
    game.on?.('escaped', () => this.onEscape());
    game.on?.('revealDone', () => { if (this.step === 'card') this.go('tank'); });
    game.on?.('coinCollected', () => { if (this.step === 'coin' || this.step === 'tank') this.go('lab'); });
    game.on?.('labStarted', () => { if (this.step === 'lab' || this.step === 'research') this.go('done'); });
    game.on?.('panelOpen', (id) => { if (this.step === 'bait' && id === 'baitshop') this.focusShop(); });
  }

  get tutorialActive() { return this.active && ['cast', 'wait', 'hook', 'fight'].includes(this.step); }
  get allowFishing() { return this.active && !this.intro; }

  // ---------------------------------------------------------------- lifecycle
  start() {
    const g = this.game;
    this.active = true;
    g.tutorialActive = true;
    this.prepareOcean();
    this.intro = new Intro3D({
      W: g.screen.W, H: g.screen.H, input: g.input, audio: g.audio, look: g.state.character, boat: g.state.boat || { tier: 0 },
      music: g.ocean?.biome?.music || 'oscean',
      onHandoff: () => this.prepareOcean(),
      onDone: () => { this.intro = null; this.go('bait'); },
    });
    this.go('intro');
  }

  // The live game under the opening: the (OS)cean, fully revealed.
  prepareOcean() {
    const g = this.game, st = g.state;
    if (g.ocean) g.ocean.reveal = 1;
    if (g.world) g.world.spawning = true;
    const has = !!(WORLD.BIOMES && WORLD.BIOMES[START_BIOME]);
    if (!st.tutorialDone && has) {
      if (Array.isArray(st.unlockedBiomes) && !st.unlockedBiomes.includes(START_BIOME)) st.unlockedBiomes.unshift(START_BIOME);
      if (st.biome !== START_BIOME && !g.ocean?.travelState) {
        st.biome = START_BIOME;
        if (g.world) g.world.biome = START_BIOME;
        try { g.ocean.setBiome(START_BIOME); } catch (e) { console.warn('tutorial: biome', e); }
      }
    }
  }

  skip() {
    const g = this.game;
    if (this.intro) { this.intro.active = false; this.intro = null; }
    this.active = false;
    this.step = 'done';
    g.tutorialActive = false;
    this.prepareOcean();
    g.state.tutorialDone = true;
    try { BAIT.ensureBait(g.state); if (this.baitCount() <= 0) BAIT.addBait(g.state, START_BAIT, 10); } catch (e) { /* bait module optional */ }
    if (g.ui) g.ui.stack = [];
    try { g.audio?.setMusic?.(g.musicFor?.()); } catch (e) { /* optional */ }
    g.save?.();
  }

  go(step) {
    const prev = this.step;
    this.step = step;
    this.t = 0;
    this.enter(step, prev);
  }

  say(key, opts = {}) {
    const G = this.guide;
    if (G.key === key) return;
    const s = SAY[key] || { lines: [String(key)] };
    G.key = key; G.say = s; G.sayT = 0; G.talk = 0.9;
    if (!opts.silent) { try { this.game.audio?.babble?.(s.lines.join(' ').replace(/\{[a-z_]+\}/g, ''), 'fish'); } catch (e) { /* optional */ } }
  }

  // Which HUD buttons may show (the HUD asks this; alias ids are asked too).
  dockVisible(id) {
    if (!this.active) return this.game.state.tutorialDone ? true : !this.intro;
    if (this.step === 'done') return true;
    const set = SHOWN[this.step] || [];
    return set.includes(ALIAS[id] || id);
  }

  capturesInput() { return !!this.intro; }
  boxVisible() { return !this.intro; }
  boxOffset() { return 0; }

  // ---------------------------------------------------------------- step entry
  enter(step, prev) {
    const g = this.game;
    const st = g.state;
    this.dotAnim = 0;
    switch (step) {
      case 'intro':
        break;
      case 'bait':
        this.guide.show = 0;
        this.baitBase = this.baitCount();
        this.shopFocused = false;
        this.baitT = null;
        this.done.bait = false;
        if (!this.hasShop()) { this.say('gift'); this.giftAt = 1.4; } else this.say('bait');
        break;
      case 'cast':
        this.castBase = st.stats?.casts || 0;
        // tidy up: the shop panel would sit over the water
        if (g.ui?.isOpen?.('baitshop')) setTimeout(() => { if (this.step === 'cast' && g.ui?.isOpen?.('baitshop')) g.ui.close('baitshop'); }, 900);
        this.say(prev === 'fight' || prev === 'hook' ? 'again' : 'cast');
        break;
      case 'wait':
        this.say('wait');
        break;
      case 'hook':
        this.say('hook');
        g.audio?.play?.('bite', { vol: 0.5 });
        break;
      case 'fight':
        this.fightT = 0;
        this.say('crank');
        break;
      case 'card':
        this.say('card');
        break;
      case 'tank':
        g.setView?.('ocean');
        try { g.aquarium?.openWindow?.(true); } catch (e) { /* optional */ }
        this.say('tank');
        break;
      case 'coin':
        try { g.aquarium?.forceCoin?.(); } catch (e) { /* optional */ }
        this.say('coin');
        break;
      case 'lab':
        try { g.aquarium?.closeWindow?.(); } catch (e) { /* optional */ }
        this.say('lab');
        break;
      case 'research': {
        const id = this.firstResearch();
        this.researchId = id;
        if (id) this.ensureAffordable(id);
        // (re)focus the tree on it; the player may already have opened the Lab from its button
        if (g.ui?.panels?.lab) g.ui.open('lab', { tab: 'tree', focus: id, highlight: id });
        this.say('research');
        break;
      }
      case 'done':
        st.tutorialDone = true;
        g.tutorialActive = false;
        if (st.view === 'aquarium' && !g.ui?.isOpen?.('lab')) g.setView?.('ocean');
        this.say('done');
        g.audio?.play?.('ui_unlock', { vol: 0.6 });
        g.particles?.aeroConfetti?.(g.screen.W / 2, g.screen.H * 0.3, 40, { layer: 'ui' });
        g.save?.();
        break;
      default: break;
    }
  }

  hasShop() { return !!this.game.ui?.panels?.baitshop; }

  baitCount() {
    try { return BAIT.totalBait(this.game.state); } catch (e) { return 0; }
  }

  onBait() {
    if (this.step !== 'bait' || this.baitT != null) return;
    this.done.bait = true;
    this.baitT = this.t + 0.7;
    this.say('gift', { silent: true });
  }

  // The player opened the shop: show the free starter pack.
  focusShop() {
    if (this.shopFocused) return;
    this.shopFocused = true;
    const g = this.game;
    try { STORE.openStore?.(g, { tab: 'bait', select: START_BAIT, highlight: START_BAIT }); } catch (e) { /* the shop draws its own selection */ }
    this.say('baitPick');
  }

  giveStarterBait() {
    const g = this.game;
    try { BAIT.ensureBait(g.state); BAIT.addBait(g.state, START_BAIT, 10); } catch (e) { /* optional */ }
    const G = this.guide;
    g.particles?.aeroConfetti?.(G.x, G.y, 16, { layer: 'ui' });
    g.audio?.play?.('ui_unlock', { vol: 0.5 });
    g.toast?.('+10 Bread Crumbs', 'bait');
    g.emit?.('baitBought', { id: START_BAIT, bait: START_BAIT, qty: 10, price: 0, gift: true });
  }

  // The cheapest research that is available right now (Aero first), defaulting to the Lab's sharper hook.
  firstResearch() {
    const st = this.game.state;
    try {
      const list = (LAB.LAB_NODES || []).filter((n) => LAB.labStatus(st, n.id) === 'available');
      list.sort((a, b) => (a.cost?.aero || 0) - (b.cost?.aero || 0));
      return list.find((n) => n.id === 'hook1')?.id || list[0]?.id || null;
    } catch (e) { return null; }
  }

  // A small welcome gift so the very first research can always start.
  ensureAffordable(id) {
    const g = this.game, st = g.state;
    try {
      const node = LAB.LAB_BY_ID?.[id];
      if (!node) return;
      const need = node.cost?.aero || 0;
      if ((st.coins || 0) < need) st.coins = need;
      for (const [mid, n] of Object.entries(node.cost?.items || {})) {
        const have = ITEMS.countItem?.(st, mid) || 0;
        if (have < n) ITEMS.addItem?.(st, mid, n - have);
      }
    } catch (e) { /* the Lab may still be in progress */ }
  }

  onCaught(fish, data) {
    if (!this.active || !['cast', 'wait', 'hook', 'fight'].includes(this.step)) return false;
    const g = this.game;
    this.go('card');
    if (g.ui?.panels?.reveal) { g.ui.open('reveal', { ...data, tutorial: true }); return true; }
    // no catch card: keep it and move on
    try { g.keepFish?.(data.rec); } catch (e) { /* ignore */ }
    this.go('tank');
    return true;
  }

  onEscape() {
    if (!this.active || !['fight', 'wait', 'hook'].includes(this.step)) return;
    this.fishTries++;
    setTimeout(() => { if (this.active && ['fight', 'wait', 'hook'].includes(this.step)) this.go('cast'); }, 700);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    this.dotAnim += dt;
    const G = this.guide;
    G.sayT += dt;
    G.talk = Math.max(0, G.talk - dt);
    if (this.intro) {
      const { W, H } = g.screen;
      if (this.intro.W !== W || this.intro.H !== H) this.intro.resize(W, H);
      this.intro.update(dt);
      return;
    }
    const f = g.fishing;
    switch (this.step) {
      case 'bait':
        if (this.giftAt != null && this.t > this.giftAt) { this.giftAt = null; this.giveStarterBait(); }
        if (this.baitT != null) { if (this.t > this.baitT) this.go('cast'); break; }
        if (this.baitCount() > this.baitBase) this.onBait();
        else if (this.hasShop() && g.ui?.isOpen?.('baitshop') && !this.shopFocused) this.focusShop();
        else if (this.hasShop() && !g.ui?.isOpen?.('baitshop') && this.shopFocused && this.t > 2) { this.shopFocused = false; this.say('bait', { silent: true }); }
        // never strand the player (sold out, shop broken): a gift after a while
        if (this.t > 40 && !this.done.bait) { this.done.bait = true; this.giveStarterBait(); }
        break;
      case 'cast':
        if ((g.state.stats?.casts || 0) > this.castBase || (f && f.state !== 'idle') || (this.t > 1.2 && f?.wasInWater)) this.go('wait');
        break;
      case 'wait':
        if (f?.state === 'bite') this.go('hook');
        else if (f?.state === 'fight') this.go('fight');
        else if (f?.state === 'nibble') this.say('nibble', { silent: true });
        else if (G.key === 'nibble' || G.key === 'missed') { if (G.sayT > 1.6) this.say('wait', { silent: true }); }
        if (f && !f.wasInWater && f.state === 'idle') { this.outT = (this.outT || 0) + dt; if (this.outT > 1.5) { this.outT = 0; this.go('cast'); } } else this.outT = 0;
        break;
      case 'hook':
        if (f?.state === 'fight') this.go('fight');
        else if (f && f.state !== 'bite' && this.t > 0.2) { this.go('wait'); this.say('missed'); }
        break;
      case 'fight': {
        this.fightT += dt;
        const B = f?.battle;
        if (B) {
          if (B.charges < B.shockMax || B.stunT > 0) this.shockUsed = true;
          let want = 'crank';
          if (B.mode === 'tele' || B.mode === 'surge' || B.surging) want = 'surge';
          else if (B.shockReady && !this.shockUsed && this.fightT > 2.2) want = 'shock';
          if (G.key !== want && (want === 'surge' || G.sayT > 0.6)) this.say(want, { silent: true });
        }
        if (f && f.state === 'idle' && this.t > 2) this.go('cast');
        break;
      }
      case 'card':
        if (this.t > 1 && !g.ui?.isOpen?.('reveal')) this.go('tank');
        break;
      case 'tank':
        if (this.t > 2.6) this.go('coin');
        break;
      case 'coin':
        if (this.t > 25) this.go('lab'); // never strand the player on a lost drop
        break;
      case 'lab':
        if (g.ui?.isOpen?.('lab')) this.go('research');
        else if (!g.ui?.panels?.lab && this.t > 2) this.go('done');
        break;
      case 'research':
        if (this.researchId && LAB.labStatus?.(g.state, this.researchId) === 'researching') this.go('done');
        else if (this.t > 1.2 && g.ui?.panels?.lab && !g.ui.isOpen('lab')) this.go('lab');
        else if (!this.researchId && this.t > 4) this.go('done');
        break;
      case 'done':
        if (this.t > 3.6) { this.active = false; G.say = null; }
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- targets
  // screen point of a world point (the Zoom agent's follow camera), identity without a camera
  ws(x, y) {
    const c = this.game.camera;
    try { if (c?.worldToScreen) { const p = c.worldToScreen(x, y); if (p && Number.isFinite(p[0])) return [p[0], p[1]]; } } catch (e) { /* fall through */ }
    return [x, y];
  }

  // A water spot near the boat (screen), where the cast pointer goes.
  waterSpot() {
    const g = this.game, b = g.boat;
    const surf = g.world?.surfaceY ?? 0;
    if (b && Number.isFinite(b.x)) {
      const dir = b.facing || b.dir || 1;
      return this.ws(b.x + dir * 64, (Number.isFinite(b.y) ? b.y : surf) + 44);
    }
    const { W, H } = g.screen;
    return [W * 0.56, H * 0.62];
  }

  target() {
    const g = this.game;
    const f = g.fishing;
    switch (this.step) {
      case 'bait': {
        if (this.giftAt != null || !this.hasShop()) return {};
        const P = g.ui?.panels?.baitshop;
        if (g.ui?.isOpen?.('baitshop') && P) {
          const sel = P.sel?.bait === START_BAIT && P.tab !== 'lines';
          const r = sel && P.buyRect ? P.buyRect : P.offerRect?.(START_BAIT);
          return r ? { rect: r, side: 'left' } : { corner: true };
        }
        return { rect: this.iconRect('baitshop') };
      }
      case 'cast': return { point: this.waterSpot() };
      case 'wait': case 'hook': {
        const h = f?.hook;
        if (h?.visible) return { point: this.ws(h.x, h.y), small: this.step === 'wait', bang: this.step === 'hook' };
        return { point: this.waterSpot() };
      }
      case 'fight': return { top: true };
      case 'card': {
        // the catch card's Keep orb (reveal.js draws it at the card's bottom right in the tutorial)
        const r = g.ui?.isOpen?.('reveal') ? g.ui.panels?.reveal?.rect : null;
        if (r && Number.isFinite(r.x)) { const w = r.w || 470, h = r.h || 304; return { rect: { x: r.x + w - 66, y: r.y + h - 50, w: 40, h: 40 }, arrow: 'side' }; }
        return { top: true };
      }
      case 'tank': case 'coin': return { rect: g.aquarium?.windowRect?.() || null, noArrow: this.step === 'tank' };
      case 'lab': return { rect: this.iconRect('lab') };
      case 'research': return { corner: true };
      default: return {};
    }
  }

  // HUD button rect (game.hud), or the compat desktop stand-in.
  iconRect(id) {
    const g = this.game;
    for (const src of [g.hud, g.desktop]) {
      try {
        const r = src?.iconRect?.(id);
        if (r) return r;
      } catch (e) { /* try the next */ }
    }
    try { const ic = g.desktop?.iconById?.(id); if (ic) return { x: ic.x, y: ic.y, w: ic.w || 44, h: ic.h || 44 }; } catch (e) { /* none */ }
    return null;
  }

  // Where Goldie floats for the current target.
  guideSpot(tg) {
    const { W, H } = this.game.screen;
    if (tg.rect) {
      const r = tg.rect;
      const right = tg.side !== 'left' && r.x + r.w + 140 < W;
      const y = r.y > H * 0.7 ? r.y - 46 : r.y + r.h * 0.6;
      return [right ? r.x + r.w + 62 : Math.max(46, r.x - 44), clamp(y, 84, H - 60)];
    }
    if (tg.point) return [clamp(tg.point[0] - 120, 50, W - 50), clamp(tg.point[1] - 70, 80, H - 70)];
    if (tg.top) return [W * 0.5 - 170, 92];
    if (tg.corner) return [W - 46, H - 120];
    return [W * 0.32, H * 0.62];
  }

  // ---------------------------------------------------------------- drawing
  drawWorld() {}

  drawUi(ctx) {
    if (!this.active && !this.intro) return;
    if (this.intro) { this.intro.draw(ctx); return; }
    const g = this.game, G = this.guide, t = this.t;
    const tg = this.target();
    this.drawDots(ctx);
    if (this.step === 'card' && !g.ui?.isOpen?.('reveal')) return;
    // pointer: a pulsing glossy ring and a bobbing arrow
    if (tg.rect && !tg.noArrow) this.drawPointer(ctx, tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2, Math.max(tg.rect.w, tg.rect.h) * 0.6, tg.arrow || (tg.side === 'left' ? 'side' : tg.rect.y > g.screen.H * 0.7 ? 'down' : true));
    else if (tg.point) this.drawPointer(ctx, tg.point[0], tg.point[1], tg.small ? 10 : 18, !tg.small, tg.bang);
    if (this.step === 'fight') this.drawFightCue(ctx);
    // Goldie swims to her spot
    const [sx, sy] = this.guideSpot(tg);
    const dt = 1 / 60;
    if (G.show === 0) { G.x = sx - 60; G.y = sy + 20; }
    G.show = Math.min(1, G.show + dt * 2.5);
    const px = G.x;
    G.x = damp(G.x, sx, 4, dt); G.y = damp(G.y, sy + Math.sin(g.time * 2) * 3, 4, dt);
    if (Math.abs(G.x - px) > 0.3) G.facing = G.x > px ? 1 : -1;
    const fade = this.step === 'done' ? 1 - clamp01((t - 2.8) / 0.8) : 1;
    const a = G.show * fade;
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    AE.drawAeroGlow?.(ctx, G.x, G.y, 32, '#bff4ff', 0.4);
    AE.drawAeroBubble?.(ctx, G.x, G.y, 26, 0.9);
    try {
      const look = tg.rect ? [tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2] : tg.point || null;
      const mood = this.step === 'done' || this.step === 'tank' || this.step === 'card' ? 'excited' : this.step === 'hook' ? 'surprised' : 'happy';
      NPC.drawNPC?.(ctx, 'goldie', { x: G.x, y: G.y + 14, t: g.time, scale: 1, facing: G.facing, talk: G.talk > 0 ? 0.5 + 0.5 * Math.sin(g.time * 18) : 0, mood, pose: G.talk > 0 ? 'talk' : 'idle', shadow: false, lookAt: look, id: 'guide' });
    } catch (e) { /* optional */ }
    if (G.say) this.drawSay(ctx, G.x, G.y - 30, G.say);
    ctx.restore();
    if (Math.random() < 0.04) g.particles?.aeroBubbles?.(G.x + 8, G.y - 16, 1, { sizes: [2, 2, 3], speed: [12, 30], layer: 'ui' });
  }

  // The fight: an arrow against the surge, drawn at the fish.
  drawFightCue(ctx) {
    const f = this.game.fishing, B = f?.battle;
    if (!B || !B.fish) return;
    const surging = B.mode === 'tele' || B.mode === 'surge' || B.surging;
    if (!surging) return;
    const [x, y] = this.ws(B.fish.x, B.fish.y);
    const dir = (B.mode === 'tele' ? B.teleDir : B.pullDir) ?? B.away ?? 0;
    const a = dir + Math.PI; // drag AGAINST the surge
    const t = this.t;
    const pulse = 0.5 + 0.5 * Math.sin(t * 10);
    const L = 34 + pulse * 6;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(a);
    ctx.globalAlpha = B.mode === 'tele' ? 0.55 + 0.45 * pulse : 0.95;
    // a fat glossy arrow
    ctx.fillStyle = rgba('#063a6a', 0.5);
    this.arrowPath(ctx, 14, L + 2, 7, 13); ctx.fill();
    ctx.fillStyle = B.mode === 'tele' ? '#ffd23a' : '#7ff0ff';
    this.arrowPath(ctx, 14, L, 5, 11); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(16, -4, Math.round(L * 0.6), 2);
    ctx.restore();
  }

  arrowPath(ctx, x0, L, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(x0, -hw); ctx.lineTo(x0 + L - hh, -hw); ctx.lineTo(x0 + L - hh, -hh); ctx.lineTo(x0 + L, 0);
    ctx.lineTo(x0 + L - hh, hh); ctx.lineTo(x0 + L - hh, hw); ctx.lineTo(x0, hw); ctx.closePath();
  }

  drawPointer(ctx, x, y, r, arrow, bang = false) {
    const t = this.t;
    const k = (t * 1.1) % 1;
    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - k);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), r + k * 14, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5 * (1 - k);
    ctx.strokeStyle = '#7ff0ff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), r + k * 14 + 2, 0, TAU); ctx.stroke();
    ctx.restore();
    const ic = (n) => UIC.getUiIcon?.(n);
    if (bang) {
      const e = ic('exclaim');
      const s = 2 + Math.round(Math.abs(Math.sin(t * 9)));
      if (e) ctx.drawImage(e, Math.round(x - (e.width * s) / 2), Math.round(y - r - 10 - e.height * s), e.width * s, e.height * s);
    } else if (arrow === 'side') {
      const a = ic('arrow_l');
      if (a) ctx.drawImage(a, Math.round(x + r + 8 + Math.sin(t * 6) * 3), Math.round(y - a.height / 2));
    } else if (arrow === 'down') {
      const a = ic('arrow_d');
      if (a) ctx.drawImage(a, Math.round(x - a.width / 2), Math.round(y - r - 14 - a.height + Math.sin(t * 6) * 3));
    } else if (arrow) {
      const a = ic('arrow_d');
      if (a) ctx.drawImage(a, Math.round(x - a.width / 2), Math.round(y - r - 14 - a.height + Math.sin(t * 6) * 3));
    }
    if (Math.sin(t * 5) > 0.97) AE.drawSparkle?.(ctx, x + r * 0.7, y - r * 0.7, 2, 1);
  }

  // A glossy speech bubble: an optional animated glyph, one or two short lines with inline icons, popping in.
  drawSay(ctx, x, y, s) {
    const g = this.game, G = this.guide;
    const lines = s.lines;
    const gw = s.g ? (s.g === 'key' ? 34 : 18) : 0;
    const w = Math.max(...lines.map((l) => measureText(l))) + 18 + gw;
    const h = Math.max(lines.length * 12 + 10, s.g ? 26 : 0) + (s.big ? 4 : 0);
    const pop = ease.outBack(clamp01(G.sayT * 4));
    const bx = Math.round(clamp(x - w / 2, 4, g.screen.W - w - 4)), by = Math.round(y - h - 8);
    ctx.save();
    ctx.translate(x, by + h);
    const sc = pop * (s.big ? 1 + 0.06 * Math.sin(this.t * 14) : 1);
    ctx.scale(sc, sc);
    ctx.translate(-x, -(by + h));
    ctx.fillStyle = 'rgba(240,252,255,0.95)';
    ctx.beginPath(); ctx.moveTo(clamp(x - 5, bx + 6, bx + w - 12), by + h - 1); ctx.lineTo(clamp(x + 5, bx + 12, bx + w - 6), by + h - 1); ctx.lineTo(x, by + h + 7); ctx.closePath(); ctx.fill();
    AE.drawAeroSurface?.(ctx, bx, by, w, h, { tone: 'frost', r: 7, gloss: 0.55, glossH: Math.round(h * 0.42), rim: 0.85, glow: 0.4 });
    const ink = AE.AERO?.ink || '#13304e';
    if (s.g) this.drawGlyph(ctx, s.g, bx + 9 + gw / 2 - 2, by + h / 2);
    const ty = by + Math.round((h - lines.length * 12) / 2) + 2;
    lines.forEach((l, i) => drawText(ctx, l, bx + 9 + gw + Math.round((w - 18 - gw - measureText(l)) / 2), ty + i * 12, { color: ink }));
    ctx.restore();
  }

  // Little animated glyphs: a mouse circling (crank), the Space key (Shock), a held button (surge).
  drawGlyph(ctx, kind, cx, cy) {
    const t = this.t;
    const ink = AE.AERO?.ink || '#13304e';
    if (kind === 'crank') {
      ctx.strokeStyle = rgba(ink, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.stroke();
      const a = t * 7;
      for (let i = 0; i < 4; i++) { ctx.fillStyle = rgba('#2fb8e8', 1 - i * 0.22); ctx.fillRect(Math.round(cx + Math.cos(a - i * 0.35) * 7) - 1, Math.round(cy + Math.sin(a - i * 0.35) * 7) - 1, 3, 3); }
      const m = UIC.getUiIcon?.('mouse_l');
      if (m) ctx.drawImage(m, Math.round(cx + Math.cos(a) * 7 - m.width / 2), Math.round(cy + Math.sin(a) * 7 - m.height / 2));
    } else if (kind === 'key') {
      const w = 30, h = 13, x = Math.round(cx - w / 2), y = Math.round(cy - h / 2 + (Math.sin(t * 8) > 0.6 ? 1 : 0));
      ctx.fillStyle = ink; ctx.fillRect(x, y + 1, w, h);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1, y, w - 2, h - 1);
      ctx.fillStyle = '#d8eefa'; ctx.fillRect(x + 1, y + h - 4, w - 2, 3);
      drawText(ctx, 'SPACE', cx, y + 3, { font: 'small', align: 'center', color: ink });
      if (Math.sin(t * 8) > 0.6) AE.drawSparkle?.(ctx, x + w - 2, y, 2, 1, '#7ff0ff');
    } else if (kind === 'hold') {
      const m = UIC.getUiIcon?.('mouse_hold') || UIC.getUiIcon?.('mouse_l');
      if (m) ctx.drawImage(m, Math.round(cx - m.width / 2 + Math.sin(t * 6) * 2), Math.round(cy - m.height / 2));
    }
  }

  // Progress: a row of glossy dots at the top centre.
  drawDots(ctx) {
    const i = DOT_OF[this.step];
    if (i == null || this.step === 'done' && this.t > 2.5) return;
    const W = this.game.screen.W;
    const n = DOTS.length, gap = 11, x0 = Math.round(W / 2 - ((n - 1) * gap) / 2), y = 14;
    ctx.save();
    AE.drawAeroSurface?.(ctx, x0 - 10, y - 7, (n - 1) * gap + 20, 14, { tone: 'glass', r: 'pill', gloss: 0.5, glossH: 6, rim: 0.7, glow: 0.3 });
    for (let k = 0; k < n; k++) {
      const x = x0 + k * gap;
      if (k < i) { ctx.fillStyle = '#5ad84a'; ctx.fillRect(x - 2, y - 2, 5, 5); ctx.fillStyle = '#d8ffc0'; ctx.fillRect(x - 1, y - 2, 2, 1); }
      else if (k === i) { const p = 1 + Math.round(Math.abs(Math.sin(this.dotAnim * 4))); AE.drawGlossOrb?.(ctx, x, y, 3 + p * 0.5, '#2fd3e8'); }
      else { ctx.fillStyle = 'rgba(19,48,78,0.25)'; ctx.fillRect(x - 1, y - 1, 3, 3); }
    }
    ctx.restore();
    void lerp;
  }
}
