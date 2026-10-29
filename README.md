# FISHTOP

Your desktop is secretly an ocean. FISHTOP turns your PC desktop into a living voxel sea.
Fish swim behind your icons and hide behind windows. Your mouse becomes a fishing hook, and the apps
you download become bait. Catch ridiculous fish, raise them in an aquarium that makes Oxidized Coins,
build an underwater village, upgrade your boat and sail from the Sunny Shallows all the way down to
The Deep Ocean.

All art (voxel world, voxel fish, high-resolution pixel UI), all music and all sound effects are
generated in code. There are no asset files and no network access.

## Play

| How | Command |
| --- | --- |
| In a browser (simulated desktop) | open `dist/index.html`, or `npm run serve` and visit http://localhost:5173 |
| On your real desktop (Electron) | `npm install` then `npm run desktop` (see [docs/DESKTOP.md](docs/DESKTOP.md)) |
| Fish in your web browser | load `extension/` as an unpacked extension (see [extension/README.md](extension/README.md)) |

To build from source, run `npm install && npm run build`. That bundles `src/` into `dist/fishtop.js`
and `extension/overlay.js` with esbuild.

### Controls

- **Getting bait**: you start with no apps. Double-click **AppSea** and download one from the
  old-school download site (Notes Lite is tiny). Downloads take real time on your 56k modem, so
  upgrade your internet plan for faster ones. Bigger, higher-tier apps make stronger bait. Drag an
  installed app into the wooden **Bait Box**. You can also drop a real file onto the window; only its
  name and type are read.
- **Fishing**: your cursor is the hook. Move *slowly* near fish, because fast swipes scare them.
  When the `!` pops, **click** to set the hook. The camera zooms in and slows down.
- **Fighting**:
  - **Circle your mouse** to crank the reel and fill the catch bar.
  - When the fish surges (red arrow), circle on the green side opposite it to tire it out.
  - **Hold** the button to yank.
  - Cranking into an uncountered surge raises tension until the line snaps.
  - Species tricks become short events: jumps, mashing, timing rings, tracing, dodging,
    unwrapping, and a final net.
  - Land it for the **I GOT IT!** moment and a photo of your angler holding the catch.
- **Boat**: scroll up (or `Home`) to the surface to see your voxel boat and your angler, Gil. Drag
  the boat around with the mouse. `End` dives back down.
- **Tabs**: the floating icon bar at the top opens everything: Aquarium, FishDex, Skills, Shop,
  Map, Satchel, Build, Lab, Wardrobe, AppSea, Boatyard and Settings. It docks into the taskbar while a
  panel is open, so you can switch panels with one click.
- **Keys**:
  - **Panels**: `J` journal, `K` skills, `S` shop, `T` travel map, `B` bait box, `A` aquarium,
    `U` blueprint/build mode, `I` inventory.
  - **Game**: `P` pause fishing, `M` mini mode, `F3` FPS, `Esc` close.
  - **Desktop app**: `Ctrl+Alt+F` toggles fishing (click-through otherwise), `Ctrl+Alt+P` pauses,
    `Ctrl+Alt+M` switches to mini mode and `Ctrl+Alt+O` switches to overlay.

### The loop

Catch fish, then keep them in the aquarium (or release them for coins). Fish make spinning Oxidized
Coins; click the aquarium to dive into its full scene and collect them. Some fish carry package
crates with blueprints, materials and cosmetics. Spend coins on:

- Cap'n Bloat's bait shop
- the skill board
- research in the Lab
- buildings
- decorations
- boat upgrades at Barnaby's Boatyard

Charting new waters on the skill board opens new oceans with stranger fish and legendary bosses.

## What's inside

- **Opening**: an ordinary desktop. Then a strange fish, a hook from the sky and Pinch the crab,
  who shows you how to download your first bait. Your first catch floods the wallpaper into an ocean.
- **Six 3D voxel oceans**, with depth, fog, a custom water shader, day/night following your real
  clock, weather, secrets and their own music:
  - **Sunny Shallows**: reef and caustics.
  - **Frosty Fjord**: glaciers, auroras and penguins.
  - **Junkyard Reef**: live CRTs, server racks and data rain.
  - **Sunken Metropolis**: a drowned neon city with a subway car.
  - **Lava Rift**: magma vents and eruptions.
  - **The Deep Ocean**: a bioluminescent canyon and a leviathan.
- **The travel map** is a 3D voxel diorama that you can turn around. Your boat sails between the pins.
- **107 voxel fish species**, big and expressive, with swimming tails, translucent fins and glowing
  lures. Most are affectionate pop-culture parodies with pun names and original designs, such as:
  - the Flopikarp (it evolves in your tank)
  - the Tetromino Tetra
  - the Wakka Fish
  - Mike Wazowfish
  - Grand Theft Tuna
  - the Blue Screen of Death Ray
  - Squid Gamer
  - Heisenbass

  There are also fun real-ish fish, like the Banana Fish and the Literal Catfish (an actual cat).
  Fish also come with mutations, shinies, giants and personalities.
- **Gil**, your goofy green voxel angler: dress him up in the Wardrobe and watch him fight every
  catch from the boat.
- **Building**: blueprint mode places voxel buildings on the seabed: a Research Lab, a Fish Hatchery
  and more, each with gameplay bonuses. The Lab researches new tech, and the Satchel inventory holds
  every item, material and blueprint.
- **Dozens of interactive decorations**, in the ocean and the aquarium. Fish react to them and use them.
- **Fish AI**: steering, schools, curiosity, fear of fast mice, bait preferences, hiding behind
  windows, stealing icons (always returned) and aquarium life (eating, sleeping, playing, courting,
  breeding, evolving).
- **Procedural audio** in WebAudio: bubbly UI, coin clinks, reel clicks, splashes, creature voices,
  per-ocean ambience and generative music.

## Safety and privacy

- FISHTOP never modifies, moves or deletes your files. Icons in the bait box are virtual copies,
  and stolen icons always come back; **Restore All Icons** resets everything instantly.
- Dropped files are only read for their name and type, never their contents.
- The desktop app asks before listing your Desktop folder. That listing is read-only and stays on
  your machine.
- The browser extension reads only element positions, never page text, and sends nothing anywhere.
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
