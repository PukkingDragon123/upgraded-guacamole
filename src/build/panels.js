// Registers the building-system panels with the UI manager (only ids not registered yet):
// 'inventory', 'package', 'building', 'buildtray'. (Research moved into The Lab, src/ui/lab.js.)
import { InventoryPanel } from '../ui/inventory.js';
import { PackagePanel } from '../ui/package.js';
import { BuildTrayPanel, BuildingPanel } from '../ui/buildpanel.js';

export const BUILD_PANELS = [InventoryPanel, PackagePanel, BuildingPanel, BuildTrayPanel];

export function registerBuildPanels(ui, force = false) {
  for (const P of BUILD_PANELS) {
    const p = new P();
    if (force || !ui.panels?.[p.id]) ui.register(p);
  }
}
