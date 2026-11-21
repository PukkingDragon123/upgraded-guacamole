// Quest cutscene stage [cine21]: everything ON the stage of a heavy quest cutscene (src/ui/questcine.js directs it).
//   new Stage(cine, beat, chId, {bare})  lays out the set next to the boat (world space; a plain screen stage when
//                                         the ocean camera is not open): the cast's marks, the ocean's set platform
//                                         (cineprops.js), the owners' props, critters and weather (cinescript.js SETS)
//   .update(dt)                 camera shots (eased moves / cuts with a dissolve, a handheld drift), cast motion,
//                               critters, weather, the angler's reactions
//   .drawBack(ctx) .drawCast(ctx, speaking) .drawFront(ctx)   draw order around the director's own layers
//   .enter(id, how) .exitAll() .act(id, anim, secs) .player(pose, secs, emote) .bringProp(id) .fx(name, o)
//   .shot(kind, o)  one | two | group | player | wide | prop | boss | stage      .bossReveal(bossId)
//   .end()                      hand the boat back (pose, facing, hop) and release nothing else (the director does)
//   Typer                       the cutscene typewriter: *emphasis*, punctuation pauses, a voice blip per letter
// Art rules: voxel art for every solid thing, pixel particles for weather; no light-ray fans, no ring effects.
import { clamp, clamp01, lerp, ease, TAU } from '../core/math.js';
import { mix } from '../core/color.js';
import * as NPC from '../gfx/npcs.js';
import { sealSize, drawSoapBubble } from '../gfx/seal.js';
import { drawAeroGlow } from './aero.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { BOSS_BY_ID, BOSS_BY_OCEAN } from '../fish/bosses.js';
import { drawFishFit, fitScale } from './journal.js';
import { drawProp, propSprite, PROP_DEFS } from './cineprops.js';
import { SETS, ENTRY } from './cinescript.js';
import { CHAPTER_BY_ID } from '../game/quests.js';

export const VOICE = { seal: 'fish', fizz: 'tiny', marina: 'clip', dot: 'crab', bloat: 'deep' };
const NPC_H = { fizz: 72, marina: 74, dot: 56, bloat: 60 };
const STAGE_H = 0.2;
const CINE_K = 0.5; // camera.js: how much of a focus zoom stacks on the base zoom
const ENTRY_T = { leap: 0.85, bob: 0.95, bubble: 0.95, swim: 1.7, zip: 0.85, pop: 0.45 };
const SEAL_ANIMS = new Set(['idle', 'swim', 'wiggle', 'wave', 'point', 'flop', 'spin', 'worried', 'clap', 'think', 'blow', 'cheer', 'sad', 'sleep']);
const SEAL_MAP = { talk: 'idle', laugh: 'wiggle', jump: 'cheer', nod: 'idle', excited: 'wiggle', dance: 'wiggle', flex: 'cheer' };
const BUBBLE_MAP = { clap: 'cheer', wiggle: 'laugh', worried: 'sad', blow: 'talk', flop: 'sad', spin: 'cheer', swim: 'idle', sleep: 'think', dance: 'cheer', flex: 'cheer', jump: 'cheer', nod: 'talk', excited: 'cheer' };
const MOOD = { worried: 'surprised', flop: 'surprised', sad: 'sad', cheer: 'excited', clap: 'excited', wiggle: 'excited', laugh: 'excited', jump: 'excited', spin: 'excited', think: 'happy' };
const PLAYER_POSE = { wave: 'wave', cheer: 'cheer', think: 'think', laugh: 'laugh', chat: 'chat', nod: 'chat', jump: 'cheer', dance: 'dance', flex: 'flex', sad: 'sad' };
const PLAYER_EMOTE = { jump: 'exclaim', laugh: 'music', cheer: 'heart', think: 'question', flex: 'star', dance: 'music' };

// ------------------------------------------------------------------ typewriter
const VOWEL = /[aeiouy]/i;
export function parseEmph(raw) {
  let text = '', emph = [], open = -1;
  for (const ch of String(raw)) {
    if (ch === '*') { if (open < 0) open = text.length; else { emph.push([open, text.length]); open = -1; } continue; }
    text += ch;
  }
  if (open >= 0) emph.push([open, text.length]);
  return { text, emph };
}
export class Typer {
  constructor(audio) { this.audio = audio; this.active = false; this.talk = 0; this.text = ''; this.emph = []; this.shown = 0; this.t = 0; }
  get line() { return this.active ? this : null; }
  get typing() { return this.active && this.shown < this.text.length; }
  get waiting() { return this.active && !this.typing; }
  now(npc, raw, o = {}) {
    const P = parseEmph(raw);
    Object.assign(this, { npc, voice: VOICE[npc] || 'fish', text: P.text, emph: P.emph, shown: 0, t: 0, doneT: 0, pause: 0.12, active: true });
    this.hold = o.hold ?? 1.05 + P.text.length * 0.026;
    this.cps = o.cps ?? 40;
    this.onKey = o.onKey || null;
    this.onDone = o.onDone || null;
    this.keys = new Set();
    return this;
  }
  finishTyping() { if (this.active) { this.shown = this.text.length; this.pause = 0; } }
  next() { if (!this.active) return; const cb = this.onDone; this.active = false; this.onDone = null; cb?.(); }
  clear() { this.active = false; this.onDone = null; this.talk = 0; }
  update(dt) {
    if (!this.active) { this.talk = Math.max(0, this.talk - dt * 8); return; }
    this.t += dt;
    if (this.typing) {
      if (this.pause > 0) { this.pause -= dt; this.talk = Math.max(0, this.talk - dt * 10); return; }
      const before = Math.floor(this.shown);
      this.shown = Math.min(this.text.length, this.shown + dt * this.cps);
      const after = Math.floor(this.shown);
      for (let i = before; i < after; i++) {
        const c = this.text[i];
        for (const [a] of this.emph) if (a === i && !this.keys.has(a)) { this.keys.add(a); this.onKey?.(a); }
        if (/[a-z0-9]/i.test(c)) { try { this.audio?.babble?.(c, this.voice); } catch { /* optional */ } }
        // punctuation pauses: a beat after sentences, a breath after commas, a long one on an ellipsis
        const nx = this.text[i + 1];
        let p = 0;
        if (/[.!?]/.test(c) && (nx === undefined || nx === ' ')) p = this.text[i - 1] === '.' ? 0.42 : 0.3;
        else if (/[,;:]/.test(c)) p = 0.13;
        else if (c === '-' && this.text[i - 1] === ' ') p = 0.16;
        if (p && i < this.text.length - 1) { this.pause = p; this.shown = i + 1; break; }
      }
      const c2 = this.text[Math.floor(this.shown)] || '';
      const open = /[.,!?]/.test(c2) ? 0.15 : VOWEL.test(c2) ? 1 : 0.55;
      this.talk = clamp01(open * (0.55 + 0.45 * Math.abs(Math.sin(this.t * 19))));
    } else {
      this.talk = Math.max(0, this.talk - dt * 8);
      this.doneT += dt;
      if (this.hold > 0 && this.doneT > this.hold) this.next();
    }
  }
}

// ------------------------------------------------------------------ the stage
export class Stage {
  constructor(cine, b, chId, o = {}) {
    this.cine = cine;
    this.g = cine.game;
    this.b = b;
    this.ch = chId;
    this.bare = !!o.bare;
    this.set = this.bare ? { props: [] } : SETS[chId] || SETS.ch1;
    this.t = 0;
    this.actors = new Map();
    this.props = [];
    this.gulls = [];
    this.jumpers = [];
    this.pens = [];
    this.jellies = [];
    this.eyes = [];
    this.bubs = [];   // pixel bubbles (flasks, sneezes, blowing)
    this.drops = [];  // weather particles (screen space)
    this.events = []; // timed callbacks
    this.dof = 0; this.dofTo = 0; this.dofAt = null;
    this.dis = null;  // dissolve snapshot
    this.shotK = null;
    this.pl = null;
    this.jumpT = 2.5 + Math.random() * 2;
    this.layout();
    if (!this.bare) this.dress();
  }
  get W() { return this.g.screen.W; }
  get H() { return this.g.screen.H; }

  // ---------------------------------------------------------------- layout: marks along the surface next to the boat
  layout() {
    const g = this.g, b = this.b, W = this.W, H = this.H;
    const cam = g.camera, boat = g.boat;
    this.world = !!b.world;
    this.side = b.side || 1;
    this.zT = b.world?.zT || (cam?.baseZoom?.() || 2) * 1.5;
    if (this.world) { this.X0 = boat.x; this.Y0 = boat.y; }
    else { this.X0 = 0; this.Y0 = 0; }
    const room = this.world ? (this.side > 0 ? W - this.X0 : this.X0) - 24 : 999;
    this.sp = clamp(room / 330, 0.55, 1);
    this.slotX = (s) => this.X0 + this.side * (72 + 58 * s) * this.sp;
    this.platX = this.X0 + this.side * 286 * this.sp;
    const back = this.world ? (this.side > 0 ? this.X0 : W - this.X0) : 999;
    this.raftX = back > 150 ? this.X0 - this.side * 104 : null;
    this.midX = this.X0 + this.side * 150 * this.sp;
  }
  // world -> screen (a plain stage maps a virtual world onto the screen when the ocean camera is not open)
  toS(x, y) {
    if (this.world) return this.g.camera.worldToScreen(x, y);
    return [this.W / 2 + (x - this.midX) * this.zT * 0.8, this.H * 0.7 + (y - this.Y0) * this.zT * 0.8];
  }
  k() { return this.world ? clamp((this.g.camera.z || this.zT) / this.zT, 0.45, 1.8) : 0.8; }
  waterY() { return this.toS(this.X0, this.Y0)[1]; }

  // ---------------------------------------------------------------- set dressing
  dress() {
    const S = this.set;
    // owners' props: the first one stands on the platform, the second on a raft on the other side of the boat
    (S.props || []).forEach(([id, owner], i) => {
      const onPlat = i === 0 || this.raftX == null;
      this.props.push({ id, owner, x: onPlat ? this.platX + (i ? this.side * 26 : -this.side * 4) : this.raftX, raft: !onPlat, on: null, f: 0 });
    });
    const H = this.H;
    // critters
    const gulls = S.gulls || 0;
    for (let i = 0; i < gulls; i++) this.spawnGull(i === 0 ? 'plat' : i === 1 ? 'mast' : 'sky', 0.6 + i * 1.3);
    for (let i = 0; i < (S.penguins || 0); i++) this.pens.push({ x: this.platX + (i - 1) * 20 * this.side, dir: i % 2 ? 1 : -1, ph: i * 1.7, slide: null, home: this.platX + (i - 1) * 20 * this.side });
    for (let i = 0; i < (S.jellies || 0); i++) this.jellies.push({ x: this.X0 + this.side * (40 + i * 70) * this.sp + (i % 2 ? 14 : -10), y: this.Y0 + 26 + (i % 3) * 16, ph: i * 1.3 });
    if (S.eyes) for (let i = 0; i < 9; i++) this.eyes.push({ x: this.X0 + this.side * (-60 + i * 46) * this.sp, y: this.Y0 + 34 + ((i * 37) % 60), ph: i * 2.3, open: 0, col: i % 3 ? '#ffe86a' : '#7affd0' });
    this.crab = PROP_DEFS.crab ? { x: this.platX - this.side * 24, dir: this.side, wait: 1.5, dash: 0, v: S.crab || 0 } : null;
    void H;
  }
  plat() { return this.set.plat || null; }
  propList() {
    const S = this.set, out = [];
    if (S.plat) out.push([S.plat, 0]);
    for (const [id] of S.props || []) out.push([id, 0]);
    if ((S.props || []).length > 1) out.push(['raft', 0]);
    if (S.gulls) out.push(['gull', 0]);
    if (S.penguins) out.push(['penguin', 0]);
    if (S.jellies) out.push(['jelly', 0]);
    if (S.plat) out.push(['crab', S.crab || 0]);
    return out;
  }
  // world position of a named anchor on the platform (from its sprite at the stage zoom)
  platAnchor(name) {
    const s = propSprite(this.set.plat, 0, 0, this.H);
    const a = s?.A?.[name];
    if (!a) return [this.platX, this.Y0 - 14];
    const kk = this.world ? this.zT : this.zT * 0.8;
    return [this.platX + a[0] / kk, this.Y0 + a[1] / kk];
  }

  // ---------------------------------------------------------------- the cast
  enter(id, how, o = {}) {
    let a = this.actors.get(id);
    if (a && a.state !== 'gone') return a;
    const slot = o.slot ?? this.actors.size;
    how = how || ENTRY[id] || 'pop';
    if (!this.world) how = 'pop';
    const tx = this.slotX(slot);
    a = { id, slot, x: tx, tx, t0: this.t, how, state: 'enter', face: -this.side, hop: 0, nose: 0, react: null, key: null, emote: null, emoteT: 0, fx: {} };
    if (how === 'swim') a.x = tx + this.side * (90 + slot * 20);
    if (how === 'zip') a.x = tx + this.side * 70;
    this.actors.set(id, a);
    return a;
  }
  entryT(a) { return ENTRY_T[a.how] || 0.6; }
  entered(id) { const a = this.actors.get(id); return !!a && this.t - a.t0 >= this.entryT(a); }
  exitAll(at = 0) { for (const a of this.actors.values()) if (a.state !== 'gone' && a.out == null) a.out = this.t + at; }
  act(id, anim, secs = 1.1) { const a = this.actors.get(id); if (a && anim) a.react = { anim, until: this.t + secs }; }
  emote(id, name) { const a = this.actors.get(id); if (a && name) { a.emote = name; a.emoteT = this.t; } }
  player(pose, secs = 1.6, emote) {
    if (!pose) return;
    this.pl = { pose, until: this.t + secs, t0: this.t, emote: emote ?? PLAYER_EMOTE[pose] ?? null };
    if (pose === 'jump') this.g.audio?.play?.('boing', { vol: 0.4, pitch: 1.3 });
  }
  speakerFacing(id, to) {
    const a = this.actors.get(id);
    if (!a) return;
    const tx = to === 'player' ? this.X0 : this.actors.get(to)?.x;
    if (Number.isFinite(tx) && Math.abs(tx - a.x) > 2) a.face = Math.sign(tx - a.x);
  }
  // listeners turn to the speaker; the speaker turns to who it talks to
  faceAll(speaker, to) {
    const sp = this.actors.get(speaker);
    for (const a of this.actors.values()) {
      if (a === sp) continue;
      if (sp && Math.abs(sp.x - a.x) > 2) a.face = Math.sign(sp.x - a.x);
    }
    if (sp) { if (to) this.speakerFacing(speaker, to); else sp.face = -this.side; }
  }

  // ---------------------------------------------------------------- props
  bringProp(id) {
    const p = this.props.find((q) => q.id === id && q.on == null);
    if (!p) return false;
    p.on = this.t;
    return true;
  }
  propOf(owner) { return this.props.find((p) => p.owner === owner && p.on != null) || this.props.find((p) => p.on != null); }

  // ---------------------------------------------------------------- camera
  shot(kind, o = {}) {
    if (!kind) return;
    const prev = this.shotK;
    this.shotK = { kind, ...o, t0: this.t };
    this.dofTo = { wide: 0, stage: 0.08, group: 0.12, two: 0.3, one: 0.44, player: 0.44, prop: 0.3, set: 0.26, boss: 0 }[kind] ?? 0.2;
    if (o.cut && this.world) { if (o.dissolve !== false) this.dissolve(); this.snap(); }
    void prev;
  }
  camTarget() {
    const S = this.shotK, H = this.H, W = this.W, cam = this.g.camera, side = this.side;
    const base = cam.baseZoom?.() || 2;
    const zf = (f) => base * Math.max(0.75, 1 + (f - 1) * CINE_K);
    const actorX = (id) => (id === 'player' ? this.X0 : this.actors.get(id)?.x ?? this.slotX(0));
    let x = this.midX, y = this.Y0, f = 2, speed = 2.1;
    switch (S?.kind) {
      case 'wide': f = 0.6; x = this.X0 + side * 130 * this.sp; y = this.Y0 - (H * 0.16) / zf(f); speed = 1.3; break;
      case 'one': {
        f = 2.7; const ax = actorX(S.id);
        x = ax + side * (W * 0.05) / zf(f); y = this.Y0 - (H * 0.14) / zf(f); speed = 1.7; break;
      }
      case 'two': {
        f = 2.25; const a = actorX(S.id), c = actorX(S.to || 'player');
        x = (a + c) / 2; y = this.Y0 - (H * 0.15) / zf(f); speed = 1.9; break;
      }
      case 'player': {
        f = 2.9; const hd = this.g.boat?.anchorsWorld?.head;
        x = hd ? hd[0] : this.X0; y = (hd ? hd[1] : this.Y0 - 40) + (H * 0.05) / zf(f); speed = 2.6; break;
      }
      case 'prop': {
        f = 2.4; const p = this.propOf(S.id);
        const px = p ? p.x : this.platX, ax = actorX(S.id);
        x = (px * 2 + ax) / 3; y = this.Y0 - (H * 0.14) / zf(f); speed = 1.8; break;
      }
      case 'set': f = 2.2; x = this.platX - side * 16; y = this.Y0 - (H * 0.12) / zf(f); speed = 1.7; break;
      case 'boss': f = 1.55; x = this.midX; y = this.Y0 + 104; speed = 1.05; break;
      case 'stage': f = 2; x = this.b.world ? this.b.world.x + side * (W * 0.16) / this.zT : this.midX; y = this.Y0 - (H * 0.17) / this.zT; speed = 2.2; break;
      case 'group': default: {
        f = 1.75;
        const xs = [...this.actors.values()].filter((a) => a.state !== 'gone' && a.out == null).map((a) => a.tx);
        xs.push(this.X0);
        x = (Math.min(...xs) + Math.max(...xs)) / 2 + side * 22; y = this.Y0 - (H * 0.15) / zf(f); speed = 1.8; break;
      }
    }
    if (S?.speed) speed = S.speed;
    return { x, y, f, speed };
  }
  snap() {
    const cam = this.g.camera, T = this.camTarget();
    try {
      cam.focus(T.x, T.y, T.f, T.speed);
      cam.fz = Math.max(0.75, 1 + (T.f - 1) * CINE_K);
      cam.z = cam.base * cam.fz;
      cam.cx = cam.tx = T.x; cam.cy = cam.ty = T.y;
    } catch { /* optional */ }
  }
  dissolve() {
    const src = this.g.screen?.canvas;
    if (!src || !src.width) return;
    let c = this.cine.disCanvas;
    if (!c || c.width !== src.width || c.height !== src.height) { c = this.cine.disCanvas = document.createElement('canvas'); c.width = src.width; c.height = src.height; }
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0);
    this.dis = { c, t: this.t };
  }

  // ---------------------------------------------------------------- critters + fx
  spawnGull(where, delay = 0) {
    const plat = this.plat();
    let perch;
    if (where === 'mast' && this.g.boat?.anchorsWorld?.mast) { const m = this.g.boat.anchorsWorld.mast; perch = [m[0], m[1]]; }
    else if (where === 'anvil') { const p = this.propOf('marina'); perch = p ? [p.x - this.side * 10, this.Y0 - 24] : null; }
    else if (where === 'plat' && plat) perch = this.platAnchor(this.set.plat === 'islet' ? 'sign' : 'top');
    if (!perch) perch = [this.midX + (Math.random() - 0.5) * 100, this.Y0 - 70 - Math.random() * 30];
    const dir = Math.random() < 0.5 ? 1 : -1;
    this.gulls.push({ x: perch[0] - dir * 220, y: perch[1] - 110, px: perch[0], py: perch[1], dir, t: -delay, state: where === 'sky' ? 'circle' : 'fly', f: 1 });
  }
  scareGulls() { for (const gl of this.gulls) if (gl.state !== 'leave') { gl.state = 'leave'; gl.t = 0; gl.dir = gl.x > this.midX ? 1 : -1; } }
  jump(atId) {
    const ids = this.set.jumpers || [];
    const sp = SPECIES_BY_ID[ids[Math.floor(Math.random() * ids.length)]] || SPECIES_BY_ID.pixel;
    if (!sp) return;
    const a = atId ? this.actors.get(atId) : null;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x1 = a ? a.x : this.midX + (Math.random() - 0.5) * 220;
    const x0 = x1 - dir * (a ? 34 : 24 + Math.random() * 20);
    this.jumpers.push({ sp, x0, x1, t: 0, dur: a ? 0.95 : 0.8 + Math.random() * 0.3, peak: a ? 44 : 26 + Math.random() * 20, dir, at: atId || null, len: 13 + Math.random() * 4 });
    this.g.audio?.play?.('jump_out', { vol: 0.35, pitch: 0.9 + Math.random() * 0.3 });
    const [sx, sy] = this.toS(x0, this.Y0);
    this.cine.splash(sx, sy, 0.45);
  }
  addBubbles(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) this.bubs.push({ x: x + (Math.random() - 0.5) * (o.w || 4), y, vx: (o.vx || 0) + (Math.random() - 0.5) * 14, vy: -(o.vy || 26) - Math.random() * 20, r: o.r ?? (1 + (Math.random() * 2.2) | 0), t: 0, life: (o.life || 1.2) + Math.random() * 0.6, col: o.col || null });
  }
  fx(name, o = {}) {
    const g = this.g, t = this.t;
    switch (name) {
      case 'jump': this.jump(o.at || null); break;
      case 'splash': {
        const a = this.actors.get(o.at || 'seal') || [...this.actors.values()][0];
        if (a) { const [sx, sy] = this.toS(a.x, this.Y0); this.cine.splash(sx, sy - 10, 1); this.act(a.id, 'worried', 0.9); a.hop = 8; g.audio?.play?.('splash_small', { vol: 0.6 }); }
        break;
      }
      case 'sneeze': {
        const a = this.actors.get(o.at || 'seal');
        if (a) { a.sneeze = t; this.act(a.id, 'worried', 0.85); }
        break;
      }
      case 'gull': this.spawnGull(this.props.some((p) => p.owner === 'marina' && p.on != null) ? 'anvil' : 'plat'); break;
      case 'flask': this.flask = t; g.audio?.play?.('bubbles', { vol: 0.5 }); this.events.push({ at: t + 0.7, fn: () => { g.audio?.play?.('puff', { vol: 0.45, pitch: 1.3 }); this.flaskPop = this.t; } }); break;
      case 'penguin': { const p = this.pens[0]; if (p) { p.slide = 0; g.audio?.play?.('penguin', { vol: 0.5 }); } break; }
      case 'spark': this.spark = t; g.audio?.play?.('static_burst', { vol: 0.45 }); break;
      case 'neon': this.neon = t; g.audio?.play?.('neon_buzz', { vol: 0.5 }); break;
      case 'rumble': this.rumble = t; try { g.camera.shake(g.state.settings.reducedMotion ? 1 : 5); } catch { /* optional */ } g.audio?.play?.('eruption_boom', { vol: 0.5 }); this.scareGulls(); break;
      case 'eyes': this.eyesT = t; g.audio?.play?.('sonar', { vol: 0.45 }); break;
      case 'crab': if (this.crab) { this.crab.dash = 1; this.crab.x = this.platX - this.side * 40; this.crab.dir = this.side; this.crab.wait = 0; } g.audio?.play?.('honk', { vol: 0.4, pitch: 1.4 }); g.audio?.play?.('crab_scuttle', { vol: 0.5 }); break;
      case 'bubbles': { const a = this.actors.get(o.at || 'seal'); if (a) a.blow = t; g.audio?.play?.('bubbles', { vol: 0.5 }); break; }
      default: break;
    }
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.g;
    this.t += dt;
    const t = this.t;
    for (const e of this.events) if (!e.done && t >= e.at) { e.done = true; e.fn(); }
    this.events = this.events.filter((e) => !e.done);
    // camera: the current shot plus a subtle handheld drift
    if (this.world && this.shotK && !this.camFree) {
      const T = this.camTarget(), z = g.camera.z || 2;
      const rm = g.state.settings?.reducedMotion ? 0.3 : 1;
      const dx = (Math.sin(t * 0.63) * 2.2 + Math.sin(t * 1.41 + 1) * 0.9) * rm / z, dy = (Math.sin(t * 0.47 + 2) * 1.6 + Math.sin(t * 1.13) * 0.6) * rm / z;
      try { g.camera.focus(T.x + dx, T.y + dy, T.f, T.speed); } catch { /* optional */ }
    }
    this.dof = lerp(this.dof, this.dofTo, 1 - Math.exp(-dt * 4));
    // cast: glide toward their marks, hops settle, sneezes build a nose bubble
    for (const a of this.actors.values()) {
      if (a.state === 'gone') continue;
      const te = t - a.t0, E = this.entryT(a);
      if (a.how === 'swim' && te < E) a.x = lerp(a.x, a.tx, 1 - Math.exp(-dt * 2.6));
      else if (a.how === 'zip' && te < E) a.x = lerp(a.x, a.tx, 1 - Math.exp(-dt * 6));
      else a.x = lerp(a.x, a.tx, 1 - Math.exp(-dt * 3));
      a.hop = Math.max(0, a.hop - dt * 30);
      if (a.sneeze != null) {
        const s = t - a.sneeze;
        a.nose = s < 0.7 ? clamp01(s / 0.7) : 0;
        if (s >= 0.7 && !a.fx.sneezed) {
          a.fx.sneezed = 1;
          a.hop = 7;
          this.act(a.id, 'blow', 0.6);
          const [sx, sy] = this.toS(a.x, this.Y0);
          const k = this.k();
          this.addBubbles(sx + a.face * 26 * k, sy - 30 * k, 7, { vx: a.face * 60, vy: 20, r: 2, life: 1.4 });
          g.audio?.play?.('puff', { vol: 0.6, pitch: 1.5 }); g.audio?.play?.('bubble', { vol: 0.6, pitch: 0.8 });
          this.emote(a.id, 'sweat');
        }
        if (s > 1.6) { a.sneeze = null; a.fx.sneezed = 0; }
      }
      if (a.out != null && t - a.out > 0.8) a.state = 'gone';
      else if (te >= E) a.state = 'on';
    }
    // the angler on the boat
    const boat = g.boat;
    if (boat && this.world && !g.fishing?.busy) {
      const p = this.pl && t < this.pl.until ? this.pl : null;
      boat.pose = p ? PLAYER_POSE[p.pose] || 'idle' : 'idle';
      boat.faceOverride = this.side;
      if (p && p.pose === 'jump') { const u = (t - p.t0) / 0.55; boat.hopY = u < 1 ? Math.sin(u * Math.PI) * 9 : 0; } else boat.hopY = 0;
      this.touchedBoat = true;
    }
    this.updateCritters(dt);
    this.updateWeather(dt);
    for (const p of this.bubs) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 1.5; p.x += Math.sin(p.t * 9 + p.y) * 0.2; }
    this.bubs = this.bubs.filter((p) => p.t < p.life);
  }
  end() {
    const boat = this.g.boat;
    if (boat && this.touchedBoat) {
      if (!this.g.fishing?.busy) boat.pose = 'idle';
      boat.faceOverride = null; boat.hopY = 0;
    }
  }

  updateCritters(dt) {
    const t = this.t;
    if (this.bare) return;
    // gulls: glide in, flap, land on a perch, hop now and then; fly off when scared
    for (const gl of this.gulls) {
      gl.t += dt;
      if (gl.t < 0) continue;
      if (gl.state === 'fly') {
        const k = 1 - Math.exp(-dt * 1.6);
        gl.x = lerp(gl.x, gl.px, k); gl.y = lerp(gl.y, gl.py - Math.max(0, Math.abs(gl.px - gl.x) * 0.25), k);
        gl.f = Math.floor(gl.t * 7) % 2 ? 1 : 2;
        if (Math.abs(gl.x - gl.px) < 3 && Math.abs(gl.y - gl.py) < 4) { gl.state = 'perch'; gl.x = gl.px; gl.y = gl.py; gl.t = 0; this.g.audio?.play?.('chirp', { vol: 0.3, pitch: 0.7 }); }
      } else if (gl.state === 'perch') {
        gl.f = 0;
        gl.hop = Math.sin(gl.t * 3) > 0.97 ? 1 : 0;
        if (Math.sin(gl.t * 0.7 + gl.px) > 0.995) gl.dir *= -1;
      } else if (gl.state === 'circle') {
        gl.x = gl.px + Math.cos(gl.t * 0.5) * 70; gl.y = gl.py - 50 + Math.sin(gl.t * 1) * 12;
        gl.dir = -Math.sign(Math.sin(gl.t * 0.5)) || 1;
        gl.f = Math.sin(gl.t * 1.3) > 0.2 ? (Math.floor(gl.t * 7) % 2 ? 1 : 2) : 1;
      } else if (gl.state === 'leave') {
        gl.x += gl.dir * 140 * dt; gl.y -= 90 * dt;
        gl.f = Math.floor(gl.t * 9) % 2 ? 1 : 2;
      }
    }
    this.gulls = this.gulls.filter((gl) => !(gl.state === 'leave' && gl.t > 3));
    // jumping fish (now and then in the calmer shots)
    this.jumpT -= dt;
    const kind = this.shotK?.kind;
    if (this.jumpT <= 0 && (this.set.jumpers || []).length && kind !== 'boss') { this.jumpT = 3.2 + Math.random() * 3.5; this.jump(null); }
    for (const j of this.jumpers) {
      j.t += dt;
      if (j.t >= j.dur && !j.landed) {
        j.landed = true;
        const [sx, sy] = this.toS(j.x1, this.Y0);
        this.cine.splash(sx, sy, j.at ? 0.9 : 0.5);
        this.g.audio?.play?.('splash_small', { vol: 0.4, pitch: 1.2 });
        if (j.at) { this.act(j.at, 'worried', 1); this.emote(j.at, 'sweat'); const a = this.actors.get(j.at); if (a) a.hop = 6; try { this.g.particles?.pixelBurst?.('drop', sx, sy - 30 * this.k(), 8, { layer: 'ui', speed: [30, 90] }); } catch { /* optional */ } }
      }
    }
    this.jumpers = this.jumpers.filter((j) => j.t < j.dur + 0.1);
    // the crab: scuttles across the platform, stops, waves a claw, turns around
    const c = this.crab;
    if (c) {
      if (c.wait > 0) c.wait -= dt;
      else {
        const sp = c.dash ? 70 : 14;
        c.x += c.dir * sp * dt;
        const lo = this.platX - 30 * this.sp, hi = this.platX + 30 * this.sp;
        if (c.dash && (c.x > Math.max(lo, hi) + 30 || c.x < Math.min(lo, hi) - 30)) { c.dash = 0; c.x = this.platX; c.wait = 1; }
        if (!c.dash && (c.x > Math.max(lo, hi) || c.x < Math.min(lo, hi))) { c.dir *= -1; c.wait = 0.8 + Math.random(); c.x = clamp(c.x, Math.min(lo, hi), Math.max(lo, hi)); }
        if (!c.dash && Math.random() < dt * 0.25) c.wait = 0.6;
      }
    }
    // penguins waddle on the floe; one slides off into the water on cue
    for (const p of this.pens) {
      if (p.slide != null) {
        p.slide += dt;
        p.x += this.side * 60 * dt;
        if (p.slide > 0.9 && !p.splashed) { p.splashed = 1; const [sx, sy] = this.toS(p.x, this.Y0); this.cine.splash(sx, sy, 0.8); this.g.audio?.play?.('splash_small', { vol: 0.5 }); }
        if (p.slide > 2.6) { p.slide = null; p.splashed = 0; p.x = p.home; }
        continue;
      }
      p.ph += dt;
      p.x += Math.sin(p.ph * 0.6) * 5 * dt * p.dir;
    }
  }

  updateWeather(dt) {
    const w = this.set.weather, W = this.W, H = this.H;
    if (!w || this.bare) return;
    const want = { petals: 34, glints: 26, snow: 120, sparks: 40, rain: 110, embers: 60, plankton: 70 }[w] || 0;
    const reduced = this.g.state.settings?.reducedMotion;
    const n = reduced ? Math.round(want * 0.4) : want;
    while (this.drops.length < n) this.drops.push(this.newDrop(w, true));
    for (const d of this.drops) {
      d.t += dt;
      d.x += d.vx * dt + Math.sin(d.t * d.sw + d.ph) * d.sa * dt;
      d.y += d.vy * dt;
      if (d.y > H + 8 || d.y < -12 || d.x < -12 || d.x > W + 12 || d.t > d.life) Object.assign(d, this.newDrop(w, false));
    }
  }
  newDrop(w, first) {
    const W = this.W, H = this.H, r = Math.random;
    const d = { x: r() * W, y: first ? r() * H : -6, t: 0, ph: r() * TAU, sw: 1 + r() * 2, sa: 0, vx: 0, vy: 0, life: 99, s: 1, c: '#ffffff', a: 1 };
    switch (w) {
      case 'petals': Object.assign(d, { vx: 18 + r() * 20, vy: 16 + r() * 14, sa: 18, s: r() < 0.5 ? 2 : 3, c: ['#ffd0e8', '#ffffff', '#fff2a0', '#c8f4a0'][(r() * 4) | 0] }); break;
      case 'glints': Object.assign(d, { y: first ? H * (0.55 + r() * 0.4) : H * (0.55 + r() * 0.4), x: r() * W, vy: 0, life: 0.5 + r() * 1.2, s: 1, c: '#fff8d0', glint: true }); break;
      case 'snow': { const near = r() < 0.3; Object.assign(d, { vx: -6 + r() * 4, vy: near ? 44 + r() * 20 : 18 + r() * 14, sa: near ? 16 : 8, s: near ? 3 : r() < 0.5 ? 1 : 2, c: near ? '#ffffff' : '#e8f6ff', a: near ? 0.95 : 0.7 }); break; }
      case 'sparks': Object.assign(d, { y: first ? r() * H : H + 4, vx: 10 + r() * 16, vy: -(14 + r() * 22), sa: 12, s: r() < 0.7 ? 1 : 2, c: r() < 0.6 ? '#ffb04a' : '#ffe08a', life: 3 + r() * 4, flick: true }); break;
      case 'rain': Object.assign(d, { vx: -40, vy: 300 + r() * 120, s: 1, c: '#9fd8ff', a: 0.55, streak: 6 + ((r() * 5) | 0) }); break;
      case 'embers': { const ash = r() < 0.35; Object.assign(d, ash ? { vx: -6 + r() * 12, vy: 14 + r() * 10, sa: 10, s: 1 + ((r() * 2) | 0), c: '#8a8090', a: 0.7 } : { y: first ? r() * H : H + 4, vx: -8 + r() * 16, vy: -(26 + r() * 40), sa: 14, s: r() < 0.6 ? 1 : 2, c: r() < 0.5 ? '#ff7a2a' : '#ffd24a', life: 2 + r() * 4, flick: true }); break; }
      case 'plankton': Object.assign(d, { vx: -3 + r() * 6, vy: -4 + r() * 8, sa: 6, s: r() < 0.75 ? 1 : 2, c: r() < 0.5 ? '#7af0ff' : r() < 0.5 ? '#c89aff' : '#a8ffd8', twinkle: true, life: 4 + r() * 6 }); break;
      default: break;
    }
    return d;
  }

  // ---------------------------------------------------------------- drawing
  // behind the cast: the dissolve, the colour grade, the platform and props, critters, depth-of-field dimming
  drawBack(ctx) {
    const W = this.W, H = this.H, t = this.t, g = this.g;
    if (this.dis) {
      const u = clamp01((t - this.dis.t) / 0.55);
      if (u < 1) { ctx.save(); ctx.globalAlpha *= 1 - ease.inOutCubic(u); ctx.drawImage(this.dis.c, 0, 0, W, H); ctx.restore(); }
      else this.dis = null;
    }
    if (this.bare) { this.drawDof(ctx); return; }
    const S = this.set;
    const wy = this.waterY();
    // time-of-day grade (and the rumble's hot flash in the rift)
    if (S.grade) {
      const gr = ctx.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, S.grade[0]); gr.addColorStop(1, S.grade[1]);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    const k = this.k(), H0 = this.H;
    // underwater glow from the rift / bioluminescence in the deep
    if (S.weather === 'embers') drawAeroGlow(ctx, this.toS(this.platX, this.Y0)[0], wy + 30 * k, 160 * k, '#ff6a1a', 0.22 + 0.06 * Math.sin(t * 2));
    if (S.weather === 'plankton') drawAeroGlow(ctx, this.toS(this.platX, this.Y0)[0], wy, 120 * k, '#5af0ff', 0.12 + 0.04 * Math.sin(t * 1.4));
    // the platform with its set pieces
    if (S.plat) {
      const [px, py] = this.toS(this.platX, this.Y0);
      const bob = Math.sin(t * 1.6) * 1.2 * k;
      const fr = S.plat === 'pontoon' ? (this.neon != null && t - this.neon < 1 ? (Math.floor((t - this.neon) * 12) % 3 === 0 ? 2 : 0) : Math.floor(t * 1.5) % 2) : Math.floor(t * (S.plat === 'scrap' ? 6 : 2));
      this.clipWater(ctx, wy + 2 * k, () => { this.platA = drawProp(ctx, S.plat, fr, 0, px, py + bob, k, H0); });
      this.drawFoamLine(ctx, px, wy, 46 * k);
      // glows of the set's lights
      if (this.platA) {
        if (S.plat === 'pontoon' && this.platA.sign) { const on = this.neon == null || t - this.neon > 1 || fr !== 2; if (on) { drawAeroGlow(ctx, this.platA.sign[0], this.platA.sign[1], 60 * k, '#ff5ad8', 0.24); drawAeroGlow(ctx, this.platA.lamp[0], this.platA.lamp[1], 34 * k, '#fff2b0', 0.3); } this.drawReflections(ctx, px, wy, k, on); }
        if (S.plat === 'scrap' && this.platA.screen) { drawAeroGlow(ctx, this.platA.screen[0], this.platA.screen[1], 20 * k, '#4aff8a', 0.25 + (this.spark != null && t - this.spark < 0.6 ? 0.3 : 0)); this.drawSparks(ctx); }
        if (S.plat === 'basalt' && this.platA.pool) { drawAeroGlow(ctx, this.platA.pool[0], this.platA.pool[1], 30 * k, '#ff8a2a', 0.35 + 0.1 * Math.sin(t * 5)); this.smoke(ctx, this.platA.vent, k); }
        if (S.plat === 'glowrock') drawAeroGlow(ctx, px, py - 14 * k, 70 * k, '#5af0ff', 0.16);
      }
    }
    // the owners' props (dropped onto the platform, or floated in on a raft)
    for (const p of this.props) {
      if (p.on == null) continue;
      const te = t - p.on;
      const [x0, y0] = this.toS(p.x, this.Y0);
      let y = y0;
      if (!p.raft && this.platA) y = this.platA.stage ? this.platA.stage[1] : y0 - 20 * k;
      let a = 1, dy = 0, sq = 0;
      if (!p.raft) {
        const u = clamp01(te / 0.55);
        dy = -(1 - ease.outBounce(u)) * H * 0.5;
        if (u >= 1 && !p.landed) { p.landed = 1; try { g.particles?.pixelBurst?.('dust', x0, y, 6, { layer: 'ui', speed: [20, 60] }); g.particles?.pixelBurst?.('sparkle', x0, y - 20 * k, 4, { layer: 'ui', ramp: 'white', size: 0 }); } catch { /* optional */ } g.audio?.play?.('icon_drop', { vol: 0.55 }); g.audio?.play?.('boing', { vol: 0.25, pitch: 0.8 }); }
        if (u < 0.12) a = u / 0.12;
      } else {
        const u = clamp01(te / 0.9);
        dy = (1 - ease.outBack(u)) * 40 * k;
        if (!p.landed) { p.landed = 1; this.cine.splash(x0, y0, 0.7); g.audio?.play?.('splash_small', { vol: 0.5 }); }
      }
      if (te < 0.7 && te > 0.5) sq = Math.sin(((te - 0.5) / 0.2) * Math.PI) * 0.1;
      p.f = Math.floor(t * 6);
      const draw = () => {
        if (p.raft) drawProp(ctx, 'raft', 0, 0, x0, y0 + dy + Math.sin(t * 1.8 + 1) * 1.2 * k, k, H0);
        ctx.save();
        ctx.translate(Math.round(x0), Math.round(y + dy));
        ctx.scale(1 + sq, 1 - sq);
        p.A = drawProp(ctx, p.id, p.f, 0, 0, p.raft ? -7 * k + Math.sin(t * 1.8 + 1) * 1.2 * k : 0, k, H0, { alpha: a });
        ctx.restore();
        if (p.A) for (const key of Object.keys(p.A)) if (Array.isArray(p.A[key])) p.A[key] = [p.A[key][0] + x0, p.A[key][1] + y + dy];
      };
      if (p.raft) this.clipWater(ctx, wy + 2 * k, draw); else draw();
      if (p.raft) this.drawFoamLine(ctx, x0, wy, 26 * k);
      if (p.id === 'bench' && p.A) this.benchFx(ctx, p, k);
    }
    // platform critters: the crab, penguins, perched gulls
    if (this.crab && S.plat && this.platA) {
      const c = this.crab;
      const [cx] = this.toS(c.x, this.Y0);
      const cy = this.platA.stage ? this.platA.stage[1] : wy - 10 * k;
      drawProp(ctx, 'crab', c.wait > 0 ? (Math.sin(t * 6) > 0 ? 1 : 0) : Math.floor(t * (c.dash ? 18 : 9)), c.v, cx, cy, k * 0.8, H0, { flip: c.dir < 0 });
    }
    for (const p of this.pens) {
      const [x] = this.toS(p.x, this.Y0);
      let y = this.platA?.stage ? this.platA.stage[1] : wy - 10 * k;
      let f = p.slide != null ? 3 : Math.abs(Math.sin(p.ph * 0.6)) > 0.15 ? 1 + (Math.floor(p.ph * 5) % 2) : 0;
      if (p.slide != null && p.slide > 0.7) y += Math.min(30, (p.slide - 0.7) * 60) * k;
      if (Math.sin(p.ph * 0.9 + 1) > 0.96) f = 3;
      this.clipWater(ctx, wy + 2 * k, () => drawProp(ctx, 'penguin', f, 0, x, y, k * 0.75, H0, { flip: p.dir * this.side < 0 }));
    }
    for (const gl of this.gulls) {
      if (gl.t < 0) continue;
      const [x, y] = this.toS(gl.x, gl.y - (gl.hop ? 2 : 0));
      drawProp(ctx, 'gull', gl.f, 0, x, y, k * 0.62, H0, { flip: gl.dir < 0 });
    }
    // jellies and eyes in the dark water
    for (const j of this.jellies) {
      const [x, y] = this.toS(j.x + Math.sin(t * 0.5 + j.ph) * 6, j.y + Math.sin(t * 0.8 + j.ph) * 5);
      ctx.save(); ctx.globalAlpha *= 0.8;
      drawProp(ctx, 'jelly', Math.floor(t * 4 + j.ph * 3), 0, x, y, k * 0.7, H0);
      ctx.restore();
      drawAeroGlow(ctx, x, y - 22 * k, 26 * k, '#7af0ff', 0.18);
    }
    for (const e of this.eyes) this.drawEye(ctx, e, k);
    this.drawDof(ctx);
  }
  drawDof(ctx) {
    if (this.dof < 0.02) return;
    const W = this.W, H = this.H;
    const c = this.dofCenter();
    const r0 = Math.min(W, H) * 0.2, r1 = Math.max(W, H) * 0.75;
    const gr = ctx.createRadialGradient(c[0], c[1], r0, c[0], c[1], r1);
    gr.addColorStop(0, 'rgba(4,18,44,0)');
    gr.addColorStop(1, `rgba(4,18,44,${(this.dof).toFixed(3)})`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    // the far sky band dims a little more (it is the deepest layer)
    const top = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    top.addColorStop(0, `rgba(6,24,60,${(this.dof * 0.45).toFixed(3)})`);
    top.addColorStop(1, 'rgba(6,24,60,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.45);
  }
  dofCenter() {
    const S = this.shotK, k = this.k();
    const at = (id) => { if (id === 'player') { const h = this.g.boat?.anchorsWorld?.head; return h ? this.toS(h[0], h[1]) : this.toS(this.X0, this.Y0 - 30); } const a = this.actors.get(id); return a ? this.toS(a.x, this.Y0 - 22) : this.toS(this.midX, this.Y0 - 20); };
    if (!S) return [this.W / 2, this.H / 2];
    if (S.kind === 'one' || S.kind === 'player') return at(S.kind === 'player' ? 'player' : S.id);
    if (S.kind === 'two') { const a = at(S.id), b = at(S.to || 'player'); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    if (S.kind === 'prop') { const p = this.propOf(S.id); return p ? this.toS(p.x, this.Y0 - 20) : at(S.id); }
    void k;
    return [this.W / 2, this.H * 0.5];
  }

  // the cast (speaking = the npc whose line is on screen)
  drawCast(ctx, sp = null) {
    const list = [...this.actors.values()].filter((a) => a.state !== 'gone');
    // the speaker draws last (in front)
    list.sort((a, b) => (a.id === sp?.id ? 1 : 0) - (b.id === sp?.id ? 1 : 0));
    const out = {};
    for (const a of list) out[a.id] = this.drawActor(ctx, a, sp && sp.id === a.id ? sp : null);
    return out;
  }
  animOf(a, sp) {
    const t = this.t;
    if (a.react && t < a.react.until) return a.react.anim;
    if (sp) {
      if (a.key && t < a.key.until) return a.key.anim;
      return sp.typing ? sp.act || 'talk' : sp.after || (sp.act === 'point' ? 'idle' : sp.act === 'worried' ? 'worried' : 'idle');
    }
    return 'idle';
  }
  drawActor(ctx, a, sp) {
    const g = this.g, t = this.t, H = this.H, W = this.W;
    const te = t - a.t0, E = this.entryT(a);
    const [sx, sy] = this.toS(a.x, this.Y0);
    let x = sx, y = sy, k = this.k(), alpha = 1, bubble = 0, sq = 0;
    const water = this.world;
    const fx = a.fx;
    let anim = this.animOf(a, sp);
    const ke = clamp01(te / E);
    if (water) {
      if (a.how === 'leap') {
        if (ke < 1) {
          y = sy + 40 * k - Math.sin(ke * Math.PI) * 70 * k - ke * 40 * k;
          if (a.id === 'seal' && ke > 0.15 && ke < 0.85) anim = 'spin';
          if (!fx.out) { fx.out = 1; this.cine.splash(sx, sy, 1); g.audio?.play?.('splash_small', { vol: 0.7 }); }
          if (ke > 0.92 && !fx.land) { fx.land = 1; this.cine.splash(sx, sy, 0.7); g.audio?.play?.('boing', { vol: 0.6 }); }
        }
      } else if (a.how === 'bob') {
        if (ke < 1) {
          y = sy + (1 - ease.outBack(ke)) * 46 * k;
          if (!fx.out) { fx.out = 1; this.addBubbles(sx, sy, 8, { w: 30 * k, vy: 30, r: 2 }); g.audio?.play?.('bubbles', { vol: 0.5 }); }
          if (ke > 0.7) sq = Math.sin(((ke - 0.7) / 0.3) * Math.PI) * 0.3;
          if (ke > 0.9 && !fx.land) { fx.land = 1; this.cine.splash(sx, sy, 0.6); g.audio?.play?.('puff', { vol: 0.6 }); }
        }
      } else if (a.how === 'swim') {
        if (ke < 1) {
          anim = 'swim';
          y = sy + 6 * k + Math.sin(te * 9) * 1.5 * k;
          if (Math.floor(te * 10) !== a.wk) { a.wk = Math.floor(te * 10); this.addBubbles(sx - a.face * 18 * k, sy, 1, { w: 6, vy: 10, r: 1, life: 0.6, col: '#ffffff' }); }
          a.face = Math.sign(a.tx - a.x) || a.face;
          if (ke > 0.82 && !fx.land) { fx.land = 1; a.hop = 12; this.cine.splash(sx, sy, 0.6); g.audio?.play?.('boing', { vol: 0.5, pitch: 1.2 }); }
        }
      } else if (a.how === 'zip') {
        if (ke < 1) {
          y = sy - (1 - ease.outCubic(ke)) * 30 * k;
          if (Math.floor(te * 20) % 2 === 0) try { g.particles?.pixelBurst?.('sparkle', sx + a.face * -14 * k, y - 20 * k, 1, { layer: 'ui', ramp: 'aqua', size: 0, speed: [5, 20] }); } catch { /* optional */ }
          if (!fx.out) { fx.out = 1; g.audio?.play?.('travel_whoosh', { vol: 0.3, pitch: 1.8 }); }
        }
      } else if (a.how === 'bubble') {
        if (ke < 1) { y = sy - (1 - ease.outCubic(ke)) * H * 0.45; bubble = 1; }
        if (ke >= 1 && !fx.pop) {
          fx.pop = 1;
          try { g.particles?.pixelBurst?.('bubble', sx, sy - H * 0.1 * k, 8, { layer: 'ui', speed: [30, 90] }); g.particles?.pixelBurst?.('sparkle', sx, sy - H * 0.1 * k, 5, { layer: 'ui', ramp: 'white' }); } catch { /* optional */ }
          this.cine.splash(sx, sy, 0.6);
          g.audio?.play?.('bubble', { vol: 0.8, pitch: 1.2 });
        }
        if (ke >= 1 && te < E + 0.25) sq = Math.sin(((te - E) / 0.25) * Math.PI) * 0.18;
      }
      if (a.out != null && t > a.out) {
        const u = clamp01((t - a.out) / 0.5);
        y = sy + ease.inCubic(u) * H * 0.25 * k;
        if (!fx.dive) { fx.dive = 1; this.cine.splash(sx, sy, 0.8); g.audio?.play?.('splash_small', { vol: 0.5, pitch: 1.2 }); }
      }
    } else {
      if (ke < 1) { k *= ease.outBack(ke); alpha = clamp01(ke * 3); }
      if (!fx.poof) { fx.poof = 1; try { g.particles?.poof?.(sx, sy - 30, { layer: 'ui' }); } catch { /* optional */ } g.audio?.play?.('bubble', { vol: 0.6 }); }
      if (a.out != null && t > a.out) { const u = clamp01((t - a.out) / 0.45); k *= 1 - ease.inBack(u); alpha = 1 - u; }
    }
    if (k <= 0.02) return null;
    // acting: hops on cheers, a bounce for the seal, a startle on worried
    const idle = !sp && !(a.react && t < a.react.until);
    if (anim === 'cheer' || anim === 'clap' || anim === 'wiggle') y -= Math.abs(Math.sin(t * 7 + a.slot)) * 3 * k;
    if (idle) y += Math.sin(t * 1.7 + a.slot * 1.3) * 1 * k;
    y -= a.hop * k;
    const talk = sp ? this.cine.dlg.talk : 0;
    const mood = MOOD[anim] || (sp ? 'excited' : 'happy');
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (water) { ctx.beginPath(); ctx.rect(0, 0, W, Math.round(sy + 3 * k)); ctx.clip(); }
    ctx.translate(Math.round(x), Math.round(y));
    if (sq) ctx.scale(k * (1 + sq), k * (1 - sq)); else ctx.scale(k, k);
    const foot = water ? 9 : 0;
    let A = null;
    try {
      if (a.id === 'seal') {
        const an = SEAL_ANIMS.has(anim) ? anim : SEAL_MAP[anim] || 'idle';
        A = NPC.drawNPC(ctx, 'seal', { x: 0, y: foot, t, size: this.cine.sealSz(), facing: a.face, anim: an, talk, mood, ride: 0, id: 'qc-seal', noseBubble: a.nose || 0 });
      } else {
        let pose = anim;
        if (a.id === 'fizz' || a.id === 'marina') pose = BUBBLE_MAP[anim] || anim;
        else pose = ['cheer', 'clap', 'wiggle', 'spin', 'laugh', 'wave', 'jump', 'dance', 'flex'].includes(anim) ? 'cheer' : ['talk', 'point', 'think', 'blow'].includes(anim) ? 'talk' : 'idle';
        A = NPC.drawNPC(ctx, a.id, { x: 0, y: foot, t, scale: this.cine.npcScale(a.id), facing: a.face, pose, talk, mood, id: 'qc-' + a.id, shadow: false });
      }
    } catch { A = null; }
    if (bubble) drawSoapBubble(ctx, 0, -H * STAGE_H * 0.5, Math.round(H * STAGE_H * 0.62), Math.sin(t * 6) * 0.3);
    ctx.restore();
    if (water && te > 0.2 && !(a.out != null && t > a.out)) this.cine.drawFoam(ctx, sx, sy, k);
    const top = A?.top ? [x + A.top[0] * k, y + A.top[1] * k] : [x, y - H * STAGE_H * k];
    const mouth = A?.mouth ? [x + A.mouth[0] * k, y + A.mouth[1] * k] : top;
    // blowing bubbles
    if (a.blow != null && t - a.blow < 1.4 && Math.floor(t * 12) !== a.bk) { a.bk = Math.floor(t * 12); this.addBubbles(mouth[0] + a.face * 6 * k, mouth[1], 1, { vx: a.face * 50, vy: 30, r: 1 + (Math.random() * 3 | 0), life: 1.3 }); }
    if (a.emote && a.emoteT != null) this.cine.drawEmote(ctx, top[0], top[1] - 6, a.emote, t - a.emoteT);
    a.scr = { x, y, k, top, mouth };
    return a.scr;
  }

  // in front of the cast: jumping fish, pixel bubbles, the player's emote, weather
  drawFront(ctx) {
    const t = this.t, W = this.W, k = this.k();
    const wy = this.waterY();
    for (const j of this.jumpers) {
      const u = clamp01(j.t / j.dur);
      const wx = lerp(j.x0, j.x1, u), wyy = this.Y0 - Math.sin(u * Math.PI) * j.peak;
      const [x, y] = this.toS(wx, wyy);
      const ang = Math.atan2(-Math.cos(u * Math.PI) * j.peak * Math.PI, (j.x1 - j.x0)) * (j.dir > 0 ? 1 : -1);
      const sp = j.sp;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, Math.round(wy + 1)); ctx.clip();
      try {
        const zz = this.world ? this.g.camera.z || 2 : this.zT * 0.8;
        drawFishFit(ctx, sp, x, y, fitScale(sp, j.len * zz, j.len * zz, 6), t * 2, { facing: j.dir, turn: j.dir, angle: ang * 0.8, speed01: 1 });
      } catch { /* optional */ }
      ctx.restore();
    }
    for (const p of this.bubs) {
      const a = 1 - clamp01((p.t - p.life + 0.3) / 0.3);
      ctx.save(); ctx.globalAlpha *= a;
      const r = p.r;
      ctx.fillStyle = p.col || 'rgba(220,250,255,0.9)';
      if (r <= 1) ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      else {
        ctx.fillStyle = 'rgba(150,230,255,0.35)'; ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r), r * 2, r * 2);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r), 1, 1); ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r + 1), 1, 1);
        ctx.fillStyle = 'rgba(200,245,255,0.9)';
        ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r - 1), r * 2, 1); ctx.fillRect(Math.round(p.x - r), Math.round(p.y + r), r * 2, 1);
        ctx.fillRect(Math.round(p.x - r - 1), Math.round(p.y - r), 1, r * 2); ctx.fillRect(Math.round(p.x + r), Math.round(p.y - r), 1, r * 2);
      }
      ctx.restore();
    }
    // the angler's emote
    const p = this.pl;
    if (p && p.emote && this.world) {
      const h = this.g.boat?.anchorsWorld?.head;
      if (h) { const [x, y] = this.toS(h[0], h[1]); this.cine.drawEmote(ctx, x, y - 14 * k, p.emote, t - p.t0); }
    }
    this.drawWeather(ctx);
  }
  drawWeather(ctx) {
    const t = this.t;
    for (const d of this.drops) {
      let a = d.a;
      if (d.glint) { a = Math.sin((d.t / d.life) * Math.PI); if (a < 0.2) continue; }
      if (d.flick) a *= 0.6 + 0.4 * Math.sin(t * 13 + d.ph);
      if (d.twinkle) a *= 0.5 + 0.5 * Math.sin(t * 3 + d.ph);
      ctx.globalAlpha = a;
      ctx.fillStyle = d.c;
      if (d.streak) { for (let i = 0; i < d.streak; i++) ctx.fillRect(Math.round(d.x - i * 0.13 * 1), Math.round(d.y - i), 1, 1); continue; }
      if (d.glint) { ctx.fillRect(Math.round(d.x) - 1, Math.round(d.y), 3, 1); ctx.fillRect(Math.round(d.x), Math.round(d.y) - 1, 1, 3); continue; }
      ctx.fillRect(Math.round(d.x), Math.round(d.y), d.s, d.s);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- small art helpers
  clipWater(ctx, y, fn) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.W, Math.round(y)); ctx.clip(); try { fn(); } finally { ctx.restore(); } }
  drawFoamLine(ctx, x, y, w) {
    const t = this.t;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = -w; i <= w; i += 3) {
      const yy = Math.round(y + 2 + Math.sin(t * 4 + i * 0.3) * 1.2);
      if (((i * 7 + Math.floor(t * 5)) & 3) !== 0) ctx.fillRect(Math.round(x + i), yy, 2, 1);
    }
  }
  drawReflections(ctx, x, y, k, on) {
    if (!on) return;
    const t = this.t;
    const cols = ['#ff5ad8', '#4af0ff', '#fff07a'];
    for (let i = 0; i < 16; i++) {
      const yy = Math.round(y + 4 + i * 2.2 * k);
      const w = Math.round((10 + Math.sin(t * 3 + i) * 5) * k);
      ctx.globalAlpha = 0.5 * (1 - i / 16);
      ctx.fillStyle = cols[i % 3];
      ctx.fillRect(Math.round(x - 30 * k + Math.sin(t * 2 + i * 1.7) * 6 * k), yy, w, 1);
    }
    ctx.globalAlpha = 1;
  }
  drawSparks(ctx) {
    const t = this.t, s = this.spark;
    if (s == null || t - s > 0.7 || !this.platA?.antenna) return;
    const [x, y] = this.platA.antenna;
    ctx.fillStyle = Math.floor(t * 30) % 2 ? '#ffffff' : '#7affff';
    let px = x, py = y;
    for (let i = 0; i < 6; i++) { const nx = px + (Math.random() - 0.5) * 10, ny = py - 4; ctx.fillRect(Math.round(nx), Math.round(ny), 2, 2); px = nx; py = ny; }
    if (!this.sparkFx) { this.sparkFx = 1; try { this.g.particles?.pixelBurst?.('spark', x, y, 8, { layer: 'ui' }); } catch { /* optional */ } }
    if (t - s > 0.6) this.sparkFx = 0;
  }
  smoke(ctx, at, k) {
    if (!at) return;
    const t = this.t;
    for (let i = 0; i < 6; i++) {
      const u = ((t * 0.4 + i / 6) % 1);
      const x = at[0] + Math.sin(u * 5 + i) * 6 * k, y = at[1] - u * 50 * k;
      const r = Math.round((2 + u * 5) * k);
      ctx.globalAlpha = 0.35 * (1 - u);
      ctx.fillStyle = i % 2 ? '#8a7a8a' : '#6a5a6a';
      ctx.fillRect(Math.round(x - r), Math.round(y - r), r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }
  drawEye(ctx, e, k) {
    const t = this.t;
    const base = this.eyesT != null ? clamp01((t - this.eyesT - e.ph * 0.12) / 0.3) : 0.35 + 0.35 * Math.sin(t * 0.4 + e.ph);
    const blink = Math.sin(t * 1.3 + e.ph * 3) > 0.94 ? 0.2 : 1;
    const o = base * blink;
    if (o < 0.08) return;
    const [x, y] = this.toS(e.x + Math.sin(t * 0.3 + e.ph) * 4, e.y);
    const s = Math.max(1, Math.round(1.5 * k));
    drawAeroGlow(ctx, x, y, 9 * k, e.col, 0.25 * o);
    ctx.globalAlpha = o;
    ctx.fillStyle = e.col;
    const h = Math.max(1, Math.round(s * blink));
    ctx.fillRect(Math.round(x - 4 * k), Math.round(y), s * 2, h); ctx.fillRect(Math.round(x + 2 * k), Math.round(y), s * 2, h);
    ctx.globalAlpha = 1;
  }
  benchFx(ctx, p, k) {
    const t = this.t, A = p.A;
    if (!A.mouthA) return;
    const fl = this.flask != null && t - this.flask < 1.6;
    // steady little bubbles from both flasks, a fountain when it bubbles over
    if (Math.floor(t * (fl ? 20 : 4)) !== p.bt) {
      p.bt = Math.floor(t * (fl ? 20 : 4));
      const m = p.bt % 2 ? A.mouthA : A.mouthB;
      this.addBubbles(m[0], m[1], fl ? 2 : 1, { w: 3, vy: fl ? 60 : 18, r: fl ? 2 : 1, life: fl ? 1 : 0.9, col: p.bt % 2 ? '#c8ffb0' : '#ffd0ec', vx: fl ? (Math.random() - 0.5) * 60 : 0 });
    }
    if (this.flaskPop != null && t - this.flaskPop < 0.05 && !p.popped) { p.popped = 1; try { this.g.particles?.poof?.(A.mouthA[0], A.mouthA[1] - 6, { layer: 'ui' }); this.g.particles?.pixelBurst?.('sparkle', A.mouthA[0], A.mouthA[1], 5, { layer: 'ui', ramp: 'lime' }); } catch { /* optional */ } }
    if (this.flaskPop != null && t - this.flaskPop > 0.3) p.popped = 0;
    drawAeroGlow(ctx, A.flame[0], A.flame[1], 8 * k, '#8ae8ff', 0.35);
    void mix;
  }

  // ---------------------------------------------------------------- boss reveal (pan down, silhouette, rumble)
  bossOf() {
    const ch = CHAPTER_BY_ID[this.ch];
    const q = ch?.quests?.find((x) => x.objectives?.some?.((o) => o.t === 'boss'));
    const id = q?.objectives.find((o) => o.t === 'boss')?.id;
    return BOSS_BY_ID[id] || BOSS_BY_OCEAN[ch?.ocean] || null;
  }
  drawBoss(ctx, boss, u, dur) {
    // u = seconds since the reveal began
    const W = this.W, H = this.H, t = this.t;
    if (!boss) return;
    const wy = this.waterY();
    // the water below darkens: the deep holds its breath
    const dk = clamp01(u / 0.8) * (1 - clamp01((u - dur + 0.6) / 0.6));
    if (dk > 0) {
      const gr = ctx.createLinearGradient(0, Math.max(0, wy), 0, H);
      gr.addColorStop(0, `rgba(2,12,34,${(0.25 * dk).toFixed(3)})`);
      gr.addColorStop(1, `rgba(1,4,16,${(0.7 * dk).toFixed(3)})`);
      ctx.fillStyle = gr; ctx.fillRect(0, Math.max(0, Math.round(wy)), W, H);
    }
    const sp = SPECIES_BY_ID[boss.id];
    const su = clamp01((u - 0.6) / (dur - 0.9));
    if (!sp || su <= 0 || su >= 1) return;
    const dir = this.side;
    const wx = this.midX - dir * 170 + dir * 340 * ease.inOutQuad(su);
    const wyy = this.Y0 + 120 + Math.sin(su * Math.PI * 2) * 8;
    const [x, y] = this.toS(wx, wyy);
    const zz = this.world ? this.g.camera.z || 2 : this.zT * 0.8;
    const fade = Math.min(clamp01(su * 6), clamp01((1 - su) * 6));
    ctx.save();
    ctx.globalAlpha *= 0.9 * fade;
    ctx.beginPath(); ctx.rect(0, Math.round(wy + 2), W, H); ctx.clip();
    let A = null;
    try { A = drawFishFit(ctx, sp, x, y, fitScale(sp, boss.len * 0.8 * zz, boss.len * 0.6 * zz, 12), t, { facing: dir, turn: dir, silhouette: '#02081a', speed01: 0.3 }); } catch { A = null; }
    // a glowing eye in the dark
    const e = A?.eyes?.[0];
    if (e) { drawAeroGlow(ctx, e.x, e.y, 12, boss.glow || '#ffffff', 0.5); ctx.fillStyle = boss.color || '#ffffff'; ctx.fillRect(Math.round(e.x - 2), Math.round(e.y - 1), 4, 3); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(e.x - 1), Math.round(e.y - 1), 1, 1); }
    ctx.restore();
    if (Math.floor(t * 8) !== this.bossBub) { this.bossBub = Math.floor(t * 8); this.addBubbles(x - dir * 30, y - 20, 1, { w: 30, vy: 40, r: 1 + (Math.random() * 2 | 0), life: 1.5 }); }
  }
}

export function stageNpcScale(H, id) { return Math.max(0.8, Math.round(((H * STAGE_H) / (NPC_H[id] || 64)) * 4) / 4); }
export function stageSealSize(H) { return sealSize(Math.max(36, H * 0.105)); }
