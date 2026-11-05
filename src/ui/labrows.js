// THE LAB's skill-tree rows (phase 6, OWNER: Lab+Quests agent). Laid out like the user's row-based skill-tree
// reference (images/10.jpg), restyled as cute Frutiger Aero: one horizontal row of framed glass tiles per branch
// (plus a sub-row), a branch label sitting on a thin leader line, elbow glass tubes from a tile to the start of a
// dependent row, chained + padlocked locked tiles, a level plate on every tile. Every icon is animated (idle bob,
// sway, spin, blink... per icon kind), hover zooms the tile and shows a rich tooltip card, clicks pop, finished
// research bursts, chains snap off newly available tiles and brewing research shimmers with rising water.
// Clicking tiles builds a PLAN (Aero left counter, Undo / Confirm in the panel footer); Confirm pays and starts it.
//   new LabRows(panel)
//   rows.update(ui, view, dt)  rows.draw(ctx, ui, view, dt)  rows.drawCard(ctx, ui)  (card on top of everything)
//   rows.plan [ids]  rows.toggle(id)  rows.undo()  rows.confirm()  rows.focus(id, {highlight})  rows.tileRect(id)
//   unlockInfo(u) -> {key, name}   (icon key + label for a node unlock)
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
  if (m.pulse) { const q = (t * 0.8 + ph * 0.2) % 1; ctx.strokeStyle = rgba('#9ff6ff', 1 - q); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 2 + q * px * 0.55, 0, TAU); ctx.stroke(); }
  if (m.flicker && Math.sin(t * 23 + ph) > 0.8) drawSparkle(ctx, cx + px * 0.3, cy + px * 0.25, 1, 1, '#fff6a0');
}

// ------------------------------------------------------------------ the view
export class LabRows {
  constructor(panel) {
    this.p = panel;
    this.plan = [];
    this.anim = new Map(); // id -> {hov, pop, shake, born}
    this.fx = []; // particles in content space
    this.prev = null;
    this.t = 0;
    this.scroll = { x: 0, y: 0 };
    this.zoom = 0; // 0 = fit, 1 = big tiles
    this.hover = null;
    this.pinned = null;
    this.drag = null;
    this.geo = null;
    this.hl = null; // {id, t} highlight pulse (focus / tutorial)
    this.cardRect = null;
    this.lastClick = { id: null, t: -9 };
  }

  get game() { return this.p.game; }

  a(id) { let o = this.anim.get(id); if (!o) { o = { hov: 0, pop: 0, shake: 0, ph: hash1(id.length * 13 + id.charCodeAt(0), 3) * 6.28 + id.charCodeAt(id.length - 1) * 0.37 }; this.anim.set(id, o); } return o; }

  // ---------------------------------------------------------------- layout
  layout(view) {
    const key = `${view.w}|${view.h}|${this.zoom}`;
    if (this.geo?.key === key) return this.geo;
    const rows = LAB_ROWS;
    let groups = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].branch !== rows[i - 1].branch) groups++;
    const avail = view.h - 8 - groups * GROUP_GAP;
    const RH = this.zoom ? 40 : clamp(Math.floor(avail / rows.length), 22, 44);
    let T = RH - 3;
    T -= T % 2;
    const lw = Object.fromEntries(rows.map((r) => [r.id, measureText(labelOf(r), LABEL_FONT) + 16]));
    const leftM = Math.max(...rows.filter((r) => !r.from).map((r) => lw[r.id])) + 22;
    // columns: a dependent row starts far enough right of its parent tile for its label to sit on the elbow
    const cols = (P) => {
      const col = {};
      const start = {};
      for (let pass = 0; pass < 4; pass++) {
        for (const r of rows) {
          if (start[r.id] !== undefined) continue;
          let s0 = 0;
          if (r.from) { if (col[r.from] === undefined) continue; s0 = col[r.from] + Math.max(1, Math.ceil((lw[r.id] + T * 0.5 + 6) / P)); }
          start[r.id] = s0;
          r.nodes.forEach((id, i) => { col[id] = s0 + i; });
        }
      }
      return { col, start, max: Math.max(...Object.values(col)) };
    };
    const fizzW = this.zoom ? 0 : 96;
    let P = T + 14;
    for (let i = 0; i < 3; i++) {
      const c = cols(P);
      P = clamp(Math.floor((view.w - leftM - fizzW - 16) / (c.max + 1)), T + 8, T + 30);
    }
    const C = cols(P);
    // rows top -> bottom
    const rowY = {};
    let y = 4 + RH / 2;
    rows.forEach((r, i) => {
      if (i > 0 && r.branch !== rows[i - 1].branch) y += GROUP_GAP;
      rowY[r.id] = Math.round(y);
      y += RH;
    });
    const contentH = Math.round(y - RH / 2 + 4);
    const contentW = leftM + (C.max + 1) * P + 12;
    const offX = Math.max(0, Math.floor((view.w - fizzW - contentW) / 2));
    const pos = {};
    for (const nd of LAB_NODES) {
      if (!nd.row || C.col[nd.id] === undefined) continue;
      pos[nd.id] = [offX + leftM + C.col[nd.id] * P + Math.round(P / 2), rowY[nd.row]];
    }
    this.geo = { key, RH, T, P, leftM, offX, col: C.col, start: C.start, rowY, pos, contentW: contentW + offX, contentH, fizzW, lw };
    return this.geo;
  }

  // content -> screen
  sx(view, x) { return view.x + x - this.scroll.x; }
  sy(view, y) { return view.y + y - this.scroll.y; }

  tileRect(id) {
    const v = this.view, G = this.geo;
    if (!v || !G || !G.pos[id]) return null;
    const [x, y] = G.pos[id];
    return { x: Math.round(this.sx(v, x) - G.T / 2), y: Math.round(this.sy(v, y) - G.T / 2), w: G.T, h: G.T };
  }

  focus(id, o = {}) {
    if (!LAB_BY_ID[id]) return;
    this.focusId = id;
    if (o.highlight !== false) this.hl = { id, t: 0 };
  }

  pick(view, mx, my) {
    const G = this.geo;
    if (!G) return null;
    const r = G.T / 2 + 2;
    let best = null, bd = 1e9;
    for (const id in G.pos) {
      const [x, y] = G.pos[id];
      const dx = Math.abs(this.sx(view, x) - mx), dy = Math.abs(this.sy(view, y) - my);
      if (dx <= r && dy <= r && dx + dy < bd) { bd = dx + dy; best = id; }
    }
    return best;
  }

  // Lab nodes that an active quest asks for -> {nodeId: quest}
  questTargets() {
    const out = {};
    const book = this.game.quests?.book;
    if (!book?.active) return out;
    try {
      for (const q of book.active()) {
        for (const o of q.objectives) {
          const ob = book.realObj ? book.realObj(o) : o;
          let id = null;
          if (ob.t === 'research' && ob.id) id = ob.id;
          else if (ob.t === 'tank') id = nodeFor('tank', TANK_ORDER[ob.tier])?.id;
          else if (ob.t === 'boat') id = nodeFor('boat', BOAT_ORDER[ob.tier])?.id;
          else if (ob.t === 'visit') id = nodeFor('biome', ob.biome)?.id;
          if (id && !out[id]) out[id] = q;
        }
      }
    } catch { /* quests are optional */ }
    return out;
  }

  // ---------------------------------------------------------------- plan
  status(id) { return this.prev?.[id] || labStatus(this.game.state, id); }

  toggle(id, o = {}) {
    const g = this.game, st = g.state;
    const i = this.plan.indexOf(id);
    if (i >= 0) {
      // un-plan it and everything planned after it that needed it
      const drop = new Set([id]);
      for (const q of this.plan.slice(i + 1)) if (LAB_BY_ID[q].req.some((r) => drop.has(r))) drop.add(q);
      this.plan = this.plan.filter((q) => !drop.has(q));
      for (const q of drop) this.a(q).pop = 0.6;
      g.audio.play('bubble', { pitch: 0.8 });
      this.p.say?.('undo');
      return true;
    }
    const c = canPlan(st, id, this.plan);
    if (!c.ok) { this.reject(id, c.reason); return false; }
    const af = planAfford(st, [...this.plan, id]);
    if (!af.ok) {
      const miss = !af.aero.ok ? 'Not enough Aero' : af.items.some((x) => !x.ok) ? 'Missing materials' : 'Need more fish';
      this.reject(id, miss + ' for that one!');
      return false;
    }
    this.plan.push(id);
    const A = this.a(id);
    A.pop = 1;
    this.burst(id, 'plan');
    g.audio.play('ui_click', { pitch: 1.2 + Math.min(0.5, this.plan.length * 0.06) });
    g.audio.play('bubble', { vol: 0.5, pitch: 1.4 });
    if (!o.silent) this.p.say?.('plan');
    return true;
  }

  reject(id, reason) {
    this.a(id).shake = 1;
    this.game.audio.play('ui_error');
    this.game.toast?.(reason, 'cross');
    this.p.say?.('nope');
  }

  undo() {
    if (!this.plan.length) return false;
    const id = this.plan.pop();
    this.a(id).pop = 0.6;
    this.game.audio.play('bubble', { pitch: 0.8 });
    return true;
  }

  confirm() {
    const g = this.game;
    if (!this.plan.length) return null;
    const r = confirmResearch(g, this.plan);
    this.plan = [];
    if (r.failed.length) g.toast?.(LAB_BY_ID[r.failed[0].id]?.name + ': ' + r.failed[0].reason, 'cross');
    if (r.started.length || r.queued.length) {
      g.audio.play('ui_unlock');
      g.audio.play('bubbles', { vol: 0.6 });
      for (const id of [...r.started, ...r.queued]) { this.a(id).pop = 1; this.burst(id, 'confirm'); }
      if (r.queued.length) g.toast?.(`${r.queued.length} research queued - it starts when a bench frees up.`, 'clock');
      this.p.cheer = 1.6;
      this.p.say?.('confirm');
    }
    return r;
  }

  // ---------------------------------------------------------------- particles
  burst(id, kind) {
    const G = this.geo;
    if (!G?.pos[id]) return;
    const [x, y] = G.pos[id];
    const col = branchCol(LAB_BY_ID[id]?.branch);
    const add = (o) => this.fx.push({ x, y, t: 0, ...o });
    if (kind === 'done') {
      add({ kind: 'ring', dur: 0.8, col: '#ffffff' });
      add({ kind: 'ring', dur: 1.1, col: mix(col, '#ffffff', 0.4), delay: 0.12 });
      add({ kind: 'label', dur: 1.6, text: 'UNLOCKED!' });
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + hash1(i, 7) * 0.3, v = 40 + hash1(i, 9) * 50; add({ kind: 'spark', dur: 0.7 + hash1(i, 3) * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, g: 60, col: i % 3 ? '#ffffff' : '#fff6a0' }); }
      for (let i = 0; i < 6; i++) add({ kind: 'bubble', dur: 1.2 + hash1(i, 4), vx: (hash1(i, 5) - 0.5) * 30, vy: -30 - hash1(i, 6) * 30, g: -10, r: 1.5 + hash1(i, 8) * 2 });
    } else if (kind === 'free') {
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, v = 30 + hash1(i, 2) * 40; add({ kind: 'link', dur: 0.9, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 220, rot: hash1(i, 3) * 6, vr: (hash1(i, 4) - 0.5) * 18 }); }
      add({ kind: 'lock', dur: 1, vx: 14, vy: -50, g: 260, rot: 0, vr: 6, x: x + G.T * 0.3, y: y + G.T * 0.3 });
      add({ kind: 'ring', dur: 0.6, col: '#bff6ff' });
    } else if (kind === 'plan') {
      add({ kind: 'ring', dur: 0.45, col: '#d6ff8a' });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3, v = 34; add({ kind: 'spark', dur: 0.45, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0, col: '#eaffb4' }); }
    } else if (kind === 'confirm') {
      add({ kind: 'ring', dur: 0.7, col: '#fff2b8' });
      for (let i = 0; i < 4; i++) add({ kind: 'bubble', dur: 1, vx: (hash1(i, 5) - 0.5) * 20, vy: -40, g: -5, r: 1.5 + hash1(i, 8) * 1.5 });
    }
  }

  // ---------------------------------------------------------------- input
  update(ui, view, dt) {
    const inp = ui.inp, g = this.game, st = g.state;
    this.t += dt;
    this.view = view;
    const G = this.layout(view);
    const maxX = Math.max(0, G.contentW - view.w), maxY = Math.max(0, G.contentH - view.h);
    const inside = inp.x >= view.x && inp.y >= view.y && inp.x < view.x + view.w && inp.y < view.y + view.h;
    const overCard = this.cardRect && inp.x >= this.cardRect.x && inp.y >= this.cardRect.y && inp.x < this.cardRect.x + this.cardRect.w && inp.y < this.cardRect.y + this.cardRect.h;
    // focus request: scroll the tile into view
    if (this.focusId && G.pos[this.focusId]) {
      const [x, y] = G.pos[this.focusId];
      this.scroll.x = clamp(x - view.w / 2, 0, maxX); this.scroll.y = clamp(y - view.h / 2, 0, maxY);
      this.focusId = null;
    }
    if (inside && inp.wheel && !overCard) {
      if (maxY > 0) this.scroll.y = clamp(this.scroll.y + inp.wheel * 40, 0, maxY);
      else if (maxX > 0) this.scroll.x = clamp(this.scroll.x + inp.wheel * 40, 0, maxX);
      inp.wheel = 0;
    }
    if (inp.keyPressed?.('+') || inp.keyPressed?.('=')) this.setZoom(1);
    if (inp.keyPressed?.('-')) this.setZoom(0);
    this.hover = inside && !overCard && !this.drag?.moved ? this.pick(view, inp.x, inp.y) : null;
    if (this.hover && this.hover !== this.lastHover) g.audio.play('ui_hover', { vol: 0.5, pitch: 0.9 + (G.col[this.hover] || 0) * 0.04 });
    this.lastHover = this.hover;
    const onZoom = this.zoomRect && inp.x >= this.zoomRect.x && inp.y >= this.zoomRect.y && inp.x < this.zoomRect.x + this.zoomRect.w && inp.y < this.zoomRect.y + this.zoomRect.h;
    if (inside && inp.pressed && !overCard && !onZoom) {
      inp.pressed = false;
      this.drag = { x: inp.x, y: inp.y, sx: this.scroll.x, sy: this.scroll.y, moved: false, id: this.hover };
    }
    if (this.drag) {
      const d = this.drag;
      if (inp.down) {
        if (Math.hypot(inp.x - d.x, inp.y - d.y) > 4 && (maxX > 0 || maxY > 0)) d.moved = true;
        if (d.moved) { this.scroll.x = clamp(d.sx - (inp.x - d.x), 0, maxX); this.scroll.y = clamp(d.sy - (inp.y - d.y), 0, maxY); }
      } else {
        if (!d.moved) this.click(d.id);
        this.drag = null;
      }
    }
    this.scroll.x = clamp(this.scroll.x, 0, maxX); this.scroll.y = clamp(this.scroll.y, 0, maxY);
    // the plan only keeps what is still plannable (research finished elsewhere, Aero spent...)
    this.plan = this.plan.filter((id, i) => canPlan(st, id, this.plan.slice(0, i)).ok);
    // status changes -> bursts and chain breaks
    const now = {};
    for (const id in G.pos) now[id] = labStatus(st, id);
    if (this.prev) {
      for (const id in now) {
        const a = this.prev[id], b = now[id];
        if (a === b) continue;
        if (b === 'done') { this.burst(id, 'done'); this.a(id).pop = 1.2; g.audio.play('sparkle', { vol: 0.5 }); }
        else if (a === 'locked' && b === 'available') { this.burst(id, 'free'); this.a(id).pop = 0.8; g.audio.play('box_open', { vol: 0.35, pitch: 1.6 }); }
      }
    }
    this.prev = now;
    // per-tile animation
    for (const [id, A] of this.anim) {
      A.hov = damp(A.hov, this.hover === id ? 1 : 0, 14, dt);
      A.pop = Math.max(0, A.pop - dt * 2.4);
      A.shake = Math.max(0, A.shake - dt * 2.5);
    }
    if (this.hover) this.a(this.hover);
    for (const f of this.fx) {
      if (f.delay) { f.delay -= dt; continue; }
      f.t += dt;
      if (f.vx !== undefined) { f.vy += (f.g || 0) * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 1 - dt * 1.5; if (f.vr) f.rot += f.vr * dt; }
    }
    this.fx = this.fx.filter((f) => f.t < f.dur);
    if (this.hl) { this.hl.t += dt; if (this.hl.t > 6) this.hl = null; }
    if (inp.keyPressed?.('Enter')) this.confirm();
    if (inp.keyPressed?.('Backspace') || inp.keyPressed?.('z')) this.undo();
  }

  setZoom(z) {
    if (this.zoom === z) return;
    const v = this.view, G = this.geo;
    // keep the middle of the view in place
    const cx = v && G ? (this.scroll.x + v.w / 2) / G.contentW : 0.5, cy = v && G ? (this.scroll.y + v.h / 2) / G.contentH : 0.5;
    this.zoom = z;
    if (v) { const N = this.layout(v); this.scroll.x = cx * N.contentW - v.w / 2; this.scroll.y = cy * N.contentH - v.h / 2; }
    this.game.audio.play('ui_click');
  }

  click(id) {
    const g = this.game;
    if (!id) { if (this.pinned) { this.pinned = null; g.audio.play('ui_click', { pitch: 0.8 }); } return; }
    const dbl = this.lastClick.id === id && this.t - this.lastClick.t < 0.38;
    this.lastClick = { id, t: this.t };
    const s = this.status(id);
    if (this.plan.includes(id)) {
      if (dbl) { this.confirm(); return; }
      this.toggle(id);
      return;
    }
    if (s === 'available' || (s === 'locked' && canPlan(g.state, id, this.plan).ok)) {
      this.pinned = null;
      if (this.toggle(id) && dbl) this.confirm();
      return;
    }
    // done / brewing / queued / locked: pin the card (actions live there)
    this.pinned = this.pinned === id ? null : id;
    this.a(id).pop = 0.5;
    g.audio.play('ui_click', { pitch: 1.05 });
    if (s === 'locked') this.a(id).shake = 0.7;
  }

  // ---------------------------------------------------------------- drawing
  drawBackground(ctx, view) {
    const t = this.t;
    ctx.drawImage(aeroCached(`labrowsbg|${view.w}|${view.h}`, () => {
      const c = makeCanvas(view.w, view.h), g = ctxOf(c);
      const gr = g.createLinearGradient(0, 0, 0, view.h);
      gr.addColorStop(0, 'rgba(26,120,196,0.86)'); gr.addColorStop(0.55, 'rgba(12,84,156,0.88)'); gr.addColorStop(1, 'rgba(8,58,114,0.9)');
      g.fillStyle = gr; g.fillRect(0, 0, view.w, view.h);
      // the faint "gear" of the reference, as a bubble-ring emblem
      const cx = view.w * 0.46, cy = view.h * 0.52, R = Math.min(view.w, view.h) * 0.46;
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      for (const [r, w] of [[R, 10], [R * 0.78, 3], [R * 0.6, 8], [R * 0.34, 3]]) { g.lineWidth = w; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.06)';
      for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.89, cy + Math.sin(a) * R * 0.89, R * 0.05, 0, TAU); g.fill(); }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.26; g.save(); g.translate(cx + Math.cos(a) * R * 0.47, cy + Math.sin(a) * R * 0.47); g.rotate(a); g.beginPath(); g.ellipse(0, 0, R * 0.12, R * 0.05, 0, 0, TAU); g.fill(); g.restore(); }
      // soft caustic light at the top, deeper water at the bottom
      const lg = g.createLinearGradient(0, 0, 0, view.h * 0.3);
      lg.addColorStop(0, 'rgba(190,240,255,0.22)'); lg.addColorStop(1, 'rgba(190,240,255,0)');
      g.fillStyle = lg; g.fillRect(0, 0, view.w, view.h * 0.3);
      return c;
    }), view.x, view.y);
    drawRays(ctx, view.x + view.w * 0.12, view.y - 20, view.h * 1.1, t, 0.07, 10);
    // the emblem's dotted ring turns slowly
    const cx = view.x + view.w * 0.46, cy = view.y + view.h * 0.52, R = Math.min(view.w, view.h) * 0.46 * 0.7;
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU + t * 0.05; ctx.fillRect(Math.round(cx + Math.cos(a) * R) - 1, Math.round(cy + Math.sin(a) * R) - 1, 2, 2); }
    for (let i = 0; i < 16; i++) {
      const k = (t * (0.03 + hash1(i, 6) * 0.04) + hash1(i, 7)) % 1;
      drawAeroBubble(ctx, view.x + hash1(i, 8) * view.w + Math.sin(t + i) * 4, view.y + view.h + 10 - k * (view.h + 30), 1.5 + hash1(i, 9) * 3, 0.55);
    }
  }

  draw(ctx, ui, view, dt) {
    const g = this.game, st = g.state, t = this.t;
    const G = this.layout(view);
    const status = this.prev || {};
    ctx.save();
    roundRectPath(ctx, view.x, view.y, view.w, view.h, 8); ctx.clip();
    this.drawBackground(ctx, view);
    const X = (x) => this.sx(view, x), Y = (y) => this.sy(view, y);
    const vis = (x, y, m = 40) => x > view.x - m && x < view.x + view.w + m && y > view.y - m && y < view.y + view.h + m;
    const T = G.T;
    const planIdx = (id) => this.plan.indexOf(id) + 1;
    this.quest = this.questTargets();
    const stateOf = (id) => {
      const s = status[id] || 'locked';
      if (planIdx(id)) return 'planned';
      if (s === 'researching') return labQueued(st, id) ? 'queued' : 'researching';
      return s;
    };
    // ---- leader lines, labels and elbows
    for (const r of LAB_ROWS) {
      const first = r.nodes[0];
      if (!G.pos[first]) continue;
      const [fx, fy] = G.pos[first];
      const x1 = X(fx - T / 2 - 1), y = Y(fy);
      if (y < view.y - 30 || y > view.y + view.h + 30) continue;
      const col = branchCol(r.branch);
      let labelRight = x1 - 6;
      if (!r.from) {
        // thin leader line from the left edge to the first tile, a dot at its end
        const x0 = X(G.offX + 10);
        ctx.fillStyle = rgba('#03214a', 0.45); ctx.fillRect(Math.round(x0), Math.round(y) + 1, Math.round(x1 - x0), 1);
        ctx.fillStyle = rgba('#d8f6ff', 0.85); ctx.fillRect(Math.round(x0), Math.round(y), Math.round(x1 - x0), 1);
        drawGlossOrb(ctx, x0, y + 0.5, 2.5, col);
      } else if (G.pos[r.from]) {
        const [px, py] = G.pos[r.from];
        const down = fy > py;
        const ex = X(px), ey0 = Y(py + (down ? T / 2 + 3 : -T / 2 - 3)), rr = 5;
        const pts = [[ex, ey0], [ex, y + (down ? -rr : rr)]];
        for (let i = 1; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); pts.push([ex + rr - Math.cos(a) * rr, y + (down ? -1 : 1) * (rr - Math.sin(a) * rr)]); }
        pts.push([x1, y]);
        const sa = status[r.from], sb = status[first];
        const water = sa === 'done' ? (sb === 'done' ? 1 : sb === 'researching' ? 0.3 + 0.7 * labProgress(st, first) : 0.35 + 0.08 * Math.sin(t * 3)) : 0;
        drawTube(ctx, pts, { t, water, color: mix(col, '#2fd3e8', 0.4), width: 4, alpha: sa === 'done' ? 1 : 0.75, flow: 26, bubbles: water > 0 ? 2 : 0 });
      }
      // the label sits on the line, just left of the first tile
      const txt = labelOf(r);
      const tw = measureText(txt, LABEL_FONT);
      const bic = !r.from ? icon(BRANCHES[r.branch]?.icon, 14) : null;
      const lx = Math.round(labelRight - tw), ly = Math.round(y - 10);
      if (bic) {
        const bm = iconMotion(BRANCHES[r.branch].icon, t, r.id.length);
        ctx.drawImage(bic, Math.round(lx - bic.width - 3), Math.round(y - bic.height - 1 + (bm.dy || 0) * 0.5));
      }
      drawText(ctx, txt, lx, ly, { font: LABEL_FONT, color: '#ffffff', outline: '#0a3a6e' });
      ctx.fillStyle = rgba(mix(col, '#ffffff', 0.3), 0.95); ctx.fillRect(lx, ly + 9, tw, 1);
    }
    // ---- chain tubes between neighbours in a row
    for (const r of LAB_ROWS) {
      for (let i = 1; i < r.nodes.length; i++) {
        const a = r.nodes[i - 1], b = r.nodes[i];
        if (!G.pos[a] || !G.pos[b]) continue;
        const [ax, ay] = G.pos[a], [bx] = G.pos[b];
        const x0 = X(ax + T / 2 + 1), x1 = X(bx - T / 2 - 1), y = Y(ay);
        if (!vis(x0, y) && !vis(x1, y)) continue;
        const sa = status[a], sb = status[b];
        const water = sa === 'done' ? (sb === 'done' ? 1 : sb === 'researching' ? 0.25 + 0.75 * labProgress(st, b) : 0.3 + 0.1 * Math.sin(t * 3 + i)) : 0;
        drawTube(ctx, [[x0, y], [x1, y]], { t: t + i * 0.3, water, color: mix(branchCol(r.branch), '#2fd3e8', 0.4), width: 5, alpha: sa === 'done' ? 1 : 0.72, flow: 22, bubbles: water > 0 ? 1 : 0 });
        if (planIdx(b) && (planIdx(a) || sa === 'done' || sa === 'researching')) {
          // planned path: marching lime dots
          ctx.fillStyle = '#e4ff9a';
          for (let k = 0; k < 3; k++) { const q = ((t * 1.4 + k / 3) % 1); ctx.fillRect(Math.round(lerp(x0, x1, q)) - 1, Math.round(y) - 1, 2, 2); }
        }
      }
    }
    // ---- Professor Fizz in the corner (behind the tiles)
    this.p.drawFizzCorner?.(ctx, ui, view, G);
    // ---- tiles (hovered last, on top)
    const order = Object.keys(G.pos).sort((a, b) => (this.a(a).hov + this.a(a).pop) - (this.a(b).hov + this.a(b).pop));
    for (const id of order) {
      const [px, py] = G.pos[id];
      const x = X(px), y = Y(py);
      if (!vis(x, y)) continue;
      this.drawTile(ctx, id, x, y, T, stateOf(id), planIdx(id));
    }
    // ---- particles
    for (const f of this.fx) {
      if (f.delay > 0) continue;
      const k = clamp01(f.t / f.dur), x = X(f.x), y = Y(f.y);
      if (f.kind === 'ring') { ctx.strokeStyle = rgba(f.col, 1 - k); ctx.lineWidth = 2 - k; ctx.beginPath(); ctx.arc(x, y, T * 0.5 + k * T * 0.9, 0, TAU); ctx.stroke(); }
      else if (f.kind === 'spark') drawSparkle(ctx, x, y, k < 0.5 ? 2 : 1, 1 - k, f.col);
      else if (f.kind === 'bubble') drawAeroBubble(ctx, x, y, f.r, 1 - k);
      else if (f.kind === 'link') {
        ctx.save(); ctx.translate(x, y); ctx.rotate(f.rot); ctx.globalAlpha *= 1 - k;
        ctx.strokeStyle = '#3c5a78'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1.7, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#eef8ff'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1.7, 0, Math.PI, TAU); ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'lock') { ctx.save(); ctx.globalAlpha *= 1 - k * k; drawPadlock(ctx, x, y, 1, 1, f.rot); ctx.restore(); }
      else if (f.kind === 'label') {
        const yy = y - T * 0.7 - ease.outCubic(k) * 16;
        ctx.globalAlpha = 1 - clamp01((k - 0.6) / 0.4);
        drawText(ctx, f.text, Math.round(x - measureText(f.text, 'small') / 2), Math.round(yy), { font: 'small', color: '#fff6a0', outline: '#5a3a06' });
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    // scroll bars (only when the rows overflow)
    const maxX = Math.max(0, G.contentW - view.w), maxY = Math.max(0, G.contentH - view.h);
    if (maxY > 0) {
      const h = Math.max(20, view.h * (view.h / G.contentH)), y = view.y + (view.h - h) * (this.scroll.y / maxY);
      ctx.fillStyle = rgba('#ffffff', 0.18); roundRectPath(ctx, view.x + view.w - 6, view.y + 2, 4, view.h - 4, 2); ctx.fill();
      ctx.fillStyle = rgba('#bff6ff', 0.85); roundRectPath(ctx, view.x + view.w - 6, y, 4, h, 2); ctx.fill();
    }
    if (maxX > 0) {
      const w = Math.max(20, view.w * (view.w / G.contentW)), x = view.x + (view.w - w) * (this.scroll.x / maxX);
      ctx.fillStyle = rgba('#ffffff', 0.18); roundRectPath(ctx, view.x + 2, view.y + view.h - 6, view.w - 4, 4, 2); ctx.fill();
      ctx.fillStyle = rgba('#bff6ff', 0.85); roundRectPath(ctx, x, view.y + view.h - 6, w, 4, 2); ctx.fill();
    }
    // zoom pill (fit <-> big tiles)
    const zr = this.zoomRect = { x: view.x + 6, y: view.y + view.h - 26, w: 44, h: 20 };
    if (pill(ui, ctx, zr.x, zr.y, 20, 20, '', { tone: this.zoom ? 'glass' : 'aqua', icon: getUiIcon('minus'), tip: 'Fit all rows' })) this.setZoom(0);
    if (pill(ui, ctx, zr.x + 22, zr.y, 20, 20, '', { tone: this.zoom ? 'aqua' : 'glass', icon: getUiIcon('plus'), tip: 'Bigger tiles' })) this.setZoom(1);
    void dt;
  }

  drawTile(ctx, id, x, y, T, state, planNo) {
    const nd = LAB_BY_ID[id], A = this.a(id), t = this.t, st = this.game.state;
    const col = branchCol(nd.branch);
    const pop = A.pop > 0 ? Math.sin(Math.min(1, A.pop) * Math.PI) * 0.22 : 0;
    const k = A.hov;
    let S = Math.round(T * (1 + 0.36 * ease.outCubic(k) + pop));
    S += S % 2;
    const shake = A.shake > 0 ? Math.sin(A.shake * 40) * 2.2 * A.shake : 0;
    const bob = state === 'available' ? Math.sin(t * 2.4 + A.ph) * 0.8 : state === 'planned' ? -Math.abs(Math.sin(t * 4 + A.ph)) * 1.2 : 0;
    const cx = Math.round(x + shake), cy = Math.round(y + bob);
    const x0 = cx - S / 2, y0 = cy - S / 2;
    const hl = this.hl?.id === id ? this.hl : null;
    // glows: hover, plan pulse, brewing, focus highlight
    if (k > 0.05) drawAeroGlow(ctx, cx, cy, S * 1.05, mix(col, '#ffffff', 0.5), 0.55 * k);
    if (state === 'planned') drawAeroGlow(ctx, cx, cy, S * 0.95, '#d6ff8a', 0.45 + 0.2 * Math.sin(t * 5 + A.ph));
    if (state === 'researching') drawAeroGlow(ctx, cx, cy, S, '#bffcff', 0.45 + 0.25 * Math.sin(t * 4 + A.ph));
    if (state === 'available' && labCheck(st, nd, this.game.stats).paid && ((t * 0.5 + A.ph * 0.16) % 1) < 0.5) drawAeroGlow(ctx, cx, cy, S * 0.9, '#ffffff', 0.18);
    if (hl) {
      const q = (hl.t * 1.2) % 1;
      ctx.strokeStyle = rgba('#fff6a0', 1 - q); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, S * 0.6 + q * 12, 0, TAU); ctx.stroke();
      const ar = getUiIcon('arrow_d');
      if (ar && hl.t < 6) ctx.drawImage(ar, Math.round(cx - ar.width / 2), Math.round(y0 - ar.height - 6 - Math.abs(Math.sin(t * 5)) * 4));
    }
    // soft shadow
    ctx.fillStyle = rgba('#021a38', 0.35);
    ctx.beginPath(); ctx.ellipse(cx + 1, y0 + S + 1, S * 0.42, 2, 0, 0, TAU); ctx.fill();
    // frame + inner window
    ctx.drawImage(frameTex(S, state, col), x0, y0);
    const inner = innerTex(S, state, col);
    ctx.drawImage(inner, x0 + 3, y0 + 3);
    const iw = S - 6;
    // brewing: rising water inside the window + shimmer
    if (state === 'researching') {
      const p = labProgress(st, id);
      ctx.save();
      roundRectPath(ctx, x0 + 3, y0 + 3, iw, iw, Math.max(3, Math.round(iw * 0.2))); ctx.clip();
      const wy = y0 + 3 + iw * (1 - (0.12 + 0.88 * p));
      const wg = ctx.createLinearGradient(0, wy, 0, y0 + 3 + iw);
      wg.addColorStop(0, rgba('#b8ffd0', 0.92)); wg.addColorStop(1, rgba('#38c86a', 0.92));
      ctx.fillStyle = wg;
      ctx.beginPath(); ctx.moveTo(x0, y0 + S);
      for (let i = 0; i <= 8; i++) { const xx = x0 + 3 + (iw * i) / 8; ctx.lineTo(xx, wy + Math.sin(t * 5 + i * 1.3 + A.ph) * 1.1); }
      ctx.lineTo(x0 + S, y0 + S); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.6); ctx.fillRect(x0 + 3, Math.round(wy), iw, 1);
      // diagonal shimmer sweep
      const q = ((t * 0.6 + A.ph * 0.1) % 1.6) - 0.3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ffffff', 0.35);
      ctx.beginPath(); const sxp = x0 + q * S * 1.6;
      ctx.moveTo(sxp, y0); ctx.lineTo(sxp + 5, y0); ctx.lineTo(sxp - S * 0.5 + 5, y0 + S); ctx.lineTo(sxp - S * 0.5, y0 + S); ctx.closePath(); ctx.fill();
      ctx.restore();
      for (let i = 0; i < 2; i++) { const qq = (t * 0.8 + i * 0.5 + A.ph) % 1; drawAeroBubble(ctx, cx + Math.sin(t * 3 + i * 2) * iw * 0.25, y0 + S - 4 - qq * iw * 0.7, 1 + qq * 0.6, 1 - qq); }
    }
    // the icon
    const px = Math.round(iw * 0.92);
    if (state === 'locked') {
      drawAnimIcon(ctx, nd.icon, cx, cy, px, t, A.ph, { ghost: true });
    } else drawAnimIcon(ctx, nd.icon, cx, cy, px, t, A.ph, { hover: k + (state === 'planned' ? 0.4 : 0) });
    // done: a glint sweeps across the glass now and then
    if (state === 'done') {
      const q = ((t * 0.25 + A.ph * 0.07) % 2.4);
      if (q < 1) {
        ctx.save(); roundRectPath(ctx, x0, y0, S, S, Math.max(4, Math.round(S * 0.24))); ctx.clip();
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rgba('#ffffff', 0.4);
        const gx = x0 - S * 0.5 + q * S * 2;
        ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx + 4, y0); ctx.lineTo(gx - S * 0.6 + 4, y0 + S); ctx.lineTo(gx - S * 0.6, y0 + S); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // locked: chains + padlock (rattle on hover)
    if (state === 'locked') {
      const ch = chainTex(S);
      const jig = k > 0.2 ? Math.round(Math.sin(t * 30) * k) : 0;
      const ga = ctx.globalAlpha; ctx.globalAlpha = ga * (0.92 - 0.3 * k);
      ctx.drawImage(ch, x0 - 3 + jig, y0 - 3);
      ctx.globalAlpha = ga;
      drawPadlock(ctx, x0 + S - 3, y0 + S - 3, S >= 28 ? 1.25 : 1, 0, Math.sin(t * 2.2 + A.ph) * 0.12 + (k > 0.2 ? Math.sin(t * 22) * 0.2 * k : 0));
    }
    // the gem on top (branch colour bubble) and the level plate at the bottom
    drawGlossOrb(ctx, cx, y0 + 0.5, S >= 30 ? 3.5 : 2.5, state === 'locked' ? '#9ab0c4' : col);
    if (state !== 'locked') {
      let txt, tone;
      if (state === 'researching') { txt = Math.floor(labProgress(st, id) * 100) + '%'; tone = 'aqua'; }
      else if (state === 'queued') { txt = 'Q' + labQueued(st, id); tone = 'purple'; }
      else if (state === 'planned') { txt = String(planNo); tone = 'green'; }
      else { txt = String(nd.tier); tone = state === 'done' ? 'green' : 'aqua'; }
      const tw = measureText(txt, 'small'), pw = Math.max(9, tw + 6), ph = 8;
      const plx = Math.round(cx - pw / 2), ply = Math.round(y0 + S - ph + 3);
      ctx.drawImage(aeroSurface(pw, ph, { tone, r: 'pill', gloss: 0.7, glossH: 3, curve: 1, rim: 0.6, glow: 0.5, edge: '#ffffff', edgeA: 0.95 }), plx, ply);
      drawText(ctx, txt, plx + Math.round((pw - tw) / 2), ply + 2, { font: 'small', color: '#ffffff', shadow: shade(state === 'done' ? '#2c961c' : '#0b4a8a', -0.2) });
    }
    if (state === 'done' && ((t * 0.3 + A.ph * 0.13) % 1) < 0.12) drawSparkle(ctx, x0 + S - 4, y0 + 4, 2, 1);
    if (state === 'queued') { const ci = getUiIcon('clock'); if (ci) ctx.drawImage(ci, x0 + S - ci.width + 2, y0 - 3); }
    // an active quest wants this one: a bouncing "!" bubble
    if (this.quest?.[id] && state !== 'done') {
      const by = Math.round(y0 - 2 - Math.abs(Math.sin(t * 4 + A.ph)) * 2);
      ctx.drawImage(aeroSurface(9, 11, { tone: 'orange', r: 4, gloss: 0.8, glossH: 5, curve: 1, rim: 0.8, glow: 0.6, edge: '#ffffff', edgeA: 1 }), x0 - 3, by - 3);
      drawText(ctx, '!', x0, by - 1, { font: 'small', color: '#ffffff', shadow: '#843a04' });
    }
    if (this.pinned === id) {
      ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -t * 14;
      roundRectPath(ctx, x0 - 3, y0 - 3, S + 6, S + 6, 7); ctx.stroke(); ctx.restore();
    }
  }

  // ---------------------------------------------------------------- the rich tooltip card (hover) / pinned card
  drawCard(ctx, ui) {
    const view = this.view, G = this.geo;
    this.cardRect = null;
    if (!view || !G) return;
    const id = this.hover || this.pinned;
    if (!id || !G.pos[id]) return;
    const pinned = !this.hover || this.hover === this.pinned;
    const nd = LAB_BY_ID[id], g = this.game, st = g.state, t = this.t;
    const s = this.status(id), q = labQueued(st, id), planned = this.plan.includes(id);
    const col = branchCol(nd.branch);
    const W = 184;
    // measure content
    const desc = wrapText(nd.desc, W - 20).slice(0, 3);
    const effects = Object.entries(nd.effect);
    const unl = nd.unlock.filter((u) => !(u.kind === 'bait' && nd.unlock.some((x) => x.kind === 'recipe' && x.id === 'bait_' + u.id)));
    const c = labCheck(st, nd, g.stats);
    const rows = [];
    if (c.aero.need) rows.push({ kind: 'aero', id: 'aero', ...c.aero });
    for (const it of c.items) rows.push({ kind: 'item', ...it });
    for (const f of c.fish) rows.push({ kind: 'fish', id: f.key, ...f });
    const showCost = s !== 'done' && s !== 'researching';
    const costH = showCost ? costTilesHeight(rows.length, W - 20) + 18 : 0;
    const unlH = unl.length ? (unl.length > 6 ? 40 : 22) : 0;
    const chipRows = effects.length ? Math.ceil(effects.length / 2) : 0;
    const actions = pinned ? this.cardActions(id, s, q) : [];
    const H = 44 + desc.length * 10 + 4 + chipRows * 16 + unlH + costH + 16 + (actions.length ? 26 : 0) + (this.quest?.[id] && s !== 'done' ? 11 : 0);
    const tr = this.tileRect(id);
    let x = tr.x + tr.w + 14, y = tr.y + tr.h / 2 - 30;
    const P = this.p.rect || { x: 0, y: 0, w: g.screen.W, h: g.screen.H };
    if (x + W > P.x + P.w - 6) x = tr.x - W - 14;
    y = clamp(y, P.y + 40, P.y + P.h - H - 6);
    x = Math.round(x); y = Math.round(y);
    const r = this.cardRect = { x, y, w: W, h: H };
    // body: frosted glass card with a branch-coloured header band
    ctx.save();
    ctx.fillStyle = rgba('#021a38', 0.3); roundRectPath(ctx, x + 2, y + 3, W, H, 9); ctx.fill();
    ctx.drawImage(aeroSurface(W, H, { tone: 'frost', r: 9, gloss: 0.35, glossH: 30, curve: 2, rim: 0.9, glow: 0.4, glowColor: '#bfeaff', bubbles: 3, seed: 11 }), x, y);
    ctx.drawImage(aeroSurface(W - 6, 34, { tone: frameTone('done', col), r: 7, gloss: 0.7, glossH: 14, curve: 2, rim: 0.8, glow: 0.5 }), x + 3, y + 3);
    // little pointer toward the tile
    const left = x > tr.x;
    ctx.fillStyle = '#ffffff';
    const ay = clamp(tr.y + tr.h / 2, y + 10, y + H - 10);
    ctx.beginPath();
    if (left) { ctx.moveTo(x + 1, ay - 5); ctx.lineTo(x - 6, ay); ctx.lineTo(x + 1, ay + 5); } else { ctx.moveTo(x + W - 1, ay - 5); ctx.lineTo(x + W + 6, ay); ctx.lineTo(x + W - 1, ay + 5); }
    ctx.closePath(); ctx.fill();
    // header: big animated icon + name + branch/level
    drawAeroGlow(ctx, x + 22, y + 20, 20, '#ffffff', 0.6);
    drawAnimIcon(ctx, nd.icon, x + 22, y + 20, 28, t, this.a(id).ph, { hover: 0.5 });
    const name = nd.name.length > 22 ? nd.name.slice(0, 21) + '.' : nd.name;
    drawText(ctx, name, x + 42, y + 9, { color: '#ffffff', shadow: shade(col, -0.6) });
    drawText(ctx, `${(BRANCHES[nd.branch]?.name || '').toUpperCase()}  LV ${nd.tier}`, x + 42, y + 22, { font: 'small', color: mix(col, '#ffffff', 0.8), shadow: shade(col, -0.6) });
    let yy = y + 42;
    for (const l of desc) { drawText(ctx, l, x + 10, yy, { color: INK_SOFT }); yy += 10; }
    yy += 4;
    // effects (two per row)
    effects.forEach(([k2, v], i) => {
      const info = EFFECT_INFO[k2];
      const cxp = x + 10 + (i % 2) * ((W - 20) / 2), cyp = yy + Math.floor(i / 2) * 16;
      chip(ctx, cxp, cyp, anyIcon(info?.[0] || 'star', 10), `${info?.[1] || k2} ${fmtEffect(k2, v)}`.slice(0, 18), { bg: rgba('#effff0', 0.95), edge: rgba('#7ad08a', 0.9), color: '#1d7a32' });
    });
    yy += chipRows * 16;
    // unlocks: little glass tiles
    if (unl.length) {
      const sz = 18, per = Math.floor((W - 20) / (sz + 3));
      unl.slice(0, per * 2).forEach((u, i) => {
        const info = unlockInfo(u);
        const ux = x + 10 + (i % per) * (sz + 3), uy = yy + Math.floor(i / per) * (sz + 3);
        ctx.drawImage(aeroSurface(sz, sz, { tone: 'white', r: 5, gloss: 0.6, glossH: 7, curve: 1, rim: 0.8, glow: 0.4 }), ux, uy);
        drawAnimIcon(ctx, info.key, ux + sz / 2, uy + sz / 2, sz - 4, t, i * 1.7, {});
      });
      if (unl.length === 1) drawText(ctx, unlockInfo(unl[0]).name.slice(0, 26), x + 32, yy + 6, { color: INK });
      yy += unlH;
    }
    // costs + time
    if (showCost) {
      costTiles(ctx, ui, rows, x + 10, yy, W - 20);
      yy += costTilesHeight(rows.length, W - 20) + 4;
      const ci = getUiIcon('clock');
      if (ci) ctx.drawImage(ci, x + 10, yy);
      drawText(ctx, fmtTime(labTime(st, nd, g.stats)), x + 24, yy + 2, { color: INK });
      yy += 14;
    }
    // status line
    let line = '', lc = INK;
    if (s === 'done') { line = 'Researched!'; lc = OK; }
    else if (q) { line = `Queued #${q} - waits for a free bench`; lc = '#6a3ab8'; }
    else if (s === 'researching') { line = `Brewing ${Math.floor(labProgress(st, id) * 100)}%  ${fmtTime(labRemaining(st, id))} left`; lc = '#b8640a'; }
    else if (planned) { line = `Planned #${this.plan.indexOf(id) + 1}: Confirm to start`; lc = OK; }
    else if (s === 'available') { line = c.paid ? 'Click to plan it!' : 'Need more ingredients'; lc = c.paid ? OK : BAD; }
    else {
      const cp = canPlan(st, id, this.plan);
      line = cp.ok ? 'Click to plan it after the others' : cp.reason;
      lc = cp.ok ? OK : BAD;
    }
    if (s === 'researching' && !q) drawAeroBar(ctx, x + 10, yy, W - 20, 6, labProgress(st, id), { color: '#5fd23a' }), yy += 8;
    drawText(ctx, line.length > 34 ? line.slice(0, 33) + '.' : line, x + 10, yy + 1, { color: lc });
    yy += 12;
    const qq = this.quest?.[id];
    if (qq && s !== 'done') { drawText(ctx, ('Quest: ' + qq.title).slice(0, 34), x + 10, yy + 1, { color: '#c86a0a' }); yy += 11; }
    // actions (pinned card)
    if (actions.length) {
      const bw = Math.floor((W - 20 - (actions.length - 1) * 4) / actions.length);
      actions.forEach((A, i) => {
        if (pill(ui, ctx, x + 10 + i * (bw + 4), yy + 2, bw, 20, A.label, { tone: A.tone, font: 'small', icon: A.icon, disabled: A.disabled, tip: A.tip, sound: A.sound })) A.fn();
      });
    }
    ctx.restore();
    if (ui.hover(r)) { ui.markHot?.('labcard'); if (ui.inp.pressed && !actions.length) ui.inp.pressed = false; }
  }

  cardActions(id, s, q) {
    const g = this.game, st = g.state, panel = this.p, nd = LAB_BY_ID[id];
    const out = [];
    if (q) out.push({ label: 'Unqueue', tone: 'glass', icon: getUiIcon('cross'), tip: 'Take it out of the queue (refund)', fn: () => { cancelResearch(g, id); this.pinned = null; } });
    else if (s === 'researching') {
      const cost = instantCost(st, id);
      out.push({ label: `Finish ${fmtAero(cost)}`, tone: 'orange', icon: getUiIcon('aero') || getUiIcon('coin'), disabled: (st.coins || 0) < cost, tip: 'Finish it right now for Aero', sound: 'ui_unlock', fn: () => { if (instantFinish(g, id)) g.audio.play('ui_unlock'); } });
      out.push({ label: 'Stop', tone: 'glass', icon: getUiIcon('cross'), tip: 'Stop (refund)', fn: () => { cancelResearch(g, id); this.pinned = null; } });
    } else if (s === 'done') {
      if (nd.unlock.some((u) => u.kind === 'rod')) out.push({ label: 'Rod rack', tone: 'aqua', icon: icon('rod:glass', 12), fn: () => { panel.rodSel = nd.unlock.find((u) => u.kind === 'rod').id; panel.setTab('rods'); } });
      else if (nd.unlock.some((u) => u.kind === 'recipe')) out.push({ label: 'Craft it', tone: 'aqua', icon: icon('hammer', 12), fn: () => panel.setTab('craft', { recipe: nd.unlock.find((u) => u.kind === 'recipe')?.id }) });
      else if (nd.unlock.some((u) => u.kind === 'boat')) out.push({ label: 'Boat dock', tone: 'aqua', icon: icon('boat:skiff', 12), fn: () => { panel.boatSel = BOAT_ORDER.indexOf(nd.unlock.find((u) => u.kind === 'boat').id); panel.setTab('boats'); } });
      else if (nd.unlock.some((u) => u.kind === 'biome')) out.push({ label: 'Travel', tone: 'aqua', icon: getUiIcon('map'), fn: () => { g.ui.close(); g.ui.open('map'); } });
    }
    return out;
  }
}

export { drawAnimIcon, drawPadlock, iconMotion };
void ROW_BY_ID; void ROOT_ID; void labSlots; void drawAeroCoin; void drawAeroLeaf;
