// Bait art (phase 3, OWNER: Online & AppSea agent): the hook sprite plus glossy VOXEL bait.
//   HOOK                         hand-authored hook sprite (used by fishing + tutorial)
//   TYPE_ART[type] = [c1, c2]    app-bait colours per species bait-pref type
//   baitVoxel(art, scale)        cached voxel render {canvas, glow, w, h} of a bait art spec
//   baitMini(art)                ~12-16 px sprite for the hook (cached)
//   baitIcon(art, px)            inventory-sized sprite (fits ~px)
//   drawBaitGloss(ctx, art, cx, cy, px, t, {bubble, aura, bob})  sprite in a glass bubble with scent aura
//   baitSprite(typeOrArt, t)     legacy entry: a bait type/id string or an art object -> mini sprite
// Art spec: {shape: 'grub'|'crumbs'|'bread'|'worm'|'sugar'|'chip'|'popup'|'flood'|'lantern'|'golden'|'blackhole'|'relic',
//   color, color2 (grub two-tone / custom tint), tier (0..4 app tier: glitter, glow), charm (star|heart|gem|clover|crown),
//   scale (custom size 0.8..1.25), scent (aura colour), type}

import { spriteFromAscii } from '../gfx/pixel.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { shade, mix, rgba } from '../core/color.js';
import { TAU, hash1 } from '../core/math.js';

const P = {
  k: '#14131c', d: '#5d6677', m: '#9aa6b8', l: '#d8e2ee', w: '#ffffff',
};

export const HOOK = spriteFromAscii(`
..kkk..
.kmlmk.
.kk.kk.
..kmk..
..kmk..
..kmk..
..kmk..
k.kmk..
kmkmk..
kmlmk..
.kmmk..
..kk...
`, P);

export const TYPE_ART = {
  docs: ['#ffd84a', '#fff6c8'], folder: ['#f0b850', '#ffe7a8'], calc: ['#8a9ab8', '#ff9a3a'], calendar: ['#ff5a62', '#ffffff'],
  music: ['#ff6ac8', '#9a6aff'], image: ['#4ac8ff', '#7ae05a'], video: ['#ff4a5a', '#3a3a52'], paint: ['#ff8a3a', '#4ac8ff'],
  game: ['#8a5aff', '#5affa8'], chat: ['#4ad0ff', '#ffffff'], mail: ['#3a8aff', '#ffffff'], browser: ['#2a9aff', '#6ad06a'],
  terminal: ['#24343a', '#5aff8a'], settings: ['#9aa8b8', '#e8f0f8'], computer: ['#3ab85a', '#ffd84a'], trash: ['#6ad84a', '#ff5a5a'],
};
const SPECIAL_SHAPES = new Set(['crumbs', 'bread', 'worm', 'sugar', 'chip', 'popup', 'flood', 'lantern', 'golden', 'blackhole', 'relic']);

// ---------------------------------------------------------------- voxel builders
const GLOSS = { spec: 0.9, specPow: 10, smooth: 0.7 };

function grub(m, a) {
  const c1 = a.color || '#ffd84a', c2 = a.color2 || mix(c1, '#ffffff', 0.6);
  const tier = a.tier | 0;
  const back = m.color(c1, { ...GLOSS, jitter: 0.04 });
  const belly = m.color(c2, { ...GLOSS, jitter: 0.03 });
  const rib = m.color(shade(c1, -0.14), { ...GLOSS });
  const glit = m.color(tier >= 4 ? '#fff2a0' : '#ffffff', { spec: 1, specPow: 6, emissive: tier >= 3 ? 0.6 : 0.2 });
  const tailC = m.color(tier >= 3 ? mix(c1, '#ffffff', 0.25) : c1, { ...GLOSS, emissive: tier >= 3 ? 0.3 : 0 });
  const zc = 4.5;
  // fat segmented body, head to the right
  for (let i = 0; i < 6; i++) {
    const x = 8 + i * 1.7, r = 2.7 + Math.sin(((i + 1) / 7) * Math.PI) * 0.8;
    m.ellipsoid(x, 6, zc, 1.3, r, r, (vx, vy) => (vy < 5.4 ? belly : i % 2 ? rib : back));
  }
  m.ellipsoid(18, 6.1, zc, 2.6, 3, 2.9, (vx, vy) => (vy < 5.2 ? belly : back));
  // curly paddle tail
  const pts = [[7.4, 6.2], [5.6, 7.6], [3.8, 8.8], [2.2, 8.6], [1.2, 7.2], [1.4, 5.4], [2.8, 4.4]];
  for (let i = 1; i < pts.length; i++) m.line(pts[i - 1][0], pts[i - 1][1], zc, pts[i][0], pts[i][1], zc, tailC, 1.6 - i * 0.1);
  m.ellipsoid(3.4, 4.2, zc, 1.8, 1.1, 1.3, tailC);
  // glossy lure eye
  const eyeW = m.color('#ffffff', { spec: 1, specPow: 8 }), eyeP = m.color('#101828', { spec: 1, specPow: 10 });
  m.set(19, 7, zc + 2.4, eyeW); m.set(19, 7, zc + 2.9, eyeW); m.set(20, 7, zc + 2.2, eyeW); m.set(19.6, 7, zc + 3.3, eyeP);
  if (tier >= 1) for (let i = 0; i < 4 + tier * 3; i++) {
    const x = 8 + hash1(i, 3) * 10, y = 6.4 + hash1(i, 5) * 2.4;
    m.set(x, y, zc + 3, glit);
  }
}

function crumbs(m, a) {
  const crust = m.color('#c8904a', { jitter: 0.08, smooth: 0.3 }), soft = m.color('#f6e2b4', { jitter: 0.05 });
  const c = (x, y, z, s) => m.box(x, y, z, x + s, y + s, z + s, (vx, vy, vz) => (vy === y + s || vx === x || vz === z + s ? crust : soft));
  c(3, 0, 2, 3); c(8, 0, 3, 2); c(6, 3, 3, 2); c(1, 0, 6, 1);
}

function bread(m) {
  const crust = m.color('#b8783a', { jitter: 0.06, smooth: 0.4 }), soft = m.color('#f8e8c0', { jitter: 0.04 });
  m.box(1, 0, 2, 10, 7, 4, (x, y) => (x === 1 || x === 10 || y === 0 ? crust : soft));
  m.ellipsoid(3.6, 7.2, 3.5, 2.8, 2.4, 1.6, (x, y) => (y >= 8 || x <= 1 ? crust : soft));
  m.ellipsoid(8.4, 7.2, 3.5, 2.8, 2.4, 1.6, (x, y) => (y >= 8 || x >= 10 ? crust : soft));
  m.sub(() => m.box(1, 0, 2, 10, 0, 2));
}

function worm(m) {
  const pink = m.color('#ff7ab4', { ...GLOSS, emissive: 0.25 }), band = m.color('#d8508a', { ...GLOSS });
  const pts = [[2, 2], [4, 4], [6, 5], [8, 4.5], [9.5, 3], [11.5, 2.5], [13, 4], [13.5, 6.5], [12.5, 8.5]];
  for (let i = 0; i < pts.length; i++) m.sphere(pts[i][0], pts[i][1], 3, 1.6 - (i === 0 ? 0.4 : 0), i % 3 === 1 ? band : pink);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    m.line(x0, y0, 3, x1, y1, 3, pink, 1.3);
  }
}

function sugar(m) {
  const w = m.color('#ffffff', { spec: 1, specPow: 8, jitter: 0.06 }), s = m.color('#e8f4ff', { spec: 0.8, jitter: 0.04 });
  m.box(1, 0, 1, 7, 6, 7, (x, y, z) => ((x + y + z) % 3 ? w : s));
  for (const [x, y, z] of [[1, 6, 1], [7, 6, 1], [1, 6, 7], [7, 6, 7], [1, 0, 7], [7, 0, 7]]) m.set(x, y, z, 0);
}

function chip(m) {
  const pcb = m.color('#2fa860', { jitter: 0.05 }), die = m.color('#262a36', { spec: 0.9, specPow: 12 }), pin = m.color('#ffd25a', { spec: 1, specPow: 6 });
  const led = m.color('#7affd0', { emissive: 1 });
  m.box(1, 0, 1, 10, 1, 10, pcb);
  m.box(3, 2, 3, 8, 3, 8, die);
  for (let i = 3; i <= 8; i += 1.66) { m.set(i, 1, 0, pin); m.set(i, 1, 11, pin); m.set(0, 1, i, pin); m.set(11, 1, i, pin); }
  m.set(9, 2, 9, led); m.set(4, 4, 4, led);
}

function popup(m) {
  const bar = m.color('#2a7ae8', { ...GLOSS }), body = m.color('#ffffff', { jitter: 0.03 }), x = m.color('#ff4a4a', { emissive: 0.4 }), star = m.color('#ffd23a', { emissive: 0.5 });
  m.box(0, 0, 2, 11, 8, 3, (vx, vy) => (vy >= 7 ? bar : body));
  m.set(10, 7, 4, x); m.set(10, 8, 4, x);
  for (const [sx, sy] of [[5, 2], [5, 3], [5, 4], [4, 3], [6, 3]]) m.set(sx, sy, 4, star);
}

function flood(m) {
  const w = m.color('#5ad8ff', { spec: 1, specPow: 7, smooth: 0.9, emissive: 0.15 }), hi = m.color('#d8f8ff', { spec: 1, specPow: 5, emissive: 0.3 });
  m.sphere(5.5, 3.8, 3.5, 3.4, w);
  m.cone(5.5, 3.5, 4, 10, 2.6, 0.3, w, 'y');
  m.set(4, 5, 6, hi); m.set(4, 6, 6, hi);
}

function lantern(m) {
  const pearl = m.color('#bffff0', { emissive: 0.9, smooth: 1, spec: 1 }), gold = m.color('#e8b23a', { spec: 1, specPow: 6 });
  m.sphere(5, 4.2, 4, 3.6, pearl);
  m.cylinder(5, 4, 7.6, 8.4, 1.8, gold);
  m.set(5, 9, 4, gold); m.set(5, 10, 4, gold);
}

function golden(m) {
  const g = m.color('#ffcc3a', { spec: 1, specPow: 5, smooth: 0.8, emissive: 0.25 }), g2 = m.color('#ffe88a', { spec: 1, specPow: 4, emissive: 0.4 });
  m.ellipsoid(5.5, 3.2, 4, 4.4, 3.2, 3.4, g);
  m.sphere(3.5, 5.4, 4.6, 1.8, g2);
  m.sphere(7.5, 4.4, 5.2, 1.4, g);
}

function blackhole(m) {
  const core = m.color('#0a0614', { spec: 0.6 }), ring = m.color('#b07aff', { emissive: 1 }), ring2 = m.color('#ff8ad8', { emissive: 0.9 });
  m.sphere(6.5, 5, 6.5, 3.4, core);
  for (let a = 0; a < TAU; a += 0.12) {
    const r = 5.6;
    m.set(6.5 + Math.cos(a) * r, 5 + Math.sin(a) * 1.2, 6.5 + Math.sin(a) * r * 0.9, a % 0.5 < 0.25 ? ring : ring2);
  }
}

function relic(m) {
  const stone = m.color('#8a8070', { jitter: 0.12, smooth: 0.2 }), rune = m.color('#6affe8', { emissive: 1 });
  m.box(1, 0, 2, 8, 10, 4, stone);
  m.ellipsoid(4.5, 10, 3, 3.6, 1.6, 1.5, stone);
  for (const [x, y] of [[4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [3, 7], [5, 7], [3, 4], [5, 4], [4, 8]]) m.set(x, y, 5, rune);
}

const BUILDERS = { grub, crumbs, bread, worm, sugar, chip, popup, flood, lantern, golden, blackhole, relic };

function charm(m, kind, ox, oy) {
  const z = 4;
  if (kind === 'star') {
    const c = m.color('#ffd23a', { emissive: 0.5, spec: 1 });
    for (const [x, y] of [[0, 1], [1, 1], [2, 1], [1, 0], [1, 2], [1, 3], [0, 3], [2, 3]]) m.set(ox + x, oy + y, z, c);
  } else if (kind === 'heart') {
    const c = m.color('#ff4a7a', { spec: 1, specPow: 6 });
    for (const [x, y] of [[0, 2], [1, 2], [3, 2], [4, 2], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 0], [2, 0], [3, 0], [2, -1]]) m.set(ox + x - 1, oy + y + 1, z, c);
  } else if (kind === 'gem') {
    const c = m.color('#6af0ff', { emissive: 0.4, spec: 1, specPow: 4 });
    for (const [x, y] of [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [1, 3]]) m.set(ox + x, oy + y, z, c);
  } else if (kind === 'clover') {
    const c = m.color('#4ad85a', { spec: 0.8 }), s = m.color('#2a8a3a');
    for (const [x, y] of [[0, 2], [1, 2], [3, 2], [4, 2], [0, 3], [1, 3], [3, 3], [4, 3], [0, 0], [1, 0], [3, 0], [4, 0], [2, 1], [2, 2]]) m.set(ox + x - 1, oy + y, z, c);
    m.set(ox + 1, oy - 1, z, s);
  } else if (kind === 'crown') {
    const c = m.color('#ffc83a', { spec: 1, specPow: 5, emissive: 0.3 }), j = m.color('#ff4a6a', { emissive: 0.5 });
    m.box(ox - 1, oy, z, ox + 3, oy + 1, z, c);
    for (const x of [-1, 1, 3]) m.set(ox + x, oy + 2, z, c);
    m.set(ox + 1, oy + 1, z + 1, j);
  }
}

function buildModel(a) {
  const m = new VoxelModel(22, 16, 13);
  if (a.shape === 'charm') { charm(m, a.charm, 4, 4); return m; }
  const shape = BUILDERS[a.shape] ? a.shape : 'grub';
  if (shape === 'grub') grub(m, a);
  else BUILDERS[shape](m, a);
  // custom tint: recolour the main voxels toward the chosen colour (keeps emissive / accent voxels)
  if (a.custom && a.color && shape !== 'grub') {
    const tint = new Map();
    m.recolor((x, y, z, c) => {
      const pe = m.palette[c];
      if (!pe || pe.emissive >= 0.8) return c;
      let t = tint.get(c);
      if (t === undefined) { t = m.color(mix(pe.color, a.color, 0.45), { ...pe }); tint.set(c, t); }
      return t;
    });
  }
  if (a.charm && a.charm !== 'none') {
    const b = m.bounds();
    charm(m, a.charm, Math.min(m.nx - 4, (b?.x1 ?? 10) - 2), Math.min(m.ny - 5, (b?.y1 ?? 8) + 1));
  }
  return m;
}

const VCACHE = new Map();
function artKey(a, scale) {
  return [a.shape, a.color, a.color2, a.tier, a.charm, a.custom ? 1 : 0, scale].join('|');
}

export function baitVoxel(art, scale = 2) {
  const a = art || { shape: 'crumbs' };
  const key = artKey(a, scale);
  let r = VCACHE.get(key);
  if (r) return r;
  let out;
  try {
    const m = buildModel(a);
    const v = renderVoxels(m, { scale, yaw: a.shape === 'grub' || a.shape === 'worm' ? -14 : 28, pitch: 24, outline: true, groundAO: false });
    out = { canvas: v.canvas, glow: v.glow, w: v.w, h: v.h };
  } catch (e) {
    const c = makeCanvas(6, 6);
    const g = ctxOf(c);
    g.fillStyle = a.color || '#ffd84a';
    g.fillRect(1, 1, 4, 4);
    out = { canvas: c, glow: null, w: 6, h: 6 };
  }
  VCACHE.set(key, out);
  if (VCACHE.size > 240) VCACHE.delete(VCACHE.keys().next().value);
  return out;
}

// Small sprite for the hook (trimmed, <= 16 px wide).
export function baitMini(art) {
  const a = art || { shape: 'crumbs' };
  const v = baitVoxel(a, 1);
  if (v.w <= 18) return v.canvas;
  const k = 16 / v.w;
  const c = makeCanvas(16, Math.max(1, Math.round(v.h * k)));
  const g = ctxOf(c);
  g.drawImage(v.canvas, 0, 0, c.width, c.height);
  return c;
}

// Inventory sprite that fits roughly `px` (picks an integer voxel scale).
export function baitIcon(art, px = 28) {
  const a = art || { shape: 'crumbs' };
  const one = baitVoxel(a, 1);
  const s = Math.max(1, Math.min(4, Math.round((px / Math.max(one.w, one.h)) * (a.scale || 1) * 4) / 4));
  return baitVoxel(a, s);
}

// A bait floating in a glossy glass bubble, with a scent aura and sparkles.
export function drawBaitGloss(ctx, art, cx, cy, px, t = 0, o = {}) {
  const a = art || { shape: 'crumbs' };
  const r = px / 2;
  ctx.save();
  if (o.bubble !== false) {
    // bright glass tinted by the bait's own colour, a white rim and a reflected light along the bottom
    const tint = o.tint || (a.color ? mix(a.color, '#ffffff', 0.62) : '#c8f4ff');
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.5, rgba(tint, 0.42));
    g.addColorStop(1, rgba(o.rim || '#2fb8e0', 0.55));
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1; ctx.stroke();
    if (r >= 8) { ctx.beginPath(); ctx.arc(cx, cy, r - 2, Math.PI * 0.2, Math.PI * 0.8); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke(); }
  }
  const aura = o.aura ?? a.scent;
  if (aura && aura !== '#ffffff') {
    for (let i = 0; i < 6; i++) {
      const ang = t * 1.4 + (i / 6) * TAU, rr = r * (0.62 + 0.12 * Math.sin(t * 3 + i));
      ctx.fillStyle = rgba(aura, 0.55);
      const s = i % 2 ? 2 : 1;
      ctx.fillRect(Math.round(cx + Math.cos(ang) * rr) - (s >> 1), Math.round(cy + Math.sin(ang) * rr * 0.8) - (s >> 1), s, s);
    }
  }
  const spr = baitIcon(a, px * 0.8);
  const bob = o.bob === false ? 0 : Math.round(Math.sin(t * 2.2) * 1.2);
  const x = Math.round(cx - spr.w / 2), y = Math.round(cy - spr.h / 2 + bob);
  if (spr.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(spr.glow, x, y); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  ctx.drawImage(spr.canvas, x, y);
  if (o.bubble !== false) {
    ctx.beginPath(); ctx.ellipse(cx - r * 0.28, cy - r * 0.52, r * 0.42, r * 0.18, -0.35, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
  }
  if ((a.tier | 0) >= 3 || a.shape === 'golden' || a.charm === 'star') {
    const k = (t * 1.7) % 1;
    const sx = Math.round(cx + r * 0.45 * Math.cos(t * 0.9)), sy = Math.round(cy - r * 0.4 + r * 0.2 * Math.sin(t * 1.3));
    ctx.fillStyle = `rgba(255,255,240,${(1 - k).toFixed(2)})`;
    ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3);
  }
  ctx.restore();
}

// Legacy: fishing / bait effects call baitSprite(bait.type, t). Accepts an art spec, a special id or a type key.
export function baitSprite(type, t = 0) {
  if (type && typeof type === 'object') return baitMini(type);
  if (SPECIAL_SHAPES.has(type)) return baitMini({ shape: type });
  const c = TYPE_ART[type];
  if (c) return baitMini({ shape: 'grub', color: c[0], color2: c[1] });
  return baitMini({ shape: 'crumbs' });
}
export const BAIT_SPRITES = {};
