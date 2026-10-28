// Placeholder aquarium (replaced by the full aquarium implementation).
export class Aquarium {
  constructor(game) { this.game = game; this.fish = []; }
  addFish(rec) { this.fish.push(rec); }
  update() {}
  hit() { return false; }
  drawFull(ctx) { ctx.fillStyle = '#1a5a7a'; ctx.fillRect(0, 0, this.game.screen.W, this.game.screen.H); }
  windowRect() { return null; }
  toggleWindow() {}
  openWindow() {}
  forceCoin() { this.game.emit('coinCollected'); }
  offlineCoins() { return 0; }
}
