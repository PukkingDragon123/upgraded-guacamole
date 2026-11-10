// Destinations you SAIL to (phase 8, OWNER: Progression agent): Fizz Lab Island (a cute floating research station,
// Professor Fizz, opens ui 'lab') and Marina's Workshop dock (Marina + Dot, opens ui 'workshop', unlocked by a quest).
// They are places on the World Map (floating voxel sprites in the map's sky, see the [phase8:prog] hooks in
// src/ui/mappanel.js). Choosing one sails your boat there with a short travel transition, then a voxel scene of the
// place plays (the building, its NPC waving, a greeting) and the panel opens on top. Closing the panel leaves you
// docked there with "Open" and "Set sail" buttons; setting sail returns to the ocean you came from.
// The HUD shortcuts stay instant ("sail there instantly"): game.command('workshop') / the Lab button just open the panel.
//
//   DESTS {id: {id, name, sub, npc, panel, color, desc, lines:[greetings], feats:[...]}}  DEST_ORDER
//   destUnlocked(game, id) -> bool        destLockText(id) -> text
//   class Destinations (game.dest): sail(id) -> bool, quick(id), leave(), active, at (id | null), update(dt, inp),
//     draw(ctx, dt) (screen space, under the HUD and panels), hit(x, y) -> bool (true while a scene covers the screen)
//   Map hooks: mapDestInput(panel, Lay, ui), drawMapDests(panel, ctx, Lay, t), drawDestCard(panel, ctx, ui, rc, t) -> bool
//   destSprite(id, scale) -> {canvas, ox, oy, w, h} cached voxel render of the place
// Events: 'destArrive' {id}, 'destLeave' {id}, 'destVisit' {id} (quests count visits).
import { clamp, clamp01, lerp, ease, TAU } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import * as NPC from '../gfx/npcs.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { renderBoatPreview, resolveBoat } from './boatmodels.js';
import { drawCharacter } from '../gfx/character.js';
import { aeroSurface, aeroCached, drawAeroCard, drawAeroLabel, drawAeroGlow, drawSunFlare, toneFrom } from '../ui/aero.js';
import { workshopUnlocked } from '../build/workshop.js';
import { PixFx, partSprite } from '../build/pixart.js';

export const DESTS = {
  lab: {
    id: 'lab', name: 'Fizz Lab Island', sub: 'Floating research station', npc: 'fizz', panel: 'lab', color: '#7affc8',
    desc: 'Professor Fizz\'s bubbly lab floats above the waves. Research rods, boats, tanks, oceans and recipes here.',
    lines: ['Bubbling beakers, you came! What shall we discover today?', 'Welcome to the Lab! Science is just fishing with notes.', 'Ah, my favourite angler! The benches are warm.'],
    feats: ['Research tree', 'Rods & boats', 'New oceans'],
  },
  workshop: {
    id: 'workshop', name: 'Marina\'s Workshop', sub: 'Crafting dock', npc: 'marina', panel: 'workshop', color: '#ffb43c',
    desc: 'A cosy dock where Marina and Dot craft rods, tackle, boat parts, tank gear and decor from your materials.',
    lines: ['Ahoy! Welcome to my Workshop. Let\'s build something cute!', 'Hammer time! Got materials? I\'ve got ideas!', 'Dot polished the anvil just for you!'],
    feats: ['Craft new rods', 'Tackle & upgrades', 'Boat & tank gear'],
  },
};
export const DEST_ORDER = ['lab', 'workshop'];
const SCENE_SCALE = 4, MAP_SCALE = 1.5;

export function destUnlocked(game, id) {
  if (id === 'workshop') return workshopUnlocked(game.state);
  return !!DESTS[id];
}
export function destLockText(id) {
  return id === 'workshop' ? 'Finish Marina\'s quest "Marina\'s Workshop" (Chapter 2) to open it.' : '';
}

// ---------------------------------------------------------------- voxel models
function labModel() {
  const m = new VoxelModel(60, 58, 44);
  const C = (c, o = {}) => m.color(c, { jitter: 0.05, ...o });
  const rock = [C('#8a7a9a', { jitter: 0.12 }), C('#6a5a7a', { jitter: 0.12 }), C('#a898b8', { jitter: 0.1 })];
  const grass = [C('#6cd83a', { jitter: 0.1, smooth: 0.4 }), C('#8ae84a', { jitter: 0.1 }), C('#4cb82a', { jitter: 0.1 })];
  const white = C('#f4fbff', { spec: 0.6 }), glass = C('#9ef0ff', { emissive: 0.25, spec: 1, specPow: 6, smooth: 1 }), glassL = C('#e0fcff', { emissive: 0.4, spec: 1 });
  const goo = C('#7affc8', { emissive: 0.8, spec: 1 }), goo2 = C('#ff8ad8', { emissive: 0.8, spec: 1 }), metal = C('#c8d2e0', { spec: 0.8 });
  const crystal = C('#bff6ff', { emissive: 0.6, spec: 1 }), water = C('#5ad0ff', { emissive: 0.15, smooth: 1 }), flower = C('#ff9ad0'), flower2 = C('#ffe25a');
  const cx = 30, cz = 22;
  // floating rock: a flat-topped island with a jagged underside
  for (let y = 0; y <= 20; y++) {
    const k = y / 20, r = 6 + Math.pow(k, 0.7) * 20;
    m.cylinder(cx, cz, y, y, r * (0.9 + Math.sin(y * 1.3) * 0.04), (x, yy, z) => (yy >= 19 ? grass[(x + z) % 3 === 0 ? 1 : 0] : yy >= 17 ? grass[2] : ((x * 3 + yy + z * 7) % 11 < 2 ? rock[2] : (yy + x) % 4 === 0 ? rock[1] : rock[0])));
  }
  m.sub(() => { for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; m.sphere(cx + Math.cos(a) * 15, 2 + (i % 3), cz + Math.sin(a) * 11, 4); } });
  // a tiny waterfall spilling off the edge
  m.box(cx + 18, 8, cz + 10, cx + 20, 19, cz + 11, water);
  // the glass dome lab
  m.cylinder(cx - 4, cz, 21, 22, 13, white);
  m.sphere(cx - 4, 22, cz, 12, (x, y, z) => (y < 22 ? null : (x + y) % 7 === 0 ? glassL : glass));
  m.sub(() => m.sphere(cx - 4, 22, cz, 10.6));
  m.cylinder(cx - 4, cz, 21, 23, 5, metal); m.sphere(cx - 4, 26, cz, 3, goo);
  m.box(cx - 6, 21, cz + 11, cx - 2, 27, cz + 13, white); m.box(cx - 5, 21, cz + 12, cx - 3, 26, cz + 14, C('#2fb8e8'));
  // the beaker tower with a giant flask on top
  m.cylinder(cx + 12, cz - 4, 21, 38, 2.6, white);
  for (let y = 24; y < 38; y += 4) m.cylinder(cx + 12, cz - 4, y, y, 3.2, metal);
  m.sphere(cx + 12, 43, cz - 4, 6, (x, y, z) => (y < 43 ? goo : glass));
  m.sub(() => m.sphere(cx + 12, 45, cz - 4, 4.2));
  m.cylinder(cx + 12, cz - 4, 48, 52, 1.6, glassL);
  for (const [x, y, z, c] of [[cx + 12, 53, cz - 4, goo], [cx + 13, 55, cz - 3, goo2], [cx + 11, 57, cz - 5, goo]]) m.set(x, y, z, c);
  // little wind turbine
  m.cylinder(cx - 18, cz - 6, 21, 36, 0.8, white);
  m.box(cx - 19, 36, cz - 7, cx - 17, 37, cz - 5, white);
  for (const [dx, dy] of [[0, 7], [6, -4], [-6, -4]]) m.line(cx - 18, 37, cz - 4, cx - 18 + dx, 37 + dy, cz - 4, white, 0.6);
  // crystals and flowers on the grass
  for (const [x, z, h] of [[cx + 4, cz + 12, 4], [cx + 6, cz + 13, 3], [cx - 15, cz + 8, 3]]) m.line(x, 20, z, x, 20 + h, z, crystal, 0.8);
  for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 10 + (i % 4) * 3; m.set(Math.round(cx + Math.cos(a) * r), 21, Math.round(cz + Math.sin(a) * r * 0.8), i % 2 ? flower : flower2); }
  return { m, yaw: 28, pitch: 26 };
}

function workshopModel() {
  const m = new VoxelModel(64, 46, 40);
  const C = (c, o = {}) => m.color(c, { jitter: 0.06, ...o });
  const plank = [C('#c8925a', { jitter: 0.12 }), C('#b07a48', { jitter: 0.12 }), C('#e0b07a', { jitter: 0.1 })], post = C('#7a5432');
  const wall = [C('#fff2d8'), C('#f4e0c0')], trim = C('#2fb8e8', { spec: 0.6 }), roof = [C('#ff8a4a', { spec: 0.4 }), C('#e8662e', { spec: 0.3 }), C('#ffb07a', { spec: 0.5 })];
  const glass = C('#bff4ff', { emissive: 0.35, spec: 1 }), gold = C('#ffd23a', { spec: 1, specPow: 5 }), goldD = C('#c88a26', { spec: 0.6 });
  const iron = C('#5a6a80', { spec: 0.5 }), ironL = C('#97a2b8', { spec: 0.8 }), leaf = C('#5ccf3a'), crate = C('#c8925a', { jitter: 0.12 }), rope = C('#e0c890');
  const lamp = C('#fff6a0', { emissive: 1 }), pink = C('#ff8ac8'), white = C('#ffffff');
  // pier on posts
  for (let x = 2; x <= 61; x++) for (let z = 8; z <= 34; z++) m.set(x, 5, z, plank[(x >> 2) % 2 ? 0 : 1]);
  for (let x = 2; x <= 61; x += 4) m.box(x, 5, 8, x, 5, 34, plank[2]);
  for (const x of [3, 18, 33, 48, 60]) for (const z of [9, 33]) m.box(x, 0, z, x + 1, 5, z + 1, post);
  // the hut
  m.box(14, 6, 11, 44, 22, 28, (x, y, z) => (y === 22 || x === 14 || x === 44 ? trim : y % 4 === 0 ? wall[1] : wall[0]));
  m.sub(() => m.box(15, 6, 12, 43, 21, 27));
  // pitched roof (ridge along x)
  for (let y = 0; y <= 11; y++) m.box(12, 23 + y, 9 + y, 46, 23 + y, 30 - y, (x, yy, z) => (z === 9 + y || z === 30 - y ? roof[(x >> 1) % 2] : roof[2]));
  m.sub(() => { for (let y = 0; y <= 10; y++) m.box(13, 23 + y, 10 + y, 45, 23 + y, 29 - y); });
  // big open door + windows + the gear sign
  m.sub(() => m.box(24, 6, 28, 33, 17, 28));
  m.box(23, 18, 28, 34, 18, 28, trim);
  for (const x0 of [16, 37]) { m.box(x0, 12, 28, x0 + 4, 16, 28, glass); m.box(x0 - 1, 11, 28, x0 + 5, 11, 28, trim); }
  for (let a = 0; a < 24; a++) { const t = (a / 24) * TAU, r = a % 3 === 0 ? 7 : 6; m.set(Math.round(29 + Math.cos(t) * r), Math.round(28 + Math.sin(t) * r), 31, a % 3 === 0 ? goldD : gold); }
  m.cylinder(29, 28, 30, 31, 4.6, gold, 'z'); m.sub(() => m.cylinder(29, 28, 29, 32, 1.8, 'z'));
  // chimney with a little planter (eco: no smoke)
  m.box(38, 26, 14, 41, 36, 17, C('#e0b07a')); m.box(38, 36, 14, 41, 37, 17, leaf);
  // anvil, crates, barrel, a lamp post, rope coil, a heart flag
  m.box(48, 6, 22, 54, 7, 26, iron); m.box(50, 8, 23, 52, 9, 25, iron); m.box(47, 10, 22, 55, 11, 26, ironL);
  m.box(6, 6, 24, 11, 11, 29, crate); m.box(7, 12, 25, 10, 15, 28, crate); m.box(6, 9, 24, 11, 9, 29, rope);
  m.cylinder(56, 14, 6, 13, 3, C('#a0703a')); m.cylinder(56, 14, 9, 9, 3.3, iron);
  m.box(5, 6, 12, 5, 20, 12, iron); m.box(4, 20, 11, 6, 22, 13, lamp);
  m.cylinder(59, 30, 6, 7, 2.6, rope);
  m.box(46, 23, 20, 46, 33, 20, white); m.box(47, 29, 20, 52, 33, 20, pink);
  return { m, yaw: 22, pitch: 24 };
}

const MODELS = { lab: labModel, workshop: workshopModel };
const built = new Map(), sprites = new Map();
export function destSprite(id, scale = 3) {
  const key = id + '|' + scale;
  let s = sprites.get(key);
  if (s) return s;
  let b = built.get(id);
  if (!b) { b = MODELS[id](); built.set(id, b); }
  const r = renderVoxels(b.m, { scale, yaw: b.yaw, pitch: b.pitch, outline: true, glowRadius: 2 });
  // where the NPC stands: lab = on the grass in front of the dome; workshop = on the pier left of the door
  const stand = id === 'lab' ? r.project(26, 20.5, 38) : r.project(20, 6, 33);
  const extra = id === 'lab' ? r.project(46, 20.5, 30) : r.project(42, 6, 34);
  s = { canvas: r.canvas, glow: r.glow, ox: r.ox, oy: r.oy, w: r.w, h: r.h, stand: [stand[0], stand[1]], extra: [extra[0], extra[1]] }; // canvas coords
  sprites.set(key, s);
  return s;
}

// ---------------------------------------------------------------- scene backdrop (sky + sea), cached per size
function skyCanvas(W, H, hz) {
  return aeroCached(`destsky|${W}|${H}|${hz}`, () => {
    const c = makeCanvas(W, H), g = ctxOf(c);
    const top = [0x2a, 0x88, 0xd8], mid = [0x8f, 0xd8, 0xff], low = [0xe4, 0xf8, 0xff];
    for (let y = 0; y < hz; y++) {
      const k = y / hz, a = k < 0.6 ? top : mid, b = k < 0.6 ? mid : low, kk = k < 0.6 ? k / 0.6 : (k - 0.6) / 0.4;
      const d = (y & 1) * 0.004;
      g.fillStyle = `rgb(${Math.round(lerp(a[0], b[0], kk + d))},${Math.round(lerp(a[1], b[1], kk + d))},${Math.round(lerp(a[2], b[2], kk + d))})`;
      g.fillRect(0, y, W, 1);
    }
    // the sea: deep to bright bands with a light horizon line
    for (let y = hz; y < H; y++) {
      const k = (y - hz) / (H - hz);
      const c0 = mix('#7ad8f8', '#1a7ed0', Math.min(1, k * 1.3));
      g.fillStyle = c0; g.fillRect(0, y, W, 1);
    }
    g.fillStyle = '#ffffff'; g.fillRect(0, hz, W, 1);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, hz + 1, W, 1);
    // pixel clouds
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 173) % W) + 20, cy = 40 + ((i * 61) % Math.max(20, hz - 120));
      for (let j = 0; j < 5; j++) {
        const r = 10 + ((i + j) % 3) * 5, x0 = cx + j * 14 - 30;
        for (let y = -r; y <= r * 0.6; y++) {
          const hw = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
          g.fillStyle = y < -r * 0.3 ? '#ffffff' : y < r * 0.2 ? '#f0faff' : '#cfeaf8';
          g.fillRect(x0 - hw, cy + y, hw * 2, 1);
        }
      }
    }
    return c;
  }, 8);
}

// ---------------------------------------------------------------- the scene controller
export class Destinations {
  constructor(game) {
    this.game = game;
    this.at = null;      // destination id while there
    this.phase = null;   // 'out' (sailing there) | 'arrive' | 'docked' | 'back'
    this.pt = 0;
    this.t = 0;
    this.fx = new PixFx(300);
    this.line = '';
    game.on?.('travel', () => this.end());
  }
  get active() { return !!this.phase; }
  hit() { return !!this.phase; }

  quick(id) {
    const g = this.game, D = DESTS[id];
    if (!D) return false;
    if (!destUnlocked(g, id)) { g.toast?.(destLockText(id), 'lock'); g.audio?.play('ui_error'); if (g.ui?.panels?.[D.panel]) g.ui.open(D.panel); return false; }
    if (g.ui?.isOpen?.(D.panel)) g.ui.close(D.panel); else g.ui?.open?.(D.panel);
    return true;
  }

  sail(id) {
    const g = this.game, D = DESTS[id];
    if (!D) return false;
    if (!destUnlocked(g, id)) { g.toast?.(destLockText(id), 'lock'); g.audio?.play('ui_error'); return false; }
    if (g.fishing?.fighting) { g.toast?.('Land your fish first!', 'hook'); return false; }
    if (g.fishing?.busy) try { g.fishing.releaseFish(false); } catch { /* ignore */ }
    if (g.state.view !== 'ocean') try { g.setView('ocean'); } catch { /* ignore */ }
    for (const p of (g.ui?.stack || []).slice()) g.ui.close(p.id);
    const reduced = !!g.state.settings?.reducedMotion;
    this.from = this.at;
    this.at = id;
    this.phase = 'out';
    this.pt = 0;
    this.dur = reduced ? 0.3 : 1.7;
    this.line = D.lines[Math.floor(Math.random() * D.lines.length)];
    this.fx.list = [];
    g.audio?.play('travel_whoosh', { vol: 0.7 });
    try { destSprite(id, SCENE_SCALE); } catch (e) { console.error(e); }
    return true;
  }

  leave() {
    if (!this.phase || this.phase === 'back') return;
    const g = this.game;
    for (const p of (g.ui?.stack || []).slice()) g.ui.close(p.id);
    this.phase = 'back';
    this.pt = 0;
    this.dur = g.state.settings?.reducedMotion ? 0.2 : 1.1;
    g.audio?.play('travel_whoosh', { vol: 0.6, pitch: 1.2 });
    g.emit?.('destLeave', { id: this.at });
  }
  end() { if (this.phase) { this.phase = null; this.at = null; } }

  update(dt, inp) {
    if (!this.phase) return;
    const g = this.game;
    dt = Math.min(0.05, dt);
    this.t += dt;
    this.pt += dt;
    this.fx.update(dt);
    if (g.state.view !== 'ocean' || g.ocean?.travelState) { this.end(); return; }
    const D = DESTS[this.at];
    if (this.phase === 'out' && this.pt >= this.dur) {
      this.phase = 'arrive'; this.pt = 0;
      g.audio?.play('arrive', { vol: 0.7 });
      g.emit?.('destArrive', { id: this.at });
      g.emit?.('destVisit', { id: this.at });
      const S = this.scene();
      this.fx.burst(S.npcX, S.npcY - 30, 16, { kinds: ['sparkle', 'heart', 'star'], colors: ['#ffffff', '#ff9ad0', D.color], speed: 120, g: 60, life: 1.2, up: 60, scale: 2 });
    } else if (this.phase === 'arrive' && this.pt >= (g.state.settings?.reducedMotion ? 0.1 : 1.1)) {
      this.phase = 'docked'; this.pt = 0;
      if (g.ui?.panels?.[D.panel]) g.ui.open(D.panel);
    } else if (this.phase === 'back' && this.pt >= this.dur) {
      this.end();
      g.camera?.flash?.('#bfefff', 0.4);
    }
    // Esc at the dock (nothing open) sets sail; the buttons themselves are immediate-mode (draw)
    if (this.phase === 'docked' && !g.ui?.active && g.input?.keyPressed?.('Escape')) { g.input.keysPressed?.delete?.('Escape'); this.leave(); }
    void inp;
  }

  scene() {
    const W = this.game.screen.W, H = this.game.screen.H;
    const hz = Math.round(H * 0.56);
    const S = destSprite(this.at, SCENE_SCALE);
    const k = this.phase === 'out' ? ease.outCubic(clamp01(this.pt / this.dur)) : this.phase === 'back' ? 1 : 1;
    const slide = Math.round((1 - k) * (W * 0.75));
    const lab = this.at === 'lab';
    const bob = lab ? Math.round(Math.sin(this.t * 1.3) * 4) : 0;
    const bx = Math.round(W * 0.62) + slide, by = lab ? hz - 30 + bob : hz + 70;
    const npcX = bx - S.ox + S.stand[0], npcY = by - S.oy + S.stand[1];
    const exX = bx - S.ox + S.extra[0], exY = by - S.oy + S.extra[1];
    return { W, H, hz, S, bx, by, npcX, npcY, exX, exY, slide, bob };
  }

  draw(ctx, dt) {
    if (!this.phase || !this.at) return;
    const g = this.game, D = DESTS[this.at], t = this.t;
    const sc = this.scene();
    const { W, H, hz, S } = sc;
    const reduced = !!g.state.settings?.reducedMotion;
    ctx.drawImage(skyCanvas(W, H, hz), 0, 0);
    drawSunFlare(ctx, W * 0.86, H * 0.12, 30, 0.9);
    // drifting sea highlights (pixel dashes)
    for (let i = 0; i < 70; i++) {
      const y = hz + 3 + ((i * 37) % (H - hz - 4));
      const k = (y - hz) / (H - hz);
      const sp = 10 + k * 30;
      const x = ((i * 131 + t * sp * (i % 2 ? 1 : -1)) % (W + 40) + W + 40) % (W + 40) - 20;
      ctx.fillStyle = rgba('#ffffff', 0.25 + 0.35 * (1 - k));
      ctx.fillRect(Math.round(x), y, 4 + Math.round(k * 10), 1);
    }
    // the place
    if (this.at === 'lab') {
      // shadow on the water + a soft glow under the floating island
      ctx.fillStyle = 'rgba(10,60,110,0.22)';
      for (let i = 0; i < 6; i++) { const hw = Math.round(S.w * 0.32 * Math.sqrt(1 - (i / 6) ** 2)); ctx.fillRect(sc.bx - hw, hz + 34 + i, hw * 2, 1); }
      drawAeroGlow(ctx, sc.bx, sc.by - S.h * 0.3, Math.round(S.w * 0.6), D.color, 0.35);
    }
    if (S.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(S.glow, sc.bx - S.ox, sc.by - S.oy); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    ctx.drawImage(S.canvas, sc.bx - S.ox, sc.by - S.oy);
    if (this.at === 'workshop') {
      // water lapping at the pier posts
      for (let i = 0; i < 12; i++) { const x = sc.bx - S.ox + 10 + i * (S.w - 20) / 11; ctx.fillStyle = rgba('#ffffff', 0.5 + 0.3 * Math.sin(t * 3 + i)); ctx.fillRect(Math.round(x), sc.by - 2 + Math.round(Math.sin(t * 2 + i) * 1), 6, 1); }
    }
    // the NPC (+ Dot hovering at the workshop) waves you in
    const waving = this.phase === 'arrive' || (this.phase === 'docked' && !g.ui?.blocking);
    try {
      NPC.drawNPC(ctx, D.npc, { x: sc.npcX, y: sc.npcY, t, scale: 1.25, pose: waving ? 'wave' : 'idle', talk: this.phase === 'arrive' ? (Math.sin(t * 9) + 1) * 0.4 : 0, mood: 'happy', facing: -1 });
      if (this.at === 'workshop') NPC.drawNPC(ctx, 'dot', { x: sc.exX, y: sc.exY - 6, t: t + 1, scale: 0.9, mood: 'happy', facing: -1 });
    } catch (e) { if (!this.npcErr) { this.npcErr = true; console.error(e); } }
    // the player's boat sails in (out), bobs at the dock, sails off (back)
    this.drawBoat(ctx, sc, dt, reduced);
    // greeting bubble
    if ((this.phase === 'arrive' || this.phase === 'docked') && !g.ui?.blocking) this.drawBubble(ctx, sc.npcX, sc.npcY - 70, this.line);
    this.fx.draw(ctx);
    if (!reduced && Math.random() < 0.08) this.fx.add({ x: Math.random() * W, y: hz + 10 + Math.random() * (H - hz), vx: 0, vy: -16, g: 0, life: 1.4, kind: 'sparkle', color: '#ffffff' });
    // title + docked buttons
    if (this.phase !== 'out' || this.pt > this.dur * 0.6) {
      const a = this.phase === 'out' ? clamp01((this.pt - this.dur * 0.6) / (this.dur * 0.4)) : this.phase === 'back' ? 1 - clamp01(this.pt / 0.4) : 1;
      ctx.globalAlpha = a;
      const tw = measureText(D.name, 'big', 2) + 44;
      ctx.drawImage(aeroCached(`destban|${tw}|${D.color}`, () => aeroSurface(tw, 30, { tone: toneFrom(D.color), r: 'pill', gloss: 0.8, glossH: 13, curve: 2, rim: 0.85, glow: 0.7, sparkle: 2 })), Math.round(W / 2 - tw / 2), 14);
      drawText(ctx, D.name, W / 2, 20, { font: 'big', scale: 2, align: 'center', color: '#ffffff', shadow: shade(D.color, -0.65) });
      ctx.globalAlpha = 1;
    }
    if (this.phase === 'docked' && !g.ui?.blocking) this.drawDockUi(ctx, sc, D);
    // sailing transitions: soft white wipe at the start of 'out' and the end of 'back'
    let wipe = 0;
    if (this.phase === 'out') wipe = 1 - clamp01(this.pt / 0.35);
    if (this.phase === 'back') wipe = clamp01((this.pt - this.dur * 0.55) / (this.dur * 0.45));
    if (wipe > 0) { ctx.fillStyle = rgba('#e8fbff', wipe); ctx.fillRect(0, 0, W, H); }
  }

  drawBoat(ctx, sc, dt, reduced) {
    const g = this.game;
    let pv = null;
    try { const b = resolveBoat(g.state); pv = renderBoatPreview(b.tier, b.parts, { scale: 1.5 }); } catch { pv = null; }
    if (!pv) return;
    const W = sc.W, dockX = Math.round(W * 0.24), y = sc.hz + 92;
    let x = dockX;
    if (this.phase === 'out') x = Math.round(lerp(-160, dockX, ease.outCubic(clamp01(this.pt / this.dur))));
    if (this.phase === 'back') x = Math.round(lerp(dockX, -200, ease.inCubic(clamp01(this.pt / this.dur))));
    const bob = reduced ? 0 : Math.round(Math.sin(this.t * 2.2) * 2);
    const moving = this.phase === 'out' || this.phase === 'back';
    if (moving && !reduced && Math.random() < 0.7) this.fx.add({ x: x - pv.px + 6, y: y + 2, vx: -30 - Math.random() * 40, vy: -20 - Math.random() * 30, g: 120, life: 0.6, kind: Math.random() < 0.5 ? 'puff' : 'spark', color: '#ffffff' });
    ctx.drawImage(pv.canvas, Math.round(x - pv.px), Math.round(y - pv.py + bob));
    if (pv.stand) {
      try {
        drawCharacter(ctx, Math.round(x + pv.stand[0]), Math.round(y + pv.stand[1] + bob), { pose: this.phase === 'arrive' ? 'wave' : moving ? 'idle' : 'idle', t: this.t, facing: 1, scale: 1, look: g.state.character, rod: false });
      } catch { /* character optional */ }
    }
    try { pv.drawFront(ctx, x, y + bob, this.t, 1); } catch { /* ignore */ }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(x - 40 + i * 14 + Math.sin(this.t * 3 + i) * 2), y + 4, 8, 1);
  }

  drawBubble(ctx, x, y, text) {
    const W = this.game.screen.W;
    const lines = wrapText(text, 220, 'big');
    const w = Math.max(...lines.map((l) => measureText(l, 'big'))) + 24, h = lines.length * 13 + 14;
    const bx = clamp(Math.round(x - w / 2), 8, W - w - 8), by = Math.round(y - h);
    ctx.drawImage(aeroCached(`destbub|${w}|${h}`, () => aeroSurface(w, h, { tone: 'white', r: 10, gloss: 0.6, glossH: 10, rim: 0.9, glow: 0.5 })), bx, by);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(x) - 6 + i, by + h + i - 1, 12 - i * 2, 1);
    lines.forEach((l, i) => drawText(ctx, l, bx + 12, by + 8 + i * 13, { font: 'big', color: '#0c3a52' }));
  }

  drawDockUi(ctx, sc, D) {
    const g = this.game, ui = g.ui;
    const bw = 190, bh = 36, y = sc.H - (g.hud?.topY ? sc.H - g.hud.topY() + 52 : 110);
    const x0 = Math.round(sc.W / 2 - bw - 8);
    const label = D.panel === 'lab' ? 'Enter the Lab' : 'Open Workshop';
    if (ui.button(ctx, x0, y, bw, bh, label, { style: 'green', icon: 'star', sound: 'ui_open' })) ui.open(D.panel);
    if (ui.button(ctx, x0 + bw + 16, y, bw, bh, 'Set sail', { style: 'aqua', icon: 'map', sound: 'travel_whoosh', tip: 'Back to fishing (Esc)' })) this.leave();
  }
}

// ---------------------------------------------------------------- World Map hooks (src/ui/mappanel.js, [phase8:prog])
// Destinations float in the map's sky: the Lab island top-left, the Workshop dock bottom-right.
function mapSpots(Lay) {
  const v = Lay.view;
  return {
    lab: { x: v.x + 74, y: v.y + 86 },
    workshop: { x: v.x + 92, y: v.y + v.h - 92 },
  };
}
function mapRect(id, p, t) {
  const S = destSprite(id, MAP_SCALE);
  const bob = Math.round(Math.sin(t * 1.6 + (id === 'lab' ? 0 : 2)) * 2);
  return { x: p.x - S.ox, y: p.y - S.oy + bob, w: S.w, h: S.h, S, bob };
}
// Call before the map's own input: hover + click on a destination (consumes the click).
export function mapDestInput(panel, Lay, ui) {
  const inp = ui.inp, t = panel.t || 0;
  panel.destHover = null;
  if (panel.sail || panel.drag) return;
  const P = mapSpots(Lay);
  for (const id of DEST_ORDER) {
    let r;
    try { r = mapRect(id, P[id], t); } catch { continue; }
    if (ui.hover(r)) {
      panel.destHover = id;
      if (inp.pressed) {
        inp.pressed = false;
        if (panel.destSel !== id) panel.game.audio.play('ui_click');
        panel.destSel = id;
        if (inp.dblclick) sailFromMap(panel, id);
      }
    }
  }
}
export function drawMapDests(panel, ctx, Lay, t) {
  const g = panel.game, P = mapSpots(Lay);
  for (const id of DEST_ORDER) {
    const D = DESTS[id];
    let r;
    try { r = mapRect(id, P[id], t); } catch { continue; }
    const open = destUnlocked(g, id), hov = panel.destHover === id, sel = panel.destSel === id;
    drawAeroGlow(ctx, r.x + r.w / 2, r.y + r.h / 2, Math.round(r.w * 0.7), D.color, hov || sel ? 0.55 : 0.25);
    if (!open) ctx.globalAlpha = 0.55;
    ctx.drawImage(r.S.canvas, r.x, r.y);
    ctx.globalAlpha = 1;
    if (!open) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, Math.round(r.x + r.w / 2 - lk.width / 2), Math.round(r.y + r.h / 2 - lk.height / 2)); }
    if (sel && ((t * 4) | 0) % 2) ctx.drawImage(partSprite('sparkle', '#ffffff', 1), r.x + r.w - 6, r.y);
    drawAeroLabel(ctx, D.name, r.x + r.w / 2, r.y + r.h + 2, { align: 'center', tone: !open ? 'grey' : hov || sel ? toneFrom(D.color) : 'glass' });
  }
}
function sailFromMap(panel, id) {
  const g = panel.game;
  if (!destUnlocked(g, id)) { g.audio.play('ui_error'); g.toast?.(destLockText(id), 'lock'); return; }
  g.ui?.close?.(panel.id);
  g.dest?.sail?.(id);
}
// The right-hand card for a selected destination; returns false when no destination is selected.
export function drawDestCard(panel, ctx, ui, rc, t) {
  const id = panel.destHover || (panel.hover ? null : panel.destSel);
  if (!id || !DESTS[id]) return false;
  const g = panel.game, D = DESTS[id], open = destUnlocked(g, id);
  drawAeroCard(ctx, rc.x, rc.y, rc.w, rc.h, { tone: 'frost' });
  const x = rc.x + 9, w = rc.w - 18;
  let y = rc.y + 8;
  ctx.drawImage(aeroCached(`destband|${w}|${D.color}`, () => aeroSurface(w, 32, { tone: toneFrom(open ? D.color : '#8a92a2'), r: 7, gloss: 0.7, glossH: 14, curve: 3, rim: 0.85, glow: 0.6, sparkle: 1 })), x, y);
  const big = measureText(D.name, 'normal', 2) <= w - 12;
  drawText(ctx, D.name, x + 8, y + (big ? 4 : 6), { scale: big ? 2 : 1, color: '#ffffff', shadow: shade(D.color, -0.7) });
  drawText(ctx, D.sub.toUpperCase(), x + 8, y + (big ? 22 : 18), { font: 'small', color: mix(D.color, '#ffffff', 0.75) });
  y += 40;
  // postcard: the place up close with its NPC
  const ph = 120;
  ctx.drawImage(aeroCached(`destpc|${w}|${ph}`, () => aeroSurface(w, ph, { tone: 'sky', r: 6, gloss: 0.4, glossH: 30, rim: 0.9, glow: 0.4 })), x, y);
  try {
    const S = destSprite(id, 2);
    const k = Math.min(1, (w - 10) / S.w, (ph - 10) / S.h);
    const sw = Math.round(S.w * k), sh = Math.round(S.h * k);
    ctx.drawImage(S.canvas, Math.round(x + w / 2 - sw / 2), Math.round(y + ph - sh - 4) + Math.round(Math.sin(t * 1.5) * 1.5), sw, sh);
    NPC.drawNPC(ctx, D.npc, { x: x + 26, y: y + ph - 6, t, scale: 0.8, pose: 'wave', mood: 'happy', shadow: false });
  } catch { /* art optional */ }
  y += ph + 8;
  wrapText(D.desc, w).slice(0, 5).forEach((l, i) => drawText(ctx, l, x, y + i * 10, { color: '#3c6f88' }));
  y += Math.min(5, wrapText(D.desc, w).length) * 10 + 6;
  for (const f of D.feats) {
    const ic = getUiIcon('star');
    if (ic) ctx.drawImage(ic, x, y - 1);
    drawText(ctx, f, x + 14, y, { color: '#0c3a52' });
    y += 12;
  }
  if (!open) {
    y += 4;
    wrapText(destLockText(id), w, 'small').forEach((l, i) => drawText(ctx, l, x, y + i * 8, { font: 'small', color: '#e8364a' }));
  }
  const bx = x, by = rc.y + rc.h - 33, bw = w, bh = 24;
  if (open) {
    if (ui.button(ctx, bx, by, bw, bh, `Sail to ${D.panel === 'lab' ? 'the Lab' : 'the Workshop'}`, { icon: 'map', style: 'green', sound: 'travel_whoosh', tip: `Sail to ${D.name}` })) sailFromMap(panel, id);
  } else if (g.ui?.panels?.quests) {
    if (ui.button(ctx, bx, by, bw, bh, 'See the quest', { icon: 'lock', style: 'orange' })) { ui.close(panel.id); ui.open('quests'); }
  }
  if (ui.button(ctx, bx, by - 28, bw, 22, 'Back to the oceans', { icon: 'arrow_l', style: 'glass' })) { panel.destSel = null; panel.destHover = null; }
  return true;
}
