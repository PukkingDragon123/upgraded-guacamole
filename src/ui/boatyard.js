// Retired (phase 3): boats are researched and picked in The Lab (src/ui/lab.js, Boats tab). This shim keeps old
// imports working: a panel with the old id 'boatyard' that hands over to the Lab when something opens it.
export class BoatyardPanel {
  constructor() { this.id = 'boatyard'; this.modal = true; this.rect = null; }
  open(data) { setTimeout(() => { this.ui?.close?.('boatyard'); this.ui?.open?.('lab', { tab: 'boats', ...(data || {}) }); }, 0); }
  close() {}
  draw() {}
}
