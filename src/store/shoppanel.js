// The Bait Shop panel (id 'baitshop', phase 4, Shell agent): Dot's glossy Aero bait shop. A striped awning over
// glass shelves of bait bubbles (Classics and Flavours), Dot the orb robot at the counter with a speech bubble,
// a detail card with stats and a big Buy button. Stock restocks on a timer (src/store/shop.js); better grades,
// faster restocks and discounts are researched in The Lab (shop levels, src/store/isp.js).
//
//   ui.open('baitshop', {tab: 'bait'|'lines', select: offerId | lineId, highlight: offerId | lineId})
//   panel.offerRect(id) -> screen rect of an offer / line on the shelf (tutorial pointers), panel.buyRect

import { clamp, TAU, ease } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon } from '../gfx/bigicons.js';
import { drawNPC } from '../gfx/npcs.js';
import {
  AERO, CURRENCY, fmtAero, aeroCached, aeroSurface, drawAeroFrame, drawAeroCard, drawAeroCoin, drawAeroGlow, drawSparkle,
  drawAeroBubble, drawAeroBar, drawGlossOrb, drawAeroLeaf, drawFocusBrackets } from '../ui/aero.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawBaitGloss } from '../fishing/baitart.js';
import { statBar, tag, rrect, burst } from './aerokit.js';
import { TIERS, CATALOG_BY_ID, APP_DEF, formatShortTime } from './catalog.js';
import { getMiniIcon } from '../desktop/icons.js';
import { SHOP_LEVELS } from './isp.js';
import { installStore } from './shop.js';
import { countOf } from './bait.js';
import { SPECIES } from '../fish/species.js';

const INK = AERO.ink, INK_SOFT = AERO.inkSoft;
const STATS = [
  ['attract', 'LURE', (d) => ((d.attract ?? 1) - 0.8) / 1.6, '#2fc0e8'],
  ['rarity', 'RARE', (d) => ((d.rarity ?? 1) - 1) / 1.2, '#b06aff'],
  ['size', 'SIZE', (d) => ((d.size ?? 0) + 0.05) / 0.35, '#5cc832'],
  ['giant', 'GIANT', (d) => ((d.giant ?? 1) - 1) / 3, '#ff9d2e'],
];
const LIKES = {
  docs: 'Paper', folder: 'Folders', calc: 'Maths', calendar: 'Dates', music: 'Music', image: 'Pictures', video: 'Video', paint: 'Paint',
  game: 'Games', chat: 'Chat', mail: 'Mail', browser: 'Surf', terminal: 'Code', settings: 'Gears', computer: 'Tech', trash: 'Junk',
  bread: 'Bread', worm: 'Worms', sugar: 'Sweets', chip: 'Chips', popup: 'Spam', flood: 'Flood', lantern: 'Light', golden: 'Gold', blackhole: 'Void', relic: 'Relics',
};
const GREET = ['Fresh bait, fresh fish!', 'Hooks up! What are we catching today?', 'Welcome back, angler!', 'Every fish has a favourite flavour.'];
const THANKS = ['Great pick!', 'The fish will love it!', 'Hook, line and sinker!', 'Ka-ching! Thank you!', 'Tight lines!'];
const SHELVES = [['bait', 'Classics', 'bait'], ['lines', 'Flavours', 'sparkle']];

// ---------------------------------------------------------------- cached art
// Striped Aero awning (lime + white, glossy) on a green rod, with a scalloped, outlined lower edge.
function awningTex(w) {
  const S = 14, BODY = 12, SC = 5, H = BODY + SC + 2;
  const c = makeCanvas(w, H);
  const g = ctxOf(c);
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const LIME = ['#e2ff9a', '#9ee64e', '#6cc832', '#3e9e22'], WHITE = ['#ffffff', '#ffffff', '#eaf6fc', '#c4e0ee'];
  for (let x = 0; x < w; x++) {
    const i = Math.floor(x / S), lime = i % 2 === 0;
    const P = lime ? LIME : WHITE;
    const u = ((x % S) + 0.5) / S * 2 - 1;
    const bottom = BODY + Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * SC);
    for (let y = 3; y < bottom; y++) {
      const k = (y - 3) / Math.max(1, bottom - 3);
      px(x, y, k < 0.18 ? P[0] : k < 0.5 ? P[1] : k < 0.82 ? P[2] : P[3]);
    }
    px(x, bottom, lime ? '#2a7a18' : '#7aaac6'); // scallop outline
    px(x, bottom + 1, 'rgba(10,60,100,0.18)'); // soft shadow
    if (x % S === 0) for (let y = 3; y < BODY; y++) px(x, y, 'rgba(30,90,40,0.25)');
  }
  // the rod: dark rim, glossy green bar, light lip
  g.fillStyle = '#1a5e12'; g.fillRect(0, 0, w, 1);
  g.fillStyle = '#5cc832'; g.fillRect(0, 1, w, 1);
  g.fillStyle = '#2c961c'; g.fillRect(0, 2, w, 1);
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(0, 1, w, 1);
  // gloss over the stripes
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 3, w, 2);
  return c;
}

function shelfTex(w) {
  return aeroSurface(w, 6, { top: '#ffffff', mid: '#cdeefc', bot: '#7cc4e6', edge: '#2a86c4', edgeA: 0.8, r: 3, gloss: 0.8, glossH: 3, curve: 0, rim: 0.6, glow: 0.5, a: [0.95, 0.9] });
}

// ---------------------------------------------------------------- panel
export class ShopPanel {
  constructor() {
    this.id = 'baitshop';
    this.modal = true;
    this.sound = 'box_open';
    this.tab = 'bait';
    this.sel = { bait: 'crumbs', lines: 'notes' };
    this.grade = {};
    this.scroll = { bait: 0, lines: 0 };
    this.t = 0;
    this.say = null;
    this.rects = {};
    this.buyRect = null;
    this.flash = 0;
  }

  open(data = {}) {
    const g = this.game, shop = installStore(g);
    this.t = 0;
    shop.tick();
    if (data?.tab) this.tab = data.tab === 'lines' ? 'lines' : 'bait';
    const pick = data?.select || data?.highlight;
    if (pick) {
      const line = CATALOG_BY_ID[String(pick).split(':')[0]];
      if (line) { this.tab = 'lines'; this.sel.lines = line.id; if (String(pick).includes(':')) this.grade[line.id] = Number(String(pick).split(':')[1]) | 0; }
      else { this.tab = 'bait'; this.sel.bait = pick; }
    }
    this.highlight = data?.highlight || null;
    const deal = shop.st.deal ? shop.offer(shop.st.deal) : null;
    this.talk(deal && Math.random() < 0.5 ? `Deal of the day: ${deal.name} -30%!` : GREET[Math.floor(Math.random() * GREET.length)], 'happy');
    g.emit?.('baitShopOpen');
  }

  talk(text, mood = 'happy', pose = 'talk') {
    this.say = { text, t: 0, mood, pose };
  }

  // the offer currently shown in the detail card
  current(shop) {
    if (this.tab === 'bait') return shop.offer(this.sel.bait) || shop.offer('crumbs');
    const id = this.sel.lines;
    const g = this.grade[id] ?? shop.bestGrade(id);
    return shop.offer(`${id}:${g}`);
  }

  offerRect(id) {
    const key = CATALOG_BY_ID[String(id).split(':')[0]] ? String(id).split(':')[0] : id;
    return this.rects[key] || null;
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, shop = installStore(g);
    dt = Math.max(0, dt);
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    shop.tick();
    const t = this.t;
    const W = Math.min(g.screen.W - 16, 568), H = Math.min(g.screen.H - 24, 324);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) - 6, w: W, h: H };
    this.rect = r;
    const F = drawAeroFrame(ctx, r.x, r.y, W, H, { title: 'Bait Shop', icon: getBigIcon('shop', { size: 'small' }).canvas, seed: 11 });
    if (ui.button(ctx, F.close.x, F.close.y, F.close.w, F.close.h, '', { icon: 'cross', tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    this.drawWallet(ctx, ui, F.close.x - 6, r.y + 8);

    const C = F.content;
    const leftW = 128, rightW = 152, gap = 6;
    const L = { x: C.x, y: C.y, w: leftW, h: C.h };
    const M = { x: C.x + leftW + gap, y: C.y, w: C.w - leftW - rightW - gap * 2, h: C.h };
    const R = { x: M.x + M.w + gap, y: C.y, w: rightW, h: C.h };
    this.drawCounter(ctx, ui, L, shop, dt);
    this.drawShelves(ctx, ui, M, shop);
    const o = this.drawDetail(ctx, ui, R, shop);
    F.finish();
    if (o) this.drawBuy(ctx, ui, R, shop, o); // above the frame's splash
    void st; void t;
  }

  // ---------------------------------------------------------------- header wallet
  drawWallet(ctx, ui, right, y) {
    const txt = fmtAero(this.game.ui.coinShown ?? this.game.state.coins);
    const w = measureText(txt) + 26, h = 18;
    const x = right - w;
    const bump = this.flash > 0 ? Math.round(Math.sin(this.flash * 12) * 2) : 0;
    ctx.drawImage(aeroCached(`shopwallet|${w}`, () => aeroSurface(w, h, { tone: 'frost', r: 'pill', gloss: 0.75, glossH: 8, curve: 2, rim: 0.9, glow: 0.5, glowColor: '#bfeaff', sparkle: 1 })), x, y - bump);
    drawAeroCoin(ctx, x + 10, y + 9 - bump, 6, this.t);
    drawText(ctx, txt, right - 7, y + 6 - bump, { align: 'right', color: INK, shadow: '#ffffff' });
    this.walletAt = { x: x + 10, y: y + 9 };
    if (ui.hover({ x, y, w, h })) ui.tip = CURRENCY;
  }

  // ---------------------------------------------------------------- Dot's counter
  drawCounter(ctx, ui, L, shop, dt) {
    const g = this.game, t = this.t;
    // a little sky booth: soft sky card, sun glow, bubbles
    ctx.drawImage(aeroCached(`shopbooth|${L.w}|${L.h}`, () => aeroSurface(L.w, L.h, { top: '#e8f9ff', mid: '#a8e2fa', bot: '#5cc0ee', edge: '#2a86c4', edgeA: 0.9, r: 8, gloss: 0.35, glossH: 30, curve: 3, rim: 0.9, glow: 0.6, glowColor: '#ffffff', bubbles: 5, seed: 4, a: [0.92, 0.92] })), L.x, L.y);
    drawAeroGlow(ctx, L.x + L.w / 2, L.y + 118, 52, '#ffffff', 0.45);
    // Dot's speech bubble
    const S = this.say || { text: GREET[0], t: 9, mood: 'happy' };
    S.t += dt;
    const lines = wrapText(S.text, L.w - 20).slice(0, 3);
    const bh = lines.length * 10 + 10, bw = L.w - 8;
    const bx = L.x + 4, by = L.y + 5;
    const pop = S.t < 0.25 ? ease.outBack(S.t / 0.25) : 1;
    ctx.save();
    if (pop < 1) { ctx.translate(bx + bw / 2, by + bh); ctx.scale(pop, pop); ctx.translate(-(bx + bw / 2), -(by + bh)); }
    ctx.drawImage(aeroCached(`dotsay|${bw}|${bh}`, () => aeroSurface(bw, bh, { tone: 'white', r: 7, gloss: 0.55, glossH: 7, curve: 2, rim: 0.9, glow: 0.3, edge: '#5aa8d8' })), bx, by);
    // tail pointing down at Dot
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.round(bx + bw / 2 - 5 + i), by + bh - 1 + i, 6 - i, 1);
    ctx.fillStyle = '#5aa8d8';
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.round(bx + bw / 2 + 1), by + bh - 1 + i, 1, 1);
    const shown = S.t < 0.25 ? 0 : Math.floor((S.t - 0.25) * 60);
    let left = shown;
    lines.forEach((ln, i) => {
      const part = left >= ln.length ? ln : ln.slice(0, Math.max(0, left));
      left -= ln.length;
      drawText(ctx, part, bx + bw / 2, by + 6 + i * 10, { align: 'center', color: INK });
    });
    ctx.restore();
    const talking = shown < lines.join('').length;
    // Dot on a glossy podium
    const px = L.x + L.w / 2, py = L.y + 152;
    ctx.drawImage(aeroCached('shoppodium', () => aeroSurface(72, 12, { tone: 'aqua', r: 'pill', gloss: 0.8, glossH: 5, curve: 1, rim: 0.9, glow: 0.7 })), Math.round(px - 36), py - 2);
    drawAeroLeaf(ctx, px + 30, py + 2, 16, 9, -30, { tone: 'lime' });
    drawAeroLeaf(ctx, px - 30, py + 3, 14, 8, -150, { tone: 'leaf', flip: true });
    const cheer = S.pose === 'cheer' && S.t < 1.4;
    const lookAt = g.input ? [g.input.x, g.input.y] : null;
    try {
      drawNPC(ctx, 'dot', { x: px, y: py - 2, t, scale: 1.45, facing: 1, pose: cheer ? 'cheer' : talking ? 'talk' : 'idle', talk: talking ? 0.5 + 0.5 * Math.sin(t * 22) : 0, mood: S.mood, lookAt, shadow: false });
    } catch (e) { if (!this.npcErr) { this.npcErr = true; console.error(e); } }
    if (cheer && (t * 6) % 1 < 0.2) drawSparkle(ctx, px + 22, py - 70, 3, 1);
    // shop level + restock
    const lvI = shop.levelIndex(), lv = shop.level();
    let y = L.y + 166;
    ctx.drawImage(aeroCached(`shoplv|${L.w - 12}`, () => aeroSurface(L.w - 12, 16, { tone: 'white', r: 'pill', gloss: 0.7, glossH: 7, curve: 1, rim: 0.8, glow: 0.4, a: [0.92, 0.92] })), L.x + 6, y);
    drawText(ctx, lv.name, L.x + 12, y + 5, { color: INK });
    for (let i = 1; i < SHOP_LEVELS.length; i++) drawGlossOrb(ctx, L.x + L.w - 12 - (SHOP_LEVELS.length - 1 - i) * 7, y + 8, 2.5, i <= lvI ? SHOP_LEVELS[i].color : '#c8d6e0');
    y += 21;
    const left0 = shop.restockIn();
    const k = clamp(1 - left0 / lv.restock, 0, 1);
    ctx.drawImage(getUiIcon('clock'), L.x + 7, y);
    drawAeroBar(ctx, L.x + 20, y + 1, L.w - 58, 8, k, { color: '#5cc832' });
    drawText(ctx, formatShortTime(left0), L.x + L.w - 7, y + 1, { align: 'right', font: 'small', color: INK_SOFT });
    if (ui.hover({ x: L.x, y: y - 2, w: L.w, h: 12 })) ui.tip = 'Shelves restock';
    y += 15;
    // perks of this level
    const perks = [];
    if (lv.discount > 0) perks.push([`-${Math.round(lv.discount * 100)}%`, '#ff9d2e']);
    perks.push([TIERS[lv.grade].short, TIERS[lv.grade].color]);
    let tx = L.x + 7;
    for (const [p, c] of perks) tx += tag(ctx, tx, y, p, c) + 3;
    y += 16;
    const next = shop.levelIndex() + 1 < SHOP_LEVELS.length ? SHOP_LEVELS[shop.levelIndex() + 1] : null;
    if (next) {
      drawText(ctx, 'NEXT UPGRADE', L.x + 8, y, { font: 'small', color: AERO.aquaDeep });
      wrapText(next.desc, L.w - 16).slice(0, 3).forEach((ln, i) => drawText(ctx, ln, L.x + 8, y + 9 + i * 10, { color: INK_SOFT }));
    }
    if (next) {
      if (ui.button(ctx, L.x + 6, L.y + L.h - 26, L.w - 12, 20, next.name, { icon: 'sparkle', style: 'aqua', font: 'small', tip: `${next.desc} Research it in The Lab.` })) {
        this.openLab(next.feature ? `feature:${next.feature}` : 'isp');
      }
    } else drawText(ctx, 'Top-tier shop!', L.x + L.w / 2, L.y + L.h - 19, { align: 'center', color: INK_SOFT });
  }

  openLab(key) {
    const g = this.game;
    if (!g.ui.panels.lab) return;
    g.ui.close(this.id);
    let focus = null;
    try { focus = key; } catch { focus = null; }
    g.ui.open('lab', { tab: 'tree', focus, highlight: focus });
  }

  // ---------------------------------------------------------------- shelves
  drawShelves(ctx, ui, M, shop) {
    const g = this.game, t = this.t;
    // tabs
    let tx = M.x;
    for (const [id, label, icon] of SHELVES) {
      const w = measureText(label) + 36;
      const on = this.tab === id;
      if (ui.button(ctx, tx, M.y, w, 19, label, { icon, style: on ? 'green' : 'glass', active: on, sound: 'ui_tab' }) && !on) { this.tab = id; this.highlight = null; }
      tx += w + 4;
    }
    // deal sticker next to the tabs
    const deal = shop.st.deal ? shop.offer(shop.st.deal) : null;
    if (deal && !deal.locked) {
      const dx = M.x + M.w - 22, dy = M.y + 9;
      burst(ctx, dx, dy, 11, '-30%', t, { color: '#ff8a1e' });
      if (ui.hover({ x: dx - 11, y: dy - 11, w: 22, h: 22 })) ui.tip = `Deal: ${deal.name}`;
      if (ui.clicked({ x: dx - 11, y: dy - 11, w: 22, h: 22 })) {
        if (deal.kind === 'line') { this.tab = 'lines'; this.sel.lines = deal.line; this.grade[deal.line] = deal.grade; } else { this.tab = 'bait'; this.sel.bait = deal.id; }
        g.audio.play('ui_click');
      }
    }
    // glass case
    const box = { x: M.x, y: M.y + 23, w: M.w, h: M.h - 23 };
    drawAeroCard(ctx, box.x, box.y, box.w, box.h, { tone: 'frost', inset: true, seed: 6 });
    ctx.drawImage(aeroCached(`awning|${box.w - 4}`, () => awningTex(box.w - 4)), box.x + 2, box.y + 1);
    const items = this.tab === 'bait' ? shop.classics() : shop.lines();
    const cols = 4, cw = Math.floor((box.w - 8) / cols), ch = 62;
    const top = box.y + 22, rowsVis = Math.max(1, Math.floor((box.h - 24) / ch));
    const rows = Math.ceil(items.length / cols);
    const maxScroll = Math.max(0, rows - rowsVis);
    if (ui.hover(box) && g.input.wheel) this.scroll[this.tab] = clamp(this.scroll[this.tab] + Math.sign(g.input.wheel), 0, maxScroll);
    const sc = this.scroll[this.tab] = clamp(this.scroll[this.tab], 0, maxScroll);
    this.rects = {};
    const x0 = box.x + Math.round((box.w - cols * cw) / 2);
    for (let row = 0; row < rowsVis; row++) {
      const yy = top + row * ch;
      ctx.drawImage(aeroCached(`shelf|${box.w - 12}`, () => shelfTex(box.w - 12)), box.x + 6, yy + 41);
    }
    for (let i = sc * cols; i < items.length && i < (sc + rowsVis) * cols; i++) {
      const k = i - sc * cols;
      const x = x0 + (k % cols) * cw, y = top + Math.floor(k / cols) * ch;
      const it = items[i];
      const rect = { x: x + 1, y: y - 2, w: cw - 2, h: ch - 2 };
      if (this.tab === 'bait') { this.rects[it.id] = rect; this.drawSpecialItem(ctx, ui, it, x, y, cw, rect); }
      else { this.rects[it.line.id] = rect; this.drawLineItem(ctx, ui, it, x, y, cw, rect, shop); }
    }
    if (maxScroll > 0) {
      const sh = box.h - 30, th = Math.max(12, sh * (rowsVis / rows));
      const k = sc / maxScroll;
      ctx.drawImage(aeroCached(`shopscroll|${Math.round(th)}`, () => aeroSurface(4, Math.round(th), { tone: 'aqua', r: 2, gloss: 0.6, rim: 0.4, glow: 0.3 })), box.x + box.w - 6, Math.round(box.y + 24 + (sh - th) * k));
      if (sc < maxScroll) drawText(ctx, 'v', box.x + box.w / 2, box.y + box.h - 8, { align: 'center', font: 'small', color: INK_SOFT });
    }
  }

  // one bait bubble standing on a shelf, its price tag hanging off the shelf edge
  drawItemBase(ctx, ui, o, x, y, cw, rect, sel, art, extra = {}) {
    const t = this.t;
    const hov = ui.hover(rect);
    const cx = x + Math.round(cw / 2), cy = y + 20;
    const out = o.stock <= 0, locked = !!o.locked;
    if (sel) drawAeroGlow(ctx, cx, cy, 26, '#d6ffb0', 0.75);
    else if (hov) drawAeroGlow(ctx, cx, cy, 24, '#ffffff', 0.6);
    if (this.highlight && (this.highlight === o.id || this.highlight === o.line)) {
      drawFocusBrackets(ctx, cx, cy, 20, t, { col: '#ffd65a', ink: '#7a4a06' }); // [phase8:ui] no pulsing ring
    }
    ctx.globalAlpha = locked || out ? 0.55 : 1;
    drawBaitGloss(ctx, art, cx, cy, sel || hov ? 36 : 34, t + x * 0.01, { tint: sel ? '#e2ffd0' : '#e8fbff', rim: sel ? '#4cc830' : '#2fb8e0', bob: hov || sel });
    ctx.globalAlpha = 1;
    if (sel) {
      const a = t * 2.4;
      drawSparkle(ctx, cx + Math.cos(a) * 19, cy + Math.sin(a) * 19, 2, 1);
    }
    // pack size, top-right
    const q = 'x' + o.qty, qw = measureText(q, 'small') + 6;
    ctx.drawImage(aeroCached(`packq|${qw}`, () => aeroSurface(qw, 9, { tone: 'aqua', r: 'pill', gloss: 0.8, glossH: 4, curve: 1, rim: 0.6, glow: 0.4 })), x + cw - qw - 3, y - 3);
    drawText(ctx, q, x + cw - 3 - Math.round(qw / 2), y - 1, { align: 'center', font: 'small', color: '#ffffff' });
    // price tag below the shelf
    const ty = y + 47;
    let label, tone;
    if (locked) { label = ''; tone = 'grey'; }
    else if (out) { label = 'SOLD'; tone = 'grey'; }
    else if (o.free) { label = 'FREE'; tone = 'green'; }
    else { label = String(o.price); tone = o.deal ? 'orange' : 'white'; }
    const tw = (locked ? 9 : measureText(label, 'small') + (o.free || out ? 10 : 18));
    const tagX = Math.round(cx - tw / 2);
    ctx.drawImage(aeroCached(`pricetag|${tw}|${tone}`, () => aeroSurface(tw, 11, { tone, r: 'pill', gloss: 0.8, glossH: 5, curve: 1, rim: 0.8, glow: 0.4 })), tagX, ty);
    if (locked) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, cx - Math.floor(lk.width / 2), ty + Math.round((11 - lk.height) / 2)); }
    else if (o.free || out) drawText(ctx, label, cx, ty + 3, { align: 'center', font: 'small', color: '#ffffff', shadow: rgba(INK, 0.6) });
    else {
      drawAeroCoin(ctx, tagX + 6, ty + 5, 3.5, 0);
      drawText(ctx, label, tagX + 11, ty + 3, { font: 'small', color: o.deal ? '#ffffff' : INK, shadow: o.deal ? '#843a04' : null });
    }
    // flavour badge (top-left): what kind of fish the line appeals to
    if (o.kind === 'line') {
      let mi = null;
      try { mi = getMiniIcon(APP_DEF[o.line]?.icon || 'notes'); } catch { mi = null; }
      if (mi) ctx.drawImage(mi, x + 3, y - 4, 11, 11);
    }
    if (o.deal && !locked && !out) burst(ctx, x + cw - 8, y + 30, 7, '%', t, { color: '#ff8a1e' });
    if (extra.grades) extra.grades();
    if (hov) {
      ui.tip = locked ? (o.locked.reason === 'lab' ? `${o.name}: research ${o.locked.label} in The Lab` : `${o.name}: needs the ${o.locked.label}`) : out ? `${o.name}: sold out` : o.name;
    }
    return hov;
  }

  drawSpecialItem(ctx, ui, o, x, y, cw, rect) {
    const sel = this.sel.bait === o.id;
    this.drawItemBase(ctx, ui, o, x, y, cw, rect, sel, o.def.art);
    if (ui.clicked(rect)) { this.select('bait', o.id); }
  }

  drawLineItem(ctx, ui, it, x, y, cw, rect, shop) {
    const id = it.line.id;
    const sel = this.sel.lines === id;
    const g = sel && this.grade[id] !== undefined ? this.grade[id] : shop.bestGrade(id);
    const o = it.grades[g];
    this.drawItemBase(ctx, ui, o, x, y, cw, rect, sel, o.def?.art || { shape: 'grub' }, {
      grades: () => {
        // grade pips under the bubble
        for (let i = 0; i < TIERS.length; i++) {
          const go = it.grades[i];
          drawGlossOrb(ctx, x + Math.round(cw / 2) - 10 + i * 5, y + 38, i === g ? 2.2 : 1.6, go.locked ? '#c4d2dc' : TIERS[i].color);
        }
      },
    });
    if (ui.clicked(rect)) this.select('lines', id);
  }

  select(tab, id) {
    const g = this.game;
    if (this.sel[tab] !== id) g.audio.play('bubble', { pitch: 1.1 + Math.random() * 0.15 });
    this.sel[tab] = id;
    this.highlight = this.highlight === id ? null : this.highlight;
    const o = this.current(installStore(g));
    if (o?.locked) this.talk(o.locked.reason === 'grade' ? `${TIERS[o.grade].name} needs the ${o.locked.label}. Research it in The Lab!` : `Research ${o.locked.label} in The Lab and I'll stock it!`, 'sad', 'think');
    else if (o?.stock <= 0) this.talk(`Sold out! More in ${formatShortTime(installStore(g).restockIn())}.`, 'sad', 'think');
    else if (o) this.talk(o.def?.desc || o.name, 'happy');
  }

  // ---------------------------------------------------------------- detail card
  drawDetail(ctx, ui, R, shop) {
    const g = this.game, t = this.t;
    drawAeroCard(ctx, R.x, R.y, R.w, R.h, { seed: 9 });
    const o = this.current(shop);
    if (!o) return;
    const d = o.def || {};
    // name
    const nameLines = wrapText(o.name, R.w - 12).slice(0, 2);
    nameLines.forEach((ln, i) => drawText(ctx, ln, R.x + R.w / 2, R.y + 6 + i * 10, { align: 'center', color: INK }));
    let y = R.y + 8 + nameLines.length * 10;
    // big bubble
    const cx = R.x + R.w / 2, cy = y + 28;
    drawAeroGlow(ctx, cx, cy, 34, mix(d.art?.color || '#9fe8ff', '#ffffff', 0.4), 0.5);
    ctx.globalAlpha = o.locked ? 0.6 : 1;
    drawBaitGloss(ctx, d.art, cx, cy, 52, t, { tint: '#eafcff' });
    ctx.globalAlpha = 1;
    const owned = countOf(g.state, o.bait);
    if (owned > 0) {
      const s = 'have ' + owned;
      const w = measureText(s, 'small') + 8;
      ctx.drawImage(aeroCached(`have|${w}`, () => aeroSurface(w, 10, { tone: 'green', r: 'pill', gloss: 0.8, glossH: 4, curve: 1, rim: 0.7, glow: 0.4 })), Math.round(cx + 14), cy + 16);
      drawText(ctx, s, Math.round(cx + 18), cy + 19, { font: 'small', color: '#ffffff', shadow: '#1c5a0e' });
    }
    y = cy + 31;
    // grade selector (flavour lines)
    if (o.kind === 'line') {
      const bw = Math.floor((R.w - 12) / TIERS.length);
      const lineOffers = shop.lines().find((l) => l.line.id === o.line)?.grades || [];
      for (let i = 0; i < TIERS.length; i++) {
        const go = lineOffers[i];
        const rr = { x: R.x + 6 + i * bw, y, w: bw - 2, h: 13 };
        const on = i === o.grade, hov = ui.hover(rr);
        const tone = go?.locked ? 'grey' : on ? { top: mix(TIERS[i].color, '#ffffff', 0.6), mid: TIERS[i].color, bot: shade(TIERS[i].color, -0.25), edge: shade(TIERS[i].color, -0.5), a: [1, 1], glow: '#ffffff' } : 'white';
        ctx.drawImage(aeroCached(`grade|${rr.w}|${typeof tone === 'string' ? tone : TIERS[i].id}|${hov}`, () => aeroSurface(rr.w, rr.h, { tone, r: 4, gloss: hov ? 0.9 : 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.4 })), rr.x, rr.y);
        if (go?.locked) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, rr.x + Math.round((rr.w - lk.width) / 2), rr.y + Math.round((rr.h - lk.height) / 2)); }
        else drawText(ctx, TIERS[i].short.slice(0, 4), rr.x + rr.w / 2, rr.y + 4, { align: 'center', font: 'small', color: on ? '#ffffff' : INK, shadow: on ? rgba(shade(TIERS[i].color, -0.6), 0.8) : null });
        if (hov) ui.tip = go?.locked ? `${TIERS[i].name}: ${go.locked.label} (The Lab)` : `${TIERS[i].name} grade`;
        if (ui.clicked(rr)) { this.grade[o.line] = i; g.audio.play('ui_tab'); const n = shop.offer(`${o.line}:${i}`); if (n?.locked) this.talk(`${TIERS[i].name} needs the ${n.locked.label}. Research it in The Lab!`, 'sad', 'think'); }
      }
      y += 17;
    }
    // description
    const desc = wrapText(d.desc || '', R.w - 14).slice(0, 2);
    desc.forEach((ln, i) => drawText(ctx, ln, R.x + 7, y + i * 9, { color: INK_SOFT }));
    y += Math.max(1, desc.length) * 9 + 4;
    // stats
    for (const [, label, norm, color] of STATS) {
      drawText(ctx, label, R.x + 7, y + 1, { font: 'small', color: INK_SOFT });
      statBar(ctx, R.x + 36, y, R.w - 44, 6, clamp(norm(d), 0, 1), color);
      y += 9;
    }
    y += 1;
    tag(ctx, R.x + 7, y, 'LIKES ' + (LIKES[d.effect || d.type] || d.type || '?').toUpperCase(), d.effect ? '#b06aff' : '#2fa8d8');
    // who bites: fish that love this bait (this ocean first); unseen fish stay a mystery
    y += 15;
    const fans = this.fansOf(d.effect || d.type);
    if (fans.length && y < R.y + R.h - 70) {
      drawText(ctx, 'LOVED BY', R.x + 7, y, { font: 'small', color: AERO.aquaDeep });
      y += 8;
      const fi = getUiIcon('fish');
      for (const f of fans.slice(0, Math.min(4, Math.max(1, Math.floor((R.y + R.h - 58 - y) / 10))))) {
        if (fi) { ctx.globalAlpha = f.known ? 1 : 0.5; ctx.drawImage(fi, R.x + 8, y + 1); ctx.globalAlpha = 1; }
        drawText(ctx, f.known ? f.name : '???', R.x + 20, y + 1, { color: f.known ? INK : '#8aa4b8' });
        if (f.here) drawGlossOrb(ctx, R.x + R.w - 12, y + 4, 2, '#5cc832');
        y += 10;
      }
    }
    // the pack: bait count per pack and stock left on the shelf (sits right above the Buy button)
    y = R.y + R.h - 52;
    drawAeroCard(ctx, R.x + 6, y, R.w - 12, 20, { tone: 'white', inset: true, gloss: 0 });
    const bi = getUiIcon('bait');
    if (bi) ctx.drawImage(bi, R.x + 11, y + Math.round((20 - bi.height) / 2));
    drawText(ctx, `${o.qty} per pack`, R.x + 13 + (bi ? bi.width : 0), y + 7, { color: INK });
    if (!o.locked) {
      if (o.stock > 0) for (let s2 = 0; s2 < Math.min(5, o.max); s2++) drawGlossOrb(ctx, R.x + R.w - 13 - s2 * 6, y + 10, 2.2, s2 < o.stock ? '#5cd8ff' : '#c4d2dc');
      else drawText(ctx, 'SOLD OUT', R.x + R.w - 11, y + 8, { align: 'right', font: 'small', color: '#d04040' });
      if (ui.hover({ x: R.x + R.w - 44, y, w: 38, h: 20 })) ui.tip = o.stock > 0 ? `${o.stock} of ${o.max} left until restock` : 'Restocks soon';
    }
    return o;
  }

  drawBuy(ctx, ui, R, shop, o) {
    const g = this.game, t = this.t;
    const by = R.y + R.h - 28, bw = R.w - 12, bx = R.x + 6, bh = 22;
    this.buyRect = { x: bx, y: by, w: bw, h: bh };
    if (o.locked) {
      if (ui.button(ctx, bx, by, bw, bh, 'Research', { icon: 'sparkle', style: 'aqua', tip: `${o.locked.label} - The Lab` })) {
        this.openLab(o.locked.node || (o.locked.level?.feature ? `feature:${o.locked.level.feature}` : 'isp'));
      }
      return;
    }
    if (o.stock <= 0) {
      ui.button(ctx, bx, by, bw, bh, `Restock ${formatShortTime(shop.restockIn())}`, { icon: 'clock', style: 'white', disabled: true });
      return;
    }
    const afford = (g.state.coins || 0) >= o.price;
    if (this.highlight && (this.highlight === o.id || this.highlight === o.line)) drawAeroGlow(ctx, bx + bw / 2, by + bh / 2, 40, '#fff2a0', 0.4 + 0.3 * Math.sin(t * 6));
    const tip = afford ? `${o.qty} x ${o.name}` : `Need ${fmtAero(o.price - (g.state.coins || 0))} more ${CURRENCY}`;
    if (o.free) {
      if (ui.button(ctx, bx, by, bw, bh, 'Take free', { icon: 'bait', style: 'green', sound: 'bubble', tip })) this.buy(o);
    } else {
      // "Buy" on the left, the Aero drop and the price on the right
      const clicked = ui.button(ctx, bx, by, bw, bh, '', { style: afford ? 'green' : 'orange', sound: 'bubble', tip });
      const down = ui.hover(this.buyRect) && g.input.down ? 1 : 0;
      const sh = afford ? '#1c5a0e' : '#843a04';
      drawText(ctx, 'Buy', bx + 12, by + 8 + down, { color: '#ffffff', shadow: sh });
      const pt = fmtAero(o.price), pw = measureText(pt);
      drawText(ctx, pt, bx + bw - 10 - pw, by + 8 + down, { color: '#ffffff', shadow: sh });
      drawAeroCoin(ctx, bx + bw - 18 - pw, by + 11 + down, 5, t);
      if (clicked) this.buy(o);
    }
    if (o.base > o.price && !o.free) {
      const s = String(o.base);
      const sw = measureText(s, 'small');
      drawText(ctx, s, bx + bw - 6 - sw, by - 8, { font: 'small', color: '#9aaab8' });
      ctx.fillStyle = '#d04040';
      ctx.fillRect(bx + bw - 7 - sw, by - 6, sw + 2, 1);
    }
  }

  // Species that love a bait type (interest >= 2), the current ocean first, then the strongest preference.
  fansOf(type) {
    if (!type) return [];
    const g = this.game, here = g.ocean?.biome?.id, J = g.state.journal || {};
    const key = `${type}|${here}`;
    if (this.fansKey === key && this.fansT > 0) { this.fansT -= 1; return this.fans; }
    const list = [];
    for (const sp of SPECIES) {
      const v = sp.bait?.[type] || 0;
      if (v < 2) continue;
      list.push({ id: sp.id, name: sp.name, v, here: sp.biome === here, known: !!(J[sp.id]?.caught || J[sp.id]?.seen) });
    }
    list.sort((a, b) => (b.here - a.here) || (b.v - a.v) || (b.known - a.known));
    this.fansKey = key; this.fansT = 60; this.fans = list;
    return list;
  }

  buy(o) {
    const g = this.game, shop = installStore(g);
    const res = shop.buy(o.id);
    if (res.ok) {
      this.flash = 1;
      this.talk(THANKS[Math.floor(Math.random() * THANKS.length)], 'excited', 'cheer');
      const b = this.buyRect;
      try {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        g.particles?.bubbles?.(cx, cy, 8, { layer: 'ui', life: 1 });
        g.particles?.burst?.(cx, cy, 10, { colors: ['#ffffff', '#d8ffb0', '#8ee04a', '#5cd0ff'], speed: 90, speedMin: 30, g: 200, life: 0.6, up: 60, layer: 'ui', drag: 1 });
        const rr = this.offerRect(o.kind === 'line' ? o.line : o.id);
        if (rr) g.particles?.ring?.(rr.x + rr.w / 2, rr.y + 22, 1.2, 'rgba(220,255,200,0.9)', { layer: 'ui' });
      } catch { /* particles are optional */ }
      return true;
    }
    if (res.reason === 'aero') this.talk(`That's ${fmtAero(o.price)} ${CURRENCY}. Catch a few more fish!`, 'sad', 'think');
    else if (res.reason === 'soldout') this.talk(`Sold out! More in ${formatShortTime(shop.restockIn())}.`, 'sad', 'think');
    else if (res.reason === 'locked') this.talk('Research it in The Lab first!', 'sad', 'think');
    return false;
  }
}

void drawAeroBubble;
