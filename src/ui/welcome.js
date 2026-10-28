// "While you were away..." - offline earnings. A pinned letter with a little brass-framed tank where your
// fish swim over a growing pile of coins; the total rolls up, Collect sends the coins flying to the counter.
// Opened with ui.open('welcome') when game.pendingWelcome = {away (seconds), coins} exists.

import { clamp01, ease, lerp, formatCommas } from '../core/math.js';
import { drawText, measureText } from '../gfx/font.js';
import { drawWood, drawPaper, drawGlass } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { drawFishFit, fitScale } from './journal.js';

function fmtAway(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return mm ? `${h} h ${mm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ${h % 24} h`;
}

const QUIPS = ['Your fish kept the lights on.', 'Nobody touched your desktop. Probably.', 'The fish held a meeting. Coins were made.', 'Pinch says hi. And "click click".'];

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
    this.quip = QUIPS[Math.floor(Math.random() * QUIPS.length)];
    // swimmers: up to three fish from the tank, else a couple of friendly regulars
    const recs = (g.state.fish || []).filter((f) => f.inTank && SPECIES_BY_ID[f.species]).slice(0, 3);
    const list = recs.length ? recs.map((r) => ({ sp: SPECIES_BY_ID[r.species], variant: r.variant || null })) : ['pixel', 'loafer'].map((id) => SPECIES_BY_ID[id] || SPECIES[0]).filter(Boolean).map((sp) => ({ sp, variant: null }));
    this.fish = list.map((f, i) => ({ ...f, ph: i * 2.1, sp0: 0.5 + i * 0.17, y: 0.3 + i * 0.2 }));
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
    const W = 344, H = 250;
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) - 6, w: W, h: H };
    this.rect = r;
    drawWood(ctx, r.x, r.y, W, H, { tone: 'light' });
    drawPaper(ctx, r.x + 10, r.y + 10, W - 20, H - 48, { aged: true });
    // pin
    ctx.fillStyle = '#5a1010'; ctx.fillRect(r.x + W / 2 - 3, r.y + 7, 6, 6);
    ctx.fillStyle = '#d83a3a'; ctx.fillRect(r.x + W / 2 - 2, r.y + 8, 4, 4);
    ctx.fillStyle = '#ff9a8a'; ctx.fillRect(r.x + W / 2 - 2, r.y + 8, 2, 2);

    drawText(ctx, 'While you were away...', r.x + W / 2, r.y + 18, { align: 'center', scale: 2, color: '#3a2516', wave: 1, time: t * 0.6 });
    drawText(ctx, `You were gone for ${fmtAway(d.away || 0)}.`, r.x + W / 2, r.y + 38, { align: 'center', color: '#7a5a40' });

    // tank with the fish and the coin pile
    const tank = drawGlass(ctx, r.x + 24, r.y + 50, W - 48, 92, { tint: '#3ab0d8', frame: 'brass' });
    ctx.save();
    ctx.beginPath(); ctx.rect(tank.x, tank.y, tank.w, tank.h); ctx.clip();
    const grd = ctx.createLinearGradient(0, tank.y, 0, tank.y + tank.h);
    grd.addColorStop(0, '#7ad8f0'); grd.addColorStop(1, '#2a88b8');
    ctx.fillStyle = grd;
    ctx.fillRect(tank.x, tank.y, tank.w, tank.h);
    ctx.fillStyle = '#e8d098';
    for (let x = 0; x < tank.w; x += 2) ctx.fillRect(tank.x + x, tank.y + tank.h - 8 + Math.round(Math.sin(x * 0.09) * 1.5), 2, 9);
    // coin pile grows with the roll-up
    const coinK = clamp01((t - 0.3) / 1.4);
    const pile = Math.round(ease.outCubic(coinK) * Math.min(18, 4 + Math.log2(1 + (d.coins || 0)) * 1.6));
    const cb = getUiIcon('coin_big');
    const px = tank.x + tank.w / 2, py = tank.y + tank.h - 10;
    for (let i = 0; i < pile; i++) {
      const row = i < 6 ? 0 : i < 11 ? 1 : i < 15 ? 2 : 3;
      const idx = row === 0 ? i : row === 1 ? i - 6 : row === 2 ? i - 11 : i - 15;
      const n = [6, 5, 4, 3][row];
      ctx.drawImage(cb, Math.round(px - (n * 7) / 2 + idx * 7 + (row % 2) * 3), Math.round(py - row * 5 - 4));
    }
    this.coinAt = { x: px, y: py - 8 };
    // falling coins
    if (!this.collected && coinK < 1 && Math.random() < dt * 8) this.drops.push({ x: px + (Math.random() - 0.5) * 50, y: tank.y - 6, vy: 20 + Math.random() * 20, t: 0 });
    for (const c of this.drops) {
      c.t += dt; c.vy += 120 * dt; c.y += c.vy * dt;
      ctx.drawImage(getUiIcon('coin'), Math.round(c.x - 4), Math.round(c.y - 4));
    }
    this.drops = this.drops.filter((c) => c.y < py - 4);
    // happy fish
    for (const f of this.fish) {
      const u = Math.sin(t * f.sp0 + f.ph);
      const fx = tank.x + 30 + (tank.w - 60) * (0.5 + 0.5 * u);
      const dir = Math.cos(t * f.sp0 + f.ph) >= 0 ? 1 : -1;
      const fy = tank.y + 14 + (tank.h - 40) * f.y + Math.sin(t * 1.7 + f.ph) * 3;
      const s = fitScale(f.sp, 64, 32, 1.5);
      drawFishFit(ctx, f.sp, fx, fy, s, t + f.ph, { facing: dir, turn: 1, emotion: (t + f.ph) % 5 < 1.2 ? 'love' : 'happy', speed01: 0.6, blink: (t + f.ph) % 3.4 < 0.1 ? 1 : 0 }, f.variant);
      if (Math.random() < dt * 0.6) g.particles.bubble(fx + dir * 8, fy - 4, { layer: 'ui', life: 1.5, size: 1 });
    }
    // rising hearts
    for (let i = 0; i < 3; i++) {
      const k = ((t * 0.4 + i / 3) % 1);
      ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
      ctx.drawImage(getUiIcon('heart'), Math.round(tank.x + 24 + i * 90 + Math.sin(t * 2 + i) * 4), Math.round(tank.y + tank.h - 18 - k * 60));
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // rolling total
    const target = Math.round(d.coins || 0);
    const prev = this.shown;
    this.shown = Math.round(lerp(0, target, ease.outCubic(coinK)));
    if (this.shown !== prev && !this.collected) {
      this.tick -= dt;
      if (this.tick <= 0) { this.tick = 0.06; g.audio.play('coin_bounce', { vol: 0.25, pitch: 1 + coinK * 0.6 }); }
    }
    drawText(ctx, 'Your fish made', r.x + W / 2, r.y + 150, { align: 'center', color: '#7a5a40' });
    const num = formatCommas(this.shown);
    const nw = measureText(num, 'normal', 2) + 22;
    const nx = Math.round(r.x + W / 2 - nw / 2);
    const bump = coinK >= 1 && t < 2.1 ? Math.round(Math.sin((t - 1.7) * 20) * 1) : 0;
    drawText(ctx, num, nx, r.y + 161 - bump, { scale: 2, color: '#2a6a3a', shadow: '#c8e8b8' });
    const cb2 = getUiIcon('coin_big');
    ctx.drawImage(cb2, nx + nw - cb2.width, r.y + 163 - bump);
    drawText(ctx, this.quip, r.x + W / 2, r.y + 180, { align: 'center', font: 'small', color: '#9a7a5a' });
    if (g.stats?.offlineMul > 0.35) drawText(ctx, 'Treasure Currents bonus included!', r.x + W / 2, r.y + 189, { align: 'center', font: 'small', color: '#3a7aa8' });

    // collect
    const bw = Math.max(150, measureText(`Collect ${formatCommas(target)}`) + 50);
    const bx = Math.round(r.x + W / 2 - bw / 2), by = r.y + H - 33;
    const pulse = !this.collected && coinK >= 1 ? Math.round(Math.sin(t * 5) * 1) : 0;
    if (ui.button(ctx, bx, by - pulse, bw, 24, this.collected ? 'Collected!' : `Collect ${formatCommas(target)}{coin}`, { style: 'coral', disabled: this.collected, sound: 'ui_buy' }) || (g.input.keyPressed('Enter') && !this.collected)) {
      this.collect();
      ui.close(this.id);
    }
  }
}
