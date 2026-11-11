// The opening and the first-session tutorial (phase 5 Intro agent; phase 6 Guide agent: Bubbles the seal).
// 1. The cinematic 3D opening (intro3d.js) plays over the live game. Its response choices (the guide's mood, your
//    angler name, the boat's paint, a first bait) are applied to the save here (applyChoice).
// 2. Bubbles, a fat low-poly bubble seal pup (gfx/seal.js SealGuide), SWIMS AROUND THE SCREEN with smooth physics
//    to whatever it is explaining and POINTS at it with a flipper (a stream of tiny bubbles flows to the target),
//    talking through the dialogue system (game/dialogue.js: typed Alagard speech bubbles with voice blips and
//    response bubbles that keep clear of the target). Targets: HUD buttons (game.hud.iconRect), the bait pod, the
//    shop shelf, the water, the hook and the hooked fish (camera.worldToScreen), the fishing gear UI, the catch
//    card, the jar, The Lab. It idles near the screen edge whenever the action needs the middle (the fight).
//      bait     grab the free starter bait at Dot's Bait Shop (HUD 'baitshop'), or a gift when there is no shop
//      cast     (the bait pod: loaded!) drop the hook into the water       wait  wiggle until something bites
//      hook     set the hook (spin the gear into the band when the gear minigame is there, else click)
//      fight    reel (spin / crank), Shock (hold-release or Space), hold + drag against surges (feature-detected)
//      card     the catch card: keep it              tank  it swims into the goldfish jar (a response choice)
//      coin     collect the jar's Aero               lab   open The Lab       research  start the first research
//      done     "keep me around for tips?" (a response choice: the hint helper on or off), then
//               game.emit('tutorialDone') (quest lines start; also emitted by skip())
//    (step ids 'tank' / 'coin' are what aquarium.js checks to keep jar clicks as drop grabs)
//    Big glossy 3D Alagard words pop up at the key moments (FISH ON!, NICE CATCH!, GO FISH!).
//    A row of glossy dots at the top shows the progress. The HUD asks dockVisible(id) which buttons to show.
// [tut16] The fishing part is a FORCED step-by-step lesson ("How to fish"): each step waits until the player has
//    done it, Bubbles explains it in one short line, the HUD part it is about gets the pixel focus brackets (never
//    rings or rays), the rest of the HUD and the boat are locked, and the fight itself follows the lesson (battle.js
//    reads tutorial.lesson): one calm intro beat per step (the fish holds still, the world dims softly), then
//      cast   move the mouse into the water (a 3D mouse glides to the spot)    wait  hold still, watch the bait nibble
//      hook   spin the gear into the band                 reel  circle to crank, needle in the green (to 30 %)
//      ease   the line spikes tight: slow down until the tube is calm         surge hold + drag against the pull (won)
//      zap    hold, release on the gold: a stun (a miss is refunded)          land  reel the dizzy fish all the way in
//      card   keep it (new game; release too in a replay)
//    Every step is saved (state.tutorialStep, state.fishLesson = {step, stages, done, offered, active}) so a reload
//    resumes: the opening is not replayed, a fight step resumes at the cast (a fight cannot be resumed) and keeps the
//    fight steps already learnt. Older saves that finished the tutorial are offered the lesson once (Bubbles asks,
//    "I'm a pro" declines); Settings has "Fishing lesson" (replay) and, during a replay, "End lesson".
//    Big step titles are 3D voxel words (text3d.js), never 2D text pop-ups.
// 3. Afterwards Bubbles stays as an optional hint helper: it rests on its bubble near the bottom right edge (the left
//    edge during a fight); click it for a tip that fits the moment and it swims over to point at the right button
//    (state.clip.hints, and the Settings 'hints' switch, turn it off). skip() ends everything (+ the starter bait).
//
// Used by game.js: start(), skip(), update(dt), drawWorld(ctx), drawUi(ctx), onCaught(fish, data) -> handled,
//   capturesInput(), boxVisible(), boxOffset(), dockVisible(id), active, step, allowFishing, intro (.opaque),
//   waterSpot(), researchId, dialogue (the Dialogue), helperRect(), seal (the SealGuide), lessonLock().
// [tut16] startLesson(kind) / endLesson(done) / canReplay() (Settings), lesson (the fight step battle.js follows),
//   mode ('full' = the first session, 'lesson' = a replay of the fishing lesson only).

import { clamp, clamp01, TAU } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import * as UIC from '../gfx/uiicons.js';
import * as AE from '../ui/aero.js';
import { SealGuide, SEAL_INFO, sealSize, warmSeal } from '../gfx/seal.js';
import { drawText3D } from '../gfx/text3d.js';
import { drawIcon3d } from '../fishing/icons3d.js';
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
// [tut16] the forced fishing lesson: its steps, the fight steps (battle.js follows tutorial.lesson), how far each
// fight step may reel the fish (progress cap), the calm intro beat (s) and the 3D step titles
export const LESSON_STEPS = ['cast', 'wait', 'hook', 'reel', 'ease', 'surge', 'zap', 'land', 'card'];
export const FIGHT_STEPS = ['reel', 'ease', 'surge', 'zap', 'land'];
const FISHING_STEPS = ['cast', 'wait', 'hook', ...FIGHT_STEPS];
const LESSON_CAP = { reel: 0.3, ease: 0.42, surge: 0.56, zap: 0.7, land: 1 };
const LESSON_HOLD = { reel: 1.6, ease: 1.5, surge: 1.5, zap: 1.5, land: 0.7 };
const LESSON_POP = {
  cast: ['CAST!', 'aqua'], hook: ['BITE!', 'gold'], reel: ['REEL!', 'leaf'], ease: ['EASE OFF!', 'coral'],
  surge: ['PULL BACK!', 'gold'], zap: ['ZAP IT!', 'gold'], land: ['LAND IT!', 'leaf'],
};
// HUD buttons revealed so far, per step (the lesson shows only the loaded bait)
const SHOWN = {
  intro: [],
  bait: ['baitshop'],
  card: ['baitshop', 'bait', 'aquarium'], tank: ['baitshop', 'bait', 'aquarium'], coin: ['baitshop', 'bait', 'aquarium'],
  lab: ['baitshop', 'bait', 'aquarium', 'lab'], research: ['baitshop', 'bait', 'aquarium', 'lab'],
};
for (const s of FISHING_STEPS) SHOWN[s] = ['bait'];
// the progress dots: the first session, or a replayed lesson
const DOTS_FULL = ['bait', ...LESSON_STEPS, 'tank', 'coin', 'lab', 'research'];
const DOTS_LESSON = LESSON_STEPS;
// what the intro's bait choice puts in the satchel
const BAIT_GIFT = { crumbs: 5, worm: 2, sugar: 2 };
export const GUIDE_NAME = SEAL_INFO.name;

// Bubbles' lines: short, with a mood, a gesture (pose -> a seal emote), an optional animated glyph (g) and choices.
// Fishing prompts stay generic; the gear / hold-to-charge variants are picked by feature detection (fishingKind()).
const SAY = {
  bait: { text: "First, bait! Dot's shop has free crumbs.", pose: 'point', mood: 'happy' },
  baitPick: { text: 'Grab the free crumbs!', pose: 'point', mood: 'excited' },
  gift: { text: 'Here, some crumbs on me!', pose: 'cheer', mood: 'excited' },
  loaded: { text: 'Your bait sits here. Loaded!', pose: 'point', mood: 'happy' },
  // [tut16] the fishing lesson: one short line per step; `stay` lines wait until the step is done
  cast: { text: 'Move your mouse into the water to cast!', pose: 'point', mood: 'happy', stay: true, g: 'move' },
  again: { text: 'No worries! Cast again.', pose: 'talk', mood: 'happy', stay: true, g: 'move' },
  wait: { text: 'Hold still... watch your bait!', pose: 'think', mood: 'think', stay: true },
  nibble: { text: 'Nibble, nibble... not yet!', pose: 'think', mood: 'surprised', stay: true },
  hook: { text: 'NOW! Click to hook it!', pose: 'point', mood: 'surprised', big: true, stay: true },
  hookGear: { text: 'A BITE! Circle the mouse to spin the gear!', pose: 'point', mood: 'surprised', big: true, g: 'crank', stay: true },
  missed: { text: 'Too slow! Try again.', pose: 'sad', mood: 'worried', stay: true },
  reel: { text: 'Keep circling! Keep the needle in the green!', pose: 'point', mood: 'excited', g: 'crank', stay: true },
  easeIntro: { text: 'Now watch this tube: the line tension!', pose: 'point', mood: 'think', stay: true },
  easeTight: { text: 'Too tight! Slow down, ease off!', pose: 'bend', mood: 'worried', g: 'slow', stay: true },
  ease: { text: 'Easy... keep the tube low and calm.', pose: 'point', mood: 'happy', g: 'slow', stay: true },
  surgeIntro: { text: 'Uh oh, it wants to swim away...', pose: 'think', mood: 'surprised', stay: true },
  surgeGo: { text: 'Hold the button, drag against the arrow!', pose: 'bend', mood: 'determined', g: 'hold', stay: true },
  zap: { text: 'Zap time! Hold, then let go on the gold!', pose: 'point', mood: 'excited', g: 'hold', stay: true },
  zapMiss: { text: 'Almost! Let go when the ring glows gold!', pose: 'talk', mood: 'happy', g: 'hold', stay: true },
  land: { text: "It's dizzy! Reel it all the way in!", pose: 'point', mood: 'excited', g: 'crank', stay: true },
  cardLesson: { text: 'Keep it in your tank, or let it go!', pose: 'cheer', mood: 'love', stay: true },
  lessonHi: { text: "Fishing lesson! I'll show you, step by step.", pose: 'wave', mood: 'excited' },
  lessonBack: { text: "Welcome back! Let's finish the lesson.", pose: 'wave', mood: 'happy' },
  lessonDone: { text: "That's how to fish, {name}! Go get 'em!", pose: 'cheer', mood: 'excited' },
  offer: { text: 'Psst! Want a quick fishing lesson?', pose: 'wave', mood: 'excited', choices: [
    { text: 'Teach me!', value: true, mood: 'love', reply: 'Yay! Follow me!' },
    { text: "I'm a pro", value: false, mood: 'smug', reply: "Okay! It's in Settings any time." },
  ] },
  crank: { text: 'Circle the mouse to reel it in!', pose: 'point', mood: 'excited', g: 'crank' },
  crankGear: { text: 'Spin the gear! Keep it in the green!', pose: 'point', mood: 'excited', g: 'crank' },
  shock: { text: 'Press Space to Shock it!', pose: 'point', mood: 'excited', g: 'key' },
  shockHold: { text: 'Hold, then let go to ZAP it!', pose: 'point', mood: 'excited', g: 'hold' },
  surge: { text: 'Hold and drag against it!', pose: 'bend', mood: 'determined', g: 'hold' },
  card: { text: 'Look at that! Keep it!', pose: 'cheer', mood: 'love' },
  tank: { text: 'Into your tank it goes! Proud?', pose: 'wave', mood: 'excited', choices: [
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
// pose -> a one-shot seal emote when the line starts
const EMOTE = { cheer: ['clap', 1.4], wave: ['wave', 1.8], sad: ['worried', 1.2], bend: ['worried', 0.8], think: ['think', 2.2] };

// tips for the hint helper; `at` = the HUD button Bubbles swims over to
const TIPS = [
  { text: 'Rare fish love special bait.', at: 'bait' },
  { text: 'Floating boxes hide loot. Fish them up!' },
  { text: 'Your tank fish make Aero while you play.', at: 'aquarium' },
  { text: 'New oceans open up from the Map.', at: 'map' },
  { text: 'Different rods, different skills. Visit The Lab!', at: 'lab' },
  { text: 'Some fish only show up at night.' },
  { text: 'Deeper water, bigger and spookier fish!' },
  { text: 'Check your quests for shiny rewards!', at: 'quests' },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = null;
    this.t = 0;
    this.intro = null;
    this.guide = { key: null, line: null, show: 0 };
    this.seal = new SealGuide({ x: -90, y: (game.screen?.H || 540) * 0.55, size: this.sealSize(), audio: game.audio, id: 'guide' });
    this.fishTries = 0;
    this.fightT = 0;
    this.shockUsed = false;
    this.done = { bait: false };
    this.dotAnim = 0;
    this.pops = [];
    this.perchKey = null;
    this.perchI = -1;
    this.helper = { show: 0, t: 0, tipI: 0, open: 0, at: null };
    this.doneSent = false;
    this.mode = 'full'; // [tut16] 'full' = the first session, 'lesson' = a replayed fishing lesson
    this.lesson = null; // [tut16] the fight step battle.js follows
    this.offering = false; this.offerT = 0; this.bootT = 0; this.resumed = false;
    this.dlg = new Dialogue({ audio: game.audio, voice: 'fish', name: '', vars: { name: 'Angler' } });
    game.on?.('baitBought', () => this.onBait());
    game.on?.('baitDownloaded', () => this.onBait());
    // (the fishing HUD shows FISH ON! itself)
    game.on?.('hooked', () => { if (this.active && ['cast', 'wait', 'hook'].includes(this.step)) { this.go(this.firstFightStep()); this.seal.emote('spin'); } });
    game.on?.('escaped', () => this.onEscape());
    game.on?.('revealDone', () => { if (this.step === 'card') this.go(this.mode === 'lesson' ? 'lessonDone' : 'tank'); });
    game.on?.('coinCollected', () => { if (this.step === 'coin' || this.step === 'tank') { this.seal.emote('wiggle'); this.go('lab'); } });
    game.on?.('labStarted', () => { if (this.step === 'lab' || this.step === 'research') this.go('done'); });
    game.on?.('panelOpen', (id) => { if (this.step === 'bait' && id === 'baitshop') this.focusShop(); });
    game.on?.('caught', () => { if (!this.active && this.helperOn()) this.seal.emote('clap', 1.2); });
  }

  get dialogue() { return this.dlg; }
  get tutorialActive() { return this.active && FISHING_STEPS.includes(this.step); }
  // [tut16] the lesson locks the world around the fishing (no boat dragging, no HUD panels)
  lessonLock() { return this.active && (FISHING_STEPS.includes(this.step) || this.step === 'card'); }
  // the persistent lesson record (created on demand: older saves have none)
  lessonState() {
    const st = this.game.state;
    const L = (st.fishLesson && typeof st.fishLesson === 'object') ? st.fishLesson : (st.fishLesson = {});
    L.stages ||= {};
    return L;
  }
  // Settings may replay the lesson (not during the first session or the opening)
  canReplay() { return !this.intro && !(this.active && this.mode === 'full'); }
  get allowFishing() { return this.active && !this.intro; }

  sealSize() {
    const H = this.game.screen?.H || 540;
    let k = 1.6;
    try { k = AE.uiK?.() ?? 1.6; } catch (e) { k = 1.6; }
    return sealSize(44 * clamp(k / 1.6, 0.85, 1.2) * clamp(H / 540, 1, 1.3));
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    const g = this.game;
    this.active = true;
    this.mode = 'full';
    g.tutorialActive = true;
    this.prepareOcean();
    // [tut16] a reload mid-tutorial resumes at the saved step (the opening is not replayed)
    const resume = this.resumeStep();
    if (resume) {
      this.enterSeal();
      this.go(resume);
      if (resume === 'cast') { this.say('lessonBack', { force: true }); this.lineAt = 2.6; }
      return;
    }
    this.intro = new Intro3D({
      W: g.screen.W, H: g.screen.H, input: g.input, audio: g.audio, look: g.state.character, boat: g.state.boat || { tier: 0 },
      music: g.ocean?.biome?.music || 'oscean', state: g.state, lowPower: !!g.state.settings?.lowPower,
      onChoice: (key, value) => this.applyChoice(key, value),
      onHandoff: () => this.prepareOcean(),
      onDone: () => { this.intro = null; this.enterSeal(); this.go('bait'); },
    });
    this.go('intro');
  }

  // [tut16] Where a saved first session picks up again (null: from the opening).
  resumeStep() {
    const st = this.game.state, s = st.tutorialStep;
    if (typeof s !== 'string' || !s || s === 'intro') return null;
    if (s === 'bait') return 'bait';
    if (FISHING_STEPS.includes(s)) return 'cast';
    if (s === 'card') return (st.fish || []).some((f) => f.inTank) ? 'tank' : 'cast';
    if (s === 'tank' || s === 'coin') return 'tank';
    if (s === 'lab' || s === 'research') return 'lab';
    if (s === 'done') return 'done';
    return null;
  }

  // [tut16] Replay the fishing lesson on its own (Settings, the one-time offer, or a saved replay after a reload).
  startLesson(kind = 'replay') {
    const g = this.game, st = g.state;
    if (!this.canReplay()) return false;
    if (this.active && this.mode === 'lesson') return true;
    try { if (g.fishing?.busy) g.fishing.releaseFish(false); } catch (e) { /* optional */ }
    try { if (g.ui?.isOpen?.('settings')) g.ui.close('settings'); } catch (e) { /* optional */ }
    if (st.view !== 'ocean') g.setView?.('ocean');
    const L = this.lessonState();
    if (kind !== 'resume') L.stages = {};
    L.active = true; L.offered = true;
    this.mode = 'lesson';
    this.active = true;
    g.tutorialActive = true;
    this.offering = false;
    this.helper.open = 0;
    this.dlg.clear();
    this.guide.key = null;
    this.doneSent = true; // quests started with the first session already
    try { warmSeal(this.sealSize(), ['idle', 'swim', 'point']); } catch (e) { /* optional */ }
    this.go('cast');
    this.say(kind === 'resume' ? 'lessonBack' : 'lessonHi', { force: true });
    this.lineAt = 2.8;
    this.seal.emote('wave', 1.4);
    return true;
  }

  // [tut16] The replayed lesson is over (done) or was stopped from Settings.
  endLesson(done = false) {
    if (!this.active || this.mode !== 'lesson') return;
    const g = this.game, L = this.lessonState();
    L.active = false; L.step = null;
    if (done) L.done = true;
    this.active = false;
    this.lesson = null;
    this.step = 'done';
    this.mode = 'full';
    g.tutorialActive = false;
    try { if (!done && g.fishing?.busy) g.fishing.releaseFish(false); } catch (e) { /* optional */ }
    if (!done) this.dlg.clear();
    this.guide.key = null;
    g.save?.();
  }

  // Bubbles swims in from the left edge after the opening
  enterSeal() {
    const S = this.seal, { H } = this.game.screen;
    S.size = this.sealSize();
    S.goTo(-S.size * 2, H * 0.5, { snap: true });
    this.guide.show = 0;
    try { warmSeal(S.size, ['idle', 'swim', 'point']); } catch (e) { /* optional */ }
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
  guideMood() { const m = this.game.state?.clip?.mood; return m === 'smug' || m === 'surprised' ? m : 'happy'; }

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
    this.lesson = null;
    this.mode = 'full';
    { const L = this.lessonState(); L.offered = true; L.active = false; } // skipping everything: no lesson offer later
    try { BAIT.ensureBait(g.state); if (this.baitCount() <= 0) BAIT.addBait(g.state, START_BAIT, 10); } catch (e) { /* bait module optional */ }
    if (g.ui) g.ui.stack = [];
    try { g.audio?.setMusic?.(g.musicFor?.()); } catch (e) { /* optional */ }
    g.save?.();
    this.finished(true);
  }

  // the tutorial is over: quest lines (and anyone else) may start
  finished(skipped = false) {
    if (this.doneSent) return;
    this.doneSent = true;
    try { this.game.emit?.('tutorialDone', { skipped }); } catch (e) { console.warn('tutorialDone listener', e); }
  }

  go(step) {
    const prev = this.step;
    this.step = step;
    this.t = 0;
    this.lineAt = null;
    if (!FIGHT_STEPS.includes(step)) this.lesson = null;
    this.enter(step, prev);
    this.persist(step, prev);
  }

  // [tut16] save the step (a reload resumes there) and the fight steps already learnt
  persist(step, prev) {
    const g = this.game, st = g.state, L = this.lessonState();
    if (FIGHT_STEPS.includes(prev) && prev !== step && (FIGHT_STEPS.includes(step) || step === 'card')) L.stages[prev] = true;
    if (this.mode === 'full' && step !== 'intro') st.tutorialStep = step;
    if (LESSON_STEPS.includes(step)) L.step = step;
    if (step === 'card') { L.done = true; L.offered = true; }
    if (step !== 'intro') g.save?.();
  }

  // the first fight step not learnt yet (a resumed lesson skips the ones already done)
  firstFightStep() {
    const S = this.lessonState().stages;
    return FIGHT_STEPS.find((s) => !S[s]) || 'land';
  }

  // Bubbles says a line (typed, with voice blips); the same key is not repeated.
  say(key, opts = {}) {
    const G = this.guide;
    if (G.key === key && !opts.force) return;
    const s = SAY[key] || { text: String(key) };
    G.key = key;
    G.line = s;
    this.dlg.vars.name = this.anglerName();
    const mood = this.guideMood() === 'smug' && s.mood === 'happy' ? 'smug' : s.mood;
    this.dlg.now(s.text, {
      mood, pose: s.pose, big: s.big, silent: opts.silent, hold: s.choices || s.stay ? 0 : opts.hold ?? 6, cps: 46,
      choices: s.choices, autoPick: s.choices ? (key === 'done' ? 9 : 20) : undefined,
      onChoose: (c) => this.onChoose(key, c),
      onShow: () => { const e = EMOTE[s.pose]; if (e && !opts.silent) this.seal.emote(e[0], e[1]); },
    });
  }

  onChoose(key, c) {
    const st = this.game.state;
    if (key === 'done') { (st.clip ||= {}).hints = c.value !== false; this.game.save?.(); }
    this.seal.emote(c.mood === 'love' ? 'spin' : 'clap', c.mood === 'love' ? undefined : 1.2);
    const A = this.seal.anchors;
    this.game.particles?.aeroConfetti?.(A?.top?.[0] ?? this.seal.x, A?.top?.[1] ?? this.seal.y - 30, 10, { layer: 'ui' });
  }

  pop(text, palette = 'aqua', o = {}) {
    // (a step title replaces the one before it)
    if (o.step) this.pops = this.pops.filter((p) => !p.step);
    this.pops.push({ text, palette, t0: (this.game.time ?? 0) + (o.delay || 0), step: !!o.step, sound: false });
  }

  // Which HUD buttons may show (the HUD asks this; alias ids are asked too).
  dockVisible(id) {
    if (!this.active) return this.game.state.tutorialDone ? true : !this.intro;
    if (this.step === 'done' || this.step === 'lessonDone') return true;
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
    const over = !!(h && inp.x >= h.x && inp.y >= h.y && inp.x < h.x + h.w && inp.y < h.y + h.h);
    // game.js asks this before anything else uses the pointer: latch a click on the helper here, so a busy line
    // (a bite or fight takes the pointer first) cannot swallow it
    if (over && inp.pressed && !this.active && !this.offering) this.helperClick = true;
    return over;
  }
  boxVisible() { return !this.intro; }
  boxOffset() { return 0; }

  // What kind of fishing minigame is running (the Fishing agent's 3D gear, hold-to-charge shock), feature-detected.
  fishingKind() {
    const f = this.game.fishing, B = f?.battle;
    return {
      gear: !!(f && (f.gear?.lay || 'hs' in f)),
      hold: !!(B && ('chargeWin' in B || 'canCharge' in B)),
    };
  }

  // ---------------------------------------------------------------- step entry
  enter(step, prev) {
    const g = this.game;
    const st = g.state;
    const K = this.fishingKind();
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
        this.podT = prev === 'bait' && this.iconRect('bait-slot') ? 2.2 : 0;
        // tidy up: the shop panel would sit over the water
        if (g.ui?.isOpen?.('baitshop')) setTimeout(() => { if (this.step === 'cast' && g.ui?.isOpen?.('baitshop')) g.ui.close('baitshop'); }, 900);
        this.say(FISHING_STEPS.includes(prev) && prev !== 'cast' ? 'again' : this.podT ? 'loaded' : 'cast');
        this.castPop = !FISHING_STEPS.includes(prev); // the CAST! title once per attempt series
        if (this.castPop && !this.podT) this.stepPop('cast');
        break;
      case 'wait':
        this.say('wait');
        break;
      case 'hook':
        this.say(K.gear ? 'hookGear' : 'hook');
        this.stepPop('hook');
        this.seal.emote('wiggle', 0.6);
        g.audio?.play?.('bite', { vol: 0.5 });
        break;
      case 'reel': case 'ease': case 'surge': case 'zap': case 'land': {
        // [tut16] a fight step: a calm intro beat (the fish holds, the world dims), then the step goes live
        const B = g.fishing?.battle;
        this.fightT = 0;
        this.lesson = {
          stage: step, hold: LESSON_HOLD[step] + (step === 'reel' && prev !== 'reel' ? 0.9 : 0), cap: LESSON_CAP[step],
          floor: Math.max(-0.05, (B?.progress ?? 0) - 0.04), spike: 0, calmT: 0, won: false, stunned: false, miss: 0, missSeen: 0,
          surgeStarted: false, t: 0,
        };
        this.say({ reel: 'reel', ease: 'easeIntro', surge: 'surgeIntro', zap: 'zap', land: 'land' }[step]);
        // the reel title waits for the fishing HUD's FISH ON!
        this.stepPop(step, step === 'reel' && ['hook', 'wait', 'cast'].includes(prev) ? 1.9 : 0);
        if (FIGHT_STEPS.includes(prev)) this.cheer();
        break;
      }
      case 'card':
        this.say(this.mode === 'lesson' ? 'cardLesson' : 'card'); // (the catch card is its own big 3D celebration)
        this.seal.emote('flop');
        break;
      case 'lessonDone':
        this.say('lessonDone');
        this.pop('GO FISH!', 'aqua', { delay: 0.8 });
        this.seal.emote('spin');
        g.audio?.play?.('ui_unlock', { vol: 0.6 });
        g.particles?.aeroConfetti?.(g.screen.W / 2, g.screen.H * 0.3, 40, { layer: 'ui' });
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
        this.seal.emote('spin');
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
    this.seal.emote('clap', 1.2);
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
    const A = this.seal.anchors;
    g.particles?.aeroConfetti?.(A?.hand?.[0] ?? this.seal.x, A?.hand?.[1] ?? this.seal.y, 16, { layer: 'ui' });
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
    if (!this.active || !FISHING_STEPS.includes(this.step)) return false;
    const g = this.game;
    this.go('card');
    // the first session keeps its first fish (Keep only); a replayed lesson offers Keep or Release
    if (g.ui?.panels?.reveal) { g.ui.open('reveal', { ...data, tutorial: this.mode === 'full' }); return true; }
    // no catch card: keep it and move on
    try { g.keepFish?.(data.rec); } catch (e) { /* ignore */ }
    this.go(this.mode === 'lesson' ? 'lessonDone' : 'tank');
    return true;
  }

  onEscape() {
    const steps = FISHING_STEPS.filter((s) => s !== 'cast');
    if (!this.active || !steps.includes(this.step)) return;
    this.fishTries++;
    this.seal.emote('worried', 1.2);
    setTimeout(() => { if (this.active && steps.includes(this.step)) this.go('cast'); }, 700);
  }

  // [tut16] a step done: a little cheer (sparkles at Bubbles, a chime)
  cheer() {
    const g = this.game, A = this.seal.anchors;
    g.particles?.aeroConfetti?.(A?.top?.[0] ?? this.seal.x, A?.top?.[1] ?? this.seal.y - 30, 12, { layer: 'ui' });
    g.audio?.play?.('timing_perfect', { vol: 0.35, pitch: 1.3 });
    this.seal.emote('clap', 0.9);
  }

  // [tut16] the step's big 3D title (after `delay` s)
  stepPop(step, delay = 0) {
    const p = LESSON_POP[step];
    if (p) this.pop(p[0], p[1], { delay, step: true });
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    const now = g.time ?? 0;
    this.pops = this.pops.filter((p) => now - p.t0 < (p.step ? 2.4 : 1.9));
    for (const p of this.pops) if (!p.sound && now >= p.t0) { p.sound = true; try { g.audio?.play?.('sparkle', { vol: 0.5 }); } catch (e) { /* optional */ } }
    if (!this.active) { this.updateHelper(dt); this.updateOffer(dt); return; }
    this.t += dt;
    this.dotAnim += dt;
    const G = this.guide;
    if (this.intro) {
      const { W, H } = g.screen;
      if (this.intro.W !== W || this.intro.H !== H) this.intro.resize(W, H);
      this.intro.update(dt);
      return;
    }
    // Bubbles' speech: response bubbles take clicks and keys 1/2/3 only while they are showing
    const inp = g.input;
    const over = this.dlg.choosing && this.capturesInput();
    this.dlg.update(dt, inp, { mouse: over, keys: this.dlg.choosing });
    const f = g.fishing;
    const K = this.fishingKind();
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
        // (a replay / resume greets first, then explains the cast)
        if (this.lineAt != null && this.t > this.lineAt) { this.lineAt = null; this.say('cast', { force: true }); if (this.castPop) this.stepPop('cast'); }
        if (this.podT && this.t > this.podT && G.key === 'loaded') { this.say('cast'); if (this.castPop) this.stepPop('cast'); }
        if ((g.state.stats?.casts || 0) > this.castBase || (f && f.state !== 'idle') || (this.t > 1.2 && f?.wasInWater)) this.go('wait');
        break;
      case 'wait':
        if (f?.state === 'bite') this.go('hook');
        else if (f?.state === 'fight') this.go(this.firstFightStep());
        else if (f?.state === 'nibble') this.say('nibble', { silent: true });
        else if ((G.key === 'nibble' || G.key === 'missed') && this.t > 1.6 && !this.dlg.typing) this.say('wait', { silent: true, force: G.key !== 'wait' });
        if (f && !f.wasInWater && f.state === 'idle') { this.outT = (this.outT || 0) + dt; if (this.outT > 1.5) { this.outT = 0; this.go('cast'); } } else this.outT = 0;
        break;
      case 'hook':
        if (f?.state === 'fight') this.go(this.firstFightStep());
        else if (f && f.state !== 'bite' && this.t > 0.2) { this.go('wait'); this.say('missed'); this.seal.emote('worried', 1); }
        break;
      case 'reel': case 'ease': case 'surge': case 'zap': case 'land':
        this.updateLesson(dt, f);
        break;
      case 'card':
        if (this.t > 1 && !g.ui?.isOpen?.('reveal')) this.go(this.mode === 'lesson' ? 'lessonDone' : 'tank');
        break;
      case 'lessonDone':
        if (this.t > 4.2 && !this.dlg.typing) this.endLesson(true);
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
        if (this.t > 3.6 && !this.dlg.choosing && !this.dlg.active) { this.active = false; this.guide.key = null; this.finished(); }
        else if (this.t > 30) { this.active = false; this.dlg.clear(); this.finished(); }
        break;
      default: break;
    }
    if (this.active) this.steer(dt);
  }

  // [tut16] The fight steps of the lesson: each waits for the player to do it.
  updateLesson(dt, f) {
    const L = this.lesson, B = f?.battle;
    this.fightT += dt;
    if (!f || (f.state === 'idle' && !f.cine)) { if (this.t > 2) this.go('cast'); return; } // it got away
    if (!L || f.state !== 'fight' || !B) return; // (landing: the catch moves on)
    if (L.hold > 0) {
      L.hold -= dt;
      if (L.hold <= 0) this.lessonLive(L, B);
      return;
    }
    L.t += dt;
    switch (L.stage) {
      case 'reel':
        if (B.progress >= L.cap - 0.025) this.go('ease');
        break;
      case 'ease': {
        if (L.spike > 0) { L.spike -= dt; if (L.spike <= 0) this.say('ease'); break; }
        const calm = B.tension < 0.5 && f.gear.rpm <= B.band.hi + 5;
        L.calmT = calm ? L.calmT + dt : Math.max(0, L.calmT - dt * 0.6);
        if (L.calmT > 1.1) this.go('surge');
        else if (B.tension > 0.75 && this.guide.key === 'ease' && L.t > 3) this.say('easeTight', { silent: true });
        else if (B.tension < 0.5 && this.guide.key === 'easeTight' && L.t > 2.4) this.say('ease', { silent: true });
        break;
      }
      case 'surge':
        if (L.won) this.go('zap');
        else if (B.mode === 'surge' && this.guide.key !== 'surgeGo') this.say('surgeGo');
        break;
      case 'zap':
        if (L.stunned) this.go('land');
        else if (L.miss !== L.missSeen) { L.missSeen = L.miss; this.say('zapMiss', { force: true }); this.seal.emote('worried', 0.8); }
        break;
      default: break;
    }
    if ((f.tension ?? 0) > 0.88 && !this.seal.emoteA) this.seal.emote('worried', 0.5);
  }

  // the step's intro beat is over: it goes live
  lessonLive(L, B) {
    const g = this.game;
    if (L.stage === 'ease') {
      L.spike = 1.4; // the fish digs in: the line goes tight
      this.say('easeTight');
      this.seal.emote('worried', 1);
      g.audio?.play?.('slack_warn', { vol: 0.5 });
      g.camera?.shake?.(3);
    } else if (L.stage === 'surge') {
      this.say('surgeGo');
    } else if (L.stage === 'zap') {
      // a charge ready to go (a rod without one borrows one for the lesson)
      B.shockMax = Math.max(1, B.shockMax || 0);
      B.charges = Math.max(1, B.charges || 0);
      B.shockCd = 0;
    }
  }

  // [tut16] Older saves that finished the tutorial before the lesson existed: Bubbles offers it once. A replay that
  // was running when the page closed resumes.
  updateOffer(dt) {
    const g = this.game, st = g.state;
    if (!st?.tutorialDone || this.intro) return;
    this.bootT += dt;
    const L = this.lessonState();
    if (L.active && !this.resumed) { if (this.bootT > 1.2 && !g.fishing?.busy) { this.resumed = true; this.startLesson('resume'); } return; }
    if (this.offering) {
      this.offerT += dt;
      // no answer for a long while: Bubbles lets it go (the lesson stays in Settings)
      if (this.offerT > 30 && this.dlg.choosing) { this.dlg.clear(); this.offering = false; }
      else if (!this.dlg.active && this.offerT > 2) this.offering = false;
      return;
    }
    if (L.done || L.offered) return;
    if (this.bootT < 7 || g.fishing?.busy || g.ui?.active || st.view !== 'ocean' || g.ocean?.travelState || this.dlg.active) return;
    this.offering = true;
    this.offerT = 0;
    L.offered = true;
    g.save?.();
    this.dlg.vars.name = this.anglerName();
    const s = SAY.offer;
    this.dlg.now(s.text, {
      mood: s.mood, pose: s.pose, hold: 0, cps: 46, choices: s.choices,
      onChoose: (c) => {
        this.onChoose('offer', c);
        if (c.value) setTimeout(() => { this.offering = false; this.startLesson('offer'); }, 1500);
      },
    });
    this.seal.emote('wave', 1.6);
  }

  // Swim Bubbles to the perch for the current target and point at it.
  steer(dt) {
    const g = this.game, S = this.seal;
    const tg = this.target();
    this.tg = tg;
    const want = this.sealSize();
    if (want !== S.size) S.size = want;
    const [px, py] = this.perch(tg);
    S.goTo(px, py);
    S.pointAt(tg.aim || null);
    const inp = g.input;
    S.update(dt, { W: g.screen.W, H: g.screen.H, cursor: inp ? [inp.x, inp.y] : null, talk: this.dlg.typing, excited: this.dlg.mood === 'excited', fast: FIGHT_STEPS.includes(this.step) || this.step === 'hook' });
  }

  // ---------------------------------------------------------------- the hint helper (after the tutorial)
  helperOn() {
    const st = this.game.state;
    if (this.offering && !this.intro && st.view !== 'aquarium') return true; // [tut16] the lesson offer
    return !!st?.tutorialDone && !this.intro && st.clip?.hints !== false && st.settings?.hints !== false && st.view !== 'aquarium';
  }

  helperRect() {
    if (this.active || !this.helperOn()) return null;
    if (this.helper.show < 0.05 && !this.seal.anchors) return this.homeRect();
    const r = this.seal.rect(), m = 6; // a forgiving click target
    return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
  }

  // where the helper rests: the bottom right edge (the left edge while a fight needs the corner)
  helperHome() {
    const { W, H } = this.game.screen, S = this.seal, u = S.size / 40;
    const f = this.game.fishing;
    if (f?.fighting || f?.state === 'bite') return [Math.round(56 * u), Math.round(H * 0.42)];
    let top = H;
    try { top = this.game.hud?.topY?.() ?? H; } catch (e) { top = H; }
    return [W - Math.round(58 * u), Math.min(H - Math.round(110 * u), top - Math.round(34 * u))];
  }
  homeRect() { const [x, y] = this.helperHome(), s = this.seal.size; return { x: x - s * 1.1, y: y - s * 0.8, w: s * 2.2, h: s * 1.7 }; }

  updateHelper(dt) {
    const g = this.game, Hh = this.helper, S = this.seal;
    const on = this.helperOn();
    Hh.show = clamp01(Hh.show + (on ? dt : -dt) * 3);
    Hh.t += dt;
    Hh.open = Math.max(0, Hh.open - dt);
    if (!on) { if (this.dlg.active && !this.active) this.dlg.clear(); if (Hh.show <= 0) { S.anchors = null; } return; }
    const choosing = this.dlg.choosing; // [tut16] (the lesson offer's response bubbles)
    this.dlg.update(dt, g.input, { mouse: choosing && this.capturesInput(), keys: choosing });
    // swim: to the button the tip is about while it talks, then home
    S.size = sealSize(this.sealSize() * 0.85);
    let spot = this.helperHome(), aim = null;
    if (Hh.at && this.dlg.active) {
      const r = this.iconRect(Hh.at);
      if (r) { const tg = { rect: r, aim: [r.x + r.w / 2, r.y + r.h / 2] }; spot = this.perch(tg); aim = tg.aim; }
    } else Hh.at = null;
    if (Hh.show < 0.05 && !S.anchors) S.goTo(spot[0] + S.size * 2.5, spot[1], { snap: true });
    if (this.offering) { const { W, H } = g.screen; spot = [W - Math.round(S.size * 2.4), Math.round(H * 0.5)]; } // [tut16] asks from the middle right
    S.goTo(spot[0], spot[1]);
    S.pointAt(aim);
    const inp = g.input;
    S.update(dt, { W: g.screen.W, H: g.screen.H, cursor: inp && !this.helperHover ? [inp.x, inp.y] : null, talk: this.dlg.typing, noShy: true });
    const r = this.helperRect();
    this.helperHover = !!(r && inp && inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h);
    const click = !this.offering && (this.helperClick || (this.helperHover && inp?.pressed));
    this.helperClick = false;
    if (click) {
      inp?.consume?.();
      this.dlg.vars.name = this.anglerName();
      const tip = this.hintTip();
      Hh.at = tip.at && this.iconRect(tip.at) ? tip.at : null;
      this.dlg.now(tip.text, { mood: tip.mood || 'happy', pose: 'talk', hold: 4.5, cps: 50 });
      if (!Hh.at) S.emote(tip.mood === 'excited' ? 'wiggle' : 'wave', 1.2);
      Hh.open = 5;
      g.audio?.play?.('ui_click', { vol: 0.4, pitch: 1.3 });
    }
  }

  // a tip that fits the moment
  hintTip() {
    const g = this.game, f = g.fishing, st = g.state, K = this.fishingKind();
    if (f?.fighting || f?.state === 'fight') return { text: K.gear ? 'Spin the gear! Hold, let go = ZAP!' : 'Circle to reel! Space = Shock!', mood: 'excited' };
    if (f?.state === 'bite') return { text: K.gear ? 'Spin the gear, {name}!' : 'Click now, {name}!', mood: 'excited' };
    let bait = 1;
    try { bait = BAIT.totalBait(st); } catch (e) { bait = 1; }
    if (bait <= 0) return { text: "Out of bait? Visit Dot's Bait Shop!", at: 'baitshop' };
    // [balance] every other tip: the next big upgrade (rod / tank / boat) and what it still needs
    if (this.helper.tipI % 2 === 0) { const gt = this.goalTip(); if (gt) { this.helper.tipI++; return gt; } }
    for (let n = 0; n < TIPS.length; n++) {
      const tip = TIPS[this.helper.tipI++ % TIPS.length];
      if (tip.at === 'quests' && !this.iconRect('quests')) continue;
      return tip;
    }
    return TIPS[0];
  }
  hintText() { return this.hintTip().text; }
  goalTip() {
    let gl = null;
    try { gl = LAB.labGoal?.(this.game.state); } catch (e) { gl = null; }
    if (!gl || gl.status !== 'available') return null;
    const need = LAB.labGoalNeed?.(this.game.state, gl) || '';
    return need ? { text: `Next goal: the ${gl.node.name}! ${need}`, at: 'lab' } : { text: `You can research the ${gl.node.name}! Open The Lab!`, at: 'lab', mood: 'excited' };
  }

  // ---------------------------------------------------------------- targets
  // screen point of a world point (the follow camera), identity without a camera
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

  // the fishing gear / reel UI on screen (the Fishing agent's 3D gear, or the older reel), feature-detected
  gearRect() {
    const f = this.game.fishing;
    try {
      const r = f?.gear?.rect?.() || f?.gearRect?.();
      if (r && Number.isFinite(r.x)) return r;
      const L = (f?.gear || f?.reel)?.lay;
      if (L && Number.isFinite(L.cx)) return { x: L.cx - L.R, y: L.cy - L.R, w: L.R * 2, h: L.R * 2 };
    } catch (e) { /* none */ }
    return null;
  }

  // [tut16] a gear HUD part on screen (gear.js partRect), else the whole gear
  partRect(kind) {
    const f = this.game.fishing;
    try { const r = f?.gear?.partRect?.(kind, f.battle); if (r && Number.isFinite(r.x)) return r; } catch (e) { /* older gear */ }
    return null;
  }

  // a box around the hooked fish on screen (sized by its length at the current zoom)
  fishBox(p) {
    const F = this.game.fishing;
    let len = 40;
    try { len = clamp((F.fishLen?.() ?? 30) * (F.zoom?.() ?? 1), 30, 220); } catch (e) { len = 40; }
    const w = Math.round(len * 1.1 + 16), h = Math.round(len * 0.6 + 16);
    return { x: Math.round(p[0] - w / 2), y: Math.round(p[1] - h / 2), w, h };
  }

  // the hooked fish on screen
  fishPoint() {
    const B = this.game.fishing?.battle;
    const fish = B?.fish || this.game.fishing?.fish;
    if (fish && Number.isFinite(fish.x)) return this.ws(fish.x, fish.y);
    return null;
  }

  // What Bubbles explains now: {rect | point, aim (where the flipper points), edge (rest at a screen edge),
  // avoid [rects the speech bubble keeps clear of], small / bang (pointer ring style), noRing}
  target() {
    const g = this.game;
    const f = g.fishing;
    const ctr = (r) => [r.x + r.w / 2, r.y + r.h / 2];
    const R = (r, o = {}) => (r ? { rect: r, aim: ctr(r), avoid: [r], ...o } : { edge: true });
    switch (this.step) {
      case 'bait': {
        if (this.giftAt != null || !this.hasShop()) return { edge: true };
        const P = g.ui?.panels?.baitshop;
        if (g.ui?.isOpen?.('baitshop') && P) {
          const sel = P.sel?.bait === START_BAIT && P.tab !== 'lines';
          const r = sel && P.buyRect ? P.buyRect : P.offerRect?.(START_BAIT);
          const pr = P.rect || P.panelRect || null;
          return r ? { rect: r, aim: ctr(r), avoid: [r, pr].filter(Boolean), outside: pr } : { edge: true };
        }
        return R(this.iconRect('baitshop'));
      }
      case 'cast': {
        if (this.podT && this.t < this.podT) { const r = this.iconRect('bait-slot') || this.iconRect('gear'); if (r) return R(r); }
        const p = this.waterSpot();
        return { point: p, aim: p, avoid: [{ x: p[0] - 24, y: p[1] - 24, w: 48, h: 48 }], ghost: true };
      }
      case 'wait': case 'hook': {
        const h = f?.hook;
        if (this.step === 'hook' && this.fishingKind().gear) {
          const gr = this.gearRect();
          // rest at the far screen edge and point at the gear, so Bubbles never covers its dial
          if (gr) return { edge: true, aim: ctr(gr), action: ctr(gr), avoid: [gr], noRing: true, hl: [gr] };
        }
        if (h?.visible) {
          const p = this.ws(h.x, h.y);
          const zone = { x: p[0] - 30, y: p[1] - 30, w: 60, h: 60 };
          // after explaining, rest at the edge so the fish can find the lure; keep pointing at it
          // (the left edge: the gear flips in at the bottom right when it bites)
          if (this.step === 'wait' && this.t > 3.5) return { edge: true, side: -1, aim: p, action: p, avoid: [zone], ring: p, small: true };
          return { point: p, aim: p, small: this.step === 'wait', bang: this.step === 'hook', avoid: [zone] };
        }
        const p = this.waterSpot();
        return { point: p, aim: p };
      }
      case 'reel': case 'ease': case 'surge': case 'zap': case 'land': {
        // [tut16] rest at the edge (the action owns the middle); bracket and point at what this step is about
        const gr = this.gearRect(), fp = this.fishPoint();
        const fr = fp && this.fishBox(fp);
        const part = this.partRect({ ease: 'tension', zap: 'shock' }[this.step] || 'gauge');
        let hl = part || gr, aim = hl ? ctr(hl) : fp;
        if (this.step === 'surge' && fr) { hl = fr; aim = fp; }
        if (this.step === 'zap' && part && gr) hl = part; // the bolt orbs (the charge ring then shows on the gear)
        return { edge: true, aim, avoid: [gr, part, fr].filter(Boolean), action: fp, noRing: true, hl: hl ? [hl] : [] };
      }
      case 'card': {
        // the catch card's Keep orb (reveal.js draws it at the card's bottom right in the tutorial)
        const r = g.ui?.isOpen?.('reveal') ? g.ui.panels?.reveal?.rect : null;
        if (r && Number.isFinite(r.x)) {
          // (reveal.js lays the card out on a 470 x 304 grid scaled by w / 470: Keep at the right, or Keep + Release)
          const w = r.w || 470, h = r.h || 304, q = w / 470, both = this.mode === 'lesson';
          const k = { x: r.x + w - (both ? 118 : 68) * q, y: r.y + h - 52 * q, w: (both ? 94 : 44) * q, h: 44 * q };
          return { rect: k, aim: ctr(k), avoid: [r], outside: r, noRing: true, hl: [k] };
        }
        return { edge: true };
      }
      case 'tank': case 'coin': {
        const r = g.aquarium?.windowRect?.() || null;
        const hint = g.aquarium?.hintPoint?.();
        if (!r) return { edge: true };
        return { rect: r, aim: hint || ctr(r), avoid: [r], outside: r, noRing: this.step === 'tank' };
      }
      case 'lab': return R(this.iconRect('lab'));
      case 'research': {
        const P = g.ui?.panels?.lab;
        let r = null;
        try {
          const planned = P?.rows?.plan?.includes?.(this.researchId);
          r = (planned && P.confirmRect) || P?.tileRect?.(this.researchId) || P?.nodeRect?.(this.researchId) || null;
          if (r && !Number.isFinite(r.x)) r = null;
        } catch (e) { r = null; }
        const pr = P?.rect || null;
        if (r) return { rect: r, aim: ctr(r), avoid: [r, pr].filter(Boolean), outside: pr };
        return { edge: true, avoid: pr ? [pr] : [] };
      }
      case 'done': case 'lessonDone': return { edge: true, center: true };
      default: return { edge: true };
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

  // Where Bubbles floats for target tg: beside the target (its flipper reaching toward it), on screen with room for
  // its speech bubble, clear of the target, preferring sideways / downward points, the screen edges and the spot
  // it already has (no dithering). tg.edge: rest at the left or right edge, away from the action.
  perch(tg) {
    const { W, H } = this.game.screen, S = this.seal, s = S.size, u = s / 40;
    const mx = 62 * u, top = 96 * u, bot = H - 64 * u;
    const key = this.step + '|' + (tg.rect ? Math.round(tg.rect.x / 24) + ',' + Math.round(tg.rect.y / 24) : tg.point ? 'p' : 'e');
    if (tg.edge || (!tg.rect && !tg.point)) {
      const act = tg.action || tg.aim;
      let side = this.edgeSide ?? (S.x < W / 2 ? -1 : 1);
      if (act) side = act[0] > W * 0.55 ? -1 : act[0] < W * 0.45 ? 1 : side;
      const gr = tg.avoid?.[0];
      if (gr && gr.x > W * 0.6 && side > 0) side = -1;
      if (tg.side) side = tg.side;
      this.edgeSide = side;
      if (tg.center) return [W * 0.5 + side * W * 0.18, H * 0.42];
      const y = clamp(act ? act[1] - 40 * u : H * 0.45, top + 20 * u, bot - 30 * u);
      return [side < 0 ? mx : W - mx, y];
    }
    const P = tg.rect ? [tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2] : tg.point;
    const rad = tg.rect ? Math.max(tg.rect.w, tg.rect.h) / 2 : tg.small ? 10 : 18;
    const D = rad + (tg.far ? 110 : 70) * u;
    const out = tg.outside;
    const cands = [-155, -25, 180, 0, -125, -55, 150, 30].map((deg, i) => {
      const a = (deg * Math.PI) / 180;
      let x = P[0] + Math.cos(a) * D * 1.15, y = P[1] + Math.sin(a) * D * 0.8;
      // a target inside a panel: perch just outside the panel's edge on that side
      if (out) {
        if (Math.cos(a) < -0.3) x = Math.min(x, out.x - 48 * u); else if (Math.cos(a) > 0.3) x = Math.max(x, out.x + out.w + 48 * u);
      }
      let score = 0;
      const cx = clamp(x, mx, W - mx), cy = clamp(y, top, bot);
      score += (Math.abs(cx - x) + Math.abs(cy - y)) * 4;
      x = cx; y = cy;
      const box = { x: x - s * 1.25, y: y - s * 0.85, w: s * 2.5, h: s * 1.6 };
      for (const r of tg.avoid || []) if (r && box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y) score += 400;
      const e = Math.atan2(-(P[1] - y), Math.abs(P[0] - x) + 1);
      if (e > 0.35) score += (e - 0.35) * 160;
      score += Math.hypot(S.x - x, S.y - y) * 0.08;
      score += Math.min(x, W - x) * 0.04;
      if (key === this.perchKey && i === this.perchI) score -= 60;
      return { x, y, i, score };
    });
    cands.sort((a, b) => a.score - b.score);
    const best = cands[0];
    this.perchKey = key; this.perchI = best.i;
    return [best.x, best.y];
  }

  // ---------------------------------------------------------------- drawing
  drawWorld() {}

  drawUi(ctx) {
    if (this.intro) { this.intro.draw(ctx); return; }
    this.drawPops(ctx);
    if (!this.active) { this.drawHelper(ctx); return; }
    const g = this.game, G = this.guide, t = this.t;
    const tg = this.tg || this.target();
    this.drawSoften(ctx, tg);
    this.drawDots(ctx);
    if (this.step === 'card' && !g.ui?.isOpen?.('reveal')) return;
    // the target: bouncing pixel focus brackets (the seal's flipper is the arrow)
    if (!tg.noRing) {
      if (tg.rect) this.drawPointer(ctx, tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2, Math.max(tg.rect.w, tg.rect.h) * 0.6, false);
      else if (tg.point || tg.ring) { const p = tg.point || tg.ring; this.drawPointer(ctx, p[0], p[1], tg.small ? 10 : tg.ghost ? 26 : 18, false, tg.bang); }
    }
    // [tut16] the HUD part this step is about: pixel brackets hugging its rect
    for (const r of tg.hl || []) this.drawHighlight(ctx, r);
    if (tg.ghost) this.drawCastGhost(ctx, tg.point);
    if (FIGHT_STEPS.includes(this.step)) this.drawFightCue(ctx);
    G.show = Math.min(1, G.show + (1 / 60) * 2.5);
    const fade = this.step === 'done' ? 1 - clamp01((t - 30) / 0.8) : 1;
    const a = fade;
    if (a <= 0.01) return;
    this.drawSealAndSpeech(ctx, a, tg, { maxW: Math.round(230 * this.dlg.fontSize / 16) });
  }

  // [tut16] pixel focus brackets around a rect (thicker on the big 1280-wide canvas), with a sparkle
  drawHighlight(ctx, r) {
    const t = this.t, W = this.game.screen.W;
    const k = W >= 1200 ? 2 : 1;
    AE.drawPixelBrackets?.(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, t, { gap: 2 * k, bounce: true, k });
    if (Math.sin(t * 4) > 0.4) AE.drawSparkle?.(ctx, r.x + r.w + 4, r.y - 4, 2, 1);
  }

  // [tut16] During a lesson step's intro beat the world softens: a light navy dim everywhere except the part
  // being explained (a plain fade, no rings or light effects).
  drawSoften(ctx, tg) {
    const L = this.lesson;
    const want = L && L.hold > 0 ? 1 : 0;
    this.softK = clamp01((this.softK || 0) + (want ? 1 : -1) * (1 / 60) * 3.5);
    if (this.softK <= 0.01) return;
    const { W, H } = this.game.screen;
    ctx.save();
    ctx.fillStyle = rgba('#06223e', 0.3 * this.softK);
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    for (const r of tg?.hl || []) { const m = 6; ctx.rect(r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m); } // holes
    ctx.fill('evenodd');
    ctx.restore();
  }

  // [tut16] the cast: a 3D mouse glides from the boat down into the water spot, again and again
  drawCastGhost(ctx, p) {
    if (!p) return;
    const g = this.game, b = g.boat;
    let from = [p[0] - 60, p[1] - 90];
    try { if (b?.rodTip) { const r = b.rodTip(); const s = this.ws(r[0], r[1]); if (s && Number.isFinite(s[0])) from = [s[0], s[1] + 10]; } } catch (e) { /* default */ }
    const T = 2.2, q = (this.t % T) / T;
    const k = clamp01(q / 0.6), e = 1 - (1 - k) * (1 - k);
    const x = from[0] + (p[0] - from[0]) * e, y = from[1] + (p[1] - from[1]) * e - Math.sin(k * Math.PI) * 18;
    const a = q < 0.08 ? q / 0.08 : q > 0.85 ? (1 - q) / 0.15 : 1;
    const px = Math.round(clamp(36 * (g.screen.H / 540), 32, 60));
    ctx.save();
    ctx.globalAlpha *= clamp01(a) * 0.95;
    drawIcon3d(ctx, k >= 1 ? 'mouse_lit' : 'mouse', Math.round(x + px * 0.35), Math.round(y + px * 0.45), px, Math.sin(this.t * 3) * 0.4);
    ctx.restore();
  }

  // the seal, then its speech bubble (on the side that keeps clear of what it points at), then the glyph
  drawSealAndSpeech(ctx, alpha, tg, o = {}) {
    const g = this.game, S = this.seal, d = this.dlg;
    const A = S.draw(ctx, { t: g.time ?? this.t, talk: d.talk, mood: d.mood || this.guideMood(), lookAt: tg?.aim || null, alpha });
    if (!A || !d.active) return A;
    const r = A.rect;
    const cy = r.y + r.h * 0.42;
    const avoid = [...(tg?.avoid || []), r].filter(Boolean);
    ctx.save();
    ctx.globalAlpha *= alpha;
    const br = d.drawBubble(ctx, A.top[0], A.top[1], {
      maxW: o.maxW, t: g.time, W: g.screen.W, H: g.screen.H, avoid,
      sides: { above: [A.top[0], r.y + 4], below: [A.head[0], r.y + r.h - 2], right: [r.x + r.w - 4, cy], left: [r.x + 4, cy] },
    });
    const ln = this.guide.line;
    if (br && ln?.g && this.active) {
      // the glyph sits on the bubble's far side from the seal (never over its face)
      const R = Math.round(11 * Math.min(1.6, d.fontSize / 16)) + 4;
      const side = d._side;
      if (side === 'right') this.drawGlyph(ctx, ln.g, br.x + br.w + R, br.y + br.h / 2);
      else if (side === 'left') this.drawGlyph(ctx, ln.g, br.x - R, br.y + br.h / 2);
      else this.drawGlyph(ctx, ln.g, br.x + br.w + R, br.y + br.h / 2);
    }
    ctx.restore();
    return A;
  }

  // The hint helper: Bubbles resting on its bubble; its tip in a speech bubble.
  drawHelper(ctx) {
    const Hh = this.helper;
    if (Hh.show <= 0.01) return;
    const S = this.seal;
    if (this.helperHover) {
      const r = S.rect();
      AE.drawAeroGlow?.(ctx, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.6, '#bff4ff', 0.45);
    }
    const aim = Hh.at && this.dlg.active ? this.iconRect(Hh.at) : null;
    const tg = aim ? { aim: [aim.x + aim.w / 2, aim.y + aim.h / 2], avoid: [aim] } : null;
    const A = this.drawSealAndSpeech(ctx, Hh.show, tg, { maxW: Math.round(200 * this.dlg.fontSize / 16) });
    if (A && !this.dlg.active && Math.sin(Hh.t * 2) > 0.2 && this.hintText().startsWith('Out of')) {
      const e = UIC.getUiIcon?.('exclaim');
      if (e) ctx.drawImage(e, Math.round(A.top[0] - e.width / 2), Math.round(A.top[1] - e.height - 4));
    }
  }

  // Big glossy 3D Alagard words popping up at the key moments.
  drawPops(ctx) {
    const g = this.game;
    for (const p of this.pops) {
      const age = (g.time ?? 0) - p.t0;
      if (age < 0) continue;
      const life = p.step ? 2.4 : 1.9;
      const a = clamp01((life - age) / 0.4);
      // [tut16] step titles sit higher, clear of the fishing HUD's FISH ON! / banners
      const y = g.screen.H * (p.step ? 0.13 : 0.24) + (g.screen.H >= 700 ? 10 : 0) - age * (p.step ? 3 : 6);
      drawText3D(ctx, p.text, g.screen.W / 2, y, { t: g.time ?? 0, pop: clamp01(age / 0.45), palette: p.palette, size: 16, px: 1, depth: 4, scale: g.screen.W >= 1200 ? 3 : 2, alpha: a });
    }
  }

  // The fight: an arrow against the surge, drawn at the fish.
  drawFightCue(ctx) {
    const f = this.game.fishing, B = f?.battle;
    if (!B || !B.fish) return;
    const surging = B.mode === 'tele' || B.mode === 'surge' || B.surging;
    if (!surging) return;
    const [x, y] = this.ws(B.fish.x, B.fish.y);
    const dir = (B.mode === 'tele' ? B.teleDir : B.pullDir) ?? B.qte?.dir ?? B.away ?? 0;
    const a = dir + Math.PI; // drag AGAINST the surge
    const t = this.t;
    const pulse = 0.5 + 0.5 * Math.sin(t * 10);
    const L = 34 + pulse * 6;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(a);
    ctx.globalAlpha = B.mode === 'tele' ? 0.55 + 0.45 * pulse : 0.95;
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
    // [phase8:ui] bouncing pixel corner brackets instead of expanding rings
    if (AE.drawFocusBrackets) AE.drawFocusBrackets(ctx, Math.round(x), Math.round(y), Math.round(r), t);
    const ic = (n) => UIC.getUiIcon?.(n);
    if (bang) {
      const e = ic('exclaim');
      const s = 2 + Math.round(Math.abs(Math.sin(t * 9)));
      if (e) ctx.drawImage(e, Math.round(x - (e.width * s) / 2), Math.round(y - r - 10 - e.height * s), e.width * s, e.height * s);
    } else if (arrow) {
      const a = ic('arrow_d');
      if (a) ctx.drawImage(a, Math.round(x - a.width / 2), Math.round(y - r - 14 - a.height + Math.sin(t * 6) * 3));
    }
    if (Math.sin(t * 5) > 0.97) AE.drawSparkle?.(ctx, x + r * 0.7, y - r * 0.7, 2, 1);
  }

  // Little animated glyphs: a mouse circling (crank / gear), the Space key (Shock), a held button (hold / surge).
  drawGlyph(ctx, kind, cx, cy) {
    const t = this.t;
    const ink = AE.AERO?.ink || '#13304e';
    const R = Math.round(11 * Math.min(1.6, this.dlg.fontSize / 16));
    AE.drawGlossOrb?.(ctx, cx, cy, R, '#e8fbff');
    if (kind === 'crank') {
      const rr = R * 0.64;
      ctx.strokeStyle = rgba(ink, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      const a = t * 7;
      for (let i = 0; i < 4; i++) { ctx.fillStyle = rgba('#2fb8e8', 1 - i * 0.22); ctx.fillRect(Math.round(cx + Math.cos(a - i * 0.35) * rr) - 1, Math.round(cy + Math.sin(a - i * 0.35) * rr) - 1, 3, 3); }
      const m = UIC.getUiIcon?.('mouse_l');
      if (m) ctx.drawImage(m, Math.round(cx + Math.cos(a) * rr - m.width / 2), Math.round(cy + Math.sin(a) * rr - m.height / 2));
    } else if (kind === 'key') {
      const w = 30, h = 13, x = Math.round(cx - w / 2), y = Math.round(cy - h / 2 + (Math.sin(t * 8) > 0.6 ? 1 : 0));
      ctx.fillStyle = ink; ctx.fillRect(x, y + 1, w, h);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1, y, w - 2, h - 1);
      ctx.fillStyle = '#d8eefa'; ctx.fillRect(x + 1, y + h - 4, w - 2, 3);
      drawText(ctx, 'SPACE', cx, y + 3, { font: 'small', align: 'center', color: ink });
      if (Math.sin(t * 8) > 0.6) AE.drawSparkle?.(ctx, x + w - 2, y, 2, 1, '#7ff0ff');
    } else if (kind === 'move') {
      // [tut16] the mouse sliding down into the water
      const m = UIC.getUiIcon?.('mouse_l');
      const q = (t * 0.9) % 1, dy = Math.round((q < 0.7 ? q / 0.7 : 1) * R * 0.8 - R * 0.4);
      ctx.fillStyle = rgba('#2fb8e8', 0.8); ctx.fillRect(Math.round(cx - R * 0.6), Math.round(cy + R * 0.35), Math.round(R * 1.2), 2);
      if (m) ctx.drawImage(m, Math.round(cx - m.width / 2), Math.round(cy - m.height / 2 + dy));
    } else if (kind === 'slow') {
      // [tut16] ease off: a little gauge whose needle swings back down into the green
      const rr = R * 0.66, a0 = Math.PI * 0.85, a1 = Math.PI * 2.15;
      ctx.fillStyle = rgba(ink, 0.3);
      for (let i = 0; i <= 12; i++) { const a = a0 + ((a1 - a0) * i) / 12; ctx.fillRect(Math.round(cx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr) - 1, 2, 2); }
      for (let i = 2; i <= 6; i++) { const a = a0 + ((a1 - a0) * i) / 12; ctx.fillStyle = '#5ad84a'; ctx.fillRect(Math.round(cx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr) - 1, 3, 3); }
      const sw = 0.5 + 0.5 * Math.cos(t * 2.4), na = a0 + (a1 - a0) * (0.3 + sw * 0.6);
      ctx.fillStyle = sw > 0.6 ? '#ff5a4a' : ink;
      for (let i = 0; i < 5; i++) ctx.fillRect(Math.round(cx + Math.cos(na) * rr * i / 5) - 1, Math.round(cy + Math.sin(na) * rr * i / 5) - 1, 2, 2);
    } else if (kind === 'hold') {
      const m = UIC.getUiIcon?.('mouse_hold') || UIC.getUiIcon?.('mouse_l');
      const press = (t * 0.8) % 1 < 0.7;
      if (m) ctx.drawImage(m, Math.round(cx - m.width / 2 + (press ? 0 : Math.sin(t * 6) * 2)), Math.round(cy - m.height / 2 + (press ? 1 : 0)));
      if (!press) AE.drawSparkle?.(ctx, cx + R * 0.6, cy - R * 0.6, 2, 1, '#ffe27a');
    }
  }

  // Progress: a row of glossy dots at the top centre.
  drawDots(ctx) {
    const DOTS = this.mode === 'lesson' ? DOTS_LESSON : DOTS_FULL;
    const end = this.step === 'done' || this.step === 'lessonDone';
    const i = end ? DOTS.length : DOTS.indexOf(this.step);
    if (i < 0 || (end && this.t > 2.5)) return;
    const W = this.game.screen.W;
    const k = Math.min(1.6, this.dlg.fontSize / 16);
    const n = DOTS.length, gap = Math.round(11 * k), x0 = Math.round(W / 2 - ((n - 1) * gap) / 2), y = Math.round(14 * k);
    ctx.save();
    AE.drawAeroSurface?.(ctx, x0 - Math.round(10 * k), y - Math.round(7 * k), (n - 1) * gap + Math.round(20 * k), Math.round(14 * k), { tone: 'glass', r: 'pill', gloss: 0.5, glossH: Math.round(6 * k), rim: 0.7, glow: 0.3 });
    const d = Math.round(2 * k);
    for (let q = 0; q < n; q++) {
      const x = x0 + q * gap;
      if (q < i) { ctx.fillStyle = '#5ad84a'; ctx.fillRect(x - d, y - d, d * 2 + 1, d * 2 + 1); ctx.fillStyle = '#d8ffc0'; ctx.fillRect(x - d + 1, y - d, d, 1); }
      else if (q === i) { const p = 1 + Math.round(Math.abs(Math.sin(this.dotAnim * 4))); AE.drawGlossOrb?.(ctx, x, y, (3 + p * 0.5) * k, '#2fd3e8'); }
      else { ctx.fillStyle = 'rgba(19,48,78,0.25)'; ctx.fillRect(x - 1, y - 1, 3, 3); }
    }
    ctx.restore();
  }
}
