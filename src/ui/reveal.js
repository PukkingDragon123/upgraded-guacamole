// Catch reveal, Frutiger Aero meme-poster style: a glossy glass card with a bright sky-blue sun burst,
// glossy green leaves framing the big VOXEL fish (slow turntable swivel via drawFishRig), a sun flare,
// rising bubbles and a water splash along the bottom. Minimal text: the fish's name, rarity stars,
// size and weight chips, mutation / trait badges, a NEW sticker, the Aero bonus, and two icon orbs:
// Keep (tank) and Release (+Aero). Enter keeps.

import { TAU, clamp, clamp01, ease, lerp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { RARITY, rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { glowSprite, gbubbleSprite, thickRingSprite } from '../gfx/particles.js';
import { traitList, valueMultiplier } from '../fish/traits.js';
import { RELEASE_VALUE } from '../game/shopdata.js';
import { drawAeroPanel, drawGlossOrb, drawAeroCoin } from './aero.js';
import { glossText, drawGlassPill, glossFor } from '../fishing/cinematics.js';
import { centerRect } from './ui.js';

const REACTIONS = ['surprised', 'happy', 'love', 'smug', 'dizzy', 'happy', 'surprised'];
const INK = '#0c3a52';

// ------------------------------------------------------------------ pixel painters
function paint(w, h, fn) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    if (!v) continue;
    const i = (y * w + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v[3] ?? 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixRgb = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); t = clamp01(t); return [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t)); };

// Glossy leaf, rotated per pixel so it stays crisp: lime body, lighter upper half, midrib + side veins,
// a white specular streak and a dark green rim. Base (stem) at the canvas centre.
const LEAVES = new Map();
function leafSprite(L, Wd, angDeg) {
  const ab = Math.round(angDeg / 10) * 10;
  const key = L + '|' + Wd + '|' + ab;
  let c = LEAVES.get(key);
  if (c) return c;
  const a = (ab * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const C = L + 3, S = C * 2 + 1;
  c = paint(S, S, (x, y) => {
    const dx = x - C + 0.5, dy = y - C + 0.5;
    const along = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    const u = along / L;
    if (u < -0.12 || u > 1.02) return null;
    if (u < 0.06) return Math.abs(v) < 0.9 ? [...hexRgb('#2f8a1e'), 255] : null; // stem
    const hw = Wd * Math.pow(Math.sin(Math.PI * clamp01(u)), 0.7) * (1 - 0.3 * u);
    const av = Math.abs(v);
    if (av > hw + 0.5) return null;
    if (av > hw - 0.8) return [...hexRgb(v < 0 ? '#2f9a1e' : '#145a0c'), 255];
    if (av < 0.55 && u < 0.92) return [...hexRgb('#d8ff9a'), 255];
    const vein = ((along - av * 1.1) % 6 + 6) % 6 < 0.9 && av < hw - 1.6 && u > 0.12 && u < 0.85;
    const upper = v < 0;
    const k = (upper ? 0.66 : 0.28) + 0.28 * u - 0.3 * (av / Math.max(1, hw));
    if (upper && av > hw * 0.4 && av < hw * 0.62 && u > 0.2 && u < 0.58) return [236, 255, 200, 255];
    const col = mixRgb('#1f7a12', '#7fdc32', k);
    return vein ? [...mixRgb('#8be04a', '#d8ff9a', 0.5), 255] : [...col, 255];
  });
  if (LEAVES.size > 200) LEAVES.clear();
  LEAVES.set(key, c);
  return c;
}

// Leaves framing the card: [x, y (fractions of the card; outside 0..1 pokes out), angle deg, length, width, front?]
// Back leaves sit inside the glass (clipped); front leaves break out over the frame.
const LEAF_LAYOUT = [
  [0.0, 0.0, 28, 74, 21, 0], [0.0, 0.02, 68, 62, 18, 0], [0.1, -0.03, 8, 58, 16, 0], [0.0, 0.3, -12, 50, 15, 0],
  [1.0, 0.0, 152, 74, 21, 0], [1.0, 0.02, 112, 62, 18, 0], [0.9, -0.03, 172, 58, 16, 0], [1.0, 0.3, 192, 50, 15, 0],
  [0.0, 1.0, -38, 62, 18, 0], [1.0, 1.0, 218, 56, 17, 0],
  [0.02, 0.16, 196, 50, 15, 1], [0.03, 0.06, 232, 44, 13, 1], [0.12, 0.0, 262, 36, 11, 1],
  [0.98, 0.16, -16, 50, 15, 1], [0.97, 0.06, -52, 44, 13, 1], [0.88, 0.0, -82, 36, 11, 1],
  [0.01, 0.66, 168, 42, 13, 1], [0.99, 0.56, 12, 42, 13, 1],
];

function drawLeaves(ctx, r, t, front) {
  for (let i = 0; i < LEAF_LAYOUT.length; i++) {
    const [fx, fy, ang, L, Wd, fr] = LEAF_LAYOUT[i];
    if (!!fr !== front) continue;
    const sway = Math.sin(t * 1.3 + i * 1.7) * 5;
    const s = leafSprite(L, Wd, ang + sway);
    const C = (s.width - 1) / 2;
    ctx.drawImage(s, Math.round(r.x + fx * r.w - C), Math.round(r.y + fy * r.h - C));
  }
}

// Sun flare: hot core, star rays, anamorphic streak and a few ghosts toward the card centre.
function drawSunFlare(ctx, x, y, t, a, toward) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  ctx.drawImage(glowSprite(38, '#fff8d0'), Math.round(x - 38), Math.round(y - 38));
  ctx.drawImage(glowSprite(16, '#ffffff'), Math.round(x - 16), Math.round(y - 16));
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU + t * 0.15;
    const len = (i % 2 ? 26 : 46) + Math.sin(t * 3 + i) * 4;
    for (let k = 4; k < len; k++) {
      ctx.globalAlpha = a * (1 - k / len) * 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x + Math.cos(ang) * k), Math.round(y + Math.sin(ang) * k), 1, 1);
    }
  }
  for (let k = 0; k < 90; k += 2) {
    ctx.globalAlpha = a * (1 - k / 90) * 0.6;
    ctx.fillStyle = '#e8fbff';
    ctx.fillRect(Math.round(x + k), Math.round(y), 2, 1); ctx.fillRect(Math.round(x - k - 2), Math.round(y), 2, 1);
  }
  const G = [[0.35, 4, '#9affd8'], [0.6, 9, '#7ad8ff'], [0.9, 3, '#ffe27a'], [1.25, 12, '#c8a8ff']];
  for (const [k, rr, col] of G) {
    const gx = Math.round(lerp(x, toward[0], k)), gy = Math.round(lerp(y, toward[1], k));
    ctx.globalAlpha = a * 0.3;
    const rs = thickRingSprite(rr, 1, col, 1);
    ctx.drawImage(rs, gx - Math.floor(rs.width / 2), gy - Math.floor(rs.height / 2));
    ctx.drawImage(glowSprite(rr, col), gx - rr, gy - rr);
  }
  ctx.restore();
}

// Water splash across the bottom of the card: rolling crest, foam line, flying droplets.
function drawSplash(ctx, x, y, w, t) {
  const base = y;
  for (let i = 0; i < w; i++) {
    const h = 10 + Math.sin(i * 0.07 + t * 1.8) * 4 + Math.sin(i * 0.19 - t * 2.6) * 3 + Math.max(0, Math.sin(i * 0.031 + t * 0.9)) * 7;
    const top = Math.round(base - h);
    for (let yy = top; yy < base + 30; yy++) {
      const k = (yy - top) / 26;
      ctx.fillStyle = k < 0.12 ? '#ffffff' : k < 0.25 ? 'rgba(220,250,255,0.95)' : `rgba(${Math.round(89 - k * 40)},${Math.round(195 - k * 40)},255,${0.85})`;
      ctx.fillRect(x + i, yy, 1, 1);
    }
    if (((i * 7 + Math.floor(t * 10)) % 23) === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + i, top - 3 - ((i + Math.floor(t * 20)) % 6), 1, 2); }
  }
  // curling spray arcs
  for (let s = 0; s < 3; s++) {
    const cx = x + w * (0.2 + s * 0.3) + Math.sin(t + s) * 10;
    const ph = (t * 0.7 + s * 0.33) % 1;
    for (let k = 0; k < 14; k++) {
      const u = k / 13;
      const px = cx + (u - 0.5) * 40, py = base - 12 - Math.sin(u * Math.PI) * (18 + 10 * Math.sin(ph * Math.PI));
      ctx.fillStyle = rgba('#ffffff', 0.85 * Math.sin(ph * Math.PI));
      ctx.fillRect(Math.round(px), Math.round(py), 2, 1);
    }
  }
}

// Glossy "NEW!" starburst sticker.
function drawSticker(ctx, x, y, text, k, t, col = '#ff4f5e') {
  const s = ease.outBack(clamp01(k));
  if (s <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.25 + Math.sin(t * 2) * 0.04);
  ctx.scale(s * (k < 1 ? 1 + (1 - k) * 1.2 : 1), s * (k < 1 ? 1 + (1 - k) * 1.2 : 1));
  const R = 18, n = 14;
  ctx.beginPath();
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * TAU, rr = i % 2 ? R * 0.8 : R;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = INK; ctx.fill();
  ctx.scale(0.88, 0.88);
  ctx.fillStyle = col; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-R, -R, R * 2, R * 0.9);
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.25);
  drawText(ctx, text, 0, -4, { align: 'center', color: '#ffffff', outline: '#7a0a18' });
  ctx.restore();
}

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
    this.sound = data.isNew ? 'new_species' : 'ui_open';
    this.stamped = false;
    this.burst = false;
    this.bubT = 0;
    this.hot = null;
  }

  draw(ctx, ui, dt) {
    const g = this.game, d = this.data;
    this.t += dt;
    const t = this.t;
    const W = 470, H = 304;
    const r = centerRect(g, W, H);
    this.rect = r;
    const rar = RARITY[d.sp.rarity] || RARITY.common;
    const pop = ease.outBack(clamp01(t * 3.5));
    const pcx = r.x + W / 2, pcy = r.y + H / 2;
    const fcx = pcx, fcy = r.y + 132;
    if (!this.burst && t > 0.05) this.openFx(fcx, fcy, rar);
    ctx.save();
    ctx.translate(pcx, pcy);
    ctx.scale(lerp(0.5, 1, pop), lerp(0.5, 1, pop));
    ctx.translate(-pcx, -pcy);
    // outer rarity halo
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(t * 3);
    ctx.drawImage(glowSprite(230, rar.color), Math.round(pcx - 230), Math.round(pcy - 230));
    ctx.restore();
    // ---- the card: glossy glass body with a sky-blue sun burst inside
    drawAeroPanel(ctx, r.x, r.y, W, H, { tone: 'sky', radius: 12, bubbles: 0, sparkle: 0 });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(r.x + 4, r.y + 4, W - 8, H - 8, 9) : ctx.rect(r.x + 4, r.y + 4, W - 8, H - 8);
    ctx.clip();
    const sky = ctx.createLinearGradient(0, r.y, 0, r.y + H);
    sky.addColorStop(0, '#1e8fe0'); sky.addColorStop(0.45, '#59c3ff'); sky.addColorStop(0.8, '#bfeaff'); sky.addColorStop(1, '#e8fbff');
    ctx.fillStyle = sky;
    ctx.fillRect(r.x, r.y, W, H);
    // burst rays from the fish
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU + t * 0.12;
      ctx.fillStyle = rgba('#ffffff', i % 2 ? 0.07 : 0.13);
      ctx.beginPath();
      ctx.moveTo(fcx, fcy);
      ctx.lineTo(fcx + Math.cos(a - 0.08) * 400, fcy + Math.sin(a - 0.08) * 400);
      ctx.lineTo(fcx + Math.cos(a + 0.08) * 400, fcy + Math.sin(a + 0.08) * 400);
      ctx.fill();
    }
    ctx.globalAlpha = 0.7;
    ctx.drawImage(glowSprite(110, '#ffffff'), Math.round(fcx - 110), Math.round(fcy - 110));
    ctx.globalAlpha = 0.5;
    ctx.drawImage(glowSprite(70, rar.color), Math.round(fcx - 70), Math.round(fcy - 70));
    ctx.restore();
    // white swoosh arcs (eco wallpaper)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < W; i += 1) {
        const yy = r.y + H * 0.62 + k * 7 - Math.sin((i / W) * Math.PI) * (40 + k * 6) + Math.sin(t + k) * 2;
        ctx.fillRect(r.x + i, Math.round(yy), 1, 1);
      }
    }
    drawSunFlare(ctx, r.x + 64, r.y + 44, t, 1, [fcx, fcy]);
    drawLeaves(ctx, r, t, false);
    // bubbles drifting up behind the fish
    for (let i = 0; i < 12; i++) {
      const ph = (t * (0.08 + (i % 4) * 0.03) + i * 0.137) % 1;
      const bx = r.x + 20 + ((i * 97) % (W - 40)) + Math.sin(t * 2 + i) * 4;
      const by = r.y + H - 10 - ph * (H - 10);
      const b = gbubbleSprite(2 + (i % 5) * 2);
      ctx.globalAlpha = Math.sin(ph * Math.PI);
      ctx.drawImage(b, Math.round(bx - b.width / 2), Math.round(by - b.height / 2));
    }
    ctx.globalAlpha = 1;
    drawSplash(ctx, r.x, r.y + H - 28, W, t);
    this.bubT -= dt;
    if (this.bubT <= 0 && t > 0.3) {
      this.bubT = 0.12;
      const P = g.particles, sx = r.x + 20 + rng.float(0, W - 40);
      P.droplets?.(sx, r.y + H - 40, 3, { layer: 'ui', dir: -Math.PI / 2, spread: 0.6, speed: [40, 110], g: 260, colors: ['#ffffff', '#e8fbff', '#bff8ff'] });
      if (rng.chance(0.4)) P.aeroBubbles?.(sx, r.y + H - 30, 1, { layer: 'ui', speed: [20, 60], sizes: [2, 3, 4, 5] });
    }
    // ---- the fish: big voxel model on a slow swivel
    this.emoT += dt;
    if (this.emoT > 2.4) { this.emoT = 0; this.emo = rng.pick(REACTIONS); }
    this.drawFish(ctx, fcx, fcy, 300, 150, t);
    ctx.restore();
    drawLeaves(ctx, r, t, true);
    // ---- name + stars
    const pal = glossFor(d.sp.rarity);
    const nameScale = measureText(d.sp.name, 'normal', 3) <= W - 150 ? 3 : measureText(d.sp.name, 'normal', 2) <= W - 70 ? 2 : 1;
    const ny = r.y + 12;
    if (nameScale >= 2) {
      const gname = glossText(d.sp.name, nameScale, pal);
      ctx.drawImage(gname.c, Math.round(pcx - gname.w / 2 - gname.ox), Math.round(ny - gname.oy));
    } else drawText(ctx, d.sp.name, pcx, ny + 3, { align: 'center', color: '#ffffff', outline: INK });
    const star = getUiIcon('star'), starE = getUiIcon('star_empty');
    if (star) {
      for (let i = 0; i < 5; i++) {
        const k = ease.outBack(clamp01((t - 0.35 - i * 0.08) * 4));
        if (k <= 0) continue;
        const ic = i < rar.stars ? star : starE;
        const sx = Math.round(pcx - 31 + i * 13), sy = ny + 8 + nameScale * 8;
        ctx.save();
        ctx.translate(sx + ic.width / 2, sy + ic.height / 2);
        ctx.scale(k, k);
        ctx.drawImage(ic, -ic.width / 2, -ic.height / 2);
        ctx.restore();
      }
    }
    // ---- trait / mutation badges under the fish
    const traits = traitList(d.rec);
    let bw = 0;
    const tw = traits.map((tr) => measureText(tr.text, 'small', 1) + 14);
    for (const w of tw) bw += w + 4;
    let bx = pcx - bw / 2;
    for (let i = 0; i < traits.length; i++) {
      const k = ease.outBack(clamp01((t - 0.6 - i * 0.1) * 4));
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha = clamp01(k);
        drawGlassPill(ctx, bx + tw[i] / 2, r.y + 214, tw[i], 11, traits[i].color, 0.95);
        drawText(ctx, traits[i].text.toUpperCase(), bx + tw[i] / 2, r.y + 217, { align: 'center', font: 'small', color: INK });
        ctx.restore();
      }
      bx += tw[i] + 4;
    }
    // ---- size + weight chips (bottom left)
    const cy0 = r.y + H - 34;
    this.chip(ctx, r.x + 16, cy0, 'ruler', `${d.rec.sizeCm} cm`);
    this.chip(ctx, r.x + 16, cy0 + 15, 'weight', `${d.rec.weightKg} kg`);
    // Aero bonus (top right)
    if (d.bonus) {
      const label = '+' + d.bonus;
      const w = measureText(label, 'normal', 1) + 22;
      drawGlassPill(ctx, r.x + 16 + w / 2, r.y + H - 54, w, 14, '#2fd3e8', 0.95);
      drawAeroCoin(ctx, r.x + 24, r.y + H - 47, 4.5, t);
      drawText(ctx, label, r.x + 30, r.y + H - 51, { color: INK });
    }
    ctx.restore();
    // ---- NEW / RECORD stickers
    if (d.isNew && t > 0.9) {
      const st = clamp01((t - 0.9) * 5);
      if (!this.stamped && st >= 1) { this.stamped = true; g.audio.play('record'); g.camera.shake?.(2); g.particles.aeroConfetti?.(r.x + 30, r.y + 30, 16, { layer: 'ui', speed: [60, 160] }); }
      drawSticker(ctx, r.x + W - 44, r.y + 40, 'NEW!', st, t);
    }
    if (d.record) drawSticker(ctx, r.x + W - 44, r.y + (d.isNew ? 84 : 40), 'BEST', clamp01((t - 1.1) * 5), t, '#ffb02e');
    // camera flash when the card appears
    if (t < 0.3) {
      ctx.fillStyle = rgba('#ffffff', (1 - t / 0.3) * 0.7);
      ctx.fillRect(r.x - 6, r.y - 6, W + 12, H + 12);
    }
    // ---- icon orbs: keep (tank) / release (+Aero)
    const full = g.tankCount() >= g.stats.tankCap;
    const relVal = Math.round((RELEASE_VALUE[d.sp.rarity] || 4) * valueMultiplier(d.rec));
    const oy = r.y + H - 30;
    const keepX = r.x + W - (d.tutorial ? 46 : 96);
    if (this.orb(ctx, ui, keepX, oy, full ? '#ffd23a' : '#2fd3e8', 'tank', full ? 'Tank full: holding bucket' : 'Keep in your aquarium', 'keep') || g.input.keyPressed('Enter')) {
      g.keepFish(d.rec);
      this.done();
      return;
    }
    if (!d.tutorial) {
      const relX = r.x + W - 46;
      if (this.orb(ctx, ui, relX, oy, '#8be04a', 'heart', `Release: +${relVal} Aero`, 'release')) {
        g.releaseFish(d.rec, relX, oy);
        this.done();
        return;
      }
      const label = '+' + relVal;
      const w = measureText(label, 'small', 1) + 16;
      drawGlassPill(ctx, relX, oy + 20, w, 9, '#2fd3e8', 0.95);
      drawAeroCoin(ctx, relX - w / 2 + 6, oy + 24, 3, t);
      drawText(ctx, label, relX - w / 2 + 11, oy + 22, { font: 'small', color: INK });
    }
  }

  openFx(x, y, rar) {
    const g = this.game, P = g.particles;
    this.burst = true;
    P.aeroBubbles?.(x, y + 30, 18, { layer: 'ui', w: 80, h: 20, speed: [40, 120], sizes: [2, 3, 4, 5, 7] });
    P.aeroConfetti?.(x, y - 20, 40, { layer: 'ui', spread: Math.PI, speed: [100, 260], w: 40 });
    P.ringWave?.(x, y, 120, '#ffffff', { layer: 'ui', life: 0.5, w: 4 });
    P.ringWave?.(x, y, 80, rar.color, { layer: 'ui', life: 0.45, w: 3, delay: 0.06 });
    P.lensFlare?.(x - 140, y - 80, { layer: 'ui', cx: g.screen.W / 2, cy: g.screen.H / 2, life: 1.6, scale: 1.1 });
    P.glints?.(x, y, 8, { layer: 'ui', w: 120, h: 50 });
  }

  drawFish(ctx, x, y, bw, bh, t) {
    const d = this.data, g = this.game;
    const L = (this.c.L || d.sp.look.body?.len || 30) * 1.3 * (d.sp.look.kind === 'seahorse' ? 0.6 : 1);
    const sc = Math.min(7, Math.max(0.6, Math.min(bw / Math.max(12, L), bh / Math.max(8, L * 0.6))));
    const k = ease.outBack(clamp01((t - 0.15) * 2.2));
    // slow swivel through the front view (voxel turntable), settling side-on between turns
    const ph = t * 0.55;
    const turn = Math.cos(Math.sin(ph) * 0.95);
    const fy = y + Math.sin(t * 1.6) * 3;
    // soft shadow glow under the fish
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(glowSprite(Math.round(bw * 0.35), '#ffffff'), Math.round(x - bw * 0.35), Math.round(fy - bw * 0.35));
    ctx.restore();
    try {
      drawFishRig(ctx, this.c, {
        x, y: fy, facing: 1, turn: Math.sign(turn || 1) * Math.max(0.05, Math.abs(turn)), angle: Math.sin(t * 1.3) * 0.08, scale: sc * k,
        squash: Math.sin(t * 9) * 0.06 * (1 - clamp01(t)),
        swimPhase: (t * 0.9) % 1, tailPhase: (t * 1.6) % 1, finPhase: (t * 2.2) % 1, speed01: 0.4, inflate: 0,
        lookX: g.input.x, lookY: g.input.y, blink: (t % 3) < 0.1 ? 1 : 0, emotion: this.emo,
        mouth: Math.abs(Math.sin(t * 7)) * (this.emo === 'surprised' ? 0.8 : 0.3), time: t, pri: 3,
        chain: d.sp.look.kind === 'chain' ? fakeChain(x, fy, t, sc) : null,
      });
    } catch (e) {
      if (!this.rigErr) { this.rigErr = true; console.warn('reveal fish', e); }
    }
    if ((d.rec.variant?.shiny || d.sp.rarity === 'legendary') && rng.chance(0.25)) g.particles.glint?.(x + rng.float(-bw * 0.35, bw * 0.35), fy + rng.float(-bh * 0.3, bh * 0.3), { layer: 'ui', color: '#fff6b0' });
  }

  chip(ctx, x, y, icon, text) {
    const w = measureText(text, 'normal', 1) + 24;
    drawGlassPill(ctx, x + w / 2, y, w, 13, '#bfeaff', 0.95);
    if (icon === 'ruler') {
      ctx.fillStyle = INK; ctx.fillRect(x + 4, y + 4, 10, 5);
      ctx.fillStyle = '#ffe27a'; ctx.fillRect(x + 5, y + 5, 8, 3);
      ctx.fillStyle = INK; for (let i = 0; i < 4; i++) ctx.fillRect(x + 6 + i * 2, y + 5, 1, i % 2 ? 1 : 2);
    } else {
      ctx.fillStyle = INK; ctx.fillRect(x + 5, y + 3, 8, 8); ctx.fillRect(x + 7, y + 2, 4, 1);
      ctx.fillStyle = '#b4d0e2'; ctx.fillRect(x + 6, y + 5, 6, 5);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 6, y + 5, 2, 1);
    }
    drawText(ctx, text, x + 18, y + 3, { color: INK });
  }

  // Big glossy icon orb button; returns true when clicked.
  orb(ctx, ui, cx, cy, color, icon, tip, id) {
    const R = 18;
    const rect = { x: cx - R - 2, y: cy - R - 2, w: R * 2 + 4, h: R * 2 + 4 };
    const hov = ui.hover(rect);
    const down = hov && this.game.input.down;
    const t = this.t;
    const k = ease.outBack(clamp01((t - 0.5 - (id === 'release' ? 0.08 : 0)) * 4));
    if (k <= 0) return false;
    ctx.save();
    ctx.translate(cx, cy + (down ? 1 : 0));
    ctx.scale(k * (hov ? 1.08 : 1), k * (hov ? 1.08 : 1));
    if (hov || id === 'keep') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = hov ? 0.6 : 0.25 + 0.15 * Math.sin(t * 4);
      ctx.drawImage(glowSprite(R + 10, color), -R - 10, -R - 10);
      ctx.restore();
    }
    ctx.fillStyle = INK;
    for (let y = -R - 1; y <= R + 1; y++) { const w = Math.round(Math.sqrt(Math.max(0, (R + 1.4) ** 2 - y * y))); ctx.fillRect(-w, y, w * 2 + 1, 1); }
    drawGlossOrb(ctx, 0, 0, R, color, t);
    const ic = getUiIcon(icon);
    if (ic) ctx.drawImage(ic, Math.round(-ic.width / 2), Math.round(-ic.height / 2) + 1);
    ctx.restore();
    if (hov) { ui.tip = tip; ui.markHot?.('reveal' + id); }
    if (ui.clicked(rect)) { this.game.audio.play(id === 'keep' ? 'ui_click' : 'splash_small'); return true; }
    return false;
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

void clamp;
