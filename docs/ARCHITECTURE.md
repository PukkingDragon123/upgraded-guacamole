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
- **Currency** is **Aero** (`CURRENCY` in `src/ui/aero.js`). `state.coins` still holds the amount; every
  label/icon says Aero and uses `drawAeroCoin`/`fmtAero`. "Oxidized Coins" is gone.
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
  Fishing reels a box in and calls `game.onBoxCaught(f)`; loot from `src/build/items.js` (`rollCrate(tier, biome, luck)` -> `{aero, items:[{id, qty}]}`, `grantLoot`).
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
  [quests16] + `src/game/questdata.js`: 107 side stories (`chapter.side`, optional, open with their chapter or `after`
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
  smooth meshes. Bubbles (`src/gfx/seal.js`) is the original voxel plush seal (round dappled loaf, small dark eyes drawn at voxel
  resolution, round glasses, black ink outline) with a soft-body jiggle (squash spring + row ripple) in `drawSeal`; same
  anims / `drawNPC(ctx, 'seal', ...)`; extra pose names used by newer callers map through `SEAL_ALIAS`.
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
  worm on a hook, two round ball seal pups, settings cogs, hammer + wrench, Aero drop; same aliases as ICON_MODELS), `UI3D_VOX`
  (the same models for icons3d names: beaker, book, globe, shop, hammer, scroll, coin / aero ...), `ROD_VOX(rod)` (cork
  grip, reel seat, spinning reel with line, wrapped guides, tip, bobber; trident / glow kinds). Defs: `{vm, vmOver?,
  vmGlass?, yaw, pitch, spin}` (layers share dimensions; y up, z toward the viewer). Mesh models without a hand-built twin
  (iconmeshes / icons3d / fishing icons3d / decor / gems) are voxelised automatically at the same density.
- Views / spins: a 3/4 view (yaw ~0.42..0.66 rad, pitch 0.3..0.52; < 52 device px a flatter front view); `full` spins
  step through 12 baked angles, `wobble` through 5; z-axis spins re-voxelise per roll. Frames are cached per (key, px,
  angle); new frames are built within ~7 ms per frame (`voxMisses()` counts deferred builds for callers that cache);
  `iconFrame` / `getBigIcon` / `rodIcon` / `gemIcon` build their `.hi` twin lazily (~5 ms a frame), `modelFrame` eagerly.
  Item VoxelModels keep their authored yaw / pitch (`voxelModelFrame(key, () => ({m, yaw, pitch}))`).
- Dev preview: `node tools/build.mjs --dev icongallery` (`?page=0` menu icons at 44 / 32 / 22 px + rods, gems, decor;
  `1` icons3d; `2` items + fishing icons; `3` Lab icons; `&spin=1` turns them, `&bench=1` -> `window.__bench` ms per frame).
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
  floaters and peer boats treat it as open water; input, HUD, quests, boss and the seal guide stay blocked for the whole trip.
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
