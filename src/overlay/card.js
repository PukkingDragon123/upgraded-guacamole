// Browser catch card (a compact cousin of the game's reveal plaque), the "page crumb" bait sprite,
// and small fish thumbnails for the popup's catch list.

import { clamp01, ease } from '../core/math.js';
import { RARITY, rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { drawWood, drawPaper, drawFrame, drawStamp } from '../ui/panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { spriteFromAscii } from '../gfx/pixel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { traitList } from '../fish/traits.js';

// A torn-off scrap of web page: paper, a blue link line and two grey text lines.
export const CRUMB = spriteFromAscii(`
.kkkkk...
kwwwwwkk.
kwccccwwk
kwwwwwwwk
kwddwdddk
kwwwwwwk.
.kdddwwk.
..kwwkk..
...kk....
`, { k: '#2a2436', w: '#fbf7ee', c: '#3a7ae0', d: '#9aa2b4' });

export const CARD_W = 206, CARD_H = 140;
export const CARD_LIFE = 6.5;

// Scale that fits the species sprite into a boxW x boxH window.
function fitScale(sp, boxW, boxH) {
  const b = sp.look.body || {};
  const len = (b.len || (sp.look.kind === 'chain' ? 60 : 30)) * (sp.look.kind === 'seahorse' ? 0.6 : 1);
  const h = (b.h || 20) * (sp.look.kind === 'seahorse' ? 1.8 : 1) + (sp.look.dorsal?.h || 4) + (sp.look.anal?.h || 3) + 6;
  return Math.min(1.8, Math.max(0.3, Math.min(boxW / Math.max(20, len * 1.35), boxH / Math.max(10, h))));
}

function fakeChain(x, y, t, sc) {
  const pts = [];
  for (let i = 0; i < 22; i++) pts.push({ x: x + 30 * sc - i * 3.2 * sc, y: y + Math.sin(t * 3 - i * 0.5) * 6 * sc });
  return pts;
}

function rigPose(sp, x, y, sc, t, emotion, look) {
  return {
    x, y, facing: 1, turn: 1, angle: Math.sin(t * 3) * 0.08, scale: sc, squash: 0,
    swimPhase: (t * 0.9) % 1, tailPhase: (t * 2.2) % 1, finPhase: (t * 2.8) % 1, speed01: 0.5, inflate: 0,
    lookX: look ? look[0] : null, lookY: look ? look[1] : null, blink: t % 3 < 0.1 ? 1 : 0, emotion,
    mouth: Math.abs(Math.sin(t * 7)) * 0.3, time: t,
    chain: sp.look.kind === 'chain' ? fakeChain(x, y, t, sc) : null,
  };
}

export function cardRect(card, W, H) {
  const k = card.t < 0.45 ? ease.outBack(clamp01(card.t / 0.45)) : 1;
  const out = card.t > CARD_LIFE - 0.35 ? ease.inBack(clamp01((card.t - (CARD_LIFE - 0.35)) / 0.35)) : 0;
  const x = Math.round(W - CARD_W - 10 + (1 - k) * (CARD_W + 20) + out * (CARD_W + 20));
  const y = Math.round(H - CARD_H - 12);
  return { x, y, w: CARD_W, h: CARD_H };
}

// card = { rec, sp, isNew, t, emotion, waiting }
export function drawCatchCard(ctx, card, W, H, cursor) {
  const r = cardRect(card, W, H);
  const { sp, rec } = card;
  const rar = RARITY[sp.rarity] || RARITY.common;
  const cx = r.x + r.w / 2;
  drawWood(ctx, r.x, r.y, r.w, r.h, { tone: 'light' });
  drawPaper(ctx, r.x + 6, r.y + 6, r.w - 12, r.h - 12, { aged: true });
  drawText(ctx, card.isNew ? 'NEW IN YOUR BROWSER!' : 'CAUGHT!', cx, r.y + 11, { align: 'center', font: 'small', color: rar.dark });
  drawText(ctx, sp.name, cx, r.y + 19, { align: 'center', color: '#2a1a10', wave: sp.rarity === 'legendary' ? 1 : 0, time: card.t });
  for (let i = 0; i < 5; i++) {
    const ic = getUiIcon(i < rar.stars ? 'star' : 'star_empty');
    ctx.drawImage(ic, Math.round(cx - 27 + i * 11), r.y + 29);
  }
  // the fish wiggling in a little framed window of water
  const fr = drawFrame(ctx, r.x + 14, r.y + 41, r.w - 28, 54, { style: sp.rarity === 'legendary' ? 'gold' : 'wood' });
  ctx.save();
  ctx.beginPath(); ctx.rect(fr.x, fr.y, fr.w, fr.h); ctx.clip();
  const bg = ctx.createLinearGradient(0, fr.y, 0, fr.y + fr.h);
  bg.addColorStop(0, '#8ae0f0'); bg.addColorStop(1, '#2a8ab8');
  ctx.fillStyle = bg; ctx.fillRect(fr.x, fr.y, fr.w, fr.h);
  const c = compiled(sp.look, rec.variant, sp.id);
  // constant scale (every new scale would rasterize the rig again); the fish pops in by jumping up instead
  const sc = fitScale(sp, fr.w * 0.62, fr.h - 4);
  const hop = (1 - ease.outBack(clamp01(card.t * 2.5))) * 14;
  drawFishRig(ctx, c, rigPose(sp, cx, fr.y + fr.h / 2 + Math.sin(card.t * 2) * 1.5 + hop, sc, card.t, card.emotion, cursor ? [cursor.x, cursor.y] : null));
  ctx.restore();
  const sy = r.y + 100;
  drawText(ctx, `{fish} ${rec.sizeCm} cm  ${rec.weightKg} kg`, r.x + 14, sy, { color: '#3a2a1a' });
  drawText(ctx, `"${rec.name}"`, r.x + r.w - 14, sy, { align: 'right', color: '#3a2a1a' });
  let tx = r.x + 14;
  for (const tr of traitList(rec).slice(0, 3)) {
    const w = measureText(tr.text) + 6;
    if (tx + w > r.x + r.w - 14) break;
    ctx.fillStyle = rgba('#2a1a10', 0.75);
    ctx.fillRect(tx, sy + 11, w, 10);
    drawText(ctx, tr.text, tx + 3, sy + 12, { color: tr.color });
    tx += w + 3;
  }
  drawText(ctx, card.waiting > 1 ? `SAVED - ${card.waiting} FISH WAITING FOR FISHTOP` : 'SAVED TO YOUR BROWSER BUCKET', cx, r.y + r.h - 12, { align: 'center', font: 'small', color: '#6a5a4a' });
  if (card.isNew && card.t > 0.5) {
    const st = clamp01((card.t - 0.5) * 5);
    ctx.save();
    ctx.globalAlpha = st;
    drawStamp(ctx, r.x + r.w - 34, r.y + 52, 'NEW!', { color: '#d8283a', angle: -0.25, scale: 1 + (1 - ease.outCubic(st)) * 1.2 });
    ctx.restore();
  }
  return r;
}

// Small transparent PNG of the fish (data URL) for the popup list. Drawn only from our own sprites.
export function renderThumb(sp, rec, w = 72, h = 40) {
  try {
    const cv = makeCanvas(w, h);
    const g = ctxOf(cv);
    const c = compiled(sp.look, rec.variant, sp.id);
    drawFishRig(g, c, rigPose(sp, w / 2, h / 2, fitScale(sp, w * 0.78, h - 4), 0.4, 'happy', null));
    return cv.toDataURL('image/png');
  } catch {
    return null;
  }
}
