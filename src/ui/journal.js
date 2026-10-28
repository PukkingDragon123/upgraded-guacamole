// Fish Journal: a leather-bound encyclopedia. Bookmark tabs per biome, left page = species grid
// (caught fish swim, unknown ones are ink silhouettes), right page = detail sheet with a big animated
// illustration, field notes, bait tastes, fight phases, personal records and variants.
// Biome changes turn the whole spread (bendy page flip); picking another species peels the right page.
// open({species}) jumps to a species.

import { clamp, clamp01, ease, hash1, hash2, TAU } from '../core/math.js';
import { RARITY, RARITY_ORDER, rgba, shade, mix, pack, ramp } from '../core/color.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawPaper, drawFrame, drawBar } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getMiniIcon } from '../desktop/icons.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { rigGeom } from '../gfx/fishart.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { MUTATIONS } from '../fish/traits.js';
import { BAITS } from '../game/shopdata.js';
import { baitSprite } from '../fishing/baitart.js';

const BIOMES = [
  { id: 'shallows', name: 'Sunny Shallows', tab: 'Shallows', color: '#3aa0c8', icon: 'sun', water: ['#9ae4f4', '#3a9ec8'] },
  { id: 'junkyard', name: 'Junkyard Reef', tab: 'Junkyard', color: '#6e9a44', icon: 'gear', water: ['#8ab8a0', '#3a6a5a'] },
  { id: 'abyss', name: 'The Midnight Abyss', tab: 'Abyss', color: '#6a4ab0', icon: 'moon', water: ['#2a3a6a', '#0a0e24'] },
];
const BIOME_BY_ID = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

const INK = '#3a2516', INK_SOFT = '#7a5a40', INK_FAINT = '#b89a74', PENCIL = '#c8402e';
const SIL = '#4a3526';

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
  shiny: '#ffe27a', albino: '#f4eee8', melanistic: '#4a3a50', pastel: '#ffc8e8', neon: '#5affc8', golden: '#ffcc3a',
  crimson: '#e0303a', ocean: '#3a8ae0', ghost: '#c8e4ff', inverted: '#9a6aff', galaxy: '#7a4ad0',
};
const ACTIVITY = { day: ['sun', 'Daytime'], night: ['moon', 'Night owl'], dusk: ['cloud', 'Dusk & dawn'], any: ['clock', 'Any time'] };
const WEATHER_HINT = { storm: 'during storms', clear: 'on clear sunny days', rain: 'in the rain', murky: 'in murky water', static: 'during static storms', datarain: 'in data rain', snow: 'in marine snow', glowtide: 'at glow tide' };

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

// ---------------------------------------------------------------- book art

function bookTex(W, H) {
  const b = new PixelBuffer(W, H);
  const L = ['#24090a', '#43140f', '#5e2216', '#7a321e', '#94482a', '#b0643a'].map((h) => pack(h));
  const G = ['#5a3410', '#9a6418', '#d8a030', '#f4cc5a', '#fff0a8'].map((h) => pack(h));
  const R = 6;
  const inside = (x, y) => {
    const cx = x < R ? R : x >= W - R ? W - R - 1 : x, cy = y < R ? R : y >= H - R ? H - R - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    if (edge) { b.set(x, y, L[0]); continue; }
    let v = 3 - y / H * 1.1 + (hash2(x >> 1, y >> 1, 5) - 0.5) * 0.7 + (hash2(x, y, 9) - 0.5) * 0.4;
    if (y < 3 || x < 3) v += 0.8;
    if (y > H - 4 || x > W - 4) v -= 0.8;
    const sd = Math.abs(x - W / 2);
    if (sd < 5) v = sd < 2 ? 1.2 : 2;
    b.set(x, y, L[clamp(Math.floor(v), 0, 5)]);
  }
  // stitching
  for (let x = 8; x < W - 8; x++) if ((x >> 1) % 2 === 0) { b.set(x, 3, pack('#d8a874')); b.set(x, H - 4, pack('#c8945e')); }
  for (let y = 8; y < H - 8; y++) if ((y >> 1) % 2 === 0) { b.set(3, y, pack('#d8a874')); b.set(W - 4, y, pack('#c8945e')); }
  // gold corner caps
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [W - 1, 0, -1, 1], [0, H - 1, 1, -1], [W - 1, H - 1, -1, -1]]) {
    for (let i = 0; i < 14; i++) for (let j = 0; j < 14 - i; j++) {
      const x = cx + sx * i, y = cy + sy * j;
      if (!inside(x, y)) continue;
      const v = i + j > 11 ? 0 : i === 0 || j === 0 ? 4 : (i + j) % 5 === 0 ? 1 : 2.6 - (sx * i + sy * j) * 0.05;
      b.set(x, y, G[clamp(Math.floor(v), 0, 4)]);
    }
  }
  // page stack edges under each page
  const P = ['#c8ac80', '#e2cfa8', '#b89a6c', '#f0e2c0'].map((h) => pack(h));
  const half = Math.floor(W / 2);
  for (let k = 1; k <= 3; k++) {
    for (let x = 9; x < half - 3; x++) b.set(x, H - 10 + k, P[k % 4]);
    for (let x = half + 3; x < W - 9; x++) b.set(x, H - 10 + k, P[(k + 1) % 4]);
    for (let y = 9; y < H - 8; y++) { b.set(9 - k, y, P[k % 4]); b.set(W - 10 + k, y, P[(k + 1) % 4]); }
  }
  return b.toCanvas();
}

const tiny = new Map();
function heartPip(on) {
  const k = 'h' + on;
  let c = tiny.get(k);
  if (c) return c;
  const b = new PixelBuffer(7, 6);
  const rows = ['.xx.xx.', 'xhxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.') return;
    b.set(x, y, pack(on ? (ch === 'h' ? '#ffd0d0' : y > 3 ? '#a8203a' : '#e8384a') : (y > 3 ? '#a89070' : '#c8b090')));
  }));
  c = b.toCanvas();
  tiny.set(k, c);
  return c;
}

// Hand-drawn pencil circle around a rect (stable wobble per seed).
function pencilCircle(ctx, x, y, w, h, seed, progress = 1) {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2 + 2, ry = h / 2 + 2;
  const end = TAU * 1.08 * progress;
  ctx.fillStyle = PENCIL;
  let px = null, py = null;
  for (let a = 0; a < end; a += 0.03) {
    const wob = 1 + (hash1(Math.floor(a * 3), seed) - 0.5) * 0.04 + a * 0.012;
    const X = Math.round(cx + Math.cos(a - 2.2) * rx * wob), Y = Math.round(cy + Math.sin(a - 2.2) * ry * wob);
    if (X !== px || Y !== py) ctx.fillRect(X, Y, 1, 1);
    px = X; py = Y;
  }
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
    this.flip = null;
    this.pool = {};
  }

  list(biome) {
    return SPECIES.filter((s) => s.biome === biome).sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
  }

  entry(id) { return this.game.state.journal[id] || null; }
  known(id) { const j = this.entry(id); return j?.caught > 0 ? 'caught' : j?.seen ? 'seen' : 'unknown'; }

  open(data) {
    const g = this.game;
    this.t = 0;
    const want = data?.species && SPECIES_BY_ID[data.species];
    this.biome = want ? want.biome : g.ocean?.biome?.id || g.state.biome || 'shallows';
    if (!BIOME_BY_ID[this.biome]) this.biome = 'shallows';
    const list = this.list(this.biome);
    this.sel = want ? want.id : (list.find((s) => this.known(s.id) === 'caught') || list[0]).id;
    this.selT = 0;
    this.emo = 'happy';
    this.emoT = 0;
    this.flip = null;
    this.openFlip = !g.state.settings?.reducedMotion;
  }

  geom(g) {
    const W = Math.min(g.screen.W - 24, 720), H = Math.min(g.screen.H - 62, 440);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) + 6, w: W, h: H };
    const half = Math.floor(W / 2);
    const pw = half - 13, ph = H - 19;
    return { r, pw, ph, L: { x: r.x + 10, y: r.y + 8 }, R: { x: r.x + half + 3, y: r.y + 8 }, spine: r.x + half };
  }

  canvas(name, w, h) {
    let c = this.pool[name];
    if (!c || c.width !== w || c.height !== h) { c = this.pool[name] = makeCanvas(w, h); c._g = ctxOf(c); }
    c._g.setTransform(1, 0, 0, 1, 0, 0);
    c._g.clearRect(0, 0, w, h);
    return c;
  }

  snapshot(name, which, G, blank = false) {
    const c = this.canvas(name, G.pw + 2, G.ph + 3);
    if (blank) drawPaper(c._g, 0, 0, G.pw, G.ph, { aged: true });
    else if (which === 'L') this.drawLeft(c._g, 0, 0, G.pw, G.ph, false);
    else this.drawRight(c._g, 0, 0, G.pw, G.ph, false);
    return c;
  }

  turn(kind, dir, mutate) {
    const g = this.game, G = this.geom(g);
    if (g.state.settings?.reducedMotion) { mutate(); g.audio.play('ui_page'); return; }
    const oldL = this.snapshot('oldL', 'L', G), oldR = this.snapshot('oldR', 'R', G);
    mutate();
    this.flip = { kind, dir, t: 0, dur: kind === 'spread' ? 0.62 : 0.32, oldL, oldR };
    g.audio.play('ui_page', { pitch: kind === 'spread' ? 1 : 1.25 });
  }

  select(id) {
    if (id === this.sel) return;
    const sp = SPECIES_BY_ID[id];
    if (sp.biome !== this.biome) {
      const dir = BIOMES.findIndex((b) => b.id === sp.biome) > BIOMES.findIndex((b) => b.id === this.biome) ? 1 : -1;
      this.turn('spread', dir, () => { this.biome = sp.biome; this.sel = id; });
    } else this.turn('page', 1, () => { this.sel = id; });
    this.selT = 0;
    this.emo = 'happy';
    this.emoT = 0;
  }

  step(d) {
    const all = BIOMES.flatMap((b) => this.list(b.id));
    const i = all.findIndex((s) => s.id === this.sel);
    this.select(all[(i + d + all.length) % all.length].id);
  }

  draw(ctx, ui, dt) {
    const g = this.game, inp = g.input;
    dt = Math.max(0, dt);
    this.t += dt;
    this.selT += dt;
    this.emoT += dt;
    const G = this.geom(g);
    const { r } = G;
    this.rect = { x: r.x, y: r.y - 18, w: r.w, h: r.h + 18 };

    // bookmark tabs (behind the cover)
    let tx = r.x + 22;
    for (const b of BIOMES) {
      const active = b.id === this.biome;
      const unlocked = g.state.unlockedBiomes?.includes(b.id) ?? true;
      const tw = measureText(b.tab) + 30;
      const tr = { x: tx, y: r.y - 18, w: tw, h: 22 };
      const hov = !this.flip && ui.hover(tr) && !active;
      this.drawBookmark(ctx, tr, b, active, hov, unlocked);
      if (hov) {
        const got = this.list(b.id).filter((s) => this.known(s.id) === 'caught').length;
        ui.tip = `${b.name}: ${got}/${this.list(b.id).length} caught`;
      }
      if (hov && inp.pressed) {
        inp.pressed = false;
        g.audio.play('ui_tab');
        const dir = BIOMES.indexOf(b) > BIOMES.findIndex((q) => q.id === this.biome) ? 1 : -1;
        const list = this.list(b.id);
        this.turn('spread', dir, () => { this.biome = b.id; this.sel = (list.find((s) => this.known(s.id) === 'caught') || list[0]).id; });
      }
      tx += tw + 3;
    }

    // book
    const key = `${r.w}x${r.h}`;
    if (this.bookKey !== key) { this.bookKey = key; this.book = bookTex(r.w, r.h); }
    ctx.fillStyle = rgba('#06121c', 0.35);
    ctx.fillRect(r.x + 3, r.y + r.h, r.w - 4, 3);
    ctx.drawImage(this.book, r.x, r.y);

    if (this.openFlip) {
      this.openFlip = false;
      const oldL = this.snapshot('oldL', 'L', G, true), oldR = this.snapshot('oldR', 'R', G, true);
      this.flip = { kind: 'spread', dir: 1, t: 0, dur: 0.7, oldL, oldR };
    }

    const f = this.flip;
    if (f) {
      f.t += dt;
      const k = clamp01(f.t / f.dur);
      const th = ease.inOutQuad(k) * (f.kind === 'spread' ? Math.PI : Math.PI / 2);
      if (f.kind === 'spread') {
        const newL = this.snapshot('newL', 'L', G), newR = this.snapshot('newR', 'R', G);
        if (f.dir > 0) {
          ctx.drawImage(f.oldL, G.L.x, G.L.y);
          ctx.drawImage(newR, G.R.x, G.R.y);
          this.gutter(ctx, G);
          this.turning(ctx, G, f.oldR, newL, th, 1);
        } else {
          ctx.drawImage(newL, G.L.x, G.L.y);
          ctx.drawImage(f.oldR, G.R.x, G.R.y);
          this.gutter(ctx, G);
          this.turning(ctx, G, f.oldL, newR, th, -1);
        }
      } else {
        this.drawLeft(ctx, G.L.x, G.L.y, G.pw, G.ph, false);
        const newR = this.snapshot('newR', 'R', G);
        ctx.drawImage(newR, G.R.x, G.R.y);
        this.gutter(ctx, G);
        this.turning(ctx, G, f.oldR, null, th, 1);
      }
      if (k >= 1) this.flip = null;
    } else {
      this.drawLeft(ctx, G.L.x, G.L.y, G.pw, G.ph, true);
      this.drawRight(ctx, G.R.x, G.R.y, G.pw, G.ph, true);
      this.gutter(ctx, G);
    }
    // ribbon bookmark hanging over the bottom edge
    const rx = G.spine + 40;
    ctx.fillStyle = '#7a1424';
    ctx.fillRect(rx, r.y + r.h - 6, 6, 14);
    ctx.fillStyle = '#c8283a';
    ctx.fillRect(rx + 1, r.y + r.h - 6, 4, 13);
    ctx.fillStyle = '#e8506a';
    ctx.fillRect(rx + 1, r.y + r.h - 6, 1, 12);
    // swallowtail cut
    ctx.fillStyle = '#7a1424';
    ctx.fillRect(rx, r.y + r.h + 8, 2, 1); ctx.fillRect(rx + 4, r.y + r.h + 8, 2, 1);

    // close button (brass)
    if (ui.button(ctx, r.x + r.w - 22, r.y - 15, 18, 16, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    // keyboard
    if (!this.flip) {
      if (inp.keyPressed('ArrowRight')) this.step(1);
      if (inp.keyPressed('ArrowLeft')) this.step(-1);
    }
  }

  drawBookmark(ctx, tr, b, active, hov, unlocked) {
    const h = active ? tr.h + 2 : hov ? tr.h - 1 : tr.h - 4;
    const y = tr.y + tr.h - h + (active ? -2 : 0);
    const R = ramp(b.color, 1);
    const col = active ? R : R.map((c) => mix(c, '#5a4a48', 0.35));
    ctx.fillStyle = col[0];
    ctx.fillRect(tr.x, y + 1, tr.w, h + 6);
    ctx.fillRect(tr.x + 1, y, tr.w - 2, 1);
    ctx.fillStyle = col[2];
    ctx.fillRect(tr.x + 1, y + 1, tr.w - 2, h + 5);
    ctx.fillStyle = col[3];
    ctx.fillRect(tr.x + 1, y + 1, tr.w - 2, 2);
    ctx.fillRect(tr.x + 1, y + 1, 1, h + 4);
    ctx.fillStyle = col[1];
    ctx.fillRect(tr.x + tr.w - 2, y + 2, 1, h + 4);
    // stitch line
    ctx.fillStyle = col[4];
    for (let x = tr.x + 3; x < tr.x + tr.w - 3; x += 2) ctx.fillRect(x, y + 3, 1, 1);
    const ic = getUiIcon(unlocked ? b.icon : 'lock');
    ctx.drawImage(ic, tr.x + 5, y + 4);
    drawText(ctx, b.tab, tr.x + 7 + ic.width, y + 6, { color: active ? '#fffaf0' : '#e8dcd0', shadow: shade(b.color, -0.7) });
  }

  gutter(ctx, G) {
    const x = G.spine, y = G.L.y, h = G.ph;
    for (let d = 0; d < 12; d++) {
      const a = Math.pow(1 - d / 12, 2) * 0.32;
      ctx.fillStyle = rgba('#5a3a1c', a);
      ctx.fillRect(x - 3 - d, y, 1, h);
      ctx.fillRect(x + 2 + d, y, 1, h);
    }
    ctx.fillStyle = rgba('#3a2010', 0.55);
    ctx.fillRect(x - 3, y, 1, h);
    ctx.fillRect(x + 2, y, 1, h);
  }

  // Bendy page turn: page hinged at the spine; dir 1 = right page turning left, -1 = left page turning right.
  turning(ctx, G, front, back, th, dir) {
    const pw = G.pw, ph = G.ph, sx = G.spine;
    const c = Math.cos(th), s = Math.sin(th);
    const src = c >= 0 ? front : back;
    if (!src) return;
    const showFront = c >= 0;
    const y0 = G.L.y;
    // shadow on the page below
    const edge = sx + dir * pw * c;
    ctx.fillStyle = rgba('#2a1608', 0.18 * s);
    const sw = Math.round(14 * s);
    if (dir * c > 0) ctx.fillRect(Math.round(Math.min(edge, edge + dir * sw)), y0, sw, ph);
    else ctx.fillRect(Math.round(Math.min(edge, edge - dir * sw)), y0, sw, ph);
    for (let u = 0; u < pw; u++) {
      const k = u / pw;
      const lift = s * Math.pow(k, 1.6) * 16;
      const stretch = 1 + s * 0.05 * k;
      // column inside the source page (the spine side of a right page is its x=0, of a left page its x=pw-1)
      const rightPage = (dir > 0) === showFront;
      const col = rightPage ? u : pw - 1 - u;
      const hh = Math.round(ph * stretch);
      const yy = Math.round(y0 - lift - (hh - ph) / 2);
      // hinge: right-hand pages start at R.x, left-hand pages end at L.x + pw - 1
      const dx = dir * c >= 0 ? Math.round(G.R.x + u * Math.abs(c)) : Math.round(G.L.x + pw - 1 - u * Math.abs(c));
      ctx.drawImage(src, col, 0, 1, ph, dx, yy, 1, hh);
      const shadeA = (1 - Math.abs(c)) * 0.35 + (showFront ? 0 : 0.06) + k * s * 0.08;
      if (shadeA > 0.02) {
        ctx.fillStyle = rgba('#5a3418', Math.min(0.6, shadeA));
        ctx.fillRect(dx, yy, 1, hh);
      }
    }
  }

  // ------------------------------------------------ left page: species grid
  gridCells(w, h) {
    const list = this.list(this.biome);
    const normal = list.filter((s) => s.rarity !== 'legendary'), leg = list.filter((s) => s.rarity === 'legendary');
    const top = 58, left = 12, cols = 4;
    const cw = Math.floor((w - left * 2 - (cols - 1) * 4) / cols);
    const rows = Math.ceil(normal.length / cols);
    const legH = leg.length ? 62 : 0;
    const ch = Math.floor((h - top - 26 - legH - (rows) * 4) / rows);
    const cells = normal.map((sp, i) => ({ sp, x: left + (i % cols) * (cw + 4), y: top + Math.floor(i / cols) * (ch + 4), w: cw, h: ch }));
    leg.forEach((sp, i) => cells.push({ sp, x: left + i * ((w - left * 2) / leg.length), y: top + rows * (ch + 4) + 2, w: Math.floor((w - left * 2) / leg.length), h: legH - 6, legendary: true }));
    return cells;
  }

  drawLeft(ctx, x, y, w, h, live) {
    const g = this.game, inp = g.input, ui = this.ui;
    const B = BIOME_BY_ID[this.biome];
    drawPaper(ctx, x, y, w, h, { aged: true });
    const list = this.list(this.biome);
    const caught = list.filter((s) => this.known(s.id) === 'caught').length;
    const pct = Math.round((caught / list.length) * 100);
    drawText(ctx, B.name, x + 12, y + 10, { scale: 2, color: INK });
    // squiggle underline
    ctx.fillStyle = shade(B.color, -0.2);
    const uw = measureText(B.name, 'normal', 2);
    for (let i = 0; i < uw; i++) ctx.fillRect(x + 12 + i, y + 27 + Math.round(Math.sin(i * 0.35) * 1), 1, 1);
    drawText(ctx, `${caught} of ${list.length} caught`, x + 12, y + 35, { color: INK_SOFT });
    drawText(ctx, `${pct}%`, x + w - 12, y + 35, { align: 'right', color: pct === 100 ? '#b8781a' : INK });
    drawBar(ctx, x + 12, y + 45, w - 24, 6, caught / list.length, { color: B.color, back: '#c8b088', segments: list.length });
    if (pct === 100) drawText(ctx, '{crown}', x + w - 40, y + 33, {});

    const cells = this.gridCells(w, h);
    let hov = null;
    for (const cl of cells) {
      const cx = x + cl.x, cy = y + cl.y;
      const rr = { x: cx, y: cy, w: cl.w, h: cl.h };
      const isHov = live && !this.flip && ui.hover(rr);
      if (isHov) hov = cl;
      this.drawCell(ctx, cl, cx, cy - (isHov ? 1 : 0), isHov);
      if (isHov && inp.pressed) {
        inp.pressed = false;
        if (cl.sp.id !== this.sel) { g.audio.play('ui_click', { vol: 0.6 }); this.select(cl.sp.id); }
        else this.poke(cl.sp);
      }
    }
    // page footer
    drawText(ctx, `- ${BIOMES.findIndex((b) => b.id === this.biome) * 2 + 1} -`, x + w / 2, y + h - 11, { align: 'center', font: 'small', color: INK_FAINT });
    if (live && !this.flip) {
      const pr = { x: x + 6, y: y + h - 18, w: 22, h: 14 };
      const ph = ui.hover(pr);
      ctx.globalAlpha = ph ? 1 : 0.6;
      ctx.drawImage(getUiIcon('arrow_l'), pr.x + 4, pr.y + 1 - (ph ? 1 : 0));
      ctx.globalAlpha = 1;
      if (ph) ui.tip = 'Previous fish (Left arrow)';
      if (ph && inp.pressed) { inp.pressed = false; this.step(-1); }
    }
    return hov;
  }

  drawCell(ctx, cl, x, y, hov) {
    const sp = cl.sp, k = this.known(sp.id), rar = RARITY[sp.rarity];
    const t = this.t + hash1(sp.id.length, sp.id.charCodeAt(0)) * 5;
    const sel = sp.id === this.sel;
    // swatch background
    if (k === 'caught') {
      const B = BIOME_BY_ID[sp.biome];
      ctx.fillStyle = rgba(B.water[0], 0.42);
      ctx.fillRect(x + 1, y + 1, cl.w - 2, cl.h - 2);
      ctx.fillStyle = rgba(B.water[1], 0.22);
      ctx.fillRect(x + 1, y + cl.h - 12, cl.w - 2, 11);
      ctx.fillStyle = rgba(INK, 0.35);
      ctx.fillRect(x + 1, y, cl.w - 2, 1); ctx.fillRect(x + 1, y + cl.h - 1, cl.w - 2, 1);
      ctx.fillRect(x, y + 1, 1, cl.h - 2); ctx.fillRect(x + cl.w - 1, y + 1, 1, cl.h - 2);
    } else {
      ctx.fillStyle = rgba(INK, k === 'seen' ? 0.07 : 0.03);
      ctx.fillRect(x + 1, y + 1, cl.w - 2, cl.h - 2);
      ctx.fillStyle = rgba(INK, 0.3);
      for (let i = 0; i < cl.w; i += 3) { ctx.fillRect(x + i, y, 1, 1); ctx.fillRect(x + i, y + cl.h - 1, 1, 1); }
      for (let i = 0; i < cl.h; i += 3) { ctx.fillRect(x, y + i, 1, 1); ctx.fillRect(x + cl.w - 1, y + i, 1, 1); }
    }
    if (cl.legendary) {
      ctx.fillStyle = rgba(rar.color, k === 'caught' ? 0.35 : 0.12);
      ctx.fillRect(x + 1, y + 1, cl.w - 2, 2);
      ctx.fillRect(x + 1, y + cl.h - 3, cl.w - 2, 2);
    }
    if (hov) { ctx.fillStyle = rgba('#fff8e0', 0.35); ctx.fillRect(x + 1, y + 1, cl.w - 2, cl.h - 2); }
    // fish
    const boxH = cl.h - 14;
    const s = fitScale(sp, cl.w - 8, boxH, cl.legendary ? 1 : 1);
    const fx = x + cl.w / 2, fy = y + 2 + boxH / 2;
    const g = this.game;
    if (k === 'caught') {
      drawFishFit(ctx, sp, fx, fy, s, t, { lookX: hov ? g.input.x : null, lookY: hov ? g.input.y : null, emotion: hov ? 'happy' : 'neutral', blink: (t % 4) < 0.12 ? 1 : 0 });
    } else {
      ctx.globalAlpha = k === 'seen' ? 0.85 : 0.22;
      drawFishFit(ctx, sp, fx, fy, s, k === 'seen' ? t : 0.3, { silhouette: SIL, speed01: 0.1 });
      ctx.globalAlpha = 1;
      drawText(ctx, '?', fx, fy - 3, { align: 'center', color: k === 'seen' ? '#f4e6c8' : INK_SOFT, scale: k === 'seen' ? 1 : 2 });
    }
    // label
    const name = k === 'caught' ? sp.name : '???';
    let label = name.toUpperCase();
    while (measureText(label, 'small') > cl.w - 6 && label.length > 3) label = label.slice(0, -1);
    if (label !== name.toUpperCase()) label = label.slice(0, -1) + '.';
    drawText(ctx, label, x + cl.w / 2, y + cl.h - 9, { align: 'center', font: 'small', color: k === 'caught' ? INK : INK_FAINT });
    if (k === 'caught') {
      for (let i = 0; i < rar.stars; i++) { ctx.fillStyle = rar.dark; ctx.fillRect(x + 3 + i * 3, y + 3, 2, 2); ctx.fillStyle = rar.color; ctx.fillRect(x + 3 + i * 3, y + 3, 1, 1); }
      const v = this.entry(sp.id)?.variants || {};
      if (v.shiny) drawText(ctx, '{sparkle}', x + cl.w - 12, y + 2, {});
    }
    if (sel) {
      const pw = Math.min(cl.w, 96);
      pencilCircle(ctx, x + (cl.w - pw) / 2, y, pw, cl.h, sp.id.length, ease.outCubic(clamp01(this.selT * 3)));
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

  // ------------------------------------------------ right page: species sheet
  drawRight(ctx, x, y, w, h, live) {
    const g = this.game, inp = g.input, ui = this.ui;
    const sp = SPECIES_BY_ID[this.sel];
    drawPaper(ctx, x, y, w, h, { aged: true });
    if (!sp) return;
    const k = this.known(sp.id), j = this.entry(sp.id);
    const rar = RARITY[sp.rarity];
    const B = BIOME_BY_ID[sp.biome];
    const caught = k === 'caught';
    const L = x + 12, Rx = x + w - 12, cw = w - 24;
    const list = this.list(sp.biome);
    // header
    const name = caught ? sp.name : '???';
    const big = measureText(name, 'normal', 2) <= cw - 40;
    drawText(ctx, name, L, y + 10, { scale: big ? 2 : 1, color: INK, wave: caught && sp.rarity === 'legendary' ? 1 : 0, time: this.t });
    drawText(ctx, `No.${String(list.indexOf(sp) + 1).padStart(2, '0')}`, Rx, y + 12, { align: 'right', font: 'small', color: INK_FAINT });
    let yy = y + (big ? 29 : 21);
    for (let i = 0; i < 5; i++) {
      const ic = getUiIcon(i < rar.stars ? 'star' : 'star_empty');
      ctx.globalAlpha = caught || i >= rar.stars ? 1 : 0.4;
      ctx.drawImage(ic, L + i * 11, yy);
    }
    ctx.globalAlpha = 1;
    drawText(ctx, caught ? rar.name.toUpperCase() : 'UNKNOWN', L + 60, yy + 3, { font: 'small', color: caught ? rar.dark : INK_FAINT });
    if (caught && j.variants?.shiny) drawText(ctx, 'SHINY FOUND', Rx, yy + 3, { align: 'right', font: 'small', color: '#b8881a' });
    yy += 14;

    // notes text (measured first so the illustration can take the spare height)
    const notes = caught ? [sp.behavior, sp.desc] : k === 'seen' ? ['Spotted swimming nearby, but it got away before I could sketch it.', hintFor(sp)] : ['Not discovered yet.', hintFor(sp)];
    const bottomReserve = caught ? 106 : 34;
    let lines = [];
    notes.filter(Boolean).forEach((n, i) => { if (i) lines.push(''); lines.push(...wrapText(n, cw)); });
    const firstLines = wrapText(notes[0], cw).length;
    const free = y + h - bottomReserve - yy - 6 - 43 - 8;
    const ih = clamp(free - lines.length * 10, 78, caught ? 150 : 170);
    // illustration
    const inner = drawFrame(ctx, L, yy, cw, ih, { style: sp.rarity === 'legendary' && caught ? 'gold' : 'wood' });
    ctx.save();
    ctx.beginPath(); ctx.rect(inner.x, inner.y, inner.w, inner.h); ctx.clip();
    const grd = ctx.createLinearGradient(0, inner.y, 0, inner.y + inner.h);
    grd.addColorStop(0, B.water[0]); grd.addColorStop(1, B.water[1]);
    ctx.fillStyle = grd;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    // caustic bands + sand
    ctx.fillStyle = rgba('#ffffff', 0.06);
    for (let i = 0; i < 4; i++) {
      const bx = inner.x + ((i * 83 + this.t * 6) % (inner.w + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(bx, inner.y); ctx.lineTo(bx + 18, inner.y); ctx.lineTo(bx - 12, inner.y + inner.h); ctx.lineTo(bx - 30, inner.y + inner.h); ctx.fill();
    }
    ctx.fillStyle = rgba(sp.biome === 'abyss' ? '#1a1a3a' : '#e8d098', 0.55);
    for (let i = 0; i < inner.w; i += 2) ctx.fillRect(inner.x + i, inner.y + inner.h - 5 + Math.round(Math.sin(i * 0.08) * 1.5), 2, 6);
    for (let i = 0; i < 6; i++) {
      const by = inner.y + inner.h - ((this.t * 14 + i * 23) % (inner.h + 10));
      const bx = inner.x + 10 + ((i * 53) % (inner.w - 20)) + Math.sin(this.t * 2 + i) * 2;
      ctx.fillStyle = rgba('#e8fbff', 0.55);
      ctx.fillRect(Math.round(bx), Math.round(by), 1 + (i % 2), 1 + (i % 2));
    }
    const s = fitScale(sp, inner.w - 24, inner.h - 18, 3);
    const fcx = inner.x + inner.w / 2, fcy = inner.y + inner.h / 2 - 1;
    const ir = { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
    const ihov = live && !this.flip && ui.hover(ir);
    if (caught) {
      const emotion = this.emoT < 1.6 && this.emoStamp === this.sel ? this.emo : ihov ? 'happy' : 'neutral';
      drawFishFit(ctx, sp, fcx, fcy, s, this.t, {
        lookX: live ? inp.x : null, lookY: live ? inp.y : null, emotion, speed01: 0.5,
        blink: (this.t % 3.3) < 0.1 ? 1 : 0, mouth: this.emoT < 0.6 && this.emoStamp === this.sel ? Math.abs(Math.sin(this.t * 10)) * 0.7 : 0,
        squash: this.emoT < 0.4 && this.emoStamp === this.sel ? Math.sin(this.emoT * 30) * 0.15 : 0,
      });
      if (ihov) ui.tip = 'Click to say hi!';
      if (ihov && inp.pressed) { inp.pressed = false; this.poke(sp); }
    } else {
      ctx.globalAlpha = k === 'seen' ? 0.9 : 0.5;
      drawFishFit(ctx, sp, fcx, fcy, s, this.t * (k === 'seen' ? 1 : 0.2), { silhouette: sp.biome === 'abyss' ? '#05060e' : '#0e2a3e' });
      ctx.globalAlpha = 1;
      drawText(ctx, '?', fcx, fcy - 7, { align: 'center', scale: 2, color: '#ffffff', outline: '#0e2a3e' });
    }
    ctx.restore();
    yy += ih + 6;

    // field notes
    const act = ACTIVITY[sp.activity] || ACTIVITY.any;
    const dep = (sp.move.depth[0] + sp.move.depth[1]) / 2;
    const depthTxt = sp.move.style === 'crawl' ? 'Crawls the seabed' : dep < 0.3 ? 'Near the surface' : dep < 0.62 ? 'Mid-water' : 'Down by the seabed';
    const row = (icon, label, val, rx, ry) => {
      ctx.drawImage(getUiIcon(icon), rx, ry - 1);
      drawText(ctx, label, rx + 14, ry, { font: 'small', color: INK_FAINT });
      drawText(ctx, val, rx + 14, ry + 7, { color: INK });
    };
    const col2 = L + Math.floor(cw / 2) + 4;
    row('map', 'HABITAT', k === 'unknown' ? B.name : depthTxt, L, yy);
    row(act[0], 'ACTIVE', k === 'unknown' ? '???' : act[1], col2, yy);
    yy += 21;
    row('fish', 'SIZE', caught ? `${sp.size[0]}-${sp.size[1]} cm` : '???', L, yy);
    row('trophy', 'WEIGHT', caught ? `${fmtKg(sp.weight[0])}-${fmtKg(sp.weight[1])} kg` : '???', col2, yy);
    yy += 22;

    // notes
    const maxLines = Math.max(2, Math.floor((y + h - bottomReserve - yy - 4) / 10));
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '...'; }
    lines.forEach((l, i) => drawText(ctx, l, L, yy + i * 10, { color: i < firstLines ? INK : INK_SOFT }));
    yy += lines.length * 10 + 4;

    const by = y + h - bottomReserve;
    if (caught) {
      // bait tastes
      drawText(ctx, 'FAVOURITE BAIT', L, by, { font: 'small', color: INK_FAINT });
      const prefs = Object.entries(sp.bait || {}).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
      let bx = L;
      for (const [type, v] of prefs) {
        const spr = BAITS[type] ? baitSprite(type, this.t) : getMiniIcon(TYPE_ICON[type] || 'documents');
        const br = { x: bx, y: by + 8, w: 14 + 22, h: 16 };
        if (BAITS[type]) ctx.drawImage(spr, bx + Math.round((14 - spr.width) / 2), by + 9 + Math.round((14 - spr.height) / 2));
        else ctx.drawImage(spr, bx, by + 9);
        for (let i = 0; i < 3; i++) ctx.drawImage(heartPip(i < v), bx + 16 + (i % 3) * 7, by + 13);
        if (live && !this.flip && ui.hover(br)) ui.tip = `${BAITS[type]?.name || TYPE_NAME[type] || type}: ${['', 'likes it', 'loves it', 'can\'t resist it'][Math.min(3, Math.round(v))]}`;
        bx += 41;
        if (bx > Rx - 36) break;
      }
      if (!prefs.length) drawText(ctx, 'Eats just about anything.', L, by + 12, { color: INK_SOFT });
      // fight phases
      const fy = by + 30;
      drawText(ctx, 'FIGHT', L, fy, { font: 'small', color: INK_FAINT });
      let fx = L + 26;
      sp.fight.phases.forEach((ph, i) => {
        const P = PHASES[ph] || { icon: 'question', name: ph };
        if (i) { ctx.fillStyle = INK_FAINT; ctx.fillRect(fx - 5, fy + 3, 3, 1); }
        ctx.fillStyle = rgba(INK, 0.1);
        ctx.fillRect(fx - 2, fy - 3, 15, 14);
        ctx.drawImage(getUiIcon(P.icon), fx, fy - 2);
        if (live && !this.flip && ui.hover({ x: fx - 2, y: fy - 3, w: 15, h: 14 })) ui.tip = `Phase ${i + 1}: ${P.name}`;
        fx += 22;
      });
      const pw = Math.round(sp.fight.power * 5);
      drawText(ctx, 'POWER', Rx - 46, fy, { font: 'small', color: INK_FAINT });
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i < pw ? '#c8402e' : rgba(INK, 0.15); ctx.fillRect(Rx - 46 + i * 5, fy + 7, 4, 3); }
      // records card
      const ry = fy + 18;
      ctx.fillStyle = rgba('#fff8e8', 0.6);
      ctx.fillRect(L, ry, cw, 44);
      ctx.fillStyle = rgba(INK, 0.25);
      ctx.fillRect(L, ry, cw, 1); ctx.fillRect(L, ry + 43, cw, 1);
      drawText(ctx, 'MY RECORDS', L + 4, ry + 4, { font: 'small', color: INK_FAINT });
      drawText(ctx, `Caught x${j.caught}`, Rx - 4, ry + 3, { align: 'right', color: INK });
      drawText(ctx, `Largest ${fmtCm(j.maxSize)} cm`, L + 4, ry + 13, { color: INK });
      drawText(ctx, `Smallest ${fmtCm(j.minSize)} cm`, L + Math.floor(cw / 2), ry + 13, { color: INK });
      drawText(ctx, `First caught ${fmtDate(j.first)}`, L + 4, ry + 23, { color: INK_SOFT });
      // variants chips
      const vs = Object.keys(j.variants || {}).filter((v) => j.variants[v]);
      let vx = L + 4;
      drawText(ctx, 'VARIANTS', vx, ry + 34, { font: 'small', color: INK_FAINT });
      vx += 38;
      if (!vs.length) drawText(ctx, 'none yet', vx, ry + 33, { color: INK_FAINT });
      for (const v of vs.sort((a) => (a === 'shiny' ? -1 : 1))) {
        const label = v === 'shiny' ? 'Shiny' : MUTATIONS[v]?.name || v;
        const tw = measureText(label, 'small') + 8;
        if (vx + tw > Rx - 2) break;
        const c = MUT_COLOR[v] || '#c8a0e8';
        ctx.fillStyle = shade(c, -0.55);
        ctx.fillRect(vx, ry + 32, tw, 9);
        ctx.fillStyle = c;
        ctx.fillRect(vx + 1, ry + 33, tw - 2, 7);
        drawText(ctx, label.toUpperCase(), vx + 4, ry + 34, { font: 'small', color: shade(c, -0.75) });
        vx += tw + 3;
      }
    } else {
      drawText(ctx, 'FAVOURITE BAIT', L, by, { font: 'small', color: INK_FAINT });
      drawText(ctx, '??? - catch one to learn its tastes', L, by + 10, { color: INK_FAINT });
    }
    // footer
    const total = SPECIES.filter((s) => this.known(s.id) === 'caught').length;
    drawText(ctx, `Journal ${total}/${SPECIES.length}`, x + w / 2, y + h - 11, { align: 'center', font: 'small', color: INK_FAINT });
    if (live && !this.flip) {
      const nr = { x: x + w - 28, y: y + h - 18, w: 22, h: 14 };
      const nh = ui.hover(nr);
      ctx.globalAlpha = nh ? 1 : 0.6;
      ctx.drawImage(getUiIcon('arrow_r'), nr.x + 6, nr.y + 1 - (nh ? 1 : 0));
      ctx.globalAlpha = 1;
      if (nh) ui.tip = 'Next fish (Right arrow)';
      if (nh && inp.pressed) { inp.pressed = false; this.step(1); }
    }
  }
}

function fmtKg(v) { return v < 0.1 ? v.toFixed(3).replace(/0+$/, '') : v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString(); }
function fmtCm(v) { return v >= 9999 || !v ? '-' : (Math.round(v * 10) / 10).toString(); }
function fmtDate(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '-'; }
}

function hintFor(sp) {
  const s = sp.spawn || {};
  const B = BIOME_BY_ID[sp.biome];
  const bits = [];
  if (s.weather) bits.push(WEATHER_HINT[s.weather] || `when the weather is ${s.weather}`);
  if (s.time === 'night' || sp.activity === 'night') bits.push('at night');
  else if (s.time === 'day') bits.push('in daylight');
  if (s.requires === 'golden') bits.push('when Golden Bait is on the hook');
  if (s.requires && s.requires !== 'golden') bits.push('when something special is on the hook');
  if (sp.rarity === 'legendary') return `Legend says it rises in ${B.name}${bits.length ? ' ' + bits.join(', ') : ''}... for the right bait.`;
  if (bits.length) return `Rumoured to appear in ${B.name} ${bits.join(', ')}.`;
  return `Lives somewhere in ${B.name}. Keep fishing!`;
}
