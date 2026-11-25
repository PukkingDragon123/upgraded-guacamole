// Reusable dialogue system (phase 5 Intro agent, phase 6 Guide agent): typed-out Alagard text with procedural voice
// blips, a live portrait, 2-3 glossy response choices (click, or keys 1/2/3) and callbacks. The opening (cinematic
// panel) and the tutorial (speech bubble next to Bubbles the toy grouper) both use it. Phase 6: everything is bigger and
// follows the UI size setting (Alagard 16 / 20 / 24 / 32 px for ui scale normal / big / huge), and speech bubbles
// pick the side of the speaker that keeps clear of what the guide is pointing at.
//
//   const d = new Dialogue({audio, voice: 'guide' (an 8-bit voice id, src/core/audio.js), name: 'Bubbles', portrait(ctx, cx, cy, r, d), vars: {name}, size})
//   d.say(text, o)         queue a line; o: {mood, pose, choices: [{text, value, mood, reply}], onChoose(choice, i),
//                          onShow(line), onDone(line), hold (s after typing before auto-advance; 0 = wait for a
//                          click), wait (always wait for a click), big, cps (chars/s), silent (no voice blips),
//                          autoPick (s before choice 0 is picked for the player)}
//   d.script(lines, onDone) queue several lines (strings or [text, o] / {text, ...o}); onDone after the last one
//   d.now(text, o)         replace everything with this line
//   d.clear()  d.advance()  d.choose(i)  d.finishTyping()
//   d.update(dt, input, {mouse = true, keys = true}) -> true when it used the click / key (consumed)
//   d.drawPanel(ctx, {x, y, w, h, t, alpha})      cinematic glass panel: portrait orb, name tag, text, next arrow
//                                                 (grows to fit the text; d.panelH(w) is the height it wants)
//   d.drawBubble(ctx, ax, ay, {maxW, t, alpha, W, H, side, sides: {above, below, left, right: [x, y]}, avoid: [rects]})
//                                                 a speech bubble with its tail at the speaker; side 'auto' tries
//                                                 above / below / right / left and keeps clear of `avoid`
//   d.drawChoices(ctx, {x, y, w, align, t})       the response bubbles (drawPanel / drawBubble call it)
//   d.fontSize (Alagard px, from the UI scale or o.size), dialogueFontSize()
//   d.active d.line d.typing d.waiting d.choosing d.talk (0..1 mouth) d.mood d.pose d.shown (chars revealed)
//   d.choiceRects() -> [{x, y, w, h, i}]   d.panelRect   d.hit(x, y)   d.vars ({name} etc. in text)
//   Dialogue.auto = i   (test hook) choices are picked automatically (index i) after a short beat.

import { alagardBitmap, loadAlagard, alagardReady } from '../gfx/alagard.js';
import * as AE from '../ui/aero.js';
import { clamp, clamp01, ease } from '../core/math.js';

loadAlagard();

const FONT = 16;           // Alagard's pixel grid
// Alagard size for the current UI scale (phase 6: the UI agent's uiK(), 1.25 / 1.6 / 2)
export function dialogueFontSize() {
  let k = 1.6;
  try { k = AE.uiK?.() ?? 1.6; } catch (e) { k = 1.6; }
  return k >= 1.9 ? 32 : k >= 1.45 ? 24 : 20;
}
let MCTX = null;
export function alagardWidth(text, size = FONT) {
  if (!MCTX) MCTX = document.createElement('canvas').getContext('2d');
  MCTX.font = size + 'px Alagard, monospace';
  return MCTX.measureText(text).width;
}

export function wrapAlagard(text, maxW, size = FONT) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (line && alagardWidth(t, size) > maxW) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// Draw Alagard text (optionally only the first `chars` characters) with a soft drop shadow.
export function drawAlagard(ctx, text, x, y, o = {}) {
  if (!text) return 0;
  const size = o.size || FONT;
  const color = o.color || '#ffffff';
  const shown = o.chars == null ? text.length : clamp(Math.floor(o.chars), 0, text.length);
  if (shown <= 0) return 0;
  const bm = alagardBitmap(text, { size, color });
  const wFull = alagardWidth(text, size);
  const w = shown >= text.length ? bm.width : Math.min(bm.width, Math.ceil(alagardWidth(text.slice(0, shown), size)) + 1);
  let dx = Math.round(x);
  if (o.align === 'center') dx = Math.round(x - wFull / 2);
  else if (o.align === 'right') dx = Math.round(x - wFull);
  const dy = Math.round(y);
  if (o.shadow) {
    const sh = alagardBitmap(text, { size, color: o.shadow });
    ctx.drawImage(sh, 0, 0, w, sh.height, dx, dy + 1, w, sh.height);
    if (o.outline) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 2]]) ctx.drawImage(sh, 0, 0, w, sh.height, dx + ox, dy + oy, w, sh.height);
  }
  ctx.drawImage(bm, 0, 0, w, bm.height, dx, dy, w, bm.height);
  return wFull;
}

const VOWEL = /[aeiouy]/i;

// [pixui30] pixel-art chrome for the dialogue box / bubbles / choices (see aero.js PIXEL KIT)
const DLG_TONE = { top: '#3a9ce0', mid: '#165a9e', bot: '#082a62', edge: '#020e2a', text: '#ffffff', shadow: '#020e24', glow: '#3ab0ff', a: [0.96, 0.97] };
// a downward pixel triangle (rows of fillRects) with apex at (cx, y + s), optional 1 px outline
function pixelTri(ctx, cx, y, s, fill, outline) {
  cx = Math.round(cx); y = Math.round(y);
  if (outline) { ctx.fillStyle = outline; for (let i = -1; i <= s + 1; i++) { const hw = s - i + 1; if (hw >= 0) ctx.fillRect(cx - hw, y + i, hw * 2 + 1, 1); } }
  ctx.fillStyle = fill;
  for (let i = 0; i <= s; i++) { const hw = s - i; ctx.fillRect(cx - hw, y + i, hw * 2 + 1, 1); }
}
// a stepped pixel wedge from a base edge to a tip (the speech-bubble tail): rows / columns of fillRects
function pixelTail(ctx, side, bx0, bx1, by, tipX, tipY, fill, outline) {
  const vert = side === 'above' || side === 'below';
  const L = Math.max(1, Math.round(vert ? Math.abs(tipY - by) : Math.abs(tipX - by)));
  for (const pass of [0, 1]) {
    if (pass === 0 && !outline) continue;
    ctx.fillStyle = pass ? fill : outline;
    const e = pass ? 0 : 1;
    for (let i = 0; i <= L; i++) {
      const k = i / L;
      const a = bx0 + ((vert ? tipX : tipY) - bx0) * k, b = bx1 + ((vert ? tipX : tipY) - bx1) * k;
      const lo = Math.round(Math.min(a, b)) - e, hi = Math.round(Math.max(a, b)) + e;
      const dir = side === 'above' || side === 'left' ? 1 : -1;
      const pos = Math.round(by + dir * i);
      if (vert) ctx.fillRect(lo, pos, Math.max(1, hi - lo + 1), 1);
      else ctx.fillRect(pos, lo, 1, Math.max(1, hi - lo + 1));
    }
    if (!pass && e) { const dir = side === 'above' || side === 'left' ? 1 : -1; if (vert) ctx.fillRect(Math.round(tipX), Math.round(by + dir * (L + 1)), 1, 1); else ctx.fillRect(Math.round(by + dir * (L + 1)), Math.round(tipY), 1, 1); }
  }
}

export class Dialogue {
  constructor(o = {}) {
    this.audio = o.audio || null;
    this.voice = o.voice || 'clip';
    this.name = o.name ?? 'Clip';
    this.portrait = o.portrait || null;
    this.vars = o.vars || {};
    this.queue = [];
    this.line = null;
    this.t = 0;
    this.talk = 0;
    this.mood = o.mood || 'happy';
    this.pose = 'idle';
    this.hover = -1;
    this.rects = [];
    this.panelRect = null;
    this.blipN = 0;
    this.picked = -1;
    this.size = o.size || 0;
  }

  get fontSize() { return this.size || dialogueFontSize(); }
  get lineH() { return Math.round(this.fontSize * 0.86); }

  get active() { return !!this.line; }
  get typing() { return !!this.line && this.shown < this.line.text.length; }
  get choosing() { return !!this.line && !this.typing && !!this.line.choices?.length && this.picked < 0; }
  get waiting() { return !!this.line && !this.typing && !this.choosing; }

  fill(s) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (this.vars[k] != null ? String(this.vars[k]) : m)); }

  say(text, o = {}) {
    this.queue.push({ ...o, raw: text });
    if (!this.line) this.next();
    return this;
  }

  script(lines, onDone) {
    const list = lines.filter(Boolean).map((l) => (typeof l === 'string' ? { raw: l } : Array.isArray(l) ? { ...(l[1] || {}), raw: l[0] } : { ...l, raw: l.text }));
    if (list.length && onDone) {
      const last = list[list.length - 1];
      const prev = last.onDone;
      last.onDone = (ln) => { prev?.(ln); onDone(); };
    } else if (onDone) onDone();
    for (const l of list) this.queue.push(l);
    if (!this.line) this.next();
    return this;
  }

  now(text, o = {}) { this.queue = []; this.line = null; return this.say(text, o); }

  clear() { this.queue = []; this.line = null; this.talk = 0; this.rects = []; }

  next() {
    const prev = this.line;
    this.line = null;
    this.rects = [];
    if (prev) prev.onDone?.(prev);
    if (this.line) return; // onDone queued (and started) a new line
    const l = this.queue.shift();
    if (!l) return;
    l.text = this.fill(l.raw);
    l.choices = (l.choices || []).map((c) => ({ ...c, text: this.fill(c.text) }));
    this.line = l;
    this.shown = 0;
    this.t = 0;
    this.doneT = 0;
    this.picked = -1;
    this.pickT = 0;
    this.hover = -1;
    if (l.mood) this.mood = l.mood;
    this.pose = l.pose || (l.choices.length ? 'talk' : 'talk');
    l.onShow?.(l);
  }

  finishTyping() { if (this.line) this.shown = this.line.text.length; }

  advance() {
    if (!this.line) return;
    if (this.typing) { this.finishTyping(); return; }
    if (this.choosing) return;
    this.next();
  }

  choose(i) {
    const l = this.line;
    if (!l || !l.choices?.length || this.picked >= 0) return false;
    if (this.typing) this.finishTyping();
    const c = l.choices[i];
    if (!c) return false;
    this.picked = i;
    this.pickT = 0;
    try { this.audio?.play?.('ui_click', { vol: 0.5, pitch: 1.2 }); this.audio?.play?.('bubble', { vol: 0.45 }); } catch (e) { /* optional */ }
    // [voices23] the angler blurts the first words of the answer in the player's 8-bit voice
    try { this.audio?.babble?.(String(c.text || '').split(/\s+/).slice(0, 3).join(' ') + ' ', 'player'); } catch (e) { /* optional */ }
    if (c.mood) this.mood = c.mood;
    l.onChoose?.(c, i);
    // the reply line (if any) follows the choice
    if (c.reply) this.queue.unshift({ raw: c.reply, mood: c.mood || l.mood, pose: c.pose || 'talk', hold: c.hold, onDone: c.onReplyDone });
    return true;
  }

  choiceRects() { return this.rects.map((r) => ({ ...r })); }

  hit(x, y) {
    if (this.rects.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h)) return true;
    const p = this.panelRect;
    return !!(p && x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h);
  }

  // -> true when the input was used
  update(dt, inp, o = {}) {
    const l = this.line;
    if (!l) { this.talk = Math.max(0, this.talk - dt * 6); return false; }
    this.t += dt;
    let used = false;
    // typing + voice blips
    if (this.typing) {
      const cps = l.cps ?? 40;
      const before = Math.floor(this.shown);
      const ch = l.text[Math.min(l.text.length - 1, before)] || '';
      const slow = /[.,!?;:]/.test(ch) ? 0.28 : 1;
      this.shown = Math.min(l.text.length, this.shown + dt * cps * slow);
      const after = Math.floor(this.shown);
      for (let i = before; i < after; i++) {
        const c = l.text[i];
        // [voices23] 8-bit voice: a blip every other letter, an arpeggio on the first ! ? . , ~ of a run
        const pun = /[!?.,~]/.test(c) && l.text[i - 1] !== c;
        if (!l.silent && (pun || (/[a-z0-9]/i.test(c) && this.blipN++ % 2 === 0))) { try { this.audio?.babble?.(c, l.voice || this.voice); } catch (e) { /* optional */ } }
      }
      const c2 = l.text[after] || '';
      const open = /[.,!?]/.test(c2) ? 0.1 : VOWEL.test(c2) ? 1 : 0.55;
      this.talk = clamp01(open * (0.55 + 0.45 * Math.abs(Math.sin(this.t * 19))));
    } else {
      this.talk = Math.max(0, this.talk - dt * 8);
      this.doneT += dt;
    }
    // input
    if (inp) {
      if (o.mouse !== false) {
        this.hover = -1;
        for (const r of this.rects) if (inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h) this.hover = r.i;
      }
      if (this.choosing || (this.typing && l.choices?.length)) {
        for (let i = 0; i < Math.min(3, l.choices.length); i++) {
          if (o.keys !== false && inp.keyPressed?.(String(i + 1))) { if (this.typing) this.finishTyping(); this.choose(i); used = true; }
        }
        if (!used && o.mouse !== false && inp.pressed && this.hover >= 0 && !this.typing) { this.choose(this.hover); inp.consume?.(); used = true; }
      }
      if (!used) {
        const key = o.keys !== false && (inp.keyPressed?.(' ') || inp.keyPressed?.('Enter'));
        const click = o.mouse !== false && inp.pressed && (o.clickAnywhere || (this.panelRect && this.hit(inp.x, inp.y)));
        if (key || click) {
          if (this.typing) { this.finishTyping(); used = true; }
          else if (!this.choosing && this.doneT > 0.12) { this.next(); used = true; }
          if (click && used) inp.consume?.();
        }
      }
    }
    // auto-advance / auto-pick
    const L = this.line;
    if (L === l && !this.typing) {
      if (this.picked >= 0) {
        this.pickT += dt;
        if (this.pickT > 0.45) this.next();
      } else if (L.choices?.length) {
        if (Dialogue.auto != null && this.doneT > 0.35) this.choose(Math.min(L.choices.length - 1, Dialogue.auto));
        else if (L.autoPick != null && this.doneT > L.autoPick) this.choose(0);
      } else {
        const hold = L.wait ? Infinity : L.hold ?? 1.6 + L.text.length * 0.035;
        if (hold > 0 && this.doneT > hold) this.next();
      }
    }
    return used;
  }

  // ---------------------------------------------------------------------------------- drawing
  wrap(l, maxW) {
    const fs = this.fontSize;
    if (l._wrapW === maxW && l._wrapF === fs && l._wrap) return l._wrap;
    l._wrap = wrapAlagard(l.text, maxW, fs); l._wrapW = maxW; l._wrapF = fs;
    return l._wrap;
  }

  // the panel height drawPanel wants for width w (text lines + padding)
  panelH(w, minH = 0) {
    const l = this.line;
    const k = this.fontSize / 16;
    const base = Math.max(minH, Math.round(66 * k));
    if (!l) return base;
    const pr = Math.round(base * 0.42);
    const maxW = w - (pr * 2 + 14 + 14) - 18;
    const n = this.wrap(l, maxW).length;
    return Math.max(base, n * (this.lineH + 3) + Math.round(22 * k));
  }

  // Cinematic panel (bottom of the screen): deep aqua glass, portrait orb, name tag, typed text, choices above.
  drawPanel(ctx, o) {
    const l = this.line;
    if (!l) { this.panelRect = null; this.rects = []; return; }
    const fs = this.fontSize, k = fs / 16, LH = this.lineH;
    const { x, w } = o;
    const h0 = o.h;
    const pr = Math.round(Math.max(h0, Math.round(66 * k)) * 0.42);
    const h = Math.max(h0, this.panelH(w, h0));
    const y = o.y - (h - h0); // grows upward
    const t = o.t ?? this.t;
    const a0 = ctx.globalAlpha;
    const kk = ease.outBack(clamp01(this.t * 5));
    ctx.save();
    ctx.globalAlpha = a0 * (o.alpha ?? 1) * clamp01(this.t * 6);
    const yy = Math.round(y + (1 - kk) * 18);
    const R = Math.round(14 * Math.min(1.5, k));
    this.panelRect = { x, y: yy, w, h };
    // [pixui30] pixel-art glass body: hard drop shadow, stepped corners, dark outline, light bevel, flat bands
    AE.pixelShadow(ctx, x, yy, w, h, 2, 4, { n: 3, alpha: 0.5, color: '#041c40' });
    AE.drawAeroSurface(ctx, x, yy, w, h, { tone: DLG_TONE, a: [0.96, 0.97], r: R, gloss: 0.32, glossH: Math.round(h * 0.34), rim: 1, glow: 0.4, streak: true, seed: 3 });
    // tiny square pixel bubbles drifting up inside the glass
    for (let i = 0; i < 9; i++) {
      const ph = (t * 0.12 + i * 0.37) % 1;
      const bx = Math.round(x + 30 + ((i * 97) % (w - 60))), by = Math.round(yy + h - 6 - ph * (h - 12));
      const s2 = 1 + (i % 2);
      ctx.globalAlpha = a0 * (o.alpha ?? 1) * (ph < 0.15 || ph > 0.85 ? 0.25 : 0.5);
      ctx.fillStyle = '#bff4ff'; ctx.fillRect(bx, by, s2 + 1, s2 + 1);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, by, 1, 1);
    }
    ctx.globalAlpha = a0 * (o.alpha ?? 1) * clamp01(this.t * 6);
    // portrait: a stepped pixel frame (square with notched corners), the portrait clipped to its stepped well
    const pcx = Math.round(x + pr + 14), pcy = Math.round(yy + h / 2);
    const pS = pr * 2;
    AE.drawAeroSurface(ctx, pcx - pr, pcy - pr, pS, pS, { tone: 'white', r: 12, gloss: 0.4, glossH: Math.round(pS * 0.4), rim: 1, glow: 0.3, edge: '#04214a' });
    AE.drawAeroSurface(ctx, pcx - pr + 3, pcy - pr + 3, pS - 6, pS - 6, { top: '#d8fbff', mid: '#8fe4f6', bot: '#2a9ad4', edge: '#0a4a7e', r: 8, gloss: 0, rim: 0.4, glow: 0.3, inset: true });
    if (this.portrait) {
      ctx.save();
      AE.pixelRectPath(ctx, pcx - pr + 4, pcy - pr + 4, pS - 8, pS - 8, 6); ctx.clip();
      try { this.portrait(ctx, pcx, pcy, pr, this); } catch (e) { /* optional */ }
      ctx.restore();
    }
    // name tag (a stepped green plaque)
    const tx = pcx + pr + 14;
    if (this.name) {
      const nfs = fs >= 24 ? 20 : 16;
      const th = Math.round(nfs * 1.15);
      const nw = Math.ceil(alagardWidth(this.name.toUpperCase(), nfs)) + 22;
      const ny = yy - Math.round(th * 0.55);
      AE.pixelShadow(ctx, tx - 4, ny, nw, th, 1, 2, { n: 2, alpha: 0.45 });
      AE.drawAeroSurface(ctx, tx - 4, ny, nw, th, { top: '#c8ffb0', mid: '#3fd06a', bot: '#1e9a48', edge: '#0a4a1e', r: 'pill', gloss: 0.5, glossH: Math.round(th * 0.4), rim: 1, glow: 0.3 });
      drawAlagard(ctx, this.name.toUpperCase(), tx + 7, ny + Math.round((th - nfs * 1.05) / 2), { size: nfs, color: '#ffffff', shadow: '#0c5a2a' });
    }
    // the typed text
    const maxW = x + w - tx - 18;
    const lines = this.wrap(l, maxW);
    let left = Math.floor(this.shown);
    const ty0 = yy + Math.round((h - lines.length * (LH + 3)) / 2) - Math.round(fs * 0.12);
    lines.forEach((ln, i) => {
      if (left <= 0) return;
      drawAlagard(ctx, ln, tx, ty0 + i * (LH + 3), { size: fs, chars: left, color: '#ffffff', shadow: '#06264e' });
      left -= ln.length + 1;
    });
    // next arrow
    if (this.waiting && this.picked < 0) {
      const bob = Math.round(Math.sin(t * 6) * 2);
      const ax = x + w - 20, ay = yy + h - 16 + bob, s = Math.round(5 * Math.min(1.6, k));
      pixelTri(ctx, ax, Math.round(ay - s * 0.6), s, '#ffffff', '#06264e');
    }
    ctx.restore();
    ctx.globalAlpha = a0;
    // choices: a row of bubbles above the panel
    if (l.choices?.length && !this.typing) this.drawChoices(ctx, { x: x + w, y: yy - Math.round(16 * k), align: 'right', t, W: o.W });
    else this.rects = [];
  }

  // Speech bubble with its tail at the speaker. Returns the bubble rect.
  //   o.side: 'auto' (default) | 'above' | 'below' | 'left' | 'right'; o.sides: anchor per side (default (ax, ay));
  //   o.avoid: rects to keep clear of (what the speaker points at); o.maxW: wrap width
  drawBubble(ctx, ax, ay, o = {}) {
    const l = this.line;
    if (!l) { this.panelRect = null; this.rects = []; return null; }
    const W = o.W || 960, H = o.H || 540;
    const t = o.t ?? this.t;
    const fs = this.fontSize, k = fs / 16, LH = this.lineH;
    const pad = Math.round(9 * k), M = 6;
    const maxW = o.maxW || Math.round(200 * k);
    const lines = this.wrap(l, maxW);
    const tw = Math.max(Math.round(40 * k), ...lines.map((s) => Math.ceil(alagardWidth(s, fs)))) + pad * 2;
    const th = lines.length * (LH + 2) + Math.round(pad * 1.2);
    const gap = Math.round(14 * Math.min(1.4, k));
    const S = o.sides || {};
    const place = (side) => {
      const [px, py] = S[side] || [ax, ay];
      let bx, by;
      if (side === 'above') { bx = px - tw / 2; by = py - th - gap; }
      else if (side === 'below') { bx = px - tw / 2; by = py + gap; }
      else if (side === 'right') { bx = px + gap; by = py - th / 2; }
      else { bx = px - tw - gap; by = py - th / 2; }
      const cx = clamp(bx, M, W - tw - M), cy = clamp(by, M, H - th - M);
      const off = Math.abs(cx - bx) + Math.abs(cy - by);
      return { side, px, py, x: Math.round(cx), y: Math.round(cy), off };
    };
    const hits = (r) => (o.avoid || []).some((a) => a && r.x < a.x + a.w && r.x + tw > a.x && r.y < a.y + a.h && r.y + th > a.y);
    let P;
    const want = o.side && o.side !== 'auto' ? o.side : null;
    if (o.below != null && !want) P = place(o.below ? 'below' : 'above');
    else if (want) P = place(want);
    else {
      const order = ['above', 'below', 'right', 'left'];
      const cands = order.map(place);
      P = cands.find((c) => c.off < 4 && !hits(c)) || cands.find((c) => !hits(c)) || cands[0];
      // keep the chosen side while it still works (no flip-flopping)
      const prev = this._side && cands.find((c) => c.side === this._side);
      if (prev && prev !== P && prev.off < 4 && !hits(prev)) P = prev;
    }
    this._side = P.side;
    const { x: bx, y: by, side } = P;
    const pop = ease.outBack(clamp01(this.t * 5));
    const a0 = ctx.globalAlpha;
    ctx.save();
    ctx.globalAlpha = a0 * (o.alpha ?? 1);
    const ox = side === 'left' ? bx + tw : side === 'right' ? bx : clamp(P.px, bx, bx + tw);
    const oy = side === 'above' ? by + th : side === 'below' ? by : clamp(P.py, by, by + th);
    void ox; void oy;
    // [pixui30] pop in by sliding a few whole pixels (no scaling: pixels stay square); big lines hop
    ctx.translate(0, Math.round((1 - pop) * 6) - (l.big && Math.sin(t * 12) > 0.5 ? 1 : 0));
    this.panelRect = { x: bx, y: by, w: tw, h: th };
    // tail toward the speaker: a stepped pixel wedge with an outline, drawn under the bubble
    const tl = Math.round(7 * Math.min(1.6, k));
    const fillC = '#f4fdff', inkC = '#1d5a8a';
    if (side === 'above' || side === 'below') {
      const tx = clamp(P.px, bx + tl * 2, bx + tw - tl * 2), ey = side === 'above' ? by + th - 2 : by + 1;
      const tipY = side === 'above' ? Math.min(P.py - 2, ey + gap) : Math.max(P.py + 2, ey - gap);
      pixelTail(ctx, side, tx - tl, tx + tl, ey, clamp(P.px, tx - tl * 2, tx + tl * 2), tipY, fillC, inkC);
    } else {
      const ty = clamp(P.py, by + tl * 2, by + th - tl * 2), ex = side === 'left' ? bx + tw - 2 : bx + 1;
      const tipX = side === 'left' ? Math.min(P.px - 2, ex + gap) : Math.max(P.px + 2, ex - gap);
      pixelTail(ctx, side, ty - tl, ty + tl, ex, tipX, clamp(P.py, ty - tl * 2, ty + tl * 2), fillC, inkC);
    }
    AE.pixelShadow?.(ctx, bx, by, tw, th, 2, 2, { n: 2, alpha: 0.3 });
    AE.drawAeroSurface?.(ctx, bx, by, tw, th, { tone: 'frost', edge: inkC, r: Math.round(10 * Math.min(1.5, k)), gloss: 0.4, glossH: Math.round(th * 0.36), rim: 0.9, glow: 0.4 });
    // re-cover the seam where the tail meets the body
    ctx.fillStyle = fillC;
    if (side === 'above' || side === 'below') { const tx = clamp(P.px, bx + tl * 2, bx + tw - tl * 2); ctx.fillRect(Math.round(tx - tl + 1), side === 'above' ? by + th - 2 : by, tl * 2 - 1, 2); }
    else { const ty = clamp(P.py, by + tl * 2, by + th - tl * 2); ctx.fillRect(side === 'left' ? bx + tw - 2 : bx, Math.round(ty - tl + 1), 2, tl * 2 - 1); }
    const ink = AE.AERO?.ink || '#13304e';
    let left = Math.floor(this.shown);
    lines.forEach((ln, i) => {
      if (left <= 0) return;
      drawAlagard(ctx, ln, bx + pad, by + Math.round(pad * 0.55) + i * (LH + 2), { size: fs, chars: left, color: ink, shadow: 'rgba(255,255,255,0.9)' });
      left -= ln.length + 1;
    });
    ctx.restore();
    ctx.globalAlpha = a0;
    if (l.choices?.length && !this.typing) {
      const up = side !== 'above' ? false : true;
      this.drawChoices(ctx, { x: bx + tw / 2, y: up ? by - 8 : by + th + 8 + Math.round(fs * 1.5), align: 'center', t, up, W, small: true });
    } else this.rects = [];
    return this.panelRect;
  }

  // Glossy response bubbles (number badge + Alagard text), popping in one by one. y is the row's bottom edge.
  drawChoices(ctx, o) {
    const l = this.line;
    const cs = l.choices || [];
    const t = this.doneT;
    const fs = this.fontSize, k = fs / 16;
    const gap = Math.round(8 * k), ph = Math.round((o.small ? 21 : 24) * k);
    const widths = cs.map((c) => Math.ceil(alagardWidth(c.text, fs)) + Math.round((o.small ? 36 : 44) * k));
    let total = widths.reduce((s, w) => s + w, 0) + gap * (cs.length - 1);
    // too wide for the screen: stack them
    const W = o.W || 9999;
    const stack = total > W - 12;
    let x0 = o.align === 'right' ? o.x - total : o.align === 'center' ? o.x - total / 2 : o.x;
    if (stack) { const mw = Math.max(...widths); total = mw; x0 = o.align === 'right' ? o.x - mw : o.align === 'center' ? o.x - mw / 2 : o.x; }
    if (o.W) x0 = clamp(x0, 6, o.W - total - 6);
    const y = Math.round(o.y - ph);
    this.rects = [];
    let x = Math.round(x0);
    cs.forEach((c, i) => {
      const w = widths[i];
      const kk = ease.outBack(clamp01((t - i * 0.08) * 5));
      const picked = this.picked === i, other = this.picked >= 0 && !picked;
      const hov = this.hover === i && this.picked < 0;
      const lift = hov ? -2 : 0;
      const pk = picked ? 1 + 0.12 * Math.sin(clamp01(this.pickT * 3) * Math.PI) : 1;
      const rowY = stack ? y - (cs.length - 1 - i) * (ph + gap) : y;
      const yy = rowY + Math.round((1 - kk) * 14) + lift + Math.round(Math.sin((o.t ?? 0) * 2.4 + i * 1.3) * (this.picked < 0 ? 1.5 : 0));
      this.rects.push({ x, y: yy, w, h: ph, i });
      ctx.save();
      ctx.globalAlpha *= clamp01(kk * 1.4) * (other ? Math.max(0, 1 - this.pickT * 4) : 1);
      // [pixui30] stepped pixel pill (no scaling: picked choices hop up a pixel instead)
      if (pk > 1.03) ctx.translate(0, -1);
      const look = picked ? { top: '#e4ffc8', mid: '#6ee04a', bot: '#2fa82a', edge: '#0e4a12', text: '#ffffff', shadow: '#0e4a12', glow: '#eaffb4', a: [1, 1] }
        : hov ? { top: '#ffffff', mid: '#a8f4ff', bot: '#3ec4ec', edge: '#0a3e74', text: '#0e3a66', shadow: '#ffffff', glow: '#ffffff', a: [1, 1] }
        : { top: '#f4feff', mid: '#c8f2ff', bot: '#6fd0f0', edge: '#1d5a8a', text: '#0e3a66', shadow: '#ffffff', glow: '#ffffff', a: [1, 1] };
      AE.pixelShadow(ctx, x, yy, w, ph, 1, 3, { n: 2, alpha: 0.4, color: '#041e46' });
      AE.drawAeroSurface(ctx, x, yy, w, ph, { tone: look, r: 'pill', gloss: 0.55, glossH: Math.round(ph * 0.38), rim: 1, glow: 0.4 });
      // number badge: a small stepped square
      const br = Math.round(ph / 2 - 3), bcx = x + br + 4, bcy = Math.round(yy + ph / 2);
      AE.drawAeroSurface(ctx, bcx - br, bcy - br, br * 2, br * 2, { top: '#9ff8ff', mid: '#3aa8e8', bot: '#1a6ac0', edge: '#06264e', r: 4, gloss: 0.4, glossH: br, rim: 1, glow: 0.2 });
      const nfs = fs >= 24 ? 20 : 16;
      drawAlagard(ctx, String(i + 1), bcx, bcy - Math.round(nfs * 0.55), { size: nfs, align: 'center', color: '#ffffff', shadow: '#0a4a8a' });
      drawAlagard(ctx, c.text, bcx + br + Math.round(6 * k), yy + Math.round(ph / 2) - Math.round(fs * 0.55), { size: fs, color: '#0e3a66', shadow: 'rgba(255,255,255,0.8)' });
      if (hov && Math.sin((o.t ?? 0) * 9) > 0.6) AE.drawSparkle?.(ctx, x + w - 8, yy + 2, 2, 1);
      ctx.restore();
      x += stack ? 0 : w + gap;
    });
  }
}

// [pixui30] stepped pixel path (kept for older callers; no arcs)
export function roundRect(ctx, x, y, w, h, r) { AE.pixelRectPath(ctx, x, y, w, h, r); }

export { alagardReady };
