// Special bait desktop effects: glowing worms on icons, golden glitter, flood, black hole pull,
// lantern light, ancient relic summoning, overclocked sparks and pop-up ads. All purely visual & reversible.

import { TAU, clamp, clamp01, lerp, dist, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { baitSprite } from './baitart.js';
import { SPECIES } from '../fish/species.js';

export class BaitEffects {
  constructor(game) {
    this.game = game;
    this.worms = [];
    this.ads = [];
    this.hole = 0; // black hole strength 0..1
    this.t = 0;
    this.relicT = 0;
  }

  bait() {
    const b = this.game.currentBait();
    return b?.kind === 'special' ? b.type : null;
  }

  onEquip(b) {
    this.worms = [];
    this.relicT = 0;
  }

  rarityMul() { return this.bait() === 'golden' ? 1.5 : this.bait() === 'blackhole' ? 1.3 : 1; }
  populationMul() {
    const b = this.bait();
    return b === 'flood' ? 1.5 : b === 'worm' ? 1.25 : b === 'blackhole' ? 1.35 : b === 'popup' ? 1.3 : 1;
  }

  update(dt) {
    const g = this.game, type = this.bait(), h = g.fishing.hook;
    this.t += dt;
    const active = g.state.view === 'ocean' && g.ocean.reveal >= 1 && !g.mini;
    // flood
    g.ocean.floodTarget = active && type === 'flood' ? 1 : 0;
    for (const ic of g.desktop.icons) ic.bob = g.ocean.flood > 0.3 ? 1.5 * g.ocean.flood : 0;
    // worms crawl around icon edges
    if (active && type === 'worm') {
      const icons = g.desktop.iconRects();
      while (this.worms.length < Math.min(4, icons.length)) {
        const r = rng.pick(icons);
        this.worms.push({ r, p: rng.next() * (2 * (r.w + r.h)), sp: rng.float(8, 16), ph: rng.next() });
      }
      for (const w of this.worms) {
        w.p += w.sp * dt;
        w.ph += dt * 4;
        if (rng.chance(dt * 0.05)) w.r = rng.pick(icons);
      }
    } else this.worms.length = 0;
    // black hole pulls icons toward the hook
    this.hole = damp(this.hole, active && type === 'blackhole' && h.visible ? 1 : 0, 2, dt);
    if (this.hole > 0.02) {
      for (const ic of g.desktop.icons) {
        if (ic.state !== 'normal') continue;
        const cx = ic.x + ic.w / 2, cy = ic.y + 16;
        const d = dist(cx, cy, h.x, h.y);
        if (d < 220) {
          const k = (1 - d / 220) * this.hole;
          ic.offX = damp(ic.offX, (h.x - cx) * 0.35 * k, 3, dt);
          ic.offY = damp(ic.offY, (h.y - cy) * 0.35 * k, 3, dt);
          ic.pull = true;
          if (k > 0.5) ic.shake = 0.1;
        }
      }
      if (rng.chance(0.6)) {
        const a = rng.float(0, TAU), r = rng.float(30, 70);
        g.particles.add({ kind: 'dot', x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.6 - Math.sin(a) * 40, vy: -Math.sin(a) * r * 1.6 + Math.cos(a) * 40, life: 0.6, color: rng.pick(['#c8a8ff', '#7a4ad8', '#ffffff']), add: true });
      }
    }
    // golden glitter
    if (active && type === 'golden' && rng.chance(0.5)) {
      g.particles.sparkle(rng.float(0, g.screen.W), rng.float(0, g.screen.H - 30), '#ffe27a', { vy: rng.float(4, 12), life: 1.2 });
    }
    // chip sparks
    if (active && type === 'chip' && h.visible && rng.chance(0.25)) {
      g.particles.burst(h.x, h.y + 8, 3, { colors: ['#fff6a0', '#7affea'], speed: 50, g: 40, life: 0.3, add: true });
    }
    // pop-up ads
    if (active && type === 'popup') {
      if (this.ads.length < 3 && rng.chance(dt * 0.4)) {
        this.ads.push({ x: rng.float(100, g.screen.W - 200), y: rng.float(40, g.screen.H - 150), t: 0, text: rng.pick(['YOU WON A FREE FISH!', 'HOT SINGLE FISH IN YOUR AREA', 'Download more water?', 'Your PC has 9 fish!', 'Click here for bait!!']) });
        g.audio.play('notify', { pitch: 1.4 });
      }
    }
    for (const a of this.ads) a.t += dt;
    this.ads = this.ads.filter((a) => a.t < 6);
    // ancient relic: summon the abyss boss
    if (active && type === 'relic' && g.ocean.biome.id === 'abyss' && h.visible && g.world.hook.inWater) {
      const boss = SPECIES.find((s) => s.spawn?.requires === 'relic');
      const present = boss && g.school.fishes.some((f) => f.sp === boss);
      if (boss && !present) {
        this.relicT += dt;
        if (this.relicT > 4) {
          this.relicT = 0;
          g.camera.shake(8);
          g.audio.play('roar');
          g.toast('Something ancient opens its eyes...', 'eye');
          g.school.spawn(boss, { x: g.screen.W + 120, y: g.screen.H * 0.45, z: 0.4, fromFog: false });
        } else if (rng.chance(dt * 2)) g.camera.shake(1);
      }
    }
  }

  drawUnderIcons(ctx) {
    if (this.hole > 0.02) {
      const h = this.game.fishing.hook;
      const r = 26 * this.hole;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = rgba(i === 0 ? '#1a0a2a' : '#5a2aa8', (0.5 - i * 0.15) * this.hole);
        ctx.beginPath();
        ctx.ellipse(h.x, h.y + 10, r + i * 10 + Math.sin(this.t * 3 + i) * 2, (r + i * 10) * 0.6, this.t * (i + 1) * 0.5, 0, TAU);
        ctx.fill();
      }
    }
  }

  drawWorld(ctx) {
    const t = this.t;
    for (const w of this.worms) {
      const r = w.r;
      const per = 2 * (r.w + r.h);
      for (let k = 0; k < 6; k++) {
        let p = ((w.p - k * 2) % per + per) % per;
        let x, y;
        if (p < r.w) { x = r.x + p; y = r.y - 1; }
        else if ((p -= r.w) < r.h) { x = r.x + r.w; y = r.y + p; }
        else if ((p -= r.h) < r.w) { x = r.x + r.w - p; y = r.y + r.h; }
        else { p -= r.w; x = r.x - 1; y = r.y + r.h - p; }
        y += Math.sin(w.ph + k) * 0.8;
        ctx.fillStyle = k === 0 ? '#ffd0e8' : '#ff8ac8';
        ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#ff6ab8', 0.25);
        ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 4, 4);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    for (const a of this.ads) {
      const s = Math.min(1, a.t * 6) * Math.min(1, (6 - a.t) * 3);
      const w = 150, h = 54;
      const x = Math.round(a.x), y = Math.round(a.y + (1 - s) * 10);
      ctx.globalAlpha = s;
      ctx.fillStyle = '#c0c0c0'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#1a2aa8'; ctx.fillRect(x + 2, y + 2, w - 4, 10);
      drawText(ctx, 'ATTENTION!!!', x + 5, y + 4, { font: 'small', color: '#ffffff' });
      ctx.fillStyle = '#e04a4a'; ctx.fillRect(x + w - 11, y + 3, 8, 8);
      ctx.fillStyle = '#fff8a0'; ctx.fillRect(x + 4, y + 16, w - 8, h - 20);
      drawText(ctx, a.text, x + w / 2, y + 28, { align: 'center', color: Math.floor(a.t * 4) % 2 ? '#e0203a' : '#1a2a8a' });
      ctx.globalAlpha = 1;
    }
  }
}
