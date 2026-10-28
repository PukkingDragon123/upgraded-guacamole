// Registers every UI panel with the UI manager.
import { RevealPanel } from './reveal.js';
import { BaitPanel } from './baitpanel.js';

export function registerPanels(ui) {
  for (const P of [RevealPanel, BaitPanel]) ui.register(new P());
}
