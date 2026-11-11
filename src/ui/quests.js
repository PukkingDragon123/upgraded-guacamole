// Quest UI (phase 6, OWNER: Lab+Quests agent): the HUD quest tracker, the "QUEST COMPLETE!" banner, the big glossy
// Quest Log (panel 'quests', key Q) and the chapter celebration / chapter intro (panel 'chapter').
//   installQuests(game) -> game.quests = {book, update(dt, inp|null), hit(x, y), drawHud(ctx, dt), open(tab?), readyCount(), rect}
//     [quests16] readyCount() also counts side stories / orders / milestones waiting for a claim; open(tab) opens the
//     Quest Log on 'story' | 'orders' | 'miles' (panel data {tab, chapter}).
//     The tracker draws in game.hud.questSlot() (top left; falls back to under the location chip) once the
//     tutorial is done. Clicking it opens the Quest Log (or a pending chapter intro).
//   registerQuestPanels(ui)  registers 'quests' and 'chapter'
//   drawPortrait(ctx, npcId, cx, cy, r, t, {mood, talk})  an NPC head in a glossy glass bubble
import { clamp, clamp01, damp, ease, TAU, hash1 } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { drawText, measureText, wrapText, lineHeight } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { alagardReady, alagardBitmap, loadAlagard } from '../gfx/alagard.js';
import * as NPC from '../gfx/npcs.js';
import * as CHAR from '../gfx/character.js';
import { aeroSurface, aeroCached, drawAeroGlow, drawAeroBubble, drawSparkle, drawAeroCoin, drawAeroBar, drawLeafSprig, drawAeroBadge, drawAeroButton, drawPixelBrackets, toneOf, AERO } from './aero.js';
import { icon, pill, iconBudget, INK, INK_SOFT, OK } from './labkit.js';
import { drawAnimIcon, drawPadlock } from './labrows.js';
import { roundRectPath } from './labart.js';
import { CHAPTERS, CHAPTER_BY_ID, QUEST_BY_ID, NPC_NAMES, QuestBook, ensureQuests, rewardList, STORY_QUESTS, MILESTONES, MILESTONE_LINES, MILESTONE_BY_LINE, ORDERS_PER_DAY } from '../game/quests.js';
import { OCEAN_NAMES } from '../game/lab.js';
import { drawPop3D } from './pop3d.js'; // [phase9:ui]
import { drawIcon3D } from '../gfx/icons3d.js'; // [phase9:ui]

const NPC_COL = { seal: '#8fdcff', fizz: '#7affc8', marina: '#ffd23a', dot: '#59e0ff', bloat: '#ffb44a' };
const CHEERS = {
  seal: ['Yay! Nice one!', 'Bubbly brilliant!', 'You\'re a natural!'],
  fizz: ['Splendid science!', 'Eureka! Well done!', 'For science!'],
  marina: ['Smooth sailing!', 'Ship shape!', 'Ahoy, champ!'],
  dot: ['BEEP BEEP! Great!', 'Transaction: AWESOME.', 'BOOP! Nice!'],
  bloat: ['Hrrumph... impressive!', 'Reminds me of my youth!', 'A tale worth telling!'],
};
const npcName = (id) => (id === 'seal' ? NPC.NPCS?.seal?.name : null) || NPC_NAMES[id] || id;

// ------------------------------------------------------------------ title text (Alagard with an outline)
function title(ctx, text, x, y, size = 16, color = '#ffffff', outline = '#0a3a6e', align = 'left') {
  if (alagardReady()) {
    const bmp = aeroCached(`qt|${text}|${size}|${color}|${outline}`, () => {
      const w0 = alagardBitmap(text, { size, color }), o = alagardBitmap(text, { size, color: outline });
      const c = document.createElement('canvas'); c.width = w0.width + 4; c.height = w0.height + 5;
      const g = c.getContext('2d');
      for (const [dx, dy] of [[0, 3], [1, 3], [2, 3], [0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) g.drawImage(o, dx, dy);
      g.drawImage(w0, 1, 1);
      return c;
    });
    const bx = align === 'center' ? x - bmp.width / 2 : align === 'right' ? x - bmp.width : x;
    ctx.drawImage(bmp, Math.round(bx), Math.round(y));
    return bmp.width;
  }
  const sc = size >= 20 ? 2 : 1;
  const w = measureText(text, 'normal', sc);
  drawText(ctx, text, Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x), Math.round(y + 2), { scale: sc, color, outline });
  return w;
}

// ------------------------------------------------------------------ NPC portraits in glass bubbles
// portrait scale per NPC (x r) and a self-correcting offset that puts the head anchor drawNPC returns at the centre
const PORTRAIT = { fizz: 0.034, marina: 0.034, dot: 0.042, bloat: 0.04 };
const PORT_OFF = new Map();
export function drawPortrait(ctx, id, cx, cy, r, t = 0, o = {}) {
  cx = Math.round(cx); cy = Math.round(cy);
  const col = NPC_COL[id] || '#bff6ff';
  drawAeroGlow(ctx, cx, cy, r * 1.5, mix(col, '#ffffff', 0.5), 0.35);
  ctx.drawImage(aeroCached(`qportbg|${r}|${col}`, () => {
    const S = r * 2 + 4, c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2 - r * 0.3, S / 2 - r * 0.4, 1, S / 2, S / 2, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, mix(col, '#ffffff', 0.55)); gr.addColorStop(1, shade(col, -0.15));
    g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, r, 0, TAU); g.fill();
    return c;
  }), cx - r - 2, cy - r - 2);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, TAU); ctx.clip();
  try {
    if (id === 'seal' && NPC.NPCS?.seal) NPC.drawNPC(ctx, 'seal', { portrait: true, x: cx, y: cy, r: r - 1, t, mood: o.mood || 'happy', talk: o.talk || 0, id: 'qp-seal' + (o.key || '') });
    else if (NPC.NPCS?.[id] && id !== 'seal') {
      const sc = Math.max(0.3, Math.round(r * (PORTRAIT[id] || 0.036) * 20) / 20);
      const key = id + '|' + r + '|' + sc;
      const off = PORT_OFF.get(key) || { dx: 0, dy: r * 1.6 };
      const a = NPC.drawNPC(ctx, id, { x: cx + off.dx, y: cy + off.dy, t, scale: sc, facing: o.facing || 1, talk: o.talk || 0, mood: o.mood || 'happy', pose: o.pose || (o.talk ? 'talk' : 'idle'), id: 'qp-' + id + (o.key || ''), shadow: false });
      const m = a?.mouth || a?.head;
      if (m && Number.isFinite(m[0])) {
        // the mouth anchor (the head anchor is the top of the head for bubble people) sits just under the centre
        off.dx += (cx - m[0]) * 0.5; off.dy += (cy + r * 0.22 - m[1]) * 0.5;
        off.dx = clamp(off.dx, -r, r); off.dy = clamp(off.dy, -r, r * 4);
        PORT_OFF.set(key, off);
      }
    } else {
      const ic = icon('people', r);
      if (ic) ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(cy - ic.height / 2));
    }
  } catch { /* the NPC art is optional */ }
  ctx.restore();
  // glass rim + gloss
  ctx.drawImage(aeroCached(`qportfg|${r}|${col}`, () => {
    const S = r * 2 + 4, c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.strokeStyle = shade(col, -0.55); g.lineWidth = 1.5; g.beginPath(); g.arc(S / 2, S / 2, r - 0.5, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1; g.beginPath(); g.arc(S / 2, S / 2, r - 2, Math.PI * 1.05, Math.PI * 1.75); g.stroke();
    const hg = g.createLinearGradient(0, S / 2 - r, 0, S / 2);
    hg.addColorStop(0, 'rgba(255,255,255,0.55)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hg; g.beginPath(); g.ellipse(S / 2 - r * 0.15, S / 2 - r * 0.5, r * 0.62, r * 0.36, -0.3, 0, TAU); g.fill();
    return c;
  }), cx - r - 2, cy - r - 2);
}

// a slim glossy progress bar on a light glass track
function miniBar(ctx, x, y, w, h, k) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w);
  ctx.fillStyle = rgba('#5a9ec4', 0.28); roundRectPath(ctx, x, y, w, h + 1, (h + 1) / 2); ctx.fill();
  const fw = Math.round(w * clamp01(k));
  if (fw >= 2) {
    ctx.fillStyle = '#4cbf2c'; roundRectPath(ctx, x, y, fw, h + 1, (h + 1) / 2); ctx.fill();
    ctx.fillStyle = '#9cf060'; ctx.fillRect(x + 1, y, Math.max(0, fw - 2), 1);
  }
}

// ------------------------------------------------------------------ reward chips / tiles
const lookRef = { look: null }; // the player's look (cosmetic reward thumbnails are worn by the player)
function rewardIcon(ctx, rw, cx, cy, px, t, ph = 0) {
  if (rw.key === 'aero') { drawAeroCoin(ctx, cx, cy, px * 0.36, t); return; }
  if (rw.key.startsWith('cosmetic:')) {
    let drawn = false;
    try {
      const item = CHAR.WARDROBE_BY_ID?.[rw.cosmetic];
      const pv = item && CHAR.itemPreview?.(lookRef.look || {}, item, 0.7);
      if (pv?.canvas) {
        const sc = Math.min(1.5, px / Math.max(pv.w, pv.h));
        const w = Math.max(1, Math.round(pv.w * sc)), h = Math.max(1, Math.round(pv.h * sc));
        ctx.drawImage(pv.canvas, Math.round(cx - w / 2), Math.round(cy - h / 2 + Math.sin(t * 2 + ph)), w, h);
        drawn = true;
      }
    } catch { drawn = false; }
    if (!drawn) drawAnimIcon(ctx, 'star', cx, cy, px, t, ph, {});
    return;
  }
  drawAnimIcon(ctx, rw.key, cx, cy, px, t, ph, {});
}
function rewardChips(ctx, ui, list, x, y, maxW, t) {
  let cx = x;
  for (let i = 0; i < list.length; i++) {
    const rw = list[i];
    const txt = rw.key === 'aero' ? String(rw.n) : rw.n ? 'x' + rw.n : '';
    const w = 18 + (txt ? measureText(txt, 'small') + 3 : 0);
    if (cx + w > x + maxW) break;
    ctx.drawImage(aeroSurface(w, 16, { tone: rw.big ? 'green' : 'white', r: 'pill', gloss: 0.6, glossH: 6, curve: 1, rim: 0.8, glow: 0.4 }), cx, y);
    rewardIcon(ctx, rw, cx + 9, y + 8, 12, t, i);
    if (txt) drawText(ctx, txt, cx + 16, y + 6, { font: 'small', color: rw.big ? '#ffffff' : INK, shadow: rw.big ? '#1c5a0e' : null });
    if (ui.hover({ x: cx, y, w, h: 16 })) ui.tip = rw.label;
    cx += w + 3;
  }
  return cx - x;
}

// [quests16] bigger reward tiles (voxel slab + icon + amount) for the order board
function rewardTiles(ctx, ui, list, x, y, size, maxW, t) {
  let cx = x;
  list.forEach((rw, i) => {
    const txt = rw.key === 'aero' ? String(rw.n) : rw.n ? 'x' + rw.n : '';
    const w = size + (txt ? measureText(txt, 'small') + 6 : 0);
    if (cx + w > x + maxW) return;
    ctx.drawImage(aeroSurface(w, size, { tone: rw.big ? 'green' : 'white', r: 7, gloss: 0.6, glossH: Math.round(size * 0.4), curve: 1, rim: 0.8, glow: 0.4 }), cx, y);
    rewardIcon(ctx, rw, cx + size / 2, y + size / 2, Math.round(size * 0.72), t, i);
    if (txt) drawText(ctx, txt, cx + size - 1, y + Math.round(size / 2 - 3), { font: 'small', color: INK });
    if (ui.hover({ x: cx, y, w, h: size })) ui.tip = rw.label;
    cx += w + 4;
  });
}

// ------------------------------------------------------------------ the HUD tracker + banners
// [quests16] banner headlines per quest kind (3D voxel letters)
const HEADS = { main: 'QUEST COMPLETE!', side: 'QUEST COMPLETE!', mile: 'MILESTONE!', order: 'ORDER FILLED!', orderBonus: 'BOARD CLEARED!' };
class QuestHud {
  constructor(game) {
    this.game = game;
    this.book = new QuestBook(game);
    this.t = 0;
    this.rect = null;
    this.hov = 0;
    this.banners = [];
    this.flash = {}; // qid -> t (just completed)
    this.rowsK = {};
    this.pendingChapter = null;
    this.introT = 0;
    this.pills = [];
    try { loadAlagard(); } catch { /* fallback font */ }
    game.on?.('questDone', (d) => {
      const q = QUEST_BY_ID[d.id];
      if (!q) return;
      if (q.kind === 'main') this.flash[q.id] = 0;
      if (d.quiet) return; // [quests16] "claim all" / a refreshed board: one banner is enough
      const lines = CHEERS[q.giver] || CHEERS.seal;
      this.banners = this.banners.filter((b) => b.kind !== 'ready' || b.t > 0);
      this.banners.push({ q, t: 0, head: HEADS[q.kind] || HEADS.main, line: lines[Math.floor(Math.random() * lines.length)], rw: rewardList(q.reward), bonus: d.bonus });
      game.audio?.play?.('ui_unlock');
      setTimeout(() => game.audio?.play?.('sparkle', { vol: 0.5 }), 180);
      const W = game.screen?.W || 960;
      try { game.particles?.aeroConfetti?.(W / 2, 40, 24, { layer: 'ui' }); } catch { /* optional */ }
    });
    // [quests16] a side story / order / milestone is ready to claim: a short 3D "READY!" pop (merged when several)
    game.on?.('questReady', (d) => {
      const ids = (d?.ids || []).filter((id) => QUEST_BY_ID[id]);
      if (!ids.length) return;
      const wait = this.banners.find((b) => b.kind === 'ready' && b.t === 0);
      if (wait) { wait.n += ids.length; return; }
      this.banners.push({ kind: 'ready', q: QUEST_BY_ID[ids[0]], n: ids.length, t: 0, rw: [] });
      game.audio?.play?.('sparkle', { vol: 0.6 });
    });
    game.on?.('chapterDone', (d) => { this.pendingChapter = d.id; this.introT = 0; });
  }

  slot() {
    const g = this.game;
    if (!g.state.tutorialDone || g.tutorial?.intro) return null;
    if (g.state.view === 'aquarium' && g.aquarium?.full3d) return null;
    let s = null;
    if (typeof g.hud?.questSlot === 'function') { s = g.hud.questSlot(); if (!s) return null; }
    else s = { x: 8, y: 34, w: 168, h: 104, a: 1 };
    if (g.fishing?.fighting) return null;
    return s;
  }

  hit(x, y) { const r = this.rect; return !!r && !this.game.ui?.blocking && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h; }

  open(tab = null) {
    const ui = this.game.ui;
    const S = ensureQuests(this.game.state);
    if ((S.outro || S.intro) && ui.panels.chapter && !tab) ui.open('chapter', S.outro ? { mode: 'done', id: S.outro } : { mode: 'intro', id: S.intro });
    else if (ui.panels.quests) {
      // [quests16] land on the tab with something to claim
      if (!tab) { const r = this.book.readyList()[0]; tab = r ? (r.kind === 'mile' ? 'miles' : r.kind === 'side' ? 'story' : 'orders') : null; }
      ui.open('quests', tab ? { tab, chapter: tab === 'story' ? this.book.readyList('side')[0]?.chapter : undefined } : undefined);
    }
  }

  update(dt, inp) {
    const g = this.game;
    this.t += dt;
    this.book.update(dt);
    for (const id in this.flash) { this.flash[id] += dt; if (this.flash[id] > 2.4) delete this.flash[id]; }
    const head = this.banners[0];
    if (head) head.t += dt;
    for (const b of this.banners.slice(1)) if (b.kind !== 'ready') b.t += dt;
    this.banners = this.banners.filter((b) => b.t < (b.kind === 'ready' ? 2.6 : 4.6));
    if (this.banners.length > 1 && this.banners[0].t > (this.banners[0].kind === 'ready' ? 1.4 : 2.2)) this.banners.shift();
    this.hov = damp(this.hov, inp && this.rect && inp.x >= this.rect.x && inp.y >= this.rect.y && inp.x < this.rect.x + this.rect.w && inp.y < this.rect.y + this.rect.h ? 1 : 0, 14, dt);
    if (inp && this.rect && inp.pressed && this.hit(inp.x, inp.y)) {
      inp.pressed = false;
      inp.consume?.();
      g.audio?.play?.('ui_click');
      // the claim pill opens the log on the right tab; the story pill tells the chapter story
      const pill = this.pills.find((p) => inp.x >= p.x && inp.y >= p.y && inp.x < p.x + p.w && inp.y < p.y + p.h);
      if (pill?.kind === 'claim') this.open(pill.tab);
      else this.open();
    }
    // a finished chapter (or a chapter that has not been introduced yet) gets its moment once the screen is calm
    const S = ensureQuests(g.state);
    const calm = g.state.tutorialDone && !g.ui?.blocking && !g.fishing?.busy && !g.tutorial?.intro && !g.ocean?.travelState && !g.tutorial?.active;
    // (chapter intros wait for a click on the tracker's NEW CHAPTER pill; the earned celebration opens by itself)
    if (S.outro && calm && g.ui?.panels?.chapter) {
      this.introT += dt;
      if (this.introT > 2.6 && !this.banners.length) { this.introT = 0; this.open(); }
    } else this.introT = 0;
  }

  drawHud(ctx, dt) {
    const g = this.game;
    this.rect = null;
    if (!g.ui?.isOpen?.('lab')) iconBudget(2);
    const s = this.slot();
    const S = ensureQuests(g.state);
    if (s && !g.ui?.blocking) this.drawTracker(ctx, s, S);
    this.drawBanners(ctx);
    void dt;
  }

  drawTracker(ctx, s, S) {
    const t = this.t, book = this.book;
    const ch = book.chapter();
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (s.a ?? 1);
    const k = clamp(s.w / 168, 0.8, 2);
    const big = k >= 1.3;
    const fT = big ? 'big' : 'normal', fS = big ? 'normal' : 'small', capT = big ? 9 : 7, capS = big ? 7 : 5;
    const w = Math.round(s.w);
    // [quests16] the pinned side story / order / milestone rides on top of the chapter's active quests
    const pin = book.pinned();
    const act = book.active().slice(0, 3);
    const flashIds = Object.keys(this.flash).filter((id) => QUEST_BY_ID[id]);
    const rows = [...(pin && !act.includes(pin) ? [pin] : []), ...flashIds.map((id) => QUEST_BY_ID[id]).filter((q) => !act.includes(q) && q !== pin), ...act].slice(0, 3);
    const RHt = capT + capS + 16, HH = capS + 11;
    const pending = !!(S.outro || S.intro);
    const ready = book.readyCount();
    const pendH = capS + 10;
    const pills = (pending ? 1 : 0) + (ready ? 1 : 0);
    const h = Math.min(Math.round(s.h), HH + Math.max(1, rows.length) * RHt + 4 + pills * (pendH + 3));
    const r = this.rect = { x: Math.round(s.x), y: Math.round(s.y), w, h };
    this.pills = [];
    ctx.drawImage(aeroSurface(w, h, { top: '#ffffff', mid: '#e8f8ff', bot: '#bfe6f8', a: [0.9 + this.hov * 0.06, 0.86 + this.hov * 0.08], edge: this.hov > 0.5 ? '#2a86c4' : '#4a9ed0', r: 9, gloss: 0.6, glossH: 12, curve: 2, rim: 0.9, glow: 0.5, sparkle: 1 }), r.x, r.y);
    // header: chapter name, quest dots, the Q key
    const hdr = ch ? `CHAPTER ${ch.n}: ${ch.title.toUpperCase()}` : 'ALL CHAPTERS DONE!';
    drawAnimIcon(ctx, 'star', r.x + 9, r.y + 4 + capS / 2, 12, t, 0, {});
    drawText(ctx, hdr, r.x + 18, r.y + 5, { font: 'small', color: '#1f6ea8' });
    const kb = measureText('Q', 'small') + 6;
    ctx.drawImage(aeroSurface(kb, 9, { tone: 'glass', r: 3, gloss: 0.6, glossH: 4, curve: 1, rim: 0.6, glow: 0.3 }), r.x + w - kb - 5, r.y + 3);
    drawText(ctx, 'Q', r.x + w - kb - 2, r.y + 5, { font: 'small', color: '#3c6f88' });
    if (ch) {
      const n = ch.quests.length, d = ch.quests.filter((q) => S.done[q.id]).length;
      for (let i = 0; i < n; i++) { ctx.fillStyle = i < d ? '#4cc83a' : rgba('#0c3a52', 0.16); ctx.fillRect(r.x + 18 + i * 7, r.y + HH - 4, 5, 2); }
    }
    let y = r.y + HH;
    rows.forEach((q, i) => {
      if (y + RHt > r.y + h - pills * (pendH + 3)) return;
      const fl = this.flash[q.id];
      const done = !!S.done[q.id];
      const kin = this.rowsK[q.id] = Math.min(1, (this.rowsK[q.id] ?? 0) + 0.05);
      const x = r.x + 5 + Math.round((1 - ease.outCubic(kin)) * -24);
      const objs = book.objectives(q);
      const o = objs.find((oo) => !oo.ok) || objs[objs.length - 1];
      if (fl !== undefined) {
        const f = clamp01(1 - fl / 2.4);
        ctx.drawImage(aeroSurface(w - 10, RHt - 3, { tone: 'green', r: 7, gloss: 0.6, glossH: 8, curve: 1, rim: 0.8, glow: 0.5, a: [f, f] }), r.x + 5, y);
        for (let j = 0; j < 4; j++) drawSparkle(ctx, r.x + 12 + ((t * 70 + j * 45) % (w - 24)), y + 4 + (j % 2) * 10, 1, f);
      }
      ctx.globalAlpha = a0 * (s.a ?? 1) * ease.outCubic(kin);
      // the objective icon in a little glass bubble (a pinned quest gets a gold one)
      const ir = Math.round((RHt - 8) / 2);
      const isPin = q === pin;
      ctx.drawImage(aeroSurface(ir * 2, ir * 2, { tone: done || book.isReady(q.id) ? 'green' : isPin ? 'orange' : 'white', r: 'pill', gloss: 0.7, glossH: ir, curve: 1, rim: 0.8, glow: 0.5 }), x, y + 2);
      drawAnimIcon(ctx, o.icon, x + ir, y + 2 + ir, Math.round(ir * 1.5), t, i * 1.3, {});
      const tx = x + ir * 2 + 5, tw = r.x + w - 6 - tx;
      let name = q.title;
      while (name.length > 3 && measureText(name, fT) > tw - 26) name = name.slice(0, -1);
      if (name !== q.title) name = name.slice(0, -1) + '.';
      drawText(ctx, name, tx, y + 3, { font: fT, color: done ? '#1f7a2c' : INK, shadow: '#ffffff' });
      let lab = book.isReady(q.id) ? 'Ready! Claim it in the Quest Log' : o.label;
      while (lab.length > 3 && measureText(lab, fS) > tw) lab = lab.slice(0, -1);
      if (lab !== o.label && !book.isReady(q.id)) lab = lab.slice(0, -1) + '.';
      drawText(ctx, lab, tx, y + 6 + capT, { font: fS, color: book.isReady(q.id) ? '#1f7a2c' : INK_SOFT });
      if (done || book.isReady(q.id)) {
        const ck = getUiIcon('check');
        if (ck) ctx.drawImage(ck, r.x + w - ck.width - 7, y + 3);
      } else {
        if (o.need > 1) drawText(ctx, `${o.have}/${o.need}`, r.x + w - 7, y + 3 + (capT - capS), { font: fS, align: 'right', color: '#2f8fc8' });
        miniBar(ctx, tx, y + capT + capS + 9, Math.max(24, tw), 3, o.have / Math.max(1, o.need));
      }
      ctx.globalAlpha = a0 * (s.a ?? 1);
      y += RHt;
    });
    // pills at the bottom: rewards waiting (green), a chapter story waiting (orange)
    let py = r.y + h - 3;
    const drawPill = (txt, tone, shadowC, kind, tab) => {
      py -= pendH;
      const pr = { x: r.x + 5, y: py, w: w - 10, h: pendH, kind, tab };
      ctx.drawImage(aeroSurface(pr.w, pr.h, { tone, r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.6 }), pr.x, pr.y);
      let tt = txt;
      while (tt.length > 3 && measureText(tt, 'small') > pr.w - 12) tt = tt.slice(0, -1);
      drawText(ctx, tt, Math.round(pr.x + pr.w / 2 - measureText(tt, 'small') / 2), pr.y + Math.round((pr.h - 5) / 2), { font: 'small', color: '#ffffff', shadow: shadowC });
      if ((t % 1) < 0.5) drawSparkle(ctx, pr.x + pr.w - 8, pr.y + 3, 2, 1);
      this.pills.push(pr);
      py -= 3;
    };
    if (pending) drawPill(S.outro ? 'CHAPTER COMPLETE! CLICK' : 'NEW CHAPTER! CLICK', 'orange', '#843a04', 'story');
    if (ready) {
      const first = book.readyList()[0];
      drawPill(ready > 1 ? `${ready} REWARDS TO CLAIM!` : 'REWARD TO CLAIM!', 'green', '#1c5a0e', 'claim', first?.kind === 'mile' ? 'miles' : first?.kind === 'side' ? 'story' : 'orders');
    }
    if (this.hov > 0.5) this.game.ui.tip = ready ? 'Quest Log (Q): claim your rewards!' : 'Quest Log (Q)';
    ctx.globalAlpha = a0;
  }

  // [phase9:ui] "QUEST COMPLETE!" is a cinematic 3D moment: big extruded gold voxel letters that pop and sway, the giver
  // cheering beside them, the quest name in 3D below and the rewards as 3D icons with 3D numbers. No 2D banner box, no
  // light rays; it never blocks clicks. [quests16] headlines per kind; a short "READY!" pop for claimables.
  drawBanners(ctx) {
    const b = this.banners[0];
    if (!b) return;
    const g = this.game, t = this.t;
    const W = g.screen.W;
    const dur = b.kind === 'ready' ? 2.6 : 4.6;
    const kin = b.t < 0.5 ? b.t / 0.5 : 1, kout = b.t > dur - 0.7 ? 1 - ease.inCubic(clamp01((b.t - (dur - 0.7)) / 0.7)) : 1;
    const cx = W / 2, cy = 70 - (1 - kout) * 20;
    ctx.save();
    ctx.globalAlpha *= kout;
    if (b.kind === 'ready') {
      drawAeroGlow(ctx, cx, cy + 4, 120, '#eaffc8', 0.3 * kin);
      const txt = b.n > 1 ? `${b.n} QUESTS READY!` : 'QUEST READY!';
      const head = drawPop3D(ctx, txt, cx, cy, { t, pop: kin, palette: 'leaf', size: 24, depth: 3, wobble: 0.7 });
      const hw = head ? head.w : 160;
      drawPortrait(ctx, b.q.giver, cx - hw / 2 - 24, cy + Math.sin(t * 5) * 2, 18, t, { talk: b.t < 1.2 ? 0.6 : 0, mood: 'excited', key: 'ready' });
      drawPop3D(ctx, b.n > 1 ? 'CLAIM THEM IN THE QUEST LOG' : b.q.title, cx, cy + 28, { t: t + 0.7, pop: clamp01((b.t - 0.2) / 0.4), palette: 'white', size: 12, depth: 2, wobble: 0.4, sparkle: false });
      ctx.restore();
      return;
    }
    drawAeroGlow(ctx, cx, cy + 8, 190, '#fff6c8', 0.4 * kin);
    const head = drawPop3D(ctx, b.head || 'QUEST COMPLETE!', cx, cy, { t, pop: kin, palette: 'gold', size: 32, depth: 4, wobble: 0.8, glowColor: '#8a4a06' });
    const hw = head ? head.w : 220;
    drawPortrait(ctx, b.q.giver, cx - hw / 2 - 30, cy + 2 + Math.sin(t * 5) * 2, 22, t, { talk: b.t < 1.6 ? 0.6 : 0, mood: 'excited', key: 'banner' });
    drawPop3D(ctx, b.q.title, cx, cy + 34, { t: t + 0.7, pop: clamp01((b.t - 0.25) / 0.45), palette: 'white', size: 16, depth: 3, wobble: 0.5, sparkle: false });
    // rewards: 3D icons with 3D amounts, popping in one after another
    const list = b.rw.slice(0, 5);
    const step = 58, x0 = cx - ((list.length - 1) * step) / 2;
    list.forEach((rw, i) => {
      const k = clamp01((b.t - 0.6 - i * 0.18) / 0.35);
      if (k <= 0) return;
      const rx = x0 + i * step, ry = cy + 62;
      const name = rw.key === 'aero' ? 'coin' : getUiIcon(rw.key)?.__icon3d ? rw.key : null;
      if (!(name && drawIcon3D(ctx, name, rx - 12, ry, Math.round(22 * (0.6 + 0.4 * ease.outBack(k))), { t, hover: k < 1 ? 1 : 0, phase: i }))) rewardIcon(ctx, rw, rx - 12, ry, 16, t, i);
      const txt = rw.key === 'aero' ? '+' + rw.n : rw.n ? 'x' + rw.n : '';
      if (txt) drawPop3D(ctx, txt, rx + 14, ry, { t: t + i, pop: k, palette: rw.key === 'aero' ? 'aqua' : 'leaf', size: 16, depth: 3, wobble: 0.4, glow: false, sparkle: false });
      if (k < 0.2 && !rw.fx) { rw.fx = true; try { g.particles?.pixelBurst?.('star', rx - 12, ry, 5, { layer: 'ui', ramp: 'gold' }); } catch { /* optional */ } }
    });
    if (!b.fx) { b.fx = true; try { g.particles?.celebrate?.(cx, cy, 1, { layer: 'ui' }); } catch { /* optional */ } }
    for (let i = 0; i < 8; i++) { const a = t * 1.6 + i * 0.8; drawSparkle(ctx, cx + Math.cos(a) * (hw * 0.6), cy + Math.sin(a) * 26, 1 + (i % 2), 0.8 * kin); }
    ctx.restore();
  }
}

export function installQuests(game) {
  const hud = new QuestHud(game);
  Object.defineProperty(lookRef, 'look', { get: () => game.state?.character || {}, configurable: true });
  return {
    book: hud.book,
    hud,
    update: (dt, inp) => hud.update(dt, inp),
    hit: (x, y) => hud.hit(x, y),
    drawHud: (ctx, dt) => hud.drawHud(ctx, dt),
    open: (tab) => hud.open(tab),
    // things waiting for the player (a chapter celebration, a new chapter's intro, rewards to claim): the HUD's Quests badge
    readyCount: () => { const S = ensureQuests(game.state); return (S.outro ? 1 : 0) + (S.intro ? 1 : 0) + (game.state.tutorialDone ? hud.book.readyCount() : 0); },
    get rect() { return hud.rect; },
  };
}

// ------------------------------------------------------------------ the Quest Log (panel 'quests')
// [quests16] three tabs: STORY (chapters: main line + side stories), TODAY'S ORDERS (the daily board) and MILESTONES
// (lifetime goals in tiers). Every list scrolls (wheel or drag the voxel thumb); cards show clear states: locked,
// active (+ TRACK pin), READY (a big CLAIM button) and done (stamp). "Claim all" pays everything waiting at once.
const TABS = [
  { id: 'story', label: 'Story', icon: 'book' },
  { id: 'orders', label: 'Orders', icon: 'shop' },
  { id: 'miles', label: 'Milestones', icon: 'trophy' },
];
const TONE_READY = { top: '#fffbe0', mid: '#ffeaa0', bot: '#ffd060', edge: '#9a5a08', a: [0.98, 0.98] };
const TONE_DONE = { top: '#f4ffe0', mid: '#d8f6b8', bot: '#a8e080', edge: '#2f7a1e', a: [0.97, 0.97] };
const TONE_LOCK = { top: '#dce8f0', mid: '#aec2d2', bot: '#8aa2b8', edge: '#4a6078', a: [0.9, 0.9] };
const fmtDur = (ms) => { const m = Math.ceil(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.max(1, m)}m`; };
const clip = (s, w, font = 'normal') => { if (measureText(s, font) <= w) return s; let o = s; while (o.length > 2 && measureText(o + '..', font) > w) o = o.slice(0, -1); return o.replace(/\s+$/, '') + '..'; };

export class QuestPanel {
  constructor() {
    this.id = 'quests';
    this.modal = true;
    this.sound = 'ui_open';
    this.t = 0;
    this.sel = null;
    this.tab = 'story';
    this.scroll = { story: 0, orders: 0, miles: 0 };
    this.drag = null;
  }

  get book() { return this.game.quests?.book || (this._book ||= new QuestBook(this.game)); }

  open(d) {
    const S = ensureQuests(this.game.state);
    this.sel = d?.chapter || CHAPTERS[Math.min(S.ch, CHAPTERS.length - 1)]?.id;
    if (d?.tab && TABS.some((x) => x.id === d.tab)) this.tab = d.tab;
    this.scroll = { story: 0, orders: 0, miles: 0 };
    this.drag = null;
    try { if (this.game.state.tutorialDone) this.book.refreshDaily(); } catch (e) { console.error(e); }
  }

  layout() {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    const w = Math.min(W - 24, 800), h = Math.min(H - 36, 480);
    return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) - 6, w, h };
  }

  tabReady(id) {
    const b = this.book;
    if (!this.game.state.tutorialDone) return 0;
    return id === 'story' ? b.readyCount('side') : id === 'orders' ? b.readyCount('order') : b.readyCount('mile');
  }

  draw(ctx, ui, dt) {
    const g = this.game, t = (this.t += dt), book = this.book;
    ensureQuests(g.state);
    iconBudget(6);
    const P = this.rect = this.layout();
    // frame
    ctx.fillStyle = rgba('#021a38', 0.3); roundRectPath(ctx, P.x + 3, P.y + 5, P.w, P.h, 14); ctx.fill();
    ctx.drawImage(aeroSurface(P.w, P.h, { top: '#f4fdff', mid: '#cdeefc', bot: '#8fd0f0', a: [0.98, 0.98], edge: '#0b4f8f', r: 14, gloss: 0.45, glossH: 24, curve: 3, rim: 0.95, glow: 0.6, streak: true, bubbles: 4, seed: 31 }), P.x, P.y);
    // header bar
    const hb = { x: P.x + 6, y: P.y + 4, w: P.w - 12, h: 30 };
    ctx.drawImage(aeroSurface(hb.w, hb.h, { top: '#e4ffb0', mid: '#7cd640', bot: '#2f9a1e', a: [1, 1], edge: '#1a5e12', r: 9, gloss: 0.75, glossH: 12, curve: 3, rim: 0.9, glow: 0.7, glowColor: '#eaffb4', streak: true }), hb.x, hb.y);
    // emblem: a glossy compass-orb with a star
    const ex = P.x + 26, ey = P.y + 18;
    drawAeroGlow(ctx, ex, ey, 30, '#ffffff', 0.5);
    ctx.drawImage(aeroCached('questemblem', () => {
      const c = document.createElement('canvas'); c.width = 46; c.height = 46;
      const g2 = c.getContext('2d');
      g2.fillStyle = '#1a5e12'; g2.beginPath(); g2.arc(23, 23, 22, 0, TAU); g2.fill();
      const rg = g2.createLinearGradient(0, 0, 0, 46); rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#d6eef8'); rg.addColorStop(1, '#ffffff');
      g2.fillStyle = rg; g2.beginPath(); g2.arc(23, 23, 21, 0, TAU); g2.fill();
      const og = g2.createRadialGradient(18, 16, 2, 23, 23, 17); og.addColorStop(0, '#fff6c8'); og.addColorStop(0.6, '#ffc83a'); og.addColorStop(1, '#e08a1a');
      g2.fillStyle = og; g2.beginPath(); g2.arc(23, 23, 17, 0, TAU); g2.fill();
      return c;
    }), ex - 23, ey - 23);
    drawAnimIcon(ctx, 'star', ex, ey, 22, t, 0, { hover: 0.3 });
    const tw0 = title(ctx, 'QUESTS', ex + 30, hb.y + 4, 20, '#ffffff', '#1a5e12');
    // tabs
    let tx = ex + 30 + Math.max(84, tw0) + 12;
    for (const tb of TABS) {
      const lab = tb.label;
      const w = measureText(lab, 'normal') + 40;
      const on = this.tab === tb.id;
      if (pill(ui, ctx, tx, hb.y + 4, w, 22, lab, { tone: on ? 'white' : 'grass', active: on, icon: icon(tb.icon, 14), sound: 'ui_page', tip: tb.id === 'orders' ? "Today's orders: refresh every day" : tb.id === 'miles' ? 'Lifetime goals' : 'Chapters and side stories' })) {
        if (this.tab !== tb.id) { this.tab = tb.id; this.drag = null; }
      }
      const n = this.tabReady(tb.id);
      if (n) drawAeroBadge(ctx, tx + w + 2, hb.y - 3, n, t);
      tx += w + 14;
    }
    // claim all
    const nReady = g.state.tutorialDone ? book.readyCount() : 0;
    if (pill(ui, ctx, hb.x + hb.w - 26, hb.y + 4, 22, 22, '', { tone: 'red', icon: getUiIcon('cross'), tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    if (nReady > 1) {
      const lab = `Claim all (${nReady})`, w = measureText(lab) + 46, x = hb.x + hb.w - 32 - w;
      drawAeroGlow(ctx, x + w / 2, hb.y + 15, w * 0.6, '#fff6a0', 0.3 + 0.15 * Math.sin(t * 5));
      if (pill(ui, ctx, x, hb.y + 4, w, 22, lab, { tone: 'orange', icon: icon('star', 14), sound: 'ui_unlock', tip: 'Collect every reward waiting' })) {
        const n = book.claimAll();
        if (n > 1) this.claimFx(P.x + P.w / 2, P.y + 60);
      }
    }
    const body = { x: P.x + 10, y: P.y + 42, w: P.w - 20, h: P.h - 52 };
    if (this.tab === 'orders') this.drawOrders(ctx, ui, body);
    else if (this.tab === 'miles') this.drawMilestones(ctx, ui, body);
    else this.drawStory(ctx, ui, body);
    if (ui.inp.pressed && ui.hover(P)) ui.inp.pressed = false;
  }

  claimFx(x, y) {
    const g = this.game;
    try { g.particles?.aeroConfetti?.(x, y, 30, { layer: 'ui' }); } catch { /* optional */ }
    try { g.particles?.pixelBurst?.('star', x, y, 8, { layer: 'ui', ramp: 'gold' }); } catch { /* optional */ }
  }

  // a claim from a card: pay it, burst some pixel stars at the button
  doClaim(q, x, y) {
    if (this.book.claim(q.id)) { this.claimFx(x, y); return true; }
    this.game.audio?.play?.('ui_error');
    return false;
  }

  // ---------------------------------------------------------------- scrolling list helper
  // rows: [{h, draw(y)}]; returns nothing. Wheel + a draggable voxel thumb on the right.
  scrollList(ctx, ui, key, R, rows) {
    const total = rows.reduce((a, r) => a + r.h, 0);
    const maxS = Math.max(0, total - R.h);
    if (ui.hover(R) && ui.inp.wheel) { this.scroll[key] = clamp(this.scroll[key] + ui.inp.wheel * 36, 0, maxS); ui.inp.wheel = 0; }
    // thumb drag
    const track = { x: R.x + R.w - 7, y: R.y, w: 7, h: R.h };
    const th = maxS > 0 ? Math.max(20, R.h * (R.h / total)) : 0;
    const thumbY = maxS > 0 ? R.y + (R.h - th) * (this.scroll[key] / maxS) : R.y;
    if (maxS > 0 && ui.inp.pressed && ui.hover({ x: track.x - 3, y: track.y, w: track.w + 6, h: track.h })) { ui.inp.pressed = false; this.drag = { key, y0: ui.inp.y, s0: (ui.inp.y >= thumbY && ui.inp.y <= thumbY + th) ? this.scroll[key] : clamp(((ui.inp.y - R.y - th / 2) / (R.h - th)) * maxS, 0, maxS) }; }
    if (this.drag?.key === key) {
      if (!ui.inp.down) this.drag = null;
      else this.scroll[key] = clamp(this.drag.s0 + ((ui.inp.y - this.drag.y0) / Math.max(1, R.h - th)) * maxS, 0, maxS);
    }
    this.scroll[key] = clamp(this.scroll[key], 0, maxS);
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x, R.y - 2, R.w, R.h + 4); ctx.clip();
    let y = R.y - this.scroll[key];
    const clipR = { x: R.x, y: R.y, w: R.w, h: R.h };
    for (const r of rows) { if (y + r.h >= R.y - 2 && y <= R.y + R.h + 2) r.draw(y, clipR); y += r.h; }
    ctx.restore();
    if (maxS > 0) {
      ctx.drawImage(aeroSurface(5, R.h, { tone: 'deep', r: 2, gloss: 0.2, glossH: 2, rim: 0.3, glow: 0, a: [0.45, 0.45] }), track.x + 1, R.y);
      ctx.drawImage(aeroSurface(5, Math.round(th), { tone: this.drag?.key === key ? 'orange' : 'white', r: 2, gloss: 0.7, glossH: 3, curve: 1, rim: 0.8, glow: 0.4 }), track.x + 1, Math.round(thumbY));
    }
  }

  // ---------------------------------------------------------------- one quest card
  cardState(q) {
    const S = ensureQuests(this.game.state), book = this.book;
    const isDone = !!S.done[q.id], ready = book.isReady(q.id), main = q.kind === 'main';
    const ci = q.chapter ? CHAPTERS.findIndex((c) => c.id === q.chapter) : -1;
    const active = main ? book.isActive(q.id) && ci === S.ch : !isDone && !ready && book.available(q);
    return { isDone, ready, main, active, locked: !isDone && !ready && !active };
  }

  cardLayout(q, w) {
    const st = this.cardState(q);
    if (st.locked) return { rl: [], rwW: 0, lines: [], LH: 0, objY: 0, h: 34 };
    // cached per quest, width and text face (the UI size changes the small face)
    const key = `${q.id}|${w}|${measureText('Mm', 'small')}`;
    const hit = (this.layouts ||= new Map()).get(key);
    if (hit) return hit;
    const L = this.cardLayoutRaw(q, w);
    if (this.layouts.size > 400) this.layouts.clear();
    this.layouts.set(key, L);
    return L;
  }

  cardLayoutRaw(q, w) {
    const rl = rewardList(q.reward);
    const rwW = Math.min(150, rl.reduce((a, rw) => a + 21 + (rw.key === 'aero' ? measureText(String(rw.n), 'small') + 3 : rw.n ? measureText('x' + rw.n, 'small') + 3 : 0), 0));
    const textW = Math.max(80, w - 44 - rwW - 14);
    const lines = wrapText(`"${q.text}"`, textW, 'small').slice(0, 3);
    const LH = lineHeight('small') + 3;
    const objY = 18 + lines.length * LH + 2;
    const nObj = q.objectives.length;
    const h = Math.max(52, objY + nObj * 17 + 4);
    return { rl, rwW, lines, LH, objY, h };
  }

  drawCard(ctx, ui, q, r, i, L, clipR) {
    const g = this.game, t = this.t, S = ensureQuests(g.state), book = this.book;
    const { isDone, ready, main, active, locked } = this.cardState(q);
    const tone = ready ? TONE_READY : isDone ? TONE_DONE : locked ? TONE_LOCK : 'frost';
    ctx.drawImage(aeroSurface(r.w, r.h, { tone, r: 8, gloss: 0.5, glossH: 14, curve: 2, rim: 0.9, glow: 0.4 }), r.x, r.y);
    const cy = r.y + Math.min(r.h / 2, 26);
    if (ready) { drawAeroGlow(ctx, r.x + 22, cy, 24, '#fff6a0', 0.35 + 0.15 * Math.sin(t * 4 + i)); if (((t * 0.9 + i * 0.37) % 1) < 0.2) drawSparkle(ctx, r.x + r.w - 20, r.y + 6, 2, 1, '#fff6a0'); }
    else if (active) drawAeroGlow(ctx, r.x + 22, cy, 22, '#fff6a0', 0.25 + 0.12 * Math.sin(t * 3 + i));
    if (locked) {
      // a compact grey slab: the giver behind frosted glass and a padlock
      const lcy = r.y + r.h / 2;
      drawPortrait(ctx, q.giver, r.x + 20, lcy, 12, t, { key: 'ql' + (i % 24) });
      ctx.fillStyle = rgba('#aec2d2', 0.55); ctx.beginPath(); ctx.arc(r.x + 20, lcy, 12, 0, TAU); ctx.fill();
      drawPadlock(ctx, r.x + 29, lcy + 8, 1, 0, 0);
      const after = q.after && QUEST_BY_ID[q.after];
      if (!main && after) {
        // a side story that waits for another quest: show what it is, and what opens it
        drawText(ctx, q.title, r.x + 40, r.y + 6, { color: '#ffffff', shadow: '#4a6078' });
        drawText(ctx, clip(`Opens after "${after.title}"`, r.w - 56, 'small'), r.x + 40, r.y + 19, { font: 'small', color: '#ffffff', shadow: '#4a6078' });
      } else {
        drawText(ctx, '???', r.x + 40, r.y + 6, { color: '#ffffff', shadow: '#4a6078' });
        drawText(ctx, clip(`${npcName(q.giver)} has something for you later...`, r.w - 56, 'small'), r.x + 40, r.y + 19, { font: 'small', color: '#ffffff', shadow: '#4a6078' });
      }
      return;
    }
    drawPortrait(ctx, q.giver, r.x + 22, cy, 16, t, { key: 'ql' + (i % 24), talk: ready ? 0.4 : 0 });
    const ttl = clip(q.title, r.w - 44 - L.rwW - 70);
    drawText(ctx, ttl, r.x + 44, r.y + 6, { color: isDone ? '#1f7a2c' : ready ? '#7a4204' : INK });
    let nx = r.x + 48 + measureText(ttl);
    drawText(ctx, npcName(q.giver).toUpperCase(), nx, r.y + 7, { font: 'small', color: shade(NPC_COL[q.giver] || '#35c8ff', -0.35) });
    nx += measureText(npcName(q.giver).toUpperCase(), 'small') + 4;
    if (q.online) { const tag = 'ONLINE, OPTIONAL'; drawText(ctx, tag, nx, r.y + 7, { font: 'small', color: '#8a5ad0' }); }
    L.lines.forEach((l, j) => drawText(ctx, l, r.x + 44, r.y + 18 + j * L.LH, { font: 'small', color: INK_SOFT }));
    // objectives, one per row
    const objs = book.objectives(q);
    const statusW = 74;
    objs.forEach((o, j) => {
      const oy = r.y + L.objY + j * 17;
      drawAnimIcon(ctx, o.icon, r.x + 50, oy + 6, 12, t, j + i, {});
      const lab = clip(o.label, r.w - 44 - 15 - statusW - 40);
      drawText(ctx, lab, r.x + 59, oy + 1, { color: o.ok ? '#1f7a2c' : INK });
      const lw = measureText(lab);
      if (!o.ok) {
        drawAeroBar(ctx, r.x + 59, oy + 11, Math.max(40, Math.min(150, lw)), 5, o.have / Math.max(1, o.need), { color: '#5fd23a' });
        if (o.need > 1) drawText(ctx, `${fmtN(o.have)}/${fmtN(o.need)}`, r.x + 63 + Math.max(40, Math.min(150, lw)), oy + 10, { font: 'small', color: '#2f8fc8' });
      } else { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, r.x + 61 + lw, oy - 1); }
    });
    // rewards (top right)
    rewardChips(ctx, ui, L.rl, r.x + r.w - L.rwW - 6, r.y + 6, L.rwW + 4, t);
    // status (bottom right)
    const sx = r.x + r.w - statusW - 4, sy = r.y + r.h - 22;
    const vis = (rr) => rr.y >= clipR.y - 1 && rr.y + rr.h <= clipR.y + clipR.h + 1;
    if (isDone) {
      ctx.save(); ctx.translate(r.x + r.w - 40, r.y + r.h - 14); ctx.rotate(-0.15);
      ctx.drawImage(aeroSurface(52, 15, { tone: 'green', r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.5 }), -26, -7);
      drawText(ctx, main ? 'DONE!' : 'CLAIMED', -measureText(main ? 'DONE!' : 'CLAIMED', 'small') / 2, -3, { font: 'small', color: '#ffffff', shadow: '#1c5a0e' });
      ctx.restore();
    } else if (ready) {
      drawAeroGlow(ctx, sx + statusW / 2, sy + 9, statusW * 0.7, '#fff6a0', 0.35 + 0.2 * Math.sin(t * 6 + i));
      const br = { x: sx, y: sy, w: statusW, h: 18 };
      if (vis(br) && pill(ui, ctx, br.x, br.y, br.w, br.h, 'CLAIM!', { tone: 'green', icon: icon('star', 12), sound: 'ui_unlock', tip: 'Collect the reward' })) this.doClaim(q, br.x + br.w / 2, br.y);
      else if (!vis(br)) drawAeroButton(ctx, br.x, br.y, br.w, br.h, { label: 'CLAIM!', tone: 'green' });
    } else if (main) {
      ctx.drawImage(aeroSurface(48, 13, { tone: 'orange', r: 'pill', gloss: 0.7, glossH: 5, curve: 1, rim: 0.8, glow: 0.5 }), r.x + r.w - 54, r.y + r.h - 17);
      drawText(ctx, 'ACTIVE', r.x + r.w - 47, r.y + r.h - 13, { font: 'small', color: '#ffffff', shadow: '#843a04' });
    } else {
      // side stories / orders / milestones can be pinned to the HUD tracker
      const pinned = S.pin === q.id;
      const br = { x: sx + 10, y: sy + 2, w: statusW - 10, h: 15 };
      if (!vis(br)) drawAeroButton(ctx, br.x, br.y, br.w, br.h, { label: pinned ? 'TRACKED' : 'TRACK', tone: pinned ? 'orange' : 'aqua', font: 'small', fixedFont: true });
      else if (pill(ui, ctx, br.x, br.y, br.w, br.h, pinned ? 'TRACKED' : 'TRACK', { tone: pinned ? 'orange' : 'aqua', font: 'small', fixedFont: true, tip: pinned ? 'Shown on the HUD tracker (click to unpin)' : 'Show it on the HUD tracker' })) book.setPin(q.id);
    }
  }

  // ---------------------------------------------------------------- STORY tab
  drawStory(ctx, ui, B) {
    const g = this.game, t = this.t, S = ensureQuests(g.state), book = this.book;
    // chapter list (left)
    const lx = B.x, ly = B.y, lw = 186;
    const n = CHAPTERS.length, eh = Math.min(54, Math.floor((B.h - 30 - 4 * (n - 1)) / n));
    // overall progress
    const total = STORY_QUESTS.length, done = STORY_QUESTS.filter((q) => S.done[q.id]).length;
    drawText(ctx, `${done}/${total} STORY QUESTS`, lx + 2, ly + 1, { font: 'small', color: '#1f6ea8' });
    drawAeroBar(ctx, lx + 2, ly + 11, lw - 4, 6, done / total, { color: '#ffd23a' });
    CHAPTERS.forEach((c, i) => {
      const cy = ly + 24 + i * (eh + 4);
      const cur = i === S.ch, isDone = !!S.chDone[c.id], locked = i > S.ch, sel = this.sel === c.id;
      const r = { x: lx, y: cy, w: lw, h: eh };
      const hov = ui.hover(r);
      const tone = sel ? { top: '#ffffff', mid: '#c8f0ff', bot: '#7fd0f4', edge: '#1f6ea8', a: [1, 1] } : locked ? 'grey' : isDone ? TONE_DONE : 'white';
      ctx.drawImage(aeroSurface(r.w, r.h, { tone, r: 9, gloss: 0.6, glossH: 16, curve: 2, rim: 0.9, glow: 0.5 }), r.x, r.y);
      if (hov && !sel) drawPixelBrackets(ctx, r.x, r.y, r.w, r.h, t, {});
      if (cur) drawAeroGlow(ctx, r.x + 24, r.y + eh / 2, 24, '#fff6a0', 0.4 + 0.2 * Math.sin(t * 3));
      if (locked) drawPadlock(ctx, r.x + 24, r.y + eh / 2 + 2, 2, 0, Math.sin(t * 2 + i) * 0.1);
      else drawAnimIcon(ctx, 'biome:' + c.ocean, r.x + 24, r.y + eh / 2, Math.min(30, eh - 14), t, i, { hover: hov ? 0.6 : 0 });
      drawText(ctx, `CHAPTER ${c.n}`, r.x + 46, r.y + 6, { font: 'small', color: locked ? '#eef2f6' : '#2f8fc8', shadow: locked ? '#5a6a7c' : null });
      drawText(ctx, locked ? '???' : clip(c.title, lw - 56), r.x + 46, r.y + 15, { color: locked ? '#ffffff' : INK, shadow: locked ? '#5a6a7c' : null });
      if (!locked) {
        const nm = c.quests.length, dm = c.quests.filter((q) => S.done[q.id]).length;
        const ns = c.side.length, ds = c.side.filter((q) => S.done[q.id]).length;
        drawAeroBar(ctx, r.x + 46, r.y + eh - 13, lw - 58, 5, dm / nm, { color: isDone ? '#5fd23a' : '#35c8ff' });
        drawText(ctx, `${dm}/${nm}`, r.x + lw - 8, r.y + 6, { font: 'small', align: 'right', color: INK_SOFT });
        // side story count, with a little star
        const st = `+${ds}/${ns}`;
        drawText(ctx, st, r.x + lw - 8, r.y + 15, { font: 'small', align: 'right', color: '#b06a08' });
        const rd = c.side.filter((q) => book.isReady(q.id)).length;
        if (rd && g.state.tutorialDone) drawAeroBadge(ctx, r.x + lw + 2, r.y - 4, rd, t);
      }
      if (isDone) { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, r.x + 6, r.y + 4); }
      if (ui.clicked(r)) { if (locked) { g.audio.play('ui_error'); g.toast?.('Finish the chapter before it first!', 'lock'); } else { this.sel = c.id; this.scroll.story = 0; g.audio.play('ui_page'); } }
    });
    // chapter page (right)
    const c = CHAPTER_BY_ID[this.sel] || CHAPTERS[0];
    const px = lx + lw + 10, py = B.y, pw = B.x + B.w - px, ph = B.h;
    ctx.drawImage(aeroSurface(pw, ph, { top: '#2a8fe0', mid: '#1468c0', bot: '#0b4a90', a: [0.95, 0.96], edge: '#06305e', r: 10, gloss: 0.15, glossH: 20, rim: 0.5, glow: 0.4, glowColor: '#58c8ff', bubbles: 5, seed: 41 }), px, py);
    this.drawChapterPage(ctx, ui, c, { x: px, y: py, w: pw, h: ph });
  }

  drawChapterPage(ctx, ui, c, R) {
    const g = this.game, t = this.t, S = ensureQuests(g.state), book = this.book;
    // banner: big giver portrait + the intro line + title (a soft glow behind, no light rays)
    const intro = c.intro[Math.floor(t / 6) % c.intro.length];
    drawAeroGlow(ctx, R.x + 40, R.y + 40, 44, '#bff6ff', 0.35);
    drawPortrait(ctx, intro.npc, R.x + 40, R.y + 40, 30, t, { talk: (t % 6) < 2 ? 0.6 : 0, key: 'log' });
    title(ctx, `CHAPTER ${c.n}: ${c.title.toUpperCase()}`, R.x + 80, R.y + 8, 16, '#ffffff', '#0a3a6e');
    // a chapter story waiting: a glowing pill opens it (then comes back here)
    if ((S.outro || S.intro) && ui.panels.chapter) {
      const txt = S.outro ? 'Chapter complete!' : 'New chapter!';
      const sw = measureText(txt) + 40, sx = R.x + R.w - sw - 8, sy = R.y + 6;
      drawAeroGlow(ctx, sx + sw / 2, sy + 10, sw * 0.6, '#fff6a0', 0.35 + 0.2 * Math.sin(t * 5));
      if (pill(ui, ctx, sx, sy, sw, 20, txt, { tone: 'orange', icon: icon('star', 14), tip: 'Hear the story', sound: 'ui_unlock' })) {
        ui.open('chapter', S.outro ? { mode: 'done', id: S.outro, then: 'quests' } : { mode: 'intro', id: S.intro, then: 'quests' });
        return;
      }
    }
    const bw = R.w - 92, lines = wrapText(intro.text, bw - 16).slice(0, 2);
    const bh = lines.length * 10 + 16;
    ctx.drawImage(aeroSurface(bw, bh, { tone: 'white', r: 8, gloss: 0.5, glossH: 8, curve: 1, rim: 0.8, glow: 0.3 }), R.x + 80, R.y + 30);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(R.x + 80, R.y + 40); ctx.lineTo(R.x + 74, R.y + 44); ctx.lineTo(R.x + 80, R.y + 48); ctx.closePath(); ctx.fill();
    drawText(ctx, npcName(intro.npc).toUpperCase(), R.x + 88, R.y + 34, { font: 'small', color: shade(NPC_COL[intro.npc] || '#35c8ff', -0.4) });
    lines.forEach((l, i) => drawText(ctx, l, R.x + 88, R.y + 43 + i * 10, { color: INK }));
    // quest cards: MAIN STORY, then SIDE STORIES (ready first, then open, locked, claimed)
    const top = R.y + 84, bottom = R.y + R.h - 44;
    const cw = R.w - 24;
    const rows = [];
    const head = (label, sub, col) => rows.push({ h: 22, draw: (y) => {
      ctx.drawImage(aeroSurface(cw, 17, { tone: col, r: 6, gloss: 0.6, glossH: 7, curve: 1, rim: 0.8, glow: 0.4 }), R.x + 8, y + 2);
      drawText(ctx, label, R.x + 16, y + 6, { font: 'small', color: '#ffffff', shadow: shade(toneOf(col).edge || '#0b4a8a', -0.1) });
      if (sub) drawText(ctx, sub, R.x + 8 + cw - 8, y + 6, { font: 'small', align: 'right', color: '#ffffff', shadow: shade(toneOf(col).edge || '#0b4a8a', -0.1) });
    } });
    const card = (q, i) => { const L = this.cardLayout(q, cw); rows.push({ h: L.h + 4, draw: (y, clipR) => this.drawCard(ctx, ui, q, { x: R.x + 8, y, w: cw, h: L.h }, i, L, clipR) }); };
    const md = c.quests.filter((q) => S.done[q.id]).length;
    const mainSec = () => { head('MAIN STORY', `${md}/${c.quests.length}`, 'aqua'); c.quests.forEach((q, i) => card(q, i)); };
    const sideSec = () => {
      if (!c.side.length) return;
      const reached = book.chapterReached(c.id);
      const rank = (q) => (book.isReady(q.id) ? 0 : S.done[q.id] ? 3 : book.available(q) ? 1 : 2);
      const side = reached ? [...c.side].sort((a, b) => rank(a) - rank(b) || c.side.indexOf(a) - c.side.indexOf(b)) : c.side;
      const sd = c.side.filter((q) => S.done[q.id]).length;
      head('SIDE STORIES  (OPTIONAL)', `${sd}/${c.side.length}`, 'orange');
      side.forEach((q, i) => card(q, i + c.quests.length));
    };
    // a finished main story moves below the side stories (what's left to do comes first)
    if (S.chDone[c.id]) { sideSec(); mainSec(); } else { mainSec(); sideSec(); }
    this.scrollList(ctx, ui, 'story', { x: R.x + 2, y: top, w: R.w - 4, h: bottom - top }, rows);
    // chapter reward strip
    const sy = R.y + R.h - 38;
    ctx.drawImage(aeroSurface(R.w - 16, 32, { top: '#fffbe0', mid: '#ffe08a', bot: '#ffb84a', a: [0.97, 0.97], edge: '#8a4a06', r: 8, gloss: 0.6, glossH: 12, curve: 2, rim: 0.9, glow: 0.5 }), R.x + 8, sy);
    drawText(ctx, S.chDone[c.id] ? 'CHAPTER REWARD - CLAIMED!' : 'CHAPTER REWARD (FINISH THE MAIN STORY)', R.x + 16, sy + 5, { font: 'small', color: '#8a4a06' });
    const rl = rewardList(c.reward);
    let rx = R.x + 16;
    for (let i = 0; i < rl.length; i++) {
      const rw = rl[i];
      const big = rw.big;
      const w = big ? measureText(rw.label, 'small') + 26 : 22;
      if (rx + w > R.x + R.w - 12) break;
      if (big) {
        ctx.drawImage(aeroSurface(w, 18, { tone: 'green', r: 'pill', gloss: 0.7, glossH: 7, curve: 1, rim: 0.8, glow: 0.6 }), rx, sy + 12);
        drawAnimIcon(ctx, rw.key, rx + 10, sy + 21, 14, t, i, {});
        drawText(ctx, rw.label.toUpperCase(), rx + 20, sy + 18, { font: 'small', color: '#ffffff', shadow: '#1c5a0e' });
      } else {
        ctx.drawImage(aeroSurface(20, 18, { tone: 'white', r: 6, gloss: 0.6, glossH: 7, curve: 1, rim: 0.8, glow: 0.4 }), rx, sy + 12);
        rewardIcon(ctx, rw, rx + 10, sy + 21, 14, t, i);
      }
      if (ui.hover({ x: rx, y: sy + 12, w, h: 18 })) ui.tip = rw.label;
      rx += w + 4;
    }
  }

  // ---------------------------------------------------------------- TODAY'S ORDERS tab
  drawOrders(ctx, ui, B) {
    const g = this.game, t = this.t, S = ensureQuests(g.state), book = this.book;
    ctx.drawImage(aeroSurface(B.w, B.h, { top: '#2a8fe0', mid: '#1468c0', bot: '#0b4a90', a: [0.95, 0.96], edge: '#06305e', r: 10, gloss: 0.15, glossH: 20, rim: 0.5, glow: 0.4, glowColor: '#58c8ff', bubbles: 5, seed: 43 }), B.x, B.y);
    if (!g.state.tutorialDone) {
      drawPortrait(ctx, 'seal', B.x + B.w / 2, B.y + B.h / 2 - 30, 30, t, { key: 'ord0' });
      const s = 'Finish Bubbles\' fishing lesson to open the order board!';
      drawText(ctx, s, Math.round(B.x + B.w / 2 - measureText(s) / 2), B.y + B.h / 2 + 10, { color: '#ffffff', shadow: '#0a3a6e' });
      return;
    }
    // board header: the stall, the timer, swaps left
    const D = S.daily;
    drawAnimIcon(ctx, 'shop', B.x + 26, B.y + 22, 30, t, 0, {});
    title(ctx, "TODAY'S ORDERS", B.x + 48, B.y + 8, 16, '#ffffff', '#0a3a6e');
    const tm = `New orders in ${fmtDur(book.msToNewOrders())}`;
    drawText(ctx, tm, B.x + 50, B.y + 30, { font: 'small', color: '#bff6ff' });
    const sw = `Swaps left today: ${D.swaps | 0}`;
    drawText(ctx, sw, B.x + B.w - 12 - measureText(sw, 'small'), B.y + 12, { font: 'small', color: '#bff6ff' });
    const filled = book.orders().filter((q) => S.done[q.id]).length;
    drawText(ctx, `Filled ${filled}/${ORDERS_PER_DAY}`, B.x + B.w - 12 - measureText(`Filled ${filled}/${ORDERS_PER_DAY}`, 'small'), B.y + 24, { font: 'small', color: '#ffe25a' });
    // three order cards
    const list = book.orders();
    const gap = 10, cy = B.y + 46, ch = B.h - 46 - 74, cw = Math.floor((B.w - 20 - gap * 2) / 3);
    list.forEach((q, i) => {
      const r = { x: B.x + 10 + i * (cw + gap), y: cy, w: cw, h: ch };
      const done = !!S.done[q.id], ready = book.isReady(q.id);
      ctx.drawImage(aeroSurface(r.w, r.h, { tone: ready ? TONE_READY : done ? TONE_DONE : 'frost', r: 10, gloss: 0.5, glossH: 22, curve: 2, rim: 0.9, glow: 0.5 }), r.x, r.y);
      // a paper ticket pin at the top
      ctx.drawImage(aeroSurface(18, 10, { tone: 'red', r: 'pill', gloss: 0.8, glossH: 4, curve: 1, rim: 0.8, glow: 0.4 }), r.x + r.w / 2 - 9, r.y - 4);
      const pcy = r.y + 40;
      if (ready) drawAeroGlow(ctx, r.x + r.w / 2, pcy, 44, '#fff6a0', 0.35 + 0.15 * Math.sin(t * 4 + i));
      drawPortrait(ctx, q.giver, r.x + r.w / 2, pcy, 28, t, { key: 'ord' + i, talk: ready ? 0.5 : (t + i * 2) % 7 < 1.2 ? 0.5 : 0 });
      const gn = npcName(q.giver).toUpperCase();
      drawText(ctx, gn, Math.round(r.x + r.w / 2 - measureText(gn, 'small') / 2), r.y + 73, { font: 'small', color: shade(NPC_COL[q.giver] || '#35c8ff', -0.4) });
      title(ctx, clip(q.title.toUpperCase(), r.w - 20), r.x + r.w / 2, r.y + 82, 14, done ? '#d8ffc0' : '#ffffff', done ? '#1f7a2c' : '#0a3a6e', 'center');
      // the request, in the giver's voice, on a speech slab
      const lines = wrapText(`"${q.text}"`, r.w - 30, 'normal').slice(0, 5);
      const LH = lineHeight('normal') + 2;
      const sh = lines.length * LH + 10;
      ctx.drawImage(aeroSurface(r.w - 16, sh, { tone: 'white', r: 7, gloss: 0.4, glossH: 8, curve: 1, rim: 0.7, glow: 0.2 }), r.x + 8, r.y + 104);
      lines.forEach((l, j) => drawText(ctx, l, Math.round(r.x + r.w / 2 - measureText(l) / 2), r.y + 110 + j * LH, { color: INK_SOFT }));
      // the objective, big, on a little glass pedestal between the request and the ticket stub
      const o = book.objectives(q)[0];
      const oy = r.y + r.h - 74;
      const my = Math.round((r.y + 104 + sh + oy) / 2);
      if (oy - (r.y + 104 + sh) > 50) {
        const ps = Math.min(64, oy - (r.y + 104 + sh) - 14);
        drawAeroGlow(ctx, r.x + r.w / 2, my, ps * 0.8, ready || done ? '#eaffb4' : '#bff6ff', 0.5);
        ctx.drawImage(aeroSurface(ps + 16, 10, { tone: 'glass', r: 'pill', gloss: 0.7, glossH: 4, curve: 1, rim: 0.8, glow: 0.4 }), Math.round(r.x + r.w / 2 - ps / 2 - 8), my + Math.round(ps * 0.38));
        drawAnimIcon(ctx, o.icon, r.x + r.w / 2, my - 2 + Math.sin(t * 2 + i) * 1.5, ps, t, i, { hover: ready ? 0.8 : 0 });
      }
      ctx.drawImage(aeroSurface(r.w - 16, 34, { tone: o.ok ? TONE_DONE : 'aqua', r: 7, gloss: 0.5, glossH: 10, curve: 1, rim: 0.8, glow: 0.3 }), r.x + 8, oy);
      ctx.drawImage(aeroSurface(26, 26, { tone: 'white', r: 'pill', gloss: 0.7, glossH: 10, curve: 1, rim: 0.8, glow: 0.4 }), r.x + 12, oy + 4);
      drawAnimIcon(ctx, o.icon, r.x + 25, oy + 17, 18, t, i, {});
      const ol = wrapText(o.label, r.w - 60, 'small').slice(0, 2);
      const LS = lineHeight('small') + 2;
      ol.forEach((l, j) => drawText(ctx, l, r.x + 44, oy + 5 + j * LS, { font: 'small', color: o.ok ? '#1f7a2c' : '#ffffff', shadow: o.ok ? null : '#0a3e74' }));
      if (!o.ok) {
        drawAeroBar(ctx, r.x + 44, oy + 24, r.w - 96, 5, o.have / Math.max(1, o.need), { color: '#5fd23a' });
        drawText(ctx, `${fmtN(o.have)}/${fmtN(o.need)}`, r.x + r.w - 14, oy + 23, { font: 'small', align: 'right', color: '#ffffff', shadow: '#0a3e74' });
      } else { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, r.x + r.w - 26, oy + 11); }
      // reward + action
      const rl = rewardList(q.reward);
      const ay = r.y + r.h - 32;
      rewardTiles(ctx, ui, rl, r.x + 10, ay, 26, r.w - 100, t);
      const bx = r.x + r.w - 84, by = ay + 3;
      if (done) {
        ctx.save(); ctx.translate(bx + 38, by + 10); ctx.rotate(-0.12);
        ctx.drawImage(aeroSurface(64, 17, { tone: 'green', r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.5 }), -32, -8);
        drawText(ctx, 'DELIVERED', -measureText('DELIVERED', 'small') / 2, -3, { font: 'small', color: '#ffffff', shadow: '#1c5a0e' });
        ctx.restore();
      } else if (ready) {
        drawAeroGlow(ctx, bx + 38, by + 10, 50, '#fff6a0', 0.35 + 0.2 * Math.sin(t * 6 + i));
        if (pill(ui, ctx, bx, by, 76, 20, 'CLAIM!', { tone: 'green', icon: icon('star', 12), sound: 'ui_unlock', tip: 'Collect the reward' })) this.doClaim(q, bx + 38, by);
      } else {
        const pinned = S.pin === q.id;
        if (pill(ui, ctx, bx, by + 2, 36, 16, pinned ? 'ON' : 'PIN', { tone: pinned ? 'orange' : 'aqua', font: 'small', fixedFont: true, tip: pinned ? 'Tracked on the HUD (click to unpin)' : 'Track it on the HUD' })) book.setPin(q.id);
        if (pill(ui, ctx, bx + 40, by + 2, 36, 16, 'SWAP', { tone: 'white', font: 'small', fixedFont: true, disabled: (D.swaps | 0) <= 0, tip: 'Swap this order for another one (once a day)', onDisabled: () => g.toast?.('No swaps left today!', 'lock') })) { if (book.swapOrder(q.id)) g.audio?.play?.('ui_page'); }
      }
    });
    // the board bonus
    const bq = book.orderBonus();
    if (bq) {
      const r = { x: B.x + 10, y: B.y + B.h - 66, w: B.w - 20, h: 56 };
      const done = !!S.done[bq.id], ready = book.isReady(bq.id);
      ctx.drawImage(aeroSurface(r.w, r.h, { tone: ready ? TONE_READY : done ? TONE_DONE : { top: '#fffbe0', mid: '#ffe08a', bot: '#ffb84a', edge: '#8a4a06', a: [0.97, 0.97] }, r: 9, gloss: 0.6, glossH: 16, curve: 2, rim: 0.9, glow: 0.5 }), r.x, r.y);
      const pk = Object.keys(bq.reward.items || {})[0] || 'pkg_crate';
      if (ready) drawAeroGlow(ctx, r.x + 30, r.y + 28, 30, '#fff6a0', 0.4 + 0.2 * Math.sin(t * 4));
      drawAnimIcon(ctx, 'mat:' + pk, r.x + 30, r.y + 28, 36, t, 0, { hover: ready ? 0.8 : 0 });
      drawText(ctx, 'BOARD BONUS', r.x + 58, r.y + 8, { font: 'small', color: '#8a4a06' });
      drawText(ctx, done ? 'Bonus collected! See you tomorrow.' : 'Fill all three orders for a bonus chest!', r.x + 58, r.y + 18, { color: INK });
      const o = book.objectives(bq)[0];
      for (let i = 0; i < ORDERS_PER_DAY; i++) {
        const on = i < o.have || o.ok;
        ctx.drawImage(aeroSurface(16, 16, { tone: on ? 'green' : 'white', r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.4 }), r.x + 58 + i * 20, r.y + 32);
        if (on) { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, Math.round(r.x + 66 + i * 20 - ck.width / 2), Math.round(r.y + 40 - ck.height / 2)); }
      }
      const rl = rewardList(bq.reward);
      rewardChips(ctx, ui, rl, r.x + 130, r.y + 33, 200, t);
      if (ready) {
        if (pill(ui, ctx, r.x + r.w - 104, r.y + 18, 94, 22, 'CLAIM!', { tone: 'green', icon: icon('star', 14), sound: 'ui_unlock', tip: 'Collect the bonus chest' })) this.doClaim(bq, r.x + r.w - 57, r.y + 18);
      } else if (done) {
        drawText(ctx, 'CLAIMED', r.x + r.w - 70, r.y + 24, { color: '#1f7a2c' });
      }
    }
  }

  // ---------------------------------------------------------------- MILESTONES tab
  drawMilestones(ctx, ui, B) {
    const g = this.game, t = this.t, S = ensureQuests(g.state), book = this.book;
    ctx.drawImage(aeroSurface(B.w, B.h, { top: '#2a8fe0', mid: '#1468c0', bot: '#0b4a90', a: [0.95, 0.96], edge: '#06305e', r: 10, gloss: 0.15, glossH: 20, rim: 0.5, glow: 0.4, glowColor: '#58c8ff', bubbles: 5, seed: 47 }), B.x, B.y);
    const total = MILESTONES.length, done = MILESTONES.filter((q) => S.done[q.id]).length;
    drawAnimIcon(ctx, 'trophy', B.x + 24, B.y + 20, 28, t, 0, {});
    title(ctx, 'MILESTONES', B.x + 44, B.y + 8, 16, '#ffffff', '#0a3a6e');
    drawText(ctx, `${done}/${total} REACHED`, B.x + 46, B.y + 28, { font: 'small', color: '#bff6ff' });
    drawAeroBar(ctx, B.x + 180, B.y + 14, B.w - 200, 7, done / total, { color: '#ffd23a' });
    // one card per line: the next tier (or the last one when the line is complete)
    const lines = MILESTONE_LINES.map((l, i) => {
      const tiers = MILESTONE_BY_LINE[l.id] || [];
      const cur = tiers.find((q) => !S.done[q.id]) || tiers[tiers.length - 1];
      const ready = tiers.filter((q) => book.isReady(q.id)).length;
      const complete = tiers.every((q) => S.done[q.id]);
      const prog = cur ? book.progress(cur) : 1;
      return { l, i, tiers, cur, ready, complete, prog };
    }).filter((x) => x.cur);
    lines.sort((a, b) => (b.ready > 0) - (a.ready > 0) || a.complete - b.complete || b.prog - a.prog || a.i - b.i);
    const top = B.y + 40, R = { x: B.x + 6, y: top, w: B.w - 12, h: B.y + B.h - 8 - top };
    const cols = 2, gap = 8, cw = Math.floor((R.w - 12 - gap) / cols), chh = 74;
    const rows = [];
    for (let i = 0; i < lines.length; i += cols) {
      const pair = lines.slice(i, i + cols);
      rows.push({ h: chh + 6, draw: (y, clipR) => pair.forEach((m, j) => this.drawMilestone(ctx, ui, m, { x: R.x + 2 + j * (cw + gap), y, w: cw, h: chh }, clipR, i + j)) });
    }
    this.scrollList(ctx, ui, 'miles', R, rows);
    void t;
  }

  drawMilestone(ctx, ui, m, r, clipR, i) {
    const g = this.game, t = this.t, S = ensureQuests(g.state), book = this.book;
    const q = m.cur, ready = book.isReady(q.id), complete = m.complete;
    const firstReady = m.tiers.find((x) => book.isReady(x.id));
    ctx.drawImage(aeroSurface(r.w, r.h, { tone: firstReady ? TONE_READY : complete ? TONE_DONE : 'frost', r: 9, gloss: 0.5, glossH: 16, curve: 2, rim: 0.9, glow: 0.4 }), r.x, r.y);
    // the line's icon in a bubble
    ctx.drawImage(aeroSurface(36, 36, { tone: complete ? 'green' : firstReady ? 'orange' : 'white', r: 'pill', gloss: 0.7, glossH: 14, curve: 1, rim: 0.8, glow: 0.5 }), r.x + 6, r.y + 6);
    drawAnimIcon(ctx, m.l.icon, r.x + 24, r.y + 24, 24, t, i, {});
    // tier stars under the icon
    const n = m.tiers.length;
    for (let k = 0; k < n; k++) {
      const on = !!S.done[m.tiers[k].id], rd = book.isReady(m.tiers[k].id);
      const sx = r.x + 24 - (n * 7) / 2 + k * 7 + 3, sy = r.y + 50;
      ctx.fillStyle = on ? '#ffc82a' : rd ? '#7adf4a' : rgba('#0c3a52', 0.2);
      ctx.fillRect(sx - 2, sy, 5, 5); ctx.fillStyle = on ? '#fff6a0' : rgba('#ffffff', 0.5); ctx.fillRect(sx - 1, sy + 1, 2, 1);
    }
    // texts
    const show = firstReady || q;
    const tx = r.x + 50, tw = r.w - 50 - 8;
    drawText(ctx, `${m.l.name.toUpperCase()}  ${Math.min(n, (m.tiers.indexOf(show) + 1))}/${n}`, tx, r.y + 6, { font: 'small', color: '#2f8fc8' });
    drawText(ctx, clip(show.title, tw - 80), tx, r.y + 15, { color: complete ? '#1f7a2c' : INK });
    const ml = wrapText(`"${show.text}"`, tw - 8, 'small');
    const mLH = lineHeight('small') + 2;
    ml.slice(0, 2).forEach((l, j) => drawText(ctx, j === 1 && ml.length > 2 ? clip(l + ' ' + ml.slice(2).join(' '), tw - 8, 'small') : l, tx, r.y + 27 + j * mLH, { font: 'small', color: INK_SOFT }));
    if (ml.length > 2 && ui.hover({ x: tx, y: r.y + 25, w: tw, h: 20 })) ui.tip = `${npcName(show.giver)}: "${show.text}"`;
    const o = book.objectives(show)[0];
    const by = r.y + r.h - 18;
    if (!complete) {
      drawText(ctx, clip(o.label, tw - 92, 'small'), tx, by - 2, { font: 'small', color: o.ok ? '#1f7a2c' : INK });
      if (!o.ok) {
        drawAeroBar(ctx, tx, by + 7, tw - 92, 5, o.have / Math.max(1, o.need), { color: '#5fd23a' });
      }
    } else drawText(ctx, 'Every tier reached!', tx, by + 1, { font: 'small', color: '#1f7a2c' });
    // right: reward chips + claim / progress numbers
    const rl = rewardList(show.reward);
    rewardChips(ctx, ui, rl.slice(0, 3), r.x + r.w - 86, r.y + 6, 84, t);
    const vis = by - 4 >= clipR.y && by + 16 <= clipR.y + clipR.h;
    if (firstReady) {
      drawAeroGlow(ctx, r.x + r.w - 46, by + 5, 50, '#fff6a0', 0.35 + 0.2 * Math.sin(t * 6 + i));
      if (vis && pill(ui, ctx, r.x + r.w - 84, by - 5, 78, 18, 'CLAIM!', { tone: 'green', icon: icon('star', 12), sound: 'ui_unlock', tip: 'Collect the reward' })) this.doClaim(firstReady, r.x + r.w - 46, by);
      else if (!vis) drawAeroButton(ctx, r.x + r.w - 84, by - 5, 78, 18, { label: 'CLAIM!', tone: 'green' });
    } else if (!complete) {
      drawText(ctx, `${fmtN(o.have)}/${fmtN(o.need)}`, r.x + r.w - 10, by - 1, { align: 'right', color: '#2f8fc8' });
    }
  }
}
const fmtN = (n) => (n >= 10000 ? Math.floor(n / 1000) + 'k' : Number(n).toLocaleString('en-US'));

// ------------------------------------------------------------------ chapter complete / chapter intro (panel 'chapter')
export class ChapterPanel {
  constructor() {
    this.id = 'chapter';
    this.modal = true;
    this.closeOnOutside = false;
    this.sound = 'unlock_biome';
    this.t = 0;
    this.mode = 'intro';
    this.cid = null;
    this.line = 0;
  }

  open(d = {}) {
    this.then = d.then || null;
    this.mode = d.mode || 'intro';
    this.cid = d.id || CHAPTERS[0].id;
    this.t = 0;
    this.line = 0;
    const g = this.game;
    if (this.mode === 'done') {
      g.audio?.play?.('catch_legendary', { vol: 0.5 });
      try { g.particles?.aeroConfetti?.(g.screen.W / 2, g.screen.H * 0.3, 60, { layer: 'ui' }); } catch { /* optional */ }
    }
  }

  close() {
    const S = ensureQuests(this.game.state);
    if (this.mode === 'done' && S.outro === this.cid) S.outro = null;
    if (this.mode === 'intro' && S.intro === this.cid) S.intro = null;
    this.game.save?.();
    if (this.then === 'quests') { this.then = null; setTimeout(() => { if (!this.ui.blocking) this.ui.open('quests', { noStory: true }); }, 0); }
  }

  next() {
    const g = this.game, S = ensureQuests(g.state);
    if (this.mode === 'done') {
      if (S.outro === this.cid) S.outro = null;
      if (S.intro && CHAPTER_BY_ID[S.intro]) { this.mode = 'intro'; this.cid = S.intro; this.t = 0; this.line = 0; g.audio.play('ui_page'); return; }
      this.ui.close(this.id);
      return;
    }
    const c = CHAPTER_BY_ID[this.cid];
    if (c && this.line < c.intro.length - 1) { this.line++; this.t = Math.min(this.t, 0.6); g.audio.play('ui_page'); return; }
    if (S.intro === this.cid) S.intro = null;
    g.audio.play('ui_unlock');
    this.ui.close(this.id);
  }

  draw(ctx, ui, dt) {
    const g = this.game, t = (this.t += dt);
    iconBudget(6);
    const W = g.screen.W, H = g.screen.H;
    const c = CHAPTER_BY_ID[this.cid];
    if (!c) { ui.close(this.id); return; }
    const w = Math.min(W - 40, 520), h = Math.min(H - 60, 330);
    const P = this.rect = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) - 10, w, h };
    const cx = P.x + w / 2;
    // a soft glow behind (no light rays)
    drawAeroGlow(ctx, cx, P.y + 70, 220, '#fff6c8', this.mode === 'done' ? 0.45 : 0.25);
    ctx.fillStyle = rgba('#021a38', 0.3); roundRectPath(ctx, P.x + 3, P.y + 5, w, h, 16); ctx.fill();
    ctx.drawImage(aeroSurface(w, h, { top: '#f4fdff', mid: '#cdeefc', bot: '#7fc8f0', a: [0.98, 0.98], edge: '#0b4f8f', r: 16, gloss: 0.5, glossH: 34, curve: 4, rim: 0.95, glow: 0.7, streak: true, bubbles: 5, sparkle: 3, seed: 51 }), P.x, P.y);
    drawLeafSprig(ctx, P.x + w - 6, P.y + 6, 'tr', 1);
    drawLeafSprig(ctx, P.x + 6, P.y + h - 6, 'bl', 1);
    // the ocean globe, big and turning, in a halo
    const gy = P.y + 64;
    for (let i = 0; i < 10; i++) { const k = (t * 0.4 + i / 10) % 1; drawAeroBubble(ctx, cx + Math.sin(i * 2.1 + t) * 60, gy + 40 - k * 80, 1.5 + k * 2, 1 - k); }
    drawAeroGlow(ctx, cx, gy, 54, '#ffffff', 0.6);
    const pop = this.mode === 'done' ? ease.outBack(clamp01(t / 0.6)) : 1;
    const globeKey = this.mode === 'done' ? 'biome:' + (CHAPTERS[c.n]?.ocean || c.ocean) : 'biome:' + c.ocean;
    drawAnimIcon(ctx, globeKey, cx, gy, Math.round(60 * pop), t, 0, { hover: 0.5 });
    if (this.mode === 'done') {
      title(ctx, `CHAPTER ${c.n} COMPLETE!`, cx, P.y + 104, 22, '#ffe25a', '#8a4a06', 'center');
      drawText(ctx, c.title, Math.round(cx - measureText(c.title) / 2), P.y + 134, { color: INK });
      // rewards pop in one by one
      const rl = rewardList(c.reward);
      const tw = 46, gap = 8, rw0 = rl.length * (tw + gap) - gap;
      rl.forEach((rw, i) => {
        const k = ease.outBack(clamp01((t - 0.5 - i * 0.18) / 0.4));
        if (k <= 0) return;
        const x = Math.round(cx - rw0 / 2 + i * (tw + gap)), y = P.y + 150;
        const s = Math.round(tw * k);
        if (s < 6) return;
        ctx.drawImage(aeroSurface(s, s, { tone: rw.big ? 'green' : 'white', r: 9, gloss: 0.7, glossH: Math.round(s * 0.4), curve: 2, rim: 0.9, glow: 0.6 }), Math.round(x + (tw - s) / 2), Math.round(y + (tw - s) / 2));
        rewardIcon(ctx, rw, x + tw / 2, y + tw / 2, 30 * k, t, i);
        const lab = rw.key === 'aero' ? String(rw.n) : rw.n ? 'x' + rw.n : '';
        if (lab) drawText(ctx, lab, Math.round(x + tw / 2 - measureText(lab, 'small') / 2), y + tw + 3, { font: 'small', color: INK });
        if (ui.hover({ x, y, w: tw, h: tw })) ui.tip = rw.label;
      });
      const nw = rl.find((r) => r.big);
      if (nw && t > 1.2) {
        const k = ease.outBack(clamp01((t - 1.2) / 0.5));
        const txt = nw.label.toUpperCase() + '!';
        const bw = measureText(txt) + 30;
        ctx.drawImage(aeroSurface(bw, 18, { tone: 'green', r: 'pill', gloss: 0.8, glossH: 8, curve: 1, rim: 0.8, glow: 0.7 }), Math.round(cx - bw / 2), Math.round(P.y + 212 + (1 - k) * 10));
        drawText(ctx, txt, Math.round(cx - bw / 2 + 15), Math.round(P.y + 217 + (1 - k) * 10), { color: '#ffffff', shadow: '#1c5a0e' });
      }
      // the outro line
      if (c.outro) this.say(ctx, c.outro.npc, c.outro.text, P, t > 1.6 ? 1 : 0);
      const btn = CHAPTERS[c.n] ? 'Next chapter' : 'Hooray!';
      if (pill(ui, ctx, cx - 60, P.y + h - 34, 120, 24, btn, { tone: 'green', icon: getUiIcon('play') || getUiIcon('check'), sound: 'ui_click' })) this.next();
      if (t < 2.5) for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + t; const d = 40 + t * 60; drawSparkle(ctx, cx + Math.cos(a) * d, gy + Math.sin(a) * d * 0.6, 2, clamp01(1 - t / 2.5), i % 2 ? '#fff6a0' : '#ffffff'); }
    } else {
      title(ctx, `CHAPTER ${c.n}`, cx, P.y + 100, 14, '#bff6ff', '#0a3a6e', 'center');
      title(ctx, c.title.toUpperCase(), cx, P.y + 116, 22, '#ffffff', '#0a3a6e', 'center');
      const L = c.intro[this.line] || c.intro[0];
      this.say(ctx, L.npc, L.text, P, 1, true);
      // the first quests, as a teaser
      const S2 = ensureQuests(g.state);
      const act = [...c.quests.filter((q) => !S2.done[q.id]), ...c.quests].slice(0, 3);
      act.forEach((q, i) => {
        const x = Math.round(cx - 150 + i * 102), y = P.y + 236;
        ctx.drawImage(aeroSurface(96, 24, { tone: 'white', r: 7, gloss: 0.6, glossH: 9, curve: 1, rim: 0.8, glow: 0.4 }), x, y);
        drawAnimIcon(ctx, (this.game.quests?.book?.objectives?.(q)[0]?.icon) || 'star', x + 11, y + 12, 14, t, i, {});
        drawText(ctx, q.title.length > 13 ? q.title.slice(0, 12) + '.' : q.title, x + 20, y + 9, { font: 'small', color: INK });
      });
      const last = this.line >= c.intro.length - 1;
      if (pill(ui, ctx, cx - 60, P.y + h - 34, 120, 24, last ? 'Let\'s go!' : 'Next', { tone: last ? 'green' : 'aqua', icon: getUiIcon('play') || getUiIcon('check'), sound: 'ui_click' })) this.next();
    }
    if (ui.inp.pressed && ui.hover(P)) ui.inp.pressed = false;
  }

  // an NPC portrait with a speech bubble (typewriter text)
  say(ctx, npc, text, P, k = 1, big = false) {
    if (k <= 0) return;
    const t = this.t;
    const x = P.x + 24, y = P.y + (big ? 150 : 236);
    const shown = text.slice(0, Math.floor(clamp01((t - (big ? 0.3 : 1.6)) * 1.4) * text.length + 1));
    drawPortrait(ctx, npc, x + 24, y + 26, 26, t, { talk: shown.length < text.length ? 0.7 : 0, mood: 'happy', key: 'chap' });
    const bw = P.w - 100, lines = wrapText(text, bw - 16);
    const bh = Math.max(36, lines.length * 10 + 18);
    ctx.drawImage(aeroSurface(bw, bh, { tone: 'white', r: 9, gloss: 0.5, glossH: 10, curve: 1, rim: 0.8, glow: 0.3 }), x + 58, y + 6);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(x + 58, y + 18); ctx.lineTo(x + 52, y + 24); ctx.lineTo(x + 58, y + 28); ctx.closePath(); ctx.fill();
    drawText(ctx, npcName(npc).toUpperCase(), x + 66, y + 10, { font: 'small', color: shade(NPC_COL[npc] || '#35c8ff', -0.4) });
    let n = shown.length;
    lines.forEach((l, i) => { if (n <= 0) return; drawText(ctx, l.slice(0, n), x + 66, y + 20 + i * 10, { color: INK }); n -= l.length + 1; });
  }
}

export function registerQuestPanels(ui) {
  ui.register(new QuestPanel());
  ui.register(new ChapterPanel());
}

void hash1; void AERO; void drawAeroBadge; void OK; void OCEAN_NAMES;
