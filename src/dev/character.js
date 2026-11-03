// Dev preview of the voxel fisherman: dist/dev/character.html
//   ?view=all|poses|outfits|big|wardrobe|npcs|small|boats (&tier=N &parts=json)  &t=seconds (freeze time)  &yaw=deg (big turntable)  &scale=N (big)
//   &pose=idle (big)  &look=json  &budget=ms (frame build budget; default unlimited here)
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { drawCharacter, DEFAULT_CHARACTER, POSE_NAMES, characterStats, setCharacterBudget, normalizeLook, WARDROBE, boatPaint, warmCharacter, PROF } from '../gfx/character.js';
import { compiled } from '../gfx/spritecache.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { getUiIcon, registerUiIcons, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { defaultState } from '../game/state.js';
import { computeStats } from '../game/skills.js';
import { UI } from '../ui/ui.js';
import { WardrobePanel, drawWardrobeIcon } from '../ui/wardrobe.js';
import { SPECIES } from '../fish/species.js';
import { NPCS, drawNPC } from '../gfx/npcs.js';
import { BOAT_TIERS, renderBoatPreview, BOAT_PARTS } from '../world/boatmodels.js';

const LOOKS = [
  { ...DEFAULT_CHARACTER },
  { tint: 'mint', eyes: 'sparkle', mouth: 'grin', hat: 'headphones', hair: 'none', face: 'none', top: 'hoodie', bottom: 'jeans', gloves: 'none', shoes: 'hightops', back: 'satchel', rod: 'wand' },
  { tint: 'rose', eyes: 'anime', mouth: 'cat', hat: 'flower', hair: 'none', face: 'blush', top: 'sailor', bottom: 'skirt', gloves: 'mitts', shoes: 'slippers', back: 'wings', rod: 'coral', trail: 'hearts' },
  { tint: 'chrome', eyes: 'led', mouth: 'smirk', hat: 'none', hair: 'antenna', face: 'visor', top: 'astro', bottom: 'astro', gloves: 'chrome', shoes: 'moon', back: 'jetpack', rod: 'neon' },
  { tint: 'globe', eyes: 'bean', mouth: 'smile', hat: 'leafcrown', hair: 'none', face: 'flare', top: 'leafy', bottom: 'cargo', gloves: 'garden', shoes: 'sandals', back: 'globe', rod: 'leafy', trail: 'leaves' },
  { tint: 'lemon', eyes: 'star', mouth: 'beam', hat: 'propeller', hair: 'none', face: 'freckles', top: 'jersey', bottom: 'shorts', gloves: 'rubber', shoes: 'boots', back: 'turbine', rod: 'candy', trail: 'sparkle' },
  { tint: 'pearl', eyes: 'teary', mouth: 'o', hat: 'none', hair: 'bun', face: 'round', top: 'aquasuit', bottom: 'aquasuit', gloves: 'none', shoes: 'flippers', back: 'tank', rod: 'prism', trail: 'bubbles' },
  { tint: 'gold', eyes: 'heart', mouth: 'kiss', hat: 'crown', hair: 'none', face: 'heart', top: 'tux', bottom: 'jeans', gloves: 'gold', shoes: 'hightops', back: 'solar', rod: 'golden' },
  { tint: 'galaxy', eyes: 'swirl', mouth: 'wobbly', hat: 'none', hair: 'halo', face: 'none', top: 'puffer', bottom: 'leggings', gloves: 'boxing', shoes: 'jet', back: 'cape', rod: 'chrome', trail: 'rainbow' },
  { tint: 'lilac', eyes: 'derp', mouth: 'tongue', hat: 'none', hair: 'ears', face: 'mustache', top: 'raincoat', bottom: 'swim', gloves: 'none', shoes: 'sneakers', back: 'none', rod: 'auto', trail: 'notes' },
];

// Stub game hosting the wardrobe panel (&coins=N &slot=hat &rich: owns lots).
function runWardrobe(params, cv) {
  const W = Number(params.get('w')) || 960, H = Number(params.get('h')) || 540;
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  registerUiIcons();
  const st = defaultState();
  st.coins = Number(params.get('coins') ?? 2400);
  st.journal = { parrot: { seen: true, caught: 2 } };
  if (params.has('rich')) { st.skills = { hook6: true, reel3: true }; st.cosmetics = { hat_crown: true, acc_earring: true, outfit_astronaut: true }; }
  if (params.get('look')) try { st.character = JSON.parse(params.get('look')); } catch { /* ignore */ }
  const listeners = {};
  const g = {
    params, canvas: cv, screen: { W, H, scale: 2 }, state: st, audio, particles: new Particles(900), time: 0,
    fishing: { fighting: false }, stats: computeStats(st.skills),
    on(ev, fn) { (listeners[ev] ||= []).push(fn); }, emit(ev, d) { for (const f of listeners[ev] || []) f(d); },
    save() {}, toast(text, icon) { g.ui.toast(text, icon); },
    spendCoins(n) { if (st.coins < n) { audio.play('ui_error'); return false; } st.coins -= n; return true; },
  };
  const toLogical = (cx, cy) => { const r = cv.getBoundingClientRect(); return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H]; };
  g.input = new Input(cv, toLogical);
  g.ui = new UI(g);
  g.ui.register(new WardrobePanel());
  window.FISHTOP = g;
  g.ui.open('wardrobe', { slot: params.get('slot') || 'hat' });
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    g.time += dt;
    const tf0 = performance.now();
    try {
      g.input.update(dt);
      g.ui.update(dt);
      g.particles.update(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#3aa0c0'); grd.addColorStop(1, '#123a5a');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
      g.ui.tip = null;
      if (!g.ui.stack.length && g.input.pressed) { g.input.pressed = false; g.ui.open('wardrobe'); }
      g.ui.drawPanels(ctx, dt);
      g.particles.draw(ctx, 'ui', g.time);
      g.ui.drawToasts(ctx);
      g.ui.drawTip(ctx);
      const st2 = characterStats();
      drawText(ctx, `${st.coins} coins  frames ${st2.frames} built ${st2.built} (${st2.avgMs} ms)`, 6, H - 10, { font: 'small', color: '#ffffff', shadow: '#000000' });
      const cur = getUiIcon('cursor'), hs = CURSOR_HOTSPOT.cursor;
      if (g.input.inside) ctx.drawImage(cur, Math.round(g.input.x) - hs[0], Math.round(g.input.y) - hs[1]);
    } catch (e) { console.error(e); }
    const fms = performance.now() - tf0;
    (window.__wardMs ||= []).push(fms);
    if (window.__wardMs.length > 240) window.__wardMs.shift();
    g.input.endFrame();
  };
  requestAnimationFrame(frame);
  window.__charReady = true;
}

export function run(params) {
  if (params.get('view') === 'wardrobe') { runWardrobe(params, document.getElementById('screen')); return; }
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  setCharacterBudget(Number(params.get('budget') || 1e6));
  const view = params.get('view') || 'all';
  const fixedT = params.has('t') ? Number(params.get('t')) : null;
  let look = DEFAULT_CHARACTER;
  try { if (params.get('look')) look = JSON.parse(params.get('look')); } catch { /* ignore */ }
  const sp = SPECIES.find((s) => s.id === (params.get('fish') || 'parrot')) || SPECIES[0];
  const fish = { compiled: compiled(sp.look, null, 'devfish:' + sp.id) };
  let mouse = null;
  cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); mouse = [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; });
  let t = 0, last = performance.now(), frames = 0;
  const times = [];

  function bg() {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#8fd6ec'); grd.addColorStop(0.55, '#4fa8c8'); grd.addColorStop(1, '#1f5f80');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
  function deck(y, x0, x1, color = '#9a6236') {
    g.fillStyle = '#5a3420'; g.fillRect(x0, y, x1 - x0, 8);
    g.fillStyle = color; g.fillRect(x0, y, x1 - x0, 5);
    g.fillStyle = '#c08a52'; g.fillRect(x0, y, x1 - x0, 1);
    for (let x = x0 + 14; x < x1; x += 22) { g.fillStyle = '#6e3e22'; g.fillRect(x, y + 1, 1, 4); }
  }
  function label(s, x, y, c = '#ffffff') { drawText(g, s, x, y, { font: 'small', align: 'center', color: c, shadow: '#0b1622' }); }

  if (view === 'bench') {
    // warm the kit, then time a full pose set at scale 1 facing right
    warmCharacter(look, { poses: ['idle'], ms: 1e6 });
    for (const k of ['solve', 'compose', 'render', 'n']) PROF[k] = 0;
    const t0 = performance.now();
    warmCharacter(look, { ms: 1e6 });
    const tot = performance.now() - t0;
    window.__bench = { total: Math.round(tot), perFrame: +(tot / PROF.n).toFixed(2), solve: +(PROF.solve / PROF.n).toFixed(2), compose: +(PROF.compose / PROF.n).toFixed(2), render: +(PROF.render / PROF.n).toFixed(2), n: PROF.n, vox: PROF.vox, px: PROF.px };
    const t1 = performance.now();
    warmCharacter(look, { ms: 1e6, scale: 2.8, poses: ['idle'], yaw: -30 });
    window.__bench.bigIdle = +((performance.now() - t1) / 12).toFixed(2);
  }
  function draw() {
    const nowT = performance.now();
    const dt = Math.min(0.05, (nowT - last) / 1000);
    last = nowT;
    t = fixedT ?? t + dt;
    const t0 = performance.now();
    bg();
    if (view === 'all' || view === 'poses') {
      label('POSES (facing right / left, scale 1)', 480, 4, '#fff6c8');
      deck(150, 8, 952);
      POSE_NAMES.forEach((p, i) => {
        const x = 52 + i * 94;
        const a = drawCharacter(g, x, p === 'sit' ? 146 : 150, { pose: p, t: p === 'cast' || p === 'yank' ? (t * 0.8) % 1.3 : t + i * 0.37, facing: 1, look, fish, id: 'r' + i });
        g.fillStyle = '#ff3a6a'; g.fillRect(a.rodTip[0] - 1, a.rodTip[1] - 1, 2, 2);
        if (!['hold'].includes(p)) { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(a.rodTip[0] + 0.5, a.rodTip[1] + 0.5); g.lineTo(a.rodTip[0] + 18, 190); g.stroke(); }
        label(p, x, 162);
      });
      deck(268, 8, 952);
      POSE_NAMES.forEach((p, i) => {
        const x = 52 + i * 94;
        drawCharacter(g, x, p === 'sit' ? 264 : 268, { pose: p, t: p === 'cast' || p === 'yank' ? (t * 0.8 + 0.4) % 1.3 : t + i * 0.21, facing: -1, look: LOOKS[(i + 1) % LOOKS.length], fish, id: 'l' + i, lookAt: mouse });
      });
    }
    if (view === 'all' || view === 'outfits') {
      const y0 = view === 'outfits' ? 140 : 392;
      deck(y0, 8, 640);
      LOOKS.forEach((L, i) => {
        if (view === 'all' && i > 6) return;
        const x = 50 + i * 90;
        const pose = ['idle', 'wave', 'cheer', 'reel', 'hold', 'sad', 'pull', 'idle', 'wave', 'cast'][i];
        drawCharacter(g, x, y0, { pose, t: t + i * 0.3, facing: i % 2 ? -1 : 1, look: L, fish, id: 'o' + i });
        label(normalizeLook(L).tint, x, y0 + 12);
      });
    }
    if (view === 'all' || view === 'big') {
      const yawOv = params.has('yaw') ? Number(params.get('yaw')) : null;
      const sc = Number(params.get('scale') || (view === 'big' ? 3 : 2));
      const bx = view === 'big' ? 300 : 790, by = view === 'big' ? 470 : 520;
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.beginPath(); g.ellipse(bx, by, 60 * sc / 2, 12 * sc / 2, 0, 0, Math.PI * 2); g.fill();
      drawCharacter(g, bx, by, { pose: params.get('pose') || 'idle', t, yaw: yawOv ?? -30 + Math.sin(t * 0.6) * 60, scale: sc, look, fish, id: 'big', lookAt: mouse });
      if (view === 'big') {
        drawCharacter(g, 700, 470, { pose: 'hold', t, facing: -1, scale: 2, look: LOOKS[3], fish, id: 'big2' });
        drawCharacter(g, 860, 470, { pose: 'cheer', t, facing: -1, scale: 1.5, look: LOOKS[1], id: 'big3' });
      }
    }
    if (view === 'turn') {
      const sc = Number(params.get('scale') || 2.4);
      const pose = params.get('pose') || 'show';
      [0, -40, -90, 180, 40].forEach((yw, i) => {
        drawCharacter(g, 100 + i * 190, 300, { pose, t: fixedT ?? 0, yaw: yw, scale: sc, look, id: 'tt' + i });
        label('yaw ' + yw, 100 + i * 190, 306);
      });
      LOOKS.slice(1, 6).forEach((L, i) => drawCharacter(g, 100 + i * 190, 520, { pose, t: fixedT ?? 0, yaw: -30, scale: 2, look: L, id: 'tu' + i }));
    }
    if (view === 'npcs') {
      label('NPCS (scale 1, then scale 2 talking)', 480, 4, '#fff6c8');
      deck(170, 8, 952);
      deck(470, 8, 952);
      Object.keys(NPCS).forEach((id, i) => {
        const x = 80 + i * 160;
        drawNPC(g, id, { x, y: 170, t: t + i * 0.7, scale: 1, facing: i % 2 ? -1 : 1, pose: 'idle', mood: 'happy', id: 'a' + i, lookAt: mouse });
        label(NPCS[id].name, x, 182);
        const talk = Math.abs(Math.sin(t * 11 + i)) * (Math.sin(t * 1.3 + i) > 0 ? 1 : 0);
        drawNPC(g, id, { x, y: 470, t: t + i * 0.7, scale: 2, facing: i % 2 ? 1 : -1, pose: i === 2 ? 'wave' : 'talk', talk: params.has('talk') ? 0.8 : talk, mood: ['happy', 'surprised', 'happy', 'excited', 'happy', 'surprised'][i], id: 'b' + i });
      });
    }
    if (view === 'small') {
      label('SMALL (boat scale 0.62, then 0.45)', 480, 4, '#fff6c8');
      deck(120, 8, 952); deck(240, 8, 952);
      LOOKS.forEach((L, i) => {
        drawCharacter(g, 50 + i * 92, 120, { pose: ['idle', 'reel', 'cheer', 'hold', 'pull', 'wave', 'idle', 'sad', 'cast', 'sit'][i], t: t + i * 0.3, facing: i % 2 ? -1 : 1, scale: 0.62, look: L, fish, id: 's' + i });
        drawCharacter(g, 50 + i * 92, 240, { pose: 'idle', t: t + i * 0.3, facing: 1, scale: 0.45, look: L, id: 'q' + i });
      });
    }
    if (view === 'boats') {
      const tierSel = params.has('tier') ? Number(params.get('tier')) : null;
      let parts = null;
      try { if (params.get('parts')) parts = JSON.parse(params.get('parts')); } catch { /* ignore */ }
      const tiers = tierSel != null ? [tierSel] : BOAT_TIERS.map((_, i) => i);
      tiers.forEach((ti, k) => {
        const col = tierSel != null ? 0 : k % 3, row = tierSel != null ? 0 : Math.floor(k / 3);
        const bx = tierSel != null ? 480 : 170 + col * 310, by = tierSel != null ? 360 : 150 + row * 170;
        const pv = renderBoatPreview(ti, parts, { scale: tierSel != null ? 2 : 1, t, look });
        if (pv) { g.drawImage(pv.canvas, Math.round(bx - pv.px), Math.round(by - pv.py)); if (pv.stand) drawCharacter(g, bx + pv.stand[0], by + pv.stand[1], { pose: 'idle', t, facing: 1, scale: tierSel != null ? 1 : 0.62, look, id: 'boat' + k }); if (pv.drawFront) pv.drawFront(g, bx, by, t); }
        g.fillStyle = 'rgba(30,120,200,0.35)'; g.fillRect(bx - 150, by, 300, 2);
        label(`${ti} ${BOAT_TIERS[ti].name}`, bx, by + 40);
      });
    }
    if (view === 'all') {
      const pb = boatPaint(look);
      label(`${WARDROBE.length} wardrobe items  boat ${pb.name}`, 790, 300, '#fff6c8');
      drawWardrobeIcon(g, 690, 520, { t, hover: Math.sin(t * 2) > 0, look });
      drawWardrobeIcon(g, 640, 520, { t, hover: false, look: LOOKS[5] });
      label('dock icon', 665, 526);
    }
    const ms = performance.now() - t0;
    times.push(ms);
    if (times.length > 120) times.shift();
    frames++;
    const st = characterStats();
    drawText(g, `frame ${ms.toFixed(1)} ms  built ${st.built} (${st.avgMs} ms avg)  cached ${st.frames}  fallbacks ${st.fallbacks}`, 6, H - 9, { font: 'small', color: '#ffffff', shadow: '#0b1622' });
    window.__charStats = { ...st, frameMs: ms, avg: times.reduce((a, b) => a + b, 0) / times.length, frames };
    if (fixedT === null || frames < 3) requestAnimationFrame(draw);
  }
  draw();
  window.__charReady = true;
}
