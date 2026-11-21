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
//   boss    [cine21] a boss quest starts (heavy, Full only): the camera pans down into the water, the boss's silhouette
//           glides past with a glowing eye, a rumble, 3D voxel "BOSS SIGHTED!" + its title, the giver's warning.
// [cine21] Bespoke staging (src/ui/cinestage.js, sets + scripts in src/ui/cinescript.js, voxel props in
// src/ui/cineprops.js): each chapter opening is a shot list on a dressed set (the ocean's voxel platform, the NPCs'
// props, critters, weather and a time-of-day grade): an establishing wide shot with a 3D location card, entrances,
// 3-6 acted lines (one / two / group / prop / reaction shots, eased moves or cuts with a dissolve, a handheld drift,
// depth-of-field dimming), gestures on *emphasised* words, emotes, the angler reacting on the boat, and a reveal pan
// to the boss's silhouette. Finales get a party shot, the cast's payoff lines and the next-ocean teaser.
//   .replay(chId, 'intro' | 'finale')   the Quest Log's cutscene gallery (plays even when cutscenes are Off; changes
//                                       nothing in the save; reopens the log on that chapter afterwards)
// Art rules: 3D voxel text for every big word (text3d.js), pixel particles only (no light rays, no ring effects).
import { clamp, clamp01, lerp, ease, TAU } from '../core/math.js';
import { mix, shade } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { buildText3D } from '../gfx/text3d.js';
import { alagardReady, loadAlagard } from '../gfx/alagard.js';
import { hiArt } from '../gfx/hires.js';
import { drawAlagard, alagardWidth, dialogueFontSize } from '../game/dialogue.js';
import * as NPC from '../gfx/npcs.js';
import { warmSeal, sealSize } from '../gfx/seal.js';
import { Stage, Typer, VOICE } from './cinestage.js'; // [cine21]
import { SETS, SCRIPTS, KEY_ACT, TIME_ICON } from './cinescript.js'; // [cine21]
import { prepProps } from './cineprops.js'; // [cine21]
import { BOSS_BY_ID, BOSS_BY_OCEAN } from '../fish/bosses.js'; // [cine21]
import { SPECIES_BY_ID } from '../fish/species.js'; // [cine21]
import { drawFishFit } from './journal.js'; // [cine21]
import { aeroSurface, drawAeroGlow, drawSparkle, drawFocusBrackets, drawPixelBrackets, drawAeroCoin } from './aero.js';
import { drawAnimIcon, drawPadlock } from './labrows.js';
import { text3dCanvas } from './pop3d.js';
import { CHAPTERS, CHAPTER_BY_ID, QUEST_BY_ID, ensureQuests, rewardList } from '../game/quests.js';
import { LAB_BY_ID, OCEAN_NAMES } from '../game/lab.js';

// stage height of each NPC as a fraction of the screen height
const NPC_H = { fizz: 72, marina: 74, dot: 56, bloat: 60 };
const STAGE_H = 0.2;
const HEAVY = { intro: 1, finale: 1, done: 1, boss: 1 };
const BOSS_O = { palette: 'coral', size: 32, depth: 4 }; // [cine21] "BOSS SIGHTED!"
const isBossQ = (q) => !!q?.objectives?.some?.((o) => o.t === 'boss');
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
    this.dlg = new Typer(game.audio); // [cine21] the cutscene typewriter (emphasis, punctuation pauses, blips)
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
    if (this.mode() === 'off' && !b.replay) return false;
    b.heavy = this.heavyOf(b);
    // merge starts into one beat; drop starts covered by a chapter opening
    if (b.kind === 'start') {
      const intro = [this.cur, ...this.queue].find((x) => x && x.kind === 'intro' && !x.replay);
      const S = ensureQuests(this.game.state);
      b.qs = b.qs.filter((q) => !(q.kind === 'main' && ((intro && q.chapter === intro.ch) || S.intro === q.chapter)));
      // [cine21] a boss quest gets its own "BOSS SIGHTED!" beat in Full
      if (this.mode() === 'full') for (const q of b.qs.filter(isBossQ)) { b.qs = b.qs.filter((x) => x !== q); this.hud.expectCard?.(q.id); this.enqueue({ kind: 'boss', q }); }
      if (!b.qs.length) return false;
      for (const q of b.qs) this.hud.expectCard?.(q.id); // its tracker row waits for the card
      const s = this.queue.find((x) => x.kind === 'start');
      if (s) { for (const q of b.qs) if (!s.qs.includes(q)) s.qs.push(q); return true; }
    }
    if (b.kind === 'boss' && [this.cur, ...this.queue].some((x) => x && x.kind === 'boss' && x.q === b.q)) return false;
    if (!b.replay && b.kind === 'intro' && [this.cur, ...this.queue].some((x) => x && x.kind === 'intro' && x.ch === b.ch && !x.replay)) return false;
    if (!b.replay && b.kind === 'finale' && [this.cur, ...this.queue].some((x) => x && x.kind === 'finale' && x.ch === b.ch && !x.replay)) return false;
    if (front) this.queue.unshift(b); else this.queue.push(b);
    // order: finale before the next chapter's opening before quest starts; completions keep their order
    // (a completion inside a chapter whose opening has not played yet waits for that opening)
    const S = ensureQuests(this.game.state);
    const rank = { done: 0, finale: 1, intro: 2, lab: 3, boss: 3.5, start: 4 };
    const rk = (x) => (x.replay ? -1 : x.kind === 'done' && x.q && S.intro === x.q.chapter ? 2.5 : rank[x.kind] ?? 5);
    this.queue.sort((a, c) => rk(a) - rk(c));
    this.warmBeat(b);
    return true;
  }

  heavyOf(b) { return b.replay || (!!HEAVY[b.kind] && !((b.kind === 'done' || b.kind === 'boss') && this.mode() === 'short')); }

  // [cine21] the Quest Log's cutscene gallery: rewatch a chapter opening / finale (no save changes)
  replay(ch, kind = 'intro') {
    if (!CHAPTER_BY_ID[ch]) return false;
    const g = this.game;
    if (this.cur?.replay) this.finish(true);
    this.queue = this.queue.filter((x) => !x.replay);
    this.enqueue({ kind: kind === 'finale' ? 'finale' : 'intro', ch, replay: true }, true);
    this.calmT = 99;
    this.forceT = 0.6;
    g.audio?.play?.('ui_unlock', { vol: 0.5 });
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
    for (const s of ['QUEST COMPLETE!', 'MILESTONE!', 'ORDER FILLED!', 'BOARD CLEARED!']) this.prep.push(prepWord(s, { palette: 'gold', size: 16, depth: 3, scale: 1.25 }));
    this.prep.push(prepWord('NEW RESEARCH!', { palette: 'leaf', size: 16, depth: 3, scale: 2 }));
    this.prep.push(prepRow('BOSS SIGHTED!', this.bossO())); // [cine21]
  }
  bossO() { return { ...BOSS_O, scale: this.H >= 600 ? 1.5 : 1.2 }; }
  // [cine21] everything a chapter's set needs: its props, the cast's poses, the 3D words, the boss
  warmSet(chId) {
    const ch = CHAPTER_BY_ID[chId], S = SETS[chId];
    if (!ch || !S) return;
    const T = this.titleO();
    const list = [];
    if (S.plat) list.push([S.plat, 0]);
    for (const [id] of S.props || []) list.push([id, 0]);
    if ((S.props || []).length > 1) list.push(['raft', 0]);
    if (S.gulls) list.push(['gull', 0]);
    if (S.penguins) list.push(['penguin', 0]);
    if (S.jellies) list.push(['jelly', 0]);
    if (S.plat) list.push(['crab', S.crab || 0]);
    this.prep.push(prepProps(list, this.H));
    this.prep.push(prepWord(OCEAN_NAMES[ch.ocean] || ch.ocean, T.ocean));
    const boss = this.bossFor(chId);
    if (boss) { this.prep.push(prepRow('BOSS SIGHTED!', this.bossO())); this.prep.push(prepWord(boss.title.toUpperCase(), T.sub)); }
    const sc = SCRIPTS[chId];
    const cast = new Set([...(sc?.intro || []), ...(sc?.finale || [])].map((x) => x.n || x.enter).filter(Boolean));
    for (const id of cast) this.warmNpc(id, ['idle', 'talk', 'cheer', 'wave', 'point', 'think', 'laugh', 'sad']);
    // the jumping fish and the boss silhouette compile their models now (not in the middle of a shot)
    const self = this;
    this.prep.push((function* () {
      const c = self.scratch ||= document.createElement('canvas');
      c.width = 4; c.height = 4;
      for (const id of [...(S.jumpers || []), boss?.id].filter(Boolean)) {
        const sp = SPECIES_BY_ID[id];
        if (!sp) continue;
        try { drawFishFit(c.getContext('2d'), sp, 2, 2, 0.5, 0, { silhouette: id === boss?.id ? '#02081a' : undefined }); } catch { /* optional */ }
        yield;
      }
    })());
  }
  bossFor(chId) {
    const ch = CHAPTER_BY_ID[chId];
    const q = ch?.quests?.find(isBossQ);
    const id = q?.objectives.find((o) => o.t === 'boss')?.id;
    return BOSS_BY_ID[id] || BOSS_BY_OCEAN[ch?.ocean] || null;
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
      if (id === 'seal') { for (const a of ['idle', 'clap', 'wave', 'wiggle', 'swim', 'spin', 'point', 'worried', 'blow', 'cheer', 'think', 'flop']) { try { warmSeal(self.sealSz(), [a], 'side'); } catch { /* optional */ } yield; } return; }
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
      if (this.mode() === 'full' || b.replay) { if (SCRIPTS[ch.id]) this.warmSet(ch.id); else for (const L of ch.intro) this.warmNpc(L.npc); }
    } else if (b.kind === 'finale' && ch) {
      this.prep.push(prepRow('CHAPTER COMPLETE!', T.big));
      this.prep.push(prepWord(ch.title.toUpperCase(), T.sub));
      this.prep.push(prepWord('DONE!', T.stamp));
      this.prep.push(prepWord('NEXT OCEAN', T.small));
      const nx = CHAPTERS[ch.n];
      if (nx) this.prep.push(prepWord(OCEAN_NAMES[nx.ocean] || nx.ocean, T.ocean));
      for (const r of rewardList(ch.reward)) if (r.n) this.prep.push(prepWord((r.key === 'aero' ? '+' : 'x') + r.n, T.num));
      if (this.mode() === 'full' || b.replay) { if (SCRIPTS[ch.id]) this.warmSet(ch.id); if (ch.outro) this.warmNpc(ch.outro.npc); }
      if (nx && this.mode() === 'full' && !b.replay) this.warmSet(nx.id); // the next opening follows right away
    } else if (b.kind === 'done' && b.q) {
      this.prep.push(prepRow('QUEST COMPLETE!', T.head));
      this.prep.push(prepWord(b.q.title.toUpperCase(), T.sub));
      for (const r of rewardList(b.q.reward)) if (r.n) this.prep.push(prepWord((r.key === 'aero' ? '+' : 'x') + r.n, T.num));
      if (b.heavy) this.warmNpc(b.q.giver);
    } else if (b.kind === 'lab') {
      this.prep.push(prepWord('NEW RESEARCH!', { palette: 'leaf', size: 16, depth: 3, scale: 2 }));
    } else if (b.kind === 'boss' && b.q) {
      const boss = this.bossFor(b.q.chapter);
      this.prep.push(prepRow('BOSS SIGHTED!', this.bossO()));
      if (boss) this.prep.push(prepWord(boss.title.toUpperCase(), T.sub));
      this.warmNpc(b.q.giver);
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
    if (mode === 'off' && this.queue.length) this.queue = []; // switched off in Settings: drop what waits
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
        if (!g.ui?.isOpen?.('questcine') || this.cur.t > 150) this.finish(!g.ui?.isOpen?.('questcine'));
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
    const wait = this.heavyOf(next) ? 0.9 : 0.5;
    if (calm && this.calmT >= wait && (!this.prep.length || this.calmT > 2 || this.forceT > 0)) this.begin(this.queue.shift());
  }
  has(kind, ch) { return [this.cur, ...this.queue].some((b) => b && b.kind === kind && b.ch === ch && !b.replay); }

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
    // (a window that shows prices never sees a held-back counter unless coins are flying into it right now)
    const window = this.game.ui?.blocking && !this.game.ui?.isOpen?.('questcine') && !this.flights.some((f) => f.aero);
    if (window || this.holdT > 1.5 || this.t - (this.holdStart ?? this.t) > 12) { this.held = 0; return; }
    const cap = (this.game.state.coins || 0) - this.held;
    if (Number.isFinite(ui.coinShown) && ui.coinShown > cap) ui.coinShown = Math.max(0, cap);
  }

  // ---------------------------------------------------------------- beats: start / finish
  begin(b) {
    const g = this.game;
    b.t = 0;
    b.fx = {};
    // several completions at once play as one beat (the first giver cheers, the rewards are pooled)
    b.heavy = this.heavyOf(b); // (the Settings switch may have changed while it waited)
    if (b.kind === 'done') while (this.queue[0]?.kind === 'done') (b.more ||= []).push(this.queue.shift());
    this.cur = b;
    const S = ensureQuests(g.state);
    if (!b.replay && b.kind === 'intro' && S.intro !== b.ch) { this.cur = null; return; }
    if (!b.replay && b.kind === 'finale' && S.outro !== b.ch) { this.cur = null; return; }
    if (b.kind === 'boss' && (!b.q || S.done[b.q.id])) { if (b.q) this.hud.landCard?.(b.q.id); this.cur = null; return; }
    if (b.heavy) {
      this.plan(b);
      if (!g.ui?.isOpen?.('questcine')) {
        const p = g.ui?.panels?.questcine;
        if (!p) { this.cur = null; return; }
        p.sound = b.kind === 'intro' ? 'whale_call' : b.kind === 'finale' ? 'catch_legendary' : b.kind === 'boss' ? 'roar' : 'ui_unlock';
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
    try { b.stage?.end(); } catch { /* optional */ } // [cine21] the angler gets its boat back
    if (!b.replay) {
      if (b.kind === 'intro' && S.intro === b.ch && (!cut || b.t > 1)) { S.intro = null; g.save?.(); }
      if (b.kind === 'finale' && S.outro === b.ch && (!cut || b.t > 1)) { S.outro = null; g.save?.(); }
      if (b.kind === 'intro' && cut && b.t <= 1) (this.skipIntro ||= {})[b.ch] = true; // do not loop back into it this session
      // anything still to hand over goes now
      if (b.rewards && !b.flew) this.launch(b);
      if (b.cards) for (const c of b.cards) if (c.fly && !c.landed) { c.landed = true; this.hud.landCard?.(c.q.id); }
      if (b.kind === 'boss' && b.q) this.hud.landCard?.(b.q.id);
      if (b.kind === 'finale' && S.intro && this.mode() !== 'off') this.enqueue({ kind: 'intro', ch: S.intro }, true);
    }
    if (b.heavy) {
      this.hudHidden = false;
      // the next heavy beat continues in the same panel (bars and camera stay)
      const nx = this.queue[0];
      if (!cut && !b.replay && b.kind === 'finale' && nx && nx.kind === 'intro' && this.calmIgnoringUs()) { this.begin(this.queue.shift()); if (this.cur) return; }
      this.barsTo = 0;
      if (b.cam) { try { g.camera.release(2.2); } catch { /* optional */ } }
      if (g.ui?.isOpen?.('questcine')) { this.closing = true; g.ui.close('questcine'); this.closing = false; }
      // [cine21] a gallery replay hands back to the Quest Log, on that chapter
      if (b.replay && g.ui?.panels?.quests && !g.ui.blocking) { try { g.ui.open('quests', { tab: 'story', chapter: b.ch }); } catch { /* optional */ } }
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
    const full = b.replay || this.mode() === 'full';
    b.cam = false;
    let side = 1;
    if (full && cam?.open && boat?.visible && Number.isFinite(boat.x) && Number.isFinite(boat.y)) {
      side = boat.x < W / 2 ? 1 : -1;
      const zT = (cam.baseZoom?.() || 2) * 1.5;
      b.world = { x: boat.x + side * 64, y: boat.y, zT, side };
      b.cam = true;
    } else b.world = null;
    b.side = side;
    b.cx = Math.round(side > 0 ? W * 0.64 : W * 0.36); // content column, opposite the NPC
    if (!b.world) b.cx = Math.round(W / 2);
    b.full = full;
    this.hudHidden = true;
    this.barsTo = 1;
    const T = this.titleO();
    const ch = CHAPTER_BY_ID[b.ch];
    // [cine21] the stage: a dressed set for chapter openings / finales, a bare one for completions and bosses
    const setCh = b.kind === 'intro' || b.kind === 'finale' ? b.ch : null;
    b.stage = new Stage(this, b, setCh || b.q?.chapter || 'ch1', { bare: !(full && setCh && SETS[setCh]) });
    if (b.cam) b.stage.shot('stage', { cut: false });
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
      const sc = full ? SCRIPTS[ch.id] : null;
      b.steps = sc ? sc.intro.slice() : full ? [...ch.intro.map((L) => ({ n: L.npc, s: L.text }))] : [];
      if (sc && !this.bossFor(ch.id)) b.steps = b.steps.filter((x) => !x.boss);
      b.si = 0;
      b.phase = full ? 'script' : 'title';
      b.pt = 0;
      b.title = row(ch.title.toUpperCase(), T.chap);
      this.introCards(b, ch);
    } else if (b.kind === 'finale') {
      try { g.camera.slowmo(0.2, 0.6); } catch { /* optional */ }
      b.title = row('CHAPTER COMPLETE!', T.big);
      b.phase = 'party';
      b.pt = 0;
      b.cards = ch.quests.map((q, i) => ({ q, i, face: true, done: true }));
      b.rewards = this.rewardTiles(rewardList(ch.reward), 0);
      b.next = CHAPTERS[ch.n] || null;
      const sc = full ? SCRIPTS[ch.id] : null;
      b.steps = sc ? sc.finale.slice() : [];
      b.si = 0;
      if (b.cam) b.stage.shot('stage', { cut: true });
      // the cast of the payoff lines pops up for the party
      const cast = [...new Set(b.steps.map((x) => x.n).filter(Boolean))];
      if (full) cast.forEach((id, i) => b.stage.events.push({ at: 0.15 + i * 0.35, fn: () => b.stage.enter(id) }));
      if (full) b.stage.events.push({ at: 0.9, fn: () => b.stage.player('cheer', 2.4) });
    } else if (b.kind === 'boss') {
      b.boss = this.bossFor(b.q.chapter);
      b.phase = 'reveal';
      b.pt = 0;
      b.cards = [{ q: b.q, i: 0, face: true, fly: true }];
      this.hud.expectCard?.(b.q.id);
      b.title = row('BOSS SIGHTED!', this.bossO());
      if (b.cam) b.stage.shot('stage', { cut: false });
    }
  }

  introCards(b, ch) {
    const S = ensureQuests(this.game.state), book = this.hud.book;
    const act = new Set(book.active().map((q) => q.id));
    b.cards = ch.quests.map((q, i) => ({ q, i, face: !!S.done[q.id] || act.has(q.id), done: !!S.done[q.id], fly: !b.replay && act.has(q.id) && !S.done[q.id] }));
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

  // ---------------------------------------------------------------- drawing heavy beats (CinePanel.draw)
  drawHeavy(ctx, ui, dt) {
    const b = this.cur;
    const g = this.game;
    if (!b || !b.heavy) { this.drawBars(ctx); return; }
    b.t += dt;
    // input: click = next / fast-forward; Esc is handled by the ui (it closes the panel -> skip)
    const click = ui.inp.pressed || g.input?.keyPressed?.(' ') || g.input?.keyPressed?.('Enter');
    if (ui.inp.pressed) ui.inp.pressed = false;
    if (click) this.advance(b);
    this.dlg.update(dt);
    try { b.stage?.update(dt); } catch (e) { if (!this.stageErr) { this.stageErr = true; console.error(e); } }
    if (b.kind === 'done') this.drawDone(ctx, b, dt);
    else if (b.kind === 'intro') this.drawIntro(ctx, b, dt);
    else if (b.kind === 'finale') this.drawFinale(ctx, b, dt);
    else if (b.kind === 'boss') this.drawBossBeat(ctx, b, dt);
    this.drawFlights(ctx);
    this.drawSkipHint(ctx, b);
    if (this.cur === b && b.t >= b.end) this.finish(false);
  }

  advance(b) {
    const d = this.dlg;
    if (d.active) { if (d.typing) d.finishTyping(); else d.next(); return; }
    if (b.wait > b.t) { b.wait = b.t; return; }
    if (b.stepOn && b.stepEnd > b.t) { b.stepEnd = b.t; return; } // [cine21] skip the rest of a staged step
    if (b.pendingSay) { b.sayAt = b.t; return; }
    // fast-forward to the next beat mark
    if (b.kind === 'done') { const m = [b.marks.rw + 0.6, b.end - 1.4, b.end]; const n = m.find((x) => x > b.t + 0.05); if (n !== undefined) b.t = n; }
    else if (b.phase) b.pt = Math.max(b.pt, b.phaseEnd ?? b.pt);
  }
  // the camera goes back to the player (the stage stops steering it)
  releaseCam(b, speed = 2.2) {
    if (b.stage) b.stage.camFree = true;
    if (b.cam) { try { this.game.camera.release(speed); } catch { /* optional */ } }
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

  // [cine21] the bottom bar: glass key caps (CLICK = next / fast-forward, ESC = skip) and the scene's progress pips
  drawSkipHint(ctx, b) {
    if (this.bars < 0.6) return;
    const W = this.W, H = this.H, bh = Math.round(H * 0.105);
    const y = H - Math.round(bh / 2) - 4 + Math.round((1 - this.bars) * bh);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * 0.9;
    const cap = (key, label, x) => {
      const kw = measureText(key, 'small') + 8, lw = measureText(label, 'small');
      ctx.drawImage(aeroSurface(kw, 11, { tone: 'white', r: 3, gloss: 0.6, glossH: 4, curve: 1, rim: 0.6, glow: 0.2 }), Math.round(x - kw - lw - 5), y - 3);
      drawText(ctx, key, Math.round(x - kw - lw - 1), y - 1, { font: 'small', color: '#0a3e74' });
      drawText(ctx, label, Math.round(x - lw), y, { font: 'small', color: '#9fdcff' });
      return x - kw - lw - 16;
    };
    let x = W - 14;
    x = cap('ESC', 'SKIP', x);
    cap('CLICK', this.dlg.active && this.dlg.typing ? 'FAST' : 'NEXT', x);
    // progress pips: one per spoken line of the scene
    const steps = (b.steps || []).filter((s) => s.n);
    if (steps.length > 1) {
      const done = (b.steps || []).slice(0, b.si ?? 0).filter((s) => s.n).length + (this.dlg.active ? 1 : 0);
      for (let i = 0; i < steps.length; i++) {
        const px = 16 + i * 9, on = i < done;
        ctx.fillStyle = '#04182e'; ctx.fillRect(px - 1, y - 1, 7, 7);
        ctx.fillStyle = on ? (i === done - 1 ? '#ffe066' : '#7ad8ff') : '#1d4f86'; ctx.fillRect(px, y, 5, 5);
        if (on) { ctx.fillStyle = '#ffffff'; ctx.fillRect(px, y, 2, 1); }
      }
    }
    ctx.globalAlpha = a0;
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
  say(npc, text, o = {}) { this.dlg.now(npc, text, o); }
  // word wrap that keeps character indices (for the typewriter and the *emphasis* colouring)
  wrapEm(text, maxW, fs) {
    const lines = [];
    let s = 0, e = 0, i = 0;
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) words.push([m.index, m.index + m[0].length]);
    for (const [a, z] of words) {
      if (i === 0) { s = a; e = z; i = 1; continue; }
      if (alagardWidth(text.slice(s, z), fs) > maxW) { lines.push({ s, e }); s = a; }
      e = z;
    }
    if (i) lines.push({ s, e });
    return lines;
  }
  drawBox(ctx, b, o = {}) {
    const d = this.dlg;
    if (!d.active) return null;
    const W = this.W, H = this.H, t = this.t;
    let fs = this.fontSize(o.small);
    const w = Math.round(Math.min(W - 32, o.w || Math.max(440, W * 0.58)));
    const tx0 = 70, maxTW = w - tx0 - 28;
    let lines = this.wrapEm(d.text, maxTW, fs);
    // never overflow: a smaller face before a fourth line
    while (lines.length > 3 && fs > 14) { fs -= 2; lines = this.wrapEm(d.text, maxTW, fs); }
    const LH = Math.round(fs * 0.86) + 4;
    const h = Math.max(70, lines.length * LH + 30);
    const kin = backOut(d.t * 4.5);
    const x = Math.round(o.x ?? (o.cx != null ? clamp(o.cx - w / 2, 12, W - w - 12) : (W - w) / 2));
    const y0 = Math.round(o.y ?? H - Math.round(H * 0.105) - h + 12);
    const y = Math.round(y0 + (1 - kin) * 30);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * clamp01(d.t * 6);
    const col = this.art.NPC_COL[d.npc] || '#8fdcff';
    ctx.drawImage(aeroSurface(w, h, { top: '#3aa4f0', mid: '#1468c0', bot: '#0a3f86', a: [0.97, 0.98], edge: '#04264e', r: 12, gloss: 0.35, glossH: 18, curve: 2, rim: 0.85, glow: 0.5, glowColor: '#7ad8ff', bubbles: 4, seed: 61 }), x, y);
    // a speaker-coloured stripe down the portrait side
    ctx.fillStyle = shade(col, -0.25); ctx.fillRect(x + 6, y + 10, 3, h - 20);
    ctx.fillStyle = mix(col, '#ffffff', 0.4); ctx.fillRect(x + 6, y + 10, 1, h - 20);
    // name plate (in the speaker's colour) on the top edge
    const name = this.art.npcName(d.npc).toUpperCase();
    const nfs = 16, nw = Math.min(w - tx0, Math.ceil(alagardWidth(name, nfs)) + 22), nh = 19;
    const plate = { top: mix(col, '#ffffff', 0.6), mid: col, bot: shade(col, -0.3), edge: shade(col, -0.6), a: [1, 1] };
    ctx.drawImage(aeroSurface(nw, nh, { tone: plate, r: 'pill', gloss: 0.8, glossH: 7, curve: 1, rim: 0.8, glow: 0.4 }), x + tx0 - 6, y - 11);
    drawAlagard(ctx, name, x + tx0 + 5, y - 10, { size: nfs, color: '#ffffff', shadow: shade(col, -0.65) });
    // portrait, overlapping the left edge
    const pr = Math.round(Math.min(32, h * 0.46));
    try { this.art.drawPortrait(ctx, d.npc, x + 36, y + h / 2, pr, t, { talk: d.talk, mood: o.mood || 'happy', key: 'cine' }); } catch { /* optional */ }
    // typed text, *emphasis* in the speaker's colour with a little bob
    const shown = Math.floor(d.shown);
    const ty = y + Math.round((h - lines.length * LH) / 2) - 1;
    const emC = mix(col, '#ffffff', 0.3), emS = shade(col, -0.7);
    const isEm = (i) => d.emph.some(([a, z]) => i >= a && i < z);
    lines.forEach((ln, li) => {
      const e = Math.min(ln.e, shown);
      if (e <= ln.s) return;
      let i = ln.s;
      while (i < e) {
        const em = isEm(i);
        let j = i + 1;
        while (j < e && isEm(j) === em) j++;
        const px = x + tx0 + 4 + alagardWidth(d.text.slice(ln.s, i), fs);
        const bob = em ? Math.round(Math.sin(t * 6 + i * 0.5) * 1) : 0;
        drawAlagard(ctx, d.text.slice(i, j), Math.round(px), ty + li * LH + bob, { size: fs, color: em ? emC : '#ffffff', shadow: em ? emS : '#04264e' });
        i = j;
      }
    });
    if (d.waiting) {
      const bob = Math.round(Math.sin(t * 7) * 2), ax = x + w - 18, ay = y + h - 13 + bob;
      ctx.fillStyle = '#04264e'; ctx.fillRect(ax - 5, ay - 2, 11, 2); ctx.fillRect(ax - 3, ay, 7, 2); ctx.fillRect(ax - 1, ay + 2, 3, 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(ax - 4, ay - 3, 9, 2); ctx.fillRect(ax - 2, ay - 1, 5, 2); ctx.fillRect(ax, ay + 1, 1, 2);
    }
    ctx.globalAlpha = a0;
    return { x, y, w, h };
  }
  emoteFor(text, cheer) {
    if (cheer) return Math.random() < 0.5 ? 'heart' : 'star';
    if (/\?/.test(text)) return 'question';
    if (/!/.test(text)) return /SCIENCE|Eureka|wonderful/i.test(text) ? 'sparkle' : 'exclaim';
    return 'heart';
  }

  // ---------------------------------------------------------------- [cine21] the scene runner (scripted steps)
  // -> true when every step has played
  runScript(b) {
    const st = b.stage;
    if (b.pendingSay && b.t >= b.sayAt) { const f = b.pendingSay; b.pendingSay = null; f(); }
    for (let guard = 0; guard < 8; guard++) {
      const S = b.steps?.[b.si];
      if (!S) return true;
      if (!b.stepOn) { b.stepOn = true; b.lineDone = false; b.stepEnd = b.t; this.startStep(b, S); }
      if (S.n ? !b.lineDone : b.t < b.stepEnd) return false;
      if (S.boss) { b.reveal = null; st.shot('group'); }
      b.si++; b.stepOn = false; b.sp = null;
    }
    return false;
  }
  startStep(b, S) {
    const st = b.stage;
    if (S.wide) { st.shot('wide', { cut: true }); b.card = b.t; b.cardEnd = b.t + S.wide; b.stepEnd = b.t + S.wide; return; }
    if (S.enter) {
      const a = st.enter(S.enter, S.how);
      if (!b.firstIn) { b.firstIn = 1; st.shot('stage'); } else st.shot('group');
      b.stepEnd = b.t + st.entryT(a) + 0.2;
      return;
    }
    if (S.prop) {
      st.bringProp(S.prop);
      const p = st.props.find((q) => q.id === S.prop);
      st.shot('prop', { id: p?.owner });
      b.stepEnd = b.t + 1.05;
      return;
    }
    if (S.fx) {
      st.fx(S.fx, { at: S.at });
      if (S.shot) st.shot(S.shot, { id: S.at });
      else if (['penguin', 'spark', 'neon', 'crab'].includes(S.fx)) st.shot('set');
      else if (S.fx === 'gull') st.shot('prop', { id: 'marina' });
      b.stepEnd = b.t + (S.wait ?? 1);
      return;
    }
    if (S.boss) { b.reveal = { t0: b.t, boss: this.bossFor(b.ch), fx: {} }; st.shot('boss'); b.stepEnd = b.t + 5; return; }
    if (S.n) this.startLine(b, S);
  }
  startLine(b, L) {
    const st = b.stage, g = this.game;
    let a = st.actors.get(L.n);
    let delay = 0;
    if (!a || a.state === 'gone') { a = st.enter(L.n); delay = st.entryT(a); }
    const kind = L.shot || (L.to && L.to !== 'player' ? 'two' : 'one');
    const prevK = st.shotK?.kind;
    b.lineN = (b.lineN || 0) + 1;
    // mostly eased camera moves; every third change of framing is a cut with a dissolve
    const cut = kind !== prevK && prevK !== 'wide' && prevK !== 'boss' && b.lineN % 3 === 0;
    st.shot(kind, { id: L.n, to: L.to || (kind === 'two' ? 'player' : undefined), cut });
    st.faceAll(L.n, L.to);
    if (L.fx) st.fx(L.fx, { at: L.n });
    if (L.emote) st.events.push({ at: st.t + delay + 0.15, fn: () => st.emote(L.n, L.emote) });
    for (const [id, an] of Object.entries(L.re || {})) st.events.push({ at: st.t + delay + 0.8, fn: () => st.act(id, an, 1.5) });
    if (L.pl) st.events.push({ at: st.t + delay + (L.pl === 'jump' ? 0.35 : 0.9), fn: () => st.player(L.pl, 2.2) });
    // a big reaction gets a reaction close-up on the angler, then back to the speaker
    if ((L.pl === 'jump' || L.pl === 'laugh') && kind === 'one' && st.world) {
      st.events.push({ at: st.t + delay + 1.25, fn: () => { if (b.si < b.steps.length && b.steps[b.si] === L) st.shot('player', { cut: true, dissolve: false }); } });
      st.events.push({ at: st.t + delay + 2.55, fn: () => { if (b.steps[b.si] === L && st.shotK?.kind === 'player') st.shot(kind, { id: L.n, to: L.to, cut: true, dissolve: false }); } });
    }
    b.sp = { id: L.n, act: L.act || 'talk', after: L.after, line: L };
    const say = () => this.say(L.n, L.s, {
      onDone: () => { b.lineDone = true; },
      onKey: () => {
        const ac = st.actors.get(L.n);
        if (ac) ac.key = { anim: L.key || KEY_ACT[L.n] || 'cheer', until: st.t + 0.9 };
        g.audio?.play?.('ui_tab', { vol: 0.22, pitch: 1.5 });
        if (ac?.scr) try { g.particles?.pixelBurst?.('sparkle', ac.scr.top[0], ac.scr.top[1], 3, { layer: 'ui', ramp: 'gold', size: 0 }); } catch { /* optional */ }
      },
    });
    if (delay > 0) { b.sayAt = b.t + delay; b.pendingSay = say; } else say();
  }
  speaker(b) {
    if (!b.sp) return null;
    const d = this.dlg;
    return { ...b.sp, typing: d.active && d.npc === b.sp.id && d.typing };
  }

  // [cine21] location card: the ocean's name in 3D voxel letters + the time of day, during the establishing shot
  drawLocCard(ctx, b, ch) {
    if (b.card == null) return;
    const H = this.H, t = this.t;
    const u = b.t - b.card, out = clamp01((b.t - (b.cardEnd ?? b.card + 2.8) + 0.45) / 0.45);
    const kin = clamp01(u / 0.55);
    if (kin <= 0 || out >= 1) return;
    const T = this.titleO(), name = OCEAN_NAMES[ch.ocean] || ch.ocean;
    const c = wordNow(name, T.ocean);
    const cw = c ? c.width : 160;
    const bh = Math.round(H * 0.105);
    const x0 = 28 + cw / 2, y = H - bh - Math.round(H * 0.09);
    const x = lerp(-cw, x0, ease.outCubic(kin)) - out * 40;
    ctx.save();
    ctx.globalAlpha *= 1 - out;
    drawAeroGlow(ctx, x, y, cw * 0.7, '#06264e', 0.45);
    drawWord(ctx, name, T.ocean, x, y, 1, 1);
    const rw = Math.round(cw * ease.outCubic(clamp01((u - 0.3) / 0.5)));
    ctx.fillStyle = '#04264e'; ctx.fillRect(Math.round(x - cw / 2) - 1, y + Math.round((c?.height || 30) / 2) + 2, rw + 2, 4);
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(Math.round(x - cw / 2), y + Math.round((c?.height || 30) / 2) + 3, rw, 2);
    const time = SETS[ch.id]?.time || '';
    if (time && u > 0.45) {
      const ic = getUiIcon(TIME_ICON[SETS[ch.id]?.weather] || 'sun');
      const ty = y + Math.round((c?.height || 30) / 2) + 10;
      if (ic) ctx.drawImage(ic, Math.round(x - cw / 2), ty - 2);
      drawText(ctx, `CHAPTER ${ch.n}  -  ${time}`, Math.round(x - cw / 2 + (ic ? ic.width + 5 : 0)), ty, { font: 'small', color: '#ffffff', shadow: '#04264e' });
    }
    ctx.restore();
    void t;
  }

  // [cine21] "BOSS SIGHTED!" + the boss's name, the rumble and everyone's reaction; u = seconds into the reveal
  drawBossTitle(ctx, b, R, u) {
    const g = this.game, H = this.H, st = b.stage;
    const boss = R?.boss;
    if (!boss) return;
    if (u > 1.15 && !R.fx.rumble) {
      R.fx.rumble = 1;
      try { g.camera.shake(g.state.settings.reducedMotion ? 1 : 6); } catch { /* optional */ }
      g.audio?.play?.('roar', { vol: 0.6, pitch: 0.6 }); g.audio?.play?.('thunder', { vol: 0.35 });
      st.scareGulls();
      for (const a of st.actors.values()) { st.act(a.id, a.id === 'seal' ? 'flop' : 'worried', 1.4); st.emote(a.id, 'exclaim'); a.hop = 6; }
      st.player('jump', 1.4, 'exclaim');
    }
    const out = clamp01((u - 4.3) / 0.5);
    if (out >= 1) return;
    const bh = this.barH();
    const hy = Math.round(Math.max(bh, H * 0.06) + H * 0.1);
    ctx.save();
    ctx.globalAlpha *= 1 - out;
    const R2 = b.bossRow ||= row('BOSS SIGHTED!', this.bossO());
    if (u > 1.25) {
      drawAeroGlow(ctx, this.W / 2, hy, Math.round(H * 0.3), '#2a0612', 0.45);
      drawRow(ctx, R2, this.W / 2, hy, u - 1.3, { id: 'bs', fx: R.fx, stagger: 0.045, drop: 60, onLand: (x, y, i) => { if (i % 3 === 0) try { g.particles?.pixelBurst?.('dust', x, y + 6, 2, { layer: 'ui', speed: [14, 40] }); } catch { /* optional */ } if (i === 0) g.audio?.play?.('timing_perfect', { vol: 0.4, pitch: 0.6 }); } });
      const T = this.titleO();
      const nm = boss.title.toUpperCase();
      wordNow(nm, T.sub);
      const tk = clamp01((u - 2.1) / 0.35);
      if (tk > 0) {
        drawWord(ctx, nm, T.sub, this.W / 2, hy + Math.round(H * 0.08), backOut(tk), tk);
        if (boss.sub) drawText(ctx, boss.sub.toUpperCase(), Math.round(this.W / 2 - measureText(boss.sub.toUpperCase(), 'small') / 2), hy + Math.round(H * 0.08) + 14, { font: 'small', color: '#ffd0c8', shadow: '#2a0612' });
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- beat: main quest complete (heavy)
  drawDone(ctx, b, dt) {
    const g = this.game, W = this.W, H = this.H, M = b.marks, st = b.stage;
    const T = this.titleO();
    const outT = b.end - 1.35;
    if (b.t > outT && !b.fx.out) { b.fx.out = 1; this.barsTo = this.chainNext() ? 1 : 0; this.hudHidden = !!this.chainNext(); if (!this.chainNext()) this.releaseCam(b); st.exitAll(); }
    // the giver (behind the bars): pops out of the water, waves, then cheers; the angler cheers along
    if (b.t > M.npc && !b.fx.npcIn) { b.fx.npcIn = 1; st.enter(b.q.giver); st.act(b.q.giver, 'wave', 1); }
    st.drawBack(ctx);
    const sp = b.fx.talk && !b.fx.out ? { id: b.q.giver, act: 'talk', after: 'cheer', typing: this.dlg.typing } : null;
    const cast = st.drawCast(ctx, sp);
    const npc = cast[b.q.giver] || null;
    st.drawFront(ctx);
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
    if (b.t > M.talk && !b.fx.talk && M.npc >= 0) {
      b.fx.talk = 1;
      this.say(b.q.giver, b.line, { hold: 1.1 });
      st.emote(b.q.giver, this.emoteFor(b.line, true));
      st.player('cheer', 2);
      try { g.particles?.hearts?.(npc?.top?.[0] ?? b.cx, npc?.top?.[1] ?? H / 2, 3, { layer: 'ui' }); } catch { /* optional */ }
    }
    if (this.dlg.active) { if (b.fx.out) this.dlg.clear(); else this.drawBox(ctx, b, { w: Math.min(W - 40, 460), cx: b.cx }); }
    // reward reveal: tiles burst from the NPC (or the title) into a row, then fly into the HUD
    const from = npc ? [npc.x, npc.y - H * 0.08] : [b.cx, hy];
    this.drawTiles(ctx, b, from, hy + Math.round(H * 0.17), M.rw, outT + 0.25);
    if (!b.fx.conf && b.t > M.head + 0.35) { b.fx.conf = 1; try { g.particles?.celebrate?.(b.cx, hy, 0.9, { layer: 'ui' }); } catch { /* optional */ } }
    void dt;
  }
  chainNext() { return false; } // a completion always hands its rewards over in the open (bars out, HUD back)

  // ---------------------------------------------------------------- [cine21] beat: a boss quest starts (heavy)
  drawBossBeat(ctx, b, dt) {
    const g = this.game, W = this.W, st = b.stage;
    b.pt += dt;
    b.end ??= 999;
    if (!b.reveal) { b.reveal = { t0: b.t, boss: b.boss, fx: {} }; st.shot('boss'); g.audio?.play?.('sonar', { vol: 0.4 }); }
    st.drawBack(ctx);
    if (b.phase === 'reveal') st.drawBoss(ctx, b.reveal.boss, b.t - b.reveal.t0, 5);
    st.drawCast(ctx, this.speaker(b));
    st.drawFront(ctx);
    this.drawBars(ctx);
    if (b.phase === 'reveal') {
      this.drawBossTitle(ctx, b, b.reveal, b.t - b.reveal.t0);
      b.phaseEnd = 5;
      if (b.pt > 5) { b.phase = 'warn'; b.pt = 0; st.shot('stage'); b.steps = [{ n: b.q.giver, s: b.q.text, shot: 'one', to: 'player', act: 'point', key: KEY_ACT[b.q.giver], emote: 'exclaim', pl: 'flex' }]; b.si = 0; }
    }
    if (b.phase === 'warn') {
      if (this.runScript(b)) { b.phase = 'cards'; b.pt = 0; this.dlg.clear(); st.shot('stage'); st.exitAll(0.6); }
      if (this.dlg.active) this.drawBox(ctx, b);
      b.phaseEnd = b.pt;
    }
    if (b.phase === 'cards' || b.phase === 'fly') this.drawCards(ctx, b);
    if (b.phase === 'cards') { b.phaseEnd = 0.8; if (b.pt > 1.4) { b.phase = 'fly'; b.pt = 0; this.barsTo = 0; this.hudHidden = false; this.releaseCam(b); g.audio?.play?.('travel_whoosh', { vol: 0.3, pitch: 1.4 }); } }
    if (b.phase === 'fly') { b.phaseEnd = 1.4; if (b.pt > 1.3) b.end = b.t; }
    void W;
  }

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
    if (b.replay) { for (const r of b.rewards || []) r.gone = true; return; } // [cine21] a gallery replay grants nothing
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
    const g = this.game;
    const ch = CHAPTER_BY_ID[b.ch];
    if (!ch) { b.t = b.end = 0; return; }
    const T = this.titleO();
    const st = b.stage;
    b.pt += dt;
    b.end ??= 999;
    // ---- the stage: set, boss silhouette, the cast, critters and weather
    st.drawBack(ctx);
    if (b.reveal) st.drawBoss(ctx, b.reveal.boss, b.t - b.reveal.t0, 5);
    st.drawCast(ctx, this.speaker(b));
    st.drawFront(ctx);
    this.drawBars(ctx);
    // ---- phases
    if (b.phase === 'script') {
      if (this.runScript(b)) { b.phase = 'title'; b.pt = 0; this.dlg.clear(); b.reveal = null; st.shot('stage'); }
      this.drawLocCard(ctx, b, ch);
      if (b.reveal) this.drawBossTitle(ctx, b, b.reveal, b.t - b.reveal.t0);
      if (this.dlg.active) this.drawBox(ctx, b);
      b.phaseEnd = b.pt;
    }
    if (b.phase === 'title' || b.phase === 'cards' || b.phase === 'fly') this.drawChapterTitle(ctx, b, ch, T);
    if (b.phase === 'title') {
      b.phaseEnd = 1.3;
      if (b.pt > 0.3 && !b.fx.plCheer) { b.fx.plCheer = 1; st.player('cheer', 1.8); for (const a of st.actors.values()) st.act(a.id, a.id === 'seal' ? 'clap' : 'cheer', 1.6); }
      if (b.pt > 1.5) { b.phase = 'cards'; b.pt = 0; }
    }
    if (b.phase === 'cards' || b.phase === 'fly') this.drawCards(ctx, b);
    if (b.phase === 'cards') {
      const n = b.cards.length;
      if (!b.fx.exit) { b.fx.exit = 1; st.exitAll(0.2); } // the cast dives away while the cards are dealt
      b.phaseEnd = 0.25 + n * 0.08 + 0.5;
      if (b.pt > 0.25 + n * 0.08 + 1.5) { b.phase = 'fly'; b.pt = 0; }
    }
    if (b.phase === 'fly') {
      if (!b.fx.fly) {
        b.fx.fly = 1;
        const S = ensureQuests(g.state);
        if (!b.replay && S.intro === b.ch) { S.intro = null; g.save?.(); }
        this.barsTo = 0; this.hudHidden = false;
        this.releaseCam(b);
        g.audio?.play?.('travel_whoosh', { vol: 0.3, pitch: 1.4 });
      }
      b.phaseEnd = 2;
      if (b.pt > 1.9) b.end = b.t;
    }
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
    const st = b.stage;
    b.pt += dt;
    b.end ??= 999;
    const n = b.cards.length;
    const outro = b.full && ch.outro ? ch.outro : null;
    const S0 = 1.05, stampEnd = S0 + n * 0.17 + 0.35;
    // [cine21] the stage: the chapter's set, the cast partying, then their payoff lines and the farewell
    st.drawBack(ctx);
    st.drawCast(ctx, this.speaker(b));
    st.drawFront(ctx);
    this.drawBars(ctx);
    const bh = Math.round(H * 0.105);
    const hy = Math.round(bh + H * 0.1);
    const fade = b.phase === 'out' ? 1 - clamp01(b.pt / 0.5) : 1;
    // the title and the rewards step back while the cast talks
    b.dim = lerp(b.dim ?? 1, b.phase === 'talk' ? 0.35 : 1, 1 - Math.exp(-dt * 6));
    ctx.save();
    ctx.globalAlpha *= fade * b.dim;
    drawAeroGlow(ctx, b.cx, hy, Math.round(H * 0.32), '#06264e', 0.4 * clamp01(b.t * 3));
    b.title ||= row('CHAPTER COMPLETE!', T.big);
    drawRow(ctx, b.title, b.cx, hy, b.t - 0.25, { id: 'f', fx: b.fx, stagger: 0.05, onLand: (x, y, i) => { if (i % 2 === 0) try { g.particles?.pixelBurst?.('star', x, y, 2, { layer: 'ui', ramp: 'gold', size: 0 }); } catch { /* optional */ } } });
    drawWord(ctx, ch.title.toUpperCase(), T.sub, b.cx, hy + Math.round(H * 0.08), backOut((b.t - 0.9) / 0.4), clamp01((b.t - 0.9) * 4));
    if (!b.fx.conf && b.t > 0.9) {
      b.fx.conf = 1;
      try { g.particles?.aeroConfetti?.(b.cx, hy - 10, 40, { layer: 'ui' }); g.particles?.celebrate?.(b.cx - 120, hy, 1, { layer: 'ui' }); g.particles?.celebrate?.(b.cx + 120, hy, 1, { layer: 'ui' }); } catch { /* optional */ }
      g.audio?.play?.('golden_shimmer', { vol: 0.5 });
      for (const a of st.actors.values()) st.act(a.id, a.id === 'seal' ? 'clap' : 'cheer', 2);
    }
    if (b.phase === 'party') { b.phaseEnd = 1.3; if (b.pt > 1.5) { b.phase = 'stamp'; b.pt = 0; } }
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
        const out = clamp01((b.pt - stampEnd - 0.3) / 0.3);
        ctx.save();
        ctx.globalAlpha *= 1 - out;
        ctx.translate(Math.round(x), Math.round(y + (1 - ease.outCubic(k)) * 20 + out * 20));
        ctx.scale(sc * backOut(k), sc * backOut(k));
        this.drawCardFace(ctx, c, cw0, ch0, t, i, false);
        const sk = (b.pt - S0 - i * 0.17) / 0.16;
        if (sk > 0) {
          this.drawStamp(ctx, cw0 * 0.08, ch0 * 0.16, sk < 1 ? 2.4 - 1.4 * ease.inCubic(sk) : 1, -0.18 + (i % 3) * 0.08);
          if (sk >= 1 && !c.stamped) {
            c.stamped = 1;
            g.audio?.play?.(i === n - 1 ? 'timing_perfect' : 'timing_good', { vol: 0.55, pitch: 0.85 + i * 0.04 });
            try { g.camera.shake(g.state.settings.reducedMotion ? 0 : 1.2); g.particles?.pixelBurst?.('dust', x, y + 8, 4, { layer: 'ui', speed: [20, 50] }); g.particles?.pixelBurst?.('sparkle', x, y, 3, { layer: 'ui', ramp: 'lime', size: 0 }); } catch { /* optional */ }
            if (i === n - 1) { st.player('jump', 1.2, 'star'); for (const a of st.actors.values()) st.act(a.id, a.id === 'seal' ? 'wiggle' : 'cheer', 1.2); }
          }
        }
        ctx.restore();
      });
      b.phaseEnd = stampEnd - 0.2;
      if (b.pt > stampEnd + 0.6) { b.phase = 'reward'; b.pt = 0; b.rwAt = b.t; }
    }
    ctx.restore();
    // the chapter reward pops out (it stays until the bars go)
    if (b.rwAt != null) {
      ctx.save();
      ctx.globalAlpha *= b.dim;
      this.drawTiles(ctx, b, [b.cx, hy], Math.round(hy + H * 0.2), b.rwAt, b.flyAt ?? 1e9);
      ctx.restore();
    }
    if (b.phase === 'reward') {
      b.phaseEnd = 1.4;
      if (b.pt > 1.7) { b.phase = b.steps?.length ? 'talk' : 'teaser'; b.pt = 0; }
    }
    // phase 'talk': the cast's payoff lines (acted, with their own shots)
    if (b.phase === 'talk') {
      if (this.runScript(b)) { b.phase = 'teaser'; b.pt = 0; this.dlg.clear(); st.shot('stage'); }
      if (this.dlg.active) this.drawBox(ctx, b);
      b.phaseEnd = b.pt;
    }
    // phase 'teaser': the farewell line and the next ocean
    if (b.phase === 'teaser' || b.phase === 'out') {
      if (b.teaseAt == null) {
        b.teaseAt = b.t;
        if (outro) {
          let delay = 0;
          const a = st.actors.get(outro.npc);
          if (!a || a.state === 'gone') delay = st.entryT(st.enter(outro.npc));
          st.faceAll(outro.npc, 'player');
          if (st.world) st.shot('two', { id: outro.npc, to: 'player' });
          st.events.push({ at: st.t + delay + 0.1, fn: () => { this.say(outro.npc, outro.text, { hold: 1.8, onDone: () => { b.outroDone = true; } }); b.sp = { id: outro.npc, act: 'talk', after: 'wave' }; st.emote(outro.npc, 'heart'); } });
        }
      }
      const tk = b.t - b.teaseAt;
      if (b.next) {
        const ny = Math.round(hy + H * 0.36);
        const nk = clamp01((tk - 0.8) / 0.4);
        if (nk > 0) {
          ctx.save();
          ctx.globalAlpha *= nk * fade;
          drawAeroGlow(ctx, b.cx, ny, Math.round(H * 0.2), '#06264e', 0.55);
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
      if (b.phase === 'teaser') {
        if (this.dlg.active) this.drawBox(ctx, b, { w: Math.min(W - 40, 560) });
        const ready = outro ? b.outroDone : tk > 2.4;
        b.phaseEnd = b.pt;
        if (ready && tk > 1.6) {
          const S = ensureQuests(g.state);
          if (!b.replay && S.outro === b.ch) { S.outro = null; g.save?.(); }
          b.phase = 'out'; b.pt = 0; b.flyAt = b.t + 0.3; b.sp = null;
          st.exitAll(0.1);
          this.barsTo = 0; this.hudHidden = false;
          this.releaseCam(b);
        }
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
    if (b.kind === 'boss') { b.kind = 'start'; b.qs = [b.q]; } // [cine21] Short mode: the boss quest's card only
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
      b.cx = Math.round(this.W / 2);
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
    const g = this.game, W = this.W, H = this.H, t = this.t;
    let r = null;
    try { r = g.hud?.iconRect?.('lab'); } catch { r = null; }
    if (!r || r.y > H) { b.end = Math.min(b.end, b.t + 0.1); return; }
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const kout = 1 - clamp01((b.t - (b.end - 0.45)) / 0.45);
    const LO = { palette: 'leaf', size: 16, depth: 3, scale: 2 };
    const wc = wordNow('NEW RESEARCH!', LO);
    const tw = wc ? wc.width : 180;
    const ax = clamp(cx, tw / 2 + 60, W - tw / 2 - 70), ay = Math.round(r.y - H * 0.11);
    ctx.save();
    ctx.globalAlpha *= kout;
    const pk = backOut(b.t / 0.35);
    drawAeroGlow(ctx, ax, ay, Math.round(tw * 0.62), '#06264e', 0.55 * clamp01(b.t * 4));
    drawWord(ctx, 'NEW RESEARCH!', LO, ax, ay + Math.sin(t * 3) * 1.5, pk, 1);
    if (b.node?.name) { const nm = b.node.name; drawText(ctx, nm, Math.round(ax - measureText(nm) / 2), ay + Math.round((wc?.height || 30) / 2) + 2, { color: '#ffffff', shadow: '#0a3e74' }); }
    if (this.mode() === 'full') try { this.art.drawPortrait(ctx, 'fizz', ax - tw / 2 - 30, ay + Math.sin(t * 5) * 2, Math.round(22 * pk), t, { talk: b.t < 1.6 ? 0.6 : 0, mood: 'excited', key: 'lab' }); } catch { /* optional */ }
    // the node's icon waits in a bubble beside the words, then drops into the Lab button
    const hx = ax + tw / 2 + 30, hy = ay;
    const fk = clamp01((b.t - 1.3) / 0.75);
    if (fk < 1) {
      const e = ease.inOutCubic(fk);
      const ix = lerp(hx, cx, e), iy = lerp(hy, cy, e) - Math.sin(fk * Math.PI) * 40;
      const s = Math.round(40 * pk * (1 - fk * 0.4));
      drawAeroGlow(ctx, ix, iy, s, '#eaffb4', 0.5);
      if (s > 4) ctx.drawImage(aeroSurface(s, s, { tone: 'green', r: 'pill', gloss: 0.7, glossH: Math.round(s * 0.38), curve: 1, rim: 0.8, glow: 0.6 }), Math.round(ix - s / 2), Math.round(iy - s / 2));
      drawAnimIcon(ctx, b.node?.icon || 'beaker', ix, iy, Math.round(s * 0.72), t, 0, {});
      if (fk > 0.05) for (let j = 1; j < 4; j++) { const f2 = Math.max(0, fk - j * 0.07), e2 = ease.inOutCubic(f2); drawSparkle(ctx, lerp(hx, cx, e2), lerp(hy, cy, e2) - Math.sin(f2 * Math.PI) * 40, 1, 1 - j * 0.25); }
    } else if (!b.fx.land) {
      b.fx.land = 1;
      g.audio?.play?.('ui_unlock', { vol: 0.6 });
      try { g.particles?.unlock?.(cx, cy, { layer: 'ui', ramp: 'lime' }); } catch { /* optional */ }
    }
    // brackets ticking on the button and a pixel arrow bouncing down at it
    if (b.t > 0.6) drawFocusBrackets(ctx, cx, cy, Math.max(r.w, r.h) * 0.6, t, { col: '#b6ff7a' });
    const by = r.y - 10 + Math.round(Math.abs(Math.sin(t * 6)) * 4), bx = Math.round(cx);
    ctx.fillStyle = '#0a3e74'; ctx.fillRect(bx - 6, by - 2, 13, 4); ctx.fillRect(bx - 4, by + 2, 9, 2); ctx.fillRect(bx - 2, by + 4, 5, 2); ctx.fillRect(bx - 2, by - 8, 5, 6);
    ctx.fillStyle = '#b6ff7a'; ctx.fillRect(bx - 5, by - 1, 11, 2); ctx.fillRect(bx - 3, by + 1, 7, 2); ctx.fillRect(bx - 1, by + 3, 3, 2); ctx.fillRect(bx - 1, by - 7, 3, 6);
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
      const o = { palette: 'gold', size: 16, depth: 3, scale: 1.25 };
      wordNow(label, o);
      const ly = p.y - 48 - p.t * 12;
      drawAeroGlow(ctx, p.x, ly, 70, '#06264e', 0.55);
      drawWord(ctx, label, o, p.x, ly, k, 1);
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
