// Bait box panel: stored desktop icons (virtual copies), dropped files and special baits. Click to equip.

import { rgba } from '../core/color.js';
import { drawText, drawWrapped } from '../gfx/font.js';
import { drawWood, drawPaper } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getAppIcon, getMiniIcon } from '../desktop/icons.js';
import { BAITS, BAIT_ORDER } from '../game/shopdata.js';
import { baitSprite } from '../fishing/baitart.js';
import { centerRect } from './ui.js';

const TYPE_HINT = {
  computer: 'Techy and curious fish', trash: 'Disgusting mutant fish', browser: 'Digital fish', folder: 'Curious fish',
  docs: 'Bookish, forgetful fish', music: 'Musical, fluttery fish', image: 'Fish that love to look at things', game: 'Playful fish',
  mail: 'Busy messenger fish', terminal: 'Hacker & glitch fish', settings: 'Mechanical fish', calc: 'Math-minded fish',
  calendar: 'Punctual fish', chat: 'Chatty schooling fish', video: 'Showy fish', paint: 'Colourful fish',
};

export class BaitPanel {
  constructor() {
    this.id = 'bait';
    this.modal = true;
    this.sound = 'box_open';
  }

  open() { this.t = 0; }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state;
    this.t = (this.t || 0) + dt;
    const W = 360, H = 250;
    const r = centerRect(g, W, H);
    this.rect = r;
    drawWood(ctx, r.x, r.y, W, H, { tone: 'dark' });
    drawText(ctx, 'BAIT BOX', r.x + W / 2, r.y + 9, { align: 'center', scale: 2, color: '#ffe8b8', shadow: '#1a0e06' });
    drawText(ctx, `${st.baitBox.length}/${g.stats.boxSlots} icon slots`, r.x + W - 12, r.y + 12, { align: 'right', font: 'small', color: '#c8a878' });
    const eq = st.equipped;
    let hoverInfo = null;
    // icon + file baits
    drawText(ctx, 'Desktop icons (virtual copies - your apps are untouched)', r.x + 12, r.y + 32, { color: '#f4d8a8' });
    const slots = [...st.baitBox.map((id) => ({ kind: 'icon', id })), ...st.files.map((f) => ({ kind: 'file', id: f.id }))];
    const cell = 40;
    const perRow = 8;
    for (let i = 0; i < Math.max(g.stats.boxSlots, slots.length); i++) {
      const x = r.x + 14 + (i % perRow) * (cell + 1), y = r.y + 44 + Math.floor(i / perRow) * (cell + 1);
      if (y > r.y + 120) break;
      ctx.fillStyle = rgba('#1a0e06', 0.55);
      ctx.fillRect(x, y, cell - 2, cell - 2);
      const s = slots[i];
      if (!s) continue;
      const ic = s.kind === 'icon' ? g.desktop.iconById(s.id) : null;
      const f = s.kind === 'file' ? st.files.find((q) => q.id === s.id) : null;
      const iconId = ic?.icon || f?.icon;
      const label = ic?.label || f?.name;
      const type = ic?.type || f?.type;
      const rr = { x, y, w: cell - 2, h: cell - 2 };
      const hov = ui.hover(rr);
      const on = eq && eq.kind === s.kind && eq.id === s.id;
      if (on || hov) { ctx.fillStyle = rgba(on ? '#ffe27a' : '#ffffff', on ? 0.35 : 0.12); ctx.fillRect(x, y, cell - 2, cell - 2); }
      const spr = getAppIcon(iconId, { size: 32 });
      if (spr) ctx.drawImage(spr, x + 3, y + 1 + (hov ? -1 : 0));
      if (on) drawText(ctx, 'ON', x + cell - 5, y + cell - 9, { font: 'small', color: '#ffe27a', align: 'right', outline: '#1a0e06' });
      if (hov) hoverInfo = { title: label, text: `${type} bait - attracts: ${TYPE_HINT[type] || 'all sorts of fish'}`, extra: s.kind === 'icon' ? 'Right-click: put back on desktop' : 'Right-click: remove' };
      if (ui.clicked(rr)) g.equip(s.kind, s.id);
      if (hov && g.input.rpressed) {
        if (s.kind === 'icon') g.desktop.takeFromBox(s.id);
        else { st.files = st.files.filter((q) => q.id !== s.id); if (eq?.id === s.id) st.equipped = null; }
        g.audio.play('icon_drop');
      }
    }
    if (!slots.length) drawWrapped(ctx, 'Empty! Drag any desktop icon onto the bait box, or drop a real file from your computer onto the window.', r.x + 20, r.y + 60, W - 40, { color: '#c8a878' });
    // special baits
    drawText(ctx, 'Special bait', r.x + 12, r.y + 132, { color: '#f4d8a8' });
    let k = 0;
    for (const id of BAIT_ORDER) {
      const n = st.baits[id] || 0;
      if (!n) continue;
      const x = r.x + 14 + (k % perRow) * (cell + 1), y = r.y + 144 + Math.floor(k / perRow) * (cell + 1);
      k++;
      const rr = { x, y, w: cell - 2, h: cell - 2 };
      const hov = ui.hover(rr);
      const on = eq?.kind === 'special' && eq.id === id;
      ctx.fillStyle = rgba(on ? '#ffe27a' : '#1a0e06', on ? 0.35 : 0.55);
      ctx.fillRect(x, y, cell - 2, cell - 2);
      const spr = baitSprite(id, this.t);
      ctx.drawImage(spr, Math.round(x + (cell - 2 - spr.width * 2) / 2), Math.round(y + 5), spr.width * 2, spr.height * 2);
      drawText(ctx, 'x' + n, x + cell - 5, y + cell - 9, { font: 'small', align: 'right', color: '#ffffff', outline: '#1a0e06' });
      if (hov) hoverInfo = { title: BAITS[id].name, text: BAITS[id].desc, extra: 'Used up when a fish is caught or steals it.' };
      if (ui.clicked(rr)) g.equip('special', id);
    }
    if (!k) drawText(ctx, 'Buy special bait from Pinch\'s shop.', r.x + 20, r.y + 152, { color: '#c8a878' });
    // info strip
    drawPaper(ctx, r.x + 10, r.y + H - 52, W - 20, 42, {});
    if (hoverInfo) {
      drawText(ctx, hoverInfo.title, r.x + 18, r.y + H - 47, { color: '#2a1a10' });
      drawWrapped(ctx, hoverInfo.text, r.x + 18, r.y + H - 36, W - 36, { color: '#5a4a3a', font: 'small', lineHeight: 7 });
      drawText(ctx, hoverInfo.extra, r.x + W - 18, r.y + H - 47, { align: 'right', font: 'small', color: '#8a6a4a' });
    } else {
      const b = g.currentBait();
      drawText(ctx, b ? `Equipped: ${b.label}` : 'Nothing equipped - fish only nibble at bait!', r.x + 18, r.y + H - 47, { color: '#2a1a10' });
      drawText(ctx, 'Click a slot to put it on your hook.', r.x + 18, r.y + H - 34, { color: '#6a5a4a' });
    }
    if (ui.button(ctx, r.x + W - 96, r.y + H - 74, 84, 18, 'Restore all', { icon: 'home', style: 'shell', tip: 'Put every icon back on the desktop' })) g.command('restore');
  }
}
