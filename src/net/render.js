// Drawing other players (OWNER: Online & AppSea agent): their boats riding the surface of the same ocean, their
// bubble people (drawCharacter) on deck, fishing lines into the water, Aero name tags, emote bubbles and catch
// pop-ups. Everything from the Character / World modules is used defensively (APIs are mid-rewrite): a failure
// falls back to a glossy 2D boat and simply skips the character.
//   drawPeerBoats(ctx, net, peers)   world space (camera applied), before the player's own boat
//   drawPeerTags(ctx, net, peers)    world space, after the lighting pass (tags stay bright at night)

import * as Character from '../gfx/character.js';
import * as BoatModels from '../world/boatmodels.js';
import * as Vox from '../world/voxkit.js';
import { makeLayer, resizeLayer } from '../core/canvas.js';
import { RARITY } from '../core/color.js';
import { clamp, clamp01, dist } from '../core/math.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { drawGlossOrb, drawSparkle } from '../ui/aero.js';
import { pill, rrect } from '../store/aerokit.js';
import { HOOK } from '../fishing/baitart.js';
import { EMOTE_BY_ID } from './protocol.js';

const CHAR_SCALE = 0.62;
const VS = 2;
const SPR = new Map();
let warned = false;
let layer = null;

export const PEER_COLORS = ['#2fb8f0', '#5cc832', '#ff9d2e', '#ff6aa8', '#9a6af0', '#2fd3b8', '#ffc83a', '#ff6a5a'];

// ---------------------------------------------------------------- boat sprites (cached)
function voxBoat(tier, hull, trim, dir) {
  const T = BoatModels.buildBoatModel?.(tier, hull, trim);
  if (!T?.m || !T.A?.stand || !T.pivot || typeof Vox.renderModel !== 'function') return null;
  const YAW = Vox.WORLD_YAW ?? 0, PITCH = Vox.WORLD_PITCH ?? 0;
  const nx = T.m.nx;
  const src = dir > 0 ? T.m : Vox.mirrorModel(T.m);
  const sp = Math.sin((PITCH * Math.PI) / 180), cp = Math.cos((PITCH * Math.PI) / 180);
  const comp = (Math.atan((sp * Math.tan((YAW * Math.PI) / 180)) / cp) * 180) / Math.PI;
  const mx = (x) => (dir > 0 ? x : nx - x);
  const { model, map } = Vox.rollModel(src, dir > 0 ? comp : -comp, mx(T.pivot[0]), T.pivot[1]);
  const r = Vox.renderModel(model, { scale: VS, yaw: dir > 0 ? YAW : -YAW, pitch: PITCH, jitter: 0.18 });
  const P = (p) => { const [x, y] = map(mx(p[0]), p[1]); return r.project(x, y, p[2]); };
  const piv = P([T.pivot[0], T.pivot[1], (T.zc ?? 0) + 0.5]);
  const A = {};
  for (const [k, p] of Object.entries(T.A)) if (p) { const q = P(p); A[k] = [q[0] - piv[0], q[1] - piv[1]]; }
  let front = null;
  try { front = T.front ? Vox.idOverlay(r, T.front, true) : null; } catch { front = null; }
  return { canvas: r.canvas, px: Math.round(piv[0]), py: Math.round(piv[1]), front, A };
}

// Glossy toy boat (fallback when the voxel boat models are unavailable).
function flatBoat(tier, hull, trim, dir) {
  const w = 46 + tier * 6, h = 30 + tier * 4;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const wl = h - 8;
  g.save();
  if (dir < 0) { g.translate(w, 0); g.scale(-1, 1); }
  g.beginPath();
  g.moveTo(2, wl - 8); g.lineTo(w - 2, wl - 10); g.quadraticCurveTo(w - 8, wl + 6, w - 16, wl + 6);
  g.lineTo(10, wl + 6); g.quadraticCurveTo(4, wl, 2, wl - 8); g.closePath();
  const gr = g.createLinearGradient(0, wl - 10, 0, wl + 6);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, hull); gr.addColorStop(1, '#0c3a52');
  g.fillStyle = gr; g.fill();
  g.fillStyle = trim; g.fillRect(4, wl - 7, w - 10, 2);
  if (tier >= 1) {
    const cw = 12 + tier * 2;
    g.fillStyle = '#eaf8ff'; g.fillRect(w / 2 - 2, wl - 18, cw, 10);
    g.fillStyle = '#5cc8f0'; g.fillRect(w / 2, wl - 16, cw - 4, 4);
  }
  g.restore();
  const sx = dir > 0 ? 14 : w - 14;
  return { canvas: c, px: Math.round(w / 2), py: wl, front: null, A: { stand: [sx - w / 2, -9], top: [0, -h + 10], bow: [dir * (w / 2 - 2), 0], stern: [-dir * (w / 2 - 2), 0], keel: [0, 6] }, flat: true };
}

// Cached sprite for a boat look. Voxel boats are built at most once per frame (budget); until then a cheap
// glossy 2D stand-in is used.
function boatSprite(tier, hull, trim, dir, allowBuild) {
  const key = tier + '|' + hull + '|' + trim + '|' + dir;
  const s = SPR.get(key);
  if (s) return s;
  if (!allowBuild) {
    const fk = 'flat|' + key;
    let f = SPR.get(fk);
    if (!f) { f = flatBoat(tier, hull, trim, dir); SPR.set(fk, f); }
    return f;
  }
  let out = null;
  try { out = voxBoat(tier, hull, trim, dir); } catch (e) {
    if (!warned) { warned = true; console.warn('net: voxel boat unavailable, using fallback', e); }
    out = null;
  }
  if (!out) out = flatBoat(tier, hull, trim, dir);
  SPR.set(key, out);
  if (SPR.size > 24) SPR.delete(SPR.keys().next().value);
  return out;
}

function peerPaint(p) {
  let hull = p.boat.hull, trim = p.boat.trim;
  if (!hull) {
    try { const bp = Character.boatPaint?.(p.look || {}); hull = bp?.hull; trim ||= bp?.trim; } catch { /* old character module */ }
  }
  return { hull: hull || '#3ab0e0', trim: trim || '#f2e6c8' };
}

function maxTier() { return Math.max(0, (BoatModels.BOAT_TIERS?.length || 5) - 1); }

function waterAt(game, x) {
  const o = game.ocean;
  const base = o?.waveAt ? o.waveAt(x) : o?.waterLevel?.();
  if (base === null || base === undefined) return null;
  const w = game.water;
  return w?.active && w.surfaceOffset ? base - (w.surfaceOffset(x) || 0) : base;
}

function poseOf(peer, t) {
  const p = peer.p;
  if (peer.emote && t - peer.emote.t0 < 2.6) {
    const e = EMOTE_BY_ID[peer.emote.id];
    if (e && e.pose !== 'idle') return [e.pose, t - peer.emote.t0];
  }
  if (peer.cheerT0 !== undefined && t - peer.cheerT0 < 1.8) return ['cheer', t - peer.cheerT0];
  if (peer.castT0 !== undefined && t - peer.castT0 < 0.7) return ['cast', t - peer.castT0];
  if (p.st === 'fight') return ['reel', t];
  if (p.st === 'bite' || p.st === 'land') return ['pull', t];
  return ['idle', t + peer.phase];
}

// ---------------------------------------------------------------- boats + people + lines
export function drawPeerBoats(ctx, net, peers) {
  const g = net.game, W = g.screen.W, H = g.screen.H, t = net.t;
  let built = 0;
  for (const peer of peers) {
    const p = peer.p;
    const tier = clamp(p.boat.t, 0, maxTier());
    const { hull, trim } = peerPaint(p);
    const cached = SPR.has(tier + '|' + hull + '|' + trim + '|' + p.dir);
    const s = boatSprite(tier, hull, trim, p.dir, cached || built < 1);
    if (!cached) built++;
    const x = Math.round(peer.rx), wy = waterAt(g, x);
    if (wy === null) { peer.anch = null; continue; }
    const by = Math.round(wy + Math.sin(t * 1.7 + peer.phase) * 0.8);
    // compose on a scratch layer: hull, person, front rail, then tint the submerged part
    const pad = 60;
    const lw = s.canvas.width + pad * 2, lh = s.canvas.height + pad * 2;
    layer ||= makeLayer(8, 8);
    if (layer.w < lw || layer.h < lh || layer.w > lw + 200 || layer.h > lh + 200) resizeLayer(layer, lw, lh);
    const lc = layer.ctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, layer.w, layer.h);
    const ox = x - s.px - pad, oy = by - s.py - pad;
    lc.drawImage(s.canvas, pad, pad);
    const sx = x + Math.round(s.A.stand[0]) - ox, sy = by + Math.round(s.A.stand[1]) - oy;
    let an = null;
    if (!peer.charErr) {
      const [pose, pt] = poseOf(peer, t);
      try {
        an = Character.drawCharacter(lc, sx, sy, { pose, t: pt, facing: p.dir, look: p.look || undefined, scale: CHAR_SCALE, id: 'net:' + peer.key, shadow: true });
      } catch (e) {
        peer.charErr = true;
        if (!warned) { warned = true; console.warn('net: drawCharacter failed', e); }
      }
    }
    if (s.front) lc.drawImage(s.front, pad, pad);
    const tint = g.ocean?.biome?.fogColor || '#2a7aa0';
    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = tint;
    const x0 = Math.max(0, pad - 2), x1 = Math.min(layer.w, pad + s.canvas.width + 2);
    for (const [al, dy] of [[0.45, 1], [0.25, 7]]) {
      lc.globalAlpha = al;
      for (let xx = x0; xx < x1; xx += 2) {
        const w2 = waterAt(g, ox + xx);
        if (w2 === null) continue;
        const yy = Math.round(w2 - oy) + dy;
        if (yy < layer.h) lc.fillRect(xx, yy, 2, layer.h - yy);
      }
    }
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    ctx.globalAlpha = peer.fade;
    ctx.drawImage(layer.canvas, 0, 0, lw, lh, ox, oy, lw, lh);
    ctx.globalAlpha = 1;
    const head = an?.head ? [an.head[0] + ox, an.head[1] + oy] : [x + s.A.stand[0], by + s.A.stand[1] - 44];
    const rod = an?.rodTip ? [an.rodTip[0] + ox, an.rodTip[1] + oy] : [x + s.A.stand[0] + p.dir * 18, by + s.A.stand[1] - 40];
    const top = Math.min(head[1] - 10, by + (s.A.top?.[1] ?? -40));
    peer.anch = { x, y: by, head, rod, top };
    // fishing line
    if (p.hk && ['wait', 'nibble', 'bite', 'fight'].includes(p.st)) {
      const surf = g.ocean?.waterLevel?.() ?? wy;
      const hx = peer.hx ?? p.hk[0] * W, hy = peer.hy ?? surf + p.hk[1] * Math.max(40, H - surf);
      drawRope(ctx, rod[0], rod[1], hx, hy, p.st === 'fight' ? 0.85 : p.st === 'bite' ? 0.6 : 0.2, surf, t, peer.fade);
      ctx.globalAlpha = peer.fade;
      ctx.drawImage(HOOK, Math.round(hx - 3), Math.round(hy - 1));
      ctx.globalAlpha = 1;
      if (p.st === 'nibble' || p.st === 'bite') {
        const k = Math.abs(Math.sin(t * (p.st === 'bite' ? 14 : 6)));
        drawGlossOrb(ctx, Math.round(hx), Math.round(hy - 6 - k * 2), 2.5, p.st === 'bite' ? '#ff5a5a' : '#ffffff');
      }
    }
  }
}

function drawRope(ctx, x0, y0, x1, y1, tension, surf, t, alpha) {
  const d = dist(x0, y0, x1, y1);
  const sag = (1 - clamp01(tension)) * Math.min(36, d * 0.16);
  const vib = tension > 0.8 ? Math.sin(t * 55) * 1.5 : 0;
  const mx = (x0 + x1) / 2 + vib, my = (y0 + y1) / 2 + sag;
  const steps = Math.max(4, Math.ceil(d / 1.5));
  let px = null, py = null;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const x = Math.round((1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * mx + k * k * x1);
    const y = Math.round((1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * my + k * k * y1);
    if (x === px && y === py) continue;
    const under = surf !== null && y > surf;
    ctx.fillStyle = under ? `rgba(220,244,255,${0.55 * alpha})` : `rgba(240,250,255,${0.8 * alpha})`;
    ctx.fillRect(x, y, 1, 1);
    if (surf !== null && py !== null && (py <= surf) !== (y <= surf)) {
      ctx.fillStyle = `rgba(255,255,255,${0.6 * alpha})`;
      const r = 3 + Math.sin(t * 4);
      ctx.fillRect(Math.round(x - r), Math.round(surf) + 1, 2, 1);
      ctx.fillRect(Math.round(x + r - 1), Math.round(surf) + 1, 2, 1);
    }
    px = x; py = y;
  }
}

// ---------------------------------------------------------------- tags, emotes, pop-ups
// [phase4:zoom] tags are UI: drawn in screen space at 1x over the zoomed world (anchors mapped through the camera)
const toScreen = (game) => { const c = game.camera; return c?.worldToScreen ? (x, y) => c.worldToScreen(x, y) : (x, y) => [x, y]; };
export function drawPeerTags(ctx, net, peers) {
  const t = net.t;
  const S = toScreen(net.game);
  const viewTop = 0;
  for (const peer of peers) {
    const a0 = peer.anch;
    if (!a0) continue;
    const head = S(a0.head[0], a0.head[1]);
    const a = { head, top: S(a0.head[0], a0.top)[1], y: S(a0.head[0], a0.y)[1] };
    ctx.globalAlpha = peer.fade;
    const name = peer.p.name + (peer.isMe ? ' (you)' : '');
    const tw = measureText(name, 'small') + 16;
    // above the boat when there is room, otherwise just under the hull (stack grows downward)
    const need = 12 + (peer.emote ? 24 : 0) + peer.pops.length * 16;
    const below = a.top - need < viewTop + 2;
    const tx = Math.round(a.head[0] - tw / 2), ty = Math.round(below ? a.y + 10 : a.top - 12);
    pill(ctx, tx, ty, tw, 10, { color: '#f4fbff', edge: peer.color, r: 5 });
    drawGlossOrb(ctx, tx + 6, ty + 5, 2.6, peer.color);
    drawText(ctx, name, tx + 11, ty + 3, { font: 'small', color: '#0c3a52' });
    if (peer.guest) drawText(ctx, 'GUEST', tx + tw + 2, ty + 3, { font: 'small', color: '#ffffff', outline: '#0c3a52' });
    // state badge
    if (peer.p.st === 'fight' || peer.p.st === 'bite') {
      const k = Math.abs(Math.sin(t * 8));
      drawGlossOrb(ctx, tx + tw + 5, ty + 4, 4 + k, '#ff9d2e');
      drawText(ctx, '!', tx + tw + 5, ty + 2, { font: 'small', color: '#ffffff', align: 'center' });
    }
    // emote bubble
    if (peer.emote) {
      const age = t - peer.emote.t0;
      if (age < 3.2) {
        const e = EMOTE_BY_ID[peer.emote.id];
        const pop = Math.min(1, age * 6), out = clamp01((3.2 - age) * 3);
        const bx = Math.round(a.head[0] + (below ? 22 : 10)), by = Math.round((below ? Math.max(viewTop + 10, a.head[1] - 6) : ty - 20) - Math.sin(age * 3) * 1.5);
        ctx.globalAlpha = peer.fade * out;
        speechBubble(ctx, bx, by, Math.round(20 * (0.6 + 0.4 * pop)), Math.round(16 * (0.6 + 0.4 * pop)), e?.color || '#4ac8ff');
        const ic = getUiIcon(e?.icon || 'heart');
        if (ic && pop > 0.6) ctx.drawImage(ic, Math.round(bx - ic.width / 2), Math.round(by - ic.height / 2));
      } else peer.emote = null;
    }
    // catch pop-ups (newest on top)
    let py = below ? ty + 13 : ty - (peer.emote ? 38 : 16);
    for (let i = peer.pops.length - 1; i >= 0; i--) {
      const c = peer.pops[i];
      const age = t - c.t0;
      if (age > 4.5) continue;
      const rise = Math.min(1, age * 3);
      const fade = clamp01((4.5 - age) * 2);
      const col = RARITY[c.r]?.color || '#c9d4dc';
      const label = c.text, w = measureText(label, 'small') + 26, h = 13;
      const x = Math.round(a.head[0] - w / 2), y = Math.round(below ? py + (1 - rise) * 6 : py - rise * 6);
      ctx.globalAlpha = peer.fade * fade;
      pill(ctx, x, y, w, h, { color: '#ffffff', edge: col, r: 6 });
      drawGlossOrb(ctx, x + 7, y + 6.5, 4, col);
      const fi = getUiIcon('fish');
      if (fi) ctx.drawImage(fi, x + 7 - Math.floor(fi.width / 2), y + 7 - Math.floor(fi.height / 2));
      drawText(ctx, label, x + 14, y + 4, { font: 'small', color: '#0c3a52' });
      if (c.r === 'legendary' || c.r === 'epic') for (let k = 0; k < 3; k++) drawSparkle(ctx, x + 6 + ((k * 37 + age * 30) % w), y - 2 + ((k * 13) % (h + 4)), 2, 0.5 + 0.5 * Math.sin(age * 8 + k), '#ffffff');
      py = below ? y + h + 3 : y - h - 3;
    }
    ctx.globalAlpha = 1;
  }
}

function speechBubble(ctx, cx, cy, w, h, color) {
  const x = cx - w / 2, y = cy - h / 2;
  ctx.save();
  rrect(ctx, x, y, w, h, 6);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#dff4ff');
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 4, y + h - 1); ctx.lineTo(x - 2, y + h + 4); ctx.lineTo(x + 9, y + h - 1); ctx.closePath(); ctx.fill();
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(Math.round(x + 4), Math.round(y + 2), Math.round(w - 8), 2);
  ctx.restore();
}


// Small clover pill by the player's own boat while the party buff is active (above it, or under the hull).
export function drawPartyBadge(ctx, net, luck, boat) {
  if (!(luck > 1) || !boat?.visible) return;
  const b = boat.bounds?.();
  const head = boat.anchorsWorld?.head?.[1];
  const S = toScreen(net.game); // [phase4:zoom] screen space
  const top0 = Math.min(b ? b.y : boat.y - 50, Number.isFinite(head) ? head - 14 : Infinity);
  const [x0, sTop] = S(boat.x, top0), sBelow = S(boat.x, boat.y)[1];
  const top = sTop - 14;
  const x = Math.round(x0), y = Math.round(top < 2 ? sBelow + 10 : top);
  const txt = `PARTY +${Math.round((luck - 1) * 100)}%`;
  const w = measureText(txt, 'small') + 18;
  pill(ctx, x - w / 2, y, w, 11, { color: '#7ee04a', edge: 'rgba(255,255,255,0.95)', r: 5 });
  drawGlossOrb(ctx, x - w / 2 + 6, y + 5.5, 3, '#3fae2a');
  drawText(ctx, txt, x - w / 2 + 11, y + 3, { font: 'small', color: '#ffffff', outline: '#1c5a0e' });
}
