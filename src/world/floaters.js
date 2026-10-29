// Floating boxes you can fish up (phase 3; replaces fish carrying packages). OWNER: World agent (stub).
//   new Floaters(game); update(dt); draw(ctx, layer /* 'far'|'mid'|'near' */)
//   list: [{id, kind:'crate'|'capsule'|'bottle'|'orb', tier /* build/items.js TIER_ORDER */, x, y, z, hooked:false}]
//   hitHook(wx, wy, r) -> floater|null      world-space test used by fishing
//   take(f)                                 remove it (fishing calls game.onBoxCaught(f) after reeling it in)
export class Floaters {
  constructor(game) { this.game = game; this.list = []; }
  update() {}
  draw() {}
  hitHook() { return null; }
  take(f) { this.list = this.list.filter((q) => q !== f); }
}
