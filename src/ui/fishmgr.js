// Fish management (phase 7, Tank agent): a big glossy Aero panel listing every fish you own, in the cube tank and in
// storage (the holding bucket), with hand-made-looking pixel thumbnails (the fish API's icon, shrunk to logical pixels
// with a dark outline), name, species, rarity, size, mutation / shiny, happiness and hunger bars and Aero per minute.
//   - sort (rarity, Aero/min, size, happiness, hunger, name, newest, species) and filter (tank / storage, rarity,
//     favourites, special)
//   - rename (type in place), favourite, move between tank and storage (capacity respected), release with confirm,
//     feed all, breed (pick a partner), "See" (the tank camera glides to the fish and follows it)
//   - bulk actions on checked fish (to tank, to storage, favourite, release; favourites are never bulk-released)
// Panel id 'fishmgr' (key F, the tank dock's Fish button, the HUD's My Fish button). Uses game.aquarium: fishOf,
// moveFish, releaseFish, feedAll, canBreed, breedPair, focusFish, rateOf, capacity, tankCount.
//
//   registerFishManager(ui)   registers the panel and its HUD icon model
// [phase9:ui] Remade as a card grid at full resolution: big glossy fish cards with a LIVE portrait (the fish swims in a
// little tank window), rarity frames with a sweeping shine and gems, mood faces, animated happiness / hunger meters,
// a sort/filter bar with rarity gems, juicy hover/press and pixel particles on every action.

import { clamp, clamp01, rectContains } from '../core/math.js';
import { RARITY, RARITY_ORDER } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { MUTATIONS, valueMultiplier } from '../fish/traits.js';
import * as FISHICON from '../fish/fishicon.js';
import { MeshBuilder } from '../gfx/lowpoly.js';
import { ICON_MODELS } from '../gfx/iconmeshes.js';
import { AERO, fmtAero, drawAeroSurface, drawAeroButton, drawAeroBar, drawAeroCoin, drawSparkle, uiK, drawAeroGlow, drawAeroBubble, drawLeafSprig, drawTitle, titleSize, toneFrom, drawPixelBrackets } from './aero.js';
import { mix, shade, hexToRgb } from '../core/color.js'; // [phase9:ui]
import { bayer, hash2 } from '../core/math.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { HI, hiFromBuffer } from '../gfx/hires.js';
import { iconFrame } from '../gfx/bigicons.js';
import { roundRectPath } from './labart.js';
import { gemTex } from './labtiles.js';
import { drawIcon3D } from '../gfx/icons3d.js'; // [phase9:ui]
import { drawFishFit, fitScale } from './journal.js';
import { panelRect } from './ui.js';

const SORTS = [
  ['rarity', 'Rarity'], ['aero', 'Aero/min'], ['size', 'Size'], ['happy', 'Happiness'], ['hunger', 'Hunger'], ['name', 'Name'], ['newest', 'Newest'], ['species', 'Species'],
];
const PLACES = [['all', 'All'], ['tank', 'Tank'], ['storage', 'Storage']];
const INK = AERO.ink || '#0c3a52', SOFT = '#3c6f88';
const RELEASE_VALUE = { common: 4, uncommon: 10, rare: 30, epic: 90, legendary: 300 };

// ------------------------------------------------------------------ pixel-art fish thumbnails
const THUMBS = new Map();
let budget = 0;
function fishThumb(rec, w, h) {
  const sp = SPECIES_BY_ID[rec.species];
  if (!sp) return null;
  const v = rec.variant || {};
  const key = `${sp.id}|${v.mutation || ''}|${v.shiny ? 1 : 0}|${w}x${h}`;
  let c = THUMBS.get(key);
  if (c !== undefined) return c;
  if (budget <= 0) return null;
  budget--;
  try {
    const make = FISHICON.voxelFishIcon || FISHICON.lowpolyFishIcon;
    const src = make ? make(sp, w - 2, h - 2, { variant: rec.variant || null, yaw: 14 }) : null;
    c = src ? pixelOutline(src, w, h) : null;
  } catch (e) { console.warn('fish thumb', sp.id, e); c = null; }
  THUMBS.set(key, c);
  if (THUMBS.size > 300) THUMBS.delete(THUMBS.keys().next().value);
  return c;
}
// shrink to logical pixels (no smoothing), snap alpha, add a dark selective outline: reads as hand-made pixel art
function pixelOutline(src, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(src, 1, 1, w - 2, h - 2);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    if (a[i]) { d[o + 3] = 255; continue; }
    const n = (x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w]);
    if (n) { d[o] = 14; d[o + 1] = 40; d[o + 2] = 64; d[o + 3] = 240; } else d[o + 3] = 0;
  }
  g.putImageData(img, 0, 0);
  return c;
}


// ------------------------------------------------------------------ [phase9:ui] hi-res art: tank windows, mood faces
const ART = new Map();
const artOf = (key, build) => { let c = ART.get(key); if (!c) { c = build(); ART.set(key, c); if (ART.size > 240) ART.delete(ART.keys().next().value); } return c; };
const px = (r, g, b, a = 255) => (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
const hx = (h) => hexToRgb(h);

// A little aquarium window (w x h logical, authored at 2x): water bands with a fine dither, light rays, sand with
// pebbles, a seaweed silhouette, a glass rim. storage = the holding bucket look (cooler, dimmer).
function tankWindow(w, h, r, storage = false, seed = 1) {
  return artOf(`tw|${w}|${h}|${r}|${storage}|${seed}`, () => {
    const W = w * HI, H = h * HI, R = r * HI;
    const b = new PixelBuffer(W, H);
    const top = hx(storage ? '#a8c8dc' : '#8ae8ff'), mid = hx(storage ? '#5a8aac' : '#2fb8ec'), bot = hx(storage ? '#2a4a68' : '#0c6eb8');
    const inside = (x, y) => {
      const cx = x < R ? R : x >= W - R ? W - R : null, cy = y < R ? R : y >= H - R ? H - R : null;
      if (cx === null || cy === null) return true;
      return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= R * R;
    };
    const sandY = (x) => H - 7 * HI + Math.round(Math.sin(x * 0.045 + seed) * 2.2 + Math.sin(x * 0.11 + seed * 3) * 1.2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const ty = y / H;
      const k = Math.floor((ty * 10 + bayer(x, y) * 0.99)) / 10;
      const A = k < 0.5 ? top : mid, B = k < 0.5 ? mid : bot, f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
      let r0 = A[0] + (B[0] - A[0]) * f, g0 = A[1] + (B[1] - A[1]) * f, b0 = A[2] + (B[2] - A[2]) * f;
      // light rays slanting down from the top-left
      const ray = ((x * 0.55 + y * 0.35 + seed * 37) % 46);
      if (ray < 7 && ty < 0.8) { const a = (ray < 2 || ray > 5 ? 0.06 : 0.12) * (1 - ty); r0 += (255 - r0) * a; g0 += (255 - g0) * a; b0 += (255 - b0) * a; }
      const sy = sandY(x);
      if (y >= sy) {
        const sk = (y - sy) / (H - sy);
        const sc = storage ? ['#c8d4dc', '#9aaab8', '#6a7a8a'] : ['#fff2c0', '#f2d68a', '#c8a45a'];
        const c = hx(sc[Math.min(2, Math.floor(sk * 2.4 + bayer(x, y) * 0.8))]);
        [r0, g0, b0] = y === sy ? [255, 255, 236] : c;
        if (hash2(x >> 1, y >> 1, seed) > 0.93) { r0 *= 0.75; g0 *= 0.72; b0 *= 0.7; }
      }
      // glass rim: a dark outer line, a bright inner hairline on the top-left
      const e0 = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const e1 = !e0 && (!inside(x - 2, y) || !inside(x, y - 2));
      if (e0) { const c = hx(storage ? '#3a5068' : '#0a4a80'); [r0, g0, b0] = c; }
      else if (e1) { r0 += (255 - r0) * 0.7; g0 += (255 - g0) * 0.7; b0 += (255 - b0) * 0.7; }
      b.data[y * W + x] = px(r0 | 0, g0 | 0, b0 | 0);
    }
    // seaweed silhouettes on both sides + pebbles
    const weed = (x0, hgt, ph, col) => {
      const c = hx(col);
      for (let i = 0; i < hgt; i++) {
        const y = sandY(x0) - i, x = Math.round(x0 + Math.sin(i * 0.18 + ph) * 3);
        for (let d = -1; d <= 1; d++) if (x + d >= 0 && x + d < W && y >= 0 && inside(x + d, y)) b.data[y * W + x + d] = px(c[0], c[1], c[2]);
        if (i % 9 === 4) for (let d = 1; d < 5; d++) { const xx = x + (i % 18 === 4 ? d : -d), yy = y - (d >> 1); if (xx >= 0 && xx < W && yy >= 0 && inside(xx, yy)) b.data[yy * W + xx] = px(c[0], c[1], c[2]); }
      }
    };
    if (!storage) { weed(Math.round(W * 0.08), Math.round(H * 0.5), seed, '#2c9a4a'); weed(Math.round(W * 0.13), Math.round(H * 0.32), seed + 2, '#5ccf4a'); weed(Math.round(W * 0.9), Math.round(H * 0.42), seed + 1, '#2c9a4a'); }
    for (let i = 0; i < Math.round(W / 26); i++) {
      const x = Math.round(hash2(i, seed, 3) * (W - 8)) + 4, y = sandY(x) + 3 + Math.round(hash2(i, seed, 4) * 4);
      const c = hx(['#ffffff', '#ff9ed2', '#7fdcfa', '#c8a45a'][i % 4]);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]]) if (inside(x + dx, y + dy)) b.data[(y + dy) * W + x + dx] = px(c[0], c[1], c[2]);
    }
    return hiFromBuffer(b);
  });
}

export const MOODS = {
  love: { col: '#ff9ed2', label: 'In love' }, happy: { col: '#ffe27a', label: 'Happy' }, ok: { col: '#bff4a0', label: 'Content' },
  hungry: { col: '#ffb46a', label: 'Hungry!' }, sad: { col: '#9fc8ff', label: 'Sad' },
};
export function moodOf(rec) {
  const h = rec.happiness ?? 0.7, u = rec.hunger ?? 0.3;
  if (u > 0.62) return 'hungry';
  if (h > 0.9) return 'love';
  if (h > 0.66) return 'happy';
  if (h > 0.4) return 'ok';
  return 'sad';
}
// A glossy round mood face (d logical px, authored at 2x): shaded ball, outline, eyes and mouth per mood.
function moodFace(mood, d = 12) {
  return artOf(`mood|${mood}|${d}`, () => {
    const D = (d + 2) * HI, R = d, cx = D / 2;
    const b = new PixelBuffer(D, D);
    const base = MOODS[mood]?.col || '#ffe27a';
    const ramp = [shade(base, -0.45), shade(base, -0.15), base, mix(base, '#ffffff', 0.55)].map(hx);
    const out = hx(shade(base, -0.75));
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cx, r = Math.hypot(dx, dy);
      if (r > R) continue;
      if (r > R - 1.3) { b.data[y * D + x] = px(out[0], out[1], out[2]); continue; }
      const lit = -(dx * 0.6 + dy * 0.8) / R;
      const k = Math.max(0, Math.min(3, Math.round(1.6 + lit * 1.6 + (bayer(x, y) - 0.5) * 0.6)));
      const c = ramp[k];
      b.data[y * D + x] = px(c[0], c[1], c[2]);
    }
    const ink = hx('#2a1830');
    const dot = (x, y, c = ink) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < D && y < D) b.data[y * D + x] = px(c[0], c[1], c[2]); };
    const ex = R * 0.38, ey = -R * 0.12;
    if (mood === 'love') {
      const red = hx('#e0304c');
      for (const s of [-1, 1]) for (const [hx0, hy0] of [[-1, 0], [1, 0], [-2, -1], [-1, -1], [1, -1], [2, -1], [-2, -2], [-1, -2], [1, -2], [2, -2], [0, 0], [0, 1], [-1, 0], [0, -1]]) dot(cx + s * ex + hx0, cx + ey + hy0 + 1, red);
    } else if (mood === 'sad') {
      for (const s of [-1, 1]) { dot(cx + s * ex, cx + ey); dot(cx + s * ex, cx + ey + 1); dot(cx + s * ex - s, cx + ey - 2); dot(cx + s * ex - s * 2, cx + ey - 2); }
      const blue = hx('#4aa8f0');
      dot(cx + ex + 1, cx + ey + 3, blue); dot(cx + ex + 1, cx + ey + 4, blue); dot(cx + ex + 2, cx + ey + 4, blue);
    } else {
      for (const s of [-1, 1]) { for (const [a, c] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]) dot(cx + s * ex - 1 + a, cx + ey - 1 + c); dot(cx + s * ex - 1, cx + ey - 1, hx('#ffffff')); }
    }
    // mouth
    const my = cx + R * 0.36;
    if (mood === 'happy' || mood === 'love') for (let i = -4; i <= 4; i++) dot(cx + i, my + Math.round((16 - i * i) / 8) - 1);
    else if (mood === 'ok') for (let i = -3; i <= 3; i++) dot(cx + i, my + (Math.abs(i) > 2 ? 0 : 1));
    else if (mood === 'sad') for (let i = -3; i <= 3; i++) dot(cx + i, my + 2 - Math.round((9 - i * i) / 5));
    else { for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) dot(cx + x, my + y, (x * x + y * y > 2) ? ink : hx('#c8344c')); dot(cx + 3, my + 3, hx('#7fdcfa')); }
    // cheeks + glint
    if (mood === 'happy' || mood === 'love') { const pk = hx('#ff8aa8'); for (const s of [-1, 1]) { dot(cx + s * R * 0.62, my - 1, pk); dot(cx + s * R * 0.62 + s, my - 1, pk); } }
    const g = hx('#ffffff'); dot(cx - R * 0.45, cx - R * 0.55, g); dot(cx - R * 0.45 + 1, cx - R * 0.55, g); dot(cx - R * 0.45, cx - R * 0.55 + 1, g);
    return hiFromBuffer(b);
  });
}

// sort icons for the sort chip
const SORT_ICON = { rarity: 'star', aero: 'aero', size: 'fish', happy: 'heart', hunger: 'food', name: 'book', newest: 'clock', species: 'fish' };

// ------------------------------------------------------------------ the HUD icon: a glossy glass cube with a fish
function cubeFishIcon() {
  const mb = new MeshBuilder(), glass = new MeshBuilder(), over = new MeshBuilder();
  const q = (a, b, c, d, col) => mb.quad(a, b, c, d, col);
  const s = 0.72, w = -0.45;
  // water block (front, top, right faces) + sand
  q([-s, -s, s], [s, -s, s], [s, w, s], [-s, w, s], '#e8d8a8');
  q([s, -s, s], [s, -s, -s], [s, w, -s], [s, w, s], '#d4c08e');
  q([-s, w, s], [s, w, s], [s, s * 0.7, s], [-s, s * 0.7, s], '#3ab8f0');
  q([s, w, s], [s, w, -s], [s, s * 0.7, -s], [s, s * 0.7, s], '#2a98d8');
  q([-s, s * 0.7, s], [s, s * 0.7, s], [s, s * 0.7, -s], [-s, s * 0.7, -s], '#8ae8ff');
  // an orange fish on the front glass
  const f = (pts, col) => { for (let i = 1; i < pts.length - 1; i++) over.tri(pts[0], pts[i], pts[i + 1], col); };
  const z = s + 0.05;
  f([[-0.42, 0.05, z], [-0.2, 0.25, z], [0.18, 0.22, z], [0.3, 0.05, z], [0.18, -0.13, z], [-0.2, -0.15, z]], '#ff8a2a');
  f([[0.26, 0.05, z], [0.5, 0.26, z], [0.46, 0.05, z], [0.5, -0.16, z]], '#ff6a1a');
  f([[-0.3, 0.1, z + 0.01], [-0.26, 0.14, z + 0.01], [-0.22, 0.1, z + 0.01]], '#14202e');
  // glass shell with thick edges
  const g = 0.8;
  glass.quad([-g, -g, g], [g, -g, g], [g, g, g], [-g, g, g], '#e8fcff');
  glass.quad([g, -g, g], [g, -g, -g], [g, g, -g], [g, g, g], '#d8f6ff');
  glass.quad([-g, g, g], [g, g, g], [g, g, -g], [-g, g, -g], '#f4ffff');
  return { mesh: mb.build(), over: over.build(), glass: glass.build(), glassAlpha: 0.3, yaw: -0.5, pitch: 0.38, spin: 'wobble' };
}

// ------------------------------------------------------------------ text entry (rename)
class TextEdit {
  constructor(text, max = 18) { this.text = text; this.max = max; this.done = null; this.on = (e) => this.key(e); window.addEventListener('keydown', this.on, true); }
  key(e) {
    e.stopPropagation(); e.preventDefault();
    if (e.key === 'Enter') this.done = 'ok';
    else if (e.key === 'Escape') this.done = 'cancel';
    else if (e.key === 'Backspace') this.text = this.text.slice(0, -1);
    else if (e.key.length === 1 && this.text.length < this.max && /[\w \-'!?.&]/.test(e.key)) this.text += e.key;
  }
  close() { window.removeEventListener('keydown', this.on, true); }
}

export class FishManagerPanel {
  constructor() {
    this.id = 'fishmgr';
    this.modal = true;
    this.place = 'all'; this.sort = 'rarity'; this.rar = null; this.favOnly = false; this.special = false;
    this.scroll = 0; this.sel = null; this.checked = new Set();
    this.breedFor = null; this.confirm = null; this.edit = null; this.t = 0;
    this.anims = new WeakMap();
  }
  open() { this.scroll = 0; this.breedFor = null; this.confirm = null; this.checked.clear(); }
  close() { if (this.edit) { this.edit.close(); this.edit = null; } }

  get aq() { return this.game.aquarium; }
  list() {
    const st = this.game.state, aq = this.aq;
    let L = (st.fish || []).filter((r) => SPECIES_BY_ID[r.species]);
    if (this.place === 'tank') L = L.filter((r) => r.inTank); else if (this.place === 'storage') L = L.filter((r) => !r.inTank);
    if (this.rar) L = L.filter((r) => SPECIES_BY_ID[r.species].rarity === this.rar);
    if (this.favOnly) L = L.filter((r) => r.fav);
    if (this.special) L = L.filter((r) => r.variant?.shiny || r.variant?.mutation);
    const sp = (r) => SPECIES_BY_ID[r.species];
    const name = (r) => (r.name || sp(r).name).toLowerCase();
    const key = {
      rarity: (r) => -RARITY_ORDER.indexOf(sp(r).rarity) * 1000 - (r.variant?.shiny ? 500 : 0) - (r.sizeCm || 0) / 1000,
      aero: (r) => -(aq?.rateOf?.(r) || 0) * (r.inTank ? 1 : 0.001),
      size: (r) => -(r.sizeCm || 0), happy: (r) => -(r.happiness ?? 0.7), hunger: (r) => -(r.hunger ?? 0.3),
      newest: (r) => -(r.caughtAt || r.bornAt || 0), species: (r) => sp(r).name, name,
    }[this.sort];
    return L.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) || ((b.fav ? 1 : 0) - (a.fav ? 1 : 0)); });
  }

  // ------------------------------------------------------------------ actions
  toast(t, icon = 'fish') { this.game.toast?.(t, icon, 2.6); }
  move(rec, toTank) { const r = this.aq?.moveFish?.(rec, toTank); if (r && !r.ok) { this.toast(r.why, 'tank'); this.game.audio.play('ui_error'); return false; } return true; }
  value(rec) { const sp = SPECIES_BY_ID[rec.species]; return Math.round((RELEASE_VALUE[sp?.rarity] || 4) * valueMultiplier(rec)); }
  release(recs) {
    let total = 0;
    for (const r of recs) total += this.aq?.releaseFish?.(r) || 0;
    for (const r of recs) this.checked.delete(r);
    if (recs.includes(this.sel)) this.sel = null;
    this.toast(`Released ${recs.length} fish  +${fmtAero(total)} Aero`, 'coin');
  }
  breed(a, b) {
    const r = this.aq?.breedPair?.(a, b);
    if (!r?.ok) { this.toast(r?.why || 'They are not in the mood.', 'heart'); this.game.audio.play('ui_error'); return; }
    this.toast('Love is in the water! Watch them court...', 'heart');
    this.breedFor = null;
  }
  see(rec) {
    if (!rec.inTank) { this.toast('That fish is in storage: move it to the tank first.', 'tank'); return; }
    this.ui.close(this.id);
    this.aq?.focusFish?.(rec);
  }

  layout() {
    const g = this.game, W = g.screen.W;
    const R = panelRect(g, Math.min(W - 16, 900), 480);
    const head = { x: R.x + 6, y: R.y + 5, w: R.w - 12, h: 34 };
    const bar = { x: R.x + 10, y: R.y + 44, w: R.w - 20, h: 20 };
    const dw = Math.round(clamp(R.w * 0.3, 210, 262));
    const list = { x: R.x + 10, y: R.y + 70, w: R.w - dw - 26, h: R.h - 70 - 32 };
    const det = { x: list.x + list.w + 8, y: list.y, w: dw, h: R.h - 80 };
    const bulk = { x: list.x, y: list.y + list.h + 6, w: list.w, h: 20 };
    const cols = Math.max(2, Math.floor((list.w - 6 + 6) / 152));
    const cw = Math.floor((list.w - 8 - (cols - 1) * 6) / cols);
    return { R, head, bar, list, det, bulk, cols, cw, ch: 112, rowH: 118 };
  }

  // ------------------------------------------------------------------ juice
  // throttled ambient particles (one burst per fish per ~1.2 s)
  fxT(rec, f) { const A = this.fa(rec); if (this.t - (A.fxAt || -9) > 1.2) { A.fxAt = this.t; f(); } }
  fx(kind, x, y, n = 8, o = {}) { try { this.game.particles?.pixelBurst?.(kind, x, y, n, { layer: 'ui', ...o }); } catch { /* optional */ } }
  fa(rec) {
    let a = this.anims.get(rec);
    if (!a) { a = { hov: 0, sel: 0, happy: rec.happiness ?? 0.7, fed: 1 - (rec.hunger ?? 0.3), pop: 0, ph: Math.random() * 6 }; this.anims.set(rec, a); }
    return a;
  }

  // ------------------------------------------------------------------ drawing + input (immediate mode)
  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, aq = this.aq, inp = ui.inp;
    this.t += dt;
    budget = 3;
    const L = this.layout(), R = L.R;
    this.rect = R;
    // keyboard: the game's hotkeys stay quiet while the panel is open
    for (const k of ['f', 'q', 'w', 's', 'b', 't', 'j', 'l', 'k', 'o', 'p', 'i', 'u', 'a']) g.input.keysPressed?.delete?.(k);
    if (this.edit) {
      if (this.edit.done) { const e = this.edit; e.close(); this.edit = null; if (e.done === 'ok') { e.rec.name = e.text.trim() || undefined; if (!e.rec.name) delete e.rec.name; g.save?.(); g.audio.play('ui_click'); } }
      g.input.keysPressed?.clear?.();
    }
    // the panel: frosted glass with a tank-blue lower half, leaves at the corners
    ctx.fillStyle = 'rgba(2,26,56,0.3)'; ctx.fillRect(R.x + 4, R.y + 6, R.w, R.h);
    drawAeroSurface(ctx, R.x, R.y, R.w, R.h, { top: '#f4fdff', mid: '#cdeefc', bot: '#8fd0f0', a: [0.98, 0.98], edge: '#0b4f8f', r: 12, gloss: 0.45, glossH: 24, curve: 3, rim: 0.95, glow: 0.6, streak: true, bubbles: 4 });
    drawLeafSprig(ctx, R.x + R.w - 4, R.y + R.h - 6, 'br', 0.9);
    // ---- header
    const H = L.head;
    drawAeroSurface(ctx, H.x, H.y, H.w, H.h, { top: '#d8f6ff', mid: '#5cc8f4', bot: '#1f86c8', a: [1, 1], edge: '#0b4f8f', r: 10, gloss: 0.75, glossH: 15, curve: 3, rim: 0.9, glow: 0.7, streak: true, sparkle: 2 });
    const turn = Math.sin(this.t * 0.9) * 0.6;
    const ic = iconFrame('fishmgr', 34, turn);
    if (ic) ctx.drawImage(ic.canvas, Math.round(H.x + 22 - ic.ox), Math.round(H.y + H.h / 2 - ic.oy));
    else { const fi = getUiIcon('fish'); if (fi) ctx.drawImage(fi, H.x + 8, H.y + 8, fi.width * 2, fi.height * 2); }
    const tsz = drawTitle(ctx, 'My Fish', H.x + 42, H.y + 7, { scale: 2 });
    const all = (st.fish || []).filter((r) => SPECIES_BY_ID[r.species]);
    const inTank = all.filter((r) => r.inTank).length, cap = aq?.capacity?.() || st.tankCap || 4;
    const rate = aq?.ratePerMin?.() || 0;
    let hx0 = H.x + 42 + (tsz?.w || 90) + 14;
    const chip = (w, draw, tip) => {
      const r = { x: hx0, y: H.y + 7, w, h: 20 };
      drawAeroSurface(ctx, r.x, r.y, r.w, r.h, { tone: 'white', r: 'pill', gloss: 0.7, glossH: 9, curve: 1, rim: 0.85, glow: 0.4 });
      draw(r);
      if (tip && ui.hover(r)) ui.tip = tip;
      hx0 += w + 6;
    };
    chip(118, (r) => {
      const ti = getUiIcon('tank'); if (ti) ctx.drawImage(ti, r.x + 7, r.y + 5);
      drawText(ctx, `${inTank}/${cap}`, r.x + 22, r.y + 6, { color: INK });
      drawAeroBar(ctx, r.x + 58, r.y + 7, 52, 7, cap ? inTank / cap : 0, { color: inTank >= cap ? '#ff9a3a' : '#3ac4f8', segments: Math.min(12, cap) });
    }, 'Fish in the tank / room');
    chip(70, (r) => { const hi = getUiIcon('home'); if (hi) ctx.drawImage(hi, r.x + 7, r.y + 5); drawText(ctx, `${all.length - inTank}`, r.x + 22, r.y + 6, { color: INK }); drawText(ctx, 'kept', r.x + 22 + measureText(`${all.length - inTank}`) + 4, r.y + 7, { font: 'small', color: SOFT }); }, 'Fish in storage (the holding bucket)');
    chip(Math.max(78, measureText(`${rate.toFixed(1)}/min`) + 30), (r) => { drawAeroCoin(ctx, r.x + 12, r.y + 10, 5, this.t); drawText(ctx, `${rate.toFixed(1)}/min`, r.x + 21, r.y + 6, { color: INK }); }, 'Aero your tank earns per minute');
    if (this.btn(ui, ctx, { x: H.x + H.w - 30, y: H.y + 6, w: 24, h: 22 }, '', { icon: 'cross', tone: 'red', tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    if (this.btn(ui, ctx, { x: H.x + H.w - 124, y: H.y + 6, w: 88, h: 22 }, 'Feed all', { icon: 'food', tone: 'green', tip: 'Sprinkle food for every fish in the tank', dis: !inTank })) {
      aq?.feedAll?.(); this.toast('Dinner time!', 'food');
      this.fx('drop', H.x + H.w - 80, H.y + 26, 10, { ramp: 'gold', spread: 1.2, dir: Math.PI / 2 }); this.fx('sparkle', H.x + H.w - 80, H.y + 18, 6);
    }
    // ---- the sort / filter bar
    this.toolbar(ctx, ui, L.bar);
    // ---- card grid
    const list = this.list();
    if (this.sel && !all.includes(this.sel)) this.sel = null;
    if (!this.sel && list.length) this.sel = list[0];
    for (const r of [...this.checked]) if (!all.includes(r)) this.checked.delete(r);
    const LR = L.list, rh = L.rowH;
    drawAeroSurface(ctx, LR.x, LR.y, LR.w, LR.h, { top: '#e8f8ff', mid: '#d2effc', bot: '#b8e2f6', a: [0.75, 0.8], edge: '#5aa2cc', edgeA: 0.8, r: 8, gloss: 0.2, glossH: 10, rim: 0.6, glow: 0.3, inset: true });
    const rows = Math.ceil(list.length / L.cols);
    if (ui.hover(LR) && inp.wheel) { this.scroll += inp.wheel * rh * 0.6; inp.wheel = 0; }
    const maxS = Math.max(0, rows * rh - LR.h + 8);
    this.scroll = clamp(this.scroll, 0, maxS);
    this.scrollS = (this.scrollS ?? this.scroll) + (this.scroll - (this.scrollS ?? this.scroll)) * Math.min(1, dt * 14);
    ctx.save(); ctx.beginPath(); ctx.rect(LR.x + 1, LR.y + 1, LR.w - 2, LR.h - 2); ctx.clip();
    const bf = this.breedFor;
    let hovRec = null;
    list.forEach((rec, i) => {
      const c = i % L.cols, rr = Math.floor(i / L.cols);
      const y = LR.y + 5 + rr * rh - Math.round(this.scrollS);
      if (y + L.ch < LR.y || y > LR.y + LR.h) return;
      const r = { x: LR.x + 4 + c * (L.cw + 6), y, w: L.cw, h: L.ch };
      if (this.card(ctx, ui, rec, r, bf, LR)) hovRec = rec;
    });
    ctx.restore();
    // scroll thumb
    if (maxS > 0) {
      const th = Math.max(20, LR.h * LR.h / (rows * rh)), ty = LR.y + 2 + (LR.h - 4 - th) * (this.scrollS / maxS);
      drawAeroSurface(ctx, LR.x + LR.w - 6, ty, 4, th, { tone: 'aqua', r: 2, gloss: 0.6, rim: 0.4, glow: 0.3 });
    }
    void hovRec;
    if (!list.length) {
      const msg = all.length ? 'No fish match these filters.' : 'No fish yet: catch some and keep them!';
      drawText(ctx, msg, LR.x + LR.w / 2, LR.y + LR.h / 2 - 4, { align: 'center', font: 'big', color: SOFT });
      for (let i = 0; i < 4; i++) { const q = (this.t * 0.4 + i / 4) % 1; drawAeroBubble(ctx, LR.x + LR.w / 2 - 30 + i * 20, LR.y + LR.h / 2 + 30 - q * 30, 2 + q * 2, 1 - q); }
    }
    // ---- bulk bar / breed banner
    const BK = L.bulk;
    if (bf) {
      drawAeroSurface(ctx, BK.x, BK.y, BK.w, BK.h, { tone: toneFrom('#ff74b4'), r: 'pill', gloss: 0.6, glossH: 9, rim: 0.8 });
      const hi = getUiIcon('heart'); if (hi) ctx.drawImage(hi, BK.x + 8, BK.y + 5);
      drawText(ctx, `Pick a partner for ${bf.name || SPECIES_BY_ID[bf.species].name} (both in the tank)`, BK.x + 22, BK.y + 6, { color: '#ffffff', shadow: '#8a2a5a' });
      if (this.btn(ui, ctx, { x: BK.x + BK.w - 70, y: BK.y + 1, w: 66, h: BK.h - 2 }, 'Cancel', { tone: 'glass', font: 'small' })) this.breedFor = null;
    } else if (this.checked.size) {
      const sel = [...this.checked];
      drawAeroSurface(ctx, BK.x, BK.y, 78, BK.h, { tone: 'aqua', r: 'pill', gloss: 0.7, glossH: 9, rim: 0.8 });
      drawText(ctx, `${sel.length} ticked`, BK.x + 10, BK.y + 6, { color: '#ffffff', shadow: '#0a4680' });
      let x = BK.x + 84;
      const b = (label, icon, tone, f, tip) => { const w = measureText(label, 'small') + 30; if (this.btn(ui, ctx, { x, y: BK.y, w, h: BK.h }, label, { icon, tone, font: 'small', tip })) f(x + w / 2, BK.y); x += w + 4; };
      b('To tank', 'tank', 'aqua', (bx, by) => { let n = 0; for (const r of sel) if (!r.inTank && this.move(r, true)) n++; if (n) { this.toast(`${n} fish moved into the tank.`, 'tank'); this.fx('splash', bx, by, 8); } }, 'Move into the tank (as many as fit)');
      b('To storage', 'home', 'aqua', (bx, by) => { for (const r of sel) this.move(r, false); this.fx('puff', bx, by, 6, { ramp: 'white' }); }, 'Move to storage');
      b('Favourite', 'star', 'orange', (bx, by) => { const on = !sel.every((r) => r.fav); for (const r of sel) r.fav = on || undefined; g.save?.(); if (on) this.fx('star', bx, by, 8, { ramp: 'gold' }); }, 'Star them all');
      b('Release', 'coin', 'red', () => { const rel = sel.filter((r) => !r.fav); if (!rel.length) { this.toast('Favourites are never bulk-released.', 'star'); return; } this.confirm = { recs: rel, value: rel.reduce((a, r) => a + this.value(r), 0) }; }, 'Release for Aero (favourites are skipped)');
      b('Clear', 'cross', 'glass', () => this.checked.clear());
    } else {
      drawText(ctx, 'Tick cards for bulk actions   Double-click: see it swim   F: open / close', BK.x + 4, BK.y + 7, { font: 'small', color: SOFT });
      if (list.length && this.btn(ui, ctx, { x: BK.x + BK.w - 74, y: BK.y, w: 74, h: BK.h }, 'Tick all', { tone: 'glass', font: 'small', icon: 'check' })) for (const r of list) this.checked.add(r);
    }
    // ---- details
    this.details(ctx, ui, L.det);
    // ---- confirm dialog
    if (this.confirm) this.drawConfirm(ctx, ui, R);
    if (inp.pressed && rectContains(R, inp.x, inp.y)) inp.pressed = false;
    if (g.input.keyPressed('Escape') && this.edit) g.input.keysPressed.delete('Escape');
  }

  // A fun sort / filter bar: place tabs, a sort chip, rarity gems, favourites and special toggles, the count.
  toolbar(ctx, ui, B) {
    let bx = B.x;
    const icons = { all: 'fish', tank: 'tank', storage: 'home' };
    for (const [id, label] of PLACES) {
      const w = measureText(label) + 34, on = this.place === id;
      if (this.btn(ui, ctx, { x: bx, y: B.y, w, h: B.h }, label, { icon: icons[id], tone: on ? 'green' : 'white', on })) { this.place = id; this.scroll = 0; }
      bx += w + 3;
    }
    bx += 8;
    const sl = SORTS.find((s) => s[0] === this.sort)[1];
    const sw = measureText('Sort: ' + sl) + 36;
    if (this.btn(ui, ctx, { x: bx, y: B.y, w: sw, h: B.h }, 'Sort: ' + sl, { icon: SORT_ICON[this.sort], tone: 'aqua', tip: 'Change the sort order (click again for the next one)' })) {
      const i = SORTS.findIndex((s) => s[0] === this.sort); this.sort = SORTS[(i + 1) % SORTS.length][0];
      this.fx('sparkle', bx + sw / 2, B.y + B.h / 2, 5);
    }
    bx += sw + 10;
    // rarity gems: click one to show only that rarity, click it again for all
    for (const r of RARITY_ORDER) {
      const rr = { x: bx, y: B.y, w: 18, h: B.h }, on = this.rar === r, dim = this.rar && !on;
      const hov = ui.hover(rr);
      if (on) drawAeroSurface(ctx, rr.x - 1, rr.y, rr.w + 2, rr.h, { tone: toneFrom(RARITY[r].color), r: 6, gloss: 0.8, glossH: 8, rim: 0.85, glow: 0.6 });
      ctx.save(); if (dim) ctx.globalAlpha *= 0.4;
      drawIcon3D(ctx, 'gem_' + r, rr.x + rr.w / 2, rr.y + rr.h / 2 - (hov ? 1 : 0), on || hov ? 17 : 14, { t: this.t, hover: hov || on ? 1 : 0, phase: RARITY_ORDER.indexOf(r) }); // [phase9:ui] 3D gems
      ctx.restore();
      if (hov) ui.tip = on ? `Showing ${RARITY[r].name} only (click for all)` : `Only ${RARITY[r].name}`;
      if (ui.clicked(rr)) { this.rar = on ? null : r; this.scroll = 0; this.game.audio.play('ui_toggle'); this.fx('sparkle', rr.x + 9, rr.y + 10, 5, { ramp: r === 'legendary' ? 'gold' : undefined }); }
      bx += 20;
    }
    bx += 8;
    if (this.btn(ui, ctx, { x: bx, y: B.y, w: 26, h: B.h }, '', { icon: this.favOnly ? 'star' : 'star_empty', tone: this.favOnly ? 'orange' : 'white', on: this.favOnly, tip: 'Only favourites' })) { this.favOnly = !this.favOnly; this.scroll = 0; }
    bx += 29;
    if (this.btn(ui, ctx, { x: bx, y: B.y, w: 26, h: B.h }, '', { icon: 'sparkle', tone: this.special ? 'purple' : 'white', on: this.special, tip: 'Only shiny or mutated fish' })) { this.special = !this.special; this.scroll = 0; }
    const n = this.list().length;
    drawText(ctx, `${n} fish`, B.x + B.w, B.y + 6, { align: 'right', color: INK });
  }

  btn(ui, ctx, r, label, o = {}) {
    const hov = !o.dis && ui.hover(r);
    drawAeroButton(ctx, r.x, r.y, r.w, r.h, { label, icon: o.icon ? getUiIcon(o.icon) : null, tone: o.tone || 'aqua', font: o.font, state: o.dis ? 'disabled' : o.on ? 'down' : hov ? (ui.inp.down ? 'down' : 'hover') : 'normal' });
    if (hov && o.tip) ui.tip = o.tip;
    if (hov && !this.hovBtn?.[r.x + ',' + r.y]) { this.hovBtn = { [r.x + ',' + r.y]: 1 }; this.game.audio.play('ui_hover', { vol: 0.3 }); }
    if (!o.dis && ui.clicked(r)) { this.game.audio.play('ui_click'); ui.splash?.(r.x + r.w / 2, r.y + r.h / 2, 0.7); return true; }
    if (o.dis && ui.hover(r) && ui.inp.pressed) ui.inp.pressed = false;
    return false;
  }

  // a live portrait: the fish swims in place inside a little tank window
  portrait(ctx, rec, x, y, w, h, t, o = {}) {
    const sp = SPECIES_BY_ID[rec.species];
    ctx.drawImage(tankWindow(w, h, o.r ?? 5, !rec.inTank, (sp.id.length * 7) % 13), x, y);
    ctx.save();
    roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, (o.r ?? 5) - 1); ctx.clip();
    const s = fitScale(sp, w * 0.78, h * 0.62, o.max ?? 2);
    const swim = o.swim ? Math.sin(t * 0.6) * w * 0.12 : 0;
    const mood = moodOf(rec);
    try {
      drawFishFit(ctx, sp, x + w / 2 + swim, y + h * 0.45 + Math.sin(t * 1.8) * 1.2, s, t + (o.ph || 0), { emotion: mood === 'happy' || mood === 'love' ? 'happy' : mood === 'sad' ? 'sad' : 'neutral', pri: 2, facing: o.swim && Math.cos(t * 0.6) < 0 ? -1 : 1, turn: o.swim && Math.cos(t * 0.6) < 0 ? -1 : 1 }, rec.variant || null);
    } catch { /* the thumbnail fallback */ const th = fishThumb(rec, w - 8, h - 10); if (th) ctx.drawImage(th, x + 4, y + 4); }
    // bubbles + a caustic glint sliding over the glass
    for (let i = 0; i < 3; i++) { const q = (t * 0.45 + i / 3 + (o.ph || 0)) % 1; drawAeroBubble(ctx, x + w * (0.2 + 0.3 * i) + Math.sin(t * 2 + i) * 2, y + h - 8 - q * (h - 10), 1 + q * 1.5, (1 - q) * 0.8); }
    if (rec.variant?.shiny) for (let i = 0; i < 3; i++) if ((t * 1.6 + i * 0.33) % 1 < 0.3) drawSparkle(ctx, x + 6 + ((i * 53 + 17) % (w - 12)), y + 5 + ((i * 29) % (h - 14)), 2, 1, '#fff6a0');
    ctx.restore();
  }

  card(ctx, ui, rec, r, bf, clipR) {
    const g = this.game, sp = SPECIES_BY_ID[rec.species], rar = RARITY[sp.rarity] || RARITY.common;
    const A = this.fa(rec), dt = ui.dtLast || 1 / 60;
    const vis = { x: Math.max(r.x, clipR.x), y: Math.max(r.y, clipR.y), w: r.w, h: Math.min(r.y + r.h, clipR.y + clipR.h) - Math.max(r.y, clipR.y) };
    const hov = vis.h > 0 && ui.hover(vis), sel = rec === this.sel, chk = this.checked.has(rec);
    A.hov += ((hov ? 1 : 0) - A.hov) * Math.min(1, dt * 14);
    A.sel += ((sel ? 1 : 0) - A.sel) * Math.min(1, dt * 12);
    A.pop = Math.max(0, A.pop - dt * 3);
    A.happy += ((rec.happiness ?? 0.7) - A.happy) * Math.min(1, dt * 4);
    A.fed += ((1 - (rec.hunger ?? 0.3)) - A.fed) * Math.min(1, dt * 4);
    const partnerOk = bf && bf !== rec && rec.inTank;
    const lift = Math.round((A.hov * 2 + Math.sin(A.pop * Math.PI) * 3) * 2) / 2;
    const x = r.x, y = r.y - lift, w = r.w, h = r.h;
    // shadow, glow and the rarity frame (shiny for rare and up)
    ctx.fillStyle = 'rgba(4,40,80,0.18)'; ctx.fillRect(x + 4, r.y + h, w - 8, 2 + A.hov);
    if (A.hov > 0.05 || sel) drawAeroGlow(ctx, x + w / 2, y + h / 2, w * 0.62, partnerOk ? '#ff9ed2' : rar.color, 0.22 * Math.max(A.hov, A.sel));
    const tone = { top: mix(rar.color, '#ffffff', 0.72), mid: mix(rar.color, '#ffffff', 0.35), bot: rar.color, edge: sel ? '#ffffff' : rar.dark, a: [1, 1], glow: '#ffffff' };
    drawAeroSurface(ctx, x, y, w, h, { tone, r: 8, gloss: 0.55, glossH: 12, curve: 2, rim: 0.9, glow: 0.5, streak: RARITY_ORDER.indexOf(sp.rarity) >= 2 });
    if (sel) drawAeroSurface(ctx, x - 1, y - 1, w + 2, h + 2, { top: '#ffffff', mid: '#ffffff', bot: '#ffffff', a: [0, 0], edge: '#0b4f8f', r: 9, gloss: 0, rim: 0, glow: 0 });
    // inner card
    drawAeroSurface(ctx, x + 4, y + 4, w - 8, h - 8, { tone: 'frost', a: [0.95, 0.92], r: 6, gloss: 0.3, glossH: 8, rim: 0.7, glow: 0.3, edge: rar.dark, edgeA: 0.6 });
    // portrait
    const PH = 50;
    this.portrait(ctx, rec, x + 7, y + 7, w - 14, PH, this.t, { ph: A.ph });
    // rarity shine: a glare sweeping across the whole card (rare and up, or on hover)
    const ri = RARITY_ORDER.indexOf(sp.rarity);
    if (ri >= 2 || A.hov > 0.3) {
      const per = ri >= 4 ? 2.2 : ri >= 3 ? 3 : 4;
      const q = ((this.t + A.ph) % per) / 0.8;
      if (q < 1) {
        ctx.save(); roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, 7); ctx.clip();
        ctx.globalAlpha = 0.4 * Math.sin(q * Math.PI);
        ctx.fillStyle = '#ffffff';
        const sx = x - h + q * (w + h * 1.6);
        for (let yy = 0; yy < h; yy += 0.5) { ctx.fillRect(Math.round((sx + yy * 0.7) * 2) / 2, y + yy, 6, 0.5); ctx.fillRect(Math.round((sx + 9 + yy * 0.7) * 2) / 2, y + yy, 1.5, 0.5); }
        ctx.restore();
      }
    }
    if (ri >= 4 && ((this.t * 0.8 + A.ph) % 1) < 0.2) drawSparkle(ctx, x + 4 + ((this.t * 37) % (w - 8)), y + 3, 2, 1, '#fff6a0');
    // rarity gem on the top-right corner of the portrait + the place badge
    drawIcon3D(ctx, 'gem_' + sp.rarity, x + w - 13, y + 10, 12, { t: this.t, hover: A.hov > 0.5 ? 1 : 0, phase: A.ph });
    const pl = rec.inTank ? 'TANK' : 'KEPT';
    const pw = measureText(pl, 'small') + 10;
    drawAeroSurface(ctx, x + 10, y + PH - 6, pw, 11, { tone: rec.inTank ? 'aqua' : 'grey', r: 'pill', gloss: 0.7, glossH: 5, rim: 0.7, glow: 0.4 });
    drawText(ctx, pl, x + 15, y + PH - 4, { font: 'small', color: '#ffffff', shadow: rec.inTank ? '#0a4680' : '#3a4a5c' });
    // name + species line
    const ny = y + PH + 11;
    let nm = rec.name || sp.name;
    while (nm.length > 2 && measureText(nm) > w - 34) nm = nm.slice(0, -1);
    if (nm !== (rec.name || sp.name)) nm = nm.slice(0, -1) + '..';
    drawText(ctx, nm, x + 9, ny, { color: INK });
    if (rec.fav) { const s2 = getUiIcon('star'); if (s2) ctx.drawImage(s2, x + w - 20, ny - 1); }
    const tag = rec.variant?.shiny ? 'SHINY' : rec.variant?.mutation ? (MUTATIONS[rec.variant.mutation]?.name || rec.variant.mutation).toUpperCase() : null;
    drawText(ctx, tag || (rec.name ? sp.name : rar.name), x + 9, ny + 11, { font: 'small', color: tag ? '#a8389a' : rar.dark });
    // mood face + meters
    const my = ny + 21;
    const mood = moodOf(rec);
    const bob = mood === 'love' || mood === 'happy' ? Math.round(Math.abs(Math.sin(this.t * 4 + A.ph)) * 2) / 2 : mood === 'hungry' ? Math.round(Math.sin(this.t * 14) * 0.5 * 2) / 2 : 0;
    if (!drawIcon3D(ctx, 'mood_' + mood, x + 14, my + 4 - bob, 15, { t: this.t, hover: A.hov > 0.5 ? 1 : 0, phase: A.ph })) ctx.drawImage(moodFace(mood, 12), x + 7, my - 3 - bob); // [phase9:ui] 3D mood
    if (mood === 'love' && ((this.t * 0.7 + A.ph) % 1) < 0.25) this.fxT(rec, () => this.fx('heart', x + 14, my - 4, 1, { size: 0 }));
    const bw = w - 40;
    meter(ctx, x + 26, my - 1, bw, 5, A.happy, '#ff7aa8', this.t, A.ph);
    meter(ctx, x + 26, my + 6, bw, 5, A.fed, A.fed < 0.38 ? '#ff9a3a' : '#7ee07a', this.t, A.ph + 1);
    // Aero / min
    if (rec.inTank) { const rt = (this.aq?.rateOf?.(rec) || 0).toFixed(1); drawText(ctx, rt, x + w - 8 - measureText(rt, 'small'), ny + 11, { font: 'small', color: INK }); drawAeroCoin(ctx, x + w - 14 - measureText(rt, 'small'), ny + 13, 3, 0); }
    // checkbox (top-left of the portrait)
    const cb = { x: x + 9, y: y + 9, w: 11, h: 11 };
    drawAeroSurface(ctx, cb.x, cb.y, cb.w, cb.h, { tone: chk ? 'green' : 'white', r: 3, gloss: 0.7, glossH: 5, rim: 0.8, glow: 0.4, a: chk ? [1, 1] : [0.85, 0.85] });
    if (chk) { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, cb.x + Math.round((cb.w - ck.width) / 2), cb.y + Math.round((cb.h - ck.height) / 2)); }
    if (sel) drawPixelBrackets(ctx, x, y, w, h, this.t, { col: '#ffffff', ink: '#0a3e74', gap: 1 });
    // hover lines
    if (hov) ui.tip = null;
    if (hov && !this.lastHov?.has(rec)) { this.lastHov = new Set([rec]); g.audio.play('ui_hover', { vol: 0.35, pitch: 0.9 + ri * 0.08 }); }
    // clicks
    if (hov && ui.clicked({ x: cb.x - 3, y: cb.y - 3, w: cb.w + 6, h: cb.h + 6 })) { if (chk) this.checked.delete(rec); else { this.checked.add(rec); this.fx('sparkle', cb.x + 5, cb.y + 5, 4); } g.audio.play('ui_toggle'); return hov; }
    if (hov && ui.clicked(vis)) {
      if (bf) { if (rec === bf) this.breedFor = null; else { this.breed(bf, rec); this.fx('heart', x + w / 2, y + 30, 8); } return hov; }
      if (this.sel === rec && this.lastClick && this.t - this.lastClick < 0.35) this.see(rec);
      this.sel = rec; this.lastClick = this.t; A.pop = 1; g.audio.play('ui_page');
      this.fx('bubble', x + w / 2, y + 30, 5, { ramp: 'aqua' });
    }
    return hov;
  }

  details(ctx, ui, D) {
    const g = this.game, rec = this.sel;
    drawAeroSurface(ctx, D.x, D.y, D.w, D.h, { tone: 'frost', r: 10, gloss: 0.45, glossH: 16, rim: 0.85, glow: 0.4, streak: true });
    if (!rec) { drawText(ctx, 'Pick a fish', D.x + D.w / 2, D.y + 50, { align: 'center', font: 'big', color: SOFT }); return; }
    const sp = SPECIES_BY_ID[rec.species], rar = RARITY[sp.rarity] || RARITY.common;
    const A = this.fa(rec);
    // the big live tank window with a rarity frame
    const ww = D.w - 16, wh = 112;
    drawAeroSurface(ctx, D.x + 5, D.y + 5, ww + 6, wh + 6, { tone: { top: mix(rar.color, '#ffffff', 0.6), mid: rar.color, bot: rar.dark, edge: shade(rar.dark, -0.4), a: [1, 1], glow: '#ffffff' }, r: 8, gloss: 0.6, glossH: 10, rim: 0.85, glow: 0.4 });
    this.portrait(ctx, rec, D.x + 8, D.y + 8, ww, wh, this.t, { r: 6, max: 3, swim: true, ph: A.ph });
    const ri = RARITY_ORDER.indexOf(sp.rarity);
    for (let i = 0; i <= ri; i++) drawIcon3D(ctx, 'gem_' + sp.rarity, D.x + 17 + i * 12, D.y + wh + 1, 12, { t: this.t, phase: i * 0.7 });
    let y = D.y + wh + 20;
    // name (click Rename to edit in place)
    if (this.edit?.rec === rec) {
      const caret = (this.t * 2) % 1 < 0.5 ? '|' : '';
      drawAeroSurface(ctx, D.x + 8, y - 3, D.w - 16, 16, { tone: 'white', r: 4, gloss: 0.3, rim: 0.8, inset: true, edge: '#3ac4f8' });
      drawText(ctx, this.edit.text + caret, D.x + 12, y + 1, { color: INK });
      drawText(ctx, 'Enter: save   Esc: cancel', D.x + 10, y + 16, { font: 'small', color: SOFT });
      y += 28;
    } else {
      const nm = rec.name || sp.name;
      const ts = titleSize(nm, { scale: 1 });
      if (ts.w < D.w - 20) drawTitle(ctx, nm, D.x + 10, y, { scale: 1, size: 16, outline: shade(rar.dark, -0.3) });
      else drawText(ctx, nm, D.x + 10, y, { font: 'big', color: INK });
      y += 15;
      drawText(ctx, `${sp.name}`, D.x + 10, y, { color: SOFT });
      drawText(ctx, rar.name.toUpperCase(), D.x + D.w - 10, y, { align: 'right', font: 'small', color: rar.dark });
      y += 12;
    }
    const tags = [];
    if (rec.variant?.shiny) tags.push(['SHINY', '#e8a020']);
    if (rec.variant?.mutation) tags.push([(MUTATIONS[rec.variant.mutation]?.name || rec.variant.mutation).toUpperCase(), '#a8389a']);
    if (rec.bred) tags.push(['BRED', '#ff74b4']);
    let tx = D.x + 10;
    drawText(ctx, `${(rec.sizeCm || 0).toFixed(1)} cm`, tx, y + 1, { color: INK }); tx += measureText(`${(rec.sizeCm || 0).toFixed(1)} cm`) + 8;
    for (const [tg, c] of tags) { const tw = measureText(tg, 'small') + 10; drawAeroSurface(ctx, tx, y - 1, tw, 11, { tone: toneFrom(c), r: 'pill', gloss: 0.7, glossH: 5, rim: 0.8 }); drawText(ctx, tg, tx + 5, y + 1, { font: 'small', color: '#ffffff', shadow: shade(c, -0.6) }); tx += tw + 3; }
    y += 15;
    // mood + the big meters
    const mood = moodOf(rec);
    const bob = Math.round(Math.abs(Math.sin(this.t * 3)) * (mood === 'sad' ? 0 : 1.5) * 2) / 2;
    if (!drawIcon3D(ctx, 'mood_' + mood, D.x + 16, y + 5 - bob, 22, { t: this.t, hover: 1, phase: 0.3 })) ctx.drawImage(moodFace(mood, 16), D.x + 7, y - 4 - bob);
    drawText(ctx, MOODS[mood].label, D.x + 30, y + 1, { font: 'big', color: shade(MOODS[mood].col, -0.55) });
    if (rec.inTank) { const rt = `${(this.aq?.rateOf?.(rec) || 0).toFixed(1)}/min`; drawText(ctx, rt, D.x + D.w - 10, y + 1, { align: 'right', color: INK }); drawAeroCoin(ctx, D.x + D.w - 16 - measureText(rt), y + 4, 4, this.t); }
    else drawText(ctx, 'earns nothing', D.x + D.w - 10, y + 2, { align: 'right', font: 'small', color: SOFT });
    y += 13;
    const bw = D.w - 52;
    const hi = getUiIcon('heart'), fo = getUiIcon('food');
    if (hi) ctx.drawImage(hi, D.x + 30, y);
    meter(ctx, D.x + 42, y + 1, bw - 10, 7, A.happy, '#ff7aa8', this.t, 0);
    y += 11;
    if (fo) ctx.drawImage(fo, D.x + 30, y);
    meter(ctx, D.x + 42, y + 1, bw - 10, 7, A.fed, A.fed < 0.38 ? '#ff9a3a' : '#7ee07a', this.t, 1);
    y += 14;
    // actions: a 2-column grid
    const cw = Math.floor((D.w - 22) / 2), ch = 20;
    const A2 = [
      ['See it', 'eye', 'aqua', () => this.see(rec), !rec.inTank, 'The camera follows it (double-click a card too)'],
      [rec.inTank ? 'To storage' : 'To tank', rec.inTank ? 'home' : 'tank', 'aqua', (bx, by) => { if (this.move(rec, !rec.inTank)) { if (rec.inTank) this.fx('splash', bx, by, 8); else this.fx('puff', bx, by, 6, { ramp: 'white' }); } }, false, rec.inTank ? 'Move to storage' : 'Move into the tank'],
      [rec.fav ? 'Unstar' : 'Favourite', rec.fav ? 'star' : 'star_empty', 'orange', (bx, by) => { rec.fav = rec.fav ? undefined : true; if (!rec.fav) delete rec.fav; else { this.fx('star', bx, by, 8, { ramp: 'gold' }); this.fx('heart', bx, by, 3); } g.save?.(); }, false],
      ['Rename', 'book', 'white', (bx, by) => { if (this.edit) this.edit.close(); this.edit = new TextEdit(rec.name || ''); this.edit.rec = rec; this.fx('sparkle', bx, by, 4); }, false],
      ['Breed...', 'heart', toneFrom('#ff74b4'), (bx, by) => { const why = this.aq?.canBreed?.(rec); if (why) { this.toast(why, 'heart'); g.audio.play('ui_error'); } else { this.breedFor = rec; this.fx('heart', bx, by, 6); } }, false, 'Pick a partner in the list'],
      [`Release +${fmtAero(this.value(rec))}`, 'coin', 'red', () => { this.confirm = { recs: [rec], value: this.value(rec) }; }, false, 'Let it go for Aero'],
    ];
    A2.forEach(([label, icon, tone, f, dis, tip], i) => {
      const r = { x: D.x + 8 + (i % 2) * (cw + 6), y: y + Math.floor(i / 2) * (ch + 4), w: cw, h: ch };
      if (r.y + r.h > D.y + D.h - 4) return;
      if (this.btn(ui, ctx, r, label, { icon, tone, font: 'small', dis, tip })) f(r.x + r.w / 2, r.y + r.h / 2);
    });
    // a little fact card: when it joined you, what it is worth, its rank in the collection
    y += 3 * (ch + 4) + 4;
    if (y + 40 < D.y + D.h) {
      drawAeroSurface(ctx, D.x + 8, y, D.w - 16, 40, { tone: 'white', a: [0.7, 0.75], r: 6, gloss: 0.3, glossH: 8, rim: 0.7, glow: 0.3, inset: true });
      const when = rec.caughtAt || rec.bornAt;
      const ago = when ? Math.max(0, (Date.now() - when) / 1000) : null;
      const fmtAgo = ago === null ? '--' : ago < 60 ? 'just now' : ago < 3600 ? `${Math.floor(ago / 60)} min ago` : ago < 86400 ? `${Math.floor(ago / 3600)} h ago` : `${Math.floor(ago / 86400)} days ago`;
      drawText(ctx, rec.bred ? 'HATCHED' : 'CAUGHT', D.x + 14, y + 6, { font: 'small', color: SOFT });
      drawText(ctx, fmtAgo, D.x + D.w - 14, y + 5, { align: 'right', color: INK });
      drawText(ctx, 'WORTH', D.x + 14, y + 22, { font: 'small', color: SOFT });
      const vv = fmtAero(this.value(rec));
      drawText(ctx, vv, D.x + D.w - 14, y + 21, { align: 'right', color: INK });
      drawAeroCoin(ctx, D.x + D.w - 20 - measureText(vv), y + 25, 4, this.t);
    }
  }

  drawConfirm(ctx, ui, R) {
    const c = this.confirm;
    ctx.fillStyle = 'rgba(4,48,78,0.4)'; ctx.fillRect(R.x, R.y, R.w, R.h);
    const w = 300, h = 104, x = Math.round(R.x + R.w / 2 - w / 2), y = Math.round(R.y + R.h / 2 - h / 2);
    ctx.fillStyle = 'rgba(2,26,56,0.35)'; ctx.fillRect(x + 4, y + 5, w, h);
    drawAeroSurface(ctx, x, y, w, h, { tone: 'frost', r: 12, gloss: 0.5, glossH: 22, rim: 0.9, glow: 0.6, streak: true, sparkle: 2 });
    const n = c.recs.length;
    const nm = n === 1 ? (c.recs[0].name || SPECIES_BY_ID[c.recs[0].species]?.name) : `${n} fish`;
    if (n === 1) this.portrait(ctx, c.recs[0], x + 10, y + 10, 58, 40, this.t, { r: 5 });
    const tx = n === 1 ? x + 76 : x + 14;
    drawText(ctx, `Release ${nm}?`, tx, y + 14, { font: 'big', color: INK });
    drawText(ctx, 'They swim back to the ocean.', tx, y + 30, { font: 'small', color: SOFT });
    drawAeroCoin(ctx, tx + 5, y + 44, 4.5, this.t); drawText(ctx, `+${fmtAero(c.value)} Aero`, tx + 13, y + 41, { color: INK });
    if (this.btn(ui, ctx, { x: x + 20, y: y + h - 32, w: 120, h: 24 }, 'Release', { icon: 'check', tone: 'red' })) {
      this.confirm = null; this.release(c.recs);
      this.fx('splash', x + 80, y + h - 20, 10); this.fx('coin', x + 80, y + h - 30, Math.min(12, 3 + n * 2));
    }
    if (this.btn(ui, ctx, { x: x + w - 140, y: y + h - 32, w: 120, h: 24 }, 'Keep', { icon: 'heart', tone: 'green' })) { this.confirm = null; this.fx('heart', x + w - 80, y + h - 20, 5); }
    if (ui.inp.pressed) ui.inp.pressed = false;
  }
}

// A glossy animated meter: a recessed glass track, the fill wobbling a touch at its edge, a shimmer running along,
// and a red pulse when nearly empty.
function meter(ctx, x, y, w, h, k, color, t, ph = 0) {
  k = clamp01(k);
  const wob = k > 0.02 && k < 0.98 ? Math.sin(t * 5 + ph) * 0.006 : 0;
  const low = k < 0.25;
  drawAeroBar(ctx, x, y, w, h, k + wob, { color: low && Math.sin(t * 8) > 0 ? '#ff5a5a' : color });
  const fw = (w - 2) * k;
  if (fw > 6) {
    const q = ((t * 0.5 + ph * 0.3) % 1.4);
    if (q < 1) {
      const sx = x + 1 + q * fw;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(Math.round(sx * 2) / 2, y + 1, 1, h - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(Math.round((sx - 1.5) * 2) / 2, y + 1, 1, h - 2);
    }
  }
}

export function registerFishManager(ui) {
  try { if (ICON_MODELS && !ICON_MODELS.fishmgr) ICON_MODELS.fishmgr = cubeFishIcon; } catch { /* icons optional */ }
  ui.register(new FishManagerPanel());
}
void clamp01; void uiK;
