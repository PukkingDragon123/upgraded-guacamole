// Package unboxing ('package'): open({uid} | {tier}). A spotlit stage: the crate bobs, shakes harder and harder
// (light leaking from the seams), the lid bursts off with a flash, and the loot flies out into face-down cards
// that flip one by one with a rarity reveal (colour burst, sparkles, a sound per rarity). Collect / Open next.

import { clamp, clamp01, lerp, ease, TAU, formatCommas } from '../core/math.js';
import { rgba, RARITY, RARITY_ORDER, mix, shade } from '../core/color.js';
import { rng } from '../core/rng.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPlank } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { ITEMS, TIERS, TIER_ORDER, openPackage, grantLoot, inventory } from '../build/items.js';
import { packageParts } from '../build/itemart.js';
import { drawItem } from '../build/itemdraw.js';

const REVEAL_SFX = { common: 'ui_click', uncommon: 'timing_good', rare: 'sparkle', epic: 'magic', legendary: 'golden_shimmer' };

export class PackagePanel {
  constructor() {
    this.id = 'package';
    this.modal = true;
    this.closeOnOutside = false;
    this.sound = 'box_open';
    this.t = 0;
  }

  open(data) {
    const st = this.game.state;
    const inv = inventory(st);
    let pkg = null;
    if (data?.uid) pkg = inv.packages.find((p) => p.uid === data.uid);
    if (!pkg && data?.tier) pkg = inv.packages.find((p) => p.tier === data.tier);
    if (!pkg) pkg = inv.packages[0] || null;
    this.pkg = pkg;
    this.phase = pkg ? 'idle' : 'empty';
    this.pt = 0;
    this.t = 0;
    this.loot = null;
    this.cards = [];
    this.lid = null;
    this.flash = 0;
    this.shake = 0;
    this.confetti = [];
  }

  begin() {
    if (this.phase !== 'idle') return;
    this.phase = 'shake';
    this.pt = 0;
    this.game.audio.play('reel', { vol: 0.4, pitch: 0.7 });
  }

  burst() {
    const g = this.game, st = g.state;
    const inv = inventory(st);
    // remove the package and grant its loot straight away (closing early never loses items)
    inv.packages = inv.packages.filter((p) => p !== this.pkg);
    this.loot = openPackage(this.pkg);
    grantLoot(g, this.loot);
    g.save?.();
    this.phase = 'reveal';
    this.pt = 0;
    this.flash = 1;
    const T = TIERS[this.pkg.tier];
    this.lid = { x: 0, y: 0, vx: rng.float(-40, 40), vy: -260, rot: 0, vr: rng.float(-6, 6) };
    for (let i = 0; i < 90; i++) {
      const a = rng.float(0, TAU), sp = rng.float(60, 260);
      this.confetti.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, c: rng.pick([T.color, T.glow, '#ffffff', '#ffd25a', '#9af0ff', '#ff9ac8']), life: rng.float(1, 2.4), t: 0, s: rng.pick([1, 2, 2, 3]) });
    }
    const best = Math.max(...this.loot.map((l) => RARITY_ORDER.indexOf(ITEMS[l.id]?.rarity || 'common')));
    g.audio.play('treasure_open');
    g.audio.play(best >= 4 ? 'catch_legendary' : best >= 3 ? 'catch_epic' : best >= 2 ? 'catch_rare' : 'catch', { vol: 0.7 });
    g.camera?.shake?.(5);
    this.cards = this.loot.map((l, i) => ({ ...l, i, t: -0.35 - i * 0.28, flipped: false, flipT: 0 }));
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    this.t += dt;
    this.pt += dt;
    const t = this.t;
    const W = g.screen.W, H = g.screen.H;
    const pw = Math.min(W - 40, 640), ph = Math.min(H - 60, 380);
    const r = { x: Math.round((W - pw) / 2), y: Math.round((H - ph) / 2) + 8, w: pw, h: ph };
    this.rect = r;
    // dark stage with vignette + spotlight
    const T = TIERS[this.pkg?.tier] || TIERS.crate;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    const bg = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h * 0.45, 10, r.x + r.w / 2, r.y + r.h * 0.45, r.w * 0.7);
    bg.addColorStop(0, mix(T.color, '#1a1030', 0.75)); bg.addColorStop(1, '#06040c');
    ctx.fillStyle = bg; ctx.fillRect(r.x, r.y, r.w, r.h);
    const cx = Math.round(r.x + r.w / 2), floor = Math.round(r.y + r.h * 0.56);
    // god rays behind the crate (spin faster as it opens)
    ctx.globalCompositeOperation = 'lighter';
    const spin = this.phase === 'reveal' ? 1.4 : this.phase === 'shake' ? 0.6 + this.pt : 0.25;
    const rayA = this.phase === 'reveal' ? 0.12 : 0.05 + (this.phase === 'shake' ? this.pt * 0.06 : 0);
    for (let k = 0; k < 12; k++) {
      const a = t * spin + (k / 12) * TAU;
      ctx.fillStyle = rgba(T.glow, rayA);
      ctx.beginPath(); ctx.moveTo(cx, floor - 30);
      ctx.lineTo(cx + Math.cos(a - 0.09) * 500, floor - 30 + Math.sin(a - 0.09) * 500);
      ctx.lineTo(cx + Math.cos(a + 0.09) * 500, floor - 30 + Math.sin(a + 0.09) * 500);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // floor + rug
    ctx.fillStyle = '#1a1018'; ctx.fillRect(r.x, floor + 8, r.w, r.h);
    ctx.fillStyle = '#2a1a24';
    for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(cx - 90 + i * 4), floor + 6 + i, 180 - i * 8, 1);
    ctx.fillStyle = mix(T.color, '#3a1a2a', 0.5);
    ctx.fillRect(cx - 70, floor + 6, 140, 6);
    ctx.fillStyle = T.color; ctx.fillRect(cx - 70, floor + 6, 140, 1);
    // ---- crate
    if (this.phase !== 'empty') {
      const parts = packageParts(this.pkg.tier, 2.2, this.phase === 'idle' ? Math.floor(t * 3) % 16 : 0, true);
      let sx = 0, sy = 0, squash = 0;
      if (this.phase === 'idle') sy = Math.round(Math.sin(t * 2.4) * 3) - 2;
      if (this.phase === 'shake') {
        const k = clamp01(this.pt / 1.3);
        const amp = 1 + k * 5;
        sx = Math.round(Math.sin(t * (40 + k * 30)) * amp);
        sy = Math.round(-Math.abs(Math.sin(t * 13)) * k * 6);
        squash = Math.sin(t * 26) * k * 0.08;
        if (Math.floor(this.pt * 8) !== this.lastTick) { this.lastTick = Math.floor(this.pt * 8); g.audio.play('click', { vol: 0.4, pitch: 0.8 + k * 1.2 }); }
        if (this.pt > 1.3) this.burst();
      }
      const dx = cx - parts.ox + sx, dy = floor - parts.oy + sy;
      if (parts.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7; ctx.drawImage(parts.glow, dx, dy); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      ctx.save();
      ctx.translate(cx + sx, floor + sy);
      ctx.scale(1 + squash, 1 - squash);
      ctx.translate(-(cx + sx), -(floor + sy));
      ctx.drawImage(parts.body, dx, dy);
      if (this.phase !== 'reveal') ctx.drawImage(parts.lid, dx, dy);
      ctx.restore();
      // light leaking from the seam while shaking
      if (this.phase === 'shake') {
        ctx.globalCompositeOperation = 'lighter';
        const k = clamp01(this.pt / 1.3);
        ctx.fillStyle = rgba(T.glow, 0.3 + k * 0.6);
        const ly = dy + parts.lidAt[1];
        ctx.fillRect(dx + 4, ly, parts.w - 8, 2);
        for (let i = 0; i < 6; i++) {
          const bx = dx + 6 + ((i * 37) % (parts.w - 12));
          ctx.fillStyle = rgba(T.glow, (0.15 + k * 0.3) * (0.5 + 0.5 * Math.sin(t * 20 + i)));
          ctx.fillRect(bx, ly - 30 * k, 2, 30 * k);
        }
        ctx.globalCompositeOperation = 'source-over';
        if (Math.random() < 0.5) g.particles?.sparkle(dx + rng.float(0, parts.w), ly, T.glow, { layer: 'ui' });
      }
      if (this.phase === 'reveal') {
        // the lid flies off
        const L = this.lid;
        L.vy += 520 * dt; L.x += L.vx * dt; L.y += L.vy * dt; L.rot += L.vr * dt;
        if (L.y < 400) {
          ctx.save();
          ctx.translate(cx + L.x, dy + parts.lidAt[1] + L.y);
          ctx.rotate(L.rot);
          ctx.drawImage(parts.lid, -parts.lidAt[0], -parts.lidAt[1]);
          ctx.restore();
        }
        // glow pouring out of the open crate
        ctx.globalCompositeOperation = 'lighter';
        const a = Math.max(0, 0.6 - this.pt * 0.15);
        ctx.fillStyle = rgba(T.glow, a);
        ctx.beginPath(); ctx.moveTo(dx + 10, dy + parts.lidAt[1]); ctx.lineTo(dx + parts.w - 10, dy + parts.lidAt[1]); ctx.lineTo(dx + parts.w + 30, dy - 80); ctx.lineTo(dx - 30, dy - 80); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // confetti
    for (const c of this.confetti) {
      c.t += dt; c.vy += 300 * dt; c.vx *= Math.exp(-1.2 * dt); c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.t > c.life) continue;
      ctx.globalAlpha = clamp01((c.life - c.t) * 2);
      ctx.fillStyle = c.c;
      ctx.fillRect(Math.round(cx + c.x), Math.round(floor - 30 + c.y), c.s, Math.max(1, c.s - (Math.floor(t * 10 + c.x) % 2)));
    }
    ctx.globalAlpha = 1;
    this.confetti = this.confetti.filter((c) => c.t < c.life);
    // ---- loot cards
    if (this.phase === 'reveal') this.drawCards(ctx, ui, r, cx, floor, t, dt);
    ctx.restore();
    // flash
    if (this.flash > 0) { ctx.fillStyle = rgba('#ffffff', this.flash); ctx.fillRect(r.x, r.y, r.w, r.h); this.flash = Math.max(0, this.flash - dt * 2.5); }
    // frame + title
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, 2); ctx.fillRect(r.x - 2, r.y + r.h, r.w + 4, 2); ctx.fillRect(r.x - 2, r.y, 2, r.h); ctx.fillRect(r.x + r.w, r.y, 2, r.h);
    ctx.fillStyle = T.color; ctx.fillRect(r.x, r.y, r.w, 1);
    const title = this.phase === 'empty' ? 'NO PACKAGES' : T.name.toUpperCase();
    drawPlank(ctx, r.x + r.w / 2 - 90, r.y - 16, 180, 22, { rope: 8, label: title });
    if (ui.button(ctx, r.x + r.w - 24, r.y + 6, 18, 18, '', { icon: 'cross', style: 'shell', tip: 'Close' })) { ui.close(this.id); return; }
    if (this.phase === 'empty') {
      drawText(ctx, 'Catch fish carrying crates to collect packages!', cx, r.y + r.h / 2, { align: 'center', color: '#e6d6c0' });
      return;
    }
    const from = this.pkg?.from;
    if (this.phase === 'idle') {
      const sp = from?.species ? SPECIES_BY_ID[from.species] : null;
      const who = sp ? `Carried by a ${sp.name}` : from?.starter ? 'A welcome gift from the sea' : from?.arcade ? 'Grabbed from the claw machine' : from?.blessing ? 'A blessing from the Totem' : '';
      if (who) drawText(ctx, who, cx, r.y + 18, { align: 'center', color: '#cdb89a' });
      const pulse = 0.6 + 0.4 * Math.sin(t * 5);
      drawText(ctx, 'CLICK TO OPEN!', cx, floor + 28, { align: 'center', color: rgba('#fff6c8', pulse), outline: '#1a0e08', scale: 2, wave: 1, time: t });
      drawText(ctx, T.desc, cx, floor + 52, { align: 'center', color: '#cdb89a' });
      if (inp.pressed && ui.hover(r)) { inp.pressed = false; this.begin(); }
    }
    if (this.phase === 'reveal') {
      const all = this.cards.every((c) => c.flipped && c.flipT > 0.3);
      if (inp.pressed && ui.hover(r) && !all) {
        // click to hurry the reveal along
        for (const c of this.cards) c.t = Math.max(c.t, 0.6);
      }
      if (all) {
        const left = inventory(st).packages.length;
        const bw = 110;
        if (ui.button(ctx, cx - (left ? bw + 4 : bw / 2), r.y + r.h - 30, bw, 22, 'Collect', { style: 'coral', icon: 'check' })) { ui.close(this.id); return; }
        if (left && ui.button(ctx, cx + 4, r.y + r.h - 30, bw, 22, `Open next (${left})`, { icon: 'star' })) { this.open({ tier: this.pkg.tier }); return; }
      }
    }
  }

  drawCards(ctx, ui, r, cx, floor, t, dt) {
    const n = this.cards.length;
    const cw = 76, ch = 96, gap = 8;
    const total = n * cw + (n - 1) * gap;
    const x0 = Math.round(cx - total / 2), y0 = Math.round(r.y + r.h - ch - 40);
    const g = this.game;
    for (const c of this.cards) {
      c.t += dt;
      if (c.t < 0) continue;
      const tx = x0 + c.i * (cw + gap), ty = y0;
      const fly = clamp01(c.t / 0.55);
      const e = ease.outCubic(fly);
      const sx = cx - cw / 2, sy = floor - 60;
      const x = Math.round(lerp(sx, tx, e)), y = Math.round(lerp(sy, ty, e) - Math.sin(fly * Math.PI) * 80);
      const sc = lerp(0.3, 1, e);
      if (fly >= 1 && !c.flipped && c.t > 0.75) {
        c.flipped = true;
        const rar = ITEMS[c.id]?.rarity || 'common';
        g.audio.play(REVEAL_SFX[rar] || 'ui_click', { vol: 0.7 });
        const R = RARITY[rar];
        for (let k = 0; k < 6 + RARITY_ORDER.indexOf(rar) * 5; k++) g.particles?.sparkle(tx + rng.float(0, cw), ty + rng.float(0, ch), R.color, { layer: 'ui' });
        if (RARITY_ORDER.indexOf(rar) >= 3) g.camera?.shake?.(3);
      }
      if (c.flipped) c.flipT += dt;
      // card flip: scaleX goes 1 -> 0 (back) then 0 -> 1 (front)
      const fk = c.flipped ? clamp01(c.flipT / 0.3) : 0;
      const showFront = c.flipped && fk > 0.5;
      const sxk = c.flipped ? Math.abs(Math.cos(fk * Math.PI)) : 1;
      const w = Math.max(1, Math.round(cw * sc * sxk)), h = Math.round(ch * sc);
      const dx = Math.round(x + (cw * sc - w) / 2 + (cw - cw * sc) / 2), dy = y + Math.round((ch - h) / 2);
      if (!showFront) this.drawBack(ctx, dx, dy, w, h, t);
      else this.drawFront(ctx, ui, c, dx, dy, w, h, t);
    }
  }

  drawBack(ctx, x, y, w, h, t) {
    ctx.fillStyle = '#1a0e08'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#5a2a3a'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#7a3a4a';
    for (let yy = 3; yy < h - 3; yy += 4) for (let xx = (yy >> 2) % 2 ? 3 : 5; xx < w - 3; xx += 4) ctx.fillRect(x + xx, y + yy, 2, 2);
    ctx.fillStyle = '#e0a844'; ctx.fillRect(x + 2, y + 2, w - 4, 1); ctx.fillRect(x + 2, y + h - 3, w - 4, 1);
    if (w > 20) drawText(ctx, '?', x + w / 2, y + h / 2 - 7, { align: 'center', scale: 2, color: '#ffd25a', outline: '#3a0a1a' });
    void t;
  }

  drawFront(ctx, ui, c, x, y, w, h, t) {
    const it = ITEMS[c.id];
    const rar = it?.rarity || 'common';
    const R = RARITY[rar];
    const ri = RARITY_ORDER.indexOf(rar);
    const burst = clamp01(1 - (c.flipT - 0.15) * 2);
    if (burst > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(R.color, burst * 0.7);
      const e = Math.round((1 - burst) * 18);
      ctx.fillRect(x - e, y - e, w + e * 2, h + e * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (ri >= 3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(R.color, 0.2 + 0.1 * Math.sin(t * 4 + c.i));
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = '#100810'; ctx.fillRect(x, y, w, h);
    for (let yy = 1; yy < h - 1; yy += 2) { ctx.fillStyle = mix(mix(R.dark, '#1a0e1a', 0.4), '#0e0810', yy / h); ctx.fillRect(x + 1, y + yy, w - 2, 2); }
    ctx.fillStyle = R.color;
    ctx.fillRect(x + 1, y + 1, w - 2, 1); ctx.fillRect(x + 1, y + h - 2, w - 2, 1); ctx.fillRect(x + 1, y + 1, 1, h - 2); ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
    if (w < cwMin) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
    drawItem(this.game.ui ? ctx : ctx, c.id, Math.round(x + w / 2), y + 58, { box: [w - 10, 50], t: t * 1.4, spin: true, look: this.game.state.character });
    ctx.restore();
    const name = c.id === 'coins' ? `${formatCommas(c.qty)} Coins` : it?.name || c.id;
    const lines = wrapText(name, w - 6, 'small').slice(0, 2);
    lines.forEach((l, i) => drawText(ctx, l.toUpperCase(), x + w / 2, y + h - 26 + i * 7, { font: 'small', align: 'center', color: '#fff6e2' }));
    drawText(ctx, (c.id === 'coins' ? 'COINS' : R.name).toUpperCase(), x + w / 2, y + h - 10, { font: 'small', align: 'center', color: R.color });
    if (c.qty > 1 && c.id !== 'coins') drawText(ctx, 'x' + c.qty, x + w - 5, y + 5, { font: 'small', align: 'right', color: '#ffffff', outline: '#100810' });
    if (it?.kind === 'blueprint' && it.building) drawText(ctx, 'BUILDING!', x + w / 2, y + 5, { font: 'small', align: 'center', color: '#9af0ff', outline: '#100810' });
    if (ui.hover({ x, y, w, h })) ui.tip = `${name}${it?.desc ? ' - ' + it.desc : ''}`;
  }
}
const cwMin = 30;

void TIER_ORDER; void shade; void measureText; void getUiIcon; void drawWood; void clamp; void TAU;
