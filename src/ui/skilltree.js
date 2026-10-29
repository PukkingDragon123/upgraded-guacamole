// Skill board: a dark sea-glass board with one horizontal track per branch. Each track is a chain of brass
// porthole tiles (pearl gem on top, cost plate below) joined by kelp-rope bars; requirements that skip tiles
// or cross tracks are thin orthogonal circuit wires. Locked tiles are chained and padlocked.
// The board zooms smoothly around the cursor (wheel, +/-, header buttons; rests on integer zoom levels so the
// pixels stay crisp) and pans (drag, arrow keys, minimap). Zoomed in, tiles grow name / effect plates.
// Hovering a tile lights up its requirement chain and marks what it unlocks next. The side panel shows the
// skill's lore, the exact stat change before -> after (computeStats), cost, a requirements checklist, the
// skills it unlocks and the Grow button. Click selects a tile; click it again (or Grow / Enter) grows it.
// open({highlight: id}) pulses a tile (tutorial: a single click grows the highlighted tile).

import { clamp, clamp01, lerp, damp, ease, bayer, TAU, formatCommas } from '../core/math.js';
import { ramp, shade, mix, rgba, pack, adjust } from '../core/color.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { tinted } from '../core/canvas.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawBar } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SKILLS, SKILL_BY_ID, BRANCHES, skillStatus, computeStats } from '../game/skills.js';
import { BAITS } from '../game/shopdata.js';
import { baitSprite } from '../fishing/baitart.js';

const ROWS = ['line', 'hook', 'exp', 'bait', 'mouse', 'reel', 'tank', 'breed'];
const TILE = 32;
const BRASS = ['#3e2210', '#7a4a1c', '#b8782a', '#e0a844', '#f6d27a', '#fff2b8'];
const TARNISH = BRASS.map((c, i) => mix(c, ['#14141c', '#2a2a36', '#44444f', '#5c5c66', '#74747c', '#8c8c92'][i], 0.62));
// board space (zoom 1): gutter for the track labels, column / row pitch
const GUTTER = 74, PC = 50, PR = 59, TOP = 10;
const SEMANTIC = 1.75; // zoom at which tiles swap their cost plate for a name / effect plate
const vivid = (hex) => adjust(hex, { sMul: 1.2, lMul: 0.95 });
const INK = '#2a1a10', INK2 = '#5a4636', INK3 = '#8a7058', GOOD = '#2a7a3a', BAD = '#b8382a';

// ---------------------------------------------------------------- flavour + stat formatting

const LORE = {
  hook1: 'Filed to a point on a pebble by a very patient crab.',
  hook2: "Once it's in, it's in. Ask any sardine.",
  hook3: 'Blessed by a four-leaf seaweed. Probably.',
  hook5: 'Forged from a recycled paperclip. Unbendable.',
  hook4: 'It twitches a split second before you do.',
  hook6: "Real gold. Mostly. Please don't bite it.",
  hook7: 'A tiny lighthouse on the end of your line.',
  hook8: 'The charm got a promotion and a tiny hat.',
  line1: 'Three strings walk into a braid...',
  line2: "'Boing' is a valid fishing technique.",
  line3: "Fish can't see it. Frankly, neither can you.",
  line4: 'Toothy fish keep filing complaints. Denied.',
  line5: "Rated for whales. Please don't test that.",
  reel1: 'Greased with a single drop of eel butter.',
  reel2: 'Grip tape for fins. Extremely grippy.',
  reel3: "Smooth as a manta's belly.",
  reel4: 'Lets the fish run, then politely says no.',
  reel5: 'Voids the warranty on your arms.',
  mouse1: 'Breathe in. Breathe out. Wiggle less.',
  mouse8: 'Your cursor has its own gravity now.',
  mouse2: 'Tap tap tap: the universal fish doorbell.',
  mouse3: 'A wider net means fewer excuses.',
  mouse4: 'You see the swim before it swims.',
  mouse5: 'Every fish fight is secretly a dance-off.',
  mouse6: 'Your mouse button has been to the gym.',
  mouse9: 'Duck. Weave. Fish.',
  mouse7: 'Time slows down. Your coffee goes cold.',
  bait1: 'More room for snacks. The fish approve.',
  bait2: 'Fourteen worms and a tiny elected mayor.',
  bait8: 'Puddings go absolutely feral for it.',
  bait3: 'Paperwork, but make it shiny.',
  bait4: 'Please back up your desktop first.',
  bait5: 'Practically a walk-in fridge for bait.',
  bait7: 'Smells like victory. And anchovies.',
  bait6: 'Signed in triplicate. One copy got eaten.',
  tank1: 'Fish love a bit of elbow room. Fin room.',
  tank2: 'Breakfast at nine sharp, every day.',
  tank3: 'Slow, steady, and fully unionised.',
  tank4: 'Now with a guest wing and a hot tub.',
  tank5: 'A pinch of bubbles and good vibes.',
  tank6: "He takes a small cut. Don't ask.",
  tank7: 'Basically a swimming pool with ambition.',
  tank8: 'Every current flows toward your wallet.',
  breed1: 'Candlelit kelp dinners for two.',
  breed2: 'Toasty eggs hatch happy.',
  breed3: 'Science! Mostly glitter and hope.',
  breed4: 'Runs in the family. Shines, too.',
  exp1: 'X marks the scrap.',
  exp2: 'Bait that beeps, blinks and buffers.',
  exp5: 'Static... static... rare fish incoming... static.',
  exp6: 'Ping! ...ping! ...PING!',
  exp3: "The map is mostly black. That's the point.",
  exp4: 'What sleeps below likes shiny things.',
};

const BIOME_NAMES = { shallows: 'Sunny Shallows', fjord: 'Frosty Fjord', junkyard: 'Junkyard Reef', metropolis: 'Sunken Metropolis', volcano: 'Lava Rift', abyss: 'The Deep Ocean' };
const pct = (v) => `${Math.round(v * 100)}%`;
const mul = (v) => `x${(Math.round(v * 100) / 100).toFixed(2)}`;
const onoff = (v) => (v ? 'ON' : 'off');
const plus = (v, unit = '') => `+${Math.round(v * 100) / 100}${unit}`;
// key -> [label, value formatter, short effect text]
const STAT = {
  biteWindow: ['Bite window', mul, (v) => `+${Math.round((v - 1) * 100)}% bite window`],
  lineStrength: ['Line strength', pct, (v) => `+${Math.round(v * 100)}% line strength`],
  snapGrace: ['Snap grace', (v) => v.toFixed(2) + 's', (v) => plus(v, 's') + ' snap grace'],
  slackGrace: ['Slack grace', (v) => v.toFixed(1) + 's', (v) => plus(v, 's') + ' slack grace'],
  reelSpeed: ['Reel speed', (v) => String(Math.round(v)), (v) => plus(v) + ' reel speed'],
  staminaDrain: ['Fish tiring', mul, (v) => `+${Math.round((v - 1) * 100)}% fish tiring`],
  traceRadius: ['Trace ring', mul, (v) => `+${Math.round((v - 1) * 100)}% trace ring`],
  traceForgive: ['Trace forgiveness', mul, (v) => `+${Math.round((v - 1) * 100)}% forgiveness`],
  mashPower: ['Click power', mul, (v) => `+${Math.round((v - 1) * 100)}% click power`],
  timingWindow: ['Timing window', mul, (v) => `+${Math.round((v - 1) * 100)}% timing window`],
  timingMisses: ['Allowed misses', String, (v) => plus(v) + ' allowed miss'],
  dodgeHits: ['Dodge hits', String, (v) => plus(v) + ' dodge hit'],
  netTolerance: ['Net tolerance', mul, (v) => `+${Math.round((v - 1) * 100)}% net tolerance`],
  netTime: ['Net time', mul, (v) => `+${Math.round((v - 1) * 100)}% net time`],
  calm: ['Fish calmness', mul, (v) => `+${Math.round((v - 1) * 100)}% fish calm`],
  autoHook: ['Auto-hook chance', pct, (v) => `+${Math.round(v * 100)}% auto-hook`],
  baitRadius: ['Bait reach', mul, (v) => `+${Math.round((v - 1) * 100)}% bait reach`],
  rarityBoost: ['Rarity boost', mul, (v) => `+${Math.round((v - 1) * 100)}% rare fish`],
  mutationChance: ['Mutation chance', pct, (v) => `+${Math.round(v * 100)}% mutations`],
  shinyChance: ['Shiny chance', (v) => `1 in ${Math.round(1 / Math.max(1e-6, v))}`, (v) => `x${v} shiny chance`],
  boxSlots: ['Bait box slots', String, (v) => plus(v) + ' bait slots'],
  tankCap: ['Tank capacity', (v) => `${v} fish`, (v) => plus(v) + ' tank fish'],
  coinMul: ['Coin income', mul, (v) => `+${Math.round((v - 1) * 100)}% coins`],
  collectRadius: ['Coin pickup', (v) => `${v}px`, (v) => plus(v, 'px') + ' coin pickup'],
  focus: ['Focus mode', onoff, () => 'Focus mode'],
  autoCollect: ['Coin helpers', String, (v) => plus(v) + ' coin helper'],
  feeder: ['Auto-feeder', onoff, () => 'Auto-feeder'],
  breeding: ['Breeding', onoff, () => 'Fish breeding'],
  hatchSpeed: ['Hatch speed', mul, (v) => `+${Math.round((v - 1) * 100)}% hatch speed`],
  sonar: ['Rare-fish sonar', onoff, () => 'Rare-fish sonar'],
  lantern: ['Hook light', onoff, () => 'Glowing hook'],
  forecast: ['Weather forecast', onoff, () => 'Weather forecast'],
  offlineMul: ['Away earnings', pct, (v) => `+${Math.round(v * 100)}% away coins`],
};

function shortEffect(sk) {
  const out = [];
  for (const [k, v] of Object.entries(sk.effect)) {
    if (k === 'unlockBait') out.push('Shop: ' + v.map((b) => BAITS[b]?.name || b).join(', '));
    else if (k === 'unlockBiome') out.push('Unlocks ' + (BIOME_NAMES[v] || v));
    else if (STAT[k]) out.push(STAT[k][2](v));
  }
  return out.join(', ');
}

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
  return { rows, col, rowOf, nCols, links, kids };
}
const LAYOUT = buildLayout();
const KIDS = LAYOUT.kids;
const BW = GUTTER + LAYOUT.nCols * PC + 8, BH = TOP + ROWS.length * PR + 8;
const rowY = (ri) => TOP + Math.round((ri + 0.5) * PR);
const BX = (id) => GUTTER + Math.round((LAYOUT.col[id] + 0.5) * PC);
const BY = (id) => rowY(LAYOUT.rowOf[id]);

function ancestors(id, out = new Set()) {
  for (const r of SKILL_BY_ID[id]?.req || []) if (!out.has(r)) { out.add(r); ancestors(r, out); }
  return out;
}

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
    for (const m of [S / 2 - 1, S / 2]) { b.set(m, top + S - 3, B[1]); b.set(2, top + m, B[1]); b.set(S - 3, top + m, B[1]); }
    for (const [rx, ry] of [[2, 2], [S - 3, 2], [2, S - 3], [S - 3, S - 3]]) { b.set(rx, top + ry, B[5]); b.set(rx + 1, top + ry + 1, B[0]); }
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

// brass-rimmed dark glass plate (coin box, zoom readout, minimap)
function brassBox(ctx, x, y, w, h) {
  ctx.fillStyle = '#05080c';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = BRASS[2];
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = BRASS[4];
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillStyle = BRASS[1];
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.drawImage(glassBody(w - 6, h - 6), x + 3, y + 3);
}

// ---------------------------------------------------------------- panel

export class SkillTreePanel {
  constructor() {
    this.id = 'skills';
    this.modal = true;
    this.sound = 'ui_open';
    this.t = 0;
    this.fx = {};
    this.falling = [];
    this.z = null;
    this.zT = 1;
    this.camX = 0;
    this.camY = 0;
    this.wheelAcc = 0;
  }

  open(data) {
    this.t = 0;
    this.fx = {};
    this.highlight = data?.highlight || null;
    this.sel = this.highlight || this.sel || null;
    this.hoverId = null;
    this.prevStatus = null;
    this.drag = null;
    this.mmDrag = false;
    this.falling = [];
    this.z = null; // re-fit the view
    this.anchor = null;
    this.goal = null;
    this.wheelAcc = 0;
    this.chainT = 0;
  }

  close() { this.drag = null; this.mmDrag = false; }

  status(sk) {
    const st = this.game.state;
    if (st.skills[sk.id]) return 'owned';
    if (skillStatus(sk, st, this.found).status === 'available') return st.coins >= sk.cost ? 'ready' : 'poor';
    return 'locked';
  }

  // ------------------------------------------------ camera
  layoutView() {
    const g = this.game;
    const W = g.screen.W, H = g.screen.H;
    const r = { x: 6, y: 4, w: W - 12, h: H - 8 };
    const HEAD = 30;
    const side = clamp(Math.round(r.w * 0.25), 206, 290);
    const view = { x: r.x + 8, y: r.y + HEAD, w: r.w - 16 - side - 6, h: r.h - HEAD - 8 };
    return { r, HEAD, view, side: { x: view.x + view.w + 6, y: view.y, w: side, h: view.h } };
  }

  rungs(view) {
    const fit = Math.min(view.w / BW, view.h / BH);
    const minZ = Math.min(1, Math.floor(fit * 100) / 100);
    return { fit, list: [...(minZ < 0.995 ? [minZ] : []), 1, 2, 3, 4] };
  }

  defaultZoom(view) {
    const { fit, list } = this.rungs(view);
    return fit >= 0.94 ? 1 : list[0];
  }

  zoomStep(dir, sx, sy, view) {
    const R = this.rungs(view).list;
    let i = 0;
    for (let k = 0; k < R.length; k++) if (Math.abs(R[k] - this.zT) < Math.abs(R[i] - this.zT)) i = k;
    const ni = clamp(i + dir, 0, R.length - 1);
    if (ni === i) { this.bump = 0.25 * dir; return; }
    this.zT = R[ni];
    this.anchor = { bx: this.camX + (sx - view.x) / this.z, by: this.camY + (sy - view.y) / this.z, sx, sy };
    this.goal = null;
    this.game.audio.play('ui_hover', { vol: 0.35, pitch: 0.8 + ni * 0.12 });
  }

  zoomTo(z, view) {
    this.zT = z;
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    this.anchor = { bx: this.camX + (cx - view.x) / this.z, by: this.camY + (cy - view.y) / this.z, sx: cx, sy: cy };
  }

  // pan (animated) so a tile is comfortably inside the view
  focusTile(id, view) {
    const vw = view.w / this.zT, vh = view.h / this.zT;
    const x = BX(id), y = BY(id);
    const m = 46;
    let gx = this.camX, gy = this.camY;
    if (x - m < gx) gx = x - m; else if (x + m > gx + vw) gx = x + m - vw;
    if (y - m < gy) gy = y - m; else if (y + m > gy + vh) gy = y + m - vh;
    if (Math.abs(gx - this.camX) > 0.5 || Math.abs(gy - this.camY) > 0.5) this.goal = { x: gx, y: gy };
  }

  clampCam(view, z = this.z) {
    const vw = view.w / z, vh = view.h / z, pad = 20;
    this.camX = vw >= BW ? (BW - vw) / 2 : clamp(this.camX, -pad, BW - vw + pad);
    this.camY = vh >= BH ? (BH - vh) / 2 : clamp(this.camY, -pad, BH - vh + pad);
  }

  updateCamera(view, dt) {
    const inp = this.game.input;
    if (this.z === null) {
      this.z = this.zT = this.defaultZoom(view);
      this.camX = (BW - view.w / this.z) / 2;
      this.camY = (BH - view.h / this.z) / 2;
      if (this.highlight && SKILL_BY_ID[this.highlight]) this.focusTile(this.highlight, view);
    }
    if (this.z !== this.zT) {
      this.z = Math.exp(damp(Math.log(this.z), Math.log(this.zT), 13, dt));
      if (Math.abs(this.z - this.zT) < 0.003) this.z = this.zT;
    }
    if (this.anchor) {
      this.camX = this.anchor.bx - (this.anchor.sx - view.x) / this.z;
      this.camY = this.anchor.by - (this.anchor.sy - view.y) / this.z;
      if (this.z === this.zT) this.anchor = null;
    }
    // keyboard pan (arrows), smooth
    const kx = (inp.key('ArrowRight') ? 1 : 0) - (inp.key('ArrowLeft') ? 1 : 0);
    const ky = (inp.key('ArrowDown') ? 1 : 0) - (inp.key('ArrowUp') ? 1 : 0);
    this.kv = this.kv || { x: 0, y: 0 };
    this.kv.x = damp(this.kv.x, kx * 360, 12, dt);
    this.kv.y = damp(this.kv.y, ky * 360, 12, dt);
    if (Math.abs(this.kv.x) + Math.abs(this.kv.y) > 1) {
      this.camX += (this.kv.x * dt) / this.z;
      this.camY += (this.kv.y * dt) / this.z;
      this.goal = null;
    }
    if (this.goal && !this.drag) {
      this.camX = damp(this.camX, this.goal.x, 9, dt);
      this.camY = damp(this.camY, this.goal.y, 9, dt);
      if (Math.abs(this.camX - this.goal.x) + Math.abs(this.camY - this.goal.y) < 0.4) this.goal = null;
    }
    this.clampCam(view);
    this.bump = (this.bump || 0) * Math.exp(-dt * 10);
  }

  // ------------------------------------------------ frame
  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    dt = Math.max(0, dt);
    this.t += dt;
    const t = this.t;
    this.found = g.speciesFound();
    const { r, HEAD, view, side } = this.layoutView();
    this.rect = r;
    this.view = view;
    this.updateCamera(view, dt);
    const z = this.z;
    const bz = 1 + (this.bump || 0) * 0.02;
    const zz = z * bz;
    const tx = Math.round(view.x - this.camX * zz), ty = Math.round(view.y - this.camY * zz);
    const toB = (sx, sy) => [(sx - tx) / zz, (sy - ty) / zz];
    const toS = (bx, by) => [tx + bx * zz, ty + by * zz];

    drawWood(ctx, r.x, r.y, r.w, r.h, { tone: 'dark' });
    this.drawHeader(ctx, ui, r, HEAD, view);

    // status changes -> chains fall off
    const status = {};
    for (const s of SKILLS) status[s.id] = this.status(s);
    if (this.prevStatus) {
      for (const s of SKILLS) if (this.prevStatus[s.id] === 'locked' && status[s.id] !== 'locked') this.unchain(s, BX(s.id), BY(s.id));
    }
    this.prevStatus = status;

    // ------------------------------------------------ hover
    const mm = this.minimapRect(view);
    const overMM = mm.alpha > 0.5 && ui.hover(mm);
    let hov = null;
    if (ui.hover(view) && !overMM && !this.drag?.moved && !this.mmDrag) {
      const [bx, by] = toB(inp.x, inp.y);
      for (const s of SKILLS) {
        const x = BX(s.id), y = BY(s.id);
        if (Math.abs(bx - x) <= TILE / 2 + 1 && by >= y - TILE / 2 - 3 && by <= y + TILE / 2 + 4) hov = s;
      }
    }
    if ((hov?.id || null) !== this.hoverId) {
      this.hoverId = hov?.id || null;
      this.chainT = 0;
      if (hov) g.audio.play('ui_hover', { vol: 0.3, pitch: 0.9 + LAYOUT.col[hov.id] * 0.04 });
    }
    this.chainT += dt;
    const focus = hov?.id || null;
    const chain = focus ? ancestors(focus) : null;
    const next = focus ? new Set(KIDS[focus] || []) : null;
    const semantic = z >= SEMANTIC;

    // ------------------------------------------------ board
    ctx.save();
    ctx.beginPath(); ctx.rect(view.x, view.y, view.w, view.h); ctx.clip();
    ctx.drawImage(glassBody(view.w, view.h), view.x, view.y);
    const wm = compassWatermark(Math.min(view.w, 400), Math.min(view.h, 400));
    const par = 0.18; // the watermark drifts a little with the camera (parallax depth)
    ctx.drawImage(wm, Math.round(view.x + view.w / 2 - wm.width / 2 + 30 - (this.camX + view.w / z / 2 - BW / 2) * par * z), Math.round(view.y + view.h / 2 - wm.height / 2 - (this.camY + view.h / z / 2 - BH / 2) * par * z));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x0 = view.x + ((i * 173 + t * 7) % (view.w + 200)) - 100;
      ctx.fillStyle = rgba('#8ae0f0', 0.025);
      ctx.beginPath(); ctx.moveTo(x0, view.y); ctx.lineTo(x0 + 30, view.y); ctx.lineTo(x0 - 70, view.y + view.h); ctx.lineTo(x0 - 100, view.y + view.h); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(zz, zz);
    // track labels on their underlines
    L_ROWS: for (let ri = 0; ri < LAYOUT.rows.length; ri++) {
      const row = LAYOUT.rows[ri];
      const y = rowY(ri);
      const [, sy] = toS(0, y);
      if (sy < view.y - 60 * z || sy > view.y + view.h + 60 * z) continue L_ROWS;
      const B = BRANCHES[row.branch];
      const fx = BX(row.tiles[0].id) - TILE / 2 - 2;
      const got = row.tiles.filter((s) => st.skills[s.id]).length;
      const [lx0, ly0] = toS(4, y - 16);
      const lh = !chain && ui.hover({ x: lx0, y: ly0, w: (GUTTER - 6) * z, h: 24 * z });
      ctx.fillStyle = rgba(B.color, lh ? 0.9 : 0.55);
      ctx.fillRect(6, y, fx - 6, 1);
      ctx.fillStyle = rgba('#000000', 0.5);
      ctx.fillRect(7, y + 1, fx - 7, 1);
      drawText(ctx, B.name.toUpperCase(), 8, y - 9, { font: 'small', color: lh ? '#ffffff' : shade(B.color, 0.35), shadow: '#05080c' });
      drawText(ctx, `${got}/${row.tiles.length}`, 8, y + 5, { font: 'small', color: got === row.tiles.length ? '#ffe27a' : '#5a8a9a' });
      if (lh) ui.tip = `${B.name}: ${got}/${row.tiles.length} grown`;
    }
    // links
    const half = TILE / 2;
    const onPath = (l) => chain && (chain.has(l.from) && (chain.has(l.to) || l.to === focus));
    for (const pass of [0, 1]) {
      for (const l of LAYOUT.links) {
        const path = onPath(l);
        if ((pass === 1) !== !!path) continue;
        const lit = path ? 3 : st.skills[l.from] && st.skills[l.to] ? 2 : st.skills[l.from] ? 1 : 0;
        const dim = chain && !path && l.from !== focus;
        if (dim) ctx.globalAlpha = 0.3;
        const x0 = BX(l.from), y0 = BY(l.from), x1 = BX(l.to), y1 = BY(l.to);
        if (l.kind === 'bar') this.rope(ctx, x0 + half + 1, x1 - half - 1, y0, lit, t);
        else if (l.kind === 'arc') {
          const ay = y0 - half - 9 - l.lane * 4;
          this.wire(ctx, [[x0 + 6, y0 - half - 4], [x0 + 6, ay], [x1 - 6, ay], [x1 - 6, y1 - half - 4]], lit, t);
        } else {
          const down = y1 > y0;
          if (l.first) {
            const vx = x0 + (down ? 6 : -6);
            this.wire(ctx, [[vx, y0 + (down ? half + 6 : -half - 4)], [vx, y1], [x1 - half - 2, y1]], lit, t);
          } else {
            const cy = down ? y1 - half - 13 : y1 + half + 13;
            this.wire(ctx, [[x0 + 8, y0 + (down ? half + 6 : -half - 4)], [x0 + 8, cy], [x1 + 8, cy], [x1 + 8, y1 + (down ? -half - 4 : half + 6)]], lit, t);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    // tiles
    const vb0 = toB(view.x, view.y), vb1 = toB(view.x + view.w, view.y + view.h);
    for (const s of SKILLS) {
      const x = BX(s.id), y = BY(s.id);
      if (x < vb0[0] - 40 || x > vb1[0] + 40 || y < vb0[1] - 40 || y > vb1[1] + 40) continue;
      const role = !chain ? null : s.id === focus ? 'focus' : chain.has(s.id) ? 'chain' : next.has(s.id) ? 'next' : 'dim';
      this.drawTile(ctx, s, status[s.id], x, y, hov === s, t, dt, role, semantic);
    }
    this.drawFalling(ctx, dt);
    // tutorial highlight
    if (this.highlight && !st.skills[this.highlight] && SKILL_BY_ID[this.highlight]) {
      const x = BX(this.highlight), y = BY(this.highlight);
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
    ctx.restore();

    // semantic plates (screen space, crisp text) when zoomed in
    if (semantic) {
      const a = clamp01((z - SEMANTIC) / 0.25 + 0.4);
      for (const s of SKILLS) {
        const [sx, sy] = toS(BX(s.id), BY(s.id));
        if (sx < view.x - 120 || sx > view.x + view.w + 120 || sy < view.y - 60 || sy > view.y + view.h + 80) continue;
        const dim = chain && !(s.id === focus || chain.has(s.id) || next.has(s.id));
        ctx.globalAlpha = a * (dim ? 0.35 : 1);
        this.drawPlate(ctx, s, status[s.id], sx, sy + (TILE / 2 - 2) * zz, z, PC * zz - 8);
      }
      ctx.globalAlpha = 1;
    }
    // sticky branch tags when the gutter scrolls out of view
    if (tx + (GUTTER - 10) * zz < view.x) {
      for (let ri = 0; ri < LAYOUT.rows.length; ri++) {
        const [, sy] = toS(0, rowY(ri));
        if (sy < view.y + 4 || sy > view.y + view.h - 8) continue;
        const B = BRANCHES[LAYOUT.rows[ri].branch];
        const w = measureText(B.name.toUpperCase(), 'small') + 8;
        const y = Math.round(sy - 4);
        ctx.fillStyle = rgba('#05080c', 0.8);
        ctx.fillRect(view.x, y - 1, w + 2, 9);
        ctx.fillStyle = shade(B.color, -0.45);
        ctx.fillRect(view.x, y, w, 7);
        ctx.fillStyle = B.color;
        ctx.fillRect(view.x, y, 2, 7);
        drawText(ctx, B.name.toUpperCase(), view.x + 5, y + 1, { font: 'small', color: shade(B.color, 0.6) });
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba('#bfefff', 0.045);
    ctx.beginPath(); ctx.moveTo(view.x + 40, view.y); ctx.lineTo(view.x + 100, view.y); ctx.lineTo(view.x, view.y + 100); ctx.lineTo(view.x, view.y + 40); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // hint strip (fades out once the player has zoomed)
    if (!this.usedZoom) {
      const ha = clamp01(1.2 - Math.max(0, t - 6) * 0.5);
      if (ha > 0) {
        ctx.globalAlpha = ha;
        const txt = 'Wheel or +/- to zoom  -  drag or arrows to pan';
        const w = measureText(txt, 'small') + 12;
        ctx.fillStyle = rgba('#05080c', 0.7);
        ctx.fillRect(Math.round(view.x + view.w / 2 - w / 2), view.y + view.h - 15, w, 11);
        drawText(ctx, txt, view.x + view.w / 2, view.y + view.h - 12, { font: 'small', align: 'center', color: '#8ad0e0' });
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    this.drawMinimap(ctx, ui, view, mm, status, t);
    // glass border
    ctx.fillStyle = '#05080c';
    ctx.fillRect(view.x - 1, view.y - 1, view.w + 2, 1); ctx.fillRect(view.x - 1, view.y + view.h, view.w + 2, 1);
    ctx.fillRect(view.x - 1, view.y, 1, view.h); ctx.fillRect(view.x + view.w, view.y, 1, view.h);
    ctx.fillStyle = rgba('#8ae0f0', 0.25);
    ctx.fillRect(view.x, view.y, view.w, 1);

    // ------------------------------------------------ input
    if (inp.wheel && ui.hover(view)) {
      this.wheelAcc += inp.wheel;
      if (Math.abs(this.wheelAcc) >= 1) {
        this.zoomStep(this.wheelAcc < 0 ? 1 : -1, inp.x, inp.y, view);
        this.wheelAcc = 0;
        this.usedZoom = true;
      }
    } else if (!inp.wheel) this.wheelAcc *= 0.8;
    if (inp.keyPressed('+') || inp.keyPressed('=')) { this.zoomStep(1, view.x + view.w / 2, view.y + view.h / 2, view); this.usedZoom = true; }
    if (inp.keyPressed('-') || inp.keyPressed('_')) { this.zoomStep(-1, view.x + view.w / 2, view.y + view.h / 2, view); this.usedZoom = true; }
    if (inp.keyPressed('0')) this.zoomTo(this.defaultZoom(view), view);
    if (inp.keyPressed('Enter') && this.sel) this.tryGrow(SKILL_BY_ID[this.sel], status[this.sel]);

    if (overMM && inp.pressed) { inp.pressed = false; this.mmDrag = true; }
    if (this.mmDrag) {
      if (!inp.down) this.mmDrag = false;
      else {
        const s = mm.w / BW;
        this.camX = (inp.x - mm.x) / s - view.w / z / 2;
        this.camY = (inp.y - mm.y) / s - view.h / z / 2;
        this.goal = null;
        this.clampCam(view);
      }
    } else if (ui.hover(view) && inp.pressed) {
      inp.pressed = false;
      this.drag = { x: inp.x, y: inp.y, cx: this.camX, cy: this.camY, moved: false, tile: hov?.id || null };
    }
    if (this.drag) {
      const d = this.drag;
      if (Math.abs(inp.x - d.x) + Math.abs(inp.y - d.y) > 3) d.moved = true;
      if (d.moved) {
        this.camX = d.cx - (inp.x - d.x) / z;
        this.camY = d.cy - (inp.y - d.y) / z;
        this.goal = null;
        this.anchor = null;
        this.clampCam(view);
      }
      if (!inp.down) {
        if (!d.moved && d.tile) this.clickTile(SKILL_BY_ID[d.tile], status[d.tile]);
        else if (!d.moved && !d.tile) this.sel = null;
        this.drag = null;
      }
    }

    this.drawSide(ctx, ui, side, status, t);
    if (hov && !semantic) ui.tip = hov.name;
  }

  clickTile(sk, status) {
    const g = this.game;
    if (this.sel === sk.id || (this.highlight === sk.id && status === 'ready')) {
      this.sel = sk.id;
      this.tryGrow(sk, status);
      return;
    }
    this.sel = sk.id;
    this.fx[sk.id] = { kind: 'pick', t: 0 };
    g.audio.play('ui_click', { vol: 0.6, pitch: 1.1 });
    if (this.view) this.focusTile(sk.id, this.view);
  }

  tryGrow(sk, status) {
    const g = this.game;
    if (!sk) return false;
    const [x, y] = this.screenOf(sk.id);
    if (status === 'owned') {
      this.fx[sk.id] = { kind: 'wiggle', t: 0 };
      g.audio.play('bubble', { vol: 0.5, pitch: 1.3 });
      return false;
    }
    if (g.unlockSkill(sk.id)) {
      this.fx[sk.id] = { kind: 'bloom', t: 0 };
      this.grown = { id: sk.id, t: 0 };
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

  screenOf(id) {
    const v = this.view;
    if (!v || this.z == null) return [0, 0];
    const tx = Math.round(v.x - this.camX * this.z), ty = Math.round(v.y - this.camY * this.z);
    return [tx + BX(id) * this.z, ty + BY(id) * this.z];
  }

  unchain(sk) {
    const g = this.game;
    this.fx[sk.id] = { kind: 'unchain', t: 0 };
    this.falling.push({ x: BX(sk.id) - 5, y: BY(sk.id) + 3, vx: (Math.random() - 0.5) * 30, vy: -40, t: 0 });
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

  // kelp-rope bar between neighbouring tiles (lit 3 = highlighted requirement path)
  rope(ctx, x0, x1, y, lit, t) {
    if (x1 <= x0) return;
    const C = lit === 3 ? ['#3a2008', '#c8862a', '#ffd25a', '#fff6c8'] : lit === 2 ? ['#12280e', '#4a8a3a', '#8ad05a', '#d8f48a'] : lit === 1 ? ['#0e2018', '#2e5a3a', '#4a8a5a', '#7ab88a'] : ['#070c10', '#1a262c', '#2a3840', '#3a4a54'];
    ctx.fillStyle = C[0];
    ctx.fillRect(x0, y - 2, x1 - x0, 5);
    const flow = lit >= 2 ? Math.floor(t * (lit === 3 ? 14 : 6)) : 0;
    for (let x = x0; x < x1; x++) {
      const ph = (((x - flow) % 4) + 4) % 4;
      ctx.fillStyle = ph < 2 ? C[2] : C[1];
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillStyle = C[3];
      if (ph === 0) ctx.fillRect(x, y - 1, 1, 1);
      if (ph === 2) ctx.fillRect(x, y + 1, 1, 1);
    }
    if (lit === 2) {
      for (let x = x0 + 3; x < x1 - 2; x += 7) { ctx.fillStyle = C[2]; ctx.fillRect(x, y - 3 - Math.round(Math.sin(t * 2 + x) * 0.6), 2, 1); }
    }
    if (lit === 3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ffd25a', 0.18 + 0.1 * Math.sin(t * 6));
      ctx.fillRect(x0, y - 3, x1 - x0, 7);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // thin orthogonal circuit wire with a travelling glint when powered (lit 3 = highlighted path)
  wire(ctx, pts, lit, t) {
    const col = lit === 3 ? '#ffe27a' : lit === 2 ? '#ffd25a' : lit === 1 ? '#7ad8e8' : '#24414e';
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
      if (lit === 3) {
        ctx.fillStyle = rgba('#ffd25a', 0.35);
        ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = lit ? shade(col, 0.4) : '#2e5262';
    for (let i = 1; i < pts.length - 1; i++) ctx.fillRect(pts[i][0] - 1, pts[i][1] - 1, 3, 3);
    const [ex, ey] = pts[pts.length - 1];
    ctx.fillRect(ex - 1, ey - 1, 3, 3);
    if (lit && total > 0) {
      const n = lit === 3 ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const d = ((t * (lit === 3 ? 90 : 60) + (k * (total + 30)) / n) % (total + 30)) - 15;
        for (const s of segs) {
          if (d < s.at || d > s.at + s.len) continue;
          const kk = (d - s.at) / Math.max(1, s.len);
          const x = Math.round(lerp(s.ax, s.bx, kk)), y = Math.round(lerp(s.ay, s.by, kk));
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba('#ffffff', 0.9);
          ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
  }

  drawTile(ctx, sk, status, x, y, hover, t, dt, role, semantic) {
    const B = BRANCHES[sk.branch];
    const fx = this.fx[sk.id];
    let sc = 1, dx = 0, flash = 0;
    if (fx) {
      fx.t += dt;
      if (fx.kind === 'bloom') { sc = 1 + 0.35 * (1 - ease.outElastic(clamp01(fx.t / 0.7))); flash = clamp01(1 - fx.t / 0.45); if (fx.t > 1.2) delete this.fx[sk.id]; }
      else if (fx.kind === 'shake') { dx = Math.round(Math.sin(fx.t * 55) * 2 * (1 - fx.t / 0.35)); if (fx.t > 0.35) delete this.fx[sk.id]; }
      else if (fx.kind === 'wiggle') { sc = 1 + Math.sin(fx.t * 25) * 0.06 * (1 - fx.t / 0.4); if (fx.t > 0.4) delete this.fx[sk.id]; }
      else if (fx.kind === 'pick') { sc = 1 + Math.sin(clamp01(fx.t / 0.25) * Math.PI) * 0.1; if (fx.t > 0.25) delete this.fx[sk.id]; }
      else if (fx.kind === 'unchain' && fx.t > 0.7) delete this.fx[sk.id];
    }
    if (role === 'dim') ctx.globalAlpha = 0.32;
    const lift = hover ? 1 : 0;
    const x0 = Math.round(x - TILE / 2 + dx), y0 = Math.round(y - TILE / 2 - lift);
    if (status === 'ready' || role === 'focus' || role === 'chain') {
      const p = 0.5 + 0.5 * Math.sin(t * 4 + x * 0.05);
      const gc = role === 'chain' || role === 'focus' ? '#ffd25a' : B.color;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 3; i >= 1; i--) {
        ctx.fillStyle = rgba(gc, ((0.05 + 0.07 * p) * (4 - i)) / 3);
        ctx.fillRect(x0 - i * 2, y0 - i * 2, TILE + i * 4, TILE + i * 4);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const spr = tileSprite(status, sk.id === 'hook1' ? '#f2866e' : B.color);
    if (sc !== 1) {
      const w = Math.round(spr.width * sc), h = Math.round(spr.height * sc);
      ctx.drawImage(spr, Math.round(x - w / 2 + dx), Math.round(y - lift - (TILE / 2) * sc - 3 * sc), w, h);
    } else ctx.drawImage(spr, x0, y0 - 3);
    const ic = getUiIcon(sk.icon || 'star');
    const iw = Math.round(ic.width * 2 * sc), ih = Math.round(ic.height * 2 * sc);
    const ix = Math.round(x - iw / 2 + dx), iy = Math.round(y - ih / 2 - lift);
    if (status === 'locked') ctx.drawImage(tinted(ic, '#2c3a48'), ix, iy, iw, ih);
    else {
      if (status === 'poor') ctx.globalAlpha *= 0.7;
      ctx.drawImage(ic, ix, iy, iw, ih);
      ctx.globalAlpha = role === 'dim' ? 0.32 : 1;
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
    const un = fx?.kind === 'unchain' ? clamp01(fx.t / 0.6) : status === 'locked' ? 0 : 1;
    if (un < 1) {
      const a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * (1 - un);
      this.chains(ctx, x0, y0, Math.round(un * 10));
      if (!un) ctx.drawImage(getUiIcon('lock'), x - 5, y + 2);
      ctx.globalAlpha = a0;
    }
    // brackets: hover (cream), selected (blinking cyan), requirement chain (gold), unlocks-next (cyan dashes)
    const sel = this.sel === sk.id;
    if (hover || sel || role === 'chain' || role === 'next') {
      ctx.fillStyle = hover ? '#fff2b0' : role === 'chain' ? '#ffd25a' : role === 'next' ? '#7ae8ff' : '#7ad8e8';
      const o = sel && !hover ? (Math.floor(t * 4) % 2 ? 1 : 0) : role === 'next' ? Math.round(Math.sin(t * 6)) : 0;
      const Lx = x0 - 3 - o, Rx = x0 + TILE + 2 + o, T = y0 - 6 - o, Bt = y0 + TILE + 7 + o;
      const k = role === 'next' && !hover && !sel ? 3 : 6;
      ctx.fillRect(Lx, T, k, 1); ctx.fillRect(Lx, T, 1, k);
      ctx.fillRect(Rx - k + 1, T, k, 1); ctx.fillRect(Rx, T, 1, k);
      ctx.fillRect(Lx, Bt, k, 1); ctx.fillRect(Lx, Bt - k + 1, 1, k);
      ctx.fillRect(Rx - k + 1, Bt, k, 1); ctx.fillRect(Rx, Bt - k + 1, 1, k);
    }
    // cost plate (replaced by the screen-space name plate when zoomed in)
    if (!semantic) {
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
    ctx.globalAlpha = 1;
  }

  // zoomed-in name plate under a tile: name + cost (2x), name + effect + cost (3x+), crisp 1x text
  drawPlate(ctx, sk, status, cx, top, z, maxW) {
    const big = z >= 2.75;
    const costTxt = status === 'owned' ? 'GROWN' : sk.cost ? `${formatCommas(sk.cost)}{coin}` : 'FREE';
    const nameCol = status === 'owned' ? '#ffe8b8' : status === 'ready' ? '#c8ffd8' : status === 'poor' ? '#ffb0a0' : '#7a8a98';
    const costCol = status === 'poor' ? '#ff7a6a' : status === 'locked' ? '#5a6a78' : status === 'ready' ? '#b8ffc8' : '#ffd25a';
    const lines = [];
    const tw = maxW - 8;
    if (!big) {
      for (const l of wrapText(sk.name.toUpperCase(), tw, 'small').slice(0, 2)) lines.push({ t: l, font: 'small', col: nameCol });
    } else {
      for (const l of wrapText(sk.name, tw, 'normal').slice(0, 2)) lines.push({ t: l, font: 'normal', col: nameCol });
      for (const l of wrapText(shortEffect(sk), tw, 'small').slice(0, z >= 3.5 ? 3 : 2)) lines.push({ t: l, font: 'small', col: '#8ad0e0' });
    }
    lines.push({ t: costTxt, font: 'small', col: costCol });
    const lh = (l) => (l.font === 'normal' ? 10 : 7);
    const w = Math.min(maxW, Math.max(...lines.map((l) => measureText(l.t, l.font))) + 10);
    const h = lines.reduce((a, l) => a + lh(l), 0) + 4;
    const x = Math.round(cx - w / 2), y = Math.round(top);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(x - 1, y, w + 2, h + 1);
    ctx.fillStyle = status === 'locked' ? '#141a22' : '#24180e';
    ctx.fillRect(x, y + 1, w, h - 1);
    ctx.fillStyle = status === 'locked' ? '#2a323c' : BRASS[1];
    ctx.fillRect(x, y + 1, w, 1);
    ctx.fillStyle = shade(BRANCHES[sk.branch].color, -0.2);
    ctx.fillRect(x, y + 2, 1, h - 2);
    ctx.fillRect(x + w - 1, y + 2, 1, h - 2);
    let yy = y + 3;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h + 1); ctx.clip();
    for (const l of lines) {
      drawText(ctx, l.t, cx, yy, { font: l.font, color: l.col, align: 'center' });
      yy += lh(l);
    }
    ctx.restore();
  }

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

  // ------------------------------------------------ minimap
  minimapRect(view) {
    const w = 124, h = Math.round((124 * BH) / BW);
    const z = this.z || 1;
    const show = view.w / z < BW - 2 || view.h / z < BH - 2;
    this.mmA = damp(this.mmA || 0, show ? 1 : 0, 10, 1 / 60);
    return { x: view.x + view.w - w - 6, y: view.y + view.h - h - 6, w, h, alpha: this.mmA };
  }

  drawMinimap(ctx, ui, view, mm, status, t) {
    if (mm.alpha < 0.02) return;
    const st = this.game.state;
    ctx.globalAlpha = mm.alpha;
    const s = mm.w / BW;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(mm.x - 2, mm.y - 2, mm.w + 4, mm.h + 4);
    ctx.fillStyle = BRASS[2];
    ctx.fillRect(mm.x - 1, mm.y - 1, mm.w + 2, mm.h + 2);
    ctx.fillStyle = BRASS[4];
    ctx.fillRect(mm.x - 1, mm.y - 1, mm.w + 2, 1);
    ctx.fillStyle = rgba('#06121c', 0.92);
    ctx.fillRect(mm.x, mm.y, mm.w, mm.h);
    LAYOUT.rows.forEach((row, ri) => {
      const y = Math.round(mm.y + rowY(ri) * s);
      ctx.fillStyle = rgba(BRANCHES[row.branch].color, 0.22);
      ctx.fillRect(mm.x + 3, y, mm.w - 6, 1);
    });
    for (const l of LAYOUT.links) {
      if (!st.skills[l.from] || l.kind !== 'bar') continue;
      ctx.fillStyle = st.skills[l.to] ? rgba('#8ad05a', 0.6) : rgba('#4a8a5a', 0.5);
      const x0 = Math.round(mm.x + BX(l.from) * s), x1 = Math.round(mm.x + BX(l.to) * s);
      ctx.fillRect(x0, Math.round(mm.y + BY(l.from) * s), x1 - x0, 1);
    }
    for (const sk of SKILLS) {
      const x = Math.round(mm.x + BX(sk.id) * s) - 1, y = Math.round(mm.y + BY(sk.id) * s) - 1;
      const S = status[sk.id], col = BRANCHES[sk.branch].color;
      ctx.fillStyle = S === 'owned' ? vivid(col) : S === 'ready' ? (Math.sin(t * 5) > 0 ? '#ffffff' : shade(col, 0.4)) : S === 'poor' ? mix(col, '#0c1c28', 0.6) : '#26303a';
      ctx.fillRect(x, y, 3, 3);
      if (sk.id === this.sel) { ctx.fillStyle = '#7ae8ff'; ctx.fillRect(x - 1, y - 1, 5, 1); ctx.fillRect(x - 1, y + 3, 5, 1); }
    }
    // view rectangle
    const vx = Math.round(mm.x + this.camX * s), vy = Math.round(mm.y + this.camY * s);
    const vw = Math.round((view.w / this.z) * s), vh = Math.round((view.h / this.z) * s);
    ctx.save();
    ctx.beginPath(); ctx.rect(mm.x, mm.y, mm.w, mm.h); ctx.clip();
    ctx.fillStyle = rgba('#fff2b0', 0.08);
    ctx.fillRect(vx, vy, vw, vh);
    ctx.fillStyle = ui.hover(mm) || this.mmDrag ? '#ffffff' : '#ffe27a';
    ctx.fillRect(vx, vy, vw, 1); ctx.fillRect(vx, vy + vh - 1, vw, 1);
    ctx.fillRect(vx, vy, 1, vh); ctx.fillRect(vx + vw - 1, vy, 1, vh);
    ctx.restore();
    drawText(ctx, 'MAP', mm.x + 3, mm.y + 3, { font: 'small', color: '#5a8a9a' });
    if (ui.hover(mm)) ui.tip = 'Minimap - click or drag to look around';
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------ header
  drawHeader(ctx, ui, r, HEAD, view) {
    const g = this.game;
    ctx.fillStyle = BRASS[1]; ctx.fillRect(r.x + 6, r.y + HEAD - 4, r.w - 12, 2);
    ctx.fillStyle = BRASS[4]; ctx.fillRect(r.x + 6, r.y + HEAD - 4, r.w - 12, 1);
    const md = medallion();
    const mx = r.x - 4, my = r.y - 4;
    ctx.drawImage(md, mx, my);
    const cor = getUiIcon('coral');
    ctx.drawImage(cor, Math.round(mx + md.width / 2 - cor.width), Math.round(my + md.height / 2 - cor.height), cor.width * 2, cor.height * 2);
    const title = 'SKILL TREE';
    const tw = measureText(title, 'normal', 2);
    const cx = Math.round(view.x + view.w / 2);
    drawText(ctx, title, cx, r.y + 7, { align: 'center', scale: 2, color: '#ffe8a8', outline: '#1a0e06' });
    for (const s of [-1, 1]) {
      const fx = Math.round(cx + s * (tw / 2 + 10));
      const x0 = s < 0 ? fx - 50 : fx;
      ctx.fillStyle = BRASS[3]; ctx.fillRect(x0, r.y + 13, 50, 1);
      ctx.fillStyle = BRASS[0]; ctx.fillRect(x0, r.y + 14, 50, 1);
      ctx.fillStyle = BRASS[4];
      ctx.fillRect(fx - 1, r.y + 12, 3, 3);
      ctx.fillStyle = BRASS[5]; ctx.fillRect(fx - 1, r.y + 12, 1, 1);
    }
    const owned = SKILLS.filter((s) => g.state.skills[s.id]).length;
    drawText(ctx, `${owned}/${SKILLS.length} GROWN`, r.x + 46, r.y + 8, { font: 'small', color: '#e0c890' });
    drawBar(ctx, r.x + 46, r.y + 16, 70, 5, owned / SKILLS.length, { color: '#8ad05a', back: '#1a2a1e' });
    // zoom controls (right end of the board area)
    const zx = view.x + view.w - 102, zy = r.y + 6;
    const R = this.rungs(view).list;
    const zi = R.indexOf(this.zT);
    if (ui.button(ctx, zx, zy, 17, 16, '', { icon: 'minus', style: 'shell', disabled: zi <= 0, tip: 'Zoom out (-)' })) { this.zoomStep(-1, view.x + view.w / 2, view.y + view.h / 2, view); this.usedZoom = true; }
    brassBox(ctx, zx + 19, zy, 42, 16);
    drawText(ctx, `${Math.round(this.zT * 100)}%`, zx + 40, zy + 5, { align: 'center', font: 'small', color: '#ffe8a8' });
    if (ui.button(ctx, zx + 63, zy, 17, 16, '', { icon: 'plus', style: 'shell', disabled: zi >= R.length - 1, tip: 'Zoom in (+)' })) { this.zoomStep(1, view.x + view.w / 2, view.y + view.h / 2, view); this.usedZoom = true; }
    if (ui.button(ctx, zx + 82, zy, 18, 16, '', { icon: 'expand', style: 'shell', disabled: this.zT === R[0] && !this.goal && Math.abs(this.camX - (BW - view.w / this.z) / 2) < 1, tip: 'Show the whole tree (0)' })) this.zoomTo(R[0], view);
    if (ui.button(ctx, r.x + r.w - 24, r.y + 6, 18, 17, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) ui.close(this.id);
  }

  // ------------------------------------------------ side panel
  drawSide(ctx, ui, R, status, t) {
    const g = this.game, st = g.state;
    // coin box
    brassBox(ctx, R.x, R.y, R.w, 28);
    ctx.drawImage(getUiIcon('coin_big'), R.x + 8, R.y + 9);
    drawText(ctx, formatCommas(Math.floor(this.ui?.coinShown ?? st.coins)), R.x + 24, R.y + 6, { color: '#ffe8a8', shadow: '#05080c' });
    drawText(ctx, 'COINS TO SPEND', R.x + 24, R.y + 17, { font: 'small', color: '#6aa8b8' });
    const ready = SKILLS.filter((s) => status[s.id] === 'ready').length;
    if (ready) drawText(ctx, `${ready} READY`, R.x + R.w - 8, R.y + 11, { font: 'small', color: '#8affb0', align: 'right' });

    const C = { x: R.x, y: R.y + 34, w: R.w - 2, h: R.h - 36 };
    drawPaper(ctx, C.x, C.y, C.w, C.h, { aged: true });
    ctx.fillStyle = rgba('#f4e0a0', 0.85);
    ctx.fillRect(C.x + C.w / 2 - 10, C.y - 3, 20, 6);
    const sk = SKILL_BY_ID[this.hoverId || this.sel];
    if (!sk) { this.drawOverview(ctx, ui, C, status, t); return; }
    const S = status[sk.id];
    const B = BRANCHES[sk.branch];
    const x = C.x + 9, w = C.w - 18;
    let y = C.y + 8;
    // branch ribbon
    const rw = measureText(B.name.toUpperCase(), 'small') + 12;
    ctx.fillStyle = shade(B.color, -0.5);
    ctx.fillRect(x, y, rw, 9);
    ctx.fillStyle = shade(B.color, -0.15);
    ctx.fillRect(x, y, rw, 1);
    ctx.fillStyle = shade(B.color, -0.5);
    ctx.fillRect(x + rw, y + 1, 2, 7); ctx.fillRect(x + rw + 2, y + 3, 1, 3);
    drawText(ctx, B.name.toUpperCase(), x + 6, y + 2, { font: 'small', color: shade(B.color, 0.65) });
    const chip = S === 'owned' ? ['GROWN', '#2a7a3a', 'check'] : S === 'ready' ? ['READY', '#1a6a5a', 'plus'] : S === 'poor' ? ['NEED COINS', '#a8382a', 'coin'] : ['LOCKED', '#5a5060', 'lock'];
    const cw = measureText(chip[0], 'small') + 18;
    ctx.fillStyle = chip[1];
    ctx.fillRect(x + w - cw, y, cw, 9);
    ctx.fillStyle = shade(chip[1], 0.35);
    ctx.fillRect(x + w - cw, y, cw, 1);
    const ci = getUiIcon(chip[2]);
    ctx.drawImage(ci, x + w - cw + 2, y + Math.round(4.5 - ci.height / 2));
    drawText(ctx, chip[0], x + w - 4, y + 2, { font: 'small', color: '#fff6e2', align: 'right' });
    y += 14;
    // big porthole + name
    const spr = tileSprite(S, sk.id === 'hook1' ? '#f2866e' : B.color);
    const bob = S === 'ready' ? Math.round(Math.sin(t * 3)) : 0;
    ctx.fillStyle = rgba('#3a2410', 0.25);
    ctx.fillRect(x + 4, y + 68, 60, 2);
    ctx.drawImage(spr, x, y + bob, spr.width * 2, spr.height * 2);
    const ic = getUiIcon(sk.icon || 'star');
    const icx = Math.round(x + 32 - ic.width * 2), icy = Math.round(y + 6 + 32 - ic.height * 2) + bob;
    if (S === 'locked') ctx.drawImage(tinted(ic, '#2c3a48'), icx, icy, ic.width * 4, ic.height * 4);
    else ctx.drawImage(ic, icx, icy, ic.width * 4, ic.height * 4);
    if (S === 'locked') ctx.drawImage(getUiIcon('lock'), x + 26, y + 46 + bob, 18, 18);
    const nx = x + 72, nw = w - 72;
    const big = measureText(sk.name, 'normal', 2) <= nw;
    let ny = y + 8;
    if (big) { drawText(ctx, sk.name, nx, ny, { scale: 2, color: INK }); ny += 20; } else {
      const nl = wrapText(sk.name, nw).slice(0, 2);
      nl.forEach((l, i) => drawText(ctx, l, nx, ny + i * 10, { color: INK }));
      ny += nl.length * 10 + 4;
    }
    for (const l of wrapText(shortEffect(sk), nw, 'small').slice(0, 3)) { drawText(ctx, l, nx, ny, { font: 'small', color: shade(B.color, -0.55) }); ny += 7; }
    y += 74;
    // lore + description
    const lore = LORE[sk.id];
    if (lore) {
      const ll = wrapText(`"${lore}"`, w - 6);
      ll.forEach((l, i) => drawText(ctx, l, x + 3, y + i * 10, { color: '#9a7a52' }));
      y += ll.length * 10 + 3;
    }
    const dl = wrapText(sk.desc, w);
    dl.forEach((l, i) => drawText(ctx, l, x, y + i * 10, { color: INK2 }));
    y += dl.length * 10 + 4;
    // effect: exact before -> after
    y = this.section(ctx, 'EFFECT', x, y, w, B);
    const owned = { ...st.skills };
    const had = !!owned[sk.id];
    delete owned[sk.id];
    const before = computeStats(owned);
    const after = computeStats({ ...owned, [sk.id]: true });
    for (const [k, v] of Object.entries(sk.effect)) {
      if (k === 'unlockBait') {
        for (const b of v) {
          const bs = baitSprite(b, t);
          ctx.drawImage(bs, x, y + 1 + Math.round(4 - bs.height / 2));
          drawText(ctx, 'Shop bait', x + 12, y + 1, { color: INK2 });
          drawText(ctx, (before.unlockBait.has(b) ? '' : '+ ') + (BAITS[b]?.name || b), x + w, y + 1, { color: GOOD, align: 'right' });
          y += 10;
        }
      } else if (k === 'unlockBiome') {
        ctx.drawImage(getUiIcon('map'), x, y);
        drawText(ctx, 'New ocean', x + 12, y + 1, { color: INK2 });
        drawText(ctx, '+ ' + (BIOME_NAMES[v] || v), x + w, y + 1, { color: GOOD, align: 'right' });
        y += 10;
      } else if (STAT[k]) {
        const [label, fmt] = STAT[k];
        const a = fmt(before[k]), b = fmt(after[k]);
        const bw = measureText(b), aw = measureText(a);
        drawText(ctx, label, x, y + 1, { color: INK2 });
        const rx = x + w;
        drawText(ctx, b, rx, y + 1, { color: GOOD, align: 'right' });
        // little arrow
        const ax = rx - bw - 9;
        ctx.fillStyle = INK3;
        ctx.fillRect(ax, y + 4, 5, 1); ctx.fillRect(ax + 3, y + 3, 1, 3); ctx.fillRect(ax + 4, y + 4, 1, 1);
        drawText(ctx, a, ax - 3, y + 1, { color: INK3, align: 'right' });
        if (measureText(label) + aw + bw + 18 > w) { /* tight row: accept overlap-free by construction */ }
        y += 10;
      }
    }
    if (had) { drawText(ctx, 'Already part of your coral.', x, y + 1, { font: 'small', color: GOOD }); y += 8; }
    y += 2;
    // cost
    y = this.section(ctx, 'COST', x, y, w, B);
    const costTxt = sk.cost ? `${formatCommas(sk.cost)}{coin}` : 'FREE';
    drawText(ctx, costTxt, x, y + 1, { color: INK });
    if (S === 'owned') drawText(ctx, 'Paid in full', x + w, y + 1, { color: GOOD, align: 'right' });
    else if (st.coins >= sk.cost) drawText(ctx, `You have ${formatCommas(Math.floor(st.coins))}`, x + w, y + 1, { color: GOOD, align: 'right' });
    else drawText(ctx, `Need ${formatCommas(Math.ceil(sk.cost - st.coins))} more`, x + w, y + 1, { color: BAD, align: 'right' });
    y += 13;
    // requirements checklist
    const reqs = sk.req.map((id) => ({ text: SKILL_BY_ID[id].name, ok: !!st.skills[id], id }));
    if (sk.needSpecies) reqs.push({ text: `Discover ${sk.needSpecies} species (${Math.min(this.found, sk.needSpecies)}/${sk.needSpecies})`, ok: this.found >= sk.needSpecies });
    y = this.section(ctx, 'REQUIRES', x, y, w, B);
    if (!reqs.length) { drawText(ctx, 'Nothing - this is the root!', x, y + 1, { color: INK3 }); y += 10; }
    for (const q of reqs) {
      const rr = { x, y: y - 1, w, h: 10 };
      const hv = q.id && ui.hover(rr);
      ctx.drawImage(getUiIcon(q.ok ? 'check' : 'cross'), x, y);
      drawText(ctx, q.text, x + 12, y + 1, { color: q.ok ? GOOD : BAD });
      if (hv) {
        ctx.fillStyle = rgba('#7a5a3c', 0.5);
        ctx.fillRect(x + 12, y + 9, measureText(q.text), 1);
        ui.tip = 'Show on the tree';
        if (this.game.input.pressed) { this.game.input.pressed = false; this.jumpTo(q.id); }
      }
      y += 10;
    }
    y += 3;
    // the full road from what you own to this skill (indirect requirements too)
    const road = [...ancestors(sk.id)].filter((id) => !st.skills[id]).map((id) => SKILL_BY_ID[id]).sort((a, b) => LAYOUT.col[a.id] - LAYOUT.col[b.id] || LAYOUT.rowOf[a.id] - LAYOUT.rowOf[b.id]);
    if (road.length && S !== 'owned') {
      y = this.section(ctx, 'ROAD HERE', x, y, w, B);
      const total = road.reduce((a, q) => a + q.cost, 0) + sk.cost;
      for (const q of road.slice(0, 4)) {
        const rr = { x, y: y - 1, w, h: 10 };
        const hv = ui.hover(rr);
        const qi = getUiIcon(q.icon || 'star');
        ctx.drawImage(tinted(qi, status[q.id] === 'ready' ? '#1a6a5a' : '#8a7058'), x, y + Math.round(4 - qi.height / 2));
        drawText(ctx, q.name, x + qi.width + 3, y + 1, { color: hv ? '#1a4a6a' : status[q.id] === 'ready' ? '#1a6a5a' : INK2 });
        drawText(ctx, formatCommas(q.cost), x + w, y + 2, { font: 'small', color: INK3, align: 'right' });
        if (hv) { ui.tip = 'Show on the tree'; if (this.game.input.pressed) { this.game.input.pressed = false; this.jumpTo(q.id); } }
        y += 10;
      }
      if (road.length > 4) { drawText(ctx, `...and ${road.length - 4} more`, x + 12, y + 1, { font: 'small', color: INK3 }); y += 8; }
      drawText(ctx, `${road.length + 1} skills, total ${formatCommas(total)}{coin}`, x + w, y + 1, { color: st.coins >= total ? GOOD : INK, align: 'right' });
      y += 13;
    }
    // unlocks next
    const kids = KIDS[sk.id] || [];
    y = this.section(ctx, 'UNLOCKS NEXT', x, y, w, B);
    if (!kids.length) { drawText(ctx, 'End of the branch. Fancy!', x, y + 1, { color: INK3 }); y += 10; }
    for (const id of kids.slice(0, 4)) {
      const k = SKILL_BY_ID[id];
      const ks = status[id];
      const rr = { x, y: y - 1, w, h: 10 };
      const hv = ui.hover(rr);
      const kic = getUiIcon(k.icon || 'star');
      ctx.drawImage(ks === 'locked' ? tinted(kic, '#6a5a50') : kic, x, y + Math.round(4 - kic.height / 2));
      drawText(ctx, k.name, x + kic.width + 3, y + 1, { color: hv ? '#1a4a6a' : ks === 'owned' ? GOOD : INK2 });
      drawText(ctx, ks === 'owned' ? 'GROWN' : k.cost ? `${formatCommas(k.cost)}` : 'FREE', x + w, y + 2, { font: 'small', color: ks === 'owned' ? GOOD : INK3, align: 'right' });
      if (hv) {
        ui.tip = shortEffect(k);
        if (this.game.input.pressed) { this.game.input.pressed = false; this.jumpTo(id); }
      }
      y += 10;
    }
    if (kids.length > 4) { drawText(ctx, `+${kids.length - 4} more`, x + 12, y + 1, { font: 'small', color: INK3 }); }
    // branch progress just above the button
    const by = C.y + C.h - 32;
    const brow = LAYOUT.rows.find((rw) => rw.branch === sk.branch);
    const bgot = brow.tiles.filter((q) => st.skills[q.id]).length;
    drawText(ctx, `${B.name} branch`, x, by - 17, { font: 'small', color: INK3 });
    drawText(ctx, `${bgot}/${brow.tiles.length}`, x + w, by - 17, { font: 'small', color: INK3, align: 'right' });
    drawBar(ctx, x, by - 9, w, 5, bgot / brow.tiles.length, { color: vivid(B.color), back: '#c8ac80' });
    let label = 'Grow', disabled = true, tip = '';
    if (S === 'owned') { label = 'Grown!'; tip = 'Already yours!'; }
    else if (S === 'ready') { label = sk.cost ? `Grow  ${formatCommas(sk.cost)}{coin}` : 'Grow - free!'; disabled = false; tip = `Grow ${sk.name} (Enter)`; }
    else if (S === 'poor') { label = `Need ${formatCommas(sk.cost)}{coin}`; tip = `${formatCommas(Math.ceil(sk.cost - st.coins))} more coins needed`; }
    else { label = 'Locked'; tip = skillStatus(sk, st, this.found).reason; }
    const bsel = this.hoverId && this.hoverId !== this.sel;
    if (bsel && S === 'ready') { label = 'Click tile to select'; disabled = true; tip = 'Select this skill first'; }
    if (ui.button(ctx, x - 1, by, w + 2, 24, label, { style: 'coral', disabled, tip })) this.tryGrow(sk, S);
    if (this.grown && this.grown.id === sk.id) {
      this.grown.t += 1 / 60;
      if (this.grown.t > 1.4) this.grown = null;
      else drawText(ctx, 'GROWN!', x + w / 2, by - 12 - Math.round(this.grown.t * 10), { align: 'center', color: GOOD, outline: '#fff6e2' });
    }
  }

  jumpTo(id) {
    this.sel = id;
    this.fx[id] = { kind: 'pick', t: 0 };
    this.game.audio.play('ui_click', { vol: 0.6 });
    if (this.view) this.focusTile(id, this.view);
  }

  section(ctx, title, x, y, w, B) {
    drawText(ctx, title, x, y, { font: 'small', color: shade(B.color, -0.55) });
    const tw = measureText(title, 'small');
    ctx.fillStyle = rgba('#7a5a3c', 0.35);
    ctx.fillRect(x + tw + 4, y + 2, w - tw - 4, 1);
    return y + 9;
  }

  drawOverview(ctx, ui, C, status, t) {
    const st = this.game.state;
    const x = C.x + 9, w = C.w - 18;
    let y = C.y + 9;
    drawText(ctx, 'Your Coral', x, y, { scale: 2, color: INK });
    y += 20;
    for (const l of wrapText('Every skill grows from the Sharper Hook. Pick a tile to see exactly what it does.', w)) { drawText(ctx, l, x, y, { color: INK2 }); y += 10; }
    y += 4;
    ctx.fillStyle = rgba('#7a5a3c', 0.35);
    ctx.fillRect(x, y, w, 1);
    y += 6;
    for (const row of LAYOUT.rows) {
      const B = BRANCHES[row.branch];
      const got = row.tiles.filter((s) => st.skills[s.id]).length;
      const rdy = row.tiles.filter((s) => status[s.id] === 'ready').length;
      const rr = { x, y: y - 1, w, h: 18 };
      const hv = ui.hover(rr);
      drawText(ctx, B.name, x, y, { color: hv ? '#1a4a6a' : INK });
      drawText(ctx, `${got}/${row.tiles.length}`, x + w, y, { color: got === row.tiles.length ? GOOD : INK3, align: 'right' });
      if (rdy) drawText(ctx, `${rdy} ready`, x + w - 28, y + 1, { font: 'small', color: '#1a6a5a', align: 'right' });
      drawBar(ctx, x, y + 9, w, 5, got / row.tiles.length, { color: vivid(B.color), back: '#c8ac80' });
      if (hv) {
        ui.tip = `Jump to ${B.name}`;
        if (this.game.input.pressed) {
          this.game.input.pressed = false;
          const first = row.tiles.find((s) => status[s.id] === 'ready') || row.tiles.find((s) => !st.skills[s.id]) || row.tiles[0];
          this.jumpTo(first.id);
        }
      }
      y += 21;
    }
    y += 2;
    const sugg = SKILLS.filter((q) => status[q.id] === 'ready').sort((a, b) => a.cost - b.cost).slice(0, 5);
    const B0 = BRANCHES.hook;
    if (sugg.length) {
      y = this.section(ctx, 'READY TO GROW', x, y, w, B0);
      for (const q of sugg) {
        const rr = { x, y: y - 1, w, h: 10 };
        const hv = ui.hover(rr);
        ctx.drawImage(getUiIcon(q.icon || 'star'), x, y);
        drawText(ctx, q.name, x + 12, y + 1, { color: hv ? '#1a4a6a' : INK2 });
        drawText(ctx, q.cost ? `${formatCommas(q.cost)}{coin}` : 'FREE', x + w, y + 1, { color: GOOD, align: 'right' });
        if (hv) { ui.tip = shortEffect(q); if (this.game.input.pressed) { this.game.input.pressed = false; this.jumpTo(q.id); } }
        y += 10;
      }
      y += 4;
    }
    const tips = ['Wheel / + - : zoom', 'Drag / arrows : pan', 'Click twice / Enter : grow'];
    for (const l of tips) { drawText(ctx, l, x, y, { font: 'small', color: INK3 }); y += 8; }
    void t;
  }
}
