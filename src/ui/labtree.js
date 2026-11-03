// The Lab's radial research tree (OWNER: Lab agent): a bright sky "dome" with the root as a sun in the middle,
// white arcs for the tier rings, glossy eco-globe nodes and glass tubes of bubbling water between them.
// Smooth pan (drag / arrows) and zoom (wheel / +-), click a node to select it; the card shows costs and actions.
import { clamp, damp, TAU, hash1, lerp } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { drawAeroGlow, drawAeroBubble, drawSparkle, drawAeroLabel, drawAeroBar, fmtAero, drawAeroCoin } from './aero.js';
import {
  LAB_NODES, LAB_BY_ID, LAB_CHILDREN, LAB_RING, BRANCHES, BRANCH_ORDER, ROOT_ID, EFFECT_INFO, BOAT_NAMES, TANK_NAMES, OCEAN_NAMES, BOAT_ORDER,
  ensureLab, labStatus, labCheck, labTime, labProgress, labRemaining, instantCost, startResearch, instantFinish, cancelResearch,
  fmtEffect, fmtTime, labSlots,
} from '../game/lab.js';
import { ROD_BY_ID } from '../game/rods.js';
import { RECIPE_BY_ID } from '../build/crafting.js';
import { ecoOrb, drawTube, drawSplash, drawRays, roundRectPath } from './labart.js';
import { icon, anyIcon, glassCard, pill, costTiles, costTilesHeight, pedestal, chip, orbIcon, INK, INK_SOFT, OK, BAD } from './labkit.js';

const MAX_R = LAB_RING(9) + 40;
const FEATURE_ICON = { isp2: 'wifi', isp3: 'wifi', isp4: 'wifi', isp5: 'wifi', isp6: 'wifi', multiplayer: 'people', autocollect: 'magnet', eng1: 'gear', eng2: 'gear', aquarium: 'tank:jar' };
const FEATURE_NAME = { isp2: 'ISDN internet', isp3: 'DSL internet', isp4: 'Cable internet', isp5: 'Fibre internet', isp6: 'Quantum internet', multiplayer: 'Multiplayer', autocollect: 'Auto-collect', eng1: 'Building level 2', eng2: 'Building level 3' };

export function unlockInfo(u) {
  switch (u.kind) {
    case 'rod': return { key: 'rod:' + u.id, name: ROD_BY_ID[u.id]?.name || u.id };
    case 'boat': return { key: 'boat:' + u.id, name: BOAT_NAMES[u.id] || u.id };
    case 'tank': return { key: 'tank:' + u.id, name: TANK_NAMES[u.id] || u.id };
    case 'biome': return { key: 'biome:' + u.id, name: OCEAN_NAMES[u.id] || u.id };
    case 'recipe': return { key: RECIPE_BY_ID[u.id]?.icon || 'hammer', name: 'Recipe: ' + (RECIPE_BY_ID[u.id]?.name || u.id) };
    case 'bait': return { key: 'bait:' + u.id, name: 'AppSea bait: ' + u.id };
    case 'feature': return { key: FEATURE_ICON[u.id] || 'sparkle', name: FEATURE_NAME[u.id] || u.id };
    default: return { key: 'star', name: u.id };
  }
}

// polar-interpolated tube path (tree units) from a parent to a child node
function edgePath(a, b) {
  if (a.id === ROOT_ID) return [[0, 0], [b.pos[0] * 0.5, b.pos[1] * 0.5], b.pos];
  let da = b.ang - a.ang;
  while (da > Math.PI) da -= TAU;
  while (da < -Math.PI) da += TAU;
  const out = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const k = i / n, ang = a.ang + da * k, rad = lerp(a.rad, b.rad, k);
    out.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
  }
  return out;
}
const EDGES = [];
for (const nd of LAB_NODES) for (const r of nd.req) if (LAB_BY_ID[r]) EDGES.push({ from: r, to: nd.id, pts: edgePath(LAB_BY_ID[r], nd), branch: nd.branch });

export class LabTree {
  constructor(panel) {
    this.p = panel;
    this.cam = { x: 0, y: 0, z: 0.9 };
    this.camT = { x: 0, y: 0, z: 0.9 };
    this.sel = null;
    this.hover = null;
    this.drag = null;
    this.fx = [];
    this.prev = null;
    this.t = 0;
  }

  get game() { return this.p.game; }

  focus(id, z = null, snap = false) {
    const nd = LAB_BY_ID[id];
    if (!nd) return;
    this.sel = id;
    this.camT.x = nd.pos[0]; this.camT.y = nd.pos[1];
    if (z) this.camT.z = z;
    if (snap) Object.assign(this.cam, this.camT);
  }

  fitZoom(view) { return clamp(Math.min(view.w, view.h) / (MAX_R * 2), 0.3, 1); }

  toScreen(view, x, y) { const z = this.cam.z; return [view.x + view.w / 2 + (x - this.cam.x) * z, view.y + view.h / 2 + (y - this.cam.y) * z]; }
  toTree(view, sx, sy) { const z = this.cam.z; return [this.cam.x + (sx - view.x - view.w / 2) / z, this.cam.y + (sy - view.y - view.h / 2) / z]; }

  zoomAt(view, sx, sy, z) {
    z = clamp(z, this.fitZoom(view) * 0.9, 2.2);
    const [tx, ty] = this.toTree(view, sx, sy);
    // keep the tree point under the cursor fixed at the target zoom
    this.camT.z = z;
    this.camT.x = tx - (sx - view.x - view.w / 2) / z;
    this.camT.y = ty - (sy - view.y - view.h / 2) / z;
  }

  // ------------------------------------------------------------------ input + camera
  update(ui, view, dt) {
    const inp = ui.inp, g = this.game;
    this.t += dt;
    const inside = inp.x >= view.x && inp.y >= view.y && inp.x < view.x + view.w && inp.y < view.y + view.h;
    // zoom
    if (inside && inp.wheel) { this.zoomAt(view, inp.x, inp.y, this.camT.z * Math.pow(0.87, inp.wheel)); inp.wheel = 0; }
    if (inp.keyPressed('+') || inp.keyPressed('=')) this.zoomAt(view, view.x + view.w / 2, view.y + view.h / 2, this.camT.z * 1.25);
    if (inp.keyPressed('-')) this.zoomAt(view, view.x + view.w / 2, view.y + view.h / 2, this.camT.z / 1.25);
    const kx = (inp.key('ArrowRight') ? 1 : 0) - (inp.key('ArrowLeft') ? 1 : 0), ky = (inp.key('ArrowDown') ? 1 : 0) - (inp.key('ArrowUp') ? 1 : 0);
    if (kx || ky) { this.camT.x += (kx * 320 * dt) / this.cam.z; this.camT.y += (ky * 320 * dt) / this.cam.z; }
    // hover
    this.hover = inside && !this.drag?.moved ? this.pick(view, inp.x, inp.y) : null;
    // drag to pan, click to select
    const zr = this.zoomRect(view);
    const onButtons = (inp.x >= zr.x && inp.y >= zr.y && inp.x < zr.x + zr.w && inp.y < zr.y + zr.h) || this.overLabel(view, inp.x, inp.y);
    if (inside && inp.pressed && !onButtons) {
      inp.pressed = false;
      this.drag = { x: inp.x, y: inp.y, cx: this.camT.x, cy: this.camT.y, moved: false, vx: 0, vy: 0, lx: inp.x, ly: inp.y };
    }
    if (this.drag) {
      const d = this.drag;
      if (inp.down) {
        if (Math.hypot(inp.x - d.x, inp.y - d.y) > 3) d.moved = true;
        if (d.moved) {
          this.camT.x = this.cam.x = d.cx - (inp.x - d.x) / this.cam.z;
          this.camT.y = this.cam.y = d.cy - (inp.y - d.y) / this.cam.z;
          d.vx = (inp.x - d.lx) / Math.max(dt, 1e-3); d.vy = (inp.y - d.ly) / Math.max(dt, 1e-3);
          d.lx = inp.x; d.ly = inp.y;
        }
      } else {
        if (!d.moved) {
          const hit = this.pick(view, inp.x, inp.y);
          if (hit) {
            this.sel = hit;
            g.audio.play('ui_click', { pitch: 1.1 });
          } else this.sel = null;
        } else {
          // fling
          this.camT.x -= (d.vx * 0.12) / this.cam.z; this.camT.y -= (d.vy * 0.12) / this.cam.z;
        }
        this.drag = null;
      }
    }
    if (inp.dblclick && this.hover && inside) { inp.dblclick = false; this.p.research(this.hover); }
    // camera
    const lim = MAX_R;
    this.camT.x = clamp(this.camT.x, -lim, lim); this.camT.y = clamp(this.camT.y, -lim, lim);
    if (!this.drag?.moved) {
      this.cam.x = damp(this.cam.x, this.camT.x, 10, dt);
      this.cam.y = damp(this.cam.y, this.camT.y, 10, dt);
    }
    this.cam.z = Math.exp(damp(Math.log(this.cam.z), Math.log(this.camT.z), 12, dt));
    // status changes -> splashes
    const st = g.state;
    const now = {};
    for (const nd of LAB_NODES) now[nd.id] = labStatus(st, nd.id);
    if (this.prev) {
      for (const nd of LAB_NODES) {
        const a = this.prev[nd.id], b = now[nd.id];
        if (a === b) continue;
        if (b === 'done') { this.fx.push({ kind: 'splash', id: nd.id, t: 0, dur: 1.1 }); this.fx.push({ kind: 'burst', id: nd.id, t: 0, dur: 1.4 }); g.audio.play('bubbles', { vol: 0.6 }); }
        else if (b === 'researching') { this.fx.push({ kind: 'splash', id: nd.id, t: 0, dur: 0.8 }); g.audio.play('bubbles', { vol: 0.4, pitch: 1.3 }); }
      }
    }
    this.prev = now;
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.dur);
  }

  pick(view, sx, sy) {
    const z = this.cam.z, r = clamp(11 * z, 5, 18) + 3;
    let best = null, bd = 1e9;
    for (const nd of LAB_NODES) {
      const [x, y] = this.toScreen(view, nd.pos[0], nd.pos[1]);
      const rr = nd.id === ROOT_ID ? r * 1.6 : r;
      const d = Math.hypot(sx - x, sy - y);
      if (d < rr && d < bd) { bd = d; best = nd.id; }
    }
    return best;
  }

  // ------------------------------------------------------------------ drawing
  drawBackground(ctx, view) {
    const t = this.t, z = this.cam.z;
    const sky = ctx.createLinearGradient(0, view.y, 0, view.y + view.h);
    sky.addColorStop(0, '#1468dc'); sky.addColorStop(0.5, '#43a8f6'); sky.addColorStop(1, '#bfeaff');
    ctx.fillStyle = sky; ctx.fillRect(view.x, view.y, view.w, view.h);
    const [rx, ry] = this.toScreen(view, 0, 0);
    // sun glow around the root + slow rays
    drawAeroGlow(ctx, rx, ry, Math.max(60, 150 * z), '#ffffff', 0.55);
    drawRays(ctx, rx, ry, Math.max(view.w, view.h) * 0.9, t, 0.14, 18);
    // clouds (gentle parallax)
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const px = view.x + ((hash1(i, 1) * view.w * 1.6 + t * (4 + hash1(i, 2) * 5) - (this.cam.x * z) * 0.25) % (view.w * 1.6) + view.w * 1.6) % (view.w * 1.6) - view.w * 0.3;
      const py = view.y + hash1(i, 3) * view.h * 0.8 - this.cam.y * z * 0.25 % view.h;
      const s = 10 + hash1(i, 4) * 16;
      ctx.fillStyle = rgba('#ffffff', 0.35);
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(px + (k - 1.5) * s * 0.7, py + Math.abs(k - 1.5) * s * 0.15, s * (0.6 - Math.abs(k - 1.5) * 0.08), s * 0.36, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    // white arcs: the tier rings
    ctx.save();
    ctx.strokeStyle = rgba('#ffffff', 0.45);
    ctx.lineWidth = 1;
    for (let tier = 1; tier <= 9; tier++) {
      const R = LAB_RING(tier) * z;
      ctx.setLineDash(tier % 3 === 0 ? [] : [2, 4]);
      ctx.beginPath(); ctx.arc(rx, ry, R, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
    // curved green horizon at the bottom of the dome
    const gy = view.y + view.h - 26, R = view.w * 2.2;
    ctx.save();
    const gg = ctx.createLinearGradient(0, gy - 6, 0, view.y + view.h);
    gg.addColorStop(0, rgba('#b8f25a', 0.85)); gg.addColorStop(0.3, rgba('#6fd236', 0.8)); gg.addColorStop(1, rgba('#2f9a1e', 0.85));
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(view.x + view.w * 0.45, gy + R, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba('#efffc0', 0.9); ctx.beginPath(); ctx.arc(view.x + view.w * 0.45, gy + R, R - 0.5, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3); ctx.stroke();
    ctx.restore();
    // rising bubbles
    for (let i = 0; i < 14; i++) {
      const k = (t * (0.04 + hash1(i, 6) * 0.05) + hash1(i, 7)) % 1;
      const bx = view.x + hash1(i, 8) * view.w + Math.sin(t + i) * 4;
      const by = view.y + view.h - k * (view.h + 20);
      drawAeroBubble(ctx, bx, by, 1.5 + hash1(i, 9) * 3, 0.8);
    }
  }

  // Branch name pills at the tips of the star; when a tip is off screen the pill waits at the edge of the dome
  // (pointing the way) and a click glides the camera there.
  drawBranchLabels(ctx, ui, view) {
    for (const b of BRANCH_ORDER) {
      const B = BRANCHES[b];
      const a = (B.angle * Math.PI) / 180;
      const R = LAB_RING(9) + 30;
      let [x, y] = this.toScreen(view, Math.cos(a) * R, Math.sin(a) * R);
      const ic = icon(B.icon, 14);
      const tw = measureText(B.name);
      const w = tw + (ic ? ic.width + 14 : 12), h = 16;
      const mx = w / 2 + 6, my = h / 2 + 6;
      const off = x < view.x + mx || x > view.x + view.w - mx || y < view.y + my || y > view.y + view.h - my - 30;
      x = clamp(x, view.x + mx, view.x + view.w - mx);
      y = clamp(y, view.y + my, view.y + view.h - my - 30);
      const lx = Math.round(x - w / 2), ly = Math.round(y - h / 2);
      const rr = { x: lx, y: ly, w, h };
      const hov = ui.hover(rr);
      ctx.globalAlpha = off && !hov ? 0.8 : 1;
      ctx.fillStyle = rgba('#ffffff', 0.92); roundRectPath(ctx, lx, ly, w, h, 8); ctx.fill();
      ctx.strokeStyle = B.color; ctx.lineWidth = hov ? 2 : 1.5; roundRectPath(ctx, lx + 0.5, ly + 0.5, w - 1, h - 1, 8); ctx.stroke();
      if (ic) ctx.drawImage(ic, lx + 4, Math.round(ly + (h - ic.height) / 2));
      drawText(ctx, B.name, lx + (ic ? ic.width + 8 : 6), ly + 5, { color: shade(B.color, -0.45) });
      ctx.globalAlpha = 1;
      if (ui.clicked(rr)) {
        const k = LAB_RING(4);
        this.camT.x = Math.cos(a) * k; this.camT.y = Math.sin(a) * k;
        this.camT.z = Math.max(this.camT.z, 0.8);
        this.game.audio.play('ui_click');
      }
    }
  }

  draw(ctx, ui, view, dt) {
    const g = this.game, st = g.state, t = this.t, z = this.cam.z;
    const L = ensureLab(st);
    ctx.save();
    roundRectPath(ctx, view.x, view.y, view.w, view.h, 10); ctx.clip();
    this.drawBackground(ctx, view);
    const S = (nd) => this.toScreen(view, nd.pos[0], nd.pos[1]);
    const status = this.prev || {};
    const inView = (x, y, m = 30) => x > view.x - m && y > view.y - m && x < view.x + view.w + m && y < view.y + view.h + m;
    // glow paths toward the selection's requirements
    const path = new Set();
    if (this.sel) { const walk = (id) => { if (path.has(id)) return; path.add(id); for (const r of LAB_BY_ID[id]?.req || []) walk(r); }; walk(this.sel); }
    // tubes
    const tw = clamp(5.5 * z, 3, 9);
    for (const e of EDGES) {
      const a = LAB_BY_ID[e.from], b = LAB_BY_ID[e.to];
      const [ax, ay] = S(a), [bx, by] = S(b);
      if (!inView(ax, ay, 80) && !inView(bx, by, 80)) continue;
      const sa = status[e.from], sb = status[e.to];
      const pts = e.pts.map(([x, y]) => this.toScreen(view, x, y));
      const col = mix(BRANCHES[e.branch]?.color || '#35c8ff', '#1fb8ff', 0.45);
      let water = 0, alpha = 0.7;
      if (sa === 'done' && sb === 'done') { water = 1; alpha = 1; }
      else if (sa === 'done' && sb === 'researching') { water = 0.15 + 0.85 * labProgress(st, e.to); alpha = 1; }
      else if (sa === 'done') { water = 0.1 + 0.05 * Math.sin(t * 3); alpha = 0.95; }
      if (path.has(e.to) && path.has(e.from) && sb !== 'done') alpha = 1;
      drawTube(ctx, pts, { t, water, color: col, width: tw, alpha, flow: 30, bubbles: water >= 1 ? undefined : 2 });
    }
    // nodes
    const r0 = clamp(11 * z, 5, 18);
    let hoverPos = null;
    for (const nd of LAB_NODES) {
      const [x, y] = S(nd);
      if (!inView(x, y)) continue;
      const s = status[nd.id] || 'locked';
      const root = nd.id === ROOT_ID;
      const hov = this.hover === nd.id, sel = this.sel === nd.id;
      let r = root ? r0 * 1.7 : r0;
      if (hov) r *= 1.12;
      const col = BRANCHES[nd.branch]?.color || '#ffe27a';
      const bob = s === 'available' ? Math.sin(t * 3 + nd.pos[0] * 0.05) * 1.2 : 0;
      const yy = y + bob;
      if (root) drawRays(ctx, x, y, r * 2.4, -t * 2, 0.35, 12);
      if (s === 'available') drawAeroGlow(ctx, x, yy, r * 2.1, mix(col, '#ffffff', 0.4), 0.45 + 0.2 * Math.sin(t * 4 + nd.pos[1]));
      if (s === 'researching') drawAeroGlow(ctx, x, yy, r * 2.3, '#c8ff7a', 0.55 + 0.25 * Math.sin(t * 6));
      if (sel || path.has(nd.id) && this.sel && s !== 'done') drawAeroGlow(ctx, x, yy, r * 2.4, '#ffffff', sel ? 0.75 : 0.35);
      const look = root ? 'sun' : s === 'done' ? 'done' : s === 'locked' ? 'locked' : 'open';
      const orb = ecoOrb(r, col, look);
      ctx.drawImage(orb, Math.round(x - orb.width / 2), Math.round(yy - orb.height / 2));
      const ic = icon(nd.icon, r * (root ? 1.1 : 1.35));
      if (ic) {
        ctx.globalAlpha = s === 'locked' ? 0.45 : 1;
        ctx.drawImage(ic, Math.round(x - ic.width / 2), Math.round(yy - ic.height / 2));
        ctx.globalAlpha = 1;
      }
      if (s === 'researching') {
        const k = labProgress(st, nd.id);
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(x, yy, r + 3, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#5fd23a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, yy, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
        for (let i = 0; i < 3; i++) { const q = (t * 0.8 + i / 3) % 1; drawAeroBubble(ctx, x + Math.sin(t * 3 + i * 2) * r * 0.6, yy - r - q * r * 1.6, 1.5 + q * 1.5, 1 - q); }
      }
      if (s === 'done' && !root && r >= 7) {
        const ck = getUiIcon('check');
        const bx = Math.round(x + r * 0.62), by = Math.round(yy + r * 0.62);
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, 4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4cc83a'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, TAU); ctx.fill();
        if (ck && r >= 10) ctx.drawImage(ck, bx - Math.floor(ck.width / 2), by - Math.floor(ck.height / 2));
      }
      if (s === 'available' && r >= 7 && labCheck(st, nd, g.stats).paid) {
        const ph = (t * 0.7 + nd.pos[0] * 0.01) % 1;
        if (ph < 0.25) drawSparkle(ctx, x + r * 0.5, yy - r * 0.6, 2, 1 - ph * 4);
      }
      if (sel) {
        ctx.save();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]); ctx.lineDashOffset = -t * 12;
        ctx.beginPath(); ctx.arc(x, yy, r + 6, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      if (hov) hoverPos = [x, yy - r - 6, nd];
    }
    // fx
    for (const f of this.fx) {
      const nd = LAB_BY_ID[f.id];
      if (!nd) continue;
      const [x, y] = S(nd);
      const k = f.t / f.dur;
      if (f.kind === 'splash') drawSplash(ctx, x, y, k, mix(BRANCHES[nd.branch]?.color || '#5fd8ff', '#5fd8ff', 0.5));
      else if (f.kind === 'burst') {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + hash1(i, 2), d = 6 + k * 36;
          drawSparkle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, 2, 1 - k, i % 2 ? '#ffffff' : '#fff6a0');
        }
        drawAeroGlow(ctx, x, y, 20 + k * 30, '#ffffff', 0.6 * (1 - k));
      }
    }
    this.drawBranchLabels(ctx, ui, view);
    if (hoverPos) drawAeroLabel(ctx, hoverPos[2].name, hoverPos[0], hoverPos[1] - 12, { align: 'center', tone: 'white' });
    ctx.restore();
    // inner frame shading
    ctx.save();
    ctx.strokeStyle = rgba('#ffffff', 0.6); ctx.lineWidth = 2;
    roundRectPath(ctx, view.x + 1, view.y + 1, view.w - 2, view.h - 2, 10); ctx.stroke();
    ctx.restore();
    this.drawZoomButtons(ctx, ui, view);
    void L; void dt;
  }

  overLabel(view, sx, sy) {
    for (const b of BRANCH_ORDER) {
      const B = BRANCHES[b], a = (B.angle * Math.PI) / 180, R = LAB_RING(9) + 30;
      let [x, y] = this.toScreen(view, Math.cos(a) * R, Math.sin(a) * R);
      const w = measureText(B.name) + 30, h = 16;
      x = clamp(x, view.x + w / 2 + 6, view.x + view.w - w / 2 - 6);
      y = clamp(y, view.y + h / 2 + 6, view.y + view.h - h / 2 - 36);
      if (Math.abs(sx - x) < w / 2 && Math.abs(sy - y) < h / 2) return true;
    }
    return false;
  }

  zoomRect(view) { return { x: view.x + 8, y: view.y + view.h - 30, w: 72, h: 22 }; }

  drawZoomButtons(ctx, ui, view) {
    const x = view.x + 8, y = view.y + view.h - 30;
    const b = (i, ic, fn, tip) => { if (pill(ui, ctx, x + i * 24, y, 22, 22, '', { icon: getUiIcon(ic), tone: 'glass', tip })) fn(); };
    b(0, 'plus', () => this.zoomAt(view, view.x + view.w / 2, view.y + view.h / 2, this.camT.z * 1.3), 'Zoom in');
    b(1, 'minus', () => this.zoomAt(view, view.x + view.w / 2, view.y + view.h / 2, this.camT.z / 1.3), 'Zoom out');
    b(2, 'home', () => { this.camT.x = 0; this.camT.y = 0; this.camT.z = this.fitZoom(view); }, 'See the whole tree');
  }
}

// ------------------------------------------------------------------ the detail card for a tree node
export function drawNodeCard(ctx, ui, panel, r, id) {
  const g = panel.game, st = g.state, t = panel.t;
  glassCard(ctx, r.x, r.y, r.w, r.h);
  const nd = LAB_BY_ID[id];
  const cx = r.x + r.w / 2;
  const L = ensureLab(st);
  if (!nd || id === ROOT_ID) return drawRootCard(ctx, ui, panel, r);
  const status = labStatus(st, id);
  const col = BRANCHES[nd.branch]?.color || '#35c8ff';
  // hero: the node's eco orb floating over a pedestal
  const oy = r.y + 40;
  pedestal(ctx, cx, oy, 64, t, mix(col, '#ffffff', 0.4));
  if (status === 'done') drawRays(ctx, cx, oy, 54, t, 0.45, 12);
  drawAeroGlow(ctx, cx, oy, 40, mix(col, '#ffffff', 0.5), 0.5);
  orbIcon(ctx, nd.icon, cx, oy + Math.sin(t * 2) * 1.5, 24, col, status === 'locked' ? 'locked' : status === 'done' ? 'done' : 'open', status === 'locked' ? 0.6 : 1);
  let y = oy + 36;
  for (const l of wrapText(nd.name, r.w - 16).slice(0, 2)) { drawText(ctx, l, cx, y, { align: 'center', color: INK, shadow: '#ffffff' }); y += 11; }
  drawText(ctx, (BRANCHES[nd.branch]?.name || '').toUpperCase() + '  ' + 'I'.repeat(Math.min(9, nd.tier)), cx, y, { font: 'small', align: 'center', color: shade(col, -0.35) });
  y += 10;
  for (const l of wrapText(nd.desc, r.w - 20).slice(0, 2)) { drawText(ctx, l, cx, y, { align: 'center', color: INK_SOFT }); y += 11; }
  y += 4;
  // effects (centred chips)
  const effects = Object.entries(nd.effect);
  if (effects.length) {
    const chips = effects.map(([k, v]) => ({ k, txt: fmtEffect(k, v), info: EFFECT_INFO[k] }));
    const rows = [[]];
    let rw = 0;
    for (const c of chips) {
      const w = measureText(c.txt, 'small') + 21;
      if (rw + w > r.w - 16 && rows[rows.length - 1].length) { rows.push([]); rw = 0; }
      rows[rows.length - 1].push(c);
      rw += w + 3;
    }
    for (const rowc of rows) {
      const total = rowc.reduce((a, c) => a + measureText(c.txt, 'small') + 21 + 3, -3);
      let x = Math.round(cx - total / 2);
      for (const c of rowc) {
        const ww = chip(ctx, x, y, anyIcon(c.info?.[0] || 'star', 10), c.txt, { bg: rgba('#effff0', 0.95), edge: rgba('#7ad08a', 0.9), color: '#1d7a32' });
        if (ui.hover({ x, y, w: ww, h: 14 })) ui.tip = `${c.info?.[1] || c.k} ${c.txt}`;
        x += ww + 3;
      }
      y += 17;
    }
  }
  // unlocks (centred icon tiles)
  const unl = nd.unlock.filter((u) => !(u.kind === 'bait' && nd.unlock.some((q) => q.kind === 'recipe' && q.id === 'bait_' + u.id)));
  if (unl.length) {
    const sz = unl.length > 4 ? 20 : 26, per = Math.floor((r.w - 16) / (sz + 3));
    const show = unl.slice(0, per * 2);
    show.forEach((u, i) => {
      const info = unlockInfo(u);
      const inRow = Math.min(per, show.length - Math.floor(i / per) * per);
      const ux = Math.round(cx - (inRow * (sz + 3) - 3) / 2) + (i % per) * (sz + 3), uy = y + Math.floor(i / per) * (sz + 3);
      ctx.fillStyle = rgba('#ffffff', 0.95); roundRectPath(ctx, ux, uy, sz, sz, 6); ctx.fill();
      ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1; roundRectPath(ctx, ux + 0.5, uy + 0.5, sz - 1, sz - 1, 6); ctx.stroke();
      const ic = icon(info.key, sz - 4);
      if (ic) ctx.drawImage(ic, Math.round(ux + (sz - ic.width) / 2), Math.round(uy + (sz - ic.height) / 2));
      if (ui.hover({ x: ux, y: uy, w: sz, h: sz })) ui.tip = info.name;
    });
    y += Math.ceil(show.length / per) * (sz + 3) + 3;
  }
  const bottom = r.y + r.h - 34;
  // what this opens up next (small orbs, click to jump)
  const kids = (LAB_CHILDREN[id] || []).filter((k) => LAB_BY_ID[k]);
  if (kids.length && y < bottom - 110) {
    const ky = y + 10;
    const ar = getUiIcon('arrow_d');
    if (ar) ctx.drawImage(ar, Math.round(cx - ar.width / 2), y - 2);
    kids.slice(0, 5).forEach((k, i, arr) => {
      const kn = LAB_BY_ID[k];
      const kx = Math.round(cx - ((arr.length - 1) * 26) / 2 + i * 26);
      orbIcon(ctx, kn.icon, kx, ky + 10, 10, BRANCHES[kn.branch]?.color || '#35c8ff', labStatus(st, k) === 'done' ? 'done' : labStatus(st, k) === 'locked' ? 'locked' : 'open', labStatus(st, k) === 'locked' ? 0.6 : 1);
      const rr = { x: kx - 11, y: ky - 1, w: 22, h: 22 };
      if (ui.hover(rr)) ui.tip = 'Next: ' + kn.name;
      if (ui.clicked(rr)) panel.tree.focus(k);
    });
  }
  if (status === 'done') {
    drawAeroLabel(ctx, 'Researched', cx, bottom + 8, { align: 'center', tone: 'green' });
    const ck = getUiIcon('check');
    if (ck) ctx.drawImage(ck, Math.round(cx - measureText('Researched') / 2 - 14), bottom + 10);
    const go = (label, ic, fn) => { if (pill(ui, ctx, r.x + 10, bottom - 24, r.w - 20, 20, label, { tone: 'aqua', font: 'small', icon: ic })) fn(); };
    if (nd.unlock.some((u) => u.kind === 'rod')) go('Rod rack', icon('rod:glass', 14), () => { panel.rodSel = nd.unlock.find((u) => u.kind === 'rod').id; panel.setTab('rods'); });
    else if (nd.unlock.some((u) => u.kind === 'recipe')) go('Craft it', icon('hammer', 14), () => panel.setTab('craft', { recipe: nd.unlock.find((u) => u.kind === 'recipe')?.id }));
    else if (nd.unlock.some((u) => u.kind === 'boat')) go('Boat dock', icon('boat:skiff', 14), () => { panel.boatSel = BOAT_ORDER.indexOf(nd.unlock.find((u) => u.kind === 'boat').id); panel.setTab('boats'); });
    else if (nd.unlock.some((u) => u.kind === 'biome')) go('Travel map', getUiIcon('map'), () => { ui.close(); ui.open('map'); });
    return;
  }
  if (status === 'researching') {
    const rem = labRemaining(st, id), k = labProgress(st, id);
    const ci = getUiIcon('clock');
    if (ci) ctx.drawImage(ci, r.x + 10, bottom - 34);
    drawText(ctx, fmtTime(rem), r.x + 24, bottom - 32, { color: INK });
    drawText(ctx, Math.floor(k * 100) + '%', r.x + r.w - 10, bottom - 32, { align: 'right', color: OK });
    drawAeroBar(ctx, r.x + 10, bottom - 20, r.w - 20, 10, k, { color: '#5fd23a' });
    const cost = instantCost(st, id);
    const bw = r.w - 56;
    if (pill(ui, ctx, r.x + 10, bottom + 4, bw, 24, `Finish ${fmtAero(cost)}`, { tone: 'orange', icon: getUiIcon('aero') || getUiIcon('coin'), disabled: (st.coins || 0) < cost, tip: 'Finish it right now for Aero' })) {
      if (instantFinish(g, id)) g.audio.play('ui_unlock');
    }
    if (pill(ui, ctx, r.x + r.w - 42, bottom + 4, 32, 24, '', { tone: 'glass', icon: getUiIcon('cross'), tip: 'Stop (refund)' })) cancelResearch(g, id);
    return;
  }
  // costs + time, anchored above the button
  const c = labCheck(st, nd, g.stats);
  const rows = [];
  if (c.aero.need) rows.push({ kind: 'aero', id: 'aero', ...c.aero });
  for (const it of c.items) rows.push({ kind: 'item', ...it });
  for (const f of c.fish) rows.push({ kind: 'fish', id: f.key, ...f });
  const ch = costTilesHeight(rows.length, r.w - 20);
  const cy0 = bottom - 6 - ch - 16;
  ctx.fillStyle = rgba('#dff4fc', 0.8); roundRectPath(ctx, r.x + 6, cy0 - 6, r.w - 12, ch + 30, 8); ctx.fill();
  costTiles(ctx, ui, rows, r.x + 10, cy0, r.w - 20);
  const ty = cy0 + ch + 5;
  const ci = getUiIcon('clock');
  if (ci) ctx.drawImage(ci, r.x + 10, ty);
  drawText(ctx, fmtTime(labTime(st, nd, g.stats)), r.x + 24, ty + 2, { color: INK });
  const slots = labSlots(st, g.stats), free = slots - L.slots.length;
  for (let i = 0; i < slots; i++) {
    const fx = r.x + r.w - 14 - i * 12;
    ctx.fillStyle = i < free ? '#5fd23a' : '#ffb03a';
    ctx.beginPath(); ctx.arc(fx, ty + 5, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba('#ffffff', 0.8); ctx.fillRect(fx - 2, ty + 2, 2, 1);
  }
  if (ui.hover({ x: r.x + r.w - 14 - slots * 12, y: ty, w: slots * 12 + 6, h: 10 })) ui.tip = `Lab benches: ${free} free of ${slots}`;
  if (status === 'locked') {
    const need = nd.req.filter((q) => labStatus(st, q) !== 'done');
    const lk = getUiIcon('lock');
    if (lk) ctx.drawImage(lk, r.x + 12, bottom + 10);
    need.forEach((q, i) => {
      const qx = r.x + 40 + i * 30, qy = bottom + 16;
      const qn = LAB_BY_ID[q];
      orbIcon(ctx, qn.icon, qx, qy, 11, BRANCHES[qn.branch]?.color || '#ffe27a', labStatus(st, q) === 'locked' ? 'locked' : 'open');
      const rr = { x: qx - 12, y: qy - 12, w: 24, h: 24 };
      if (ui.hover(rr)) ui.tip = 'Needs ' + qn.name;
      if (ui.clicked(rr)) panel.tree.focus(q);
    });
    return;
  }
  const busy = free <= 0;
  const label = busy ? 'Benches busy' : c.ok ? 'Research' : 'Need more';
  if (pill(ui, ctx, r.x + 10, bottom + 4, r.w - 20, 24, label, { tone: c.ok ? 'green' : 'glass', icon: getUiIcon(c.ok ? 'play' : busy ? 'clock' : 'cross'), disabled: !c.ok, sound: 'ui_unlock' })) panel.research(id);
}

function drawRootCard(ctx, ui, panel, r) {
  const g = panel.game, st = g.state, t = panel.t;
  const L = ensureLab(st);
  const cx = r.x + r.w / 2, oy = r.y + 36;
  drawRays(ctx, cx, oy, 50, t, 0.45, 14);
  orbIcon(ctx, 'beaker', cx, oy, 24, '#ffe27a', 'sun');
  let y = oy + 32;
  drawText(ctx, 'The Lab', cx, y, { align: 'center', color: INK, shadow: '#ffffff', scale: 1 });
  y += 14;
  const done = LAB_NODES.filter((n) => n.id !== ROOT_ID && L.done[n.id]).length, total = LAB_NODES.length - 1;
  drawAeroBar(ctx, r.x + 14, y, r.w - 28, 9, done / total, { color: '#5fd23a' });
  drawText(ctx, `${done}/${total}`, cx, y + 13, { align: 'center', font: 'small', color: INK_SOFT });
  y += 28;
  // research benches
  const slots = labSlots(st, g.stats);
  for (let i = 0; i < slots; i++) {
    const s = L.slots[i];
    const by = y + i * 34;
    ctx.fillStyle = rgba('#ffffff', 0.85); roundRectPath(ctx, r.x + 10, by, r.w - 20, 30, 8); ctx.fill();
    ctx.strokeStyle = rgba('#7fbedd', 0.9); ctx.lineWidth = 1; roundRectPath(ctx, r.x + 10.5, by + 0.5, r.w - 21, 29, 8); ctx.stroke();
    if (s && LAB_BY_ID[s.id]) {
      const nd = LAB_BY_ID[s.id];
      orbIcon(ctx, nd.icon, r.x + 26, by + 15, 11, BRANCHES[nd.branch]?.color || '#35c8ff', 'open');
      drawText(ctx, nd.name.length > 18 ? nd.name.slice(0, 17) + '..' : nd.name, r.x + 42, by + 6, { color: INK });
      drawAeroBar(ctx, r.x + 42, by + 18, r.w - 60, 6, labProgress(st, s.id), { color: '#5fd23a' });
      if (ui.hover({ x: r.x + 10, y: by, w: r.w - 20, h: 30 })) ui.tip = fmtTime(labRemaining(st, s.id)) + ' left';
      if (ui.clicked({ x: r.x + 10, y: by, w: r.w - 20, h: 30 })) panel.tree.focus(s.id);
    } else {
      const ic = icon('beaker', 16);
      if (ic) { ctx.globalAlpha = 0.5; ctx.drawImage(ic, r.x + 18, by + 7); ctx.globalAlpha = 1; }
      drawText(ctx, 'Free bench', r.x + 42, by + 11, { color: INK_SOFT });
    }
  }
  y += slots * 34 + 6;
  // ready-to-research suggestions
  const ready = LAB_NODES.filter((n) => labStatus(st, n.id) === 'available').sort((a, b) => (labCheck(st, b, g.stats).paid - labCheck(st, a, g.stats).paid) || a.tier - b.tier || a.cost.aero - b.cost.aero).slice(0, 8);
  const per = Math.floor((r.w - 16) / 28);
  ready.forEach((nd, i) => {
    const qx = r.x + 22 + (i % per) * 28, qy = y + 12 + Math.floor(i / per) * 28;
    if (qy > r.y + r.h - 16) return;
    const ok = labCheck(st, nd, g.stats).paid;
    if (ok) drawAeroGlow(ctx, qx, qy, 18, '#ffffff', 0.5 + 0.2 * Math.sin(t * 4 + i));
    orbIcon(ctx, nd.icon, qx, qy, 11, BRANCHES[nd.branch]?.color || '#35c8ff', 'open');
    const rr = { x: qx - 12, y: qy - 12, w: 24, h: 24 };
    if (ui.hover(rr)) ui.tip = nd.name;
    if (ui.clicked(rr)) panel.tree.focus(nd.id);
  });
}

export { MAX_R as LAB_MAX_R };
void OK; void BAD; void drawAeroCoin;
