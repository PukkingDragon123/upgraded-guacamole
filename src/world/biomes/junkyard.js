// Placeholder - replaced by the full scenery implementation.
import { Biome } from './base.js';

export class JunkyardBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'junkyard'; this.name = 'Junkyard Reef'; this.subtitle = 'Where old computers go to sleep'; this.music = 'junkyard';
    this.weathers = [{ id: 'murky', name: 'Murky', weight: 4 }, { id: 'static', name: 'Static Storm', weight: 1.5 }, { id: 'oil', name: 'Oil Slick', weight: 1.5 }, { id: 'datarain', name: 'Data Rain', weight: 1 }];
  }
  baseSurface(H) { return Math.round(H * 0.05); }
}
