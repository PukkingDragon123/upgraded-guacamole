// Bait Shop catalogue (phase 4, Shell agent): flavoured bait LINES sold by Dot at the Bait Shop. Every line comes
// in five grades; a pack holds PACK_QTY[grade] x '<lineId>_<gradeId>' consumable bait (see src/store/bait.js).
// Stronger grades bite harder ("the richer the bait, the hungrier the fish"); grades unlock with the shop level
// researched in The Lab (src/store/isp.js). Line ids are kept from the old catalogue so saves and bait ids stay
// valid; `type` is the species bait-pref key the line appeals to.
//
//   TIERS[i] = {id, name, short, color}         grades: 0 Lite, 1 Plus, 2 Pro, 3 Ultra, 4 Mega (ids unchanged)
//   CATEGORIES = [{id, name, blurb}]            shop shelves ('bait' = Classics, 'lines' = Flavours)
//   CATALOG = [{id, name, type, kb (potency), priceMul, desc[5], hot, isNew}]
//   PACK_QTY[grade], appBaitId(lineId, grade) -> bait id
//   listing(lineId, grade) -> {app, tier, tierName, name, title, kb, price, power, desc, qty, bait, type}
//   baitPowerAt(lineId, grade) -> 1..~3.8, baitPower(lineId, state), baitMods(lineId, state)
//   APP_DEF[lineId] = {id, label, type, icon} (art / bait-pref lookups), formatTime(sec), formatShortTime(sec)

import { APPS } from '../desktop/icons.js';
import { hash1 } from '../core/math.js';

export const TIERS = [
  { id: 'lite', name: 'Lite', short: 'LITE', color: '#8a96a8' },
  { id: 'standard', name: 'Plus', short: 'PLUS', color: '#2c9c5c' },
  { id: 'pro', name: 'Pro', short: 'PRO', color: '#2a64d0' },
  { id: 'ultra', name: 'Ultra', short: 'ULTRA', color: '#8a34d0' },
  { id: 'enterprise', name: 'Mega', short: 'MEGA', color: '#e8a62a' },
];
export const MAX_TIER = TIERS.length - 1;

// Potency multiplier per grade (x the line's base potency) and the base Aero price per grade (x line priceMul).
const TIER_SIZE = [1, 10, 160, 2400, 30000];
const TIER_PRICE = [0, 10, 30, 90, 260];
export const PACK_QTY = [5, 5, 4, 3, 3];
export function appBaitId(app, tier) { return `${app}_${TIERS[tier]?.id || 'lite'}`; }
const TIER_POWER = [0, 0.05, 0.12, 0.22, 0.35];

export const CATEGORIES = [
  { id: 'bait', name: 'Classics', blurb: 'Tried and true. Fresh every restock.' },
  { id: 'lines', name: 'Flavours', blurb: 'Every fish has a favourite flavour.' },
];

const L = (id, name, type, kb, priceMul, desc, extra = {}) => ({ id, name, type, kb, priceMul, desc, cat: 'lines', ...extra });

export const CATALOG = [
  L('notes', 'Scribble Grubs', 'docs', 28, 0.6, ['Wiggly grubs that taste like fresh paper.', 'Now with bold flavour. And italics.', 'Spell-checked. Fish still misspell "yum".', 'Cloud-whipped. The cloud is a wet sponge.', 'So rich they schedule meetings about it.'], { hot: true }),
  L('documents', 'Nesting Nymphs', 'folder', 44, 0.8, ['Nymphs inside nymphs. Fish love a mystery.', 'Holds up to twelve nymphs. Maybe thirteen.', 'Colour-coded. Red means spicy.', 'So deep the abyss fish moved in.', 'Infinitely nested. Nobody comes back.']),
  L('calculator', 'Number Nibbles', 'calc', 36, 0.7, ['Crunchy little digits. Mostly correct.', 'Now with subtraction flavour.', 'Scientific grade. Counts bites per minute.', 'Graph-shaped. Every graph is a fish.', 'Does your taxes while you fish.']),
  L('calendar', 'Tide Ticks', 'calendar', 52, 0.8, ['Knows what day it is. Usually.', 'Comes with lunch reminders.', 'Synced with the moon. The moon disagreed.', 'Schedules naps around high tide.', 'Books fish into meetings. Bring a snorkel.']),
  L('music', 'Bassline Minnows', 'music', 180, 1, ['They really whip the bass.', 'Remixed. Fish tap their fins.', 'Extra BASS. Fish feel it in their scales.', 'Hypnotic. Small fish sway along.', 'Every song ever written, in one minnow.'], { hot: true }),
  L('photos', 'Pixel Shrimp', 'image', 120, 0.9, ['Pose for the camera. Fish look back.', 'Red-eye removed. Works on fish too.', 'Filters: Soggy and Extra Soggy.', 'Zoom. Enhance. It is a fish.', 'Every scale in glorious 8K.']),
  L('videos', 'Buffer Leeches', 'video', 260, 1.2, ['Buffering... buffering... a bite!', '240p. You can almost see them.', 'HD ready. The fish are not.', 'Smooth as a livestream.', 'Ultra HD in 3D. Bring a towel.'], { isNew: true }),
  L('paint', 'Splatter Worms', 'paint', 150, 1, ['Wiggles in every colour. Badly.', 'Spray-speckled. Pssshh.', 'Layered like a reef.', 'Pressure-sensitive. Bite gently.', 'Paints the whole ocean. More blue!']),
  L('games', 'Arcade Crickets', 'game', 210, 1.1, ['Insert coin. Fish press start.', 'High-score flavour.', 'Deluxe edition. Extra lives.', 'Gold edition. Shiny chirps.', 'A thousand crickets in one tin.'], { hot: true }),
  L('fishtop', 'Meta Mayflies', 'game', 64, 1.3, ['A mayfly playing a fishing game. Whoa.', 'The same fly, but twice.', "Director's cut: they blink more.", 'Remastered. Even more meta.', 'Mayflies all the way down.'], { isNew: true }),
  L('chat', 'Chatter Krill', 'chat', 90, 0.9, ['Uh-oh! (That is the bite sound.)', 'Emoticon krill :) :( :fish:', 'They nudge the fish. HARD.', 'Group krill for the whole school.', 'The whole ocean in one chat. Mute it.'], { hot: true }),
  L('mail', 'Bottle Bugs', 'mail', 70, 0.8, ['Tiny bugs in tiny bottles.', 'Spam filter catches 3% of spam fish.', 'Attachments! Attach a fish.', 'Reply-all to the entire coastline.', 'Four hundred unread bugs. All urgent.']),
  L('fishnet', 'Surf Squidlets', 'browser', 300, 1.1, ['Surf the waves. Mind the sharks.', 'Now with tabs. Fish ignore nine at once.', 'Pop-up flavour. Four hundred of them.', 'Toolbars. Fish love toolbars.', 'Twelve toolbars and a lighthouse.']),
  L('terminal', 'Code Caddis', 'terminal', 30, 0.7, ['Feel like a hacker fish.', 'Now in green. And green.', 'sudo bite. Permission granted.', 'Compiles the ocean in four minutes.', 'Root access to the deepest trench.']),
  L('settings', 'Gear Grubs', 'settings', 46, 0.8, ['Turn the dial. Fish turn too.', 'Toggles! Flip them. Feel powerful.', 'Do not touch the red slider.', 'Overclocked to 9000 wiggles.', "Settings for your settings' settings."]),
  L('moreram', 'RAM Roe', 'computer', 8, 1.2, ['Your bait is 87% slow! Just add RAM!', 'Twice the RAM. Still 87% slow.', 'Comes with a fan. The fan is a fish.', 'So much RAM the hook got heavier.', 'Sixty-four gigs of roe. Smells like toast.'], { isNew: true }),
  L('notavirus', 'NotAWorm.exe', 'trash', 66, 1.4, ['Definitely not a worm. Signed, a crab.', 'Now 50% fewer worms.', 'Approved by the antivirus (also a crab).', 'Renames every fish to fish.txt.', 'Mega-grade not-a-worm. Trust us.']),
];

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((a) => [a.id, a]));
// Art / bait-pref lookup per line (the icon art lives in src/desktop/icons.js, now just an icon library).
export const APP_DEF = Object.fromEntries(APPS.map((a) => [a.id, a]));
for (const fam of CATALOG) APP_DEF[fam.id] = { ...(APP_DEF[fam.id] || { icon: 'file' }), id: fam.id, label: fam.name, type: fam.type };

export function appsIn(cat) {
  return CATALOG.filter((a) => a.cat === cat);
}

export function sizeKb(appId, tier) {
  const a = CATALOG_BY_ID[appId];
  return a ? Math.round(a.kb * TIER_SIZE[tier] * (1 + (hash1(a.kb * 7 + tier, 11) - 0.5) * 0.24) * 10) / 10 : 0;
}

export function priceOf(appId, tier) {
  const a = CATALOG_BY_ID[appId];
  if (!a || !TIER_PRICE[tier]) return 0;
  return Math.max(5, Math.round((TIER_PRICE[tier] * a.priceMul) / 5) * 5);
}

export function baitPowerAt(appId, tier) {
  const kb = sizeKb(appId, tier);
  if (!kb) return 1;
  return Math.round((1 + 0.42 * Math.log10(Math.max(1, kb / 16)) + (TIER_POWER[tier] || 0)) * 100) / 100;
}

let boundState = null;
export function bindCatalogState(state) { boundState = state; }

// Best grade of a line the player has bought (-1 = never).
export function installedTier(appId, state = boundState) {
  const t = state?.apps?.tiers?.[appId];
  return typeof t === 'number' ? t : -1;
}

export function baitPower(appId, state = boundState) {
  const t = installedTier(appId, state);
  return t >= 0 ? baitPowerAt(appId, t) : 1;
}

export function baitMods(appId, state = boundState) {
  const p = baitPower(appId, state), k = p - 1;
  return { power: p, attract: 1 + k * 0.45, sizeBonus: k * 0.07, rarity: 1 + k * 0.3, giantMul: 1 + k * 0.9 };
}

export function listing(appId, tier) {
  const a = CATALOG_BY_ID[appId];
  if (!a) return null;
  tier = Math.max(0, Math.min(MAX_TIER, tier));
  const tierName = TIERS[tier].name;
  return {
    app: appId, tier, tierName, name: a.name, title: `${a.name} ${tierName}`,
    kb: sizeKb(appId, tier), price: priceOf(appId, tier), power: baitPowerAt(appId, tier),
    desc: a.desc[tier], type: a.type, icon: APP_DEF[appId]?.icon || 'file',
    qty: PACK_QTY[tier], bait: appBaitId(appId, tier),
  };
}

export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + ' sec';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m} min ${s} sec` : `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return mm ? `${h} hr ${mm} min` : `${h} hr`;
  return Math.round(h / 24) + ' days';
}

// 4:05 style countdown.
export function formatShortTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
