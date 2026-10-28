// Dev preview of the species collection and the layered fish rig.
// dist/dev/species.html?page=N  (&frozen for a deterministic still frame)
//  0-2  biomes (rig, animated, eyes follow the mouse)      3-5  same biomes at angle -0.4, blinking, mirrored cells
//  6    every emotion on several kinds                      7    rig features: layers, talk, look, turn, squash, wash, inflate
//  8    random mutations / shiny per species                9    baked frame() API for every species

import { compiled, frame } from '../gfx/spritecache.js';
import { drawFishRig, rigStats, beginRigFrame } from '../gfx/fishrig.js';
import { rasterLayer, rigGeom, rigLayers } from '../gfx/fishart.js';
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { RARITY } from '../core/color.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';

const W = 960, H = 540;
const BIOMES = ['shallows', 'junkyard', 'abyss'];
const BG = { shallows: ['#3a9cc4', '#1f6a94'], junkyard: ['#3a5a52', '#1c2e30'], abyss: ['#141a36', '#05070f'] };
const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'scared', 'surprised', 'love', 'sleepy', 'dizzy', 'smug', 'determined', 'tired', 'disgust'];
const MUTS = ['albino', 'melanistic', 'neon', 'pastel', 'golden', 'inverted', 'ghost', 'crimson', 'ocean', 'galaxy'];
const TITLES = ['Sunny Shallows', 'Junkyard Reef', 'The Midnight Abyss', 'Shallows: angle -0.4 + blink + flip', 'Junkyard: angle -0.4 + blink + flip',
  'Abyss: angle -0.4 + blink + flip', 'Emotions', 'Rig features', 'Mutations + shiny', 'Baked frame() API'];

const comp = (sp, variant = null) => compiled(sp.look, variant, sp.id);

function bg(g, top, bot) {
  for (let y = 0; y < H; y += 4) {
    const t = y / H;
    const a = top.match(/\w\w/g).map((h) => parseInt(h, 16)), b = bot.match(/\w\w/g).map((h) => parseInt(h, 16));
    g.fillStyle = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
    g.fillRect(0, y, W, 4);
  }
}

function label(g, sp, x, y) {
  const r = RARITY[sp.rarity];
  drawText(g, sp.name, x, y, { font: 'small', align: 'center', color: r.color, shadow: '#05070c' });
  drawText(g, r.name + ' ' + '*'.repeat(r.stars), x, y + 8, { font: 'small', align: 'center', color: r.dark, shadow: '#05070c' });
}

// Cell layout for one biome: 16 species in a 4x4 grid + the legendary in a tall right column.
function biomeCells(biome) {
  const list = SPECIES.filter((s) => s.biome === biome);
  const leg = list.filter((s) => s.rarity === 'legendary');
  const rest = list.filter((s) => s.rarity !== 'legendary');
  const cells = rest.map((sp, i) => ({ sp, x: 90 + (i % 4) * 180, y: 64 + Math.floor(i / 4) * 124, ly: 44 }));
  leg.forEach((sp) => cells.push({ sp, x: 836, y: 270, ly: 150 }));
  return cells;
}

function stateFor(sp, t, frozen, i, extra = {}) {
  const sw = frozen ? 0.15 + i * 0.07 : t * (0.9 + (i % 3) * 0.15);
  const blinkT = (t * 0.7 + i * 0.37) % 4;
  return {
    swimPhase: sw, tailPhase: frozen ? sw * 1.3 : t * 1.6 + i * 0.1, finPhase: frozen ? sw * 0.7 : t * 1.1 + i * 0.2,
    time: frozen ? 0.25 : t, blink: frozen ? 0 : blinkT < 0.12 ? 1 - Math.abs(blinkT - 0.06) / 0.06 : 0,
    speed01: 0.5, emotion: 'neutral', mouth: 0, ...extra,
  };
}

export function run(params) {
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  const frozen = params.has('frozen');
  const page = Number(params.get('page') || 0);
  let mouse = null;
  cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); mouse = [(e.clientX - r.left) / 2, (e.clientY - r.top) / 2]; });
  let t = 0, last = performance.now();
  const errors = [];
  function draw() {
    const now = performance.now();
    t += frozen ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    beginRigFrame();
    try {
      if (page <= 5) drawBiome(g, BIOMES[page % 3], page >= 3, t, frozen, mouse);
      else if (page === 6) drawEmotions(g, t, frozen);
      else if (page === 7) drawFeatures(g, t, frozen);
      else if (page === 8) drawMutations(g, t, frozen);
      else drawBaked(g, t, frozen);
    } catch (e) {
      errors.push(e);
      console.error(e);
      return;
    }
    drawText(g, `PAGE ${page}/9  ${TITLES[page] || ''}`, 8, 6, { font: 'small', color: '#ffffff', shadow: '#000000' });
    const st = rigStats();
    drawText(g, `${st.items} cached  ${st.rasterized} rasterised  ${st.fallbacks} fallbacks`, W - 8, 6, { font: 'small', color: '#9fb4c8', shadow: '#000000', align: 'right' });
    if (!frozen) requestAnimationFrame(draw);
    else if (!window.__warm) { window.__warm = true; requestAnimationFrame(draw); }
  }
  draw();
  window.__speciesReady = true;
}

function drawBiome(g, biome, second, t, frozen, mouse) {
  bg(g, ...BG[biome]);
  biomeCells(biome).forEach((cell, i) => {
    const { sp, x, y } = cell;
    const c = comp(sp);
    const facing = second && (i & 1) ? -1 : 1;
    const st = stateFor(sp, t, frozen, i, {
      x, y, facing,
      angle: second ? -0.4 : 0,
      blink: second ? 1 : stateFor(sp, t, frozen, i).blink,
      lookX: mouse && !frozen ? mouse[0] : null, lookY: mouse && !frozen ? mouse[1] : null,
      inflate: sp.id === 'puffer' && !frozen && !second ? Math.max(0, Math.sin(t * 0.8)) : 0,
      pose: sp.id === 'shortcut' && !frozen && Math.sin(t * 0.6) > 0.5,
      chain: null,
    });
    drawFishRig(g, c, st);
    label(g, sp, x, y + cell.ly);
  });
}

function drawEmotions(g, t, frozen) {
  bg(g, '#2f6f8f', '#173a52');
  const ids = ['honk', 'googly', 'purin', 'clickcrab', 'dumbo', 'vampsquid', 'noodle'];
  const cw = (W - 40) / EMOTIONS.length;
  EMOTIONS.forEach((e, j) => drawText(g, e, 40 + cw * j + cw / 2 - 10, 20, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' }));
  ids.forEach((id, r) => {
    const sp = SPECIES_BY_ID[id];
    const c = comp(sp);
    const y = 62 + r * 69;
    drawText(g, sp.name.split(' ')[0], 4, y - 3, { font: 'small', color: RARITY[sp.rarity].color, shadow: '#000' });
    EMOTIONS.forEach((e, j) => {
      const x = 40 + cw * j + cw / 2 - 10;
      const talk = frozen ? (e === 'happy' ? 0.5 : 0) : Math.max(0, Math.sin(t * 9 + j)) * (j % 3 === 0 ? 0.8 : 0);
      drawFishRig(g, c, stateFor(sp, t, frozen, j, { x, y: y + (id === 'noodle' ? 0 : 6), emotion: e, mouth: talk, blink: 0, scale: id === 'noodle' ? 0.6 : 0.85 }));
    });
  });
}

function drawFeatures(g, t, frozen) {
  bg(g, '#2a6a88', '#12283a');
  const ft = frozen ? 0.6 : t;
  // 1) layer breakdown: each layer of a fish on its own phase, then the composite
  const demo = [SPECIES_BY_ID.honk, SPECIES_BY_ID.lionfish, SPECIES_BY_ID.clickcrab];
  demo.forEach((sp, r) => {
    const c = comp(sp);
    const y = 70 + r * 92;
    const layers = rigLayers(c);
    const geo = rigGeom(c, { sw: 0, angle: 0, scale: 1 });
    layers.forEach((L, i) => {
      const ph = L.phase === 'tail' ? ft * 1.6 : L.phase === 'fin' ? ft * 1.1 : ft * 0.9;
      const fr = Math.floor((ph % 1) * L.frames) / L.frames;
      const lr = rasterLayer(c, L.id, { ph: fr, angle: 0, scale: 1 });
      const x = 50 + i * 82;
      if (lr.canvas) g.drawImage(lr.canvas, Math.round(x - geo.ox + lr.x), Math.round(y - geo.oy + lr.y));
      drawText(g, `${L.id} (${L.phase})`, x, y + 36, { font: 'small', align: 'center', color: '#cfe6ff', shadow: '#000' });
    });
    const x = 50 + layers.length * 82 + 30;
    drawFishRig(g, c, { x, y, time: ft, swimPhase: ft * 0.9, tailPhase: ft * 1.6, finPhase: ft * 1.1, emotion: 'happy', mouth: 0 });
    drawText(g, 'composite', x, y + 36, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  });
  // 2) talking / chomping, eyes tracking a moving target, turn-around, squash & stretch
  const tx = 700 + Math.cos(ft * 1.3) * 60, ty = 100 + Math.sin(ft * 1.7) * 40;
  g.fillStyle = '#ffe066'; g.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 3, 3);
  const honk = comp(SPECIES_BY_ID.honk), koi = comp(SPECIES_BY_ID.koi), puff = comp(SPECIES_BY_ID.puffer), googly = comp(SPECIES_BY_ID.googly);
  const talk = (k) => (frozen ? 0.6 : Math.abs(Math.sin(ft * k)));
  drawFishRig(g, honk, { x: 640, y: 60, time: ft, swimPhase: ft, lookX: tx, lookY: ty, mouth: talk(8), emotion: 'neutral' });
  drawFishRig(g, googly, { x: 760, y: 70, time: ft, swimPhase: ft, lookX: tx, lookY: ty, speed01: 1, emotion: 'neutral' });
  drawFishRig(g, honk, { x: 880, y: 60, time: ft, swimPhase: ft, lookX: tx, lookY: ty, mouth: talk(11), emotion: 'angry' });
  drawText(g, 'look + talk', 760, 128, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  const turn = frozen ? 0.3 : Math.cos(ft * 1.2);
  drawFishRig(g, koi, { x: 680, y: 190, time: ft, swimPhase: ft, turn, emotion: 'surprised' });
  const sq = frozen ? 0.6 : Math.sin(ft * 3);
  drawFishRig(g, honk, { x: 860, y: 190, time: ft, swimPhase: ft, squash: sq, emotion: sq > 0 ? 'determined' : 'scared' });
  drawText(g, 'turn (scaleX)     squash/stretch', 770, 240, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  // 3) inflate, wash (fog / darkness), silhouette, glow strength
  const inf = frozen ? 1 : Math.max(0, Math.sin(ft * 0.9));
  drawFishRig(g, puff, { x: 640, y: 330, time: ft, swimPhase: ft, inflate: inf, emotion: inf > 0.5 ? 'angry' : 'neutral', mouth: inf > 0.5 ? 0.4 : 0 });
  drawFishRig(g, honk, { x: 760, y: 320, time: ft, swimPhase: ft, wash: { color: '#9fc8e0', alpha: 0.55 } });
  drawFishRig(g, honk, { x: 880, y: 320, time: ft, swimPhase: ft, wash: { color: '#05070f', alpha: 0.7 } });
  drawText(g, 'inflate     fog wash     dark wash', 760, 380, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  g.fillStyle = '#060912'; g.fillRect(560, 400, 400, 140);
  const angler = comp(SPECIES_BY_ID.loadingangler), jelly = comp(SPECIES_BY_ID.glowjelly);
  drawFishRig(g, angler, { x: 640, y: 470, time: ft, swimPhase: ft, glow: frozen ? 1 : 0.5 + 0.5 * Math.sin(ft * 3) });
  drawFishRig(g, jelly, { x: 760, y: 450, time: ft, swimPhase: ft, tailPhase: ft * 1.3, finPhase: ft });
  drawFishRig(g, honk, { x: 880, y: 470, time: ft, swimPhase: ft, silhouette: true });
  drawText(g, 'glow pulse      jelly glow      silhouette', 760, 528, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  // 4) chains following a path (game supplies points head-first)
  const noodle = comp(SPECIES_BY_ID.noodle), cable = comp(SPECIES_BY_ID.cableeel);
  for (const [c, x0, y0, sp] of [[noodle, 300, 360, 1], [cable, 300, 470, 1.4]]) {
    const pts = [];
    for (let i = 0; i < c.chain.segs; i++) {
      const u = ft * sp - i * 0.13;
      pts.push({ x: x0 + Math.cos(u) * 120 - i * 2, y: y0 + Math.sin(u * 2) * 26 });
    }
    drawFishRig(g, c, { x: pts[0].x, y: pts[0].y, time: ft, chain: pts, emotion: c === noodle ? 'love' : 'determined' });
  }
}

function drawMutations(g, t, frozen) {
  bg(g, '#26405a', '#0c1420');
  SPECIES.forEach((sp, i) => {
    const mut = MUTS[i % MUTS.length];
    const shiny = i % 5 === 2;
    const v = { mutation: mut, shiny, shinyHue: sp.shinyHue, pattern: i % 4 === 1 ? ['spots', 'stripes', 'bands'][i % 3] : null, seed: i + 1 };
    const c = comp(sp, v);
    const col = i % 9, row = Math.floor(i / 9);
    const x = 54 + col * 106, y = 52 + row * 88;
    const scale = sp.rarity === 'legendary' ? 0.4 : sp.look.body?.len > 60 || sp.look.kind === 'chain' ? 0.6 : 0.8;
    drawFishRig(g, c, stateFor(sp, t, frozen, i, { x, y, scale }));
    drawText(g, mut + (shiny ? '+shiny' : '') + (v.pattern ? '+' + v.pattern : ''), x, y + 34, { font: 'small', align: 'center', color: '#cfe6ff', shadow: '#000' });
  });
}

function drawBaked(g, t, frozen) {
  bg(g, '#2b6f8f', '#173a52');
  SPECIES.forEach((sp, i) => {
    const c = comp(sp);
    const col = i % 9, row = Math.floor(i / 9);
    const x = 54 + col * 106, y = 52 + row * 88;
    const scale = sp.rarity === 'legendary' ? 0.4 : sp.look.body?.len > 60 || sp.look.kind === 'chain' ? 0.6 : 0.8;
    const f = frame(c, { phase: frozen ? 0.2 : t, angle: i % 2 ? -0.4 : 0, scale, blink: i % 3 === 0, mouth: i % 4 === 0, expr: i % 5 === 0 ? 'happy' : undefined, inflate: sp.id === 'puffer' ? 1 : 0 });
    g.drawImage(f.canvas, Math.round(x - f.ox), Math.round(y - f.oy));
    if (f.glowCanvas) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5; g.drawImage(f.glowCanvas, Math.round(x - f.ox), Math.round(y - f.oy)); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    drawText(g, sp.name, x, y + 34, { font: 'small', align: 'center', color: RARITY[sp.rarity].color, shadow: '#000' });
  });
}
