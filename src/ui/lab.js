// The Lab panel (id 'lab'). Placeholder while the full lab interior is being built.
import { drawAeroPanel } from './aero.js';
import { drawText } from '../gfx/font.js';

export class LabPanel {
  constructor() { this.id = 'lab'; this.modal = true; this.openId = 'lab'; }
  open(data) { this.data = data || {}; }
  close() {}
  draw(ctx, ui) {
    const W = this.game.screen.W, H = this.game.screen.H;
    const r = (this.rect = { x: 20, y: 20, w: W - 40, h: H - 40 });
    drawAeroPanel(ctx, r.x, r.y, r.w, r.h, { tone: 'frost', title: 'The Lab' });
    drawText(ctx, 'The Lab', r.x + r.w / 2, r.y + r.h / 2, { align: 'center', color: '#0c3a52' });
  }
}

// Old panel ids ('skills', 'shop', 'research', 'boatyard', 'crafting') open the Lab on a matching tab, but stay on the
// UI stack under their own id so ui.isOpen(alias) still works.
export class LabAlias {
  constructor(id, lab, defaults = {}) { this.id = id; this.lab = lab; this.defaults = defaults; this.modal = true; }
  get rect() { return this.lab.rect; }
  get closeOnOutside() { return this.lab.closeOnOutside; }
  open(data) { this.lab.openId = this.id; this.lab.anim = this.anim; this.lab.open({ ...this.defaults, ...(data || {}) }); }
  close() { this.lab.close(); this.lab.openId = 'lab'; }
  draw(ctx, ui, dt) { this.lab.anim = this.anim; this.lab.draw(ctx, ui, dt); }
}
