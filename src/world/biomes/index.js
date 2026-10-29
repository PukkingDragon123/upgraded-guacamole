import { ShallowsBiome } from './shallows.js';
import { JunkyardBiome } from './junkyard.js';
import { AbyssBiome } from './abyss.js';
import { Biome } from './base.js';

export const BIOMES = { shallows: ShallowsBiome, junkyard: JunkyardBiome, abyss: AbyssBiome };
export const BIOME_ORDER = ['shallows', 'junkyard', 'abyss'];

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
  })
  .catch(() => {});
export const biomesReady = EXTRA.reduce((p, id) => p.then(() => load(id)), Promise.resolve());
