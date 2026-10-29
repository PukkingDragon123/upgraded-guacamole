// Registers every UI panel with the UI manager.
import { RevealPanel } from './reveal.js';
import { BaitPanel } from './baitpanel.js';
import { SkillTreePanel } from './skilltree.js';
import { JournalPanel } from './journal.js';
import { ShopPanel } from './shop.js';
import { MapPanel } from './mappanel.js';
import { SettingsPanel } from './settings.js';
import { WelcomePanel } from './welcome.js';
import { registerBuildPanels } from '../build/panels.js';
import { WardrobePanel } from './wardrobe.js';
import { BoatyardPanel } from './boatyard.js';

export function registerPanels(ui) {
  for (const P of [RevealPanel, BaitPanel, SkillTreePanel, JournalPanel, ShopPanel, MapPanel, SettingsPanel, WelcomePanel, WardrobePanel, BoatyardPanel]) ui.register(new P());
  registerBuildPanels(ui); // inventory, research, package, building, buildtray
}
