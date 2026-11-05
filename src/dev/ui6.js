// Dev preview for the phase 6 UI pass (dist/dev/ui6.html?page=N): 0 = 3D icons + spin frames, 1 = fonts & widgets.
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { getBigIcon, iconFrame, rodIcon, gemIcon } from '../gfx/bigicons.js';
import { drawButton, drawTooltip, drawTab } from '../ui/panels.js';
import { drawAeroLabel, drawAeroBadge, drawAeroFrame, setUiScale, ecoBackdrop } from '../ui/aero.js';
import { RARITY } from '../core/color.js';

const IDS = ['lab', 'aquarium', 'journal', 'inventory', 'wardrobe', 'map', 'shop', 'bait', 'multiplayer', 'settings', 'quests', 'coin'];

export function run(params) {
  const cv = document.getElementById('screen') || document.body.appendChild(document.createElement('canvas'));
  cv.width = 960; cv.height = 540;
  cv.style.cssText = 'width:1920px;height:1080px;image-rendering:pixelated';
  const g = ctxOf(cv);
  setUiScale(params.get('scale') || 'big');
  g.drawImage(ecoBackdrop(960, 540, { seed: 3 }), 0, 0);
  const page = Number(params.get('page') || 0);
  if (page === 0) {
    IDS.forEach((id, i) => {
      const x = 20 + (i % 6) * 156, y = 14 + Math.floor(i / 6) * 120;
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, 148, 112);
      const b = getBigIcon(id, { size: 48 });
      g.drawImage(b.canvas, x + 4, y + 4);
      const s = getBigIcon(id, { size: 24 });
      g.drawImage(s.canvas, x + 60, y + 4);
      for (let k = 0; k < 4; k++) {
        const f = iconFrame(id, 32, k / 4 * (id === 'map' || id === 'settings' || id === 'coin' || id === 'bait' ? 1 : 1) - (k ? 0 : 0));
        if (f) g.drawImage(f.canvas, x + 2 + k * 36 - f.ox + 18, y + 80 - f.oy);
      }
      drawText(g, id, x + 92, y + 8, { color: '#ffffff', shadow: '#0a3e74' });
    });
    const rods = [{ id: 'a', color: '#2f9ef0' }, { id: 'b', color: '#ff6a3a', accent: '#ffd44a' }, { id: 'c', color: '#9a6ae0' }];
    rods.forEach((r, i) => { const c = rodIcon(r, 48); if (c) g.drawImage(c, 20 + i * 60, 270); });
    Object.keys(RARITY).forEach((k, i) => { const c = gemIcon(RARITY[k].color, 20); if (c) g.drawImage(c, 220 + i * 30, 280); const c2 = gemIcon(RARITY[k].color, 36); if (c2) g.drawImage(c2, 220 + i * 44, 310); });
    IDS.forEach((id, i) => { const b = getBigIcon(id, { size: 64 }); g.drawImage(b.canvas, 20 + i * 76, 400); });
  } else {
    const s = 'The quick brown fox jumps over the lazy dog! 0123456789';
    drawText(g, s, 20, 20, { font: 'big', color: '#0c3a52', shadow: '#ffffff' });
    drawText(g, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz', 20, 40, { font: 'big', color: '#ffffff', shadow: '#0a3e74' });
    drawText(g, '.,!?\':;-+=/()<>%*$&#@[]{}_ "x" 1,250 Aero  12:45  x10  99+', 20, 60, { font: 'big', color: '#ffffff', shadow: '#0a3e74' });
    drawText(g, s, 20, 80, { font: 'normal', color: '#ffffff', shadow: '#0a3e74' });
    drawText(g, 'FishDex  Satchel  Bait Shop  Multiplayer', 20, 96, { font: 'big', scale: 2, color: '#ffffff', shadow: '#0a3e74' });
    let x = 20;
    for (const st of ['normal', 'hover', 'down', 'disabled']) { drawButton(g, x, 140, 110, 22, { label: 'Go Fishing', icon: 'hook', state: st, style: 'aqua' }); x += 120; }
    drawButton(g, 500, 140, 90, 22, { label: 'Export', style: 'green', font: 'small' });
    drawTab(g, 20, 180, 90, 22, { label: 'Shallows', icon: 'sun', active: true });
    drawTab(g, 112, 180, 90, 22, { label: 'Junkyard', icon: 'gear' });
    drawAeroLabel(g, 'The Lab', 240, 182, {});
    drawAeroBadge(g, 360, 180, 3, 0); drawAeroBadge(g, 390, 180, '!', 0);
    drawTooltip(g, 420, 170, 'Sir Puffington  Uncommon. A longer tooltip that wraps onto a second line.');
    const F = drawAeroFrame(g, 20, 240, 440, 260, { title: 'FishDex', icon: getBigIcon('journal', { size: 'small' }).canvas });
    F.finish();
  }
  window.__done = true;
}
