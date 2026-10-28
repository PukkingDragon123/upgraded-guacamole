// STUB - replaced by the building system. API per docs/ARCHITECTURE.md "Items, packages, building".
export class Build {
  constructor(game) { this.game = game; this.active = false; }
  update() {}
  drawWorld() {}
  drawUi() {}
  hit() { return false; }
  toggle() { this.active = !this.active; }
}
