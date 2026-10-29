// Store-only sound effects synthesised on a small private WebAudio graph (the shared audio engine has no
// modem): the 56k dial-up handshake screech, the "download complete" chime and ISP connect beeps.
// Volume follows audio.getVolumes() (master x sfx), so mute and the settings sliders still apply.
//   storeSfx(name)  name: 'modem' | 'complete' | 'connect' | 'blip'

import { audio } from '../core/audio.js';

let ac = null, out = null, noiseBuf = null;

function ctx() {
  if (ac) return ac;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ac = new AC();
    out = ac.createGain();
    const comp = ac.createDynamicsCompressor();
    out.connect(comp);
    comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ac = null;
  }
  return ac;
}

function level() {
  const v = audio.getVolumes?.() || { master: 0.8, sfx: 0.8 };
  return (v.master ?? 0.8) * (v.sfx ?? 0.8);
}

function env(g, t0, a, hold, r, peak) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.setValueAtTime(peak, t0 + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + r);
}

function osc(t0, dur, f, { type = 'sine', vol = 0.1, a = 0.005, r = 0.03, f2 = null, dest = out } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  env(g, t0, a, Math.max(0, dur - a - r), r, vol);
  o.connect(g);
  g.connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  return o;
}

function noise(t0, dur, { f = 2000, q = 1, vol = 0.1, a = 0.01, r = 0.05, type = 'bandpass' } = {}) {
  const s = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  env(g, t0, a, Math.max(0, dur - a - r), r, vol);
  s.connect(flt);
  flt.connect(g);
  g.connect(out);
  s.start(t0);
  s.stop(t0 + dur + 0.05);
}

const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], 0: [941, 1336] };

const SOUNDS = {
  // ~3 s: dial tone, DTMF number, answer tone, FSK warble, scrambled hiss
  modem(t) {
    osc(t, 0.45, 350, { vol: 0.05 });
    osc(t, 0.45, 440, { vol: 0.05 });
    let at = t + 0.52;
    for (const d of '5550199') {
      const [lo, hi] = DTMF[d];
      osc(at, 0.07, lo, { vol: 0.045, a: 0.003, r: 0.01 });
      osc(at, 0.07, hi, { vol: 0.045, a: 0.003, r: 0.01 });
      at += 0.1;
    }
    at += 0.12;
    const ans = osc(at, 0.5, 2100, { vol: 0.04, a: 0.01, r: 0.02 });
    ans.frequency.setValueAtTime(2100, at + 0.24);
    at += 0.56;
    // V.21 style frequency shift keying: two tones flipping at random
    const fsk = osc(at, 0.42, 980, { type: 'square', vol: 0.02, a: 0.005, r: 0.02 });
    for (let k = 0; k < 28; k++) fsk.frequency.setValueAtTime(Math.random() < 0.5 ? 980 : 1180, at + k * 0.015);
    osc(at + 0.05, 0.3, 1650, { vol: 0.018, f2: 1850 });
    at += 0.44;
    // the famous screech: two warbling carriers + filtered hiss
    const c1 = osc(at, 0.95, 1800, { type: 'sawtooth', vol: 0.012, a: 0.02, r: 0.12 });
    const c2 = osc(at, 0.95, 600, { type: 'square', vol: 0.01, a: 0.02, r: 0.12 });
    for (let k = 0; k < 40; k++) {
      c1.frequency.setValueAtTime(1400 + Math.random() * 1400, at + k * 0.024);
      c2.frequency.setValueAtTime(400 + Math.random() * 500, at + k * 0.024);
    }
    noise(at, 1.0, { f: 2400, q: 0.7, vol: 0.06, a: 0.03, r: 0.2 });
    noise(at + 0.2, 0.6, { f: 900, q: 2, vol: 0.03 });
  },
  complete(t) {
    const notes = [1046.5, 1318.5, 1568, 2093];
    notes.forEach((f, i) => {
      osc(t + i * 0.085, 0.42 - i * 0.04, f, { type: 'triangle', vol: 0.06, a: 0.004, r: 0.3 });
      osc(t + i * 0.085, 0.2, f * 2, { vol: 0.012, a: 0.002, r: 0.15 });
    });
    noise(t + 0.25, 0.4, { f: 7000, q: 0.5, vol: 0.012, a: 0.05, r: 0.3, type: 'highpass' });
  },
  connect(t) {
    osc(t, 0.08, 1400, { type: 'square', vol: 0.02 });
    osc(t + 0.12, 0.12, 2100, { type: 'square', vol: 0.02 });
  },
  blip(t) {
    osc(t, 0.05, 1800, { type: 'square', vol: 0.015, f2: 1200 });
  },
};

export function storeSfx(name) {
  const fn = SOUNDS[name];
  const vol = level();
  if (!fn || vol <= 0.001) return;
  if (!ctx()) {
    audio.play(name === 'modem' ? 'static_burst' : name === 'complete' ? 'ui_unlock' : 'ui_click');
    return;
  }
  try {
    if (ac.state === 'suspended') ac.resume();
    out.gain.value = vol * 1.6;
    fn(ac.currentTime + 0.02);
  } catch { /* audio is best-effort */ }
}
