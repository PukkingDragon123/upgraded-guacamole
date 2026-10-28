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
`audio.setMuffle(0..1)`, `audio.babble(text, voice)`.

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
