// Reusable dialogue system (phase 5, Intro agent): typed-out Alagard text with procedural voice blips, a live
// portrait, 2-3 glossy response choices (click, or keys 1/2/3) and callbacks. The opening (cinematic panel)
// and the tutorial (speech bubble next to Clip) both use it.
//
//   const d = new Dialogue({audio, voice: 'clip', name: 'Clip', portrait(ctx, cx, cy, r, d), vars: {name}})
//   d.say(text, o)         queue a line; o: {mood, pose, choices: [{text, value, mood, reply}], onChoose(choice, i),
//                          onShow(line), onDone(line), hold (s after typing before auto-advance; 0 = wait for a
//                          click), wait (always wait for a click), big, cps (chars/s), text3d}
//   d.script(lines, onDone) queue several lines (strings or [text, o] / {text, ...o}); onDone after the last one
//   d.now(text, o)         replace everything with this line
//   d.clear()  d.advance()  d.choose(i)  d.finishTyping()
//   d.update(dt, input, {mouse = true, keys = true}) -> true when it used the click / key (consumed)
//   d.drawPanel(ctx, {x, y, w, h, t, alpha})      cinematic glass panel: portrait orb, name tag, text, next arrow
//   d.drawBubble(ctx, ax, ay, {maxW, t, alpha, W, H}) a speech bubble pointing at (ax, ay) (tutorial)
//   d.drawChoices(ctx, {x, y, w, align, t})       the response bubbles (drawPanel / drawBubble call it)
//   d.active d.line d.typing d.waiting d.choosing d.talk (0..1 mouth) d.mood d.pose d.shown (chars revealed)
//   d.choiceRects() -> [{x, y, w, h, i}]   d.panelRect   d.hit(x, y)   d.vars ({name} etc. in text)
//   Dialogue.auto = i   (test hook) choices are picked automatically (index i) after a short beat.

import { alagardBitmap, loadAlagard, alagardReady } from '../gfx/alagard.js';
import * as AE from '../ui/aero.js';
import { clamp, clamp01, ease, TAU } from '../core/math.js';

loadAlagard();

const FONT = 16;           // Alagard's pixel grid
const LINE_H = 13;
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
  }

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
        if (/[a-z0-9]/i.test(c) && this.blipN++ % 2 === 0) { try { this.audio?.babble?.(c, this.voice); } catch (e) { /* optional */ } }
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
  // Cinematic panel (bottom of the screen): deep aqua glass, portrait orb, name tag, typed text, choices above.
  drawPanel(ctx, o) {
    const l = this.line;
    if (!l) { this.panelRect = null; this.rects = []; return; }
    const { x, y, w, h } = o;
    const t = o.t ?? this.t;
    const a0 = ctx.globalAlpha;
    const k = ease.outBack(clamp01(this.t * 5));
    ctx.save();
    ctx.globalAlpha = a0 * (o.alpha ?? 1) * clamp01(this.t * 6);
    const yy = Math.round(y + (1 - k) * 18);
    this.panelRect = { x, y: yy, w, h };
    // glass body
    ctx.fillStyle = 'rgba(4,28,64,0.55)';
    roundRect(ctx, x + 2, yy + 4, w, h, 14); ctx.fill();
    const g = ctx.createLinearGradient(0, yy, 0, yy + h);
    g.addColorStop(0, 'rgba(34,124,196,0.94)'); g.addColorStop(0.42, 'rgba(10,64,132,0.94)'); g.addColorStop(1, 'rgba(5,30,74,0.96)');
    ctx.fillStyle = g;
    roundRect(ctx, x, yy, w, h, 14); ctx.fill();
    // gloss band + rim
    ctx.save();
    roundRect(ctx, x, yy, w, h, 14); ctx.clip();
    const gl = ctx.createLinearGradient(0, yy, 0, yy + h * 0.5);
    gl.addColorStop(0, 'rgba(255,255,255,0.42)'); gl.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.ellipse(x + w * 0.5, yy - h * 0.15, w * 0.62, h * 0.6, 0, 0, TAU); ctx.fill();
    // drifting bubbles inside the glass
    for (let i = 0; i < 7; i++) {
      const ph = (t * 0.12 + i * 0.37) % 1;
      const bx = x + 30 + ((i * 97) % (w - 60)), by = yy + h - ph * h;
      ctx.globalAlpha = a0 * 0.35 * Math.sin(ph * Math.PI);
      ctx.strokeStyle = '#bff6ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx, by, 2 + (i % 3), 0, TAU); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = a0 * (o.alpha ?? 1) * clamp01(this.t * 6);
    ctx.strokeStyle = 'rgba(160,240,255,0.95)'; ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, yy + 0.5, w - 1, h - 1, 14); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    roundRect(ctx, x + 2.5, yy + 2.5, w - 5, h - 5, 12); ctx.stroke();
    // portrait orb
    const pr = Math.round(h * 0.42), pcx = x + pr + 14, pcy = yy + h / 2;
    const og = ctx.createRadialGradient(pcx - pr * 0.3, pcy - pr * 0.4, 2, pcx, pcy, pr);
    og.addColorStop(0, '#f2ffff'); og.addColorStop(0.55, '#8fe4f6'); og.addColorStop(1, '#2a9ad4');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, TAU); ctx.fill();
    if (this.portrait) {
      ctx.save();
      ctx.beginPath(); ctx.arc(pcx, pcy, pr - 2, 0, TAU); ctx.clip();
      try { this.portrait(ctx, pcx, pcy, pr, this); } catch (e) { /* optional */ }
      ctx.restore();
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(pcx - pr * 0.25, pcy - pr * 0.55, pr * 0.5, pr * 0.22, -0.3, 0, TAU); ctx.fill();
    // name tag
    const tx = pcx + pr + 14;
    if (this.name) {
      const nw = Math.ceil(alagardWidth(this.name.toUpperCase())) + 18;
      const ny = yy - 9;
      const ng = ctx.createLinearGradient(0, ny, 0, ny + 18);
      ng.addColorStop(0, '#9effa0'); ng.addColorStop(0.5, '#3fd06a'); ng.addColorStop(1, '#1e9a48');
      ctx.fillStyle = ng;
      roundRect(ctx, tx - 4, ny, nw, 18, 9); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      roundRect(ctx, tx - 1, ny + 2, nw - 6, 6, 3); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      roundRect(ctx, tx - 3.5, ny + 0.5, nw - 1, 17, 8.5); ctx.stroke();
      drawAlagard(ctx, this.name.toUpperCase(), tx + 5, ny + 1, { color: '#ffffff', shadow: '#0c5a2a' });
    }
    // the typed text
    const maxW = x + w - tx - 18;
    const lines = (l._wrapW === maxW && l._wrap) || (l._wrap = wrapAlagard(l.text, maxW), l._wrapW = maxW, l._wrap);
    let left = Math.floor(this.shown);
    const ty0 = yy + Math.round((h - lines.length * (LINE_H + 3)) / 2) - 1;
    lines.forEach((ln, i) => {
      if (left <= 0) return;
      drawAlagard(ctx, ln, tx, ty0 + i * (LINE_H + 3), { chars: left, color: '#ffffff', shadow: '#06264e' });
      left -= ln.length + 1;
    });
    // next arrow
    if (this.waiting && this.picked < 0) {
      const bob = Math.round(Math.sin(t * 6) * 2);
      const ax = x + w - 18, ay = yy + h - 14 + bob;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(ax - 5, ay - 3); ctx.lineTo(ax + 5, ay - 3); ctx.lineTo(ax, ay + 3); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = a0;
    // choices: a row of bubbles above the panel
    if (l.choices?.length && !this.typing) this.drawChoices(ctx, { x: x + w, y: yy - 16, align: 'right', t });
    else this.rects = [];
  }

  // Tutorial speech bubble pointing at (ax, ay). maxW: wrap width. Returns the bubble rect.
  drawBubble(ctx, ax, ay, o = {}) {
    const l = this.line;
    if (!l) { this.panelRect = null; this.rects = []; return null; }
    const W = o.W || 960, H = o.H || 540;
    const t = o.t ?? this.t;
    const maxW = o.maxW || 200;
    const lines = (l._wrapW === maxW && l._wrap) || (l._wrap = wrapAlagard(l.text, maxW), l._wrapW = maxW, l._wrap);
    const tw = Math.max(40, ...lines.map((s) => Math.ceil(alagardWidth(s)))) + 20;
    const th = lines.length * (LINE_H + 2) + 12;
    const below = o.below ?? ay - th - 18 < 8;
    let bx = Math.round(clamp(ax - tw / 2, 6, W - tw - 6));
    let by = Math.round(below ? ay + 16 : ay - th - 14);
    by = clamp(by, 6, H - th - 6);
    const pop = ease.outBack(clamp01(this.t * 5));
    const a0 = ctx.globalAlpha;
    ctx.save();
    ctx.globalAlpha = a0 * (o.alpha ?? 1);
    ctx.translate(ax, below ? by : by + th);
    const sc = Math.max(0.01, pop * (l.big ? 1 + 0.05 * Math.sin(t * 12) : 1));
    ctx.scale(sc, sc);
    ctx.translate(-ax, -(below ? by : by + th));
    this.panelRect = { x: bx, y: by, w: tw, h: th };
    // tail
    ctx.fillStyle = 'rgba(244,253,255,0.97)';
    ctx.beginPath();
    const tx = clamp(ax, bx + 12, bx + tw - 12);
    if (below) { ctx.moveTo(tx - 6, by + 1); ctx.lineTo(tx + 6, by + 1); ctx.lineTo(ax, by - 8); }
    else { ctx.moveTo(tx - 6, by + th - 1); ctx.lineTo(tx + 6, by + th - 1); ctx.lineTo(ax, by + th + 8); }
    ctx.closePath(); ctx.fill();
    AE.drawAeroSurface?.(ctx, bx, by, tw, th, { tone: 'frost', r: 9, gloss: 0.55, glossH: Math.round(th * 0.42), rim: 0.9, glow: 0.45 });
    const ink = AE.AERO?.ink || '#13304e';
    let left = Math.floor(this.shown);
    lines.forEach((ln, i) => {
      if (left <= 0) return;
      drawAlagard(ctx, ln, bx + 10, by + 6 + i * (LINE_H + 2), { chars: left, color: ink, shadow: 'rgba(255,255,255,0.9)' });
      left -= ln.length + 1;
    });
    ctx.restore();
    ctx.globalAlpha = a0;
    if (l.choices?.length && !this.typing) this.drawChoices(ctx, { x: bx + tw / 2, y: below ? by + th + 8 : by - 8, align: 'center', t, up: !below, W, small: true });
    else this.rects = [];
    return this.panelRect;
  }

  // Glossy response bubbles (number badge + Alagard text), popping in one by one.
  drawChoices(ctx, o) {
    const l = this.line;
    const cs = l.choices || [];
    const t = this.doneT;
    const gap = 8, ph = o.small ? 20 : 24;
    const widths = cs.map((c) => Math.ceil(alagardWidth(c.text)) + (o.small ? 34 : 42));
    const total = widths.reduce((s, w) => s + w, 0) + gap * (cs.length - 1);
    let x0 = o.align === 'right' ? o.x - total : o.align === 'center' ? o.x - total / 2 : o.x;
    if (o.W) x0 = clamp(x0, 6, o.W - total - 6);
    const y = Math.round(o.up === false || o.align === 'right' ? o.y - ph : o.y - ph);
    this.rects = [];
    let x = Math.round(x0);
    cs.forEach((c, i) => {
      const w = widths[i];
      const k = ease.outBack(clamp01((t - i * 0.08) * 5));
      const picked = this.picked === i, other = this.picked >= 0 && !picked;
      const hov = this.hover === i && this.picked < 0;
      const lift = hov ? -2 : 0;
      const pk = picked ? 1 + 0.12 * Math.sin(clamp01(this.pickT * 3) * Math.PI) : 1;
      const yy = y + Math.round((1 - k) * 14) + lift + Math.round(Math.sin((o.t ?? 0) * 2.4 + i * 1.3) * (this.picked < 0 ? 1.5 : 0));
      this.rects.push({ x, y: yy, w, h: ph, i });
      ctx.save();
      ctx.globalAlpha *= clamp01(k * 1.4) * (other ? Math.max(0, 1 - this.pickT * 4) : 1);
      ctx.translate(x + w / 2, yy + ph / 2);
      ctx.scale(pk * (0.6 + 0.4 * k), pk * (0.6 + 0.4 * k));
      ctx.translate(-(x + w / 2), -(yy + ph / 2));
      // bubble pill
      ctx.fillStyle = 'rgba(4,30,70,0.35)';
      roundRect(ctx, x + 1, yy + 3, w, ph, ph / 2); ctx.fill();
      const g = ctx.createLinearGradient(0, yy, 0, yy + ph);
      if (picked) { g.addColorStop(0, '#d8ffb0'); g.addColorStop(0.5, '#6ee04a'); g.addColorStop(1, '#2fa82a'); }
      else if (hov) { g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#a8f4ff'); g.addColorStop(1, '#3ec4ec'); }
      else { g.addColorStop(0, '#f4feff'); g.addColorStop(0.5, '#c8f2ff'); g.addColorStop(1, '#6fd0f0'); }
      ctx.fillStyle = g;
      roundRect(ctx, x, yy, w, ph, ph / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      roundRect(ctx, x + 6, yy + 2, w - 12, Math.round(ph * 0.36), ph * 0.18); ctx.fill();
      ctx.strokeStyle = hov || picked ? '#ffffff' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, yy + 0.5, w - 1, ph - 1, ph / 2 - 0.5); ctx.stroke();
      // number badge
      const br = Math.round(ph / 2 - 3), bcx = x + br + 4, bcy = yy + ph / 2;
      const bg = ctx.createRadialGradient(bcx - 2, bcy - 3, 1, bcx, bcy, br);
      bg.addColorStop(0, '#9ff8ff'); bg.addColorStop(1, '#1a86d0');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(bcx, bcy, br, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bcx, bcy, br, 0, TAU); ctx.stroke();
      drawAlagard(ctx, String(i + 1), bcx, bcy - 8, { align: 'center', color: '#ffffff', shadow: '#0a4a8a' });
      drawAlagard(ctx, c.text, bcx + br + 6, yy + Math.round(ph / 2) - 8, { color: '#0e3a66', shadow: 'rgba(255,255,255,0.8)' });
      if (hov && Math.sin((o.t ?? 0) * 9) > 0.6) AE.drawSparkle?.(ctx, x + w - 8, yy + 2, 2, 1);
      ctx.restore();
      x += w + gap;
    });
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { alagardReady };
