// Gil's Dressing Room: the character customisation panel (id 'wardrobe').
// Left: a little changing room (velvet curtains, a vanity mirror with bulbs that shows Gil's back, a
// turntable pedestal) with Gil posing on it - drag to spin him, pose buttons underneath, pupils follow the
// cursor. Middle: a dresser whose drawers are the slots. Right: a clothes rack of item cards (voxel
// thumbnails, price tags, rarity ribbons) and an order slip with Buy / Equip / Randomize / Reset.
// Unowned items are tried on in the preview; buying uses game.spendCoins and stores ownership in
// game.state.cosmetics, choices in game.state.character.
// open({slot: 'hat'|...})

import { clamp, clamp01, lerp, ease, TAU, formatCommas, bayer } from '../core/math.js';
import { rgba, shade, mix, RARITY } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawPlank, drawBubble, drawFrame, drawStamp } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import {
  drawCharacter, WARDROBE, WARDROBE_SLOTS, DEFAULT_CHARACTER, normalizeLook, ownsCosmetic, grantCosmetic, equipItem, isEquipped,
  itemPreview, drawItemPreview,
} from '../gfx/character.js';
import { compiled } from '../gfx/spritecache.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { SKILL_BY_ID } from '../game/skills.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const LINES = {
  open: ['Time for a makeover!', 'Do these fins look big in this?', 'Fashion is my passion. Also fish.', 'Ooh, the dressing room!', 'Make me look fin-tastic!'],
  equip: ['Fin-tastic!', "Oh, that's SO me.", 'Snazzy!', 'Gill-iant choice!', 'Very dapper. Very damp.', 'Looking sharp as a fishhook!', 'Scale-tacular!'],
  tryon: ['Ooh, can I keep it?', 'Hmm, try before you buy!', 'This one feels... expensive.', 'Do I look rich yet?'],
  buy: ['Ka-ching! Lookin\' sharp!', 'Worth every coin!', 'Into the closet it goes!', 'New threads! Blub blub!'],
  broke: ['My wallet is lighter than a minnow...', 'Need more coins. Back to fishing!', 'Can I pay in fish?'],
  pkg: ['Only found in mystery crates!', 'Crack open some crates to find this!'],
  random: ['Surprise me!', 'Wardrobe roulette!', 'Chaos mode!', 'Eyes closed... GO!'],
  reset: ['Back to the classic!', 'Old reliable.'],
  spin: ['Wheee!', "I'm getting dizzy...", 'Spin me right round!', 'Blurgh. Too fast.'],
  mirror: ["Who's the fishiest of them all?", 'Lookin\' fishy!', 'Hey there, handsome.', 'Nice fins, pal.'],
  poke: ['Hey! That tickles!', 'Blub?', 'Personal space, please!', 'Hehehe.'],
};
const SLOT_SOUND = { skin: 'blub', eyes: 'boing', mouth: 'honk', hat: 'boing', outfit: 'puff', boots: 'squeak', gloves: 'squeak', acc: 'bell', rod: 'reel_tick', boat: 'splash_small' };
const POSE_BTNS = [['show', 'Pose'], ['wave', 'Wave'], ['cheer', 'Cheer'], ['cast', 'Cast'], ['reel', 'Reel'], ['sit', 'Sit'], ['sad', 'Sad'], ['hold', 'Hold']];
const POSE_SOUND = { wave: 'chirp', cheer: 'honk', cast: 'cast', reel: 'reel', sit: 'puff', sad: 'deflate', hold: 'catch', show: 'boing' };
const THUMB = { skin: 1.25, eyes: 1.25, mouth: 1.25, hat: 0.95, outfit: 0.9, acc: 0.9, boots: 1.6, gloves: 1.7, rod: 0.95 };
const HEAD_ACC = new Set(['sunglasses', 'snorkel', 'monocle', 'mustache', 'earring']);

export class WardrobePanel {
  constructor() {
    this.id = 'wardrobe';
    this.modal = true;
    this.sound = 'box_open';
    this.slot = 'hat';
    this.t = 0;
    this.yaw = -24;
    this.yawV = 0;
    this.drag = null;
    this.pose = 'show';
    this.poseT = 0;
    this.sel = null;
    this.line = null;
    this.pop = {};
    this.cache = {};
  }

  open(data) {
    const g = this.game;
    if (data?.slot && WARDROBE_SLOTS.some((s) => s.id === data.slot)) this.slot = data.slot;
    this.t = 0;
    this.openT = 0;
    this.pose = 'show';
    this.poseT = 0;
    this.yaw = -24;
    this.yawV = 0;
    this.idleT = 0;
    this.spin = 0;
    this.sold = 0;
    this.selectEquipped();
    this.say(pick(LINES.open));
    g.audio.play('net_swish', { vol: 0.5 });
    if (!g.state.character) g.state.character = normalizeLook(null);
  }

  close() { this.drag = null; }

  get look() { return normalizeLook(this.game.state.character); }

  items(slot = this.slot) { return WARDROBE.filter((w) => w.slot === slot); }

  owns(item) { return ownsCosmetic(this.game.state, item); }

  selectEquipped() {
    const L = this.look;
    const list = this.items();
    this.sel = (list.find((w) => isEquipped(L, w)) || list[0])?.id;
  }

  selItem() { return WARDROBE.find((w) => w.id === this.sel) || null; }

  // What the mannequin wears: the saved look plus the item being tried on.
  previewLook() {
    const L = this.look;
    const it = this.selItem();
    if (it && !this.owns(it) && !isEquipped(L, it)) return equipItem(L, it);
    return L;
  }

  say(text, dur) {
    this.line = text;
    this.lineT = 0;
    this.talkT = dur ?? clamp(text.length * 0.05, 0.9, 2.6);
    this.game.audio.babble?.(text, 'fish');
  }

  // auto poses (reactions) fall back to the showcase pose; picked poses stay until changed
  setPose(p, auto = true) {
    this.pose = p;
    this.poseT = 0;
    this.autoPose = auto && p !== 'show';
  }

  equip(item) {
    const g = this.game;
    g.state.character = equipItem(this.look, item);
    g.audio.play(SLOT_SOUND[item.slot] || 'ui_click', { vol: 0.7, pitch: 0.9 + Math.random() * 0.3 });
    this.pop[item.id] = 0;
    this.burst(item.slot === 'boat' ? '#7fe0ff' : '#fff6b0', 8);
    if (this.t - (this.lastSay || -9) > 1.2) { this.say(pick(LINES.equip)); this.lastSay = this.t; }
    if (Math.random() < 0.35 && this.pose === 'show') this.setPose('cheer');
    this.changed();
  }

  changed() {
    const g = this.game;
    g.save?.();
    g.emit?.('character', g.state.character);
  }

  buy(item) {
    const g = this.game;
    if (this.owns(item)) return;
    if (item.price == null) {
      g.audio.play('ui_error');
      if (item.unlock === 'skill') this.say(`Grow '${SKILL_BY_ID[item.skill]?.name || 'a skill'}' to unlock this!`);
      else this.say(pick(LINES.pkg));
      return;
    }
    if (g.state.coins < item.price || !g.spendCoins(item.price)) {
      g.audio.play('ui_error');
      this.say(pick(LINES.broke));
      this.shakeT = 0.4;
      this.setPose('sad');
      return;
    }
    grantCosmetic(g.state, item.id);
    g.audio.play('ui_buy');
    g.audio.play('coin_collect', { vol: 0.6 });
    if (item.rarity === 'epic' || item.rarity === 'legendary') g.audio.play('catch_rare', { vol: 0.5 });
    this.sold = 1;
    this.say(pick(LINES.buy));
    g.emit?.('buy', item.id);
    this.equip(item);
    this.setPose('cheer');
    this.burst('#ffd25a', 16);
  }

  randomize() {
    const g = this.game, st = g.state;
    let L = this.look;
    for (const s of WARDROBE_SLOTS) {
      if (s.id === 'acc') continue;
      const own = this.items(s.id).filter((w) => this.owns(w));
      if (own.length) L = equipItem(L, pick(own));
    }
    L.acc = [];
    const accs = this.items('acc').filter((w) => this.owns(w));
    for (let i = 0; i < 3 && accs.length; i++) if (Math.random() < 0.45) L = equipItem(L, pick(accs));
    st.character = normalizeLook(L);
    g.audio.play('boing', { pitch: 1.2 });
    g.audio.play('puff', { vol: 0.6 });
    this.spin = 1;
    this.yawV = 900;
    this.say(pick(LINES.random));
    this.setPose('cheer');
    this.burst('#ff9ad0', 14);
    this.selectEquipped();
    this.changed();
  }

  reset() {
    const g = this.game;
    g.state.character = normalizeLook({ ...DEFAULT_CHARACTER, boat: this.look.boat });
    g.audio.play('puff');
    this.say(pick(LINES.reset));
    this.setPose('wave');
    this.selectEquipped();
    this.changed();
  }

  burst(color, n) {
    const P = this.game.particles, a = this.anchor;
    if (!P || !a) return;
    for (let i = 0; i < n; i++) P.sparkle(a.x + (Math.random() - 0.5) * 60, a.y + (Math.random() - 0.5) * 70, i % 2 ? color : '#ffffff', { layer: 'ui' });
  }

  fish() {
    const st = this.game.state;
    let best = null, bestR = -1;
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    for (const [id, j] of Object.entries(st.journal || {})) {
      const sp = SPECIES_BY_ID[id];
      if (!j?.caught || !sp || sp.look?.kind) continue;
      const r = order.indexOf(sp.rarity);
      if (r > bestR) { bestR = r; best = sp; }
    }
    best ||= SPECIES_BY_ID.parrot || SPECIES.find((s) => !s.look?.kind);
    if (!best) return null;
    if (this.cache.fishId !== best.id) this.cache.fishC = { compiled: compiled(best.look, null, 'wardrobe:' + best.id) }, this.cache.fishId = best.id;
    return this.cache.fishC;
  }

  // ------------------------------------------------------------------------------------------ frame
  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    this.openT = Math.min(1, (this.openT || 0) + dt * 1.4);
    const SW = g.screen.W, SH = g.screen.H;
    const W = Math.min(SW - 16, 748), H = Math.min(SH - 44, 444);
    const r = { x: Math.round((SW - W) / 2), y: Math.round((SH - H) / 2) + 12, w: W, h: H };
    this.rect = { x: r.x, y: r.y - 28, w: W, h: H + 28 };
    drawWood(ctx, r.x, r.y, W, H, { tone: 'dark' });
    const stage = { x: r.x + 8, y: r.y + 8, w: Math.round(W * 0.41), h: H - 16 - 25 };
    const drawers = { x: stage.x + stage.w + 7, y: r.y + 8, w: 76, h: H - 16 };
    const rx = drawers.x + drawers.w + 7, rw = r.x + W - 8 - rx;
    this.drawStage(ctx, ui, stage, dt);
    this.drawPoseBar(ctx, ui, { x: stage.x, y: stage.y + stage.h + 5, w: stage.w, h: 18 });
    this.drawDrawers(ctx, ui, drawers);
    this.drawHeader(ctx, ui, { x: rx, y: r.y + 8, w: rw, h: 20 });
    if (!ui.isOpen(this.id)) return;
    const slipH = 84;
    this.drawRack(ctx, ui, { x: rx, y: r.y + 31, w: rw, h: H - 31 - 8 - slipH - 6 }, dt);
    this.drawSlip(ctx, ui, { x: rx, y: r.y + H - 8 - slipH, w: rw, h: slipH }, dt);
    drawPlank(ctx, r.x + Math.round(W / 2) - 104, r.y - 22, 208, 22, { rope: 8, label: "GIL'S DRESSING ROOM" });
    if (inp.keyPressed?.('KeyR')) this.randomize();
  }

  // ------------------------------------------------------------------------------------------ stage
  drawStage(ctx, ui, s, dt) {
    const g = this.game, inp = g.input, t = this.t;
    ctx.save();
    ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
    ctx.drawImage(this.roomBg(s.w, s.h), s.x, s.y);
    const floorY = s.y + Math.round(s.h * 0.8);
    const cx = s.x + Math.round(s.w * 0.6);
    // --- vanity mirror with bulbs on the back wall; the reflection shows Gil's back
    const mw = Math.round(s.w * 0.36), mh = Math.round(s.h * 0.5);
    const mr = { x: s.x + Math.round(s.w * 0.2), y: s.y + 30, w: mw, h: mh };
    const mcx = mr.x + (mw >> 1);
    this.mirrorRect = mr;
    const inner = drawFrame(ctx, mr.x - 6, mr.y - 6, mr.w + 12, mr.h + 12, { style: 'gold' });
    ctx.save();
    ctx.beginPath(); ctx.rect(inner.x, inner.y, inner.w, inner.h); ctx.clip();
    const grd = ctx.createLinearGradient(0, inner.y, 0, inner.y + inner.h);
    grd.addColorStop(0, '#a8d8dc'); grd.addColorStop(0.7, '#6fa8b4'); grd.addColorStop(1, '#4a7a88');
    ctx.fillStyle = grd; ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    // reflected room: the far wall's stripes and the floor
    ctx.fillStyle = rgba('#2a5a68', 0.35);
    for (let x = inner.x + ((t * 0) | 0); x < inner.x + inner.w; x += 10) ctx.fillRect(x, inner.y, 4, inner.h);
    ctx.fillStyle = rgba('#5a3a28', 0.55);
    ctx.fillRect(inner.x, inner.y + inner.h - 16, inner.w, 16);
    const look = this.previewLook();
    const sc = this.charScale(s);
    ctx.save();
    ctx.translate(mcx * 2 + 10, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.92;
    // the mirror stands to Gil's right, so it sees his back three-quarters
    drawCharacter(ctx, mcx + 5, inner.y + inner.h - 4, { pose: this.pose === 'hold' ? 'show' : this.pose, t: this.poseT, yaw: this.yaw + 150, scale: Math.max(1, Math.round(sc * 0.6 * 4) / 4), look, id: 'wardrobe-mirror', shadow: false });
    ctx.restore();
    ctx.fillStyle = rgba('#bff4ff', 0.16);
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    // glass glints
    ctx.fillStyle = rgba('#ffffff', 0.22);
    for (const [o, w] of [[18, 10], [34, 4], [80, 6]]) {
      ctx.beginPath();
      const gx = inner.x + o + Math.sin(t * 0.3) * 3;
      ctx.moveTo(gx, inner.y); ctx.lineTo(gx + w, inner.y); ctx.lineTo(gx + w - 40, inner.y + inner.h); ctx.lineTo(gx - 40, inner.y + inner.h); ctx.fill();
    }
    ctx.restore();
    // bulbs around the frame
    const bulbs = [];
    for (let i = 0; i < 6; i++) bulbs.push([mr.x - 9 + ((mr.w + 18) * i) / 5, mr.y - 11]);
    for (let i = 1; i < 6; i++) { bulbs.push([mr.x - 11, mr.y - 9 + (mr.h * i) / 6]); bulbs.push([mr.x + mr.w + 11, mr.y - 9 + (mr.h * i) / 6]); }
    bulbs.forEach(([bx, by], i) => {
      const tw = 0.75 + 0.25 * Math.sin(t * 2.2 + i * 1.7) + (this.sold > 0 ? 0.4 * Math.sin(t * 30 + i) : 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ffd890', 0.16 * tw);
      ctx.beginPath(); ctx.arc(bx, by, 9, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#7a4a1c'; ctx.fillRect(Math.round(bx) - 2, Math.round(by) - 1, 4, 3);
      ctx.fillStyle = tw > 0.6 ? '#fff6d0' : '#ffe08a';
      ctx.fillRect(Math.round(bx) - 2, Math.round(by) - 3, 4, 4);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(bx) - 1, Math.round(by) - 3, 1, 1);
    });
    // spotlight cone
    ctx.globalCompositeOperation = 'lighter';
    const sg = ctx.createLinearGradient(0, s.y, 0, floorY + 10);
    sg.addColorStop(0, rgba('#fff4c8', 0.0)); sg.addColorStop(1, rgba('#fff4c8', 0.13));
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(cx - 10, s.y); ctx.lineTo(cx + 22, s.y); ctx.lineTo(cx + 74, floorY + 12); ctx.lineTo(cx - 70, floorY + 12); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // --- rug + turntable pedestal (dots on the rim turn with Gil)
    this.drawPedestal(ctx, cx, floorY, s);
    // --- Gil
    const fish = this.pose === 'hold' ? this.fish() : null;
    const shake = this.shakeT > 0 ? Math.round(Math.sin(t * 60) * 2) : 0;
    this.shakeT = Math.max(0, (this.shakeT || 0) - dt);
    const lookAt = ui.hover(s) && !this.drag ? [inp.x, inp.y] : null;
    const a = drawCharacter(ctx, cx + shake, floorY - 6, { pose: this.pose, t: this.poseT, yaw: this.yaw, scale: sc, look, fish, id: 'wardrobe', lookAt, shadow: true });
    this.anchor = { x: a.head[0], y: (a.head[1] + floorY) / 2 };
    // --- curtains slide open on arrival
    this.drawCurtains(ctx, s, ease.outCubic(this.openT));
    // try-on ribbon
    const sel = this.selItem();
    if (sel && !this.owns(sel)) {
      const bob = Math.round(Math.sin(t * 3) * 1);
      const tx = s.x + 8, ty = s.y + s.h - 26 + bob;
      ctx.fillStyle = '#2a1a10'; ctx.fillRect(tx - 1, ty - 1, 74, 15);
      ctx.fillStyle = '#ffd25a'; ctx.fillRect(tx, ty, 72, 13);
      ctx.fillStyle = '#fff2a8'; ctx.fillRect(tx, ty, 72, 1);
      drawText(ctx, 'TRYING ON', tx + 36, ty + 4, { font: 'small', align: 'center', color: '#5a2a10' });
    }
    ctx.restore();
    // stage frame
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(s.x - 1, s.y - 1, s.w + 2, 1); ctx.fillRect(s.x - 1, s.y + s.h, s.w + 2, 1);
    ctx.fillRect(s.x - 1, s.y, 1, s.h); ctx.fillRect(s.x + s.w, s.y, 1, s.h);
    // --- input: drag to spin, click the mirror, poke Gil
    this.updateSpin(ui, s, mr, dt);
    // speech bubble
    this.drawSpeech(ctx, s, a, dt);
    this.poseT += dt;
    // reactions return to the showcase pose; a picked cast keeps re-casting
    if (this.autoPose && this.poseT > 2.3) this.setPose('show');
    else if (this.pose === 'cast' && this.poseT > 1.8) this.poseT = 0;
  }

  charScale(s) { return clamp(Math.round(((s.h * 0.6) / (64 * 1.4)) * 4) / 4, 1.5, 2.75); }

  updateSpin(ui, s, mr, dt) {
    const g = this.game, inp = g.input;
    const over = ui.hover(s);
    if (over && inp.pressed && !this.drag) {
      inp.pressed = false;
      if (ui.hover(mr) && inp.y < mr.y + mr.h * 0.45) {
        g.audio.play('bell', { vol: 0.5, pitch: 1.2 });
        this.say(pick(LINES.mirror));
      } else {
        this.drag = { x: inp.x, yaw: this.yaw, last: inp.x, moved: 0 };
        this.yawV = 0;
      }
    }
    if (this.drag) {
      if (inp.down) {
        const dx = inp.x - this.drag.last;
        this.drag.moved += Math.abs(dx);
        this.drag.last = inp.x;
        this.yaw -= dx * 1.6;
        this.yawV = lerp(this.yawV, -dx * 1.6 / Math.max(dt, 1e-3), 0.5);
        ui.tip = null;
      } else {
        if (this.drag.moved < 3) {
          // a click on Gil: a little poke reaction
          g.audio.play(pick(['squeak', 'blub', 'boing']), { vol: 0.6 });
          this.say(pick(LINES.poke));
          this.setPose(pick(['wave', 'cheer']));
          this.yawV = 0;
        } else if (Math.abs(this.yawV) > 700) this.say(pick(LINES.spin));
        this.drag = null;
      }
      this.idleT = 0;
    } else {
      this.yaw += this.yawV * dt;
      this.yawV *= Math.exp(-dt * 2.8);
      if (Math.abs(this.yawV) < 4) this.yawV = 0;
      this.idleT = (this.idleT || 0) + dt;
      if (this.idleT > 6 && !this.yawV) {
        // drift back toward a flattering 3/4 view
        const target = -24 + Math.sin(this.t * 0.35) * 18;
        let d = ((target - this.yaw) % 360 + 540) % 360 - 180;
        this.yaw += d * Math.min(1, dt * 0.8);
      }
    }
    this.yaw = ((this.yaw + 180) % 360 + 360) % 360 - 180;
    // rotation ticks
    const step = Math.round(this.yaw / 15);
    if (step !== this.lastStep) {
      if (this.lastStep !== undefined && (this.drag || Math.abs(this.yawV) > 30)) g.audio.play('reel_tick', { vol: 0.25, pitch: 1.4 + Math.random() * 0.2 });
      this.lastStep = step;
    }
    if (over && !this.drag) ui.tip = ui.tip || 'Drag to spin Gil around';
  }

  drawSpeech(ctx, s, a, dt) {
    if (!this.line) return;
    this.lineT += dt;
    this.talkT = Math.max(0, (this.talkT || 0) - dt);
    const fade = this.lineT > 4 ? clamp01(1 - (this.lineT - 4) * 2) : 1;
    if (fade <= 0) { this.line = null; return; }
    const lines = wrapText(this.line, s.w - 60);
    const bw = Math.min(s.w - 20, Math.max(...lines.map((l) => measureText(l))) + 18), bh = lines.length * 10 + 11;
    const hx = clamp(a.head[0], s.x + 20, s.x + s.w - 20);
    const bx = clamp(Math.round(hx - bw / 2 + 24), s.x + 6, s.x + s.w - bw - 6), by = Math.max(s.y + 4, Math.round(a.head[1] - bh - 16));
    ctx.globalAlpha = Math.min(1, this.lineT * 8) * fade;
    const cr = drawBubble(ctx, bx, by, bw, bh, { tailX: hx + 6, tailY: by + bh + 8 });
    let left = Math.floor(this.lineT * 45);
    lines.forEach((l, i) => {
      drawText(ctx, l.slice(0, Math.max(0, left)), cr.x + 3, cr.y + 2 + i * 10, { color: '#2e2a3a' });
      left -= l.length + 1;
    });
    ctx.globalAlpha = 1;
  }

  drawPedestal(ctx, cx, fy, s) {
    const rx = Math.round(s.w * 0.25), ry = Math.round(rx * 0.24);
    // rug
    for (const [k, c] of [[1.55, '#5a2a48'], [1.45, '#8a3a62'], [1.3, '#c8607a'], [1.18, '#8a3a62']]) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(cx, fy + 6, rx * k, ry * k, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#ffd890';
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      ctx.fillRect(Math.round(cx + Math.cos(a) * rx * 1.37), Math.round(fy + 6 + Math.sin(a) * ry * 1.37), 2, 1);
    }
    // turntable: side band + top
    ctx.fillStyle = '#4a2a18';
    ctx.beginPath(); ctx.ellipse(cx, fy + 4, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.fillRect(cx - rx, fy - 2, rx * 2, 6);
    ctx.fillStyle = '#b8783a';
    ctx.beginPath(); ctx.ellipse(cx, fy - 2, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d89a5a';
    ctx.beginPath(); ctx.ellipse(cx, fy - 3, rx - 3, ry - 1.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8b878';
    ctx.beginPath(); ctx.ellipse(cx - rx * 0.2, fy - 4, rx * 0.5, ry * 0.4, 0, 0, TAU); ctx.fill();
    // brass rim studs turning with the yaw
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU - (this.yaw * Math.PI) / 180;
      const sy = Math.sin(a);
      if (sy < -0.1) continue;
      const px = Math.round(cx + Math.cos(a) * (rx - 0.5)), py = Math.round(fy + 1 + sy * ry);
      ctx.fillStyle = '#7a4a1c'; ctx.fillRect(px - 1, py, 3, 2);
      ctx.fillStyle = '#ffe08a'; ctx.fillRect(px - 1, py, 2, 1);
    }
    // name plaque
    const pw = 26;
    ctx.fillStyle = '#3e2210'; ctx.fillRect(cx - pw / 2 - 1, fy + ry + 1, pw + 2, 9);
    ctx.fillStyle = '#e0a844'; ctx.fillRect(cx - pw / 2, fy + ry + 2, pw, 7);
    ctx.fillStyle = '#fff2b8'; ctx.fillRect(cx - pw / 2, fy + ry + 2, pw, 1);
    drawText(ctx, 'GIL', cx, fy + ry + 4, { font: 'small', align: 'center', color: '#5a3010' });
  }

  drawCurtains(ctx, s, k) {
    const cw = Math.round(s.w * 0.2);
    const tex = this.curtainTex(cw, s.h);
    const closed = s.w / 2;
    const off = lerp(closed - cw * 0.35, 0, k);
    ctx.drawImage(tex, Math.round(s.x - cw * 0.35 + off), s.y);
    ctx.save();
    ctx.translate(Math.round(s.x + s.w + cw * 0.35 - off), s.y);
    ctx.scale(-1, 1);
    ctx.drawImage(tex, 0, 0);
    ctx.restore();
    ctx.drawImage(this.valanceTex(s.w), s.x, s.y);
  }

  // scalloped valance with a gold fringe
  valanceTex(w) {
    const key = `val|${w}`;
    if (this.cache[key]) return this.cache[key];
    const c = makeCanvas(w, 20), g = ctxOf(c);
    for (let x = 0; x < w; x++) {
      const sc = ((x % 24) - 12);
      const h = 10 + Math.round(Math.sqrt(Math.max(0, 144 - sc * sc)) * 0.35);
      g.fillStyle = (x % 24) < 2 ? '#6a1020' : '#a8243a';
      g.fillRect(x, 0, 1, h);
      g.fillStyle = '#e04a5a'; g.fillRect(x, 2, 1, 1);
      g.fillStyle = x % 3 ? '#e8b848' : '#a8782a'; g.fillRect(x, h, 1, 2 + (x % 3 === 0 ? 1 : 0));
    }
    this.cache[key] = c;
    return c;
  }

  curtainTex(w, h) {
    const key = `cur|${w}|${h}`;
    if (this.cache[key]) return this.cache[key];
    const c = makeCanvas(w + 6, h), g = ctxOf(c);
    const R = ['#3a0812', '#5e1020', '#8a1a2e', '#b4263c', '#d8404e', '#ee6a6e'];
    const tieY = Math.round(h * 0.58);
    for (let y = 0; y < h; y++) {
      // pinched at the tie-back, flaring below
      const k = y < tieY ? 1 - (y / tieY) * 0.55 : 0.45 + ((y - tieY) / (h - tieY)) * 0.3;
      const ww = Math.round(w * k);
      for (let x = 0; x < ww; x++) {
        const u = x / ww;
        const fold = 0.5 + 0.5 * Math.sin(u * TAU * 2.6 + (y < tieY ? 0 : 0.6));
        const v = 1.2 + fold * 3.2 - (x > ww - 2 ? 1.6 : 0) + (u < 0.08 ? -0.6 : 0);
        const i = clamp(Math.floor(v + (bayer(x, y) - 0.5) * 0.8), 0, 5);
        g.fillStyle = R[i];
        g.fillRect(x, y, 1, 1);
      }
      g.fillStyle = '#1e0408';
      g.fillRect(ww, y, 1, 1);
    }
    // gold rope tie-back with a tassel
    const tw = Math.round(w * 0.45);
    for (let x = 0; x <= tw + 2; x++) { g.fillStyle = x % 3 ? '#e8b848' : '#a8782a'; g.fillRect(x, tieY - 1 + (x % 2), 1, 3); }
    g.fillStyle = '#a8782a'; g.fillRect(tw, tieY + 2, 4, 2);
    for (let y = 0; y < 9; y++) { g.fillStyle = y % 2 ? '#e8b848' : '#f8d878'; g.fillRect(tw - 1 + (y > 2 ? 0 : 1), tieY + 4 + y, y > 2 ? 6 : 4, 1); }
    // hem fringe
    const bw = Math.round(w * 0.75);
    for (let x = 0; x < bw; x++) { g.fillStyle = x % 3 ? '#e8b848' : '#a8782a'; g.fillRect(x, h - 3, 1, 3); }
    this.cache[key] = c;
    return c;
  }

  roomBg(w, h) {
    const key = `room|${w}|${h}`;
    if (this.cache[key]) return this.cache[key];
    const c = makeCanvas(w, h), g = ctxOf(c);
    const floorY = Math.round(h * 0.8), wainY = Math.round(h * 0.6);
    // striped wallpaper with little diamonds
    for (let x = 0; x < w; x++) {
      const st = Math.floor(x / 9) % 2;
      g.fillStyle = st ? '#2f6c78' : '#285e6c';
      g.fillRect(x, 0, 1, wainY);
      if (x % 9 === 0) { g.fillStyle = '#4a8a8a'; g.fillRect(x, 0, 1, wainY); }
    }
    g.fillStyle = '#3e8288';
    for (let y = 14; y < wainY - 6; y += 16) for (let x = 13; x < w; x += 18) {
      g.fillRect(x, y - 1, 1, 3); g.fillRect(x - 1, y, 3, 1);
    }
    // soft vignette from the sides
    for (let x = 0; x < 24; x++) {
      g.fillStyle = rgba('#0a1a22', 0.3 * (1 - x / 24));
      g.fillRect(x, 0, 1, floorY); g.fillRect(w - 1 - x, 0, 1, floorY);
    }
    // crown molding
    g.fillStyle = '#5a3a24'; g.fillRect(0, 0, w, 4);
    g.fillStyle = '#8a5a34'; g.fillRect(0, 4, w, 2);
    // wainscoting panels
    drawWood(g, 0, wainY, w, floorY - wainY, { tone: 'light', nails: false, planks: 1, seams: false, round: 0 });
    g.fillStyle = '#5a3420'; g.fillRect(0, wainY, w, 2);
    g.fillStyle = '#c08a52'; g.fillRect(0, wainY + 2, w, 1);
    for (let x = 8; x < w - 20; x += 34) {
      g.fillStyle = rgba('#3a2010', 0.45); g.fillRect(x, wainY + 8, 26, floorY - wainY - 14);
      g.fillStyle = rgba('#f2d098', 0.25); g.fillRect(x + 1, wainY + 9, 24, 1);
    }
    // floor planks in perspective
    for (let y = floorY; y < h; y++) {
      const k = (y - floorY) / (h - floorY);
      g.fillStyle = mix('#7a4a2a', '#a06a3a', k * 0.7);
      g.fillRect(0, y, w, 1);
      if ((y - floorY) % Math.max(3, Math.round(4 + k * 6)) === 0) { g.fillStyle = rgba('#3a2010', 0.45); g.fillRect(0, y, w, 1); }
    }
    for (let i = -8; i <= 8; i++) {
      g.strokeStyle = rgba('#3a2010', 0.35);
      g.beginPath(); g.moveTo(w / 2 + i * 14, floorY); g.lineTo(w / 2 + i * 34, h); g.stroke();
    }
    g.fillStyle = '#3a2010'; g.fillRect(0, floorY - 1, w, 2);
    // potted kelp in the corner
    const px = w - 34, py = floorY - 2;
    g.fillStyle = '#7a3a22'; g.fillRect(px - 8, py - 12, 16, 12);
    g.fillStyle = '#a85a32'; g.fillRect(px - 9, py - 14, 18, 3);
    g.fillStyle = '#c87a4a'; g.fillRect(px - 9, py - 14, 18, 1);
    for (const [ox, ph, hh] of [[-4, 0, 40], [0, 1.3, 54], [4, 2.4, 34]]) {
      for (let y = 0; y < hh; y++) {
        g.fillStyle = y % 7 < 2 ? '#7ad06a' : '#3a9a4a';
        g.fillRect(Math.round(px + ox + Math.sin(y * 0.18 + ph) * 3), py - 14 - y, 2, 1);
      }
    }
    this.cache[key] = c;
    return c;
  }

  drawPoseBar(ctx, ui, b) {
    const n = POSE_BTNS.length, bw = Math.floor((b.w - (n - 1) * 2) / n);
    POSE_BTNS.forEach(([id, label], i) => {
      const x = b.x + i * (bw + 2);
      if (ui.button(ctx, x, b.y, bw, b.h, label, { style: 'shell', font: 'small', active: this.pose === id, tip: id === 'hold' ? 'Show off your best catch' : `Pose: ${label}`, sound: 'ui_click' })) {
        this.setPose(id, false);
        this.game.audio.play(POSE_SOUND[id] || 'boing', { vol: 0.45 });
        if (id === 'hold') this.say('Look at this beauty!');
      }
    });
  }

  drawDrawers(ctx, ui, d) {
    const g = this.game, inp = g.input, t = this.t;
    drawWood(ctx, d.x, d.y, d.w, d.h, { tone: 'light', nails: true });
    const n = WARDROBE_SLOTS.length;
    const dh = Math.floor((d.h - 10) / n);
    WARDROBE_SLOTS.forEach((sl, i) => {
      const active = this.slot === sl.id;
      const rr = { x: d.x + 5, y: d.y + 5 + i * dh, w: d.w - 10, h: dh - 3 };
      const hov = !active && ui.hover(rr);
      const ox = active ? -3 : 0, oy = hov ? -1 : 0;
      if (active) { ctx.fillStyle = rgba('#000000', 0.35); ctx.fillRect(rr.x + 2, rr.y + rr.h, rr.w, 2); }
      drawWood(ctx, rr.x + ox, rr.y + oy, rr.w + (active ? 6 : 0), rr.h, { tone: active ? 'light' : 'dark', nails: false, planks: 1, seams: false, round: 1 });
      // brass handle, label, count and a tiny preview of what is worn from this drawer
      const hx = rr.x + ox + 5, hy = rr.y + oy + rr.h - 9;
      ctx.fillStyle = '#3e2210'; ctx.fillRect(hx - 1, hy - 1, 12, 5);
      ctx.fillStyle = active ? '#ffe08a' : '#e0a844'; ctx.fillRect(hx, hy, 10, 3);
      ctx.fillStyle = '#fff2b8'; ctx.fillRect(hx, hy, 10, 1);
      const own = this.items(sl.id).filter((w) => this.owns(w)).length, tot = this.items(sl.id).length;
      drawText(ctx, sl.name.toUpperCase(), rr.x + ox + 4, rr.y + oy + 4, { font: 'small', color: active ? '#4a2a10' : '#f4d8a8', shadow: active ? null : '#1a0e06' });
      drawText(ctx, `${own}/${tot}`, rr.x + ox + 4, rr.y + oy + 12, { font: 'small', color: active ? '#8a5a2a' : '#a88a6a' });
      this.drawDrawerThumb(ctx, sl.id, { x: rr.x + ox + rr.w - 30 + (active ? 6 : 0), y: rr.y + oy + 2, w: 28, h: rr.h - 4 });
      if (hov) ui.tip = sl.desc;
      if (hov && inp.pressed) {
        inp.pressed = false;
        this.slot = sl.id;
        this.selectEquipped();
        g.audio.play('box_close', { vol: 0.35, pitch: 1.3 });
        g.audio.play('ui_tab', { vol: 0.6 });
        if (t - (this.lastSay || -9) > 3 && Math.random() < 0.4) { this.say(pick([`Ooh, ${sl.name.toLowerCase()}!`, `Let's see the ${sl.name.toLowerCase()}...`])); this.lastSay = t; }
      }
    });
  }

  drawDrawerThumb(ctx, slot, a) {
    const L = this.look;
    const it = slot === 'acc' ? WARDROBE.find((w) => w.slot === 'acc' && L.acc.includes(w.value)) : WARDROBE.find((w) => w.slot === slot && isEquipped(L, w));
    ctx.fillStyle = rgba('#1a0e06', 0.35);
    ctx.fillRect(a.x, a.y, a.w, a.h);
    if (!it) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip();
    if (slot === 'boat') {
      ctx.fillStyle = it.trim; ctx.fillRect(a.x + 5, a.y + a.h - 14, a.w - 10, 2);
      ctx.fillStyle = it.color; ctx.fillRect(a.x + 5, a.y + a.h - 12, a.w - 10, 4); ctx.fillRect(a.x + 8, a.y + a.h - 8, a.w - 16, 3);
    } else {
      const k = { skin: 0.55, eyes: 0.55, mouth: 0.55, hat: 0.45, outfit: 0.4, acc: 0.4, boots: 0.75, gloves: 0.8, rod: 0.4 }[slot] ?? 0.5;
      const pv = itemPreview(L, it, k);
      if (pv) {
        const body = slot === 'outfit' || (slot === 'acc' && !HEAD_ACC.has(it.value));
        drawItemPreview(ctx, pv, a.x + a.w / 2, body ? a.y + a.h + 1 : a.y + Math.round(a.h / 2 + Math.min(pv.h, a.h) / 2), this.t, 'drawer:' + slot);
      }
    }
    ctx.restore();
  }

  drawHeader(ctx, ui, h) {
    const g = this.game, st = g.state;
    const sl = WARDROBE_SLOTS.find((s) => s.id === this.slot);
    drawText(ctx, sl.name, h.x + 2, h.y + 6, { color: '#ffe8b8', shadow: '#1a0e06' });
    drawText(ctx, sl.desc, h.x + 8 + measureText(sl.name), h.y + 7, { font: 'small', color: '#c8a880', shadow: '#1a0e06' });
    const ctxt = formatCommas(Math.floor(this.ui?.coinShown ?? st.coins));
    const pw = measureText(ctxt) + 26;
    const px = h.x + h.w - pw - 24;
    drawWood(ctx, px, h.y + 1, pw, 17, { tone: 'light', nails: false, round: 2, planks: 1 });
    ctx.drawImage(getUiIcon('coin'), px + 5, h.y + 5);
    drawText(ctx, ctxt, px + pw - 6, h.y + 6, { align: 'right', color: '#fff3dc', shadow: '#2a160a' });
    if (ui.button(ctx, h.x + h.w - 19, h.y, 18, 18, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) ui.close(this.id);
  }

  // ------------------------------------------------------------------------------------------ rack
  drawRack(ctx, ui, b, dt) {
    const g = this.game, inp = g.input, t = this.t;
    drawWood(ctx, b.x, b.y, b.w, b.h, { tone: 'dark', inset: true, nails: false });
    const items = this.items();
    const cols = 4, rows = 3;
    const cw = Math.floor((b.w - 8) / cols), ch = Math.floor((b.h - 8) / rows);
    const base = this.look;
    let hov = null;
    for (let r = 0; r < rows; r++) {
      // clothes rail
      const ry = b.y + 4 + r * ch + 3;
      ctx.fillStyle = '#3a2412'; ctx.fillRect(b.x + 3, ry, b.w - 6, 3);
      ctx.fillStyle = '#c8a070'; ctx.fillRect(b.x + 3, ry, b.w - 6, 1);
    }
    items.forEach((it, i) => {
      if (i >= cols * rows) return;
      const c = i % cols, r = Math.floor(i / cols);
      const cell = { x: b.x + 4 + c * cw, y: b.y + 4 + r * ch, w: cw - 3, h: ch - 3 };
      const isHov = ui.hover(cell);
      if (isHov) hov = it;
      this.drawCard(ctx, it, cell, base, isHov, t, dt);
      if (isHov && inp.pressed) {
        inp.pressed = false;
        this.click(it);
      }
    });
    if (hov) {
      const own = this.owns(hov);
      ui.tip = own ? (isEquipped(base, hov) ? `${hov.name} (wearing)` : `${hov.name} - click to wear`) : hov.price != null ? `${hov.name} - ${formatCommas(hov.price)} coins (try it on!)` : `${hov.name} - ${hov.unlock === 'skill' ? 'skill reward' : 'found in crates'}`;
      if (hov.id !== this.hoverId) { this.hoverId = hov.id; g.audio.play('ui_hover', { vol: 0.4 }); }
    } else this.hoverId = null;
  }

  click(it) {
    const g = this.game;
    const L = this.look;
    const was = this.sel;
    this.sel = it.id;
    this.pop[it.id] = 0;
    if (this.owns(it)) {
      if (it.slot === 'acc' || !isEquipped(L, it)) this.equip(it);
      else g.audio.play('ui_click', { vol: 0.6 });
    } else {
      g.audio.play('ui_click');
      g.audio.play(SLOT_SOUND[it.slot] || 'boing', { vol: 0.35, pitch: 1.3 });
      if (was !== it.id && this.t - (this.lastSay || -9) > 1.5) { this.say(it.price == null ? pick(it.unlock === 'skill' ? [`Grow '${SKILL_BY_ID[it.skill]?.name || 'a skill'}' to get this!`] : LINES.pkg) : pick(LINES.tryon)); this.lastSay = this.t; }
    }
  }

  drawCard(ctx, it, c, base, hov, t, dt) {
    const own = this.owns(it), worn = isEquipped(base, it), sel = this.sel === it.id;
    const locked = !own && it.price == null;
    let pop = 0;
    if (this.pop[it.id] !== undefined) {
      this.pop[it.id] += dt;
      pop = Math.sin(clamp01(this.pop[it.id] / 0.35) * Math.PI) * 3;
      if (this.pop[it.id] > 0.35) delete this.pop[it.id];
    }
    const lift = Math.round((hov ? 2 : 0) + pop);
    const x = c.x, y = c.y + 8 - lift, w = c.w, h = c.h - 9;
    const rar = RARITY[it.rarity] || RARITY.common;
    // hanger hook
    const hx = x + Math.round(w / 2);
    ctx.fillStyle = '#8a8e9a'; ctx.fillRect(hx, c.y + 1 - lift, 1, 6); ctx.fillRect(hx - 2, c.y + 1 - lift, 3, 1); ctx.fillRect(hx - 2, c.y + 2 - lift, 1, 1);
    ctx.fillStyle = '#c8ccd8'; ctx.fillRect(hx, c.y + 2 - lift, 1, 2);
    ctx.fillStyle = '#6a4024'; ctx.fillRect(x + 8, y - 2, w - 16, 3);
    ctx.fillStyle = '#a8784a'; ctx.fillRect(x + 8, y - 2, w - 16, 1);
    // tag body
    if (sel || worn) {
      ctx.fillStyle = sel ? rgba('#ffe27a', 0.6 + 0.25 * Math.sin(t * 5)) : rgba('#9affc8', 0.55);
      ctx.fillRect(x - 2, y - 2 + 3, w + 4, h + 4 - 3);
    }
    drawPaper(ctx, x, y + 1, w, h - 1, { aged: locked });
    ctx.fillStyle = rar.color; ctx.fillRect(x + 1, y + h - 4, w - 2, 3);
    ctx.fillStyle = rar.dark; ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
    // thumbnail
    const area = { x: x + 3, y: y + 4, w: w - 6, h: h - 26 };
    ctx.save();
    ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
    ctx.fillStyle = mix(rar.color, '#f4ead4', 0.78);
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = rgba('#ffffff', 0.35);
    ctx.fillRect(area.x, area.y, area.w, 1);
    if (it.slot === 'boat') this.drawBoatThumb(ctx, it, area, t);
    else {
      const pv = itemPreview(base, it, THUMB[it.slot] ?? 1);
      if (pv) {
        const headOnly = ['skin', 'eyes', 'mouth', 'hat'].includes(it.slot) || (it.slot === 'acc' && HEAD_ACC.has(it.value));
        const bob = hov ? Math.round(Math.sin(t * 6) * 1) : 0;
        const by = it.slot === 'outfit' || (it.slot === 'acc' && !headOnly) ? area.y + area.h + 2 : area.y + Math.round(area.h / 2 + Math.min(pv.h, area.h) / 2) + 1;
        if (locked) ctx.globalAlpha = 0.45;
        drawItemPreview(ctx, pv, area.x + area.w / 2, by + bob, t, 'thumb:' + it.id);
        ctx.globalAlpha = 1;
      } else {
        const r = 5 + Math.sin(t * 4 + x) * 1;
        ctx.strokeStyle = rgba('#5a8aa8', 0.7);
        ctx.beginPath(); ctx.arc(area.x + area.w / 2, area.y + area.h / 2, r, 0, TAU); ctx.stroke();
      }
    }
    if (locked) {
      ctx.fillStyle = rgba('#3a3448', 0.35); ctx.fillRect(area.x, area.y, area.w, area.h);
      ctx.drawImage(getUiIcon('lock'), Math.round(area.x + area.w / 2 - 4), Math.round(area.y + area.h / 2 - 4));
    }
    ctx.restore();
    // stars
    for (let s = 0; s < rar.stars; s++) ctx.drawImage(getUiIcon('star'), x + 3 + s * 7, y + 5);
    // name
    let name = it.name.toUpperCase();
    while (measureText(name, 'small') > w - 6 && name.length > 3) name = name.slice(0, -2) + '.';
    drawText(ctx, name, x + w / 2, y + h - 21, { font: 'small', align: 'center', color: locked ? '#6a6070' : '#3a2414' });
    // price / status
    const ty = y + h - 13;
    if (worn) {
      ctx.drawImage(getUiIcon('check'), Math.round(x + w / 2 - 17), ty - 1);
      drawText(ctx, 'WEARING', x + w / 2 + 5, ty + 1, { font: 'small', align: 'center', color: '#2a7a3a' });
    } else if (own) drawText(ctx, 'OWNED', x + w / 2, ty + 1, { font: 'small', align: 'center', color: '#5a8a5a' });
    else if (locked) drawText(ctx, it.unlock === 'skill' ? 'SKILL' : 'CRATE', x + w / 2, ty + 1, { font: 'small', align: 'center', color: '#8a5a8a' });
    else {
      const p = formatCommas(it.price);
      const tw = measureText(p, 'small') + 13;
      const afford = this.game.state.coins >= it.price;
      drawText(ctx, p, x + w / 2 - tw / 2, ty + 1, { font: 'small', color: afford ? '#3a2414' : '#a8283a' });
      ctx.drawImage(getUiIcon('coin'), Math.round(x + w / 2 + tw / 2 - 9), ty - 1);
    }
  }

  drawBoatThumb(ctx, it, a, t) {
    const cx = a.x + a.w / 2, wy = a.y + a.h - 12;
    // water
    ctx.fillStyle = '#5ab8d8'; ctx.fillRect(a.x, wy, a.w, a.h);
    ctx.fillStyle = '#8ad8f0';
    for (let x = 0; x < a.w; x += 6) ctx.fillRect(a.x + x + Math.round(Math.sin(t * 2 + x) * 1), wy + ((x / 6) % 2), 3, 1);
    const bob = Math.round(Math.sin(t * 2.4 + a.x) * 1);
    const hull = it.color, trim = it.trim;
    const bw = 44, by = wy - 8 + bob;
    for (let y = 0; y < 12; y++) {
      const inset = Math.round((y / 12) ** 1.6 * 9);
      ctx.fillStyle = y < 2 ? trim : y < 3 ? shade(trim, -0.3) : y > 9 ? shade(hull, -0.35) : y > 7 ? shade(hull, -0.15) : hull;
      ctx.fillRect(Math.round(cx - bw / 2 + inset), by + y, bw - inset * 2, 1);
    }
    ctx.fillStyle = shade(hull, 0.35); ctx.fillRect(Math.round(cx - bw / 2 + 2), by + 3, bw - 6, 1);
    // little mast flag
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(Math.round(cx) - 1, by - 14, 1, 14);
    ctx.fillStyle = trim; ctx.fillRect(Math.round(cx), by - 14, 7, 4);
    ctx.fillStyle = rgba('#ffffff', 0.25); ctx.fillRect(a.x, wy, a.w, 1);
  }

  drawSlip(ctx, ui, rr, dt) {
    const g = this.game, st = g.state;
    drawPaper(ctx, rr.x, rr.y, rr.w, rr.h, { lined: true });
    const it = this.selItem();
    // randomize / reset (always available)
    const bw = 62;
    if (ui.button(ctx, rr.x + rr.w - bw * 2 - 12, rr.y + 6, bw, 17, 'Shuffle', { style: 'paper', font: 'small', icon: 'sparkle', tip: 'Random outfit from your closet (R)', sound: 'ui_click' })) this.randomize();
    if (ui.button(ctx, rr.x + rr.w - bw - 8, rr.y + 6, bw, 17, 'Classic', { style: 'paper', font: 'small', icon: 'home', tip: 'Back to the default look', sound: 'ui_click' })) this.reset();
    if (!it) return;
    const rar = RARITY[it.rarity] || RARITY.common;
    drawText(ctx, it.name, rr.x + 10, rr.y + 7, { color: '#2a1a10' });
    drawText(ctx, rar.name.toUpperCase(), rr.x + 10, rr.y + 19, { font: 'small', color: rar.dark });
    for (let s = 0; s < rar.stars; s++) ctx.drawImage(getUiIcon('star'), rr.x + 14 + measureText(rar.name.toUpperCase(), 'small') + s * 8, rr.y + 17);
    const own = this.owns(it), worn = isEquipped(this.look, it);
    let desc = it.desc;
    if (!own && it.unlock === 'skill') desc += ` Skill: ${SKILL_BY_ID[it.skill]?.name || it.skill}.`;
    const lines = wrapText(desc, rr.w - 150).slice(0, 3);
    lines.forEach((l, i) => drawText(ctx, l, rr.x + 10, rr.y + 31 + i * 10, { color: '#6a5444' }));
    // main action
    const ax = rr.x + rr.w - 132, ay = rr.y + rr.h - 30, aw = 124;
    if (own) {
      const label = it.slot === 'acc' ? (worn ? 'Take off' : 'Wear') : worn ? 'Wearing' : 'Wear';
      if (ui.button(ctx, ax, ay, aw, 22, label, { style: 'wood', disabled: worn && it.slot !== 'acc', icon: worn ? 'check' : null, tip: it.slot === 'acc' ? (worn ? 'Take it off' : `Wear ${it.name}`) : worn ? 'Already wearing it' : `Wear ${it.name}` })) this.equip(it);
    } else if (it.price != null) {
      const afford = st.coins >= it.price;
      const hovR = { x: ax, y: ay, w: aw, h: 22 };
      const brokeClick = !afford && ui.hover(hovR) && g.input.pressed;
      if (ui.button(ctx, ax, ay, aw, 22, `Buy ${formatCommas(it.price)}{coin}`, { style: 'coral', disabled: !afford, tip: afford ? `Buy ${it.name}` : `You need ${formatCommas(it.price - st.coins)} more coins` })) this.buy(it);
      else if (brokeClick) { this.say(pick(LINES.broke)); this.shakeT = 0.4; }
    } else {
      const hovR = { x: ax, y: ay, w: aw, h: 22 };
      const lockClick = ui.hover(hovR) && g.input.pressed;
      ui.button(ctx, ax, ay, aw, 22, it.unlock === 'skill' ? 'Skill reward' : 'Crate reward', { style: 'wood', disabled: true, icon: 'lock', tip: it.unlock === 'skill' ? `Grow '${SKILL_BY_ID[it.skill]?.name || it.skill}' in the skill tree` : 'Find it in package crates fish carry' });
      if (lockClick) this.buy(it);
    }
    if (this.sold > 0) {
      this.sold = Math.max(0, this.sold - dt * 0.9);
      const k = 1 - this.sold;
      ctx.globalAlpha = clamp01(this.sold * 3);
      drawStamp(ctx, rr.x + rr.w - 70, rr.y + rr.h - 46, 'SOLD!', { color: '#2a8a4a', angle: -0.2, scale: lerp(1.8, 1, ease.outCubic(clamp01(k * 4))) });
      ctx.globalAlpha = 1;
    }
  }
}
