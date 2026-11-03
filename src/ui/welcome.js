// "Welcome back!" - offline earnings (Frutiger Aero). A glass window with a round water bubble where your
// fish swim over a growing heap of Aero drops; the total rolls up and Collect sends the drops to the HUD pill.
// Opened with ui.open('welcome') when game.pendingWelcome = {away (seconds), coins} exists (coins = Aero).

import { clamp01, ease, lerp } from '../core/math.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon } from '../gfx/bigicons.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { drawFishFit, fitScale } from './journal.js';
import { aeroCached, aeroSurface, drawAeroFrame, drawAeroCoin, drawAeroBubble, drawAeroGlow, drawSparkle, fmtAero } from './aero.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

function fmtAway(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// round water window: clear glass ball with sky-to-deep water and a sandy floor
function tankTex(w, h) {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const body = aeroSurface(w, h, { top: '#bff0ff', mid: '#45b8ec', bot: '#1468b4', edge: '#0b4a8a', r: 18, gloss: 0, rim: 0.7, glow: 0.6, glowColor: '#9ff6ff', streak: true, bubbles: 4, seed: 9 });
  g.drawImage(body, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#f2dca0';
  for (let x = 0; x < w; x += 2) g.fillRect(x, h - 10 + Math.round(Math.sin(x * 0.07) * 2), 2, 12);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = 0; x < w; x += 2) g.fillRect(x, h - 10 + Math.round(Math.sin(x * 0.07) * 2), 2, 1);
  g.globalCompositeOperation = 'source-over';
  return c;
}

function glossTex(w, h) {
  return aeroSurface(w, h, { top: '#ffffff', mid: '#ffffff', bot: '#ffffff', a: [0, 0], edge: '#ffffff', edgeA: 0.9, r: 18, gloss: 0.6, glossH: Math.round(h * 0.4), curve: 8, rim: 0.6, glow: 0 });
}

export class WelcomePanel {
  constructor() {
    this.id = 'welcome';
    this.modal = true;
    this.closeOnOutside = false;
    this.sound = 'notify';
    this.t = 0;
  }

  open(data) {
    const g = this.game;
    this.data = data || g.pendingWelcome || { away: 0, coins: 0 };
    this.t = 0;
    this.collected = false;
    this.shown = 0;
    this.tick = 0;
    this.drops = [];
    const recs = (g.state.fish || []).filter((f) => f.inTank && SPECIES_BY_ID[f.species]).slice(0, 3);
    const list = recs.length ? recs.map((r) => ({ sp: SPECIES_BY_ID[r.species], variant: r.variant || null })) : ['pixel', 'loafer'].map((id) => SPECIES_BY_ID[id] || SPECIES[0]).filter(Boolean).map((sp) => ({ sp, variant: null }));
    this.fish = list.map((f, i) => ({ ...f, ph: i * 2.1, sp0: 0.5 + i * 0.17, y: 0.25 + i * 0.2 }));
  }

  close() {
    if (!this.collected) this.collect(true);
  }

  collect(silent = false) {
    const g = this.game;
    if (this.collected) return;
    this.collected = true;
    const n = Math.round(this.data.coins || 0);
    if (n > 0) {
      const at = this.coinAt || { x: g.screen.W / 2, y: g.screen.H / 2 };
      g.addCoins(n, at.x, at.y);
      if (!silent) g.audio.play('coins_many', { vol: 0.8 });
    }
    g.pendingWelcome = null;
    g.save?.();
  }

  draw(ctx, ui, dt) {
    const g = this.game, d = this.data;
    dt = Math.max(0, dt);
    this.t += dt;
    const t = this.t;
    const W = 320, H = 238;
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) - 8, w: W, h: H };
    this.rect = r;
    const F = drawAeroFrame(ctx, r.x, r.y, W, H, { title: 'Welcome back!', icon: getBigIcon('aquarium', { size: 'small' }).canvas, seed: 5 });
    // away time chip (top-right)
    const away = fmtAway(d.away || 0);
    const cw = measureText(away, 'small') + 22;
    ctx.drawImage(aeroCached(`awaychip|${cw}`, () => aeroSurface(cw, 13, { tone: 'white', r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.8, glow: 0.5 })), r.x + W - cw - 10, r.y + 10);
    ctx.drawImage(getUiIcon('clock'), r.x + W - cw - 7, r.y + 12);
    drawText(ctx, away, r.x + W - 14, r.y + 14, { align: 'right', font: 'small', color: '#0c3a52' });

    // the water bubble with fish and the drop heap
    const tank = { x: F.content.x + 6, y: F.content.y + 2, w: F.content.w - 12, h: 108 };
    ctx.drawImage(aeroCached(`wtank|${tank.w}|${tank.h}`, () => tankTex(tank.w, tank.h)), tank.x, tank.y);
    ctx.save();
    ctx.beginPath(); ctx.rect(tank.x + 3, tank.y + 3, tank.w - 6, tank.h - 6); ctx.clip();
    // light shafts
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 4; i++) {
      const bx = tank.x + 30 + i * 70 + Math.sin(t * 0.5 + i) * 6;
      ctx.beginPath(); ctx.moveTo(bx, tank.y); ctx.lineTo(bx + 16, tank.y); ctx.lineTo(bx - 14, tank.y + tank.h); ctx.lineTo(bx - 30, tank.y + tank.h); ctx.fill();
    }
    const coinK = clamp01((t - 0.3) / 1.4);
    const pile = Math.round(ease.outCubic(coinK) * Math.min(18, 4 + Math.log2(1 + (d.coins || 0)) * 1.6));
    const px = tank.x + tank.w / 2, py = tank.y + tank.h - 12;
    for (let i = 0; i < pile; i++) {
      const row = i < 6 ? 0 : i < 11 ? 1 : i < 15 ? 2 : 3;
      const idx = row === 0 ? i : row === 1 ? i - 6 : row === 2 ? i - 11 : i - 15;
      const n = [6, 5, 4, 3][row];
      drawAeroCoin(ctx, Math.round(px - (n * 9) / 2 + idx * 9 + (row % 2) * 4 + 4), Math.round(py - row * 6), 4.5, t + i * 0.3);
    }
    this.coinAt = { x: px, y: py - 8 };
    if (!this.collected && coinK < 1 && Math.random() < dt * 8) this.drops.push({ x: px + (Math.random() - 0.5) * 60, y: tank.y - 4, vy: 20 + Math.random() * 20 });
    for (const c of this.drops) { c.vy += 120 * dt; c.y += c.vy * dt; drawAeroCoin(ctx, c.x, c.y, 3.5, 0); }
    this.drops = this.drops.filter((c) => c.y < py - 4);
    for (const f of this.fish) {
      const u = Math.sin(t * f.sp0 + f.ph);
      const fx = tank.x + 34 + (tank.w - 68) * (0.5 + 0.5 * u);
      const dir = Math.cos(t * f.sp0 + f.ph) >= 0 ? 1 : -1;
      const fy = tank.y + 16 + (tank.h - 44) * f.y + Math.sin(t * 1.7 + f.ph) * 3;
      const s = fitScale(f.sp, 64, 30, 1.5);
      drawFishFit(ctx, f.sp, fx, fy, s, t + f.ph, { facing: dir, turn: 1, emotion: (t + f.ph) % 5 < 1.2 ? 'love' : 'happy', speed01: 0.6, blink: (t + f.ph) % 3.4 < 0.1 ? 1 : 0 }, f.variant);
      if (Math.random() < dt * 0.6) g.particles.bubble(fx + dir * 8, fy - 4, { layer: 'ui', life: 1.5, size: 1 });
    }
    for (let i = 0; i < 5; i++) {
      const k = (t * 0.25 + i / 5) % 1;
      drawAeroBubble(ctx, tank.x + 20 + i * 62 + Math.sin(t * 2 + i) * 3, tank.y + tank.h - 14 - k * (tank.h - 10), 1.5 + (i % 3), Math.sin(k * Math.PI));
    }
    ctx.restore();
    ctx.drawImage(aeroCached(`wtankg|${tank.w}|${tank.h}`, () => glossTex(tank.w, tank.h)), tank.x, tank.y);

    // rolling total
    const target = Math.round(d.coins || 0);
    const prev = this.shown;
    this.shown = Math.round(lerp(0, target, ease.outCubic(coinK)));
    if (this.shown !== prev && !this.collected) {
      this.tick -= dt;
      if (this.tick <= 0) { this.tick = 0.06; g.audio.play('coin_bounce', { vol: 0.25, pitch: 1 + coinK * 0.6 }); }
    }
    const num = '+' + fmtAero(this.shown);
    const nw = measureText(num, 'normal', 2) + 18;
    const nx = Math.round(r.x + W / 2 - nw / 2), ny = tank.y + tank.h + 8;
    const bump = coinK >= 1 && t < 2.1 ? Math.round(Math.sin((t - 1.7) * 20)) : 0;
    if (coinK >= 1) drawAeroGlow(ctx, r.x + W / 2, ny + 7, 46, '#c8fbff', 0.35 + 0.1 * Math.sin(t * 3));
    drawText(ctx, num, nx, ny - bump, { scale: 2, color: '#ffffff', shadow: '#0a3e74' });
    drawAeroCoin(ctx, nx + nw - 6, ny + 7 - bump, 6.5, t);
    if (coinK >= 1 && (t * 1.5) % 2 < 0.12) drawSparkle(ctx, nx + nw - 9, ny + 3, 2, 1);

    // collect
    const label = this.collected ? 'Collected!' : 'Collect';
    const bw = 132;
    const bx = Math.round(r.x + W / 2 - bw / 2), by = r.y + H - 32;
    const pulse = !this.collected && coinK >= 1 ? Math.round(Math.sin(t * 5)) : 0;
    if (ui.button(ctx, bx, by - pulse, bw, 22, label, { icon: this.collected ? 'check' : 'aero', style: 'green', disabled: this.collected, sound: 'ui_buy' }) || (g.input.keyPressed('Enter') && !this.collected)) {
      this.collect();
      ui.close(this.id);
    }
    F.finish();
  }
}
