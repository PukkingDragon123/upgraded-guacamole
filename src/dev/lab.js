// Dev preview: Lab icons (node orbs) and the radial tree layout.  node tools/build.mjs --dev lab
//   ?view=icons (default) | tree
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { labIcon, GLYPHS } from '../ui/labicons.js';
import { LAB_NODES, BRANCHES } from '../game/lab.js';
import { drawGlossOrb } from '../ui/aero.js';

export function run(params) {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#eaf8ff'); grd.addColorStop(1, '#9fd8f4');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (params.get('view') === 'tree') {
    const cx = W / 2, cy = H / 2, z = 0.55;
    for (const n of LAB_NODES) for (const r of n.req) {
      const p = LAB_NODES.find((q) => q.id === r);
      g.strokeStyle = 'rgba(40,120,180,0.5)'; g.beginPath(); g.moveTo(cx + p.pos[0] * z, cy + p.pos[1] * z); g.lineTo(cx + n.pos[0] * z, cy + n.pos[1] * z); g.stroke();
    }
    for (const n of LAB_NODES) {
      const x = cx + n.pos[0] * z, y = cy + n.pos[1] * z;
      drawGlossOrb(g, x, y, 9, BRANCHES[n.branch]?.color || '#ffffff');
      const ic = labIcon(n.icon, 12);
      if (ic) g.drawImage(ic, Math.round(x - ic.width / 2), Math.round(y - ic.height / 2));
    }
    window.__ready = true;
    return;
  }
  const keys = [...GLYPHS, 'rod:twig', 'rod:bubble', 'rod:glass', 'rod:volt', 'rod:trident', 'rod:prism', 'rod:aerolite',
    'boat:raft', 'boat:dinghy', 'boat:skiff', 'boat:hydrofoil', 'boat:yacht', 'boat:catamaran', 'boat:submarine',
    'tank:jar', 'tank:bowl', 'tank:smalltank', 'tank:bigtank', 'tank:reeftank', 'tank:wallaquarium',
    'biome:oscean', 'biome:shallows', 'biome:fjord', 'biome:junkyard', 'biome:metropolis', 'biome:volcano', 'biome:abyss',
    'bait:worm', 'bait:golden', 'bait:relic', 'bp:coral_garden', 'bp:lighthouse', 'bp:totem', 'mat:pearl'];
  const cols = 14, cw = W / cols;
  keys.forEach((k, i) => {
    const x = (i % cols) * cw + cw / 2, y = Math.floor(i / cols) * 74 + 30;
    drawGlossOrb(g, x - 14, y, 13, '#35c8ff');
    const a = labIcon(k, 18);
    if (a) g.drawImage(a, Math.round(x - 14 - a.width / 2), Math.round(y - a.height / 2));
    const b = labIcon(k, 40);
    if (b) g.drawImage(b, Math.round(x + 18 - b.width / 2), Math.round(y - b.height / 2));
    drawText(g, k.slice(0, 14), x, y + 26, { font: 'small', align: 'center', color: '#0c3a52' });
  });
  window.__ready = true;
}
