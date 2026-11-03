// The old seabed dock is gone: the desktop's floating app icons are the game menu now
// (src/desktop/desktop.js). This module keeps the tiny API the game and the tutorial still use.
//   PINCH_LOOK       Pinch the crab's look (tutorial)
//   new Dock(game)   no-op placeholder: draw(ctx, dt) does nothing, items is empty

export const PINCH_LOOK = {
  kind: 'crab', mustache: true, body: { len: 26, h: 17 },
  col: { body: '#e8583a', belly: '#ffb08a', fin: '#f06a4a', outline: '#3a1210' },
};

export class Dock {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.hidden = new Set();
  }

  isVisible() { return false; }
  layout() {}
  draw() {}
}
