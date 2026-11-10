// Dev preview for src/gfx/lowpoly.js + src/fish/lowpolyfish.js (dist/dev/lowpoly.html): a full low-poly species
// gallery (drawn through fishrig.drawFishRig at device resolution), the far giants, and a 3D LPScene of fishMesh /
// creatureMesh models. Params: page (0..), per (species per page), ids (comma list), mode (gallery | giants | vg |
// seal | icons | scene | turn | big | perf), anim (1 = animate), scale, yaw, bg (water | dark).
import { lpAvailable, LPScene, T4, lpStats, lpDisableGL } from '../gfx/lowpoly.js';
import { SPECIES } from '../fish/species.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig, rigStats } from '../gfx/fishrig.js';
import { VoxelGiant, lpCrabFrames, lpPenguinFrames, lpRestSealFrames } from '../world/giants.js';
import { voxStats } from '../fish/voxelize.js';
import { drawSeal, warmSeal, SEAL_ANIMS } from '../gfx/seal.js';
import { setLowpolySync, creatureFrame, fishMesh, creatureMesh, addFishToScene, lowpolyStats, lpFishIcon } from '../fish/lowpolyfish.js';

export function sampleFish() { return fishMesh('pixel'); }

function background(g, W, H, dark) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  if (dark) { gr.addColorStop(0, '#0a2440'); gr.addColorStop(1, '#020812'); }
  else { gr.addColorStop(0, '#9be4ff'); gr.addColorStop(0.45, '#3aa6e0'); gr.addColorStop(1, '#0d4f8c'); }
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // soft light shafts + bubbles (Aero)
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const x = (i * 331) % W;
    const sg = g.createLinearGradient(x, 0, x + 120, H);
    sg.addColorStop(0, 'rgba(255,255,255,0.10)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 70, 0); g.lineTo(x + 260, H); g.lineTo(x + 120, H); g.fill();
  }
  g.restore();
}

export function run(params) {
  const P = (k, d) => params?.get?.(k) ?? d;
  const mode = P('mode', 'gallery');
  const W = 1920, H = 1080, Z = 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  cv.style.cssText = 'width:100vw;height:100vh;display:block';
  document.body.style.margin = '0';
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  if (P('soft', '0') === '1') lpDisableGL();
  window.__lp = lpAvailable();
  const anim = P('anim', '0') === '1';
  if (!anim) setLowpolySync(true);
  const dark = P('bg', 'water') === 'dark';
  let list = SPECIES;
  const ids = P('ids', '');
  if (ids) list = ids.split(',').map((id) => SPECIES.find((s) => s.id === id)).filter(Boolean);
  const per = Number(P('per', mode === 'big' ? 6 : 24));
  const page = Number(P('page', 0));
  if (!ids) list = list.slice(page * per, page * per + per);
  const cols = mode === 'big' ? 3 : 6;
  const items = list.map((sp) => ({ sp, c: compiled(sp.look, null, sp.id) }));
  const t0 = performance.now();
  let frameNo = 0;
  const draw = (time) => {
    background(g, W, H, dark);
    g.save();
    g.scale(Z, Z);
    const LW = W / Z, LH = H / Z;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = 'bold 9px sans-serif';
    if (mode === 'gallery' || mode === 'big') {
      const rows = Math.ceil(items.length / cols);
      const cw = LW / cols, ch = (LH - 8) / Math.max(1, rows);
      items.forEach(({ sp, c }, i) => {
        const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch / 2 + 4;
        const L = c.kind === 'chain' ? (c.chain?.segs || 14) * (c.chain?.r || 4) * 1.6 : Math.max(c.L || 30, 10), Hh = c.kind === 'chain' ? (c.chain?.r || 4) * 4 : Math.max(c.H || 12, 6);
        const sc = Number(P('scale', 0)) || Math.min((cw * 0.78) / L, (ch * 0.6) / Hh, 4);
        const t = anim ? time / 1000 : 0.15;
        drawFishRig(g, c, { x: cx, y: cy, scale: sc, facing: 1, turn: 1, time: t, swimPhase: t * 1.1, tailPhase: t * 1.7 + i * 0.13, angle: 0, pri: 3, noCull: true, yawBase: P('yaw', null) != null ? Number(P('yaw')) : undefined, inflate: P('infl', 0) * 1, mouth: P('mouth', 0) * 1 });
        g.fillText(sp.id, cx - cw / 2 + 4, cy - ch / 2 + 10);
      });
    } else if (mode === 'turn') {
      // one species through a full turn (world turn -1..1) and the swim cycle
      const { c } = items[0] || { c: compiled(SPECIES[0].look, null, SPECIES[0].id) };
      const sc = Number(P('scale', 0)) || Math.min(150 / (c.L || 30), 3);
      for (let i = 0; i < 9; i++) {
        const tau = 1 - (i / 8) * 2;
        drawFishRig(g, c, { x: 60 + i * 105, y: 120, scale: sc, facing: tau >= 0 ? 1 : -1, turn: tau, time: 0, tailPhase: 0.1, pri: 3, noCull: true });
      }
      for (let i = 0; i < 8; i++) drawFishRig(g, c, { x: 60 + i * 115, y: 300, scale: sc, facing: 1, turn: 1, time: 0, tailPhase: i / 8, pri: 3, noCull: true, angle: i === 7 ? 0.4 : 0 });
      for (let i = 0; i < 4; i++) drawFishRig(g, c, { x: 120 + i * 220, y: 450, scale: sc, facing: i % 2 ? -1 : 1, turn: 1, time: 0, tailPhase: 0.3, pri: 3, noCull: true, inflate: i === 2 ? 1 : 0, mouth: i === 3 ? 1 : 0, emotion: 'neutral' });
    } else if (mode === 'giants') {
      const kinds = ['dolphin', 'whale', 'beluga', 'orca', 'seal', 'turtle', 'shark', 'hammerhead', 'manta', 'stingray', 'crab', 'jelly', 'octopus', 'squid', 'seahorse', 'starfish'];
      kinds.forEach((k, i) => {
        const cx = (i % 4) * (LW / 4) + LW / 8, cy = Math.floor(i / 4) * (LH / 4) + LH / 8 + 6;
        const f = creatureFrame(k, { S: Z * Math.min(1.6, 190 / ({ whale: 200, dolphin: 60, beluga: 110, orca: 120, seal: 70, turtle: 60, shark: 110, hammerhead: 120, manta: 90, stingray: 60 }[k] || 30)), yaw: k === 'turtle' ? 20 : k === 'crab' ? 55 : 12, sw: anim ? Math.floor(time / 90) % 8 : 1, force: true });
        if (f) g.drawImage(f.canvas, f.sx, f.sy, f.w, f.h, cx - (f.ax * f.k) / Z, cy - (f.ay * f.k) / Z, (f.w * f.k) / Z, (f.h * f.k) / Z);
        g.fillText(k, cx - LW / 8 + 4, cy - LH / 8 + 6);
      });
    } else if (mode === 'vg') {
      // world giants through the biome API (frame(ph, dir) -> hi-res canvas drawn at world size), at game zoom 3
      g.restore(); g.save(); g.scale(3, 3);
      g.imageSmoothingEnabled = false;
      const kinds = ['dolphin', 'whale', 'turtle', 'beluga', 'seal', 'orca'];
      window.__vg = window.__vg || kinds.map((k) => new VoxelGiant(k));
      window.__vg.forEach((G, i) => {
        for (let k = 0; k < G.n; k++) G.warm();
        const f = G.frame(time / 300 + i, i % 2 ? -1 : 1);
        const x = 90 + (i % 3) * 200, y = 60 + Math.floor(i / 3) * 110;
        g.drawImage(f.canvas, Math.round(x - f.ox), Math.round(y - f.oy), f.w, f.h);
      });
      const cr = lpCrabFrames('#e0502e'), cr2 = lpCrabFrames('#f09a3a');
      [cr, cr2].forEach((F, j) => F.forEach((spr, i) => g.drawImage(spr.canvas, Math.round(120 + i * 60 + j * 220 - spr.ox), 330 - spr.oy + 1, spr.w, spr.h)));
      [...lpPenguinFrames(1), ...lpPenguinFrames(-1).slice(0, 2)].forEach((q, i) => g.drawImage(q, 40 + i * 30, 270, q.w, q.h));
      lpRestSealFrames().forEach((q, i) => g.drawImage(q, 340 + i * 45, 270, q.w, q.h));
    } else if (mode === 'seal') {
      // Bubbles, the voxel plush seal: every animation, moods, the soft-body jiggle (anim=1) and a big portrait
      const anims = Object.keys(SEAL_ANIMS);
      const moods = ['happy', 'happy', 'excited', 'happy', 'happy', 'excited', 'love', 'worried', 'excited', 'think', 'happy'];
      if (!window.__sw) { window.__sw = 1; const v0 = voxStats().ms, f0 = voxStats().faces; const t0 = performance.now(); warmSeal(56, ['point']); window.__sealPointMs = performance.now() - t0; window.__sealVox = [voxStats().ms - v0, voxStats().faces - f0]; const t1 = performance.now(); warmSeal(56, ['idle']); window.__sealIdleMs = performance.now() - t1; warmSeal(56, anims); }
      const t = anim ? time / 1000 : 0.4;
      anims.forEach((a, i) => {
        const x = 70 + (i % 6) * 110, y = 70 + Math.floor(i / 6) * 120 + (anim ? Math.sin(t * 3 + i) * 8 : 0);
        drawSeal(g, { x, y, t: t + i * 0.3, size: 56, anim: a, mood: moods[i] || 'happy', talk: i === 0 ? 0.5 + 0.5 * Math.sin(t * 18) : 0, point: [x + 80, y - 60], id: 'dv' + i, noseBubble: i === 8 ? 1 : 0 });
        g.fillText(a, x - 40, y + 50);
      });
      drawSeal(g, { x: 800, y: 380, t, size: 128, k: 1.1, anim: 'idle', mood: 'happy', talk: anim ? 0.5 + 0.5 * Math.sin(t * 9) : 0, id: 'big', view: 'front', noseBubble: 1 });
    } else if (mode === 'icons') {
      SPECIES.slice(0, 60).forEach((sp, i) => {
        const ic = lpFishIcon(sp, 64, 40);
        if (ic) g.drawImage(ic, (i % 12) * 78 + 10, Math.floor(i / 12) * 60 + 20, 64, 40);
      });
    }
    g.restore();
    if (mode === 'perf') {
      // 25 fish swimming, turning and pitching (measures the per-frame rig cost after warm-up)
      if (!window.__swim) {
        const pool = SPECIES.filter((s) => s.look?.kind !== 'chain');
        window.__swim = Array.from({ length: Number(P('n', 25)) }, (_, i) => {
          const sp = pool[(i * 13) % pool.length];
          return { c: compiled(sp.look, null, sp.id), x: 60 + ((i * 197) % 840), y: 60 + ((i * 89) % 420), vx: (i % 2 ? 1 : -1) * (18 + (i % 5) * 6), vy: ((i % 3) - 1) * 6, turn: i % 2 ? 1 : -1, ph: i * 0.17, sc: 0.8 + (i % 4) * 0.25 };
        });
        window.__perf = { frames: 0, ms: 0, max: 0 };
      }
      const dt = 1 / 60;
      const tA = performance.now();
      const sh0 = lowpolyStats().sheets + lowpolyStats().poses;
      for (const f of window.__swim) {
        f.x += f.vx * dt; f.y += f.vy * dt; f.ph += dt * 2;
        if (f.x < 30 || f.x > 930) f.vx = -f.vx;
        if (f.y < 30 || f.y > 510) f.vy = -f.vy;
        const face = f.vx > 0 ? 1 : -1;
        f.turn += (face - f.turn) * 0.08;
        drawFishRig(g, f.c, { x: f.x, y: f.y, scale: f.sc, facing: face, turn: Math.abs(f.turn) < 0.15 ? face * 0.15 : f.turn, angle: Math.atan2(f.vy, Math.abs(f.vx) + 6), tailPhase: f.ph, swimPhase: f.ph * 0.6, time: f.ph, pri: 1 });
      }
      const dA = performance.now() - tA;
      const built = lowpolyStats().sheets + lowpolyStats().poses !== sh0;
      if (time > 4000) { const q = window.__perf; q.frames++; q.ms += dA; q.max = Math.max(q.max, dA); q.avg = q.ms / q.frames; if (!built) { q.sf = (q.sf || 0) + 1; q.sms = (q.sms || 0) + dA; q.steady = q.sms / q.sf; q.smax = Math.max(q.smax || 0, dA); } }
    }
    if (mode === 'scene') {
      const sc = new LPScene(W, H);
      const ph = anim ? time / 1000 : 0.2;
      const show = (ids ? list : SPECIES.filter((s) => ['pixel', 'koi', 'clown', 'bruce', 'puffer', 'lionfish', 'betta', 'angel', 'thief', 'manyeyes'].includes(s.id)));
      show.forEach((sp, i) => {
        const m = fishMesh(sp, null, { phase: ph * 1.5 + i * 0.1 });
        if (!m) return;
        const s = 2.2 / m.L;
        addFishToScene(sc, m, T4.trs([((i % 5) - 2) * 2.6, 1.3 - Math.floor(i / 5) * 2.4, -Math.floor(i / 5) * 1.5], 0, 0.5 - (i % 3) * 0.45, 0, s), { fog: 0.4, fogColor: '#3a9ad0' });
      });
      const d = creatureMesh('dolphin', { phase: ph });
      if (d) addFishToScene(sc, d, T4.trs([0, -2.8, -3], 0, 0.9, 0, 4 / d.L));
      const tt = creatureMesh('turtle', { phase: ph });
      if (tt) addFishToScene(sc, tt, T4.trs([-4.5, -2.6, -2], 0.2, 0.6, 0, 2.4 / tt.L));
      sc.camera({ eye: [0, 0.6, 9], target: [0, -0.4, 0], fov: 50 });
      const out = sc.render({ background: [0, 0, 0, 0], light: [-0.4, 0.8, 0.5], sky: '#f2fdff', ground: '#2a6a9a', fog: 0.25, fogColor: '#3a9ad0' });
      if (out) g.drawImage(out, 0, 0);
    }
    window.__stats = { rig: rigStats(), lp: lowpolyStats(), gl: lpStats(), vox: voxStats(), ms: performance.now() - t0 };
    frameNo++;
  };
  if (mode === 'perf') setLowpolySync(false);
  if (anim || mode === 'perf') {
    const loop = (t) => { draw(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__done = true;
  } else {
    draw(0);
    window.__done = true;
  }
}
