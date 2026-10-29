// Barnaby's Boatyard (panel id 'boatyard'): a dockside scene where Barnaby the walrus sells bigger boats.
// Left: sky, sea, boathouse, dock and a crane; the selected boat bobs at the pier (a new purchase is lowered
// in by the crane with a splash). Right: a paper fleet catalogue with the five tiers, perks and Buy button.
// Buying sets game.state.boat.tier (see src/store/boats.js for perk data / boatBonus) and emits 'boatUpgraded'.

import { clamp, clamp01, lerp, ease, formatCommas, hash1 } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack } from '../core/color.js';
import { bayer } from '../core/math.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawPlank, drawBubble, drawStamp } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { centerRect } from './ui.js';
import { BOAT_TIERS, BOAT_PERKS, boatTier, buyBoat } from '../store/boats.js';
import { boatSprite, walrusSprite } from '../store/boatart.js';

const SW = 372, SH = 300;
const WATER_Y = 236;

const LINES = {
  greet: ['Ahoy! Barnaby\'s the name, boats are the game.', 'Welcome to the yard! Mind the barnacles.', 'Looking for a bigger boat? Course you are.'],
  idle: ['Every boat here floats. I checked. Mostly.', 'A bigger boat means a bigger bait box.', 'The yacht has satellite internet. Fancy!', 'Research vessels find the rare ones.', 'I used to be a boat. Long story.'],
  buy: ['SOLD! Lowering her in now!', 'She\'s all yours, captain!', 'A fine choice. Fine, fine choice.'],
  broke: ['Come back with more coins, sailor.', 'That boat costs more than my moustache.', 'No coins, no boat. Walrus rules.'],
  locked: ['One step at a time, captain. Buy the one before.', 'Ah-ah! Work your way up the fleet.'],
  owned: ['You already own that one. Good taste.', 'That old thing? It\'s yours already.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function pk(c) { return pack(c); }

// Static backdrop: sky, sun, island + lighthouse, sea, boathouse, dock, crane tower.
function buildBackdrop() {
  const b = new PixelBuffer(SW, SH);
  const sky = ['#ffe6b8', '#f8ecd0', '#cdeaf6', '#9ad4f2', '#6ab8ea'];
  for (let y = 0; y < 172; y++) {
    for (let x = 0; x < SW; x++) {
      const t = 1 - y / 172;
      const f = clamp(t * 4 + (bayer(x, y) - 0.5) * 0.9, 0, 4);
      b.set(x, y, pk(sky[Math.round(f)]));
    }
  }
  // sun + glow
  for (let y = 10; y < 90; y++) for (let x = 250; x < 350; x++) {
    const d = Math.hypot(x - 300, y - 48);
    if (d < 15) b.set(x, y, pk(d < 12 ? '#fffbe0' : '#ffeeb0'));
    else if (d < 30 && bayer(x, y) < (30 - d) / 40) b.set(x, y, pk('#fff4d0'));
  }
  // clouds
  for (const [cx, cy, w] of [[70, 40, 60], [190, 26, 44], [330, 92, 40]]) {
    for (let j = 0; j < 5; j++) b.fillEllipse(cx + (j - 2) * w * 0.2, cy - Math.sin((j / 4) * Math.PI) * w * 0.12, w * 0.18, w * 0.11, pk('#ffffff'));
    for (let x = cx - w * 0.5; x < cx + w * 0.5; x++) b.set(x, cy + w * 0.09, pk('#e0eef6'));
  }
  // far island with lighthouse
  for (let x = 230; x < SW; x++) {
    const top = 160 - Math.max(0, Math.sin((x - 230) / 142 * Math.PI)) * 18 - Math.sin(x * 0.2) * 1.5;
    for (let y = Math.floor(top); y < 172; y++) b.set(x, y, pk(y < top + 2 ? '#8ab8c8' : '#6a9ab0'));
  }
  for (let y = 120; y < 146; y++) for (let x = 318; x < 326; x++) {
    const w = 3 + (y - 120) * 0.06;
    if (Math.abs(x - 322) <= w) b.set(x, y, pk(Math.floor((y - 120) / 5) % 2 ? '#d84a3a' : '#f4f0e8'));
  }
  b.rect(319, 115, 7, 5, pk('#ffe680'));
  b.rect(318, 113, 9, 2, pk('#3a3448'));
  // sea
  const sea = ['#5ab8e0', '#3a92cc', '#2a6ab0', '#1e4a8a', '#16346a'];
  for (let y = 172; y < SH; y++) {
    const t = (y - 172) / (SH - 172);
    for (let x = 0; x < SW; x++) {
      const f = clamp(t * 4.2 + (bayer(x, y) - 0.5) * 0.8, 0, 4);
      let c = sea[Math.floor(f)];
      if (((x * 3 + y * 7) % 37 === 0) && y < 230) c = '#bfeaff';
      b.set(x, y, pk(c));
    }
  }
  for (let x = 0; x < SW; x++) b.set(x, 172, pk('#e0f6ff'));
  // boathouse
  const WD = ['#4a2414', '#7a3e22', '#a8643a', '#cc8a52', '#ecb878'];
  for (let y = 100; y < 198; y++) for (let x = 0; x < 128; x++) {
    const lx = x % 9;
    let c = lx === 0 ? WD[0] : lx === 1 ? WD[3] : WD[2];
    if (lx > 1 && (x * 13 + Math.floor(y / 14) * 7) % 23 === 0) c = WD[1];
    if (x > 112) c = lx === 0 ? WD[0] : WD[1];
    b.set(x, y, pk(c));
  }
  // roof
  for (let y = 66; y < 104; y++) {
    const half = (y - 66) * 1.9;
    for (let x = Math.max(0, Math.floor(60 - half)); x < Math.min(136, 60 + half); x++) {
      const row = Math.floor((y - 66) / 4);
      b.set(x, y, pk(y >= 101 ? '#3a1a1a' : (x + row * 3) % 8 === 0 ? '#7a2a2a' : row % 2 ? '#a83a34' : '#c04a3a'));
    }
  }
  // big door (dark interior) + sign board
  b.rect(46, 128, 60, 70, pk('#1a1018'));
  b.rect(48, 130, 56, 66, pk('#2a1a22'));
  for (let y = 136; y < 196; y += 8) b.rect(48, y, 56, 1, pk('#3a2430'));
  b.rect(30, 108, 92, 16, pk('#3a1e10'));
  b.rect(32, 110, 88, 12, pk('#e8d0a0'));
  // round window + lifebuoy
  b.fillCircle(20, 140, 7, pk('#3a1e10'));
  b.fillCircle(20, 140, 5.5, pk('#8ad0f0'));
  b.set(18, 138, pk('#ffffff'));
  b.fillCircle(116, 150, 6, pk('#e83a3a'));
  b.fillCircle(116, 150, 3, pk('#a8643a'));
  for (const [dx, dy] of [[0, -5], [5, 0], [0, 5], [-5, 0]]) b.set(116 + dx, 150 + dy, pk('#ffffff'));
  // dock deck + posts
  for (let x = 0; x < 230; x++) for (let y = 196; y < 206; y++) {
    const c = y === 196 ? WD[4] : y === 205 ? WD[0] : x % 14 === 0 ? WD[1] : y < 199 ? WD[3] : WD[2];
    b.set(x, y, pk(c));
  }
  for (const px of [6, 56, 106, 156, 206, 222]) for (let y = 206; y < 262; y++) for (let x = px; x < px + 7; x++) {
    b.set(x, y, pk(x === px ? WD[3] : x === px + 6 ? WD[0] : y > 236 ? '#3a4a5a' : WD[1]));
  }
  // dock clutter: crates, rope coil, trap, bollard
  for (const [cx, cw] of [[132, 18], [150, 14]]) {
    b.rect(cx, 196 - cw, cw, cw, pk(WD[2]));
    b.rect(cx, 196 - cw, cw, 1, pk(WD[4]));
    b.line(cx, 196 - cw, cx + cw - 1, 195, pk(WD[1]));
    b.line(cx + cw - 1, 196 - cw, cx, 195, pk(WD[1]));
  }
  b.fillEllipse(176, 193, 7, 3, pk('#c8a868'));
  b.fillEllipse(176, 192, 4, 1.4, pk('#8a6a3a'));
  b.rect(212, 188, 6, 8, pk('#3a3448'));
  b.rect(211, 187, 8, 2, pk('#5a5468'));
  // crane tower (lattice)
  const CR = '#e8a020', CD = '#9a5a10';
  for (let y = 58; y < 196; y++) { b.set(232, y, pk(CD)); b.set(233, y, pk(CR)); b.set(242, y, pk(CR)); b.set(243, y, pk(CD)); }
  for (let y = 60; y < 194; y += 12) { b.line(233, y, 242, y + 12, pk(CR)); b.line(242, y, 233, y + 12, pk(CD)); }
  for (let x = 200; x < 356; x++) { b.set(x, 56, pk(CR)); b.set(x, 64, pk(CD)); }
  for (let x = 200; x < 352; x += 8) { b.line(x, 56, x + 8, 64, pk(CR)); }
  b.rect(200, 52, 26, 18, pk('#5a5468'));
  b.rect(200, 52, 26, 2, pk('#8a849c'));
  b.rect(236, 40, 14, 16, pk('#f4e0a0'));
  b.rect(238, 43, 10, 6, pk('#5aa8d8'));
  b.outline(() => pk('#1a1226'));
  return b.toCanvas();
}

export class BoatyardPanel {
  constructor() {
    this.id = 'boatyard';
    this.modal = true;
    this.sound = 'box_open';
    this.t = 0;
    this.sel = 0;
  }

  open(data) {
    const g = this.game;
    g.state.boat ||= { tier: 0 };
    this.t = 0;
    const cur = boatTier(g.state);
    this.sel = data?.tier ?? Math.min(BOAT_TIERS.length - 1, cur + 1);
    this.drop = null; // {tier, t}
    this.lineT = 0;
    this.say(pick(LINES.greet));
    this.idleT = 7;
  }

  say(text, dur) {
    this.line = text;
    this.lineT = 0;
    this.talk = dur ?? clamp(text.length * 0.05, 1, 3);
    this.game.audio?.babble?.(text, 'deep');
  }

  layout() {
    const r = centerRect(this.game, 600, 344);
    return { r, S: { x: r.x + 10, y: r.y + 34, w: SW, h: SH }, P: { x: r.x + 390, y: r.y + 34, w: 200, h: SH } };
  }

  buy(tier) {
    const g = this.game, st = g.state;
    const cur = boatTier(st);
    const b = BOAT_TIERS[tier];
    if (tier <= cur) { this.say(pick(LINES.owned)); g.audio.play('ui_error'); return; }
    if (tier > cur + 1) { this.say(pick(LINES.locked)); g.audio.play('ui_error'); return; }
    if ((st.coins || 0) < b.price) { this.say(pick(LINES.broke)); g.audio.play('ui_error'); this.shakeT = 0.4; return; }
    if (!buyBoat(g, tier)) return;
    g.audio.play('ui_buy');
    this.drop = { tier, t: 0, splashed: false };
    this.say(pick(LINES.buy));
    g.toast?.(`You bought the ${b.name}! ${perkSummary(tier)}`, 'sparkle');
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state;
    dt = Math.max(0, Math.min(0.05, dt));
    this.t += dt;
    this.lineT += dt;
    const t = this.t;
    const L = this.layout();
    this.rect = L.r;
    const { r, S, P } = L;
    const cur = boatTier(st);
    // frame
    drawWood(ctx, r.x, r.y, r.w, r.h, { tone: 'dark' });
    drawPlank(ctx, r.x + 150, r.y + 6, 300, 22, { rope: 0, label: "BARNABY'S BOATYARD" });
    // coin purse + close
    const ctxt = formatCommas(Math.floor(ui.coinShown ?? st.coins));
    const pw = measureText(ctxt) + 30;
    const px = r.x + r.w - pw - 34, py = r.y + 8;
    drawWood(ctx, px, py, pw, 19, { tone: 'light', nails: false, round: 2, planks: 1 });
    ctx.drawImage(getUiIcon('coin_big') || getUiIcon('coin'), px + 5, py + 5);
    drawText(ctx, ctxt, px + pw - 7, py + 6, { align: 'right', color: '#fff3dc', shadow: '#2a160a' });
    if (ui.button(ctx, r.x + r.w - 30, r.y + 8, 20, 19, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    // ---------------- scene
    ctx.save();
    ctx.beginPath();
    ctx.rect(S.x, S.y, S.w, S.h);
    ctx.clip();
    this.bg ||= buildBackdrop();
    ctx.drawImage(this.bg, S.x, S.y);
    drawText(ctx, 'BOATYARD', S.x + 76, S.y + 112, { align: 'center', color: '#5a2a10' });
    this.drawGulls(ctx, S, t);
    this.drawWaves(ctx, S, t, 0);
    // boat at the pier (or being lowered by the crane)
    const shown = this.drop ? this.drop.tier : this.sel;
    const spr = boatSprite(shown, 1);
    const bx = S.x + 282, bob = Math.sin(t * 1.6) * 1.5;
    let by = S.y + WATER_Y + bob, hookY = S.y + 120 + Math.sin(t * 1.3) * 3, rope = true;
    if (this.drop) {
      const d = this.drop;
      d.t += dt;
      const k = clamp01(d.t / 1.6);
      by = lerp(S.y + 110, S.y + WATER_Y, ease.inCubic(k)) + (k >= 1 ? Math.sin((d.t - 1.6) * 9) * Math.max(0, 3 - (d.t - 1.6) * 3) : 0);
      hookY = by - spr.oy + 6;
      if (k >= 1 && !d.splashed) {
        d.splashed = true;
        g.audio.play('splash_big');
        g.particles?.burst(bx, S.y + WATER_Y, 26, { colors: ['#e8fbff', '#a8e8ff', '#ffffff'], speed: 120, g: 260, up: 90, life: 1, layer: 'ui', flat: 0.6 });
        g.particles?.confetti?.(bx, S.y + 140, 40, { layer: 'ui' });
        g.audio.play('ui_unlock');
      }
      if (d.t > 3) this.drop = null;
      rope = k < 1.02;
    }
    // crane trolley + hook
    const hx = bx;
    ctx.fillStyle = '#3a3448';
    ctx.fillRect(Math.round(hx) - 5, S.y + 64, 10, 5);
    if (rope) {
      ctx.fillStyle = '#2a2a3a';
      ctx.fillRect(Math.round(hx), S.y + 69, 1, Math.max(0, Math.round(hookY - S.y - 69)));
      ctx.fillStyle = '#7a849c';
      ctx.fillRect(Math.round(hx) - 2, Math.round(hookY), 5, 3);
      ctx.fillRect(Math.round(hx) + 1, Math.round(hookY) + 3, 2, 3);
    }
    if (this.drop && rope) {
      ctx.fillStyle = '#2a2a3a';
      const top = Math.round(by - spr.oy + 8);
      for (const ex of [-40, 40]) { for (let i = 0; i < 12; i++) ctx.fillRect(Math.round(hx + (ex * i) / 12), Math.round(hookY + 4 + ((top - hookY - 4) * i) / 12), 1, 1); }
    }
    ctx.drawImage(spr.canvas, Math.round(bx - spr.ox), Math.round(by - spr.oy));
    // water over the hull below the waterline
    ctx.fillStyle = 'rgba(42,106,176,0.55)';
    ctx.fillRect(Math.round(bx - spr.ox), S.y + WATER_Y + 2, spr.w, S.h);
    this.drawWaves(ctx, S, t, 1, bx - spr.ox, spr.w);
    // status flag on the boat
    const owned = shown <= cur;
    const tag = this.drop ? 'NEW!' : shown === cur ? 'IN USE' : owned ? 'OWNED' : 'FOR SALE';
    const tw = measureText(tag, 'small') + 8;
    const tx = Math.round(bx - tw / 2), ty = S.y + 152 + Math.round(Math.sin(t * 2) * 2);
    ctx.fillStyle = '#1a1226'; ctx.fillRect(tx - 1, ty - 1, tw + 2, 11);
    ctx.fillStyle = shown === cur ? '#3ad040' : owned ? '#8a96a8' : '#ffd23a'; ctx.fillRect(tx, ty, tw, 9);
    drawText(ctx, tag, tx + 4, ty + 2, { font: 'small', color: '#1a1226' });
    if (!owned && !this.drop) drawText(ctx, `{coin} ${formatCommas(BOAT_TIERS[shown].price)}`, bx, ty + 13, { align: 'center', color: '#fff3dc', outline: '#1a1226' });
    // Barnaby on the dock
    const talking = this.lineT < this.talk;
    const frame = talking && Math.floor(t * 8) % 2 ? 2 : Math.floor(t * 0.7) % 7 === 0 && (t % 1.43) < 0.15 ? 1 : 0;
    const wsp = walrusSprite(frame);
    const wx = S.x + 156, wy = S.y + 197 - wsp.height + 1 + Math.round(Math.sin(t * 2.2) * 0.6);
    ctx.drawImage(wsp, wx, wy);
    ctx.restore();
    // speech bubble (above the scene clip so it can overlap the frame)
    this.idleT -= dt;
    if (this.idleT <= 0) { this.idleT = 9 + Math.random() * 5; this.say(pick(LINES.idle)); }
    if (this.line && this.lineT < this.talk + 3) {
      const lines = wrapText(this.line, 150);
      const bw = Math.max(...lines.map((l) => measureText(l))) + 14, bh = lines.length * 11 + 10;
      const bxx = clamp(wx - bw / 2 + 20, S.x + 4, S.x + S.w - bw - 4), byy = wy - bh - 14;
      const a = Math.min(1, (this.talk + 3 - this.lineT) * 2);
      ctx.globalAlpha = a;
      const inner = drawBubble(ctx, bxx, byy, bw, bh, { tailX: wx + 26, tailY: wy + 4 }) || { x: bxx + 6, y: byy + 5 };
      const shown2 = Math.floor(clamp01(this.lineT / Math.max(0.3, this.talk * 0.8)) * this.line.length);
      let left = shown2;
      lines.forEach((l, i) => { const s = l.slice(0, Math.max(0, left)); left -= l.length + 1; drawText(ctx, s, inner.x + 1, inner.y + 1 + i * 11, { color: '#2e1f1c' }); });
      ctx.globalAlpha = 1;
    }
    // inner frame lip
    ctx.fillStyle = '#120a06';
    ctx.fillRect(S.x - 1, S.y - 1, S.w + 2, 1); ctx.fillRect(S.x - 1, S.y + S.h, S.w + 2, 1);
    ctx.fillRect(S.x - 1, S.y, 1, S.h); ctx.fillRect(S.x + S.w, S.y, 1, S.h);
    // click the walrus / boat for fun
    const inp = g.input;
    if (ui.hover({ x: wx, y: wy, w: wsp.width, h: wsp.height }) && inp.pressed) { inp.pressed = false; this.say(pick(LINES.idle)); g.audio.play('grunt', { pitch: 0.8 }); }
    if (ui.hover({ x: bx - 60, y: by - 50, w: 120, h: 50 }) && inp.pressed) { inp.pressed = false; g.audio.play('honk', { pitch: 1.2 - shown * 0.1 }); }

    // ---------------- fleet catalogue
    this.drawCatalogue(ctx, ui, P, cur, t);
  }

  drawWaves(ctx, S, t, front, x0 = S.x, w = S.w) {
    const y = S.y + WATER_Y + (front ? 2 : -4);
    for (let i = 0; i < w; i += 2) {
      const x = x0 + i;
      const h = Math.sin(x * 0.12 + t * (front ? 2.4 : 1.6)) * 1.5 + Math.sin(x * 0.05 - t) * 1;
      ctx.fillStyle = front ? 'rgba(220,248,255,0.85)' : 'rgba(190,236,255,0.6)';
      if (h > 0.6) ctx.fillRect(Math.round(x), Math.round(y - h), 2, 1);
    }
  }

  drawGulls(ctx, S, t) {
    for (let i = 0; i < 3; i++) {
      const x = S.x + ((t * (14 + i * 5) + i * 140) % (S.w + 40)) - 20, y = S.y + 30 + i * 18 + Math.sin(t * 1.5 + i) * 4;
      const f = Math.floor(t * 5 + i) % 2;
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(Math.round(x) - 3, Math.round(y) - f, 3, 1);
      ctx.fillRect(Math.round(x) + 1, Math.round(y) - f, 3, 1);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      ctx.fillRect(Math.round(x) - 4, Math.round(y) - f - 1, 1, 1);
      ctx.fillRect(Math.round(x) + 4, Math.round(y) - f - 1, 1, 1);
    }
  }

  drawCatalogue(ctx, ui, P, cur, t) {
    const g = this.game, st = g.state;
    drawPaper(ctx, P.x, P.y, P.w, P.h, { aged: true });
    drawText(ctx, 'FLEET CATALOGUE', P.x + P.w / 2, P.y + 7, { align: 'center', color: '#5a2a10' });
    ctx.fillStyle = '#c8ac80';
    ctx.fillRect(P.x + 10, P.y + 17, P.w - 20, 1);
    const rowH = 36;
    BOAT_TIERS.forEach((b, i) => {
      const y = P.y + 21 + i * rowH;
      const rr = { x: P.x + 4, y, w: P.w - 8, h: rowH - 2 };
      const hov = ui.hover(rr);
      if (this.sel === i) { ctx.fillStyle = 'rgba(255,210,90,0.45)'; ctx.fillRect(rr.x, rr.y, rr.w, rr.h); }
      else if (hov) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(rr.x, rr.y, rr.w, rr.h); }
      if (ui.clicked(rr) && !this.drop) { this.sel = i; g.audio.play('ui_tab'); if (i <= cur) this.say(pick(LINES.owned)); }
      const th = boatSprite(i, 0.3);
      ctx.drawImage(th.canvas, Math.round(rr.x + 30 - th.ox), Math.round(y + 26 - th.oy));
      ctx.fillStyle = 'rgba(42,106,176,0.35)';
      ctx.fillRect(rr.x + 30 - th.ox, y + 26, th.w, 6);
      drawText(ctx, b.name, rr.x + 62, y + 6, { color: '#2e1f1c' });
      let status, color;
      if (i === cur) { status = 'IN USE'; color = '#2a8a2a'; }
      else if (i < cur) { status = 'OWNED'; color = '#8a7a6a'; }
      else if (i === cur + 1) { status = `{coin} ${formatCommas(b.price)}`; color = (st.coins || 0) >= b.price ? '#8a5a00' : '#c03a2a'; }
      else { status = `{lock} ${formatCommas(b.price)}`; color = '#9a8a7a'; }
      drawText(ctx, status, rr.x + 62, y + 18, { color, font: i > cur ? 'normal' : 'small' });
      if (i === cur) ctx.drawImage(getUiIcon('check'), rr.x + rr.w - 14, y + 6);
    });
    // perks of the selection vs current boat
    let y = P.y + 21 + BOAT_TIERS.length * rowH + 2;
    ctx.fillStyle = '#c8ac80';
    ctx.fillRect(P.x + 10, y - 2, P.w - 20, 1);
    const sb = BOAT_TIERS[this.sel], cb = BOAT_TIERS[cur];
    wrapText(sb.desc, P.w - 20).slice(0, 2).forEach((l, i) => drawText(ctx, l, P.x + 10, y + 2 + i * 10, { color: '#6b4f43' }));
    y += 22;
    for (const [k, meta] of Object.entries(BOAT_PERKS)) {
      const v = sb.perks[k], c0 = cb.perks[k];
      const neutral = meta.kind === 'mul' ? v === 1 : v === 0;
      drawText(ctx, meta.label, P.x + 10, y, { font: 'small', color: neutral ? '#a8987a' : '#3a2a20' });
      const txt = neutral ? '-' : meta.fmt(v);
      const better = v > c0;
      drawText(ctx, txt, P.x + P.w - 12, y, { font: 'small', color: better ? '#2a8a2a' : neutral ? '#a8987a' : '#3a2a20', align: 'right' });
      if (better && this.sel > cur) ctx.drawImage(getUiIcon('arrow_u'), P.x + P.w - 22 - measureText(txt, 'small'), y - 3);
      y += 9;
    }
    // buy button
    const by = P.y + P.h - 28;
    const can = this.sel === cur + 1;
    const label = this.sel <= cur ? (this.sel === cur ? 'Your current boat' : 'Already owned') : can ? `Buy for ${formatCommas(sb.price)}` : 'Buy the one before';
    if (ui.button(ctx, P.x + 14, by, P.w - 28, 22, label, { icon: can ? 'coin' : this.sel <= cur ? 'check' : 'lock', disabled: !can || !!this.drop, tip: can ? sb.desc : null })) this.buy(this.sel);
    if (this.sel === cur && cur === BOAT_TIERS.length - 1) drawStamp(ctx, P.x + P.w / 2, P.y + 120, 'FLEET COMPLETE', { color: '#2a8a2a', angle: -0.2 });
    void t;
  }
}

export function perkSummary(tier) {
  const p = BOAT_TIERS[tier]?.perks || {};
  const out = [];
  if (p.baitSlots) out.push(`+${p.baitSlots} bait slots`);
  if (p.reel > 1) out.push(`+${Math.round((p.reel - 1) * 100)}% reel`);
  if (p.depth) out.push('deeper dives');
  if (p.netBoost > 1) out.push('satellite internet');
  return out.join(', ');
}

void hash1; void makeCanvas; void ctxOf;
