// Catch reveal: a wooden plaque with the "catch photo" (a polaroid of your angler proudly holding
// the fish, developing in after a camera flash), the fish wiggling in its showcase, size, rarity,
// traits, NEW stamp, and keep / release.

import { clamp01, ease, lerp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { RARITY, rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { drawWood, drawPaper, drawStamp, drawFrame } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { drawCharacter } from '../gfx/character.js';
import { traitList, valueMultiplier } from '../fish/traits.js';
import { RELEASE_VALUE } from '../game/shopdata.js';
import { centerRect } from './ui.js';

const REACTIONS = ['surprised', 'scared', 'dizzy', 'angry', 'love', 'smug', 'sad', 'happy'];

const SKIES = {
  night: { sky: ['#0e1838', '#1a2a58', '#2a3e78'], sea: '#123a6a', deep: '#0a2244', sun: '#f0f4ff' },
  shallows: { sky: ['#4aa8e8', '#7ac8f4', '#b8e4fc'], sea: '#2a8ac8', deep: '#1a5a98', sun: '#fff2b0' },
  junkyard: { sky: ['#5a3a5a', '#a86a5a', '#e8a868'], sea: '#3a6a68', deep: '#24443e', sun: '#ffd08a' },
  abyss: { sky: ['#0a0e24', '#161c40', '#262c5a'], sea: '#0e2448', deep: '#081428', sun: '#d8e8ff' },
};

export class RevealPanel {
  constructor() {
    this.id = 'reveal';
    this.modal = true;
    this.closeOnOutside = false;
    this.sound = 'new_species';
  }

  open(data) {
    this.data = data;
    this.t = 0;
    this.c = compiled(data.sp.look, data.rec.variant, data.sp.id);
    this.emo = data.emotion && data.emotion !== 'neutral' ? data.emotion : rng.pick(REACTIONS);
    this.emoT = 0;
    this.sound = data.isNew ? 'new_species' : 'ui_open';
    this.stamped = false;
    this.clicked = false;
    const d = new Date(data.rec.caughtAt || Date.now());
    this.when = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  draw(ctx, ui, dt) {
    const g = this.game, d = this.data;
    this.t += dt;
    const W = 404, H = 262;
    const r = centerRect(g, W, H);
    this.rect = r;
    const rar = RARITY[d.sp.rarity] || RARITY.common;
    const pop = ease.outBack(clamp01(this.t * 4));
    ctx.save();
    const pcx = r.x + W / 2, pcy = r.y + H / 2;
    ctx.translate(pcx, pcy);
    ctx.scale(lerp(0.6, 1, pop), lerp(0.6, 1, pop));
    ctx.translate(-pcx, -pcy);
    // rarity glow rays behind the plaque
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + this.t * 0.35;
      ctx.fillStyle = rgba(rar.color, 0.07 + (d.sp.rarity === 'legendary' ? 0.06 : 0));
      ctx.beginPath();
      ctx.moveTo(pcx, pcy);
      ctx.lineTo(pcx + Math.cos(a - 0.1) * 320, pcy + Math.sin(a - 0.1) * 320);
      ctx.lineTo(pcx + Math.cos(a + 0.1) * 320, pcy + Math.sin(a + 0.1) * 320);
      ctx.fill();
    }
    ctx.restore();
    drawWood(ctx, r.x, r.y, W, H, { tone: 'light' });
    drawPaper(ctx, r.x + 10, r.y + 10, W - 20, H - 52, { aged: true });

    // ---- the catch photo (left)
    const px = r.x + 20, py = r.y + 18;
    this.drawPhoto(ctx, px, py, 156, 176);

    // ---- details (right column)
    const cx0 = px + 156 + 14, cw = r.x + W - 20 - cx0, ccx = cx0 + cw / 2;
    drawText(ctx, d.isNew ? 'NEW SPECIES!' : 'CAUGHT!', ccx, r.y + 18, { align: 'center', color: rar.dark, font: 'small' });
    const nameScale = measureText(d.sp.name, 'normal', 2) <= cw ? 2 : 1;
    drawText(ctx, d.sp.name, ccx, r.y + 28 + (nameScale === 1 ? 4 : 0), { align: 'center', scale: nameScale, color: '#2a1a10', wave: d.sp.rarity === 'legendary' ? 1 : 0, time: this.t });
    for (let i = 0; i < 5; i++) {
      const ic = getUiIcon(i < rar.stars ? 'star' : 'star_empty');
      if (ic) ctx.drawImage(ic, Math.round(ccx - 27 + i * 11), r.y + 48);
    }
    drawText(ctx, rar.name.toUpperCase(), ccx, r.y + 60, { align: 'center', font: 'small', color: rar.dark });
    // showcase: the fish big and wiggling with a funny reaction
    this.emoT += dt;
    if (this.emoT > 2.2) { this.emoT = 0; this.emo = rng.pick(REACTIONS); }
    const fx = cx0, fy0 = r.y + 70, fw = cw, fh = 66;
    drawFrame(ctx, fx, fy0, fw, fh, { style: d.sp.rarity === 'legendary' ? 'gold' : 'wood' });
    ctx.save();
    ctx.beginPath(); ctx.rect(fx + 4, fy0 + 4, fw - 8, fh - 8); ctx.clip();
    const bg = ctx.createLinearGradient(0, fy0 + 4, 0, fy0 + fh - 4);
    bg.addColorStop(0, '#8ae0f0'); bg.addColorStop(1, '#2a8ab8');
    ctx.fillStyle = bg; ctx.fillRect(fx + 4, fy0 + 4, fw - 8, fh - 8);
    const L = (this.c.L || d.sp.look.body?.len || 30) * 1.45 * (d.sp.look.kind === 'seahorse' ? 0.6 : 1);
    const sc = Math.min(2.2, Math.max(0.35, Math.min((fw - 44) / Math.max(12, L), (fh - 14) / Math.max(8, L * 0.55))));
    const k = ease.outBack(clamp01((this.t - 0.2) * 2.5));
    const fcy = fy0 + fh / 2 + Math.sin(this.t * 2) * 2;
    drawFishRig(ctx, this.c, {
      x: ccx, y: fcy, facing: 1, turn: 1, angle: Math.sin(this.t * 3) * 0.1, scale: sc * k, squash: Math.sin(this.t * 9) * 0.06 * (1 - clamp01(this.t)),
      swimPhase: (this.t * 0.9) % 1, tailPhase: (this.t * 2.2) % 1, finPhase: (this.t * 2.8) % 1, speed01: 0.5, inflate: 0,
      lookX: g.input.x, lookY: g.input.y, blink: (this.t % 3) < 0.1 ? 1 : 0, emotion: this.emo, mouth: Math.abs(Math.sin(this.t * 7)) * (this.emo === 'surprised' || this.emo === 'scared' ? 0.8 : 0.3), time: this.t,
      chain: d.sp.look.kind === 'chain' ? fakeChain(ccx, fcy, this.t, sc) : null,
    });
    if (d.rec.variant?.shiny && rng.chance(0.3)) g.particles.sparkle(ccx + rng.float(-50, 50), fcy + rng.float(-20, 20), '#fff6b0', { layer: 'ui' });
    ctx.restore();
    // stats
    const sy = fy0 + fh + 8;
    drawText(ctx, `{fish} ${d.rec.sizeCm} cm`, cx0 + 2, sy, { color: '#3a2a1a' });
    drawText(ctx, `${d.rec.weightKg} kg`, cx0 + 2, sy + 12, { color: '#6a5a4a' });
    drawText(ctx, `"${d.rec.name}"`, cx0 + cw - 2, sy, { align: 'right', color: '#3a2a1a' });
    drawText(ctx, `+${d.bonus}{coin}`, cx0 + cw - 2, sy + 12, { align: 'right', color: '#2a6a4a' });
    // traits (wrap inside the column)
    let tx = cx0 + 2, ty = sy + 27;
    for (const tr of traitList(d.rec)) {
      const w = measureText(tr.text) + 8;
      if (tx + w > cx0 + cw && tx > cx0 + 2) { tx = cx0 + 2; ty += 13; }
      ctx.fillStyle = rgba('#2a1a10', 0.75);
      ctx.fillRect(tx, ty, w, 11);
      drawText(ctx, tr.text, tx + 4, ty + 2, { color: tr.color });
      tx += w + 4;
    }
    if (d.record) drawText(ctx, 'NEW RECORD!', cx0 + cw - 2, ty + 15, { align: 'right', color: '#c83a2a', wave: 1, time: this.t });
    // NEW stamp slams onto the photo
    if (d.isNew && this.t > 0.9) {
      const st = clamp01((this.t - 0.9) * 5);
      if (!this.stamped && st >= 1) { this.stamped = true; g.audio.play('record'); g.camera.shake?.(2); }
      ctx.save();
      ctx.globalAlpha = st;
      drawStamp(ctx, px + 120, py + 22, 'NEW!', { color: '#d8283a', angle: -0.25, scale: lerp(2.2, 1, ease.outCubic(st)) });
      ctx.restore();
    }
    ctx.restore();
    // camera flash when the card appears
    if (!this.clicked) { this.clicked = true; g.audio.play('click', { vol: 0.6, pitch: 0.7 }); }
    if (this.t < 0.3) {
      ctx.fillStyle = rgba('#ffffff', (1 - this.t / 0.3) * 0.7);
      ctx.fillRect(r.x - 6, r.y - 6, W + 12, H + 12);
    }
    // buttons
    const by = r.y + H - 34;
    const full = g.tankCount() >= g.stats.tankCap;
    const relVal = Math.round((RELEASE_VALUE[d.sp.rarity] || 4) * valueMultiplier(d.rec));
    if (ui.button(ctx, r.x + 20, by, 150, 22, full ? 'Keep (bucket)' : 'Keep in Aquarium', { icon: 'tank', style: 'wood', tip: full ? 'Tank is full: kept in the holding bucket' : 'Your fish will make coins!' }) || g.input.keyPressed('Enter')) {
      g.keepFish(d.rec);
      this.done();
      return;
    }
    if (!d.tutorial && ui.button(ctx, r.x + W - 170, by, 150, 22, `Release +${relVal}{coin}`, { icon: 'heart', style: 'shell' })) {
      g.releaseFish(d.rec, pcx, pcy);
      this.done();
    }
  }

  // Polaroid of the angler holding the catch; develops from white after the flash.
  drawPhoto(ctx, x, y, w, h) {
    const g = this.game, d = this.data;
    const t = this.t;
    // shadow, frame, tape
    ctx.fillStyle = rgba('#2a1a10', 0.3); ctx.fillRect(x + 3, y + 4, w, h);
    ctx.fillStyle = '#cfc6b0'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#fbf8ef'; ctx.fillRect(x, y, w, h);
    const ix = x + 7, iy = y + 7, iw = w - 14, ih = h - 36;
    ctx.save();
    ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
    const bid = d.rec.biome || g.ocean?.biome?.id;
    const biome = (g.world?.night && bid !== 'abyss' ? SKIES.night : SKIES[bid]) || SKIES.shallows;
    const seaY = iy + ih - 26;
    for (let i = 0; i < seaY - iy; i++) {
      ctx.fillStyle = biome.sky[Math.min(2, Math.floor((i / (seaY - iy)) * 3))];
      ctx.fillRect(ix, iy + i, iw, 1);
    }
    // sun / moon and a cloud
    ctx.fillStyle = rgba(biome.sun, 0.9);
    ctx.fillRect(ix + iw - 30, iy + 12, 12, 12); ctx.fillRect(ix + iw - 32, iy + 14, 16, 8);
    ctx.fillStyle = rgba('#ffffff', 0.7);
    const cl = (t * 3) % (iw + 40);
    ctx.fillRect(Math.round(ix + cl - 30), iy + 26, 22, 3); ctx.fillRect(Math.round(ix + cl - 24), iy + 23, 10, 3);
    // sea with sparkles
    ctx.fillStyle = biome.sea; ctx.fillRect(ix, seaY, iw, ih);
    ctx.fillStyle = biome.deep; ctx.fillRect(ix, seaY + 14, iw, ih);
    ctx.fillStyle = rgba('#ffffff', 0.55);
    for (let i = 0; i < iw; i += 9) ctx.fillRect(ix + ((i + Math.floor(t * 8)) % iw), seaY + 2 + ((i / 9) % 3) * 4, 3, 1);
    // the boat deck
    const deckY = seaY + 4;
    const paint = g.state?.character?.boat || '#c8583a';
    ctx.fillStyle = '#3a1a0e'; ctx.fillRect(ix + 8, deckY - 1, iw - 16, 12);
    ctx.fillStyle = paint; ctx.fillRect(ix + 9, deckY, iw - 18, 10);
    ctx.fillStyle = rgba('#ffffff', 0.3); ctx.fillRect(ix + 9, deckY, iw - 18, 1);
    ctx.fillStyle = '#a8784a'; ctx.fillRect(ix + 9, deckY - 3, iw - 18, 3);
    ctx.fillStyle = '#d8a870'; ctx.fillRect(ix + 9, deckY - 3, iw - 18, 1);
    // the angler holding the fish up
    const cxm = ix + iw / 2 - 4;
    try {
      drawCharacter(ctx, cxm, deckY - 2, {
        pose: 'hold', t, facing: 1, scale: 1.6, look: g.state?.character,
        fish: { compiled: this.c, variant: d.rec.variant, emotion: this.emo }, fishScale: 1.15,
      });
    } catch (e) {
      if (!this.charErr) { this.charErr = true; console.warn('drawCharacter failed', e); }
    }
    // little sparkles for shiny / rare catches
    if ((d.rec.variant?.shiny || d.sp.rarity === 'legendary' || d.sp.rarity === 'epic') && Math.sin(t * 5) > 0.6) {
      ctx.fillStyle = '#fff6c0';
      const sx = ix + 20 + ((t * 37) % (iw - 40)), sy = iy + 30 + ((t * 23) % 40);
      ctx.fillRect(Math.round(sx), Math.round(sy) - 2, 1, 5); ctx.fillRect(Math.round(sx) - 2, Math.round(sy), 5, 1);
    }
    // develop: white -> image
    const dev = clamp01((t - 0.2) / 0.9);
    if (dev < 1) {
      ctx.fillStyle = rgba('#fbf8ef', 1 - ease.inOutCubic(dev));
      ctx.fillRect(ix, iy, iw, ih);
    }
    ctx.restore();
    // inner edge
    ctx.fillStyle = rgba('#2a1a10', 0.25); ctx.fillRect(ix, iy, iw, 1); ctx.fillRect(ix, iy, 1, ih);
    // caption, handwritten-ish
    const cap = `me & ${d.rec.name}!`;
    drawText(ctx, cap, x + w / 2, y + h - 25, { align: 'center', color: '#2a3a6a' });
    drawText(ctx, `${(d.rec.biome || g.ocean?.biome?.id || '').toUpperCase()}  ${this.when}`, x + w / 2, y + h - 13, { align: 'center', font: 'small', color: '#7a7a9a' });
    // tape strips
    ctx.fillStyle = rgba('#f0e2b0', 0.75);
    ctx.fillRect(x - 6, y - 3, 22, 8); ctx.fillRect(x + w - 16, y - 3, 22, 8);
    ctx.fillStyle = rgba('#ffffff', 0.35);
    ctx.fillRect(x - 6, y - 3, 22, 2); ctx.fillRect(x + w - 16, y - 3, 22, 2);
  }

  done() {
    this.stamped = false;
    this.ui.close('reveal');
    this.game.emit('revealDone', this.data);
  }
}

function fakeChain(x, y, t, sc) {
  const pts = [];
  for (let i = 0; i < 22; i++) pts.push({ x: x + 30 * sc - i * 3.2 * sc, y: y + Math.sin(t * 3 - i * 0.5) * 6 * sc });
  return pts;
}
