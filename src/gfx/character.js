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
  globe: { tint: '#4cd83a', hue: 90, span: 120, irid: 0.3, alpha: 0.62, deep: '#16722a', special: 'globe' },
};
const skinOfTint = (T) => (T.special === 'globe' ? '#c8f5a8' : T.special === 'gold' ? '#ffd84a' : T.special === 'chrome' ? '#cfd8e4' : T.special === 'stars' ? '#7a68d8' : mix(T.tint, '#ffffff', 0.18));

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
  it('tint', 'globe', 'Eco Globe', 'epic', 1600, 'A green glass planet. Think globally, fish locally.'),
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
  it('hat', 'leafcrown', 'Leaf Crown', 'uncommon', 260, 'Glossy green leaves, fresh from the hill.'),
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
  it('face', 'flare', 'Sun-Flare Shades', 'rare', 560, 'Mirrored lenses that catch the sun. *ting*'),
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
  it('top', 'aquasuit', 'Water-Bubble Suit', 'epic', 1200, 'A wobbly suit of clear water. Bubbles included.'),
  it('top', 'tux', 'Aqua Tux', 'epic', 1500, 'For very formal splashes.'),
  it('top', 'astro', 'Astro Suit', 'legendary', null, 'One small cast for a bubble. Crates only.', pkg),
  // bottoms
  it('bottom', 'shorts', 'Board Shorts', 'common', 0, 'Aqua with white waves.'),
  it('bottom', 'jeans', 'Comfy Jeans', 'common', 80, 'Rolled up for wading.'),
  it('bottom', 'skirt', 'Sky Skirt', 'uncommon', 160, 'Twirls nicely.'),
  it('bottom', 'cargo', 'Cargo Shorts', 'uncommon', 150, 'Pockets for every lure.'),
  it('bottom', 'leggings', 'Lime Leggings', 'uncommon', 180, 'Sporty stripes.'),
  it('bottom', 'swim', 'Hibiscus Trunks', 'rare', 360, 'Vacation mode: on.'),
  it('bottom', 'aquasuit', 'Water-Bubble Legs', 'epic', 900, 'The wobbly bottom half.'),
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
  it('shoes', 'hightops', 'Classic High-Tops', 'uncommon', 200, 'White canvas high-tops. A fish once wore these. Legend.'),
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
  it('back', 'globe', 'Glass Globe Pack', 'epic', 1500, 'Carry the whole green planet.'),
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
    glass(hex, opts = {}) { const { ga = 170, ...o2 } = opts; const i = this.col(hex, { smooth: 1, jitter: 0, spec: 1.3, specPow: 12, light: 0.25, glass: 1, ...o2 }); this.isGlass[i] = ga; return i; },
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
  if (hatOn && !['ears', 'halo', 'fluff', 'pony'].includes(id)) return;
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

const HAT_TILT = { leafcrown: -8, cap: -8, beanie: -6, bucket: -8, headphones: 0, propeller: -6, flower: -10, sunhat: -10, captain: -10, tophat: -8, crown: -6, sailor: -10 };
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
  } else if (id === 'leafcrown') {
    const l1 = KG(kit, '#7ee04a'), l2 = KG(kit, '#3fae2a'), vein = K(kit, '#c8f56a', { jitter: 0 }), band = KG(kit, '#5cc832'), dew = kit.glass('#e8ffff', { ga: 220 });
    torus(m, cx, by + 0.6, cz, 8.6, 0.9, band, 'y');
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + 0.15, ox = Math.cos(a), oz = Math.sin(a);
      const h = 3.2 + (i % 2) * 1.6, c = i % 2 ? l1 : l2;
      for (let k = 0; k <= h; k += 0.5) {
        const w = Math.sin((k / h) * Math.PI) * 1.5 + 0.3, r = 8.7 + k * 0.45;
        for (let s2 = -w; s2 <= w; s2 += 0.5) m.set(cx + ox * r - oz * s2, by + 1 + k, cz + oz * r + ox * s2, Math.abs(s2) < 0.4 ? vein : c);
      }
      if (i === 4) m.set(cx + ox * 9.6, by + 4, cz + oz * 9.6 + 0.6, dew);
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
  astro: { col: '#f2f6fa', sleeve: 'long' }, aquasuit: { col: '#5ad0ff', sleeve: 'long', glass: true }, coat: { col: '#2a6ab0', sleeve: 'long' },
};
const BOTTOMS = {
  shorts: { col: '#2fb8e8', len: 'short' }, jeans: { col: '#4a7ac8', len: 'long' }, skirt: { col: '#8fd0ff', len: 'skirt' }, cargo: { col: '#c8b48a', len: 'short' },
  leggings: { col: '#8be04a', len: 'long' }, aquasuit: { col: '#5ad0ff', len: 'long', glass: true }, swim: { col: '#ff8a4a', len: 'short' }, astro: { col: '#f2f6fa', len: 'long' }, navy: { col: '#1a3a6a', len: 'long' },
};
const topCol = (kit) => TOPS[kit.look.top] || TOPS.tee;
const botCol = (kit) => BOTTOMS[kit.look.bottom] || BOTTOMS.shorts;

function buildTorso(kit, spin) {
  const L = kit.look, C = kit.c;
  const m = kit.model(TORSO.nx, TORSO.ny, TORSO.nz);
  const { cx, cz, hy } = TORSO;
  const tp = topCol(kit), bt = botCol(kit);
  const top = tp.glass ? kit.glass(tp.col, { ga: 205 }) : tp.gloss ? KG(kit, tp.col) : K(kit, tp.col);
  const topD = tp.glass ? kit.glass('#9ae8ff', { ga: 215 }) : tp.gloss ? KG(kit, shade(tp.col, -0.15)) : K(kit, shade(tp.col, -0.14));
  const pants = bt.glass ? kit.glass(bt.col, { ga: 205 }) : K(kit, bt.col), pantsD = bt.glass ? kit.glass('#2fa8e8', { ga: 215 }) : K(kit, shade(bt.col, -0.18));
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
  const bubbles = (test) => { const w = KG(kit, '#ffffff', { spec: 1.6 }); surf((dx, yy, dz, x, y, z) => (test(yy) && hsh(x, y, z, 17) < 0.07 ? w : null)); };
  if (bt.glass) bubbles((yy) => yy < WAIST);
  if (tp.glass) { bubbles((yy) => yy >= WAIST); R((dx, yy, dz) => (yy >= WAIST && Math.abs(yy - 4 - Math.sin(dx * 0.9 + dz * 0.5) * 0.8) < 0.45 ? topD : null)); }
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
  } else if (id === 'globe') {
    const sea = kit.glass('#4cd83a', { ga: 215 }), land = KG(kit, '#f4fff0'), ring = KG(kit, '#ffffff', { spec: 1.6 }), base = KG(kit, '#2fb8e8');
    const gx = cx, gy = hy + 7.4, gz = bz - 6.4, r = 5.4;
    m.sphere(gx, gy, gz, r, (x, y, z) => { const nx = (x - gx) / r, ny = (y - gy) / r, nz = (z - gz) / r; const s = Math.sin(nx * 3.1 + 1.2) * Math.sin(ny * 4.3 + 0.4) + 0.8 * Math.sin(nz * 3.7 + nx * 2.1); return s > 0.42 ? land : sea; });
    for (let a = -0.4; a < Math.PI + 0.4; a += 0.08) m.set(gx + Math.cos(a) * (r + 1.2), gy + Math.sin(a) * (r + 1.2), gz, ring);
    m.box(gx - 2, hy + 0.6, gz - 1.5, gx + 2, hy + 1.6, gz + 1.5, base);
    m.line(gx, hy + 1.6, gz, gx, gy - r - 1, gz, ring, 0.5);
    m.box(cx - 2.5, hy + 2, bz - 1.4, cx + 2.5, hy + 7, bz - 0.4, base);
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
  const sleeve = tp.sleeve === 'none' ? C.skin : tp.glass ? kit.glass(tp.col, { ga: 205 }) : tp.gloss ? KG(kit, tp.col) : K(kit, tp.col);
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
  const sleeve = long ? (tp.glass ? kit.glass(tp.col, { ga: 205 }) : tp.gloss ? KG(kit, tp.col) : K(kit, tp.col)) : C.skin;
  m.line(px, py, pz, px, py - 2.2, pz, sleeve, long && kit.look.top === 'puffer' ? 1.8 : 1.4);
  if (long) m.paint(() => m.box(0, py - 2.8, 0, 9, py - 2.0, 9, tp.glass ? kit.glass('#9ae8ff', { ga: 215 }) : K(kit, shade(tp.col, -0.18))));
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
  const pants = bt.glass ? kit.glass(bt.col, { ga: 205 }) : K(kit, bt.col);
  m.line(4, 5.6, 4, 4, 2.0, 4, pants, 1.75);
  if (bt.len === 'short' || bt.len === 'skirt') m.paint(() => m.box(0, 0, 0, 7, bt.len === 'skirt' ? 5 : 3.4, 7, C.skin));
  if (kit.look.bottom === 'leggings') m.paint(() => m.box(0, 0, 0, 1 + 3.2, 7, 7, (x, y, z) => (x === 2 ? K(kit, '#ffffff', { jitter: 0 }) : null)));
  return { m, pivot: [4, 5.6, 4] };
}

function buildShin(kit) {
  const bt = botCol(kit), C = kit.c, s = kit.look.shoes;
  const m = kit.model(12, 9, 16);
  const px = 6, py = 4.6, pz = 5; // knee (ground = local y 0 when standing)
  const leg = bt.len === 'long' ? (bt.glass ? kit.glass(bt.col, { ga: 205 }) : K(kit, bt.col)) : C.skin;
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
  } else if (s === 'hightops') {
    const canvas = K(kit, '#f8f8f4', { jitter: 0.04 }), rub = KG(kit, '#ffffff'), stripe = K(kit, '#e8483a', { jitter: 0 }), stripe2 = K(kit, '#2a4a8a', { jitter: 0 }), lace = K(kit, '#ffffff', { jitter: 0 }), eyelet = KG(kit, '#9aa8b8', { spec: 1.4 });
    m.cylinder(px, pz, 1, 5.0, 2.05, canvas);
    m.cylinder(px, pz, 4.6, 5.2, 2.2, rub);
    foot(canvas, 3.9, 2.25, 2.3);
    m.recolor((x, y, z, p) => (y === 0 ? rub : y === 1 && m.exposed(x, y, z) ? (z > pz + 2.6 ? rub : (x + z) % 9 === 0 ? stripe2 : stripe) : null));
    for (let y = 2; y <= 4; y++) { const z = frontZ(m, px, y); if (z > 0) { m.set(px, y, z, lace); m.set(px - 1, y, z, y % 2 ? eyelet : lace); m.set(px + 1, y, z, y % 2 ? lace : eyelet); } }
    for (let z = pz + 1; z <= pz + 2; z++) { const yy = 3 - (z - pz - 1); m.set(px, yy, z + 1, lace); }
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
  m.cylinder(gy + 4, az + 3.2, ax - 1.4, ax + 1.2, 1.7, reelC, 'x');
  m.cylinder(gy + 4, az + 3.2, ax - 0.9, ax + 0.7, 1.0, K(kit, '#ffffff', { jitter: 0 }), 'x');
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

// ====================================================================== poses

const HIP_Y = 8.9;
const J = { hipL: [2.2, -0.3, 0], hipR: [-2.2, -0.3, 0], knee: [0, -LEG.thigh, 0], shL: [4.9, 6.9, 0], shR: [-4.9, 6.9, 0], elbow: [0, -ARM.upper, 0], neck: [0, 9.3, 0] };
// Pose hand targets are authored in the old (taller) rig's units; map them onto the bubble person's short arms.
const OLD_SH = { shL: [7.3, 11.4, -0.2], shR: [-7.3, 11.4, -0.2] };
const AK = 0.7;
const conv = (tg, side) => add(J[side], scl(sub(tg, OLD_SH[side]), AK));

const BASE_POSE = {
  off: [0, 0, 0], hips: [0, 0, 0], spine: [0, 0, 0], neck: [0, 0, 0],
  hipL: [0, 0, 2], knL: [0, 0, 0], hipR: [0, 0, -2], knR: [0, 0, 0],
  shL: [4, 0, 14], elL: [-14, 0, 0], shR: [4, 0, -14], elR: [-14, 0, 0],
  handL: null, handR: null, rod: { pitch: 55, yaw: -40, bend: 0, crank: 0 }, noRod: false,
  mouth: 'rest', lid: 0, squint: 0, gaze: [0, 0], wobble: 0, eyeMode: null,
};
const P = (o) => ({ ...BASE_POSE, ...o, rod: { ...BASE_POSE.rod, ...(o.rod || {}) } });
const S = Math.sin;

const POSES = {
  idle: { n: 12, dur: 4.2, loop: true, fn: (u) => {
    const b = S(u * TAU * 2), look = S(u * TAU);
    return P({ off: [0, -0.15 + 0.15 * b, 0], spine: [1.5 * b, 0, 0], neck: [-2 + 2.5 * b, 18 * look, 4 * S(u * TAU + 1)],
      handR: [-5.8, 8 + 0.3 * b, 6.2], rod: { pitch: 58 + 3 * b, yaw: -40 }, shL: [5, 0, 12 + 3 * b], elL: [-14, 0, 0], knL: [3 + 2 * b, 0, 0], knR: [3 + 2 * b, 0, 0], gaze: [0.5 * look, 0] });
  } },
  cast: { n: 8, dur: 0.75, loop: false, fn: (u, i) => {
    const K2 = [
      { r: 56, h: [-5.8, 8, 6.2], sp: 0, l: 10, m: 'rest' }, { r: 92, h: [-5.4, 13, 3.4], sp: -4, l: 30, m: 'rest' },
      { r: 128, h: [-5.2, 16.5, 0.4], sp: -7, l: 45, m: 'grit' }, { r: 150, h: [-5.2, 17.5, -1.4], sp: -9, l: 55, m: 'grit' },
      { r: 62, h: [-5.4, 15, 6.6], sp: 6, l: 20, m: 'open' }, { r: 24, h: [-5.6, 11, 8.4], sp: 11, l: 5, m: 'open' },
      { r: 20, h: [-5.8, 10, 7.8], sp: 9, l: 8, m: 'rest' }, { r: 26, h: [-5.8, 9, 7], sp: 6, l: 10, m: 'rest' },
    ][i];
    return P({ spine: [K2.sp, -K2.sp * 0.8, 0], hips: [0, -K2.sp * 0.6, 0], handR: K2.h, rod: { pitch: K2.r, yaw: -30, bend: i === 4 ? -0.35 : i === 5 ? 0.25 : 0 }, shL: [-K2.sp * 3, 0, K2.l + 8], elL: [-20, 0, 0], neck: [-K2.sp * 0.6, 0, 0],
      hipL: [i >= 4 ? -12 : 4, 0, 2], hipR: [i >= 4 ? 8 : -6, 0, -2], knL: [i >= 4 ? 10 : 2, 0, 0], knR: [i >= 4 ? 6 : 12, 0, 0], mouth: K2.m, squint: i === 2 || i === 3 ? 0.3 : 0 });
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
    const K2 = [
      { sp: 10, off: [0, -1.4, 0.4], hl: -30, kl: 40, hr: -24, kr: 38, r: 30, b: 0.5, h: [-5, 9, 7.2], m: 'grit' },
      { sp: 14, off: [0, -2, 0.8], hl: -36, kl: 52, hr: -30, kr: 48, r: 24, b: 0.7, h: [-5, 8.6, 7.4], m: 'grit' },
      { sp: -8, off: [0, 0.2, -0.4], hl: -20, kl: 16, hr: 6, kr: 10, r: 72, b: 0.9, h: [-4.6, 14.4, 4.6], m: 'open' },
      { sp: -28, off: [0, 1.6, -1.6], hl: -48, kl: 22, hr: 14, kr: 6, r: 90, b: 1.0, h: [-4.4, 17, 2.6], m: 'open' },
      { sp: -25, off: [0, 1.0, -1.5], hl: -40, kl: 18, hr: 12, kr: 6, r: 88, b: 0.9, h: [-4.4, 16.6, 3], m: 'open' },
      { sp: -16, off: [0, -0.2, -1.1], hl: -28, kl: 16, hr: 12, kr: 12, r: 80, b: 0.75, h: [-4.6, 14, 4.4], m: 'grit' },
      { sp: -14, off: [0, -0.7, -1.1], hl: -26, kl: 18, hr: 12, kr: 14, r: 76, b: 0.65, h: [-4.8, 12.8, 5.2], m: 'grit' },
      { sp: -15, off: [0, -0.9, -1.2], hl: -26, kl: 18, hr: 12, kr: 14, r: 72, b: 0.65, h: [-4.8, 12.4, 5.4], m: 'grit' },
    ][i];
    return P({ off: K2.off, spine: [K2.sp, 0, 0], neck: [i === 3 || i === 4 ? -10 : 4, 0, 0], hipL: [K2.hl, 0, 4], knL: [K2.kl, 0, 0], hipR: [K2.hr, 0, -4], knR: [K2.kr, 0, 0],
      handR: K2.h, handL: 'fore', rod: { pitch: K2.r, yaw: -40, bend: K2.b }, mouth: K2.m, squint: i >= 2 && i <= 4 ? 0.7 : 0.3, gaze: [0.6, -0.3] });
  } },
  hold: { n: 8, dur: 1.6, loop: true, fn: (u) => {
    const b = Math.abs(S(u * TAU)), sw = S(u * TAU);
    return P({ off: [0, 0.5 * b, 0], spine: [-5, 0, 2 * sw], neck: [-8, 8 * sw, 3 * sw], handL: [4.8, 9.6 + 0.6 * b, 8.8], handR: [-4.8, 9.6 + 0.6 * b, 8.8], noRod: true,
      mouth: 'grin', knL: [4 * b, 0, 0], knR: [4 * b, 0, 0], gaze: [0, 0.3] });
  } },
  cheer: { n: 8, dur: 0.72, loop: true, fn: (u, i) => {
    const j = S(u * Math.PI), f = S(u * TAU * 2), g = S(u * TAU * 2 + 2);
    return P({ off: [0, 6 * j, 0], spine: [-6 * j, 0, 4 * f], neck: [-10, 10 * g, 8 * f], hipL: [-40 * j, 0, 10], knL: [80 * j, 0, 0], hipR: [-15 * j, 0, -14 * j], knR: [55 * j, 0, 0],
      shL: [0, -28, 140 + 20 * f], elL: [0, 0, 20 + 30 * g], shR: [0, 24, -140 - 20 * g], elR: [0, 0, -20 - 30 * f], rod: { pitch: 96 + 14 * f, yaw: -60, bend: -0.3 * f },
      mouth: 'open', gaze: [0.4 * f, -0.4], wobble: 1, eyeMode: i % 4 < 2 ? 'happy' : null });
  } },
  sad: { n: 8, dur: 3.2, loop: true, fn: (u) => {
    const s = S(u * TAU);
    return P({ off: [0, -0.6, 0], spine: [13, 3 * s, 0], neck: [18, 4 * s, 5 * s], shL: [10, 0, 6], elL: [-4, 0, 0], handR: [-6.4, 4.4, 3.4], rod: { pitch: -18, yaw: -48 },
      knL: [8, 0, 0], knR: [8, 0, 0], mouth: 'frown', lid: 0.4, gaze: [0.2, 0.75] });
  } },
  sit: { n: 8, dur: 2.8, loop: true, fn: (u) => {
    const s = S(u * TAU), h = S(u * TAU * 0.5 + 0.4);
    return P({ off: [0, -HIP_Y + 2.0, 0], offAbs: true, hipL: [-88, 0, 6], knL: [84 + 22 * s, 0, 0], hipR: [-86, 0, -6], knR: [84 - 22 * s, 0, 0], spine: [-4 + s, 0, 0], neck: [-3, 14 * h, 3 * s],
      handR: [-5.8, 7.6, 6.4], rod: { pitch: 34, yaw: -40 }, handL: [4.8, 2, 6.8], gaze: [0.4 * h, 0.1] });
  } },
  show: { n: 12, dur: 4.4, loop: true, fn: (u) => {
    const b = S(u * TAU * 2), look = S(u * TAU);
    return P({ off: [0, -0.15 + 0.15 * b, 0], spine: [1.2 * b, 0, 0], neck: [-3 + 2 * b, 12 * look, 3 * S(u * TAU + 1)],
      handR: [-9.4, 6.4 + 0.3 * b, 2.2], rod: { pitch: 66, yaw: -96 }, shL: [2, -8, 18 + 4 * b], elL: [-10, 0, 0], knL: [2 + 2 * b, 0, 0], knR: [2 + 2 * b, 0, 0], gaze: [0.4 * look, 0.1] });
  } },
  stand: { n: 8, dur: 3.6, loop: true, fn: (u) => {
    const b = S(u * TAU);
    return P({ noRod: true, off: [0, -0.12 + 0.12 * b, 0], shL: [2, -10, 18 + 3 * b], elL: [-12, 0, 0], shR: [2, 10, -18 - 3 * b], elR: [-12, 0, 0], neck: [-3 + 1.5 * b, 6 * S(u * TAU + 1), 0], gaze: [0.2, 0] });
  } },
  wave: { n: 8, dur: 0.9, loop: true, fn: (u) => {
    const w = S(u * TAU), b = Math.abs(S(u * TAU));
    return P({ off: [0, 0.4 * b, 0], spine: [-2, -6, -3 * w], neck: [-6, -10, 8 * w], shL: [0, -34, 150 + 5 * w], elL: [0, 0, 40 + 38 * w], handR: [-5.8, 8.2, 6.2], rod: { pitch: 62, yaw: -40 },
      mouth: 'grin', gaze: [-0.2, -0.1] });
  } },
  chat: { n: 8, dur: 2.4, loop: true, fn: (u) => {
    const a = S(u * TAU), b = S(u * TAU * 2 + 1);
    return P({ noRod: true, off: [0, 0.1 * b, 0], spine: [-1, 6 * a, 0], neck: [-4, 10 * a, 5 * b],
      handL: [7.6 + 1.2 * a, 8.2 + 1.4 * b, 7], handR: [-8 - 0.8 * b, 7 + 1.6 * a, 6.4], gaze: [0.3 * a, 0] });
  } },
  think: { n: 8, dur: 3, loop: true, fn: (u) => {
    const a = S(u * TAU);
    return P({ noRod: true, spine: [-2, 0, 2 * a], neck: [-10, 14, 8 + 3 * a], handL: [2.6, 12.6, 7.8], shR: [6, 0, -18], elR: [-80, 0, 0], gaze: [0.5, -0.7], lid: 0.15, mouth: 'smirk' });
  } },
  dance: { n: 8, dur: 0.9, loop: true, fn: (u, i) => {
    const s = S(u * TAU), c = Math.cos(u * TAU), j = Math.abs(S(u * TAU * 2));
    return P({ noRod: true, off: [s * 1.6, 1.4 * j, 0], hips: [0, 20 * s, 8 * s], spine: [0, -10 * s, -10 * s], neck: [-4, 16 * s, -12 * s],
      shL: [0, -20, 120 + 40 * c], elL: [0, 0, 60 * s], shR: [0, 20, -60 + 40 * s], elR: [0, 0, -70 * c], hipL: [-24 * Math.max(0, s), 0, 6], knL: [40 * Math.max(0, s), 0, 0], hipR: [-24 * Math.max(0, -s), 0, -6], knR: [40 * Math.max(0, -s), 0, 0],
      mouth: 'open', eyeMode: i % 2 ? 'happy' : null });
  } },
  flex: { n: 8, dur: 1.4, loop: true, fn: (u) => {
    const s = 0.5 + 0.5 * S(u * TAU);
    return P({ noRod: true, off: [0, 0.3 * s, 0], spine: [-4, 0, 0], neck: [-8, 0, 0], shL: [0, 0, 80], elL: [0, 0, 70 + 30 * s], shR: [0, 0, -80], elR: [0, 0, -70 - 30 * s], hipL: [0, 0, 10], hipR: [0, 0, -10],
      mouth: 'grin', squint: 0.25 * s, eyeMode: s > 0.6 ? 'happy' : null });
  } },
  laugh: { n: 8, dur: 0.6, loop: true, fn: (u) => {
    const s = Math.abs(S(u * TAU));
    return P({ noRod: true, off: [0, 0.6 * s, 0], spine: [8 * s - 4, 0, 0], neck: [-14 + 10 * s, 0, 4 * S(u * TAU * 2)], handL: [3.6, 6, 7.4], handR: [-3.6, 6.2, 7.4],
      knL: [8 * s, 0, 0], knR: [8 * s, 0, 0], mouth: 'open', eyeMode: 'happy' });
  } },
};
export const POSE_NAMES = ['idle', 'cast', 'reel', 'pull', 'yank', 'hold', 'cheer', 'sad', 'sit', 'wave', 'dance', 'flex', 'laugh', 'chat', 'think'];

function poseFrame(pose, t) {
  const pd = POSES[pose] || POSES.idle;
  const k = (t || 0) / pd.dur;
  return pd.loop ? Math.floor((k - Math.floor(k)) * pd.n) % pd.n : clamp(Math.floor(k * pd.n), 0, pd.n - 1);
}

function ik2(Sh, Tg, a, b, hint) {
  let d = sub(Tg, Sh);
  let L = Math.hypot(...d);
  const maxL = a + b - 0.08, minL = Math.abs(a - b) + 0.3;
  if (L > maxL) { d = scl(d, maxL / L); L = maxL; } else if (L < minL) { d = scl(norm(d), minL); L = minL; }
  const dn = scl(d, 1 / L);
  const x = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - x * x));
  let hp = sub(hint, scl(dn, dot(hint, dn)));
  hp = Math.hypot(...hp) < 1e-4 ? [1, 0, 0] : norm(hp);
  return { E: add(Sh, add(scl(dn, x), scl(hp, h))), T: add(Sh, d) };
}

function solve(kit, p, fi, hideRod) {
  const items = [];
  const at = (name, part, W) => { if (part) items.push({ name, part, W }); };
  const place = (part, Mw) => mul(Mw, Tr(-part.pivot[0], -part.pivot[1], -part.pivot[2]));
  const off = p.offAbs ? p.off : scl(p.off, 0.75);
  const hips = mul(Tr(off[0], HIP_Y + off[1], off[2]), Ro(p.hips));
  const spine = mul(hips, Ro(p.spine));
  const bodyR = hips.R;
  const toWorld = (v) => ap(spine, v);
  const thigh = kit.part('thigh', () => buildThigh(kit)), shin = kit.part('shin', () => buildShin(kit));
  for (const [hipJ, hr, kr] of [[J.hipL, p.hipL, p.knL], [J.hipR, p.hipR, p.knR]]) {
    const Mt = mul(hips, mul(Tr(...hipJ), Ro(hr)));
    const Mk = mul(Mt, mul(Tr(...J.knee), Ro(kr)));
    at('thigh', thigh, place(thigh, Mt));
    at('shin', shin, place(shin, Mk));
  }
  const spin = kit.look.back === 'turbine' ? fi % 3 : 0;
  const torso = kit.part('torso:' + spin, () => buildTorso(kit, spin));
  at('torso', torso, place(torso, spine));
  const head = kit.part('head', () => buildHead(kit));
  const Mh = mul(spine, mul(Tr(...J.neck), Ro(p.neck)));
  const Wh = place(head, Mh);
  at('head', head, Wh);
  const hspin = kit.look.hat === 'propeller' ? fi % 2 : 0;
  const hat = kit.look.hat === 'none' ? null : kit.part('hat:' + hspin, () => buildHat(kit, hspin));
  let hatTop = null;
  if (hat && hat.b) {
    const seat = mul(Wh, mul(Tr(...HAT_SEAT), Ro([HAT_TILT[kit.look.hat] || 0, 0, 0])));
    at('hat', hat, mul(seat, Tr(-hat.pivot[0], -hat.pivot[1], -hat.pivot[2])));
    hatTop = ap(seat, [0, hat.b.y1 + 1 - hat.pivot[1], 0]);
  }
  const upper = kit.part('upper', () => buildUpper(kit)), fore = kit.part('fore', () => buildFore(kit));
  const gripLocal = sub(fore.anchors.grip, fore.pivot);
  const armFK = (shJ, sr, er) => { const Mu = mul(spine, mul(Tr(...shJ), Ro(sr))); return { Mu, Mf: mul(Mu, mul(Tr(...J.elbow), Ro(er))) }; };
  const armIK = (shJ, target, side) => {
    const Sw = toWorld(shJ);
    const hint = mv(spine.R, [side * 0.9, -0.5, -0.65]);
    const { E, T } = ik2(Sw, target, ARM.upper, Math.hypot(...gripLocal), hint);
    const fwd = mv(spine.R, [0, 0, 1]);
    return { Mu: M(alignY(sub(Sw, E), fwd), Sw), Mf: M(alignY(sub(E, T), fwd), E) };
  };
  const R = p.handR ? armIK(J.shR, toWorld(conv(p.handR, 'shR')), -1) : armFK(J.shR, p.shR, p.elR);
  at('upper', upper, place(upper, R.Mu));
  at('fore', fore, place(fore, R.Mf));
  const gripR = ap(R.Mf, gripLocal);
  let rod = null, Wr = null, rodTip = gripR;
  const noRod = p.noRod || hideRod || kit.look.rod === 'none';
  if (!noRod) {
    const rp = p.rod;
    const pr = rp.pitch * DEG, yr = rp.yaw * DEG;
    const dir = mv(bodyR, [Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr)]);
    const bendB = Math.round(clamp(rp.bend, -1, 1) * 4) / 4;
    rod = kit.part(`rod:${bendB}:${rp.crank % 8}`, () => buildRod(kit, bendB, rp.crank % 8));
    Wr = place(rod, M(alignY(dir, mv(bodyR, [0, -1, 0.2])), gripR));
    at('rod', rod, Wr);
    rodTip = ap(Wr, rod.anchors.tip);
  }
  let target = p.handL;
  if (target === 'knob') target = rod ? ap(Wr, rod.anchors.knob) : toWorld(conv([2, 8.6, 7.4], 'shL'));
  else if (target === 'fore') target = rod ? ap(Wr, rod.anchors.fore) : toWorld(conv([2, 10.6, 7], 'shL'));
  else if (Array.isArray(target)) target = toWorld(conv(target, 'shL'));
  else target = null;
  const Lh = target ? armIK(J.shL, target, 1) : armFK(J.shL, p.shL, p.elL);
  at('upper', upper, place(upper, Lh.Mu));
  at('fore', fore, place(fore, Lh.Mf));
  const gripL = ap(Lh.Mf, gripLocal);
  const center = ap(Wh, head.anchors.center);
  const top = hatTop || ap(Wh, head.anchors.top);
  return {
    items, head: { C: center, R: head.R, Rm: Wh.R },
    anchors: { rodTip, handR: gripR, handL: gripL, hands: noRod ? scl(add(gripR, gripL), 0.5) : gripR, head: top, mouth: ap(Wh, add(head.anchors.center, [0, -0.3 * HEAD.R, 0.95 * HEAD.R])) },
  };
}

// ====================================================================== composing

function stamp(dst, part, W, gmin, mx) {
  const src = part.m, b = part.b;
  if (!b) return;
  const R = W.R, t = W.t;
  const toGrid = (w) => [mx * w[0] - gmin[0], w[1] - gmin[1], w[2] - gmin[2]];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const g = toGrid(ap(W, [i & 1 ? b.x1 + 1 : b.x0, i & 2 ? b.y1 + 1 : b.y0, i & 4 ? b.z1 + 1 : b.z0]));
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], g[k]); hi[k] = Math.max(hi[k], g[k]); }
  }
  const { nx: snx, ny: sny, nz: snz, data: sd } = src;
  const x0 = Math.floor(lo[0]), x1 = Math.ceil(hi[0]);
  const ix = R[0] * mx, iy = R[1] * mx, iz = R[2] * mx;
  for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++) for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) {
    const wx = mx * (x0 + 0.5 + gmin[0]) - t[0], wy = y + 0.5 + gmin[1] - t[1], wz = z + 0.5 + gmin[2] - t[2];
    let qx = R[0] * wx + R[3] * wy + R[6] * wz, qy = R[1] * wx + R[4] * wy + R[7] * wz, qz = R[2] * wx + R[5] * wy + R[8] * wz;
    for (let x = x0; x <= x1; x++, qx += ix, qy += iy, qz += iz) {
      if (qx < 0 || qy < 0 || qz < 0 || qx >= snx || qy >= sny || qz >= snz) continue;
      const v = sd[(qx | 0) + snx * ((qy | 0) + sny * (qz | 0))];
      if (v) dst.set(x, y, z, v);
    }
  }
  for (let z = b.z0; z <= b.z1; z++) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const v = sd[x + snx * (y + sny * z)];
    if (!v) continue;
    const g = toGrid(ap(W, [x + 0.5, y + 0.5, z + 0.5]));
    const gx = Math.floor(g[0]), gy = Math.floor(g[1]), gz = Math.floor(g[2]);
    if (!dst.get(gx, gy, gz)) dst.set(gx, gy, gz, v);
  }
}

function compose(kit, items, mx) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { part, W } of items) {
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
  for (const { part, W } of items) stamp(m, part, W, gmin, mx);
  return { m, gmin };
}

// ====================================================================== bubble shading + face mapping (shared with npcs.js)

// Camera basis used by renderVoxels for (yaw, pitch) in degrees: screen-right R, screen-up U, toward-camera C (grid space).
export function cameraBasis(yawDeg, pitchDeg) {
  const y = yawDeg * DEG, p = pitchDeg * DEG, cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  return { R: [cy, 0, -sy], U: [-sp * sy, cp, -sp * cy], C: [sy * cp, sp, cy * cp] };
}

// Face features on a sphere: centre C (world), radius R, rotation Rm (world from head-local), feats {name: {d, size}}.
// toGrid(world point) -> grid point; proj(grid point) -> screen. Returns {name: {x, y, ax, ay, bx, by, z}} where
// (a, b) are the screen vectors of the feature's local right/down tangents (length = size voxels), z = facing (+ toward us).
export function faceFeatures(toGrid, proj, C, R, Rm, feats, cam) {
  const out = {};
  const right = mv(Rm, [1, 0, 0]), up = mv(Rm, [0, 1, 0]);
  for (const [k, f] of Object.entries(feats)) {
    const dw = norm(mv(Rm, f.d));
    const P0 = add(C, scl(dw, R * (f.lift ?? 1)));
    const t1 = norm(sub(right, scl(dw, dot(right, dw))));
    const t2 = norm(sub(scl(dw, dot(up, dw)), up));
    const g0 = toGrid(P0), s0 = proj(g0);
    const s1 = proj(toGrid(add(P0, scl(t1, f.size)))), s2 = proj(toGrid(add(P0, scl(t2, f.size))));
    const gd = sub(toGrid(add(P0, dw)), g0);
    out[k] = { x: s0[0], y: s0[1], ax: s1[0] - s0[0], ay: s1[1] - s0[1], bx: s2[0] - s0[0], by: s2[1] - s0[1], z: dot(gd, cam.C) };
  }
  return out;
}

const FEATS = {
  eyeL: { d: [0.37, 0.1, 0.92], size: 3.3 }, eyeR: { d: [-0.37, 0.1, 0.92], size: 3.3 },
  mouth: { d: [0, -0.33, 0.94], size: 2.5 }, cheekL: { d: [0.6, -0.16, 0.78], size: 1.9 }, cheekR: { d: [-0.6, -0.16, 0.78], size: 1.9 },
  mid: { d: [0, 0.1, 1], size: 1 },
};

const fract = (v) => v - Math.floor(v);
// Re-shade bubble pixels (palette entries flagged bub) and glass pixels in place; returns the bubble mask.
// head = {hc:[x,y], hr, Rinv (head-local from world), mx, cam} for the bubble's own patterns.
export function shadeBubble(r, isBub, isGlass, T, head) {
  const W = r.w, H = r.h, ids = r.ids;
  const g = ctxOf(r.canvas);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const mask = new Uint8Array(W * H);
  const [tr, tg, tb] = hexToRgb(T.tint), [dr, dg, db] = hexToRgb(T.deep);
  const { hc, hr, Rinv, mx, cam } = head;
  const sp = T.special;
  const c30 = Math.cos(-0.62), s30 = Math.sin(-0.62);
  let n = 0;
  for (let p = 0; p < W * H; p++) {
    const id = ids[p];
    const i = p * 4;
    const ga = isGlass[id];
    if (ga) {
      d[i] = lerp(d[i], 235, 0.18); d[i + 1] = lerp(d[i + 1], 252, 0.18); d[i + 2] = lerp(d[i + 2], 255, 0.18);
      d[i + 3] = ga;
      continue;
    }
    if (!isBub[id]) continue;
    mask[p] = 1; n++;
    const x = p % W, y = (p / W) | 0;
    const u = (x + 0.5 - hc[0]) / hr, v = (y + 0.5 - hc[1]) / hr;
    const dd = Math.min(1, Math.sqrt(u * u + v * v));
    const L = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const rim = smoothstep(0.42, 1.0, dd);
    const nz = Math.sqrt(Math.max(0, 1 - dd * dd));
    // surface normal in head-local space (for patterns that stick to the head)
    const gx = cam.R[0] * u - cam.U[0] * v + cam.C[0] * nz, gy = cam.R[1] * u - cam.U[1] * v + cam.C[1] * nz, gz = cam.R[2] * u - cam.U[2] * v + cam.C[2] * nz;
    const wn = [mx * gx, gy, gz];
    let cr, cg, cb, al;
    const k = 0.8 + 0.55 * (L - 0.55);
    if (sp === 'chrome') {
      const up = wn[1];
      if (up > 0.04) { const t = clamp01(up * 1.3); cr = lerp(190, 40, t); cg = lerp(236, 140, t); cb = lerp(255, 230, t); }
      else if (up > -0.06) { cr = 250; cg = 255; cb = 255; }
      else { const t = clamp01(-up * 1.6); cr = lerp(120, 40, t); cg = lerp(220, 130, t); cb = lerp(70, 40, t); }
      cr *= 0.75 + 0.45 * L; cg *= 0.75 + 0.45 * L; cb *= 0.75 + 0.45 * L;
      al = 1;
    } else if (sp === 'gold') {
      const t = clamp01(L * 1.1 - rim * 0.35);
      cr = lerp(170, 255, t); cg = lerp(110, 226, t); cb = lerp(10, 120, t); al = 1;
    } else {
      cr = tr * k; cg = tg * k; cb = tb * k;
      let hue = T.hue + T.span * dd * dd + 35 * Math.sin(Math.atan2(v, u) * 2 + 1.3);
      let mixI = T.irid * (0.1 + 0.9 * rim);
      if (sp === 'aurora') { hue = 130 + 140 * (0.5 + 0.5 * Math.sin(u * 3 + v * 6)); mixI = Math.max(mixI, 0.45); }
      const [ir, ig, ib] = hslToRgb(hue, 0.95, 0.64);
      cr = cr * (1 - mixI) + ir * mixI; cg = cg * (1 - mixI) + ig * mixI; cb = cb * (1 - mixI) + ib * mixI;
      al = T.alpha + (1 - T.alpha) * Math.pow(rim, 1.3) * 0.88;
      if (sp === 'stars') {
        const hs = hash3(Math.floor(wn[0] * 26 + 40), Math.floor(wn[1] * 26 + 40), Math.floor(wn[2] * 26 + 40), 11);
        const neb = 0.5 + 0.5 * Math.sin(wn[0] * 4 + wn[1] * 3);
        cr = lerp(cr, 150, neb * 0.3); cb = lerp(cb, 200, neb * 0.3);
        if (hs < 0.05) { cr = 255; cg = 255; cb = 240; al = 1; }
      } else if (sp === 'globe') {
        const ln = Rinv ? mv(Rinv, wn) : wn;
        const lat = Math.asin(clamp(ln[1], -1, 1)), lon = Math.atan2(ln[0], ln[2]);
        const s = Math.sin(ln[0] * 3.1 + 1.2) * Math.sin(ln[1] * 4.3 + 0.4) + 0.8 * Math.sin(ln[2] * 3.7 + ln[0] * 2.1) + 0.3 * Math.sin(ln[1] * 9 + ln[2] * 6);
        const grid = Math.abs(fract(lat / 0.35) - 0.5) > 0.44 || Math.abs(fract(lon / 0.42) - 0.5) > 0.45;
        if (s > 0.42) { cr = 240 * k + 20; cg = 255 * k; cb = 236 * k; al = Math.max(al, 0.95); }
        else if (grid) { cr = lerp(cr, 255, 0.5); cg = lerp(cg, 255, 0.5); cb = lerp(cb, 255, 0.5); al = Math.max(al, 0.75); }
      }
    }
    // screen-fixed highlights: the glossy "window" up-left, a pin glint, rim light and bounce light
    const hu = u + 0.4, hv = v + 0.47;
    const ru = hu * c30 - hv * s30, rv = hu * s30 + hv * c30;
    const win = (ru / 0.3) ** 2 + (rv / 0.165) ** 2;
    let spec = win < 1 ? (win < 0.55 ? 0.96 : 0.7) : 0;
    if ((u - 0.02) ** 2 + (v + 0.76) ** 2 < 0.0045) spec = Math.max(spec, 0.85);
    if (dd > 0.8 && dd < 0.93 && v > 0.22 && u > -0.4) { spec = Math.max(spec, 0.42); al = Math.max(al, 0.75); }
    if (dd > 0.87 && u < -0.15 && v < 0.2) spec = Math.max(spec, 0.32);
    cr += (255 - cr) * spec; cg += (255 - cg) * spec; cb += (255 - cb) * spec;
    al = Math.max(al, spec);
    d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = al * 255;
  }
  if (n) {
    // the outline around the bubble becomes a coloured rim (deep tint) instead of near-black
    for (let p = 0; p < W * H; p++) {
      if (ids[p] || !d[p * 4 + 3]) continue;
      const x = p % W;
      if ((x > 0 && mask[p - 1]) || (x < W - 1 && mask[p + 1]) || (p >= W && mask[p - W]) || (p + W < W * H && mask[p + W])) {
        const i = p * 4;
        d[i] = dr; d[i + 1] = dg; d[i + 2] = db; d[i + 3] = 225;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return mask;
}

// ====================================================================== frame cache

const BASE_VS = 1.6;      // px per voxel at scale 1
const PITCH = 14;
const FACE_YAW = 38;
const YAW_STEP = 10;
const MAX_FRAMES = 1400;
const MAX_PIXELS = 9e6;
let framePx = 0;
const FRAMES = new Map();
const FAMS = new Map();
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

const RENDER = { ao: 1.0, edges: 0.7, sideEdges: 0.5, jitter: 0.08, depthThreshold: 2.4, glowRadius: 2 };

// Render composed items, shade the bubble and map the face. Shared by poses and thumbnails.
function renderComposite(kit, items, headSol, mx, yaw, pitch, vs) {
  const { m, gmin } = compose(kit, items, mx);
  const r = renderVoxels(m, { scale: vs, yaw, pitch, ...RENDER });
  const toGrid = (w) => [mx * w[0] - gmin[0], w[1] - gmin[1], w[2] - gmin[2]];
  const proj = (g) => r.project(g[0], g[1], g[2]);
  const cam = cameraBasis(yaw, pitch);
  let face = null;
  if (headSol) {
    const hc = proj(toGrid(headSol.C));
    const Rm = headSol.Rm;
    const Rinv = [Rm[0], Rm[3], Rm[6], Rm[1], Rm[4], Rm[7], Rm[2], Rm[5], Rm[8]];
    const mask = shadeBubble(r, kit.isBub, kit.isGlass, kit.T, { hc, hr: headSol.R * vs, Rinv, mx, cam });
    face = { feats: faceFeatures(toGrid, proj, headSol.C, headSol.R, Rm, FEATS, cam), mask: { d: mask, w: r.w, h: r.h }, hc, hr: headSol.R * vs };
  } else if (kit.isGlass.some((v) => v)) shadeBubble(r, kit.isBub, kit.isGlass, kit.T, { hc: [0, 0], hr: 1, mx, cam });
  return { r, m, toGrid, proj, face };
}

function buildFrame(kit, pose, fi, yaw, vs, mx, hideRod) {
  const t0 = now();
  const pd = POSES[pose];
  const u = pd.loop ? fi / pd.n : fi / Math.max(1, pd.n - 1);
  const p = pd.fn(u, fi);
  const ta = now();
  const sol = solve(kit, p, fi, hideRod);
  const tb = now();
  const { r, m, toGrid, proj, face } = renderComposite(kit, sol.items, sol.head, mx, yaw, PITCH, vs);
  const td = now();
  PROF.solve += tb - ta; PROF.render += td - tb; PROF.n++; PROF.px = r.w * r.h;
  const [fx, fy] = proj(toGrid([0, 0, 0]));
  const rel = (w) => { const q = proj(toGrid(w)); return [q[0] - fx, q[1] - fy]; };
  const A = sol.anchors;
  const anchors = { rodTip: rel(A.rodTip), hands: rel(A.hands), handL: rel(A.handL), handR: rel(A.handR), head: rel(A.head), mouth: rel(A.mouth) };
  let front = null;
  if (pose === 'hold') {
    const hs = kit.handSet;
    front = renderVoxels(m, { scale: vs, yaw, pitch: PITCH, ...RENDER, keepVoxel: (x, y, z) => hs.has(m.get(x, y, z)) }).canvas;
  }
  const dt = now() - t0;
  spent += dt; statBuilt++; statMs += dt;
  return { canvas: r.canvas, glow: r.glow, front, fx, fy, anchors, face, p, vs };
}

function yawFor(o) {
  if (o.yaw != null) return { yaw: Math.round(o.yaw / YAW_STEP) * YAW_STEP, mx: 1 };
  const f = (o.facing ?? 1) < 0 ? -1 : 1;
  return { yaw: f > 0 ? -FACE_YAW : FACE_YAW, mx: -f };
}

function getFrame(kit, pose, fi, yaw, vs, mx, force, hideRod = false) {
  const fam = `${kit.key}#${pose}#${yaw}#${vs}#${mx}#${hideRod ? 1 : 0}`;
  const key = fam + '#' + fi;
  let fr = FRAMES.get(key);
  if (fr) { FRAMES.delete(key); FRAMES.set(key, fr); return fr; }
  const set = FAMS.get(fam);
  if (!force && overBudget()) {
    if (set && set.size) {
      let best = -1, bd = 1e9;
      for (const f of set) { const d = Math.abs(f - fi); if (d < bd) { bd = d; best = f; } }
      statFallback++;
      return FRAMES.get(fam + '#' + best);
    }
    for (let d = YAW_STEP; d <= 180; d += YAW_STEP) {
      for (const yy of [yaw - d, yaw + d]) {
        const f2 = `${kit.key}#${pose}#${yy}#${vs}#${mx}#${hideRod ? 1 : 0}`;
        const s2 = FAMS.get(f2);
        if (s2 && s2.size) { statFallback++; const f0 = s2.has(fi) ? fi : s2.values().next().value; return FRAMES.get(f2 + '#' + f0); }
      }
    }
  }
  fr = buildFrame(kit, pose, fi, yaw, vs, mx, hideRod);
  fr.px = fr.canvas.width * fr.canvas.height * (fr.front ? 2.2 : 1.2) * (fr.glow ? 1.5 : 1);
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

const vsFor = (scale) => Math.max(0.5, Math.round(BASE_VS * (scale ?? 1) * 4) / 4);

// Pre-build frames for the given poses (spends at most `ms` per call). Returns true when all are cached.
export function warmCharacter(look, { poses = POSE_NAMES, scale = 1, facing = 1, yaw = null, ms = 6, rodLook = null } = {}) {
  const L = normalizeLook(look), kit = kitFor(L, rodLookOf(L, { rodLook }));
  const { yaw: yw, mx } = yawFor({ facing, yaw });
  const vs = vsFor(scale);
  const t0 = now();
  for (const pose of poses) {
    if (!POSES[pose]) continue;
    for (let fi = 0; fi < POSES[pose].n; fi++) {
      if (FRAMES.has(`${kit.key}#${pose}#${yw}#${vs}#${mx}#0#${fi}`)) continue;
      if (now() - t0 > ms) return false;
      getFrame(kit, pose, fi, yw, vs, mx, true);
    }
  }
  return true;
}

// ====================================================================== live cartoon face (crisp pixel art on the bubble)

const INK = '#13234a';
// Rasterise a shape given in a feature's local frame: (u, v) in units of `size` (u right, v down along the surface).
// fn(u, v) -> css colour | null. mask = {d, w, h} (frame-canvas pixels allowed), X/Y = frame canvas origin on ctx.
export function rasterFeature(ctx, X, Y, f, k, ext, mask, fn) {
  const ax = f.ax * k, ay = f.ay * k, bx = f.bx * k, by = f.by * k;
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 0.02) return;
  const hw = (Math.abs(ax) + Math.abs(bx)) * ext + 1, hh = (Math.abs(ay) + Math.abs(by)) * ext + 1;
  const x0 = Math.floor(f.x - hw), x1 = Math.ceil(f.x + hw), y0 = Math.floor(f.y - hh), y1 = Math.ceil(f.y + hh);
  for (let y = y0; y <= y1; y++) {
    let run = null, rs = 0;
    const dy = y + 0.5 - f.y;
    for (let x = x0; x <= x1 + 1; x++) {
      let c = null;
      if (x <= x1 && (!mask || (x >= 0 && y >= 0 && x < mask.w && y < mask.h && mask.d[y * mask.w + x]))) {
        const dx = x + 0.5 - f.x;
        const u = (dx * by - dy * bx) / det, v = (ax * dy - ay * dx) / det;
        if (u > -ext && u < ext && v > -ext && v < ext) c = fn(u, v);
      }
      if (c !== run) {
        if (run) { ctx.fillStyle = run; ctx.fillRect(X + rs, Y + y, x - rs, 1); }
        run = c; rs = x;
      }
    }
  }
}
// Screen direction (sx, sy) expressed in a feature's local (u, v) frame, normalised.
function localDir(f, sx, sy) {
  const det = f.ax * f.by - f.ay * f.bx;
  if (Math.abs(det) < 1e-4) return [sx, sy];
  const u = (sx * f.by - sy * f.bx) / det, v = (f.ax * sy - f.ay * sx) / det;
  const l = Math.hypot(u, v) || 1;
  return [u / l, v / l];
}

const inE = (u, v, rx, ry) => (u / rx) ** 2 + (v / ry) ** 2 <= 1;
function starR(u, v) { const a = Math.atan2(v, u) + Math.PI / 2; const k = (Math.cos(a * 5) + 1) / 2; return 0.3 + 0.44 * k * k; }
function heartIn(u, v, s = 1) { const x = (u / s) * 1.12, y = (-v / s) * 1.12 + 0.2; const a = x * x + y * y - 1; return a * a * a - x * x * y * y * y <= 0; }

// One cartoon eye. E: {style, gu, gv (gaze, local), su, sv (light dir, local), lid 0..1, t, side (+1 left eye / -1 right), px (pixels per unit)}
export function eyePixel(E, u, v) {
  const { style, gu, gv, su, sv, lid, px } = E;
  const th = Math.max(0.17, 1.15 / px); // line thickness in units, never thinner than ~1 px
  let st = style;
  if (st === 'wink') st = E.side < 0 ? 'happy' : 'bean';
  if (E.mode === 'happy' && st !== 'led' && st !== 'heart' && st !== 'star') st = 'happy';
  if (st === 'happy') { const c = -0.42 + 0.78 * u * u; return Math.abs(u) < 0.86 && Math.abs(v - c) < th * 1.05 ? INK : null; }
  if (lid >= 0.82 && st !== 'led') { const c = 0.18 - 0.4 * u * u; return Math.abs(u) < 0.82 && Math.abs(v - c) < th ? INK : null; }
  const lidY = -1.05 + 2.1 * lid;
  if (st === 'led') {
    const ry = 0.48 * (1 - lid * 0.9) + 0.04;
    if (Math.abs(u) > 0.82 || Math.abs(v) > ry) return null;
    if ((Math.abs(u) > 0.62 && Math.abs(v) > ry - 0.2) && (Math.abs(u) - 0.62) ** 2 + (Math.abs(v) - (ry - 0.2)) ** 2 > 0.04) return null;
    return Math.floor((v + 2) * px * 0.5) % 2 ? '#3fe0ff' : '#b8fbff';
  }
  if (st === 'dot') {
    const uu = u - gu * 0.4, vv = v - gv * 0.4;
    if (!inE(uu, vv, 0.42, 0.48) || v < lidY) return null;
    return (uu + 0.16) ** 2 + (vv + 0.18) ** 2 < Math.max(0.02, (0.55 / px) ** 2) ? '#ffffff' : INK;
  }
  const scale = st === 'derp' ? (E.side > 0 ? 1.08 : 0.82) : 1;
  u /= scale; v /= scale;
  const tall = st === 'anime' ? 0.82 : st === 'bean' || st === 'sleepy' || st === 'teary' ? 0.86 : 1;
  if (st === 'teary' && inE(u - 0.5, v - 1.12, 0.2, 0.28) && v > 0.95) return '#7fd8ff';
  if (!inE(u, v, tall, 1)) return null;
  if (v < lidY) return null;
  if (lid > 0.02 && v < lidY + th) return INK;
  const shine = (cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 < Math.max(r * r, (0.7 / px) ** 2);
  if (st === 'bean' || st === 'sleepy' || st === 'teary') {
    const ou = gu * 0.18, ov = gv * 0.18;
    if (shine(su * 0.36 + ou, sv * 0.4 + ov, st === 'teary' ? 0.34 : 0.3)) return '#ffffff';
    if (shine(-su * 0.34 + ou, -sv * 0.4 + ov, 0.13)) return '#cfeaff';
    if (st === 'teary' && shine(su * 0.05 + ou, 0.52, 0.12)) return '#ffffff';
    const rr = (u / tall) ** 2 + v * v;
    if (rr > (1 - th * 1.1) ** 2) return INK;
    return v < -0.15 ? '#16245a' : v < 0.4 ? '#1f3f88' : '#3f86e8';
  }
  // sclera styles
  const rr = (u / tall) ** 2 + v * v;
  if (rr > (1 - th) ** 2) return INK;
  if (st === 'swirl') {
    const r = Math.sqrt(rr), a = Math.atan2(v, u);
    return r < 0.86 && fract(a / TAU + r * 2.1 - E.t * 1.4) < 0.36 ? INK : '#ffffff';
  }
  const gx = gu * 0.3, gy = gv * 0.3 + (st === 'derp' ? 0 : 0);
  const dgx = st === 'derp' ? (E.side > 0 ? -0.32 : 0.34) + gu * 0.1 : gx, dgy = st === 'derp' ? (E.side > 0 ? -0.3 : 0.32) : gy;
  const iu = u - dgx, iv = v - dgy;
  if (st === 'heart') {
    if (heartIn(iu, iv + 0.05, 0.78)) {
      if (shine(su * 0.3 + dgx, sv * 0.32 + dgy, 0.16)) return '#ffffff';
      return iv < -0.1 ? '#ff7ab0' : '#ff3a7a';
    }
    return '#ffffff';
  }
  if (st === 'star') {
    const r = Math.hypot(iu, iv);
    if (r < starR(iu, iv) * 1.05) return r < 0.18 ? '#fff6c0' : iv < 0 ? '#ffe04a' : '#ffb81a';
    return '#ffffff';
  }
  const irisR = st === 'anime' ? 0.74 : st === 'derp' ? 0.4 : 0.66;
  const ir = (iu / (st === 'anime' ? 0.82 : 1)) ** 2 + iv * iv;
  if (shine(su * 0.38 + dgx, sv * 0.4 + dgy, st === 'anime' ? 0.24 : 0.21)) return '#ffffff';
  if (shine(-su * 0.3 + dgx, -sv * 0.34 + dgy, 0.1)) return '#ffffff';
  if (st === 'anime' && shine(su * 0.05 + dgx, sv * 0.5 + dgy, 0.08)) return '#ffffff';
  if (ir < irisR * irisR) {
    if (st === 'derp' || ir < (irisR * 0.5) ** 2) return INK;
    if (st === 'anime') return iv < -0.2 ? '#127a58' : iv < 0.25 ? '#2bb878' : '#9cf0b8';
    return iv < -0.2 ? '#0f78c8' : iv < 0.25 ? '#22b8e8' : '#8ff2ff';
  }
  if (st === 'anime' && v < -0.72) return INK;
  return '#ffffff';
}

// Mouth. Mo: {style, state ('rest'|'open'|'grit'|'frown'|'grin'|'o'|'smirk'), open 0..1, px}
export function mouthPixel(Mo, u, v) {
  const th = Math.max(0.17, 1.1 / Mo.px);
  let st = Mo.style, open = Mo.open;
  if (Mo.state === 'open') open = Math.max(open, 0.8);
  if (Mo.state === 'grin') st = 'grin';
  if (Mo.state === 'o') st = 'o';
  if (Mo.state === 'smirk') st = 'smirk';
  if (st === 'beam') open = Math.max(open, 0.85);
  if (st === 'led') {
    const h = 0.12 + open * 0.45;
    if (open > 0.08) return Math.abs(u) < 0.7 && Math.abs(v - 0.05) < h ? (Math.floor((v + 2) * Mo.px * 0.5) % 2 ? '#3fe0ff' : '#b8fbff') : null;
    const c = -0.05 + 0.35 * (1 - u * u);
    return Math.abs(u) < 0.8 && Math.abs(v - c) < th * 1.3 ? '#7ff4ff' : null;
  }
  if (Mo.state === 'grit') {
    if (Math.abs(u) > 0.78 || Math.abs(v - 0.05) > 0.3) return null;
    if (Math.abs(u) > 0.78 - th || Math.abs(v - 0.05) > 0.3 - th) return INK;
    return Math.abs(v - 0.05) < th * 0.5 || Math.abs(fract(u * 2.2) - 0.5) < 0.08 ? '#9ab8d8' : '#ffffff';
  }
  if (Mo.state === 'frown') { const c = 0.32 - 0.42 * (1 - u * u); return Math.abs(u) < 0.8 && Math.abs(v - c) < th ? INK : null; }
  if (st === 'o') {
    const s = 0.75 + open * 0.5, r = (u / (0.38 * s)) ** 2 + ((v - 0.1) / (0.46 * s)) ** 2;
    return r > 1 ? null : r > (1 - th / (0.4 * s)) ** 2 ? INK : v > 0.25 ? '#ff7aa8' : '#6a1a3a';
  }
  if (open > 0.08 || st === 'grin') {
    // D-shaped open mouth
    const o = st === 'grin' ? Math.max(open, 0.55) : open;
    const w = 0.92, top = -0.18 - (st === 'grin' ? 0.04 : 0), bot = top + (0.25 + 0.85 * o) * (1 - (u / w) ** 2);
    if (Math.abs(u) > w || v < top - th * 0.6 || v > bot + th * 0.6) return null;
    if (v < top + th * 0.5 || v > bot - th * 0.5 || Math.abs(u) > w - th * 0.5) return INK;
    if (st === 'grin' && v < top + 0.3) return '#ffffff';
    if (v > bot - 0.12 - 0.3 * o && Math.abs(u) < 0.55) return '#ff6a9a';
    return '#6a1a3a';
  }
  if (st === 'cat') { const c = 0.3 * Math.abs(Math.sin((u * Math.PI) / 0.82)) - 0.04; return Math.abs(u) < 0.86 && Math.abs(v - c) < th ? INK : null; }
  if (st === 'smirk') { const c = 0.16 - 0.26 * u - 0.12 * u * u; return u > -0.7 && u < 0.85 && Math.abs(v - c) < th ? INK : null; }
  if (st === 'wobbly') { const c = 0.12 + 0.12 * Math.sin(u * 8.5); return Math.abs(u) < 0.85 && Math.abs(v - c) < th ? INK : null; }
  if (st === 'kiss') {
    const a = (u - 0.08) ** 2 + (v + 0.02) ** 2 < 0.06, b = (u - 0.08) ** 2 + (v - 0.4) ** 2 < 0.06;
    if (a || b) return (u - 0.02) ** 2 + (v + 0.1) ** 2 < 0.01 ? '#ffd0e0' : '#ff4a8a';
    return null;
  }
  // smile family
  const c = -0.12 + 0.42 * (1 - u * u);
  const line = Math.abs(u) < 0.86 && Math.abs(v - c) < th;
  if (line) return INK;
  if (st === 'tongue' && inE(u - 0.18, v - c - 0.26, 0.26, 0.3) && v > c) return Math.abs(u - 0.18) < 0.05 ? '#e8407a' : '#ff7aa8';
  if (st === 'fang' && u > 0.22 && u < 0.46 && v > c && v < c + 0.34 * (1 - Math.abs(u - 0.34) / 0.12)) return '#ffffff';
  if (st === 'toothy' && Math.abs(u) < 0.3 && v > c && v < c + 0.36) return Math.abs(u) < 0.04 ? '#c8d8e8' : '#ffffff';
  return null;
}

// Face accessory in a feature frame (which = 'eyeL'|'eyeR'|'mid'|'cheekL'|'cheekR'|'mouth').
function accPixel(id, which, u, v, A) {
  const th = Math.max(0.12, 1 / A.px);
  const eye = which === 'eyeL' || which === 'eyeR';
  const glint = (u + v > -0.95 && u + v < -0.55);
  if (id === 'shades' || id === 'flare') {
    if (eye) {
      const inL = Math.abs(u) < 1.32 && v > -0.95 && v < 0.85 && !(Math.abs(u) > 0.9 && v > 0.35 && (Math.abs(u) - 0.9) ** 2 + (v - 0.35) ** 2 > 0.2);
      if (!inL) return null;
      const edge = Math.abs(u) > 1.32 - th || v < -0.95 + th;
      if (edge) return id === 'flare' ? '#e8eef4' : INK;
      if (id === 'flare') {
        const sx = u - 0.45, sy = v + 0.35, pulse = 0.6 + 0.4 * Math.sin(A.t * 4 + (which === 'eyeL' ? 0 : 2));
        if (which === 'eyeL' && ((Math.abs(sx) < th * 0.8 && Math.abs(sy) < 0.75 * pulse) || (Math.abs(sy) < th * 0.8 && Math.abs(sx) < 0.75 * pulse))) return '#ffffff';
        if (glint) return '#fff6c0';
        return v < -0.2 ? '#ff7a1a' : v < 0.3 ? '#ffb02a' : '#ffe27a';
      }
      if (glint) return 'rgba(190,230,255,0.85)';
      return v < -0.1 ? '#0c1838' : '#1f3f7a';
    }
    if (which === 'mid') return Math.abs(v + 1.2) < 0.45 && Math.abs(u) < 2.4 ? (id === 'flare' ? '#e8eef4' : INK) : null;
    return null;
  }
  if (id === 'round' || id === 'goggles' || id === 'monocle') {
    if (eye) {
      if (id === 'monocle' && which !== 'eyeL') return null;
      const r = Math.hypot(u, v);
      const R0 = id === 'goggles' ? 1.32 : 1.24, w = id === 'goggles' ? 0.32 : th;
      if (Math.abs(r - R0) < w) return id === 'goggles' ? (v < 0 ? '#5ae0ff' : '#1fa8d8') : id === 'monocle' ? '#ffcf3a' : INK;
      if (r < R0) return glint ? 'rgba(255,255,255,0.75)' : id === 'goggles' ? 'rgba(120,220,255,0.28)' : null;
      if (id === 'monocle' && u > 0.6 && Math.abs(v - (1.2 + (u - 0.6) * 1.4)) < th && u < 1.6) return '#ffcf3a';
      return null;
    }
    if (which === 'mid' && id !== 'monocle') return Math.abs(v + 1.0) < (id === 'goggles' ? 0.6 : 0.35) && Math.abs(u) < 2.2 ? (id === 'goggles' ? '#1fa8d8' : INK) : null;
    return null;
  }
  if (id === 'heart' || id === 'star') {
    if (!eye) return which === 'mid' && Math.abs(v + 1.0) < 0.35 && Math.abs(u) < 2.4 ? '#ff4a8a' : null;
    const inside = id === 'heart' ? heartIn(u, v, 1.45) : Math.hypot(u, v) < starR(u, v) * 1.9;
    const inner = id === 'heart' ? heartIn(u, v, 1.2) : Math.hypot(u, v) < starR(u, v) * 1.6;
    if (!inside) return null;
    if (!inner) return id === 'heart' ? '#ff3a7a' : '#ffcf3a';
    if (glint) return 'rgba(255,255,255,0.85)';
    return id === 'heart' ? 'rgba(255,60,130,0.72)' : 'rgba(255,170,40,0.72)';
  }
  if (id === 'visor' && which === 'mid') {
    if (Math.abs(u) > 10.2 || v < -4.4 || v > 2.4) return null;
    if (Math.abs(u) > 10.2 - 0.6 || v < -4.4 + 0.5 || v > 2.4 - 0.5) return '#e8fbff';
    if (Math.abs(fract(v * 0.7 + A.t * 0.8) - 0.5) < 0.06) return 'rgba(220,255,255,0.7)';
    return 'rgba(80,230,255,0.42)';
  }
  if (id === 'blush' && (which === 'cheekL' || which === 'cheekR')) return heartIn(u, v, 0.85) ? (u + v < -0.5 ? '#ffb0d0' : '#ff5a9a') : null;
  if (id === 'freckles' && (which === 'cheekL' || which === 'cheekR')) {
    for (const [fx, fy] of [[-0.5, -0.2], [0.1, -0.45], [0.5, 0.05], [-0.1, 0.35]]) if ((u - fx) ** 2 + (v - fy) ** 2 < Math.max(0.025, (0.7 / A.px) ** 2)) return '#c86a4a';
    return null;
  }
  if (id === 'bandaid' && which === 'cheekR') {
    const ru = u * 0.8 + v * 0.6, rv = -u * 0.6 + v * 0.8;
    if (Math.abs(ru) > 1.1 || Math.abs(rv) > 0.42) return null;
    return Math.abs(ru) < 0.35 ? '#ffe2c0' : (Math.round(ru * 6) + Math.round(rv * 6)) % 2 ? '#ffc890' : '#f2b070';
  }
  if (id === 'mustache' && which === 'mouth') {
    const lobe = ((Math.abs(u) - 0.42) / 0.5) ** 2 + ((v + 0.48) / 0.26) ** 2 < 1;
    const curl = (Math.abs(u) - 0.98) ** 2 + (v + 0.62) ** 2 < 0.03 && Math.abs(u) > 0.9;
    if (lobe || curl) return v < -0.55 ? '#7a5a3a' : '#5a3a22';
    return null;
  }
  if (id === 'lashes' && eye) {
    const s = which === 'eyeL' ? 1 : -1;
    for (const [lx, ly, dx, dy] of [[0.55, -0.85, 0.45, -0.35], [0.85, -0.55, 0.5, -0.15]]) {
      const t = ((u * s - lx) * dx + (v - ly) * dy) / (dx * dx + dy * dy);
      if (t > 0 && t < 1 && Math.hypot(u * s - lx - dx * t, v - ly - dy * t) < th) return INK;
    }
  }
  return null;
}

const MOOD_FACE = { happy: { mouth: 'open' }, sad: { mouth: 'frown', lid: 0.35, eyes: 'teary' }, surprised: { mouth: 'o', wide: 1 }, angry: { mouth: 'grit', lid: 0.25 }, love: { eyes: 'heart', mouth: 'grin' }, excited: { eyes: 'star', mouth: 'open' } };

const EYESTATE = new Map();
function eyeState(id) {
  let st = EYESTATE.get(id);
  const tn = now();
  if (!st) { st = { blinkT: 0, nextBlink: 1.5 + Math.random() * 3, gx: 0, gy: 0, vx: 0, vy: 0, wander: [0, 0], wanderT: 0, last: tn, px: null, py: null }; EYESTATE.set(id, st); if (EYESTATE.size > 400) EYESTATE.delete(EYESTATE.keys().next().value); }
  const dt = clamp((tn - st.last) / 1000, 0, 0.05);
  st.last = tn;
  st.dt = dt;
  st.nextBlink -= dt;
  if (st.nextBlink <= 0) { st.blinkT = 0.13; st.nextBlink = 2 + Math.random() * 3.5; if (Math.random() < 0.18) st.nextBlink = 0.25; }
  st.blinkT = Math.max(0, st.blinkT - dt);
  st.wanderT -= dt;
  if (st.wanderT <= 0) { st.wanderT = 0.8 + Math.random() * 1.8; st.wander = [Math.random() * 1.4 - 0.7, Math.random() * 0.8 - 0.4]; }
  return st;
}

// Draw the face layer of a frame. face = {feats, mask, hc}; X, Y = frame canvas origin on ctx.
// o: {id, look (eyes/mouth/face styles), pose params p, lookAt, talk, mood, t, facing sign sx, px (pixels per voxel)}
export function drawFaceLayer(ctx, face, X, Y, o) {
  if (!face) return;
  const st = eyeState(o.id ?? 'main');
  const p = o.p || BASE_POSE;
  const md = MOOD_FACE[o.mood] || {};
  const eyes = md.eyes && o.mood !== 'happy' ? md.eyes : o.eyes || 'bean';
  const F = face.feats;
  // gaze target in screen space
  let tx = (p.gaze[0] * (o.sx || 1) + st.wander[0] * 0.5) * 0.8, ty = (p.gaze[1] + st.wander[1] * 0.4) * 0.8;
  if (o.lookAt) {
    const dx = o.lookAt[0] - (X + face.hc[0]), dy = o.lookAt[1] - (Y + face.hc[1]);
    const dl = Math.hypot(dx, dy) || 1, k = Math.min(1, dl / 50);
    tx = (dx / dl) * k; ty = (dy / dl) * k;
  }
  const dt = st.dt || 0.016;
  st.vx += ((tx - st.gx) * 120 - st.vx * 12) * dt; st.vy += ((ty - st.gy) * 120 - st.vy * 12) * dt;
  if (p.wobble) { st.vx += (Math.random() - 0.5) * 40 * dt; st.vy += (Math.random() - 0.5) * 40 * dt; }
  st.gx = clamp(st.gx + st.vx * dt, -1, 1); st.gy = clamp(st.gy + st.vy * dt, -1, 1);
  const blink = st.blinkT > 0 ? 1 : 0;
  const lidBase = Math.max(p.lid || 0, (p.squint || 0) * 0.55, md.lid || 0, eyes === 'sleepy' ? 0.48 : 0);
  const lid = blink ? 1 : md.wide ? 0 : lidBase;
  const mstate = o.talk > 0.05 ? 'rest' : md.mouth && (p.mouth === 'rest') ? md.mouth : p.mouth;
  const px = Math.max(1, Math.hypot(F.eyeL.ax, F.eyeL.ay, F.eyeL.bx, F.eyeL.by) / Math.SQRT2);
  const acc = o.faceAcc || 'none';
  const order = Object.keys(F).filter((k) => k !== 'mid' || acc !== 'none').sort((a, b) => F[a].z - F[b].z);
  const a0 = ctx.globalAlpha;
  for (const k of order) {
    const f = F[k];
    const vis = o.opaque ? (f.z < 0.02 ? 0 : f.z < 0.15 ? f.z / 0.15 : 1) : f.z < 0 ? 0.28 : f.z < 0.12 ? lerp(0.28, 1, f.z / 0.12) : 1;
    if (vis <= 0) continue;
    ctx.globalAlpha = a0 * vis;
    const [su, sv] = localDir(f, -0.7, -0.7);
    if (k === 'eyeL' || k === 'eyeR') {
      const [gu, gv] = localDir(f, st.gx, st.gy);
      const gl = Math.min(1, Math.hypot(st.gx, st.gy));
      const E = { style: eyes, gu: gu * gl, gv: gv * gl, su, sv, lid, t: o.t || 0, side: k === 'eyeL' ? 1 : -1, px: px, mode: blink ? null : p.eyeMode };
      if (md.wide) E.lid = blink ? 1 : 0;
      rasterFeature(ctx, X, Y, f, 1, 1.5, face.mask, (u, v) => eyePixel(E, u, v));
    } else if (k === 'mouth') {
      const mpx = Math.hypot(f.ax, f.ay);
      const Mo = { style: o.mouth || 'smile', state: mstate, open: clamp01(o.talk || 0), px: mpx };
      rasterFeature(ctx, X, Y, f, 1, 1.3, face.mask, (u, v) => mouthPixel(Mo, u, v));
    } else if ((k === 'cheekL' || k === 'cheekR') && acc !== 'blush') {
      if (vis > 0.5) { ctx.globalAlpha = a0 * vis * 0.42; rasterFeature(ctx, X, Y, f, 1, 1.1, face.mask, (u, v) => (inE(u, v, 0.9, 0.55) ? '#ff6aa8' : null)); }
    }
    if (acc !== 'none') {
      ctx.globalAlpha = a0 * vis;
      const A = { px: k === 'mid' ? Math.hypot(f.ax, f.ay) : Math.hypot(f.ax, f.ay), t: o.t || 0 };
      const ext = k === 'mid' ? 11 : 1.7;
      rasterFeature(ctx, X, Y, f, 1, ext, face.mask, (u, v) => accPixel(acc, k, u, v, A));
    }
  }
  ctx.globalAlpha = a0;
}

// ====================================================================== trails + emote effects (2D sparkle bits)

const TRAILS = new Map();
function drawSpark(ctx, x, y, s, c) { ctx.fillStyle = c; ctx.fillRect(x - s, y, s * 2 + 1, 1); ctx.fillRect(x, y - s, 1, s * 2 + 1); }
function drawBit(ctx, kind, x, y, s, a, t, seed) {
  x = Math.round(x); y = Math.round(y);
  const A = ctx.globalAlpha;
  ctx.globalAlpha = A * a;
  if (kind === 'bubbles') {
    const r = 1 + s;
    ctx.fillStyle = 'rgba(200,245,255,0.35)'; ctx.fillRect(x - r + 1, y - r + 1, r * 2 - 1, r * 2 - 1);
    ctx.fillStyle = '#eaffff';
    ctx.fillRect(x - r + 1, y - r, r * 2 - 1, 1); ctx.fillRect(x - r + 1, y + r, r * 2 - 1, 1); ctx.fillRect(x - r, y - r + 1, 1, r * 2 - 1); ctx.fillRect(x + r, y - r + 1, 1, r * 2 - 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - r + 1, y - r + 1, 1, 1);
  } else if (kind === 'sparkle') drawSpark(ctx, x, y, 1 + s, seed % 3 ? '#ffffff' : '#fff6a0');
  else if (kind === 'leaves') {
    ctx.fillStyle = seed % 2 ? '#7ee04a' : '#4cb82e';
    const f = Math.sin(t * 3 + seed) > 0 ? 1 : -1;
    ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x - (f > 0 ? 0 : 1), y - 1, 2, 1); ctx.fillRect(x + (f > 0 ? -1 : 0), y + 1, 2, 1);
    if (s > 0) { ctx.fillStyle = '#c8f56a'; ctx.fillRect(x, y, 1, 1); }
  } else if (kind === 'notes') {
    ctx.fillStyle = seed % 2 ? '#2fb8e8' : '#ff7ab0';
    ctx.fillRect(x - 1, y + 1, 2, 2); ctx.fillRect(x, y - 3, 1, 4); ctx.fillRect(x + 1, y - 3, 1 + (seed % 2), 1);
  } else if (kind === 'hearts') {
    ctx.fillStyle = '#ff4a8a';
    ctx.fillRect(x - 2, y - 1, 2, 2); ctx.fillRect(x + 1, y - 1, 2, 2); ctx.fillRect(x - 1, y, 3, 2); ctx.fillRect(x, y + 2, 1, 1);
    ctx.fillStyle = '#ffc0d8'; ctx.fillRect(x - 2, y - 1, 1, 1);
  } else if (kind === 'rainbow') {
    const cols = ['#ff5a6a', '#ffb02a', '#ffe24a', '#5cd84a', '#3fa8ff', '#a070ff'];
    for (let i = 0; i < 6; i++) { ctx.fillStyle = cols[i]; ctx.fillRect(x - 1, y + i - 3, 3, 1); }
  } else if (kind === 'drops') {
    ctx.fillStyle = '#59c3ff'; ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x - 1, y - 1, 3, 2); ctx.fillRect(x, y + 1, 1, 1);
    ctx.fillStyle = '#e8fbff'; ctx.fillRect(x - 1, y - 1, 1, 1);
  } else if (kind === 'confetti') {
    ctx.fillStyle = ['#ff5a6a', '#ffe24a', '#5cd84a', '#3fa8ff', '#ff9ad0'][seed % 5]; ctx.fillRect(x, y, 2, 1 + (seed % 2));
  } else if (kind === 'haha') {
    ctx.fillStyle = '#ffe24a'; ctx.fillRect(x - 2, y - 2, 1, 5); ctx.fillRect(x + 1, y - 2, 1, 5); ctx.fillRect(x - 1, y, 2, 1);
  }
  ctx.globalAlpha = A;
}

// Ambient trail bits that follow the character (local to (x, y), lagging behind real motion).
function drawTrail(ctx, kind, x, y, o, scale, id) {
  let T = TRAILS.get(id);
  const tn = now();
  if (!T) { T = { bits: [], x, y, last: tn, acc: 0 }; TRAILS.set(id, T); if (TRAILS.size > 120) TRAILS.delete(TRAILS.keys().next().value); }
  const dt = clamp((tn - T.last) / 1000, 0, 0.05);
  T.last = tn;
  const mvx = x - T.x, mvy = y - T.y;
  const jump = Math.abs(mvx) > 60 || Math.abs(mvy) > 60;
  T.x = x; T.y = y;
  const moving = !jump && Math.hypot(mvx, mvy) > 0.3;
  T.acc += dt * (moving ? 22 : 5);
  const h = 60 * scale;
  while (T.acc > 1) {
    T.acc -= 1;
    const seed = (Math.random() * 1000) | 0;
    const fall = kind === 'leaves' || kind === 'drops';
    T.bits.push({ x: (Math.random() - 0.5) * 22 * scale, y: fall ? -h * (0.5 + Math.random() * 0.5) : -Math.random() * h * 0.6, vx: (Math.random() - 0.5) * 8, vy: fall ? 10 + Math.random() * 8 : -(8 + Math.random() * 14), life: 1.2 + Math.random() * 0.8, t: 0, seed, s: Math.random() < 0.4 ? 1 : 0 });
  }
  if (T.bits.length > 40) T.bits.splice(0, T.bits.length - 40);
  for (let i = T.bits.length - 1; i >= 0; i--) {
    const b = T.bits[i];
    b.t += dt;
    if (b.t > b.life) { T.bits.splice(i, 1); continue; }
    if (!jump) { b.x -= mvx; b.y -= mvy; }
    b.x += (b.vx + (kind === 'leaves' ? Math.sin(b.t * 4 + b.seed) * 12 : 0)) * dt; b.y += b.vy * dt;
    const a = Math.min(1, b.t * 5) * (1 - b.t / b.life);
    drawBit(ctx, kind, x + b.x, y + b.y, b.s, a, b.t, b.seed);
  }
}

function drawEmoteFx(ctx, fx, hx, hy, t, scale) {
  const n = fx === 'confetti' ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const ph = fract(t * 0.7 + i / n);
    const a = (i * 2.4) % TAU;
    const r = (10 + 22 * ph) * scale;
    let kind = fx;
    if (fx === 'sparkle') kind = 'sparkle';
    const x = hx + Math.cos(a) * r, y = hy - 6 * scale + Math.sin(a) * r * 0.6 - (fx === 'hearts' || fx === 'notes' || fx === 'bubbles' ? ph * 16 * scale : 0);
    drawBit(ctx, kind, x, y, ph < 0.5 ? 1 : 0, Math.sin(ph * Math.PI), t, i);
  }
}

// ====================================================================== draw

export function drawCharacter(ctx, x, y, o = {}) {
  const look = normalizeLook(o.look);
  const rl = rodLookOf(look, o);
  const kit = kitFor(look, rl);
  let pose = o.pose === 'emote' ? emotePose(look) : o.pose;
  if (!POSES[pose]) pose = 'idle';
  const t = o.t ?? 0;
  const scale = o.scale ?? 1;
  const vs = vsFor(scale);
  const { yaw, mx } = yawFor(o);
  const fi = poseFrame(pose, t);
  const fr = getFrame(kit, pose, fi, yaw, vs, mx, false, o.rod === false);
  const X = Math.round(x - fr.fx), Y = Math.round(y - fr.fy);
  const sx = o.yaw != null ? -Math.sign(Math.sin(yaw * DEG)) || 1 : (o.facing ?? 1) < 0 ? -1 : 1;
  if (o.shadow !== false && pose !== 'sit') {
    const lift = fr.p.off[1] > 1 ? clamp01(1 - fr.p.off[1] / 10) : 1;
    const w = Math.round(9 * vs * lift), h = Math.max(1, Math.round(1.4 * vs * lift));
    ctx.fillStyle = 'rgba(10,40,80,0.2)';
    for (let i = -h; i <= h; i++) { const hw = Math.round(w * Math.sqrt(1 - (i / (h + 0.5)) ** 2)); ctx.fillRect(Math.round(x) - hw, Math.round(y) + i, hw * 2, 1); }
  }
  if (look.shoes === 'jet' && o.shadow !== false) {
    ctx.fillStyle = 'rgba(120,255,255,0.25)';
    ctx.fillRect(Math.round(x) - Math.round(6 * vs), Math.round(y) - 1, Math.round(12 * vs), 2);
  }
  ctx.drawImage(fr.canvas, X, Y);
  if (fr.glow) {
    const prev = ctx.globalCompositeOperation, pa = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pa * 0.55;
    ctx.drawImage(fr.glow, X, Y);
    ctx.globalCompositeOperation = prev; ctx.globalAlpha = pa;
  }
  drawFaceLayer(ctx, fr.face, X, Y, { id: o.id ?? 'main', eyes: look.eyes, mouth: look.mouth, faceAcc: look.face, p: fr.p, lookAt: o.lookAt, talk: o.talk, mood: o.mood, t, sx });
  const A = fr.anchors;
  const ax = (a) => [Math.round(x + a[0]), Math.round(y + a[1])];
  if (pose === 'hold' && o.fish?.compiled) {
    try {
      const c = o.fish.compiled;
      const len = (c.L || 16) * 1.45;
      const fs = clamp((o.fishScale ?? 1) * (30 * vs) / len, 0.25, 1.6 * vs / BASE_VS);
      const hx = x + A.hands[0], hy = y + A.hands[1] - 1;
      const wig = S(t * 7) * 0.12;
      drawFishRig(ctx, c, {
        x: hx, y: hy, facing: -sx, turn: 1, angle: wig, scale: fs, squash: S(t * 9) * 0.08,
        swimPhase: (t * 1.3) % 1, tailPhase: (t * 2.6) % 1, finPhase: (t * 2) % 1, speed01: 0.5,
        lookX: hx + sx * 30, lookY: hy - 20, blink: 0, emotion: o.fish.emotion || 'surprised', mouth: 0.4 + 0.4 * Math.abs(S(t * 6)), time: t,
      });
    } catch { /* fish art in flux */ }
    if (fr.front) ctx.drawImage(fr.front, X, Y);
  }
  const k = vs / BASE_VS;
  if (o.trail !== false && look.trail !== 'none') drawTrail(ctx, look.trail, Math.round(x), Math.round(y), o, k, 'tr:' + (o.id ?? 'main'));
  if (o.pose === 'emote') { const fx = EMOTES[look.emote]?.fx; if (fx) drawEmoteFx(ctx, fx, x + A.head[0], y + A.head[1], t, k); }
  return { rodTip: ax(A.rodTip), hands: ax(A.hands), head: ax(A.head), handL: ax(A.handL), handR: ax(A.handR), mouth: ax(A.mouth) };
}

// ====================================================================== wardrobe thumbnails

const PREVIEWS = new Map();
const HEAD_SLOTS = new Set(['tint', 'eyes', 'mouth', 'hat', 'hair', 'face']);
// Cached thumbnail for an item worn by `look` (built under the frame budget; null until ready).
// -> {canvas, glow, ox, oy, w, h, face?, look, fx?} drawn by drawItemPreview at its bottom centre.
export function itemPreview(look, item, size = 1, force = false) {
  if (!item || item.slot === 'boat') return null;
  const L = equipItem(normalizeLook(look), item);
  const rl = rodLookOf(L);
  const key = lookKey(L, rl) + '|' + item.slot + '|' + size;
  let pv = PREVIEWS.get(key);
  if (pv) return pv;
  if (!force && overBudget()) return null;
  const t0 = now();
  const vs = Math.max(0.6, Math.round(BASE_VS * size * 20) / 20);
  const slot = item.slot;
  if (HEAD_SLOTS.has(slot)) {
    const L2 = slot === 'hair' ? { ...L, hat: 'none' } : slot === 'tint' || slot === 'eyes' || slot === 'mouth' || slot === 'face' ? { ...L, hat: 'none', hair: 'none' } : L;
    const kit = kitFor(L2, rl);
    const head = kit.part('head', () => buildHead(kit));
    const Wh = Tr(-head.pivot[0], -head.pivot[1], -head.pivot[2]);
    const items = [{ part: head, W: Wh }];
    if (L2.hat !== 'none') {
      const hat = kit.part('hat:0', () => buildHat(kit, 0));
      const seat = mul(Wh, mul(Tr(...HAT_SEAT), Ro([HAT_TILT[L2.hat] || 0, 0, 0])));
      items.push({ part: hat, W: mul(seat, Tr(-hat.pivot[0], -hat.pivot[1], -hat.pivot[2])) });
    }
    const yw = slot === 'eyes' || slot === 'mouth' || slot === 'face' ? -12 : -24;
    const res = renderComposite(kit, items, { C: ap(Wh, head.anchors.center), R: head.R, Rm: I3 }, 1, yw, 10, vs);
    pv = { canvas: res.r.canvas, glow: res.r.glow, ox: res.r.w / 2, oy: res.r.h, w: res.r.w, h: res.r.h, face: res.face, vs, p: P({}) };
  } else if (slot === 'rod') {
    const kit = kitFor(L, rl);
    const rod = kit.part('rod:0:1', () => buildRod(kit, 0, 1));
    const W = mul(M(rot(0, 0, -42), [0, 0, 0]), Tr(-rod.pivot[0], -rod.pivot[1], -rod.pivot[2]));
    const res = renderComposite(kit, [{ part: rod, W }], null, 1, -20, 18, vs);
    pv = { canvas: res.r.canvas, glow: res.r.glow, ox: res.r.w / 2, oy: res.r.h, w: res.r.w, h: res.r.h };
  } else if (slot === 'shoes' || slot === 'gloves') {
    const kit = kitFor(L, rl);
    let items;
    if (slot === 'shoes') { const shin = kit.part('shin', () => buildShin(kit)); items = [-3.4, 3.4].map((dx) => ({ part: shin, W: mul(Tr(dx, 0, dx * 0.3), Tr(-shin.pivot[0], -shin.pivot[1], -shin.pivot[2])) })); }
    else { const fore = kit.part('fore', () => buildFore(kit)); items = [[-3, 18], [3, -18]].map(([dx, rz]) => ({ part: fore, W: mul(mul(Tr(dx, 0, 0), Ro([0, 0, rz + 180])), Tr(-fore.pivot[0], -fore.pivot[1], -fore.pivot[2])) })); }
    const res = renderComposite(kit, items, null, 1, -34, 20, vs * 1.3);
    pv = { canvas: res.r.canvas, glow: res.r.glow, ox: res.r.w / 2, oy: res.r.h, w: res.r.w, h: res.r.h };
  } else if (slot === 'top' || slot === 'bottom' || slot === 'back') {
    // body only (no bubble): torso + arms (+ legs for bottoms), from behind for packs
    const kit = kitFor({ ...L, hat: 'none' }, rl);
    const sol = solve(kit, POSES.stand.fn(0, 0), 0, true);
    const keep = slot === 'bottom' ? new Set(['torso', 'thigh', 'shin']) : new Set(['torso', 'upper', 'fore']);
    const items = sol.items.filter((q) => keep.has(q.name));
    const res = renderComposite(kit, items, null, 1, slot === 'back' ? 150 : -28, 12, vs);
    pv = { canvas: res.r.canvas, glow: res.r.glow, ox: res.r.w / 2, oy: res.r.h, w: res.r.w, h: res.r.h };
  } else {
    const L2 = { ...L, hat: 'none' };
    const kit = kitFor(L2, rl);
    const pose = slot === 'emote' ? EMOTES[L2.emote]?.pose || 'wave' : 'stand';
    const fr = getFrame(kit, pose, slot === 'emote' ? 2 : 0, slot === 'back' ? 150 : -30, vs, 1, true, true);
    pv = { canvas: fr.canvas, glow: fr.glow, ox: fr.fx, oy: fr.fy, w: fr.canvas.width, h: fr.canvas.height, face: fr.face, vs, p: fr.p, fx: slot === 'trail' ? L2.trail : slot === 'emote' ? EMOTES[L2.emote]?.fx : null, head: fr.anchors.head };
    L.hat = L2.hat;
  }
  pv.look = L;
  spent += now() - t0;
  PREVIEWS.set(key, pv);
  if (PREVIEWS.size > 400) PREVIEWS.delete(PREVIEWS.keys().next().value);
  return pv;
}

// Draw a thumbnail at (x, y) = its bottom centre, including the live face and trail / emote sparkles.
export function drawItemPreview(ctx, pv, x, y, t = 0, id = 'thumb') {
  const X = Math.round(x - pv.ox), Y = Math.round(y - pv.oy);
  ctx.drawImage(pv.canvas, X, Y);
  if (pv.glow) { const g = ctx.globalCompositeOperation, a = ctx.globalAlpha; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.5; ctx.drawImage(pv.glow, X, Y); ctx.globalAlpha = a; ctx.globalCompositeOperation = g; }
  if (pv.face) drawFaceLayer(ctx, pv.face, X, Y, { id, eyes: pv.look.eyes, mouth: pv.look.mouth, faceAcc: pv.look.face, p: pv.p, t, sx: 1 });
  if (pv.fx && pv.fx !== 'none') {
    const k = (pv.vs || BASE_VS) / BASE_VS;
    if (TRAIL_IDS.has(pv.fx)) for (let i = 0; i < 7; i++) { const ph = fract(t * 0.5 + i / 7); drawBit(ctx, pv.fx, x + Math.sin(i * 2.3) * 14 * k, y - 8 * k - ph * 40 * k, i % 2, Math.sin(ph * Math.PI), t, i); }
    else drawEmoteFx(ctx, pv.fx, x + (pv.head?.[0] || 0), y + (pv.head?.[1] || -50), t, k);
  }
}
const TRAIL_IDS = new Set(['bubbles', 'sparkle', 'leaves', 'notes', 'hearts', 'rainbow', 'drops']);

// Face sizes in px for a scale (for UI layout).
export function characterHeight(scale = 1) { return Math.round(48 * vsFor(scale)); }
