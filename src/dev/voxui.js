// Dev preview (phase 10 UI): the voxel chrome + voxel icons on the full-res 2x layer. dist/dev/voxui.html
import { hiCtx } from '../gfx/hires.js';
import { drawText } from '../gfx/font.js';
import { getBigIcon, iconFrame, rodIcon, gemIcon } from '../gfx/bigicons.js';
import { drawButton, drawTooltip, drawTab, drawSlider, drawToggle, drawBar, drawPaper, drawPlank } from '../ui/panels.js';
import { drawAeroLabel, drawAeroBadge, drawAeroFrame, drawAeroPanel, drawAeroCard, drawAeroBar, setUiScale, ecoBackdrop } from '../ui/aero.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { RARITY } from '../core/color.js';

export function run(params) {
  const cv = document.getElementById('screen');
  const W = 960, H = 540;
  cv.width = W * 2; cv.height = H * 2; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = hiCtx(cv, 2);
  setUiScale('big');
  const draw = () => {
    const t = performance.now() / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(ecoBackdrop(W, H, { seed: 3 }), 0, 0);
    let x = 16;
    for (const st of ['normal', 'hover', 'down', 'disabled']) { drawButton(g, x, 14, 120, 24, { label: 'Go Fishing', icon: getUiIcon('hook'), state: st, style: 'aqua' }); x += 128; }
    drawButton(g, 530, 14, 90, 24, { label: 'Export', style: 'green' });
    drawButton(g, 630, 14, 24, 24, { label: '', icon: getUiIcon('cross'), style: 'close' });
    drawTab(g, 16, 50, 100, 24, { label: 'Shallows', icon: getUiIcon('sun'), active: true });
    drawTab(g, 118, 50, 100, 24, { label: 'Junkyard', icon: getUiIcon('gear') });
    drawAeroLabel(g, 'The Lab', 240, 54, {});
    drawAeroBadge(g, 360, 52, 3, 0); drawAeroBadge(g, 390, 52, '!', 0);
    drawSlider(g, 420, 54, 140, 0.6, {});
    drawToggle(g, 580, 52, true, {}); drawToggle(g, 630, 52, false, {});
    drawAeroBar(g, 16, 86, 200, 12, 0.66, { color: '#7ed957' });
    drawAeroBar(g, 230, 86, 200, 16, 0.3, { color: '#ffb22a' });
    drawTooltip(g, 450, 84, 'Sir Puffington  Uncommon. A longer tooltip that wraps onto a second line.');
    const F = drawAeroFrame(g, 16, 130, 420, 250, { title: 'FishDex', icon: getBigIcon('journal', { size: 'small' }).canvas });
    drawAeroCard(g, F.content.x + 6, F.content.y + 6, 180, 90, {});
    drawAeroPanel(g, F.content.x + 200, F.content.y + 6, 190, 120, { tone: 'glass', title: 'Glass panel' });
    drawPlank(g, F.content.x + 6, F.content.y + 110, 180, 24, { label: 'Plank' });
    F.finish();
    drawAeroPanel(g, 460, 130, 200, 120, { tone: 'sky', title: 'Sky panel' });
    drawAeroPanel(g, 670, 130, 200, 120, { tone: 'dark', title: 'Dark panel' });
    drawAeroPanel(g, 460, 260, 200, 120, { tone: 'grass', title: 'Grass panel' });
    const ids = ['lab', 'aquarium', 'journal', 'inventory', 'wardrobe', 'map', 'shop', 'bait', 'multiplayer', 'settings', 'quests', 'coin'];
    ids.forEach((id, i) => { const f = iconFrame(id, 44, Math.sin(t + i) * 0.2); if (f) g.drawImage(f.canvas, 30 + i * 60 - f.ox, 420 - f.oy); });
    Object.keys(RARITY).forEach((k, i) => { const c = gemIcon(RARITY[k].color, 18); if (c) g.drawImage(c, 680 + i * 26, 270); });
    const rods = [{ id: 'a', look: { shaft: '#2f9ef0' } }, { id: 'b', look: { shaft: '#ff6a3a' } }];
    rods.forEach((r, i) => { const c = rodIcon(r, 48); if (c) g.drawImage(c, 680 + i * 56, 300); });
    ['star', 'heart', 'check', 'cross', 'lock', 'coin', 'aero', 'gear', 'trophy', 'fish'].forEach((n, i) => { const c = getUiIcon(n); g.drawImage(c, 30 + i * 30, 470); const c2 = getUiIcon(n, 2); g.drawImage(c2, 330 + i * 34, 466); });
    requestAnimationFrame(draw);
  };
  draw();
}
import { VOXICON_STATS } from '../gfx/voxicon.js';
window.__vox = VOXICON_STATS;
