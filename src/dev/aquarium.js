// temporary backdrop preview (replaced by the full aquarium dev page)
import { ctxOf } from '../core/canvas.js';
import { TankSpace, renderBackdrop, renderGlass } from '../aquarium/tank3d.js';

export function run(params) {
  const cv = document.getElementById('screen');
  const W = 960, H = 540;
  cv.width = W; cv.height = H; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  const t0 = performance.now();
  const T = new TankSpace(W, 524, { vpy: 0.46, surf: 10, floorFront: 480, slope: 24, cell: 5, step: 2 });
  const bd = renderBackdrop(T);
  const gl = renderGlass(T, { edges: true });
  console.log('backdrop ms', Math.round(performance.now() - t0));
  g.drawImage(bd.canvas, 0, 0);
  g.drawImage(gl, 0, 0);
}
