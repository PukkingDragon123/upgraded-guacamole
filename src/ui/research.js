// Research Lab interior ('research'): a cosy house of science. Left: the room (ceiling beams, fishy wallpaper,
// porthole onto the sea with passing fish, a chalkboard that writes out the current project, bookshelf, specimen
// jars with tiny fish, a desk with microscope and a mug, a bench of bubbling flasks over a burner, a hanging
// lamp) and Professor Bubbles, a goofy scientist fish who wanders, explains and celebrates. Right: the lab
// notebook - timed projects (coins / materials / fish samples) that unlock blueprints, baits, building
// upgrades and perks. Progress runs on wall-clock timestamps, so it continues while you are away.

import { clamp, clamp01, lerp, ease, TAU, formatCommas, hash2 } from '../core/math.js';
import { rgba, RARITY, shade, mix } from '../core/color.js';
import { rng } from '../core/rng.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawPlank, drawBubble, drawBar } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { drawFishFit, fitScale } from './journal.js';
import { ITEMS } from '../build/items.js';
import { findBuilding, levelOf } from '../build/buildings.js';
import { PROJECTS, PROJECT_BY_ID, researchState, researchStatus, researchProgress, researchSlots, researchTime, startResearch, claimResearch, canAfford, PERK_NAMES } from '../build/research.js';
import { drawItem } from '../build/itemdraw.js';
import { drawCost, fmtTime } from './buildpanel.js';

const PROF_LOOK = {
  toon: true,
  body: { len: 34, h: 28, shape: 'round', tip: 0.3 },
  col: { body: '#6ab8e8', belly: '#e8f8ff', back: '#3a7ab8', fin: '#ffb84a' },
  shade: { back: -0.25, belly: 0.3 },
  pattern: [{ type: 'spots', color: '#2a5a9a', size: 1.4, density: 0.35, only: 'top' }],
  tail: { type: 'fan', len: 9, spread: 8 },
  dorsal: { type: 'round', from: 0.5, to: 0.75, h: 6 },
  pectoral: { len: 8 },
  eye: { type: 'googly', r: 6.5, u: 0.24, v: -0.42 },
  moreEyes: [{ type: 'googly', r: 5.4, u: 0.42, v: -0.58, behind: true }],
  mouth: { type: 'small', v: 0.3 },
  extras: [{ type: 'mustache', color: '#f4f4f0', color2: '#c8ccd8' }],
  scales: false,
};

const LINES = {
  hello: ['Ah! A visitor! Mind the beakers.', 'Welcome to my laboratory! Bubbles, PhD.', 'Science waits for no fish!', 'Did you bring samples? I LOVE samples.'],
  idle: ['Hypothesis: fish like fish.', 'I once split an atom. It was very small.', 'Hmm, needs more kelp. Everything needs more kelp.', 'Do NOT drink the green one.', 'Eureka! No wait. False alarm.', 'My mustache is 40% of my brain power.', 'The chalkboard does not lie. Usually.'],
  start: ['Splendid! To the beakers!', 'Science, commence!', 'Ooh, this one will be fun.', 'I shall begin at once. After a snack.'],
  done: ['EUREKA! It works!', 'Research complete! I am a genius!', 'Results are in and they are FISHTASTIC!'],
  broke: ['We need more materials for that one.', 'Our funding is... fishy.', 'Bring me samples! Catch more fish!'],
  busy: ['All benches are bubbling already!', 'One experiment at a time, please! Upgrade my lab for more benches.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------- static room art (cached)
const roomCache = new Map();
function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

function roomArt(W, H) {
  const key = W + 'x' + H;
  let c = roomCache.get(key);
  if (c) return c;
  c = makeCanvas(W, H);
  const g = ctxOf(c);
  const floorY = Math.round(H * 0.7);
  // wallpaper: warm teal with stripes and a tiny fish motif
  px(g, 0, 0, W, floorY, '#2e6e72');
  for (let x = 0; x < W; x += 12) { px(g, x, 0, 6, floorY, '#337a7c'); px(g, x + 6, 0, 1, floorY, '#285e62'); }
  for (let y = 26; y < floorY - 50; y += 22) for (let x = (y / 22) % 2 ? 4 : 10; x < W; x += 24) {
    px(g, x, y, 4, 2, '#4a9a94'); px(g, x - 2, y - 1, 2, 4, '#4a9a94'); px(g, x + 3, y, 1, 1, '#1e4e52');
  }
  // ceiling beams + crown moulding
  px(g, 0, 0, W, 14, '#4a2a18');
  for (let x = 6; x < W; x += 64) { px(g, x, 0, 18, 16, '#6a3e22'); px(g, x, 0, 18, 2, '#8a5a32'); px(g, x + 16, 0, 2, 16, '#3a2010'); }
  px(g, 0, 14, W, 3, '#c89a5a'); px(g, 0, 17, W, 1, '#5a3a20');
  // wainscoting
  const wy = floorY - 46;
  px(g, 0, wy, W, 46, '#7a4a2a');
  px(g, 0, wy, W, 3, '#a8703e'); px(g, 0, wy + 3, W, 1, '#4a2a18');
  for (let x = 4; x < W; x += 40) { px(g, x, wy + 9, 34, 30, '#6a3e22'); px(g, x, wy + 9, 34, 1, '#8a5a32'); px(g, x, wy + 38, 34, 1, '#4a2a18'); px(g, x + 33, wy + 9, 1, 30, '#4a2a18'); }
  px(g, 0, floorY - 4, W, 4, '#5a3420');
  // floor planks
  for (let y = floorY; y < H; y += 6) {
    px(g, 0, y, W, 6, (y / 6) % 2 ? '#8a5a34' : '#94623a');
    px(g, 0, y + 5, W, 1, '#6a4024');
    for (let x = ((y / 6) % 3) * 23; x < W; x += 70) px(g, x, y, 1, 5, '#5a3420');
  }
  // rug: concentric oval rings with a fringe
  const rx = W * 0.5, ry = floorY + (H - floorY) * 0.62, rw = W * 0.28, rh = (H - floorY) * 0.3;
  const RUG = ['#8a2a2a', '#c84a3a', '#f0d8a8', '#3a7a8a', '#f0d8a8', '#c84a3a'];
  for (let yy = -rh; yy <= rh; yy++) for (let xx = -rw; xx <= rw; xx += 1) {
    const d = Math.sqrt((xx / rw) ** 2 + (yy / rh) ** 2);
    if (d > 1) continue;
    const ring = Math.min(RUG.length - 1, Math.floor((1 - d) * 7));
    px(g, rx + xx, ry + yy, 1, 1, RUG[ring]);
  }
  for (let xx = -rw + 4; xx <= rw - 4; xx += 3) { const e = Math.sqrt(Math.max(0, 1 - (xx / rw) ** 2)); px(g, rx + xx, ry + rh * e, 1, 2, '#f0d8a8'); }
  // bookshelf (right)
  const bx = Math.round(W * 0.78), bw = Math.round(W * 0.19), by = 30, bh = floorY - 30;
  px(g, bx - 2, by - 2, bw + 4, bh + 4, '#3a2010');
  px(g, bx, by, bw, bh, '#5a3420');
  const shelves = 5;
  for (let s = 0; s < shelves; s++) {
    const sy = by + Math.round(((s + 1) * bh) / (shelves + 0.3));
    px(g, bx, sy, bw, 3, '#8a5a32'); px(g, bx, sy + 3, bw, 1, '#2a1408');
    let x = bx + 3;
    while (x < bx + bw - 6) {
      const w = 3 + Math.floor(hash2(x, s, 4) * 4), h = 12 + Math.floor(hash2(x, s, 5) * 8);
      if (hash2(x, s, 9) < 0.12 && s === 1) { // a fish skull
        px(g, x, sy - 7, 9, 6, '#e8e0d0'); px(g, x + 2, sy - 6, 2, 2, '#2a2020'); px(g, x + 6, sy - 4, 3, 1, '#a8a090'); x += 12; continue;
      }
      const col = ['#c84a3a', '#3a6ab8', '#d8a83a', '#4a9a5a', '#8a4ab0', '#e07a3a', '#2a8a8a'][Math.floor(hash2(x, s, 6) * 7)];
      const lean = hash2(x, s, 7) < 0.1 ? 1 : 0;
      px(g, x + lean, sy - h, w, h, col);
      px(g, x + lean, sy - h, 1, h, shade(col, 0.3));
      px(g, x + lean, sy - h + 3, w, 1, shade(col, -0.4)); px(g, x + lean, sy - 4, w, 1, '#f0d8a0');
      x += w + (hash2(x, s, 8) < 0.15 ? 3 : 0);
    }
  }
  // potted kelp on top of the shelf
  px(g, bx + bw - 16, by - 12, 10, 10, '#b8583a'); px(g, bx + bw - 17, by - 13, 12, 2, '#d8784a');
  for (let i = 0; i < 18; i++) px(g, bx + bw - 12 + Math.round(Math.sin(i * 0.6) * 2), by - 14 - i, 2, 1, i % 4 ? '#4f9a52' : '#7ac85a');
  // desk (left front)
  const dx = Math.round(W * 0.04), dw = Math.round(W * 0.3), dy = floorY - 10;
  px(g, dx, dy, dw, 7, '#9a6a3a'); px(g, dx, dy, dw, 2, '#c8925a'); px(g, dx, dy + 7, dw, 1, '#4a2a18');
  px(g, dx + 4, dy + 8, 6, 24, '#6a3e22'); px(g, dx + dw - 10, dy + 8, 6, 24, '#6a3e22'); px(g, dx + 2, dy + 31, 10, 2, '#4a2a18'); px(g, dx + dw - 12, dy + 31, 10, 2, '#4a2a18');
  px(g, dx + dw - 46, dy + 8, 36, 22, '#7a4a28'); px(g, dx + dw - 46, dy + 8, 36, 1, '#9a6a3a');
  px(g, dx + dw - 30, dy + 17, 6, 2, '#e0a844'); px(g, dx + dw - 30, dy + 25, 6, 2, '#e0a844');
  // papers on the desk
  px(g, dx + 30, dy - 2, 22, 3, '#f4ead2'); px(g, dx + 33, dy - 3, 20, 2, '#fffaf0'); px(g, dx + 36, dy - 2, 12, 1, '#8a8aa8');
  // microscope
  const mx = dx + 14, my = dy;
  px(g, mx - 4, my - 3, 14, 3, '#3a3a4a'); px(g, mx + 4, my - 22, 3, 19, '#5a5a6a'); px(g, mx - 2, my - 26, 6, 10, '#7a8094');
  px(g, mx - 1, my - 30, 4, 4, '#b8c2d0'); px(g, mx - 3, my - 14, 8, 2, '#3a3a4a'); px(g, mx + 1, my - 12, 2, 4, '#9ad0ff');
  // lab bench (right front)
  const lx = Math.round(W * 0.52), lw = Math.round(W * 0.24), ly = floorY - 4;
  px(g, lx, ly, lw, 6, '#d8d0c0'); px(g, lx, ly, lw, 1, '#ffffff'); px(g, lx, ly + 6, lw, 1, '#6a6458');
  px(g, lx + 4, ly + 7, 4, 26, '#8a8478'); px(g, lx + lw - 8, ly + 7, 4, 26, '#8a8478');
  px(g, lx + 3, ly + 24, lw - 6, 2, '#a8a090'); px(g, lx + 2, ly + 33, 8, 2, '#5a5448'); px(g, lx + lw - 10, ly + 33, 8, 2, '#5a5448');
  // sample crates under the bench
  for (let i = 0; i < 2; i++) { const cx0 = lx + 14 + i * 22; px(g, cx0, ly + 12, 18, 12, '#b07a48'); px(g, cx0, ly + 12, 18, 1, '#d8a870'); px(g, cx0, ly + 17, 18, 1, '#8a5a32'); px(g, cx0 + 4, ly + 14, 10, 3, '#f4ead2'); }
  // potted sea-plant in the front corner + a framed diploma on the wall
  const ppx = Math.round(W * 0.9), ppy = H - 26;
  px(g, ppx, ppy, 18, 16, '#b8583a'); px(g, ppx - 2, ppy - 2, 22, 3, '#d8784a'); px(g, ppx + 2, ppy + 4, 14, 1, '#8a3a2a');
  for (let k = 0; k < 5; k++) for (let i = 0; i < 26 - k * 3; i++) px(g, ppx + 3 + k * 3 + Math.round(Math.sin(i * 0.4 + k) * 2), ppy - 3 - i, 2, 1, (i + k) % 5 ? '#4f9a52' : '#7ac85a');
  const fx0 = Math.round(W * 0.06), fy0 = Math.round(H * 0.07);
  px(g, fx0, fy0, 26, 18, '#c8902a'); px(g, fx0 + 2, fy0 + 2, 22, 14, '#f4ead2');
  for (let i = 0; i < 3; i++) px(g, fx0 + 5, fy0 + 5 + i * 3, 16 - i * 3, 1, '#8a8aa8');
  px(g, fx0 + 17, fy0 + 11, 4, 4, '#c8283a');
  // test-tube rack
  px(g, lx + lw - 30, ly - 6, 24, 2, '#9a6a3a'); px(g, lx + lw - 30, ly - 2, 24, 2, '#9a6a3a');
  for (let i = 0; i < 4; i++) { const tx = lx + lw - 28 + i * 6; px(g, tx, ly - 16, 3, 14, '#d8f4ff'); px(g, tx, ly - 8, 3, 6, ['#ff5a8a', '#5aff9a', '#ffd84a', '#5ab4ff'][i]); }
  // wall shelf with specimen jars (left of chalkboard)
  const sx = Math.round(W * 0.05), sw = Math.round(W * 0.2), sy = Math.round(H * 0.44);
  px(g, sx, sy, sw, 3, '#8a5a32'); px(g, sx, sy + 3, sw, 1, '#2a1408');
  px(g, sx + 4, sy + 4, 2, 6, '#5a3420'); px(g, sx + sw - 6, sy + 4, 2, 6, '#5a3420');
  c.meta = { floorY, desk: { x: dx, y: dy, w: dw }, bench: { x: lx, y: ly, w: lw }, shelf: { x: sx, y: sy, w: sw }, books: { x: bx, w: bw } };
  roomCache.set(key, c);
  return c;
}

export class ResearchPanel {
  constructor() {
    this.id = 'research';
    this.modal = true;
    this.sound = 'box_open';
    this.t = 0;
    this.sel = null;
    this.scroll = 0;
  }

  open() {
    this.t = 0;
    this.scroll = 0;
    this.prof = { x: 0.45, tx: 0.45, y: 0, face: 1, mood: 'happy', moodT: 2, hop: 0, think: 0, wanderT: 4 };
    this.say(pick(LINES.hello), 'happy');
    this.idleT = 8;
    this.jarFish = this.jarFish || pickJarFish(this.game.state);
    this.outside = [];
    const st = this.game.state;
    const r = researchState(st);
    if (!this.sel || !PROJECT_BY_ID[this.sel]) this.sel = (r.active.find((a) => Date.now() >= a.end) || r.active[0])?.id || PROJECTS.find((p) => researchStatus(st, p.id) === 'available')?.id || PROJECTS[0].id;
    this.chalk = 0;
    this.celebrate = 0;
  }

  say(text, mood = 'happy') {
    this.line = text;
    this.lineT = 0;
    this.talkT = clamp(text.length * 0.05, 0.8, 2.8);
    if (this.prof) { this.prof.mood = mood; this.prof.moodT = this.talkT + 1; }
    this.game.audio.babble?.(text, 'fish');
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    this.t += dt;
    const t = this.t;
    const W = Math.min(g.screen.W - 20, 920), H = Math.min(g.screen.H - 46, 470);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) + 10, w: W, h: H };
    this.rect = { x: r.x, y: r.y - 26, w: W, h: H + 26 };
    drawWood(ctx, r.x, r.y, W, H, { tone: 'dark' });
    drawPlank(ctx, r.x + W / 2 - 110, r.y - 20, 220, 22, { rope: 8, label: "PROF. BUBBLES' LAB" });
    if (ui.button(ctx, r.x + W - 25, r.y + 7, 18, 18, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    const lab = findBuilding(st, 'research_lab');
    const sc = { x: r.x + 8, y: r.y + 8, w: Math.round(W * 0.58), h: H - 16 };
    this.drawRoom(ctx, ui, sc, t, dt);
    const nb = { x: sc.x + sc.w + 8, y: r.y + 8, w: r.x + W - 8 - (sc.x + sc.w + 8), h: H - 16 };
    this.drawNotebook(ctx, ui, nb, t, dt, lab);
    this.idleT -= dt;
    if (this.idleT <= 0) { this.idleT = 10 + Math.random() * 6; this.say(pick(LINES.idle), pick(['happy', 'smug', 'surprised', 'neutral'])); }
  }

  // ------------------------------------------------------------------ the room
  drawRoom(ctx, ui, sc, t, dt) {
    const g = this.game, st = g.state;
    const room = roomArt(sc.w, sc.h);
    const M = room.meta;
    ctx.save();
    ctx.beginPath(); ctx.rect(sc.x, sc.y, sc.w, sc.h); ctx.clip();
    ctx.drawImage(room, sc.x, sc.y);
    const X = (v) => sc.x + v, Y = (v) => sc.y + v;
    // porthole onto the sea
    const pr = Math.round(sc.h * 0.11), pcx = X(Math.round(sc.w * 0.15)), pcy = Y(Math.round(sc.h * 0.22));
    this.drawPorthole(ctx, pcx, pcy, pr, t, dt);
    // chalkboard
    const cb = { x: X(Math.round(sc.w * 0.3)), y: Y(28), w: Math.round(sc.w * 0.44), h: Math.round(sc.h * 0.36) };
    this.drawChalkboard(ctx, cb, t, dt);
    // specimen jars on the wall shelf
    const jars = this.jarFish;
    const js = M.shelf;
    for (let i = 0; i < 3; i++) {
      const jx = X(js.x + 4 + i * Math.round((js.w - 6) / 3)), jy = Y(js.y) - 30, jw = 24, jh = 30;
      ctx.fillStyle = rgba('#5affb0', 0.25); ctx.fillRect(jx + 1, jy + 5, jw - 2, jh - 6);
      const sp = jars[i] && SPECIES_BY_ID[jars[i]];
      if (sp) {
        ctx.save(); ctx.beginPath(); ctx.rect(jx + 1, jy + 5, jw - 2, jh - 6); ctx.clip();
        drawFishFit(ctx, sp, jx + jw / 2 + Math.sin(t * 0.8 + i) * 2, jy + 15 + Math.sin(t * 1.3 + i * 2) * 1.5, fitScale(sp, 19, 14, 0.75), t + i, { wash: { color: '#3aaa7a', alpha: 0.25 } });
        ctx.restore();
      }
      ctx.fillStyle = rgba('#d8fff4', 0.35); ctx.fillRect(jx + 2, jy + 6, 2, jh - 9);
      ctx.fillStyle = '#c8eeff'; ctx.fillRect(jx, jy + 4, 1, jh - 4); ctx.fillRect(jx + jw - 1, jy + 4, 1, jh - 4); ctx.fillRect(jx, jy + jh - 1, jw, 1);
      ctx.fillStyle = '#c08a50'; ctx.fillRect(jx - 1, jy, jw + 2, 4); ctx.fillStyle = '#e0aa70'; ctx.fillRect(jx - 1, jy, jw + 2, 1);
      ctx.fillStyle = '#f4ead2'; ctx.fillRect(jx + 5, jy + jh - 8, jw - 10, 5); ctx.fillStyle = '#8a6a4a'; ctx.fillRect(jx + 6, jy + jh - 6, jw - 12, 1);
      if (Math.random() < dt * 0.6) g.particles?.add({ kind: 'dot', x: jx + 4 + Math.random() * 10, y: jy + jh - 4, vy: -10, life: 1.2, color: '#d8fff4', layer: 'ui', g: 0 });
    }
    // flasks bubbling on the bench
    const B = M.bench;
    const flasks = [[0.18, '#ff5a8a', 'round'], [0.42, '#5affb0', 'cone'], [0.62, '#ffd84a', 'tall']];
    const running = researchState(st).active.length > 0;
    flasks.forEach(([fx, col, kind], i) => {
      const x = X(B.x + Math.round(B.w * fx)), y = Y(B.y);
      this.drawFlask(ctx, x, y, col, kind, t + i, running ? 1 : 0.35);
    });
    // burner flame under the middle flask
    const bxp = X(B.x + Math.round(B.w * 0.42));
    ctx.fillStyle = '#5a5a6a'; ctx.fillRect(bxp - 3, Y(B.y) - 2, 7, 2);
    if (running) {
      const fl = Math.sin(t * 30) > 0 ? 1 : 0;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#5ab4ff', 0.9); ctx.fillRect(bxp - 1, Y(B.y) - 5 - fl, 3, 3 + fl);
      ctx.fillStyle = rgba('#ffffff', 0.8); ctx.fillRect(bxp, Y(B.y) - 4, 1, 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    // desk mug with steam + lamp glow
    const D = M.desk;
    const mgx = X(D.x + D.w - 24), mgy = Y(D.y) - 7;
    ctx.fillStyle = '#e8584a'; ctx.fillRect(mgx, mgy, 7, 7); ctx.fillStyle = '#ff8a7a'; ctx.fillRect(mgx, mgy, 7, 1);
    ctx.fillStyle = '#e8584a'; ctx.fillRect(mgx + 7, mgy + 2, 2, 3);
    for (let i = 0; i < 3; i++) { const k = ((t * 0.8 + i / 3) % 1); ctx.fillStyle = rgba('#ffffff', 0.4 * (1 - k)); ctx.fillRect(Math.round(mgx + 3 + Math.sin(k * 6 + i) * 2), Math.round(mgy - 2 - k * 12), 1, 2); }
    // hanging lamp + warm cone
    const hx = X(Math.round(sc.w * 0.52)), hy = Y(46);
    ctx.fillStyle = '#2a1a10'; ctx.fillRect(hx, Y(14), 1, hy - Y(14));
    ctx.fillStyle = '#3a6a4a'; ctx.fillRect(hx - 8, hy, 17, 5); ctx.fillRect(hx - 5, hy - 3, 11, 3);
    ctx.fillStyle = '#5a9a6a'; ctx.fillRect(hx - 8, hy, 17, 1);
    ctx.fillStyle = '#fff6c8'; ctx.fillRect(hx - 3, hy + 5, 7, 2);
    ctx.globalCompositeOperation = 'lighter';
    const fl = 0.07 + 0.01 * Math.sin(t * 7);
    ctx.fillStyle = rgba('#ffd890', fl);
    ctx.beginPath(); ctx.moveTo(hx - 7, hy + 6); ctx.lineTo(hx + 8, hy + 6); ctx.lineTo(hx + 90, Y(M.floorY + 30)); ctx.lineTo(hx - 90, Y(M.floorY + 30)); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // Professor Bubbles
    this.drawProf(ctx, ui, sc, M, t, dt);
    // vignette edges
    ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(sc.x, sc.y, 3, sc.h); ctx.fillRect(sc.x + sc.w - 3, sc.y, 3, sc.h);
    ctx.restore();
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(sc.x - 1, sc.y - 1, sc.w + 2, 1); ctx.fillRect(sc.x - 1, sc.y + sc.h, sc.w + 2, 1); ctx.fillRect(sc.x - 1, sc.y, 1, sc.h); ctx.fillRect(sc.x + sc.w, sc.y, 1, sc.h);
    // speech bubble
    if (this.line) {
      this.lineT += dt;
      const p = this.profAt;
      const lines = wrapText(this.line, 170);
      const bw = Math.max(...lines.map((l) => measureText(l))) + 18, bh = lines.length * 10 + 10;
      const bx = clamp(Math.round(p.x - bw / 2), sc.x + 4, sc.x + sc.w - bw - 4), by = Math.round(p.y - 46 - bh);
      const fade = this.lineT > 6 ? clamp01(1 - (this.lineT - 6) * 2) : 1;
      if (fade <= 0) this.line = null;
      else {
        ctx.globalAlpha = Math.min(1, this.lineT * 8) * fade;
        const cr = drawBubble(ctx, bx, by, bw, bh, { tailX: p.x, tailY: p.y - 30 });
        let left = Math.floor(this.lineT * 40);
        lines.forEach((l, i) => { drawText(ctx, l.slice(0, Math.max(0, left)), cr.x + 3, cr.y + 2 + i * 10, { color: '#3a2a22' }); left -= l.length + 1; });
        ctx.globalAlpha = 1;
      }
    }
  }

  drawPorthole(ctx, cx, cy, r, t, dt) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    const grd = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    const deep = this.game.ocean?.biome?.id === 'abyss';
    grd.addColorStop(0, deep ? '#1a1a50' : '#5ac8e0'); grd.addColorStop(1, deep ? '#06061a' : '#1a5a88');
    ctx.fillStyle = grd; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) { ctx.fillStyle = rgba('#e8fbff', 0.08); const x0 = cx - r + i * r * 0.7 + Math.sin(t * 0.5 + i) * 4; ctx.beginPath(); ctx.moveTo(x0, cy - r); ctx.lineTo(x0 + 6, cy - r); ctx.lineTo(x0 - 10, cy + r); ctx.lineTo(x0 - 16, cy + r); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    // passing fish silhouettes
    if (Math.random() < dt * 0.35 && this.outside.length < 3) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.outside.push({ x: dir > 0 ? -r - 20 : r + 20, y: (Math.random() - 0.5) * r * 1.2, v: dir * (12 + Math.random() * 18), s: 0.5 + Math.random() * 0.6 });
    }
    for (const f of this.outside) {
      f.x += f.v * dt;
      const x = Math.round(cx + f.x), y = Math.round(cy + f.y + Math.sin(t * 2 + f.s * 9) * 2);
      const L = Math.round(14 * f.s), h = Math.max(2, Math.round(6 * f.s));
      ctx.fillStyle = rgba(deep ? '#5affea' : '#0a3a5a', deep ? 0.6 : 0.55);
      ctx.fillRect(x - L / 2, y - h / 2, L, h);
      const tx = f.v > 0 ? x - L / 2 - 3 : x + L / 2;
      ctx.fillRect(tx, y - h / 2 - 1, 3, h + 2);
    }
    this.outside = this.outside.filter((f) => Math.abs(f.x) < r + 40);
    if (Math.random() < dt * 2) this.game.particles?.add({ kind: 'dot', x: cx + (Math.random() - 0.5) * r, y: cy + r - 2, vy: -16, life: 1.6, color: '#d8f8ff', layer: 'ui', g: 0 });
    ctx.restore();
    // brass rim with rivets
    for (let a = 0; a < TAU; a += 0.02) {
      for (let k = 0; k < 4; k++) {
        const rr = r + k;
        ctx.fillStyle = k === 0 ? '#7a4a1c' : k === 1 ? '#e0a844' : k === 2 ? '#c8902a' : '#5a3410';
        ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1);
      }
    }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ctx.fillStyle = '#fff2b8'; ctx.fillRect(Math.round(cx + Math.cos(a) * (r + 2)), Math.round(cy + Math.sin(a) * (r + 2)), 1, 1); }
    ctx.fillStyle = rgba('#ffffff', 0.25); ctx.fillRect(cx - Math.round(r * 0.5), cy - Math.round(r * 0.6), 3, Math.round(r * 0.5));
  }

  drawChalkboard(ctx, cb, t, dt) {
    const st = this.game.state;
    ctx.fillStyle = '#5a3420'; ctx.fillRect(cb.x - 4, cb.y - 4, cb.w + 8, cb.h + 8);
    ctx.fillStyle = '#8a5a32'; ctx.fillRect(cb.x - 4, cb.y - 4, cb.w + 8, 2);
    ctx.fillStyle = '#2a4a3a'; ctx.fillRect(cb.x, cb.y, cb.w, cb.h);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = rgba('#e8f4e8', 0.04); ctx.fillRect(cb.x + Math.floor(hash2(i, 1, 3) * cb.w), cb.y + Math.floor(hash2(i, 2, 3) * cb.h), 6 + Math.floor(hash2(i, 3, 3) * 14), 1); }
    ctx.fillStyle = '#7a4a28'; ctx.fillRect(cb.x - 6, cb.y + cb.h + 2, cb.w + 12, 4);
    ctx.fillStyle = '#f4f4f0'; ctx.fillRect(cb.x + 20, cb.y + cb.h + 1, 6, 2); ctx.fillStyle = '#ffb0c0'; ctx.fillRect(cb.x + 30, cb.y + cb.h + 1, 5, 2);
    const R = researchState(st);
    const a = R.active[0];
    const chalk = '#eef6ea';
    if (a) {
      const p = PROJECT_BY_ID[a.id];
      this.chalk = Math.min(1, this.chalk + dt * 0.6);
      const title = p.name.toUpperCase();
      const n = Math.floor(this.chalk * (title.length + 30));
      drawText(ctx, title.slice(0, n), cb.x + 8, cb.y + 7, { color: chalk });
      const k = researchProgress(st, a.id);
      const ready = Date.now() >= a.end;
      // chalk progress bar
      const bx = cb.x + 8, by = cb.y + 22, bw = cb.w - 16;
      ctx.fillStyle = chalk;
      for (let x = 0; x < bw; x += 2) { ctx.fillRect(bx + x, by, 1, 1); ctx.fillRect(bx + x + 1, by + 8, 1, 1); }
      ctx.fillRect(bx, by, 1, 9); ctx.fillRect(bx + bw - 1, by, 1, 9);
      for (let x = 1; x < Math.round((bw - 2) * k); x++) if ((x + Math.floor(x / 3)) % 3 !== 0) ctx.fillRect(bx + x, by + 2 + (x % 2), 1, 5);
      drawText(ctx, ready ? 'DONE! CLAIM IT ->' : `${Math.floor(k * 100)}%  -  ${fmtTime((a.end - Date.now()) / 1000)} left`, cb.x + 8, by + 13, { font: 'small', color: ready ? '#ffe27a' : chalk });
      // doodles: a fish diagram with arrows and an equation
      const fx = cb.x + 20, fy = cb.y + cb.h - 22;
      ctx.fillStyle = rgba(chalk, 0.85);
      for (let i = 0; i < 26; i++) { const u = i / 25 * Math.PI; ctx.fillRect(Math.round(fx + i), Math.round(fy - Math.sin(u) * 7), 1, 1); ctx.fillRect(Math.round(fx + i), Math.round(fy + Math.sin(u) * 6), 1, 1); }
      ctx.fillRect(fx - 4, fy - 4, 1, 9); ctx.fillRect(fx - 3, fy - 3, 3, 1); ctx.fillRect(fx - 3, fy + 3, 3, 1); ctx.fillRect(fx + 19, fy - 2, 2, 2);
      ctx.fillRect(fx + 30, fy, 14, 1); ctx.fillRect(fx + 42, fy - 1, 1, 3);
      drawText(ctx, ['E = mc^2 + FISH', 'BLUB x 3 = SCIENCE', 'KELP / 2 = ?!', 'FISH + FISH = 2 FISH'][a.id.length % 4], fx + 48, fy - 3, { font: 'small', color: chalk });
      if (ready && Math.sin(t * 6) > 0) drawText(ctx, '!', cb.x + cb.w - 12, cb.y + 6, { color: '#ffe27a', scale: 2 });
      if (R.active.length > 1) drawText(ctx, `+${R.active.length - 1} MORE ON OTHER BENCHES`, cb.x + cb.w - 6, cb.y + cb.h - 9, { font: 'small', align: 'right', color: rgba(chalk, 0.7) });
    } else {
      this.chalk = 0;
      drawText(ctx, 'NO EXPERIMENT RUNNING', cb.x + 8, cb.y + 8, { color: chalk });
      drawText(ctx, 'PICK A PROJECT FROM', cb.x + 8, cb.y + 26, { font: 'small', color: rgba(chalk, 0.8) });
      drawText(ctx, 'THE LAB NOTEBOOK ->', cb.x + 8, cb.y + 34, { font: 'small', color: rgba(chalk, 0.8) });
      const fx = cb.x + cb.w - 50, fy = cb.y + cb.h - 24;
      ctx.fillStyle = rgba(chalk, 0.7);
      for (let i = 0; i < 30; i++) { const a2 = (i / 30) * TAU; ctx.fillRect(Math.round(fx + Math.cos(a2) * 14), Math.round(fy + Math.sin(a2) * 9), 1, 1); }
      drawText(ctx, '?', fx - 2, fy - 4, { color: chalk });
    }
  }

  drawFlask(ctx, x, y, col, kind, t, heat) {
    const glass = '#d8f4ff';
    if (kind === 'round') {
      for (let yy = -12; yy <= 0; yy++) { const w = Math.round(Math.sqrt(Math.max(0, 49 - (yy + 6) ** 2))); ctx.fillStyle = yy > -7 ? col : rgba(glass, 0.35); ctx.fillRect(x - w, y - 1 + yy, w * 2 + 1, 1); }
      ctx.fillStyle = rgba(glass, 0.5); ctx.fillRect(x - 1, y - 22, 3, 10);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 4, y - 10, 1, 3);
    } else if (kind === 'cone') {
      for (let yy = -14; yy <= 0; yy++) { const w = Math.round(2 + (yy + 14) * 0.45); ctx.fillStyle = yy > -8 ? col : rgba(glass, 0.35); ctx.fillRect(x - w, y - 1 + yy, w * 2 + 1, 1); }
      ctx.fillStyle = rgba(glass, 0.5); ctx.fillRect(x - 1, y - 20, 3, 6);
    } else {
      ctx.fillStyle = rgba(glass, 0.35); ctx.fillRect(x - 3, y - 22, 7, 22);
      ctx.fillStyle = col; ctx.fillRect(x - 3, y - 12, 7, 12);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y - 20, 1, 6);
    }
    ctx.fillStyle = shade(col, 0.4); ctx.fillRect(x - 2, y - 8, 1, 1);
    if (Math.random() < 0.08 + heat * 0.25) this.game.particles?.add({ kind: 'dot', x: x + (Math.random() - 0.5) * 6, y: y - 6, vy: -18 - heat * 20, vx: (Math.random() - 0.5) * 6, life: 0.9, color: shade(col, 0.5), layer: 'ui', g: 0, size: Math.random() < 0.3 ? 2 : 1 });
    if (heat > 0.5) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(col, 0.12 + 0.05 * Math.sin(t * 6));
      ctx.fillRect(x - 9, y - 16, 19, 16);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawProf(ctx, ui, sc, M, t, dt) {
    const g = this.game, inp = g.input;
    const P = this.prof;
    this.profC ||= compiled(PROF_LOOK, null, 'prof_bubbles');
    P.moodT = Math.max(0, P.moodT - dt);
    this.talkT = Math.max(0, (this.talkT || 0) - dt);
    P.hop = Math.max(0, P.hop - dt);
    this.celebrate = Math.max(0, this.celebrate - dt);
    P.wanderT -= dt;
    if (P.wanderT <= 0) { P.wanderT = 3 + Math.random() * 5; P.tx = [0.2, 0.45, 0.62, 0.38][Math.floor(Math.random() * 4)]; }
    const sp = 0.12 * dt;
    if (Math.abs(P.tx - P.x) > 0.005) { P.face = Math.sign(P.tx - P.x); P.x += clamp(P.tx - P.x, -sp, sp); }
    const x = Math.round(sc.x + sc.w * P.x), base = sc.y + M.floorY + 10;
    const hopY = P.hop > 0 ? -Math.abs(Math.sin(P.hop * 14)) * 10 : this.celebrate > 0 ? -Math.abs(Math.sin(this.celebrate * 12)) * 8 : 0;
    const y = Math.round(base - 30 + Math.sin(t * 2) * 2 + hopY);
    this.profAt = { x, y };
    // shadow
    ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(x - 14, base + 2, 28, 3); ctx.fillRect(x - 10, base + 1, 20, 1);
    const look = inp.inside ? inp.x : x + P.face * 40;
    const face = this.talkT > 0 || P.moodT > 0 ? (look < x ? -1 : 1) : P.face;
    const mood = P.moodT > 0 ? P.mood : 'neutral';
    const an = drawFishRig(ctx, this.profC, {
      x, y, facing: face, turn: 1, angle: 0, scale: 2.2, squash: Math.sin(t * 2.6) * 0.04, bob: 0,
      swimPhase: (t * 0.6) % 1, tailPhase: (t * 0.9) % 1, finPhase: (t * (this.talkT > 0 ? 2.4 : 0.8)) % 1, speed01: 0.2, inflate: 0,
      lookX: inp.inside ? inp.x : null, lookY: inp.inside ? inp.y : null, blink: (t % 4.1) < 0.12 ? 1 : 0, emotion: mood,
      mouth: this.talkT > 0 ? Math.abs(Math.sin(t * 13)) * 0.8 : mood === 'happy' ? 0.25 : 0.05, time: t,
    }) || {};
    // lab coat over the lower body (V-neck lapels, buttons, a pocket of pens) + goggles + wild white hair
    const top = an.top || [x, y - 30];
    const bot = an.bottom || [x, y + 30];
    const bh = Math.max(20, bot[1] - top[1]);
    const ccx = Math.round(x - face * bh * 0.22), cy0 = Math.round(top[1] + bh * 0.56), ch = Math.round(bh * 0.4), cw = Math.round(bh * 0.34);
    for (let yy = 0; yy < ch; yy++) {
      const k = yy / ch;
      const half = Math.round(cw * (0.78 + 0.22 * Math.sin(k * Math.PI * 0.9)) * (yy > ch - 4 ? 0.9 : 1));
      const v = Math.max(0, Math.round((1 - k * 2.2) * cw * 0.55));
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? ccx - half : ccx + v, x1 = side < 0 ? ccx - v : ccx + half;
        if (x1 <= x0) continue;
        ctx.fillStyle = yy === ch - 1 ? '#a8acb8' : '#f6f6f2';
        ctx.fillRect(x0, cy0 + yy, x1 - x0, 1);
        ctx.fillStyle = '#c8ccd8';
        ctx.fillRect(side < 0 ? x0 : x1 - 1, cy0 + yy, 1, 1);
        if (v > 0) { ctx.fillStyle = '#d8dce8'; ctx.fillRect(side < 0 ? x1 - 1 : x0, cy0 + yy, 1, 1); }
      }
    }
    ctx.fillStyle = '#c84a3a'; ctx.fillRect(ccx - 1, cy0, 3, Math.round(ch * 0.45)); ctx.fillRect(ccx - 2, cy0, 5, 2);
    ctx.fillStyle = '#a8acb8'; for (let k = 0; k < 2; k++) ctx.fillRect(ccx + face * 3, cy0 + Math.round(ch * (0.55 + k * 0.22)), 1, 1);
    const pkx = Math.round(ccx - face * cw * 0.55) - 3, pky = cy0 + Math.round(ch * 0.45);
    ctx.fillStyle = '#e0e2ea'; ctx.fillRect(pkx, pky, 7, 6); ctx.fillStyle = '#a8acb8'; ctx.fillRect(pkx, pky, 7, 1);
    ctx.fillStyle = '#3a6ab8'; ctx.fillRect(pkx + 1, pky - 3, 1, 4); ctx.fillStyle = '#ff5a5a'; ctx.fillRect(pkx + 3, pky - 2, 1, 3); ctx.fillStyle = '#ffd84a'; ctx.fillRect(pkx + 5, pky - 3, 1, 4);
    const hx = Math.round(top[0]), hy = Math.round(top[1]);
    ctx.fillStyle = '#f4f4f0';
    for (let i = -6; i <= 6; i++) { const h = 4 + Math.round(Math.abs(Math.sin(i * 1.7 + Math.floor(t * 3))) * 5); ctx.fillStyle = i % 3 ? '#f4f4f0' : '#d8dce8'; ctx.fillRect(hx + i * 2, hy - h + 1, 2, h); }
    // goggles pushed up on the forehead
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(hx - 12, hy + 3, 24, 2);
    for (const s2 of [-1, 1]) {
      const gx = hx + s2 * 6 - 3;
      ctx.fillStyle = '#4a4e5e'; ctx.fillRect(gx - 1, hy - 1, 9, 9);
      ctx.fillStyle = '#b8c2d0'; ctx.fillRect(gx, hy, 7, 7);
      ctx.fillStyle = '#5ad8ff'; ctx.fillRect(gx + 1, hy + 1, 5, 5);
      ctx.fillStyle = '#c8f8ff'; ctx.fillRect(gx + 1, hy + 1, 2, 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(gx + 1, hy + 1, 1, 1);
    }
    // click him for a line
    const hit = { x: x - 20, y: y - 26, w: 40, h: 46 };
    if (ui.hover(hit)) {
      ui.tip = 'Professor Bubbles';
      if (inp.pressed) { inp.pressed = false; P.hop = 0.5; this.say(pick(LINES.idle), pick(['surprised', 'happy', 'smug'])); g.audio.play('boing', { vol: 0.5 }); }
    }
  }

  // ------------------------------------------------------------------ notebook
  drawNotebook(ctx, ui, nb, t, dt, lab) {
    const g = this.game, st = g.state, inp = g.input;
    drawPaper(ctx, nb.x, nb.y, nb.w - 1, nb.h - 2, { lined: true });
    ctx.fillStyle = '#c84a4a'; ctx.fillRect(nb.x + 18, nb.y + 2, 1, nb.h - 6);
    drawText(ctx, 'LAB NOTEBOOK', nb.x + 24, nb.y + 7, { color: '#3a2a22' });
    const slots = researchSlots(st), R = researchState(st);
    drawText(ctx, `Benches ${R.active.length}/${Math.max(1, slots)}`, nb.x + nb.w - 8, nb.y + 8, { font: 'small', align: 'right', color: '#6b4f43' });
    if (!lab) {
      drawText(ctx, 'Build a Research Lab on the seabed', nb.x + 24, nb.y + 30, { color: '#a8383a' });
      drawText(ctx, 'to start experiments!', nb.x + 24, nb.y + 42, { color: '#a8383a' });
    }
    // project list
    const order = { ready: 0, running: 1, available: 2, locked: 3, done: 4 };
    const list = PROJECTS.map((p) => ({ p, s: researchStatus(st, p.id) })).sort((a, b) => order[a.s] - order[b.s] || PROJECTS.indexOf(a.p) - PROJECTS.indexOf(b.p));
    const lr = { x: nb.x + 6, y: nb.y + 20, w: nb.w - 12, h: Math.round(nb.h * 0.5) };
    const rowH = 18;
    const maxScroll = Math.max(0, list.length * rowH - lr.h);
    if (inp.wheel && ui.hover(lr)) { this.scroll = clamp(this.scroll + Math.sign(inp.wheel) * rowH * 2, 0, maxScroll); inp.wheel = 0; }
    ctx.save(); ctx.beginPath(); ctx.rect(lr.x, lr.y, lr.w, lr.h); ctx.clip();
    list.forEach(({ p, s }, i) => {
      const y = lr.y + i * rowH - this.scroll;
      if (y < lr.y - rowH || y > lr.y + lr.h) return;
      const row = { x: lr.x, y, w: lr.w - 4, h: rowH - 2 };
      const on = this.sel === p.id, hov = ui.hover(row) && ui.hover(lr);
      if (on || hov) { ctx.fillStyle = rgba(on ? '#ffd25a' : '#c8ac80', on ? 0.35 : 0.2); ctx.fillRect(row.x, row.y, row.w, row.h); }
      const ic = getUiIcon(s === 'locked' ? 'lock' : s === 'done' ? 'check' : p.icon);
      if (ic) { ctx.globalAlpha = s === 'locked' ? 0.5 : 1; ctx.drawImage(ic, row.x + 3, row.y + 4); ctx.globalAlpha = 1; }
      const nameCol = s === 'locked' ? '#9a8a7a' : s === 'done' ? '#6a8a5a' : '#3a2a22';
      drawText(ctx, s === 'locked' ? '???' + ' (' + p.req.map((q) => PROJECT_BY_ID[q].name).join(', ').slice(0, 26) + ')' : p.name, row.x + 16, row.y + 5, { color: nameCol, font: s === 'locked' ? 'small' : 'normal' });
      const right = row.x + row.w - 4;
      if (s === 'running') {
        const k = researchProgress(st, p.id);
        drawBar(ctx, right - 44, row.y + 5, 44, 7, k, { color: '#5ab4ff' });
      } else if (s === 'ready') {
        if (Math.sin(t * 6) > -0.3) drawText(ctx, 'READY!', right, row.y + 5, { font: 'small', align: 'right', color: '#2a8a3a' });
      } else if (s === 'available') drawText(ctx, fmtTime(researchTime(st, p)), right, row.y + 6, { font: 'small', align: 'right', color: '#6b4f43' });
      else if (s === 'done') drawText(ctx, 'DONE', right, row.y + 6, { font: 'small', align: 'right', color: '#6a8a5a' });
      if (hov && inp.pressed) { inp.pressed = false; this.sel = p.id; g.audio.play('ui_page'); }
    });
    ctx.restore();
    if (maxScroll > 0) { const k = this.scroll / maxScroll; ctx.fillStyle = '#c8ac80'; ctx.fillRect(lr.x + lr.w - 2, lr.y, 2, lr.h); ctx.fillStyle = '#8a5a32'; ctx.fillRect(lr.x + lr.w - 2, Math.round(lr.y + k * (lr.h - 20)), 2, 20); }
    // selected project details
    const p = PROJECT_BY_ID[this.sel];
    if (!p) return;
    const s = researchStatus(st, p.id);
    const dy0 = lr.y + lr.h + 6;
    ctx.fillStyle = '#c8ac80'; ctx.fillRect(nb.x + 8, dy0 - 3, nb.w - 16, 1);
    let y = dy0 + 2;
    drawText(ctx, s === 'locked' ? 'Locked project' : p.name, nb.x + 24, y, { color: '#2a1a10' });
    y += 12;
    const desc = s === 'locked' ? `Requires: ${p.req.map((q) => PROJECT_BY_ID[q].name).join(', ')}.` : p.desc;
    for (const l of wrapText(desc, nb.w - 34).slice(0, 3)) { drawText(ctx, l, nb.x + 24, y, { color: '#4a3a30' }); y += 10; }
    y += 2;
    // rewards
    const rw = p.reward || {};
    const rewards = [...(rw.blueprints || []).map((id) => ({ id, qty: 1 })), ...Object.entries(rw.items || {}).map(([id, qty]) => ({ id, qty }))];
    drawText(ctx, 'REWARD', nb.x + 24, y, { font: 'small', color: '#8a5a32' });
    let rx = nb.x + 60;
    for (const it of rewards) {
      drawItem(ctx, it.id, rx + 10, y + 20, { box: [22, 20], t, spin: false });
      if (it.qty > 1) drawText(ctx, 'x' + it.qty, rx + 20, y + 15, { font: 'small', color: '#3a2a22' });
      if (ui.hover({ x: rx, y: y - 2, w: 22, h: 24 })) ui.tip = ITEMS[it.id]?.name || it.id;
      rx += 26;
    }
    const perks = Object.entries(rw.perk || {}).map(([k, v]) => `${PERK_NAMES[k] || k} +${Math.round(v * 100)}%`);
    if (rw.upgrade) perks.push(`Buildings upgrade to level ${rw.upgrade}`);
    if (rw.plans) perks.push(`${rw.plans} random decoration plans`);
    perks.forEach((q, i) => drawText(ctx, q, rx + 2, y + i * 9 + (rewards.length ? 4 : 0), { font: 'small', color: '#2a6a3a' }));
    y += 26;
    if (s === 'available' || s === 'locked') {
      drawText(ctx, 'COST', nb.x + 24, y, { font: 'small', color: '#8a5a32' });
      drawCost(ctx, st, p.cost, nb.x + 52, y - 1, { ui, color: '#3a2a22', bad: '#c8382a', shadow: null });
      y += 12;
      drawText(ctx, `TIME ${fmtTime(researchTime(st, p))}`, nb.x + 24, y, { font: 'small', color: '#6b4f43' });
    }
    if (s === 'running') {
      const a = R.active.find((q) => q.id === p.id);
      drawBar(ctx, nb.x + 24, y, nb.w - 48, 9, researchProgress(st, p.id), { color: '#5ab4ff' });
      drawText(ctx, `${fmtTime((a.end - Date.now()) / 1000)} left - continues while you are away`, nb.x + 24, y + 13, { font: 'small', color: '#6b4f43' });
    }
    // action button
    const bx = nb.x + nb.w - 104, by = nb.y + nb.h - 30;
    if (s === 'ready') {
      if (ui.button(ctx, bx, by, 96, 22, 'Claim!', { style: 'coral', icon: 'star' })) {
        const got = claimResearch(g, p.id);
        if (got) {
          this.say(pick(LINES.done), 'happy');
          this.celebrate = 1.6;
          g.audio.play('new_species'); g.audio.play('golden_shimmer', { vol: 0.6 });
          for (let i = 0; i < 24; i++) g.particles?.sparkle(bx + 48 + rng.float(-60, 60), by + rng.float(-40, 10), rng.pick(['#fff6b0', '#9af0ff', '#ff9ac8']), { layer: 'ui' });
          const names = got.map((q) => ITEMS[q.id]?.name || q.id).join(', ');
          g.toast?.(`Research complete: ${p.name}!${names ? ' Got ' + names + '.' : ''}`, 'star', 5);
        }
      }
    } else if (s === 'available') {
      const ok = lab && canAfford(g, p) && R.active.length < slots;
      if (ui.button(ctx, bx, by, 96, 22, 'Research', { style: ok ? 'coral' : 'wood', icon: 'book', disabled: !lab })) {
        const res = startResearch(g, p.id);
        if (res.ok) { this.say(pick(LINES.start), 'happy'); this.prof.hop = 0.5; g.audio.play('magic', { vol: 0.6 }); this.chalk = 0; }
        else { g.audio.play('ui_error'); this.say(res.reason.includes('benches') ? pick(LINES.busy) : res.reason.includes('Not enough') ? pick(LINES.broke) : res.reason, 'sad'); }
      }
    }
    if (lab && levelOf(lab) < 3) drawText(ctx, 'Upgrade the lab for more benches + speed', nb.x + 24, by + 8, { font: 'small', color: '#8a6a5a' });
  }
}

function pickJarFish(state) {
  const caught = Object.entries(state.journal || {}).filter(([, j]) => j.caught > 0).map(([id]) => id).filter((id) => SPECIES_BY_ID[id] && SPECIES_BY_ID[id].look?.kind !== 'chain');
  const pool = caught.length >= 3 ? caught : SPECIES.filter((s) => s.biome === 'shallows' && s.look?.kind !== 'chain').map((s) => s.id);
  const out = [];
  for (let i = 0; i < 3; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}

void ease; void formatCommas; void mix; void lerp; void RARITY;
