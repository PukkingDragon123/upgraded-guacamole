// Dev preview for src/gfx/lowpoly.js (dist/dev/lowpoly.html): a sample lofted fish at several angles + a 3D scene.
import { MeshBuilder, loft, fin, renderMesh, LPScene, T4, lpAvailable } from '../gfx/lowpoly.js';

export function sampleFish(body = '#e8742a', belly = '#f6e2c4', finCol = '#ffb36a') {
  const mb = new MeshBuilder();
  const prof = [[-1, 0.02, 0.02], [-0.8, 0.12, 0.07], [-0.5, 0.26, 0.14], [-0.15, 0.34, 0.18], [0.2, 0.33, 0.17], [0.55, 0.24, 0.12], [0.8, 0.12, 0.06], [0.95, 0.05, 0.03]];
  loft(mb, prof.map(([x, ry, rz]) => ({ x, ry, rz })), 10, (i, j) => (j >= 3 && j <= 7 ? belly : body));
  fin(mb, [[0.9, 0], [1.25, 0.28], [1.18, 0], [1.25, -0.28]], 0, finCol);
  fin(mb, [[-0.1, 0.3], [0.1, 0.55], [0.35, 0.32]], 0, finCol);
  return mb.build();
}

export function run() {
  const cv = document.createElement('canvas');
  cv.width = 960; cv.height = 540;
  cv.style.cssText = 'width:100vw;height:100vh;image-rendering:pixelated;background:#2a7fc0';
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  g.fillStyle = '#3a8fd0'; g.fillRect(0, 0, 960, 540);
  window.__lp = lpAvailable();
  const m = sampleFish();
  [0, 0.5, 1.2, 1.57, 2.4, 3.14].forEach((yaw, i) => {
    const c = renderMesh(m, { w: 140, h: 90, yaw, pitch: 0.15 });
    if (c) g.drawImage(c, 20 + i * 150, 20);
  });
  const sc = new LPScene(480, 270);
  for (let i = 0; i < 6; i++) sc.add(m, T4.trs([(i - 2.5) * 1.6, Math.sin(i) * 0.6, -i * 0.8], 0, 0.6 + i * 0.4, 0, 0.8));
  sc.camera({ eye: [0, 1.5, 7], target: [0, 0, -1] });
  const out = sc.render({ background: [0.1, 0.45, 0.75, 1], fog: 1.5, fogColor: '#2a7fc0' });
  if (out) g.drawImage(out, 240, 160);
  window.__done = true;
}
