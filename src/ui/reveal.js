// Catch reveal: wooden plaque with the fish wiggling big, size, rarity, traits, NEW stamp, keep / release.

import { clamp01, ease, lerp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { RARITY, rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { drawWood, drawPaper, drawStamp, drawFrame } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { traitList, valueMultiplier } from '../fish/traits.js';
import { RELEASE_VALUE } from '../game/shopdata.js';
import { centerRect } from './ui.js';

const REACTIONS = ['surprised', 'scared', 'dizzy', 'angry', 'love', 'smug', 'sad', 'happy'];

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
    this.stampT = data.isNew ? 0.9 : -1;
    this.sound = data.isNew ? 'new_species' : 'ui_open';
    this.decided = false;
  }

  draw(ctx, ui, dt) {
    const g = this.game, d = this.data;
    this.t += dt;
    const W = 330, H = 236;
    const r = centerRect(g, W, H);
    this.rect = r;
    const rar = RARITY[d.sp.rarity];
    // rarity glow rays behind the plaque
    const cx = r.x + W / 2, cy = r.y + 78;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.t * 0.4;
      ctx.fillStyle = rgba(rar.color, 0.07 + (d.sp.rarity === 'legendary' ? 0.06 : 0));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a - 0.1) * 260, cy + Math.sin(a - 0.1) * 260);
      ctx.lineTo(cx + Math.cos(a + 0.1) * 260, cy + Math.sin(a + 0.1) * 260);
      ctx.fill();
    }
    ctx.restore();
    drawWood(ctx, r.x, r.y, W, H, { tone: 'light' });
    drawPaper(ctx, r.x + 10, r.y + 10, W - 20, H - 52, { aged: true });
    // title
    drawText(ctx, d.isNew ? 'NEW SPECIES!' : 'CAUGHT!', cx, r.y + 16, { align: 'center', color: rar.dark, font: 'small' });
    drawText(ctx, d.sp.name, cx, r.y + 26, { align: 'center', scale: 2, color: '#2a1a10', wave: d.sp.rarity === 'legendary' ? 1 : 0, time: this.t });
    // stars
    const stars = rar.stars;
    for (let i = 0; i < 5; i++) {
      const ic = getUiIcon(i < stars ? 'star' : 'star_empty');
      if (ic) ctx.drawImage(ic, Math.round(cx - 27 + i * 11), r.y + 46);
    }
    drawText(ctx, rar.name.toUpperCase(), cx, r.y + 58, { align: 'center', font: 'small', color: rar.dark });
    // the fish, big and wiggling with a funny reaction
    this.emoT += dt;
    if (this.emoT > 2.2) { this.emoT = 0; this.emo = rng.pick(REACTIONS); }
    const len = (d.sp.look.body?.len || 30) * (d.sp.look.kind === 'seahorse' ? 0.6 : 1);
    const sc = Math.min(2.4, Math.max(0.6, 120 / Math.max(20, len * 1.35)));
    const k = ease.outBack(clamp01(this.t * 2.5));
    const fy = r.y + 102 + Math.sin(this.t * 2) * 2;
    drawFrame(ctx, r.x + 24, r.y + 66, W - 48, 76, { style: d.sp.rarity === 'legendary' ? 'gold' : 'wood' });
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x + 28, r.y + 70, W - 56, 68); ctx.clip();
    const bg = ctx.createLinearGradient(0, r.y + 70, 0, r.y + 138);
    bg.addColorStop(0, '#8ae0f0'); bg.addColorStop(1, '#2a8ab8');
    ctx.fillStyle = bg; ctx.fillRect(r.x + 28, r.y + 70, W - 56, 68);
    drawFishRig(ctx, this.c, {
      x: cx, y: fy, facing: 1, turn: 1, angle: Math.sin(this.t * 3) * 0.1, scale: sc * k, squash: Math.sin(this.t * 9) * 0.06 * (1 - clamp01(this.t)),
      swimPhase: (this.t * 0.9) % 1, tailPhase: (this.t * 2.2) % 1, finPhase: (this.t * 2.8) % 1, speed01: 0.5, inflate: 0,
      lookX: g.input.x, lookY: g.input.y, blink: (this.t % 3) < 0.1 ? 1 : 0, emotion: this.emo, mouth: Math.abs(Math.sin(this.t * 7)) * (this.emo === 'surprised' || this.emo === 'scared' ? 0.8 : 0.3), time: this.t,
      chain: d.sp.look.kind === 'chain' ? fakeChain(cx, fy, this.t, sc) : null,
    });
    if (d.rec.variant?.shiny && rng.chance(0.3)) g.particles.sparkle(cx + rng.float(-50, 50), fy + rng.float(-20, 20), '#fff6b0', { layer: 'ui' });
    ctx.restore();
    // stats
    const sy = r.y + 148;
    drawText(ctx, `{fish} ${d.rec.sizeCm} cm`, r.x + 30, sy, { color: '#3a2a1a' });
    drawText(ctx, `${d.rec.weightKg} kg`, r.x + 30, sy + 12, { color: '#6a5a4a' });
    drawText(ctx, `"${d.rec.name}"`, r.x + W - 30, sy, { align: 'right', color: '#3a2a1a' });
    drawText(ctx, `+${d.bonus}{coin}`, r.x + W - 30, sy + 12, { align: 'right', color: '#2a6a4a' });
    // traits
    let tx = r.x + 30;
    for (const tr of traitList(d.rec)) {
      const w = measureText(tr.text) + 8;
      ctx.fillStyle = rgba('#2a1a10', 0.75);
      ctx.fillRect(tx, sy + 26, w, 11);
      drawText(ctx, tr.text, tx + 4, sy + 28, { color: tr.color });
      tx += w + 4;
    }
    if (d.record) drawText(ctx, 'NEW RECORD!', r.x + W - 30, sy + 28, { align: 'right', color: '#c83a2a' });
    // stamp
    if (d.isNew && this.t > 0.6) {
      const st = clamp01((this.t - 0.6) * 5);
      if (!this.stamped && st >= 1) { this.stamped = true; g.audio.play('record'); g.camera.shake(2); }
      ctx.save();
      ctx.globalAlpha = st;
      drawStamp(ctx, r.x + W - 70, r.y + 80, 'NEW!', { color: '#d8283a', angle: -0.25, scale: lerp(2.2, 1, ease.outCubic(st)) });
      ctx.restore();
    }
    // buttons
    const by = r.y + H - 34;
    const full = g.tankCount() >= g.stats.tankCap;
    const relVal = Math.round((RELEASE_VALUE[d.sp.rarity] || 4) * valueMultiplier(d.rec));
    if (ui.button(ctx, r.x + 20, by, 140, 22, full ? 'Keep (bucket)' : 'Keep in Aquarium', { icon: 'tank', style: 'wood', tip: full ? 'Tank is full: kept in the holding bucket' : 'Your fish will make coins!' }) || g.input.keyPressed('Enter')) {
      g.keepFish(d.rec);
      this.done();
    }
    if (!d.tutorial && ui.button(ctx, r.x + W - 160, by, 140, 22, `Release +${relVal}{coin}`, { icon: 'heart', style: 'shell' })) {
      g.releaseFish(d.rec, cx, cy);
      this.done();
    }
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
