// Wardrobe (panel id 'wardrobe'; OWNER: Wardrobe agent). [wardrobe26] remake: compact UI over a voxel boutique.
// The whole window is a cosy VOXEL BOUTIQUE on a dock (src/ui/wardroberoom.js): the bubble person poses on a turntable
// that turns with it (drag or arrow keys to spin, the eyes follow the cursor, click to poke). A slim frosted column on
// the right holds everything else, kept small so the character always stays in view:
//   category chips (14 cosmetic slots + Boat, a red dot = something NEW), the slot name with owned / total,
//   a grid of item tiles (live voxel thumbnails; bubble tints as colour swatches; rarity band; equipped check;
//   NEW tag; Aero or Byte Gem price; padlock = Lab / crates), and a compact info card with one action
//   (Wear / Take off / Buy for Aero / Buy for gems / Locked).
// Stage buttons bottom-left: play emote, shuffle (R), classic look. Unowned items are tried on in the preview.
// Premium cosmetics (GEM_PRICES) can be bought with Byte Gems (src/game/gems.js) after a confirmation; crate items keep
// their crate route too. Ownership lives in state.cosmetics (boat parts: 'boatpart:<slot>:<id>'), so it saves.
// State: game.state.character (look), game.state.cosmetics, game.state.boat = {tier, parts}, game.state.wardrobeSeen
// (items already looked at: owned items missing from it show NEW).
// open({slot}) where slot is a WARDROBE_SLOTS id or 'boat'. drawWardrobeIcon(ctx, x, y, {hover, t, look}) -> rect.
//   GEM_PRICES {cosmeticId | 'boatpart:<slot>:<id>': gems}, gemPriceOf(item | key) -> number | null

import { clamp, lerp, ease, TAU } from '../core/math.js';
import { rgba, shade, mix, RARITY } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import {
  drawCharacter, WARDROBE, WARDROBE_SLOTS, TINTS, DEFAULT_CHARACTER, normalizeLook, ownsCosmetic, grantCosmetic, equipItem, isEquipped,
  itemPreview, drawItemPreview, emotePose,
} from '../gfx/character.js';
import { BOAT_TIERS, BOAT_PARTS, BOAT_PART_SLOTS, renderBoatPreview, resolveParts, ensureBoat } from '../world/boatmodels.js';
import { drawAeroButton, drawAeroSurface, aeroSurface, aeroCached, drawGlossOrb, drawAeroCoin, drawSparkle, drawTitle, fmtAero, AERO, CURRENCY, pixelBubbleTag } from './aero.js';
import { getBigIcon } from '../gfx/bigicons.js';
import { unlocked as labUnlocked } from '../game/lab.js';
import { gems, canSpendGems, spendGems, GEM_NAME } from '../game/gems.js';
import { drawHeaderWallet } from './gemui.js'; // [wallet32]
import { drawWardrobeRoom, warmWardrobeRoom, wardrobeRoomStats } from './wardroberoom.js';
import { HI, HI_ON } from '../gfx/hires.js';
import { drawPop3D } from './pop3d.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const SAY = {
  equip: ['Ooh!', 'Fresh!', 'So shiny!', 'Bubbly!', 'Love it!', 'Yes!'],
  buy: ['Mine!', 'Ka-ching!', 'Sparkly!'],
  broke: ['Need more Aero Bucks...', 'Too pricey!'],
  brokeGems: ['Need more gems...', 'Quests give gems!'],
  poke: ['Hehe!', 'Boop!', 'Pop?', 'Hey!'],
  spin: ['Wheee!', 'Dizzy...'],
  random: ['Surprise!', 'Shuffle!'],
};
const SLOT_SOUND = { tint: 'blub', eyes: 'boing', mouth: 'honk', hat: 'boing', hair: 'boing', face: 'bell', top: 'puff', bottom: 'puff', gloves: 'squeak', shoes: 'squeak', back: 'puff', trail: 'bell', emote: 'chirp', rod: 'reel_tick', boat: 'splash_small' };
const THUMB = { eyes: 0.8, mouth: 0.8, face: 0.8, hat: 0.62, hair: 0.62, top: 1.2, bottom: 1, back: 1.15, trail: 0.45, emote: 0.45, gloves: 0.95, shoes: 0.9, rod: 0.45 };
const PART_PRICE = { common: 0, uncommon: 150, rare: 400, epic: 1000, legendary: null };
const TABS = [...WARDROBE_SLOTS.map((s) => s.id), 'boat'];
const NONE_FIRST = new Set(['hat', 'hair', 'face', 'back', 'trail', 'gloves']);

// ---------------------------------------------------------------- premium cosmetics (Byte Gems)
// A curated set of fun premium looks: the crate-exclusive hats / glasses / outfits / trails (still found in crates
// too) and a few boat finishes. Everything else keeps its normal unlock (free, Aero, Lab, crates).
export const GEM_PRICES = {
  hat_crown: 60, hair_halo: 50, face_star: 25, eyes_heart: 20, eyes_swirl: 20, mouth_kiss: 15,
  tint_oil: 30, tint_galaxy: 60, tint_gold: 60,
  top_astro: 45, bottom_astro: 30, gloves_gold: 40, shoes_moon: 25, back_jetpack: 55,
  trail_hearts: 25, trail_rainbow: 45, emote_bubbles: 20, rod_neon: 30,
  'boatpart:hull:gold': 50, 'boatpart:decal:dolphin': 25, 'boatpart:decal:stripes': 20,
};
export function gemPriceOf(item) { const k = typeof item === 'string' ? item : item?.id; return GEM_PRICES[k] ?? null; }

// ---------------------------------------------------------------- tab glyphs (tiny hand-drawn pixel art, 2x)
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
  shuffle: ['......#.', '###..#w#', '...##.#.', '...##...', '###..#.#', '.....#w#', '......#.'],
  gem: ['.#####.', '#wwaaq#', '#waaaq#', '.#aaq#.', '..#q#..', '...#...'],
};
const GCOL = { '#': AERO.ink, w: '#ffffff', a: '#2fd3e8', g: '#5cc832', p: '#ff9ad0', r: '#ff5a7a', k: '#1a2a5a', q: '#8a5cf0' };
const glyphCache = new Map();
function glyph(id, z = 2) {
  const key = id + z;
  let c = glyphCache.get(key);
  if (c) return c;
  const rows = GLYPHS[id] || GLYPHS.tint, w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  c = makeCanvas(w * z, h * z);
  const g = ctxOf(c);
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const col = GCOL[row[x]]; if (col) { g.fillStyle = col; g.fillRect(x * z, y * z, z, z); } } });
  glyphCache.set(key, c);
  return c;
}
// the gem currency icon: the shared UI icon when the icon set has one, else a tiny pixel gem
function gemIcon() {
  const ic = getUiIcon('gem');
  return ic && ic.width > 1 ? ic : glyph('gem', 1);
}
function checkBadge(ctx, x, y) {
  ctx.fillStyle = AERO.ink; ctx.fillRect(x, y, 10, 10);
  ctx.fillStyle = '#5cc832'; ctx.fillRect(x + 1, y + 1, 8, 8);
  ctx.fillStyle = '#ffffff';
  for (const [px, py] of [[2, 4], [3, 5], [4, 4], [5, 3], [6, 2], [3, 4]]) ctx.fillRect(x + 1 + px, y + 1 + py, 1, 1);
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
    this.confirm = null;
    this.pop3 = null;
    // build the boutique for the current screen in idle slices a little after boot, so it opens instantly
    if (typeof window !== 'undefined') setTimeout(() => this.warm(), 6000);
  }

  roomStats() { return wardrobeRoomStats(); }

  warm(n = 0) {
    const g = this.game;
    if (!g?.screen?.W) { if (n < 10) setTimeout(() => this.warm(n + 1), 3000); return; }
    try { const { scene } = this.layout(); warmWardrobeRoom(scene.w, scene.h, HI_ON.on ? HI : 1); } catch { /* optional */ }
  }

  open(data) {
    const g = this.game;
    if (data?.slot && TABS.includes(data.slot)) this.tab = data.slot;
    this.t = 0; this.openT = 0; this.pose = 'show'; this.poseT = 0; this.yaw = -24; this.yawV = 0; this.idleT = 0; this.confirm = null;
    if (!g.state.character) g.state.character = normalizeLook(null);
    try { ensureBoat(g.state); } catch { /* boat state optional */ }
    const eq = g.state.rods?.equipped;
    if (eq && g.state.character.labRod !== eq) g.state.character = { ...g.state.character, labRod: eq };
    if (!g.state.wardrobeSeen) { // first visit: everything owned so far counts as seen
      g.state.wardrobeSeen = {};
      for (const w of WARDROBE) if (this.owns(w)) g.state.wardrobeSeen[w.id] = 1;
    }
    this.selectEquipped();
    g.audio?.play?.('net_swish', { vol: 0.5 });
  }

  close() { this.drag = null; this.confirm = null; }

  get look() { return normalizeLook(this.game.state.character); }
  items(slot = this.tab) { return WARDROBE.filter((w) => w.slot === slot); }
  owns(item) { return ownsCosmetic(this.game.state, item); }
  isNew(item) { const s = this.game.state.wardrobeSeen; return !!s && !s[item.id] && this.owns(item); }
  seen(item) { const st = this.game.state; if (item && st.wardrobeSeen && !st.wardrobeSeen[item.id] && this.owns(item)) st.wardrobeSeen[item.id] = 1; }
  slotHasNew(slot) { return slot !== 'boat' && this.items(slot).some((w) => this.isNew(w)); }

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
    for (let i = 0; i < n; i++) this.pops.push({ x: a.x + (Math.random() - 0.5) * 50, y: a.y + (Math.random() - 0.5) * 60, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 40, t: 0, c: i % 2 ? color : '#ffffff' });
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
    this.seen(item);
    this.equip(item);
    this.setPose('cheer');
    this.burst('#ffe27a', 16);
  }

  // Byte Gem purchase (after the confirmation): a cosmetic item or a boat part {slot, part}
  buyWithGems(c) {
    const g = this.game, st = g.state, n = c.price;
    const key = c.item ? c.item.id : `boatpart:${c.slot}:${c.part.id}`;
    if (!canSpendGems(st, n) || !spendGems(st, n, 'cosmetic:' + key)) { g.audio?.play?.('ui_error'); this.say(pick(SAY.brokeGems)); this.shakeT = 0.4; return; }
    if (c.item) { grantCosmetic(st, c.item.id); this.seen(c.item); }
    else (st.cosmetics ||= {})[key] = true;
    g.audio?.play?.('ui_buy'); g.audio?.play?.('catch_rare', { vol: 0.5 });
    g.emit?.('buy', key);
    g.emit?.('gemPurchase', { id: key, gems: n });
    if (c.item) { this.equip(c.item); this.setPose('cheer'); }
    else this.equipPart(c.slot, c.part);
    this.say(pick(SAY.buy));
    this.burst('#d8b4ff', 18);
    this.pop3 = { text: 'NEW LOOK!', t: 0 };
    try { const a = this.anchor; if (a) g.particles?.purchase?.(a.x, a.y - 20); } catch { /* particles optional */ }
    this.changed();
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
  partOwned(slot, p) { const pr = PART_PRICE[p.rarity]; return (pr === 0 && gemPriceOf(`boatpart:${slot}:${p.id}`) == null) || !!this.game.state.cosmetics?.[`boatpart:${slot}:${p.id}`]; }
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

  askGems(c) {
    const g = this.game;
    if (!canSpendGems(g.state, c.price)) { g.audio?.play?.('ui_error'); this.say(pick(SAY.brokeGems)); this.shakeT = 0.4; return; }
    g.audio?.play?.('ui_click');
    this.confirm = { ...c, t: 0 };
  }

  // ---------------------------------------------------------------- layout
  layout() {
    const g = this.game, SW = g.screen.W, SH = g.screen.H;
    const top = Math.min(SH, g.hud?.topY?.() ?? SH);
    const W = clamp(Math.round(SW * 0.68), Math.min(560, SW - 12), 740);
    const H = clamp(Math.min(Math.round(SH * 0.72), top - 14), Math.min(320, SH - 12), 440);
    const x = Math.round((SW - W) / 2), y = Math.round(Math.max(6, Math.min((SH - H) / 2, top - 8 - H)));
    const CW = clamp(Math.round(W * 0.36), 228, 276);
    const col = { x: x + W - 8 - CW, y: y + 32, w: CW, h: H - 40 };
    return { r: { x, y, w: W, h: H }, scene: { x: x + 4, y: y + 4, w: W - 8, h: H - 8 }, col };
  }

  // ---------------------------------------------------------------- frame
  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    this.openT = Math.min(1, (this.openT || 0) + dt * 2.2);
    const k = ease.outBack ? ease.outBack(this.openT) : this.openT;
    const Lr = this.layout();
    const dy = Math.round((1 - k) * 12);
    const r = { ...Lr.r, y: Lr.r.y + dy }, scene = { ...Lr.scene, y: Lr.scene.y + dy }, col = { ...Lr.col, y: Lr.col.y + dy };
    this.rect = r;
    // a modal confirmation takes the click
    const press = inp.pressed;
    if (this.confirm) inp.pressed = false;
    // soft drop shadow
    ctx.fillStyle = rgba('#03183a', 0.22);
    ctx.fillRect(r.x + 6, r.y + r.h, r.w - 10, 3); ctx.fillRect(r.x + r.w, r.y + 6, 3, r.h - 10);
    // the boutique + the character (or the boat) on the turntable
    const room = drawWardrobeRoom(ctx, scene, this.t, { spin: this.yaw });
    const stage = { x: scene.x, y: r.y + 30, w: col.x - 6 - scene.x, h: scene.y + scene.h - (r.y + 30) };
    this.drawStage(ctx, ui, stage, room, dt);
    room.front(ctx);
    // voxel window ring
    ctx.drawImage(aeroCached(`wd26ring|${r.w}|${r.h}`, () => aeroSurface(r.w, r.h, { ring: 4, r: 8, top: '#ffffff', mid: '#d2f1ff', bot: '#86c8f0', edge: '#06336e', gloss: 0.3, glossH: 6, rim: 1, glow: 0.3, depth: 2, block: 4, seed: 2600 + r.w })), r.x, r.y);
    this.drawHeader(ctx, ui, r);
    if (!ui.isOpen(this.id) && !ui.ghosting) { if (this.confirm) inp.pressed = press; return; }
    this.drawColumn(ctx, ui, col, dt);
    this.drawStageBar(ctx, ui, { x: stage.x + 8, y: r.y + r.h - 32, w: stage.w - 16, h: 22 });
    if (this.tab !== 'boat') this.updateSpin(ui, stage, dt);
    this.drawSpeech(ctx, stage, dt);
    this.drawPops(ctx, dt);
    this.drawPop3(ctx, stage, dt);
    if (this.confirm) { inp.pressed = press; this.drawConfirm(ctx, ui, r, dt); }
    if (!this.confirm && inp.keyPressed?.('r')) this.randomize();
    if (inp.keyPressed?.('ArrowLeft')) { this.yawV += 260; this.idleT = 0; }
    if (inp.keyPressed?.('ArrowRight')) { this.yawV -= 260; this.idleT = 0; }
    this.poseT += dt;
    if (this.pose !== 'show' && this.poseT > (this.pose === 'emote' ? 3 : 2.3)) this.setPose('show');
  }

  drawHeader(ctx, ui, r) {
    const g = this.game, st = g.state;
    // title plaque
    const ic = getBigIcon('wardrobe', { size: 'small' })?.canvas;
    const ttl = 'Wardrobe';
    const tw = Math.round(Math.max(measureText(ttl, 'normal') + 6, 58));
    const pw = tw + (ic ? 22 : 0) + 14, ph = 22;
    ctx.drawImage(aeroCached(`wd26plaque|${pw}`, () => aeroSurface(pw, ph, { tone: 'aqua', r: 6, gloss: 0.75, glossH: 9, curve: 2, rim: 0.9, glow: 0.6, depth: 1, block: 4, seed: 26 })), r.x + 7, r.y + 6);
    if (ic) { const s = 18 / Math.max(ic.width, ic.height); ctx.drawImage(ic, r.x + 11, r.y + 8, Math.round(ic.width * s), Math.round(ic.height * s)); }
    drawTitle(ctx, ttl, r.x + 13 + (ic ? 20 : 0), r.y + 11, { scale: 1 });
    // close orb
    const cr = { x: r.x + r.w - 26, y: r.y + 7, w: 19, h: 19 };
    this.frameClose = cr;
    if (ui.button(ctx, cr.x, cr.y, cr.w, cr.h, '', { icon: 'cross', tip: 'Close (Esc)', sound: 'ui_close' })) ui.close(this.id);
    drawHeaderWallet(ctx, ui, cr.x - 5, r.y + 7); // [wallet32] the shared pixel wallet (was two glossy pills)
  }

  // ---------------------------------------------------------------- stage
  drawStage(ctx, ui, s, room, dt) {
    const g = this.game, inp = g.input, t = this.t;
    const [fx, fy] = room.feet;
    if (this.tab === 'boat') { this.drawBoatStage(ctx, s, fx, fy); return; }
    const look = this.previewLook();
    const sc = clamp(Math.round(((s.h * 0.3) / 72) * 4) / 4, 1.25, 2.25);
    const shake = this.shakeT > 0 ? Math.round(Math.sin(t * 60) * 2) : 0;
    this.shakeT = Math.max(0, (this.shakeT || 0) - dt);
    const lookAt = ui.hover(s) && !this.drag && !this.confirm ? [inp.x, inp.y] : null;
    const a = drawCharacter(ctx, fx + shake, fy, { pose: this.pose, t: this.poseT, yaw: this.yaw, scale: sc, look, id: 'wardrobe', lookAt, shadow: true });
    this.anchor = { x: a.head[0], y: (a.head[1] + fy) / 2 };
    this.headA = a.head;
    const sel = this.selItem();
    if (sel && !this.owns(sel)) {
      const bob = Math.round(Math.sin(t * 3));
      drawAeroButton(ctx, s.x + 6, s.y + 2 + bob, 54, 15, { tone: 'orange', label: 'TRY ON', font: 'small', fixedFont: true, radius: 5 });
    }
  }

  drawSpeech(ctx, s, dt) {
    if (!this.line || !this.headA) return;
    this.lineT += dt;
    if (this.lineT > 1.8) { this.line = null; return; }
    const tw = measureText(this.line, 'normal') + 12, th = 16;
    const x = clamp(this.headA[0] + 16, s.x + 4, s.x + s.w - tw - 4), y = Math.max(s.y + 4, this.headA[1] - 30) - Math.round(Math.min(1, this.lineT * 6) * 3);
    drawAeroButton(ctx, x, y, tw, th, { tone: 'white', label: this.line, fixedFont: true, radius: 5 });
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
    const btns = [
      { id: 'emote', icon: () => getUiIcon('star'), tip: 'Play your emote', tone: 'orange', act: () => { this.setPose('emote'); g.audio?.play?.('chirp'); } },
      { id: 'random', icon: () => glyph('shuffle'), tip: 'Shuffle (R)', tone: 'purple', act: () => this.randomize() },
      { id: 'reset', icon: () => getUiIcon('home'), tip: 'Classic look', tone: 'green', act: () => this.reset() },
    ];
    if (this.tab === 'boat') btns.length = 1;
    let x = b.x;
    for (const o of btns) {
      // [bubble34] round pixel bubble buttons (hover lift, press squash)
      const rr = { x, y: b.y, w: 22, h: 22 };
      const hov = ui.hover(rr);
      drawAeroButton(ctx, rr.x, rr.y, rr.w, rr.h, { tone: o.tone, icon: o.icon(), bubble: true, state: hov ? (ui.inp.down ? 'down' : 'hover') : 'normal' });
      if (hov) ui.tip = o.tip;
      if (ui.clicked(rr)) { g.audio?.play?.('ui_click'); o.act(); }
      x += 27;
    }
  }

  // ---------------------------------------------------------------- right column
  drawColumn(ctx, ui, c, dt) {
    drawAeroSurface(ctx, c.x, c.y, c.w, c.h, { tone: 'frost', a: [0.94, 0.9], r: 7, gloss: 0.25, glossH: 10, curve: 2, rim: 0.9, glow: 0.3, depth: 1, block: 4, seed: 261 });
    const P = 6, x = c.x + P, w = c.w - P * 2;
    const chipsH = this.drawChips(ctx, ui, { x, y: c.y + P, w });
    let y = c.y + P + chipsH + 5;
    // slot caption: name + owned / total
    const isBoat = this.tab === 'boat';
    const name = isBoat ? 'Boat' : WARDROBE_SLOTS.find((s) => s.id === this.tab)?.name || '';
    drawText(ctx, name, x + 2, y, { color: AERO.ink, shadow: '#ffffff' });
    if (!isBoat) {
      const list = this.items(), own = list.filter((w2) => this.owns(w2)).length;
      drawText(ctx, `${own}/${list.length}`, x + w - 2, y + 1, { font: 'small', color: AERO.inkSoft, align: 'right' });
    }
    y += 12;
    const infoH = 64, info = { x, y: c.y + c.h - P - infoH, w, h: infoH };
    const grid = { x, y, w, h: info.y - 5 - y };
    if (isBoat) { this.drawBoatGrid(ctx, ui, grid); this.drawBoatInfo(ctx, ui, info); }
    else { this.drawGrid(ctx, ui, grid, dt); this.drawInfo(ctx, ui, info); }
  }

  drawChips(ctx, ui, b) {
    const g = this.game, gap = 3, perRow = Math.ceil(TABS.length / 2);
    const cw = Math.floor((b.w - gap * (perRow - 1)) / perRow), ch = 22;
    const ox = b.x + Math.floor((b.w - (cw * perRow + gap * (perRow - 1))) / 2);
    TABS.forEach((id, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const x = ox + col * (cw + gap), y = b.y + row * (ch + gap);
      const rr = { x, y, w: cw, h: ch };
      const active = this.tab === id, hov = ui.hover(rr);
      drawAeroButton(ctx, x, y, cw, ch, { tone: active ? 'aqua' : hov ? 'white' : 'frost', state: hov && !active ? 'hover' : 'normal', radius: 5 });
      const gl = glyph(id);
      const bob = active ? Math.round(Math.sin(this.t * 4)) : 0;
      ctx.drawImage(gl, Math.round(x + (cw - gl.width) / 2), Math.round(y + (ch - gl.height) / 2) + bob - (hov && !active ? 1 : 0));
      if (this.slotHasNew(id)) { ctx.fillStyle = AERO.ink; ctx.fillRect(x + cw - 7, y + 1, 6, 6); ctx.fillStyle = '#ff5a6a'; ctx.fillRect(x + cw - 6, y + 2, 4, 4); ctx.fillStyle = '#ffd0d4'; ctx.fillRect(x + cw - 6, y + 2, 1, 1); }
      if (hov) ui.tip = id === 'boat' ? 'Boat' : WARDROBE_SLOTS.find((s) => s.id === id)?.name;
      if (ui.clicked(rr) && !active) {
        this.tab = id;
        this.selectEquipped();
        g.audio?.play?.('ui_tab', { vol: 0.6 });
      }
    });
    return ch * 2 + gap;
  }

  // ---------------------------------------------------------------- cosmetic grid
  drawGrid(ctx, ui, b, dt) {
    const g = this.game, inp = g.input, t = this.t;
    const items = this.items();
    const gap = 4, cols = Math.max(1, Math.floor((b.w + gap) / (38 + gap)));
    const cw = Math.floor((b.w - 4 - gap * (cols - 1)) / cols), chh = cw + 4;
    const ox = b.x + 1;
    const rows = Math.ceil(items.length / cols);
    const maxScroll = Math.max(0, rows * (chh + gap) - gap - b.h + 2);
    let sc = this.scroll[this.tab] || 0;
    if (ui.hover(b) && inp.wheel) sc += inp.wheel * 24;
    sc = clamp(sc, 0, maxScroll);
    this.scroll[this.tab] = sc;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x - 1, b.y - 1, b.w + 2, b.h + 2); ctx.clip();
    const base = this.look;
    let hovItem = null;
    items.forEach((it, i) => {
      const x = ox + (i % cols) * (cw + gap), y = b.y + 1 + Math.floor(i / cols) * (chh + gap) - sc;
      if (y + chh < b.y || y > b.y + b.h) return;
      const cell = { x, y, w: cw, h: chh };
      const hov = ui.hover(cell) && ui.hover(b) && !this.confirm;
      if (hov) hovItem = it;
      this.drawTile(ctx, it, cell, base, hov, t);
      if (hov && inp.pressed) { inp.pressed = false; this.click(it); }
    });
    ctx.restore();
    if (maxScroll > 0) {
      const th = Math.max(14, (b.h * b.h) / (b.h + maxScroll));
      const ty = b.y + (sc / maxScroll) * (b.h - th);
      ctx.fillStyle = 'rgba(12,58,82,0.15)'; ctx.fillRect(b.x + b.w - 2, b.y, 2, b.h);
      ctx.fillStyle = '#2fa8e8'; ctx.fillRect(b.x + b.w - 2, Math.round(ty), 2, Math.round(th));
    }
    if (hovItem) {
      ui.tip = hovItem.name;
      if (hovItem.id !== this.hoverId) { this.hoverId = hovItem.id; this.hoverT = 0; g.audio?.play?.('ui_hover', { vol: 0.35 }); }
      this.hoverT = (this.hoverT || 0) + dt;
      if (this.hoverT > 0.6) this.seen(hovItem);
    } else this.hoverId = null;
  }

  click(it) {
    const g = this.game;
    this.sel = it.id;
    this.seen(it);
    if (this.owns(it)) this.equip(it);
    else { g.audio?.play?.('ui_click'); g.audio?.play?.(SLOT_SOUND[it.slot] || 'boing', { vol: 0.35, pitch: 1.3 }); }
  }

  drawTile(ctx, it, c, base, hov, t) {
    const own = this.owns(it), worn = isEquipped(base, it), sel = this.sel === it.id, gp = gemPriceOf(it);
    const R = RARITY[it.rarity] || RARITY.common;
    const lift = hov ? -1 : 0;
    drawAeroButton(ctx, c.x, c.y, c.w, c.h, { tone: sel ? 'sky' : worn ? 'white' : 'frost', state: hov ? 'hover' : 'normal', radius: 5 });
    // rarity band along the bottom
    ctx.fillStyle = it.rarity === 'common' ? '#b8c6d4' : R.color;
    ctx.fillRect(c.x + 4, c.y + c.h - 5 + lift, c.w - 8, 2);
    if (it.rarity === 'legendary' || it.rarity === 'epic') drawSparkle(ctx, c.x + c.w - 7, c.y + c.h - 10 + lift, 1, 0.6 + 0.4 * Math.sin(t * 4 + c.x), it.rarity === 'legendary' ? '#fff2a0' : '#ffe0ff');
    const cx = c.x + c.w / 2;
    const a0 = ctx.globalAlpha;
    if (!own) ctx.globalAlpha = a0 * 0.6;
    if (it.slot === 'tint') this.drawSwatch(ctx, it, cx, c.y + c.h / 2 - 1 + lift, Math.round(c.w * 0.3), t);
    else {
      const sz = this.tsz[it.slot] ?? THUMB[it.slot] ?? 0.6;
      let pv = itemPreview(base, it, sz);
      if (pv && (pv.w > c.w - 6 || pv.h > c.h - 10) && sz > 0.25) {
        // too big for the tile: shrink this slot's thumbnails (rebuilt at the new size)
        this.tsz[it.slot] = Math.max(0.25, Math.floor(sz * Math.min((c.w - 6) / pv.w, (c.h - 10) / pv.h) * 20) / 20);
        pv = null;
      }
      if (pv) {
        const by = c.y + c.h - 7 + lift - (pv.h < c.h - 16 ? Math.round((c.h - 12 - pv.h) / 2) : 0);
        drawItemPreview(ctx, pv, cx, by, t + c.x * 0.01, 'wd:' + it.id);
      } else drawGlossOrb(ctx, cx, c.y + c.h / 2, 7, '#bfeaff', t);
      if (it.value === 'none') { ctx.globalAlpha = a0 * 0.8; ctx.drawImage(glyph(it.slot === 'trail' || it.slot === 'emote' ? 'trail' : it.slot), Math.round(cx - 10), Math.round(c.y + c.h / 2 - 9)); ctx.fillStyle = '#ff5a6a'; for (let k2 = -8; k2 <= 8; k2 += 1) ctx.fillRect(Math.round(cx + k2), Math.round(c.y + c.h / 2 - 1 + k2 * 0.5), 2, 2); }
    }
    ctx.globalAlpha = a0;
    // states: equipped check, NEW tag, price (Aero or gems), padlock
    if (worn) checkBadge(ctx, c.x + c.w - 12, c.y + 2 + lift);
    else if (this.isNew(it)) {
      pixelBubbleTag(ctx, c.x + c.w - 2, c.y + 2 + lift - ((this.t * 2) % 1 < 0.5 ? 0 : 1), 'NEW', { align: 'right' }); // [bubble34]
    }
    if (!own) {
      if (gp != null) {
        const gi = gemIcon();
        ctx.drawImage(gi, c.x + 3, c.y + 3 + lift);
        drawText(ctx, String(gp), c.x + 4 + gi.width, c.y + 4 + lift, { font: 'small', color: '#5a2ab8', shadow: '#ffffff' });
      } else if (it.price != null) {
        drawAeroCoin(ctx, c.x + 7, c.y + 7 + lift, 3.5, t);
        drawText(ctx, it.price >= 1000 ? (it.price / 1000).toFixed(it.price % 1000 ? 1 : 0) + 'k' : String(it.price), c.x + 12, c.y + 4 + lift, { font: 'small', color: AERO.ink, shadow: '#ffffff' });
      } else {
        const lk = getUiIcon('lock');
        if (lk) ctx.drawImage(lk, Math.round(c.x + 3), Math.round(c.y + 3 + lift));
      }
    }
  }

  // bubble tints as glossy colour swatches (authored at 2x, crisp on the full-res UI layer)
  drawSwatch(ctx, it, cx, cy, r, t) {
    const T = TINTS[it.value] || TINTS.aqua;
    const c = aeroCached(`wd26sw|${it.value}|${r}`, () => {
      const S = 2, d = r * 2 + 2, D = d * S, cv = makeCanvas(D, D), g = ctxOf(cv);
      const C = D / 2, RR = r * S;
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const dx = x + 0.5 - C, dy = y + 0.5 - C, dd = Math.hypot(dx, dy) / RR;
        if (dd > 1) continue;
        let col;
        if (dd > 1 - 2 / RR) col = AERO.ink;
        else {
          const k = (dy / RR + 1) / 2;
          col = mix(mix(T.tint, '#ffffff', 0.35), T.deep, Math.min(1, k * 0.85 + dd * 0.2));
          if (T.special === 'stars' && (x * 7 + y * 13) % 23 === 0) col = '#ffffff';
          if (T.special === 'globe' && Math.sin(x * 0.35) + Math.cos(y * 0.4) > 1.1) col = mix(col, '#2a7ad8', 0.6);
          if (T.special === 'aurora') col = mix(col, ['#7affc0', '#7ad0ff', '#d07aff'][Math.floor((x + y * 0.5) / (D / 3)) % 3], 0.35);
          if (T.span > 300) col = mix(col, ['#ff7ad0', '#7affd0', '#ffe07a', '#7a9aff'][Math.floor(((Math.atan2(dy, dx) + Math.PI) / TAU) * 4) % 4], 0.3);
          if (T.special === 'chrome' || T.special === 'gold') col = mix(col, k < 0.45 ? '#ffffff' : T.deep, Math.abs(k - 0.45) * 0.8);
          const hx = dx / RR + 0.38, hy = dy / RR + 0.42;
          if (hx * hx * 2.2 + hy * hy * 5 < 0.07) col = '#ffffff';
          else if (dd > 0.78 && dy > 0) col = mix(col, '#ffffff', 0.25);
        }
        g.fillStyle = col; g.fillRect(x, y, 1, 1);
      }
      const lo = makeCanvas(d, d), lg = lo.getContext('2d');
      lg.imageSmoothingEnabled = true; lg.drawImage(cv, 0, 0, d, d);
      Object.defineProperty(lo, 'hi', { value: cv, configurable: true });
      return lo;
    });
    ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
    if (T.irid > 0.6) drawSparkle(ctx, Math.round(cx + r * 0.45), Math.round(cy - r * 0.5), 1, 0.5 + 0.5 * Math.sin(t * 3 + r), '#ffffff');
  }

  drawInfo(ctx, ui, b) {
    const g = this.game, st = g.state;
    drawAeroSurface(ctx, b.x, b.y, b.w, b.h, { tone: 'white', r: 6, gloss: 0.3, glossH: 10, curve: 2, rim: 0.9, glow: 0.3, depth: 1, block: 4, seed: 262 });
    const it = this.selItem();
    if (!it) return;
    const R = RARITY[it.rarity] || RARITY.common;
    const tag = R.name.toUpperCase(), tgw = measureText(tag, 'small') + 8;
    let name = it.name;
    while (name.length > 3 && measureText(name, 'normal') > b.w - 20 - tgw) name = name.slice(0, -2) + '.';
    drawText(ctx, name, b.x + 7, b.y + 6, { color: AERO.ink, shadow: '#ffffff' });
    const nw = measureText(name, 'normal');
    drawAeroButton(ctx, b.x + 12 + nw, b.y + 4, tgw, 11, { tone: { top: mix(R.color, '#ffffff', 0.5), mid: it.rarity === 'common' ? '#9fb0c0' : R.color, bot: R.dark, edge: shade(R.dark, -0.3), text: '#ffffff', shadow: shade(R.dark, -0.4), glow: '#ffffff', a: [1, 1] }, label: '', radius: 3 });
    drawText(ctx, tag, b.x + 12 + nw + tgw / 2, b.y + 7, { font: 'small', color: '#ffffff', shadow: shade(R.dark, -0.4), align: 'center' });
    const own = this.owns(it), worn = isEquipped(this.look, it), gp = gemPriceOf(it);
    const bw = 82, bh = 20, bx = b.x + b.w - bw - 6, by = b.y + b.h - bh - 7;
    const lines = wrapText(it.desc || '', b.w - 14, 'small').slice(0, 2);
    lines.forEach((ln, i) => {
      const lw = i === 1 ? bx - b.x - 12 : b.w - 14;
      let l2 = ln;
      while (l2.length > 2 && measureText(l2, 'small') > lw) l2 = l2.slice(0, -2) + '.';
      drawText(ctx, l2, b.x + 7, b.y + 20 + i * 9, { font: 'small', color: AERO.inkSoft });
    });
    const rr = { x: bx, y: by, w: bw, h: bh };
    const hov = ui.hover(rr) && !this.confirm;
    if (own) {
      const canOff = worn && NONE_FIRST.has(it.slot) && it.value !== 'none';
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'green', label: worn ? (canOff ? 'Take off' : 'Wearing') : 'Wear', icon: worn && !canOff ? getUiIcon('check') : null, state: worn && !canOff ? 'disabled' : hov ? 'hover' : 'normal', radius: 6 });
      if ((!worn || canOff) && ui.clicked(rr)) this.equip(it);
    } else if (gp != null) {
      const afford = canSpendGems(st, gp);
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'purple', label: '', state: afford ? (hov ? 'hover' : 'normal') : 'disabled', radius: 6 });
      const gi = gemIcon(), txt = String(gp), tw = measureText(txt, 'normal');
      const x0 = Math.round(bx + (bw - gi.width - 3 - tw) / 2), up = hov && afford ? 1 : 0;
      ctx.drawImage(gi, x0, Math.round(by + bh / 2 - gi.height / 2) - up);
      drawText(ctx, txt, x0 + gi.width + 3, by + 6 - up, { color: '#ffffff', shadow: afford ? '#341670' : '#5a6a7c' });
      drawText(ctx, it.unlock === 'package' ? 'PREMIUM - OR CRATES' : 'PREMIUM', b.x + 7, by + 7, { font: 'small', color: '#7a4ad8' });
      if (hov) ui.tip = afford ? `Buy for ${gp} ${GEM_NAME}` : `Need ${gp - gems(st)} more ${GEM_NAME} (earn them from quests)`;
      if (ui.clicked(rr)) this.askGems({ item: it, price: gp });
    } else if (it.price != null) {
      const afford = (st.coins | 0) >= it.price;
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'orange', label: '', state: afford ? (hov ? 'hover' : 'normal') : 'disabled', radius: 6 });
      const txt = fmtAero(it.price), tw = measureText(txt, 'normal'), x0 = Math.round(bx + (bw - 12 - tw) / 2), up = hov && afford ? 1 : 0;
      drawAeroCoin(ctx, x0 + 4, by + 10 - up, 4.5, this.t);
      drawText(ctx, txt, x0 + 12, by + 6 - up, { color: '#ffffff', shadow: afford ? '#843a04' : '#5a6a7c' });
      if (hov) ui.tip = afford ? `Buy for ${fmtAero(it.price)} ${CURRENCY}` : `Need ${fmtAero(it.price - (st.coins | 0))} more ${CURRENCY}`;
      if (ui.clicked(rr)) { if (afford) this.buy(it); else { g.audio?.play?.('ui_error'); this.say(pick(SAY.broke)); this.shakeT = 0.4; } }
    } else {
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'grey', label: it.unlock === 'skill' ? 'Lab' : 'Crates', icon: getUiIcon('lock'), state: 'normal', radius: 6 });
      if (hov) ui.tip = it.unlock === 'skill' ? 'Unlock it in The Lab' : 'Fish up floating crates to find it';
      if (ui.clicked(rr)) g.audio?.play?.('ui_error');
    }
  }

  // ---------------------------------------------------------------- gem purchase confirmation
  drawConfirm(ctx, ui, r, dt) {
    const g = this.game, c = this.confirm, st = g.state;
    c.t += dt;
    const k = Math.min(1, c.t * 5);
    ctx.fillStyle = rgba('#04203e', 0.42 * k);
    ctx.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
    const w = 236, h = 100, x = Math.round(r.x + (r.w - w) / 2), y = Math.round(r.y + (r.h - h) / 2 + (1 - (ease.outBack ? ease.outBack(k) : k)) * 10);
    const box = { x, y, w, h };
    drawAeroSurface(ctx, x, y, w, h, { tone: 'frost', r: 8, gloss: 0.4, glossH: 14, curve: 2, rim: 0.9, glow: 0.4, depth: 2, block: 4, seed: 263 });
    const name = c.item ? c.item.name : c.part.name;
    drawText(ctx, 'Buy with ' + GEM_NAME + '?', x + w / 2, y + 8, { color: AERO.ink, shadow: '#ffffff', align: 'center' });
    // item tile + name + price
    const tile = { x: x + 12, y: y + 22, w: 40, h: 42 };
    if (c.item) this.drawTile(ctx, c.item, tile, this.look, false, this.t);
    else { drawAeroButton(ctx, tile.x, tile.y, tile.w, tile.h, { tone: 'frost', radius: 5 }); this.drawPartIcon(ctx, c.slot, c.part, tile.x + tile.w / 2, tile.y + tile.h / 2); }
    drawText(ctx, name, x + 60, y + 28, { color: AERO.ink, shadow: '#ffffff' });
    const gi = gemIcon();
    ctx.drawImage(gi, x + 60, y + 42);
    drawText(ctx, `${c.price}   YOU HAVE ${gems(st)}`, x + 63 + gi.width, y + 43, { font: 'small', color: '#5a2ab8' });
    const bw = 92, bh = 20, by = y + h - bh - 9;
    const yes = { x: x + w / 2 - bw - 4, y: by, w: bw, h: bh }, no = { x: x + w / 2 + 4, y: by, w: bw, h: bh };
    const hy = ui.hover(yes), hn = ui.hover(no);
    drawAeroButton(ctx, yes.x, yes.y, bw, bh, { tone: 'purple', label: 'Buy', state: hy ? 'hover' : 'normal', radius: 6 });
    drawAeroButton(ctx, no.x, no.y, bw, bh, { tone: 'white', label: 'Cancel', state: hn ? 'hover' : 'normal', radius: 6 });
    if (c.t < 0.15) { g.input.pressed = false; return; } // ignore the click that opened it
    if (ui.clicked(yes)) { this.confirm = null; this.buyWithGems(c); }
    else if (ui.clicked(no) || (g.input.pressed && !ui.hover(box) && ui.hover(r))) { g.input.pressed = false; this.confirm = null; g.audio?.play?.('ui_close', { vol: 0.5 }); }
    else if (g.input.pressed && ui.hover(box)) g.input.pressed = false;
  }

  drawPop3(ctx, s, dt) {
    const p = this.pop3;
    if (!p) return;
    p.t += dt;
    if (p.t > 1.8) { this.pop3 = null; return; }
    const a = this.headA || [s.x + s.w / 2, s.y + s.h / 2];
    drawPop3D(ctx, p.text, clamp(a[0], s.x + 90, s.x + s.w - 90), Math.max(s.y + 30, a[1] - 46) - p.t * 6, { t: p.t, pop: Math.min(1, p.t * 3), palette: 'gold', scale: 1.6, alpha: Math.min(1, (1.8 - p.t) * 3), glow: false });
  }

  // ---------------------------------------------------------------- boat tab
  drawBoatStage(ctx, s, fx, fy) {
    const st = this.game.state, b = st.boat || { tier: 0, parts: {} };
    const tier = clamp(b.tier | 0, 0, BOAT_TIERS.length - 1);
    const hovPart = this.hoverPart;
    const parts = hovPart ? { ...b.parts, [hovPart.slot]: hovPart.id } : b.parts;
    const base = renderBoatPreview(tier, null, { scale: 1 });
    const scale = clamp(Math.floor(((s.w * 0.62) / base.canvas.width) * 4) / 4, 0.5, 2);
    const pv = renderBoatPreview(tier, parts, { scale });
    const fit = Math.min(1, (s.w - 24) / pv.canvas.width);
    const bob = Math.sin(this.t * 1.6) * 1.5;
    // the boat rests on the turntable (its keel on the top)
    const below = (pv.canvas.height - pv.py) * fit;
    ctx.save();
    ctx.translate(Math.round(fx), Math.round(fy - below + 2 + bob));
    if (fit < 1) ctx.scale(fit, fit);
    ctx.drawImage(pv.canvas, -pv.px, -pv.py);
    if (pv.stand) drawCharacter(ctx, pv.stand[0], pv.stand[1], { pose: 'idle', t: this.t, facing: 1, scale: 0.62 * pv.vs / 2, look: this.look, id: 'wardrobe-boat', shadow: true, trail: false });
    pv.drawFront(ctx, 0, 0, this.t, 1);
    ctx.restore();
    this.anchor = { x: fx, y: fy - 40 };
    this.headA = [fx, fy - pv.canvas.height * fit * 0.8];
  }

  drawBoatGrid(ctx, ui, b) {
    const g = this.game, inp = g.input;
    const bs = this.boatState();
    // tier strip
    const th = 26, gap = 2, tw = Math.floor((b.w - gap * (BOAT_TIERS.length - 1)) / BOAT_TIERS.length);
    BOAT_TIERS.forEach((T, i) => {
      const r = { x: b.x + i * (tw + gap), y: b.y, w: tw, h: th };
      const own = this.tierOwned(i), cur = (bs.tier | 0) === i, hov = ui.hover(r) && !this.confirm;
      drawAeroButton(ctx, r.x, r.y, r.w, r.h, { tone: cur ? 'aqua' : own ? 'white' : 'grey', state: hov && own ? 'hover' : 'normal', radius: 5 });
      const mini = renderBoatPreview(i, bs.parts, { scale: 0.25 });
      const k = Math.min(1, (r.w - 4) / mini.canvas.width, (r.h - 4) / mini.canvas.height);
      const mw = Math.round(mini.canvas.width * k), mh = Math.round(mini.canvas.height * k);
      const a0 = ctx.globalAlpha;
      if (!own) ctx.globalAlpha = a0 * 0.4;
      ctx.drawImage(mini.canvas, Math.round(r.x + (r.w - mw) / 2), Math.round(r.y + r.h - 3 - mh), mw, mh);
      ctx.globalAlpha = a0;
      if (!own) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, r.x + 2, r.y + 2); }
      if (hov) ui.tip = own ? T.name : `${T.name} (unlock in The Lab)`;
      if (own && !cur && ui.clicked(r)) { bs.maxTier = Math.max(bs.maxTier ?? bs.tier ?? 0, bs.tier | 0); bs.tier = i; g.audio?.play?.('splash_small'); this.changed(); }
    });
    // part slot pills
    const py = b.y + th + 4, pg = 2, pw = Math.floor((b.w - pg * (BOAT_PART_SLOTS.length - 1)) / BOAT_PART_SLOTS.length);
    BOAT_PART_SLOTS.forEach((S, i) => {
      const r = { x: b.x + i * (pw + pg), y: py, w: pw, h: 16 };
      const act = this.boatSlot === S.id, hov = ui.hover(r);
      drawAeroButton(ctx, r.x, r.y, r.w, r.h, { tone: act ? 'green' : 'frost', state: hov && !act ? 'hover' : 'normal', label: S.name, font: 'small', fixedFont: true, radius: 5 });
      if (!act && ui.clicked(r)) { this.boatSlot = S.id; this.selPartLock = null; g.audio?.play?.('ui_tab', { vol: 0.6 }); }
    });
    const gy = py + 20, gh = b.y + b.h - gy;
    const list = BOAT_PARTS[this.boatSlot];
    const parts = resolveParts(bs.tier | 0, bs.parts);
    const gp = 4, cols = Math.max(1, Math.floor((b.w + gp) / (38 + gp))), cw = Math.floor((b.w - 4 - gp * (cols - 1)) / cols), chh = 38;
    this.hoverPart = null;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x - 1, gy - 1, b.w + 2, gh + 2); ctx.clip();
    list.forEach((p, i) => {
      const x = b.x + 1 + (i % cols) * (cw + gp), y = gy + 1 + Math.floor(i / cols) * (chh + gp);
      if (y + chh > gy + gh + 1) return;
      const r = { x, y, w: cw, h: chh };
      const gpr = gemPriceOf(`boatpart:${this.boatSlot}:${p.id}`);
      const hov = ui.hover(r) && !this.confirm, own = this.partOwned(this.boatSlot, p), worn = parts[this.boatSlot] === p.id, sel = this.selPartLock === p;
      const R = RARITY[p.rarity] || RARITY.common;
      drawAeroButton(ctx, x, y, cw, chh, { tone: sel ? 'sky' : worn ? 'white' : 'frost', state: hov ? 'hover' : 'normal', radius: 5 });
      ctx.fillStyle = p.rarity === 'common' ? '#b8c6d4' : R.color; ctx.fillRect(x + 4, y + chh - 5, cw - 8, 2);
      const a0 = ctx.globalAlpha;
      if (!own) ctx.globalAlpha = a0 * 0.55;
      this.drawPartIcon(ctx, this.boatSlot, p, x + cw / 2, y + chh / 2 - 1);
      ctx.globalAlpha = a0;
      if (worn) checkBadge(ctx, x + cw - 12, y + 2);
      else if (!own) {
        if (gpr != null) { const gi = gemIcon(); ctx.drawImage(gi, x + 3, y + 3); drawText(ctx, String(gpr), x + 4 + gi.width, y + 4, { font: 'small', color: '#5a2ab8', shadow: '#ffffff' }); }
        else { const pr = PART_PRICE[p.rarity]; if (pr != null) { drawAeroCoin(ctx, x + 7, y + 7, 3.5, this.t); drawText(ctx, String(pr), x + 12, y + 4, { font: 'small', color: AERO.ink, shadow: '#ffffff' }); } else { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, x + 3, y + 3); } }
      }
      if (hov) { ui.tip = p.name; this.hoverPart = { slot: this.boatSlot, id: p.id }; }
      if (hov && inp.pressed) {
        inp.pressed = false;
        this.selPartLock = p;
        if (own) this.equipPart(this.boatSlot, p);
        else g.audio?.play?.('ui_click');
      }
    });
    ctx.restore();
  }

  drawPartIcon(ctx, slot, p, cx, cy) {
    const t = this.t;
    if (slot === 'hull') { drawGlossOrb(ctx, cx, cy, 11, p.color, t); ctx.fillStyle = p.trim; ctx.fillRect(Math.round(cx - 8), Math.round(cy + 5), 16, 2); return; }
    if (slot === 'sail') {
      const cols = { none: null, white: ['#ffffff', '#ffffff'], stripe: ['#2fd3e8', '#ffffff'], leaf: ['#9be84a', '#4cb82e'], bubble: ['#bff4ff', '#8ee4ff'], rainbow: ['#ff5a6a', '#ffe24a'], solar: ['#1a3a7a', '#6a9ae8'] }[p.id];
      ctx.fillStyle = '#9fb4c8'; ctx.fillRect(Math.round(cx + 6), Math.round(cy - 12), 2, 24);
      if (!cols) { ctx.fillStyle = '#ff5a6a'; for (let k = -7; k <= 7; k++) ctx.fillRect(Math.round(cx + k - 2), Math.round(cy + k), 2, 2); return; }
      for (let y = 0; y < 20; y++) {
        const w = Math.round((1 - y / 20) * 14 * (p.id === 'leaf' ? 0.6 + 0.6 * Math.sin((y / 20) * Math.PI) : 1));
        for (let x = 0; x < w; x++) {
          ctx.fillStyle = p.id === 'rainbow' ? ['#ff5a6a', '#ffb02a', '#ffe24a', '#5cd84a', '#3fa8ff'][Math.floor((x / 14) * 5)] : p.id === 'stripe' ? (Math.floor(y / 3) % 2 ? cols[0] : cols[1]) : p.id === 'solar' ? (x % 4 === 0 || y % 3 === 0 ? cols[1] : cols[0]) : (x + y) % 5 === 0 ? cols[1] : cols[0];
          ctx.fillRect(Math.round(cx + 5 - x), Math.round(cy + 9 - y), 1, 1);
        }
      }
      return;
    }
    if (slot === 'flag') {
      const pv = renderBoatPreview(0, { flag: p.id }, { scale: 1 });
      const f = pv.flag;
      ctx.fillStyle = '#9fb4c8'; ctx.fillRect(Math.round(cx - f.width / 2) - 2, Math.round(cy - f.height / 2) - 2, 2, f.height + 10);
      ctx.drawImage(f, Math.round(cx - f.width / 2), Math.round(cy - f.height / 2) - 2);
      return;
    }
    if (slot === 'engine') {
      const ic = { none: null, outboard: 'gear', turbine: 'cloud', solar: 'sun', bubble: 'bubble', paddle: 'reel' }[p.id];
      drawGlossOrb(ctx, cx, cy, 10, p.id === 'solar' ? '#ffd23a' : p.id === 'turbine' ? '#ffffff' : '#59c3ff', t);
      if (p.id === 'turbine') { ctx.fillStyle = AERO.ink; for (let i = 0; i < 3; i++) { const a = t * 5 + (i / 3) * TAU; for (let k = 2; k < 8; k++) ctx.fillRect(Math.round(cx + Math.cos(a) * k), Math.round(cy + Math.sin(a) * k), 2, 2); } return; }
      const icn = ic && getUiIcon(ic);
      if (icn) ctx.drawImage(icn, Math.round(cx - icn.width / 2), Math.round(cy - icn.height / 2));
      else if (!ic) { ctx.fillStyle = '#ff5a6a'; for (let k = -5; k <= 5; k++) ctx.fillRect(Math.round(cx + k), Math.round(cy + k), 2, 2); }
      return;
    }
    if (slot === 'decal') {
      const w = 32, h = 12, x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = '#2fb8e8'; ctx.fillRect(x0, y0 + h - 3, w, 3);
      ctx.fillStyle = AERO.edge; ctx.fillRect(x0, y0 + h, w, 1);
      for (let x = 0; x < w; x++) for (let y = 0; y < h - 3; y++) {
        let c = null;
        if (p.id === 'swoosh' && Math.abs(y - (h - 5) * (1 - (x / w) ** 2)) < 1.2) c = '#2fd3e8';
        if (p.id === 'wave' && Math.abs(y - 4 - Math.sin(x * 0.5) * 2) < 0.8) c = '#2fb8e8';
        if (p.id === 'stripes' && (y === 2 || y === 5)) c = y === 2 ? '#2fd3e8' : '#8be04a';
        if (p.id === 'leaves' && ((x % 10) - 5) ** 2 / 9 + (y - 4) ** 2 / 2 < 1) c = x % 20 < 10 ? '#4cb82e' : '#9be84a';
        if (p.id === 'bubbles' && Math.abs(Math.hypot((x % 8) - 4, y - 4) - 2.5) < 0.6) c = '#59c3ff';
        if (p.id === 'dolphin' && Math.abs(y - 4 + Math.sin(x * 0.3) * 2) < 1.2 && x > 6 && x < 26) c = '#59c3ff';
        if (c) { ctx.fillStyle = c; ctx.fillRect(x0 + x, y0 + y, 1, 1); }
      }
    }
  }

  drawBoatInfo(ctx, ui, b) {
    const g = this.game, st = g.state;
    drawAeroSurface(ctx, b.x, b.y, b.w, b.h, { tone: 'white', r: 6, gloss: 0.3, glossH: 10, curve: 2, rim: 0.9, glow: 0.3, depth: 1, block: 4, seed: 262 });
    const bs = this.boatState();
    const T = BOAT_TIERS[bs.tier | 0];
    const p = this.selPartLock || null;
    drawText(ctx, p ? p.name : T.name, b.x + 7, b.y + 6, { color: AERO.ink, shadow: '#ffffff' });
    const sub = p ? (BOAT_PART_SLOTS.find((s) => s.id === this.boatSlot)?.name || '') + ' for your ' + T.name : T.desc || '';
    wrapText(sub, b.w - 14, 'small').slice(0, 2).forEach((ln, i) => drawText(ctx, ln, b.x + 7, b.y + 20 + i * 9, { font: 'small', color: AERO.inkSoft }));
    if (!p) return;
    const own = this.partOwned(this.boatSlot, p), worn = resolveParts(bs.tier | 0, bs.parts)[this.boatSlot] === p.id;
    const bw = 82, bh = 20, bx = b.x + b.w - bw - 6, by = b.y + b.h - bh - 7, rr = { x: bx, y: by, w: bw, h: bh };
    const hov = ui.hover(rr) && !this.confirm, gpr = gemPriceOf(`boatpart:${this.boatSlot}:${p.id}`);
    if (own) {
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'green', label: worn ? 'Fitted' : 'Fit', state: worn ? 'disabled' : hov ? 'hover' : 'normal', radius: 6 });
      if (!worn && ui.clicked(rr)) this.equipPart(this.boatSlot, p);
    } else if (gpr != null) {
      const afford = canSpendGems(st, gpr);
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'purple', label: '', state: afford ? (hov ? 'hover' : 'normal') : 'disabled', radius: 6 });
      const gi = gemIcon(), txt = String(gpr), tw = measureText(txt, 'normal'), x0 = Math.round(bx + (bw - gi.width - 3 - tw) / 2);
      ctx.drawImage(gi, x0, Math.round(by + bh / 2 - gi.height / 2));
      drawText(ctx, txt, x0 + gi.width + 3, by + 6, { color: '#ffffff', shadow: afford ? '#341670' : '#5a6a7c' });
      drawText(ctx, 'PREMIUM', b.x + 7, by + 7, { font: 'small', color: '#7a4ad8' });
      if (hov) ui.tip = afford ? `Buy for ${gpr} ${GEM_NAME}` : `Need ${gpr - gems(st)} more ${GEM_NAME} (earn them from quests)`;
      if (ui.clicked(rr)) this.askGems({ slot: this.boatSlot, part: p, price: gpr });
    } else {
      const pr = PART_PRICE[p.rarity];
      if (pr == null) { drawAeroButton(ctx, bx, by, bw, bh, { tone: 'grey', label: 'Crates', icon: getUiIcon('lock'), radius: 6 }); return; }
      const afford = (st.coins | 0) >= pr;
      drawAeroButton(ctx, bx, by, bw, bh, { tone: 'orange', label: '', state: afford ? (hov ? 'hover' : 'normal') : 'disabled', radius: 6 });
      const txt = fmtAero(pr), tw = measureText(txt, 'normal'), x0 = Math.round(bx + (bw - 12 - tw) / 2);
      drawAeroCoin(ctx, x0 + 4, by + 10, 4.5, this.t);
      drawText(ctx, txt, x0 + 12, by + 6, { color: '#ffffff', shadow: afford ? '#843a04' : '#5a6a7c' });
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
