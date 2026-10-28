// Placeholder - replaced by the full scenery implementation.
import { Biome } from './base.js';

export class AbyssBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'abyss'; this.name = 'The Midnight Abyss'; this.subtitle = 'Something down here is watching'; this.music = 'abyss';
    this.weathers = [{ id: 'still', name: 'Still Water', weight: 4 }, { id: 'snow', name: 'Marine Snow', weight: 2 }, { id: 'current', name: 'Deep Current', weight: 1.5 }, { id: 'glowtide', name: 'Glow Tide', weight: 0.8 }];
  }
  baseSurface() { return null; }
  lighting() { return { dark: 0.86, tint: '#0a1030', lights: [] }; }
}
