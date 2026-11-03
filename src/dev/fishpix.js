// Dev preview for the Frutiger Aero fish (phase 3): voxel fish by default, &style=pixel for the 2D rig.
// dist/dev/fishpix.html?mode=grid&biome=oscean&scale=1.6   roster grid of one ocean (or ids=a,b,c)
//   mode=emo&ids=a,b     every expression on a few species (big)
//   mode=swim&biome=x    a live ocean-like tank: real Fish AI (incl. the Wakka quirk), n=<count>
//   &frozen for a still frame
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig, beginRigFrame, rigStats, setFishStyle } from '../gfx/fishrig.js';
import { setVoxelSync, beginVoxelFishFrame } from '../gfx/voxelfish.js';
import { rigGeom } from '../gfx/fishart.js';
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { RARITY } from '../core/color.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { Fish } from '../fish/fish.js';
import { rollIndividual } from '../fish/traits.js';

const W = 960, H = 540;
let MAXS = 3;
const EMO = ['neutral', 'happy', 'sad', 'angry', 'scared', 'surprised', 'love', 'sleepy', 'dizzy', 'smug', 'determined', 'tired', 'disgust'];

function bg(g, top = '#7fdcff', bot = '#1a78c2') {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, top); gr.addColorStop(1, bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}

const fit = new Map();
function fitScale(sp, w, h) {
  const k = sp.id + w + 'x' + h;
  if (fit.has(k)) return fit.get(k);
  const c = compiled(sp.look, null, sp.id);
  let s;
  if (c.kind === 'chain') s = Math.min(1.6, w / (c.chain.segs * c.chain.r * 1.15 + c.chain.r * 4));
  else { const g = rigGeom(c, { sw: 0, angle: 0, scale: 1, inflate: 0, still: true }); s = Math.min(MAXS, w / (g.w * 0.8), h / (g.h * 0.8)); }
  fit.set(k, s);
  return s;
}

export function run(params) {
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  const mode = params.get('mode') || 'grid';
  MAXS = Number(params.get('maxs') || 3);
  if (params.get('style') === 'pixel') setFishStyle('pixel');
  const frozen = params.has('frozen');
  if (frozen) setVoxelSync(true);
  const ids = params.get('ids')?.split(',').filter((id) => SPECIES_BY_ID[id]);
  const biome = params.get('biome') || 'oscean';
  const list = ids?.length ? ids.map((id) => SPECIES_BY_ID[id]) : SPECIES.filter((s) => s.biome === biome || biome === 'all');
  const cols = Number(params.get('cols') || (list.length > 12 ? 6 : 4));
  let mouse = null;
  cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); mouse = [(e.clientX - r.left) / 2, (e.clientY - r.top) / 2]; });
  let t = 0, last = performance.now();
  const world = mode === 'swim' ? makeWorld(list, Number(params.get('n') || 20)) : null;
  window.__fp = { world, rigStats };
  let fpsT = 0, fpsN = 0, fps = 0, worst = 0;
  function frame() {
    const now = performance.now();
    const dt = frozen ? 0 : Math.min(0.05, (now - last) / 1000);
    worst = Math.max(worst, now - last);
    last = now;
    t += dt;
    fpsT += dt; fpsN++;
    if (fpsT > 1) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0; window.__fp.fps = fps; window.__fp.worst = worst; worst = 0; }
    beginRigFrame();
    beginVoxelFishFrame();
    if (mode === 'grid') drawGrid(g, list, cols, t, frozen, mouse);
    else if (mode === 'emo') drawEmo(g, list, t, frozen);
    else drawSwim(g, world, dt, t);
    drawText(g, `${mode} ${biome} ${list.length} species  ${fps ? fps.toFixed(0) + ' fps' : ''}`, 6, 4, { font: 'small', color: '#ffffff', shadow: '#0a2a4a' });
    if (!frozen || !window.__warm) { if (frozen) window.__warm = (window.__warm || 0) + 1; if (!frozen || window.__warm < 3) requestAnimationFrame(frame); }
  }
  frame();
}

function drawGrid(g, list, cols, t, frozen, mouse) {
  bg(g);
  const rows = Math.ceil(list.length / cols);
  const cw = W / cols, ch = (H - 16) / rows;
  list.forEach((sp, i) => {
    const x = cw * (i % cols) + cw / 2, y = 16 + ch * Math.floor(i / cols) + ch * 0.44;
    const c = compiled(sp.look, null, sp.id);
    const s = fitScale(sp, cw * 0.8, ch * 0.62);
    const ph = frozen ? 0.15 + i * 0.07 : t * 0.9 + i * 0.3;
    drawFishRig(g, c, {
      x, y, scale: s, time: frozen ? 0.3 : t, swimPhase: ph, tailPhase: frozen ? ph : t * 1.6 + i, finPhase: frozen ? ph : t * 1.1 + i,
      emotion: 'neutral', mouth: 0, blink: 0, speed01: 0.5, lookX: mouse?.[0] ?? null, lookY: mouse?.[1] ?? null,
      inflate: sp.quirks?.includes('inflate') && !frozen ? Math.max(0, Math.sin(t * 0.8)) : 0,
    });
    const r = RARITY[sp.rarity];
    drawText(g, sp.name, x, y + ch * 0.4, { font: 'small', align: 'center', color: '#ffffff', shadow: '#0a2a4a' });
    drawText(g, r.name, x, y + ch * 0.4 + 9, { font: 'small', align: 'center', color: r.color, shadow: '#0a2a4a' });
  });
}

function drawEmo(g, list, t, frozen) {
  bg(g);
  const n = Math.min(list.length, 4);
  const cw = W / 7, rh = (H - 20) / (n * 2);
  for (let r = 0; r < n; r++) {
    const sp = list[r];
    const c = compiled(sp.look, null, sp.id);
    EMO.forEach((e, j) => {
      const x = cw * (j % 7) + cw / 2, y = 20 + (r * 2 + Math.floor(j / 7)) * rh + rh * 0.45;
      const s = fitScale(sp, cw * 0.85, rh * 0.8);
      drawFishRig(g, c, { x, y, scale: s, time: frozen ? 0.3 : t, swimPhase: frozen ? 0.2 : t, emotion: e, mouth: e === 'happy' ? 0.5 : 0, blink: 0 });
      drawText(g, e, x, y + rh * 0.42, { font: 'small', align: 'center', color: '#ffffff', shadow: '#0a2a4a' });
    });
  }
}

function makeWorld(list, n) {
  const world = {
    W, H, surfaceY: 30, fishes: [], cursor: { x: -999, y: -999, speed: 0, inWorld: false }, hook: null,
    floorAt: () => H - 40, particles: null, audio: null, night: false, glowLevel: 0,
  };
  for (let i = 0; i < n; i++) {
    const sp = list[i % list.length];
    const f = new Fish(rollIndividual(sp, {}), sp, world, { x: 60 + Math.random() * (W - 120), y: 80 + Math.random() * (H - 160), z: Math.random() * 0.6 });
    f.scale *= 1.5;
    world.fishes.push(f);
  }
  return world;
}

function drawSwim(g, world, dt, t) {
  bg(g, '#9ae8ff', '#2a8ad8');
  for (const f of world.fishes) f.update(dt);
  const list = world.fishes.slice().sort((a, b) => b.z - a.z);
  const t0 = performance.now();
  for (const f of list) f.draw(g, f.z > 0.3 ? { color: '#bfefff', alpha: f.z * 0.4 } : null, t);
  world.drawMs = performance.now() - t0;
  const st = rigStats();
  drawText(g, `draw ${world.drawMs.toFixed(1)}ms  cache ${st.items}`, W - 6, 4, { font: 'small', align: 'right', color: '#ffffff', shadow: '#0a2a4a' });
}
