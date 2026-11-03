import { OsceanBiome } from './oscean.js';
import { ShallowsBiome } from './shallows.js';
import { JunkyardBiome } from './junkyard.js';
import { AbyssBiome } from './abyss.js';
import { Biome } from './base.js';

// Ocean order (shallow -> deep) and depth in metres.
export const CANON_ORDER = ['oscean', 'shallows', 'fjord', 'junkyard', 'metropolis', 'volcano', 'abyss'];
export const BIOME_DEPTH = { oscean: 4, shallows: 8, fjord: 60, junkyard: 140, metropolis: 450, volcano: 900, abyss: 3200 };

export const BIOMES = { oscean: OsceanBiome, shallows: ShallowsBiome, junkyard: JunkyardBiome, abyss: AbyssBiome };
export const BIOME_ORDER = ['oscean', 'shallows', 'junkyard', 'abyss'];
const rank = (id) => { const i = CANON_ORDER.indexOf(id); return i < 0 ? 99 : i; };

// Optional biomes added by other modules. They are pulled in through a glob import, so a missing file never
// breaks the build: esbuild bundles whichever of these exist and the rest simply fail to load (ignored).
const EXTRA = ['fjord', 'volcano', 'metropolis'];
const load = (id) => Promise.resolve()
  .then(() => import(`./${id}.js`))
  .then((mod) => {
    const Cls = Object.values(mod).find((v) => typeof v === 'function' && v.prototype instanceof Biome);
    if (!Cls) return;
    BIOMES[id] = Cls;
    if (!BIOME_ORDER.includes(id)) BIOME_ORDER.push(id);
    BIOME_ORDER.sort((a, b) => rank(a) - rank(b));
  })
  .catch(() => {});
export const biomesReady = EXTRA.reduce((p, id) => p.then(() => load(id)), Promise.resolve());
