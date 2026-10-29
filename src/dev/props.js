// Dev preview of every voxel prop:
//   dist/dev/props.html?page=0..4|all&bg=dark&only=id,id&zoom=2&scale=1&debug
//   &frames[=id,id]  every animation frame of the interactive decor (plus the movable `part` layer)
//   &yaw=0&pitch=20  camera override (e.g. the ocean's front-facing view)
//   (debug draws sprite bounds, ground anchor, screen rects, light radii and anchors).
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { getProp, PROPS, PROP_VARIANTS, ANIMATED_DECOR, propInteract } from '../gfx/props.js';

const PAGES = [
  { title: 'SUNNY SHALLOWS', filter: (id, p) => p.biome === 'shallows' && !p.decorOnly },
  { title: 'JUNKYARD REEF', filter: (id, p) => p.biome === 'junkyard' && !p.decorOnly },
  { title: 'MIDNIGHT ABYSS', filter: (id, p) => p.biome === 'abyss' && !p.decorOnly },
  { title: 'AQUARIUM DECOR + SHOP', filter: (id, p) => (p.decorOnly && !ANIMATED_DECOR.includes(id)) || id === 'shop_stall' },
  { title: 'FUN DECOR (interactive)', filter: (id) => ANIMATED_DECOR.includes(id) },
];

export function run(params) {
  const W = 960;
  const zoom = Number(params.get('zoom') || 2);
  const dark = params.get('bg') === 'dark';
  const all = params.get('page') === 'all';
  const page = all ? 0 : Number(params.get('page') || 0);
  const only = params.get('only');
  const scale = Number(params.get('scale') || 1);
  const cam = { yaw: params.has('yaw') ? Number(params.get('yaw')) : null, pitch: params.has('pitch') ? Number(params.get('pitch')) : null };
  const cv = document.getElementById('screen');

  // Collect entries: [{id, variant, frame, label}]
  const entries = [];
  const framesArg = params.get('frames');
  if (params.has('frames')) {
    const fids = framesArg ? framesArg.split(',') : ANIMATED_DECOR;
    for (const id of fids) {
      const n = propInteract(id)?.frames || 1;
      for (let f = 0; f < n; f++) entries.push({ id, variant: 0, frame: f, label: f ? 'f' + f : PROPS[id]?.name || id });
      if (propInteract(id)?.motion) entries.push({ id, variant: 0, frame: propInteract(id).motion.part, label: 'part', part: true });
    }
  }
  const ids = params.has('frames') ? [] : only ? only.split(',') : Object.keys(PROPS).filter((id) => all || PAGES[page % PAGES.length].filter(id, PROPS[id]));
  for (const id of ids) {
    const vars = PROP_VARIANTS[id] || [{}];
    for (const v of vars) entries.push({ id, variant: v.variant || 0, frame: v.frame || 0, label: v.label || PROPS[id]?.name || id });
  }

  const t0 = performance.now();
  const times = [];
  const sprites = entries.map((e) => {
    const s = performance.now();
    let p = getProp(e.id, { variant: e.variant, frame: e.frame, scale, ...cam });
    if (e.part && p.part) p = { ...p, canvas: p.part.canvas, glow: p.part.glow };
    times.push([e.id + ':' + e.variant + ':' + e.frame, Math.round(performance.now() - s), p.ms]);
    return { ...e, p };
  });
  const total = performance.now() - t0;

  // Shelf layout: rows share a ground line; labels go under the lowest pixel of the row.
  const margin = 10, gap = 14, labelH = 10, top = 24;
  const rows = [];
  let row = null, x = margin;
  for (const s of sprites) {
    const w = Math.max(s.p.w, 56);
    if (!row || (x + w > W - margin && x > margin)) { row = { items: [], up: 0, down: 0 }; rows.push(row); x = margin; }
    row.items.push({ s, x, w });
    row.up = Math.max(row.up, s.p.oy);
    row.down = Math.max(row.down, s.p.h - s.p.oy);
    x += w + gap;
  }
  let y = top;
  for (const r of rows) { r.base = y + r.up; y = r.base + r.down + labelH + gap; }
  const H = Math.max(540, y + 4);
  cv.width = W; cv.height = H;
  cv.style.width = W * zoom + 'px'; cv.style.height = H * zoom + 'px';
  document.body.style.overflow = 'auto';
  const g = ctxOf(cv);
  const bgTop = dark ? '#0b0f24' : '#2f8a9c', bgBot = dark ? '#05060f' : '#1d5f78';
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, bgTop); grd.addColorStop(1, bgBot);
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  drawText(g, params.has('frames') ? 'ANIMATION FRAMES' : only ? 'PROPS' : all ? 'ALL PROPS' : PAGES[page % PAGES.length].title + `  (page ${page % PAGES.length + 1}/${PAGES.length})`, 10, 7, { font: 'normal', color: '#ffffff', shadow: '#0b1622' });
  drawText(g, `${sprites.length} sprites, ${Math.round(total)} ms`, W - 10, 7, { font: 'small', align: 'right', color: '#cfe', shadow: '#0b1622' });

  for (const r of rows) {
    for (const pl of r.items) {
      const { p } = pl.s;
      const cx = pl.x + Math.floor(pl.w / 2);
      const base = r.base;
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath();
      g.ellipse(cx, base, Math.max(8, p.w * 0.36), 3, 0, 0, Math.PI * 2);
      g.fill();
      const dx = cx - p.ox, dy = base - p.oy;
      g.drawImage(p.canvas, dx, dy);
      if (p.front && p.anchors && p.anchors.keeper) {
        // Stand-in shopkeeper between the stall and its counter layer.
        const k = p.anchors.keeper;
        g.fillStyle = '#e8503a';
        g.beginPath(); g.ellipse(dx + k.x, dy + k.y - 14, 14, 11, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.fillRect(dx + k.x - 6, dy + k.y - 30, 4, 5); g.fillRect(dx + k.x + 3, dy + k.y - 30, 4, 5);
        g.drawImage(p.front, dx, dy);
      }
      if (p.glow) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = dark ? 0.6 : 0.35;
        g.drawImage(p.glow, dx, dy);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
      if (params.has('debug')) {
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.strokeRect(dx + 0.5, dy + 0.5, p.w - 1, p.h - 1);
        g.fillStyle = '#ff0';
        g.fillRect(cx - 2, base, 5, 1);
        for (const sc of p.screens) { g.strokeStyle = '#f0f'; g.strokeRect(dx + sc.x + 0.5, dy + sc.y + 0.5, sc.w - 1, sc.h - 1); }
        for (const a of Object.values(p.anchors || {})) { g.fillStyle = '#0f0'; g.fillRect(dx + a.x - 1, dy + a.y - 1, 3, 3); }
        for (const l of p.lights) { g.strokeStyle = l.color; g.beginPath(); g.arc(dx + l.x, dy + l.y, l.r, 0, Math.PI * 2); g.stroke(); }
      }
      drawText(g, pl.s.label, cx, base + r.down + 3, { font: 'small', align: 'center', color: '#ffffff', shadow: '#0b1622' });
    }
  }
  window.__propTimes = times;
  window.__propsReady = true;
}
