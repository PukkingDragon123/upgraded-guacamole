// Interactive aquarium decorations: click animations (pre-rendered voxel frames from props.js),
// sounds, particle bursts, reactions of nearby fish, idle/ambient loops and fish that use decor
// on their own (hide in the toilet, sit in the hot tub, bounce on the trampoline...).
//
// Everything works on the Aquarium instance `aq` and its decor records `d` ({rec, props, X, z, scale, prop}).
// Runtime fields added to d: spec, frames (Map scale -> [prop]), anim, squash, user, idlePh, ambT.
//
//   playDecor(aq, d, {quiet, seq, fps, byFish})  start an animation (click = full spec with sfx/fx/fish)
//   updateDecor(aq, dt)                            advance animations, ambient fx, fish using decor
//   decorDrawState(aq, d, p, sc)                   which canvas/part/offset to draw this frame
//   queueDecorFrames(aq, d, scale, urgent)         pre-render the animation frames for a scale
//   anchorAt(aq, d, name)                          tank-local point of a prop anchor

import { clamp, lerp, dist, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { propInteract } from '../gfx/props.js';

const RAINBOW = ['#ff4a6a', '#ffd84a', '#5aff8a', '#4ac8ff', '#c87aff', '#ff8ad8'];
const MAX_USERS = 3;
// Fish that walk / hop / slither can't be pinned to a seat or carried by a beam.
const free = (f) => !f.controlled && f.style !== 'crawl' && f.style !== 'hop' && f.style !== 'chain';

export function specOf(d) {
  if (d.spec === undefined) d.spec = propInteract(d.rec.id) || null;
  return d.spec;
}

// ------------------------------------------------------------------ frames
export function queueDecorFrames(aq, d, scale, urgent = false) {
  const s = specOf(d);
  if (!s || s.frames < 2) return;
  const order = [];
  for (const f of s.idle || []) if (f && !order.includes(f)) order.push(f);
  for (const f of s.seq) if (f && !order.includes(f)) order.push(f);
  if (s.motion) for (const f of [s.motion.base, s.motion.part]) if (f && !order.includes(f)) order.push(f);
  for (let f = 1; f < s.frames; f++) if (!order.includes(f)) order.push(f);
  const have = d.frames?.get(scale);
  for (const f of order) if (!have?.[f]) aq.queueProp(d, scale, f, urgent);
}

export function frameProp(d, scale, f) {
  if (!f) return d.props.get(scale) || null;
  return d.frames?.get(scale)?.[f] || null;
}

// Frame the decor should show right now (0 = rest).
function currentFrame(aq, d) {
  const a = d.anim;
  if (a && a.seq.length) {
    const i = Math.floor(a.t * a.fps);
    if (i < a.seq.length) return a.seq[i];
    if (a.loop) return a.seq[i % a.seq.length];
  }
  const s = d.spec;
  if (s?.idle && !a) return s.idle[Math.floor((aq.t + (d.idlePh || 0)) * s.idleFps) % s.idle.length];
  return 0;
}

function motionDy(a) {
  const m = a?.motion;
  if (!m || a.t < m.t0 || a.t > m.t1) return null;
  const P = m.path;
  for (let i = 0; i < P.length - 1; i++) {
    if (a.t <= P[i + 1][0]) {
      const k = (a.t - P[i][0]) / Math.max(1e-3, P[i + 1][0] - P[i][0]);
      const e = k * k * (3 - 2 * k);
      return P[i][1] + (P[i + 1][1] - P[i][1]) * e;
    }
  }
  return P[P.length - 1][1];
}

// What to draw: {p (frame prop), part (movable layer canvas), dy (part offset px), sx, sy (squash), shake}.
export function decorDrawState(aq, d, p, sc) {
  const out = { p, part: null, dy: 0, sx: 1, sy: 1, ox: 0 };
  const s = specOf(d);
  if (!s) return out;
  const a = d.anim;
  if (sc === 1 && s.frames > 1) {
    const scale = p.scale;
    const dy = motionDy(a);
    if (dy !== null) {
      const base = frameProp(d, scale, a.motion.base), src = frameProp(d, scale, a.motion.part);
      if (base && src?.part) { out.p = base; out.part = src.part; out.dy = dy * scale; }
      else queueDecorFrames(aq, d, scale, true);
    } else {
      const f = currentFrame(aq, d);
      if (f) {
        const fp = frameProp(d, scale, f);
        if (fp) out.p = fp;
        else if (a) queueDecorFrames(aq, d, scale, true);
      }
    }
  }
  if (d.squash > 0) {
    const k = d.squash / 0.45, amt = (d.squashAmt || 0.1) * Math.sin((1 - k) * Math.PI * 3) * k;
    out.sy = 1 - amt; out.sx = 1 + amt * 0.6;
  }
  if (a && a.shake && a.t < a.shake) out.ox = Math.round(Math.sin(a.t * 70) * 1.2);
  return out;
}

// ------------------------------------------------------------------ anchors & fx
export function anchorAt(aq, d, name, track = false) {
  const T = aq.T;
  const p = d.drawP || d.prop || [...d.props.values()][0];
  const bx = T.sx(d.X, d.z), by = T.sy(T.groundZ(d.X, d.z), d.z);
  if (!p) return { x: bx, y: by - 10, z: d.z };
  const k = d.drawK || 1;
  const a = p.anchors?.[name];
  let x, y;
  if (a) { x = bx + (a.x - p.ox) * k; y = by + (a.y - p.oy) * k; }
  else if (name === 'center') { x = bx; y = by + (p.h * 0.5 - p.oy) * k; }
  else { x = bx; y = by + (4 - p.oy) * k; }
  if (track) y += motionDy(d.anim) * (p.scale || 1) || 0;
  return { x, y, z: d.z };
}

function viewK(aq) {
  const key = aq.view?.key;
  return key === 'full' ? 1 : key === 'mini' ? 0.35 : 0.6;
}

function spawnFx(aq, d, fx) {
  const P = aq.particles;
  const k = viewK(aq), fs = aq.view.fishScale;
  const { x, y } = anchorAt(aq, d, fx.from, fx.track);
  const n = Math.max(1, Math.round((fx.n ?? 6) * (k < 1 ? k + 0.15 : 1)));
  const sp = (v) => v * (0.45 + 0.55 * k);
  const cols = fx.colors;
  const icon = (name, vy = -18) => { const ic = getUiIcon(name); if (ic) for (let i = 0; i < n; i++) P.sprite(x + rng.float(-8, 8) * k, y - rng.float(0, 6), ic, { vy: vy * (0.6 + 0.4 * k), vx: rng.float(-10, 10) * k, life: rng.float(1, 1.6) }); };
  switch (fx.kind) {
    case 'bubbles': P.bubbles(x, y, n, { size: k < 0.5 ? 1 : rng.pick([1, 2, 2, 3]) }); break;
    case 'sparkle': for (let i = 0; i < n; i++) P.sparkle(x + rng.float(-14, 14) * k, y + rng.float(-10, 10) * k, cols ? rng.pick(cols) : '#fff6b0'); break;
    case 'stars': for (let i = 0; i < n; i++) P.sparkle(x + rng.float(-30, 30) * k, y - rng.float(0, 40) * k, rng.pick(cols || ['#fff6b0', '#ffffff', '#bfe8ff']), { vy: -rng.float(2, 8), life: rng.float(0.8, 1.6) }); break;
    case 'burst': P.burst(x, y, n, { colors: cols || ['#ffffff'], speed: sp(60), g: 60, life: 0.9, up: sp(20) }); break;
    case 'confetti': P.burst(x, y, n, { colors: cols || RAINBOW, speed: sp(70), g: 26, drag: 1.4, life: 1.6, lifeMin: 0.8, up: sp(30), size: k < 0.6 ? 1 : rng.pick([1, 2]) }); break;
    case 'lava': P.burst(x, y, n, { colors: cols || ['#ff7a1a', '#ffd84a', '#ff4a2a', '#fff4b0'], speed: sp(70), g: 90, life: 1.1, up: sp(60), add: true, size: k < 0.6 ? 1 : 2 }); break;
    case 'smoke': P.burst(x, y, n, { colors: cols || ['#8a8a96', '#6a6a78', '#b8b8c4'], speed: sp(22), g: -16, drag: 2.2, life: 1.8, lifeMin: 0.9, size: k < 0.6 ? 2 : 3 }); break;
    case 'steam': P.burst(x, y, n, { colors: ['#ffffff', '#e8f6ff'], speed: sp(14), g: -20, drag: 2.5, life: 1.4, size: 2 }); break;
    case 'foam': P.burst(x, y, n, { colors: ['#ffffff', '#e8f6ff', '#c8ecff'], speed: sp(40), g: 30, life: 0.9, up: sp(20), size: k < 0.6 ? 1 : 2 }); break;
    case 'embers': for (let i = 0; i < n; i++) P.sparkle(x + rng.float(-6, 6) * k, y + rng.float(-4, 4) * k, rng.pick(cols || ['#ffb04a', '#ff7a2a', '#ffe46a']), { vy: -rng.float(14, 34) * (0.5 + 0.5 * k), vx: rng.float(-8, 8) * k, life: rng.float(0.7, 1.5), big: false }); break;
    case 'rise': for (let i = 0; i < n; i++) P.sparkle(x + rng.float(-8, 8) * k, y - rng.float(0, 30) * k, rng.pick(cols || ['#b8ffd0', '#ffffff']), { vy: -rng.float(14, 30) * (0.5 + 0.5 * k), vx: 0, life: rng.float(0.8, 1.6) }); break;
    case 'snow': P.burst(x, y, n, { colors: ['#ffffff', '#e8f4ff'], speed: sp(36), g: 8, drag: 1.2, life: 2.4, lifeMin: 1.2, up: sp(24), size: 1 }); break;
    case 'gumball': P.burst(x, y, Math.max(1, n), { colors: RAINBOW, speedMin: 10, speed: sp(30), g: 120, life: 1, up: sp(25), size: k < 0.6 ? 2 : 3, drag: 0.5 }); break;
    case 'ring': P.ring(x, y, 0.25 + 0.4 * k * fs); break;
    case 'swirl':
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, r = 8 * k;
        P.sparkle(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.4, '#c8f8ff', { vx: -Math.sin(a) * 30 * k, vy: Math.cos(a) * 8 * k - 6, life: 0.7 });
      }
      P.ring(x, y, 0.3 * k + 0.1, 'rgba(200,248,255,0.9)');
      break;
    case 'lights':
      for (let i = 0; i < n; i++) {
        const a = rng.float(0, TAU), r = rng.float(30, 150) * k;
        const c = rng.pick(RAINBOW);
        P.add({ kind: 'dot', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.55 + 20 * k, vx: rng.sign() * rng.float(15, 40) * k, vy: 0, size: k < 0.6 ? 1 : 2, color: c, add: true, life: rng.float(0.5, 1.1), g: 0, drag: 0 });
      }
      break;
    case 'notes': icon('music'); break;
    case 'hearts': icon('heart', -14); break;
    case 'icons': icon(fx.icon || 'star', -12); break;
    case 'text': P.text(x, y - 8 * k, fx.text || '!', { font: k < 0.7 ? 'small' : 'normal', color: fx.color || '#fff6c8', layer: 'fg', life: 1.3, vy: -14 * (0.5 + 0.5 * k) }); break;
    case 'food': aq.dropFood?.(x, y, n); break;
    default: break;
  }
}

function dropCoinFrom(aq, d, c) {
  const now = Date.now();
  const cd = (c.cooldown || 120) * 1000;
  if (now - (d.rec.coinAt || 0) < cd) { aq.sfx('gulp', { vol: 0.35, pitch: 1.4 }); return; }
  d.rec.coinAt = now;
  const T = aq.T;
  const { x, y } = anchorAt(aq, d, c.from || 'top');
  const D = Math.max(0, d.z * T.DEPTH - 3);
  const X = clamp(T.X(x, d.z), 4, T.W - 4), Y = clamp(T.Y(y, d.z), T.surf + 2, T.groundZ(X, d.z) - 2);
  aq.coins.spawn(X, Y, D, 0, { vx: rng.float(-10, 10), vy: -rng.float(10, 24), vd: rng.float(2, 8) });
  aq.coinsDirty = true;
  aq.sfx('coin_spawn', { vol: 0.6 });
  aq.game.save?.();
}

// ------------------------------------------------------------------ play
export function playDecor(aq, d, opts = {}) {
  const s = specOf(d);
  if (!s) return;
  if (d.anim && !opts.force && d.anim.t < Math.min(0.5, d.anim.dur * 0.5) && !opts.quiet) return;
  const quiet = !!opts.quiet;
  const seq = opts.seq || s.seq;
  const fps = opts.fps || s.fps;
  const events = [];
  if (!quiet) {
    for (const e of s.sfx) events.push({ at: e.at, sfx: e });
    for (const f of s.fx) events.push({ at: f.at, fx: f });
    if (s.coin) events.push({ at: s.coin.at ?? 0.5, coin: s.coin });
    if (s.fish) events.push({ at: s.fishAt ?? 0.05, fish: s.fish });
  }
  events.sort((a, b) => a.at - b.at);
  const motion = !opts.seq && !quiet ? s.motion : null;
  const dur = opts.dur ?? Math.max(seq.length / fps, quiet ? 0 : s.dur, 0.45);
  d.anim = { t: 0, seq, fps, dur, events, ei: 0, motion, shake: quiet ? 0 : s.shake, loop: !!opts.loop, byFish: !!opts.byFish };
  d.squash = 0.45; d.squashAmt = quiet ? s.squash * 0.5 : s.squash;
  if (s.frames > 1) queueDecorFrames(aq, d, d.scale, true);
  // A fish hiding inside gets flushed / scared out.
  if (!quiet && !opts.byFish && d.user?.st && d.user.st.phase === 'hidden') d.user.st.t = d.user.st.dur;
  if (!quiet) aq.game.emit?.('decorPlayed', d.rec.id);
}

function fishReact(aq, d, kind) {
  const T = aq.T;
  const c = anchorAt(aq, d, 'center');
  const p = d.prop;
  const R = Math.max(40 * aq.view.fishScale + 20, (p ? p.w * 0.5 * (d.drawK || 1) : 30) + 30 * aq.view.fishScale);
  const near = aq.fish.filter((f) => f.state !== 'script' && !f.controlled && (kind === 'flee' || free(f)) && dist(f.x, f.y, c.x, c.y) < R * (kind === 'flee' || kind === 'launch' ? 1.2 : 2.6) && Math.abs(f.z - d.z) < 0.45);
  near.sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y));
  switch (kind) {
    case 'flee': for (const f of near.slice(0, 8)) f.startle(c.x, c.y); break;
    case 'gather': for (const f of near.slice(0, 5)) startScript(aq, f, d, 'gather'); break;
    case 'dance': for (const f of near.slice(0, 6)) startScript(aq, f, d, 'dance'); break;
    case 'launch':
      for (const f of near.slice(0, 4)) { f.vy = -rng.float(90, 140) * aq.view.fishScale; f.squashV += 10; f.say('!', 1.2); f.feel('surprised', 1.2); }
      break;
    case 'abduct': {
      const beam = anchorAt(aq, d, 'beam');
      const f = aq.fish.filter((q) => q.state !== 'script' && free(q)).sort((a, b) => dist(a.x, a.y, beam.x, beam.y) - dist(b.x, b.y, beam.x, beam.y))[0];
      if (f && dist(f.x, f.y, beam.x, beam.y) < R * 3.5) startScript(aq, f, d, 'abduct');
      for (const q of near.slice(0, 3)) if (q !== f) { q.say('!', 1); }
      break;
    }
    default: break;
  }
  void T;
}

// ------------------------------------------------------------------ update
export function updateDecor(aq, dt) {
  const vis = !!aq.visibleKey;
  for (const d of aq.decor) {
    const s = specOf(d);
    if (!s) continue;
    if (d.idlePh === undefined) d.idlePh = rng.float(0, 10);
    if (d.squash > 0) d.squash = Math.max(0, d.squash - dt);
    const a = d.anim;
    if (a) {
      a.t += dt;
      while (a.ei < a.events.length && a.events[a.ei].at <= a.t) {
        const e = a.events[a.ei++];
        if (e.sfx) aq.sfx(e.sfx.name, { vol: e.sfx.vol ?? 0.7, pitch: e.sfx.pitch ?? 1 });
        else if (e.fx && vis) spawnFx(aq, d, e.fx);
        else if (e.coin) dropCoinFrom(aq, d, e.coin);
        else if (e.fish) fishReact(aq, d, e.fish);
      }
      if (!a.loop && a.t >= a.dur) d.anim = null;
      else if (a.loop && a.until !== undefined && a.t >= a.until) d.anim = null;
    }
    // Ambient particles (smoke from the volcano, embers, hot tub bubbles).
    if (vis && s.ambient.length) {
      d.ambT ||= s.ambient.map((m) => rng.float(0, m.every));
      s.ambient.forEach((m, i) => {
        d.ambT[i] -= dt;
        if (d.ambT[i] <= 0) { d.ambT[i] = m.every * rng.float(0.7, 1.3); spawnFx(aq, d, { ...m, at: 0 }); }
      });
    }
  }
  updateUsers(aq, dt);
}

// ------------------------------------------------------------------ fish scripts
// A fish runs a script while in the 'script' state; f.use = {d, kind, st} and the aquarium
// clears alpha / useZ / forceAngle when the state changes (see cleanupFish).
export function cleanupFish(f) {
  if (!f.use) return;
  if (f.use.d?.user === f.use) f.use.d.user = null;
  f.use = null;
  f.alpha = 1;
  f.useZ = null;
  f.forceAngle = undefined;
}

function endScript(f, emote) {
  cleanupFish(f);
  f.setState('wander');
  if (emote) f.say(emote, 1.2);
}

function steerTo(f, x, y, speed, arrive = 12) {
  const dx = x - f.x, dy = y - f.y, dd = Math.hypot(dx, dy) || 1;
  const sp = dd < arrive ? speed * (dd / arrive) : speed;
  return [(dx / dd) * sp, (dy / dd) * sp];
}

function startScript(aq, f, d, kind) {
  if (f.controlled) return false;
  cleanupFish(f);
  const u = { d, kind, st: { t: 0, phase: 'go', dur: 0 } };
  f.use = u;
  const fs = aq.view.fishScale;
  const spec = specOf(d);
  const c0 = anchorAt(aq, d, kind === 'gather' || kind === 'dance' ? 'center' : spec?.use?.at || 'center');
  const st = u.st;
  st.ax = c0.x; st.ay = c0.y;
  st.off = rng.float(-1, 1);
  if (kind === 'gather') { st.dur = rng.float(2.5, 4); st.tx = c0.x + rng.float(-50, 50) * fs; st.ty = c0.y - rng.float(10, 40) * fs; st.icon = rng.pick(['!', 'heart', '?', 'exclaim']); }
  if (kind === 'dance') { st.dur = rng.float(2.8, 4); st.tx = f.x; st.ty = f.y; }
  if (kind === 'abduct') st.dur = 3.4;
  f.script = (fish, dt) => runScript(aq, fish, u, dt);
  f.setState('script');
  if (['sit', 'hide', 'bounce', 'orbit', 'watch', 'dancer'].includes(kind)) d.user = u;
  return true;
}

function runScript(aq, f, u, dt) {
  const st = u.st, d = u.d, fs = aq.view.fishScale;
  st.t += dt;
  if (!aq.decor.includes(d)) { endScript(f, '?'); return [0, 0]; }
  const T = aq.T;
  switch (u.kind) {
    case 'gather': {
      f.lookAt(st.ax, st.ay);
      if (st.t > st.dur) { endScript(f, rng.chance(0.5) ? 'heart' : null); return [0, 0]; }
      if (st.t > 0.6 && !st.said) { st.said = true; f.say(st.icon, 1.4); f.feel('surprised', 1); }
      return steerTo(f, st.tx, st.ty, f.cruise * 1.3, 14 * fs + 4);
    }
    case 'dance': {
      if (st.t > st.dur) { endScript(f, 'heart'); return [0, 0]; }
      if (!st.said) { st.said = true; f.say('music', 1.4); }
      f.feel('happy', 0.3);
      const beat = Math.floor(st.t / 0.33);
      if (beat !== st.beat) { st.beat = beat; f.facing = beat % 2 ? 1 : -1; f.squashV += 5; }
      f.forceAngle = Math.sin(st.t * 9) * 0.35;
      f.x = lerp(f.x, st.tx + Math.sin(st.t * 4.5 + st.off) * 6 * fs, 1 - Math.exp(-dt * 4));
      f.y = lerp(f.y, st.ty + Math.abs(Math.sin(st.t * 9.4)) * -5 * fs, 1 - Math.exp(-dt * 8));
      f.vx = f.vy = 0;
      return [0, 0];
    }
    case 'abduct': {
      const beam = anchorAt(aq, d, 'beam'), under = anchorAt(aq, d, 'under');
      if (st.t < 0.7) { f.x = lerp(f.x, beam.x, 1 - Math.exp(-dt * 5)); f.vx = f.vy = 0; f.feel('surprised', 0.5); if (!st.said) { st.said = true; f.say('!', 1); } return [0, 0]; }
      if (st.t < 2.4) {
        const k = (st.t - 0.7) / 1.7;
        f.x = beam.x + Math.sin(st.t * 8) * 2 * fs;
        f.y = lerp(f.y, lerp(beam.y, under.y + 6 * fs, k), 1 - Math.exp(-dt * 6));
        f.z = lerp(f.z, d.z, 1 - Math.exp(-dt * 3));
        if (Math.floor(st.t / 0.25) % 2) f.facing = -f.facing;
        f.vx = f.vy = 0; f.feel('dizzy', 0.5);
        return [0, 0];
      }
      if (!st.dropped) { st.dropped = true; f.vy = 40 * fs; f.squashV += 8; f.say('?', 1.5); f.feel('dizzy', 2); }
      if (st.t > st.dur) endScript(f);
      return [0, 10 * fs];
    }
    default: return runUse(aq, f, u, dt, T, fs);
  }
}

// Fish using a decoration on its own.
function runUse(aq, f, u, dt, T, fs) {
  const st = u.st, d = u.d, spec = specOf(d), use = spec.use;
  const a = anchorAt(aq, d, use.at || 'center');
  const behind = use.at === 'water' || u.kind === 'hide' || use.behind;
  let tx = a.x, ty = a.y;
  if (u.kind === 'bounce') ty = a.y - 24 * fs;
  if (u.kind === 'watch') { tx = a.x + st.off * 10 * fs; ty = a.y - 4 * fs; }
  if (u.kind === 'dancer') { tx = a.x + (st.off > 0 ? 1 : -1) * (22 + Math.abs(st.off) * 12) * fs; ty = a.y - 8 * fs; }
  // Never aim below what the tank / fish confinement lets the fish reach.
  ty = Math.min(ty, T.floorAt(tx, f.z) - (3 * f.scale + 1) * T.s(f.z) - 1, f.floor(tx) - 1);
  st.tx = tx; st.ty = ty;
  if (st.phase === 'go') {
    f.lookAt(tx, ty);
    if (st.t > 12) { endScript(f, '?'); return [0, 0]; }
    const dd = dist(f.x, f.y, tx, ty);
    if (dd < 6 + 5 * fs || (st.t > 4 && dd < 30 * fs + 10)) {
      st.phase = 'on'; st.t = 0;
      st.dur = u.kind === 'hide' ? rng.float(3, 6) : u.kind === 'bounce' ? rng.float(2.4, 3.6) : u.kind === 'orbit' ? rng.float(4, 6) : rng.float(6, 10);
      if (u.kind === 'hide') st.phase = 'hidden';
      if (use.seq) playDecor(aq, d, { quiet: true, byFish: true, seq: use.seq, fps: use.fps || 3, loop: u.kind === 'watch' || u.kind === 'dancer', dur: st.dur + 1 });
      if (u.kind === 'sit' || u.kind === 'watch') f.say(use.emote || (u.kind === 'watch' ? 'exclaim' : 'heart'), 1.6);
      if (u.kind === 'dancer') f.say('music', 1.5);
    }
    // Swim over the decor's front, slipping behind it when hiding / soaking.
    if (behind && dist(f.x, f.y, tx, ty) < 30 * fs) f.useZ = d.z + 0.015;
    f.z = lerp(f.z, clamp(d.z + (behind ? 0.01 : -0.03), 0, 0.85), 1 - Math.exp(-dt * 2));
    return steerTo(f, tx, ty, Math.min(Math.max(f.burst, 60) * 1.5, Math.max(f.cruise * 2.5, 40 * fs, dd * 0.9)), 16 * fs + 4);
  }
  f.vx = 0; f.vy = 0;
  switch (u.kind) {
    case 'sit': {
      f.useZ = behind ? d.z + 0.015 : d.z - 0.012;
      f.x = lerp(f.x, tx + Math.sin(st.t * 0.8) * 2 * fs, 1 - Math.exp(-dt * 6));
      f.y = lerp(f.y, ty + Math.sin(st.t * 2.2) * 1.2 * fs, 1 - Math.exp(-dt * 6));
      f.feel(st.t > st.dur * 0.6 ? 'sleepy' : 'happy', 0.3);
      if (rng.chance(dt * 0.25)) f.say(rng.pick([use.emote || 'heart', 'zzz', 'music']), 1.4);
      if (behind && rng.chance(dt * 1.2)) aq.particles.bubble(f.x + rng.float(-4, 4) * fs, f.y - 3 * fs, { size: 1 });
      if (st.t > st.dur) { f.vy = -30 * fs; endScript(f, 'heart'); }
      return [0, 0];
    }
    case 'hide': {
      f.useZ = d.z + 0.02;
      f.alpha = Math.max(0, 1 - st.t * 3);
      f.x = lerp(f.x, tx, 1 - Math.exp(-dt * 6)); f.y = lerp(f.y, ty, 1 - Math.exp(-dt * 6));
      if (st.t > st.dur) {
        // Pop back out (the toilet flushes them out, others just peek and leave).
        if (use.exitPlay) playDecor(aq, d, { byFish: true });
        f.alpha = 1; f.vy = -rng.float(60, 90) * fs; f.vx = rng.sign() * 30 * fs; f.squashV += 10;
        aq.particles.bubbles(f.x, f.y, Math.round(4 + 4 * fs));
        endScript(f, use.exitPlay ? 'sweat' : rng.pick(['music', '...', 'heart']));
        f.feel(use.exitPlay ? 'dizzy' : 'happy', 1.5);
      }
      return [0, 0];
    }
    case 'bounce': {
      const T0 = 0.62, ph = (st.t % T0) / T0, n = Math.floor(st.t / T0);
      if (n !== st.n) {
        st.n = n;
        playDecor(aq, d, { quiet: true, byFish: true, seq: [1, 2, 0], fps: 9 });
        aq.sfx('boing', { vol: 0.35, pitch: rng.float(1.1, 1.5) });
        f.squashV += 9;
        if (n === 1) f.say('!', 1);
      }
      const H = (28 + Math.min(n, 3) * 6) * fs;
      f.x = lerp(f.x, a.x + Math.sin(st.t * 1.3) * 4 * fs, 1 - Math.exp(-dt * 5));
      f.y = a.y - 3 * fs - Math.sin(ph * Math.PI) * H;
      f.forceAngle = (ph - 0.5) * 0.5;
      f.feel('happy', 0.3);
      if (st.t > st.dur && ph > 0.4) { f.vy = -60 * fs; endScript(f, 'heart'); }
      return [0, 0];
    }
    case 'orbit': {
      const r = (24 + Math.abs(st.off) * 10) * fs * (d.drawK || 1) * 1.6;
      const th = st.t * (1.6 + st.off * 0.3);
      f.x = lerp(f.x, a.x + Math.cos(th) * r, 1 - Math.exp(-dt * 4));
      f.y = lerp(f.y, a.y + Math.sin(th * 2) * 6 * fs, 1 - Math.exp(-dt * 4));
      f.facing = -Math.sin(th) >= 0 ? 1 : -1;
      f.useZ = d.z + Math.sin(th) * 0.04;
      f.z = clamp(d.z + Math.sin(th) * 0.04, 0, 0.85);
      if (rng.chance(dt * 0.4)) f.say(rng.pick(['music', 'heart', 'sparkle']), 1.2);
      f.feel('happy', 0.3);
      if (st.t > st.dur) endScript(f);
      return [0, 0];
    }
    case 'watch': case 'dancer': {
      f.useZ = d.z - 0.02;
      f.lookAt(a.x, a.y - 30 * fs);
      f.facing = a.x >= f.x ? 1 : -1;
      if (u.kind === 'dancer') {
        const beat = Math.floor(st.t / 0.33);
        if (beat !== st.beat) { st.beat = beat; f.facing = beat % 2 ? 1 : -1; f.squashV += 4; }
        f.forceAngle = Math.sin(st.t * 9) * 0.3;
        f.y = lerp(f.y, ty - Math.abs(Math.sin(st.t * 9.4)) * 4 * fs, 1 - Math.exp(-dt * 8));
        if (rng.chance(dt * 0.6)) spawnFx(aq, d, { kind: 'notes', from: use.at || 'top', n: 1 });
      } else {
        f.y = lerp(f.y, ty + Math.sin(st.t * 1.7) * 1.5 * fs, 1 - Math.exp(-dt * 5));
        if (rng.chance(dt * 0.3)) f.say(rng.pick(['heart', '!', 'music', 'exclaim']), 1.2);
      }
      f.x = lerp(f.x, tx, 1 - Math.exp(-dt * 4));
      f.feel('happy', 0.3);
      if (st.t > st.dur) { if (d.anim?.byFish) d.anim = null; endScript(f, 'heart'); }
      return [0, 0];
    }
    default: endScript(f); return [0, 0];
  }
}

// Every so often an idle fish picks a decoration with a `use` spec and goes to play with it.
function updateUsers(aq, dt) {
  aq.useT = (aq.useT ?? rng.float(3, 8)) - dt;
  if (aq.useT > 0) return;
  aq.useT = rng.float(5, 12) / (aq.useBoost || 1);
  const busy = aq.fish.filter((f) => f.use).length;
  if (busy >= MAX_USERS) return;
  const decor = aq.decor.filter((d) => specOf(d)?.use && !d.user && d.prop);
  if (!decor.length) return;
  const d = rng.pick(decor);
  const idle = aq.fish.filter((f) => (f.state === 'wander' || f.state === 'idle') && free(f) && !f.use);
  if (!idle.length) return;
  const c = anchorAt(aq, d, 'center');
  idle.sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y));
  const f = idle[Math.min(idle.length - 1, rng.int(0, 1))];
  const kind = { dance: 'dancer' }[d.spec.use.kind] || d.spec.use.kind;
  startScript(aq, f, d, kind);
}

// Debug / dev: make fish use this decoration now.
export function forceUse(aq, d) {
  const s = specOf(d);
  if (!s?.use) return false;
  const f = aq.fish.find((q) => !q.use && free(q));
  if (!f) return false;
  if (d.user) return false;
  return startScript(aq, f, d, { dance: 'dancer' }[s.use.kind] || s.use.kind);
}

