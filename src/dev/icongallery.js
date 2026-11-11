// [icons15] Dev preview: every detailed voxel UI icon on the full-res 2x layer (src/gfx/voxicon.js, bigicons.js).
// node tools/build.mjs --dev icongallery -> dist/dev/icongallery.html?page=0|1|2|3&px=44&spin=1
//   page 0: menu / HUD icons (ICON_MODELS) at 44 / 32 / 22 px + rods + gems + coin
//   page 1: icons3d (getUiIcon 3D glyphs) at px      page 2: items (itemSprite) + fishing icons + chests + decor
//   page 3: Lab icons (labIcon) at px
import { hiCtx } from '../gfx/hires.js';
import { drawText } from '../gfx/font.js';
import { iconFrame, rodIcon, gemIcon, decorFrame, cutGemFrame, modelFrame } from '../gfx/bigicons.js';
import { ICON_VOX } from '../gfx/iconvox.js';
import { ICON_MODELS } from '../gfx/iconmeshes.js';
import { ICON3D, icon3dFrame } from '../gfx/icons3d.js';
import { icon3d as fishIcon } from '../fishing/icons3d.js';
import { ART_IDS, itemSprite } from '../build/itemart.js';
import { RARITY } from '../core/color.js';
import { RODS } from '../game/rods.js';

export async function run(params) {
  const cv = document.getElementById('screen');
  const W = 960, H = 540;
  cv.width = W * 2; cv.height = H * 2; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = hiCtx(cv, 2);
  const page = Number(params.get('page') || 0), PX = Number(params.get('px') || 44), spin = params.get('spin') === '1';
  let labIcon = null, labKeys = [];
  if (page === 3) {
    const L = await import('../ui/labicons.js');
    labIcon = L.labIcon;
    const lab = await import('../game/lab.js').catch(() => null);
    const nodes = (lab && lab.LAB_NODES) || [];
    labKeys = (Array.isArray(nodes) ? nodes : Object.values(nodes || {})).map((n) => n.icon).filter(Boolean);
    labKeys = [...new Set(labKeys)].slice(0, 80);
  }
  if (params.get('bench')) { // ms per detailed frame (1x + 2x twin) for each hand-built icon at 44 px
    const out = {};
    for (const [k, make] of Object.entries(ICON_VOX)) { const t0 = performance.now(); modelFrame('bench:' + k, make, 44, 0, true); modelFrame('bench:' + k, make, 44, 0.5, true); out[k] = +((performance.now() - t0) / 2).toFixed(1); }
    window.__bench = out;
  }
  const draw = () => {
    const t = performance.now() / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#dff6ff'); gr.addColorStop(1, '#7cc8f0');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const put = (f, x, y) => { if (f) g.drawImage(f.canvas || f, Math.round(x - (f.ox ?? (f.width || f.canvas.width) / 2)), Math.round(y - (f.oy ?? (f.height || f.canvas.height) / 2))); };
    const label = (s, x, y) => drawText(g, String(s).slice(0, 10), x, y, { font: 'small', align: 'center', color: '#0c3a52' });
    if (page === 0) {
      const ids = ['lab', 'quests', 'aquarium', 'fishmgr', 'journal', 'inventory', 'wardrobe', 'build', 'map', 'shop', 'bait', 'multiplayer', 'settings', 'coin', ...Object.keys(ICON_MODELS).filter((k) => !['lab', 'quests', 'aquarium', 'journal', 'inventory', 'wardrobe', 'map', 'shop', 'bait', 'multiplayer', 'settings', 'coin'].includes(k))].slice(0, 24);
      ids.forEach((id, i) => {
        const x = 34 + (i % 12) * 77, y = 40 + Math.floor(i / 12) * 150;
        put(iconFrame(id, 44, spin ? t * 0.3 : 0), x, y);
        put(iconFrame(id, 32, 0), x - 14, y + 58);
        put(iconFrame(id, 22, 0), x + 20, y + 60);
        label(id, x, y + 80);
      });
      (RODS || []).slice(0, 10).forEach((r, i) => { const c = rodIcon(r, 48); if (c) g.drawImage(c, 20 + i * 62, 360); label(r.id, 44 + i * 62, 412); });
      Object.keys(RARITY).forEach((k, i) => { put(gemIcon(RARITY[k].color, 18), 30 + i * 30, 450); put(gemIcon(RARITY[k].color, 12), 30 + i * 30, 474); });
      ['round', 'diamond', 'square', 'drop', 'heart', 'clover', 'oval', 'hex'].forEach((c, i) => put(cutGemFrame('#35c8ff', c, 16), 260 + i * 26, 452));
      ['leaves', 'leaves_l', 'shell', 'starfish', 'bubbles', 'pearl', 'coral'].forEach((n, i) => put(decorFrame(n, 30, 0), 500 + i * 40, 460));
    } else if (page === 1) {
      const names = Object.keys(ICON3D);
      const cols = Math.floor((W - 20) / (PX + 16));
      names.forEach((n, i) => {
        const x = 20 + (i % cols) * (PX + 16) + PX / 2, y = 18 + Math.floor(i / cols) * (PX + 14) + PX / 2;
        put(icon3dFrame(n, PX, spin ? t * 0.3 : 0), x, y);
        label(n, x, y + PX / 2 + 1);
      });
    } else if (page === 2) {
      const ids = [...ART_IDS];
      ids.forEach((id, i) => {
        const x = 30 + (i % 16) * 58, y = 40 + Math.floor(i / 16) * 70;
        const s = itemSprite(id, { scale: PX / 44, frame: spin ? Math.floor(t * 4) : 0 });
        if (s) g.drawImage(s.canvas, Math.round(x - s.ox), Math.round(y + 20 - s.oy));
        label(id, x, y + 24);
      });
      ['bolt', 'mouse', 'space', 'trophy', 'chest', 'chest_crate', 'chest_gold', 'chest_orb', 'skull', 'heart'].forEach((n, i) => { put(fishIcon(n, 40, 0), 40 + i * 70, 470); label(n, 40 + i * 70, 496); });
    } else if (labIcon) {
      labKeys.forEach((k, i) => {
        const x = 26 + (i % 16) * 58, y = 30 + Math.floor(i / 16) * 62;
        const c = labIcon(k, PX);
        if (c) g.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
        label(k, x, y + PX / 2 + 2);
      });
    }
    requestAnimationFrame(draw);
  };
  draw();
}
