// Chest opening with a CRACK-IT-OPEN minigame (phase 8, OWNER: Progression agent). Panel id 'crate' (the Satchel's
// "Open!" button and the floating-box flow open it): open({uid} | {tier}).
// A big voxel chest on a spotlit stage. Each tier has its own minigame (src/build/crates.js CHESTS):
//   crate  'tap'     tap the glowing knots          iron   'timing'  hit while the marker is in the zone
//   golden 'lock'    circle the lock, click on the sweet spot (it rattles harder as you get close)
//   orb    'whack'   catch the cracks before they fade
// Every hit spreads cracks, chips fly and the lid rattles; at 100% the chest bursts open with a flash, the lid
// pops off and pixel-art loot showers out into slots with rarity reveals; "Collect" flies it into the Satchel.
// A great run (no misses / perfects / fast) earns bonus loot. Loot is granted at the burst (closing never loses it).
import { clamp, clamp01, lerp, ease, TAU } from '../core/math.js';
import { rgba, RARITY, mix, shade } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { ITEMS, TIERS, inventory } from '../build/items.js';
import { packageParts } from '../build/itemart.js';
import { drawItem } from '../build/itemdraw.js';
import { chestOf, crackChest } from '../build/crates.js';
import { PixFx, partSprite } from '../build/pixart.js';
import { aeroSurface, aeroCached, drawAeroCoin, drawAeroGlow, fmtAero } from './aero.js';

const REVEAL_SFX = { common: 'click', uncommon: 'timing_good', rare: 'sparkle', epic: 'magic', legendary: 'golden_shimmer' };
const CRACK_COL = { crate: ['#3a200c', '#ffe2a8'], iron: ['#1a1e2a', '#bfe8ff'], golden: ['#4a1a08', '#fff2b8'], orb: ['#2a0a4a', '#ffd0ff'] };
const CHIP_COL = { crate: ['#c8925a', '#93603a', '#e0c890'], iron: ['#97a2b8', '#5d6275', '#ffe8a8'], golden: ['#ffd23a', '#c88a26', '#ff3a6a'], orb: ['#c08aff', '#ff9ae8', '#9ae8ff'] };
const SCALE = 4;

export class ChestPanel {
  constructor() {
    this.id = 'crate';
    this.modal = true;
    this.closeOnOutside = false;
    this.sound = 'box_open';
    this.fx = new PixFx(500);
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
    this.tier = TIERS[pkg?.tier] ? pkg.tier : 'crate';
    this.C = chestOf(this.tier);
    this.phase = pkg ? 'intro' : 'empty';
    this.pt = 0; this.t = 0;
    this.prog = 0; this.hits = 0; this.miss = 0; this.perfect = 0; this.expired = 0;
    this.cracks = []; this.squash = 0; this.rattle = 0; this.flash = 0; this.shake = 0;
    this.lid = null; this.loot = null; this.cards = []; this.flyers = []; this.bonus = 0; this.popText = [];
    this.fx.list = [];
    this.spots = [];
    this.marker = { x: 0, dir: 1, speed: 0.9 }; this.zone = null;
    this.lock = { pin: 0, target: Math.random() * TAU, ang: 0, warm: 0, bend: 0 };
    this.whackT = 0;
    this.parts = packageParts(this.tier, SCALE, 0, true, false);
    this.prepare();
  }
  close() { this.flyers = []; }

  // ------------------------------------------------------------------ layout
  stage() {
    const W = this.game.screen.W, H = this.game.screen.H;
    const p = this.parts;
    const cx = Math.round(W / 2), gy = Math.round(H * 0.6);
    return { W, H, cx, gy, x: cx - p.ox, y: gy - p.oy, w: p.w, h: p.h };
  }
  // the chest's front face in screen space (where weak points and cracks live)
  face() {
    const s = this.stage();
    return { x: s.x + s.w * 0.2, y: s.y + s.h * 0.42, w: s.w * 0.56, h: s.h * 0.42 };
  }

  prepare() {
    if (this.phase === 'empty') return;
    const g = this.C.game;
    if (g === 'tap') { this.spots = []; for (let i = 0; i < 3; i++) this.addSpot(); }
    if (g === 'timing') this.newZone();
  }
  addSpot(life = Infinity) {
    const f = this.face();
    for (let k = 0; k < 20; k++) {
      const x = f.x + 10 + Math.random() * (f.w - 20), y = f.y + 8 + Math.random() * (f.h - 16);
      if (this.spots.every((s) => Math.hypot(s.x - x, s.y - y) > 34)) { this.spots.push({ x, y, t: 0, life, ph: Math.random() * 6 }); return; }
    }
  }
  newZone() {
    const w = clamp(0.28 - this.hits * 0.045, 0.12, 0.3);
    const c = 0.15 + Math.random() * 0.7;
    this.zone = { a: clamp(c - w / 2, 0, 1 - w), w };
    this.marker.speed = 0.75 + this.hits * 0.22;
  }

  // ------------------------------------------------------------------ hits
  hit(x, y, power = 1, perfect = false) {
    const g = this.game, C = this.C;
    this.hits++;
    this.prog = clamp01(this.hits / C.hits);
    this.squash = 1; this.rattle = 1; this.shake = 0.5 + power * 0.4;
    this.addCrack(x, y, 10 + this.prog * 22 + power * 6);
    const col = CHIP_COL[this.tier] || CHIP_COL.crate;
    this.fx.burst(x, y, 10 + power * 6, { kinds: ['chip', 'chip', 'spark'], colors: col, speed: 220, speedMin: 70, g: 520, life: 0.9, up: 120, scale: 2 });
    this.fx.burst(x, y, 4, { kinds: ['sparkle', 'star'], colors: ['#ffffff', C.glow], speed: 120, g: 60, life: 0.7, scale: 1 });
    g.particles?.pixelBurst?.(perfect ? 'star' : 'spark', x, y, 6);
    g.audio.play(this.prog >= 1 ? 'eruption_boom' : 'ice_crack', { vol: 0.55 + this.prog * 0.35, pitch: 0.8 + this.prog * 0.5 + Math.random() * 0.1 });
    if (perfect) { this.perfect++; this.pop(x, y - 18, 'PERFECT!', '#ffe27a'); g.audio.play('timing_perfect', { vol: 0.6 }); }
    if (this.prog >= 1) this.startBurst();
  }
  missHit(x, y, text = 'CLANK!') {
    this.miss++;
    this.rattle = 0.7; this.shake = 0.35;
    this.fx.burst(x, y, 6, { kind: 'spark', colors: ['#ffffff', '#ffe27a'], speed: 140, g: 300, life: 0.4 });
    this.pop(x, y - 14, text, '#ff8a8a');
    this.game.audio.play('timing_miss', { vol: 0.5 });
  }
  pop(x, y, text, color) { this.popText.push({ x, y, text, color, t: 0 }); }

  addCrack(x, y, len) {
    const s = this.stage();
    const lx = x - s.x, ly = y - s.y;
    const n = 2 + (Math.random() < 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const pts = [[lx, ly]];
      let a = Math.random() * TAU, px = lx, py = ly;
      const segs = 3 + Math.floor(len / 9);
      for (let k = 0; k < segs; k++) {
        a += (Math.random() - 0.5) * 1.1;
        const l = 3 + Math.random() * 5;
        px = clamp(px + Math.cos(a) * l, s.w * 0.12, s.w * 0.88); py = clamp(py + Math.sin(a) * l, s.h * 0.25, s.h * 0.92);
        pts.push([px, py]);
      }
      this.cracks.push({ pts, grow: 0 });
    }
  }

  startBurst() {
    this.phase = 'burst';
    this.pt = 0;
    const C = this.C;
    const g = C.game;
    if (g === 'tap') this.bonus = this.t < 6 ? 1 : 0;
    else if (g === 'timing') this.bonus = this.perfect >= 4 ? 2 : this.perfect >= 2 ? 1 : 0;
    else if (g === 'lock') this.bonus = this.miss === 0 ? (this.t < 8 ? 2 : 1) : 0;
    else if (g === 'whack') this.bonus = this.expired === 0 ? 1 : 0;
    // the loot is granted right away: closing early never loses anything
    this.loot = crackChest(this.game, this.pkg, { bonus: this.bonus });
    this.spots = [];
  }

  explode() {
    const g = this.game, s = this.stage(), C = this.C;
    this.phase = 'loot';
    this.pt = 0;
    this.flash = 1;
    const p = this.parts;
    const lidY = s.y + (p.lidAt?.[1] ?? s.h * 0.3);
    this.lid = { x: 0, y: 0, vx: (Math.random() - 0.5) * 120, vy: -520, rot: 0, vr: (Math.random() - 0.5) * 7 };
    g.audio.play(this.tier === 'golden' || this.tier === 'orb' ? 'golden_shimmer' : 'treasure_open', { vol: 0.9 });
    g.audio.play('eruption_boom', { vol: 0.5, pitch: 1.3 });
    const col = CHIP_COL[this.tier] || CHIP_COL.crate;
    this.fx.burst(s.cx, lidY, 46, { kinds: ['chip', 'chip', 'shard'], colors: col, speed: 380, speedMin: 120, g: 600, life: 1.4, up: 160, scale: 2 });
    this.fx.burst(s.cx, lidY, 40, { kinds: ['sparkle', 'star', 'confetti', 'heart'], colors: ['#ffffff', C.glow, '#ffe27a', '#ff9ad0', '#8ae8ff', '#8ae84a'], speed: 300, speedMin: 60, g: 140, life: 1.8, up: 120, scale: 2 });
    g.particles?.pixelBurst?.('confetti', s.cx, lidY, 30);
    // the loot flies out and lands in slots
    const list = this.loot || [];
    const n = list.length, per = Math.min(n, 7), rows = Math.ceil(n / per);
    const SW = 78, SH = 86;
    const y0 = s.H - 40 - rows * (SH + 8);
    this.cards = list.map((e, i) => {
      const row = Math.floor(i / per), inRow = Math.min(per, n - row * per), col2 = i % per;
      const x = Math.round(s.W / 2 - (inRow * (SW + 8) - 8) / 2 + col2 * (SW + 8));
      return { ...e, x, y: y0 + row * (SH + 8), w: SW, h: SH, t: -0.25 - i * 0.16, sx: s.cx + (Math.random() - 0.5) * 30, sy: lidY, rev: false, rarity: e.id === 'coins' ? 'common' : ITEMS[e.id]?.rarity || 'common' };
    });
  }

  // ------------------------------------------------------------------ frame
  draw(ctx, ui, dt) {
    const g = this.game, inp = ui.inp;
    dt = Math.max(0, Math.min(0.05, dt || 0.016));
    this.t += dt; this.pt += dt;
    const s = this.stage();
    this.rect = { x: 0, y: 0, w: s.W, h: s.H };
    const reduced = !!g.state.settings?.reducedMotion;
    this.squash = Math.max(0, this.squash - dt * 5);
    this.rattle = Math.max(0, this.rattle - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.fx.update(dt);
    for (const c of this.cracks) c.grow = Math.min(1, c.grow + dt * 6);
    for (const p of this.popText) p.t += dt;
    this.popText = this.popText.filter((p) => p.t < 1);

    this.drawStage(ctx, s);
    if (this.phase === 'empty') {
      drawText(ctx, 'No chests in your Satchel!', s.cx, s.gy - 20, { font: 'big', scale: 2, align: 'center', color: '#ffffff', shadow: '#0a3e74' });
      if (ui.button(ctx, s.cx - 70, s.gy + 30, 140, 30, 'Back', { style: 'aqua' })) ui.close(this.id);
      return;
    }

    // ---- minigame input + update
    if (this.phase === 'intro') {
      if (this.pt > (reduced ? 0.1 : 0.55)) { this.phase = 'play'; this.pt = 0; }
    } else if (this.phase === 'play') this.play(ctx, ui, dt, s);
    else if (this.phase === 'burst') {
      this.rattle = Math.max(this.rattle, 0.6 + this.pt * 1.4);
      this.shake = Math.max(this.shake, 0.4 + this.pt * 1.6);
      if (Math.random() < dt * 30) { const f = this.face(); this.addCrack(f.x + Math.random() * f.w, f.y + Math.random() * f.h, 18); }
      if (((this.pt * 14) | 0) !== ((this.pt * 14 - dt * 14) | 0)) g.audio.play('ice_crack', { vol: 0.35, pitch: 1 + this.pt });
      if (this.pt > (reduced ? 0.15 : 0.75)) this.explode();
    }

    // ---- the chest
    this.drawChest(ctx, s, reduced);
    if (this.phase === 'play') this.drawGame(ctx, ui, s);
    this.fx.draw(ctx);

    // ---- header: name + hint + progress
    const title = this.C.name;
    drawText(ctx, title, s.cx, 26, { font: 'big', scale: 2, align: 'center', color: '#ffffff', shadow: '#0a3e74', outline: 'rgba(10,62,116,0.55)' });
    if (this.phase === 'play' || this.phase === 'intro') {
      drawText(ctx, this.C.hint, s.cx, 62, { font: 'big', align: 'center', color: '#fff6c0', shadow: '#0a3e74' });
      this.drawCrackMeter(ctx, s.cx - 110, 80, 220, 14);
    }
    for (const p of this.popText) {
      const k = p.t;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      drawText(ctx, p.text, p.x, p.y - k * 26, { font: 'big', align: 'center', color: p.color, shadow: '#14202c', outline: 'rgba(20,32,44,0.6)' });
      ctx.globalAlpha = 1;
    }
    if (this.phase === 'loot') this.drawLoot(ctx, ui, s, dt);
    if (this.flash > 0) { ctx.fillStyle = rgba('#ffffff', this.flash * 0.8); ctx.fillRect(0, 0, s.W, s.H); }
    // leave (keeps the chest if it is still closed)
    if (this.phase !== 'loot' && this.phase !== 'burst' && ui.button(ctx, s.W - 34, 10, 24, 24, '', { icon: 'cross', tip: 'Later (Esc)' })) ui.close(this.id);
    void inp;
  }

  drawStage(ctx, s) {
    // soft spotlight + pixel rays behind the chest
    const C = this.C, t = this.t;
    drawAeroGlow(ctx, s.cx, s.gy - s.h * 0.45, Math.round(s.h * 1.25), C.glow, 0.35 + this.prog * 0.3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * 0.15;
      ctx.fillStyle = rgba(C.glow, 0.05 + this.prog * 0.06);
      for (let r = 40; r < 260; r += 4) {
        const w = Math.max(1, Math.round(r * 0.06));
        ctx.fillRect(Math.round(s.cx + Math.cos(a) * r - w / 2), Math.round(s.gy - s.h * 0.45 + Math.sin(a) * r * 0.8), w, 2);
      }
    }
    ctx.restore();
    // pedestal: a chunky glossy pixel plinth
    const pw = Math.round(s.w * 1.25), ph = 18;
    ctx.drawImage(aeroCached(`chestped|${pw}`, () => aeroSurface(pw, ph, { tone: 'glass', r: 8, gloss: 0.7, glossH: 7, rim: 0.9, glow: 0.6, sparkle: 2 })), s.cx - Math.round(pw / 2), s.gy - 6);
    ctx.fillStyle = 'rgba(6,30,60,0.35)';
    for (let i = 0; i < 6; i++) { const hw = Math.round(s.w * 0.42 * Math.sqrt(1 - (i / 6) ** 2)); ctx.fillRect(s.cx - hw, s.gy - 3 + i, hw * 2, 1); }
  }

  drawChest(ctx, s, reduced) {
    const p = this.parts, C = this.C, t = this.t;
    if (!p) return;
    const sh = reduced ? 0 : this.shake;
    const jx = Math.round((Math.random() - 0.5) * sh * 8), jy = Math.round((Math.random() - 0.5) * sh * 4);
    const intro = this.phase === 'intro' ? ease.outBack(clamp01(this.pt / 0.55)) : 1;
    const sq = ease.outQuad(this.squash);
    const sx = (1 + sq * 0.08) * intro, sy = (1 - sq * 0.07) * intro;
    const bob = this.phase === 'play' && !reduced ? Math.round(Math.sin(t * 2.2) * 2) : 0;
    ctx.save();
    ctx.translate(s.cx + jx, s.gy + jy + bob);
    ctx.scale(sx, sy);
    const x0 = -p.ox, y0 = -p.oy;
    // glow behind
    if (p.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4 + 0.4 * this.prog + 0.2 * Math.sin(t * 5); ctx.drawImage(p.glow, x0, y0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    ctx.drawImage(p.body, x0, y0);
    // light leaking from the seam as it cracks
    if (this.prog > 0 && this.phase !== 'loot') {
      const ly = (p.lidAt?.[1] ?? p.h * 0.35);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(C.glow, 0.25 + this.prog * 0.55);
      ctx.fillRect(x0 + Math.round(p.w * 0.12), y0 + ly - 1, Math.round(p.w * 0.76), 2 + Math.round(this.prog * 2));
      ctx.globalCompositeOperation = 'source-over';
    }
    this.drawCracks(ctx, x0, y0);
    // the lid rattles and lifts, then flies off
    if (this.phase !== 'loot') {
      const rt = this.rattle;
      const lift = Math.round(this.prog * 3 + rt * 4 * Math.abs(Math.sin(t * 40)));
      const lx = Math.round(Math.sin(t * 53) * rt * 3);
      ctx.drawImage(p.lid, x0 + lx, y0 - lift);
    } else if (this.lid) {
      const L = this.lid;
      const dt = 1 / 60;
      L.vy += 1100 * dt; L.x += L.vx * dt; L.y += L.vy * dt; L.rot += L.vr * dt;
      if (L.y < 600) {
        ctx.save();
        ctx.translate(L.x, L.y + (p.lidAt?.[1] ?? 0) + y0);
        ctx.rotate(L.rot);
        ctx.drawImage(p.lid, x0, -(p.lidAt?.[1] ?? 0));
        ctx.restore();
      }
      // beam of light out of the open chest
      const k = clamp01(1 - this.pt / 2.5);
      if (k > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const top = y0 + (p.lidAt?.[1] ?? 30);
        for (let i = 0; i < 10; i++) {
          const w = Math.round(p.w * (0.7 - i * 0.05));
          ctx.fillStyle = rgba(i % 2 ? '#ffffff' : C.glow, 0.08 * k);
          ctx.fillRect(-Math.round(w / 2), top - 260 + i * 6, w, 260 - i * 6);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
  }

  drawCracks(ctx, x0, y0) {
    const [dark, light] = CRACK_COL[this.tier] || CRACK_COL.crate;
    for (const c of this.cracks) {
      const n = Math.max(1, Math.round((c.pts.length - 1) * c.grow));
      for (let i = 0; i < n; i++) {
        const [ax, ay] = c.pts[i], [bx, by] = c.pts[i + 1];
        const m = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
        for (let k = 0; k <= m; k++) {
          const x = Math.round(x0 + ax + ((bx - ax) * k) / m), y = Math.round(y0 + ay + ((by - ay) * k) / m);
          ctx.fillStyle = dark; ctx.fillRect(x, y, 2, 2);
          ctx.fillStyle = rgba(light, 0.35 + this.prog * 0.6); ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  drawCrackMeter(ctx, x, y, w, h) {
    ctx.drawImage(aeroCached(`crackbar|${w}|${h}`, () => aeroSurface(w, h, { tone: 'dark', r: 'pill', gloss: 0.5, glossH: 5, rim: 0.8 })), x, y);
    const k = this.prog;
    const fw = Math.round((w - 6) * k);
    if (fw > 0) {
      ctx.fillStyle = this.C.glow; ctx.fillRect(x + 3, y + 3, fw, h - 6);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y + 3, fw, 2);
    }
    for (let i = 1; i < this.C.hits; i++) { ctx.fillStyle = 'rgba(10,40,70,0.6)'; ctx.fillRect(Math.round(x + 3 + ((w - 6) * i) / this.C.hits), y + 3, 1, h - 6); }
  }

  // ------------------------------------------------------------------ the four minigames
  play(ctx, ui, dt, s) {
    const inp = ui.inp, game = this.C.game;
    const click = inp.pressed;
    if (game === 'tap') {
      for (const sp of this.spots) sp.t += dt;
      if (click) {
        const hitS = this.spots.find((sp) => Math.hypot(sp.x - inp.x, sp.y - inp.y) < 22);
        inp.pressed = false;
        if (hitS) {
          this.spots = this.spots.filter((q) => q !== hitS);
          this.hit(hitS.x, hitS.y, 1);
          if (this.phase === 'play' && this.hits + this.spots.length < this.C.hits) this.addSpot();
        } else if (this.inChest(inp.x, inp.y, s)) this.missHit(inp.x, inp.y, 'BONK');
      }
    } else if (game === 'timing') {
      const M = this.marker;
      M.x += M.dir * M.speed * dt;
      if (M.x > 1) { M.x = 1; M.dir = -1; } else if (M.x < 0) { M.x = 0; M.dir = 1; }
      if (click || inp.keyPressed?.(' ')) {
        inp.pressed = false;
        const z = this.zone;
        const bar = this.timingBar(s);
        const hx = bar.x + M.x * bar.w;
        if (M.x >= z.a && M.x <= z.a + z.w) {
          const perfect = Math.abs(M.x - (z.a + z.w / 2)) < z.w * 0.18;
          const f = this.face();
          this.hit(f.x + f.w * (0.2 + Math.random() * 0.6), f.y + f.h * (0.2 + Math.random() * 0.6), perfect ? 1.6 : 1, perfect);
          this.fx.burst(hx, bar.y + bar.h / 2, 8, { kind: 'spark', colors: ['#ffffff', '#8ae84a'], speed: 120, g: 200, life: 0.4 });
          if (this.phase === 'play') this.newZone();
        } else this.missHit(hx, bar.y - 6);
      }
    } else if (game === 'lock') {
      const L = this.lock, d = this.lockDial(s);
      const ang = Math.atan2(inp.y - d.cy, inp.x - d.cx);
      L.ang = ang;
      const diff = Math.abs(Math.atan2(Math.sin(ang - L.target), Math.cos(ang - L.target)));
      const warm = clamp01(1 - diff / Math.PI);
      L.warm = lerp(L.warm, warm, Math.min(1, dt * 10));
      L.bend = Math.max(0, L.bend - dt * 3);
      this.rattle = Math.max(this.rattle, Math.pow(L.warm, 4) * 0.5);
      L.tick = (L.tick || 0) - dt * (1 + L.warm * 10);
      if (L.tick <= 0) { L.tick = 1; this.game.audio.play('reel_tick', { vol: 0.15 + L.warm * 0.35, pitch: 0.7 + L.warm * 0.8 }); }
      if (click) {
        inp.pressed = false;
        const tol = 0.3 - L.pin * 0.04;
        if (diff < tol) {
          L.pin++;
          this.game.audio.play('click', { vol: 0.8 });
          this.pop(d.cx, d.cy - d.r - 12, 'CLICK!', '#8ae84a');
          this.hit(d.cx + Math.cos(ang) * d.r * 0.6, d.cy + Math.sin(ang) * d.r * 0.6, 1.2);
          L.target = Math.random() * TAU;
        } else {
          L.bend = 1;
          this.missHit(d.cx + Math.cos(ang) * d.r, d.cy + Math.sin(ang) * d.r, L.warm > 0.8 ? 'SO CLOSE!' : L.warm > 0.55 ? 'WARMER...' : 'COLD!');
        }
      }
    } else if (game === 'whack') {
      this.whackT -= dt;
      for (const sp of this.spots) sp.t += dt;
      const live = this.spots.filter((sp) => sp.t < sp.life);
      this.expired += this.spots.length - live.length;
      if (this.spots.length !== live.length) this.game.audio.play('puff', { vol: 0.3 });
      this.spots = live;
      const left = this.C.hits - this.hits;
      if (this.whackT <= 0 && this.spots.length < Math.min(2, left)) { this.addSpot(Math.max(0.75, 1.5 - this.hits * 0.1)); this.whackT = 0.35; }
      if (click) {
        inp.pressed = false;
        const hitS = this.spots.find((sp) => Math.hypot(sp.x - inp.x, sp.y - inp.y) < 22);
        if (hitS) { this.spots = this.spots.filter((q) => q !== hitS); this.hit(hitS.x, hitS.y, 1.2, hitS.t < 0.35); }
        else if (this.inChest(inp.x, inp.y, s)) this.missHit(inp.x, inp.y, 'MISS');
      }
    }
  }
  inChest(x, y, s) { return x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h; }
  timingBar(s) { return { x: s.cx - 160, y: s.gy + 30, w: 320, h: 20 }; }
  lockDial(s) { const f = this.face(); return { cx: Math.round(f.x + f.w / 2), cy: Math.round(f.y + f.h * 0.45), r: 44 }; }

  drawGame(ctx, ui, s) {
    const game = this.C.game, t = this.t;
    if (game === 'tap' || game === 'whack') {
      for (const sp of this.spots) {
        const life = sp.life === Infinity ? 1 : 1 - sp.t / sp.life;
        const pulse = 1 + Math.round((Math.sin(t * 8 + sp.ph) + 1) * 0.5);
        const col = game === 'whack' ? '#ff9ae8' : '#ffe27a';
        const spr = partSprite('sparkle', col, 2 + pulse);
        ctx.globalAlpha = 0.4 + 0.6 * life;
        ctx.drawImage(spr, Math.round(sp.x - spr.width / 2), Math.round(sp.y - spr.height / 2));
        // the weak point itself: a chunky pixel knot / crack star
        ctx.fillStyle = game === 'whack' ? '#ffffff' : '#ff9d2e';
        ctx.fillRect(Math.round(sp.x) - 3, Math.round(sp.y) - 3, 6, 6);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(sp.x) - 3, Math.round(sp.y) - 3, 2, 2);
        if (game === 'whack') { // fading timer as shrinking pixel petals
          const n = Math.ceil(life * 8);
          for (let i = 0; i < n; i++) { const a = (i / 8) * TAU - Math.PI / 2; ctx.fillStyle = '#ff9ae8'; ctx.fillRect(Math.round(sp.x + Math.cos(a) * 16) - 1, Math.round(sp.y + Math.sin(a) * 16) - 1, 3, 3); }
        }
        ctx.globalAlpha = 1;
        if (ui.hover({ x: sp.x - 20, y: sp.y - 20, w: 40, h: 40 })) { ctx.drawImage(partSprite('star', '#ffffff', 2), Math.round(sp.x - 5), Math.round(sp.y - 26)); }
      }
    } else if (game === 'timing') {
      const b = this.timingBar(s), z = this.zone, M = this.marker;
      ctx.drawImage(aeroCached(`timebar|${b.w}|${b.h}`, () => aeroSurface(b.w, b.h, { tone: 'dark', r: 6, gloss: 0.5, glossH: 7, rim: 0.85 })), b.x, b.y);
      const zx = Math.round(b.x + 3 + z.a * (b.w - 6)), zw = Math.round(z.w * (b.w - 6));
      ctx.fillStyle = '#4cd06a'; ctx.fillRect(zx, b.y + 4, zw, b.h - 8);
      ctx.fillStyle = '#c8f56a'; ctx.fillRect(zx, b.y + 4, zw, 2);
      const pw = Math.max(4, Math.round(zw * 0.36));
      ctx.fillStyle = '#ffd23a'; ctx.fillRect(Math.round(zx + zw / 2 - pw / 2), b.y + 4, pw, b.h - 8);
      ctx.fillStyle = '#fff6c0'; ctx.fillRect(Math.round(zx + zw / 2 - pw / 2), b.y + 4, pw, 2);
      const mx = Math.round(b.x + 3 + M.x * (b.w - 6));
      ctx.fillStyle = '#14202c'; ctx.fillRect(mx - 2, b.y - 7, 5, b.h + 14);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(mx - 1, b.y - 6, 3, b.h + 12);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) ctx.fillRect(mx - 3 + i, b.y - 11 + i, 7 - i * 2, 1);
      drawText(ctx, 'CLICK or SPACE', s.cx, b.y + b.h + 8, { align: 'center', color: '#e8fbff', shadow: '#0a3e74' });
    } else if (game === 'lock') {
      const d = this.lockDial(s), L = this.lock;
      const R = d.r;
      // the lock plate: a chunky gold pixel disc (cached) with a keyhole
      ctx.drawImage(aeroCached(`lockplate|${R}`, () => lockPlate(R)), d.cx - R - 4, d.cy - R - 4);
      // pins set
      for (let i = 0; i < this.C.hits; i++) {
        const px = d.cx - 14 + i * 14, py = d.cy + R + 12;
        ctx.fillStyle = '#14202c'; ctx.fillRect(px - 4, py - 4, 9, 9);
        ctx.fillStyle = i < L.pin ? '#8ae84a' : '#5a6a80'; ctx.fillRect(px - 3, py - 3, 7, 7);
        if (i < L.pin) { ctx.fillStyle = '#e8ffd0'; ctx.fillRect(px - 3, py - 3, 3, 2); }
      }
      // the pick: follows the pointer angle; warmer = more golden and jittery
      const warm = L.warm, a = L.ang + (Math.random() - 0.5) * Math.pow(warm, 3) * 0.12 + L.bend * Math.sin(t * 60) * 0.15;
      const col = mix('#8ad8ff', '#ffd23a', warm);
      for (let r = 6; r < R + 26; r += 1) {
        const x = Math.round(d.cx + Math.cos(a) * r), y = Math.round(d.cy + Math.sin(a) * r);
        ctx.fillStyle = '#14202c'; ctx.fillRect(x - 1, y - 1, 3, 3);
      }
      for (let r = 6; r < R + 26; r += 1) {
        const x = Math.round(d.cx + Math.cos(a) * r), y = Math.round(d.cy + Math.sin(a) * r);
        ctx.fillStyle = r > R + 16 ? '#c8925a' : col; ctx.fillRect(x, y, 1, 1);
      }
      // warmth meter (pixel thermometer)
      const mx = d.cx + R + 26, my = d.cy - R;
      ctx.fillStyle = '#14202c'; ctx.fillRect(mx - 1, my - 1, 10, R * 2 + 2);
      const fh = Math.round((R * 2 - 2) * warm);
      ctx.fillStyle = '#2a3444'; ctx.fillRect(mx, my, 8, R * 2);
      ctx.fillStyle = mix('#3a8cff', '#ff5a3a', warm); ctx.fillRect(mx, my + R * 2 - fh, 8, fh);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(mx + 1, my + R * 2 - fh, 2, fh);
      if (warm > 0.85 && ((t * 12) | 0) % 2) ctx.drawImage(partSprite('sparkle', '#ffe27a', 2), mx - 3, my - 16);
    }
  }

  // ------------------------------------------------------------------ loot
  drawLoot(ctx, ui, s, dt) {
    const g = this.game;
    let allIn = true;
    for (const c of this.cards) {
      c.t += dt;
      if (c.t < 0) { allIn = false; continue; }
      const k = clamp01(c.t / 0.6);
      if (k < 1) allIn = false;
      const tx = c.x + c.w / 2, ty = c.y + c.h / 2 - 8;
      if (k < 1) {
        const e = ease.outCubic(k);
        const x = lerp(c.sx, tx, e), y = lerp(c.sy, ty, e) - Math.sin(k * Math.PI) * 120;
        this.drawLootIcon(ctx, c, x, y + 16, 0.8 + k * 0.2);
        if (Math.random() < 0.6) this.fx.add({ x: x + (Math.random() - 0.5) * 8, y, vx: 0, vy: 20, g: 0, life: 0.4, kind: 'spark', color: RARITY[c.rarity]?.color || '#ffffff' });
        continue;
      }
      if (!c.rev) {
        c.rev = true; c.rt = 0;
        const col = RARITY[c.rarity]?.color || '#ffffff';
        const big = c.rarity === 'epic' || c.rarity === 'legendary';
        this.fx.burst(tx, ty, big ? 40 : 14, { kinds: big ? ['sparkle', 'star', 'confetti'] : ['spark', 'star'], colors: [col, '#ffffff', mix(col, '#ffffff', 0.5)], speed: big ? 260 : 140, g: 220, life: big ? 1.2 : 0.7, up: 60, scale: big ? 2 : 1 });
        g.audio.play(REVEAL_SFX[c.rarity] || 'click', { vol: 0.6 });
        if (c.rarity === 'legendary') { this.flash = Math.max(this.flash, 0.6); g.camera?.shake?.(4, 0.4); }
      }
      c.rt += dt;
      this.drawCard(ctx, ui, c);
    }
    // flyers to the Satchel
    for (const f of this.flyers) {
      f.t += dt;
      const k = clamp01(f.t / f.dur);
      if (k <= 0) continue;
      const e = ease.inCubic(k);
      const x = lerp(f.x0, f.x1, e), y = lerp(f.y0, f.y1, e) - Math.sin(k * Math.PI) * 80;
      this.drawLootIcon(ctx, f.c, x, y + 14, 1 - k * 0.5);
      if (k >= 1 && !f.done) { f.done = true; g.audio.play('coin_collect', { vol: 0.4, pitch: 1 + Math.random() * 0.3 }); this.fx.burst(f.x1, f.y1, 6, { kind: 'star', colors: ['#ffffff', '#ffe27a'], speed: 90, g: 100, life: 0.5 }); g.particles?.pixelBurst?.('sparkle', f.x1, f.y1, 4); }
    }
    if (this.flyers.length && this.flyers.every((f) => f.done)) { this.flyers = []; this.afterCollect(); return; }
    // bonus banner
    if (this.bonus && this.pt > 0.4) {
      const txt = this.bonus > 1 ? 'CRITICAL CRACK!  +2 BONUS LOOT' : 'GREAT CRACK!  +1 BONUS LOOT';
      const w = measureText(txt, 'big') + 40;
      ctx.drawImage(aeroCached(`bonusban|${w}`, () => aeroSurface(w, 26, { tone: 'orange', r: 'pill', gloss: 0.8, glossH: 11, rim: 0.85, glow: 0.6, sparkle: 2 })), Math.round(s.cx - w / 2), 76);
      drawText(ctx, txt, s.cx, 84, { font: 'big', align: 'center', color: '#ffffff', shadow: '#7a2a06' });
    }
    if (allIn && !this.flyers.length && this.pt > 0.8) {
      const left = (inventory(g.state).packages || []).length;
      const bw = 170, bh = 34, by = s.H - 40 + 2;
      const bx = left ? s.cx - bw - 6 : s.cx - bw / 2;
      if (ui.button(ctx, bx, by - 4, bw, bh, 'Collect!', { style: 'green', icon: 'check', sound: 'ui_buy' }) || ui.inp.keyPressed?.('Enter')) this.collect(false);
      if (left && ui.button(ctx, s.cx + 6, by - 4, bw, bh, `Open next (${left})`, { style: 'orange', icon: 'star' })) this.collect(true);
    }
  }

  drawLootIcon(ctx, c, x, by, k = 1) {
    if (c.id === 'coins') { drawAeroCoin(ctx, x, by - 14, 9 * k, this.t); return; }
    drawItem(ctx, c.id, x, by, { box: [Math.round(44 * k), Math.round(44 * k)], t: this.t });
  }

  drawCard(ctx, ui, c) {
    const col = RARITY[c.rarity]?.color || '#c9d4dc';
    const pop = c.rt < 0.3 ? 1 + Math.sin((c.rt / 0.3) * Math.PI) * 0.12 : 1;
    const w = Math.round(c.w * pop), h = Math.round(c.h * pop);
    const x = Math.round(c.x + (c.w - w) / 2), y = Math.round(c.y + (c.h - h) / 2);
    if (c.rarity === 'epic' || c.rarity === 'legendary') drawAeroGlow(ctx, x + w / 2, y + h / 2, Math.round(w * 0.9), col, 0.5 + 0.2 * Math.sin(this.t * 4));
    ctx.drawImage(aeroCached(`lootcard|${w}|${h}|${col}`, () => aeroSurface(w, h, { tone: 'frost', r: 8, gloss: 0.6, glossH: 14, rim: 0.9, glow: 0.5, glowColor: col })), x, y);
    ctx.fillStyle = col; ctx.fillRect(x + 4, y + h - 22, w - 8, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 4, y + h - 22, w - 8, 2);
    this.drawLootIcon(ctx, c, x + w / 2, y + h - 28, 1);
    const name = c.id === 'coins' ? `${fmtAero(c.qty)} Aero` : `${c.qty > 1 ? c.qty + 'x ' : ''}${ITEMS[c.id]?.name || c.id}`;
    let label = name;
    while (measureText(label, 'small') > w - 8 && label.length > 4) label = label.slice(0, -2);
    if (label !== name) label += '.';
    drawText(ctx, label, x + w / 2, y + h - 17, { font: 'small', align: 'center', color: '#ffffff', shadow: shade(col, -0.6) });
    if ((c.rarity === 'legendary' || c.rarity === 'epic') && ((this.t * 3) | 0) % 2) ctx.drawImage(partSprite('sparkle', '#ffffff', 1), x + w - 12, y + 4);
    if (ui.hover({ x, y, w, h }) && c.id !== 'coins') ui.tip = `${ITEMS[c.id]?.name || c.id} (${RARITY[c.rarity]?.name || ''})`;
  }

  collect(next) {
    const g = this.game, s = this.stage();
    const r = g.hud?.iconRect?.('inventory');
    const x1 = r ? r.x + r.w / 2 : s.W - 60, y1 = r ? r.y + r.h / 2 : s.H - 30;
    this.nextAfter = next;
    this.flyers = this.cards.map((c, i) => ({ c, x0: c.x + c.w / 2, y0: c.y + c.h / 2, x1, y1, t: -i * 0.07, dur: 0.55 }));
    this.cards = [];
    g.audio.play('ui_buy', { vol: 0.6 });
  }
  afterCollect() {
    const ui = this.game.ui;
    if (this.nextAfter && (inventory(this.game.state).packages || []).length) this.open({});
    else ui.close(this.id);
  }
}

// chunky gold pixel lock plate (radius R) with a keyhole and a tick ring
function lockPlate(R) {
  const S = R * 2 + 8;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > R + 3) continue;
    let col;
    if (d > R + 1) col = '#5a3608';
    else if (d > R - 2) col = dy < 0 ? '#fff2b8' : '#c88a26';
    else {
      const l = (-dx * 0.6 - dy * 0.8) / R;
      col = l > 0.45 ? '#ffe98a' : l > 0.05 ? '#ffd04a' : l > -0.4 ? '#e0a020' : '#a8680e';
      if (Math.abs(d - R * 0.72) < 1 && (Math.round(Math.atan2(dy, dx) * 6 / Math.PI) % 2 === 0)) col = '#8a5418';
    }
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }
  // keyhole
  g.fillStyle = '#2a1408';
  for (let y = -6; y <= 4; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 20) g.fillRect(Math.round(cx + x), Math.round(cy - 6 + y), 1, 1);
  g.fillRect(Math.round(cx - 3), Math.round(cy - 4), 7, 14);
  g.fillStyle = '#6a3a10'; g.fillRect(Math.round(cx - 3), Math.round(cy - 4), 1, 14);
  return c;
}
