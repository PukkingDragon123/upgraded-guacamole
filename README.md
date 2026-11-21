# FISHTOP

FISHTOP is a zoomed-in, skill-based Frutiger Aero fishing game built entirely from voxels. You play as a bubble
person in a little boat on a glossy, sunlit sea:
- Cast with the mouse.
- Crank a big glossy reel.
- Zap fish with your rod's shock.
- Fight surges by pulling against them.

Then fill your side-scrolling voxel tank with fish that earn Aero, and research better rods, boats, tanks and
seven oceans in The Lab.

All art (voxel world, fish, characters and rooms) is generated in code. The Alagard pixel font by Hewett Tsoi
(`assets/fonts/alagard.ttf`, embedded in the build) is used for titles, dialogue and 3D text. Every sound effect,
loop, ambience bed and music track is recorded audio embedded in the build (only the characters' dialogue voices are
synthesised: retro 8-bit chiptune voices, see below): sound effects, jingles and ambience from CC0 packs on OpenGameArt.org (Kenney, rubberduck
and many others) plus public-domain US National Park Service field recordings (whales, otters, geese, thunder), and
music by Memoraphile, Peachtea, cynicmusic, joth, TAD, umplix and Zane Little Music, all CC0; full list in
`assets/sfx/CREDITS.md`. Multiplayer is opt-in, and the game is fully playable offline.

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
- **Bait**: buy bait packs from Bubbles the toy grouper at the **Bait Shop** with Aero. Each bait is used up when a fish bites.
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
**quest lines**: 7 story chapters told by Bubbles the toy grouper, Professor Fizz, Marina and Captain Bloat.
Each chapter's boss charts the next ocean, and you fund the expedition in The Lab. The Quest Log (`Q`) has three tabs:
- **Story**: each chapter's main quests, plus about 15 optional side stories per chapter. Side stories cover species,
  weather, night fishing, depth zones, bait, flawless fights, the tank, the Workshop and the Lab.
- **Orders**: three new requests from the NPCs every day, with a bonus chest for filling all three. You can swap one
  order a day.
- **Milestones**: lifetime goals in tiers, such as fish caught, FishDex pages, perfect zaps and bosses beaten.

Side stories, orders and milestones are claimed with a **Claim** button. Pin one to the HUD tracker with **Track**.

Research in **The Lab**, a zoomed-in tree that grows out from the middle. Nodes you can't reach yet stay
black. Some key nodes are **sealed by a quest**: they show a padlock, chains and a quest scroll, and their card names the
quest, who gives it and a **Track quest** button. Finishing the quest breaks the seal. Sail to the **Workshop** to craft rods, tackle, bait, decor, boat parts and tank gear, and crack open chests
with a minigame.

### Progression

- **Prices climb steeply.** Lab research costs about 2.5-4 times more per tier:
  - The first upgrades take a catch or two.
  - A mid-game rod, boat or tank takes 10-25 minutes of fishing.
  - The top tier takes about an hour and a Golden Scale.
  - New rods, boats and tanks cost 1.5 times a tier's price. Workshop rods, tackle, rod tuning, boat parts, tank gear
    and buildings climb the same way.
- **New oceans are big, expensive expeditions.** Beating an ocean's boss charts the next ocean. Then you fund the trip in
  The Lab with a lot of Aero, rare materials from the ocean you're leaving and a few of its fish:

  | Ocean | Aero | Also needs |
  | --- | --- | --- |
  | Sunny Shallows | 600 | Turbine Shark beaten, driftwood, shells |
  | Frosty Fjord | 2,000 | Dragon-Karp beaten, sea glass, coral, a pearl, 2 Shallows fish |
  | Junkyard Reef | 5,000 | Ok Boomer Shark beaten, ice shards, pearls, sea glass, 2 Fjord fish |
  | Sunken Metropolis | 12,000 | Blue Screen Ray beaten, spring coils, gears, circuit boards, 3 fish |
  | Lava Rift | 28,000 | Main Character Marlin beaten, magnet stones, circuit boards, pearls, 3 fish |
  | The Deep Ocean | 65,000 | The Final Boss beaten, lava glass, ancient stones, an abyss crystal, 3 fish |

  The chapter's reward pays a big part of it (250 to 24,000 Aero). Fishing the rest takes about 5 minutes for the first
  trip and up to about an hour for The Deep Ocean.
- **Quests unlock research.** 39 Lab nodes need a quest finished as well as Aero and materials. For example:
  - The Glass Rod needs the Dragon-Karp beaten.
  - The Chrome Caster needs Marina's "Rust Bucket" job.
  - The Capacitor needs Fizz's "Spark Joy" zap study.
  - The Skiff needs Marina's Workshop fixed.
  - The Big Tank needs a filter ("Crystal Clear").

  Every sealed node's quest opens before or alongside that node's tier, and `node tools/progcheck.mjs` checks that
  nothing is a dead end.
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
- **A next goal is always shown.** It is the next rod, tank or boat. Once the next ocean is charted, its expedition is the goal:
  - Each chapter has a quest for the next rod.
  - The Lab marks the goal with a green tag.
  - The Lab's centre card names the goal and what it still needs, including the quest that seals it (with Track quest).
  - Bubbles' tips name it too.
  - A toast pops up when you can afford it.
- **Old saves keep everything.** Anything already researched, crafted or bought stays yours. The new prices only
  apply to what is still ahead.

## What's inside

- **The opening** is a fully 3D, interactive voxel cinematic with real camera moves, bloom, depth of field,
  lens flares and splashes on the lens.
  - The camera crash-zooms in at key moments, and floating 3D voxel text appears in the Alagard font.
  - You answer with reply bubbles (click or press 1/2/3): pick your name, your boat paint and your first bait.
  - **Bubbles**, a chunky wind-up talking toy grouper in voxel art (big pouty lips, bulging eyes, a spiny dorsal fin, a
    silver wind-up key and a battery hatch), floats around the screen, flaps its hinged jaw in time with every
    line, points with a fin, puffs up when surprised, spins when happy, droops when sad and now and then swivels its toy
    head round to stare at you. It guides the opening and the tutorial and afterwards stays on as a hint helper.
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
- **NPCs**: Bubbles the toy grouper, Professor Fizz, Goldie, Pinch, Marina and Captain Bloat.
- **The aquarium**:
  - Six tank tiers, from the Nano Tank to the Mega Tank. Each Lab upgrade makes the tank wider and taller, holds
    more fish and earns more Aero.
  - The tank has front, middle and back voxel layers with plants, rocks and light shafts.
  - You can feed fish, breed them, decorate the tank and build in it.
- **Multiplayer fishing** (opt-in): when the game is opened from its shared claude.ai link, you see other
  players' bubble people and boats in your ocean, their catches and their emotes. Fishing with other people in
  the same ocean gives up to +30% luck. Windows on one computer can also see each other.
- **Recorded audio** in WebAudio: CC0 / public-domain clips for every sound effect (variants, pitch jitter, no
  machine-gunning), seamless looping ambience beds per ocean and weather, and a looping CC0 track per ocean
  with crossfades (a procedural synth remains only as a fallback).
- **8-bit voices**: everyone talks in a synthesised retro chiptune voice (pulse waves with duty cycles, triangle,
  LFSR noise for consonants, little arpeggios on punctuation), one voice per character: the goofy, wobbly low guide,
  Professor Fizz's fast high bleeps, Marina's warm mid pulse, Captain Bloat's gruff growl, Dot's bit-crushed robot
  square, the player's bright chirp, the bosses' deep distorted rumble. Settings: Voices 8-bit / Off.

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
- Audio: after changing `assets/sfx` or `assets/music`, run `node tools/gen-samples.mjs` (embeds the OGGs) and
  then `node tests/audio-samples.mjs`, which checks that every sound name used in `src/` has a recording and plays
  them all, plus every loop, music track and ambience scene, headlessly without touching the synth fallback.
  `node tests/voices.mjs` makes every 8-bit character voice talk headlessly (lines, typed letters, arpeggios, the
  Voices: Off switch, channel reuse and release).
- Module contracts live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
