// The opening and the first-session tutorial (phase 5, Intro agent).
// 1. The cinematic 3D opening (intro3d.js) plays over the live game. Its response choices (Clip's mood, your
//    angler name, the boat's paint, a first bait) are applied to the save here (applyChoice).
// 2. Clip, the chrome-and-aqua paperclip guide (gfx/npcs.js 'clip'), leads a short, skill-focused first session
//    through the dialogue system (game/dialogue.js: typed Alagard speech bubbles with voice blips and response
//    bubbles), pointing with pulsing rings and arrows (HUD buttons via game.hud.iconRect, world points through
//    camera.worldToScreen):
//      bait     grab the free starter bait at Dot's Bait Shop (HUD 'baitshop'), or a gift when there is no shop
//      cast     drop the hook into the water        wait  jiggle the lure until something bites
//      hook     click on the bite (hook-set)         fight crank by circling, Shock (Space / right click), and
//                                                           hold + drag against the surge
//      card     the catch card: keep it              tank  it swims into the goldfish jar (a response choice)
//      coin     collect the jar's Aero               lab   open The Lab       research  start the first research
//      done     "keep me around for tips?" (a response choice: the hint helper on or off)
//    (step ids 'tank' / 'coin' are what aquarium.js checks to keep jar clicks as drop grabs)
//    Big glossy 3D Alagard words pop up at the key moments (FISH ON!, NICE CATCH!, GO FISH!).
//    A row of glossy dots at the top shows the progress. The HUD asks dockVisible(id) which buttons to show.
// 3. Afterwards Clip stays as an optional hint helper: a little bubble at the bottom right; click it for a tip that
//    fits the moment (state.clip.hints, and the Settings 'hints' switch, turn it off).
//    skip() ends everything (and hands out the starter bait).
//
// Used by game.js: start(), skip(), update(dt), drawWorld(ctx), drawUi(ctx), onCaught(fish, data) -> handled,
//   capturesInput(), boxVisible(), boxOffset(), dockVisible(id), active, step, allowFishing, intro (.opaque),
//   waterSpot(), researchId, dialogue (the Dialogue), helperRect().

import { clamp, clamp01, damp, ease, TAU } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import * as UIC from '../gfx/uiicons.js';
import * as AE from '../ui/aero.js';
import * as NPC from '../gfx/npcs.js';
import { drawText3D } from '../gfx/text3d.js';
import { Intro3D } from './intro3d.js';
import { Dialogue } from './dialogue.js';
import * as BAIT from '../store/bait.js';
import * as LAB from './lab.js';
import * as ITEMS from '../build/items.js';
import * as WORLD from '../world/biomes/index.js';
import * as STORE from '../store/index.js';
import * as BM from '../world/boatmodels.js';

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
// what the intro's bait choice puts in the satchel
const BAIT_GIFT = { crumbs: 5, worm: 2, sugar: 2 };

// Clip's lines: short, with a mood / gesture, an optional little animated glyph (g) and response choices.
const SAY = {
  bait: { text: "First, bait! Dot's shop has free crumbs.", pose: 'point', mood: 'happy' },
  baitPick: { text: 'Grab the free crumbs!', pose: 'point', mood: 'excited' },
  gift: { text: 'Here, some crumbs on me!', pose: 'cheer', mood: 'excited' },
  cast: { text: 'Now drop your hook in the water!', pose: 'point', mood: 'happy' },
  again: { text: 'No worries! Cast again.', pose: 'talk', mood: 'happy' },
  wait: { text: 'Click to wiggle it... wait for the bite!', pose: 'think', mood: 'think' },
  nibble: { text: 'Steady... steady...', pose: 'think', mood: 'surprised' },
  hook: { text: 'NOW! Click!', pose: 'cheer', mood: 'surprised', big: true },
  missed: { text: 'Too slow! Try again.', pose: 'sad', mood: 'sad' },
  crank: { text: 'Circle the mouse to reel!', pose: 'talk', mood: 'excited', g: 'crank' },
  shock: { text: 'Press Space to Shock it!', pose: 'point', mood: 'excited', g: 'key' },
  surge: { text: 'Hold and drag against it!', pose: 'bend', mood: 'angry', g: 'hold' },
  card: { text: 'Look at that! Keep it!', pose: 'cheer', mood: 'love' },
  tank: { text: 'Into your jar it goes! Proud?', pose: 'wave', mood: 'excited', choices: [
    { text: 'So proud!', mood: 'love', reply: 'You should be!' },
    { text: 'Next one is bigger', mood: 'smug', reply: "That's the spirit!" },
  ] },
  coin: { text: 'Fish make Aero! Grab the drop.', pose: 'point', mood: 'happy' },
  lab: { text: 'Spend it in The Lab!', pose: 'point', mood: 'excited' },
  research: { text: 'Start your first research!', pose: 'point', mood: 'happy' },
  done: { text: "You're a natural, {name}! Keep me around for tips?", pose: 'cheer', mood: 'excited', choices: [
    { text: 'Yes please!', value: true, mood: 'love', reply: 'Yay! Click me any time.' },
    { text: "I've got this", value: false, mood: 'smug', reply: 'Okay, champ! Go fish!' },
  ] },
};

const TIPS = [
  'Rare fish love special bait.',
  'Floating boxes hide loot. Fish them up!',
  'Your jar fish make Aero while you play.',
  'New oceans open up from the Map.',
  'Different rods, different skills. Visit The Lab!',
  'Some fish only show up at night.',
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = null;
    this.t = 0;
    this.intro = null;
    this.guide = { x: -60, y: 120, show: 0, facing: 1, key: null };
    this.fishTries = 0;
    this.fightT = 0;
    this.shockUsed = false;
    this.done = { bait: false };
    this.dotAnim = 0;
    this.pops = [];
    this.helper = { show: 0, t: 0, tipI: 0, open: 0 };
    this.dlg = new Dialogue({ audio: game.audio, voice: 'clip', name: '', vars: { name: 'Angler' } });
    game.on?.('baitBought', () => this.onBait());
    game.on?.('baitDownloaded', () => this.onBait());
    game.on?.('hooked', () => { if (['cast', 'wait', 'hook'].includes(this.step)) { this.go('fight'); this.pop('FISH ON!', 'gold'); } });
    game.on?.('escaped', () => this.onEscape());
    game.on?.('revealDone', () => { if (this.step === 'card') this.go('tank'); });
    game.on?.('coinCollected', () => { if (this.step === 'coin' || this.step === 'tank') this.go('lab'); });
    game.on?.('labStarted', () => { if (this.step === 'lab' || this.step === 'research') this.go('done'); });
    game.on?.('panelOpen', (id) => { if (this.step === 'bait' && id === 'baitshop') this.focusShop(); });
  }

  get dialogue() { return this.dlg; }
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
      music: g.ocean?.biome?.music || 'oscean', state: g.state, lowPower: !!g.state.settings?.lowPower,
      onChoice: (key, value) => this.applyChoice(key, value),
      onHandoff: () => this.prepareOcean(),
      onDone: () => { this.intro = null; this.go('bait'); },
    });
    this.go('intro');
  }

  // The intro's response choices, applied to the save.
  applyChoice(key, v) {
    const g = this.game, st = g.state;
    const clip = (st.clip ||= { hints: true });
    try {
      if (key === 'mood') clip.mood = v;
      else if (key === 'name' && typeof v === 'string') {
        st.angler = { ...(st.angler || {}), name: v.slice(0, 24) };
        const n = (st.net ||= { online: false, name: '' });
        if (!n.name) n.name = st.angler.name;
      } else if (key === 'hull') {
        BM.ensureBoat?.(st);
        const part = (BM.BOAT_PARTS?.hull || []).find((p) => p.id === v);
        if (part) {
          st.boat.parts.hull = v;
          (st.cosmetics ||= {})['boatpart:hull:' + v] = true;
          if (st.character) st.character.boat = part.color;
        }
      } else if (key === 'bait' && BAIT_GIFT[v]) {
        BAIT.ensureBait(st);
        BAIT.addBait(st, v, BAIT_GIFT[v]);
        BAIT.equipBait?.(st, v);
      }
    } catch (e) { console.warn('tutorial: choice', key, e); }
    this.dlg.vars.name = this.anglerName();
    g.save?.();
  }

  anglerName() { return this.game.state?.angler?.name || 'Angler'; }
  clipMood() { const m = this.game.state?.clip?.mood; return m === 'smug' || m === 'surprised' ? m : 'happy'; }

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
    if (this.intro) { const it = this.intro; this.intro = null; it.o.onDone = null; it.finish?.(); }
    this.active = false;
    this.step = 'done';
    this.dlg.clear();
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

  // Clip says a line (typed, with voice blips); the same key is not repeated.
  say(key, opts = {}) {
    const G = this.guide;
    if (G.key === key && !opts.force) return;
    const s = SAY[key] || { text: String(key) };
    G.key = key;
    G.line = s;
    this.dlg.vars.name = this.anglerName();
    const mood = this.clipMood() === 'smug' && s.mood === 'happy' ? 'smug' : s.mood;
    this.dlg.now(s.text, {
      mood, pose: s.pose, big: s.big, silent: opts.silent, hold: s.choices ? 0 : opts.hold ?? 6, cps: 46,
      choices: s.choices, autoPick: s.choices ? (key === 'done' ? 9 : 20) : undefined,
      onChoose: (c) => this.onChoose(key, c),
    });
  }

  onChoose(key, c) {
    const st = this.game.state;
    if (key === 'done') { (st.clip ||= {}).hints = c.value !== false; this.game.save?.(); }
    this.game.particles?.aeroConfetti?.(this.guide.x, this.guide.y - 40, 10, { layer: 'ui' });
  }

  pop(text, palette = 'aqua') { this.pops.push({ text, palette, t0: this.game.time ?? 0 }); try { this.game.audio?.play?.('sparkle', { vol: 0.5 }); } catch (e) { /* optional */ } }

  // Which HUD buttons may show (the HUD asks this; alias ids are asked too).
  dockVisible(id) {
    if (!this.active) return this.game.state.tutorialDone ? true : !this.intro;
    if (this.step === 'done') return true;
    const set = SHOWN[this.step] || [];
    return set.includes(ALIAS[id] || id);
  }

  // The pointer is over something of ours (the opening, a response bubble, the hint helper).
  capturesInput() {
    if (this.intro) return true;
    const inp = this.game.input;
    if (!inp) return false;
    if (this.dlg.choosing && this.dlg.choiceRects().some((r) => inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h)) return true;
    const h = this.helperRect();
    return !!(h && inp.x >= h.x && inp.y >= h.y && inp.x < h.x + h.w && inp.y < h.y + h.h);
  }
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
        this.pop('NICE CATCH!', 'leaf');
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
        this.pop('GO FISH!', 'aqua');
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
    const g = this.game;
    this.pops = this.pops.filter((p) => (g.time ?? 0) - p.t0 < 1.9);
    if (!this.active) { this.updateHelper(dt); return; }
    this.t += dt;
    this.dotAnim += dt;
    const G = this.guide;
    if (this.intro) {
      const { W, H } = g.screen;
      if (this.intro.W !== W || this.intro.H !== H) this.intro.resize(W, H);
      this.intro.update(dt);
      return;
    }
    // Clip's speech: response bubbles take clicks and keys 1/2/3 only while they are showing
    const inp = g.input;
    const over = this.dlg.choosing && this.capturesInput();
    this.dlg.update(dt, inp, { mouse: over, keys: this.dlg.choosing });
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
        else if ((G.key === 'nibble' || G.key === 'missed') && this.t > 1.6 && !this.dlg.typing) this.say('wait', { silent: true, force: G.key !== 'wait' });
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
          if (G.key !== want && (want === 'surge' || this.dlg.t > 0.8)) this.say(want, { silent: true });
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
        // wait for the "keep me around?" answer (or a while), then hand over to the hint helper
        if (this.t > 3.6 && !this.dlg.choosing && !this.dlg.active) { this.active = false; this.guide.key = null; }
        else if (this.t > 30) { this.active = false; this.dlg.clear(); }
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- the hint helper (after the tutorial)
  helperOn() {
    const st = this.game.state;
    return !!st?.tutorialDone && !this.intro && st.clip?.hints !== false && st.settings?.hints !== false && st.view !== 'aquarium';
  }

  helperRect() {
    if (this.active || !this.helperOn()) return null;
    const { W, H } = this.game.screen;
    return { x: W - 52, y: H - 132, w: 44, h: 76 };
  }

  updateHelper(dt) {
    const g = this.game, Hh = this.helper;
    const on = this.helperOn();
    Hh.show = clamp01(Hh.show + (on ? dt : -dt) * 3);
    Hh.t += dt;
    Hh.open = Math.max(0, Hh.open - dt);
    if (!on) { if (this.dlg.active && !this.active) this.dlg.clear(); return; }
    this.dlg.update(dt, g.input, { mouse: false, keys: false });
    const r = this.helperRect(), inp = g.input;
    if (r && inp?.pressed && inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h) {
      inp.consume?.();
      this.dlg.vars.name = this.anglerName();
      this.dlg.now(this.hintText(), { mood: 'happy', pose: 'talk', hold: 4.5, cps: 50 });
      Hh.open = 5;
      g.audio?.play?.('ui_click', { vol: 0.4, pitch: 1.3 });
    }
  }

  // a tip that fits the moment
  hintText() {
    const g = this.game, f = g.fishing, st = g.state;
    if (f?.fighting || f?.state === 'fight') return 'Circle to reel! Space = Shock!';
    if (f?.state === 'bite') return 'Click now, {name}!';
    let bait = 1;
    try { bait = BAIT.totalBait(st); } catch (e) { bait = 1; }
    if (bait <= 0) return "Out of bait? Visit Dot's Bait Shop!";
    const tip = TIPS[this.helper.tipI++ % TIPS.length];
    return tip;
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

  // Where Clip floats for the current target (the point is the bottom of Clip's bubble).
  guideSpot(tg) {
    const { W, H } = this.game.screen;
    if (tg.rect) {
      const r = tg.rect;
      const right = tg.side !== 'left' && r.x + r.w + 140 < W;
      const y = r.y > H * 0.7 ? r.y - 16 : r.y + r.h + 26;
      return [right ? r.x + r.w + 44 : Math.max(36, r.x - 34), clamp(y, 110, H - 24)];
    }
    if (tg.point) return [clamp(tg.point[0] - 110, 40, W - 40), clamp(tg.point[1] - 20, 110, H - 30)];
    if (tg.top) return [W * 0.5 - 190, 150];
    if (tg.corner) return [W - 40, H - 70];
    return [W * 0.3, H * 0.66];
  }

  // ---------------------------------------------------------------- drawing
  drawWorld() {}

  drawUi(ctx) {
    if (this.intro) { this.intro.draw(ctx); return; }
    this.drawPops(ctx);
    if (!this.active) { this.drawHelper(ctx); return; }
    const g = this.game, G = this.guide, t = this.t;
    const tg = this.target();
    this.drawDots(ctx);
    if (this.step === 'card' && !g.ui?.isOpen?.('reveal')) return;
    // pointer: a pulsing glossy ring and a bobbing arrow
    if (tg.rect && !tg.noArrow) this.drawPointer(ctx, tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2, Math.max(tg.rect.w, tg.rect.h) * 0.6, tg.arrow || (tg.side === 'left' ? 'side' : tg.rect.y > g.screen.H * 0.7 ? 'down' : true));
    else if (tg.point) this.drawPointer(ctx, tg.point[0], tg.point[1], tg.small ? 10 : 18, !tg.small, tg.bang);
    if (this.step === 'fight') this.drawFightCue(ctx);
    // Clip floats to its spot
    const [sx, sy] = this.guideSpot(tg);
    const dt = 1 / 60;
    if (G.show === 0) { G.x = sx - 60; G.y = sy + 20; }
    G.show = Math.min(1, G.show + dt * 2.5);
    const px = G.x;
    G.x = damp(G.x, sx, 4, dt); G.y = damp(G.y, sy, 4, dt);
    if (Math.abs(G.x - px) > 0.4) G.facing = G.x > px ? 1 : -1;
    const fade = this.step === 'done' ? 1 - clamp01((t - 30) / 0.8) : 1;
    const a = G.show * fade;
    if (a <= 0.01) return;
    const look = tg.rect ? [tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2] : tg.point || null;
    ctx.save();
    ctx.globalAlpha = a;
    const A = this.drawClip(ctx, G.x, G.y, { look, scale: 1.1 });
    // the speech bubble above Clip, the little glyph beside it
    const ln = G.line;
    const r = this.dlg.drawBubble(ctx, G.x, (A?.top?.[1] ?? G.y - 70) - 4, { maxW: 200, t: g.time, W: g.screen.W, H: g.screen.H });
    if (r && ln?.g) this.drawGlyph(ctx, ln.g, r.x - 14, r.y + r.h / 2);
    ctx.restore();
    if (Math.random() < 0.04) g.particles?.aeroBubbles?.(G.x + 6, G.y - 30, 1, { sizes: [2, 2, 3], speed: [12, 30], layer: 'ui' });
  }

  drawClip(ctx, x, y, o = {}) {
    const g = this.game, d = this.dlg;
    const ln = this.guide.line;
    const talking = d.typing;
    const pose = talking ? d.pose || 'talk' : ln?.pose === 'cheer' || ln?.pose === 'wave' ? ln.pose : 'idle';
    try {
      return NPC.drawNPC?.(ctx, 'clip', { x, y, t: g.time ?? this.t, scale: o.scale ?? 0.5, facing: this.guide.facing, talk: d.talk, mood: d.mood || this.clipMood(), pose, lookAt: o.look, id: o.id || 'guide' });
    } catch (e) { return null; }
  }

  // The hint helper: a small Clip on its bubble at the bottom right; its tip in a speech bubble.
  drawHelper(ctx) {
    const Hh = this.helper;
    if (Hh.show <= 0.01) return;
    const r = this.helperRect() || { x: this.game.screen.W - 52, y: this.game.screen.H - 132, w: 44, h: 76 };
    const inp = this.game.input;
    const hov = inp && inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h;
    ctx.save();
    ctx.globalAlpha = Hh.show;
    if (hov) AE.drawAeroGlow?.(ctx, r.x + r.w / 2, r.y + r.h / 2, 30, '#bff4ff', 0.5);
    const A = this.drawClip(ctx, r.x + r.w / 2, r.y + r.h, { scale: 0.75, id: 'helper' });
    if (!this.dlg.active && Math.sin(Hh.t * 2) > 0.2) {
      const e = UIC.getUiIcon?.('exclaim');
      if (e && this.hintText().startsWith('Out of')) ctx.drawImage(e, Math.round(r.x - 2), Math.round(r.y - 4));
    }
    if (this.dlg.active) this.dlg.drawBubble(ctx, r.x + r.w / 2, (A?.top?.[1] ?? r.y) - 2, { maxW: 180, t: this.game.time, W: this.game.screen.W, H: this.game.screen.H });
    ctx.restore();
  }

  // Big glossy 3D Alagard words popping up at the key moments.
  drawPops(ctx) {
    const g = this.game;
    for (const p of this.pops) {
      const age = (g.time ?? 0) - p.t0;
      const a = clamp01((1.9 - age) / 0.4);
      drawText3D(ctx, p.text, g.screen.W / 2, g.screen.H * 0.24 - age * 6, { t: g.time ?? 0, pop: clamp01(age / 0.45), palette: p.palette, size: 16, px: 1, depth: 4, scale: 2, alpha: a });
    }
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
    } else if (arrow) {
      const a = ic('arrow_d');
      if (a) ctx.drawImage(a, Math.round(x - a.width / 2), Math.round(y - r - 14 - a.height + Math.sin(t * 6) * 3));
    }
    if (Math.sin(t * 5) > 0.97) AE.drawSparkle?.(ctx, x + r * 0.7, y - r * 0.7, 2, 1);
  }

  // Little animated glyphs: a mouse circling (crank), the Space key (Shock), a held button (surge).
  drawGlyph(ctx, kind, cx, cy) {
    const t = this.t;
    const ink = AE.AERO?.ink || '#13304e';
    AE.drawGlossOrb?.(ctx, cx, cy, 11, '#e8fbff');
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
    if (i == null || (this.step === 'done' && this.t > 2.5)) return;
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
    void ease;
  }
}
