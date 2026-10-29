// Cap'n Bloat's Bait & Tackle: a full-screen, cosy, cluttered underwater shop interior.
// Left: the counter, run by Cap'n Bloat - a fat, grumpy-but-lovable old pufferfish (voxel body pre-rendered in
// breathing / puffed-up frames + a live 2D face rig: droopy eyes that follow the cursor, spectacles, bushy brows,
// a cigar that he puffs, bubble rings, coughs, babble + speech bubbles). Behind him: voxel shelves of glowing bait
// jars, a porthole, posters, nets, lanterns. Right: the merchandise cabinet with tabs (Bait, Decor, Cosmetics,
// Specials). Selecting an item zooms the camera onto the counter: a big rotating preview on a turntable and a
// spec sheet (attracts, effects, stock, daily deal, price, Buy). Buy logic: game.buyBait / spendCoins +
// aquarium.addDecor (unchanged). open({tab: 'bait'|'decor'|'cosmetics'|'specials'}).

import { clamp, clamp01, lerp, damp, ease, TAU, bayer, hash1, hash2, hash3, formatCommas } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { rgba, shade, mix, pack, RARITY } from '../core/color.js';
import { tinted, makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawBubble, drawTab, drawStamp } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getProp, PROPS } from '../gfx/props.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import * as CHAR from '../gfx/character.js';
import { BAITS, BAIT_ORDER } from '../game/shopdata.js';
import { SKILLS, BRANCHES } from '../game/skills.js';
import { SPECIES } from '../fish/species.js';
import { baitInterest } from '../fish/fish.js';
import { baitSprite } from '../fishing/baitart.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const VOICE = 'deep';

// ---------------------------------------------------------------- Cap'n Bloat's lines
const LINES = {
  greet: ['Ahoy. Wipe yer fins.', "Well, well. A customer. Don't dawdle.", "Mornin', sprat. What'll it be?", 'Bell rang. Must be money.', 'Come in, come in. Mind the jars.'],
  idle: ['Back in my day we fished with our bare fins.', "Bait's fresh. Fresher'n me, anyway.", "Don't touch the jars. I count 'em.", 'Fifty years I run this shop. Fifty! ...or five.', "These specs? For spottin' cheapskates.", "I've seen fish ye wouldn't believe. Ate most of 'em.", 'Smokin? Underwater? Mind yer business.', 'The sea was saltier in my day.', 'Hmph. Kids these days and their clicky mice.', "I'm not grumpy. This is my happy face."],
  buy: ["Pleasure. Now don't waste it.", 'Hah! Good eye, sprat.', 'Ka-ching! Music to me old fins.', "Sold! Tell yer friends. Actually, don't.", 'A fine choice. For a landlubber.', "That'll catch 'em. Probably."],
  broke: ["No coin, no worm. That's the law o' the sea!", "Ye're poorer than a barnacle's piggy bank.", "Don't make me puff up, kid!", 'HMPH! Come back with real money.', "I take coins. Not hopes 'n dreams."],
  locked: ['Not for greenhorns! Grow yer skills first.', 'Top shelf. License required, sprat.', 'Ha! Ye ain\'t ready for that one.'],
  special: ["Today's deal! Robbin' meself blind.", '20% off. Must be goin\' soft.'],
  decor: ['The {n}? Yer fish will love it.', '{n}. Hauled it up meself.', 'Ah, the {n}. Classy.', '{n}: makes a tank a home.'],
  fancy: ["Now THAT's a statement piece.", "Fancy! Don't scratch it."],
  cosmetic: ['Lookin\' sharp, sprat.', 'Very dashing. For a human.', 'Ye\'ll be the talk of the reef.'],
  bell: ["I'm RIGHT HERE.", 'Ding ding yerself.', 'Patience is a virtue, sprat.', 'Yes, yes, I heard ye.'],
  poke: ['Oi! Hands off the merchandise.', 'Do I look like a pillow?', 'Poke me again, I dare ye.', 'Hmph.'],
  cough: ['*HACK* *COUGH* ...sea air.', '*cough* ...went down the wrong gill.', '*HRRK* ...I\'m fine. FINE.'],
  closeup: ["Have a look. Don't lick it.", 'Go on, take a good look.', 'Finest in the seven seas. Or six.'],
  soldout: ["Sold out! Come back tomorrow.", "That's the last one. Tomorrow, sprat."],
};
const BAIT_QUIP = {
  bread: 'Day-old bread. Fresh for a fish!', worm: 'He glows, he wiggles, he has a family.', sugar: 'Puddings go bonkers for it. Bonkers.',
  golden: "Gold! Rare fish can't resist the bling.", flood: 'Water everywhere! Hold onto yer icons.', blackhole: "Don't drop this one near my shop.",
  chip: 'Overclocked. Mind the sparks.', popup: 'YOU WON! ...a fish. Probably.', lantern: 'A little light for the big dark.', relic: 'Something old wants to say hello...',
};
const BAIT_FX = {
  bread: ['Common fish love it (x1.6 interest)', 'Cheap, endless supply'],
  worm: ['Crawls over your desktop icons', '+25% fish population', 'Every fish at least curious'],
  sugar: ['Sweet-toothed fish and puddings swarm', 'Great for dessert-loving species'],
  golden: ['Rare fish x1.5 more often', 'Legendary interest x2.6', 'Your desktop glitters'],
  flood: ['Raises the water over the desktop', '+50% fish population'],
  blackhole: ['Pulls icons and deep fish to the hook', 'x1.3 rarity, +35% population', 'Icons spring back after'],
  chip: ['Sparks attract mechanical fish', 'Junkyard Reef favourite'],
  popup: ['Spam fish cannot resist', '+30% fish population'],
  lantern: ['Lights up the Deep Ocean', 'Deep-sea fish follow the light'],
  relic: ['Summons the guardian of the deep', 'Use only in the Deep Ocean'],
};
const TIPS = {
  bread: "Commons first, sprat. Build up yer coins before ye splurge.",
  worm: 'Drop it near yer icons. Worms love a good crawl.',
  sugar: "Puddings and sweet-tooths. Don't feed it to the grumpy ones. Like me.",
  golden: 'Save it for good weather. Rare fish come out when the sky is moody.',
  flood: 'Flood the desktop, then fish the deep icons. Trust me.',
  blackhole: 'Keep yer hook away from the taskbar. Ask me how I know.',
  chip: 'Junkyard fish go mad for sparks. Bring a spare line.',
  popup: 'Spam fish swarm it. Close the ad before it closes you.',
  lantern: 'Down in the Deep, light is life. Bring two.',
  relic: "Only in the Deep Ocean. And don't say I didn't warn ye.",
  decor: 'Fish with a place to hide are happy fish. Happy fish pay rent.',
  cosmetic: 'A sharp-dressed fisher catches the eye. And the fish.',
  bundle: "Bundles save ye coins. I'm practically givin' it away.",
};
// how many packs Cap'n Bloat has in the back room per day
const STOCK = { bread: Infinity, worm: 12, sugar: 8, golden: 3, flood: 4, blackhole: 2, chip: 6, popup: 6, lantern: 4, relic: 1 };
const DECOR_SCALE = { 1: 0.5, 2: 0.42, 3: 0.32 };
const TABS = [
  { id: 'bait', label: 'Bait', icon: 'worm', color: '#c8503e' },
  { id: 'decor', label: 'Decor', icon: 'tank', color: '#3a7ab0' },
  { id: 'cosmetics', label: 'Cosmetics', icon: 'crown', color: '#8a4ab0' },
  { id: 'specials', label: 'Specials', icon: 'star', color: '#c8902a' },
];
const BIOME_NAMES = { shallows: 'Sunny Shallows', junkyard: 'Junkyard Reef', abyss: 'The Deep Ocean', aquarium: 'Aquarium classics', shop: 'The shop' };
const JAR_GLOW = { bread: null, worm: '#ff7ac8', sugar: '#ffffff', golden: '#ffd84a', flood: '#4ac8ff', blackhole: '#b46bff', chip: '#5aff8a', popup: '#ffd84a', lantern: '#5affc8', relic: '#5ae8ff' };

const cache = new Map();
function memo(key, build) {
  let c = cache.get(key);
  if (c === undefined) cache.set(key, (c = build()));
  return c;
}

function unlockSkillFor(baitId) {
  return SKILLS.find((s) => s.effect.unlockBait?.includes(baitId)) || null;
}

function decorList() {
  return Object.entries(PROPS).filter(([, p]) => p.decor).map(([id, p]) => ({ id, name: p.name, price: p.decor.price, size: p.decor.size, biome: p.biome, tags: p.tags || [] })).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}

const prettify = (s) => String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// WARDROBE: [{id, slot, value, name, rarity, price | null (unlock: 'package' | 'skill', skill), desc, color}]
// (older shapes {slot: [items]} are normalised too). Ownership/equip go through the character module helpers.
function wardrobeItems() {
  const W = CHAR.WARDROBE;
  const out = [];
  const push = (it, slot, i) => {
    if (it == null) return;
    if (typeof it !== 'object') it = { id: it };
    const id = it.id ?? it.key;
    if (id == null) return;
    const s = it.slot || slot || 'hat';
    out.push({ id: String(id), slot: s, value: it.value ?? id, name: it.name || prettify(id), price: it.price === undefined ? 40 + ((i * 37) % 9) * 15 : it.price, unlock: it.unlock || null, skill: it.skill || null, rarity: it.rarity || 'common', desc: it.desc || '', swatch: s === 'boat' ? it.color || null : null, item: it });
  };
  if (Array.isArray(W)) W.forEach((it, i) => push(it, null, i));
  else if (W && typeof W === 'object') for (const [slot, list] of Object.entries(W)) if (Array.isArray(list)) list.forEach((it, i) => push(it, slot, i));
  const ord = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  // free starter items live in the wardrobe, not on the shop shelves
  return out.filter((c) => c.price !== 0).sort((a, b) => (a.price == null) - (b.price == null) || (a.price ?? 0) - (b.price ?? 0) || (ord[a.rarity] ?? 0) - (ord[b.rarity] ?? 0));
}

// ================================================================ Cap'n Bloat (voxel body)

const SPOTS = [];
for (let i = 0; i < 46; i++) {
  const y = 1 - ((i + 0.5) / 46) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
  const d = [Math.cos(a) * r, y, Math.sin(a) * r];
  if (d[1] < 0.05 || (d[2] > 0.3 && d[1] > -0.5)) continue;
  SPOTS.push({ d, c: Math.cos(0.055 + hash1(i, 7) * 0.03) });
}
const SPIKES = [];
for (let i = 0; i < 70; i++) {
  const y = 1 - ((i + 0.5) / 70) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
  SPIKES.push([Math.cos(a) * r, y, Math.sin(a) * r]);
}

const BLOAT_VS = 2.7; // px per voxel
// inf 0..1 puffed up, br 0..1 breath. Returns {canvas, a: anchors (canvas px)}.
function buildBloat(inf, br) {
  const k = 1 + inf * 0.36;
  const RX = 31 * k + br * 0.5, RY = 27 * k + br * 0.8, RZ = 26 * k + br * 0.5;
  const SL = 1.1 + inf * 7.5;
  const pad = Math.ceil(SL) + 3;
  const nx = Math.ceil(RX * 2 + pad * 2 + 16), ny = Math.ceil(RY * 2 + pad + 26), nz = Math.ceil(RZ * 2 + pad * 2 + 10);
  const cx = nx / 2, cy = RY + pad, cz = nz / 2 - 1;
  const m = new VoxelModel(nx, ny, nz);
  const skin = m.color('#d0aa58', { jitter: 0.02, smooth: 0.92 });
  const skinTop = m.color('#b8924a', { jitter: 0.02, smooth: 0.92 });
  const belly = m.color('#f1e3bb', { jitter: 0.03, smooth: 0.9 });
  const bellyEdge = m.color('#e0c88e', { jitter: 0.03, smooth: 0.9 });
  const muzzle = m.color('#ecd9a6', { jitter: 0.03, smooth: 0.9 });
  const spot = m.color('#9a763c', { jitter: 0.02, smooth: 0.9 });
  const finC = m.color('#f0d27a', { jitter: 0.02, smooth: 0.5, light: 0.15 }), finR = m.color('#d8aa52', { jitter: 0.02, smooth: 0.5 });
  const wrinkle = m.color('#9c7a3a', { jitter: 0.02, smooth: 0.6 });
  const blush = m.color('#e2a274', { jitter: 0.02, smooth: 0.92 });
  const flush = inf > 0.4 ? m.color('#e0705a', { jitter: 0.03, smooth: 0.9 }) : blush;
  const knit = [m.color('#8e3244', { jitter: 0.05, smooth: 0.5 }), m.color('#a6435a', { jitter: 0.05, smooth: 0.5 }), m.color('#6c2232', { jitter: 0.04, smooth: 0.5 })];
  const button = m.color('#e8b84a', { spec: 2, specPow: 10, smooth: 0.9 });
  const noseC = m.color('#de7a68', { smooth: 0.95, spec: 1.4, specPow: 8 });
  const stache = m.color('#f3efe6', { jitter: 0.06, smooth: 0.45 });
  const stacheS = m.color('#c9c2b6', { jitter: 0.05, smooth: 0.45 });
  const capW = m.color('#2c3e6a', { jitter: 0.03, smooth: 0.75 });
  const capTop = m.color('#3a5088', { jitter: 0.03, smooth: 0.75 });
  const capBand = m.color('#16161e', { jitter: 0.02, smooth: 0.6, spec: 0.8 });
  const visor = m.color('#1c1c28', { spec: 1.6, specPow: 12, smooth: 0.7 });
  const gold = m.color('#f0c040', { spec: 2.2, specPow: 8 });
  const spikeC = m.color('#ddc07c', { jitter: 0.04, smooth: 0.5 });
  const dirOf = (x, y, z) => {
    const ux = (x + 0.5 - cx) / RX, uy = (y + 0.5 - cy) / RY, uz = (z + 0.5 - cz) / RZ;
    const L = Math.hypot(ux, uy, uz) || 1;
    return [ux / L, uy / L, uz / L];
  };
  const EX = 0.37, EY = 0.27;
  const bodyCol = (x, y, z) => {
    const qx = (x + 0.5 - cx) / RX, qy = (y + 0.5 - cy) / RY, qz = (z + 0.5 - cz) / RZ;
    if (qx * qx + qy * qy + qz * qz < 0.7) return skin; // interior: never seen
    const [dx, dy, dz] = dirOf(x, y, z);
    if (dz > 0.78 && dy < 0.1 && dy > -0.52 && Math.abs(dx) < 0.4) return muzzle;
    const bel = -dy * 0.95 + dz * 0.32 + (hash3(x, y, z, 5) - 0.5) * 0.08;
    if (bel > 0.52) return belly;
    if (bel > 0.42) return bellyEdge;
    if (dz > 0.4 && Math.hypot(Math.abs(dx) - 0.56, (dy + 0.07) * 1.3) < 0.12 + hash3(x, y, z, 9) * 0.02) return inf > 0.4 ? flush : blush;
    for (const s of SPOTS) if (dx * s.d[0] + dy * s.d[1] + dz * s.d[2] > s.c) return spot;
    if (dz > 0.5 && Math.abs(dx) < 0.34) for (const wy of [0.55, 0.64]) if (Math.abs(dy - wy - Math.sin(dx * 10) * 0.02) < 0.02) return wrinkle;
    for (const s of [-1, 1]) {
      const ex = dx - s * EX, ey = dy - EY;
      const d = Math.hypot(ex * 1.1, ey);
      if (dz > 0.5 && ey < -0.08 && Math.abs(d - 0.2) < 0.022) return wrinkle;
    }
    return dy > 0.5 ? skinTop : skin;
  };
  m.ellipsoid(cx, cy, cz, RX, RY, RZ, bodyCol);
  // eye sockets (the 2D eyes sit on top)
  for (const s of [-1, 1]) {
    const ex = cx + s * EX * RX, ey = cy + EY * RY, ez = cz + RZ * 0.86;
    m.ellipsoid(ex, ey, ez, 7, 6.6, 4.2, bodyCol);
  }
  // cardigan: an outer knit shell around the lower body with a V-neck (tighter and strained when puffed)
  const C0 = -0.16 - inf * 0.22, VW = 2.4 - inf * 0.7;
  const collarAt = (dx, dz) => C0 - (dz > 0 ? Math.max(0, 0.8 - Math.abs(dx) * VW) * dz : 0);
  m.under(() => m.ellipsoid(cx, cy, cz, RX + 1.7, RY + 1.7, RZ + 1.7, (x, y, z) => {
    const [dx, dy, dz] = dirOf(x, y, z);
    const col = collarAt(dx, dz);
    if (dy > col) return null;
    if (dy > col - 0.07) return knit[2];
    if (dy < -0.9) return knit[2];
    const th = Math.atan2(dx, dz);
    const rib = Math.floor((th * RX) / 2.2);
    if (dz > 0.25 && Math.abs(dy - col) < 0.16 && Math.abs(dx) < 0.5) return knit[1];
    return rib % 3 === 0 ? knit[2] : y % 5 === 0 ? knit[1] : knit[0];
  }));
  // buttons down the V
  for (const dy of [-0.46, -0.6, -0.74]) {
    const dz = 0.75;
    const adx = Math.max(0.05, (0.8 - (C0 - dy) / dz) / VW);
    const bx = -(adx + 0.07);
    const bz = Math.sqrt(Math.max(0, 1 - bx * bx - dy * dy));
    m.sphere(cx + bx * (RX + 2), cy + dy * (RY + 2), cz + bz * (RZ + 2), 1.7, button);
  }
  // sleeves out of the cardigan, cuffs resting near the counter
  const A = {};
  for (const s of [-1, 1]) {
    const sx = cx + s * RX * 0.78, sy = cy - RY * 0.2, sz = cz + RZ * 0.25;
    const wx = cx + s * (RX * 0.93 + 3), wy = cy - RY * 0.6, wz = cz + RZ * 0.72;
    m.line(sx, sy, sz, wx, wy, wz, (x, y) => ((y >> 1) % 2 ? knit[0] : knit[1]), 6);
    m.line(wx - s * 1.2, wy - 0.8, wz - 1.2, wx + s * 0.6, wy - 1.4, wz + 0.8, knit[2], 6.6);
    A[s < 0 ? 'handL' : 'handR'] = [wx + s * 1.5, wy - 4, wz + 3];
  }
  // a stubby fan tail peeking out behind him, and a little dorsal fin
  {
    const tx0 = cx + RX * 0.55, ty0 = cy + RY * 0.15, tz0 = cz - RZ * 0.8;
    for (let k = 0; k < 5; k++) m.line(tx0, ty0, tz0, tx0 + 9 + Math.abs(k - 2) * -1, ty0 - 7 + k * 3.5, tz0 - 7, k % 2 ? finC : finR, 1.1);
    m.ellipsoid(tx0 + 6, ty0, tz0 - 5, 2.5, 6.5, 2.5, finC);
    m.ellipsoid(cx - RX * 0.3, cy + RY * 0.9, cz - RZ * 0.55, 1.4, 4, 4.5, finC);
  }
  // nose + walrus moustache
  m.sphere(cx, cy + RY * 0.02, cz + RZ * 0.97, 4.6, noseC);
  for (const s of [-1, 1]) {
    const mcol = (x, y) => (y < cy - RY * 0.13 - 1 ? stacheS : stache);
    m.ellipsoid(cx + s * 5.4, cy - RY * 0.12, cz + RZ * 0.95 + 1.6, 6.8, 3.1, 3.6, mcol);
    m.ellipsoid(cx + s * 10.6, cy - RY * 0.19 - 1.4, cz + RZ * 0.88 + 1.4, 3.1, 4.2, 3, mcol);
  }
  // spikes: nubs at rest, long when puffed (they even poke through the cardigan)
  for (let si = 0; si < SPIKES.length; si++) {
    const d = SPIKES[si];
    if (inf < 0.2 && si % 2) continue;
    if (d[2] > 0.42 && d[1] > -0.55) continue;
    if (d[1] > 0.8 && d[2] > -0.3) continue; // under the cap
    const col = collarAt(d[0], d[2]);
    if (d[1] < col && inf < 0.35) continue;
    const L = SL * (0.75 + hash1(d[0] * 99 + d[1] * 7, 3) * 0.5);
    const bx = cx + d[0] * RX, by = cy + d[1] * RY, bz = cz + d[2] * RZ;
    const mx = bx + d[0] * L * 0.5, my = by + d[1] * L * 0.5, mz = bz + d[2] * L * 0.5;
    m.line(bx - d[0], by - d[1], bz - d[2], mx, my, mz, spikeC, 1.05);
    m.line(mx, my, mz, bx + d[0] * L, by + d[1] * L, bz + d[2] * L, spikeC, 0.55);
  }
  // little captain's cap, tilted, perched on top
  const capX = cx + 3, capY = cy + RY * 0.84, capZ = cz - 1, tilt = -0.12, ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let y = Math.floor(capY - 4); y <= Math.ceil(capY + 14); y++) {
    for (let z = Math.floor(capZ - 18); z <= Math.ceil(capZ + 24); z++) {
      for (let x = Math.floor(capX - 18); x <= Math.ceil(capX + 18); x++) {
        const px = x + 0.5 - capX, py = y + 0.5 - capY, pz = z + 0.5 - capZ;
        const lx = px * ct + py * st, ly = -px * st + py * ct, lz = pz;
        let c = 0;
        const r = 12 + Math.max(0, ly - 3) * 0.55;
        const dome = ly > 8 ? (ly - 8) * 2.2 : 0;
        if (ly >= 0 && ly <= 9.6 && (lx * lx) / ((r - dome) ** 2) + (lz * lz) / ((r - dome) ** 2 * 0.86) <= 1) {
          if (ly < 3) c = lz > r * 0.8 && Math.abs(lx) < 2.4 && ly > 0.5 ? gold : capBand;
          else if (ly < 3.9 && lz > -2) c = gold;
          else c = ly > 8.4 ? capTop : capW;
        } else if (ly >= -0.4 && ly < 1.3 && lz > 3) {
          const vx = lx / 11.5, vz = (lz - 3) / (r + 4 - 3);
          if (vx * vx + vz * vz <= 1) c = lz > r + 1.5 ? gold : visor;
        }
        if (c) m.set(x, y, z, c);
      }
    }
  }
  const r = renderVoxels(m, { scale: BLOAT_VS, yaw: 7, pitch: 13 });
  const P = (x, y, z) => { const p = r.project(x, y, z); return [Math.round(p[0]), Math.round(p[1])]; };
  const eyeZ = cz + RZ * 0.86 + 4;
  const a = {
    c: P(cx, cy, cz),
    eyeL: P(cx - EX * RX, cy + EY * RY, eyeZ), eyeR: P(cx + EX * RX, cy + EY * RY, eyeZ),
    nose: P(cx, cy + RY * 0.02, cz + RZ * 0.97 + 4.6),
    mouth: P(cx, cy - RY * 0.12 - 4.4, cz + RZ * 0.95),
    cheekR: P(cx + RX * 0.55, cy - RY * 0.05, cz + RZ * 0.8),
    top: P(capX, capY + 9, capZ),
    handL: P(...A.handL), handR: P(...A.handR),
    templeL: P(cx - RX * 0.66, cy + EY * RY + 1, cz + RZ * 0.62), templeR: P(cx + RX * 0.66, cy + EY * RY + 1, cz + RZ * 0.62),
    chain: P(cx - RX * 0.32, cy - RY * 0.5, cz + RZ * 0.95),
  };
  return { canvas: r.canvas, a, w: r.w, h: r.h };
}

// ================================================================ small 2D sprites

function glowSprite(r, color, strength = 1) {
  return memo(`glow|${r}|${color}|${strength}`, () => {
    const D = r * 2 + 1, b = new PixelBuffer(D, D);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const d = Math.hypot(x - r, y - r) / r;
      if (d >= 1) continue;
      const v = Math.pow(1 - d, 1.7) * strength * 4 + (bayer(x, y) - 0.5) * 0.9;
      const lv = clamp(Math.floor(v), 0, 4);
      if (lv) b.set(x, y, pack(color, lv * 34));
    }
    return b.toCanvas();
  });
}

// fin hand: a little fan of fin rays (pose 0 rest, 1 raised, 2 wave)
function finSprite(side, pose) {
  return memo(`fin|${side}|${pose}`, () => {
    const b = new PixelBuffer(26, 22);
    const C = ['#fbe6a2', '#ecc66c', '#cf9c4c', '#9a6a32'].map((c) => pack(c));
    const ang = pose === 2 ? -1.0 : pose === 1 ? -0.4 : 0.12;
    // webbing first, rays on top
    for (let k = 0; k < 6; k++) {
      const a = ang + (k - 2.5) * 0.26;
      for (let t = 0; t < 12; t++) {
        const x = 5 + Math.cos(a) * t * 1.45, y = 12 + Math.sin(a) * t * 1.45;
        b.set(Math.round(x), Math.round(y), C[t > 8 ? 0 : 1]);
        b.set(Math.round(x), Math.round(y) + 1, C[t > 8 ? 1 : 1]);
      }
    }
    for (let k = 0; k < 6; k += 1) {
      const a = ang + (k - 2.5) * 0.26;
      for (let t = 1; t < 10; t++) b.set(Math.round(5 + Math.cos(a) * t * 1.45), Math.round(12 + Math.sin(a) * t * 1.45), C[k % 2 ? 2 : 3]);
    }
    b.fillCircle(5, 12.5, 3.6, C[2]);
    b.set(4, 11, C[0]); b.set(3, 12, C[1]);
    b.outline(() => pack('#4a2a14'));
    const cv = b.toCanvas();
    if (side > 0) return cv;
    const f = makeCanvas(cv.width, cv.height), g = ctxOf(f);
    g.translate(cv.width, 0); g.scale(-1, 1); g.drawImage(cv, 0, 0);
    return f;
  });
}

// bushy white eyebrow; slope > 0 = angry (inner end down)
function browSprite(side, slope) {
  return memo(`brow|${side}|${slope}`, () => {
    const W = 27, H = 18, b = new PixelBuffer(W, H);
    const C = ['#fdfbf6', '#ece8de', '#cfc9bd', '#a8a196'].map((c) => pack(c));
    for (let x = 1; x < W - 2; x++) {
      const u = x / (W - 3);
      const inner = side < 0 ? u : 1 - u; // 1 at the inner end (towards the nose)
      const yc = 9 + slope * (inner - 0.5) * 8 - Math.sin(u * Math.PI) * 1.8;
      const th = 2.8 + Math.sin(u * Math.PI) * 2.8 + hash1(x, 3) * 1.4;
      const top = Math.round(yc - th * 0.55 - (hash1(x, 9) > 0.6 ? 1 : 0));
      const bot = Math.round(yc + th * 0.45 + (1 - inner > 0.7 ? 1.5 : 0));
      for (let y = top; y <= bot; y++) b.set(x, y, C[y === top ? 0 : y >= bot - 1 ? 2 : (x + y) % 3 === 0 ? 0 : 1]);
      if (hash1(x, 13) > 0.55) b.set(x, top - 1, C[1]);
    }
    // wild hairs at the outer end
    const ox = side < 0 ? 1 : W - 3;
    b.set(ox, 6, C[1]); b.set(ox - side, 5, C[0]); b.set(ox + side * 0, 11, C[2]);
    b.outline(() => pack('#4a443e'));
    return b.toCanvas();
  });
}

function cigarSprite() {
  return memo('cigar', () => {
    const L = 22, b = new PixelBuffer(L + 4, 12);
    const C = ['#3e2210', '#6a3e1c', '#8e5a2c', '#b07a40'];
    for (let i = 0; i < L; i++) {
      const y0 = 3 + i * 0.32;
      for (let k = 0; k < 4; k++) {
        let c = k === 0 ? C[3] : k === 3 ? C[0] : C[k === 1 ? 2 : 1];
        if (i >= 4 && i <= 6) c = k === 0 ? '#ff6a6a' : k === 3 ? '#7a1020' : i === 5 ? '#f0c040' : '#c8283a';
        if (i >= L - 3) c = k === 0 ? '#d8d4ce' : k === 3 ? '#6a6460' : '#a8a29c';
        b.set(i + 1, Math.round(y0 + k), pack(c));
      }
    }
    b.outline(() => pack('#22140a'));
    return b.toCanvas();
  });
}

function bubbleDot(size) {
  return memo(`bub|${size}`, () => {
    const D = size * 2 + 1, b = new PixelBuffer(D + 2, D + 2);
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const d = Math.hypot(x - size, y - size);
      if (d > size + 0.3) continue;
      const edge = d > size - 0.9;
      b.set(x + 1, y + 1, pack(edge ? '#d8f6ff' : '#9ad8ee', edge ? 230 : 70));
    }
    b.set(Math.max(1, size), Math.max(1, size - Math.max(0, size - 1)), pack('#ffffff'));
    return b.toCanvas();
  });
}

// ================================================================ voxel bait previews (rotating)

function baitModel(id) {
  const m = new VoxelModel(18, 18, 18);
  const c = (hex, o = {}) => m.color(hex, { jitter: 0.05, smooth: 0.6, ...o });
  switch (id) {
    case 'bread': {
      const crust = c('#b8753a'), crumb = c('#f2dca0', { jitter: 0.08 }), hole = c('#d8b878');
      for (let y = 2; y <= 15; y++) for (let x = 2; x <= 15; x++) for (let z = 6; z <= 10; z++) {
        const top = (x - 8.5) ** 2 / 46 + (y - 11.5) ** 2 / 14 <= 1;
        if (y > 11 && !top) continue;
        const edge = x === 2 || x === 15 || y === 2 || (y > 11 && (x - 8.5) ** 2 / 34 + (y - 11.5) ** 2 / 10 > 1) || z === 6 || z === 10;
        const isCrust = edge && (x === 2 || x === 15 || y === 2 || y > 11);
        m.set(x, y, z, isCrust ? crust : hash3(x, y, z, 2) > 0.86 ? hole : crumb);
      }
      break;
    }
    case 'worm': {
      const a = c('#ff8ac0', { emissive: 0.35, smooth: 0.9 }), b2 = c('#e05a9a', { emissive: 0.25, smooth: 0.9 }), eye = c('#1a0a14', { smooth: 0 }), shine = c('#ffffff', { emissive: 1 });
      const pts = [[3, 3, 9, 1.2], [6, 2.5, 11, 1.4], [10, 3.5, 12, 1.55], [13, 6.5, 10, 1.6], [12.5, 9.5, 7, 1.6], [9, 10.5, 6, 1.6], [6, 12, 8, 1.55], [6.5, 14.5, 11, 1.5]];
      m.tube(pts, (x, y, z) => (Math.floor((x + y + z) / 1.5) % 3 === 0 ? b2 : a), 6);
      m.set(5.6, 15.4, 12.2, eye); m.set(7.6, 15.4, 12.2, eye); m.set(5.6, 16.2, 12.2, shine);
      break;
    }
    case 'sugar': {
      const w = c('#fbfbff', { jitter: 0.12, smooth: 0.1 }), s = c('#ffffff', { emissive: 0.9 });
      m.box(4, 3, 4, 13, 12, 13, w);
      for (let i = 0; i < 9; i++) m.set(4 + Math.floor(hash1(i, 1) * 10), 3 + Math.floor(hash1(i, 2) * 10), 13, s);
      for (let i = 0; i < 5; i++) m.set(4 + Math.floor(hash1(i, 3) * 10), 12, 4 + Math.floor(hash1(i, 4) * 10), s);
      break;
    }
    case 'golden': {
      const g = c('#ffcc3a', { spec: 2.4, specPow: 8, smooth: 0.9 }), g2 = c('#e8a020', { spec: 1.8, smooth: 0.9 }), s = c('#fff8c0', { emissive: 1 }), hook = c('#c8d0dc', { spec: 2 });
      m.ellipsoid(9, 7, 9, 5.5, 4.6, 4.6, g);
      m.ellipsoid(6, 9, 10, 2.6, 2.4, 2.4, g2);
      m.ellipsoid(12, 5, 8, 2.4, 2.2, 2.6, g2);
      m.line(9, 11, 9, 9, 15, 9, hook, 0.6);
      m.line(9, 15, 9, 11, 16, 9, hook, 0.6);
      for (const [x, y, z] of [[5, 6, 12], [13, 9, 11], [9, 4, 13]]) m.set(x, y, z, s);
      break;
    }
    case 'flood': {
      const w = c('#3aa8f0', { smooth: 0.95, spec: 2, specPow: 10, emissive: 0.25 }), h = c('#d8f4ff', { emissive: 0.6 });
      m.sphere(9, 6.5, 9, 5.2, w);
      m.cone(9, 9, 9, 16, 4.2, 0.6, w);
      m.set(7, 9, 13, h); m.set(6, 8, 13, h); m.set(6, 7, 13, h);
      break;
    }
    case 'blackhole': {
      const k = c('#0a0816', { smooth: 0.9, spec: 0.6 }), ring = c('#b46bff', { emissive: 1 }), ring2 = c('#ff8af0', { emissive: 1 });
      m.sphere(9, 9, 9, 4.6, k);
      for (let a = 0; a < TAU; a += 0.05) {
        const rx = Math.cos(a) * 7.5, rz = Math.sin(a) * 7.5;
        const y = 9 + rz * 0.42, z = 9 + rz * 0.9;
        m.set(9 + rx, y, z, Math.sin(a * 3) > 0 ? ring : ring2);
      }
      break;
    }
    case 'chip': {
      const pcb = c('#2a8a4a'), trace = c('#e8c050', { spec: 1.5 }), chipC = c('#1a1a22', { spec: 1 }), pin = c('#d8d8e0', { spec: 2 }), led = c('#ff4a4a', { emissive: 1 });
      m.box(2, 6, 2, 15, 7, 15, pcb);
      m.box(6, 8, 6, 11, 9, 11, chipC);
      for (let i = 6; i <= 11; i += 2) { m.set(i, 8, 5, pin); m.set(i, 8, 12, pin); m.set(5, 8, i, pin); m.set(12, 8, i, pin); }
      for (let i = 3; i <= 14; i++) { m.set(i, 8, 3, trace); if (i % 3 === 0) m.set(3, 8, i, trace); }
      m.set(14, 8, 14, led);
      break;
    }
    case 'popup': {
      const white = c('#f4f4f8', { smooth: 0.2 }), bar = c('#2a6ad8', { smooth: 0.2 }), red = c('#e84a4a', { emissive: 0.4 }), txt = c('#ffcc3a', { emissive: 0.5 }), grey = c('#9aa0b0');
      m.box(1, 3, 7, 16, 13, 9, white);
      m.box(1, 11, 7, 16, 13, 9, bar);
      m.box(14, 11, 10, 15, 12, 10, red);
      m.box(3, 8, 10, 12, 8, 10, txt);
      m.box(3, 6, 10, 9, 6, 10, grey);
      m.box(6, 4, 10, 11, 4, 10, red);
      break;
    }
    case 'lantern': {
      const shell = c('#eab8c8', { smooth: 0.8 }), shell2 = c('#c8889a', { smooth: 0.8 }), pearl = c('#5affc8', { emissive: 1, smooth: 0.95 });
      for (let x = 2; x <= 15; x++) for (let z = 3; z <= 15; z++) {
        const d = ((x - 8.5) / 7) ** 2 + ((z - 9) / 6.5) ** 2;
        if (d > 1) continue;
        const ridge = Math.floor(Math.atan2(z - 3, x - 8.5) * 5) % 2;
        m.set(x, 3 + Math.round(d * 1.5), z, ridge ? shell : shell2);
        if (z < 9) m.set(x, 4 + Math.round((9 - z) * 1.25 + d * 1.2), Math.round(z * 0.6 + 1), ridge ? shell2 : shell);
      }
      m.sphere(8.5, 7.5, 10, 3.6, pearl);
      break;
    }
    case 'relic': {
      const stone = c('#6e7c6a', { jitter: 0.1 }), dark = c('#4a5648'), glyph = c('#5ae8ff', { emissive: 1 }), moss = c('#5a9a4a', { jitter: 0.1 });
      for (let y = 1; y <= 15; y++) for (let x = 4; x <= 13; x++) {
        if (y > 12 && (x - 8.5) ** 2 / 25 + (y - 12) ** 2 / 9 > 1) continue;
        for (let z = 6; z <= 10; z++) m.set(x, y, z, hash3(x, y, z, 4) > 0.85 ? dark : stone);
      }
      for (const [x, y] of [[6, 4], [7, 4], [8, 5], [9, 4], [10, 4], [8, 7], [8, 8], [6, 9], [10, 9], [7, 11], [8, 11], [9, 11], [8, 12]]) m.set(x, y, 11, glyph);
      for (let x = 4; x <= 13; x++) if (hash1(x, 6) > 0.5) m.set(x, 1, 11, moss);
      break;
    }
    default:
      m.sphere(9, 9, 9, 5, c('#ffffff'));
  }
  return m;
}

const BAIT_FRAMES = 16;
function baitFrame(id, k, build) {
  const key = `bv|${id}|${k}`;
  let f = cache.get(key);
  if (f || !build) return f || null;
  const m = baitModel(id);
  const r = renderVoxels(m, { scale: 5, yaw: (k / BAIT_FRAMES) * 360, pitch: 22 });
  const c = r.project(9, 9, 9);
  f = { canvas: r.canvas, glow: r.glow, cx: Math.round(c[0]), base: r.oy };
  cache.set(key, f);
  return f;
}

// ================================================================ scene pieces (voxel)

function buildJarShelf(wv) {
  const H = 62, D = 13;
  const m = new VoxelModel(wv, H, D);
  const wood = [m.color('#7a4c2a', { jitter: 0.08 }), m.color('#5e3a20', { jitter: 0.08 }), m.color('#93603a', { jitter: 0.06 })];
  const glassC = m.color('#3e7a84', { jitter: 0.02, smooth: 0.6, spec: 2.2, specPow: 12, light: 0.05 });
  const lidC = [m.color('#b8782a', { spec: 1.2 }), m.color('#a8384a'), m.color('#3a6aa8'), m.color('#4a8a4a')];
  const glowCols = ['#ff4aa8', '#ffc81a', '#1affb8', '#a04aff', '#3aff6a', '#2aa8ff', '#ff7a1a', '#e8f8ff'];
  const fill = glowCols.map((g) => m.color(g, { emissive: 1, jitter: 0.05 }));
  const dull = [m.color('#d8b878', { jitter: 0.1 }), m.color('#8a6a4a', { jitter: 0.1 })];
  const rng = new RNG(4242);
  for (const sy of [0, 30]) {
    m.box(0, sy, 0, wv - 1, sy + 2, D - 1, (x, y) => (y === sy + 2 ? wood[2] : wood[0]));
    // brackets
    for (const bx of [3, wv - 5, Math.floor(wv / 2)]) m.box(bx, sy - 4, 0, bx + 1, sy - 1, 3, wood[1]);
    let x = 3;
    while (x < wv - 10) {
      const w = rng.int(5, 8), h = rng.int(8, 14);
      const z0 = rng.int(2, 4);
      if (rng.chance(0.12)) {
        // a stack of old books
        for (let b = 0; b < 3; b++) m.box(x, sy + 3 + b * 2, z0, x + w, sy + 4 + b * 2, z0 + 6, lidC[(b + x) % 4]);
        x += w + 3;
        continue;
      }
      const gi = rng.int(0, fill.length - 1);
      const glowing = rng.chance(0.75);
      m.box(x, sy + 3, z0, x + w, sy + 3 + h, z0 + w - 1, glassC);
      m.box(x + 1, sy + 3, z0 + 1, x + w - 1, sy + 2 + Math.floor(h * rng.float(0.5, 0.85)), z0 + w - 1, glowing ? fill[gi] : dull[rng.int(0, 1)]);
      m.box(x - (w > 6 ? 0 : 0), sy + 4 + h, z0, x + w, sy + 5 + h, z0 + w - 1, lidC[rng.int(0, 3)]);
      x += w + rng.int(2, 4);
    }
  }
  return renderVoxels(m, { scale: 2, yaw: 0, pitch: 12, glowRadius: 4 });
}

function buildRegister() {
  const m = new VoxelModel(40, 34, 24);
  const brass = [m.color('#d8a040', { jitter: 0.04, smooth: 0.7, spec: 1.8, specPow: 10 }), m.color('#b07a2a', { jitter: 0.04, smooth: 0.6 }), m.color('#8a5a1c')];
  const key = m.color('#f2ead8', { jitter: 0.03 }), keyD = m.color('#2a2228');
  const disp = m.color('#1a1a20'), digit = m.color('#ffa84a', { emissive: 1 });
  const wood = m.color('#6a4024', { jitter: 0.06 });
  m.box(2, 0, 3, 37, 3, 21, wood);
  m.box(3, 4, 4, 36, 14, 20, (x, y) => (y === 9 ? brass[2] : brass[0]));
  // sloped keyboard
  for (let z = 14; z <= 21; z++) {
    const top = 14 - (z - 14);
    m.box(3, 4, z, 36, top, z, brass[1]);
    if (z % 2 === 0 && top > 8) for (let x = 6; x <= 33; x += 3) m.box(x, top + 1, z, x + 1, top + 1, z, (x + z) % 4 ? key : keyD);
  }
  // top display
  m.box(8, 15, 6, 31, 22, 12, brass[0]);
  m.box(10, 17, 12, 29, 21, 12, disp);
  for (const x of [12, 16, 20, 24, 27]) m.box(x, 18, 12, x + 1, 20, 12, digit);
  m.box(7, 23, 6, 32, 24, 12, brass[1]);
  // crank
  m.line(37, 10, 12, 39, 10, 12, brass[1], 0.9);
  m.line(39, 10, 12, 39, 16, 15, brass[2], 0.8);
  m.sphere(39, 16, 15, 1.4, key);
  return renderVoxels(m, { scale: 2, yaw: -14, pitch: 18 });
}

// ================================================================ scene pieces (2D, cached)

function wallTex(w, h) {
  return memo(`wall|${w}|${h}`, () => {
    const b = new PixelBuffer(w, h);
    const R = ['#24150d', '#352014', '#4a2d1b', '#5c3922', '#6e462a'];
    let x0 = 0, bi = 0;
    const boards = [];
    while (x0 < w) { const bw = 20 + Math.floor(hash1(bi, 3) * 9); boards.push([x0, bw, bi]); x0 += bw; bi++; }
    for (const [bx, bw, i] of boards) {
      const tone = (hash1(i, 5) - 0.5) * 0.7;
      for (let y = 0; y < h; y++) {
        const vy = y / h;
        for (let x = bx; x < Math.min(w, bx + bw); x++) {
          const lx = x - bx;
          let v = 2.2 + tone + Math.sin((y + i * 31) * 0.045 + Math.sin(lx * 0.4 + i) * 0.8) * 0.45 + (hash2(lx >> 1, y >> 3, i) - 0.5) * 0.3;
          v -= Math.max(0, 0.3 - vy) * 3.2; // ceiling shadow
          v -= Math.max(0, vy - 0.82) * 4; // floor shadow
          if (lx === 0) v = 0.2;
          else if (lx === 1) v -= 0.6;
          else if (lx === bw - 1) v += 0.5;
          v += (bayer(x, y) - 0.5) * 0.7;
          let c = R[clamp(Math.floor(v), 0, 4)];
          if (vy > 0.62) c = mix(c, '#0e3640', (vy - 0.62) * 0.55);
          b.set(x, y, pack(c));
        }
      }
      // nails + a barnacle or two near the bottom
      for (const ny of [Math.floor(h * 0.12), Math.floor(h * 0.7)]) { b.set(bx + 3, ny, pack('#a8a49a')); b.set(bx + 3, ny + 1, pack('#4a4440')); b.set(bx + bw - 4, ny, pack('#a8a49a')); b.set(bx + bw - 4, ny + 1, pack('#4a4440')); }
      if (hash1(i, 8) > 0.6) {
        const cx = bx + 4 + Math.floor(hash1(i, 9) * (bw - 8)), cy = Math.floor(h * (0.86 + hash1(i, 10) * 0.1));
        b.fillCircle(cx, cy, 2.2, pack('#c8c0b0'));
        b.set(cx, cy, pack('#5a5048'));
        b.set(cx - 1, cy - 1, pack('#f4eee4'));
      }
    }
    return b.toCanvas();
  });
}

function portholeRing(R) {
  return memo(`port|${R}`, () => {
    const D = R * 2 + 6, b = new PixelBuffer(D, D);
    const B = ['#3e2210', '#7a4a1c', '#b8782a', '#e0a844', '#f6d27a', '#fff2b8'];
    const c0 = D / 2;
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const dx = x + 0.5 - c0, dy = y + 0.5 - c0, d = Math.hypot(dx, dy);
      if (d > R + 2 || d < R - 6) continue;
      const l = (-dx - dy) / d;
      let v;
      if (d > R + 1) v = 0;
      else if (d < R - 5) v = 0;
      else v = 2.5 + l * 1.5 * (d > R - 2 ? 1 : -1) + (bayer(x, y) - 0.5) * 0.6;
      b.set(x, y, pack(B[clamp(Math.round(v), 0, 5)]));
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + 0.3;
      const x = Math.round(c0 + Math.cos(a) * (R - 2)), y = Math.round(c0 + Math.sin(a) * (R - 2));
      b.set(x, y, pack(B[5])); b.set(x + 1, y + 1, pack(B[0])); b.set(x + 1, y, pack(B[3]));
    }
    return b.toCanvas();
  });
}

// ================================================================ panel

export class ShopPanel {
  constructor() {
    this.id = 'shop';
    this.modal = true;
    this.sound = 'box_open';
    this.tab = 'bait';
    this.page = 0;
    this.t = 0;
    this.decorSpr = {};
    this.cosSpr = {};
    this.decor = null;
    this.frames = { br: [], pf: [] };
    this.pend = [];
    // pre-build Cap'n Bloat in idle time so the shop opens instantly
    const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 200));
    const warm = (i) => { if (i < 6 && !this.warmDone) idle(() => { try { this.bloatFrame(i < 3 ? 'br' : 'pf', i < 3 ? i : i - 3, true); } catch { /* ignore */ } warm(i + 1); }); };
    setTimeout(() => warm(0), 1500);
  }

  // ------------------------------------------------ Cap'n Bloat frames
  bloatFrame(kind, i, build) {
    const list = this.frames[kind];
    if (list[i]) return list[i];
    if (!build) return null;
    const t0 = performance.now();
    const f = kind === 'br' ? buildBloat(0, i / 2) : buildBloat((i + 1) / 3, 0);
    (globalThis.__shopMs ||= []).push([kind, i, Math.round(performance.now() - t0), f.w, f.h]);
    list[i] = f;
    return f;
  }

  open(data) {
    const g = this.game;
    this.t = 0;
    if (TABS.some((t) => t.id === data?.tab)) this.tab = data.tab;
    this.decor = decorList();
    this.cosmetics = wardrobeItems();
    this.special = this.dailySpecial();
    this.page = 0;
    this.hoverId = null;
    this.hoverT = 0;
    this.lastLine = -9;
    this.idleT = 7 + Math.random() * 4;
    this.focus = null; // close-up item
    this.zoom = 0; // 0 shelves .. 1 counter close-up
    this.zoomDir = 0;
    this.mood = 'grumpy';
    this.moodT = 0;
    this.hop = 0;
    this.puffAmt = 0;
    this.puffT = 0;
    this.drag = 0;
    this.dragT = 3 + Math.random() * 3;
    this.coughT = 0;
    this.nextCough = 14 + Math.random() * 10;
    this.smoke = [];
    this.rings = [];
    this.fx = [];
    this.flyers = [];
    this.sold = 0;
    this.drawer = 0;
    this.bellSwing = 0;
    this.tabAnim = 1;
    this.blinkT = 2;
    this.drumT = 0;
    this.pop = {};
    this.line = null;
    this.say(pick(LINES.greet), 'grumpy', undefined, 0.5);
    g.audio.play('bell', { vol: 0.35, pitch: 1.4 });
    this.shopState();
  }

  close() { this.focus = null; this.zoom = 0; }

  // persistent shop bookkeeping lives in state.shop (stock sold today, cosmetics owned)
  shopState() {
    const st = this.game.state;
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    st.shop ||= {};
    if (!st.shop.stock || st.shop.stock.day !== day) st.shop.stock = { day, sold: {} };
    return st.shop;
  }

  dailySpecial() {
    const g = this.game;
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    const r = new RNG(day * 7919 + 1301);
    const pool = [
      ...BAIT_ORDER.filter((id) => id !== 'bread' && g.stats.unlockBait.has(id)).map((id) => ({ tab: 'bait', id })),
      ...this.decor.filter((d) => d.price >= 60).map((d) => ({ tab: 'decor', id: d.id })),
    ];
    const pickd = r.pick(pool.length ? pool : [{ tab: 'bait', id: 'worm' }]);
    return { ...pickd, off: 0.2 };
  }

  // ------------------------------------------------ catalogue
  items(tab = this.tab) {
    const g = this.game, st = g.state;
    if (tab === 'bait') {
      return BAIT_ORDER.map((id) => {
        const b = BAITS[id];
        const locked = !g.stats.unlockBait.has(id);
        return { id, kind: 'bait', name: b.name, desc: b.desc, base: b.price, qty: b.qty, locked, skill: locked ? unlockSkillFor(id) : null };
      });
    }
    if (tab === 'decor') return this.decor.map((d) => ({ id: d.id, kind: 'decor', name: d.name, desc: decorDesc(d), base: d.price, size: d.size, biome: d.biome, tags: d.tags, locked: false }));
    if (tab === 'cosmetics') {
      const list = this.cosmetics.map((c) => {
        const own = this.ownsCos(c);
        const locked = !own && c.price == null;
        const why = c.unlock === 'skill' ? SKILLS.find((q) => q.id === c.skill) : null;
        return { ...c, kind: 'cosmetic', base: c.price ?? 0, locked, own, skill: why, lockWhy: c.unlock === 'package' ? 'Found only in mystery crates' : why ? `Grow '${why.name}'` : 'Not for sale', desc: c.desc || `A fine ${prettify(c.slot).toLowerCase()} for your fisher.` };
      });
      // things you can still buy first, then crate / skill teasers, then what you already own
      const rank = (q) => (q.own ? 2 : q.locked ? 1 : 0);
      return list.sort((a, b) => rank(a) - rank(b));
    }
    // specials: today's deal + bundles built from unlocked bait
    const has = (id) => g.stats.unlockBait.has(id);
    const sp = this.special;
    const deal = sp && this.items(sp.tab).find((q) => q.id === sp.id);
    const out = [];
    if (deal) out.push({ ...deal, id: 'deal', dealOf: deal, kind: 'deal', name: `Deal: ${deal.name}`, desc: `Today only: ${deal.name} at ${Math.round(sp.off * 100)}% off. ${deal.desc}`, base: deal.base });
    const bundle = (id, name, desc, contents, price, need, icon) => {
      const missing = need.filter((b) => !has(b));
      const value = contents.reduce((a, [b, n]) => a + Math.round((BAITS[b].price / BAITS[b].qty) * n), 0);
      out.push({ id, kind: 'bundle', name, desc, contents, base: price, value, locked: missing.length > 0, skill: missing.length ? unlockSkillFor(missing[0]) : null, icon });
    };
    bundle('b_bread', 'Bulk Bread Sack', 'Thirty crumbs of yesterday\'s finest. Commons can\'t resist.', [['bread', 30]], 30, [], 'sack');
    bundle('b_sailor', "Sailor's Bundle", 'A proper starter kit: bread for the commons, worms for the curious.', [['bread', 10], ['worm', 3]], 30, ['worm'], 'crate');
    bundle('b_mystery', 'Mystery Tackle Box', 'Three random packs of bait you can use. Could be gold. Could be bread.', [], 75, [], 'mystery');
    bundle('b_junk', 'Junk Diver Kit', 'Chips and pop-ups for the Junkyard Reef crowd.', [['chip', 4], ['popup', 3]], 150, ['chip', 'popup'], 'crate2');
    bundle('b_golden', 'Golden Hour Bundle', 'Two golden baits and two lantern pearls. For the serious angler.', [['golden', 2], ['lantern', 2]], 370, ['golden', 'lantern'], 'chest');
    return out;
  }

  price(it) {
    const sp = this.special;
    if (it.kind === 'deal') return Math.round(it.base * (1 - sp.off));
    return sp && sp.id === it.id ? Math.round(it.base * (1 - sp.off)) : it.base;
  }

  owned(it) {
    const st = this.game.state;
    if (it.kind === 'deal') return this.owned(it.dealOf);
    if (it.kind === 'bait') return st.baits[it.id] || 0;
    if (it.kind === 'cosmetic') return this.ownsCos(it) ? 1 : 0;
    if (it.kind === 'bundle') return 0;
    const idOf = (d) => (typeof d === 'string' ? d : d?.id);
    return [...(st.tank?.decor || []), ...(st.tank?.stored || [])].filter((d) => idOf(d) === it.id).length;
  }

  ownsCos(c) {
    const st = this.game.state;
    if (CHAR.ownsCosmetic) return !!CHAR.ownsCosmetic(st, c.item || c.id);
    return c.price === 0 || !!st.cosmetics?.[c.id];
  }

  wearing(c) {
    const st = this.game.state;
    if (CHAR.isEquipped) { try { return !!CHAR.isEquipped(st.character, c.item); } catch { return false; } }
    return st.character?.[c.slot] === c.value;
  }

  wear(c) {
    const g = this.game, st = g.state;
    st.character = CHAR.equipItem ? CHAR.equipItem(st.character, c.item) : { ...(CHAR.DEFAULT_CHARACTER || {}), ...(st.character || {}), [c.slot]: c.value };
    g.emit('wardrobe', { slot: c.slot, id: c.id });
    g.save?.();
  }

  stockLeft(it) {
    const sold = this.shopState().stock.sold;
    if (it.kind === 'deal') return this.stockLeft(it.dealOf);
    if (it.kind === 'cosmetic') return this.owned(it) ? 0 : 1;
    let lim;
    if (it.kind === 'bait') lim = STOCK[it.id] ?? 5;
    else if (it.kind === 'bundle') lim = 1;
    else lim = it.base >= 900 ? 1 : it.base >= 300 ? 2 : 4;
    return lim === Infinity ? Infinity : Math.max(0, lim - (sold[it.id] || 0));
  }

  // ------------------------------------------------ talking
  say(text, mood = 'grumpy', dur, delay = 0) {
    this.line = text;
    this.lineT = -delay;
    this.talkT = (dur ?? clamp(text.length * 0.05, 0.9, 3)) + delay;
    this.mood = mood;
    this.moodT = this.talkT + 1.2;
    this.lastLine = this.t;
    if (delay > 0) setTimeout(() => { if (this.line === text) this.game.audio.babble?.(text, VOICE); }, delay * 1000);
    else this.game.audio.babble?.(text, VOICE);
  }

  puffUp() {
    const g = this.game;
    this.puffT = 2.2;
    g.audio.play('puff', { vol: 0.6, pitch: 0.8 });
    g.audio.play('grunt', { vol: 0.4, pitch: 0.7 });
  }

  cough() {
    this.coughT = 1.1;
    this.say(pick(LINES.cough), 'cough', 1.6);
    this.game.audio.play('grunt', { vol: 0.35, pitch: 0.6 });
    this.game.audio.play('bubbles', { vol: 0.35 });
  }

  // ------------------------------------------------ buying
  buy(it) {
    const g = this.game, st = g.state;
    const price = this.price(it);
    if (it.locked) { g.audio.play('ui_error'); this.say(pick(LINES.locked), 'smug'); return false; }
    if (this.stockLeft(it) <= 0) { g.audio.play('ui_error'); this.say(it.kind === 'cosmetic' ? 'Ye already own that one, sprat.' : pick(LINES.soldout), 'grumpy'); return false; }
    if (it.kind === 'cosmetic' && it.price == null) { g.audio.play('ui_error'); this.say('Not for sale. Find it in a crate.', 'smug'); return false; }
    if (st.coins < price) { g.audio.play('ui_error'); this.say(pick(LINES.broke), 'angry'); this.puffUp(); return false; }
    let ok = false;
    const real = it.kind === 'deal' ? it.dealOf : it;
    if (real.kind === 'bait') {
      if (price === real.base) ok = g.buyBait(real.id);
      else if (g.spendCoins(price)) {
        st.baits[real.id] = (st.baits[real.id] || 0) + real.qty;
        g.audio.play('ui_buy');
        g.emit('buy', real.id);
        ok = true;
      }
    } else if (real.kind === 'decor') {
      if (g.spendCoins(price)) {
        if (!g.aquarium?.addDecor?.(real.id)) (st.tank.decor ||= []).push({ id: real.id, x: 0.2 + Math.random() * 0.6, z: 0.5 });
        g.audio.play('ui_buy');
        g.emit('buy', real.id);
        ok = true;
      }
    } else if (real.kind === 'bundle') {
      if (g.spendCoins(price)) {
        let contents = real.contents;
        if (real.id === 'b_mystery') {
          const pool = BAIT_ORDER.filter((b) => g.stats.unlockBait.has(b) && b !== 'relic');
          contents = [];
          for (let i = 0; i < 3; i++) { const b = pick(pool); contents.push([b, BAITS[b].qty]); }
          this.mystery = contents;
        }
        for (const [b, n] of contents) st.baits[b] = (st.baits[b] || 0) + n;
        g.audio.play('ui_buy');
        g.emit('buy', real.id);
        if (real.id === 'b_mystery') g.toast('Mystery box: ' + contents.map(([b, n]) => `${n} ${BAITS[b].name}`).join(', ') + '!', 'bait', 5);
        ok = true;
      }
    } else if (real.kind === 'cosmetic') {
      if (g.spendCoins(price)) {
        if (!CHAR.grantCosmetic?.(st, real.id)) (st.cosmetics ||= {})[real.id] = true;
        this.wear(real);
        g.audio.play('ui_buy');
        g.emit('buy', real.id);
        ok = true;
      }
    }
    if (!ok) { this.say(pick(LINES.broke), 'angry'); this.puffUp(); return false; }
    const sold = this.shopState().stock.sold;
    sold[real.id] = (sold[real.id] || 0) + 1;
    if (it.kind === 'deal') sold.deal = (sold.deal || 0) + 1;
    g.save?.();
    g.audio.play('coin_pile', { vol: 0.5 });
    setTimeout(() => g.audio.play('bell', { vol: 0.25, pitch: 2 }), 180);
    this.say(it.kind === 'deal' || this.special?.id === it.id ? 'A bargain! Ye robbed me! Hah!' : it.kind === 'cosmetic' ? pick(LINES.cosmetic) : pick(LINES.buy), 'happy');
    this.hop = 0.7;
    this.sold = 1;
    this.drawer = 1;
    this.puffT = 0;
    this.pop[it.id] = 0;
    return true;
  }

  // ------------------------------------------------ layout
  layout() {
    const g = this.game;
    const r = { x: 8, y: 6, w: g.screen.W - 16, h: g.screen.H - 12 };
    const S = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 12 };
    const sw = S.w, sh = S.h;
    const split = Math.round(sw * 0.52);
    const floorY = sh - 50;
    const counterTop = sh - 186;
    const L = {
      r, S, sw, sh, split, floorY, counterTop,
      counter: { x: 12, y: counterTop, w: split - 18, h: sh - counterTop },
      bloat: { x: Math.round(split * 0.43), y: counterTop - 76 },
      cab: { x: split + 10, y: 50, w: sw - split - 22, h: floorY - 50 + 10 },
      port: { x: 62, y: 112, r: 42 },
      shelf: { x: Math.round(split * 0.25), y: 64 },
      reg: { x: split - 86, y: counterTop },
      bell: { x: split - 104, y: counterTop - 2 },
      mat: { x: Math.round(split * 0.43) + 134, y: counterTop + 6 },
      deal: { x: 24, y: counterTop - 62, w: 78, h: 60 },
      lamp1: { x: Math.round(split * 0.7), y: 14 },
      lamp2: { x: sw - 30, y: 10 },
    };
    // close-up framing: zoom 2 around the counter, Cap'n Bloat on the left, the mat in the middle
    L.close = { x: clamp(L.bloat.x - 118, 0, sw / 2), y: clamp(counterTop - 200, 0, sh / 2), z: 2 };
    return L;
  }

  // ------------------------------------------------ frame
  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input;
    dt = Math.max(0, Math.min(0.05, dt));
    this.t += dt;
    const t = this.t;
    const L = this.layout();
    this.rect = L.r;
    this.L = L;
    this.pumpBuilds();
    this.updateBloat(dt, t);

    // zoom (shelves <-> counter close-up)
    const zt = this.focus ? 1 : 0;
    this.zoom = zt > this.zoom ? Math.min(1, this.zoom + dt * 2.2) : Math.max(0, this.zoom - dt * 2.6);
    const ez = ease.inOutCubic(this.zoom);
    const Z = lerp(1, L.close.z, ez);
    const ox = lerp(0, L.close.x, ez), oy = lerp(0, L.close.y, ez);
    this.cam = { Z, ox, oy };
    const interactive = this.zoom === 0;

    // scene into its own layer, then onto the screen through the camera
    if (!this.layer || this.layer.width !== L.sw || this.layer.height !== L.sh) {
      this.layer = makeCanvas(L.sw, L.sh);
      this.lctx = ctxOf(this.layer);
    }
    const sc = this.lctx;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    // scene-space pointer
    const sp = { x: (inp.x - L.S.x) / Z + ox, y: (inp.y - L.S.y) / Z + oy, inside: inp.inside };
    this.sp = sp;
    this.drawScene(sc, ui, L, t, dt, sp, interactive);

    // frame + scene
    drawWood(ctx, L.r.x, L.r.y, L.r.w, L.r.h, { tone: 'dark' });
    ctx.save();
    ctx.beginPath(); ctx.rect(L.S.x, L.S.y, L.S.w, L.S.h); ctx.clip();
    if (Z === 1) ctx.drawImage(this.layer, L.S.x, L.S.y);
    else ctx.drawImage(this.layer, ox, oy, L.sw / Z, L.sh / Z, L.S.x, L.S.y, L.sw, L.sh);
    // vignette
    ctx.drawImage(this.vignette(L.sw, L.sh), L.S.x, L.S.y);
    if (this.zoom > 0) this.drawCloseUp(ctx, ui, L, t, dt, ez);
    this.drawSpeech(ctx, L, t, dt);
    ctx.restore();
    // inner frame lip
    ctx.fillStyle = '#120a06';
    ctx.fillRect(L.S.x - 1, L.S.y - 1, L.S.w + 2, 1); ctx.fillRect(L.S.x - 1, L.S.y + L.S.h, L.S.w + 2, 1);
    ctx.fillRect(L.S.x - 1, L.S.y, 1, L.S.h); ctx.fillRect(L.S.x + L.S.w, L.S.y, 1, L.S.h);

    // HUD: coin purse + close
    const st = g.state;
    const ctxt = formatCommas(Math.floor(this.ui?.coinShown ?? st.coins));
    const pw = measureText(ctxt) + 30;
    const px = L.r.x + L.r.w - pw - 34, py = L.r.y + 10;
    drawWood(ctx, px, py, pw, 19, { tone: 'light', nails: false, round: 2, planks: 1 });
    ctx.drawImage(getUiIcon('coin_big'), px + 5, py + 5);
    drawText(ctx, ctxt, px + pw - 7, py + 6, { align: 'right', color: '#fff3dc', shadow: '#2a160a' });
    if (ui.button(ctx, L.r.x + L.r.w - 30, L.r.y + 10, 20, 19, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    // coin flyers (purchase -> register)
    for (const f of this.flyers) {
      f.t += dt;
      if (f.t < 0) continue;
      const k = ease.inOutQuad(clamp01(f.t / f.dur));
      ctx.drawImage(getUiIcon('coin'), Math.round(lerp(f.x0, f.x1, k) - 4), Math.round(lerp(f.y0, f.y1, k) - Math.sin(k * Math.PI) * 30 - 4));
      if (f.t >= f.dur && !f.done) { f.done = true; g.audio.play('coin_bounce', { vol: 0.3, pitch: 1.2 + Math.random() * 0.3 }); }
    }
    this.flyers = this.flyers.filter((f) => f.t < f.dur);

    // keyboard: Esc backs out of the close-up first
    if (this.focus && inp.keyPressed('Escape')) { inp.keysPressed.delete('Escape'); this.unfocus(); }
    if (interactive && !this.focus) {
      if (inp.keyPressed('ArrowRight') || inp.keyPressed('ArrowLeft')) {
        const i = TABS.findIndex((q) => q.id === this.tab);
        this.setTab(TABS[(i + (inp.keyPressed('ArrowRight') ? 1 : TABS.length - 1)) % TABS.length].id);
      }
    }
    // idle chatter
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = 10 + Math.random() * 7;
      if (t - this.lastLine > 6 && !this.puffT) this.say(pick(LINES.idle), pick(['grumpy', 'neutral', 'smug']));
    }
  }

  pumpBuilds() {
    // at most ~8 ms of lazy sprite building per frame
    const t0 = performance.now();
    if (!this.bloatFrame('br', 0)) this.bloatFrame('br', 0, true);
    for (const [k, i] of [['br', 1], ['br', 2], ['pf', 0], ['pf', 1], ['pf', 2]]) {
      if (performance.now() - t0 > 8) break;
      if (!this.frames[k][i]) { this.bloatFrame(k, i, true); break; }
    }
    if (!this.shelfR && performance.now() - t0 < 8) this.shelfR = buildJarShelf(Math.round((this.L.split * 0.62) / 2));
    if (!this.regR && performance.now() - t0 < 8) this.regR = buildRegister();
    // focused bait: rotating voxel frames
    const f = this.focus;
    const bid = f && (f.kind === 'bait' ? f.id : f.kind === 'deal' && f.dealOf.kind === 'bait' ? f.dealOf.id : null);
    if (bid) for (let k = 0; k < BAIT_FRAMES && performance.now() - t0 < 10; k++) if (!baitFrame(bid, k)) baitFrame(bid, k, true);
    this.warmDone = !!this.frames.pf[2];
  }

  vignette(w, h) {
    return memo(`vig|${w}|${h}`, () => {
      const b = new PixelBuffer(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
        const d = Math.max(0, Math.hypot(dx * 0.85, dy) - 0.72);
        const lv = Math.floor(d * 7 + bayer(x, y) * 0.9);
        if (lv > 0) b.set(x, y, pack('#06040a', Math.min(150, lv * 34)));
      }
      return b.toCanvas();
    });
  }

  // ------------------------------------------------ Cap'n Bloat state
  updateBloat(dt, t) {
    this.talkT = Math.max(0, (this.talkT || 0) - dt);
    this.moodT = Math.max(0, this.moodT - dt);
    this.hop = Math.max(0, this.hop - dt);
    this.coughT = Math.max(0, this.coughT - dt);
    this.drawer = Math.max(0, this.drawer - dt * 0.6);
    this.bellSwing = Math.max(0, this.bellSwing - dt);
    this.blinkT -= dt;
    if (this.blinkT < -0.13) this.blinkT = 2.5 + Math.random() * 3;
    // puffed up when broke: hold, then slowly deflate
    if (this.puffT > 0) {
      this.puffT = Math.max(0, this.puffT - dt);
      const target = this.puffT > 1.2 ? 1 : this.puffT / 1.2;
      this.puffAmt = damp(this.puffAmt, target, this.puffT > 1.2 ? 16 : 5, dt);
      if (this.puffT === 0) { this.game.audio.play('deflate', { vol: 0.5, pitch: 0.8 }); this.say('Pfffff... where was I.', 'grumpy', 1.2); }
      if (this.puffT < 1.2 && Math.random() < dt * 14) this.fx.push({ kind: 'bub', x: rnd(-10, 10), y: rnd(-30, 0), vx: rnd(-14, 14), vy: rnd(-30, -12), t: 0, life: 1.4, s: Math.random() < 0.3 ? 2 : 1 });
    } else this.puffAmt = damp(this.puffAmt, 0, 6, dt);
    // cigar drag cycle: inhale (ember brightens) then blow a bubble ring
    this.dragT -= dt;
    if (this.dragT <= 0 && !this.drag && !this.talkT && !this.puffT) { this.drag = 0.001; }
    if (this.drag) {
      this.drag += dt;
      if (this.drag > 1.3 && !this.ringed) { this.ringed = true; this.rings.push({ t: 0 }); this.rings.push({ t: -0.35 }); this.game.audio.play('bubble', { vol: 0.3, pitch: 0.6 }); }
      if (this.drag > 2.6) { this.drag = 0; this.ringed = false; this.dragT = 6 + Math.random() * 6; }
    }
    this.nextCough -= dt;
    if (this.nextCough <= 0) {
      this.nextCough = 22 + Math.random() * 18;
      if (!this.talkT && !this.puffT && this.t - this.lastLine > 4) this.cough();
    }
    // impatient fin drumming when nobody talks for a while
    this.drumT = this.t - this.lastLine > 8 && !this.talkT ? this.drumT + dt : 0;
  }

  // ================================================================ scene
  drawScene(c, ui, L, t, dt, sp, interactive) {
    const g = this.game;
    const { sw, sh, split, floorY } = L;
    // wall + ceiling beam + floor
    c.drawImage(wallTex(sw, floorY + 4), 0, 0);
    drawWood(c, 0, floorY, sw, sh - floorY, { tone: 'dark', nails: false, planks: 3, round: 0 });
    c.fillStyle = rgba('#000000', 0.35);
    c.fillRect(0, floorY, sw, 3);
    drawWood(c, -4, 0, sw + 8, 16, { tone: 'dark', nails: true, planks: 1, round: 0 });
    c.fillStyle = rgba('#000000', 0.4);
    c.fillRect(0, 16, sw, 2);
    // light shafts from the porthole
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = 0.035 + 0.015 * Math.sin(t * 0.7 + i * 2);
      c.fillStyle = rgba('#8ae0f0', a);
      const x0 = L.port.x - 20 + i * 14;
      c.beginPath(); c.moveTo(x0, L.port.y - 10); c.lineTo(x0 + 22, L.port.y - 10); c.lineTo(x0 + 190, sh); c.lineTo(x0 + 120, sh); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    this.drawPorthole(c, L, t);
    this.drawPosters(c, L, t);
    this.drawNets(c, L, t);
    // shelves of glowing jars behind Cap'n Bloat
    if (this.shelfR) {
      const s = this.shelfR;
      const x = L.shelf.x, y = L.shelf.y;
      c.drawImage(s.canvas, x, y);
      if (s.glow) {
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.8 + 0.2 * Math.sin(t * 1.7);
        c.drawImage(s.glow, x, y);
        c.drawImage(s.glow, x, y);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
      }
    }
    this.drawLifeRing(c, L.split - 22, 250);
    this.drawShipBell(c, ui, L, t, sp, interactive);
    // lantern glow pools (behind)
    this.drawLantern(c, L.lamp1.x, L.lamp1.y, 58, t, 0);
    // merch cabinet (right)
    this.drawCabinet(c, ui, L, t, dt, sp, interactive);
    // Cap'n Bloat
    this.drawBloat(c, L, t, dt, sp);
    // counter
    this.drawCounter(c, ui, L, t, dt, sp, interactive);
    this.drawLantern(c, L.lamp2.x, L.lamp2.y, 40, t, 1.3);
    // ambient bubbles
    this.ambient ||= [];
    if (Math.random() < dt * 2.2) this.ambient.push({ x: rnd(10, sw - 10), y: sh - 2, vy: rnd(-26, -14), s: Math.random() < 0.25 ? 2 : 1, ph: rnd(0, TAU), t: 0 });
    for (const b of this.ambient) {
      b.t += dt;
      b.y += b.vy * dt;
      const bx = Math.round(b.x + Math.sin(b.t * 2 + b.ph) * 3);
      c.drawImage(bubbleDot(b.s), bx, Math.round(b.y));
    }
    this.ambient = this.ambient.filter((b) => b.y > 18);
  }

  drawPorthole(c, L, t) {
    const { x, y, r } = L.port;
    c.save();
    c.beginPath(); c.arc(x, y, r - 4, 0, TAU); c.clip();
    for (let yy = y - r; yy < y + r; yy += 2) {
      const k = (yy - (y - r)) / (2 * r);
      c.fillStyle = mix('#5ac8e0', '#0e4a6a', k);
      c.fillRect(x - r, yy, r * 2, 2);
    }
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const x0 = x - r + ((i * 23 + t * 6) % (r * 2 + 20)) - 10;
      c.fillStyle = rgba('#e8fbff', 0.08);
      c.beginPath(); c.moveTo(x0, y - r); c.lineTo(x0 + 6, y - r); c.lineTo(x0 - 14, y + r); c.lineTo(x0 - 20, y + r); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    // a passing fish silhouette
    const ft = (t * 0.12) % 1.6;
    if (ft < 1) {
      const fx = Math.round(x - r - 20 + ft * (2 * r + 40)), fy = Math.round(y + 6 + Math.sin(t * 2) * 3);
      c.fillStyle = '#0a3048';
      c.fillRect(fx - 7, fy - 3, 14, 6); c.fillRect(fx - 5, fy - 4, 10, 8); c.fillRect(fx - 12, fy - 4, 4, 8); c.fillRect(fx - 9, fy - 2, 3, 4);
      c.fillStyle = '#5ac8e0'; c.fillRect(fx + 4, fy - 2, 1, 1);
    }
    // kelp outside
    for (let i = 0; i < 3; i++) {
      for (let yy = 0; yy < 40; yy += 2) {
        c.fillStyle = yy % 6 ? '#1a6a4a' : '#2a8a5a';
        c.fillRect(Math.round(x - 24 + i * 22 + Math.sin(yy * 0.12 + t + i) * 3), y + r - yy, 3, 2);
      }
    }
    // glass glare
    c.fillStyle = rgba('#ffffff', 0.22);
    for (let k = 0; k < 12; k++) c.fillRect(Math.round(x - r * 0.55 + k), Math.round(y - r * 0.5 - k * 0.6), 2, 1);
    c.restore();
    const ring = portholeRing(r);
    c.drawImage(ring, x - ring.width / 2, y - ring.height / 2);
  }

  drawPosters(c, L, t) {
    const { port, split } = L;
    // WANTED poster
    const wx = 26, wy = port.y + port.r + 16;
    c.save();
    drawPaper(c, wx, wy, 64, 80, { aged: true, torn: 'bottom' });
    drawText(c, 'WANTED', wx + 32, wy + 6, { align: 'center', color: '#7a1a1a' });
    const fish = memo('wantedFish', () => {
      const b = new PixelBuffer(40, 22);
      b.fillEllipse(20, 11, 13, 8, pack('#4a3020'));
      b.fillPoly([[4, 3], [10, 11], [4, 19]], pack('#4a3020'));
      b.fillPoly([[16, 3], [24, 0], [26, 4]], pack('#4a3020'));
      b.set(28, 9, pack('#f3e6c8')); b.set(29, 9, pack('#f3e6c8'));
      b.fillPoly([[30, 13], [33, 12], [33, 14]], pack('#f3e6c8'));
      return b.toCanvas();
    });
    c.drawImage(fish, wx + 12, wy + 20);
    drawText(c, 'THE ONE THAT', wx + 32, wy + 46, { align: 'center', font: 'small', color: '#4a3020' });
    drawText(c, 'GOT AWAY', wx + 32, wy + 53, { align: 'center', font: 'small', color: '#4a3020' });
    drawText(c, '500{coin}', wx + 32, wy + 63, { align: 'center', color: '#7a1a1a' });
    c.fillStyle = '#a8203a'; c.fillRect(wx + 30, wy - 1, 4, 3);
    c.restore();
    // "NO CREDIT" board
    const nx = 26, ny = wy + 98;
    if (ny + 30 < L.counterTop - 4) {
      drawWood(c, nx, ny, 70, 28, { tone: 'light', nails: true, planks: 1, round: 1 });
      drawText(c, 'NO CREDIT', nx + 35, ny + 6, { align: 'center', font: 'small', color: '#3a1a0a' });
      drawText(c, 'NO WHINING', nx + 35, ny + 15, { align: 'center', font: 'small', color: '#7a1a1a' });
    }
    // framed photo: young Bloat with a catch
    const px = split - 82, py = 44;
    c.fillStyle = '#2a1608'; c.fillRect(px - 3, py - 3, 46, 40);
    c.fillStyle = '#c8902a'; c.fillRect(px - 2, py - 2, 44, 38);
    c.fillStyle = '#f6d27a'; c.fillRect(px - 2, py - 2, 44, 1);
    c.fillStyle = '#d8c8a0'; c.fillRect(px, py, 40, 34);
    c.fillStyle = '#b8a880'; c.fillRect(px, py + 24, 40, 10);
    c.fillStyle = '#8a7048'; c.fillRect(px + 8, py + 10, 16, 15); c.fillRect(px + 10, py + 8, 12, 19);
    c.fillStyle = '#2a2a3a'; c.fillRect(px + 9, py + 6, 14, 3);
    c.fillStyle = '#6a5a48'; c.fillRect(px + 22, py + 14, 15, 7); c.fillRect(px + 35, py + 12, 3, 11);
    c.fillStyle = '#f6eed8'; c.fillRect(px + 13, py + 13, 2, 2); c.fillRect(px + 18, py + 13, 2, 2);
    drawText(c, "'87", px + 30, py + 27, { font: 'small', color: '#5a4a30' });
    // little shelf with a ship in a bottle under the photo
    void t;
  }

  drawNets(c, L, t) {
    const n = memo(`nets|${L.split}`, () => {
      const w = Math.round(L.split * 0.62), h = 46;
      const b = new PixelBuffer(w, h);
      const rope = pack('#c8a874'), ropeD = pack('#7a6040');
      const sag = (x) => 10 + Math.sin((x / w) * Math.PI) * 22;
      for (let i = -4; i < w / 8 + 4; i++) {
        for (let s of [1, -1]) {
          for (let k = 0; k < 60; k++) {
            const x = i * 8 + k * 0.5 * s, y = k * 0.5;
            const xx = Math.round(x), yy = Math.round(y + sag(x) * (k / 60) * 0.3);
            if (xx < 0 || xx >= w) continue;
            if (yy > sag(xx)) break;
            b.set(xx, yy, rope);
            if (yy + 1 < h) b.set(xx, yy + 1, ropeD);
          }
        }
      }
      for (let x = 0; x < w; x++) { const y = Math.round(sag(x)); b.set(x, y, rope); b.set(x, y + 1, rope); b.set(x, y + 2, ropeD); }
      return b.toCanvas();
    });
    c.drawImage(n, 4, 14);
    // glass floats tangled in the net
    for (const [fx, fy, col] of [[Math.round(L.split * 0.14), 34, '#5ac8a0'], [Math.round(L.split * 0.4), 40, '#4a9ae0'], [Math.round(L.split * 0.56), 30, '#e0a84a']]) {
      c.globalCompositeOperation = 'lighter';
      c.drawImage(glowSprite(12, col, 0.6), fx - 12, fy - 12);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#1a2a2a'; c.beginPath(); c.arc(fx, fy, 6, 0, TAU); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(fx, fy, 5, 0, TAU); c.fill();
      c.fillStyle = shade(col, 0.5); c.fillRect(fx - 3, fy - 3, 2, 2);
      c.fillStyle = '#c8a874'; c.fillRect(fx - 5, fy, 10, 1); c.fillRect(fx, fy - 5, 1, 10);
    }
    void t;
  }

  drawLantern(c, x, y, len, t, ph) {
    const sway = Math.round(Math.sin(t * 1.1 + ph) * 1.5);
    const lx = x + sway, ly = y + len;
    for (let yy = y; yy < ly; yy += 2) { c.fillStyle = (yy >> 1) % 2 ? '#5a4a3a' : '#3a2e24'; c.fillRect(Math.round(x + (sway * (yy - y)) / len), yy, 1, 2); }
    const fl = 0.85 + 0.15 * Math.sin(t * 9 + ph * 3) * Math.sin(t * 5.3 + ph);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.55 * fl;
    c.drawImage(glowSprite(70, '#ffb04a', 0.7), lx - 70, ly + 8 - 70);
    c.globalAlpha = 0.8 * fl;
    c.drawImage(glowSprite(22, '#ffd27a', 1), lx - 22, ly + 8 - 22);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    // body
    c.fillStyle = '#2a1a0e';
    c.fillRect(lx - 7, ly - 1, 14, 4); c.fillRect(lx - 6, ly + 3, 12, 14); c.fillRect(lx - 7, ly + 17, 14, 3);
    c.fillStyle = '#b8782a'; c.fillRect(lx - 6, ly, 12, 2); c.fillRect(lx - 6, ly + 18, 12, 1);
    c.fillStyle = '#f6d27a'; c.fillRect(lx - 6, ly, 12, 1);
    c.fillStyle = '#ffd86a'; c.fillRect(lx - 5, ly + 4, 10, 12);
    c.fillStyle = '#fff4c8'; c.fillRect(lx - 2, ly + 7 + Math.round(Math.sin(t * 11 + ph)), 4, 6);
    c.fillStyle = '#ffffff'; c.fillRect(lx - 1, ly + 9, 2, 3);
    c.fillStyle = '#2a1a0e'; c.fillRect(lx - 1, ly + 3, 1, 14); c.fillRect(lx + 2, ly + 3, 1, 14);
    c.fillStyle = '#7a4a1c'; c.fillRect(lx - 2, ly - 4, 4, 3);
  }

  drawLifeRing(c, x, y) {
    const ring = memo('lifering', () => {
      const R = 19, D = R * 2 + 3, b = new PixelBuffer(D, D);
      for (let yy = 0; yy < D; yy++) for (let xx = 0; xx < D; xx++) {
        const dx = xx + 0.5 - D / 2, dy = yy + 0.5 - D / 2, d = Math.hypot(dx, dy);
        if (d > R || d < R - 9) continue;
        const a = Math.atan2(dy, dx);
        const red = Math.floor(((a + Math.PI) / TAU) * 8) % 2 === 0;
        const l = (-dx - dy) / d * 0.5 + (R - 4.5 - Math.abs(d - (R - 4.5))) / 4.5;
        const base = red ? ['#7a1420', '#c8283a', '#ff5a5a'] : ['#a8a094', '#e8e0d0', '#ffffff'];
        b.set(xx, yy, pack(base[clamp(Math.round(l + 0.4 + (bayer(xx, yy) - 0.5) * 0.6), 0, 2)]));
      }
      b.outline(() => pack('#2a1410'));
      return b.toCanvas();
    });
    // rope wrapped around it + a hook
    c.fillStyle = '#2a1a0e'; c.fillRect(x - 1, y - ring.height / 2 - 6, 3, 6);
    c.drawImage(ring, Math.round(x - ring.width / 2), Math.round(y - ring.height / 2));
    for (const a of [0.6, 2.2, 3.8, 5.4]) {
      const rx = Math.round(x + Math.cos(a) * 14), ry = Math.round(y + Math.sin(a) * 14);
      c.fillStyle = '#d8c08a'; c.fillRect(rx - 1, ry - 2, 3, 5);
      c.fillStyle = '#8a6a3a'; c.fillRect(rx, ry - 2, 1, 5);
    }
    drawText(c, 'S.S. BLOAT', x, y + 22, { align: 'center', font: 'small', color: '#d8c8a8', shadow: '#1a0e06' });
  }

  drawShipBell(c, ui, L, t, sp, interactive) {
    const x = L.port.x + L.port.r + 24, y = 58;
    // bracket
    c.fillStyle = '#2a1a0e'; c.fillRect(x - 12, y - 4, 24, 4); c.fillRect(x - 12, y - 4, 4, 14);
    c.fillStyle = '#7a4a1c'; c.fillRect(x - 11, y - 3, 22, 2); c.fillRect(x - 11, y - 3, 2, 12);
    const sw = this.bellSwing > 0 ? Math.sin(this.bellSwing * 18) * this.bellSwing * 0.45 : 0;
    const bell = memo('shipbell', () => {
      const b = new PixelBuffer(22, 24);
      const B = ['#5a3410', '#8a5418', '#c88a26', '#f0b83c', '#ffe07a', '#fff8c8'].map((q) => pack(q));
      for (let yy = 0; yy < 20; yy++) {
        const hw = 4 + yy * 0.32 + (yy > 15 ? (yy - 15) * 0.9 : 0);
        for (let xx = Math.round(11 - hw); xx <= Math.round(10 + hw); xx++) {
          const u = (xx - (11 - hw)) / (2 * hw);
          const v = 3.6 - u * 3.2 + (yy < 3 ? 0.6 : 0) + (bayer(xx, yy) - 0.5) * 0.7;
          b.set(xx, yy + 2, B[clamp(Math.round(v), 0, 5)]);
        }
      }
      b.rect(9, 0, 4, 3, B[1]);
      b.rect(10, 21, 2, 2, B[0]);
      b.outline(() => pack('#2a1408'));
      return b.toCanvas();
    });
    c.save();
    c.translate(x, y);
    c.rotate(sw);
    c.drawImage(bell, -11, 0);
    // pull rope
    for (let yy = 24; yy < 40; yy += 2) { c.fillStyle = (yy >> 1) % 2 ? '#d8c08a' : '#a88a5a'; c.fillRect(0, yy, 1, 2); }
    c.fillStyle = '#c8a874'; c.fillRect(-1, 40, 3, 4);
    c.restore();
    const r = { x: x - 12, y: y, w: 24, h: 46 };
    if (interactive && sp.x >= r.x && sp.x < r.x + r.w && sp.y >= r.y && sp.y < r.y + r.h) {
      ui.tip = 'Ring the ship\'s bell';
      if (this.game.input.pressed) {
        this.game.input.pressed = false;
        this.bellSwing = 1.2;
        this.game.audio.play('bell', { vol: 0.6, pitch: 0.7 });
        this.say(pick(LINES.bell), 'grumpy');
      }
    }
  }

  // ------------------------------------------------ Cap'n Bloat
  drawBloat(c, L, t, dt, sp) {
    const pa = this.puffAmt;
    let fr;
    if (pa > 0.15) fr = this.bloatFrame('pf', clamp(Math.round(pa * 3) - 1, 0, 2)) || this.bloatFrame('pf', 0) || null;
    if (!fr) {
      const b = (Math.sin(t * 1.6) + 1) / 2;
      const i = this.drag && this.drag < 1.3 ? 2 : Math.round(b * 2);
      fr = this.bloatFrame('br', i) || this.bloatFrame('br', 0);
    }
    if (!fr) return;
    const happy = this.moodT > 0 && this.mood === 'happy';
    const hopY = this.hop > 0 ? -Math.round(Math.abs(Math.sin(this.hop * 13)) * 7 * (this.hop / 0.7)) : 0;
    const coughY = this.coughT > 0 ? Math.round(Math.sin(this.coughT * 30) * 2) : 0;
    // lean a little toward the cursor
    const lean = sp.inside ? Math.round(clamp((sp.x - L.bloat.x) / 120, -1, 1) * 2) : 0;
    const X = L.bloat.x + lean, Y = L.bloat.y + hopY + coughY;
    const ox = X - fr.a.c[0], oy = Y - fr.a.c[1];
    const A = (p) => [p[0] + ox, p[1] + oy];
    this.bloatA = { mouth: A(fr.a.mouth), top: A(fr.a.top), eyeL: A(fr.a.eyeL), eyeR: A(fr.a.eyeR), handL: A(fr.a.handL), handR: A(fr.a.handR), c: [X, Y] };
    // soft shadow on the wall behind him
    c.fillStyle = rgba('#000000', 0.18);
    c.beginPath(); c.ellipse(X + 8, Y + 6, fr.w * 0.36, fr.h * 0.34, 0, 0, TAU); c.fill();
    c.drawImage(fr.canvas, ox, oy);
    if (pa > 0.3) {
      c.globalAlpha = (pa - 0.3) * 0.35;
      c.drawImage(tinted(fr.canvas, '#ff3a2a'), ox, oy);
      c.globalAlpha = 1;
    }
    const mood = this.coughT > 0 ? 'cough' : pa > 0.3 ? 'angry' : this.moodT > 0 ? this.mood : 'grumpy';
    // eyes, brows, spectacles
    const look = sp.inside && !this.focus ? [sp.x, sp.y] : this.focus ? [L.mat.x, L.mat.y - 30] : [X + 40, Y + 20];
    const blink = this.blinkT < 0 && this.blinkT > -0.13;
    for (const [side, e] of [[-1, A(fr.a.eyeL)], [1, A(fr.a.eyeR)]]) this.drawEye(c, e[0], e[1], side, mood, look, blink, pa);
    const eL = A(fr.a.eyeL), eR = A(fr.a.eyeR);
    this.drawSpecs(c, eL, eR, A(fr.a.templeL), A(fr.a.templeR), A(fr.a.chain), t, pa);
    const slope = mood === 'angry' ? 1.25 : mood === 'happy' ? -0.55 : mood === 'surprised' ? -0.8 : mood === 'cough' ? 0.9 : mood === 'smug' ? 0.2 : 0.55;
    const browLift = mood === 'happy' || mood === 'surprised' ? -3 : mood === 'angry' ? 1 : 0;
    const talkBob = this.talkT > 0 ? Math.round(Math.abs(Math.sin(t * 9)) * 1) : 0;
    for (const [side, e] of [[-1, eL], [1, eR]]) {
      const b = browSprite(side, slope);
      const s2 = mood === 'smug' && side > 0 ? -2 : 0;
      c.drawImage(b, Math.round(e[0] - b.width / 2 + side * 3), Math.round(e[1] - 24 + browLift + s2 - talkBob));
    }
    // mouth + cigar
    const m = A(fr.a.mouth);
    this.drawMouth(c, m[0], m[1], mood, t);
    this.drawCigar(c, m[0] + 6, m[1] - 1, t, dt, mood);
    // hands on the counter (drawn later, after the counter top) -> remember
    this.hands = { L: A(fr.a.handL), R: A(fr.a.handR), happy, mood };
    // bubble rings, cough bubbles
    this.drawFx(c, m, dt);
  }

  drawEye(c, x, y, side, mood, look, blink, pa) {
    x = Math.round(x); y = Math.round(y);
    const wide = mood === 'angry' || mood === 'surprised';
    const rx = wide ? 9 : 8, ry = wide ? 8 : 7;
    const ink = '#2a1610';
    if (mood === 'happy' || mood === 'cough') {
      // squeezed: ^ ^ (happy) or > < (cough)
      c.fillStyle = ink;
      for (let i = -5; i <= 5; i++) {
        const yy = mood === 'happy' ? Math.round(-Math.sqrt(Math.max(0, 25 - i * i)) * 0.5) : Math.round(Math.abs(i) * 0.5 * (i * side > 0 ? 1 : -1) * 0.2) ;
        c.fillRect(x + i, y + yy, 1, 2);
      }
      if (mood === 'cough') { c.fillRect(x - 5 * side, y - 2, 3, 1); c.fillRect(x - 5 * side, y + 2, 3, 1); }
      return;
    }
    // sclera
    for (let yy = -ry; yy <= ry; yy++) {
      const hw = Math.round(rx * Math.sqrt(1 - (yy * yy) / (ry * ry + 0.5)));
      c.fillStyle = ink;
      c.fillRect(x - hw - 1, y + yy, hw * 2 + 3, 1);
      c.fillStyle = yy > ry * 0.4 ? '#d8d0bc' : '#f8f4e6';
      c.fillRect(x - hw, y + yy, hw * 2 + 1, 1);
    }
    c.fillStyle = ink;
    c.fillRect(x - rx + 2, y - ry - 1, rx * 2 - 3, 1);
    c.fillRect(x - rx + 2, y + ry + 1, rx * 2 - 3, 1);
    // pupil follows the cursor
    const dx = look[0] - x, dy = look[1] - y, d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 60);
    const px = Math.round(x + (dx / d) * k * (rx - 3)), py = Math.round(y + (dy / d) * k * (ry - 2.5));
    const pr = mood === 'angry' ? 1 : 2;
    const ir = pr + 1;
    c.fillStyle = '#6a4424';
    c.fillRect(px - ir, py - ir, ir * 2 + 1, ir * 2 + 1);
    c.fillStyle = '#9a6a34';
    c.fillRect(px - ir, py + 1, ir * 2 + 1, ir - 1);
    c.fillStyle = '#1a0e0a';
    c.fillRect(px - pr, py - pr, pr * 2 + 1, pr * 2 + 1);
    c.fillStyle = '#ffffff';
    c.fillRect(px - pr, py - pr, 1, 1);
    // heavy old-man eyelid (grumpy droop), blinking
    const lid = blink ? 1 : mood === 'angry' ? 0.05 : mood === 'surprised' ? 0 : mood === 'smug' ? 0.55 : mood === 'neutral' ? 0.3 : 0.45;
    if (lid > 0) {
      const ly = Math.round(y - ry - 1 + (ry * 2 + 2) * lid);
      for (let yy = y - ry - 2; yy <= ly; yy++) {
        const t2 = clamp((yy - y) / (ry + 1), -1, 1);
        const hw = Math.round((rx + 1) * Math.sqrt(1 - t2 * t2 * 0.85));
        c.fillStyle = yy === ly ? '#3a2214' : yy === ly - 1 ? '#9c7a3a' : '#c49e50';
        c.fillRect(x - hw - 1, yy, hw * 2 + 3, 1);
      }
    }
    // bags + crow's feet
    c.fillStyle = '#8a6a32';
    c.fillRect(x - rx + 1, y + ry + 3, rx * 2 - 2, 1);
    c.fillRect(x + side * (rx + 3), y - 1, 2, 1); c.fillRect(x + side * (rx + 3), y + 2, 2, 1); c.fillRect(x + side * (rx + 2), y + 4, 2, 1);
    void pa;
  }

  drawSpecs(c, eL, eR, tL, tR, chain, t, pa) {
    const gold = '#e8b850', dark = '#3a2410';
    const ring = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      const R = 12;
      for (let a = 0; a < TAU; a += 0.06) {
        const px = Math.round(x + Math.cos(a) * R), py = Math.round(y + Math.sin(a) * (R - 0.5));
        c.fillStyle = dark; c.fillRect(px - 1, py, 3, 1); c.fillRect(px, py - 1, 1, 3);
      }
      for (let a = 0; a < TAU; a += 0.06) {
        const px = Math.round(x + Math.cos(a) * R), py = Math.round(y + Math.sin(a) * (R - 0.5));
        c.fillStyle = Math.sin(a) < -0.3 ? '#fff0a0' : gold; c.fillRect(px, py, 1, 1);
      }
      // lens tint + glint
      c.fillStyle = rgba('#d8f4ff', 0.13);
      c.beginPath(); c.arc(x, y, R - 1, 0, TAU); c.fill();
      const gp = (t * 0.25) % 1;
      c.fillStyle = rgba('#ffffff', 0.75);
      for (let i = 0; i < 5; i++) c.fillRect(x - 7 + i, y - 4 - i + (gp < 0.1 ? 1 : 0), 1, 1);
      c.fillRect(x - 8, y - 2, 1, 1); c.fillRect(x + 5, y + 4, 1, 1);
    };
    ring(eL[0], eL[1]);
    ring(eR[0], eR[1]);
    // bridge over the nose + temple arms
    const by = Math.round(Math.min(eL[1], eR[1]) - 3);
    c.fillStyle = dark; c.fillRect(Math.round(eL[0] + 11), by - 1, Math.round(eR[0] - eL[0] - 22), 3);
    c.fillStyle = gold; c.fillRect(Math.round(eL[0] + 11), by, Math.round(eR[0] - eL[0] - 22), 1);
    for (const [e, tt] of [[eL, tL], [eR, tR]]) {
      const sx = e[0] + Math.sign(tt[0] - e[0]) * 12;
      const n = Math.max(1, Math.abs(tt[0] - sx));
      for (let i = 0; i <= n; i++) { c.fillStyle = gold; c.fillRect(Math.round(sx + Math.sign(tt[0] - sx) * i), Math.round(e[1] - 1 + (tt[1] - e[1]) * (i / n)), 1, 1); }
    }
    // spectacle chain draped down to the cardigan
    if (pa < 0.4) {
      const x0 = eL[0] - 12, y0 = eL[1] + 2, x1 = chain[0], y1 = chain[1];
      for (let i = 0; i <= 18; i++) {
        const k = i / 18;
        const x = lerp(x0, x1, k), y = lerp(y0, y1, k) + Math.sin(k * Math.PI) * 9;
        if (i % 2 === 0) { c.fillStyle = i % 4 ? '#c8902a' : '#f6d27a'; c.fillRect(Math.round(x), Math.round(y), 1, 1); }
      }
    }
  }

  drawMouth(c, x, y, mood, t) {
    x = Math.round(x); y = Math.round(y);
    const talk = this.talkT > 0 && this.lineT >= 0 ? Math.abs(Math.sin(t * 11)) * (0.5 + 0.5 * Math.abs(Math.sin(t * 3.7))) : 0;
    const open = mood === 'cough' ? 0.9 : mood === 'angry' ? 0.55 + talk * 0.3 : talk;
    const lip = '#b8604e', ink = '#2a0e0e';
    if (open > 0.15) {
      const h = Math.round(1 + open * 6), w = mood === 'cough' ? 7 : 10;
      c.fillStyle = ink; c.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      c.fillStyle = '#5a1420'; c.fillRect(x - w / 2, y, w, h);
      c.fillStyle = '#d86a6a'; c.fillRect(x - w / 2 + 1, y + h - 2, w - 2, 2);
      if (mood === 'angry') { c.fillStyle = '#f4f0e0'; c.fillRect(x - w / 2, y, w, 1); }
      c.fillStyle = lip; c.fillRect(x - w / 2, y + h + 1, w, 1);
    } else {
      const smile = mood === 'happy' ? -1 : mood === 'smug' ? 0 : 1;
      c.fillStyle = ink;
      c.fillRect(x - 5, y, 10, 1);
      c.fillRect(x - 6, y + smile, 1, 1); c.fillRect(x + 5, y + (mood === 'smug' ? -1 : smile), 1, 1);
      c.fillStyle = lip; c.fillRect(x - 4, y + 1, 8, 2);
      c.fillStyle = '#8a3a2e'; c.fillRect(x - 3, y + 2, 6, 1);
    }
  }

  drawCigar(c, x, y, t, dt, mood) {
    if (mood === 'cough') { x += 2; y += 2; }
    const cg = cigarSprite();
    const cx = Math.round(x), cy = Math.round(y) - 3;
    c.drawImage(cg, cx, cy);
    // ember at the tip
    const tip = [cx + cg.width - 3, cy + Math.round(3 + 21 * 0.32) + 2];
    const inhale = this.drag && this.drag < 1.3 ? this.drag / 1.3 : 0;
    const pulse = 0.55 + 0.2 * Math.sin(t * 5) + inhale * 0.6;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = clamp01(pulse);
    c.drawImage(glowSprite(8, '#ff7a2a', 1), tip[0] - 8, tip[1] - 8);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = inhale > 0.4 ? '#fff0a0' : '#ff8a3a';
    c.fillRect(tip[0], tip[1] - 1, 2, 2);
    // smoke wisps
    if (Math.random() < dt * (6 + inhale * 10)) this.smoke.push({ x: tip[0] + 1, y: tip[1] - 2, vx: rnd(-2, 3), vy: rnd(-16, -10), t: 0, life: rnd(1.8, 2.8), ph: rnd(0, TAU) });
    for (const s of this.smoke) {
      s.t += dt;
      s.x += (s.vx + Math.sin(s.t * 2.4 + s.ph) * 7) * dt;
      s.y += s.vy * dt;
      const a = clamp01(1 - s.t / s.life) * 0.7;
      c.fillStyle = rgba(s.t < 0.6 ? '#e8e4dc' : '#c8d8e0', a);
      const sz = s.t > 1.2 ? 2 : 1;
      c.fillRect(Math.round(s.x), Math.round(s.y), sz, sz);
    }
    this.smoke = this.smoke.filter((s) => s.t < s.life);
  }

  drawFx(c, m, dt) {
    // bubble rings blown after a drag
    for (const r of this.rings) {
      r.t += dt;
      if (r.t < 0) continue;
      const k = r.t / 2.6;
      const R = 3 + k * 16, x = m[0] - 4 - k * 10, y = m[1] - 4 - r.t * 26;
      const a = clamp01(1.2 - k);
      c.globalAlpha = a;
      for (let i = 0; i < 12; i++) {
        const an = (i / 12) * TAU + r.t;
        c.drawImage(bubbleDot(i % 3 === 0 ? 1 : 0), Math.round(x + Math.cos(an) * R), Math.round(y + Math.sin(an) * R * 0.38));
      }
      c.globalAlpha = 1;
    }
    this.rings = this.rings.filter((r) => r.t < 2.6);
    if (this.coughT > 0.5 && Math.random() < dt * 30) this.fx.push({ kind: 'bub', x: rnd(-4, 4), y: 0, vx: rnd(-40, 30), vy: rnd(-50, -15), t: 0, life: 1.2, s: Math.random() < 0.4 ? 2 : 1 });
    for (const f of this.fx) {
      f.t += dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.vx *= Math.exp(-dt * 2); f.vy -= 10 * dt;
      c.globalAlpha = clamp01(1 - f.t / f.life);
      c.drawImage(bubbleDot(f.s), Math.round(m[0] + f.x), Math.round(m[1] + f.y));
    }
    c.globalAlpha = 1;
    this.fx = this.fx.filter((f) => f.t < f.life);
  }

  // ------------------------------------------------ counter
  drawCounter(c, ui, L, t, dt, sp, interactive) {
    const g = this.game, inp = g.input;
    const { counter } = L;
    // counter top (seen slightly from above) + front panels
    const front = memo(`counter|${counter.w}|${counter.h}`, () => {
      const cv = makeCanvas(counter.w + 8, counter.h + 4), k = ctxOf(cv);
      const fh = counter.h - 4;
      drawWood(k, 4, 14, counter.w, fh - 10, { tone: 'dark', nails: false, planks: 1, round: 0, seams: false });
      // raised panels framed by rails and stiles
      const n = Math.max(2, Math.round(counter.w / 120));
      const pw = (counter.w - 12) / n;
      for (let i = 0; i < n; i++) {
        const px = Math.round(10 + i * pw), py = 26, w = Math.round(pw - 12), h = fh - 66;
        k.fillStyle = '#120804'; k.fillRect(px - 1, py - 1, w + 2, h + 2);
        drawWood(k, px, py, w, h, { tone: 'light', inset: true, nails: false, planks: Math.max(2, Math.round(h / 22)) });
        k.fillStyle = rgba('#000000', 0.25); k.fillRect(px, py + h - 4, w, 4);
        k.fillStyle = '#7a4a2a'; k.fillRect(px - 1, py + h + 1, w + 2, 1);
      }
      // carved fish emblem on the middle panel
      const ex = 4 + Math.round(counter.w / 2), ey = 60;
      k.fillStyle = '#4a2814';
      k.beginPath(); k.ellipse(ex + 1, ey + 1, 24, 12, 0, 0, TAU); k.fill();
      k.beginPath(); k.moveTo(ex - 21, ey + 1); k.lineTo(ex - 35, ey - 9); k.lineTo(ex - 35, ey + 11); k.fill();
      k.fillStyle = '#e0a844';
      k.beginPath(); k.ellipse(ex, ey, 24, 12, 0, 0, TAU); k.fill();
      k.beginPath(); k.moveTo(ex - 22, ey); k.lineTo(ex - 36, ey - 10); k.lineTo(ex - 36, ey + 10); k.fill();
      k.fillStyle = '#f6d27a'; k.fillRect(ex - 14, ey - 9, 22, 2);
      k.fillStyle = '#b8782a'; k.fillRect(ex - 10, ey + 6, 26, 2);
      k.fillStyle = '#3e2210'; k.fillRect(ex + 13, ey - 3, 3, 3); k.fillRect(ex - 2, ey - 8, 1, 16); k.fillRect(ex + 20, ey + 2, 3, 1);
      drawText(k, 'EST. 1887', ex, ey + 18, { align: 'center', font: 'small', color: '#f6d27a', shadow: '#2a1408' });
      // brass kick rail
      k.fillStyle = '#3e2210'; k.fillRect(4, fh - 30, counter.w, 7);
      k.fillStyle = '#e0a844'; k.fillRect(4, fh - 29, counter.w, 4);
      k.fillStyle = '#fff2b8'; k.fillRect(4, fh - 29, counter.w, 1);
      k.fillStyle = '#8a5418'; k.fillRect(4, fh - 26, counter.w, 1);
      for (let x = 20; x < counter.w; x += 70) { k.fillStyle = '#3e2210'; k.fillRect(x, fh - 24, 3, 8); k.fillStyle = '#b8782a'; k.fillRect(x + 1, fh - 24, 1, 8); }
      // thick top plank with a bevelled edge
      drawWood(k, 0, 0, counter.w + 8, 16, { tone: 'light', nails: false, planks: 2, round: 1 });
      k.fillStyle = '#f2d098'; k.fillRect(2, 1, counter.w + 4, 1);
      k.fillStyle = '#3a1e14'; k.fillRect(0, 15, counter.w + 8, 1);
      k.fillStyle = rgba('#000000', 0.4); k.fillRect(4, 16, counter.w, 4);
      return cv;
    });
    c.drawImage(front, counter.x - 4, counter.y - 4);
    // Cap'n Bloat's fin hands rest on the counter top
    if (this.hands) {
      const h = this.hands;
      const drum = this.drumT > 0 ? Math.floor(t * 9) % 4 : -1;
      const wave = h.happy && this.hop > 0;
      const fl = finSprite(-1, wave ? 2 : 0), fr = finSprite(1, wave ? 2 : drum === 0 || drum === 2 ? 1 : 0);
      const up = Math.round(this.puffAmt * 6) + (wave ? 3 : 0);
      c.drawImage(fl, Math.round(h.L[0] - fl.width + 7), counter.y - 19 - up);
      c.drawImage(fr, Math.round(h.R[0] - 7), counter.y - 19 - up - (drum === 0 || drum === 2 ? 2 : 0));
    }
    // ashtray shell with a smouldering stub, ledger
    const ax = L.bloat.x - 72, ay = counter.y - 3;
    c.fillStyle = '#5a3a2a'; c.fillRect(ax - 9, ay - 1, 18, 4);
    c.fillStyle = '#f0c8b0'; c.fillRect(ax - 8, ay - 2, 16, 3);
    c.fillStyle = '#d89a8a'; c.fillRect(ax - 8, ay, 16, 1);
    c.fillStyle = '#8a8480'; c.fillRect(ax - 4, ay - 3, 6, 2);
    c.fillStyle = '#6a3e1c'; c.fillRect(ax + 2, ay - 4, 5, 2);
    // ledger book
    const lx = L.bloat.x - 130, ly = counter.y - 7;
    if (lx > L.deal.x + L.deal.w + 2) {
      c.fillStyle = '#2a120a'; c.fillRect(lx - 1, ly - 1, 30, 9);
      c.fillStyle = '#7a2a1a'; c.fillRect(lx, ly, 28, 7);
      c.fillStyle = '#f3e6c8'; c.fillRect(lx + 1, ly + 1, 26, 2);
      c.fillStyle = '#c8b090'; c.fillRect(lx + 1, ly + 3, 26, 1);
      c.fillStyle = '#e0a844'; c.fillRect(lx + 12, ly + 4, 4, 3);
    }
    // deal chalkboard
    this.drawDealBoard(c, ui, L, t, sp, interactive);
    // velvet mat for the close-up
    const mx = L.mat.x, my = counter.y + 1;
    c.fillStyle = '#3a0e1a'; c.fillRect(mx - 30, my - 2, 60, 4);
    c.fillStyle = '#7a1a2e'; c.fillRect(mx - 29, my - 2, 58, 2);
    c.fillStyle = '#e0a844'; c.fillRect(mx - 30, my + 1, 60, 1);
    // service bell
    const bx = L.bell.x, by = L.bell.y;
    c.fillStyle = '#2a1408'; c.fillRect(bx - 8, by - 2, 16, 4);
    c.fillStyle = '#7a4a1c'; c.fillRect(bx - 7, by - 1, 14, 2);
    c.fillStyle = '#2a1408'; c.beginPath(); c.arc(bx, by - 2, 7, Math.PI, TAU); c.fill();
    c.fillStyle = '#e0a844'; c.beginPath(); c.arc(bx, by - 2, 6, Math.PI, TAU); c.fill();
    c.fillStyle = '#fff2b8'; c.fillRect(bx - 4, by - 6, 2, 2);
    c.fillStyle = '#b8782a'; c.fillRect(bx - 1, by - 11, 2, 3);
    const bellR = { x: bx - 9, y: by - 13, w: 18, h: 16 };
    if (interactive && sp.x >= bellR.x && sp.x < bellR.x + bellR.w && sp.y >= bellR.y && sp.y < bellR.y + bellR.h) {
      ui.tip = 'Ring for service';
      if (inp.pressed) { inp.pressed = false; g.audio.play('bell', { vol: 0.5, pitch: 1.3 }); this.say(pick(LINES.bell), 'grumpy'); }
    }
    // cash register (voxel) with a drawer that pops open on a sale
    if (this.regR) {
      const r = this.regR;
      const rx = L.reg.x + 34 - r.ox, ry = counter.y + 3 - r.oy;
      c.drawImage(r.canvas, Math.round(rx), Math.round(ry));
      if (r.glow) { c.globalCompositeOperation = 'lighter'; c.drawImage(r.glow, Math.round(rx), Math.round(ry)); c.globalCompositeOperation = 'source-over'; }
      if (this.drawer > 0) {
        const o = Math.round(ease.outBack(clamp01((1 - this.drawer) * 4)) * 8 * Math.min(1, this.drawer * 3));
        c.fillStyle = '#2a1408'; c.fillRect(L.reg.x + 8, counter.y - 6 + o, 52, 8);
        c.fillStyle = '#8a5418'; c.fillRect(L.reg.x + 9, counter.y - 5 + o, 50, 6);
        c.fillStyle = '#d8a040'; c.fillRect(L.reg.x + 9, counter.y - 5 + o, 50, 1);
        const coin = getUiIcon('coin');
        for (let i = 0; i < 5; i++) c.drawImage(coin, L.reg.x + 12 + i * 9, counter.y - 7 + o);
      }
      if (this.sold > 0) {
        this.sold = Math.max(0, this.sold - dt * 0.8);
        c.globalAlpha = clamp01(this.sold * 3);
        drawText(c, 'KA-CHING!', L.reg.x + 30, ry - 12 - Math.round((1 - this.sold) * 12), { align: 'center', color: '#ffe27a', outline: '#3a1a0a' });
        c.globalAlpha = 1;
      }
    }
    // name plate
    const np = { x: L.bloat.x - 34, y: counter.y + 22 };
    c.fillStyle = '#2a1408'; c.fillRect(np.x - 1, np.y - 1, 70, 12);
    c.fillStyle = '#c8902a'; c.fillRect(np.x, np.y, 68, 10);
    c.fillStyle = '#f6d27a'; c.fillRect(np.x, np.y, 68, 1);
    drawText(c, "CAP'N BLOAT", np.x + 34, np.y + 3, { align: 'center', font: 'small', color: '#3a1a0a' });
    // clutter on the floor in front of the counter
    const fy = L.sh + 2;
    const barrel = getProp('barrel', { scale: 0.8 });
    c.drawImage(barrel.canvas, Math.round(56 - barrel.ox), Math.round(fy + 4 - barrel.oy));
    const chest = getProp('treasure_chest', { scale: 0.55, frame: 1 });
    c.drawImage(chest.canvas, Math.round(L.split - 52 - chest.ox), Math.round(fy - chest.oy));
    if (chest.glow) { c.globalCompositeOperation = 'lighter'; c.drawImage(chest.glow, Math.round(L.split - 52 - chest.ox), Math.round(fy - chest.oy)); c.globalCompositeOperation = 'source-over'; }
    // poke Cap'n Bloat
    const bA = this.bloatA;
    if (interactive && bA && Math.hypot(sp.x - bA.c[0], sp.y - bA.c[1]) < 44 && sp.y < counter.y) {
      ui.tip = "Cap'n Bloat";
      if (inp.pressed) {
        inp.pressed = false;
        if (Math.random() < 0.3) { this.puffUp(); this.say(pick(LINES.poke), 'angry'); } else { this.say(pick(LINES.poke), 'grumpy'); g.audio.play('squeak', { vol: 0.3, pitch: 0.6 }); }
      }
    }
  }

  drawDealBoard(c, ui, L, t, sp, interactive) {
    const d = L.deal;
    const sp0 = this.special;
    // easel legs
    c.fillStyle = '#3a1e10'; c.fillRect(d.x + 8, d.y + d.h - 6, 3, 8); c.fillRect(d.x + d.w - 11, d.y + d.h - 6, 3, 8);
    c.fillStyle = '#6e3c22'; c.fillRect(d.x, d.y, d.w, d.h);
    c.fillStyle = '#1e2a24'; c.fillRect(d.x + 3, d.y + 3, d.w - 6, d.h - 9);
    c.fillStyle = '#2a3a32'; c.fillRect(d.x + 3, d.y + 3, d.w - 6, 1);
    drawText(c, "TODAY'S", d.x + d.w / 2, d.y + 6, { align: 'center', font: 'small', color: '#f4f0e0' });
    drawText(c, 'DEAL', d.x + d.w / 2, d.y + 13, { align: 'center', font: 'small', color: '#ffd84a' });
    if (!sp0) return;
    const it = this.items(sp0.tab).find((q) => q.id === sp0.id);
    if (!it) return;
    const bob = Math.round(Math.sin(t * 3));
    if (it.kind === 'bait') {
      const s = baitSprite(it.id, t);
      c.drawImage(s, Math.round(d.x + d.w / 2 - s.width), d.y + 22 + bob, s.width * 2, s.height * 2);
    } else {
      const s = this.decorSprite(it, 30, 18);
      if (s) c.drawImage(s.canvas, Math.round(d.x + d.w / 2 - s.ox), Math.round(d.y + 40 - s.oy) + bob);
    }
    drawText(c, '-20%', d.x + d.w / 2, d.y + d.h - 15, { align: 'center', font: 'small', color: '#ff8a8a' });
    // chalk smudges
    c.fillStyle = rgba('#ffffff', 0.08);
    c.fillRect(d.x + 8, d.y + 30, 14, 1); c.fillRect(d.x + d.w - 20, d.y + 36, 10, 1);
    const r = { x: d.x, y: d.y, w: d.w, h: d.h };
    if (interactive && sp.x >= r.x && sp.x < r.x + r.w && sp.y >= r.y && sp.y < r.y + r.h) {
      ui.tip = `Today's deal: ${it.name} -20%`;
      if (this.game.input.pressed) {
        this.game.input.pressed = false;
        this.setTab('specials', true);
        const deal = this.items('specials').find((q) => q.kind === 'deal');
        if (deal) this.select(deal);
      }
    }
  }

  // ------------------------------------------------ merch cabinet
  setTab(id, quiet) {
    if (this.tab === id) return;
    this.tab = id;
    this.page = 0;
    this.tabAnim = 0;
    this.game.audio.play('ui_tab');
    if (!quiet && this.t - this.lastLine > 1.5) {
      const l = { bait: 'Bait! The good stuff.', decor: 'Make yer tank a home.', cosmetics: 'Dress up, sprat. Look sharp.', specials: "Specials. Don't tell the missus." }[id];
      if (l) this.say(l, 'neutral');
    }
  }

  drawDrawers(c, x, y, w, h, sp, interactive) {
    const labels = ['HOOKS', 'SINKERS', 'LINES', 'MISC', 'DO NOT OPEN', 'FLOATS'];
    const n = w > 300 ? 3 : 2, rowsN = h > 90 ? 2 : 1;
    const dw = Math.floor((w - (n - 1) * 4) / n), dh = Math.floor((h - (rowsN - 1) * 4) / rowsN);
    for (let r = 0; r < rowsN; r++) for (let i = 0; i < n; i++) {
      const dx = x + i * (dw + 4), dy = y + r * (dh + 4);
      const k = r * n + i;
      const hov = interactive && sp.x >= dx && sp.x < dx + dw && sp.y >= dy && sp.y < dy + dh;
      const open = this.drawerOpen === k ? Math.min(1, (this.t - this.drawerOpenT) * 6) * (this.t - this.drawerOpenT < 1.2 ? 1 : Math.max(0, 1 - (this.t - this.drawerOpenT - 1.2) * 4)) : 0;
      const o = Math.round(open * 4);
      c.fillStyle = '#120804'; c.fillRect(dx - 1, dy - 1, dw + 2, dh + 2);
      if (o) { c.fillStyle = '#05030a'; c.fillRect(dx, dy, dw, dh); }
      c.drawImage(this.cabinetTex(dw, dh), dx, dy + o);
      // label card + brass pull
      const lw = Math.min(dw - 20, measureText(labels[k % labels.length], 'small') + 10);
      c.fillStyle = '#2a1408'; c.fillRect(Math.round(dx + dw / 2 - lw / 2) - 1, dy + o + 5, lw + 2, 11);
      c.fillStyle = '#f3e6c8'; c.fillRect(Math.round(dx + dw / 2 - lw / 2), dy + o + 6, lw, 9);
      drawText(c, labels[k % labels.length], dx + dw / 2, dy + o + 8, { align: 'center', font: 'small', color: '#5a3a1a' });
      const py = dy + o + Math.min(dh - 8, 24);
      c.fillStyle = '#3e2210'; c.fillRect(Math.round(dx + dw / 2 - 9), py, 18, 5);
      c.fillStyle = hov ? '#ffe07a' : '#e0a844'; c.fillRect(Math.round(dx + dw / 2 - 8), py + 1, 16, 2);
      c.fillStyle = '#fff2b8'; c.fillRect(Math.round(dx + dw / 2 - 8), py + 1, 16, 1);
      if (hov) {
        this.ui.tip = labels[k % labels.length] === 'DO NOT OPEN' ? 'Do NOT open.' : 'Just odds and ends';
        if (this.game.input.pressed) {
          this.game.input.pressed = false;
          this.drawerOpen = k; this.drawerOpenT = this.t;
          this.game.audio.play('box_open', { vol: 0.4, pitch: 1.3 });
          if (labels[k % labels.length] === 'DO NOT OPEN') { this.say('OI! What did the label say?!', 'angry'); this.puffUp(); } else if (this.t - this.lastLine > 2) this.say('Nothin\' in there for you, sprat.', 'grumpy');
        }
      }
    }
  }

  cabinetTex(w, h) {
    return memo(`cab|${w}|${h}`, () => {
      const cv = makeCanvas(w, h), k = ctxOf(cv);
      drawWood(k, 0, 0, w, h, { tone: 'light', nails: true, planks: Math.round(h / 30) });
      k.globalCompositeOperation = 'color';
      k.fillStyle = rgba('#3a9a8e', 0.75);
      k.fillRect(0, 0, w, h);
      k.globalCompositeOperation = 'source-atop';
      k.fillStyle = rgba('#0a3a3a', 0.18);
      k.fillRect(0, 0, w, h);
      // chipped paint: bare wood showing through near the edges
      k.globalCompositeOperation = 'source-atop';
      const rng = new RNG(77);
      for (let i = 0; i < 60; i++) {
        const edge = rng.int(0, 3);
        const x = edge === 0 ? rng.int(0, 6) : edge === 1 ? w - rng.int(1, 7) : rng.int(0, w);
        const y = edge === 2 ? rng.int(0, 6) : edge === 3 ? h - rng.int(1, 7) : rng.int(0, h);
        k.fillStyle = rng.chance(0.5) ? '#9a5e34' : '#c08550';
        k.fillRect(x, y, rng.int(1, 4), rng.int(1, 2));
      }
      k.globalCompositeOperation = 'source-over';
      return cv;
    });
  }

  grid(tab) {
    return tab === 'bait' ? { cols: 5, rows: 2 } : tab === 'specials' ? { cols: 3, rows: 2 } : { cols: 5, rows: 3 };
  }

  drawCabinet(c, ui, L, t, dt, sp, interactive) {
    const g = this.game, inp = g.input;
    const cab = L.cab;
    this.tabAnim = Math.min(1, this.tabAnim + dt * 4);
    // tabs along the top
    let tx = cab.x + 6;
    const tw = Math.floor((cab.w - 12) / TABS.length) - 2;
    for (const tb of TABS) {
      const tr = { x: tx, y: cab.y - 20, w: tw, h: 22 };
      const hov = interactive && this.tab !== tb.id && sp.x >= tr.x && sp.x < tr.x + tr.w && sp.y >= tr.y && sp.y < tr.y + tr.h;
      drawTab(c, tr.x, tr.y, tr.w, tr.h, { label: tb.label, icon: tb.icon, active: this.tab === tb.id, hover: hov, color: tb.color });
      if (hov && inp.pressed) { inp.pressed = false; this.setTab(tb.id); }
      tx += tw + 2;
    }
    // cabinet body: sea-green painted wood, worn at the edges
    c.drawImage(this.cabinetTex(cab.w, cab.h), cab.x, cab.y);
    const head = { x: cab.x + 7, y: cab.y + 7, w: cab.w - 14, h: 26 };
    const inner = { x: cab.x + 7, y: cab.y + 36, w: cab.w - 14, h: cab.h - 47 };
    drawWood(c, inner.x, inner.y, inner.w, inner.h, { tone: 'dark', inset: true, nails: false, planks: Math.round(inner.h / 22) });
    // brass plaque with the department name
    const title = { bait: 'FINE BAITS & LURES', decor: 'AQUARIUM DECOR', cosmetics: 'FISHER FASHION', specials: "THE CAP'N'S SPECIALS" }[this.tab];
    const pw2 = measureText(title) + 34, px2 = Math.round(head.x + head.w / 2 - pw2 / 2);
    c.fillStyle = '#2a1408'; c.fillRect(px2 - 1, head.y + 3, pw2 + 2, 20);
    c.fillStyle = '#c8902a'; c.fillRect(px2, head.y + 4, pw2, 18);
    c.fillStyle = '#f6d27a'; c.fillRect(px2, head.y + 4, pw2, 1); c.fillRect(px2, head.y + 4, 1, 18);
    c.fillStyle = '#7a4a1c'; c.fillRect(px2, head.y + 21, pw2, 1);
    for (const sx of [px2 + 4, px2 + pw2 - 6]) { c.fillStyle = '#fff2b8'; c.fillRect(sx, head.y + 12, 2, 2); c.fillStyle = '#5a3410'; c.fillRect(sx + 1, head.y + 13, 1, 1); }
    drawText(c, title, head.x + head.w / 2, head.y + 10, { align: 'center', color: '#3a1a08', shadow: '#f6d27a' });
    // feet
    c.fillStyle = '#2a1408'; c.fillRect(cab.x + 6, cab.y + cab.h, 10, 4); c.fillRect(cab.x + cab.w - 16, cab.y + cab.h, 10, 4);

    const items = this.items();
    const { cols, rows } = this.grid(this.tab);
    const per = cols * rows;
    const pages = Math.max(1, Math.ceil(items.length / per));
    this.page = clamp(this.page, 0, pages - 1);
    if (interactive && inp.wheel && sp.x >= cab.x && sp.x < cab.x + cab.w && sp.y >= cab.y && sp.y < cab.y + cab.h && pages > 1) {
      const np = clamp(this.page + Math.sign(inp.wheel), 0, pages - 1);
      if (np !== this.page) { this.page = np; this.tabAnim = 0.4; g.audio.play('ui_page'); }
    }
    const pagerH = pages > 1 ? 14 : 0;
    const ix = inner.x + 4, iw = inner.w - 8, iy = inner.y + 4;
    const rh = Math.min(Math.floor((inner.h - 8 - pagerH) / rows), 136);
    const ih = rh * rows;
    const cw = Math.floor(iw / cols);
    // drawers fill whatever the shelves leave free
    const dTop = iy + ih + pagerH + 6, dH = inner.y + inner.h - dTop - 4;
    if (dH > 30) this.drawDrawers(c, inner.x + 4, dTop, inner.w - 8, dH, sp, interactive);
    let hov = null;
    const slide = (1 - ease.outCubic(this.tabAnim)) * 14;
    if (!items.length) {
      drawText(c, 'New shipment arrivin\' soon!', inner.x + inner.w / 2, inner.y + inner.h / 2 - 4, { align: 'center', color: '#f4d8a8', shadow: '#1a0e06' });
      drawText(c, '(the tailor is still knitting)', inner.x + inner.w / 2, inner.y + inner.h / 2 + 8, { align: 'center', font: 'small', color: '#a8886a' });
    }
    for (let rI = 0; rI < rows; rI++) {
      const shelfY = iy + (rI + 1) * rh - 20;
      drawWood(c, ix - 3, shelfY, iw + 6, 7, { tone: 'light', nails: false, planks: 1, seams: false, round: 0 });
      c.fillStyle = rgba('#000000', 0.38);
      c.fillRect(ix - 3, shelfY + 7, iw + 6, 3);
      for (let cI = 0; cI < cols; cI++) {
        const i = this.page * per + rI * cols + cI;
        const it = items[i];
        if (!it) continue;
        const cx = Math.round(ix + cI * cw + cw / 2);
        const cell = { x: ix + cI * cw + 2, y: shelfY - rh + 22, w: cw - 4, h: rh - 4 };
        const isHov = interactive && sp.x >= cell.x && sp.x < cell.x + cell.w && sp.y >= cell.y && sp.y < cell.y + cell.h;
        if (isHov) hov = it;
        c.globalAlpha = clamp01(this.tabAnim * 1.5 - (rI * cols + cI) * 0.05);
        this.drawItem(c, it, cx, shelfY + Math.round(slide * (1 + cI * 0.2)), cell, isHov, t, dt);
        c.globalAlpha = 1;
        if (isHov && inp.pressed) { inp.pressed = false; this.select(it, cx, shelfY - 20); }
      }
    }
    if (pages > 1) {
      const py = iy + ih + 1;
      drawText(c, `SHELF ${this.page + 1} OF ${pages}`, inner.x + inner.w / 2, py + 3, { align: 'center', font: 'small', color: '#f4d8a8' });
      for (const [dir, ax, icon] of [[-1, inner.x + inner.w / 2 - 60, 'arrow_l'], [1, inner.x + inner.w / 2 + 50, 'arrow_r']]) {
        const ar = { x: ax - 3, y: py - 3, w: 16, h: 14 };
        const can = dir < 0 ? this.page > 0 : this.page < pages - 1;
        const h = interactive && can && sp.x >= ar.x && sp.x < ar.x + ar.w && sp.y >= ar.y && sp.y < ar.y + ar.h;
        c.globalAlpha = can ? (h ? 1 : 0.8) : 0.25;
        c.drawImage(getUiIcon(icon), ax, py - (h ? 1 : 0));
        c.globalAlpha = 1;
        if (h) ui.tip = dir < 0 ? 'Previous shelf' : 'Next shelf';
        if (h && inp.pressed) { inp.pressed = false; this.page += dir; this.tabAnim = 0.4; g.audio.play('ui_page'); }
      }
    }
    // hover chatter
    const hid = hov?.id || null;
    if (hid !== this.hoverId) { this.hoverId = hid; this.hoverT = 0; this.quipped = false; if (hov) g.audio.play('ui_hover', { vol: 0.25 }); }
    this.hoverT += dt;
    if (hov && !this.quipped && this.hoverT > 0.6 && this.t - this.lastLine > 2.5) {
      this.quipped = true;
      this.say(this.quip(hov), hov.locked ? 'smug' : 'neutral');
    }
    if (hov) ui.tip = hov.locked ? `${hov.name} (locked)` : `${hov.name} - ${formatCommas(this.price(hov))} coins`;
  }

  quip(it) {
    if (it.locked) return `Grow '${it.skill?.name || 'a skill'}' first, greenhorn.`;
    if (it.kind === 'bait') return BAIT_QUIP[it.id] || 'Fine bait, this.';
    if (it.kind === 'deal') return pick(LINES.special);
    if (it.kind === 'bundle') return it.id === 'b_mystery' ? "What's inside? Even I forget." : 'Bundle up and save, sprat.';
    if (it.kind === 'cosmetic') return pick(LINES.cosmetic);
    if (this.price(it) >= 500) return pick(LINES.fancy);
    return pick(LINES.decor).replace('{n}', it.name);
  }

  select(it, x, y) {
    const g = this.game;
    this.focus = it;
    this.focusT = 0;
    this.buyFlash = 0;
    g.audio.play('ui_click', { vol: 0.7 });
    g.audio.play('travel_whoosh', { vol: 0.18, pitch: 1.6 });
    this.pop[it.id] = 0;
    this.quipFor = this.quip(it);
    if (this.t - this.lastLine > 0.8) this.say(it.kind === 'bait' || it.locked ? this.quipFor : pick(LINES.closeup), it.locked ? 'smug' : 'neutral', undefined, 0.35);
    void x; void y;
  }

  unfocus() {
    this.focus = null;
    this.game.audio.play('ui_close', { vol: 0.5 });
  }

  decorSprite(it, maxW, maxH) {
    const key = `${it.id}|${maxW}|${maxH}`;
    let d = this.decorSpr[key];
    if (d) return d;
    if (this.builtFrame === this.t) return null;
    this.builtFrame = this.t;
    let s = DECOR_SCALE[it.size] || 0.4;
    let p = getProp(it.id, { scale: s });
    const k = Math.min(maxW / p.w, maxH / p.h);
    if (k < 1 || k > 1.6) { s = clamp(Math.floor(s * k * 20) / 20, 0.12, 2); p = getProp(it.id, { scale: s }); }
    d = this.decorSpr[key] = { canvas: p.canvas, glow: p.glow, w: p.w, h: p.h, ox: p.ox, oy: p.oy };
    return d;
  }

  cosmeticSprite(it, w, h, scale = 1) {
    const key = `${it.id}|${w}|${h}|${scale}`;
    let d = this.cosSpr[key];
    if (d) return d;
    if (this.builtFrame === this.t) return null;
    this.builtFrame = this.t;
    const cv = makeCanvas(w, h), k = ctxOf(cv);
    if (it.swatch) {
      k.fillStyle = '#2a1408'; k.fillRect(w / 2 - 10, h - 26, 20, 20);
      k.fillStyle = it.swatch; k.fillRect(w / 2 - 9, h - 25, 18, 18);
      k.fillStyle = rgba('#ffffff', 0.4); k.fillRect(w / 2 - 8, h - 24, 6, 2);
    } else {
      const look = CHAR.equipItem ? CHAR.equipItem(this.game.state.character, it.item) : { ...(CHAR.DEFAULT_CHARACTER || {}), ...(this.game.state.character || {}), [it.slot]: it.value };
      try { CHAR.drawCharacter(k, Math.round(w / 2), h - 2, { pose: 'idle', t: 0, facing: 1, scale, look }); } catch { /* the character module may still be landing */ }
    }
    d = this.cosSpr[key] = cv;
    return d;
  }

  drawItem(c, it, cx, shelfY, cell, hov, t, dt) {
    const sel = this.focus?.id === it.id;
    const special = it.kind === 'deal' || this.special?.id === it.id;
    let pop = 0;
    if (this.pop[it.id] !== undefined) {
      this.pop[it.id] += dt;
      pop = Math.sin(clamp01(this.pop[it.id] / 0.35) * Math.PI) * 4;
      if (this.pop[it.id] > 0.35) delete this.pop[it.id];
    }
    const lift = Math.round((hov ? 3 + Math.sin(t * 8) * 0.8 : 0) + pop + (sel ? 2 : 0));
    if (hov) {
      c.globalCompositeOperation = 'lighter';
      c.drawImage(glowSprite(30, '#ffe0a0', 0.5), cx - 30, shelfY - 52);
      c.globalCompositeOperation = 'source-over';
    }
    const soldOut = !it.locked && this.stockLeft(it) <= 0 && it.kind !== 'cosmetic';
    const real = it.kind === 'deal' ? it.dealOf : it;
    if (real.kind === 'bait') this.drawJar(c, real, cx, shelfY, lift, t, it.locked, hov);
    else if (real.kind === 'decor') {
      const d = this.decorSprite(real, cell.w - 8, cell.h - 30);
      if (d) {
        c.fillStyle = rgba('#000000', 0.3);
        c.fillRect(Math.round(cx - d.w / 3), shelfY - 1, Math.round(d.w * 0.66), 2);
        c.drawImage(d.canvas, Math.round(cx - d.ox), Math.round(shelfY + 1 - d.oy - lift));
        if (d.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.6; c.drawImage(d.glow, Math.round(cx - d.ox), Math.round(shelfY + 1 - d.oy - lift)); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
      } else this.unpacking(c, cx, shelfY - 16, t);
    } else if (real.kind === 'cosmetic') {
      // a little display stand with a rarity-coloured cushion
      const rc = RARITY[real.rarity]?.color || '#c9d4dc';
      c.fillStyle = '#2a1408'; c.fillRect(cx - 13, shelfY - 4, 26, 4);
      c.fillStyle = shade(rc, -0.35); c.fillRect(cx - 12, shelfY - 4, 24, 3);
      c.fillStyle = rc; c.fillRect(cx - 12, shelfY - 4, 24, 1);
      if (real.swatch) {
        c.fillStyle = '#2a1408'; c.fillRect(cx - 11, shelfY - 28 - lift, 22, 22);
        c.fillStyle = real.swatch; c.fillRect(cx - 10, shelfY - 27 - lift, 20, 20);
        c.fillStyle = rgba('#ffffff', 0.45); c.fillRect(cx - 9, shelfY - 26 - lift, 7, 2);
        drawText(c, 'PAINT', cx, shelfY - 19 - lift, { align: 'center', font: 'small', color: '#ffffff', outline: '#1a0e06' });
      } else {
        let pv = null;
        try { pv = CHAR.itemPreview?.(this.game.state.character, real.item, 1); } catch { pv = null; }
        if (pv) {
          if (it.locked) { c.globalAlpha = 0.45; c.drawImage(tinted(pv.canvas, '#1a2030'), Math.round(cx - pv.ox), Math.round(shelfY - 4 - pv.oy - lift)); c.globalAlpha = 1; } else CHAR.drawItemPreview(c, pv, cx, shelfY - 4 - lift, t, 'shop:' + real.id);
        } else {
          const d = this.cosmeticSprite(real, 48, Math.min(64, cell.h - 24));
          if (d) c.drawImage(d, Math.round(cx - d.width / 2), shelfY - 4 - d.height - lift);
          else this.unpacking(c, cx, shelfY - 16, t);
        }
      }
      if (it.locked) { const lk = getUiIcon('lock'); c.drawImage(lk, Math.round(cx - lk.width / 2), shelfY - 22 - lift); }
    } else if (real.kind === 'bundle') this.drawCrate(c, real, cx, shelfY, lift, t, hov);
    if (it.kind === 'deal') drawStamp(c, cx + 18, shelfY - 40 - lift, '-20%', { color: '#e8283a', angle: 0.25, font: 'small' });
    if (soldOut) drawStamp(c, cx, shelfY - 22, 'SOLD OUT', { color: '#c8283a', angle: -0.2, font: 'small' });
    // price tag hanging under the shelf
    const price = this.price(it);
    const label = it.locked ? (it.kind === 'cosmetic' && it.unlock === 'package' ? 'CRATES' : 'LOCKED') : it.kind === 'cosmetic' && this.owned(it) ? (this.wearing(it) ? 'WEARING' : 'OWNED') : price === 0 ? 'FREE' : formatCommas(price);
    const showCoin = !it.locked && !(it.kind === 'cosmetic' && this.owned(it)) && price > 0;
    const tw = measureText(label, 'small') + (showCoin ? 15 : 8);
    const tx = Math.round(cx - tw / 2), ty = shelfY + 10;
    c.fillStyle = '#d8c8a0';
    c.fillRect(cx, shelfY + 7, 1, 3);
    const tagCol = special ? '#e8505a' : it.locked ? '#8a8078' : it.kind === 'cosmetic' && this.owned(it) ? '#9ad8a8' : '#f4e6c4';
    c.fillStyle = '#2a1a10';
    c.fillRect(tx - 1, ty - 1, tw + 2, 11);
    c.fillStyle = tagCol;
    c.fillRect(tx, ty, tw, 9);
    c.fillStyle = shade(tagCol, 0.4);
    c.fillRect(tx, ty, tw, 1);
    drawText(c, label, tx + 4, ty + 3, { font: 'small', color: special ? '#ffffff' : it.locked ? '#3a3430' : '#3a2414' });
    if (showCoin) c.drawImage(getUiIcon('coin'), tx + tw - 10, ty);
    if (special && it.kind !== 'deal') drawStamp(c, cx + cell.w / 2 - 14, shelfY - cell.h + 40, 'SALE', { color: '#e8283a', angle: 0.25, font: 'small' });
  }

  unpacking(c, x, y, t) {
    c.drawImage(bubbleDot(2), Math.round(x - 3), Math.round(y + Math.sin(t * 4 + x) * 2));
  }

  drawJar(c, it, cx, shelfY, lift, t, locked, hov) {
    const s = baitSprite(it.id, t + cx * 0.01);
    const k = 6, w = s.width * k, h = s.height * k;
    const jw = Math.max(60, w + 16), jh = Math.max(74, h + 30);
    const jx = Math.round(cx - jw / 2), jy = Math.round(shelfY - jh - lift);
    const glow = !locked && JAR_GLOW[it.id];
    if (glow) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.5 + 0.2 * Math.sin(t * 2 + cx) + (hov ? 0.2 : 0);
      c.drawImage(glowSprite(44, glow, 0.8), cx - 44, jy + jh / 2 - 44);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    c.fillStyle = rgba('#000000', 0.35);
    c.fillRect(jx + 3, shelfY - 1, jw - 6, 2);
    // glass back
    c.fillStyle = '#0a1c24';
    c.fillRect(jx, jy + 6, jw, jh - 6);
    c.fillRect(jx + 1, jy + 5, jw - 2, 1);
    c.fillStyle = locked ? '#5a6474' : '#1e4a58';
    c.fillRect(jx + 1, jy + 7, jw - 2, jh - 8);
    c.fillStyle = locked ? '#6a7484' : '#2a6274';
    c.fillRect(jx + 1, jy + 7, jw - 2, Math.round((jh - 8) * 0.45));
    if (glow) { c.fillStyle = rgba(glow, 0.22); c.fillRect(jx + 2, jy + jh - 18, jw - 4, 16); }
    // contents
    const x = Math.round(cx - w / 2), y = Math.round(jy + 8 + (jh - 10 - h) / 2 + (locked ? 0 : Math.sin(t * 2 + cx) * 1.2));
    if (locked) { c.globalAlpha = 0.5; c.drawImage(tinted(s, '#2a3040'), x, y, w, h); c.globalAlpha = 1; } else c.drawImage(s, x, y, w, h);
    // glass front: highlights, rim
    c.fillStyle = rgba('#ffffff', 0.5);
    c.fillRect(jx + 3, jy + 9, 2, jh - 14);
    c.fillRect(jx + 6, jy + 9, 1, 5);
    c.fillStyle = rgba('#ffffff', 0.22);
    c.fillRect(jx + jw - 5, jy + 10, 1, jh - 16);
    c.fillStyle = rgba('#bfefff', 0.35);
    c.fillRect(jx + 1, jy + jh - 2, jw - 2, 1);
    if (locked) {
      c.fillStyle = rgba('#d8e0ea', 0.42);
      for (let i = 0; i < jw + jh; i += 5) for (let q = 0; q < 5; q++) { const px = jx + 1 + i - q, py = jy + 8 + q * 2; if (px > jx && px < jx + jw - 1) c.fillRect(px, py, 1, 1); }
    }
    // lid with a twine wrap + paper label
    c.fillStyle = '#2a1408'; c.fillRect(jx + 1, jy - 1, jw - 2, 8);
    c.fillStyle = locked ? '#5a5a62' : '#b8782a'; c.fillRect(jx + 2, jy, jw - 4, 6);
    c.fillStyle = locked ? '#8a8a92' : '#f6d27a'; c.fillRect(jx + 2, jy, jw - 4, 1);
    c.fillStyle = locked ? '#3a3a40' : '#7a4a1c'; c.fillRect(jx + 2, jy + 5, jw - 4, 1);
    c.fillStyle = '#d8c08a'; c.fillRect(jx + 2, jy + 7, jw - 4, 1);
    if (locked) {
      const lk = getUiIcon('lock');
      c.drawImage(lk, Math.round(cx - lk.width / 2), jy + jh / 2 - 4);
    } else drawText(c, `x${it.qty}`, jx + jw - 3, jy + jh - 10, { font: 'small', align: 'right', color: '#ffffff', outline: '#1a0e06' });
    const n = this.owned(it);
    if (n && !locked) drawText(c, `${n}`, jx + 4, jy + jh - 10, { font: 'small', color: '#9affc8', outline: '#1a0e06' });
  }

  drawCrate(c, it, cx, shelfY, lift, t, hov) {
    const w = 64, h = 46;
    const x = Math.round(cx - w / 2), y = Math.round(shelfY - h - lift);
    c.fillStyle = rgba('#000000', 0.35); c.fillRect(x + 3, shelfY - 1, w - 6, 2);
    if (it.icon === 'sack') {
      c.fillStyle = '#3a2410'; c.beginPath(); c.ellipse(cx, y + h * 0.6, w * 0.42, h * 0.42, 0, 0, TAU); c.fill();
      c.fillStyle = '#c8a46a'; c.beginPath(); c.ellipse(cx, y + h * 0.6, w * 0.4, h * 0.4, 0, 0, TAU); c.fill();
      c.fillStyle = '#e0c08a'; c.fillRect(cx - 18, y + 16, 10, 3);
      c.fillStyle = '#8a6a3a'; c.fillRect(cx - 8, y + 4, 16, 6);
      drawText(c, 'BREAD', cx, y + 24, { align: 'center', font: 'small', color: '#5a3a1a' });
      const s = baitSprite('bread', 0);
      c.drawImage(s, cx - 6, y + 2, s.width * 2, s.height * 2);
    } else if (it.icon === 'mystery') {
      drawWood(c, x + 4, y + 10, w - 8, h - 10, { tone: 'light', nails: true, planks: 2, round: 1 });
      c.fillStyle = '#3a6a8a'; c.fillRect(x + 4, y + 8, w - 8, 8);
      c.fillStyle = '#5a9ac8'; c.fillRect(x + 4, y + 8, w - 8, 2);
      c.fillStyle = '#e0a844'; c.fillRect(cx - 4, y + 14, 8, 5);
      const q = Math.round(Math.sin(t * 4) * 1.5);
      drawText(c, '?', cx, y + 22 + q, { align: 'center', scale: 2, color: '#ffe27a', outline: '#3a1a0a' });
      if (Math.sin(t * 3 + cx) > 0.9) { c.fillStyle = '#ffffff'; c.fillRect(x + 10, y + 6, 1, 3); c.fillRect(x + 9, y + 7, 3, 1); }
    } else if (it.icon === 'chest') {
      const p = getProp('treasure_chest', { scale: 0.42, frame: hov ? 1 : 0 });
      c.drawImage(p.canvas, Math.round(cx - p.ox), Math.round(shelfY + 1 - p.oy - lift));
    } else {
      drawWood(c, x + 4, y + 8, w - 8, h - 8, { tone: 'light', nails: true, planks: 3, round: 0 });
      c.fillStyle = '#5a3418'; c.fillRect(x + 4, y + 8, 3, h - 8); c.fillRect(x + w - 7, y + 8, 3, h - 8);
      drawText(c, it.icon === 'crate2' ? 'JUNK' : 'TACKLE', cx, y + 24, { align: 'center', font: 'small', color: '#3a1a0a' });
      // goodies peeking out of the top
      (it.contents || []).forEach(([b], i) => {
        const s = baitSprite(b, t + i);
        c.drawImage(s, Math.round(cx - 14 + i * 16), y + 2 - (i % 2) * 2, s.width * 2, s.height * 2);
      });
    }
    if (it.locked) {
      c.globalAlpha = 0.55; c.fillStyle = '#1a2030'; c.fillRect(x + 4, y + 6, w - 8, h - 6); c.globalAlpha = 1;
      const lk = getUiIcon('lock');
      c.drawImage(lk, Math.round(cx - lk.width / 2), y + h / 2 - 2);
    } else if (it.value > it.base) drawText(c, `SAVE ${it.value - it.base}`, cx, y - 6, { align: 'center', font: 'small', color: '#9affc8', outline: '#1a0e06' });
  }

  // ================================================================ close-up (screen space)
  drawCloseUp(ctx, ui, L, t, dt, ez) {
    const g = this.game, st = g.state, inp = g.input;
    const it = this.focus || this.lastFocus;
    if (this.focus) this.lastFocus = this.focus;
    if (!it) return;
    this.focusT = (this.focusT || 0) + dt;
    const cam = this.cam;
    const toS = (x, y) => [L.S.x + (x - cam.ox) * cam.Z, L.S.y + (y - cam.oy) * cam.Z];
    const a = clamp01((ez - 0.55) / 0.45);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    // spotlight on the mat
    const [mx, my] = toS(L.mat.x, L.counterTop + 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba('#fff0c8', 0.07);
    ctx.beginPath(); ctx.moveTo(mx - 30, L.S.y); ctx.lineTo(mx + 30, L.S.y); ctx.lineTo(mx + 110, my); ctx.lineTo(mx - 110, my); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // turntable
    const spin = this.focusT * 0.9;
    const tr = 64, ty = Math.round(my - 4);
    ctx.fillStyle = '#1a0e08'; ctx.beginPath(); ctx.ellipse(mx, ty + 3, tr + 2, 14, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b8782a'; ctx.beginPath(); ctx.ellipse(mx, ty + 2, tr, 12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a1a2e'; ctx.beginPath(); ctx.ellipse(mx, ty, tr - 4, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#9a2a40'; ctx.beginPath(); ctx.ellipse(mx, ty - 1, tr - 8, 7, 0, 0, TAU); ctx.fill();
    for (let k = 0; k < 12; k++) {
      const an = spin + (k / 12) * TAU;
      if (Math.sin(an) < 0) continue;
      ctx.fillStyle = '#f6d27a';
      ctx.fillRect(Math.round(mx + Math.cos(an) * (tr - 1)), Math.round(ty + 2 + Math.sin(an) * 11), 2, 1);
    }
    // the item, big
    const real = it.kind === 'deal' ? it.dealOf : it;
    const base = ty - 2;
    const bob = Math.round(Math.sin(this.focusT * 2) * 2);
    if (real.kind === 'bait') {
      const k = Math.floor(((spin / TAU) * BAIT_FRAMES * 1.6) % BAIT_FRAMES);
      const f = baitFrame(real.id, k) || baitFrame(real.id, 0);
      if (f) {
        const x = Math.round(mx - f.cx), y = Math.round(base - f.base - 6 + bob);
        if (f.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(f.glow, x, y); ctx.globalCompositeOperation = 'source-over'; }
        ctx.drawImage(f.canvas, x, y);
      } else {
        const s = baitSprite(real.id, t);
        ctx.drawImage(s, Math.round(mx - s.width * 4), base - s.height * 8 - 10, s.width * 8, s.height * 8);
      }
    } else if (real.kind === 'decor') {
      const p = this.closeProp(real);
      if (p) {
        const an = spin * 0.8;
        const cs = Math.cos(an);
        const w = Math.max(2, Math.round(Math.abs(cs) * p.w));
        const src = cs < 0 ? this.flipped(p.canvas) : p.canvas;
        const x = Math.round(mx - (p.ox / p.w) * w), y = Math.round(base - p.oy + bob);
        ctx.drawImage(src, x, y, w, p.h);
        if (p.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(cs < 0 ? this.flipped(p.glow) : p.glow, x, y, w, p.h); ctx.globalCompositeOperation = 'source-over'; }
      }
    } else if (real.kind === 'cosmetic') {
      if (real.swatch) {
        ctx.fillStyle = '#2a1408'; ctx.fillRect(mx - 31, base - 66, 62, 62);
        ctx.fillStyle = real.swatch; ctx.fillRect(mx - 30, base - 65, 60, 60);
        ctx.fillStyle = rgba('#ffffff', 0.4); ctx.fillRect(mx - 27, base - 62, 20, 4);
      } else {
        const look = CHAR.equipItem ? CHAR.equipItem(st.character, real.item) : { ...(st.character || {}), [real.slot]: real.value };
        try { CHAR.drawCharacter(ctx, mx, base - 2 + bob, { pose: 'idle', t: this.focusT, scale: 2, look, yaw: (spin * 57.3) % 360, lookAt: [inp.x, inp.y], id: 'shopPreview', shadow: false }); } catch { /* character module still landing */ }
      }
    } else {
      ctx.save();
      ctx.translate(mx, base);
      ctx.scale(2, 2);
      this.drawCrate(ctx, real, 0, 0, -bob / 2, t, true);
      ctx.restore();
    }
    // sparkles around the showcase
    if (Math.random() < dt * 5) (this.sparks ||= []).push({ x: mx + rnd(-60, 60), y: base - rnd(10, 120), t: 0 });
    for (const s of this.sparks || []) {
      s.t += dt;
      const k = Math.sin(clamp01(s.t / 0.6) * Math.PI);
      ctx.fillStyle = rgba('#fff6c8', k);
      ctx.fillRect(Math.round(s.x), Math.round(s.y - 1), 1, 3); ctx.fillRect(Math.round(s.x - 1), Math.round(s.y), 3, 1);
    }
    if (this.sparks) this.sparks = this.sparks.filter((s) => s.t < 0.6);

    // ---------------------------------------- spec sheet
    const cw = Math.round(clamp(L.S.w * 0.38, 300, 400));
    const C = { x: L.S.x + L.S.w - cw - 14 + Math.round((1 - a) * 40), y: L.S.y + 12, w: cw, h: L.S.h - 24 };
    drawPaper(ctx, C.x, C.y, C.w, C.h, { aged: true });
    for (const px of [C.x + 14, C.x + C.w - 18]) { ctx.fillStyle = '#7a4a1c'; ctx.fillRect(px, C.y - 2, 5, 5); ctx.fillStyle = '#f6d27a'; ctx.fillRect(px, C.y - 2, 2, 2); }
    const x = C.x + 14, w = C.w - 28;
    let y = C.y + 12;
    const INK = '#2a1a10', INK2 = '#5a4636', INK3 = '#8a7058', GOOD = '#2a7a3a', BAD = '#b8382a';
    const kindLabel = real.kind === 'bait' ? `BAIT  -  PACK OF ${real.qty}` : real.kind === 'decor' ? `AQUARIUM DECOR  -  ${['', 'SMALL', 'MEDIUM', 'LARGE'][real.size] || ''}` : real.kind === 'cosmetic' ? `COSMETIC  -  ${prettify(real.slot).toUpperCase()}` : 'SPECIAL OFFER';
    drawText(ctx, kindLabel, x, y, { font: 'small', color: '#8a3a2a' });
    y += 9;
    const title = it.kind === 'deal' ? real.name : it.name;
    if (measureText(title, 'normal', 2) <= w) { drawText(ctx, title, x, y, { scale: 2, color: INK }); y += 20; } else { for (const l of wrapText(title, w).slice(0, 2)) { drawText(ctx, l, x, y, { color: INK }); y += 10; } y += 3; }
    // Bloat's take
    const quote = real.kind === 'bait' ? BAIT_QUIP[real.id] : this.quipFor || '';
    if (quote) { for (const l of wrapText(`"${quote}" - Cap'n Bloat`, w)) { drawText(ctx, l, x, y, { color: '#9a6a3a' }); y += 10; } y += 2; }
    for (const l of wrapText(real.desc, w).slice(0, 3)) { drawText(ctx, l, x, y, { color: INK2 }); y += 10; }
    y += 3;
    const section = (title) => {
      drawText(ctx, title, x, y, { font: 'small', color: '#8a3a2a' });
      const tw = measureText(title, 'small');
      ctx.fillStyle = rgba('#7a5a3c', 0.35);
      ctx.fillRect(x + tw + 4, y + 2, w - tw - 4, 1);
      y += 9;
    };
    if (real.kind === 'bait') {
      section('ATTRACTS');
      y = this.drawAttracts(ctx, ui, real.id, x, y, w, t);
      section('EFFECTS');
      for (const l of BAIT_FX[real.id] || []) { ctx.drawImage(getUiIcon('sparkle'), x, y); drawText(ctx, l, x + 13, y + 1, { color: INK2 }); y += 10; }
      y += 2;
    } else if (real.kind === 'decor') {
      section('DETAILS');
      const rows = [['Size', ['', 'Small - fits anywhere', 'Medium - a centrepiece', 'Large - a landmark'][real.size] || '-'], ['From', BIOME_NAMES[real.biome] || prettify(real.biome || '')], ['Style', (real.tags || []).map(prettify).join(', ') || '-'], ['In your tank', String(this.owned(real))]];
      for (const [k, v] of rows) { drawText(ctx, k, x, y, { color: INK3 }); drawText(ctx, v, x + w, y, { color: INK2, align: 'right' }); y += 10; }
      y += 2;
      section('EFFECTS');
      for (const l of ['Fish explore it and hide inside', 'Happier fish make more coins']) { ctx.drawImage(getUiIcon('heart'), x, y); drawText(ctx, l, x + 13, y + 1, { color: INK2 }); y += 10; }
      y += 2;
    } else if (real.kind === 'cosmetic') {
      section('DETAILS');
      const slotName = (CHAR.WARDROBE_SLOTS || []).find((q) => q.id === real.slot)?.name || prettify(real.slot);
      const R = RARITY[real.rarity] || RARITY.common;
      drawText(ctx, 'Slot', x, y, { color: INK3 }); drawText(ctx, slotName, x + w, y, { color: INK2, align: 'right' }); y += 10;
      drawText(ctx, 'Rarity', x, y, { color: INK3 }); drawText(ctx, R.name, x + w, y, { color: R.dark, align: 'right' }); y += 10;
      drawText(ctx, 'Status', x, y, { color: INK3 });
      const wearing = this.wearing(real);
      drawText(ctx, wearing ? 'Wearing it' : this.owned(real) ? 'In your wardrobe' : real.locked ? real.lockWhy : 'Not owned', x + w, y, { color: wearing || this.owned(real) ? GOOD : real.locked ? BAD : INK2, align: 'right' }); y += 12;
      if (this.owned(real) && !wearing && ui.button(ctx, x, y, w, 18, 'Wear it', { style: 'wood' })) {
        this.wear(real);
        this.say(pick(LINES.cosmetic), 'happy');
      }
      if (this.owned(real) && !wearing) y += 22;
    } else if (real.kind === 'bundle') {
      section('CONTENTS');
      if (real.id === 'b_mystery') {
        drawText(ctx, '3 random packs of bait you have unlocked', x, y, { color: INK2 }); y += 10;
        if (this.mystery) { drawText(ctx, 'Last box: ' + this.mystery.map(([b, n]) => `${n} ${BAITS[b].name}`).join(', '), x, y, { font: 'small', color: GOOD }); y += 9; }
      }
      for (const [b, n] of real.contents || []) {
        const s = baitSprite(b, t);
        ctx.drawImage(s, x, y + Math.round(4 - s.height / 2));
        drawText(ctx, `${n} x ${BAITS[b].name}`, x + 14, y + 1, { color: g.stats.unlockBait.has(b) ? INK2 : BAD });
        y += 10;
      }
      if (real.value > real.base) { drawText(ctx, `Worth ${formatCommas(real.value)}{coin} - you save ${formatCommas(real.value - real.base)}`, x, y + 1, { color: GOOD }); y += 11; }
      y += 2;
    }
    section('HOW TO USE');
    const how = real.kind === 'bait' ? 'Pick it in the Bait Box (B), then cast your line.' : real.kind === 'decor' ? 'Goes straight into your aquarium. Drag it around in the tank.' : real.kind === 'cosmetic' ? 'Your fisher wears it right away. Swap it here any time.' : 'Everything goes straight into your bait box.';
    for (const l of wrapText(how, w)) { drawText(ctx, l, x, y, { color: INK2 }); y += 10; }
    y += 3;
    // stock + deal
    section('STOCK');
    const left = this.stockLeft(it);
    const own = this.owned(it);
    drawText(ctx, real.kind === 'cosmetic' ? (own ? 'Already in your wardrobe' : 'One of a kind') : left === Infinity ? 'Plenty in the back' : left > 0 ? `${left} left today` : 'Sold out - back tomorrow', x, y, { color: real.kind === 'cosmetic' ? (own ? GOOD : INK2) : left > 0 ? INK2 : BAD });
    if (real.kind === 'bait') drawText(ctx, `You have ${own}`, x + w, y, { color: INK3, align: 'right' });
    y += 12;
    section('DAILY DEAL');
    const sp0 = this.special;
    const isDeal = it.kind === 'deal' || sp0?.id === real.id;
    const now = new Date();
    const mins = Math.max(0, Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now) / 60000));
    if (isDeal) { drawText(ctx, `20% off! Ends in ${Math.floor(mins / 60)}h ${mins % 60}m`, x, y, { color: '#c8283a' }); y += 10; } else if (sp0) {
      const dItem = this.items(sp0.tab).find((q) => q.id === sp0.id);
      drawText(ctx, `Today: ${dItem?.name || '?'} -20%`, x, y, { color: INK2 });
      y += 10;
    }
    // price + buy
    const price = this.price(it);
    const by = C.y + C.h - 40;
    // Cap'n's tip, pinned above the price when there is room
    const tip = TIPS[real.kind === 'bait' ? real.id : real.kind];
    if (tip) {
      const tl = wrapText(tip, w - 40);
      const th = tl.length * 10 + 14, tyy = by - 14 - th;
      if (tyy > y + 4) {
        ctx.fillStyle = rgba('#7a5a3c', 0.16);
        ctx.fillRect(x, tyy, w, th);
        ctx.fillStyle = rgba('#7a5a3c', 0.4);
        ctx.fillRect(x, tyy, 2, th);
        const face = memo('tipface', () => {
          const b = new PixelBuffer(26, 22);
          b.fillEllipse(13, 12, 11, 9, pack('#d0aa58'));
          b.fillEllipse(13, 15, 8, 5, pack('#f1e3bb'));
          b.rect(4, 2, 18, 4, pack('#2c3e6a')); b.rect(2, 6, 22, 2, pack('#16161e')); b.rect(11, 6, 3, 1, pack('#f0c040'));
          b.fillCircle(9, 11, 2.4, pack('#f8f4e6')); b.fillCircle(17, 11, 2.4, pack('#f8f4e6'));
          b.set(9, 11, pack('#1a0e0a')); b.set(17, 11, pack('#1a0e0a'));
          b.rect(6, 8, 6, 1, pack('#f4f2ee')); b.rect(14, 8, 6, 1, pack('#f4f2ee'));
          b.fillCircle(13, 14, 2, pack('#de7a68'));
          b.rect(9, 16, 9, 2, pack('#f3efe6'));
          b.rect(18, 17, 5, 1, pack('#8e5a2c')); b.set(23, 17, pack('#ff8a3a'));
          b.outline(() => pack('#3a2410'));
          return b.toCanvas();
        });
        ctx.drawImage(face, x + 6, tyy + Math.round(th / 2 - 11));
        drawText(ctx, "CAP'N'S TIP", x + 36, tyy + 4, { font: 'small', color: '#8a3a2a' });
        tl.forEach((l, i) => drawText(ctx, l, x + 36, tyy + 12 + i * 10, { color: '#5a4636' }));
      }
    }
    ctx.fillStyle = rgba('#7a5a3c', 0.35);
    ctx.fillRect(x, by - 8, w, 1);
    if (isDeal && price !== real.base) {
      const os = `${formatCommas(real.base)}`;
      drawText(ctx, os, x, by + 2, { color: INK3 });
      ctx.fillStyle = BAD; ctx.fillRect(x - 1, by + 5, measureText(os) + 2, 1);
    }
    drawText(ctx, price ? `${formatCommas(price)}{coin}` : 'FREE', x + (isDeal && price !== real.base ? measureText(formatCommas(real.base)) + 8 : 0), by + 2, { scale: 2, color: INK });
    drawText(ctx, st.coins >= price ? `You have ${formatCommas(Math.floor(st.coins))}` : `Need ${formatCommas(Math.ceil(price - st.coins))} more`, x, by + 20, { font: 'small', color: st.coins >= price ? GOOD : BAD });
    const canBuy = !it.locked && left > 0 && !(real.kind === 'cosmetic' && own) && !(real.kind === 'cosmetic' && real.price == null);
    const label = it.locked ? 'Locked' : real.kind === 'cosmetic' && own ? 'Owned' : left <= 0 ? 'Sold out' : 'Buy!';
    const bw = 104, bx = x + w - bw;
    const bR = { x: bx, y: by - 2, w: bw, h: 26 };
    const pressedOver = inp.pressed && ui.hover(bR);
    if (ui.button(ctx, bx, by - 2, bw, 26, label, { style: 'coral', disabled: !canBuy || st.coins < price, tip: it.locked ? `Grow '${it.skill?.name || 'a skill'}' first` : st.coins < price ? `You need ${formatCommas(Math.ceil(price - st.coins))} more coins` : `Buy ${title}`, sound: 'ui_click' }) && a >= 1) {
      if (this.buy(it)) {
        this.buyFlash = 1;
        const [rx, ry] = toS(L.reg.x + 30, L.counterTop - 20);
        for (let i = 0; i < 6; i++) this.flyers.push({ x0: bx + bw / 2, y0: by, x1: rx, y1: ry, t: -i * 0.06, dur: 0.5 });
        const P = g.particles;
        for (let i = 0; i < 12; i++) P.sparkle(mx + rnd(-50, 50), base - rnd(0, 90), i % 2 ? '#fff6b0' : '#ffd25a', { layer: 'ui' });
        P.bubbles(mx, base - 30, 8, { layer: 'ui' });
      }
    } else if (pressedOver) this.buy(it);
    if (it.locked && real.kind === 'cosmetic') drawText(ctx, real.lockWhy, x, by - 18, { font: 'small', color: BAD });
    else if (it.locked && it.skill) drawText(ctx, `Unlock: grow '${it.skill.name}' (${BRANCHES[it.skill.branch].name})`, x, by - 18, { font: 'small', color: BAD });
    if (this.buyFlash > 0) {
      this.buyFlash = Math.max(0, this.buyFlash - dt * 1.2);
      ctx.globalAlpha = a * clamp01(this.buyFlash * 3);
      drawStamp(ctx, C.x + C.w / 2, C.y + C.h * 0.42, 'SOLD!', { color: '#2a8a4a', angle: -0.2, scale: lerp(2, 1, ease.outCubic(clamp01((1 - this.buyFlash) * 4))) });
      ctx.globalAlpha = a;
    }
    // back button (top-left of the scene)
    if (ui.button(ctx, L.S.x + 10, L.S.y + 10, 96, 22, 'Back', { icon: 'arrow_l', style: 'wood', tip: 'Back to the shelves (Esc)' }) && a >= 1) this.unfocus();
    // click on the scene outside the sheet also backs out
    if (a >= 1 && inp.pressed && !ui.hover(C) && ui.hover({ x: L.S.x, y: L.S.y, w: L.S.w, h: L.S.h }) && !ui.hover({ x: mx - 80, y: base - 160, w: 160, h: 170 })) { inp.pressed = false; this.unfocus(); }
    ctx.globalAlpha = 1;
  }

  closeProp(it) {
    const key = `close|${it.id}`;
    let p = this.decorSpr[key];
    if (p) return p;
    let s = (DECOR_SCALE[it.size] || 0.4) * 2;
    let q = getProp(it.id, { scale: s });
    const k = Math.min(200 / q.w, 170 / q.h);
    if (k < 1 || k > 1.5) { s = clamp(Math.floor(s * k * 20) / 20, 0.2, 3); q = getProp(it.id, { scale: s }); }
    p = this.decorSpr[key] = { canvas: q.canvas, glow: q.glow, w: q.w, h: q.h, ox: q.ox, oy: q.oy };
    return p;
  }

  flipped(src) {
    this.flipCache ||= new WeakMap();
    let f = this.flipCache.get(src);
    if (!f) {
      f = makeCanvas(src.width, src.height);
      const k = ctxOf(f);
      k.translate(src.width, 0); k.scale(-1, 1); k.drawImage(src, 0, 0);
      this.flipCache.set(src, f);
    }
    return f;
  }

  // species that like a bait: portraits (silhouettes until seen) with names
  drawAttracts(ctx, ui, baitId, x, y, w, t) {
    const st = this.game.state;
    const key = `att|${baitId}`;
    let list = cache.get(key);
    if (!list) {
      list = SPECIES.filter((sp) => !sp.quirks?.includes('intro')).map((sp) => ({ sp, v: baitInterest(sp, { kind: 'special', type: baitId }) })).filter((q) => q.v >= 1.4).sort((a, b) => b.v - a.v).slice(0, 9);
      cache.set(key, list);
    }
    if (!list.length) { drawText(ctx, 'Most fish give it a curious sniff.', x, y, { color: '#5a4636' }); return y + 12; }
    const cols = 3, cw = Math.floor(w / cols), ch = 46;
    list.forEach((q, i) => {
      const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * ch;
      const j = st.journal[q.sp.id];
      const known = j?.seen || j?.caught;
      ctx.fillStyle = rgba('#7a5a3c', 0.12);
      ctx.fillRect(cx + 1, cy, cw - 3, ch - 3);
      ctx.save();
      ctx.beginPath(); ctx.rect(cx + 1, cy, cw - 3, ch - 12); ctx.clip();
      try {
        const c = compiled(q.sp.look, null, q.sp.id);
        const b = q.sp.look?.body || {};
        const kind = q.sp.look?.kind;
        const ext = Math.max(b.len || 40, (b.h || 20) * (kind === 'seahorse' || kind === 'squid' || kind === 'jelly' ? 2.6 : 1.7)) * (q.sp.scale || 1);
        const s = clamp(44 / (ext * 1.2), 0.2, 1.5);
        drawFishRig(ctx, c, { x: cx + cw / 2, y: cy + 17, facing: 1, scale: s, angle: 0, swimPhase: (t * 0.6 + i * 0.2) % 1, tailPhase: (t * 0.8 + i * 0.3) % 1, finPhase: (t + i * 0.2) % 1, speed01: 0.2, time: t, silhouette: !known, emotion: 'happy', lookX: null, lookY: null });
      } catch { /* ignore */ }
      ctx.restore();
      const nm = known ? q.sp.name : '???';
      let s2 = nm;
      while (measureText(s2, 'small') > cw - 6 && s2.length > 3) s2 = s2.slice(0, -1);
      drawText(ctx, s2 + (s2 !== nm ? '.' : ''), cx + cw / 2, cy + ch - 10, { align: 'center', font: 'small', color: known ? '#3a2a1a' : '#8a7058' });
      const hr = { x: cx, y: cy, w: cw - 2, h: ch - 2 };
      if (ui.hover(hr)) ui.tip = known ? `${q.sp.name} (${q.sp.rarity}) - loves this bait` : 'Undiscovered fish - try this bait!';
    });
    return y + Math.ceil(list.length / cols) * ch + 2;
  }

  // ------------------------------------------------ speech bubble (screen space, follows Bloat through the zoom)
  drawSpeech(ctx, L, t, dt) {
    if (!this.line) return;
    this.lineT += dt;
    if (this.lineT < 0) return;
    const A = this.bloatA;
    if (!A) return;
    const cam = this.cam;
    const toS = (x, y) => [L.S.x + (x - cam.ox) * cam.Z, L.S.y + (y - cam.oy) * cam.Z];
    const [hx, hy] = toS(A.top[0], A.top[1]);
    const [mx, my] = toS(A.mouth[0] + 10, A.mouth[1]);
    const maxW = this.zoom > 0.5 ? 180 : 170;
    const lines = wrapText(this.line, maxW);
    const bw = Math.max(...lines.map((l) => measureText(l))) + 22, bh = lines.length * 10 + 13;
    let bx = Math.round(hx + 18), by = Math.round(hy - bh - 6);
    bx = clamp(bx, L.S.x + 6, L.S.x + L.S.w - bw - 6);
    by = clamp(by, L.S.y + 4, L.S.y + L.S.h - bh - 30);
    const fade = this.lineT > 6.5 ? clamp01(1 - (this.lineT - 6.5) * 2) : 1;
    if (fade <= 0) { this.line = null; return; }
    const shown = this.line.slice(0, Math.floor(this.lineT * 38));
    ctx.globalAlpha = Math.min(1, this.lineT * 8) * fade;
    const pop = this.lineT < 0.15 ? Math.round((0.15 - this.lineT) * 20) : 0;
    const cr = drawBubble(ctx, bx, by + pop, bw, bh, { tailX: clamp(mx + 6, bx + 12, bx + bw - 12), tailY: by + bh + 10 });
    let left = shown.length;
    lines.forEach((l, i) => {
      const s = l.slice(0, Math.max(0, left));
      left -= l.length + 1;
      drawText(ctx, s, cr.x + 4, cr.y + 3 + i * 10 + pop, { color: this.mood === 'angry' ? '#8a1a1a' : '#3a2a22' });
    });
    ctx.globalAlpha = 1;
  }
}

function decorDesc(d) {
  const where = { shallows: 'Found in the Sunny Shallows.', junkyard: 'Salvaged from Junkyard Reef.', abyss: 'Hauled up from the Deep Ocean.', aquarium: 'A classic aquarium ornament.' }[d.biome] || '';
  const size = ['', 'A small touch', 'A handsome centrepiece', 'A grand landmark'][d.size] || 'A decoration';
  return `${size} for your aquarium. ${where} Fish love to explore it.`;
}
