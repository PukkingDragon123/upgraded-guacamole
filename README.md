# FISHTOP

Your desktop is secretly an ocean. FISHTOP floods your desktop with a glossy, sunny Frutiger Aero sea, built
entirely from voxels. The floating app icons are the game menu, AppSea downloads become bait, and you play as a
bubble person fishing up internet-meme fish. Start with a goldfish jar on a glass desk, earn Aero, and research
your way through The Lab to better rods, boats, tanks and seven oceans.

All art (voxel world, voxel fish, voxel characters and rooms), all music and all sound effects are generated in
code. There are no asset files. Multiplayer is opt-in, and the game is fully playable offline.

## Play

| How | Command |
| --- | --- |
| In a browser (simulated desktop) | open `dist/index.html`, or `npm run serve` and visit http://localhost:5173 |
| On your real desktop (Electron) | `npm install` then `npm run desktop` (see [docs/DESKTOP.md](docs/DESKTOP.md)) |
| Fish in your web browser | load `extension/` as an unpacked extension (see [extension/README.md](extension/README.md)) |

To build from source, run `npm install && npm run build`. That bundles `src/` into `dist/fishtop.js`
and `extension/overlay.js` with esbuild.

### Controls

- **Menu**: click the glossy app bubbles floating in the water. They open:
  - The Lab
  - Aquarium
  - FishDex
  - Satchel
  - Wardrobe
  - Map
  - AppSea
  - Bait
  - Multiplayer
  - Settings

  While a panel is open, the bubbles work as tabs.
- **Bait**: open **AppSea** and download bait packs. Downloads take real time on your dial-up, and the Lab
  unlocks faster internet. Each bait is used up when a fish bites. Mix your own custom bait in the Bait panel
  once the Lab unlocks the recipe. You can also fish without bait, but fewer fish will bite.
- **Fishing**: click the water to cast. When the `!` pops, click to set the hook. Then:
  - **Crank**: circle your mouse. The big glossy reel's handle follows your cursor, and the spool fills
    as you win.
  - **Shock**: right-click, press Space, or hit the reel's gold button to zap the fish. A stunned fish
    reels in fast. Your rod sets the number of charges and the cooldown.
  - **Surge**: when the fish bolts, hold the button and drag against the glossy arrow.
  - **Floating boxes**: hover the hook over a drifting crate, capsule, bottle or orb, click, and crank it in
    for loot.
- **Boat**: scroll up (or press `Home`) to the surface and your boat. Drag it around with the mouse. Press `End` to go
  back down.
- **Keys**:
  - **Panels**: `L` The Lab, `J` FishDex, `I` Satchel, `W` Wardrobe, `T` map, `B` bait, `O` multiplayer,
    `A` aquarium.
  - **Building**: `U` blueprint/build mode.
  - **Game**: `P` pause fishing, `M` mini mode, `Esc` close.
  - **Desktop app**: `Ctrl+Alt+F` toggles fishing, `Ctrl+Alt+P` pauses, `Ctrl+Alt+M` switches to mini mode and
    `Ctrl+Alt+O` switches to overlay.

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

- **The opening**: a 24-second voxel film. The camera pushes from a sunny Aero room into the monitor. The hill
  wallpaper floods, and bubbles from your goldfish jar become you.
- **Goldie the goldfish** guides a short tutorial with icons and arrows.
- **Seven voxel oceans**, each with a glossy water shader, day and night following your real clock, weather,
  secrets and its own music:
  - **(OS)cean**: the classic green-hill wallpaper, flooded, with wind turbines, a green glass globe and a
    glass city in a water bubble.
  - **Sunny Shallows**
  - **Frosty Fjord**
  - **Junkyard Reef**
  - **Sunken Metropolis**
  - **Lava Rift**
  - **The Deep Ocean**
- **111 voxel fish** with cute cartoon eyes. Most are internet and meme puns with original designs:
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

- FISHTOP never modifies, moves or deletes your files. Icons in the bait box are virtual copies,
  and stolen icons always come back; **Restore All Icons** resets everything instantly.
- Dropped files are only read for their name and type, never their contents.
- The desktop app asks before listing your Desktop folder. That listing is read-only and stays on
  your machine.
- The browser extension reads only element positions, never page text, and sends nothing anywhere.
- Multiplayer is off until you turn it on. It shares only the display name you choose and your in-game state
  (look, boat, ocean, catches, emotes). Everything received from other players is validated and treated as
  untrusted.
- In the desktop app's overlay mode, clicks pass through to your real desktop unless you are
  fishing or pointing at game UI. `P` / `Ctrl+Alt+P` pauses fishing at any time.

## Development

```
src/core      math, colour, input, audio            src/gfx      fonts, pixel tools, fish rasteriser + rig, voxels, props, particles
src/world     ocean manager, clock, 3D voxel biomes  src/fish     species, AI, spawner, traits
src/fishing   controller, minigames, bait effects     src/desktop  simulated desktop, icons, apps, wallpaper
src/aquarium  tank, coins, decor                      src/ui       panels, dock, HUD
src/game      game loop, camera, save, skills, tutorial src/overlay  browser-extension content script
src/store     AppSea downloads, ISP, boat tiers        src/build    buildings, research, packages, inventory
```

- `npm test` builds and plays the whole game headlessly in Chromium (Playwright). It drags an icon
  into the bait box, hooks and reels in the first fish, checks the flood, reveal, coin and skill,
  opens every panel, travels to every ocean and fails on any console error.
- `node tools/build.mjs --dev <name>` + `node tools/shot.mjs "dev/<name>.html" out.png` render the
  art preview pages in `src/dev/` (species, voxfish, props, biomes, newbiomes, mapview, tabbar, store, panels, aquarium, audio).
- Module contracts live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
