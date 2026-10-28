// STUB - replaced by the voxel boat. API per docs/ARCHITECTURE.md "Boat".
export class Boat {
  constructor(game) { this.game = game; this.x = 480; this.y = 0; this.dragging = false; this.bob = 0; }
  update() {}
  draw() {}
  hit() { return false; }
  rodTip() { return [this.x + 30, this.y - 40]; }
}
