// Skill board: a dark sea-glass panel with one horizontal track per branch. Each track is a chain of
// brass porthole tiles (pearl gem on top, cost plate below) joined by kelp-rope bars; requirements that
// skip tiles or cross tracks are drawn as thin orthogonal circuit wires. Locked tiles are chained and
// padlocked (the chains fall off when they become available). Click an affordable tile to grow it.
// open({highlight: id}) pulses a tile (tutorial). Scrolls vertically when the tracks do not fit.

import { clamp, clamp01, lerp, ease, bayer, TAU, formatCommas } from '../core/math.js';
import { ramp, shade, mix, rgba, pack, adjust } from '../core/color.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { tinted } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SKILLS, SKILL_BY_ID, BRANCHES, skillStatus } from '../game/skills.js';

const ROWS = ['line', 'hook', 'exp', 'bait', 'mouse', 'reel', 'tank', 'breed'];
const TILE = 32;
const BRASS = ['#3e2210', '#7a4a1c', '#b8782a', '#e0a844', '#f6d27a', '#fff2b8'];
const TARNISH = BRASS.map((c, i) => mix(c, ['#14141c', '#2a2a36', '#44444f', '#5c5c66', '#74747c', '#8c8c92'][i], 0.62));
const GUTTER = 78;
const vivid = (hex) => adjust(hex, { sMul: 1.2, lMul: 0.95 });

// ---------------------------------------------------------------- layout from the requirement graph

function buildLayout() {
  const desc = {};
  const kids = {};
  for (const s of SKILLS) for (const r of s.req) (kids[r] ||= []).push(s.id);
  const countDesc = (id) => desc[id] ?? (desc[id] = (kids[id] || []).reduce((a, k) => a + 1 + countDesc(k), 0));
  const depth = {};
  const dep = (id) => depth[id] ?? (depth[id] = SKILL_BY_ID[id].req.length ? 1 + Math.max(...SKILL_BY_ID[id].req.map(dep)) : 0);
  SKILLS.forEach((s) => { countDesc(s.id); dep(s.id); });
  // order each track: keep requirement chains adjacent, leaves right after their parent (short skips)
  const rows = ROWS.map((b) => {
    const left = SKILLS.filter((s) => s.branch === b);
    const order = [];
    const placed = new Set();
    while (left.length) {
      const ready = left.filter((s) => s.req.every((r) => placed.has(r) || SKILL_BY_ID[r].branch !== b));
      const last = order[order.length - 1];
      const recency = (s) => Math.max(-1, ...s.req.filter((r) => SKILL_BY_ID[r].branch === b).map((r) => order.findIndex((q) => q.id === r)));
      ready.sort((p, q) => {
        const pa = last && p.req.includes(last.id) ? 0 : 1, qa = last && q.req.includes(last.id) ? 0 : 1;
        if (pa !== qa) return pa - qa;
        if (!pa) return desc[p.id] - desc[q.id];
        return recency(q) - recency(p) || depth[p.id] - depth[q.id] || p.pos[1] - q.pos[1] || p.pos[0] - q.pos[0];
      });
      const s = ready[0] || left[0];
      order.push(s);
      placed.add(s.id);
      left.splice(left.indexOf(s), 1);
    }
    return { branch: b, tiles: order };
  });
  const col = {}, rowOf = {};
  rows.forEach((r, ri) => r.tiles.forEach((s) => { col[s.id] = 0; rowOf[s.id] = ri; }));
  for (let it = 0; it < 40; it++) {
    for (const r of rows) {
      r.tiles.forEach((s, i) => {
        let c = 0;
        for (const q of s.req) c = Math.max(c, col[q] + 1);
        if (i) c = Math.max(c, col[r.tiles[i - 1].id] + 1);
        col[s.id] = c;
      });
    }
  }
  const nCols = Math.max(...Object.values(col)) + 1;
  // links: adjacent in-track -> rope bar; skipping in-track -> wire arc above; cross-track -> elbow wire
  const links = [];
  for (const s of SKILLS) {
    for (const q of s.req) {
      const a = rowOf[q], b = rowOf[s.id];
      const row = rows[b].tiles;
      const i = row.indexOf(s);
      if (a === b) links.push({ from: q, to: s.id, kind: i > 0 && row[i - 1].id === q ? 'bar' : 'arc' });
      else links.push({ from: q, to: s.id, kind: 'elbow', first: i === 0 });
    }
  }
  // arcs over the same track that overlap get stacked into lanes
  rows.forEach((r, ri) => {
    const arcs = links.filter((l) => l.kind === 'arc' && rowOf[l.to] === ri).sort((p, q) => (col[p.to] - col[p.from]) - (col[q.to] - col[q.from]));
    const used = [];
    for (const l of arcs) {
      let lane = 0;
      while (used.some((u) => u.lane === lane && !(col[u.to] < col[l.from] || col[u.from] > col[l.to]))) lane++;
      l.lane = lane;
      used.push(l);
    }
  });
  return { rows, col, rowOf, nCols, links };
}
const LAYOUT = buildLayout();

// ---------------------------------------------------------------- sprites

const cache = new Map();
function memo(key, build) {
  let c = cache.get(key);
  if (!c) cache.set(key, (c = build()));
  return c;
}

// Brass porthole tile (TILE x TILE+3: the top rows hold the pearl setting).
function tileSprite(status, color) {
  return memo(`tile|${status}|${color}`, () => {
    const S = TILE, top = 3;
    const b = new PixelBuffer(S, S + top);
    const B = (status === 'locked' ? TARNISH : BRASS).map((c) => pack(c));
    const base = status === 'owned' ? vivid(color) : status === 'ready' ? mix(color, '#123a4a', 0.42) : status === 'poor' ? mix(color, '#0c1c28', 0.74) : '#121a24';
    const IR = ramp(base, status === 'owned' ? 1 : 0.7).map((c) => pack(c));
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const cx = Math.min(x, S - 1 - x), cy = Math.min(y, S - 1 - y);
        if (cx + cy < 2) continue; // rounded corner
        const d = Math.min(cx, cy);
        let c;
        if (d === 0 || cx + cy === 2) c = B[0];
        else if (d === 1) c = (y < S / 2 && cy === 1) || (x < S / 2 && cx === 1) ? B[5] : B[2];
        else if (d === 2) c = (y < S / 2 && cy === 2) || (x < S / 2 && cx === 2) ? B[4] : B[3];
        else if (d === 3) c = B[1];
        else {
          // inner window: lit from the top-left, dithered
          const ix = x - 4, iy = y - 4, n = S - 8;
          let v = 2.2 - ((ix + iy) / n) * 1.3 + (bayer(x, y) - 0.5) * 0.6;
          const r = Math.hypot(ix - n * 0.35, iy - n * 0.3) / n;
          v += (0.5 - r) * 1.2;
          if (iy === 0 || ix === 0) v = 0.4;
          if (iy === n - 1 || ix === n - 1) v += 0.8;
          c = IR[clamp(Math.floor(v), 0, 4)];
        }
        b.set(x, y + top, c);
      }
    }
    // engraved notches + rivets
    for (const m of [S / 2 - 1, S / 2]) { b.set(m, top + S - 3, B[1]); b.set(2, top + m, B[1]); b.set(S - 3, top + m, B[1]); }
    for (const [rx, ry] of [[2, 2], [S - 3, 2], [2, S - 3], [S - 3, S - 3]]) { b.set(rx, top + ry, B[5]); b.set(rx + 1, top + ry + 1, B[0]); }
    // pearl in a brass claw setting
    const m = S / 2;
    for (let x = m - 4; x < m + 4; x++) b.set(x, top, B[x < m ? 4 : 2]);
    b.set(m - 4, top - 1, B[3]); b.set(m + 3, top - 1, B[2]);
    const pearl = status === 'owned' ? ['#c8b8d8', '#f4eef8', '#ffffff'] : status === 'ready' ? [shade(color, -0.2), shade(color, 0.35), '#ffffff'] : status === 'poor' ? ['#6a6a7a', '#9a9aa8', '#c8c8d4'] : ['#2a2a34', '#3a3a46', '#4a4a56'];
    for (let y = -3; y <= 1; y++) for (let x = -3; x <= 2; x++) {
      const dx = x + 0.5, dy = y + 1;
      if (dx * dx + dy * dy > 7) continue;
      b.set(m + x, top - 1 + y, pack(dx + dy < -1.5 ? pearl[2] : dx + dy < 1 ? pearl[1] : pearl[0]));
    }
    b.outline(() => pack('#0a0e16'));
    return b.toCanvas();
  });
}

function compassWatermark(w, h) {
  return memo(`wm|${w}|${h}`, () => {
    const b = new PixelBuffer(w, h);
    const R = Math.floor(Math.min(w, h) * 0.46), cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const c1 = pack('#4ab0c8', 34), c2 = pack('#4ab0c8', 18), c3 = pack('#8ae0f0', 30);
    for (let a = 0; a < TAU; a += 0.6 / R) {
      for (const rr of [R, R - 3, R * 0.62]) b.set(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), c1);
    }
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * TAU, l = k % 9 === 0 ? 8 : 4;
      for (let i = 0; i < l; i++) b.set(Math.round(cx + Math.cos(a) * (R - 4 - i)), Math.round(cy + Math.sin(a) * (R - 4 - i)), c1);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU - Math.PI / 2, len = k % 2 ? R * 0.55 : R * 0.95, wid = k % 2 ? R * 0.07 : R * 0.11;
      const tip = [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
      const l1 = [cx + Math.cos(a + Math.PI / 2) * wid, cy + Math.sin(a + Math.PI / 2) * wid];
      const l2 = [cx + Math.cos(a - Math.PI / 2) * wid, cy + Math.sin(a - Math.PI / 2) * wid];
      b.fillPoly([[cx, cy], l1, tip], k % 2 ? c2 : c1);
      b.fillPoly([[cx, cy], tip, l2], c2);
    }
    // anchor in the middle
    const s = R * 0.3;
    b.fillCircle(cx, cy - s * 0.95, s * 0.16, c3);
    b.fillCircle(cx, cy - s * 0.95, s * 0.08, 0);
    b.rect(Math.round(cx - 1), Math.round(cy - s * 0.8), 3, Math.round(s * 1.65), c3);
    b.rect(Math.round(cx - s * 0.45), Math.round(cy - s * 0.5), Math.round(s * 0.9), 2, c3);
    for (let a = 0.15; a < Math.PI - 0.15; a += 0.02) b.set(Math.round(cx + Math.cos(a) * s * 0.75), Math.round(cy + s * 0.15 + Math.sin(a) * s * 0.7), c3);
    for (const sx of [-1, 1]) b.fillPoly([[cx + sx * s * 0.75, cy + s * 0.15], [cx + sx * s * 0.95, cy + s * 0.05], [cx + sx * s * 0.8, cy + s * 0.35]], c3);
    return b.toCanvas();
  });
}

function glassBody(w, h) {
  return memo(`glass|${w}|${h}`, () => {
    const b = new PixelBuffer(w, h);
    const top = [0x12, 0x3c, 0x4a], bot = [0x07, 0x14, 0x1e];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = clamp01(y / h + (bayer(x, y) - 0.5) * 0.05 + Math.sin(x * 0.02) * 0.02);
      const q = Math.floor(k * 12) / 12;
      b.set(x, y, (255 << 24) | (Math.round(lerp(top[2], bot[2], q)) << 16) | (Math.round(lerp(top[1], bot[1], q)) << 8) | Math.round(lerp(top[0], bot[0], q)));
    }
    return b.toCanvas();
  });
}

function medallion() {
  return memo('medal', () => {
    const R = 19, D = R * 2 + 2;
    const b = new PixelBuffer(D, D);
    const B = BRASS.map((c) => pack(c));
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
      const dx = x + 0.5 - D / 2, dy = y + 0.5 - D / 2, d = Math.hypot(dx, dy);
      if (d > R) continue;
      if (d > R - 5) {
        const l = (-dx - dy) / R;
        const v = d > R - 1 ? 0 : d < R - 4 ? 1 : 2.6 + l * 1.6 + (bayer(x, y) - 0.5) * 0.5;
        b.set(x, y, B[clamp(Math.floor(v), 0, 5)]);
      } else {
        const v = clamp01(0.5 + (dx + dy) / (R * 3));
        b.set(x, y, pack(mix('#2a8aa8', '#0a2a40', v)));
        if (dx + dy < -R * 0.6 && dx + dy > -R * 0.9) b.set(x, y, pack('#8ae0f0', 120));
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.39;
      const x = Math.round(D / 2 + Math.cos(a) * (R - 2.5)), y = Math.round(D / 2 + Math.sin(a) * (R - 2.5));
      b.set(x, y, B[5]); b.set(x + 1, y + 1, B[0]);
    }
    b.outline(() => pack('#0a0e16'));
    return b.toCanvas();
  });
}

// ---------------------------------------------------------------- panel

export class SkillTreePanel {
  constructor() {
    this.id = 'skills';
    this.modal = true;
    this.sound = 'ui_open';
    this.t = 0;
    this.fx = {};
    this.scroll = 0;
    this.falling = [];
  }

  open(data) {
    this.t = 0;
    this.fx = {};
    this.highlight = data?.highlight || null;
    this.sel = this.highlight || null;
    this.hoverId = null;
    this.prevStatus = null;
    this.scrollTo = this.highlight;
    this.drag = null;
    this.falling = [];
  }

  close() { this.drag = null; }

  status(sk) {
    const st = this.game.state;
    if (st.skills[sk.id]) return 'owned';
    if (skillStatus(sk, st, this.found).status === 'available') return st.coins >= sk.cost ? 'ready' : 'poor';
    return 'locked';
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    dt = Math.max(0, dt);
    this.t += dt;
    const t = this.t;
    this.found = g.speciesFound();
    const W = Math.min(g.screen.W - 12, 820), H = Math.min(g.screen.H - 12, 500);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2), w: W, h: H };
    this.rect = r;
    const HEAD = 34, FOOT = 46;
    const body = { x: r.x + 8, y: r.y + HEAD, w: W - 16, h: H - HEAD - FOOT };

    drawWood(ctx, r.x, r.y, W, H, { tone: 'dark' });
    this.drawHeader(ctx, ui, r, HEAD);

    // ------------------------------------------------ geometry
    const L = LAYOUT;
    const pitch = clamp(Math.floor((body.h - 8) / ROWS.length), 50, 66);
    const contentH = pitch * ROWS.length + 8;
    const maxScroll = Math.max(0, contentH - body.h);
    const colW = (body.w - GUTTER - 10) / L.nCols;
    const tx = (id) => Math.round(body.x + GUTTER + (L.col[id] + 0.5) * colW);
    if (this.scrollTo) {
      const ri = L.rowOf[this.scrollTo];
      if (ri !== undefined) this.scroll = clamp(4 + ri * pitch + pitch / 2 - body.h / 2, 0, maxScroll);
      this.scrollTo = null;
    }
    this.scroll = clamp(this.scroll, 0, maxScroll);
    const ry = (ri) => Math.round(body.y + 6 + ri * pitch + pitch / 2 - this.scroll);
    const ty = (id) => ry(L.rowOf[id]);

    // status changes -> chains fall off
    const status = {};
    for (const s of SKILLS) status[s.id] = this.status(s);
    if (this.prevStatus) {
      for (const s of SKILLS) if (this.prevStatus[s.id] === 'locked' && status[s.id] !== 'locked') this.unchain(s, tx(s.id), ty(s.id));
    }
    this.prevStatus = status;

    // ------------------------------------------------ body: sea glass + watermark
    ctx.save();
    ctx.beginPath(); ctx.rect(body.x, body.y, body.w, body.h); ctx.clip();
    ctx.drawImage(glassBody(body.w, body.h), body.x, body.y);
    const wm = compassWatermark(Math.min(body.w, 400), Math.min(body.h, 400));
    ctx.drawImage(wm, Math.round(body.x + body.w / 2 - wm.width / 2 + 30), Math.round(body.y + body.h / 2 - wm.height / 2));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x0 = body.x + ((i * 173 + t * 7) % (body.w + 200)) - 100;
      ctx.fillStyle = rgba('#8ae0f0', 0.025);
      ctx.beginPath(); ctx.moveTo(x0, body.y); ctx.lineTo(x0 + 30, body.y); ctx.lineTo(x0 - 70, body.y + body.h); ctx.lineTo(x0 - 100, body.y + body.h); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // hover
    let hov = null;
    if (ui.hover(body) && !this.drag?.moved) {
      for (const s of SKILLS) {
        const x = tx(s.id), y = ty(s.id);
        if (Math.abs(inp.x - x) <= TILE / 2 + 1 && inp.y >= y - TILE / 2 - 3 && inp.y <= y + TILE / 2 + 4) hov = s;
      }
    }
    if ((hov?.id || null) !== this.hoverId) {
      this.hoverId = hov?.id || null;
      if (hov) g.audio.play('ui_hover', { vol: 0.3, pitch: 0.9 + L.col[hov.id] * 0.04 });
    }

    // ------------------------------------------------ track labels on their underlines
    L.rows.forEach((row, ri) => {
      const y = ry(ri);
      if (y < body.y - pitch || y > body.y + body.h + pitch) return;
      const B = BRANCHES[row.branch];
      const fx = tx(row.tiles[0].id) - TILE / 2 - 2;
      const got = row.tiles.filter((s) => st.skills[s.id]).length;
      const lh = ui.hover({ x: body.x + 4, y: y - 16, w: GUTTER - 6, h: 24 });
      ctx.fillStyle = rgba(B.color, lh ? 0.9 : 0.55);
      ctx.fillRect(body.x + 6, y, fx - body.x - 6, 1);
      ctx.fillStyle = rgba('#000000', 0.5);
      ctx.fillRect(body.x + 7, y + 1, fx - body.x - 7, 1);
      drawText(ctx, B.name.toUpperCase(), body.x + 8, y - 9, { font: 'small', color: lh ? '#ffffff' : shade(B.color, 0.35), shadow: '#05080c' });
      drawText(ctx, `${got}/${row.tiles.length}`, body.x + 8, y + 5, { font: 'small', color: got === row.tiles.length ? '#ffe27a' : '#5a8a9a' });
      if (lh) ui.tip = `${B.name}: ${got}/${row.tiles.length} grown`;
    });

    // ------------------------------------------------ links
    const half = TILE / 2;
    for (const l of L.links) {
      const lit = st.skills[l.from] && st.skills[l.to] ? 2 : st.skills[l.from] ? 1 : 0;
      const x0 = tx(l.from), y0 = ty(l.from), x1 = tx(l.to), y1 = ty(l.to);
      if (l.kind === 'bar') this.rope(ctx, x0 + half + 1, x1 - half - 1, y0, lit, t);
      else if (l.kind === 'arc') {
        const ay = y0 - half - 9 - l.lane * 4;
        this.wire(ctx, [[x0 + 6, y0 - half - 4], [x0 + 6, ay], [x1 - 6, ay], [x1 - 6, y1 - half - 4]], lit, t);
      } else {
        const down = y1 > y0;
        if (l.first) {
          // down/up out of the requirement, then along the target track's underline into its left side
          const vx = x0 + (down ? 6 : -6);
          this.wire(ctx, [[vx, y0 + (down ? half + 6 : -half - 4)], [vx, y1], [x1 - half - 2, y1]], lit, t);
        } else {
          const cy = down ? y1 - half - 13 : y1 + half + 13;
          this.wire(ctx, [[x0 + 8, y0 + (down ? half + 6 : -half - 4)], [x0 + 8, cy], [x1 + 8, cy], [x1 + 8, y1 + (down ? -half - 4 : half + 6)]], lit, t);
        }
      }
    }

    // ------------------------------------------------ tiles
    for (const s of SKILLS) {
      const x = tx(s.id), y = ty(s.id);
      if (y < body.y - 30 || y > body.y + body.h + 30) continue;
      this.drawTile(ctx, s, status[s.id], x, y, hov === s, t, dt);
    }
    this.drawFalling(ctx, dt);
    // tutorial highlight
    if (this.highlight && !st.skills[this.highlight] && SKILL_BY_ID[this.highlight]) {
      const x = tx(this.highlight), y = ty(this.highlight);
      const p = (t * 1.4) % 1;
      const e = Math.round(3 + p * 10);
      ctx.fillStyle = rgba('#ffe27a', 1 - p);
      ctx.fillRect(x - half - e, y - half - e, TILE + e * 2, 1); ctx.fillRect(x - half - e, y + half + e, TILE + e * 2, 1);
      ctx.fillRect(x - half - e, y - half - e, 1, TILE + e * 2); ctx.fillRect(x + half + e, y - half - e, 1, TILE + e * 2 + 1);
      const bob = Math.round(-Math.abs(Math.sin(t * 5)) * 4);
      const ar = getUiIcon('arrow_d');
      ctx.drawImage(ar, Math.round(x - ar.width / 2), y - half - 22 + bob);
      drawText(ctx, 'Click!', x + 9, y - half - 19 + bob, { color: '#ffe27a', outline: '#1a0e06' });
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba('#bfefff', 0.045);
    ctx.beginPath(); ctx.moveTo(body.x + 40, body.y); ctx.lineTo(body.x + 100, body.y); ctx.lineTo(body.x, body.y + 100); ctx.lineTo(body.x, body.y + 40); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    // glass border + scrollbar
    ctx.fillStyle = '#05080c';
    ctx.fillRect(body.x - 1, body.y - 1, body.w + 2, 1); ctx.fillRect(body.x - 1, body.y + body.h, body.w + 2, 1);
    ctx.fillRect(body.x - 1, body.y, 1, body.h); ctx.fillRect(body.x + body.w, body.y, 1, body.h);
    ctx.fillStyle = rgba('#8ae0f0', 0.25);
    ctx.fillRect(body.x, body.y, body.w, 1);
    if (maxScroll > 0) {
      const sh = Math.max(20, Math.round((body.h * body.h) / contentH));
      const sy = Math.round(body.y + (body.h - sh) * (this.scroll / maxScroll));
      ctx.fillStyle = rgba('#000000', 0.4);
      ctx.fillRect(body.x + body.w - 5, body.y + 2, 3, body.h - 4);
      ctx.fillStyle = BRASS[3];
      ctx.fillRect(body.x + body.w - 5, sy, 3, sh);
      ctx.fillStyle = BRASS[5];
      ctx.fillRect(body.x + body.w - 5, sy, 1, sh);
    }

    // ------------------------------------------------ input
    if (hov && inp.pressed) {
      inp.pressed = false;
      this.sel = hov.id;
      this.tryGrow(hov, tx(hov.id), ty(hov.id), status[hov.id]);
    } else if (ui.hover(body) && inp.pressed) {
      inp.pressed = false;
      this.drag = { y: inp.y, s: this.scroll, moved: false };
    }
    if (this.drag) {
      if (!inp.down) this.drag = null;
      else {
        if (Math.abs(inp.y - this.drag.y) > 2) this.drag.moved = true;
        this.scroll = this.drag.s - (inp.y - this.drag.y);
      }
    }
    if (inp.wheel && ui.hover(r)) this.scroll += inp.wheel * 24;

    this.drawFooter(ctx, ui, r, FOOT, status, tx, ty);
    if (hov) this.drawCard(ctx, hov, status[hov.id], tx(hov.id), ty(hov.id), r);
  }

  tryGrow(sk, x, y, status) {
    const g = this.game;
    if (status === 'owned') {
      this.fx[sk.id] = { kind: 'wiggle', t: 0 };
      g.audio.play('bubble', { vol: 0.5, pitch: 1.3 });
      return false;
    }
    if (g.unlockSkill(sk.id)) {
      this.fx[sk.id] = { kind: 'bloom', t: 0 };
      if (this.highlight === sk.id) this.highlight = null;
      const col = vivid(BRANCHES[sk.branch].color);
      const P = g.particles;
      P.burst(x, y, 30, { colors: [col, shade(col, 0.5), '#ffffff', '#fff6b0'], speed: 110, speedMin: 30, g: 30, drag: 2.5, layer: 'ui', add: true, life: 1 });
      for (let i = 0; i < 12; i++) P.sparkle(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 34, i % 2 ? '#fff6b0' : shade(col, 0.6), { layer: 'ui', life: 0.9 });
      P.bubbles(x, y, 8, { layer: 'ui' });
      P.text(x, y - 26, sk.name + '!', { color: shade(col, 0.6), outline: '#0a0e16', layer: 'ui', vy: -14, life: 1.5 });
      g.audio.play('magic', { vol: 0.5 });
      g.audio.play('sparkle', { vol: 0.5 });
      return true;
    }
    this.fx[sk.id] = { kind: 'shake', t: 0 };
    return false;
  }

  unchain(sk, x, y) {
    const g = this.game;
    this.fx[sk.id] = { kind: 'unchain', t: 0 };
    this.falling.push({ x: x - 5, y: y + 3, vx: (Math.random() - 0.5) * 30, vy: -40, t: 0 });
    g.audio.play('click', { vol: 0.5, pitch: 1.4 });
    setTimeout(() => g.audio.play('coin_bounce', { vol: 0.35, pitch: 0.7 }), 260);
  }

  drawFalling(ctx, dt) {
    const lk = getUiIcon('lock');
    for (const f of this.falling) {
      f.t += dt;
      f.vy += 260 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      ctx.globalAlpha = clamp01(1 - f.t / 0.9);
      ctx.drawImage(lk, Math.round(f.x), Math.round(f.y));
    }
    ctx.globalAlpha = 1;
    this.falling = this.falling.filter((f) => f.t < 0.9);
  }

  // kelp-rope bar between neighbouring tiles
  rope(ctx, x0, x1, y, lit, t) {
    if (x1 <= x0) return;
    const C = lit === 2 ? ['#12280e', '#4a8a3a', '#8ad05a', '#d8f48a'] : lit === 1 ? ['#0e2018', '#2e5a3a', '#4a8a5a', '#7ab88a'] : ['#070c10', '#1a262c', '#2a3840', '#3a4a54'];
    ctx.fillStyle = C[0];
    ctx.fillRect(x0, y - 2, x1 - x0, 5);
    for (let x = x0; x < x1; x++) {
      const ph = (x + (lit === 2 ? Math.floor(t * 6) : 0)) % 4;
      ctx.fillStyle = ph < 2 ? C[2] : C[1];
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillStyle = C[3];
      if (ph === 0) ctx.fillRect(x, y - 1, 1, 1);
      if (ph === 2) ctx.fillRect(x, y + 1, 1, 1);
    }
    if (lit === 2) {
      for (let x = x0 + 3; x < x1 - 2; x += 7) { ctx.fillStyle = C[2]; ctx.fillRect(x, y - 3 - Math.round(Math.sin(t * 2 + x) * 0.6), 2, 1); }
    }
  }

  // thin orthogonal circuit wire with a travelling glint when powered
  wire(ctx, pts, lit, t) {
    const col = lit === 2 ? '#ffd25a' : lit === 1 ? '#7ad8e8' : '#24414e';
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.abs(bx - ax) + Math.abs(by - ay);
      segs.push({ ax, ay, bx, by, len, at: total });
      total += len;
    }
    for (const s of segs) {
      const x = Math.min(s.ax, s.bx), y = Math.min(s.ay, s.by), w = Math.abs(s.bx - s.ax) + 1, h = Math.abs(s.by - s.ay) + 1;
      ctx.fillStyle = '#04070a';
      ctx.fillRect(x + 1, y + 1, w, h);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = lit ? shade(col, 0.4) : '#2e5262';
    for (let i = 1; i < pts.length - 1; i++) ctx.fillRect(pts[i][0] - 1, pts[i][1] - 1, 3, 3);
    // terminal: small rivet where the wire meets a tile
    const [ex, ey] = pts[pts.length - 1];
    ctx.fillRect(ex - 1, ey - 1, 3, 3);
    if (lit && total > 0) {
      const d = ((t * 60) % (total + 30)) - 15;
      for (const s of segs) {
        if (d < s.at || d > s.at + s.len) continue;
        const k = (d - s.at) / Math.max(1, s.len);
        const x = Math.round(lerp(s.ax, s.bx, k)), y = Math.round(lerp(s.ay, s.by, k));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#ffffff', 0.9);
        ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  drawTile(ctx, sk, status, x, y, hover, t, dt) {
    const B = BRANCHES[sk.branch];
    const fx = this.fx[sk.id];
    let sc = 1, dx = 0, flash = 0;
    if (fx) {
      fx.t += dt;
      if (fx.kind === 'bloom') { sc = 1 + 0.35 * (1 - ease.outElastic(clamp01(fx.t / 0.7))); flash = clamp01(1 - fx.t / 0.45); if (fx.t > 1.2) delete this.fx[sk.id]; }
      else if (fx.kind === 'shake') { dx = Math.round(Math.sin(fx.t * 55) * 2 * (1 - fx.t / 0.35)); if (fx.t > 0.35) delete this.fx[sk.id]; }
      else if (fx.kind === 'wiggle') { sc = 1 + Math.sin(fx.t * 25) * 0.06 * (1 - fx.t / 0.4); if (fx.t > 0.4) delete this.fx[sk.id]; }
      else if (fx.kind === 'unchain' && fx.t > 0.7) delete this.fx[sk.id];
    }
    const lift = hover ? 1 : 0;
    const x0 = Math.round(x - TILE / 2 + dx), y0 = Math.round(y - TILE / 2 - lift);
    if (status === 'ready') {
      const p = 0.5 + 0.5 * Math.sin(t * 4 + x * 0.05);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 3; i >= 1; i--) {
        ctx.fillStyle = rgba(B.color, ((0.05 + 0.07 * p) * (4 - i)) / 3);
        ctx.fillRect(x0 - i * 2, y0 - i * 2, TILE + i * 4, TILE + i * 4);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const spr = tileSprite(status, sk.id === 'hook1' ? '#f2866e' : B.color);
    if (sc !== 1) {
      const w = Math.round(spr.width * sc), h = Math.round(spr.height * sc);
      ctx.drawImage(spr, Math.round(x - w / 2 + dx), Math.round(y - lift - (TILE / 2) * sc - 3 * sc), w, h);
    } else ctx.drawImage(spr, x0, y0 - 3);
    // icon (2x)
    const ic = getUiIcon(sk.icon || 'star');
    const iw = Math.round(ic.width * 2 * sc), ih = Math.round(ic.height * 2 * sc);
    const ix = Math.round(x - iw / 2 + dx), iy = Math.round(y - ih / 2 - lift);
    if (status === 'locked') ctx.drawImage(tinted(ic, '#2c3a48'), ix, iy, iw, ih);
    else {
      if (status === 'poor') ctx.globalAlpha = 0.7;
      ctx.drawImage(ic, ix, iy, iw, ih);
      ctx.globalAlpha = 1;
    }
    if (status === 'ready' || status === 'owned') {
      const p = (t * 0.7 + x * 0.013) % 3;
      if (p < 0.25) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y0 - 5, 1, 1); ctx.fillRect(x - 3, y0 - 4, 3, 1); }
    }
    if (flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ffffff', flash * 0.9);
      ctx.fillRect(x0, y0, TILE, TILE);
      const e = Math.round((1 - flash) * 14);
      ctx.fillStyle = rgba(shade(B.color, 0.5), flash);
      ctx.fillRect(x0 - e, y0 - e, TILE + e * 2, 1); ctx.fillRect(x0 - e, y0 + TILE + e, TILE + e * 2, 1);
      ctx.fillRect(x0 - e, y0 - e, 1, TILE + e * 2); ctx.fillRect(x0 + TILE + e, y0 - e, 1, TILE + e * 2 + 1);
      ctx.globalCompositeOperation = 'source-over';
    }
    // chains + padlock (they slide apart when the tile unlocks)
    const un = fx?.kind === 'unchain' ? clamp01(fx.t / 0.6) : status === 'locked' ? 0 : 1;
    if (un < 1) {
      ctx.globalAlpha = 1 - un;
      this.chains(ctx, x0, y0, Math.round(un * 10));
      if (!un) ctx.drawImage(getUiIcon('lock'), x - 5, y + 2);
      ctx.globalAlpha = 1;
    }
    // hover / selection brackets
    if (hover || this.sel === sk.id) {
      ctx.fillStyle = hover ? '#fff2b0' : '#7ad8e8';
      const o = !hover && Math.floor(t * 4) % 2 ? 1 : 0;
      const L = x0 - 3 - o, R = x0 + TILE + 2 + o, T = y0 - 6 - o, Bt = y0 + TILE + 7 + o;
      ctx.fillRect(L, T, 6, 1); ctx.fillRect(L, T, 1, 6);
      ctx.fillRect(R - 5, T, 6, 1); ctx.fillRect(R, T, 1, 6);
      ctx.fillRect(L, Bt, 6, 1); ctx.fillRect(L, Bt - 5, 1, 6);
      ctx.fillRect(R - 5, Bt, 6, 1); ctx.fillRect(R, Bt - 5, 1, 6);
    }
    // cost plate
    const label = status === 'owned' ? '' : sk.cost ? formatCommas(sk.cost) : 'FREE';
    if (label) {
      const w = measureText(label, 'small') + 6;
      const px = Math.round(x - w / 2), py = y0 + TILE - 2;
      ctx.fillStyle = '#05080c';
      ctx.fillRect(px - 1, py, w + 2, 9);
      ctx.fillStyle = status === 'locked' ? '#1a2028' : '#2a1c10';
      ctx.fillRect(px, py + 1, w, 7);
      ctx.fillStyle = status === 'locked' ? '#2a323c' : BRASS[1];
      ctx.fillRect(px, py + 1, w, 1);
      drawText(ctx, label, px + 3, py + 2, { font: 'small', color: status === 'poor' ? '#ff7a6a' : status === 'locked' ? '#5a6a78' : status === 'ready' ? '#b8ffc8' : '#ffe8b8' });
    } else {
      const ck = getUiIcon('check');
      ctx.drawImage(ck, Math.round(x - ck.width / 2), y0 + TILE - 3);
    }
  }

  // two crossed steel chains (twisted links) over a locked tile
  chains(ctx, x0, y0, spread) {
    const steel = ['#0c1016', '#5a6472', '#9aa4b2', '#e4eaf2'];
    for (const dir of [1, -1]) {
      const off = spread * dir;
      for (let i = 0; i < TILE - 7; i++) {
        const px = Math.round(x0 + 3 + (dir > 0 ? i : TILE - 8 - i) - off), py = Math.round(y0 + 3 + i + Math.abs(off));
        const k = i % 5;
        ctx.fillStyle = steel[0];
        ctx.fillRect(px - 1, py - 1, 3, 3);
        if (k === 4) continue;
        ctx.fillStyle = k === 0 ? steel[3] : k === 1 || k === 3 ? steel[2] : steel[1];
        ctx.fillRect(px, py, 1, 1);
        ctx.fillStyle = k === 2 ? steel[0] : steel[1];
        ctx.fillRect(px + dir, py, 1, 1);
      }
    }
  }

  drawHeader(ctx, ui, r, HEAD) {
    const g = this.game;
    ctx.fillStyle = BRASS[1]; ctx.fillRect(r.x + 6, r.y + HEAD - 4, r.w - 12, 2);
    ctx.fillStyle = BRASS[4]; ctx.fillRect(r.x + 6, r.y + HEAD - 4, r.w - 12, 1);
    // medallion
    const md = medallion();
    const mx = r.x - 6, my = r.y - 6;
    ctx.drawImage(md, mx, my);
    const cor = getUiIcon('coral');
    ctx.drawImage(cor, Math.round(mx + md.width / 2 - cor.width), Math.round(my + md.height / 2 - cor.height), cor.width * 2, cor.height * 2);
    // title flanked by brass rules
    const title = 'SKILL TREE';
    const tw = measureText(title, 'normal', 2);
    const cx = Math.round(r.x + r.w / 2);
    drawText(ctx, title, cx, r.y + 9, { align: 'center', scale: 2, color: '#ffe8a8', outline: '#1a0e06' });
    for (const s of [-1, 1]) {
      const fx = Math.round(cx + s * (tw / 2 + 10));
      const x0 = s < 0 ? fx - 60 : fx;
      ctx.fillStyle = BRASS[3]; ctx.fillRect(x0, r.y + 15, 60, 1);
      ctx.fillStyle = BRASS[0]; ctx.fillRect(x0, r.y + 16, 60, 1);
      ctx.fillStyle = BRASS[4];
      ctx.fillRect(fx - 1, r.y + 14, 3, 3);
      ctx.fillRect(s < 0 ? x0 - 3 : x0 + 60, r.y + 15, 3, 1);
      ctx.fillStyle = BRASS[5]; ctx.fillRect(fx - 1, r.y + 14, 1, 1);
    }
    const owned = SKILLS.filter((s) => g.state.skills[s.id]).length;
    drawText(ctx, `${owned}/${SKILLS.length} GROWN`, r.x + 40, r.y + 14, { font: 'small', color: '#c8a878' });
    if (ui.button(ctx, r.x + r.w - 25, r.y + 7, 18, 17, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) ui.close(this.id);
  }

  drawFooter(ctx, ui, r, FOOT, status, tx, ty) {
    const g = this.game, st = g.state;
    const y = r.y + r.h - FOOT + 7;
    // coin box
    const cw = 120;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(r.x + 9, y, cw, 32);
    ctx.fillStyle = BRASS[2];
    ctx.fillRect(r.x + 10, y + 1, cw - 2, 30);
    ctx.fillStyle = BRASS[4];
    ctx.fillRect(r.x + 10, y + 1, cw - 2, 1);
    ctx.drawImage(glassBody(cw - 6, 26), r.x + 12, y + 3);
    ctx.drawImage(getUiIcon('coin_big'), r.x + 17, y + 11);
    drawText(ctx, formatCommas(Math.floor(this.ui?.coinShown ?? st.coins)), r.x + 32, y + 8, { color: '#ffe8a8', shadow: '#05080c' });
    drawText(ctx, 'COINS TO SPEND', r.x + 32, y + 19, { font: 'small', color: '#6aa8b8' });
    // inspected skill strip
    const sk = SKILL_BY_ID[this.hoverId || this.sel] || null;
    const sx = r.x + cw + 16, sw = r.w - cw - 16 - 198;
    drawPaper(ctx, sx, y, sw, 32, {});
    if (sk) {
      const B = BRANCHES[sk.branch];
      ctx.drawImage(getUiIcon(sk.icon), sx + 6, y + 5);
      drawText(ctx, sk.name, sx + 20, y + 5, { color: '#2a1a10' });
      drawText(ctx, B.name.toUpperCase(), sx + 26 + measureText(sk.name), y + 6, { font: 'small', color: shade(B.color, -0.55) });
      let d = sk.desc;
      if (measureText(d) > sw - 26) {
        while (measureText(d + '...') > sw - 26 && d.length > 4) d = d.replace(/\s*\S+$/, '');
        d += '...';
      }
      drawText(ctx, d, sx + 20, y + 18, { color: '#6a5444' });
    } else drawText(ctx, 'Hover a tile to inspect it - click to grow it.', sx + 10, y + 12, { color: '#6a5444' });
    // buttons
    const sel = SKILL_BY_ID[this.sel];
    const bx = r.x + r.w - 192;
    let label = 'Grow', disabled = true, tip = 'Select a skill first';
    if (sel) {
      const s = status[sel.id];
      if (s === 'owned') { label = 'Grown'; tip = 'Already yours!'; }
      else if (s === 'ready') { label = sel.cost ? `Grow ${formatCommas(sel.cost)}{coin}` : 'Grow (free)'; disabled = false; tip = `Grow ${sel.name}`; }
      else if (s === 'poor') { label = `Need ${formatCommas(sel.cost)}{coin}`; tip = `${formatCommas(sel.cost - st.coins)} more coins needed`; }
      else { label = 'Locked'; tip = skillStatus(sel, st, this.found).reason; }
    }
    if (ui.button(ctx, bx, y + 5, 112, 22, label, { style: 'coral', disabled, tip }) && sel) this.tryGrow(sel, tx(sel.id), ty(sel.id), status[sel.id]);
    if (ui.button(ctx, bx + 118, y + 5, 66, 22, 'Close', { style: 'wood' })) ui.close(this.id);
  }

  drawCard(ctx, sk, status, sx, sy, r) {
    const st = this.game.state;
    const B = BRANCHES[sk.branch];
    const w = 172;
    const lines = wrapText(sk.desc, w - 16);
    let statusLine, statusColor, statusIcon;
    if (status === 'owned') { statusLine = 'Grown!'; statusColor = '#2a7a3a'; statusIcon = 'check'; }
    else if (status === 'ready') { statusLine = sk.cost ? `Click to grow: ${formatCommas(sk.cost)}{coin}` : 'Click to grow: free!'; statusColor = '#2a6a4a'; statusIcon = 'plus'; }
    else if (status === 'poor') { statusLine = `Need ${formatCommas(sk.cost)}{coin} (${formatCommas(sk.cost - st.coins)} more)`; statusColor = '#b8382a'; statusIcon = 'coin'; }
    else { statusLine = skillStatus(sk, st, this.found).reason || 'Locked'; statusColor = '#6a5a6a'; statusIcon = 'lock'; }
    const sLines = wrapText(statusLine, w - 30);
    const h = 26 + lines.length * 10 + 6 + sLines.length * 10 + 6;
    let x = sx + TILE / 2 + 9, y = sy - h / 2;
    if (x + w > r.x + r.w - 4) x = sx - TILE / 2 - 9 - w;
    y = clamp(y, r.y + 4, r.y + r.h - h - 4);
    x = Math.round(x); y = Math.round(y);
    drawPaper(ctx, x, y, w, h, { aged: true });
    ctx.fillStyle = rgba('#f4e0a0', 0.85);
    ctx.fillRect(x + w / 2 - 8, y - 3, 16, 6);
    drawText(ctx, B.name.toUpperCase(), x + 8, y + 6, { font: 'small', color: shade(B.color, -0.55) });
    if (status !== 'owned' && sk.cost) drawText(ctx, `${formatCommas(sk.cost)}{coin}`, x + w - 8, y + 4, { align: 'right', color: '#3a2a1a' });
    drawText(ctx, sk.name, x + 8, y + 13, { color: '#2a1a10' });
    lines.forEach((l, i) => drawText(ctx, l, x + 8, y + 26 + i * 10, { color: '#5a4636' }));
    const yy = y + 26 + lines.length * 10 + 4;
    ctx.fillStyle = rgba('#7a5a3c', 0.35);
    ctx.fillRect(x + 8, yy - 2, w - 16, 1);
    ctx.drawImage(getUiIcon(statusIcon), x + 8, yy + 1);
    sLines.forEach((l, i) => drawText(ctx, l, x + 22, yy + 2 + i * 10, { color: statusColor }));
  }
}
