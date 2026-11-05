// Quest UI (phase 6, OWNER: Lab+Quests agent): the HUD quest tracker, the "QUEST COMPLETE!" banner, the big glossy
// Quest Log (panel 'quests', key Q) and the chapter celebration / chapter intro (panel 'chapter').
//   installQuests(game) -> game.quests = {book, update(dt, inp|null), hit(x, y), drawHud(ctx, dt), open(), readyCount(), rect}
//     The tracker draws in game.hud.questSlot() (top left; falls back to under the location chip) once the
//     tutorial is done. Clicking it opens the Quest Log (or a pending chapter intro).
//   registerQuestPanels(ui)  registers 'quests' and 'chapter'
//   drawPortrait(ctx, npcId, cx, cy, r, t, {mood, talk})  an NPC head in a glossy glass bubble
import { clamp, clamp01, damp, ease, TAU, hash1 } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { alagardReady, alagardBitmap, loadAlagard } from '../gfx/alagard.js';
import * as NPC from '../gfx/npcs.js';
import * as CHAR from '../gfx/character.js';
import { aeroSurface, aeroCached, drawAeroGlow, drawAeroBubble, drawSparkle, drawAeroCoin, drawAeroBar, drawLeafSprig, drawAeroBadge, AERO } from './aero.js';
import { icon, pill, iconBudget, INK, INK_SOFT, OK } from './labkit.js';
import { drawAnimIcon, drawPadlock } from './labrows.js';
import { drawRays, roundRectPath } from './labart.js';
import { CHAPTERS, CHAPTER_BY_ID, QUEST_BY_ID, NPC_NAMES, QuestBook, ensureQuests, rewardList } from '../game/quests.js';
import { OCEAN_NAMES } from '../game/lab.js';

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

// ------------------------------------------------------------------ the HUD tracker + banners
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
    try { loadAlagard(); } catch { /* fallback font */ }
    game.on?.('questDone', (d) => {
      const q = QUEST_BY_ID[d.id];
      if (!q) return;
      this.flash[q.id] = 0;
      const lines = CHEERS[q.giver] || CHEERS.seal;
      this.banners.push({ q, t: 0, line: lines[Math.floor(Math.random() * lines.length)], rw: rewardList(q.reward), bonus: d.bonus });
      game.audio?.play?.('ui_unlock');
      setTimeout(() => game.audio?.play?.('sparkle', { vol: 0.5 }), 180);
      const W = game.screen?.W || 960;
      try { game.particles?.aeroConfetti?.(W / 2, 40, 24, { layer: 'ui' }); } catch { /* optional */ }
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

  open() {
    const ui = this.game.ui;
    const S = ensureQuests(this.game.state);
    if ((S.outro || S.intro) && ui.panels.chapter) ui.open('chapter', S.outro ? { mode: 'done', id: S.outro } : { mode: 'intro', id: S.intro });
    else if (ui.panels.quests) ui.open('quests');
  }

  update(dt, inp) {
    const g = this.game;
    this.t += dt;
    this.book.update(dt);
    for (const id in this.flash) { this.flash[id] += dt; if (this.flash[id] > 2.4) delete this.flash[id]; }
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < 4.6);
    if (this.banners.length > 1 && this.banners[0].t > 2.2) this.banners.shift();
    this.hov = damp(this.hov, inp && this.rect && inp.x >= this.rect.x && inp.y >= this.rect.y && inp.x < this.rect.x + this.rect.w && inp.y < this.rect.y + this.rect.h ? 1 : 0, 14, dt);
    if (inp && this.rect && inp.pressed && this.hit(inp.x, inp.y)) {
      inp.pressed = false;
      inp.consume?.();
      g.audio?.play?.('ui_click');
      this.open();
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
    const g = this.game, t = this.t;
    this.rect = null;
    if (!g.ui?.isOpen?.('lab')) iconBudget(2);
    const s = this.slot();
    const S = ensureQuests(g.state);
    if (s && !g.ui?.blocking) this.drawTracker(ctx, s, S);
    this.drawBanners(ctx);
    void dt;
  }

  drawTracker(ctx, s, S) {
    const g = this.game, t = this.t, book = this.book;
    const ch = book.chapter();
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (s.a ?? 1);
    const k = clamp(s.w / 168, 0.8, 2);
    const big = k >= 1.3;
    const fT = big ? 'big' : 'normal', fS = big ? 'normal' : 'small', capT = big ? 9 : 7, capS = big ? 7 : 5;
    const w = Math.round(s.w);
    const act = book.active().slice(0, 3);
    const flashIds = Object.keys(this.flash).filter((id) => QUEST_BY_ID[id]);
    const rows = [...flashIds.map((id) => QUEST_BY_ID[id]).filter((q) => !act.includes(q)), ...act].slice(0, 3);
    const RHt = capT + capS + 16, HH = capS + 11;
    const pending = !!(S.outro || S.intro);
    const pendH = pending ? capS + 10 : 0;
    const h = Math.min(Math.round(s.h), HH + Math.max(1, rows.length) * RHt + 4 + pendH);
    const r = this.rect = { x: Math.round(s.x), y: Math.round(s.y), w, h };
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
      // the objective icon in a little glass bubble
      const ir = Math.round((RHt - 8) / 2);
      ctx.drawImage(aeroSurface(ir * 2, ir * 2, { tone: done ? 'green' : 'white', r: 'pill', gloss: 0.7, glossH: ir, curve: 1, rim: 0.8, glow: 0.5 }), x, y + 2);
      drawAnimIcon(ctx, o.icon, x + ir, y + 2 + ir, Math.round(ir * 1.5), t, i * 1.3, {});
      const tx = x + ir * 2 + 5, tw = r.x + w - 6 - tx;
      let name = q.title;
      while (name.length > 3 && measureText(name, fT) > tw - 26) name = name.slice(0, -1);
      if (name !== q.title) name = name.slice(0, -1) + '.';
      drawText(ctx, name, tx, y + 3, { font: fT, color: done ? '#1f7a2c' : INK, shadow: '#ffffff' });
      let lab = o.label;
      while (lab.length > 3 && measureText(lab, fS) > tw) lab = lab.slice(0, -1);
      if (lab !== o.label) lab = lab.slice(0, -1) + '.';
      drawText(ctx, lab, tx, y + 6 + capT, { font: fS, color: INK_SOFT });
      if (done) {
        const ck = getUiIcon('check');
        if (ck) ctx.drawImage(ck, r.x + w - ck.width - 7, y + 3);
      } else {
        if (o.need > 1) drawText(ctx, `${o.have}/${o.need}`, r.x + w - 7, y + 3 + (capT - capS), { font: fS, align: 'right', color: '#2f8fc8' });
        miniBar(ctx, tx, y + capT + capS + 9, Math.max(24, tw), 3, o.have / Math.max(1, o.need));
      }
      ctx.globalAlpha = a0 * (s.a ?? 1);
      y += RHt;
    });
    if (pending) {
      const pr = { x: r.x + 5, y: r.y + h - pendH - 3, w: w - 10, h: pendH };
      ctx.drawImage(aeroSurface(pr.w, pr.h, { tone: 'orange', r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.6 }), pr.x, pr.y);
      const txt = S.outro ? 'CHAPTER COMPLETE! CLICK' : 'NEW CHAPTER! CLICK';
      drawText(ctx, txt, Math.round(pr.x + pr.w / 2 - measureText(txt, 'small') / 2), pr.y + Math.round((pr.h - 5) / 2), { font: 'small', color: '#ffffff', shadow: '#843a04' });
      if ((t % 1) < 0.5) drawSparkle(ctx, pr.x + pr.w - 8, pr.y + 3, 2, 1);
    }
    if (this.hov > 0.5) this.game.ui.tip = 'Quest Log (Q)';
    ctx.globalAlpha = a0;
  }

  drawBanners(ctx) {
    const b = this.banners[0];
    if (!b) return;
    const g = this.game, t = this.t;
    const W = g.screen.W;
    const k = b.t < 0.4 ? ease.outBack(b.t / 0.4) : b.t > 3.9 ? 1 - ease.inCubic(clamp01((b.t - 3.9) / 0.6)) : 1;
    const w = 300, h = 66;
    const x = Math.round(W / 2 - w / 2), y = Math.round(-h + (h + 46) * k);
    drawAeroGlow(ctx, W / 2, y + h / 2, 160, '#fff6c8', 0.35 * k);
    drawRays(ctx, x + 36, y + h / 2, 70, t, 0.25 * k, 12);
    ctx.drawImage(aeroSurface(w, h, { top: '#fffbe0', mid: '#ffe08a', bot: '#ffb84a', a: [0.98, 0.98], edge: '#8a4a06', r: 12, gloss: 0.7, glossH: 22, curve: 3, rim: 0.95, glow: 0.7, glowColor: '#fff6c8', streak: true, bubbles: 3, sparkle: 2 }), x, y);
    drawLeafSprig(ctx, x + w - 4, y + 4, 'tr', 0.7);
    drawPortrait(ctx, b.q.giver, x + 32, y + h / 2, 24, t, { talk: b.t < 1.6 ? 0.6 : 0, mood: 'excited', key: 'banner' });
    title(ctx, 'QUEST COMPLETE!', x + 64, y + 4, 16, '#ffffff', '#8a4a06');
    drawText(ctx, b.q.title, x + 64, y + 26, { color: '#5a3206' });
    drawText(ctx, `"${b.line}"`, x + 64, y + 37, { font: 'small', color: '#8a5a1e' });
    rewardChips(ctx, g.ui, b.rw, x + 64, y + h - 20, w - 72, t);
    for (let i = 0; i < 6; i++) { const a = t * 2 + i; drawSparkle(ctx, x + 32 + Math.cos(a) * 30, y + h / 2 + Math.sin(a) * 26, 1, 0.7 * k); }
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
    open: () => hud.open(),
    // things waiting for the player (a chapter celebration or a new chapter's intro): the HUD's Quests badge
    readyCount: () => { const S = ensureQuests(game.state); return (S.outro ? 1 : 0) + (S.intro ? 1 : 0); },
    get rect() { return hud.rect; },
  };
}

// ------------------------------------------------------------------ the Quest Log (panel 'quests')
export class QuestPanel {
  constructor() {
    this.id = 'quests';
    this.modal = true;
    this.sound = 'ui_open';
    this.t = 0;
    this.sel = null;
    this.scroll = 0;
  }

  get book() { return this.game.quests?.book || (this._book ||= new QuestBook(this.game)); }

  open(d) {
    const S = ensureQuests(this.game.state);
    this.sel = d?.chapter || CHAPTERS[Math.min(S.ch, CHAPTERS.length - 1)]?.id;
    this.scroll = 0;
  }

  layout() {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    const w = Math.min(W - 24, 780), h = Math.min(H - 36, 470);
    return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) - 6, w, h };
  }

  draw(ctx, ui, dt) {
    const g = this.game, t = (this.t += dt), S = ensureQuests(g.state), book = this.book;
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
    title(ctx, 'QUESTS', ex + 30, hb.y + 4, 20, '#ffffff', '#1a5e12');
    const done = CHAPTERS.reduce((a, c) => a + c.quests.filter((q) => S.done[q.id]).length, 0), total = CHAPTERS.reduce((a, c) => a + c.quests.length, 0);
    drawText(ctx, `${done}/${total} QUESTS`, ex + 140, hb.y + 12, { font: 'small', color: '#ffffff', shadow: '#1a5e12' });
    drawAeroBar(ctx, ex + 200, hb.y + 11, 120, 7, done / total, { color: '#ffe25a' });
    if (pill(ui, ctx, hb.x + hb.w - 26, hb.y + 4, 22, 22, '', { tone: 'red', icon: getUiIcon('cross'), tip: 'Close (Esc)' })) ui.close(this.id);
    // a chapter celebration / intro is waiting: a glowing pill opens that story (then comes back here)
    if ((S.outro || S.intro) && ui.panels.chapter) {
      const txt = S.outro ? 'Chapter complete!' : 'New chapter!';
      const sw = measureText(txt) + 48, sx = hb.x + hb.w - 34 - sw, sy = hb.y + 4;
      drawAeroGlow(ctx, sx + sw / 2, sy + 11, sw * 0.6, '#fff6a0', 0.35 + 0.2 * Math.sin(t * 5));
      if (pill(ui, ctx, sx, sy, sw, 22, txt, { tone: 'orange', icon: icon('star', 14), tip: 'Hear the story', sound: 'ui_unlock' })) {
        ui.open('chapter', S.outro ? { mode: 'done', id: S.outro, then: 'quests' } : { mode: 'intro', id: S.intro, then: 'quests' });
        return;
      }
    }
    // chapter list (left)
    const lx = P.x + 10, ly = P.y + 42, lw = 178;
    CHAPTERS.forEach((c, i) => {
      const cy = ly + i * 58;
      if (cy + 54 > P.y + P.h - 8) return;
      const cur = i === S.ch, isDone = !!S.chDone[c.id], locked = i > S.ch, sel = this.sel === c.id;
      const r = { x: lx, y: cy, w: lw, h: 54 };
      const hov = ui.hover(r);
      const tone = sel ? { top: '#ffffff', mid: '#c8f0ff', bot: '#7fd0f4', edge: '#1f6ea8', a: [1, 1] } : locked ? 'grey' : isDone ? { top: '#f4ffe0', mid: '#c8f0a0', bot: '#8ad460', edge: '#2f7a1e', a: [1, 1] } : 'white';
      ctx.drawImage(aeroSurface(r.w, r.h, { tone, r: 9, gloss: 0.6, glossH: 16, curve: 2, rim: 0.9, glow: 0.5 }), r.x, r.y);
      if (hov && !sel) { ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = 1; roundRectPath(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 9); ctx.stroke(); }
      if (cur) drawAeroGlow(ctx, r.x + 26, r.y + 27, 26, '#fff6a0', 0.4 + 0.2 * Math.sin(t * 3));
      if (locked) { drawPadlock(ctx, r.x + 26, r.y + 29, 2, 0, Math.sin(t * 2 + i) * 0.1); }
      else drawAnimIcon(ctx, 'biome:' + c.ocean, r.x + 26, r.y + 27, 30, t, i, { hover: hov ? 0.6 : 0 });
      drawText(ctx, `CHAPTER ${c.n}`, r.x + 50, r.y + 9, { font: 'small', color: locked ? '#eef2f6' : '#2f8fc8', shadow: locked ? '#5a6a7c' : null });
      drawText(ctx, locked ? '???' : c.title, r.x + 50, r.y + 19, { color: locked ? '#ffffff' : INK, shadow: locked ? '#5a6a7c' : null });
      const n = c.quests.length, d = c.quests.filter((q) => S.done[q.id]).length;
      if (!locked) drawAeroBar(ctx, r.x + 50, r.y + 34, lw - 62, 6, d / n, { color: isDone ? '#5fd23a' : '#35c8ff' });
      if (!locked) drawText(ctx, `${d}/${n}`, r.x + lw - 10, r.y + 9, { font: 'small', align: 'right', color: INK_SOFT });
      if (isDone) { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, r.x + lw - 16, r.y + 38); }
      if (ui.clicked(r)) { if (locked) { g.audio.play('ui_error'); g.toast?.('Finish the chapter before it first!', 'lock'); } else { this.sel = c.id; this.scroll = 0; g.audio.play('ui_page'); } }
    });
    // chapter page (right)
    const c = CHAPTER_BY_ID[this.sel] || CHAPTERS[0];
    const px = lx + lw + 10, py = P.y + 42, pw = P.x + P.w - 10 - px, ph = P.y + P.h - 10 - py;
    ctx.drawImage(aeroSurface(pw, ph, { top: '#2a8fe0', mid: '#1468c0', bot: '#0b4a90', a: [0.95, 0.96], edge: '#06305e', r: 10, gloss: 0.15, glossH: 20, rim: 0.5, glow: 0.4, glowColor: '#58c8ff', bubbles: 5, seed: 41 }), px, py);
    this.drawChapterPage(ctx, ui, c, { x: px, y: py, w: pw, h: ph });
    if (ui.inp.pressed && ui.hover(P)) ui.inp.pressed = false;
  }

  drawChapterPage(ctx, ui, c, R) {
    const g = this.game, t = this.t, S = ensureQuests(g.state), book = this.book;
    // banner: big giver portrait + the intro line + title
    const intro = c.intro[Math.floor(t / 6) % c.intro.length];
    drawRays(ctx, R.x + 40, R.y + 40, 90, t, 0.12, 12);
    drawPortrait(ctx, intro.npc, R.x + 40, R.y + 40, 30, t, { talk: (t % 6) < 2 ? 0.6 : 0, key: 'log' });
    title(ctx, `CHAPTER ${c.n}: ${c.title.toUpperCase()}`, R.x + 80, R.y + 8, 16, '#ffffff', '#0a3a6e');
    const bw = R.w - 92, lines = wrapText(intro.text, bw - 16).slice(0, 2);
    const bh = lines.length * 10 + 16;
    ctx.drawImage(aeroSurface(bw, bh, { tone: 'white', r: 8, gloss: 0.5, glossH: 8, curve: 1, rim: 0.8, glow: 0.3 }), R.x + 80, R.y + 30);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(R.x + 80, R.y + 40); ctx.lineTo(R.x + 74, R.y + 44); ctx.lineTo(R.x + 80, R.y + 48); ctx.closePath(); ctx.fill();
    drawText(ctx, npcName(intro.npc).toUpperCase(), R.x + 88, R.y + 34, { font: 'small', color: shade(NPC_COL[intro.npc] || '#35c8ff', -0.4) });
    lines.forEach((l, i) => drawText(ctx, l, R.x + 88, R.y + 43 + i * 10, { color: INK }));
    // quest cards (scrollable)
    const top = R.y + 84, bottom = R.y + R.h - 44;
    const CH = 50, gap = 4;
    const listH = c.quests.length * (CH + gap);
    const maxS = Math.max(0, listH - (bottom - top));
    if (ui.hover({ x: R.x, y: top, w: R.w, h: bottom - top }) && ui.inp.wheel) { this.scroll = clamp(this.scroll + ui.inp.wheel * 30, 0, maxS); ui.inp.wheel = 0; }
    this.scroll = clamp(this.scroll, 0, maxS);
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x + 2, top - 2, R.w - 4, bottom - top + 4); ctx.clip();
    const ci = CHAPTERS.indexOf(c);
    c.quests.forEach((q, i) => {
      const y = top + i * (CH + gap) - this.scroll;
      if (y > bottom || y + CH < top) return;
      const isDone = !!S.done[q.id], active = book.isActive(q.id) && ci === S.ch, locked = !isDone && !active;
      const r = { x: R.x + 8, y, w: R.w - 16, h: CH };
      const tone = isDone ? { top: '#f4ffe0', mid: '#d8f6b8', bot: '#a8e080', edge: '#2f7a1e', a: [0.97, 0.97] } : locked ? { top: '#dce8f0', mid: '#aec2d2', bot: '#8aa2b8', edge: '#4a6078', a: [0.9, 0.9] } : 'frost';
      ctx.drawImage(aeroSurface(r.w, r.h, { tone, r: 8, gloss: 0.5, glossH: 14, curve: 2, rim: 0.9, glow: 0.4 }), r.x, r.y);
      if (active) drawAeroGlow(ctx, r.x + 22, r.y + CH / 2, 22, '#fff6a0', 0.3 + 0.15 * Math.sin(t * 3 + i));
      if (locked) {
        drawPortrait(ctx, q.giver, r.x + 22, r.y + CH / 2, 15, t, { key: 'ql' + i });
        ctx.fillStyle = rgba('#aec2d2', 0.55); ctx.beginPath(); ctx.arc(r.x + 22, r.y + CH / 2, 15, 0, TAU); ctx.fill();
        drawPadlock(ctx, r.x + 32, r.y + CH / 2 + 10, 1.2, 0, 0);
        drawText(ctx, '???', r.x + 44, r.y + 10, { color: '#ffffff', shadow: '#4a6078' });
        drawText(ctx, `${npcName(q.giver)} has something for you later...`, r.x + 44, r.y + 24, { font: 'small', color: '#ffffff', shadow: '#4a6078' });
        return;
      }
      drawPortrait(ctx, q.giver, r.x + 22, r.y + CH / 2, 16, t, { key: 'ql' + i });
      drawText(ctx, q.title, r.x + 44, r.y + 6, { color: isDone ? '#1f7a2c' : INK });
      drawText(ctx, npcName(q.giver).toUpperCase(), r.x + 48 + measureText(q.title), r.y + 7, { font: 'small', color: shade(NPC_COL[q.giver] || '#35c8ff', -0.35) });
      drawText(ctx, `"${q.text}"`.slice(0, 64), r.x + 44, r.y + 17, { font: 'small', color: INK_SOFT });
      // objectives
      const objs = book.objectives(q);
      let ox = r.x + 44;
      objs.forEach((o, j) => {
        const oy = r.y + 28;
        drawAnimIcon(ctx, o.icon, ox + 6, oy + 7, 12, t, j + i, {});
        const lab = o.label;
        drawText(ctx, lab, ox + 15, oy + 1, { color: o.ok ? '#1f7a2c' : INK });
        const lw = measureText(lab);
        if (!o.ok) {
          drawAeroBar(ctx, ox + 15, oy + 11, Math.min(120, lw), 5, o.have / Math.max(1, o.need), { color: '#5fd23a' });
          if (o.need > 1) drawText(ctx, `${o.have}/${o.need}`, ox + 19 + Math.min(120, lw), oy + 10, { font: 'small', color: '#2f8fc8' });
        } else { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, ox + 17 + lw, oy - 1); }
        ox += lw + 40;
      });
      // rewards (right)
      const rl = rewardList(q.reward);
      const rwW = Math.min(150, rl.reduce((a, rw) => a + 21 + (rw.key === 'aero' ? measureText(String(rw.n), 'small') + 3 : rw.n ? measureText('x' + rw.n, 'small') + 3 : 0), 0));
      rewardChips(ctx, ui, rl, r.x + r.w - rwW - 6, r.y + 6, rwW + 4, t);
      if (isDone) {
        // a cute "DONE" stamp
        ctx.save(); ctx.translate(r.x + r.w - 40, r.y + CH - 14); ctx.rotate(-0.15);
        ctx.drawImage(aeroSurface(52, 15, { tone: 'green', r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.5 }), -26, -7);
        drawText(ctx, 'DONE!', -14, -3, { font: 'small', color: '#ffffff', shadow: '#1c5a0e' });
        ctx.restore();
      } else if (active) {
        ctx.drawImage(aeroSurface(48, 13, { tone: 'orange', r: 'pill', gloss: 0.7, glossH: 5, curve: 1, rim: 0.8, glow: 0.5 }), r.x + r.w - 54, r.y + CH - 17);
        drawText(ctx, 'ACTIVE', r.x + r.w - 47, r.y + CH - 13, { font: 'small', color: '#ffffff', shadow: '#843a04' });
      }
    });
    ctx.restore();
    if (maxS > 0) {
      const h = Math.max(16, (bottom - top) * ((bottom - top) / listH)), y = top + (bottom - top - h) * (this.scroll / maxS);
      ctx.fillStyle = rgba('#bff6ff', 0.8); roundRectPath(ctx, R.x + R.w - 6, y, 3, h, 1.5); ctx.fill();
    }
    // chapter reward strip
    const sy = R.y + R.h - 38;
    ctx.drawImage(aeroSurface(R.w - 16, 32, { top: '#fffbe0', mid: '#ffe08a', bot: '#ffb84a', a: [0.97, 0.97], edge: '#8a4a06', r: 8, gloss: 0.6, glossH: 12, curve: 2, rim: 0.9, glow: 0.5 }), R.x + 8, sy);
    drawText(ctx, S.chDone[c.id] ? 'CHAPTER REWARD - CLAIMED!' : 'CHAPTER REWARD', R.x + 16, sy + 5, { font: 'small', color: '#8a4a06' });
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
}

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
    // light show behind
    drawRays(ctx, cx, P.y + 70, Math.max(W, H) * 0.7, t, this.mode === 'done' ? 0.3 : 0.16, 20);
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
