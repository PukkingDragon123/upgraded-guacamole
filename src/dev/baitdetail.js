// Dev preview: every bait's detailed voxel model at the 2x UI resolution, its toy-block hotbar icon and its
// hook frames. node tools/build.mjs --dev baitdetail -> dist/dev/baitdetail.html[?page=1|2&px=60&tier=0&ph=0]
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { BAITS, SPECIAL_ORDER, CHARMS, COLOURS } from '../store/bait.js';
import { baitIcon, baitHook } from '../fishing/baitart.js';
import { CATALOG } from '../store/catalog.js';

export function run(params) {
  const cv = document.getElementById('screen');
  const W = 1920, H = 1080;
  cv.width = W; cv.height = H;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const g = ctxOf(cv);
  const page = Number(params.get('page') || 0), px = Number(params.get('px') || 60), tier = Number(params.get('tier') || 0);
  const ph = Number(params.get('ph') || 0);
  let arts;
  if (page === 0) arts = SPECIAL_ORDER.map((id) => [id, BAITS[id].art]);
  else if (page === 1) arts = CATALOG.map((f) => [f.id, BAITS[`${f.id}_${['lite', 'standard', 'pro', 'ultra', 'enterprise'][tier]}`]?.art]).filter((x) => x[1]);
  else arts = CHARMS.map((c, i) => [c.id, { ...BAITS[i % 2 ? 'sugar' : 'music_pro'].art, custom: true, color: COLOURS[i % COLOURS.length].hex, charm: c.id }]);
  let t = 0;
  const frame = () => {
    t += 1 / 60;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#bfeaff'); gr.addColorStop(1, '#2c9fe6');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const cols = 6, cw = W / cols, ch = H / Math.ceil(arts.length / cols);
    arts.forEach(([id, art], i) => {
      const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch / 2 - 20;
      const big = baitIcon(art, px, ph || t * 0.7);
      const hi = big.canvas.hi || big.canvas;
      const k = hi === big.canvas ? 2 : 1;
      if (big.glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.6; const gh = big.glow.hi || big.glow; const gk = gh === big.glow ? 2 : 1; g.drawImage(gh, Math.round(cx - gh.width * gk / 2), Math.round(cy - gh.height * gk / 2), gh.width * gk, gh.height * gk); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
      g.drawImage(hi, Math.round(cx - hi.width * k / 2), Math.round(cy - hi.height * k / 2), hi.width * k, hi.height * k);
      const toy = baitIcon(art, 18);
      const th = toy.canvas.hi || toy.canvas, tk = th === toy.canvas ? 2 : 1;
      g.drawImage(th, Math.round(cx - cw / 2 + 10), Math.round(cy + 60), th.width * tk, th.height * tk);
      const hk = baitHook(art, t);
      g.drawImage(hk.canvas, Math.round(cx + cw / 2 - hk.canvas.width * 2 - 10), Math.round(cy + 60), hk.canvas.width * 2, hk.canvas.height * 2);
      drawText(g, id, cx, cy + 110, { align: 'center', color: '#0c3a52', scale: 2 });
    });
    requestAnimationFrame(frame);
  };
  frame();
}
