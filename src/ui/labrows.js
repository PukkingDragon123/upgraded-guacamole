// Shared Lab art helpers (OWNER: Lab agent). Phase 6's row view lived here; phase 7 replaced it with the centre-out
// tree (src/ui/labtree.js). Kept: animated icons (every icon moves its own way), the cute padlock, unlock labels.
//   drawAnimIcon(ctx, key, cx, cy, px, t, phase, {hover, ghost, still, alpha})   iconMotion(key, t, phase, k)
//   drawPadlock(ctx, x, y, scale, open, rot)   unlockInfo(u) -> {key, name}   (icon key + label for a node unlock)
import { clamp, clamp01, damp, TAU, hash1, ease, lerp } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { aeroSurface, aeroCached, drawAeroGlow, drawAeroBubble, drawSparkle, drawGlossOrb, drawAeroBar, fmtAero, drawAeroCoin, drawAeroLeaf } from './aero.js';
import {
  LAB_NODES, LAB_BY_ID, LAB_ROWS, ROW_BY_ID, BRANCHES, ROOT_ID, EFFECT_INFO, BOAT_NAMES, TANK_NAMES, OCEAN_NAMES, BOAT_ORDER,
  ensureLab, labStatus, labCheck, labTime, labProgress, labRemaining, labQueued, instantCost, instantFinish, cancelResearch,
  canPlan, planAfford, confirmResearch, fmtEffect, fmtTime, labSlots, nodeFor, TANK_ORDER,
} from '../game/lab.js';
import { ROD_BY_ID } from '../game/rods.js';
import { RECIPE_BY_ID } from '../build/crafting.js';
import { drawTube, drawRays, roundRectPath } from './labart.js';
import { icon, anyIcon, pill, costTiles, costTilesHeight, chip, INK, INK_SOFT, OK, BAD } from './labkit.js';

const FEATURE_ICON = { isp2: 'bait:worm', isp3: 'bait:worm', isp4: 'bait:golden', isp5: 'bait:golden', isp6: 'bait:golden', multiplayer: 'people', autocollect: 'magnet', eng1: 'gear', eng2: 'gear', aquarium: 'tank:jar' };
const FEATURE_NAME = { isp2: 'Bait Shop: Pro Shelf', isp3: 'Bait Shop: Ultra Shelf', isp4: 'Bait Shop: Mega Shelf', isp5: 'Bait Shop: Loyalty Card', isp6: 'Bait Shop: Express Restock', multiplayer: 'Multiplayer', autocollect: 'Auto-collect', eng1: 'Building level 2', eng2: 'Building level 3' };

export function unlockInfo(u) {
  switch (u.kind) {
    case 'rod': return { key: 'rod:' + u.id, name: ROD_BY_ID[u.id]?.name || u.id };
    case 'boat': return { key: 'boat:' + u.id, name: BOAT_NAMES[u.id] || u.id };
    case 'tank': return { key: 'tank:' + u.id, name: TANK_NAMES[u.id] || u.id };
    case 'biome': return { key: 'biome:' + u.id, name: OCEAN_NAMES[u.id] || u.id };
    case 'recipe': return { key: RECIPE_BY_ID[u.id]?.icon || 'hammer', name: 'Recipe: ' + (RECIPE_BY_ID[u.id]?.name || u.id) };
    case 'bait': return { key: 'bait:' + u.id, name: 'Bait Shop: ' + u.id };
    case 'feature': return { key: FEATURE_ICON[u.id] || 'sparkle', name: FEATURE_NAME[u.id] || u.id };
    default: return { key: 'star', name: u.id };
  }
}

const GROUP_GAP = 2;
const LABEL_FONT = 'normal';
const labelOf = (r) => r.label.toUpperCase();
const branchCol = (b) => BRANCHES[b]?.color || '#35c8ff';

// ------------------------------------------------------------------ cached tile art
const texCache = new Map();
function tex(key, build) {
  let c = texCache.get(key);
  if (!c) { c = build(); texCache.set(key, c); if (texCache.size > 500) texCache.delete(texCache.keys().next().value); }
  return c;
}

// Frame tones per state (outer glass) and the inner window colours.
function frameTone(state, color) {
  switch (state) {
    case 'done': return { top: mix(color, '#ffffff', 0.62), mid: shade(color, 0.06), bot: shade(color, -0.3), edge: shade(color, -0.62), a: [1, 1], glow: mix(color, '#ffffff', 0.7) };
    case 'available': return { top: '#ffffff', mid: mix(color, '#ffffff', 0.72), bot: mix(color, '#ffffff', 0.38), edge: shade(color, -0.45), a: [1, 1], glow: '#ffffff' };
    case 'planned': return { top: '#f4ffd0', mid: '#a6ec4c', bot: '#4cb424', edge: '#1f6a12', a: [1, 1], glow: '#eaffb4' };
    case 'queued': return { top: '#f2e6ff', mid: '#b48cf6', bot: '#7a52d6', edge: '#3a1e7e', a: [1, 1], glow: '#f0dcff' };
    case 'researching': return { top: '#e8ffff', mid: '#5ae8f0', bot: '#10a0c8', edge: '#05506e', a: [1, 1], glow: '#c8ffff' };
    default: return { top: '#eef4f8', mid: '#b6c8d8', bot: '#8ca2b8', edge: '#46607a', a: [0.96, 0.96], glow: '#e4ecf4' };
  }
}
function innerColors(state, color) {
  if (state === 'locked') return { top: '#5a7088', mid: '#3e546c', bot: '#2c3e54' };
  if (state === 'done') return { top: mix(color, '#ffffff', 0.86), mid: mix(color, '#ffffff', 0.68), bot: mix(color, '#bff6ff', 0.45) };
  return { top: '#ffffff', mid: '#e2f6ff', bot: '#a8dcf4' };
}
function frameTex(S, state, color) {
  const t = frameTone(state, color);
  return aeroSurface(S, S, { tone: t, r: Math.max(4, Math.round(S * 0.24)), gloss: 0.75, glossH: Math.round(S * 0.42), curve: 2, rim: 0.9, glow: 0.65, glowColor: t.glow });
}
function innerTex(S, state, color) {
  const c = innerColors(state, color), w = S - 6;
  return aeroSurface(w, w, { ...c, a: [1, 1], edge: state === 'locked' ? '#1e2c3e' : shade(c.bot, -0.35), edgeA: 0.7, r: Math.max(3, Math.round(w * 0.2)), gloss: 0.3, glossH: Math.round(w * 0.35), curve: 1, rim: 0.4, glow: 0.4, inset: true });
}

// Pale glassy "ghost" of an icon for locked tiles.
function ghostOf(ic) {
  if (!ic) return null;
  return tex('ghost|' + (ic.__gid ||= Math.random().toString(36).slice(2)), () => {
    const c = makeCanvas(ic.width, ic.height), g = ctxOf(c);
    g.drawImage(ic, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(150,190,222,0.55)'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, 0, c.width, Math.ceil(c.height * 0.4));
    return c;
  });
}

// Cute chains crossing a locked tile (an X of glossy links).
function chainTex(S) {
  return tex('chain|' + S, () => {
    const c = makeCanvas(S + 6, S + 6), g = ctxOf(c);
    const link = (x, y, ang, k) => {
      g.save(); g.translate(x, y); g.rotate(ang + (k % 2 ? Math.PI / 2 : 0));
      const rx = k % 2 ? 1.6 : 2.6, ry = k % 2 ? 1.2 : 1.7;
      g.strokeStyle = '#3c5a78'; g.lineWidth = 1.6; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke();
      g.strokeStyle = k % 2 ? '#c8dcec' : '#eef8ff'; g.lineWidth = 0.9; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.restore();
    };
    const n = Math.max(4, Math.round(S / 4.2));
    for (const [x0, y0, x1, y1] of [[2, 4, S + 4, S + 2], [S + 4, 4, 2, S + 2]]) {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      for (let i = 0; i <= n; i++) { const k = i / n; link(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, ang, i); }
    }
    return c;
  });
}

// A cute glossy padlock (pink-gold body, heart keyhole). open 0..1 lifts the shackle.
function drawPadlock(ctx, x, y, s = 1, open = 0, rot = 0) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (rot) ctx.rotate(rot);
  ctx.scale(s, s);
  // shackle
  ctx.strokeStyle = '#4a5c74'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.arc(open * 1.5, -4 - open * 3, 2.6, Math.PI, 0); ctx.lineTo(open * 1.5 + 2.6, -4 - open * 3 + (open > 0.5 ? 0 : 2)); ctx.stroke();
  ctx.strokeStyle = '#e8f4ff'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.arc(open * 1.5, -4 - open * 3, 2.6, Math.PI, Math.PI * 1.6); ctx.stroke();
  // body
  const gr = ctx.createLinearGradient(0, -4, 0, 4);
  gr.addColorStop(0, '#ffe7a8'); gr.addColorStop(0.5, '#ffb84a'); gr.addColorStop(1, '#e07a1a');
  ctx.fillStyle = '#7a3e0a'; roundRectPath(ctx, -4.5, -3.5, 9, 8, 2.5); ctx.fill();
  ctx.fillStyle = gr; roundRectPath(ctx, -3.5, -2.5, 7, 6, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(-2.5, -2, 4, 1);
  // heart keyhole
  ctx.fillStyle = '#c8344c';
  ctx.beginPath(); ctx.arc(-0.8, 0.3, 0.9, 0, TAU); ctx.arc(0.8, 0.3, 0.9, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-1.6, 0.6); ctx.lineTo(1.6, 0.6); ctx.lineTo(0, 2.4); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ animated icons
// How an icon moves, per icon kind: {dx, dy, rot, sx, sy}
function iconMotion(key, t, ph, k = 0) {
  const a = 1 + k * 0.8, f = 1 + k * 0.6;
  const s = (sp) => Math.sin(t * sp * f + ph);
  const kind = key.includes(':') ? key.split(':')[0] : key;
  switch (kind) {
    case 'rod': return { rot: s(2.1) * 0.13 * a, dy: s(1.4) * 0.6 };
    case 'boat': return { rot: s(1.7) * 0.09 * a, dy: s(2.3) * 1 * a };
    case 'tank': return { dy: s(1.5) * 0.8 * a, bubbles: true };
    case 'biome': return { sx: 1 + s(2) * 0.05 * a, sy: 1 + s(2) * 0.05 * a, orbit: true };
    case 'bait': return { sx: 1 - s(5) * 0.06 * a, sy: 1 + s(5) * 0.08 * a, dy: s(2.5) * 0.6 };
    case 'bp': return { dy: -Math.abs(s(2.4)) * 1.8 * a, sy: 1 - Math.max(0, -s(2.4) - 0.8) * 0.4 };
    case 'mat': return { dy: s(2) * 0.8 };
    case 'gear': case 'reel': return { rot: t * (kind === 'reel' ? 2.2 : 1.1) * f + ph };
    case 'clock': return { rot: s(6) * 0.05, sx: 1 + Math.max(0, s(3)) * 0.05 * a, sy: 1 + Math.max(0, s(3)) * 0.05 * a };
    case 'star': case 'sparkle': case 'crown': return { sx: 1 + s(3) * 0.08 * a, sy: 1 + s(3) * 0.08 * a, rot: s(1.3) * 0.08, twinkle: true };
    case 'heart': { const b = Math.max(0, Math.sin(t * 6 * f + ph)) ** 6; return { sx: 1 + b * 0.16 * a, sy: 1 + b * 0.16 * a }; }
    case 'bolt': case 'battery': case 'storm': return { dx: (Math.sin(t * 31 + ph) > 0.92 ? 1 : 0), glow: 0.5 + 0.5 * Math.max(0, s(7)), flicker: true };
    case 'eye': return { sy: ((t * f + ph) % 3.2) < 0.14 ? 0.15 : 1 };
    case 'music': return { dy: -Math.abs(s(3.2)) * 1.6 * a, rot: s(3.2) * 0.12 };
    case 'magnet': return { rot: s(4) * 0.12 * a };
    case 'hook': case 'line': case 'horseshoe': case 'lantern': return { rot: s(2) * 0.16 * a, glow: kind === 'lantern' ? 0.6 + 0.4 * s(3) : 0 };
    case 'compass': return { rot: s(1.2) * 0.25 * a };
    case 'sonar': case 'radar': return { pulse: true, rot: kind === 'radar' ? s(0.8) * 0.2 : 0 };
    case 'coin': return { sx: Math.max(0.15, Math.abs(Math.cos(t * 1.6 * f + ph))) };
    case 'clover': case 'rainbow': case 'decor': return { rot: s(1.6) * 0.1 * a, dy: s(2) * 0.5 };
    case 'beaker': case 'dna': case 'egg': return { rot: s(2.6) * 0.08 * a, bubbles: kind === 'beaker' };
    case 'box': return { dy: -Math.abs(s(2.8)) * 1.4 * a };
    case 'snail': case 'crab': return { dx: s(kind === 'crab' ? 3 : 0.9) * 1.2 * a, rot: kind === 'crab' ? s(6) * 0.06 : 0 };
    case 'cloud': return { dx: s(0.9) * 1.2 * a, dy: s(1.3) * 0.5 };
    case 'moon': return { rot: s(1.1) * 0.15 };
    case 'mouse': return { sy: 1 - Math.max(0, s(3) - 0.85) * 0.8 };
    default: return { dy: s(2) * 0.8 * a };
  }
}

function drawAnimIcon(ctx, key, cx, cy, px, t, ph, o = {}) {
  const ic = icon(key, px);
  if (!ic) {
    drawAeroGlow(ctx, cx, cy, px * 0.45, '#ffffff', 0.5 + 0.2 * Math.sin(t * 4 + ph));
    return;
  }
  const m = o.still ? {} : iconMotion(key, t, ph, o.hover || 0);
  const img = o.ghost ? ghostOf(ic) : ic;
  if (m.glow && !o.ghost) drawAeroGlow(ctx, cx, cy, px * 0.6, '#fff6a0', m.glow * 0.55);
  ctx.save();
  ctx.translate(Math.round(cx + (m.dx || 0)), Math.round(cy + (m.dy || 0)));
  if (m.rot) ctx.rotate(m.rot);
  if (m.sx || m.sy) ctx.scale(m.sx ?? 1, m.sy ?? 1);
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.drawImage(img, -Math.round(img.width / 2), -Math.round(img.height / 2));
  ctx.restore();
  if (o.ghost || o.still) return;
  // little extras that make them feel alive
  if (m.bubbles) for (let i = 0; i < 2; i++) { const q = (t * 0.7 + i * 0.5 + ph * 0.1) % 1; drawAeroBubble(ctx, cx + Math.sin(t * 2 + i * 3) * px * 0.2, cy + px * 0.25 - q * px * 0.8, 1 + q, (1 - q) * 0.9); }
  if (m.orbit) { const a = t * 2.4 + ph; drawSparkle(ctx, cx + Math.cos(a) * px * 0.52, cy + Math.sin(a) * px * 0.3, 1, 0.9); }
  if (m.twinkle && ((t * 0.8 + ph) % 1) < 0.18) drawSparkle(ctx, cx + px * 0.32, cy - px * 0.3, 2, 1, '#fff6a0');
  if (m.pulse) { const q = (t * 0.8 + ph * 0.2) % 1, rr = 2 + q * px * 0.5; for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.785 + ph; drawSparkle(ctx, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, q < 0.5 ? 2 : 1, 1 - q); } } // [phase8:ui] twinkles, no ring
  if (m.flicker && Math.sin(t * 23 + ph) > 0.8) drawSparkle(ctx, cx + px * 0.3, cy + px * 0.25, 1, 1, '#fff6a0');
}

export { drawAnimIcon, drawPadlock, iconMotion };

