// Gil, the voxel fisherman: a goofy fish-headed angler built from posable voxel parts (head with bulging
// eyes / fish lips / gill flaps / dorsal fin, stubby torso, two-bone arms and legs, hat, accessories, rod).
// Each animation frame poses the parts (FK angles + 2-bone IK for hands), stamps them into one voxel model
// and renders it with voxel.js (AO, hue-shifted ramps, outlines). Frames are cached per
// (look, pose, frame, yaw, scale, facing) and built lazily under a small time budget with nearest-frame
// fallback. Pupils, eyelids/blinks and the held fish are drawn live on top (cheap 2D, masked to the
// visible eye whites), so the eyes jiggle, follow motion and look at things every frame.
//
// drawCharacter(ctx, x, y, {pose, t, facing, scale, look, fish, lookAt, id, yaw, rod, shadow})
//   -> {rodTip:[x,y], hands:[x,y], head:[x,y], handL, handR, mouth}
//   Feet at (x, y) (for 'sit': the seat point; legs dangle below). ~80 px tall at scale 1 (hat included).
//   pose: idle | cast | reel | pull | yank | hold | cheer | sad | sit | wave. t = seconds; loops wrap,
//   one-shots ('cast', 'yank') should get the time since the pose started and hold their last frame.
//   facing 1 = right, -1 = left (3/4 views). yaw (degrees) overrides facing for turntables.
//   fish (hold) = {compiled, variant} drawn with drawFishRig between the body and the gripping hands.
//   lookAt = [x, y] screen point the pupils track; id = key for the per-character eye physics.
// DEFAULT_CHARACTER, WARDROBE (items {id, slot, value, name, price | unlock: 'package'|'skill', skill,
// rarity, desc}), WARDROBE_SLOTS, normalizeLook, ownsCosmetic, grantCosmetic, equipItem, boatPaint,
// itemPreview (wardrobe thumbnails), warmCharacter, characterStats.

import { VoxelModel, renderVoxels } from './voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { shade, mix, hexToHsl, hslToHex } from '../core/color.js';
import { clamp, clamp01, lerp, hash3, TAU } from '../core/math.js';
import { drawFishRig } from './fishrig.js';

// ====================================================================== wardrobe data

const SKINS = {
  green: { name: 'Pickle Green', skin: '#5ccf4a', belly: '#e2f5a8', fin: '#ffa23a', lips: '#ff7f8f', spot: '#3f9e3c', gill: '#ec4a62' },
  lime: { name: 'Zesty Lime', skin: '#a6dc34', belly: '#f6fbc0', fin: '#ff6aa0', lips: '#ff7a8a', spot: '#6fa82a', gill: '#e8405a' },
  mint: { name: 'Minty Fresh', skin: '#58d8a2', belly: '#e4fbea', fin: '#ffb84a', lips: '#ff8a9a', spot: '#38a87c', gill: '#e8506a' },
  swamp: { name: 'Swamp Thing', skin: '#7f9a3e', belly: '#dcd894', fin: '#d8643a', lips: '#e8788a', spot: '#5a7228', gill: '#c8404a' },
  forest: { name: 'Deep Forest', skin: '#2f9450', belly: '#bfe6a4', fin: '#ffd04a', lips: '#ff8a8a', spot: '#1f6a3c', gill: '#e8405a' },
  kelp: { name: 'Kelp Teal', skin: '#33b49a', belly: '#d4f4dc', fin: '#ff8a5a', lips: '#ff8aa0', spot: '#1f8a78', gill: '#e8506a' },
  blue: { name: 'Big Blue', skin: '#4a8ae8', belly: '#d8ecff', fin: '#ffd04a', lips: '#ff8aa8', spot: '#2f62b8', gill: '#ff5a7a' },
  orange: { name: 'Goldie Orange', skin: '#ff8f2e', belly: '#ffe6b0', fin: '#fff2dc', lips: '#ff5a6a', spot: '#e0601a', gill: '#d8303a' },
  pink: { name: 'Bubblegum', skin: '#ff8ac4', belly: '#ffeaf4', fin: '#7ad8ff', lips: '#e8406a', spot: '#e860a0', gill: '#d8304a' },
  purple: { name: 'Grape Soda', skin: '#9a6ae0', belly: '#ecdcff', fin: '#7affc8', lips: '#ff7ab0', spot: '#7448b8', gill: '#ff4a8a' },
  gold: { name: 'Solid Gold', skin: '#f2c23a', belly: '#fff2b8', fin: '#ffffff', lips: '#ff9a6a', spot: '#d89a1a', gill: '#e8603a', shiny: true },
};

const OUTFITS = {
  overalls: { name: 'Denim Overalls', sleeve: 'short', legs: 'long', shirt: '#c8463a', arm: '#c8463a', pants: '#3e6cb4' },
  raincoat: { name: 'Sunny Raincoat', sleeve: 'long', legs: 'long', shirt: '#ffcc2e', arm: '#ffcc2e', pants: '#2c3c5e' },
  hawaiian: { name: 'Hawaiian Shirt', sleeve: 'short', legs: 'shorts', shirt: '#22b4b0', arm: '#22b4b0', pants: '#e6cf9c' },
  hoodie: { name: 'Comfy Hoodie', sleeve: 'long', legs: 'long', shirt: '#8a5ad8', arm: '#8a5ad8', pants: '#6a6e7c' },
  wetsuit: { name: 'Wetsuit', sleeve: 'long', legs: 'long', shirt: '#262a38', arm: '#262a38', pants: '#262a38' },
  tuxedo: { name: 'Fancy Tuxedo', sleeve: 'long', legs: 'long', shirt: '#24242f', arm: '#24242f', pants: '#24242f' },
  astronaut: { name: 'Astronaut Suit', sleeve: 'long', legs: 'long', shirt: '#e8ecf4', arm: '#e8ecf4', pants: '#e8ecf4' },
  pajamas: { name: 'Starry Pajamas', sleeve: 'long', legs: 'long', shirt: '#86b4f0', arm: '#86b4f0', pants: '#86b4f0' },
};

// accessory id -> spot (one accessory per spot)
const ACC_SPOT = { sunglasses: 'eyes', monocle: 'eyes', snorkel: 'eyes', mustache: 'mouth', bandana: 'neck', bowtie: 'neck', scarf: 'neck', earring: 'ear', backpack: 'back' };

export const WARDROBE_SLOTS = [
  { id: 'skin', name: 'Skin', desc: 'Scales and fins' },
  { id: 'eyes', name: 'Eyes', desc: 'Peepers' },
  { id: 'mouth', name: 'Mouth', desc: 'Lips and grins' },
  { id: 'hat', name: 'Hats', desc: 'Headwear' },
  { id: 'outfit', name: 'Outfits', desc: 'Clothes' },
  { id: 'boots', name: 'Boots', desc: 'Footwear' },
  { id: 'gloves', name: 'Gloves', desc: 'Handwear' },
  { id: 'acc', name: 'Extras', desc: 'Accessories (mix & match)' },
  { id: 'rod', name: 'Rods', desc: 'Fishing rods' },
  { id: 'boat', name: 'Boat', desc: 'Boat paint' },
];

const it = (slot, value, name, rarity, price, desc, extra = {}) => ({ id: slot + '_' + value, slot, value, name, rarity, price, desc, ...extra });
const pkg = { price: null, unlock: 'package' };
const skill = (id) => ({ price: null, unlock: 'skill', skill: id });

export const WARDROBE = [
  // skins
  it('skin', 'green', 'Pickle Green', 'common', 0, 'The classic. Fresh, crunchy, a little briny.'),
  it('skin', 'lime', 'Zesty Lime', 'common', 60, 'Squeeze me for extra zest.'),
  it('skin', 'mint', 'Minty Fresh', 'uncommon', 150, 'Cool as a cucumber fish.'),
  it('skin', 'kelp', 'Kelp Teal', 'uncommon', 150, 'Blends right into a kelp forest.'),
  it('skin', 'forest', 'Deep Forest', 'uncommon', 180, 'Dark and mysterious. Mostly mysterious.'),
  it('skin', 'swamp', 'Swamp Thing', 'rare', 420, 'Smells faintly of pond. In a good way.'),
  it('skin', 'blue', 'Big Blue', 'rare', 480, 'Feeling blue? Look fabulous anyway.'),
  it('skin', 'orange', 'Goldie Orange', 'rare', 520, 'The goldfish-bowl glow-up.'),
  it('skin', 'pink', 'Bubblegum', 'epic', 900, 'Pop! Sweet, pink and slightly sticky.'),
  it('skin', 'purple', 'Grape Soda', 'epic', null, 'Fizzy scales from a mystery crate.', pkg),
  it('skin', 'gold', 'Solid Gold', 'legendary', null, 'Shiny enough to blind a seagull. Earned with the Golden Hook.', skill('hook6')),
  // eyes
  it('eyes', 'goofy', 'Goofy Eyes', 'common', 0, 'Each one has its own opinion.'),
  it('eyes', 'googly', 'Googly Eyes', 'common', 50, 'Rattle rattle rattle.'),
  it('eyes', 'sleepy', 'Sleepy Eyes', 'uncommon', 120, 'Five more minutes...'),
  it('eyes', 'angry', 'Grumpy Eyes', 'uncommon', 140, 'Furious about absolutely nothing.'),
  it('eyes', 'starry', 'Starry Eyes', 'rare', 450, 'Dazzled by every single fish.'),
  it('eyes', 'hearts', 'Lovestruck', 'epic', null, 'Falls in love with every catch.', pkg),
  it('eyes', 'dizzy', 'Dizzy Spirals', 'epic', null, 'Spun around one too many times.', pkg),
  // mouths
  it('mouth', 'pout', 'Fish Pout', 'common', 0, 'Blub. The classic fish face.'),
  it('mouth', 'grin', 'Big Grin', 'common', 40, 'All teeth, all the time.'),
  it('mouth', 'buck', 'Buck Teeth', 'uncommon', 110, 'Great for nibbling kelp.'),
  it('mouth', 'tongue', 'Silly Tongue', 'uncommon', 130, 'Bleh!'),
  it('mouth', 'whistle', 'Whistler', 'rare', 380, 'Always whistling a sea shanty.'),
  it('mouth', 'smooch', 'Smoochy Lips', 'epic', null, 'Mwah! Lips from a treasure crate.', pkg),
  // hats
  it('hat', 'none', 'No Hat', 'common', 0, 'Let that dorsal fin breathe.'),
  it('hat', 'bucket', 'Bucket Hat', 'common', 0, 'Covered in lucky lures.'),
  it('hat', 'captain', 'Captain Hat', 'uncommon', 220, 'Aye aye, cap\'n Gil.'),
  it('hat', 'propeller', 'Propeller Beanie', 'uncommon', 180, 'Spins when you get excited.'),
  it('hat', 'cowboy', 'Cowboy Hat', 'uncommon', 260, 'Yee-haw, partner. Fish ho.'),
  it('hat', 'souwester', 'Sou\'wester', 'common', 90, 'For very wet weather.'),
  it('hat', 'party', 'Party Hat', 'common', 70, 'Every catch is a party.'),
  it('hat', 'chef', 'Chef Hat', 'rare', 480, 'Definitely not cooking the fish. Definitely.'),
  it('hat', 'viking', 'Viking Helmet', 'rare', 650, 'Raid the seven seas.'),
  it('hat', 'cone', 'Traffic Cone', 'epic', 1200, 'Found it on the seabed. Wears it with pride.'),
  it('hat', 'crown', 'Royal Crown', 'legendary', null, 'For the Fish King. Comes in very rare crates.', pkg),
  // outfits
  it('outfit', 'overalls', 'Denim Overalls', 'common', 0, 'Flannel underneath. Very outdoorsy.'),
  it('outfit', 'raincoat', 'Sunny Raincoat', 'common', 120, 'Bright yellow, waterproof, extra cheerful.'),
  it('outfit', 'hawaiian', 'Hawaiian Shirt', 'uncommon', 240, 'Vacation mode: permanently on.'),
  it('outfit', 'hoodie', 'Comfy Hoodie', 'uncommon', 260, 'Pocket full of snacks.'),
  it('outfit', 'pajamas', 'Starry Pajamas', 'rare', 520, 'Night fishing in maximum comfort.'),
  it('outfit', 'wetsuit', 'Wetsuit', 'rare', null, 'Ready to dive. Unlocked by charting the Junkyard Reef.', skill('exp1')),
  it('outfit', 'tuxedo', 'Fancy Tuxedo', 'epic', 1500, 'For fish galas and very formal splashes.'),
  it('outfit', 'astronaut', 'Astronaut Suit', 'legendary', null, 'One small cast for a fish... From legendary crates.', pkg),
  // boots
  it('boots', 'yellow', 'Yellow Wellies', 'common', 0, 'Squeaky, puddle-proof.'),
  it('boots', 'red', 'Red Wellies', 'common', 60, 'Same squeak, new colour.'),
  it('boots', 'sneakers', 'Sneakers', 'uncommon', 180, 'Fast enough to outrun a crab.'),
  it('boots', 'bare', 'Webbed Feet', 'uncommon', 100, 'Nature\'s flippers. Slightly slimy.'),
  it('boots', 'flippers', 'Big Flippers', 'rare', 450, 'Flap flap flap flap.'),
  it('boots', 'cowboy', 'Cowboy Boots', 'rare', 480, 'With real jingly spurs.'),
  it('boots', 'slippers', 'Bunny Slippers', 'epic', null, 'Fluffy. From a cozy crate.', pkg),
  // gloves
  it('gloves', 'none', 'Bare Fins', 'common', 0, 'Webbed fingers, firm grip.'),
  it('gloves', 'rubber', 'Rubber Gloves', 'common', 70, 'Fish slime? No problem.'),
  it('gloves', 'fingerless', 'Fingerless Gloves', 'uncommon', 160, 'Cool AND practical.'),
  it('gloves', 'mittens', 'Knit Mittens', 'uncommon', 150, 'Grandma made them.'),
  it('gloves', 'oven', 'Oven Mitts', 'rare', 380, 'For red-hot fishing streaks.'),
  it('gloves', 'boxing', 'Boxing Gloves', 'epic', 1100, 'Fight the fish fair and square.'),
  it('gloves', 'gold', 'Golden Gauntlets', 'legendary', null, 'Grip of a champion. Legendary crates only.', pkg),
  // accessories
  it('acc', 'sunglasses', 'Cool Shades', 'uncommon', 200, 'Too cool for the reef.'),
  it('acc', 'snorkel', 'Snorkel Mask', 'uncommon', 220, 'A fish with a snorkel. Why not.'),
  it('acc', 'monocle', 'Monocle', 'rare', 520, 'Indubitably.'),
  it('acc', 'mustache', 'Grand Mustache', 'uncommon', 160, 'Took years to grow. Fish years.'),
  it('acc', 'bandana', 'Red Bandana', 'common', 80, 'Pirate-adjacent.'),
  it('acc', 'bowtie', 'Bow Tie', 'common', 90, 'Dapper.'),
  it('acc', 'scarf', 'Striped Scarf', 'uncommon', 140, 'Cozy for deep-sea chills.'),
  it('acc', 'earring', 'Gold Hoop', 'rare', null, 'A pirate treasure, found in a crate.', pkg),
  it('acc', 'backpack', 'Explorer Pack', 'uncommon', 260, 'Snacks, maps and a spare worm.'),
  // rods
  it('rod', 'bamboo', 'Bamboo Rod', 'common', 0, 'Trusty, bendy, classic.'),
  it('rod', 'candy', 'Candy Cane Rod', 'uncommon', 300, 'Minty! Do not lick.'),
  it('rod', 'carbon', 'Carbon Rod', 'rare', null, 'Light and strong. Unlocked with Ball Bearings.', skill('reel3')),
  it('rod', 'neon', 'Neon Rod', 'epic', null, 'Glows in the deep. Unlocked with the Lantern Hook.', skill('hook7')),
  it('rod', 'golden', 'Golden Rod', 'legendary', 4000, 'Pure gold. Fish just give up.'),
  it('rod', 'laser', 'Laser Rod', 'legendary', null, 'Pew pew. Unlocked with the Overdrive Reel.', skill('reel5')),
  // boat paint
  it('boat', 'tomato', 'Tomato Red', 'common', 0, 'The original paint job.', { color: '#c8583a', trim: '#f2e6c8' }),
  it('boat', 'sky', 'Sky Blue', 'common', 80, 'Sunny day paint.', { color: '#4a9ad8', trim: '#ffffff' }),
  it('boat', 'sunny', 'Sunshine', 'common', 80, 'Bright as a buttercup.', { color: '#f2c23a', trim: '#5a3a1a' }),
  it('boat', 'mint', 'Mint Cream', 'uncommon', 160, 'Fresh and minty.', { color: '#6ad8a8', trim: '#fff6e0' }),
  it('boat', 'navy', 'Navy Stripe', 'uncommon', 180, 'Very nautical.', { color: '#2a3e6e', trim: '#f2f2f2' }),
  it('boat', 'bubblegum', 'Bubblegum', 'rare', 380, 'Pink, proud and floaty.', { color: '#ff8ac0', trim: '#ffffff' }),
  it('boat', 'pirate', 'Pirate Black', 'rare', 520, 'Arr.', { color: '#2a2630', trim: '#d8a838' }),
  it('boat', 'gold', 'Gilded Hull', 'legendary', null, 'Floats on pure luxury. From legendary crates.', { ...pkg, color: '#f2c03a', trim: '#8a2a2a' }),
];
export const WARDROBE_BY_ID = Object.fromEntries(WARDROBE.map((w) => [w.id, w]));

export const DEFAULT_CHARACTER = {
  skin: 'green', eyes: 'goofy', mouth: 'pout', hat: 'bucket', outfit: 'overalls', boots: 'yellow',
  gloves: 'none', acc: [], rod: 'bamboo', boat: '#c8583a',
};

const VALID = {};
for (const w of WARDROBE) (VALID[w.slot] ||= new Set()).add(w.value);

// Fill in defaults, drop unknown ids (old saves stay valid). Accepts a hex `skin` (custom tint).
export function normalizeLook(look) {
  const L = { ...DEFAULT_CHARACTER, ...(look || {}) };
  for (const k of ['eyes', 'mouth', 'hat', 'outfit', 'boots', 'gloves', 'rod']) if (!VALID[k].has(L[k])) L[k] = DEFAULT_CHARACTER[k];
  if (!SKINS[L.skin] && !(typeof L.skin === 'string' && /^#[0-9a-f]{6}$/i.test(L.skin))) L.skin = DEFAULT_CHARACTER.skin;
  const acc = Array.isArray(L.acc) ? L.acc : L.acc ? [L.acc] : [];
  const spots = {};
  for (const a of acc) if (ACC_SPOT[a]) spots[ACC_SPOT[a]] = a;
  L.acc = Object.values(spots).sort();
  if (typeof L.boat !== 'string' || !/^#[0-9a-f]{6}$/i.test(L.boat)) L.boat = DEFAULT_CHARACTER.boat;
  return L;
}

// Owned = free, granted (state.cosmetics[id]) or its unlocking skill is grown.
export function ownsCosmetic(state, item) {
  if (typeof item === 'string') item = WARDROBE_BY_ID[item];
  if (!item) return false;
  if (item.price === 0) return true;
  if (state?.cosmetics?.[item.id]) return true;
  return item.unlock === 'skill' && !!state?.skills?.[item.skill];
}

export function grantCosmetic(state, id) {
  if (!WARDROBE_BY_ID[id]) return false;
  (state.cosmetics ||= {})[id] = true;
  return true;
}

// Cosmetics that can drop from packages, optionally filtered by rarity.
export function packageCosmetics(rarity = null) {
  return WARDROBE.filter((w) => w.unlock === 'package' && (!rarity || w.rarity === rarity)).map((w) => w.id);
}

export function isEquipped(look, item) {
  const L = normalizeLook(look);
  if (item.slot === 'acc') return L.acc.includes(item.value);
  if (item.slot === 'boat') return L.boat.toLowerCase() === item.color.toLowerCase();
  return L[item.slot] === item.value;
}

// Returns a new look with the item equipped (accessories toggle, one per spot).
export function equipItem(look, item) {
  const L = normalizeLook(look);
  if (item.slot === 'acc') {
    if (L.acc.includes(item.value)) L.acc = L.acc.filter((a) => a !== item.value);
    else L.acc = [...L.acc.filter((a) => ACC_SPOT[a] !== ACC_SPOT[item.value]), item.value];
    return normalizeLook(L);
  }
  if (item.slot === 'boat') L.boat = item.color;
  else L[item.slot] = item.value;
  return L;
}

export function boatPaint(look) {
  const hex = normalizeLook(look).boat;
  const w = WARDROBE.find((q) => q.slot === 'boat' && q.color.toLowerCase() === hex.toLowerCase());
  return { hull: hex, trim: w?.trim || '#f2e6c8', name: w?.name || 'Custom' };
}

function skinOf(L) {
  if (SKINS[L.skin]) return SKINS[L.skin];
  const [h, s, l] = hexToHsl(L.skin);
  return { skin: L.skin, belly: hslToHex(h + 10, s * 0.6, Math.min(0.92, l + 0.35)), fin: hslToHex(h + 160, 0.85, 0.62), lips: '#ff7f8f', spot: shade(L.skin, -0.3), gill: '#ec4a62' };
}

const lookKey = (L) => [L.skin, L.eyes, L.mouth, L.hat, L.outfit, L.boots, L.gloves, L.acc.join('+'), L.rod].join('|');

// ====================================================================== small 3D math (3x3 + translation)

const DEG = Math.PI / 180;
function rot(rx = 0, ry = 0, rz = 0) {
  const a = rx * DEG, b = ry * DEG, c = rz * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // Ry * Rx * Rz
  const Rz = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  const Rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  const Ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  return m3(Ry, m3(Rx, Rz));
}
function m3(A, B) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return o;
}
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const M = (R = I3, t = [0, 0, 0]) => ({ R, t });
const mv = (R, p) => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
const mul = (A, B) => ({ R: m3(A.R, B.R), t: add(mv(A.R, B.t), A.t) });
const ap = (A, p) => add(mv(A.R, p), A.t);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const Tr = (x, y, z) => M(I3, [x, y, z]);
const Ro = (r) => M(rot(r[0], r[1], r[2]));

// Rotation whose local +y maps to `dir`, local +z as close as possible to `hint`.
function alignY(dir, hint) {
  const Y = norm(dir);
  let Z = sub(hint, scl(Y, dot(hint, Y)));
  if (Math.hypot(...Z) < 1e-3) Z = Math.abs(Y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  Z = norm(sub(Z, scl(Y, dot(Z, Y))));
  const X = cross(Y, Z);
  return [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
}

// ====================================================================== voxel helpers

function shape(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
  }
}
// Torus around an axis with optional per-axis stretch of the ring.
function torus(m, cx, cy, cz, R, r, c, axis = 'z', sx = 1, sy = 1) {
  const e = (R + r + 1) * Math.max(sx, sy);
  shape(m, cx - e, cy - e, cz - e, cx + e, cy + e, cz + e, (x, y, z) => {
    let a, b, h;
    if (axis === 'z') { a = (x - cx) / sx; b = (y - cy) / sy; h = z - cz; } else if (axis === 'y') { a = (x - cx) / sx; b = (z - cz) / sy; h = y - cy; } else { a = (y - cy) / sx; b = (z - cz) / sy; h = x - cx; }
    const q = Math.hypot(a, b) - R;
    return q * q + h * h <= r * r;
  }, c);
}
// Highest solid z at column (x, y) (front surface), -1 if none.
function frontZ(m, x, y) {
  for (let z = m.nz - 1; z >= 0; z--) if (m.get(x, y, z)) return z;
  return -1;
}
const hsh = (x, y, z, s) => hash3(x, y, z, s);

// ====================================================================== kit (per look: palette + lazily built parts)

const EYE_RAMP = ['#7a7488', '#a8a6b8', '#ccccd8', '#ececf0', '#fafaf8', '#ffffff', '#ffffff'];
const KITS = new Map();
function kitFor(look) {
  const key = lookKey(look);
  let k = KITS.get(key);
  if (k) { KITS.delete(key); KITS.set(key, k); return k; }
  k = makeKit(look, key);
  KITS.set(key, k);
  if (KITS.size > 40) KITS.delete(KITS.keys().next().value);
  return k;
}

function makeKit(L, key) {
  const holder = new VoxelModel(1, 1, 1);
  const memo = new Map();
  const kit = {
    key, look: L, pal: holder.palette, parts: new Map(), sk: skinOf(L), outfit: OUTFITS[L.outfit],
    col(hex, opts = {}) {
      const k = hex + '|' + JSON.stringify(opts);
      let i = memo.get(k);
      if (i === undefined) { i = holder.color(hex, { jitter: 0.07, ...opts }); memo.set(k, i); }
      return i;
    },
    part(name, build) {
      let p = this.parts.get(name);
      if (!p) { p = build(); p.b = p.m.bounds(); this.parts.set(name, p); }
      return p;
    },
    model(nx, ny, nz) { const m = new VoxelModel(nx, ny, nz); m.palette = this.pal; return m; },
  };
  const s = kit.sk;
  const shiny = s.shiny ? { spec: 1.4, specPow: 10 } : {};
  kit.c = {
    skin: kit.col(s.skin, { smooth: 0.7, jitter: 0.03, edge: 0.15, aoMul: 0.55, ...shiny }),
    skinD: kit.col(shade(s.skin, -0.12), { smooth: 0.7, jitter: 0.03, edge: 0.15, aoMul: 0.55, ...shiny }),
    belly: kit.col(s.belly, { smooth: 0.9, jitter: 0.02, edge: 0, aoMul: 0.4, ...shiny }),
    spot: kit.col(s.spot, { smooth: 0.5, jitter: 0.03 }),
    fin: kit.col(s.fin, { smooth: 0.2, jitter: 0.04 }),
    finD: kit.col(shade(s.fin, -0.32), { jitter: 0.03 }),
    lips: kit.col(s.lips, { smooth: 0.7, spec: 0.8, specPow: 14 }),
    lipsD: kit.col(shade(s.lips, -0.25), { smooth: 0.5 }),
    gill: kit.col(s.gill, { jitter: 0.04 }),
    gillLine: kit.col(shade(s.skin, -0.45), { jitter: 0.02 }),
    blush: kit.col(mix(s.lips, '#ffe0e6', 0.45), { smooth: 0.3, light: 0.3, jitter: 0 }),
    mouthIn: kit.col('#4a1a34', { jitter: 0.02 }),
    tongue: kit.col('#ff6a8e', { smooth: 0.7, spec: 0.5 }),
    teeth: kit.col('#fffaf0', { jitter: 0.02, light: 0.3 }),
    eyeL: kit.col('#f6faff', { smooth: 1, spec: 1.1, specPow: 10, jitter: 0, aoMul: 0.5, light: 0.45, edge: 0, ramp: EYE_RAMP, eye: 1 }),
    eyeR: kit.col('#f6faff', { smooth: 1, spec: 1.1, specPow: 10, jitter: 0, aoMul: 0.5, light: 0.45, edge: 0, ramp: EYE_RAMP, eye: 2 }),
    nostril: kit.col(shade(s.skin, -0.6), { jitter: 0 }),
    // hands get their own entries so the 'hold' pose can redraw them in front of the fish
    hand: kit.col(s.skin, { smooth: 0.5, hand: 1, ...shiny }),
    handD: kit.col(shade(s.skin, -0.18), { smooth: 0.4, hand: 1 }),
    web: kit.col(s.fin, { hand: 1, jitter: 0.03 }),
  };
  kit.handSet = new Set([kit.c.hand, kit.c.handD, kit.c.web]);
  return kit;
}
// Hand-layer colour (kept in kit.handSet).
function handCol(kit, hex, opts = {}) {
  const i = kit.col(hex, { ...opts, hand: 1 });
  kit.handSet.add(i);
  return i;
}

// ---------------------------------------------------------------------- head (pivot = neck)

const HEAD = { nx: 32, ny: 30, nz: 34, cx: 16, cz: 15, pivot: [16, 1, 15], eyeY: 16.4, eyeX: 6.3, eyeZ: 22.6 };
function headInside(x, y, z) {
  const dx = x - 16, dz = z - 15;
  if (y < 1) return false;
  const a = (dx / 12) ** 2 + ((y - 13) / 11.6) ** 2 + (dz / 11) ** 2;
  const b = (dx / 12.9) ** 2 + ((y - 8.6) / 7.6) ** 2 + ((z - 16) / 10.4) ** 2;
  const c = (dx / 8.2) ** 2 + ((y - 7.6) / 5.9) ** 2 + ((z - 21.6) / 5.1) ** 2;
  return a <= 1 || b <= 1 || c <= 1;
}
// Snout front surface z for a given dx (follows the curve so lips hug it).
const snoutZ = (dx, y) => 21.6 + 5.1 * Math.sqrt(Math.max(0, 1 - (dx / 8.2) ** 2 - ((y - 7.6) / 5.9) ** 2));

function buildHead(kit, mouth, gill) {
  const L = kit.look, C = kit.c;
  const m = kit.model(HEAD.nx, HEAD.ny, HEAD.nz);
  shape(m, 2, 0, 2, 30, 27, 30, headInside, C.skin);
  // countershading: darker crown/back, pale belly on the chin and throat (clean wavy boundaries)
  m.recolor((x, y, z) => {
    const yy = y + 0.5, zz = z + 0.5, dx = x + 0.5 - 16;
    const bellyLine = 9.2 + (zz - 16) * 0.2 + Math.sin(dx * 0.55) * 0.45;
    if (yy < bellyLine && zz > 9.5) return C.belly;
    if (yy > 15.5 - (15 - zz) * 0.32 + Math.sin(dx * 0.4 + zz * 0.3) * 0.5 && zz < 19.5) return C.skinD;
    return null;
  });
  // a handful of round trout spots on the crown and the back of the head
  const spots = [[-7.5, 19, 9], [6.8, 20, 8], [-2.5, 22.6, 7.5], [3.2, 18, 4.2], [-9.6, 15, 6.5], [9.8, 14.6, 7], [0.6, 23.4, 11.6], [-5, 13.4, 3.6], [5.4, 23, 13], [-6.2, 22.4, 14.6]];
  for (const [sx0, sy0, sz0] of spots) {
    const rr = 1.25 + hsh(sx0, sy0, sz0, 2) * 0.5;
    m.recolor((x, y, z, p) => ((p === C.skin || p === C.skinD) && Math.hypot(x + 0.5 - 16 - sx0, y + 0.5 - sy0, z + 0.5 - sz0) < rr + 1 && m.exposed(x, y, z) && Math.hypot(x + 0.5 - 16 - sx0, (y + 0.5 - sy0) * 1.2, z + 0.5 - sz0) < rr + 0.6 ? C.spot : null));
  }
  // cheek blush
  for (const sx of [-1, 1]) {
    const bx = 16 + sx * 9.6;
    m.recolor((x, y, z, p) => (p !== C.skin && p !== C.belly ? null : Math.hypot(x + 0.5 - bx, (y + 0.5 - 11.2) * 1.5, z + 0.5 - 21.6) < 1.7 && m.exposed(x, y, z) ? C.blush : null));
  }
  gills(m, kit, gill);
  dorsalFin(m, kit);
  sideFins(m, kit);
  eyes(m, kit);
  mouthShape(m, kit, mouth);
  // nostrils above the lips
  for (const sx of [-1, 1]) {
    const nx = Math.floor(16 + sx * 2.1 - 0.5), ny = 11;
    const z = frontZ(m, nx, ny);
    if (z > 0) { m.set(nx, ny, z, 0); m.set(nx, ny, z - 1, C.nostril); }
  }
  headAcc(m, kit);
  const top = [16, 25.6, 14];
  return { m, pivot: HEAD.pivot, anchors: { top, mouth: [16, 7.4, 27.5], eyeL: [16 + HEAD.eyeX, HEAD.eyeY, HEAD.eyeZ], eyeR: [16 - HEAD.eyeX, HEAD.eyeY, HEAD.eyeZ] }, eyeR: L.eyes === 'googly' ? 5.6 : 5.1 };
}

function eyes(m, kit) {
  const C = kit.c, L = kit.look;
  const r = L.eyes === 'googly' ? 5.6 : 5.1;
  for (const sx of [1, -1]) {
    const ex = 16 + sx * HEAD.eyeX, ey = HEAD.eyeY, ez = HEAD.eyeZ;
    // fleshy socket rim, then the glossy eyeball bulging out of it
    m.sphere(ex + sx * 0.2, ey + 0.35, ez - 2.2, r + 0.8, C.skin);
    m.sphere(ex, ey, ez, r, sx > 0 ? C.eyeL : C.eyeR);
    if (L.eyes === 'googly') {
      const rim = kit.col('#2a2a36', { jitter: 0 });
      m.paint(() => torus(m, ex, ey, ez - 1.6, r - 0.2, 0.75, rim, 'z'));
    }
  }
}

function gills(m, kit, open) {
  const C = kit.c;
  const ops = [];
  for (const sx of [-1, 1]) {
    // operculum edge: one clean arc (convex toward the back) on each cheek behind the eyes;
    // breathing opens a red slit just behind it
    const gy = 8.6, gz = 20.4;
    for (let y = 2; y < 16; y++) for (let z = 8; z < 17; z++) for (let x = 0; x < m.nx; x++) {
      const v = m.get(x, y, z);
      if (!v || m.get(x + sx, y, z)) continue;
      if ((x + 0.5 - 16) * sx < 5) continue;
      const d = Math.hypot(y + 0.5 - gy, (z + 0.5 - gz) * 0.92);
      if (z + 0.5 > 16.2) continue;
      if (d > 7.6 && d < 8.6) ops.push([x, y, z, C.gillLine]);
      else if (open && d >= 8.6 && d < 9.6 && y > 3 && y < 14) ops.push([x, y, z, C.gill]);
    }
  }
  for (const [x, y, z, c] of ops) m.set(x, y, z, c);
}

// Spiky dorsal crest: from the crown down the back of the head (pokes out under most hat brims).
function dorsalFin(m, kit) {
  const C = kit.c;
  // walk the head's mid-line outline (crown -> back) and grow fin rays outward along the normal
  const cyH = 13, czH = 15, ry = 11.6, rz = 11;
  const ops = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = lerp(0.12, 1.42, i / N); // angle from the top (0) toward the back (pi/2)
    const sy = cyH + Math.cos(a) * ry, sz = czH - Math.sin(a) * rz;
    const ny = Math.cos(a) / ry, nz = -Math.sin(a) / rz;
    const nl = Math.hypot(ny, nz);
    const u = i / N;
    // three scalloped lobes with spiny tips, tallest in the middle
    const lobe = Math.abs(Math.sin(u * Math.PI * 3.5));
    const h = (2.2 + 3.4 * lobe) * (0.65 + 0.55 * Math.sin(u * Math.PI));
    for (let k = -0.5; k <= h; k += 0.5) {
      const y = sy + (ny / nl) * k, z = sz + (nz / nl) * k;
      const tipRay = lobe > 0.86 && k > h - 2.4;
      for (const x of [15, 16]) ops.push([x, Math.floor(y), Math.floor(z), tipRay || k > h - 0.6 ? C.finD : C.fin]);
    }
  }
  for (const [x, y, z, c] of ops) if (!m.get(x, y, z) || m.get(x, y, z) === C.fin) m.set(x, y, z, c);
}

// Tiny pectoral "ear" fins behind the gills (a fan plate hugging the cheek surface).
function sideFins(m, kit) {
  const C = kit.c;
  const ops = [];
  for (const sx of [-1, 1]) {
    for (let y = 3; y <= 12; y++) for (let z = 3; z <= 14; z++) {
      const dy = y + 0.5 - 7.4, dz = z + 0.5 - 12.6;
      const r = Math.hypot(dy, dz), ang = Math.atan2(dy, -dz);
      if (dz > -0.5 || r > 5.4 || Math.abs(ang) > 0.95) continue;
      // outermost solid voxel on this side
      let xs = -1;
      if (sx > 0) { for (let x = m.nx - 1; x >= 16; x--) if (m.get(x, y, z)) { xs = x; break; } } else { for (let x = 0; x < 16; x++) if (m.get(x, y, z)) { xs = x; break; } }
      if (xs < 0) continue;
      const c = (Math.round(ang * 4.5) & 1) ? C.fin : C.finD;
      ops.push([xs + sx, y, z, c]);
      if (r < 3.2) ops.push([xs + 2 * sx, y, z, c]);
    }
  }
  for (const [x, y, z, c] of ops) if (!m.get(x, y, z)) m.set(x, y, z, c);
}

// Lips + mouth: style from the look, state from the pose ('rest' | 'open' | 'grin' | 'grit' | 'frown').
function mouthShape(m, kit, state) {
  const C = kit.c, style = kit.look.mouth;
  const cy = 7.4;
  const zAt = (dx, y) => snoutZ(dx, y) - 0.6;
  const ring = (ox, oy, rx, ry, thick, push = 0) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * TAU;
      const dx = ox + Math.cos(a) * rx, y = cy + oy + Math.sin(a) * ry;
      pts.push([16 + dx, y, zAt(dx, y) + push, thick]);
    }
    m.tube(pts, C.lips, 2);
  };
  // carve the opening through the lips into the snout and darken its back wall; returns the front plane z
  const hole = (ox, oy, rx, ry, depth = 3) => {
    const z0 = zAt(ox, cy + oy) + 1.4;
    const bx0 = 16 + ox - rx - 2, bx1 = 16 + ox + rx + 2, by0 = cy + oy - ry - 2, by1 = cy + oy + ry + 2;
    const ell = (x, y, k) => ((x - 16 - ox) / (rx + k)) ** 2 + ((y - cy - oy) / (ry + k)) ** 2 <= 1;
    m.sub(() => shape(m, bx0, by0, z0 - depth, bx1, by1, z0 + 4, (x, y, z) => ell(x, y, 0) && z > z0 - depth, 1));
    m.paint(() => shape(m, bx0, by0, z0 - depth - 2, bx1, by1, z0 + 1, (x, y, z) => ell(x, y, 0.7) && z < z0 - depth + 1.6, C.mouthIn));
    return z0;
  };
  const arcLip = (y0, curve, halfW, thick, c, push = 0) => {
    const pts = [];
    for (let i = -6; i <= 6; i++) {
      const dx = (i / 6) * halfW, y = y0 + curve * (dx / halfW) ** 2;
      pts.push([16 + dx, y, zAt(dx, y) + push, thick]);
    }
    m.tube(pts, c, 2);
  };
  const teethRow = (y, halfW, z) => {
    for (let x = Math.round(16 - halfW); x < Math.round(16 + halfW); x++) { m.set(x, y, Math.round(z), C.teeth); m.set(x, y, Math.round(z) - 1, C.teeth); }
  };
  let st = state;
  if (st === 'rest') st = style;
  if (st === 'grin' || (st === 'open' && style === 'grin')) {
    const open = state === 'open' || state === 'grin' ? 2.2 : 1.4;
    const zf = hole(0, -0.2, 4.4, open, 3);
    arcLip(cy + open + 0.2, 0.9, 5.6, 1.05, C.lips);
    arcLip(cy - open - 0.6, 1.9, 5.0, 1.2, C.lips);
    teethRow(Math.floor(cy + open - 0.6), 3.4, zf - 2.2);
    m.ellipsoid(16, cy - open + 0.4, zf - 2.6, 2.4, 1, 1.4, C.tongue);
  } else if (st === 'open') {
    ring(0, -0.4, 3.4, 2.9, 1.45, 0.3);
    const zf = hole(0, -0.4, 2.7, 2.2, 4);
    m.ellipsoid(16, cy - 2.2, zf - 3, 2.2, 1.2, 1.8, C.tongue);
    if (style === 'buck') { m.box(15, cy + 0.6, zf - 2.4, 15, cy + 1.6, zf - 1.4, C.teeth); m.box(17, cy + 0.6, zf - 2.4, 17, cy + 1.6, zf - 1.4, C.teeth); }
  } else if (st === 'grit') {
    const zf = hole(0, 0, 4.2, 1.6, 2);
    arcLip(cy + 1.9, -0.3, 5.2, 1.1, C.lips);
    arcLip(cy - 1.9, 0.2, 5.0, 1.15, C.lips);
    for (let x = 12; x <= 19; x++) { const zt = Math.round(zf - 2); m.set(x, Math.floor(cy + 0.4), zt, C.teeth); m.set(x, Math.floor(cy - 0.6), zt, x === 13 || x === 16 || x === 19 ? C.mouthIn : C.teeth); }
  } else if (st === 'frown') {
    hole(0, -0.4, 2.8, 0.7, 2);
    arcLip(cy + 0.8, -1.4, 4.2, 1.15, C.lips);
    arcLip(cy - 1.4, -1.8, 3.8, 1.1, C.lips);
  } else if (st === 'buck') {
    arcLip(cy + 0.9, 0.5, 4.8, 1.2, C.lips);
    arcLip(cy - 0.9, 0.9, 4.2, 1.15, C.lipsD);
    const zf = zAt(0, cy);
    m.box(14.6, cy - 2.4, zf + 0.6, 15.6, cy + 0.6, zf + 1.6, C.teeth);
    m.box(16.4, cy - 2.4, zf + 0.6, 17.4, cy + 0.6, zf + 1.6, C.teeth);
  } else if (st === 'tongue') {
    ring(0.4, -0.2, 2.5, 1.9, 1.4, 0.4);
    const zf = hole(0.4, -0.2, 1.7, 1.1, 3);
    m.tube([[16.4, cy - 0.6, zf - 2.6, 1.1], [15.8, cy - 1.6, zf - 0.2, 1.2], [14.8, cy - 3.6, zf + 1.2, 1.15], [14.4, cy - 4.8, zf + 1, 1]], C.tongue, 3);
  } else if (st === 'whistle') {
    ring(2.2, -0.4, 1.55, 1.35, 1.2, 0.9);
    hole(2.2, -0.4, 0.75, 0.6, 2);
    arcLip(cy - 0.4, 0.2, 3.2, 0.8, C.lipsD, -0.2);
  } else if (st === 'smooch') {
    ring(0, 0.6, 2.2, 1.0, 1.5, 1.1);
    ring(0, -1.6, 2.4, 1.0, 1.55, 1.2);
    hole(0, -0.5, 0.9, 0.5, 2);
  } else {
    // pout: the classic round fish "O"
    ring(0, -0.3, 2.65, 2.15, 1.55, 0.35);
    hole(0, -0.3, 1.75, 1.2, 3);
  }
}

// Head-mounted accessories (built into the head so they follow every nod).
function headAcc(m, kit) {
  const L = kit.look, C = kit.c;
  const has = (a) => L.acc.includes(a);
  const ey = HEAD.eyeY, ez = HEAD.eyeZ, ex = HEAD.eyeX;
  const r = L.eyes === 'googly' ? 5.6 : 5.1;
  if (has('sunglasses')) {
    const frame = kit.col('#1c1c26', { jitter: 0 });
    const lens = kit.col('#2a3c6a', { jitter: 0, spec: 2.2, specPow: 6, smooth: 0.4 });
    const glint = kit.col('#bfe0ff', { emissive: 0.3, jitter: 0 });
    for (const sx of [-1, 1]) {
      const cx = 16 + sx * ex;
      m.box(cx - 4.4, ey - 3, ez + r - 1, cx + 4.4, ey + 2.6, ez + r + 0.2, frame);
      m.box(cx - 3.4, ey - 2, ez + r - 1, cx + 3.4, ey + 1.6, ez + r + 0.6, lens);
      m.set(Math.floor(cx - 2), Math.floor(ey + 1), Math.floor(ez + r + 0.6), glint);
      m.set(Math.floor(cx - 1), Math.floor(ey + 1), Math.floor(ez + r + 0.6), glint);
      // arms back to the gills
      m.line(cx + sx * 4.4, ey + 1.6, ez + r - 1, 16 + sx * 12.2, ey + 1, 13, frame, 0.55);
    }
    m.box(14.6, ey + 0.6, ez + r - 0.6, 17.4, ey + 1.6, ez + r, frame);
  }
  if (has('snorkel')) {
    const strap = kit.col('#1e2a3a', { jitter: 0.03 }), rim = kit.col('#ff8a1a', { jitter: 0.03, smooth: 0.3 }), tube = kit.col('#2a8ae8', { smooth: 0.4 });
    for (const sx of [-1, 1]) torus(m, 16 + sx * ex, ey, ez + r - 1.6, r + 0.3, 0.85, rim, 'z');
    m.box(14, ey - 1, ez + r - 1.6, 18, ey + 1, ez + r - 0.8, rim);
    // strap around the head
    shape(m, 2, ey - 1, 2, 30, ey + 1.6, 26, (x, y, z) => {
      const dx = x - 16, dz = z - 15;
      const d = (dx / 12.6) ** 2 + (dz / 11.6) ** 2;
      return d > 0.82 && d < 1.12 && z < 20;
    }, strap);
    m.tube([[16 - 13, ey - 2, 16, 1.1], [16 - 14.2, ey + 3, 14, 1.1], [16 - 14, ey + 9, 13, 1.1], [16 - 13, ey + 12, 13.5, 1.2]], tube, 3);
    m.sphere(16 - 13, ey + 12.4, 13.6, 1.5, rim);
  }
  if (has('monocle')) {
    const gold = kit.col('#f2c23a', { jitter: 0, spec: 1.2 }), glass = kit.col('#d8f0ff', { jitter: 0, spec: 2, specPow: 8, light: 0.3 });
    torus(m, 16 + ex, ey, ez + r - 0.4, r - 0.6, 0.75, gold, 'z');
    void glass;
    m.line(16 + ex + r - 0.8, ey - 1.5, ez + r - 0.6, 16 + ex + 6.2, ey - 7, ez + 0.4, gold, 0.4);
    m.line(16 + ex + 6.2, ey - 7, ez + 0.4, 16 + ex + 6.6, ey - 11, ez - 2, gold, 0.4);
  }
  if (has('mustache')) {
    const hair = kit.col('#5a321c', { jitter: 0.08, smooth: 0.3 }), hairL = kit.col('#7a4a28', { jitter: 0.08, smooth: 0.3 });
    for (const sx of [-1, 1]) {
      const pts = [[16 + sx * 0.4, 10.6, 0, 1.25], [16 + sx * 2.6, 10.3, 0, 1.35], [16 + sx * 4.6, 9.6, 0, 1.15], [16 + sx * 6.2, 10.3, 0, 0.9], [16 + sx * 6.9, 11.8, 0, 0.75]];
      for (const p of pts) p[2] = snoutZ(p[0] - 16, p[1]) + 0.4 - Math.max(0, Math.abs(p[0] - 16) - 3) * 0.55;
      m.tube(pts, (x) => (Math.abs(x + 0.5 - 16) < 3 ? hairL : hair), 3);
    }
  }
  if (has('earring')) {
    const gold = kit.col('#f6c83a', { jitter: 0, spec: 1.6, specPow: 8 });
    torus(m, 16 + 13.2, 4.2, 12.8, 1.7, 0.55, gold, 'x');
  }
}

// ---------------------------------------------------------------------- hats (pivot = seat on the crown)

const HAT_SEAT = [16, 23.2, 13.6];
const HAT_TILT = { bucket: -12, captain: -13, propeller: -6, cowboy: -12, crown: -6, chef: -8, viking: -5, cone: -10, souwester: -2, party: -14 };

function buildHat(kit, spin) {
  const id = kit.look.hat;
  if (id === 'none') return null;
  const m = kit.model(36, 30, 36);
  const cx = 18, cz = 18, by = 4; // seat at (18, 4, 18)
  const K = (hex, o = {}) => kit.col(hex, o);
  const domeR = (y) => 9.6 * Math.sqrt(Math.max(0, 1 - ((y - by) / 7.5) ** 2));
  if (id === 'bucket') {
    const cloth = K('#b9ab78', { smooth: 0.35, jitter: 0.1 }), dark = K('#8f8256', { smooth: 0.3 }), band = K('#6a5434', { jitter: 0.05 });
    m.cone(cx, cz, by - 0.5, by + 6, 9.6, 8.2, cloth);
    m.ellipsoid(cx, by + 6, cz, 8.2, 2.2, 8.2, cloth);
    shape(m, cx - 14, by - 3, cz - 14, cx + 14, by + 1, cz + 14, (x, y, z) => {
      const r = Math.hypot(x - cx, z - cz);
      if (r > 13.4 || r < 8) return false;
      const yy = by + 0.3 - (r - 8) * 0.42;
      return y >= yy - 1 && y <= yy + 0.4;
    }, dark);
    m.paint(() => m.cone(cx, cz, by + 0.4, by + 1.6, 10, 10, band));
    // stitched rings on the brim
    m.recolor((x, y, z, p) => (p === dark && Math.abs(Math.hypot(x + 0.5 - cx, z + 0.5 - cz) - 11.5) < 0.45 ? cloth : null));
    // lucky lures pinned to the side: a red/white spoon + a yellow fly
    const red = K('#e8403a', { jitter: 0.02, spec: 0.8 }), white = K('#f4f4f0', { jitter: 0.02 }), hook = K('#c8ccd8', { jitter: 0, spec: 1 }), yel = K('#ffd23a', { jitter: 0.03 }), feather = K('#3ac8a0', { jitter: 0.05 });
    m.box(cx + 8.6, by + 2, cz + 1, cx + 9.6, by + 4, cz + 2, red);
    m.box(cx + 8.6, by + 4, cz + 1, cx + 9.6, by + 5, cz + 2, white);
    m.set(cx + 9, by + 1, cz + 2, hook); m.set(cx + 9, by + 0, cz + 3, hook);
    m.box(cx - 6, by + 3, cz + 6.4, cx - 5, by + 4, cz + 7.4, yel);
    m.line(cx - 5, by + 4, cz + 7, cx - 3, by + 6.5, cz + 7, feather, 0.5);
  } else if (id === 'captain') {
    const white = K('#f4f4f0', { smooth: 0.4, jitter: 0.04 }), navy = K('#1a2a4e', { jitter: 0.04 }), visor = K('#14141e', { spec: 1.6, specPow: 8, jitter: 0 }), gold = K('#f2c43a', { spec: 1.2, jitter: 0 });
    m.cone(cx, cz, by - 0.5, by + 3, 9.5, 9.5, navy);
    m.cone(cx, cz, by + 3, by + 6.6, 9.8, 11.2, white);
    m.ellipsoid(cx, by + 6.6, cz, 11.2, 1.4, 11.2, white);
    m.paint(() => m.cone(cx, cz, by + 2.6, by + 3.2, 11, 11, gold));
    // visor
    shape(m, cx - 8, by - 2, cz, cx + 8, by + 1, cz + 15, (x, y, z) => {
      const dx = x - cx, dz = z - cz;
      const r = Math.hypot(dx / 1.05, dz);
      return dz > 4 && r < 13.6 && r > 8 && y >= by - 1 - (r - 8) * 0.2 && y <= by + 0.2 - (r - 8) * 0.2;
    }, visor);
    // anchor badge
    const g = ['.#.', '###', '.#.', '.#.', '#.#', '.#.'];
    for (let ry = 0; ry < 6; ry++) for (let rx = 0; rx < 3; rx++) { const zz = frontZ(m, cx - 1 + rx, by + 8 - ry); if (g[ry][rx] === '#' && zz > 0) m.set(cx - 1 + rx, by + 8 - ry, zz + 1, gold); }
  } else if (id === 'propeller') {
    const cols = ['#e8403a', '#ffd23a', '#3ac84a', '#3a8ae8'].map((h) => K(h, { smooth: 0.45, jitter: 0.05 }));
    shape(m, cx - 10, by - 1, cz - 10, cx + 10, by + 8, cz + 10, (x, y, z) => y >= by - 0.8 && Math.hypot(x - cx, z - cz) <= domeR(y) + 0.2, (x, y, z) => cols[((Math.atan2(z + 0.5 - cz, x + 0.5 - cx) / TAU + 1.125) * 4 | 0) % 4]);
    const rim = K('#f4f4f0', { jitter: 0.03 });
    m.paint(() => m.cone(cx, cz, by - 1, by + 0.4, 10, 10, rim));
    const stem = K('#9aa0b0', { jitter: 0, spec: 1 }), bladeA = K('#e8403a', { jitter: 0 }), bladeB = K('#3a8ae8', { jitter: 0 });
    m.cylinder(cx, cz, by + 7, by + 9.5, 0.7, stem);
    m.sphere(cx, by + 10, cz, 1.2, K('#ffd23a', { jitter: 0, spec: 1 }));
    const a0 = spin * Math.PI / 4;
    for (let k = 0; k < 2; k++) {
      const a = a0 + k * Math.PI;
      for (let s = 1.2; s <= 7; s += 0.5) {
        const w = 1.3 * Math.sin((s / 7) * Math.PI) + 0.4;
        const px = cx + Math.cos(a) * s, pz = cz + Math.sin(a) * s;
        m.line(px - Math.sin(a) * w, by + 10 + (k ? 0.4 : -0.4), pz + Math.cos(a) * w, px + Math.sin(a) * w, by + 10 + (k ? -0.4 : 0.4), pz - Math.cos(a) * w, k ? bladeB : bladeA, 0.45);
      }
    }
  } else if (id === 'cowboy') {
    const felt = K('#8a5a32', { smooth: 0.35, jitter: 0.06 }), dark = K('#6a4024', { smooth: 0.3 }), band = K('#2e1e14', { jitter: 0.03 }), concho = K('#dadde8', { spec: 1.4, jitter: 0 });
    shape(m, cx - 9, by - 1, cz - 10, cx + 9, by + 9, cz + 10, (x, y, z) => {
      const dx = x - cx, dz = z - cz, yy = y - by;
      if (yy < -0.6 || yy > 8.4) return false;
      const r = 8.6 - yy * 0.25;
      if ((dx / r) ** 2 + (dz / (r * 1.08)) ** 2 > 1) return false;
      // pinched crown with a centre crease
      if (yy > 6.6 && Math.abs(dx) < 1.4) return false;
      if (yy > 7.4 && Math.abs(dz) > 5) return false;
      return true;
    }, felt);
    m.paint(() => m.cone(cx, cz, by + 0.2, by + 1.6, 10, 10, band));
    shape(m, cx - 17, by - 3, cz - 16, cx + 17, by + 5, cz + 16, (x, y, z) => {
      const dx = x - cx, dz = z - cz;
      const r = Math.hypot(dx / 1.18, dz);
      if (r > 13.2 || r < 7.6) return false;
      const curl = (Math.abs(dx) / 15) ** 2 * 5.2; // brim curls up at the sides
      const yy = by - 0.4 + curl - (dz > 0 ? (r - 7.6) * 0.14 : 0);
      return y >= yy - 0.7 && y <= yy + 0.5;
    }, dark);
    m.set(cx, by + 1, frontZ(m, cx, by + 1) + 1, concho);
  } else if (id === 'crown') {
    const gold = K('#f2c23a', { spec: 1.5, specPow: 8, jitter: 0.04 }), goldD = K('#c8901c', { jitter: 0.03 });
    const gems = ['#e8283a', '#3a8ae8', '#3ae88a'].map((h) => K(h, { emissive: 0.35, spec: 2, jitter: 0 }));
    shape(m, cx - 8, by - 1, cz - 8, cx + 8, by + 9, cz + 8, (x, y, z) => {
      const dx = x - cx, dz = z - cz, yy = y - by, r = Math.hypot(dx, dz);
      if (r > 7.4 || r < 6.0 || yy < -0.5) return false;
      const a = Math.atan2(dz, dx);
      const spike = 3.4 + 3.6 * Math.max(0, Math.cos(a * 5));
      return yy <= spike;
    }, (x, y) => (y - by < 1.2 ? goldD : gold));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      m.sphere(cx + Math.cos(a) * 6.8, by + 7.6, cz + Math.sin(a) * 6.8, 1.15, gold);
      const gx = Math.round(cx + Math.cos(a + Math.PI / 5) * 7.4 - 0.5), gz = Math.round(cz + Math.sin(a + Math.PI / 5) * 7.4 - 0.5);
      m.box(gx, by + 2, gz, gx, by + 3, gz, gems[k % 3]);
    }
    m.ellipsoid(cx, by + 1, cz, 6, 2.6, 6, K('#a8202a', { smooth: 0.6 }));
  } else if (id === 'chef') {
    const w = K('#fafaf4', { smooth: 0.7, jitter: 0.03 }), w2 = K('#e8e8e0', { smooth: 0.6, jitter: 0.03 });
    m.cone(cx, cz, by - 0.6, by + 4, 9.6, 9.2, w2);
    const puffs = [[0, 10.5, 0, 7.6], [-4.6, 9.6, -2, 5], [4.6, 9.6, -2, 5], [0, 9.4, 4.4, 5], [0, 10, -4.4, 5], [-3, 13, 1, 4.4], [3, 13.2, -1, 4.2], [0, 14.6, 0, 4]];
    for (const [px, py, pz, r] of puffs) m.ellipsoid(cx + px, by + py, cz + pz, r, r * 0.85, r, w);
  } else if (id === 'viking') {
    const iron = K('#7e8496', { spec: 1, specPow: 12, smooth: 0.5, jitter: 0.05 }), band = K('#a87a3a', { jitter: 0.05, spec: 0.6 }), rivet = K('#dadeea', { jitter: 0, spec: 1.4 }), horn = K('#f2e6c8', { smooth: 0.6, jitter: 0.04 }), hornT = K('#b8a07a', { smooth: 0.5 });
    shape(m, cx - 11, by - 1.6, cz - 11, cx + 11, by + 9, cz + 11, (x, y, z) => y >= by - 1.4 && Math.hypot(x - cx, z - cz) <= 10.2 * Math.sqrt(Math.max(0, 1 - ((y - by + 1.4) / 9.2) ** 2)), iron);
    m.paint(() => m.cone(cx, cz, by - 1.6, by + 0.6, 11, 11, band));
    m.paint(() => m.box(cx - 0.8, by, cz - 11, cx + 0.8, by + 9, cz + 11, band));
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; const rx = Math.round(cx + Math.cos(a) * 10.3 - 0.5), rz = Math.round(cz + Math.sin(a) * 10.3 - 0.5); m.set(rx, by - 0.5 | 0, rz, rivet); }
    for (const sx of [-1, 1]) {
      const pts = [[cx + sx * 8.6, by + 3, cz, 2.2], [cx + sx * 12.6, by + 4.4, cz + 0.6, 1.9], [cx + sx * 15, by + 8, cz + 1, 1.4], [cx + sx * 15.4, by + 12, cz + 0.6, 0.9], [cx + sx * 14.2, by + 15, cz, 0.5]];
      m.tube(pts, (x, y) => (y > by + 11 ? hornT : horn), 3);
    }
  } else if (id === 'cone') {
    const orange = K('#ff6a1e', { smooth: 0.4, jitter: 0.04 }), white = K('#f8f8f4', { light: 0.3, jitter: 0.02, spec: 0.8 }), base = K('#2a2a30', { jitter: 0.04 });
    m.box(cx - 9, by - 1, cz - 9, cx + 9, by + 0.5, cz + 9, base);
    m.cone(cx, cz, by + 1, by + 16, 7.6, 1.6, (x, y) => (Math.floor((y - by - 3) / 3.2) % 2 === 0 && y - by > 3 && y - by < 13 ? white : orange));
  } else if (id === 'souwester') {
    const yel = K('#ffcc2e', { smooth: 0.45, jitter: 0.05 }), yelD = K('#e0a81a', { smooth: 0.4 });
    m.ellipsoid(cx, by + 1, cz, 9.8, 7.4, 9.8, yel);
    m.sub(() => m.box(cx - 12, by - 9, cz - 12, cx + 12, by - 1.2, cz + 12, 1));
    shape(m, cx - 13, by - 6, cz - 15, cx + 13, by + 1, cz + 13, (x, y, z) => {
      const dx = x - cx, dz = z - cz;
      const back = dz < 0 ? 1.45 : 0.95;
      const r = Math.hypot(dx, dz / back);
      if (r > 12 || r < 8.6) return false;
      const yy = by - 1 - (r - 8.6) * (dz < 0 ? 0.8 : 0.3);
      return y >= yy - 0.7 && y <= yy + 0.4;
    }, yelD);
    m.paint(() => shape(m, cx - 10, by + 7, cz - 10, cx + 10, by + 8.4, cz + 10, (x, y, z) => true, yelD));
  } else if (id === 'party') {
    const a = K('#ff5aa8', { jitter: 0.04, smooth: 0.3 }), b = K('#3ab8ff', { jitter: 0.04, smooth: 0.3 }), pom = K('#ffe23a', { smooth: 0.8, jitter: 0.1 });
    m.cone(cx, cz, by - 0.5, by + 13, 6.6, 0.8, (x, y, z) => ((Math.floor((y - by) * 0.7 + Math.atan2(z - cz, x - cx) * 1.3) % 2 + 2) % 2 ? a : b));
    m.sphere(cx, by + 14, cz, 2.2, pom);
    for (const [px, pz] of [[-1, 0], [1, 1], [0, -1]]) m.set(cx + px, by + 15 + (px & 1), cz + pz, pom);
  }
  return { m, pivot: [cx, by, cz] };
}

// ---------------------------------------------------------------------- torso (pivot = hip joint)

const TORSO = { nx: 20, ny: 22, nz: 19, cx: 10, cz: 9, hy: 4 };
function torsoInside(x, y, z) {
  const dx = x - TORSO.cx, dz = z - TORSO.cz, yy = y - TORSO.hy;
  if (yy < -2.4 || yy > 13.6) return false;
  const a = 6.4 - Math.max(0, yy - 10.6) * 1.0, bz = 4.3 - Math.max(0, yy - 11.6) * 0.7;
  const box = (Math.abs(dx) / a) ** 3 + (Math.abs(dz) / bz) ** 3 <= 1;
  const pel = (Math.abs(dx) / 6.1) ** 3 + (Math.abs(dz) / 4.2) ** 3 <= 1;
  const belly = (dx / 6.1) ** 2 + ((yy - 4) / 5.8) ** 2 + ((dz - 1.7) / 4.8) ** 2 <= 1;
  return (yy >= 1.2 ? box : pel) || belly;
}

function buildTorso(kit) {
  const L = kit.look, O = kit.outfit, C = kit.c;
  const m = kit.model(TORSO.nx, TORSO.ny, TORSO.nz);
  const { cx, cz, hy } = TORSO;
  const shirt = kit.col(O.shirt, { smooth: 0.35, jitter: 0.06 });
  const pants = kit.col(O.pants, { smooth: 0.3, jitter: 0.06 });
  shape(m, 0, 0, 0, TORSO.nx - 1, TORSO.ny - 1, TORSO.nz - 1, torsoInside, (x, y) => (y - hy < 1.4 ? pants : shirt));
  m.cylinder(cx, cz, hy + 13, hy + 15.4, 2.8, C.skin);
  const R = (fn) => m.recolor((x, y, z, p) => fn(x + 0.5 - cx, y + 0.5 - hy, z + 0.5 - cz, x, y, z, p));
  const surf = (fn) => m.recolor((x, y, z, p) => (m.exposed(x, y, z) ? fn(x + 0.5 - cx, y + 0.5 - hy, z + 0.5 - cz, x, y, z, p) : null));
  const K = (h, o = {}) => kit.col(h, { smooth: 0.3, jitter: 0.06, ...o });
  const onFront = (dx, yy, cb) => { const x = Math.floor(cx + dx), y = Math.floor(hy + yy); const z = frontZ(m, x, y); if (z > 0) cb(x, y, z); };
  const id = L.outfit;
  if (id === 'overalls') {
    const plaidA = K('#c8463a'), plaidB = K('#8a2630'), plaidC = K('#efd9b8'), denim = pants, denimD = K('#2c4f8e'), stitch = K('#f0b858', { jitter: 0 }), brass = K('#f2c84a', { spec: 1.2, jitter: 0 });
    R((dx, yy, dz, x, y) => {
      if (yy < 1.4) return null;
      const bib = dz > 0.6 && Math.abs(dx) <= 4.3 && yy < 10.4;
      const strap = Math.abs(Math.abs(dx) - 3.4) < 1.0 && yy >= 10;
      const back = dz < -0.6 && Math.abs(dx) <= 4.6 && yy < 7.4;
      if (bib || strap || back) return (bib && (Math.abs(Math.abs(dx) - 4.0) < 0.5 || Math.abs(yy - 10) < 0.5)) ? stitch : denim;
      if (yy < 2.4) return denim;
      const lx = (x % 4 === 0), ly = (y % 4 === 1);
      return lx && ly ? plaidC : lx || ly ? plaidB : plaidA;
    });
    // bib pocket
    for (let dx = -2; dx <= 1; dx++) onFront(dx, 7.6, (x, y, z) => m.set(x, y, z, stitch));
    for (const dx of [-2, 1]) for (let yy = 5; yy <= 7; yy++) onFront(dx, yy, (x, y, z) => m.set(x, y, z, denimD));
    for (const sx of [-1, 1]) onFront(sx * 3.4, 9.8, (x, y, z) => { m.set(x, y, z + 1, brass); m.set(x - (sx < 0 ? 0 : 0), y, z, brass); });
    R((dx, yy) => (Math.abs(yy - 1.6) < 0.5 ? denimD : null));
  } else if (id === 'raincoat') {
    const coat = shirt, coatD = K('#e0a81a'), toggle = K('#6a3a1a', { jitter: 0.02 }), lining = K('#2c3c5e');
    R((dx, yy) => (yy < 1.4 ? coat : null));
    // flared hem over the hips
    shape(m, 0, 0, 0, 19, hy + 1, 17, (x, y, z) => { const dx = x - cx, dz = z - cz, yy = y - hy; return yy >= -3 && yy < 1 && (Math.abs(dx) / 6.8) ** 3 + (Math.abs(dz) / 4.9) ** 3 <= 1; }, coat);
    // high collar
    m.cone(cx, cz, hy + 12.4, hy + 15.2, 4.2, 4.6, coatD);
    m.sub(() => m.cone(cx, cz + 1.5, hy + 14, hy + 16, 2, 2, 1));
    R((dx, yy, dz) => (dz > 2 && Math.abs(dx) < 0.6 && yy < 12 ? coatD : null));
    for (const yy of [2, 5.5, 9]) onFront(0.5, yy, (x, y, z) => { m.set(x, y, z + 1, toggle); m.set(x - 1, y, z + 1, toggle); });
    surf((dx, yy, dz) => (yy < -2.2 ? lining : null));
  } else if (id === 'hawaiian') {
    const flowerA = K('#ff6a8a', { jitter: 0.02 }), flowerB = K('#fff2a8', { jitter: 0.02 }), leaf = K('#127a5a', { jitter: 0.03 }), btn = K('#f4f0e0', { jitter: 0 });
    surf((dx, yy, dz, x, y, z, p) => {
      if (p !== shirt) return null;
      if (dz > 2.4 && yy > 10.2 && Math.abs(dx) < (yy - 10.2) * 1.0 + 0.6) return C.belly; // open collar
      // sparse hibiscus: a pink/yellow plus-shape every few voxels, tiny leaves between
      const gx = Math.floor((x + (y >> 2)) / 4), gy = Math.floor(y / 4), gz = Math.floor(z / 4);
      const h = hsh(gx, gy, gz, 21);
      const ox = gx * 4 - (y >> 2) + 2, oy = gy * 4 + 2;
      const fx = x - ox, fy = y - oy;
      if (h < 0.5 && Math.abs(fx) + Math.abs(fy) <= 1) return fx === 0 && fy === 0 ? flowerB : h < 0.25 ? flowerA : flowerB;
      if (h > 0.82 && fx === 1 && fy === -1) return leaf;
      return null;
    });
    for (let yy = 1.6; yy < 10; yy += 2.6) onFront(0, yy, (x, y, z) => m.set(x, y, z, btn));
  } else if (id === 'hoodie') {
    const dark = K(shade(O.shirt, -0.22)), str = K('#f2f2f2', { jitter: 0 }), rib = K(shade(O.shirt, -0.12));
    R((dx, yy) => (yy < 2.2 ? rib : null));
    // front pouch
    surf((dx, yy, dz) => (dz > 2.4 && yy > 1.8 && yy < 5.6 && Math.abs(dx) < 4.6 - (yy - 1.8) * 0.25 ? (Math.abs(yy - 5.3) < 0.5 || Math.abs(Math.abs(dx) - (4.4 - (yy - 1.8) * 0.25)) < 0.5 ? dark : null) : null));
    // bunched hood behind the neck
    m.ellipsoid(cx, hy + 13.4, cz - 3.4, 5.6, 2.8, 2.8, shirt);
    m.ellipsoid(cx, hy + 13.8, cz - 2.6, 3.6, 1.6, 1.6, dark);
    for (const sx of [-1, 1]) for (let yy = 8.5; yy <= 12; yy++) onFront(sx * 1.5, yy, (x, y, z) => m.set(x, y, z + 1, str));
  } else if (id === 'wetsuit') {
    const stripe = K('#2ad0c8', { jitter: 0.02 }), zip = K('#c8ccd8', { jitter: 0, spec: 1 });
    R((dx, yy, dz) => (Math.abs(Math.abs(dx) - 5.3) < 0.7 && yy > -1 ? stripe : null));
    for (let yy = 3; yy <= 13; yy++) onFront(0, yy, (x, y, z) => m.set(x, y, z, zip));
    m.paint(() => m.cylinder(cx, cz, hy + 13, hy + 14.4, 3.2, shirt));
    m.cylinder(cx, cz, hy + 12.6, hy + 14.2, 3.3, shirt);
  } else if (id === 'tuxedo') {
    const shirtW = K('#f6f6f2', { jitter: 0.02 }), satin = K('#3a3a4c', { spec: 1, specPow: 10 }), bow = K('#d8283a', { jitter: 0.02 }), btn = K('#1a1a20', { jitter: 0 });
    surf((dx, yy, dz) => {
      if (dz < 1.8 || yy < 1.4) return null;
      const v = (yy - 3) * 0.5;
      if (Math.abs(dx) < v) return shirtW;
      if (Math.abs(dx) < v + 1.2 && yy > 4) return satin;
      return null;
    });
    for (const yy of [5.2, 7.8]) onFront(0, yy, (x, y, z) => m.set(x, y, z, btn));
    onFront(0, 12.4, (x, y, z) => { m.box(x - 2, y - 1, z + 1, x + 2, y + 1, z + 1, bow); m.set(x, y, z + 2, bow); m.set(x - 1, y, z + 1, bow); });
    // coat tails
    for (const sx of [-1, 1]) m.box(cx + sx * 2.6 - 1.2, hy - 4.5, cz - 4.6, cx + sx * 2.6 + 1.2, hy + 1, cz - 3.4, shirt);
  } else if (id === 'astronaut') {
    const suitD = K('#c6ccda'), panel = K('#5a6078', { jitter: 0.02 }), ring = K('#a8b0c4', { spec: 1.2, jitter: 0.02 }), patch = K('#ff8a2a', { jitter: 0.02 });
    const lights = ['#ff4a4a', '#4aff8a', '#ffd84a', '#4ac8ff'].map((h) => K(h, { emissive: 0.85, jitter: 0 }));
    R((dx, yy) => (Math.abs(yy - 1.8) < 0.6 ? suitD : null));
    onFront(0, 6, (x, y, z) => {
      m.box(x - 3, y, z, x + 2, y + 3, z + 1, panel);
      for (let k = 0; k < 4; k++) m.set(x - 2 + (k % 3) + (k > 2 ? 1 : 0), y + 1 + (k > 2 ? 1 : 0), z + 2, lights[k]);
    });
    onFront(-4.2, 11, (x, y, z) => { m.box(x, y - 1, z, x + 1, y, z, patch); });
    torus(m, cx, hy + 13.8, cz, 4.4, 1.15, ring, 'y');
    m.box(cx - 4.5, hy + 2, cz - 7.2, cx + 4.5, hy + 12, cz - 4, suitD);
    m.box(cx - 3.5, hy + 10, cz - 7.6, cx - 1.5, hy + 11, cz - 7.2, lights[1]);
  } else if (id === 'pajamas') {
    const dot = K('#fff8e0', { jitter: 0.02 }), trim = K('#f6f2ff', { jitter: 0.02 }), moon = K('#ffe27a', { jitter: 0.02, light: 0.2 });
    surf((dx, yy, dz, x, y, z, p) => {
      if (Math.abs(dx) < 0.6 && dz > 2 && yy > 1.5) return trim;
      const h = hsh(x, y, z, 31);
      if (h < 0.055) return dot;
      if (h > 0.985) return moon;
      return null;
    });
    m.cone(cx, cz, hy + 12.8, hy + 13.8, 4.2, 4.2, trim);
    m.sub(() => m.cylinder(cx, cz, hy + 12.8, hy + 14, 2.9, 1));
  }
  neckAcc(m, kit);
  return { m, pivot: [cx, hy, cz] };
}

function neckAcc(m, kit) {
  const L = kit.look;
  const { cx, cz, hy } = TORSO;
  const has = (a) => L.acc.includes(a);
  const K = (h, o = {}) => kit.col(h, { smooth: 0.3, jitter: 0.05, ...o });
  if (has('bandana')) {
    const red = K('#d8283a'), dot = K('#fff4ec', { jitter: 0 });
    torus(m, cx, hy + 13.2, cz + 0.4, 3.6, 1.05, red, 'y');
    for (let yy = 0; yy < 5; yy++) {
      const y = hy + 12.6 - yy, w = 3.6 - yy * 0.75;
      for (let x = Math.round(cx - w); x <= Math.round(cx + w - 1); x++) {
        const z = frontZ(m, x, y);
        if (z > 0) m.set(x, y, z + 1, (x + yy) % 3 === 0 && yy % 2 === 0 ? dot : red);
      }
    }
  }
  if (has('bowtie')) {
    const bt = K('#2a5ad8', { spec: 0.6 }), knot = K('#1a3a9a');
    const y = hy + 12.4, z = frontZ(m, cx, Math.floor(y)) + 1;
    shape(m, cx - 4, y - 2, z - 1, cx + 4, y + 2, z + 1, (x, yy, zz) => { const dx = Math.abs(x - cx); return dx < 3.6 && Math.abs(yy - y - 0.5) <= 0.6 + dx * 0.45 && zz < z + 1; }, bt);
    m.box(cx - 1, y - 0.5, z, cx, y + 0.5, z + 0.6, knot);
  }
  if (has('scarf')) {
    const a = K('#e8403a'), b = K('#f8f4ea');
    const st = (x, y) => ((Math.floor(y) >> 1) % 2 ? a : b);
    torus(m, cx, hy + 13.3, cz, 4.2, 1.35, (x, y, z) => ((Math.floor(Math.atan2(z - cz, x - cx) * 3)) % 2 ? a : b), 'y');
    const z = frontZ(m, cx + 3, hy + 10);
    m.box(cx + 2, hy + 3, z, cx + 4, hy + 13, z + 1, st);
    m.box(cx + 2, hy + 2, z, cx + 2, hy + 2, z + 1, a); m.box(cx + 4, hy + 2, z, cx + 4, hy + 2, z + 1, a);
  }
  if (has('backpack')) {
    const bag = K('#3a8a4a'), flap = K('#2a6a38'), strap = K('#5a3a22'), roll = K('#c84a3a', { smooth: 0.5 }), buckle = K('#d8d8e0', { jitter: 0, spec: 1 });
    m.box(cx - 4.6, hy + 2, cz - 8.2, cx + 4.6, hy + 11.6, cz - 3.4, bag);
    m.box(cx - 4.6, hy + 8.6, cz - 8.6, cx + 4.6, hy + 11.8, cz - 7.6, flap);
    m.set(cx, hy + 8, cz - 9, buckle);
    m.box(cx - 3.6, hy + 2.6, cz - 9, cx + 3.6, hy + 5.4, cz - 8.2, flap);
    m.cylinder(hy + 12.8, cz - 5.8, cx - 6.2, cx + 6.2, 1.9, roll, 'x');
    for (const sx of [-1, 1]) {
      for (let y = hy + 4; y <= hy + 13; y++) { const x = Math.floor(cx + sx * 3.2); const z = frontZ(m, x, y); if (z > 0 && z > cz) m.set(x, y, z, strap); }
    }
  }
}

// ---------------------------------------------------------------------- limbs

const ARM = { upper: 4.4, fore: 5.3 };
const LEG = { thigh: 5.5 };

function buildUpper(kit) {
  const O = kit.outfit, C = kit.c;
  const m = kit.model(8, 10, 8);
  const sleeve = O.sleeve === 'none' ? C.skin : kit.col(O.arm, { smooth: 0.3, jitter: 0.06 });
  m.line(4, 7.4, 4, 4, 3.2, 4, sleeve, 2.25);
  if (O.sleeve === 'short') {
    m.paint(() => m.box(0, 0, 0, 7, 3.6, 7, C.skin));
    const cuff = kit.col(shade(O.arm, -0.18), { jitter: 0.04 });
    m.paint(() => m.box(0, 3.6, 0, 7, 4.4, 7, cuff));
    if (kit.look.outfit === 'overalls') m.recolor((x, y, z, p) => (p === sleeve && (x + y) % 4 === 0 ? kit.col('#8a2630', { smooth: 0.3, jitter: 0.06 }) : null));
    if (kit.look.outfit === 'hawaiian') m.recolor((x, y, z, p) => (p === sleeve && hsh(x, y, z, 4) < 0.18 ? kit.col('#ff6a8a', { jitter: 0.02 }) : null));
  }
  if (kit.look.outfit === 'astronaut') m.paint(() => m.box(0, 5, 0, 7, 6, 7, kit.col('#ff8a2a', { jitter: 0.02 })));
  if (kit.look.outfit === 'wetsuit') m.paint(() => m.box(0, 0, 0, 7, 9, 3.4, kit.col('#2ad0c8', { jitter: 0.02 })));
  if (kit.look.outfit === 'pajamas') m.recolor((x, y, z, p) => (hsh(x, y, z, 31) < 0.08 ? kit.col('#fff8e0', { jitter: 0.02 }) : null));
  return { m, pivot: [4, 7.4, 4] };
}

function buildFore(kit) {
  const O = kit.outfit, C = kit.c, g = kit.look.gloves;
  const m = kit.model(10, 13, 10);
  const px = 5, py = 10.6, pz = 5;
  const long = O.sleeve === 'long';
  const sleeve = long ? kit.col(O.arm, { smooth: 0.3, jitter: 0.06 }) : C.skin;
  m.line(px, py, pz, px, py - 3.8, pz, sleeve, 2.05);
  if (long) m.paint(() => m.box(0, py - 4.6, 0, 9, py - 3.6, 9, kit.col(shade(O.arm, -0.2), { jitter: 0.04 })));
  if (kit.look.outfit === 'pajamas' && long) m.recolor((x, y, z, p) => (p === sleeve && hsh(x, y, z, 31) < 0.08 ? kit.col('#fff8e0', { jitter: 0.02 }) : null));
  const hy = py - 6.0; // hand centre
  const H = (hex, o) => handCol(kit, hex, o);
  if (g === 'boxing') {
    const red = H('#e02a2a', { smooth: 0.8, spec: 1.2, specPow: 10 }), cuff = H('#f4f4f0', { smooth: 0.5 });
    m.ellipsoid(px, hy - 0.6, pz + 0.4, 3.3, 3.4, 3.3, red);
    m.ellipsoid(px, hy - 0.4, pz + 2.9, 1.3, 1.6, 1.0, red);
    m.cylinder(px, pz, hy + 1.8, hy + 3.4, 2.5, cuff);
  } else if (g === 'mittens' || g === 'oven') {
    const knit = g === 'oven' ? H('#efe4c8', { smooth: 0.5, jitter: 0.1 }) : H('#d8303a', { smooth: 0.5, jitter: 0.14 });
    const cuff = g === 'oven' ? H('#d84a3a', { jitter: 0.04 }) : H('#f6f0e6', { smooth: 0.6, jitter: 0.12 });
    m.ellipsoid(px, hy, pz + 0.3, 2.7, 2.9, 2.5, knit);
    m.ellipsoid(px, hy + 0.4, pz + 2.5, 1.0, 1.4, 1.0, knit);
    m.cylinder(px, pz, hy + 1.6, hy + 3.2, 2.45, cuff);
    if (g === 'oven') m.recolor((x, y, z, p) => (p === knit && (x + y + z) % 3 === 0 ? H('#d84a3a', { jitter: 0.04 }) : null));
  } else {
    let palm = C.hand, palmD = C.handD;
    if (g === 'rubber') { palm = H('#ffb030', { smooth: 0.7, spec: 0.9, specPow: 12 }); palmD = H('#e0901a', { smooth: 0.5 }); }
    if (g === 'fingerless') { palm = H('#2a2a32', { jitter: 0.05 }); palmD = H('#1c1c24', { jitter: 0.03 }); }
    if (g === 'gold') { palm = H('#f2c23a', { spec: 1.6, specPow: 8, smooth: 0.4 }); palmD = H('#c8901c', { spec: 0.8 }); }
    // mitten-ish fish hand: palm, three stubby fingers, thumb, webbing
    m.ellipsoid(px, hy + 0.4, pz, 2.4, 2.3, 2.2, palm);
    for (const fx of [-1.2, 0, 1.2]) m.line(px + fx, hy - 0.4, pz + 0.7, px + fx * 1.2, hy - 2.4, pz + 1.1, g === 'fingerless' ? C.hand : palmD, 0.75);
    m.line(px, hy + 0.6, pz + 1.6, px - 0.4, hy - 0.2, pz + 3, palm, 0.85);
    if (g === 'none') m.recolor((x, y, z, p) => (p === palmD && y < hy - 1.8 && hsh(x, y, z, 2) < 0.3 ? C.web : null));
    if (g === 'rubber') m.cone(px, pz, hy + 1.6, hy + 3.6, 2.4, 2.8, palm);
    if (g === 'gold') m.cylinder(px, pz, hy + 1.6, hy + 3.4, 2.5, palmD);
  }
  return { m, pivot: [px, py, pz], anchors: { grip: [px, hy, pz + 0.4] } };
}

function buildThigh(kit) {
  const O = kit.outfit, C = kit.c;
  const m = kit.model(8, 11, 8);
  const pants = kit.col(O.pants, { smooth: 0.3, jitter: 0.06 });
  m.line(4, 8.4, 4, 4, 3, 4, pants, 2.55);
  if (O.legs === 'shorts') m.paint(() => m.box(0, 0, 0, 7, 4.6, 7, C.skin));
  if (kit.look.outfit === 'astronaut') m.paint(() => m.box(0, 0, 4.6, 7, 4.4, 7, kit.col('#c6ccda')));
  if (kit.look.outfit === 'pajamas') m.recolor((x, y, z, p) => (p === pants && hsh(x, y, z, 31) < 0.08 ? kit.col('#fff8e0', { jitter: 0.02 }) : null));
  if (kit.look.outfit === 'hawaiian') m.paint(() => m.box(0, 4.6, 0, 7, 5.4, 7, kit.col('#c8b07a', { jitter: 0.04 })));
  return { m, pivot: [4, 8.4, 4] };
}

function buildShin(kit) {
  const O = kit.outfit, C = kit.c, b = kit.look.boots;
  const m = kit.model(12, 10, 20);
  const px = 6, py = 4.3, pz = 6; // knee (world ground = local y 0 when standing)
  const pants = O.legs === 'long' ? kit.col(O.pants, { smooth: 0.3, jitter: 0.06 }) : C.skin;
  m.line(px, py + 0.4, pz, px, 2.4, pz, pants, 2.4);
  const K = (h, o = {}) => kit.col(h, { jitter: 0.05, smooth: 0.35, ...o });
  if (b === 'yellow' || b === 'red') {
    const rub = b === 'yellow' ? K('#ffd23a', { spec: 0.7, specPow: 14 }) : K('#e2363a', { spec: 0.7, specPow: 14 });
    const cuff = b === 'yellow' ? K('#ffe88a') : K('#ff7a6a'), sole = K('#5a3a22', { smooth: 0 });
    m.cylinder(px, pz, 1, 4.4, 2.75, rub);
    m.cylinder(px, pz, 4, 4.8, 3.05, cuff);
    shape(m, px - 3.2, 0, pz - 3.4, px + 3.2, 2.6, pz + 5.4, (x, y, z) => ((x - px) / 3.05) ** 2 + ((z - pz - 1) / 4.4) ** 2 <= 1 && y < 2.6 - Math.max(0, z - pz - 2.6) * 0.45, rub);
    m.recolor((x, y, z, p) => (y === 0 ? sole : null));
  } else if (b === 'sneakers') {
    const white = K('#f6f6f2'), stripe = K('#3a8ae8', { jitter: 0.02 }), sole = K('#e84a3a', { smooth: 0 }), lace = K('#ffffff', { jitter: 0 });
    m.cylinder(px, pz, 1, 3, 2.6, white);
    shape(m, px - 3, 0, pz - 3.2, px + 3, 2.8, pz + 5.2, (x, y, z) => ((x - px) / 2.9) ** 2 + ((z - pz - 1) / 4.3) ** 2 <= 1 && y < 2.8 - Math.max(0, z - pz - 2.2) * 0.55, white);
    m.recolor((x, y, z, p) => (y === 0 ? sole : p === white && y === 1 && m.exposed(x, y, z) && Math.abs(x + 0.5 - px) > 2.2 ? stripe : null));
    for (let z = pz + 1; z <= pz + 3; z++) m.set(px, 3 - (z > pz + 2 ? 1 : 0), z, lace);
  } else if (b === 'flippers') {
    const fl = K('#2ab87a', { smooth: 0.4 }), flD = K('#1a8a5a'), strap = K('#1c2a2a');
    m.cylinder(px, pz, 0.8, 3.2, 2.4, strap);
    shape(m, px - 6, 0, pz - 3, px + 6, 1.4, pz + 12, (x, y, z) => { const t = (z - pz + 3) / 15; const w = 2.6 + t * 3.2; return Math.abs(x - px) < w && z - pz < 11.6 - Math.abs(x - px) * 0.25 && y < 1.4; }, (x, y, z) => ((x & 1) && z > pz + 3 ? flD : fl));
  } else if (b === 'cowboy') {
    const leather = K('#8a4e2a', { spec: 0.5 }), dark = K('#5a301a'), stitch = K('#e8c890', { jitter: 0 }), spur = K('#dadde8', { spec: 1.4, jitter: 0 });
    m.cylinder(px, pz, 1, 5, 2.7, leather);
    m.recolor((x, y, z, p) => (p === leather && y === 3 && (x + z) % 2 === 0 ? stitch : null));
    shape(m, px - 3, 0, pz - 3, px + 3, 2.6, pz + 6.4, (x, y, z) => ((x - px) / (2.8 - Math.max(0, z - pz - 2) * 0.4)) ** 2 + ((z - pz - 1.4) / 5) ** 2 <= 1 && y < 2.6 - Math.max(0, z - pz - 2) * 0.35, leather);
    m.box(px - 2, 0, pz - 3, px + 1, 1, pz - 1, dark);
    m.recolor((x, y, z, p) => (y === 0 ? dark : null));
    m.line(px, 1.6, pz - 3, px, 1.6, pz - 4.6, spur, 0.4);
    m.set(px, 2, pz - 5, spur); m.set(px, 1, pz - 5, spur);
  } else if (b === 'slippers') {
    const fluff = K('#ffb8d8', { smooth: 0.8, jitter: 0.14 }), inner = K('#ff8ab8', { smooth: 0.6 }), eye = K('#1a1420', { jitter: 0 }), nose = K('#ff5a8a', { jitter: 0 });
    m.ellipsoid(px, 1.8, pz + 1.4, 3.3, 2.2, 4.8, fluff);
    for (const sx of [-1, 1]) {
      m.line(px + sx * 1.3, 3, pz + 3, px + sx * 2, 6.6, pz + 1.8, fluff, 0.85);
      m.line(px + sx * 1.3, 3.4, pz + 3.6, px + sx * 2, 6.4, pz + 2.4, inner, 0.45);
      m.set(Math.floor(px + sx * 1.3), 3, Math.floor(pz + 5.2), eye);
    }
    m.set(px, 2, Math.floor(pz + 6.2), nose);
  } else {
    // bare webbed feet
    const toe = C.skin;
    m.cylinder(px, pz, 0.6, 2.6, 2.2, toe);
    for (const fx of [-1.6, 0, 1.6]) m.line(px + fx * 0.5, 0.8, pz + 1, px + fx, 0.8, pz + 4.6, C.skinD, 0.95);
    m.box(px - 2, 0, pz + 2, px + 2, 0, pz + 4, kit.c.fin);
  }
  return { m, pivot: [px, py, pz] };
}

// ---------------------------------------------------------------------- rod (pivot = grip, local +y = rod axis, +z = reel side)

const ROD = { len: 34 };
function buildRod(kit, bend, crank) {
  const id = kit.look.rod;
  const m = kit.model(14, 50, 30);
  const ax = 7, az = 12, gy = 7; // grip point
  const K = (h, o = {}) => kit.col(h, { jitter: 0.04, ...o });
  let shaft, shaftB, handle, reelC, tip, guide = K('#c8ccd8', { spec: 1.2, jitter: 0 });
  if (id === 'carbon') { shaft = K('#2a2c36', { spec: 1, specPow: 16 }); shaftB = K('#4a4e60', { spec: 1 }); handle = K('#1a1a1e'); reelC = K('#c8ccd8', { spec: 1.4 }); tip = K('#ff4a3a'); }
  else if (id === 'golden') { shaft = K('#f2c23a', { spec: 1.6, specPow: 8 }); shaftB = K('#ffe27a', { spec: 1.6 }); handle = K('#8a2238', { smooth: 0.4 }); reelC = K('#f2c23a', { spec: 1.6 }); tip = K('#ffffff', { emissive: 0.4 }); guide = K('#fff2a8', { spec: 1.6 }); }
  else if (id === 'neon') { shaft = K('#3affd8', { emissive: 0.9, jitter: 0 }); shaftB = K('#ff3ad8', { emissive: 0.9, jitter: 0 }); handle = K('#24243a'); reelC = K('#3a3a5a', { spec: 1 }); tip = K('#ffffff', { emissive: 1 }); }
  else if (id === 'candy') { shaft = K('#e8283a', { spec: 0.8 }); shaftB = K('#fff8f2', { spec: 0.8 }); handle = K('#2aa84a', { smooth: 0.4 }); reelC = K('#f4f4f0', { spec: 1 }); tip = K('#ffd23a'); }
  else if (id === 'laser') { shaft = K('#ff3a6a', { emissive: 1, jitter: 0 }); shaftB = K('#fff0f4', { emissive: 1, jitter: 0 }); handle = K('#c8ccd8', { spec: 1.4 }); reelC = K('#2a2a36', { spec: 1 }); tip = K('#ffffff', { emissive: 1 }); }
  else { shaft = K('#dcc27a', { spec: 0.4 }); shaftB = K('#9a7a3c'); handle = K('#c49460', { jitter: 0.12 }); reelC = K('#5a6074', { spec: 1 }); tip = K('#e8403a'); }
  const handleD = K(shade(id === 'laser' ? '#2a2a36' : '#3a2a1e', 0), {});
  // handle + butt cap + fore grip
  m.line(ax, gy - 6, az, ax, gy + 3, az, handle, 1.25);
  m.line(ax, gy - 7, az, ax, gy - 6.2, az, handleD, 1.45);
  m.line(ax, gy + 6.2, az, ax, gy + 8.4, az, handle, 1.1);
  // reel seat + reel (side-mounted spool, crank on +x)
  m.line(ax, gy + 3, az, ax, gy + 6.2, az, reelC, 0.9);
  m.line(ax, gy + 4.6, az, ax, gy + 4.6, az + 2.2, reelC, 0.6);
  m.cylinder(gy + 4.6, az + 3.6, ax - 2, ax + 1.6, 2.3, reelC, 'x');
  m.cylinder(gy + 4.6, az + 3.6, ax - 1.4, ax + 1, 1.5, K('#e8e4d8', { jitter: 0.02 }), 'x');
  const ca = (crank / 8) * TAU;
  const kx = ax + 2.6, ky = gy + 4.6 + Math.sin(ca) * 2.4, kz = az + 3.6 + Math.cos(ca) * 2.4;
  m.line(ax + 2, gy + 4.6, az + 3.6, kx, ky, kz, reelC, 0.5);
  m.line(kx, ky, kz, kx + 1.4, ky, kz, K('#1a1a22'), 0.6);
  // shaft: bends toward +z (reel side) under tension
  const L = ROD.len, base = gy + 8.4;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    pts.push([ax, base + (L - 8) * s * (1 - 0.18 * bend * s * s), az + bend * (L - 8) * 0.42 * s * s]);
  }
  const thick = id === 'laser' ? 0.95 : 0.85;
  for (let i = 0; i < pts.length - 1; i++) {
    const s = i / 24;
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
    let c = shaft;
    if (id === 'bamboo') c = i % 5 === 0 ? shaftB : shaft;
    else if (id === 'candy') c = Math.floor(i / 1.5) % 2 ? shaftB : shaft;
    else if (id === 'carbon') c = i % 6 === 0 ? shaftB : shaft;
    else if (id === 'neon') c = s > 0.8 ? shaftB : shaft;
    else if (id === 'laser') c = s < 0.85 ? shaftB : shaft;
    m.line(x0, y0, z0, x1, y1, z1, c, s < 0.45 ? thick : 0.5);
  }
  if (id === 'laser') for (let i = 0; i < pts.length - 1; i += 1) { const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1]; m.line(x0 + 0.5, y0, z0, x1 + 0.5, y1, z1, shaft, 0.5); }
  for (const s of [0.28, 0.5, 0.7, 0.87]) {
    const p = pts[Math.round(s * 24)];
    m.set(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2] + 1), guide);
  }
  const tp = pts[24];
  m.set(Math.floor(tp[0]), Math.floor(tp[1]), Math.floor(tp[2]), tip);
  m.set(Math.floor(tp[0]), Math.floor(tp[1]) - 1, Math.floor(tp[2]), tip);
  return { m, pivot: [ax, gy, az], anchors: { tip: [tp[0] + 0.5, tp[1] + 0.8, tp[2] + 0.5], knob: [kx + 0.9, ky, kz], fore: [ax, gy + 7.2, az] } };
}

// ====================================================================== poses

const HIP_Y = 10.2;
const J = { hipL: [3.1, -0.4, 0], hipR: [-3.1, -0.4, 0], knee: [0, -LEG.thigh, 0], shL: [7.3, 11.4, -0.2], shR: [-7.3, 11.4, -0.2], elbow: [0, -ARM.upper, 0], neck: [0, 13.6, -0.2] };

const BASE_POSE = {
  off: [0, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0], neck: [0, 0, 0],
  hipL: [0, 0, 2], knL: [0, 0, 0], hipR: [0, 0, -2], knR: [0, 0, 0],
  shL: [4, 0, 10], elL: [-14, 0, 0], shR: [4, 0, -10], elR: [-14, 0, 0],
  handL: null, handR: null, rod: { pitch: 55, yaw: -40, bend: 0, crank: 0 }, noRod: false,
  mouth: 'rest', gill: 0, lid: 0, squint: 0, gaze: [0, 0], wobble: 0,
};
const P = (o) => ({ ...BASE_POSE, ...o, rod: { ...BASE_POSE.rod, ...(o.rod || {}) } });
const S = Math.sin;

const POSES = {
  idle: { n: 12, dur: 4.2, loop: true, fn: (u) => {
    const b = S(u * TAU * 2), look = S(u * TAU);
    return P({ off: [0, -0.15 + 0.15 * b, 0], spine: [1.5 * b, 0, 0], neck: [-2 + 2.5 * b, 22 * look, 3 * S(u * TAU + 1)],
      handR: [-5.8, 8 + 0.3 * b, 6.2], rod: { pitch: 58 + 3 * b, yaw: -40 },
      shL: [5, 0, 9 + 2 * b], elL: [-12, 0, 0], knL: [3 + 2 * b, 0, 0], knR: [3 + 2 * b, 0, 0], gill: b > 0.55 ? 1 : 0, gaze: [0.5 * look, 0] });
  } },
  cast: { n: 8, dur: 0.75, loop: false, fn: (u, i) => {
    const K = [
      { r: 56, h: [-5.8, 8, 6.2], sp: 0, l: 10, m: 'rest' },
      { r: 92, h: [-5.4, 13, 3.4], sp: -4, l: 30, m: 'rest' },
      { r: 128, h: [-5.2, 16.5, 0.4], sp: -7, l: 45, m: 'grit' },
      { r: 150, h: [-5.2, 17.5, -1.4], sp: -9, l: 55, m: 'grit' },
      { r: 62, h: [-5.4, 15, 6.6], sp: 6, l: 20, m: 'open' },
      { r: 24, h: [-5.6, 11, 8.4], sp: 11, l: 5, m: 'open' },
      { r: 20, h: [-5.8, 10, 7.8], sp: 9, l: 8, m: 'rest' },
      { r: 26, h: [-5.8, 9, 7], sp: 6, l: 10, m: 'rest' },
    ][i];
    return P({ spine: [K.sp, -K.sp * 0.8, 0], hips: [0, -K.sp * 0.6, 0], handR: K.h, rod: { pitch: K.r, yaw: -30, bend: i === 4 ? -0.35 : i === 5 ? 0.25 : 0 }, shL: [-K.sp * 3, 0, K.l], elL: [-20, 0, 0], neck: [-K.sp * 0.6, 0, 0],
      hipL: [i >= 4 ? -12 : 4, 0, 2], hipR: [i >= 4 ? 8 : -6, 0, -2], knL: [i >= 4 ? 10 : 2, 0, 0], knR: [i >= 4 ? 6 : 12, 0, 0], mouth: K.m, squint: i === 2 || i === 3 ? 0.3 : 0 });
  } },
  reel: { n: 8, dur: 0.55, loop: true, fn: (u, i) => {
    const c = S(u * TAU);
    return P({ off: [0, -0.2 + 0.2 * c, 0], spine: [5, 0, 0], neck: [-4 + 2 * c, -6, 0], handR: [-5.6, 9.4, 6.8], handL: 'knob', rod: { pitch: 38, yaw: -38, crank: i }, knL: [6, 0, 0], knR: [6, 0, 0], squint: 0.15, gaze: [0.6, 0.35] });
  } },
  pull: { n: 6, dur: 0.9, loop: true, fn: (u) => {
    const w = S(u * TAU), w2 = S(u * TAU * 2);
    return P({ off: [0, -0.9, -1.2], spine: [-15 - 3 * w, 0, 2 * w2], neck: [8, 0, 3 * w2], hipL: [-26, 0, 4], knL: [18, 0, 0], hipR: [12, 0, -4], knR: [14, 0, 0],
      handR: [-4.8, 12.4, 5.4], handL: 'fore', rod: { pitch: 72 + 4 * w, yaw: -40, bend: 0.65 + 0.2 * w }, mouth: 'grit', squint: 0.35, wobble: 1, gaze: [0.7, -0.2] });
  } },
  yank: { n: 8, dur: 0.6, loop: false, fn: (u, i) => {
    const K = [
      { sp: 10, off: [0, -1.4, 0.4], hl: -30, kl: 40, hr: -24, kr: 38, r: 30, b: 0.5, h: [-5, 9, 7.2], m: 'grit' },
      { sp: 14, off: [0, -2, 0.8], hl: -36, kl: 52, hr: -30, kr: 48, r: 24, b: 0.7, h: [-5, 8.6, 7.4], m: 'grit' },
      { sp: -8, off: [0, 0.2, -0.4], hl: -20, kl: 16, hr: 6, kr: 10, r: 72, b: 0.9, h: [-4.6, 14.4, 4.6], m: 'open' },
      { sp: -28, off: [0, 1.6, -1.6], hl: -48, kl: 22, hr: 14, kr: 6, r: 90, b: 1.0, h: [-4.4, 17, 2.6], m: 'open' },
      { sp: -25, off: [0, 1.0, -1.5], hl: -40, kl: 18, hr: 12, kr: 6, r: 88, b: 0.9, h: [-4.4, 16.6, 3], m: 'open' },
      { sp: -16, off: [0, -0.2, -1.1], hl: -28, kl: 16, hr: 12, kr: 12, r: 80, b: 0.75, h: [-4.6, 14, 4.4], m: 'grit' },
      { sp: -14, off: [0, -0.7, -1.1], hl: -26, kl: 18, hr: 12, kr: 14, r: 76, b: 0.65, h: [-4.8, 12.8, 5.2], m: 'grit' },
      { sp: -15, off: [0, -0.9, -1.2], hl: -26, kl: 18, hr: 12, kr: 14, r: 72, b: 0.65, h: [-4.8, 12.4, 5.4], m: 'grit' },
    ][i];
    return P({ off: K.off, spine: [K.sp, 0, 0], neck: [i === 3 || i === 4 ? -10 : 4, 0, 0], hipL: [K.hl, 0, 4], knL: [K.kl, 0, 0], hipR: [K.hr, 0, -4], knR: [K.kr, 0, 0],
      handR: K.h, handL: 'fore', rod: { pitch: K.r, yaw: -40, bend: K.b }, mouth: K.m, squint: i >= 2 && i <= 4 ? 0.7 : 0.3, gaze: [0.6, -0.3] });
  } },
  hold: { n: 8, dur: 1.6, loop: true, fn: (u) => {
    const b = Math.abs(S(u * TAU)), sw = S(u * TAU);
    return P({ off: [0, 0.5 * b, 0], spine: [-5, 0, 2 * sw], neck: [-10, 8 * sw, 3 * sw], handL: [4.8, 9.6 + 0.6 * b, 8.8], handR: [-4.8, 9.6 + 0.6 * b, 8.8], noRod: true,
      mouth: 'grin', knL: [4 * b, 0, 0], knR: [4 * b, 0, 0], gaze: [0, 0.2] });
  } },
  cheer: { n: 8, dur: 0.72, loop: true, fn: (u, i) => {
    const j = S(u * Math.PI), f = S(u * TAU * 2), g = S(u * TAU * 2 + 2);
    return P({ off: [0, 6 * j, 0], spine: [-6 * j, 0, 4 * f], neck: [-12, 10 * g, 10 * f], hipL: [-40 * j, 0, 10], knL: [80 * j, 0, 0], hipR: [-15 * j, 0, -14 * j], knR: [55 * j, 0, 0],
      shL: [0, -28, 92 + 34 * f], elL: [0, 0, 30 + 50 * g], shR: [0, 24, -92 - 30 * g], elR: [0, 0, -20 - 40 * f], rod: { pitch: 96 + 14 * f, yaw: -60, bend: -0.3 * f },
      mouth: 'open', gaze: [0.4 * f, -0.4], wobble: 1 });
  } },
  sad: { n: 8, dur: 3.2, loop: true, fn: (u) => {
    const s = S(u * TAU);
    return P({ off: [0, -0.6, 0], spine: [13, 3 * s, 0], neck: [24, 4 * s, 5 * s], shL: [10, 0, 4], elL: [-4, 0, 0], handR: [-6.4, 4.4, 3.4], rod: { pitch: -18, yaw: -48 },
      knL: [8, 0, 0], knR: [8, 0, 0], mouth: 'frown', lid: 0.45, gaze: [0.2, 0.75] });
  } },
  sit: { n: 8, dur: 2.8, loop: true, fn: (u) => {
    const s = S(u * TAU), h = S(u * TAU * 0.5 + 0.4);
    return P({ off: [0, -HIP_Y + 2.2, 0], hipL: [-88, 0, 6], knL: [84 + 22 * s, 0, 0], hipR: [-86, 0, -6], knR: [84 - 22 * s, 0, 0], spine: [-4 + s, 0, 0], neck: [-3, 16 * h, 3 * s],
      handR: [-5.8, 7.6, 6.4], rod: { pitch: 34, yaw: -40 }, handL: [4.8, 2, 6.8], gill: s > 0.6 ? 1 : 0, gaze: [0.4 * h, 0.1] });
  } },
  show: { n: 12, dur: 4.4, loop: true, fn: (u) => {
    const b = S(u * TAU * 2), look = S(u * TAU);
    return P({ off: [0, -0.15 + 0.15 * b, 0], spine: [1.2 * b, 0, 0], neck: [-3 + 2 * b, 14 * look, 3 * S(u * TAU + 1)],
      handR: [-9.4, 6.4 + 0.3 * b, 2.2], rod: { pitch: 66, yaw: -96 }, handL: [6.8, 1.6, 0.6], knL: [2 + 2 * b, 0, 0], knR: [2 + 2 * b, 0, 0],
      gill: b > 0.55 ? 1 : 0, gaze: [0.4 * look, 0.1] });
  } },
  stand: { n: 1, dur: 1, loop: true, fn: () => P({ noRod: true, shL: [2, -10, 16], elL: [-12, 0, 0], shR: [2, 10, -16], elR: [-12, 0, 0], neck: [-3, 0, 0], gaze: [0.2, 0] }) },
  wave: { n: 8, dur: 0.9, loop: true, fn: (u) => {
    const w = S(u * TAU), b = Math.abs(S(u * TAU));
    return P({ off: [0, 0.4 * b, 0], spine: [-2, -6, -3 * w], neck: [-6, -10, 8 * w], shL: [0, -34, 98 + 5 * w], elL: [0, 0, 72 + 38 * w], handR: [-5.8, 8.2, 6.2], rod: { pitch: 62, yaw: -40 },
      mouth: 'grin', gaze: [-0.2, -0.1] });
  } },
};
export const POSE_NAMES = Object.keys(POSES).filter((k) => k !== 'show' && k !== 'stand');

function poseFrame(pose, t) {
  const pd = POSES[pose] || POSES.idle;
  const k = (t || 0) / pd.dur;
  return pd.loop ? Math.floor((k - Math.floor(k)) * pd.n) % pd.n : clamp(Math.floor(k * pd.n), 0, pd.n - 1);
}

// 2-bone IK: shoulder S to target T with bone lengths a, b; elbow bends toward `hint`.
function ik2(Sh, Tg, a, b, hint) {
  let d = sub(Tg, Sh);
  let L = Math.hypot(...d);
  const maxL = a + b - 0.08, minL = Math.abs(a - b) + 0.3;
  if (L > maxL) { d = scl(d, maxL / L); L = maxL; } else if (L < minL) { d = scl(norm(d), minL); L = minL; }
  const dn = scl(d, 1 / L);
  const x = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - x * x));
  let hp = sub(hint, scl(dn, dot(hint, dn)));
  hp = Math.hypot(...hp) < 1e-4 ? [1, 0, 0] : norm(hp);
  const E = add(Sh, add(scl(dn, x), scl(hp, h)));
  return { E, T: add(Sh, d) };
}

// Bone placement for a pose: returns [{part, W (world matrix incl. pivot shift)}] + world anchors.
function solve(kit, p, fi) {
  const items = [];
  const at = (name, part, W) => { if (part) items.push({ name, part, W }); };
  const place = (part, Mw) => mul(Mw, Tr(-part.pivot[0], -part.pivot[1], -part.pivot[2]));
  const hips = mul(Tr(p.off[0], HIP_Y + p.off[1], p.off[2]), Ro(p.hips));
  const spine = mul(hips, Ro(p.spine));
  const bodyR = hips.R;
  const toWorld = (v) => ap(spine, v);
  // legs
  const thigh = kit.part('thigh', () => buildThigh(kit)), shin = kit.part('shin', () => buildShin(kit));
  for (const [hipJ, hr, kr] of [[J.hipL, p.hipL, p.knL], [J.hipR, p.hipR, p.knR]]) {
    const Mt = mul(hips, mul(Tr(...hipJ), Ro(hr)));
    const Mk = mul(Mt, mul(Tr(...J.knee), Ro(kr)));
    at('thigh', thigh, place(thigh, Mt));
    at('shin', shin, place(shin, Mk));
  }
  const torso = kit.part('torso', () => buildTorso(kit));
  at('torso', torso, place(torso, spine));
  // head + hat
  const mouth = p.mouth, gill = p.gill;
  const head = kit.part(`head:${mouth}:${gill}`, () => buildHead(kit, mouth, gill));
  const Mh = mul(spine, mul(Tr(...J.neck), Ro(p.neck)));
  const Wh = place(head, Mh);
  at('head', head, Wh);
  const spin = kit.look.hat === 'propeller' ? fi % 2 : 0;
  const hat = kit.look.hat === 'none' ? null : kit.part('hat:' + spin, () => buildHat(kit, spin) || { m: kit.model(1, 1, 1), pivot: [0, 0, 0] });
  let hatTop = null;
  if (hat && hat.b) {
    const seat = mul(Wh, mul(Tr(...HAT_SEAT), Ro([HAT_TILT[kit.look.hat] || 0, 0, 0])));
    at('hat', hat, mul(seat, Tr(-hat.pivot[0], -hat.pivot[1], -hat.pivot[2])));
    hatTop = ap(seat, [0, hat.b.y1 + 1 - hat.pivot[1], 0]);
  }
  // arms: right first (holds the rod), then the rod, then the left (may reach for the rod)
  const upper = kit.part('upper', () => buildUpper(kit)), fore = kit.part('fore', () => buildFore(kit));
  const gripLocal = sub(fore.anchors.grip, fore.pivot);
  const armFK = (shJ, sr, er) => {
    const Mu = mul(spine, mul(Tr(...shJ), Ro(sr)));
    const Mf = mul(Mu, mul(Tr(...J.elbow), Ro(er)));
    return { Mu, Mf };
  };
  const armIK = (shJ, target, side) => {
    const Sw = toWorld(shJ);
    const hint = mv(spine.R, [side * 0.9, -0.5, -0.65]);
    const { E, T } = ik2(Sw, target, ARM.upper, Math.hypot(...gripLocal), hint);
    const fwd = mv(spine.R, [0, 0, 1]);
    const Mu = M(alignY(sub(Sw, E), fwd), Sw);
    const Mf = M(alignY(sub(E, T), fwd), E);
    return { Mu, Mf };
  };
  const R = p.handR ? armIK(J.shR, toWorld(p.handR), -1) : armFK(J.shR, p.shR, p.elR);
  at('upper', upper, place(upper, R.Mu));
  at('fore', fore, place(fore, R.Mf));
  const gripR = ap(R.Mf, gripLocal);
  let rod = null, Wr = null, rodTip = gripR;
  if (!p.noRod) {
    const rp = p.rod;
    const pr = rp.pitch * DEG, yr = rp.yaw * DEG;
    const dir = mv(bodyR, [Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr)]);
    const down = mv(bodyR, [0, -1, 0.2]);
    const bendB = Math.round(clamp(rp.bend, -1, 1) * 4) / 4;
    rod = kit.part(`rod:${bendB}:${rp.crank % 8}`, () => buildRod(kit, bendB, rp.crank % 8));
    const Mr = M(alignY(dir, down), gripR);
    Wr = place(rod, Mr);
    at('rod', rod, Wr);
    rodTip = ap(Wr, rod.anchors.tip);
  }
  let Lh;
  let target = p.handL;
  if (target === 'knob' && rod) target = ap(Wr, rod.anchors.knob);
  else if (target === 'fore' && rod) target = ap(Wr, rod.anchors.fore);
  else if (Array.isArray(target)) target = toWorld(target);
  else target = null;
  Lh = target ? armIK(J.shL, target, 1) : armFK(J.shL, p.shL, p.elL);
  at('upper', upper, place(upper, Lh.Mu));
  at('fore', fore, place(fore, Lh.Mf));
  const gripL = ap(Lh.Mf, gripLocal);
  const top = hatTop || ap(Wh, head.anchors.top);
  return {
    items,
    anchors: { rodTip, handR: gripR, handL: gripL, hands: p.noRod ? scl(add(gripR, gripL), 0.5) : gripR, head: top, mouth: ap(Wh, head.anchors.mouth), eyeL: ap(Wh, head.anchors.eyeL), eyeR: ap(Wh, head.anchors.eyeR), headFwd: mv(Wh.R, [0, 0, 1]) },
    eyeR: head.eyeR,
  };
}

// ====================================================================== composing + rendering

// Stamp a part into the composed grid through world matrix W; mx = -1 mirrors x (facing left).
function stamp(dst, part, W, gmin, mx) {
  const src = part.m, b = part.b;
  if (!b) return;
  const R = W.R, t = W.t;
  const toGrid = (w) => [mx * w[0] - gmin[0], w[1] - gmin[1], w[2] - gmin[2]];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const q = [i & 1 ? b.x1 + 1 : b.x0, i & 2 ? b.y1 + 1 : b.y0, i & 4 ? b.z1 + 1 : b.z0];
    const g = toGrid(ap(W, q));
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g[k]); hi[k] = Math.max(hi[k], g[k]); }
  }
  const { nx: snx, ny: sny, nz: snz, data: sd } = src;
  const x0 = Math.floor(lo[0]), x1 = Math.ceil(hi[0]);
  // inverse map: world = mx-flip(grid + gmin); local = R^T (world - t)
  const ix = R[0] * mx, iy = R[1] * mx, iz = R[2] * mx; // d(local)/d(gx)
  for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++) for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) {
    const wx = mx * (x0 + 0.5 + gmin[0]) - t[0], wy = y + 0.5 + gmin[1] - t[1], wz = z + 0.5 + gmin[2] - t[2];
    let qx = R[0] * wx + R[3] * wy + R[6] * wz;
    let qy = R[1] * wx + R[4] * wy + R[7] * wz;
    let qz = R[2] * wx + R[5] * wy + R[8] * wz;
    for (let x = x0; x <= x1; x++, qx += ix, qy += iy, qz += iz) {
      if (qx < 0 || qy < 0 || qz < 0 || qx >= snx || qy >= sny || qz >= snz) continue;
      const v = sd[(qx | 0) + snx * ((qy | 0) + sny * (qz | 0))];
      if (v) dst.set(x, y, z, v);
    }
  }
  // forward splat keeps thin rotated shells watertight
  for (let z = b.z0; z <= b.z1; z++) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const v = sd[x + snx * (y + sny * z)];
    if (!v) continue;
    const g = toGrid(ap(W, [x + 0.5, y + 0.5, z + 0.5]));
    const gx = Math.floor(g[0]), gy = Math.floor(g[1]), gz = Math.floor(g[2]);
    if (!dst.get(gx, gy, gz)) dst.set(gx, gy, gz, v);
  }
}

function compose(kit, sol, mx) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { part, W } of sol.items) {
    const b = part.b;
    if (!b) continue;
    for (let i = 0; i < 8; i++) {
      const w = ap(W, [i & 1 ? b.x1 + 1 : b.x0, i & 2 ? b.y1 + 1 : b.y0, i & 4 ? b.z1 + 1 : b.z0]);
      const g = [mx * w[0], w[1], w[2]];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g[k]); hi[k] = Math.max(hi[k], g[k]); }
    }
  }
  const gmin = lo.map((v) => Math.floor(v) - 1);
  const m = new VoxelModel(Math.ceil(hi[0]) - gmin[0] + 2, Math.ceil(hi[1]) - gmin[1] + 2, Math.ceil(hi[2]) - gmin[2] + 2);
  m.palette = kit.pal;
  for (const { part, W } of sol.items) stamp(m, part, W, gmin, mx);
  return { m, gmin };
}

const BASE_VS = 1.4;      // px per voxel at scale 1
const PITCH = 14;         // camera looks slightly down
const FACE_YAW = 38;      // 3/4 view angle for facing left/right
const YAW_STEP = 10;
const MAX_FRAMES = 1400;
const MAX_PIXELS = 9e6;   // ~36 MB of cached frame canvases
let framePx = 0;
const FRAMES = new Map();
const FAMS = new Map();   // family (all but frame index) -> Set(fi)
let budgetMs = 9, spent = 0, windowStart = 0, statBuilt = 0, statFallback = 0, statMs = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function overBudget() {
  const t = now();
  if (t - windowStart > 30) { windowStart = t; spent = 0; }
  return spent >= budgetMs;
}
export function setCharacterBudget(ms) { budgetMs = ms; }
export const PROF = { solve: 0, compose: 0, render: 0, n: 0 };
export function characterStats() { return { prof: PROF, frames: FRAMES.size, kits: KITS.size, built: statBuilt, fallbacks: statFallback, avgMs: statBuilt ? +(statMs / statBuilt).toFixed(2) : 0 }; }

function buildFrame(kit, pose, fi, yaw, vs, mx) {
  const t0 = now();
  const pd = POSES[pose];
  const u = pd.loop ? fi / pd.n : fi / Math.max(1, pd.n - 1);
  const p = pd.fn(u, fi);
  const ta = now();
  const sol = solve(kit, p, fi);
  const tb = now();
  const { m, gmin } = compose(kit, sol, mx);
  const tc = now();
  const r = renderVoxels(m, { scale: vs, yaw, pitch: PITCH, ao: 1.05, edges: 0.75, sideEdges: 0.55, jitter: 0.1, depthThreshold: 2.4, glowRadius: 2 });
  const td = now();
  PROF.solve += tb - ta; PROF.compose += tc - tb; PROF.render += td - tc; PROF.n++; PROF.vox = m.nx * m.ny * m.nz; PROF.px = r.w * r.h;
  const proj = (w) => r.project(mx * w[0] - gmin[0], w[1] - gmin[1], w[2] - gmin[2]);
  const [fx, fy] = proj([0, 0, 0]);
  const rel = (w) => { const q = proj(w); return [q[0] - fx, q[1] - fy]; };
  const A = sol.anchors;
  const anchors = { rodTip: rel(A.rodTip), hands: rel(A.hands), handL: rel(A.handL), handR: rel(A.handR), head: rel(A.head), mouth: rel(A.mouth) };
  // eye masks from the rendered id buffer (only the visible part of each eyeball)
  const eyes = [];
  const W = r.w, ids = r.ids;
  for (const [idx, key] of [[kit.c.eyeL, 'eyeL'], [kit.c.eyeR, 'eyeR']]) {
    let x0 = W, y0 = r.h, x1 = -1, y1 = -1, n = 0;
    for (let i = 0; i < ids.length; i++) if (ids[i] === idx) { const x = i % W, y = (i / W) | 0; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (n < 3) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const mc = makeCanvas(w, h), g = ctxOf(mc), img = g.createImageData(w, h);
    const d32 = new Uint32Array(img.data.buffer);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ids[(y0 + y) * W + x0 + x] === idx) d32[y * w + x] = 0xffffffff;
    g.putImageData(img, 0, 0);
    const c = rel(A[key]);
    const f = rel(add(A[key], scl(A.headFwd, sol.eyeR)));
    eyes.push({ key, mask: mc, x: x0 - fx, y: y0 - fy, w, h, cx: c[0], cy: c[1], fwd: [f[0] - c[0], f[1] - c[1]], r: sol.eyeR * vs, n });
  }
  let front = null;
  if (pose === 'hold') {
    const hs = kit.handSet;
    front = renderVoxels(m, { scale: vs, yaw, pitch: PITCH, ao: 1.05, edges: 0.75, sideEdges: 0.55, jitter: 0.1, depthThreshold: 2.4, keepVoxel: (x, y, z) => hs.has(m.get(x, y, z)) }).canvas;
  }
  const dt = now() - t0;
  spent += dt; statBuilt++; statMs += dt;
  return { canvas: r.canvas, glow: r.glow, front, fx, fy, anchors, eyes, p, vs };
}

function yawFor(o) {
  if (o.yaw != null) return { yaw: Math.round(o.yaw / YAW_STEP) * YAW_STEP, mx: 1 };
  // the model is mirrored for facing right so the rod hand is always the far one and the rod
  // sticks out toward the water instead of across the face
  const f = (o.facing ?? 1) < 0 ? -1 : 1;
  return { yaw: f > 0 ? -FACE_YAW : FACE_YAW, mx: -f };
}

function getFrame(kit, pose, fi, yaw, vs, mx, force) {
  const fam = `${kit.key}#${pose}#${yaw}#${vs}#${mx}`;
  const key = fam + '#' + fi;
  let fr = FRAMES.get(key);
  if (fr) { FRAMES.delete(key); FRAMES.set(key, fr); return fr; }
  const set = FAMS.get(fam);
  if (!force && overBudget()) {
    // nearest ready frame of the same family, else any yaw of this pose, else build anyway
    if (set && set.size) {
      let best = -1, bd = 1e9;
      for (const f of set) { const d = Math.abs(f - fi); if (d < bd) { bd = d; best = f; } }
      statFallback++;
      return FRAMES.get(fam + '#' + best);
    }
    for (let d = YAW_STEP; d <= 180; d += YAW_STEP) {
      for (const yy of [yaw - d, yaw + d]) {
        const s2 = FAMS.get(`${kit.key}#${pose}#${yy}#${vs}#${mx}`);
        if (s2 && s2.size) { statFallback++; const f0 = s2.has(fi) ? fi : s2.values().next().value; return FRAMES.get(`${kit.key}#${pose}#${yy}#${vs}#${mx}#${f0}`); }
      }
    }
  }
  fr = buildFrame(kit, pose, fi, yaw, vs, mx);
  fr.px = fr.canvas.width * fr.canvas.height * (fr.front ? 2 : 1) * (fr.glow ? 1.5 : 1);
  framePx += fr.px;
  FRAMES.set(key, fr);
  let s = set;
  if (!s) FAMS.set(fam, (s = new Set()));
  s.add(fi);
  fr.fam = fam; fr.fi = fi;
  if (FRAMES.size > MAX_FRAMES || framePx > MAX_PIXELS) {
    for (const [k, v] of FRAMES) {
      if (v === fr) continue;
      FRAMES.delete(k);
      framePx -= v.px;
      FAMS.get(v.fam)?.delete(v.fi);
      if (FRAMES.size <= MAX_FRAMES * 0.85 && framePx <= MAX_PIXELS * 0.85) break;
    }
  }
  return fr;
}

// Pre-build frames for the given poses (spends at most `ms` per call). Returns true when all are cached.
export function warmCharacter(look, { poses = POSE_NAMES, scale = 1, facing = 1, yaw = null, ms = 6 } = {}) {
  const L = normalizeLook(look), kit = kitFor(L);
  const { yaw: yw, mx } = yawFor({ facing, yaw });
  const vs = vsFor(scale);
  const t0 = now();
  for (const pose of poses) {
    for (let fi = 0; fi < POSES[pose].n; fi++) {
      if (FRAMES.has(`${kit.key}#${pose}#${yw}#${vs}#${mx}#${fi}`)) continue;
      if (now() - t0 > ms) return false;
      getFrame(kit, pose, fi, yw, vs, mx, true);
    }
  }
  return true;
}

const vsFor = (scale) => Math.max(0.5, Math.round(BASE_VS * (scale ?? 1) * 4) / 4);

// ====================================================================== live eyes

const EYES = new Map();
const PUPIL = '#1a1430';
let scratch = null, sctx = null;
function scr(w, h) {
  if (!scratch || scratch.width < w || scratch.height < h) { scratch = makeCanvas(Math.max(w, scratch?.width || 0), Math.max(h, scratch?.height || 0)); sctx = ctxOf(scratch); }
  sctx.clearRect(0, 0, w, h);
  return sctx;
}

function disc(g, cx, cy, r, color, block = 1) {
  g.fillStyle = color;
  const R = Math.max(0.5, r);
  for (let y = -Math.ceil(R); y <= Math.ceil(R); y += block) {
    const hw = Math.sqrt(Math.max(0, R * R - (y + block / 2) * (y + block / 2)));
    if (hw <= 0.2) continue;
    g.fillRect(Math.round(cx - hw), Math.round(cy + y), Math.max(1, Math.round(hw * 2)), block);
  }
}

function star(g, cx, cy, r, color, rotA) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rotA + (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
}

function heart(g, cx, cy, r, color) {
  g.fillStyle = color;
  const s = Math.max(1, r / 3);
  const rows = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  const ox = cx - 3.5 * s, oy = cy - 3 * s;
  rows.forEach((row, y) => { for (let x = 0; x < 7; x++) if (row[x] === '#') g.fillRect(Math.round(ox + x * s), Math.round(oy + y * s), Math.ceil(s), Math.ceil(s)); });
}

function drawEyes(ctx, fr, X, Y, o, look, t, dtHint, sx, ss) {
  const id = o.id ?? 'main';
  let st = EYES.get(id);
  const tn = now();
  if (!st) { st = { px: X, py: Y, eyes: {}, blinkT: 0, nextBlink: 2 + Math.random() * 3, wander: [0, 0], wanderT: 0, last: tn }; EYES.set(id, st); if (EYES.size > 300) EYES.delete(EYES.keys().next().value); }
  const dt = dtHint ?? clamp((tn - st.last) / 1000, 0, 0.05);
  st.last = tn;
  // character motion (screen) pushes the pupils around
  const mvx = clamp((X - st.px) / Math.max(dt, 1e-3), -600, 600), mvy = clamp((Y - st.py) / Math.max(dt, 1e-3), -600, 600);
  const jump = Math.abs(X - st.px) > 40 || Math.abs(Y - st.py) > 40;
  st.px = X; st.py = Y;
  st.nextBlink -= dt;
  if (st.nextBlink <= 0) { st.blinkT = 0.14; st.nextBlink = 2.2 + Math.random() * 3.6; if (Math.random() < 0.18) st.nextBlink = 0.25; }
  st.blinkT = Math.max(0, st.blinkT - dt);
  st.wanderT -= dt;
  if (st.wanderT <= 0) { st.wanderT = 0.7 + Math.random() * 1.8; st.wander = [Math.random() * 1.6 - 0.8, Math.random() * 1.0 - 0.5]; }
  const p = fr.p, style = look.eyes;
  const blink = st.blinkT > 0 ? 1 : 0;
  const block = Math.max(1, Math.floor(fr.vs / 1.45));
  for (const e of fr.eyes) {
    let es = st.eyes[e.key];
    if (!es) es = st.eyes[e.key] = { ox: 0, oy: 0, vx: 0, vy: 0, lcx: e.cx, lcy: e.cy };
    const r = e.r;
    const left = e.key === 'eyeL';
    const pr = r * (style === 'googly' ? 0.5 : style === 'goofy' ? (left ? 0.47 : 0.38) : style === 'angry' ? 0.36 : style === 'sleepy' ? 0.44 : 0.46);
    const maxOff = Math.max(0.5, r - pr - 0.6);
    // target: forward gaze from the 3D head pose + pose gaze + wander, or the lookAt point
    let tx = e.fwd[0] * 0.55 + (p.gaze[0] * sx + st.wander[0] * 0.4) * maxOff;
    let ty = e.fwd[1] * 0.55 + (p.gaze[1] + st.wander[1] * 0.3) * maxOff;
    if (o.lookAt) {
      const dx = o.lookAt[0] - (X + e.cx), dy = o.lookAt[1] - (Y + e.cy);
      const dl = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, dl / 40);
      tx = tx * 0.3 + (dx / dl) * maxOff * k; ty = ty * 0.3 + (dy / dl) * maxOff * k;
    }
    if (style === 'googly') ty = ty * 0.4 + maxOff * 0.75;
    // spring with inertia: the pupils lag behind motion and wobble back
    const ddx = jump ? 0 : (e.cx - es.lcx), ddy = jump ? 0 : (e.cy - es.lcy);
    es.lcx = e.cx; es.lcy = e.cy;
    const loose = style === 'googly' ? 1.8 : style === 'goofy' ? (left ? 1.15 : 0.85) : 1;
    es.vx += (-(mvx * 0.0016) - ddx * 3) * loose * ss; es.vy += (-(mvy * 0.0016) - ddy * 3) * loose * ss;
    const k = (style === 'googly' ? 110 : 190) / loose, damp = style === 'googly' ? 5 : 11;
    es.vx += ((tx - es.ox) * k - es.vx * damp) * dt;
    es.vy += ((ty - es.oy) * k - es.vy * damp) * dt;
    if (p.wobble) { es.vx += (Math.random() - 0.5) * 30 * dt * r; es.vy += (Math.random() - 0.5) * 30 * dt * r; }
    es.ox += es.vx * dt; es.oy += es.vy * dt;
    const ol = Math.hypot(es.ox, es.oy);
    if (ol > maxOff) { es.ox *= maxOff / ol; es.oy *= maxOff / ol; if (style === 'googly') { es.vx *= -0.4; es.vy *= -0.4; } }
    // draw pupil + lids into scratch, masked by the visible eyeball
    const g = scr(e.w, e.h);
    const pcx = e.cx - e.x + es.ox, pcy = e.cy - e.y + es.oy;
    if (style === 'starry') {
      star(g, pcx, pcy, pr * 1.25, '#ffcf3a', S(t * 2) * 0.2);
      star(g, pcx, pcy, pr * 0.62, '#fff6c8', S(t * 2) * 0.2);
      disc(g, pcx, pcy, Math.max(0.5, pr * 0.2), '#7a4a10', 1);
    } else if (style === 'hearts') {
      heart(g, pcx, pcy + 0.5, pr * (1.05 + 0.1 * Math.max(0, S(t * 9))), '#ff3a6a');
      g.fillStyle = '#ffd0dc'; g.fillRect(Math.round(pcx - pr * 0.5), Math.round(pcy - pr * 0.4), Math.max(1, block), Math.max(1, block));
    } else if (style === 'dizzy') {
      g.fillStyle = PUPIL;
      const turns = 2.2, n = Math.max(14, Math.round(pr * 8));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * turns * TAU + t * 7 * (left ? 1 : -1), rr = (i / n) * pr * 1.05;
        g.fillRect(Math.round(pcx + Math.cos(a) * rr), Math.round(pcy + Math.sin(a) * rr), block, block);
      }
    } else {
      disc(g, pcx, pcy, pr, PUPIL, block);
      if (style !== 'angry') disc(g, pcx, pcy, pr * 0.5, '#3a2a5a', block);
      g.fillStyle = '#ffffff';
      const hs = Math.max(1, Math.round(pr * 0.36));
      g.fillRect(Math.round(pcx - pr * 0.45), Math.round(pcy - pr * 0.5), hs, hs);
      if (pr > 4) g.fillRect(Math.round(pcx + pr * 0.25), Math.round(pcy + pr * 0.25), Math.max(1, hs >> 1), Math.max(1, hs >> 1));
    }
    // lids: blink, sleepy, sad droop, effort squint, angry slant
    let lid = Math.max(p.lid, p.squint * 0.6, style === 'sleepy' ? 0.5 : style === 'angry' ? 0.22 : 0.06);
    if (blink) lid = 1;
    const lower = blink ? 0 : p.squint * 0.35;
    const top = e.cy - e.y - r, bot = e.cy - e.y + r;
    const inner = left === (sx > 0) ? -1 : 1;
    const slant = style === 'angry' && !blink ? 0.55 : p.mouth === 'frown' && !blink ? -0.35 : 0;
    const lidCol = shade(skinOf(look).skin, -0.08), lidLine = shade(skinOf(look).skin, -0.55);
    if (lid > 0.01) {
      const ly = top + lid * 2 * r;
      g.fillStyle = lidCol;
      g.beginPath();
      const xl = -1, xr = e.w + 1;
      const yl = ly + slant * r * ((xl - (e.cx - e.x)) / r) * inner, yr = ly + slant * r * ((xr - (e.cx - e.x)) / r) * inner;
      g.moveTo(xl, -2); g.lineTo(xr, -2); g.lineTo(xr, yr); g.lineTo(xl, yl); g.closePath(); g.fill();
      g.strokeStyle = lidLine; g.lineWidth = Math.max(1, block);
      g.beginPath(); g.moveTo(xl, yl); g.lineTo(xr, yr); g.stroke();
    }
    if (lower > 0.01) {
      g.fillStyle = lidCol;
      g.fillRect(0, Math.round(bot - lower * 2 * r), e.w, e.h);
    }
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(e.mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(scratch, 0, 0, e.w, e.h, X + e.x, Y + e.y, e.w, e.h);
  }
}

// ====================================================================== draw

export function drawCharacter(ctx, x, y, o = {}) {
  const look = normalizeLook(o.look);
  const kit = kitFor(look);
  const pose = POSES[o.pose] ? o.pose : 'idle';
  const t = o.t ?? 0;
  const scale = o.scale ?? 1;
  const vs = vsFor(scale);
  const { yaw, mx } = yawFor(o);
  const fi = poseFrame(pose, t);
  const fr = getFrame(kit, pose, fi, yaw, vs, mx, false);
  const X = Math.round(x - fr.fx), Y = Math.round(y - fr.fy);
  const sx = o.yaw != null ? -Math.sign(Math.sin(yaw * DEG)) || 1 : (o.facing ?? 1) < 0 ? -1 : 1;
  if (o.shadow !== false && pose !== 'sit') {
    const lift = fr.p.off[1] > 1 ? clamp01(1 - fr.p.off[1] / 10) : 1;
    const w = Math.round(13 * vs * lift), h = Math.max(1, Math.round(1.6 * vs * lift));
    ctx.fillStyle = 'rgba(10,20,40,0.22)';
    for (let i = -h; i <= h; i++) { const hw = Math.round(w * Math.sqrt(1 - (i / (h + 0.5)) ** 2)); ctx.fillRect(Math.round(x) - hw, Math.round(y) + i, hw * 2, 1); }
  }
  ctx.drawImage(fr.canvas, X, Y);
  if (fr.glow) {
    const prev = ctx.globalCompositeOperation, pa = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pa * 0.55;
    ctx.drawImage(fr.glow, X, Y);
    ctx.globalCompositeOperation = prev; ctx.globalAlpha = pa;
  }
  drawEyes(ctx, fr, Math.round(x), Math.round(y), o, look, t, null, sx, vs / BASE_VS);
  const A = fr.anchors;
  const ax = (a) => [Math.round(x + a[0]), Math.round(y + a[1])];
  if (pose === 'hold' && o.fish?.compiled) {
    const c = o.fish.compiled;
    const len = (c.L || 16) * 1.45;
    const fs = clamp((o.fishScale ?? 1) * (34 * vs) / len, 0.25, 1.6 * vs / BASE_VS);
    const hx = x + A.hands[0], hy = y + A.hands[1] - 1;
    const wig = S(t * 7) * 0.12;
    drawFishRig(ctx, c, {
      x: hx, y: hy, facing: -sx, turn: 1, angle: wig, scale: fs, squash: S(t * 9) * 0.08,
      swimPhase: (t * 1.3) % 1, tailPhase: (t * 2.6) % 1, finPhase: (t * 2) % 1, speed01: 0.5,
      lookX: hx + sx * 30, lookY: hy - 20, blink: 0, emotion: o.fish.emotion || 'surprised', mouth: 0.4 + 0.4 * Math.abs(S(t * 6)), time: t,
    });
    if (fr.front) ctx.drawImage(fr.front, X, Y);
  }
  return { rodTip: ax(A.rodTip), hands: ax(A.hands), head: ax(A.head), handL: ax(A.handL), handR: ax(A.handR), mouth: ax(A.mouth) };
}

// ====================================================================== wardrobe thumbnails

const PREVIEWS = new Map();
// Cached thumbnail for an item worn by `look` (built under the frame budget; null until ready).
// -> {canvas, glow, ox, oy, w, h, eyes?, fr} draw at (x - ox, y - oy); for eyes call drawPreviewEyes.
export function itemPreview(look, item, size = 1, force = false) {
  const L = equipItem(normalizeLook(look), item);
  if (item.slot === 'acc' && !L.acc.includes(item.value)) L.acc = [...L.acc, item.value];
  if (item.slot === 'boat') return null;
  const key = lookKey(L) + '|' + item.slot + '|' + size;
  let pv = PREVIEWS.get(key);
  if (pv) return pv;
  if (!force && overBudget()) return null;
  const kit = kitFor(L);
  const t0 = now();
  const vs = Math.max(0.6, Math.round(BASE_VS * size * 20) / 20);
  let m, yaw = -28, pitch = 12;
  const slot = item.slot;
  if (slot === 'rod') {
    const rod = kit.part('rod:0:1', () => buildRod(kit, 0, 1));
    const W = M(rot(0, 0, -42), [0, 0, 0]);
    const sol = { items: [{ part: rod, W: mul(W, Tr(-rod.pivot[0], -rod.pivot[1], -rod.pivot[2])) }] };
    m = compose(kit, sol, 1).m; yaw = -20; pitch = 18;
  } else if (slot === 'boots') {
    const shin = kit.part('shin', () => buildShin(kit));
    const sol = { items: [-4, 4].map((dx) => ({ part: shin, W: mul(Tr(dx, 0, 0), Tr(-shin.pivot[0], -shin.pivot[1] + 0, -shin.pivot[2])) })) };
    m = compose(kit, sol, 1).m; yaw = -34; pitch = 20;
  } else if (slot === 'gloves') {
    const fore = kit.part('fore', () => buildFore(kit));
    const sol = { items: [[-4, 18], [4, -18]].map(([dx, rz]) => ({ part: fore, W: mul(mul(Tr(dx, 0, 0), Ro([0, 0, rz + 180])), Tr(-fore.pivot[0], -fore.pivot[1], -fore.pivot[2])) })) };
    m = compose(kit, sol, 1).m; yaw = -20; pitch = 14;
  }
  if (m) {
    const r = renderVoxels(m, { scale: vs, yaw, pitch, ao: 1.05, edges: 0.75, sideEdges: 0.55, jitter: 0.1, glowRadius: 2 });
    pv = { canvas: r.canvas, glow: r.glow, ox: r.w / 2, oy: r.h, w: r.w, h: r.h };
  } else {
    // head close-ups for face/hat items, full figure for outfits and extras
    const headOnly = slot === 'skin' || slot === 'eyes' || slot === 'mouth' || slot === 'hat' || (slot === 'acc' && ['sunglasses', 'snorkel', 'monocle', 'mustache', 'earring'].includes(item.value));
    if (headOnly) {
      const head = kit.part('head:rest:0', () => buildHead(kit, 'rest', 0));
      const items = [{ part: head, W: Tr(-head.pivot[0], -head.pivot[1], -head.pivot[2]) }];
      if (slot === 'hat' && L.hat !== 'none') {
        const hat = kit.part('hat:0', () => buildHat(kit, 0));
        const seat = mul(items[0].W, mul(Tr(...HAT_SEAT), Ro([HAT_TILT[L.hat] || 0, 0, 0])));
        items.push({ part: hat, W: mul(seat, Tr(-hat.pivot[0], -hat.pivot[1], -hat.pivot[2])) });
      }
      const { m: hm, gmin } = compose(kit, { items }, 1);
      const yw = slot === 'acc' && item.value === 'earring' ? 40 : slot === 'mouth' || (slot === 'acc' && item.value === 'mustache') ? -10 : slot === 'eyes' ? -16 : -24;
      const r = renderVoxels(hm, { scale: vs, yaw: yw, pitch: 10, ao: 1.05, edges: 0.75, sideEdges: 0.55, jitter: 0.1, glowRadius: 2 });
      const proj = (w) => r.project(w[0] - gmin[0], w[1] - gmin[1], w[2] - gmin[2]);
      const Wh = items[0].W;
      const fwd = mv(Wh.R, [0, 0, 1]);
      const eyes = [];
      for (const [idx, key, a] of [[kit.c.eyeL, 'eyeL', head.anchors.eyeL], [kit.c.eyeR, 'eyeR', head.anchors.eyeR]]) {
        let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1, n = 0;
        for (let i = 0; i < r.ids.length; i++) if (r.ids[i] === idx) { const x = i % r.w, y = (i / r.w) | 0; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (n < 3) continue;
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const mc = makeCanvas(w, h), g = ctxOf(mc), img = g.createImageData(w, h), d32 = new Uint32Array(img.data.buffer);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (r.ids[(y0 + yy) * r.w + x0 + xx] === idx) d32[yy * w + xx] = 0xffffffff;
        g.putImageData(img, 0, 0);
        const c = proj(ap(Wh, a)), f = proj(ap(Wh, add(a, scl(fwd, head.eyeR))));
        eyes.push({ key, mask: mc, x: x0, y: y0, w, h, cx: c[0], cy: c[1], fwd: [f[0] - c[0], f[1] - c[1]], r: head.eyeR * vs, n });
      }
      pv = { canvas: r.canvas, glow: r.glow, ox: r.w / 2, oy: r.h, w: r.w, h: r.h, eyes, vs, p: P({}) };
    } else {
      // full figure, hatless (unless it is the point), neutral stance without the rod
      const L2 = { ...L, hat: 'none' };
      const kit2 = kitFor(L2);
      const fr = getFrame(kit2, 'stand', 0, slot === 'acc' && item.value === 'backpack' ? 140 : -30, vs, 1, true);
      pv = { canvas: fr.canvas, glow: fr.glow, ox: fr.fx, oy: fr.fy, w: fr.canvas.width, h: fr.canvas.height, eyes: fr.eyes.map((e) => ({ ...e, x: e.x + fr.fx, y: e.y + fr.fy, cx: e.cx + fr.fx, cy: e.cy + fr.fy })), vs, p: fr.p };
    }
  }
  pv.look = L;
  spent += now() - t0;
  PREVIEWS.set(key, pv);
  if (PREVIEWS.size > 400) PREVIEWS.delete(PREVIEWS.keys().next().value);
  return pv;
}

// Draw a thumbnail at (x, y) = its bottom centre, including live pupils.
export function drawItemPreview(ctx, pv, x, y, t = 0, id = 'thumb') {
  const X = Math.round(x - pv.ox), Y = Math.round(y - pv.oy);
  ctx.drawImage(pv.canvas, X, Y);
  if (pv.glow) { const g = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(pv.glow, X, Y); ctx.globalAlpha = 1; ctx.globalCompositeOperation = g; }
  if (pv.eyes?.length) drawEyes(ctx, { eyes: pv.eyes, p: pv.p, vs: pv.vs }, X, Y, { id }, pv.look, t, null, 1, 1);
}
