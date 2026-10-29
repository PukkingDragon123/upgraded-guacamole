# FISHTOP

Your desktop is secretly an ocean. FISHTOP turns your PC desktop into a living pixel-art sea.
Fish swim behind your icons and hide behind windows. Your mouse becomes a fishing hook, and your
own app icons become bait. Catch weird fish, raise them in an aquarium that makes Oxidized
Coins, grow a skill board, and dive from the Sunny Shallows to the Junkyard Reef and the
Deep Ocean.

All art (high-resolution pixel art, voxel props, 51 procedurally rendered fish species), all
music and all sound effects are generated in code. There are no asset files and no network access.

## Play

| How | Command |
| --- | --- |
| In a browser (simulated desktop) | open `dist/index.html`, or `npm run serve` and visit http://localhost:5173 |
| On your real desktop (Electron) | `npm install` then `npm run desktop` (see [docs/DESKTOP.md](docs/DESKTOP.md)) |
| Fish in your web browser | load `extension/` as an unpacked extension (see [extension/README.md](extension/README.md)) |

To build from source, run `npm install && npm run build`. That bundles `src/` into `dist/fishtop.js`
and `extension/overlay.js` with esbuild.

### Controls

- **Fishing**: your cursor is the hook. Move *slowly* near fish, because fast swipes scare them. Click
  in the water to jig the lure. Fish sniff, nibble and fake. When the `!` pops, **click** to set
  the hook.
- **Fighting**: each species mixes these phases:
  - **Tension**: hold to reel and move *against* the fish's swim. Let go when the gauge turns red.
  - **Trace**: keep the hook inside the moving ring.
  - **Mash**: rapid clicks.
  - **Timing**: click when the rings meet.
  - **Dodge**: hold the reel while avoiding the projectiles it spits.
  - **Unwrap**: circle your mouse to untangle the noodle eel.
  - **Net**: draw a circle around the exhausted fish.

  Fish dash, dive, jump out of the water, fake moves, wrap your line around icons and hop
  between windows.
- **Bait**: drag any desktop icon into the wooden **Bait Box**. You can also drop a real file onto
  the window; only its name and type are read. Browser icons attract digital fish, folders attract
  curious fish, the Recycle Bin attracts mutants. Special baits change your desktop: worms crawl
  over icons, a black hole tugs at them, a flood raises the sea, golden bait glitters, and pop-up
  ads appear.
- **Keys**: `J` journal, `K` skills, `S` shop, `T` travel map, `B` bait box, `A` aquarium,
  `P` pause fishing, `M` mini mode, `F3` FPS, `Esc` close. Right-mouse **Focus** slows time once
  unlocked. In the desktop app, use `Ctrl+Alt+F` to toggle fishing (click-through otherwise),
  `Ctrl+Alt+P` to pause, `Ctrl+Alt+M` for mini mode and `Ctrl+Alt+O` to switch to overlay.

### The loop

Catch fish, then keep them in the aquarium (or release them for coins). Fish make spinning Oxidized
Coins that pile up on the tank floor; collect them by hovering, or unlock the snail and crab
helpers. Spend coins on Pinch's shop and the skill board. Unlocking better gear plus discovering
species opens new oceans with stranger fish, legendary bosses and secrets.

## What's inside

- **Opening**: an ordinary desktop. Then a strange pixel fish, a hook from the sky and Pinch the
  crab. Your first catch floods the wallpaper into an ocean.
- **Three 3D voxel oceans**, with depth, fog, day/night following your real clock, weather, secrets
  and their own music:
  - **Sunny Shallows**: reef, rays, caustics, gulls, rain and storms.
  - **Junkyard Reef**: live CRTs, server racks, a vending machine, static storms and data rain.
  - **The Deep Ocean**: a bioluminescent canyon, ruins, a leviathan and a lantern hook.
- **51 species**, realistic-anatomy pixel art with a layered animation rig: tail, fins and body
  each animate on their own phases, plus a live face that breathes, gapes, flares its gills and
  follows things with its eyes. The cast includes:
  - Sir Puffington, who inflates when scared.
  - The Googly Gawker, whose eyes follow your cursor.
  - Mr. Briefcase, who works 9-to-5 by your real clock.
  - A transparent fish with visible organs.
  - A noodle eel that wraps around your mouse.
  - The Click Crab, wearing a computer mouse as its shell.
  - The Shortcut Fish, which poses as a desktop icon (double-click it).
  - The Loading Angler, a mechanical anglerfish.
  - Purin the pudding fish.
  - The Ancient Many-Eyed One.

  Fish also come with mutations, shinies and personalities.
- **Fish AI**: steering, schooling, curiosity, fear of fast mice, bait preferences, hiding behind
  windows, stealing icons (always returned) and aquarium life (eating, sleeping, playing, courting,
  breeding).
- **Aquarium** as a floating window, full desktop background or tiny mini mode, with coin physics,
  decorations, feeding and breeding.
- **UI built into the world**:
  - Wooden panels and a bait box.
  - Pinch's merchant stall.
  - A porthole skill board.
  - A leather fish journal.
  - A sea-chart travel map.
  - Settings: volumes, transparency, day-cycle mode, reduced motion, low power, save
    export/import.
- **Procedural audio** in WebAudio: bubbly UI, coin clinks, line tension, splashes, creature
  voices, crab babble, per-ocean ambience and generative music.

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
src/game      game loop, state/save, skills, tutorial src/overlay  browser-extension content script
```

- `npm test` builds and plays the whole game headlessly in Chromium (Playwright). It drags an icon
  into the bait box, hooks and fights the first fish, checks the flood, reveal, coin and skill,
  opens every panel, travels to every ocean and fails on any console error.
- `node tools/build.mjs --dev <name>` + `node tools/shot.mjs "dev/<name>.html" out.png` render the
  art preview pages in `src/dev/` (species, props, biomes, uiart, panels, aquarium, audio).
- Module contracts live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
