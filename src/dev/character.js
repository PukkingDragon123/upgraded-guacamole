// Dev preview of the voxel fisherman: dist/dev/character.html
//   ?view=all|poses|outfits|big|wardrobe  &t=seconds (freeze time)  &yaw=deg (big turntable)  &scale=N (big)
//   &pose=idle (big)  &look=json  &budget=ms (frame build budget; default unlimited here)
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { drawCharacter, DEFAULT_CHARACTER, POSE_NAMES, characterStats, setCharacterBudget, normalizeLook, WARDROBE, boatPaint, warmCharacter, PROF } from '../gfx/character.js';
import { compiled } from '../gfx/spritecache.js';
import { SPECIES } from '../fish/species.js';

const LOOKS = [
  { ...DEFAULT_CHARACTER },
  { skin: 'lime', eyes: 'googly', mouth: 'grin', hat: 'propeller', outfit: 'hawaiian', boots: 'flippers', gloves: 'none', acc: ['sunglasses'], rod: 'candy' },
  { skin: 'forest', eyes: 'sleepy', mouth: 'buck', hat: 'captain', outfit: 'raincoat', boots: 'red', gloves: 'rubber', acc: ['mustache'], rod: 'carbon' },
  { skin: 'blue', eyes: 'starry', mouth: 'smooch', hat: 'crown', outfit: 'tuxedo', boots: 'cowboy', gloves: 'gold', acc: ['monocle', 'bowtie'], rod: 'golden' },
  { skin: 'orange', eyes: 'angry', mouth: 'grit', hat: 'viking', outfit: 'wetsuit', boots: 'sneakers', gloves: 'boxing', acc: ['earring'], rod: 'laser' },
  { skin: 'pink', eyes: 'hearts', mouth: 'tongue', hat: 'chef', outfit: 'pajamas', boots: 'slippers', gloves: 'mittens', acc: ['scarf'], rod: 'neon' },
  { skin: 'mint', eyes: 'dizzy', mouth: 'whistle', hat: 'cone', outfit: 'astronaut', boots: 'bare', gloves: 'oven', acc: ['backpack', 'snorkel'], rod: 'bamboo' },
  { skin: 'gold', eyes: 'goofy', mouth: 'pout', hat: 'cowboy', outfit: 'hoodie', boots: 'yellow', gloves: 'fingerless', acc: ['bandana'], rod: 'golden' },
  { skin: 'swamp', eyes: 'goofy', mouth: 'grin', hat: 'souwester', outfit: 'overalls', boots: 'yellow', gloves: 'none', acc: [], rod: 'bamboo' },
  { skin: 'purple', eyes: 'googly', mouth: 'pout', hat: 'party', outfit: 'hoodie', boots: 'sneakers', gloves: 'none', acc: ['scarf'], rod: 'neon' },
];

export function run(params) {
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
        label(normalizeLook(L).outfit, x, y0 + 12);
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
    if (view === 'all') {
      const pb = boatPaint(look);
      label(`${WARDROBE.length} wardrobe items  boat ${pb.name}`, 790, 300, '#fff6c8');
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
