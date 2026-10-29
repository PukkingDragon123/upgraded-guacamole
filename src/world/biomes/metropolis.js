// Sunken Metropolis (work in progress stub).
import { Biome } from './base.js';
export class MetropolisBiome extends Biome {
  constructor(ocean) { super(ocean); this.id = 'metropolis'; this.name = 'Sunken Metropolis'; this.subtitle = ''; this.music = 'metropolis'; this.ambient = 'metropolis'; this.weathers = [{ id: 'still', name: 'Still', weight: 1 }]; }
}
