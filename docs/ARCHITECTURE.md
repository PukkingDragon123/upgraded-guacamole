# FISHTOP architecture & module contracts

FISHTOP is a desktop fishing + aquarium game. The browser build simulates a desktop
(icons, windows, taskbar) with a living pixel ocean behind it; an Electron shell runs it
as a real transparent desktop overlay; a browser extension shows fish over web pages.
No external assets, no network: all art and audio are procedural or hand-authored in code.

## Rendering conventions (all art modules)

- The game draws into a **pixel canvas of logical width ~960 px** (height ~480-600 depending on aspect;
  1920x1080 -> 960x540 at 2x, 1280x720 -> 1280x720 at 1x) upscaled with nearest-neighbour.
  This is HIGH-RESOLUTION, ULTRA-DETAILED pixel art: fish are typically 30-90 px long (bosses 150-260),
  desktop icons 32x32, props 40-200 px tall. Dev previews: logical 960x540 at CSS 2x. All coordinates are logical
  pixels. Never enable smoothing; draw sprites at integer positions.
- Sprites are `HTMLCanvasElement`s built once and cached. Helpers:
  - `src/core/canvas.js`: `makeCanvas(w,h)`, `ctxOf(canvas)` (smoothing off), `makeLayer`, `tinted(src,color)`.
  - `src/gfx/pixel.js`: `PixelBuffer` (set/get/rect/line/fillCircle/fillEllipse/fillPoly/outline/toCanvas),
    `selOut(strength)` selective-outline colour fn, `spriteFromAscii(rows, palette, scale)`.
  - `src/core/color.js`: hex helpers, `ramp(hex)` (5-step hue-shifted ramp dark->light), `shade(hex, ±amt)`,
    `mix`, `adjust`, `pack(hex,a)` (Uint32 for PixelBuffer), `rgba(hex,a)`, `RARITY` table.
  - `src/core/math.js`: clamp/lerp/smoothstep/ease, `hash2`, `noise2`, `fbm2`, `bayer(x,y)` dithering.
  - `src/core/rng.js`: `RNG(seed)` (float/int/pick/chance/weighted/gauss).
- **Art direction**: premium handmade indie pixel art (think Stardew/Terraria/Eastward-level care).
  Chunky readable shapes, 1 px dark *selective* outline (`buf.outline(selOut())`), light from
  top-left, hue-shifted ramps (shadows drift cool/purple, highlights warm), ordered dithering via
  `bayer()` for gradients, small specular highlights, no anti-aliasing, no muddy noise.
  Procedural generation must be deterministic (seeded RNG / hash) so assets are stable.
- Text: `drawText(ctx, text, x, y, {font:'normal'|'small', color, align, shadow, outline, scale, wave, time})`
  from `src/gfx/font.js`. `normal` = 7 px cap height, mixed case; `small` = 5 px uppercase.
  `registerInlineIcon(name, canvas)` lets text embed `{name}` sprites. `measureText`, `wrapText`, `drawWrapped`.
- Fish are drawn with a **layered rig** (`src/gfx/fishrig.js`, see "Fish rig" below): cached raster layers
  (tail, back fins, body, front fins) animated on independent phases + a fully dynamic expressive face layer.
- Fish/creature sprites: `src/gfx/fishart.js` (procedural rasteriser, see "look" schema below) and
  `src/gfx/spritecache.js` (`compiled(look, variant, key)`, `frame(compiled, {phase, angle, scale, blink, mouth, inflate, expr, silhouette})`
  -> `{canvas, glowCanvas, ox, oy, anchors}`; draw at `(x - ox, y - oy)`; sprites face right, flip for left).
- Performance budget: 60 fps at 960x540 with ~25 fish. Pre-render static art; per frame only
  `drawImage` of cached canvases and cheap fills.

## Code style

ES modules, named exports, 2-space indent, single quotes, semicolons, short comments only where
the intent is not obvious. No dependencies besides esbuild (dev). Keep modules self-contained.

## Dev previews (every agent)

- Make `src/dev/<name>.js` exporting `run(params)` that draws a preview onto `#screen`
  (set `canvas.width/height` to logical size, CSS size = 3x; see `src/dev/gallery.js`).
- Build an isolated bundle: `node tools/build.mjs --dev <name>` -> `dist/dev/<name>.html`.
- Screenshot: `node tools/shot.mjs "dev/<name>.html" tests/out/<name>.png 1500 1920 1080`
  (args: page, output, waitMs, width, height, optional `;;`-separated steps: `wait 500`, `click x,y`,
  `mouse x,y`, `down`, `up`, `key K`, `shot path`, or JS to evaluate). Console errors are printed.
  View the PNG with the Read tool and iterate until it looks great.
- Only edit files you own. Do not run git commands that change history (no commit/push).

## Game-wide data contracts

### Biomes
`'shallows'` (Sunny Shallows), `'junkyard'` (Junkyard Reef), `'abyss'` (The Midnight Abyss).

### Bait categories
Icon bait (dragging a desktop icon into the bait box) has a `type`:
`computer, trash, browser, folder, docs, music, image, game, mail, terminal, settings, calc, calendar, chat, video, paint`.
Special bait ids (bought with coins): `bread` (cheap, commons), `worm` (glowing worm crawls over icons),
`golden` (rarity boost), `flood` (raises water level), `blackhole` (pulls icons, attracts deep/rare),
`sugar` (sweet things), `chip` (overclocked chip, junkyard/mechanical), `popup` (pop-up ad, junk/spam fish),
`lantern` (lantern pearl, abyss light), `relic` (ancient relic, summons the abyss boss).

### Species schema (`src/fish/species.js` exports `SPECIES` array and `SPECIES_BY_ID`)
```js
{
  id: 'puffer', name: 'Sir Puffington', biome: 'shallows', rarity: 'uncommon',
  size: [12, 30], weight: [0.4, 2.1],            // cm / kg range for the catch card
  look: { ...fishart look },                     // or look.kind = 'chain' (rendered by game, see below)
  scale: 1,                                      // extra render scale
  move: { style: 'swim', speed: 16, burst: 70, agility: 3, depth: [0.2, 0.8], school: 0 },
  //   style: swim | hover | drift | crawl (walks on seabed/icons) | hop | glide | chain
  //   depth: preferred band as fraction of water column (0 surface, 1 seabed)
  activity: 'any',                               // day | night | dusk | any
  traits: { curiosity: 0.6, shyness: 0.4, greed: 0.5, aggression: 0.2 },
  bait: { folder: 3, docs: 1, worm: 2, golden: 2 }, // interest 0..3; unspecified = 0.25
  quirks: ['inflate'],                           // behaviour hooks implemented by the AI
  fight: { phases: ['mash', 'tension', 'net'], power: 0.45, stamina: 5, tricks: ['dash', 'fake'],
           biteWindow: 0.55, nibbles: [1, 3], fakeBite: 0.2 },
  spawn: { weight: 1, weather: null, time: null, requires: null, hidden: null },
  sound: 'puff',                                 // blub|honk|puff|squeak|grunt|boing|glitch|click|roar|chirp|bell
  desc: 'Journal flavour text (1-2 funny sentences).',
  behavior: 'Short behaviour note shown in the journal.',
  shinyHue: 150,
}
```
- Fight phases: `tension` (hold to reel, move against the fish), `trace` (follow the fish's path),
  `mash` (rapid clicks), `timing` (click on the beat ring), `dodge` (avoid projectiles while holding),
  `unwrap` (circle the cursor to untangle), `net` (draw a circle around the exhausted fish).
- Tricks: `dash, dive, jump, fake, wrap` (wraps line around icons), `hop` (window hop), `spit` (projectiles), `ink`, `glitch` (teleports).
- Quirks: `inflate, googly, commuter, noodle, crawler, mimic, lure, loading, wobble, manyeyes, glitch, screen,
  thief, honk, forgetful, camouflage, halo, sparkle, glow, ink, pulse, hopper, school, intro`.
- Chain creatures: `look.kind = 'chain'`, `look.chain = { segs, r, head: 'noodle'|'plug'|'eel', col: {...} }`.

### Fish "look" schema (fishart.js)
`kind` (default fish | crab | jelly | pudding | seahorse | ray | squid | isopod | blob | iconfish | chain),
`body {len, h, shape: oval|torpedo|round|disc|long|box|blunt|pointy, hump, belly, wave, nose, peak, tailW, taper}`,
`col {body, belly, back, fin, outline}`, `pattern [{type: bands|stripes|spots|patches|gradient|checker|mask|face|tailend|suit|lines|circuit|glowspots|belt|rust|zigzag|chevron, color, ...}]`,
`tail {type: fork|round|veil|truncate|lyre|moon|pointed|fan|none, len, spread, flap, color}`,
`dorsal/anal/dorsal2 {type: tri|sail|spiky|long|round|wave|none, from, to, h, color}`, `pectoral {u, v, len, w, angle, color}|null`,
`eye {u, v, r, type: normal|googly|dot|glow, color, iris, pupilSize, glow}`, `moreEyes [...]`,
`mouth {type: small|beak|lips|big|fangs|none, v, color}`, `extras [{type: tie|bolts|scar|mustache|blush|screen|lure|whiskers|antennae|cap, color, color2, glow}]`,
`spikes` (puffer spike length when inflated), `translucent` (0..1 alpha), `organs {bone, stomach}`, `scales`, `shine`, `contrast`, `finAlpha`.
Variants: `{ mutation: albino|melanistic|neon|pastel|golden|inverted|ghost|crimson|ocean|galaxy, shiny, shinyHue, pattern, patternColor, seed }`.

### Props (`src/gfx/props.js`)
`getProp(id, {scale = 1, variant = 0, frame = 0}) -> {canvas, glow, ox, oy, w, h, screens: [{x,y,w,h}], lights: [{x,y,r,color}]}`
(`ox, oy` = bottom-centre ground contact point; `screens` = rects of emissive screen faces where the game can draw
animated content; `lights` = suggested light sources relative to the canvas). `PROPS` = metadata map
`{ id: { name, biome, tags, decor: {price, size} | null } }`.

### Audio (`src/core/audio.js`, singleton `audio`)
`audio.unlock()` (call on first user gesture), `audio.play(name, {vol, pitch, pan})`,
`audio.loop(name) -> {set(value 0..1), stop()}`, `audio.setMusic(track)` (`desktop|shallows|junkyard|abyss|aquarium|null`),
`audio.setAmbience(biome, {weather, night})`, `audio.setVolumes({master, music, sfx, ambience})`,
`audio.setMuffle(0..1)`, `audio.babble(text, voice, {pitch})`, `audio.setVoices(bool)`.
SFX, loops, ambience and music are RECORDED clips (src/core/samples.js; the synth is only a fallback). The dialogue
voices are the one deliberate synth [voices23]: `babble` speaks in a retro 8-bit chiptune voice per character (`CHIP` in
audio.js; ids `guide` (the goofy, low, wobbly toy-grouper guide), `fizz` (high fast 12.5% bleeps), `marina` (warm 25% pulse
+ triangle, gentle vibrato), `bloat` (low gruff square with noise grit), `dot` (robotic bit-crushed square hopping octaves,
metallic LFSR noise; also the `shop` alias), `player` (bright mid chirp; peers pitched per name), `boss` (deep overdriven
square + triangle, growl noise), `default`; old names / NPC ids alias: seal grouper fish tiny crab deep clip ...;
`voiceId(name)`). One channel per character (two pulse oscillators of different duty sharing a pitch, an optional
triangle an octave down, a looped NES-style LFSR noise source, envelope, optional shaper and LFO on detune) is built on
its first line and reused: letters only schedule AudioParam automation (pitch from the letter, falling contour, rising
questions; vowels = main duty, consonants = other duty + a noise tick), punctuation plays an arpeggio (! up, ? rise,
. fall, , blip, ~ wobble); a new line cuts the old one; idle channels are released after ~4 s. 1-2 char calls are
rate-limited typewriter blips. Routed to the SFX bus (master / SFX volume / mute apply). `state.settings.voices`
'chip' | 'off' (Settings: Voices 8-bit / Off; `game.applyVolumes` calls `setVoices`). Speakers: cutscenes (`VOICE` map in
cinestage.js, Typer; the angler's reactions in `player`), Dialogue (tutorial / intro: `guide`; a picked answer in
`player`), the Quest Log chapter talks, the shop counter (`guide`, who keeps the shop), the chest scene's cheers, boss
title cards (`boss`), escaping fish taunts, multiplayer emotes. Test: `tests/voices.mjs`.

### Desktop icons (`src/desktop/icons.js`) and UI art (`src/gfx/uiicons.js`, `src/ui/panels.js`)
See those files' headers once written.

### Host bridge (`src/platform/host.js`)
`host.kind ('web'|'electron')`, `host.mode`, `host.setInteractive(bool)`, `host.setMode(mode)`,
`host.onShortcut(cb)`, `host.onCursor(cb)`, `host.requestDesktopFiles()`, `host.quit()`.

### Fish rig (`src/gfx/fishrig.js`) - draw-time API used by the game
```js
drawFishRig(ctx, compiledLook, st) -> anchors (world coords: {mouth:[x,y], top, tail, bottom, eyes:[{x,y,r}]})
st = { x, y, facing: 1|-1, turn: -1..1 (scaleX during turn-around), angle (rad, pitch), scale,
       squash: -1..1 (neg squash, pos stretch), bob,
       swimPhase, tailPhase, finPhase (0..1 cycles, advanced by the caller at speed-dependent rates),
       speed01, inflate 0..1,
       lookX, lookY (world point the eyes look at, or null = forward), blink 0..1,
       emotion: 'neutral'|'happy'|'sad'|'angry'|'scared'|'surprised'|'love'|'sleepy'|'dizzy'|'smug'|'determined'|'tired'|'disgust',
       mouth: 0..1 (open amount; caller animates talking/chomping), time,
       wash: {color, alpha} | null (fog/darkness tint), glow: 0..1 (emissive strength), silhouette: bool }
```

## Phase 2 contracts (voxel world, boat, character, fishing remake, building)

Ownership is strict: edit only files your brief lists. Integration hooks below are called defensively
(`obj?.method?.()`), so modules can land in any order. `src/ui/registry.js` and `src/ui/dock.js` are owned
by the orchestrator: report panels/buttons you need registered.

### World space & camera (`src/game/camera.js`)
World y = 0 is the top of the default underwater view; negative y goes up to the surface/sky/boat.
`camera.scrollY` = world y at the screen top (0 default, negative = scrolled up toward the boat);
`setScrollRange(min,max)`, `scrollBy(dy)`, `scrollTo(y)`. Cinematics: `focus(x, y, zoom, speed)`,
`release()`, `setLetterbox(on)`, `drawBars(ctx)`, `slowmo(scale, secs)`, `punch`, `shake`, `flash`.
`worldToScreen(x,y)`, `screenToWorld(x,y)`, `apply(ctx)` (world transform), `reset(ctx)`.
`game.world.cursor` is in WORLD coordinates; `game.input` stays in screen coordinates.

### Boat (`src/world/boat.js`, class `Boat`, instance `game.boat`)
`update(dt, inp)`, `draw(ctx, env)` (world space), `hit(wx, wy)`, `rodTip() -> [wx, wy]`, fields `x`, `y`
(waterline), `dragging`, `bob`. Drawn on the surface; draggable along the surface with the mouse. The fishing
line always starts at `boat.rodTip()`. The player character stands on it.

### Character (`src/gfx/character.js`)
`drawCharacter(ctx, x, y, {pose, t, facing, scale, look, fish})` draws the voxel fisherman with feet at (x,y)
and returns anchors `{rodTip:[x,y], hands:[x,y], head:[x,y]}`. Poses: `idle, cast, reel, pull, yank, hold,
cheer, sad, sit, wave`. `look` = `game.state.character` (see `DEFAULT_CHARACTER`, `WARDROBE`). `fish` (for
`hold`) = `{compiled, variant}` of the caught fish.

### Fish drawing
`drawFishRig(ctx, compiled, st)` (src/gfx/fishrig.js) stays the single entry point; it renders voxel fish when
`fishStyle` is 'voxel' (default), pixel rig otherwise (`setFishStyle(style)`).

### Items, packages, building (`src/build/`)
`items.js`: `ITEMS {id: {name, kind: material|blueprint|decor|bait|cosmetic|package, rarity, desc}}`,
`addItem(state, id, qty)`, `removeItem`, `countItem`, `rollPackage(species, biome) -> null | {tier}`,
`openPackage(pkg) -> [{id, qty}]`, `drawPackage(ctx, x, y, tier, t)` (crate a fish carries).
Save: `state.inventory = {items: {id: qty}, packages: [{uid, tier, from}]}`, `state.buildings = [...]`.
`build.js`: `class Build` (`game.build`): `update(dt, inp, layer)`, `drawWorld(ctx, env)` (buildings on the
seabed, world space), `drawUi(ctx)`, `hit(wx, wy)`, `active` (build mode), `toggle()`.

## Phase 3 contracts (Frutiger Aero overhaul)

### Direction (applies to every agent)
- **100% Frutiger Aero**: glossy glass, aqua/sky-blue + grass-green + white, soft gradients, specular highlights,
  bubbles, lens flares, bokeh, light shafts, chrome and translucent plastic, optimistic eco-tech (wind turbines,
  leaves, water drops, dolphins, orbs). Bright and clean, never grungy. UI = glossy glass panels and pill buttons.
- **Fish are 100% detailed 3D VOXEL models** (the whole game is voxel art). Frutiger Aero styling: glossy specular,
  translucent aqua-tinted fins, vivid saturated palettes (like the moving-picture aquarium lamp), sparkle and bubbles.
  **No realistic eyes anywhere**: eyes are cute glossy CARTOON eyes built from voxels (big dark pupil + white shine
  voxel, simple and expressive: blink, squint, wide, hearts...), never realistic irises/sclera, never 2D overlays.
  Not the old realistic "fish pack" style.
- **Fish roster = internet culture and memes**, built on puns and similar-sounding words (e.g. Wi-Fish, Stonks
  Salmon, Rickroll Rockfish, 404 Fish Not Found, Buffering Blowfish), plus fun Frutiger Aero things. Affectionate
  parody names and ORIGINAL designs only: no copied meme images, characters, logos or exact trademarks.
- **FULL VOXEL ART, NO 2D FISH (user rule).** Every fish, creature, tank, room, backdrop, plant, prop and scenery
  element is a voxel model rendered with the voxel pipeline. Never draw flat/illustrated 2D fish (not even in a tank
  backdrop, a lamp panorama, an icon or a silhouette list) and never paint 2D backgrounds. Only UI chrome, text and
  effects (particles, bubbles, light shafts, flares, bloom, splashes) may be 2D.
- **The Pac-Man-style fish** (Wakka Fish) is a chunky retro VOXEL chomper (superseded: it was pixel art) (a deliberate retro sprite among the voxel fish): a unique,
  polished chomper of our own design (not a 1:1 copy) that moves like the arcade classic (straight runs, crisp
  90-degree turns, chomping mouth, gobbling pellet bubbles).
- **Reference look (user images, view with Read):** `/tmp/claude-0/-home-user-upgraded-guacamole/0635e6e6-6374-5dae-a608-c9722d156879/images/6.jpg`
  (absurd meme collage: a fish standing in white high-top sneakers on a glossy eco background of big green leaves, sun
  flare, bubbles, water splashes), `7.jpg` (the classic moving-picture aquarium lamp: silver plastic frame, scrolling
  illustrated reef panorama, vivid tropical fish), `8.jpg` (eco Aero wallpaper: curved grass horizon, glass city inside
  a water bubble, a green glass globe, sun rays, white arcs, leaves, splash). Saturated sky blue + leaf green + white,
  bloom and lens flare, glossy leaves framing the screen, bubbles everywhere, playful meme absurdity. No cigarettes or
  real brand logos (the sneakers are generic white high-tops).
- World, buildings, boats and characters stay voxel; characters and NPCs also get cute cartoon eyes, never realistic ones.
- **Less text, more visuals.** Prefer icons, motion, particles and colour over labels and sentences.
- **Currency** is **Aero Bucks** ([cur26]; was "Aero"; `CURRENCY` in `src/ui/aero.js`; short form "AB", or the droplet
  icon + number). `state.coins` still holds the amount and internal ids / keys (`aero`, `coins`, `fmtAero`) are unchanged
  for save compatibility; every user-facing label says Aero Bucks. "Oxidized Coins" is gone.
- **Progression** is Fisch-like: you unlock better rods (stats: lure speed, luck, control, resilience,
  strength, shock), boats, tanks and oceans. **Everything is unlocked in The Lab** (`src/game/lab.js`): there is
  no shop, no separate research panel, no boatyard. Crafting recipes (buildings, bait, decor) are Lab unlocks.
- **Desktop = ocean.** The desktop's floating app icons **are the game menu** (The Lab, Aquarium, FishDex,
  Satchel, Wardrobe, Map, AppSea, Multiplayer, Settings ...), bobbing in the water. Icons are no longer bait.
- **Bait** comes from AppSea downloads (or Lab-crafted custom bait) and is **one-time use** (`src/store/bait.js`).
- **No fish carry packages any more.** Floating boxes drift in the water and can be fished up (`src/world/floaters.js`).
- **Start**: a goldfish jar (aquarium tier 0) in a Frutiger Aero room, a bubble-person player, the **(OS)cean**
  (id `oscean`): the classic rolling-green-hill-under-blue-sky desktop wallpaper, flooded (an original landscape,
  no copied photo or OS logos). Ocean order: oscean, shallows, fjord, junkyard, metropolis, volcano, abyss.
- Pop-culture fish stay affectionate parodies (pun names, original designs). No real logos or exact trademarks.

### Ownership (phase 3)
| Agent | Owns (may create/rewrite) |
| --- | --- |
| UI | `src/ui/aero.js`, `panels.js`, `ui.js`, `tabbar.js` (to be removed), `bigicons.js`, `uiicons.js`, `journal.js`, `inventory.js`, `settings.js`, `mappanel.js` (restyle), `welcome.js`, `src/desktop/desktop.js`, `icons.js`, `apps.js`, `src/gfx/font.js` |
| Fish | `src/fish/*` (incl. new `species-oscean.js`), `src/gfx/voxelfish.js`, `fishrig.js`, `fishart.js`, `spritecache.js` |
| World | `src/world/*` except `boatmodels.js`; `src/gfx/watergl.js`, `props.js`, `src/world/floaters.js` |
| Character | `src/gfx/character.js`, `src/gfx/npcs.js`, `src/world/boatmodels.js`, `src/ui/wardrobe.js` |
| Lab | `src/game/lab.js`, `rods.js`, `skills.js`, `shopdata.js`, `src/ui/skilltree.js` (becomes the Lab), new `src/ui/lab*.js`, `src/build/*`, `src/ui/research.js`, `buildpanel.js`, `boatyard.js`, `shop.js` (retire) |
| Fishing | `src/fishing/*` except `baitart.js`; `src/gfx/particles.js`, `src/ui/reveal.js` |
| Aquarium | `src/aquarium/*` |
| Online & AppSea | `src/store/*` (incl. `bait.js`), `src/net/*`, new `src/ui/multiplayer.js`, `src/ui/baitpanel.js`, `src/fishing/baitart.js`, `tools/relay*` |
| Intro | `src/game/tutorial.js`, `src/desktop/wallpaper.js`, new `src/game/intro3d.js`, `tests/smoke.mjs` |
| Orchestrator | `src/game/game.js`, `state.js`, `src/ui/registry.js`, `src/ui/dock.js`, `docs/`, `README.md` |

Shared files you do not own: if you truly need a hook in `game.js`/`state.js`/`registry.js`, make a **small additive
`Edit`** (never `Write`), tag it `// [phase3:<agent>]`, and list it in your report. Re-read before editing (the Edit tool
rejects stale reads). Never revert someone else's change.

### Shared APIs (see each file's header for the exact signatures)
- `src/ui/aero.js`: `AERO`, `CURRENCY`, `fmtAero`, `drawAeroPanel`, `drawAeroButton`, `drawAeroBar`, `drawAeroCoin`, `drawGlossOrb`.
- `src/game/lab.js`: `ensureLab`, `LAB_NODES`, `labHas`, `labStatus`, `unlocked(state, kind, id)`, `grantUnlock`, `computeLabStats`.
  Kinds: `rod`, `boat`, `tank`, `recipe`, `biome`, `bait`, `cosmetic`, `feature`. Events `labStarted`, `labDone`, `unlocked`.
  `skills.js` keeps its old exports (`SKILLS`, `SKILL_BY_ID`, `skillStatus`, `computeStats`, `BASE_STATS`) as thin wrappers.
- `src/game/rods.js`: `RODS`, `ROD_BY_ID`, `ensureRods`, `equippedRod`, `rodStats(state, stats)`.
- `src/store/bait.js`: `BAITS`, `ensureBait`, `currentBait(state)`, `consumeBait(state)`, `addBait`.
  `game.currentBait()` delegates here. Bait objects keep `type` compatible with species `bait` preferences.
- `src/world/floaters.js`: `Floaters` (`list`, `update`, `draw(ctx, layer)`, `hitHook`, `take`). `game.floaters`.
  Fishing fights a box on the meter ([crate26] `cratefight.js`), lands it and calls `game.onBoxCaught(f)`; loot from `src/build/items.js` (`rollCrate(tier, biome, luck)` -> `{aero, items:[{id, qty}]}`, `grantLoot`).
- `src/gfx/character.js`: `drawCharacter(ctx, x, y, o)` (same call shape), player look in `state.character` (now a
  **bubble person**), cosmetics registry + `grantCosmetic(state, id)`. `src/gfx/npcs.js`: `NPCS`, `drawNPC(ctx, id, o)`.
- `src/world/boatmodels.js`: boat tiers/parts; `state.boat = {tier, parts:{hull, sail, flag, engine, decal}}`.
- Aquarium: `state.tank.tier` (0 = goldfish jar) from Lab unlocks `tank:<id>`; idle Aero via the existing coin flow
  plus offline earnings on return.
- Multiplayer (`src/net/`): opt-in only (Multiplayer panel), a chosen display name, no personal data. Transports: the
  artifact `room` capability when hosted on claude.ai (`await window.claude?.use?.('room')`, presence for absolute
  state, events for moments), `BroadcastChannel` for local multi-window. Everything heard from peers is untrusted:
  validate, clamp and length-limit it. The game must work fully offline.
- Panel ids after phase 3: `lab` (replaces `skills`, `shop`, `research`, `boatyard`), `crafting`, `journal`, `inventory`,
  `wardrobe`, `map`, `settings`, `bait`, `multiplayer`, `reveal`, `welcome`, `building`, `buildtray`, `package`→`crate`.

## Phase 4 contracts (standalone zoomed-in Aero fishing game)

User direction (supersedes earlier phases where they conflict):
- **No desktop theme.** FISHTOP is a standalone Frutiger Aero, skill-based fishing game, about fishing. Remove the
  simulated desktop: desktop icons as menu, My Computer / Recycle Bin, taskbar, start orb and start menu, app windows,
  the "ordinary wallpaper floods" premise, AppSea as a desktop download app, icon stealing and hiding behind windows,
  overlay/wallpaper/mini desktop modes in the UI. The game menu is a polished Aero game HUD.
- **Zoomed in.** The world camera sits much closer (base zoom about 1.75-2x of the old view) and smoothly follows
  the action (boat, hook, fish), so fish and scenery read big and detailed. UI stays on the 960x540 logical canvas.
- **Fish: realistic voxel models, very cool.** Replace ALL old fish models. Realistic anatomy and proportions,
  natural small realistic eyes (no cartoon/googly eyes), glossy Frutiger Aero shine, translucent fins, bubbles.
  Meme names stay; models are realistic. Full voxel rule still applies everywhere.
- (OS)cean stays as the first ocean (a flooded green-hill landscape), now just a beautiful place, not a desktop.

| Agent | Owns |
| --- | --- |
| Shell | `src/game/game.js`, `src/desktop/*`, `src/ui/ui.js`, `panels.js`, `aero.js`, new `src/ui/hud.js`, `settings.js`, `welcome.js`, `src/store/*` (AppSea becomes an in-game Aero bait shop), `electron/`, `docs/DESKTOP.md` |
| Zoom | `src/game/camera.js`, `src/world/*`, `src/gfx/watergl.js`, `props.js`, `src/fishing/*` positioning only (tagged edits), `src/net/*` drawing positions |
| Fish | `src/fish/*`, `src/gfx/voxelfish.js`, `fishrig.js`, `fishart.js`, `spritecache.js`, `src/fish/fishicon.js` |
| Intro | `src/game/tutorial.js`, `src/game/intro3d.js`, `src/desktop/wallpaper.js` (retire), `tests/smoke.mjs`, `src/dev/intro.js` |
Other agents: tiny tagged edits (`// [phase4:<agent>]`) only. Never revert others' work.

## Phase 5 (cinematic intro, Clip guide, water physics)
- `src/gfx/alagard.js`: `loadAlagard()`, `alagardBitmap(text, {size, color})` (Alagard pixel font, embedded). Use it for
  titles, the guide's dialogue and extruded 3D voxel text.
- The (OS)cean meadow is ONLY grass and flowers (no coral, kelp or crystal plants).
- [notrees23] NO TREES in any background (user rule: "remove the tree from background"): no land trees, palms, bushes
  or shrub-trees on hills, islands or shores (the (OS)cean's grass horizon carries turbines, the city bubble and flowers;
  the Shallows horizon island is a bare sandy hut island; voyage islands are bare hills / cays). Underwater plants
  (kelp, sea grass, corals, glossy Aero leaf sprigs framing the corners) are not trees and stay.
- Intro agent owns `src/game/intro3d.js`, `tutorial.js`, new `src/game/dialogue.js`, new `src/gfx/text3d.js`, the 'clip' NPC
  (tagged additions in `src/gfx/npcs.js`), `tests/smoke.mjs`. Water agent owns `src/gfx/watergl.js`, new `src/world/watersim.js`,
  water/surface parts of `src/world/ocean.js` and biomes (tagged), splash additions in `src/gfx/particles.js` (tagged).

## Phase 6 contracts (low-poly creatures, seal guide, 3D tank, gear fishing, Lab rows, quests, deep oceans)
User direction (latest, overrides earlier phases where they conflict):
- **All fish and sea creatures are LOW-POLY 3D** (faceted, flat-shaded, softly painted, like the seal reference
  `/tmp/claude-0/-home-user-upgraded-guacamole/0635e6e6-6374-5dae-a608-c9722d156879/images/9.jpg`). No voxel fish or voxel dolphins anywhere.
  Shared renderer: `src/gfx/lowpoly.js` (MeshBuilder, loft, fin, renderMesh -> cached sprite, LPScene for full 3D scenes, T4/M4).
  `renderMesh` costs a GPU readback: cache frames (yaw buckets x swim frames), never render per fish per frame uncached.
  World terrain, buildings and props may stay voxel.
- **Guide**: a fat, cute bubble SEAL (low-poly, white seal pup like 9.jpg, glossy, with bubbles) replaces Clip. It swims
  around the screen and points at things.
- **UI a lot bigger, icons better** (HUD, hotbar, dialogue, catch card, reel/gear UI, tooltips).
- **Aquarium = a real, super-detailed 3D fish tank** (LPScene) you can move around in, and swim in; expandable/upgradeable.
- **Fishing harder**: a spinning 3D gear you spin to hook; hold and release to shock/stun; bigger UI.
- **The Lab looks exactly like the row-based skill-tree reference**
  `/tmp/claude-0/-home-user-upgraded-guacamole/0635e6e6-6374-5dae-a608-c9722d156879/images/10.jpg` (rows of framed icon tiles per branch, labels with leader lines,
  elbow connectors between rows, chained/padlocked locked tiles, level numbers, points left, Undo/Confirm), but Frutiger
  Aero, cuter, with fully animated, interactive icons.
- **Progression 100x better**: quest lines (chapters, NPC quest givers, objectives, rewards, a quest log, a HUD tracker).
- **Oceans much deeper and scarier**: each ocean has several depth zones (sunlit, twilight, midnight, abyss) with their own
  fish; darker and scarier the deeper you go. Zoom in a lot more. Many more plants, with physics.

| Agent | Owns |
| --- | --- |
| Creatures | `src/gfx/lowpoly.js`, new `src/fish/lowpolyfish.js`, `src/fish/*`, `src/gfx/fishrig.js`, `voxelfish.js` (retire), creature drawing in `src/world/giants.js`/critters (tagged) |
| Guide | `src/game/tutorial.js`, `dialogue.js`, `intro3d.js` (guide swap), new `src/gfx/seal.js`, seal in `npcs.js` (tagged), `tests/smoke.mjs` |
| UI | `src/ui/hud.js`, `ui.js`, `aero.js`, `panels.js`, `src/gfx/uiicons.js`, `bigicons.js`, `labicons.js`, `settings.js`, `journal.js`, `inventory.js` |
| Lab+Quests | `src/game/lab.js`, `rods.js`, `src/ui/lab*.js` (not labicons), new `src/game/quests.js`, new `src/ui/quests.js` |
| Fishing | `src/fishing/*`, `src/ui/reveal.js`, `src/gfx/particles.js` (tagged) |
| Aquarium | `src/aquarium/*` |
| Oceans | `src/world/*` (except creatures), `src/game/camera.js`, `src/gfx/watergl.js`, `src/world/watersim.js`, `props.js` |
`src/game/game.js` / `state.js` / `src/ui/registry.js`: tiny tagged additive edits only (`// [phase6:<agent>]`).
- Creatures API (`src/fish/lowpolyfish.js`): `fishMesh(sp, rec, {phase, frames})`, `creatureMesh(kind, {phase})`,
  `addFishToScene(scene, mesh, model)`, cached sprites `lpFrame`, `lpStill`, `lpFishIcon`. 8 swim frames x 10-degree yaw steps.
- Oceans API: `game.ocean.depthZone()` -> {id, name, depthM}, event 'depthZone'; species may set `zone`/`depthM`.
- Quests: `src/game/quests.js` (7 chapters, 68 main quests), panel 'quests' (Q), tracker in `game.hud.questSlot()`.
  [quests16] + `src/game/questdata.js`: 109 side stories (`chapter.side`, optional, open with their chapter or `after`
  quest), 79 milestones in 23 lines (`MILESTONES`, lifetime `{t:'total', k}` goals) and the "Today's orders" pool
  (`ORDER_POOL`, 3 orders a day + a board bonus, refreshed at local midnight, `state.quests.daily`, one swap a day).
  Main quests complete by themselves; side stories / orders / milestones become ready (`S.ready`, event 'questReady')
  and are paid by `book.claim(id)` / `claimAll()` (event 'questDone' {claimed}). Lifetime counters: `S.life`.
  New objective types: catch filters (weather, time, bait, trophy, giant, shiny, mutant, flawless, party), zap, feed,
  build, hatch, evolve, collect, tankFish, gearLv, dress, box, labDone, online, total, ordersToday, species {biome},
  craft {cat}. PERFECT / bad zaps come from a 'shockFired' {grade} game event that QuestBook adds by wrapping
  `game.fishing.onShockFire` / `onBackfire` (feature-detected; if Fishing ever emits it itself, drop the wrapper).
  The Quest Log has Story / Orders / Milestones tabs with scrolling lists, CLAIM buttons, "Claim all" and a TRACK pin
  (`S.pin`, shown first on the HUD tracker). Save v2 migration keeps all progress; claimables appear with their chapter.
- Aquarium: one LPScene per frame; swim mode; gear panel (Aero) for filter/heater/light/air/substrate.

## Phase 7 (cute seal, detailed voxel environment, centre-out Lab with fog of war, cube tank, management, polish)
- Bubbles the seal: super cute, bubbly, SMOOTH (not faceted low-poly): smooth-shaded higher-poly mesh, glossy bubble.
- Environment: much more detailed voxel art in every ocean (finer voxels, richer props/terrain), crisp at the zoom.
- The Lab: one tree that branches out from the middle, camera zoomed in on the frontier, tidy and polished; nodes you
  cannot unlock yet are hidden as black silhouettes (fog of war) until they become reachable.
- The tank is a CUBE; better decor building inside it; a real fish-management screen.
- Fish and sea creatures stay low-poly (phase 6).

## Phase 8 (latest; overrides phase 6/7 where they conflict)
User direction: "Make everything more voxel art: fish realistic voxel art; UI and icons more voxel / pixel art; bigger text;
polish; a crafting system and a workshop; you can sail to a Lab or Workshop to unlock things; super cute; cool progression,
new rods; better chest openings with a crack-it-open minigame; remove the lazy circle effects; a lot more 2D pixel-art
particle effects; most items pixel art. Plants, furniture and items: much higher voxel count, more polish; 2D pixel art
that feels hand-made."
- Fish AND sea creatures AND the seal guide: realistic, high-resolution VOXEL art (back from low-poly). Fine voxels,
  smooth silhouettes, natural eyes for fish; the seal is a super-cute voxel pup in a bubble.
- Plants, furniture/decor, items, props: much higher voxel counts, polished.
- UI chrome + icons: voxel/pixel-art look, bigger text. Items mostly hand-made-feeling pixel art.
- No lazy ring/circle effects (expanding circles, dotted rings, ring "ripples" as UI fluff). Replace with rich 2D pixel-art
  particles (sparkles, splashes, droplets, stars, puffs, confetti, fish scales, bubbles drawn as pixel sprites).
- Progression: crafting system + Workshop; the Lab and the Workshop are PLACES you sail to on the map; new rods;
  chests are cracked open with a minigame.
- Creatures (phase 8, Creatures agent): every fish / creature pose mesh from `src/fish/lowpolyfish.js` is VOXELISED by
  `src/fish/voxelize.js` (`voxelizeParts(parts, vs)`, `voxelizeMesh(mesh, vs)`, compact `VoxMesh`, `mergeVox`): fine voxels
  (`voxelSize(c, pose)`: ~48 voxels along small fish .. ~140 along giants), skin colours, stamped natural eyes, translucent
  fin voxels + denser rays (`'finrays'` part), glow voxels, baked AO. All APIs are unchanged (drawFishRig, lpFrame,
  lpFishIcon/voxelFishIcon, fishMesh/creatureMesh/addFishToScene give voxel meshes for the tank). `setVoxelMode(false)` = old
  smooth meshes. Bubbles the guide is now a toy grouper (see "Bubbles, the toy grouper guide [grouper23]" below); the old
  plush seal is gone.
  Dev: `node tools/build.mjs --dev lowpoly` -> `dev/lowpoly.html?mode=gallery&page=N | giants | vg | seal | icons | scene |
  turn&ids=puffer | perf`.
- Creatures remake (phase 8b): solid creatures (realvox SOLIDS) are tessellated into ~2-voxel facets (per-face colour
  = near per-voxel detail; `real.voxK` raises a species' voxel count) with superellipsoid / warp primitives and natural
  voxel eyes (`natEye`). Rebuilt anatomy: crabs (granular carapace with grooves, eyestalks, jointed chelipeds,
  4 pairs of jointed walking legs in a tetrapod gait), seahorse (head + snout + coronet, ringed plates, coiled tail),
  jellyfish (glassy bell, lappets, frilly oral arms, long tentacles), dumbo octopus / vampire squid (webbed umbrella),
  Wakka chomper = blown-up spiny pufferfish with a chomping beak. Fish-plan: puffer archetype (blunt head, beak,
  round spiny ball when inflated), flatfish (bulging eyes, opaque fringe), mola (tall fleshy fins, scalloped
  'clavus' tail type), globular anglers with visible teeth.
- [phase8:ui] Pixel-art FX + UI API (UI & Particles agent):
  - `game.particles` (src/gfx/particles.js): `pixelBurst(kind, x, y, n, opts)` with kinds sparkle star heart drop splash
    foam puff bubble scale coin aero confetti ribbon dust smoke leaf petal zap spark impact pop note shard wave;
    combos `impact(x, y, size 0|1|2)`, `poof`, `pixelSplash`, `wavelets`, `hearts`, `zapBurst`, `celebrate`, `uiClick`,
    `purchase`, `unlock`, `levelUp`, `chestOpen(x, y, rarity)`, `catchBurst(x, y, rarity)`. opts.layer defaults to 'fg'
    for bursts and 'ui' for the UI combos (pass `{layer:'fg'}` on a particle system that only draws 'fg').
    ring / ripples / shockwave / ringWave (and raw `{kind:'ring'}`) now emit pixel effects: never draw expanding circles.
  - Sprites: src/gfx/pxsprites.js (`pxFrames(name, ramp, size)`, `RAMPS`, `pixelBubble(r)`, `pixelCloud(w)`).
  - Items: src/build/itempix.js hand-made 24 px pixel art for the material/sample/egg/Aero/satchel/scroll art ids;
    `itemSprite()` returns it automatically (`{voxel:true}` forces the old model). Packages stay voxel.
  - UI: `drawTitle(ctx, text, x, y, {scale})` (Alagard titles), `drawPixelBrackets` / `drawFocusBrackets` (selection /
    'look here' markers instead of rings), pixel-styled `aeroSurface` (banded dither + hard gloss + bevel; `smooth:true`
    opts out). Text: while UI size is Big/Huge the 'small' face renders with the 7 px glyphs in capitals
    (`faceOf`, `setTextBump` in font.js); measure with measureText / lineHeight rather than hard-coded 7 px rows.

## Phase 10 UI (detailed voxel icons + voxel chrome) [phase10:ui] [icons15]
- [vicons30] CURRENT AGAIN: the user hated the 2D pixel-art icons ("Bring voxel UI back, I hate 2D pixel art"), so
  [pixicons26] is REVERTED: src/gfx/pixicons.js + src/gfx/pixart.js and icongallery page 9 are deleted and every icon
  API below routes straight to this voxel pipeline again (renders now carry the [cel29] cel shading). Additions:
  - The generic FISH is a GROUPER (Bubbles' kind): `grouperInto(m, p, cx, cy, cz, k, dir, {lite, short, noFar})` in
    iconvox.js (olive-gold body with round dark spots and back saddles, pale belly, gold head freckles, spiny dorsal with
    gold-tipped spines, soft rear dorsal, gold-rimmed fan tail, big pink pouty lips, googly eye with an off-centre pupil).
    `ICON_VOX` / `UI3D_VOX` `fish` / `grouper` (so `getUiIcon('fish')`, `{fish}`, labIcon('fish') draw it); the
    fishbowl and cube tank hold one (no goldfish anywhere); the FishDex book's emblem is a gold grouper (painted 2 voxels
    thick so it survives the small-size downsample); the multiplayer icon is two chibi groupers tilted nose to nose under
    a voxel heart (`heartInto`, `tiltInto` = build in a scratch layer and stamp it turned about z).
  - Currencies: `aerobuck` / `aerobucks` (the glossy drop, aliases of `coin` / `aero`) and `gem` / `bytegem` (the faceted
    violet Byte Gem: octagonal crown + pavilion, alternating facet tones, cyan emissive "byte" pixels, white glint).
    `has3D(name)` also answers true for every `UI3D_VOX` name. src/ui/gemui.js (the wallet, quest rewards, the gem Skip
    button, `{abdrop}` / `{bytegem}`) draws these voxel frames (EXCEPT the wallet plaques: [wallet32] uses the hand-drawn
    pixel droplet / gem there) (`icon3dFrame`, the gem turns once per shine sweep, the
    drop squashes about its foot); its own pixel sprites only stand in until a frame is built.
  - Lab: `labIcon('fish')` / `fish:` (no id) = the grouper; `fish:<species>` keeps the species' voxel fish.
- Icons [icons15] (replaces the low-res toy-block icons): every model icon (bigicons.modelFrame / iconFrame / getBigIcon /
  rodIcon / gemIcon / decorFrame / cutGemFrame / voxelModelFrame, icons3d / getUiIcon, fishing icons3d, items via `itemSprite` /
  `itemIcon`, bait via `baitIcon`, Lab icons) is DETAILED VOXEL PIXEL ART in the bait-art style: `src/gfx/voxicon.js`
  voxelises low-poly meshes at ~1 voxel per 2 device px (`iconRes(px)`, 10..60 voxels; bilateral colour smoothing melts
  facet jitter, quantised glossy palette) or takes VoxelModels at their own resolution (integer majority downsample only
  when far too big for the size), and renders them with `renderVoxels` (7-step hue-shifted ramps, smooth glossy normals +
  specular glint, AO, edge highlights, depth lines) plus a dark outline (2 device px on big renders) and a soft drop
  shadow (`renderLayers`). `over` layers draw on top (with their own outline), `glass` shells composite translucent
  (faint body, opaque rim + glints). Light comes from the camera's upper front-left for every icon and every spin angle.
- Hand-built models: `src/gfx/iconvox.js` `ICON_VOX` (lab flask with glass + bubbling potion, quest scroll with wax seal,
  fishbowl + cube tank with a goldfish overlay, FishDex book, satchel, striped tee on a hanger, desk globe, market stall,
  worm on a hook, two toy groupers puckering up at a heart, settings cogs, hammer + wrench, Aero drop; same aliases as ICON_MODELS), `UI3D_VOX`
  (the same models for icons3d names: beaker, book, globe, shop, hammer, scroll, coin / aero ...), `ROD_VOX(rod)` (cork
  grip, reel seat, spinning reel with line, wrapped guides, tip, bobber; trident / glow kinds). Defs: `{vm, vmOver?,
  vmGlass?, yaw, pitch, spin}` (layers share dimensions; y up, z toward the viewer). Mesh models without a hand-built twin
  (iconmeshes / icons3d / fishing icons3d / decor / gems) are voxelised automatically at the same density.
- Views / spins: a 3/4 view (yaw ~0.42..0.66 rad, pitch 0.3..0.52; < 52 device px a flatter front view); `full` spins
  step through 12 baked angles, `wobble` through 5; z-axis spins re-voxelise per roll. Frames are cached per (key, px,
  angle); new frames are built within ~7 ms per frame (`voxMisses()` counts deferred builds for callers that cache);
  `iconFrame` / `getBigIcon` / `rodIcon` / `gemIcon` build their `.hi` twin lazily (~5 ms a frame), `modelFrame` eagerly.
  Item VoxelModels keep their authored yaw / pitch (`voxelModelFrame(key, () => ({m, yaw, pitch}))`).
- Dev preview: `node tools/build.mjs --dev icongallery` (`?page=0` menu icons + fish + gem at 44 / 32 / 22 px + rods, gems, decor;
  `1` icons3d (UI3D_VOX names first); `2` items + fishing icons; `3` Lab icons; `&spin=1` turns them, `&bench=1` -> `window.__bench` ms per frame).
- Chrome: the `.hi` twin of every `aeroSurface` is a voxel slab (`voxelSlab` in src/ui/aero.js: block grid, stepped
  corners, bevelled frame ring, side band `depth`, outline; `ring: n` = frame only). `drawAeroFrame` adds a voxel
  frame ring, a title plaque and voxel ornaments (`drawVoxDecor(ctx, name, cx, cy, px)`); toasts sit on voxel plates.

- Lab backdrop [lab18]: `src/ui/labroom.js` draws an UNDERWATER VOXEL SCENE behind the Lab (it replaced the [lab15]
  pixel-art space scene, which is gone): `drawLabRoom(ctx, view, t, cam, kind)` (kind 'tree' | 'rods' | 'boats'; cam =
  {x, y, z} pan / zoom delta from the tree camera for parallax, omitted = a slow idle drift). Every solid thing is a
  voxel model: reefs from the reef kit (`src/world/coral.js`, with a low-growing species mix: no sea whips / pillar
  corals), pinnacles / mesa / arch from `src/world/farvox.js`, relics from the prop library (`getPropSteps`), and the
  dunes, seabed slab, clouds, fish, sea turtle here. NO kelp or other tall tree-like plants: the space is filled with
  low reef life. Layers back to front (each with its own parallax, softly capped by its padding, and hazed toward the
  water colour by depth): water gradient (Boats: a strip of sky with voxel clouds on top); `far3` the faintest reef
  ridge; `far2` hazy pinnacles, a mesa and an arch on rock hills (+ far fish schools); `far1` a coral garden on dunes
  (bommies, fans, sponges, rocks; + mid fish schools and a sea turtle gliding by every 80 s with a 16-frame flipper
  stroke); `mid` reef bommies, the sunken boat, rocks, brain corals (+ hazed swaying anemones); `floor` the seabed slab
  (sand ripples, pebbles, shells, starfish, urchins, sand dollars, rubble; + looping caustics and short swaying
  sea-grass tufts); `props` tall coral-covered rock walls at both edges, sea fans, the anchor, the open chest, the
  clam, the diver's helmet, a message bottle (+ swaying anemones, ordered against the props by their boxes, and a
  crab that scuttles and pauses). On top: bubble streams (chest, clam, helmet, sand vents), drifting marine snow
  (1 device px), a readability veil per kind (the tree: a darker, calmer middle band and centre, brighter edges), then
  the rippling underside of the surface (12 frames). Swaying life uses the reef kit's `voxAnimSteps` (16 frames).
  Every static layer is built once per view size by a step generator (7 ms a frame, ~1.7 s CPU for the first tree
  view; the sprites are cached across sizes, so the Rods / Boats views then take ~0.3-0.6 s; layers fade in) into HI
  canvases with `.hi` twins; scenes are kept for the 3 most recent sizes. Boats: `labRoomScene(view, 'boats')` ->
  `{wl}` the water line; the boats float on it in a row, bobbing, hulls dipping into the surface band, names below
  it, each on `drawBoatFloat` (a darker stepped pool under the hull, foam dashes lapping at its sides, a pixel
  highlight band: white = selected, gold = sailing, with two twinkling glints). The tree's fog of war (labtree.js)
  is a dark-sea tint. No light rays / spotlights / ring effects / text pop-ups in the Lab.

## Hand-drawn 2D pixel-art icons [pixicons26] - REVERTED by [vicons30]
The user disliked them; src/gfx/pixicons.js, src/gfx/pixart.js and icongallery page 9 were deleted and every icon is
the detailed voxel art of "Phase 10 UI" again (see [vicons30] there). (src/build/pixart.js / itempix.js, the Workshop's
own phase 8 pixel item art, are unrelated and stay.)

## Phase 10 tank (2D side-scrolling voxel tank, build only in the tank) [phase10:tank]
- `src/aquarium/scene2d.js` + `tankart.js` draw the tank as a side-on voxel scene (back / mid / front layers), the
  same way the ocean is drawn. `sim2d.js` moves fish in 2D. The 3D cube scene, orbit camera and Swim mode are gone.
- Scrolling: drag, wheel, A/D, arrows, screen edges. Lab tank tiers (`src/aquarium/tanks.js`) grow the tank's width
  and height with a bouncy grow animation.
- Building: `src/aquarium/build2d.js` is the only build mode. `src/build/build.js` routes blueprints, U, Move and
  Demolish into the tank. Old seabed (ocean-world) buildings migrate into the tank once on load, keeping bonuses and
  production. While build mode is open it consumes Q, E, F, Delete and Esc.
- Tank HUD (polish pass): everything over the full view draws on the full-res UI layer (`Aquarium.drawUi`, called by
  game.js before the game HUD): an aqua voxel top plate (tank name in voxel letters, fish / happiness / Aero-per-minute
  wells), the Ocean button, a voxel scroll rail, a full-height tool rail on the right (Build, Feed, Fish, Gear, Light
  tiles with voxel icons), the Feed / Gear panels, emotes, particles and build mode. The scene's viewport stops at the
  rail (`scene.view`), so the tank never hides under it and the scroll ends at the frame. The frame (tankart.js) is a
  lacquered aqua-blue lid with a glass visor and LED strip, studded corner posts and a matching bottom rail.
- Food (`src/aquarium/food.js`, `FoodSim`): four voxel foods (Reef Flakes, Pop Pellets, Bloodworms, Brine Shrimp), each
  a tiny VoxelModel re-voxelised per tumble / wriggle frame; pieces fall from under the lid, splash, sink with their own
  physics (flutter, plunge and bounce, wriggle, kick), rest on the gravel and melt away. Fish dart at food and nibble
  it in bites (crumbs, chomp bubbles, nibble / gulp SFX). The Feed tile opens a food tray (`state.tank.food`) and a
  voxel shaker follows the cursor over the water: click to sprinkle there.
- [food24] Foods are progression unlocks (`src/game/foods.js`, data + rules; a fifth food, Golden Krill, was added to
  `food.js`). Unlock kind `food:<id>` (`lab.unlocked(state, 'food', id)`; Reef Flakes need none):
  - Pop Pellets: Lab `food_pellets` "Pellet Press" (Tank Life row, tier 2, after Auto-Feeder).
  - Brine Shrimp: Lab `food_shrimp` "Brine Hatchery" (Tank Life row, tier 4, after Fish Romance).
  - Bloodworms: side story `s2_worms` (Marina, ch2: 3 fish in the tank + 4 feedings), `reward.unlock`.
  - Golden Krill: side story `s5_krill` (Fizz, ch5, after `s4_egg`: hatch 2 + a mutant catch), `reward.unlock`.
  `FOOD_DATA[id].meal` = what a fish gets for `min` minutes after eating it (`rec.meal = {f, until}`, `mealOf(rec)`):
  `fill` (hunger per bite / Feed all), `hunger` (x hunger growth), `happy` (per bite), `mood` (+ happiness target),
  `grow` (x evolution), `aero` (x Aero/min in `fishRate` / `rateOf`; not offline), `court` (romance from 0.5 happiness,
  4 min rest), `mutate` / `shiny` (stored on the egg: `egg.mutate`, `egg.shiny`, multiply the hatch roll).
  `Aquarium.foodType` only returns an unlocked food (else flakes), so Feed all (`feedAll`), the auto-feeder and clicks
  never use a locked one. Tray: locked tiles = the Lab seal (`sealTex` / `padlockTex`, exported from labtree.js) over the
  dimmed voxel food; tooltip = `foodLock(game, id)` (how + why not yet); click = `ui.open('lab', {focus})` or pin the
  side story + open the Quest Log. `'unlocked'` {kind: 'food'} -> 3D voxel toast "NEW FOOD: X!" (`ui.toast(text, icon,
  time, {palette})`); the tile breaks its seal next time the tray shows it (`state.tank.foodSeen`). Hand feeding emits
  `'tankFed'` at most every 20 s (so feed quests work without Feed all). Save migration `ensureFoods` (once,
  `state.tank.foodV`): food nodes a save researched past are granted, the picked food stays, Bloodworms past ch2.

## Economy balance (progression pass) [balance]
- Lab prices (`src/game/lab.js`): `AERO_T` grows ~x2.4-4 per tier (15 ... 48,000). Nodes that unlock a rod, boat or tank (`node.main`)
  cost `MAIN_MUL` (1.5) x that, and tier 9 main nodes also want a Golden Scale. `TIME_T` / `MAT_T` / `FISH_T` grow with tier.
  `LAB_GATE` {tier: bossId}: tier 6-9 research needs that boss beaten (`state.bosses.won`) or its chapter finished (older
  saves). `node.gate`, `gateOk(state, node)`, `gateLabel(node)`; `labCheck` returns `gateOk` + `gate` (reason) and
  `canPlan` / `startResearch` refuse gated nodes. Quest grants (`grantLabNode`) skip gates.
- Next goal: `labGoals(state)` (next node of the rods / aquarium / boats / [prog18] oceans rows), `labGoal(state)` (the best one),
  `labGoalNeed(state, goal)` (one sentence of what is missing). Shown by the Lab tree (green tag, root card "Next goal"),
  Bubbles' hint tips (`tutorial.goalTip()`), a one-time toast when affordable (`progression.goalPing`, `state.lab.goalPing`)
  and the chapter quests `c2_dinghy`, `c3_glass`, `c4_chrome`, `c5_dolphin`, `c6_carbon`, `c7_trident`.
- Income: `OCEAN_VALUE` (`src/game/shopdata.js`) scales a fish's value by its ocean (`rec.biome`, else the species' home
  ocean): `valueMultiplier(rec, sp)` in `src/fish/traits.js` (catch bonus, release value, tank Aero/min). Quest Aero rewards
  scale by the chapter ocean's `OCEAN_VALUE`; chapter and boss rewards are set by hand.
- Tank tiers (`TANK_TIERS`): cap / rate / offlineH step up every tier. Boat perks (`src/store/boats.js` `BOAT_TIERS`) now have
  7 entries, matching the Lab's boats (the Catamaran and the Submarine step past the Research Vessel).
- Workshop rods, tackle, boat parts, rod tuning (`30 * (tier+1)^1.3 * star^1.75`), tank gear (`GEAR.cost`) and buildings
  (`BUILDINGS[id].cost` / `upgrades`) follow the same curve. Saves keep everything owned; only unbought things pay new prices.

## Quest-sealed research + ocean expeditions [prog18]
- Quest gates (`src/game/lab.js`): `LAB_QUEST_GATE {nodeId: questId}` (`node.qgate`) seals 39 key nodes (new rod / boat / tank
  tiers, big perks, every ocean) behind a story quest, side story or boss quest. `gateOk` = boss gate (`bossGateOk`) AND quest
  gate (`questGateOk`: quest done, or its chapter finished for main quests; a researched node never re-locks).
  `questGateInfo(node)` -> {id, title, giver, npc, chapter, chN, kind, boss}; `nodesGatedBy(qid)`, `QUEST_GATED`;
  `gateLabel(node, state)` names the quest first. `labCheck` adds `bossOk`, `questOk`, `quest` (info while sealed).
  quests.js registers its table with `setLabQuestInfo(lookup)` (no import cycle), sets `reward.opens` on gating quests
  (rewardList: "New research: X") and on completion / claim (`book.gatesOpened`) emits `'labNodeUnlockedByQuest'`
  {nodeId, questId, name, ocean} per node not yet researched and marks `state.lab.qgNew[nodeId]`.
- `tools/progcheck.mjs` builds the node + quest dependency graph (rows, quest gates, boss gates, chapter order, the 3-quest
  active window, side-story `after`, objectives) and fails on unknown ids, order / milestone / online-only gates, cycles,
  anything unreachable from a fresh save, or a gate that opens after the main quest that needs the node (optional nodes:
  no later than one chapter after their price tier). Run it after touching gates, chapters or the Lab rows.
- Oceans: `OCEAN_COST` (600 / 2,000 / 5,000 / 12,000 / 28,000 / 65,000 Aero + rare materials from the ocean you leave + a few
  of its fish), gated by the previous ocean's boss quest (its trophy). Chapter rewards no longer grant the ocean:
  `reward.chart = oceanId` (display only) plus a bigger Aero cheque (250 / 800 / 2,000 / 4,500 / 10,000 / 24,000); the
  `cN_sail` quests ask to research the ocean first. `node.ocean`; `GOAL_ROWS` includes 'oceans' and a charted ocean is THE
  `labGoal`. The map's locked-ocean checklist shows the boss trophy row.
- UI (`src/ui/labtree.js`): `tree.QG[id]` = sealed. Sealed tiles keep their art under a pixel seal (dithered indigo veil,
  chain X, gold padlock: `sealTex` / `padlockTex`, PixelBuffer at HI) + a voxel scroll badge and the quest title under the
  name; the card shows the giver portrait, quest title, chapter, progress and Track quest (`book.setPin`) / Quest log.
  Breaking a seal (qgNew on open, or live): chain bits, the padlock drops, 3D voxel "UNSEALED!". `progression.js` toasts
  the research a quest opened (one toast per quest).


## Phase 10 bait models + clean catch moment [bait12]
- Bait art: `src/fishing/baitmodels.js` holds one hand-crafted, detailed voxel model per bait (`BAIT_MODELS`: the 11
  specials plus one creature per flavour line, picked by `art.line`; creature colours come from `art.color/color2`,
  `art.tier` adds glitter / glow / gold flecks; creatures take an animation phase). `src/fishing/baitart.js` renders
  them: `baitIcon(art, px, ph)` = the detailed model (fine `.hi` twin, wriggling at px >= 40) or, below 22 px, the
  detailed voxel icon of the same model (bigicons.voxelModelFrame); `baitHook(art, t)` = the 8-frame wriggling bait drawn at 2x world resolution on
  the hook (fishing.js draws the hook over it). Dev preview: `node tools/build.mjs --dev baitdetail` (`?page=0|1|2&px=`).
- The catch moment has no light rays, spotlight glows, lens flares or light streaks (FISH ON, the landing finale,
  I GOT IT, boss VICTORY / phase cards, box catches, the catch card): `drawRays` is gone. The catch card backdrop is
  the sky gradient with soft drifting bokeh and a faint rarity tint.

## Ocean voyage transition [travel17]
- `src/world/voyage.js` (`game.voyage`, made by Ocean): `ocean.travel(id, done)` hands the trip to `voyage.start()`; the old
  vertical scroll stays as a fallback. `ocean.travelState` gains `{voyage: true, live, hideBoat}`: while `live` the normal
  world pipeline renders (departure, the hidden arrival capture, the settle) and `waterLevel()`, `Boat.visible`, the camera,
  floaters and peer boats treat it as open water; input, HUD, quests, boss and the guide stay blocked for the whole trip.
- Beats: depart (live: `boat.pilot` steers the real boat off to the right, `camera.drive = {cx, cy, z}` pulls back to the
  whole-world wide shot), sea (screen-space scene drawn by `Voyage.drawOver` after the world: origin postcard leaves with
  parallax, palette origin -> open sea -> destination, voxel clouds / islands / sailboats / buoys, gulls, weather, a virtual
  close-up zoom on the boat; the destination builds through `biome.steps()` and is grabbed live under the overlay), arrive
  (destination postcard glides in, landmarks rise), settle (live again, postcard dissolves, camera eases to the fishing zoom).
  `Voyage.drawUi` (UI layer): route chart + compass in the letterbox, skip glyph, the 3D voxel title (letters drop in;
  gold "NEW OCEAN!" + confetti on a first visit). Skippable (click / Esc / Space fast-forward) after the first trip ever;
  repeat trips are shorter. `voyage.sail(destId, onArrive)` is the Lab / Workshop variant (cross-fades into the dock scene).
- Biome builds are time-sliced: every biome has `*steps(W, H)` (sync `build()` runs all steps; sub-builders have `$`
  generator twins), `DepthScene.terrain$` / `render$` in scenery.js yield inside their loops. `state.voyage = {trips, seen}`.
  Event 'travel' {to, from, first} fires on arrival.

## Detailed quest cutscenes [cine21]
- `src/ui/questcine.js` (director) stages its heavy beats on a `Stage` (`src/ui/cinestage.js`): the cast's marks along the
  surface next to the boat (world space; a plain screen stage when the ocean camera is not open), camera shots
  (`wide | stage | group | one | two | player | prop | set | boss`: eased `camera.focus` moves with a subtle handheld drift,
  or cuts with a dissolve from a snapshot of the world canvas), depth-of-field-like dimming (a soft vignette + darker sky
  band around the subject), the angler's reactions (`boat.pose`, `boat.faceOverride`, `boat.hopY` tagged hooks in
  boat.js), critters (gulls that land and flee, leaping ocean fish, a crab on the set, penguins, jellies, eyes in the
  dark) and pixel weather (petals, glints, snow, sparks, rain, embers, plankton) under a time-of-day grade.
- `src/ui/cinescript.js`: `SETS[chId]` (platform, props + owners, weather, grade / night grade, captions, critters) and
  `SCRIPTS[chId].intro / .finale` (steps: `{wide}`, `{enter, how}`, `{prop}`, `{fx}`, `{boss}`, lines
  `{n, s, shot, to, act, key, emote, pl, re, fx}`; `*word*` = emphasis in the speaker colour + a gesture when typed).
- `src/ui/cineprops.js`: hand-built voxel set dressing rendered once per screen height (+ `.hi` twins) and prepared during
  idle frames (`prepProps`): Fizz's lab bench, Marina's anvil + toolbox, Captain Bloat's helm + sea chart, one platform per
  ocean (islet, pier, ice floe with a snowman, scrap barge with a CRT, neon pontoon, basalt columns with lava, glow rock),
  a raft, gulls, penguins, crabs (per-ocean colours), jellies. Dev preview: `node tools/build.mjs --dev cineprops`.
- `Typer` (cinestage.js) replaces the Dialogue class in cutscenes: punctuation pauses, an 8-bit voice blip per letter
  (an arpeggio on punctuation, the speaker's voice from `VOICE`), emphasis.
- Beats added: `boss` (a boss quest starts, Full only: pan down to its silhouette, rumble, 3D "BOSS SIGHTED!", the giver's
  warning, the card flies into the tracker). Gallery: the Quest Log's chapter page has OPENING / FINALE pills that call
  `cine.replay(chId, kind)` (plays even with cutscenes Off, changes nothing in the save, reopens the log afterwards).

## Bubbles, the toy grouper guide [grouper23]
- The guide is an ORIGINAL character: Bubbles, a chunky wind-up TALKING TOY GROUPER that floats (`src/gfx/grouper.js`). Glossy
  painted plastic in voxel art with a baked black ink outline: a big head, mottled olive / golden-brown / pale-gold grouper paint
  (dark saddles, dark spots, gold freckles on the head), a spiny dorsal fin (gold-tipped spines, rounded soft lobe), a round
  gold-rimmed tail, rounded pectoral fans, big coral pouty lips with an underbite, white bulging eye domes in dark sockets.
  Toy details: the head is a separate moulded piece that turns on a seam along the gill cover, a speaker grille (its voice
  box) on the cheek, a battery hatch with a silver screw on the lower flank and a silver wind-up key on its side that turns.
- Talking: the lower jaw is a real HINGE (separate jaw loft, dark throat, pink tongue, two toy teeth). `talk` (0..1) picks a
  baked jaw position (3 levels for idle / wave, 2 for most anims), so the jaw flaps in sync with the dialogue. Pupils (gaze,
  idle glances, a rare eye roll, dizzy spirals after a spin, hearts, pinpoints when surprised), plastic eyelids (blink,
  sleepy, sad, angry, happy squint), thick painted brows (waggle while talking), blush, tears and a sweat drop are drawn live
  at voxel resolution on top of the sheets (snapped to whole voxels). The eye domes are measured in each rendered cell
  (`vis`, visible centroid), so the far eye's pupil sits on the part that peeks over the head.
- Animations (`GROUPER_ANIMS`): idle (floats, tail wags, key turns), swim, wiggle, wave, point (7 elevation buckets, the
  near pectoral fin points), flop (rolls belly-up limp and bobs back), spin, worried (teeth chatter), clap, think (fin on
  chin), blow (cheeks puff, lips pucker), cheer, sad (droops), sleep (snore bubble), surprised (PUFFS UP like a beach
  ball), scared, look (the goofy head-turn: swivels its head on the seam to stare at the camera), laugh. Other names map
  through `GROUPER_ALIAS` (talk, celebrate, love, cry, sleepy, excited, bend, jump ...).
- Pipeline: painted mesh per pose -> `voxelizeMesh` (0.043 units, ~56 voxels lips to tail) -> lowpoly `renderSheet` per cell
  -> ink outline; sheets cached per (anim, size bucket, view, jaw level). New sheets are built as background JOBS, one
  cell every other frame, while the nearest finished sheet stands in (no freezes); `warmGrouper(size, anims, view)` builds
  synchronously (idle with all its jaw levels; the other talking jaw levels build on demand).
- API: `drawGrouper(ctx, o)` (o: x, y, t, size, k, facing, anim, phase, point, tilt, mood, talk, lookAt, blink, ride (a
  trickle of bubbles under it), noseBubble (a bubble on its lips), hover (false = no built-in float bob), view 'side' |
  'front', id, alpha, base 'bottom' (it hovers a little above y)) -> anchors {head, top, mouth, nose, hand (pointing fin
  tip), tail, bottom, center, key, rect}; `GrouperGuide` (the screen-space floater: goTo, pointAt, emote, update, draw, rect,
  hit; it puffs up / droops / wiggles on mood changes and now and then turns its head to stare at you), `GROUPER_INFO`,
  `grouperSize`, `warmGrouper`, `grouperReady`, `drawSoapBubble`, `drawPointStream`, `pointBucket`.
- Compatibility: `src/gfx/seal.js` re-exports everything under the old names (`drawSeal`, `SealGuide`, `SEAL_ANIMS`,
  `SEAL_ALIAS`, `SEAL_INFO`, `sealSize`, `warmSeal`, `sealReady`, `SEAL_OUTLINE`, `SEAL_VOXEL`), and the NPC id stays
  `'seal'` (quest givers, cutscenes); `drawNPC(ctx, 'grouper' | 'seal' | 'clip', ...)` all draw it. Portraits frame its face.
- Dev preview: `node tools/build.mjs --dev grouper` -> `dev/grouper.html?mode=all | talk | close (&a=<anim>&m=<mood>&talk) |
  moods | portrait | guide` (`&t=<s>` freezes the clock; `window.__bench`, `window.__busy` = sheet jobs still running).

## Simple fishing: one meter, one spin, one SHOCK button [simple24]
User direction: "fishing a lot more simple, just spin, try to keep it in the middle" and "the shock is like a full
button ... more simple but more skill based, and do not need to do a lot of things at once". Only ONE input matters at
a time; the skill is steadiness in the middle zone and precise shock timing. This replaces the gear-RPM band, the tension
tube, surges / directional QTEs, hold-and-release charging, species events (minigames.js is no longer used by fights)
and the boss charge-dodge / minion clicks.
- Bite (`battle.js` `HookBite`, alias `HookSpin`): nibbles as before (a click while it only nibbles scares it off), then
  the big "!" with a draining window: CLICK (or Space). `DIFF[rarity].hookWin` x `stats.biteWindow`; the lesson gives 10 s.
- Fight (`battle.js` `Battle`, `gearMode 'meter'`): `marker` -1..1 on a horizontal meter, `zoneW` = sweet zone half-width.
  The fish's pull `need` (spin units, 1 = `RPM_UNIT` rpm) wanders (base / amp / speed), jitters and LUNGES (telegraphed:
  chevrons + RUN! / RUSH!). Spin `= gear.rpm / RPM_UNIT`; marker velocity -> `(spin - need) * GAIN - marker * spring`.
  Spinning: circle the mouse (crank.js), roll the wheel, or hold / tap W / Up / R (`gear.js` update). In the zone the catch
  bar (`progress`) fills over `DIFF.secs` (x1.35 when steady, x1.15 dead centre, x1.3 stunned; rod reelSpeed / Lab
  staminaDrain speed it up); outside it drains (`drain`, less with resilience). Lost only when the bar is empty AND the
  marker sits at an edge for 2.6 s (`run` left / `snap` right). `PACE` = spring, reaction, lunge warning, beat gap per tier.
  Commons ~10-16 s; legendaries ~25-35 s, jittery, narrow zone, quick spark.
- SHOCK button (`meter.js`, big voxel dome left of the meter, Space / click / right click): charges (`rod.shock.charges`)
  recharge over `rod.shock.cooldown` s (x1.35 faster while in the zone). With a charge ready (and the marker held in the
  zone 0.6 s, or after 3.4 s) the fight gives a BEAT: GET READY (the marker freezes, nothing to spin), then a spark sweeps
  the meter in `DIFF.sweep` s. Press as it crosses the gold notch (`critW`: rarity, `stats.timingWindow`, control, power)
  = CRITICAL ('shockFired' {grade 'perfect'}: big damage, long stun, the marker snaps home, combo); inside the green
  zone = GOOD ('good'); the red ends = BACKFIRE (`onBackfire`: the marker kicks out, the reel jams, -2 %). No press =
  MISSED, nothing lost. Damage `0.08 + 0.045 * power` (crit) / `0.035 + 0.02 * power`; stun `1.1 + 0.75 * power` s.
  Weapon level MK I..V (`shockLevel(shock)`), chain lightning arcs (+35 % each) at power >= 1.8 (crits) / 2.4 (all hits).
  Upgrades come from the rod and the Lab's Reel & Shock row as before (shockPower, shockCharges, shockCooldown,
  timingWindow, reelSpeed, staminaDrain, rodControl, rodResilience). Feedback: muzzle burst at the button, the bolt down the
  line, impact + zap sprites + scales at the fish, screen shake, camera punch, 3D voxel CRITICAL! / ZAP! / +N% / CHAIN.
- Quests: `Fishing.onShockFire(grade)` ('perfect' | 'good') and `onBackfire()` stay the hooks QuestBook wraps for
  'shockFired' (flawless = at least one perfect, no good / backfire).
- Bosses (`boss.js` `BossFight`): same meter + button. Phase 1 heavy pull + lunges; phase 2 faster, SHIELD (the boss wears
  orbiting voxel hex plates, the zone turns steel blue and LOCKED, the bar does not fill until a GOOD / CRITICAL shock
  cracks it; a charge is handed over if you have none) and ink on the lens (spinning wipes it); phase 3 RAGE + WEAK POINT
  (crits x1.6). Intro card, phase cards and the victory overlay are unchanged.
- HUD (`hud.js` + `meter.js` + `gear.js`): name pill, the meter (voxel-block track coral | aqua | green zone | aqua |
  orange, the fish's own voxel icon as the marker, SPIN! / EASY! coaching words), the catch bar under it, the SHOCK
  button left, the gear right (just the gear + SPIN ME! hint in meter fights; [crate26] crates now fight on the meter too, so the old box gauge is unused).
  [gear25] The gear is VOXEL ART (`gear.js` gearModel: 18 teeth, 6 spokes, enamel rim channel, brass rivets, hex-nut
  hub, aqua gem) rendered by voxicon `renderLayers` (ink outline, ramps, AO, glints): it repeats every 60 degrees, so
  24 frames (the model re-voxelised per angle) are cached at 1x and at the UI layer's 2x, warmed (throttled) while
  waiting for a bite; missing frames are built at most every ~60 ms (the nearest stands in). In meter fights it sits in
  a static voxel housing (backplate + blue ring) whose 12 voxel lamps are the speed feedback (lit clockwise with the
  rpm, in the state colour), and a pixel plaque labels the controls (CIRCLE WHEEL W).
  `fishing.partRect('meter' | 'bar' | 'shock' | 'all' | 'gear')` for the lesson brackets. No rings, no light rays.
- Lesson (`tutorial.js`): cast -> wait -> hook (click) -> spin (to 40 %, Bubbles coaches spin faster / slower) -> shock
  (a hit; misses / backfires are handed back, the third try gets a very wide notch) -> land -> card. Old saved steps
  (reel / ease / surge / zap) resume at the cast. Smoke test drives it with real mouse circling and Space.

## [cur26] Currencies (Aero Bucks + Byte Gems), wallet plaque, right-edge quest tracker

- **Aero Bucks**: the old Aero, renamed in every user-facing string (HUD, shop, Lab costs, quests, rewards, toasts,
  tooltips, cutscenes). It looks like a water droplet. Internal ids stay `aero` / `coins`.
- **Byte Gems** (`src/game/gems.js`, the second currency, a violet pixel crystal): `GEM_NAME`, `gems(state)`,
  `addGems(state, n, reason)`, `canSpendGems(state, n)`, `spendGems(state, n, reason) -> bool`, `skipCost(seconds)`,
  `ensureGems(state)` (save migration: saves from before gems get `GEM_WELCOME` = 30 once, flag `state.gemGift`),
  `bindGemsGame(game)` (Game binds itself; changes emit 'gemsChanged' {gems, delta, reason}). Balance `state.gems`;
  lifetime `state.gemsEarned` / `state.gemsSpent`. Earned ONLY from quests: `reward.gems` (defaults in quests.js
  `GEM_REWARDS`: main 2, boss quest 10, side 3, order 1, board bonus 5, milestone 3 x tier (max 15), chapter 10 + 5n;
  data may set `reward.gems` by hand). `grantReward` pays them; `rewardList` shows `{key: 'gem', n}`.
- Sinks: timer skips (`src/game/skips.js`: `labSkipCost/labSkip`, `wsSkipCost/wsSkip`, `eggSkipCost/eggSkip`; event
  'timerSkipped' {kind, id, gems}) shown as violet pixel "SKIP" buttons (Lab card "SKIP NOW", Workshop bench, tank egg
  chips under the top plate); cosmetics (the Wardrobe prices some items in gems with this API). No real money.
- Art (`src/ui/gemui.js`): hand-drawn 2D pixel sprites (droplet 11x14, gem 13x11 art px) used unless the icon agent's
  `getUiIcon('aerobuck')` / `getUiIcon('gem')` pixel icons exist (3D renders are ignored); `drawDrop`, `drawGem`
  (diagonal glint sweep), `drawDropSplash`, `drawGemShards`, `pixelPlate`, `drawGemButton`, `gemSkipButton(ui, ...)`,
  `drawEggChip`, inline text icons `{abdrop}` / `{bytegem}`.
- Wallet: SUPERSEDED by [wallet32] (brass-framed plaque, pixel sprites, header wallets). Original [cur26] notes:
  (`UI.drawWallet` in ui.js, replaces the glossy Aero pill): a pixel-art plaque top right (stepped corners, ink
  outline, broken highlight line, ripple marks, rivets; blue droplet half + violet gem half, inset wells, pixel-font
  numbers). Coins tick up as before (`coinShown`, splash on `coinBump`); gems tick up one by one (`gemShown`,
  glint on `gemBump`). `ui.coinRect` = the whole plaque; `ui.coinTarget()` / `ui.gemTarget()` = the icons (quest
  reward flights fly gems to the gem, questcine target 'gem'). Tooltips per half.
- HUD top left is empty: the location / clock chip is no longer drawn (`hud.drawChip` kept, unused). The quest tracker
  slot (`hud.questSlot()` -> `{x, y, w, h, a, side: 'right', edge}`) sits on the right edge at ~30 % height (left of
  the tank's tool rail in the aquarium). QuestHud hides the tracker off that edge (`peek` 0..1) and slides it in on
  objective progress (a polled fingerprint), a pin change, a card flying in (`expectCard`), a landing, a completion
  flash, 'questReady', or while a chapter story waits; it stays while hovered and slides out ~4 s later.
  `trackerRowRect(id)` answers even while hidden, so quest cinematics fly cards to where the row will be.

## [hot26] Hotbar buttons unlocked by building + an empty starter tank
User direction: "make your tank start off empty" and "make you start with 3 buttons unlocked, need to build to unlock more".
- Data + rules: `src/game/hotbar.js`. `HOTBAR_START` = Bait Shop, Quests, Aquarium; `HOTBAR_ALWAYS` = Settings.
  `HOTBAR_UNLOCKS[btnId] = {prop, build, price, label, icon}`: The Lab = `research_bench` (5 Aero), Satchel =
  `treasure_chest` (10), FishDex = `bookshelf` (15), Bait = `tackle_box` (15), Wardrobe = `vanity_mirror` (20), My Fish =
  `net_rack` (20), Map = `map_table` (40), Multiplayer = `phone_booth` (50), Workshop = `workbench` (60).
  `state.hotbar = {v, unlocked: {id: ts}, fresh: {id: ts}, migrated?}`; `ensureHotbar(state)` (the HUD calls it at boot),
  `hotbarUnlocked`, `hotbarLock(state, id)` -> null | `{id, prop, build, price, label, icon, tip}`, `unlockHotbar(game, id)`
  (emits `'hotbarUnlocked'` {id, label}), `unlockByProp(game, propId)`, `unlockPrice(state, propId)`, `unlockAll(game)`.
  Unlocks are permanent (storing / moving the prop never relocks). Old saves (no `state.hotbar`): every button the save
  shows it already used is granted (Lab research or a finished tutorial -> Lab, catches -> FishDex + Bait, items -> Satchel,
  a tank fish -> My Fish, cosmetics / dress -> Wardrobe, chapter 2+ / other oceans -> Map, Workshop feature -> Workshop,
  online -> Multiplayer, an unlock prop already in the tank -> its button, chapter 3+ -> everything).
- Props: `src/gfx/unlockprops.js` (`UNLOCK_PROPS`, registered into `PROPS` by props.js): Research Bench, Bookshelf,
  Tackle Box, Mirror, Net Rack, Workbench (tag 'unlock', `decorOnly`); Treasure Chest, Treasure Map Table and Phone Booth
  are existing decor. Any decor placement goes through `Aquarium.insertDecorRec`, which calls `unlockByProp`.
- Build mode (`build2d.js`): catalog tab **Unlocks** (`catOf` -> 'unlock'); while a prop's button is locked its offer is
  `{kind: 'buy', price: unlockPrice, unlock: btnId}` (always buyable, sorted first, the button's 3D icon bobs in the
  tile corner, the tooltip says what it unlocks); placing it clears the picked entry. `enter({place: propId})` opens the
  Unlocks tab on it.
- HUD (`hud.js`, the hotbar part only): `hud.locked(it)`; a locked slot = slate tile, greyed icon (canvas filter), the Lab's
  gold `padlockTex`, no badge; the hover pill reads "Build a Research Bench to unlock The Lab" (no keycap); a click calls
  `aquarium.openBuild({place: prop})`. The gear pod's rod slot (Lab) and bait slot (Bait panel -> Bait Shop) respect the
  locks. `celebrateStep` waits until the bar is showing (not in build mode / cinematics / a modal), then pops the button
  in (slow outBack appear, pop squash, confetti, stars, bubbles, `ui_unlock`) and `drawCelebration` (called from
  `drawTooltip`, above panels) draws 3D voxel words "NEW BUTTON:" + "THE LAB!" (`drawPop3D`) and bouncing pixel chevrons
  over the button for ~3.6 s (`hud.celebrating`). No rings, no light rays.
- Keys: `game.hotkeyLocked(cmd)` (game.js `handleKeys`, `I`, the aquarium's `F`) ignores a locked button's shortcut and
  toasts what to build (at most every 1.5 s).
- Tutorial (`tutorial.js`): SHOWN no longer reveals locked buttons (the lesson shows the Bait Shop). The 'lab' step, while
  The Lab is locked: "The Lab is locked! Click it, then build a Research Bench" (pointing at the padlocked slot; the bench
  price is topped up), "Click in your tank to build the bench!" in build mode (Bubbles rests at the edge), and once it
  unlocks the build mode closes after ~0.9 s and the view returns to the ocean (the hint helper lives there), the button
  pops in and Bubbles says "A new button! Now open The Lab!";
  opening it moves on to 'research' as before. The hint helper suggests the cheapest locked build every third tip and skips
  tips about locked buttons.
- Quests: objective `{t: 'hotbar', id}` ("Build a Research Bench (unlocks The Lab)", icon 'decor', measured from
  `hotbarUnlocked`, re-checked on 'hotbarUnlocked'). Main: `c1_bench` (Lab), `c1_satchel` (Satchel, + a crate for
  `c1_chest`), `c1_shelf` (FishDex), `c2_chart` (Map, before `c2_sail`), `c2_bench` (Workshop). Side: `s1_tackle` (Bait),
  `s1_net` (My Fish), `s1_dress` now asks for the Mirror first, `s2_phone` (Multiplayer). All told by Bubbles (Marina for
  her Workbench).
- `tools/progcheck.mjs`: keys `b:<btn>`; Lab nodes and research / tank / boat goals need `b:lab`, sailing goals `b:map`,
  chests `b:inventory`, dress `b:wardrobe`, online `b:multiplayer`; every unlock prop must be tank decor; a main quest
  needing a locked button must come no later than (or in the same active window as) a main quest that asks to build it.
  It prints the unlock table.
- Empty starter tank: `defaultState().tank.bare = true`; `state.js` `oldTank()` sets `bare = false` on saves from before, so
  they keep their rocks and plants. `TankScene.buildScenery` adds no rocks, driftwood, moss balls, pebbles, static plants
  or physics plants while `bare` (it is in the scene key): clean sand planes, the back glass relief, water, light, the tank
  gear (sponge filter + air stone bubbles). Quests that check decor count placements ('tankBuilt'), so they stay doable.
- Smoke (`tests/smoke.mjs`): at the tutorial's Lab step it checks that only Quests / Aquarium / Bait Shop are unlocked,
  clicks the padlocked Lab slot, checks build mode opened on the Research Bench, clicks into the tank to place it, checks
  the unlock and the NEW BUTTON moment, then opens The Lab from its button as before.

## Crate fights, legs crates, mimics and line length [crate26]
User direction: "crates also have the same fishing mechanic as fish, and some can grow legs and swim away, or some are
mimics" and "make your strings have max length too, need to upgrade".
- Crate fight (`src/fishing/cratefight.js`): clicking the crate under the idle hook (`drawBoxHover`: pixel corner brackets,
  no ring) runs `Fishing.startBox(f)`. `CrateFish` is a fish-shaped proxy whose x / y / z write straight through to the
  floater (`f.hooked`, `f.rollCtl`: fishing owns the position and roll). `CrateBattle extends Battle` keeps the same
  meter, spin, beat and SHOCK button (and the hooks QuestBook wraps), and tunes it per tier (`PROFILE`): wooden crate
  (light, wobbly, 9 s bar), iron (heavy, steady: pull 0.82, amp 0.07, spring 0.6), golden (heavy, sly), orb (floaty,
  darting); bottles and capsules wobble more. Landing -> `CratePop` (out of the water to the rod) -> `game.onBoxCaught(f)`
  (chests to the Satchel / the chest-cracking minigame, as before). Loss -> `CrateEscape` (a Fishing.cine; the floater is
  released and fades). The old box reel and its gear gauge are gone (`boxreel.js` keeps the art, the hover cue and the
  loot pop-up). Meter: `B.markerIcon(w, h)` (the crate rides the meter as its own voxel icon, `floaters.crateIcon`),
  `B.shielded` locks the zone like a boss shield, `B.zoomAdd` / `B.camOffY` steer the fight camera, `B.drawHud` /
  `B.drawWorld` add the crate's titles.
- Surprises (`floaters.js`): `rollSurprise(rng, oceanK, deepExtra)` at spawn, kind `crate` only: legs `0.15 + 0.07 d +
  0.03 deep`, mimic `0.08 + 0.06 d + 0.04 deep` (15 % / 8 % in the (OS)cean, 22 % / 14 % in the last ocean, up to about
  26 % / 19 % in the abyss zone). Tells: a legs crate hops with leg tips poking out every 2.5-5.5 s, and a mimic lifts its lid a
  crack with an eye glinting every 3.5-7 s. Art: `crateVariantModel` builds real voxel models: three crab legs a side
  (knee up, 4 walk frames, 3 grow steps), the lid hinged on the back edge and rotated open (12-90 degrees) with fangs, gums,
  big eyes under it, rim teeth, a mouth cavity and a tongue that lolls over the front, and a steel shield finish.
  The sprites are cached per frame and scale and anchored on the body centre with `project()`. `f.size` swells a revealed
  mimic to 1.5x. Floater fields: legs, walk, mimic, peek, shield, flash, hop, size, running. Dev: `spawn({kind, tier,
  surprise, x, y, z})`, `forceSurprise`, `preview(tier, o, scale)`.
- Legs: 1.2-3.5 s into the fight a 1 s beat (hop, legs grow, 3D LEGS?!), then pull speed x1.7, amp x1.25, jitter +0.22,
  lunges >= 0.32/s with a 0.7x warning, drain x2, half the self-centring. If you lose it, it drops to the seabed and
  scuttles off-screen (dust puffs, a 3D taunt, crab_scuttle). Mimic: it shows itself at the hook-set (45 %) or 25-40 %
  of the way in. The reveal is a 2.3 s cinematic: the lid creaks, flies open and snaps twice, it swells, the camera
  pushes in with slow-mo and a red flash, and bouncing 3D voxel letters spell MIMIC! with IT BITES! under them. Then a
  MINI-BOSS: zone x0.85, pull +0.1, amp +0.08, speed x1.3, bar x1.45, and it bites 6 % back. CHOMP every 3.2-5.5 s (a
  0.75 s telegraph with the lid agape and a 3D CHOMP!) snaps the lid and knocks the marker 0.5 toward the edge it leans
  to (-2.5 %). At 50 % a SHIELD: the lid clamps shut in steel, the zone locks, a charge is handed over and the beat comes
  fast. A GOOD / CRITICAL shock CRACKS it. A tamed mimic upgrades the loot one tier (`upgradeTier`: crate -> iron chest
  -> golden -> orb) and gets the MIMIC TAMED! title.
- Line length (`src/fishing/line.js`, pure data): reach in ZONES, the same in every ocean (1 = the ocean's own scene,
  the Sunlit Zone, 2 = through Twilight, 3 = through Midnight, 4 = the abyss floor; `reachY(layout, reach)` -> world y,
  and the first zone is always fully in reach, so the lesson and the smoke test never meet the limit). Rod base
  `1.1 + 0.07 x tier` (+0.4 Leviathan Line, +0.2 Trident, +0.15 Glow): Twig 1.1 (Sunlit), tier 5 1.45, Aerolite 1.73.
  Lab (Tackle row, `lineReach`, chip "+1 zone"): Longer Line (tier 1, +1: Twilight), Deep Spool (tier 2, +1.2: Midnight
  and the top 30 % of the Abyss, enough for every boss), Abyss Spool (tier 4, +0.7: the floor). Workshop line spools: Braided +0.15,
  Glow +0.3, Titan +0.5. `rodStatsOf().line` (clamped 1..4) and `RODS[i].stats.line`; `ROD_STAT_KEYS` has 'line' (the Lab
  rod card / Workshop show `lineLabel()`: SUNLIT / TWILIGHT / MIDNIGHT / ABYSS / ABYSS FLOOR). Fishing clamps the idle hook
  at `lineMaxY()`. Past it, the line draws taut, a red crimp bead sits above the hook, a dotted ghost line runs to where you
  aim, a 3D voxel MAX LINE sign (and LAB: LONGER LINE) shows under the hook (pinned to the screen edge), and 'maxLine' is
  emitted. `tools/progcheck.mjs`: boss objectives need line_len1 + line_len2. Saves that had already left the (OS)cean get
  those two nodes for free (`state.lab.lineV`).


## Wardrobe [wardrobe26]
- Wardrobe = voxel boutique backdrop (`src/ui/wardroberoom.js`, `drawWardrobeRoom` / `warmWardrobeRoom`, built in time slices
  per view size, placeholder until ready) + a compact right-hand column in `src/ui/wardrobe.js`. Premium cosmetics are
  priced in Byte Gems via `GEM_PRICES` / `gemPriceOf()` and bought through `src/game/gems.js`; `state.wardrobeSeen` drives
  NEW tags. Dev preview: `node tools/build.mjs --dev wardrobe`.

## Deep-sea species [deep26]
- `src/fish/species-deep.js` adds 17 deep-zone species (viperfish, loosejaw, seadevil, frilled/goblin/sixgill/lantern/
  cookiecutter sharks, snailfish, bigfin and cock-eyed squid, telescope octopus, swallower, whipnose, tripodfish, yeti
  crab, giant isopod). Depth-zone `valueMul` (twilight 1.15, midnight 1.3, abyss 1.5) stacks with the ocean multiplier in
  `traits.valueMultiplier`. `lunge` behaviour = burst at the hook with jaw snaps; lures blink faster near the hook.
  Deep ambience (`src/world/deepsea.js`, `depthzones.js`): darker zones, more watching eyes, passing silhouettes,
  pitched-down sample rumbles, bioluminescent plankton wake behind the hook. Reaching deep zones needs line upgrades
  ([crate26]). [deep28] adds 16 more species, the Hadal Zone, ambushes / packs / the big eye and fight twists.

## Performance pass [perf27]
- Profiling: `PW_PATH=/opt/node-tools/node_modules/playwright node tools/perf.mjs [--secs 6] [--only ocean,lab] [--profile]
  [--json out.json]` boots `dist/index.html?fresh&skipintro` headless, skips the chapter-1 cutscene and measures the
  scenarios ocean, fight (a hooked fish, mouse circling the gear), tank, lab, wardrobe, voyage (oscean -> shallows),
  cutscene (Quest Log replay of ch1), deep / deep2 (camera at the abyss floor): rAF fps and frame intervals, the game's
  own CPU per frame (update + draw), long tasks (> 50 ms), main-thread task time per frame (CDP Performance metrics:
  script + canvas raster, the honest number for software rendering) and the JS heap after a GC. `--profile` adds a CDP
  CPU profile per scenario (top self time, native canvas / GL calls by JS caller; `PERF_INCL=n` inclusive times,
  `PERF_SPIKES=ms` the functions behind each long frame, `PERF_CALLERS=fn` call paths). `PERF_JS=<file>` serves another
  bundle (A/B against a saved baseline), `PERF_SETTLE=ms` waits for background builds, `PERF_EVAL=<js>` runs an
  experiment, `PERF_Q=&watergl=0` adds query flags. Headless Chromium rasterises canvases in software: compare runs
  relative to each other.
- Locked hotbar slots drew their icon through `ctx.filter` (grayscale) every frame; a canvas filter makes the browser
  filter a canvas-sized layer per draw, which was the single biggest cost of every scene. `filtered(src, filter)`
  (`src/core/canvas.js`) caches a filtered copy per sprite (+ `.hi` twin); the hotbar, the sealed food chips and the
  dark-tank food use it. Never set `ctx.filter` on a per-frame draw.
- Caustics (`Caustics.drawHi`, scenery.js) are painted in DEVICE space: a canvas-sized layer gets the mask and the
  pattern drawn through the transform the old 2x / 3x band layer was composited with, so only on-screen pixels are
  painted (the old layer was a whole band at 3x); repainted when the frame, drift or camera change. Luma masks are
  black with the light in alpha and the pattern lands with 'source-atop' (bounded ops: no hidden full-area layer).
  The fallback / 1x path only repaints the visible part of its layer.
- Big modal windows (`game.worldThrottle`): while a finished-opening modal panel covers >= 50 % of the screen (Lab,
  FishDex, Satchel ...; not during voyages, dock scenes, the tutorial, fish on the line, cinematics) the world under
  it is drawn every 2nd frame (every 4th at >= 85 % cover) into `game.worldSnap` and blitted in between
  (`drawScene` is the world part of `draw`). Updates still run every frame.
- Fish sprite sheets (`lowpolyfish.js`) build in parts: `sheetStart` (poses, bounds) / `sheetStep` (one swim cell per
  call under the frame budget; `renderSheetPart` in lowpoly.js draws each cell where `renderSheet` would and reads it
  back on its own, so the pixels are identical) / `sheetFinish` (outline, glow, anchors). Forced builds still finish
  at once. This removed the 50-200 ms hitches when a new fish, giant or deep creature appeared.
- Boot: `Ocean.onResize` no longer rebuilds a biome already built at that size (the constructor built the first
  ocean twice: ~0.5 s less to the first frame).
- Bounded caches: colour / ramp / pack caches keyed by blended colours and the glow / bubble sprite caches now evict
  their oldest entries past a cap.

## More deep-sea species, the Hadal Zone, scares and fight twists [deep28]
User direction: "deeper zones have more scary fishes too, add more deep sea fish".
- Species (`src/fish/species-deep28.js`, joined after the GROW pass like [deep26]): giant squid (legendary), colossal
  squid (legendary, fjord), Humboldt squid, firefly squid (schools), Dana octopus squid, sea pig, Atolla jelly, bobbit
  worm, hagfish, cusk eel, Pacific blackdragon, longnose lancetfish, sabertooth fish, deep-sea lizardfish,
  Lasiognathus and the Hadal Matriarch (legendary trophy after Ceratias holboelli / the triplewart seadevil). Fields as
  [deep26] plus `fight.twist` and `scary` (default true; the sea pig and firefly squid are false).
  `valueMul` hadal = 1.8. Anatomy: fish plans `A.hagfish, cuskeel, blackdragon, lancetfish, sabertooth, lizardfish,
  lasiognathus, matriarch` (anatomy.js) and realvox SOLIDS `teuthid` (one squid builder: mantle + fins
  diamond / broad / round, big eyes with eyeshine, a fanned crown of eight arms with sucker rows (`hooks` for the
  colossal), clubbed tentacles (`tentLen`), photophore studs (`photo`), chromatophore speckles, Dana's blinking
  arm-tip light organs (`armLights`)), `seapig`, `atolla` (its blue alarm lights chase round the rim across the swim
  frames) and `bobbit` (rising from a sediment mound, scissor jaws snapping across the frames). lowpolyfish.js adds
  `lure.drop` (a line hanging from the rod tip) + `lure.hooks` (J hooks under the bait), `S.bumps` (glowing caruncles
  on the back, `S.bumpCol`) and `S.males` (dwarf males fused to the belly). Looks reuse `kind` squid / jelly / crab so
  the tank sim and the rig treat them like their relatives.
- The Hadal Zone (`depthzones.js`): not a layout zone but the bottom stretch of the abyss zone, from `HADAL_K` (0.7)
  of the way down to the floor (`hadalY(L)`, `inHadal`). Line reach `HADAL_REACH` 3.7 (line.js; `lineInfo` says
  'Hadal'), so it needs a maxed-out line (Abyss Spool or a Titan spool on a high-tier rod). Species with
  `zone: ['hadal']` only spawn there (cusk eel, matriarch); abyss species come down too. `ZoneSpawner.sub()` reports
  'hadal' while the view looks below hadalY; `band()` then spawns and keeps fish in the hadal band. Ocean.updateZone
  shows a 3D 'HADAL ZONE' card (emits 'hadalZone'); the FishDex shows 'Hadal'.
- More, scarier fish: `ZONE_POP` twilight 0.8, midnight 0.66, abyss 0.52, hadal 0.5 (was 0.75 / 0.55 / 0.4);
  `ZONE_RARITY.hadal`; `ZONE_SCARY` (midnight 1.6, abyss 1.9, hadal 2.2) multiplies the spawn weight of scary species
  (`isScary`: `sp.scary`, else a lunge or a zone + lure) in `rarityMul`. More watching eyes (abyss 7, hadal 9).
- Ambience and scares (`src/world/deepscares.js`, `DeepSea.scares`; capped, objects reused, creatures built through
  `DeepSea.makeCreature` and kept warm with `warmUp` so their voxel sheets build ahead): glowing schools (two flocks
  of up to 16 tiny fish: photophore rows or pairs of eyeshine) and a giant squid tentacle drifting across the far
  dark (a voxel silhouette with a cold rim and suckers, kept out of the hook's light pool) in the glow pass; after the
  lighting pass, lit through `Ocean.lightAt`: floor ambushes (the hook near the abyss floor: a bobbit worm rears out of
  the floor beside the hook to its height and snaps, clipped at the floor line, or a lizardfish darts up through the
  hook and back) and a Humboldt pack (4-6 squid racing past the hook, flickering red, with red lights). The big eye:
  `DeepSea.startScare` picks it (abyss 30 %, hadal 45 %; scares now also in the midnight zone, rarer): a 184x102 px
  voxel eye (2 px blocks, cached once: eyeball, three slit pupils, eight lid steps that dither out into the dark)
  opens right behind the hook, the pupil tightens and tracks the hook, blinks once, closes and fades (4.4 s).
  Settings > Deep scares (`state.settings.deepScares`, default on) turns off the jump scares (eyes, lunges, the big
  eye), ambushes and packs; schools, tentacles, giants and distant eyes stay. Calm softens the shakes.
- Fight twists (`src/fishing/deeptwist.js`, `makeTwist(B)` in the Battle constructor; never for bosses, crates or the
  lesson): `fight.twist` or `TWIST_OF` for older deep fish. Battle reads `grip` (multiplies the spin), `reactK`,
  `springK`, `twistPull`, `twistAmp`, `twistSpeed`, `twistJit`, `teleK`, `lungeDurK`, `zoneW` (from `zoneW0`) and calls
  `twist.update / onLunge / onHit / onHookset`; meter.js `drawTwist` draws the overlays and a 3D voxel word. slime
  (hagfish: a slime cloud at the hook set, a slippery marker, slime bursts weaken the grip, drips on the pin), blink
  (firefly squid, cockeye, vampire squid: the zone goes dark with blue sparkles), frenzy (Humboldt: rapid lunges with
  short warnings, the marker flashes red), wrap (giant / colossal / bigfin squid: voxel tentacles creep in and squeeze
  the zone to 60 %, a GOOD / CRITICAL shock breaks free), dazzle (Dana squid, matriarch, anglers: lights build, a white
  flash, then the reel barely bites), ambush (bobbit, lizardfish, frilled and goblin sharks: a lunge right at the
  start, quicker lunges), alarm (atolla: red / blue lamps blink at the meter ends while the pull goes wild), waddle
  (sea pig: a steppy comic pull), vanta (blackdragon, dragonfish: the marker turns ultra-black, only a pink chin light
  shows), thrash (lancetfish: big jitter), bite (sabertooth, viperfish, loosejaw, fangtooth: each lunge takes 2.5 %
  off the catch bar), reverse (Lasiognathus: it reels YOU in for 1.5 s, stop spinning), dive (cusk eel, sixgill: a
  long heavy pull). Timed twists wait for shock beats and stuns.

## Cel (toon) shading for all 3D / voxel art [cel29]
User direction: "the 3D stuff more cel-shaded and the shading very good".
- One model in every renderer: a single top-left key light; light is quantised into clean bands, LIT (warm, lifted
  toward white), MID (the painted colour), SHADOW (cooler / purpler, hue-shifted rather than greyed) and a DEEP core
  (undersides, deep creases), with a cool ambient floor so darks never go muddy. Glossy materials get a small
  hard-edged specular shape (size follows the material's shine / specPow); the silhouette edge turned away from the
  key light gets a thin rim band. Emissive / glow parts stay unshaded and bright; ink outlines are unchanged.
- Tuning: `src/gfx/toon.js` `TOON` is the only place to adjust the look (band thresholds for the CPU renderer
  `TOON.vox`, the GPU `TOON.gl` and the intro `TOON.intro`; shadow / deep / lit hue shifts and lightness; rim colour,
  strength and width; specular cut / size; jitter / AO damping; voxel-mesh normal smoothing). `toonRamp7(hex)` builds
  the CPU band colours (same 7 indices as `ramp7`: 0 core, 1 deep, 2 shadow, 3 mid, 4 lit, 5 highlight, 6 specular;
  authored `ramp` palettes are used as they are). `setShading('cel' | 'classic')` / `celOn()` is the global mode;
  every renderer also takes a per-call `cel` option (`cel: false` = classic for that render).
- CPU voxel ray renderer (`voxel.js renderVoxels`): with cel on, tones map to bands instead of the 7-step rounding
  (thresholds on its tone scale: deep 1.3 / shadow 2.62 / lit 3.62 / highlight 4.9; edge highlights still bump a band);
  per-voxel jitter x0.4; smoothed materials are smoothed a little more (`smoothAdd`) so band contours do not flip on
  voxel steps; spec glints above `specCut` become the hard specular band (index 6); a `despeckle` pass gives a lone
  pixel the band of 3+ agreeing neighbours on the same surface (its palette colour stays: painted texture is kept);
  `rimPass` (scale >= 1.5, `rim` option) lights a 1 px band inside the silhouette on right edges and shadowed bottom
  edges (features >= 3 px wide), the lit tone mixed toward `TOON.rimColor`. Runs before `keepVoxel` cuts, so layered
  renders get no seams. Covers props, buildings, tank decor, world scenery / islands / reefs, the Lab backdrop, the
  wardrobe room, cutscene props, the player / NPCs, voxel gear and items, and `text3d` sprites.
- WebGL2 sprites / scenes (`lowpoly.js` FS; fish, creatures, the grouper, the 3D tank): half-lambert bands
  (deep 0.28 / shadow 0.6 / lit 0.86) smoothstepped over a fixed ~1 px width (`TOON.gl.soft`; no `fwidth`, which is
  costly on software GL) so they are crisp but never stair-step;
  tints from `TOON.gl`; the material's `ambient` lifts its shadow tint, `soft` (the plush grouper) warms the shadows
  and adds a warm terminator band, `vivid` keeps its saturation lift; env reflections are damped to `TOON.gl.env` on
  opaque parts (glass / translucent parts keep 85 %), iridescence is kept. Voxel meshes from `voxelize.js` now carry
  a smoothed surface normal per face (radius-2 kernel over the solid map, octahedral-encoded in the unused uv slots;
  `VoxMesh.voxN`, meta stride 10 bytes) and are lit with 78 % smoothed / 22 % face normal, so bands follow the body's
  form while voxel steps still read; specular and rim use the smoothed normal. The glow-mask pass of the fish sheets
  passes `cel: false`. The Canvas2D software fallback applies the same bands / tints per face.
- WebGL intro (`voxgl.js` VOX_FS): half-lambert x AO quantised with the same tints (`TOON.intro` thresholds) plus a
  hard glint on glossy voxels; post effects unchanged. Pixel-art 2D icons are untouched.
- Settings > Cel (`state.settings.celShading`, default on; tip "Shading: Cel / Classic"): sprites are baked once, so
  the switch saves and reloads the page; Game sets the mode right after loading the save (before any bake). The
  switches squeeze their rows (smaller icons) when the card is too short for the 4th row. Dev pages accept
  `?shading=classic` for A/B screenshots.
- Cost: the CPU pass adds a despeckle + rim scan (O(pixels), well under the ray cast: all props page 1.55 s classic vs
  1.57 s cel, within noise); voxelisation adds the 56-cell normal kernel per surface voxel (~+0.5 ms per fish pose,
  normal encoded once per voxel), i.e. ~+10-15 % on a fish sheet build, still spread over frames by [perf27]'s
  sheetStep budget; the sprite shader adds a few smoothsteps (no fwidth). tools/perf.mjs frame numbers are unchanged
  within its run-to-run noise.

## Wallet plaque + header wallets, hand-drawn pixel leaves [wallet32]
User direction: "Make the currency UI a lot better like before, this is too ugly, and the leaves like 2D pixel art
detailed". Supersedes the [cur26] wallet drawing and the voxel / rotated leaf ornaments.
- Wallet (`src/ui/gemui.js`, `drawWalletPlaque(ctx, ui, {right, y, p, mini, hov, id})`; `UI.drawWallet` in ui.js only
  places it): a hand-crafted pixel plaque on ONE art-pixel grid. The static part (`plaqueArt`, cached per digit-field
  width) is an art-px canvas: hard drop-shadow row, ink silhouette with [2,1] stepped corners, a 2 px BRASS rim (lit
  top-left, shaded bottom-right, top glints), a dark line around the glass, a blue sea-glass half (Aero Bucks) and a
  violet crystal half (Byte Gems) with banded fills, dithered seams, a broken highlight stroke and ripple / facet
  marks, a brass divider, three brass rivets, recessed number wells (1 px notch, dark top row, light bevel). It is
  blitted at `p` logical px per art px with nearest neighbour; `walletP(mode)` = 1 / 1.5 / 2 (normal / big / huge)
  on the 2x UI layer (whole device px) and 1 / 2 / 3 at 1x. Icons are the HAND-DRAWN pixel sprites (`DROP_BIG` 11x15,
  `GEM_BIG` 15x13, `DROP_SMALL` / `GEM_SMALL` for the mini plaque; the voxel models read muddy at this size).
  Digits: per-char art canvases (`glyphArt`: 'big' face, two-tone white / pale tint, hard shadow), in FIXED-WIDTH cells
  so the plaque never jitters while a number ticks up. Specs `WALLET_ART.FULL` (23 art px tall, 'big' digits) and
  `.MINI` (18 tall, 'normal' digits, 1 px rim).
- Motion (all whole art px, nothing scaled): coins tick up (`ui.coinShown`), gems tick one by one (`ui.gemShown`);
  every digit that changes hops 2 art px (1 on the mini) and flashes pale gold (`hopState` per plaque id, decayed by
  `walletTick`); on `coinBump` the droplet hops and 7 pixel droplets arc up out of it (`walletSplash`); on `gemBump`
  the gem hops, a diagonal shine sweeps its facets (also idly every few s), a `+` twinkle and `drawGemShards` chips;
  idle: a bubble pixel rises in the water glass, a facet glint blinks, the droplet bobs 1 px and drips under the plaque
  now and then. Reduced motion turns the idle bits off. Tooltips per half (`walletTip`).
- Header wallets: `drawHeaderWallet(ctx, ui, right, y)` (the MINI plaque, right-aligned, ~18 logical px tall)
  replaces each window's own pills / chips: Wardrobe, Quests (left of the close pill; Claim all moves left of it),
  The Lab, Workshop, Bait Shop (`ShopPanel.drawWallet`). It records `ui.hdrWallet` ({drop, gem, rects, time});
  while one was drawn in the last 0.15 s, or any open window's rect overlaps the HUD plaque, the HUD plaque slides
  up and fades out (`ui.walletHide`), so there is never a second wallet beside / under a window, and
  `coinTarget()` / `gemTarget()` aim coin and gem flights at the header wallet. `ui.coinRect` keeps the HUD plaque's
  rect even while hidden (toasts and the quest tracker slot stack under it as before).
- Leaves (`src/ui/pixleaves.js`): HAND-DRAWN 2D pixel leaves (1 char = 1 art px = 1 logical px, `.hi` twin = the same
  art scaled by nearest neighbour). Art: `ART` = 3 sizes (X 28 px, L 20 px, S 14 px long) x 8 drawn angles (15, 40,
  65, 115, 140, 165, 200, 340 deg, counter-clockwise), each shaded for top-left light: 1 px dark outline, 5 hue-shifted
  greens (teal shadow -> yellow-lime light), pale midrib, shade-half veins, gloss streak + white glint on the lit half,
  a dew drop (white / aqua / teal) on the X and L leaves; tones `leaf` / `lime` / `deep` are palette swaps. Nothing is
  rotated or stretched (`drawPixLeaf` picks the nearest drawn angle and an integer scale). Clusters (`leafCluster`,
  `drawLeafCluster`): a 2 px twig with 3-5 leaves per corner ('tr' / 'tl' spill up and out, 'br' / 'bl' spill
  sideways and a little up), sizes 'L' (X + L leaves) / 'S' (L + S), 3 hand-placed sway frames (rest, lean, lean
  more; ping-pong ~2.6 s, still with `still`). The old APIs route there: `drawAeroLeaf` (one leaf), `drawLeafSprig`
  (a twig rooted at x, y; also `(ctx, x, y, corner, 'L'|'S', px, {t, phase})`), `drawVoxDecor('leaves' | 'leaves_l')`
  (centred twig). Placements: window frames (`drawAeroFrame`: rooted on the top-right corner, spilling up and out,
  clear of the close button; skipped near the HUD corner as before), both hotbar ends (rooted just outside the dock),
  the gear pod, quest chapter cards, fish manager, Lab corners, the Bait Shop awning. The old procedural `leafTex` /
  `sprigTex` are gone.
- Tooling: the leaf art was generated once with a scratch script (almond profile + shading rules at fixed angles) and
  then frozen as strings; edit the strings directly.

## Pixel-art UI chrome, no rounded shapes [pixui30]
User direction: "UI all is 100 percent pixel art, no round" and "no ugly UI". Supersedes the glossy-glass / voxel-slab
chrome of [phase8:ui] / [phase9:ui] / [phase10:ui] (icons, voxel ornaments and 3D pop-up text are unchanged).
- Central rasteriser (`src/ui/aero.js` `pixelSurface`, behind the unchanged `aeroSurface` / `drawAeroSurface` /
  `drawAeroPanel` / `drawAeroButton` / `drawAeroCard` / `drawAeroFrame` APIs): STEPPED corners (`notchOf(r, w, h)`:
  r <= 0 square, <= 2 -> 1 px notch, <= 9 -> [2,1], larger -> [3,2,1]; `'pill'` by height: < 10 -> 1, < 24 -> 2,
  else 3; `NOTCHES`), a crisp 1 px DARK outline (a white / pale `edge` is turned into a deep shade of the body unless
  `lightEdge: true`), a 1 px light bevel top-left / shade bottom-right (`inset` flips it and drops a shadow row under the
  top edge), flat colour bands: a two-tone sheen band (`gloss`, `glossH`), 1-4 body bands top -> mid -> bot with one
  checker-dithered row at each seam, a glow band along the bottom (`glow`), optional diagonal pixel streaks, pixel
  twinkles (`bubbles`), a pixel star (`sparkle`), a frame-only `ring: n` (2n px band, transparent hole, inner edge
  bevelled like a raised frame) and `depth` (darker lip rows). Everything is drawn at the LOGICAL resolution; the `.hi`
  twin for the 2x UI layer is the same art scaled by nearest neighbour (`pixelArt(canvas)`), so chrome pixels match the
  pixel fonts at 1280x720 and 1920x1080. `curve`, `smooth`, `voxel`, `block` are accepted and ignored.
- Shared widgets converted centrally: buttons (`r: 'pill'` -> [2,1] notches, 1 px hover ring, solid 2 px base),
  `drawAeroBar` (recessed 1 px-notch track, flat fill with a light top row / shade rows / glint dashes, square ends,
  dark leading-edge pixel, segment ticks), `drawGlossOrb` / `pixelOrbCanvas` (stepped OCTAGON knob, no circle; the
  voxel 'orb:' decor is no longer used), `drawAeroBadge` (small stepped square), `drawAeroLabel` / tooltips / tabs /
  title plaques / toasts (plates no longer squash; the toast text has no dark glow), `drawAeroGlow` (three flat-alpha
  stepped-octagon bands with ordered dithering, alpha quantised to 1/8; no radial falloff), `drawSparkle` (logical
  pixels on the 2x layer too), `drawTitle` (cached composite is pixel art: square 8-way outline, hard drop, flat top
  highlight; no round outline / hairline), `ecoBackdrop` (window wallpaper: banded sky, pixel clouds, stepped grass
  terraces, plus marks; no sun bloom, no round bubbles), `drawAeroFrame` (hard stepped drop shadow, 8 px pixel frame
  ring, plaque), panels.js slider (stepped 9x13 thumb with grip lines), toggle (square knob), speech bubbles ([3,2,1]
  max notch, square thought puffs). Panels open / close by sliding whole pixels (no scaling) in `UI.drawPanels` /
  `drawGhosts`.
- PIXEL KIT (exported from aero.js, documented at the bottom of the file; use these for new UI, e.g. the fishing HUD):
  `pixelPanel(ctx, x, y, w, h, {tone, r, shadow, inset, gloss, glow, title})`, `pixelButton` (= drawAeroButton),
  `pixelBar` (= drawAeroBar), `pixelBadge` (= drawAeroBadge), `pixelChip(ctx, x, y, w, h, {tone, r, inset})`,
  `pixelRectPath(ctx, x, y, w, h, r)` (a stepped path for fill / clip / stroke; pass x + 0.5, w - 1 for crisp 1 px
  strokes), `pixelRect(ctx, x, y, w, h, r, fill, {outline, hi, lo})`, `pixelHalo(ctx, x, y, w, h, n, color, alpha)`,
  `pixelShadow(ctx, x, y, w, h, dx, dy, {n, alpha, color})`, `pixelGradient(ctx, x0, y0, x1, y1, [[t, color]...], bands)`
  (a BANDED linear gradient: hard colour stops, accepts '#hex' and 'rgba()'), `pixelGlassPlate(ctx, cx, cy, size,
  {tint, rim})` (stepped-octagon glass plate for items 'in a bubble'), `notchOf`, `NOTCHES`, `pixelArt`.
- Shared paths: `roundRectPath` (labart.js), `roundRect` (game/dialogue.js) and `rrect` (store/aerokit.js) now build
  stepped pixel paths, so every clip / fill that used them is stepped.
- Call sites converted: the dialogue panel / speech bubble / response choices (pixel plates, stepped portrait well,
  pixel triangle arrow and stepped tail, no scaling pops), Quest Log (stepped portrait wells, emblem plate, square mini
  bars, stepped lock plate), Lab (emblem plate, tree-node orbs = pixel octagons, giver wells, labkit glass cards / cost
  tiles / chips / stat bars / pedestal, labviews tiles + check marks, research widget = stepped plate + square bar, no
  sparkle ring), Bait Shop / Bait panel / Satchel bait (`drawBaitGloss(..., {bubble: false})` on a `pixelGlassPlate`;
  stepped awning scallops), aerokit pills / glass cards / tags / toggles / stat bars / sale sticker (stepped square, no
  star rays or rotation) / orb close X, ecoart sky / globe / splash buttons (no curved splash), catch card (stepped clip,
  banded sky), crate-open stage and build diorama (banded), letterbox bars (banded), tutorial crank glyph (stepped
  track), Settings (no glow halo), the World Map sky (no arc rings), multiplayer emote bubble, the overlay card.
- Left as is (not UI chrome): in-world art (fish, water bubbles, particles, voxel scenery, the Lab fog-of-war light
  pools, wardrobe room floor, map sun), icons (owned by the icon agent: bigicons / icons3d / iconvox / voxicon /
  labicons / itemart, the labrows vector padlocks / chains, the labtree padlock sprite), the fishing HUD (src/fishing/*,
  owned by the fishing agent: it can switch to the PIXEL KIT), voxel ornaments on the window frames (the LEAVES are
  hand-drawn pixel sprites since [wallet32]), and
  the 3D voxel pop-up text. Sub-pixel (0.5 logical) stamps in the Lab tree land on whole device pixels on the 2x layer.

## Fishing HUD as ocean pixel art + real struggle effects [fishui30]
User direction: "make the fishing UI a lot better - show like water and seaweed effect, bubbles and real struggle splashes
etc, no ugly UI, UI all is 100 percent pixel art, no round". Gameplay, balance and the lesson are unchanged (pure
presentation; `partRect` / `meterRect` / `meterLayout` keep their contract, the shock button's hit box is now square).
- Kit (`src/fishing/pixui.js`): `pxFrame` (stepped corners, 1 px ink, flat banded fill, lit top-left / shaded
  bottom-right bevel, a few fillRects, no cache), `pxHalo` (a stepped square halo replacing round glow sprites),
  `pxDiamond` (pips / rarity), `pxCaret` (stepped pointer), `pxStripes` (hazard stripes), `PAL` (ink, steel rim, navy
  bands, water / calm / coral / amber / gold / steel / lime / kelp ramps), `unitOf(S)`. Square only: no arcs, circles
  or gradients. (The UI-chrome kit in aero.js [pixui30] is the same rules for windows; the fishing console keeps its own
  water palette.)
- Meter (`meter.js`): one stepped steel console holds the meter and the catch tube. The meter is a strip of pixel
  WATER: banded depth with dithered seams, a sandy floor with tick marks, the calm teal sweet zone between bracket posts
  (twinkles + a light wash while you hold it, gold on a beat), coral / amber dithered danger ends (cached per zone
  width), scrolling caustic dashes and surface crests (two periodic strips, one blit each, parallax), kelp fronds at
  both ends (8 cached sway frames, faster with the commotion), 9 deterministic rising bubbles. The marker is the fish's
  voxel icon swimming IN the strip (4 sheared slices = a tail wiggle, faster on lunges / stuns), hanging on a 1 px line
  from a caret on the console, leaving foam dashes + bubbles as a wake when it moves; crates ride as themselves. Lunge
  chevrons run through the water; the beat notch is a gold glass pillar; twists [deep28] use square lamps / halos.
  Catch tube: calm water filling a glass tube with a sloshing meniscus, bubbles, a red ghost of lost progress, the %
  in crisp pixel text riding the head. SHOCK button: an octagon (stepped diagonals) with a steel bezel, a banded gold
  face and a bronze side (depth / press), the gold RISING inside it while it recharges (sloshing top line), diamond
  charge pips, a MK plaque, a pixel SPACE keycap. 3D voxel words (NOW!, SPIN!, LOCKED, ...) stay.
- HUD (`hud.js`): the name banner is a stepped plaque (rarity tab, the name in pixel text, rarity caps + diamonds, a
  square GIANT / kg badge); the bite cue is a square gold-rimmed navy sign with a 3D "!", an 8-segment draining window,
  a stepped tail at the fish, a square halo, 3D mouse + CLICK!; the screen-wide radial vignette is gone and stun / beat
  / strain tints are three flat stepped bands at the edges. Gear (`gear.js`): the voxel housing is an OCTAGON (octagon
  norm `oct`, lamps / rivets placed with `octPt`, square lamp blocks); the controls plaque uses `pxFrame`; the gear
  itself is unchanged. MAX LINE (`fishing.js drawMaxLineHud`): a coral sign board with hazard stripes and a stepped
  pointer up to the hook. Depth gauge (`ocean.js drawDepthHud`): stepped frame, flat two-band zones with dithered
  seams, bracket marks for the camera window, a pixel depth tag with a stepped pointer. Title banners use `pxHalo`.
- World struggle (`src/fishing/fightfx.js`, `Fishing.ffx`): pooled particles in typed arrays (POOL 560: drop, mist,
  bubble, foam, ripple, churn, streak, spark, frond, sand, glint; a short ring-cursor scan, the oldest recycled) plus
  fixed pools of splash CROWNS (24) and underwater WASHES (16) drawn from cached 6-frame pixel sprite sheets (crowns:
  centre jet, two curling sheets with beads, a foam skirt, 4 sizes; washes: lumpy whitewater blown out behind the
  tail, 3 sizes). Drawn in screen space through the world transform (whole screen pixels at any zoom), constant colour
  strings + globalAlpha, no per-frame allocation besides getTransform. `fight(B, dt)` (after Battle.update) times
  THRASH beats to the pull (wander, jitter): a wash + bubbles + streaks at the tail, and near the surface a crown,
  droplets with trails, mist, foam riding the live waterline (`water.levelAt`), short pixel ripple lines (`_-^-_`)
  running out along the surface and a water-sim impulse (no `sim.ring`, so no expanding rings); bubbles stream from the
  mouth with the pull; the line slices the surface with spray; lunges (`lunge`) are a bigger burst; shocks (`shock`)
  crackle zig-zag sparks through the water (re-jagged every 2 frames), electrify bubbles and skitter along the surface;
  stuns crackle; kelp stalks are planted on the seabed round the fish when the floor is near (re-planted if the fight
  drifts) and sway / lean away with the `commotion`, torn fronds drift off. Flavours: crates SLOSH (alternating side
  splashes, glugging seams), a mimic's CHOMP sprays a fan, a legs crate kicks bubbles (sand near the floor), bosses
  scale up and a phase change erupts. Intensity `I` from rarity tier, power, weight, boss; size from `fishLen`.
  The landing: `Finale` 'erupt' calls `ffx.leap(x, surface, power)` (crowns x3, a droplet ring, mist, foam, ripples,
  bubbles, the surface heaves) instead of the ring-making eruption; the haul to the surface thrashes (`surfaceThrash`);
  `CratePop` leaps too; the hook-set calls `ffx.hookset`. The rod tip FLEXES toward the fish with the strain
  (`flexTip`, `drawRodFlex`: a short graphite curve from the model's tip; the line leaves the bent tip) and the line
  buzz grows with the strain (`lineBuzz`) with a faint afterimage.
- Camera (presentation only): when the surface is near, the fight camera eases up so the waterline sits just under the
  letterbox while the fish stays clear of the meter, so the splashes are seen.
- Perf (`tools/perf.mjs --only fight`, headless software raster, A/B against the same tree with the old fishing files):
  old 29.7 / 33.0 fps (cpu 47 / 42 ms per frame), new 38.8 / 36.3 fps (cpu 35 / 38 ms): no cost (the dropped full-screen
  radial vignette and soft glow sprites pay for the effects).
- [nuke31] User direction: "the skill button make it like a physical button like nuke button etc, and the bar make it
  like the ocean a lot a lot more, polish". Supersedes the octagon SHOCK button and the water-strip meter above
  (gameplay, `partRect` / `meterRect` / `meterLayout` / `hitShockButton` and the square hit box are unchanged; the meter
  is 42 px tall at S = 1 (was 32) and the console sits 4 px higher, same footprint otherwise).
  - SHOCK button (`src/fishing/nukebtn.js`): a physical "big red button" launch console built as VOXEL models and rendered
    by `renderVoxels` (cel bands, AO, edges, ink outline) at 1x and with a `.hi` twin for the 2x UI layer, yaw 0 /
    pitch 24: a gunmetal housing on a plinth (deck bevels, hex bolts, an octagonal collar whose top ring is yellow /
    black hazard striped, a dark well, hazard-striped front corners, a recessed steel plate on the front with SHOCK + MK
    level engraved in pixel text and an 8-segment charge gauge, a lamp strip on the front lip = one square lamp per
    charge (the next one fills as it recharges), a warning beacon on the front-right corner, hinge brackets + barrel at
    the back), the big glossy red DOME (round, lightning emblem, hard highlight; variants by palette swap: dim while
    charging / backfire, red, lit for hover / ready pulse / beat, white on a critical) and a hinged SAFETY COVER (glass
    panels in a yellow / black striped frame, re-voxelised at 7 hinge angles 0..104 degrees). The housing is ONE render
    split into a back layer and a front layer (front voxels use twin palette entries, so the render's ids say which
    layer a pixel is in); every model carries two invisible corner voxels (cut by `keepVoxel`) so all renders share one
    camera and line up to the pixel. Draw order: shadow, cover (when open: behind), housing back, cap (shifted down by
    whole pixels = it really travels into the collar; 1-frame squash on bottoming out), housing front, overlays (plate
    text, gauge, lamps, beacon), cover (when closed: in front, the cap seen through the glass), the SPACE keycap.
    Physics (`updateNukeButton(F, B, dt, {fire, hit, L})`, called by `Fishing.updateFight` before the press resolves):
    any shock press pushes the cap (stiff spring, ~3 frames down, held while Space / the mouse stays down on it), a clunk
    on bottoming out (`chest_hit` + `wood_hit`), a pop on release (`ui_toggle`), a click on the press; hover lifts it a
    pixel (`ui_hover`) and rattles a shut cover; the cover snaps open with an overshoot when a charge is ready (latch:
    `chest_hit` + `ui_toggle`) and swings shut (`box_close`) 0.75 s after the last one is spent; ready = the beacon
    blinks and the cap pulses; a CRITICAL press (`onShockFire` 'perfect' -> `nukeCrit`) flashes the cap white and throws
    sparks off both housing corners. Builds: ~15 ms per voxel render (1x + 2x), 13 renders, one per ~45 ms in
    `warmNukeButton` while waiting for a bite (missing cover frames fall back to the nearest built one).
  - Meter (`meter.js` + baked layers in `src/fishing/oceanstrip.js`, painted once per size at cell resolution):
    a riveted steel porthole console (stepped corners, bevels, rivets, corner screws, hazard-stripe inserts, a recessed
    window and tube recess with metal end collars); the strip is an ocean cross-section: sky with flat pixel clouds, a
    rolling surface (a hazy back swell and the front wave with foam caps on the crests, two periodic strips scrolled in
    opposite directions) with glints and the line's foam dimple, 7 banded depth colours with dithered seams, far / mid
    reef silhouettes, a caustic light net (8 Voronoi-edge frames, also dappling the sand), rippled sand with pebbles,
    shells, coral bits and starfish, rocks with moss under giant kelp at both ends (green left, golden right; 8 sway
    frames), sea grass / little plants (4 frames), background fish silhouettes drifting both ways, 3 bubble columns,
    plankton motes. The zone: clearer calm teal water with dithered edges, a shimmering dithered glow band while held
    (gold on a beat), BUOYS on the zone edges bobbing on the live wave height, chained to anchor blocks on the sand; the
    left end is choppy coral water (whitecaps, spray beads, tumbling foam dashes, more as the marker nears), the right
    end dark churned amber water (swirling sediment). Shield = a steel grate. The marker fish wiggles its tail and tilts
    with its velocity (6 sheared slices), leaves a pooled bubble wake (typed array, 24 bubbles), hangs on the line from
    the console's top rail through the surface to its mouth. Catch tube: ocean water (banded aqua -> blue) with a rolling
    top surface (one periodic blit), a curling foam head, bubbles, the red ghost, the %.
    Per frame: one `bed` blit (base + zone water + plant frame, composited per zone width), caustics, two wave strips,
    the glow, kelp x2, ~8 small sprites and ~150 fillRects; `warmMeter(F)` bakes one layer per idle frame before a bite.
    Twist overlays [deep28] draw on top as before (the blink's dark zone now stays inside the porthole).
  - Perf: tools/perf.mjs --only fight is within its run-to-run noise (base 26.5 / 40.5 fps, new 37.3 / 39.5 fps on the
    same machine); a direct bench of `drawCinematicHudInner` (the whole fight HUD, 100 draws) is 2.1-3.7 ms (old) vs
    2.6-3.8 ms (new) per draw on the 2x layer.

## QA polish pass [polish32]
User direction: "make game polish". Presentation only (no gameplay / balance / save changes).
- Toasts (`ui.js`): a repeated message while it is still up counts up ("... x2") with a nudge instead of stacking a
  duplicate plate; long messages get a wider plate (up to 3 lines, no mid-sentence cut); beside an open window only as
  many toasts show as fit (the rest wait with their clock held; none over the catch card when there is no room); in the
  tank they sit left of the dock column. `ui.toastBottom` (eased) = where the top-right stack ends.
- HUD quest tracker (`hud.questSlot`): slides down under the toast stack, eases left of the depth gauge while diving,
  and steps aside while the tank's Feed tray / Gear panel / build mode are open.
- Square pixel chrome leftovers: `drawGlassPill` (catch card chips, box-reel label) is a stepped pixel pill; the gear
  with no battle (sliding in / out, a boss intro) draws the voxel housing, not the old round RPM gauge + pill.
- Readability: Lab tab labels share one face; chapter reward chips show amounts; light label text always gets its
  shadow (grey COMMON labels); Workshop rarity tag has a dark rim; FishDex shows two lines of description; cutscene
  name plates are deeper with an outlined name; the multiplayer lock veil blocks hover tips / clicks under it.
- Tutorial: target brackets hug the target rect (were a square sized by its longest side); progress dots hidden in the
  tank view (they sat on the build toolbar); the NEW BUTTON words bow out when a window opens over them.
- Spinning fish thumbnails (Satchel) snap through edge-on instead of vanishing for a second.
- Text: "Need more Aero Bucks...", the chapter 1 cutscene line says Nano Tank (was "goldfish jar").

