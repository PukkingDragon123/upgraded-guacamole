// Frutiger Aero UI kit (phase 3). OWNER: UI agent (polishes these; signatures are the contract).
// Everyone draws Aero chrome through these helpers so the whole game shares one glossy look.
//   AERO                         palette tokens (sky, aqua, grass, glass, ink, gloss ...)
//   CURRENCY = 'Aero'            the one currency (state.coins holds the amount)
//   fmtAero(n) -> '1,250'        number formatting for Aero amounts
//   drawAeroPanel(ctx, x, y, w, h, {tone:'glass'|'sky'|'grass'|'dark', radius, title, glow})
//   drawAeroButton(ctx, x, y, w, h, {label, icon, state:'normal'|'hover'|'down'|'disabled', tone:'aqua'|'green'|'orange'|'glass'})
//   drawAeroBar(ctx, x, y, w, h, k, {color, back, gloss})   glossy progress bar, k in 0..1
//   drawAeroCoin(ctx, cx, cy, r, t)                           the Aero currency drop (glossy aqua bubble)
//   drawGlossOrb(ctx, cx, cy, r, color, t)                    generic glossy bubble/orb
import { rgba, shade } from '../core/color.js';
import { drawText } from '../gfx/font.js';

export const CURRENCY = 'Aero';
export const AERO = {
  sky0: '#1e8fe0', sky1: '#59c3ff', sky2: '#bfeaff', aqua: '#2fd3e8', aquaDeep: '#0d8fb5', teal: '#1fb3a6',
  grass0: '#3fae2a', grass1: '#8be04a', lime: '#c8f56a', glass: 'rgba(235,250,255,0.55)', glassEdge: 'rgba(255,255,255,0.85)',
  ink: '#0c3a52', inkSoft: '#3c6f88', white: '#ffffff', gloss: 'rgba(255,255,255,0.75)', orange: '#ff9d2e', red: '#ff4f5e',
};

export function fmtAero(n) { return Math.round(n || 0).toLocaleString('en-US'); }

function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

const TONES = {
  glass: ['rgba(250,254,255,0.72)', 'rgba(190,232,250,0.62)'], sky: ['#9fe0ff', '#2c9fe6'], grass: ['#b9f07a', '#3fae2a'],
  dark: ['rgba(20,60,90,0.85)', 'rgba(6,26,44,0.9)'], aqua: ['#8ff3ff', '#109ed0'], green: ['#c4f58a', '#3aa52a'], orange: ['#ffd27a', '#f07d12'],
};

export function drawAeroPanel(ctx, x, y, w, h, o = {}) {
  const [a, b] = TONES[o.tone || 'glass'] || TONES.glass, r = o.radius ?? 8;
  ctx.save();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  rrect(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
  ctx.clip();
  const s = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
  s.addColorStop(0, 'rgba(255,255,255,0.55)'); s.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = s; ctx.fillRect(x, y, w, Math.round(h * 0.45));
  ctx.restore();
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = AERO.glassEdge; ctx.lineWidth = 1; ctx.stroke();
  if (o.title) drawText(ctx, o.title, x + 10, y + 6, { color: AERO.ink, shadow: 'rgba(255,255,255,0.8)' });
}

export function drawAeroButton(ctx, x, y, w, h, o = {}) {
  const st = o.state || 'normal';
  const [a, b] = TONES[o.tone || 'aqua'] || TONES.aqua;
  const lift = st === 'hover' ? 0.08 : st === 'down' ? -0.12 : 0;
  ctx.save();
  if (st === 'disabled') ctx.globalAlpha = 0.5;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(a, lift)); g.addColorStop(1, shade(b, lift));
  rrect(ctx, x, y, w, h, h / 2); ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x, y, w, Math.round(h * 0.45));
  ctx.restore();
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
  let tx = x + w / 2;
  if (o.icon) { ctx.drawImage(o.icon, Math.round(x + 6), Math.round(y + (h - o.icon.height) / 2)); tx += o.icon.width / 2; }
  if (o.label) drawText(ctx, o.label, Math.round(tx), Math.round(y + (h - 8) / 2), { align: 'center', color: '#ffffff', shadow: rgba(AERO.ink, 0.6) });
  ctx.restore();
}

export function drawAeroBar(ctx, x, y, w, h, k, o = {}) {
  k = Math.max(0, Math.min(1, k || 0));
  ctx.save();
  rrect(ctx, x, y, w, h, h / 2); ctx.fillStyle = o.back || 'rgba(10,50,80,0.35)'; ctx.fill();
  if (k > 0) {
    rrect(ctx, x, y, Math.max(h, w * k), h, h / 2);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(o.color || AERO.aqua, 0.3)); g.addColorStop(1, o.color || AERO.aqua);
    ctx.fillStyle = g; ctx.fill();
    if (o.gloss !== false) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x + 2, y + 1, Math.max(0, w * k - 4), Math.max(1, Math.floor(h / 3))); }
  }
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke();
  ctx.restore();
}

export function drawGlossOrb(ctx, cx, cy, r, color = AERO.aqua, t = 0) {
  ctx.save();
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, shade(color, 0.35)); g.addColorStop(1, shade(color, -0.25));
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - r * 0.25, cy - r * 0.45, r * 0.45, r * 0.22, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
  ctx.restore();
}

export function drawAeroCoin(ctx, cx, cy, r = 5, t = 0) { drawGlossOrb(ctx, cx, cy, r, AERO.aqua, t); }
