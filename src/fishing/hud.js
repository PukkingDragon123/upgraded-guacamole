// Fight HUD (screen space): ornate catch-progress bar, tension dial, fish stamina, name plate,
// status line, context prompts with mouse icons, the crank ring that follows the player's loop,
// the pull-zone indicator around the fish, ink splats, and the "angler cam" inset showing the
// player's character reeling.

import { TAU, clamp, clamp01, lerp } from '../core/math.js';
import { rgba, RARITY } from '../core/color.js';
import { drawText, measureText, registerInlineIcon } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawCharacter } from '../gfx/character.js';
import { discSprite } from '../gfx/particles.js';

const INK = '#0b1622';

// ------------------------------------------------------------------ inline icons
let iconsReady = false;
function crankIcon(dir) {
  const c = makeCanvas(11, 11);
  const g = ctxOf(c);
  const pts = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU * 0.8 + (dir > 0 ? -Math.PI / 2 : -Math.PI / 2);
    const aa = dir > 0 ? a : -a + Math.PI;
    pts.push([Math.round(5 + Math.cos(aa) * 4), Math.round(5 + Math.sin(aa) * 4)]);
  }
  g.fillStyle = INK;
  for (const [x, y] of pts) g.fillRect(x - 1, y - 1, 3, 3);
  g.fillStyle = '#ffe27a';
  for (const [x, y] of pts) g.fillRect(x, y, 1, 1);
  // arrow head at the end
  const [ex, ey] = pts[pts.length - 1];
  g.fillStyle = INK; g.fillRect(ex - 2, ey - 2, 5, 5);
  g.fillStyle = '#ffffff'; g.fillRect(ex - 1, ey - 1, 3, 3);
  return c;
}

function ensureIcons() {
  if (iconsReady) return;
  iconsReady = true;
  registerInlineIcon('crank_cw', crankIcon(1));
  registerInlineIcon('crank_ccw', crankIcon(-1));
  registerInlineIcon('crank', crankIcon(1));
}

// ------------------------------------------------------------------ small drawing helpers
function box(ctx, x, y, w, h, fill, edge = INK) {
  ctx.fillStyle = edge; ctx.fillRect(x - 1, y, w + 2, h); ctx.fillRect(x, y - 1, w, h + 2);
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
}

function brassFrame(ctx, x, y, w, h) {
  ctx.fillStyle = INK; ctx.fillRect(x - 3, y - 2, w + 6, h + 4); ctx.fillRect(x - 2, y - 3, w + 4, h + 6);
  ctx.fillStyle = '#8a5a1a'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#d8a040'; ctx.fillRect(x - 2, y - 2, w + 4, h + 3);
  ctx.fillStyle = '#ffe08a'; ctx.fillRect(x - 1, y - 2, w + 2, 1);
  ctx.fillStyle = '#5a3208'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
}

export function inkSplatSprite(r) { return discSprite(r, '#0a0614', 0.35, '#1a1030'); }

// ------------------------------------------------------------------ main fight HUD
function bands(F) {
  const H = F.H;
  const bars = F.cam?.bars ?? 0;
  const barH = Math.round(H * 0.11 * bars);
  return { barH, topH: Math.max(barH, 40), botH: Math.max(barH, 50) };
}

// In-scene markers (drawn under the letterbox): pull zone, crank ring, event visuals, ink.
export function drawFightScene(ctx, F, B) {
  ensureIcons();
  ctx.save();
  ctx.globalAlpha = B.hudIn;
  drawPullZone(ctx, F, B);
  drawCrankRing(ctx, F, B);
  if (B.event) B.event.drawHud(ctx);
  drawInk(ctx, F);
  ctx.restore();
}

// Panels living in the letterbox bands: name, stamina, status, catch bar, tension, angler cam, prompt.
export function drawFightBands(ctx, F, B) {
  ensureIcons();
  const W = F.W, H = F.H;
  const { barH, topH, botH } = bands(F);
  ctx.save();
  ctx.globalAlpha = B.hudIn;
  if (barH < 30) {
    // no letterbox: draw our own soft backing strips
    ctx.fillStyle = rgba('#05080c', 0.55);
    ctx.fillRect(0, barH, W, topH - barH);
    ctx.fillRect(0, H - botH, W, botH - barH);
  }
  const ty = Math.round(topH / 2);
  drawNamePlate(ctx, F, 14, ty - 12);
  drawStamina(ctx, F, B, W - 14, ty - 2);
  drawStatus(ctx, F, B, W / 2, ty - 6);
  const by = H - Math.round(botH / 2) - 2;
  const bw = Math.min(380, Math.round(W * 0.42));
  drawProgressBar(ctx, F, B, Math.round(W / 2 - bw / 2), by - 6, bw);
  drawTensionDial(ctx, F, B, W - 64, H - 8);
  drawAnglerCam(ctx, F, B, 10, H - botH - 112);
  drawPrompt(ctx, F, B, W / 2, H - botH - 18);
  ctx.restore();
}

export function drawFightHud(ctx, F, B) {
  drawFightScene(ctx, F, B);
  drawFightBands(ctx, F, B);
}

// ------------------------------------------------------------------ name plate & stamina
function drawNamePlate(ctx, F, x, y) {
  const sp = F.sp, rar = RARITY[sp.rarity] || RARITY.common;
  const name = sp.name;
  drawText(ctx, name, x, y, { color: rar.color, outline: INK, scale: 2 });
  const sx = x + measureText(name, 'normal', 2) + 8;
  for (let i = 0; i < 5; i++) {
    const ic = getUiIcon(i < rar.stars ? 'star' : 'star_empty');
    if (ic) ctx.drawImage(ic, sx + i * 10, y + 2);
  }
  drawText(ctx, rar.name.toUpperCase() + (F.fish?.rec?.giant ? '  GIANT!' : ''), sx, y + 14, { font: 'small', color: rar.color, outline: INK });
}

function drawStamina(ctx, F, B, right, y) {
  const w = 150, h = 8, x = right - w;
  drawText(ctx, 'STAMINA', x, y - 9, { font: 'small', color: '#ffd2b0', outline: INK });
  const pct = Math.round(B.stamina * 100) + '%';
  drawText(ctx, pct, right, y - 9, { font: 'small', color: '#ffffff', outline: INK, align: 'right' });
  const shake = B.counter > 0.5 && B.surging ? Math.round(Math.sin(F.t * 60) * 1) : 0;
  box(ctx, x + shake, y, w, h, '#2a1214');
  const fw = Math.round(w * clamp01(B.stamina));
  const col = B.exhausted ? '#ffe27a' : B.stamina < 0.3 ? '#ff5a4a' : '#ff8a3a';
  ctx.fillStyle = col; ctx.fillRect(x + shake, y, fw, h);
  ctx.fillStyle = rgba('#ffffff', 0.35); ctx.fillRect(x + shake, y, fw, 2);
  ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(x + shake, y + h - 2, fw, 2);
  ctx.fillStyle = rgba(INK, 0.6);
  for (let i = 1; i < 10; i++) ctx.fillRect(x + shake + Math.round((w * i) / 10), y, 1, h);
  const fic = getUiIcon('fish');
  if (fic) ctx.drawImage(fic, x - fic.width - 4, y - 1);
}

function drawStatus(ctx, F, B, cx, y) {
  let text = 'REEL IT IN!', col = '#9affb8';
  const tr = B.trick;
  if (B.event) { text = B.event.title; col = B.event.color || '#ffe27a'; }
  else if (B.mode === 'hookset') { text = 'FISH ON!'; col = '#ffffff'; }
  else if (B.exhausted) { text = "IT'S EXHAUSTED!"; col = '#ffe27a'; }
  else if (tr?.kind === 'jump') { text = 'IT JUMPED!'; col = '#9ad8ff'; }
  else if (tr?.kind === 'wrap') { text = 'TANGLED!'; col = '#ffe27a'; }
  else if (tr?.kind === 'spit') { text = 'INCOMING!'; col = '#ff9a8a'; }
  else if (B.mode === 'tele') { text = Math.floor(F.t * 8) % 2 ? '! GET READY !' : '!  GET READY  !'; col = '#ffd25a'; }
  else if (B.surging) { text = B.inZone ? 'PULL! PULL!' : "IT'S PULLING!"; col = B.inZone ? '#9affb8' : '#ff8a6a'; }
  drawText(ctx, text, cx, y, { align: 'center', color: col, outline: INK, scale: 2 });
}

// ------------------------------------------------------------------ progress bar
function drawProgressBar(ctx, F, B, x, y, w) {
  const h = 12, t = F.t;
  const p = clamp01(B.progress), ghost = clamp01(B.ghost);
  brassFrame(ctx, x, y, w, h);
  // trough
  ctx.fillStyle = '#0e1a28'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#13263a';
  for (let i = 0; i < w; i += 6) ctx.fillRect(x + i, y + 2, 3, h - 4);
  // lost-line ghost
  if (ghost > p + 0.002) {
    ctx.fillStyle = Math.floor(t * 12) % 2 ? '#ff5a4a' : '#c83a2a';
    ctx.fillRect(x + Math.round(w * p), y, Math.max(1, Math.round(w * (ghost - p))), h);
  }
  // fill: banded gradient teal -> green -> gold
  const fw = Math.round(w * p);
  const ramp = ['#2a9ad8', '#2ab8d8', '#3ad8b8', '#5ae89a', '#8aff7a', '#c8ff6a', '#ffe85a', '#ffd23a'];
  for (let i = 0; i < fw; i += 4) {
    const k = i / w;
    ctx.fillStyle = ramp[Math.min(ramp.length - 1, Math.floor(k * ramp.length))];
    ctx.fillRect(x + i, y, Math.min(4, fw - i), h);
  }
  if (fw > 0) {
    ctx.fillStyle = rgba('#ffffff', 0.4); ctx.fillRect(x, y + 1, fw, 2);
    ctx.fillStyle = rgba('#000000', 0.22); ctx.fillRect(x, y + h - 3, fw, 3);
    // moving shimmer stripes
    ctx.fillStyle = rgba('#ffffff', 0.18);
    const off = Math.floor(t * 40) % 14;
    for (let sx = -14 + off; sx < fw; sx += 14) {
      for (let r = 0; r < h; r++) {
        const px = sx + r * 0.5;
        if (px >= 0 && px + 3 <= fw) ctx.fillRect(x + Math.round(px), y + r, 3, 1);
      }
    }
    // bright head
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x + fw - 1, y, 2, h);
    if (B.reelRate > 0.01 && Math.random() < 0.5) F.fx.sparks(x + fw, y + h / 2, 1, { speed: [20, 60], g: 80, life: 0.4 });
  }
  // event / net ticks
  for (const e of B.events) {
    const ex = x + Math.round(w * e.at);
    ctx.fillStyle = INK; ctx.fillRect(ex - 2, y - 7, 5, 4);
    ctx.fillStyle = e.done ? '#ffe27a' : '#9aa8b8'; ctx.fillRect(ex - 1, y - 6, 3, 2);
  }
  // end caps: fish medallion (left) and boat/hook medallion (right)
  medallion(ctx, x - 12, y + h / 2, 'fish');
  medallion(ctx, x + w + 12, y + h / 2, 'hook');
  // rider: the fish marker sliding along
  const fic = getUiIcon('fish');
  if (fic) {
    const mx = x + Math.round(w * p) - Math.floor(fic.width / 2);
    const bob = Math.round(Math.sin(t * 10) * (B.surging ? 1.5 : 0.5));
    ctx.drawImage(fic, mx, y - fic.height - 3 + bob);
  }
  // labels
  const m = Math.max(0, B.lineLen * (1 - B.progress));
  drawText(ctx, `${m.toFixed(1)} m`, x, y + h + 4, { font: 'small', color: '#cfe8ff', outline: INK });
  drawText(ctx, `${Math.round(p * 100)}%`, x + w, y + h + 4, { font: 'small', color: '#ffffff', outline: INK, align: 'right' });
  drawText(ctx, 'CATCH', x + w / 2, y + h + 4, { font: 'small', color: '#ffe08a', outline: INK, align: 'center' });
}

function medallion(ctx, cx, cy, icon) {
  cx = Math.round(cx); cy = Math.round(cy);
  const r = 9;
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
    const d = Math.hypot(xx, yy);
    if (d > r + 0.3) continue;
    ctx.fillStyle = d > r - 1 ? INK : d > r - 2.5 ? (yy < 0 ? '#ffe08a' : '#a86a1a') : '#1a3048';
    ctx.fillRect(cx + xx, cy + yy, 1, 1);
  }
  const ic = getUiIcon(icon);
  if (ic) ctx.drawImage(ic, cx - Math.floor(ic.width / 2), cy - Math.floor(ic.height / 2));
}

// ------------------------------------------------------------------ tension dial
function drawTensionDial(ctx, F, B, cx, cy) {
  const R = 34, t = F.t;
  const T = B.tension;
  const danger = T > 0.88;
  const shake = danger ? Math.round(Math.sin(t * 70) * 1.5) : 0;
  cx += shake;
  // dial face (upper half disc)
  for (let y = -R - 3; y <= 0; y++) for (let x = -R - 3; x <= R + 3; x++) {
    const d = Math.hypot(x, y);
    if (d > R + 3.3) continue;
    let col;
    if (d > R + 2) col = INK;
    else if (d > R) col = y < -R * 0.6 ? '#ffe08a' : '#c8903a';
    else col = danger && Math.floor(t * 10) % 2 ? '#3a1414' : '#101c2a';
    ctx.fillStyle = col;
    ctx.fillRect(cx + x, cy + y, 1, 1);
  }
  // coloured scale
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const ang = Math.PI + k * Math.PI;
    const col = k < 0.15 ? '#6ab8ff' : k < 0.7 ? '#7dff9a' : k < 0.88 ? '#ffd25a' : '#ff4a3a';
    const lit = k <= T;
    ctx.fillStyle = lit ? col : rgba(col, 0.25);
    for (let r = R - 6; r <= R - 2; r += 2) ctx.fillRect(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r), 2, 2);
  }
  // ticks
  ctx.fillStyle = '#d8e8f8';
  for (let i = 0; i <= 4; i++) {
    const ang = Math.PI + (i / 4) * Math.PI;
    ctx.fillRect(Math.round(cx + Math.cos(ang) * (R - 10)), Math.round(cy + Math.sin(ang) * (R - 10)), 1, 1);
  }
  // snap timer ring
  if (B.snapT > 0) {
    const k = clamp01(B.snapT / B.grace);
    ctx.fillStyle = '#ff3a2a';
    for (let i = 0; i <= Math.round(40 * k); i++) {
      const ang = Math.PI + (i / 40) * Math.PI;
      ctx.fillRect(Math.round(cx + Math.cos(ang) * (R + 2)), Math.round(cy + Math.sin(ang) * (R + 2)), 2, 2);
    }
  }
  // needle
  const wob = T > 0.7 ? Math.sin(t * 55) * 0.05 * (T - 0.7) * 4 : 0;
  const ang = Math.PI + clamp(T, 0, 1.08) * Math.PI + wob;
  const L = R - 5;
  for (let i = 0; i <= L; i++) {
    const x = Math.round(cx + Math.cos(ang) * i), y = Math.round(cy + Math.sin(ang) * i);
    ctx.fillStyle = INK; ctx.fillRect(x - 1, y - 1, 3, 3);
  }
  for (let i = 0; i <= L; i++) {
    const x = Math.round(cx + Math.cos(ang) * i), y = Math.round(cy + Math.sin(ang) * i);
    ctx.fillStyle = i > L - 6 ? '#ff5a4a' : '#ffffff'; ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = INK; ctx.fillRect(cx - 3, cy - 3, 7, 4);
  ctx.fillStyle = '#ffe08a'; ctx.fillRect(cx - 2, cy - 2, 5, 2);
  drawText(ctx, 'TENSION', cx, cy - 13, { font: 'small', align: 'center', color: danger ? '#ff8a7a' : '#cfe8ff', outline: INK });
  if (danger && Math.floor(t * 6) % 2) drawText(ctx, '!', cx, cy - R - 16, { align: 'center', color: '#ff5a4a', outline: INK, scale: 2 });
}

// ------------------------------------------------------------------ pull zone around the fish
function drawPullZone(ctx, F, B) {
  const f = F.fish;
  if (!f || B.event || B.mode === 'hookset' || B.exhausted) return;
  const tele = B.mode === 'tele';
  if (!tele && !B.surging) return;
  const [sx, sy] = F.toScreen(f.x, f.y);
  const t = F.t;
  const R = F.zoneRadius();
  const za = B.pullDir + Math.PI;
  const inZ = B.inZone && !tele;
  const blink = tele && Math.floor(t * 10) % 2;
  // pull direction arrow (red) from the fish
  const pa = B.pullDir;
  const al = R * 0.75;
  for (let i = 10; i < al; i += 2) {
    const k = i / al;
    ctx.fillStyle = rgba('#ff5a4a', 0.35 + 0.5 * k);
    ctx.fillRect(Math.round(sx + Math.cos(pa) * i), Math.round(sy + Math.sin(pa) * i), 2, 2);
  }
  arrowHead(ctx, sx + Math.cos(pa) * al, sy + Math.sin(pa) * al, pa, '#ff5a4a', 5);
  // counter zone arc (green) on the opposite side
  const span = 0.95;
  const col = inZ ? '#9affb8' : tele ? '#ffe27a' : '#7dffb0';
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const a = za - span + (i / n) * span * 2;
    const pulse = Math.sin(t * 10 - i * 0.4) > 0.3;
    for (let r = R - 3; r <= R + 3; r += 2) {
      if (!inZ && !pulse && r !== R - 1) continue;
      ctx.fillStyle = rgba(col, inZ ? 0.95 : blink ? 0.4 : 0.75);
      ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r), 2, 2);
    }
  }
  // chevrons pointing into the zone
  for (let k = 0; k < 3; k++) {
    const r = R * 0.45 + ((t * 40 + k * 10) % 30);
    arrowHead(ctx, sx + Math.cos(za) * r, sy + Math.sin(za) * r, za, rgba(col, 0.9 - k * 0.2), 4);
  }
  const lx = sx + Math.cos(za) * (R + 18), ly = sy + Math.sin(za) * (R + 18);
  drawText(ctx, inZ ? 'PULL!' : 'PULL HERE', lx, ly - 4, { align: 'center', color: col, outline: INK, scale: inZ ? 2 : 1 });
  if (inZ && Math.random() < 0.5) F.fx.sparkle(sx + Math.cos(za) * R + (Math.random() - 0.5) * 30, sy + Math.sin(za) * R + (Math.random() - 0.5) * 30, '#9affb8');
}

function arrowHead(ctx, x, y, a, color, s) {
  ctx.fillStyle = color;
  for (let i = 0; i < s; i++) {
    const bx = x - Math.cos(a) * i, by = y - Math.sin(a) * i;
    const px = -Math.sin(a), py = Math.cos(a);
    for (let j = -i; j <= i; j++) ctx.fillRect(Math.round(bx + px * j * 0.8), Math.round(by + py * j * 0.8), 2, 2);
  }
}

// ------------------------------------------------------------------ crank ring
function drawCrankRing(ctx, F, B) {
  const cr = F.crank, t = F.t;
  const active = cr.active;
  const cx = active ? cr.cx : F.input.x, cy = active ? cr.cy : F.input.y;
  const R = Math.round(clamp(cr.radius, 12, 46));
  const p = cr.power;
  const good = B.surging && B.inZone;
  const bad = B.surging && !B.inZone && p > 0.3;
  const col = cr.stun > 0 ? '#ff8a7a' : good ? '#9affb8' : bad ? '#ffb07a' : p > 0.8 ? '#ffe27a' : p > 0.2 ? '#7ad8ff' : '#cfe8ff';
  if (!active) {
    // ghost hint: a rotating arrow loop around the cursor
    const gr = 18;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + t * 5;
      ctx.fillStyle = rgba('#ffffff', 0.08 + (i / 16) * 0.55);
      ctx.fillRect(Math.round(cx + Math.cos(a) * gr) - 1, Math.round(cy + Math.sin(a) * gr) - 1, 2, 2);
    }
    const ha = t * 5 + TAU;
    arrowHead(ctx, cx + Math.cos(ha) * gr, cy + Math.sin(ha) * gr, ha + Math.PI / 2, '#ffffff', 3);
    return;
  }
  // ring
  const n = Math.max(24, R * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ctx.fillStyle = rgba(col, i % 2 ? 0.35 : 0.7);
    ctx.fillRect(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 1, 1);
  }
  // motion trail behind the knob
  const ka = cr.spin;
  const trail = clamp(p * 2.2, 0.2, 2.6) * (cr.dir || 1);
  for (let i = 0; i < 18; i++) {
    const a = ka - (i / 18) * trail;
    ctx.fillStyle = rgba(col, (1 - i / 18) * 0.9);
    ctx.fillRect(Math.round(cx + Math.cos(a) * R) - 1, Math.round(cy + Math.sin(a) * R) - 1, 3, 3);
  }
  // handle arm + knob
  const kx = cx + Math.cos(ka) * R, ky = cy + Math.sin(ka) * R;
  const steps = Math.ceil(R);
  for (let i = 0; i <= steps; i += 2) {
    ctx.fillStyle = rgba('#e8f4ff', 0.5);
    ctx.fillRect(Math.round(cx + Math.cos(ka) * i), Math.round(cy + Math.sin(ka) * i), 1, 1);
  }
  ctx.fillStyle = INK; ctx.fillRect(Math.round(cx) - 2, Math.round(cy) - 2, 5, 5);
  ctx.fillStyle = '#c8d8e8'; ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 3, 3);
  ctx.fillStyle = INK; ctx.fillRect(Math.round(kx) - 3, Math.round(ky) - 3, 7, 7);
  ctx.fillStyle = '#e04a3a'; ctx.fillRect(Math.round(kx) - 2, Math.round(ky) - 2, 5, 5);
  ctx.fillStyle = '#ffa08a'; ctx.fillRect(Math.round(kx) - 2, Math.round(ky) - 2, 2, 1);
  // spin sparks
  if (p > 0.55 && Math.random() < p * 0.8) {
    const tx = -Math.sin(ka) * (cr.dir || 1), ty = Math.cos(ka) * (cr.dir || 1);
    F.fx.sparks(kx, ky, 1 + Math.floor(p * 2), { dir: Math.atan2(ty, tx), spread: 0.6, speed: [40, 120], g: 160, colors: good ? ['#9affb8', '#ffffff', '#d8ffe0'] : undefined });
  }
  // speed readout
  const rev = cr.speed;
  drawText(ctx, `x${rev.toFixed(1)}`, cx, cy + R + 6, { align: 'center', font: 'small', color: col, outline: INK });
}

// ------------------------------------------------------------------ prompt line
function drawPrompt(ctx, F, B, cx, y) {
  let text, col = '#ffffff', flash = false;
  const cr = F.crank, tr = B.trick;
  if (B.event) text = B.event.prompt;
  else if (B.tension > 0.88) { text = 'EASE OFF! Stop cranking!'; col = '#ff8a7a'; flash = true; }
  else if (tr?.kind === 'jump') { text = 'IT JUMPED! Stop reeling until it lands!'; col = '#9ad8ff'; }
  else if (tr?.kind === 'wrap') { text = `${tr.dir > 0 ? '{crank_cw}' : '{crank_ccw}'} Circle ${tr.dir > 0 ? 'CLOCKWISE' : 'COUNTER-CLOCKWISE'} to untangle!`; col = '#ffe27a'; }
  else if (tr?.kind === 'spit') text = "Keep reeling - don't get hit!";
  else if (B.mode === 'hookset') text = '{crank} Circle your mouse to REEL!';
  else if (B.progress < -0.08) { text = 'Line running out! Pull on the GREEN side!'; col = '#ff8a6a'; flash = true; }
  else if (B.slackT > 0.6) { text = 'Slack line! Keep reeling!'; col = '#9ad8ff'; flash = true; }
  else if (B.exhausted) { text = '{crank} Crank FAST - it is exhausted!'; col = '#ffe27a'; }
  else if (B.mode === 'tele') { text = "It's about to pull - get on the GREEN side!"; col = '#ffd25a'; }
  else if (B.surging && !B.inZone) { text = '{crank} Circle on the GREEN side to pull against it!'; col = '#9affb8'; }
  else if (B.surging) { text = '{mouse_hold} Hold to YANK!  {crank} Keep circling!'; col = '#9affb8'; }
  else if (!cr.active) text = '{crank} Circle your mouse to REEL';
  else text = '{crank} Reeling! Faster circles = faster reel';
  if (!text) return;
  if (flash && Math.floor(F.t * 6) % 2) col = '#ffffff';
  const w = measureText(text) + 16;
  ctx.fillStyle = rgba('#05080c', 0.6);
  ctx.fillRect(Math.round(cx - w / 2), Math.round(y - 3), Math.round(w), 13);
  drawText(ctx, text, cx, y, { align: 'center', color: col, outline: INK });
}

// ------------------------------------------------------------------ ink splats on the "lens"
function drawInk(ctx, F) {
  for (const s of F.splats) {
    const k = s.t / s.max;
    const a = s.t < 0.15 ? s.t / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
    const r = Math.round(s.r * (s.t < 0.15 ? 0.6 + (s.t / 0.15) * 0.4 : 1));
    const spr = inkSplatSprite(r);
    ctx.globalAlpha = clamp01(a) * 0.92;
    ctx.drawImage(spr, Math.round(s.x - r), Math.round(s.y - r + k * 12));
    for (const d of s.drips) {
      ctx.fillStyle = '#0a0614';
      ctx.fillRect(Math.round(s.x + d.x), Math.round(s.y + r * 0.6), d.w, Math.round(d.l * k * 1.5 + 2));
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ angler cam & character
export function drawAngler(ctx, F, x, y, o = {}) {
  const look = F.game.state?.character;
  try {
    return drawCharacter(ctx, x, y, { pose: o.pose || 'idle', t: o.t ?? F.t, facing: o.facing ?? 1, scale: o.scale || 1, look, fish: o.fish });
  } catch (e) {
    if (!F.charErr) { F.charErr = true; console.warn('drawCharacter failed', e); }
    return null;
  }
}

function drawAnglerCam(ctx, F, B, x, y) {
  const w = 112, h = 104, t = F.t;
  x = Math.round(x); y = Math.round(y);
  brassFrame(ctx, x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const biome = F.world.biome;
  const sky = biome === 'abyss' ? ['#0a1028', '#141c3a', '#1e2a50'] : biome === 'junkyard' ? ['#3a2a3a', '#6a4a4a', '#a8785a'] : ['#5ab8f0', '#8ad0f8', '#c8ecff'];
  const sea = biome === 'abyss' ? '#0a1a3a' : biome === 'junkyard' ? '#2a4a4a' : '#2a7ab8';
  const wl = y + h - 22;
  for (let i = 0; i < wl - y; i++) {
    const k = i / (wl - y);
    ctx.fillStyle = sky[Math.min(2, Math.floor(k * 3))];
    ctx.fillRect(x, y + i, w, 1);
  }
  // clouds
  ctx.fillStyle = rgba('#ffffff', biome === 'abyss' ? 0.15 : 0.7);
  const cxo = (t * 4) % (w + 40);
  ctx.fillRect(Math.round(x + w - cxo), y + 12, 18, 3); ctx.fillRect(Math.round(x + w - cxo + 4), y + 10, 9, 2);
  // sea
  ctx.fillStyle = sea; ctx.fillRect(x, wl, w, h - (wl - y));
  ctx.fillStyle = rgba('#ffffff', 0.6);
  for (let i = 0; i < w; i += 7) ctx.fillRect(x + ((i + Math.floor(t * 12)) % w), wl + Math.round(Math.sin(t * 3 + i) * 0.8), 3, 1);
  // boat hull
  const hx = x + 14, hy = wl - 4, hw = 64;
  const bob = Math.round(Math.sin(t * 2.2) * 1);
  ctx.fillStyle = '#3a1a0e'; ctx.fillRect(hx - 1, hy - 1 + bob, hw + 2, 9);
  ctx.fillStyle = F.game.state?.character?.boat || '#c8583a'; ctx.fillRect(hx, hy + bob, hw, 7);
  ctx.fillStyle = rgba('#ffffff', 0.3); ctx.fillRect(hx, hy + bob, hw, 1);
  ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(hx + 4, hy + 4 + bob, hw - 8, 1);
  // pose from what the player is doing
  let pose = 'reel';
  if (B.event?.name === 'mash' || F.poseHold?.pose === 'yank') pose = 'yank';
  else if (F.input.down || (B.surging && B.inZone)) pose = 'pull';
  else if (!F.crank.active) pose = B.surging ? 'pull' : 'idle';
  const anchors = drawAngler(ctx, F, hx + 26, hy + bob, { pose, t, facing: 1 });
  // the line from the rod tip, taut and coloured by tension
  const rt = anchors?.rodTip || [hx + 44, hy - 26];
  const ex = x + w + 2, ey = y + h - 4;
  const T = B.tension;
  const sag = (1 - clamp01(T)) * 14;
  const col = T > 0.88 ? '#ff6a5a' : T > 0.7 ? '#ffd25a' : '#e8f4ff';
  ctx.fillStyle = col;
  const n = 40;
  const vib = T > 0.8 ? Math.sin(t * 60) * 1.2 : 0;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const lx = lerp(rt[0], ex, k), ly = lerp(rt[1], ey, k) + Math.sin(k * Math.PI) * (sag + vib);
    ctx.fillRect(Math.round(lx), Math.round(ly), 1, 1);
  }
  ctx.restore();
  // tag
  drawText(ctx, 'YOU', x + 3, y + 3, { font: 'small', color: '#ffffff', outline: INK });
  if (Math.floor(t * 2) % 2) { ctx.fillStyle = '#ff3a3a'; ctx.fillRect(x + w - 8, y + 3, 4, 4); }
  drawText(ctx, 'LIVE', x + w - 11, y + 3, { font: 'small', color: '#ffffff', outline: INK, align: 'right' });
}
