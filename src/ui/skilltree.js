// Coral skill tree: the SKILLS graph grown as an illustrated branching coral inside a water window.
// Branches are rasterised once per ownership state as shaded tubes (z-buffered discs swept along curves),
// polyps are drawn live: owned ones open with waving tentacles, affordable buds pulse, locked ones are stone.
// open({highlight: id}) pulses a node (tutorial). Drag to pan when the tree does not fit the window.

import { clamp, clamp01, lerp, ease, hash1, hash2, bayer, TAU, formatCommas } from '../core/math.js';
import { ramp, shade, mix, rgba, pack, adjust } from '../core/color.js';
import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { makeCanvas, ctxOf, tinted } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawButton } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SKILLS, SKILL_BY_ID, BRANCHES, skillStatus } from '../game/skills.js';

const BRANCH_ORDER = ['hook', 'line', 'reel', 'mouse', 'bait', 'tank', 'breed', 'exp'];
const STONE = '#77748a';
const TRUNK = '#f2866e';
const MIN_TW = 600, MIN_TH = 340;
const NODE_R = 8;

const vivid = (hex) => adjust(hex, { sMul: 1.25, lMul: 0.92 });
const packRamp = (hex, c = 1) => ramp(hex, c).map((h) => pack(h));

// ---------------------------------------------------------------- layout

function descendants() {
  const kids = {};
  for (const s of SKILLS) if (s.req.length) (kids[s.req[0]] ||= []).push(s.id);
  const memo = {};
  const count = (id) => memo[id] ?? (memo[id] = 1 + (kids[id] || []).reduce((a, k) => a + count(k), 0));
  for (const s of SKILLS) count(s.id);
  return memo;
}
const DESC = descendants();
const radiusFor = (id) => clamp(1.7 + Math.sqrt(DESC[id] || 1) * 1.05, 2.4, 7.5);

function nodePos(sk, TW, TH) {
  return { x: Math.round(TW / 2 + sk.pos[0] * (TW / 2 - 34)), y: Math.round(TH - 50 - sk.pos[1] * (TH - 50 - 26)) };
}

// ---------------------------------------------------------------- coral rasteriser

function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

function buildEdges(TW, TH, state, found) {
  const edges = [];
  const pos = {};
  for (const s of SKILLS) pos[s.id] = nodePos(s, TW, TH);
  const colorFor = (sk) => {
    if (state.skills[sk.id]) return vivid(sk.id === 'hook1' ? TRUNK : BRANCHES[sk.branch].color);
    const st = skillStatus(sk, state, found).status;
    return st === 'available' ? mix(STONE, BRANCHES[sk.branch].color, 0.3) : STONE;
  };
  const root = pos.hook1;
  edges.push({ p0: { x: root.x - 2, y: TH - 8 }, p2: root, r0: 10, r1: 7.5, color: colorFor(SKILL_BY_ID.hook1), seed: 1, z: 0, nubs: 0 });
  SKILLS.forEach((s, i) => {
    s.req.forEach((rid, k) => {
      const p0 = pos[rid], p2 = pos[s.id];
      const r1 = k === 0 ? radiusFor(s.id) : 1.8;
      const r0 = k === 0 ? lerp(r1, radiusFor(rid), 0.6) : 2.2;
      edges.push({ p0, p2, r0, r1, color: colorFor(s), seed: i * 7 + k, z: k === 0 ? 0 : -3, nubs: k === 0 ? 2 : 0 });
    });
  });
  for (const e of edges) {
    const wob = (hash1(e.seed, 5) - 0.5) * 14;
    e.p1 = { x: lerp(e.p0.x, e.p2.x, 0.22) + wob * 0.4, y: lerp(e.p0.y, e.p2.y, 0.72) + wob * 0.2 };
  }
  return edges;
}

function rasterCoral(TW, TH, edges) {
  const N = TW * TH;
  const zb = new Float32Array(N).fill(-99);
  const vb = new Float32Array(N);
  const eb = new Int16Array(N).fill(-1);
  const ramps = edges.map((e) => packRamp(e.color, 1.05));
  const stamp = (cx, cy, r, ei, zBias) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(TW - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(TH - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d2 = (dx * dx + dy * dy) / r2;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const z = nz * r + zBias;
        const i = y * TW + x;
        if (z <= zb[i]) continue;
        zb[i] = z;
        const l = (-0.55 * dx - 0.66 * dy) / r + 0.5 * nz;
        vb[i] = 1.55 + l * 2.5;
        eb[i] = ei;
      }
    }
  };
  edges.forEach((e, ei) => {
    let L = 0, prev = e.p0;
    for (let k = 1; k <= 12; k++) { const p = bez(e.p0, e.p1, e.p2, k / 12); L += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
    const steps = Math.max(4, Math.ceil(L / 0.8));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const p = bez(e.p0, e.p1, e.p2, t);
      const r = lerp(e.r0, e.r1, t) * (1 + 0.1 * Math.sin(t * L * 0.42 + e.seed));
      stamp(p.x, p.y, Math.max(1.2, r), ei, e.z);
    }
    // stubby side nubs make the silhouette read as coral
    for (let n = 0; n < e.nubs && L > 34; n++) {
      if (hash1(e.seed, 30 + n) < 0.35) continue;
      const t = 0.3 + hash1(e.seed, 40 + n) * 0.45;
      const p = bez(e.p0, e.p1, e.p2, t), q = bez(e.p0, e.p1, e.p2, t + 0.02);
      const dx = q.x - p.x, dy = q.y - p.y, dl = Math.hypot(dx, dy) || 1;
      const side = hash1(e.seed, 50 + n) < 0.5 ? -1 : 1;
      let nx = (-dy / dl) * side, ny = (dx / dl) * side;
      if (ny > 0.3) { nx = -nx; ny = -ny; }
      const len = 4 + hash1(e.seed, 60 + n) * 5;
      const r0 = lerp(e.r0, e.r1, t) * 0.55;
      for (let s = 0; s <= len; s += 0.7) {
        const k = s / len;
        stamp(p.x + nx * s - ny * k * 1.5 * side, p.y + ny * s - k * 2, Math.max(1, lerp(r0, 1.2, k)), ei, -1.5);
      }
    }
  });
  const b = new PixelBuffer(TW, TH);
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const i = y * TW + x;
      const ei = eb[i];
      if (ei < 0) continue;
      const R = ramps[ei];
      let v = vb[i] + (bayer(x, y) - 0.5) * 0.85;
      // corallite pits and sparkle specks
      const h = hash2(x, y, 7);
      if (h > 0.955 && v > 1.2) v -= 1.6;
      else if (h < 0.025 && v > 2) v += 1;
      b.set(x, y, R[clamp(Math.floor(v), 0, 4)]);
    }
  }
  b.outline(selOut(0.8));
  return b.toCanvas();
}

// ---------------------------------------------------------------- background (water window, sand)

function buildBackground(TW, TH) {
  const b = new PixelBuffer(TW, TH);
  const top = [0x3a, 0x9c, 0xc0], bot = [0x0c, 0x30, 0x52];
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const k = clamp01(y / TH + (bayer(x, y) - 0.5) * 0.045);
      const q = Math.floor(k * 14) / 14;
      b.set(x, y, (255 << 24) | (Math.round(lerp(top[2], bot[2], q)) << 16) | (Math.round(lerp(top[1], bot[1], q)) << 8) | Math.round(lerp(top[0], bot[0], q)));
    }
  }
  // distant reef silhouettes
  const far = pack('#123f62'), far2 = pack('#164b70');
  for (let x = 0; x < TW; x++) {
    const h1 = 40 + Math.sin(x * 0.021) * 14 + Math.sin(x * 0.057 + 1) * 8 + (hash1(x >> 3, 3) - 0.5) * 6;
    for (let y = Math.round(TH - 26 - h1); y < TH; y++) b.set(x, y, far);
    const h2 = 22 + Math.sin(x * 0.033 + 2) * 9 + Math.sin(x * 0.11) * 3;
    for (let y = Math.round(TH - 22 - h2); y < TH; y++) b.set(x, y, far2);
  }
  // sand
  const sand = ['#8a6a4a', '#b8975e', '#d9bd84', '#ead39e', '#f6e6ba'].map((h) => pack(h));
  for (let x = 0; x < TW; x++) {
    const sy = Math.round(TH - 24 + Math.sin(x * 0.04) * 2 + Math.sin(x * 0.013 + 1) * 3 - Math.max(0, 22 - Math.abs(x - TW / 2) * 0.3) * 0.6);
    for (let y = sy; y < TH; y++) {
      const d = y - sy;
      let v = d === 0 ? 4 : d < 3 ? 3 : 2.4 - d * 0.04 + (hash2(x, y, 9) - 0.5) * 0.8 + (bayer(x, y) - 0.5) * 0.6;
      if (hash2(x >> 1, y >> 1, 4) > 0.97) v = 1;
      b.set(x, y, sand[clamp(Math.floor(v), 0, 4)]);
    }
    // seagrass tufts
    if (hash1(x, 11) > 0.93) {
      const h = 6 + Math.floor(hash1(x, 12) * 12), g = hash1(x, 13) > 0.5 ? '#3a8a5a' : '#2a6a4a';
      for (let k = 0; k < h; k++) b.set(Math.round(x + Math.sin(k * 0.5 + x) * 1.2), sy - k, pack(k > h - 3 ? shade(g, 0.4) : g));
    }
  }
  // pebbles
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(hash1(i, 20) * TW), y = TH - 14 + Math.floor(hash1(i, 21) * 10);
    const c = ['#9a8a7a', '#7a6a6a', '#c8b89a', '#6a7a8a'][i % 4];
    b.fillEllipse(x, y, 2 + hash1(i, 22) * 2, 1.4, pack(c));
    b.set(x - 1, y - 1, pack(shade(c, 0.5)));
  }
  return b.toCanvas();
}

// Sand mound in front of the trunk base.
function buildMound() {
  const w = 48, h = 9;
  const b = new PixelBuffer(w, h);
  const sand = ['#8a6a4a', '#b8975e', '#d9bd84', '#ead39e', '#f6e6ba'].map((c) => pack(c));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h) / h;
    if (dx * dx + dy * dy > 1) continue;
    const v = 2.4 - dx * 0.5 + (y < 2 ? 1.2 : 0) + (bayer(x, y) - 0.5) * 0.7 + (hash2(x, y, 3) > 0.92 ? -1 : 0);
    b.set(x, y, sand[clamp(Math.floor(v), 0, 4)]);
  }
  for (let i = 0; i < 4; i++) b.fillEllipse(8 + i * 11, 6 + (i % 2), 1.6, 1, pack(['#9a8a7a', '#c8b89a'][i % 2]));
  return b.toCanvas();
}

// ---------------------------------------------------------------- polyps

const spriteCache = new Map();
function polypSprite(color, status, hover) {
  const key = color + status + hover;
  let c = spriteCache.get(key);
  if (c) return c;
  const R = NODE_R + (hover ? 1 : 0);
  const D = R * 2 + 3;
  const b = new PixelBuffer(D, D);
  const cx = D / 2, cy = D / 2;
  const base = status === 'owned' ? vivid(color) : status === 'ready' ? mix(STONE, color, 0.55) : status === 'poor' ? mix('#4a4860', color, 0.18) : '#5e5c70';
  const Rm = packRamp(base, 1);
  const mouth = pack(status === 'owned' ? shade(base, -0.78) : status === 'locked' ? '#2e2c3c' : shade(base, -0.7));
  const mouthHi = pack(status === 'owned' ? shade(base, -0.55) : '#3e3c4e');
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const d = Math.hypot(dx, dy) / R;
    if (d > 1) continue;
    if (d < 0.66) { b.set(x, y, d > 0.56 && dy < 0 ? mouthHi : mouth); continue; }
    const nz = Math.sqrt(Math.max(0, 1 - d * d));
    const l = (-0.55 * dx - 0.7 * dy) / R + 0.45 * nz;
    const v = 2 + l * 2.4 + (bayer(x, y) - 0.5) * 0.8;
    b.set(x, y, Rm[clamp(Math.floor(v), 0, 4)]);
  }
  // rim pits like a coral polyp cup
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + 0.3;
    b.set(Math.floor(cx + Math.cos(a) * R * 0.84), Math.floor(cy + Math.sin(a) * R * 0.84), Rm[status === 'owned' ? 1 : 0]);
  }
  if (status === 'poor') b.outline(() => pack(color));
  else if (hover) b.outline(() => pack('#fff2b0'));
  else b.outline(selOut(0.85));
  c = b.toCanvas();
  spriteCache.set(key, c);
  return c;
}

function ringSprite(r, color) {
  const key = 'ring' + r + color;
  let c = spriteCache.get(key);
  if (c) return c;
  const D = r * 2 + 3;
  const b = new PixelBuffer(D, D);
  const p = pack(color);
  for (let a = 0; a < TAU; a += 0.5 / r) b.set(Math.floor(D / 2 + Math.cos(a) * r), Math.floor(D / 2 + Math.sin(a) * r), p);
  c = b.toCanvas();
  spriteCache.set(key, c);
  return c;
}

function discSprite(r, color) {
  const key = 'disc' + r + color;
  let c = spriteCache.get(key);
  if (c) return c;
  const D = r * 2 + 1;
  const b = new PixelBuffer(D, D);
  b.fillCircle(r + 0.5, r + 0.5, r, pack(color));
  c = b.toCanvas();
  spriteCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- panel

export class SkillTreePanel {
  constructor() {
    this.id = 'skills';
    this.modal = true;
    this.sound = 'ui_open';
    this.t = 0;
    this.fx = {};
    this.pan = null;
    this.highlight = null;
    this.mound = null;
  }

  open(data) {
    this.t = 0;
    this.fx = {};
    this.highlight = data?.highlight || null;
    this.pan = null;
    this.drag = null;
    this.hoverId = null;
    this.legendHover = null;
    this.bubbles = [];
    this.motes = null;
    this.sweep = null;
  }

  close() { this.drag = null; }

  layout(g) {
    const W = Math.min(g.screen.W - 16, 720), H = Math.min(g.screen.H - 26, 456);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) - 4, w: W, h: H };
    const vr = { x: r.x + 9, y: r.y + 31, w: W - 18, h: H - 31 - 27 };
    const TW = Math.max(vr.w, MIN_TW), TH = Math.max(vr.h, MIN_TH);
    return { r, vr, TW, TH };
  }

  coral(g, TW, TH) {
    const st = g.state, found = g.speciesFound();
    const key = `${TW}x${TH}|` + SKILLS.map((s) => (st.skills[s.id] ? 'o' : skillStatus(s, st, found).status[0])).join('');
    if (this.coralKey !== key) {
      this.coralKey = key;
      this.coralTW = TW; this.coralTH = TH;
      this.coralCanvas = rasterCoral(TW, TH, buildEdges(TW, TH, st, found));
    }
    if (this.bgKey !== `${TW}x${TH}`) { this.bgKey = `${TW}x${TH}`; this.bg = buildBackground(TW, TH); }
    if (!this.mound) this.mound = buildMound();
    return this.coralCanvas;
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    dt = Math.max(0, dt);
    this.t += dt;
    const t = this.t;
    const { r, vr, TW, TH } = this.layout(g);
    this.rect = r;
    const found = g.speciesFound();
    const coins = st.coins;
    const reduced = st.settings?.reducedMotion;

    // ------------------------------------------------ frame + header
    drawWood(ctx, r.x, r.y, r.w, r.h, { tone: 'dark' });
    drawText(ctx, 'CORAL SKILL TREE', r.x + r.w / 2, r.y + 9, { align: 'center', scale: 2, color: '#ffe8b8', shadow: '#1a0e06' });
    const owned = SKILLS.filter((s) => st.skills[s.id]).length;
    drawText(ctx, `${owned}/${SKILLS.length} grown`, r.x + 12, r.y + 13, { color: '#c8a878' });
    // coin purse
    const ctxt = formatCommas(Math.floor(g.ui?.coinShown ?? coins));
    const cw = measureText(ctxt) + 26;
    const cx0 = r.x + r.w - cw - 30;
    drawWood(ctx, cx0, r.y + 7, cw, 17, { tone: 'light', nails: false, round: 2, planks: 1 });
    ctx.drawImage(getUiIcon('coin'), cx0 + 5, r.y + 11);
    drawText(ctx, ctxt, cx0 + cw - 6, r.y + 12, { align: 'right', color: '#fff3dc', shadow: '#2a160a' });
    if (ui.button(ctx, r.x + r.w - 26, r.y + 7, 18, 17, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    // ------------------------------------------------ viewport + pan
    const canPan = TW > vr.w || TH > vr.h;
    const nodes = SKILLS.map((s) => ({ sk: s, ...nodePos(s, TW, TH) }));
    if (!this.pan) {
      const hl = this.highlight && nodes.find((n) => n.sk.id === this.highlight);
      this.pan = { x: (TW - vr.w) / 2, y: hl ? clamp(hl.y - vr.h * 0.6, 0, TH - vr.h) : TH - vr.h };
    }
    const coral = this.coral(g, TW, TH);
    const ox = Math.round(vr.x - this.pan.x), oy = Math.round(vr.y - this.pan.y);
    const toScreen = (n) => ({ x: ox + n.x, y: oy + n.y });

    // hover detection
    const inView = ui.hover(vr);
    let hov = null;
    if (inView && !this.drag?.moved) {
      let bd = 12;
      for (const n of nodes) {
        const s = toScreen(n);
        const d = Math.hypot(inp.x - s.x, inp.y - s.y);
        if (d < bd) { bd = d; hov = n; }
      }
    }
    if ((hov?.sk.id || null) !== this.hoverId) {
      this.hoverId = hov?.sk.id || null;
      if (hov) g.audio.play('ui_hover', { vol: 0.35, pitch: 0.9 + hov.sk.pos[1] * 0.4 });
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(vr.x, vr.y, vr.w, vr.h);
    ctx.clip();
    ctx.drawImage(this.bg, ox, oy);
    this.drawRays(ctx, vr, ox, oy, TW, TH, t);
    // coral (with the colour sweep after an unlock)
    const sw = this.sweep;
    if (sw && sw.prev) {
      sw.t += dt;
      const k = ease.outCubic(clamp01(sw.t / 0.9));
      ctx.drawImage(sw.prev, ox, oy);
      ctx.save();
      ctx.beginPath();
      ctx.arc(ox + sw.x, oy + sw.y, 4 + k * sw.reach, 0, TAU);
      ctx.clip();
      ctx.drawImage(coral, ox, oy);
      ctx.restore();
      if (k >= 1) this.sweep = null;
    } else {
      if (sw && !sw.prev) this.sweep = null;
      ctx.drawImage(coral, ox, oy);
    }
    const root = nodes.find((n) => n.sk.id === 'hook1');
    ctx.drawImage(this.mound, ox + root.x - 26, oy + TH - 16);
    this.drawMotes(ctx, vr, dt, t, reduced);

    // ------------------------------------------------ polyps
    const statusOf = (sk) => {
      if (st.skills[sk.id]) return 'owned';
      const s = skillStatus(sk, st, found);
      if (s.status === 'available') return coins >= sk.cost ? 'ready' : 'poor';
      return 'locked';
    };
    const legendB = this.legendHover;
    for (const n of nodes) {
      const s = toScreen(n);
      if (s.x < vr.x - 20 || s.x > vr.x + vr.w + 20 || s.y < vr.y - 20 || s.y > vr.y + vr.h + 20) continue;
      this.drawPolyp(ctx, n.sk, statusOf(n.sk), s.x, s.y, hov === n, t, dt, legendB && legendB !== n.sk.branch);
    }
    // tutorial highlight
    if (this.highlight && !st.skills[this.highlight]) {
      const n = nodes.find((q) => q.sk.id === this.highlight);
      if (n) {
        const s = toScreen(n);
        const pulse = (t * 1.6) % 1;
        ctx.globalAlpha = 1 - pulse;
        const rs = ringSprite(Math.round(NODE_R + 3 + pulse * 10), '#ffe27a');
        ctx.drawImage(rs, Math.round(s.x - rs.width / 2), Math.round(s.y - rs.height / 2));
        ctx.globalAlpha = 1;
        const bob = Math.round(Math.abs(Math.sin(t * 5)) * -4);
        const ar = getUiIcon('arrow_d');
        ctx.drawImage(ar, Math.round(s.x - ar.width / 2), s.y - NODE_R - 22 + bob);
        drawText(ctx, 'Click!', s.x, s.y - NODE_R - 32 + bob, { align: 'center', color: '#ffe27a', outline: '#1a0e06' });
      }
    }
    // glass glare
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba('#bfefff', 0.05);
    ctx.beginPath();
    ctx.moveTo(vr.x + 30, vr.y); ctx.lineTo(vr.x + 70, vr.y); ctx.lineTo(vr.x, vr.y + 70); ctx.lineTo(vr.x, vr.y + 30);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(vr.x + 84, vr.y); ctx.lineTo(vr.x + 92, vr.y); ctx.lineTo(vr.x, vr.y + 92); ctx.lineTo(vr.x, vr.y + 84);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    // inner glass border
    ctx.fillStyle = rgba('#0a1420', 0.9);
    ctx.fillRect(vr.x - 1, vr.y - 1, vr.w + 2, 1); ctx.fillRect(vr.x - 1, vr.y + vr.h, vr.w + 2, 1);
    ctx.fillRect(vr.x - 1, vr.y, 1, vr.h); ctx.fillRect(vr.x + vr.w, vr.y, 1, vr.h);
    ctx.fillStyle = rgba('#bfefff', 0.22);
    ctx.fillRect(vr.x, vr.y, vr.w, 1); ctx.fillRect(vr.x, vr.y, 1, vr.h);
    if (canPan) drawText(ctx, 'drag to look around', vr.x + vr.w - 6, vr.y + vr.h - 9, { font: 'small', align: 'right', color: rgba('#cfefff', 0.7) });

    // ------------------------------------------------ input: click node / drag pan
    if (hov && inp.pressed) {
      inp.pressed = false;
      this.clickNode(hov, toScreen(hov), statusOf(hov.sk), nodes, TW, TH);
    } else if (inView && inp.pressed && canPan) {
      inp.pressed = false;
      this.drag = { x: inp.x, y: inp.y, px: this.pan.x, py: this.pan.y, moved: false };
    }
    if (this.drag) {
      if (!inp.down) this.drag = null;
      else {
        const dx = inp.x - this.drag.x, dy = inp.y - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
        this.pan.x = this.drag.px - dx;
        this.pan.y = this.drag.py - dy;
      }
    }
    this.pan.x = clamp(this.pan.x, 0, Math.max(0, TW - vr.w));
    this.pan.y = clamp(this.pan.y, 0, Math.max(0, TH - vr.h));

    // ------------------------------------------------ legend
    this.drawLegend(ctx, ui, r, st);

    // ------------------------------------------------ hover card
    if (hov) this.drawCard(ctx, hov.sk, statusOf(hov.sk), toScreen(hov), r, st, found);
  }

  clickNode(n, s, status, nodes, TW, TH) {
    const g = this.game, sk = n.sk;
    if (status === 'owned') {
      this.fx[sk.id] = { kind: 'wiggle', t: 0 };
      g.audio.play('bubble', { vol: 0.5, pitch: 1.2 });
      g.particles.bubbles(s.x, s.y - 6, 4, { layer: 'ui' });
      return;
    }
    if (g.unlockSkill(sk.id)) {
      this.fx[sk.id] = { kind: 'bloom', t: 0 };
      const parent = sk.req.length ? nodes.find((q) => q.sk.id === sk.req[0]) : { x: TW / 2, y: TH - 8 };
      this.sweep = { x: parent.x, y: parent.y, reach: Math.hypot(parent.x - n.x, parent.y - n.y) + 70, t: 0, prev: null };
      if (this.coralCanvas) this.sweep.prev = this.coralCanvas;
      if (this.highlight === sk.id) this.highlight = null;
      const col = vivid(BRANCHES[sk.branch].color);
      const P = g.particles;
      P.burst(s.x, s.y, 26, { colors: [col, shade(col, 0.5), '#ffffff', '#fff6b0'], speed: 90, speedMin: 25, g: -20, drag: 2.5, layer: 'ui', add: true, life: 1.1 });
      for (let i = 0; i < 10; i++) P.sparkle(s.x + (Math.random() - 0.5) * 30, s.y + (Math.random() - 0.5) * 24, i % 2 ? '#fff6b0' : shade(col, 0.6), { layer: 'ui', life: 0.9 });
      P.bubbles(s.x, s.y, 10, { layer: 'ui' });
      P.text(s.x, s.y - 16, sk.name + '!', { color: shade(col, 0.55), outline: '#1a0e06', layer: 'ui', vy: -14, life: 1.6 });
      g.audio.play('magic', { vol: 0.55 });
      g.audio.play('bubbles', { vol: 0.4 });
    } else {
      this.fx[sk.id] = { kind: 'shake', t: 0 };
    }
  }

  drawPolyp(ctx, sk, status, x, y, hover, t, dt, dim) {
    const fx = this.fx[sk.id];
    let sc = 1, dx = 0;
    if (fx) {
      fx.t += dt;
      if (fx.kind === 'bloom') { sc = ease.outElastic(clamp01(fx.t / 0.9)); if (fx.t > 1.6) delete this.fx[sk.id]; }
      else if (fx.kind === 'shake') { dx = Math.round(Math.sin(fx.t * 50) * 2 * (1 - fx.t / 0.35)); if (fx.t > 0.35) delete this.fx[sk.id]; }
      else if (fx.kind === 'wiggle') { if (fx.t > 0.5) delete this.fx[sk.id]; }
    }
    const color = sk.id === 'hook1' ? TRUNK : BRANCHES[sk.branch].color;
    const vcol = vivid(color);
    x = Math.round(x + dx);
    y = Math.round(y - (hover ? 1 : 0));
    if (dim) ctx.globalAlpha = 0.45;
    // glow halo for affordable buds
    if (status === 'ready') {
      const p = 0.5 + 0.5 * Math.sin(t * 4 + sk.pos[0] * 6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (dim ? 0.2 : 0.35) * (0.4 + p * 0.6);
      const d = discSprite(NODE_R + 4, color);
      ctx.drawImage(d, x - d.width / 2 + 0.5 | 0, y - d.height / 2 + 0.5 | 0);
      ctx.globalAlpha = (dim ? 0.3 : 0.8) * (1 - ((t * 0.9 + sk.pos[1]) % 1));
      const rs = ringSprite(Math.round(NODE_R + 2 + ((t * 0.9 + sk.pos[1]) % 1) * 7), shade(color, 0.5));
      ctx.drawImage(rs, Math.round(x - rs.width / 2), Math.round(y - rs.height / 2));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = dim ? 0.45 : 1;
    }
    // tentacles for grown polyps
    if (status === 'owned') {
      const unfurl = fx?.kind === 'bloom' ? ease.outCubic(clamp01(fx.t / 1.1)) : 1;
      const wig = fx?.kind === 'wiggle' ? 1 + Math.sin(fx.t * 30) * 0.6 : 1;
      const R = ramp(vcol, 1);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + (i - (n - 1) / 2) * 0.36;
        const len = (5 + (i % 2) * 2 + (i === 4 ? 1 : 0)) * unfurl;
        let a = a0, px = x + Math.cos(a0) * (NODE_R - 1), py = y + Math.sin(a0) * (NODE_R - 1);
        for (let j = 0; j < len; j++) {
          a += Math.sin(t * 2.4 + i * 0.9 + j * 0.45) * 0.09 * wig;
          px += Math.cos(a); py += Math.sin(a);
          const tip = j >= len - 1.5;
          ctx.fillStyle = tip ? R[4] : j < 2 ? R[2] : R[3];
          ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
          if (!tip && j < len - 2) { ctx.fillStyle = R[1]; ctx.fillRect(Math.round(px) + 1, Math.round(py), 1, 1); }
        }
        if (len > 3 && (i + Math.floor(t * 2)) % 3 === 0) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(R[4], 0.6);
          ctx.fillRect(Math.round(px), Math.round(py) - 1, 1, 1);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      if (!dim && Math.random() < dt * 0.25 && this.bubbles.length < 40) this.bubbles.push({ x, y: y - NODE_R, t: 0, ph: Math.random() * TAU, r: Math.random() < 0.3 ? 2 : 1 });
    }
    const spr = polypSprite(color, status, hover);
    const w = Math.round(spr.width * sc), h = Math.round(spr.height * sc);
    if (w > 0 && h > 0) ctx.drawImage(spr, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    // icon
    const ic = getUiIcon(sk.icon || 'star');
    if (ic && sc > 0.5) {
      const ix = Math.round(x - ic.width / 2), iy = Math.round(y - ic.height / 2);
      if (status === 'locked') { ctx.globalAlpha *= 0.85; ctx.drawImage(tinted(ic, '#4a4858'), ix, iy); }
      else if (status === 'poor') { ctx.globalAlpha *= 0.6; ctx.drawImage(ic, ix, iy); }
      else ctx.drawImage(ic, ix, iy);
    }
    ctx.globalAlpha = 1;
    if (status === 'locked' && !dim && sk.req.every((q) => this.game.state.skills[q])) {
      const lk = getUiIcon('lock');
      ctx.globalAlpha = 0.85;
      ctx.drawImage(lk, x + NODE_R - 6, y + NODE_R - 7);
      ctx.globalAlpha = 1;
    }
  }

  drawRays(ctx, vr, ox, oy, TW, TH, t) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x0 = ox + (i + 0.5) * (TW / 6) + Math.sin(t * 0.25 + i * 1.7) * 18;
      const a = 0.035 + 0.025 * Math.sin(t * 0.6 + i * 2.1);
      ctx.fillStyle = rgba('#d8f6ff', Math.max(0, a));
      ctx.beginPath();
      ctx.moveTo(x0, oy); ctx.lineTo(x0 + 26, oy); ctx.lineTo(x0 - 50, oy + TH * 0.85); ctx.lineTo(x0 - 96, oy + TH * 0.85);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawMotes(ctx, vr, dt, t, reduced) {
    if (!this.motes) {
      this.motes = [];
      for (let i = 0; i < 46; i++) this.motes.push({ x: Math.random() * vr.w, y: Math.random() * vr.h, s: 0.2 + Math.random() * 0.8, ph: Math.random() * TAU });
    }
    ctx.fillStyle = rgba('#dff8ff', 0.4);
    for (const m of this.motes) {
      if (!reduced) { m.y -= dt * 3 * m.s; m.x += Math.sin(t * 0.7 + m.ph) * dt * 2; }
      if (m.y < 0) { m.y = vr.h; m.x = Math.random() * vr.w; }
      ctx.globalAlpha = 0.3 + m.s * 0.5;
      ctx.fillRect(Math.round(vr.x + m.x), Math.round(vr.y + m.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    // polyp bubbles
    const ox = Math.round(vr.x - this.pan.x), oy = Math.round(vr.y - this.pan.y);
    for (const b of this.bubbles) {
      b.t += dt;
      b.y -= dt * (14 + b.t * 6);
      const x = Math.round(ox + b.x + Math.sin(b.t * 4 + b.ph) * 2), y = Math.round(oy + b.y);
      ctx.fillStyle = rgba('#e8fbff', 0.8);
      if (b.r > 1) { ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1); ctx.fillStyle = rgba('#ffffff', 0.9); ctx.fillRect(x, y, 1, 1); }
      else ctx.fillRect(x, y, 1, 1);
    }
    this.bubbles = this.bubbles.filter((b) => b.t < 4 && oy + b.y > vr.y - 4);
  }

  drawLegend(ctx, ui, r, st) {
    const y = r.y + r.h - 22;
    const n = BRANCH_ORDER.length;
    const cw = Math.floor((r.w - 20) / n);
    this.legendHover = null;
    for (let i = 0; i < n; i++) {
      const b = BRANCH_ORDER[i], B = BRANCHES[b];
      const x = r.x + 10 + i * cw;
      const all = SKILLS.filter((s) => s.branch === b);
      const got = all.filter((s) => st.skills[s.id]).length;
      const rr = { x, y, w: cw - 2, h: 16 };
      const hov = ui.hover(rr);
      if (hov) {
        this.legendHover = b;
        ctx.fillStyle = rgba('#fff2d0', 0.12);
        ctx.fillRect(x, y, cw - 2, 16);
        ui.tip = `${B.name}: ${got}/${all.length} grown`;
      }
      // gem
      const R = ramp(vivid(B.color));
      const gx = x + 3, gy = y + 4;
      ctx.fillStyle = '#1a1226';
      ctx.fillRect(gx + 2, gy - 1, 3, 1); ctx.fillRect(gx + 1, gy, 5, 1); ctx.fillRect(gx, gy + 1, 7, 5); ctx.fillRect(gx + 1, gy + 6, 5, 1); ctx.fillRect(gx + 2, gy + 7, 3, 1);
      ctx.fillStyle = R[2]; ctx.fillRect(gx + 1, gy + 1, 5, 5); ctx.fillRect(gx + 2, gy, 3, 1); ctx.fillRect(gx + 2, gy + 6, 3, 1);
      ctx.fillStyle = R[4]; ctx.fillRect(gx + 2, gy + 1, 2, 2);
      ctx.fillStyle = R[1]; ctx.fillRect(gx + 4, gy + 4, 2, 2);
      const full = got === all.length;
      drawText(ctx, B.name, x + 13, y + 2, { color: full ? '#ffe27a' : '#f4d8a8', shadow: '#1a0e06' });
      const bw = Math.min(cw - 18, measureText(B.name) + 4);
      ctx.fillStyle = '#1a0e06';
      ctx.fillRect(x + 13, y + 12, bw, 4);
      ctx.fillStyle = shade(B.color, -0.6);
      ctx.fillRect(x + 14, y + 13, bw - 2, 2);
      const fw = Math.round((bw - 2) * (got / all.length));
      if (fw > 0) { ctx.fillStyle = vivid(B.color); ctx.fillRect(x + 14, y + 13, fw, 2); ctx.fillStyle = shade(B.color, 0.5); ctx.fillRect(x + 14, y + 13, fw, 1); }
    }
  }

  drawCard(ctx, sk, status, s, r, st, found) {
    const B = BRANCHES[sk.branch];
    const w = 170;
    const lines = wrapText(sk.desc, w - 16);
    const cost = sk.cost;
    let statusLine, statusColor, statusIcon;
    if (status === 'owned') { statusLine = 'Grown!'; statusColor = '#2a7a3a'; statusIcon = 'check'; }
    else if (status === 'ready') { statusLine = cost ? `Click to grow: ${formatCommas(cost)}{coin}` : 'Click to grow: free!'; statusColor = '#2a6a4a'; statusIcon = 'plus'; }
    else if (status === 'poor') { statusLine = `Need ${formatCommas(cost)}{coin} (${formatCommas(cost - st.coins)} more)`; statusColor = '#b8382a'; statusIcon = 'coin'; }
    else { statusLine = skillStatus(sk, st, found).reason || 'Locked'; statusColor = '#6a5a6a'; statusIcon = 'lock'; }
    const sLines = wrapText(statusLine, w - 30);
    const h = 26 + lines.length * 10 + 6 + sLines.length * 10 + 6;
    let x = s.x + 16, y = s.y - h / 2;
    if (x + w > r.x + r.w - 4) x = s.x - 16 - w;
    y = clamp(y, r.y + 4, r.y + r.h - h - 4);
    x = Math.round(x); y = Math.round(y);
    drawPaper(ctx, x, y, w, h, { aged: true });
    // tape
    ctx.fillStyle = rgba('#f4e0a0', 0.85);
    ctx.fillRect(x + w / 2 - 8, y - 3, 16, 6);
    ctx.fillStyle = rgba('#b89858', 0.4);
    ctx.fillRect(x + w / 2 - 8, y + 2, 16, 1);
    drawText(ctx, B.name.toUpperCase(), x + 8, y + 6, { font: 'small', color: shade(B.color, -0.55) });
    if (status !== 'owned' && cost) drawText(ctx, `${formatCommas(cost)}{coin}`, x + w - 8, y + 5, { align: 'right', color: '#3a2a1a', font: 'small' });
    drawText(ctx, sk.name, x + 8, y + 13, { color: '#2a1a10' });
    lines.forEach((l, i) => drawText(ctx, l, x + 8, y + 26 + i * 10, { color: '#5a4636' }));
    const sy = y + 26 + lines.length * 10 + 4;
    ctx.fillStyle = rgba('#7a5a3c', 0.35);
    ctx.fillRect(x + 8, sy - 2, w - 16, 1);
    ctx.drawImage(getUiIcon(statusIcon), x + 8, sy + 1);
    sLines.forEach((l, i) => drawText(ctx, l, x + 22, sy + 2 + i * 10, { color: statusColor }));
  }
}
