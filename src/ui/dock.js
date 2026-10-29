// The "dock": physical objects resting on the seabed that open the game's menus
// (Pinch's shop stall, a coral sprout for skills, the journal, a fishbowl, a map bottle).

import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack, ramp, rgba } from '../core/color.js';
import { bayer, clamp, clamp01, hash2, TAU } from '../core/math.js';
import { getProp } from '../gfx/props.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { skillStatus, SKILLS } from '../game/skills.js';
import { TASKBAR_H } from '../desktop/desktop.js';
import { drawText } from '../gfx/font.js';

export const PINCH_LOOK = {
  kind: 'crab', mustache: true, body: { len: 26, h: 17 },
  col: { body: '#e8583a', belly: '#ffb08a', fin: '#f06a4a', outline: '#3a1210' },
};

function rp(hex, c = 1) { return ramp(hex, c).map((h) => pack(h)); }

function makeBook() {
  const W = 30, H = 24;
  const b = new PixelBuffer(W, H);
  const cover = rp('#8a4a2a', 1.1), page = rp('#f4e8c8', 0.6), gold = rp('#e8b84a', 1.2);
  // pages block (side, 3/4 view)
  for (let y = 6; y < 20; y++) for (let x = 3; x < 27; x++) b.set(x, y, page[(x + y) % 3 === 0 ? 1 : 3]);
  // cover top (parallelogram)
  for (let y = 2; y < 16; y++) {
    const sk = Math.round((16 - y) * 0.25);
    for (let x = 1 + sk; x < 26 + sk; x++) {
      const light = 0.55 + (y < 5 ? 0.15 : 0) - (x - sk) * 0.004 + (hash2(x >> 1, y >> 1, 3) - 0.5) * 0.08;
      b.set(x, y, cover[clamp(Math.floor(light * 4.99 + (bayer(x, y) - 0.5) * 0.7), 0, 4)]);
    }
  }
  // spine & bottom cover
  for (let x = 1; x < 26; x++) { b.set(x, 16, cover[1]); b.set(x, 17, cover[0]); }
  for (let y = 16; y < 21; y++) { b.set(1, y, cover[1]); b.set(2, y, cover[2]); }
  for (let x = 2; x < 27; x++) b.set(x, 20, cover[1]);
  // embossed gold fish emblem
  const ex = 14, ey = 8;
  b.fillEllipse(ex, ey, 4, 2.2, gold[3]);
  b.fillPoly([[ex - 4, ey], [ex - 7, ey - 2.5], [ex - 7, ey + 2.5]], gold[2]);
  b.set(ex + 2, ey - 1, cover[0]);
  b.line(ex - 3, ey + 1, ex + 3, ey + 1, gold[1]);
  // gold corner caps
  for (const [cx, cy] of [[4, 3], [23, 3]]) { b.set(cx, cy, gold[4]); b.set(cx + 1, cy, gold[2]); b.set(cx, cy + 1, gold[2]); }
  // bookmark ribbon
  for (let y = 16; y < 23; y++) b.set(20 + (y > 20 ? 1 : 0), y, pack(y > 21 ? '#a8203a' : '#e0304a'));
  b.outline(selOut(0.7));
  return b.toCanvas();
}

function makeBowl() {
  const W = 34, H = 30;
  const b = new PixelBuffer(W, H);
  const cx = 17, cy = 16, r = 13;
  const water = rp('#3ab8e8', 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const d = Math.hypot(dx, dy * 1.05);
    if (d > r || y < 5) continue;
    if (y < 9) { b.set(x, y, pack('#dff6ff', 70)); continue; } // air above water
    const light = 0.62 - dy * 0.03 + dx * -0.01;
    const c = water[clamp(Math.floor(light * 4.99 + (bayer(x, y) - 0.5) * 0.8), 0, 4)];
    b.set(x, y, (c & 0x00ffffff) | (190 << 24));
  }
  // water surface line
  for (let x = cx - 11; x <= cx + 11; x++) b.set(x, 9, pack('#c8f4ff', 230));
  // pebbles
  for (let i = 0; i < 9; i++) b.fillCircle(cx - 9 + i * 2.2, cy + 10 - (i % 2), 1.4, pack(['#e8d098', '#c8a868', '#f4e4b8'][i % 3]));
  // glass rim + highlight
  for (let a = 0; a < TAU; a += 0.02) {
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r / 1.05);
    if (y < 5) continue;
    b.set(x, y, pack('#e8fbff', 200));
  }
  for (let x = cx - 9; x <= cx + 9; x++) { b.set(x, 4, pack('#ffffff', 220)); b.set(x, 5, pack('#bfe8f8', 160)); }
  for (let y = 9; y < 20; y++) b.set(cx - 9 + Math.round((y - 9) * 0.2), y, pack('#ffffff', 170));
  b.outline(() => pack('#1a3a5a', 210));
  return b.toCanvas();
}

export class Dock {
  constructor(game) {
    this.game = game;
    this.book = makeBook();
    this.bowl = makeBowl();
    this.pinch = compiled(PINCH_LOOK, null, 'pinch');
    this.t = 0;
    this.wiggle = {};
    this.items = [
      { id: 'shop', label: "Pinch's Bait Shop (S)", w: 74, action: () => game.command('shop') },
      { id: 'skills', label: 'Coral Skill Tree (K)', w: 34, action: () => game.command('skills') },
      { id: 'journal', label: 'Fish Journal (J)', w: 30, action: () => game.command('journal') },
      { id: 'tank', label: 'My Aquarium (click: window / A: full view)', w: 36, action: () => game.command('tankwindow') },
      { id: 'map', label: 'Travel Map (T)', w: 26, action: () => game.command('map') },
    ];
    this.hidden = new Set();
    game.ui.setDock(this.items);
    for (const it of this.items) it.draw = (ctx, hover, t) => this.drawItem(ctx, it, hover, t);
  }

  isVisible(id) { return !this.hidden.has(id) && (this.game.tutorial.dockVisible?.(id) ?? true); }

  layout() {
    const g = this.game;
    // building system buttons (Blueprint scroll + Inventory satchel) join the dock once game.build exists
    if (!this.buildAdded && g.build?.dockItems) {
      this.buildAdded = true;
      this.items.unshift(...g.build.dockItems());
      g.ui.setDock(this.items);
    }
    const W = g.screen.W, H = g.screen.H;
    let x = W - 12;
    for (const it of this.items.slice().reverse()) {
      if (!this.isVisible(it.id)) { it.rect = null; continue; }
      x -= it.w;
      const fy = g.state.view === 'ocean' ? Math.min(g.ocean.floorAt(x + it.w / 2) + 6, H - TASKBAR_H - 2) : H - TASKBAR_H - 4;
      const h = it.id === 'shop' ? 64 : 34;
      it.rect = { x, y: fy - h, w: it.w, h };
      it.ground = fy;
      x -= 10;
    }
  }

  draw(ctx, dt) {
    this.t += dt;
    if (this.game.mini) return;
    this.layout();
  }

  drawItem(ctx, it, hover, t) {
    if (!it.rect) return;
    const g = this.game;
    const r = it.rect;
    const cx = Math.round(r.x + r.w / 2);
    const wig = hover ? Math.sin(t * 14) * 1 : 0;
    const lift = hover ? -2 : 0;
    const base = Math.round(it.ground + lift);
    if (hover) {
      ctx.fillStyle = rgba('#fff3c4', 0.18);
      ctx.beginPath();
      ctx.ellipse(cx, base - 2, r.w / 2 + 3, 5, 0, 0, TAU);
      ctx.fill();
    }
    switch (it.id) {
      case 'shop': {
        const p = getProp('shop_stall', { scale: 0.7 });
        const sx = Math.round(cx - (p ? p.ox : 0)), sy = Math.round(base - (p ? p.oy : 0));
        if (p) ctx.drawImage(p.canvas, sx, sy);
        const talking = hover || g.ui.isOpen('shop');
        const kp = p?.anchors?.keeper;
        const kx = kp ? sx + kp.x : cx - 4;
        const ky = kp ? sy + kp.y - 16 : base - 20;
        drawFishRig(ctx, this.pinch, { x: kx, y: ky, facing: -1, turn: -1, angle: 0, scale: 0.75, squash: Math.sin(t * 3) * 0.04, swimPhase: (t * 0.6) % 1, tailPhase: 0, finPhase: (t * 0.8) % 1, speed01: 0, inflate: 0, lookX: g.input.x, lookY: g.input.y, blink: (t % 4) < 0.12 ? 1 : 0, emotion: hover ? 'happy' : 'neutral', mouth: talking ? Math.abs(Math.sin(t * 12)) * 0.7 : 0.05, time: t });
        if (p?.front) ctx.drawImage(p.front, sx, sy);
        if (hover && Math.floor(t * 2) % 6 === 0 && !this.babbled) { this.babbled = true; g.audio.babble('click click', 'crab'); }
        if (Math.floor(t * 2) % 6 !== 0) this.babbled = false;
        break;
      }
      case 'skills': {
        const p = getProp('coral_branch', { scale: 0.45, variant: 2 });
        if (p) ctx.drawImage(p.canvas, Math.round(cx - p.ox + wig), Math.round(base - p.oy));
        const affordable = SKILLS.some((s) => skillStatus(s, g.state, g.speciesFound()).status === 'available' && g.state.coins >= s.cost);
        if (affordable) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 4);
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba('#7dffb8', 0.25 + 0.25 * pulse);
          ctx.fillRect(cx - 1, base - 34, 3, 3);
          ctx.globalCompositeOperation = 'source-over';
          if (Math.random() < 0.05) g.particles.sparkle(cx + (Math.random() - 0.5) * 20, base - 10 - Math.random() * 20, '#9affc8');
          drawText(ctx, '!', cx + 10, base - 36 + Math.round(Math.sin(t * 5) * 2), { color: '#ffe27a', outline: '#1a0e06' });
        }
        break;
      }
      case 'journal':
        ctx.drawImage(this.book, Math.round(cx - this.book.width / 2 + wig), base - this.book.height);
        break;
      case 'tank': {
        ctx.drawImage(this.bowl, Math.round(cx - this.bowl.width / 2), base - this.bowl.height);
        const pet = g.state.fish.find((f) => f.inTank);
        const sp = pet && SPECIES_BY_ID[pet.species];
        if (sp) {
          const fx = cx + Math.sin(t * 0.8) * 6;
          drawFishRig(ctx, compiled(sp.look, pet.variant, sp.id), { x: fx, y: base - 13, facing: Math.cos(t * 0.8) > 0 ? 1 : -1, turn: Math.cos(t * 0.8) > 0 ? 1 : -1, angle: 0, scale: Math.min(0.4, 18 / ((sp.look.body?.len || 30) * 1.3)), squash: 0, swimPhase: (t * 0.7) % 1, tailPhase: (t * 1.4) % 1, finPhase: (t * 2) % 1, speed01: 0.3, inflate: 0, lookX: null, lookY: null, blink: 0, emotion: 'happy', mouth: 0.1, time: t });
        }
        break;
      }
      case 'map': {
        const p = getProp('message_bottle', { scale: 0.6 });
        if (p) ctx.drawImage(p.canvas, Math.round(cx - p.ox + wig), Math.round(base - p.oy));
        break;
      }
      default: break;
    }
  }
}
