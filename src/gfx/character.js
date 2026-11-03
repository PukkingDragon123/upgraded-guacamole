// The player: a cute, goofy BUBBLE PERSON (phase 3, Frutiger Aero). A little voxel body (top, bottom, gloves,
// shoes, backpack) with a big translucent, glossy, iridescent soap-bubble head and big glossy CARTOON eyes.
// Each animation frame poses the parts (FK angles + 2-bone IK for hands), stamps them into one voxel model and
// renders it with voxel.js. The bubble pixels are then re-shaded in screen space (tint, rainbow thin-film rim,
// fresnel transparency, window highlight + bounce light, a coloured rim instead of a dark outline). Frames are
// cached per (look, pose, frame, yaw, scale, facing) and built under a small time budget with nearest-frame
// fallback. The FACE (eyes, mouth, blush, face accessories) is drawn live every frame as crisp pixel art mapped
// onto the bubble surface (it turns with the head and shows mirrored through the bubble from behind), so eyes
// blink, look at things and the mouth talks without rebuilding voxels. Trails and emote effects are 2D sparkles.
//
// drawCharacter(ctx, x, y, {pose, t, facing, scale, look, fish, lookAt, id, yaw, rod, rodLook, shadow, talk, mood, trail})
//   -> {rodTip:[x,y], hands, head, handL, handR, mouth}
//   Feet at (x, y) (for 'sit': the seat point). ~70 px tall at scale 1 (hair included).
//   pose: idle | cast | reel | pull | yank | hold | cheer | sad | sit | wave | dance | flex | laugh | chat | think
//         | stand | show | emote (= the look's equipped emote). One-shots ('cast', 'yank') take the time since the
//   pose started and hold their last frame. facing 1 = right, -1 = left (3/4 views); yaw (deg) overrides facing.
//   talk 0..1 opens the mouth (NPC chatter), mood 'happy'|'sad'|'surprised'|'angry'|'love'|'excited' tweaks the face.
//   rod: false hides the rod; rodLook {kind, shaft, grip, reel, tip, glow} or a Lab rod id overrides the 'auto' rod skin.
//   trail: false suppresses the trail effect (thumbnails).
// Look (state.character): {tint, eyes, mouth, hat, hair, top, bottom, gloves, shoes, back, face, trail, emote, rod,
//   boat (legacy hull hex), labRod (Lab rod id shown by the 'auto' rod skin)}. normalizeLook() migrates old
//   fish-person looks ({skin, outfit, boots, acc, ...}) safely.
// Cosmetics: WARDROBE [{id, slot, value, name, rarity, price | unlock:'package'|'skill', skill (Lab node id), desc}],
//   WARDROBE_SLOTS, WARDROBE_BY_ID, ownsCosmetic(state, item|id), grantCosmetic(state, id), packageCosmetics(rarity),
//   equipItem(look, item), isEquipped(look, item), boatPaint(look), itemPreview / drawItemPreview (thumbnails),
//   EMOTES, warmCharacter, characterStats, setCharacterBudget.
// Face helpers shared with npcs.js: faceFeatures(...), drawFaceLayer(...), drawCartoonEye(...), drawCartoonMouth(...).

import { VoxelModel, renderVoxels } from './voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { shade, mix, hexToRgb, hslToRgb, rgba } from '../core/color.js';
import { clamp, clamp01, lerp, hash3, hash2, TAU, smoothstep } from '../core/math.js';
import { drawFishRig } from './fishrig.js';
import { ROD_BY_ID } from '../game/rods.js';

// ====================================================================== wardrobe data

// Bubble tints: tint colour, thin-film rainbow (hue start/span in degrees, strength), base transparency, rim colour.
export const TINTS = {
  aqua: { tint: '#7fe0ff', hue: 170, span: 230, irid: 0.75, alpha: 0.34, deep: '#1a6aa8' },
  mint: { tint: '#8affd0', hue: 110, span: 220, irid: 0.7, alpha: 0.34, deep: '#16806a' },
  sky: { tint: '#9cc4ff', hue: 200, span: 200, irid: 0.7, alpha: 0.36, deep: '#2a4aa8' },
  lime: { tint: '#c8ff7a', hue: 60, span: 200, irid: 0.65, alpha: 0.36, deep: '#3a8a1a' },
  rose: { tint: '#ffaad8', hue: 300, span: 220, irid: 0.7, alpha: 0.36, deep: '#a83a7a' },
  lemon: { tint: '#fff07a', hue: 30, span: 200, irid: 0.6, alpha: 0.38, deep: '#a8801a' },
  lilac: { tint: '#cfb0ff', hue: 250, span: 220, irid: 0.75, alpha: 0.36, deep: '#5a3aa8' },
  pearl: { tint: '#f6faff', hue: 180, span: 300, irid: 0.95, alpha: 0.5, deep: '#5a7ab0' },
  oil: { tint: '#6a78b0', hue: 0, span: 640, irid: 1, alpha: 0.6, deep: '#2a2a6a' },
  aurora: { tint: '#7affc0', hue: 120, span: 160, irid: 0.9, alpha: 0.42, deep: '#2a3a8a', special: 'aurora' },
  chrome: { tint: '#dfe8f2', hue: 200, span: 60, irid: 0.25, alpha: 1, deep: '#3a4a64', special: 'chrome' },
  gold: { tint: '#ffd23a', hue: 40, span: 30, irid: 0.25, alpha: 1, deep: '#8a5a0a', special: 'gold' },
  galaxy: { tint: '#3a2a7a', hue: 260, span: 120, irid: 0.6, alpha: 0.86, deep: '#120a3a', special: 'stars' },
};
const skinOfTint = (T) => (T.special === 'gold' ? '#ffd84a' : T.special === 'chrome' ? '#cfd8e4' : T.special === 'stars' ? '#7a68d8' : mix(T.tint, '#ffffff', 0.4));

// Eye styles (cartoon): drawn live on the bubble. See eyePixel().
export const EYE_STYLES = ['bean', 'sparkle', 'anime', 'happy', 'sleepy', 'star', 'heart', 'swirl', 'led', 'wink', 'dot', 'teary', 'derp'];
export const MOUTH_STYLES = ['smile', 'grin', 'cat', 'o', 'tongue', 'fang', 'smirk', 'toothy', 'kiss', 'wobbly', 'beam'];

export const WARDROBE_SLOTS = [
  { id: 'tint', name: 'Bubble', desc: 'Bubble tint and shimmer', icon: 'bubble' },
  { id: 'eyes', name: 'Eyes', desc: 'Cartoon peepers', icon: 'eyes' },
  { id: 'mouth', name: 'Mouth', desc: 'Smiles and grins', icon: 'mouth' },
  { id: 'hat', name: 'Hats', desc: 'Headwear', icon: 'hat' },
  { id: 'hair', name: 'Hair', desc: 'Hair, sprouts and antennae', icon: 'hair' },
  { id: 'face', name: 'Face', desc: 'Glasses and face fun', icon: 'face' },
  { id: 'top', name: 'Tops', desc: 'Shirts and jackets', icon: 'top' },
  { id: 'bottom', name: 'Bottoms', desc: 'Shorts, skirts, pants', icon: 'bottom' },
  { id: 'gloves', name: 'Gloves', desc: 'Handwear', icon: 'gloves' },
  { id: 'shoes', name: 'Shoes', desc: 'Footwear', icon: 'shoes' },
  { id: 'back', name: 'Packs', desc: 'Backpacks and wings', icon: 'back' },
  { id: 'trail', name: 'Trails', desc: 'Sparkly trails', icon: 'trail' },
  { id: 'emote', name: 'Emotes', desc: 'Your signature move', icon: 'emote' },
  { id: 'rod', name: 'Rod Skins', desc: 'Rod looks (stats come from the Lab)', icon: 'rod' },
];

const it = (slot, value, name, rarity, price, desc, extra = {}) => ({ id: slot + '_' + value, slot, value, name, rarity, price, desc, ...extra });
const pkg = { price: null, unlock: 'package' };
const lab = (node) => ({ price: null, unlock: 'skill', skill: node });

export const WARDROBE = [
  // bubble tints
  it('tint', 'aqua', 'Aqua Bubble', 'common', 0, 'Fresh tap-water shimmer.'),
  it('tint', 'mint', 'Mint Fizz', 'common', 60, 'Cool, minty and slightly sparkling.'),
  it('tint', 'sky', 'Sky Glass', 'common', 60, 'A little piece of blue sky.'),
  it('tint', 'lime', 'Lime Pop', 'uncommon', 160, 'Zesty green with a sunny rim.'),
  it('tint', 'rose', 'Rose Soap', 'uncommon', 160, 'Smells like bubble bath.'),
  it('tint', 'lemon', 'Lemon Drop', 'uncommon', 180, 'Sunshine in a bubble.'),
  it('tint', 'lilac', 'Lilac Haze', 'rare', 420, 'Dreamy violet shimmer.'),
  it('tint', 'pearl', 'Pearl Gloss', 'rare', 560, 'Clear as glass, all rainbow.'),
  it('tint', 'oil', 'Oil Slick', 'epic', null, 'Every colour at once. From crates.', pkg),
  it('tint', 'aurora', 'Aurora Film', 'epic', 1400, 'Northern lights swirl inside.'),
  it('tint', 'chrome', 'Chrome Orb', 'epic', null, 'A mirror-polished head. Reflects the whole sky.', lab('rod_chrome')),
  it('tint', 'gold', 'Golden Orb', 'legendary', null, 'Solid shine. Legendary crates only.', pkg),
  it('tint', 'galaxy', 'Galaxy Bubble', 'legendary', null, 'A tiny universe on your shoulders.', pkg),
  // eyes
  it('eyes', 'bean', 'Glossy Beans', 'common', 0, 'Big, dark and shiny.'),
  it('eyes', 'sparkle', 'Sparkle Eyes', 'common', 50, 'Bright aqua irises.'),
  it('eyes', 'dot', 'Dot Eyes', 'common', 40, 'Simple. Iconic. Tiny.'),
  it('eyes', 'happy', 'Happy Arcs', 'uncommon', 120, 'Always smiling with the eyes.'),
  it('eyes', 'sleepy', 'Sleepy Eyes', 'uncommon', 120, 'Five more minutes...'),
  it('eyes', 'anime', 'Anime Eyes', 'uncommon', 200, 'Extra sparkle, extra feelings.'),
  it('eyes', 'wink', 'Winky', 'uncommon', 180, 'You know what I mean.'),
  it('eyes', 'teary', 'Puppy Eyes', 'rare', 380, 'Impossible to say no to.'),
  it('eyes', 'derp', 'Derp Eyes', 'rare', 360, 'Each one has its own opinion.'),
  it('eyes', 'star', 'Star Eyes', 'rare', 480, 'Dazzled by every fish.'),
  it('eyes', 'led', 'LED Eyes', 'epic', null, 'Robot mode: on. Lab tech.', lab('trace1')),
  it('eyes', 'heart', 'Heart Eyes', 'epic', null, 'In love with every catch.', pkg),
  it('eyes', 'swirl', 'Swirly Eyes', 'epic', null, 'Spun around one too many times.', pkg),
  // mouths
  it('mouth', 'smile', 'Sweet Smile', 'common', 0, 'A happy little curve.'),
  it('mouth', 'grin', 'Big Grin', 'common', 40, 'All teeth, all the time.'),
  it('mouth', 'cat', 'Cat Mouth', 'common', 60, ':3'),
  it('mouth', 'o', 'Ooh', 'uncommon', 100, 'Permanently amazed.'),
  it('mouth', 'tongue', 'Bleh!', 'uncommon', 120, 'Tongue out, worries out.'),
  it('mouth', 'fang', 'Cute Fang', 'uncommon', 150, 'One tiny fang. Mostly harmless.'),
  it('mouth', 'smirk', 'Smirk', 'rare', 320, 'Knows something you don\'t.'),
  it('mouth', 'toothy', 'Buck Teeth', 'rare', 300, 'Great for nibbling kelp.'),
  it('mouth', 'wobbly', 'Wobbly', 'rare', 340, 'Nervous but trying.'),
  it('mouth', 'kiss', 'Smooch', 'epic', null, 'Mwah! From a treasure crate.', pkg),
  it('mouth', 'beam', 'Mega Beam', 'epic', 1100, 'The biggest smile in any ocean.'),
  // hats
  it('hat', 'none', 'No Hat', 'common', 0, 'Let the bubble breathe.'),
  it('hat', 'cap', 'Aqua Cap', 'common', 0, 'Sporty, glossy, sunny.'),
  it('hat', 'beanie', 'Pom Beanie', 'common', 90, 'Knitted by a cosy grandma.'),
  it('hat', 'bucket', 'Sun Bucket', 'uncommon', 180, 'White, breezy and a bit floppy.'),
  it('hat', 'headphones', 'Aero Phones', 'uncommon', 260, 'Glossy white. Plays ocean sounds.'),
  it('hat', 'propeller', 'Propeller Cap', 'uncommon', 240, 'Spins when you get excited.'),
  it('hat', 'flower', 'Flower Crown', 'rare', 420, 'Fresh from the hillside.'),
  it('hat', 'sunhat', 'Straw Sunhat', 'rare', 380, 'For long lazy days at the pier.'),
  it('hat', 'captain', 'Captain Hat', 'rare', null, 'Earned by owning a real yacht.', lab('boat_yacht')),
  it('hat', 'tophat', 'Aqua Top Hat', 'epic', 1300, 'Very fancy. Very tall.'),
  it('hat', 'crown', 'Crystal Crown', 'legendary', null, 'For the ruler of the bubbles. Crates only.', pkg),
  // hair & antennae
  it('hair', 'none', 'Smooth Bubble', 'common', 0, 'Clean and round.'),
  it('hair', 'sprout', 'Leaf Sprout', 'common', 0, 'Growing a little every day.'),
  it('hair', 'curl', 'Cowlick', 'common', 70, 'Will not lie flat. Ever.'),
  it('hair', 'antenna', 'Orb Antenna', 'uncommon', 150, 'Picks up fish radio.'),
  it('hair', 'twin', 'Star Feelers', 'uncommon', 200, 'Two antennae, two stars.'),
  it('hair', 'ears', 'Kitty Ears', 'uncommon', 220, 'Purrfectly cute.'),
  it('hair', 'bun', 'Bubble Bun', 'rare', 360, 'A tiny bubble on your bubble.'),
  it('hair', 'fluff', 'Science Fluff', 'rare', 400, 'Big hair, big ideas.'),
  it('hair', 'mohawk', 'Wave Mohawk', 'epic', 1000, 'Ride the wave.'),
  it('hair', 'halo', 'Glow Halo', 'legendary', null, 'Angelic. Found in legendary crates.', pkg),
  // face accessories
  it('face', 'none', 'Bare Face', 'common', 0, 'Nothing to hide.'),
  it('face', 'blush', 'Heart Blush', 'common', 50, 'Little heart stickers.'),
  it('face', 'freckles', 'Freckles', 'common', 40, 'Sun-kissed.'),
  it('face', 'round', 'Round Specs', 'uncommon', 140, 'Smart and round.'),
  it('face', 'shades', 'Cool Shades', 'uncommon', 200, 'Too cool for the reef.'),
  it('face', 'bandaid', 'Plaster', 'uncommon', 90, 'Bonked by a boat. Tough bubble.'),
  it('face', 'mustache', 'Grand Mustache', 'rare', 320, 'Took years to grow.'),
  it('face', 'goggles', 'Dive Goggles', 'rare', 420, 'Ready for the deep end.'),
  it('face', 'monocle', 'Monocle', 'rare', 480, 'Indubitably.'),
  it('face', 'visor', 'Hydro Visor', 'epic', null, 'Glass visor with a sonar HUD. Lab tech.', lab('boat_sonar')),
  it('face', 'heart', 'Heart Shades', 'epic', 1200, 'Love at first cast.'),
  it('face', 'star', 'Star Shades', 'epic', null, 'Pop-star sparkle. From crates.', pkg),
  // tops
  it('top', 'tee', 'Aero Tee', 'common', 0, 'White tee with a water-drop logo.'),
  it('top', 'hoodie', 'Sky Hoodie', 'common', 120, 'Pocket full of snacks.'),
  it('top', 'raincoat', 'Lime Raincoat', 'uncommon', 220, 'Glossy, waterproof, cheerful.'),
  it('top', 'sailor', 'Sailor Top', 'uncommon', 260, 'Navy collar, red kerchief.'),
  it('top', 'jersey', 'Dolphin Jersey', 'uncommon', 280, 'Number 7, the luckiest fish.'),
  it('top', 'puffer', 'Bubble Puffer', 'rare', 520, 'Puffy as a pufferfish.'),
  it('top', 'labcoat', 'Lab Coat', 'rare', null, 'Science! Unlocked in the Lab.', lab('lab_slot2')),
  it('top', 'leafy', 'Leaf Poncho', 'rare', 480, 'Woven from a hundred leaves.'),
  it('top', 'tux', 'Aqua Tux', 'epic', 1500, 'For very formal splashes.'),
  it('top', 'astro', 'Astro Suit', 'legendary', null, 'One small cast for a bubble. Crates only.', pkg),
  // bottoms
  it('bottom', 'shorts', 'Board Shorts', 'common', 0, 'Aqua with white waves.'),
  it('bottom', 'jeans', 'Comfy Jeans', 'common', 80, 'Rolled up for wading.'),
  it('bottom', 'skirt', 'Sky Skirt', 'uncommon', 160, 'Twirls nicely.'),
  it('bottom', 'cargo', 'Cargo Shorts', 'uncommon', 150, 'Pockets for every lure.'),
  it('bottom', 'leggings', 'Lime Leggings', 'uncommon', 180, 'Sporty stripes.'),
  it('bottom', 'swim', 'Hibiscus Trunks', 'rare', 360, 'Vacation mode: on.'),
  it('bottom', 'astro', 'Astro Pants', 'legendary', null, 'Matches the Astro Suit. Crates only.', pkg),
  // gloves
  it('gloves', 'none', 'Bare Hands', 'common', 0, 'Soft and squishy.'),
  it('gloves', 'mitts', 'Toon Gloves', 'common', 60, 'Classic white cartoon gloves.'),
  it('gloves', 'rubber', 'Rubber Gloves', 'common', 70, 'Fish slime? No problem.'),
  it('gloves', 'garden', 'Garden Gloves', 'uncommon', 150, 'Green thumbs included.'),
  it('gloves', 'chrome', 'Robo Hands', 'rare', 520, 'Shiny servo grip.'),
  it('gloves', 'boxing', 'Boxing Gloves', 'epic', 1100, 'Fight the fish fair and square.'),
  it('gloves', 'gold', 'Golden Gloves', 'legendary', null, 'Grip of a champion. Crates only.', pkg),
  // shoes
  it('shoes', 'sneakers', 'Aero Sneakers', 'common', 0, 'White with aqua swooshes.'),
  it('shoes', 'boots', 'Rain Boots', 'common', 60, 'Squeaky and puddle-proof.'),
  it('shoes', 'sandals', 'Beach Sandals', 'common', 70, 'Flip, flop.'),
  it('shoes', 'flippers', 'Lime Flippers', 'uncommon', 220, 'Flap flap flap.'),
  it('shoes', 'slippers', 'Dolphin Slippers', 'rare', 420, 'They squeak like dolphins.'),
  it('shoes', 'moon', 'Moon Boots', 'epic', null, 'Big, bouncy, crate-only.', pkg),
  it('shoes', 'jet', 'Hover Boots', 'epic', null, 'Glow-soled hover tech from the Lab.', lab('boat_engine')),
  // backpacks
  it('back', 'none', 'No Pack', 'common', 0, 'Travel light.'),
  it('back', 'satchel', 'Explorer Satchel', 'common', 90, 'Snacks, maps and a spare worm.'),
  it('back', 'cape', 'Cloud Cape', 'uncommon', 260, 'Fluffy clouds on sky blue.'),
  it('back', 'wings', 'Leaf Wings', 'rare', 520, 'Glide like a falling leaf.'),
  it('back', 'turbine', 'Turbine Pack', 'rare', 600, 'A tiny wind turbine. Clean energy!'),
  it('back', 'solar', 'Solar Wings', 'epic', 1400, 'Charged by sunshine.'),
  it('back', 'tank', 'Fish Tank Pack', 'epic', null, 'Your buddy comes along. Lab aquarium tech.', lab('tank_reef')),
  it('back', 'jetpack', 'Bubble Jetpack', 'legendary', null, 'Twin bubble tanks. Whoosh! Crates only.', pkg),
  // trails
  it('trail', 'none', 'No Trail', 'common', 0, 'Leave no trace.'),
  it('trail', 'bubbles', 'Bubble Trail', 'common', 0, 'Pop pop pop.'),
  it('trail', 'drops', 'Rain Drops', 'uncommon', 140, 'A little personal drizzle.'),
  it('trail', 'leaves', 'Leaf Trail', 'uncommon', 180, 'Fresh green leaves.'),
  it('trail', 'notes', 'Music Notes', 'rare', 360, 'Hums while fishing.'),
  it('trail', 'sparkle', 'Sparkle Trail', 'rare', 420, 'Lens flares everywhere.'),
  it('trail', 'hearts', 'Heart Trail', 'epic', null, 'Love is in the water. Crates only.', pkg),
  it('trail', 'rainbow', 'Rainbow Trail', 'legendary', null, 'Leaves a little rainbow. Crates only.', pkg),
  // emotes
  it('emote', 'wave', 'Hi There', 'common', 0, 'A friendly wave.'),
  it('emote', 'cheer', 'Hooray', 'common', 0, 'Jump for joy!'),
  it('emote', 'laugh', 'Giggle', 'uncommon', 120, 'Can\'t stop laughing.'),
  it('emote', 'flex', 'Flex', 'uncommon', 160, 'Look at these noodle arms.'),
  it('emote', 'dance', 'Bubble Dance', 'rare', 400, 'Wiggle wiggle.'),
  it('emote', 'hearts', 'Lovely', 'rare', 380, 'Hearts everywhere.'),
  it('emote', 'bubbles', 'Bubble Burst', 'epic', null, 'Pop into a cloud of bubbles. Crates only.', pkg),
  // rod skins (stats always come from the Lab rod)
  it('rod', 'auto', 'Lab Original', 'common', 0, 'Your rod exactly as the Lab built it.'),
  it('rod', 'wand', 'Bubble Wand', 'common', 90, 'Blows a bubble every cast.'),
  it('rod', 'candy', 'Candy Cane', 'uncommon', 220, 'Minty! Do not lick.'),
  it('rod', 'leafy', 'Sprouting Rod', 'uncommon', 260, 'Still growing leaves.'),
  it('rod', 'chrome', 'Chrome Rod', 'rare', 520, 'Mirror shine.'),
  it('rod', 'coral', 'Coral Wand', 'rare', 560, 'Grown on a reef.'),
  it('rod', 'neon', 'Neon Rod', 'epic', null, 'Glows in the deep. Crates only.', pkg),
  it('rod', 'prism', 'Prism Rod', 'epic', null, 'Splits light into rainbows. Lab crystal.', lab('rod_prism')),
  it('rod', 'golden', 'Golden Rod', 'legendary', 4000, 'Pure gold. Fish just give up.'),
];
export const WARDROBE_BY_ID = Object.fromEntries(WARDROBE.map((w) => [w.id, w]));

export const EMOTES = {
  wave: { pose: 'wave', fx: null }, cheer: { pose: 'cheer', fx: 'confetti' }, laugh: { pose: 'laugh', fx: 'haha' },
  flex: { pose: 'flex', fx: 'sparkle' }, dance: { pose: 'dance', fx: 'notes' }, hearts: { pose: 'wave', fx: 'hearts' }, bubbles: { pose: 'cheer', fx: 'bubbles' },
};

export const DEFAULT_CHARACTER = {
  tint: 'aqua', eyes: 'bean', mouth: 'smile', hat: 'none', hair: 'sprout', face: 'none', top: 'tee', bottom: 'shorts',
  gloves: 'none', shoes: 'sneakers', back: 'none', trail: 'none', emote: 'wave', rod: 'auto', boat: '#2fb8e8',
};
const SLOT_KEYS = ['tint', 'eyes', 'mouth', 'hat', 'hair', 'face', 'top', 'bottom', 'gloves', 'shoes', 'back', 'trail', 'emote', 'rod'];
const VALID = {};
for (const w of WARDROBE) (VALID[w.slot] ||= new Set()).add(w.value);
// NPC-only values (never in the wardrobe, still valid in a look)
for (const [k, v] of [['rod', 'none'], ['top', 'coat'], ['bottom', 'navy'], ['hat', 'sailor'], ['hair', 'pony'], ['face', 'lashes']]) VALID[k].add(v);

// Old fish-person looks -> bubble person.
const LEGACY = {
  skin: { green: 'lime', lime: 'lime', mint: 'mint', swamp: 'lime', forest: 'mint', kelp: 'mint', blue: 'sky', orange: 'lemon', pink: 'rose', purple: 'lilac', gold: 'gold' },
  eyes: { goofy: 'bean', googly: 'derp', sleepy: 'sleepy', angry: 'bean', starry: 'star', hearts: 'heart', dizzy: 'swirl' },
  mouth: { pout: 'smile', grin: 'grin', buck: 'toothy', tongue: 'tongue', whistle: 'o', smooch: 'kiss' },
  hat: { bucket: 'bucket', captain: 'captain', propeller: 'propeller', cowboy: 'sunhat', souwester: 'bucket', party: 'beanie', chef: 'tophat', viking: 'cap', cone: 'cap', crown: 'crown' },
  outfit: { overalls: ['tee', 'jeans'], raincoat: ['raincoat', 'jeans'], hawaiian: ['tee', 'swim'], hoodie: ['hoodie', 'jeans'], wetsuit: ['jersey', 'leggings'], tuxedo: ['tux', 'jeans'], astronaut: ['astro', 'astro'], pajamas: ['hoodie', 'leggings'] },
  boots: { yellow: 'boots', red: 'boots', sneakers: 'sneakers', bare: 'sandals', flippers: 'flippers', cowboy: 'boots', slippers: 'slippers' },
  gloves: { none: 'none', rubber: 'rubber', fingerless: 'mitts', mittens: 'garden', oven: 'mitts', boxing: 'boxing', gold: 'gold' },
  acc: { sunglasses: 'shades', monocle: 'monocle', snorkel: 'goggles', mustache: 'mustache' },
  rod: { bamboo: 'auto', candy: 'candy', carbon: 'chrome', neon: 'neon', golden: 'golden', laser: 'neon' },
};

// Fill in defaults, migrate old looks, drop unknown ids (old saves stay valid).
export function normalizeLook(look) {
  const src = look && typeof look === 'object' ? look : {};
  const L = { ...DEFAULT_CHARACTER };
  if (!src.tint && (src.skin || src.outfit)) {
    // legacy fish-person look
    L.tint = LEGACY.skin[src.skin] || 'aqua';
    L.eyes = LEGACY.eyes[src.eyes] || 'bean';
    L.mouth = LEGACY.mouth[src.mouth] || 'smile';
    L.hat = LEGACY.hat[src.hat] || 'none';
    const o = LEGACY.outfit[src.outfit];
    if (o) { L.top = o[0]; L.bottom = o[1]; }
    L.shoes = LEGACY.boots[src.boots] || 'sneakers';
    L.gloves = LEGACY.gloves[src.gloves] || 'none';
    const acc = Array.isArray(src.acc) ? src.acc : [];
    for (const a of acc) { if (LEGACY.acc[a]) L.face = LEGACY.acc[a]; if (a === 'backpack') L.back = 'satchel'; }
    L.rod = LEGACY.rod[src.rod] || 'auto';
  } else {
    for (const k of SLOT_KEYS) if (typeof src[k] === 'string' && VALID[k]?.has(src[k])) L[k] = src[k];
  }
  if (typeof src.boat === 'string' && /^#[0-9a-f]{6}$/i.test(src.boat)) L.boat = src.boat;
  if (typeof src.labRod === 'string' && ROD_BY_ID[src.labRod]) L.labRod = src.labRod;
  return L;
}

// Owned = free, granted (state.cosmetics[id] or a Lab 'cosmetic:<id>' unlock) or its Lab node is researched.
export function ownsCosmetic(state, item) {
  if (typeof item === 'string') item = WARDROBE_BY_ID[item];
  if (!item) return false;
  if (item.price === 0) return true;
  if (state?.cosmetics?.[item.id]) return true;
  if (state?.lab?.unlocks?.['cosmetic:' + item.id]) return true;
  return item.unlock === 'skill' && !!(state?.lab?.done?.[item.skill] || state?.skills?.[item.skill]);
}

export function grantCosmetic(state, id) {
  if (!WARDROBE_BY_ID[id]) return false;
  (state.cosmetics ||= {})[id] = true;
  return true;
}

// Cosmetics that can drop from crates / floaters, optionally filtered by rarity.
export function packageCosmetics(rarity = null) {
  return WARDROBE.filter((w) => w.unlock === 'package' && (!rarity || w.rarity === rarity)).map((w) => w.id);
}

export function isEquipped(look, item) {
  if (!item) return false;
  const L = normalizeLook(look);
  if (item.slot === 'boat') return L.boat.toLowerCase() === String(item.color || '').toLowerCase();
  return L[item.slot] === item.value;
}

// Returns a new look with the item equipped.
export function equipItem(look, item) {
  const L = normalizeLook(look);
  if (!item) return L;
  if (item.slot === 'boat') { if (item.color) L.boat = item.color; return L; }
  if (SLOT_KEYS.includes(item.slot)) L[item.slot] = item.value;
  return L;
}

// Legacy boat paint (the Boat tab of the wardrobe keeps look.boat in sync with state.boat.parts.hull).
const HULL_NAMES = { '#2fb8e8': ['Aqua Gloss', '#ffffff'], '#c8583a': ['Tomato Red', '#f2e6c8'] };
export function boatPaint(look) {
  const hex = normalizeLook(look).boat;
  const n = HULL_NAMES[hex.toLowerCase()];
  return { hull: hex, trim: n?.[1] || '#ffffff', name: n?.[0] || 'Custom' };
}

export function emotePose(look) { return (EMOTES[normalizeLook(look).emote] || EMOTES.wave).pose; }

// The rod look ({kind, shaft, grip, reel, tip, glow}) for a look: a skin, or the Lab rod for 'auto'.
const ROD_SKINS = {
  wand: { kind: 'wand', shaft: '#8ee8ff', grip: '#2fb8e8', reel: '#ffffff', tip: '#ff9ad0', glow: '#bff6ff' },
  candy: { kind: 'stick', shaft: '#ff4a5a', grip: '#2aa84a', reel: '#ffffff', tip: '#ffd23a', stripe: '#ffffff' },
  leafy: { kind: 'stick', shaft: '#6ad04a', grip: '#3a8a2a', reel: '#f6d27a', tip: '#c8f56a', leaves: true },
  chrome: { kind: 'carbon', shaft: '#e8eef4', grip: '#2a4a6a', reel: '#bcd4e4', tip: '#59c3ff' },
  coral: { kind: 'wand', shaft: '#ff8a7a', grip: '#c84a5a', reel: '#ffd0c0', tip: '#ffe8a8' },
  neon: { kind: 'carbon', shaft: '#3affd8', grip: '#24243a', reel: '#3a3a5a', tip: '#ff3ad8', glow: '#3affd8', emissive: true },
  prism: { kind: 'crystal', shaft: '#ffffff', grip: '#ff9ad0', reel: '#8ee8ff', tip: '#fff6a0', glow: '#ffffff', rainbow: true },
  golden: { kind: 'carbon', shaft: '#f2c23a', grip: '#8a2238', reel: '#ffe27a', tip: '#ffffff', gold: true },
};
const TWIG = { kind: 'stick', shaft: '#b88a52', grip: '#7a5432', reel: '#c8c8c8', tip: '#e8e0c8' };
function rodLookOf(L, o = {}) {
  if (L.rod !== 'auto') return ROD_SKINS[L.rod] || TWIG;
  if (o.rodLook && typeof o.rodLook === 'object') return o.rodLook;
  const id = typeof o.rod === 'string' ? o.rod : L.labRod;
  return ROD_BY_ID[id]?.look || TWIG;
}

const lookKey = (L, rl) => SLOT_KEYS.map((k) => L[k]).join('|') + '|' + (L.rod === 'auto' ? JSON.stringify(rl) : '');

// ====================================================================== small 3D math (3x3 + translation)

const DEG = Math.PI / 180;
function rot(rx = 0, ry = 0, rz = 0) {
  const a = rx * DEG, b = ry * DEG, c = rz * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
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
function torus(m, cx, cy, cz, R, r, c, axis = 'y', sx = 1, sy = 1) {
  const e = (R + r + 1) * Math.max(sx, sy);
  shape(m, cx - e, cy - e, cz - e, cx + e, cy + e, cz + e, (x, y, z) => {
    let a, b, h;
    if (axis === 'z') { a = (x - cx) / sx; b = (y - cy) / sy; h = z - cz; } else if (axis === 'y') { a = (x - cx) / sx; b = (z - cz) / sy; h = y - cy; } else { a = (y - cy) / sx; b = (z - cz) / sy; h = x - cx; }
    const q = Math.hypot(a, b) - R;
    return q * q + h * h <= r * r;
  }, c);
}
function frontZ(m, x, y) {
  for (let z = m.nz - 1; z >= 0; z--) if (m.get(x, y, z)) return z;
  return -1;
}
function backZ(m, x, y) {
  for (let z = 0; z < m.nz; z++) if (m.get(x, y, z)) return z;
  return -1;
}
const hsh = (x, y, z, s) => hash3(x, y, z, s);
// 2D pixel-pattern stamped on the front surface: rows top->bottom, chars map to palette indices.
function decal(m, cx, top, rows, map, zOff = 0) {
  const w = rows[0].length;
  rows.forEach((row, j) => {
    for (let i = 0; i < w; i++) {
      const c = map[row[i]];
      if (!c) continue;
      const x = Math.floor(cx - w / 2 + i), y = Math.floor(top - j);
      const z = frontZ(m, x, y);
      if (z > 0) m.set(x, y, z + zOff, c);
    }
  });
}

// ====================================================================== kit (per look: palette + lazily built parts)

const KITS = new Map();
function kitFor(look, rl) {
  const key = lookKey(look, rl);
  let k = KITS.get(key);
  if (k) { KITS.delete(key); KITS.set(key, k); return k; }
  k = makeKit(look, key, rl);
  KITS.set(key, k);
  if (KITS.size > 48) KITS.delete(KITS.keys().next().value);
  return k;
}

function makeKit(L, key, rl) {
  const holder = new VoxelModel(1, 1, 1);
  const memo = new Map();
  const T = TINTS[L.tint] || TINTS.aqua;
  const kit = {
    key, look: L, rl, T, pal: holder.palette, parts: new Map(), isBub: new Uint8Array(256), isGlass: new Uint8Array(256), handSet: new Set(),
    col(hex, opts = {}) {
      const k = hex + '|' + JSON.stringify(opts);
      let i = memo.get(k);
      if (i === undefined) { i = holder.color(hex, { jitter: 0.05, ...opts }); memo.set(k, i); }
      return i;
    },
    glass(hex, opts = {}) { const i = this.col(hex, { smooth: 1, jitter: 0, spec: 1.3, specPow: 12, light: 0.25, glass: 1, ...opts }); this.isGlass[i] = 1; return i; },
    part(name, build) {
      let p = this.parts.get(name);
      if (!p) { p = build(); p.b = p.m.bounds(); this.parts.set(name, p); }
      return p;
    },
    model(nx, ny, nz) { const m = new VoxelModel(nx, ny, nz); m.palette = this.pal; return m; },
  };
  const skin = skinOfTint(T);
  kit.skinHex = skin;
  const sh = { smooth: 0.85, jitter: 0.02, spec: 0.9, specPow: 12, edge: 0.35, aoMul: 0.6 };
  kit.c = {
    bub: kit.col(T.tint, { smooth: 1, jitter: 0, spec: 1, specPow: 14, edge: 0.6, aoMul: 0.3, light: 0.15, bub: 1 }),
    skin: kit.col(skin, sh),
    skinD: kit.col(shade(skin, -0.14), sh),
    ring: kit.col('#f4fbff', { smooth: 0.8, spec: 1.4, specPow: 10, jitter: 0, light: 0.2 }),
    ringD: kit.col('#9fd6ee', { smooth: 0.8, spec: 1, jitter: 0 }),
  };
  kit.isBub[kit.c.bub] = 1;
  kit.hand = handCol(kit, skin, sh);
  kit.handD = handCol(kit, shade(skin, -0.14), sh);
  return kit;
}
function handCol(kit, hex, opts = {}) {
  const i = kit.col(hex, { ...opts, hand: 1 });
  kit.handSet.add(i);
  return i;
}
const K = (kit, h, o = {}) => kit.col(h, { smooth: 0.35, jitter: 0.05, ...o });
const KG = (kit, h, o = {}) => kit.col(h, { smooth: 0.8, jitter: 0.02, spec: 1.1, specPow: 12, ...o }); // glossy plastic

// ---------------------------------------------------------------------- bubble head (pivot = neck)

const HEAD = { nx: 32, ny: 46, nz: 32, cx: 16, cy: 15, cz: 16, R: 12.5, pivot: [16, 1.6, 16] };
const HAT_SEAT = [16, 15 + 9.2, 16 - 0.6];

function buildHead(kit) {
  const L = kit.look, C = kit.c;
  const m = kit.model(HEAD.nx, HEAD.ny, HEAD.nz);
  const { cx, cy, cz, R } = HEAD;
  m.sphere(cx, cy, cz, R, C.bub);
  const hatOn = L.hat !== 'none';
  buildHair(m, kit, L.hair, hatOn);
  return { m, pivot: HEAD.pivot, anchors: { center: [cx, cy, cz], top: [cx, cy + R + (L.hair === 'none' || hatOn ? 0 : 4), cz] }, R };
}

// Hair / antennae on top of the bubble (most hide under a hat).
function buildHair(m, kit, id, hatOn) {
  const { cx, cy, cz, R } = HEAD;
  const top = cy + R - 0.5;
  if (id === 'none') return;
  if (hatOn && !['ears', 'halo', 'fluff'].includes(id)) return;
  if (id === 'sprout') {
    const stem = K(kit, '#3fae2a'), leaf = KG(kit, '#7ee04a'), leafD = KG(kit, '#4cb82e'), vein = K(kit, '#c8f56a', { jitter: 0 });
    m.line(cx, top, cz, cx, top + 4, cz, stem, 0.55);
    for (const s of [-1, 1]) {
      shape(m, cx - 7, top + 2, cz - 3, cx + 7, top + 9, cz + 3, (x, y, z) => {
        const u = (x - cx) * s, v = y - (top + 4.2) - u * 0.32;
        return u > 0 && u < 6 && Math.abs(z - cz) < 1 && Math.abs(v) < Math.sin((u / 6) * Math.PI) * 1.9;
      }, (x, y) => (Math.abs(y - (top + 4.2) - (x - cx) * s * 0.32) < 0.5 ? vein : (x - cx) * s > 3 ? leaf : leafD));
    }
  } else if (id === 'antenna' || id === 'twin') {
    const stalk = KG(kit, '#e8f4ff'), orb = id === 'twin' ? KG(kit, '#ffd84a', { emissive: 0.35 }) : KG(kit, '#59e0ff', { emissive: 0.45 });
    const tips = id === 'twin' ? [[-4, 7.5, -0.6], [4, 7.5, 0.6]] : [[0, 8.5, -1]];
    for (const [dx, h, lean] of tips) {
      const bx = cx + dx * 0.55, by = cy + Math.sqrt(R * R - (dx * 0.55) ** 2) - 0.6;
      m.line(bx, by, cz, cx + dx, by + h - 1.5, cz + lean, stalk, 0.5);
      if (id === 'twin') {
        for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1.5, 0.8], [-1.5, 0.8], [1, -1.4], [-1, -1.4]]) m.set(cx + dx + ox, by + h + oy, cz + lean, orb);
      } else m.sphere(cx + dx, by + h, cz + lean, 2.1, orb);
    }
  } else if (id === 'curl') {
    const hair = KG(kit, shade(kit.T.tint, -0.25));
    const pts = [];
    for (let i = 0; i <= 26; i++) { const a = (i / 26) * TAU * 1.15; const r = 3.4 * (1 - i / 34); pts.push([cx + Math.sin(a) * r * 0.9, top + 2.2 + (1 - Math.cos(a)) * r * 0.75 + i * 0.05, cz - 1]); }
    m.line(cx, top - 0.4, cz - 1, pts[0][0], pts[0][1], pts[0][2], hair, 0.85);
    for (let i = 0; i < pts.length - 1; i++) m.line(...pts[i], ...pts[i + 1], hair, 0.75);
  } else if (id === 'ears') {
    const ear = KG(kit, '#fff4fa'), inner = KG(kit, '#ff9ad0');
    for (const s of [-1, 1]) {
      const ex = cx + s * 6.6, ey = cy + Math.sqrt(R * R - 6.6 * 6.6) - 1.4;
      shape(m, ex - 4, ey, cz - 3, ex + 4, ey + 8, cz + 3, (x, y, z) => {
        const k = (y - ey) / 6.6, w = 3.2 * (1 - k);
        return k >= 0 && k <= 1 && Math.abs(x - ex - s * k * 1.2) < w && Math.abs(z - cz) < 1.3;
      }, (x, y, z) => (z > cz + 0.2 && Math.abs(x - ex - s * ((y - ey) / 6.6) * 1.2) < 2.2 * (1 - (y - ey) / 6.6) - 0.3 ? inner : ear));
    }
  } else if (id === 'bun') {
    m.sphere(cx, top + 4.6, cz - 0.6, 4.4, kit.c.bub);
    torus(m, cx, top + 0.6, cz - 0.6, 2.2, 0.8, kit.c.ring, 'y');
  } else if (id === 'fluff') {
    const fl = kit.col('#f6f8ff', { smooth: 0.9, jitter: 0.12, light: 0.15 }), flD = kit.col('#d8e0f0', { smooth: 0.9, jitter: 0.1 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU, ry = 0.35 + 0.25 * hsh(i, 1, 2, 7);
      const px = cx + Math.cos(a) * R * 0.86, pz = cz + Math.sin(a) * R * 0.86 - 1.5;
      if (pz > cz + R * 0.55) continue; // keep the face clear
      m.sphere(px, cy + R * ry + 2.2, pz, 3.1 + hsh(i, 3, 1, 9) * 1.4, i % 3 ? fl : flD);
    }
    m.sphere(cx - 2, top + 1.6, cz - 3, 3.6, fl);
    m.sphere(cx + 3, top + 1.2, cz - 2, 3.2, flD);
  } else if (id === 'mohawk') {
    const a = KG(kit, '#2fd3e8'), b = KG(kit, '#ffffff'), c = KG(kit, '#1678cc');
    for (let i = 0; i <= 18; i++) {
      const ang = lerp(-0.25, 1.25, i / 18);
      const sy = cy + Math.cos(ang) * R, sz = cz - Math.sin(ang) * R;
      const h = 3 + 2.4 * Math.abs(Math.sin(i * 0.9)) + (i < 6 ? 2 : 0);
      for (let k = -0.5; k <= h; k += 0.5) {
        const y = sy + Math.cos(ang) * k, z = sz - Math.sin(ang) * k + (k / h) * 2.4;
        m.set(cx - 1, y, z, k > h - 1.2 ? b : k > h * 0.5 ? a : c);
        m.set(cx, y, z, k > h - 1.2 ? b : k > h * 0.5 ? a : c);
      }
    }
  } else if (id === 'halo') {
    torus(m, cx, top + 6.5, cz - 1, 5.4, 0.85, kit.col('#fff6b0', { emissive: 0.9, jitter: 0 }), 'y', 1, 0.95);
  } else if (id === 'pony') {
    const hair = KG(kit, '#ff8a5a'), tie = KG(kit, '#2fd3e8');
    m.sphere(cx, top + 0.5, cz - 4, 3.6, hair);
    torus(m, cx, top - 0.6, cz - 8.6, 1.6, 0.8, tie, 'z');
    for (let i = 0; i < 12; i++) m.sphere(cx, top - 1 - i * 0.9, cz - 9.6 - Math.sin(i * 0.3) * 1.6, 2.4 - i * 0.12, hair);
  }
}

// ---------------------------------------------------------------------- hats (pivot = brim centre, sits on HAT_SEAT)

const HAT_TILT = { cap: -8, beanie: -6, bucket: -8, headphones: 0, propeller: -6, flower: -10, sunhat: -10, captain: -10, tophat: -8, crown: -6, sailor: -10 };
function buildHat(kit, spin) {
  const id = kit.look.hat;
  const m = kit.model(40, 28, 40);
  const cx = 20, cz = 20, by = 4; // brim centre (local)
  const dome = (r, h, c, y0 = by) => shape(m, cx - r - 1, y0, cz - r - 1, cx + r + 1, y0 + h + 1, cz + r + 1, (x, y, z) => ((x - cx) / r) ** 2 + ((y - y0) / h) ** 2 + ((z - cz) / r) ** 2 <= 1 && y >= y0, c);
  if (id === 'cap') {
    const a = KG(kit, '#2fb8e8'), w = KG(kit, '#ffffff'), btn = KG(kit, '#ffffff');
    dome(9.2, 7.4, (x, y, z) => (z > cz + 4 && y < by + 5.5 ? w : a));
    shape(m, cx - 7, by - 0.5, cz + 4, cx + 7, by + 1, cz + 15, (x, y, z) => ((x - cx) / 7) ** 2 + ((z - cz - 6) / 8.5) ** 2 <= 1 && z > cz + 6, a);
    m.set(cx, by + 7.6, cz, btn);
    decal(m, cx, by + 4.5, ['.##.', '####', '####', '.##.'], { '#': KG(kit, '#2fb8e8') });
  } else if (id === 'beanie') {
    const a = K(kit, '#8be04a', { jitter: 0.1 }), b = K(kit, '#ffffff', { jitter: 0.08 }), pom = kit.col('#ffffff', { smooth: 0.9, jitter: 0.15 });
    dome(9.4, 8.8, (x, y) => ((Math.floor(y) - by) % 4 < 2 ? a : b));
    torus(m, cx, by + 0.6, cz, 9.0, 1.4, b, 'y');
    m.sphere(cx, by + 10.4, cz, 2.8, pom);
  } else if (id === 'bucket') {
    const w = KG(kit, '#f6fbff'), band = KG(kit, '#2fd3e8'), wD = KG(kit, '#d8eaf6');
    shape(m, cx - 9, by + 1, cz - 9, cx + 9, by + 8, cz + 9, (x, y, z) => { const r = 8.6 - (y - by - 1) * 0.25; return Math.hypot(x - cx, z - cz) <= r && y <= by + 7.4; }, (x, y) => (y < by + 3.2 ? band : w));
    shape(m, cx - 14, by - 1, cz - 14, cx + 14, by + 1, cz + 14, (x, y, z) => { const d = Math.hypot(x - cx, z - cz); return d <= 13.2 && d > 7 && y < by + 1 - (d - 7) * 0.18; }, wD);
  } else if (id === 'headphones') {
    const w = KG(kit, '#ffffff'), lime = KG(kit, '#8be04a'), pad = KG(kit, '#2fd3e8'), grey = KG(kit, '#c8d8e4');
    // band arching over the top, cups on the bubble sides (in hat space the bubble centre is ~9 below)
    const hc = by - 9.2 + 0.6;
    for (let a = 0; a <= Math.PI; a += 0.04) {
      const x = cx + Math.cos(a) * 13.6, y = hc + Math.sin(a) * 13.4;
      for (let dz = -1; dz <= 1; dz++) m.set(x, y, cz + dz, Math.abs(a - Math.PI / 2) < 0.18 ? grey : w);
    }
    // cups would sit below the local grid; extend the model downward via the pivot instead
    for (const s of [-1, 1]) {
      shape(m, cx + s * 13 - 3, 0, cz - 5, cx + s * 13 + 3, 10, cz + 5, (x, y, z) => ((x - cx - s * 14.2) / 2.4) ** 2 + ((y - 2) / 5.4) ** 2 + ((z - cz) / 5.2) ** 2 <= 1, (x) => (Math.abs(x - cx) < 13.2 ? pad : Math.abs(x - cx) > 15.4 ? lime : w));
    }
  } else if (id === 'propeller') {
    const segs = ['#ff5a6a', '#ffd23a', '#5cd84a', '#3fa8ff'].map((h) => KG(kit, h));
    dome(9.2, 7, (x, y, z) => segs[(Math.floor(((Math.atan2(z - cz, x - cx) + Math.PI) / TAU) * 4) % 4 + 4) % 4]);
    shape(m, cx - 6, by - 0.5, cz + 5, cx + 6, by + 0.6, cz + 13, (x, y, z) => ((x - cx) / 6) ** 2 + ((z - cz - 6) / 7) ** 2 <= 1 && z > cz + 6, segs[3]);
    const pole = KG(kit, '#e8eef4'), blade = KG(kit, '#ffffff'), hub = KG(kit, '#ff5a6a');
    m.line(cx, by + 7, cz, cx, by + 9.6, cz, pole, 0.4);
    const a0 = spin ? Math.PI / 4 : 0;
    for (const s of [0, Math.PI]) { const a = a0 + s; m.line(cx, by + 10, cz, cx + Math.cos(a) * 6.5, by + 10, cz + Math.sin(a) * 6.5, blade, 0.9); }
    m.set(cx, by + 10.4, cz, hub);
  } else if (id === 'flower') {
    const leaf = KG(kit, '#5cc832'), cols = ['#ff7ab0', '#fff2a8', '#ffffff', '#ffb04a', '#c8a0ff'].map((h) => KG(kit, h)), mid = KG(kit, '#ffd23a');
    torus(m, cx, by + 1, cz, 8.4, 1.1, leaf, 'y');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.3, fx = cx + Math.cos(a) * 8.6, fz = cz + Math.sin(a) * 8.6, fy = by + 2;
      const c = cols[i % cols.length];
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.sphere(fx + ox * 1.3 * Math.sin(a + 1.57) , fy + oy * 1.3, fz + ox * 1.3 * Math.cos(a + 1.57) * -1, 1.15, c);
      m.sphere(fx + Math.cos(a) * 0.6, fy, fz + Math.sin(a) * 0.6, 0.9, mid);
    }
  } else if (id === 'sunhat') {
    const straw = K(kit, '#f2d28a', { jitter: 0.1 }), strawD = K(kit, '#d8b060', { jitter: 0.08 }), rib = KG(kit, '#ff7ab0'), fl = KG(kit, '#ffffff'), flc = KG(kit, '#ffd23a');
    dome(8.6, 6.4, (x, y, z) => ((x + z + y) % 3 === 0 ? strawD : straw));
    shape(m, cx - 17, by - 1, cz - 17, cx + 17, by + 1, cz + 17, (x, y, z) => { const d = Math.hypot(x - cx, z - cz); return d <= 16.5 && d > 7.6 && y < by + 1.2 - (d - 8) * 0.12; }, (x, y, z) => ((Math.floor(Math.hypot(x - cx, z - cz)) % 3) === 0 ? strawD : straw));
    m.paint(() => shape(m, cx - 10, by + 0.5, cz - 10, cx + 10, by + 2.6, cz + 10, () => true, rib));
    for (const [ox, oy] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) m.sphere(cx + 6.4 + ox, by + 2.2 + oy, cz + 5.4, 1, ox || oy ? fl : flc);
  } else if (id === 'captain' || id === 'sailor') {
    const w = KG(kit, '#ffffff'), band = KG(kit, '#1a2a5a'), visor = KG(kit, '#141a2a', { spec: 1.6 }), gold = KG(kit, '#ffd23a', { spec: 1.6 });
    shape(m, cx - 11, by, cz - 11, cx + 11, by + 7, cz + 11, (x, y, z) => {
      const yy = y - by;
      if (yy < 3.4) return Math.hypot(x - cx, z - cz) <= 8.6;
      return ((x - cx) / 10.4) ** 2 + ((z - cz + 0.6) / 10.4) ** 2 <= 1 && yy < 6.2;
    }, (x, y) => (y - by < 3.4 ? band : w));
    shape(m, cx - 7, by - 0.6, cz + 5, cx + 7, by + 1, cz + 13, (x, y, z) => ((x - cx) / 6.6) ** 2 + ((z - cz - 6) / 6.6) ** 2 <= 1 && z > cz + 6.4, visor);
    decal(m, cx, by + 3.2, ['.#.', '###', '.#.', '###'], { '#': gold });
  } else if (id === 'tophat') {
    const a = KG(kit, '#1a3a6a'), rib = KG(kit, '#2fd3e8'), brim = KG(kit, '#13284a');
    m.cylinder(cx, cz, by, by + 13, 6.6, (x, y) => (y >= by + 1 && y <= by + 3 ? rib : a));
    shape(m, cx - 11, by - 1, cz - 11, cx + 11, by, cz + 11, (x, y, z) => Math.hypot(x - cx, z - cz) <= 10.4, brim);
  } else if (id === 'crown') {
    const gold = kit.glass('#bff4ff', { spec: 1.6 }), rim = KG(kit, '#e8f8ff', { spec: 1.6 }), gem = KG(kit, '#ff5ab0', { emissive: 0.5 }), gem2 = KG(kit, '#5affd8', { emissive: 0.5 });
    shape(m, cx - 9, by, cz - 9, cx + 9, by + 9, cz + 9, (x, y, z) => {
      const d = Math.hypot(x - cx, z - cz);
      if (d > 8.4 || d < 6.8) return false;
      const a = Math.atan2(z - cz, x - cx);
      const spike = 4 + 4.5 * Math.max(0, Math.cos(a * 5));
      return y - by < spike;
    }, (x, y) => (y - by < 1.6 ? rim : gold));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + Math.PI / 10; m.sphere(cx + Math.cos(a) * 8.6, by + 2.4, cz + Math.sin(a) * 8.6, 1, i % 2 ? gem : gem2); }
  }
  return { m, pivot: [cx, by, cz] };
}

// ---------------------------------------------------------------------- torso (pivot = hips) with top, bottom, back

const TORSO = { nx: 34, ny: 30, nz: 30, cx: 17, cz: 13, hy: 7 };
const WAIST = 2.4;
function torsoInside(x, y, z) {
  const dx = x - TORSO.cx, dz = z - TORSO.cz, yy = y - TORSO.hy;
  if (yy < -2.6 || yy > 9.9) return false;
  let rx = 4.9 - Math.max(0, yy - 3) * 0.08, rz = 3.5;
  if (yy > 7.4) { const k = Math.sqrt(Math.max(0, 1 - ((yy - 7.4) / 2.6) ** 2)); rx *= 0.4 + 0.6 * k; rz *= 0.45 + 0.55 * k; }
  if (yy < 0) { const k = Math.sqrt(Math.max(0, 1 - (yy / 2.8) ** 2)); rx *= 0.55 + 0.45 * k; rz *= 0.6 + 0.4 * k; }
  return (Math.abs(dx) / rx) ** 2.4 + (Math.abs(dz) / rz) ** 2.4 <= 1;
}

const TOPS = {
  tee: { col: '#ffffff', sleeve: 'short' }, hoodie: { col: '#59c3ff', sleeve: 'long' }, raincoat: { col: '#9be84a', sleeve: 'long', gloss: true },
  sailor: { col: '#ffffff', sleeve: 'short' }, jersey: { col: '#2fd3e8', sleeve: 'short' }, puffer: { col: '#e8f6ff', sleeve: 'long' },
  labcoat: { col: '#ffffff', sleeve: 'long' }, leafy: { col: '#5cc832', sleeve: 'none' }, tux: { col: '#1a3a6a', sleeve: 'long' },
  astro: { col: '#f2f6fa', sleeve: 'long' }, coat: { col: '#2a6ab0', sleeve: 'long' },
};
const BOTTOMS = {
  shorts: { col: '#2fb8e8', len: 'short' }, jeans: { col: '#4a7ac8', len: 'long' }, skirt: { col: '#8fd0ff', len: 'skirt' }, cargo: { col: '#c8b48a', len: 'short' },
  leggings: { col: '#8be04a', len: 'long' }, swim: { col: '#ff8a4a', len: 'short' }, astro: { col: '#f2f6fa', len: 'long' }, navy: { col: '#1a3a6a', len: 'long' },
};
const topCol = (kit) => TOPS[kit.look.top] || TOPS.tee;
const botCol = (kit) => BOTTOMS[kit.look.bottom] || BOTTOMS.shorts;

function buildTorso(kit, spin) {
  const L = kit.look, C = kit.c;
  const m = kit.model(TORSO.nx, TORSO.ny, TORSO.nz);
  const { cx, cz, hy } = TORSO;
  const tp = topCol(kit), bt = botCol(kit);
  const top = tp.gloss ? KG(kit, tp.col) : K(kit, tp.col);
  const topD = tp.gloss ? KG(kit, shade(tp.col, -0.15)) : K(kit, shade(tp.col, -0.14));
  const pants = K(kit, bt.col), pantsD = K(kit, shade(bt.col, -0.18));
  shape(m, 0, 0, 0, TORSO.nx - 1, TORSO.ny - 1, TORSO.nz - 1, torsoInside, (x, y) => (y - hy < WAIST ? pants : top));
  // the neck ring the bubble sits in (a little bubble-wand hoop)
  torus(m, cx, hy + 9.6, cz, 2.6, 0.9, C.ring, 'y');
  const R = (fn) => m.recolor((x, y, z, p) => fn(x + 0.5 - cx, y + 0.5 - hy, z + 0.5 - cz, x, y, z, p));
  const surf = (fn) => m.recolor((x, y, z, p) => (m.exposed(x, y, z) ? fn(x + 0.5 - cx, y + 0.5 - hy, z + 0.5 - cz, x, y, z, p) : null));
  const onFront = (dx, yy, cb) => { const x = Math.floor(cx + dx), y = Math.floor(hy + yy); const z = frontZ(m, x, y); if (z > 0) cb(x, y, z); };
  // ---- bottoms
  const b = L.bottom;
  R((dx, yy) => (Math.abs(yy - WAIST + 0.4) < 0.5 ? pantsD : null));
  if (b === 'shorts') { const w = K(kit, '#ffffff', { jitter: 0 }); surf((dx, yy, dz, x, y, z) => (yy < WAIST - 1 && yy > -1 && (x + Math.floor(y * 1.5)) % 5 === 0 ? w : null)); }
  if (b === 'cargo') { for (const s of [-1, 1]) for (let yy = -1; yy <= 0; yy++) for (let k = 0; k < 2; k++) onFront(s * 3.4 + k, yy, (x, y, z) => m.set(x, y, z + 1, pantsD)); }
  if (b === 'swim') { const fl = K(kit, '#ffe27a', { jitter: 0 }), lf = K(kit, '#2ab87a', { jitter: 0 }); surf((dx, yy, dz, x, y, z) => (yy < WAIST - 0.6 ? (hsh(x >> 1, y >> 1, z >> 1, 4) < 0.18 ? fl : hsh(x, y, z, 5) < 0.06 ? lf : null) : null)); }
  if (b === 'leggings') { const w = K(kit, '#ffffff', { jitter: 0 }); R((dx, yy) => (Math.abs(Math.abs(dx) - 4.1) < 0.6 && yy < WAIST - 0.6 ? w : null)); }
  if (b === 'skirt') shape(m, 0, 0, 0, TORSO.nx - 1, hy + WAIST, TORSO.nz - 1, (x, y, z) => { const yy = y - hy, dx = x - cx, dz = z - cz; const f = 5.2 + (WAIST - yy) * 0.55; return yy >= -3.4 && yy < WAIST && (Math.abs(dx) / f) ** 2.2 + (Math.abs(dz) / (f * 0.78)) ** 2.2 <= 1; }, (x, y, z) => ((Math.floor(Math.atan2(z - cz, x - cx) * 4)) & 1 ? pants : pantsD));
  if (b === 'astro') R((dx, yy) => (Math.abs(yy - 0.4) < 0.5 ? K(kit, '#ff8a2a') : null));
  // ---- tops
  const t = L.top;
  if (t === 'tee') {
    const drop = KG(kit, '#2fb8e8'), dropL = KG(kit, '#bff6ff');
    decal(m, cx, hy + 7, ['..#..', '.###.', '##o##', '#####', '.###.'], { '#': drop, o: dropL });
    R((dx, yy) => (yy > 8.6 ? K(kit, '#d8eef8') : null));
  } else if (t === 'hoodie') {
    const str = K(kit, '#ffffff', { jitter: 0 });
    surf((dx, yy, dz) => (dz > 2.2 && yy > WAIST + 0.6 && yy < 5.2 && Math.abs(dx) < 3.6 - (yy - WAIST) * 0.2 ? (Math.abs(yy - 5) < 0.6 || Math.abs(Math.abs(dx) - (3.4 - (yy - WAIST) * 0.2)) < 0.6 ? topD : null) : null));
    m.ellipsoid(cx, hy + 9.4, cz - 3.2, 4.6, 2.2, 2.2, top);
    m.ellipsoid(cx, hy + 9.8, cz - 2.6, 3, 1.3, 1.3, topD);
    for (const s of [-1, 1]) for (let yy = 6; yy <= 8.6; yy++) onFront(s * 1.4, yy, (x, y, z) => m.set(x, y, z + 1, str));
  } else if (t === 'raincoat') {
    const tog = KG(kit, '#ffffff');
    shape(m, 0, 0, 0, TORSO.nx - 1, hy + WAIST + 1, TORSO.nz - 1, (x, y, z) => { const dx = x - cx, dz = z - cz, yy = y - hy; return yy >= -2.8 && yy < WAIST + 1 && (Math.abs(dx) / 5.5) ** 2.4 + (Math.abs(dz) / 4.1) ** 2.4 <= 1; }, top);
    R((dx, yy, dz) => (dz > 2 && Math.abs(dx) < 0.55 && yy < 9 ? topD : null));
    for (const yy of [0.5, 3.5, 6.5]) onFront(1.2, yy, (x, y, z) => m.set(x, y, z + 1, tog));
    m.cone(cx, cz, hy + 8.4, hy + 10.2, 4.2, 3.6, topD);
    m.sub(() => m.cylinder(cx, cz, hy + 8.6, hy + 11, 2.6, 1));
    torus(m, cx, hy + 9.6, cz, 2.6, 0.9, C.ring, 'y');
  } else if (t === 'sailor') {
    const navy = K(kit, '#1a3a7a'), wl = K(kit, '#ffffff', { jitter: 0 }), red = K(kit, '#e8403a');
    surf((dx, yy, dz) => (yy > 7.2 && (dz < 0 || Math.abs(dx) > 2.2 - (yy - 7.2)) ? (Math.abs(yy - 7.8) < 0.4 ? wl : navy) : null));
    surf((dx, yy, dz) => (dz < -1 && yy > 4.6 && yy < 9.4 && Math.abs(dx) < 3.8 ? (Math.abs(yy - 5.2) < 0.45 ? wl : navy) : null));
    decal(m, cx, hy + 7.6, ['#.#', '.#.', '.#.', '#.#'], { '#': red });
  } else if (t === 'jersey') {
    const w = K(kit, '#ffffff', { jitter: 0 }), n = K(kit, '#0c3a52', { jitter: 0 });
    R((dx, yy) => (Math.abs(Math.abs(dx) - 4.2) < 0.5 && yy > WAIST ? w : null));
    decal(m, cx, hy + 7, ['####', '...#', '..#.', '.#..', '.#..'], { '#': w });
    m.recolor((x, y, z, p) => (p === w && hsh(x, y, z, 2) < -1 ? n : null));
  } else if (t === 'puffer') {
    const band = K(kit, '#59c3ff'), zip = KG(kit, '#c8d4e0', { spec: 1.4 });
    for (let k = 0; k < 4; k++) torus(m, cx, hy + WAIST + 0.8 + k * 2.1, cz, 3.8 - (k === 3 ? 0.6 : 0), 1.25, k % 2 ? top : band, 'y', 1.15, 0.86);
    for (let yy = WAIST; yy <= 9; yy++) onFront(0, yy, (x, y, z) => m.set(x, y, z + 1, zip));
  } else if (t === 'labcoat' || t === 'coat') {
    const lap = K(kit, t === 'coat' ? '#ffd23a' : '#2fd3e8'), pocket = K(kit, '#e0eaf2'), pen = KG(kit, '#ff5a6a'), pen2 = KG(kit, '#3fa8ff');
    shape(m, 0, 0, 0, TORSO.nx - 1, hy + WAIST + 1, TORSO.nz - 1, (x, y, z) => { const dx = x - cx, dz = z - cz, yy = y - hy; return yy >= -4.6 && yy < WAIST + 1 && (Math.abs(dx) / 5.3) ** 2.4 + (Math.abs(dz) / 3.9) ** 2.4 <= 1 && !(dz > 1.2 && Math.abs(dx) < 0.9 + (WAIST - yy) * 0.35); }, top);
    surf((dx, yy, dz) => (dz > 1.6 && yy > 5 && Math.abs(dx) < 0.6 + (yy - 5) * 0.55 && Math.abs(dx) > (yy - 5) * 0.55 - 0.6 ? lap : null));
    if (t === 'labcoat') { onFront(-2.8, 4.8, (x, y, z) => { m.box(x - 1, y - 1, z + 1, x + 1, y, z + 1, pocket); m.set(x - 1, y + 1, z + 1, pen); m.set(x, y + 1, z + 1, pen2); }); }
    else for (const yy of [1, 3.5, 6]) for (const s of [-1, 1]) onFront(s * 1.8, yy, (x, y, z) => m.set(x, y, z + 1, lap));
  } else if (t === 'leafy') {
    const l1 = KG(kit, '#7ee04a'), l2 = KG(kit, '#4cb82e'), l3 = KG(kit, '#c8f56a');
    shape(m, 0, 0, 0, TORSO.nx - 1, TORSO.ny - 1, TORSO.nz - 1, (x, y, z) => { const dx = x - cx, dz = z - cz, yy = y - hy; const r = 3.4 + (8.8 - yy) * 0.36; return yy > 0.4 && yy < 9.2 && (Math.abs(dx) / r) ** 2 + (Math.abs(dz) / (r * 0.82)) ** 2 <= 1; }, (x, y, z) => { const h = hsh(x >> 1, Math.floor((y + (x & 1)) / 2), z >> 1, 3); return h < 0.4 ? l1 : h < 0.85 ? l2 : l3; });
    m.recolor((x, y, z, p) => (p === top ? l2 : null));
  } else if (t === 'tux') {
    const shirtW = K(kit, '#ffffff', { jitter: 0 }), bow = KG(kit, '#2fd3e8'), btn = K(kit, '#0c1a2a', { jitter: 0 }), sat = KG(kit, '#24508a');
    surf((dx, yy, dz) => { if (dz < 1.6 || yy < WAIST) return null; const v = (yy - 2.4) * 0.55; return Math.abs(dx) < v ? shirtW : Math.abs(dx) < v + 1 && yy > 4 ? sat : null; });
    onFront(0, 4.6, (x, y, z) => m.set(x, y, z, btn));
    onFront(0, 8.6, (x, y, z) => { m.box(x - 2, y - 1, z + 1, x + 2, y, z + 1, bow); m.set(x, y, z + 2, bow); });
    for (const s of [-1, 1]) m.box(cx + s * 2.2 - 1, hy - 4, cz - 3.8, cx + s * 2.2 + 1, hy + 1, cz - 2.8, top);
  } else if (t === 'astro') {
    const panel = K(kit, '#3a4a6a'), patch = K(kit, '#ff8a2a'), lights = ['#ff4a5a', '#5aff8a', '#ffd84a'].map((h) => kit.col(h, { emissive: 0.85, jitter: 0 }));
    onFront(0, 4.4, (x, y, z) => { m.box(x - 2, y, z + 1, x + 1, y + 2, z + 1, panel); lights.forEach((l, i) => m.set(x - 2 + i, y + 1, z + 2, l)); });
    onFront(-3.6, 7.4, (x, y, z) => m.box(x, y, z, x + 1, y + 1, z, patch));
    torus(m, cx, hy + 9.4, cz, 3.2, 1.1, KG(kit, '#c8d4e4', { spec: 1.4 }), 'y');
  }
  buildBack(m, kit, spin);
  return { m, pivot: [cx, hy, cz] };
}

function buildBack(m, kit, spin) {
  const id = kit.look.back;
  const { cx, cz, hy } = TORSO;
  const bz = cz - 3.6; // back surface
  const straps = (c) => { for (const s of [-1, 1]) for (let y = hy + 2; y <= hy + 9; y++) { const x = Math.floor(cx + s * 2.6); const z = frontZ(m, x, y); if (z > cz) m.set(x, y, z, c); } };
  if (id === 'satchel') {
    const bag = K(kit, '#e8c88a'), flap = K(kit, '#c8a060'), strap = K(kit, '#8a5a3a'), btn = KG(kit, '#2fd3e8');
    m.box(cx - 3.6, hy + 1, bz - 3.4, cx + 3.6, hy + 7, bz - 0.4, bag);
    m.box(cx - 3.8, hy + 4.4, bz - 3.8, cx + 3.8, hy + 7.4, bz - 2.8, flap);
    m.set(cx, hy + 4.6, bz - 4, btn);
    straps(strap);
  } else if (id === 'jetpack') {
    const tankC = kit.glass('#bff6ff'), cap = KG(kit, '#e8eef4', { spec: 1.5 }), noz = KG(kit, '#5a6a7a'), body = KG(kit, '#ffffff'), lime = KG(kit, '#8be04a');
    m.box(cx - 3, hy + 2, bz - 2.4, cx + 3, hy + 8.6, bz - 0.4, body);
    for (const s of [-1, 1]) {
      const tx = cx + s * 3.6;
      m.cylinder(tx, bz - 3.4, hy + 1.4, hy + 9, 2.4, tankC);
      m.cylinder(tx, bz - 3.4, hy + 9, hy + 10.2, 2.4, cap);
      m.cylinder(tx, bz - 3.4, hy + 0.2, hy + 1.4, 1.8, noz);
      m.set(tx, hy + 5, bz - 6, lime);
    }
    straps(KG(kit, '#2fb8e8'));
  } else if (id === 'turbine') {
    const body = KG(kit, '#ffffff'), pole = KG(kit, '#d8e4ee'), blade = KG(kit, '#f6fbff'), hub = KG(kit, '#8be04a'), led = kit.col('#5affd8', { emissive: 0.7, jitter: 0 });
    m.box(cx - 3, hy + 1.6, bz - 3, cx + 3, hy + 7.6, bz - 0.4, body);
    m.set(cx, hy + 3, bz - 3.4, led);
    m.line(cx, hy + 7.6, bz - 1.8, cx, hy + 17, bz - 1.8, pole, 0.5);
    m.sphere(cx, hy + 17.2, bz - 2.6, 1.2, hub);
    const a0 = (spin % 3) * (TAU / 9);
    for (let i = 0; i < 3; i++) { const a = a0 + (i / 3) * TAU; m.line(cx, hy + 17.2, bz - 3.6, cx + Math.cos(a) * 7, hy + 17.2 + Math.sin(a) * 7, bz - 3.6, blade, 0.7); }
    straps(KG(kit, '#2fb8e8'));
  } else if (id === 'wings' || id === 'solar') {
    const a = id === 'wings' ? KG(kit, '#7ee04a') : K(kit, '#1a3a7a', { spec: 1.2, specPow: 8 });
    const b = id === 'wings' ? KG(kit, '#4cb82e') : K(kit, '#c8e4ff', { spec: 1.4, jitter: 0 });
    const frame = id === 'wings' ? K(kit, '#c8f56a') : KG(kit, '#e8eef4');
    for (const s of [-1, 1]) {
      shape(m, cx + s * 1 - 16, hy - 2, bz - 4, cx + s * 1 + 16, hy + 16, bz - 1, (x, y, z) => {
        const u = (x - cx) * s, v = y - hy - 6;
        if (u < 1 || Math.abs(z - (bz - 2.4)) > 0.6) return false;
        if (id === 'wings') return u < 14 && Math.abs(v - u * 0.45) < Math.sin(clamp01(u / 14) * Math.PI) * 4.2;
        return u < 13 && v > -2 + u * 0.15 && v < 6 + u * 0.35;
      }, (x, y) => {
        const u = (x - cx) * s, v = y - hy - 6;
        if (id === 'wings') return Math.abs(v - u * 0.45) < 0.5 ? frame : u > 7 ? a : b;
        return Math.round(u) % 4 === 0 || Math.round(v - u * 0.25) % 3 === 0 ? b : a;
      });
    }
    if (id === 'solar') m.box(cx - 2, hy + 3, bz - 2.6, cx + 2, hy + 8, bz - 0.4, frame);
  } else if (id === 'tank') {
    const glassC = kit.glass('#9ae6ff', { light: 0.1 }), water = kit.glass('#4ac8f0', { light: 0 }), frame = KG(kit, '#ffffff'), fish = KG(kit, '#ff8a2a'), fishW = KG(kit, '#ffffff'), sand = K(kit, '#f2dca0'), weed = K(kit, '#5cc832');
    const x0 = cx - 4.5, x1 = cx + 4.5, y0 = hy + 1, y1 = hy + 10, z0 = bz - 7, z1 = bz - 0.5;
    m.box(x0, y0, z0, x1, y1, z1, (x, y, z) => (y > y1 - 1.5 ? glassC : water));
    m.box(x0, y0, z0, x1, y0 + 1, z1, sand);
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) m.box(x, y0, z, x, y1, z, frame);
    m.box(x0, y1, z0, x1, y1, z1, (x, y, z) => (x === Math.floor(x0) || x === Math.floor(x1) || z === Math.floor(z0) || z === Math.floor(z1) ? frame : glassC));
    m.ellipsoid(cx, hy + 6, z0, 2.4, 1.6, 0.8, fish); m.set(cx + 3, hy + 6, z0, fish); m.set(cx - 1, hy + 6.6, z0 - 0.4, fishW);
    m.line(x0 + 1.5, y0 + 1, z0 + 1, x0 + 1.5, y0 + 5, z0, weed, 0.5);
    straps(KG(kit, '#2fb8e8'));
  } else if (id === 'cape') {
    const sky = K(kit, '#59c3ff'), cloud = K(kit, '#ffffff', { jitter: 0 }), clasp = KG(kit, '#ffd23a');
    shape(m, cx - 8, hy - 6, bz - 4, cx + 8, hy + 9.4, bz, (x, y, z) => {
      const yy = y - hy, w = 4.2 + (9 - yy) * 0.28;
      const zz = bz - 0.8 - (9 - yy) * 0.12;
      return yy > -5.4 && yy < 9.2 && Math.abs(x - cx) < w && Math.abs(z - zz) < 0.7;
    }, (x, y) => (hsh(Math.floor(x / 3), Math.floor(y / 2), 0, 8) < 0.22 ? cloud : sky));
    for (const s of [-1, 1]) { const z = frontZ(m, cx + s * 2, hy + 9); if (z > 0) m.set(cx + s * 2, hy + 9, z + 1, clasp); }
  }
}

// ---------------------------------------------------------------------- limbs

const ARM = { upper: 3.0, fore: 3.6 };
const LEG = { thigh: 4.0 };

function buildUpper(kit) {
  const tp = topCol(kit), C = kit.c;
  const m = kit.model(8, 8, 8);
  const sleeve = tp.sleeve === 'none' ? C.skin : tp.gloss ? KG(kit, tp.col) : K(kit, tp.col);
  m.line(4, 5.6, 4, 4, 2.6, 4, sleeve, 1.55);
  if (tp.sleeve === 'short') { m.paint(() => m.box(0, 0, 0, 7, 3.4, 7, C.skin)); m.paint(() => m.box(0, 3.4, 0, 7, 4.0, 7, K(kit, shade(tp.col, -0.14)))); }
  if (kit.look.top === 'puffer') m.line(4, 5.4, 4, 4, 3, 4, sleeve, 1.9);
  if (kit.look.top === 'leafy') m.paint(() => m.box(0, 4, 0, 7, 7, 7, KG(kit, '#4cb82e')));
  if (kit.look.top === 'jersey') m.paint(() => m.box(0, 3.2, 0, 7, 3.8, 7, K(kit, '#ffffff', { jitter: 0 })));
  return { m, pivot: [4, 5.6, 4] };
}

function buildFore(kit) {
  const tp = topCol(kit), C = kit.c, g = kit.look.gloves;
  const m = kit.model(10, 11, 10);
  const px = 5, py = 8.4, pz = 5;
  const long = tp.sleeve === 'long';
  const sleeve = long ? (tp.gloss ? KG(kit, tp.col) : K(kit, tp.col)) : C.skin;
  m.line(px, py, pz, px, py - 2.2, pz, sleeve, long && kit.look.top === 'puffer' ? 1.8 : 1.4);
  if (long) m.paint(() => m.box(0, py - 2.8, 0, 9, py - 2.0, 9, K(kit, shade(tp.col, -0.18))));
  const hy = py - ARM.fore; // hand centre
  const H = (hex, o) => handCol(kit, hex, o);
  if (g === 'boxing') {
    const red = H('#ff3a4a', { smooth: 0.9, spec: 1.4, specPow: 12 }), cuff = H('#ffffff', { smooth: 0.6 });
    m.ellipsoid(px, hy - 0.3, pz + 0.3, 2.5, 2.5, 2.5, red);
    m.cylinder(px, pz, hy + 1.4, hy + 2.6, 1.9, cuff);
  } else if (g === 'mitts' || g === 'garden' || g === 'rubber' || g === 'chrome' || g === 'gold') {
    const base = { mitts: '#ffffff', garden: '#5cc832', rubber: '#ffd23a', chrome: '#dfe8f2', gold: '#ffd23a' }[g];
    const palm = H(base, { smooth: 0.8, spec: g === 'chrome' || g === 'gold' ? 1.6 : 0.9, specPow: 10 });
    const cuff = H(g === 'garden' ? '#c8f56a' : g === 'chrome' ? '#8aa0b8' : g === 'gold' ? '#c8901c' : shade(base, -0.1), { smooth: 0.6 });
    m.sphere(px, hy, pz + 0.2, 1.95, palm);
    m.line(px, hy + 0.2, pz + 1.2, px - 0.2, hy - 0.6, pz + 2.4, palm, 0.7);
    m.cylinder(px, pz, hy + 1.3, hy + 2.4, g === 'mitts' ? 2.0 : 1.7, cuff);
  } else {
    m.sphere(px, hy, pz + 0.2, 1.8, kit.hand);
    m.line(px, hy + 0.2, pz + 1.1, px - 0.2, hy - 0.5, pz + 2.2, kit.handD, 0.6);
  }
  return { m, pivot: [px, py, pz], anchors: { grip: [px, hy, pz + 0.3] } };
}

function buildThigh(kit) {
  const bt = botCol(kit), C = kit.c;
  const m = kit.model(8, 8, 8);
  const pants = K(kit, bt.col);
  m.line(4, 5.6, 4, 4, 2.0, 4, pants, 1.75);
  if (bt.len === 'short' || bt.len === 'skirt') m.paint(() => m.box(0, 0, 0, 7, bt.len === 'skirt' ? 5 : 3.4, 7, C.skin));
  if (kit.look.bottom === 'leggings') m.paint(() => m.box(0, 0, 0, 1 + 3.2, 7, 7, (x, y, z) => (x === 2 ? K(kit, '#ffffff', { jitter: 0 }) : null)));
  return { m, pivot: [4, 5.6, 4] };
}

function buildShin(kit) {
  const bt = botCol(kit), C = kit.c, s = kit.look.shoes;
  const m = kit.model(12, 9, 16);
  const px = 6, py = 4.6, pz = 5; // knee (ground = local y 0 when standing)
  const leg = bt.len === 'long' ? K(kit, bt.col) : C.skin;
  m.line(px, py + 0.4, pz, px, 1.8, pz, leg, 1.55);
  if (kit.look.bottom === 'jeans') m.paint(() => m.box(0, 1.8, 0, 11, 2.6, 15, K(kit, '#8ab0e8')));
  const foot = (c, len = 3.6, w = 2.1, h = 2.2, sole = null) => {
    shape(m, px - w - 1, 0, pz - 3, px + w + 1, h + 1, pz + len + 2, (x, y, z) => ((x - px) / w) ** 2 + ((z - pz - len * 0.35) / (len * 0.95)) ** 2 + ((y - 0.2) / h) ** 2 <= 1 && y >= 0, c);
    if (sole) m.recolor((x, y) => (y === 0 ? sole : null));
  };
  if (s === 'sneakers') {
    const w = KG(kit, '#ffffff'), a = KG(kit, '#2fd3e8'), sole = K(kit, '#8be04a');
    foot(w, 3.8, 2.2, 2.3, sole);
    m.recolor((x, y, z, p) => (p === w && y === 1 && m.exposed(x, y, z) && Math.abs(x + 0.5 - px) > 1.4 && z < pz + 3 ? a : null));
  } else if (s === 'boots') {
    const y = KG(kit, '#ffd23a'), cuff = KG(kit, '#ffe88a'), sole = K(kit, '#5a7aa0');
    m.cylinder(px, pz, 1, 3.8, 1.95, y); m.cylinder(px, pz, 3.6, 4.2, 2.15, cuff);
    foot(y, 3.4, 2.1, 2.0, sole);
  } else if (s === 'sandals') {
    const strap = K(kit, '#ff8a4a'), sole = K(kit, '#f2d28a');
    foot(C.skin, 3.4, 1.9, 1.7);
    m.recolor((x, y, z, p) => (y === 0 ? sole : p === C.skin && y === 1 && (z === pz + 1 || z === pz + 2) ? strap : null));
  } else if (s === 'flippers') {
    const fl = KG(kit, '#9be84a'), flD = KG(kit, '#5cc832');
    m.cylinder(px, pz, 0.6, 2.4, 1.9, flD);
    shape(m, px - 5, 0, pz - 2, px + 5, 1, pz + 10, (x, y, z) => { const t = (z - pz + 2) / 12; return Math.abs(x - px) < 2 + t * 2.6 && z - pz < 9.4 - Math.abs(x - px) * 0.3 && y < 1; }, (x, y, z) => ((Math.floor(x) & 1) && z > pz + 3 ? flD : fl));
  } else if (s === 'slippers') {
    const b = kit.col('#7ad8ff', { smooth: 0.9, jitter: 0.1 }), w = kit.col('#ffffff', { smooth: 0.9, jitter: 0.08 }), eye = K(kit, '#0c1a3a', { jitter: 0 });
    m.ellipsoid(px, 1.6, pz + 1.2, 2.5, 1.8, 4, (x, y) => (y < 1 ? w : b));
    m.line(px, 3, pz - 0.6, px, 4.4, pz - 2, b, 0.8); // dorsal fin
    m.line(px, 1.4, pz + 4.6, px, 1.2, pz + 6.2, b, 0.7);
    for (const sx of [-1, 1]) m.set(px + sx * 1.6, 2, pz + 3.6, eye);
  } else if (s === 'moon') {
    const w = KG(kit, '#f6faff'), g = KG(kit, '#c8d4e4'), o = KG(kit, '#ff8a2a');
    m.cylinder(px, pz, 0.4, 4.2, 2.6, w);
    foot(w, 3.8, 2.7, 2.4, g);
    m.paint(() => m.box(0, 3, 0, 11, 3.6, 15, o));
  } else if (s === 'jet') {
    const w = KG(kit, '#ffffff'), a = KG(kit, '#2fb8e8'), glow = kit.col('#7affff', { emissive: 0.95, jitter: 0 });
    m.cylinder(px, pz, 1.2, 3.6, 1.95, a);
    foot(w, 3.6, 2.2, 2.2);
    m.recolor((x, y) => (y === 0 ? glow : null));
  } else foot(C.skin, 3, 1.9, 1.8);
  return { m, pivot: [px, py, pz] };
}

// ---------------------------------------------------------------------- rod (pivot = grip, local +y = rod axis, +z = reel side)

const ROD = { len: 30 };
function buildRod(kit, bend, crank) {
  const RL = kit.rl;
  const m = kit.model(16, 44, 28);
  const ax = 8, az = 10, gy = 6;
  const kind = RL.kind || 'stick';
  const emis = RL.emissive ? { emissive: 0.85, jitter: 0 } : {};
  const shaft = RL.gold ? KG(kit, RL.shaft, { spec: 1.6 }) : kind === 'crystal' ? kit.glass(RL.shaft) : KG(kit, RL.shaft, emis);
  const shaftB = RL.stripe ? KG(kit, RL.stripe) : KG(kit, shade(RL.shaft, kind === 'stick' ? -0.25 : 0.2), emis);
  const grip = K(kit, RL.grip), reelC = KG(kit, RL.reel, { spec: 1.3 }), tip = kit.col(RL.tip, { emissive: RL.glow ? 0.6 : 0, jitter: 0 });
  const guide = KG(kit, '#e8eef4', { spec: 1.4 });
  m.line(ax, gy - 5, az, ax, gy + 2.6, az, grip, 1.1);
  m.line(ax, gy - 5.8, az, ax, gy - 5, az, reelC, 1.25);
  m.line(ax, gy + 5.6, az, ax, gy + 7.4, az, grip, 0.95);
  m.line(ax, gy + 2.6, az, ax, gy + 5.6, az, reelC, 0.8);
  m.line(ax, gy + 4, az, ax, gy + 4, az + 2, reelC, 0.55);
  m.cylinder(gy + 4, az + 3.2, ax - 1.8, ax + 1.4, 2.1, reelC, 'x');
  m.cylinder(gy + 4, az + 3.2, ax - 1.2, ax + 0.8, 1.3, K(kit, '#ffffff', { jitter: 0 }), 'x');
  const ca = (crank / 8) * TAU;
  const kx = ax + 2.4, ky = gy + 4 + Math.sin(ca) * 2.1, kz = az + 3.2 + Math.cos(ca) * 2.1;
  m.line(ax + 1.8, gy + 4, az + 3.2, kx, ky, kz, reelC, 0.45);
  m.line(kx, ky, kz, kx + 1.3, ky, kz, KG(kit, '#2fb8e8'), 0.55);
  const L = ROD.len, base = gy + 7.4;
  const pts = [];
  for (let i = 0; i <= 24; i++) { const s = i / 24; pts.push([ax, base + (L - 8) * s * (1 - 0.18 * bend * s * s), az + bend * (L - 8) * 0.42 * s * s]); }
  for (let i = 0; i < pts.length - 1; i++) {
    const s = i / 24;
    let c = shaft;
    if (RL.stripe) c = Math.floor(i / 1.5) % 2 ? shaftB : shaft;
    else if (kind === 'stick') c = i % 5 === 0 ? shaftB : shaft;
    else if (kind === 'carbon') c = i % 7 === 0 ? shaftB : shaft;
    if (RL.rainbow) c = KG(kit, ['#ff7ab0', '#ffd23a', '#8be04a', '#59c3ff', '#b08aff'][Math.floor(s * 5) % 5]);
    m.line(...pts[i], ...pts[i + 1], c, kind === 'crystal' ? (s < 0.5 ? 1.0 : 0.6) : s < 0.45 ? 0.8 : 0.5);
  }
  if (kind === 'coil') for (let i = 2; i < 20; i++) { const p = pts[i]; const a = i * 1.3; m.set(p[0] + Math.cos(a) * 1.3, p[1], p[2] + Math.sin(a) * 1.3, kit.col(RL.glow || RL.tip, { emissive: 0.8, jitter: 0 })); }
  if (RL.leaves) for (const i of [6, 12, 17]) { const p = pts[i]; for (const s of [-1, 1]) m.line(p[0], p[1], p[2], p[0] + s * 2.4, p[1] + 1.6, p[2], KG(kit, '#7ee04a'), 0.55); }
  for (const s of [0.28, 0.5, 0.7, 0.87]) { const p = pts[Math.round(s * 24)]; m.set(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2] + 1), guide); }
  const tp = pts[24];
  let tipA = [tp[0] + 0.5, tp[1] + 0.8, tp[2] + 0.5];
  if (kind === 'wand') {
    torus(m, tp[0], tp[1] + 2.4, tp[2], 2.2, 0.55, tip, 'z');
    tipA = [tp[0] + 0.5, tp[1] + 4.8, tp[2] + 0.5];
  } else if (kind === 'trident') {
    for (const dx of [-1.8, 0, 1.8]) m.line(tp[0] + dx, tp[1] - 1, tp[2], tp[0] + dx, tp[1] + 3.2 - Math.abs(dx) * 0.5, tp[2], tip, 0.45);
    m.line(tp[0] - 1.8, tp[1] - 1, tp[2], tp[0] + 1.8, tp[1] - 1, tp[2], tip, 0.45);
    tipA = [tp[0] + 0.5, tp[1] + 3.6, tp[2] + 0.5];
  } else if (kind === 'crystal') {
    m.sphere(tp[0], tp[1] + 1, tp[2], 1.5, tip);
  } else { m.set(Math.floor(tp[0]), Math.floor(tp[1]), Math.floor(tp[2]), tip); m.set(Math.floor(tp[0]), Math.floor(tp[1]) - 1, Math.floor(tp[2]), tip); }
  return { m, pivot: [ax, gy, az], anchors: { tip: tipA, knob: [kx + 0.9, ky, kz], fore: [ax, gy + 6.4, az] } };
}
