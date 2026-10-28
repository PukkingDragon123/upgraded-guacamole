// Procedural WebAudio engine: SFX, loops, biome ambience, generative music and babble.
// Everything is synthesized at runtime (no samples, no network). Every public call is a
// silent no-op until unlock() has created/resumed the AudioContext on a user gesture;
// music/ambience/volume/loop requests made earlier are remembered and start on unlock.
//
// API (singleton `audio`):
//   unlock() -> bool, isUnlocked()
//   play(name, {vol=1, pitch=1, pan=0})          one-shot SFX (see SFX_NAMES)
//   loop(name) -> {set(v 0..1), stop()}          tension|reel|rain|storm|static|blackhole|flood
//   setMusic(track|null)                         desktop|shallows|junkyard|abyss|aquarium (2.5 s crossfade)
//   setAmbience(biome|null|'off', {weather, night})  null = desktop fan hum; weather layers:
//     rain storm (any biome), static datarain oil (junkyard), current snow glowtide (abyss)
//   setNight(bool), setVolumes({master, music, sfx, ambience}), getVolumes(), setMuffle(0..1)
//   babble(text, voice='crab'|'fish'|'tiny'|'deep')  1-2 char calls = rate-limited typewriter blips
//
// Graph: voices -> category bus (sfx | music | amb) -> master -> compressor -> limiter -> out
//        voices -> per-category reverb send -> convolver (generated impulse) -> master

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const LOOKAHEAD = 0.12;
const LIMITS = { sfx: 32, music: 28, amb: 14 };

let ctx = null;
let B = null; // buses
let NYQ = 20000;
const pools = { sfx: [], music: [], amb: [] };
const NB = {}; // cached noise buffers
const WAVES = {}; // cached periodic waves / curves
const warned = new Set();
const lastPlay = new Map();
const vols = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.6 };
const S = { night: false, muffle: 0, music: null, amb: undefined, ambOpts: {} };

// ---------------------------------------------------------------- utilities
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0));
const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
const ready = () => !!ctx && ctx.state === 'running';
const cf = (f) => Math.max(10, Math.min(NYQ, f));

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn('[audio] ' + msg);
}

function gainNode(v = 1, dest) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (dest) g.connect(dest);
  return g;
}

function biquad(type, f, q = 0.7, dest) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = cf(f);
  b.Q.value = q;
  if (dest) b.connect(dest);
  return b;
}

function ramp(param, v, tc = 0.05, at) {
  const t = at ?? ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.setTargetAtTime(v, t, tc);
}

function disconnectAll(nodes) {
  for (const n of nodes) { try { n && n.disconnect(); } catch (e) { /* already gone */ } }
}

// ---------------------------------------------------------------- buffers
function makeNoiseBuffers() {
  const rate = ctx.sampleRate, len = Math.floor(rate * 2), xf = 2048;
  const gen = {
    white: () => { const r = new Float32Array(len + xf); for (let i = 0; i < r.length; i++) r[i] = Math.random() * 2 - 1; return r; },
    pink: () => {
      const r = new Float32Array(len + xf);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < r.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        r[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
      return r;
    },
    brown: () => {
      const r = new Float32Array(len + xf);
      let last = 0;
      for (let i = 0; i < r.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; r[i] = last; }
      return r;
    },
  };
  for (const k of Object.keys(gen)) {
    const r = gen[k]();
    let mean = 0;
    for (let i = 0; i < r.length; i++) mean += r[i];
    mean /= r.length;
    let rms = 0;
    for (let i = 0; i < r.length; i++) { r[i] -= mean; rms += r[i] * r[i]; }
    rms = Math.sqrt(rms / r.length) || 1;
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0), s = 0.25 / rms;
    // seamless loop: crossfade the overflow tail into the head
    for (let i = 0; i < len; i++) {
      let v = r[i];
      if (i < xf) v = r[i] * (i / xf) + r[len + i] * (1 - i / xf);
      d[i] = Math.max(-1, Math.min(1, v * s));
    }
    NB[k] = buf;
  }
}

function makeImpulse(sec = 2.6, decay = 2.8) {
  const rate = ctx.sampleRate, len = Math.floor(rate * sec), pre = Math.floor(rate * 0.012);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const k = 0.35 + 0.6 * x; // highs die faster than lows
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      const fadeIn = Math.min(1, (i - pre) / (rate * 0.006));
      d[i] = lp * Math.pow(1 - x, decay) * fadeIn * (1 + 0.6 * x);
    }
  }
  return buf;
}

function makeWaves() {
  const pulse = (duty) => {
    const n = 64, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ctx.createPeriodicWave(re, im);
  };
  WAVES.pulse25 = pulse(0.25);
  WAVES.pulse12 = pulse(0.125);
  // soft organ-ish wave for lullaby pads
  WAVES.soft = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.25, 0.08, 0.03]));
  const crush = (levels) => {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * levels) / levels; }
    return c;
  };
  WAVES.crush = crush(40);
  WAVES.crushHard = crush(7);
  const drive = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1; drive[i] = Math.tanh(x * 3) / Math.tanh(3); }
  WAVES.drive = drive;
}

// ---------------------------------------------------------------- buses
function initBuses() {
  const out = gainNode(0.92, ctx.destination);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.12;
  limiter.connect(out);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 2.5;
  comp.attack.value = 0.008; comp.release.value = 0.25;
  comp.connect(limiter);
  const master = gainNode(0, comp);

  const verbIn = gainNode(1);
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse();
  const verbTone = biquad('lowpass', 7000, 0.5, master);
  const verbRet = gainNode(0.85, verbTone);
  verbIn.connect(conv); conv.connect(verbRet);

  const sfxVol = gainNode(0, master);
  const sfxIn = gainNode(1, sfxVol);
  const sfxVerb = gainNode(0, verbIn);

  const musicVol = gainNode(0, master);
  const musicMuffle = biquad('lowpass', NYQ, 0.6, musicVol);
  const musicTone = biquad('lowpass', 16000, 0.5, musicMuffle);
  const musicIn = gainNode(1, musicTone);
  const musicVerb = gainNode(0, verbIn);

  const ambVol = gainNode(0, master);
  const ambMuffle = biquad('lowpass', NYQ, 0.6, ambVol);
  const ambIn = gainNode(1, ambMuffle);
  const ambVerb = gainNode(0, verbIn);

  B = {
    out, limiter, comp, master, verbIn, conv, verbTone, verbRet, musicTone, musicMuffle, ambMuffle,
    sfx: { in: sfxIn, verb: sfxVerb, vol: sfxVol },
    music: { in: musicIn, verb: musicVerb, vol: musicVol },
    amb: { in: ambIn, verb: ambVerb, vol: ambVol },
  };
}

const curve = (v) => Math.pow(clamp01(v), 1.5);
const TRIM = { master: 1.6, sfx: 1.25, music: 0.7, amb: 0.8 };
function applyVolumes(now = false) {
  if (!B) return;
  const set = (param, v) => { if (now) param.value = v; else ramp(param, v); };
  set(B.master.gain, curve(vols.master) * TRIM.master);
  for (const [cat, key] of [['sfx', 'sfx'], ['music', 'music'], ['amb', 'ambience']]) {
    const v = curve(vols[key]) * TRIM[cat];
    set(B[cat].vol.gain, v); set(B[cat].verb.gain, v);
  }
}

function applyMuffle() {
  if (!B) return;
  const m = clamp01(S.muffle);
  const f = 20000 * Math.pow(320 / 20000, m);
  ramp(B.musicMuffle.frequency, cf(f), 0.08);
  ramp(B.ambMuffle.frequency, cf(f), 0.08);
  ramp(B.verbTone.frequency, cf(Math.min(7000, f * 1.2)), 0.08);
  ramp(B.musicMuffle.Q, 0.6 + m * 1.4, 0.08);
}

function applyNightTone() {
  if (B) ramp(B.musicTone.frequency, S.night ? 3600 : 16000, 0.8);
}

// ---------------------------------------------------------------- voices
// Each primitive is one voice: sources + nodes + an envelope gain. Pools cap polyphony;
// the oldest voice is faded out quickly (no click) when a pool is full.
function register(pool, srcs, nodes, env, start, end) {
  const list = pools[pool] || pools.sfx, limit = LIMITS[pool] || 32, now = ctx.currentTime;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].end <= now) list.splice(i, 1);
  // voices sounding at this voice's start; steal the oldest of them at that moment
  let n = 0, oldest = null;
  for (const v of list) {
    if (v.killed || v.start > start || v.end <= start) continue;
    n++;
    if (!oldest || v.start < oldest.start) oldest = v;
  }
  if (n >= limit && oldest) kill(oldest, start);
  const v = { srcs, nodes, env, list, start, end, done: false, killed: false };
  list.push(v);
  let left = srcs.length;
  const fin = () => { if (--left <= 0) finish(v); };
  for (const s of srcs) { s.onended = fin; s.stop(end); }
  return v;
}

function finish(v) {
  if (v.done) return;
  v.done = true;
  const i = v.list.indexOf(v);
  if (i >= 0) v.list.splice(i, 1);
  disconnectAll(v.nodes);
}

function kill(v, at) {
  if (v.done || v.killed) return;
  v.killed = true;
  const now = ctx.currentTime, t = Math.max(now, at ?? now), g = v.env.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
  else if (t - now < 0.01) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
  g.setTargetAtTime(0, t, 0.006);
  v.end = t + 0.05;
  for (const s of v.srcs) { try { s.stop(t + 0.05); } catch (e) { /* ignore */ } }
}

// Envelope: linear attack, then 'exp' (percussive decay), 'lin' (linear fade) or
// 'sus' (hold, then release over r). Always lands on exactly 0 before the source stops.
function envAt(g, t, dur, peak, a = 0.004, shape = 'exp', r = 0.08) {
  const p = g.gain, end = t + Math.max(dur, a + 0.004);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (shape === 'sus') {
    p.setValueAtTime(peak, Math.max(t + a, end - r));
    p.linearRampToValueAtTime(0, end);
  } else if (shape === 'lin') {
    p.linearRampToValueAtTime(0, end);
  } else {
    p.exponentialRampToValueAtTime(peak * 0.001 + 1e-6, end);
    p.linearRampToValueAtTime(0, end + 0.006);
  }
  return end + 0.012;
}

// frequency: number (+ optional f2 glide) or [[time, hz], ...] breakpoints
function setFreq(param, t, f, f2, glide, mul = 1) {
  if (Array.isArray(f)) {
    param.setValueAtTime(cf(f[0][1] * mul), t + f[0][0]);
    for (let i = 1; i < f.length; i++) param.exponentialRampToValueAtTime(cf(f[i][1] * mul), t + f[i][0]);
    return f[0][1] * mul;
  }
  param.setValueAtTime(cf(f * mul), t);
  if (f2) param.exponentialRampToValueAtTime(cf(f2 * mul), t + Math.max(0.005, glide));
  return f * mul;
}

function addFilter(t, spec, dur, mul, nodes) {
  const fl = ctx.createBiquadFilter();
  fl.type = spec.type || 'lowpass';
  fl.Q.value = spec.q ?? 0.7;
  setFreq(fl.frequency, t, spec.f, spec.f2, spec.glide ?? dur, spec.track === false ? 1 : mul);
  nodes.push(fl);
  return fl;
}

function route(o, node, nodes, verb, pan) {
  let n = node;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    n.connect(p); n = p; nodes.push(p);
  }
  n.connect(o.out);
  const w = verb ?? o.verb ?? 0;
  if (w > 0 && o.wet) { const s = gainNode(w, o.wet); n.connect(s); nodes.push(s); }
}

function finishVoice(o, srcs, nodes, env, start, end) {
  register(o.pool, srcs, nodes, env, start, end);
  if (end > o.end) o.end = end;
}

// oscillator voice. unison: detune cents per extra oscillator; vib: [rateHz, depthHz]
function tone(o, { f = 440, f2 = 0, glide, at = 0, dur = 0.2, type = 'sine', wave, a = 0.004, vol = 0.2,
  shape, r, vib, filt, unison, verb, pan } = {}) {
  if (vol <= 0) return;
  const t = o.t + at, srcs = [], nodes = [], env = ctx.createGain();
  nodes.push(env);
  let head = env;
  if (filt) { const fl = addFilter(t, filt, dur, o.p, nodes); fl.connect(env); head = fl; }
  const dets = unison || [0];
  const sub = gainNode(1 / Math.sqrt(dets.length), head);
  nodes.push(sub);
  let lfo = null;
  if (vib) {
    const l = ctx.createOscillator();
    l.frequency.value = vib[0];
    lfo = gainNode(vib[1] * o.p);
    l.connect(lfo); l.start(t);
    srcs.push(l); nodes.push(l, lfo);
  }
  for (const d of dets) {
    const osc = ctx.createOscillator();
    if (wave && WAVES[wave]) osc.setPeriodicWave(WAVES[wave]); else osc.type = type;
    setFreq(osc.frequency, t, f, f2, glide ?? dur, o.p);
    if (d) osc.detune.value = d;
    if (lfo) lfo.connect(osc.frequency);
    osc.connect(sub); osc.start(t);
    srcs.push(osc); nodes.push(osc);
  }
  const end = envAt(env, t, dur, vol, a, shape, r);
  route(o, env, nodes, verb, pan);
  finishVoice(o, srcs, nodes, env, t, end);
}

// 2-operator FM voice; index = modulation depth relative to modulator freq, decaying to index2
function fm(o, { f = 440, f2 = 0, glide, ratio = 2, index = 2, index2 = 0, idur = 0.2, at = 0, dur = 0.5,
  a = 0.003, vol = 0.2, type = 'sine', shape, r, filt, verb, pan } = {}) {
  if (vol <= 0) return;
  const t = o.t + at, env = ctx.createGain();
  const car = ctx.createOscillator(), mod = ctx.createOscillator();
  car.type = type;
  const fr = setFreq(car.frequency, t, f, f2, glide ?? dur, o.p);
  setFreq(mod.frequency, t, f, f2, glide ?? dur, o.p * ratio);
  // keep the swing below Nyquist so bright FM stays clean instead of aliasing
  const dev = fr * ratio * Math.min(1, Math.max(0, NYQ * 0.75 - fr) / Math.max(1, index * fr * ratio));
  const mg = gainNode(0);
  mg.gain.setValueAtTime(index * dev, t);
  mg.gain.setTargetAtTime(index2 * dev, t + 0.002, Math.max(0.005, idur / 3));
  mod.connect(mg); mg.connect(car.frequency);
  const nodes = [env, car, mod, mg];
  if (filt) { const fl = addFilter(t, filt, dur, o.p, nodes); car.connect(fl); fl.connect(env); } else car.connect(env);
  car.start(t); mod.start(t);
  const end = envAt(env, t, dur, vol, a, shape, r);
  route(o, env, nodes, verb, pan);
  finishVoice(o, [car, mod], nodes, env, t, end);
}

// filtered noise voice
function noise(o, { at = 0, dur = 0.2, color = 'white', type = 'bandpass', f = 1000, f2 = 0, glide, q = 1,
  a = 0.004, vol = 0.2, rate = 1, shape, r, verb, pan } = {}) {
  if (vol <= 0) return;
  const t = o.t + at, env = ctx.createGain();
  const src = ctx.createBufferSource();
  src.buffer = NB[color] || NB.white;
  src.loop = true;
  src.playbackRate.value = rate;
  const nodes = [env, src];
  if (type !== 'none') {
    const fl = addFilter(t, { type, f, f2, q, glide }, dur, o.p, nodes);
    src.connect(fl); fl.connect(env);
  } else src.connect(env);
  src.start(t, Math.random() * 1.8);
  const end = envAt(env, t, dur, vol, a, shape, r);
  route(o, env, nodes, verb, pan);
  finishVoice(o, [src], nodes, env, t, end);
}

// a per-call output (volume, pan, optional lowpass) feeding dry + wet destinations
function mkOut(dry, wet, vol = 1, pan = 0, lp = 0) {
  const nodes = [];
  const out = gainNode(vol);
  nodes.push(out);
  let n = out;
  if (lp) { const f = biquad('lowpass', lp, 0.5); n.connect(f); n = f; nodes.push(f); }
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    n.connect(p); n = p; nodes.push(p);
  }
  n.connect(dry);
  const w = gainNode(vol, wet);
  nodes.push(w);
  return { out, wet: w, nodes };
}

function releaseOut(o, nodes) {
  const ms = Math.max(0.3, o.end - ctx.currentTime + 0.4) * 1000;
  setTimeout(() => disconnectAll(nodes), ms);
}

// ---------------------------------------------------------------- persistent layers
// Groups hold long-running sources (loops, ambience beds, drones) behind one fade gain.
function group(dest, wetDest, level = 1, fadeIn = 0.4) {
  const g = { fade: gainNode(0, dest), wet: wetDest ? gainNode(0, wetDest) : null, srcs: [], nodes: [], level, dead: false };
  g.nodes.push(g.fade, g.wet);
  const t = ctx.currentTime;
  g.fade.gain.setValueAtTime(0, t);
  g.fade.gain.linearRampToValueAtTime(level, t + fadeIn);
  if (g.wet) { g.wet.gain.setValueAtTime(0, t); g.wet.gain.linearRampToValueAtTime(level, t + fadeIn); }
  return g;
}

function groupStop(g, fade = 0.4) {
  if (!g || g.dead) return;
  g.dead = true;
  const t = ctx.currentTime;
  for (const p of [g.fade.gain, g.wet && g.wet.gain]) {
    if (!p) continue;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(0, t + fade);
  }
  for (const s of g.srcs) { try { s.stop(t + fade + 0.05); } catch (e) { /* ignore */ } }
  setTimeout(() => disconnectAll(g.nodes), (fade + 0.3) * 1000);
}

function gNoise(g, color, dest, level, filt) {
  const src = ctx.createBufferSource();
  src.buffer = NB[color]; src.loop = true;
  const amp = gainNode(level, dest || g.fade);
  const fls = (filt ? [].concat(filt) : []).map((f) => biquad(f.type || 'lowpass', f.f, f.q ?? 0.7));
  let n = src;
  for (const f of fls) { n.connect(f); n = f; }
  n.connect(amp);
  src.start(ctx.currentTime, Math.random() * 1.8);
  g.srcs.push(src); g.nodes.push(src, amp, ...fls);
  return { src, amp, fl: fls[0] || null, fls };
}

function gOsc(g, type, f, dest, level, filt, detune = 0) {
  const osc = ctx.createOscillator();
  if (WAVES[type]) osc.setPeriodicWave(WAVES[type]); else osc.type = type;
  osc.frequency.value = f;
  osc.detune.value = detune;
  const amp = gainNode(level, dest || g.fade);
  let fl = null;
  if (filt) { fl = biquad(filt.type || 'lowpass', filt.f, filt.q ?? 0.7, amp); osc.connect(fl); } else osc.connect(amp);
  osc.start();
  g.srcs.push(osc); g.nodes.push(osc, amp, fl);
  return { osc, amp, fl };
}

function gLfo(g, rate, depth, param, type = 'sine') {
  const l = ctx.createOscillator();
  l.type = type; l.frequency.value = rate;
  const d = gainNode(depth, param);
  l.connect(d); l.start();
  g.srcs.push(l); g.nodes.push(l, d);
  return { osc: l, depth: d };
}

// randomized one-shot events for beds: [{min, max, fn(t)}]
function runEvents(evs, t0, horizon) {
  for (const e of evs) {
    if (e.next === undefined || e.next < t0 - 0.5) e.next = t0 + (e.first ?? rand(e.min, e.max));
    let guard = 0;
    while (e.next < horizon && guard++ < 16) {
      e.fn(Math.max(e.next, t0));
      e.next += rand(e.min, e.max);
    }
  }
}

// ---------------------------------------------------------------- shared sound atoms
const bub = (o, at, f, vol = 0.1, pan = 0, dur = 0.06) =>
  tone(o, { at, f, f2: f * 2.3, glide: dur * 0.85, dur, a: 0.003, vol, pan });
const bell = (o, f, at = 0, vol = 0.1, dur = 1.4, verb) =>
  fm(o, { f, at, ratio: 3.5, index: 2.2, index2: 0.15, idur: dur * 0.35, dur, a: 0.002, vol, verb });
const chime = (o, f, at = 0, vol = 0.1, dur = 0.8, verb) =>
  fm(o, { f, at, ratio: 2, index: 1.3, index2: 0.1, idur: dur * 0.3, dur, a: 0.002, vol, verb });
const mallet = (o, f, at = 0, vol = 0.1, dur = 0.6, verb) =>
  fm(o, { f, at, ratio: 4, index: 1.8, idur: 0.05, dur, a: 0.002, vol, verb });
const tink = (o, f, at = 0, vol = 0.08, pan = 0) => {
  fm(o, { f, at, ratio: 2.76, index: 1.6, index2: 0.2, idur: 0.05, dur: 0.22, a: 0.001, vol, pan });
  tone(o, { f: f * 1.5, at, dur: 0.08, vol: vol * 0.35, pan });
};
const whoosh = (o, at, dur, f1, f2, vol, q = 1.1, color = 'pink') =>
  noise(o, { at, dur, color, type: 'bandpass', f: f1, f2, q, a: dur * 0.45, vol, shape: 'lin' });
const thump = (o, at, f, vol) => {
  tone(o, { at, f, f2: f * 0.45, glide: 0.09, dur: 0.16, vol, a: 0.002 });
  noise(o, { at, dur: 0.05, type: 'lowpass', f: 500, color: 'pink', vol: vol * 0.5 });
};
const tick = (o, at, f, vol) => {
  noise(o, { at, dur: 0.012, type: 'highpass', f, vol, a: 0.0008 });
};
const droplets = (o, n, at, spread, vol = 0.04, lo = 1400, hi = 3000) => {
  for (let i = 0; i < n; i++) bub(o, at + Math.random() * spread, rand(lo, hi), vol * rand(0.5, 1), rand(-0.6, 0.6), rand(0.03, 0.05));
};
const arp = (o, fn, notes, step, at = 0, vol = 0.1, dur) =>
  notes.forEach((m, i) => fn(o, m2f(m), at + i * step, vol, dur));

// ---------------------------------------------------------------- one-shot SFX
// Each entry gets o = { t, p (pitch mult), out, wet, verb, pool, end }.
const SFX = {
  // UI
  ui_click: (o) => { tone(o, { f: 1250, f2: 820, glide: 0.035, dur: 0.06, type: 'triangle', vol: 0.11, a: 0.001 }); tick(o, 0, 4500, 0.04); },
  ui_hover: (o) => { tone(o, { f: 2100, f2: 2350, glide: 0.02, dur: 0.035, vol: 0.045, a: 0.002 }); },
  ui_open: (o) => { tone(o, { f: 480, f2: 760, glide: 0.07, dur: 0.13, vol: 0.14 }); chime(o, 1046, 0.05, 0.06, 0.35); bub(o, 0.02, 900, 0.04); },
  ui_close: (o) => { tone(o, { f: 760, f2: 430, glide: 0.08, dur: 0.12, vol: 0.13 }); tick(o, 0.06, 3500, 0.03); },
  ui_buy: (o) => {
    chime(o, 1318, 0, 0.1, 0.4); chime(o, 1760, 0.075, 0.1, 0.7, 0.25); tink(o, 2637, 0.1, 0.03);
    noise(o, { at: 0.06, dur: 0.3, type: 'highpass', f: 6500, vol: 0.04, a: 0.02 });
  },
  ui_error: (o) => {
    for (const at of [0, 0.11]) tone(o, { at, f: 230, f2: 190, glide: 0.08, dur: 0.1, type: 'square', vol: 0.09, filt: { type: 'lowpass', f: 900 } });
  },
  ui_unlock: (o) => { arp(o, bell, [84, 88, 91, 96], 0.065, 0, 0.07, 1.0); noise(o, { at: 0.18, dur: 0.6, type: 'highpass', f: 7000, vol: 0.035, a: 0.1 }); },
  ui_page: (o) => {
    noise(o, { dur: 0.13, type: 'bandpass', f: 2800, f2: 1300, q: 0.9, a: 0.025, vol: 0.2 });
    noise(o, { at: 0.05, dur: 0.06, type: 'highpass', f: 4000, vol: 0.05 });
  },
  ui_toggle: (o) => {
    tone(o, { f: 880, dur: 0.035, type: 'triangle', vol: 0.11, a: 0.001 });
    tone(o, { at: 0.045, f: 1320, dur: 0.05, type: 'triangle', vol: 0.1, a: 0.001 });
  },
  ui_tab: (o) => { tone(o, { f: 1560, f2: 1480, dur: 0.045, vol: 0.09, a: 0.001 }); tick(o, 0, 5000, 0.035); },
  ui_type: (o) => {
    const k = rand(0.9, 1.12);
    noise(o, { dur: 0.025, type: 'bandpass', f: 3200 * k, q: 2.5, vol: 0.28, a: 0.001 });
    tone(o, { f: 1900 * k, dur: 0.018, type: 'triangle', vol: 0.025, a: 0.001 });
  },
  notify: (o) => { chime(o, 784, 0, 0.09, 0.6, 0.3); chime(o, 1046, 0.11, 0.09, 0.9, 0.3); },

  // desktop
  icon_pickup: (o) => {
    tone(o, { f: 380, f2: 820, glide: 0.07, dur: 0.1, vol: 0.14 });
    tone(o, { f: 760, f2: 1640, glide: 0.07, dur: 0.06, vol: 0.03, type: 'triangle' });
  },
  icon_drop: (o) => {
    tone(o, { f: 620, f2: 240, glide: 0.08, dur: 0.11, vol: 0.15 });
    noise(o, { dur: 0.04, type: 'lowpass', f: 1200, vol: 0.12, color: 'pink' });
  },
  icon_box: (o) => {
    thump(o, 0, 170, 0.22); noise(o, { dur: 0.09, type: 'lowpass', f: 700, vol: 0.18, color: 'brown' });
    bub(o, 0.07, 650, 0.08); bub(o, 0.12, 900, 0.05);
  },
  window_open: (o) => { whoosh(o, 0, 0.18, 500, 2400, 0.14); tone(o, { at: 0.05, f: 660, f2: 990, glide: 0.06, dur: 0.12, vol: 0.08 }); },
  window_close: (o) => { whoosh(o, 0, 0.15, 2400, 600, 0.12); tone(o, { f: 880, f2: 520, glide: 0.08, dur: 0.1, vol: 0.08 }); },
  window_min: (o) => { tone(o, { f: 900, f2: 300, glide: 0.12, dur: 0.15, vol: 0.09, type: 'triangle' }); whoosh(o, 0, 0.12, 1800, 500, 0.07); },
  box_open: (o) => {
    noise(o, { dur: 0.1, type: 'lowpass', f: 900, vol: 0.2, color: 'pink', a: 0.008 });
    noise(o, { at: 0.05, dur: 0.16, type: 'bandpass', f: 420, q: 1.5, vol: 0.25, color: 'brown', a: 0.02 });
    tone(o, { at: 0.03, f: 150, f2: 230, glide: 0.1, dur: 0.12, vol: 0.07, type: 'triangle' });
  },
  box_close: (o) => { thump(o, 0, 150, 0.24); noise(o, { dur: 0.08, type: 'lowpass', f: 500, vol: 0.2, color: 'brown' }); },

  // fishing
  cast: (o) => {
    whoosh(o, 0, 0.32, 450, 2600, 0.45, 1.4);
    for (let i = 0; i < 12; i++) tick(o, 0.05 + i * 0.022 * (1 + i * 0.12), 3800, 0.09 * (1 - i / 14));
    tone(o, { at: 0.04, f: 1500, f2: 900, glide: 0.4, dur: 0.42, type: 'triangle', vol: 0.012, vib: [30, 40] });
  },
  splash_small: (o) => {
    bub(o, 0, 520, 0.12, 0, 0.07);
    noise(o, { dur: 0.16, type: 'bandpass', f: 1900, f2: 900, q: 0.8, vol: 0.25 });
    droplets(o, 3, 0.05, 0.18, 0.04);
  },
  splash_big: (o) => {
    noise(o, { dur: 0.55, type: 'lowpass', f: 3500, f2: 700, q: 0.6, vol: 0.4, a: 0.006 });
    noise(o, { dur: 0.45, type: 'bandpass', f: 380, q: 0.8, vol: 0.35, color: 'brown', a: 0.01 });
    tone(o, { f: 260, f2: 75, glide: 0.2, dur: 0.26, vol: 0.18 });
    droplets(o, 7, 0.1, 0.5, 0.05);
  },
  nibble: (o) => {
    for (const at of [0, 0.08]) tone(o, { at, f: 760, f2: 520, glide: 0.04, dur: 0.05, vol: 0.09 });
    noise(o, { dur: 0.04, type: 'bandpass', f: 2200, q: 1.5, vol: 0.16 });
  },
  bite: (o) => {
    tone(o, { f: 320, f2: 110, glide: 0.12, dur: 0.17, vol: 0.24 });
    noise(o, { dur: 0.14, type: 'bandpass', f: 1300, f2: 600, q: 0.9, vol: 0.3 });
    chime(o, 1318, 0.03, 0.08, 0.35); droplets(o, 3, 0.06, 0.15, 0.04);
  },
  hookset: (o) => {
    noise(o, { dur: 0.11, type: 'bandpass', f: 1400, f2: 5200, q: 1.2, vol: 0.3 });
    tone(o, { f: 280, f2: 900, glide: 0.06, dur: 0.1, vol: 0.12, type: 'triangle' });
    thump(o, 0.01, 150, 0.22);
  },
  reel: (o) => {
    for (let i = 0; i < 9; i++) { const at = i * 0.045 * (1 - i * 0.04); tick(o, at, 3000 + (i % 2) * 600, 0.16); tone(o, { at, f: i % 2 ? 2700 : 2300, dur: 0.01, type: 'triangle', vol: 0.04, a: 0.0008 }); }
    noise(o, { dur: 0.4, type: 'bandpass', f: 900, f2: 1600, q: 1.5, color: 'pink', vol: 0.12, a: 0.05, shape: 'lin' });
  },
  reel_tick: (o) => { tick(o, 0, 3200, 0.2); tone(o, { f: 2600, dur: 0.012, vol: 0.05, type: 'triangle', a: 0.0008 }); },
  line_snap: (o) => {
    noise(o, { dur: 0.06, type: 'highpass', f: 2200, vol: 0.3, a: 0.001 });
    tone(o, { f: 230, f2: 105, glide: 0.45, dur: 0.55, type: 'sawtooth', vol: 0.07, vib: [9, 6], filt: { type: 'lowpass', f: 1800, f2: 400 } });
    tone(o, { at: 0.02, f: 950, f2: 160, glide: 0.3, dur: 0.33, vol: 0.06 });
  },
  escape: (o) => {
    [620, 470, 350].forEach((f, i) => tone(o, { at: i * 0.12, f, f2: f * 0.75, glide: 0.08, dur: 0.11, vol: 0.11 }));
    noise(o, { at: 0.3, dur: 0.2, type: 'bandpass', f: 1400, q: 0.8, vol: 0.25 });
    droplets(o, 3, 0.32, 0.2, 0.035);
  },
  catch: (o) => {
    arp(o, mallet, [72, 76, 79, 84], 0.075, 0, 0.13, 0.5);
    mallet(o, m2f(88), 0.3, 0.09, 0.9); chime(o, m2f(91), 0.3, 0.04, 0.9);
    noise(o, { dur: 0.25, type: 'bandpass', f: 1800, q: 0.8, vol: 0.2 });
  },
  catch_rare: (o) => {
    arp(o, mallet, [72, 76, 79, 83, 86], 0.065, 0, 0.11, 0.6);
    arp(o, bell, [88, 91, 95], 0.07, 0.33, 0.05, 1.3);
    noise(o, { at: 0.3, dur: 0.8, type: 'highpass', f: 7000, vol: 0.04, a: 0.15 });
  },
  catch_epic: (o) => {
    [60, 64, 67, 71, 74].forEach((m) => tone(o, { f: m2f(m), dur: 1.6, type: 'sawtooth', unison: [-7, 7], vol: 0.025, a: 0.25, shape: 'sus', r: 0.9, filt: { type: 'lowpass', f: 500, f2: 2600, glide: 0.8 } }));
    arp(o, mallet, [72, 76, 79, 83, 84, 88, 91, 95], 0.055, 0.05, 0.09, 0.6);
    bell(o, m2f(96), 0.5, 0.07, 1.8, 0.5);
    whoosh(o, 0, 0.5, 300, 3000, 0.18);
    noise(o, { at: 0.4, dur: 1.0, type: 'highpass', f: 7500, vol: 0.045, a: 0.2 });
  },
  catch_legendary: (o) => {
    const stab = (at, notes, d = 0.35) => notes.forEach((m) => tone(o, { at, f: m2f(m), dur: d, type: 'sawtooth', unison: [-9, 9], vol: 0.028, a: 0.012, shape: 'sus', r: 0.15, filt: { type: 'lowpass', f: 2600, f2: 1200, q: 1 } }));
    stab(0, [60, 64, 67, 72], 0.2); stab(0.22, [60, 64, 67, 72], 0.2); stab(0.45, [65, 69, 72, 77], 0.22); stab(0.7, [67, 71, 74, 79], 0.22);
    stab(0.95, [60, 64, 67, 72, 76], 1.6);
    thump(o, 0, 110, 0.25); thump(o, 0.95, 90, 0.3);
    arp(o, bell, [84, 88, 91, 96, 100], 0.07, 1.0, 0.06, 1.6);
    arp(o, mallet, [72, 76, 79, 84, 88, 91, 96], 0.04, 0.95, 0.05, 0.5);
    noise(o, { at: 0.95, dur: 1.6, type: 'highpass', f: 7000, vol: 0.05, a: 0.3 });
    whoosh(o, 0.6, 0.45, 400, 3500, 0.2);
  },
  new_species: (o) => {
    arp(o, chime, [79, 84, 88, 91], 0.09, 0, 0.12, 0.9);
    bell(o, m2f(96), 0.38, 0.08, 1.6, 0.45);
    [67, 72, 76].forEach((m) => tone(o, { at: 0.3, f: m2f(m), dur: 1.4, type: 'triangle', vol: 0.03, a: 0.2, shape: 'sus', r: 0.8 }));
    noise(o, { at: 0.35, dur: 0.9, type: 'highpass', f: 7000, vol: 0.04, a: 0.2 });
  },
  record: (o) => {
    arp(o, mallet, [84, 86, 88, 91], 0.05, 0, 0.1, 0.4);
    chime(o, m2f(96), 0.22, 0.09, 0.8, 0.3); chime(o, m2f(96), 0.36, 0.06, 0.9, 0.35); tink(o, m2f(103), 0.24, 0.025);
  },
  net_swish: (o) => {
    whoosh(o, 0, 0.32, 380, 1900, 0.5, 1.2);
    noise(o, { at: 0.2, dur: 0.2, type: 'bandpass', f: 900, q: 0.8, vol: 0.2 });
    droplets(o, 3, 0.22, 0.2, 0.03);
  },
  mash_pop: (o) => {
    const k = rand(0.95, 1.06);
    tone(o, { f: 420 * k, f2: 1150 * k, glide: 0.04, dur: 0.065, vol: 0.15, a: 0.002 });
    tick(o, 0, 3000, 0.04);
  },
  timing_good: (o) => { chime(o, 880, 0, 0.13, 0.35); tone(o, { f: 1760, dur: 0.12, vol: 0.025 }); },
  timing_perfect: (o) => {
    chime(o, 1318, 0, 0.12, 0.4); chime(o, 1760, 0.055, 0.1, 0.6, 0.3);
    noise(o, { dur: 0.25, type: 'highpass', f: 7500, vol: 0.06, a: 0.01 }); tink(o, 2637, 0.06, 0.025);
  },
  timing_miss: (o) => {
    tone(o, { f: 210, f2: 150, glide: 0.1, dur: 0.13, vol: 0.13, type: 'triangle', filt: { type: 'lowpass', f: 700 } });
    noise(o, { dur: 0.05, type: 'lowpass', f: 400, vol: 0.2, color: 'pink' });
  },
  dodge_hit: (o) => {
    tone(o, { f: 320, f2: 95, glide: 0.11, dur: 0.15, type: 'square', vol: 0.07, filt: { type: 'lowpass', f: 1400, f2: 400 } });
    noise(o, { dur: 0.09, type: 'bandpass', f: 1100, q: 1, vol: 0.3 });
  },
  slack_warn: (o) => {
    for (const at of [0, 0.15]) tone(o, { at, f: 640, f2: 540, glide: 0.1, dur: 0.12, type: 'triangle', vol: 0.11, vib: [14, 12] });
  },
  jump_out: (o) => {
    noise(o, { dur: 0.22, type: 'bandpass', f: 1100, f2: 3200, q: 0.9, vol: 0.3, a: 0.01 });
    tone(o, { f: 300, f2: 950, glide: 0.15, dur: 0.18, vol: 0.09 });
    droplets(o, 5, 0.08, 0.35, 0.045);
  },

  // fish voices
  blub: (o) => { bub(o, 0, 240, 0.16, 0, 0.09); bub(o, 0.1, 210, 0.12, 0, 0.08); tone(o, { f: 180, f2: 140, dur: 0.12, vol: 0.05, type: 'triangle' }); },
  honk: (o) => {
    tone(o, { f: [[0, 300], [0.05, 360], [0.22, 320]], dur: 0.24, type: 'sawtooth', unison: [-10, 10], vol: 0.12, a: 0.015, shape: 'sus', r: 0.06, vib: [7, 6], filt: { type: 'bandpass', f: 1100, q: 1.6 } });
    tone(o, { f: 150, dur: 0.22, type: 'square', vol: 0.03, a: 0.015, shape: 'sus', r: 0.05, filt: { type: 'lowpass', f: 600 } });
  },
  puff: (o) => {
    noise(o, { dur: 0.38, type: 'bandpass', f: 500, f2: 2200, q: 2, a: 0.25, vol: 0.3, shape: 'lin' });
    tone(o, { f: 200, f2: 620, glide: 0.36, dur: 0.4, vol: 0.09, a: 0.2, shape: 'lin' });
    bub(o, 0.38, 700, 0.08);
  },
  deflate: (o) => {
    tone(o, { f: 680, f2: 140, glide: 0.5, dur: 0.55, type: 'sawtooth', vol: 0.1, vib: [26, 40], filt: { type: 'lowpass', f: 1100, f2: 500 }, a: 0.01, shape: 'sus', r: 0.15 });
    noise(o, { dur: 0.5, type: 'bandpass', f: 900, f2: 400, q: 1.2, vol: 0.2, a: 0.02, shape: 'lin' });
  },
  squeak: (o) => { tone(o, { f: [[0, 1400], [0.05, 2100], [0.13, 1700]], dur: 0.14, vol: 0.11, a: 0.006, vib: [22, 60] }); },
  grunt: (o) => {
    tone(o, { f: 115, f2: 88, glide: 0.18, dur: 0.2, type: 'sawtooth', vol: 0.14, a: 0.012, vib: [17, 8], filt: { type: 'lowpass', f: 520, q: 2 }, shape: 'sus', r: 0.07 });
  },
  boing: (o) => {
    tone(o, { f: 190, f2: 330, glide: 0.07, dur: 0.45, type: 'triangle', vol: 0.14, vib: [13, 35], a: 0.003 });
    tone(o, { f: 380, f2: 660, glide: 0.07, dur: 0.2, vol: 0.03 });
  },
  glitch: (o) => {
    for (let i = 0; i < 7; i++) tone(o, { at: i * 0.028, f: pick([220, 330, 440, 880, 1320, 1760, 2640]) * rand(0.98, 1.02), dur: 0.026, wave: 'pulse25', vol: 0.07, a: 0.001, shape: 'sus', r: 0.004 });
    noise(o, { at: 0.08, dur: 0.06, type: 'highpass', f: 3000, vol: 0.07, a: 0.001, shape: 'sus', r: 0.01 });
  },
  click: (o) => {
    for (let i = 0; i < 3; i++) {
      noise(o, { at: i * 0.032, dur: 0.008, type: 'highpass', f: 3500, vol: 0.2, a: 0.0005 });
      tone(o, { at: i * 0.032, f: 3100, dur: 0.006, vol: 0.04, a: 0.0005 });
    }
  },
  roar: (o) => {
    tone(o, { f: 82, f2: 58, glide: 0.8, dur: 0.85, type: 'sawtooth', unison: [-12, 12], vol: 0.12, a: 0.09, vib: [7, 4], filt: { type: 'lowpass', f: 420, f2: 900, glide: 0.3, q: 2 }, shape: 'sus', r: 0.35 });
    noise(o, { dur: 0.8, type: 'lowpass', f: 900, f2: 400, vol: 0.25, a: 0.08, color: 'pink', shape: 'sus', r: 0.35 });
    tone(o, { f: 52, f2: 40, dur: 0.8, vol: 0.12, a: 0.08, shape: 'sus', r: 0.3 });
  },
  chirp: (o) => {
    tone(o, { f: 1800, f2: 3200, glide: 0.07, dur: 0.09, vol: 0.1, a: 0.005 });
    tone(o, { at: 0.1, f: 3000, f2: 2200, glide: 0.07, dur: 0.08, vol: 0.075 });
  },
  bell: (o) => { bell(o, 1046, 0, 0.09, 1.3, 0.45); fm(o, { f: 2093, ratio: 1.41, index: 0.6, idur: 0.1, dur: 0.5, vol: 0.02 }); },
  gulp: (o) => { tone(o, { f: 420, f2: 140, glide: 0.08, dur: 0.12, vol: 0.13 }); noise(o, { dur: 0.05, type: 'lowpass', f: 600, vol: 0.2, color: 'pink' }); },
  snore: (o) => {
    noise(o, { dur: 0.9, type: 'bandpass', f: 320, f2: 600, q: 3, a: 0.45, vol: 0.4, shape: 'lin', color: 'pink' });
    tone(o, { dur: 0.9, f: 85, f2: 95, type: 'sawtooth', vol: 0.035, a: 0.4, shape: 'lin', filt: { type: 'lowpass', f: 300 }, vib: [22, 4] });
    noise(o, { at: 1.0, dur: 0.5, type: 'bandpass', f: 700, f2: 300, q: 2, a: 0.08, vol: 0.22, shape: 'lin' });
  },

  // coins
  coin_spawn: (o) => {
    fm(o, { f: 1568, ratio: 2, index: 1, idur: 0.05, dur: 0.16, vol: 0.06 });
    tone(o, { f: 800, f2: 1600, glide: 0.05, dur: 0.06, vol: 0.04 });
  },
  coin_bounce: (o) => { tink(o, 2093 * rand(0.96, 1.04), 0, 0.08); },
  coin_collect: (o) => {
    const t = ctx.currentTime;
    combo.n = t - combo.t < 0.6 ? Math.min(combo.n + 1, COMBO.length - 1) : 0;
    combo.t = t;
    const k = Math.pow(2, COMBO[combo.n] / 12);
    chime(o, 988 * k, 0, 0.1, 0.1);
    chime(o, 1318 * k, 0.065, 0.12, 0.45);
    tone(o, { at: 0.065, f: 1318 * k, dur: 0.22, type: 'square', vol: 0.012, filt: { type: 'lowpass', f: 3500, track: false } });
  },
  coin_pile: (o) => {
    for (let i = 0; i < 9; i++) tink(o, rand(1800, 3200), Math.random() * 0.4, rand(0.04, 0.07), rand(-0.4, 0.4));
    noise(o, { dur: 0.12, type: 'lowpass', f: 900, vol: 0.18, color: 'pink' });
  },
  coins_many: (o) => {
    for (let i = 0; i < 16; i++) tink(o, rand(1700, 3400), i * 0.045 + Math.random() * 0.03, rand(0.035, 0.06), rand(-0.6, 0.6));
    chime(o, 1318, 0.75, 0.07, 0.5); chime(o, 1760, 0.82, 0.07, 0.8, 0.3);
  },

  // world
  bubble: (o) => { bub(o, 0, rand(380, 650), 0.12, 0, rand(0.05, 0.08)); },
  bubbles: (o) => {
    const n = 6 + ((Math.random() * 5) | 0);
    for (let i = 0; i < n; i++) bub(o, Math.random() * 0.6, rand(300, 900), rand(0.06, 0.11), rand(-0.5, 0.5), rand(0.04, 0.08));
  },
  whale_call: (o) => {
    const b = rand(0.92, 1.08);
    tone(o, { f: [[0, 210 * b], [0.7, 320 * b], [1.6, 290 * b], [2.4, 190 * b]], dur: 2.5, vol: 0.1, a: 0.5, shape: 'sus', r: 0.8, vib: [4.5, 5], verb: 0.7 });
    tone(o, { f: [[0, 420 * b], [0.7, 640 * b], [1.6, 580 * b], [2.4, 380 * b]], dur: 2.4, type: 'triangle', vol: 0.025, a: 0.6, shape: 'sus', r: 0.8, verb: 0.8 });
  },
  thunder: (o) => {
    noise(o, { dur: 0.35, type: 'lowpass', f: 3200, f2: 400, vol: 0.35, a: 0.004 });
    for (let i = 0; i < 4; i++) noise(o, { at: 0.05 + i * rand(0.25, 0.5), dur: rand(1.2, 2.2), type: 'lowpass', f: rand(160, 320), q: 0.8, color: 'brown', vol: rand(0.3, 0.45), a: rand(0.04, 0.2) });
  },
  crab_scuttle: (o) => {
    for (let i = 0; i < 9; i++) {
      const at = i * 0.034 + Math.random() * 0.008, pan = i % 2 ? 0.15 : -0.15;
      noise(o, { at, dur: 0.014, type: 'bandpass', f: i % 2 ? 3200 : 2500, q: 3, vol: 0.9, a: 0.0006, pan });
      tone(o, { at, f: i % 2 ? 2900 : 2300, dur: 0.012, type: 'triangle', vol: 0.05, a: 0.0006, pan });
    }
  },
  vending: (o) => {
    tone(o, { f: 110, dur: 0.6, type: 'sawtooth', vol: 0.06, a: 0.05, shape: 'sus', r: 0.1, vib: [9, 3], filt: { type: 'lowpass', f: 380 } });
    noise(o, { dur: 0.6, type: 'bandpass', f: 600, q: 1, vol: 0.1, a: 0.05, shape: 'sus', r: 0.1 });
    thump(o, 0.62, 130, 0.25); noise(o, { at: 0.62, dur: 0.1, type: 'lowpass', f: 1500, vol: 0.25, color: 'pink' });
    tink(o, 1200, 0.64, 0.04);
    chime(o, 1046, 0.82, 0.08, 0.5); chime(o, 1318, 0.9, 0.08, 0.7, 0.25);
  },
  sonar: (o) => {
    tone(o, { f: 1180, dur: 1.4, vol: 0.12, a: 0.004, verb: 0.75 });
    tone(o, { at: 0.004, f: 2360, dur: 0.25, vol: 0.02 });
    tone(o, { at: 0.6, f: 1180, dur: 0.9, vol: 0.03, verb: 0.9 });
  },
  static_burst: (o) => {
    for (let i = 0; i < 6; i++) noise(o, { at: i * 0.045 + Math.random() * 0.02, dur: rand(0.03, 0.08), type: 'bandpass', f: rand(1800, 4200), q: 0.6, vol: rand(0.1, 0.22), a: 0.002, shape: 'sus', r: 0.01 });
    tone(o, { f: 120, dur: 0.32, type: 'sawtooth', vol: 0.02, filt: { type: 'lowpass', f: 500 }, shape: 'sus', r: 0.05 });
  },
  crt_on: (o) => {
    thump(o, 0, 90, 0.18);
    noise(o, { dur: 0.15, type: 'highpass', f: 2500, vol: 0.12, a: 0.002 });
    tone(o, { f: 180, f2: 1400, glide: 0.25, dur: 0.3, vol: 0.04, type: 'triangle' });
    tone(o, { at: 0.05, f: 7800, dur: 0.7, vol: 0.005, a: 0.08, shape: 'sus', r: 0.3 });
    tone(o, { f: 60, dur: 0.6, type: 'sawtooth', vol: 0.025, a: 0.03, filt: { type: 'lowpass', f: 300 } });
  },
  treasure_open: (o) => {
    tone(o, { f: [[0, 110], [0.25, 150], [0.4, 135]], dur: 0.42, type: 'sawtooth', vol: 0.05, a: 0.02, vib: [21, 5], filt: { type: 'bandpass', f: 800, q: 3 }, shape: 'sus', r: 0.06 });
    thump(o, 0.42, 160, 0.18);
    arp(o, chime, [79, 83, 86, 91, 95], 0.06, 0.45, 0.075, 0.8);
    bell(o, m2f(98), 0.75, 0.05, 1.5, 0.5);
    noise(o, { at: 0.45, dur: 1.0, type: 'highpass', f: 7000, vol: 0.045, a: 0.2 });
  },
  sparkle: (o) => {
    for (let i = 0; i < 6; i++) fm(o, { at: i * 0.06 + Math.random() * 0.04, f: rand(2200, 4800), ratio: 3.01, index: 1, idur: 0.05, dur: 0.25, vol: rand(0.05, 0.08), verb: 0.4, pan: rand(-0.5, 0.5) });
  },
  magic: (o) => {
    tone(o, { f: 380, f2: 1600, glide: 0.6, dur: 0.65, vol: 0.05, a: 0.1, vib: [6, 10], shape: 'sus', r: 0.25, verb: 0.4 });
    arp(o, bell, [79, 81, 84, 88, 91, 93], 0.07, 0.1, 0.05, 0.9);
    whoosh(o, 0, 0.6, 600, 4000, 0.15);
  },
  flood_rush: (o) => {
    noise(o, { dur: 1.6, type: 'lowpass', f: 400, f2: 2600, glide: 0.8, vol: 0.32, a: 0.45, shape: 'sus', r: 0.7, color: 'pink' });
    noise(o, { dur: 1.6, type: 'lowpass', f: 260, vol: 0.32, color: 'brown', a: 0.3, shape: 'sus', r: 0.8 });
    for (let i = 0; i < 10; i++) bub(o, 0.3 + Math.random() * 1.1, rand(250, 700), rand(0.04, 0.07), rand(-0.6, 0.6), rand(0.05, 0.09));
  },
  worm_squish: (o) => {
    for (const at of [0, 0.13]) {
      noise(o, { at, dur: 0.12, type: 'bandpass', f: 900, f2: 380, q: 4, vol: 0.8, a: 0.01 });
      tone(o, { at, f: 320, f2: 190, glide: 0.1, dur: 0.11, vol: 0.1, vib: [32, 25] });
    }
  },
  golden_shimmer: (o) => {
    [84, 88, 91, 95].forEach((m, i) => { bell(o, m2f(m), i * 0.04, 0.035, 1.5, 0.5); bell(o, m2f(m) * 1.004, 0.25 + i * 0.05, 0.025, 1.3, 0.5); });
    noise(o, { dur: 1.3, type: 'highpass', f: 8000, vol: 0.05, a: 0.35, shape: 'lin' });
  },
  travel_whoosh: (o) => {
    whoosh(o, 0, 1.1, [[0, 280], [0.6, 3200], [1.1, 900]], 0, 0.3, 0.9);
    tone(o, { f: 80, f2: 160, glide: 0.9, dur: 1.0, vol: 0.08, a: 0.4, shape: 'lin' });
    droplets(o, 5, 0.3, 0.6, 0.03, 900, 2200);
  },
  arrive: (o) => {
    whoosh(o, 0, 0.45, 2200, 500, 0.15);
    [79, 84, 88].forEach((m, i) => chime(o, m2f(m), 0.18 + i * 0.07, 0.07, 1.0, 0.35));
    bub(o, 0.15, 500, 0.06);
  },
  unlock_biome: (o) => {
    [60, 67, 71, 74, 76].forEach((m) => tone(o, { f: m2f(m), dur: 2.4, type: 'sawtooth', unison: [-8, 8], vol: 0.022, a: 0.8, shape: 'sus', r: 1.1, filt: { type: 'lowpass', f: 300, f2: 3000, glide: 1.6 }, verb: 0.4 }));
    thump(o, 0, 70, 0.3);
    noise(o, { dur: 2.2, type: 'lowpass', f: 200, f2: 1200, color: 'brown', vol: 0.3, a: 0.9, shape: 'lin' });
    arp(o, bell, [76, 79, 83, 88, 91, 95], 0.09, 0.9, 0.05, 1.5);
    noise(o, { at: 0.9, dur: 1.4, type: 'highpass', f: 7000, vol: 0.05, a: 0.3 });
  },
};

const COMBO = [0, 2, 4, 7, 9, 12, 14, 16, 19];
const combo = { n: 0, t: -1 };
// per-name minimum retrigger interval (seconds)
const MIN_GAP = { reel: 0.25, ui_type: 0.02, reel_tick: 0.012, coin_bounce: 0.02, coin_collect: 0.02, mash_pop: 0.02, ui_hover: 0.04 };
// default reverb send per SFX (others use 0.12)
const VERB = { sonar: 0.35, whale_call: 0.4, bell: 0.3, thunder: 0.3, ui_hover: 0, ui_click: 0.04, ui_type: 0, reel_tick: 0, ui_tab: 0.04, click: 0.15 };

// fire a one-shot generator into a destination with its own volume/pan/lowpass
function fire(fn, t, { dry, wet, pool = 'sfx', vol = 1, pan = 0, lp = 0, p = 1, verb = 0.12 } = {}) {
  const m = mkOut(dry, wet, vol, pan, lp);
  const o = { t, p, out: m.out, wet: m.wet, verb, pool, end: t };
  fn(o);
  releaseOut(o, m.nodes);
  return o;
}

// ---------------------------------------------------------------- loops
const LOOP_CAT = { rain: 'amb', storm: 'amb' };
const activeLoops = new Set();
const pendingLoops = new Set();
const loopO = (g, pool = 'sfx', verb = 0.1) => (t, p = 1) => ({ t, p, out: g.fade, wet: g.wet, verb, pool, end: 0 });

const creak = (o, v) => tone(o, {
  f: rand(90, 150), f2: rand(70, 120), dur: rand(0.12, 0.25), type: 'sawtooth', vol: 0.035 * v,
  vib: [rand(25, 40), 15], filt: { type: 'bandpass', f: 900, q: 5 }, a: 0.01,
});

const LOOPS = {
  // taut line: whine rises in pitch, chopped noise grit and creaks grow with v
  tension(g) {
    const whine = gOsc(g, 'sawtooth', 300, null, 0, { type: 'lowpass', f: 900, q: 4 });
    const shim = gOsc(g, 'sine', 602, null, 0);
    const vib = gLfo(g, 5.5, 3, whine.osc.frequency);
    vib.depth.connect(shim.osc.frequency);
    const gritAmp = gainNode(0, g.fade), chop = gainNode(0.5, gritAmp);
    g.nodes.push(gritAmp, chop);
    const gr = gNoise(g, 'white', chop, 1, { type: 'bandpass', f: 2400, q: 4 });
    const chopL = gLfo(g, 14, 0.5, chop.gain, 'triangle');
    const o = loopO(g);
    let v = 0, next = 0;
    return {
      set(x) {
        v = x;
        const f = 220 * Math.pow(2, x * 1.7);
        ramp(whine.osc.frequency, f, 0.08); ramp(shim.osc.frequency, f * 2.01, 0.08);
        ramp(whine.fl.frequency, f * 3, 0.08);
        ramp(whine.amp.gain, 0.07 * Math.pow(x, 0.8), 0.08);
        ramp(shim.amp.gain, 0.02 * x, 0.08);
        ramp(vib.depth.gain, f * (0.004 + 0.02 * x), 0.1);
        ramp(gritAmp.gain, 0.2 * x * x, 0.08);
        ramp(gr.fl.frequency, 1800 + 2200 * x, 0.1);
        ramp(chopL.osc.frequency, 9 + 30 * x, 0.1);
      },
      tick(t0, h) {
        if (v < 0.25) { next = 0; return; }
        if (!next || next < t0) next = t0 + rand(0.4, 1.6) / v;
        if (next < h) { creak(o(next), v); next += rand(0.4, 1.6) / v; }
      },
    };
  },

  // crank ratchet: click rate follows v, plus a soft spool whir
  reel(g) {
    const whir = gNoise(g, 'pink', null, 0, { type: 'bandpass', f: 700, q: 1.5 });
    const hum = gOsc(g, 'triangle', 90, null, 0, { type: 'lowpass', f: 400 });
    const o = loopO(g, 'sfx', 0);
    let v = 0, next = 0, n = 0;
    return {
      set(x) {
        v = x;
        ramp(whir.amp.gain, 0.14 * x, 0.06); ramp(whir.fl.frequency, 500 + 1500 * x, 0.06);
        ramp(hum.amp.gain, 0.02 * x, 0.06); ramp(hum.osc.frequency, 60 + 140 * x, 0.06);
      },
      tick(t0, h) {
        if (v < 0.02) { next = 0; return; }
        const iv = 1 / (3 + 27 * v);
        if (!next || next < t0) next = t0 + 0.005;
        while (next < h) {
          const oo = o(next);
          tick(oo, 0, 3000 + (n % 2) * 600, 0.1 + 0.06 * v);
          tone(oo, { f: n % 2 ? 2700 : 2300, dur: 0.01, type: 'triangle', vol: 0.03, a: 0.0008 });
          n++; next += iv;
        }
      },
    };
  },

  rain(g) {
    const hiss = gNoise(g, 'pink', null, 0, [{ type: 'highpass', f: 500 }, { type: 'lowpass', f: 5500 }]);
    const patter = gNoise(g, 'white', null, 0, { type: 'bandpass', f: 3200, q: 0.6 });
    const o = loopO(g, 'amb', 0.15);
    let v = 0, next = 0;
    return {
      set(x) {
        v = x;
        ramp(hiss.amp.gain, 0.06 + 0.22 * x, 0.2); ramp(patter.amp.gain, 0.015 + 0.06 * x, 0.2);
        ramp(hiss.fls[1].frequency, 3000 + 4000 * x, 0.3);
      },
      tick(t0, h) {
        const iv = 1 / (3 + 22 * v);
        if (!next || next < t0) next = t0 + rand(0, iv);
        while (next < h) {
          bub(o(next), 0, rand(1600, 4200), rand(0.012, 0.028) * (0.5 + v), rand(-0.8, 0.8), rand(0.02, 0.035));
          next += iv * rand(0.3, 1.7);
        }
      },
    };
  },

  storm(g) {
    const rain = LOOPS.rain(g);
    const wind = gNoise(g, 'brown', null, 0, { type: 'bandpass', f: 420, q: 0.9 });
    gLfo(g, 0.09, 180, wind.fl.frequency);
    const rumble = gNoise(g, 'brown', null, 0, { type: 'lowpass', f: 140 });
    let v = 0, next = 0;
    return {
      set(x) {
        v = x; rain.set(0.6 + 0.4 * x);
        ramp(wind.amp.gain, 0.06 + 0.25 * x, 0.3); ramp(rumble.amp.gain, 0.05 + 0.2 * x, 0.3);
      },
      tick(t0, h) {
        rain.tick(t0, h);
        if (!next || next < t0) next = t0 + rand(3, 10);
        if (next < h) {
          fire(SFX.thunder, next, { dry: g.fade, wet: g.wet, pool: 'amb', vol: rand(0.4, 0.9) * (0.4 + 0.6 * v), lp: rand(1500, 4000), p: rand(0.85, 1.1), verb: 0.3 });
          next += rand(6, 18) / (0.3 + v);
        }
      },
    };
  },

  static(g) {
    const hiss = gNoise(g, 'white', null, 0, { type: 'bandpass', f: 3200, q: 0.4 });
    const hum = gOsc(g, 'sawtooth', 60, null, 0, { type: 'lowpass', f: 360 });
    const o = loopO(g, 'sfx', 0);
    let v = 0, next = 0;
    return {
      set(x) { v = x; ramp(hiss.amp.gain, 0.05 + 0.18 * x, 0.06); ramp(hum.amp.gain, 0.012 + 0.02 * x, 0.1); },
      tick(t0, h) {
        const iv = 1 / (8 + 40 * v);
        if (!next || next < t0) next = t0;
        while (next < h) {
          noise(o(next), { dur: rand(0.004, 0.02), type: 'highpass', f: rand(1500, 5000), vol: rand(0.05, 0.25) * (0.3 + v), a: 0.0007, pan: rand(-0.5, 0.5) });
          next += iv * rand(0.2, 1.8);
        }
      },
    };
  },

  // deep beating hum with a throbbing swirl; deeper and faster as v rises
  blackhole(g) {
    const hum = gainNode(0, g.fade);
    const lp = biquad('lowpass', 260, 1.2, hum);
    const throb = gainNode(0.75, lp);
    g.nodes.push(hum, lp, throb);
    const a = gOsc(g, 'sine', 42, throb, 0.3), b = gOsc(g, 'sine', 42.7, throb, 0.25);
    const c = gOsc(g, 'triangle', 84, throb, 0.12), d = gOsc(g, 'sawtooth', 63, throb, 0.05);
    const tl = gLfo(g, 0.6, 0.25, throb.gain);
    const swirl = gNoise(g, 'brown', null, 0, { type: 'bandpass', f: 300, q: 3 });
    const sw = gLfo(g, 0.3, 200, swirl.fl.frequency);
    return {
      set(x) {
        const f = 46 - 12 * x;
        ramp(a.osc.frequency, f, 0.2); ramp(b.osc.frequency, f * 1.017, 0.2);
        ramp(c.osc.frequency, f * 2, 0.2); ramp(d.osc.frequency, f * 1.5, 0.2);
        ramp(hum.gain, 0.12 + 0.2 * x, 0.15); ramp(lp.frequency, 180 + 400 * x, 0.15);
        ramp(tl.osc.frequency, 0.4 + 2 * x, 0.2);
        ramp(swirl.amp.gain, 0.04 + 0.22 * x, 0.15); ramp(sw.osc.frequency, 0.2 + 0.8 * x, 0.2);
        ramp(swirl.fl.frequency, 250 + 500 * x, 0.2);
      },
    };
  },

  flood(g) {
    const rush = gNoise(g, 'brown', null, 0, { type: 'lowpass', f: 400, q: 0.5 });
    const foam = gNoise(g, 'pink', null, 0, { type: 'bandpass', f: 1200, q: 0.7 });
    gLfo(g, 0.17, 300, foam.fl.frequency);
    const o = loopO(g, 'sfx', 0.15);
    let v = 0, next = 0;
    return {
      set(x) {
        v = x;
        ramp(rush.amp.gain, 0.1 + 0.22 * x, 0.15); ramp(rush.fl.frequency, 300 + 1500 * x, 0.15);
        ramp(foam.amp.gain, 0.04 + 0.2 * x, 0.15);
      },
      tick(t0, h) {
        const iv = 1 / (2 + 12 * v);
        if (!next || next < t0) next = t0 + rand(0, iv);
        while (next < h) { bub(o(next), 0, rand(250, 800), rand(0.03, 0.06), rand(-0.7, 0.7), rand(0.05, 0.09)); next += iv * rand(0.4, 1.6); }
      },
    };
  },
};

function makeLoop(name) {
  const build = LOOPS[name];
  let inst = null, g = null, v = 0.5, dead = false;
  const ensure = () => {
    if (inst || dead || !ready()) return;
    pendingLoops.delete(handle);
    const cat = B[LOOP_CAT[name] || 'sfx'];
    g = group(cat.in, cat.verb, 1, 0.35);
    inst = build(g);
    inst.set(v);
    activeLoops.add(inst);
  };
  const handle = {
    set(x) { v = clamp01(x); ensure(); if (inst) inst.set(v); },
    stop() {
      if (dead) return;
      dead = true; pendingLoops.delete(handle);
      if (inst) { activeLoops.delete(inst); groupStop(g, 0.25); inst = null; }
    },
    get value() { return v; },
    _ensure: ensure,
  };
  if (ready()) ensure(); else pendingLoops.add(handle);
  return handle;
}

// ---------------------------------------------------------------- ambience
const MINPENTA = [0, 3, 5, 7, 10];
const evOut = (g, vol, pan, lp, verb, p = 1) => ({ dry: g.fade, wet: g.wet, pool: 'amb', vol, pan, lp, verb, p });

const AMB = {
  desktop(g, night) {
    gNoise(g, 'brown', null, night ? 0.022 : 0.03, { type: 'lowpass', f: 220 });
    gNoise(g, 'pink', null, 0.006, { type: 'bandpass', f: 900, q: 0.6 });
    const blade = gOsc(g, 'sine', 118, null, 0.0035);
    gLfo(g, 0.07, 0.6, blade.osc.frequency);
    return [];
  },
  shallows(g, night) {
    const wash = gNoise(g, 'pink', null, night ? 0.06 : 0.085, { type: 'lowpass', f: night ? 380 : 520, q: 0.5 });
    gLfo(g, 0.071, 120, wash.fl.frequency);
    const surfMod = gainNode(0.5, g.fade);
    g.nodes.push(surfMod);
    gNoise(g, 'brown', surfMod, night ? 0.12 : 0.16, { type: 'bandpass', f: 260, q: 0.7 });
    gLfo(g, 0.11, 0.45, surfMod.gain);
    const trickle = (o) => {
      const n = 2 + ((Math.random() * 4) | 0);
      let at = 0;
      for (let i = 0; i < n; i++) { bub(o, at, rand(350, 1100), rand(0.03, 0.07), 0, rand(0.04, 0.08)); at += rand(0.05, 0.16); }
    };
    const chirps = (o) => {
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) tone(o, { at: i * rand(0.12, 0.2), f: rand(1600, 2200), f2: rand(2600, 3600), glide: 0.07, dur: 0.09, vol: 0.06, vib: [30, 50] });
    };
    return [
      { min: night ? 3 : 1.5, max: night ? 8 : 5, fn: (t) => fire(trickle, t, evOut(g, night ? 0.45 : 0.65, rand(-0.7, 0.7), 2600, 0.2)) },
      { min: night ? 25 : 12, max: night ? 60 : 30, first: rand(5, 12), fn: (t) => fire(chirps, t, evOut(g, night ? 0.22 : 0.32, rand(-0.8, 0.8), 3200, 0.6)) },
    ];
  },
  junkyard(g, night) {
    gOsc(g, 'sawtooth', 55, null, night ? 0.022 : 0.03, { type: 'lowpass', f: night ? 160 : 220, q: 1 });
    gOsc(g, 'sawtooth', 55.35, null, night ? 0.018 : 0.025, { type: 'lowpass', f: night ? 150 : 200, q: 1 });
    gNoise(g, 'brown', null, 0.07, { type: 'lowpass', f: 240 });
    const hum = gOsc(g, 'sine', 120, null, 0.006);
    gOsc(g, 'sine', 180, null, 0.003);
    gLfo(g, 0.23, 0.003, hum.amp.gain);
    const creakEv = (o) => {
      const f = rand(70, 140), d = rand(0.6, 1.4);
      tone(o, { f: [[0, f], [d * 0.5, f * 1.3], [d, f * 1.1]], dur: d, type: 'sawtooth', vol: 0.05, a: 0.1, shape: 'sus', r: 0.25, vib: [rand(15, 30), 6], filt: { type: 'bandpass', f: 700, q: 4 } });
    };
    const clank = (o) => {
      fm(o, { f: rand(180, 420), ratio: 1.41, index: 4, index2: 0.3, idur: 0.12, dur: 1.2, vol: 0.06 });
      noise(o, { dur: 0.05, type: 'lowpass', f: 1200, vol: 0.2, color: 'pink' });
    };
    return [
      { min: night ? 7 : 4, max: night ? 15 : 10, fn: (t) => fire(creakEv, t, evOut(g, 0.6, rand(-0.8, 0.8), 1500, 0.4)) },
      { min: night ? 10 : 6, max: night ? 25 : 15, fn: (t) => fire(SFX.static_burst, t, evOut(g, 0.22, rand(-0.6, 0.6), 5000, 0.2)) },
      { min: night ? 14 : 8, max: night ? 30 : 20, fn: (t) => fire(clank, t, evOut(g, 0.5, rand(-0.9, 0.9), 1800, 0.7, rand(0.8, 1.2))) },
    ];
  },
  abyss(g, night) {
    gNoise(g, 'brown', null, night ? 0.14 : 0.16, { type: 'lowpass', f: 90, q: 0.7 });
    const press = gNoise(g, 'brown', null, 0.035, { type: 'bandpass', f: 140, q: 1.5 });
    gLfo(g, 0.05, 40, press.fl.frequency);
    gOsc(g, 'sine', 36, null, 0.04);
    const chimeEv = (o) => {
      const m = 74 + MINPENTA[(Math.random() * 5) | 0] + (chance(0.4) ? 12 : 0); // D minor pentatonic
      bell(o, m2f(m), 0, 0.06, 2.4, 0.9);
    };
    return [
      { min: night ? 30 : 20, max: night ? 70 : 45, first: rand(6, 15), fn: (t) => fire(SFX.whale_call, t, evOut(g, 0.32, rand(-0.8, 0.8), 700, 0.8, rand(0.6, 0.85))) },
      { min: night ? 9 : 6, max: night ? 20 : 14, fn: (t) => fire(chimeEv, t, evOut(g, night ? 0.18 : 0.25, rand(-0.8, 0.8), 0, 0.9)) },
    ];
  },
};
AMB.aquarium = AMB.desktop;

// weather layers on top of a biome bed (ids come from the biome definitions)
function subGroup(g, level) {
  const sg = { fade: gainNode(level, g.fade), wet: g.wet ? gainNode(level, g.wet) : null, srcs: g.srcs, nodes: g.nodes };
  g.nodes.push(sg.fade, sg.wet);
  return sg;
}
const withV = (l, v) => { l.set(v); return l; };
const evLayer = (evs, inner) => ({ tick(t0, h) { if (inner && inner.tick) inner.tick(t0, h); runEvents(evs, t0, h); } });
const dataBlip = (o) => {
  const base = pick([79, 81, 84, 86, 88]);
  for (let i = 0, n = 2 + ((Math.random() * 3) | 0); i < n; i++) {
    tone(o, { at: i * 0.06, f: m2f(base + pick([0, 3, 5, 7, 12])), dur: 0.05, wave: 'pulse12', vol: 0.04, a: 0.002 });
  }
};
const WEATHER = {
  rain: (g) => withV(LOOPS.rain(g), 0.5),
  storm: (g) => withV(LOOPS.storm(g), 0.75),
  static: (g) => withV(LOOPS.static(subGroup(g, 0.4)), 0.35),
  datarain: (g) => evLayer([{ min: 0.5, max: 1.8, fn: (t) => fire(dataBlip, t, evOut(g, 0.35, rand(-0.8, 0.8), 0, 0.35)) }],
    withV(LOOPS.rain(subGroup(g, 0.5)), 0.3)),
  oil: (g) => { gNoise(g, 'brown', null, 0.05, { type: 'lowpass', f: 150 }); return null; },
  current: (g) => withV(LOOPS.flood(subGroup(g, 0.45)), 0.1),
  snow: (g) => evLayer([{ min: 0.8, max: 2.6, fn: (t) => fire((o) => tone(o, { f: rand(2400, 4200), dur: 0.5, vol: 0.05, a: 0.003 }), t, evOut(g, 0.3, rand(-0.9, 0.9), 0, 0.8)) }]),
  glowtide: (g) => evLayer([{ min: 5, max: 11, fn: (t) => fire((o) => {
    for (const m of pick([[62, 69, 76], [58, 65, 74], [60, 67, 74]])) tone(o, { f: m2f(m + 12), dur: 4, vol: 0.03, a: 1.6, shape: 'sus', r: 2, vib: [0.3, 1.5] });
  }, t, evOut(g, 0.4, rand(-0.5, 0.5), 0, 0.9)) }]),
};

let scene = null;
function buildScene(key, biome, weather, night) {
  const g = group(B.amb.in, B.amb.verb, 1, 2.5);
  const evs = (AMB[biome] || AMB.desktop)(g, night) || [];
  const layer = WEATHER[weather] ? WEATHER[weather](g) : null;
  return { key, g, tick(t0, h) { runEvents(evs, t0, h); if (layer && layer.tick) layer.tick(t0, h); } };
}

function applyAmbience() {
  if (!B || S.amb === undefined) return;
  const biome = S.amb, weather = S.ambOpts.weather || null, night = S.ambOpts.night ?? S.night;
  const off = biome === false || biome === 'off' || biome === 'none';
  const key = off ? 'off' : `${biome || 'desktop'}|${weather}|${night ? 1 : 0}`;
  if (scene && scene.key === key) return;
  if (scene) { groupStop(scene.g, 2.5); scene = null; }
  if (!off) scene = buildScene(key, biome || 'desktop', weather, night);
}

// ---------------------------------------------------------------- music instruments
const INS = {
  marimba: (o, m, vol, at = 0, dur = 0.8) => fm(o, { f: m2f(m), at, ratio: 4, index: 1.4, idur: 0.05, dur, a: 0.002, vol }),
  kalimba: (o, m, vol, at = 0, dur = 1.0) => fm(o, { f: m2f(m), at, ratio: 7.1, index: 0.8, idur: 0.03, dur, a: 0.002, vol }),
  glass: (o, m, vol, at = 0, dur = 3.5, verb = 0.75) => {
    tone(o, { f: m2f(m), at, dur, vol, a: 0.004, verb });
    tone(o, { f: m2f(m) * 2.76, at, dur: dur * 0.3, vol: vol * 0.2, verb });
  },
  musicbox: (o, m, vol, at = 0, dur = 1.6, verb = 0.35) => {
    fm(o, { f: m2f(m), at, ratio: 5, index: 0.5, idur: 0.12, dur, a: 0.002, vol, verb });
    tone(o, { f: m2f(m) * 2, at, dur: 0.3, vol: vol * 0.15 });
  },
  celesta: (o, m, vol, at = 0, dur = 1.2) => fm(o, { f: m2f(m), at, ratio: 1, index: 0.9, index2: 0.1, idur: 0.25, dur, a: 0.003, vol }),
  pad: (o, m, dur, vol, cut, at = 0, a = 0.5, r = 0.9, type = 'sawtooth') =>
    tone(o, { f: m2f(m), at, dur, type, unison: [-7, 7], vol, a, shape: 'sus', r, filt: { type: 'lowpass', f: cut, q: 0.5 } }),
  bass: (o, m, dur, vol, at = 0) => {
    tone(o, { f: m2f(m), at, dur, type: 'triangle', vol, a: 0.01, shape: 'sus', r: Math.min(0.12, dur * 0.5) });
    tone(o, { f: m2f(m) * 2, at, dur: dur * 0.6, vol: vol * 0.15, a: 0.01 });
  },
  kick: (o, vol, at = 0) => {
    tone(o, { at, f: 125, f2: 44, glide: 0.09, dur: 0.24, vol, a: 0.002 });
    noise(o, { at, dur: 0.012, type: 'lowpass', f: 1500, vol: vol * 0.3, a: 0.001 });
  },
  shaker: (o, vol, at = 0) => noise(o, { at, dur: 0.05, type: 'bandpass', f: 7500, q: 1.2, a: 0.008, vol }),
  hat: (o, vol, at = 0, open = false) => noise(o, { at, dur: open ? 0.16 : 0.03, type: 'highpass', f: 7500, a: 0.001, vol }),
  snare: (o, vol, at = 0) => {
    noise(o, { at, dur: 0.13, type: 'bandpass', f: 1900, q: 0.8, vol, a: 0.001 });
    tone(o, { at, f: 200, f2: 150, glide: 0.05, dur: 0.07, type: 'triangle', vol: vol * 0.35 });
  },
  rim: (o, vol, at = 0) => {
    noise(o, { at, dur: 0.035, type: 'bandpass', f: 2400, q: 2, vol, a: 0.001 });
    tone(o, { at, f: 1700, dur: 0.02, type: 'triangle', vol: vol * 0.15 });
  },
};

// square bass through a resonant lowpass whose cutoff wobbles
function wobBass(o, m, dur, vol, rate) {
  const t = o.t, env = ctx.createGain(), osc = ctx.createOscillator(), fl = ctx.createBiquadFilter();
  const lfo = ctx.createOscillator(), lg = gainNode(260);
  osc.type = 'square';
  osc.frequency.value = m2f(m);
  osc.detune.setValueAtTime(-35, t);
  osc.detune.linearRampToValueAtTime(0, t + 0.06);
  fl.type = 'lowpass'; fl.Q.value = 5;
  fl.frequency.setValueAtTime(520, t);
  lfo.frequency.value = rate;
  lfo.connect(lg); lg.connect(fl.frequency);
  osc.connect(fl); fl.connect(env);
  const nodes = [env, osc, fl, lfo, lg];
  osc.start(t); lfo.start(t);
  const end = envAt(env, t, dur, vol, 0.006, 'sus', 0.05);
  route(o, env, nodes, 0, 0);
  finishVoice(o, [osc, lfo], nodes, env, t, end);
}

// pick the pool index nearest idx whose pitch class is a chord tone
function snapIdx(pool, idx, pcs) {
  for (const d of [0, 1, -1, 2, -2]) {
    const k = idx + d;
    if (k >= 0 && k < pool.length && pcs.includes(pool[k] % 12)) return k;
  }
  return idx;
}

function newPhrase(st, density, len) {
  st.rhythm = []; st.motif = [];
  let idx = st.mi ?? (len >> 1);
  for (let k = 0; k < 32; k++) {
    const on = k % 2 === 0 ? chance(density) : chance(density * 0.15);
    st.rhythm.push(on);
    if (on) idx = Math.max(0, Math.min(len - 1, idx + pick([-2, -1, -1, 0, 1, 1, 2])));
    st.motif.push(idx);
  }
  st.mi = idx;
}

// ---------------------------------------------------------------- music tracks
const SH_CH = {
  F: { pad: [53, 60, 64, 69], root: 41 }, Dm: { pad: [50, 60, 65, 69], root: 38 },
  Bb: { pad: [58, 62, 65, 69], root: 46 }, C: { pad: [55, 60, 64, 67], root: 48 },
  Am: { pad: [57, 60, 64, 67], root: 45 }, Gm: { pad: [55, 58, 62, 65], root: 43 },
};
const SH_PROGS = [['F', 'Dm', 'Bb', 'C'], ['F', 'Am', 'Bb', 'C'], ['Bb', 'C', 'Am', 'Dm'], ['F', 'Dm', 'Gm', 'C']];
const SH_MEL = [72, 74, 77, 79, 81, 84, 86, 89]; // F major pentatonic

const JY_CH = {
  Am: { tones: [57, 60, 64], root: 45 }, F: { tones: [57, 60, 65], root: 41 }, G: { tones: [55, 59, 62], root: 43 },
  Em: { tones: [55, 59, 64], root: 40 }, Dm: { tones: [57, 62, 65], root: 38 },
};
const JY_PROGS = [['Am', 'F', 'G', 'Em'], ['Am', 'Dm', 'F', 'G'], ['Am', 'G', 'F', 'G'], ['Am', 'F', 'Dm', 'Em']];
const JY_LEAD = [69, 72, 74, 76, 79, 81, 84]; // A minor pentatonic

const AB_CH = [[50, 57, 62, 65], [46, 53, 57, 62], [43, 50, 57, 58], [45, 52, 57, 60]];

const AQ_CH = { G: [55, 59, 62], Em: [52, 55, 59], C: [48, 52, 55], D: [50, 54, 57], Am: [45, 48, 52] };
const AQ_PROGS = [['G', 'Em', 'C', 'D'], ['G', 'C', 'G', 'D'], ['C', 'D', 'G', 'Em'], ['G', 'Em', 'Am', 'D']];
const AQ_MEL = [74, 76, 79, 81, 83, 86, 88]; // G major pentatonic

const TRACKS = {
  // music-box notes drifting over the ordinary desktop
  desktop: {
    stepDur: 0.55, verb: 0.4, fadeIn: 3,
    step(tr, i, t) {
      const o = tr.o(t), notes = [84, 86, 88, 91, 93, 96];
      if (chance(S.night ? 0.08 : 0.16)) {
        const j = (Math.random() * notes.length) | 0;
        INS.musicbox(o, notes[j], 0.05, 0, 1.8, 0.4);
        if (j >= 2 && chance(0.3)) INS.musicbox(o, notes[j - 2], 0.03, 0.01, 1.6, 0.4);
      }
      if (i % 16 === 0 && chance(0.35)) INS.musicbox(o, pick([60, 67, 72]), 0.035, 0, 2.4, 0.5);
    },
  },

  // cozy tropical lo-fi
  shallows: {
    bpm: 88, swing: 0.14, verb: 0.2, fadeIn: 2.5,
    step(tr, i, t) {
      const st = tr.st, s = i % 16, bar = (i / 16) | 0, night = S.night, sd = tr.stepDur;
      if (s === 0) {
        if (bar % 4 === 0 || !st.prog) {
          st.prog = pick(SH_PROGS);
          newPhrase(st, night ? 0.32 : 0.6, SH_MEL.length);
          st.inst = chance(0.5) ? 'kalimba' : 'marimba';
        }
        st.ch = SH_CH[st.prog[bar % 4]];
        for (const m of st.ch.pad) INS.pad(tr.o(t, null, 0.3), m, sd * 16 + 0.6, night ? 0.014 : 0.019, night ? 650 : 1100, 0, 0.35, 0.9);
      }
      const ch = st.ch;
      if (!ch) return;
      const o = tr.o(t);
      if (s === 0) INS.bass(o, ch.root, sd * 5, 0.13);
      else if (s === 10 && chance(night ? 0.3 : 0.7)) INS.bass(o, ch.root + (chance(0.5) ? 7 : 12), sd * 3, 0.1);
      else if (s === 14 && !night && chance(0.25)) INS.bass(o, ch.root + 7, sd * 1.5, 0.08);
      if (s === 0 || (s === 8 && !night)) INS.kick(o, night ? 0.15 : 0.22);
      if (!night && s === 11 && chance(0.25)) INS.kick(o, 0.11);
      if (!night && (s === 4 || s === 12)) INS.rim(o, 0.12);
      const acc = [0.5, 0.25, 0.85, 0.35][s % 4];
      if (!night || s % 4 === 2) INS.shaker(o, (night ? 0.07 : 0.11) * acc * rand(0.8, 1.1));
      const ri = (bar % 2) * 16 + s;
      if (st.rhythm[ri]) {
        let idx = st.motif[ri];
        if (bar % 4 === 3 && s >= 8) idx = Math.max(0, Math.min(SH_MEL.length - 1, idx + pick([-1, 1])));
        if (s % 8 === 0) idx = snapIdx(SH_MEL, idx, ch.pad.map((m) => m % 12));
        const vol = (night ? 0.05 : 0.07) * (s % 4 === 0 ? 1 : 0.8);
        INS[st.inst](o, SH_MEL[idx], vol, 0, st.inst === 'kalimba' ? 1.1 : 0.8);
      }
    },
  },

  // glitchy lo-fi chiptune
  junkyard: {
    bpm: 92, swing: 0.06, verb: 0.12, fadeIn: 2,
    init(tr) {
      const pre = gainNode(5), sh = ctx.createWaveShaper(), post = gainNode(0.2);
      sh.curve = WAVES.crush; sh.oversample = 'none';
      const lp = biquad('lowpass', S.night ? 2200 : 3800, 0.7, tr.fade);
      pre.connect(sh); sh.connect(post); post.connect(lp);
      tr.nodes.push(pre, sh, post, lp);
      tr.crush = pre; tr.crushLp = lp;
    },
    step(tr, i, t) {
      const st = tr.st, s = i % 16, bar = (i / 16) | 0, night = S.night, sd = tr.stepDur;
      if (s === 0) {
        if (bar % 4 === 0 || !st.prog) {
          st.prog = pick(JY_PROGS); st.pat = pick(['up', 'down', 'updown', 'rand']);
          st.lead = !night && chance(0.5); st.li = 2;
        }
        st.ch = JY_CH[st.prog[bar % 4]];
        ramp(tr.crushLp.frequency, night ? 2200 : 3800, 0.5, t);
        st.glitch = chance(night ? 0.1 : 0.3) ? 4 + ((Math.random() * 10) | 0) : -1;
      }
      const ch = st.ch;
      if (!ch) return;
      const o = tr.o(t), oc = tr.o(t, tr.crush, 0.1);
      if ([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0][s] && (!night || s === 0)) INS.kick(o, 0.24);
      if ((s === 4 || s === 12) && !night) INS.snare(oc, 0.16);
      if (([0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1][s] || chance(0.08)) && (!night || s % 4 === 2)) {
        const open = s === 14 && chance(0.3);
        INS.hat(o, (open ? 0.07 : 0.1) * rand(0.6, 1), 0, open);
      }
      if ([1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0][s] && (!night || s === 0 || s === 8)) {
        const m = ch.root + (s === 8 ? 12 : s === 14 ? 7 : 0);
        wobBass(o, m, sd * (s === 0 || s === 8 ? 2.5 : 1.5), 0.05, 1 / (sd * 2));
      }
      if (night ? s % 4 === 0 : s % 2 === 0 || chance(0.7)) {
        const notes = [...ch.tones, ...ch.tones.map((x) => x + 12)], n = notes.length;
        const k = st.pat === 'up' ? s % n : st.pat === 'down' ? n - 1 - (s % n) : st.pat === 'updown' ? [0, 1, 2, 3, 4, 5, 4, 3, 2, 1][s % 10] % n : (Math.random() * n) | 0;
        tone(oc, { f: m2f(notes[k] + 12), dur: sd * 0.9, wave: 'pulse25', vol: 0.05, a: 0.002 });
      }
      if (s === st.glitch) {
        const m = pick(ch.tones) + 24;
        for (let k = 0; k < 4; k++) tone(oc, { at: (k * sd) / 2, f: m2f(m + (k === 3 ? 12 : 0)), dur: sd * 0.4, wave: 'pulse12', vol: 0.035, shape: 'sus', r: 0.01 });
      }
      if (st.lead && (s % 4 === 0 || (s % 4 === 3 && chance(0.3))) && chance(0.55)) {
        st.li = Math.max(0, Math.min(JY_LEAD.length - 1, st.li + pick([-2, -1, 1, 1, 2])));
        if (s === 0) st.li = snapIdx(JY_LEAD, st.li, ch.tones.map((m) => m % 12));
        tone(oc, { f: m2f(JY_LEAD[st.li]), dur: sd * 2, wave: 'pulse12', vol: 0.035, vib: [6, 4], a: 0.004, shape: 'sus', r: 0.05 });
      }
    },
  },

  // dark ambient: drones, glassy bells, slow swells
  abyss: {
    stepDur: 0.6, verb: 0.6, fadeIn: 4,
    init(tr) {
      const g = tr.g;
      const lp = biquad('lowpass', S.night ? 180 : 260, 0.8, g.fade);
      g.nodes.push(lp); tr.droneLp = lp;
      gOsc(g, 'sawtooth', m2f(38), lp, 0.05, null, -6);
      gOsc(g, 'sawtooth', m2f(38), lp, 0.05, null, 7);
      gOsc(g, 'sawtooth', m2f(45), lp, 0.03, null, 3);
      gOsc(g, 'sine', m2f(26), null, 0.06);
      gLfo(g, 0.05, 80, lp.frequency);
      const br = gNoise(g, 'brown', null, 0.03, { type: 'bandpass', f: 300, q: 2 });
      gLfo(g, 0.03, 120, br.fl.frequency);
    },
    step(tr, i, t) {
      const night = S.night, s = i % 8, bar = (i / 8) | 0, o = tr.o(t);
      if (s === 0) ramp(tr.droneLp.frequency, night ? 180 : 260, 1, t);
      if (s === 0 && bar % 4 === 0 && chance(night ? 0.4 : 0.7)) {
        for (const m of pick(AB_CH)) INS.pad(tr.o(t, null, 0.7), m, 8, 0.016, night ? 350 : 520, 0, 2.8, 3);
      }
      if (chance(night ? 0.07 : 0.14)) {
        const m = 74 + MINPENTA[(Math.random() * 5) | 0] + (chance(0.35) ? 12 : 0);
        INS.glass(o, m, 0.055, 0, 4, 0.8);
        if (chance(0.3)) INS.glass(o, m, 0.022, 0.9, 3, 0.9);
      }
      if (s === 4 && bar % 8 === 6 && chance(0.6)) {
        tone(o, { f: m2f(pick([26, 33])), dur: 7, type: 'triangle', vol: 0.08, a: 3, shape: 'sus', r: 3, verb: 0.3 });
        noise(o, { dur: 7, type: 'lowpass', f: 200, color: 'brown', vol: 0.15, a: 3, shape: 'lin', verb: 0.3 });
      }
    },
  },

  // calm 3/4 lullaby: soft bells over a pad
  aquarium: {
    stepDur: 60 / 66 / 2, verb: 0.35, fadeIn: 3,
    step(tr, i, t) {
      const st = tr.st, s = i % 6, bar = (i / 6) | 0, night = S.night, sd = tr.stepDur;
      if (s === 0) {
        if (bar % 4 === 0 || !st.prog) st.prog = pick(AQ_PROGS);
        st.ch = AQ_CH[st.prog[bar % 4]];
        const po = tr.o(t, null, 0.4);
        for (const m of st.ch) INS.pad(po, m, sd * 6 + 0.8, night ? 0.016 : 0.02, night ? 500 : 850, 0, 0.8, 1.2, 'triangle');
        tone(tr.o(t), { f: m2f(st.ch[0] - 12), dur: 1.4, vol: 0.09, a: 0.02 });
      }
      const ch = st.ch;
      if (!ch) return;
      const o = tr.o(t);
      if (!night || s % 2 === 0) INS.celesta(o, ch[[0, 2, 1, 2, 1, 2][s]] + 12, night ? 0.04 : 0.055);
      if ((s === 0 || s === 3) && chance(night ? 0.35 : 0.65)) {
        st.mi = Math.max(0, Math.min(AQ_MEL.length - 1, (st.mi ?? 3) + pick([-2, -1, 1, 2])));
        if (s === 0) st.mi = snapIdx(AQ_MEL, st.mi, ch.map((m) => m % 12));
        INS.musicbox(o, AQ_MEL[st.mi], 0.06, 0, 2.0, 0.45);
      }
    },
  },
};

const tracks = [];
let curTrack = null;

function makeTrack(name) {
  const def = TRACKS[name], t = ctx.currentTime, fadeIn = def.fadeIn ?? 2.5;
  const fade = gainNode(0, B.music.in), wet = gainNode(0, B.music.verb);
  for (const g of [fade, wet]) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + fadeIn); }
  const tr = {
    name, def, fade, wet, i: 0, nextT: t + 0.1, st: {}, dead: false, stopAt: 0, nodes: [fade, wet],
    stepDur: def.stepDur ?? 60 / def.bpm / 4,
  };
  tr.g = group(fade, wet, 1, 3);
  tr.o = (tt, dest, verb) => ({ t: tt, p: 1, out: dest || fade, wet, verb: verb ?? def.verb ?? 0.18, pool: 'music', end: 0 });
  if (def.init) def.init(tr);
  return tr;
}

function stopTrack(tr, fade = 2.5) {
  if (tr.dead) return;
  const t = ctx.currentTime;
  tr.dead = true; tr.stopAt = t + fade;
  for (const g of [tr.fade, tr.wet]) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fade);
  }
  groupStop(tr.g, fade);
  setTimeout(() => disconnectAll(tr.nodes), (fade + 9) * 1000);
}

function scheduleTrack(tr, t0, h) {
  if (tr.nextT < t0 - 0.2) tr.nextT = t0 + 0.02; // fell behind (throttled tab): skip ahead
  let guard = 0;
  while (tr.nextT < h && guard++ < 64) {
    const sw = tr.i % 2 ? (tr.def.swing || 0) * tr.stepDur : 0;
    if (!tr.dead || tr.nextT < tr.stopAt) tr.def.step(tr, tr.i, tr.nextT + sw);
    tr.i++;
    tr.nextT += tr.stepDur;
  }
}

function applyMusic() {
  const name = S.music;
  if (curTrack && curTrack.name === name) return;
  if (curTrack) { stopTrack(curTrack, 2.5); curTrack = null; }
  if (name && TRACKS[name]) { curTrack = makeTrack(name); tracks.push(curTrack); }
}

// ---------------------------------------------------------------- babble
// Animal-Crossing-style syllable blips: pitch from the letter, vowel formant, voice timbre.
const VOICES = {
  crab: { base: 62, scale: [0, 2, 4, 7, 9, 12], type: 'square', dur: 0.05, gap: 0.068, vol: 0.055, lp: 2400, bend: 1.12, fmul: 1 },
  fish: { base: 69, scale: [0, 2, 4, 7, 9, 12], type: 'sine', dur: 0.075, gap: 0.08, vol: 0.075, lp: 3000, bend: 1.45, fmul: 1.1 },
  tiny: { base: 81, scale: [0, 2, 4, 7, 9, 12, 14], type: 'triangle', dur: 0.04, gap: 0.052, vol: 0.065, lp: 6000, bend: 1.08, fmul: 1.4 },
  deep: { base: 45, scale: [0, 3, 5, 7, 10], type: 'sawtooth', dur: 0.1, gap: 0.105, vol: 0.075, lp: 800, bend: 0.94, fmul: 0.7 },
};
const FORMANT = { a: 850, e: 1900, i: 2500, o: 600, u: 420, y: 2200 };
const bab = { last: {}, line: null };

function blip(o, at, f, v, form, accent, cons) {
  const t = o.t + at, env = ctx.createGain(), osc = ctx.createOscillator();
  const pk = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
  osc.type = v.type;
  osc.frequency.setValueAtTime(f, t);
  osc.frequency.exponentialRampToValueAtTime(f * v.bend, t + v.dur * 0.8);
  pk.type = 'peaking'; pk.frequency.value = cf(form * v.fmul); pk.Q.value = 2.5; pk.gain.value = 6;
  lp.type = 'lowpass'; lp.frequency.value = v.lp;
  osc.connect(pk); pk.connect(lp); lp.connect(env);
  const nodes = [env, osc, pk, lp];
  osc.start(t);
  const end = envAt(env, t, v.dur * (accent ? 1.2 : 1), v.vol * (accent ? 1.25 : 1), 0.004);
  route(o, env, nodes, 0.05, 0);
  finishVoice(o, [osc], nodes, env, t, end);
  if (cons) noise(o, { at, dur: 0.014, type: 'highpass', f: 4200, vol: v.vol * 0.9, a: 0.001 });
}

function babble(text, voice = 'crab') {
  if (!ready()) return;
  const v = VOICES[voice] || VOICES.crab;
  const str = String(text ?? '').toLowerCase();
  const letters = str.replace(/[^a-z0-9]/g, '');
  if (!letters.length) return;
  const now = ctx.currentTime;
  const dest = { dry: B.sfx.in, wet: B.sfx.verb, pool: 'sfx', vol: 1, verb: 0.05 };
  const pitchOf = (c) => v.scale[(c.charCodeAt(0) * 7) % v.scale.length];
  if (str.length <= 2) {
    // typewriter-style per-character calls: rate-limited single blips
    if (now - (bab.last[voice] ?? -1) < v.gap * 0.9) return;
    bab.last[voice] = now;
    const c = letters[0];
    fire((o) => blip(o, 0, m2f(v.base + pitchOf(c)) * rand(0.98, 1.02), v, FORMANT[c] || 1200, false, 'stkpcfxz'.includes(c)), now + 0.005, dest);
    return;
  }
  // a new line replaces whatever is still queued from the previous one
  if (bab.line) {
    const g = bab.line.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.03);
  }
  const q = /\?\s*$/.test(str), ex = /!\s*$/.test(str);
  const o = fire((oo) => {
    let at = 0, count = 0, prevCons = false;
    const total = Math.min(48, letters.length);
    for (let i = 0; i < str.length && count < 48; i++) {
      const c = str[i];
      if (c === ' ' || c === '\n') { at += v.gap * 0.5; prevCons = false; continue; }
      if (',.;:!?-'.includes(c)) { at += v.gap * 2.2; continue; }
      if (!/[a-z0-9]/.test(c)) continue;
      const isV = c in FORMANT;
      if (!isV && prevCons && chance(0.5)) { prevCons = false; continue; } // merge consonant clusters
      prevCons = !isV;
      let vow = c;
      for (let k = i; k < str.length && k < i + 4; k++) if (str[k] in FORMANT) { vow = str[k]; break; }
      const pos = count / total;
      let semis = pitchOf(c) - pos * 2;
      if (q && pos > 0.7) semis += (pos - 0.7) * 22;
      if (ex) semis += 2;
      blip(oo, at, m2f(v.base + semis) * rand(0.98, 1.02), v, FORMANT[vow] || 1200, ex && count === 0, 'stkpcfxz'.includes(c));
      at += v.gap * rand(0.9, 1.1);
      count++;
    }
  }, now + 0.01, dest);
  bab.line = o.out;
}

// ---------------------------------------------------------------- scheduler + lifecycle
let timer = null;
function pump() {
  if (!ready()) return;
  try {
    const t0 = ctx.currentTime, h = t0 + LOOKAHEAD;
    for (let k = tracks.length - 1; k >= 0; k--) {
      const tr = tracks[k];
      if (tr.dead && t0 > tr.stopAt) { tracks.splice(k, 1); continue; }
      scheduleTrack(tr, t0, h);
    }
    if (scene) scene.tick(t0, h);
    for (const l of activeLoops) if (l.tick) l.tick(t0, h);
  } catch (e) {
    warnOnce('pump', 'scheduler error: ' + (e && e.message));
  }
}

function startPending() {
  if (!ready()) return;
  for (const h of [...pendingLoops]) h._ensure();
}

function init() {
  NYQ = ctx.sampleRate * 0.45;
  makeNoiseBuffers();
  makeWaves();
  initBuses();
  applyVolumes(true); applyMuffle(); applyNightTone();
  timer = setInterval(pump, 25);
  ctx.onstatechange = startPending;
  applyMusic();
  applyAmbience();
  startPending();
}

let failed = false;
function unlock() {
  if (!AC || failed) return false;
  try {
    if (!ctx) {
      ctx = new AC({ latencyHint: 'interactive' });
      try { init(); } catch (e) {
        failed = true;
        warnOnce('init', 'audio init failed: ' + e.message);
        try { ctx.close(); } catch (e2) { /* ignore */ }
        ctx = null; B = null;
        if (timer) clearInterval(timer);
        return false;
      }
    }
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      const p = ctx.resume();
      if (p && p.then) p.then(startPending, () => {});
    }
  } catch (e) {
    warnOnce('unlock', 'WebAudio unavailable: ' + e.message);
    return false;
  }
  return ready();
}

function play(name, opts) {
  const fn = SFX[name];
  if (!fn) { warnOnce('sfx:' + name, `unknown sound "${name}"`); return; }
  if (!ready()) return;
  const { vol = 1, pitch = 1, pan = 0 } = opts || {};
  if (!(vol > 0)) return;
  const now = ctx.currentTime;
  if (now - (lastPlay.get(name) ?? -1) < (MIN_GAP[name] ?? 0.03)) return;
  lastPlay.set(name, now);
  try {
    fire(fn, now + 0.005, {
      dry: B.sfx.in, wet: B.sfx.verb, pool: 'sfx', vol: Math.min(+vol, 2), pan: +pan || 0,
      p: Math.max(0.1, Math.min(+pitch || 1, 8)), verb: VERB[name] ?? 0.12,
    });
  } catch (e) {
    warnOnce('err:' + name, `sound "${name}" failed: ${e.message}`);
  }
}

const NOOP_LOOP = { set() {}, stop() {}, value: 0 };
function loop(name) {
  if (!LOOPS[name]) { warnOnce('loop:' + name, `unknown loop "${name}"`); return NOOP_LOOP; }
  if (!AC) return NOOP_LOOP;
  return makeLoop(name);
}

function setMusic(track) {
  const name = track || null;
  if (name && !TRACKS[name]) { warnOnce('music:' + name, `unknown music track "${name}"`); return; }
  S.music = name;
  if (B) applyMusic();
}

function setNight(on) {
  S.night = !!on;
  if (S.ambOpts) S.ambOpts.night = S.night;
  if (B) { applyNightTone(); applyAmbience(); }
}

function setAmbience(biome, opts = {}) {
  S.amb = biome ?? null;
  S.ambOpts = { weather: (opts && opts.weather) || null, night: opts && opts.night !== undefined ? !!opts.night : S.night };
  if (opts && opts.night !== undefined) S.night = !!opts.night;
  if (B) { applyNightTone(); applyAmbience(); }
}

function setVolumes(v = {}) {
  for (const k of ['master', 'music', 'sfx', 'ambience']) if (v[k] !== undefined) vols[k] = clamp01(v[k]);
  if (v.amb !== undefined) vols.ambience = clamp01(v.amb);
  applyVolumes();
}

function setMuffle(m) {
  S.muffle = clamp01(m);
  applyMuffle();
}

// dev-only: level meter on the pre-compressor mix (peak + RMS since last read)
function meter() {
  if (!B) return null;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  B.master.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0, sum = 0, n = 0;
  const id = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) { const x = Math.abs(buf[i]); if (x > peak) peak = x; sum += x * x; n++; }
  }, 20);
  return {
    read() { const r = { peak, rms: n ? Math.sqrt(sum / n) : 0 }; peak = 0; sum = 0; n = 0; return r; },
    close() { clearInterval(id); try { B.master.disconnect(an); } catch (e) { /* ignore */ } },
  };
}

export const SFX_NAMES = Object.keys(SFX);
export const LOOP_NAMES = Object.keys(LOOPS);
export const MUSIC_TRACKS = Object.keys(TRACKS);
export const BABBLE_VOICES = Object.keys(VOICES);

export const audio = {
  unlock,
  isUnlocked: ready,
  play,
  loop,
  setMusic,
  setNight,
  setAmbience,
  setVolumes,
  getVolumes: () => ({ ...vols }),
  setMuffle,
  babble,
  get music() { return S.music; },
  get night() { return S.night; },
  _meter: meter,
  _voices: () => ({ sfx: pools.sfx.length, music: pools.music.length, amb: pools.amb.length }),
};
