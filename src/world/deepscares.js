// [deep28] More life (and more fright) in the deep, on top of deepsea.js's eyes, giants and scares. Owned by DeepSea
// (`deep.scares`), updated from updateScary and drawn from its passes. Everything is capped (two schools, one
// tentacle, one ambush, one pack, one big eye) and reuses its objects: no per-frame allocations.
//   schools   little flocks of creepy glowing fish (photophore dots and pairs of eyeshine) crossing the dark
//             (midnight / abyss / hadal), drawn in the glow pass
//   tentacle  a giant squid's arm drifting across the far dark, a voxel silhouette with a cold rim and pale suckers,
//             kept out of the hook's light pool
//   ambush    a bobbit worm bursts out of the floor beside the hook and snaps, or a lizardfish darts up from the
//             floor at it (abyss floor only, the hook near the bottom)
//   pack      a Humboldt squid pack races past the hook, flickering red (midnight / twilight)
//   bigeye    the rare jump scare: a huge voxel eye opens right behind the hook, its slit pupil tightening and
//             tracking the hook, blinks once and fades back into the dark (abyss / hadal)
// Ambushes, packs and the big eye are 'scares': Settings > Deep scares (state.settings.deepScares) turns them off;
// the calm setting softens shakes. The quieter ambience (schools, tentacle) always runs.

import { clamp, clamp01, lerp, smoothstep, hash2, bayer, TAU } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawGlow } from './scenery.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { hadalY } from './depthzones.js';

const SCHOOL_MAX = 2, SCHOOL_N = 16;
const TENT_SEGS = 34;

// ------------------------------------------------------------------ the big eye (voxel sprites, built once)
const EYE = { W: 184, H: 102, A: 58, B: 25, OUT: 1.55 }; // canvas size, eye opening half-axes, skin reach (world px)
let eyeArt = null;
function paint(w, h, fn) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  const img = g.createImageData(w, h), d = new Uint32Array(img.data.buffer);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fn(x, y); if (v) d[y * w + x] = v; }
  g.putImageData(img, 0, 0);
  return c;
}
const pk = (r, g, b, a = 255) => ((a << 24) | (clamp(Math.round(b), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(r), 0, 255)) >>> 0;
const hx = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// a 2 px voxel block: bevelled (lit top-left, shaded bottom-right)
function block(col, x, y, k = 1) {
  const ix = x & 1, iy = y & 1;
  const s = iy === 0 && ix === 0 ? 1.22 : iy === 0 ? 1.12 : ix === 1 && iy === 1 ? 0.78 : 0.95;
  return pk(col[0] * s * k, col[1] * s * k, col[2] * s * k);
}
// the opening's half-height at x (an almond), times `open`
const lidH = (x, open) => EYE.B * open * Math.pow(Math.max(0, 1 - (x / EYE.A) ** 2), 0.75);
function buildEye() {
  const { W, H, A, B } = EYE, cx = W / 2, cy = H / 2;
  const IR = B * 1.02; // iris radius
  const ir0 = hx('#fff2a0'), ir1 = hx('#ffb830'), ir2 = hx('#c8501a'), ring = hx('#2a0e06');
  // the eyeball: a glowing golden iris with radial streaks over a dark red-brown sclera
  const ball = paint(W, H, (px, py) => {
    const bx = px & ~1, by = py & ~1;
    const x = bx + 1 - cx, y = by + 1 - cy, r = Math.hypot(x, y);
    if (Math.abs(x) > A + 2 || Math.abs(y) > B + 2) return 0;
    if (r < IR) {
      const k = r / IR, a = Math.atan2(y, x);
      let c = k < 0.5 ? mixc(ir0, ir1, k / 0.5) : k < 0.86 ? mixc(ir1, ir2, (k - 0.5) / 0.36) : mixc(ir2, ring, (k - 0.86) / 0.14);
      if (Math.abs(Math.sin(a * 11 + k * 3)) < 0.16 && k > 0.3 && k < 0.88) c = mixc(c, ir0, 0.35);
      if (hash2(bx >> 1, by >> 1, 5) > 0.86 && k > 0.4) c = mixc(c, ring, 0.25);
      return block(c, px, py);
    }
    const sc = mixc(hx('#3a1820'), hx('#14080c'), clamp01((r - IR) / (A - IR)));
    if (Math.abs(Math.sin(Math.atan2(y, x) * 7 + r * 0.3)) < 0.05) return block(mixc(sc, hx('#6a1a20'), 0.6), px, py);
    return block(sc, px, py);
  });
  // slit pupils, wide -> narrow (drawn centred on the eye, offset as it tracks)
  const PH = Math.ceil(IR * 2 + 2) & ~1;
  const pupils = [10, 6, 3].map((pw) => paint(24, PH, (px, py) => {
    const x = (px & ~1) + 1 - 12, y = (py & ~1) + 1 - PH / 2;
    const w = pw * Math.sqrt(Math.max(0, 1 - (y / (IR * 0.92)) ** 2));
    return Math.abs(x) < w ? block([10, 4, 10], px, py) : 0;
  }));
  // lids + the skin around the eye at openness steps 0..7 (the skin dithers out into the dark)
  const skin = hx('#1c1620'), lid = hx('#2a2230'), wet = hx('#6a5868');
  const lids = [];
  for (let s = 0; s < 8; s++) {
    const open = s / 7;
    lids.push(paint(W, H, (px, py) => {
      const bx = px & ~1, by = py & ~1;
      const x = bx + 1 - cx, y = by + 1 - cy;
      const ox = x / (A * EYE.OUT), oy = y / (B * EYE.OUT * 1.25);
      const ro = Math.hypot(ox, oy);
      if (ro > 1) return 0;
      const h = lidH(x, open);
      if (Math.abs(y) < h && Math.abs(x) < A) return 0; // the opening
      // fade into the dark: ordered-dither the outer blocks away
      if (ro > 0.62 && (ro - 0.62) / 0.38 > bayer(bx >> 1, by >> 1)) return 0;
      const edge = Math.abs(x) < A && Math.abs(Math.abs(y) - h) < 2.5;
      let c = edge ? wet : Math.abs(y) < h + 7 && Math.abs(x) < A + 3 ? lid : skin;
      if (!edge && hash2(bx >> 1, by >> 1, 9) > 0.8) c = mixc(c, hx('#3a2e3c'), 0.6); // scales
      if (!edge && y < 0 && Math.abs(y) < h + 7 && Math.abs(x) < A) c = mixc(c, hx('#4a3a48'), 0.35); // the upper lid's sheen
      return block(c, px, py, 1 - ro * 0.35);
    }));
  }
  return { ball, pupils, lids, IR };
}

// ------------------------------------------------------------------ DeepScares
export class DeepScares {
  constructor(D) {
    this.D = D;
    this.schools = [];
    for (let i = 0; i < SCHOOL_MAX; i++) this.schools.push({ on: false, m: new Float32Array(SCHOOL_N * 3) });
    this.schoolT = 6;
    this.tent = { on: false, x: 0, y: 0, dir: 1, t: 0, dur: 14, s: 1 };
    this.tentT = 25;
    this.tentPts = new Float32Array((TENT_SEGS + 1) * 2);
    this.amb = null; this.ambT = 14; this.nearFloorT = 0;
    this.pack = null; this.packT = 30;
    this.eye = null;
    this.warm = { amb: null, ambSp: null, pack: null, t: 0 };
  }

  get game() { return this.D.game; }
  scaresOn() { return this.game.state?.settings?.deepScares !== false; }

  // ------------------------------------------------------------------ update
  update(dt, v, deep, h, busy, reduced) {
    const D = this.D, L = D.L, cy = (v.y0 + v.y1) / 2;
    const hadal = deep === 'abyss' && cy >= hadalY(L);
    const zone = hadal ? 'hadal' : deep;
    const scares = this.scaresOn();
    this.updateSchools(dt, v, zone);
    this.updateTentacle(dt, v, zone, busy);
    // creatures for the ambush / pack: kept warm (their voxel frames build ahead) while you are down there
    const W = this.warm;
    W.t -= dt;
    const floorY = h?.visible ? D.floorAt(clamp(h.x, 0, D.W), 0.05) : Infinity;
    const nearFloor = !!h?.visible && deep === 'abyss' && h.y > floorY - 120;
    if (W.t <= 0 && scares) {
      W.t = 0.7;
      if (deep === 'abyss' && h?.visible && h.y > floorY - 260 && !W.amb) {
        const id = Math.random() < 0.55 ? 'bobbit' : 'lizardfish';
        W.amb = this.creature(id, id === 'bobbit' ? 64 : 80);
      }
      if ((deep === 'midnight' || deep === 'twilight') && !W.pack) W.pack = this.creature('humboldt', 46);
      // a bobbit rears up to the hook: keep its warm frames at the size it will strike at
      if (W.amb?.sp.id === 'bobbit' && h?.visible) { W.amb.len = clamp((floorY - h.y + 18) / 0.68, 60, 210); W.amb.f.scale = W.amb.len / W.amb.base; }
      if (W.amb) D.warmUp(W.amb, v);
      if (W.pack) D.warmUp(W.pack, v);
    }
    // the floor ambush
    this.nearFloorT = nearFloor ? this.nearFloorT + dt : 0;
    if (this.amb) this.updateAmbush(dt);
    else {
      this.ambT -= dt * (nearFloor ? 1 : 0.25);
      if (this.ambT <= 0 && nearFloor && this.nearFloorT > 2 && scares && !busy && W.amb) {
        this.ambT = (hadal ? 16 : 24) + Math.random() * 22;
        this.startAmbush(h, v, floorY, reduced);
      }
    }
    // the Humboldt pack
    if (this.pack) this.updatePack(dt, v);
    else {
      this.packT -= dt;
      if (this.packT <= 0 && (deep === 'midnight' || deep === 'twilight') && scares && !busy && W.pack) {
        this.packT = 35 + Math.random() * 40;
        this.startPack(h, v);
      }
    }
    if (this.eye) { this.eye.t += dt; if (this.eye.t > this.eye.dur) this.eye = null; }
  }

  creature(id, want) {
    const sp = SPECIES_BY_ID[id];
    if (!sp) return null;
    let f;
    try { f = this.D.makeCreature(sp); } catch (e) { this.D.fail(e); return null; }
    const len = Math.max(sp.look.body?.len || 40, (sp.look.body?.h || 30) * 0.8);
    f.scale = want / len; f.z = 0.05;
    return { f, sp, len: want, base: len };
  }

  // ---- schools: a flock of little glowing / eyeshine fish crossing the view
  updateSchools(dt, v, zone) {
    const on = zone === 'midnight' || zone === 'abyss' || zone === 'hadal';
    for (const s of this.schools) {
      if (!s.on) continue;
      s.t += dt; s.x += s.dir * s.v * dt;
      if ((s.dir > 0 && s.x - 90 > v.x1 + 40) || (s.dir < 0 && s.x + 90 < v.x0 - 40) || !on) s.on = false;
    }
    this.schoolT -= dt;
    if (this.schoolT > 0 || !on) return;
    this.schoolT = (zone === 'hadal' ? 7 : zone === 'abyss' ? 9 : 13) + Math.random() * 12;
    const s = this.schools.find((q) => !q.on);
    if (!s) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    s.on = true; s.t = 0; s.dir = dir;
    s.x = dir > 0 ? v.x0 - 80 : v.x1 + 80;
    s.y = lerp(v.y0 + 24, v.y1 - 24, Math.random());
    s.v = 26 + Math.random() * 22;
    s.kind = Math.random() < (zone === 'midnight' ? 0.35 : 0.55) ? 'eyes' : 'lights';
    const glow = this.D.L.def.glow;
    s.col = s.kind === 'eyes' ? (Math.random() < 0.5 ? '#ffe86a' : '#9affd0') : glow[Math.floor(Math.random() * glow.length)];
    s.n = 10 + Math.floor(Math.random() * (SCHOOL_N - 9));
    for (let i = 0; i < s.n; i++) {
      s.m[i * 3] = -Math.random() * 80 * (i / s.n + 0.2); // trailing behind the lead
      s.m[i * 3 + 1] = (Math.random() - 0.5) * 34;
      s.m[i * 3 + 2] = Math.random() * TAU;
    }
  }

  // ---- the tentacle drifting across the far dark
  updateTentacle(dt, v, zone, busy) {
    const T = this.tent;
    if (T.on) {
      T.t += dt;
      T.x += T.dir * 16 * dt;
      if (T.t > T.dur || !(zone === 'midnight' || zone === 'abyss' || zone === 'hadal')) T.on = false;
      return;
    }
    this.tentT -= dt;
    if (this.tentT > 0 || busy || !(zone === 'midnight' || zone === 'abyss' || zone === 'hadal')) return;
    this.tentT = 45 + Math.random() * 50;
    T.on = true; T.t = 0; T.dur = 13 + Math.random() * 5;
    T.dir = Math.random() < 0.5 ? 1 : -1;
    T.x = T.dir > 0 ? v.x0 - 30 : v.x1 + 30;
    T.y = lerp(v.y0 + 20, v.y1 - 40, Math.random());
    T.s = 0.9 + Math.random() * 0.5;
    this.game.audio?.play?.('whale_call', { vol: 0.18, pitch: 0.22, pan: -T.dir * 0.5 });
  }

  // ---- the floor ambush
  startAmbush(h, v, floorY, reduced) {
    const W = this.warm, c = W.amb;
    W.amb = null;
    const side = Math.random() < 0.5 ? -1 : 1;
    const f = c.f, id = c.sp.id;
    if (id === 'bobbit') {
      const x = clamp(h.x + side * (26 + Math.random() * 14), v.x0 + 20, v.x1 - 20);
      const y = this.D.floorAt(clamp(x, 0, this.D.W), 0.05) + 2;
      // it rears up to the hook's height (the worm is about 0.68 of its model length tall)
      const want = clamp((y - h.y + 18) / 0.68, 60, 210);
      f.scale = want / c.base;
      this.amb = { id, f, t: 0, dur: 1.7, x, y, side, len: want * 0.68, hy: h.y };
      f.facing = -side; f.turn = -side;
      this.game.audio?.play?.('worm_squish', { vol: 0.5, pitch: 0.5 });
    } else {
      const x = clamp(h.x - side * 90, v.x0 - 40, v.x1 + 40);
      const y0 = this.D.floorAt(clamp(x, 0, this.D.W), 0.05) - 6;
      this.amb = { id, f, t: 0, dur: 1.6, x, y: y0, x0: x, y0, tx: h.x + side * 24, ty: h.y, side, len: c.len };
      f.facing = side; f.turn = side;
      this.game.audio?.play?.('net_swish', { vol: 0.45, pitch: 0.6 });
    }
    f.x = this.amb.x; f.y = this.amb.y; f.alpha = 1;
    this.game.camera?.shake?.(reduced ? 0.5 : 2);
  }

  updateAmbush(dt) {
    const A = this.amb, f = A.f;
    A.t += dt;
    const t = A.t;
    if (A.id === 'bobbit') {
      // out of the floor (0.18 s), snap twice, sink back
      A.rise = t < 0.18 ? t / 0.18 : t < 1.15 ? 1 : 1 - clamp01((t - 1.15) / 0.5);
      f.x = A.x; f.y = A.y + (1 - A.rise) * A.len * 1.1;
      if (t > 0.16 && !A.snapped) { A.snapped = true; this.game.audio?.play?.('bite', { vol: 0.55, pitch: 0.55 }); }
      if (t > 0.7 && !A.snap2) { A.snap2 = true; this.game.audio?.play?.('bite', { vol: 0.4, pitch: 0.5 }); }
      f.swimPhase = (f.swimPhase || 0) + dt * (t < 1.15 ? 2.6 : 0.4); // the jaws scissor open and shut
      f.chompT = t < 1.15 ? 0.2 : 0;
    } else {
      // a dart up from the floor through the hook's spot, then back down to the floor and away
      const k1 = clamp01(t / 0.34), k2 = clamp01((t - 0.5) / 1.0);
      const px = t < 0.5 ? lerp(A.x0, A.tx + A.side * 26, k1 * k1 * (3 - 2 * k1)) : lerp(A.tx + A.side * 26, A.tx + A.side * 140, k2);
      const py = t < 0.5 ? lerp(A.y0, A.ty, Math.sin(k1 * Math.PI * 0.5)) : lerp(A.ty, A.y0 + 10, k2);
      f.vx = (px - f.x) / Math.max(1e-3, dt); f.vy = (py - f.y) / Math.max(1e-3, dt);
      f.x = px; f.y = py;
      f.forceAngle = clamp(Math.atan2(f.vy, Math.abs(f.vx) + 1) * 0.6, -0.6, 0.6);
      f.chompT = t < 0.7 ? 0.25 : 0;
      f.alpha = 1 - clamp01((t - 1.25) / 0.35);
      if (t > 0.3 && !A.snapped) { A.snapped = true; this.game.audio?.play?.('bite', { vol: 0.5, pitch: 0.7 }); }
    }
    f.age = (f.age || 0) + dt;
    try { f.animate?.(dt); } catch { /* rig not ready */ }
    if (t > A.dur) this.amb = null;
  }

  // ---- the Humboldt pack
  startPack(h, v) {
    const W = this.warm, c = W.pack;
    W.pack = null;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const n = 4 + Math.floor(Math.random() * 3);
    const y = h?.visible ? clamp(h.y + (Math.random() - 0.5) * 70, v.y0 + 30, v.y1 - 30) : lerp(v.y0 + 40, v.y1 - 40, Math.random());
    const mem = [];
    for (let i = 0; i < n; i++) {
      const f = i === 0 ? c.f : this.D.makeCreature(c.sp);
      f.scale = c.f.scale; f.z = 0.18; // one scale: the whole pack shares one sprite sheet
      f.facing = dir; f.turn = dir;
      mem.push({ f, dx: -i * (36 + Math.random() * 20) - Math.random() * 20, dy: (Math.random() - 0.5) * 50, ph: Math.random() * TAU, fl: 0 });
    }
    this.pack = { mem, dir, x: dir > 0 ? v.x0 - 60 : v.x1 + 60, y, v: 150 + Math.random() * 40, t: 0 };
    this.game.audio?.play?.('travel_whoosh', { vol: 0.35, pitch: 1.4, pan: -dir * 0.6 });
    this.game.audio?.play?.('click', { vol: 0.3, pitch: 0.8 });
  }

  updatePack(dt, v) {
    const P = this.pack;
    P.t += dt;
    P.x += P.dir * P.v * dt;
    let any = false;
    for (const m of P.mem) {
      const f = m.f;
      f.x = P.x + P.dir * m.dx; f.y = P.y + m.dy + Math.sin(P.t * 5 + m.ph) * 4;
      f.vx = P.dir * P.v; f.vy = 0;
      m.fl = Math.max(0, Math.sin(P.t * 9 + m.ph * 3)) ** 3; // red flicker
      f.age = (f.age || 0) + dt;
      try { f.animate?.(dt); } catch { /* rig not ready */ }
      if ((P.dir > 0 && f.x < v.x1 + 80) || (P.dir < 0 && f.x > v.x0 - 80)) any = true;
    }
    if (!any || P.t > 8) this.pack = null;
  }

  // ---- the big eye (DeepSea.startScare picks it)
  startEye(h, v, reduced) {
    const side = h.x > (v.x0 + v.x1) / 2 ? -1 : 1;
    this.eye = { t: 0, dur: 4.4, x: h.x + side * 10, y: h.y - 8, side };
    eyeArt ||= buildEye();
    const a = this.game.audio;
    a?.play?.('whale_call', { vol: 0.42, pitch: 0.2 });
    a?.play?.('thunder', { vol: 0.3, pitch: 0.24 });
    this.game.camera?.shake?.(reduced ? 0.6 : 2.4);
    return true;
  }

  eyeK() {
    const E = this.eye;
    if (!E) return 0;
    return Math.min(clamp01(E.t / 0.3), clamp01((E.dur - E.t) / 0.8));
  }

  // lights for the lighting pass (DeepSea.light)
  addLights(out) {
    const E = this.eye;
    if (E) out.push({ x: E.x, y: E.y, r: 64, color: '#ffc84a', a: 0.4 * this.eyeK() });
    const P = this.pack;
    if (P) for (const m of P.mem) if (m.fl > 0.4) out.push({ x: m.f.x, y: m.f.y, r: 22, color: '#ff3a3a', a: 0.35 * m.fl });
  }

  // ------------------------------------------------------------------ drawing
  // after the darkness pass (DeepSea.drawGlowPass): schools, the tentacle, the big eye
  drawGlow(ctx, v, t, hook) {
    this.drawTentacle(ctx, v, t, hook);
    for (const s of this.schools) if (s.on) this.drawSchool(ctx, s, t);
    if (this.eye) this.drawEye(ctx, t, hook);
  }

  drawSchool(ctx, s, t) {
    const a = clamp01(s.t / 1.2);
    for (let i = 0; i < s.n; i++) {
      const ph = s.m[i * 3 + 2];
      const x = Math.round(s.x + s.dir * s.m[i * 3] + Math.sin(t * 1.7 + ph) * 3);
      const y = Math.round(s.y + s.m[i * 3 + 1] + Math.sin(t * 2.3 + ph + s.x * 0.02) * 4);
      const blink = Math.sin(t * 1.3 + ph * 5) > 0.93;
      if (s.kind === 'eyes') {
        // only their eyes catch the light: a pair of tiny glints (the far eye a little dimmer)
        if (blink) continue;
        ctx.globalAlpha = a * 0.95; ctx.fillStyle = s.col;
        ctx.fillRect(x, y, 1, 1);
        ctx.globalAlpha = a * 0.55; ctx.fillRect(x - s.dir * 2, y, 1, 1);
        if ((i & 3) === 0) drawGlow(ctx, x, y, 3, s.col, a * 0.35);
      } else {
        // a dark sliver of a body with a glowing photophore row
        ctx.globalAlpha = a * 0.55; ctx.fillStyle = '#0a0c16';
        ctx.fillRect(x - (s.dir > 0 ? 4 : 0), y - 1, 5, 2);
        ctx.globalAlpha = a * (blink ? 0.2 : 0.95); ctx.fillStyle = s.col;
        ctx.fillRect(x - s.dir * 1, y + 1, 1, 1); ctx.fillRect(x - s.dir * 3, y + 1, 1, 1);
        if ((i & 1) === 0 && !blink) drawGlow(ctx, x - s.dir * 2, y + 1, 3, s.col, a * 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawTentacle(ctx, v, t, hook) {
    const T = this.tent;
    if (!T.on) return;
    const a = Math.min(clamp01(T.t / 2.5), clamp01((T.dur - T.t) / 2.5));
    if (a < 0.02) return;
    // the arm: from off-screen root (behind the view edge) curling in and out, thick to thin
    const P = this.tentPts, n = TENT_SEGS;
    const len = 210 * T.s;
    let x = T.x - T.dir * 30, y = T.y + 30, ang = -T.dir * 0.2 + (T.dir < 0 ? Math.PI : 0);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      P[i * 2] = x; P[i * 2 + 1] = y;
      ang += (Math.sin(t * 0.7 - k * 4 + T.s * 3) * 0.16 + k * k * 0.25 * Math.sin(t * 0.5)) * (T.dir > 0 ? 1 : -1);
      x += Math.cos(ang) * len / n; y += Math.sin(ang) * len / n - 0.6;
    }
    const hx0 = hook?.visible ? hook.x : -1e9, hy0 = hook?.visible ? hook.y : -1e9;
    for (let i = 0; i <= n; i++) {
      const k = i / n, px = P[i * 2], py = P[i * 2 + 1];
      if (px < v.x0 - 20 || px > v.x1 + 20 || py < v.y0 - 20 || py > v.y1 + 20) continue;
      const near = Math.hypot(px - hx0, py - hy0);
      const fade = a * clamp01((near - 40) / 40); // it passes behind what the hook's light shows
      if (fade < 0.03) continue;
      const r = Math.max(1, Math.round(lerp(9, 2, k) * T.s));
      const X = Math.round(px - r), Y = Math.round(py - r);
      ctx.globalAlpha = fade * 0.95; ctx.fillStyle = '#05040a';
      ctx.fillRect(X, Y, r * 2, r * 2);
      ctx.globalAlpha = fade * 0.5; ctx.fillStyle = '#3a5a86';
      ctx.fillRect(X, Y, r * 2, 1); // cold rim on top
      if (i % 2 === 0 && r > 2) { ctx.globalAlpha = fade * 0.45; ctx.fillStyle = '#c8b8c8'; ctx.fillRect(X + r - 1, Y + r * 2 - 2, 2, 1); } // suckers underneath
    }
    ctx.globalAlpha = 1;
  }

  drawEye(ctx, t, hook) {
    const E = this.eye, art = eyeArt;
    if (!art) return;
    const k = this.eyeK();
    if (k < 0.02) return;
    // lids: open slowly, wide, one blink, then close as it fades
    let open = E.t < 1.1 ? smoothstep(0, 1.1, E.t) * 0.95 : E.t > E.dur - 1.2 ? 0.95 * (1 - smoothstep(E.dur - 1.2, E.dur - 0.2, E.t)) : 0.95;
    if (E.t > 2.55 && E.t < 2.8) open *= Math.abs(Math.cos((E.t - 2.55) / 0.25 * Math.PI)) * 0.9 + 0.1;
    const step = clamp(Math.round(open * 7), 0, 7);
    const x0 = Math.round(E.x - EYE.W / 2), y0 = Math.round(E.y - EYE.H / 2);
    drawGlow(ctx, E.x, E.y, 50, '#ffb83a', 0.3 * k * open);
    ctx.globalAlpha = k;
    ctx.drawImage(art.ball, x0, y0);
    // the slit pupil: wide when it opens, tightening in the light; it follows the hook
    const pi = E.t < 1.4 ? 0 : E.t < 2.1 ? 1 : 2;
    const pu = art.pupils[pi];
    const lx = hook?.visible ? clamp((hook.x - E.x) * 0.5, -EYE.A * 0.35, EYE.A * 0.35) : 0;
    const ly = hook?.visible ? clamp((hook.y - E.y) * 0.3, -3, 3) : 0;
    ctx.drawImage(pu, Math.round(E.x - pu.width / 2 + lx) & ~1, Math.round(E.y - pu.height / 2 + ly) & ~1);
    ctx.fillStyle = '#fffbe8';
    ctx.globalAlpha = k * 0.85;
    ctx.fillRect(Math.round(E.x - 16 + lx * 0.3) & ~1, Math.round(E.y - 13) & ~1, 6, 4); // catchlight
    ctx.globalAlpha = k;
    ctx.drawImage(art.lids[step], x0, y0);
    ctx.globalAlpha = 1;
  }

  // after the lighting pass (DeepSea.drawFrontDeep): the ambush and the pack, darkened by the zone's light
  drawFront(ctx, v, t, L) {
    const g = this.game, oc = g.ocean;
    const W = this.washO || (this.washO = { color: '#05060c', alpha: 0 });
    const wash = (x, y) => {
      const lit = L && oc?.lightAt ? oc.lightAt(x, y, L) : 0.5;
      W.color = L?.tint || '#05060c'; W.alpha = clamp01((1 - lit) * 0.75);
      return W;
    };
    const A = this.amb;
    if (A) {
      const f = A.f;
      if (A.id === 'bobbit') {
        ctx.save();
        ctx.beginPath(); ctx.rect(A.x - 120, A.y - 260, 240, 262); ctx.clip(); // only what is above the floor shows
        f.draw(ctx, wash(f.x, f.y - A.len * 0.5), t);
        ctx.restore();
      } else f.draw(ctx, wash(f.x, f.y), t);
    }
    const P = this.pack;
    if (P) {
      for (const m of P.mem) {
        const f = m.f;
        if (f.x < v.x0 - 80 || f.x > v.x1 + 80) continue;
        if (m.fl > 0.05) drawGlow(ctx, f.x, f.y, 16, '#ff2a3a', 0.45 * m.fl);
        const w = wash(f.x, f.y);
        if (m.fl > 0.3) { w.color = '#ff3a48'; w.alpha = 0.35 * m.fl; } else w.alpha = Math.max(0.45, w.alpha);
        f.draw(ctx, w, t);
      }
    }
  }
}
