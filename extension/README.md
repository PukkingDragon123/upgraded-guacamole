# FISHTOP Browser Fish (optional extension)

Pixel fish from FISHTOP swim over the web pages you visit. They swim around images, slip behind
paragraphs, get swept along when you scroll, and wander from tab to tab. Flip on **fishing mode** and
your mouse becomes the hook, with the game's own nibble, bite, fight and net mechanics. Fish you catch
wait in a small browser bucket until you send them to FISHTOP.

The overlay runs the real game code: `src/fish/fish.js` (AI), `src/gfx/fishrig.js` (rig),
`src/fishing/fishing.js` and `src/fishing/minigames.js` (fishing), driven by a world adapter in
`src/overlay/`.

## Install (Chrome, Edge, Brave: any Chromium 105+)

1. Build: `npm run build` (or `node tools/build.mjs`). This writes `extension/overlay.js`.
   The icons in `extension/icons/` come from `node tools/ext-icons.mjs` and are already generated.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the `extension/` folder.
3. Pin the fish icon and click it.

## Using it

| Popup control | What it does |
| --- | --- |
| Fish in this tab | Adds fish to the current tab only (uses `activeTab`; ends when the page navigates). |
| Fishing mode | The overlay takes the mouse: the hook follows your cursor. **Esc** or **Alt+Shift+F** turns it off. |
| Roaming fish (all tabs) | Asks Chrome for access to all sites, then fish appear in every tab and hop between them. Turning it off removes the access again. |
| Fish per tab | 1 to 6 (default 3). |
| Sound | Off by default. |
| Browser bucket | Fish caught in the browser, newest first. |
| Send catches to FISHTOP | Delivers the bucket to the game (see below). |

Change the shortcut at `chrome://extensions/shortcuts`.

**Fishing:** keep the page crumb still near a fish. Wait out the nibbles, then click right when it bites
(**CLICK!**). Then win the fight phases: hold to reel and pull against the fish, trace, mash, timing,
dodge or unwrap. Finish by drawing a net around it. If the line crosses an image it snags. A catch card
slides in at the bottom right.

**Tab hopping:** a fish that swims off the right edge goes to the next tab to the right that has fish
(and off the left edge to the tab on the left). If that tab is in the background, the fish waits there
and swims in when you switch to it.

## Sending catches to FISHTOP

Open the game in one of these ways, then press **Send** in the popup. You can press Send first: the fish
swim over as soon as the game page loads.

- `npm run serve`, then open http://localhost:5173 (or http://127.0.0.1:5173).
- `dist/index.html` opened from a folder whose path contains `fishtop` or `FISHTOP`. For `file://` pages you
  also need to enable **Allow access to file URLs** on the extension's details page.

A small bridge script (`bridge.js`) runs only on those pages. It talks to the game through `window.postMessage`:

```
bridge -> game   { type: 'fishtop:bridge-hello', version: 1 }     (repeated for about 30 s until the game answers)
game   -> bridge { type: 'fishtop:game-hello', version: 1 }
bridge -> game   { type: 'fishtop:catches', fish: [record, ...] }  (only after the user pressed Send)
game   -> bridge { type: 'fishtop:catches-ack', uids: [uid, ...] }  (imported or already owned; marks them sent)
```

Each `record` is exactly a `rollIndividual()` result plus `species` and `caughtAt`:
`{ uid, species, sizeCm, weightKg, sizeT, giant, tiny, variant, personality, name, caughtAt }`.

### Game side (what FISHTOP should do)

1. Listen for `message` events where `e.source === window` and `e.data.type` is a string.
2. On `fishtop:bridge-hello`, reply `{ type: 'fishtop:game-hello', version: 1 }`. Use `location.origin` as the
   target, or `'*'` on `file://`.
3. On `fishtop:catches`, take at most 100 records and process each one:
   - Skip it if `SPECIES_BY_ID[r.species]` is missing or `r.uid` is not a string.
   - If the uid is already known (in `state.fish` or a `state.browserImports` uid list, capped at about 500),
     only acknowledge it.
   - Otherwise sanitize every field:
     - `sizeCm` and `weightKg` must be finite numbers.
     - `sizeT` is clamped to 0..1.
     - `giant` and `tiny` are booleans.
     - In `variant`, keep only a `mutation` found in `MUTATIONS`, a `pattern` found in `PATTERNS`, an integer
       `seed`, a boolean `shiny` and a numeric `shinyHue`.
     - `personality` must be a `PERSONALITIES` id, otherwise `'chill'`.
     - `name` is a string of at most 24 characters.
     - `caughtAt` is a number, otherwise `Date.now()`.
   - Build `rec = { ...clean, biome: sp.biome, rarity: sp.rarity, fromBrowser: true }`.
   - Update the journal as `onFishCaught` does (`seen`, `caught`, `maxSize`/`minSize`, `first`, `variants`)
     and increment `state.stats.caught`.
   - Store the fish like `keepFish`, but without a toast per fish. Push
     `{ ...rec, inTank: tankCount() < stats.tankCap, happiness: 0.75, hunger: 0.3, coinT: 0 }` to
     `state.fish`, and call `aquarium.addFish` when it goes in the tank.
   - Remember the uid in `state.browserImports`.
4. Save, show one toast such as "3 fish swam in from your browser!", and reply
   `{ type: 'fishtop:catches-ack', uids }` with the imported and already-known uids.

`extension/test/game-stub.html` is a minimal reference implementation of steps 1 to 4 (without the game state).

## Privacy and safety

- **Permissions:** `storage`, `activeTab` and `scripting`. Host access (`http://*/*`, `https://*/*`) is
  *optional*. It is requested only when you turn on roaming fish, and removed when you turn it off. The only
  host match in the manifest is the bridge on the FISHTOP pages listed above.
- **What the fish see:** layout geometry only. That means the boxes of visible `img`, `video`, `canvas`,
  `svg` and `iframe` elements, the boxes of text blocks (`p`, `li`, `h1` to `h6` and so on), and the line boxes
  of a paragraph so fish can hide between lines. These come from `elementFromPoint`, `getBoundingClientRect`
  and `Range.getClientRects`. The extension never reads page text, attributes, URLs, form values, cookies or
  pixels, and never stores or reports which sites you visit. The cursor position and scroll offsets are used
  live to animate fish and are never stored.
- **No network:** nothing is fetched or sent anywhere. Catches live in `chrome.storage.local`. A thumbnail is
  drawn from the game's own sprites.
- **Never in the way:** the overlay is one fixed element with a closed shadow root and `pointer-events: none`.
  Clicks, selection, keyboard and scrolling all reach the page. Only fishing mode captures the mouse, and Esc
  always ends it. It runs in the top frame only, hides when printing, and does not touch the page's DOM
  otherwise. It does not run on the FISHTOP game page unless you add it to that tab yourself.
- **Cheap:** at most 6 fish. It runs at about 30 fps while idle and 60 fps only while fishing, and stops
  entirely in hidden tabs. A geometry scan takes about 2 to 4 ms every 1.6 s. New fish sprites are
  pre-rendered in idle time, and the sprite cache is capped per tab. In tests, an update plus draw costs
  about 1 ms.

## Files

| Path | Role |
| --- | --- |
| `manifest.json` | MV3 manifest |
| `background.js` | Service worker: tab registry (`chrome.storage.session`), tab-to-tab hand-off, roaming registration, shortcut, catch bucket, delivery to the game |
| `popup.html`, `popup.js` | Popup UI |
| `bridge.js` | Content script on the FISHTOP page only (postMessage protocol above) |
| `overlay.js` | **Built** from `src/overlay/main.js` by `tools/build.mjs` |
| `icons/` | Built by `tools/ext-icons.mjs` |
| `test/` | Test page, game stub and Playwright tests |

Overlay sources in `src/overlay/`:

| File | Role |
| --- | --- |
| `overlay.js` | Canvas host, world adapter, spawning, roaming, fishing adapter, drawing |
| `scan.js` | Geometry scanner |
| `input.js` | Passive pointer input |
| `card.js` | Catch card, page-crumb bait and thumbnails |
| `ext.js` | Safe wrapper around the extension APIs |

## Tests

```
node tools/build.mjs
node extension/test/run.mjs      # overlay on a test page with a stubbed chrome API: swimming, hiding, scroll, real mouse fishing
node extension/test/soak.mjs     # every species, every fight phase and trick, random input; no exceptions allowed
node extension/test/run-ext.mjs  # the unpacked extension in Chromium (needs port 5173 free)
```

`run-ext.mjs` first checks the extension as shipped: manifest, service worker, shortcut, no site access by
default, and the bridge running only on the game page. Then it loads a temporary copy whose manifest grants
the optional host access, because a headless browser cannot click the toolbar button or a permission prompt.
With that copy it tests:

- injection into two tabs;
- a fish handed from one tab to the other;
- fishing mode and Esc;
- the catch bucket and the popup;
- Send, then automatic delivery to a stub game page, with the ack;
- roaming on and off.

All tests fail on any console error or warning. Screenshots go to `extension/test/out/`.
