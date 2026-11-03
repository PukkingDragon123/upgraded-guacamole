// Retired (phase 3): research happens in The Lab (src/ui/lab.js). This shim keeps old imports working: a panel
// with the old id 'research' that hands over to the Lab when something opens it.
export class ResearchPanel {
  constructor() { this.id = 'research'; this.modal = true; this.rect = null; }
  open(data) { setTimeout(() => { this.ui?.close?.('research'); this.ui?.open?.('lab', { tab: 'tree', ...(data || {}) }); }, 0); }
  close() {}
  draw() {}
}
