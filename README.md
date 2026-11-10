# FISHTOP

FISHTOP is a zoomed-in, skill-based Frutiger Aero fishing game built entirely from voxels. You play as a bubble
person in a little boat on a glossy, sunlit sea:
- Cast with the mouse.
- Crank a big glossy reel.
- Zap fish with your rod's shock.
- Fight surges by pulling against them.

Then fill your side-scrolling voxel tank with fish that earn Aero, and research better rods, boats, tanks and
seven oceans in The Lab.

All art (voxel world, fish, characters and rooms), all music and all sound effects are generated in code. The
one asset is the Alagard pixel font by Hewett Tsoi (`assets/fonts/alagard.ttf`, embedded in the build) used for
titles, dialogue and 3D text. Common sound effects (splashes, bubbles, clicks, chests) are CC0 recordings from OpenGameArt.org,
including Kenney's UI set (see `assets/sfx/CREDITS.md`); everything else is synthesized. Multiplayer is opt-in, and the game is fully playable offline.

## Play

| How | Command |
| --- | --- |
| In a browser | open `dist/index.html`, or `npm run serve` and visit http://localhost:5173 |
| As a desktop game window (Electron) | `npm install` then `npm run desktop` (window or fullscreen; see [docs/DESKTOP.md](docs/DESKTOP.md)) |

To build from source, run `npm install && npm run build`, which bundles `src/` into `dist/fishtop.js` with esbuild.

### Controls

- **Menu**: the big glossy hotbar at the bottom opens:
  - The Lab
  - Quests
  - Aquarium
  - FishDex
  - Satchel
  - Wardrobe
  - Map
  - Bait Shop
  - Bait
  - Multiplayer
  - Settings

  Settings has a Normal / Big / Huge UI size.
- **Bait**: buy bait packs from Bubbles the seal at the **Bait Shop** with Aero. Each bait is used up when a fish bites.
- **Fishing**: click the water to cast. Then:
  - **Hook**: when a fish bites, circle your mouse to spin the big 3D gear into the green band before time
    runs out. Too slow and it escapes; past the red line and the line rips.
  - **Reel**: keep the gear's RPM needle in the drifting green band. Surges push it up; fakes drop it.
  - **Shock**: hold the mouse button (or Space or right-click) to charge, and let go in the PERFECT window to
    stun the fish. Overcharging fizzles or backfires.
  - **Surge**: when the fish bolts, hold and drag against the pull.
- **Depth**: each ocean drops through sunlit, twilight, midnight and abyss zones. Use `Home`/`End`,
  `PageUp`/`PageDown` or the wheel to dive; a depth meter shows your zone. The camera follows your hook and
  catch; Ctrl/Alt + wheel or `+`/`-` changes the zoom.
- **Aquarium**: a 2D side-scrolling voxel tank, like the ocean. Drag, use the wheel, `A`/`D` or the arrow keys,
  or push the mouse to the edge to scroll. Press **Build** to place decor and buildings: building happens only
  inside the tank (`Q`/`E` rotate, `F` flips, `Delete` removes, `Esc` leaves build mode).
- **Keys**:
  - **Panels**: `L` The Lab, `Q` quests, `J` FishDex, `I` Satchel, `W` Wardrobe, `T` map, `B` bait,
    `S` Bait Shop, `O` multiplayer, `A` aquarium.
  - **Game**: `P` pause, `Esc` settings/close.

### The loop

Catch fish and keep them in your side-scrolling tank, where they earn **Aero** (even while you're away). Follow the
**quest lines**: 7 story chapters told by Bubbles the seal, Professor Fizz, Marina and Captain Bloat.
Each chapter's reward opens the next ocean. Research in **The Lab**, a zoomed-in tree that grows out from the middle. Nodes you can't reach yet stay
black. Sail to the **Workshop** to craft rods, tackle, bait, decor, boat parts and tank gear, and crack open chests
with a minigame.

### Progression

- **Prices climb steeply.** Lab research costs about 2.5-4 times more per tier:
  - The first upgrades take a catch or two.
  - A mid-game rod, boat or tank takes 10-25 minutes of fishing.
  - The top tier takes about an hour and a Golden Scale.
  - New rods, boats and tanks cost 1.5 times a tier's price. Workshop rods, tackle, rod tuning, boat parts, tank gear
    and buildings climb the same way.
- **Later oceans pay more.** Fish from each new ocean are worth more Aero: from 1x in the (OS)cean up to 4.2x in
  The Deep Ocean. This covers the catch bonus, the release value and tank income.
- **Bosses gate the top tiers.** Lab research from tier 6 up needs a boss trophy:
  - Tier 6: the Frosty Fjord boss.
  - Tier 7: the Junkyard Reef boss.
  - Tier 8: the Sunken Metropolis boss.
  - Tier 9: the Lava Rift boss.
  Finishing that boss's chapter also counts.
- **Every upgrade is noticeable.**
  - Each tank tier adds room, a bigger Aero rate and a longer offline cap.
  - Each boat adds bait slots, reel speed, Aero magnet range and rare-fish luck, up to the Submarine.
  - Each ocean pays more.
- **A next goal is always shown.** It is the next rod, tank or boat (each chapter's reward opens the next ocean):
  - Each chapter has a quest for the next rod.
  - The Lab marks the goal with a green tag.
  - The Lab's centre card names the goal and what it still needs.
  - Bubbles' tips name it too.
  - A toast pops up when you can afford it.
- **Old saves keep everything.** Anything already researched, crafted or bought stays yours. The new prices only
  apply to what is still ahead.

## What's inside

- **The opening** is a fully 3D, interactive voxel cinematic with real camera moves, bloom, depth of field,
  lens flares and splashes on the lens.
  - The camera crash-zooms in at key moments, and floating 3D voxel text appears in the Alagard font.
  - You answer with reply bubbles (click or press 1/2/3): pick your name, your boat paint and your first bait.
  - **Bubbles**, a fat, jiggly plush voxel seal, swims around the screen, points at things and guides the opening
    and the tutorial. Afterwards it stays on as a hint helper.
- **Living water**: a wave simulation where casting, bites, jumps, fights, the boat's wake, rain and your mouse all
  make ripples. The boat and boxes float on the waves. A custom water surface and underwater shading add glints,
  foam, light rays and splashes.
- **Seven voxel oceans**, each with a glossy water shader, day and night following your real clock, weather,
  secrets and its own music:
  - **(OS)cean**: a flooded green-hill landscape with wind turbines, a green glass globe and a glass city in a
    water bubble.
  - **Sunny Shallows**
  - **Frosty Fjord**
  - **Junkyard Reef**
  - **Sunken Metropolis**
  - **Lava Rift**
  - **The Deep Ocean**
- **111 realistic voxel fish** plus dolphins, whales, orcas, seals and turtles in high-resolution voxel art, with
  natural eyes, glossy shine and see-through fins. Their names are internet and meme
  puns:
  - Wi-Fish
  - Stonks Salmon
  - Rickroll Rockfish
  - 404 Fish Not Found
  - Touch Grass Grouper
  - Squid Gamer
  - The Algorithm

  Gimmick fish:
  - the Turbine Shark has a spinning rotor
  - the Bubble Pufferfish has a soap-bubble body
  - the Sneakerhead walks in white high-tops
  - the Wakka Fish is a retro chomper that runs a grid eating pellets
  - the Flopikarp evolves in your tank

  Fish also come with mutations, shinies and giants.
- **You are a bubble person**, with 140 cosmetics and a glossy wardrobe.
- **Boats**: seven eco boats with swappable hull, sail, flag, engine and decal.
- **NPCs**: Bubbles the seal, Professor Fizz, Goldie, Pinch, Marina and Captain Bloat.
- **The aquarium**:
  - Six tank tiers, from the Nano Tank to the Mega Tank. Each Lab upgrade makes the tank wider and taller, holds
    more fish and earns more Aero.
  - The tank has front, middle and back voxel layers with plants, rocks and light shafts.
  - You can feed fish, breed them, decorate the tank and build in it.
- **Multiplayer fishing** (opt-in): when the game is opened from its shared claude.ai link, you see other
  players' bubble people and boats in your ocean, their catches and their emotes. Fishing with other people in
  the same ocean gives up to +30% luck. Windows on one computer can also see each other.
- **Procedural audio** in WebAudio: reel clicks, zaps, splashes, creature voices, per-ocean ambience and
  generative music.

## Safety and privacy

- FISHTOP never reads, modifies or uploads your files. Saves stay in your browser's local storage.
- Multiplayer is off until you turn it on. It shares only the display name you choose and your in-game state
  (look, boat, ocean, catches, emotes). Everything received from other players is validated and treated as
  untrusted.
- The optional browser extension in `extension/` reads only element positions, never page text, and sends
  nothing anywhere.

## Development

```
src/core      math, colour, input, audio               src/gfx      fonts, voxel renderer, fish rig, props, particles, character, NPCs
src/world     ocean manager, camera follow, voxel biomes, floating boxes   src/fish     species, AI, spawner, traits
src/fishing   controller, reel, shock, events, catch flow  src/desktop  icon art library only
src/aquarium  tanks, Aero room, drops, decor             src/ui       Aero kit, HUD, panels, Lab
src/game      game loop, camera, save, Lab, rods, tutorial, intro   src/net      opt-in multiplayer
src/store     Bait Shop, bait, custom bait               src/build    buildings, crafting, crates, inventory
```

- `npm test` builds and plays the whole game headlessly in Chromium (Playwright). It covers:
  - skipping the opening
  - buying bait
  - fighting and landing the first fish, then the catch card
  - the jar and collecting Aero
  - starting the first Lab research
  - opening every panel
  - travelling to all seven oceans
  The test fails on any console error.
- `node tools/build.mjs --dev <name>` + `node tools/shot.mjs "dev/<name>.html" out.png` render the art preview
  pages in `src/dev/`.
- Module contracts live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
