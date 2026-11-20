// Quest cinematics [questcine18] (quest PRESENTATION: chapter openings, quest starts, quest / chapter completions,
// reward reveals, "New research unlocked!"). Data and rules stay in src/game/quests.js; this module only stages them.
//
//   new QuestCine(game, hud, art)   (made by src/ui/quests.js, reachable as game.quests.cine)
//     art = {drawPortrait, rewardIcon, npcName, NPC_COL, CHEERS} (shared quest art, no import cycle)
//     .mode()                'full' | 'short' | 'off'  (state.settings.questCine, the Settings "Cutscenes" switch)
//     .enqueue(beat)         beats play one at a time, never overlapping, only when the game is calm (no fight, no
//                            forced fishing lesson, no voyage / dock scene / build mode / open window); they wait otherwise
//     .update(dt, inp)       called by QuestHud.update (after ui.update, so it can hold the Aero counter)
//     .drawLight(ctx)        light beats + reward flights on the HUD (QuestHud.drawHud)
//     .drawOver(ctx)         reward flights / claim pops on top of an open Quest Log (QuestPanel.draw calls it last)
//     .claimFx(q, x, y)      a claim from the Quest Log: rewards fly out of the button into the wallet / satchel
//     .hidesHud()            true while a heavy beat wants the HUD slid away (hud.wantShow asks)
//     .busy() / .pending()   a beat is running / something is queued (tests wait on these)
//     .playChapterNow()      the tracker's chapter pill: play the waiting chapter opening / finale right away
//   CinePanel ('questcine')  the modal, dim-less (cinematic: true) panel that hosts heavy beats: letterbox bars,
//                            the NPC on stage next to the boat (camera.focus), the dialogue box, 3D voxel titles,
//                            quest cards, DONE stamps and the reward reveal. Click = next / fast-forward, Esc = skip.
// Beats:
//   intro   chapter opening (heavy): bars slide in, the camera eases to the boat, the chapter's NPCs make an entrance
//           and deliver the intro lines (typewriter Alagard, babble voice, emotes), the chapter title drops in as 3D
//           voxel letters with the ocean as subtitle, the chapter's quests deal in as cards and the active ones fly
//           into the HUD tracker.            Short: title + cards only.
//   finale  chapter complete (heavy): hit-stop, "CHAPTER COMPLETE!", every main quest card gets a DONE stamp, the
//           chapter reward reveal, the farewell line and a next-ocean teaser; then the next chapter opens.
//   done    main quest complete (heavy in Full: hit-stop, letterbox, the giver pops out of the water cheering, its
//           line, the reward reveal, then the rewards fly into the wallet / satchel; light in Short).
//   start   new main quest / side story (light): the giver pops up with its line and the objective card flies into
//           the tracker. Several starts merge into one beat.
//   lab     'labNodeUnlockedByQuest' {nodeId, questId} (light): "NEW RESEARCH!" over the Lab button, the node icon
//           flies in, pixel focus brackets bounce on the button.
// Art rules: 3D voxel text for every big word (text3d.js), pixel particles only (no light rays, no ring effects).
import { clamp, clamp01, lerp, ease, TAU } from '../core/math.js';
import { mix, shade } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { buildText3D } from '../gfx/text3d.js';
import { alagardReady, loadAlagard } from '../gfx/alagard.js';
import { hiArt } from '../gfx/hires.js';
import { drawAlagard, wrapAlagard, alagardWidth, Dialogue, dialogueFontSize } from '../game/dialogue.js';
import * as NPC from '../gfx/npcs.js';
import { warmSeal, sealSize, drawSoapBubble } from '../gfx/seal.js';
import { aeroSurface, drawAeroGlow, drawSparkle, drawFocusBrackets, drawPixelBrackets, drawAeroCoin } from './aero.js';
import { drawAnimIcon, drawPadlock } from './labrows.js';
import { text3dCanvas } from './pop3d.js';
import { CHAPTERS, CHAPTER_BY_ID, QUEST_BY_ID, ensureQuests, rewardList } from '../game/quests.js';
import { LAB_BY_ID, OCEAN_NAMES } from '../game/lab.js';

const VOICE = { seal: 'fish', fizz: 'tiny', marina: 'clip', dot: 'crab', bloat: 'deep' };
// stage height of each NPC as a fraction of the screen height
const NPC_H = { fizz: 72, marina: 74, dot: 56, bloat: 60 };
const STAGE_H = 0.2;
const HEAVY = { intro: 1, finale: 1, done: 1 };
const backOut = (k) => ease.outBack(clamp01(k));
const k01 = (t, a, d) => clamp01((t - a) / d);

// ------------------------------------------------------------------ 3D voxel lettering (cached rows of letters)
// A row is built letter by letter (text3dCanvas per character, yaw 0) so titles can drop in one letter at a time.
// Rows are prepared over several frames (prepRow yields one letter per call); row() returns null until it is ready.
const ROWS = new Map();
function rowKey(text, o) { return `${text}|${o.palette}|${o.size}|${o.depth}|${o.scale || 1}`; }
function* prepRow(text, o) {
  const key = rowKey(text, o);
  if (ROWS.has(key)) return;
  while (!alagardReady()) { loadAlagard(); yield; }
  const T = buildText3D(text, { size: o.size, px: 1, depth: o.depth, outline: 1, palette: o.palette });
  if (!T) return;
  yield;
  const sc = o.scale || 1;
  const letters = [];
  for (const L of T.letters) {
    const c = text3dCanvas(L.ch, { palette: o.palette, size: o.size, depth: o.depth, yaw: 0, scale: sc });
    if (!c) return;
    letters.push({ c, dx: (L.cx - T.w / 2) * sc, ch: L.ch });
    yield;
  }
  const h = Math.max(1, ...letters.map((l) => l.c.height));
  ROWS.set(key, { letters, w: T.w * sc + 4, h });
  if (ROWS.size > 80) ROWS.delete(ROWS.keys().next().value);
}
function row(text, o) { return ROWS.get(rowKey(text, o)) || null; }
// whole-word 3D sprite (small labels, amounts); prepared by prepWord
const WORDS = new Map();
function* prepWord(text, o) {
  const key = rowKey(text, o);
  if (WORDS.has(key)) return;
  while (!alagardReady()) { loadAlagard(); yield; }
  const c = text3dCanvas(text, { palette: o.palette, size: o.size, depth: o.depth, yaw: 0, scale: o.scale || 1 });
  if (c) WORDS.set(key, c);
  if (WORDS.size > 120) WORDS.delete(WORDS.keys().next().value);
}
function word(text, o) { return WORDS.get(rowKey(text, o)) || null; }
// build it now if it is missing (a one-off cost; most words are prepared ahead)
function wordNow(text, o) { if (!word(text, o) && alagardReady()) { const gen = prepWord(text, o); let r; do { r = gen.next(); } while (!r.done); } return word(text, o); }
function drawWord(ctx, text, o, cx, cy, k = 1, alpha = 1) {
  const c = word(text, o);
  if (!c) return null;
  const w = c.width * k, h = c.height * k;
  if (w < 1 || h < 1) return c;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * alpha;
  ctx.drawImage(c, Math.round((cx - w / 2) * 2) / 2, Math.round((cy - h / 2) * 2) / 2, Math.round(w * 2) / 2, Math.round(h * 2) / 2);
  ctx.globalAlpha = a;
  return c;
}
// letters drop in one by one (a bounce and a squash on landing), then gently bob as a wave
function drawRow(ctx, R, cx, cy, t, o = {}) {
  if (!R) return;
  const st = o.stagger ?? 0.06, dur = o.dur ?? 0.42, drop = o.drop ?? 70;
  const a0 = ctx.globalAlpha;
  R.letters.forEach((L, i) => {
    const k = clamp01((t - i * st) / dur);
    if (k <= 0) return;
    const y = cy - (1 - ease.outBounce(k)) * drop + Math.sin((t - i * st) * 3 + i * 0.6) * (o.bob ?? 1.2) * clamp01(k * 2 - 1);
    // a short squash right after the first touchdown
    const land = clamp01((t - i * st - dur * 0.36) / 0.18);
    const sq = land > 0 && land < 1 ? Math.sin(land * Math.PI) * 0.18 : 0;
    const w = L.c.width * (1 + sq), h = L.c.height * (1 - sq);
    ctx.globalAlpha = a0 * (o.alpha ?? 1) * clamp01(k * 4);
    ctx.drawImage(L.c, Math.round((cx + L.dx - w / 2) * 2) / 2, Math.round((y + L.c.height / 2 - h) * 2) / 2, Math.round(w * 2) / 2, Math.round(h * 2) / 2);
    if (o.onLand && o.fx && !o.fx[o.id + i] && k >= 0.36) { o.fx[o.id + i] = 1; o.onLand(cx + L.dx, y + L.c.height / 2, i); }
  });
  ctx.globalAlpha = a0;
}

// ------------------------------------------------------------------ letterbox bars (deep sea glass, voxel studs)
const BARS = new Map();
function barArt(W, h, top) {
  const key = `${W}|${h}|${top}`;
  let c = BARS.get(key);
  if (c) return c;
  c = hiArt(W, h, (g, w2, h2) => {
    const D = h2 / h;
    const gr = g.createLinearGradient(0, 0, 0, h2);
    if (top) { gr.addColorStop(0, '#020c22'); gr.addColorStop(0.7, '#06204a'); gr.addColorStop(1, '#0d3a74'); }
    else { gr.addColorStop(0, '#0d3a74'); gr.addColorStop(0.3, '#06204a'); gr.addColorStop(1, '#020c22'); }
    g.fillStyle = gr; g.fillRect(0, 0, w2, h2);
    // ordered-dither band of deeper blue (pixel texture, no smooth gloss)
    g.fillStyle = 'rgba(40,120,200,0.18)';
    for (let y = 0; y < h2; y += D) for (let x = (y / D) % 2 ? D : 0; x < w2; x += D * 2) if (((x / D) * 7 + (y / D) * 3) % 5 === 0) g.fillRect(x, y, D, D);
    // the edge facing the action: a bright aqua line, a darker line, then a row of little glossy voxel studs
    const ey = top ? h2 - D : 0;
    g.fillStyle = '#9ff0ff'; g.fillRect(0, ey, w2, D);
    g.fillStyle = '#2a8fe0'; g.fillRect(0, top ? ey - D : ey + D, w2, D);
    const sy = top ? h2 - D * 6 : D * 4, S = D * 2;
    for (let x = D * 6; x < w2 - D * 4; x += D * 14) {
      g.fillStyle = '#0a2a56'; g.fillRect(x - D, sy - D, S + D * 2, S + D * 2);
      g.fillStyle = '#3cb4f0'; g.fillRect(x, sy, S, S);
      g.fillStyle = '#e8fbff'; g.fillRect(x, sy, D, D);
    }
  });
  BARS.set(key, c);
  if (BARS.size > 8) BARS.delete(BARS.keys().next().value);
  return c;
}

// ------------------------------------------------------------------ the director
export class QuestCine {
  constructor(game, hud, art) {
    this.game = game;
    this.hud = hud;
    this.art = art;
    this.queue = [];
    this.cur = null;       // the running beat
    this.t = 0;
    this.calmT = 0;
    this.prep = [];        // warm-up generators (one step per frame while calm)
    this.flights = [];     // rewards flying into the HUD
    this.pops = [];        // claim pops over the Quest Log / HUD
    this.held = 0;         // Aero held back from the counter until its coins land
    this.holdT = 0;
    this.bars = 0;
    this.barsTo = 0;
    this.hudHidden = false;
    this.knownSide = null; // side stories already open (new ones get a start beat)
    this.sideT = 0;
    this.claims = [];      // claimed in the log this frame: flights spawn from the button
    this.box = null;       // light beat dialogue box rect (click = skip)
    this.dlg = new Dialogue({ audio: game.audio, voice: 'fish', name: '' });
    this.scratch = null;
    this.warmIdle();
  }

  mode() {
    const m = this.game.state?.settings?.questCine;
    return m === 'short' || m === 'off' ? m : 'full';
  }
  busy() { return !!this.cur; }
  pending() { return !!this.cur || this.queue.length > 0 || this.flights.length > 0; }
  hidesHud() { return !!this.cur && this.cur.heavy && this.hudHidden; }
  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  // ---------------------------------------------------------------- queue
  enqueue(b, front = false) {
    if (this.mode() === 'off') return false;
    b.heavy = !!HEAVY[b.kind] && !(b.kind === 'done' && this.mode() === 'short');
    // merge starts into one beat; drop starts covered by a chapter opening
    if (b.kind === 'start') {
      const intro = [this.cur, ...this.queue].find((x) => x && x.kind === 'intro');
      const S = ensureQuests(this.game.state);
      b.qs = b.qs.filter((q) => !(q.kind === 'main' && ((intro && q.chapter === intro.ch) || S.intro === q.chapter)));
      if (!b.qs.length) return false;
      const s = this.queue.find((x) => x.kind === 'start');
      if (s) { for (const q of b.qs) if (!s.qs.includes(q)) s.qs.push(q); return true; }
    }
    if (b.kind === 'intro' && [this.cur, ...this.queue].some((x) => x && x.kind === 'intro' && x.ch === b.ch)) return false;
    if (b.kind === 'finale' && [this.cur, ...this.queue].some((x) => x && x.kind === 'finale' && x.ch === b.ch)) return false;
    if (front) this.queue.unshift(b); else this.queue.push(b);
    // order: finale before the next chapter's opening before quest starts; completions keep their order
    // (a completion inside a chapter whose opening has not played yet waits for that opening)
    const S = ensureQuests(this.game.state);
    const rank = { done: 0, finale: 1, intro: 2, lab: 3, start: 4 };
    const rk = (x) => (x.kind === 'done' && x.q && S.intro === x.q.chapter ? 2.5 : rank[x.kind] ?? 5);
    this.queue.sort((a, c) => rk(a) - rk(c));
    this.warmBeat(b);
    return true;
  }

  // the waiting chapter opening / finale, right now (a click on the tracker pill: the player asked for it)
  playChapterNow() {
    const S = ensureQuests(this.game.state);
    if (S.outro) this.enqueue({ kind: 'finale', ch: S.outro }, true);
    else if (S.intro) this.enqueue({ kind: 'intro', ch: S.intro }, true);
    this.calmT = 99;
    this.forceT = 0.5;
  }

  calm() {
    const g = this.game;
    if (!g.state?.tutorialDone || g.tutorial?.active || g.tutorial?.intro || g.tutorial?.offering) return false;
    if (g.ui?.blocking && !g.ui?.isOpen?.('questcine')) return false;
    if (g.fishing?.busy || g.fishing?.finale || g.fishing?.fighting) return false;
    if (g.ocean?.travelState || g.dest?.active) return false;
    if (g.build?.active || g.aquarium?.editing) return false;
    if (g.paused) return false;
    return true;
  }

  // ---------------------------------------------------------------- warm-up (NPC frames, 3D words) during idle frames
  warmIdle() {
    const T = this.titleO();
    for (const s of ['QUEST COMPLETE!', 'CHAPTER COMPLETE!']) this.prep.push(prepRow(s, s.startsWith('CH') ? T.big : T.head));
    for (const s of ['QUEST COMPLETE!', 'MILESTONE!', 'ORDER FILLED!', 'BOARD CLEARED!']) this.prep.push(prepWord(s, { palette: 'gold', size: 16, depth: 3 }));
    this.prep.push(prepWord('NEW RESEARCH!', { palette: 'leaf', size: 16, depth: 3 }));
  }
  titleO() {
    const big = this.H >= 600 ? 1.75 : 1.4;
    return {
      big: { palette: 'gold', size: 32, depth: 4, scale: big },
      head: { palette: 'gold', size: 32, depth: 4, scale: big * 0.8 },
      chap: { palette: 'aqua', size: 32, depth: 4, scale: big },
      sub: { palette: 'white', size: 16, depth: 3, scale: 1 },
      ocean: { palette: 'sky', size: 16, depth: 3, scale: 1.5 },
      small: { palette: 'gold', size: 16, depth: 3, scale: 1 },
      num: { palette: 'white', size: 16, depth: 3, scale: 1.25 },
      stamp: { palette: 'leaf', size: 16, depth: 3, scale: 1 },
    };
  }
  warmNpc(id, poses = ['idle', 'talk', 'cheer', 'wave']) {
    const self = this;
    this.prep.push((function* () {
      if (id === 'seal') { for (const a of ['idle', 'clap', 'wave', 'wiggle', 'swim']) { try { warmSeal(self.sealSz(), [a], 'side'); } catch { /* optional */ } yield; } return; }
      if (!NPC.NPCS?.[id]) return;
      const c = self.scratch ||= document.createElement('canvas');
      c.width = 4; c.height = 4;
      const g = c.getContext('2d');
      for (const pose of poses) for (let i = 0; i < 8; i++) {
        try { NPC.drawNPC(g, id, { x: 2, y: 2, t: i * 0.27, scale: self.npcScale(id), facing: 1, pose, mood: pose === 'cheer' ? 'excited' : 'happy', id: 'qc-warm', shadow: false }); } catch { /* optional */ }
        yield;
      }
    })());
  }
  warmBeat(b) {
    const T = this.titleO();
    const ch = b.ch && CHAPTER_BY_ID[b.ch];
    if (b.kind === 'intro' && ch) {
      this.prep.push(prepRow(ch.title.toUpperCase(), T.chap));
      this.prep.push(prepWord(`CHAPTER ${ch.n}`, T.small));
      this.prep.push(prepWord(OCEAN_NAMES[ch.ocean] || ch.ocean, T.sub));
      if (this.mode() === 'full') for (const L of ch.intro) this.warmNpc(L.npc);
    } else if (b.kind === 'finale' && ch) {
      this.prep.push(prepRow('CHAPTER COMPLETE!', T.big));
      this.prep.push(prepWord(ch.title.toUpperCase(), T.sub));
      this.prep.push(prepWord('DONE!', T.stamp));
      this.prep.push(prepWord('NEXT OCEAN', T.small));
      const nx = CHAPTERS[ch.n];
      if (nx) this.prep.push(prepWord(OCEAN_NAMES[nx.ocean] || nx.ocean, T.ocean));
      for (const r of rewardList(ch.reward)) if (r.n) this.prep.push(prepWord((r.key === 'aero' ? '+' : 'x') + r.n, T.num));
      if (this.mode() === 'full' && ch.outro) this.warmNpc(ch.outro.npc);
    } else if (b.kind === 'done' && b.q) {
      this.prep.push(prepRow('QUEST COMPLETE!', T.head));
      this.prep.push(prepWord(b.q.title.toUpperCase(), T.sub));
      for (const r of rewardList(b.q.reward)) if (r.n) this.prep.push(prepWord((r.key === 'aero' ? '+' : 'x') + r.n, T.num));
      if (b.heavy) this.warmNpc(b.q.giver);
    } else if (b.kind === 'lab') {
      this.prep.push(prepWord('NEW RESEARCH!', { palette: 'leaf', size: 16, depth: 3 }));
    }
  }
  stepPrep() {
    const t0 = performance.now();
    while (this.prep.length && performance.now() - t0 < 6) {
      const gen = this.prep[0];
      let r;
      try { r = gen.next(); } catch (e) { r = { done: true }; }
      if (r.done) this.prep.shift();
    }
  }

  // ---------------------------------------------------------------- update (every frame)
  update(dt, inp) {
    const g = this.game;
    this.t += dt;
    const mode = this.mode();
    // chapter openings / finales that wait in the save (a reload, the end of the tutorial) get their moment
    if (mode !== 'off' && g.state?.tutorialDone) {
      const S = ensureQuests(g.state);
      if (S.outro && !this.has('finale', S.outro)) this.enqueue({ kind: 'finale', ch: S.outro });
      else if (S.intro && !S.outro && !this.has('intro', S.intro) && !this.skipIntro?.[S.intro]) this.enqueue({ kind: 'intro', ch: S.intro });
      this.watchSide(dt);
    }
    this.updateFlights(dt);
    this.holdCounter(dt);
    this.bars = lerp(this.bars, this.barsTo, 1 - Math.exp(-dt * 9));
    if (Math.abs(this.bars - this.barsTo) < 0.004) this.bars = this.barsTo;
    if (this.claims.length && !g.ui?.isOpen?.('quests')) this.flushClaims(this.W / 2, this.H * 0.4);

    const calm = this.calm();
    if (!g.fishing?.fighting && this.prep.length) this.stepPrep();
    // safety: the cutscene panel never stays open (blocking the game) without a heavy beat playing in it
    if (g.ui?.isOpen?.('questcine') && (!this.cur || !this.cur.heavy)) { this.closing = true; g.ui.close('questcine'); this.closing = false; this.barsTo = 0; this.hudHidden = false; }
    if (this.cur) {
      if (this.cur.heavy) {
        // another window took over (or the panel was closed by hand): wrap up cleanly; a beat never runs away
        if (!g.ui?.isOpen?.('questcine') || this.cur.t > 45) this.finish(!g.ui?.isOpen?.('questcine'));
      } else {
        if (!calm) this.cur.t = Math.max(this.cur.t, this.cur.end - 0.25); // a fight starts: let the light beat go
        this.cur.t += dt;
        if (this.dlg.active) this.dlg.update(dt, null);
        this.lightInput(inp);
        if (this.cur && this.cur.t >= this.cur.end) this.finish(false);
      }
      return;
    }
    if (!this.queue.length) { this.calmT = 0; return; }
    this.calmT = calm ? this.calmT + dt : 0;
    this.forceT = Math.max(0, (this.forceT || 0) - dt);
    const next = this.queue[0];
    const wait = next.heavy ? 0.9 : 0.5;
    if (calm && this.calmT >= wait && (!this.prep.length || this.calmT > 2 || this.forceT > 0)) this.begin(this.queue.shift());
  }
  has(kind, ch) { return [this.cur, ...this.queue].some((b) => b && b.kind === kind && b.ch === ch); }

  // side stories that open while you play (after their `after` quest) get a start beat; a chapter's batch is quiet
  watchSide(dt) {
    this.sideT -= dt;
    if (this.sideT > 0) return;
    this.sideT = 0.6;
    const book = this.hud.book, S = ensureQuests(this.game.state);
    const open = [];
    for (const c of CHAPTERS) { if (!book.chapterReached(c.id)) break; for (const q of c.side) if (!S.done[q.id] && book.available(q)) open.push(q); }
    if (!this.knownSide) { this.knownSide = new Set(open.map((q) => q.id)); return; }
    const fresh = open.filter((q) => !this.knownSide.has(q.id));
    for (const q of fresh) this.knownSide.add(q.id);
    const chain = fresh.filter((q) => q.after && S.done[q.after] && !this.has('intro', q.chapter));
    if (chain.length) this.enqueue({ kind: 'start', qs: chain.slice(0, 3) });
  }

  // ---------------------------------------------------------------- Aero: held back until its coins land
  takeAero(n) {
    const ui = this.game.ui;
    if (!ui || !(n > 0)) return;
    // the reward's own flyers (spawned by grantReward from the top centre) are replaced by our flights
    const W = this.W;
    if (Array.isArray(ui.flyers)) ui.flyers = ui.flyers.filter((f) => !(f.t < 0.05 && Math.abs(f.x0 - W / 2) < 8 && Math.abs(f.y0 - 70) < 8));
    this.held += n;
    this.holdT = 0;
    this.holdStart = this.t;
  }
  holdCounter(dt) {
    const ui = this.game.ui;
    if (this.held <= 0 || !ui) { this.held = 0; return; }
    const flying = this.flights.some((f) => f.aero) || (this.cur && this.cur.aero) || this.queue.some((b) => b.aero);
    this.holdT = flying ? 0 : this.holdT + dt;
    if (this.holdT > 1.5 || this.t - (this.holdStart ?? this.t) > 12) { this.held = 0; return; }
    const cap = (this.game.state.coins || 0) - this.held;
    if (Number.isFinite(ui.coinShown) && ui.coinShown > cap) ui.coinShown = Math.max(0, cap);
  }

  // ---------------------------------------------------------------- beats: start / finish
  begin(b) {
    const g = this.game;
    b.t = 0;
    b.fx = {};
    // several completions at once play as one beat (the first giver cheers, the rewards are pooled)
    if (b.kind === 'done') while (this.queue[0]?.kind === 'done' && !!this.queue[0].heavy === !!b.heavy) (b.more ||= []).push(this.queue.shift());
    this.cur = b;
    const S = ensureQuests(g.state);
    if (b.kind === 'intro' && S.intro !== b.ch) { this.cur = null; return; }
    if (b.kind === 'finale' && S.outro !== b.ch) { this.cur = null; return; }
    if (b.heavy) {
      this.plan(b);
      if (!g.ui?.isOpen?.('questcine')) {
        const p = g.ui?.panels?.questcine;
        if (!p) { this.cur = null; return; }
        p.sound = b.kind === 'intro' ? 'whale_call' : b.kind === 'finale' ? 'catch_legendary' : 'ui_unlock';
        g.ui.open('questcine');
      }
    } else this.planLight(b);
  }

  // ends the running beat. cut = interrupted (another window, Esc): jump to the end state at once.
  finish(cut) {
    const b = this.cur;
    if (!b) return;
    const g = this.game, S = ensureQuests(g.state);
    this.cur = null;
    if (b.kind === 'intro' && S.intro === b.ch && (!cut || b.t > 1)) { S.intro = null; g.save?.(); }
    if (b.kind === 'finale' && S.outro === b.ch && (!cut || b.t > 1)) { S.outro = null; g.save?.(); }
    if (b.kind === 'intro' && cut && b.t <= 1) (this.skipIntro ||= {})[b.ch] = true; // do not loop back into it this session
    // anything still to hand over goes now
    if (b.rewards && !b.flew) this.launch(b);
    if (b.cards) for (const c of b.cards) if (c.fly && !c.landed) { c.landed = true; this.hud.landCard?.(c.q.id); }
    if (b.kind === 'finale' && S.intro && this.mode() !== 'off') this.enqueue({ kind: 'intro', ch: S.intro }, true);
    if (b.heavy) {
      this.hudHidden = false;
      // the next heavy beat continues in the same panel (bars and camera stay)
      const nx = this.queue[0];
      if (!cut && b.kind === 'finale' && nx && nx.kind === 'intro' && this.calmIgnoringUs()) { this.begin(this.queue.shift()); if (this.cur) return; }
      this.barsTo = 0;
      if (b.cam) { try { g.camera.release(2.2); } catch { /* optional */ } }
      if (g.ui?.isOpen?.('questcine')) { this.closing = true; g.ui.close('questcine'); this.closing = false; }
    }
    this.box = null;
    this.dlg.clear();
    this.calmT = 0;
  }
  calmIgnoringUs() { return this.calm(); }

  // Escape: skip the whole beat (rewards still fly into the HUD)
  skip() { if (this.cur) this.finish(true); }

  // ---------------------------------------------------------------- staging (heavy beats)
  sealSz() { return sealSize(Math.max(36, this.H * 0.105)); }
  npcScale(id) { return Math.max(0.8, Math.round(((this.H * STAGE_H) / (NPC_H[id] || 64)) * 4) / 4); }

  plan(b) {
    const g = this.game, W = this.W, H = this.H, cam = g.camera, boat = g.boat;
    const full = this.mode() === 'full';
    b.cam = false;
    let side = 1;
    if (full && cam?.open && boat?.visible && Number.isFinite(boat.x) && Number.isFinite(boat.y)) {
      side = boat.x < W / 2 ? 1 : -1;
      const zT = (cam.baseZoom?.() || 2) * 1.5;
      b.world = { x: boat.x + side * 64, y: boat.y, zT, side };
      const fx = b.world.x + side * (W * 0.16) / zT, fy = boat.y - (H * 0.17) / zT;
      try { cam.focus(fx, fy, 2, 2.6); b.cam = true; } catch { b.cam = false; }
    } else b.world = null;
    b.side = side;
    b.cx = Math.round(side > 0 ? W * 0.64 : W * 0.36); // content column, opposite the NPC
    if (!b.world) b.cx = Math.round(W / 2);
    b.stage = {}; // npc id -> {in, out, slot}
    b.full = full;
    this.hudHidden = true;
    this.barsTo = 1;
    const T = this.titleO();
    const ch = CHAPTER_BY_ID[b.ch];
    if (b.kind === 'done') {
      try { g.camera.slowmo(0.12, 0.45); } catch { /* optional */ }
      g.audio?.play?.('sparkle', { vol: 0.7 });
      b.rewards = this.pooledRewards(b);
      b.line = this.art.CHEERS[b.q.giver] || this.art.CHEERS.seal;
      b.line = b.line[Math.floor(Math.random() * b.line.length)];
      b.marks = { head: 0.15, npc: 0.3, talk: 0.95, rw: 1.2 };
      b.end = 4.4;
      b.head = row('QUEST COMPLETE!', T.head);
    } else if (b.kind === 'intro') {
      const lines = full ? ch.intro.slice() : [];
      b.lines = lines.map((L, i) => ({ ...L, at: 0 }));
      b.li = -1;
      b.phase = full ? 'enter' : 'title';
      b.pt = 0;
      b.title = row(ch.title.toUpperCase(), T.chap);
      this.introCards(b, ch);
    } else if (b.kind === 'finale') {
      try { g.camera.slowmo(0.2, 0.6); } catch { /* optional */ }
      b.title = row('CHAPTER COMPLETE!', T.big);
      b.phase = 'stamp';
      b.pt = 0;
      b.cards = ch.quests.map((q, i) => ({ q, i, face: true, done: true }));
      b.rewards = this.rewardTiles(rewardList(ch.reward), 0);
      b.next = CHAPTERS[ch.n] || null;
    }
  }

  introCards(b, ch) {
    const S = ensureQuests(this.game.state), book = this.hud.book;
    const act = new Set(book.active().map((q) => q.id));
    b.cards = ch.quests.map((q, i) => ({ q, i, face: !!S.done[q.id] || act.has(q.id), done: !!S.done[q.id], fly: act.has(q.id) && !S.done[q.id] }));
    for (const c of b.cards) if (c.fly) this.hud.expectCard?.(c.q.id);
  }

  pooledRewards(b) {
    const all = [b, ...(b.more || [])];
    const map = new Map();
    let bonus = 0;
    for (const x of all) {
      bonus += x.bonus || 0;
      for (const r of rewardList(x.q.reward)) {
        const m = map.get(r.key);
        if (m && r.n && m.n) m.n += r.n; else if (!m) map.set(r.key, { ...r });
      }
    }
    return this.rewardTiles([...map.values()], bonus);
  }
  subtitle(b) { return b.q.title.toUpperCase() + (b.more?.length ? ` +${b.more.length} MORE` : ''); }

  rewardTiles(list, bonus) {
    const out = [];
    for (const r of list) {
      if (r.key === 'aero') { const n = (r.n || 0) + (bonus || 0); if (n > 0) out.push({ ...r, n, aero: true }); }
      else out.push(r);
    }
    return out.slice(0, 6);
  }

  // where the npc stands on screen: its slot next to the boat (world space), or a stage spot when there is no ocean view
  npcPos(b, slot) {
    const g = this.game, W = this.W, H = this.H;
    if (b.world) {
      const wx = b.world.x + b.world.side * slot * 60, wy = b.world.y;
      const [sx, sy] = g.camera.worldToScreen(wx, wy);
      const k = clamp((g.camera.z || b.world.zT) / b.world.zT, 0.55, 1.15);
      return { x: sx, y: sy, k, water: true };
    }
    const x = b.side > 0 ? W * (0.2 + slot * 0.12) : W * (0.8 - slot * 0.12);
    return { x, y: H * 0.7, k: 1, water: false };
  }

  // ---------------------------------------------------------------- drawing heavy beats (CinePanel.draw)
  drawHeavy(ctx, ui, dt) {
    const b = this.cur;
    const g = this.game, W = this.W, H = this.H;
    if (!b || !b.heavy) { this.drawBars(ctx); return; }
    b.t += dt;
    // input: click = next / fast-forward; Esc is handled by the ui (it closes the panel -> skip)
    const click = ui.inp.pressed || g.input?.keyPressed?.(' ') || g.input?.keyPressed?.('Enter');
    if (ui.inp.pressed) ui.inp.pressed = false;
    if (click) this.advance(b);
    if (b.kind === 'done') this.drawDone(ctx, b, dt);
    else if (b.kind === 'intro') this.drawIntro(ctx, b, dt);
    else if (b.kind === 'finale') this.drawFinale(ctx, b, dt);
    this.drawFlights(ctx);
    this.drawSkipHint(ctx, b);
    if (this.cur === b && b.t >= b.end) this.finish(false);
  }

  advance(b) {
    const d = this.dlg;
    if (d.active) { if (d.typing) d.finishTyping(); else d.next(); return; }
    if (b.wait > b.t) { b.wait = b.t; return; }
    // fast-forward to the next beat mark
    if (b.kind === 'done') { const m = [b.marks.rw + 0.6, b.end - 1.4, b.end]; const n = m.find((x) => x > b.t + 0.05); if (n !== undefined) b.t = n; }
    else if (b.phase) b.pt = Math.max(b.pt, b.phaseEnd ?? b.pt);
  }

  drawBars(ctx) {
    const k = this.bars;
    if (k < 0.01) return;
    const W = this.W, H = this.H, bh = Math.round(H * 0.105);
    const off = Math.round((1 - ease.outCubic(k)) * (bh + 2));
    ctx.drawImage(barArt(W, bh, true), 0, -off);
    ctx.drawImage(barArt(W, bh, false), 0, H - bh + off);
  }
  barH() { return Math.round(this.H * 0.105 * ease.outCubic(this.bars)); }

  drawSkipHint(ctx, b) {
    if (this.bars < 0.6) return;
    const W = this.W, H = this.H, bh = Math.round(H * 0.105);
    const y = H - Math.round(bh / 2) - 4 + Math.round((1 - this.bars) * bh);
    const txt = 'SKIP';
    const kw = measureText('ESC', 'small') + 8;
    const x = W - 14 - kw - measureText(txt, 'small') - 6;
    ctx.globalAlpha *= 0.85;
    ctx.drawImage(aeroSurface(kw, 11, { tone: 'white', r: 3, gloss: 0.6, glossH: 4, curve: 1, rim: 0.6, glow: 0.2 }), x, y - 3);
    drawText(ctx, 'ESC', x + 4, y - 1, { font: 'small', color: '#0a3e74' });
    drawText(ctx, txt, x + kw + 5, y, { font: 'small', color: '#9fdcff' });
    // a little "click for more" arrow while it plays
    if (Math.sin(this.t * 5) > -0.2) { ctx.fillStyle = '#9fdcff'; const ax = x - 12; ctx.fillRect(ax, y, 2, 6); ctx.fillRect(ax + 2, y + 1, 2, 4); ctx.fillRect(ax + 4, y + 2, 2, 2); }
    ctx.globalAlpha /= 0.85;
    void b;
  }

  // one NPC on stage. st = {in: time it entered, out: time it leaves (or null)}
  drawStageNpc(ctx, b, id, slot, o = {}) {
    const g = this.game, t = this.t;
    const P = this.npcPos(b, slot);
    const te = b.t - (o.in ?? 0);
    if (te < 0) return null;
    const tx = o.out != null ? b.t - o.out : -1;
    if (tx > 0.7) return null;
    let x = P.x, y = P.y, k = P.k, alpha = 1, bubble = 0, sq = 0, spin = false;
    const facing = b.side > 0 ? 1 : -1;
    // entrances: the seal leaps out of the water, bubble people float down in a soap bubble that pops, Dot zips in,
    // Captain Bloat bobs up and puffs. Exits: back into the water (or a poof on the plain stage).
    const E = 0.85;
    const ke = clamp01(te / E);
    const fx = b.fx;
    const key = id + slot;
    if (P.water) {
      if (id === 'seal' || id === 'bloat') {
        if (ke < 1) {
          const j = ke;
          y = P.y + 40 * k - Math.sin(j * Math.PI) * 70 * k - j * 40 * k;
          spin = id === 'seal' && j > 0.15 && j < 0.85;
          if (!fx['out' + key]) { fx['out' + key] = 1; this.splash(P.x, P.y, 1); g.audio?.play?.('splash_small', { vol: 0.7 }); }
          if (j > 0.92 && !fx['land' + key]) { fx['land' + key] = 1; this.splash(P.x, P.y, 0.7); g.audio?.play?.(id === 'bloat' ? 'puff' : 'boing', { vol: 0.6 }); }
          if (id === 'bloat' && j > 0.7) sq = Math.sin((j - 0.7) / 0.3 * Math.PI) * 0.35;
        }
      } else {
        // descend in a soap bubble
        if (ke < 1) { y = P.y - (1 - ease.outCubic(ke)) * this.H * 0.45; bubble = 1; }
        if (ke >= 1 && !fx['pop' + key]) {
          fx['pop' + key] = 1;
          try { g.particles?.pixelBurst?.('bubble', P.x, P.y - this.H * 0.1 * k, 8, { layer: 'ui', speed: [30, 90] }); g.particles?.pixelBurst?.('sparkle', P.x, P.y - this.H * 0.1 * k, 5, { layer: 'ui', ramp: 'white' }); } catch { /* optional */ }
          this.splash(P.x, P.y, 0.6);
          g.audio?.play?.('bubble', { vol: 0.8, pitch: 1.2 });
        }
        if (ke >= 1 && te < E + 0.25) sq = Math.sin(((te - E) / 0.25) * Math.PI) * 0.18;
      }
      if (tx > 0) {
        y = P.y + ease.inCubic(clamp01(tx / 0.5)) * this.H * 0.25 * k;
        if (!fx['dive' + key]) { fx['dive' + key] = 1; this.splash(P.x, P.y, 0.8); g.audio?.play?.('splash_small', { vol: 0.5, pitch: 1.2 }); }
      }
    } else {
      if (ke < 1) { k *= ease.outBack(ke); alpha = clamp01(ke * 3); }
      if (!fx['poofin' + key] && te > 0) { fx['poofin' + key] = 1; try { g.particles?.poof?.(P.x, P.y - 30, { layer: 'ui' }); } catch { /* optional */ } g.audio?.play?.('bubble', { vol: 0.6 }); }
      if (tx > 0) { k *= 1 - ease.inBack(clamp01(tx / 0.45)); alpha = 1 - clamp01(tx / 0.45); }
    }
    if (k <= 0.02) return null;
    const pose = spin ? 'spin' : o.pose || 'idle';
    const talk = o.talk || 0;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (P.water) { ctx.beginPath(); ctx.rect(0, 0, this.W, Math.round(P.y + 3 * k)); ctx.clip(); }
    const foot = P.water ? 9 : 0;
    ctx.translate(Math.round(x), Math.round(y));
    if (sq) ctx.scale(k * (1 + sq), k * (1 - sq)); else ctx.scale(k, k);
    let A = null;
    try {
      if (id === 'seal') {
        const anim = pose === 'cheer' ? 'clap' : pose === 'wave' ? 'wave' : pose === 'spin' ? 'swim' : pose === 'excited' ? 'wiggle' : 'idle';
        A = NPC.drawNPC(ctx, 'seal', { x: 0, y: foot, t, size: this.sealSz(), facing, anim, talk, mood: o.mood || 'happy', ride: 0, id: 'qc-seal', lookAt: o.lookAt });
      } else {
        A = NPC.drawNPC(ctx, id, { x: 0, y: foot, t, scale: this.npcScale(id), facing, pose: pose === 'excited' ? 'cheer' : pose, talk, mood: o.mood || 'happy', id: 'qc-' + id, shadow: false });
      }
    } catch { A = null; }
    if (bubble) drawSoapBubble(ctx, 0, -this.H * STAGE_H * 0.5, Math.round(this.H * STAGE_H * 0.62), Math.sin(t * 6) * 0.3);
    ctx.restore();
    if (P.water && te > 0.2 && tx < 0) this.drawFoam(ctx, P.x, P.y, k);
    // emote over the head
    const top = A?.top ? [x + A.top[0] * k, y + A.top[1] * k] : [x, y - this.H * STAGE_H * k];
    if (o.emote && o.emoteT != null) this.drawEmote(ctx, top[0], top[1] - 6, o.emote, b.t - o.emoteT);
    return { x, y, k, top, mouth: A?.mouth ? [x + A.mouth[0] * k, y + A.mouth[1] * k] : top };
  }

  drawFoam(ctx, x, y, k) {
    const t = this.t, w = Math.round(26 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = -w; i <= w; i += 3) {
      const yy = Math.round(y + 3 * k + Math.sin(t * 5 + i * 0.4) * 1.2);
      const ln = 2 + ((i * 7 + Math.floor(t * 6)) & 1);
      if (Math.abs(i) < w - 2) ctx.fillRect(Math.round(x + i), yy, ln, 1);
    }
    ctx.fillStyle = 'rgba(190,240,255,0.7)';
    ctx.fillRect(Math.round(x - w * 0.7), Math.round(y + 4 * k), Math.round(w * 1.4), 1);
  }

  drawEmote(ctx, x, y, name, te) {
    if (te < 0 || te > 2.6) return;
    const ic = getUiIcon(name);
    if (!ic) return;
    const k = te < 0.3 ? ease.outBack(te / 0.3) : te > 2.3 ? 1 - (te - 2.3) / 0.3 : 1;
    if (k <= 0.05) return;
    const s = 2, w = Math.round((ic.width * s + 10) * k), h = Math.round((ic.height * s + 8) * k);
    const bob = Math.round(Math.sin(this.t * 6) * 1.5);
    ctx.drawImage(aeroSurface(Math.max(4, w), Math.max(4, h), { tone: 'white', r: 6, gloss: 0.6, glossH: Math.round(h * 0.4), curve: 1, rim: 0.8, glow: 0.4 }), Math.round(x - w / 2), Math.round(y - h + bob));
    // the bubble's little tail
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(x - 2), Math.round(y + bob), 4, 2); ctx.fillRect(Math.round(x - 1), Math.round(y + 2 + bob), 2, 2);
    if (k > 0.6) ctx.drawImage(ic, Math.round(x - (ic.width * s) / 2), Math.round(y - h / 2 - (ic.height * s) / 2 + bob), ic.width * s, ic.height * s);
  }

  splash(x, y, p) {
    try { this.game.particles?.pixelSplash?.(x, y, p, { layer: 'ui' }); } catch { /* optional */ }
  }

  // ---------------------------------------------------------------- the dialogue box (heavy beats)
  fontSize(small) {
    const fs = dialogueFontSize();
    return small ? 16 : clamp(fs, 16, this.H >= 700 ? 24 : 20);
  }
  say(npc, text, o = {}) {
    const d = this.dlg;
    d.voice = VOICE[npc] || 'fish';
    d.now(text, { hold: o.hold ?? 1.1 + text.length * 0.012, cps: o.cps ?? 46, onDone: o.onDone });
    d.npc = npc;
  }
  drawBox(ctx, b, o = {}) {
    const d = this.dlg, l = d.line;
    const g = this.game, W = this.W, H = this.H, t = this.t;
    if (!l) return null;
    const fs = this.fontSize(o.small), LH = Math.round(fs * 0.86) + 3;
    const w = Math.round(Math.min(W - 40, o.w || Math.max(420, W * 0.56)));
    const tx0 = 66;
    const lines = wrapAlagard(l.text, w - tx0 - 22, fs);
    const h = Math.max(64, lines.length * LH + 26);
    const kin = backOut(d.t * 4.5);
    const x = Math.round(o.x ?? (o.cx != null ? clamp(o.cx - w / 2, 12, W - w - 12) : (W - w) / 2)), y0 = Math.round(o.y ?? H - Math.round(H * 0.105) - h + 12);
    const y = Math.round(y0 + (1 - kin) * 30);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * clamp01(d.t * 6);
    const col = this.art.NPC_COL[d.npc] || '#8fdcff';
    ctx.drawImage(aeroSurface(w, h, { top: '#3aa4f0', mid: '#1468c0', bot: '#0a3f86', a: [0.97, 0.98], edge: '#04264e', r: 12, gloss: 0.35, glossH: 18, curve: 2, rim: 0.85, glow: 0.5, glowColor: '#7ad8ff', bubbles: 4, seed: 61 }), x, y);
    // name plate (in the speaker's colour) on the top edge
    const name = this.art.npcName(d.npc).toUpperCase();
    const nfs = 16, nw = Math.ceil(alagardWidth(name, nfs)) + 22, nh = 19;
    const plate = { top: mix(col, '#ffffff', 0.6), mid: col, bot: shade(col, -0.3), edge: shade(col, -0.6), a: [1, 1] };
    ctx.drawImage(aeroSurface(nw, nh, { tone: plate, r: 'pill', gloss: 0.8, glossH: 7, curve: 1, rim: 0.8, glow: 0.4 }), x + tx0 - 6, y - 11);
    drawAlagard(ctx, name, x + tx0 + 5, y - 10, { size: nfs, color: '#ffffff', shadow: shade(col, -0.65) });
    // portrait, overlapping the left edge
    const pr = Math.round(Math.min(32, h * 0.46));
    try { this.art.drawPortrait(ctx, d.npc, x + 34, y + h / 2, pr, t, { talk: d.talk, mood: o.mood || 'happy', key: 'cine' }); } catch { /* optional */ }
    // typed text
    let left = Math.floor(d.shown);
    const ty = y + Math.round((h - lines.length * LH) / 2) - 1;
    lines.forEach((ln, i) => {
      if (left <= 0) return;
      drawAlagard(ctx, ln, x + tx0 + 4, ty + i * LH, { size: fs, chars: left, color: '#ffffff', shadow: '#04264e' });
      left -= ln.length + 1;
    });
    if (d.waiting) {
      const bob = Math.round(Math.sin(t * 7) * 2), ax = x + w - 18, ay = y + h - 13 + bob;
      ctx.fillStyle = '#04264e'; ctx.fillRect(ax - 5, ay - 2, 11, 2); ctx.fillRect(ax - 3, ay, 7, 2); ctx.fillRect(ax - 1, ay + 2, 3, 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(ax - 4, ay - 3, 9, 2); ctx.fillRect(ax - 2, ay - 1, 5, 2); ctx.fillRect(ax, ay + 1, 1, 2);
    }
    ctx.globalAlpha = a0;
    void g;
    return { x, y, w, h };
  }
  emoteFor(text, cheer) {
    if (cheer) return Math.random() < 0.5 ? 'heart' : 'star';
    if (/\?/.test(text)) return 'question';
    if (/!/.test(text)) return /SCIENCE|Eureka|wonderful/i.test(text) ? 'sparkle' : 'exclaim';
    return 'heart';
  }

  // ---------------------------------------------------------------- beat: main quest complete (heavy)
  drawDone(ctx, b, dt) {
    const g = this.game, W = this.W, H = this.H, t = this.t, M = b.marks;
    const T = this.titleO();
    const outT = b.end - 1.35;
    if (b.t > outT && !b.fx.out) { b.fx.out = 1; this.barsTo = this.chainNext() ? 1 : 0; this.hudHidden = !!this.chainNext(); if (b.cam && !this.chainNext()) try { g.camera.release(2.2); } catch { /* optional */ } }
    // the NPC (behind the bars): pops out of the water and cheers
    let npc = null;
    if (M.npc >= 0) npc = this.drawStageNpc(ctx, b, b.q.giver, 0, { in: M.npc, out: b.fx.out ? outT : null, pose: b.t > M.talk ? (this.dlg.typing ? 'talk' : 'cheer') : 'wave', talk: this.dlg.talk, mood: 'excited', emote: b.emote, emoteT: b.emoteT });
    this.drawBars(ctx);
    const bh = this.barH();
    // headline: gold voxel letters dropping in, the quest name under it
    const hy = Math.round(Math.max(bh, H * 0.06) + H * 0.1);
    b.head ||= row('QUEST COMPLETE!', T.head);
    const fade = 1 - k01(b.t, outT + 0.2, 0.5);
    ctx.save();
    ctx.globalAlpha *= fade;
    drawAeroGlow(ctx, b.cx, hy, 120, '#06264e', 0.35 * clamp01(b.t * 3));
    drawRow(ctx, b.head, b.cx, hy, b.t - M.head, { id: 'h', fx: b.fx, onLand: (x, y, i) => { if (i % 3 === 0) try { g.particles?.pixelBurst?.('sparkle', x, y + 8, 2, { layer: 'ui', ramp: 'gold', size: 0 }); } catch { /* optional */ } } });
    if (!b.fx.chime && b.t > M.head + 0.2) { b.fx.chime = 1; g.audio?.play?.('timing_perfect', { vol: 0.6 }); }
    const sub = this.subtitle(b);
    wordNow(sub, T.sub);
    drawWord(ctx, sub, T.sub, b.cx, hy + Math.round(H * 0.075), backOut((b.t - M.head - 0.5) / 0.4), clamp01((b.t - M.head - 0.5) * 4));
    ctx.restore();
    // the cheer line
    if (b.t > M.talk && !b.fx.talk && M.npc >= 0) { b.fx.talk = 1; this.say(b.q.giver, b.line, { hold: 1.1 }); b.emote = this.emoteFor(b.line, true); b.emoteT = b.t; try { g.particles?.hearts?.(npc?.top?.[0] ?? b.cx, npc?.top?.[1] ?? H / 2, 3, { layer: 'ui' }); } catch { /* optional */ } }
    if (this.dlg.active) { this.dlg.update(dt, null); if (b.fx.out) this.dlg.clear(); else this.drawBox(ctx, b, { w: Math.min(W - 40, 460), cx: b.cx }); }
    // reward reveal: tiles burst from the NPC (or the title) into a row, then fly into the HUD
    const from = npc ? [npc.x, npc.y - H * 0.08] : [b.cx, hy];
    this.drawTiles(ctx, b, from, hy + Math.round(H * 0.17), M.rw, outT + 0.25);
    if (!b.fx.conf && b.t > M.head + 0.35) { b.fx.conf = 1; try { g.particles?.celebrate?.(b.cx, hy, 0.9, { layer: 'ui' }); } catch { /* optional */ } }
  }
  chainNext() { return false; } // a completion always hands its rewards over in the open (bars out, HUD back)

  // the reward row: tiles pop out from `from`, line up at y, and launch at `flyAt`
  drawTiles(ctx, b, from, y, at, flyAt) {
    const g = this.game, H = this.H, t = this.t;
    const list = b.rewards || [];
    if (!list.length) return;
    const T = this.titleO();
    const S = Math.round(clamp(H * 0.075, 34, 52)), gap = Math.round(S * 0.5);
    const tw = list.map((r) => S + (r.n ? Math.round(S * 0.9) : 0));
    const total = tw.reduce((a, w) => a + w, 0) + gap * (list.length - 1);
    let x = b.cx - total / 2;
    if (b.t >= flyAt && !b.flew) this.launch(b);
    list.forEach((r, i) => {
      const k = clamp01((b.t - at - i * 0.14) / 0.42);
      r.tx = x + S / 2; r.ty = y;
      x += tw[i] + gap;
      if (k <= 0 || r.gone) return;
      if (!r.pop) { r.pop = 1; g.audio?.play?.('mash_pop', { vol: 0.5, pitch: 0.9 + i * 0.08 }); try { g.particles?.pixelBurst?.('star', r.tx, y, 4, { layer: 'ui', ramp: 'gold', size: 0 }); } catch { /* optional */ } }
      const e = ease.outCubic(k);
      const px = lerp(from[0], r.tx, e), py = lerp(from[1], y, e) - Math.sin(k * Math.PI) * H * 0.12;
      const s = Math.round(S * (0.5 + 0.5 * backOut(k)));
      r.cx = px; r.cy = py;
      drawAeroGlow(ctx, px, py, S * 0.9, r.big ? '#eaffb4' : '#fff6c8', 0.35);
      ctx.drawImage(aeroSurface(s, s, { tone: r.big ? 'green' : 'white', r: 8, gloss: 0.7, glossH: Math.round(s * 0.4), curve: 2, rim: 0.9, glow: 0.6 }), Math.round(px - s / 2), Math.round(py - s / 2));
      try { this.art.rewardIcon(ctx, r, px, py, Math.round(s * 0.74), t, i); } catch { /* optional */ }
      if (r.n && k > 0.5) {
        const txt = (r.key === 'aero' ? '+' : 'x') + r.n;
        wordNow(txt, T.num);
        if (!drawWord(ctx, txt, T.num, px + s / 2 + S * 0.42, py + 1, backOut((k - 0.5) * 2))) drawText(ctx, txt, Math.round(px + s / 2 + 4), Math.round(py - 3), { color: '#ffffff', shadow: '#04264e' });
      }
      if (((t * 0.9 + i * 0.3) % 1) < 0.12) drawSparkle(ctx, px + s * 0.3, py - s * 0.3, 2, 1);
    });
  }

  // every tile becomes a flight into the HUD (Aero splits into a few drops)
  launch(b) {
    if (b.flew) return;
    b.flew = true;
    const list = b.rewards || [];
    list.forEach((r, i) => {
      r.gone = true;
      const x = r.cx ?? r.tx ?? this.W / 2, y = r.cy ?? r.ty ?? this.H / 2;
      this.addFlight(r, x, y, i * 0.1);
    });
    this.game.audio?.play?.('travel_whoosh', { vol: 0.25, pitch: 1.6 });
  }

  addFlight(r, x, y, delay = 0) {
    if (r.key === 'aero' || r.aero) {
      const n = Math.max(1, Math.min(6, Math.ceil((r.n || 1) / 8)));
      for (let j = 0; j < n; j++) this.flights.push({ r, aero: (r.n || 0) / n, x0: x + (j - n / 2) * 5, y0: y + ((j * 7) % 5) - 2, t: -delay - j * 0.07, dur: 0.75 + j * 0.03, tgt: 'aero', trail: [], i: j });
      return;
    }
    this.flights.push({ r, x0: x, y0: y, t: -delay, dur: 0.85, tgt: this.targetOf(r), trail: [], i: 0 });
  }
  targetOf(r) {
    const k = r.key || '';
    if (k === 'aero') return 'aero';
    if (k.startsWith('bait:')) return 'bait';
    if (k.startsWith('cosmetic:')) return 'wardrobe';
    if (k.startsWith('rod:') || k === 'hammer') return 'workshop';
    if (r.label?.startsWith?.('New ocean')) return 'map';
    if (r.label?.startsWith?.('Lab:')) return 'lab';
    return 'inventory';
  }
  targetPos(tgt) {
    const g = this.game, W = this.W, H = this.H;
    if (tgt === 'aero') { const c = g.ui?.coinTarget?.(); if (c) return [c.x, c.y]; return [W - 60, 16]; }
    for (const id of [tgt, 'inventory']) {
      let r = null;
      try { r = g.hud?.iconRect?.(id); } catch { r = null; }
      if (r && r.y < H + 4) return [r.x + r.w / 2, r.y + r.h / 2];
    }
    return [W / 2, H - 20];
  }
  updateFlights(dt) {
    const g = this.game;
    for (const f of this.flights) {
      f.t += dt;
      if (f.t <= 0) continue;
      const [tx, ty] = this.targetPos(f.tgt);
      const k = clamp01(f.t / f.dur), e = ease.inOutCubic(k);
      // a lazy arc: up and out first, then a dive into the button
      const mx = lerp(f.x0, tx, 0.35) + (f.i % 2 ? 30 : -30), my = Math.min(f.y0, ty) - this.H * 0.12;
      const a = lerp(f.x0, mx, e), b2 = lerp(mx, tx, e), c = lerp(f.y0, my, e), d = lerp(my, ty, e);
      f.x = lerp(a, b2, e); f.y = lerp(c, d, e);
      f.trail.unshift([f.x, f.y]);
      if (f.trail.length > 7) f.trail.pop();
      if (k >= 1 && !f.done) {
        f.done = true;
        if (f.aero) { this.held = Math.max(0, this.held - f.aero); if (g.ui) g.ui.coinBump = 1; g.audio?.play?.('coin_collect', { vol: 0.45, pitch: 1 + f.i * 0.06 }); }
        else { g.audio?.play?.('icon_drop', { vol: 0.5 }); g.audio?.play?.('sparkle', { vol: 0.35 }); }
        try { g.particles?.pixelBurst?.('sparkle', tx, ty, 4, { layer: 'ui', ramp: f.aero ? 'aqua' : 'gold', size: 0 }); } catch { /* optional */ }
        if (!f.aero) try { g.particles?.pixelBurst?.('star', tx, ty, 3, { layer: 'ui', ramp: 'gold', size: 0, speed: [40, 90] }); } catch { /* optional */ }
      }
    }
    this.flights = this.flights.filter((f) => !f.done);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.dur);
  }
  drawFlights(ctx) {
    const t = this.t;
    for (const f of this.flights) {
      if (f.t <= 0 || f.x == null) continue;
      const k = clamp01(f.t / f.dur);
      // a pixel sparkle trail
      f.trail.forEach((p, j) => {
        if (j === 0) return;
        const a = (1 - j / f.trail.length) * 0.8;
        ctx.globalAlpha *= a;
        ctx.fillStyle = f.aero ? '#9ff0ff' : '#fff2a0';
        const s = j < 3 ? 2 : 1;
        ctx.fillRect(Math.round(p[0] - s / 2), Math.round(p[1] - s / 2), s, s);
        ctx.globalAlpha /= a;
      });
      if (((f.t * 14) | 0) % 3 === 0) drawSparkle(ctx, f.x - 4, f.y + 3, 1, 0.8);
      const s = 1 - k * 0.45;
      if (f.aero) drawAeroCoin(ctx, f.x, f.y, 4.5 * s * Math.max(1, this.H / 540), t);
      else { try { this.art.rewardIcon(ctx, f.r, f.x, f.y, Math.round(26 * s * Math.max(1, this.H / 600)), t, f.i); } catch { /* optional */ } }
    }
  }

  // ---------------------------------------------------------------- beat: chapter opening (heavy)
  drawIntro(ctx, b, dt) {
    const g = this.game, W = this.W, H = this.H, t = this.t;
    const ch = CHAPTER_BY_ID[b.ch];
    if (!ch) { b.t = b.end = 0; return; }
    const T = this.titleO();
    b.pt += dt;
    b.end ??= 99;
    // ---- NPCs: everyone who speaks enters once, the speaker talks, the others listen
    const speakers = [...new Set((b.lines || []).map((l) => l.npc))];
    const exitAt = b.exitAt ?? null;
    if (b.world || b.full) {
      speakers.forEach((id, s) => {
        const st = (b.stage[id] ||= { in: null });
        if (st.in == null) return;
        const L = b.lines[b.li];
        const speaking = L && L.npc === id && this.dlg.active;
        this.drawStageNpc(ctx, b, id, s, { in: st.in, out: exitAt, pose: speaking ? (this.dlg.typing ? 'talk' : 'wave') : 'idle', talk: speaking ? this.dlg.talk : 0, mood: speaking ? 'excited' : 'happy', emote: st.emote, emoteT: st.emoteT });
      });
    }
    this.drawBars(ctx);
    // ---- phases
    if (b.phase === 'enter') {
      // the first speaker makes an entrance, then the lines play
      b.phaseEnd = 0.2;
      if (b.pt > 0.45) { b.phase = 'talk'; b.pt = 0; }
    }
    if (b.phase === 'talk') {
      if (!this.dlg.active && (b.li < 0 || b.lineDone)) {
        b.li++;
        b.lineDone = false;
        const L = b.lines[b.li];
        if (!L) { b.phase = 'title'; b.pt = 0; this.dlg.clear(); }
        else {
          const st = (b.stage[L.npc] ||= { in: null });
          if (st.in == null) { st.in = b.t; b.wait = b.t + (b.world ? 0.95 : 0.4); }
          else b.wait = b.t + 0.15;
        }
      }
      const L = b.lines[b.li];
      if (L && !this.dlg.active && !b.lineDone && b.t >= b.wait) {
        this.say(L.npc, L.text, { onDone: () => { b.lineDone = true; } });
        const st = b.stage[L.npc];
        st.emote = this.emoteFor(L.text); st.emoteT = b.t;
        g.audio?.play?.('notify', { vol: 0.35, pitch: 1.3 });
      }
      if (this.dlg.active) { this.dlg.update(dt, null); this.drawBox(ctx, b); }
      b.phaseEnd = b.pt;
    }
    if (b.phase === 'title' || b.phase === 'cards' || b.phase === 'fly') this.drawChapterTitle(ctx, b, ch, T);
    if (b.phase === 'title') {
      b.phaseEnd = 1.3;
      if (b.pt > 1.5) { b.phase = 'cards'; b.pt = 0; }
    }
    if (b.phase === 'cards' || b.phase === 'fly') this.drawCards(ctx, b);
    if (b.phase === 'cards') {
      const n = b.cards.length;
      if (b.exitAt == null) b.exitAt = b.t; // the cast dives away while the cards are dealt
      b.phaseEnd = 0.25 + n * 0.08 + 0.5;
      if (b.pt > 0.25 + n * 0.08 + 1.5) { b.phase = 'fly'; b.pt = 0; }
    }
    if (b.phase === 'fly') {
      if (!b.fx.fly) {
        b.fx.fly = 1;
        b.exitAt ??= b.t;
        const S = ensureQuests(g.state);
        if (S.intro === b.ch) { S.intro = null; g.save?.(); }
        this.barsTo = 0; this.hudHidden = false;
        if (b.cam) try { g.camera.release(2.2); } catch { /* optional */ }
        g.audio?.play?.('travel_whoosh', { vol: 0.3, pitch: 1.4 });
      }
      b.phaseEnd = 2;
      if (b.pt > 1.9) b.end = b.t;
    }
    void W; void t;
  }

  drawChapterTitle(ctx, b, ch, T) {
    const g = this.game, H = this.H;
    const tt = b.phase === 'title' ? b.pt : b.phase === 'cards' ? 1.5 + b.pt : 99;
    const out = b.phase === 'fly' ? clamp01(b.pt / 0.5) : 0;
    const bh = Math.round(H * 0.105);
    const y0 = Math.round(bh + H * 0.08);
    ctx.save();
    ctx.globalAlpha *= 1 - out;
    ctx.translate(0, -out * 20);
    drawAeroGlow(ctx, b.cx, y0 + H * 0.07, Math.round(H * 0.3), '#06264e', 0.4 * clamp01(tt * 3));
    drawWord(ctx, `CHAPTER ${ch.n}`, T.small, b.cx, y0, backOut(tt / 0.35), clamp01(tt * 5));
    if (!b.fx.c1 && tt > 0.05) { b.fx.c1 = 1; g.audio?.play?.('unlock_biome', { vol: 0.6 }); }
    b.title ||= row(ch.title.toUpperCase(), T.chap);
    const ty = y0 + Math.round(H * 0.085);
    drawRow(ctx, b.title, b.cx, ty, tt - 0.25, { id: 'c', fx: b.fx, stagger: 0.07, onLand: (x, y, i) => { try { g.particles?.pixelBurst?.('puff', x, y + 4, 2, { layer: 'ui', ramp: 'white', size: 0, speed: [14, 40] }); } catch { /* optional */ } if (i % 2 === 0) g.audio?.play?.('ui_tab', { vol: 0.35, pitch: 0.8 + i * 0.05 }); } });
    // the ocean as the subtitle, with a voxel rule growing under the title
    const sk = clamp01((tt - 0.25 - (b.title?.letters.length || 8) * 0.07 - 0.2) / 0.4);
    if (sk > 0) {
      const rw = Math.round((b.title?.w || 200) * 0.8 * ease.outCubic(sk));
      const ry = ty + Math.round((b.title?.h || 40) / 2) + 6;
      ctx.fillStyle = '#04264e'; ctx.fillRect(Math.round(b.cx - rw / 2) - 1, ry - 1, rw + 2, 4);
      ctx.fillStyle = '#ffd23a'; ctx.fillRect(Math.round(b.cx - rw / 2), ry, rw, 2);
      ctx.fillStyle = '#fff6c8'; ctx.fillRect(Math.round(b.cx - rw / 2), ry, rw, 1);
      drawAnimIcon(ctx, 'biome:' + ch.ocean, b.cx - Math.round((b.title?.w || 200) * 0.5) - 18, ty, 26, this.t, 0, { hover: 0.4 });
      drawWord(ctx, OCEAN_NAMES[ch.ocean] || ch.ocean, T.sub, b.cx, ry + 16, 1, sk);
      if (!b.fx.sub) { b.fx.sub = 1; try { g.particles?.pixelBurst?.('sparkle', b.cx, ty, 8, { layer: 'ui', ramp: 'gold', w: (b.title?.w || 200) * 0.4, h: 10 }); } catch { /* optional */ } }
    }
    ctx.restore();
  }

  // quest cards: dealt from below into a fanned row; the active ones then fly into the HUD tracker
  cardSize() { const H = this.H; return { w: Math.round(clamp(H * 0.15, 70, 104)), h: Math.round(clamp(H * 0.19, 88, 132)) }; }
  drawCards(ctx, b) {
    const g = this.game, H = this.H, W = this.W, t = this.t;
    const cards = b.cards || [];
    const n = cards.length;
    if (!n) return;
    const { w: cw, h: chh } = this.cardSize();
    const step = Math.round(Math.min(cw + 6, (W * 0.5) / Math.max(1, n - 1)));
    const y = Math.round(H * 0.6);
    const deal = b.phase === 'cards' ? b.pt : 99;
    const fly = b.phase === 'fly' ? b.pt : -1;
    cards.forEach((c, i) => {
      const k = clamp01((deal - 0.25 - i * 0.08) / 0.38);
      if (k <= 0) return;
      if (!c.dealt) { c.dealt = 1; g.audio?.play?.('ui_page', { vol: 0.45, pitch: 0.9 + i * 0.05 }); }
      const rx = b.cx + (i - (n - 1) / 2) * step, ry = y + Math.abs(i - (n - 1) / 2) * 3;
      const ang = (i - (n - 1) / 2) * 0.05;
      const e = ease.outCubic(k);
      let x = lerp(b.cx, rx, e), yy = lerp(H + chh, ry, e) - Math.sin(k * Math.PI) * 30;
      let sc = 1, alpha = 1, a = lerp(0.5, ang, e);
      // face-up cards flip over as they land
      let flip = c.face ? clamp01((k - 0.55) / 0.35) : 0;
      if (fly >= 0) {
        const fk = clamp01((fly - (c.fly ? 0.1 + i * 0.12 : 0)) / (c.fly ? 0.7 : 0.4));
        if (c.fly) {
          const tr = this.hud.trackerRowRect?.(c.q.id) || { x: 14, y: 60, w: 160, h: 26 };
          const ex = ease.inOutCubic(fk);
          x = lerp(rx, tr.x + 20, ex); yy = lerp(ry, tr.y + tr.h / 2, ex) - Math.sin(fk * Math.PI) * 40;
          sc = lerp(1, 0.32, ex); a = lerp(ang, -0.3, ex);
          if (fk >= 1 && !c.landed) { c.landed = true; this.hud.landCard?.(c.q.id); g.audio?.play?.('timing_good', { vol: 0.5, pitch: 1.1 + i * 0.05 }); try { g.particles?.pixelBurst?.('sparkle', tr.x + 20, tr.y + tr.h / 2, 5, { layer: 'ui', ramp: 'gold', size: 0 }); } catch { /* optional */ } }
          if (fk >= 1) return;
          if (fk > 0.05) for (let j = 1; j < 4; j++) drawSparkle(ctx, lerp(rx, tr.x + 20, ease.inOutCubic(Math.max(0, fk - j * 0.06))), lerp(ry, tr.y + tr.h / 2, ease.inOutCubic(Math.max(0, fk - j * 0.06))), 1, 1 - j * 0.25);
        } else { alpha = 1 - fk; yy += fk * 30; sc = 1 - fk * 0.2; }
      }
      if (alpha <= 0.01) return;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(Math.round(x), Math.round(yy));
      ctx.rotate(a);
      const fx = flip > 0 ? Math.abs(Math.cos(flip * Math.PI)) : 1;
      ctx.scale(sc * Math.max(0.04, fx), sc);
      if (flip < 0.5) this.drawCardBack(ctx, cw, chh, i);
      else this.drawCardFace(ctx, c, cw, chh, t, i);
      ctx.restore();
    });
  }
  drawCardBack(ctx, w, h, i) {
    ctx.drawImage(aeroSurface(w, h, { top: '#4ab4f4', mid: '#1a74c8', bot: '#0b4a90', a: [1, 1], edge: '#04264e', r: 8, gloss: 0.5, glossH: Math.round(h * 0.3), curve: 2, rim: 0.9, glow: 0.4, bubbles: 3, seed: 70 + (i % 4) }), -w / 2, -h / 2);
    ctx.drawImage(aeroSurface(w - 14, h - 14, { tone: 'glass', r: 6, gloss: 0.3, glossH: 10, rim: 0.6, glow: 0.2, a: [0.35, 0.35] }), -w / 2 + 7, -h / 2 + 7);
    drawAnimIcon(ctx, 'star', 0, 0, Math.round(w * 0.42), this.t, i, { still: true });
  }
  drawCardFace(ctx, c, w, h, t, i, done = c.done) {
    const q = c.q;
    ctx.drawImage(aeroSurface(w, h, { tone: done ? 'green' : 'frost', r: 8, gloss: 0.55, glossH: Math.round(h * 0.28), curve: 2, rim: 0.9, glow: 0.5 }), -w / 2, -h / 2);
    const pr = Math.round(w * 0.22);
    try { this.art.drawPortrait(ctx, q.giver, 0, -h / 2 + pr + 6, pr, t, { key: 'card' + (i % 8) }); } catch { /* optional */ }
    // title (pixel text, two lines at most)
    const words = q.title.split(' ');
    const lines = [];
    let ln = '';
    for (const wd of words) { const tt = ln ? ln + ' ' + wd : wd; if (ln && measureText(tt, 'small') > w - 10) { lines.push(ln); ln = wd; } else ln = tt; }
    if (ln) lines.push(ln);
    lines.slice(0, 2).forEach((l, j) => drawText(ctx, l.toUpperCase(), Math.round(-measureText(l.toUpperCase(), 'small') / 2), Math.round(-h / 2 + pr * 2 + 12 + j * 9), { font: 'small', color: done ? '#ffffff' : '#0c3a52', shadow: done ? '#1c5a0e' : null }));
    // objective icon on a glass chip at the bottom
    c.icon ??= this.hud.book.objectives(q)[0]?.icon || 'star';
    ctx.drawImage(aeroSurface(w - 16, 22, { tone: done ? 'white' : 'aqua', r: 'pill', gloss: 0.7, glossH: 8, curve: 1, rim: 0.8, glow: 0.4 }), -w / 2 + 8, h / 2 - 28);
    drawAnimIcon(ctx, c.icon, 0, h / 2 - 17, 18, t, i, {});
    if (done) this.drawStamp(ctx, w * 0.08, h * 0.16, 1, -0.22);
  }
  // a rubber "DONE!" stamp in 3D voxel letters on an inked plate
  drawStamp(ctx, x, y, k, rot = -0.2) {
    if (k <= 0) return;
    const T = this.titleO();
    const c = word('DONE!', T.stamp);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(rot);
    const s = k > 1 ? k : 1;
    ctx.scale(s, s);
    const w = c ? c.width + 10 : 40, h = c ? c.height + 4 : 16;
    ctx.globalAlpha *= k > 1 ? clamp01(2.2 - k) * 1.2 : 1;
    ctx.fillStyle = 'rgba(14,74,30,0.85)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = 'rgba(120,230,90,0.95)';
    ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, 1); ctx.fillRect(-w / 2 + 1, h / 2 - 2, w - 2, 1); ctx.fillRect(-w / 2 + 1, -h / 2 + 1, 1, h - 2); ctx.fillRect(w / 2 - 2, -h / 2 + 1, 1, h - 2);
    if (c) ctx.drawImage(c, Math.round(-c.width / 2), Math.round(-c.height / 2));
    else drawText(ctx, 'DONE!', -14, -3, { font: 'small', color: '#ffffff' });
    ctx.restore();
  }

  // ---------------------------------------------------------------- beat: chapter complete (heavy)
  drawFinale(ctx, b, dt) {
    const g = this.game, W = this.W, H = this.H, t = this.t;
    const ch = CHAPTER_BY_ID[b.ch];
    if (!ch) { b.end = 0; return; }
    const T = this.titleO();
    b.pt += dt;
    b.end ??= 99;
    const n = b.cards.length;
    const outro = b.full && ch.outro ? ch.outro : null;
    const S0 = 1.05, stampEnd = S0 + n * 0.17 + 0.35;
    // the farewell NPC
    if (outro) this.drawStageNpc(ctx, b, outro.npc, 0, { in: 0.4, out: b.exitAt ?? null, pose: this.dlg.active ? (this.dlg.typing ? 'talk' : 'wave') : 'cheer', talk: this.dlg.talk, mood: 'excited', emote: b.emote, emoteT: b.emoteT });
    this.drawBars(ctx);
    const bh = Math.round(H * 0.105);
    const hy = Math.round(bh + H * 0.1);
    const fade = b.phase === 'out' ? 1 - clamp01(b.pt / 0.5) : 1;
    ctx.save();
    ctx.globalAlpha *= fade;
    drawAeroGlow(ctx, b.cx, hy, Math.round(H * 0.32), '#06264e', 0.4 * clamp01(b.t * 3));
    b.title ||= row('CHAPTER COMPLETE!', T.big);
    drawRow(ctx, b.title, b.cx, hy, b.t - 0.25, { id: 'f', fx: b.fx, stagger: 0.05, onLand: (x, y, i) => { if (i % 2 === 0) try { g.particles?.pixelBurst?.('star', x, y, 2, { layer: 'ui', ramp: 'gold', size: 0 }); } catch { /* optional */ } } });
    drawWord(ctx, ch.title.toUpperCase(), T.sub, b.cx, hy + Math.round(H * 0.08), backOut((b.t - 0.9) / 0.4), clamp01((b.t - 0.9) * 4));
    if (!b.fx.conf && b.t > 0.9) {
      b.fx.conf = 1;
      try { g.particles?.aeroConfetti?.(b.cx, hy - 10, 40, { layer: 'ui' }); g.particles?.celebrate?.(b.cx - 120, hy, 1, { layer: 'ui' }); g.particles?.celebrate?.(b.cx + 120, hy, 1, { layer: 'ui' }); } catch { /* optional */ }
      g.audio?.play?.('golden_shimmer', { vol: 0.5 });
    }
    // phase 'stamp': the chapter's quest cards in a grid, each gets a DONE stamp slammed on
    if (b.phase === 'stamp') {
      const cols = Math.min(n, 4), rows = Math.ceil(n / cols);
      const { w: cw0, h: ch0 } = this.cardSize();
      const sc = Math.min(1, (H * 0.36) / (rows * (ch0 + 8)));
      const cw = Math.round(cw0 * sc), chh = Math.round(ch0 * sc);
      const gy = Math.round(hy + H * 0.13);
      b.cards.forEach((c, i) => {
        const r = Math.floor(i / cols), cI = i % cols;
        const x = b.cx + (cI - (cols - 1) / 2) * (cw + 8), y = gy + r * (chh + 8) + chh / 2;
        const k = clamp01((b.pt - 0.5 - i * 0.05) / 0.3);
        if (k <= 0) return;
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y + (1 - ease.outCubic(k)) * 20));
        ctx.scale(sc * backOut(k), sc * backOut(k));
        this.drawCardFace(ctx, c, cw0, ch0, t, i, false);
        const sk = (b.pt - S0 - i * 0.17) / 0.16;
        if (sk > 0) {
          this.drawStamp(ctx, cw0 * 0.08, ch0 * 0.16, sk < 1 ? 2.4 - 1.4 * ease.inCubic(sk) : 1, -0.18 + (i % 3) * 0.08);
          if (sk >= 1 && !c.stamped) {
            c.stamped = 1;
            g.audio?.play?.(i === n - 1 ? 'timing_perfect' : 'timing_good', { vol: 0.55, pitch: 0.85 + i * 0.04 });
            try { g.camera.shake(g.state.settings.reducedMotion ? 0 : 1.2); g.particles?.pixelBurst?.('dust', x, y + 8, 4, { layer: 'ui', speed: [20, 50] }); g.particles?.pixelBurst?.('sparkle', x, y, 3, { layer: 'ui', ramp: 'lime', size: 0 }); } catch { /* optional */ }
          }
        }
        ctx.restore();
      });
      b.phaseEnd = stampEnd - 0.2;
      if (b.pt > stampEnd + 0.6) { b.phase = 'reward'; b.pt = 0; b.rwAt = b.t; }
    }
    ctx.restore();
    // phase 'reward': the chapter reward pops out, the farewell line, the next-ocean teaser
    if (b.phase === 'reward' || b.phase === 'out') {
      const from = [b.cx, hy];
      this.drawTiles(ctx, b, from, Math.round(hy + H * 0.2), b.rwAt, b.flyAt ?? 1e9);
      const tk = b.t - b.rwAt;
      if (b.next) {
        const ny = Math.round(hy + H * 0.36);
        const nk = clamp01((tk - 0.8) / 0.4);
        if (nk > 0) {
          ctx.save();
          ctx.globalAlpha *= nk * fade;
          drawAeroGlow(ctx, b.cx, ny, Math.round(H * 0.16), '#bff6ff', 0.3);
          drawWord(ctx, 'NEXT OCEAN', T.small, b.cx, ny - 20, backOut(nk));
          const nm = OCEAN_NAMES[b.next.ocean] || b.next.ocean;
          const c = word(nm, T.ocean);
          const gx = b.cx - (c ? c.width / 2 : 60) - 26;
          drawAnimIcon(ctx, 'biome:' + b.next.ocean, gx, ny + 6, Math.round(40 * backOut(nk)), t, 0, { hover: 0.7 });
          drawWord(ctx, nm, T.ocean, b.cx, ny + 6, 1);
          if (!b.fx.teaser) { b.fx.teaser = 1; g.audio?.play?.('magic', { vol: 0.45 }); try { g.particles?.pixelBurst?.('sparkle', gx, ny + 6, 6, { layer: 'ui', ramp: 'aqua' }); } catch { /* optional */ } }
          ctx.restore();
        }
      }
      if (b.phase === 'reward') {
        if (outro && !b.fx.say && tk > 0.6) { b.fx.say = 1; this.say(outro.npc, outro.text, { hold: 1.6 }); b.emote = 'heart'; b.emoteT = b.t; }
        if (this.dlg.active) { this.dlg.update(dt, null); this.drawBox(ctx, b, { w: Math.min(W - 40, 520), cx: b.cx }); }
        const ready = outro ? b.fx.say && !this.dlg.active : tk > 2.4;
        b.phaseEnd = b.pt;
        if (ready && tk > 1.6) { const S = ensureQuests(g.state); if (S.outro === b.ch) { S.outro = null; g.save?.(); } b.phase = 'out'; b.pt = 0; b.exitAt = b.t; b.flyAt = b.t + 0.3; this.barsTo = 0; this.hudHidden = false; if (b.cam) try { g.camera.release(2.2); } catch { /* optional */ } }
      } else {
        b.phaseEnd = 1.4;
        if (b.pt > 1.5) b.end = b.t;
      }
    }
  }

  // ---------------------------------------------------------------- light beats (HUD overlay)
  planLight(b) {
    const g = this.game;
    b.fx = {};
    if (b.kind === 'start') {
      b.qs = b.qs.filter((q) => q && !ensureQuests(g.state).done[q.id]).slice(0, 3);
      if (!b.qs.length) { this.cur = null; return; }
      const q = b.qs[0];
      b.say = this.mode() === 'full';
      if (b.say) this.say(q.giver, q.text, { hold: 0.9, cps: 50 });
      b.cards = b.qs.map((qq, i) => ({ q: qq, i, face: true, fly: true }));
      for (const c of b.cards) this.hud.expectCard?.(c.q.id);
      b.flyAt = b.say ? 99 : 0.7;
      b.end = 99;
      g.audio?.play?.('notify', { vol: 0.45 });
    } else if (b.kind === 'done') {
      // the Short version of a quest completion: a quick 3D pop, the giver's face and the rewards flying in
      b.rewards = this.pooledRewards(b);
      b.end = 2.4;
      g.audio?.play?.('ui_unlock');
      try { g.particles?.celebrate?.(this.W / 2, this.H * 0.18, 0.6, { layer: 'ui' }); } catch { /* optional */ }
    } else if (b.kind === 'lab') {
      b.node = LAB_BY_ID[b.nodeId] || null;
      b.end = this.mode() === 'full' ? 3.2 : 2.2;
      g.audio?.play?.('magic', { vol: 0.5 });
    } else { this.cur = null; }
  }

  lightInput(inp) {
    const b = this.cur;
    if (!b || !inp || !inp.pressed || !this.box) return;
    const r = this.box;
    if (inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h) {
      inp.pressed = false; inp.consume?.();
      if (this.dlg.active) { if (this.dlg.typing) this.dlg.finishTyping(); else this.dlg.next(); }
      else b.t = Math.max(b.t, b.end - 0.3);
    }
  }
  hit(x, y) { const r = this.box; return !!(this.cur && !this.cur.heavy && r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h); }

  drawLight(ctx) {
    const b = this.cur;
    this.box = null;
    if (b && !b.heavy) {
      if (b.kind === 'start') this.drawStart(ctx, b);
      else if (b.kind === 'done') this.drawShortDone(ctx, b);
      else if (b.kind === 'lab') this.drawLab(ctx, b);
    }
    if (!this.game.ui?.blocking) { this.drawFlights(ctx); this.drawPops(ctx); }
  }
  // over the Quest Log (its draw calls this last)
  drawOver(ctx) { this.drawFlights(ctx); this.drawPops(ctx); }

  drawStart(ctx, b) {
    const g = this.game, W = this.W, H = this.H, t = this.t;
    let topY = H;
    try { topY = g.hud?.topY?.() ?? H; } catch { topY = H; }
    const q = b.qs[0];
    let box = null;
    if (b.say) {
      if (this.dlg.active) {
        box = this.drawBox(ctx, b, { small: true, w: Math.min(W - 160, 420), y: Math.round(Math.min(topY, H) - 92) });
        this.box = box;
      } else if (b.flyAt > 90) b.flyAt = b.t;
    }
    // the objective cards: pop up beside the box (or in the middle), then fly into the tracker
    const n = b.cards.length;
    const { w: cw0, h: ch0 } = this.cardSize();
    const sc = 0.86, cw = cw0 * sc;
    const baseX = box ? box.x + box.w + cw / 2 + 10 : W / 2 - ((n - 1) * (cw + 8)) / 2;
    const baseY = box ? box.y + box.h / 2 - 8 : H * 0.42;
    let allLanded = true;
    b.cards.forEach((c, i) => {
      const k = clamp01((b.t - 0.15 - i * 0.12) / 0.35);
      if (c.rx == null) { c.rx = box ? Math.min(W - cw / 2 - 6 - (n - 1 - i) * cw * 0.55, baseX + i * cw * 0.55) : baseX + i * (cw + 8); c.ry = box ? baseY - 6 : baseY; }
      const rx = c.rx, ry = c.ry;
      let x = rx, y = ry, s = sc * backOut(k), a = (i - (n - 1) / 2) * 0.06;
      const fk = clamp01((b.t - b.flyAt - i * 0.14) / 0.65);
      if (fk > 0) {
        const tr = this.hud.trackerRowRect?.(c.q.id) || { x: 14, y: 60, w: 160, h: 26 };
        const e = ease.inOutCubic(fk);
        x = lerp(rx, tr.x + 20, e); y = lerp(ry, tr.y + tr.h / 2, e) - Math.sin(fk * Math.PI) * 50;
        s = lerp(sc, 0.26, e); a = lerp(a, -0.35, e);
        if (fk >= 1 && !c.landed) { c.landed = true; this.hud.landCard?.(c.q.id); g.audio?.play?.('timing_good', { vol: 0.5, pitch: 1.1 + i * 0.06 }); try { g.particles?.pixelBurst?.('sparkle', tr.x + 20, tr.y + tr.h / 2, 5, { layer: 'ui', ramp: 'gold', size: 0 }); } catch { /* optional */ } }
        if (fk > 0.05 && fk < 1) for (let j = 1; j < 4; j++) { const e2 = ease.inOutCubic(Math.max(0, fk - j * 0.07)); drawSparkle(ctx, lerp(rx, tr.x + 20, e2), lerp(ry, tr.y + tr.h / 2, e2) - Math.sin(Math.max(0, fk - j * 0.07) * Math.PI) * 50, 1, 1 - j * 0.25); }
      }
      if (!c.landed) allLanded = false;
      if (k <= 0 || c.landed) return;
      if (!c.popped) { c.popped = 1; g.audio?.play?.('ui_page', { vol: 0.5, pitch: 1 + i * 0.08 }); }
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.rotate(a);
      ctx.scale(s, s);
      this.drawCardFace(ctx, c, cw0, ch0, t, i);
      ctx.restore();
    });
    if (allLanded && b.t > b.flyAt) b.end = Math.min(b.end, b.t + 0.15);
    void q;
  }

  drawShortDone(ctx, b) {
    const g = this.game, W = this.W, H = this.H, t = this.t;
    const T = this.titleO();
    const y = Math.round(H * 0.17);
    const kout = 1 - clamp01((b.t - (b.end - 0.5)) / 0.5);
    ctx.save();
    ctx.globalAlpha *= kout;
    b.head ||= row('QUEST COMPLETE!', T.head);
    drawRow(ctx, b.head, W / 2, y, b.t, { id: 's', stagger: 0.035, dur: 0.32, drop: 40 });
    const hw = b.head ? b.head.w : 240;
    try { this.art.drawPortrait(ctx, b.q.giver, W / 2 - hw / 2 - 30, y + Math.sin(t * 5) * 2, 20, t, { talk: b.t < 1.2 ? 0.6 : 0, mood: 'excited', key: 'sdone' }); } catch { /* optional */ }
    wordNow(this.subtitle(b), T.sub);
    drawWord(ctx, this.subtitle(b), T.sub, W / 2, y + Math.round(H * 0.07), backOut((b.t - 0.3) / 0.35), 1);
    ctx.restore();
    this.drawTiles(ctx, b, [W / 2, y], y + Math.round(H * 0.14), 0.35, 1.25);
    b.cx ??= W / 2;
  }

  drawLab(ctx, b) {
    const g = this.game, H = this.H, t = this.t;
    let r = null;
    try { r = g.hud?.iconRect?.('lab'); } catch { r = null; }
    if (!r || r.y > H) { b.end = Math.min(b.end, b.t + 0.1); return; }
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const kout = 1 - clamp01((b.t - (b.end - 0.45)) / 0.45);
    ctx.save();
    ctx.globalAlpha *= kout;
    // the node icon flies from the middle of the screen into the Lab button
    const fk = clamp01((b.t - 0.5) / 0.8);
    const sx = this.W / 2, sy = H * 0.4;
    const e = ease.inOutCubic(fk);
    const ix = lerp(sx, cx, e), iy = lerp(sy, cy, e) - Math.sin(fk * Math.PI) * 60;
    if (fk < 1) {
      const pk = backOut(b.t / 0.4);
      drawAeroGlow(ctx, ix, iy, 26, '#eaffb4', 0.5);
      ctx.drawImage(aeroSurface(38, 38, { tone: 'green', r: 'pill', gloss: 0.7, glossH: 14, curve: 1, rim: 0.8, glow: 0.6 }), Math.round(ix - 19 * pk), Math.round(iy - 19 * pk), Math.round(38 * pk), Math.round(38 * pk));
      drawAnimIcon(ctx, b.node?.icon || 'beaker', ix, iy, Math.round(26 * pk * (1 - fk * 0.4)), t, 0, {});
    } else if (!b.fx.land) {
      b.fx.land = 1;
      g.audio?.play?.('ui_unlock', { vol: 0.6 });
      try { g.particles?.unlock?.(cx, cy, { layer: 'ui', ramp: 'lime' }); } catch { /* optional */ }
    }
    // the words over the button, brackets around it, Fizz peeking in
    const wk = backOut((b.t - 0.1) / 0.35);
    drawWord(ctx, 'NEW RESEARCH!', { palette: 'leaf', size: 16, depth: 3 }, cx, r.y - 30 + Math.sin(t * 3) * 1.5, wk, 1);
    if (b.node?.name) drawText(ctx, b.node.name, Math.round(cx - measureText(b.node.name, 'small') / 2), r.y - 16, { font: 'small', color: '#ffffff', shadow: '#0a3e74' });
    if (b.t > 1) drawFocusBrackets(ctx, cx, cy, Math.max(r.w, r.h) * 0.62, t, {});
    const ay = r.y - 6 + Math.round(Math.abs(Math.sin(t * 6)) * 3);
    ctx.fillStyle = '#0a3e74'; ctx.fillRect(Math.round(cx - 4), ay - 1, 9, 3); ctx.fillRect(Math.round(cx - 2), ay + 2, 5, 2);
    ctx.fillStyle = '#b6ff7a'; ctx.fillRect(Math.round(cx - 3), ay, 7, 1); ctx.fillRect(Math.round(cx - 1), ay + 2, 3, 1);
    if (this.mode() === 'full') try { this.art.drawPortrait(ctx, 'fizz', r.x - 22, r.y - 28, 16, t, { talk: b.t < 1.4 ? 0.6 : 0, mood: 'excited', key: 'lab' }); } catch { /* optional */ }
    ctx.restore();
  }

  // ---------------------------------------------------------------- claims from the Quest Log
  // QuestHud's questDone handler notes claimed quests here; the log flushes them from the button it was pressed on
  noteClaim(q, bonus) {
    const rw = this.rewardTiles(rewardList(q.reward), bonus);
    const aero = rw.find((r) => r.aero);
    if (aero) this.takeAero(aero.n);
    this.claims.push({ q, rw });
  }
  flushClaims(x, y) {
    const list = this.claims;
    this.claims = [];
    list.forEach((c, j) => {
      c.rw.forEach((r, i) => this.addFlight(r, x + (i - c.rw.length / 2) * 14, y, j * 0.12 + i * 0.08));
      this.pops.push({ q: c.q, x, y, t: -j * 0.15, dur: 1.6, side: c.q.kind === 'side' && this.mode() === 'full' });
    });
    if (list.length) { this.held = Math.max(0, this.held); this.holdStart = this.t; }
  }
  claimFx(q, x, y) { this.flushClaims(x, y); void q; }

  drawPops(ctx) {
    const t = this.t;
    for (const p of this.pops) {
      if (p.t < 0) continue;
      const k = backOut(p.t / 0.3), out = clamp01((p.t - (p.dur - 0.35)) / 0.35);
      ctx.save();
      ctx.globalAlpha *= 1 - out;
      const T = this.titleO();
      const label = p.q.kind === 'mile' ? 'MILESTONE!' : p.q.kind === 'order' ? 'ORDER FILLED!' : p.q.kind === 'orderBonus' ? 'BOARD CLEARED!' : 'QUEST COMPLETE!';
      const o = { palette: 'gold', size: 16, depth: 3 };
      wordNow(label, o);
      drawWord(ctx, label, o, p.x, p.y - 26 - p.t * 10, k, 1);
      // a side story's giver pops up beside the button and cheers
      if (p.side) {
        const px = p.x - 70, py = p.y - 20 + Math.sin(t * 6) * 2;
        try { this.art.drawPortrait(ctx, p.q.giver, px, py, Math.round(18 * k), t, { talk: p.t < 1 ? 0.6 : 0, mood: 'excited', key: 'pop' }); } catch { /* optional */ }
        this.drawEmote(ctx, px + 12, py - 18, 'heart', p.t);
      }
      ctx.restore();
      void T;
    }
  }
}

// ------------------------------------------------------------------ the panel that hosts heavy beats
export class CinePanel {
  constructor() {
    this.id = 'questcine';
    this.modal = true;
    this.cinematic = true;      // ui.drawPanels: no dim, no hotbar overlay [questcine18]
    this.closeOnOutside = false;
    this.sound = 'ui_unlock';
    this.rect = null;
  }
  get cine() { return this.game?.quests?.cine || null; }
  open() { this.t = 0; }
  close() { const c = this.cine; if (c && !c.closing) c.skip(); }
  draw(ctx, ui, dt) {
    const c = this.cine;
    if (!c) { ui.close(this.id); return; }
    try { c.drawHeavy(ctx, ui, dt); } catch (e) { console.error(e); c.cur = null; c.barsTo = 0; c.hudHidden = false; ui.close(this.id); }
  }
}

void TAU; void drawPixelBrackets; void drawPadlock; void QUEST_BY_ID;
