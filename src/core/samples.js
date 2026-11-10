// Recorded audio: every sound the game makes comes from CC0 / public-domain recordings and compositions
// (assets/sfx, assets/music; sources and licences in assets/sfx/CREDITS.md), embedded as base64 OGG
// by tools/gen-samples.mjs. The procedural synth in audio.js is only an emergency fallback.
//
//   SAMPLE_MAP      game sound name -> clip variants ('id' or {id, p: pitch mul, g: gain mul})
//   hasClip(id)     clip embedded?            clipBuffer(id) -> AudioBuffer|null (kicks off a decode)
//   decodeClip(ctx, id) -> Promise<AudioBuffer|null>
//   warmSamples(ctx)    decode every one-shot / loop clip in the background (music decodes on demand)
//   playSample(ctx, dry, wet, name, {vol, pitch, pan, verb}) -> true | 'pending' | false
//   playClip(ctx, dest, id, {at, vol, rate, pan, wet, verb, lp}) -> source | null
import { SAMPLE_DATA } from './samples-data.js';

const V = (id, p = 1, g = 1) => ({ id, p, g });

export const SAMPLE_MAP = {
  // ---- UI
  ui_click: ['click1', 'click2', 'k_click1'],
  ui_hover: ['hover1', V('k_tick2', 1.1, 0.7)],
  ui_open: ['k_open1', 'k_open2'],
  ui_close: ['k_close1', 'k_close2'],
  ui_buy: ['buy1', V('coins_pile2', 1.05)],
  ui_error: ['k_err1', 'k_err2', 'k_err3'],
  ui_unlock: ['k_confirm1', 'k_confirm2'],
  ui_page: ['page1', 'page2'],
  ui_toggle: ['toggle1', 'k_toggle2'],
  ui_tab: ['tab1', 'tab2'],
  ui_type: ['k_tick1', 'k_tick4'],
  notify: ['bell', V('k_bong', 1, 0.8)],
  icon_pickup: ['k_pluck2', V('k_pluck1', 1.2)],
  icon_drop: ['plop2', 'k_drop2'],
  icon_box: ['box_thud', 'wood_close1'],
  window_open: ['k_max'],
  window_close: ['k_min'],
  window_min: ['k_min2'],
  box_open: ['box_open', 'chest_creak'],
  box_close: ['wood_close1', 'wood_close2'],
  // ---- fishing
  cast: ['cast1', 'cast2', 'cast3'],
  splash_small: ['splash_s1', 'splash_s2', 'splash_s3', 'splash_s4', 'splash_s5'],
  splash_big: ['splash_b1', 'splash_b2', 'splash_b3', 'splash_b4'],
  nibble: ['nibble1', 'nibble2', V('bub4', 1.2)],
  bite: ['bite1', 'bite2', 'bite3'],
  hookset: ['swish_a', 'swish_b', 'swish_c'],
  reel: ['reel1', 'reel2'],
  reel_tick: ['k_tick4', V('k_tick1', 1.1)],
  line_snap: ['snap1', 'snap2'],
  escape: ['escape1', 'escape2'],
  catch: ['jin_catch1', 'jin_catch2'],
  catch_rare: ['jin_rare1', 'jin_rare2'],
  catch_epic: ['jin_epic'],
  catch_legendary: ['jin_legend'],
  new_species: ['jin_species'],
  record: ['jin_record'],
  net_swish: ['net1', V('net1', 1.15)],
  mash_pop: ['pop1', 'pop_b', 'pop_c', 'plop1'],
  timing_good: ['k_confirm3', 'jin_good'],
  timing_perfect: ['k_glass4', V('spk1', 1.1)],
  timing_miss: ['k_back2', 'k_back4'],
  dodge_hit: ['hit1', 'hit2'],
  slack_warn: ['creak1', 'creak2', 'creak3'],
  jump_out: ['jump1', 'jump2'],
  // ---- fish voices
  blub: ['bubble2', 'pop1', V('bub5', 0.8)],
  honk: ['honk1', 'honk3', V('honk2', 1, 0.7)],
  puff: ['air1', 'air2', 'inflate1'],
  deflate: ['deflate1'],
  squeak: ['squeak1', 'squeak2', 'squeak3', 'cute1'],
  grunt: ['grunt1', 'grunt2'],
  boing: ['boing1', 'boing2', 'boing3'],
  glitch: ['k_glitch1', 'k_glitch2'],
  click: ['clk1', 'clk2', V('k_click3', 1, 0.8)],
  roar: ['roar1', 'roar2', 'roar3'],
  chirp: ['chirp1', 'chirp2', 'chirp3', 'cute2'],
  bell: ['bell', 'bell2'],
  gulp: ['gulp', 'gulp2', V('crunch1', 1.1, 0.8)],
  snore: ['snore1'],
  // ---- coins
  coin_spawn: ['coin_a', V('coin_c', 1.1)],
  coin_bounce: ['coin_b', 'coin_c'],
  coin_collect: ['coin_d', V('coin_c', 1.06)],
  coin_pile: ['coins_pile1', 'coins_pile2'],
  coins_many: ['coins_many1', V('buy1', 0.95)],
  // ---- world
  bubble: ['bubble1', 'bubble2', 'bubble3', 'bub4', 'bub5'],
  bubbles: ['bubbles_a', 'bubbles_b', 'bubble1', 'bubble3'],
  whale_call: ['whale1', 'whale2', 'whale3'],
  thunder: ['thunder1', 'thunder2'],
  crab_scuttle: ['scuttle'],
  vending: ['vending'],
  sonar: ['sonar1'],
  static_burst: ['static1', 'static2'],
  crt_on: ['crt_on'],
  treasure_open: ['treasure1'],
  sparkle: ['spk1', 'spk2', 'spk3', 'k_glass1', 'k_glass3'],
  magic: ['magic1', 'magic2'],
  flood_rush: ['flood_rush1'],
  worm_squish: ['squish1', 'squish2'],
  golden_shimmer: ['shimmer1', 'shimmer2'],
  travel_whoosh: ['travel1', 'travel2'],
  arrive: ['jin_arrive'],
  ice_crack: ['ice1', 'ice2', 'ice3'],
  ice_chime: [V('k_glass4', 0.8), V('spk3', 0.7)],
  penguin: ['penguin1', 'penguin2'],
  eruption_boom: ['boom', 'boom2'],
  neon_buzz: ['buzz1', 'buzz2'],
  train_ding: ['ding2', 'bell'],
  unlock_biome: ['jin_biome'],
  // legacy aliases kept for older callers
  chest_hit: ['hit1', 'hit2'], lock_open: ['key_open'],
};

// level trim per sound name (clips are loudness-normalised, so this is the mix)
const GAIN = {
  ui_click: 0.32, ui_hover: 0.16, ui_open: 0.4, ui_close: 0.36, ui_buy: 0.5, ui_error: 0.32, ui_unlock: 0.38,
  ui_page: 0.45, ui_toggle: 0.35, ui_tab: 0.32, ui_type: 0.2, notify: 0.4, icon_pickup: 0.35, icon_drop: 0.4,
  icon_box: 0.45, window_open: 0.35, window_close: 0.35, window_min: 0.35, box_open: 0.55, box_close: 0.5,
  cast: 0.55, splash_small: 0.5, splash_big: 0.7, nibble: 0.45, bite: 0.6, hookset: 0.55, reel: 0.4, reel_tick: 0.28,
  line_snap: 0.6, escape: 0.5, catch: 0.55, catch_rare: 0.55, catch_epic: 0.6, catch_legendary: 0.6, new_species: 0.6,
  record: 0.55, net_swish: 0.55, mash_pop: 0.45, timing_good: 0.45, timing_perfect: 0.45, timing_miss: 0.42,
  dodge_hit: 0.5, slack_warn: 0.45, jump_out: 0.6, blub: 0.5, honk: 0.5, puff: 0.45, deflate: 0.5, squeak: 0.42,
  grunt: 0.5, boing: 0.45, glitch: 0.3, click: 0.4, roar: 0.6, chirp: 0.45, bell: 0.4, gulp: 0.5, snore: 0.45,
  coin_spawn: 0.32, coin_bounce: 0.3, coin_collect: 0.4, coin_pile: 0.45, coins_many: 0.5,
  bubble: 0.42, bubbles: 0.45, whale_call: 0.55, thunder: 0.7, crab_scuttle: 0.4, vending: 0.5, sonar: 0.5,
  static_burst: 0.3, crt_on: 0.4, treasure_open: 0.6, sparkle: 0.35, magic: 0.45, flood_rush: 0.6, worm_squish: 0.5,
  golden_shimmer: 0.45, travel_whoosh: 0.55, arrive: 0.5, ice_crack: 0.5, ice_chime: 0.4, penguin: 0.45,
  eruption_boom: 0.7, neon_buzz: 0.3, train_ding: 0.45, unlock_biome: 0.6,
};
// reverb send per name (recordings already carry their own room; keep sends small)
const VERB = { whale_call: 0.35, sonar: 0.3, bell: 0.2, notify: 0.12, thunder: 0.2, golden_shimmer: 0.25, magic: 0.18, sparkle: 0.15,
  ui_hover: 0, ui_click: 0.02, ui_tab: 0.02, ui_type: 0, reel_tick: 0, reel: 0.02, click: 0.06 };
// at most this many overlapping copies of one sound (the oldest is faded out)
const MAX_SAME = { reel_tick: 2, ui_hover: 2, ui_click: 3, coin_bounce: 4, coin_collect: 4, sparkle: 4, bubble: 5, mash_pop: 4 };
const MAX_VOICES = 40;

const buffers = new Map(); // clip id -> AudioBuffer | Promise | 'failed'
const live = []; // {name, src, g, end}
const lastIdx = new Map();

export const hasClip = (id) => !!SAMPLE_DATA[id];

export function decodeClip(ctx, id) {
  const b = buffers.get(id);
  if (b instanceof AudioBuffer) return Promise.resolve(b);
  if (b === 'failed') return Promise.resolve(null);
  if (b) return b;
  const b64 = SAMPLE_DATA[id];
  if (!b64 || !ctx) { buffers.set(id, 'failed'); return Promise.resolve(null); }
  let p;
  try {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    p = new Promise((res) => ctx.decodeAudioData(u8.buffer, res, () => res(null)))
      .then((buf) => { buffers.set(id, buf || 'failed'); return buf || null; }, () => { buffers.set(id, 'failed'); return null; });
  } catch (e) { buffers.set(id, 'failed'); return Promise.resolve(null); }
  buffers.set(id, p);
  return p;
}

export function clipBuffer(ctx, id) {
  const b = buffers.get(id);
  if (b instanceof AudioBuffer) return b;
  if (b === undefined && ctx) decodeClip(ctx, id);
  return null;
}
export const clipFailed = (id) => buffers.get(id) === 'failed' || !SAMPLE_DATA[id];

// drop a decoded clip (music tracks are big; only the playing ones stay decoded)
export function releaseClip(id) { if (buffers.get(id) instanceof AudioBuffer) buffers.delete(id); }

export function warmSamples(ctx, extra = []) {
  const ids = new Set(extra);
  for (const vs of Object.values(SAMPLE_MAP)) for (const v of vs) ids.add(typeof v === 'string' ? v : v.id);
  // stagger the decodes so unlock does not stall the main thread
  const list = [...ids].filter((id) => !buffers.has(id));
  let i = 0;
  const step = () => { for (let n = 0; n < 12 && i < list.length; n++, i++) decodeClip(ctx, list[i]); if (i < list.length) setTimeout(step, 16); };
  step();
}

// one decoded clip -> dest, scheduled at `at`. Returns the source (with .gain) or null when not decoded yet.
export function playClip(ctx, dest, id, { at = 0, vol = 1, rate = 1, pan = 0, wet = null, verb = 0, lp = 0, dur = 0 } = {}) {
  const buf = clipBuffer(ctx, id);
  if (!buf || !dest) return null;
  const t = Math.max(ctx.currentTime, at || 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.1, Math.min(8, rate));
  const g = ctx.createGain();
  g.gain.value = Math.max(0, vol);
  let n = src;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.min(lp, ctx.sampleRate * 0.45); n.connect(f); n = f; }
  n.connect(g);
  let out = g;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); out = p; }
  out.connect(dest);
  if (wet && verb > 0) { const s = ctx.createGain(); s.gain.value = verb; out.connect(s); s.connect(wet); }
  const len = buf.duration / src.playbackRate.value;
  if (dur && dur < len) { g.gain.setValueAtTime(g.gain.value, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur); src.start(t); src.stop(t + dur + 0.02); }
  else src.start(t);
  src.gain = g;
  src.endAt = t + Math.min(len, dur || len);
  src.onended = () => { try { src.disconnect(); g.disconnect(); out.disconnect(); } catch (e) { /* ignore */ } };
  return src;
}

function fadeKill(ctx, v) {
  const t = ctx.currentTime;
  try {
    v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.linearRampToValueAtTime(0, t + 0.03);
    v.src.stop(t + 0.04);
  } catch (e) { /* ignore */ }
  v.end = 0;
}

function pickVariant(name, vs, ctx) {
  // never the same clip twice in a row; prefer decoded variants
  const ready = [];
  for (let i = 0; i < vs.length; i++) if (clipBuffer(ctx, typeof vs[i] === 'string' ? vs[i] : vs[i].id)) ready.push(i);
  if (!ready.length) return -1;
  const last = lastIdx.get(name);
  const pool = ready.length > 1 ? ready.filter((i) => i !== last) : ready;
  const i = pool[(Math.random() * pool.length) | 0];
  lastIdx.set(name, i);
  return i;
}

export function playSample(ctx, dry, wet, name, { vol = 1, pitch = 1, pan = 0, verb } = {}) {
  const vs = SAMPLE_MAP[name];
  if (!vs || !ctx) return false;
  const i = pickVariant(name, vs, ctx);
  if (i < 0) return vs.every((v) => clipFailed(typeof v === 'string' ? v : v.id)) ? false : 'pending';
  const v = typeof vs[i] === 'string' ? { id: vs[i], p: 1, g: 1 } : vs[i];
  const now = ctx.currentTime;
  for (let k = live.length - 1; k >= 0; k--) if (live[k].end <= now) live.splice(k, 1);
  const same = live.filter((l) => l.name === name);
  if (same.length >= (MAX_SAME[name] ?? 6)) fadeKill(ctx, same[0]);
  if (live.length >= MAX_VOICES) fadeKill(ctx, live[0]);
  // slight random pitch + level so repeats never sound machine-gunned
  const rate = pitch * v.p * (0.965 + Math.random() * 0.07);
  const g = Math.min(2, vol) * (GAIN[name] ?? 0.5) * v.g * (0.9 + Math.random() * 0.15);
  const src = playClip(ctx, dry, v.id, { at: now + 0.003, vol: g, rate, pan, wet, verb: verb ?? VERB[name] ?? 0.06 });
  if (!src) return 'pending';
  live.push({ name, src, g: src.gain, end: src.endAt });
  return true;
}

export const SAMPLE_NAMES = Object.keys(SAMPLE_MAP);
