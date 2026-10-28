// Pinch's Bait & Bits: a tiny underwater merchant stall. Left: a diorama with the stall prop and Pinch the
// crab behind the counter (talks, follows the cursor, celebrates sales). Right: wooden shelves with bait
// and aquarium decorations on price tags, a daily special (20% off) and an order slip with the Buy button.
// open({tab: 'bait'|'decor'})

import { clamp, clamp01, lerp, ease, TAU, formatCommas } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { rgba, shade } from '../core/color.js';
import { tinted } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawPlank, drawBubble, drawTab, drawStamp } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getProp, PROPS } from '../gfx/props.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { BAITS, BAIT_ORDER } from '../game/shopdata.js';
import { SKILLS, BRANCHES } from '../game/skills.js';
import { baitSprite } from '../fishing/baitart.js';
import { PINCH_LOOK } from './dock.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const LINES = {
  greet: ['Welcome, welcome! Click click!', 'Ah, a customer! Mind the claws.', 'Fresh bait! Fresh-ish bait! Bait!', "Pinch's Bait & Bits! How may I pinch you?"],
  idle: ['I sell bait AND emotional support.', "No refunds. Crabs can't count backwards.", 'Psst. The worms are unionising.', 'Business is... claw-some.', 'Your desktop is FULL of fish, you know.', 'I polish every pebble myself.'],
  buy: ['Pleasure doing business!', 'Sold! No take-backsies!', 'Ka-ching! I mean... click click!', 'Excellent choice. Truly crab-tivating.', 'Ooh, the fish will LOVE that.'],
  broke: ['Your wallet is lighter than plankton.', 'Come back with more shiny coins!', 'I take coins, not compliments.', "That's a 'no' from the cash shell."],
  locked: ['Ah-ah! Grow the right skill first.', 'Not for amateurs! Check the skill tree.', 'Top-shelf stuff. License required.'],
  special: ["Today's special! Cheaper than my rent!", "20% off! I must be out of my shell."],
  decor: ['Ooh, the {n}! Very fancy.', 'Your fish deserve a {n}.', '{n}: hand-picked from the seabed!', 'The {n}? Exquisite taste.'],
  fancy: ["Now THAT's a statement piece.", 'For the discerning fish collector.'],
};
const BAIT_QUIP = {
  bread: 'Day-old bread. Fresh for a fish!', worm: 'He glows, he wiggles, he has a family.', sugar: 'Puddings go absolutely bonkers for it.',
  golden: "Gold! Rare fish can't resist the bling.", flood: 'Water everywhere! Hold onto your icons.', blackhole: 'Do NOT drop this one near my shop.',
  chip: 'Overclocked. Mind the sparks!', popup: 'YOU WON! ...a fish. Probably.', lantern: 'A little light for the big dark.', relic: 'Something old wants to say hi...',
};
const DECOR_SCALE = { 1: 0.5, 2: 0.42, 3: 0.32 };

function unlockSkillFor(baitId) {
  return SKILLS.find((s) => s.effect.unlockBait?.includes(baitId)) || null;
}

function decorList() {
  return Object.entries(PROPS).filter(([, p]) => p.decor).map(([id, p]) => ({ id, name: p.name, price: p.decor.price, size: p.decor.size, biome: p.biome })).sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}

export class ShopPanel {
  constructor() {
    this.id = 'shop';
    this.modal = true;
    this.sound = 'box_open';
    this.tab = 'bait';
    this.page = 0;
    this.t = 0;
    this.decorSpr = {};
    this.decor = null;
  }

  open(data) {
    const g = this.game;
    this.t = 0;
    if (data?.tab === 'decor' || data?.tab === 'bait') this.tab = data.tab;
    this.decor ||= decorList();
    this.special = this.dailySpecial();
    this.sel = this.special?.tab === this.tab ? this.special.id : this.items()[0]?.id;
    this.hoverId = null;
    this.hoverT = 0;
    this.lastLine = -9;
    this.idleT = 6 + Math.random() * 4;
    this.mood = 'happy';
    this.moodT = 1.5;
    this.hop = 0;
    this.sold = 0;
    this.pop = {};
    this.flyers = [];
    this.say(pick(LINES.greet), 'happy');
    if (this.special && !g.stats.unlockBait.has(this.special.id) && this.special.tab === 'bait') this.special = null;
  }

  // Seeded by the calendar day: one discounted item for everyone today.
  dailySpecial() {
    const g = this.game;
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    const r = new RNG(day * 7919 + 1301);
    const pool = [
      ...BAIT_ORDER.filter((id) => id !== 'bread' && g.stats.unlockBait.has(id)).map((id) => ({ tab: 'bait', id })),
      ...this.decor.filter((d) => d.price >= 60).map((d) => ({ tab: 'decor', id: d.id })),
    ];
    const pickd = r.pick(pool.length ? pool : [{ tab: 'bait', id: 'bread' }]);
    return { ...pickd, off: 0.2 };
  }

  items() {
    const g = this.game;
    if (this.tab === 'bait') {
      return BAIT_ORDER.map((id) => {
        const b = BAITS[id];
        const locked = !g.stats.unlockBait.has(id);
        return { id, kind: 'bait', name: b.name, desc: b.desc, base: b.price, qty: b.qty, locked, skill: locked ? unlockSkillFor(id) : null };
      });
    }
    return this.decor.map((d) => ({ id: d.id, kind: 'decor', name: d.name, desc: decorDesc(d), base: d.price, size: d.size, locked: false }));
  }

  price(it) {
    const sp = this.special;
    return sp && sp.id === it.id ? Math.round(it.base * (1 - sp.off)) : it.base;
  }

  owned(it) {
    const st = this.game.state;
    if (it.kind === 'bait') return st.baits[it.id] || 0;
    const idOf = (d) => (typeof d === 'string' ? d : d?.id);
    return [...(st.tank?.decor || []), ...(st.tank?.stored || [])].filter((d) => idOf(d) === it.id).length;
  }

  say(text, mood = 'happy', dur) {
    this.line = text;
    this.lineT = 0;
    this.talkT = dur ?? clamp(text.length * 0.045, 0.8, 2.6);
    this.mood = mood;
    this.moodT = this.talkT + 0.8;
    this.lastLine = this.t;
    this.game.audio.babble?.(text, 'crab');
  }

  buy(it, x, y) {
    const g = this.game, st = g.state;
    const price = this.price(it);
    if (it.locked) {
      g.audio.play('ui_error');
      this.say(pick(LINES.locked), 'smug');
      return;
    }
    if (st.coins < price) {
      g.audio.play('ui_error');
      this.say(pick(LINES.broke), 'sad');
      this.shakeT = 0.4;
      return;
    }
    let ok = false;
    if (it.kind === 'bait') {
      if (price === it.base) ok = g.buyBait(it.id);
      else if (g.spendCoins(price)) {
        st.baits[it.id] = (st.baits[it.id] || 0) + it.qty;
        g.audio.play('ui_buy');
        g.emit('buy', it.id);
        ok = true;
      }
    } else if (g.spendCoins(price)) {
      if (!g.aquarium?.addDecor?.(it.id)) (st.tank.decor ||= []).push({ id: it.id, x: 0.2 + Math.random() * 0.6, z: 0.5 });
      g.audio.play('ui_buy');
      g.emit('buy', it.id);
      g.save?.();
      ok = true;
    }
    if (!ok) { this.say(pick(LINES.broke), 'sad'); return; }
    g.audio.play('coin_collect', { vol: 0.6 });
    this.say(this.special?.id === it.id ? 'A bargain! You robbed me! Hehe.' : pick(LINES.buy), 'happy');
    this.hop = 0.6;
    this.sold = 1;
    this.pop[it.id] = 0;
    const P = g.particles;
    if (x !== undefined) {
      for (let i = 0; i < 10; i++) P.sparkle(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 24, i % 2 ? '#fff6b0' : '#ffd25a', { layer: 'ui' });
      P.bubbles(x, y, 6, { layer: 'ui' });
    }
    // coins hop over to Pinch's claw
    if (this.pinchAt && x !== undefined) for (let i = 0; i < 5; i++) this.flyers.push({ x0: x, y0: y, x1: this.pinchAt.x + 10, y1: this.pinchAt.y, t: -i * 0.06, dur: 0.45 });
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    dt = Math.max(0, dt);
    this.t += dt;
    const t = this.t;
    const W = Math.min(g.screen.W - 20, 660), H = Math.min(g.screen.H - 56, 392);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) + 8, w: W, h: H };
    this.rect = { x: r.x, y: r.y - 28, w: W, h: H + 28 };

    drawWood(ctx, r.x, r.y, W, H, { tone: 'dark' });
    // ------------------------------------------------ diorama with the stall and Pinch
    const sc = { x: r.x + 9, y: r.y + 12, w: 200, h: H - 12 - 78 };
    this.drawScene(ctx, sc, t, dt, inp);
    // special card under the diorama
    this.drawSpecial(ctx, ui, { x: r.x + 9, y: r.y + H - 62, w: 200, h: 53 }, t);

    // hanging sign
    drawPlank(ctx, r.x + W / 2 - 92 + 105, r.y - 20, 184, 22, { rope: 8, label: "PINCH'S BAIT & BITS" });

    // ------------------------------------------------ goods
    const gx = r.x + 217, gw = W - 226;
    // tabs
    const tabs = [{ id: 'bait', label: 'Bait', icon: 'worm', color: '#c8503e' }, { id: 'decor', label: 'Decorations', icon: 'tank', color: '#3a7ab0' }];
    let tx = gx + 4;
    for (const tb of tabs) {
      const tw = measureText(tb.label) + 30;
      const tr = { x: tx, y: r.y + 10, w: tw, h: 20 };
      const hov = ui.hover(tr) && this.tab !== tb.id;
      drawTab(ctx, tr.x, tr.y, tr.w, tr.h, { label: tb.label, icon: tb.icon, active: this.tab === tb.id, hover: hov, color: tb.color });
      if (hov && inp.pressed) {
        inp.pressed = false;
        g.audio.play('ui_tab');
        this.tab = tb.id;
        this.page = 0;
        this.sel = this.special?.tab === tb.id ? this.special.id : this.items()[0]?.id;
        if (tb.id === 'decor' && t - this.lastLine > 1) this.say('Make your tank a home!', 'happy');
      }
      tx += tw + 2;
    }
    // coin purse
    const ctxt = formatCommas(Math.floor(this.ui?.coinShown ?? st.coins));
    const pw = measureText(ctxt) + 26;
    const px = r.x + W - pw - 30;
    this.pagerX = px - 66;
    drawWood(ctx, px, r.y + 10, pw, 17, { tone: 'light', nails: false, round: 2, planks: 1 });
    ctx.drawImage(getUiIcon('coin'), px + 5, r.y + 14);
    drawText(ctx, ctxt, px + pw - 6, r.y + 15, { align: 'right', color: '#fff3dc', shadow: '#2a160a' });
    if (ui.button(ctx, r.x + W - 25, r.y + 9, 18, 18, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    const board = { x: gx, y: r.y + 29, w: gw, h: H - 29 - 80 };
    this.drawShelves(ctx, ui, board, t, dt);
    this.drawSlip(ctx, ui, { x: gx, y: r.y + H - 74, w: gw, h: 64 }, t, dt);

    // coin flyers
    for (const f of this.flyers) {
      f.t += dt;
      if (f.t < 0) continue;
      const k = ease.inOutQuad(clamp01(f.t / f.dur));
      ctx.drawImage(getUiIcon('coin'), Math.round(lerp(f.x0, f.x1, k) - 4), Math.round(lerp(f.y0, f.y1, k) - Math.sin(k * Math.PI) * 26 - 4));
      if (f.t >= f.dur && !f.done) { f.done = true; g.audio.play('coin_bounce', { vol: 0.3, pitch: 1.2 + Math.random() * 0.3 }); }
    }
    this.flyers = this.flyers.filter((f) => f.t < f.dur);

    // idle chatter
    this.idleT -= dt;
    if (this.idleT <= 0) { this.idleT = 9 + Math.random() * 6; if (t - this.lastLine > 5) this.say(pick(LINES.idle), pick(['smug', 'happy', 'neutral'])); }
  }

  drawScene(ctx, sc, t, dt, inp) {
    const g = this.game;
    ctx.save();
    ctx.beginPath(); ctx.rect(sc.x, sc.y, sc.w, sc.h); ctx.clip();
    const grd = ctx.createLinearGradient(0, sc.y, 0, sc.y + sc.h);
    grd.addColorStop(0, '#4ab8d0'); grd.addColorStop(0.6, '#2a7aa0'); grd.addColorStop(1, '#1a5578');
    ctx.fillStyle = grd;
    ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const x0 = sc.x + 20 + i * 55 + Math.sin(t * 0.4 + i) * 6;
      ctx.fillStyle = rgba('#e8fbff', 0.05 + 0.02 * Math.sin(t + i * 2));
      ctx.beginPath(); ctx.moveTo(x0, sc.y); ctx.lineTo(x0 + 16, sc.y); ctx.lineTo(x0 - 30, sc.y + sc.h); ctx.lineTo(x0 - 46, sc.y + sc.h); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const ground = sc.y + sc.h - 10;
    const awY = sc.y + 52, wallTop = awY + 18, counterY = ground - 58;
    // kelp at the sides
    for (const [kx, ph] of [[sc.x + 6, 0], [sc.x + sc.w - 9, 2]]) {
      for (let y = 0; y < 120; y += 2) {
        ctx.fillStyle = y % 8 < 2 ? '#5ab85a' : '#3a8a4a';
        ctx.fillRect(Math.round(kx + Math.sin(y * 0.07 + t * 1.1 + ph) * 3), ground - y, 3, 2);
      }
    }
    // back wall + shelves of jars
    const wx = sc.x + 16, ww = sc.w - 32;
    drawWood(ctx, wx, wallTop, ww, counterY - wallTop + 6, { tone: 'dark', nails: false, planks: 5 });
    const shelfYs = [wallTop + 30, wallTop + 62];
    const jarBaits = ['worm', 'bread', 'sugar', 'golden', 'chip', 'lantern', 'popup', 'flood'];
    shelfYs.forEach((syy, si) => {
      drawWood(ctx, wx + 3, syy, ww - 6, 5, { tone: 'light', nails: false, planks: 1, seams: false, round: 0 });
      for (let j = 0; j < 4; j++) {
        const id = jarBaits[si * 4 + j];
        const jx = Math.round(wx + 10 + j * ((ww - 20) / 4)), jy = syy - 22;
        drawJar(ctx, jx, jy, 20, 22, false);
        const bs = baitSprite(id, t + j);
        ctx.drawImage(bs, Math.round(jx + 10 - bs.width), jy + 7, bs.width * 2, bs.height * 2);
        drawJarGlass(ctx, jx, jy, 20, 22);
      }
    });
    // hanging lantern
    const lx = sc.x + sc.w - 40 + Math.round(Math.sin(t * 1.3) * 1), ly = awY + 20;
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(lx + 3, awY + 14, 1, 7);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba('#ffd27a', 0.12 + 0.04 * Math.sin(t * 5));
    ctx.beginPath(); ctx.arc(lx + 3, ly + 5, 16, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#4a3010'; ctx.fillRect(lx, ly, 7, 10);
    ctx.fillStyle = '#ffd86a'; ctx.fillRect(lx + 1, ly + 2, 5, 6);
    ctx.fillStyle = '#fff6c8'; ctx.fillRect(lx + 2, ly + 3, 2, 3);
    // Pinch behind the counter
    this.pinch ||= compiled(PINCH_LOOK, null, 'pinch');
    this.talkT = Math.max(0, (this.talkT || 0) - dt);
    this.moodT = Math.max(0, (this.moodT || 0) - dt);
    this.hop = Math.max(0, this.hop - dt);
    this.shakeT = Math.max(0, (this.shakeT || 0) - dt);
    const hopY = this.hop > 0 ? -Math.abs(Math.sin(this.hop * 16)) * 7 * (this.hop / 0.6) : 0;
    const shake = this.shakeT > 0 ? Math.round(Math.sin(t * 60) * 2) : 0;
    const mood = this.moodT > 0 ? this.mood : 'neutral';
    const px = Math.round(sc.x + sc.w / 2 + shake), py = Math.round(counterY - 22 + hopY + Math.sin(t * 2) * 1);
    this.pinchAt = { x: px, y: py - 16 };
    const look = inp.inside ? inp.x : px + 40;
    const an = drawFishRig(ctx, this.pinch, {
      x: px, y: py, facing: look < px - 30 ? -1 : 1, turn: 1, angle: 0, scale: 2.5, squash: this.hop > 0 ? Math.sin(this.hop * 16) * 0.15 : Math.sin(t * 2.6) * 0.03,
      swimPhase: (t * 0.5) % 1, tailPhase: (t * 0.4) % 1, finPhase: (t * (this.talkT > 0 ? 2.6 : 0.6)) % 1, speed01: 0, inflate: 0,
      lookX: inp.inside ? inp.x : null, lookY: inp.inside ? inp.y : null, blink: (t % 3.7) < 0.12 ? 1 : 0, emotion: mood,
      mouth: this.talkT > 0 ? Math.abs(Math.sin(t * 13)) * 0.85 : mood === 'happy' ? 0.2 : 0.05, time: t,
    });
    drawPinchFace(ctx, an, look < px - 30 ? -1 : 1, 2.5, this.talkT > 0 ? Math.abs(Math.sin(t * 13)) : 0);
    // counter
    drawWood(ctx, sc.x + 10, counterY, sc.w - 20, ground - counterY + 2, { tone: 'light', planks: 4 });
    drawWood(ctx, sc.x + 6, counterY - 3, sc.w - 12, 6, { tone: 'light', nails: false, planks: 1, seams: false, round: 1 });
    // service bell + coin dish on the counter
    const bx = sc.x + 30, by = counterY - 9;
    ctx.fillStyle = '#3e2210'; ctx.fillRect(bx - 1, by + 4, 14, 3);
    ctx.fillStyle = '#e0a844'; ctx.fillRect(bx + 1, by, 10, 5); ctx.fillRect(bx + 3, by - 1, 6, 1);
    ctx.fillStyle = '#fff2b8'; ctx.fillRect(bx + 2, by + 1, 3, 1); ctx.fillRect(bx + 5, by - 3, 2, 2);
    ctx.fillStyle = '#7a4a1c'; ctx.fillRect(bx, by + 6, 12, 1);
    const dx = sc.x + sc.w - 46, dy = counterY - 5;
    ctx.fillStyle = '#e8b8a8'; ctx.fillRect(dx, dy, 16, 4); ctx.fillStyle = '#b8786a'; ctx.fillRect(dx + 1, dy + 3, 14, 1);
    const coin = getUiIcon('coin');
    for (let i = 0; i < 3; i++) ctx.drawImage(coin, dx + 1 + i * 4, dy - 5 - (i % 2) * 2);
    this.bellAt = { x: bx - 2, y: by - 4, w: 16, h: 12 };
    // sand
    ctx.fillStyle = '#c8a86a'; ctx.fillRect(sc.x, ground, sc.w, 12);
    ctx.fillStyle = '#e8cf95';
    for (let x = 0; x < sc.w; x += 2) ctx.fillRect(sc.x + x, ground - 1 + Math.round(Math.sin(x * 0.07) * 1), 2, 3);
    // awning (red/cream stripes, scalloped and swaying)
    for (let x = 0; x < sc.w; x++) {
      const stripe = Math.floor((x + 4) / 12) % 2;
      const sway = Math.round(Math.sin(t * 1.6 + x * 0.05) * 0.8);
      const sc6 = ((x + 4) % 12) - 6;
      const scallop = Math.round(Math.sqrt(Math.max(0, 36 - sc6 * sc6)) * 0.6);
      const h = 14 + scallop + sway;
      ctx.fillStyle = stripe ? '#fff0dc' : '#e0484a';
      ctx.fillRect(sc.x + x, awY, 1, h);
      ctx.fillStyle = stripe ? '#e8d0b8' : '#a8283a';
      ctx.fillRect(sc.x + x, awY + h - 1, 1, 1);
      ctx.fillStyle = stripe ? '#ffffff' : '#ff7a6a';
      ctx.fillRect(sc.x + x, awY + 1, 1, 1);
    }
    ctx.fillStyle = '#5a1a1a'; ctx.fillRect(sc.x, awY - 2, sc.w, 2);
    ctx.fillStyle = '#8a4a2a'; ctx.fillRect(sc.x, awY - 4, sc.w, 2);
    if (Math.random() < dt * 1.2) g.particles.bubble(sc.x + 10 + Math.random() * (sc.w - 20), ground - 2, { layer: 'ui', life: 3, vy: -12 });
    ctx.restore();
    // ding the bell
    const ui = this.ui;
    if (ui.hover(this.bellAt)) {
      ui.tip = 'Ring for service';
      if (inp.pressed) { inp.pressed = false; g.audio.play('bell', { vol: 0.6 }); this.say(pick(['Yes yes, I\'m right here!', 'Ding! What can I pinch for you?', 'Service with a snip!']), 'surprised'); this.hop = 0.4; }
    }
    // frame around the diorama
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(sc.x - 1, sc.y - 1, sc.w + 2, 1); ctx.fillRect(sc.x - 1, sc.y + sc.h, sc.w + 2, 1);
    ctx.fillRect(sc.x - 1, sc.y, 1, sc.h); ctx.fillRect(sc.x + sc.w, sc.y, 1, sc.h);
    ctx.fillStyle = rgba('#bfefff', 0.3);
    ctx.fillRect(sc.x, sc.y, sc.w, 1);
    // speech bubble
    if (this.line) {
      this.lineT += dt;
      const shown = this.line.slice(0, Math.floor(this.lineT * 40));
      const lines = wrapText(this.line, sc.w - 34);
      const bh = lines.length * 10 + 12, bw = Math.min(sc.w - 16, Math.max(...lines.map((l) => measureText(l))) + 20);
      const bx2 = Math.round(sc.x + sc.w / 2 - bw / 2), by2 = Math.round(sc.y + 6);
      const fade = this.lineT > 7 ? clamp01(1 - (this.lineT - 7) * 2) : 1;
      if (fade <= 0) this.line = null;
      else {
        ctx.globalAlpha = Math.min(1, this.lineT * 8) * fade;
        const cr = drawBubble(ctx, bx2, by2, bw, bh, { tailX: px + 6, tailY: by2 + bh + 8 });
        let left = shown.length;
        lines.forEach((l, i) => {
          const s = l.slice(0, Math.max(0, left));
          left -= l.length + 1;
          drawText(ctx, s, cr.x + 3, cr.y + 2 + i * 10, { color: '#3a2a22' });
        });
        ctx.globalAlpha = 1;
      }
    }
  }

  drawSpecial(ctx, ui, rr, t) {
    const sp = this.special;
    drawPaper(ctx, rr.x, rr.y, rr.w, rr.h, { aged: true });
    // pin
    ctx.fillStyle = '#a8203a'; ctx.fillRect(rr.x + rr.w / 2 - 2, rr.y - 2, 4, 4);
    ctx.fillStyle = '#ff6a7a'; ctx.fillRect(rr.x + rr.w / 2 - 2, rr.y - 2, 2, 2);
    drawText(ctx, "TODAY'S SPECIAL", rr.x + 8, rr.y + 6, { font: 'small', color: '#a8283a' });
    if (!sp) return;
    const it = (sp.tab === 'bait' ? this.itemsFor('bait') : this.itemsFor('decor')).find((q) => q.id === sp.id);
    if (!it) return;
    const bob = Math.round(Math.sin(t * 3) * 1);
    if (it.kind === 'bait') {
      const s = baitSprite(it.id, t);
      ctx.drawImage(s, rr.x + 10, rr.y + 18 + bob, s.width * 3, s.height * 3);
    } else {
      const d = this.decorSprite(it, 36, 30);
      if (d) ctx.drawImage(d.canvas, Math.round(rr.x + 24 - d.w / 2), Math.round(rr.y + rr.h - 5 - d.h) + bob);
    }
    drawText(ctx, it.name, rr.x + 44, rr.y + 16, { color: '#2a1a10' });
    const np = this.price(it);
    drawText(ctx, `${formatCommas(it.base)}`, rr.x + 44, rr.y + 29, { color: '#9a7a5a' });
    const ow = measureText(formatCommas(it.base));
    ctx.fillStyle = '#c8283a';
    ctx.fillRect(rr.x + 43, rr.y + 32, ow + 2, 1);
    drawText(ctx, `${formatCommas(np)}{coin}`, rr.x + 50 + ow, rr.y + 29, { color: '#2a6a3a' });
    drawStamp(ctx, rr.x + rr.w - 24, rr.y + 28, '-20%', { color: '#d8283a', angle: -0.2 });
    const hov = ui.hover(rr);
    if (hov) {
      ui.tip = 'Click to see the special';
      if (this.game.input.pressed) {
        this.game.input.pressed = false;
        this.game.audio.play('ui_click');
        if (this.tab !== sp.tab) { this.tab = sp.tab; this.page = 0; }
        this.sel = sp.id;
        const idx = this.items().findIndex((q) => q.id === sp.id);
        if (this.tab === 'decor') this.page = Math.floor(idx / 15);
        this.say(pick(LINES.special), 'love');
      }
    }
  }

  itemsFor(tab) { const keep = this.tab; this.tab = tab; const it = this.items(); this.tab = keep; return it; }

  decorSprite(it, maxW, maxH) {
    const key = `${it.id}|${maxW}|${maxH}`;
    let d = this.decorSpr[key];
    if (d) return d;
    // build at most one prop per frame (voxel props are expensive)
    if (this.builtFrame === this.t) return null;
    this.builtFrame = this.t;
    let s = DECOR_SCALE[it.size] || 0.4;
    let p = getProp(it.id, { scale: s });
    const k = Math.min(maxW / p.w, maxH / p.h);
    if (k < 1) { s = Math.max(0.12, Math.floor(s * k * 20) / 20); p = getProp(it.id, { scale: s }); }
    d = this.decorSpr[key] = { canvas: p.canvas, w: p.w, h: p.h, ox: p.ox, oy: p.oy };
    return d;
  }

  drawShelves(ctx, ui, b, t, dt) {
    const g = this.game, inp = g.input;
    drawWood(ctx, b.x, b.y, b.w, b.h, { tone: 'dark', inset: true, nails: false });
    const items = this.items();
    const cols = this.tab === 'bait' ? 4 : 5, rows = 3, per = cols * rows;
    const pages = Math.max(1, Math.ceil(items.length / per));
    this.page = clamp(this.page, 0, pages - 1);
    if (inp.wheel && ui.hover(b) && pages > 1) {
      const np = clamp(this.page + Math.sign(inp.wheel), 0, pages - 1);
      if (np !== this.page) { this.page = np; g.audio.play('ui_page'); }
    }
    const ix = b.x + 6, iw = b.w - 12, iy = b.y + 6, ih = b.h - 14;
    const cw = Math.floor(iw / cols), rh = Math.floor(ih / rows);
    let hov = null;
    for (let rI = 0; rI < rows; rI++) {
      const shelfY = iy + (rI + 1) * rh - 16;
      // shelf plank
      drawWood(ctx, ix - 2, shelfY, iw + 4, 6, { tone: 'light', nails: false, planks: 1, seams: false, round: 0 });
      ctx.fillStyle = rgba('#000000', 0.35);
      ctx.fillRect(ix - 2, shelfY + 6, iw + 4, 2);
      for (let c = 0; c < cols; c++) {
        const i = this.page * per + rI * cols + c;
        const it = items[i];
        if (!it) continue;
        const cx = ix + c * cw + cw / 2;
        const cell = { x: ix + c * cw + 2, y: shelfY - rh + 18, w: cw - 4, h: rh - 4 };
        const isHov = ui.hover(cell);
        if (isHov) hov = it;
        this.drawItem(ctx, it, cx, shelfY, cell, isHov, t, dt);
        if (isHov && inp.pressed) {
          inp.pressed = false;
          if (inp.dblclick && this.sel === it.id) { inp.dblclick = false; this.buy(it, cx, shelfY - 14); }
          else { if (this.sel !== it.id) g.audio.play('ui_click', { vol: 0.7 }); this.sel = it.id; this.pop[it.id] = 0; }
        }
      }
    }
    // pager (top-right of the shelf board)
    if (pages > 1) {
      const py = b.y - 14, pxr = this.pagerX ?? b.x + b.w - 60;
      drawText(ctx, `${this.page + 1}/${pages}`, pxr + 26, py + 3, { align: 'center', font: 'small', color: '#f4d8a8' });
      for (const [dir, ax, icon] of [[-1, pxr, 'arrow_l'], [1, pxr + 40, 'arrow_r']]) {
        const ar = { x: ax - 2, y: py - 2, w: 15, h: 13 };
        const can = dir < 0 ? this.page > 0 : this.page < pages - 1;
        const h = can && ui.hover(ar);
        ctx.globalAlpha = can ? (h ? 1 : 0.8) : 0.25;
        ctx.drawImage(getUiIcon(icon), ax, py - (h ? 1 : 0));
        ctx.globalAlpha = 1;
        if (h) ui.tip = dir < 0 ? 'Previous shelf' : 'Next shelf';
        if (h && inp.pressed) { inp.pressed = false; this.page += dir; g.audio.play('ui_page'); }
      }
    }
    // hover chatter
    const hid = hov?.id || null;
    if (hid !== this.hoverId) { this.hoverId = hid; this.hoverT = 0; this.quipped = false; }
    this.hoverT += dt;
    if (hov && !this.quipped && this.hoverT > 0.45 && this.t - this.lastLine > 2.2) {
      this.quipped = true;
      if (hov.locked) this.say(`Grow '${hov.skill?.name || 'a skill'}' and it's yours!`, 'smug');
      else if (hov.kind === 'bait') this.say(BAIT_QUIP[hov.id] || 'Fine bait, this.', 'happy');
      else if (this.price(hov) >= 500) this.say(pick(LINES.fancy), 'love');
      else this.say(pick(LINES.decor).replace('{n}', hov.name), 'happy');
    }
    if (hov) {
      ui.tip = hov.locked ? `${hov.name} (locked)` : `${hov.name} - double-click to buy`;
    }
  }

  drawItem(ctx, it, cx, shelfY, cell, hov, t, dt) {
    const sel = this.sel === it.id;
    const special = this.special?.id === it.id;
    let pop = 0;
    if (this.pop[it.id] !== undefined) {
      this.pop[it.id] += dt;
      pop = Math.sin(clamp01(this.pop[it.id] / 0.35) * Math.PI) * 4;
      if (this.pop[it.id] > 0.35) delete this.pop[it.id];
    }
    const lift = (hov ? 2 : 0) + pop + (sel ? Math.abs(Math.sin(t * 3)) * 1 : 0);
    // selection glow on the shelf
    if (sel || hov) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(sel ? '#ffe27a' : '#ffffff', sel ? 0.12 : 0.07);
      ctx.beginPath(); ctx.ellipse(cx, shelfY, cell.w / 2 - 4, 10, 0, Math.PI, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (it.kind === 'bait') {
      const s = baitSprite(it.id, t + cx);
      const k = 4, w = s.width * k, h = s.height * k;
      const jw = Math.max(38, w + 10), jh = Math.max(42, h + 14);
      const jx = Math.round(cx - jw / 2), jy = Math.round(shelfY - jh - lift);
      ctx.fillStyle = rgba('#000000', 0.3);
      ctx.fillRect(jx + 2, shelfY - 1, jw - 4, 1);
      drawJar(ctx, jx, jy, jw, jh, it.locked);
      const x = Math.round(cx - w / 2), y = Math.round(jy + 5 + (jh - 5 - h) / 2 + (it.locked ? 0 : Math.sin(t * 2 + cx) * 1));
      if (it.locked) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(tinted(s, '#2a3040'), x, y, w, h);
        ctx.globalAlpha = 1;
      } else ctx.drawImage(s, x, y, w, h);
      drawJarGlass(ctx, jx, jy, jw, jh);
      if (it.locked) ctx.drawImage(getUiIcon('lock'), Math.round(cx - 4), jy + 1);
      else drawText(ctx, `x${it.qty}`, jx + jw - 2, jy + jh - 9, { font: 'small', align: 'right', color: '#ffffff', outline: '#1a0e06' });
    } else {
      const d = this.decorSprite(it, cell.w - 6, cell.h - 22);
      if (d) {
        ctx.fillStyle = rgba('#000000', 0.3);
        ctx.fillRect(Math.round(cx - d.w / 3), shelfY - 1, Math.round(d.w * 0.66), 1);
        ctx.drawImage(d.canvas, Math.round(cx - d.ox), Math.round(shelfY + 1 - d.oy - lift));
      } else {
        // still unpacking: a bobbing bubble
        const r = 5 + Math.sin(t * 4 + cx) * 1;
        ctx.strokeStyle = rgba('#bfefff', 0.6);
        ctx.beginPath(); ctx.arc(cx, shelfY - 14, r, 0, TAU); ctx.stroke();
      }
      const n = this.owned(it);
      if (n) drawText(ctx, `x${n}`, cx + cell.w / 2 - 6, shelfY - 9, { font: 'small', align: 'right', color: '#9affc8', outline: '#1a0e06' });
    }
    // price tag hanging under the shelf
    const price = this.price(it);
    const label = it.locked ? 'LOCKED' : formatCommas(price);
    const tw = measureText(label, 'small') + (it.locked ? 8 : 15);
    const tx = Math.round(cx - tw / 2), ty = shelfY + 9;
    ctx.fillStyle = '#d8c8a0';
    ctx.fillRect(Math.round(cx), shelfY + 6, 1, 3);
    const tagCol = special ? '#e8505a' : it.locked ? '#8a8078' : '#f4e6c4';
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(tx - 1, ty - 1, tw + 2, 11);
    ctx.fillStyle = tagCol;
    ctx.fillRect(tx, ty, tw, 9);
    ctx.fillStyle = shade(tagCol, 0.4);
    ctx.fillRect(tx, ty, tw, 1);
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(Math.round(cx), ty + 2, 1, 1);
    drawText(ctx, label, tx + 4, ty + 3, { font: 'small', color: special ? '#ffffff' : it.locked ? '#3a3430' : '#3a2414' });
    if (!it.locked) ctx.drawImage(getUiIcon('coin'), tx + tw - 10, ty);
    if (special) drawStamp(ctx, cx + cell.w / 2 - 14, shelfY - cell.h + 34, 'SALE', { color: '#e8283a', angle: 0.25, font: 'small' });
  }

  drawSlip(ctx, ui, rr, t, dt) {
    const g = this.game, st = g.state;
    drawPaper(ctx, rr.x, rr.y, rr.w, rr.h, { lined: true });
    const it = this.items().find((q) => q.id === this.sel);
    if (!it) { drawText(ctx, 'Pick something off the shelf!', rr.x + 12, rr.y + 26, { color: '#6a5444' }); return; }
    const price = this.price(it);
    drawText(ctx, it.name, rr.x + 10, rr.y + 6, { color: '#2a1a10' });
    const special = this.special?.id === it.id;
    if (special) drawText(ctx, "TODAY'S SPECIAL -20%", rr.x + 16 + measureText(it.name), rr.y + 7, { font: 'small', color: '#c8283a' });
    const descW = rr.w - 140;
    let lines = wrapText(it.locked ? `${it.desc}` : it.desc, descW);
    lines = lines.slice(0, 3);
    lines.forEach((l, i) => drawText(ctx, l, rr.x + 10, rr.y + 18 + i * 9, { color: '#6a5444', font: 'normal' }));
    // footer info
    let info;
    if (it.locked) info = it.skill ? `Unlock: grow '${it.skill.name}' (${BRANCHES[it.skill.branch].name})` : 'Locked';
    else if (it.kind === 'bait') info = `Pack of ${it.qty}  -  you have ${this.owned(it)}`;
    else info = `${['', 'Small', 'Medium', 'Large'][it.size] || ''} decoration  -  in your tank: ${this.owned(it)}`;
    drawText(ctx, info, rr.x + 10, rr.y + rr.h - 12, { font: 'small', color: it.locked ? '#a8283a' : '#8a6a4a' });
    // price + buy
    const bx = rr.x + rr.w - 122, by = rr.y + rr.h - 30;
    if (special) {
      const os = formatCommas(it.base);
      drawText(ctx, os, bx + 2, rr.y + 7, { color: '#9a7a5a' });
      ctx.fillStyle = '#c8283a';
      ctx.fillRect(bx + 1, rr.y + 10, measureText(os) + 2, 1);
    }
    const afford = st.coins >= price;
    const label = it.locked ? 'Locked' : `Buy ${formatCommas(price)}{coin}`;
    const r = { x: bx, y: by, w: 114, h: 22 };
    const brokeClick = !it.locked && !afford && ui.hover(r) && g.input.pressed;
    const lockClick = it.locked && ui.hover(r) && g.input.pressed;
    if (ui.button(ctx, bx, by, 114, 22, label, { style: 'coral', disabled: it.locked || !afford, tip: it.locked ? 'Grow the skill first' : afford ? `Buy ${it.name}` : `You need ${formatCommas(price - st.coins)} more coins`, sound: 'ui_click' })) {
      this.buy(it, bx + 57, by);
    } else if (brokeClick) { this.say(pick(LINES.broke), 'sad'); this.shakeT = 0.4; }
    else if (lockClick) this.say(pick(LINES.locked), 'smug');
    // SOLD stamp
    if (this.sold > 0) {
      this.sold = Math.max(0, this.sold - dt * 0.9);
      const k = 1 - this.sold;
      ctx.globalAlpha = clamp01(this.sold * 3);
      drawStamp(ctx, rr.x + rr.w - 64, rr.y + 22, 'SOLD!', { color: '#2a8a4a', angle: -0.2, scale: lerp(1.8, 1, ease.outCubic(clamp01(k * 4))) });
      ctx.globalAlpha = 1;
    }
  }
}

// Pinch's handlebar mustache and talking mouth, drawn over the rig's shell.
const MUSTACHE = [
  'xx....................xx',
  'xhx..xxxxxx..xxxxxx..xhx',
  '.xXxxXhhhhXxxXhhhhXxxXx.',
  '..xXXXXXXXXXXXXXXXXXXx..',
  '...xXXXXXxx..xxXXXXXx...',
  '....xxxxx......xxxxx....',
];
function drawPinchFace(ctx, an, facing, scale, talk) {
  if (!an?.top) return;
  // the crab rig's mouth sits at (cx + rx * 0.52, body centre); the mustache goes right above it
  const L = 26 * scale, H = 17 * scale;
  const mx = an.top[0] + facing * L * 0.5 * 0.52, my = an.top[1] + H / 2 + H * 0.6 - 1;
  const w = MUSTACHE[0].length;
  const ox = Math.round(mx - w / 2), oy = Math.round(my - 9 - (talk > 0.6 ? 1 : 0));
  MUSTACHE.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'x' ? '#2a120a' : ch === 'h' ? '#a8683a' : '#6a3a1e';
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

// Glass jar: back + lid first (drawJar), glass front with highlights after the contents (drawJarGlass).
function drawJar(ctx, x, y, w, h, locked) {
  ctx.fillStyle = '#0e2a36';
  ctx.fillRect(x, y + 4, w, h - 4);
  ctx.fillRect(x + 1, y + 3, w - 2, 1);
  ctx.fillStyle = locked ? '#6a7484' : '#3a8aa0';
  ctx.fillRect(x + 1, y + 5, w - 2, h - 6);
  ctx.fillStyle = locked ? '#8a94a2' : '#5ab0c4';
  ctx.fillRect(x + 1, y + 7, w - 2, h - 8);
  ctx.fillStyle = locked ? '#7a8492' : '#4aa0b8';
  ctx.fillRect(x + 1, y + h - 6, w - 2, 4);
  if (locked) {
    // frosted glass streaks
    ctx.fillStyle = rgba('#d8e0ea', 0.5);
    for (let i = 0; i < w + h; i += 6) for (let k = 0; k < 4; k++) {
      const px = x + 1 + i - k, py = y + 7 + k;
      if (px > x && px < x + w - 1) ctx.fillRect(px, py, 1, 1);
    }
  }
  // lid
  ctx.fillStyle = locked ? '#5a5a62' : '#b8782a';
  ctx.fillRect(x + 2, y, w - 4, 4);
  ctx.fillStyle = locked ? '#8a8a92' : '#f6d27a';
  ctx.fillRect(x + 2, y, w - 4, 1);
  ctx.fillStyle = locked ? '#2a2a30' : '#7a4a1c';
  ctx.fillRect(x + 2, y + 3, w - 4, 1);
}
function drawJarGlass(ctx, x, y, w, h) {
  ctx.fillStyle = rgba('#ffffff', 0.55);
  ctx.fillRect(x + 2, y + 6, 1, h - 9);
  ctx.fillRect(x + 3, y + 6, 1, 3);
  ctx.fillStyle = rgba('#ffffff', 0.25);
  ctx.fillRect(x + w - 4, y + 7, 1, h - 11);
  ctx.fillStyle = rgba('#bfefff', 0.35);
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
}

function decorDesc(d) {
  const where = { shallows: 'Found in the Sunny Shallows.', junkyard: 'Salvaged from Junkyard Reef.', abyss: 'Hauled up from the Midnight Abyss.', aquarium: 'A classic aquarium ornament.' }[d.biome] || '';
  const size = ['', 'A small touch', 'A handsome centrepiece', 'A grand landmark'][d.size] || 'A decoration';
  return `${size} for your aquarium. ${where} Fish love to explore it.`;
}
