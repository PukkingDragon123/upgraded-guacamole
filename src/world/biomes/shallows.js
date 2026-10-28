// Placeholder - replaced by the full scenery implementation.
import { Biome } from './base.js';

export class ShallowsBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'shallows'; this.name = 'Sunny Shallows'; this.subtitle = 'Crystal-clear tropical water'; this.music = 'shallows';
    this.weathers = [{ id: 'sunny', name: 'Sunny', weight: 5 }, { id: 'cloudy', name: 'Cloudy', weight: 2 }, { id: 'rain', name: 'Rain', weight: 2 }, { id: 'storm', name: 'Storm', weight: 0.6 }];
  }
}
