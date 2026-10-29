// AppSea catalogue: every downloadable desktop app ("family") comes in five tiers. Each tier is a bigger
// download; bigger files make stronger bait ("the bigger the file, the hungrier the fish").
// App ids are the desktop icon ids from APPS (src/desktop/icons.js).
//
//   TIERS[i] = {id, name, short}                  0 Lite, 1 Standard, 2 Pro, 3 Ultra, 4 Enterprise
//   CATEGORIES = [{id, name, blurb}]
//   CATALOG = [{id, name, cat, kb, priceMul, publisher, versions[5], desc[5], stars, base, isNew, hot}]
//   listing(appId, tier) -> {app, tier, tierName, name, version, title, kb, price, power, file, desc}
//   baitPowerAt(appId, tier) -> 1..~3.8, baitPower(appId, state) (installed tier; 1 for anything else)
//   baitMods(appId, state) -> {power, attract, sizeBonus, rarity, giantMul}
//   formatSize(kb), formatSpeed(kbPerSec), formatTime(sec), downloadCount(appId, now)

import { APPS } from '../desktop/icons.js';
import { hash1 } from '../core/math.js';

export const TIERS = [
  { id: 'lite', name: 'Lite', short: 'LITE', color: '#8a96a8' },
  { id: 'standard', name: 'Standard', short: 'STD', color: '#2c9c5c' },
  { id: 'pro', name: 'Pro', short: 'PRO', color: '#2a64d0' },
  { id: 'ultra', name: 'Ultra', short: 'ULTRA', color: '#8a34d0' },
  { id: 'enterprise', name: 'Enterprise', short: 'ENT', color: '#e8a62a' },
];
export const MAX_TIER = TIERS.length - 1;

// Size multiplier per tier (Lite size x mul) and base coin price per tier (x app priceMul).
const TIER_SIZE = [1, 10, 160, 2400, 30000];
const TIER_PRICE = [0, 0, 60, 320, 1400];
const TIER_POWER = [0, 0.05, 0.12, 0.22, 0.35];

export const CATEGORIES = [
  { id: 'productivity', name: 'Productivity', blurb: 'Get things done. Fish love deadlines.' },
  { id: 'media', name: 'Media', blurb: 'Pictures, tunes and moving fish.' },
  { id: 'games', name: 'Games', blurb: 'Fun for the whole school.' },
  { id: 'social', name: 'Social', blurb: 'Talk to people. And crabs.' },
  { id: 'utilities', name: 'Utilities', blurb: 'Serious tools for serious fishers.' },
  { id: 'weird', name: 'Weird', blurb: 'We do not know what these do.' },
];

const V = (s) => s.split('|');

export const CATALOG = [
  // productivity
  { id: 'notes', name: 'Notes', cat: 'productivity', kb: 28, priceMul: 0.6, publisher: 'Sticky Fin Software', versions: V('1.2|2.0|3.11|98 SE|2000 Server'), stars: 4.5, base: 2481330, hot: true,
    desc: ['Write things down. Fish read over your shoulder.', 'Now with BOLD. And italics, if you squint.', "Spell-check that knows 40 words for 'kelp'.", 'Cloud sync! (The cloud is a wet sponge.)', 'Mandatory meetings about your notes. Very bait.'] },
  { id: 'documents', name: 'FolderPlex', cat: 'productivity', kb: 44, priceMul: 0.8, publisher: 'Nest Corp.', versions: V('1.0|2.1|4.0|XP|Infinity'), stars: 4,
    desc: ['Folders inside folders. Fish love a good mystery.', 'Now holds up to 12 folders. Possibly 13.', 'Colour-coded folders. Red means danger. Or tomato.', 'Folders so deep the abyss fish moved in.', 'Infinite nested folders. Nobody comes back.'] },
  { id: 'calculator', name: 'Calcutron', cat: 'productivity', kb: 36, priceMul: 0.7, publisher: 'Abacus & Clam', versions: V('0.9|1.0|2.5|9000|10000'), stars: 3.5,
    desc: ['Adds numbers. Mostly correctly.', 'Now with subtraction! Ask about division.', 'Scientific mode: calculates how many fish fit.', 'Graphs! Every graph is a fish if you try.', 'Does your taxes. Your taxes are fish.'] },
  { id: 'calendar', name: 'TideCal', cat: 'productivity', kb: 52, priceMul: 0.8, publisher: 'Moon Phase Ltd.', versions: V('1.0|2003|2004|Millennium|Eternity'), stars: 4,
    desc: ['Knows what day it is. Usually.', 'Reminders! Mostly about lunch.', 'Syncs with the moon. The moon did not agree.', 'Schedules your naps around high tide.', 'Books meeting rooms underwater. Bring a snorkel.'] },
  // media
  { id: 'music', name: 'WinKelp', cat: 'media', kb: 180, priceMul: 1, publisher: 'Nullsoft-ish', versions: V('2.9|3.0|5.0|5.9|6.66'), stars: 5, hot: true,
    desc: ["It really whips the kelp's tail.", 'Skins! Your player can look like a crab.', 'Equalizer with a BASS slider. Fish feel it.', 'Visualizer hypnotizes small fish. And you.', 'Plays every song ever written. In MIDI.'] },
  { id: 'photos', name: 'PixelPeek', cat: 'media', kb: 120, priceMul: 0.9, publisher: 'Lens Lobster', versions: V('1.0|2.0|3.0|HDR|8K'), stars: 4,
    desc: ['Look at pictures. Pictures look back.', 'Red-eye removal (works on fish too).', 'Filters: Sepia, Soggy and Extra Soggy.', 'Zoom & enhance. ENHANCE. It is a fish.', "AI tags every photo as 'probably a fish'."] },
  { id: 'videos', name: 'FishTube Player', cat: 'media', kb: 260, priceMul: 1.2, publisher: 'Streamy Eel', versions: V('0.1|1.0|HD|4K|8K 3D'), stars: 4.5, isNew: true,
    desc: ['Buffering... buffering... a fish!', '240p! You can almost see the fish.', 'HD Ready. The fish are not ready.', '4K. Every scale. Every regret.', '8K 3D Smell-O-Vision. Bring a towel.'] },
  { id: 'paint', name: 'Paint Shop Crab', cat: 'media', kb: 150, priceMul: 1, publisher: 'Pinch Creative', versions: V('1.0|2.0|5.5|7|X'), stars: 3.5,
    desc: ['Draw circles. Badly. Fish love it.', 'Now with the spray can tool. Pssshhh.', 'Layers! Like an onion. Or a reef.', "Pressure-sensitive. Please don't press so hard.", 'Paints the whole ocean. Bring more blue.'] },
  // games
  { id: 'games', name: 'Sea Mines', cat: 'games', kb: 210, priceMul: 1.1, publisher: 'Bubble Games', versions: V('1.0|2.0|Deluxe|Gold|Collection'), stars: 4.5, hot: true,
    desc: ['Click a square. Pray. Classic.', 'Bigger board, bigger booms (bubbly ones).', 'Now with Solitaire. The cards are wet.', 'Online multiplayer with 3 lonely crabs.', '1,000 games on one disc. 999 are Sea Mines.'] },
  { id: 'fishtop', name: 'FISHTOP', cat: 'games', kb: 64, priceMul: 1.3, publisher: 'You (apparently)', versions: V('1.0|1.1|Director\'s Cut|Remastered|Infinite'), stars: 5, isNew: true,
    desc: ['You are already playing this. Download anyway?', 'Same game, but you get it twice.', "Director's cut: the fish blink more.", 'Remastered. The fish are now remastered.', 'FISHTOP inside FISHTOP. Fish all the way down.'] },
  // social
  { id: 'chat', name: 'BLUB Messenger', cat: 'social', kb: 90, priceMul: 0.9, publisher: 'Chirp Chat Inc.', versions: V('4.7|5.0|6.0|7.5|Live'), stars: 4, hot: true,
    desc: ["Uh-oh! (That's the message sound.)", 'Emoticons! :) :( :fish:', 'Nudge your friends. Nudge them HARD.', 'Video calls with three clams and a shrimp.', 'Group chat with the whole ocean. Mute it.'] },
  { id: 'mail', name: 'Bottle Express', cat: 'social', kb: 70, priceMul: 0.8, publisher: 'Message & Bottle', versions: V('5.0|6.0|2002|2007|365'), stars: 3.5,
    desc: ['Send messages in tiny bottles.', 'Spam filter catches 3% of spam fish.', 'Attachments! Attach a fish. Attach two.', 'Reply-all to the entire coastline.', 'Corporate email. 400 unread memos about fish.'] },
  { id: 'fishnet', name: 'FishNet Explorer', cat: 'social', kb: 300, priceMul: 1.1, publisher: 'FishNet Corp.', versions: V('3.0|4.0|5.5|6.0|7 Beta'), stars: 3,
    desc: ['Surf the web. Mind the sharks.', 'Tabs! You can now ignore 9 pages at once.', 'Pop-up blocker blocks 2 of 400 pop-ups.', 'Toolbars. So many toolbars. Fish love toolbars.', 'Comes with 12 toolbars and a lighthouse.'] },
  // utilities
  { id: 'terminal', name: 'SeaShell', cat: 'utilities', kb: 30, priceMul: 0.7, publisher: 'Root Beer Labs', versions: V('0.1|1.0|2.0|4.2|42'), stars: 4.5,
    desc: ['Type commands. Feel like a hacker fish.', 'Now with colours! Green and... green.', 'sudo fish. Permission granted (finally).', 'Compiles the ocean in 4 minutes.', 'Root access to the Mariana Trench.'] },
  { id: 'settings', name: 'Tweak-o-Matic', cat: 'utilities', kb: 46, priceMul: 0.8, publisher: 'Knob & Dial', versions: V('1.0|1.5|2.0|3.0|Ultimate'), stars: 3,
    desc: ['Change settings. Then change them back.', 'Toggles! Flip them. Feel powerful.', 'Advanced tab: do not touch the red slider.', 'Overclocks your bait to 9000 MHz.', "Settings for your settings' settings."] },
  // weird
  { id: 'moreram', name: 'Download More RAM', cat: 'weird', kb: 8, priceMul: 1.2, publisher: 'TotallyLegitRAM.biz', versions: V('1 MB|2 MB|64 MB|1 GB|64 GB'), stars: 5, isNew: true,
    desc: ['Your PC is 87% slow! Just download more RAM!', 'Now 2x the RAM. Still 87% slow.', 'Comes with a fan. The fan is a fish.', 'So much RAM, your mouse got heavier.', '64 GB of pure RAM. Smells like toast.'] },
  { id: 'notavirus', name: 'NotAVirus.exe', cat: 'weird', kb: 66, priceMul: 1.4, publisher: 'A Crab', versions: V('1.0|1.1|2.0|3.0|SP2'), stars: 2.5, alwaysWarn: true,
    desc: ['Definitely not a virus. Signed, A Crab.', 'Now with 50% fewer viruses.', 'Antivirus approved (the antivirus is also a crab).', 'Renames all your files to fish.txt. Helpful!', 'Enterprise-grade not-a-virus. Trust us.'] },
];

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((a) => [a.id, a]));
export const APP_DEF = Object.fromEntries(APPS.map((a) => [a.id, a]));

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

export function installedTier(appId, state = boundState) {
  const t = state?.apps?.tiers?.[appId];
  return typeof t === 'number' ? t : -1;
}

// Bait strength of a desktop icon: 1 for system icons / unknown ids / files.
export function baitPower(appId, state = boundState) {
  const t = installedTier(appId, state);
  return t >= 0 ? baitPowerAt(appId, t) : 1;
}

// How fish code should use the power (see store/index.js header).
export function baitMods(appId, state = boundState) {
  const p = baitPower(appId, state), k = p - 1;
  return { power: p, attract: 1 + k * 0.45, sizeBonus: k * 0.07, rarity: 1 + k * 0.3, giantMul: 1 + k * 0.9 };
}

export function fileName(appId, tier) {
  const a = CATALOG_BY_ID[appId];
  const base = (a?.name || appId).toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${base}_${TIERS[tier].id}_setup.exe`;
}

export function listing(appId, tier) {
  const a = CATALOG_BY_ID[appId];
  if (!a) return null;
  tier = Math.max(0, Math.min(MAX_TIER, tier));
  const tierName = TIERS[tier].name;
  const version = a.versions[tier];
  return {
    app: appId, tier, tierName, name: a.name, version,
    title: `${a.name} ${tierName} ${version}`,
    kb: sizeKb(appId, tier), price: priceOf(appId, tier), power: baitPowerAt(appId, tier),
    file: fileName(appId, tier), desc: a.desc[tier], type: APP_DEF[appId]?.type || 'docs', icon: APP_DEF[appId]?.icon || 'file',
  };
}

// Deterministic, slowly ticking download counter for the website.
export function downloadCount(appId, now = Date.now()) {
  const a = CATALOG_BY_ID[appId];
  const seed = appId.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7) % 9973;
  const base = a?.base || Math.round(20000 + hash1(seed, 3) * 1400000);
  const perMin = 2 + hash1(seed, 5) * 30;
  return Math.floor(base + ((now / 60000) % 100000) * perMin);
}

export function formatSize(kb) {
  if (kb < 10) return kb.toFixed(1) + ' KB';
  if (kb < 1024) return Math.round(kb) + ' KB';
  const mb = kb / 1024;
  if (mb < 10) return mb.toFixed(1) + ' MB';
  if (mb < 1024) return Math.round(mb) + ' MB';
  const gb = mb / 1024;
  return (gb < 10 ? gb.toFixed(2) : gb.toFixed(1)) + ' GB';
}

export function formatSpeed(kbs) {
  if (kbs < 1024) return (kbs < 100 ? kbs.toFixed(1) : Math.round(kbs)) + ' KB/s';
  const mb = kbs / 1024;
  if (mb < 1024) return (mb < 100 ? mb.toFixed(1) : Math.round(mb)) + ' MB/s';
  return (mb / 1024).toFixed(1) + ' GB/s';
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

export function formatShortTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm' + (sec % 60 ? ' ' + (sec % 60) + 's' : '');
  if (sec < 172800) return Math.floor(sec / 3600) + 'h' + (Math.floor(sec / 60) % 60 ? ' ' + (Math.floor(sec / 60) % 60) + 'm' : '');
  return Math.round(sec / 86400) + 'd';
}
