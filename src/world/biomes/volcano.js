// Lava Rift (work in progress stub).
import { Biome } from './base.js';
export class VolcanoBiome extends Biome {
  constructor(ocean) { super(ocean); this.id = 'volcano'; this.name = 'Lava Rift'; this.subtitle = ''; this.music = 'volcano'; this.ambient = 'volcano'; this.weathers = [{ id: 'calm', name: 'Calm', weight: 1 }]; }
}
