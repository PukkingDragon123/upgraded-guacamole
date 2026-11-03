// The Lab's floating "research in progress" widget (panel id 'labwidget', non-modal, survives other panels).
// OWNER: Lab agent. A small glossy bubble with a bubbling beaker and a progress ring, bobbing under the Aero
// counter while something brews. Click it to open the Lab. game.build opens it when research starts and calls
// celebrate(id) when research finishes (a green sparkle pop), then it floats away by itself.
import { TAU, clamp01 } from '../core/math.js';
import { rgba, mix } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { drawAeroGlow, drawAeroBubble, drawSparkle, drawAeroBadge, drawAeroLabel } from './aero.js';
import { LAB_BY_ID, BRANCHES, ensureLab, labProgress, labRemaining, fmtTime } from '../game/lab.js';
import { drawFlask } from './labart.js';
import { icon } from './labkit.js';

const LAB_IDS = ['lab', 'skills', 'research', 'shop', 'crafting', 'boatyard'];

export class LabWidget {
  constructor() {
    this.id = 'labwidget';
    this.modal = false;
    this.keep = true;
    this.replace = false;
    this.closeOnOutside = false;
    this.sound = 'bubbles';
    this.t = 0;
    this.done = null;
    this.rect = null;
    this.k = 0;
  }

  open() { this.t = 0; this.k = 0; }
  close() { this.rect = null; }

  celebrate(id) { this.done = { id, t: 0 }; }

  remove(ui) { ui.stack = ui.stack.filter((p) => p !== this); this.rect = null; }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state;
    this.t += dt;
    const L = ensureLab(st);
    if (this.done) this.done.t += dt;
    if (this.done && this.done.t > 3.2) this.done = null;
    const busy = L.slots.length > 0;
    if (!busy && !this.done) { this.remove(ui); return; }
    // hidden under modal panels (and while the Lab itself is open)
    const hidden = ui.blocking || LAB_IDS.some((id) => ui.isOpen(id));
    this.k = clamp01(this.k + (hidden ? -dt * 6 : dt * 4));
    if (this.k <= 0) { this.rect = null; return; }
    const t = this.t;
    const W = g.screen.W;
    const R = 15;
    const x = Math.round(W - 30), y = Math.round(58 + Math.sin(t * 1.8) * 2.5);
    this.rect = { x: x - R - 3, y: y - R - 3, w: R * 2 + 6, h: R * 2 + 6 };
    const hov = ui.hover(this.rect);
    const s = L.slots[0];
    const nd = s ? LAB_BY_ID[s.id] : LAB_BY_ID[this.done?.id];
    const col = nd ? mix(BRANCHES[nd.branch]?.color || '#35c8ff', '#4fd2ff', 0.3) : '#4fd2ff';
    const k = s ? labProgress(st, s.id) : 1;
    ctx.save();
    ctx.globalAlpha *= this.k;
    const doneK = this.done ? clamp01(this.done.t / 0.5) : 0;
    drawAeroGlow(ctx, x, y, R * 2.2, this.done ? '#c8ff7a' : '#bff6ff', 0.55 + 0.15 * Math.sin(t * 3) + doneK * 0.3);
    // glass bubble
    const gb = ctx.createRadialGradient(x - 5, y - 6, 1, x, y, R);
    gb.addColorStop(0, rgba('#ffffff', 0.95)); gb.addColorStop(0.6, rgba('#e4f8ff', 0.85)); gb.addColorStop(1, rgba('#8fd8f4', 0.9));
    ctx.fillStyle = gb; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    // the beaker
    drawFlask(ctx, x, y + 9, { t, level: 0.3 + 0.6 * k, color: this.done ? '#7ee85a' : col, w: 16, h: 20, active: true });
    // progress ring
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba('#ffffff', 0.95); ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(x, y, R + 1.5, 0, TAU); ctx.stroke();
    ctx.strokeStyle = this.done ? '#5fd23a' : '#35c8ff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, R + 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.strokeStyle = '#3f8fc4'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, R + 3.5, 0, TAU); ctx.stroke();
    // gloss
    ctx.fillStyle = rgba('#ffffff', 0.85); ctx.beginPath(); ctx.ellipse(x - 5, y - 9, 6, 3, -0.5, 0, TAU); ctx.fill();
    // node icon peeking out, bubbles rising off the top
    const ic = nd ? icon(nd.icon, 12) : null;
    if (ic) ctx.drawImage(ic, Math.round(x - R - 4), Math.round(y + R - 9));
    for (let i = 0; i < 3; i++) { const q = (t * 0.6 + i / 3) % 1; drawAeroBubble(ctx, x + Math.sin(t * 2 + i * 2) * 5, y - R - 2 - q * 14, 1.2 + q * 1.5, 1 - q); }
    if (L.slots.length > 1) drawAeroBadge(ctx, x + R + 5, y - R - 4, L.slots.length, t);
    if (this.done) for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + t, d = R + 4 + doneK * 10; drawSparkle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, 2, 1 - clamp01((this.done.t - 1) / 2)); }
    if (hov && s && nd) {
      drawAeroLabel(ctx, `${nd.name}  ${fmtTime(labRemaining(st, s.id))}`, x - R - 8, y + R + 6, { align: 'right', tone: 'white' });
      ui.markHot?.('labwidget');
    }
    ctx.restore();
    if (ui.clicked(this.rect)) { g.audio.play('ui_click'); ui.open('lab', s ? { focus: s.id } : this.done ? { focus: this.done.id } : undefined); }
    void drawText;
  }
}
