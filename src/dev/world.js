// Dev preview for the world agent: dist/dev/world.html
//   ?view=boats            every boat tier on a calm sea (params: dir=-1, roll=index 0..6, night=1, paint=#hex)
//   ?view=horizon          the voxel horizon / sky features of each biome
// The full scene (sky, surface view, water shader) is best checked in the real game:
//   node tools/shot.mjs "?skipintro&watergl=force" out.png 4000 1920 1080 "FISHTOP.camera.scrollTo(FISHTOP.surfaceScroll)"
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { Boat } from '../world/boat.js';
import { BOAT_TIERS } from '../world/boatmodels.js';
import { THEMES, coralModel, reefFormation, renderCoral, voxAnim, placeAnim } from '../world/coral.js';
import { palmIsland, lighthouseIslet, sailboat, seaStacks, markerBuoy, factory, gantryCrane, containerStack, rockSpires } from '../world/horizon.js';

function fakeGame(W, H, params, tier) {
  const g = {
    screen: { W, H },
    state: { view: 'ocean', boat: { tier }, character: params.get('paint') ? { boat: params.get('paint') } : undefined },
    world: { cursor: { x: -100, y: -100 }, night: params.get('night') === '1' },
    input: { down: false },
    ocean: { waterLevel: () => H * 0.62, waveAt: () => Math.round(H * 0.62), biome: { fogColor: '#2a8ab0' }, travelState: null },
    water: null,
    fishing: { hook: { visible: false } },
  };
  return g;
}

export function run(params) {
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  const view = params.get('view') || 'boats';
  const night = params.get('night') === '1';
  if (view === 'coral') {
    const themeId = params.get('theme') || 'shallows';
    const theme = THEMES[themeId];
    const scale = Number(params.get('scale') || 1.5);
    ctx.fillStyle = { shallows: '#2a9ac0', junkyard: '#2e6a5e', abyss: '#14204a' }[themeId];
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = { shallows: '#d8c08a', junkyard: '#6e6a56', abyss: '#2e3450' }[themeId];
    ctx.fillRect(0, H * 0.42, W, 6); ctx.fillRect(0, H * 0.97, W, 6);
    const kinds = ['staghorn', 'table', 'fan', 'brain', 'tube', 'bubble', 'pillar', 'whip'];
    kinds.forEach((k, i) => {
      const spr = renderCoral(coralModel(k, 10 + i, theme, Number(params.get('size') || 22)), scale, theme);
      ctx.drawImage(spr.canvas, Math.round(60 + i * 112 - spr.ox), Math.round(H * 0.42 - spr.oy));
      drawText(ctx, k, 60 + i * 112, H * 0.42 + 10, { align: 'center', color: '#fff', outline: '#000' });
    });
    const t0 = performance.now();
    [[170, 0], [480, 1], [790, 2]].forEach(([x, i]) => {
      const spr = renderCoral(reefFormation(40 + i, theme, {}), scale, theme);
      ctx.drawImage(spr.canvas, Math.round(x - spr.ox), Math.round(H * 0.97 - spr.oy));
    });
    console.log('formations ms', Math.round(performance.now() - t0));
    const anims = ['anemone', 'soft', 'kelp', 'seagrass'].map((k, i) => ({ a: placeAnim(voxAnim(k, 5 + i, themeId, k === 'kelp' ? 14 : 18, scale), 60 + i * 80, H * 0.62), k }));
    let t = 0;
    const loop = () => {
      requestAnimationFrame(loop);
      t += 1 / 60;
      ctx.fillStyle = { shallows: '#2a9ac0', junkyard: '#2e6a5e', abyss: '#14204a' }[themeId];
      ctx.fillRect(0, H * 0.44, 380, H * 0.2);
      for (const { a } of anims) ctx.drawImage(a.frame(t), a.x, a.y);
    };
    loop();
    return;
  }
  if (view === 'horizon') {
    ctx.fillStyle = night ? '#0a1430' : '#8ccff0';
    ctx.fillRect(0, 0, W, H);
    const items = [palmIsland(4, {}), lighthouseIslet(7, {}), sailboat(9, {}), seaStacks(12, {}), markerBuoy('#e2483a'), factory(21, {}), gantryCrane(23, {}), containerStack(25, {}), rockSpires(31, {})];
    let x = 10, y = 150, rowH = 0;
    for (const it of items) {
      if (x + it.w > W - 10) { x = 10; y += rowH + 20; rowH = 0; }
      ctx.drawImage(it.base, x, y - it.oy);
      ctx.fillStyle = '#ff3a3a'; ctx.fillRect(x + it.ox - 1, y, 3, 1);
      x += it.w + 16; rowH = Math.max(rowH, it.h);
    }
    return;
  }
  const dir = Number(params.get('dir') || 1);
  const boats = BOAT_TIERS.map((_, i) => {
    const g = fakeGame(W, H, params, i);
    const b = new Boat(g);
    b.dir = dir;
    b.roll = Number(params.get('roll') ? [-8, -5.3, -2.7, 0, 2.7, 5.3, 8][Number(params.get('roll'))] : 0);
    return { g, b };
  });
  const lv = Math.round(H * 0.62);
  const slots = [0.09, 0.25, 0.44, 0.66, 0.88];
  let t = 0, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    ctx.fillStyle = night ? '#0a1430' : '#9ad8f4';
    ctx.fillRect(0, 0, W, lv);
    ctx.fillStyle = night ? '#0c2a4a' : '#2a9ac0';
    ctx.fillRect(0, lv, W, H - lv);
    boats.forEach(({ g, b }, i) => {
      b.x = Math.round(W * slots[i]);
      const r0 = b.roll;
      b.update(dt, null);
      b.roll = r0; b.y = lv;
      g.screen.W = W * 4; // keep the drag clamp out of the way
      b.draw(ctx, {});
      if (night) b.drawLights(ctx, 0.6);
      drawText(ctx, `${i} ${BOAT_TIERS[i].name}`, b.x, lv + 60, { align: 'center', color: '#ffffff', outline: '#06121e' });
      const rt = b.rodTip();
      ctx.fillStyle = '#ff2a6a'; ctx.fillRect(Math.round(rt[0]) - 1, Math.round(rt[1]) - 1, 3, 3);
    });
  }
  requestAnimationFrame(frame);
}
