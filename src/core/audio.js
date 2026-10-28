// Procedural WebAudio engine: SFX, loops, biome ambience, generative music and babble.
// Everything is synthesized at runtime (no samples, no network). Every public call is a
// silent no-op until unlock() has created/resumed the AudioContext on a user gesture.
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
    const r = gen[k];
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
  WAVES.crush = crush(28);
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
function applyVolumes() {
  if (!B) return;
  ramp(B.master.gain, curve(vols.master));
  ramp(B.sfx.vol.gain, curve(vols.sfx)); ramp(B.sfx.verb.gain, curve(vols.sfx));
  ramp(B.music.vol.gain, curve(vols.music) * 0.7); ramp(B.music.verb.gain, curve(vols.music) * 0.7);
  ramp(B.amb.vol.gain, curve(vols.ambience) * 0.8); ramp(B.amb.verb.gain, curve(vols.ambience) * 0.8);
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
