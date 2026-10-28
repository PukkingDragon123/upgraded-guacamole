// Registers every UI panel with the UI manager.
import { RevealPanel } from './reveal.js';
import { BaitPanel } from './baitpanel.js';
import { SkillTreePanel } from './skilltree.js';
import { JournalPanel } from './journal.js';

export function registerPanels(ui) {
  for (const P of [RevealPanel, BaitPanel, SkillTreePanel, JournalPanel]) ui.register(new P());
}
