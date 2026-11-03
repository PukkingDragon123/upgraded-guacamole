# FISHTOP

FISHTOP is a zoomed-in, skill-based Frutiger Aero fishing game built entirely from voxels. You play as a bubble
person in a little boat on a glossy, sunlit sea:
- Cast with the mouse.
- Crank a big glossy reel.
- Zap fish with your rod's shock.
- Fight surges by pulling against them.

Then fill your goldfish jar with realistic voxel fish that earn Aero, and research better rods, boats, tanks and
seven oceans in The Lab.

All art (voxel world, fish, characters and rooms), all music and all sound effects are generated in code. The
one asset is the Alagard pixel font by Hewett Tsoi (`assets/fonts/alagard.ttf`, embedded in the build) used for
titles, dialogue and 3D text. Multiplayer is opt-in, and the game is fully playable offline.

## Play

| How | Command |
| --- | --- |
| In a browser | open `dist/index.html`, or `npm run serve` and visit http://localhost:5173 |
| As a desktop game window (Electron) | `npm install` then `npm run desktop` (window or fullscreen; see [docs/DESKTOP.md](docs/DESKTOP.md)) |

To build from source, run `npm install && npm run build`, which bundles `src/` into `dist/fishtop.js` with esbuild.

### Controls

- **Menu**: the glossy hotbar at the bottom opens:
  - The Lab
  - Aquarium
  - FishDex
  - Satchel
  - Wardrobe
  - Map
  - Bait Shop
  - Bait
  - Multiplayer
  - Settings

  Your rod and bait are shown bottom left.
- **Bait**: buy bait packs from Dot at the **Bait Shop** with Aero. The Lab unlocks better shelves, discounts and
  faster restocks. Each bait is used up when a fish bites. Mix custom bait in the Bait panel once the Lab unlocks
  the recipe.
- **Fishing**:
  - **Cast**: click the water. When the `!` pops, click to set the hook.
  - **Crank**: circle your mouse to turn the big reel.
  - **Shock**: right-click, press Space, or hit the reel's gold button to stun the fish.
  - **Surge**: when the fish bolts, hold the button and drag against the glossy arrow.
  - **Floating boxes**: hover the hook over a drifting crate, capsule, bottle or orb, then click and crank it in
    for loot.
- **Camera**: it follows your hook, boat and catch. Scroll (or press `Home`/`End`) to move between the surface and
  the seabed. Ctrl/Alt + wheel or `+`/`-` changes the zoom.
- **Keys**:
  - **Panels**: `L` The Lab, `J` FishDex, `I` Satchel, `W` Wardrobe, `T` map, `B` bait, `S` Bait Shop,
    `O` multiplayer, `A` aquarium.
  - **Building**: `U` build mode.
  - **Game**: `P` pause, `Esc` settings/close.

### The loop

Catch fish and keep them in your aquarium. Kept fish make glossy **Aero** drops; collect them by hovering,
clicking or sweeping. The tank also earns while you're away. Spend Aero, materials and fish on research in
**The Lab**, a radial tree of 120 nodes in 8 branches:

- Rods (15 Fisch-style rods with lure speed, luck, control, resilience, strength and shock stats)
- Reel & Shock
- Boats (raft to submarine)
- Aquarium (goldfish jar to wall aquarium)
- Oceans
- Bait
- Crafting (buildings, decor and custom bait)
- Luck & Idle

Research takes real time, and a floating beaker shows its progress.

## What's inside

- **The opening**: a 19-second voxel film. The camera flies over the (OS)cean island and swoops to you casting from
  your boat. It plunges underwater past schools of fish, then a swordfish strikes at the lens.
- **Goldie the goldfish** guides a short tutorial with icons and arrows.
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
- **111 realistic voxel fish** with glossy Aero shine and translucent fins. Their names are internet and meme
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
- **NPCs**: Professor Fizz, Goldie, Pinch, Dot, Marina and Captain Bloat.
- **The aquarium**:
  - Six tanks, from the goldfish jar to a wall aquarium. One is the "Aqua Lamp", a moving-picture
    lamp with a rotating voxel reef drum.
  - The voxel room around the tank looks out on rolling hills.
  - You can feed fish, breed them and decorate the tank.
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
