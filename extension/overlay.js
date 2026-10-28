(() => {
  // src/core/math.js
  var TAU = Math.PI * 2;
  var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  var lerp = (a, b, t) => a + (b - a) * t;
  var smoothstep = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  var fract = (v) => v - Math.floor(v);
  var dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  var damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  var ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => t * (2 - t),
    inOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    inCubic: (t) => t * t * t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
    inBack: (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
    outElastic: (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
    },
    outBounce: (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  };
  function hashInt(x) {
    x |= 0;
    x = Math.imul(x ^ x >>> 16, 2146121005);
    x = Math.imul(x ^ x >>> 15, 2221713035);
    return (x ^ x >>> 16) >>> 0;
  }
  function hash1(x, seed = 0) {
    return hashInt(Math.floor(x) * 374761393 + seed * 668265263) / 4294967296;
  }
  function hash2(x, y, seed = 0) {
    return hashInt(Math.floor(x) * 374761393 + Math.floor(y) * 668265263 + seed * 2246822519) / 4294967296;
  }
  var smooth = (t) => t * t * (3 - 2 * t);
  function noise2(x, y, seed = 0) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }
  function fbm2(x, y, octaves = 4, seed = 0) {
    let v = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      v += noise2(x * f, y * f, seed + i * 31) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return v / norm;
  }
  var BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var bayer = (x, y) => BAYER4[(y & 3) * 4 + (x & 3)] / 16;
  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segmentHitsRect(x1, y1, x2, y2, r) {
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return false;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return false;
          if (t < t1) t1 = t;
        }
      }
    }
    return true;
  }

  // src/core/rng.js
  var RNG = class {
    constructor(seed = Date.now()) {
      this.s = seed >>> 0 || 1;
    }
    next() {
      let t = this.s = this.s + 1831565813 >>> 0;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    float(a = 0, b = 1) {
      return a + (b - a) * this.next();
    }
    int(a, b) {
      return a + Math.floor(this.next() * (b - a + 1));
    }
    chance(p) {
      return this.next() < p;
    }
    sign() {
      return this.next() < 0.5 ? -1 : 1;
    }
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }
    // items: [{w: weight, ...}] or [[item, weight], ...]
    weighted(items, weightOf = (it) => it.w) {
      let total = 0;
      for (const it of items) total += Math.max(0, weightOf(it));
      if (total <= 0) return items[0];
      let r = this.next() * total;
      for (const it of items) {
        r -= Math.max(0, weightOf(it));
        if (r <= 0) return it;
      }
      return items[items.length - 1];
    }
    gauss(mean = 0, sd = 1) {
      const u = 1 - this.next(), v = this.next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  };
  var rng = new RNG(Math.random() * 2 ** 32 >>> 0);
  function uid() {
    return Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  }

  // src/core/color.js
  var rgbCache = /* @__PURE__ */ new Map();
  function hexToRgb(hex) {
    let c = rgbCache.get(hex);
    if (c) return c;
    let h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    c = [n >> 16 & 255, n >> 8 & 255, n & 255];
    rgbCache.set(hex, c);
    return c;
  }
  var toHex2 = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  var rgbToHex = (r, g, b) => "#" + toHex2(r) + toHex2(g) + toHex2(b);
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = (h % 360 + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(h / 60 % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  var hexToHsl = (hex) => rgbToHsl(...hexToRgb(hex));
  var hslToHex = (h, s, l) => rgbToHex(...hslToRgb(h, clamp01(s), clamp01(l)));
  function mix(a, b, t) {
    const A = hexToRgb(a), B2 = hexToRgb(b);
    return rgbToHex(A[0] + (B2[0] - A[0]) * t, A[1] + (B2[1] - A[1]) * t, A[2] + (B2[2] - A[2]) * t);
  }
  function hueToward(h, target, amount) {
    let d = (target - h + 540) % 360 - 180;
    const step2 = Math.sign(d) * Math.min(Math.abs(d), amount);
    return h + step2;
  }
  function shade(hex, amount) {
    const [h, s, l] = hexToHsl(hex);
    if (amount < 0) {
      const a2 = -amount;
      return hslToHex(hueToward(h, 250, 28 * a2), clamp01(s + 0.08 * a2), clamp01(l * (1 - 0.75 * a2)));
    }
    const a = amount;
    return hslToHex(hueToward(h, 55, 22 * a), clamp01(s - 0.1 * a), clamp01(l + (1 - l) * 0.65 * a));
  }
  function ramp(hex, contrast = 1) {
    return [shade(hex, -0.62 * contrast), shade(hex, -0.3 * contrast), hex, shade(hex, 0.32 * contrast), shade(hex, 0.62 * contrast)];
  }
  function adjust(hex, { h = 0, s = 0, l = 0, sMul = 1, lMul = 1 } = {}) {
    const [H, S4, L] = hexToHsl(hex);
    return hslToHex(H + h, clamp01(S4 * sMul + s), clamp01(L * lMul + l));
  }
  function invert(hex) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(255 - r, 255 - g, 255 - b);
  }
  var rgbaCache = /* @__PURE__ */ new Map();
  function rgba(hex, a = 1) {
    const key = hex + "|" + a.toFixed(3);
    let s = rgbaCache.get(key);
    if (!s) {
      const [r, g, b] = hexToRgb(hex);
      s = `rgba(${r},${g},${b},${a.toFixed(3)})`;
      if (rgbaCache.size > 4e3) rgbaCache.clear();
      rgbaCache.set(key, s);
    }
    return s;
  }
  function pack(hex, a = 255) {
    const [r, g, b] = hexToRgb(hex);
    return (a & 255) << 24 | b << 16 | g << 8 | r;
  }
  function unpack(c) {
    return [c & 255, c >>> 8 & 255, c >>> 16 & 255, c >>> 24 & 255];
  }
  var RARITY = {
    common: { name: "Common", color: "#c9d4dc", dark: "#5d6b78", stars: 1, weight: 60 },
    uncommon: { name: "Uncommon", color: "#7ee07a", dark: "#2f7a3c", stars: 2, weight: 26 },
    rare: { name: "Rare", color: "#5fb8ff", dark: "#2a5aa8", stars: 3, weight: 10 },
    epic: { name: "Epic", color: "#d27bff", dark: "#6a2fa0", stars: 4, weight: 3.2 },
    legendary: { name: "Legendary", color: "#ffd04a", dark: "#a86a12", stars: 5, weight: 0.8 }
  };

  // src/core/canvas.js
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function ctxOf(canvas) {
    const g = canvas.getContext("2d", { willReadFrequently: false });
    g.imageSmoothingEnabled = false;
    return g;
  }

  // src/core/audio.js
  var AC = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  var LOOKAHEAD = 0.12;
  var LIMITS = { sfx: 32, music: 28, amb: 14 };
  var ctx = null;
  var B = null;
  var NYQ = 2e4;
  var pools = { sfx: [], music: [], amb: [] };
  var NB = {};
  var WAVES = {};
  var warned = /* @__PURE__ */ new Set();
  var lastPlay = /* @__PURE__ */ new Map();
  var vols = { master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.6 };
  var S = { night: false, muffle: 0, music: null, amb: void 0, ambOpts: {} };
  var rand = (a, b) => a + Math.random() * (b - a);
  var pick = (arr) => arr[Math.random() * arr.length | 0];
  var chance = (p) => Math.random() < p;
  var clamp012 = (v) => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0));
  var m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
  var ready = () => !!ctx && ctx.state === "running";
  var cf = (f) => Math.max(10, Math.min(NYQ, f));
  function warnOnce(key, msg) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn("[audio] " + msg);
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
  function ramp2(param, v, tc = 0.05, at) {
    const t = at ?? ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(v, t, tc);
  }
  function disconnectAll(nodes) {
    for (const n of nodes) {
      try {
        n && n.disconnect();
      } catch (e) {
      }
    }
  }
  function makeNoiseBuffers() {
    const rate = ctx.sampleRate, len = Math.floor(rate * 2), xf = 2048;
    const gen = {
      white: () => {
        const r = new Float32Array(len + xf);
        for (let i = 0; i < r.length; i++) r[i] = Math.random() * 2 - 1;
        return r;
      },
      pink: () => {
        const r = new Float32Array(len + xf);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < r.length; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          r[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
          b6 = w * 0.115926;
        }
        return r;
      },
      brown: () => {
        const r = new Float32Array(len + xf);
        let last = 0;
        for (let i = 0; i < r.length; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          r[i] = last;
        }
        return r;
      }
    };
    for (const k of Object.keys(gen)) {
      const r = gen[k]();
      let mean = 0;
      for (let i = 0; i < r.length; i++) mean += r[i];
      mean /= r.length;
      let rms = 0;
      for (let i = 0; i < r.length; i++) {
        r[i] -= mean;
        rms += r[i] * r[i];
      }
      rms = Math.sqrt(rms / r.length) || 1;
      const buf = ctx.createBuffer(1, len, rate);
      const d = buf.getChannelData(0), s = 0.25 / rms;
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
        const k = 0.35 + 0.6 * x;
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        const fadeIn = Math.min(1, (i - pre) / (rate * 6e-3));
        d[i] = lp * Math.pow(1 - x, decay) * fadeIn * (1 + 0.6 * x);
      }
    }
    return buf;
  }
  function makeWaves() {
    const pulse = (duty) => {
      const n = 64, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) re[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * duty);
      return ctx.createPeriodicWave(re, im);
    };
    WAVES.pulse25 = pulse(0.25);
    WAVES.pulse12 = pulse(0.125);
    WAVES.soft = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.25, 0.08, 0.03]));
    const crush = (levels) => {
      const n = 4096, c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1) * 2 - 1;
        c[i] = Math.round(x * levels) / levels;
      }
      return c;
    };
    WAVES.crush = crush(40);
    WAVES.crushHard = crush(7);
    const drive = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      const x = i / 2047 * 2 - 1;
      drive[i] = Math.tanh(x * 3) / Math.tanh(3);
    }
    WAVES.drive = drive;
  }
  function initBuses() {
    const out = gainNode(0.92, ctx.destination);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 2e-3;
    limiter.release.value = 0.12;
    limiter.connect(out);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 2.5;
    comp.attack.value = 8e-3;
    comp.release.value = 0.25;
    comp.connect(limiter);
    const master = gainNode(0, comp);
    const verbIn = gainNode(1);
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse();
    const verbTone = biquad("lowpass", 7e3, 0.5, master);
    const verbRet = gainNode(0.85, verbTone);
    verbIn.connect(conv);
    conv.connect(verbRet);
    const sfxVol = gainNode(0, master);
    const sfxIn = gainNode(1, sfxVol);
    const sfxVerb = gainNode(0, verbIn);
    const musicVol = gainNode(0, master);
    const musicMuffle = biquad("lowpass", NYQ, 0.6, musicVol);
    const musicTone = biquad("lowpass", 16e3, 0.5, musicMuffle);
    const musicIn = gainNode(1, musicTone);
    const musicVerb = gainNode(0, verbIn);
    const ambVol = gainNode(0, master);
    const ambMuffle = biquad("lowpass", NYQ, 0.6, ambVol);
    const ambIn = gainNode(1, ambMuffle);
    const ambVerb = gainNode(0, verbIn);
    B = {
      out,
      limiter,
      comp,
      master,
      verbIn,
      conv,
      verbTone,
      verbRet,
      musicTone,
      musicMuffle,
      ambMuffle,
      sfx: { in: sfxIn, verb: sfxVerb, vol: sfxVol },
      music: { in: musicIn, verb: musicVerb, vol: musicVol },
      amb: { in: ambIn, verb: ambVerb, vol: ambVol }
    };
  }
  var curve = (v) => Math.pow(clamp012(v), 1.5);
  var TRIM = { master: 1.6, sfx: 1.25, music: 0.7, amb: 0.8 };
  function applyVolumes(now2 = false) {
    if (!B) return;
    const set = (param, v) => {
      if (now2) param.value = v;
      else ramp2(param, v);
    };
    set(B.master.gain, curve(vols.master) * TRIM.master);
    for (const [cat, key] of [["sfx", "sfx"], ["music", "music"], ["amb", "ambience"]]) {
      const v = curve(vols[key]) * TRIM[cat];
      set(B[cat].vol.gain, v);
      set(B[cat].verb.gain, v);
    }
  }
  function applyMuffle() {
    if (!B) return;
    const m = clamp012(S.muffle);
    const f = 2e4 * Math.pow(320 / 2e4, m);
    ramp2(B.musicMuffle.frequency, cf(f), 0.08);
    ramp2(B.ambMuffle.frequency, cf(f), 0.08);
    ramp2(B.verbTone.frequency, cf(Math.min(7e3, f * 1.2)), 0.08);
    ramp2(B.musicMuffle.Q, 0.6 + m * 1.4, 0.08);
  }
  function applyNightTone() {
    if (B) ramp2(B.musicTone.frequency, S.night ? 3600 : 16e3, 0.8);
  }
  function register(pool, srcs, nodes, env, start, end) {
    const list = pools[pool] || pools.sfx, limit = LIMITS[pool] || 32, now2 = ctx.currentTime;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end <= now2) list.splice(i, 1);
    let n = 0, oldest = null;
    for (const v2 of list) {
      if (v2.killed || v2.start > start || v2.end <= start) continue;
      n++;
      if (!oldest || v2.start < oldest.start) oldest = v2;
    }
    if (n >= limit && oldest) kill(oldest, start);
    const v = { srcs, nodes, env, list, start, end, done: false, killed: false };
    list.push(v);
    let left = srcs.length;
    const fin = () => {
      if (--left <= 0) finish(v);
    };
    for (const s of srcs) {
      s.onended = fin;
      s.stop(end);
    }
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
    const now2 = ctx.currentTime, t = Math.max(now2, at ?? now2), g = v.env.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else if (t - now2 < 0.01) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
    }
    g.setTargetAtTime(0, t, 6e-3);
    v.end = t + 0.05;
    for (const s of v.srcs) {
      try {
        s.stop(t + 0.05);
      } catch (e) {
      }
    }
  }
  function envAt(g, t, dur, peak, a = 4e-3, shape = "exp", r = 0.08) {
    const p = g.gain, end = t + Math.max(dur, a + 4e-3);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (shape === "sus") {
      p.setValueAtTime(peak, Math.max(t + a, end - r));
      p.linearRampToValueAtTime(0, end);
    } else if (shape === "lin") {
      p.linearRampToValueAtTime(0, end);
    } else {
      p.exponentialRampToValueAtTime(peak * 1e-3 + 1e-6, end);
      p.linearRampToValueAtTime(0, end + 6e-3);
    }
    return end + 0.012;
  }
  function setFreq(param, t, f, f2, glide, mul = 1) {
    if (Array.isArray(f)) {
      param.setValueAtTime(cf(f[0][1] * mul), t + f[0][0]);
      for (let i = 1; i < f.length; i++) param.exponentialRampToValueAtTime(cf(f[i][1] * mul), t + f[i][0]);
      return f[0][1] * mul;
    }
    param.setValueAtTime(cf(f * mul), t);
    if (f2) param.exponentialRampToValueAtTime(cf(f2 * mul), t + Math.max(5e-3, glide));
    return f * mul;
  }
  function addFilter(t, spec, dur, mul, nodes) {
    const fl = ctx.createBiquadFilter();
    fl.type = spec.type || "lowpass";
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
      n.connect(p);
      n = p;
      nodes.push(p);
    }
    n.connect(o.out);
    const w = verb ?? o.verb ?? 0;
    if (w > 0 && o.wet) {
      const s = gainNode(w, o.wet);
      n.connect(s);
      nodes.push(s);
    }
  }
  function finishVoice(o, srcs, nodes, env, start, end) {
    register(o.pool, srcs, nodes, env, start, end);
    if (end > o.end) o.end = end;
  }
  function tone(o, {
    f = 440,
    f2 = 0,
    glide,
    at = 0,
    dur = 0.2,
    type = "sine",
    wave,
    a = 4e-3,
    vol = 0.2,
    shape,
    r,
    vib,
    filt,
    unison,
    verb,
    pan
  } = {}) {
    if (vol <= 0) return;
    const t = o.t + at, srcs = [], nodes = [], env = ctx.createGain();
    nodes.push(env);
    let head = env;
    if (filt) {
      const fl = addFilter(t, filt, dur, o.p, nodes);
      fl.connect(env);
      head = fl;
    }
    const dets = unison || [0];
    const sub = gainNode(1 / Math.sqrt(dets.length), head);
    nodes.push(sub);
    let lfo = null;
    if (vib) {
      const l = ctx.createOscillator();
      l.frequency.value = vib[0];
      lfo = gainNode(vib[1] * o.p);
      l.connect(lfo);
      l.start(t);
      srcs.push(l);
      nodes.push(l, lfo);
    }
    for (const d of dets) {
      const osc = ctx.createOscillator();
      if (wave && WAVES[wave]) osc.setPeriodicWave(WAVES[wave]);
      else osc.type = type;
      setFreq(osc.frequency, t, f, f2, glide ?? dur, o.p);
      if (d) osc.detune.value = d;
      if (lfo) lfo.connect(osc.frequency);
      osc.connect(sub);
      osc.start(t);
      srcs.push(osc);
      nodes.push(osc);
    }
    const end = envAt(env, t, dur, vol, a, shape, r);
    route(o, env, nodes, verb, pan);
    finishVoice(o, srcs, nodes, env, t, end);
  }
  function fm(o, {
    f = 440,
    f2 = 0,
    glide,
    ratio = 2,
    index = 2,
    index2 = 0,
    idur = 0.2,
    at = 0,
    dur = 0.5,
    a = 3e-3,
    vol = 0.2,
    type = "sine",
    shape,
    r,
    filt,
    verb,
    pan
  } = {}) {
    if (vol <= 0) return;
    const t = o.t + at, env = ctx.createGain();
    const car = ctx.createOscillator(), mod = ctx.createOscillator();
    car.type = type;
    const fr = setFreq(car.frequency, t, f, f2, glide ?? dur, o.p);
    setFreq(mod.frequency, t, f, f2, glide ?? dur, o.p * ratio);
    const dev = fr * ratio * Math.min(1, Math.max(0, NYQ * 0.75 - fr) / Math.max(1, index * fr * ratio));
    const mg = gainNode(0);
    mg.gain.setValueAtTime(index * dev, t);
    mg.gain.setTargetAtTime(index2 * dev, t + 2e-3, Math.max(5e-3, idur / 3));
    mod.connect(mg);
    mg.connect(car.frequency);
    const nodes = [env, car, mod, mg];
    if (filt) {
      const fl = addFilter(t, filt, dur, o.p, nodes);
      car.connect(fl);
      fl.connect(env);
    } else car.connect(env);
    car.start(t);
    mod.start(t);
    const end = envAt(env, t, dur, vol, a, shape, r);
    route(o, env, nodes, verb, pan);
    finishVoice(o, [car, mod], nodes, env, t, end);
  }
  function noise(o, {
    at = 0,
    dur = 0.2,
    color = "white",
    type = "bandpass",
    f = 1e3,
    f2 = 0,
    glide,
    q = 1,
    a = 4e-3,
    vol = 0.2,
    rate = 1,
    shape,
    r,
    verb,
    pan
  } = {}) {
    if (vol <= 0) return;
    const t = o.t + at, env = ctx.createGain();
    const src = ctx.createBufferSource();
    src.buffer = NB[color] || NB.white;
    src.loop = true;
    src.playbackRate.value = rate;
    const nodes = [env, src];
    if (type !== "none") {
      const fl = addFilter(t, { type, f, f2, q, glide }, dur, o.p, nodes);
      src.connect(fl);
      fl.connect(env);
    } else src.connect(env);
    src.start(t, Math.random() * 1.8);
    const end = envAt(env, t, dur, vol, a, shape, r);
    route(o, env, nodes, verb, pan);
    finishVoice(o, [src], nodes, env, t, end);
  }
  function mkOut(dry, wet, vol = 1, pan = 0, lp = 0) {
    const nodes = [];
    const out = gainNode(vol);
    nodes.push(out);
    let n = out;
    if (lp) {
      const f = biquad("lowpass", lp, 0.5);
      n.connect(f);
      n = f;
      nodes.push(f);
    }
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      n.connect(p);
      n = p;
      nodes.push(p);
    }
    n.connect(dry);
    const w = gainNode(vol, wet);
    nodes.push(w);
    return { out, wet: w, nodes };
  }
  function releaseOut(o, nodes) {
    const ms = Math.max(0.3, o.end - ctx.currentTime + 0.4) * 1e3;
    setTimeout(() => disconnectAll(nodes), ms);
  }
  function group(dest, wetDest, level = 1, fadeIn = 0.4) {
    const g = { fade: gainNode(0, dest), wet: wetDest ? gainNode(0, wetDest) : null, srcs: [], nodes: [], level, dead: false };
    g.nodes.push(g.fade, g.wet);
    const t = ctx.currentTime;
    g.fade.gain.setValueAtTime(0, t);
    g.fade.gain.linearRampToValueAtTime(level, t + fadeIn);
    if (g.wet) {
      g.wet.gain.setValueAtTime(0, t);
      g.wet.gain.linearRampToValueAtTime(level, t + fadeIn);
    }
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
    for (const s of g.srcs) {
      try {
        s.stop(t + fade + 0.05);
      } catch (e) {
      }
    }
    setTimeout(() => disconnectAll(g.nodes), (fade + 0.3) * 1e3);
  }
  function gNoise(g, color, dest, level, filt) {
    const src = ctx.createBufferSource();
    src.buffer = NB[color];
    src.loop = true;
    const amp = gainNode(level, dest || g.fade);
    const fls = (filt ? [].concat(filt) : []).map((f) => biquad(f.type || "lowpass", f.f, f.q ?? 0.7));
    let n = src;
    for (const f of fls) {
      n.connect(f);
      n = f;
    }
    n.connect(amp);
    src.start(ctx.currentTime, Math.random() * 1.8);
    g.srcs.push(src);
    g.nodes.push(src, amp, ...fls);
    return { src, amp, fl: fls[0] || null, fls };
  }
  function gOsc(g, type, f, dest, level, filt, detune = 0) {
    const osc = ctx.createOscillator();
    if (WAVES[type]) osc.setPeriodicWave(WAVES[type]);
    else osc.type = type;
    osc.frequency.value = f;
    osc.detune.value = detune;
    const amp = gainNode(level, dest || g.fade);
    let fl = null;
    if (filt) {
      fl = biquad(filt.type || "lowpass", filt.f, filt.q ?? 0.7, amp);
      osc.connect(fl);
    } else osc.connect(amp);
    osc.start();
    g.srcs.push(osc);
    g.nodes.push(osc, amp, fl);
    return { osc, amp, fl };
  }
  function gLfo(g, rate, depth, param, type = "sine") {
    const l = ctx.createOscillator();
    l.type = type;
    l.frequency.value = rate;
    const d = gainNode(depth, param);
    l.connect(d);
    l.start();
    g.srcs.push(l);
    g.nodes.push(l, d);
    return { osc: l, depth: d };
  }
  function runEvents(evs, t0, horizon) {
    for (const e of evs) {
      if (e.next === void 0 || e.next < t0 - 0.5) e.next = t0 + (e.first ?? rand(e.min, e.max));
      let guard = 0;
      while (e.next < horizon && guard++ < 16) {
        e.fn(Math.max(e.next, t0));
        e.next += rand(e.min, e.max);
      }
    }
  }
  var bub = (o, at, f, vol = 0.1, pan = 0, dur = 0.06) => tone(o, { at, f, f2: f * 2.3, glide: dur * 0.85, dur, a: 3e-3, vol, pan });
  var bell = (o, f, at = 0, vol = 0.1, dur = 1.4, verb) => fm(o, { f, at, ratio: 3.5, index: 2.2, index2: 0.15, idur: dur * 0.35, dur, a: 2e-3, vol, verb });
  var chime = (o, f, at = 0, vol = 0.1, dur = 0.8, verb) => fm(o, { f, at, ratio: 2, index: 1.3, index2: 0.1, idur: dur * 0.3, dur, a: 2e-3, vol, verb });
  var mallet = (o, f, at = 0, vol = 0.1, dur = 0.6, verb) => fm(o, { f, at, ratio: 4, index: 1.8, idur: 0.05, dur, a: 2e-3, vol, verb });
  var tink = (o, f, at = 0, vol = 0.08, pan = 0) => {
    fm(o, { f, at, ratio: 2.76, index: 1.6, index2: 0.2, idur: 0.05, dur: 0.22, a: 1e-3, vol, pan });
    tone(o, { f: f * 1.5, at, dur: 0.08, vol: vol * 0.35, pan });
  };
  var whoosh = (o, at, dur, f1, f2, vol, q = 1.1, color = "pink") => noise(o, { at, dur, color, type: "bandpass", f: f1, f2, q, a: dur * 0.45, vol, shape: "lin" });
  var thump = (o, at, f, vol) => {
    tone(o, { at, f, f2: f * 0.45, glide: 0.09, dur: 0.16, vol, a: 2e-3 });
    noise(o, { at, dur: 0.05, type: "lowpass", f: 500, color: "pink", vol: vol * 0.5 });
  };
  var tick = (o, at, f, vol) => {
    noise(o, { at, dur: 0.012, type: "highpass", f, vol, a: 8e-4 });
  };
  var droplets = (o, n, at, spread, vol = 0.04, lo = 1400, hi = 3e3) => {
    for (let i = 0; i < n; i++) bub(o, at + Math.random() * spread, rand(lo, hi), vol * rand(0.5, 1), rand(-0.6, 0.6), rand(0.03, 0.05));
  };
  var arp = (o, fn, notes, step2, at = 0, vol = 0.1, dur) => notes.forEach((m, i) => fn(o, m2f(m), at + i * step2, vol, dur));
  var SFX = {
    // UI
    ui_click: (o) => {
      tone(o, { f: 1250, f2: 820, glide: 0.035, dur: 0.06, type: "triangle", vol: 0.11, a: 1e-3 });
      tick(o, 0, 4500, 0.04);
    },
    ui_hover: (o) => {
      tone(o, { f: 2100, f2: 2350, glide: 0.02, dur: 0.035, vol: 0.045, a: 2e-3 });
    },
    ui_open: (o) => {
      tone(o, { f: 480, f2: 760, glide: 0.07, dur: 0.13, vol: 0.14 });
      chime(o, 1046, 0.05, 0.06, 0.35);
      bub(o, 0.02, 900, 0.04);
    },
    ui_close: (o) => {
      tone(o, { f: 760, f2: 430, glide: 0.08, dur: 0.12, vol: 0.13 });
      tick(o, 0.06, 3500, 0.03);
    },
    ui_buy: (o) => {
      chime(o, 1318, 0, 0.1, 0.4);
      chime(o, 1760, 0.075, 0.1, 0.7, 0.25);
      tink(o, 2637, 0.1, 0.03);
      noise(o, { at: 0.06, dur: 0.3, type: "highpass", f: 6500, vol: 0.04, a: 0.02 });
    },
    ui_error: (o) => {
      for (const at of [0, 0.11]) tone(o, { at, f: 230, f2: 190, glide: 0.08, dur: 0.1, type: "square", vol: 0.09, filt: { type: "lowpass", f: 900 } });
    },
    ui_unlock: (o) => {
      arp(o, bell, [84, 88, 91, 96], 0.065, 0, 0.07, 1);
      noise(o, { at: 0.18, dur: 0.6, type: "highpass", f: 7e3, vol: 0.035, a: 0.1 });
    },
    ui_page: (o) => {
      noise(o, { dur: 0.13, type: "bandpass", f: 2800, f2: 1300, q: 0.9, a: 0.025, vol: 0.2 });
      noise(o, { at: 0.05, dur: 0.06, type: "highpass", f: 4e3, vol: 0.05 });
    },
    ui_toggle: (o) => {
      tone(o, { f: 880, dur: 0.035, type: "triangle", vol: 0.11, a: 1e-3 });
      tone(o, { at: 0.045, f: 1320, dur: 0.05, type: "triangle", vol: 0.1, a: 1e-3 });
    },
    ui_tab: (o) => {
      tone(o, { f: 1560, f2: 1480, dur: 0.045, vol: 0.09, a: 1e-3 });
      tick(o, 0, 5e3, 0.035);
    },
    ui_type: (o) => {
      const k = rand(0.9, 1.12);
      noise(o, { dur: 0.025, type: "bandpass", f: 3200 * k, q: 2.5, vol: 0.28, a: 1e-3 });
      tone(o, { f: 1900 * k, dur: 0.018, type: "triangle", vol: 0.025, a: 1e-3 });
    },
    notify: (o) => {
      chime(o, 784, 0, 0.09, 0.6, 0.3);
      chime(o, 1046, 0.11, 0.09, 0.9, 0.3);
    },
    // desktop
    icon_pickup: (o) => {
      tone(o, { f: 380, f2: 820, glide: 0.07, dur: 0.1, vol: 0.14 });
      tone(o, { f: 760, f2: 1640, glide: 0.07, dur: 0.06, vol: 0.03, type: "triangle" });
    },
    icon_drop: (o) => {
      tone(o, { f: 620, f2: 240, glide: 0.08, dur: 0.11, vol: 0.15 });
      noise(o, { dur: 0.04, type: "lowpass", f: 1200, vol: 0.12, color: "pink" });
    },
    icon_box: (o) => {
      thump(o, 0, 170, 0.22);
      noise(o, { dur: 0.09, type: "lowpass", f: 700, vol: 0.18, color: "brown" });
      bub(o, 0.07, 650, 0.08);
      bub(o, 0.12, 900, 0.05);
    },
    window_open: (o) => {
      whoosh(o, 0, 0.18, 500, 2400, 0.14);
      tone(o, { at: 0.05, f: 660, f2: 990, glide: 0.06, dur: 0.12, vol: 0.08 });
    },
    window_close: (o) => {
      whoosh(o, 0, 0.15, 2400, 600, 0.12);
      tone(o, { f: 880, f2: 520, glide: 0.08, dur: 0.1, vol: 0.08 });
    },
    window_min: (o) => {
      tone(o, { f: 900, f2: 300, glide: 0.12, dur: 0.15, vol: 0.09, type: "triangle" });
      whoosh(o, 0, 0.12, 1800, 500, 0.07);
    },
    box_open: (o) => {
      noise(o, { dur: 0.1, type: "lowpass", f: 900, vol: 0.2, color: "pink", a: 8e-3 });
      noise(o, { at: 0.05, dur: 0.16, type: "bandpass", f: 420, q: 1.5, vol: 0.25, color: "brown", a: 0.02 });
      tone(o, { at: 0.03, f: 150, f2: 230, glide: 0.1, dur: 0.12, vol: 0.07, type: "triangle" });
    },
    box_close: (o) => {
      thump(o, 0, 150, 0.24);
      noise(o, { dur: 0.08, type: "lowpass", f: 500, vol: 0.2, color: "brown" });
    },
    // fishing
    cast: (o) => {
      whoosh(o, 0, 0.32, 450, 2600, 0.45, 1.4);
      for (let i = 0; i < 12; i++) tick(o, 0.05 + i * 0.022 * (1 + i * 0.12), 3800, 0.09 * (1 - i / 14));
      tone(o, { at: 0.04, f: 1500, f2: 900, glide: 0.4, dur: 0.42, type: "triangle", vol: 0.012, vib: [30, 40] });
    },
    splash_small: (o) => {
      bub(o, 0, 520, 0.12, 0, 0.07);
      noise(o, { dur: 0.16, type: "bandpass", f: 1900, f2: 900, q: 0.8, vol: 0.25 });
      droplets(o, 3, 0.05, 0.18, 0.04);
    },
    splash_big: (o) => {
      noise(o, { dur: 0.55, type: "lowpass", f: 3500, f2: 700, q: 0.6, vol: 0.4, a: 6e-3 });
      noise(o, { dur: 0.45, type: "bandpass", f: 380, q: 0.8, vol: 0.35, color: "brown", a: 0.01 });
      tone(o, { f: 260, f2: 75, glide: 0.2, dur: 0.26, vol: 0.18 });
      droplets(o, 7, 0.1, 0.5, 0.05);
    },
    nibble: (o) => {
      for (const at of [0, 0.08]) tone(o, { at, f: 760, f2: 520, glide: 0.04, dur: 0.05, vol: 0.09 });
      noise(o, { dur: 0.04, type: "bandpass", f: 2200, q: 1.5, vol: 0.16 });
    },
    bite: (o) => {
      tone(o, { f: 320, f2: 110, glide: 0.12, dur: 0.17, vol: 0.24 });
      noise(o, { dur: 0.14, type: "bandpass", f: 1300, f2: 600, q: 0.9, vol: 0.3 });
      chime(o, 1318, 0.03, 0.08, 0.35);
      droplets(o, 3, 0.06, 0.15, 0.04);
    },
    hookset: (o) => {
      noise(o, { dur: 0.11, type: "bandpass", f: 1400, f2: 5200, q: 1.2, vol: 0.3 });
      tone(o, { f: 280, f2: 900, glide: 0.06, dur: 0.1, vol: 0.12, type: "triangle" });
      thump(o, 0.01, 150, 0.22);
    },
    reel: (o) => {
      for (let i = 0; i < 9; i++) {
        const at = i * 0.045 * (1 - i * 0.04);
        tick(o, at, 3e3 + i % 2 * 600, 0.16);
        tone(o, { at, f: i % 2 ? 2700 : 2300, dur: 0.01, type: "triangle", vol: 0.04, a: 8e-4 });
      }
      noise(o, { dur: 0.4, type: "bandpass", f: 900, f2: 1600, q: 1.5, color: "pink", vol: 0.12, a: 0.05, shape: "lin" });
    },
    reel_tick: (o) => {
      tick(o, 0, 3200, 0.2);
      tone(o, { f: 2600, dur: 0.012, vol: 0.05, type: "triangle", a: 8e-4 });
    },
    line_snap: (o) => {
      noise(o, { dur: 0.06, type: "highpass", f: 2200, vol: 0.3, a: 1e-3 });
      tone(o, { f: 230, f2: 105, glide: 0.45, dur: 0.55, type: "sawtooth", vol: 0.07, vib: [9, 6], filt: { type: "lowpass", f: 1800, f2: 400 } });
      tone(o, { at: 0.02, f: 950, f2: 160, glide: 0.3, dur: 0.33, vol: 0.06 });
    },
    escape: (o) => {
      [620, 470, 350].forEach((f, i) => tone(o, { at: i * 0.12, f, f2: f * 0.75, glide: 0.08, dur: 0.11, vol: 0.11 }));
      noise(o, { at: 0.3, dur: 0.2, type: "bandpass", f: 1400, q: 0.8, vol: 0.25 });
      droplets(o, 3, 0.32, 0.2, 0.035);
    },
    catch: (o) => {
      arp(o, mallet, [72, 76, 79, 84], 0.075, 0, 0.13, 0.5);
      mallet(o, m2f(88), 0.3, 0.09, 0.9);
      chime(o, m2f(91), 0.3, 0.04, 0.9);
      noise(o, { dur: 0.25, type: "bandpass", f: 1800, q: 0.8, vol: 0.2 });
    },
    catch_rare: (o) => {
      arp(o, mallet, [72, 76, 79, 83, 86], 0.065, 0, 0.11, 0.6);
      arp(o, bell, [88, 91, 95], 0.07, 0.33, 0.05, 1.3);
      noise(o, { at: 0.3, dur: 0.8, type: "highpass", f: 7e3, vol: 0.04, a: 0.15 });
    },
    catch_epic: (o) => {
      [60, 64, 67, 71, 74].forEach((m) => tone(o, { f: m2f(m), dur: 1.6, type: "sawtooth", unison: [-7, 7], vol: 0.025, a: 0.25, shape: "sus", r: 0.9, filt: { type: "lowpass", f: 500, f2: 2600, glide: 0.8 } }));
      arp(o, mallet, [72, 76, 79, 83, 84, 88, 91, 95], 0.055, 0.05, 0.09, 0.6);
      bell(o, m2f(96), 0.5, 0.07, 1.8, 0.5);
      whoosh(o, 0, 0.5, 300, 3e3, 0.18);
      noise(o, { at: 0.4, dur: 1, type: "highpass", f: 7500, vol: 0.045, a: 0.2 });
    },
    catch_legendary: (o) => {
      const stab = (at, notes, d = 0.35) => notes.forEach((m) => tone(o, { at, f: m2f(m), dur: d, type: "sawtooth", unison: [-9, 9], vol: 0.028, a: 0.012, shape: "sus", r: 0.15, filt: { type: "lowpass", f: 2600, f2: 1200, q: 1 } }));
      stab(0, [60, 64, 67, 72], 0.2);
      stab(0.22, [60, 64, 67, 72], 0.2);
      stab(0.45, [65, 69, 72, 77], 0.22);
      stab(0.7, [67, 71, 74, 79], 0.22);
      stab(0.95, [60, 64, 67, 72, 76], 1.6);
      thump(o, 0, 110, 0.25);
      thump(o, 0.95, 90, 0.3);
      arp(o, bell, [84, 88, 91, 96, 100], 0.07, 1, 0.06, 1.6);
      arp(o, mallet, [72, 76, 79, 84, 88, 91, 96], 0.04, 0.95, 0.05, 0.5);
      noise(o, { at: 0.95, dur: 1.6, type: "highpass", f: 7e3, vol: 0.05, a: 0.3 });
      whoosh(o, 0.6, 0.45, 400, 3500, 0.2);
    },
    new_species: (o) => {
      arp(o, chime, [79, 84, 88, 91], 0.09, 0, 0.12, 0.9);
      bell(o, m2f(96), 0.38, 0.08, 1.6, 0.45);
      [67, 72, 76].forEach((m) => tone(o, { at: 0.3, f: m2f(m), dur: 1.4, type: "triangle", vol: 0.03, a: 0.2, shape: "sus", r: 0.8 }));
      noise(o, { at: 0.35, dur: 0.9, type: "highpass", f: 7e3, vol: 0.04, a: 0.2 });
    },
    record: (o) => {
      arp(o, mallet, [84, 86, 88, 91], 0.05, 0, 0.1, 0.4);
      chime(o, m2f(96), 0.22, 0.09, 0.8, 0.3);
      chime(o, m2f(96), 0.36, 0.06, 0.9, 0.35);
      tink(o, m2f(103), 0.24, 0.025);
    },
    net_swish: (o) => {
      whoosh(o, 0, 0.32, 380, 1900, 0.5, 1.2);
      noise(o, { at: 0.2, dur: 0.2, type: "bandpass", f: 900, q: 0.8, vol: 0.2 });
      droplets(o, 3, 0.22, 0.2, 0.03);
    },
    mash_pop: (o) => {
      const k = rand(0.95, 1.06);
      tone(o, { f: 420 * k, f2: 1150 * k, glide: 0.04, dur: 0.065, vol: 0.15, a: 2e-3 });
      tick(o, 0, 3e3, 0.04);
    },
    timing_good: (o) => {
      chime(o, 880, 0, 0.13, 0.35);
      tone(o, { f: 1760, dur: 0.12, vol: 0.025 });
    },
    timing_perfect: (o) => {
      chime(o, 1318, 0, 0.12, 0.4);
      chime(o, 1760, 0.055, 0.1, 0.6, 0.3);
      noise(o, { dur: 0.25, type: "highpass", f: 7500, vol: 0.06, a: 0.01 });
      tink(o, 2637, 0.06, 0.025);
    },
    timing_miss: (o) => {
      tone(o, { f: 210, f2: 150, glide: 0.1, dur: 0.13, vol: 0.13, type: "triangle", filt: { type: "lowpass", f: 700 } });
      noise(o, { dur: 0.05, type: "lowpass", f: 400, vol: 0.2, color: "pink" });
    },
    dodge_hit: (o) => {
      tone(o, { f: 320, f2: 95, glide: 0.11, dur: 0.15, type: "square", vol: 0.07, filt: { type: "lowpass", f: 1400, f2: 400 } });
      noise(o, { dur: 0.09, type: "bandpass", f: 1100, q: 1, vol: 0.3 });
    },
    slack_warn: (o) => {
      for (const at of [0, 0.15]) tone(o, { at, f: 640, f2: 540, glide: 0.1, dur: 0.12, type: "triangle", vol: 0.11, vib: [14, 12] });
    },
    jump_out: (o) => {
      noise(o, { dur: 0.22, type: "bandpass", f: 1100, f2: 3200, q: 0.9, vol: 0.3, a: 0.01 });
      tone(o, { f: 300, f2: 950, glide: 0.15, dur: 0.18, vol: 0.09 });
      droplets(o, 5, 0.08, 0.35, 0.045);
    },
    // fish voices
    blub: (o) => {
      bub(o, 0, 240, 0.16, 0, 0.09);
      bub(o, 0.1, 210, 0.12, 0, 0.08);
      tone(o, { f: 180, f2: 140, dur: 0.12, vol: 0.05, type: "triangle" });
    },
    honk: (o) => {
      tone(o, { f: [[0, 300], [0.05, 360], [0.22, 320]], dur: 0.24, type: "sawtooth", unison: [-10, 10], vol: 0.12, a: 0.015, shape: "sus", r: 0.06, vib: [7, 6], filt: { type: "bandpass", f: 1100, q: 1.6 } });
      tone(o, { f: 150, dur: 0.22, type: "square", vol: 0.03, a: 0.015, shape: "sus", r: 0.05, filt: { type: "lowpass", f: 600 } });
    },
    puff: (o) => {
      noise(o, { dur: 0.38, type: "bandpass", f: 500, f2: 2200, q: 2, a: 0.25, vol: 0.3, shape: "lin" });
      tone(o, { f: 200, f2: 620, glide: 0.36, dur: 0.4, vol: 0.09, a: 0.2, shape: "lin" });
      bub(o, 0.38, 700, 0.08);
    },
    deflate: (o) => {
      tone(o, { f: 680, f2: 140, glide: 0.5, dur: 0.55, type: "sawtooth", vol: 0.1, vib: [26, 40], filt: { type: "lowpass", f: 1100, f2: 500 }, a: 0.01, shape: "sus", r: 0.15 });
      noise(o, { dur: 0.5, type: "bandpass", f: 900, f2: 400, q: 1.2, vol: 0.2, a: 0.02, shape: "lin" });
    },
    squeak: (o) => {
      tone(o, { f: [[0, 1400], [0.05, 2100], [0.13, 1700]], dur: 0.14, vol: 0.11, a: 6e-3, vib: [22, 60] });
    },
    grunt: (o) => {
      tone(o, { f: 115, f2: 88, glide: 0.18, dur: 0.2, type: "sawtooth", vol: 0.14, a: 0.012, vib: [17, 8], filt: { type: "lowpass", f: 520, q: 2 }, shape: "sus", r: 0.07 });
    },
    boing: (o) => {
      tone(o, { f: 190, f2: 330, glide: 0.07, dur: 0.45, type: "triangle", vol: 0.14, vib: [13, 35], a: 3e-3 });
      tone(o, { f: 380, f2: 660, glide: 0.07, dur: 0.2, vol: 0.03 });
    },
    glitch: (o) => {
      for (let i = 0; i < 7; i++) tone(o, { at: i * 0.028, f: pick([220, 330, 440, 880, 1320, 1760, 2640]) * rand(0.98, 1.02), dur: 0.026, wave: "pulse25", vol: 0.07, a: 1e-3, shape: "sus", r: 4e-3 });
      noise(o, { at: 0.08, dur: 0.06, type: "highpass", f: 3e3, vol: 0.07, a: 1e-3, shape: "sus", r: 0.01 });
    },
    click: (o) => {
      for (let i = 0; i < 3; i++) {
        noise(o, { at: i * 0.032, dur: 8e-3, type: "highpass", f: 3500, vol: 0.2, a: 5e-4 });
        tone(o, { at: i * 0.032, f: 3100, dur: 6e-3, vol: 0.04, a: 5e-4 });
      }
    },
    roar: (o) => {
      tone(o, { f: 82, f2: 58, glide: 0.8, dur: 0.85, type: "sawtooth", unison: [-12, 12], vol: 0.12, a: 0.09, vib: [7, 4], filt: { type: "lowpass", f: 420, f2: 900, glide: 0.3, q: 2 }, shape: "sus", r: 0.35 });
      noise(o, { dur: 0.8, type: "lowpass", f: 900, f2: 400, vol: 0.25, a: 0.08, color: "pink", shape: "sus", r: 0.35 });
      tone(o, { f: 52, f2: 40, dur: 0.8, vol: 0.12, a: 0.08, shape: "sus", r: 0.3 });
    },
    chirp: (o) => {
      tone(o, { f: 1800, f2: 3200, glide: 0.07, dur: 0.09, vol: 0.1, a: 5e-3 });
      tone(o, { at: 0.1, f: 3e3, f2: 2200, glide: 0.07, dur: 0.08, vol: 0.075 });
    },
    bell: (o) => {
      bell(o, 1046, 0, 0.09, 1.3, 0.45);
      fm(o, { f: 2093, ratio: 1.41, index: 0.6, idur: 0.1, dur: 0.5, vol: 0.02 });
    },
    gulp: (o) => {
      tone(o, { f: 420, f2: 140, glide: 0.08, dur: 0.12, vol: 0.13 });
      noise(o, { dur: 0.05, type: "lowpass", f: 600, vol: 0.2, color: "pink" });
    },
    snore: (o) => {
      noise(o, { dur: 0.9, type: "bandpass", f: 320, f2: 600, q: 3, a: 0.45, vol: 0.4, shape: "lin", color: "pink" });
      tone(o, { dur: 0.9, f: 85, f2: 95, type: "sawtooth", vol: 0.035, a: 0.4, shape: "lin", filt: { type: "lowpass", f: 300 }, vib: [22, 4] });
      noise(o, { at: 1, dur: 0.5, type: "bandpass", f: 700, f2: 300, q: 2, a: 0.08, vol: 0.22, shape: "lin" });
    },
    // coins
    coin_spawn: (o) => {
      fm(o, { f: 1568, ratio: 2, index: 1, idur: 0.05, dur: 0.16, vol: 0.06 });
      tone(o, { f: 800, f2: 1600, glide: 0.05, dur: 0.06, vol: 0.04 });
    },
    coin_bounce: (o) => {
      tink(o, 2093 * rand(0.96, 1.04), 0, 0.08);
    },
    coin_collect: (o) => {
      const t = ctx.currentTime;
      combo.n = t - combo.t < 0.6 ? Math.min(combo.n + 1, COMBO.length - 1) : 0;
      combo.t = t;
      const k = Math.pow(2, COMBO[combo.n] / 12);
      chime(o, 988 * k, 0, 0.1, 0.1);
      chime(o, 1318 * k, 0.065, 0.12, 0.45);
      tone(o, { at: 0.065, f: 1318 * k, dur: 0.22, type: "square", vol: 0.012, filt: { type: "lowpass", f: 3500, track: false } });
    },
    coin_pile: (o) => {
      for (let i = 0; i < 9; i++) tink(o, rand(1800, 3200), Math.random() * 0.4, rand(0.04, 0.07), rand(-0.4, 0.4));
      noise(o, { dur: 0.12, type: "lowpass", f: 900, vol: 0.18, color: "pink" });
    },
    coins_many: (o) => {
      for (let i = 0; i < 16; i++) tink(o, rand(1700, 3400), i * 0.045 + Math.random() * 0.03, rand(0.035, 0.06), rand(-0.6, 0.6));
      chime(o, 1318, 0.75, 0.07, 0.5);
      chime(o, 1760, 0.82, 0.07, 0.8, 0.3);
    },
    // world
    bubble: (o) => {
      bub(o, 0, rand(380, 650), 0.12, 0, rand(0.05, 0.08));
    },
    bubbles: (o) => {
      const n = 6 + (Math.random() * 5 | 0);
      for (let i = 0; i < n; i++) bub(o, Math.random() * 0.6, rand(300, 900), rand(0.06, 0.11), rand(-0.5, 0.5), rand(0.04, 0.08));
    },
    whale_call: (o) => {
      const b = rand(0.92, 1.08);
      tone(o, { f: [[0, 210 * b], [0.7, 320 * b], [1.6, 290 * b], [2.4, 190 * b]], dur: 2.5, vol: 0.1, a: 0.5, shape: "sus", r: 0.8, vib: [4.5, 5], verb: 0.7 });
      tone(o, { f: [[0, 420 * b], [0.7, 640 * b], [1.6, 580 * b], [2.4, 380 * b]], dur: 2.4, type: "triangle", vol: 0.025, a: 0.6, shape: "sus", r: 0.8, verb: 0.8 });
    },
    thunder: (o) => {
      noise(o, { dur: 0.35, type: "lowpass", f: 3200, f2: 400, vol: 0.35, a: 4e-3 });
      for (let i = 0; i < 4; i++) noise(o, { at: 0.05 + i * rand(0.25, 0.5), dur: rand(1.2, 2.2), type: "lowpass", f: rand(160, 320), q: 0.8, color: "brown", vol: rand(0.3, 0.45), a: rand(0.04, 0.2) });
    },
    crab_scuttle: (o) => {
      for (let i = 0; i < 9; i++) {
        const at = i * 0.034 + Math.random() * 8e-3, pan = i % 2 ? 0.15 : -0.15;
        noise(o, { at, dur: 0.014, type: "bandpass", f: i % 2 ? 3200 : 2500, q: 3, vol: 0.9, a: 6e-4, pan });
        tone(o, { at, f: i % 2 ? 2900 : 2300, dur: 0.012, type: "triangle", vol: 0.05, a: 6e-4, pan });
      }
    },
    vending: (o) => {
      tone(o, { f: 110, dur: 0.6, type: "sawtooth", vol: 0.06, a: 0.05, shape: "sus", r: 0.1, vib: [9, 3], filt: { type: "lowpass", f: 380 } });
      noise(o, { dur: 0.6, type: "bandpass", f: 600, q: 1, vol: 0.1, a: 0.05, shape: "sus", r: 0.1 });
      thump(o, 0.62, 130, 0.25);
      noise(o, { at: 0.62, dur: 0.1, type: "lowpass", f: 1500, vol: 0.25, color: "pink" });
      tink(o, 1200, 0.64, 0.04);
      chime(o, 1046, 0.82, 0.08, 0.5);
      chime(o, 1318, 0.9, 0.08, 0.7, 0.25);
    },
    sonar: (o) => {
      tone(o, { f: 1180, dur: 1.4, vol: 0.12, a: 4e-3, verb: 0.75 });
      tone(o, { at: 4e-3, f: 2360, dur: 0.25, vol: 0.02 });
      tone(o, { at: 0.6, f: 1180, dur: 0.9, vol: 0.03, verb: 0.9 });
    },
    static_burst: (o) => {
      for (let i = 0; i < 6; i++) noise(o, { at: i * 0.045 + Math.random() * 0.02, dur: rand(0.03, 0.08), type: "bandpass", f: rand(1800, 4200), q: 0.6, vol: rand(0.1, 0.22), a: 2e-3, shape: "sus", r: 0.01 });
      tone(o, { f: 120, dur: 0.32, type: "sawtooth", vol: 0.02, filt: { type: "lowpass", f: 500 }, shape: "sus", r: 0.05 });
    },
    crt_on: (o) => {
      thump(o, 0, 90, 0.18);
      noise(o, { dur: 0.15, type: "highpass", f: 2500, vol: 0.12, a: 2e-3 });
      tone(o, { f: 180, f2: 1400, glide: 0.25, dur: 0.3, vol: 0.04, type: "triangle" });
      tone(o, { at: 0.05, f: 7800, dur: 0.7, vol: 5e-3, a: 0.08, shape: "sus", r: 0.3 });
      tone(o, { f: 60, dur: 0.6, type: "sawtooth", vol: 0.025, a: 0.03, filt: { type: "lowpass", f: 300 } });
    },
    treasure_open: (o) => {
      tone(o, { f: [[0, 110], [0.25, 150], [0.4, 135]], dur: 0.42, type: "sawtooth", vol: 0.05, a: 0.02, vib: [21, 5], filt: { type: "bandpass", f: 800, q: 3 }, shape: "sus", r: 0.06 });
      thump(o, 0.42, 160, 0.18);
      arp(o, chime, [79, 83, 86, 91, 95], 0.06, 0.45, 0.075, 0.8);
      bell(o, m2f(98), 0.75, 0.05, 1.5, 0.5);
      noise(o, { at: 0.45, dur: 1, type: "highpass", f: 7e3, vol: 0.045, a: 0.2 });
    },
    sparkle: (o) => {
      for (let i = 0; i < 6; i++) fm(o, { at: i * 0.06 + Math.random() * 0.04, f: rand(2200, 4800), ratio: 3.01, index: 1, idur: 0.05, dur: 0.25, vol: rand(0.05, 0.08), verb: 0.4, pan: rand(-0.5, 0.5) });
    },
    magic: (o) => {
      tone(o, { f: 380, f2: 1600, glide: 0.6, dur: 0.65, vol: 0.05, a: 0.1, vib: [6, 10], shape: "sus", r: 0.25, verb: 0.4 });
      arp(o, bell, [79, 81, 84, 88, 91, 93], 0.07, 0.1, 0.05, 0.9);
      whoosh(o, 0, 0.6, 600, 4e3, 0.15);
    },
    flood_rush: (o) => {
      noise(o, { dur: 1.6, type: "lowpass", f: 400, f2: 2600, glide: 0.8, vol: 0.32, a: 0.45, shape: "sus", r: 0.7, color: "pink" });
      noise(o, { dur: 1.6, type: "lowpass", f: 260, vol: 0.32, color: "brown", a: 0.3, shape: "sus", r: 0.8 });
      for (let i = 0; i < 10; i++) bub(o, 0.3 + Math.random() * 1.1, rand(250, 700), rand(0.04, 0.07), rand(-0.6, 0.6), rand(0.05, 0.09));
    },
    worm_squish: (o) => {
      for (const at of [0, 0.13]) {
        noise(o, { at, dur: 0.12, type: "bandpass", f: 900, f2: 380, q: 4, vol: 0.8, a: 0.01 });
        tone(o, { at, f: 320, f2: 190, glide: 0.1, dur: 0.11, vol: 0.1, vib: [32, 25] });
      }
    },
    golden_shimmer: (o) => {
      [84, 88, 91, 95].forEach((m, i) => {
        bell(o, m2f(m), i * 0.04, 0.035, 1.5, 0.5);
        bell(o, m2f(m) * 1.004, 0.25 + i * 0.05, 0.025, 1.3, 0.5);
      });
      noise(o, { dur: 1.3, type: "highpass", f: 8e3, vol: 0.05, a: 0.35, shape: "lin" });
    },
    travel_whoosh: (o) => {
      whoosh(o, 0, 1.1, [[0, 280], [0.6, 3200], [1.1, 900]], 0, 0.3, 0.9);
      tone(o, { f: 80, f2: 160, glide: 0.9, dur: 1, vol: 0.08, a: 0.4, shape: "lin" });
      droplets(o, 5, 0.3, 0.6, 0.03, 900, 2200);
    },
    arrive: (o) => {
      whoosh(o, 0, 0.45, 2200, 500, 0.15);
      [79, 84, 88].forEach((m, i) => chime(o, m2f(m), 0.18 + i * 0.07, 0.07, 1, 0.35));
      bub(o, 0.15, 500, 0.06);
    },
    unlock_biome: (o) => {
      [60, 67, 71, 74, 76].forEach((m) => tone(o, { f: m2f(m), dur: 2.4, type: "sawtooth", unison: [-8, 8], vol: 0.022, a: 0.8, shape: "sus", r: 1.1, filt: { type: "lowpass", f: 300, f2: 3e3, glide: 1.6 }, verb: 0.4 }));
      thump(o, 0, 70, 0.3);
      noise(o, { dur: 2.2, type: "lowpass", f: 200, f2: 1200, color: "brown", vol: 0.3, a: 0.9, shape: "lin" });
      arp(o, bell, [76, 79, 83, 88, 91, 95], 0.09, 0.9, 0.05, 1.5);
      noise(o, { at: 0.9, dur: 1.4, type: "highpass", f: 7e3, vol: 0.05, a: 0.3 });
    }
  };
  var COMBO = [0, 2, 4, 7, 9, 12, 14, 16, 19];
  var combo = { n: 0, t: -1 };
  var MIN_GAP = { reel: 0.25, ui_type: 0.02, reel_tick: 0.012, coin_bounce: 0.02, coin_collect: 0.02, mash_pop: 0.02, ui_hover: 0.04 };
  var VERB = { sonar: 0.35, whale_call: 0.4, bell: 0.3, thunder: 0.3, ui_hover: 0, ui_click: 0.04, ui_type: 0, reel_tick: 0, ui_tab: 0.04, click: 0.15 };
  function fire(fn, t, { dry, wet, pool = "sfx", vol = 1, pan = 0, lp = 0, p = 1, verb = 0.12 } = {}) {
    const m = mkOut(dry, wet, vol, pan, lp);
    const o = { t, p, out: m.out, wet: m.wet, verb, pool, end: t };
    fn(o);
    releaseOut(o, m.nodes);
    return o;
  }
  var LOOP_CAT = { rain: "amb", storm: "amb" };
  var activeLoops = /* @__PURE__ */ new Set();
  var pendingLoops = /* @__PURE__ */ new Set();
  var loopO = (g, pool = "sfx", verb = 0.1) => (t, p = 1) => ({ t, p, out: g.fade, wet: g.wet, verb, pool, end: 0 });
  var creak = (o, v) => tone(o, {
    f: rand(90, 150),
    f2: rand(70, 120),
    dur: rand(0.12, 0.25),
    type: "sawtooth",
    vol: 0.035 * v,
    vib: [rand(25, 40), 15],
    filt: { type: "bandpass", f: 900, q: 5 },
    a: 0.01
  });
  var LOOPS = {
    // taut line: whine rises in pitch, chopped noise grit and creaks grow with v
    tension(g) {
      const whine = gOsc(g, "sawtooth", 300, null, 0, { type: "lowpass", f: 900, q: 4 });
      const shim = gOsc(g, "sine", 602, null, 0);
      const vib = gLfo(g, 5.5, 3, whine.osc.frequency);
      vib.depth.connect(shim.osc.frequency);
      const gritAmp = gainNode(0, g.fade), chop = gainNode(0.5, gritAmp);
      g.nodes.push(gritAmp, chop);
      const gr = gNoise(g, "white", chop, 1, { type: "bandpass", f: 2400, q: 4 });
      const chopL = gLfo(g, 14, 0.5, chop.gain, "triangle");
      const o = loopO(g);
      let v = 0, next = 0;
      return {
        set(x) {
          v = x;
          const f = 220 * Math.pow(2, x * 1.7);
          ramp2(whine.osc.frequency, f, 0.08);
          ramp2(shim.osc.frequency, f * 2.01, 0.08);
          ramp2(whine.fl.frequency, f * 3, 0.08);
          ramp2(whine.amp.gain, 0.07 * Math.pow(x, 0.8), 0.08);
          ramp2(shim.amp.gain, 0.02 * x, 0.08);
          ramp2(vib.depth.gain, f * (4e-3 + 0.02 * x), 0.1);
          ramp2(gritAmp.gain, 0.2 * x * x, 0.08);
          ramp2(gr.fl.frequency, 1800 + 2200 * x, 0.1);
          ramp2(chopL.osc.frequency, 9 + 30 * x, 0.1);
        },
        tick(t0, h) {
          if (v < 0.25) {
            next = 0;
            return;
          }
          if (!next || next < t0) next = t0 + rand(0.4, 1.6) / v;
          if (next < h) {
            creak(o(next), v);
            next += rand(0.4, 1.6) / v;
          }
        }
      };
    },
    // crank ratchet: click rate follows v, plus a soft spool whir
    reel(g) {
      const whir = gNoise(g, "pink", null, 0, { type: "bandpass", f: 700, q: 1.5 });
      const hum = gOsc(g, "triangle", 90, null, 0, { type: "lowpass", f: 400 });
      const o = loopO(g, "sfx", 0);
      let v = 0, next = 0, n = 0;
      return {
        set(x) {
          v = x;
          ramp2(whir.amp.gain, 0.14 * x, 0.06);
          ramp2(whir.fl.frequency, 500 + 1500 * x, 0.06);
          ramp2(hum.amp.gain, 0.02 * x, 0.06);
          ramp2(hum.osc.frequency, 60 + 140 * x, 0.06);
        },
        tick(t0, h) {
          if (v < 0.02) {
            next = 0;
            return;
          }
          const iv = 1 / (3 + 27 * v);
          if (!next || next < t0) next = t0 + 5e-3;
          while (next < h) {
            const oo = o(next);
            tick(oo, 0, 3e3 + n % 2 * 600, 0.1 + 0.06 * v);
            tone(oo, { f: n % 2 ? 2700 : 2300, dur: 0.01, type: "triangle", vol: 0.03, a: 8e-4 });
            n++;
            next += iv;
          }
        }
      };
    },
    rain(g) {
      const hiss = gNoise(g, "pink", null, 0, [{ type: "highpass", f: 500 }, { type: "lowpass", f: 5500 }]);
      const patter = gNoise(g, "white", null, 0, { type: "bandpass", f: 3200, q: 0.6 });
      const o = loopO(g, "amb", 0.15);
      let v = 0, next = 0;
      return {
        set(x) {
          v = x;
          ramp2(hiss.amp.gain, 0.06 + 0.22 * x, 0.2);
          ramp2(patter.amp.gain, 0.015 + 0.06 * x, 0.2);
          ramp2(hiss.fls[1].frequency, 3e3 + 4e3 * x, 0.3);
        },
        tick(t0, h) {
          const iv = 1 / (3 + 22 * v);
          if (!next || next < t0) next = t0 + rand(0, iv);
          while (next < h) {
            bub(o(next), 0, rand(1600, 4200), rand(0.012, 0.028) * (0.5 + v), rand(-0.8, 0.8), rand(0.02, 0.035));
            next += iv * rand(0.3, 1.7);
          }
        }
      };
    },
    storm(g) {
      const rain = LOOPS.rain(g);
      const wind = gNoise(g, "brown", null, 0, { type: "bandpass", f: 420, q: 0.9 });
      gLfo(g, 0.09, 180, wind.fl.frequency);
      const rumble = gNoise(g, "brown", null, 0, { type: "lowpass", f: 140 });
      let v = 0, next = 0;
      return {
        set(x) {
          v = x;
          rain.set(0.6 + 0.4 * x);
          ramp2(wind.amp.gain, 0.06 + 0.25 * x, 0.3);
          ramp2(rumble.amp.gain, 0.05 + 0.2 * x, 0.3);
        },
        tick(t0, h) {
          rain.tick(t0, h);
          if (!next || next < t0) next = t0 + rand(3, 10);
          if (next < h) {
            fire(SFX.thunder, next, { dry: g.fade, wet: g.wet, pool: "amb", vol: rand(0.4, 0.9) * (0.4 + 0.6 * v), lp: rand(1500, 4e3), p: rand(0.85, 1.1), verb: 0.3 });
            next += rand(6, 18) / (0.3 + v);
          }
        }
      };
    },
    static(g) {
      const hiss = gNoise(g, "white", null, 0, { type: "bandpass", f: 3200, q: 0.4 });
      const hum = gOsc(g, "sawtooth", 60, null, 0, { type: "lowpass", f: 360 });
      const o = loopO(g, "sfx", 0);
      let v = 0, next = 0;
      return {
        set(x) {
          v = x;
          ramp2(hiss.amp.gain, 0.05 + 0.18 * x, 0.06);
          ramp2(hum.amp.gain, 0.012 + 0.02 * x, 0.1);
        },
        tick(t0, h) {
          const iv = 1 / (8 + 40 * v);
          if (!next || next < t0) next = t0;
          while (next < h) {
            noise(o(next), { dur: rand(4e-3, 0.02), type: "highpass", f: rand(1500, 5e3), vol: rand(0.05, 0.25) * (0.3 + v), a: 7e-4, pan: rand(-0.5, 0.5) });
            next += iv * rand(0.2, 1.8);
          }
        }
      };
    },
    // deep beating hum with a throbbing swirl; deeper and faster as v rises
    blackhole(g) {
      const hum = gainNode(0, g.fade);
      const lp = biquad("lowpass", 260, 1.2, hum);
      const throb = gainNode(0.75, lp);
      g.nodes.push(hum, lp, throb);
      const a = gOsc(g, "sine", 42, throb, 0.3), b = gOsc(g, "sine", 42.7, throb, 0.25);
      const c = gOsc(g, "triangle", 84, throb, 0.12), d = gOsc(g, "sawtooth", 63, throb, 0.05);
      const tl = gLfo(g, 0.6, 0.25, throb.gain);
      const swirl = gNoise(g, "brown", null, 0, { type: "bandpass", f: 300, q: 3 });
      const sw = gLfo(g, 0.3, 200, swirl.fl.frequency);
      return {
        set(x) {
          const f = 46 - 12 * x;
          ramp2(a.osc.frequency, f, 0.2);
          ramp2(b.osc.frequency, f * 1.017, 0.2);
          ramp2(c.osc.frequency, f * 2, 0.2);
          ramp2(d.osc.frequency, f * 1.5, 0.2);
          ramp2(hum.gain, 0.12 + 0.2 * x, 0.15);
          ramp2(lp.frequency, 180 + 400 * x, 0.15);
          ramp2(tl.osc.frequency, 0.4 + 2 * x, 0.2);
          ramp2(swirl.amp.gain, 0.04 + 0.22 * x, 0.15);
          ramp2(sw.osc.frequency, 0.2 + 0.8 * x, 0.2);
          ramp2(swirl.fl.frequency, 250 + 500 * x, 0.2);
        }
      };
    },
    flood(g) {
      const rush = gNoise(g, "brown", null, 0, { type: "lowpass", f: 400, q: 0.5 });
      const foam = gNoise(g, "pink", null, 0, { type: "bandpass", f: 1200, q: 0.7 });
      gLfo(g, 0.17, 300, foam.fl.frequency);
      const o = loopO(g, "sfx", 0.15);
      let v = 0, next = 0;
      return {
        set(x) {
          v = x;
          ramp2(rush.amp.gain, 0.1 + 0.22 * x, 0.15);
          ramp2(rush.fl.frequency, 300 + 1500 * x, 0.15);
          ramp2(foam.amp.gain, 0.04 + 0.2 * x, 0.15);
        },
        tick(t0, h) {
          const iv = 1 / (2 + 12 * v);
          if (!next || next < t0) next = t0 + rand(0, iv);
          while (next < h) {
            bub(o(next), 0, rand(250, 800), rand(0.03, 0.06), rand(-0.7, 0.7), rand(0.05, 0.09));
            next += iv * rand(0.4, 1.6);
          }
        }
      };
    }
  };
  function makeLoop(name) {
    const build2 = LOOPS[name];
    let inst = null, g = null, v = 0.5, dead = false;
    const ensure = () => {
      if (inst || dead || !ready()) return;
      pendingLoops.delete(handle);
      const cat = B[LOOP_CAT[name] || "sfx"];
      g = group(cat.in, cat.verb, 1, 0.35);
      inst = build2(g);
      inst.set(v);
      activeLoops.add(inst);
    };
    const handle = {
      set(x) {
        v = clamp012(x);
        ensure();
        if (inst) inst.set(v);
      },
      stop() {
        if (dead) return;
        dead = true;
        pendingLoops.delete(handle);
        if (inst) {
          activeLoops.delete(inst);
          groupStop(g, 0.25);
          inst = null;
        }
      },
      get value() {
        return v;
      },
      _ensure: ensure
    };
    if (ready()) ensure();
    else pendingLoops.add(handle);
    return handle;
  }
  var MINPENTA = [0, 3, 5, 7, 10];
  var evOut = (g, vol, pan, lp, verb, p = 1) => ({ dry: g.fade, wet: g.wet, pool: "amb", vol, pan, lp, verb, p });
  var AMB = {
    desktop(g, night) {
      gNoise(g, "brown", null, night ? 0.022 : 0.03, { type: "lowpass", f: 220 });
      gNoise(g, "pink", null, 6e-3, { type: "bandpass", f: 900, q: 0.6 });
      const blade = gOsc(g, "sine", 118, null, 35e-4);
      gLfo(g, 0.07, 0.6, blade.osc.frequency);
      return [];
    },
    shallows(g, night) {
      const wash = gNoise(g, "pink", null, night ? 0.06 : 0.085, { type: "lowpass", f: night ? 380 : 520, q: 0.5 });
      gLfo(g, 0.071, 120, wash.fl.frequency);
      const surfMod = gainNode(0.5, g.fade);
      g.nodes.push(surfMod);
      gNoise(g, "brown", surfMod, night ? 0.12 : 0.16, { type: "bandpass", f: 260, q: 0.7 });
      gLfo(g, 0.11, 0.45, surfMod.gain);
      const trickle = (o) => {
        const n = 2 + (Math.random() * 4 | 0);
        let at = 0;
        for (let i = 0; i < n; i++) {
          bub(o, at, rand(350, 1100), rand(0.03, 0.07), 0, rand(0.04, 0.08));
          at += rand(0.05, 0.16);
        }
      };
      const chirps = (o) => {
        const n = 2 + (Math.random() * 3 | 0);
        for (let i = 0; i < n; i++) tone(o, { at: i * rand(0.12, 0.2), f: rand(1600, 2200), f2: rand(2600, 3600), glide: 0.07, dur: 0.09, vol: 0.06, vib: [30, 50] });
      };
      return [
        { min: night ? 3 : 1.5, max: night ? 8 : 5, fn: (t) => fire(trickle, t, evOut(g, night ? 0.45 : 0.65, rand(-0.7, 0.7), 2600, 0.2)) },
        { min: night ? 25 : 12, max: night ? 60 : 30, first: rand(5, 12), fn: (t) => fire(chirps, t, evOut(g, night ? 0.22 : 0.32, rand(-0.8, 0.8), 3200, 0.6)) }
      ];
    },
    junkyard(g, night) {
      gOsc(g, "sawtooth", 55, null, night ? 0.022 : 0.03, { type: "lowpass", f: night ? 160 : 220, q: 1 });
      gOsc(g, "sawtooth", 55.35, null, night ? 0.018 : 0.025, { type: "lowpass", f: night ? 150 : 200, q: 1 });
      gNoise(g, "brown", null, 0.07, { type: "lowpass", f: 240 });
      const hum = gOsc(g, "sine", 120, null, 6e-3);
      gOsc(g, "sine", 180, null, 3e-3);
      gLfo(g, 0.23, 3e-3, hum.amp.gain);
      const creakEv = (o) => {
        const f = rand(70, 140), d = rand(0.6, 1.4);
        tone(o, { f: [[0, f], [d * 0.5, f * 1.3], [d, f * 1.1]], dur: d, type: "sawtooth", vol: 0.05, a: 0.1, shape: "sus", r: 0.25, vib: [rand(15, 30), 6], filt: { type: "bandpass", f: 700, q: 4 } });
      };
      const clank = (o) => {
        fm(o, { f: rand(180, 420), ratio: 1.41, index: 4, index2: 0.3, idur: 0.12, dur: 1.2, vol: 0.06 });
        noise(o, { dur: 0.05, type: "lowpass", f: 1200, vol: 0.2, color: "pink" });
      };
      return [
        { min: night ? 7 : 4, max: night ? 15 : 10, fn: (t) => fire(creakEv, t, evOut(g, 0.6, rand(-0.8, 0.8), 1500, 0.4)) },
        { min: night ? 10 : 6, max: night ? 25 : 15, fn: (t) => fire(SFX.static_burst, t, evOut(g, 0.22, rand(-0.6, 0.6), 5e3, 0.2)) },
        { min: night ? 14 : 8, max: night ? 30 : 20, fn: (t) => fire(clank, t, evOut(g, 0.5, rand(-0.9, 0.9), 1800, 0.7, rand(0.8, 1.2))) }
      ];
    },
    abyss(g, night) {
      gNoise(g, "brown", null, night ? 0.14 : 0.16, { type: "lowpass", f: 90, q: 0.7 });
      const press = gNoise(g, "brown", null, 0.035, { type: "bandpass", f: 140, q: 1.5 });
      gLfo(g, 0.05, 40, press.fl.frequency);
      gOsc(g, "sine", 36, null, 0.04);
      const chimeEv = (o) => {
        const m = 74 + MINPENTA[Math.random() * 5 | 0] + (chance(0.4) ? 12 : 0);
        bell(o, m2f(m), 0, 0.06, 2.4, 0.9);
      };
      return [
        { min: night ? 30 : 20, max: night ? 70 : 45, first: rand(6, 15), fn: (t) => fire(SFX.whale_call, t, evOut(g, 0.32, rand(-0.8, 0.8), 700, 0.8, rand(0.6, 0.85))) },
        { min: night ? 9 : 6, max: night ? 20 : 14, fn: (t) => fire(chimeEv, t, evOut(g, night ? 0.18 : 0.25, rand(-0.8, 0.8), 0, 0.9)) }
      ];
    }
  };
  AMB.aquarium = AMB.desktop;
  function subGroup(g, level) {
    const sg = { fade: gainNode(level, g.fade), wet: g.wet ? gainNode(level, g.wet) : null, srcs: g.srcs, nodes: g.nodes };
    g.nodes.push(sg.fade, sg.wet);
    return sg;
  }
  var withV = (l, v) => {
    l.set(v);
    return l;
  };
  var evLayer = (evs, inner) => ({ tick(t0, h) {
    if (inner && inner.tick) inner.tick(t0, h);
    runEvents(evs, t0, h);
  } });
  var dataBlip = (o) => {
    const base = pick([79, 81, 84, 86, 88]);
    for (let i = 0, n = 2 + (Math.random() * 3 | 0); i < n; i++) {
      tone(o, { at: i * 0.06, f: m2f(base + pick([0, 3, 5, 7, 12])), dur: 0.05, wave: "pulse12", vol: 0.04, a: 2e-3 });
    }
  };
  var WEATHER = {
    rain: (g) => withV(LOOPS.rain(g), 0.5),
    storm: (g) => withV(LOOPS.storm(g), 0.75),
    static: (g) => withV(LOOPS.static(subGroup(g, 0.4)), 0.35),
    datarain: (g) => evLayer(
      [{ min: 0.5, max: 1.8, fn: (t) => fire(dataBlip, t, evOut(g, 0.35, rand(-0.8, 0.8), 0, 0.35)) }],
      withV(LOOPS.rain(subGroup(g, 0.5)), 0.3)
    ),
    oil: (g) => {
      gNoise(g, "brown", null, 0.05, { type: "lowpass", f: 150 });
      return null;
    },
    current: (g) => withV(LOOPS.flood(subGroup(g, 0.45)), 0.1),
    snow: (g) => evLayer([{ min: 0.8, max: 2.6, fn: (t) => fire((o) => tone(o, { f: rand(2400, 4200), dur: 0.5, vol: 0.05, a: 3e-3 }), t, evOut(g, 0.3, rand(-0.9, 0.9), 0, 0.8)) }]),
    glowtide: (g) => evLayer([{ min: 5, max: 11, fn: (t) => fire((o) => {
      for (const m of pick([[62, 69, 76], [58, 65, 74], [60, 67, 74]])) tone(o, { f: m2f(m + 12), dur: 4, vol: 0.03, a: 1.6, shape: "sus", r: 2, vib: [0.3, 1.5] });
    }, t, evOut(g, 0.4, rand(-0.5, 0.5), 0, 0.9)) }])
  };
  var scene = null;
  function buildScene(key, biome, weather, night) {
    const g = group(B.amb.in, B.amb.verb, 1, 2.5);
    const evs = (AMB[biome] || AMB.desktop)(g, night) || [];
    const layer = WEATHER[weather] ? WEATHER[weather](g) : null;
    return { key, g, tick(t0, h) {
      runEvents(evs, t0, h);
      if (layer && layer.tick) layer.tick(t0, h);
    } };
  }
  function applyAmbience() {
    if (!B || S.amb === void 0) return;
    const biome = S.amb, weather = S.ambOpts.weather || null, night = S.ambOpts.night ?? S.night;
    const off = biome === false || biome === "off" || biome === "none";
    const key = off ? "off" : `${biome || "desktop"}|${weather}|${night ? 1 : 0}`;
    if (scene && scene.key === key) return;
    if (scene) {
      groupStop(scene.g, 2.5);
      scene = null;
    }
    if (!off) scene = buildScene(key, biome || "desktop", weather, night);
  }
  var INS = {
    marimba: (o, m, vol, at = 0, dur = 0.8) => fm(o, { f: m2f(m), at, ratio: 4, index: 1.4, idur: 0.05, dur, a: 2e-3, vol }),
    kalimba: (o, m, vol, at = 0, dur = 1) => fm(o, { f: m2f(m), at, ratio: 7.1, index: 0.8, idur: 0.03, dur, a: 2e-3, vol }),
    glass: (o, m, vol, at = 0, dur = 3.5, verb = 0.75) => {
      tone(o, { f: m2f(m), at, dur, vol, a: 4e-3, verb });
      tone(o, { f: m2f(m) * 2.76, at, dur: dur * 0.3, vol: vol * 0.2, verb });
    },
    musicbox: (o, m, vol, at = 0, dur = 1.6, verb = 0.35) => {
      fm(o, { f: m2f(m), at, ratio: 5, index: 0.5, idur: 0.12, dur, a: 2e-3, vol, verb });
      tone(o, { f: m2f(m) * 2, at, dur: 0.3, vol: vol * 0.15 });
    },
    celesta: (o, m, vol, at = 0, dur = 1.2) => fm(o, { f: m2f(m), at, ratio: 1, index: 0.9, index2: 0.1, idur: 0.25, dur, a: 3e-3, vol }),
    pad: (o, m, dur, vol, cut, at = 0, a = 0.5, r = 0.9, type = "sawtooth") => tone(o, { f: m2f(m), at, dur, type, unison: [-7, 7], vol, a, shape: "sus", r, filt: { type: "lowpass", f: cut, q: 0.5 } }),
    bass: (o, m, dur, vol, at = 0) => {
      tone(o, { f: m2f(m), at, dur, type: "triangle", vol, a: 0.01, shape: "sus", r: Math.min(0.12, dur * 0.5) });
      tone(o, { f: m2f(m) * 2, at, dur: dur * 0.6, vol: vol * 0.15, a: 0.01 });
    },
    kick: (o, vol, at = 0) => {
      tone(o, { at, f: 125, f2: 44, glide: 0.09, dur: 0.24, vol, a: 2e-3 });
      noise(o, { at, dur: 0.012, type: "lowpass", f: 1500, vol: vol * 0.3, a: 1e-3 });
    },
    shaker: (o, vol, at = 0) => noise(o, { at, dur: 0.05, type: "bandpass", f: 7500, q: 1.2, a: 8e-3, vol }),
    hat: (o, vol, at = 0, open = false) => noise(o, { at, dur: open ? 0.16 : 0.03, type: "highpass", f: 7500, a: 1e-3, vol }),
    snare: (o, vol, at = 0) => {
      noise(o, { at, dur: 0.13, type: "bandpass", f: 1900, q: 0.8, vol, a: 1e-3 });
      tone(o, { at, f: 200, f2: 150, glide: 0.05, dur: 0.07, type: "triangle", vol: vol * 0.35 });
    },
    rim: (o, vol, at = 0) => {
      noise(o, { at, dur: 0.035, type: "bandpass", f: 2400, q: 2, vol, a: 1e-3 });
      tone(o, { at, f: 1700, dur: 0.02, type: "triangle", vol: vol * 0.15 });
    }
  };
  function wobBass(o, m, dur, vol, rate) {
    const t = o.t, env = ctx.createGain(), osc = ctx.createOscillator(), fl = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator(), lg = gainNode(260);
    osc.type = "square";
    osc.frequency.value = m2f(m);
    osc.detune.setValueAtTime(-35, t);
    osc.detune.linearRampToValueAtTime(0, t + 0.06);
    fl.type = "lowpass";
    fl.Q.value = 5;
    fl.frequency.setValueAtTime(520, t);
    lfo.frequency.value = rate;
    lfo.connect(lg);
    lg.connect(fl.frequency);
    osc.connect(fl);
    fl.connect(env);
    const nodes = [env, osc, fl, lfo, lg];
    osc.start(t);
    lfo.start(t);
    const end = envAt(env, t, dur, vol, 6e-3, "sus", 0.05);
    route(o, env, nodes, 0, 0);
    finishVoice(o, [osc, lfo], nodes, env, t, end);
  }
  function snapIdx(pool, idx, pcs) {
    for (const d of [0, 1, -1, 2, -2]) {
      const k = idx + d;
      if (k >= 0 && k < pool.length && pcs.includes(pool[k] % 12)) return k;
    }
    return idx;
  }
  function newPhrase(st, density, len) {
    st.rhythm = [];
    st.motif = [];
    let idx = st.mi ?? len >> 1;
    for (let k = 0; k < 32; k++) {
      const on = k % 2 === 0 ? chance(density) : chance(density * 0.15);
      st.rhythm.push(on);
      if (on) idx = Math.max(0, Math.min(len - 1, idx + pick([-2, -1, -1, 0, 1, 1, 2])));
      st.motif.push(idx);
    }
    st.mi = idx;
  }
  var SH_CH = {
    F: { pad: [53, 60, 64, 69], root: 41 },
    Dm: { pad: [50, 60, 65, 69], root: 38 },
    Bb: { pad: [58, 62, 65, 69], root: 46 },
    C: { pad: [55, 60, 64, 67], root: 48 },
    Am: { pad: [57, 60, 64, 67], root: 45 },
    Gm: { pad: [55, 58, 62, 65], root: 43 }
  };
  var SH_PROGS = [["F", "Dm", "Bb", "C"], ["F", "Am", "Bb", "C"], ["Bb", "C", "Am", "Dm"], ["F", "Dm", "Gm", "C"]];
  var SH_MEL = [72, 74, 77, 79, 81, 84, 86, 89];
  var JY_CH = {
    Am: { tones: [57, 60, 64], root: 45 },
    F: { tones: [57, 60, 65], root: 41 },
    G: { tones: [55, 59, 62], root: 43 },
    Em: { tones: [55, 59, 64], root: 40 },
    Dm: { tones: [57, 62, 65], root: 38 }
  };
  var JY_PROGS = [["Am", "F", "G", "Em"], ["Am", "Dm", "F", "G"], ["Am", "G", "F", "G"], ["Am", "F", "Dm", "Em"]];
  var JY_LEAD = [69, 72, 74, 76, 79, 81, 84];
  var AB_CH = [[50, 57, 62, 65], [46, 53, 57, 62], [43, 50, 57, 58], [45, 52, 57, 60]];
  var AQ_CH = { G: [55, 59, 62], Em: [52, 55, 59], C: [48, 52, 55], D: [50, 54, 57], Am: [45, 48, 52] };
  var AQ_PROGS = [["G", "Em", "C", "D"], ["G", "C", "G", "D"], ["C", "D", "G", "Em"], ["G", "Em", "Am", "D"]];
  var AQ_MEL = [74, 76, 79, 81, 83, 86, 88];
  var TRACKS = {
    // music-box notes drifting over the ordinary desktop
    desktop: {
      stepDur: 0.55,
      verb: 0.4,
      fadeIn: 3,
      step(tr, i, t) {
        const o = tr.o(t), notes = [84, 86, 88, 91, 93, 96];
        if (chance(S.night ? 0.08 : 0.16)) {
          const j = Math.random() * notes.length | 0;
          INS.musicbox(o, notes[j], 0.05, 0, 1.8, 0.4);
          if (j >= 2 && chance(0.3)) INS.musicbox(o, notes[j - 2], 0.03, 0.01, 1.6, 0.4);
        }
        if (i % 16 === 0 && chance(0.35)) INS.musicbox(o, pick([60, 67, 72]), 0.035, 0, 2.4, 0.5);
      }
    },
    // cozy tropical lo-fi
    shallows: {
      bpm: 88,
      swing: 0.14,
      verb: 0.2,
      fadeIn: 2.5,
      step(tr, i, t) {
        const st = tr.st, s = i % 16, bar = i / 16 | 0, night = S.night, sd = tr.stepDur;
        if (s === 0) {
          if (bar % 4 === 0 || !st.prog) {
            st.prog = pick(SH_PROGS);
            newPhrase(st, night ? 0.32 : 0.6, SH_MEL.length);
            st.inst = chance(0.5) ? "kalimba" : "marimba";
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
        if (s === 0 || s === 8 && !night) INS.kick(o, night ? 0.15 : 0.22);
        if (!night && s === 11 && chance(0.25)) INS.kick(o, 0.11);
        if (!night && (s === 4 || s === 12)) INS.rim(o, 0.12);
        const acc = [0.5, 0.25, 0.85, 0.35][s % 4];
        if (!night || s % 4 === 2) INS.shaker(o, (night ? 0.07 : 0.11) * acc * rand(0.8, 1.1));
        const ri = bar % 2 * 16 + s;
        if (st.rhythm[ri]) {
          let idx = st.motif[ri];
          if (bar % 4 === 3 && s >= 8) idx = Math.max(0, Math.min(SH_MEL.length - 1, idx + pick([-1, 1])));
          if (s % 8 === 0) idx = snapIdx(SH_MEL, idx, ch.pad.map((m) => m % 12));
          const vol = (night ? 0.05 : 0.07) * (s % 4 === 0 ? 1 : 0.8);
          INS[st.inst](o, SH_MEL[idx], vol, 0, st.inst === "kalimba" ? 1.1 : 0.8);
        }
      }
    },
    // glitchy lo-fi chiptune
    junkyard: {
      bpm: 92,
      swing: 0.06,
      verb: 0.12,
      fadeIn: 2,
      init(tr) {
        const pre = gainNode(5), sh = ctx.createWaveShaper(), post = gainNode(0.2);
        sh.curve = WAVES.crush;
        sh.oversample = "none";
        const lp = biquad("lowpass", S.night ? 2200 : 3800, 0.7, tr.fade);
        pre.connect(sh);
        sh.connect(post);
        post.connect(lp);
        tr.nodes.push(pre, sh, post, lp);
        tr.crush = pre;
        tr.crushLp = lp;
      },
      step(tr, i, t) {
        const st = tr.st, s = i % 16, bar = i / 16 | 0, night = S.night, sd = tr.stepDur;
        if (s === 0) {
          if (bar % 4 === 0 || !st.prog) {
            st.prog = pick(JY_PROGS);
            st.pat = pick(["up", "down", "updown", "rand"]);
            st.lead = !night && chance(0.5);
            st.li = 2;
          }
          st.ch = JY_CH[st.prog[bar % 4]];
          ramp2(tr.crushLp.frequency, night ? 2200 : 3800, 0.5, t);
          st.glitch = chance(night ? 0.1 : 0.3) ? 4 + (Math.random() * 10 | 0) : -1;
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
          const k = st.pat === "up" ? s % n : st.pat === "down" ? n - 1 - s % n : st.pat === "updown" ? [0, 1, 2, 3, 4, 5, 4, 3, 2, 1][s % 10] % n : Math.random() * n | 0;
          tone(oc, { f: m2f(notes[k] + 12), dur: sd * 0.9, wave: "pulse25", vol: 0.05, a: 2e-3 });
        }
        if (s === st.glitch) {
          const m = pick(ch.tones) + 24;
          for (let k = 0; k < 4; k++) tone(oc, { at: k * sd / 2, f: m2f(m + (k === 3 ? 12 : 0)), dur: sd * 0.4, wave: "pulse12", vol: 0.035, shape: "sus", r: 0.01 });
        }
        if (st.lead && (s % 4 === 0 || s % 4 === 3 && chance(0.3)) && chance(0.55)) {
          st.li = Math.max(0, Math.min(JY_LEAD.length - 1, st.li + pick([-2, -1, 1, 1, 2])));
          if (s === 0) st.li = snapIdx(JY_LEAD, st.li, ch.tones.map((m) => m % 12));
          tone(oc, { f: m2f(JY_LEAD[st.li]), dur: sd * 2, wave: "pulse12", vol: 0.035, vib: [6, 4], a: 4e-3, shape: "sus", r: 0.05 });
        }
      }
    },
    // dark ambient: drones, glassy bells, slow swells
    abyss: {
      stepDur: 0.6,
      verb: 0.6,
      fadeIn: 4,
      init(tr) {
        const g = tr.g;
        const lp = biquad("lowpass", S.night ? 180 : 260, 0.8, g.fade);
        g.nodes.push(lp);
        tr.droneLp = lp;
        gOsc(g, "sawtooth", m2f(38), lp, 0.05, null, -6);
        gOsc(g, "sawtooth", m2f(38), lp, 0.05, null, 7);
        gOsc(g, "sawtooth", m2f(45), lp, 0.03, null, 3);
        gOsc(g, "sine", m2f(26), null, 0.06);
        gLfo(g, 0.05, 80, lp.frequency);
        const br = gNoise(g, "brown", null, 0.03, { type: "bandpass", f: 300, q: 2 });
        gLfo(g, 0.03, 120, br.fl.frequency);
      },
      step(tr, i, t) {
        const night = S.night, s = i % 8, bar = i / 8 | 0, o = tr.o(t);
        if (s === 0) ramp2(tr.droneLp.frequency, night ? 180 : 260, 1, t);
        if (s === 0 && bar % 4 === 0 && chance(night ? 0.4 : 0.7)) {
          for (const m of pick(AB_CH)) INS.pad(tr.o(t, null, 0.7), m, 8, 0.016, night ? 350 : 520, 0, 2.8, 3);
        }
        if (chance(night ? 0.07 : 0.14)) {
          const m = 74 + MINPENTA[Math.random() * 5 | 0] + (chance(0.35) ? 12 : 0);
          INS.glass(o, m, 0.055, 0, 4, 0.8);
          if (chance(0.3)) INS.glass(o, m, 0.022, 0.9, 3, 0.9);
        }
        if (s === 4 && bar % 8 === 6 && chance(0.6)) {
          tone(o, { f: m2f(pick([26, 33])), dur: 7, type: "triangle", vol: 0.08, a: 3, shape: "sus", r: 3, verb: 0.3 });
          noise(o, { dur: 7, type: "lowpass", f: 200, color: "brown", vol: 0.15, a: 3, shape: "lin", verb: 0.3 });
        }
      }
    },
    // calm 3/4 lullaby: soft bells over a pad
    aquarium: {
      stepDur: 60 / 66 / 2,
      verb: 0.35,
      fadeIn: 3,
      step(tr, i, t) {
        const st = tr.st, s = i % 6, bar = i / 6 | 0, night = S.night, sd = tr.stepDur;
        if (s === 0) {
          if (bar % 4 === 0 || !st.prog) st.prog = pick(AQ_PROGS);
          st.ch = AQ_CH[st.prog[bar % 4]];
          const po = tr.o(t, null, 0.4);
          for (const m of st.ch) INS.pad(po, m, sd * 6 + 0.8, night ? 0.016 : 0.02, night ? 500 : 850, 0, 0.8, 1.2, "triangle");
          tone(tr.o(t), { f: m2f(st.ch[0] - 12), dur: 1.4, vol: 0.09, a: 0.02 });
        }
        const ch = st.ch;
        if (!ch) return;
        const o = tr.o(t);
        if (!night || s % 2 === 0) INS.celesta(o, ch[[0, 2, 1, 2, 1, 2][s]] + 12, night ? 0.04 : 0.055);
        if ((s === 0 || s === 3) && chance(night ? 0.35 : 0.65)) {
          st.mi = Math.max(0, Math.min(AQ_MEL.length - 1, (st.mi ?? 3) + pick([-2, -1, 1, 2])));
          if (s === 0) st.mi = snapIdx(AQ_MEL, st.mi, ch.map((m) => m % 12));
          INS.musicbox(o, AQ_MEL[st.mi], 0.06, 0, 2, 0.45);
        }
      }
    }
  };
  var tracks = [];
  var curTrack = null;
  function makeTrack(name) {
    const def = TRACKS[name], t = ctx.currentTime, fadeIn = def.fadeIn ?? 2.5;
    const fade = gainNode(0, B.music.in), wet = gainNode(0, B.music.verb);
    for (const g of [fade, wet]) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + fadeIn);
    }
    const tr = {
      name,
      def,
      fade,
      wet,
      i: 0,
      nextT: t + 0.1,
      st: {},
      dead: false,
      stopAt: 0,
      nodes: [fade, wet],
      stepDur: def.stepDur ?? 60 / def.bpm / 4
    };
    tr.g = group(fade, wet, 1, 3);
    tr.o = (tt, dest, verb) => ({ t: tt, p: 1, out: dest || fade, wet, verb: verb ?? def.verb ?? 0.18, pool: "music", end: 0 });
    if (def.init) def.init(tr);
    return tr;
  }
  function stopTrack(tr, fade = 2.5) {
    if (tr.dead) return;
    const t = ctx.currentTime;
    tr.dead = true;
    tr.stopAt = t + fade;
    for (const g of [tr.fade, tr.wet]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
    }
    groupStop(tr.g, fade);
    setTimeout(() => disconnectAll(tr.nodes), (fade + 9) * 1e3);
  }
  function scheduleTrack(tr, t0, h) {
    if (tr.nextT < t0 - 0.2) tr.nextT = t0 + 0.02;
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
    if (curTrack) {
      stopTrack(curTrack, 2.5);
      curTrack = null;
    }
    if (name && TRACKS[name]) {
      curTrack = makeTrack(name);
      tracks.push(curTrack);
    }
  }
  var VOICES = {
    crab: { base: 62, scale: [0, 2, 4, 7, 9, 12], type: "square", dur: 0.05, gap: 0.068, vol: 0.055, lp: 2400, bend: 1.12, fmul: 1 },
    fish: { base: 69, scale: [0, 2, 4, 7, 9, 12], type: "sine", dur: 0.075, gap: 0.08, vol: 0.075, lp: 3e3, bend: 1.45, fmul: 1.1 },
    tiny: { base: 81, scale: [0, 2, 4, 7, 9, 12, 14], type: "triangle", dur: 0.04, gap: 0.052, vol: 0.065, lp: 6e3, bend: 1.08, fmul: 1.4 },
    deep: { base: 45, scale: [0, 3, 5, 7, 10], type: "sawtooth", dur: 0.1, gap: 0.105, vol: 0.075, lp: 800, bend: 0.94, fmul: 0.7 }
  };
  var FORMANT = { a: 850, e: 1900, i: 2500, o: 600, u: 420, y: 2200 };
  var bab = { last: {}, line: null };
  function blip(o, at, f, v, form, accent, cons) {
    const t = o.t + at, env = ctx.createGain(), osc = ctx.createOscillator();
    const pk4 = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
    osc.type = v.type;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * v.bend, t + v.dur * 0.8);
    pk4.type = "peaking";
    pk4.frequency.value = cf(form * v.fmul);
    pk4.Q.value = 2.5;
    pk4.gain.value = 6;
    lp.type = "lowpass";
    lp.frequency.value = v.lp;
    osc.connect(pk4);
    pk4.connect(lp);
    lp.connect(env);
    const nodes = [env, osc, pk4, lp];
    osc.start(t);
    const end = envAt(env, t, v.dur * (accent ? 1.2 : 1), v.vol * (accent ? 1.25 : 1), 4e-3);
    route(o, env, nodes, 0.05, 0);
    finishVoice(o, [osc], nodes, env, t, end);
    if (cons) noise(o, { at, dur: 0.014, type: "highpass", f: 4200, vol: v.vol * 0.9, a: 1e-3 });
  }
  function babble(text, voice = "crab") {
    if (!ready()) return;
    const v = VOICES[voice] || VOICES.crab;
    const str = String(text ?? "").toLowerCase();
    const letters = str.replace(/[^a-z0-9]/g, "");
    if (!letters.length) return;
    const now2 = ctx.currentTime;
    const dest = { dry: B.sfx.in, wet: B.sfx.verb, pool: "sfx", vol: 1, verb: 0.05 };
    const pitchOf = (c) => v.scale[c.charCodeAt(0) * 7 % v.scale.length];
    if (str.length <= 2) {
      if (now2 - (bab.last[voice] ?? -1) < v.gap * 0.9) return;
      bab.last[voice] = now2;
      const c = letters[0];
      fire((o2) => blip(o2, 0, m2f(v.base + pitchOf(c)) * rand(0.98, 1.02), v, FORMANT[c] || 1200, false, "stkpcfxz".includes(c)), now2 + 5e-3, dest);
      return;
    }
    if (bab.line) {
      const g = bab.line.gain;
      g.cancelScheduledValues(now2);
      g.setValueAtTime(g.value, now2);
      g.linearRampToValueAtTime(0, now2 + 0.03);
    }
    const q = /\?\s*$/.test(str), ex = /!\s*$/.test(str);
    const o = fire((oo) => {
      let at = 0, count = 0, prevCons = false;
      const total = Math.min(48, letters.length);
      for (let i = 0; i < str.length && count < 48; i++) {
        const c = str[i];
        if (c === " " || c === "\n") {
          at += v.gap * 0.5;
          prevCons = false;
          continue;
        }
        if (",.;:!?-".includes(c)) {
          at += v.gap * 2.2;
          continue;
        }
        if (!/[a-z0-9]/.test(c)) continue;
        const isV = c in FORMANT;
        if (!isV && prevCons && chance(0.5)) {
          prevCons = false;
          continue;
        }
        prevCons = !isV;
        let vow = c;
        for (let k = i; k < str.length && k < i + 4; k++) if (str[k] in FORMANT) {
          vow = str[k];
          break;
        }
        const pos = count / total;
        let semis = pitchOf(c) - pos * 2;
        if (q && pos > 0.7) semis += (pos - 0.7) * 22;
        if (ex) semis += 2;
        blip(oo, at, m2f(v.base + semis) * rand(0.98, 1.02), v, FORMANT[vow] || 1200, ex && count === 0, "stkpcfxz".includes(c));
        at += v.gap * rand(0.9, 1.1);
        count++;
      }
    }, now2 + 0.01, dest);
    bab.line = o.out;
  }
  var timer = null;
  function pump() {
    if (!ready()) return;
    try {
      const t0 = ctx.currentTime, h = t0 + LOOKAHEAD;
      for (let k = tracks.length - 1; k >= 0; k--) {
        const tr = tracks[k];
        if (tr.dead && t0 > tr.stopAt) {
          tracks.splice(k, 1);
          continue;
        }
        scheduleTrack(tr, t0, h);
      }
      if (scene) scene.tick(t0, h);
      for (const l of activeLoops) if (l.tick) l.tick(t0, h);
    } catch (e) {
      warnOnce("pump", "scheduler error: " + (e && e.message));
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
    applyVolumes(true);
    applyMuffle();
    applyNightTone();
    timer = setInterval(pump, 25);
    ctx.onstatechange = startPending;
    applyMusic();
    applyAmbience();
    startPending();
  }
  var failed = false;
  function unlock() {
    if (!AC || failed) return false;
    try {
      if (!ctx) {
        ctx = new AC({ latencyHint: "interactive" });
        try {
          init();
        } catch (e) {
          failed = true;
          warnOnce("init", "audio init failed: " + e.message);
          try {
            ctx.close();
          } catch (e2) {
          }
          ctx = null;
          B = null;
          if (timer) clearInterval(timer);
          return false;
        }
      }
      if (ctx.state !== "running" && ctx.state !== "closed") {
        const p = ctx.resume();
        if (p && p.then) p.then(startPending, () => {
        });
      }
    } catch (e) {
      warnOnce("unlock", "WebAudio unavailable: " + e.message);
      return false;
    }
    return ready();
  }
  function play(name, opts) {
    const fn = SFX[name];
    if (!fn) {
      warnOnce("sfx:" + name, `unknown sound "${name}"`);
      return;
    }
    if (!ready()) return;
    const { vol = 1, pitch = 1, pan = 0 } = opts || {};
    if (!(vol > 0)) return;
    const now2 = ctx.currentTime;
    if (now2 - (lastPlay.get(name) ?? -1) < (MIN_GAP[name] ?? 0.03)) return;
    lastPlay.set(name, now2);
    try {
      fire(fn, now2 + 5e-3, {
        dry: B.sfx.in,
        wet: B.sfx.verb,
        pool: "sfx",
        vol: Math.min(+vol, 2),
        pan: +pan || 0,
        p: Math.max(0.1, Math.min(+pitch || 1, 8)),
        verb: VERB[name] ?? 0.12
      });
    } catch (e) {
      warnOnce("err:" + name, `sound "${name}" failed: ${e.message}`);
    }
  }
  var NOOP_LOOP = { set() {
  }, stop() {
  }, value: 0 };
  function loop(name) {
    if (!LOOPS[name]) {
      warnOnce("loop:" + name, `unknown loop "${name}"`);
      return NOOP_LOOP;
    }
    if (!AC) return NOOP_LOOP;
    return makeLoop(name);
  }
  function setMusic(track) {
    const name = track || null;
    if (name && !TRACKS[name]) {
      warnOnce("music:" + name, `unknown music track "${name}"`);
      return;
    }
    S.music = name;
    if (B) applyMusic();
  }
  function setNight(on) {
    S.night = !!on;
    if (S.ambOpts) S.ambOpts.night = S.night;
    if (B) {
      applyNightTone();
      applyAmbience();
    }
  }
  function setAmbience(biome, opts = {}) {
    S.amb = biome ?? null;
    S.ambOpts = { weather: opts && opts.weather || null, night: opts && opts.night !== void 0 ? !!opts.night : S.night };
    if (opts && opts.night !== void 0) S.night = !!opts.night;
    if (B) {
      applyNightTone();
      applyAmbience();
    }
  }
  function setVolumes(v = {}) {
    for (const k of ["master", "music", "sfx", "ambience"]) if (v[k] !== void 0) vols[k] = clamp012(v[k]);
    if (v.amb !== void 0) vols.ambience = clamp012(v.amb);
    applyVolumes();
  }
  function setMuffle(m) {
    S.muffle = clamp012(m);
    applyMuffle();
  }
  function meter() {
    if (!B) return null;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    B.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0, sum = 0, n = 0;
    const id = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        const x = Math.abs(buf[i]);
        if (x > peak) peak = x;
        sum += x * x;
        n++;
      }
    }, 20);
    return {
      read() {
        const r = { peak, rms: n ? Math.sqrt(sum / n) : 0 };
        peak = 0;
        sum = 0;
        n = 0;
        return r;
      },
      close() {
        clearInterval(id);
        try {
          B.master.disconnect(an);
        } catch (e) {
        }
      }
    };
  }
  var SFX_NAMES = Object.keys(SFX);
  var LOOP_NAMES = Object.keys(LOOPS);
  var MUSIC_TRACKS = Object.keys(TRACKS);
  var BABBLE_VOICES = Object.keys(VOICES);
  var audio = {
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
    get music() {
      return S.music;
    },
    get night() {
      return S.night;
    },
    _meter: meter,
    _voices: () => ({ sfx: pools.sfx.length, music: pools.music.length, amb: pools.amb.length })
  };

  // src/gfx/font.js
  var NORMAL_DEF = {
    height: 7,
    descent: 2,
    lineHeight: 11,
    spacing: 1,
    space: 3,
    glyphs: {
      A: ".##.|#..#|#..#|####|#..#|#..#|#..#",
      B: "###.|#..#|#..#|###.|#..#|#..#|###.",
      C: ".##.|#..#|#...|#...|#...|#..#|.##.",
      D: "###.|#..#|#..#|#..#|#..#|#..#|###.",
      E: "####|#...|#...|###.|#...|#...|####",
      F: "####|#...|#...|###.|#...|#...|#...",
      G: ".##.|#..#|#...|#.##|#..#|#..#|.###",
      H: "#..#|#..#|#..#|####|#..#|#..#|#..#",
      I: "###|.#.|.#.|.#.|.#.|.#.|###",
      J: "..##|...#|...#|...#|#..#|#..#|.##.",
      K: "#..#|#..#|#.#.|##..|#.#.|#..#|#..#",
      L: "#...|#...|#...|#...|#...|#...|####",
      M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
      N: "#..#|##.#|##.#|#.##|#.##|#..#|#..#",
      O: ".##.|#..#|#..#|#..#|#..#|#..#|.##.",
      P: "###.|#..#|#..#|###.|#...|#...|#...",
      Q: ".##.|#..#|#..#|#..#|#..#|#.#.|.#.#",
      R: "###.|#..#|#..#|###.|#.#.|#..#|#..#",
      S: ".###|#...|#...|.##.|...#|...#|###.",
      T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
      U: "#..#|#..#|#..#|#..#|#..#|#..#|.##.",
      V: "#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..",
      W: "#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#",
      X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
      Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
      Z: "####|...#|..#.|..#.|.#..|#...|####",
      a: "....|....|.##.|...#|.###|#..#|.###",
      b: "#...|#...|###.|#..#|#..#|#..#|###.",
      c: "...|...|.##|#..|#..|#..|.##",
      d: "...#|...#|.###|#..#|#..#|#..#|.###",
      e: "....|....|.##.|#..#|####|#...|.##.",
      f: ".##|#..|###|#..|#..|#..|#..",
      g: "....|....|.###|#..#|#..#|#..#|.###|...#|.##.",
      h: "#...|#...|###.|#..#|#..#|#..#|#..#",
      i: "#|.|#|#|#|#|#",
      j: ".#|..|.#|.#|.#|.#|.#|.#|#.",
      k: "#...|#...|#..#|#.#.|##..|#.#.|#..#",
      l: "#.|#.|#.|#.|#.|#.|.#",
      m: ".....|.....|####.|#.#.#|#.#.#|#.#.#|#.#.#",
      n: "....|....|###.|#..#|#..#|#..#|#..#",
      o: "....|....|.##.|#..#|#..#|#..#|.##.",
      p: "....|....|###.|#..#|#..#|#..#|###.|#...|#...",
      q: "....|....|.###|#..#|#..#|#..#|.###|...#|...#",
      r: "....|....|#.##|##..|#...|#...|#...",
      s: "....|....|.###|#...|.##.|...#|###.",
      t: ".#.|.#.|###|.#.|.#.|.#.|..#",
      u: "....|....|#..#|#..#|#..#|#..#|.###",
      v: ".....|.....|#...#|#...#|.#.#.|.#.#.|..#..",
      w: ".....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.",
      x: "....|....|#..#|#..#|.##.|#..#|#..#",
      y: "....|....|#..#|#..#|#..#|#..#|.###|...#|.##.",
      z: "....|....|####|...#|.##.|#...|####",
      0: ".##.|#..#|#..#|#..#|#..#|#..#|.##.",
      1: ".#.|##.|.#.|.#.|.#.|.#.|###",
      2: ".##.|#..#|...#|..#.|.#..|#...|####",
      3: "###.|...#|...#|.##.|...#|...#|###.",
      4: "#..#|#..#|#..#|####|...#|...#|...#",
      5: "####|#...|#...|###.|...#|...#|###.",
      6: ".##.|#...|#...|###.|#..#|#..#|.##.",
      7: "####|...#|...#|..#.|..#.|.#..|.#..",
      8: ".##.|#..#|#..#|.##.|#..#|#..#|.##.",
      9: ".##.|#..#|#..#|.###|...#|...#|.##.",
      ".": ".|.|.|.|.|.|#",
      ",": ".|.|.|.|.|.|#|#",
      "!": "#|#|#|#|#|.|#",
      "?": ".##.|#..#|...#|..#.|.#..|....|.#..",
      "'": "#|#|.|.|.|.|.",
      '"': "#.#|#.#|...|...|...|...|...",
      ":": ".|.|.|#|.|.|#",
      ";": ".|.|.|#|.|.|#|#",
      "-": "...|...|...|###|...|...|...",
      "+": "...|...|.#.|###|.#.|...|...",
      "=": "...|...|###|...|###|...|...",
      "/": "..#|..#|.#.|.#.|.#.|#..|#..",
      "\\": "#..|#..|.#.|.#.|.#.|..#|..#",
      "(": ".#|#.|#.|#.|#.|#.|.#",
      ")": "#.|.#|.#|.#|.#|.#|#.",
      "[": "##|#.|#.|#.|#.|#.|##",
      "]": "##|.#|.#|.#|.#|.#|##",
      "<": "...|..#|.#.|#..|.#.|..#|...",
      ">": "...|#..|.#.|..#|.#.|#..|...",
      "%": "##..#|##.#.|...#.|..#..|.#...|.#.##|#..##",
      "#": ".#.#.|#####|.#.#.|.#.#.|#####|.#.#.|.....",
      "*": "...|#.#|.#.|#.#|...|...|...",
      "_": "....|....|....|....|....|....|####",
      "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
      $: ".#.|###|#..|###|..#|###|.#.",
      "^": ".#.|#.#|...|...|...|...|...",
      "~": "....|....|.#.#|#.#.|....|....|....",
      "|": "#|#|#|#|#|#|#",
      "`": "#.|.#|..|..|..|..|..",
      "{": ".##|.#.|.#.|#..|.#.|.#.|.##",
      "}": "##.|.#.|.#.|..#|.#.|.#.|##.",
      "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
      "\xD7": "...|...|#.#|.#.|#.#|...|...",
      "\u2022": "..|..|..|##|##|..|.."
    }
  };
  var SMALL_DEF = {
    height: 5,
    descent: 1,
    lineHeight: 7,
    spacing: 1,
    space: 2,
    upper: true,
    glyphs: {
      A: ".#.|#.#|###|#.#|#.#",
      B: "##.|#.#|##.|#.#|##.",
      C: ".##|#..|#..|#..|.##",
      D: "##.|#.#|#.#|#.#|##.",
      E: "###|#..|##.|#..|###",
      F: "###|#..|##.|#..|#..",
      G: ".##|#..|#.#|#.#|.##",
      H: "#.#|#.#|###|#.#|#.#",
      I: "###|.#.|.#.|.#.|###",
      J: "..#|..#|..#|#.#|.#.",
      K: "#.#|#.#|##.|#.#|#.#",
      L: "#..|#..|#..|#..|###",
      M: "#...#|##.##|#.#.#|#...#|#...#",
      N: "#..#|##.#|#.##|#..#|#..#",
      O: ".#.|#.#|#.#|#.#|.#.",
      P: "##.|#.#|##.|#..|#..",
      Q: ".#.|#.#|#.#|##.|.##",
      R: "##.|#.#|##.|#.#|#.#",
      S: ".##|#..|.#.|..#|##.",
      T: "###|.#.|.#.|.#.|.#.",
      U: "#.#|#.#|#.#|#.#|###",
      V: "#.#|#.#|#.#|#.#|.#.",
      W: "#...#|#...#|#.#.#|#.#.#|.#.#.",
      X: "#.#|#.#|.#.|#.#|#.#",
      Y: "#.#|#.#|.#.|.#.|.#.",
      Z: "###|..#|.#.|#..|###",
      0: "###|#.#|#.#|#.#|###",
      1: ".#.|##.|.#.|.#.|###",
      2: "##.|..#|.#.|#..|###",
      3: "##.|..#|.#.|..#|##.",
      4: "#.#|#.#|###|..#|..#",
      5: "###|#..|##.|..#|##.",
      6: ".##|#..|###|#.#|###",
      7: "###|..#|.#.|.#.|.#.",
      8: "###|#.#|###|#.#|###",
      9: "###|#.#|###|..#|##.",
      ".": ".|.|.|.|#",
      ",": ".|.|.|#|#",
      "!": "#|#|#|.|#",
      "?": "##.|..#|.#.|...|.#.",
      ":": ".|#|.|#|.",
      "-": "...|...|###|...|...",
      "+": "...|.#.|###|.#.|...",
      "/": "..#|..#|.#.|#..|#..",
      "%": "#.#|..#|.#.|#..|#.#",
      "'": "#|#|.|.|.",
      "(": ".#|#.|#.|#.|.#",
      ")": "#.|.#|.#|.#|#.",
      '"': "#.#|#.#|...|...|...",
      "#": "#.#|###|#.#|###|#.#",
      "*": "#.#|.#.|#.#|...|...",
      "<": "..#|.#.|#..|.#.|..#",
      ">": "#..|.#.|..#|.#.|#..",
      "=": "...|###|...|###|...",
      "_": "...|...|...|...|###",
      "&": ".#.|#.#|.#.|#.#|.##",
      $: ".##|##.|.#.|.##|##.",
      "\xD7": "...|#.#|.#.|#.#|...",
      "[": "##|#.|#.|#.|##",
      "]": "##|.#|.#|.#|##"
    }
  };
  function buildFont(def) {
    const entries = [];
    let atlasW = 0;
    for (const [ch, src] of Object.entries(def.glyphs)) {
      const rows = src.split("|");
      const w = rows[0].length;
      entries.push({ ch, rows, w, x: atlasW });
      atlasW += w + 1;
    }
    const atlasH = def.height + def.descent;
    const canvas = makeCanvas(atlasW, atlasH);
    const g = ctxOf(canvas);
    g.fillStyle = "#fff";
    const glyphs = /* @__PURE__ */ new Map();
    for (const e of entries) {
      e.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === "#") g.fillRect(e.x + x, y, 1, 1);
      });
      glyphs.set(e.ch, { x: e.x, w: e.w, h: e.rows.length });
    }
    return { ...def, atlas: canvas, glyphs, tints: /* @__PURE__ */ new Map(), atlasH };
  }
  var FONTS = {
    normal: buildFont(NORMAL_DEF),
    small: buildFont(SMALL_DEF)
  };
  function tintAtlas(font, color) {
    let c = font.tints.get(color);
    if (!c) {
      c = makeCanvas(font.atlas.width, font.atlas.height);
      const g = ctxOf(c);
      g.drawImage(font.atlas, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      font.tints.set(color, c);
    }
    return c;
  }
  var inlineIcons = /* @__PURE__ */ new Map();
  function registerInlineIcon(name, canvas, dy = 0) {
    inlineIcons.set(name, { canvas, dy });
  }
  function tokenize(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "{") {
        const j = text.indexOf("}", i);
        if (j > i) {
          const name = text.slice(i + 1, j);
          if (inlineIcons.has(name)) {
            out.push({ icon: name });
            i = j + 1;
            continue;
          }
        }
      }
      out.push({ ch });
      i++;
    }
    return out;
  }
  function glyphFor(font, ch) {
    if (font.upper) ch = ch.toUpperCase();
    return font.glyphs.get(ch) || (ch === " " ? null : font.glyphs.get("?"));
  }
  function measureText(text, fontName = "normal", scale = 1) {
    const font = FONTS[fontName];
    let w = 0, maxW = 0;
    for (const t of tokenize(String(text))) {
      if (t.icon) {
        w += inlineIcons.get(t.icon).canvas.width + font.spacing;
        continue;
      }
      if (t.ch === "\n") {
        maxW = Math.max(maxW, w);
        w = 0;
        continue;
      }
      if (t.ch === " ") {
        w += font.space + font.spacing;
        continue;
      }
      const g = glyphFor(font, t.ch);
      w += (g ? g.w : font.space) + font.spacing;
    }
    maxW = Math.max(maxW, w);
    return Math.max(0, maxW - font.spacing) * scale;
  }
  function blit(ctx2, text, x, y, font, color, scale, wave, time) {
    const atlas = tintAtlas(font, color);
    let cx = x, cy = y, i = 0;
    for (const t of tokenize(text)) {
      if (t.icon) {
        const ic = inlineIcons.get(t.icon);
        const ih = ic.canvas.height;
        const oy = Math.round((font.height - ih) / 2) + ic.dy;
        ctx2.drawImage(ic.canvas, Math.round(cx), Math.round(cy + oy * scale), ic.canvas.width * scale, ih * scale);
        cx += (ic.canvas.width + font.spacing) * scale;
        continue;
      }
      if (t.ch === "\n") {
        cx = x;
        cy += font.lineHeight * scale;
        continue;
      }
      if (t.ch === " ") {
        cx += (font.space + font.spacing) * scale;
        i++;
        continue;
      }
      const g = glyphFor(font, t.ch);
      if (!g) {
        cx += (font.space + font.spacing) * scale;
        continue;
      }
      const wy = wave ? Math.round(Math.sin(time * 6 + i * 0.7) * wave) : 0;
      ctx2.drawImage(atlas, g.x, 0, g.w, g.h, Math.round(cx), Math.round(cy + wy), g.w * scale, g.h * scale);
      cx += (g.w + font.spacing) * scale;
      i++;
    }
  }
  function drawText(ctx2, text, x, y, opts = {}) {
    text = String(text);
    const font = FONTS[opts.font || "normal"];
    const scale = opts.scale || 1;
    const color = opts.color || "#ffffff";
    if (opts.align && opts.align !== "left") {
      const w = measureText(text, opts.font || "normal", scale);
      x -= opts.align === "center" ? Math.floor(w / 2) : w;
    }
    x = Math.round(x);
    y = Math.round(y);
    const time = opts.time || 0;
    if (opts.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        blit(ctx2, text, x + dx * scale, y + dy * scale, font, opts.outline, scale, opts.wave, time);
      }
    }
    if (opts.shadow) blit(ctx2, text, x + scale, y + scale, font, opts.shadow, scale, opts.wave, time);
    blit(ctx2, text, x, y, font, color, scale, opts.wave, time);
  }

  // src/gfx/particles.js
  var ringCache = /* @__PURE__ */ new Map();
  function ringSprite(r, color) {
    const key = r + color;
    let c = ringCache.get(key);
    if (!c) {
      const s = r * 2 + 3;
      c = makeCanvas(s, Math.max(3, Math.ceil(r * 0.8) * 2 + 3));
      const g = ctxOf(c);
      g.fillStyle = color;
      const cy = c.height / 2;
      for (let a = 0; a < TAU; a += 0.5 / Math.max(1, r)) {
        g.fillRect(Math.round(s / 2 + Math.cos(a) * r - 0.5), Math.round(cy + Math.sin(a) * r * 0.4 - 0.5), 1, 1);
      }
      ringCache.set(key, c);
    }
    return c;
  }
  var bubbleCache = /* @__PURE__ */ new Map();
  function bubbleSprite(r) {
    let c = bubbleCache.get(r);
    if (!c) {
      const s = r * 2 + 1;
      c = makeCanvas(s, s);
      const g = ctxOf(c);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const dx = x - r, dy = y - r, d = Math.hypot(dx, dy);
        if (d > r + 0.3) continue;
        if (d > r - 0.8) g.fillStyle = "rgba(220,250,255,0.85)";
        else g.fillStyle = "rgba(160,230,255,0.18)";
        g.fillRect(x, y, 1, 1);
      }
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.fillRect(Math.max(0, r - Math.ceil(r / 2)), Math.max(0, r - Math.ceil(r / 2)), 1, 1);
      bubbleCache.set(r, c);
    }
    return c;
  }
  var Particles = class {
    constructor(max = 900) {
      this.max = max;
      this.list = [];
      this.limitScale = 1;
      this.surfaceY = null;
    }
    add(p) {
      if (this.list.length >= this.max * this.limitScale) return null;
      const q = {
        kind: "dot",
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 1,
        t: 0,
        size: 1,
        color: "#ffffff",
        g: 0,
        drag: 0,
        layer: "fg",
        add: false,
        fade: true,
        ...p
      };
      q.max = q.life;
      this.list.push(q);
      return q;
    }
    bubble(x, y, opts = {}) {
      return this.add({ kind: "bubble", x, y, vx: rng.float(-4, 4), vy: -rng.float(14, 26), life: rng.float(1.5, 4), size: opts.size ?? rng.pick([1, 1, 1, 2, 2, 3]), wob: rng.float(0, TAU), layer: opts.layer || "fg", ...opts });
    }
    bubbles(x, y, n = 6, opts = {}) {
      for (let i = 0; i < n; i++) this.bubble(x + rng.float(-3, 3), y + rng.float(-3, 3), { vy: -rng.float(10, 40), ...opts });
    }
    burst(x, y, n, opts = {}) {
      for (let i = 0; i < n; i++) {
        const a = rng.float(0, TAU), sp = rng.float(opts.speedMin ?? 20, opts.speed ?? 70);
        this.add({
          kind: opts.kind || "dot",
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * (opts.flat ?? 1) - (opts.up ?? 0),
          life: rng.float(opts.lifeMin ?? 0.3, opts.life ?? 0.9),
          size: opts.size ?? rng.pick([1, 1, 2]),
          color: Array.isArray(opts.colors) ? rng.pick(opts.colors) : opts.color || "#ffffff",
          g: opts.g ?? 60,
          drag: opts.drag ?? 2,
          add: !!opts.add,
          layer: opts.layer || "fg"
        });
      }
    }
    splash(x, y, power = 1) {
      const n = Math.round(10 + 22 * power);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + rng.float(-0.9, 0.9);
        const sp = rng.float(30, 110) * (0.6 + power * 0.6);
        this.add({ kind: "drop", x: x + rng.float(-4, 4), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rng.float(0.5, 1.2), size: rng.pick([1, 1, 2]), color: rng.pick(["#e8fbff", "#a8e8ff", "#ffffff"]), g: 260, drag: 0.4 });
      }
      this.ring(x, y, power);
      this.bubbles(x, y + 4, Math.round(4 + 6 * power));
    }
    ring(x, y, power = 1, color = "rgba(230,250,255,0.9)") {
      return this.add({ kind: "ring", x, y, life: 0.6 + 0.3 * power, r0: 2, r1: 8 + 10 * power, color, layer: "fg" });
    }
    sparkle(x, y, color = "#fff6b0", opts = {}) {
      return this.add({ kind: "sparkle", x, y, vx: rng.float(-6, 6), vy: rng.float(-10, -2), life: rng.float(0.4, 0.9), color, add: true, ...opts });
    }
    text(x, y, text, opts = {}) {
      return this.add({ kind: "text", x, y, vy: -18, life: 1.3, text, color: "#ffffff", font: "normal", layer: "ui", fade: true, ...opts });
    }
    sprite(x, y, canvas, opts = {}) {
      return this.add({ kind: "sprite", x, y, sprite: canvas, life: 1, vy: -10, layer: "fg", ...opts });
    }
    update(dt) {
      const list = this.list;
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.t += dt;
        if (p.t >= p.max) continue;
        if (p.kind === "bubble") {
          p.wob += dt * 5;
          p.vy = Math.max(p.vy - 8 * dt, -45);
          p.x += (p.vx + Math.sin(p.wob) * 6) * dt;
          p.y += p.vy * dt;
          if (this.surfaceY !== null && p.y < this.surfaceY + 2 && p.layer !== "ui") {
            p.t = p.max;
            if (p.size > 1 && list.length < this.max) this.add({ kind: "dot", x: p.x, y: this.surfaceY + 1, vy: -10, life: 0.25, color: "#ffffff", layer: p.layer });
            continue;
          }
        } else {
          p.vx *= Math.exp(-p.drag * dt);
          p.vy *= Math.exp(-p.drag * dt);
          p.vy += p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.kind === "drop" && this.surfaceY !== null && p.vy > 0 && p.y > this.surfaceY + 1 && p.t > 0.1) {
            p.t = p.max;
            continue;
          }
        }
        list[w++] = p;
      }
      list.length = w;
    }
    draw(ctx2, layer = "fg", time = 0) {
      for (const p of this.list) {
        if (p.layer !== layer) continue;
        const k = p.t / p.max;
        const a = p.fade ? Math.min(1, (1 - k) * 2.2) : 1;
        if (a <= 0.02) continue;
        const x = Math.round(p.x), y = Math.round(p.y);
        switch (p.kind) {
          case "bubble": {
            const s = bubbleSprite(p.size);
            ctx2.globalAlpha = a;
            ctx2.drawImage(s, x - p.size, y - p.size);
            ctx2.globalAlpha = 1;
            break;
          }
          case "ring": {
            const r = Math.round(p.r0 + (p.r1 - p.r0) * Math.sqrt(k));
            const s = ringSprite(r, p.color);
            ctx2.globalAlpha = 1 - k;
            ctx2.drawImage(s, x - Math.floor(s.width / 2), y - Math.floor(s.height / 2));
            ctx2.globalAlpha = 1;
            break;
          }
          case "sparkle": {
            const tw = Math.sin(k * Math.PI);
            ctx2.globalCompositeOperation = "lighter";
            ctx2.fillStyle = rgba(p.color, a);
            ctx2.fillRect(x, y, 1, 1);
            if (tw > 0.4) {
              ctx2.fillRect(x - 1, y, 1, 1);
              ctx2.fillRect(x + 1, y, 1, 1);
              ctx2.fillRect(x, y - 1, 1, 1);
              ctx2.fillRect(x, y + 1, 1, 1);
            }
            if (tw > 0.8 && (p.big ?? true)) {
              ctx2.fillStyle = rgba(p.color, a * 0.5);
              ctx2.fillRect(x - 2, y, 1, 1);
              ctx2.fillRect(x + 2, y, 1, 1);
              ctx2.fillRect(x, y - 2, 1, 1);
              ctx2.fillRect(x, y + 2, 1, 1);
            }
            ctx2.globalCompositeOperation = "source-over";
            break;
          }
          case "text":
            ctx2.globalAlpha = a;
            drawText(ctx2, p.text, x, y, { font: p.font, color: p.color, align: "center", outline: p.outline ?? "#14202c", time, wave: p.wave });
            ctx2.globalAlpha = 1;
            break;
          case "sprite": {
            const s = p.sprite;
            ctx2.globalAlpha = a;
            ctx2.drawImage(s, x - Math.floor(s.width / 2), y - Math.floor(s.height / 2));
            ctx2.globalAlpha = 1;
            break;
          }
          default: {
            if (p.add) ctx2.globalCompositeOperation = "lighter";
            ctx2.fillStyle = rgba(p.color, a);
            ctx2.fillRect(x, y, p.size, p.size);
            if (p.add) ctx2.globalCompositeOperation = "source-over";
          }
        }
      }
    }
    clear() {
      this.list.length = 0;
    }
  };

  // src/gfx/pixel.js
  var PixelBuffer = class {
    constructor(w, h) {
      this.w = Math.max(1, w | 0);
      this.h = Math.max(1, h | 0);
      this.data = new Uint32Array(this.w * this.h);
    }
    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.w && y < this.h;
    }
    set(x, y, c) {
      x |= 0;
      y |= 0;
      if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
    }
    get(x, y) {
      x |= 0;
      y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
      return this.data[y * this.w + x];
    }
    alpha(x, y) {
      return this.get(x, y) >>> 24;
    }
    rect(x, y, w, h, c) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    }
    line(x0, y0, x1, y1, c) {
      x0 = Math.round(x0);
      y0 = Math.round(y0);
      x1 = Math.round(x1);
      y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (; ; ) {
        this.set(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    }
    fillCircle(cx, cy, r, c) {
      const r2 = r * r;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) this.set(x, y, c);
        }
      }
    }
    fillEllipse(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) this.set(x, y, c);
        }
      }
    }
    fillPoly(points, c) {
      let minY = Infinity, maxY = -Infinity;
      for (const p of points) {
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const py = y + 0.5;
        const xs = [];
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i], [xj, yj] = points[j];
          if (yi > py !== yj > py) xs.push(xi + (py - yi) * (xj - xi) / (yj - yi));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c);
        }
      }
    }
    // Outline every transparent pixel touching an opaque one. colorFn(neighbourColor) -> packed colour.
    outline(colorFn, diagonal = false) {
      const { w, h, data } = this;
      const src = data.slice();
      const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (src[y * w + x] >>> 24) continue;
          let n = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
          if (!n && diagonal) n = at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
          if (n && n >>> 24 > 40) data[y * w + x] = typeof colorFn === "function" ? colorFn(n) : colorFn;
        }
      }
    }
    toCanvas() {
      const c = makeCanvas(this.w, this.h);
      const g = ctxOf(c);
      const img = g.createImageData(this.w, this.h);
      new Uint32Array(img.data.buffer).set(this.data);
      g.putImageData(img, 0, 0);
      return c;
    }
  };
  function spriteFromAscii(rows, palette, scale = 1) {
    if (typeof rows === "string") rows = rows.replace(/^\n+|\n+\s*$/g, "").split("\n").map((r) => r.trim());
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const buf = new PixelBuffer(w * scale, h * scale);
    const packed = {};
    for (const [k, v] of Object.entries(palette)) {
      if (!v) continue;
      if (v.length === 9) {
        const a = parseInt(v.slice(7, 9), 16);
        packed[k] = pack(v.slice(0, 7), a);
      } else packed[k] = pack(v);
    }
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const c = packed[row[x]];
        if (c) buf.rect(x * scale, y * scale, scale, scale, c);
      }
    }
    return buf.toCanvas();
  }

  // src/gfx/uiicons.js
  var PAL = {
    h: "#ffffff",
    w: "#fff8ea",
    l: "#d3dae6",
    g: "#97a2b8",
    d: "#5d6781",
    x: "#2b2940",
    r: "#ee4b3f",
    R: "#a32a42",
    p: "#ffa58f",
    y: "#ffd84a",
    Y: "#e8922a",
    s: "#fff3b0",
    O: "#b05a22",
    t: "#a86a3c",
    T: "#6a3e26",
    u: "#e2aa6a",
    b: "#4aa8f0",
    B: "#2c62b8",
    a: "#b2ecff",
    c: "#58d0cc",
    C: "#2a8a9a",
    G: "#66cc54",
    n: "#2a7a42",
    e: "#c4f294",
    m: "#a476ea",
    M: "#5c3a9e",
    v: "#d8bcff",
    E: "#3d3050",
    F: "#5f4d74",
    f: "#ff7d6a",
    D: "#c23e5e",
    P: "#ffc4b0",
    1: "#245a4b",
    2: "#3f8f73",
    3: "#6cc79c",
    4: "#c2f2d2",
    5: "#c97c44",
    k: "#1e1628",
    z: "#ff9ec8",
    Z: "#d0507e"
  };
  var PAL_A = { q: ["#c8f4ff", 70], Q: ["#e8fcff", 150] };
  var OUTLINE = "#1a1224";
  var ICONS = {
    coin: [
      "..4433..",
      ".443332.",
      "44322221",
      "432xx321",
      "322xx321",
      "32233211",
      ".222151.",
      "..1111.."
    ],
    coin_big: [
      "..44433..",
      ".4433332.",
      "443222221",
      "4322x3221",
      "432xxx321",
      "3222x3221",
      "322233211",
      ".2211151.",
      "..11111.."
    ],
    heart: [
      ".hpr.rrr.",
      "hpprrrrrr",
      "prrrrrrrR",
      "rrrrrrrRR",
      ".rrrrrRR.",
      "..rrrRR..",
      "...rRR...",
      "....R...."
    ],
    heart_empty: [
      ".FFE.EEE.",
      "FFEEEEEEE",
      "FEEEEEEEE",
      "EEEEEEEEE",
      ".EEEEEEE.",
      "..EEEEE..",
      "...EEE...",
      "....E...."
    ],
    star: [
      "....s....",
      "...ssy...",
      "...syY...",
      "sssyyyyyY",
      ".syyyyyY.",
      "..yyyyY..",
      "..yyyYY..",
      ".yyY_YYO.",
      ".yY...YO."
    ],
    star_empty: [
      "....F....",
      "...FFE...",
      "...FEE...",
      "FFFEEEEEE",
      ".FEEEEEE.",
      "..EEEEE..",
      "..EEEEE..",
      ".EEE_EEE.",
      ".EE...EE."
    ],
    lock: [
      "..lll..",
      ".l...g.",
      ".l...g.",
      "ssyyyyY",
      "syyxyyY",
      "yyyxyYY",
      "YYYYYYO"
    ],
    unlock: [
      "..lll..",
      ".l...x.",
      ".l..___",
      ".l.____",
      "ssyyyyY",
      "syyxyyY",
      "yyyxyYY",
      "YYYYYYO"
    ],
    hook: [
      "....lw.",
      "....l.g",
      ".....g.",
      ".....l.",
      ".....l.",
      "w....l.",
      "lg...g.",
      ".lgggd."
    ],
    line: [
      "uuuuuuuut",
      ".abBabBa.",
      ".bBabBab.",
      ".BabBabB.",
      ".abBabBa.",
      "tttttttTT"
    ],
    reel: [
      "..llg....",
      ".lwaag...",
      "lwabbag..",
      "labxbagdd",
      "lgabbag.u",
      ".lgaag..t",
      "..ggd...."
    ],
    net: [
      "....uuu..",
      "...ua.au.",
      "..u.a.a.u",
      "..ua.a.au",
      "..u.a.a.u",
      "...ua.au.",
      "..tuuuu..",
      ".t.......",
      "t........"
    ],
    bait: [
      ".syyyY...",
      "syxyyYY.r",
      "yyyrrYYrr",
      ".YYYYYO.r",
      "..g..g...",
      ".g.gg.g.."
    ],
    worm: [
      "......zz.",
      ".....zzxz",
      "..zz.zZ..",
      ".zZZzzZ..",
      "zZ..ZZ...",
      "Z........"
    ],
    fish: [
      "....CCC...",
      "C..cccccc.",
      "CCcccccxcc",
      "CCcccaaaac",
      "C..caaaa..",
      "....aa...."
    ],
    book: [
      "RRrrrrrr.",
      "Rrrrrrrrw",
      "Rrrrssrrw",
      "Rrrsyysrw",
      "Rrrrsyrrw",
      "Rrrrrrrrw",
      "Rrrrrrrrw",
      "Rwwwwwwww",
      ".lllllll."
    ],
    map: [
      "sssuuusss",
      "sGGuuurss",
      "sGsuurssr",
      "ssrrr.uss",
      "srsuurGsu",
      "sssuuuGGs",
      "uuuttttuu"
    ],
    shop: [
      "rwrwrwrwr",
      "rwrwrwrwr",
      ".R.R.R.R.",
      ".t.....t.",
      ".t.y.G.t.",
      "uuuuuuuuu",
      "ttttttttT",
      ".T.....T."
    ],
    tank: [
      "ggggggggg",
      "laaaaaaal",
      "lccYYcccl",
      "lcYYxccbl",
      "lccYccbcl",
      "lnccccncl",
      "lnGcuGncl",
      "luuuuuuul",
      "ddddddddd"
    ],
    coral: [
      ".P...P.P.",
      ".ff.Pf.f.",
      "P.f.f.fD.",
      "ff.fff.f.",
      ".ffDf.fD.",
      "..fffDD..",
      "...fD....",
      "..uuuut.."
    ],
    gear: [
      "...wll...",
      ".w.lll.g.",
      ".wlllllg.",
      "wlll.lggd",
      "lll...ggd",
      "llgg.gggd",
      ".lggggdd.",
      ".g.gdd.d.",
      "...ddd..."
    ],
    music: [
      "...MMMMMM",
      "...mmmmmm",
      "...m....m",
      "...m....m",
      ".vvm..vvm",
      "mmmm.mmmm",
      ".mm...mm."
    ],
    sound: [
      "...l...a.",
      "..ll.a..a",
      "wlll..a.a",
      "lggl..a.a",
      "..gd.a..a",
      "...d...a."
    ],
    mute: [
      "...l.....",
      "..ll.r.r.",
      "wlll..r..",
      "lggl.r.r.",
      "..gd.....",
      "...d....."
    ],
    check: [
      ".......eG",
      "......eGn",
      "e....eGn.",
      "GG..eGn..",
      ".GGeGn...",
      "..GGn....",
      "...n....."
    ],
    cross: [
      "pr...pr",
      "rrr.rrR",
      ".rrrrR.",
      "..rrR..",
      ".rrRRR.",
      "rrR.RRR",
      "rR...RR"
    ],
    arrow_r: [
      ".....w...",
      ".....ll..",
      "wwwwwlll.",
      "lllllllll",
      "gggggggd.",
      ".....gd..",
      ".....d..."
    ],
    arrow_l: [
      "...w.....",
      "..wl.....",
      ".wllwwwww",
      "lllllllll",
      ".dggggggg",
      "..dg.....",
      "...d....."
    ],
    arrow_u: [
      "...w...",
      "..wlg..",
      ".wllgd.",
      "wwllgdd",
      "..wlg..",
      "..wlg..",
      "..wlg..",
      "..wlg..",
      "..lgd.."
    ],
    arrow_d: [
      "..wlg..",
      "..wlg..",
      "..wlg..",
      "..wlg..",
      "..wlg..",
      "wwllgdd",
      ".lllgd.",
      "..lgd..",
      "...d..."
    ],
    mouse_l: [
      "sy.lg",
      "yY.lg",
      "yY.gg",
      ".....",
      "wllgg",
      "lllgg",
      "llggd",
      ".lgd."
    ],
    mouse_r: [
      "wl.sy",
      "wl.yY",
      "ll.YY",
      ".....",
      "wllgg",
      "lllgg",
      "llggd",
      ".lgd."
    ],
    mouse_hold: [
      ".Y..pr.lg",
      ".Y..rR.lg",
      "YYY.RR.gg",
      ".Y.......",
      "....wllgg",
      "....lllgg",
      "....llggd",
      ".....lgd."
    ],
    clock: [
      "..yyyyy..",
      ".yswwwwY.",
      "yswwxwwwY",
      "ywwwxwwlY",
      "ywwwxxwlY",
      "ywwwwwwlY",
      "ywwwwwllY",
      ".YllllgY.",
      "..YYYYO.."
    ],
    sun: [
      "....s....",
      ".s.....Y.",
      "...ssy...",
      "..ssyyY..",
      "s.syyyY.Y",
      "..syyYY..",
      "...yYY...",
      ".Y.....Y.",
      "....Y...."
    ],
    moon: [
      "..ssy...",
      ".ssy....",
      "ssyy....",
      "syy.....",
      "syy.....",
      "syyY....",
      ".yyYY..Y",
      "..yYYYY."
    ],
    cloud: [
      "..www....",
      ".hwwwlw..",
      "hwwwwwwll",
      "lllllllgg",
      ".ggggggg."
    ],
    rain: [
      "..www....",
      ".hwwwlw..",
      "hwwwwwwll",
      ".ggggggg.",
      ".........",
      ".a..a..a.",
      "b..b..b.."
    ],
    storm: [
      "..ggg....",
      ".glgggd..",
      "glgggdddd",
      ".dddyddd.",
      "...yy....",
      "....sy...",
      "....y...."
    ],
    eye: [
      "...lll...",
      ".llwwwll.",
      "lwwbbBwwl",
      "lwwBxhwwg",
      ".ggwBBgg.",
      "...ggg..."
    ],
    sparkle: [
      "...s...",
      "...y...",
      "..sys..",
      "syyhyyY",
      "..yyY..",
      "...Y...",
      "...Y..."
    ],
    crown: [
      "y...s...y",
      "yy.syY.yY",
      "ysyyyyyyY",
      "yyrybyryY",
      "yyyyyyyYY",
      "YYYYYYYYO"
    ],
    food: [
      ".y..u..",
      "...Y..y",
      "lllllll",
      "rrrrrrR",
      "rwwwwrR",
      "rwbbwrR",
      "rwwwwrR",
      "RRRRRRR"
    ],
    bubble: [
      "..aaaa..",
      ".ahQqqa.",
      "ahQqqqqa",
      "aQqqqqqa",
      "aqqqqqqa",
      "aqqqqqwa",
      ".aqqqwa.",
      "..aaaa.."
    ],
    skull: [
      "..hwww..",
      ".hwwwwl.",
      "hwwwwwll",
      "wxxwxxll",
      "wxxwxxlg",
      ".wwlwlg.",
      "..wlwg..",
      "..l_g..."
    ],
    trophy: [
      ".ssyyyyY.",
      "y.syyyY.Y",
      "y.syyyY.Y",
      ".yyyyyYY.",
      "..yyyYY..",
      "...yYO...",
      "....Y....",
      "..yyYYY..",
      "..YYYYO.."
    ],
    pause: [
      "wlg.wlg",
      "wlg.wlg",
      "wlg.wlg",
      "wlg.wlg",
      "wlg.wlg",
      "wlg.wlg",
      "lgd.lgd"
    ],
    play: [
      "w......",
      "wll....",
      "wllll..",
      "wllllgg",
      "lllgg..",
      "lgg....",
      "g......"
    ],
    minimize: [
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
      "wwwwwww",
      "ggggggg"
    ],
    expand: [
      "bbbbbbb",
      "BBBBBBB",
      "l_____g",
      "l_____g",
      "l_____g",
      "l_____g",
      "lgggggg"
    ],
    trash: [
      "..lll..",
      "wllllgg",
      ".......",
      ".wlglg.",
      ".wlglg.",
      ".wlglg.",
      ".wlglg.",
      "..lgg.."
    ],
    home: [
      "....p....",
      "...prr...",
      "..prrrR..",
      ".prrrrRR.",
      "RRRRRRRRR",
      ".wwwwwll.",
      ".wbwtwll.",
      ".wwwtwll."
    ],
    plus: [
      "..eG...",
      "..eGn..",
      "eeeGGGn",
      "GGGGGGn",
      "nnnGnnn",
      "..GGn..",
      "..nnn.."
    ],
    minus: [
      "eeeeeee",
      "GGGGGGG",
      "nnnnnnn"
    ],
    info: [
      "..abbbb..",
      ".abbwbbB.",
      "abbbbbbbB",
      "abbwwbbbB",
      "bbbbwbbbB",
      "bbbbwbbBB",
      "bbbwwwbBB",
      ".bBBBBBB.",
      "..BBBBB.."
    ],
    camera: [
      ".dd.ggg..",
      "wwwwwwwrl",
      "wllxxxlll",
      "llxabxlgg",
      "llxbBxlgg",
      "lllxxxlgg",
      "ggggggggd"
    ],
    // ---- speech-bubble emotes
    zzz: [
      ".....waa.",
      "......a..",
      ".....waa.",
      "wwbbb....",
      "...b.....",
      "..b......",
      ".b.......",
      "bbbbB...."
    ],
    anger: [
      "..p...p..",
      "..r...r..",
      "prr...rrR",
      ".........",
      ".........",
      ".........",
      "prr...rRR",
      "..r...R..",
      "..R...R.."
    ],
    sweat: [
      "...a...",
      "..aab..",
      "..abb..",
      ".aabbb.",
      ".hbbbB.",
      "ahbbbbB",
      "abbbbbB",
      ".bbbBB.",
      "..BBB.."
    ],
    question: [
      ".ssyyY.",
      "sy...YY",
      ".....YY",
      "...yYY.",
      "..yY...",
      "..yY...",
      ".......",
      "..yY...",
      "..YO..."
    ],
    exclaim: [
      "prrR",
      "prrR",
      ".rR.",
      ".rR.",
      ".rR.",
      ".RR.",
      "....",
      ".rR.",
      ".RR."
    ],
    dollar: [
      "...e...",
      ".eeGGG.",
      "eG.e...",
      ".eGGG..",
      "...GGn.",
      "...G.Gn",
      ".GGGGn.",
      "...n..."
    ]
  };
  var CURSORS = {
    cursor: [
      "k..........",
      "kk.........",
      "khk........",
      "khwk.......",
      "khwwk......",
      "khwwwk.....",
      "khwwwwk....",
      "khwwwwwk...",
      "khwwwwwlk..",
      "khwwwwllck.",
      "khwwwlkkkkk",
      "khwlkwlk...",
      "khlkkwlk...",
      "kkk..kwlk..",
      "k....kwck..",
      "......kk..."
    ],
    cursor_hand: [
      "...kk.........",
      "..khwk........",
      "..khwk........",
      "..khwk........",
      "..khwkkk......",
      "..khwkhwkkk...",
      "..khwkhwkhwkk.",
      "kkkhwkhwkhwkwk",
      "khkhwwwwwwwwwk",
      "khwkhwwwwwwwlk",
      ".khwwwwwwwwwlk",
      "..khwwwwwwwllk",
      "...khwwwwwwlk.",
      "....khwwwwllk.",
      "....kkkkkkkk.."
    ],
    cursor_grab: [
      "...kk.kk.kk..",
      "..khwkhwkhwk.",
      "..khwkhwkhwkk",
      ".kkhwwwwwwwwk",
      "khkhwwwwwwwlk",
      "khwwwwwwwwwlk",
      ".khwwwwwwwllk",
      "..khwwwwwwlk.",
      "...khwwwwllk.",
      "...kkkkkkkk.."
    ]
  };
  var CURSOR_HOTSPOT = { cursor: [0, 0], cursor_hand: [3, 0], cursor_grab: [6, 4], cursor_reel: [6, 6] };
  var pkCache = /* @__PURE__ */ new Map();
  function pk(hex, a = 255) {
    const k = hex + a;
    let v = pkCache.get(k);
    if (v === void 0) pkCache.set(k, v = pack(hex, a));
    return v;
  }
  var outCache = /* @__PURE__ */ new Map();
  function outlineFn(n) {
    let c = outCache.get(n);
    if (c === void 0) {
      const [r, g, b] = unpack(n);
      c = pk(mix(shade(rgbToHex(r, g, b), -0.85), OUTLINE, 0.55));
      outCache.set(n, c);
    }
    return c;
  }
  function build(rows, auto = true) {
    const h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const m = auto ? 1 : 0;
    const buf = new PixelBuffer(w + 2 * m, h + 2 * m);
    const keep = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === "." || ch === " ") continue;
        if (ch === "_") {
          keep.push([x + m, y + m]);
          continue;
        }
        if (PAL_A[ch]) buf.set(x + m, y + m, pk(PAL_A[ch][0], PAL_A[ch][1]));
        else if (PAL[ch]) buf.set(x + m, y + m, pk(PAL[ch]));
      }
    }
    if (auto) buf.outline(outlineFn);
    for (const [x, y] of keep) buf.set(x, y, 0);
    return buf.toCanvas();
  }
  function buildReelCursor() {
    const S4 = 13, c = 6.5;
    const buf = new PixelBuffer(S4, S4);
    for (let y = 1; y < S4 - 1; y++) {
      for (let x = 1; x < S4 - 1; x++) {
        const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
        if (d > 5.4) continue;
        const lit = d > 0 ? (-dx - dy) / (d * 1.414) : 0;
        let ch;
        if (d > 4.1) ch = lit > 0.45 ? "w" : lit > -0.1 ? "l" : lit > -0.6 ? "g" : "d";
        else if (d > 1.9) ch = lit > 0.55 && d > 2.6 ? "a" : Math.floor(d * 1.7) % 2 ? "b" : "B";
        else ch = d < 0.8 ? "x" : "l";
        buf.set(x, y, pk(PAL[ch] || PAL_A.q[0]));
      }
    }
    buf.line(7, 6, 9, 4, pk(PAL.g));
    buf.fillCircle(10.5, 3.5, 1.5, pk(PAL.r));
    buf.set(10, 3, pk(PAL.p));
    buf.set(11, 4, pk(PAL.R));
    buf.outline(outlineFn);
    return buf.toCanvas();
  }
  var cache = /* @__PURE__ */ new Map();
  var UI_ICON_NAMES = Object.keys(ICONS);
  var CURSOR_NAMES = [...Object.keys(CURSORS), "cursor_reel"];
  function getUiIcon(name) {
    let c = cache.get(name);
    if (!c) {
      if (ICONS[name]) c = build(ICONS[name]);
      else if (CURSORS[name]) c = build(CURSORS[name], false);
      else if (name === "cursor_reel") c = buildReelCursor();
      else c = makeCanvas(9, 9);
      cache.set(name, c);
    }
    return c;
  }
  var registered = false;
  function registerUiIcons() {
    if (registered) return;
    registered = true;
    for (const name of UI_ICON_NAMES) registerInlineIcon(name, getUiIcon(name));
  }

  // src/gfx/fishart.js
  var SHAPES = {
    oval: { nose: 2.1, peak: 0.4, tailW: 0.36, taper: 1, tip: 0.2 },
    torpedo: { nose: 1.8, peak: 0.36, tailW: 0.3, taper: 0.9, tip: 0.18 },
    round: { nose: 2.8, peak: 0.46, tailW: 0.38, taper: 1.3, tip: 0.24 },
    disc: { nose: 2.3, peak: 0.45, tailW: 0.3, taper: 1.1, tip: 0.18 },
    long: { nose: 1.9, peak: 0.25, tailW: 0.45, taper: 0.6, tip: 0.25 },
    box: { nose: 6, peak: 0.3, tailW: 0.45, taper: 1.6, tip: 0.5 },
    blunt: { nose: 4, peak: 0.3, tailW: 0.36, taper: 1, tip: 0.42 },
    pointy: { nose: 1.25, peak: 0.45, tailW: 0.28, taper: 1, tip: 0.1 }
  };
  var withA = (c, a) => (c & 16777215 | (a & 255) << 24) >>> 0;
  var P = (hex, a = 255) => pack(hex, a) >>> 0;
  function variantColor(hex, variant, role = "body") {
    if (!variant || !hex) return hex;
    let c = hex;
    if (variant.shiny) c = adjust(c, { h: variant.shinyHue ?? 150, sMul: 1.15 });
    switch (variant.mutation) {
      case "albino":
        c = role === "eye" ? "#ff5a7a" : mix(adjust(c, { sMul: 0.15 }), "#fff2f4", 0.7);
        break;
      case "melanistic":
        c = role === "eye" ? "#e8d26a" : adjust(c, { sMul: 0.55, lMul: 0.38 });
        break;
      case "neon":
        c = role === "eye" ? c : adjust(c, { sMul: 1.6, s: 0.25, lMul: 1.05, l: 0.05 });
        break;
      case "pastel":
        c = role === "eye" ? c : adjust(c, { sMul: 0.5, lMul: 0.55, l: 0.42 });
        break;
      case "golden": {
        const [, s, l] = hexToHsl(c);
        c = role === "eye" ? c : hslToHex(44 + (l - 0.5) * 20, 0.75 + s * 0.2, clamp(l * 0.9 + 0.12, 0.2, 0.9));
        break;
      }
      case "inverted":
        c = role === "eye" ? c : invert(c);
        break;
      case "ghost":
        c = role === "eye" ? "#9ef7ff" : mix(adjust(c, { sMul: 0.3 }), "#dff8ff", 0.55);
        break;
      case "crimson":
        c = role === "eye" ? c : adjust(c, { h: 0 - hexToHsl(c)[0] + 355, sMul: 1.2 });
        break;
      case "ocean":
        c = role === "eye" ? c : adjust(c, { h: 205 - hexToHsl(c)[0], sMul: 1 });
        break;
      case "galaxy":
        c = role === "eye" ? c : mix(c, "#2a1b55", 0.35);
        break;
      default:
        break;
    }
    return c;
  }
  var MOUTH_W = { small: 0.22, big: 0.38, fangs: 0.32, lips: 0.2, beak: 0.22, none: 0, gulper: 0 };
  function compileLook(look, variant = null) {
    const kind = look.kind || "fish";
    const b = look.body || {};
    const shape = { ...SHAPES[b.shape || "oval"], ...b };
    const col = look.col || look.chain?.col || {};
    const vc = (h, role) => variantColor(h, variant, role);
    const base = col.body || "#ff9944";
    const bodyHex = vc(base);
    const backHex = vc(col.back || shade(base, -0.25));
    const bellyHex = vc(col.belly || shade(base, 0.45));
    const finHex = vc(col.fin || shade(base, 0.1));
    const contrast = look.contrast ?? 1;
    const toRamp = (hex) => ramp(hex, contrast).map((h) => P(h));
    const L = b.len ?? 16, H = b.h ?? 9;
    const k = clamp(Math.min(H / 9, L / 18), 1, 8);
    const c = {
      kind,
      look,
      variant,
      vc,
      L,
      H,
      k,
      shape,
      hump: b.hump ?? 0,
      belly: b.belly ?? 0.05,
      wave: b.wave ?? 0.5,
      bend: (b.wave ?? 0.5) * H * 0.11,
      bodyR: toRamp(bodyHex),
      backR: toRamp(backHex),
      bellyR: toRamp(bellyHex),
      finR: toRamp(finHex),
      bodyHex,
      backHex,
      bellyHex,
      finHex,
      outlineHex: col.outline ? vc(col.outline) : shade(backHex, -0.78),
      alpha: look.translucent ? Math.round(255 * (look.translucent === true ? 0.5 : look.translucent)) : 255,
      finAlpha: look.finAlpha ?? 0.93,
      scales: look.scales ?? L >= 26,
      scaleSize: look.scaleSize ?? clamp(2.4 + k * 0.6, 3, 6),
      shine: look.shine ?? true,
      gills: look.gills ?? L >= 12,
      lateral: look.lateral ?? L >= 30,
      raySp: clamp(1.7 + k * 0.25, 2, 3),
      patterns: (look.pattern || []).map((p) => ({ ...p, R: toRamp(vc(p.color || "#ffffff", "pattern")), R7: TONES7.map((a) => P(shade(vc(p.color || "#ffffff", "pattern"), a))) })),
      tail: { type: "fork", len: L * 0.38, spread: H * 0.55, flap: 0.32, ...look.tail || {} },
      fins: [],
      eyes: [],
      mouth: { type: "small", v: 0.18, ...look.mouth || {} },
      extras: (look.extras || []).map((e) => ({ ...e })),
      glow: false,
      toRamp
    };
    c.outlineP = P(col.outline ? c.outlineHex : mix(shade(backHex, -0.9), "#0b0910", 0.55));
    const R7 = (hex) => TONES7.map((a) => P(shade(satd(hex), a * contrast)));
    c.R7 = R7;
    c.T = { back: R7(backHex), body: R7(bodyHex), belly: R7(bellyHex), head: col.head ? R7(vc(col.head)) : null };
    c.vb = look.shade?.back ?? -0.3;
    c.vbel = look.shade?.belly ?? 0.3;
    c.toon = !!look.toon;
    c.spec = look.spec ?? 1;
    c.tail.R = toRamp(vc(look.tail?.color || finHex));
    c.tail.R7 = TONES7.map((a) => P(shade(satd(vc(look.tail?.color || finHex)), a * contrast)));
    if (c.tail.spots) c.tail.spotP = P(vc(c.tail.spots));
    c.mouth.R = toRamp(vc(look.mouth?.color || "#e86a7a"));
    c.mouth.w = look.mouth?.w ?? (c.mouth.type === "gulper" ? L * 0.42 : Math.max(1.5, H * (MOUTH_W[c.mouth.type] ?? 0.17)));
    c.mouth.lineP = P(vc(look.mouth?.line || shade(bodyHex, -0.72)));
    const fin = (spec, slot) => {
      if (!spec || spec.type === "none") return;
      c.fins.push({
        slot,
        type: spec.type || "tri",
        from: spec.from ?? 0.3,
        to: spec.to ?? 0.65,
        h: spec.h ?? H * 0.4,
        lean: spec.lean ?? 0.6,
        R: toRamp(vc(spec.color || finHex)),
        R7: TONES7.map((a) => P(shade(satd(vc(spec.color || finHex)), a * contrast))),
        spotP: spec.spots ? P(vc(spec.spots)) : 0,
        alpha: spec.alpha,
        rays: spec.rays ?? true,
        count: spec.count ?? 4,
        spines: spec.spines ?? spec.type === "spiky"
      });
    };
    fin(look.dorsal === void 0 ? { type: "tri" } : look.dorsal, "top");
    fin(look.anal === void 0 ? { type: "tri", from: 0.55, to: 0.78, h: H * 0.25 } : look.anal, "bottom");
    if (look.dorsal2) fin(look.dorsal2, "top");
    if (look.pelvic) fin({ type: "tri", from: 0.3, to: 0.42, h: H * 0.28, lean: 1.1, ...look.pelvic }, "bottom");
    c.pectoral = look.pectoral === null ? null : {
      u: 0.34,
      v: 0.42,
      len: Math.max(2.5, H * 0.32),
      w: 0.36,
      angle: 0.55,
      ...look.pectoral || {}
    };
    if (c.pectoral) {
      c.pectoral.R = toRamp(vc(look.pectoral?.color || finHex));
      c.pectoral.R7 = TONES7.map((a) => P(shade(satd(vc(look.pectoral?.color || finHex)), a * contrast)));
    }
    const lidHex = (e) => vc(e.lid || bodyHex);
    const mkEye = (e, def) => {
      const o = { type: "normal", ...def, ...e };
      o.pupil = P(vc(o.color || "#0c0a12", "eye"));
      o.irisR = o.iris ? toRamp(vc(o.iris, "eye")) : null;
      o.realIris = ramp(adjust(vc(o.iris || look.eyeIris || "#e8bc4a", "eye"), { l: 0.06, sMul: 1.1 })).map((h) => P(h));
      o.sclera = P(o.sclera || "#ffffff");
      o.glowHex = o.type === "glow" ? vc(o.glow || "#9ffcff", "eye") : null;
      o.lidR = ramp(lidHex(o)).map((h) => P(h));
      if (o.type === "glow") c.glow = true;
      return o;
    };
    c.eyes.push(mkEye(look.eye || {}, { u: 0.17, v: -0.2, r: Math.max(1, H * 0.15) }));
    const e0 = c.eyes[0];
    c.opU = look.head?.u ?? clamp(e0.u + e0.r * 2.1 / L + 0.04, 0.14, 0.38);
    c.nostril = look.head?.nostril ?? true;
    c.preop = look.head?.preop ?? true;
    if (c.pectoral) {
      if (look.pectoral?.u == null) c.pectoral.u = c.opU + 0.035;
      if (look.pectoral?.v == null) c.pectoral.v = 0.42;
      if (look.pectoral?.len == null) c.pectoral.len = Math.max(2.5, H * 0.3);
    }
    for (const e of look.moreEyes || []) c.eyes.push(mkEye({ color: look.eye?.color, ...e }, { brow: false }));
    for (const p of c.patterns) if (p.glow) c.glow = true;
    for (const e of c.extras) {
      if (e.color) e.P = P(vc(e.color, "extra"));
      if (e.color2) e.P2 = P(vc(e.color2, "extra"));
      if (e.glow) c.glow = true;
      if (e.type === "monocle") c.monocle = e;
      if (e.type === "bite") c.hasBite = true;
    }
    if (variant?.mutation === "neon") c.glow = true;
    if (variant?.mutation === "galaxy") c.patterns.push({ type: "galaxy", R: toRamp("#2a1b55"), R7: TONES7.map((a) => P(shade("#2a1b55", a))) });
    if (variant?.pattern) {
      const pc = variant.patternColor || shade(bodyHex, variant.pattern === "spots" ? 0.5 : -0.45);
      const vp = { type: variant.pattern, color: pc, R: toRamp(pc), R7: TONES7.map((a) => P(shade(pc, a))), count: 3, size: 1.2 * k, seed: variant.seed || 3 };
      if (variant.pattern === "stripes") {
        vp.at = [-0.35, 0.05, 0.42];
        vp.width = 0.09;
      }
      if (variant.pattern === "bands") {
        vp.at = [0.3, 0.55, 0.78];
        vp.width = 0.045;
      }
      if (variant.pattern === "spots") vp.density = 0.5;
      c.patterns.push(vp);
    }
    if (kind === "chain") c.chain = { segs: 14, r: 4, head: "eel", ...look.chain || {} };
    if (kind === "jelly" && look.glow) c.glow = true;
    if (kind === "ray" && look.bsod) c.glow = true;
    if (kind === "squid" && (look.eyeGlow || look.photophores)) c.glow = true;
    if (kind === "crab" && look.shell === "mech") c.glow = true;
    if (kind === "chain" && c.chain.glow) c.glow = true;
    return c;
  }
  function profile(s, u, inflate) {
    let peak = s.peak, nose = s.nose, tailW = s.tailW, taper = s.taper, tip = s.tip ?? 0.15;
    if (inflate > 0) {
      peak = lerp(peak, 0.5, inflate);
      nose = lerp(nose, 2.4, inflate);
      tailW = lerp(tailW, 0.2, inflate);
      taper = lerp(taper, 1.6, inflate);
      tip = lerp(tip, 0.25, inflate);
    }
    if (u < 0 || u > 1) return 0;
    if (u <= peak) {
      const t2 = u / peak;
      const round = Math.sqrt(Math.min(1, u / 0.03));
      return round * (tip + (1 - tip) * (1 - Math.pow(1 - t2, nose)));
    }
    const t = (u - peak) / (1 - peak);
    return tailW + (1 - tailW) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * t), taper);
  }
  function geomOf(c, inflate = 0) {
    const key = Math.round(inflate * 16);
    if (!c._geo) c._geo = /* @__PURE__ */ new Map();
    let G = c._geo.get(key);
    if (G) return G;
    inflate = key / 16;
    const L = c.L * (1 + 0.3 * inflate), H = c.H * (1 + 1 * inflate);
    const N = Math.max(24, Math.ceil(L * 2));
    const top = new Float32Array(N + 2), bot = new Float32Array(N + 2);
    for (let i = 0; i <= N + 1; i++) {
      const u = Math.min(1, i / N);
      const pr = profile(c.shape, u, inflate);
      top[i] = H / 2 * pr * (1 + c.hump * Math.sin(Math.PI * clamp01((u - 0.04) / 0.78)));
      bot[i] = H / 2 * pr * (1 + c.belly * Math.sin(Math.PI * clamp01(u * 1.2)));
    }
    const interp = (arr, u) => {
      if (u <= 0) return arr[0];
      if (u >= 1) return arr[N];
      const f = u * N, i = f | 0, t = f - i;
      return arr[i] + (arr[i + 1] - arr[i]) * t;
    };
    G = {
      L,
      H,
      halfL: L / 2,
      inflate,
      TL: c.tail.type === "none" ? 0 : c.tail.len * (1 - 0.2 * inflate),
      TS: c.tail.spread,
      spikeLen: c.look.spikes ? c.look.spikes * inflate : 0,
      halfTop: (u) => interp(top, u),
      halfBot: (u) => interp(bot, u)
    };
    G.tailBase = Math.max(0.8, G.halfTop(0.985) * 0.92);
    G.mouthY = c.mouth.v * (H / 2) * 0.6;
    c._geo.set(key, G);
    return G;
  }
  var spineAt = (c, u, phase) => c.bend * Math.sin(TAU * phase - u * 3.2) * u * u;
  function rampPick(R, b, x, y, dither = 0.85) {
    const n = R.length - 1;
    const chk = x + y & 1 ? 0.5 : -0.5;
    const idx = clamp(Math.round(b * n + chk * Math.min(0.3, dither * 0.3)), 0, n);
    return R[idx];
  }
  function tone2(R, idx, x, y) {
    const chk = x + y & 1 ? 0.2 : -0.2;
    return R[clamp(Math.round(5 + (idx - 3) * 1.5 + chk), 0, R.length - 1)];
  }
  var TONES7 = [-0.9, -0.75, -0.58, -0.4, -0.21, 0, 0.17, 0.35, 0.54, 0.74];
  var satd = (hex, k = 1.12) => adjust(hex, { sMul: k });
  function blendPacked(a, b, t) {
    const ar = a & 255, ag = a >>> 8 & 255, ab = a >>> 16 & 255;
    const br = b & 255, bg = b >>> 8 & 255, bb2 = b >>> 16 & 255;
    const r = ar + (br - ar) * t, g = ag + (bg - ag) * t, bl = ab + (bb2 - ab) * t;
    const al = Math.max(a >>> 24, b >>> 24);
    return (al << 24 | Math.round(bl) << 16 | Math.round(g) << 8 | Math.round(r)) >>> 0;
  }
  function outlineFnFor(c) {
    if (c._olFn) return c._olFn;
    const cache3 = /* @__PURE__ */ new Map();
    const [or, og, ob] = unpack(c.outlineP);
    c._olFn = (n) => {
      let o = cache3.get(n);
      if (o === void 0) {
        const [r, g, b, a] = unpack(n);
        if (a === 253) {
          cache3.set(n, 0);
          return 0;
        }
        const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
        const [dr, dg, db] = unpack(P(shade(hex, -0.86)));
        const t = 0.6;
        const oa = a >= 200 ? 255 : Math.min(255, a + 120);
        o = (oa << 24 | Math.round(db + (ob - db) * t) << 16 | Math.round(dg + (og - dg) * t) << 8 | Math.round(dr + (or - dr) * t)) >>> 0;
        cache3.set(n, o);
      }
      return o;
    };
    return c._olFn;
  }
  function boundsFor(extent, angle, scale) {
    const [x0, y0, x1, y1] = extent;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const X = (x * ca - y * sa) * scale, Y = (x * sa + y * ca) * scale;
      mnx = Math.min(mnx, X);
      mny = Math.min(mny, Y);
      mxx = Math.max(mxx, X);
      mxy = Math.max(mxy, Y);
    }
    const pad = 2;
    const w = Math.ceil(mxx - mnx) + pad * 2 + 1;
    const h = Math.ceil(mxy - mny) + pad * 2 + 1;
    return { w, h, ox: Math.floor(-mnx) + pad, oy: Math.floor(-mny) + pad };
  }
  function rectFor(box, angle, scale, ox, oy, w, h) {
    const [x0, y0, x1, y1] = box;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const X = (x * ca - y * sa) * scale + ox, Y = (x * sa + y * ca) * scale + oy;
      mnx = Math.min(mnx, X);
      mny = Math.min(mny, Y);
      mxx = Math.max(mxx, X);
      mxy = Math.max(mxy, Y);
    }
    return {
      x0: clamp(Math.floor(mnx) - 1, 0, w),
      y0: clamp(Math.floor(mny) - 1, 0, h),
      x1: clamp(Math.ceil(mxx) + 2, 0, w),
      y1: clamp(Math.ceil(mxy) + 2, 0, h)
    };
  }
  var gOut = 0;
  var patLight = 0;
  function finShape(type, t, phase, count) {
    switch (type) {
      case "sail":
        return Math.pow(Math.sin(Math.PI * clamp01(t)), 0.6);
      case "spiky":
        return (0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * count))) * Math.sin(Math.PI * clamp01(t)) ** 0.35;
      case "long":
        return Math.min(1, t * 6, (1 - t) * 5);
      case "round":
        return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      case "wave":
        return Math.min(1, t * 5, (1 - t) * 4) * (0.72 + 0.28 * Math.sin(t * 9 - phase * TAU * 2));
      case "trail":
        return t < 0.84 ? Math.pow(t / 0.84, 0.75) : Math.pow((1 - t) / 0.16, 0.55);
      case "tri":
      default:
        return t < 0.28 ? t / 0.28 : Math.pow((1 - t) / 0.72, 0.85);
    }
  }
  function tailHit(type, a, b, TL, TS, base, phase) {
    if (a < -0.5) return false;
    const s = a / TL;
    if (s > 1.35) return false;
    const ab = Math.abs(b);
    switch (type) {
      case "none":
        return false;
      case "round": {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.sqrt(Math.max(0, s)) * 1.05;
        return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 2 * 0.25;
      }
      case "veil": {
        const edge = 1 + 0.1 * Math.sin(b * 1.3 / Math.max(1, TS / 6) + phase * TAU);
        if (s > edge) return false;
        const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.45) * 1.1;
        return ab <= outer;
      }
      case "truncate": {
        if (s > 1) return false;
        return ab <= base + (TS - base) * s;
      }
      case "lyre": {
        if (s > 1.25) return false;
        const outer = base + (TS - base) * Math.pow(Math.min(1, Math.max(0, s)), 0.55);
        if (s > 1) return ab > outer - Math.max(1.2, TS * 0.12) && ab <= outer;
        const inner = s < 0.35 ? -1 : (outer - Math.max(1.6, TS * 0.18)) * smoothstep(0.35, 0.8, s);
        return ab <= outer && ab >= inner;
      }
      case "moon": {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.5);
        const inner = TS * 0.8 * Math.max(0, (s - 0.4) / 0.6) ** 1.4;
        return ab <= outer && ab >= inner;
      }
      case "pointed": {
        if (s > 1) return false;
        return ab <= base * (1 - s) + 0.4;
      }
      case "whip": {
        if (s > 1) return false;
        return ab <= base * Math.pow(1 - s, 1.6) + 0.45;
      }
      case "clavus": {
        if (s > 1.05) return false;
        const outer = base + (TS - base) * Math.sqrt(Math.max(0, Math.min(1, s * 1.6)));
        const edge = 0.82 + 0.18 * Math.abs(Math.cos(b / Math.max(1, TS) * Math.PI * 2.5));
        return ab <= outer && s <= edge;
      }
      case "lobe": {
        if (s > 1.3) return false;
        if (s > 0.92) return ab <= base * 0.55 * (1.3 - s) / 0.38;
        const outer = base + (TS - base) * Math.sqrt(Math.max(0, s));
        return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 3 * 0.3;
      }
      case "fan": {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.sqrt(Math.max(0, s));
        return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 4 * 0.15;
      }
      case "fork":
      default: {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.8);
        const inner = TS * 0.62 * Math.max(0, (s - 0.5) / 0.5);
        return ab <= outer && ab >= inner;
      }
    }
  }
  function tailPix(c, G, lx, ly, px, py, s, tp, baseY) {
    if (G.TL <= 0) return 0;
    const flapA = Math.sin(TAU * tp + 0.7) * c.tail.flap;
    const fore = 1 - 0.2 * Math.abs(Math.sin(TAU * tp + 0.7));
    const dx = lx + G.halfL, dy = ly - baseY;
    const ca = Math.cos(flapA), sa = Math.sin(flapA);
    const a = (-dx * ca + dy * sa) / fore;
    const b = dx * sa + dy * ca;
    const bb = b - Math.sin(TAU * tp + 0.7 - 1.2) * c.tail.flap * Math.max(0, a) * 0.25;
    const type = c.tail.type;
    if (!tailHit(type, a + 0.6, bb, G.TL, G.TS, G.tailBase, tp)) return 0;
    const R = c.tail.R7;
    const st = a / G.TL;
    const rr2 = Math.hypot(bb, a + G.TL * 0.4);
    const ang = Math.atan2(bb, a + G.TL * 0.4);
    const da = c.raySp * 1.15 / (G.TL * 1.4);
    const onRay = c.tail.rays !== false && Math.abs(fract(ang / da + 0.5) - 0.5) * da * rr2 * s < 0.55;
    const e1 = 1 / s;
    const edge = !tailHit(type, a + 0.6 + e1, bb, G.TL, G.TS, G.tailBase, tp) || !tailHit(type, a + 0.6, bb + e1, G.TL, G.TS, G.tailBase, tp) || !tailHit(type, a + 0.6, bb - e1, G.TL, G.TS, G.tailBase, tp);
    let idx = onRay ? 1.7 : 4;
    if (st < 0.14) idx = st < 0.07 ? 1.8 : 2.8;
    if (edge && st > 0.1) idx = 1.4;
    if (!edge && !onRay && st > 0.55 && Math.abs(bb) < G.TS * 0.7 && bb < 0) idx = 4.6;
    if (bb > 0 && !edge && !onRay) idx = 3.6;
    if (c.tail.spotP && !edge && hash2(Math.floor(lx * s / 2), Math.floor(ly * s / 2), 13) < 0.13) return c.tail.spotP;
    const al = onRay || edge || st < 0.14 ? 255 : Math.round(255 * Math.min(1, c.finAlpha));
    return withA(tone2(R, idx, px, py), al);
  }
  function finPix(c, G, lx, ly, px, py, s, fp, sw, still, raise = 0) {
    const uu = (G.halfL - lx) / G.L;
    const uc = clamp01(uu);
    const e1 = 1 / s;
    for (const f of c.fins) {
      const top = f.slot === "top";
      const hMul = 1 + 0.4 * raise * (top ? 1 : 0.6);
      const lean = f.lean * (1 - 0.45 * raise);
      const sy = sw === null ? 0 : spineAt(c, uc, sw);
      const edgeY0 = top ? sy - G.halfTop(uc) : sy + G.halfBot(uc);
      const dist2 = top ? edgeY0 - ly : ly - edgeY0;
      const fhMax = f.h * hMul;
      if (dist2 < -2.5 || dist2 > fhMax * 1.15 + 1) continue;
      const ue = uu - lean * Math.max(0, dist2) / G.L;
      const t = (ue - f.from) / (f.to - f.from);
      if (t < 0 || t > 1) continue;
      const wob = still ? 1 : 1 + 0.08 * Math.sin(TAU * fp - t * 7);
      const fh = fhMax * finShape(f.type, t, fp, f.count) * wob;
      const along = (ue - f.from) * G.L;
      let sp = c.raySp;
      if (f.spines) sp = Math.max(c.raySp * 1.5, (f.to - f.from) * G.L / Math.max(3, f.count * 1.6));
      const rf = fract(along / sp + 0.5) - 0.5;
      const onRay = f.rays && Math.abs(rf) * sp * s < 0.6;
      const R = f.R7;
      if (f.spines) {
        const memb = fh * (1 - 0.42 * Math.pow(Math.abs(rf) * 2, 0.9));
        if (dist2 > memb && !(onRay && dist2 <= fh * 1.1)) continue;
        if (dist2 > memb) return withA(R[1], 255);
        const edge2 = dist2 > memb - e1;
        let idx2 = onRay ? 1.2 : 4;
        if (edge2) idx2 = 1.8;
        if (dist2 < e1 * 1.2) idx2 = 2;
        if (f.spotP && !onRay && hash2(Math.floor(lx * s / 2), Math.floor(ly * s / 2), 17) < 0.14) return f.spotP;
        return withA(tone2(R, idx2, px, py), onRay || edge2 ? 255 : Math.round(255 * (f.alpha ?? c.finAlpha)));
      }
      if (dist2 > fh) continue;
      const edge = dist2 > fh - e1 || t < e1 / Math.max(1, (f.to - f.from) * G.L) || t > 1 - e1 / Math.max(1, (f.to - f.from) * G.L);
      let idx = onRay ? 1.7 : 4;
      if (edge) idx = 1.4;
      else if (dist2 < e1 * 1.2) idx = 1.9;
      else if (!onRay && dist2 > fh * 0.6) idx = 4.5;
      if (!top && !edge && !onRay) idx -= 0.4;
      if (f.spotP && !edge && hash2(Math.floor(lx * s / 2), Math.floor(ly * s / 2), 17) < 0.14) return f.spotP;
      const al = onRay || edge ? 255 : Math.round(255 * (f.alpha ?? c.finAlpha));
      return withA(tone2(R, idx, px, py), al);
    }
    return 0;
  }
  function pecPix(c, G, lx, ly, px, py, s, fp, baseY, still) {
    const pec = c.pectoral;
    if (!pec) return 0;
    const pecX = G.halfL - pec.u * G.L;
    const pecY = baseY + pec.v * G.halfBot(pec.u);
    const pecA = pec.angle + (still ? 0 : Math.sin(TAU * fp) * 0.4);
    const dx = lx - pecX, dy = ly - pecY;
    const ca = Math.cos(pecA), sa = Math.sin(pecA);
    const a = -(dx * ca - dy * sa);
    const b = dx * sa + dy * ca;
    if (a < -0.4 || a > pec.len) return 0;
    const st = a / pec.len;
    const wdt = pec.len * pec.w * Math.pow(Math.max(0, st), 0.6) * Math.sqrt(Math.max(0, 1 - Math.pow(st, 3))) * 1.1 + 0.5 * (1 - st);
    if (Math.abs(b) > wdt + 0.3) return 0;
    const ang = Math.atan2(b, a + pec.len * 0.35);
    const rr2 = Math.hypot(b, a + pec.len * 0.35);
    const da = (pec.spines ? 2.2 : 1.15) * c.raySp / (pec.len * 1.35);
    const rf = fract(ang / da + 0.5) - 0.5;
    const onRay = Math.abs(rf) * da * rr2 * s < 0.6;
    if (pec.spines && !onRay && st > 1 - 0.45 * Math.abs(rf) * 2) return 0;
    const R = pec.R7;
    const edge = !pec.spines && (Math.abs(b) > wdt - 1 / s || st > 0.97 - 0.04 * Math.abs(b) / Math.max(1, wdt));
    let idx = onRay ? 2.2 : 4.6;
    if (edge) idx = 1.1;
    if (st < 0.12) idx = 2;
    return withA(tone2(R, idx, px, py), edge ? 245 : onRay || st < 0.12 ? 215 : Math.round(255 * Math.min(1, c.finAlpha - 0.45)));
  }
  function patternHit(c, pat, u, v, lx, ly, L, H, phase, px, py) {
    const k = c.k;
    switch (pat.type) {
      case "bands": {
        for (const at of pat.at || [0.4]) {
          const w = (pat.width ?? 0.08) * (1 - 0.15 * v * v);
          const wav = (pat.wavy ?? 0.02) * Math.sin(v * 4);
          const dd = Math.abs(u - at - wav);
          if (dd < w) {
            if (pat.edge && w - dd < (pat.edgeW ?? 1.1) / L * Math.max(1, k * 0.6)) return 2;
            return 1;
          }
        }
        return 0;
      }
      case "stripes": {
        for (const at of pat.at || [0]) if (Math.abs(v - at) < (pat.width ?? 0.15) && u > (pat.from ?? 0.1) && u < (pat.to ?? 0.95)) return 1;
        return 0;
      }
      case "spots": {
        const sz = pat.size ?? 1.5 * k;
        const cell = sz * 3.2;
        const cx = Math.floor(lx / cell), cy = Math.floor(ly / cell);
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const hx = cx + i, hy = cy + j;
          if (hash2(hx, hy, pat.seed ?? 7) > (pat.density ?? 0.55)) continue;
          const ox = (hx + 0.2 + hash2(hx, hy, 11) * 0.6) * cell;
          const oy = (hy + 0.2 + hash2(hx, hy, 13) * 0.6) * cell;
          const r = sz * (0.7 + 0.5 * hash2(hx, hy, 17));
          const d2 = (lx - ox) ** 2 + (ly - oy) ** 2;
          if (d2 < r * r) {
            if (pat.only === "top" && v > 0.2) return 0;
            if (pat.ring && d2 < (r - Math.max(1, k * 0.5)) ** 2) return 0;
            return d2 < (r * 0.45) ** 2 && pat.hl ? 3 : 1;
          }
        }
        return 0;
      }
      case "speckle": {
        if (hash2(Math.floor(lx * (pat.freq ?? 1)), Math.floor(ly * (pat.freq ?? 1)), pat.seed ?? 5) < (pat.density ?? 0.08)) return 1;
        return 0;
      }
      case "patches": {
        const f = (pat.freq ?? 0.22) / Math.max(1, k * 0.7);
        const n = noise2(lx * f + (pat.seed ?? 3) * 9.1, ly * f);
        return n > (pat.threshold ?? 0.58) ? 1 : 0;
      }
      case "gradient": {
        const t = pat.dir === "v" ? (v + 1) / 2 : u;
        return t + (bayer(px, py) - 0.5) * 0.15 > (pat.from ?? 0.55) ? 1 : 0;
      }
      case "checker": {
        const sz = pat.size ?? 2 * k;
        return (Math.floor(lx / sz + 100) + Math.floor(ly / sz + 100) & 1) === 0 && u > (pat.umin ?? 0.2) ? 1 : 0;
      }
      case "mask":
        return Math.abs(u - (pat.at ?? 0.18)) < (pat.width ?? 0.09) && v < (pat.vmax ?? 0.35) ? 1 : 0;
      case "face":
        return u < (pat.to ?? 0.3) ? 1 : 0;
      case "tailend":
        return u > (pat.from ?? 0.8) ? 1 : 0;
      case "suit": {
        const edge = -0.05 + (u - 0.08) * 0.55;
        if (u < 0.44 && u > 0.06 && v > edge) return v - edge < 1.6 / H * Math.max(1, k * 0.5) ? 2 : 1;
        return 0;
      }
      case "lines": {
        const n = pat.count ?? 5;
        const t = fract(u * n + Math.sin(v * 3) * 0.08);
        return t < (pat.width ?? 0.18) && u > 0.15 ? 1 : 0;
      }
      case "circuit": {
        const g = pat.grid ?? 3 * k * 0.8;
        const gx = Math.floor(lx / g), gy = Math.floor(ly / g);
        const hx = hash2(gx, gy, 5);
        const lw = Math.max(0.5, k * 0.25);
        const onLine = Math.abs(ly - gy * g - g / 2) < lw && hx < 0.45 || Math.abs(lx - gx * g - g / 2) < lw && hx > 0.75;
        const pad = hx > 0.88 && Math.hypot(lx - gx * g - g / 2, ly - gy * g - g / 2) < lw * 2.2;
        return (onLine || pad) && u > 0.2 ? pad ? 3 : 1 : 0;
      }
      case "galaxy": {
        const st = hash2(Math.floor(lx * 1.3 + 50), Math.floor(ly * 1.3 + 50), 77);
        return st > 0.94 ? 0 : 1;
      }
      case "glowspots": {
        const n = pat.count ?? 5;
        const sz = pat.size ?? Math.max(0.8, k * 0.55);
        for (let i = 0; i < n; i++) {
          const su = (pat.u0 ?? 0.2) + i / n * (pat.span ?? 0.7), sv = pat.v ?? 0.55;
          if (Math.abs(u - su) * L < sz && Math.abs(v - sv) * H * 0.5 < sz * 0.9) return 1;
        }
        return 0;
      }
      case "dots": {
        for (const row of pat.rows || [0.6]) {
          const sp = pat.spacing ?? 2.6 * k;
          const xx = (L / 2 - lx) / sp;
          const fi = Math.round(xx);
          const dd = Math.hypot((xx - fi) * sp, (v - row) * H * 0.5);
          if (dd < (pat.size ?? Math.max(0.7, k * 0.4)) && u > (pat.from ?? 0.15) && u < (pat.to ?? 0.9)) return 1;
        }
        return 0;
      }
      case "bars": {
        for (const at of pat.at || [0.4]) {
          const w = (pat.width ?? 0.05) * (1 - clamp01((v + 0.2) / 1.1) * 0.85) + Math.sin(v * 5 + at * 20) * 6e-3;
          if (Math.abs(u - at - v * (pat.slant ?? 0.03)) < w && v < (pat.bottom ?? 0.55)) return 1;
        }
        return 0;
      }
      case "belt":
        return Math.abs(v - (pat.at ?? 0.3)) < (pat.width ?? 0.12) ? 1 : 0;
      case "rust": {
        const f = (pat.freq ?? 0.35) / Math.max(1, k * 0.6);
        const n = noise2(lx * f + 3.3, ly * f + 1.7) * 0.75 + noise2(lx * f * 3 + 9, ly * f * 3) * 0.25;
        return n > (pat.threshold ?? 0.62) ? n > (pat.threshold ?? 0.62) + 0.12 ? 2 : 1 : 0;
      }
      case "zigzag": {
        const t = fract(u * (pat.count ?? 4));
        return Math.abs(v - (Math.abs(t - 0.5) * 2 - 0.5) * 0.9) < (pat.width ?? 0.14) ? 1 : 0;
      }
      case "chevron": {
        const n = pat.count ?? 3;
        const t = fract(u * n - Math.abs(v) * 0.25);
        return t < (pat.width ?? 0.22) && u > 0.18 ? 1 : 0;
      }
      case "ocellus": {
        for (const [ou, ov] of pat.at || [[0.75, -0.2]]) {
          const r = pat.r ?? H * 0.14;
          const d = Math.hypot((u - ou) * L, (v - ov) * H * 0.5);
          if (d < r) return d < r * 0.45 ? 2 : d > r - Math.max(1, k * 0.45) ? 2 : 1;
        }
        return 0;
      }
      case "facets": {
        const sz = pat.size ?? 4 * k;
        const ax = lx / sz + ly / (sz * 1.7), ay = ly / sz - lx / (sz * 2.3);
        const ix = Math.floor(ax), iy = Math.floor(ay);
        const fx = ax - ix, fy = ay - iy;
        const tri = fx + fy > 1 ? 1 : 0;
        const hsh = hash2(ix * 2 + tri, iy, 31);
        patLight += (hsh - 0.5) * 0.55;
        const edge = Math.min(fx, fy, 1 - fx, 1 - fy, Math.abs(fx + fy - 1) * 0.7);
        if (edge * sz < 0.55) return 3;
        return hsh > 0.94 ? 3 : 0;
      }
      case "plates": {
        const sz = pat.size ?? 5 * k;
        const rh = sz * 0.8;
        const r = Math.floor(ly / rh + 100);
        const yb = (r - 100) * rh + Math.sin(lx * 0.35 / Math.max(1, k * 0.5) + r) * sz * 0.08;
        if (ly - yb < 0.6 * Math.max(1, k * 0.35)) return 2;
        if (ly - yb < 1.6 * Math.max(1, k * 0.35)) patLight += 0.12;
        const off = (r & 1) * sz * 0.5;
        const i0 = Math.floor((lx - off) / sz);
        for (let i = i0; i <= i0 + 1; i++) {
          const bx = i * sz + off + (hash2(i, r, 61) - 0.5) * sz * 0.45 + (ly - yb) * 0.25;
          const d = lx - bx;
          if (Math.abs(d) < 0.6 * Math.max(1, k * 0.35)) return 2;
          if (d > 0 && d < 1.4 * Math.max(1, k * 0.35)) patLight += 0.08;
        }
        return 0;
      }
      case "scribble": {
        const n = pat.count ?? 3;
        for (let i = 0; i < n; i++) {
          const vv = -0.45 + i / Math.max(1, n - 1) * 0.8;
          const y = vv + 0.12 * Math.sin(u * (18 + i * 5) + i * 2) + 0.06 * Math.sin(u * 41 + i);
          if (Math.abs(v - y) * H * 0.5 < (pat.width ?? Math.max(0.6, k * 0.3)) && u > 0.2 && u < 0.9) return 1;
        }
        return 0;
      }
      default:
        return 0;
    }
  }
  function organHit(c, u, v, phase, L, H) {
    const o = c.look.organs;
    const k = c.k;
    const vv = v * H * 0.5;
    const thin = Math.max(0.5, k * 0.28);
    if (Math.abs(vv - H * 0.01) < thin * 1.2 && u > 0.12 && u < 0.98) return P(o.bone || "#f4f1ff", 235);
    if (u > 0.14 && u < 0.97 && Math.abs(fract(u * L / (2.2 * k)) - 0.5) < 0.12 && Math.abs(vv) < thin * 2.4) return P(o.bone || "#f4f1ff", 235);
    if (u > 0.28 && u < 0.78 && Math.abs(fract(u * L / (2.6 * k) + vv * 0.04) - 0.5) < 0.1 && Math.abs(v) < 0.62 && Math.abs(v) > 0.1) return P(o.bone || "#f4f1ff", 150);
    const pulse = 0.5 + 0.5 * Math.sin(phase * TAU * 2);
    const hr = H * (0.1 + 0.015 * pulse);
    if (Math.hypot((u - 0.25) * L, vv - H * 0.2) < hr) return P(Math.hypot((u - 0.25) * L + hr * 0.3, vv - H * 0.2 + hr * 0.3) < hr * 0.4 ? "#ff9ab0" : "#ff4466", 255);
    if (((u - 0.45) * L) ** 2 / (H * 0.22) ** 2 + (vv - H * 0.17) ** 2 / (H * 0.13) ** 2 < 1) return P(o.stomach || "#9ad66b", 230);
    if (Math.hypot((u - 0.1) * L, vv + H * 0.15) < H * 0.08) return P("#ffb3d0", 225);
    return 0;
  }
  var pdT = 0;
  function polyDist2(pts, x, y) {
    let bd = Infinity;
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
      const l2 = dx * dx + dy * dy || 1e-6;
      let t = ((x - ax) * dx + (y - ay) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - x, ey = ay + dy * t - y;
      const d = ex * ex + ey * ey;
      if (d < bd) {
        bd = d;
        pdT = (i + t) / n;
      }
    }
    return bd;
  }
  function curvePts(fn, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return pts;
  }
  function bboxOf(pts, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  var inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  function eyeLocal(c, G, e, sw, still = false) {
    const ex = G.halfL - e.u * G.L;
    const ey = (still ? 0 : spineAt(c, e.u, sw)) + e.v * (e.v < 0 ? G.halfTop(e.u) : G.halfBot(e.u));
    return [ex, ey, e.r * (1 + 0.15 * G.inflate)];
  }
  function prepExtras(c, G, sw, still, s) {
    const { L, H, halfL } = G;
    const k = c.k;
    const px1 = 1 / s;
    const sway = still ? 0 : 1;
    const out = [];
    for (const e of c.extras) {
      const q = { e };
      switch (e.type) {
        case "lure": {
          const sv = Math.sin(sw * TAU) * 0.8 * Math.max(1, k * 0.7) * sway;
          const reach = e.reach ?? L * 0.35, h = e.h ?? H * 0.9;
          const sx = halfL - L * 0.15, sy = -G.halfTop(0.15) * 0.92;
          const tx = halfL - L * 0.12 + reach + sv * 0.4, ty = -H / 2 - h * 0.55 + sv;
          const cx = sx - k, cy = ty - 2 * k;
          q.rb = e.r ?? clamp(H * 0.075, 1.3, 7);
          if (e.spinner) {
            q.rr = e.r ?? Math.max(2.5, H * 0.14);
            q.sc = [tx + q.rr * 0.1, ty - q.rr * 0.95];
          }
          q.tip = [tx, ty];
          q.w = Math.max(px1 * 0.6, k * 0.22);
          q.pts = curvePts((t) => [(1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t * t * tx, (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t * t * ty], 16);
          q.box = bboxOf(q.pts, (q.rr ? q.rr * 2.2 : q.rb + 1) + 1);
          break;
        }
        case "whiskers": {
          const len = e.len ?? H * 0.6;
          const nb = e.count ?? 2;
          const dirs = [0.75, -0.55, 0.35, -0.2];
          q.lines = Array.from({ length: nb }, (_, side) => curvePts((t) => [
            halfL + 0.3 - side * k * 0.7 + Math.sin(t * 2.2) * len * 0.36 - t * t * len * (0.5 + side * 0.1),
            G.mouthY - (side & 1 ? H * 0.1 : -H * 0.02) + t * len * dirs[side % 4] + Math.sin(sw * TAU + t * 3 + side) * t * 0.8 * k * sway
          ], 16));
          q.w = px1 * 0.55;
          q.box = bboxOf(q.lines.flat(), 1.5);
          break;
        }
        case "feelers": {
          const len = e.len ?? L * 0.7, u0 = e.u ?? 0.36;
          const x0 = halfL - L * u0, y0 = G.halfBot(u0) * 0.8;
          q.lines = [0, 1].map((side) => curvePts((t) => [
            x0 - side * k - t * len * 0.8,
            y0 + t * len * (0.5 + side * 0.12) + Math.sin(sw * TAU - t * 4 + side) * t * H * 0.1 * sway
          ], 16));
          q.w = px1 * 0.6;
          q.box = bboxOf(q.lines.flat(), 2);
          break;
        }
        case "barbel": {
          const len = e.len ?? H * 0.8;
          const x0 = halfL - L * 0.06, y0 = G.mouthY + H * 0.14;
          q.pts = curvePts((t) => [x0 - t * len * 0.15 + Math.sin(t * Math.PI) * len * 0.22, y0 + t * len * 0.8 + Math.sin(sw * TAU + t * 3) * t * k * sway], 14);
          q.tip = q.pts[q.pts.length - 1];
          q.rb = e.r ?? Math.max(1.2, k * 0.7);
          q.w = Math.max(px1 * 0.55, k * 0.2);
          q.box = bboxOf(q.pts, q.rb + 1.5);
          break;
        }
        case "antennae": {
          const u0 = e.u ?? 0.22;
          const bx = halfL - L * u0, by = -G.halfTop(u0) + 0.5;
          const len = e.len ?? (e.style === "rabbit" ? H * 0.75 : H * 0.55);
          if (e.style === "rabbit") {
            q.lines = [-1, 1].map((sd) => {
              const a = sd * 0.42 + Math.sin(sw * TAU + sd) * 0.05 * sway;
              return curvePts((t) => [bx + Math.sin(a) * len * t, by - Math.cos(a) * len * t], 6);
            });
          } else {
            q.lines = [0, 1].map((o) => curvePts((t) => [bx - o * k * 1.5 + t * len * 0.55, by - t * len + Math.sin(sw * TAU + o + t * 2) * t * k * 0.6 * sway - t * t * len * 0.1], 10));
          }
          q.tips = q.lines.map((l) => l[l.length - 1]);
          q.rb = e.r ?? Math.max(1, k * 0.55);
          q.w = Math.max(px1 * 0.55, k * 0.2);
          q.base = [bx, by];
          q.box = bboxOf(q.lines.flat(), q.rb + 1.5);
          break;
        }
        case "cap": {
          const u0 = e.u ?? 0.3;
          q.cx = halfL - L * u0;
          q.cy = -G.halfTop(u0) + (e.sink ?? H * 0.06);
          q.w = e.w ?? H * 0.55;
          q.box = [q.cx - q.w * 1.2, q.cy - q.w * 1.3, q.cx + q.w * 1.3, q.cy + q.w * 0.3];
          break;
        }
        case "halo": {
          const u0 = e.u ?? 0.32;
          const bob = Math.sin(sw * TAU) * Math.max(0.5, k * 0.4) * sway;
          q.cx = halfL - L * u0;
          q.cy = -G.halfTop(u0) - (e.h ?? H * 0.36) + bob;
          q.rx = e.r ?? Math.max(3, L * 0.16);
          q.ry = q.rx * 0.3;
          q.t = Math.max(px1 * 1.2, k * 0.5);
          q.box = [q.cx - q.rx - 2, q.cy - q.ry - 2, q.cx + q.rx + 2, q.cy + q.ry + 2];
          break;
        }
        case "dome": {
          const u0 = e.u ?? 0.24;
          q.cx = halfL - L * u0;
          q.cy = -G.halfTop(u0) * 0.55;
          q.rx = e.rx ?? L * 0.2;
          q.ry = e.ry ?? H * 0.85;
          q.box = [q.cx - q.rx - 1, q.cy - q.ry - 1, q.cx + q.rx + 1, q.cy + 1];
          break;
        }
        case "badge": {
          const u0 = e.u ?? 0.45;
          q.r = e.r ?? clamp(H * 0.15, 2.5, 8);
          q.cx = halfL - L * u0;
          q.cy = -G.halfTop(u0) - q.r * 0.15;
          break;
        }
        case "clownnose": {
          q.r = e.r ?? Math.max(1.5, H * 0.11);
          q.cx = halfL - q.r * 0.15;
          q.cy = G.mouthY - q.r * 1.25;
          break;
        }
        case "usb": {
          q.len = e.len ?? L * 0.42;
          q.hh = e.h ?? H * 0.17;
          q.y0 = e.v != null ? e.v * H * 0.5 : G.mouthY - H * 0.04;
          q.x0 = halfL - q.len * 0.12;
          break;
        }
        case "bite": {
          const u0 = e.u ?? 0.6;
          const rb = e.r ?? H * 0.17;
          const y = -G.halfTop(u0) + rb * 0.45;
          q.circles = [-1.05, 0, 1.05].map((o, i) => [halfL - L * u0 + o * rb, y - (i === 1 ? rb * 0.2 : 0), rb * (i === 1 ? 1.05 : 0.85)]);
          break;
        }
        case "monocle": {
          const [ex, ey, er] = eyeLocal(c, G, c.eyes[0], sw, still);
          const rr2 = er * 1.28 + k * 0.35;
          const a0 = 2.2;
          const sx = ex + Math.cos(a0) * rr2, sy = ey + Math.sin(a0) * rr2;
          const tx = ex - rr2 * 2.2, ty = ey + rr2 * 2.4 + Math.sin(sw * TAU) * k * 0.3 * sway;
          q.pts = curvePts((t) => [lerp(sx, tx, t), lerp(sy, ty, t) + Math.sin(t * Math.PI) * rr2 * 0.7], 10);
          q.w = Math.max(px1 * 0.5, k * 0.16);
          q.box = bboxOf(q.pts, 1.5);
          break;
        }
        case "kype": {
          const rad = e.len ?? H * 0.22;
          const x0 = halfL - L * 0.02, y0 = G.mouthY - H * 0.14;
          q.pts = curvePts((t) => {
            const a = -Math.PI / 2 + t * 2.3;
            return [x0 + Math.cos(a) * rad, y0 + rad + Math.sin(a) * rad];
          }, 16);
          q.wid = (t) => Math.max(px1 * 0.7, H * (0.085 - 0.055 * t));
          q.jaw = curvePts((t) => [halfL - L * 0.14 + t * (L * 0.14 + rad * 0.5), G.mouthY + H * 0.16 - t * H * 0.08], 10);
          q.jw = Math.max(px1 * 0.7, H * 0.055);
          q.box = bboxOf([...q.pts, ...q.jaw], H * 0.14 + 1);
          break;
        }
        case "briefcase": {
          if (!e.draw) break;
          const u0 = e.u ?? 0.3;
          q.bw = e.w ?? H * 0.95;
          q.bh = q.bw * 0.62;
          q.cx = halfL - L * u0;
          q.top = G.halfBot(u0) + Math.max(1.5, H * 0.16) + Math.sin(sw * TAU) * 0.4 * sway;
          q.hy = G.halfBot(u0) - 0.5;
          q.box = [q.cx - q.bw / 2 - 1, q.hy - 1, q.cx + q.bw / 2 + 1, q.top + q.bh + 1];
          break;
        }
        case "mustache": {
          const len = e.len ?? L * 0.26, rc = e.curl ?? H * 0.075;
          const x0 = halfL - L * 0.02, y0 = G.mouthY - H * 0.05;
          const xe = x0 - len, ye = y0 + H * 0.02;
          q.pts = curvePts((t) => {
            if (t <= 0.6) {
              const k22 = t / 0.6;
              return [x0 - k22 * len, y0 + Math.sin(k22 * Math.PI) * H * 0.035 + k22 * H * 0.02];
            }
            const k2 = (t - 0.6) / 0.4, a2 = k2 * Math.PI * 1.55, rr2 = rc * (1 - 0.4 * k2);
            return [xe - Math.sin(a2) * rr2, ye - rc + Math.cos(a2) * rr2];
          }, 24);
          const th = e.thick ?? H * 0.075;
          q.wid = (t) => Math.max(px1 * 0.6, th * (t < 0.2 ? 0.55 + t * 2.25 : t < 0.55 ? 1 : 1 - (t - 0.55) * 1.5));
          q.box = bboxOf(q.pts, th + 1);
          break;
        }
        default:
          break;
      }
      out.push(q);
    }
    return out;
  }
  function overlayPix(c, xp, lx, ly, px, py, s, G) {
    for (const q of xp) {
      const e = q.e;
      switch (e.type) {
        case "kype": {
          if (!inBox(q.box, lx, ly)) break;
          let d2 = polyDist2(q.pts, lx, ly);
          const w = q.wid(pdT);
          if (d2 < w * w) {
            const R = c.T.head || c.T.body;
            return tone2(R, 3.4 - pdT * 1.4 - (ly > q.pts[Math.round(pdT * 16)][1] ? 0.8 : 0), px, py);
          }
          d2 = polyDist2(q.jaw, lx, ly);
          if (d2 < q.jw * q.jw) return tone2(c._jawR || (c._jawR = c.R7(c.vc(e.color || "#e8e0c8", "extra"))), 4 - pdT * 0.8, px, py);
          break;
        }
        case "clownnose": {
          const dx = lx - q.cx, dy = ly - q.cy;
          const d = Math.hypot(dx, dy);
          if (d > q.r) break;
          const hl = Math.hypot(dx + q.r * 0.38, dy + q.r * 0.38);
          if (hl < q.r * 0.26) return P("#fff1f0");
          const R = c._noseR || (c._noseR = ramp(c.vc(e.color || "#ff2b3a", "extra")).map((h) => P(h)));
          return rampPick(R, clamp01(0.75 - (dx + dy) / q.r * 0.35 - d / q.r * 0.25), px, py);
        }
        case "badge": {
          const dx = lx - q.cx, dy = ly - q.cy;
          const d = Math.hypot(dx, dy);
          if (d > q.r) break;
          const R = c._badgeR || (c._badgeR = ramp(c.vc(e.color || "#ff3048", "extra")).map((h) => P(h)));
          if (d > q.r - 1 / s) return R[0];
          const gw = Math.max(0.5 / s, q.r * 0.13);
          if (Math.abs(dx - q.r * 0.05) < gw && Math.abs(dy) < q.r * 0.52) return P("#ffffff");
          if (dy < -q.r * 0.25 && dy > -q.r * 0.52 && dx < 0 && dx > -q.r * 0.3 && Math.abs(dy + q.r * 0.38 + dx * 0.6) < gw) return P("#ffffff");
          return rampPick(R, clamp01(0.7 - dy / q.r * 0.3 - dx / q.r * 0.1), px, py);
        }
        case "usb": {
          const x = lx - q.x0, ady = Math.abs(ly - q.y0);
          if (x < 0 || x > q.len * 1.12) break;
          const collar = x < q.len * 0.26;
          const hh = collar ? q.hh * 1.3 : q.hh;
          if (ady > hh) break;
          if (collar) {
            const R = c._usbC || (c._usbC = ramp(c.vc(e.color || "#30343e", "extra")).map((h) => P(h)));
            return rampPick(R, clamp01(0.62 - (ly - q.y0) / hh * 0.3 - (x > q.len * 0.22 ? 0.25 : 0)), px, py);
          }
          const M = c._usbM || (c._usbM = ramp(c.vc(e.color2 || "#c4ccd8", "extra")).map((h) => P(h)));
          const tx = (x - q.len * 0.26) / (q.len * 0.86);
          const vy = (ly - q.y0) / hh;
          for (const hx of [0.35, 0.68]) if (Math.abs(tx - hx) < 0.09 && vy < -0.1 && vy > -0.62) return P("#1a1c24");
          if (vy < -0.8) return M[4];
          if (vy > 0.75) return M[1];
          if (tx > 0.97) return M[2];
          return rampPick(M, clamp01(0.62 - vy * 0.25), px, py);
        }
        default:
          break;
      }
    }
    return 0;
  }
  function biteCut(xp, lx, ly) {
    let edge = Infinity;
    for (const q of xp) {
      if (q.e.type !== "bite") continue;
      for (const [cx, cy, r] of q.circles) {
        const d = Math.hypot(lx - cx, ly - cy) - r;
        if (d < 0) return -1;
        edge = Math.min(edge, d);
      }
    }
    return edge;
  }
  function bodyPix(c, G, xp, lx, ly, px, py, s, sw, still) {
    const u = (G.halfL - lx) / G.L;
    if (u < 0 || u > 1) return 0;
    const sy = still ? 0 : spineAt(c, u, sw);
    const top = G.halfTop(u), bot = G.halfBot(u);
    const ry = ly - sy;
    if (ry < -top || ry > bot) return 0;
    let biteEdge = Infinity;
    if (c.hasBite) {
      biteEdge = biteCut(xp, lx, ly);
      if (biteEdge < 0) return 0;
    }
    const L = G.L, H = G.H;
    const v = ry < 0 ? ry / Math.max(0.5, top) : ry / Math.max(0.5, bot);
    const dT = (ry + top) * s, dB = (bot - ry) * s;
    const chk = px + py & 1 ? 1 : -1;
    const T = c.T;
    const vb = c.vb, vbel = c.vbel;
    let R, idx;
    if (v < vb + chk * 0.035) {
      R = T.back;
      idx = 1.5 + 1.8 * clamp01((v + 1) / (vb + 1));
    } else if (v < vbel + chk * 0.035) {
      R = T.body;
      idx = 2.9 + 0.75 * clamp01((v - vb) / (vbel - vb));
    } else {
      R = T.belly;
      idx = 3.7 + 1.05 * clamp01((v - vbel) / (1 - vbel));
    }
    const opU = c.opU - 0.11 * v * v + 0.02;
    const inHead = u < opU;
    if (inHead) {
      if (T.head && R !== T.belly) R = T.head;
      if (v > -0.1 && v < 0.75) idx += 0.45;
      if (v < -0.5) idx -= 0.25;
      idx += (opU - u) * 0.8;
    }
    if (dT < 1.05) idx -= 1;
    if (dB < 1.2) idx -= 1.9;
    else if (dB < 2.3) idx -= 0.8;
    if (u > 0.82) idx -= (u - 0.82) * 3.5;
    patLight = 0;
    let patHit = false;
    for (const pat of c.patterns) {
      if (pat.umin !== void 0 && u < pat.umin) continue;
      if (pat.umax !== void 0 && u > pat.umax) continue;
      if (pat.vmin !== void 0 && v < pat.vmin) continue;
      if (pat.vmax !== void 0 && v > pat.vmax) continue;
      if (pat.body && inHead) continue;
      const pr = patternHit(c, pat, u, v, lx, ly, L, H, sw, px, py);
      if (pr) {
        patHit = true;
        if (pat.tone != null) idx += pat.tone * (pat.fade ? 1 - clamp01((v - pat.fade) / (1 - pat.fade)) : 1);
        else {
          R = pat.R7;
          if (pat.keepTone == null) idx = 3 + (idx - 3) * 0.6;
        }
        if (pat.glow) gOut = pat.R[3];
        if (pr === 2) idx -= 1.2;
        else if (pr === 3) idx += 1.2;
      }
    }
    idx += patLight * 4;
    if (c.scales && !inHead && u < 0.93 && v > -0.78 && v < 0.62) {
      const sc = c.scaleSize, rh = sc * 0.62;
      const row = Math.floor(ly / rh + 1e3);
      const off = (row & 1) * sc * 0.5;
      const fx = fract((lx + off) / sc);
      const fyPx = (ly - (row - 1e3) * rh) * s;
      const fade = hash2(Math.floor((lx + off) / sc), row, 23) < 0.12 + Math.max(0, u - 0.8) * 3 + Math.max(0, v - 0.35) * 2;
      if (!fade) {
        if (fyPx < 1 && fx > 0.2 && fx < 0.72) idx -= 0.9;
        else if (fyPx < 2 && (fx > 0.12 && fx <= 0.2 || fx >= 0.72 && fx < 0.8)) idx -= 0.55;
        else if (fyPx >= 1.4 && fyPx < 2.4 && fx > 0.36 && fx < 0.56 && v < 0.35) idx += 0.75;
      }
    }
    if (c.lateral && !inHead && u < 0.95) {
      const lv = (c.look.lateralV ?? vb * 0.45 + 0.02) + (u - opU) * 0.12;
      if (Math.abs(v - lv) * (lv < 0 ? top : bot) * s < 0.55 && (Math.floor(lx * s / 2) & 1) === 0) idx += 1.1;
    }
    if (c.gills && L * s >= 14 && v > -0.5 && v < 0.72) {
      const du = (u - opU) * L * s;
      if (du > -0.55 && du < 0.55) {
        if (R === T.belly) {
          R = T.body;
          idx = Math.min(idx - 1, 2.2);
        } else idx = Math.min(idx - 1.2, 1.8);
      } else if (du >= 0.55 && du < 1.6 && v > -0.4 && v < 0.6) idx += 0.5;
      const e0 = c.eyes[0];
      if (c.preop && L * s >= 40 && v > 0.1 && v < 0.6) {
        const pu = e0.u + (opU - e0.u) * 0.48 - 0.04 * v;
        if (Math.abs((u - pu) * L * s) < 0.5) idx -= 0.65;
      }
    }
    if (c.nostril && L * s >= 22) {
      const e0 = c.eyes[0];
      const nu = e0.u * 0.42, nv = e0.v * 0.55;
      if (Math.abs((u - nu) * L * s) < 0.55 && Math.abs((v - nv) * top * s) < 0.55) idx = 0.6;
    }
    if (c.shine && c.spec) {
      const sv0 = vb - 0.24, sv1 = vb - 0.02;
      if (v > sv0 && v < sv1 && u > 0.05 && u < 0.7) {
        const dash = u < opU + 0.04 || (Math.floor(lx * s / 2) & 1) === 0;
        if (dash) idx += 2.5 * c.spec * (1 - smoothstep(0.45, 0.7, u));
      }
      if (inHead && v > -0.82 && v < -0.5 && u > 0.04 && u < opU - 0.02) idx += 1.2 * c.spec;
    }
    let col = tone2(R, idx, px, py);
    if (biteEdge < 1.6 / s) col = hash2(px, py, 3) > 0.4 ? R[1] : R[2];
    if (c.alpha < 255) col = withA(col, c.alpha);
    if (c.look.organs) {
      const oc = organHit(c, u, v, sw, L, H);
      if (oc) col = oc;
    }
    if (c.mouth.type === "beak" && u < 0.13 && v > -0.38) {
      const R2 = c.mouth.R;
      col = rampPick(R2, clamp01(0.68 - v * 0.25 - u * 1.5), px, py);
      if (Math.abs(fract(u * L / Math.max(1.5, c.k)) - 0.5) < 0.12 && v > 0.1) col = R2[1];
    }
    void patHit;
    for (const q of xp) {
      const r = extraOnBody(c, q, u, v, ry, lx, ly, G, top, bot, px, py, sw, s);
      if (r) {
        col = r;
        if (q.e.glow) gOut = r;
      }
    }
    return col;
  }
  function extraOnBody(c, q, u, v, ry, lx, ly, G, top, bot, px, py, sw, s) {
    const e = q.e;
    const L = G.L, H = G.H, k = c.k;
    switch (e.type) {
      case "tie": {
        const cu = e.u ?? 0.24;
        const du = (u - cu) * L;
        if (ry > 0 && v < 1.02) {
          const t = v;
          const sc = Math.max(1, k * 0.75);
          const wdt = (t < 0.22 ? 0.95 : 0.6 + (t - 0.22) * 1.7 * (t < 0.75 ? 1 : (1 - t) * 3.4)) * sc;
          if (Math.abs(du) <= wdt) {
            const C1 = e.P || P("#d8283a"), C2 = e.P2 || C1;
            if (t < 0.22) return Math.abs(du) > wdt - 1 / s ? C2 : C1;
            if (Math.abs(du) > wdt - 1 / s) return C2;
            if (k > 1.6 && fract((du + t * H * 0.5) / (1.8 * sc)) < 0.3) return C2;
            return C1;
          }
        }
        return 0;
      }
      case "bolts": {
        const g = e.grid ?? 4 * Math.max(1, k * 0.75);
        const gx = Math.round(lx / g) * g, gy = Math.round(ly / g) * g;
        const br = Math.max(0.55, k * 0.38);
        if (hash2(gx, gy, 9) > 0.55 && u > 0.18 && u < 0.95) {
          const dd = Math.hypot(lx - gx, ly - gy);
          if (dd < br) {
            const B2 = e.P || P("#d8dde6");
            return dd < br * 0.5 && lx < gx && ly < gy ? P("#ffffff") : (lx > gx || ly > gy) && dd > br * 0.5 ? c.bodyR[0] : B2;
          }
        }
        return 0;
      }
      case "scar": {
        const sx = (u - (e.u ?? 0.5)) * L - ry * 0.6;
        if (Math.abs(sx) * s < 0.6 && Math.abs(ry) < top * 0.75) return e.P || P("#f3d6d0");
        if (e.stitches !== false && Math.abs(ry) < top * 0.7 && Math.abs(fract(ry / Math.max(1.5, k * 1.2)) - 0.5) * Math.max(1.5, k * 1.2) * s < 0.5 && Math.abs(sx) < Math.max(1.2, k * 0.7)) return e.P2 || P("#3a2430");
        return 0;
      }
      case "blush": {
        const cu = e.u ?? 0.24;
        if (Math.hypot((u - cu) * L / 1.6, (v - (e.v ?? 0.15)) * bot / 0.6) < Math.max(1.1, k * 0.9) && bayer(px, py) < 0.6) return e.P || P("#ff8fa8");
        return 0;
      }
      case "screen": {
        if ((py & 1) === 0) return e.P || P("#0a3a1f", 200);
        return 0;
      }
      case "barnacles": {
        const cs = e.size ?? clamp(3.2 * k, 3, 6.5);
        const gx = Math.floor(lx / cs), gy = Math.floor(ly / cs);
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const hx = gx + i, hy = gy + j;
          if (hash2(hx, hy, 41) > (e.density ?? 0.2)) continue;
          const cx = (hx + 0.5) * cs, cy = (hy + 0.5) * cs;
          const r = cs * (0.28 + hash2(hx, hy, 43) * 0.2);
          const dd = Math.hypot(lx - cx, ly - cy);
          if (dd < r && v < (e.vmax ?? 0.15)) {
            const B2 = c._barR || (c._barR = ramp(c.vc(e.color || "#b8b0a0", "extra")).map((h) => P(h)));
            if (dd < r * 0.38) return B2[0];
            return rampPick(B2, clamp01(0.75 - (ly - cy) / r * 0.3 - (lx - cx) / r * 0.2), px, py);
          }
        }
        return 0;
      }
      case "bandage": {
        const cu = e.u ?? 0.55, cv = e.v ?? -0.3;
        const ang = e.angle ?? 0.6;
        const dx = lx - (G.halfL - cu * L), dy = ly - cv * (cv < 0 ? top : bot);
        const a = dx * Math.cos(ang) + dy * Math.sin(ang), b = -dx * Math.sin(ang) + dy * Math.cos(ang);
        const bl = e.len ?? H * 0.4, bw = bl * 0.3;
        if (Math.abs(a) < bl / 2 && Math.abs(b) < bw / 2) {
          if (Math.abs(a) < bl * 0.17) return P("#f6e2c8");
          return (Math.floor(a * s) + Math.floor(b * s) & 3) === 0 ? P("#c8946a") : P("#e8b890");
        }
        return 0;
      }
      case "mustache": {
        const d2 = polyDist2(q.pts, lx, ly);
        const w = q.wid(pdT);
        if (d2 < w * w) return pdT < 0.6 && ly < q.pts[Math.round(pdT * 24)][1] - w * 0.3 ? e.P2 || P("#6a4420") : e.P || P("#3a2410");
        return 0;
      }
      default:
        return 0;
    }
  }
  function freePix(c, G, xp, lx, ly, px, py, s, sw, still) {
    for (const q of xp) {
      const e = q.e;
      if (q.box && !inBox(q.box, lx, ly)) continue;
      switch (e.type) {
        case "lure": {
          if (q.rr) {
            const [cx, cy] = q.sc;
            const dd = Math.hypot(lx - cx, ly - cy);
            const n = 8;
            const ang = Math.atan2(ly - cy, lx - cx);
            const i = Math.round((ang / TAU * n + n) % n) % n;
            const a = i / n * TAU;
            const dx = lx - (cx + Math.cos(a) * q.rr), dy = ly - (cy + Math.sin(a) * q.rr);
            const dr = Math.max(0.8, q.rr * 0.24);
            if (dx * dx + dy * dy < dr * dr) {
              const head = Math.floor(fract(sw) * n);
              const age = (head - i + n) % n;
              const cols = ["#ffffff", "#b8fbff", "#6ae4ff", "#3aa8d8", "#2a6a98", "#24507a", "#1e3e60", "#1e3e60"];
              const col = P(c.vc(cols[age], "extra"));
              if (age < 3) gOut = col;
              return col;
            }
            if (dd < q.rr * 0.45 && dd > q.rr * 0.45 - 1 / s) return P("#3a4658");
          } else {
            const [tx, ty] = q.tip;
            const dd = Math.hypot(lx - tx, ly - ty);
            if (dd < q.rb) {
              const bulb = P(c.vc(e.color2 || (e.glow ? "#c8fff0" : "#fff3b0"), "extra"));
              const core = dd < q.rb * 0.45 || lx < tx && ly < ty && dd < q.rb * 0.7;
              const col = core ? P("#ffffff") : bulb;
              if (e.glow) gOut = bulb;
              return col;
            }
          }
          if (polyDist2(q.pts, lx, ly) < q.w * q.w + 0.12) return withA(pdT > 0.9 ? e.P2 || e.P || P("#6a7080") : e.P || P("#5a5f70"), 253);
          break;
        }
        case "whiskers":
        case "feelers": {
          for (const pts of q.lines) if (polyDist2(pts, lx, ly) < q.w * q.w * (e.type === "whiskers" ? 1.25 : 1.6)) return withA(pdT > 0.7 ? e.P2 || e.P || (e.type === "feelers" ? c.finR[4] : P("#5a4030")) : e.P || (e.type === "feelers" ? c.finR[2] : P("#3b2a22")), 253);
          break;
        }
        case "barbel": {
          const [tx, ty] = q.tip;
          if (Math.hypot(lx - tx, ly - ty) < q.rb) {
            const col = e.P2 || P("#9affe8");
            if (e.glow) gOut = col;
            return Math.hypot(lx - tx + q.rb * 0.3, ly - ty + q.rb * 0.3) < q.rb * 0.4 ? P("#ffffff") : col;
          }
          if (polyDist2(q.pts, lx, ly) < q.w * q.w + 0.1) return withA(e.P || c.bodyR[1], 253);
          break;
        }
        case "antennae": {
          for (const [tx, ty] of q.tips) {
            if (Math.hypot(lx - tx, ly - ty) < q.rb) {
              const col = e.P2 || P(e.style === "rabbit" ? "#c8ccd8" : "#ff5577");
              if (e.glow) gOut = col;
              return Math.hypot(lx - tx + q.rb * 0.35, ly - ty + q.rb * 0.35) < q.rb * 0.45 ? P("#ffffff") : col;
            }
          }
          for (const pts of q.lines) if (polyDist2(pts, lx, ly) < q.w * q.w + 0.1) return withA(e.P || P(e.style === "rabbit" ? "#9aa2b4" : "#333344"), 253);
          if (e.style === "rabbit") {
            const [bx, by] = q.base;
            const rr2 = Math.max(1.2, c.k * 0.8);
            if (Math.abs(lx - bx) < rr2 * 1.6 && ly < by + 0.5 && ly > by - rr2) return P("#4a5060");
          }
          break;
        }
        case "cap": {
          const r = capPix(c, q, lx, ly, px, py, s);
          if (r) return r;
          break;
        }
        case "halo": {
          const nx = (lx - q.cx) / q.rx, ny = (ly - q.cy) / q.ry;
          const dd = Math.hypot(nx, ny);
          const tk = q.t / q.rx;
          if (Math.abs(dd - 1) < tk * (ny < 0 ? 0.8 : 1.1)) {
            const R = c._haloR || (c._haloR = ramp(c.vc(e.color || "#ffe066", "extra")).map((h) => P(h)));
            const col = rampPick(R, clamp01(0.62 - ny * 0.3 + (nx < -0.3 && ny < 0 ? 0.3 : 0)), px, py);
            gOut = R[3];
            return col;
          }
          break;
        }
        case "dome": {
          const nx = (lx - q.cx) / q.rx, ny = (ly - q.cy) / q.ry;
          if (ny > 0) break;
          const dd = Math.hypot(nx, ny);
          if (dd > 1) break;
          for (const [ox, sh] of [[-0.32, 0.75], [0.1, 1]]) {
            const ex = q.cx + ox * q.rx;
            const w = q.rx * 0.22 * sh;
            const y0 = q.cy - q.ry * 0.05, y1 = q.cy - q.ry * 0.62 * sh;
            if (Math.abs(lx - ex) < w && ly < y0 && ly > y1 - w * 0.6) {
              if (ly < y1 + w * 0.5) {
                const cc = P("#0c2a14");
                return Math.abs(lx - ex + w * 0.4) < w * 0.3 && ly < y1 ? P("#d8ffd0") : cc;
              }
              const G2 = c._domeR || (c._domeR = ramp(c.vc(e.color || "#62f07a", "eye")).map((h) => P(h)));
              const col = rampPick(G2, clamp01(0.7 - (lx - ex) / w * 0.35), px, py);
              gOut = G2[3];
              return sh < 1 ? withA(G2[1], 230) : col;
            }
          }
          if (dd > 1 - 1.2 / (s * q.rx)) return P("#d8f6ff", 200);
          if (nx < -0.2 && ny < -0.35 && Math.abs(dd - 0.78) < 0.08) return P("#ffffff", 210);
          return P(c.vc(e.color2 || "#bfefff", "extra"), 70);
        }
        case "monocle": {
          if (polyDist2(q.pts, lx, ly) < q.w * q.w + 0.1 && (Math.floor(pdT * 22) & 1) === 0) return e.P || P("#e8c040");
          break;
        }
        case "briefcase": {
          if (!e.draw) break;
          const x = lx - q.cx, y = ly - q.top;
          const hw = q.bw / 2;
          const B2 = c._caseR || (c._caseR = c.R7(c.vc(e.color || "#7a4422", "extra")));
          if (y < 0 && ly > q.hy && Math.abs(Math.abs(x) - hw * 0.28) < 0.6 / s) return B2[2];
          if (y < -Math.max(1, q.bh * 0.12) && y > -Math.max(1, q.bh * 0.12) - 1 / s && Math.abs(x) < hw * 0.28) return B2[2];
          if (y >= 0 && y <= q.bh && Math.abs(x) <= hw) {
            const ex = hw - Math.abs(x), ey = Math.min(y, q.bh - y);
            if (ex < 0.7 && ey < 0.7) return 0;
            if (Math.abs(x) < Math.max(0.6, q.bw * 0.06) && y < q.bh * 0.3 && y > q.bh * 0.08) return P(c.vc("#ffd23a", "extra"));
            if (Math.abs(y - q.bh * 0.3) < 0.5 / s) return B2[3];
            return tone2(B2, 3.8 - y / q.bh * 1.5 - (x > hw * 0.7 ? 0.6 : 0) + (y < 1 / s ? 1 : 0), px, py);
          }
          break;
        }
        default:
          break;
      }
    }
    if (G.spikeLen > 0.3) {
      const nx = lx / G.halfL, ny = ly / (G.H / 2);
      const rn = Math.hypot(nx, ny);
      const avgR = (G.halfL + G.H / 2) / 2;
      const d = (rn - 1) * avgR;
      if (d > -0.5 && d < G.spikeLen) {
        const ang = Math.atan2(ny, nx);
        const N = Math.round(14 + c.k * 3);
        const kk = Math.round(ang / TAU * N);
        const da = Math.abs(ang - kk * TAU / N) * avgR;
        if (da < (1 - d / G.spikeLen) * (0.7 + c.k * 0.35) + 0.2) return c.bodyR[d > G.spikeLen * 0.6 ? 4 : d < G.spikeLen * 0.2 ? 2 : 3];
      }
    }
    return 0;
  }
  function capPix(c, q, lx, ly, px, py, s) {
    const e = q.e;
    const style = e.style || "cap";
    const w = q.w, x = lx - q.cx, y = ly - q.cy;
    const C1 = c._capR || (c._capR = ramp(c.vc(e.color || (style === "tophat" ? "#2a2630" : style === "crown" ? "#ffd23a" : style === "beanie" ? "#3a4a6a" : "#d93a3a"), "extra")).map((h) => P(h)));
    const C2 = e.P2 || P(c.vc(style === "beanie" ? "#e8e0d0" : style === "tophat" ? "#c8283a" : "#c0c6d2", "extra"));
    if (style === "beanie") {
      const rx2 = w * 0.55, ry2 = w * 0.6;
      if (y <= 0.5 && (x / rx2) ** 2 + (y / ry2) ** 2 <= 1) {
        if (y > -w * 0.2) return (Math.floor(lx * s) & 1) === 0 ? C1[1] : C1[0];
        const rib = (Math.floor((x + rx2) * s / 2) & 1) === 0;
        return rampPick(C1, clamp01(0.62 - x / rx2 * 0.25 - (rib ? 0.15 : 0)), px, py);
      }
      const pr = w * 0.17;
      if (Math.hypot(x + w * 0.05, y + ry2 + pr * 0.6) < pr) return Math.hypot(x + w * 0.05 + pr * 0.3, y + ry2 + pr * 0.9) < pr * 0.45 ? P("#ffffff") : C2;
      return 0;
    }
    if (style === "tophat") {
      if (Math.abs(y) < w * 0.09 && Math.abs(x) < w * 0.62) return C1[1];
      if (y < 0 && y > -w * 0.85 && Math.abs(x) < w * 0.36) {
        if (y > -w * 0.25) return C2;
        return rampPick(C1, clamp01(0.55 - x / w), px, py);
      }
      return 0;
    }
    if (style === "crown") {
      if (y < 0.5 && y > -w * 0.25 && Math.abs(x) < w * 0.45) return rampPick(C1, clamp01(0.6 - x / w), px, py);
      const pts = 3;
      const fx = (x + w * 0.45) / (w * 0.9);
      if (fx >= 0 && fx <= 1 && y <= -w * 0.25) {
        const t = fract(fx * (pts - 1) + 0.5);
        const hh = w * 0.25 + w * 0.4 * (1 - Math.abs(t - 0.5) * 2);
        if (-y < hh) return rampPick(C1, clamp01(0.7 - x / w), px, py);
      }
      return 0;
    }
    const rx = w * 0.5, ry = w * 0.48;
    if (y <= 0.5 && (x / rx) ** 2 + (y / ry) ** 2 <= 1) {
      if (Math.abs(x) < Math.max(0.5 / s, w * 0.04) && y < -ry * 0.2) return C1[1];
      return rampPick(C1, clamp01(0.65 - x / rx * 0.25 - y / ry * 0.15), px, py);
    }
    if (Math.hypot(Math.max(0, y + w * 0.02) * 4, 0) < 1 && y > -w * 0.12 && y < w * 0.08 && x > rx * 0.6 && x < rx + w * 0.55) return C2;
    return 0;
  }
  function genericExtent(c, G) {
    const { L, H, halfL, TL, TS } = G;
    let finTop = 0, finBot = 0, leanBack = 0;
    for (const f of c.fins) {
      if (f.slot === "top") finTop = Math.max(finTop, f.h * 1.6);
      else finBot = Math.max(finBot, f.h * 1.35);
      leanBack = Math.max(leanBack, f.lean * f.h - (1 - f.to) * L);
    }
    let exTop = 0, exFront = 0, exBot = 0, exBack = 0;
    for (const e of c.extras) {
      switch (e.type) {
        case "lure": {
          const r = e.spinner ? (e.r ?? Math.max(2.5, H * 0.14)) * 2.4 : (e.r ?? H * 0.08) + 1;
          exTop = Math.max(exTop, (e.h ?? H * 0.9) * 0.55 + r + 2 * c.k + 2);
          exFront = Math.max(exFront, (e.reach ?? L * 0.35) - L * 0.12 + r + 2);
          break;
        }
        case "whiskers":
          exFront = Math.max(exFront, 2);
          exBot = Math.max(exBot, (e.len ?? H * 0.5) * 0.8);
          break;
        case "feelers":
          exBot = Math.max(exBot, (e.len ?? L * 0.7) * 0.7 + H * 0.15);
          exBack = Math.max(exBack, (e.len ?? L * 0.7) * 0.8 - L * (1 - (e.u ?? 0.36)));
          break;
        case "barbel":
          exBot = Math.max(exBot, (e.len ?? H * 0.8) * 0.85 + 2);
          break;
        case "cap":
          exTop = Math.max(exTop, (e.w ?? H * 0.55) * 1.35);
          exFront = Math.max(exFront, (e.w ?? H * 0.55) * 0.5);
          break;
        case "antennae":
          exTop = Math.max(exTop, (e.len ?? H * 0.75) + 3);
          break;
        case "halo":
          exTop = Math.max(exTop, (e.h ?? H * 0.36) + (e.r ?? L * 0.16) * 0.35 + 3);
          break;
        case "dome":
          exTop = Math.max(exTop, (e.ry ?? H * 0.85) * 0.75);
          break;
        case "badge":
          exTop = Math.max(exTop, (e.r ?? H * 0.15) * 1.3);
          break;
        case "usb":
          exFront = Math.max(exFront, (e.len ?? L * 0.42) * 1.1);
          break;
        case "clownnose":
          exFront = Math.max(exFront, (e.r ?? H * 0.11) * 1.2);
          break;
        case "monocle":
          exBot = Math.max(exBot, c.eyes[0].r * 3);
          break;
        case "briefcase":
          if (e.draw) exBot = Math.max(exBot, (e.w ?? H * 0.95) * 0.62 + H * 0.2 + 2);
          break;
        case "kype":
          exFront = Math.max(exFront, (e.len ?? H * 0.22) + 2);
          exBot = Math.max(exBot, H * 0.2);
          break;
        default:
          break;
      }
    }
    let eyTop = 0, eyBot = 0;
    for (const e of c.eyes) {
      const ey = e.v * H / 2, R = e.r * 2.9 + 2;
      eyTop = Math.max(eyTop, -(ey - R) - H / 2);
      eyBot = Math.max(eyBot, ey + R - H / 2);
    }
    const mw = c.mouth.w;
    exFront = Math.max(exFront, mw * 0.5 + 1);
    exBot = Math.max(exBot, c.mouth.type === "gulper" ? mw * 0.65 : mw * 0.6);
    const tailV = Math.max(TS, 0) + TL * 0.4;
    const bend = c.bend + 1;
    const pecBot = c.pectoral ? c.pectoral.len : 0;
    const top = H / 2 * (1 + Math.max(0, c.hump)) + Math.max(finTop, exTop, eyTop) + G.spikeLen + bend + 2;
    const bot = H / 2 * (1 + Math.max(0, c.belly)) + Math.max(finBot, exBot, pecBot, eyBot) + G.spikeLen + bend + 3;
    return [-halfL - Math.max(TL * 1.35, leanBack, exBack) - 3, -Math.max(top, tailV + 2), halfL + exFront + G.spikeLen * 0.5 + 3, Math.max(bot, tailV + 2)];
  }
  function layerBox(c, G, mode, ext2) {
    const { halfL, TL, TS, H } = G;
    if (mode === "tail") {
      const v = TS + TL * 0.45 + 2;
      return [-halfL - TL * 1.4 - 2, -v, -halfL + 3, v];
    }
    if (mode === "front") {
      const pec = c.pectoral;
      if (!pec) return [0, 0, 0, 0];
      const x = halfL - pec.u * G.L, y = pec.v * G.halfBot(pec.u), r = pec.len * 1.2 + 2;
      return [x - r, y - r, x + r, y + r];
    }
    if (mode === "back") {
      let top = 0, bot = 0, lean = 0;
      for (const f of c.fins) {
        if (f.slot === "top") top = Math.max(top, f.h * 1.6);
        else bot = Math.max(bot, f.h * 1.35);
        lean = Math.max(lean, f.lean * f.h);
      }
      return [-halfL - lean - 2, -H / 2 * (1 + Math.max(0, c.hump)) - top - 2, halfL + 2, H / 2 * (1 + Math.max(0, c.belly)) + bot + 2];
    }
    return [Math.max(ext2[0], -halfL - c.bend - 3 - (c.extras.some((e) => e.type === "feelers") ? G.L : 0)), ext2[1], ext2[2], ext2[3]];
  }
  function paintGeneric(c, buf, glow, bx, by, ox, oy, angle, s, mode, prm, G, rect) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const still = !!prm.still;
    const sw = prm.sw || 0, tp = prm.tp ?? sw, fp = prm.fp ?? sw;
    const all = mode === "all";
    const bodyish = all || mode === "body";
    const xp = bodyish ? prepExtras(c, G, sw, still, s) : null;
    const tailBaseY = all && !still ? spineAt(c, 1, sw) : 0;
    const finSw = all && !still ? sw : null;
    const pecBaseY = all && !still && c.pectoral ? spineAt(c, c.pectoral.u, sw) : 0;
    const glitch = bodyish ? c.look.glitch || 0 : 0;
    const gframe = Math.floor(fract(sw) * 8);
    const W = buf.w;
    for (let py = rect.y0; py < rect.y1; py++) {
      let shift = 0, tint = 0;
      if (glitch) {
        const band = py >> 1;
        if (hash2(band, gframe, 77) < glitch * 0.28) shift = Math.round((hash2(band, gframe, 78) - 0.5) * 7 * c.k);
        const th = hash2(band, gframe, 79);
        if (th < glitch * 0.14) tint = th < glitch * 0.07 ? 1 : 2;
      }
      for (let px = rect.x0; px < rect.x1; px++) {
        const dx = px + shift + 0.5 - ox, dy = py + 0.5 - oy;
        const lx = (dx * ca + dy * sa) / s, ly = (-dx * sa + dy * ca) / s;
        gOut = 0;
        let col = 0;
        if (all) {
          const body = overlayPix(c, xp, lx, ly, px, py, s, G) || bodyPix(c, G, xp, lx, ly, px, py, s, sw, still);
          col = body;
          const pc = pecPix(c, G, lx, ly, px, py, s, fp, pecBaseY, still);
          if (pc) col = body ? blendPacked(body, pc, c.finAlpha) : pc;
          if (!col) col = finPix(c, G, lx, ly, px, py, s, fp, finSw, still, prm.raise || 0) || tailPix(c, G, lx, ly, px, py, s, tp, tailBaseY) || freePix(c, G, xp, lx, ly, px, py, s, sw, still);
        } else if (mode === "body") {
          col = overlayPix(c, xp, lx, ly, px, py, s, G) || bodyPix(c, G, xp, lx, ly, px, py, s, sw, still) || freePix(c, G, xp, lx, ly, px, py, s, sw, still);
        } else if (mode === "back") col = finPix(c, G, lx, ly, px, py, s, fp, null, still, prm.raise || 0);
        else if (mode === "tail") col = tailPix(c, G, lx, ly, px, py, s, tp, 0);
        else if (mode === "front") col = pecPix(c, G, lx, ly, px, py, s, fp, 0, still);
        if (col) {
          if (tint) col = tint === 1 ? (col & 4278255615 | 16711680 | col & 4278190080) >>> 0 : (col & 4294967040 | 255) >>> 0;
          const i = (py - by) * W + (px - bx);
          buf.data[i] = col;
          if (glow && gOut) glow.data[i] = gOut;
        }
      }
    }
  }
  function genericFace(c, G, sw, angle, s, ox, oy, still) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const toC = (x, y) => [ox + (x * ca - y * sa) * s, oy + (x * sa + y * ca) * s];
    const sp = (u) => still ? 0 : spineAt(c, u, sw);
    const eyes = c.eyes.map((e, i) => {
      const [ex, ey, er] = eyeLocal(c, G, e, sw, still);
      const [x, y] = toC(ex, ey);
      return { x, y, r: er * s, e, idx: i, mirror: false, cheek: i === 0, main: i === 0, angle };
    }).sort((a, b) => (b.e.behind ? 1 : 0) - (a.e.behind ? 1 : 0));
    const my = sp(0) + G.mouthY;
    const [mx, myc] = toC(G.halfL - Math.max(0.5, c.mouth.w * 0.1), my);
    let finTop = 0;
    for (const f of c.fins) if (f.slot === "top") finTop = Math.max(finTop, f.h);
    const anchors = {
      mouth: toC(G.halfL + 0.5, my),
      tail: toC(-G.halfL - G.TL * 0.8, sp(1)),
      top: toC(G.halfL * 0.2, -G.H / 2 - finTop * 0.6),
      bottom: toC(0, G.H / 2)
    };
    for (const e of c.extras) {
      if (e.type === "lure") {
        const q = prepExtras({ ...c, extras: [e] }, G, sw, still, s)[0];
        anchors.lure = toC(...q.sc || q.tip);
      }
      if (e.type === "briefcase") anchors.hand = toC(G.halfL * 0.25, G.H / 2 + 0.5);
    }
    const off = (u) => {
      const d = sp(u);
      return [Math.round(-d * sa * s), Math.round(d * ca * s)];
    };
    let gill = null;
    if (c.gills && G.L * s >= 14 && !c.look.noGill) {
      const pts = [];
      const n = Math.max(6, Math.ceil(G.H * s * 0.9));
      for (let i = 0; i <= n; i++) {
        const v = -0.42 + i / n * 1.06;
        const u = c.opU - 0.11 * v * v + 0.02 + 0.9 / (G.L * s);
        const yy = sp(u) + v * (v < 0 ? G.halfTop(u) : G.halfBot(u)) * 0.96;
        pts.push(toC(G.halfL - u * G.L, yy));
      }
      gill = { pts, nx: -ca, ny: -sa };
    }
    return {
      gill,
      eyes,
      mouth: { x: mx, y: myc, w: c.mouth.w * s, m: c.mouth, front: false, angle },
      anchors,
      offsets: { tail: off(1), back: off(0.5), front: c.pectoral ? off(c.pectoral.u) : [0, 0], body: [0, 0] }
    };
  }
  var EMO = {
    neutral: { lid: -0.95, slant: 0, low: 1.2, pupil: 1, wide: 1, brow: null, mouth: { smile: 0.24 } },
    happy: { closed: "arc", blush: true, brow: [-1.6, 0, "arch"], mouth: { smile: 0.55, openBias: 0.15, laugh: true } },
    sad: { lid: -0.4, slant: -0.42, low: 1.2, pupil: 1.05, lookY: 0.35, brow: [-1.42, -0.5], tears: true, mouth: { smile: -0.4 } },
    angry: { lid: -0.28, slant: 0.55, low: 0.85, pupil: 0.8, brow: [-1.22, 0.62], vein: true, mouth: { smile: -0.22, teeth: true } },
    scared: { lid: -1.1, slant: 0, low: 1.2, pupil: 0.42, wide: 1.1, brow: [-1.75, -0.35, "arch"], sweat: true, shake: true, mouth: { wave: 0.11, openBias: 0.1, teeth: true } },
    surprised: { lid: -1.1, slant: 0, low: 1.2, pupil: 0.45, wide: 1.14, brow: [-1.9, 0, "arch"], mouth: { O: 0.6 } },
    love: { heart: true, blush: true, lid: -0.95, slant: 0, low: 1.2, brow: null, mouth: { smile: 0.4 } },
    sleepy: { lid: 0.05, slant: -0.1, low: 0.9, pupil: 0.9, lookY: 0.45, brow: null, mouth: { O: 0.2 } },
    dizzy: { spiral: true, brow: [-1.5, -0.2, "wavy"], mouth: { wave: 0.14 } },
    smug: { lid: -0.18, slant: -0.12, low: 0.55, lowCurve: 0.25, pupil: 0.95, lookX: -0.55, brow: [-1.55, -0.28], mouth: { smirk: 0.55 } },
    determined: { lid: -0.45, slant: 0.38, low: 1, pupil: 0.85, brow: [-1.3, 0.45], mouth: { smile: -0.06, teeth: true, flat: true } },
    tired: { lid: -0.08, slant: -0.25, low: 1.2, pupil: 0.95, lookY: 0.35, bags: true, sweat: true, brow: [-1.38, -0.22], mouth: { smile: -0.18, openBias: 0.12 } },
    disgust: { lid: -0.42, slant: 0.22, low: 0.48, lowCurve: 0.15, pupil: 0.85, lookX: -0.5, brow: [-1.35, 0.3, "wavy"], green: true, mouth: { wave: 0.1, tongue: true } }
  };
  var REAL = {
    neutral: {},
    happy: { pupil: 1.05, breath: 0.9 },
    sad: { pupil: 0.95, ly: 0.45, gape: 0.05, breath: 0.8, flush: ["#5a6a80", 0.12] },
    angry: { pupil: 0.66, gape: 0.18, raise: 1, breath: 2, flush: ["#3a0810", 0.2] },
    scared: { pupil: 1.4, gape: 0.2, raise: 1, breath: 3, twitch: 1, flush: ["#e8f4ff", 0.16] },
    surprised: { pupil: 1.45, gape: 0.42, raise: 1, breath: 1.5 },
    love: { pupil: 1.3, breath: 1.2, flush: ["#ff6a8a", 0.1] },
    sleepy: { pupil: 0.8, dim: 0.3, ly: 0.3, breath: 0.45, flush: ["#101828", 0.12] },
    dizzy: { spin: 1, gape: 0.12, breath: 1.4 },
    smug: { pupil: 0.9, lx: -0.55 },
    determined: { pupil: 0.72, gape: 0.08, raise: 1, breath: 1.6, flush: ["#14101c", 0.12] },
    tired: { pupil: 0.9, ly: 0.35, gape: 0.25, breath: 1.4, flush: ["#7a8aa0", 0.12] },
    disgust: { pupil: 0.82, lx: -0.6, gape: 0.35, breath: 2.4, flush: ["#6a8a3a", 0.12] }
  };
  function realCues(name) {
    return REAL[name] || REAL.neutral;
  }
  var MOUTH_IN = [P("#12040a"), P("#280a14"), P("#481424"), P("#7a2a3a"), P("#a04a58")];
  var EYE_RING = P("#120c14");
  var PUPIL_EDGE = P("#2a2234");
  var SCLERA = [P("#a8b4cc"), P("#c8d2e2"), P("#e6ecf6"), P("#ffffff"), P("#ffffff")];
  var HEART = ramp("#ff4d7a").map((h) => P(h));
  var TEAR = P("#8fd8ff");
  var TEAR_D = P("#3a8ad0");
  var WHITE = P("#ffffff");
  var VEIN = P("#ff3a3a");
  var VEIN_D = P("#8a1020");
  var BLUSH = P("#ff7a9a", 210);
  var GREEN = P("#86c86a", 220);
  var eyeBox = (R) => Math.ceil(R * 2.7 + 5);
  function eyeCore(ex, ey, d, R, e, pxo, pyo, pupR, f, x, y) {
    if (d > 1 - (R < 3.2 ? 0.75 : 1) / R) return EYE_RING;
    const dp = Math.hypot(ex - pxo, ey - pyo);
    const hr = Math.max(0.55 / R, R >= 3.4 ? 0.3 : 0.32);
    const hx = -0.3 + pxo * 0.3, hy = -0.34 + pyo * 0.3;
    if (!f.noGlint && Math.hypot(ex - hx, ey - hy) < hr) return WHITE;
    if (R >= 4 && !f.noGlint && Math.hypot(ex - 0.3 - pxo * 0.3, ey - 0.32 - pyo * 0.3) < 0.55 / R) return P("#e8eef8");
    if (dp < pupR) return dp > pupR - 0.9 / R && R >= 3.2 ? PUPIL_EDGE : e.pupil;
    const b = 0.72 + ey * 0.28 - (dp < pupR + 0.95 / R ? 0.22 : 0) - (f.dim || 0) - (ey < -0.48 ? 0.25 : 0);
    return rampPick(e.realIris, clamp01(b), x, y);
  }
  function paintEye(buf, glow, cx, cy, c, e, f, ang, R) {
    const toon = c.toon || e.type === "googly" || e.type === "pixel";
    const em = toon ? EMO[f.emotion] || EMO.neutral : EMO.neutral;
    const hb = eyeBox(R);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const blink = clamp01(f.blink || 0);
    const tiny = e.type === "dot" || R < 2.3;
    const wide = tiny ? 1 : em.wide || 1;
    const lidR = e.lidR || c.bodyR;
    const th = Math.max(1, R * 0.17) / R;
    const x0 = Math.floor(cx - hb), x1 = Math.ceil(cx + hb), y0 = Math.floor(cy - hb), y1 = Math.ceil(cy + hb);
    const shake = em.shake ? (Math.floor((f.time || 0) * 30) & 1) * 0.6 / R : 0;
    let lx = (f.lx || 0) + (em.lookX || 0), ly = (f.ly || 0) + (em.lookY || 0);
    const lm = Math.hypot(lx, ly);
    if (lm > 1) {
      lx /= lm;
      ly /= lm;
    }
    const irisR = e.irisR ? e.irisSize ?? 0.68 : 0;
    const pupR = Math.min(0.8, R < 3.2 && e.type === "normal" ? 1 - 1.45 / R : 1, (e.pupilSize ?? 0.48) * (f.pupil || 1) * (toon ? em.pupil || 1 : 1));
    const maxOff = Math.max(0, 1 - pupR - 0.16);
    let pxo = lx * maxOff + shake, pyo = ly * maxOff + (toon ? 0 : blink * 0.18);
    if (!toon && blink > 0.5) f = { ...f, noGlint: true };
    void irisR;
    if (e.type === "googly") {
      pxo = (f.gx ?? 0) * 0.42;
      pyo = (f.gy ?? 0.42) * 0.42;
    }
    const closedArc = em.closed === "arc";
    const closedBlink = toon && blink >= 0.86;
    const time = f.time || 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const ex = (dx * ca + dy * sa) / R, ey = (-dx * sa + dy * ca) / R;
        const mx = f.mirror ? -ex : ex;
        const d = Math.hypot(ex, ey) / wide;
        let col = 0, gl = 0;
        if (e.type === "pixel") {
          const sq = Math.max(Math.abs(ex), Math.abs(ey));
          if (em.spiral) {
            if (sq < 0.95 && (Math.abs(ex - ey) < 0.4 || Math.abs(ex + ey) < 0.4)) col = e.sclera;
          } else if (closedArc || blink > 0.5 || em.lid > -0.2) {
            if (sq < 0.95 && Math.abs(ey - 0.2) < 0.38) col = e.sclera;
          } else if (sq < 0.9) col = em.heart ? HEART[3] : e.sclera;
          if (col) buf.set(x, y, col);
          continue;
        }
        if (d <= 1) {
          if (tiny) {
            if (closedArc) {
              if (Math.abs(ey + 0.1 - Math.abs(ex) * 0.55) < 0.45) col = lidR[0];
            } else if (closedBlink) {
              if (Math.abs(ey - 0.1) < 0.45) col = lidR[0];
            } else if (em.heart) col = d < 0.95 ? HEART[2] : 0;
            else {
              col = d < 0.95 ? d > 0.6 && ey > 0.1 ? rampPick(e.realIris, 0.5, x, y) : e.pupil : 0;
              if (R >= 1.6 && ex < -0.1 && ey < -0.1 && d < 0.75 && !f.noGlint) col = WHITE;
              if (e.type === "glow") {
                col = d < 0.5 ? WHITE : P(e.glowHex);
                gl = P(e.glowHex);
              }
            }
          } else if (closedArc && e.type !== "googly" || closedBlink) {
            const yl = closedArc ? -0.12 + 0.62 * Math.abs(ex) ** 1.15 : 0.12 + 0.24 * (1 - ex * ex);
            if (Math.abs(ey - yl) < th * 0.75 && Math.abs(ex) < 0.92) col = c.mouth.lineP;
            else if (ey < yl || closedArc) col = rampPick(lidR, clamp01(0.6 - ey * 0.25), x, y);
            else col = 0;
            if (col && d > 1 - 1 / R && !(Math.abs(ey - yl) < th * 0.75)) col = closedArc && ey > yl ? 0 : lidR[1];
          } else {
            let yU = (em.lid ?? -0.95) + (em.slant || 0) * mx - 0.12 * (1 - mx * mx);
            yU = toon ? Math.max(yU, -1.05 + 2.1 * blink) : -2;
            let yL = toon ? (em.low ?? 1.2) - (em.lowCurve || 0) * mx * mx : 2;
            if (e.type === "googly") {
              yU = blink ? -1.05 + 2.1 * blink : -2;
              yL = 2;
            }
            if (ey < yU) {
              col = Math.abs(ey - yU) < th ? c.mouth.lineP : rampPick(lidR, clamp01(0.62 - ey * 0.3), x, y);
            } else if (ey > yL) {
              col = Math.abs(ey - yL) < th * 0.8 ? lidR[0] : rampPick(lidR, clamp01(0.5 - ey * 0.15), x, y);
            } else if (e.type === "googly") {
              const gd = Math.hypot(ex - pxo, ey - pyo);
              if (d > 1 - Math.max(1.6, R * 0.16) / R) col = P("#1a1424");
              else if (gd < 0.5) col = gd < 0.48 && ex - pxo < -0.15 && ey - pyo < -0.15 && gd > 0.2 ? P("#3a3448") : P("#14101c");
              else if (ex < -0.25 && ey < -0.25 && Math.abs(d - 0.62) < 0.1) col = WHITE;
              else col = ex * 0.45 + ey > 0.5 ? SCLERA[2] : SCLERA[3];
            } else if (em.heart) {
              const hx = (ex - pxo * 0.4) / 0.95, hy = -(ey - pyo * 0.4) / 0.95 + 0.15;
              const hv = (hx * hx + hy * hy - 0.42) ** 3 - hx * hx * hy * hy * hy * 1.15;
              if (hv < 0) col = hx < -0.15 && hy > 0.2 && hv < -4e-3 && hx > -0.55 ? HEART[4] : rampPick(HEART, clamp01(0.62 + hy * 0.3), x, y);
              else col = d > 1 - 1 / R ? SCLERA[0] : SCLERA[3];
            } else if (em.spiral) {
              const rot = Math.floor(time * 8) * 0.8;
              const t = fract(d * 2.3 - (Math.atan2(ey, ex) + rot) / TAU);
              col = t < 0.32 ? P("#2a1a34") : SCLERA[3];
              if (d > 1 - 1 / R) col = SCLERA[0];
            } else if (e.type === "glow") {
              const g = P(e.glowHex);
              const gd = Math.hypot(ex - pxo * 0.6, ey - pyo * 0.6);
              col = gd < 0.32 ? WHITE : d > 0.82 ? P(shade(e.glowHex, -0.35)) : g;
              if (e.iris) {
                const pd = Math.hypot(ex - pxo, ey - pyo);
                if (pd < 0.22 * (em.pupil || 1)) col = e.pupil;
              }
              gl = g;
            } else {
              col = eyeCore(ex, ey, d, R, e, pxo, pyo, pupR, f, x, y);
            }
          }
        } else {
          if (!tiny && d <= 1 + 1.05 / R && !closedArc) col = e.type === "googly" ? P("#1a1424") : 0;
          if (c.monocle && f.main && !tiny) {
            const mr = 1.28 + 0.35 * c.k / R, mt = Math.max(1.2, R * 0.16) / R;
            if (d > mr - mt && d < mr + mt) col = ex < -0.3 && ey < -0.3 ? P("#fff6c0") : ey > 0.3 ? P("#a87818") : P("#e8c040");
          }
          const brow = toon ? em.brow : null;
          if (brow && e.brow !== false && R >= 2.4 && (f.main || e.brow) && Math.abs(mx) < 0.95) {
            let by = brow[0] * Math.max(1, wide) + brow[1] * mx;
            if (brow[2] === "arch") by -= 0.28 * (1 - mx * mx);
            if (brow[2] === "wavy") by += 0.14 * Math.sin(mx * 6.5);
            const bt = Math.max(1.2, R * 0.24) / R * (1 - 0.35 * Math.abs(mx));
            if (Math.abs(ey - by) < bt) col = lidR[0];
          }
          if (f.cheek && (em.blush || toon && e.blush) && Math.hypot((mx + 0.35) / 0.9, (ey - 1.5) / 0.4) < 1 && bayer(x, y) < 0.62) col = col || BLUSH;
          if (f.cheek && em.green) {
            for (const gx of [-0.6, -0.15, 0.3]) if (Math.abs(mx - gx) < 0.5 / R + 0.05 && ey > 1.25 && ey < 1.8) col = col || GREEN;
          }
          if (em.bags && ey > 0.95 && ey < 1.4 && Math.abs(Math.hypot(ex, (ey - 0.1) / 1.1) - 1.12) < th * 0.8) col = col || lidR[0];
          if (em.tears && f.cheek) {
            for (let k = 0; k < 3; k++) {
              const ty = 0.95 + fract(time * 0.9 + k / 3) * 1.6;
              const tx = -0.85 - (ty - 0.95) * 0.15;
              const tr = Math.max(0.9, R * 0.22) / R;
              if (Math.hypot(mx - tx, ey - ty) < tr * (k === 0 ? 1.2 : 1)) col = Math.hypot(mx - tx + tr * 0.35, ey - ty + tr * 0.35) < tr * 0.45 ? WHITE : TEAR;
            }
            if (Math.abs(mx + 0.86) < 0.6 / R + 0.04 && ey > 0.9 && ey < 1.3) col = col || TEAR;
          }
          if (em.sweat && f.main) {
            const bob = Math.sin(time * 6) * 0.08;
            const sx = 1.2, sy = -1.25 + bob, sr = Math.max(1.4, R * 0.42) / R;
            const ddx = mx - sx, ddy = ey - sy;
            const inDrop = Math.hypot(ddx, ddy) < sr || ddy < 0 && ddy > -sr * 2.2 && Math.abs(ddx) < sr * (1 + ddy / (sr * 2.2));
            const nearDrop = Math.hypot(ddx, ddy) < sr + 1 / R || ddy < 0 && ddy > -sr * 2.2 - 1 / R && Math.abs(ddx) < sr * (1 + ddy / (sr * 2.2)) + 1 / R;
            if (inDrop) col = ddx < -sr * 0.1 && ddy < -sr * 0.1 && ddy > -sr * 0.9 ? WHITE : TEAR;
            else if (nearDrop) col = TEAR_D;
          }
          if (em.vein && f.main) {
            const pulse = 1 + 0.12 * (Math.floor(time * 6) & 1);
            const vs = 0.62 * pulse * Math.max(1, 3.2 / R);
            const ax = (ex + 0.45) / vs, ay = (ey + 2.15) / vs;
            if (Math.abs(ax) < 1.05 && Math.abs(ay) < 1.05) {
              const vt = Math.max(0.16, 0.9 / (R * vs));
              for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
                const dd = Math.hypot(ax - sx * 0.95, ay - sy * 0.95);
                if (Math.abs(dd - 0.62) < vt && Math.sign(ax) === sx && Math.sign(ay) === sy) col = VEIN;
                else if (Math.abs(dd - 0.62) < vt + 0.9 / (R * vs) && Math.sign(ax) === sx && Math.sign(ay) === sy) col = col || VEIN_D;
              }
            }
          }
        }
        if (col) {
          buf.set(x, y, col);
          if (glow && gl) glow.set(x, y, gl);
        }
      }
    }
  }
  var mouthBox = (W) => Math.ceil(W * 1.25 + 5);
  function realJaw(c, m, t, ux, uy, W, open, sm, x, y) {
    if (t < -0.02 || t > 1.04) return 0;
    const tc = clamp01(t);
    const jaw = W * (m.sag ?? 0.1) * Math.pow(tc, 1.4) - sm * W * 0.3 * tc * tc;
    const line = m.lineP;
    const lips = m.type === "lips";
    const lipT = lips ? Math.max(1.5, W * 0.22) : 0;
    if (open > 0.06) {
      const low = jaw + open * W * 0.55 * Math.pow(1 - tc, 1.1) + 0.5;
      if (uy > jaw + 0.5 && uy < low) {
        if ((m.type === "fangs" || m.teeth) && (uy - jaw < 1.6 || low - uy < 1.4) && (Math.floor(-ux / Math.max(1.5, W * 0.12)) & 1) === 0) return WHITE;
        return rampPick(MOUTH_IN, clamp01(0.12 + (uy - jaw) / Math.max(1, low - jaw) * 0.3 + (1 - tc) * 0.25), x, y);
      }
      if (uy >= low && uy < low + 1.2 + lipT * 0.6 && tc < 0.96) return lips ? rampPick(m.R, 0.5, x, y) : c.bellyR[2];
      if (Math.abs(uy - jaw) < 0.6) return line;
      if (lips && uy < jaw && uy > jaw - lipT && tc < 0.55) return rampPick(m.R, 0.7, x, y);
      return 0;
    }
    if (Math.abs(uy - jaw) < 0.6 && t > 0.03) return line;
    if (lips && tc < 0.5 && Math.abs(uy - jaw) < lipT) return rampPick(m.R, uy < jaw ? 0.75 : 0.45, x, y);
    if (m.type === "fangs") {
      for (const ft of [0.2, 0.55]) {
        const fl = Math.max(1.5, W * 0.2) * (ft < 0.3 ? 1 : 0.8);
        if (Math.abs(t - ft) * W < Math.max(0.6, W * 0.05) * (1 - (uy - jaw) / fl) && uy > jaw && uy < jaw + fl) return WHITE;
      }
    }
    if (uy < jaw - 0.6 && uy > jaw - 1.6 && t > 0.08 && t < 0.7) return c.bodyR[4];
    return 0;
  }
  function paintMouth(buf, mx, my, c, m, f, ang, W, front = false) {
    if (!m || m.type === "none" || W < 1) return;
    const em = (c.toon ? EMO[f.emotion] || EMO.neutral : EMO.neutral).mouth || {};
    const hb = mouthBox(W);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let open = clamp01(f.open || 0);
    if (open > 0.05 && em.openBias) open = Math.min(1, open + em.openBias);
    const O = em.O && open < 0.5 ? em.O * (0.7 + open) : 0;
    const line = m.lineP;
    const inside = P("#2a0b18"), tongue = P("#ff6f8f"), tongueH = P("#ffb0c4");
    const lipsR = m.R;
    const W2 = front ? W / 2 : W;
    const sm = (em.smile || 0) + (m.smile || 0);
    for (let y = Math.floor(my - hb); y <= Math.ceil(my + hb); y++) {
      for (let x = Math.floor(mx - hb); x <= Math.ceil(mx + hb); x++) {
        const dx = x + 0.5 - mx, dy = y + 0.5 - my;
        const ux = dx * ca + dy * sa, uy = -dx * sa + dy * ca;
        let col = 0;
        const t = front ? Math.abs(ux) / W2 : -ux / W;
        const curveY = (tt) => {
          let yy = 0;
          if (front) {
            if (sm) yy += sm * W * 0.32 * (1 - tt * tt);
            if (em.smirk) yy += ux > 0 ? em.smirk * W * 0.35 * (1 - tt * tt) : 0;
            if (em.wave) yy += em.wave * W * Math.sin(ux / W * TAU * 1.6);
          } else {
            if (sm) yy -= sm * W * 0.42 * tt * tt;
            if (em.smirk) yy -= em.smirk * W * 0.7 * Math.max(0, tt - 0.45) ** 2 / 0.3;
            if (em.wave) yy += em.wave * W * Math.sin(tt * TAU * 1.3);
          }
          return yy;
        };
        const type = m.type;
        if (!front && (type === "small" || type === "big" || type === "fangs" || type === "lips")) {
          col = realJaw(c, m, t, ux, uy, W, open, c.toon ? sm * 0.6 : (m.smile || 0) * 0.6, x, y);
        } else if (type === "lips") {
          const lx0 = front ? ux : ux + W * 0.05;
          if (open > 0.12 || O) {
            const rr2 = W * (0.28 + 0.25 * Math.max(open, O));
            const dd = Math.hypot(lx0 / 1.1, uy);
            if (dd < rr2 * 0.6) col = dd < rr2 * 0.3 && uy > 0 ? tongue : inside;
            else if (dd < rr2) col = rampPick(lipsR, clamp01(0.7 - uy / rr2 * 0.4), x, y);
          } else {
            const up = Math.hypot((lx0 - W * 0.02) / 1.25, uy + W * 0.13) < W * 0.2;
            const lo = Math.hypot((lx0 - W * 0) / 1.2, uy - W * 0.12) < W * 0.19;
            if (Math.abs(uy) < Math.max(0.6, W * 0.04) && Math.abs(lx0) < W * 0.2) col = line;
            else if (up || lo) col = rampPick(lipsR, clamp01((up ? 0.75 : 0.55) - uy / W * 0.6), x, y);
          }
        } else if (type === "beak" && !front) {
          if (t >= -0.15 && t <= 1) {
            const gap = open * W * 0.32 * (1 - t);
            if (open > 0.08 && Math.abs(uy) < gap) col = Math.abs(uy) < gap * 0.4 && t > 0.3 ? tongue : inside;
            else if (Math.abs(uy - (open > 0.08 ? 0 : curveY(t) * 0.3)) < 0.6 && t > 0) col = line;
          }
        } else if (type === "gulper" && !front) {
          if (t >= -0.05 && t <= 1.02) {
            const tc = clamp01(t);
            const jaw = W * 0.03 * tc;
            const drop = open > 0.05 ? open * W * 0.62 * Math.pow(Math.max(0, 1 - tc), 0.85) : 0;
            const upLine = -open * W * 0.08 * (1 - tc);
            const pouch = Math.max(drop + W * 0.06, jaw + W * 0.17 * Math.sin(Math.PI * Math.min(1, tc * 1.08)));
            if (open > 0.05 && uy > upLine && uy < drop) {
              col = rampPick([P("#12040c"), P("#2a0a1c"), P("#4a1430"), P("#7a2a48"), P("#a04a66")], clamp01(0.15 + (uy - upLine) / Math.max(1, drop) * 0.5), x, y);
              if (Math.abs(uy - upLine) < 1 && Math.floor(-ux) % 3 === 0) col = WHITE;
            } else if (uy >= Math.max(jaw, drop) - 0.5 && uy < pouch) {
              col = uy > pouch - 1.2 ? c.bellyR[0] : rampPick(c.bellyR, clamp01(0.55 - (uy - jaw) / Math.max(1, pouch - jaw) * 0.35), x, y);
              if (open <= 0.05 && Math.abs(uy - jaw) < 0.6 && t > 0.02) col = line;
            }
          }
        } else if (type === "emoticon") {
          const hh = W / 2, th = Math.max(0.8, (m.thick || 2) * 0.55);
          const e2 = f.emotion;
          if (Math.abs(uy) <= hh) {
            const tt = uy / hh;
            let xc = null;
            const bul = W * 0.22;
            if (open > 0.3 || e2 === "surprised" || e2 === "scared") {
              const rr2 = Math.hypot(ux / (W * 0.24), uy / (hh * (0.6 + 0.4 * Math.max(open, 0.5))));
              if (Math.abs(rr2 - 1) * W * 0.24 < th) col = line;
            } else {
              if (e2 === "happy" || e2 === "love" || e2 === "smug") xc = bul * (1 - tt * tt) - bul / 2;
              else if (e2 === "dizzy" || e2 === "disgust") xc = Math.sin(tt * Math.PI * 1.5) * bul * 0.5;
              else if (e2 === "determined") xc = 0;
              else xc = -bul * (1 - tt * tt) + bul / 2;
              if (Math.abs(ux - xc) < th) col = line;
            }
          }
        } else {
          const tk = 0.6 * (m.thick || 1);
          if (O && !front ? true : O && front) {
            const rr2 = W * 0.3 * (front ? 0.8 : 1) * (0.6 + O * 0.7);
            const cxo = front ? 0 : -W * 0.3;
            const dd = Math.hypot((ux - cxo) / 0.9, uy);
            if (dd < rr2) col = dd > rr2 - 1 ? line : uy > rr2 * 0.25 ? tongue : inside;
          } else if (open > 0.08) {
            const cxo = front ? 0 : -W * 0.45;
            const rx = (front ? W * 0.45 : W * 0.48) * (0.8 + 0.2 * open);
            const ry = Math.max(1.2, open * W * (type === "big" ? 0.55 : 0.45) + 0.6);
            const top = em.laugh ? -Math.max(0.5, ry * 0.15) : -ry * 0.55;
            const nx = (ux - cxo) / rx, ny = uy > top ? (uy - top) / (ry - top) : (uy - top) / (ry * 0.55);
            const inE = uy > top ? nx * nx + ny * ny < 1 : nx * nx + ny * ny < 1;
            if (inE) {
              const rim = nx * nx + ny * ny > 1 - 2.2 / Math.max(3, rx + ry);
              col = rim ? line : inside;
              if (!rim && ny > 0.35 && Math.abs(nx) < 0.75) col = ny > 0.55 && nx < -0.1 && nx > -0.4 ? tongueH : tongue;
              if (!rim && (em.teeth || type === "fangs") && uy < top + Math.max(1, ry * 0.22) && uy > top) col = type === "fangs" && Math.abs(fract(nx * 2.2) - 0.5) > 0.2 ? inside : WHITE;
              if (!rim && type === "fangs") {
                for (const fx of [-0.45, 0.35]) if (Math.abs(nx - fx) < 0.14 * (1 - (uy - top) / (ry * 0.9)) && uy - top < ry * 0.8) col = WHITE;
              }
              if (!rim && em.teeth && type !== "fangs" && uy > ry * 0.8 && uy < ry) col = WHITE;
            }
          } else if (t >= (front ? 0 : 0.04) && t <= 1) {
            const yy = curveY(t);
            if (Math.abs(uy - yy) < tk) col = line;
            if (!front && t > 0.9 && Math.abs(uy - yy + 0.9) < 0.5 && W > 5 && sm > 0.2) col = line;
            if (type === "fangs") {
              for (const ft of [0.22, 0.6]) {
                const fl = Math.max(1.5, W * 0.22) * (ft < 0.3 ? 1 : 0.8);
                if (Math.abs(t - ft) * W < Math.max(0.6, W * 0.05) * (1 - (uy - yy) / fl) && uy > yy && uy < yy + fl) col = WHITE;
              }
            }
            if (em.tongue && t > 0.1 && t < 0.5 && uy > yy && uy < yy + W * 0.3 && Math.hypot((t - 0.3) * W, uy - yy - W * 0.12) < W * 0.16) col = tongue;
          }
        }
        if (col) buf.set(x, y, col);
      }
    }
  }
  var KINDS = {};
  var rp = (c, hex, role = "extra") => {
    if (!c._rp) c._rp = /* @__PURE__ */ new Map();
    let r = c._rp.get(hex + role);
    if (!r) {
      r = ramp(c.vc(hex, role)).map((h) => P(h));
      c._rp.set(hex + role, r);
    }
    return r;
  };
  var pk2 = (c, hex, a = 255) => P(c.vc(hex, "extra"), a);
  function capsule(buf, ax, ay, bx, by, r0, r1, R, opts = {}) {
    const pad = Math.max(r0, r1) + 1;
    const x0 = Math.floor(Math.min(ax, bx) - pad), x1 = Math.ceil(Math.max(ax, bx) + pad);
    const y0 = Math.floor(Math.min(ay, by) - pad), y1 = Math.ceil(Math.max(ay, by) + pad);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let t = ((px - ax) * dx + (py - ay) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + dx * t, cy = ay + dy * t;
      const r = r0 + (r1 - r0) * t;
      const ex = px - cx, ey = py - cy;
      const d = Math.hypot(ex, ey);
      if (d > r) continue;
      const nx = ex / Math.max(0.5, r), ny = ey / Math.max(0.5, r);
      let light = (opts.light ?? 0.55) - ny * 0.35 - nx * 0.12 + (opts.tl ? opts.tl(t) : 0);
      if (r >= 2 && d > r - 0.9 && ny > 0.2) light -= 0.15;
      let col = rampPick(R, clamp01(light), x, y);
      if (opts.alpha != null) col = withA(col, opts.alpha);
      if (opts.under && buf.get(x, y)) continue;
      buf.set(x, y, col);
    }
  }
  function shadedEllipse(buf, cx, cy, rx, ry, R, opts = {}) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      let light = (opts.light ?? 0.55) - ny * 0.32 - nx * 0.14 + Math.sqrt(1 - d2) * 0.12;
      if (d2 > 0.82 && ny > 0) light -= 0.12;
      if (opts.rim && d2 > 0.86 && ny < -0.2 && nx < 0.3) light += 0.25;
      let col = rampPick(R, clamp01(light), x, y);
      if (opts.fn) {
        const o = opts.fn(nx, ny, x, y, col);
        if (o === -1) continue;
        if (o) col = o;
      }
      if (opts.alpha != null) col = withA(col, opts.alpha);
      buf.set(x, y, col);
    }
  }
  function claw(buf, x, y, dir, sz, open, R, metal) {
    shadedEllipse(buf, x, y, sz * 0.62, sz * 0.48, R, { rim: true, fn: (nx, ny, px, py) => metal && Math.abs(nx) < 0.08 ? R[1] : 0 });
    const tipX = x + dir * sz * 1.25;
    const gap = 0.12 + open * 0.55;
    capsule(buf, x + dir * sz * 0.35, y - sz * 0.18, tipX, y - sz * (0.1 + gap * 0.9), sz * 0.3, sz * 0.08, R, { light: 0.65 });
    capsule(buf, x + dir * sz * 0.35, y + sz * 0.15, tipX - dir * sz * 0.1, y + sz * (0.12 + gap * 0.3), sz * 0.27, sz * 0.08, R, { light: 0.45 });
    buf.set(Math.round(x - dir * sz * 0.15), Math.round(y - sz * 0.25), R[4]);
  }
  KINDS.crab = {
    layers: [["back", "tail", 12], ["body", "swim", 8], ["front", "fin", 8]],
    ext(c) {
      const L = c.L, H = c.H;
      return [-L * 0.95 - (c.look.shell === "mouse" ? L * 0.55 : 0), -H * 1.45, L * 1, H * 0.95];
    },
    geo(c, s, ph) {
      const L = c.L * s, H = c.H * s;
      const bob = Math.round(Math.sin(ph * TAU * 2) * 0.5 * Math.max(1, c.k * 0.4));
      return { L, H, rx: L / 2, ry: H / 2, cy: -H * 0.12 + bob, bob };
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const g = this.geo(c, s, part === "body" || part === "all" ? ph : 0);
      const { L, H, rx, ry } = g;
      const shell = c.look.shell || "round";
      const cx = ox, cy = oy + g.cy;
      const LEG = shell === "mech" ? rp(c, c.look.legColor || "#8a909c") : c.look.legColor ? rp(c, c.look.legColor) : c.finR;
      if (part === "back" || part === "all") {
        const walk = ph * TAU;
        const lr = Math.max(1.4, H * 0.1);
        for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
          const far = i === 1;
          const bx = cx + side * rx * (0.35 + i * 0.16), by = oy + ry * 0.25 - (far ? H * 0.05 : 0);
          const p2 = walk + i * 2.1 + (side > 0 ? Math.PI : 0);
          const lift = Math.max(0, Math.sin(p2)) * H * 0.12;
          const kx = bx + side * L * 0.16, ky = by - H * 0.18 - lift;
          const fx = bx + side * (L * 0.27 + Math.cos(p2) * L * 0.04), fy = oy + ry * 0.95 - lift * 0.4;
          const RL = far ? LEG.map((v, j) => LEG[Math.max(0, j - 1)]) : LEG;
          capsule(buf, bx, by, kx, ky, lr * 1.15, lr, RL);
          capsule(buf, kx, ky, fx, fy, lr, Math.max(0.6, lr * 0.4), RL, { light: 0.45 });
        }
      }
      if (part === "body" || part === "all") {
        for (const [sx, sh] of [[0.18, 1], [0.5, 0.92]]) {
          const ex = cx + rx * sx, top = cy - ry - H * 0.32 * sh;
          capsule(buf, ex, cy - ry * 0.6, ex + H * 0.02, top, Math.max(0.8, H * 0.06), Math.max(0.7, H * 0.05), shell === "mech" ? rp(c, "#6a707c") : c.bodyR);
        }
        const R = c.bodyR, B2 = c.bellyR;
        if (shell === "mouse") {
          const cr = Math.max(1, H * 0.065);
          const C = rp(c, c.look.cable || "#3a3d48");
          let px0 = cx - rx * 0.98, py0 = cy - ry * 0.18;
          const n = Math.round(L * 0.9);
          for (let i = 1; i <= n; i++) {
            const t = i / n;
            const x = cx - rx * 0.98 - t * L * 0.6;
            const y = cy - ry * 0.18 + Math.sin(t * 7 - ph * TAU) * H * 0.16 * t + t * t * H * 0.25;
            capsule(buf, px0, py0, x, y, cr, cr, C);
            px0 = x;
            py0 = y;
          }
          shadedEllipse(buf, px0 - cr * 0.8, py0, cr * 2, cr * 1.4, rp(c, "#c8ccd4"));
          const MS = c.bodyR;
          for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry * 0.62); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
            const nx = (x + 0.5 - cx) / rx;
            const ryx = ry * (0.8 + 0.2 * clamp(nx, -1, 1) * 0.5 + 0.1);
            const ny = (y + 0.5 - cy) / ryx;
            if (nx * nx + (ny < 0 ? ny * ny : (ny / 0.62) ** 2) > 1) continue;
            const wall = ny > 0.18 + 0.05 * nx;
            let light = wall ? 0.32 - (ny - 0.2) * 0.4 : 0.66 - ny * 0.25 - nx * 0.12;
            const tc = -0.25;
            let col = rampPick(wall ? B2 : MS, clamp01(light), x, y);
            if (!wall) {
              if (nx < -0.12 && Math.abs(ny - tc) * ryx < 0.55) col = MS[0];
              if (Math.abs(nx + 0.12 + (ny - tc) * (ny - tc) * 0.25) * rx < 0.55 && ny > -0.85 && ny < 0.15) col = MS[1];
              const wx = (nx + 0.6) * rx, wy = (ny - tc) * ryx;
              if (Math.abs(wx) < Math.max(1.4, rx * 0.11) && Math.abs(wy) < Math.max(0.9, ryx * 0.13)) {
                col = (Math.floor(wx + 10) & 1) === 0 ? pk2(c, "#4a4e5c") : pk2(c, "#6e7484");
                if (Math.abs(wy) > Math.max(0.9, ryx * 0.13) - 1) col = pk2(c, "#2a2c36");
              }
              if (nx > 0.05 && nx < 0.6 && ny > -0.82 && ny < -0.58 && bayer(x, y) < 0.55) col = MS[4];
            } else if (Math.abs(ny - 0.2 - 0.05 * nx) * ryx < 0.6) col = MS[1];
            buf.set(x, y, col);
          }
          if (glow) for (let x = -2; x <= 2; x++) glow.set(Math.round(cx + rx * 0.2 + x), Math.round(cy + ry * 0.62), pk2(c, "#ff3a3a"));
        } else if (shell === "mech") {
          const M = R;
          for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry * 0.6); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
            const corner = Math.max(0, Math.abs(nx) - 0.72) / 0.28 + Math.max(0, -ny - 0.62) / 0.38;
            if (corner > 1 || ny > 0.6 || Math.abs(nx) > 1 || ny < -1) continue;
            let light = 0.62 - ny * 0.3 - nx * 0.1;
            if (ny > 0.22) light -= 0.25;
            let col = rampPick(M, clamp01(light), x, y);
            if (Math.abs(ny - 0.22) * ry < 0.6) col = M[0];
            if (Math.abs(nx) * rx < 0.6 && ny < 0.22) col = M[1];
            if (Math.abs(ny + 0.35) * ry < 0.6 && Math.abs(nx) < 0.75) col = M[1];
            if (corner > 0.8) col = M[3];
            for (const [bx2, by2] of [[-0.78, -0.55], [0.78, -0.55], [-0.85, 0.4], [0.85, 0.4], [-0.3, 0.4], [0.3, 0.4]]) {
              const dd = Math.hypot((nx - bx2) * rx, (ny - by2) * ry);
              if (dd < Math.max(0.8, H * 0.05)) col = dd < 0.7 && nx < bx2 ? P("#ffffff") : pk2(c, "#d8dde6");
            }
            buf.set(x, y, col);
          }
          for (let y = Math.round(cy + ry * 0.3); y <= Math.round(cy + ry * 0.52); y++) for (let x = Math.round(cx - rx * 0.6); x <= Math.round(cx + rx * 0.6); x++) {
            buf.set(x, y, Math.floor((x - y) / Math.max(2, H * 0.1)) & 1 ? pk2(c, "#2a2a30") : pk2(c, "#ffc83a"));
          }
          const ax = cx - rx * 0.45, ay = cy - ry;
          capsule(buf, ax, ay, ax - H * 0.12, ay - H * 0.5, Math.max(0.6, H * 0.03), Math.max(0.6, H * 0.03), rp(c, "#9aa2b0"));
          const on = (Math.floor(ph * 4) & 1) === 0;
          shadedEllipse(buf, ax - H * 0.12, ay - H * 0.52, Math.max(1.2, H * 0.07), Math.max(1.2, H * 0.07), rp(c, on ? "#ff4a4a" : "#7a2020"));
          if (glow && on) glow.set(Math.round(ax - H * 0.12), Math.round(ay - H * 0.52), pk2(c, "#ff4a4a"));
          capsule(buf, cx - rx * 0.95, cy + ry * 0.05, cx - rx * 1.15, cy - ry * 0.35, Math.max(1, H * 0.07), Math.max(1, H * 0.08), rp(c, "#5a5e68"));
        } else {
          for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry * 0.55); y++) for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
            const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
            const ang = Math.atan2(ny, nx);
            const serr = ny < 0.1 ? 0.06 * Math.max(0, Math.cos(ang * 9)) : 0;
            const r2 = nx * nx + (ny < 0 ? ny * ny : (ny / 0.55) ** 2);
            if (r2 > (1 + serr) ** 2) continue;
            let light = 0.6 - ny * 0.35 - nx * 0.1 + Math.sqrt(Math.max(0, 1 - r2)) * 0.1;
            let col = rampPick(ny > 0.3 ? B2 : R, clamp01(light), x, y);
            if (r2 < 0.8 && hash2(Math.floor((x - cx) / Math.max(2, c.k)), Math.floor((y - cy) / Math.max(2, c.k)), 4) > 0.86) col = R[3];
            if (ny < -0.55 && nx < 0.1 && nx > -0.6 && bayer(x, y) < 0.4) col = R[4];
            if (Math.abs(ny - 0.3) * ry < 0.6) col = R[1];
            buf.set(x, y, col);
          }
        }
      }
      if (part === "front" || part === "all") {
        const open = clamp01((q.mouth || 0) + 0.25 + 0.25 * Math.sin(ph * TAU));
        const CL = shell === "mech" ? rp(c, "#9aa0ac") : c.finR;
        const sz = H * 0.42;
        const ax = cx + rx * 0.82, ay = cy + ry * 0.15;
        capsule(buf, ax - rx * 0.2, ay, ax + sz * 0.4, ay - sz * 0.55, sz * 0.24, sz * 0.2, CL);
        claw(buf, ax + sz * 0.55, ay - sz * 0.7, 1, sz, open, CL, shell === "mech");
        const bx = cx - rx * 0.78, by = cy + ry * 0.2;
        capsule(buf, bx + rx * 0.15, by, bx - sz * 0.25, by - sz * 0.45, sz * 0.18, sz * 0.15, CL);
        claw(buf, bx - sz * 0.35, by - sz * 0.6, -1, sz * 0.72, open * 0.7, CL, shell === "mech");
      }
    },
    face(c, ph, s, ox, oy, q) {
      const g = this.geo(c, s, ph);
      const { rx, ry, H } = g;
      const cx = ox, cy = oy + g.cy;
      const er = Math.max(1.6, (c.eyes[0].r ?? H * 0.12) * (c.look.eye?.r ? s : 1));
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, H * 0.13);
      const eyes = [[0.18, 1], [0.5, 0.92]].map(([sx, sh], i) => ({ x: cx + rx * sx + H * 0.02, y: cy - ry - H * 0.32 * sh - R * 0.4, r: i ? R * 0.92 : R, e: c.eyes[0], idx: i, mirror: false, cheek: false, main: i === 1, angle: 0 }));
      void er;
      return {
        eyes,
        mouth: { x: cx + rx * 0.52, y: cy - ry * 0.05, w: Math.max(3, H * 0.28), m: c.mouth, front: true, angle: 0 },
        anchors: { mouth: [cx + rx + H * 0.3, cy - ry * 0.4], top: [cx, cy - ry - H * 0.6], tail: [cx - rx, cy], bottom: [cx, oy + ry * 0.95] }
      };
    }
  };
  KINDS.jelly = {
    layers: [["back", "tail", 12], ["body", "swim", 8], ["front", "fin", 8]],
    ext(c) {
      const L = c.L, H = c.H, tl = c.look.tentacles ?? H * 1.7;
      return [-L * 0.72, -H * 0.9, L * 0.72, H * 0.25 + tl + 3];
    },
    geo(c, s, ph) {
      const pulse = Math.sin(ph * TAU);
      return { bw: c.L / 2 * (1 + 0.1 * pulse) * s, bh: c.H * 0.62 * (1 - 0.1 * pulse) * s, pulse };
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const L = c.L * s, H = c.H * s;
      const a = c.alpha;
      const R = c.bodyR, F = c.finR;
      const glowOn = !!c.look.glow;
      const gonad = rp(c, c.look.gonad || "#ff9fd6");
      if (part === "back" || part === "all") {
        const n = c.look.tentacleCount ?? Math.max(5, Math.round(c.L / 5));
        const tl = (c.look.tentacles ?? c.H * 1.7) * s;
        for (let i = 0; i < n; i++) {
          const x0 = ox + ((i + 0.5) / n * 2 - 1) * L * 0.42;
          const len = tl * (0.75 + 0.25 * hash2(i, 3, 9));
          let lx = x0, ly = oy + H * 0.05;
          for (let k = 1; k <= len; k++) {
            const t = k / len;
            const x = x0 + Math.sin(ph * TAU + i * 1.9 + t * 5) * (1.5 + c.k) * t + (x0 - ox) * t * 0.15;
            const y = oy + H * 0.05 + k;
            const al = Math.round(clamp(a + 40 - t * 150, 40, 255));
            const dot = (k + i * 3) % Math.max(4, Math.round(5 * c.k * 0.5)) === 0;
            const col = withA(dot ? F[4] : F[t > 0.6 ? 3 : 2], dot ? Math.min(255, al + 60) : al);
            buf.line(lx, ly, x, y, col);
            if (glowOn && dot) glow.set(Math.round(x), Math.round(y), F[4]);
            lx = x;
            ly = y;
          }
        }
      }
      if (part === "body" || part === "all") {
        const { bw, bh } = this.geo(c, s, ph);
        const lobes = Math.max(8, Math.round(c.L / 3));
        for (let y = Math.floor(oy - bh - 1); y <= Math.ceil(oy + H * 0.12); y++) for (let x = Math.floor(ox - bw - 2); x <= Math.ceil(ox + bw + 2); x++) {
          const nx = (x + 0.5 - ox) / bw, ny = (y + 0.5 - oy) / bh;
          const ang = Math.atan2(ny, nx);
          const r2 = nx * nx + (ny < 0 ? ny * ny : 0);
          if (r2 > 1) continue;
          const marg = 0.1 + 0.07 * Math.abs(Math.sin(nx * lobes * 0.5 * Math.PI));
          if (ny > marg) continue;
          void ang;
          const rimD = 1 - Math.sqrt(r2);
          const inner = Math.hypot(nx / 0.78, (ny - 0.12) / 0.7) < 1;
          let light = 0.55 - ny * 0.25 - nx * 0.12 + (inner ? -0.12 : 0.05);
          let col = rampPick(R, clamp01(light), x, y);
          let al = inner ? a - 25 : a;
          if (rimD < 0.1 || ny > marg - 0.06) {
            col = R[4];
            al = Math.min(255, a + 70);
            if (glowOn) glow.set(x, y, R[3]);
          }
          const ca2 = Math.atan2(ny - 0.05, nx);
          if (!inner && Math.abs(fract(ca2 / (Math.PI / 8)) - 0.5) < 0.08 && ny < 0) {
            col = R[3];
            al = Math.min(255, a + 30);
          }
          for (let k2 = 0; k2 < 4; k2++) {
            const gaa = Math.PI + (k2 + 0.5) * (Math.PI / 4);
            const gx = Math.cos(gaa) * 0.38, gy = -0.3 + Math.sin(gaa) * 0.18;
            const gd = Math.hypot((nx - gx) / 1, (ny - gy) / 1.15);
            if (gd < 0.17 && gd > 0.07) {
              col = rampPick(gonad, 0.6 - (ny - gy) * 2, x, y);
              al = Math.min(255, a + 80);
              if (glowOn) glow.set(x, y, gonad[3]);
            }
          }
          if (nx < -0.35 && nx > -0.62 && ny < -0.45 && ny > -0.8 && bayer(x, y) < 0.5) {
            col = P("#ffffff");
            al = 230;
          }
          buf.set(x, y, withA(col, al));
        }
      }
      if (part === "front" || part === "all") {
        const arms = 4, len = H * 1;
        for (let i = 0; i < arms; i++) {
          const x0 = ox + (i - (arms - 1) / 2) * L * 0.07;
          for (let k = 0; k < len * (0.75 + 0.25 * (i & 1)); k++) {
            const t = k / len;
            const sw = Math.sin(ph * TAU + t * 6 + i) * (1 + c.k * 0.8) * (0.3 + t);
            const wdt = Math.max(1, (1 - t * 0.6) * c.k * 0.9);
            for (let w = -wdt; w <= wdt; w++) {
              const ruffle = Math.abs(w) > wdt - 1 && (k + i & 1) === 0;
              buf.set(Math.round(x0 + sw + w), Math.round(oy + H * 0.04 + k), withA(ruffle ? F[4] : F[w < 0 ? 3 : 2], Math.min(255, a + 50)));
            }
          }
        }
      }
    },
    face(c, ph, s, ox, oy, q) {
      const { bw, bh } = this.geo(c, s, ph);
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.6, c.L * s * 0.06);
      const ey = oy - bh * 0.42;
      const eyes = c.look.noFace ? [] : [-1, 1].map((sd, i) => ({ x: ox + sd * bw * 0.32, y: ey, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 }));
      return {
        eyes,
        mouth: c.look.noFace ? null : { x: ox, y: ey + R * 1.9, w: Math.max(3, bw * 0.3), m: c.mouth, front: true, angle: 0 },
        anchors: { mouth: [ox, oy + 2], top: [ox, oy - bh - 2], tail: [ox, oy + (c.look.tentacles ?? c.H * 1.7) * s], bottom: [ox, oy + c.H * s * 0.8] }
      };
    }
  };
  KINDS.pudding = {
    layers: [["body", "swim", 8]],
    ext(c) {
      const L = c.L, H = c.H;
      return [-L * 0.8, -H * 1.45, L * 0.8, H * 0.2 + 3];
    },
    geo(c, s, ph, q) {
      const wob = Math.sin(ph * TAU * 2);
      const sq = q?.squash || 0;
      const hh = c.H * s * (1 - 0.07 * wob - sq * 0.2);
      const botW = c.L / 2 * s * (1 + 0.045 * wob + sq * 0.2);
      return { wob, hh, botW, topW: botW * 0.7, skew: wob * Math.max(1, c.k * 0.6) * s };
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const { hh, botW, topW, skew } = this.geo(c, s, ph, q);
      const base = oy;
      const R = c.bodyR, CR = c.finR;
      shadedEllipse(buf, ox, base + 1, botW * 1.35, Math.max(2, botW * 0.22), rp(c, c.look.plate || "#e8f0f6"), { light: 0.7, fn: (nx, ny) => Math.hypot(nx, ny) > 0.8 ? rp(c, "#7ab0d8")[2] : 0 });
      const drips = [[-0.55, 0.35], [-0.05, 0.22], [0.42, 0.45], [0.78, 0.18]];
      for (let y = Math.floor(base - hh - 3); y <= base; y++) {
        const t = (base - y) / hh;
        if (t > 1.03) continue;
        const round = t > 0.86 ? Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.17) ** 2)) : 1;
        const half = lerp(botW, topW, t) * (t > 0.86 ? 0.75 + 0.25 * round : 1);
        const cxr = ox + skew * t;
        for (let x = Math.floor(cxr - half - 1); x <= Math.ceil(cxr + half + 1); x++) {
          const nx = (x + 0.5 - cxr) / Math.max(1, half);
          if (Math.abs(nx) > 1) continue;
          let light = 0.6 - nx * 0.3 + t * 0.15 - (t < 0.08 ? 0.2 : 0);
          let col = rampPick(R, clamp01(light), x, y);
          let car = 0.74 + Math.sin(nx * 5 + 1) * 0.03;
          for (const [dx, dl] of drips) if (Math.abs(nx - dx) < 0.09) car = Math.min(car, 0.74 - dl * (1 - (Math.abs(nx - dx) / 0.09) ** 2));
          if (t > car) {
            col = rampPick(CR, clamp01(0.5 - nx * 0.3 + (t - car) * 1.2), x, y);
            if (t > 0.9 && nx < -0.1 && nx > -0.5 && bayer(x, y) < 0.5) col = CR[4];
          } else if (t > car - 0.04) col = CR[1];
          if (nx < -0.55 && nx > -0.78 && t > 0.15 && t < car - 0.08) col = R[4];
          if (nx > 0.7 && t < car) col = R[1];
          buf.set(x, y, col);
        }
      }
      if (c.look.cherry !== false) {
        const chx = ox + skew, chy = base - hh - c.H * s * 0.12;
        const cr = Math.max(1.8, c.H * s * 0.13);
        capsule(buf, chx + cr * 0.2, chy - cr * 0.6, chx + cr * 1.2, chy - cr * 2.3, Math.max(0.5, cr * 0.15), Math.max(0.5, cr * 0.12), rp(c, "#4a8a2a"));
        shadedEllipse(buf, chx, chy, cr, cr * 0.95, rp(c, "#e8304a"), { rim: true, fn: (nx, ny) => Math.hypot(nx + 0.4, ny + 0.4) < 0.3 ? P("#ffe0e6") : 0 });
      }
    },
    face(c, ph, s, ox, oy, q) {
      const { hh, skew } = this.geo(c, s, ph, q);
      const fy = oy - hh * 0.4;
      const fx = ox + skew * 0.4;
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, c.H * s * 0.09);
      return {
        eyes: [-1, 1].map((sd, i) => ({ x: fx + sd * c.L * s * 0.17, y: fy, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 })),
        mouth: { x: fx, y: fy + R * 1.7, w: Math.max(3, c.L * s * 0.14), m: c.mouth, front: true, angle: 0 },
        anchors: { mouth: [fx, fy + R * 2], top: [ox, oy - hh - c.H * s * 0.3], tail: [ox - c.L * s / 2, oy], bottom: [ox, oy + 2] }
      };
    }
  };
  KINDS.seahorse = {
    layers: [["back", "fin", 8], ["body", "swim", 8], ["front", "fin", 8]],
    ext(c) {
      const H = c.H;
      return [-H * 0.3, -H * 0.56, H * 0.36, H * 0.56];
    },
    spine(c, H, ph) {
      const key = Math.round(H * 8) + "|" + Math.floor(fract(ph) * 8);
      if (!c._shSp) c._shSp = /* @__PURE__ */ new Map();
      let out = c._shSp.get(key);
      if (out) return out;
      const sway = Math.sin(ph * TAU) * 0.012;
      const pts = [[-0.035, -0.29], [-0.065, -0.18], [-0.03, -0.05], [-0.01, 0.07], [-0.04, 0.18], [-0.08 + sway, 0.28], [-0.085 + sway, 0.37]];
      const raw = [];
      const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let k = 0; k < 10; k++) {
          const t = k / 10;
          raw.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
        }
      }
      const [lx, ly] = pts[pts.length - 1];
      const cR = 0.055 + sway * 0.5;
      const ccx = lx + cR, ccy = ly;
      for (let k = 1; k <= 26; k++) {
        const t = k / 26;
        const ang = Math.PI + t * Math.PI * 1.65;
        const r = cR * (1 - t * 0.6);
        raw.push([ccx + Math.cos(ang) * r, ccy - Math.sin(ang) * r]);
      }
      out = raw.map(([x, y], i) => [x * H, y * H, i / (raw.length - 1)]);
      c._shSp.set(key, out);
      return out;
    },
    thick(t, H) {
      if (t < 0.08) return (0.062 + t * 0.25) * H;
      if (t < 0.38) return (0.082 + (t - 0.08) * 0.13) * H;
      if (t < 0.52) return (0.121 - (t - 0.38) * 0.35) * H;
      return Math.max(0.016, 0.072 - (t - 0.52) * 0.115) * H;
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const H = c.H * s;
      const R = c.bodyR, B2 = c.bellyR, F = c.finR;
      const bob = part === "body" || part === "all" ? Math.sin(ph * TAU) * Math.max(0.5, c.k * 0.25) : 0;
      const oyb = oy + bob;
      if (part === "back" || part === "all") {
        const fx = ox - H * 0.075, fy = oy + H * 0.02;
        const n = 8;
        for (let k = 0; k < n; k++) {
          const yy = fy + (k - n / 2) * H * 0.016;
          const len = H * (0.085 + 0.03 * Math.sin(ph * TAU * 2 + k * 0.8)) * Math.sin(Math.PI * (k + 0.5) / n) ** 0.5;
          capsule(buf, fx, yy, fx - len, yy - len * 0.25, Math.max(0.6, H * 0.012), Math.max(0.6, H * 0.016), F, { alpha: 225, light: 0.62 });
        }
      }
      if (part === "body" || part === "all") {
        const pts = this.spine(c, H, ph);
        const headX = ox + H * 0.025, headY = oyb - H * 0.36;
        const x0 = Math.floor(ox - H * 0.26), x1 = Math.ceil(ox + H * 0.34), y0 = Math.floor(oyb - H * 0.5), y1 = Math.ceil(oyb + H * 0.52);
        const sxA = headX + H * 0.06, syA = headY + H * 0.012, sxB = headX + H * 0.21, syB = headY + H * 0.06;
        const sdx = sxB - sxA, sdy = syB - syA, sl2 = sdx * sdx + sdy * sdy;
        const ringN = 30;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - ox, py = y + 0.5 - oyb;
          let best = Infinity, bt = 0, bnx = 0, bny = 0;
          for (const [sx, sy, t] of pts) {
            if (Math.abs(py - sy) > H * 0.14) continue;
            const th = this.thick(t, H);
            const d = Math.hypot(px - sx, py - sy) - th;
            if (d < best) {
              best = d;
              bt = t;
              bnx = (px - sx) / Math.max(0.5, th);
              bny = (py - sy) / Math.max(0.5, th);
            }
          }
          const bd = Math.hypot((px - H * 0.035) / (H * 0.085), (py - H * 0.03) / (H * 0.14)) - 1;
          const hd = Math.hypot((x + 0.5 - headX) / (H * 0.095), (y + 0.5 - headY) / (H * 0.07)) - 1;
          let st = ((x + 0.5 - sxA) * sdx + (y + 0.5 - syA) * sdy) / sl2;
          st = clamp01(st);
          const snD = Math.hypot(x + 0.5 - (sxA + sdx * st), y + 0.5 - (syA + sdy * st)) - H * (0.026 + (st > 0.86 ? 0.011 : 0));
          const crX = headX - H * 0.035, crY = headY - H * 0.072;
          const crownD = Math.hypot((x + 0.5 - crX) / (H * 0.04), (y + 0.5 - crY) / (H * 0.045)) - 1;
          const spike = Math.abs(x + 0.5 - (crX - H * 0.02)) < Math.max(0.6, H * 8e-3) && y + 0.5 > crY - H * 0.07 && y + 0.5 < crY || Math.abs(x + 0.5 - (crX + H * 0.02)) < Math.max(0.6, H * 8e-3) && y + 0.5 > crY - H * 0.055 && y + 0.5 < crY;
          if (best > 0 && bd > 0 && hd > 0 && snD > 0 && crownD > 0 && !spike) {
            if (best < Math.max(1.1, H * 0.022) && bnx < -0.4 && bt > 0.05 && bt < 0.8 && Math.abs(fract(bt * ringN) - 0.5) < 0.14) buf.set(x, y, R[1]);
            continue;
          }
          let col;
          if (hd <= 0 || snD <= 0 || crownD <= 0 || spike) {
            const hx = (x + 0.5 - headX) / (H * 0.1), hy = (y + 0.5 - headY) / (H * 0.075);
            col = rampPick(R, clamp01(0.62 - hx * 0.12 - hy * 0.3), x, y);
            if (crownD <= 0 || spike) col = R[crownD < -0.5 ? 3 : 2];
            if (snD <= 0 && st > 0.86) col = R[1];
            if (snD <= 0 && snD > -0.8 && y + 0.5 > syA + sdy * st) col = R[1];
            if (hd <= 0 && hx < -0.2 && hy < -0.3 && bayer(x, y) < 0.5) col = R[4];
          } else {
            const belly = bd <= 0 && bnx > -0.25;
            let light = 0.56 - bnx * 0.3 - bny * 0.12;
            if (belly) light = 0.62 - (px - H * 0.035) / (H * 0.085) * 0.25;
            col = rampPick(belly ? B2 : R, clamp01(light), x, y);
            const ring = Math.abs(fract(bt * ringN) - 0.5) < 0.11;
            if (!belly && bt > 0.04 && bt < 0.97 && ring) col = R[1];
            if (belly && Math.abs(fract(py / Math.max(2, H * 0.04)) - 0.5) < 0.12) col = B2[1];
            if (!belly && bnx < -0.45 && bnx > -0.8 && bt > 0.05 && bt < 0.55 && bayer(x, y) < 0.4) col = R[4];
          }
          buf.set(x, y, col);
        }
      }
      if (part === "front" || part === "all") {
        const fx = ox - H * 0.02, fy = oy - H * 0.27;
        const fl = Math.sin(ph * TAU * 3) * 0.3;
        for (let k = 0; k < 5; k++) {
          const a = 0.2 + k * 0.32 + fl;
          capsule(buf, fx, fy, fx - Math.cos(a) * H * 0.07, fy + Math.sin(a) * H * 0.06, Math.max(0.5, H * 0.01), Math.max(0.6, H * 0.02), F, { alpha: 210, light: 0.72 });
        }
      }
    },
    face(c, ph, s, ox, oy, q) {
      const H = c.H * s;
      const bob = Math.sin(ph * TAU) * Math.max(0.5, c.k * 0.25);
      const headX = ox + H * 0.025, headY = oy + bob - H * 0.36;
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, H * 0.045);
      return {
        eyes: [{ x: headX + H * 0.012, y: headY - H * 8e-3, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: true, main: true, angle: 0 }],
        mouth: { x: headX + H * 0.235, y: headY + H * 0.07, w: Math.max(2, H * 0.045), m: c.mouth, front: false, angle: 0.35 },
        anchors: { mouth: [headX + H * 0.24, headY + H * 0.065], top: [headX, headY - H * 0.15], tail: [ox, oy + H * 0.42], bottom: [ox, oy + H * 0.48] }
      };
    }
  };
  KINDS.ray = {
    layers: [["back", "tail", 12], ["body", "swim", 8]],
    ext(c) {
      const L = c.L, H = c.H;
      return [-L * 1.35, -H * 1.25, L * 0.75, H * 1.25];
    },
    half(c, u, span) {
      if (c.look.square) return Math.abs(u) <= 1 ? span * 0.9 : 0;
      if (c.look.manta) {
        const ut = -0.08;
        if (u > 1 || u < -0.62) return 0;
        if (u >= ut) return span * (0.2 + 0.8 * Math.pow((1 - u) / (1 - ut), 0.7));
        return span * (0.14 + 0.86 * Math.pow((u + 0.62) / (ut + 0.62), 2.2));
      }
      if (u > 1 || u < -1) return 0;
      if (u > 0.12) return span * Math.pow(Math.max(0, 1 - Math.pow((u - 0.12) / 0.88, 1.7)), 0.7);
      return span * (1 - Math.pow((0.12 - u) / 1.12, 1.25));
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const L = c.L * s, span = c.H * s, len = L * 0.5;
      const R = c.bodyR, B2 = c.bellyR;
      if (part === "back" || part === "all") {
        const tl = c.look.manta ? L * 0.45 : L * 0.85;
        let tx = ox - len * (c.look.manta ? 0.7 : c.look.square ? 1 : 0.95), ty = oy;
        const n = Math.ceil(tl);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const nx = ox - len * (c.look.manta ? 0.7 : c.look.square ? 1 : 0.95) - k;
          const ny = oy + Math.sin(ph * TAU - t * 4) * t * span * 0.18;
          capsule(buf, tx, ty, nx, ny, Math.max(0.6, span * 0.045 * (1 - t * 0.8)), Math.max(0.5, span * 0.045 * (1 - t * 0.8)), R, { light: 0.45 });
          tx = nx;
          ty = ny;
        }
        if (c.look.square) shadedEllipse(buf, tx, ty, Math.max(1.5, span * 0.08), Math.max(1.5, span * 0.08), rp(c, "#c8ccd4"));
      }
      if (part === "body" || part === "all") {
        const flap = Math.sin(ph * TAU);
        const sq = c.look.square;
        if (sq) {
          for (const sd of [-1, 1]) {
            const fy = oy + sd * span * 0.9;
            const ext2 = span * (0.38 + 0.18 * flap * sd);
            for (let x = -len * 0.6; x <= len * 0.5; x++) {
              const t = (x + len * 0.6) / (len * 1.1);
              const hh = ext2 * Math.pow(Math.sin(Math.PI * t), 1.4) * (0.6 + 0.4 * t);
              for (let k = 0; k < hh; k++) buf.set(Math.round(ox + x), Math.round(fy + sd * k), withA(c.finR[k > hh - 1.2 ? 3 : (Math.round(x) & 3) === 0 ? 1 : 2], 240));
            }
          }
        }
        for (let y = Math.floor(oy - span * 1.15); y <= Math.ceil(oy + span * 1.15); y++) for (let x = Math.floor(ox - len * 1.1); x <= Math.ceil(ox + len * 1.05); x++) {
          const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
          const u = dx / len;
          const tipShift = c.look.manta ? flap * Math.abs(dy) / span * len * 0.12 : 0;
          const half = this.half(c, u + tipShift / len, span * (1 - 0.06 * Math.abs(flap)));
          if (!half || Math.abs(dy) > half) continue;
          const v = dy / Math.max(1, span);
          if (sq) {
            const cxr = len - Math.abs(dx), cyr = span * 0.9 - Math.abs(dy), rr2 = span * 0.14;
            if (cxr < rr2 && cyr < rr2 && Math.hypot(rr2 - cxr, rr2 - cyr) > rr2) continue;
            if (dx < -len * 0.72 && dx > -len * 0.88 && dy < -span * 0.62 && dy > -span * 0.8) continue;
          }
          let light = 0.55 - flap * v * 0.28 - Math.abs(v) * 0.12 + (u > 0.6 ? 0.06 : 0);
          if (Math.abs(dy) > half - 1.2 && u > 0) light += 0.25;
          let col = rampPick(R, clamp01(light), x, y);
          if (!sq && !c.look.bsod) {
            if (Math.abs(v) < 0.1 && u < 0.7 && u > -0.85) col = rampPick(R, clamp01(light + 0.18), x, y);
            if (hash2(Math.floor(dx / Math.max(2, c.k)), Math.floor(dy / Math.max(2, c.k)), 6) > 0.9 && Math.abs(v) < 0.8) col = B2[2];
          }
          if (sq) {
            const sx = (dx + len * 0.05) / len;
            if (sx > 0.15 && sx < 0.85 && Math.abs(v) < 0.42) {
              col = rampPick(rp(c, "#c8ccd4"), clamp01(0.62 - v * 0.4), x, y);
              if (sx > 0.42 && sx < 0.6 && Math.abs(v) < 0.18) col = rp(c, "#c8ccd4")[0];
            }
            if (sx < -0.18 && sx > -0.85 && Math.abs(v) < 0.6) {
              col = P(c.vc("#f4f2ea", "extra"));
              if (Math.abs(fract((dy + span) / Math.max(2, span * 0.18)) - 0.5) < 0.12 && Math.abs(v) < 0.48 && sx < -0.25) col = pk2(c, "#8aa0c8");
              if (sx > -0.3) col = pk2(c, "#e85a5a");
            }
          }
          if (c.look.bsod) {
            const rowH = Math.max(3, span * 0.1);
            if (u < -0.14 && u > -0.55 && Math.abs(v) < 0.5 && (Math.floor((dy + span) / rowH) & 1) === 0 && Math.floor((dy + span) / 1) % Math.round(rowH) < 2 && hash2(Math.floor(dx / Math.max(3, c.k * 2)), Math.floor((dy + span) / rowH), 4) > 0.3) col = pk2(c, "#a8c0ff");
            if (glow) glow.set(x, y, R[2]);
          }
          buf.set(x, y, col);
        }
        if (c.look.manta) {
          for (const sd of [-1, 1]) {
            const hx = ox + len * 0.92, hy = oy + sd * span * 0.17;
            capsule(buf, hx - len * 0.1, hy, hx + len * 0.2, hy + sd * span * 0.06 * (1 + flap * 0.4), Math.max(1.2, span * 0.07), Math.max(0.8, span * 0.045), R, { light: 0.62 });
          }
        }
      }
    },
    face(c, ph, s, ox, oy, q) {
      const L = c.L * s, span = c.H * s, len = L * 0.5;
      const anchors = { mouth: [ox + len, oy], top: [ox, oy - span - 3], tail: [ox - len * 1.6, oy], bottom: [ox, oy + span] };
      if (c.look.bsod) {
        if (!c._bsodEye) {
          c._bsodEye = { ...c.eyes[0], type: "pixel", sclera: P("#ffffff"), brow: false };
          c._bsodMouth = { ...c.mouth, type: "emoticon", lineP: P("#ffffff"), thick: Math.max(2, Math.round(c.k * 0.6)) };
        }
        const R2 = Math.max(1.5, span * 0.06);
        const fx = ox + len * 0.2, fy = oy;
        return {
          eyes: [-1, 1].map((sd, i) => ({ x: fx - span * 0.12, y: fy + sd * span * 0.13, r: R2, e: c._bsodEye, idx: i, mirror: false, cheek: false, main: i === 0, angle: 0 })),
          mouth: { x: fx + span * 0.1, y: fy, w: span * 0.5, m: c._bsodMouth, front: true, angle: 0 },
          anchors
        };
      }
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, span * 0.11);
      return {
        eyes: [-1, 1].map((sd, i) => ({ x: ox + len * (c.look.square ? 0.62 : 0.5), y: oy + sd * span * (c.look.square ? 0.22 : 0.2), r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: false, main: i === 0, angle: 0 })),
        mouth: c.look.square ? { x: ox + len * 0.86, y: oy, w: span * 0.28, m: c.mouth, front: true, angle: Math.PI / 2 } : null,
        anchors
      };
    }
  };
  KINDS.squid = {
    layers: [["back", "tail", 12], ["body", "swim", 8]],
    ext(c) {
      const L = c.L, H = c.H;
      return [-L * 0.68, -H * 0.95, L * 0.62, H * 0.95];
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const L = c.L * s, H = c.H * s;
      const R = c.bodyR, F = c.finR;
      const cape = c.look.cape !== false;
      if (part === "back" || part === "all") {
        const open = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ph * TAU));
        const b0 = ox - L * 0.04, Lc = L * 0.46;
        const r0 = H * 0.24, r1 = H * (0.34 + 0.32 * open);
        const rAt = (d) => r0 + (r1 - r0) * Math.pow(clamp01(d / Lc), 1.2);
        const arms = 7;
        const armV = (k2) => k2 / (arms - 1) * 1.9 - 0.95;
        const dEnd = (vy) => {
          let near = 1;
          for (let k2 = 0; k2 < arms; k2++) near = Math.min(near, Math.abs(vy - armV(k2)) * (arms - 1) / 1.9);
          return Lc * (0.8 + 0.2 * Math.pow(Math.abs(vy), 1.5)) - Lc * 0.09 * Math.min(1, near * 2);
        };
        const lining = rp(c, c.look.lining || "#2a0c18");
        for (let y = Math.floor(oy - r1 - 2); y <= Math.ceil(oy + r1 + 2); y++) for (let x = Math.floor(b0 - Lc - 2); x <= Math.ceil(b0 + 1); x++) {
          const d = b0 - (x + 0.5), dy = y + 0.5 - oy;
          if (d < 0) continue;
          const rr2 = rAt(d);
          if (Math.abs(dy) > rr2) continue;
          const vy = dy / rr2;
          const de = dEnd(vy);
          if (d > de) continue;
          let col = rampPick(R, clamp01(0.5 - vy * 0.3 + (1 - d / Lc) * 0.1), x, y);
          for (let k2 = 0; k2 < arms; k2++) if (Math.abs(vy - armV(k2)) * rr2 < 0.6) col = R[1];
          if (d > de - Lc * (0.06 + 0.1 * open)) {
            col = rampPick(lining, clamp01(0.35 - vy * 0.2), x, y);
            for (let k2 = 0; k2 < arms; k2++) if (Math.abs(vy - armV(k2)) * rr2 < 0.7 && (x + y & 1) === 0) col = pk2(c, "#f4ecf0");
          }
          if (Math.abs(dy) > rr2 - 1.1 && vy < 0) col = R[3];
          buf.set(x, y, col);
        }
        for (let k2 = 0; k2 < arms; k2++) {
          const vy = armV(k2), de = dEnd(vy), rr2 = rAt(de);
          const tx = b0 - de, ty = oy + vy * rr2;
          const ln = H * (0.14 + 0.05 * Math.sin(ph * TAU + k2));
          capsule(buf, tx + 1, ty, tx - ln * 0.8, ty + vy * ln * 0.6 + Math.sin(ph * TAU * 2 + k2) * H * 0.03, Math.max(0.9, H * 0.035), Math.max(0.5, H * 0.012), rp(c, "#1e0c14"), { light: 0.6 });
        }
      }
      if (part === "body" || part === "all") {
        const flap = Math.sin(ph * TAU);
        const m0 = ox - L * 0.02, ml = L * 0.56, mh = H * 0.34;
        for (const sd of [-1, 1]) {
          const fx = m0 + ml * 0.66, fy = oy + sd * mh * 0.72;
          const ang = sd * (1.9 - flap * 0.5 * sd);
          const fa = H * 0.3, fb = H * 0.15;
          for (let y = Math.floor(fy - fa - 1); y <= fy + fa + 1; y++) for (let x = Math.floor(fx - fa - 1); x <= fx + fa + 1; x++) {
            const dx = x + 0.5 - fx, dy = y + 0.5 - fy;
            const a = dx * Math.cos(ang) + dy * Math.sin(ang), b = -dx * Math.sin(ang) + dy * Math.cos(ang);
            if (a < 0 || (a / fa) ** 2 + (b / fb) ** 2 > 1) continue;
            let col = rampPick(F, clamp01(0.62 - b / fb * 0.3 * sd + a / fa * 0.1), x, y);
            if ((a / fa) ** 2 + (b / fb) ** 2 > 0.75) col = F[sd < 0 ? 3 : 1];
            buf.set(x, y, col);
          }
        }
        for (let y = Math.floor(oy - mh - 1); y <= Math.ceil(oy + mh + 1); y++) for (let x = Math.floor(m0 - L * 0.12); x <= Math.ceil(m0 + ml + 1); x++) {
          const u = (x + 0.5 - m0) / ml;
          let half;
          if (u < 0) half = mh * Math.sqrt(Math.max(0, 1 - (u / 0.22) ** 2));
          else half = mh * Math.pow(Math.max(0, 1 - Math.pow(u, 3)), 0.5);
          const dy = y + 0.5 - oy;
          if (Math.abs(dy) > half) continue;
          const v = dy / Math.max(1, half);
          let light = 0.6 - v * 0.34 + (1 - Math.abs(v)) * 0.06 - (u < 0.02 ? 0.06 : 0);
          if (Math.abs(dy) > half - 1.2 && v < 0) light += 0.2;
          let col = rampPick(R, clamp01(light), x, y);
          if (hash2(Math.floor(x / Math.max(1.5, c.k * 0.8)), Math.floor(y / Math.max(1.5, c.k * 0.8)), 2) > 0.92 && u > 0.12) col = R[1];
          if (v < -0.45 && v > -0.8 && u > 0.18 && u < 0.62 && bayer(x, y) < 0.4) col = R[4];
          buf.set(x, y, col);
        }
        if (c.look.photophores && glow) {
          for (const [fx, fy] of [[m0 + ml * 0.95, oy], [m0 + ml * 0.6, oy - mh * 0.55], [m0 + ml * 0.6, oy + mh * 0.55]]) {
            const pr = Math.max(1, H * 0.035);
            shadedEllipse(buf, fx - pr * 0.5, fy, pr, pr, rp(c, "#8ff3ff"), { light: 0.8 });
            glow.fillCircle(fx - pr * 0.5, fy, pr + 0.5, pk2(c, "#8ff3ff"));
          }
        }
      }
    },
    face(c, ph, s, ox, oy, q) {
      const L = c.L * s, H = c.H * s;
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, H * 0.15);
      return {
        eyes: [{ x: ox + L * 0.05, y: oy - H * 0.05, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: true, main: true, angle: 0 }],
        mouth: { x: ox - L * 0.045, y: oy + H * 0.16, w: Math.max(3, H * 0.16), m: c.mouth, front: false, angle: Math.PI },
        anchors: { mouth: [ox - L * 0.1, oy], top: [ox + L * 0.2, oy - H * 0.5], tail: [ox - L * 0.5, oy], bottom: [ox, oy + H * 0.5] }
      };
    }
  };
  KINDS.octopus = {
    layers: [["back", "tail", 12], ["body", "swim", 8], ["front", "fin", 8]],
    ext(c) {
      const L = c.L, H = c.H;
      return [-L * 0.95, -H * 0.75, L * 0.95, H * 0.65];
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const L = c.L * s, H = c.H * s;
      const R = c.bodyR, F = c.finR;
      const a = c.alpha;
      if (part === "back" || part === "all") {
        const n = 6;
        const top = oy - H * 0.1;
        for (let y = Math.floor(top); y <= Math.ceil(oy + H * 0.55); y++) for (let x = Math.floor(ox - L * 0.75); x <= Math.ceil(ox + L * 0.75); x++) {
          const dx = x + 0.5 - ox, t = (y + 0.5 - top) / (H * 0.55);
          const w = L * (0.38 + 0.2 * t);
          if (Math.abs(dx) > w) continue;
          let edge = 0.62;
          let armHit = false;
          for (let i = 0; i < n; i++) {
            const xi = ((i + 0.5) / n * 2 - 1) * L * 0.5 + Math.sin(ph * TAU + i) * L * 0.03;
            const bump = Math.max(0, 1 - Math.abs(dx - xi) / (L * 0.08));
            edge = Math.max(edge, 0.62 + 0.38 * bump);
            if (bump > 0.55) armHit = true;
          }
          if (t > edge) continue;
          let col = rampPick(F, clamp01(0.5 - t * 0.25 - dx / L * 0.2 + (armHit ? 0.08 : -0.06)), x, y);
          if (armHit && t > 0.62 && (x + y & 3) === 0) col = F[4];
          buf.set(x, y, withA(col, armHit ? Math.min(255, a + 30) : Math.max(120, a - 50)));
        }
      }
      if (part === "body" || part === "all") {
        const sq = Math.sin(ph * TAU) * 0.05;
        shadedEllipse(buf, ox, oy - H * 0.16, L * 0.42 * (1 + sq), H * 0.36 * (1 - sq), R, {
          rim: true,
          alpha: a,
          fn: (nx, ny, x, y) => {
            if (hash2(Math.floor(x / Math.max(2, c.k)), Math.floor(y / Math.max(2, c.k)), 8) > 0.92 && ny < 0.5) return R[1];
            if (nx < -0.25 && nx > -0.6 && ny < -0.35 && ny > -0.75 && bayer(x, y) < 0.45) return R[4];
            return 0;
          }
        });
      }
      if (part === "front" || part === "all") {
        const flap = Math.sin(ph * TAU);
        for (const sd of [-1, 1]) {
          const fx = ox + sd * L * 0.34, fy = oy - H * 0.36;
          const ang = sd > 0 ? -0.35 - flap * 0.45 : Math.PI + 0.35 + flap * 0.45;
          for (let y = Math.floor(fy - L * 0.4); y <= fy + L * 0.4; y++) for (let x = Math.floor(fx - L * 0.4); x <= fx + L * 0.4; x++) {
            const dx = x + 0.5 - fx, dy = y + 0.5 - fy;
            const a2 = dx * Math.cos(ang) + dy * Math.sin(ang), b = -dx * Math.sin(ang) + dy * Math.cos(ang);
            if (a2 < -1 || (a2 / (L * 0.24)) ** 2 + (b / (L * 0.15)) ** 2 > 1) continue;
            const vv = b / (L * 0.15) * (sd > 0 ? 1 : -1);
            buf.set(x, y, withA(rampPick(F, clamp01(0.62 - vv * 0.25 + a2 / (L * 0.24) * 0.12), x, y), Math.min(255, a + 40)));
          }
        }
      }
    },
    face(c, ph, s, ox, oy, q) {
      const L = c.L * s, H = c.H * s;
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, L * 0.085);
      return {
        eyes: [-1, 1].map((sd, i) => ({ x: ox + sd * L * 0.17, y: oy - H * 0.12, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 })),
        mouth: { x: ox, y: oy - H * 0.12 + R * 1.9, w: Math.max(3, L * 0.12), m: c.mouth, front: true, angle: 0 },
        anchors: { mouth: [ox, oy + H * 0.05], top: [ox, oy - H * 0.55], tail: [ox, oy + H * 0.55], bottom: [ox, oy + H * 0.55] }
      };
    }
  };
  KINDS.isopod = {
    layers: [["back", "tail", 12], ["body", "swim", 8], ["front", "fin", 8]],
    ext(c) {
      const L = c.L, H = c.H;
      return [-L * 0.68, -H * 1.5, L * 0.95, H * 0.5];
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const L = c.L * s, H = c.H * s;
      const R = c.bodyR;
      const half = L / 2;
      if (part === "back" || part === "all") {
        const legs = 7, lr = Math.max(0.7, H * 0.05);
        for (const far of [1, 0]) for (let i = 0; i < legs; i++) {
          const bx = ox - half * 0.75 + i / (legs - 1) * half * 1.5 + (far ? H * 0.12 : 0);
          const p2 = ph * TAU + i * 0.9 + far * Math.PI;
          const lift = Math.max(0, Math.sin(p2)) * H * 0.1;
          const kx = bx + Math.cos(p2) * H * 0.1, ky = oy + H * 0.12 - lift;
          const RL = far ? R.map((v, j) => R[Math.max(0, j - 1)]) : R;
          capsule(buf, bx, oy - H * 0.05, kx, ky, lr, lr * 0.8, RL, { light: 0.4 });
          capsule(buf, kx, ky, kx + H * 0.06, oy + H * 0.32 - lift * 0.3, lr * 0.8, lr * 0.4, RL, { light: 0.35 });
        }
      }
      if (part === "body" || part === "all") {
        const segs = 8;
        for (let y = Math.floor(oy - H - 1); y <= Math.ceil(oy + 1); y++) for (let x = Math.floor(ox - half - 2); x <= Math.ceil(ox + half + H * 0.3); x++) {
          const dx = x + 0.5 - ox;
          let nx = dx / half;
          const head = nx > 0.82;
          const hh = head ? H * 0.68 * Math.sqrt(Math.max(0, 1 - ((nx - 0.82) / 0.33) ** 2)) : H * Math.pow(Math.max(0, 1 - nx * nx), 0.45);
          const dy = oy - (y + 0.5);
          if (dy < -0.5 || dy > hh) continue;
          const vy = dy / Math.max(1, hh);
          const segT = (nx + 1) / 2 * segs;
          const fs = fract(segT);
          let light = 0.45 + vy * 0.35 - nx * 0.05 + (head ? 0.05 : 0);
          if (!head) {
            if (fs > 0.82) light -= 0.25;
            else if (fs < 0.18) light += 0.15;
            if (dy > hh - 1.3) light += 0.2;
          }
          if (dy < H * 0.12) light -= 0.15;
          let col = rampPick(R, clamp01(light), x, y);
          if (!head && hash2(x >> 1, y >> 1, 5) > 0.93) col = R[3];
          if (vy > 0.55 && vy < 0.8 && nx > -0.6 && nx < 0.5 && bayer(x, y) < 0.35) col = R[4];
          buf.set(x, y, col);
        }
        for (const sd of [0, 1]) capsule(buf, ox - half * 0.92, oy - H * 0.15, ox - half * 1.12 - sd * H * 0.1, oy - H * (0.05 + sd * 0.15), Math.max(1, H * 0.1), Math.max(0.8, H * 0.06), R, { light: 0.45 + sd * 0.1 });
      }
      if (part === "front" || part === "all") {
        const hx = ox + half * 1.02, hy = oy - H * 0.35;
        for (const [k, lenM] of [[0, 1], [1, 0.6]]) {
          let px0 = hx, py0 = hy;
          const n = 10;
          for (let i = 1; i <= n; i++) {
            const t = i / n;
            const x = hx + t * H * 0.9 * lenM;
            const y = hy - Math.sin(t * 1.6) * H * 0.6 * lenM + Math.sin(ph * TAU + t * 3 + k) * t * H * 0.12 + t * t * H * 0.3 * lenM;
            capsule(buf, px0, py0, x, y, Math.max(0.5, H * 0.04 * (1 - t * 0.6)), Math.max(0.5, H * 0.035 * (1 - t * 0.6)), R, { light: 0.5 });
            px0 = x;
            py0 = y;
          }
        }
      }
    },
    face(c, ph, s, ox, oy, q) {
      const L = c.L * s, H = c.H * s;
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, H * 0.16);
      return {
        eyes: [{ x: ox + L * 0.47, y: oy - H * 0.38, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: false, main: true, angle: 0 }],
        mouth: { x: ox + L * 0.57, y: oy - H * 0.1, w: Math.max(2, H * 0.18), m: c.mouth, front: false, angle: 0 },
        anchors: { mouth: [ox + L * 0.58, oy - H * 0.1], top: [ox, oy - H - 3], tail: [ox - L * 0.55, oy], bottom: [ox, oy + 3] }
      };
    }
  };
  KINDS.blob = {
    layers: [["body", "swim", 8]],
    ext(c) {
      const L = c.L, H = c.H;
      return [-L * 0.75, -H * 0.8, L * 0.75, H * 0.95];
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const L = c.L * s, H = c.H * s;
      const R = c.bodyR;
      if (c.look.blobfish) {
        const wob = Math.sin(ph * TAU);
        for (let y = Math.floor(oy - H * 0.6); y <= Math.ceil(oy + H * 0.65); y++) for (let x = Math.floor(ox - L * 0.65); x <= Math.ceil(ox + L * 0.6); x++) {
          const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
          const hy = dy - H * 0.04;
          const head = Math.hypot((dx - L * 0.08) / (L * 0.36), hy / (H * (hy > 0 ? 0.5 : 0.42))) < 1 + 0.03 * Math.sin(ph * TAU + dx * 0.25);
          const t = (-dx - L * 0.05) / (L * 0.5);
          const tailB = t > 0 && t < 1 && Math.abs(dy - H * 0.12 * t) < H * 0.3 * (1 - t * 0.78);
          const fin = t > 0.9 && t < 1.22 && Math.abs(dy - H * 0.12) < H * 0.2 * (t - 0.82) * 3;
          if (!head && !tailB && !fin) continue;
          let col = rampPick(R, clamp01(0.6 - dy / H * 0.55 - dx / L * 0.1), x, y);
          if (fin) col = withA(c.finR[x & 1 ? 3 : 2], 225);
          if (head && Math.hypot((dx + L * 0.02) / (L * 0.14), (dy + H * 0.27) / (H * 0.08)) < 1 && bayer(x, y) < 0.5) col = R[4];
          if (head && dy > H * 0.25 && Math.abs(fract((dx + wob) / Math.max(3, L * 0.08)) - 0.5) < 0.08) col = R[1];
          if (hash2(x >> 1, y >> 1, 3) > 0.95) col = R[3];
          buf.set(x, y, col);
        }
        shadedEllipse(buf, ox + L * 0.41, oy + H * 0.1 + wob * 0.5, L * 0.13, H * 0.21, rp(c, c.look.nose || "#e0909e"), { rim: true });
        return;
      }
      const pts = [];
      for (let y = Math.floor(oy - H * 0.75); y <= Math.ceil(oy + H * 0.9); y++) for (let x = Math.floor(ox - L * 0.72); x <= Math.ceil(ox + L * 0.72); x++) {
        const dx = (x + 0.5 - ox) / (L / 2), dy = (y + 0.5 - oy) / (H / 2);
        const ang = Math.atan2(dy, dx);
        let rr2 = 1 + 0.09 * Math.sin(ang * 3 + ph * TAU) + 0.06 * Math.sin(ang * 5 - ph * TAU * 2);
        if (dy > 0) rr2 *= 1 - 0.12 * dy;
        const inside = dx * dx + dy * dy <= rr2 * rr2;
        let drip = false;
        for (const [ddx, dl] of [[-0.45, 0.35], [0.3, 0.55]]) {
          const len = dl * (0.8 + 0.2 * Math.sin(ph * TAU + ddx * 5));
          if (Math.abs(dx - ddx) < 0.07 * (1 - (dy - 0.75) / (len + 0.3)) + 0.03 && dy > 0.6 && dy < 0.75 + len) drip = true;
          if (Math.hypot((dx - ddx) * 1.2, dy - 0.8 - len) < 0.1) drip = true;
        }
        if (!inside && !drip) continue;
        let col = rampPick(R, clamp01(0.55 - dy * 0.3 - dx * 0.08), x, y);
        if (drip && !inside) col = R[1];
        if (dx < -0.35 && dx > -0.7 && dy < -0.3 && dy > -0.55 && bayer(x, y) < 0.45) col = R[4];
        if (hash2(x >> 1, y >> 1, 21) > 0.97) col = R[4];
        pts.push(1);
        buf.set(x, y, col);
      }
      const J = (u, v) => [ox + u * L / 2, oy + v * H / 2];
      const [cx1, cy1] = J(-0.55, 0.15);
      const cr = Math.max(2, L * 0.06);
      for (let a2 = 0; a2 < TAU; a2 += 0.15) buf.set(Math.round(cx1 + Math.cos(a2) * cr), Math.round(cy1 + Math.sin(a2) * cr * 0.7), pk2(c, "#c8d0d8"));
      const [cx2, cy2] = J(0.5, 0.45);
      shadedEllipse(buf, cx2, cy2, Math.max(2, L * 0.07), Math.max(1.5, L * 0.05), rp(c, "#d83a3a"), { fn: (nx, ny) => Math.hypot(nx, ny) > 0.78 && Math.floor(Math.atan2(ny, nx) * 6) & 1 ? rp(c, "#d83a3a")[1] : 0 });
      const [cx3, cy3] = J(-0.1, -0.62);
      for (let i = 0; i < Math.max(4, L * 0.16); i++) buf.set(Math.round(cx3 + i - L * 0.08), Math.round(cy3 + (i & 1)), pk2(c, "#eef0e8"));
      for (let i = 0; i < 3; i++) buf.line(cx3 - L * 0.03 + i * L * 0.04, cy3 - 2, cx3 - L * 0.03 + i * L * 0.04, cy3 + 3, pk2(c, "#eef0e8"));
      void pts;
    },
    face(c, ph, s, ox, oy, q) {
      const L = c.L * s, H = c.H * s;
      if (c.look.blobfish) {
        const R2 = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.5, H * 0.06);
        return {
          eyes: [{ x: ox + L * 0.27, y: oy - H * 0.12, r: R2, e: c.eyes[0], idx: 0, mirror: false, cheek: true, main: true, angle: 0 }],
          mouth: { x: ox + L * 0.38, y: oy + H * 0.36, w: Math.max(3, L * 0.18), m: c.mouth, front: false, angle: 0 },
          anchors: { mouth: [ox + L * 0.45, oy + H * 0.25], top: [ox, oy - H * 0.55], tail: [ox - L * 0.6, oy], bottom: [ox, oy + H * 0.5] }
        };
      }
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(2, L * 0.075);
      const ex = ox + L * 0.12, ey = oy - H * 0.14;
      return {
        eyes: [-1, 1].map((sd, i) => ({ x: ex + sd * L * 0.13, y: ey, r: R, e: c.eyes[0], idx: i, mirror: sd < 0, cheek: true, main: i === 1, angle: 0 })),
        mouth: { x: ex, y: ey + R * 2.1, w: Math.max(3, L * 0.16), m: c.mouth, front: true, angle: 0 },
        anchors: { mouth: [ex, ey + R * 2.5], top: [ox, oy - H * 0.6], tail: [ox - L * 0.55, oy], bottom: [ox, oy + H * 0.55] }
      };
    }
  };
  KINDS.iconfish = {
    layers: [["back", "tail", 12], ["body", "swim", 8], ["front", "fin", 8]],
    ext(c) {
      const z = c.L;
      return [-z * 1, -z * 0.68, z * 0.62, z * 0.68];
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const size = c.L * s, half = size / 2;
      const R = c.bodyR, F = c.finR;
      const posing = q.pose;
      if ((part === "back" || part === "all") && !posing) {
        const fl = Math.sin(ph * TAU) * half * 0.18;
        const bx = ox - half + 1;
        for (let y = Math.floor(oy - half); y <= oy + half; y++) for (let x = Math.floor(bx - half * 0.8); x <= bx; x++) {
          const a = bx - x, t = a / (half * 0.75);
          if (t > 1) continue;
          const dy = y + 0.5 - oy - fl * t;
          const outer = half * (0.18 + 0.42 * Math.sqrt(t));
          const inner = half * 0.42 * Math.max(0, (t - 0.55) / 0.45);
          if (Math.abs(dy) > outer || Math.abs(dy) < inner) continue;
          const ray = (Math.floor(Math.atan2(dy, a + 4) * 6) & 1) === 0;
          buf.set(x, y, F[t > 0.8 ? 4 : ray ? 2 : 3]);
        }
      }
      if (part === "body" || part === "all") {
        const r = Math.max(2.5, half * 0.32);
        const GL = rp(c, c.look.glyphColor || "#ffffff");
        for (let y = Math.floor(oy - half); y < oy + half; y++) for (let x = Math.floor(ox - half); x < ox + half; x++) {
          const dx = Math.abs(x + 0.5 - ox) - (half - r), dy = Math.abs(y + 0.5 - oy) - (half - r);
          if (dx > 0 && dy > 0 && dx * dx + dy * dy > r * r) continue;
          const t = (y + 0.5 - (oy - half)) / size;
          let col = rampPick(R, clamp01(0.85 - t * 0.55), x, y);
          const edge = Math.max(dx, dy, dx > 0 && dy > 0 ? Math.hypot(dx, dy) - r : -99);
          if (edge > -1.2 && y + 0.5 > oy) col = R[1];
          if (t < 0.45 && edge < -1.5 && bayer(x, y) < 0.35 * (1 - t * 2)) col = R[4];
          buf.set(x, y, col);
        }
        const gx = ox + half * 0.04, gy = oy - half * 0.04;
        shadedEllipse(buf, gx + half * 0.06, gy, half * 0.42, half * 0.27, GL, { light: 0.75 });
        buf.fillPoly([[gx - half * 0.3, gy], [gx - half * 0.62, gy - half * 0.27], [gx - half * 0.62, gy + half * 0.27]], GL[3]);
        const bs = Math.max(5, Math.round(half * 0.5));
        const bx0 = Math.round(ox - half + 1), by0 = Math.round(oy + half - bs - 1);
        buf.rect(bx0, by0, bs, bs, P("#ffffff"));
        const A = pk2(c, "#2a6ad8");
        for (let i = 1; i < bs - 1; i++) buf.set(bx0 + i, by0 + bs - 1 - i, A);
        buf.line(bx0 + bs - 2, by0 + 1, bx0 + bs - 2, by0 + Math.round(bs * 0.55), A);
        buf.line(bx0 + Math.round(bs * 0.45), by0 + 1, bx0 + bs - 2, by0 + 1, A);
        buf.line(bx0, by0 + bs, bx0 + bs - 1, by0 + bs, P("#9aa8c0"));
      }
      if ((part === "front" || part === "all") && !posing) {
        const fl = Math.sin(ph * TAU) * 0.5;
        for (const sd of [1]) {
          const fx = ox + half * 0.1, fy = oy + half * 0.95;
          for (let k = 0; k < half * 0.5; k++) {
            const t = k / (half * 0.5);
            const w = (1 - t) * half * 0.22;
            for (let j = -w; j <= w; j++) buf.set(Math.round(fx - k * 0.6 + j * 0.3), Math.round(fy + k * (0.5 + fl * 0.4) * sd + j * 0.2), F[t > 0.7 ? 4 : 3]);
          }
        }
      }
    },
    face(c, ph, s, ox, oy, q) {
      const half = c.L * s / 2;
      if (q.pose) return { eyes: [], mouth: null, anchors: { mouth: [ox + half, oy], top: [ox, oy - half - 3], tail: [ox - half, oy], bottom: [ox, oy + half] } };
      const R = c.look.eye?.r ? c.look.eye.r * s : Math.max(1.8, half * 0.13);
      return {
        eyes: [{ x: ox + half * 0.3, y: oy - half * 0.08, r: R, e: c.eyes[0], idx: 0, mirror: false, cheek: false, main: true, angle: 0 }],
        mouth: { x: ox + half * 0.5, y: oy + half * 0.08, w: Math.max(2, half * 0.2), m: c.mouth, front: false, angle: 0 },
        anchors: { mouth: [ox + half, oy + 1], top: [ox, oy - half - 3], tail: [ox - half - 5, oy], bottom: [ox, oy + half] }
      };
    }
  };
  function segColor(c, dx, dy, x, y) {
    const d2 = dx * dx + dy * dy;
    const head = c.chain.head;
    let light = 0.55 - dy * 0.35 - dx * 0.12 + Math.sqrt(Math.max(0, 1 - d2)) * 0.15;
    if (head === "plug" && Math.abs(dy + 0.35) < 0.15) light += 0.35;
    if (head === "noodle" && Math.abs(dy + 0.4) < 0.18 && bayer(x, y) < 0.6) light += 0.3;
    return rampPick(dy > 0.45 && head === "eel" ? c.bellyR : c.bodyR, clamp01(light), x, y);
  }
  function stampSegment(c, buf, cx, cy, r) {
    r = Math.max(1, r);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
      if (dx * dx + dy * dy <= 1) buf.set(x, y, segColor(c, dx, dy, x, y));
    }
  }
  function chainSegment(c, r) {
    r = Math.max(1, r);
    const key = "seg" + Math.round(r * 4);
    if (!c._segs) c._segs = /* @__PURE__ */ new Map();
    let out = c._segs.get(key);
    if (out) return out;
    const n = Math.ceil(r * 2 + 3);
    const buf = new PixelBuffer(n, n);
    const cc = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - cc) / r, dy = (y + 0.5 - cc) / r;
      if (dx * dx + dy * dy > 1) continue;
      buf.set(x, y, segColor(c, dx, dy, x, y));
    }
    out = { canvas: buf.toCanvas(), o: cc };
    c._segs.set(key, out);
    return out;
  }
  function paintChainHead(c, buf, glow, cx, cy, ang, s, ph) {
    const r = c.chain.r * s;
    const head = c.chain.head;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const R = c.bodyR;
    const hb = Math.ceil(r * 4.5 + 4);
    for (let y = Math.floor(cy - hb); y <= cy + hb; y++) for (let x = Math.floor(cx - hb); x <= cx + hb; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const lx = (dx * ca + dy * sa) / r, ly = (-dx * sa + dy * ca) / r;
      let col = 0;
      if (head === "plug") {
        const hx = lx - 0.2, bxr = Math.max(0, Math.abs(hx) - 1), byr = Math.max(0, Math.abs(ly) - 0.85);
        if (Math.hypot(bxr, byr) < 0.35) {
          const H2 = rp(c, c.chain.housing || "#e8e8ec");
          col = rampPick(H2, clamp01(0.62 - ly * 0.3 - (hx < -0.6 ? 0.18 : 0)), x, y);
          if (hx < -0.55 && Math.abs(fract(hx * 3.2) - 0.5) < 0.18) col = H2[1];
          if (hx > 1.2) col = H2[1];
        } else if (lx > 1.5 && lx < 2.6 && (Math.abs(ly - 0.42) < 0.16 || Math.abs(ly + 0.42) < 0.16)) {
          const M = rp(c, "#d8c060");
          col = M[ly < 0 ? 3 : 2];
          if (lx > 2 && lx < 2.2) col = M[0];
        }
      } else if (head === "noodle") {
        const d = Math.hypot(lx / 1.35, ly);
        if (d < 1) col = rampPick(R, clamp01(0.58 - ly * 0.3 - lx * 0.05 + (Math.abs(ly + 0.45) < 0.15 ? 0.25 : 0)), x, y);
        const nh = Math.hypot((lx + 0.1) / 0.75, (ly + 1.05) / 0.35);
        if (nh < 1) {
          const sp = fract(Math.hypot(lx + 0.1, (ly + 1.05) * 2.2) * 2.6 - Math.atan2(ly + 1.05, lx + 0.1) / TAU);
          col = sp < 0.3 ? pk2(c, "#ff7aa8") : pk2(c, "#fff8f0");
          if (nh > 0.82) col = pk2(c, "#e8d8d0");
        }
      } else {
        const d = Math.hypot((lx - 0.2) / 1.7, ly / (lx > 0.2 ? 0.95 : 1.05));
        if (d < 1) {
          col = rampPick(ly > 0.35 ? c.bellyR : R, clamp01(0.55 - ly * 0.35 + lx * 0.04), x, y);
          if (Math.abs(lx + 0.5 - ly * ly * 0.3) < 0.08 && Math.abs(ly) < 0.7) col = R[1];
        }
        if (ly < -0.85 && ly > -1.3 && lx < 0.4 && lx > -1.4 && ly > -0.95 - 0.25 * Math.sin((lx + 1.4) * 2.2)) col = c.finR[3];
      }
      if (col) buf.set(x, y, col);
    }
    const toC = (lx, ly) => [cx + (lx * ca - ly * sa) * r, cy + (lx * sa + ly * ca) * r];
    const er = Math.max(1.6, r * (head === "noodle" ? 0.32 : head === "plug" ? 0.34 : 0.3));
    const eyes = head === "noodle" ? [[0.35, -0.2, 0], [0.85, -0.2, 1]] : head === "plug" ? [[0.3, -0.35, 0], [0.95, -0.35, 1]] : [[0.75, -0.3, 0]];
    const mouthAt = head === "noodle" ? [1.05, 0.38] : head === "plug" ? [1.25, 0.4] : [1.85, 0.3];
    return {
      eyes: eyes.map(([lx, ly, i]) => {
        const [x, y] = toC(lx, ly);
        return { x, y, r: er, e: c.eyes[0], idx: i, mirror: false, cheek: i === 0, main: i === eyes.length - 1, angle: ang };
      }),
      mouth: { x: toC(...mouthAt)[0], y: toC(...mouthAt)[1], w: Math.max(2.5, r * 0.7), m: c.mouth, front: false, angle: ang },
      nose: toC(head === "plug" ? 2.6 : 1.9, 0)
    };
  }
  function chainHeadSprite(c, ang, s, ph = 0) {
    const r = c.chain.r * s;
    const hb = Math.ceil(r * 4.5 + 6);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    const face = paintChainHead(c, buf, null, hb, hb, ang, s, ph);
    buf.outline(outlineFnFor(c));
    return { canvas: buf.toCanvas(), o: hb, face };
  }
  function defaultChainPoints(c, s = 1, ph = 0, x0 = 0, y0 = 0, facing = 1) {
    const n = c.chain.segs, r = c.chain.r * s;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      pts.push({ x: x0 - facing * i * r * 1.15, y: y0 + Math.sin(ph * TAU - t * 5) * r * 1.6 * Math.min(1, t * 2.5) });
    }
    return pts;
  }
  var chainRadius = (c, i, n, s = 1) => {
    const r = c.chain.r * s;
    const t = i / Math.max(1, n - 1);
    if (c.chain.head === "plug") return Math.max(1, r * 0.42);
    if (c.chain.head === "noodle") return Math.max(1, r * (0.62 - 0.15 * t));
    return Math.max(1, r * (0.95 - 0.55 * t * t));
  };
  KINDS.chain = {
    layers: [["body", "swim", 8]],
    ext(c) {
      const n = c.chain.segs, r = c.chain.r;
      return [-n * r * 1.2 - r * 2, -r * 4.5, r * 4.5, r * 4.5];
    },
    paint(c, part, buf, glow, ox, oy, s, ph, q) {
      const pts = defaultChainPoints(c, s, ph, ox, oy, 1);
      const n = pts.length;
      for (let i = n - 1; i >= 1; i--) {
        const a = pts[i], b = pts[i - 1];
        const ra = chainRadius(c, i, n, s), rb = chainRadius(c, i - 1, n, s);
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, Math.min(ra, rb) * 0.6)));
        for (let k = 0; k < steps; k++) {
          const u = k / steps;
          stampSegment(c, buf, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, ra + (rb - ra) * u);
        }
      }
      const ang = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
      q._chainFace = paintChainHead(c, buf, glow, pts[0].x, pts[0].y, ang, s, ph);
    },
    face(c, ph, s, ox, oy, q) {
      const pts = defaultChainPoints(c, s, ph, ox, oy, 1);
      const ang = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
      const scratch2 = new PixelBuffer(1, 1);
      const f = paintChainHead(c, scratch2, null, pts[0].x, pts[0].y, ang, s, ph);
      const last = pts[pts.length - 1];
      return { eyes: f.eyes, mouth: f.mouth, anchors: { mouth: f.nose, top: [pts[0].x, pts[0].y - c.chain.r * s * 2], tail: [last.x, last.y], bottom: [pts[0].x, pts[0].y + c.chain.r * s] } };
    }
  };
  function finishBuf(c, buf, glow, sil, noOutline = false) {
    if (noOutline && !sil) return;
    if (sil) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i] >>> 24) buf.data[i] = 4281540624 >>> 0;
      buf.outline(() => 4280423688 >>> 0);
      return;
    }
    const neon = c.variant?.mutation === "neon" && glow;
    const before = neon ? buf.data.slice() : null;
    buf.outline(outlineFnFor(c));
    if (neon) {
      const rim = P(shade(c.bodyHex, 0.5));
      for (let i = 0; i < buf.data.length; i++) if (!before[i] && buf.data[i]) glow.data[i] = rim;
    }
  }
  function cropOut(buf, glow) {
    const { w, h, data } = buf;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[y * w + x] >>> 24 || glow && glow.data[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { canvas: null, glowCanvas: null, x: 0, y: 0 };
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    if (cw === w && ch === h) return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, x: 0, y: 0 };
    const nb = new PixelBuffer(cw, ch);
    const ng = glow ? new PixelBuffer(cw, ch) : null;
    let anyGlow = false;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      nb.data[y * cw + x] = data[(y + y0) * w + x + x0];
      if (ng) {
        const g = glow.data[(y + y0) * w + x + x0];
        ng.data[y * cw + x] = g;
        if (g) anyGlow = true;
      }
    }
    return { canvas: nb.toCanvas(), glowCanvas: ng && anyGlow ? ng.toCanvas() : null, x: x0, y: y0 };
  }
  var isKind = (c) => !!KINDS[c.kind];
  function rigLayers(c) {
    if (c._layers) return c._layers;
    const K = KINDS[c.kind];
    let out;
    if (K) out = K.layers.map(([id, phase, frames]) => ({ id, phase, frames }));
    else {
      out = [];
      if (c.tail.type !== "none") out.push({ id: "tail", phase: "tail", frames: 12 });
      if (c.fins.length) out.push({ id: "back", phase: "fin", frames: 8 });
      out.push({ id: "body", phase: "swim", frames: 8 });
      if (c.pectoral) out.push({ id: "front", phase: "fin", frames: 8 });
    }
    c._layers = out;
    return out;
  }
  function rigGeom(c, q) {
    const s = q.scale || 1;
    const K = KINDS[c.kind];
    if (K) {
      const B3 = boundsFor(K.ext(c), 0, s);
      const f2 = K.face(c, q.sw || 0, s, B3.ox, B3.oy, q);
      return { w: B3.w, h: B3.h, ox: B3.ox, oy: B3.oy, eyes: f2.eyes, mouth: f2.mouth, anchors: f2.anchors, offsets: null };
    }
    const G = geomOf(c, q.inflate || 0);
    const B2 = boundsFor(genericExtent(c, G), q.angle || 0, s);
    const f = genericFace(c, G, q.sw || 0, q.angle || 0, s, B2.ox, B2.oy, !!q.still);
    return { w: B2.w, h: B2.h, ox: B2.ox, oy: B2.oy, eyes: f.eyes, mouth: f.mouth, anchors: f.anchors, offsets: f.offsets };
  }
  function rasterLayer(c, layer, q) {
    const s = q.scale || 1;
    const K = KINDS[c.kind];
    if (K) {
      const B3 = boundsFor(K.ext(c), 0, s);
      const buf2 = new PixelBuffer(B3.w, B3.h);
      const glow2 = c.glow ? new PixelBuffer(B3.w, B3.h) : null;
      K.paint(c, layer, buf2, glow2, B3.ox, B3.oy, s, q.ph || 0, q);
      finishBuf(c, buf2, glow2, false);
      return cropOut(buf2, glow2);
    }
    const angle = q.angle || 0;
    const G = geomOf(c, q.inflate || 0);
    const ext2 = genericExtent(c, G);
    const B2 = boundsFor(ext2, angle, s);
    const rect = rectFor(layerBox(c, G, layer, ext2), angle, s, B2.ox, B2.oy, B2.w, B2.h);
    const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
    if (w <= 0 || h <= 0) return { canvas: null, glowCanvas: null, x: 0, y: 0 };
    const buf = new PixelBuffer(w, h);
    const glow = c.glow && layer === "body" ? new PixelBuffer(w, h) : null;
    const ph = q.ph || 0;
    const prm = { still: q.still, inflate: q.inflate, sw: layer === "body" ? ph : 0, tp: ph, fp: ph, raise: q.raise || 0 };
    paintGeneric(c, buf, glow, rect.x0, rect.y0, B2.ox, B2.oy, angle, s, layer, prm, G, rect);
    finishBuf(c, buf, glow, false, layer === "front");
    const out = cropOut(buf, glow);
    out.x += rect.x0;
    out.y += rect.y0;
    return out;
  }

  // src/gfx/fishrig.js
  var ANGLE_STEP = Math.PI / 12;
  var MAX_ITEMS = 7e3;
  var cache2 = /* @__PURE__ */ new Map();
  var families = /* @__PURE__ */ new Map();
  var nextId = 1;
  var budgetMs = 6;
  var spent = 0;
  var windowStart = 0;
  var statRaster = 0;
  var statFallback = 0;
  var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  var fract2 = (v) => v - Math.floor(v);
  var clamp2 = (v, a, b) => v < a ? a : v > b ? b : v;
  var TAU2 = Math.PI * 2;
  function setRigBudget(ms) {
    budgetMs = ms;
  }
  function idOf(c) {
    if (c.id == null && c._rid == null) c._rid = "r" + nextId++;
    return c.id ?? c._rid;
  }
  function overBudget() {
    const t = now();
    if (t - windowStart > 14) {
      windowStart = t;
      spent = 0;
    }
    return spent >= budgetMs;
  }
  function timed(fn) {
    const t0 = now();
    const r = fn();
    spent += now() - t0;
    statRaster++;
    return r;
  }
  function cacheGet(key) {
    const r = cache2.get(key);
    if (r !== void 0) {
      cache2.delete(key);
      cache2.set(key, r);
    }
    return r;
  }
  function cachePut(key, val, fam, frame) {
    cache2.set(key, val);
    if (fam != null) {
      let s = families.get(fam);
      if (!s) families.set(fam, s = /* @__PURE__ */ new Set());
      s.add(frame);
    }
    if (cache2.size > MAX_ITEMS) {
      const it = cache2.keys();
      for (let i = 0; i < 400; i++) {
        const k = it.next().value;
        cache2.delete(k);
        const bar = k.lastIndexOf("#");
        if (bar > 0) families.get(k.slice(0, bar))?.delete(Number(k.slice(bar + 1)));
      }
    }
  }
  function getLayer(c, layer, frames, frame, q, famKey) {
    const key = famKey + "#" + frame;
    let r = cacheGet(key);
    if (r) return r;
    const fam = families.get(famKey);
    if (fam && fam.size && overBudget()) {
      let best = -1, bd = 99;
      for (const f of fam) {
        const d = Math.min(Math.abs(f - frame), frames - Math.abs(f - frame));
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      r = cache2.get(famKey + "#" + best);
      if (r) {
        statFallback++;
        return r;
      }
    }
    r = timed(() => rasterLayer(c, layer, { ...q, ph: frame / frames }));
    cachePut(key, r, famKey, frame);
    return r;
  }
  var scratch = null;
  function scratchFor(w, h) {
    if (!scratch || scratch.width < w || scratch.height < h) {
      scratch = makeCanvas(Math.max(w, scratch?.width || 0, 64), Math.max(h, scratch?.height || 0, 64));
      scratch._g = ctxOf(scratch);
    }
    const g = scratch._g;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    return scratch;
  }
  var ANIM_EMO = { dizzy: 1, sad: 1, scared: 1, tired: 1, angry: 1 };
  function eyeSprite(c, ev, fs, ang) {
    const R = ev.r;
    const n = Math.max(2, Math.round(R * 0.7));
    const lxq = Math.round(clamp2(fs.lx, -1, 1) * n), lyq = Math.round(clamp2(fs.ly, -1, 1) * n);
    const gxq = Math.round((fs.gx || 0) * n), gyq = Math.round((fs.gy || 0) * n);
    const bq = Math.round(clamp2(fs.blink, 0, 1) * 4);
    const tq = ANIM_EMO[fs.emotion] || ev.e.type === "googly" ? Math.floor(fs.time * 8) % 24 : 0;
    const pq = Math.round((fs.pupil || 1) * 10), dq = Math.round((fs.dim || 0) * 10);
    const key = `${idOf(c)}|e|${ev.idx}|${Math.round(ang * 100)}|${Math.round(R * 4)}|${fs.emotion}|${bq}|${lxq},${lyq}|${gxq},${gyq}|${tq}|${ev.mirror ? 1 : 0}${ev.cheek ? 1 : 0}${ev.main ? 1 : 0}|${pq}|${dq}`;
    let r = cacheGet(key);
    if (r) return r;
    r = timed(() => {
      const hb = eyeBox(R);
      const buf = new PixelBuffer(hb * 2, hb * 2);
      const glow = ev.e.type === "glow" ? new PixelBuffer(hb * 2, hb * 2) : null;
      paintEye(buf, glow, hb, hb, c, ev.e, {
        emotion: fs.emotion,
        blink: bq / 4,
        lx: lxq / n,
        ly: lyq / n,
        gx: gxq / n,
        gy: gyq / n,
        time: tq / 8,
        mirror: ev.mirror,
        cheek: ev.cheek,
        main: ev.main,
        pupil: pq / 10,
        dim: dq / 10
      }, ang, R);
      return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, o: hb };
    });
    cachePut(key, r);
    return r;
  }
  function mouthSprite(c, mo, fs) {
    const W = mo.w;
    const oq = Math.round(clamp2(fs.open, 0, 1) * 6);
    const key = `${idOf(c)}|m|${Math.round((mo.angle || 0) * 100)}|${Math.round(W * 4)}|${fs.emotion}|${oq}|${mo.front ? 1 : 0}|${mo.m.type}|${mo.m.lineP}`;
    let r = cacheGet(key);
    if (r) return r;
    r = timed(() => {
      const hb = mouthBox(W);
      const buf = new PixelBuffer(hb * 2, hb * 2);
      paintMouth(buf, hb, hb, c, mo.m, { emotion: fs.emotion, open: oq / 6, time: 0 }, mo.angle || 0, W, mo.front);
      return { canvas: buf.toCanvas(), o: hb };
    });
    cachePut(key, r);
    return r;
  }
  function faceState(st, ang, sx, X, Y, geo) {
    let lx = 0, ly = 0;
    if (st.lookX != null && st.lookY != null) {
      let dx = (st.lookX - X) * Math.sign(sx || 1), dy = st.lookY - Y;
      const ca = Math.cos(-ang), sa = Math.sin(-ang);
      const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
      const m = Math.hypot(rx, ry);
      if (m > 0.01) {
        const k = Math.min(1, m / 24) / m;
        lx = rx * k;
        ly = ry * k;
      }
    }
    const t = st.time || 0;
    const cue = realCues(st.emotion || "neutral");
    const toon = geo?.toon;
    if (!toon) {
      if (cue.spin) {
        lx = Math.cos(t * 7) * 0.75;
        ly = Math.sin(t * 7) * 0.75;
      }
      if (cue.lx) lx = clamp2(lx + cue.lx, -1, 1);
      if (cue.ly) ly = clamp2(ly + cue.ly, -1, 1);
    }
    const gx = lx * 0.6 + Math.sin(t * 9.1) * 0.25 * (st.speed01 ?? 0.4);
    const gy = 0.55 + ly * 0.3 + Math.cos(t * 7.3) * 0.2 * (st.speed01 ?? 0.4);
    return {
      emotion: st.emotion || "neutral",
      blink: st.blink || 0,
      lx,
      ly,
      gx: clamp2(gx, -1, 1),
      gy: clamp2(gy, -1, 1),
      time: t,
      open: clamp2(Math.max(st.mouth || 0, geo?.rest || 0) + (toon ? 0 : cue.gape || 0), 0, 1),
      pupil: toon ? 1 : cue.pupil || 1,
      dim: toon ? 0 : cue.dim || 0,
      cue
    };
  }
  var GILL = [P_("#3a0610"), P_("#8a1a2c"), P_("#c03a4a")];
  function P_(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (4278190080 | (n & 255) << 16 | n & 65280 | n >> 16) >>> 0;
  }
  function gillSprite(c, geo, gkey, w) {
    const key = gkey + "|gill|" + w;
    let r = cacheGet(key);
    if (r !== void 0) return r;
    const { pts, nx, ny } = geo.gill;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    x0 = Math.floor(x0 - 4);
    y0 = Math.floor(y0 - 4);
    x1 = Math.ceil(x1 + 4);
    y1 = Math.ceil(y1 + 4);
    const buf = new PixelBuffer(x1 - x0, y1 - y0);
    pts.forEach(([x, y], i) => {
      const edge = i < 2 || i > pts.length - 3;
      for (let k = 0; k < (edge ? Math.min(1, w) : w); k++) buf.set(Math.round(x + nx * k) - x0, Math.round(y + ny * k) - y0, GILL[Math.min(2, k + (k === w - 1 && w > 1 ? 1 : 0))]);
    });
    r = { canvas: buf.toCanvas(), x: x0, y: y0 };
    cachePut(key, r);
    return r;
  }
  function drawFishRig(ctx2, c, st) {
    if (c.kind === "chain") return drawChainRig(ctx2, c, st);
    const kind = isKind(c);
    const s = Math.max(1, Math.round((st.scale ?? 1) * 8)) / 8;
    const angle = kind ? 0 : st.angle || 0;
    let a = clamp2(Math.round(angle / ANGLE_STEP), -6, 6);
    const inf = kind ? 0 : Math.round(clamp2(st.inflate || 0, 0, 1) * 4) / 4;
    const pose = !!(st.pose || st.emotion === "pose");
    const t = st.time || 0;
    const sw = st.swimPhase ?? t * 1.2;
    const tp = st.tailPhase ?? sw;
    const fp = st.finPhase ?? sw;
    const id = idOf(c);
    const layers = rigLayers(c);
    const fam = (L, aa) => `${id}|${L}|${aa}|${s}|${inf}|${pose ? 1 : 0}`;
    if (!kind && !families.get(fam("body", a))?.size && overBudget()) {
      for (let d = 1; d <= 12; d++) {
        const cand = [a - d, a + d].find((v) => v >= -6 && v <= 6 && families.get(fam("body", v))?.size);
        if (cand !== void 0) {
          a = cand;
          statFallback++;
          break;
        }
      }
    }
    const ang = a * ANGLE_STEP;
    const fsw = Math.floor(fract2(sw) * 8);
    const gkey = `${id}|g|${a}|${s}|${inf}|${fsw}|${pose ? 1 : 0}`;
    let geo = cacheGet(gkey);
    if (!geo) {
      geo = rigGeom(c, { sw: fsw / 8, angle: ang, scale: s, inflate: inf, pose });
      geo.toon = !!c.toon;
      geo.rest = c.mouth?.rest || 0;
      cachePut(gkey, geo);
    }
    const facing = st.facing ?? 1;
    const sx = facing * (st.turn ?? 1);
    const sq = clamp2(st.squash || 0, -1, 1);
    const kx = 1 + 0.22 * sq, ky = 1 - 0.2 * sq;
    const fs = faceState(st, ang, sx, st.x, st.y, geo);
    const cue = fs.cue;
    const twitch = cue.twitch && !st.silhouette ? (Math.floor(t * 23) % 3 - 1) * (Math.floor(t * 7) & 1) : 0;
    const X = Math.round(st.x) + twitch, Y = Math.round(st.y + (st.bob || 0));
    const raise = kind ? 0 : (st.raise ?? cue.raise ?? 0) > 0.5 ? 1 : 0;
    const items = [];
    const glows = [];
    const q = { angle: ang, scale: s, inflate: inf, pose };
    for (const L of layers) {
      const ph = L.phase === "tail" ? tp : L.phase === "fin" ? fp : sw;
      const frame = Math.floor(fract2(ph) * L.frames) % L.frames;
      const lr = L.id === "back" && raise;
      const r = getLayer(c, L.id, L.frames, frame, lr ? { ...q, raise: 1 } : q, fam(L.id, a) + (lr ? "|R" : ""));
      if (!r.canvas) continue;
      const off = geo.offsets?.[L.id] || [0, 0];
      items.push([r.canvas, r.x + off[0] - geo.ox, r.y + off[1] - geo.oy]);
      if (r.glowCanvas) glows.push([r.glowCanvas, r.x + off[0] - geo.ox, r.y + off[1] - geo.oy]);
    }
    if (!st.silhouette && geo.gill) {
      const rate = 0.7 * (cue.breath || 1);
      const fl = 0.5 + 0.5 * Math.sin(t * TAU2 * rate);
      const w = fl > 0.86 ? 2 : fl > 0.5 ? 1 : 0;
      if (w) {
        const gs = gillSprite(c, geo, gkey, w + ((cue.breath || 1) >= 2 && w ? 1 : 0));
        if (gs) items.push([gs.canvas, gs.x - geo.ox, gs.y - geo.oy]);
      }
    }
    if (!st.silhouette) {
      for (const ev of geo.eyes) {
        const sp = eyeSprite(c, ev, fs, ev.angle ?? ang);
        const dx = Math.round(ev.x - sp.o) - geo.ox, dy = Math.round(ev.y - sp.o) - geo.oy;
        items.push([sp.canvas, dx, dy]);
        if (sp.glowCanvas) glows.push([sp.glowCanvas, dx, dy]);
      }
      if (geo.mouth && geo.mouth.m && geo.mouth.m.type !== "none") {
        const sp = mouthSprite(c, geo.mouth, fs);
        items.push([sp.canvas, Math.round(geo.mouth.x - sp.o) - geo.ox, Math.round(geo.mouth.y - sp.o) - geo.oy]);
      }
    }
    const flush = !c.toon && cue.flush && !st.silhouette ? cue.flush : null;
    compose(ctx2, items, glows, X, Y, sx * kx, ky, flush ? { ...st, flush } : st, c, geo.w + 40, geo.h + 40);
    const toW = (p) => [X + (p[0] - geo.ox) * sx * kx, Y + (p[1] - geo.oy) * ky];
    const out = {};
    for (const [k, v] of Object.entries(geo.anchors)) if (Array.isArray(v)) out[k] = toW(v);
    out.eyes = geo.eyes.map((e) => {
      const [x, y] = toW([e.x, e.y]);
      return { x, y, r: e.r * Math.abs(sx * kx), type: e.e.type };
    });
    return out;
  }
  function compose(ctx2, items, glows, X, Y, scx, scy, st, c, bw, bh) {
    const wash = st.wash && st.wash.alpha > 0.01 ? st.wash : null;
    const sil = st.silhouette;
    const flush = st.flush;
    if (wash || sil || flush) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [cv, dx, dy] of items) {
        x0 = Math.min(x0, dx);
        y0 = Math.min(y0, dy);
        x1 = Math.max(x1, dx + cv.width);
        y1 = Math.max(y1, dy + cv.height);
      }
      if (!isFinite(x0)) return;
      const w = x1 - x0, h = y1 - y0;
      const sc = scratchFor(w, h);
      const g = sc._g;
      for (const [cv, dx, dy] of items) g.drawImage(cv, dx - x0, dy - y0);
      g.globalCompositeOperation = "source-atop";
      if (flush && !sil) {
        g.globalAlpha = flush[1];
        g.fillStyle = flush[0];
        g.fillRect(0, 0, w, h);
      }
      if (sil || wash) {
        g.globalAlpha = sil ? 1 : Math.min(1, wash.alpha);
        g.fillStyle = sil ? typeof sil === "string" ? sil : "#102033" : wash.color;
        g.fillRect(0, 0, w, h);
      }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      ctx2.save();
      ctx2.translate(X, Y);
      ctx2.scale(scx, scy);
      ctx2.drawImage(sc, 0, 0, w, h, x0, y0, w, h);
      ctx2.restore();
    } else {
      ctx2.save();
      ctx2.translate(X, Y);
      if (scx !== 1 || scy !== 1) ctx2.scale(scx, scy);
      for (const [cv, dx, dy] of items) ctx2.drawImage(cv, dx, dy);
      ctx2.restore();
    }
    const gs = sil ? 0 : st.glow ?? (c.glow ? 1 : 0);
    if (gs > 0.01 && glows.length) {
      ctx2.save();
      ctx2.translate(X, Y);
      if (scx !== 1 || scy !== 1) ctx2.scale(scx, scy);
      const prevOp = ctx2.globalCompositeOperation, prevA = ctx2.globalAlpha;
      ctx2.globalCompositeOperation = "lighter";
      for (const [cv, dx, dy] of glows) {
        ctx2.globalAlpha = Math.min(1, gs) * 0.12;
        ctx2.drawImage(cv, dx - 1, dy);
        ctx2.drawImage(cv, dx + 1, dy);
        ctx2.drawImage(cv, dx, dy - 1);
        ctx2.drawImage(cv, dx, dy + 1);
        ctx2.globalAlpha = Math.min(1, gs) * 0.45;
        ctx2.drawImage(cv, dx, dy);
      }
      ctx2.globalCompositeOperation = prevOp;
      ctx2.globalAlpha = prevA;
      ctx2.restore();
    }
  }
  function drawChainRig(ctx2, c, st) {
    const s = Math.max(1, Math.round((st.scale ?? 1) * 8)) / 8;
    const t = st.time || 0;
    const sw = st.swimPhase ?? t * 1.2;
    const facing = st.facing ?? 1;
    const pts = st.chain && st.chain.length >= 2 ? st.chain : defaultChainPoints(c, s, sw, st.x, st.y, facing);
    const id = idOf(c);
    const items = [];
    const n = pts.length;
    const X = Math.round(pts[0].x), Y = Math.round(pts[0].y);
    for (let i = n - 1; i >= 1; i--) {
      const a = pts[i], b = pts[i - 1];
      const ra = chainRadius(c, i, n, s), rb = chainRadius(c, i - 1, n, s);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(d / Math.max(1, Math.min(ra, rb) * 0.6)));
      for (let k = 0; k < steps; k++) {
        const u = k / steps;
        const r = ra + (rb - ra) * u;
        const seg = chainSegment(c, r);
        items.push([seg.canvas, Math.round(a.x + (b.x - a.x) * u - seg.o) - X, Math.round(a.y + (b.y - a.y) * u - seg.o) - Y]);
      }
    }
    const dir = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
    const ab = Math.round(dir / ANGLE_STEP);
    const ang = ab * ANGLE_STEP;
    const hkey = `${id}|ch|${ab}|${s}`;
    let head = cacheGet(hkey);
    if (!head) {
      head = timed(() => chainHeadSprite(c, ang, s, 0));
      cachePut(hkey, head);
    }
    items.push([head.canvas, -head.o, -head.o]);
    const fs = faceState({ ...st, x: X, y: Y }, 0, 1, X, Y, { toon: !!c.toon });
    if (st.lookX == null) {
      fs.lx = Math.cos(ang) * 0.5;
      fs.ly = Math.sin(ang) * 0.5;
    } else {
      const dx = st.lookX - X, dy = st.lookY - Y, m = Math.hypot(dx, dy) || 1;
      const ca = Math.cos(-ang), sa = Math.sin(-ang);
      const k = Math.min(1, m / 24) / m;
      fs.lx = (dx * ca - dy * sa) * k;
      fs.ly = (dx * sa + dy * ca) * k;
    }
    if (!st.silhouette) {
      for (const ev of head.face.eyes) {
        const sp = eyeSprite(c, ev, fs, ang);
        items.push([sp.canvas, Math.round(ev.x - head.o - sp.o), Math.round(ev.y - head.o - sp.o)]);
      }
      const mo = head.face.mouth;
      if (mo) {
        const sp = mouthSprite(c, mo, fs);
        items.push([sp.canvas, Math.round(mo.x - head.o - sp.o), Math.round(mo.y - head.o - sp.o)]);
      }
    }
    compose(ctx2, items, [], X, Y, 1, 1, st, c, 0, 0);
    const last = pts[n - 1];
    const nose = [X + head.face.nose[0] - head.o, Y + head.face.nose[1] - head.o];
    return {
      mouth: nose,
      top: [X, Y - c.chain.r * s * 2],
      bottom: [X, Y + c.chain.r * s * 2],
      tail: [last.x, last.y],
      eyes: head.face.eyes.map((e) => ({ x: X + e.x - head.o, y: Y + e.y - head.o, r: e.r, type: e.e.type }))
    };
  }

  // src/gfx/spritecache.js
  var nextId2 = 1;
  var ANGLE_STEP2 = Math.PI / 12;
  var compiledCache = /* @__PURE__ */ new Map();
  function compiled(look, variant = null, key = null) {
    const k = key ? key + "|" + variantKey(variant) : null;
    if (k && compiledCache.has(k)) return compiledCache.get(k);
    const c = compileLook(look, variant);
    c.id = nextId2++;
    if (k) compiledCache.set(k, c);
    return c;
  }
  function variantKey(v) {
    if (!v) return "-";
    return [v.mutation || "", v.shiny ? "s" + (v.shinyHue ?? "") : "", v.pattern || "", v.patternColor || "", v.seed || ""].join(":");
  }

  // src/fish/traits.js
  var MUTATIONS = {
    albino: { name: "Albino", coin: 1.5, weight: 10 },
    melanistic: { name: "Melanistic", coin: 1.5, weight: 10 },
    pastel: { name: "Pastel", coin: 1.4, weight: 10 },
    neon: { name: "Neon", coin: 1.8, weight: 6 },
    golden: { name: "Golden", coin: 2.5, weight: 3 },
    crimson: { name: "Crimson", coin: 1.5, weight: 7 },
    ocean: { name: "Deep Blue", coin: 1.5, weight: 7 },
    ghost: { name: "Ghostly", coin: 2, weight: 4 },
    inverted: { name: "Inverted", coin: 2, weight: 3 },
    galaxy: { name: "Galaxy", coin: 3, weight: 2 }
  };
  var PATTERNS = {
    spots: { name: "Spotted", coin: 1.2 },
    stripes: { name: "Striped", coin: 1.2 },
    bands: { name: "Banded", coin: 1.2 }
  };
  var PERSONALITIES = [
    { id: "bold", name: "Bold", curiosity: 0.25, shyness: -0.3 },
    { id: "shy", name: "Shy", curiosity: -0.1, shyness: 0.35 },
    { id: "greedy", name: "Greedy", greed: 0.35 },
    { id: "lazy", name: "Lazy", energy: -0.35 },
    { id: "hyper", name: "Hyper", energy: 0.4 },
    { id: "nosy", name: "Nosy", curiosity: 0.4 },
    { id: "grumpy", name: "Grumpy", aggression: 0.35, curiosity: -0.15 },
    { id: "dramatic", name: "Dramatic", energy: 0.15, shyness: 0.15 },
    { id: "romantic", name: "Romantic", social: 0.4 },
    { id: "sleepy", name: "Sleepy", energy: -0.25 },
    { id: "chill", name: "Chill" },
    { id: "clever", name: "Clever", shyness: 0.1, curiosity: 0.1 }
  ];
  var NAME_A = ["Bub", "Fin", "Gill", "Sprat", "Nemo", "Puddle", "Wib", "Blorp", "Squish", "Pip", "Mochi", "Noodle", "Kelp", "Brine", "Sushi", "Dory", "Splash", "Pebble", "Glub", "Zappy", "Bloop", "Taco", "Waffles", "Biscuit", "Gus", "Marlo", "Coral", "Wiggles", "Toast", "Bean"];
  var NAME_B = ["", "", "", " Jr.", " III", "y", "ster", "o", " the Great", "ina", "kins", "bert"];
  function randomName() {
    return rng.pick(NAME_A) + rng.pick(NAME_B);
  }
  function rollIndividual(species, mods = {}) {
    const variant = {};
    const mutChance = (mods.mutationChance ?? 0.05) * (species.rarity === "legendary" ? 0.5 : 1);
    if (rng.chance(mutChance)) {
      variant.mutation = rng.weighted(Object.entries(MUTATIONS), ([, m]) => m.weight)[0];
    }
    if (rng.chance(mods.patternChance ?? 0.04)) {
      variant.pattern = rng.pick(Object.keys(PATTERNS));
      variant.seed = rng.int(1, 999);
    }
    if (rng.chance(mods.shinyChance ?? 1 / 220)) {
      variant.shiny = true;
      variant.shinyHue = species.shinyHue ?? 150;
    }
    const [s0, s1] = species.size || [10, 20];
    let t = clamp(rng.gauss(0.45, 0.2) + (mods.sizeBonus || 0), 0, 1);
    if (rng.chance(0.04)) t = Math.min(1, t + 0.35);
    const giant = rng.chance(mods.giantChance ?? 0.015);
    const tiny = !giant && rng.chance(0.015);
    let sizeCm = lerp(s0, s1, t) * (giant ? 1.6 : tiny ? 0.6 : 1);
    const [w0, w1] = species.weight || [0.1, 1];
    const weightKg = lerp(w0, w1, t * t) * (giant ? 4 : tiny ? 0.2 : 1);
    const personality = rng.pick(PERSONALITIES).id;
    return {
      uid: uid(),
      species: species.id,
      sizeCm: Math.round(sizeCm * 10) / 10,
      weightKg: Math.round(weightKg * 100) / 100,
      sizeT: t,
      giant,
      tiny,
      variant: Object.keys(variant).length ? variant : null,
      personality,
      name: randomName()
    };
  }
  function sizeScaleOf(rec, species) {
    const base = species.scale ?? 1;
    let s = 0.88 + (rec.sizeT ?? 0.5) * 0.28;
    if (rec.giant) s *= 1.45;
    if (rec.tiny) s *= 0.65;
    return base * s;
  }
  function traitList(rec) {
    const out = [];
    if (rec.variant?.shiny) out.push({ text: "Shiny", color: "#fff27a" });
    if (rec.variant?.mutation) out.push({ text: MUTATIONS[rec.variant.mutation]?.name || rec.variant.mutation, color: "#ff9ef0" });
    if (rec.variant?.pattern) out.push({ text: PATTERNS[rec.variant.pattern]?.name || rec.variant.pattern, color: "#9ef0ff" });
    if (rec.giant) out.push({ text: "Giant", color: "#ffb36b" });
    if (rec.tiny) out.push({ text: "Tiny", color: "#b6ff9e" });
    const p = PERSONALITIES.find((q) => q.id === rec.personality);
    if (p) out.push({ text: p.name, color: "#d8e6f0" });
    return out;
  }
  function personalityOf(rec) {
    return PERSONALITIES.find((q) => q.id === rec.personality) || PERSONALITIES[10];
  }

  // src/fish/fish.js
  var SPEED = 1.5;
  var EMOTE_TIME = 1.6;
  var Fish = class {
    constructor(rec, species, world, opts = {}) {
      this.rec = rec;
      this.sp = species;
      this.world = world;
      this.id = rec.uid;
      this.c = compiled(species.look, rec.variant, species.id);
      this.scale = sizeScaleOf(rec, species);
      const pers = personalityOf(rec);
      const t = species.traits || {};
      this.curiosity = clamp01((t.curiosity ?? 0.5) + (pers.curiosity || 0));
      this.shyness = clamp01((t.shyness ?? 0.4) + (pers.shyness || 0));
      this.greed = clamp01((t.greed ?? 0.5) + (pers.greed || 0));
      this.aggression = clamp01((t.aggression ?? 0.2) + (pers.aggression || 0));
      this.energy = clamp(1 + (pers.energy || 0), 0.5, 1.5);
      this.social = clamp01(0.4 + (pers.social || 0));
      const m = species.move || {};
      this.style = species.look?.kind === "chain" ? "chain" : m.style || "swim";
      this.cruise = (m.speed ?? 16) * SPEED * this.energy;
      this.burst = (m.burst ?? 70) * SPEED;
      this.agility = m.agility ?? 3;
      this.depth = m.depth || [0.15, 0.85];
      this.school = m.school || 0;
      this.quirks = new Set(species.quirks || []);
      this.x = opts.x ?? 0;
      this.y = opts.y ?? 0;
      this.z = opts.z ?? rng.float(0, 0.8);
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      this.facing = rng.sign();
      this.turn = this.facing;
      this.turning = 0;
      this.angle = 0;
      this.swimPhase = rng.next();
      this.tailPhase = rng.next();
      this.finPhase = rng.next();
      this.squash = 0;
      this.squashV = 0;
      this.bob = 0;
      this.blink = 0;
      this.blinkT = rng.float(1, 4);
      this.mouth = 0;
      this.talkT = 0;
      this.chompT = 0;
      this.emotion = "neutral";
      this.emotionT = 0;
      this.emotionLock = 0;
      this.lookX = null;
      this.lookY = null;
      this.glanceT = rng.float(1, 3);
      this.inflate = 0;
      this.inflateHold = 0;
      this.emote = null;
      this.state = opts.state || "wander";
      this.stateT = 0;
      this.target = null;
      this.wanderT = 0;
      this.alpha = opts.fadeIn ? 0 : 1;
      this.fadeIn = !!opts.fadeIn;
      this.dead = false;
      this.leaving = false;
      this.cooldown = 0;
      this.noticeT = rng.float(0.3, 1.2);
      this.controlled = false;
      this.camo = this.quirks.has("camouflage") ? 1 : 0;
      this.posing = false;
      this.carry = null;
      this.age = 0;
      this.hiddenUntil = 0;
      this.hopT = rng.float(0.5, 2);
      this.speechT = 0;
      if (this.style === "chain") {
        const n = species.look?.chain?.segs ?? 22;
        const spacing = (species.look?.chain?.r ?? 3) * 1.1 * this.scale;
        this.chain = Array.from({ length: n }, (_, i) => ({ x: this.x - i * spacing * this.facing, y: this.y }));
        this.chainSpacing = spacing;
      }
      if (this.style === "crawl") this.z = rng.float(0, 0.3);
    }
    get rarity() {
      return this.sp.rarity;
    }
    setState(s, t = 0) {
      this.state = s;
      this.stateT = t;
      this.target = null;
    }
    // Emotions drive the rig's face; locked emotions persist for a duration.
    feel(emotion, time = 1.5) {
      this.emotion = emotion;
      this.emotionLock = time;
    }
    say(icon, time = EMOTE_TIME) {
      this.emote = { icon, t: 0, max: time };
    }
    talk(time = 0.5) {
      this.talkT = Math.max(this.talkT, time);
    }
    // ------------------------------------------------------------------ helpers
    waterTop() {
      const s = this.world.surfaceY;
      return (s ?? -40) + 10 * this.scale;
    }
    floor(x = this.x) {
      return this.world.floorAt(x, this.z) - 6 * this.scale * (1 - this.z * 0.5);
    }
    bandY(t) {
      const top = this.waterTop(), bot = this.floor();
      return lerp(top, bot, t);
    }
    pickWanderTarget() {
      const w = this.world;
      const [d0, d1] = this.depth;
      const margin = 20;
      let tx = clamp(this.x + rng.float(-260, 260), margin, w.W - margin);
      if (rng.chance(0.15)) tx = rng.float(margin, w.W - margin);
      const ty = this.bandY(rng.float(d0, d1));
      this.target = { x: tx, y: ty, z: clamp01(this.z + rng.float(-0.4, 0.4)) };
      this.wanderT = rng.float(2, 6) / this.energy;
    }
    steer(tx, ty, speed, arrive = 30) {
      const dx = tx - this.x, dy = ty - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = d < arrive ? speed * (d / arrive) : speed;
      return [dx / d * sp, dy / d * sp];
    }
    // ------------------------------------------------------------------ update
    update(dt) {
      const w = this.world;
      this.age += dt;
      this.stateT += dt;
      if (this.fadeIn) {
        this.alpha = Math.min(1, this.alpha + dt * 1.5);
        if (this.alpha >= 1) this.fadeIn = false;
      }
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.emotionLock = Math.max(0, this.emotionLock - dt);
      if (this.emote) {
        this.emote.t += dt;
        if (this.emote.t > this.emote.max) this.emote = null;
      }
      let desired = [0, 0];
      let dz = 0;
      if (!this.controlled) {
        desired = this.think(dt);
        if (this.target && this.target.z !== void 0) dz = (this.target.z - this.z) * 0.6;
      }
      if (this.controlled) {
      } else if (this.style === "crawl") {
        this.updateCrawl(dt, desired);
      } else if (this.style === "hop") {
        this.updateHop(dt, desired);
      } else {
        const acc = this.agility * (this.state === "flee" ? 2.2 : 1);
        this.vx = damp(this.vx, desired[0], acc, dt);
        this.vy = damp(this.vy, desired[1], acc, dt);
        if (this.style === "drift" || this.quirks.has("pulse")) {
          const pulse = Math.max(0, Math.sin(this.swimPhase * TAU));
          this.vy += -pulse * 14 * dt;
          this.vy += 4 * dt;
        }
        if (this.inflate > 0.3) {
          this.vx *= 0.96;
          this.vy = damp(this.vy, -6, 2, dt);
        }
        const persp = 1 - this.z * 0.45;
        this.x += this.vx * dt * persp;
        this.y += this.vy * dt * persp;
        this.vz = damp(this.vz, dz, 1.5, dt);
        this.z = clamp01(this.z + this.vz * dt);
        this.confine(dt);
      }
      if (this.style === "chain") this.updateChain(dt);
      this.animate(dt);
    }
    confine(dt) {
      const w = this.world;
      const top = this.waterTop();
      const bot = this.floor();
      if (this.state !== "leave" && this.state !== "enter") {
        if (this.x < 10) this.vx += (10 - this.x) * 4 * dt;
        if (this.x > w.W - 10) this.vx -= (this.x - (w.W - 10)) * 4 * dt;
      }
      if (this.y < top) {
        this.y = damp(this.y, top, 6, dt);
        this.vy = Math.max(this.vy, 0);
      }
      if (this.y > bot) {
        this.y = damp(this.y, bot, 6, dt);
        this.vy = Math.min(this.vy, 0);
      }
    }
    updateCrawl(dt, desired) {
      const groundY = this.perch ? this.perch.y - 4 * this.scale : this.world.floorAt(this.x, this.z) - 5 * this.scale * (1 - this.z * 0.5);
      this.vx = damp(this.vx, desired[0], 4, dt);
      this.x += this.vx * dt;
      if (this.perch && (this.x < this.perch.x || this.x > this.perch.x + this.perch.w)) this.perch = null;
      this.vy = 0;
      this.y = damp(this.y, groundY, 10, dt);
      this.x = clamp(this.x, -30, this.world.W + 30);
    }
    updateHop(dt, desired) {
      const ground = this.world.floorAt(this.x, this.z) - 5 * this.scale * (1 - this.z * 0.5);
      this.hopT -= dt;
      const onGround = this.y >= ground - 0.5;
      if (onGround) {
        this.vx = damp(this.vx, 0, 6, dt);
        if (this.hopT <= 0 && Math.abs(desired[0]) + Math.abs(desired[1]) > 3) {
          this.vx = Math.sign(desired[0] || this.facing) * rng.float(30, 60) * SPEED;
          this.vy = -rng.float(40, 80) * SPEED;
          this.hopT = rng.float(0.6, 2.2) / this.energy;
          this.squashV -= 6;
        }
      }
      this.vy += 140 * dt;
      this.vy *= Math.exp(-1.2 * dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.y > ground) {
        if (this.vy > 30) this.squashV += this.vy * 0.05;
        this.y = ground;
        this.vy = 0;
      }
      if (this.y < this.waterTop()) {
        this.y = this.waterTop();
        this.vy = Math.abs(this.vy) * 0.3;
      }
    }
    updateChain(dt) {
      const ch = this.chain;
      ch[0].x = this.x;
      ch[0].y = this.y;
      const sp = this.chainSpacing;
      for (let i = 1; i < ch.length; i++) {
        const a = ch[i - 1], b = ch[i];
        b.y += Math.sin(this.swimPhase * TAU - i * 0.5) * 0.25;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > sp) {
          b.x = a.x + dx / d * sp;
          b.y = a.y + dy / d * sp;
        }
      }
    }
    animate(dt) {
      const speed = Math.hypot(this.vx, this.vy);
      const s01 = clamp01(speed / Math.max(10, this.cruise * 1.8));
      this.speed01 = s01;
      const base = this.style === "crawl" ? 0.6 + s01 * 3 : 0.45 + s01 * 1.6;
      this.swimPhase = (this.swimPhase + dt * base * (this.inflate > 0.3 ? 0.4 : 1)) % 1;
      this.tailPhase = (this.tailPhase + dt * (0.6 + s01 * 3.2)) % 1;
      this.finPhase = (this.finPhase + dt * (1.4 - s01 * 0.6 + (this.state === "sniff" ? 1.2 : 0))) % 1;
      if (!this.controlled || this.allowTurn) {
        const vx = this.vx;
        if (Math.abs(vx) > 4 && Math.sign(vx) !== this.facing) this.facing = Math.sign(vx);
      }
      this.turn = damp(this.turn, this.facing, 14, dt);
      if (Math.abs(this.turn) < 0.15) this.turn = this.facing * 0.15;
      let targetA = 0;
      if (this.style !== "crawl" && this.style !== "hop" && this.c.kind !== "jelly" && this.c.kind !== "pudding" && this.c.kind !== "seahorse") {
        targetA = clamp(Math.atan2(this.vy, Math.abs(this.vx) + 6), -0.7, 0.7);
      }
      if (this.forceAngle !== void 0) targetA = this.forceAngle;
      this.angle = damp(this.angle, targetA, 5, dt);
      this.squashV += (-this.squash * 90 - this.squashV * 9) * dt;
      this.squash = clamp(this.squash + this.squashV * dt, -0.5, 0.5);
      this.bob = Math.sin(this.age * 2.1 + this.swimPhase) * (1 - s01) * 0.8;
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blink = 1;
        this.blinkT = rng.float(1.8, 5.5);
        if (rng.chance(0.15)) this.blinkT = 0.18;
      }
      this.blink = Math.max(0, this.blink - dt * 8);
      this.talkT = Math.max(0, this.talkT - dt);
      this.chompT = Math.max(0, this.chompT - dt);
      let mouth = 0.05 + 0.08 * Math.max(0, Math.sin(this.age * 2.3));
      if (this.talkT > 0) mouth = 0.25 + 0.6 * Math.abs(Math.sin(this.age * 18));
      if (this.chompT > 0) mouth = Math.abs(Math.sin(this.age * 14));
      this.mouth = damp(this.mouth, mouth, 20, dt);
      if (this.inflateHold > 0) this.inflateHold -= dt;
      else this.inflate = Math.max(0, this.inflate - dt * 0.35);
      this.glanceT -= dt;
      if (this.glanceT <= 0) {
        this.glanceT = rng.float(1.2, 4);
        this.glance = rng.chance(0.4) ? { x: this.x + rng.float(-80, 80), y: this.y + rng.float(-40, 40), t: rng.float(0.5, 1.4) } : null;
      }
      if (this.glance) {
        this.glance.t -= dt;
        if (this.glance.t <= 0) this.glance = null;
      }
      if (this.quirks.has("camouflage")) {
        const c = this.world.cursor;
        const near = c && dist(c.x, c.y, this.x, this.y) < 60;
        this.camo = damp(this.camo, near || this.state === "flee" || this.controlled ? 0 : 1, 2, dt);
      }
      if (!this.emotionLock) this.emotion = this.baseEmotion();
    }
    baseEmotion() {
      switch (this.state) {
        case "flee":
        case "hide":
          return "scared";
        case "sleep":
          return "sleepy";
        case "curious":
          return this.quirks.has("googly") ? "surprised" : "happy";
        case "sniff":
          return "neutral";
        case "eat":
          return "happy";
        case "play":
          return "happy";
        default:
          return this.inflate > 0.4 ? "angry" : "neutral";
      }
    }
    // ------------------------------------------------------------------ brain
    // Returns desired velocity [vx, vy].
    think(dt) {
      const w = this.world;
      const cur = w.cursor;
      if (cur && cur.inWorld && this.state !== "flee" && this.state !== "leave") {
        const d = dist(cur.x, cur.y, this.x, this.y);
        const scare = (cur.speed - 260 * (w.calmMul || 1)) / 400;
        if (d < 70 + this.scale * 10 && scare > 0 && this.z < 0.5 && rng.chance(clamp01(scare * (0.4 + this.shyness)) * dt * 12)) {
          this.startle(cur.x, cur.y);
        }
      }
      switch (this.state) {
        case "enter":
          return this.thinkEnter(dt);
        case "wander":
          return this.thinkWander(dt);
        case "idle":
          return this.thinkIdle(dt);
        case "curious":
          return this.thinkCurious(dt);
        case "interest":
          return this.thinkInterest(dt);
        case "sniff":
          return this.thinkSniff(dt);
        case "flee":
          return this.thinkFlee(dt);
        case "hide":
          return this.thinkHide(dt);
        case "leave":
          return this.thinkLeave(dt);
        case "mimic":
          return this.thinkMimic(dt);
        case "commute":
          return this.thinkCommute(dt);
        case "steal":
          return this.thinkSteal(dt);
        case "script":
          return this.script ? this.script(this, dt) : [0, 0];
        case "eat":
          return this.thinkEat(dt);
        case "sleep":
          return this.thinkSleep(dt);
        case "play":
          return this.thinkPlay(dt);
        case "decor":
          return this.thinkDecor(dt);
        case "court":
          return this.thinkCourt(dt);
        default:
          if (this.extraThink) return this.extraThink(dt);
          return this.thinkWander(dt);
      }
    }
    startle(fromX, fromY) {
      if (this.controlled) return;
      this.setState("flee");
      this.fleeFrom = { x: fromX, y: fromY };
      this.feel("scared", 1.5);
      if (this.quirks.has("inflate")) {
        this.inflate = 1;
        this.inflateHold = 2.5;
        this.world.audio?.play("puff", { pitch: 1 / this.scale });
        this.squashV += 8;
      }
      if (this.quirks.has("honk")) this.world.audio?.play("honk", { pitch: rng.float(0.9, 1.1) });
      if (this.quirks.has("ink")) this.world.particles?.burst(this.x, this.y, 18, { colors: ["#1a1024", "#2a1838", "#120a18"], speed: 30, g: -4, drag: 3, life: 2.5, size: 3, layer: "fg" });
      if (rng.chance(0.5)) this.say("!");
      this.cooldown = 4;
    }
    thinkEnter(dt) {
      const tx = this.enterTarget?.x ?? this.world.W / 2;
      const ty = this.enterTarget?.y ?? this.y;
      if (Math.abs(this.x - tx) < 40 || this.stateT > 6) this.setState("wander");
      return this.steer(tx, ty, this.cruise);
    }
    // ---------------------------------------------------------------- aquarium behaviours
    // The tank world provides: food [{x,y,eaten}], decorSpots [{x,y,kind}], night, onEat(fish, food), onCourt(a, b)
    thinkTankIdle(dt) {
      const w = this.world;
      const rec = this.rec;
      if (w.night && this.sp.activity !== "night" && rng.chance(dt * 0.4)) {
        this.setState("sleep");
        return true;
      }
      if (w.food?.length && (rec.hunger ?? 0.5) > 0.15 && rng.chance(dt * (1 + this.greed * 3))) {
        this.setState("eat");
        return true;
      }
      if (rng.chance(dt * 0.05 * this.energy)) {
        const others = w.fishes.filter((o) => o !== this && !o.controlled);
        if (others.length) {
          this.playmate = rng.pick(others);
          this.setState("play");
          return true;
        }
      }
      if (w.decorSpots?.length && rng.chance(dt * 0.04)) {
        this.decorSpot = rng.pick(w.decorSpots);
        this.setState("decor");
        return true;
      }
      if (w.canCourt?.(this) && rng.chance(dt * 0.02 * this.social)) {
        const mate = w.fishes.find((o) => o !== this && o.sp === this.sp && w.canCourt(o) && o.state !== "court");
        if (mate) {
          this.mate = mate;
          mate.mate = this;
          this.setState("court");
          mate.setState("court");
          return true;
        }
      }
      return false;
    }
    thinkEat(dt) {
      const food = this.world.food || [];
      let best = null, bd = Infinity;
      for (const f of food) {
        if (f.eaten) continue;
        const d = dist(f.x, f.y, this.x, this.y);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      if (!best || this.stateT > 8) {
        this.setState("wander");
        return [0, 0];
      }
      this.lookAt(best.x, best.y);
      if (bd < 6 + 4 * this.scale) {
        best.eaten = true;
        this.chompT = 0.35;
        this.feel("happy", 1.2);
        this.squashV += 5;
        this.world.onEat?.(this, best);
        this.world.audio?.play("gulp", { vol: 0.5, pitch: 1.4 / Math.max(0.6, this.scale) });
        if ((this.rec.hunger ?? 0) <= 0.05 || rng.chance(0.3)) {
          this.setState("wander");
          this.say("heart", 1);
        }
        return [0, 0];
      }
      return this.steer(best.x, best.y, this.burst * 0.6, 8);
    }
    thinkSleep(dt) {
      const w = this.world;
      if (!w.night || this.stateT > 60) {
        this.setState("wander");
        this.feel("tired", 2);
        return [0, 0];
      }
      if (!this.bed) this.bed = { x: clamp(this.x + rng.float(-40, 40), 30, w.W - 30), y: this.floor() - 4 };
      if (rng.chance(dt * 0.5)) this.say("zzz", 1.5);
      this.feel("sleepy", 0.5);
      return this.steer(this.bed.x, this.bed.y, this.cruise * 0.4, 30);
    }
    thinkPlay(dt) {
      const m = this.playmate;
      if (!m || !this.world.fishes.includes(m) || this.stateT > 5) {
        this.setState("wander");
        return [0, 0];
      }
      this.lookAt(m.x, m.y);
      this.feel("happy", 0.3);
      if (rng.chance(dt * 0.8)) this.say(rng.pick(["music", "heart", "!"]), 0.8);
      if (dist(this.x, this.y, m.x, m.y) < 10 && m.state !== "play") {
        m.playmate = this;
        m.setState("play");
        m.vx += this.vx;
        this.setState("wander");
        return [0, 0];
      }
      return this.steer(m.x, m.y, this.burst * 0.55, 4);
    }
    thinkDecor(dt) {
      const s = this.decorSpot;
      if (!s || this.stateT > 7) {
        this.setState("wander");
        return [0, 0];
      }
      const d = dist(this.x, this.y, s.x, s.y);
      if (d < 6) {
        this.hideInDecor = s.kind === "hide" && this.stateT < 4;
        if (rng.chance(dt * 0.5)) this.say(rng.pick(["heart", "music", "..."]), 1);
        return [Math.sin(this.age * 2) * 3, Math.cos(this.age * 1.6) * 2];
      }
      this.hideInDecor = false;
      return this.steer(s.x, s.y, this.cruise, 20);
    }
    thinkCourt(dt) {
      const m = this.mate;
      if (!m || !this.world.fishes.includes(m) || this.stateT > 9) {
        this.mate = null;
        this.setState("wander");
        return [0, 0];
      }
      this.feel("love", 0.5);
      if (rng.chance(dt * 1.2)) this.say("heart", 1);
      const mx = (this.x + m.x) / 2, my = (this.y + m.y) / 2;
      const ang = this.age * 1.6 + (this.id < m.id ? 0 : Math.PI);
      const tx = mx + Math.cos(ang) * 16, ty = my + Math.sin(ang) * 10;
      if (this.stateT > 6 && this.id < m.id) {
        this.world.onCourt?.(this, m);
        this.stateT = 99;
      }
      return this.steer(tx, ty, this.cruise * 1.2, 10);
    }
    thinkWander(dt) {
      const w = this.world;
      if (w.isTank && this.thinkTankIdle(dt)) return [0, 0];
      this.wanderT -= dt;
      if (!this.target || this.wanderT <= 0 || dist(this.x, this.y, this.target.x, this.target.y) < 12) {
        if (rng.chance(0.25)) {
          this.setState("idle");
          this.idleT = rng.float(1, 3.5);
          return [0, 0];
        }
        this.pickWanderTarget();
      }
      if (this.quirks.has("commuter") && !w.isTank && this.stateT > 2 && rng.chance(dt * 0.12)) {
        this.setState("commute");
        return [0, 0];
      }
      if (this.quirks.has("mimic") && w.desktop && this.stateT > 3 && rng.chance(dt * 0.15)) {
        this.setState("mimic");
        return [0, 0];
      }
      if (this.quirks.has("thief") && w.desktop && this.stateT > 4 && rng.chance(dt * 0.06)) {
        this.setState("steal");
        return [0, 0];
      }
      if (this.quirks.has("forgetful") && rng.chance(dt * 0.15)) {
        this.say("?");
        this.feel("surprised", 1);
        this.facing *= -1;
        this.vx = -this.vx;
        this.pickWanderTarget();
      }
      if ((this.quirks.has("googly") || this.curiosity > 0.75) && this.wantsCursor()) {
        this.setState("curious");
        return [0, 0];
      }
      const bait = !w.isTank && this.noticeBait(dt);
      if (bait) return [0, 0];
      let [vx, vy] = this.steer(this.target.x, this.target.y, this.cruise, 40);
      const [sx, sy] = this.flock();
      return [vx + sx, vy + sy];
    }
    thinkIdle(dt) {
      this.idleT -= dt;
      if (this.idleT <= 0) this.setState("wander");
      if (this.noticeBait(dt)) return [0, 0];
      if (this.wantsCursor()) {
        this.setState("curious");
        return [0, 0];
      }
      return [Math.sin(this.age) * 2, Math.cos(this.age * 0.7) * 2];
    }
    wantsCursor() {
      const c = this.world.cursor;
      if (!c || !c.inWorld || c.speed > 120 || this.cooldown > 0 || this.z > 0.5) return false;
      const d = dist(c.x, c.y, this.x, this.y);
      return d < 90 && rng.chance(this.curiosity * 0.02);
    }
    thinkCurious(dt) {
      const c = this.world.cursor;
      this.lookAt(c.x, c.y);
      if (this.stateT > rng.float(2.5, 6) || c.speed > 200 || !c.inWorld) {
        this.setState("wander");
        this.cooldown = 3;
        return [0, 0];
      }
      const keep = 26 + 10 * this.scale;
      const d = dist(c.x, c.y, this.x, this.y);
      const ang = Math.atan2(this.y - c.y, this.x - c.x) + dt * 0.4;
      const tx = c.x + Math.cos(ang) * keep, ty = c.y + Math.sin(ang) * keep * 0.6;
      if (d < keep * 0.7) return this.steer(this.x + (this.x - c.x), this.y + (this.y - c.y), this.cruise);
      this.target = { x: tx, y: ty, z: 0 };
      if (rng.chance(dt * 0.4)) {
        this.talk(0.4);
        this.say(rng.pick(["?", "heart", "!", "music"]));
      }
      return this.steer(tx, ty, this.cruise * 0.8, 20);
    }
    // Bait noticing: returns true if the fish switched to 'interest'.
    noticeBait(dt) {
      const w = this.world;
      const h = w.hook;
      if (!h || !h.active || !h.inWater || !h.bait || this.cooldown > 0 || this.inflate > 0.3 || this.posing) return false;
      this.noticeT -= dt;
      if (this.noticeT > 0) return false;
      this.noticeT = rng.float(0.4, 1.1);
      const interest = baitInterest(this.sp, h.bait);
      if (interest <= 0.05) return false;
      const radius = (90 + interest * 70) * (h.radiusMul || 1) * (1 + (w.jig || 0) * 0.6) * (this.quirks.has("intro") ? 4 : 1);
      const d = dist(h.x, h.y, this.x, this.y);
      if (d > radius) return false;
      const p = interest * (0.35 + this.curiosity * 0.5 + this.greed * 0.4) * (1 - this.shyness * 0.4 * clamp01(w.cursor.speed / 150));
      if (!rng.chance(clamp01(p))) return false;
      this.setState("interest");
      this.interest = interest;
      this.say(interest > 1.5 ? "heart" : "?", 1);
      return true;
    }
    thinkInterest(dt) {
      const h = this.world.hook;
      if (!h.active || !h.inWater || !h.bait) {
        this.setState("wander");
        return [0, 0];
      }
      this.lookAt(h.x, h.y);
      const side = this.x < h.x ? -1 : 1;
      const mouthOff = 10 * this.scale + 6;
      const tx = h.x + side * mouthOff, ty = h.y + 2;
      this.target = { x: tx, y: ty, z: 0 };
      if (this.world.cursor.speed > 300) {
        this.startle(h.x, h.y);
        return [0, 0];
      }
      const d = dist(this.x, this.y, tx, ty);
      if (d < 6 && this.z < 0.15) {
        this.setState("sniff");
        this.sniffT = rng.float(1, 2.6) / (0.5 + this.greed);
        this.facing = -side;
        return [0, 0];
      }
      if (this.stateT > 14) {
        this.setState("wander");
        this.cooldown = 5;
      }
      const near = this.cruise * (0.6 + this.greed * 0.6);
      const far = Math.max(near, this.burst * (0.45 + this.greed * 0.25), 80) * (this.quirks.has("intro") ? 1.8 : 1);
      return this.steer(tx, ty, lerp(near, far, clamp01((d - 50) / 220)), 25);
    }
    thinkSniff(dt) {
      const h = this.world.hook;
      if (!h.active || !h.inWater || !h.bait) {
        this.setState("wander");
        return [0, 0];
      }
      this.lookAt(h.x, h.y);
      this.facing = h.x > this.x ? 1 : -1;
      this.sniffT -= dt;
      const side = this.x < h.x ? -1 : 1;
      const tx = h.x + side * (10 * this.scale + 5 + Math.sin(this.stateT * 6) * 2), ty = h.y + 2;
      if (this.sniffT <= 0) {
        const p = clamp01(this.interest * 0.4 + this.greed * 0.4 + 0.15);
        if (rng.chance(p) && this.world.requestNibble?.(this)) return [0, 0];
        this.say("cross");
        this.feel("disgust", 1.2);
        this.world.audio?.play("blub", { pitch: 0.8 });
        this.cooldown = rng.float(8, 18);
        this.setState("wander");
        this.pickWanderTarget();
        return [0, 0];
      }
      if (this.world.cursor.speed > 220) {
        this.startle(h.x, h.y);
        return [0, 0];
      }
      return this.steer(tx, ty, this.cruise * 0.6, 10);
    }
    thinkFlee(dt) {
      const f = this.fleeFrom || { x: this.x - this.facing, y: this.y };
      let dx = this.x - f.x, dy = this.y - f.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      if (this.stateT > 1.4 + this.shyness) {
        if (this.world.windows?.length && rng.chance(0.5) && !this.world.isTank) this.goHide();
        else this.setState("wander");
        return [0, 0];
      }
      this.z = Math.min(1, this.z + dt * 0.25 * this.shyness);
      return [dx * this.burst, dy * this.burst * 0.6];
    }
    goHide() {
      const wins = this.world.windows;
      let best = null, bd = Infinity;
      for (const r of wins) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const d = dist(cx, cy, this.x, this.y);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      if (!best || bd > 400) {
        this.setState("wander");
        return;
      }
      this.setState("hide");
      this.hideRect = best;
      this.hideT = rng.float(3, 7);
    }
    thinkHide(dt) {
      const r = this.hideRect;
      this.hideT -= dt;
      if (!r || this.hideT <= 0) {
        this.setState("wander");
        this.say("...");
        return [0, 0];
      }
      const peek = this.hideT < 1.6;
      const tx = peek ? this.x < r.x + r.w / 2 ? r.x + 4 : r.x + r.w - 4 : r.x + r.w / 2;
      const ty = clamp(this.y, r.y + 8, r.y + r.h - 8);
      if (peek) this.lookAt(this.world.cursor.x, this.world.cursor.y);
      return this.steer(tx, ty, this.cruise * 1.2, 20);
    }
    thinkLeave(dt) {
      const tx = this.x < this.world.W / 2 ? -80 : this.world.W + 80;
      if (this.x < -60 || this.x > this.world.W + 60) this.dead = true;
      this.z = Math.min(1, this.z + dt * 0.05);
      return this.steer(tx, this.y, this.cruise * 1.3, 1);
    }
    thinkCommute(dt) {
      const w = this.world;
      const hour = w.hour ?? 12;
      if (this.stateT > 12) {
        this.setState("wander");
        return [0, 0];
      }
      if (hour >= 12 && hour < 13) {
        if (this.stateT < 0.1) {
          this.say("food");
          this.talk(0.6);
        }
        this.chompT = 0.2;
        return [Math.sin(this.age * 2) * 4, 0];
      }
      const workHours = hour >= 9 && hour < 17;
      const win = workHours ? w.windows?.[0] : null;
      const tx = win ? win.x + win.w + 8 : w.W - 40;
      const ty = win ? win.y + 20 : this.bandY(0.85);
      if (!this.saidCommute) {
        this.saidCommute = true;
        this.say(workHours ? "clock" : "moon");
        this.feel(workHours ? "determined" : "tired", 2);
      }
      if (dist(this.x, this.y, tx, ty) < 10) {
        if (rng.chance(dt * 2)) w.particles?.text(this.x, this.y - 12 * this.scale, rng.pick(["tap", "clack", "...", "email?", "meeting!"]), { font: "small", color: "#d8f4ff", life: 1, vy: -10 });
        this.facing = -1;
        return [0, 0];
      }
      return this.steer(tx, ty, this.burst * 0.7, 20);
    }
    thinkMimic(dt) {
      const d = this.world.desktop;
      if (!this.mimicSlot) {
        this.mimicSlot = d?.freeSlot?.();
        if (!this.mimicSlot) {
          this.setState("wander");
          return [0, 0];
        }
      }
      const s = this.mimicSlot;
      const at = dist(this.x, this.y, s.x, s.y) < 3;
      if (at) {
        this.posing = true;
        this.z = 0;
        this.facing = 1;
        const c = this.world.cursor;
        const near = c.inWorld && dist(c.x, c.y, this.x, this.y) < 70;
        if (!near && rng.chance(dt * 0.3)) this.wiggle = 0.4;
        if (this.stateT > 40 && !near) {
          this.posing = false;
          this.mimicSlot = null;
          this.setState("wander");
        }
        return [0, 0];
      }
      this.posing = false;
      return this.steer(s.x, s.y, this.cruise * 1.2, 30);
    }
    unmask() {
      this.posing = false;
      this.mimicSlot = null;
      this.feel("surprised", 1.5);
      this.say("!");
      this.squashV += 10;
      this.world.audio?.play("squeak");
      this.setState("flee");
      this.fleeFrom = { x: this.x - 10, y: this.y };
      this.cooldown = 1;
    }
    thinkSteal(dt) {
      const d = this.world.desktop;
      if (!this.carry) {
        if (!this.stealTarget) {
          this.stealTarget = d?.randomStealable?.();
          if (!this.stealTarget) {
            this.setState("wander");
            return [0, 0];
          }
          this.feel("smug", 3);
        }
        const ic = this.stealTarget;
        const tx = ic.x + ic.w / 2, ty = ic.y + ic.h / 2;
        if (dist(this.x, this.y, tx, ty) < 8) {
          if (d.stealIcon(ic, this)) {
            this.carry = ic;
            this.say("$");
            this.world.audio?.play("squeak", { pitch: 1.3 });
          }
          this.stealTarget = null;
          this.setState("leave");
          return [0, 0];
        }
        if (this.stateT > 12) {
          this.stealTarget = null;
          this.setState("wander");
        }
        return this.steer(tx, ty, this.cruise * 1.1, 20);
      }
      return [0, 0];
    }
    lookAt(x, y) {
      this.lookX = x;
      this.lookY = y;
      this.lookHold = 0.3;
    }
    flock() {
      let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0;
      for (const o of this.world.fishes) {
        if (o === this || o.controlled) continue;
        const dx = this.x - o.x, dy = this.y - o.y;
        const d2 = dx * dx + dy * dy;
        const minD = 14 * (this.scale + o.scale);
        if (d2 < minD * minD && Math.abs(this.z - o.z) < 0.25) {
          const d = Math.sqrt(d2) || 1;
          sx += dx / d * (minD - d) * 2;
          sy += dy / d * (minD - d) * 2;
        }
        if (this.school > 0 && o.sp === this.sp && d2 < 120 * 120) {
          ax += o.vx;
          ay += o.vy;
          cx += o.x;
          cy += o.y;
          n++;
        }
      }
      if (n) {
        const k = this.school;
        sx += (ax / n - this.vx) * 0.5 * k + (cx / n - this.x) * 0.4 * k;
        sy += (ay / n - this.vy) * 0.5 * k + (cy / n - this.y) * 0.4 * k;
      }
      return [sx, sy];
    }
    // ------------------------------------------------------------------ drawing
    rigState(extra = {}) {
      const c = this.world.cursor;
      let lx = null, ly = null;
      if (this.lookHold > 0 || this.lookX !== null) {
        lx = this.lookX;
        ly = this.lookY;
      }
      this.lookHold = Math.max(0, (this.lookHold || 0) - 1 / 60);
      if (this.lookHold <= 0) {
        this.lookX = null;
        this.lookY = null;
      }
      if (lx === null && this.glance) {
        lx = this.glance.x;
        ly = this.glance.y;
      }
      if ((this.quirks.has("googly") || this.quirks.has("manyeyes") || this.quirks.has("intro")) && c?.inWorld && lx === null) {
        lx = c.x;
        ly = c.y;
      }
      const sc = this.scale * (1 - this.z * 0.5);
      return {
        x: this.x,
        y: this.y + this.bob,
        facing: this.facing,
        turn: this.turn,
        angle: this.angle,
        scale: sc,
        squash: this.squash + (this.wiggle || 0) * Math.sin(this.age * 30) * 0.3,
        swimPhase: this.swimPhase,
        tailPhase: this.tailPhase,
        finPhase: this.finPhase,
        speed01: this.speed01 || 0,
        inflate: this.inflate,
        lookX: lx,
        lookY: ly,
        blink: this.posing ? 0 : this.blink,
        emotion: this.emotion,
        mouth: this.mouth,
        time: this.age,
        chain: this.chain,
        pose: this.posing,
        ...extra
      };
    }
    draw(ctx2, wash, time) {
      if (this.alpha <= 0) return null;
      if (this.wiggle) this.wiggle = Math.max(0, this.wiggle - 0.02);
      const st = this.rigState({ wash, glow: this.world.glowLevel ?? 0, time });
      let alpha = this.alpha;
      if (this.camo > 0.05) alpha *= 1 - this.camo * 0.8;
      if (this.rec.variant?.mutation === "ghost") alpha *= 0.65;
      if (alpha < 1) ctx2.globalAlpha = alpha;
      const anchors = drawFishRig(ctx2, this.c, st);
      ctx2.globalAlpha = 1;
      this.anchors = anchors;
      return anchors;
    }
  };
  function baitInterest(sp, bait) {
    if (!bait) return 0;
    const prefs = sp.bait || {};
    let v = prefs[bait.type];
    if (v === void 0) v = bait.kind === "special" ? 0.6 : 0.25;
    if (bait.type === "golden") v = Math.max(v, { common: 0.4, uncommon: 0.8, rare: 1.6, epic: 2.2, legendary: 2.6 }[sp.rarity] || 1);
    if (bait.type === "blackhole") v = Math.max(v, 1.4);
    if (bait.type === "bread") v = Math.max(v, sp.rarity === "common" ? 1.6 : sp.rarity === "uncommon" ? 0.7 : 0.2);
    if (bait.type === "worm") v = Math.max(v, 1.1);
    if (sp.spawn?.requires && sp.spawn.requires !== bait.type) v *= 0.15;
    if (sp.quirks?.includes("intro")) v = Math.max(v, 3);
    return v;
  }

  // src/fish/species.js
  var S2 = [];
  var add = (o) => S2.push(o);
  add({
    id: "pixel",
    name: "Pixel",
    biome: "shallows",
    rarity: "common",
    size: [2, 4],
    weight: [5e-3, 0.02],
    look: {
      toon: true,
      body: { len: 18, h: 14, shape: "box", hump: 0.06, tip: 0.45 },
      col: { body: "#5ee8d0", belly: "#d8fff4", back: "#2fa8c0", fin: "#a6f4ff" },
      shade: { back: -0.4, belly: 0.35 },
      pattern: [{ type: "checker", size: 3, umin: 0.5, vmax: 0.2, tone: 1 }],
      tail: { type: "truncate", len: 6, spread: 6 },
      dorsal: { type: "round", from: 0.45, to: 0.75, h: 4 },
      anal: null,
      pectoral: { len: 5 },
      eye: { u: 0.3, v: -0.12, r: 4.4, iris: "#3a7aff", pupilSize: 0.5 },
      mouth: { type: "small", v: 0.55, w: 3 },
      scales: false,
      gills: false,
      nostril: false
    },
    scale: 1,
    move: { style: "swim", speed: 14, burst: 50, agility: 5, depth: [0.15, 0.55], school: 0 },
    activity: "any",
    traits: { curiosity: 1, shyness: 0.05, greed: 0.6, aggression: 0 },
    bait: { bread: 3, folder: 2, computer: 2, worm: 2, image: 2, docs: 1 },
    quirks: ["intro"],
    fight: { phases: ["tension"], power: 0.08, stamina: 2, tricks: [], biteWindow: 1.4, nibbles: [0, 1], fakeBite: 0 },
    spawn: { weight: 1.2, weather: null, time: null, requires: null, hidden: null },
    sound: "chirp",
    desc: `A single square pixel that escaped a screenshot and decided to become a fish. It has one eye and approximately one thought, and the thought is "what's that?".`,
    behavior: "Swims right up to anything new and stares at it. Bites almost anything.",
    shinyHue: 200
  });
  add({
    id: "loafer",
    name: "Loafer Minnow",
    biome: "shallows",
    rarity: "common",
    size: [6, 11],
    weight: [0.04, 0.15],
    look: {
      body: { len: 24, h: 13, shape: "box", hump: 0.12, belly: -0.12, nose: 3, tip: 0.35 },
      col: { body: "#e8b468", belly: "#fff0d4", back: "#9a5626", fin: "#f4d098" },
      shade: { back: -0.25, belly: 0.3 },
      pattern: [{ type: "lines", count: 4, width: 0.1, vmax: -0.45, umin: 0.25, umax: 0.86, tone: 1.6 }],
      tail: { type: "round", len: 8, spread: 7 },
      dorsal: { type: "round", from: 0.42, to: 0.62, h: 3 },
      anal: { type: "tri", from: 0.62, to: 0.8, h: 3 },
      pelvic: { from: 0.4, to: 0.5, h: 3 },
      eye: { r: 2.6, u: 0.15, iris: "#c88a3a" },
      mouth: { type: "small", v: 0.3 },
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 12, burst: 45, agility: 2, depth: [0.05, 0.4], school: 4 },
    activity: "day",
    traits: { curiosity: 0.5, shyness: 0.3, greed: 0.95, aggression: 0.05 },
    bait: { bread: 3, sugar: 2, docs: 1, folder: 1 },
    quirks: ["school"],
    fight: { phases: ["tension"], power: 0.15, stamina: 2.5, tricks: ["dash"], biteWindow: 1.1, nibbles: [1, 2], fakeBite: 0.05 },
    spawn: { weight: 1.4, weather: null, time: null, requires: null, hidden: null },
    sound: "blub",
    desc: "Ate so much bread it slowly turned into a small loaf. Smells faintly of a bakery and regret.",
    behavior: "Travels in crusty little schools. Cannot resist bread, even though bread is the problem.",
    shinyHue: 300
  });
  add({
    id: "honk",
    name: "Honk Clownfish",
    biome: "shallows",
    rarity: "common",
    size: [7, 12],
    weight: [0.08, 0.25],
    look: {
      body: { len: 40, h: 22, shape: "oval", nose: 2.2, tip: 0.22 },
      col: { body: "#ff7a1a", belly: "#ffae5a", back: "#e2520e", fin: "#ff8a2a" },
      shade: { back: -0.35, belly: 0.4 },
      pattern: [
        { type: "bands", color: "#1a1424", at: [0.2, 0.52, 0.86], width: 0.085, wavy: 0.03 },
        { type: "bands", color: "#ffffff", at: [0.2, 0.52, 0.86], width: 0.06, wavy: 0.03, keepTone: true }
      ],
      tail: { type: "round", len: 11, spread: 11, color: "#ff8a2a" },
      dorsal: { type: "spiky", from: 0.24, to: 0.46, h: 6, count: 4 },
      dorsal2: { type: "round", from: 0.48, to: 0.8, h: 8 },
      anal: { type: "round", from: 0.6, to: 0.84, h: 6 },
      pelvic: { from: 0.32, to: 0.42, h: 5 },
      pectoral: { len: 8 },
      eye: { r: 3.4, u: 0.14, v: -0.18, iris: "#ff8a2a" },
      mouth: { type: "small", v: 0.3 },
      extras: [{ type: "clownnose", r: 2.6 }],
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 16, burst: 60, agility: 4, depth: [0.2, 0.7], school: 0 },
    activity: "day",
    traits: { curiosity: 0.7, shyness: 0.2, greed: 0.5, aggression: 0.3 },
    bait: { music: 3, game: 2, video: 2, bread: 2, worm: 1 },
    quirks: ["honk"],
    fight: { phases: ["mash", "tension"], power: 0.22, stamina: 3, tricks: ["dash", "fake"], biteWindow: 0.9, nibbles: [1, 2], fakeBite: 0.15 },
    spawn: { weight: 1.2, weather: null, time: null, requires: null, hidden: null },
    sound: "honk",
    desc: "Born with a red nose and a dream. Honks when startled, honks when happy, honks during funerals.",
    behavior: "Honks at nearby fish. Loves music icons. Squeeze-to-honk is not recommended.",
    shinyHue: 160
  });
  add({
    id: "guppy",
    name: "Fancy Guppy",
    biome: "shallows",
    rarity: "common",
    size: [3, 6],
    weight: [0.01, 0.04],
    look: {
      body: { len: 26, h: 12, shape: "torpedo", tip: 0.2 },
      col: { body: "#9ac8e0", belly: "#eef8ff", back: "#4a7aa0", fin: "#ff5aa8" },
      shade: { back: -0.3, belly: 0.35 },
      pattern: [{ type: "spots", color: "#2a3a7a", size: 1.2, density: 0.4, umin: 0.45 }],
      tail: { type: "fan", len: 20, spread: 14, color: "#ff4a9a", flap: 0.36, spots: "#2a1a4a" },
      dorsal: { type: "sail", from: 0.52, to: 0.84, h: 7, color: "#ff8ac8" },
      anal: { type: "tri", from: 0.62, to: 0.82, h: 3 },
      pelvic: { from: 0.42, to: 0.5, h: 3 },
      pectoral: { len: 3.5 },
      eye: { r: 2.3, u: 0.13, iris: "#e8c040" },
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 18, burst: 70, agility: 6, depth: [0.1, 0.5], school: 3 },
    activity: "any",
    traits: { curiosity: 0.6, shyness: 0.5, greed: 0.4, aggression: 0.05 },
    bait: { image: 3, paint: 3, video: 1, worm: 2, bread: 1 },
    quirks: ["school"],
    fight: { phases: ["tension", "net"], power: 0.12, stamina: 2, tricks: ["dash"], biteWindow: 0.8, nibbles: [1, 3], fakeBite: 0.1 },
    spawn: { weight: 1.3, weather: null, time: null, requires: null, hidden: null },
    sound: "squeak",
    desc: "Ninety percent tail, ten percent fish, one hundred percent fashion. Has never once been underdressed.",
    behavior: "Darts around in small, sparkly gangs. Attracted to pictures, probably of itself.",
    shinyHue: 120
  });
  add({
    id: "googly",
    name: "Googly Gawker",
    biome: "shallows",
    rarity: "common",
    size: [8, 14],
    weight: [0.1, 0.35],
    look: {
      toon: true,
      body: { len: 34, h: 26, shape: "round", tip: 0.25 },
      col: { body: "#6ed880", belly: "#e0ffd0", back: "#2e9a52", fin: "#b0f4a0" },
      shade: { back: -0.35, belly: 0.3 },
      pattern: [{ type: "spots", size: 1.8, density: 0.3, only: "top", tone: 1.5 }],
      tail: { type: "fork", len: 11, spread: 9 },
      dorsal: { type: "tri", from: 0.38, to: 0.66, h: 7 },
      pelvic: { from: 0.36, to: 0.46, h: 5 },
      pectoral: { len: 7 },
      eye: { type: "googly", r: 8, u: 0.24, v: -0.5 },
      moreEyes: [{ type: "googly", r: 6.6, u: 0.44, v: -0.72, behind: true }],
      mouth: { type: "big", v: 0.3 },
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 13, burst: 45, agility: 3, depth: [0.2, 0.7], school: 0 },
    activity: "any",
    traits: { curiosity: 0.95, shyness: 0.15, greed: 0.5, aggression: 0.05 },
    bait: { image: 3, video: 3, game: 2, browser: 1, worm: 1 },
    quirks: ["googly"],
    fight: { phases: ["timing", "tension"], power: 0.2, stamina: 3, tricks: ["fake"], biteWindow: 1, nibbles: [1, 2], fakeBite: 0.25 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "boing",
    desc: "Its eyes are not glued on. We checked. We wish they were.",
    behavior: "Stares at the cursor with tremendous wobbly focus. Pupils rattle when it turns.",
    shinyHue: 270
  });
  add({
    id: "puffer",
    name: "Sir Puffington",
    biome: "shallows",
    rarity: "uncommon",
    size: [12, 30],
    weight: [0.4, 2.1],
    look: {
      toon: true,
      body: { len: 38, h: 28, shape: "round", tip: 0.3 },
      col: { body: "#d8bc56", belly: "#fff3c4", back: "#8a7a32", fin: "#f0d47a" },
      shade: { back: -0.25, belly: 0.25 },
      pattern: [{ type: "spots", color: "#5a4a1e", size: 1.5, density: 0.45, only: "top" }],
      tail: { type: "fan", len: 9, spread: 8 },
      dorsal: { type: "round", from: 0.62, to: 0.82, h: 6 },
      anal: { type: "round", from: 0.62, to: 0.8, h: 5 },
      pectoral: { len: 8 },
      spikes: 9,
      eye: { r: 4.6, u: 0.24, v: -0.28, iris: "#6a9a2a" },
      mouth: { type: "small", v: 0.3 },
      extras: [{ type: "monocle" }, { type: "mustache", color: "#4a2e14", color2: "#7a4e24" }, { type: "cap", style: "tophat", u: 0.44, w: 12, color: "#2a2630", color2: "#c8283a" }],
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 9, burst: 35, agility: 2, depth: [0.25, 0.75], school: 0 },
    activity: "day",
    traits: { curiosity: 0.5, shyness: 0.4, greed: 0.5, aggression: 0.2 },
    bait: { docs: 3, mail: 2, calendar: 2, folder: 1, sugar: 2, golden: 1 },
    quirks: ["inflate"],
    fight: { phases: ["mash", "tension", "net"], power: 0.45, stamina: 5, tricks: ["dash", "fake"], biteWindow: 0.55, nibbles: [1, 3], fakeBite: 0.2 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "puff",
    desc: "A gentleman of considerable volume. Inflates when insulted, which is always.",
    behavior: "Puffs up into a spiky ball when startled or hooked. Reads your documents with great disapproval.",
    shinyHue: 150
  });
  add({
    id: "briefcase",
    name: "Mr. Briefcase",
    biome: "shallows",
    rarity: "uncommon",
    size: [6, 10],
    weight: [0.06, 0.2],
    look: {
      toon: true,
      body: { len: 36, h: 18, shape: "torpedo", tip: 0.22 },
      col: { body: "#6a7890", belly: "#9aa6bc", back: "#465268", fin: "#56637a" },
      shade: { back: -0.35, belly: 0.3 },
      pattern: [{ type: "suit", color: "#f6f6f2" }],
      tail: { type: "truncate", len: 10, spread: 8 },
      dorsal: { type: "tri", from: 0.42, to: 0.64, h: 6 },
      pelvic: { from: 0.42, to: 0.5, h: 4 },
      pectoral: { len: 6 },
      eye: { r: 2.8, u: 0.14, v: -0.28, iris: "#c8d0e0" },
      mouth: { type: "small", v: 0.2 },
      extras: [{ type: "tie", color: "#e8283a", color2: "#9a1022", u: 0.25 }, { type: "briefcase", draw: true, u: 0.42 }],
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 20, burst: 55, agility: 3, depth: [0.3, 0.6], school: 0 },
    activity: "day",
    traits: { curiosity: 0.2, shyness: 0.3, greed: 0.6, aggression: 0.15 },
    bait: { mail: 3, calendar: 3, docs: 2, calc: 2, chat: 1, folder: 1 },
    quirks: ["commuter"],
    fight: { phases: ["tension", "trace"], power: 0.32, stamina: 4, tricks: ["dash", "hop"], biteWindow: 0.5, nibbles: [0, 1], fakeBite: 0.1 },
    spawn: { weight: 1, weather: null, time: "day", requires: null, hidden: null },
    sound: "grunt",
    desc: "Commutes from one side of the screen to the other, every day, forever. Nobody knows what is in the briefcase. Probably more briefcase.",
    behavior: "Swims in straight lines at office hours and checks your calendar on the way. Ignores everything fun.",
    shinyHue: 40
  });
  add({
    id: "clickcrab",
    name: "Click Crab",
    biome: "shallows",
    rarity: "uncommon",
    size: [5, 9],
    weight: [0.08, 0.3],
    look: {
      kind: "crab",
      shell: "mouse",
      toon: true,
      body: { len: 36, h: 22 },
      col: { body: "#eef0f4", belly: "#aab2c0", fin: "#e8664a" },
      eye: { r: 2.6, iris: "#2a2a34" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "crawl", speed: 10, burst: 40, agility: 4, depth: [0.9, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.7, shyness: 0.5, greed: 0.4, aggression: 0.35 },
    bait: { computer: 3, settings: 2, game: 2, terminal: 1, chip: 2 },
    quirks: ["crawler"],
    fight: { phases: ["timing", "mash"], power: 0.3, stamina: 4, tricks: ["hop", "fake"], biteWindow: 0.7, nibbles: [1, 2], fakeBite: 0.2 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "click",
    desc: "Found an old computer mouse and moved in. Double-clicks its claws when nervous, which opens nothing.",
    behavior: "Scuttles along the seabed and across desktop icons. Clicks at your cursor like it is trying to select you.",
    shinyHue: 190
  });
  add({
    id: "seahorse",
    name: "Giddy-Up Seahorse",
    biome: "shallows",
    rarity: "uncommon",
    size: [8, 17],
    weight: [0.02, 0.08],
    look: {
      kind: "seahorse",
      body: { len: 22, h: 56 },
      col: { body: "#e88a32", belly: "#ffd08a", fin: "#fff0c8" },
      eye: { r: 2.6, iris: "#c88a2a" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "hover", speed: 6, burst: 25, agility: 2, depth: [0.3, 0.85], school: 0 },
    activity: "dusk",
    traits: { curiosity: 0.45, shyness: 0.6, greed: 0.3, aggression: 0 },
    bait: { game: 3, music: 2, worm: 2, calendar: 1 },
    quirks: ["hopper"],
    fight: { phases: ["trace", "net"], power: 0.2, stamina: 4, tricks: ["hop"], biteWindow: 0.8, nibbles: [2, 4], fakeBite: 0.1 },
    spawn: { weight: 0.9, weather: null, time: null, requires: null, hidden: null },
    sound: "chirp",
    desc: "Technically a fish. Spiritually a tiny horse. Practically a question mark that swims.",
    behavior: "Bobs upright and hops between windows. Holds onto icons with its tail during storms.",
    shinyHue: 230
  });
  add({
    id: "flounder",
    name: "Sandy Flounder",
    biome: "shallows",
    rarity: "uncommon",
    size: [15, 40],
    weight: [0.3, 2.5],
    look: {
      body: { len: 50, h: 15, shape: "disc", hump: 0.25, belly: -0.35, nose: 1.8, tip: 0.2 },
      col: { body: "#c0a072", belly: "#e0d0b0", back: "#8e7050", fin: "#b09060" },
      shade: { back: -0.1, belly: 0.55 },
      pattern: [
        { type: "spots", color: "#6e5238", size: 2.2, density: 0.5, ring: true },
        { type: "speckle", density: 0.08, tone: 1.6 }
      ],
      dorsal: { type: "long", from: 0.08, to: 0.92, h: 5, lean: 0.25, spots: "#6e5238" },
      anal: { type: "long", from: 0.18, to: 0.92, h: 4.5, lean: 0.25, spots: "#6e5238" },
      tail: { type: "round", len: 10, spread: 8, spots: "#6e5238" },
      pectoral: null,
      eye: { r: 2.6, u: 0.11, v: -0.8, iris: "#c89a3a" },
      moreEyes: [{ r: 2.4, u: 0.19, v: -0.98, iris: "#c89a3a" }],
      mouth: { type: "small", v: 0.1 },
      scales: false,
      lateral: true
    },
    scale: 1,
    move: { style: "glide", speed: 8, burst: 70, agility: 2, depth: [0.92, 1], school: 0 },
    activity: "dusk",
    traits: { curiosity: 0.3, shyness: 0.85, greed: 0.5, aggression: 0.1 },
    bait: { worm: 3, folder: 2, trash: 1, bread: 1, flood: 2 },
    quirks: ["camouflage"],
    fight: { phases: ["tension", "trace", "net"], power: 0.38, stamina: 5, tricks: ["dive", "fake"], biteWindow: 0.45, nibbles: [1, 3], fakeBite: 0.3 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "blub",
    desc: "Both eyes migrated to one side of its face as a child and refuse to talk about it.",
    behavior: "Lies flat on the seabed blending in with the sand. Lunges when bait drifts overhead.",
    shinyHue: 180
  });
  add({
    id: "purin",
    name: "Purin",
    biome: "shallows",
    rarity: "rare",
    size: [6, 10],
    weight: [0.1, 0.25],
    look: {
      kind: "pudding",
      toon: true,
      body: { len: 32, h: 28 },
      col: { body: "#ffe08a", fin: "#8a4a1e" },
      eye: { r: 2.8, blush: true, iris: "#3a2418" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "hop", speed: 8, burst: 30, agility: 2, depth: [0.5, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.6, shyness: 0.55, greed: 0.8, aggression: 0 },
    bait: { sugar: 3, image: 2, chat: 2, game: 1, bread: 1 },
    quirks: ["wobble"],
    fight: { phases: ["timing", "mash", "net"], power: 0.25, stamina: 4, tricks: ["hop", "fake"], biteWindow: 0.7, nibbles: [1, 3], fakeBite: 0.2 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "boing",
    desc: "A jelly pudding that wandered into the sea and was too polite to leave. Contains no fish. Is the fish.",
    behavior: "Wobbles everywhere it goes and jiggles harder when happy. Only truly loves sugar.",
    shinyHue: 290
  });
  add({
    id: "angel",
    name: "Halo Angelfish",
    biome: "shallows",
    rarity: "rare",
    size: [10, 20],
    weight: [0.1, 0.4],
    look: {
      body: { len: 32, h: 34, shape: "disc", nose: 1.5, tip: 0.14, peak: 0.42, tailW: 0.24 },
      col: { body: "#e6e8f2", belly: "#fbfbff", back: "#a8aed0", fin: "#cfd4ea" },
      shade: { back: -0.5, belly: 0.35 },
      pattern: [{ type: "bars", at: [0.2, 0.5, 0.8], width: 0.045, tone: -3.4, bottom: 1, slant: 0 }, { type: "stripes", color: "#e8c050", at: [-0.82], width: 0.12, from: 0.05, to: 0.4 }],
      dorsal: { type: "trail", from: 0.16, to: 0.66, h: 30, lean: 1.35, color: "#c8cce4" },
      anal: { type: "trail", from: 0.24, to: 0.7, h: 28, lean: 1.3, color: "#c8cce4" },
      pelvic: { type: "trail", from: 0.2, to: 0.27, h: 26, lean: 0.75, rays: false, color: "#e8e8f4" },
      tail: { type: "lyre", len: 16, spread: 14, color: "#d8dcf0" },
      pectoral: { len: 7 },
      eye: { r: 3.2, u: 0.15, iris: "#d84a3a" },
      mouth: { type: "small", v: 0.05 },
      extras: [{ type: "halo", color: "#ffe066", glow: true, u: 0.34, h: 14 }],
      scales: true,
      scaleSize: 3,
      finAlpha: 0.88
    },
    scale: 1,
    move: { style: "swim", speed: 10, burst: 40, agility: 3, depth: [0.15, 0.55], school: 0 },
    activity: "day",
    traits: { curiosity: 0.4, shyness: 0.5, greed: 0.3, aggression: 0 },
    bait: { music: 3, calendar: 1, image: 2, golden: 2, sugar: 1 },
    quirks: ["halo", "sparkle"],
    fight: { phases: ["trace", "timing", "net"], power: 0.35, stamina: 6, tricks: ["jump", "fake"], biteWindow: 0.55, nibbles: [1, 2], fakeBite: 0.15 },
    spawn: { weight: 0.8, weather: "clear", time: "day", requires: null, hidden: null },
    sound: "bell",
    desc: "Has never done anything wrong in its life and would like you to know about it.",
    behavior: "Glides serenely with a faint glow. Other fish swim a little more politely nearby.",
    shinyHue: 45
  });
  add({
    id: "parrot",
    name: "Chompy Parrotfish",
    biome: "shallows",
    rarity: "rare",
    size: [25, 60],
    weight: [1.5, 6],
    look: {
      body: { len: 58, h: 28, shape: "oval", hump: 0.12, nose: 2.4, tip: 0.3 },
      col: { body: "#36c0a8", belly: "#a8f0d8", back: "#2280a0", fin: "#ff7ab8" },
      shade: { back: -0.35, belly: 0.35 },
      pattern: [{ type: "chevron", color: "#ff8ac8", count: 5, width: 0.1, body: true }, { type: "face", color: "#5ad8f0", to: 0.15 }],
      mouth: { type: "beak", color: "#f0f4e8" },
      tail: { type: "lyre", len: 16, spread: 14, color: "#ff7ab8" },
      dorsal: { type: "long", from: 0.22, to: 0.86, h: 6, color: "#ff8ac8" },
      anal: { type: "long", from: 0.58, to: 0.86, h: 5, color: "#ff8ac8" },
      pelvic: { from: 0.32, to: 0.4, h: 5 },
      pectoral: { len: 9 },
      eye: { r: 3.4, u: 0.15, iris: "#ffcc30" },
      scales: true,
      scaleSize: 4.5
    },
    scale: 1,
    move: { style: "swim", speed: 14, burst: 55, agility: 3, depth: [0.4, 0.9], school: 0 },
    activity: "day",
    traits: { curiosity: 0.5, shyness: 0.35, greed: 0.8, aggression: 0.3 },
    bait: { trash: 2, calc: 2, worm: 2, folder: 2, paint: 3 },
    quirks: ["thief"],
    fight: { phases: ["mash", "tension", "net"], power: 0.55, stamina: 7, tricks: ["dash", "dive"], biteWindow: 0.5, nibbles: [1, 2], fakeBite: 0.1 },
    spawn: { weight: 0.9, weather: null, time: null, requires: null, hidden: null },
    sound: "grunt",
    desc: "Chews coral, poops sand. Most of the beach is, technically, its fault.",
    behavior: "Nibbles on icons with its beak and occasionally runs off with a corner of one.",
    shinyHue: 100
  });
  add({
    id: "gourami",
    name: "Smooch Gourami",
    biome: "shallows",
    rarity: "rare",
    size: [8, 16],
    weight: [0.08, 0.3],
    look: {
      body: { len: 40, h: 26, shape: "oval", nose: 2, tip: 0.26 },
      col: { body: "#f4b0c0", belly: "#fff0f4", back: "#d880a0", fin: "#ffd0dc" },
      shade: { back: -0.3, belly: 0.3 },
      mouth: { type: "lips", color: "#ff5a86" },
      tail: { type: "round", len: 11, spread: 10 },
      dorsal: { type: "long", from: 0.3, to: 0.86, h: 6 },
      anal: { type: "long", from: 0.4, to: 0.9, h: 7 },
      pectoral: { len: 7 },
      eye: { r: 3.2, u: 0.17, iris: "#8a4a6a" },
      extras: [{ type: "feelers", len: 34, u: 0.3, color: "#ff8ab0", color2: "#fff0f4" }],
      scales: true
    },
    scale: 1,
    move: { style: "swim", speed: 9, burst: 35, agility: 3, depth: [0.2, 0.6], school: 0 },
    activity: "dusk",
    traits: { curiosity: 0.75, shyness: 0.3, greed: 0.35, aggression: 0 },
    bait: { chat: 3, mail: 3, image: 2, sugar: 2, music: 1 },
    quirks: ["forgetful"],
    fight: { phases: ["timing", "trace", "net"], power: 0.3, stamina: 5, tricks: ["fake"], biteWindow: 0.75, nibbles: [2, 4], fakeBite: 0.35 },
    spawn: { weight: 0.9, weather: null, time: null, requires: null, hidden: null },
    sound: "squeak",
    desc: "Kisses everything: rocks, glass, other fish, your cursor. Has no concept of personal space or consent forms.",
    behavior: "Nuzzles anything shiny and forgets what it was doing halfway through. Loves chat icons.",
    shinyHue: 210
  });
  add({
    id: "koi",
    name: "Golden Koi",
    biome: "shallows",
    rarity: "epic",
    size: [35, 80],
    weight: [2, 9],
    look: {
      body: { len: 68, h: 22, shape: "torpedo", nose: 2, tip: 0.24, hump: 0.08 },
      col: { body: "#ffc232", belly: "#fff0a0", back: "#e08a14", fin: "#ffe070" },
      shade: { back: -0.35, belly: 0.4 },
      spec: 1.3,
      pattern: [{ type: "patches", color: "#fff8e8", threshold: 0.66, freq: 0.12 }],
      tail: { type: "fork", len: 20, spread: 14 },
      dorsal: { type: "long", from: 0.32, to: 0.72, h: 6 },
      anal: { type: "tri", from: 0.68, to: 0.82, h: 5 },
      pelvic: { from: 0.44, to: 0.52, h: 5 },
      pectoral: { len: 9, w: 0.5 },
      eye: { r: 2.8, u: 0.12, iris: "#e8c060" },
      extras: [{ type: "whiskers", len: 9, count: 2, color: "#b87a18", color2: "#ffe090" }],
      scales: true,
      scaleSize: 5
    },
    scale: 1,
    move: { style: "swim", speed: 11, burst: 50, agility: 2, depth: [0.2, 0.6], school: 0 },
    activity: "day",
    traits: { curiosity: 0.35, shyness: 0.6, greed: 0.4, aggression: 0 },
    bait: { golden: 3, bread: 1, calendar: 1, image: 2 },
    quirks: ["sparkle", "glow"],
    fight: { phases: ["trace", "tension", "timing", "net"], power: 0.6, stamina: 9, tricks: ["dash", "jump", "fake"], biteWindow: 0.4, nibbles: [2, 4], fakeBite: 0.3 },
    spawn: { weight: 1, weather: null, time: "day", requires: "golden", hidden: true },
    sound: "bell",
    desc: 'Said to grant one wish to whoever catches it. The wish is always "please put me back".',
    behavior: "Appears only for golden bait. Leaves a faint sparkle trail and never hurries.",
    shinyHue: 320
  });
  add({
    id: "betta",
    name: "Disco Betta",
    biome: "shallows",
    rarity: "epic",
    size: [6, 9],
    weight: [0.02, 0.06],
    look: {
      body: { len: 32, h: 13, shape: "torpedo", tip: 0.2 },
      col: { body: "#3a4aff", belly: "#7a8aff", back: "#20169a", fin: "#ff3a6a" },
      shade: { back: -0.3, belly: 0.4 },
      pattern: [{ type: "gradient", color: "#c83aff", from: 0.6 }],
      tail: { type: "veil", len: 32, spread: 22, color: "#ff3a8a", flap: 0.4 },
      dorsal: { type: "wave", from: 0.42, to: 0.97, h: 15, color: "#ff5aa0", lean: 1 },
      anal: { type: "wave", from: 0.3, to: 0.97, h: 17, color: "#c83aff", lean: 0.9 },
      pelvic: { from: 0.28, to: 0.34, h: 10, color: "#ff5a8a" },
      pectoral: { len: 6 },
      eye: { r: 2.6, u: 0.13, iris: "#ff4a3a" },
      mouth: { type: "small", v: -0.1 },
      scales: true,
      scaleSize: 3,
      finAlpha: 0.8
    },
    scale: 1,
    move: { style: "swim", speed: 10, burst: 60, agility: 4, depth: [0.1, 0.45], school: 0 },
    activity: "night",
    traits: { curiosity: 0.5, shyness: 0.2, greed: 0.4, aggression: 0.8 },
    bait: { music: 3, video: 3, game: 2, paint: 2, golden: 1 },
    quirks: ["sparkle", "glow"],
    fight: { phases: ["timing", "dodge", "trace", "net"], power: 0.5, stamina: 7, tricks: ["dash", "fake", "jump"], biteWindow: 0.4, nibbles: [1, 2], fakeBite: 0.25 },
    spawn: { weight: 0.9, weather: null, time: "night", requires: null, hidden: null },
    sound: "bell",
    desc: "Practising its moves for a dance battle no one agreed to. Has already won, in its heart.",
    behavior: "Flares its enormous fins at other fish and at its own reflection. Comes out at night to music.",
    shinyHue: 140
  });
  add({
    id: "sunfish",
    name: "Sol the Ocean Sunfish",
    biome: "shallows",
    rarity: "legendary",
    size: [180, 330],
    weight: [250, 1e3],
    look: {
      body: { len: 96, h: 86, shape: "disc", tailW: 0.62, taper: 0.7, nose: 2.4, peak: 0.42, tip: 0.3 },
      col: { body: "#a8b8cc", belly: "#eef4fa", back: "#5a6a88", fin: "#7a8aa8" },
      shade: { back: -0.4, belly: 0.25 },
      pattern: [
        { type: "patches", threshold: 0.6, freq: 0.5, tone: -0.8 },
        { type: "speckle", density: 0.05, tone: 1.4 }
      ],
      dorsal: { type: "tri", from: 0.66, to: 0.86, h: 54, lean: 0.55 },
      anal: { type: "tri", from: 0.66, to: 0.86, h: 50, lean: 0.55 },
      tail: { type: "clavus", len: 16, spread: 34, flap: 0.1 },
      pectoral: { len: 13, v: 0 },
      eye: { r: 6, u: 0.16, v: -0.2, iris: "#8a9ab8" },
      mouth: { type: "small", v: 0.15, w: 8 },
      extras: [{ type: "cap", style: "crown", u: 0.24, w: 22, color: "#ffd23a" }],
      scales: false,
      lateral: false
    },
    scale: 1,
    move: { style: "drift", speed: 5, burst: 20, agility: 1, depth: [0.05, 0.4], school: 0 },
    activity: "day",
    traits: { curiosity: 0.7, shyness: 0.1, greed: 0.3, aggression: 0 },
    bait: { golden: 3, flood: 3, image: 2, sugar: 2, music: 1 },
    quirks: ["glow", "sparkle"],
    fight: { phases: ["tension", "timing", "trace", "mash", "net"], power: 0.85, stamina: 16, tricks: ["dive", "jump", "fake"], biteWindow: 0.6, nibbles: [2, 5], fakeBite: 0.2 },
    spawn: { weight: 1, weather: "clear", time: "day", requires: null, hidden: true },
    sound: "roar",
    desc: "A swimming head the size of a car, crowned by nobody in particular. Basks at the surface to recharge its sunshine.",
    behavior: "Appears on cloudless days when the water is high. Drifts through windows like it owns them.",
    shinyHue: 30
  });
  add({
    id: "spam",
    name: "Spam Sardine",
    biome: "junkyard",
    rarity: "common",
    size: [8, 15],
    weight: [0.03, 0.1],
    look: {
      body: { len: 26, h: 8, shape: "torpedo", tip: 0.18 },
      col: { body: "#c4d0dc", belly: "#f4f8fc", back: "#3a5a8a", fin: "#a8b8c8" },
      shade: { back: -0.2, belly: 0.35 },
      pattern: [{ type: "stripes", color: "#ff7a9a", at: [-0.08], width: 0.12, from: 0.2, to: 0.95 }, { type: "dots", rows: [-0.45], spacing: 3, size: 0.6, tone: -2.5, from: 0.3 }],
      tail: { type: "fork", len: 8, spread: 6 },
      dorsal: { type: "tri", from: 0.42, to: 0.56, h: 4 },
      anal: { type: "tri", from: 0.7, to: 0.82, h: 2 },
      pelvic: { from: 0.48, to: 0.54, h: 2 },
      pectoral: { len: 3 },
      eye: { r: 2.2, u: 0.12, iris: "#c8ccd8" },
      extras: [{ type: "badge", u: 0.36, r: 3 }],
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 22, burst: 70, agility: 5, depth: [0.1, 0.6], school: 7 },
    activity: "any",
    traits: { curiosity: 0.85, shyness: 0.1, greed: 0.9, aggression: 0.1 },
    bait: { popup: 3, mail: 3, browser: 2, chat: 2, bread: 1 },
    quirks: ["school"],
    fight: { phases: ["mash", "tension"], power: 0.15, stamina: 2, tricks: ["dash"], biteWindow: 1, nibbles: [0, 1], fakeBite: 0.05 },
    spawn: { weight: 1.5, weather: null, time: null, requires: null, hidden: null },
    sound: "squeak",
    desc: "Always has exactly one unread message. Opening it unsubscribes you from nothing.",
    behavior: "Arrives in huge unwanted schools whenever a mail or pop-up icon gets near the water.",
    shinyHue: 60
  });
  add({
    id: "bitfish",
    name: "Bitfish",
    biome: "junkyard",
    rarity: "common",
    size: [5, 9],
    weight: [0.04, 0.12],
    look: {
      toon: true,
      body: { len: 28, h: 17, shape: "box", tip: 0.6 },
      col: { body: "#48e070", belly: "#a8ffb8", back: "#208a48", fin: "#7af090" },
      shade: { back: -0.4, belly: 0.4 },
      pattern: [{ type: "checker", size: 4, tone: -1.2 }],
      tail: { type: "truncate", len: 8, spread: 8 },
      dorsal: { type: "round", from: 0.38, to: 0.62, h: 4, rays: false },
      anal: null,
      pectoral: { len: 5 },
      eye: { type: "pixel", r: 2.2, u: 0.18, v: -0.25, sclera: "#102018" },
      mouth: { type: "small", v: 0.35, w: 4 },
      scales: false,
      shine: false,
      gills: false,
      nostril: false
    },
    scale: 1,
    move: { style: "hop", speed: 16, burst: 40, agility: 6, depth: [0.2, 0.7], school: 3 },
    activity: "any",
    traits: { curiosity: 0.6, shyness: 0.35, greed: 0.5, aggression: 0.1 },
    bait: { game: 3, computer: 2, calc: 2, terminal: 1, chip: 1 },
    quirks: ["hopper", "school"],
    fight: { phases: ["timing", "tension"], power: 0.2, stamina: 3, tricks: ["hop"], biteWindow: 0.8, nibbles: [1, 1], fakeBite: 0.1 },
    spawn: { weight: 1.3, weather: null, time: null, requires: null, hidden: null },
    sound: "chirp",
    desc: "Rendered at a very low budget. Moves in tiny steps because nobody animated the in-between frames.",
    behavior: "Hops in crisp eight-directional jumps. Drawn to game icons like they owe it a sequel.",
    shinyHue: 260
  });
  add({
    id: "glitchminnow",
    name: "Glitch Minnow",
    biome: "junkyard",
    rarity: "common",
    size: [4, 8],
    weight: [0.01, 0.05],
    look: {
      body: { len: 28, h: 10, shape: "torpedo", tip: 0.18 },
      col: { body: "#a86aff", belly: "#e8d0ff", back: "#5a2ac8", fin: "#ff5ad8" },
      shade: { back: -0.3, belly: 0.4 },
      pattern: [{ type: "stripes", color: "#3affe8", at: [0.02], width: 0.1, from: 0.12 }],
      glitch: 0.9,
      tail: { type: "fork", len: 9, spread: 6 },
      dorsal: { type: "tri", from: 0.42, to: 0.6, h: 4 },
      anal: { type: "tri", from: 0.64, to: 0.8, h: 3 },
      pelvic: { from: 0.44, to: 0.5, h: 2 },
      pectoral: { len: 3.5 },
      eye: { r: 2.3, u: 0.13, iris: "#3affe8" },
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 20, burst: 90, agility: 7, depth: [0.15, 0.75], school: 0 },
    activity: "night",
    traits: { curiosity: 0.6, shyness: 0.5, greed: 0.4, aggression: 0.1 },
    bait: { chip: 2, computer: 2, game: 2, settings: 1, terminal: 2 },
    quirks: ["glitch"],
    fight: { phases: ["trace", "tension"], power: 0.18, stamina: 3, tricks: ["glitch", "dash"], biteWindow: 0.6, nibbles: [1, 2], fakeBite: 0.15 },
    spawn: { weight: 1.2, weather: null, time: null, requires: null, hidden: null },
    sound: "glitch",
    desc: "A minnow with corrupted save data. It has been in three places at once, which is two too many.",
    behavior: "Teleports a few pixels at random. Flickers harder near terminals and overclocked chips.",
    shinyHue: 90
  });
  add({
    id: "grouper",
    name: "Rusty Grouper",
    biome: "junkyard",
    rarity: "common",
    size: [40, 110],
    weight: [3, 25],
    look: {
      body: { len: 70, h: 32, shape: "oval", belly: 0.12, hump: 0.08, nose: 1.7, tip: 0.3 },
      col: { body: "#7a6a58", belly: "#b8a890", back: "#46392e", fin: "#5e4e3e" },
      shade: { back: -0.3, belly: 0.35 },
      pattern: [{ type: "rust", color: "#c8642a", threshold: 0.58 }, { type: "spots", size: 1.6, density: 0.3, tone: -1.6, seed: 3 }],
      mouth: { type: "big", v: 0.35, sag: 0.18, teeth: true },
      tail: { type: "round", len: 16, spread: 14 },
      dorsal: { type: "spiky", from: 0.26, to: 0.52, h: 9, count: 6 },
      dorsal2: { type: "round", from: 0.54, to: 0.82, h: 10 },
      anal: { type: "round", from: 0.64, to: 0.84, h: 8 },
      pelvic: { from: 0.3, to: 0.4, h: 8 },
      pectoral: { len: 12 },
      eye: { r: 3.4, u: 0.15, v: -0.35, iris: "#c87a2a" },
      extras: [{ type: "bolts", color: "#c8ccd4" }, { type: "scar", u: 0.56 }],
      scales: true,
      scaleSize: 4
    },
    scale: 1,
    move: { style: "swim", speed: 7, burst: 40, agility: 1, depth: [0.5, 0.95], school: 0 },
    activity: "any",
    traits: { curiosity: 0.3, shyness: 0.25, greed: 0.85, aggression: 0.4 },
    bait: { trash: 2, settings: 3, worm: 2, folder: 1, chip: 1 },
    quirks: [],
    fight: { phases: ["tension", "mash"], power: 0.5, stamina: 6, tricks: ["dive"], biteWindow: 0.7, nibbles: [1, 2], fakeBite: 0.05 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "grunt",
    desc: "Half fish, half shipwreck. Squeaks like an old hinge when it turns. Please do not tighten it.",
    behavior: "Patrols the lower reef slowly and swallows settings icons whole, gears and all.",
    shinyHue: 200
  });
  add({
    id: "binblob",
    name: "Bin Blob",
    biome: "junkyard",
    rarity: "common",
    size: [15, 35],
    weight: [0.8, 4],
    look: {
      kind: "blob",
      toon: true,
      body: { len: 40, h: 30 },
      col: { body: "#8aa05a", fin: "#c85a8a" },
      eye: { r: 3.2, iris: "#c8a030" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "crawl", speed: 5, burst: 18, agility: 1, depth: [0.8, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.6, shyness: 0.2, greed: 1, aggression: 0.05 },
    bait: { trash: 3, popup: 2, docs: 1, blackhole: 2 },
    quirks: ["crawler"],
    fight: { phases: ["mash", "tension", "net"], power: 0.3, stamina: 5, tricks: [], biteWindow: 1.2, nibbles: [0, 1], fakeBite: 0 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "blub",
    desc: "Everything you ever deleted, lovingly reassembled into a friend. It remembers your old drafts.",
    behavior: "Oozes along the seabed absorbing litter. Cannot say no to a full recycle bin.",
    shinyHue: 300
  });
  add({
    id: "shortcut",
    name: "Shortcut Fish",
    biome: "junkyard",
    rarity: "uncommon",
    size: [6, 9],
    weight: [0.05, 0.12],
    look: {
      kind: "iconfish",
      toon: true,
      body: { len: 32, h: 32 },
      col: { body: "#3a8aff", fin: "#5aa0ff" },
      eye: { r: 2.6, iris: "#2a3a6a" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "hover", speed: 12, burst: 60, agility: 4, depth: [0.1, 0.7], school: 0 },
    activity: "any",
    traits: { curiosity: 0.5, shyness: 0.8, greed: 0.4, aggression: 0 },
    bait: { folder: 3, docs: 2, computer: 2, settings: 1 },
    quirks: ["mimic"],
    fight: { phases: ["timing", "trace", "net"], power: 0.3, stamina: 4, tricks: ["fake", "hop"], biteWindow: 0.5, nibbles: [1, 2], fakeBite: 0.4 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "click",
    desc: "Pretends to be a desktop icon. Double-click it and it opens a very small, very wet window.",
    behavior: "Freezes into a perfect app icon when watched. Swims off the moment you look away.",
    shinyHue: 120
  });
  add({
    id: "mechacrab",
    name: "Mecha Crab",
    biome: "junkyard",
    rarity: "uncommon",
    size: [12, 25],
    weight: [1, 4],
    look: {
      kind: "crab",
      shell: "mech",
      toon: true,
      body: { len: 40, h: 26 },
      col: { body: "#e8823a", belly: "#9a5a2a", fin: "#9aa0ac" },
      eye: { type: "glow", glow: "#7affea", r: 3 },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "crawl", speed: 9, burst: 35, agility: 3, depth: [0.88, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.5, shyness: 0.2, greed: 0.5, aggression: 0.7 },
    bait: { chip: 3, settings: 3, calc: 2, computer: 1, terminal: 2 },
    quirks: ["crawler"],
    fight: { phases: ["mash", "dodge", "net"], power: 0.5, stamina: 6, tricks: ["spit", "hop"], biteWindow: 0.6, nibbles: [1, 2], fakeBite: 0.1 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "click",
    desc: "Upgraded itself with spare parts until there was no crab left, then kept going. Runs on spite and AA batteries.",
    behavior: "Marches across icons with heavy steps and fires little bolts when cornered.",
    shinyHue: 160
  });
  add({
    id: "cableeel",
    name: "Cable Eel",
    biome: "junkyard",
    rarity: "uncommon",
    size: [60, 160],
    weight: [0.5, 3],
    look: {
      kind: "chain",
      toon: true,
      chain: { segs: 18, r: 6, head: "plug", housing: "#e8e8ec" },
      col: { body: "#3a3d48", belly: "#5a5e6a", fin: "#2a2c34" },
      eye: { r: 2.4, iris: "#2a2a34" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "chain", speed: 14, burst: 50, agility: 3, depth: [0.4, 0.95], school: 0 },
    activity: "night",
    traits: { curiosity: 0.6, shyness: 0.4, greed: 0.5, aggression: 0.4 },
    bait: { computer: 3, settings: 2, chip: 2, game: 1, music: 1 },
    quirks: ["noodle"],
    fight: { phases: ["unwrap", "tension", "net"], power: 0.45, stamina: 6, tricks: ["wrap", "dash"], biteWindow: 0.6, nibbles: [1, 2], fakeBite: 0.15 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "click",
    desc: "Every drawer has one. This one escaped. It does not fit any socket and is furious about it.",
    behavior: "Coils around icons and tangles your line. Tries to plug itself into anything rectangular.",
    shinyHue: 30
  });
  add({
    id: "floppyray",
    name: "Floppy Ray",
    biome: "junkyard",
    rarity: "uncommon",
    size: [9, 9],
    weight: [0.02, 0.03],
    look: {
      kind: "ray",
      square: true,
      toon: true,
      body: { len: 40, h: 22 },
      col: { body: "#3a4a8a", belly: "#a8b0c8", fin: "#4a5a9a" },
      eye: { r: 3, iris: "#2a2a40" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "glide", speed: 12, burst: 45, agility: 3, depth: [0.2, 0.8], school: 0 },
    activity: "dusk",
    traits: { curiosity: 0.4, shyness: 0.5, greed: 0.4, aggression: 0 },
    bait: { docs: 3, folder: 2, settings: 1, calendar: 1, computer: 1 },
    quirks: [],
    fight: { phases: ["trace", "timing", "net"], power: 0.3, stamina: 5, tricks: ["jump", "fake"], biteWindow: 0.55, nibbles: [1, 3], fakeBite: 0.2 },
    spawn: { weight: 0.9, weather: null, time: null, requires: null, hidden: null },
    sound: "click",
    desc: "1.44 megabytes of pure attitude. Contains one saved game from 1997 that it will not let you see.",
    behavior: "Glides in wide loops and hums like a drive spinning up. Loves documents, old ones especially.",
    shinyHue: 330
  });
  add({
    id: "cookie",
    name: "Tracking Cookie",
    biome: "junkyard",
    rarity: "uncommon",
    size: [6, 12],
    weight: [0.05, 0.2],
    look: {
      toon: true,
      body: { len: 32, h: 30, shape: "round", tip: 0.35, nose: 3 },
      col: { body: "#d49a58", belly: "#e8bc84", back: "#a8702e", fin: "#c08848" },
      shade: { back: -0.5, belly: 0.4 },
      pattern: [{ type: "spots", color: "#4a2a14", size: 2, density: 0.36, seed: 11 }],
      extras: [{ type: "bite", u: 0.58, r: 6 }],
      tail: { type: "round", len: 8, spread: 7 },
      dorsal: null,
      anal: null,
      pectoral: { len: 6 },
      eye: { r: 3.4, u: 0.2, v: -0.25, iris: "#5a3a1a" },
      mouth: { type: "small", v: 0.3 },
      scales: false,
      shine: false,
      gills: false,
      nostril: false
    },
    scale: 1,
    move: { style: "swim", speed: 13, burst: 50, agility: 4, depth: [0.2, 0.8], school: 0 },
    activity: "any",
    traits: { curiosity: 1, shyness: 0.05, greed: 0.6, aggression: 0 },
    bait: { browser: 3, sugar: 3, chat: 1, mail: 1, popup: 1 },
    quirks: ["forgetful"],
    fight: { phases: ["mash", "trace", "net"], power: 0.3, stamina: 4, tricks: ["fake", "dash"], biteWindow: 0.7, nibbles: [1, 3], fakeBite: 0.25 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "chirp",
    desc: "Follows you everywhere and remembers everything you clicked. Forgets you completely when you clear the cache.",
    behavior: "Trails behind your cursor at a respectful-ish distance. Someone already took a bite.",
    shinyHue: 250
  });
  add({
    id: "loadingangler",
    name: "Loading Angler",
    biome: "junkyard",
    rarity: "rare",
    size: [20, 45],
    weight: [2, 8],
    look: {
      body: { len: 50, h: 36, shape: "blunt", tip: 0.55 },
      col: { body: "#7a828e", belly: "#a8b0bc", back: "#4a525e", fin: "#5a626e" },
      shade: { back: -0.3, belly: 0.35 },
      pattern: [{ type: "plates", color: "#4a525e", size: 9 }, { type: "rust", color: "#b0703a", threshold: 0.7 }],
      mouth: { type: "fangs", v: 0.35, w: 16, sag: -0.1, rest: 0.25 },
      tail: { type: "round", len: 12, spread: 12 },
      dorsal: { type: "spiky", from: 0.42, to: 0.72, h: 6, count: 4 },
      anal: { type: "round", from: 0.66, to: 0.84, h: 6 },
      pelvic: { from: 0.4, to: 0.48, h: 5 },
      pectoral: { len: 9 },
      eye: { type: "glow", glow: "#ffb13a", r: 3.4, u: 0.2, v: -0.32 },
      extras: [{ type: "lure", spinner: true, color: "#8a929e", glow: true, reach: 20, h: 34 }, { type: "bolts", color: "#d8dde6" }],
      scales: false
    },
    scale: 1,
    move: { style: "hover", speed: 6, burst: 55, agility: 2, depth: [0.5, 0.95], school: 0 },
    activity: "night",
    traits: { curiosity: 0.3, shyness: 0.3, greed: 0.7, aggression: 0.6 },
    bait: { chip: 3, computer: 2, lantern: 2, video: 2, browser: 2 },
    quirks: ["lure", "loading"],
    fight: { phases: ["timing", "dodge", "tension", "net"], power: 0.55, stamina: 8, tricks: ["fake", "spit", "dive"], biteWindow: 0.45, nibbles: [2, 4], fakeBite: 0.35 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "glitch",
    desc: "Its lure shows a loading spinner. Fish wait for it, forever, politely, right up until the very end.",
    behavior: "Hangs still in the dark with its spinner turning. Strikes when something waits too long.",
    shinyHue: 180
  });
  add({
    id: "thief",
    name: "Icon Bandit",
    biome: "junkyard",
    rarity: "rare",
    size: [12, 22],
    weight: [0.2, 0.7],
    look: {
      toon: true,
      body: { len: 40, h: 16, shape: "pointy", nose: 1.5, tip: 0.18 },
      col: { body: "#5a6a8a", belly: "#c8d0e0", back: "#2a3248", fin: "#3a4458" },
      shade: { back: -0.3, belly: 0.45 },
      pattern: [
        { type: "stripes", color: "#eef0f4", at: [-0.3, 0.14, 0.54], width: 0.12, from: 0.27 },
        { type: "mask", color: "#141824", at: 0.14, width: 0.07, vmax: 0.12 }
      ],
      tail: { type: "fork", len: 12, spread: 9 },
      dorsal: { type: "tri", from: 0.45, to: 0.7, h: 6 },
      anal: { type: "tri", from: 0.66, to: 0.82, h: 4 },
      pelvic: { from: 0.42, to: 0.5, h: 3 },
      pectoral: { len: 6 },
      eye: { r: 2.8, u: 0.14, v: -0.22, lid: "#141824", iris: "#e8e0c0" },
      mouth: { type: "small", v: 0.3 },
      extras: [{ type: "cap", style: "beanie", color: "#1e2230", color2: "#e8e0d0", u: 0.3, w: 11 }],
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 18, burst: 95, agility: 6, depth: [0.1, 0.8], school: 0 },
    activity: "night",
    traits: { curiosity: 0.8, shyness: 0.6, greed: 1, aggression: 0.2 },
    bait: { folder: 3, image: 3, game: 2, golden: 3, music: 1 },
    quirks: ["thief"],
    fight: { phases: ["trace", "mash", "tension", "net"], power: 0.45, stamina: 7, tricks: ["dash", "hop", "fake"], biteWindow: 0.35, nibbles: [0, 1], fakeBite: 0.3 },
    spawn: { weight: 1, weather: null, time: "night", requires: null, hidden: null },
    sound: "squeak",
    desc: 'Steals desktop icons and hides them in the reef. Your "New Folder (7)" is in there somewhere.',
    behavior: "Grabs a desktop icon and bolts. Catch it to get the icon back, slightly damp.",
    shinyHue: 20
  });
  add({
    id: "screendweller",
    name: "Screen Dweller",
    biome: "junkyard",
    rarity: "rare",
    size: [14, 30],
    weight: [1, 5],
    look: {
      toon: true,
      body: { len: 40, h: 30, shape: "box", tip: 0.8 },
      col: { body: "#d8d0b8", belly: "#b8b098", back: "#a89e84", fin: "#c8c0a8" },
      shade: { back: -0.5, belly: 0.5 },
      pattern: [{ type: "face", color: "#3aff8a", to: 0.78, umin: 0.1, vmin: -0.66, vmax: 0.62, glow: true }],
      extras: [{ type: "screen", color: "#0a3a1f" }, { type: "antennae", style: "rabbit", u: 0.46, len: 22 }],
      tail: { type: "truncate", len: 8, spread: 9 },
      dorsal: null,
      anal: null,
      pectoral: { len: 6, u: 0.86 },
      eye: { type: "glow", glow: "#d8ffe0", r: 4.5, u: 0.3, v: -0.1 },
      mouth: { type: "small", v: 0.35, w: 7, line: "#0a3a1f" },
      scales: false,
      gills: false,
      shine: false,
      nostril: false
    },
    scale: 1,
    move: { style: "hover", speed: 8, burst: 40, agility: 2, depth: [0.3, 0.8], school: 0 },
    activity: "night",
    traits: { curiosity: 0.55, shyness: 0.7, greed: 0.3, aggression: 0.2 },
    bait: { video: 3, computer: 3, game: 2, terminal: 2, chip: 1 },
    quirks: ["screen", "glow"],
    fight: { phases: ["dodge", "trace", "timing", "net"], power: 0.45, stamina: 7, tricks: ["glitch", "hop", "spit"], biteWindow: 0.5, nibbles: [1, 3], fakeBite: 0.2 },
    spawn: { weight: 0.9, weather: "storm", time: null, requires: null, hidden: null },
    sound: "glitch",
    desc: "Lives inside old CRT monitors and only comes out to complain about the reception.",
    behavior: "Hides in screens and peeks out through the static. Wiggles its antenna toward video icons.",
    shinyHue: 280
  });
  add({
    id: "trieye",
    name: "Tri-Eyed Binfish",
    biome: "junkyard",
    rarity: "rare",
    size: [15, 35],
    weight: [0.5, 2.5],
    look: {
      body: { len: 44, h: 24, shape: "oval", hump: 0.18, nose: 1.8 },
      col: { body: "#94c04a", belly: "#d8f0a0", back: "#4e7e26", fin: "#c0a0d0" },
      shade: { back: -0.3, belly: 0.35 },
      pattern: [{ type: "patches", color: "#b85a98", threshold: 0.6, freq: 0.2 }],
      mouth: { type: "fangs", v: 0.3 },
      tail: { type: "fork", len: 12, spread: 10 },
      dorsal: { type: "spiky", from: 0.3, to: 0.72, h: 7, count: 5 },
      anal: { type: "wave", from: 0.55, to: 0.82, h: 5 },
      pelvic: { from: 0.36, to: 0.44, h: 5 },
      pectoral: { len: 7 },
      eye: { r: 3.4, u: 0.15, v: -0.28, iris: "#ff4a3a" },
      moreEyes: [{ r: 2.8, u: 0.3, v: -0.8, iris: "#ff4a3a" }, { r: 2.2, u: 0.26, v: 0.2, iris: "#ff4a3a" }],
      extras: [{ type: "scar", u: 0.52, color: "#f0d8e0" }, { type: "bandage", u: 0.7, v: -0.45 }],
      scales: true
    },
    scale: 1,
    move: { style: "swim", speed: 11, burst: 50, agility: 3, depth: [0.4, 0.95], school: 0 },
    activity: "night",
    traits: { curiosity: 0.6, shyness: 0.2, greed: 0.8, aggression: 0.5 },
    bait: { trash: 3, blackhole: 2, popup: 1, worm: 1 },
    quirks: [],
    fight: { phases: ["dodge", "mash", "tension", "net"], power: 0.5, stamina: 7, tricks: ["spit", "dash"], biteWindow: 0.5, nibbles: [1, 2], fakeBite: 0.15 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "grunt",
    desc: "Grew a third eye from living next to the recycle bin. Uses it exclusively for judging you.",
    behavior: "Lurks near trash and spits soggy debris when hooked. All three eyes blink at different times.",
    shinyHue: 210
  });
  add({
    id: "usbfish",
    name: "USB Swordfish",
    biome: "junkyard",
    rarity: "epic",
    size: [80, 180],
    weight: [20, 90],
    look: {
      body: { len: 72, h: 20, shape: "torpedo", nose: 1.6, tip: 0.3, tailW: 0.2 },
      col: { body: "#3a4a6a", belly: "#c8d4e4", back: "#1a2440", fin: "#2a3a5a" },
      shade: { back: -0.1, belly: 0.25 },
      pattern: [{ type: "circuit", color: "#5ac8ff", glow: true, vmax: 0 }],
      extras: [{ type: "usb", len: 30, color: "#22252e", color2: "#c4ccd8" }],
      tail: { type: "moon", len: 22, spread: 18 },
      dorsal: { type: "sail", from: 0.12, to: 0.36, h: 18, lean: 0.9 },
      dorsal2: { type: "tri", from: 0.86, to: 0.9, h: 3 },
      anal: { type: "tri", from: 0.74, to: 0.84, h: 4 },
      pectoral: { len: 10, w: 0.3, angle: 0.8 },
      eye: { r: 3.4, u: 0.1, v: -0.3, iris: "#5ac8ff" },
      mouth: { type: "small", v: 0.55 },
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 26, burst: 140, agility: 3, depth: [0.2, 0.7], school: 0 },
    activity: "any",
    traits: { curiosity: 0.4, shyness: 0.3, greed: 0.5, aggression: 0.7 },
    bait: { computer: 3, chip: 3, settings: 2, terminal: 2, docs: 1 },
    quirks: ["glow"],
    fight: { phases: ["timing", "tension", "dodge", "net"], power: 0.75, stamina: 11, tricks: ["dash", "fake", "jump"], biteWindow: 0.35, nibbles: [2, 3], fakeBite: 0.4 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "click",
    desc: "Never plugs in on the first try. Flips over. Tries again. Flips over again. It worked the first time.",
    behavior: "Charges at icons nose-first trying to plug into them. Fakes out bites at least twice.",
    shinyHue: 300
  });
  add({
    id: "lionfish",
    name: "Malware Lionfish",
    biome: "junkyard",
    rarity: "epic",
    size: [20, 40],
    weight: [0.5, 1.4],
    look: {
      body: { len: 44, h: 22, shape: "oval", nose: 1.8, tip: 0.24 },
      col: { body: "#f2e2d8", belly: "#fff8f4", back: "#c8a89e", fin: "#ff5a4a" },
      shade: { back: -0.4, belly: 0.35 },
      pattern: [{ type: "bands", color: "#b8241e", at: [0.1, 0.24, 0.38, 0.52, 0.66, 0.8, 0.93], width: 0.045, wavy: 0.05 }],
      dorsal: { type: "spiky", from: 0.14, to: 0.62, h: 28, count: 9, color: "#ff5a4a", lean: 0.8 },
      dorsal2: { type: "round", from: 0.64, to: 0.86, h: 10, color: "#ffb0a0" },
      anal: { type: "round", from: 0.62, to: 0.86, h: 10, color: "#ffb0a0" },
      pelvic: { from: 0.32, to: 0.4, h: 12, color: "#ff7a5a" },
      pectoral: { len: 26, w: 0.55, angle: 0.95, color: "#ff7a5a", spines: true },
      tail: { type: "round", len: 14, spread: 12, color: "#ffb0a0", spots: "#b8241e" },
      eye: { r: 3.2, u: 0.15, iris: "#c8282a" },
      mouth: { type: "small", v: 0.25 },
      extras: [{ type: "badge", u: 0.28, r: 3.5, color: "#ff3048" }],
      scales: false,
      finAlpha: 0.82
    },
    scale: 1,
    move: { style: "hover", speed: 7, burst: 45, agility: 3, depth: [0.3, 0.85], school: 0 },
    activity: "dusk",
    traits: { curiosity: 0.5, shyness: 0.1, greed: 0.6, aggression: 0.9 },
    bait: { popup: 3, mail: 2, browser: 2, chat: 1, trash: 1 },
    quirks: ["glitch"],
    fight: { phases: ["dodge", "tension", "trace", "net"], power: 0.65, stamina: 10, tricks: ["spit", "fake", "glitch"], biteWindow: 0.4, nibbles: [1, 3], fakeBite: 0.3 },
    spawn: { weight: 1, weather: "storm", time: null, requires: null, hidden: null },
    sound: "glitch",
    desc: "Every spine is an unskippable ad. Looking at it for too long installs a toolbar.",
    behavior: "Hovers with fins flared and shoots pop-up projectiles during fights. Do not click the spines.",
    shinyHue: 190
  });
  add({
    id: "bsod",
    name: "Blue Screen Ray",
    biome: "junkyard",
    rarity: "legendary",
    size: [300, 600],
    weight: [400, 1400],
    look: {
      kind: "ray",
      bsod: true,
      manta: true,
      toon: true,
      body: { len: 104, h: 66 },
      col: { body: "#1a4ad8", belly: "#5a8aff", fin: "#2a5ae8" },
      eye: { r: 3 },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "glide", speed: 10, burst: 60, agility: 1, depth: [0.2, 0.7], school: 0 },
    activity: "night",
    traits: { curiosity: 0.6, shyness: 0.1, greed: 0.4, aggression: 0.6 },
    bait: { computer: 3, chip: 3, blackhole: 2, settings: 2, terminal: 2 },
    quirks: ["glitch", "glow", "screen"],
    fight: { phases: ["dodge", "timing", "trace", "mash", "net"], power: 0.95, stamina: 18, tricks: ["glitch", "spit", "dive", "fake"], biteWindow: 0.4, nibbles: [2, 4], fakeBite: 0.3 },
    spawn: { weight: 1, weather: "storm", time: "night", requires: null, hidden: true },
    sound: "roar",
    desc: "A fatal exception the size of a bus. Collecting error info... 0% complete. Has been 0% since 1995.",
    behavior: "Glides out of the dark during thunderstorms. Its face changes with its mood. It is never in a good mood.",
    shinyHue: 120
  });
  var GLOW_EYES = [
    [0.28, -0.6, 5, "#7affea"],
    [0.37, -0.18, 4, "#ffd84a"],
    [0.45, -0.66, 6, "#ff7ab8"],
    [0.52, -0.28, 3.6, "#7affea"],
    [0.6, -0.56, 5, "#ffd84a"],
    [0.68, -0.18, 4, "#ff7ab8"],
    [0.76, -0.55, 4, "#7affea"],
    [0.31, 0.32, 4, "#ffd84a"],
    [0.45, 0.28, 3.2, "#7affea"],
    [0.58, 0.38, 4.6, "#ff7ab8"],
    [0.71, 0.26, 3.2, "#ffd84a"],
    [0.84, -0.3, 3.4, "#ff7ab8"],
    [0.22, -0.02, 3.2, "#ff7ab8"],
    [0.88, 0.08, 2.6, "#7affea"]
  ];
  add({
    id: "lanternfish",
    name: "Lanternfish",
    biome: "abyss",
    rarity: "common",
    size: [3, 10],
    weight: [0.01, 0.06],
    look: {
      body: { len: 26, h: 10, shape: "blunt", tip: 0.4, nose: 2.6 },
      col: { body: "#3a4a6a", belly: "#8a9ab8", back: "#18203a", fin: "#2a3448" },
      shade: { back: -0.2, belly: 0.4 },
      pattern: [{ type: "dots", color: "#8affff", rows: [0.62, 0.2], glow: true, spacing: 3.2, size: 0.8 }],
      tail: { type: "fork", len: 8, spread: 6 },
      dorsal: { type: "tri", from: 0.42, to: 0.6, h: 4 },
      dorsal2: { type: "round", from: 0.82, to: 0.88, h: 2, rays: false },
      anal: { type: "tri", from: 0.62, to: 0.8, h: 3 },
      pectoral: { len: 3.5 },
      eye: { r: 3.2, u: 0.13, v: -0.15, iris: "#aac8ff", pupilSize: 0.6 },
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 16, burst: 60, agility: 5, depth: [0.1, 0.6], school: 6 },
    activity: "night",
    traits: { curiosity: 0.6, shyness: 0.4, greed: 0.5, aggression: 0 },
    bait: { lantern: 3, worm: 2, video: 1, bread: 1 },
    quirks: ["school", "glow"],
    fight: { phases: ["trace", "tension"], power: 0.15, stamina: 2.5, tricks: ["dash"], biteWindow: 0.8, nibbles: [1, 2], fakeBite: 0.1 },
    spawn: { weight: 1.5, weather: null, time: null, requires: null, hidden: null },
    sound: "chirp",
    desc: "The night lights of the deep. Billions of them rise every evening, which is why the ocean never needs a nightlight.",
    behavior: "Swims in glowing schools and drifts upward at night. Follows lantern pearls like moths.",
    shinyHue: 60
  });
  add({
    id: "hatchet",
    name: "Hatchetfish",
    biome: "abyss",
    rarity: "common",
    size: [3, 8],
    weight: [0.01, 0.04],
    look: {
      body: { len: 22, h: 24, shape: "pointy", belly: 0.5, hump: -0.12, peak: 0.32, tailW: 0.16, tip: 0.2 },
      col: { body: "#c8d4e8", belly: "#f0f8ff", back: "#4a5a7a", fin: "#9aa8c0" },
      shade: { back: -0.55, belly: 0.1 },
      spec: 1.4,
      pattern: [
        { type: "dots", color: "#7affd8", rows: [0.82], glow: true, spacing: 2.6, from: 0.18, to: 0.75, size: 0.8 }
      ],
      tail: { type: "fork", len: 7, spread: 5 },
      dorsal: { type: "tri", from: 0.52, to: 0.66, h: 4 },
      anal: { type: "tri", from: 0.66, to: 0.86, h: 3 },
      pectoral: { len: 5 },
      eye: { r: 3.8, u: 0.18, v: -0.42, iris: "#c8d8ff", pupilSize: 0.62 },
      mouth: { type: "small", v: -0.25, w: 4, sag: -0.2 },
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 12, burst: 70, agility: 5, depth: [0.15, 0.7], school: 4 },
    activity: "any",
    traits: { curiosity: 0.5, shyness: 0.7, greed: 0.4, aggression: 0 },
    bait: { lantern: 2, worm: 2, calc: 1, image: 1, bread: 1 },
    quirks: ["school"],
    fight: { phases: ["timing", "tension"], power: 0.14, stamina: 2.5, tricks: ["dash", "jump"], biteWindow: 0.7, nibbles: [1, 2], fakeBite: 0.1 },
    spawn: { weight: 1.3, weather: null, time: null, requires: null, hidden: null },
    sound: "squeak",
    desc: "Shaped like a tiny axe and permanently startled about it. Its belly lights match the moonlight so nothing below can see it.",
    behavior: "Hovers in nervous little groups, eyes pointed up. Bolts at the slightest ripple.",
    shinyHue: 30
  });
  add({
    id: "isopod",
    name: "Giant Isopod",
    biome: "abyss",
    rarity: "common",
    size: [20, 45],
    weight: [0.8, 1.7],
    look: {
      kind: "isopod",
      body: { len: 46, h: 20 },
      col: { body: "#c8b8c8" },
      eye: { r: 3, iris: "#2a2a34", pupilSize: 0.7 },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "crawl", speed: 6, burst: 25, agility: 2, depth: [0.9, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.4, shyness: 0.3, greed: 0.9, aggression: 0.1 },
    bait: { worm: 3, trash: 2, bread: 2, calendar: 1 },
    quirks: ["crawler"],
    fight: { phases: ["mash", "tension"], power: 0.3, stamina: 4, tricks: [], biteWindow: 1, nibbles: [0, 1], fakeBite: 0 },
    spawn: { weight: 1.2, weather: null, time: null, requires: null, hidden: null },
    sound: "click",
    desc: "Can go five years without eating. Has chosen not to. Eats like a holiday every time it finds a snack.",
    behavior: "Trundles across the seabed and rolls into a ball when poked. Will eat literally anything you drop.",
    shinyHue: 160
  });
  add({
    id: "glowjelly",
    name: "Nightlight Jelly",
    biome: "abyss",
    rarity: "common",
    size: [8, 25],
    weight: [0.05, 0.4],
    look: {
      kind: "jelly",
      glow: true,
      noFace: true,
      body: { len: 32, h: 26 },
      col: { body: "#7ab8ff", fin: "#b8e0ff" },
      translucent: 0.6,
      gonad: "#ffd06a",
      tentacleCount: 7,
      mouth: { type: "none" }
    },
    scale: 1,
    move: { style: "drift", speed: 4, burst: 15, agility: 1, depth: [0.1, 0.8], school: 0 },
    activity: "night",
    traits: { curiosity: 0.3, shyness: 0.4, greed: 0.2, aggression: 0.1 },
    bait: { lantern: 3, music: 2, image: 1, sugar: 1 },
    quirks: ["glow", "pulse"],
    fight: { phases: ["trace", "net"], power: 0.12, stamina: 3, tricks: [], biteWindow: 1.2, nibbles: [2, 4], fakeBite: 0 },
    spawn: { weight: 1.2, weather: null, time: null, requires: null, hidden: null },
    sound: "bell",
    desc: "Glows softly so the other fish are not scared of the dark. Has no brain, but a very big heart, metaphorically.",
    behavior: "Pulses gently through the water. Brightens near music and lantern light.",
    shinyHue: 110
  });
  add({
    id: "blobfish",
    name: "Sad Blobfish",
    biome: "abyss",
    rarity: "common",
    size: [15, 30],
    weight: [0.5, 2],
    look: {
      kind: "blob",
      blobfish: true,
      body: { len: 46, h: 30 },
      col: { body: "#e8a0a8", fin: "#e09aa4" },
      nose: "#d8889a",
      eye: { r: 2.2, iris: "#3a2a3a" },
      mouth: { type: "small", smile: -0.35 }
    },
    scale: 1,
    move: { style: "drift", speed: 3, burst: 10, agility: 1, depth: [0.75, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.2, shyness: 0.4, greed: 0.6, aggression: 0 },
    bait: { worm: 2, sugar: 2, chat: 2, bread: 1, trash: 1 },
    quirks: [],
    fight: { phases: ["tension", "mash"], power: 0.2, stamina: 3, tricks: [], biteWindow: 1.4, nibbles: [0, 2], fakeBite: 0 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "blub",
    desc: "Looks perfectly normal at home under the crushing pressure. It is only sad because you brought it up here.",
    behavior: "Floats near the seabed and barely moves. Lets food come to it, and food usually does not.",
    shinyHue: 180
  });
  add({
    id: "angler",
    name: "Deep Anglerfish",
    biome: "abyss",
    rarity: "uncommon",
    size: [10, 40],
    weight: [0.5, 5],
    look: {
      body: { len: 46, h: 34, shape: "blunt", tip: 0.55 },
      col: { body: "#4a3f5a", belly: "#6a5a72", back: "#2a2234", fin: "#3a3048" },
      shade: { back: -0.2, belly: 0.4 },
      pattern: [{ type: "speckle", density: 0.1, tone: 1.2 }],
      mouth: { type: "fangs", v: 0.3, w: 15, sag: -0.15, rest: 0.3 },
      tail: { type: "round", len: 12, spread: 11 },
      dorsal: { type: "tri", from: 0.55, to: 0.76, h: 6 },
      anal: { type: "tri", from: 0.62, to: 0.8, h: 5 },
      pectoral: { len: 8 },
      eye: { r: 2.4, u: 0.22, v: -0.38, iris: "#c8f0ff" },
      extras: [{ type: "lure", color: "#6a6078", glow: true, color2: "#c8fff0", reach: 18, h: 30 }],
      scales: false
    },
    scale: 1,
    move: { style: "hover", speed: 5, burst: 60, agility: 2, depth: [0.4, 0.9], school: 0 },
    activity: "any",
    traits: { curiosity: 0.2, shyness: 0.2, greed: 0.9, aggression: 0.6 },
    bait: { lantern: 3, worm: 2, blackhole: 1, image: 1 },
    quirks: ["lure", "glow"],
    fight: { phases: ["tension", "dodge", "net"], power: 0.45, stamina: 6, tricks: ["fake", "dive"], biteWindow: 0.5, nibbles: [1, 3], fakeBite: 0.25 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "grunt",
    desc: "Invented the night light, then used it for crimes. Its smile is 40% teeth and 60% more teeth.",
    behavior: "Waits motionless with its lure bobbing. Snaps at anything that admires the light.",
    shinyHue: 140
  });
  add({
    id: "dragonfish",
    name: "Dragonfish",
    biome: "abyss",
    rarity: "uncommon",
    size: [15, 40],
    weight: [0.1, 0.6],
    look: {
      body: { len: 72, h: 13, shape: "long", tip: 0.35 },
      col: { body: "#1e1a2a", belly: "#2e2a3a", back: "#100c18", fin: "#2a2238" },
      shade: { back: -0.2, belly: 0.4 },
      pattern: [{ type: "dots", color: "#7ac8ff", glow: true, rows: [0.62], spacing: 4.2, size: 0.9 }],
      mouth: { type: "fangs", v: 0.2, w: 9, rest: 0.2 },
      tail: { type: "fork", len: 11, spread: 7 },
      dorsal: { type: "tri", from: 0.8, to: 0.93, h: 6 },
      anal: { type: "tri", from: 0.78, to: 0.93, h: 6 },
      pectoral: { len: 5 },
      eye: { type: "glow", r: 2.6, u: 0.07, v: -0.35, glow: "#ff6a8a" },
      extras: [{ type: "barbel", len: 22, color2: "#ff6aa8", glow: true }],
      scales: false
    },
    scale: 1,
    move: { style: "swim", speed: 12, burst: 80, agility: 4, depth: [0.4, 0.95], school: 0 },
    activity: "any",
    traits: { curiosity: 0.4, shyness: 0.4, greed: 0.7, aggression: 0.7 },
    bait: { lantern: 3, worm: 2, video: 1, blackhole: 1 },
    quirks: ["glow", "lure"],
    fight: { phases: ["trace", "dodge", "net"], power: 0.45, stamina: 6, tricks: ["dash", "fake"], biteWindow: 0.45, nibbles: [1, 2], fakeBite: 0.25 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "roar",
    desc: "Sees in red light nothing else can see. Uses this superpower mostly to sneak up on shrimp.",
    behavior: "Slithers through the dark dangling its chin lure. Lightning-fast when it finally strikes.",
    shinyHue: 200
  });
  add({
    id: "gulper",
    name: "Gulper Eel",
    biome: "abyss",
    rarity: "uncommon",
    size: [40, 100],
    weight: [0.5, 1.5],
    look: {
      body: { len: 80, h: 18, shape: "blunt", peak: 0.14, tailW: 0.06, taper: 0.45, tip: 0.6 },
      col: { body: "#2a2a3a", belly: "#3a3a4e", back: "#1a1a26", fin: "#2a2a3a" },
      shade: { back: -0.2, belly: 0.5 },
      mouth: { type: "gulper", w: 26, v: 0.15, rest: 0.18 },
      tail: { type: "whip", len: 32, spread: 2, color: "#ff6ab0" },
      dorsal: { type: "long", from: 0.3, to: 0.96, h: 2 },
      anal: { type: "long", from: 0.42, to: 0.96, h: 2 },
      pectoral: null,
      eye: { r: 2, u: 0.05, v: -0.5, iris: "#6a7a9a" },
      pattern: [{ type: "tailend", color: "#ff6ab0", from: 0.93, glow: true }],
      scales: false,
      gills: false
    },
    scale: 1,
    move: { style: "swim", speed: 9, burst: 50, agility: 3, depth: [0.5, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.5, shyness: 0.3, greed: 1, aggression: 0.5 },
    bait: { blackhole: 3, worm: 2, trash: 2, folder: 2 },
    quirks: [],
    fight: { phases: ["mash", "tension", "net"], power: 0.4, stamina: 6, tricks: ["dive", "wrap"], biteWindow: 0.6, nibbles: [1, 2], fakeBite: 0.1 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "blub",
    desc: "Mouth: enormous. Rest of fish: an afterthought. Can swallow things larger than itself and frequently regrets it.",
    behavior: "Opens its jaw like a parachute to scoop up bait. Its tail tip glows pink to lure snacks.",
    shinyHue: 100
  });
  add({
    id: "fangtooth",
    name: "Fangtooth",
    biome: "abyss",
    rarity: "uncommon",
    size: [8, 18],
    weight: [0.1, 0.4],
    look: {
      body: { len: 40, h: 28, shape: "blunt", hump: 0.1, tip: 0.5 },
      col: { body: "#3a2a3a", belly: "#5a4a52", back: "#22161e", fin: "#4a3a42" },
      shade: { back: -0.2, belly: 0.45 },
      pattern: [{ type: "speckle", density: 0.12, tone: -1.4 }],
      mouth: { type: "fangs", v: 0.25, w: 14, sag: 0, rest: 0.4 },
      tail: { type: "fork", len: 12, spread: 10 },
      dorsal: { type: "tri", from: 0.45, to: 0.7, h: 7 },
      anal: { type: "tri", from: 0.6, to: 0.8, h: 5 },
      pectoral: { len: 7 },
      eye: { r: 2.4, u: 0.22, v: -0.4, iris: "#d8e8ff" },
      scales: true,
      scaleSize: 4
    },
    scale: 1,
    move: { style: "swim", speed: 10, burst: 55, agility: 3, depth: [0.6, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.3, shyness: 0.2, greed: 0.8, aggression: 0.9 },
    bait: { worm: 3, trash: 2, blackhole: 2, game: 1 },
    quirks: [],
    fight: { phases: ["mash", "dodge", "tension"], power: 0.5, stamina: 6, tricks: ["dash", "spit"], biteWindow: 0.45, nibbles: [0, 1], fakeBite: 0.05 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "roar",
    desc: "Has the largest teeth for its body size of any fish. Cannot close its mouth. Very self-conscious about it.",
    behavior: "Charges straight at bait with a terrible grin. Bites hard, then sulks.",
    shinyHue: 60
  });
  add({
    id: "ghostshark",
    name: "Ghost Shark",
    biome: "abyss",
    rarity: "uncommon",
    size: [40, 100],
    weight: [1, 6],
    look: {
      body: { len: 50, h: 19, shape: "torpedo", peak: 0.25, tailW: 0.1, taper: 0.7, tip: 0.3, nose: 2.2 },
      col: { body: "#b8b0d8", belly: "#e8e4f8", back: "#6a60a0", fin: "#a8a0d0" },
      shade: { back: -0.3, belly: 0.4 },
      pattern: [{ type: "stripes", color: "#8a80b8", at: [-0.3, 0.2], width: 0.04, from: 0.18, to: 0.95 }],
      tail: { type: "whip", len: 36, spread: 3 },
      dorsal: { type: "sail", from: 0.24, to: 0.38, h: 14, lean: 0.7 },
      dorsal2: { type: "long", from: 0.46, to: 0.92, h: 4 },
      pelvic: { from: 0.5, to: 0.58, h: 5 },
      pectoral: { len: 18, w: 0.55, angle: 0.75, u: 0.3, v: 0.3 },
      eye: { r: 4.6, u: 0.13, v: -0.25, iris: "#5affd8", pupilSize: 0.6 },
      mouth: { type: "small", v: 0.55, w: 4 },
      scales: false,
      lateral: true
    },
    scale: 1,
    move: { style: "glide", speed: 9, burst: 45, agility: 2, depth: [0.6, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.6, shyness: 0.6, greed: 0.4, aggression: 0.1 },
    bait: { worm: 2, folder: 2, lantern: 2, calendar: 1, blackhole: 1 },
    quirks: ["camouflage"],
    fight: { phases: ["trace", "tension", "net"], power: 0.4, stamina: 6, tricks: ["dive", "fake"], biteWindow: 0.55, nibbles: [1, 2], fakeBite: 0.2 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "squeak",
    desc: "Not a ghost. Not technically a shark. Haunts the seabed anyway, out of professional courtesy.",
    behavior: "Flies over the seabed on big wing-fins, staring at everything with enormous, worried eyes.",
    shinyHue: 300
  });
  add({
    id: "glassghost",
    name: "Glass Ghostfish",
    biome: "abyss",
    rarity: "rare",
    size: [6, 14],
    weight: [0.02, 0.08],
    look: {
      body: { len: 46, h: 20, shape: "oval", nose: 1.7 },
      col: { body: "#bfe8ff", belly: "#e6f8ff", back: "#8fc4e0", fin: "#cdeeff" },
      shade: { back: -0.35, belly: 0.4 },
      translucent: 0.42,
      organs: { bone: "#ffffff", stomach: "#9ad66b" },
      tail: { type: "fork", len: 15, spread: 11 },
      dorsal: { type: "sail", from: 0.36, to: 0.6, h: 8 },
      anal: { type: "long", from: 0.5, to: 0.86, h: 5 },
      pelvic: { from: 0.42, to: 0.5, h: 4 },
      pectoral: { len: 6 },
      eye: { r: 3.4, u: 0.12, iris: "#7ac8ff" },
      scales: false,
      finAlpha: 0.55
    },
    scale: 1,
    move: { style: "swim", speed: 10, burst: 45, agility: 4, depth: [0.2, 0.8], school: 0 },
    activity: "night",
    traits: { curiosity: 0.5, shyness: 0.75, greed: 0.3, aggression: 0 },
    bait: { image: 3, lantern: 2, docs: 1, worm: 1 },
    quirks: ["camouflage"],
    fight: { phases: ["trace", "timing", "tension", "net"], power: 0.35, stamina: 6, tricks: ["fake", "glitch"], biteWindow: 0.45, nibbles: [1, 3], fakeBite: 0.3 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "bell",
    desc: "Completely see-through, so you always know exactly what it had for lunch (you). Its heart beats a little faster near cameras.",
    behavior: "Nearly invisible against the dark. You can watch its heart beat when it gets nervous.",
    shinyHue: 280
  });
  add({
    id: "vampsquid",
    name: "Vampire Squid",
    biome: "abyss",
    rarity: "rare",
    size: [15, 30],
    weight: [0.3, 1.2],
    look: {
      kind: "squid",
      cape: true,
      photophores: true,
      body: { len: 54, h: 34 },
      col: { body: "#8a1a2e", fin: "#b8304a" },
      lining: "#1e0812",
      eye: { type: "glow", glow: "#7ab8ff", r: 5 },
      mouth: { type: "none" }
    },
    scale: 1,
    move: { style: "hover", speed: 7, burst: 40, agility: 3, depth: [0.4, 0.9], school: 0 },
    activity: "night",
    traits: { curiosity: 0.35, shyness: 0.8, greed: 0.3, aggression: 0.2 },
    bait: { lantern: 2, video: 2, calendar: 1, blackhole: 2, sugar: 1 },
    quirks: ["ink", "glow"],
    fight: { phases: ["dodge", "trace", "unwrap", "net"], power: 0.5, stamina: 7, tricks: ["ink", "wrap", "fake"], biteWindow: 0.5, nibbles: [1, 3], fakeBite: 0.2 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "squeak",
    desc: "Despite the name and the cape, it is a gentle vegetarian of sea snow. The cape is purely a fashion choice.",
    behavior: "Flaps its ear-fins and wraps itself in its cloak when scared. Squirts glowing goo instead of ink.",
    shinyHue: 170
  });
  add({
    id: "barreleye",
    name: "Barreleye",
    biome: "abyss",
    rarity: "rare",
    size: [10, 16],
    weight: [0.05, 0.2],
    look: {
      body: { len: 44, h: 17, shape: "torpedo", tip: 0.3 },
      col: { body: "#5a6a7a", belly: "#9aa8b8", back: "#34404e", fin: "#7a8a9a" },
      shade: { back: -0.3, belly: 0.35 },
      pattern: [{ type: "spots", size: 1.4, density: 0.3, seed: 4, tone: -1.4 }],
      extras: [{ type: "dome", u: 0.24, color: "#62f07a" }],
      tail: { type: "fork", len: 11, spread: 8 },
      dorsal: { type: "tri", from: 0.66, to: 0.8, h: 5 },
      pelvic: { from: 0.5, to: 0.58, h: 4 },
      pectoral: { len: 12, w: 0.6 },
      eye: { r: 2, u: 0.06, v: -0.05, iris: "#1a1a24" },
      mouth: { type: "small", v: 0.4, w: 3 },
      scales: true,
      nostril: false
    },
    scale: 1,
    move: { style: "hover", speed: 5, burst: 30, agility: 2, depth: [0.3, 0.8], school: 0 },
    activity: "any",
    traits: { curiosity: 0.85, shyness: 0.5, greed: 0.3, aggression: 0 },
    bait: { lantern: 3, image: 2, video: 2, browser: 1 },
    quirks: ["glow"],
    fight: { phases: ["timing", "trace", "tension", "net"], power: 0.35, stamina: 6, tricks: ["fake", "jump"], biteWindow: 0.6, nibbles: [1, 3], fakeBite: 0.25 },
    spawn: { weight: 0.9, weather: null, time: null, requires: null, hidden: null },
    sound: "chirp",
    desc: "Those two dots on its face are its nostrils. Its actual eyes are inside its see-through head, looking up at you. Hello.",
    behavior: "Hangs motionless, rolling its green tube-eyes toward any light above.",
    shinyHue: 260
  });
  add({
    id: "dumbo",
    name: "Dumbo Octopus",
    biome: "abyss",
    rarity: "rare",
    size: [8, 20],
    weight: [0.1, 0.6],
    look: {
      kind: "octopus",
      body: { len: 38, h: 40 },
      col: { body: "#ffa0b8", fin: "#ffc8d8" },
      translucent: 0.9,
      eye: { r: 3.2, iris: "#2a1a2a", pupilSize: 0.65 },
      mouth: { type: "none" }
    },
    scale: 1,
    move: { style: "hover", speed: 5, burst: 25, agility: 2, depth: [0.5, 1], school: 0 },
    activity: "any",
    traits: { curiosity: 0.8, shyness: 0.5, greed: 0.3, aggression: 0 },
    bait: { music: 2, sugar: 3, chat: 2, image: 1, lantern: 1 },
    quirks: ["pulse"],
    fight: { phases: ["trace", "timing", "net"], power: 0.25, stamina: 5, tricks: ["hop", "ink"], biteWindow: 0.75, nibbles: [1, 3], fakeBite: 0.15 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "boing",
    desc: "Flies through the deep by flapping its ears. Has never seen a cartoon elephant and resents the comparison anyway.",
    behavior: "Flaps gently up and down near the seabed. Gets curious about cute icons.",
    shinyHue: 150
  });
  add({
    id: "crystalcarp",
    name: "Crystal Carp",
    biome: "abyss",
    rarity: "epic",
    size: [30, 70],
    weight: [3, 12],
    look: {
      body: { len: 58, h: 26, shape: "oval", hump: 0.14, nose: 1.9, tip: 0.24 },
      col: { body: "#8ae8ff", belly: "#e0faff", back: "#3a9ad8", fin: "#c8a8ff" },
      shade: { back: -0.3, belly: 0.35 },
      spec: 1.4,
      pattern: [{ type: "facets", color: "#e8fbff", size: 7, glow: true, tone: 0.9 }],
      tail: { type: "fork", len: 18, spread: 14, color: "#d8c8ff" },
      dorsal: { type: "sail", from: 0.3, to: 0.64, h: 10 },
      anal: { type: "tri", from: 0.66, to: 0.82, h: 6 },
      pelvic: { from: 0.42, to: 0.5, h: 5 },
      pectoral: { len: 9 },
      eye: { r: 3.2, u: 0.14, iris: "#d058ff" },
      extras: [{ type: "whiskers", len: 8, count: 2, color: "#a8e8ff" }],
      scales: false,
      finAlpha: 0.7,
      contrast: 1.15
    },
    scale: 1,
    move: { style: "swim", speed: 9, burst: 40, agility: 2, depth: [0.4, 0.9], school: 0 },
    activity: "any",
    traits: { curiosity: 0.45, shyness: 0.65, greed: 0.3, aggression: 0 },
    bait: { golden: 2, lantern: 3, image: 2, calc: 2, blackhole: 1 },
    quirks: ["sparkle", "glow"],
    fight: { phases: ["timing", "dodge", "trace", "tension", "net"], power: 0.65, stamina: 11, tricks: ["jump", "fake", "glitch"], biteWindow: 0.4, nibbles: [2, 4], fakeBite: 0.3 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: true },
    sound: "bell",
    desc: "Grew facets after centuries in a cave full of glowing gems. Tinkles like a wind chime when it swims.",
    behavior: "Throws little rainbows in lantern light. Shatters into dodgeable shards of light when hooked.",
    shinyHue: 90
  });
  add({
    id: "noodle",
    name: "Noodle Eel",
    biome: "abyss",
    rarity: "epic",
    size: [80, 200],
    weight: [0.4, 1.5],
    look: {
      kind: "chain",
      toon: true,
      chain: { segs: 26, r: 5, head: "noodle" },
      col: { body: "#f8e0a0", belly: "#ffe8b8", fin: "#e8c070" },
      eye: { r: 2.4, iris: "#3a2418" },
      mouth: { type: "small" }
    },
    scale: 1,
    move: { style: "chain", speed: 12, burst: 45, agility: 5, depth: [0.2, 0.9], school: 0 },
    activity: "night",
    traits: { curiosity: 0.9, shyness: 0.2, greed: 0.6, aggression: 0.2 },
    bait: { sugar: 2, chat: 3, game: 2, bread: 2, music: 1 },
    quirks: ["noodle"],
    fight: { phases: ["unwrap", "tension", "unwrap", "trace", "net"], power: 0.55, stamina: 10, tricks: ["wrap", "fake", "dash"], biteWindow: 0.6, nibbles: [1, 3], fakeBite: 0.2 },
    spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
    sound: "boing",
    desc: "A single impossibly long noodle that came to life at the bottom of a soup bowl. Loves hugs. Hugs your cursor. Will not let go.",
    behavior: "Slurps through the water and ties itself around the mouse when excited. Circle to untangle.",
    shinyHue: 20
  });
  add({
    id: "manyeyes",
    name: "The Ancient Many-Eyed One",
    biome: "abyss",
    rarity: "legendary",
    size: [600, 1200],
    weight: [2e3, 9e3],
    look: {
      body: { len: 170, h: 70, shape: "blunt", hump: 0.12, belly: 0.1, tip: 0.45, nose: 2.6 },
      col: { body: "#2a3550", belly: "#4a5670", back: "#141a2c", fin: "#1e2c46" },
      shade: { back: -0.3, belly: 0.35 },
      pattern: [{ type: "speckle", density: 0.03, tone: 1.2 }, { type: "patches", color: "#1a2238", threshold: 0.62, freq: 0.08 }],
      mouth: { type: "fangs", w: 36, v: 0.35, sag: 0.05, rest: 0.22 },
      tail: { type: "lobe", len: 52, spread: 42 },
      dorsal: { type: "spiky", from: 0.24, to: 0.62, h: 28, count: 8 },
      dorsal2: { type: "round", from: 0.66, to: 0.82, h: 14 },
      anal: { type: "spiky", from: 0.6, to: 0.86, h: 16, count: 4 },
      pelvic: { from: 0.38, to: 0.48, h: 14 },
      pectoral: { len: 22, w: 0.45, v: 0.62 },
      eye: { type: "glow", r: 9, u: 0.12, v: -0.28, glow: "#ffd84a", iris: "#ffd84a" },
      moreEyes: GLOW_EYES.map(([u, v, r, g]) => ({ type: "glow", u, v, r, glow: g })),
      extras: [{ type: "barnacles", color: "#8a8a7a", density: 0.12 }, { type: "whiskers", len: 46, count: 3, color: "#3a4a6a", color2: "#6a7a9a" }],
      scales: true,
      scaleSize: 8,
      lateral: true
    },
    scale: 1,
    move: { style: "swim", speed: 6, burst: 30, agility: 1, depth: [0.4, 0.9], school: 0 },
    activity: "any",
    traits: { curiosity: 0.9, shyness: 0, greed: 0.5, aggression: 0.8 },
    bait: { relic: 3, blackhole: 2, lantern: 1 },
    quirks: ["manyeyes", "glow"],
    fight: { phases: ["dodge", "timing", "trace", "tension", "net"], power: 1, stamina: 24, tricks: ["spit", "ink", "dive", "glitch"], biteWindow: 0.5, nibbles: [3, 5], fakeBite: 0.2 },
    spawn: { weight: 1, weather: null, time: null, requires: "relic", hidden: true },
    sound: "roar",
    desc: "Older than the ocean's first screensaver. Every one of its eyes has seen your browser history.",
    behavior: "Rises only when an ancient relic is offered. All of its eyes follow your cursor. All of them.",
    shinyHue: 240
  });
  var GROW = {
    pixel: 1.75,
    loafer: 1.4,
    guppy: 1.3,
    briefcase: 1.2,
    spam: 1.2,
    lanternfish: 1.2,
    hatchet: 1.25,
    glitchminnow: 1.25,
    bitfish: 1.3,
    koi: 1.12,
    grouper: 1.12,
    usbfish: 1.08,
    gulper: 1.08,
    dragonfish: 1.1,
    ghostshark: 1.15,
    parrot: 1.15,
    betta: 1.2,
    sunfish: 1,
    bsod: 1,
    manyeyes: 1,
    shortcut: 1,
    clickcrab: 1.2,
    mechacrab: 1.2,
    purin: 1.25,
    seahorse: 1.12,
    floppyray: 1.2,
    binblob: 1.2,
    blobfish: 1.2,
    isopod: 1.2,
    glowjelly: 1.25,
    vampsquid: 1.15,
    dumbo: 1.2,
    cableeel: 1.2,
    noodle: 1.15
  };
  var GROW_KEYS = ["len", "h", "spread", "r", "w", "reach", "size", "spacing", "rx", "ry", "scaleSize", "spikes", "tentacles", "curl", "thick"];
  function grow(o, f, eyeF, key = "") {
    if (Array.isArray(o)) return o.map((v) => grow(v, f, eyeF, key));
    if (!o || typeof o !== "object") return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number" && GROW_KEYS.includes(k)) out[k] = +(v * (k === "r" && (key === "eye" || key === "moreEyes") ? f * eyeF : key === "tail" && (k === "len" || k === "spread") ? f * 1.12 : f)).toFixed(2);
      else if (typeof v === "object") out[k] = grow(v, f, eyeF, k);
      else out[k] = v;
    }
    return out;
  }
  for (const sp of S2) {
    const f = GROW[sp.id] ?? 1.3;
    if (f !== 1) sp.look = grow(sp.look, f, sp.look.kind ? 1 : 1.08);
  }
  var SPECIES = S2;
  var SPECIES_BY_ID = Object.fromEntries(S2.map((s) => [s.id, s]));
  var SPECIES_BY_BIOME = {
    shallows: S2.filter((s) => s.biome === "shallows"),
    junkyard: S2.filter((s) => s.biome === "junkyard"),
    abyss: S2.filter((s) => s.biome === "abyss")
  };

  // src/fishing/baitart.js
  var P2 = {
    k: "#14131c",
    d: "#5d6677",
    m: "#9aa6b8",
    l: "#d8e2ee",
    w: "#ffffff",
    r: "#e04a5a",
    R: "#ff8a9a",
    p: "#ff9ad0",
    P: "#c85a9a",
    g: "#ffd84a",
    G: "#b8860b",
    y: "#fff3a8",
    b: "#2a1a3a",
    v: "#7a4ad8",
    V: "#c8a8ff",
    c: "#4ac8ff",
    C: "#bff0ff",
    B: "#1a6ab8",
    n: "#c8945a",
    N: "#8a5a2a",
    s: "#f4e4c4",
    e: "#3a8a4a",
    E: "#7ad88a",
    o: "#2a6a3a",
    t: "#d8c8a0",
    T: "#8a7a5a",
    a: "#5affc8",
    A: "#c8fff0"
  };
  var HOOK = spriteFromAscii(`
..kkk..
.kmlmk.
.kk.kk.
..kmk..
..kmk..
..kmk..
..kmk..
k.kmk..
kmkmk..
kmlmk..
.kmmk..
..kk...
`, P2);
  var BAIT_SPRITES = {
    bread: spriteFromAscii(`
.kkkk.
knNNnk
knssnk
knssnk
.kkkk.
`, P2),
    worm: [spriteFromAscii(`
...kk...
..kpPk..
.kpk.kk.
.kPk.kpk
..kpkpPk
...kPpk.
....kk..
`, P2), spriteFromAscii(`
..kk....
.kpPk...
.kPk.kk.
..kpkpPk
..kPk.kk
.kpPk...
..kk....
`, P2)],
    golden: spriteFromAscii(`
..kkk..
.kygyk.
kygggGk
kgggGGk
kgGGGGk
.kGGGk.
..kkk..
`, P2),
    blackhole: spriteFromAscii(`
..kvvk..
.vVbbvk.
kVbkkbvk
vbkkkkbv
vbkkkkbv
kvbkkbVk
.kvbbVv.
..kvvk..
`, P2),
    flood: spriteFromAscii(`
...k...
..kck..
.kcCck.
kcCCcck
kcCccBk
kccccBk
.kcBBk.
..kkk..
`, P2),
    sugar: spriteFromAscii(`
kkkkk
kwwlk
kwlwk
klwwk
kkkkk
`, P2),
    chip: spriteFromAscii(`
.k.k.k.
kkkkkkk
kEeeeEk
kkeoekk
kEeeeEk
kkkkkkk
.k.k.k.
`, P2),
    popup: spriteFromAscii(`
kkkkkkkk
kBBBBrwk
kkkkkkkk
kwwwwwwk
kwgggwwk
kwwwwwwk
kkkkkkkk
`, P2),
    lantern: spriteFromAscii(`
..kkk..
.kAAAk.
kAaaaAk
kaaAaak
kAaaaAk
.kAAAk.
..kkk..
`, P2),
    relic: spriteFromAscii(`
..kkkk..
.kTttTk.
kTtaatTk
kttaAttk
kTtaatTk
.kTttTk.
..kkkk..
`, P2)
  };
  function baitSprite(type, t = 0) {
    const s = BAIT_SPRITES[type];
    if (Array.isArray(s)) return s[Math.floor(t * 4) % s.length];
    return s || BAIT_SPRITES.bread;
  }

  // src/fishing/minigames.js
  var PROMPT_Y = 26;
  function fightMove(F, dt, tx, ty, speed, acc = 6) {
    const f = F.fish;
    const dx = tx - f.x, dy = ty - f.y;
    const d = Math.hypot(dx, dy) || 1;
    f.vx = damp(f.vx, dx / d * speed, acc, dt);
    f.vy = damp(f.vy, dy / d * speed, acc, dt);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    F.confine();
  }
  function prompt(ctx2, F, text, color = "#ffffff") {
    const c = F.cursor;
    drawText(ctx2, text, Math.round(c.x), Math.round(c.y + PROMPT_Y), { align: "center", color, outline: "#0b1622", font: "normal" });
  }
  var TensionPhase = class {
    constructor(F, opts = {}) {
      this.F = F;
      this.name = "tension";
      const f = F.fish;
      this.stamina = opts.stamina ?? 1;
      this.lineLen = Math.max(40, dist(F.cursor.x, F.cursor.y, f.x, f.y));
      this.mode = "pull";
      this.modeT = rng.float(0.8, 1.6);
      this.dir = Math.atan2(f.y - F.cursor.y, f.x - F.cursor.x);
      this.trick = null;
      this.snapT = 0;
      this.slackT = 0;
      this.snag = null;
      this.hint = 0;
    }
    pickMode() {
      const F = this.F, sp = F.sp, power = F.power;
      const tricks = sp.fight?.tricks || [];
      if (this.mode === "pull") {
        this.mode = "rest";
        this.modeT = rng.float(0.7, 1.5) * (1.2 - power * 0.5);
      } else {
        this.mode = "pull";
        this.modeT = rng.float(1, 2.4) * (0.7 + power * 0.6);
        const away = Math.atan2(F.fish.y - F.cursor.y, F.fish.x - F.cursor.x);
        this.dir = away + rng.float(-1.1, 1.1);
        if (tricks.length && rng.chance(0.35 + power * 0.3)) this.startTrick(rng.pick(tricks));
      }
    }
    startTrick(kind) {
      const F = this.F, f = F.fish;
      const w = F.world;
      switch (kind) {
        case "dash":
        case "fake": {
          const d0 = this.dir;
          this.trick = { kind, t: 0, tele: 0.35, dur: 0.5, dir: kind === "fake" ? d0 + Math.PI + rng.float(-0.5, 0.5) : d0, teleDir: d0 };
          f.say(kind === "fake" ? "!" : "!!", 0.6);
          f.squashV -= 8;
          break;
        }
        case "dive":
          this.trick = { kind, t: 0, tele: 0.25, dur: 0.8, dir: Math.PI / 2 + rng.float(-0.3, 0.3) };
          f.say("arrow_d", 0.6);
          break;
        case "jump":
          if (w.surfaceY !== null && f.y - w.surfaceY < 140) this.trick = { kind, t: 0, phase: "rise", dur: 2 };
          break;
        case "wrap": {
          const icons = w.icons || [];
          let best = null, bd = 180;
          for (const r of icons) {
            const d = dist(r.x + r.w / 2, r.y + r.h / 2, f.x, f.y);
            if (d < bd) {
              bd = d;
              best = r;
            }
          }
          if (best) this.trick = { kind, t: 0, icon: best, dur: 2.6, ang: Math.atan2(f.y - best.y - best.h / 2, f.x - best.x - best.w / 2) };
          break;
        }
        case "hop": {
          const wins = w.windows || [];
          if (wins.length >= 1) this.trick = { kind, t: 0, dur: 2.2, from: rng.pick(wins), to: rng.pick(wins) };
          break;
        }
        case "glitch":
          this.trick = { kind, t: 0, dur: 0.6 };
          break;
        default:
          break;
      }
    }
    update(dt, inp) {
      const F = this.F, f = F.fish, c = F.cursor, power = F.power, st = F.stats;
      this.hint += dt;
      this.modeT -= dt;
      if (this.modeT <= 0 && !this.trick) this.pickMode();
      const holding = inp.down;
      let speed = this.mode === "pull" ? 45 + power * 95 : 14;
      let dir = this.dir;
      let spike = 0;
      const tr = this.trick;
      if (tr) {
        tr.t += dt;
        if (tr.kind === "dash" || tr.kind === "fake" || tr.kind === "dive") {
          if (tr.t < tr.tele) {
            dir = tr.teleDir ?? tr.dir;
            speed = 20;
            f.wiggle = 0.5;
          } else {
            dir = tr.dir;
            speed = 120 + power * 160;
            spike = 0.45;
          }
          if (tr.t > tr.tele + tr.dur) this.trick = null;
        } else if (tr.kind === "jump") {
          this.updateJump(dt, tr);
          if (tr.done) this.trick = null;
          return this.common(dt, inp, holding, 0, true);
        } else if (tr.kind === "wrap") {
          tr.ang += dt * 2.6;
          const r = tr.icon;
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.max(r.w, r.h) * 0.9;
          fightMove(F, dt, cx + Math.cos(tr.ang) * rad, cy + Math.sin(tr.ang) * rad, 140, 8);
          if (tr.t > tr.dur) this.trick = null;
          return this.common(dt, inp, holding, 0.1, false);
        } else if (tr.kind === "hop") {
          this.updateHop(dt, tr);
          if (tr.done) this.trick = null;
          return this.common(dt, inp, holding, 0.05, false);
        } else if (tr.kind === "glitch") {
          if (tr.t > 0.25 && !tr.jumped) {
            tr.jumped = true;
            F.world.particles?.burst(f.x, f.y, 14, { colors: ["#ff3a7a", "#3affd8", "#ffffff"], speed: 60, g: 0, life: 0.4, size: 2 });
            f.x += rng.float(-60, 60);
            f.y += rng.float(-40, 40);
            F.confine();
            F.world.audio?.play("glitch");
            spike = 0.3;
          }
          if (tr.t > tr.dur) this.trick = null;
        }
      }
      const tx = f.x + Math.cos(dir) * 60, ty = f.y + Math.sin(dir) * 60;
      fightMove(F, dt, tx, ty, speed, 5);
      return this.common(dt, inp, holding, spike, false);
    }
    common(dt, inp, holding, spike, airborne) {
      const F = this.F, f = F.fish, c = F.cursor, st = F.stats, power = F.power;
      const d = dist(c.x, c.y, f.x, f.y);
      let snagMul = 1;
      this.snag = null;
      if (!airborne) {
        for (const r of F.world.icons || []) {
          if (segmentHitsRect(c.x, c.y, f.x, f.y, { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6 })) {
            this.snag = r;
            break;
          }
        }
      }
      if (this.snag) {
        snagMul = 0.25;
        spike += 0.2;
        this.snag.shake = 0.3;
      }
      if (holding && !airborne) this.lineLen = Math.max(14, this.lineLen - st.reelSpeed * snagMul * dt * (this.tension > 0.95 ? 0.2 : 1));
      let pullAway = 0;
      if (d > this.lineLen) {
        const over = d - this.lineLen;
        const nx = (f.x - c.x) / d, ny = (f.y - c.y) / d;
        if (holding) {
          f.x -= nx * over * 0.85;
          f.y -= ny * over * 0.85;
          pullAway = clamp01(over / 6);
        } else {
          this.lineLen = d;
          pullAway = 0.25;
        }
      }
      const fvx = f.vx, fvy = f.vy;
      const fs = Math.hypot(fvx, fvy) || 1;
      const cs = c.speed;
      const against = cs > 20 ? clamp(-(c.vx * fvx + c.vy * fvy) / (fs * cs), -1, 1) : 0;
      const counter = Math.max(0, against) * clamp01(cs / 220);
      const struggle = this.mode === "pull" ? 1 : 0.3;
      let target = holding ? 0.32 + struggle * 0.33 * (0.6 + power * 0.6) + pullAway * 0.3 : 0.06 + struggle * 0.18 + pullAway * 0.2;
      target += spike + counter * 0.12;
      if (airborne) target = 0.02;
      target /= st.lineStrength;
      this.tension = this.tension === void 0 ? 0.3 : this.tension;
      const rate = target > this.tension ? 3.2 : 4.5;
      this.tension = clamp(damp(this.tension, target, rate, dt), 0, 1.2);
      const T = this.tension;
      F.tension = T;
      if (holding && T > 0.22 && T < 0.92 && !airborne) {
        const stam = (F.sp.fight?.stamina ?? 5) * (0.8 + power * 0.4);
        this.stamina -= dt / stam * (1 + counter * 1.6) * st.staminaDrain * (this.snag ? 0.4 : 1);
      }
      if (T >= 1) this.snapT += dt;
      else this.snapT = Math.max(0, this.snapT - dt * 2);
      if (this.snapT > st.snapGrace) return "snap";
      if (T < 0.1 && this.mode === "pull" && !airborne) this.slackT += dt;
      else this.slackT = Math.max(0, this.slackT - dt);
      if (this.slackT > st.slackGrace) return "throw";
      if (this.slackT > st.slackGrace * 0.5 && !this.warnedSlack) {
        this.warnedSlack = true;
        F.world.audio?.play("slack_warn");
      }
      if (this.slackT === 0) this.warnedSlack = false;
      f.feel(T > 0.8 ? "angry" : this.mode === "pull" ? "determined" : "tired", 0.3);
      if (this.stamina <= 0) return "win";
      return "ok";
    }
    updateJump(dt, tr) {
      const F = this.F, f = F.fish, w = F.world;
      const sy = w.surfaceY;
      if (tr.phase === "rise") {
        fightMove(F, dt, f.x + f.facing * 30, sy - 10, 180, 10, true);
        if (f.y < sy + 4) {
          tr.phase = "air";
          tr.vy = -rng.float(140, 200);
          tr.vx = f.facing * rng.float(30, 70);
          F.world.particles?.splash(f.x, sy, 0.8);
          F.world.audio?.play("jump_out");
          f.feel("happy", 1);
        }
      } else if (tr.phase === "air") {
        tr.vy += 380 * dt;
        f.x += tr.vx * dt;
        f.y += tr.vy * dt;
        f.forceAngle = clamp(Math.atan2(tr.vy, Math.abs(tr.vx)), -1.2, 1.2);
        if (f.y > sy && tr.vy > 0) {
          tr.phase = "down";
          F.world.particles?.splash(f.x, sy, 1);
          F.world.audio?.play("splash_small");
          f.forceAngle = void 0;
          if (F.input.down) this.tension = Math.min(1.15, (this.tension || 0) + 0.55);
        }
      } else {
        tr.t2 = (tr.t2 || 0) + dt;
        if (tr.t2 > 0.3) tr.done = true;
      }
    }
    updateHop(dt, tr) {
      const F = this.F, f = F.fish;
      const a = tr.from, b = tr.to;
      if (!tr.stage) tr.stage = "in";
      if (tr.stage === "in") {
        fightMove(F, dt, a.x + a.w / 2, a.y + a.h / 2, 160, 8);
        if (rectHas(a, f.x, f.y) && tr.t > 0.3) {
          tr.stage = "under";
          tr.ut = 0.6;
        }
        if (tr.t > 1.4) tr.done = true;
      } else if (tr.stage === "under") {
        tr.ut -= dt;
        if (tr.ut <= 0) {
          f.x = b.x + rng.float(10, b.w - 10);
          f.y = b.y + rng.float(10, b.h - 10);
          tr.stage = "out";
          tr.ot = 0.6;
          tr.exitDir = rng.float(0, TAU);
        }
      } else {
        tr.ot -= dt;
        fightMove(F, dt, f.x + Math.cos(tr.exitDir) * 80, f.y + Math.sin(tr.exitDir) * 80, 150, 8);
        if (tr.ot <= 0) tr.done = true;
      }
    }
    draw(ctx2) {
      if (this.snag) {
        const r = this.snag;
        const t = performance.now() / 1e3;
        ctx2.fillStyle = rgba("#ff5a5a", 0.5 + 0.3 * Math.sin(t * 12));
        ctx2.fillRect(r.x - 1, r.y - 1, r.w + 2, 1);
        ctx2.fillRect(r.x - 1, r.y + r.h, r.w + 2, 1);
        ctx2.fillRect(r.x - 1, r.y, 1, r.h);
        ctx2.fillRect(r.x + r.w, r.y, 1, r.h);
      }
    }
    drawHud(ctx2) {
      const F = this.F;
      F.drawStamina(ctx2, this.stamina);
      F.drawTensionGauge(ctx2, F.tension ?? 0);
      if (this.snag) prompt(ctx2, F, "SNAGGED! Go around the icon", "#ff9a8a");
      else if (this.trick?.kind === "jump") prompt(ctx2, F, "It jumped! Let go before it lands!", "#ffe27a");
      else if ((F.tension ?? 0) > 0.85) prompt(ctx2, F, "Too tight! Let go!", "#ff8a7a");
      else if (this.slackT > 0.4) prompt(ctx2, F, "Slack line! Hold to reel!", "#9ad8ff");
      else if (this.hint < 4 || F.tutorial) prompt(ctx2, F, "{mouse_hold} Hold to reel - pull AGAINST its swim", "#ffffff");
    }
  };
  function rectHas(r, x, y) {
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }
  var PATHS = {
    figure8: (t) => [Math.sin(t), Math.sin(t * 2) * 0.5],
    circle: (t) => [Math.cos(t), Math.sin(t) * 0.7],
    zigzag: (t) => [Math.sin(t * 0.5) * 1.1, (Math.abs(t * 0.8 % 2 - 1) - 0.5) * 1.2],
    wave: (t) => [Math.sin(t * 0.45) * 1.2, Math.sin(t * 2.2) * 0.4],
    spiral: (t) => {
      const r = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.25));
      return [Math.cos(t) * r, Math.sin(t) * r * 0.8];
    },
    clover: (t) => {
      const r = Math.cos(2 * t);
      return [Math.cos(t) * r, Math.sin(t) * r];
    }
  };
  var TracePhase = class {
    constructor(F) {
      this.F = F;
      this.name = "trace";
      const f = F.fish;
      const w = F.world;
      this.kind = rng.pick(Object.keys(PATHS));
      this.cx = clamp(f.x, 120, w.W - 120);
      this.cy = clamp(f.y, (w.surfaceY ?? 0) + 70, w.floorAt(f.x) - 70);
      this.rx = rng.float(70, 120);
      this.ry = rng.float(45, 70);
      this.t = 0;
      this.speed = 0.9 + F.power * 0.9;
      this.progress = 0;
      this.outT = 0;
      this.radius = (24 - F.power * 7) * F.stats.traceRadius;
      this.inside = false;
      this.lead = 1.2;
    }
    pos(t) {
      const [u, v] = PATHS[this.kind](t);
      return [this.cx + u * this.rx, this.cy + v * this.ry];
    }
    update(dt, inp) {
      const F = this.F, f = F.fish, c = F.cursor;
      const ease2 = Math.min(1, this.t * 0.6 + 0.2);
      this.t += dt * this.speed * ease2;
      const [tx, ty] = this.pos(this.t);
      fightMove(F, dt, tx, ty, 260, 12);
      this.inside = dist(c.x, c.y, f.x, f.y) < this.radius;
      if (this.inside) {
        this.progress += dt / (3.2 + F.power * 3);
        F.tension = 0.45;
        f.feel("tired", 0.2);
      } else {
        this.progress = Math.max(0, this.progress - dt * 0.12);
        this.outT += dt;
        F.tension = Math.min(1, 0.5 + this.outT * 0.15);
        f.feel("smug", 0.2);
      }
      if (this.outT > 3.6 * F.stats.traceForgive) return "escape";
      if (this.progress >= 1) return "win";
      return "ok";
    }
    draw(ctx2) {
      const F = this.F, f = F.fish;
      for (let i = 1; i <= 26; i++) {
        const [x, y] = this.pos(this.t + i * 0.07 * this.speed);
        if (i % 2) continue;
        ctx2.fillStyle = rgba("#e8fcff", 0.75 - i * 0.025);
        ctx2.fillRect(Math.round(x), Math.round(y), 2, 2);
      }
      const r = Math.round(this.radius + Math.sin(performance.now() / 120) * 1.5);
      drawCircle(ctx2, f.x, f.y, r, this.inside ? "#7dff9a" : "#ff7a7a", 0.9);
      drawCircle(ctx2, f.x, f.y, r - 2, this.inside ? "#2a8a4a" : "#8a2a2a", 0.4);
    }
    drawHud(ctx2) {
      const F = this.F;
      F.drawStamina(ctx2, 1 - this.progress, "#7dff9a");
      prompt(ctx2, F, this.inside ? "Follow it!" : "{arrow_r} Keep your hook inside the ring!", this.inside ? "#b8ffc8" : "#ffd2c8");
    }
  };
  var MashPhase = class {
    constructor(F) {
      this.F = F;
      this.name = "mash";
      this.progress = 0.08;
      this.time = 6.5 + (1 - F.power) * 2;
      this.t = 0;
      this.combo = 0;
      this.anchor = { x: F.fish.x, y: F.fish.y };
    }
    update(dt, inp) {
      const F = this.F, f = F.fish;
      this.t += dt;
      this.progress = Math.max(0, this.progress - dt * (0.1 + F.power * 0.12));
      if (inp.clicks > 0) {
        for (let i = 0; i < inp.clicks; i++) {
          this.progress += 0.075 * F.stats.mashPower / (0.6 + F.power * 0.8);
          this.combo++;
          f.squashV += 6;
          f.x += (F.cursor.x - f.x) * 0.04;
          f.y += (F.cursor.y - f.y) * 0.04;
          F.world.audio?.play("mash_pop", { pitch: 0.8 + Math.min(1, this.combo * 0.04) });
          F.world.particles?.burst(f.x, f.y, 4, { colors: ["#ffffff", "#ffe27a"], speed: 50, g: 0, life: 0.3 });
        }
      }
      f.x = damp(f.x, this.anchor.x + Math.sin(this.t * 31) * 2, 8, dt);
      f.y = damp(f.y, this.anchor.y + Math.cos(this.t * 27) * 1.5, 8, dt);
      f.feel(this.progress > 0.6 ? "scared" : "angry", 0.2);
      F.tension = 0.5 + 0.3 * Math.sin(this.t * 20);
      if (this.progress >= 1) return "win";
      if (this.t > this.time) return this.progress > 0.5 ? "win" : "escape";
      return "ok";
    }
    draw() {
    }
    drawHud(ctx2) {
      const F = this.F, f = F.fish;
      const w = 50, x = Math.round(f.x - w / 2), y = Math.round(f.y - 26 * f.scale - 10);
      ctx2.fillStyle = "#0b1622";
      ctx2.fillRect(x - 1, y - 1, w + 2, 6);
      ctx2.fillStyle = "#3a2a1a";
      ctx2.fillRect(x, y, w, 4);
      ctx2.fillStyle = this.progress > 0.7 ? "#7dff9a" : "#ffd25a";
      ctx2.fillRect(x, y, Math.round(w * clamp01(this.progress)), 4);
      const left = Math.max(0, this.time - this.t);
      drawText(ctx2, "MASH CLICK!", f.x, y - 12, { align: "center", color: "#ffe27a", outline: "#0b1622", wave: 1, time: this.t });
      drawText(ctx2, left.toFixed(1) + "s", f.x, y + 7, { align: "center", font: "small", color: "#ffffff", outline: "#0b1622" });
    }
  };
  var TimingPhase = class {
    constructor(F) {
      this.F = F;
      this.name = "timing";
      this.need = 3 + Math.round(F.power * 3);
      this.hits = 0;
      this.misses = 0;
      this.allowed = F.stats.timingMisses;
      this.beat = 1.15 - F.power * 0.45;
      this.t = -0.4;
      this.target = 14;
      this.flash = null;
      this.home = { x: F.fish.x, y: F.fish.y };
    }
    ring() {
      const k = this.t / this.beat;
      return lerp(46, 0, k);
    }
    update(dt, inp) {
      const F = this.F, f = F.fish;
      this.t += dt;
      if (this.flash) {
        this.flash.t += dt;
        if (this.flash.t > 0.4) this.flash = null;
      }
      fightMove(F, dt, this.home.x + Math.sin(this.t * 3) * 20, this.home.y + Math.cos(this.t * 2.3) * 10, 90, 6);
      F.tension = 0.4;
      const r = this.ring();
      const win = 5 * F.stats.timingWindow;
      if (inp.pressed) {
        const err = Math.abs(r - this.target);
        if (this.t > 0 && err < win) {
          const perfect = err < win * 0.4;
          this.hits++;
          this.flash = { text: perfect ? "PERFECT!" : "GOOD!", color: perfect ? "#ffe27a" : "#9affb8", t: 0 };
          F.world.audio?.play(perfect ? "timing_perfect" : "timing_good");
          f.squashV += 10;
          f.feel("scared", 0.5);
          F.world.particles?.burst(f.x, f.y, perfect ? 12 : 7, { colors: ["#ffe27a", "#ffffff"], speed: 70, g: 0, life: 0.5 });
          this.t = -0.25;
        } else {
          this.miss();
        }
      } else if (r < this.target - win) {
        this.miss();
      }
      if (this.hits >= this.need) return "win";
      if (this.misses > this.allowed) return "escape";
      return "ok";
    }
    miss() {
      this.misses++;
      this.flash = { text: "MISS", color: "#ff8a7a", t: 0 };
      this.F.world.audio?.play("timing_miss");
      this.F.fish.feel("smug", 0.6);
      this.t = -0.35;
    }
    draw(ctx2) {
      const f = this.F.fish;
      drawCircle(ctx2, f.x, f.y, this.target, "#ffffff", 0.9);
      if (this.t > 0) drawCircle(ctx2, f.x, f.y, Math.max(1, Math.round(this.ring())), "#ffe27a", 0.95);
    }
    drawHud(ctx2) {
      const F = this.F, f = F.fish;
      const y = Math.round(f.y - 30 * f.scale - 14);
      for (let i = 0; i < this.need; i++) {
        ctx2.fillStyle = i < this.hits ? "#ffe27a" : "#2a3a4a";
        ctx2.fillRect(Math.round(f.x - this.need * 4 + i * 8), y, 6, 3);
      }
      if (this.flash) drawText(ctx2, this.flash.text, f.x, y - 12 - this.flash.t * 10, { align: "center", color: this.flash.color, outline: "#0b1622" });
      prompt(this.ctxFix || ctx2, F, "{mouse_l} Click when the rings meet!", "#ffffff");
    }
  };
  var DodgePhase = class {
    constructor(F) {
      this.F = F;
      this.name = "dodge";
      this.dur = 6 + F.power * 3;
      this.t = 0;
      this.progress = 0;
      this.shots = [];
      this.fireT = 0.8;
      this.hits = 0;
      this.allowed = F.stats.dodgeHits;
      this.stun = 0;
      const kind = F.sp.fight?.projectile || (F.sp.biome === "junkyard" ? "bolt" : F.sp.biome === "abyss" ? "ink" : "bubble");
      this.kind = kind;
      this.home = { x: F.fish.x, y: F.fish.y };
    }
    update(dt, inp) {
      const F = this.F, f = F.fish, c = F.cursor;
      this.t += dt;
      this.stun = Math.max(0, this.stun - dt);
      fightMove(F, dt, this.home.x + Math.sin(this.t * 1.3) * 40, this.home.y + Math.sin(this.t * 2.1) * 20, 80, 5);
      f.lookAt(c.x, c.y);
      f.feel("angry", 0.2);
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = rng.float(0.45, 1) * (1.2 - F.power * 0.5);
        const lead = 0.25;
        const tx = c.x + c.vx * lead, ty = c.y + c.vy * lead;
        const a = Math.atan2(ty - f.y, tx - f.x) + rng.float(-0.1, 0.1);
        const sp = 140 + F.power * 90;
        this.shots.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0 });
        f.talkT = 0.2;
        F.world.audio?.play(this.kind === "bolt" ? "click" : "blub", { pitch: 1.4 });
      }
      for (const s of this.shots) {
        s.t += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (!s.dead && dist(s.x, s.y, c.x, c.y) < 6) {
          s.dead = true;
          this.hits++;
          this.stun = 0.6;
          F.world.audio?.play("dodge_hit");
          F.shake(3);
          F.world.particles?.burst(c.x, c.y, 10, { colors: ["#ffffff", "#ff8a7a"], speed: 60, g: 0, life: 0.4 });
        }
      }
      this.shots = this.shots.filter((s) => !s.dead && s.t < 3);
      if (inp.down && !this.stun) this.progress += dt / this.dur;
      F.tension = this.stun ? 0.95 : inp.down ? 0.55 : 0.2;
      if (this.hits > this.allowed) return "snap";
      if (this.progress >= 1) return "win";
      return "ok";
    }
    draw(ctx2) {
      for (const s of this.shots) {
        const x = Math.round(s.x), y = Math.round(s.y);
        if (this.kind === "bolt") {
          ctx2.fillStyle = "#9aa4b8";
          ctx2.fillRect(x - 2, y - 1, 5, 3);
          ctx2.fillStyle = "#e8eef8";
          ctx2.fillRect(x - 1, y - 1, 2, 1);
          ctx2.fillStyle = "#4a5468";
          ctx2.fillRect(x - 2, y + 1, 5, 1);
        } else if (this.kind === "ink") {
          ctx2.fillStyle = "#140a1e";
          ctx2.fillRect(x - 3, y - 2, 6, 5);
          ctx2.fillRect(x - 2, y - 3, 4, 7);
          ctx2.fillStyle = "#3a2a5a";
          ctx2.fillRect(x - 1, y - 2, 2, 1);
        } else if (this.kind === "spark") {
          ctx2.fillStyle = "#fff6a0";
          ctx2.fillRect(x - 1, y - 1, 3, 3);
          ctx2.fillStyle = "#ffb02a";
          ctx2.fillRect(x - 2, y, 1, 1);
          ctx2.fillRect(x + 2, y, 1, 1);
        } else {
          ctx2.fillStyle = "#cfefff";
          ctx2.fillRect(x - 2, y - 3, 5, 7);
          ctx2.fillRect(x - 3, y - 2, 7, 5);
          ctx2.fillStyle = "#4aa8d8";
          ctx2.fillRect(x - 1, y - 1, 3, 3);
          ctx2.fillStyle = "#ffffff";
          ctx2.fillRect(x - 2, y - 2, 1, 1);
        }
      }
    }
    drawHud(ctx2) {
      const F = this.F;
      F.drawStamina(ctx2, 1 - this.progress, "#9ad8ff");
      let hearts = "";
      for (let i = 0; i <= this.allowed; i++) hearts += i < this.allowed + 1 - this.hits ? "{heart}" : "{heart_empty}";
      drawText(ctx2, hearts, F.cursor.x, F.cursor.y - 30, { align: "center" });
      prompt(ctx2, F, this.stun ? "Ouch!" : "{mouse_hold} Hold to reel - DODGE the shots!", this.stun ? "#ff8a7a" : "#ffffff");
    }
  };
  var UnwrapPhase = class {
    constructor(F) {
      this.F = F;
      this.name = "unwrap";
      this.dir = rng.sign();
      this.need = TAU * (2 + F.power * 2);
      this.progress = 0;
      this.time = 10;
      this.t = 0;
      this.prevA = null;
      this.center = { x: F.cursor.x, y: F.cursor.y };
      this.coil = 0;
    }
    update(dt, inp) {
      const F = this.F, f = F.fish, c = F.cursor;
      this.t += dt;
      this.center.x = damp(this.center.x, c.x, 1.5, dt);
      this.center.y = damp(this.center.y, c.y, 1.5, dt);
      const a = Math.atan2(c.y - this.center.y, c.x - this.center.x);
      const r = dist(c.x, c.y, this.center.x, this.center.y);
      if (this.prevA !== null && r > 6) {
        let da = a - this.prevA;
        if (da > Math.PI) da -= TAU;
        if (da < -Math.PI) da += TAU;
        this.progress = clamp(this.progress + da * this.dir, 0, this.need);
      }
      this.prevA = a;
      this.coil += dt * 3 * -this.dir;
      const rad = 18 * (1 - this.progress / this.need) + 8;
      f.x = c.x + Math.cos(this.coil) * rad;
      f.y = c.y + Math.sin(this.coil) * rad * 0.8;
      f.vx = -Math.sin(this.coil) * 40 * -this.dir;
      f.vy = Math.cos(this.coil) * 40 * -this.dir;
      f.allowTurn = true;
      f.feel(this.progress > this.need * 0.6 ? "dizzy" : "smug", 0.2);
      F.tension = 0.5;
      if (this.progress >= this.need) return "win";
      if (this.t > this.time) return "escape";
      return "ok";
    }
    draw(ctx2) {
      const F = this.F, c = F.cursor;
      const t = performance.now() / 1e3;
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU + t * 3 * this.dir;
        ctx2.fillStyle = rgba("#ffe27a", i / 10);
        ctx2.fillRect(Math.round(c.x + Math.cos(a) * 30), Math.round(c.y + Math.sin(a) * 30), 2, 2);
      }
    }
    drawHud(ctx2) {
      const F = this.F;
      F.drawStamina(ctx2, 1 - this.progress / this.need, "#ffe27a");
      prompt(ctx2, F, `It's wrapped around you! Circle ${this.dir > 0 ? "clockwise" : "counter-clockwise"}!`, "#ffe27a");
    }
  };
  var NetPhase = class {
    constructor(F) {
      this.F = F;
      this.name = "net";
      this.time = 9 * F.stats.netTime;
      this.t = 0;
      this.path = [];
      this.drawing = false;
      this.fail = null;
      this.home = { x: F.fish.x, y: F.fish.y };
      this.caught = false;
    }
    update(dt, inp) {
      const F = this.F, f = F.fish, c = F.cursor;
      this.t += dt;
      if (this.fail) {
        this.fail.t += dt;
        if (this.fail.t > 0.8) this.fail = null;
      }
      this.home.y = damp(this.home.y, Math.min(this.home.y, F.world.floorAt(f.x) - 30), 1, dt);
      fightMove(F, dt, this.home.x + Math.sin(this.t * 0.8) * 12, this.home.y + Math.sin(this.t * 1.7) * 4, 25, 3);
      f.feel("dizzy", 0.2);
      F.tension = 0.2;
      if (inp.pressed) {
        this.drawing = true;
        this.path = [[c.x, c.y]];
      }
      if (this.drawing) {
        const last = this.path[this.path.length - 1];
        if (dist(last[0], last[1], c.x, c.y) > 3) this.path.push([c.x, c.y]);
        const closed = this.path.length > 12 && dist(this.path[0][0], this.path[0][1], c.x, c.y) < 14 * F.stats.netTolerance;
        if (inp.released || closed) {
          this.drawing = false;
          if (this.check()) return "win";
          this.path = [];
          this.fail = { t: 0 };
          F.world.audio?.play("timing_miss");
        }
      }
      if (this.t > this.time) return "recover";
      return "ok";
    }
    check() {
      const F = this.F, f = F.fish;
      if (this.path.length < 8) return false;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, len = 0;
      for (let i = 0; i < this.path.length; i++) {
        const [x, y] = this.path[i];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (i) len += dist(x, y, this.path[i - 1][0], this.path[i - 1][1]);
      }
      const tol = F.stats.netTolerance;
      const size = Math.max(10, 16 * f.scale);
      if (maxX - minX < size * 0.8 / tol || maxY - minY < size * 0.5 / tol) return false;
      if (maxX - minX > 360) return false;
      const poly = this.path;
      const pts = [[f.x, f.y], [f.x - 4 * tol, f.y], [f.x + 4 * tol, f.y]];
      const hits = pts.filter(([x, y]) => pointInPoly(x, y, poly)).length;
      return hits >= (tol > 1.2 ? 1 : 2);
    }
    draw(ctx2) {
      const F = this.F, f = F.fish;
      const t = this.t;
      const r = Math.round(18 * f.scale + 6 + Math.sin(t * 5) * 2);
      for (let i = 0; i < 24; i++) {
        if (i % 2) continue;
        const a = i / 24 * TAU + t;
        ctx2.fillStyle = rgba("#ffffff", 0.6);
        ctx2.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r * 0.75), 2, 2);
      }
      for (let i = 1; i < this.path.length; i++) {
        const [x0, y0] = this.path[i - 1], [x1, y1] = this.path[i];
        const steps = Math.max(1, Math.ceil(dist(x0, y0, x1, y1)));
        for (let k = 0; k < steps; k++) {
          const x = Math.round(lerp(x0, x1, k / steps)), y = Math.round(lerp(y0, y1, k / steps));
          ctx2.fillStyle = (x + y) % 4 < 2 ? "#e8d2a0" : "#9a7a4a";
          ctx2.fillRect(x, y, 2, 2);
        }
      }
    }
    drawHud(ctx2) {
      const F = this.F;
      const left = Math.max(0, this.time - this.t);
      if (this.fail) prompt(ctx2, F, "Missed! Circle the WHOLE fish!", "#ff8a7a");
      else prompt(ctx2, F, `{net} Draw a circle around it! ${left.toFixed(1)}s`, "#ffe27a");
    }
  };
  function drawCircle(ctx2, cx, cy, r, color, a = 1) {
    ctx2.fillStyle = rgba(color, a);
    const n = Math.max(12, Math.round(r * 4));
    let px = null, py = null;
    for (let i = 0; i < n; i++) {
      const ang = i / n * TAU;
      const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
      if (x === px && y === py) continue;
      ctx2.fillRect(x, y, 1, 1);
      px = x;
      py = y;
    }
  }
  var PHASES = {
    tension: TensionPhase,
    trace: TracePhase,
    mash: MashPhase,
    timing: TimingPhase,
    dodge: DodgePhase,
    unwrap: UnwrapPhase,
    net: NetPhase
  };

  // src/fishing/fishing.js
  var Fishing = class {
    constructor(game) {
      this.game = game;
      this.world = game.world;
      this.state = "idle";
      this.t = 0;
      this.hook = { x: -50, y: -50, angle: 0, av: 0, dip: 0, visible: false };
      this.rodX = 0;
      this.baitSwing = 0;
      this.baitSwingV = 0;
      this.fish = null;
      this.fight = null;
      this.tension = 0;
      this.msg = null;
      this.wasInWater = false;
      this.jig = 0;
      this.cursor = game.world.cursor;
      this.input = game.input;
      this.lineSnap = null;
      this.focus = 0;
    }
    get stats() {
      return this.game.stats;
    }
    get busy() {
      return this.state !== "idle";
    }
    get fighting() {
      return this.state === "fight" || this.state === "landing";
    }
    // Called by fish AI when it wants to start nibbling.
    requestNibble(fish) {
      if (this.state !== "idle" || !this.world.hook.active) return false;
      this.fish = fish;
      fish.controlled = true;
      fish.allowTurn = true;
      this.state = "nibble";
      const sp = fish.sp;
      const [n0, n1] = sp.fight?.nibbles || [1, 3];
      this.nibblesLeft = rng.int(n0, n1);
      this.nibbleT = rng.float(0.35, 0.8);
      this.nibblePhase = 0;
      this.fakeBite = rng.chance(sp.fight?.fakeBite ?? 0.15);
      this.anchorX = this.hook.x;
      this.anchorY = this.hook.y;
      return true;
    }
    releaseFish(flee = true, emote = null) {
      const f = this.fish;
      if (f) {
        f.controlled = false;
        f.allowTurn = false;
        f.forceAngle = void 0;
        f.cooldown = rng.float(10, 20);
        if (flee) {
          f.startle(this.hook.x, this.hook.y);
          f.setState("leave");
          f.cruise *= 1.8;
        }
        if (emote) f.say(emote, 1.5);
      }
      this.fish = null;
      this.fight = null;
      this.state = "idle";
    }
    message(text, color = "#ffffff", time = 1.6, big = false) {
      this.msg = { text, color, t: 0, max: time, big };
    }
    shake(n) {
      this.game.camera.shake(n);
    }
    confine() {
      const f = this.fish, w = this.world;
      const top = (w.surfaceY ?? -1e3) + 6;
      f.x = clamp(f.x, 12, w.W - 12);
      if (!(this.fight?.phase?.trick?.kind === "jump")) f.y = clamp(f.y, top, w.floorAt(f.x) - 8);
    }
    // ------------------------------------------------------------------ update
    update(dt, worldInput) {
      this.t += dt;
      const g = this.game, w = this.world, inp = this.input, c = this.cursor, h = this.hook;
      if (this.msg) {
        this.msg.t += dt;
        if (this.msg.t > this.msg.max) this.msg = null;
      }
      if (this.lineSnap) {
        this.lineSnap.t += dt;
        if (this.lineSnap.t > 0.6) this.lineSnap = null;
      }
      this.jig = Math.max(0, this.jig - dt * 0.6);
      w.jig = this.jig;
      const canHook = worldInput && !g.paused && !g.fishingDisabled;
      if (this.state === "idle" || this.state === "nibble" || this.state === "bite") {
        if (canHook) {
          h.visible = true;
          const px = h.x;
          h.x = c.x;
          h.y = c.y + h.dip;
          h.av += ((px - h.x) * 0.02 - h.angle * 9 - h.av * 2.5) * dt * 10;
        } else if (this.state === "idle") {
          h.visible = false;
        }
      }
      h.angle = clamp(h.angle + h.av * dt, -0.9, 0.9);
      h.dip = damp(h.dip, 0, 6, dt);
      this.rodX = damp(this.rodX, h.x, 2.2, dt);
      this.baitSwingV += (-(h.x - (this.prevHX ?? h.x)) * 1.5 - this.baitSwing * 30 - this.baitSwingV * 4) * dt;
      this.baitSwing = clamp(this.baitSwing + this.baitSwingV * dt * 10, -0.8, 0.8);
      this.prevHX = h.x;
      const inWater = h.visible && (w.surfaceY === null || h.y > w.surfaceY + 2);
      if (inWater && !this.wasInWater && h.visible && w.surfaceY !== null && this.state === "idle") {
        g.audio.play("cast", { vol: 0.6 });
        g.particles.splash(h.x, w.surfaceY, 0.25);
        g.state.stats.casts++;
      }
      this.wasInWater = inWater;
      const bait = g.currentBait();
      w.hook.x = h.x;
      w.hook.y = h.y;
      w.hook.active = h.visible && canHook && this.state === "idle";
      w.hook.inWater = inWater;
      w.hook.bait = bait;
      w.hook.radiusMul = this.stats.baitRadius;
      switch (this.state) {
        case "idle":
          if (canHook && inWater && inp.pressed && !g.ui.blocking) {
            h.dip = -5;
            h.av += rng.float(-3, 3);
            this.jig = Math.min(1.5, this.jig + 0.35);
            g.audio.play("bubble", { vol: 0.4, pitch: rng.float(1, 1.4) });
            g.particles.bubbles(h.x, h.y, 3);
          }
          break;
        case "nibble":
          this.updateNibble(dt, canHook);
          break;
        case "bite":
          this.updateBite(dt, canHook);
          break;
        case "fight":
          this.updateFight(dt);
          break;
        case "landing":
          this.updateLanding(dt);
          break;
        default:
          break;
      }
    }
    updateNibble(dt, canHook) {
      const f = this.fish, h = this.hook, g = this.game, inp = this.input;
      if (!f || !canHook || !this.world.hook.inWater) {
        this.releaseFish(true);
        return;
      }
      if (this.cursor.speed > 260 * this.stats.calm) {
        this.message("Too fast! It got spooked.", "#ffb0a0");
        this.releaseFish(true);
        return;
      }
      const side = f.x < h.x ? -1 : 1;
      const mouthOff = 9 * f.scale + 4;
      this.nibbleT -= dt;
      let tx = h.x + side * (mouthOff + 6), ty = h.y + 1;
      if (this.nibblePhase > 0) {
        this.nibblePhase -= dt;
        tx = h.x + side * mouthOff;
        if (this.nibblePhase <= 0.08 && !this.nibbled) {
          this.nibbled = true;
          h.dip = 3 + rng.float(0, 2);
          h.av += rng.float(-2, 2);
          f.chompT = 0.15;
          g.audio.play("nibble", { pitch: rng.float(0.9, 1.2) });
          g.particles.bubbles(h.x, h.y, 2, { size: 1 });
        }
      }
      f.facing = -side;
      f.lookAt(h.x, h.y);
      f.vx = (tx - f.x) * 8;
      f.vy = (ty - f.y) * 8;
      f.x = damp(f.x, tx, 14, dt);
      f.y = damp(f.y, ty, 14, dt);
      f.feel("happy", 0.2);
      if (this.nibbleT <= 0) {
        if (this.nibblesLeft > 0) {
          this.nibblesLeft--;
          this.nibblePhase = 0.25;
          this.nibbled = false;
          this.nibbleT = rng.float(0.45, 1.1);
          if (this.fakeBite && this.nibblesLeft === 1) {
            h.dip = 8;
            f.say("!", 0.4);
            g.audio.play("nibble", { pitch: 0.7 });
            this.fakeBite = false;
          }
        } else {
          this.state = "bite";
          this.biteT = (f.sp.fight?.biteWindow ?? 0.6) * this.stats.biteWindow * (g.tutorialActive ? 2.5 : 1);
          this.biteMax = this.biteT;
          h.dip = 10;
          f.say("!", this.biteT + 0.2);
          f.feel("determined", 1);
          f.chompT = 0.3;
          g.audio.play("bite");
          g.particles.bubbles(h.x, h.y, 6);
          if (rng.chance(this.stats.autoHook)) {
            this.setHook(true);
            return;
          }
        }
      }
      if (inp.pressed && !g.ui.blocking && this.state === "nibble") {
        this.message("Too early!", "#ffb0a0");
        g.audio.play("escape", { vol: 0.5 });
        this.releaseFish(true, "cross");
      }
    }
    updateBite(dt, canHook) {
      const f = this.fish, h = this.hook, g = this.game, inp = this.input;
      if (!f) {
        this.state = "idle";
        return;
      }
      this.biteT -= dt;
      const side = f.x < h.x ? -1 : 1;
      f.x = damp(f.x, h.x + side * (8 * f.scale + 3), 16, dt);
      f.y = damp(f.y, h.y + 2, 16, dt);
      h.dip = Math.max(h.dip, 6 + Math.sin(this.t * 40) * 2);
      if (inp.pressed && canHook && !g.ui.blocking) {
        this.setHook(false);
        return;
      }
      if (this.biteT <= 0) {
        const bait = g.currentBait();
        if (bait?.kind === "special" && rng.chance(0.6)) {
          g.consumeBait(bait.type);
          this.message("It stole your bait!", "#ffd2a0");
        } else this.message("Missed the bite!", "#ffd2a0");
        g.audio.play("escape", { vol: 0.6 });
        this.releaseFish(true, "music");
      }
    }
    setHook(auto) {
      const g = this.game, f = this.fish;
      g.audio.play("hookset");
      this.shake(3);
      g.particles.burst(f.x, f.y, 10, { colors: ["#ffffff", "#ffe27a"], speed: 80, g: 0, life: 0.4 });
      if (auto) this.message("Auto-hook!", "#9affb8", 1);
      f.feel("surprised", 0.8);
      f.squashV += 10;
      this.state = "fight";
      const phases = (f.sp.fight?.phases || ["tension", "net"]).slice();
      if (g.tutorialActive) phases.splice(0, phases.length, "tension");
      this.fight = { phases, pi: 0, phase: null, time: 0 };
      this.power = clamp01((f.sp.fight?.power ?? 0.4) * (g.tutorialActive ? 0.25 : 1) * (f.rec.giant ? 1.25 : 1));
      this.sp = f.sp;
      this.tension = 0.3;
      this.startPhase();
      g.onHooked?.(f);
    }
    startPhase(override) {
      const F = this.fight;
      const name = override || F.phases[F.pi];
      const Cls = PHASES[name] || PHASES.tension;
      F.phase = new Cls(this, name === "tension" && override ? { stamina: 0.45 } : {});
      F.phaseName = name;
      F.flash = 0;
      if (F.pi > 0 || override) this.game.audio.play("notify", { pitch: 1.2 });
    }
    updateFight(dt) {
      const F = this.fight, g = this.game;
      F.time += dt;
      F.flash += dt;
      const focusing = this.input.rdown && this.stats.focus > 0;
      this.focus = damp(this.focus, focusing ? 1 : 0, 8, dt);
      g.timeScaleTarget = focusing ? 0.45 : 1;
      const r = F.phase.update(dt, this.input);
      this.fish.controlled = true;
      if (r === "ok") return;
      if (r === "win") {
        F.pi++;
        if (F.pi >= F.phases.length) {
          this.beginLanding();
          return;
        }
        g.particles.burst(this.fish.x, this.fish.y, 12, { colors: ["#9affb8", "#ffffff"], speed: 70, g: 0, life: 0.5 });
        this.startPhase();
      } else if (r === "recover") {
        this.message("It recovered!", "#ffd2a0");
        F.phases.splice(F.pi, 0, "tension");
        F.phase = new PHASES.tension(this, { stamina: 0.45 });
        F.phaseName = "tension";
      } else {
        this.fail(r);
      }
    }
    fail(reason) {
      const g = this.game, f = this.fish;
      g.timeScaleTarget = 1;
      if (reason === "snap") {
        this.message("SNAP!", "#ff7a6a", 1.8, true);
        g.audio.play("line_snap");
        this.shake(6);
        this.lineSnap = { t: 0, x: f.x, y: f.y };
        g.state.stats.snapped++;
        if (g.currentBait()?.kind === "special") g.consumeBait(g.currentBait().type);
      } else {
        this.message(reason === "throw" ? "It threw the hook!" : "It got away!", "#ffd2a0", 1.8, true);
        g.audio.play("escape");
      }
      g.state.stats.escaped++;
      f.feel("smug", 2);
      this.releaseFish(true, reason === "snap" ? "music" : "cross");
      g.onFishEscaped?.(f, reason);
    }
    beginLanding() {
      const g = this.game, f = this.fish;
      this.state = "landing";
      this.landT = 0;
      this.landFrom = { x: f.x, y: f.y };
      g.timeScaleTarget = 1;
      g.camera.punch(f.x, f.y, 0.14);
      g.camera.slowmo(0.3, 0.55);
      this.shake(5);
      g.audio.play("splash_big");
      g.particles.splash(f.x, f.y, 1.4);
      g.particles.burst(f.x, f.y, 26, { colors: ["#ffffff", "#ffe27a", "#9af0ff"], speed: 120, g: 30, life: 0.9, add: true });
      f.feel(rng.pick(["surprised", "scared", "dizzy"]), 3);
      f.say("!", 1);
    }
    updateLanding(dt) {
      const g = this.game, f = this.fish, w = this.world;
      this.landT += dt;
      const k = clamp01(this.landT / 0.7);
      const topY = w.surfaceY !== null ? w.surfaceY - 30 : this.cursor.y - 40;
      const tx = this.cursor.x, ty = Math.min(this.cursor.y, topY);
      f.x = lerp(this.landFrom.x, tx, k);
      f.y = lerp(this.landFrom.y, ty, k) - Math.sin(k * Math.PI) * 40;
      f.forceAngle = -0.6 + Math.sin(this.landT * 20) * 0.3;
      f.squash = Math.sin(this.landT * 25) * 0.25;
      if (w.surfaceY !== null && !this.splashed && f.y < w.surfaceY) {
        this.splashed = true;
        g.particles.splash(f.x, w.surfaceY, 1.2);
      }
      if (this.landT > 0.8) {
        this.splashed = false;
        const fish = this.fish;
        fish.controlled = false;
        fish.forceAngle = void 0;
        this.fish = null;
        this.fight = null;
        this.state = "idle";
        this.game.onFishCaught(fish);
      }
    }
    // ------------------------------------------------------------------ drawing
    drawWorld(ctx2) {
      const g = this.game, w = this.world, h = this.hook, c = this.cursor;
      const fightLine = (this.state === "fight" || this.state === "landing") && this.fish;
      if (this.fight?.phase?.draw) this.fight.phase.draw(ctx2);
      if (fightLine) {
        const f = this.fish;
        const m = f.anchors?.mouth || [f.x, f.y];
        this.drawRope(ctx2, c.x, c.y, m[0], m[1], this.tension, true);
        this.drawRope(ctx2, this.rodX, -6, c.x, c.y, 0.9, false, 0.35);
      } else if (h.visible) {
        this.drawRope(ctx2, this.rodX, -6, h.x, h.y - 5, 0.2, false);
        this.drawHookAndBait(ctx2);
      }
      if (this.lineSnap) {
        const k = this.lineSnap.t / 0.6;
        ctx2.fillStyle = rgba("#e8f4ff", 1 - k);
        for (let i = 0; i < 10; i++) {
          const a = i * 0.7 + k * 6;
          ctx2.fillRect(Math.round(c.x + Math.cos(a) * k * 30 * (i / 10)), Math.round(c.y + Math.sin(a) * k * 20 * (i / 10) + k * k * 20), 1, 1);
        }
      }
    }
    drawRope(ctx2, x0, y0, x1, y1, tension, fight, alpha = 0.85) {
      const w = this.world;
      const d = dist(x0, y0, x1, y1);
      const sag = (1 - clamp01(tension)) * Math.min(40, d * 0.18);
      const vib = fight && tension > 0.75 ? Math.sin(this.t * 60) * (tension - 0.75) * 6 : 0;
      const mx = (x0 + x1) / 2 + vib, my = (y0 + y1) / 2 + sag;
      const steps = Math.max(4, Math.ceil(d / 2));
      let col = "#e8f4ff";
      if (fight) col = tension > 0.92 ? "#ff6a5a" : tension > 0.75 ? "#ffd25a" : "#e8f4ff";
      let px = null, py = null;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1);
        const y = Math.round((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1);
        if (x === px && y === py) continue;
        const under = w.surfaceY === null || y > w.surfaceY;
        ctx2.fillStyle = rgba(col, under ? alpha * 0.8 : alpha);
        ctx2.fillRect(x, y, 1, 1);
        if (w.surfaceY !== null && py !== null && py <= w.surfaceY !== y <= w.surfaceY) {
          const r = 3 + Math.sin(this.t * 4) * 1;
          ctx2.fillStyle = rgba("#ffffff", 0.6);
          ctx2.fillRect(Math.round(x - r), w.surfaceY + 1, 2, 1);
          ctx2.fillRect(Math.round(x + r - 1), w.surfaceY + 1, 2, 1);
        }
        px = x;
        py = y;
      }
    }
    drawHookAndBait(ctx2) {
      const h = this.hook, g = this.game;
      const x = Math.round(h.x), y = Math.round(h.y);
      ctx2.save();
      ctx2.translate(x, y - 5);
      ctx2.rotate(h.angle * 0.6);
      ctx2.drawImage(HOOK, -3, 0);
      ctx2.restore();
      const bait = g.currentBait();
      if (!bait) return;
      const bx = Math.round(h.x + Math.sin(h.angle * 0.6) * 4 + this.baitSwing * 4), by = Math.round(h.y + 8);
      const spr = bait.kind === "icon" ? bait.mini : baitSprite(bait.type, this.t);
      if (spr) {
        ctx2.drawImage(spr, bx - Math.floor(spr.width / 2), by - 2 + Math.round(Math.sin(this.t * 3) * 0.6));
        if (bait.type === "golden" || bait.type === "lantern") {
          if (rng.chance(0.15)) g.particles.sparkle(bx + rng.float(-5, 5), by + rng.float(-3, 6), bait.type === "golden" ? "#fff3a8" : "#a8fff0");
        }
      }
    }
    drawHud(ctx2) {
      const F = this.fight;
      if (this.state === "fight" && F?.phase) {
        F.phase.drawHud(ctx2);
        if (F.phases.length > 1) {
          const c = this.cursor;
          const n = F.phases.length;
          for (let i = 0; i < n; i++) {
            ctx2.fillStyle = i < F.pi ? "#9affb8" : i === F.pi ? "#ffffff" : "#3a4a5a";
            ctx2.fillRect(Math.round(c.x - n * 3 + i * 6), Math.round(c.y + 40), 4, 2);
          }
        }
      }
      if (this.state === "bite" && this.fish) {
        const f = this.fish;
        const k = this.biteT / this.biteMax;
        drawText(this.ctx || ctx2, "CLICK!", f.x, f.y - 22 * f.scale - 14, { align: "center", color: "#ffe27a", outline: "#3a1a0a", scale: 2, wave: 1, time: this.t });
        ctx2.fillStyle = "#0b1622";
        ctx2.fillRect(Math.round(f.x - 16), Math.round(f.y - 22 * f.scale - 1), 32, 3);
        ctx2.fillStyle = "#ffe27a";
        ctx2.fillRect(Math.round(f.x - 16), Math.round(f.y - 22 * f.scale - 1), Math.round(32 * k), 3);
      }
      if (this.msg) {
        const m = this.msg;
        const a = Math.min(1, (m.max - m.t) * 3);
        ctx2.globalAlpha = a;
        const y = this.cursor.y - 40 - m.t * 12;
        drawText(ctx2, m.text, this.cursor.x, y, { align: "center", color: m.color, outline: "#14202c", scale: m.big ? 2 : 1 });
        ctx2.globalAlpha = 1;
      }
    }
    drawStamina(ctx2, v, color = "#ff8a5a") {
      const f = this.fish;
      if (!f) return;
      const w = 40, x = Math.round(f.x - w / 2), y = Math.round(f.y - 24 * f.scale - 8);
      ctx2.fillStyle = "#0b1622";
      ctx2.fillRect(x - 1, y - 1, w + 2, 5);
      ctx2.fillStyle = "#2a1a1a";
      ctx2.fillRect(x, y, w, 3);
      ctx2.fillStyle = color;
      ctx2.fillRect(x, y, Math.round(w * clamp01(v)), 3);
      ctx2.fillStyle = rgba("#ffffff", 0.5);
      ctx2.fillRect(x, y, Math.round(w * clamp01(v)), 1);
    }
    drawTensionGauge(ctx2, T) {
      const c = this.cursor;
      const R = 17;
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      const n = 54;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const a2 = lerp(a0, a1, k);
        let col = k < 0.1 ? "#6ab8ff" : k < 0.75 ? "#7dff9a" : k < 0.9 ? "#ffd25a" : "#ff5a4a";
        const on = k <= T;
        ctx2.fillStyle = on ? col : rgba("#0b1622", 0.55);
        const x = Math.round(c.x + Math.cos(a2) * R), y = Math.round(c.y + Math.sin(a2) * R);
        ctx2.fillRect(x, y, 2, 2);
      }
      const a = lerp(a0, a1, clamp01(T));
      ctx2.fillStyle = "#ffffff";
      ctx2.fillRect(Math.round(c.x + Math.cos(a) * (R - 4)), Math.round(c.y + Math.sin(a) * (R - 4)), 2, 2);
      ctx2.fillRect(Math.round(c.x + Math.cos(a) * (R + 3)), Math.round(c.y + Math.sin(a) * (R + 3)), 2, 2);
    }
  };

  // src/game/skills.js
  var S3 = (id, branch, name, cost, req, pos, effect, desc, extra = {}) => ({ id, branch, name, cost, req, pos, effect, desc, ...extra });
  var SKILLS = [
    S3("hook1", "hook", "Sharper Hook", 0, [], [0, 0.04], { biteWindow: 1.25 }, "Bites stay hookable longer.", { icon: "hook" }),
    // hooks (centre-left trunk)
    S3("hook2", "hook", "Barbed Hook", 15, ["hook1"], [-0.16, 0.16], { slackGrace: 0.6 }, "Fish struggle longer before throwing the hook.", { icon: "hook" }),
    S3("hook3", "hook", "Lucky Hook", 60, ["hook2"], [-0.28, 0.27], { rarityBoost: 1.2 }, "Rarer fish show up a little more often.", { icon: "star" }),
    S3("hook5", "hook", "Steel Hook", 300, ["hook3"], [-0.36, 0.4], { lineStrength: 0.15 }, "Tough enough for junk. Needed for Junkyard Reef.", { icon: "hook" }),
    S3("hook4", "hook", "Auto-Hook Charm", 150, ["hook3"], [-0.18, 0.4], { autoHook: 0.15 }, "15% chance to set the hook automatically.", { icon: "sparkle" }),
    S3("hook6", "hook", "Golden Hook", 900, ["hook5"], [-0.44, 0.55], { rarityBoost: 1.3, shinyChance: 1.5 }, "Rare and shiny fish are drawn to gold.", { icon: "crown" }),
    S3("hook7", "hook", "Lantern Hook", 1200, ["hook5"], [-0.3, 0.6], { lantern: 1 }, "Your hook glows. Needed for the Midnight Abyss.", { icon: "sun" }),
    S3("hook8", "hook", "Auto-Hook II", 2500, ["hook4", "hook6"], [-0.36, 0.75], { autoHook: 0.15 }, "+15% more auto-hook chance.", { icon: "sparkle" }),
    // lines (left)
    S3("line1", "line", "Braided Line", 20, ["hook1"], [-0.42, 0.12], { lineStrength: 0.15 }, "Line can take more tension.", { icon: "line" }),
    S3("line2", "line", "Elastic Line", 50, ["line1"], [-0.58, 0.2], { snapGrace: 0.25 }, "Survives tension spikes a bit longer.", { icon: "line" }),
    S3("line3", "line", "Fluoro Line", 120, ["line2"], [-0.72, 0.3], { calm: 1.25 }, "Nearly invisible: fish spook less.", { icon: "eye" }),
    S3("line4", "line", "Steel Leader", 400, ["line3"], [-0.78, 0.45], { lineStrength: 0.2 }, "Big fish, no problem.", { icon: "line" }),
    S3("line5", "line", "Titanium Line", 1500, ["line4"], [-0.8, 0.62], { lineStrength: 0.25, snapGrace: 0.3 }, "The strongest line on any desktop.", { icon: "line" }),
    // reels (right of trunk)
    S3("reel1", "reel", "Quick Reel", 25, ["hook1"], [0.16, 0.15], { reelSpeed: 12 }, "Reel in faster.", { icon: "reel" }),
    S3("reel2", "reel", "Counter Grip", 70, ["reel1"], [0.28, 0.26], { staminaDrain: 1.25 }, "Pulling against fish tires them faster.", { icon: "reel" }),
    S3("reel3", "reel", "Ball Bearings", 180, ["reel2"], [0.36, 0.39], { reelSpeed: 14 }, "Smooth, speedy reeling.", { icon: "reel" }),
    S3("reel4", "reel", "Drag System", 450, ["reel3"], [0.44, 0.53], { snapGrace: 0.3, slackGrace: 0.5 }, "More forgiving tension.", { icon: "reel" }),
    S3("reel5", "reel", "Overdrive Reel", 1800, ["reel4"], [0.4, 0.7], { staminaDrain: 1.35, reelSpeed: 16 }, "Wear down even legends.", { icon: "reel" }),
    // mouse mastery (right)
    S3("mouse1", "mouse", "Calm Hands", 30, ["hook1"], [0.42, 0.1], { calm: 1.3 }, "Fish tolerate faster mouse movement.", { icon: "mouse_l" }),
    S3("mouse8", "mouse", "Coin Magnet", 140, ["mouse1"], [0.6, 0.14], { collectRadius: 16 }, "Collect coins from further away.", { icon: "coin" }),
    S3("mouse2", "mouse", "Lure Jigging", 80, ["mouse1"], [0.56, 0.26], { baitRadius: 1.25 }, "Clicking in the water attracts fish from further.", { icon: "bait" }),
    S3("mouse3", "mouse", "Big Net", 100, ["mouse2"], [0.72, 0.3], { netTolerance: 1.35, netTime: 1.25 }, "Sloppy circles still catch fish.", { icon: "net" }),
    S3("mouse4", "mouse", "Tracer Eyes", 160, ["mouse2"], [0.64, 0.42], { traceRadius: 1.3, traceForgive: 1.3 }, "Bigger ring when tracing fish.", { icon: "eye" }),
    S3("mouse5", "mouse", "Rhythm Fins", 220, ["mouse4"], [0.8, 0.46], { timingWindow: 1.35, timingMisses: 1 }, "Wider timing window, one extra miss.", { icon: "music" }),
    S3("mouse6", "mouse", "Power Clicks", 220, ["mouse4"], [0.7, 0.56], { mashPower: 1.35 }, "Each mash click counts more.", { icon: "mouse_l" }),
    S3("mouse9", "mouse", "Dodge Roll", 350, ["mouse6"], [0.84, 0.62], { dodgeHits: 1 }, "Take one extra hit when dodging.", { icon: "heart" }),
    S3("mouse7", "mouse", "Focus Mode", 600, ["mouse6"], [0.62, 0.72], { focus: 1 }, "Hold RIGHT mouse during fights to slow time.", { icon: "clock" }),
    // bait (upper left)
    S3("bait1", "bait", "Bigger Bait Box", 20, ["hook2"], [-0.06, 0.28], { boxSlots: 2 }, "+2 bait box slots.", { icon: "bait" }),
    S3("bait2", "bait", "Worm Farm", 60, ["bait1"], [-0.06, 0.42], { unlockBait: ["worm"] }, "Glowing Worms appear in the shop.", { icon: "worm" }),
    S3("bait8", "bait", "Sugar Rush", 120, ["bait2"], [0.06, 0.5], { unlockBait: ["sugar"] }, "Sugar Cubes appear in the shop.", { icon: "food" }),
    S3("bait3", "bait", "Golden Bait License", 250, ["bait2"], [-0.14, 0.53], { unlockBait: ["golden"] }, "Golden Bait appears in the shop.", { icon: "crown" }),
    S3("bait4", "bait", "Flood Gates", 300, ["bait3"], [-0.06, 0.64], { unlockBait: ["flood"] }, "Flood Bait appears in the shop.", { icon: "rain" }),
    S3("bait5", "bait", "Bait Box XL", 500, ["bait4"], [-0.16, 0.74], { boxSlots: 3 }, "+3 bait box slots.", { icon: "bait" }),
    S3("bait7", "bait", "Potent Bait", 700, ["bait4"], [0.04, 0.76], { baitRadius: 1.3 }, "Bait smell travels much further.", { icon: "sparkle" }),
    S3("bait6", "bait", "Black Hole Permit", 1500, ["bait7"], [-0.04, 0.88], { unlockBait: ["blackhole"] }, "Black Hole Bait appears in the shop. Handle with care.", { icon: "skull" }),
    // aquarium (lower right)
    S3("tank1", "tank", "Bigger Tank", 40, ["reel1"], [0.14, 0.3], { tankCap: 3 }, "+3 fish in your aquarium.", { icon: "tank" }),
    S3("tank2", "tank", "Auto-Feeder", 150, ["tank1"], [0.2, 0.42], { feeder: 1 }, "Your fish get fed while you work.", { icon: "food" }),
    S3("tank3", "tank", "Snail Janitor", 200, ["tank1"], [0.1, 0.44], { autoCollect: 1 }, "A snail slowly collects coins for you.", { icon: "coin" }),
    S3("tank4", "tank", "Bigger Tank II", 400, ["tank2"], [0.24, 0.56], { tankCap: 4 }, "+4 fish in your aquarium.", { icon: "tank" }),
    S3("tank5", "tank", "Happy Water", 500, ["tank4"], [0.2, 0.68], { coinMul: 1.25 }, "Happier fish make 25% more coins.", { icon: "heart" }),
    S3("tank6", "tank", "Coin Crab", 1200, ["tank3", "tank4"], [0.12, 0.6], { autoCollect: 1 }, "A greedy crab helps collect coins.", { icon: "coin" }),
    S3("tank7", "tank", "Bigger Tank III", 2e3, ["tank5"], [0.26, 0.82], { tankCap: 6 }, "+6 fish in your aquarium.", { icon: "tank" }),
    S3("tank8", "tank", "Treasure Currents", 3e3, ["tank7"], [0.16, 0.94], { coinMul: 1.5, offlineMul: 0.2 }, "+50% coins, more coins while away.", { icon: "trophy" }),
    // breeding (crown right)
    S3("breed1", "breed", "Fish Romance", 800, ["tank5"], [0.36, 0.84], { breeding: 1 }, "Happy pairs of the same species lay eggs.", { icon: "heart" }),
    S3("breed2", "breed", "Warm Nursery", 1200, ["breed1"], [0.5, 0.88], { hatchSpeed: 1.6 }, "Eggs hatch faster.", { icon: "sun" }),
    S3("breed3", "breed", "Mutation Lab", 2e3, ["breed1"], [0.42, 0.96], { mutationChance: 0.05 }, "More mutations when catching and breeding.", { icon: "sparkle" }),
    S3("breed4", "breed", "Sparkle Genes", 4e3, ["breed3"], [0.56, 0.98], { shinyChance: 2 }, "Shiny fish twice as likely.", { icon: "star" }),
    // expeditions (crown left)
    S3("exp1", "exp", "Junkyard Reef Map", 350, ["hook5"], [-0.52, 0.42], { unlockBiome: "junkyard" }, "Travel to Junkyard Reef. Requires the Steel Hook and 6 species discovered.", { icon: "map", needSpecies: 6 }),
    S3("exp2", "exp", "Junk Bait License", 500, ["exp1"], [-0.6, 0.56], { unlockBait: ["chip", "popup"] }, "Overclocked Chips and Pop-up Ads in the shop.", { icon: "bait" }),
    S3("exp5", "exp", "Weather Radio", 400, ["exp1"], [-0.62, 0.7], { forecast: 1 }, "See the weather forecast and rare-fish weather.", { icon: "cloud" }),
    S3("exp6", "exp", "Sonar Ping", 900, ["exp5"], [-0.66, 0.84], { sonar: 1 }, "Rare fish get a subtle glint.", { icon: "eye" }),
    S3("exp3", "exp", "Midnight Abyss Map", 2500, ["exp1", "hook7"], [-0.46, 0.86], { unlockBiome: "abyss" }, "Dive to the Midnight Abyss. Requires the Lantern Hook and 16 species discovered.", { icon: "map", needSpecies: 16 }),
    S3("exp4", "exp", "Abyss Bait License", 1800, ["exp3"], [-0.3, 0.95], { unlockBait: ["lantern", "relic"] }, "Lantern Pearls and Ancient Relics in the shop.", { icon: "skull" })
  ];
  var SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
  var BASE_STATS = {
    biteWindow: 1,
    lineStrength: 1,
    snapGrace: 0.35,
    slackGrace: 1.6,
    reelSpeed: 34,
    staminaDrain: 1,
    traceRadius: 1,
    traceForgive: 1,
    mashPower: 1,
    timingWindow: 1,
    timingMisses: 2,
    dodgeHits: 2,
    netTolerance: 1,
    netTime: 1,
    calm: 1,
    autoHook: 0,
    baitRadius: 1,
    rarityBoost: 1,
    mutationChance: 0.05,
    shinyChance: 1 / 220,
    boxSlots: 4,
    tankCap: 4,
    coinMul: 1,
    collectRadius: 14,
    focus: 0,
    autoCollect: 0,
    feeder: 0,
    breeding: 0,
    hatchSpeed: 1,
    sonar: 0,
    lantern: 0,
    forecast: 0,
    offlineMul: 0.35
  };
  var MULTIPLIERS = /* @__PURE__ */ new Set(["biteWindow", "staminaDrain", "traceRadius", "traceForgive", "mashPower", "timingWindow", "netTolerance", "netTime", "calm", "baitRadius", "rarityBoost", "shinyChance", "coinMul", "hatchSpeed"]);
  function computeStats(owned) {
    const s = { ...BASE_STATS, unlockBait: /* @__PURE__ */ new Set(["bread"]), unlockBiome: /* @__PURE__ */ new Set(["shallows"]) };
    for (const sk of SKILLS) {
      if (!owned[sk.id]) continue;
      for (const [k, v] of Object.entries(sk.effect)) {
        if (k === "unlockBait") v.forEach((b) => s.unlockBait.add(b));
        else if (k === "unlockBiome") s.unlockBiome.add(v);
        else if (MULTIPLIERS.has(k)) s[k] *= v;
        else s[k] = (s[k] || 0) + v;
      }
    }
    return s;
  }

  // src/overlay/input.js
  var OverlayInput = class {
    constructor(canvas, toLogical) {
      this.canvas = canvas;
      this.toLogical = toLogical;
      this.x = -100;
      this.y = -100;
      this.px = -100;
      this.py = -100;
      this.vx = 0;
      this.vy = 0;
      this.speed = 0;
      this.down = false;
      this.rdown = false;
      this.pressed = false;
      this.released = false;
      this.rpressed = false;
      this.rreleased = false;
      this.dblclick = false;
      this.clicks = 0;
      this.inside = false;
      this.moved = false;
      this.time = 0;
      this.lastClickT = 0;
      this.keysPressed = /* @__PURE__ */ new Set();
      this.subs = [];
      this.bind();
    }
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.subs.push(() => target.removeEventListener(type, fn, opts));
    }
    pos(e) {
      const [x, y] = this.toLogical(e.clientX, e.clientY);
      this.x = x;
      this.y = y;
    }
    bind() {
      const c = this.canvas;
      const passive = { passive: true, capture: true };
      this.on(window, "pointermove", (e) => {
        this.pos(e);
        this.inside = true;
        this.moved = true;
      }, passive);
      this.on(window, "mouseout", (e) => {
        if (!e.relatedTarget) this.inside = false;
      }, passive);
      this.on(window, "blur", () => {
        this.release();
      }, passive);
      this.on(window, "pointerup", (e) => {
        if (e.button === 2) {
          if (this.rdown) this.rreleased = true;
          this.rdown = false;
          return;
        }
        if (e.button !== 0) return;
        if (this.down) {
          this.pos(e);
          this.released = true;
        }
        this.down = false;
      }, passive);
      this.on(window, "pointercancel", () => this.release(), passive);
      this.on(c, "pointerdown", (e) => {
        e.preventDefault();
        this.pos(e);
        this.inside = true;
        try {
          c.setPointerCapture(e.pointerId);
        } catch {
        }
        if (e.button === 2) {
          this.rdown = true;
          this.rpressed = true;
          return;
        }
        if (e.button !== 0) return;
        this.down = true;
        this.pressed = true;
        this.clicks++;
        const now2 = performance.now();
        this.dblclick = now2 - this.lastClickT < 380;
        this.lastClickT = this.dblclick ? 0 : now2;
      }, { passive: false });
      this.on(c, "contextmenu", (e) => e.preventDefault(), { passive: false });
    }
    release() {
      if (this.down) this.released = true;
      this.down = false;
      this.rdown = false;
    }
    update(dt) {
      this.time += dt;
      const ivx = (this.x - this.px) / Math.max(dt, 1e-3);
      const ivy = (this.y - this.py) / Math.max(dt, 1e-3);
      const k = 1 - Math.exp(-18 * dt);
      if (Math.abs(ivx) < 4e3 && Math.abs(ivy) < 4e3) {
        this.vx += (ivx - this.vx) * k;
        this.vy += (ivy - this.vy) * k;
      }
      this.speed = Math.hypot(this.vx, this.vy);
    }
    // Rescale the remembered position after the logical canvas size changes.
    rescale(kx, ky) {
      this.x *= kx;
      this.y *= ky;
      this.px *= kx;
      this.py *= ky;
    }
    keyPressed(k) {
      return this.keysPressed.has(k);
    }
    key() {
      return false;
    }
    consume() {
      this.pressed = false;
      this.released = false;
      this.dblclick = false;
      this.clicks = 0;
    }
    endFrame() {
      this.px = this.x;
      this.py = this.y;
      this.pressed = this.released = this.rpressed = this.rreleased = false;
      this.dblclick = false;
      this.clicks = 0;
      this.moved = false;
      this.keysPressed.clear();
    }
    destroy() {
      for (const off of this.subs) off();
      this.subs.length = 0;
    }
  };

  // src/overlay/scan.js
  var MEDIA = /* @__PURE__ */ new Set(["img", "video", "canvas", "svg", "picture", "iframe", "embed", "object"]);
  var TEXT = /* @__PURE__ */ new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "blockquote",
    "pre",
    "dd",
    "dt",
    "figcaption",
    "caption",
    "td",
    "th",
    "summary",
    "legend",
    "label"
  ]);
  var CLIMB = 7;
  var KEEP_SCANS = 2;
  var MAX_ICONS = 48;
  var MAX_WINDOWS = 72;
  var MAX_LINES = 80;
  var PageScanner = class {
    constructor(host) {
      this.host = host;
      this.rects = /* @__PURE__ */ new Map();
      this.icons = [];
      this.windows = [];
      this.scanId = 0;
      this.ms = 0;
      this.k = 1;
    }
    classify(el) {
      for (let i = 0, e = el; e && i < CLIMB; i++, e = e.parentElement) {
        if (e === this.host || e === document.body || e === document.documentElement) return null;
        const n = e.localName;
        if (MEDIA.has(n)) return [e, "media"];
        if (TEXT.has(n)) return [e, "text"];
      }
      return null;
    }
    // cssW/cssH: overlay size in CSS px; k: logical px per CSS px.
    scan(cssW, cssH, k) {
      const t0 = performance.now();
      this.k = k;
      const id = ++this.scanId;
      const host = this.host;
      const wasHit = host.style.getPropertyValue("pointer-events") !== "none";
      if (wasHit) host.style.setProperty("pointer-events", "none", "important");
      const cols = Math.max(6, Math.min(36, Math.ceil(cssW / 56)));
      const rows = Math.max(5, Math.min(24, Math.ceil(cssH / 48)));
      const off = id & 1 ? 0.25 : 0.75;
      const seen = /* @__PURE__ */ new Map();
      for (let j = 0; j < rows; j++) {
        const y = (j + off) / rows * cssH;
        for (let i = 0; i < cols; i++) {
          const x = (i + (j & 1 ? 1 - off : off)) / cols * cssW;
          const hit = document.elementFromPoint(x, y);
          if (!hit || seen.has(hit)) continue;
          const c = this.classify(hit);
          seen.set(hit, true);
          if (c) seen.set(c[0], c[1]);
        }
      }
      if (wasHit) host.style.setProperty("pointer-events", "auto", "important");
      const area = cssW * cssH;
      const icons = [], windows = [];
      const consider = (el, kind) => {
        let r = this.rects.get(el);
        if (!r) {
          r = { x: 0, y: 0, w: 0, h: 0, kind, el, seen: id, lines: null };
          this.rects.set(el, r);
        }
        const b = el.getBoundingClientRect();
        const ok = el.isConnected && b.width >= 24 && b.height >= (kind === "text" ? 10 : 24) && b.right > 0 && b.bottom > 0 && b.left < cssW && b.top < cssH && b.width * b.height < area * (kind === "text" ? 0.6 : 0.7);
        if (!ok) {
          this.rects.delete(el);
          return;
        }
        r.x = b.left * k;
        r.y = b.top * k;
        r.w = b.width * k;
        r.h = b.height * k;
        r.lines = null;
        (kind === "media" ? icons : windows).push(r);
      };
      for (const [el, kind] of seen) {
        if (kind === true) continue;
        const r = this.rects.get(el);
        if (r) r.seen = id;
        consider(el, kind);
      }
      for (const [el, r] of this.rects) {
        if (r.seen === id) continue;
        if (id - r.seen > KEEP_SCANS) {
          this.rects.delete(el);
          continue;
        }
        consider(el, r.kind);
      }
      this.icons = dedupe(icons).sort(byArea).slice(0, MAX_ICONS);
      this.windows = dedupe(windows).sort(byArea).slice(0, MAX_WINDOWS);
      this.ms = performance.now() - t0;
    }
    // Scroll moved everything: shift cached geometry until the next scan.
    shift(dx, dy) {
      if (!dx && !dy) return;
      for (const r of this.rects.values()) {
        r.x -= dx;
        r.y -= dy;
        if (r.lines) for (const l of r.lines) {
          l.x -= dx;
          l.y -= dy;
        }
      }
    }
    // Line boxes of a text block (logical px), computed lazily and cached until the next scan.
    linesOf(r) {
      if (r.lines) return r.lines;
      const k = this.k;
      let out = [];
      try {
        const range = document.createRange();
        range.selectNodeContents(r.el);
        const list = Array.from(range.getClientRects()).filter((b) => b.width > 1 && b.height > 1 && b.height < 56);
        list.sort((a, b) => a.top - b.top);
        for (const b of list) {
          const last = out[out.length - 1];
          if (last && b.top < last.b - Math.min(b.height, last.b - last.t) * 0.5) {
            last.l = Math.min(last.l, b.left);
            last.r = Math.max(last.r, b.right);
            last.t = Math.min(last.t, b.top);
            last.b = Math.max(last.b, b.bottom);
          } else {
            if (out.length >= MAX_LINES) break;
            out.push({ l: b.left, r: b.right, t: b.top, b: b.bottom });
          }
        }
        out = out.map((q) => ({ x: q.l * k, y: q.t * k, w: (q.r - q.l) * k, h: (q.b - q.t) * k }));
      } catch {
        out = [];
      }
      if (!out.length) out = [{ x: r.x, y: r.y, w: r.w, h: r.h }];
      r.lines = out;
      return out;
    }
    clear() {
      this.rects.clear();
      this.icons = [];
      this.windows = [];
    }
  };
  function byArea(a, b) {
    return b.w * b.h - a.w * a.h;
  }
  function dedupe(list) {
    return list.filter((r) => !list.some((o) => o !== r && o.el.contains(r.el) && o.kind === r.kind));
  }

  // src/ui/panels.js
  var WOOD_L = ["#3a1e14", "#6e3c22", "#9a5e34", "#c08550", "#dcaa70", "#f2d098"];
  var WOOD_D = ["#1e100c", "#3a2016", "#55321f", "#70452a", "#8c5c38", "#a8784c"];
  var PAPER = ["#7a5a3c", "#c8ac80", "#e2cfa8", "#f3e6c8", "#fbf3df", "#fffcf2"];
  var GOLD = ["#4a2a10", "#8a5418", "#c88a26", "#f0b83c", "#ffe07a", "#fff8c8"];
  var CORAL = ["#5a1424", "#a8344a", "#e0585a", "#ff866c", "#ffb48e", "#ffe0c6"];
  var pkc = /* @__PURE__ */ new Map();
  var pkcA = /* @__PURE__ */ new Map();
  function pk3(c, a = 255) {
    if (a === 255) {
      let v2 = pkc.get(c);
      if (v2 === void 0) pkc.set(c, v2 = pack(c));
      return v2;
    }
    const k = c + "|" + a;
    let v = pkcA.get(k);
    if (v === void 0) pkcA.set(k, v = pack(c, a));
    return v;
  }
  function step(v, R, x, y) {
    const n = R.length - 1;
    v = clamp(v, 0, n);
    const i = Math.floor(v);
    if (i >= n) return R[n];
    const f = clamp((v - i - 0.5) * 2.4 + 0.5, 0, 1);
    return f > bayer(x, y) ? R[i + 1] : R[i];
  }
  var INSETS = { 0: [], 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1], 5: [5, 3, 2, 1, 1] };
  function rr(w, h, r) {
    const ins = INSETS[r] || [];
    return (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const d = Math.min(y, h - 1 - y);
      const k = d < ins.length ? ins[d] : 0;
      return x >= k && x < w - k;
    };
  }
  var edgeOf = (m, x, y) => !m(x - 1, y) || !m(x + 1, y) || !m(x, y - 1) || !m(x, y + 1);
  var tex = /* @__PURE__ */ new Map();
  var volatileTex = /* @__PURE__ */ new Map();
  function cached(key, build2, store = tex, limit = 500) {
    let c = store.get(key);
    if (c) {
      store.delete(key);
      store.set(key, c);
      return c;
    }
    c = build2();
    store.set(key, c);
    if (store.size > limit) store.delete(store.keys().next().value);
    return c;
  }
  function blitRect(ctx2, c, x, y) {
    ctx2.drawImage(c, Math.round(x), Math.round(y));
  }
  function woodTex(w, h, tone3, nails, inset, round, planks, noSeams) {
    const R0 = tone3 === "dark" ? WOOD_D : WOOD_L;
    const R = inset ? [R0[0], R0[0], R0[1], R0[2], R0[3], R0[4]] : R0;
    const b = new PixelBuffer(w, h);
    const m = rr(w, h, round);
    const n = planks || Math.max(1, Math.round((h - 2) / 12));
    const ys = [];
    for (let i = 0; i <= n; i++) ys.push(1 + Math.round(i * (h - 2) / n));
    const nailAt = [];
    for (let i = 0; i < n; i++) {
      const y0 = ys[i], y1 = ys[i + 1], ph = y1 - y0, seed = i * 31 + (tone3 === "dark" ? 7 : 0);
      const tint = (hash1(i, 3) - 0.5) * 0.16;
      const P3 = R.map((c) => tint > 0 ? mix(c, shade(c, 0.4), tint * 2) : mix(c, shade(c, -0.4), -tint * 2));
      const seams = [];
      if (w > 90 && !noSeams) {
        seams.push(Math.round(w * (0.2 + hash1(i, 5) * 0.55)));
        if (w > 300) seams.push(Math.round(w * (0.2 + hash1(i, 5) * 0.55) + w * 0.45) % (w - 24) + 12);
      }
      const knot = w > 48 && ph >= 8 && hash1(i, 9) > 0.35 ? [12 + Math.floor(hash1(i, 11) * (w - 24)), y0 + ph / 2 + 0.5] : null;
      const top = i > 0 ? 1 : 0;
      const wave = new Float32Array(w);
      for (let x = 0; x < w; x++) wave[x] = Math.sin(x * 0.045 + seed) * 1.6 + Math.sin(x * 0.013 + seed * 2) * 2.4;
      const s0 = seams.length > 0 ? seams[0] : -9, s1 = seams.length > 1 ? seams[1] : -9;
      for (let y = y0; y < y1; y++) {
        const ly = y - y0;
        for (let x = 0; x < w; x++) {
          if (!m(x, y)) continue;
          if (i > 0 && ly === 0) {
            b.set(x, y, pk3(R[0]));
            continue;
          }
          let c = P3[3];
          if (ly === top) c = P3[4];
          else if (ly === ph - 1) c = P3[2];
          else {
            let gy = y + wave[x];
            let kd = 9;
            if (knot) {
              const dx = (x + 0.5 - knot[0]) / 3.2, dy = (y + 0.5 - knot[1]) / 1.7;
              kd = Math.hypot(dx, dy);
              if (kd < 3.2) gy += Math.sign(y + 0.5 - knot[1]) * (3.2 - kd) * 0.9;
            }
            const ph2 = (gy + seed * 0.37) / 3.3 % 1;
            const seg = Math.sin(x * 0.07 + Math.floor(gy / 3.3) * 2.3 + seed) > -0.2;
            if (ph2 < 0.24 && seg) c = P3[2];
            else if (ph2 > 0.55 && ph2 < 0.7 && hash2(x >> 3, Math.floor(gy / 3.3), seed) > 0.55) c = P3[4];
            if (knot && kd < 1) c = kd < 0.5 ? P3[1] : P3[2];
            else if (knot && kd < 1.5) c = P3[4];
          }
          if (ly >= top && (Math.abs(x - s0) <= 1 || Math.abs(x - s1) <= 1)) {
            const sx = Math.abs(x - s0) <= 1 ? s0 : s1;
            if (x === sx) c = R[0];
            else if (x === sx + 1 && ly > top) c = P3[4];
            else if (x === sx - 1 && ly > top && ly < ph - 1) c = P3[2];
          }
          if (x === 1 && ly > top) c = mix(c, P3[5], 0.35);
          if (x === w - 2) c = mix(c, P3[1], 0.45);
          if (inset) {
            if (y === 1 || x === 1) c = R[1];
            else if (y === 2 || x === 2) c = mix(c, R[1], 0.5);
            else if (y === h - 2) c = R0[4];
            else if (x === w - 2) c = R0[3];
          }
          b.set(x, y, pk3(c));
        }
      }
      if (nails && !inset && w >= 24 && ph >= 6) {
        const ny = y0 + top + Math.floor((ph - top) / 2) - 1;
        if (i === 0 || i === n - 1) nailAt.push([4, ny], [w - 6, ny]);
        for (const sx of seams) nailAt.push([sx - 4, ny], [sx + 3, ny]);
      }
    }
    for (const [nx, ny] of nailAt) {
      b.set(nx, ny, pk3("#f4f6fa"));
      b.set(nx + 1, ny, pk3("#a8b0c0"));
      b.set(nx, ny + 1, pk3("#8a92a4"));
      b.set(nx + 1, ny + 1, pk3("#4a5064"));
      b.set(nx + 2, ny + 1, pk3(R[1]));
      b.set(nx + 1, ny + 2, pk3(R[1]));
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m(x, y) && edgeOf(m, x, y)) b.set(x, y, pk3(R0[0]));
    return b.toCanvas();
  }
  function drawWood(ctx2, x, y, w, h, opts = {}) {
    w = Math.round(w);
    h = Math.round(h);
    if (w < 3 || h < 3) return;
    const tone3 = opts.tone === "dark" ? "dark" : "light";
    const nails = opts.nails !== false, inset = !!opts.inset, round = opts.round ?? 1, planks = opts.planks || 0, noSeams = opts.seams === false;
    blitRect(ctx2, cached(`wood|${w}|${h}|${tone3}|${nails}|${inset}|${round}|${planks}|${noSeams}`, () => woodTex(w, h, tone3, nails, inset, round, planks, noSeams)), x, y);
  }
  function paperTex(w, h, torn, lined, aged, fold) {
    const tTop = torn === "top" || torn === "both", tBot = torn === true || torn === "bottom" || torn === "both";
    const prof = (x, s) => clamp(Math.round(1.3 + Math.sin(x * 0.75 + s) * 0.9 + hash1(x, s) * 1.7 - 0.6), 0, 3);
    const F = fold ? clamp(Math.round(Math.min(w, h) * 0.22), 4, 12) : 0;
    const m = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      if (tTop && y < prof(x, 3)) return false;
      if (tBot && y > h - 1 - prof(x, 7)) return false;
      if (F && x - (w - F) > y) return false;
      if (!tTop && y === 0 && (x === 0 || !F && x === w - 1)) return false;
      if (!tBot && y === h - 1 && (x === 0 || x === w - 1)) return false;
      return true;
    };
    const flap = (x, y) => F && x >= w - F && y < F && x - (w - F) <= y;
    const b = new PixelBuffer(w + 1, h + 2);
    const sh = pk3("#1a1020", 64);
    for (let y = 0; y < h + 2; y++) for (let x = 0; x < w + 1; x++) if (!m(x, y) && m(x - 1, y - 2)) b.set(x, y, sh);
    const R = PAPER;
    const ring = aged && w > 50 && h > 40 ? [w * 0.74, h * 0.66, Math.min(w, h) * 0.17] : null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m(x, y)) continue;
        if (edgeOf(m, x, y)) {
          b.set(x, y, pk3(mix(R[0], R[1], 0.25)));
          continue;
        }
        if (flap(x, y)) {
          const onEdge = x === w - F || y === F - 1 || x - (w - F) === y;
          b.set(x, y, pk3(onEdge ? R[1] : step(4.2 - y / F * 1.2, R, x, y)));
          continue;
        }
        let v = 3;
        if (y <= 2) v += 0.8;
        if (y >= h - 4) v -= 0.75;
        if (x === 1) v += 0.5;
        if (x >= w - 3) v -= 0.5;
        const hs = hash2(x, y, 41);
        if (hs > 0.975) v -= 0.55;
        else if (hs < 0.015) v += 0.6;
        if (aged) {
          const d = Math.min(x, y, w - 1 - x, h - 1 - y);
          if (d < 7) v -= (7 - d) * 0.2;
          if (hash2(x >> 1, y >> 1, 9) > 0.988) v = 1.6;
          if (ring) {
            const rd = Math.hypot(x + 0.5 - ring[0], (y + 0.5 - ring[1]) * 1.1);
            if (Math.abs(rd - ring[2]) < 0.8 && hash2(x, y, 5) > 0.2) v = Math.min(v, 1.9);
            else if (rd < ring[2]) v -= 0.25;
          }
        }
        if (F && x >= w - F - 2 && y < F + 2 && !flap(x, y) && (x === w - F - 1 || y === F)) v -= 0.8;
        let c = step(v, R, x, y);
        if (lined) {
          if (y >= 13 && (y - 13) % 10 === 0 && x > 2 && x < w - 3) c = "#a9c4e0";
          if (x === 10 && y > 2 && y < h - 3) c = "#e6a2a0";
        }
        b.set(x, y, pk3(c));
      }
    }
    return b.toCanvas();
  }
  function drawPaper(ctx2, x, y, w, h, opts = {}) {
    w = Math.round(w);
    h = Math.round(h);
    if (w < 4 || h < 4) return;
    const torn = opts.torn || false, lined = !!opts.lined, aged = !!opts.aged, fold = !!opts.fold;
    blitRect(ctx2, cached(`paper|${w}|${h}|${torn}|${lined}|${aged}|${fold}`, () => paperTex(w, h, torn, lined, aged, fold)), x, y);
  }
  function bandFrame(b, w, h, fw, R, opts = {}) {
    const outer = rr(w, h, opts.r ?? 2);
    const inner = (x, y) => x >= fw && y >= fw && x < w - fw && y < h - fw;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!outer(x, y) || inner(x, y)) continue;
        let v;
        if (edgeOf(outer, x, y)) v = 0;
        else if (inner(x - 1, y) || inner(x + 1, y) || inner(x, y - 1) || inner(x, y + 1)) v = 1;
        else {
          const dT = y, dB = h - 1 - y, dL = x, dR = w - 1 - x, mn = Math.min(dT, dB, dL, dR);
          const side = mn === dT ? "t" : mn === dL ? "l" : mn === dB ? "b" : "r";
          v = side === "t" ? 4.3 : side === "l" ? 3.8 : side === "b" ? 2.2 : 2.6;
          const k = mn;
          if (k === 1) v += 0.5;
          if (opts.grain) {
            const along = side === "t" || side === "b" ? x : y;
            const g = fbm2(along * 0.06, k * 0.9 + (side === "l" || side === "r" ? 40 : 0), 2, 3);
            v += (g - 0.5) * 1.2;
            if (g * 9 % 1 < 0.12) v -= 0.6;
          }
        }
        b.set(x, y, pk3(step(v, R, x, y)));
      }
    }
    if (opts.rivets) {
      for (const [rx, ry] of [[1, 1], [w - 3, 1], [1, h - 3], [w - 3, h - 3]]) {
        const cx = rx + (fw - 2 > 0 ? Math.floor((fw - 2) / 2) : 0), cy = ry + (fw - 2 > 0 ? Math.floor((fw - 2) / 2) : 0);
        b.set(cx, cy, pk3(R[5]));
        b.set(cx + 1, cy, pk3(R[3]));
        b.set(cx, cy + 1, pk3(R[3]));
        b.set(cx + 1, cy + 1, pk3(R[1]));
      }
    }
  }
  var SHELL = ["#5a2a3a", "#a85a68", "#e08a86", "#f6b49c", "#ffd8c0", "#fff2e4"];
  var SHELL_OFF = SHELL.map((c, i) => i === 0 ? c : mix(c, "#a89aa0", 0.3));
  function stampTex(text, color, angle, font) {
    const tw = measureText(text, font), capH = font === "small" ? 5 : 7;
    const bw = tw + 15, bh = capH + 12;
    const src = makeCanvas(bw, bh);
    const g = ctxOf(src);
    g.fillStyle = "#000";
    g.fillRect(2, 0, bw - 4, 2);
    g.fillRect(2, bh - 2, bw - 4, 2);
    g.fillRect(0, 2, 2, bh - 4);
    g.fillRect(bw - 2, 2, 2, bh - 4);
    g.fillRect(1, 1, 1, 1);
    g.fillRect(bw - 2, 1, 1, 1);
    g.fillRect(1, bh - 2, 1, 1);
    g.fillRect(bw - 2, bh - 2, 1, 1);
    g.fillRect(4, 3, bw - 8, 1);
    g.fillRect(4, bh - 4, bw - 8, 1);
    g.fillRect(3, 4, 1, bh - 8);
    g.fillRect(bw - 4, 4, 1, bh - 8);
    drawText(g, text, 7, 6, { font, color: "#ff0000" });
    const sd = g.getImageData(0, 0, bw, bh).data;
    const a1 = -Math.tan(angle / 2), b1 = Math.sin(angle);
    const D = Math.ceil(Math.hypot(bw, bh)) + 4, cx = Math.floor(bw / 2), cy = Math.floor(bh / 2), o = Math.floor(D / 2);
    const out = new PixelBuffer(D, D);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const si = (y * bw + x) * 4;
        if (sd[si + 3] < 128) continue;
        const isText = sd[si] > 128;
        let X = x - cx, Y = y - cy;
        X += Math.round(a1 * Y);
        Y += Math.round(b1 * X);
        X += Math.round(a1 * Y);
        const ox = X + o, oy = Y + o;
        const hs = hash2(ox, oy, 17), blot = hash2(ox >> 2, oy >> 2, 19);
        if (isText ? hs > 0.985 : hs > 0.94 || blot > 0.88 && hs > 0.5) continue;
        out.set(ox, oy, pk3(color, !isText && (hs > 0.8 || blot > 0.8) ? 150 : 235));
      }
    }
    return out.toCanvas();
  }
  function drawStamp(ctx2, x, y, text, opts = {}) {
    const color = opts.color || "#d8383a";
    let angle = opts.angle ?? -0.14;
    if (Math.abs(angle) > Math.PI) angle = angle * Math.PI / 180;
    angle = Math.round(angle * 100) / 100;
    const font = opts.font || "normal";
    const c = cached(`stamp|${text}|${color}|${angle}|${font}`, () => stampTex(String(text), color, angle, font), volatileTex, 96);
    const k = opts.scale || 1;
    if (k === 1) ctx2.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
    else {
      const dw = Math.round(c.width * k), dh = Math.round(c.height * k);
      ctx2.drawImage(c, Math.round(x - dw / 2), Math.round(y - dh / 2), dw, dh);
    }
  }
  function frameTex(w, h, style) {
    const b = new PixelBuffer(w, h);
    if (style === "gold") {
      const fw2 = 5;
      bandFrame(b, w, h, fw2, GOLD, { r: 1 });
      for (let x = 0; x < w; x++) {
        for (const yy of [2, h - 3]) if (x > 4 && x < w - 5 && x % 3 === 0) b.set(x, yy, pk3(GOLD[5]));
      }
      for (let y = 0; y < h; y++) {
        for (const xx of [2, w - 3]) if (y > 4 && y < h - 5 && y % 3 === 0) b.set(xx, y, pk3(GOLD[5]));
      }
      for (const [cx, cy] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) {
        for (const [dx, dy, c] of [[0, -1, 5], [-1, 0, 5], [1, 0, 3], [0, 1, 3], [0, 0, 1], [-1, -1, 4], [1, 1, 2], [1, -1, 4], [-1, 1, 3]]) b.set(cx + dx, cy + dy, pk3(GOLD[c]));
      }
      return b.toCanvas();
    }
    if (style === "coral") {
      const fw2 = 6;
      const bump = (x, y) => {
        const k = hash2(x >> 2, y >> 2, 31);
        return k > 0.55 ? 1 : 0;
      };
      const outer = (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return false;
        const d = Math.min(x, y, w - 1 - x, h - 1 - y);
        const corner = (x < 3 || x > w - 4) && (y < 3 || y > h - 4);
        if (corner) return Math.hypot(Math.min(x, w - 1 - x) - 3, Math.min(y, h - 1 - y) - 3) < 3.6;
        return d >= 1 - bump(x, y) || d >= 1;
      };
      const inner = (x, y) => x >= fw2 && y >= fw2 && x < w - fw2 && y < h - fw2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!outer(x, y) || inner(x, y)) continue;
          const d = Math.min(x, y, w - 1 - x, h - 1 - y);
          if (d === 0 && !bump(x, y)) continue;
          let v;
          const shape = (xx, yy) => outer(xx, yy) && !inner(xx, yy) && !(Math.min(xx, yy, w - 1 - xx, h - 1 - yy) === 0 && !bump(xx, yy));
          if (edgeOf(shape, x, y)) v = 0;
          else {
            const side = d === y ? "t" : d === x ? "l" : d === h - 1 - y ? "b" : "r";
            v = 3 + (side === "t" || side === "l" ? 0.8 : -0.5) - (d === fw2 - 1 ? 0.8 : 0);
            const hp = hash2(x, y, 5);
            if (hp > 0.86) v = 1.5;
            else if (hp > 0.78) v += 0.9;
          }
          b.set(x, y, pk3(step(v, CORAL, x, y)));
        }
      }
      return b.toCanvas();
    }
    const fw = 5;
    bandFrame(b, w, h, fw, WOOD_L, { r: 0, grain: true });
    for (let k = 1; k < fw; k++) {
      b.set(k, k, pk3(WOOD_L[1]));
      b.set(w - 1 - k, k, pk3(WOOD_L[1]));
      b.set(k, h - 1 - k, pk3(WOOD_L[1]));
      b.set(w - 1 - k, h - 1 - k, pk3(WOOD_L[1]));
    }
    return b.toCanvas();
  }
  function drawFrame(ctx2, x, y, w, h, opts = {}) {
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    const style = opts.style === "gold" || opts.style === "coral" ? opts.style : "wood";
    if (w >= 14 && h >= 14) ctx2.drawImage(cached(`frame|${w}|${h}|${style}`, () => frameTex(w, h, style)), x, y);
    const fw = style === "coral" ? 6 : 5;
    return { x: x + fw, y: y + fw, w: w - fw * 2, h: h - fw * 2 };
  }

  // src/overlay/card.js
  var CRUMB = spriteFromAscii(`
.kkkkk...
kwwwwwkk.
kwccccwwk
kwwwwwwwk
kwddwdddk
kwwwwwwk.
.kdddwwk.
..kwwkk..
...kk....
`, { k: "#2a2436", w: "#fbf7ee", c: "#3a7ae0", d: "#9aa2b4" });
  var CARD_W = 206;
  var CARD_H = 140;
  var CARD_LIFE = 6.5;
  function fitScale(sp, boxW, boxH) {
    const b = sp.look.body || {};
    const len = (b.len || (sp.look.kind === "chain" ? 60 : 30)) * (sp.look.kind === "seahorse" ? 0.6 : 1);
    const h = (b.h || 20) * (sp.look.kind === "seahorse" ? 1.8 : 1) + (sp.look.dorsal?.h || 4) + (sp.look.anal?.h || 3) + 6;
    return Math.min(1.8, Math.max(0.3, Math.min(boxW / Math.max(20, len * 1.35), boxH / Math.max(10, h))));
  }
  function fakeChain(x, y, t, sc) {
    const pts = [];
    for (let i = 0; i < 22; i++) pts.push({ x: x + 30 * sc - i * 3.2 * sc, y: y + Math.sin(t * 3 - i * 0.5) * 6 * sc });
    return pts;
  }
  function rigPose(sp, x, y, sc, t, emotion, look) {
    return {
      x,
      y,
      facing: 1,
      turn: 1,
      angle: Math.sin(t * 3) * 0.08,
      scale: sc,
      squash: 0,
      swimPhase: t * 0.9 % 1,
      tailPhase: t * 2.2 % 1,
      finPhase: t * 2.8 % 1,
      speed01: 0.5,
      inflate: 0,
      lookX: look ? look[0] : null,
      lookY: look ? look[1] : null,
      blink: t % 3 < 0.1 ? 1 : 0,
      emotion,
      mouth: Math.abs(Math.sin(t * 7)) * 0.3,
      time: t,
      chain: sp.look.kind === "chain" ? fakeChain(x, y, t, sc) : null
    };
  }
  function cardRect(card, W, H) {
    const k = card.t < 0.45 ? ease.outBack(clamp01(card.t / 0.45)) : 1;
    const out = card.t > CARD_LIFE - 0.35 ? ease.inBack(clamp01((card.t - (CARD_LIFE - 0.35)) / 0.35)) : 0;
    const x = Math.round(W - CARD_W - 10 + (1 - k) * (CARD_W + 20) + out * (CARD_W + 20));
    const y = Math.round(H - CARD_H - 12);
    return { x, y, w: CARD_W, h: CARD_H };
  }
  function drawCatchCard(ctx2, card, W, H, cursor) {
    const r = cardRect(card, W, H);
    const { sp, rec } = card;
    const rar = RARITY[sp.rarity] || RARITY.common;
    const cx = r.x + r.w / 2;
    drawWood(ctx2, r.x, r.y, r.w, r.h, { tone: "light" });
    drawPaper(ctx2, r.x + 6, r.y + 6, r.w - 12, r.h - 12, { aged: true });
    drawText(ctx2, card.isNew ? "NEW IN YOUR BROWSER!" : "CAUGHT!", cx, r.y + 11, { align: "center", font: "small", color: rar.dark });
    drawText(ctx2, sp.name, cx, r.y + 19, { align: "center", color: "#2a1a10", wave: sp.rarity === "legendary" ? 1 : 0, time: card.t });
    for (let i = 0; i < 5; i++) {
      const ic = getUiIcon(i < rar.stars ? "star" : "star_empty");
      ctx2.drawImage(ic, Math.round(cx - 27 + i * 11), r.y + 29);
    }
    const fr = drawFrame(ctx2, r.x + 14, r.y + 41, r.w - 28, 54, { style: sp.rarity === "legendary" ? "gold" : "wood" });
    ctx2.save();
    ctx2.beginPath();
    ctx2.rect(fr.x, fr.y, fr.w, fr.h);
    ctx2.clip();
    const bg = ctx2.createLinearGradient(0, fr.y, 0, fr.y + fr.h);
    bg.addColorStop(0, "#8ae0f0");
    bg.addColorStop(1, "#2a8ab8");
    ctx2.fillStyle = bg;
    ctx2.fillRect(fr.x, fr.y, fr.w, fr.h);
    const c = compiled(sp.look, rec.variant, sp.id);
    const sc = fitScale(sp, fr.w * 0.62, fr.h - 4) * ease.outBack(clamp01(card.t * 2.5));
    drawFishRig(ctx2, c, rigPose(sp, cx, fr.y + fr.h / 2 + Math.sin(card.t * 2) * 1.5, Math.max(0.2, sc), card.t, card.emotion, cursor ? [cursor.x, cursor.y] : null));
    ctx2.restore();
    const sy = r.y + 100;
    drawText(ctx2, `{fish} ${rec.sizeCm} cm  ${rec.weightKg} kg`, r.x + 14, sy, { color: "#3a2a1a" });
    drawText(ctx2, `"${rec.name}"`, r.x + r.w - 14, sy, { align: "right", color: "#3a2a1a" });
    let tx = r.x + 14;
    for (const tr of traitList(rec).slice(0, 3)) {
      const w = measureText(tr.text) + 6;
      if (tx + w > r.x + r.w - 14) break;
      ctx2.fillStyle = rgba("#2a1a10", 0.75);
      ctx2.fillRect(tx, sy + 11, w, 10);
      drawText(ctx2, tr.text, tx + 3, sy + 12, { color: tr.color });
      tx += w + 3;
    }
    drawText(ctx2, card.waiting > 1 ? `SAVED - ${card.waiting} FISH WAITING FOR FISHTOP` : "SAVED TO YOUR BROWSER BUCKET", cx, r.y + r.h - 12, { align: "center", font: "small", color: "#6a5a4a" });
    if (card.isNew && card.t > 0.5) {
      const st = clamp01((card.t - 0.5) * 5);
      ctx2.save();
      ctx2.globalAlpha = st;
      drawStamp(ctx2, r.x + r.w - 34, r.y + 52, "NEW!", { color: "#d8283a", angle: -0.25, scale: 1 + (1 - ease.outCubic(st)) * 1.2 });
      ctx2.restore();
    }
    return r;
  }
  function renderThumb(sp, rec, w = 72, h = 40) {
    try {
      const cv = makeCanvas(w, h);
      const g = ctxOf(cv);
      const c = compiled(sp.look, rec.variant, sp.id);
      drawFishRig(g, c, rigPose(sp, w / 2, h / 2, fitScale(sp, w * 0.78, h - 4), 0.4, "happy", null));
      return cv.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  // src/overlay/ext.js
  var DEFAULT_SETTINGS = { roaming: false, fishCount: 3, sound: false };
  var MAX_FISH = 6;
  function api() {
    try {
      const c = globalThis.chrome;
      return c && c.runtime && c.runtime.id ? c : null;
    } catch {
      return null;
    }
  }
  var ext = {
    get alive() {
      return !!api();
    },
    send(msg) {
      const c = api();
      if (!c) return Promise.resolve(null);
      try {
        const p = c.runtime.sendMessage(msg);
        return p && p.then ? p.catch(() => null) : Promise.resolve(null);
      } catch {
        return Promise.resolve(null);
      }
    },
    // fn(msg) -> value | Promise<value>; returns an unsubscribe function.
    onMessage(fn) {
      const c = api();
      if (!c) return () => {
      };
      const listener = (msg, sender, reply) => {
        if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("ft:")) return false;
        let r;
        try {
          r = fn(msg, sender);
        } catch {
          r = null;
        }
        if (r && r.then) {
          r.then(reply, () => reply(null));
          return true;
        }
        reply(r ?? null);
        return false;
      };
      c.runtime.onMessage.addListener(listener);
      return () => {
        try {
          c.runtime.onMessage.removeListener(listener);
        } catch {
        }
      };
    },
    async getLocal(keys) {
      const c = api();
      if (!c?.storage?.local) return {};
      try {
        return await c.storage.local.get(keys) || {};
      } catch {
        return {};
      }
    },
    onStorage(fn) {
      const c = api();
      if (!c?.storage?.onChanged) return () => {
      };
      const listener = (changes, area) => {
        if (area === "local") {
          try {
            fn(changes);
          } catch {
          }
        }
      };
      c.storage.onChanged.addListener(listener);
      return () => {
        try {
          c.storage.onChanged.removeListener(listener);
        } catch {
        }
      };
    }
  };

  // src/overlay/overlay.js
  var TARGET_W = 960;
  var FAR_Z = 0.55;
  var GHOST_TEXT = 0.24;
  var NO_AVOID = /* @__PURE__ */ new Set(["interest", "sniff", "script"]);
  var ICON_SET = new Set(UI_ICON_NAMES);
  var HOST_STYLE = "all:initial!important;display:block!important;position:fixed!important;left:0!important;top:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important;overflow:hidden!important;contain:strict!important;background:transparent!important;";
  var SHADOW_CSS = "canvas{display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;}@media print{:host{display:none!important}}";
  var POOL = SPECIES.filter((s) => !s.spawn?.hidden && !s.spawn?.requires && !s.spawn?.never);
  var MiniCamera = class {
    constructor(reduced) {
      this.reduced = reduced;
      this.trauma = 0;
      this.ox = 0;
      this.oy = 0;
      this.slowT = 0;
      this.slowScale = 1;
    }
    shake(n) {
      this.trauma = Math.min(6, this.trauma + n * (this.reduced ? 0.2 : 0.6));
    }
    punch() {
    }
    flash() {
    }
    slowmo(scale, time) {
      this.slowScale = scale;
      this.slowT = time;
    }
    timeScale() {
      return this.slowT > 0 ? this.slowScale : 1;
    }
    update(dt) {
      this.trauma = Math.max(0, this.trauma - dt * 18);
      this.ox = Math.round((Math.random() * 2 - 1) * this.trauma * 0.6);
      this.oy = Math.round((Math.random() * 2 - 1) * this.trauma * 0.6);
      this.slowT = Math.max(0, this.slowT - dt);
    }
  };
  var Overlay = class {
    constructor() {
      this.destroyed = false;
      this.standalone = !ext.alive;
      this.settings = { ...DEFAULT_SETTINGS };
      this.ready = false;
      this.fishingMode = false;
      this.manual = false;
      this.time = 0;
      this.timeScale = 1;
      this.fishes = [];
      this.arrivals = [];
      this.card = null;
      this.waiting = 0;
      this.caughtSpecies = /* @__PURE__ */ new Set();
      this.subs = [];
      this.errors = 0;
      this.scrollDX = 0;
      this.scrollDY = 0;
      this.scrollInner = 0;
      this.scrollSpeed = 0;
      this.lastScroll = { x: window.scrollX, y: window.scrollY };
      this.innerScroll = /* @__PURE__ */ new WeakMap();
      this.reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      this.W = TARGET_W;
      this.H = 540;
      this.k = 1;
      this.drewSomething = true;
      this.host = document.createElement("fishtop-overlay");
      this.shadow = this.host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = SHADOW_CSS;
      this.canvas = document.createElement("canvas");
      this.shadow.append(style, this.canvas);
      this.applyHostStyle();
      document.documentElement.appendChild(this.host);
      this.ctx = ctxOf(this.canvas);
      registerUiIcons();
      setRigBudget(3);
      this.stats = computeStats({ hook1: true });
      this.input = new OverlayInput(this.canvas, (x, y) => this.toLogical(x, y));
      this.particles = new Particles(260);
      this.particles.surfaceY = null;
      this.camera = new MiniCamera(this.reduced);
      this.scanner = new PageScanner(this.host);
      this.scratchC = null;
      const self = this;
      this.sound = {
        play(name, opts) {
          if (self.settings.sound && audio.isUnlocked()) audio.play(name, opts);
        },
        loop(name) {
          return self.settings.sound ? audio.loop(name) : { set() {
          }, stop() {
          } };
        }
      };
      const hour = (/* @__PURE__ */ new Date()).getHours();
      this.world = {
        W: this.W,
        H: this.H,
        surfaceY: null,
        floorAt: () => this.H - 16,
        cursor: { x: -100, y: -100, vx: 0, vy: 0, speed: 0, inWorld: false },
        hook: { x: 0, y: 0, active: false, inWater: false, bait: null, radiusMul: 1 },
        fishes: this.fishes,
        icons: [],
        windows: [],
        particles: this.particles,
        audio: this.sound,
        desktop: null,
        biome: "browser",
        night: false,
        dusk: false,
        weather: "clear",
        hour,
        secrets: {},
        rarityBoost: 1,
        calmMul: this.stats.calm,
        isTank: false,
        glowLevel: 0,
        requestNibble: (f) => this.fishingMode && this.fishing.requestNibble(f),
        rollMods: { mutationChance: this.stats.mutationChance, shinyChance: this.stats.shinyChance }
      };
      this.updateClock();
      this.bait = { kind: "icon", type: "bread", id: "crumb", mini: CRUMB, label: "Page Crumb" };
      this.game = {
        world: this.world,
        input: this.input,
        stats: this.stats,
        audio: this.sound,
        particles: this.particles,
        camera: this.camera,
        ui: { blocking: false },
        state: { stats: { casts: 0, snapped: 0, escaped: 0, caught: 0 } },
        paused: false,
        fishingDisabled: false,
        tutorialActive: false,
        timeScaleTarget: 1,
        currentBait: () => this.bait,
        consumeBait: () => {
        },
        // page crumbs never run out
        onHooked: () => {
        },
        onFishEscaped: () => {
        },
        onFishCaught: (f) => this.onFishCaught(f),
        toast: (text) => this.fishing.message(text, "#ffffff", 2.2)
      };
      this.fishing = new Fishing(this.game);
      const on = (t, type, fn, opts) => {
        t.addEventListener(type, fn, opts);
        this.subs.push(() => t.removeEventListener(type, fn, opts));
      };
      on(window, "resize", () => {
        this.resize();
        this.scanSoon(0.15);
      }, { passive: true });
      on(document, "scroll", (e) => this.onScroll(e), { capture: true, passive: true });
      on(document, "visibilitychange", () => this.onVisibility(), { passive: true });
      on(window, "keydown", (e) => {
        if (this.fishingMode && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.setFishing(false);
        }
      }, { capture: true });
      on(window, "pointerdown", () => {
        if (this.settings.sound) audio.unlock();
      }, { capture: true, passive: true });
      this.subs.push(ext.onMessage((msg) => this.onMessage(msg)));
      this.subs.push(ext.onStorage((ch) => this.onStorage(ch)));
      this.resize();
      this.spawnT = 0.6;
      this.scanT = 0;
      this.statusT = 0;
      this.aliveT = 4;
      this.last = performance.now();
      this.frame = this.frame.bind(this);
      this.raf = requestAnimationFrame(this.frame);
      this.init();
    }
    async init() {
      const st = await ext.getLocal(["settings", "catches"]);
      if (this.destroyed) return;
      this.applySettings(st.settings);
      this.loadCatches(st.catches);
      const hello = await ext.send({ type: "ft:hello", count: this.fishes.length, hidden: document.hidden, fishing: this.fishingMode });
      if (this.destroyed) return;
      if (hello && hello.ok === false) {
        this.destroy();
        return;
      }
      if (hello?.manual) this.manual = true;
      this.ready = true;
    }
    applySettings(s) {
      const prevSound = this.settings.sound;
      this.settings = { ...DEFAULT_SETTINGS, ...s && typeof s === "object" ? s : {} };
      this.settings.fishCount = clamp(Math.round(Number(this.settings.fishCount) || DEFAULT_SETTINGS.fishCount), 1, MAX_FISH);
      if (this.settings.sound && !prevSound) {
        audio.setMusic(null);
        audio.setAmbience("off");
        audio.setVolumes({ master: 0.55, music: 0, ambience: 0, sfx: 0.8 });
      }
      let extra = this.activeCount() - this.settings.fishCount;
      for (const f of this.fishes) {
        if (extra <= 0) break;
        if (!f.controlled && f.state !== "leave") {
          f.setState("leave");
          extra--;
        }
      }
    }
    loadCatches(list) {
      const arr = Array.isArray(list) ? list : [];
      this.caughtSpecies = new Set(arr.map((c) => c.species));
      this.waiting = arr.filter((c) => !c.sent).length;
    }
    onStorage(ch) {
      if (ch.settings) this.applySettings(ch.settings.newValue);
      if (ch.catches) this.loadCatches(ch.catches.newValue);
    }
    onMessage(msg) {
      if (this.destroyed) return null;
      switch (msg.type) {
        case "ft:ping":
          return { alive: true, fishing: this.fishingMode, count: this.fishes.length, queued: this.arrivals.length, manual: this.manual };
        case "ft:manual":
          this.manual = true;
          return { ok: true };
        case "ft:set-fishing":
          this.setFishing(!!msg.on);
          return { fishing: this.fishingMode };
        case "ft:toggle-fishing":
          this.setFishing(!this.fishingMode);
          return { fishing: this.fishingMode };
        case "ft:arrive":
          return { ok: this.acceptArrival(msg.fish) };
        case "ft:stop":
          setTimeout(() => this.destroy(), 0);
          return { stopped: true };
        default:
          return null;
      }
    }
    // ------------------------------------------------------------------ host / canvas
    applyHostStyle() {
      const fish = this.fishingMode;
      this.host.setAttribute("style", HOST_STYLE + `pointer-events:${fish ? "auto" : "none"}!important;cursor:${fish ? "none" : "auto"}!important;`);
    }
    resize() {
      const b = this.host.getBoundingClientRect();
      const cssW = b.width || window.innerWidth, cssH = b.height || window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      const devW = cssW * dpr, devH = cssH * dpr;
      let scale = Math.max(1, Math.round(devW / TARGET_W));
      while (scale > 1 && devH / scale < 420) scale--;
      while (devW / scale > 1400) scale++;
      const W = Math.max(64, Math.ceil(devW / scale)), H = Math.max(64, Math.ceil(devH / scale));
      if (W !== this.W || H !== this.H) {
        const kx = W / this.W, ky = H / this.H;
        for (const f of this.fishes) {
          f.x *= kx;
          f.y *= ky;
        }
        this.input.rescale(kx, ky);
        this.W = W;
        this.H = H;
        this.world.W = W;
        this.world.H = H;
      }
      this.cssW = cssW;
      this.cssH = cssH;
      this.k = W / cssW;
      if (this.canvas.width !== W) this.canvas.width = W;
      if (this.canvas.height !== H) this.canvas.height = H;
      this.ctx.imageSmoothingEnabled = false;
      this.drewSomething = true;
    }
    toLogical(cx, cy) {
      return [cx * this.k, cy * (this.H / (this.cssH || this.H))];
    }
    // ------------------------------------------------------------------ page events
    onScroll(e) {
      const t = e.target;
      if (t === document || t === document.documentElement || t === document.scrollingElement) {
        const x = window.scrollX, y = window.scrollY;
        this.scrollDX += x - this.lastScroll.x;
        this.scrollDY += y - this.lastScroll.y;
        this.lastScroll = { x, y };
      } else if (t && t.nodeType === 1) {
        const prev = this.innerScroll.get(t);
        const now2 = [t.scrollLeft, t.scrollTop];
        if (prev) this.scrollInner += Math.abs(now2[1] - prev[1]) + Math.abs(now2[0] - prev[0]);
        this.innerScroll.set(t, now2);
      }
      this.scanSoon(0.25);
    }
    onVisibility() {
      if (document.hidden) {
        this.input.release();
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      } else if (!this.raf && !this.destroyed) {
        this.last = performance.now();
        this.lastScroll = { x: window.scrollX, y: window.scrollY };
        this.scanSoon(0);
        this.raf = requestAnimationFrame(this.frame);
      }
      this.sendStatus(true);
    }
    scanSoon(t) {
      this.scanT = Math.min(this.scanT, t);
    }
    sendStatus(force) {
      if (!force && this.statusT > 0) return;
      this.statusT = 1;
      this.beatT = (this.beatT ?? 10) - 1;
      const s = `${this.fishes.length}|${document.hidden}|${this.fishingMode}`;
      if (!force && s === this.lastStatus && this.beatT > 0) return;
      this.beatT = 10;
      this.lastStatus = s;
      ext.send({ type: "ft:status", count: this.fishes.length, hidden: document.hidden, fishing: this.fishingMode });
    }
    // ------------------------------------------------------------------ fishing mode
    setFishing(on) {
      if (on === this.fishingMode || this.destroyed) return;
      this.fishingMode = on;
      this.applyHostStyle();
      if (on) {
        if (this.settings.sound) audio.unlock();
        this.bannerT = 0;
        this.fishing.message("Fishing mode! Your mouse is a hook.", "#ffe8a8", 2.4);
        this.scanSoon(0);
      } else {
        if (this.fishing.busy) this.fishing.releaseFish(true);
        this.fishing.hook.visible = false;
        this.world.hook.active = false;
        this.input.release();
        this.game.timeScaleTarget = 1;
      }
      this.sendStatus(true);
    }
    // ------------------------------------------------------------------ population
    activeCount() {
      let n = 0;
      for (const f of this.fishes) if (f.state !== "leave" || f.controlled) n++;
      return n;
    }
    updateClock() {
      const h = (/* @__PURE__ */ new Date()).getHours();
      const w = this.world;
      w.hour = h;
      w.night = h >= 20 || h < 6;
      w.dusk = h >= 18 && h < 20 || h >= 5 && h < 7;
      w.glowLevel = w.night ? 0.25 : 0;
    }
    weightOf(sp) {
      const w = this.world, spawn = sp.spawn || {};
      let wt = (RARITY[sp.rarity]?.weight ?? 10) * (spawn.weight ?? 1);
      if (sp.biome === "abyss") wt *= w.night ? 1 : 0.06;
      if (sp.activity === "night") wt *= w.night ? 2 : 0.2;
      if (sp.activity === "day") wt *= w.night ? 0.2 : 1.3;
      if (sp.activity === "dusk") wt *= w.dusk ? 3 : 0.4;
      if (spawn.weather && !String(spawn.weather).includes(w.weather)) wt *= 0.05;
      if (spawn.time && spawn.time !== (w.night ? "night" : "day")) wt *= 0.1;
      if (sp.bait?.browser) wt *= 1 + sp.bait.browser * 0.5;
      if (sp.rarity === "legendary" && this.fishes.some((f) => f.sp === sp)) wt = 0;
      return wt;
    }
    pickSpecies() {
      const pool = POOL.map((s) => ({ s, w: this.weightOf(s) })).filter((e) => e.w > 0);
      return pool.length ? rng.weighted(pool).s : null;
    }
    spawn(sp, opts = {}) {
      const w = this.world;
      const rec = opts.rec || rollIndividual(sp, w.rollMods);
      const fish = new Fish(rec, sp, w, { fadeIn: !!opts.fadeIn });
      const [d0, d1] = sp.move?.depth || [0.15, 0.85];
      const left = opts.side ? opts.side === "left" : rng.chance(0.5);
      fish.z = opts.z ?? (fish.style === "crawl" ? rng.float(0, 0.3) : rng.float(0, 0.75));
      const top = 16 + 14 * fish.scale, bot = w.floorAt() - 8 * fish.scale;
      fish.y = opts.yFrac !== void 0 ? clamp(opts.yFrac * this.H, top, bot) : lerp(top, bot, rng.float(d0, d1));
      if (opts.x !== void 0) {
        fish.x = opts.x;
        fish.y = opts.y ?? fish.y;
      } else if (fish.style === "crawl" || fish.style === "hop") {
        fish.x = left ? -30 : this.W + 30;
        fish.y = w.floorAt() - 5 * fish.scale;
        fish.facing = left ? 1 : -1;
        fish.turn = fish.facing;
        fish.target = { x: left ? rng.float(60, this.W * 0.4) : rng.float(this.W * 0.6, this.W - 60), y: fish.y, z: fish.z };
        fish.wanderT = rng.float(4, 8);
      } else {
        fish.x = left ? -40 : this.W + 40;
        fish.facing = left ? 1 : -1;
        fish.turn = fish.facing;
        fish.setState("enter");
        fish.enterTarget = { x: left ? rng.float(80, this.W * 0.55) : rng.float(this.W * 0.45, this.W - 80), y: fish.y };
      }
      fish.life = rng.float(50, 160);
      fish.extent = extentOf(sp);
      this.fishes.push(fish);
      return fish;
    }
    // A specific species (used by the test page; harmless otherwise).
    spawnSpecies(id, opts) {
      const sp = SPECIES_BY_ID[id];
      return sp && this.fishes.length < MAX_FISH ? this.spawn(sp, opts) : null;
    }
    updateSpawning(dt) {
      this.spawnT -= dt;
      const target = this.settings.fishCount;
      const active = this.activeCount();
      if (this.spawnT <= 0 && active < target && this.fishes.length < MAX_FISH) {
        const sp = this.pickSpecies();
        if (sp) {
          const room = Math.min(target - active, MAX_FISH - this.fishes.length);
          const n = sp.move?.school > 0.4 ? Math.min(room, rng.int(2, 3)) : 1;
          const lead = this.spawn(sp);
          for (let i = 1; i < n; i++) {
            const f = this.spawn(sp, { side: lead.x < 0 ? "left" : "right", z: lead.z, yFrac: (lead.y + rng.float(-20, 20)) / this.H });
            f.x = lead.x + (lead.x < 0 ? -1 : 1) * rng.float(10, 40);
            f.enterTarget = { x: lead.enterTarget.x + rng.float(-30, 30), y: f.y };
          }
        }
        this.spawnT = active < target * 0.5 ? rng.float(1.2, 2.5) : rng.float(4, 9);
      }
      if (this.arrivals.length) {
        this.arriveT = (this.arriveT ?? rng.float(0.4, 1.2)) - dt;
        if (this.arriveT <= 0) {
          this.arriveT = void 0;
          const a = this.arrivals.shift();
          const sp = SPECIES_BY_ID[a.rec.species];
          if (sp && this.fishes.length < MAX_FISH) {
            const f = this.spawn(sp, { rec: a.rec, side: a.side === "right" ? "left" : "right", yFrac: a.yFrac, z: a.z });
            f.hops = (a.hops || 0) + 1;
            f.say(rng.pick(["!", "heart", "music", "?"]), 1.6);
            const ex = f.x < 0 ? 2 : this.W - 2;
            this.particles.bubbles(ex, f.y, 6, { layer: "fg" });
          }
        }
      }
    }
    acceptArrival(fish) {
      if (!fish || typeof fish !== "object" || !fish.rec || typeof fish.rec.uid !== "string") return false;
      if (!SPECIES_BY_ID[fish.rec.species]) return false;
      if (this.fishes.length + this.arrivals.length >= MAX_FISH) return false;
      if (this.fishes.some((f) => f.rec.uid === fish.rec.uid)) return true;
      this.arrivals.push({ rec: fish.rec, side: fish.side === "left" ? "left" : "right", yFrac: clamp01(Number(fish.yFrac) || 0.5), z: clamp(Number(fish.z) || 0.2, 0, 0.75), hops: fish.hops | 0 });
      return true;
    }
    leaveTab(f) {
      const side = f.x < this.W / 2 ? "left" : "right";
      ext.send({ type: "ft:leave", fish: { rec: f.rec, side, yFrac: f.y / this.H, z: f.z, hops: f.hops || 0 } });
    }
    // ------------------------------------------------------------------ fish behaviour extras
    // Fish in front of the page swim around images: wander targets are moved off them and a fish that
    // touches one is eased back out with a sideways nudge so it slides around the edge.
    avoidMedia(f, dt) {
      if (f.controlled || f.z >= FAR_Z || f.style === "crawl" || f.style === "hop" || NO_AVOID.has(f.state)) return;
      const m = 6 + 10 * f.scale;
      for (const r of this.world.icons) {
        const x0 = r.x - m, y0 = r.y - m * 0.7, x1 = r.x + r.w + m, y1 = r.y + r.h + m * 0.7;
        fixPoint(f.target, x0, y0, x1, y1, this.W, this.H);
        fixPoint(f.enterTarget, x0, y0, x1, y1, this.W, this.H);
        if (f.x <= x0 || f.x >= x1 || f.y <= y0 || f.y >= y1) continue;
        const dl = f.x - x0, dr = x1 - f.x, du = f.y - y0, dd = y1 - f.y;
        const mn = Math.min(dl, dr, du, dd);
        const step2 = Math.min(mn, (90 + mn * 4) * dt);
        const tgt = f.target || { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (mn === dl || mn === dr) {
          const s = mn === dl ? -1 : 1;
          f.x += s * step2;
          f.vx = s > 0 ? Math.max(f.vx, 0) : Math.min(f.vx, 0);
          f.vy += Math.sign(tgt.y - cy || f.y - cy || 1) * 60 * dt * 4;
        } else {
          const s = mn === du ? -1 : 1;
          f.y += s * step2;
          f.vy = s > 0 ? Math.max(f.vy, 0) : Math.min(f.vy, 0);
          f.vx += Math.sign(tgt.x - cx || f.x - cx || 1) * 60 * dt * 4;
        }
      }
    }
    applyCurrent(dt) {
      const dx = this.scrollDX * this.k, dy = this.scrollDY * this.k;
      const inner = this.scrollInner * this.k;
      this.scrollDX = 0;
      this.scrollDY = 0;
      this.scrollInner = 0;
      this.scanner.shift(dx, dy);
      const sp = (Math.hypot(dx, dy) + inner * 0.5) / Math.max(dt, 1e-3);
      this.scrollSpeed = damp(this.scrollSpeed, sp, 8, dt);
      if (!dx && !dy && !inner) return;
      const mul = this.reduced ? 0.15 : 0.35;
      for (const f of this.fishes) {
        if (f.controlled) continue;
        const drag = mul * (1 - f.z * 0.5) / Math.max(0.6, f.scale);
        f.x -= dx * drag;
        f.y -= dy * drag;
        f.vx = clamp(f.vx - dx / Math.max(dt, 1e-3) * 0.04, -260, 260);
        f.vy = clamp(f.vy - (dy || inner * Math.sign(rng.float(-1, 1))) / Math.max(dt, 1e-3) * 0.04, -260, 260);
      }
      if (this.scrollSpeed > 1400 && !this.reduced) {
        for (const f of this.fishes) {
          if (f.controlled || !rng.chance(dt * 2.5)) continue;
          f.feel(rng.pick(["dizzy", "surprised", "scared"]), 1.4);
          if (rng.chance(0.5)) f.say(rng.pick(["!", "!!", "?"]), 1);
          f.squashV += 6;
        }
      }
      if (this.scrollSpeed > 300 && rng.chance(Math.min(1, dt * this.scrollSpeed / 220))) {
        const up = dy > 0;
        this.particles.bubble(rng.float(0, this.W), up ? this.H + 4 : rng.float(0, this.H), { vy: up ? -rng.float(40, 90) : rng.float(-20, 20), layer: "fg", size: rng.pick([1, 1, 2]) });
      }
    }
    updateFishes(dt) {
      const w = this.world;
      for (const f of this.fishes) {
        f.update(dt);
        if (!f.controlled) {
          this.avoidMedia(f, dt);
          const top = 6 + 12 * f.scale * (1 - f.z * 0.5);
          if (f.y < top) {
            f.y = damp(f.y, top, 6, dt);
            f.vy = Math.max(f.vy, 0);
          }
          if (f.state !== "leave" && f.age > f.life && f.state !== "sniff" && f.state !== "interest" && f.state !== "hide") f.setState("leave");
          if (f.state === "wander" && w.windows.length && f.stateT > 3 && rng.chance(dt * 0.05 * (0.25 + f.shyness))) f.goHide();
        }
      }
      for (let i = this.fishes.length - 1; i >= 0; i--) {
        const f = this.fishes[i];
        if (!f.dead) continue;
        this.fishes.splice(i, 1);
        if (f !== this.fishing.fish) this.leaveTab(f);
      }
    }
    // ------------------------------------------------------------------ catching
    onFishCaught(fish) {
      const sp = fish.sp;
      const i = this.fishes.indexOf(fish);
      if (i >= 0) this.fishes.splice(i, 1);
      const rec = { ...fish.rec, species: sp.id, caughtAt: Date.now() };
      const isNew = !this.caughtSpecies.has(sp.id);
      this.caughtSpecies.add(sp.id);
      this.waiting++;
      const record = { ...rec, rarity: sp.rarity, speciesName: sp.name, source: "browser", sent: false, thumb: renderThumb(sp, rec) };
      ext.send({ type: "ft:caught", record });
      this.card = { rec, sp, isNew, t: 0, emotion: fish.emotion && fish.emotion !== "neutral" ? fish.emotion : "happy", waiting: this.waiting };
      this.game.state.stats.caught++;
      const snd = sp.rarity === "legendary" ? "catch_legendary" : sp.rarity === "epic" ? "catch_epic" : sp.rarity === "rare" ? "catch_rare" : "catch";
      this.sound.play(snd);
      if (sp.sound) setTimeout(() => this.sound.play(sp.sound, { pitch: 1 / Math.max(0.6, fish.scale) }), 250);
      this.particles.burst(fish.x, fish.y, 22, { colors: ["#ffffff", "#ffe27a", RARITY[sp.rarity]?.color || "#9af0ff"], speed: 110, g: 40, life: 0.9 });
      this.particles.ring(fish.x, fish.y, 1.2);
      this.sendStatus(true);
    }
    // ------------------------------------------------------------------ loop
    frame(now2) {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(this.frame);
      const busy = this.fishingMode || this.card || this.fishing.busy;
      const minDt = busy ? 0 : 1 / 30 - 3e-3;
      let dt = (now2 - this.last) / 1e3;
      if (dt < minDt) return;
      this.last = now2;
      dt = Math.min(dt, 1 / 20);
      try {
        this.update(dt);
        this.draw();
      } catch (e) {
        this.errors++;
        console.warn("[FISHTOP overlay]", e);
        if (this.errors > 3) this.destroy();
      }
      this.input.endFrame();
    }
    update(dtReal) {
      const inp = this.input, w = this.world, cur = w.cursor;
      inp.update(dtReal);
      this.camera.update(dtReal);
      this.timeScale = damp(this.timeScale, this.game.timeScaleTarget * this.camera.timeScale(), 10, dtReal);
      const dt = dtReal * this.timeScale;
      this.time += dt;
      this.statusT -= dtReal;
      this.aliveT -= dtReal;
      if (this.aliveT <= 0) {
        this.aliveT = 4;
        this.updateClock();
        if (!this.standalone && !ext.alive) {
          this.destroy();
          return;
        }
      }
      let overCard = false;
      if (this.card) {
        this.card.t += dtReal;
        const r = cardRect(this.card, this.W, this.H);
        overCard = inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h;
        if (this.fishingMode && overCard && inp.pressed) {
          this.card.t = Math.max(this.card.t, CARD_LIFE - 0.35);
          inp.consume();
        }
        if (this.card.t >= CARD_LIFE) this.card = null;
      }
      this.overCard = overCard && this.fishingMode;
      cur.x = inp.x;
      cur.y = inp.y;
      cur.vx = inp.vx;
      cur.vy = inp.vy;
      cur.speed = inp.speed;
      cur.inWorld = inp.inside && !this.overCard;
      this.applyCurrent(dtReal);
      this.scanT -= dtReal;
      if (this.scanT <= 0 && (this.fishes.length || this.fishingMode)) {
        this.scanT = 1.6;
        this.scanner.scan(this.cssW, this.cssH, this.k);
        w.icons = this.scanner.icons;
        w.windows = this.scanner.windows;
      }
      if (this.ready) this.updateSpawning(dt);
      this.updateFishes(dt);
      const worldInput = this.fishingMode && inp.inside && !this.overCard;
      this.fishing.update(dt, worldInput);
      this.particles.update(dt);
      if (this.fishingMode) this.bannerT = (this.bannerT || 0) + dtReal;
      this.sendStatus(false);
    }
    draw() {
      const ctx2 = this.ctx;
      const active = this.fishes.length || this.particles.list.length || this.card || this.fishingMode || this.fishing.busy;
      if (!active && !this.drewSomething) return;
      ctx2.setTransform(1, 0, 0, 1, 0, 0);
      ctx2.globalAlpha = 1;
      ctx2.globalCompositeOperation = "source-over";
      ctx2.clearRect(0, 0, this.W, this.H);
      this.drewSomething = !!active;
      if (!active) return;
      if (this.camera.ox || this.camera.oy) ctx2.setTransform(1, 0, 0, 1, this.camera.ox, this.camera.oy);
      this.drawFishes(ctx2);
      this.particles.draw(ctx2, "fg", this.time);
      this.fishing.drawWorld(ctx2);
      ctx2.setTransform(1, 0, 0, 1, 0, 0);
      this.fishing.drawHud(ctx2);
      this.particles.draw(ctx2, "ui", this.time);
      if (this.card) drawCatchCard(ctx2, this.card, this.W, this.H, this.world.cursor);
      if (this.fishingMode) this.drawBanner(ctx2);
      this.drawCursor(ctx2);
    }
    drawFishes(ctx2) {
      const list = this.fishes.slice().sort((a, b) => b.z - a.z);
      for (const f of list) {
        if (f.alpha <= 0) continue;
        if (f.wiggle) f.wiggle = Math.max(0, f.wiggle - 0.02);
        const haze = clamp01((f.z - 0.3) * 0.9) * 0.45;
        const st = f.rigState({ wash: haze > 0.03 ? { color: "#8ab8d8", alpha: haze } : null, glow: this.world.glowLevel, time: this.time });
        let alpha = f.alpha * (1 - f.z * 0.25);
        if (f.camo > 0.05) alpha *= 1 - f.camo * 0.8;
        if (f.rec.variant?.mutation === "ghost") alpha *= 0.65;
        const hiding = !f.controlled && f.state === "hide";
        const far = !f.controlled && f.z >= FAR_Z;
        const box = hiding || far ? this.boxOf(f, st) : null;
        const occ = box ? this.occluders(box, far, hiding || far) : null;
        if (occ && (occ.media.length || occ.text.length)) this.drawOccluded(ctx2, f, st, alpha, box, occ);
        else {
          if (alpha < 1) ctx2.globalAlpha = alpha;
          f.anchors = drawFishRig(ctx2, f.c, st);
          ctx2.globalAlpha = 1;
        }
        this.drawExtras(ctx2, f);
      }
    }
    boxOf(f, st) {
      if (f.chain) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of f.chain) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
        const pad = 16 * st.scale + 6;
        return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2), h: Math.ceil(y1 - y0 + pad * 2) };
      }
      const rx = f.extent[0] * st.scale + 10, ry = f.extent[1] * st.scale * (1 + (f.inflate || 0)) + 10;
      return { x: Math.floor(st.x - rx), y: Math.floor(st.y - ry), w: Math.ceil(rx * 2), h: Math.ceil(ry * 2) };
    }
    occluders(b, media, text) {
      const out = { media: [], text: [] };
      const hit = (r) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y;
      if (media) {
        for (const r of this.world.icons) if (hit(r)) out.media.push(r);
      }
      if (text) {
        for (const r of this.world.windows) if (hit(r)) {
          for (const l of this.scanner.linesOf(r)) if (hit(l)) out.text.push(l);
        }
      }
      return out;
    }
    scratch(w, h) {
      if (!this.scratchC || this.scratchC.width < w || this.scratchC.height < h) {
        this.scratchC = makeCanvas(Math.max(w, this.scratchC?.width || 0, 64), Math.max(h, this.scratchC?.height || 0, 64));
        this.scratchG = ctxOf(this.scratchC);
      }
      this.scratchG.setTransform(1, 0, 0, 1, 0, 0);
      this.scratchG.globalAlpha = 1;
      this.scratchG.globalCompositeOperation = "source-over";
      this.scratchG.clearRect(0, 0, w, h);
      return this.scratchG;
    }
    // Draw a fish that is behind page content: nothing shows through images, a faint ghost shows
    // through lines of text, and everything outside them is drawn normally.
    drawOccluded(ctx2, f, st, alpha, b, occ) {
      const g = this.scratch(b.w, b.h);
      g.save();
      g.translate(-b.x, -b.y);
      f.anchors = drawFishRig(g, f.c, st);
      g.restore();
      const cut = (r) => g.clearRect(Math.round(r.x) - b.x, Math.round(r.y) - b.y, Math.round(r.w), Math.round(r.h));
      for (const r of occ.media) cut(r);
      ctx2.globalAlpha = alpha * GHOST_TEXT;
      ctx2.drawImage(this.scratchC, 0, 0, b.w, b.h, b.x, b.y, b.w, b.h);
      for (const r of occ.text) cut(r);
      ctx2.globalAlpha = alpha;
      ctx2.drawImage(this.scratchC, 0, 0, b.w, b.h, b.x, b.y, b.w, b.h);
      ctx2.globalAlpha = 1;
    }
    drawExtras(ctx2, f) {
      if (f.emote && f.z < 0.5) {
        const top = f.anchors?.top || [f.x, f.y - 14];
        const k = f.emote.t / f.emote.max;
        const y = Math.round(top[1] - 10 - Math.min(1, f.emote.t * 6) * 4);
        const name = f.emote.icon;
        ctx2.globalAlpha = Math.min(1, (1 - k) * 4) * Math.min(1, f.alpha);
        if (ICON_SET.has(name)) {
          const icon = getUiIcon(name);
          ctx2.drawImage(icon, Math.round(top[0] - icon.width / 2), y - icon.height);
        } else {
          drawText(ctx2, name, top[0], y - 8, { align: "center", color: name.startsWith("!") ? "#ffe27a" : "#ffffff", outline: "#14202c", scale: name.startsWith("!") ? 2 : 1 });
        }
        ctx2.globalAlpha = 1;
      }
      if (f.rec.variant?.shiny && rng.chance(0.06)) this.particles.sparkle(f.x + rng.float(-10, 10) * f.scale, f.y + rng.float(-6, 6) * f.scale, "#fff6b0");
    }
    drawBanner(ctx2) {
      const text = this.fishing.busy ? "{hook} Fishing - Esc to stop" : "{hook} Fishing mode - Esc to stop  {bait} Page Crumb";
      const w = measureText(text) + 12;
      const x = Math.round(this.W / 2 - w / 2), y = 4;
      const a = Math.min(1, (this.bannerT || 0) * 4);
      ctx2.globalAlpha = a * 0.82;
      ctx2.fillStyle = "#0b1622";
      ctx2.fillRect(x + 1, y, w - 2, 15);
      ctx2.fillRect(x, y + 1, w, 13);
      ctx2.globalAlpha = a;
      ctx2.fillStyle = rgba("#7fd6c8", 0.6);
      ctx2.fillRect(x + 1, y + 14, w - 2, 1);
      drawText(ctx2, text, x + 6, y + 4, { color: "#ffe8a8" });
      ctx2.globalAlpha = 1;
    }
    drawCursor(ctx2) {
      if (!this.fishingMode || !this.input.inside) return;
      let name = null;
      if (this.fishing.fighting) name = "cursor_reel";
      else if (this.overCard) name = "cursor_hand";
      if (!name) return;
      const spr = getUiIcon(name);
      const hs = CURSOR_HOTSPOT[name] || [0, 0];
      ctx2.drawImage(spr, Math.round(this.input.x) - hs[0], Math.round(this.input.y) - hs[1]);
    }
    // ------------------------------------------------------------------ teardown
    wake() {
      if (document.hidden || this.raf || this.destroyed) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      try {
        if (this.fishing.busy) this.fishing.releaseFish(false);
      } catch {
      }
      for (const off of this.subs) off();
      this.subs.length = 0;
      this.input.destroy();
      this.scanner.clear();
      this.fishes.length = 0;
      this.host.remove();
      ext.send({ type: "ft:bye" });
      if (window.__FISHTOP_OVERLAY__ === this) window.__FISHTOP_OVERLAY__ = null;
    }
  };
  function fixPoint(p, x0, y0, x1, y1, W, H) {
    if (!p || p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1) return;
    const opts = [
      [x0 - 2, p.y, p.x - x0],
      [x1 + 2, p.y, x1 - p.x],
      [p.x, y0 - 2, p.y - y0],
      [p.x, y1 + 2, y1 - p.y]
    ].filter(([x, y]) => x > 12 && x < W - 12 && y > 12 && y < H - 12).sort((a, b) => a[2] - b[2]);
    if (opts.length) {
      p.x = opts[0][0];
      p.y = opts[0][1];
    }
  }
  function extentOf(sp) {
    const b = sp.look.body || {};
    const len = (b.len || 40) + (sp.look.tail?.len || 10);
    const h = (b.h || 24) + Math.max(sp.look.dorsal?.h || 0, 6) + Math.max(sp.look.anal?.h || 0, 4);
    return [len * 0.62 + 12, h * 0.62 + 14];
  }

  // src/overlay/main.js
  (function boot() {
    if (window.top !== window) return;
    if (document.documentElement?.localName !== "html") return;
    const prev = window.__FISHTOP_OVERLAY__;
    if (prev && !prev.destroyed) {
      prev.wake();
      return;
    }
    window.__FISHTOP_OVERLAY__ = new Overlay();
  })();
})();
