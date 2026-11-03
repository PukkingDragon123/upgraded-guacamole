// Wardrobe (panel id 'wardrobe', phase 3 Frutiger Aero; OWNER: Character agent).
// Left: a sky stage (sun flare, rolling green hill, floating bubbles) with a glossy turntable and the bubble person
// posing on it: drag (or arrow keys) to spin, the eyes follow the cursor, emote / shuffle / reset orbs underneath.
// Right: glossy category orbs (14 cosmetic slots + Boat), an item grid of glass cards (live voxel thumbnails,
// rarity glow, owned / equipped / locked states) and an info bar with one action (Wear / Buy for Aero / Locked).
// Unowned items are tried on in the preview. Boat tab: pick an unlocked boat tier and its parts (paint, sail, flag,
// engine, decal); the stage shows the boat with you on deck and spinning turbines.
// State: game.state.character (look), game.state.cosmetics (owned ids), game.state.boat = {tier, parts},
// boat part ownership in game.state.cosmetics['boatpart:<slot>:<id>'].
// open({slot}) where slot is a WARDROBE_SLOTS id or 'boat'. drawWardrobeIcon(ctx, x, y, {hover, t, look}) -> rect.

import { clamp, lerp, ease, TAU } from '../core/math.js';
import { rgba, shade, mix, RARITY } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import {
  drawCharacter, WARDROBE, WARDROBE_SLOTS, DEFAULT_CHARACTER, normalizeLook, ownsCosmetic, grantCosmetic, equipItem, isEquipped,
  itemPreview, drawItemPreview, emotePose,
} from '../gfx/character.js';
import { BOAT_TIERS, BOAT_PARTS, BOAT_PART_SLOTS, renderBoatPreview, resolveParts, ensureBoat } from '../world/boatmodels.js';
import { drawAeroPanel, drawAeroButton, drawGlossOrb, drawAeroBubble, drawAeroCoin, drawSparkle, drawAeroGlow, aeroText, fmtAero, AERO, CURRENCY } from './aero.js';
import { wordArt } from '../store/aerokit.js';
import { unlocked as labUnlocked } from '../game/lab.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const SAY = {
  equip: ['Ooh!', 'Fresh!', 'So shiny!', 'Bubbly!', 'Love it!', 'Yes!'],
  buy: ['Mine!', 'Ka-ching!', 'Sparkly!'],
  broke: ['Need more Aero...', 'Too pricey!'],
  poke: ['Hehe!', 'Boop!', 'Pop?', 'Hey!'],
  spin: ['Wheee!', 'Dizzy...'],
  random: ['Surprise!', 'Shuffle!'],
};
const SLOT_SOUND = { tint: 'blub', eyes: 'boing', mouth: 'honk', hat: 'boing', hair: 'boing', face: 'bell', top: 'puff', bottom: 'puff', gloves: 'squeak', shoes: 'squeak', back: 'puff', trail: 'bell', emote: 'chirp', rod: 'reel_tick', boat: 'splash_small' };
const THUMB = { tint: 1.05, eyes: 1.05, mouth: 1.05, face: 1.05, hat: 0.85, hair: 0.85, top: 1.7, bottom: 1.4, back: 1.6, trail: 0.62, emote: 0.62, gloves: 1.3, shoes: 1.2, rod: 0.62 };
const PART_PRICE = { common: 0, uncommon: 150, rare: 400, epic: 1000, legendary: null };
const TABS = [...WARDROBE_SLOTS.map((s) => s.id), 'boat'];
const NONE_FIRST = new Set(['hat', 'hair', 'face', 'back', 'trail', 'gloves']);

// ---------------------------------------------------------------- tab glyphs (tiny pixel art, 2x)
const GLYPHS = {
  tint: ['...####...', '..#wwaa#..', '.#wwaaaa#.', '#wwaaaaaa#', '#waaaaaap#', '#aaaaaapp#', '#aaaaappp#', '.#aaaapp#.', '..#aapp#..', '...####...'],
  eyes: ['..........', '.###..###.', '#www##www#', '#w##ww##w#', '#w#ww#w##w', '#w###w###w', '.###..###.', '..........'],
  mouth: ['..........', '#........#', '##......##', '.##....##.', '..######..', '...#rr#...', '....##....'],
  hat: ['...####...', '..#aaaa#..', '.#aawaaa#.', '.#aaaaaa#.', '.#aaaaaa#.', '.##########', '...#######'],
  hair: ['.gg....gg.', '#ggg..ggg#', '.#ggggg#..', '...#g#....', '....#.....', '..####....', '.#aaaa#...', '#aaaaaa#..'],
  face: ['..........', '##########', '#kk#..#kk#', '#kkk##kkk#', '#kk#..#kk#', '.##....##.'],
  top: ['.###..###.', '#www##www#', '#wwwwwwww#', '.##waaw##.', '..#waaw#..', '..#wwww#..', '..#wwww#..', '..######..'],
  bottom: ['.########.', '.#aaaaaa#.', '.#aaaaaa#.', '.#aaa#aa#.', '.#aa#.#aa#', '.###...###'],
  gloves: ['.#.#.#....', '#w#w#w#...', '#wwwwww#..', '#wwwwww#.#', '#wwwwwww#w', '.#wwwwwww#', '..#aaaa#..', '..######..'],
  shoes: ['..####....', '..#ww#....', '..#ww#....', '..#wa####.', '.#wwaawww#', '#wwwwwwww#', '#gggggggg#', '.########.'],
  back: ['...####...', '..#aaaa#..', '.#aaaaaa#.', '.#awwwwa#.', '.#aw##wa#.', '.#awwwwa#.', '.#aaaaaa#.', '..######..'],
  trail: ['......#...', '.....#w#..', '..#...#...', '.#w#......', '..#...#...', '.....#w#..', '#.....#...', '##........'],
  emote: ['...#.#.#..', '..#w#w#w#.', '..#wwwwww#', '#.#wwwwww#', '#w#wwwwww#', '.#wwwwww#.', '..#wwww#..', '...####...'],
  rod: ['.........#', '........#.', '.......#..', '......#...', '.....#....', '..##.#....', '.#ww##....', '.#ww#.....', '..##......', '.#........'],
  boat: ['....#.....', '....##....', '....#w#...', '....#ww#..', '....####..', '##########', '#aaaaaaaa#', '.#wwwwww#.', '..######..'],
};
const GCOL = { '#': AERO.ink, w: '#ffffff', a: '#2fd3e8', g: '#5cc832', p: '#ff9ad0', r: '#ff5a7a', k: '#1a2a5a' };
const glyphCache = new Map();
function glyph(id) {
  let c = glyphCache.get(id);
  if (c) return c;
  const rows = GLYPHS[id] || GLYPHS.tint, w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  c = makeCanvas(w * 2, h * 2);
  const g = ctxOf(c);
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const col = GCOL[row[x]]; if (col) { g.fillStyle = col; g.fillRect(x * 2, y * 2, 2, 2); } } });
  glyphCache.set(id, c);
  return c;
}

// ---------------------------------------------------------------- stage backdrop (cached)
const bgCache = new Map();
function stageBg(w, h) {
  const key = w + 'x' + h;
  let c = bgCache.get(key);
  if (c) return c;
  c = makeCanvas(w, h);
  const g = ctxOf(c);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1e8fe0'); sky.addColorStop(0.55, '#7fd2ff'); sky.addColorStop(0.72, '#d8f4ff');
  sky.addColorStop(0.72, '#7ee04a'); sky.addColorStop(0.86, '#4cb82e'); sky.addColorStop(1, '#2c8a1c');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // curved glossy hill horizon
  const hy = h * 0.72;
  g.fillStyle = '#d8f4ff';
  g.fillRect(0, Math.round(hy) - 6, w, 6);
  g.fillStyle = '#8be04a';
  for (let x = 0; x < w; x++) { const y = hy - 8 + ((x - w * 0.55) / w) ** 2 * 26; g.fillRect(x, Math.round(y), 1, Math.round(hy + 30 - y)); }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = 0; x < w; x++) { const y = hy - 8 + ((x - w * 0.55) / w) ** 2 * 26; g.fillRect(x, Math.round(y), 1, 2); }
  // sun rays from the top-left
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const a = 0.1 + i * 0.16;
    g.fillStyle = `rgba(255,255,240,${0.05 + (i % 2) * 0.03})`;
    g.beginPath(); g.moveTo(w * 0.12, h * 0.1); g.lineTo(w * 0.12 + Math.cos(a) * w * 1.4, h * 0.1 + Math.sin(a) * w * 1.4); g.lineTo(w * 0.12 + Math.cos(a + 0.07) * w * 1.4, h * 0.1 + Math.sin(a + 0.07) * w * 1.4); g.fill();
  }
  const sg = g.createRadialGradient(w * 0.12, h * 0.1, 0, w * 0.12, h * 0.1, w * 0.3);
  sg.addColorStop(0, 'rgba(255,255,255,0.95)'); sg.addColorStop(0.15, 'rgba(255,255,220,0.5)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sg; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  // fluffy clouds
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [cx, cy, s] of [[0.7, 0.18, 1], [0.88, 0.3, 0.7], [0.45, 0.36, 0.6]]) for (const [dx, dy, r] of [[0, 0, 9], [10, 2, 7], [-9, 3, 6], [4, -5, 7]]) { g.beginPath(); g.arc(w * cx + dx * s * 1.4, h * cy + dy * s, r * s * 1.4, 0, TAU); g.fill(); }
  // glossy leaves framing the top corners
  for (const [lx, ly, a, sx] of [[w - 8, 6, 2.4, -1], [w - 26, -2, 2.0, -1], [6, h * 0.58, -0.5, 1]]) {
    g.save(); g.translate(lx, ly); g.rotate(a); g.scale(sx, 1);
    const lg = g.createLinearGradient(0, -8, 0, 8); lg.addColorStop(0, '#c8f56a'); lg.addColorStop(1, '#3fae2a');
    g.fillStyle = lg; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(14, -10, 30, 0); g.quadraticCurveTo(14, 10, 0, 0); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(2, 0); g.lineTo(28, 0); g.stroke();
    g.restore();
  }
  bgCache.set(key, c);
  return c;
}

export class WardrobePanel {
  constructor() {
    this.id = 'wardrobe';
    this.modal = true;
    this.sound = 'box_open';
    this.tab = 'tint';
    this.boatSlot = 'hull';
    this.t = 0;
    this.yaw = -24;
    this.yawV = 0;
    this.drag = null;
    this.pose = 'show';
    this.poseT = 0;
    this.sel = null;
    this.scroll = {};
    this.line = null;
    this.lineT = 0;
    this.pops = [];
    this.tsz = {};
  }

  open(data) {
    const g = this.game;
    if (data?.slot && TABS.includes(data.slot)) this.tab = data.slot;
    this.t = 0; this.openT = 0; this.pose = 'show'; this.poseT = 0; this.yaw = -24; this.yawV = 0; this.idleT = 0;
    if (!g.state.character) g.state.character = normalizeLook(null);
    try { ensureBoat(g.state); } catch { /* boat state optional */ }
    const eq = g.state.rods?.equipped;
    if (eq && g.state.character.labRod !== eq) g.state.character = { ...g.state.character, labRod: eq };
    this.selectEquipped();
    g.audio?.play?.('net_swish', { vol: 0.5 });
  }

  close() { this.drag = null; }

  get look() { return normalizeLook(this.game.state.character); }
  items(slot = this.tab) {
    const list = WARDROBE.filter((w) => w.slot === slot);
    return list;
  }
  owns(item) { return ownsCosmetic(this.game.state, item); }

  selectEquipped() {
    if (this.tab === 'boat') { this.sel = null; return; }
    const L = this.look;
    const list = this.items();
    this.sel = (list.find((w) => isEquipped(L, w)) || list[0])?.id;
  }
  selItem() { return WARDROBE.find((w) => w.id === this.sel) || null; }

  previewLook() {
    const L = this.look;
    const it = this.selItem();
    if (it && !isEquipped(L, it)) return equipItem(L, it);
    return L;
  }

  say(text) { this.line = text; this.lineT = 0; }
  setPose(p) { this.pose = p; this.poseT = 0; }
  burst(color, n = 10) {
    const a = this.anchor;
    if (!a) return;
    for (let i = 0; i < n; i++) this.pops.push({ x: a.x + (Math.random() - 0.5) * 60, y: a.y + (Math.random() - 0.5) * 70, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 40, t: 0, c: i % 2 ? color : '#ffffff' });
  }
  changed() { const g = this.game; g.save?.(); g.emit?.('character', g.state.character); }

  // ---------------------------------------------------------------- actions
  equip(item) {
    const g = this.game;
    let L = this.look;
    if (isEquipped(L, item) && NONE_FIRST.has(item.slot) && item.value !== 'none') L = equipItem(L, this.items(item.slot).find((w) => w.value === 'none'));
    else L = equipItem(L, item);
    g.state.character = { ...L, labRod: g.state.character?.labRod };
    g.audio?.play?.(SLOT_SOUND[item.slot] || 'ui_click', { vol: 0.7, pitch: 0.9 + Math.random() * 0.3 });
    this.burst('#bff6ff', 8);
    if (item.slot === 'emote') this.setPose('emote');
    else if (Math.random() < 0.3) this.setPose(pick(['cheer', 'wave']));
    if (this.t - (this.lastSay || -9) > 2) { this.say(pick(SAY.equip)); this.lastSay = this.t; }
    this.changed();
  }

  buy(item) {
    const g = this.game;
    if (this.owns(item) || item.price == null) return;
    if ((g.state.coins | 0) < item.price || !(g.spendCoins ? g.spendCoins(item.price) : ((g.state.coins -= item.price), true))) {
      g.audio?.play?.('ui_error'); this.say(pick(SAY.broke)); this.shakeT = 0.4; this.setPose('sad'); return;
    }
    grantCosmetic(g.state, item.id);
    g.audio?.play?.('ui_buy'); g.audio?.play?.('coin_collect', { vol: 0.6 });
    if (item.rarity === 'epic' || item.rarity === 'legendary') g.audio?.play?.('catch_rare', { vol: 0.5 });
    this.say(pick(SAY.buy));
    g.emit?.('buy', item.id);
    this.equip(item);
    this.setPose('cheer');
    this.burst('#ffe27a', 16);
  }

  randomize() {
    const g = this.game;
    let L = this.look;
    for (const s of WARDROBE_SLOTS) {
      const own = this.items(s.id).filter((w) => this.owns(w));
      if (own.length) L = equipItem(L, pick(own));
    }
    g.state.character = { ...L, labRod: g.state.character?.labRod };
    g.audio?.play?.('boing', { pitch: 1.2 }); g.audio?.play?.('puff', { vol: 0.6 });
    this.yawV = 900; this.say(pick(SAY.random)); this.setPose('cheer'); this.burst('#ff9ad0', 14);
    this.selectEquipped(); this.changed();
  }

  reset() {
    const g = this.game;
    g.state.character = { ...normalizeLook({ ...DEFAULT_CHARACTER, boat: this.look.boat }), labRod: g.state.character?.labRod };
    g.audio?.play?.('puff'); this.setPose('wave'); this.selectEquipped(); this.changed();
  }

  // boat parts
  partOwned(slot, p) { const pr = PART_PRICE[p.rarity]; return pr === 0 || !!this.game.state.cosmetics?.[`boatpart:${slot}:${p.id}`]; }
  boatState() { return ensureBoat(this.game.state); }
  tierOwned(i) {
    const st = this.game.state, b = st.boat || {};
    if (i === 0 || i <= (b.maxTier ?? b.tier ?? 0)) return true;
    try { return labUnlocked(st, 'boat', BOAT_TIERS[i].id); } catch { return false; }
  }
  equipPart(slot, p) {
    const g = this.game, b = this.boatState();
    b.parts = { ...b.parts, [slot]: p.id };
    if (slot === 'hull' && p.color) g.state.character = { ...this.look, labRod: g.state.character?.labRod, boat: p.color };
    g.audio?.play?.('splash_small', { vol: 0.6 });
    this.say(pick(SAY.equip));
    this.changed();
  }
  buyPart(slot, p) {
    const g = this.game, pr = PART_PRICE[p.rarity];
    if (pr == null || (g.state.coins | 0) < pr || !(g.spendCoins ? g.spendCoins(pr) : ((g.state.coins -= pr), true))) { g.audio?.play?.('ui_error'); this.say(pick(SAY.broke)); return; }
    (g.state.cosmetics ||= {})[`boatpart:${slot}:${p.id}`] = true;
    g.audio?.play?.('ui_buy');
    this.equipPart(slot, p);
  }

  // ---------------------------------------------------------------- frame
  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    this.openT = Math.min(1, (this.openT || 0) + dt * 2.2);
    const SW = g.screen.W, SH = g.screen.H;
    const W = Math.min(SW - 16, 780), H = Math.min(SH - 40, 468);
    const k = ease.outBack ? ease.outBack(this.openT) : this.openT;
    const r = { x: Math.round((SW - W) / 2), y: Math.round((SH - H) / 2 + (1 - k) * 16), w: W, h: H };
    this.rect = r;
    drawAeroPanel(ctx, r.x, r.y, W, H, { tone: 'glass', radius: 10, glow: true });
    this.drawHeader(ctx, ui, { x: r.x + 10, y: r.y + 6, w: W - 20, h: 26 });
    const stage = { x: r.x + 10, y: r.y + 38, w: Math.round(W * 0.4), h: H - 38 - 44 };
    this.drawStage(ctx, ui, stage, dt);
    this.drawStageBar(ctx, ui, { x: stage.x, y: stage.y + stage.h + 6, w: stage.w, h: 30 });
    const rx = stage.x + stage.w + 10, rw = r.x + W - 10 - rx;
    const tabs = { x: rx, y: r.y + 38, w: rw, h: 62 };
    this.drawTabs(ctx, ui, tabs);
    if (!ui.isOpen(this.id)) return;
    const info = { x: rx, y: r.y + H - 10 - 62, w: rw, h: 62 };
    const grid = { x: rx, y: tabs.y + tabs.h + 6, w: rw, h: info.y - 6 - (tabs.y + tabs.h + 6) };
    if (this.tab === 'boat') { this.drawBoatGrid(ctx, ui, grid); this.drawBoatInfo(ctx, ui, info); }
    else { this.drawGrid(ctx, ui, grid, dt); this.drawInfo(ctx, ui, info); }
    this.drawPops(ctx, dt);
    if (inp.keyPressed?.('r')) this.randomize();
    if (inp.keyPressed?.('ArrowLeft')) { this.yawV += 260; this.idleT = 0; }
    if (inp.keyPressed?.('ArrowRight')) { this.yawV -= 260; this.idleT = 0; }
  }

  drawHeader(ctx, ui, h) {
    const g = this.game, st = g.state;
    drawGlossOrb(ctx, h.x + 11, h.y + 13, 11, '#59d8ff', this.t);
    ctx.drawImage(glyph('tint'), h.x + 1, h.y + 3);
    let wa = null;
    try { wa = wordArt('Wardrobe', { scale: 2 }); } catch { wa = null; }
    if (wa) ctx.drawImage(wa, h.x + 28, h.y + Math.round((26 - wa.height) / 2));
    else aeroText(ctx, 'Wardrobe', h.x + 28, h.y + 9, { color: AERO.ink });
    // Aero balance pill
    const amt = fmtAero(st.coins || 0), tw = measureText(amt, 'normal');
    const pw = tw + 30, px = h.x + h.w - 34 - pw;
    drawAeroButton(ctx, px, h.y + 3, pw, 20, { tone: 'sky', label: '' });
    drawAeroCoin(ctx, px + 11, h.y + 13, 6, this.t);
    drawText(ctx, amt, px + 21, h.y + 9, { color: '#ffffff', shadow: '#0a3e74' });
    // close orb
    const cr = { x: h.x + h.w - 24, y: h.y + 1, w: 24, h: 24 };
    const hov = ui.hover(cr);
    drawGlossOrb(ctx, cr.x + 12, cr.y + 12, hov ? 11 : 10, '#ff5a5e', this.t);
    const cx = getUiIcon('cross');
    if (cx) ctx.drawImage(cx, Math.round(cr.x + 12 - cx.width / 2), Math.round(cr.y + 12 - cx.height / 2));
    if (hov) ui.tip = 'Close (Esc)';
    if (ui.clicked(cr)) { g.audio?.play?.('ui_click'); ui.close(this.id); }
  }

  // ---------------------------------------------------------------- stage
  drawStage(ctx, ui, s, dt) {
    const g = this.game, inp = g.input, t = this.t;
    ctx.save();
    ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
    ctx.drawImage(stageBg(s.w, s.h), s.x, s.y);
    // drifting bubbles
    for (let i = 0; i < 9; i++) {
      const ph = (t * (0.05 + (i % 3) * 0.02) + i * 0.137) % 1;
      const bx = s.x + ((i * 53) % s.w) + Math.sin(t * 0.8 + i) * 6, by = s.y + s.h - ph * (s.h + 30);
      drawAeroBubble(ctx, bx, by, 3 + (i % 4) * 2, 0.8);
    }
    const floorY = s.y + Math.round(s.h * 0.86);
    const cx = s.x + Math.round(s.w / 2);
    if (this.tab === 'boat') this.drawBoatStage(ctx, ui, s, cx, floorY);
    else {
      this.drawPodium(ctx, cx, floorY, s);
      const look = this.previewLook();
      const sc = clamp(Math.round(((s.h * 0.66) / 72) * 4) / 4, 1.25, 2.5);
      const shake = this.shakeT > 0 ? Math.round(Math.sin(t * 60) * 2) : 0;
      this.shakeT = Math.max(0, (this.shakeT || 0) - dt);
      const lookAt = ui.hover(s) && !this.drag ? [inp.x, inp.y] : null;
      const a = drawCharacter(ctx, cx + shake, floorY - 5, { pose: this.pose, t: this.poseT, yaw: this.yaw, scale: sc, look, id: 'wardrobe', lookAt, shadow: true });
      this.anchor = { x: a.head[0], y: (a.head[1] + floorY) / 2 };
      const sel = this.selItem();
      if (sel && !this.owns(sel)) {
        const bob = Math.round(Math.sin(t * 3));
        drawAeroButton(ctx, s.x + 6, s.y + 6 + bob, 74, 16, { tone: 'orange', label: 'TRY ON', font: 'small' });
      }
      this.drawSpeech(ctx, s, a, dt);
      this.updateSpin(ui, s, dt);
    }
    ctx.restore();
    // glass frame
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
    ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
    ctx.strokeStyle = rgba(AERO.edge, 0.55);
    ctx.strokeRect(s.x - 0.5, s.y - 0.5, s.w + 1, s.h + 1);
    this.poseT += dt;
    if (this.pose !== 'show' && this.poseT > (this.pose === 'emote' ? 3 : 2.3)) this.setPose('show');
  }

  drawPodium(ctx, cx, fy, s) {
    const rw = Math.round(s.w * 0.34), rh = Math.round(rw * 0.26);
    drawAeroGlow(ctx, cx, fy, rw * 1.1, '#bff6ff', 0.45);
    // side band
    ctx.fillStyle = '#1890c0';
    ctx.beginPath(); ctx.ellipse(cx, fy + 5, rw, rh, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2fd3e8'; ctx.fillRect(cx - rw, fy, rw * 2, 5);
    // top face
    const gr = ctx.createLinearGradient(0, fy - rh, 0, fy + rh);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#bfeaff');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.ellipse(cx, fy, rw, rh, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, fy, rw - 2, rh - 2, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    // rim lights turn with the character
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + (this.yaw * Math.PI) / 180;
      const x = cx + Math.cos(a) * (rw - 1), y = fy + 2.5 + Math.sin(a) * (rh + 1);
      if (Math.sin(a) < -0.2) continue;
      ctx.fillStyle = i % 3 ? '#7affff' : '#ffffff';
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }

  drawSpeech(ctx, s, a, dt) {
    if (!this.line) return;
    this.lineT += dt;
    if (this.lineT > 1.8) { this.line = null; return; }
    const tw = measureText(this.line, 'normal') + 14, th = 18;
    const x = clamp(a.head[0] + 18, s.x + 4, s.x + s.w - tw - 4), y = Math.max(s.y + 4, a.head[1] - 34) - Math.round(Math.min(1, this.lineT * 6) * 3);
    drawAeroButton(ctx, x, y, tw, th, { tone: 'white', label: this.line });
  }

  updateSpin(ui, s, dt) {
    const g = this.game, inp = g.input;
    const over = ui.hover(s);
    if (over && inp.pressed && !this.drag) { inp.pressed = false; this.drag = { last: inp.x, moved: 0 }; this.yawV = 0; }
    if (this.drag) {
      if (inp.down) {
        const dx = inp.x - this.drag.last;
        this.drag.moved += Math.abs(dx); this.drag.last = inp.x;
        this.yaw -= dx * 1.6;
        this.yawV = lerp(this.yawV, (-dx * 1.6) / Math.max(dt, 1e-3), 0.5);
      } else {
        if (this.drag.moved < 3) { g.audio?.play?.(pick(['squeak', 'blub', 'boing']), { vol: 0.6 }); this.say(pick(SAY.poke)); this.setPose(pick(['wave', 'cheer', 'laugh'])); this.yawV = 0; }
        else if (Math.abs(this.yawV) > 700) this.say(pick(SAY.spin));
        this.drag = null;
      }
      this.idleT = 0;
    } else {
      this.yaw += this.yawV * dt;
      this.yawV *= Math.exp(-dt * 2.8);
      if (Math.abs(this.yawV) < 4) this.yawV = 0;
      this.idleT = (this.idleT || 0) + dt;
      if (this.idleT > 5 && !this.yawV) { const target = -24 + Math.sin(this.t * 0.35) * 22; const d = (((target - this.yaw) % 360) + 540) % 360 - 180; this.yaw += d * Math.min(1, dt * 0.8); }
    }
    this.yaw = ((((this.yaw + 180) % 360) + 360) % 360) - 180;
    if (over && !this.drag) ui.tip = ui.tip || 'Drag to spin';
  }

  drawStageBar(ctx, ui, b) {
    const g = this.game;
    const orbs = [
      { id: 'emote', icon: 'star', tip: 'Play your emote', color: '#ffcf3a', act: () => { this.setPose('emote'); g.audio?.play?.('chirp'); } },
      { id: 'random', icon: 'sparkle', tip: 'Shuffle (R)', color: '#ff9ad0', act: () => this.randomize() },
      { id: 'reset', icon: 'home', tip: 'Classic look', color: '#8be04a', act: () => this.reset() },
    ];
    if (this.tab === 'boat') orbs.length = 1;
    const r = 13, gap = 10;
    const total = orbs.length * r * 2 + (orbs.length - 1) * gap;
    let x = b.x + Math.round((b.w - total) / 2) + r;
    for (const o of orbs) {
      const rr = { x: x - r, y: b.y + 2, w: r * 2, h: r * 2 };
      const hov = ui.hover(rr);
      drawGlossOrb(ctx, x, b.y + 2 + r, hov ? r + 1 : r, o.color, this.t);
      const ic = getUiIcon(o.icon);
      if (ic) ctx.drawImage(ic, Math.round(x - ic.width / 2), Math.round(b.y + 2 + r - ic.height / 2));
      if (hov) ui.tip = o.tip;
      if (ui.clicked(rr)) { g.audio?.play?.('ui_click'); o.act(); }
      x += r * 2 + gap;
    }
  }

  // ---------------------------------------------------------------- tabs
  drawTabs(ctx, ui, b) {
    const g = this.game;
    const n = TABS.length, perRow = Math.ceil(n / 2);
    const cw = Math.floor(b.w / perRow), ch = 30;
    TABS.forEach((id, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const x = b.x + col * cw, y = b.y + row * (ch + 2);
      const rr = { x, y, w: cw - 2, h: ch };
      const active = this.tab === id, hov = ui.hover(rr);
      drawAeroButton(ctx, x, y, cw - 2, ch, { tone: active ? 'aqua' : hov ? 'white' : 'frost', state: hov && !active ? 'hover' : 'normal', radius: 8 });
      const gl = glyph(id);
      const bob = active ? Math.round(Math.sin(this.t * 4) * 1) : 0;
      ctx.drawImage(gl, Math.round(x + (cw - 2 - gl.width) / 2), Math.round(y + (ch - gl.height) / 2) + bob);
      if (hov) ui.tip = id === 'boat' ? 'Boat' : WARDROBE_SLOTS.find((s) => s.id === id)?.name;
      if (ui.clicked(rr) && !active) {
        this.tab = id;
        this.selectEquipped();
        g.audio?.play?.('ui_tab', { vol: 0.6 });
      }
    });
  }

  // ---------------------------------------------------------------- cosmetic grid
  drawGrid(ctx, ui, b, dt) {
    const g = this.game, inp = g.input, t = this.t;
    const items = this.items();
    const cw = 58, chh = 64, gap = 4;
    const cols = Math.max(1, Math.floor((b.w + gap) / (cw + gap)));
    const ox = b.x + Math.floor((b.w - (cols * (cw + gap) - gap)) / 2);
    const rows = Math.ceil(items.length / cols);
    const maxScroll = Math.max(0, rows * (chh + gap) - gap - b.h);
    let sc = this.scroll[this.tab] || 0;
    if (ui.hover(b) && inp.wheel) sc += inp.wheel * 24;
    sc = clamp(sc, 0, maxScroll);
    this.scroll[this.tab] = sc;
    // well
    ctx.fillStyle = 'rgba(190,232,250,0.35)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    const base = this.look;
    let hovItem = null;
    items.forEach((it, i) => {
      const x = ox + (i % cols) * (cw + gap), y = b.y + Math.floor(i / cols) * (chh + gap) - sc;
      if (y + chh < b.y || y > b.y + b.h) return;
      const cell = { x, y, w: cw, h: chh };
      const hov = ui.hover(cell) && ui.hover(b);
      if (hov) hovItem = it;
      this.drawCard(ctx, it, cell, base, hov, t);
      if (hov && inp.pressed) { inp.pressed = false; this.click(it); }
    });
    ctx.restore();
    if (maxScroll > 0) {
      const th = Math.max(16, (b.h * b.h) / (b.h + maxScroll));
      const ty = b.y + (sc / maxScroll) * (b.h - th);
      ctx.fillStyle = 'rgba(12,58,82,0.15)'; ctx.fillRect(b.x + b.w - 4, b.y, 3, b.h);
      ctx.fillStyle = '#59c3ff'; ctx.fillRect(b.x + b.w - 4, Math.round(ty), 3, Math.round(th));
    }
    if (hovItem) {
      ui.tip = hovItem.name;
      if (hovItem.id !== this.hoverId) { this.hoverId = hovItem.id; g.audio?.play?.('ui_hover', { vol: 0.35 }); }
    }
    void dt;
  }

  click(it) {
    const g = this.game;
    this.sel = it.id;
    if (this.owns(it)) this.equip(it);
    else { g.audio?.play?.('ui_click'); g.audio?.play?.(SLOT_SOUND[it.slot] || 'boing', { vol: 0.35, pitch: 1.3 }); }
  }

  drawCard(ctx, it, c, base, hov, t) {
    const own = this.owns(it), worn = isEquipped(base, it), sel = this.sel === it.id;
    const R = RARITY[it.rarity] || RARITY.common;
    const lift = hov ? -1 : 0;
    drawAeroButton(ctx, c.x, c.y + lift, c.w, c.h, { tone: sel ? 'sky' : worn ? 'white' : 'frost', state: hov ? 'hover' : 'normal', radius: 8 });
    // rarity glow at the bottom + pips
    const rg = ctx.createLinearGradient(0, c.y + c.h - 18, 0, c.y + c.h);
    rg.addColorStop(0, rgba(R.color, 0)); rg.addColorStop(1, rgba(R.color, it.rarity === 'common' ? 0.35 : 0.75));
    ctx.fillStyle = rg; ctx.fillRect(c.x + 3, c.y + c.h - 18 + lift, c.w - 6, 16);
    if (it.rarity === 'legendary' || it.rarity === 'epic') drawSparkle(ctx, c.x + c.w - 9, c.y + 7 + lift, 2, 0.6 + 0.4 * Math.sin(t * 4 + c.x), it.rarity === 'legendary' ? '#fff2a0' : '#ffe0ff');
    // thumbnail
    const sz = this.tsz[it.slot] ?? THUMB[it.slot] ?? 0.7;
    let pv = itemPreview(base, it, sz);
    if (pv && (pv.w > c.w - 4 || pv.h > c.h - 8) && sz > 0.3) {
      // too big for the card: shrink this slot's thumbnails (rebuilt at the new size)
      this.tsz[it.slot] = Math.max(0.3, Math.floor(sz * Math.min((c.w - 4) / pv.w, (c.h - 8) / pv.h) * 20) / 20);
      pv = null;
    }
    const cx = c.x + c.w / 2, by = c.y + c.h - 6 + lift - (pv && pv.h < c.h - 20 ? Math.round((c.h - 12 - pv.h) / 2) : 0);
    if (pv) {
      const a = ctx.globalAlpha;
      if (!own) ctx.globalAlpha = a * 0.72;
      drawItemPreview(ctx, pv, cx, by, t + c.x * 0.01, 'wd:' + it.id);
      ctx.globalAlpha = a;
    } else {
      drawGlossOrb(ctx, cx, c.y + c.h / 2, 8, '#bfeaff', t);
    }
    if (it.value === 'none' && (it.slot !== 'tint')) { ctx.drawImage(glyph(it.slot === 'trail' || it.slot === 'emote' ? 'trail' : it.slot), Math.round(cx - 10), Math.round(c.y + 18)); ctx.fillStyle = '#ff5a6a'; for (let k = -9; k <= 9; k++) ctx.fillRect(Math.round(cx + k), Math.round(c.y + 28 + k * 0.6), 2, 2); }
    // states
    if (worn) {
      drawGlossOrb(ctx, c.x + c.w - 8, c.y + 8 + lift, 6, '#5cc832', t);
      const ck = getUiIcon('check');
      if (ck) ctx.drawImage(ck, Math.round(c.x + c.w - 8 - ck.width / 2), Math.round(c.y + 8 + lift - ck.height / 2));
    } else if (!own) {
      if (it.price != null) {
        drawAeroCoin(ctx, c.x + 8, c.y + 8 + lift, 4, t);
        drawText(ctx, it.price >= 1000 ? (it.price / 1000).toFixed(it.price % 1000 ? 1 : 0) + 'k' : String(it.price), c.x + 14, c.y + 5 + lift, { font: 'small', color: AERO.ink, shadow: '#ffffff' });
      } else {
        const lk = getUiIcon('lock');
        if (lk) ctx.drawImage(lk, Math.round(c.x + 4), Math.round(c.y + 3 + lift));
      }
    }
  }

  drawInfo(ctx, ui, b) {
    const g = this.game, st = g.state;
    drawAeroPanel(ctx, b.x, b.y, b.w, b.h, { tone: 'glass', radius: 8, bubbles: 0, sparkle: 0 });
    const it = this.selItem();
    if (!it) return;
    const R = RARITY[it.rarity] || RARITY.common;
    drawText(ctx, it.name, b.x + 10, b.y + 8, { color: AERO.ink, shadow: '#ffffff' });
    const nw = measureText(it.name, 'normal');
    const tag = R.name.toUpperCase(), tw = measureText(tag, 'small') + 10;
    drawAeroButton(ctx, b.x + 16 + nw, b.y + 6, tw, 12, { tone: { top: mix(R.color, '#ffffff', 0.5), mid: it.rarity === 'common' ? '#9fb0c0' : R.color, bot: R.dark, edge: shade(R.dark, -0.3), text: '#ffffff', shadow: shade(R.dark, -0.4), glow: '#ffffff', a: [1, 1] }, label: tag, font: 'small' });
    drawText(ctx, it.desc || '', b.x + 10, b.y + 24, { font: 'small', color: AERO.inkSoft });
    const own = this.owns(it), worn = isEquipped(this.look, it);
    const bw = 116, bh = 24, bx = b.x + b.w - bw - 10, by = b.y + b.h - bh - 8;
    const rr = { x: bx, y: by, w: bw, h: bh };
    const hov = ui.hover(rr);
    if (own) {
      const canOff = worn && NONE_FIRST.has(it.slot) && it.value !== 'none';
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'green', label: worn ? (canOff ? 'Take off' : 'Wearing') : 'Wear', icon: worn && !canOff ? getUiIcon('check') : null, state: worn && !canOff ? 'disabled' : hov ? 'hover' : 'normal' });
      if ((!worn || canOff) && ui.clicked(rr)) this.equip(it);
    } else if (it.price != null) {
      const afford = (st.coins | 0) >= it.price;
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'orange', label: '', state: afford ? (hov ? 'hover' : 'normal') : 'disabled' });
      drawAeroCoin(ctx, bx + 16, by + 12, 6, this.t);
      drawText(ctx, fmtAero(it.price), bx + 26, by + 8, { color: '#ffffff', shadow: afford ? '#843a04' : '#5a6a7c' });
      if (hov) ui.tip = afford ? `Buy for ${fmtAero(it.price)} ${CURRENCY}` : `Need ${fmtAero(it.price - (st.coins | 0))} more ${CURRENCY}`;
      if (ui.clicked(rr)) { if (afford) this.buy(it); else { g.audio?.play?.('ui_error'); this.say(pick(SAY.broke)); this.shakeT = 0.4; } }
    } else {
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'grey', label: it.unlock === 'skill' ? 'Lab reward' : 'In crates', icon: getUiIcon('lock'), state: 'normal' });
      if (hov) ui.tip = it.unlock === 'skill' ? 'Unlock it in The Lab' : 'Fish up floating crates to find it';
      if (ui.clicked(rr)) g.audio?.play?.('ui_error');
    }
  }

  // ---------------------------------------------------------------- boat tab
  drawBoatStage(ctx, ui, s, cx, floorY) {
    const st = this.game.state, b = st.boat || { tier: 0, parts: {} };
    const tier = clamp(b.tier | 0, 0, BOAT_TIERS.length - 1);
    const hovPart = this.hoverPart;
    const parts = hovPart ? { ...b.parts, [hovPart.slot]: hovPart.id } : b.parts;
    const base = renderBoatPreview(tier, null, { scale: 1 });
    const scale = clamp(Math.floor(((s.w * 0.9) / base.canvas.width) * 4) / 4, 0.75, 2);
    const pv = renderBoatPreview(tier, parts, { scale });
    // water strip
    const wy = s.y + Math.round(s.h * 0.66);
    const wg = ctx.createLinearGradient(0, wy, 0, s.y + s.h);
    wg.addColorStop(0, 'rgba(90,200,255,0.85)'); wg.addColorStop(1, 'rgba(20,110,200,0.95)');
    ctx.fillStyle = wg; ctx.fillRect(s.x, wy, s.w, s.y + s.h - wy);
    const fit = Math.min(1, (s.w - 16) / pv.canvas.width);
    const bob = Math.sin(this.t * 1.6) * 1.5;
    ctx.save();
    ctx.translate(cx, wy + bob);
    if (fit < 1) ctx.scale(fit, fit);
    ctx.drawImage(pv.canvas, -pv.px, -pv.py);
    if (pv.stand) drawCharacter(ctx, pv.stand[0], pv.stand[1], { pose: 'idle', t: this.t, facing: 1, scale: 0.62 * pv.vs / 2, look: this.look, id: 'wardrobe-boat', shadow: true, trail: false });
    pv.drawFront(ctx, 0, 0, this.t, 1);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let x = s.x; x < s.x + s.w; x += 2) { const y = wy + Math.round(Math.sin(x * 0.12 + this.t * 2) * 1.5); ctx.fillRect(x, y, 2, 1); }
    void floorY; void ui;
  }

  drawBoatGrid(ctx, ui, b) {
    const g = this.game, inp = g.input, st = g.state;
    const bs = this.boatState();
    // tier strip
    const th = 30, tw = Math.floor(b.w / BOAT_TIERS.length);
    BOAT_TIERS.forEach((T, i) => {
      const r = { x: b.x + i * tw, y: b.y, w: tw - 2, h: th };
      const own = this.tierOwned(i), cur = (bs.tier | 0) === i, hov = ui.hover(r);
      drawAeroButton(ctx, r.x, r.y, r.w, r.h, { tone: cur ? 'aqua' : own ? 'white' : 'grey', state: hov && own ? 'hover' : 'normal', radius: 6 });
      const mini = renderBoatPreview(i, bs.parts, { scale: 0.25 });
      const k = Math.min(1, (r.w - 6) / mini.canvas.width, (r.h - 4) / mini.canvas.height);
      const mw = Math.round(mini.canvas.width * k), mh = Math.round(mini.canvas.height * k);
      const a0 = ctx.globalAlpha;
      if (!own) ctx.globalAlpha = a0 * 0.4;
      ctx.drawImage(mini.canvas, Math.round(r.x + (r.w - mw) / 2), Math.round(r.y + r.h - 3 - mh), mw, mh);
      ctx.globalAlpha = a0;
      if (!own) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, r.x + 3, r.y + 3); }
      if (hov) ui.tip = own ? T.name : `${T.name} (unlock in The Lab)`;
      if (own && !cur && ui.clicked(r)) { bs.maxTier = Math.max(bs.maxTier ?? bs.tier ?? 0, bs.tier | 0); bs.tier = i; g.audio?.play?.('splash_small'); this.changed(); }
    });
    // part slot pills
    const py = b.y + th + 4, pw = Math.floor(b.w / BOAT_PART_SLOTS.length);
    BOAT_PART_SLOTS.forEach((S, i) => {
      const r = { x: b.x + i * pw, y: py, w: pw - 2, h: 18 };
      const act = this.boatSlot === S.id, hov = ui.hover(r);
      drawAeroButton(ctx, r.x, r.y, r.w, r.h, { tone: act ? 'green' : 'frost', state: hov && !act ? 'hover' : 'normal', label: S.name, font: 'small', radius: 6 });
      if (!act && ui.clicked(r)) { this.boatSlot = S.id; g.audio?.play?.('ui_tab', { vol: 0.6 }); }
    });
    const gy = py + 22, gh = b.y + b.h - gy;
    ctx.fillStyle = 'rgba(190,232,250,0.35)'; ctx.fillRect(b.x, gy, b.w, gh);
    const list = BOAT_PARTS[this.boatSlot];
    const parts = resolveParts(bs.tier | 0, bs.parts);
    const cw = 58, chh = 50, gap = 4, cols = Math.max(1, Math.floor((b.w + gap) / (cw + gap)));
    const ox = b.x + Math.floor((b.w - (cols * (cw + gap) - gap)) / 2);
    this.hoverPart = null;
    list.forEach((p, i) => {
      const x = ox + (i % cols) * (cw + gap), y = gy + 4 + Math.floor(i / cols) * (chh + gap);
      if (y + chh > gy + gh) return;
      const r = { x, y, w: cw, h: chh };
      const hov = ui.hover(r), own = this.partOwned(this.boatSlot, p), worn = parts[this.boatSlot] === p.id;
      const R = RARITY[p.rarity] || RARITY.common;
      drawAeroButton(ctx, x, y, cw, chh, { tone: worn ? 'sky' : 'frost', state: hov ? 'hover' : 'normal', radius: 8 });
      const rg = ctx.createLinearGradient(0, y + chh - 14, 0, y + chh);
      rg.addColorStop(0, rgba(R.color, 0)); rg.addColorStop(1, rgba(R.color, p.rarity === 'common' ? 0.3 : 0.7));
      ctx.fillStyle = rg; ctx.fillRect(x + 3, y + chh - 14, cw - 6, 12);
      const a0 = ctx.globalAlpha;
      if (!own) ctx.globalAlpha = a0 * 0.55;
      this.drawPartIcon(ctx, this.boatSlot, p, x + cw / 2, y + chh / 2 - 2);
      ctx.globalAlpha = a0;
      if (worn) { drawGlossOrb(ctx, x + cw - 8, y + 8, 6, '#5cc832', this.t); const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, Math.round(x + cw - 8 - ck.width / 2), Math.round(y + 8 - ck.height / 2)); }
      else if (!own) { const pr = PART_PRICE[p.rarity]; if (pr != null) { drawAeroCoin(ctx, x + 8, y + 8, 4, this.t); drawText(ctx, String(pr), x + 14, y + 5, { font: 'small', color: AERO.ink, shadow: '#ffffff' }); } else { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, x + 4, y + 3); } }
      if (hov) { ui.tip = p.name; this.hoverPart = { slot: this.boatSlot, id: p.id }; this.selPart = p; }
      if (hov && inp.pressed) {
        inp.pressed = false;
        this.selPart = p; this.selPartLock = p;
        if (own) this.equipPart(this.boatSlot, p);
        else g.audio?.play?.('ui_click');
      }
    });
    void st;
  }

  drawPartIcon(ctx, slot, p, cx, cy) {
    const t = this.t;
    if (slot === 'hull') { drawGlossOrb(ctx, cx, cy, 13, p.color, t); ctx.fillStyle = p.trim; ctx.fillRect(Math.round(cx - 9), Math.round(cy + 6), 18, 2); return; }
    if (slot === 'sail') {
      const cols = { none: null, white: ['#ffffff', '#ffffff'], stripe: ['#2fd3e8', '#ffffff'], leaf: ['#9be84a', '#4cb82e'], bubble: ['#bff4ff', '#8ee4ff'], rainbow: ['#ff5a6a', '#ffe24a'], solar: ['#1a3a7a', '#6a9ae8'] }[p.id];
      ctx.fillStyle = '#9fb4c8'; ctx.fillRect(Math.round(cx + 6), Math.round(cy - 14), 2, 28);
      if (!cols) { ctx.fillStyle = '#ff5a6a'; for (let k = -8; k <= 8; k++) ctx.fillRect(Math.round(cx + k - 2), Math.round(cy + k), 2, 2); return; }
      for (let y = 0; y < 24; y++) {
        const w = Math.round((1 - y / 24) * 16 * (p.id === 'leaf' ? 0.6 + 0.6 * Math.sin((y / 24) * Math.PI) : 1));
        for (let x = 0; x < w; x++) {
          ctx.fillStyle = p.id === 'rainbow' ? ['#ff5a6a', '#ffb02a', '#ffe24a', '#5cd84a', '#3fa8ff'][Math.floor((x / 16) * 5)] : p.id === 'stripe' ? (Math.floor(y / 3) % 2 ? cols[0] : cols[1]) : p.id === 'solar' ? (x % 4 === 0 || y % 3 === 0 ? cols[1] : cols[0]) : (x + y) % 5 === 0 ? cols[1] : cols[0];
          ctx.fillRect(Math.round(cx + 5 - x), Math.round(cy + 11 - y), 1, 1);
        }
      }
      return;
    }
    if (slot === 'flag') {
      const pv = renderBoatPreview(0, { flag: p.id }, { scale: 1 });
      const f = pv.flag;
      ctx.fillStyle = '#9fb4c8'; ctx.fillRect(Math.round(cx - f.width / 2) - 2, Math.round(cy - f.height / 2) - 2, 2, f.height + 12);
      ctx.drawImage(f, Math.round(cx - f.width / 2), Math.round(cy - f.height / 2) - 2);
      return;
    }
    if (slot === 'engine') {
      const ic = { none: null, outboard: 'gear', turbine: 'cloud', solar: 'sun', bubble: 'bubble', paddle: 'reel' }[p.id];
      drawGlossOrb(ctx, cx, cy, 12, p.id === 'solar' ? '#ffd23a' : p.id === 'turbine' ? '#ffffff' : '#59c3ff', t);
      if (p.id === 'turbine') { ctx.fillStyle = AERO.ink; for (let i = 0; i < 3; i++) { const a = t * 5 + (i / 3) * TAU; for (let k = 2; k < 9; k++) ctx.fillRect(Math.round(cx + Math.cos(a) * k), Math.round(cy + Math.sin(a) * k), 2, 2); } return; }
      const icn = ic && getUiIcon(ic);
      if (icn) ctx.drawImage(icn, Math.round(cx - icn.width / 2), Math.round(cy - icn.height / 2));
      else if (!ic) { ctx.fillStyle = '#ff5a6a'; for (let k = -6; k <= 6; k++) ctx.fillRect(Math.round(cx + k), Math.round(cy + k), 2, 2); }
      return;
    }
    if (slot === 'decal') {
      const w = 40, h = 14, x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = '#2fb8e8'; ctx.fillRect(x0, y0 + h - 4, w, 4);
      ctx.fillStyle = AERO.edge; ctx.fillRect(x0, y0 + h, w, 1);
      for (let x = 0; x < w; x++) for (let y = 0; y < h - 4; y++) {
        let c = null;
        if (p.id === 'swoosh' && Math.abs(y - (h - 6) * (1 - (x / w) ** 2)) < 1.2) c = '#2fd3e8';
        if (p.id === 'wave' && Math.abs(y - 5 - Math.sin(x * 0.5) * 2) < 0.8) c = '#2fb8e8';
        if (p.id === 'stripes' && (y === 3 || y === 6)) c = y === 3 ? '#2fd3e8' : '#8be04a';
        if (p.id === 'leaves' && ((x % 10) - 5) ** 2 / 9 + (y - 5) ** 2 / 2 < 1) c = x % 20 < 10 ? '#4cb82e' : '#9be84a';
        if (p.id === 'bubbles' && Math.abs(Math.hypot((x % 9) - 4, y - 4) - 2.5) < 0.6) c = '#59c3ff';
        if (p.id === 'dolphin' && Math.abs(y - 5 + Math.sin(x * 0.3) * 2) < 1.2 && x > 8 && x < 30) c = '#59c3ff';
        if (c) { ctx.fillStyle = c; ctx.fillRect(x0 + x, y0 + y, 1, 1); }
      }
    }
  }

  drawBoatInfo(ctx, ui, b) {
    const g = this.game, st = g.state;
    drawAeroPanel(ctx, b.x, b.y, b.w, b.h, { tone: 'glass', radius: 8, bubbles: 0, sparkle: 0 });
    const bs = this.boatState();
    const T = BOAT_TIERS[bs.tier | 0];
    const p = this.selPartLock || null;
    drawText(ctx, p ? p.name : T.name, b.x + 10, b.y + 8, { color: AERO.ink, shadow: '#ffffff' });
    drawText(ctx, p ? (BOAT_PART_SLOTS.find((s) => s.id === this.boatSlot)?.name || '') + ' for your ' + T.name : T.desc, b.x + 10, b.y + 24, { font: 'small', color: AERO.inkSoft });
    if (!p) return;
    const own = this.partOwned(this.boatSlot, p), worn = resolveParts(bs.tier | 0, bs.parts)[this.boatSlot] === p.id;
    const bw = 116, bh = 24, bx = b.x + b.w - bw - 10, by = b.y + b.h - bh - 8, rr = { x: bx, y: by, w: bw, h: bh };
    const hov = ui.hover(rr);
    if (own) {
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'green', label: worn ? 'Fitted' : 'Fit', state: worn ? 'disabled' : hov ? 'hover' : 'normal' });
      if (!worn && ui.clicked(rr)) this.equipPart(this.boatSlot, p);
    } else {
      const pr = PART_PRICE[p.rarity];
      if (pr == null) { drawAeroButton(ctx, bx, by, bw, bh, { tone: 'grey', label: 'In crates', icon: getUiIcon('lock') }); return; }
      const afford = (st.coins | 0) >= pr;
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'orange', label: '', state: afford ? (hov ? 'hover' : 'normal') : 'disabled' });
      drawAeroCoin(ctx, bx + 16, by + 12, 6, this.t);
      drawText(ctx, fmtAero(pr), bx + 26, by + 8, { color: '#ffffff', shadow: '#843a04' });
      if (ui.clicked(rr)) this.buyPart(this.boatSlot, p);
    }
  }

  drawPops(ctx, dt) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt;
      if (p.t > 0.9) { this.pops.splice(i, 1); continue; }
      drawSparkle(ctx, Math.round(p.x), Math.round(p.y), 2, 1 - p.t / 0.9, p.c);
    }
  }
}

// Small dock / desktop icon: a glossy orb with a tiny bubble person peeking out. Bottom centre at (x, y).
export function drawWardrobeIcon(ctx, x, y, o = {}) {
  const t = o.t || 0, hov = !!o.hover;
  const r = hov ? 15 : 14, cy = y - r - 2 - (hov ? Math.round(Math.abs(Math.sin(t * 6)) * 2) : 0);
  drawGlossOrb(ctx, x, cy, r, '#59d8ff', t);
  const L = normalizeLook(o.look);
  drawCharacter(ctx, x, cy + r - 2, { pose: hov ? 'wave' : 'stand', t, yaw: -20, scale: 0.42, look: L, id: 'dockicon:' + (o.id || 0), shadow: false, trail: false, rod: false });
  void emotePose;
  return { x: x - r, y: cy - r, w: r * 2, h: r * 2 + 2 };
}
