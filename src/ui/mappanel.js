// Travel map: a hand-inked depth chart on a parchment scroll that unrolls when opened. The three oceans sit
// along the seabed profile in illustrated vignettes; locked ones are cross-hatched and padlocked with a
// requirement checklist, the current one carries a red pin. With the Weather Radio skill the chart also
// reports the weather and which rare fish it brings. Travel button -> game.travel(id).

import { clamp, clamp01, lerp, ease, hash1, hash2, bayer, TAU, formatCommas } from '../core/math.js';
import { rgba, pack, shade, mix } from '../core/color.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawButton } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getProp } from '../gfx/props.js';
import { SKILLS, SKILL_BY_ID } from '../game/skills.js';
import { SPECIES } from '../fish/species.js';

const INK = '#4a2e18', INK_L = '#8a6a48', INK_F = '#b89a72', RED = '#b8302a';
const LOCS = [
  { id: 'shallows', name: 'Sunny Shallows', sub: 'Crystal-clear tropical water', depth: '0 - 30 m', u: 0.17, wash: '#8ad8e0', props: [['coral_fan', 0.36, -9, 1], ['starfish_rock', 0.32, 10, 0]], icon: 'sun',
    desc: 'Warm, bright and friendly. Perfect for new anglers and very curious fish.', weathers: ['sunny', 'cloudy', 'rain', 'storm'] },
  { id: 'junkyard', name: 'Junkyard Reef', sub: 'Where old computers go to sleep', depth: '120 - 400 m', u: 0.5, wash: '#9ab890', props: [['crt_pile', 0.3, -4, 0], ['circuit_coral', 0.32, 13, 1]], icon: 'gear',
    desc: 'A reef of sunken hardware. Glitchy, mechanical and slightly rusty fish.', weathers: ['murky', 'static', 'oil', 'datarain'] },
  { id: 'abyss', name: 'The Midnight Abyss', sub: 'Something down here is watching', depth: '3,000 m +', u: 0.82, wash: '#3a4a7a', props: [['giant_skull', 0.24, -6, 0], ['glow_mushroom', 0.34, 14, 1]], icon: 'moon',
    desc: 'Pitch black and ancient. Bring a light. Bring courage. Bring snacks.', weathers: ['still', 'snow', 'current', 'glowtide'] },
];
const WEATHER = {
  sunny: ['sun', 'Sunny'], clear: ['sun', 'Clear'], cloudy: ['cloud', 'Cloudy'], rain: ['rain', 'Rain'], storm: ['storm', 'Storm'], calm: ['sun', 'Calm'],
  murky: ['cloud', 'Murky'], static: ['storm', 'Static Storm'], oil: ['cloud', 'Oil Slick'], datarain: ['rain', 'Data Rain'],
  still: ['moon', 'Still Water'], snow: ['cloud', 'Marine Snow'], current: ['arrow_r', 'Deep Current'], glowtide: ['sparkle', 'Glow Tide'],
};

// ---------------------------------------------------------------- chart art (cached per size)

function inkLine(b, x0, y0, x1, y1, c, wob = 0, seed = 0) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const w = wob ? (hash1(Math.floor(i / 6), seed) - 0.5) * wob : 0;
    b.set(Math.round(lerp(x0, x1, k) + w * (y1 - y0) / n), Math.round(lerp(y0, y1, k) + w * (x0 - x1) / n), c);
  }
}

function seabedY(u, top, bottom) {
  // depth profile: beach -> shallows shelf -> reef plateau -> cliff -> trench
  const pts = [[0, 0.04], [0.08, 0.24], [0.26, 0.33], [0.34, 0.45], [0.42, 0.56], [0.6, 0.58], [0.66, 0.7], [0.71, 0.9], [0.9, 0.95], [1, 0.9]];
  let i = 0;
  while (i < pts.length - 2 && u > pts[i + 1][0]) i++;
  const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
  const k = clamp01((u - ua) / (ub - ua));
  const s = k * k * (3 - 2 * k);
  return top + (bottom - top) * lerp(va, vb, s) + Math.sin(u * 60) * 1.2;
}

function buildChart(w, h) {
  const b = new PixelBuffer(w, h);
  const P = ['#c8a678', '#dcc092', '#ead3a8', '#f4e4c0', '#faf0d6'].map((c) => pack(c));
  // parchment with darker, stained edges
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ex = Math.min(x, w - 1 - x) / 40, ey = Math.min(y, h - 1 - y) / 30;
    let v = 3.1 + Math.min(1, Math.min(ex, ey)) * 0.9 - 1 + (hash2(x >> 2, y >> 2, 3) - 0.5) * 0.5 + (hash2(x, y, 4) - 0.5) * 0.3;
    v -= Math.max(0, 1 - Math.min(ex, ey)) * 1.2;
    const stain = Math.hypot((x - w * 0.8) / 50, (y - h * 0.2) / 35);
    if (stain > 0.85 && stain < 1) v -= 0.6;
    b.set(x, y, P[clamp(Math.floor(v + (bayer(x, y) - 0.5) * 0.6), 0, 4)]);
  }
  const ink = pack(INK), inkL = pack(INK_L), inkF = pack(INK_F), sea = pack('#9ac8c8'), seaD = pack('#7aaab4');
  const surf = Math.round(h * 0.17), bottom = h - 18;
  // water wash (light dithered teal, darker with depth)
  for (let x = 1; x < w - 1; x++) {
    const sb = seabedY(x / w, surf, bottom);
    for (let y = surf + 1; y < sb; y++) {
      const d = (y - surf) / (bottom - surf);
      if (bayer(x, y) < 0.18 + d * 0.32) b.set(x, y, d > 0.55 ? seaD : sea);
    }
  }
  // sea surface waves
  for (let x = 30; x < w - 4; x++) {
    const y = surf + Math.round(Math.sin(x * 0.18) * 1.5);
    b.set(x, y, ink);
    if (x % 9 < 3) b.set(x, y - 2, inkL);
  }
  // wavy hatching for water
  for (let row = 0; row < 9; row++) {
    const yy = surf + 18 + row * Math.round((bottom - surf) / 10);
    for (let x0 = 14 + (row % 2) * 30; x0 < w - 20; x0 += 64) {
      for (let x = x0; x < x0 + 14; x++) {
        const y = yy + Math.round(Math.sin(x * 0.5) * 1);
        if (y < seabedY(x / w, surf, bottom) - 4) b.set(x, y, inkF);
      }
    }
  }
  // seabed: ink profile + hatched rock
  let py = null;
  for (let x = 0; x < w; x++) {
    const y = Math.round(seabedY(x / w, surf, bottom));
    if (py !== null) for (let yy = Math.min(y, py); yy <= Math.max(y, py); yy++) b.set(x, yy, ink);
    b.set(x, y, ink);
    b.set(x, y + 1, ink);
    for (let yy = y + 2; yy < h - 3; yy++) {
      const d = yy - y;
      const c = (x + yy) % 7 === 0 && (d < 14 || hash2(x >> 3, yy >> 3, 2) > 0.45) ? (d < 8 ? inkL : inkF) : 0;
      if (c) b.set(x, yy, c);
      else if (bayer(x, yy) < 0.2 + Math.min(0.2, d / 200)) b.set(x, yy, P[1]);
    }
    py = y;
  }
  // beach + palm tree on the left
  for (let x = 0; x < 34; x++) {
    const y = Math.round(surf - 4 + (x / 34) * 6 - Math.sin(x * 0.1) * 2);
    for (let yy = y; yy < surf + 6; yy++) if (bayer(x, yy) < 0.5) b.set(x, yy, pack('#e8c888'));
    b.set(x, y, ink);
  }
  for (let i = 0; i < 22; i++) { b.set(12 + Math.round(Math.sin(i * 0.12) * 3), surf - 6 - i, ink); b.set(13 + Math.round(Math.sin(i * 0.12) * 3), surf - 6 - i, inkL); }
  for (const [dx, dy] of [[-9, 3], [9, 4], [-6, -2], [8, -1], [0, -4]]) inkLine(b, 14, surf - 28, 14 + dx, surf - 28 + dy + 4, pack('#4a7a3a'));
  // sun
  for (let a = 0; a < TAU; a += 0.15) b.set(Math.round(w - 34 + Math.cos(a) * 7), Math.round(surf - 16 + Math.sin(a) * 7), pack('#d8a040'));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; inkLine(b, w - 34 + Math.cos(a) * 10, surf - 16 + Math.sin(a) * 10, w - 34 + Math.cos(a) * 13, surf - 16 + Math.sin(a) * 13, pack('#d8a040')); }
  // depth ruler
  const rx = w - 10;
  for (let y = surf; y < bottom; y += 2) b.set(rx, y, inkL);
  // compass rose (bottom-left, over the rock)
  const cx = 30, cy = h - 34;
  for (let a = 0; a < TAU; a += 0.08) b.set(Math.round(cx + Math.cos(a) * 11), Math.round(cy + Math.sin(a) * 11), ink);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU - Math.PI / 2;
    b.fillPoly([[cx + Math.cos(a) * 16, cy + Math.sin(a) * 16], [cx + Math.cos(a + 1.3) * 4, cy + Math.sin(a + 1.3) * 4], [cx, cy]], k === 0 ? pack(RED) : ink);
    b.fillPoly([[cx + Math.cos(a) * 16, cy + Math.sin(a) * 16], [cx, cy], [cx + Math.cos(a - 1.3) * 4, cy + Math.sin(a - 1.3) * 4]], inkL);
  }
  // sea serpent doodle near the trench edge
  const sx = Math.round(w * 0.62), sy = Math.round(surf + (bottom - surf) * 0.3);
  for (let i = 0; i < 40; i++) {
    const x = sx + i, y = sy + Math.round(Math.sin(i * 0.3) * 4);
    if (Math.sin(i * 0.3) < 0.2) { b.set(x, y, ink); b.set(x, y + 1, inkL); }
  }
  b.fillCircle(sx + 42, sy - 2, 3, ink); b.set(sx + 43, sy - 3, P[4]);
  // little ink fish doodles
  for (const [fx, fy, d] of [[0.3, 0.2, 1], [0.38, 0.28, 1], [0.84, 0.45, -1], [0.55, 0.16, -1]]) {
    const x0 = Math.round(w * fx), y0 = Math.round(surf + (bottom - surf) * fy);
    for (let a = 0; a < TAU; a += 0.2) b.set(Math.round(x0 + Math.cos(a) * 4), Math.round(y0 + Math.sin(a) * 2), inkL);
    b.set(x0 - d * 5, y0 - 1, inkL); b.set(x0 - d * 5, y0 + 1, inkL); b.set(x0 - d * 6, y0 - 2, inkL); b.set(x0 - d * 6, y0 + 2, inkL);
    b.set(x0 + d * 2, y0 - 1, ink);
  }
  // treasure X in the trench
  const tx = Math.round(w * 0.93), ty = Math.round(seabedY(0.93, surf, bottom)) - 6;
  for (let i = -3; i <= 3; i++) { b.set(tx + i, ty + i, pack(RED)); b.set(tx + i, ty - i, pack(RED)); b.set(tx + i + 1, ty + i, pack(RED)); b.set(tx + i + 1, ty - i, pack(RED)); }
  return { canvas: b.toCanvas(), surf, bottom };
}

// ---------------------------------------------------------------- panel

export class MapPanel {
  constructor() {
    this.id = 'map';
    this.modal = true;
    this.sound = 'ui_page';
    this.t = 0;
  }

  open() {
    const g = this.game;
    this.t = 0;
    this.sel = g.ocean?.biome?.id || g.state.biome || 'shallows';
    this.hover = null;
    this.vig = {};
  }

  unlocked(id) { return this.game.state.unlockedBiomes?.includes(id) ?? id === 'shallows'; }
  current() { return this.game.ocean?.biome?.id || this.game.state.biome; }

  requirements(id) {
    const g = this.game, st = g.state;
    const sk = SKILLS.find((s) => s.effect.unlockBiome === id);
    if (!sk) return [];
    const found = g.speciesFound();
    const out = sk.req.map((r) => ({ text: SKILL_BY_ID[r].name, sub: 'skill', ok: !!st.skills[r] }));
    if (sk.needSpecies) out.push({ text: `Discover ${sk.needSpecies} species`, sub: `${Math.min(found, sk.needSpecies)}/${sk.needSpecies}`, ok: found >= sk.needSpecies });
    out.push({ text: `Grow '${sk.name}'`, sub: `${formatCommas(sk.cost)}{coin}`, ok: !!st.skills[sk.id] });
    return out;
  }

  vignette(L) {
    if (this.vig[L.id]) return this.vig[L.id];
    const R = 27, D = R * 2 + 2;
    const c = makeCanvas(D, D);
    const x = ctxOf(c);
    // watercolour wash
    const b = new PixelBuffer(D, D);
    for (let y = 0; y < D; y++) for (let xx = 0; xx < D; xx++) {
      const d = Math.hypot(xx + 0.5 - D / 2, y + 0.5 - D / 2);
      if (d > R) continue;
      const v = (y / D) * 0.5 + (hash2(xx >> 1, y >> 1, 7) - 0.5) * 0.15 + (bayer(xx, y) - 0.5) * 0.2;
      b.set(xx, y, pack(mix(L.wash, shade(L.wash, -0.5), clamp01(v))));
    }
    x.drawImage(b.toCanvas(), 0, 0);
    x.save();
    x.beginPath(); x.arc(D / 2, D / 2, R - 1, 0, TAU); x.clip();
    // seabed strip
    x.fillStyle = L.id === 'abyss' ? '#1a1a2a' : L.id === 'junkyard' ? '#5a5a48' : '#e8d098';
    x.fillRect(0, D - 14, D, 14);
    for (const [pid, sc, dx, variant] of L.props) {
      try {
        const p = getProp(pid, { scale: sc, variant });
        x.drawImage(p.canvas, Math.round(D / 2 + dx - p.ox), Math.round(D - 10 - p.oy));
      } catch { /* prop missing: plain wash */ }
    }
    if (L.id === 'abyss') {
      x.fillStyle = '#9affff';
      x.fillRect(16, 16, 2, 1); x.fillRect(22, 16, 2, 1);
    }
    x.restore();
    // ink ring
    const ring = new PixelBuffer(D, D);
    for (let a = 0; a < TAU; a += 0.02) {
      for (const rr of [R, R - 0.8]) ring.set(Math.round(D / 2 + Math.cos(a) * rr - 0.5), Math.round(D / 2 + Math.sin(a) * rr - 0.5), pack(INK));
    }
    x.drawImage(ring.toCanvas(), 0, 0);
    this.vig[L.id] = c;
    return c;
  }

  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input, st = g.state;
    dt = Math.max(0, dt);
    this.t += dt;
    const t = this.t;
    const W = Math.min(g.screen.W - 40, 620), H = Math.min(g.screen.H - 40, 420);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2), w: W, h: H };
    this.rect = r;
    const reduced = st.settings?.reducedMotion;
    const k = reduced ? 1 : ease.outCubic(clamp01(this.t / 0.55));
    const sheet = { x: r.x + 10, y: r.y + 9, w: W - 20, h: H - 18 };
    const vis = Math.round(sheet.h * k);

    // ------------------------------------------------ sheet content (clipped to the unrolled part)
    const key = `${sheet.w}x${sheet.h}`;
    if (this.chartKey !== key) { this.chartKey = key; this.chart = buildChart(sheet.w, sheet.h - 74); }
    ctx.save();
    ctx.beginPath(); ctx.rect(sheet.x, sheet.y, sheet.w, vis); ctx.clip();
    ctx.fillStyle = '#ead3a8';
    ctx.fillRect(sheet.x, sheet.y, sheet.w, sheet.h);
    ctx.drawImage(this.chart.canvas, sheet.x, sheet.y);
    const cy0 = sheet.y, surf = this.chart.surf, bottom = this.chart.bottom;
    // title banner
    this.drawBanner(ctx, sheet.x + sheet.w / 2, sheet.y + 8, 'SEA CHART');
    // depth labels on the ruler
    for (const [d, label] of [[0, '0 m'], [0.3, '100'], [0.55, '400'], [0.92, '3,000']]) {
      drawText(ctx, label, sheet.x + sheet.w - 14, cy0 + surf + (bottom - surf) * d - 2, { align: 'right', font: 'small', color: INK_L });
    }
    drawText(ctx, 'here be fish', sheet.x + sheet.w * 0.62 + 2, cy0 + surf + (bottom - surf) * 0.3 + 8, { font: 'small', color: INK_L });
    // boat on the surface above the current location
    const cur = this.current();
    const curL = LOCS.find((l) => l.id === cur) || LOCS[0];
    const pos = (L) => ({ x: Math.round(sheet.x + L.u * sheet.w), y: Math.round(cy0 + seabedY(L.u, surf, bottom) - 30) });
    // dashed route
    for (let i = 0; i < LOCS.length - 1; i++) {
      const a = pos(LOCS[i]), bb = pos(LOCS[i + 1]);
      const n = Math.hypot(bb.x - a.x, bb.y - a.y);
      const open = this.unlocked(LOCS[i + 1].id);
      for (let s = 30; s < n - 30; s += 1) {
        if ((s + Math.floor(t * 8)) % 7 > 3) continue;
        const kk = s / n;
        const x = lerp(a.x, bb.x, kk), y = lerp(a.y, bb.y, kk) - Math.sin(kk * Math.PI) * 18;
        ctx.fillStyle = open ? RED : INK_F;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    // locations
    let hov = null;
    for (const L of LOCS) {
      const p = pos(L);
      const rr = { x: p.x - 34, y: p.y - 30, w: 68, h: 80 };
      const isH = ui.hover(rr) && k >= 1;
      if (isH) hov = L;
      this.drawLocation(ctx, L, p, isH, L.id === cur, t);
      if (isH && inp.pressed) {
        inp.pressed = false;
        if (this.sel !== L.id) { this.sel = L.id; g.audio.play('ui_click'); }
      }
    }
    if ((hov?.id || null) !== this.hover) { this.hover = hov?.id || null; if (hov) g.audio.play('ui_hover', { vol: 0.3 }); }
    // boat + "you are here"
    const bp = pos(curL);
    const bx = bp.x, by = cy0 + surf - 1 + Math.round(Math.sin(t * 2) * 1);
    ctx.fillStyle = INK;
    ctx.fillRect(bx - 7, by - 3, 14, 1); ctx.fillRect(bx - 6, by - 2, 12, 1); ctx.fillRect(bx - 5, by - 1, 10, 1);
    ctx.fillRect(bx, by - 12, 1, 9);
    ctx.fillStyle = '#f4f0e0'; ctx.fillRect(bx + 1, by - 11, 5, 6); ctx.fillStyle = INK_L; ctx.fillRect(bx + 1, by - 6, 5, 1);
    ctx.fillStyle = INK_F;
    for (let y = by + 1; y < pos(curL).y - 26; y += 3) ctx.fillRect(bx, y, 1, 1);

    // ------------------------------------------------ info strip
    this.drawInfo(ctx, ui, { x: sheet.x + 8, y: sheet.y + sheet.h - 70, w: sheet.w - 16, h: 64 }, t);
    ctx.restore();
    // paper edge shading at the roll
    ctx.fillStyle = rgba('#5a3a1a', 0.25);
    ctx.fillRect(sheet.x, sheet.y + vis - 3, sheet.w, 3);

    // ------------------------------------------------ rolls (top fixed, bottom follows the unroll)
    this.drawRoll(ctx, r.x, r.y, W);
    this.drawRoll(ctx, r.x, sheet.y + vis - 3, W);
    if (k >= 1 && ui.button(ctx, r.x + W - 28, r.y + 14, 18, 17, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) ui.close(this.id);
  }

  drawRoll(ctx, x, y, W) {
    // wooden rod knobs
    for (const kx of [x, x + W - 10]) {
      ctx.fillStyle = '#2a160a'; ctx.fillRect(kx, y, 10, 13);
      ctx.fillStyle = '#8a5428'; ctx.fillRect(kx + 1, y + 1, 8, 11);
      ctx.fillStyle = '#c8884a'; ctx.fillRect(kx + 2, y + 2, 3, 8);
      ctx.fillStyle = '#5a3418'; ctx.fillRect(kx + 7, y + 2, 1, 9);
    }
    // paper roll
    const px = x + 9, pw = W - 18;
    const shades = ['#7a5a3c', '#c8ac80', '#ead3a8', '#fbf3df', '#f3e6c8', '#dcc092', '#b89a6c', '#8a6a48', '#5a3a1c'];
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(px, y, pw, 13);
    for (let i = 0; i < 11; i++) {
      ctx.fillStyle = shades[Math.min(shades.length - 1, Math.round(i * 0.8))];
      ctx.fillRect(px + 1, y + 1 + i, pw - 2, 1);
    }
    ctx.fillStyle = rgba('#5a3a1a', 0.35);
    for (let i = 0; i < 6; i++) ctx.fillRect(px + 20 + i * Math.floor(pw / 6), y + 2, 1, 9);
  }

  drawBanner(ctx, cx, y, text) {
    const tw = measureText(text, 'normal', 2) + 24;
    const x = Math.round(cx - tw / 2);
    // ribbon tails
    ctx.fillStyle = shade(RED, -0.4);
    ctx.fillRect(x - 10, y + 6, 14, 12); ctx.fillRect(x + tw - 4, y + 6, 14, 12);
    ctx.fillStyle = '#ead3a8';
    ctx.fillRect(x - 10, y + 10, 3, 4); ctx.fillRect(x + tw + 7, y + 10, 3, 4);
    ctx.fillStyle = INK;
    ctx.fillRect(x, y, tw, 20);
    ctx.fillStyle = RED;
    ctx.fillRect(x + 1, y + 1, tw - 2, 18);
    ctx.fillStyle = shade(RED, 0.35);
    ctx.fillRect(x + 1, y + 1, tw - 2, 2);
    drawText(ctx, text, cx, y + 4, { align: 'center', scale: 2, color: '#fff0d8', shadow: shade(RED, -0.6) });
  }

  drawLocation(ctx, L, p, hov, current, t) {
    const g = this.game;
    const unlocked = this.unlocked(L.id);
    const v = this.vignette(L);
    const sel = this.sel === L.id;
    const lift = hov ? 2 : 0;
    const x = Math.round(p.x - v.width / 2), y = Math.round(p.y - v.height / 2 - lift);
    // selection: pencil circle
    if (sel) {
      ctx.fillStyle = RED;
      const R = 33 + Math.sin(t * 3) * 0.6;
      for (let a = 0; a < TAU * 1.06; a += 0.025) {
        const wob = 1 + (hash1(Math.floor(a * 4), 9) - 0.5) * 0.05 + a * 0.008;
        ctx.fillRect(Math.round(p.x + Math.cos(a - 2) * R * wob), Math.round(p.y - lift + Math.sin(a - 2) * R * 0.92 * wob), 1, 1);
      }
    }
    ctx.drawImage(v, x, y);
    if (!unlocked) {
      // ink cross-hatching + padlock
      ctx.save();
      ctx.beginPath(); ctx.arc(p.x, p.y - lift, 26, 0, TAU); ctx.clip();
      ctx.fillStyle = rgba('#2a1a10', 0.5);
      ctx.fillRect(x, y, v.width, v.height);
      ctx.fillStyle = rgba(INK, 0.9);
      for (let i = -60; i < 60; i += 5) for (let j = 0; j < 60; j++) { ctx.fillRect(x + i + j, y + j, 1, 1); if (j % 2 === 0) ctx.fillRect(x + i + 60 - j, y + j, 1, 1); }
      ctx.restore();
      const lk = getUiIcon('lock');
      ctx.drawImage(lk, Math.round(p.x - lk.width), Math.round(p.y - lk.height - lift), lk.width * 2, lk.height * 2);
    }
    // label cartouche
    const name = L.name;
    const lw = Math.max(measureText(name), measureText(L.depth, 'small')) + 10;
    const lx = Math.round(p.x - lw / 2), ly = p.y + 29 - lift;
    ctx.fillStyle = INK; ctx.fillRect(lx, ly, lw, 20);
    ctx.fillStyle = unlocked ? '#f8ecd0' : '#e0cca4'; ctx.fillRect(lx + 1, ly + 1, lw - 2, 18);
    ctx.fillStyle = INK_F; ctx.fillRect(lx + 2, ly + 2, lw - 4, 1);
    drawText(ctx, name, p.x, ly + 3, { align: 'center', color: unlocked ? INK : INK_L });
    drawText(ctx, L.depth, p.x, ly + 12, { align: 'center', font: 'small', color: INK_L });
    // weather glyph (Weather Radio)
    if (g.stats.forecast && unlocked && current) {
      const w = WEATHER[g.ocean?.weather] || WEATHER.calm;
      ctx.drawImage(getUiIcon(w[0]), p.x + 20, p.y - 34 - lift);
    }
    // current location pin
    if (current) {
      const bob = Math.round(Math.sin(t * 3) * 2);
      const px2 = p.x - 18, py2 = p.y - 30 - lift + bob;
      ctx.fillStyle = INK; ctx.fillRect(px2 + 3, py2 + 6, 1, 8);
      ctx.fillStyle = '#5a1010'; ctx.fillRect(px2, py2, 7, 7);
      ctx.fillStyle = '#e83a3a'; ctx.fillRect(px2 + 1, py2 + 1, 5, 5);
      ctx.fillStyle = '#ff9a8a'; ctx.fillRect(px2 + 2, py2 + 2, 2, 2);
      drawText(ctx, 'you are here', p.x - 22, p.y - 40 - lift + bob, { align: 'right', font: 'small', color: RED });
    }
  }

  drawInfo(ctx, ui, rr, t) {
    const g = this.game, st = g.state;
    const L = LOCS.find((l) => l.id === (this.hover || this.sel)) || LOCS[0];
    const unlocked = this.unlocked(L.id), current = L.id === this.current();
    // pinned note look: ink frame
    ctx.fillStyle = rgba('#fbf3df', 0.75);
    ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
    ctx.fillStyle = INK_L;
    ctx.fillRect(rr.x, rr.y, rr.w, 1); ctx.fillRect(rr.x, rr.y + rr.h - 1, rr.w, 1);
    ctx.fillRect(rr.x, rr.y, 1, rr.h); ctx.fillRect(rr.x + rr.w - 1, rr.y, 1, rr.h);
    ctx.drawImage(getUiIcon(L.icon), rr.x + 6, rr.y + 5);
    drawText(ctx, L.name, rr.x + 20, rr.y + 6, { color: INK });
    drawText(ctx, L.sub.toUpperCase(), rr.x + 26 + measureText(L.name), rr.y + 7, { font: 'small', color: INK_L });
    const list = SPECIES.filter((s) => s.biome === L.id);
    const got = list.filter((s) => st.journal[s.id]?.caught > 0).length;
    const colW = rr.w - 150;
    if (unlocked) {
      wrapText(L.desc, colW).slice(0, 2).forEach((l, i) => drawText(ctx, l, rr.x + 8, rr.y + 19 + i * 10, { color: INK_L }));
      drawText(ctx, `FISH FOUND ${got}/${list.length}`, rr.x + 8, rr.y + rr.h - 12, { font: 'small', color: INK });
      // weather radio
      let wx = rr.x + 90;
      if (g.stats.forecast) {
        const rare = (wid) => list.filter((s) => s.spawn?.weather === wid || (wid === 'sunny' && s.spawn?.weather === 'clear'));
        if (current) {
          const wid = g.ocean?.weather || 'calm';
          const w = WEATHER[wid] || WEATHER.calm;
          ctx.drawImage(getUiIcon(w[0]), wx, rr.y + rr.h - 15);
          const mins = Math.max(1, Math.round((g.ocean?.weatherT || 0) / 60));
          const rf = rare(wid);
          const txt = `${w[1].toUpperCase()} ~${mins} MIN${rf.length ? `  -  BRINGS ${rf.map((s) => (st.journal[s.id]?.caught ? s.name : '???').toUpperCase()).join(', ')}` : ''}`;
          drawText(ctx, txt, wx + 14, rr.y + rr.h - 12, { font: 'small', color: rf.length ? RED : INK });
        } else {
          const ws = L.weathers.filter((wid) => rare(wid).length);
          drawText(ctx, ws.length ? `RARE-FISH WEATHER: ${ws.map((w) => WEATHER[w][1].toUpperCase()).join(', ')}` : 'NO WEATHER-ONLY FISH HERE', wx, rr.y + rr.h - 12, { font: 'small', color: INK_L });
        }
      } else drawText(ctx, "GROW 'WEATHER RADIO' FOR FORECASTS", wx, rr.y + rr.h - 12, { font: 'small', color: INK_F });
    } else {
      drawText(ctx, 'TO SAIL HERE YOU NEED:', rr.x + 8, rr.y + 19, { font: 'small', color: RED });
      const reqs = this.requirements(L.id);
      reqs.forEach((q, i) => {
        const cx = rr.x + 8 + (i % 2) * Math.floor(colW / 2), cy = rr.y + 28 + Math.floor(i / 2) * 12;
        ctx.drawImage(getUiIcon(q.ok ? 'check' : 'cross'), cx, cy - 1);
        drawText(ctx, `${q.text} ${q.sub === 'skill' ? '' : '(' + q.sub + ')'}`, cx + 13, cy + 1, { color: q.ok ? '#3a6a2a' : INK });
      });
    }
    // travel button
    const bx = rr.x + rr.w - 132, by = rr.y + rr.h - 30;
    if (current) {
      drawText(ctx, 'YOU ARE HERE', bx + 62, by + 7, { align: 'center', font: 'small', color: RED });
    } else if (unlocked) {
      if (ui.button(ctx, bx, by, 124, 24, `Sail to ${L.name.replace('The ', '').split(' ')[0]}`, { icon: 'map', style: 'wood', sound: 'travel_whoosh', tip: `Travel to ${L.name}` })) {
        if (g.travel(L.id)) g.ui?.close?.(this.id);
      }
    } else {
      drawButton(ctx, bx, by, 124, 24, { label: 'Locked', icon: 'lock', state: 'disabled', style: 'wood' });
      if (ui.hover({ x: bx, y: by, w: 124, h: 24 })) {
        ui.tip = 'Unlock it in the Skill Tree (Expeditions)';
        if (g.input.pressed) { g.input.pressed = false; g.audio.play('ui_error'); }
      }
    }
  }
}
