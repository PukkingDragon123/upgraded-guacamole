// Multiplayer wire format + validation (OWNER: Online & AppSea agent).
// EVERYTHING heard from a peer is untrusted: every field is type-checked, clamped and length-limited here and
// unknown fields are dropped. Nothing from a peer is ever evaluated, used as HTML, or used as a lookup key
// without a whitelist. Display strings are stripped of control / bidi / invisible characters.
//
// Presence (absolute state, one object under the top-level key 'ft'):
//   {v, sid, name, look, boat:{t, hull, trim, parts}, oc /*ocean id*/, x /*0..1 boat x*/, dir, st /*fishing state*/,
//    hk:[x 0..1, depth 0..1 (up to 8 in the deep zones below the shelf)]|null, em:{id, n}|null, lc:{sp, r, s, n}|null /*last catch*/, cn /*catches online*/}
// Events (moments): 'caught' {sp, r, s, n}, 'emote' {id, n}, 'wave' {to /*sid or ''*/, n}
//
//   cleanName(s) -> safe display name (<= NAME_MAX chars) or ''
//   cleanPresence(raw) -> presence | null
//   cleanEvent(topic, data) -> data | null
//   EMOTES, EMOTE_BY_ID, STATES, TOPICS, NAME_MAX, PROTO, randomName()

export const PROTO = 1;
export const NAME_MAX = 16;
export const TOPICS = ['caught', 'emote', 'wave'];
export const STATES = ['idle', 'cast', 'wait', 'nibble', 'bite', 'fight', 'land'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// icon = src/gfx/uiicons.js name; pose = character pose played while the bubble shows.
export const EMOTES = [
  { id: 'wave', icon: 'cursor_hand', pose: 'wave', color: '#4ac8ff', label: 'Wave' },
  { id: 'heart', icon: 'heart', pose: 'cheer', color: '#ff6aa8', label: 'Love it' },
  { id: 'wow', icon: 'star', pose: 'cheer', color: '#ffc83a', label: 'Wow!' },
  { id: 'gg', icon: 'trophy', pose: 'cheer', color: '#ffb02e', label: 'Good catch!' },
  { id: 'fish', icon: 'fish', pose: 'idle', color: '#2fd3e8', label: 'Fish here!' },
  { id: 'huh', icon: 'question', pose: 'idle', color: '#9a7aff', label: 'Huh?' },
  { id: 'oops', icon: 'sweat', pose: 'sad', color: '#7ab8e0', label: 'Oops' },
  { id: 'zzz', icon: 'zzz', pose: 'sit', color: '#8a9ab8', label: 'Sleepy' },
];
export const EMOTE_BY_ID = Object.fromEntries(EMOTES.map((e) => [e.id, e]));

// Control chars, DEL/C1, zero-width + bidi controls, line/para separators, word joiners, BOM, specials.
const BAD_RANGES = [[0x0, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180f],
  [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164], [0xe000, 0xf8ff], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0],
  [0xfff0, 0xffff], [0xe0000, 0xe007f], [0xf0000, 0x10ffff]];
const badChar = (ch) => { const c = ch.codePointAt(0); return BAD_RANGES.some(([a, b]) => c >= a && c <= b); };
const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/i;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const SID_RE = /^[a-z0-9]{6,24}$/;

const num = (v, lo, hi, def = lo) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const int = (v, lo, hi, def = lo) => Math.round(num(v, lo, hi, def));
const id = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const hex = (v) => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : null);
export const isSid = (v) => typeof v === 'string' && SID_RE.test(v);

// Names are drawn with the ASCII pixel font, so only a safe printable set survives (accents are folded:
// "Jose" from "Jos\u00e9"); '{' / '}' are dropped so a name can never trigger the font's inline {icon} tokens.
const NAME_OK = /[A-Za-z0-9 _.!?'&+#*()-]/;
export function cleanName(s) {
  if (typeof s !== 'string') return '';
  const folded = Array.from(s.slice(0, 200).normalize('NFKD')).filter((ch) => !badChar(ch) && !(ch.codePointAt(0) >= 0x300 && ch.codePointAt(0) <= 0x36f));
  const t = folded.map((ch) => (NAME_OK.test(ch) ? ch : /\s/.test(ch) ? ' ' : '')).join('').replace(/\s+/g, ' ').trim();
  return t.slice(0, NAME_MAX).trim();
}

// Character look: a flat object of short ids / hex colours / small numbers (the character module normalises
// unknown ids itself). At most 16 keys; arrays (accessories) of at most 6 ids.
function cleanLook(L) {
  if (!L || typeof L !== 'object' || Array.isArray(L)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(L)) {
    if (n >= 16) break;
    if (!/^[a-z][a-zA-Z0-9_]{0,15}$/.test(k) || k === 'constructor' || k === 'prototype' || k === '__proto__') continue;
    const v = L[k];
    let c;
    if (typeof v === 'string') c = hex(v) || id(v);
    else if (typeof v === 'number') c = num(v, -1000, 1000, null);
    else if (typeof v === 'boolean') c = v;
    else if (Array.isArray(v)) c = v.slice(0, 6).map(id).filter(Boolean);
    if (c === null || c === undefined) continue;
    out[k] = c;
    n++;
  }
  return out;
}

function cleanBoat(b) {
  if (!b || typeof b !== 'object') return { t: 0, hull: null, trim: null, parts: null };
  let parts = null;
  if (b.parts && typeof b.parts === 'object' && !Array.isArray(b.parts)) {
    parts = {};
    for (const k of ['hull', 'sail', 'flag', 'engine', 'decal']) { const v = id(b.parts[k]); if (v) parts[k] = v; }
  }
  return { t: int(b.t, 0, 9, 0), hull: hex(b.hull), trim: hex(b.trim), parts };
}

function cleanCatchData(d) {
  if (!d || typeof d !== 'object') return null;
  const sp = id(d.sp);
  if (!sp) return null;
  return { sp, r: RARITIES.includes(d.r) ? d.r : 'common', s: Math.round(num(d.s, 0, 99999, 0) * 10) / 10, n: int(d.n, 0, 1e9, 0) };
}

export function cleanPresence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== PROTO || !isSid(raw.sid)) return null;
  const name = cleanName(raw.name) || 'Fisher';
  let hk = null;
  if (Array.isArray(raw.hk) && raw.hk.length === 2) hk = [num(raw.hk[0], 0, 1, 0.5), num(raw.hk[1], -0.2, 8, 0)]; // [phase6:oceans] > 1: below the shelf, in the deep zones
  let em = null;
  if (raw.em && typeof raw.em === 'object' && EMOTE_BY_ID[raw.em.id]) em = { id: raw.em.id, n: int(raw.em.n, 0, 1e9, 0) };
  return {
    v: PROTO, sid: raw.sid, name,
    look: cleanLook(raw.look),
    boat: cleanBoat(raw.boat),
    oc: id(raw.oc) || 'oscean',
    x: num(raw.x, 0, 1, 0.5),
    dir: raw.dir === -1 ? -1 : 1,
    st: STATES.includes(raw.st) ? raw.st : 'idle',
    hk,
    em,
    lc: cleanCatchData(raw.lc),
    cn: int(raw.cn, 0, 1e9, 0),
  };
}

export function cleanEvent(topic, d) {
  if (!TOPICS.includes(topic) || !d || typeof d !== 'object') return null;
  if (topic === 'caught') return cleanCatchData(d);
  if (topic === 'emote') return EMOTE_BY_ID[d.id] ? { id: d.id, n: int(d.n, 0, 1e9, 0) } : null;
  if (topic === 'wave') return { to: isSid(d.to) ? d.to : '', n: int(d.n, 0, 1e9, 0) };
  return null;
}

// Cheerful default names (the player picks their own; never derived from any account).
const NA = ['Bubble', 'Aqua', 'Coral', 'Kelp', 'Sunny', 'Pixel', 'Glossy', 'Breezy', 'Minty', 'Splashy', 'Wavy', 'Sparkle'];
const NB = ['Fin', 'Bass', 'Guppy', 'Otter', 'Shrimp', 'Dolphin', 'Clam', 'Squid', 'Minnow', 'Puffer', 'Orca', 'Koi'];
export function randomName() {
  const p = (a) => a[Math.floor(Math.random() * a.length)];
  return (p(NA) + p(NB) + (Math.random() < 0.6 ? Math.floor(Math.random() * 90 + 10) : '')).slice(0, NAME_MAX);
}

export function newSid() {
  let s = '';
  const cs = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rnd = new Uint8Array(12);
  try { crypto.getRandomValues(rnd); } catch { for (let i = 0; i < 12; i++) rnd[i] = Math.floor(Math.random() * 256); }
  for (const b of rnd) s += cs[b % cs.length];
  return s;
}
