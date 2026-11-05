// Registers every UI panel with the UI manager.
import { RevealPanel } from './reveal.js';
import { BaitPanel } from './baitpanel.js';
import { LabPanel, LabAlias } from './lab.js'; // [phase3:lab] The Lab replaces skills, shop, research, boatyard
import { LabWidget } from './labwidget.js'; // [phase3:lab] floating research-in-progress bubble
import { JournalPanel } from './journal.js';
import { MapPanel } from './mappanel.js';
import { SettingsPanel } from './settings.js';
import { WelcomePanel } from './welcome.js';
import { registerBuildPanels } from '../build/panels.js';
import { WardrobePanel } from './wardrobe.js';
import { MultiplayerPanel } from './multiplayer.js'; // [phase3:online]
import { registerQuestPanels } from './quests.js'; // [phase6:lab] Quest Log + chapter celebration

export function registerPanels(ui) {
  for (const P of [RevealPanel, BaitPanel, JournalPanel, MapPanel, SettingsPanel, WelcomePanel, WardrobePanel]) ui.register(new P());
  // [phase3:lab] one Lab panel; the old ids stay as aliases that open it on a matching tab
  const lab = new LabPanel();
  ui.register(lab);
  for (const [id, tab] of [['skills', 'tree'], ['research', 'tree'], ['shop', 'craft'], ['crafting', 'craft'], ['boatyard', 'boats']]) ui.register(new LabAlias(id, lab, { tab }));
  ui.register(new LabWidget()); // [phase3:lab] id 'labwidget' (game.build opens it while research runs)
  registerBuildPanels(ui); // inventory, package, building, buildtray
  ui.register(new MultiplayerPanel()); // [phase3:online] id 'multiplayer'
  registerQuestPanels(ui); // [phase6:lab] ids 'quests' (key Q) and 'chapter'
}
