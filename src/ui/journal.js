// FishDex (panel id 'journal'): a glossy Frutiger Aero field guide. Glass tabs per ocean, left card = species
// grid (caught fish swim in little water tiles, unknown ones are navy silhouettes), right card = the selected
// fish in a round glass aquarium window with icon chips (habitat, time, size, weight), favourite bait hearts,
// fight phases, records and variants. Less text: names live on the detail card and in tooltips.
// open({species}) jumps to a species. Shared helpers for other panels: fishBox, fitScale, drawFishFit, TYPE_ICON.

import { clamp, clamp01, ease, hash1 } from '../core/math.js';
import { RARITY, RARITY_ORDER, rgba, shade, mix, luminance } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawTab } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon, gemIcon } from '../gfx/bigicons.js';
import { getMiniIcon } from '../desktop/icons.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { rigGeom } from '../gfx/fishart.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { MUTATIONS } from '../fish/traits.js';
import { BAITS } from '../store/bait.js';
import { baitSprite } from '../fishing/baitart.js';
import { AERO, aeroCached, aeroSurface, drawAeroFrame, drawAeroCard, drawAeroBar, drawAeroBubble, drawSparkle, drawAeroGlow, toneFrom, uiFont, capH, uiScaleMode } from './aero.js';
import { panelRect } from './ui.js';

// [phase6:ui] text faces + metrics follow the UI size (Normal keeps the classic look)
const BIGUI = () => uiScaleMode() !== 'normal';
const F1 = () => uiFont('normal'), F2 = () => uiFont('small');

const BIOMES = [
  { id: 'oscean', name: '(OS)cean', tab: 'OScean', color: '#2f9ef0', icon: 'home', water: ['#bff0ff', '#3aa8ec'] },
  { id: 'shallows', name: 'Sunny Shallows', tab: 'Shallows', color: '#22b0d8', icon: 'sun', water: ['#aef2ff', '#2aa6d8'] },
  { id: 'fjord', name: 'Frosty Fjord', tab: 'Fjord', color: '#5aa8e0', icon: 'cloud', water: ['#e0f6ff', '#5aa0d0'] },
  { id: 'junkyard', name: 'Junkyard Reef', tab: 'Junkyard', color: '#58b03a', icon: 'gear', water: ['#c8f0c0', '#3a9a7a'] },
  { id: 'metropolis', name: 'Sunken Metropolis', tab: 'Metro', color: '#a85ad8', icon: 'home', water: ['#d8c8ff', '#5a4ab8'] },
  { id: 'volcano', name: 'Lava Rift', tab: 'Lava', color: '#f0782a', icon: 'sparkle', water: ['#ffd8b0', '#c8582a'] },
  { id: 'abyss', name: 'The Deep Ocean', tab: 'Deep', color: '#4a5ad8', icon: 'moon', water: ['#6a8ae0', '#101a5a'] },
];
const BIOME_BY_ID = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

const INK = AERO.ink, INK_SOFT = AERO.inkSoft, INK_FAINT = AERO.inkFaint;
const SIL = '#0e3a5e';

export const TYPE_ICON = {
  computer: 'computer', trash: 'trash', browser: 'browser', folder: 'documents', docs: 'notes', music: 'music', image: 'image',
  game: 'game', mail: 'mail', terminal: 'terminal', settings: 'settings', calc: 'calc', calendar: 'calendar', chat: 'chat', video: 'video', paint: 'paint',
};
const TYPE_NAME = {
  computer: 'Computers', trash: 'Trash', browser: 'Browsers', folder: 'Folders', docs: 'Documents', music: 'Music', image: 'Pictures', game: 'Games',
  mail: 'Mail', terminal: 'Terminals', settings: 'Settings', calc: 'Calculators', calendar: 'Calendars', chat: 'Chat apps', video: 'Videos', paint: 'Paint',
};
const PHASES = {
  tension: { icon: 'line', name: 'Tug of war' }, trace: { icon: 'eye', name: 'Follow the fish' }, mash: { icon: 'mouse_l', name: 'Click frenzy' },
  timing: { icon: 'music', name: 'Beat timing' }, dodge: { icon: 'sweat', name: 'Dodge!' }, unwrap: { icon: 'reel', name: 'Untangle' }, net: { icon: 'net', name: 'Net it' },
};
const MUT_COLOR = {
  shiny: '#ffd84a', albino: '#f4eee8', melanistic: '#4a3a50', pastel: '#ffb8e0', neon: '#3affc0', golden: '#ffcc3a',
  crimson: '#e8303a', ocean: '#3a8ae0', ghost: '#bfe0ff', inverted: '#9a6aff', galaxy: '#7a4ad0',
};
const ACTIVITY = { day: ['sun', 'Day'], night: ['moon', 'Night'], dusk: ['cloud', 'Dusk'], any: ['clock', 'Any time'] };
const WEATHER_HINT = { storm: 'storms', clear: 'sunny days', rain: 'rain', murky: 'murky water', static: 'static storms', datarain: 'data rain', snow: 'marine snow', glowtide: 'glow tide' };

// ---------------------------------------------------------------- fish fitting (shared with other panels)

const boxCache = new Map();
export function fishBox(sp) {
  let b = boxCache.get(sp.id);
  if (b) return b;
  const look = sp.look;
  if (look.kind === 'chain') {
    const r = look.chain.r, n = look.chain.segs;
    b = { w: n * r * 1.15 + r * 2, h: r * 6, ox: n * r * 1.15 + r, oy: r * 3, chain: true };
  } else {
    try {
      const g = rigGeom(compiled(look, null, sp.id), { scale: 1 });
      b = { w: g.w, h: g.h, ox: g.ox, oy: g.oy };
    } catch {
      const L = look.body?.len || 30, H = look.body?.h || 16;
      b = { w: L * 1.4, h: H * 1.6, ox: L * 0.7, oy: H * 0.8 };
    }
  }
  b.w = Math.max(8, b.w * (sp.scale || 1)); b.h = Math.max(6, b.h * (sp.scale || 1));
  b.ox *= sp.scale || 1; b.oy *= sp.scale || 1;
  boxCache.set(sp.id, b);
  return b;
}

export function fitScale(sp, maxW, maxH, maxScale = 2) {
  const b = fishBox(sp);
  const s = Math.min(maxScale, maxW / b.w, maxH / b.h);
  return Math.max(0.25, Math.floor(s * 8) / 8);
}

// Draws a species centred in a box at a fitted scale. st: extra rig fields (emotion, lookX, silhouette, ...).
export function drawFishFit(ctx, sp, cx, cy, s, t, st = {}, variant = null) {
  const b = fishBox(sp);
  const c = compiled(sp.look, variant, sp.id);
  const x = Math.round(cx - (b.w * s) / 2 + b.ox * s), y = Math.round(cy - (b.h * s) / 2 + b.oy * s);
  let chain = null;
  if (b.chain) {
    const r = sp.look.chain.r * s, n = sp.look.chain.segs;
    chain = [];
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      chain.push({ x: x - i * r * 1.15, y: y + Math.sin(t * 2.4 - k * 5) * r * 1.4 * Math.min(1, k * 2.5) });
    }
  }
  return drawFishRig(ctx, c, {
    x, y, facing: 1, turn: 1, angle: 0, scale: s * (sp.scale || 1), squash: 0, bob: Math.sin(t * 1.7) * 1,
    swimPhase: (t * 0.8) % 1, tailPhase: (t * 1.5) % 1, finPhase: (t * 2) % 1, speed01: 0.35, inflate: 0,
    lookX: null, lookY: null, blink: 0, emotion: 'neutral', mouth: 0, time: t, chain, ...st,
  });
}

// ---------------------------------------------------------------- art helpers

// round-cornered water window (aquarium glass) with sand, light shafts are drawn live on top
function waterTex(w, h, B, r = 10) {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  g.drawImage(aeroSurface(w, h, { top: B.water[0], mid: mix(B.water[0], B.water[1], 0.5), bot: B.water[1], edge: shade(B.water[1], -0.5), r, gloss: 0, rim: 0.7, glow: 0.5, glowColor: '#ffffff', streak: true, bubbles: 3, seed: w + h }), 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = B.id === 'abyss' ? '#2a2a6a' : '#f2dca0';
  for (let x = 0; x < w; x += 2) g.fillRect(x, h - 7 + Math.round(Math.sin(x * 0.08) * 1.5), 2, 9);
  g.fillStyle = B.id === 'abyss' ? 'rgba(160,180,255,0.3)' : 'rgba(255,255,255,0.45)';
  for (let x = 0; x < w; x += 2) g.fillRect(x, h - 7 + Math.round(Math.sin(x * 0.08) * 1.5), 2, 1);
  g.globalCompositeOperation = 'source-over';
  return c;
}

function glassOver(w, h, r = 10) {
  return aeroSurface(w, h, { top: '#ffffff', mid: '#ffffff', bot: '#ffffff', a: [0, 0], edge: '#ffffff', edgeA: 0.85, r, gloss: 0.5, glossH: Math.min(26, Math.round(h * 0.38)), curve: 6, rim: 0.7, glow: 0 });
}

const CHIP_H = () => (BIGUI() ? 21 : 17);
function chip(ctx, x, y, w, icon, text, o = {}) {
  const h = CHIP_H();
  ctx.drawImage(aeroCached(`dexchip|${w}|${h}|${o.tone || 'white'}`, () => aeroSurface(w, h, { tone: o.tone || 'white', r: 'pill', gloss: 0.65, glossH: Math.round(h * 0.45), curve: 1, rim: 0.85, glow: 0.45 })), x, y);
  const ic = getUiIcon(icon);
  ctx.drawImage(ic, x + 6, y + Math.round((h - ic.height) / 2));
  let font = F1();
  let t = String(text);
  if (font === 'big' && measureText(t, font) > w - ic.width - 15) font = 'normal';
  while (t.length > 2 && measureText(t, font) > w - ic.width - 15) t = t.slice(0, -1);
  if (t !== String(text)) t = t.slice(0, -1) + '.';
  drawText(ctx, t, x + ic.width + 10, y + Math.round((h - capH(font)) / 2), { font, color: o.color || INK });
}

function heartPip(on) {
  return aeroCached(`hpip|${on}`, () => {
    const c = makeCanvas(7, 6), g = ctxOf(c);
    const rows = ['.xx.xx.', 'xhxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = on ? (ch === 'h' ? '#ffe0e8' : y > 3 ? '#d81e4a' : '#ff4a6a') : (y > 3 ? '#9cc4dc' : '#c4def0');
      g.fillRect(x, y, 1, 1);
    }));
    return c;
  });
}

// ---------------------------------------------------------------- panel

export class JournalPanel {
  constructor() {
    this.id = 'journal';
    this.modal = true;
    this.sound = 'ui_page';
    this.t = 0;
    this.biome = 'shallows';
    this.sel = null;
    this.swapT = 1;
    this.gridT = 1;
  }

  biomes() {
    return BIOMES.filter((b) => SPECIES.some((s) => s.biome === b.id));
  }

  list(biome) {
    return SPECIES.filter((s) => s.biome === biome).sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
  }

  entry(id) { return this.game.state.journal?.[id] || null; }
  known(id) { const j = this.entry(id); return j?.caught > 0 ? 'caught' : j?.seen ? 'seen' : 'unknown'; }

  open(data) {
    const g = this.game;
    this.t = 0;
    const want = data?.species && SPECIES_BY_ID[data.species];
    this.biome = want ? want.biome : g.ocean?.biome?.id || g.state.biome || 'shallows';
    if (!this.biomes().some((b) => b.id === this.biome)) this.biome = this.biomes()[0]?.id || 'shallows';
    const list = this.list(this.biome);
    this.sel = want ? want.id : (list.find((s) => this.known(s.id) === 'caught') || list[0])?.id;
    this.swapT = 0;
    this.gridT = 0;
    this.emo = 'happy';
    this.emoT = 0;
  }

  select(id) {
    if (id === this.sel) return;
    const sp = SPECIES_BY_ID[id];
    if (!sp) return;
    if (sp.biome !== this.biome) { this.biome = sp.biome; this.gridT = 0; }
    this.sel = id;
    this.swapT = 0;
    this.emo = 'happy';
    this.emoT = 0;
    this.game.audio.play('bubble', { pitch: 1.2, vol: 0.6 });
  }

  step(d) {
    const all = this.biomes().flatMap((b) => this.list(b.id));
    const i = all.findIndex((s) => s.id === this.sel);
    if (all.length) this.select(all[(i + d + all.length) % all.length].id);
  }

  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input;
    dt = Math.max(0, dt);
    this.t += dt;
    this.swapT = Math.min(1, this.swapT + dt * 4);
    this.gridT = Math.min(1, this.gridT + dt * 3.5);
    this.emoT += dt;
    const big = BIGUI(), f1 = F1(), f2 = F2();
    const r = panelRect(g, big ? 780 : 720, big ? 470 : 440);
    const W = r.w, H = r.h;
    this.rect = r;
    const F = drawAeroFrame(ctx, r.x, r.y, W, H, { title: 'FishDex', icon: getBigIcon('journal', { size: big ? 30 : 'small' }).canvas, seed: 11 });
    if (ui.button(ctx, F.close.x, F.close.y, F.close.w, F.close.h, '', { icon: 'cross', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    // completion meter in the header
    const total = SPECIES.length, got = SPECIES.filter((s) => this.known(s.id) === 'caught').length;
    const mw = big ? 96 : 76, mx = r.x + W - (big ? 186 : 150), my = r.y + (big ? 10 : 11);
    drawAeroBar(ctx, mx, my + 1, mw, big ? 10 : 8, got / Math.max(1, total), { color: '#7ee04a' });
    drawText(ctx, `${got}/${total}`, mx + mw + 6, my + (big ? 0 : 0), { font: f1, color: '#ffffff', shadow: '#0a3e74' });
    if (ui.hover({ x: mx, y: my - 2, w: mw + 40, h: 16 })) ui.tip = 'Species caught';

    // ocean tabs
    let tx = F.content.x;
    const ty = F.content.y;
    for (const b of this.biomes()) {
      const active = b.id === this.biome;
      const unlocked = g.state.unlockedBiomes?.includes(b.id) ?? true;
      const th = big ? 25 : 20;
      const tw = measureText(b.tab, f1) + (big ? 34 : 28);
      const tr = { x: tx, y: ty, w: tw, h: th };
      const hov = ui.hover(tr) && !active;
      drawTab(ctx, tr.x, tr.y, tr.w, tr.h, { label: b.tab, icon: unlocked ? b.icon : 'lock', active, hover: hov, color: b.color });
      if (ui.hover(tr)) {
        const list = this.list(b.id);
        ui.tip = `${b.name}  ${list.filter((s) => this.known(s.id) === 'caught').length}/${list.length}`;
      }
      if (hov && inp.pressed) {
        inp.pressed = false;
        g.audio.play('ui_tab');
        const list = this.list(b.id);
        this.biome = b.id;
        this.gridT = 0;
        const first = list.find((s) => this.known(s.id) === 'caught') || list[0];
        if (first) { this.sel = first.id; this.swapT = 0; }
      }
      tx += tw + 2;
    }

    const tabH = big ? 25 : 20;
    const cy = ty + tabH, ch = F.content.h - tabH;
    const lw = Math.round(F.content.w * 0.47);
    const L = { x: F.content.x, y: cy, w: lw, h: ch };
    const R = { x: F.content.x + lw + 6, y: cy, w: F.content.w - lw - 6, h: ch };
    drawAeroCard(ctx, L.x, L.y, L.w, L.h, { seed: 4 });
    drawAeroCard(ctx, R.x, R.y, R.w, R.h, { seed: 5 });
    this.drawGrid(ctx, ui, L);
    this.drawDetail(ctx, ui, R);
    F.finish();

    if (inp.keyPressed('ArrowRight')) this.step(1);
    if (inp.keyPressed('ArrowLeft')) this.step(-1);
  }

  // ------------------------------------------------ left: species grid
  gridCells(L) {
    const list = this.list(this.biome);
    const n = list.length;
    const cols = n > 20 ? 6 : n > 12 ? 5 : 4;
    const rows = Math.max(1, Math.ceil(n / cols));
    const top = BIGUI() ? 32 : 30, pad = 8, gap = BIGUI() ? 5 : 4;
    const cw = Math.floor((L.w - pad * 2 - (cols - 1) * gap) / cols);
    const chh = Math.min(Math.round(cw * 1.05), Math.floor((L.h - top - pad - (rows - 1) * gap) / rows));
    return list.map((sp, i) => ({ sp, x: L.x + pad + (i % cols) * (cw + gap), y: L.y + top + Math.floor(i / cols) * (chh + gap), w: cw, h: chh, i }));
  }

  drawGrid(ctx, ui, L) {
    const g = this.game, inp = g.input;
    const B = BIOME_BY_ID[this.biome] || BIOMES[1];
    const list = this.list(this.biome);
    const caught = list.filter((s) => this.known(s.id) === 'caught').length;
    // header: ocean name + progress
    const big = BIGUI(), f1 = F1(), f2 = F2();
    const ic = getUiIcon(B.icon, big ? 2 : 1);
    const hy = L.y + (big ? 7 : 8);
    ctx.drawImage(ic, L.x + 8, hy + Math.round((capH(f1) - ic.height) / 2) + (big ? 1 : 0));
    drawText(ctx, B.name, L.x + 13 + ic.width, hy + 1, { font: f1, color: INK, shadow: '#ffffff' });
    const cw = measureText(`${caught}/${list.length}`, f2);
    drawAeroBar(ctx, L.x + L.w - cw - 70, hy + 1 + Math.round((capH(f1) - 7) / 2), 54, big ? 9 : 7, caught / Math.max(1, list.length), { color: B.color });
    drawText(ctx, `${caught}/${list.length}`, L.x + L.w - 8, hy + 1 + Math.round((capH(f1) - capH(f2)) / 2), { align: 'right', font: f2, color: INK_SOFT });
    if (caught === list.length && list.length) drawText(ctx, '{crown}', L.x + L.w - cw - 84, hy, {});
    const cells = this.gridCells(L);
    const k = ease.outCubic(this.gridT);
    for (const cl of cells) {
      const delay = clamp01(k * 1.6 - (cl.i / Math.max(1, cells.length)) * 0.6);
      if (delay <= 0) continue;
      const rr = { x: cl.x, y: cl.y, w: cl.w, h: cl.h };
      const hov = ui.hover(rr);
      ctx.globalAlpha = delay;
      this.drawCell(ctx, cl, hov, Math.round((1 - delay) * 8));
      ctx.globalAlpha = 1;
      if (hov) ui.tip = this.known(cl.sp.id) === 'caught' ? `${cl.sp.name}  ${RARITY[cl.sp.rarity]?.name || ''}` : '???';
      if (hov && inp.pressed) {
        inp.pressed = false;
        if (cl.sp.id !== this.sel) this.select(cl.sp.id);
        else this.poke(cl.sp);
      }
    }
  }

  drawCell(ctx, cl, hov, dy = 0) {
    const sp = cl.sp, k = this.known(sp.id), rar = RARITY[sp.rarity] || RARITY.common;
    const t = this.t + hash1(sp.id.length, sp.id.charCodeAt(0)) * 5;
    const sel = sp.id === this.sel;
    const B = BIOME_BY_ID[sp.biome] || BIOMES[1];
    const x = cl.x, y = cl.y + dy - (hov ? 1 : 0), w = cl.w, h = cl.h;
    if (sel) drawAeroGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h) * 0.8, '#8ff6ff', 0.55);
    if (k === 'caught') {
      ctx.drawImage(aeroCached(`dexcell|${w}|${h}|${B.id}`, () => {
        const c = waterTex(w, h, B, 6);
        ctxOf(c).drawImage(glassOver(w, h, 6), 0, 0);
        return c;
      }), x, y);
    } else {
      ctx.drawImage(aeroCached(`dexcellu|${w}|${h}|${k}`, () => aeroSurface(w, h, { top: '#f4fbff', mid: '#dcedf6', bot: '#c0d8e8', edge: '#8ab0c8', r: 6, gloss: 0.5, glossH: Math.round(h * 0.4), curve: 2, rim: 0.8, glow: 0.3, inset: true, a: [0.9, 0.9] })), x, y);
    }
    if (sp.rarity === 'legendary' || sp.rarity === 'epic') {
      ctx.fillStyle = rgba(rar.color, k === 'caught' ? 0.9 : 0.35);
      ctx.fillRect(x + 4, y + h - 2, w - 8, 1);
    }
    if (hov && k === 'caught') { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); }
    const s = fitScale(sp, w - 8, h - 8, 1.5);
    const g = this.game;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
    if (k === 'caught') {
      drawFishFit(ctx, sp, x + w / 2, y + h / 2, s, t, { lookX: hov ? g.input.x : null, lookY: hov ? g.input.y : null, emotion: hov ? 'happy' : 'neutral', blink: (t % 4) < 0.12 ? 1 : 0 });
    } else {
      ctx.globalAlpha *= k === 'seen' ? 0.85 : 0.6; // [phase3:fish] dark voxel silhouettes stay readable (not pale blobs)
      drawFishFit(ctx, sp, x + w / 2, y + h / 2, s, k === 'seen' ? t : 0.3, { silhouette: SIL, speed01: 0.1 });
      ctx.globalAlpha = 1;
      drawText(ctx, '?', x + w / 2, y + h / 2 - (BIGUI() ? 5 : 4), { font: F1(), align: 'center', color: '#ffffff', outline: SIL });
    }
    ctx.restore();
    if (k === 'caught') {
      const gem = gemIcon(rar.color, BIGUI() ? 13 : 10);
      if (gem) { ctx.drawImage(gem, x + 2, y + 2); if (rar.stars > 1) drawText(ctx, String(rar.stars), x + 3 + gem.width, y + 4, { font: 'small', color: '#ffffff', outline: shade(rar.color, -0.55) }); }
      else for (let i = 0; i < rar.stars; i++) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 4 + i * 4, y + 4, 3, 3); ctx.fillStyle = rar.color; ctx.fillRect(x + 5 + i * 4, y + 5, 1, 1); }
      if (this.entry(sp.id)?.variants?.shiny && (t * 1.3) % 2 < 0.25) drawSparkle(ctx, x + w - 6, y + 6, 2, 1);
    }
    if (sel) {
      ctx.drawImage(aeroCached(`dexsel|${w}|${h}`, () => {
        const c = makeCanvas(w + 4, h + 4), q = ctxOf(c);
        q.fillStyle = '#ffffff';
        q.fillRect(3, 0, w - 2, 2); q.fillRect(3, h + 2, w - 2, 2); q.fillRect(0, 3, 2, h - 2); q.fillRect(w + 2, 3, 2, h - 2);
        q.fillRect(1, 1, 2, 2); q.fillRect(w + 1, 1, 2, 2); q.fillRect(1, h + 1, 2, 2); q.fillRect(w + 1, h + 1, 2, 2);
        return c;
      }), x - 2, y - 2);
    }
  }

  poke(sp) {
    const g = this.game;
    this.emo = ['surprised', 'happy', 'love', 'smug', 'dizzy'][Math.floor(Math.random() * 5)];
    this.emoT = 0;
    this.emoStamp = sp.id;
    if (sp.sound) g.audio.play(sp.sound, { vol: 0.7 });
    else g.audio.play('blub');
  }

  // ------------------------------------------------ right: species card
  drawDetail(ctx, ui, R) {
    const g = this.game, inp = g.input;
    const sp = SPECIES_BY_ID[this.sel];
    if (!sp) return;
    const k = this.known(sp.id), j = this.entry(sp.id);
    const rar = RARITY[sp.rarity] || RARITY.common;
    const B = BIOME_BY_ID[sp.biome] || BIOMES[1];
    const caught = k === 'caught';
    const pop = ease.outCubic(this.swapT);
    const BU = BIGUI(), f1 = F1(), f2 = F2();
    const x = R.x + 10, w = R.w - 20;
    let y = R.y + 8 + Math.round((1 - pop) * 6);
    ctx.globalAlpha = 0.35 + 0.65 * pop;
    // name + number + stars
    const name = caught ? sp.name : '???';
    const nf = BU && measureText(name, 'big', 2) <= w - 40 ? ['big', 2] : measureText(name, 'normal', 2) <= w - 40 ? ['normal', 2] : [f1, 1];
    drawText(ctx, name, x, y, { font: nf[0], scale: nf[1], color: INK, shadow: '#ffffff', wave: caught && sp.rarity === 'legendary' ? 1 : 0, time: this.t });
    const list = this.list(sp.biome);
    drawText(ctx, `#${String(list.indexOf(sp) + 1).padStart(2, '0')}`, x + w, y + 2, { align: 'right', font: f2, color: INK_FAINT });
    y += capH(nf[0]) * nf[1] + 5;
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = (0.35 + 0.65 * pop) * (caught || i >= rar.stars ? 1 : 0.4);
      ctx.drawImage(getUiIcon(i < rar.stars ? 'star' : 'star_empty'), x + i * 11, y);
    }
    ctx.globalAlpha = 0.35 + 0.65 * pop;
    if (caught) {
      const rf = BU ? 'normal' : 'small';
      const rl = BU ? rar.name : rar.name.toUpperCase();
      const gem = gemIcon(rar.color, BU ? 16 : 12);
      const gw = gem ? gem.width - 2 : 0;
      const rh = capH(rf) + 6, rw = measureText(rl, rf) + 12 + gw;
      ctx.drawImage(aeroCached(`dexrar|${rw}|${rh}|${sp.rarity}`, () => aeroSurface(rw, rh, { tone: toneFrom(rar.color), r: 'pill', gloss: 0.8, glossH: Math.round(rh * 0.45), curve: 1, rim: 0.7, glow: 0.6 })), x + 60, y - 1);
      if (gem) ctx.drawImage(gem, x + 60 + 2, y - 1 + Math.round((rh - gem.height) / 2));
      const lightPill = luminance(rar.color) > 0.62;
      drawText(ctx, rl, x + 66 + gw, y - 1 + Math.round((rh - capH(rf)) / 2), { font: rf, color: lightPill ? INK : '#ffffff', shadow: lightPill ? null : shade(rar.color, -0.6) });
      if (j?.variants?.shiny) chip(ctx, x + w - (BU ? 72 : 58), y - 3, BU ? 72 : 58, 'sparkle', 'Shiny', { tone: 'orange', color: '#ffffff' });
    }
    y += BU ? 17 : 14;

    // aquarium window
    const lower = caught ? (BU ? 138 : 118) : 60;
    const ih = clamp(R.y + R.h - lower - y - (BU ? 62 : 54), 70, 170);
    const iw = w;
    ctx.drawImage(aeroCached(`dexwin|${iw}|${ih}|${B.id}`, () => waterTex(iw, ih, B, 12)), x, y);
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, y + 2, iw - 4, ih - 4); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 4; i++) {
      const bx = x + ((i * 83 + this.t * 6) % (iw + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + 18, y); ctx.lineTo(bx - 12, y + ih); ctx.lineTo(bx - 30, y + ih); ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      const q = (this.t * 0.18 + i / 6) % 1;
      drawAeroBubble(ctx, x + 12 + ((i * 53) % (iw - 24)) + Math.sin(this.t * 2 + i) * 2, y + ih - 6 - q * (ih - 6), 1.5 + (i % 3), Math.sin(q * Math.PI));
    }
    const s = fitScale(sp, iw - 30, ih - 22, 3);
    const fcx = x + iw / 2, fcy = y + ih / 2 - 2;
    const ir = { x, y, w: iw, h: ih };
    const ihov = ui.hover(ir);
    if (caught) {
      const emotion = this.emoT < 1.6 && this.emoStamp === this.sel ? this.emo : ihov ? 'happy' : 'neutral';
      drawFishFit(ctx, sp, fcx, fcy, s, this.t, {
        lookX: inp.x, lookY: inp.y, emotion, speed01: 0.5,
        blink: (this.t % 3.3) < 0.1 ? 1 : 0, mouth: this.emoT < 0.6 && this.emoStamp === this.sel ? Math.abs(Math.sin(this.t * 10)) * 0.7 : 0,
        squash: this.emoT < 0.4 && this.emoStamp === this.sel ? Math.sin(this.emoT * 30) * 0.15 : 0,
      });
      if (ihov && inp.pressed) { inp.pressed = false; this.poke(sp); }
    } else {
      ctx.globalAlpha *= k === 'seen' ? 0.9 : 0.5;
      drawFishFit(ctx, sp, fcx, fcy, s, this.t * (k === 'seen' ? 1 : 0.2), { silhouette: sp.biome === 'abyss' ? '#05060e' : SIL });
      ctx.globalAlpha = 0.35 + 0.65 * pop;
      drawText(ctx, '?', fcx, fcy - 7, { align: 'center', scale: 2, color: '#ffffff', outline: SIL });
    }
    ctx.restore();
    ctx.drawImage(aeroCached(`dexwing|${iw}|${ih}`, () => glassOver(iw, ih, 12)), x, y);
    y += ih + 6;

    // icon chips: habitat, time, size, weight
    const act = ACTIVITY[sp.activity] || ACTIVITY.any;
    const dep = sp.move?.depth ? (sp.move.depth[0] + sp.move.depth[1]) / 2 : 0.5;
    const depthTxt = sp.move?.style === 'crawl' ? 'Seabed' : dep < 0.3 ? 'Surface' : dep < 0.62 ? 'Mid-water' : 'Deep';
    const half = Math.floor((w - 4) / 2);
    const CH = CHIP_H();
    chip(ctx, x, y, half, 'map', k === 'unknown' ? '???' : depthTxt);
    chip(ctx, x + half + 4, y, half, act[0], k === 'unknown' ? '???' : act[1]);
    y += CH + 3;
    chip(ctx, x, y, half, 'fish', caught ? `${sp.size[0]}-${sp.size[1]} cm` : '???');
    chip(ctx, x + half + 4, y, half, 'trophy', caught ? `${fmtKg(sp.weight[0])}-${fmtKg(sp.weight[1])} kg` : '???');
    y += CH + 6;

    if (!caught) {
      const lh = BU ? 13 : 10;
      const lines = wrapText(hintFor(sp), w, f1).slice(0, 3);
      lines.forEach((l, i) => drawText(ctx, l, x, y + i * lh, { font: f1, color: INK_SOFT }));
      ctx.globalAlpha = 1;
      return;
    }
    // one short line of flavour
    const desc = wrapText(sp.desc || sp.behavior || '', w, f1);
    if (desc.length) {
      let l = desc[0];
      if (desc.length > 1) {
        l = l.replace(/[\s,.;:]*$/, '') + '...';
        while (l.length > 4 && measureText(l, f1) > w) l = l.slice(0, -4).replace(/[\s,.;:]*$/, '') + '...';
      }
      drawText(ctx, l, x, y, { font: f1, color: INK_SOFT });
      if (desc.length > 1 && ui.hover({ x, y: y - 2, w, h: capH(f1) + 4 })) ui.tip = sp.desc || sp.behavior;
      y += capH(f1) + 6;
    }
    // bait tastes
    const RW = BU ? 20 : 16; // row height for the bait / fight rows
    ctx.drawImage(getUiIcon('bait'), x, y + Math.round((RW - 10) / 2));
    const prefs = Object.entries(sp.bait || {}).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let bx = x + 14;
    for (const [type, v] of prefs) {
      const special = !!BAITS[type] && !BAITS[type].app;
      let spr = null;
      try { spr = special ? baitSprite(type, this.t) : getMiniIcon(TYPE_ICON[type] || 'documents'); } catch { spr = null; }
      const br = { x: bx, y: y, w: 38, h: RW };
      if (spr) ctx.drawImage(spr, bx + Math.round((14 - spr.width) / 2), y + Math.round((RW - spr.height) / 2));
      for (let i = 0; i < 3; i++) ctx.drawImage(heartPip(i < v), bx + 15 + i * 7, y + Math.round((RW - 6) / 2));
      if (ui.hover(br)) ui.tip = `${BAITS[type]?.name || TYPE_NAME[type] || type}: ${['', 'likes', 'loves', "can't resist"][Math.min(3, Math.round(v))]}`;
      bx += 41;
      if (bx > x + w - 38) break;
    }
    if (!prefs.length) drawText(ctx, 'Anything!', bx, y + Math.round((RW - capH(f1)) / 2), { font: f1, color: INK_SOFT });
    y += RW + 3;
    // fight phases + power
    ctx.drawImage(getUiIcon('reel'), x, y + Math.round((RW - 10) / 2));
    let fx = x + 14;
    (sp.fight?.phases || []).forEach((ph, i) => {
      const P = PHASES[ph] || { icon: 'question', name: ph };
      ctx.drawImage(aeroCached(`dexph|${RW}`, () => aeroSurface(RW, RW, { tone: 'sky', r: 5, gloss: 0.75, glossH: Math.round(RW * 0.45), curve: 1, rim: 0.8, glow: 0.6 })), fx, y);
      const pi = getUiIcon(P.icon);
      ctx.drawImage(pi, fx + Math.round((RW - pi.width) / 2), y + Math.round((RW - pi.height) / 2));
      if (ui.hover({ x: fx, y, w: RW, h: RW })) ui.tip = `${i + 1}. ${P.name}`;
      fx += RW + 3;
    });
    const pw = Math.round((sp.fight?.power || 0) * 5);
    for (let i = 0; i < 5; i++) {
      const pw2 = BU ? 8 : 6, ph2 = BU ? 11 : 8;
      ctx.drawImage(aeroCached(`dexpow|${i < pw}|${pw2}`, () => aeroSurface(pw2, ph2, { tone: i < pw ? 'red' : 'grey', r: 2, gloss: 0.7, glossH: 3, rim: 0.4, glow: 0.4 })), x + w - (pw2 + 1) * 5 - 1 + i * (pw2 + 1), y + Math.round((RW - ph2) / 2));
    }
    if (ui.hover({ x: x + w - 50, y, w: 50, h: RW })) ui.tip = 'Power';
    y += RW + 5;
    // records + variants
    const vs = Object.keys(j.variants || {}).filter((v) => j.variants[v] && v !== 'shiny');
    const third = Math.floor((w - 8) / 3);
    chip(ctx, x, y, third, 'check', `x${j.caught}`);
    chip(ctx, x + third + 4, y, third, 'trophy', `${fmtCm(j.maxSize)} cm`);
    chip(ctx, x + third * 2 + 8, y, third, 'clock', fmtDate(j.first));
    if (ui.hover({ x, y, w: third, h: CH })) ui.tip = 'Caught';
    if (ui.hover({ x: x + third + 4, y, w: third, h: CH })) ui.tip = 'Biggest';
    if (ui.hover({ x: x + third * 2 + 8, y, w: third, h: CH })) ui.tip = 'First catch';
    y += CH + 3;
    let vx = x;
    for (const v of vs) {
      const label = MUTATIONS[v]?.name || v;
      const tw = measureText(label, 'small') + 12;
      if (vx + tw > x + w) break;
      const c = MUT_COLOR[v] || '#c8a0e8';
      ctx.drawImage(aeroCached(`dexmut|${tw}|${c}`, () => aeroSurface(tw, 11, { tone: toneFrom(c), r: 'pill', gloss: 0.8, glossH: 5, curve: 1, rim: 0.7, glow: 0.5 })), vx, y);
      drawText(ctx, label.toUpperCase(), vx + 6, y + 3, { font: 'small', color: '#ffffff', shadow: shade(c, -0.6) });
      vx += tw + 3;
    }
    ctx.globalAlpha = 1;
  }
}

function fmtKg(v) { return v < 0.1 ? v.toFixed(3).replace(/0+$/, '') : v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString(); }
function fmtCm(v) { return v >= 9999 || !v ? '-' : (Math.round(v * 10) / 10).toString(); }
function fmtDate(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return '-'; }
}

function hintFor(sp) {
  const s = sp.spawn || {};
  const B = BIOME_BY_ID[sp.biome];
  const bits = [];
  if (s.weather) bits.push(WEATHER_HINT[s.weather] || s.weather);
  if (s.time === 'night' || sp.activity === 'night') bits.push('night');
  else if (s.time === 'day') bits.push('daylight');
  if (s.requires === 'golden') bits.push('Golden Bait');
  else if (s.requires) bits.push('special bait');
  return `${B?.name || 'Somewhere'}${bits.length ? ' - ' + bits.join(', ') : ''}`;
}

void clamp01; void TYPE_NAME;
