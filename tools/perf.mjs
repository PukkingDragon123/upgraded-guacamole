// [perf27] Headless profiling run: boots dist/index.html?fresh&skipintro in Chromium and records, per scenario,
// frame intervals (rAF), the game's own CPU time per frame (update + draw), long tasks (> 50 ms) and the JS heap.
//   PW_PATH=/opt/node-tools/node_modules/playwright node tools/perf.mjs [--secs 6] [--only lab,wardrobe] [--profile]
//     [--json out.json]
// Scenarios: ocean, fight, tank, lab, wardrobe, voyage, cutscene, deep, deep2. Also printed: main-thread task time per
// frame (CDP Performance metrics: script + canvas raster) and the time to the first game frame.
// --profile adds a CDP CPU profile per scenario and prints the top self-time functions (the bundle is unminified) and
// the native canvas / GL calls by JS caller; env PERF_INCL=n (inclusive times), PERF_SPIKES=ms (what made each long
// frame), PERF_CALLERS=fn (call paths into fn). PERF_JS=<file> serves another bundle (A/B against a saved baseline),
// PERF_SETTLE=ms waits before the scenarios, PERF_EVAL=<js> runs an experiment, PERF_Q=&watergl=0 adds query flags.
// Headless Chromium renders in software (SwiftShader), so compare runs relative to each other and watch the spikes.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SECS = Number(arg('--secs', 6));
const ONLY = arg('--only', '') ? arg('--only', '').split(',') : null;
const PROFILE = argv.includes('--profile');
const JSON_OUT = arg('--json', '');

const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  try {
    // PERF_JS=<file>: serve another build of the game bundle (A/B runs against a saved baseline)
    const body = await readFile(p === 'fishtop.js' && process.env.PERF_JS ? process.env.PERF_JS : join(root, p));
    res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : extname(p) === '.png' ? 'image/png' : 'text/html' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// frame + long-task recorders, installed before any game code runs
await page.addInitScript(() => {
  const P = (window.__perf = { frames: [], long: [], t0: performance.now(), firstFrame: 0 });
  let last = 0;
  const tick = (now) => { if (last) P.frames.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) P.long.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  } catch { /* no long-task API */ }
});
const cdpM = await page.context().newCDPSession(page); // main-thread task time (Performance.getMetrics)
await cdpM.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdpM.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const cdp = PROFILE ? await page.context().newCDPSession(page) : null;
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); }

const G = (expr) => page.evaluate(`(() => { const g = window.FISHTOP; return ${expr}; })()`);
const wait = (ms) => page.waitForTimeout(ms);
const until = (fn, timeout, a) => page.waitForFunction(fn, a, { timeout, polling: 100 }).then(() => true).catch(() => false);
async function toPage(x, y) {
  return page.evaluate(([x, y]) => { const g = window.FISHTOP, r = g.canvas.getBoundingClientRect(); return [r.left + (x / g.screen.W) * r.width, r.top + (y / g.screen.H) * r.height]; }, [x, y]);
}
async function moveL(x, y, steps = 8) { const [px, py] = await toPage(x, y); await page.mouse.move(px, py, { steps }); }

const tBoot = Date.now();
if (cdp) await cdp.send('Profiler.start');
await page.goto(`http://localhost:${port}/index.html?fresh&skipintro${process.env.PERF_Q || ""}`);
await until(() => !!window.FISHTOP, 60000);
// the game's own CPU time per frame (update + draw)
await G(`(() => { const P = window.__perf; P.cpu = []; const u = g.update.bind(g), d = g.draw.bind(g); let t = 0;
  g.update = (dt) => { t = performance.now(); u(dt); }; g.draw = (dt) => { d(dt); P.cpu.push(performance.now() - t); }; return true; })()`);
await until(() => window.__perf.cpu.length > 2, 60000);
const boot = await page.evaluate(() => ({ firstFrame: performance.now() - window.__perf.t0, long: window.__perf.long.slice() }));
const bootProf = cdp ? (await cdp.send('Profiler.stop')).profile : null;
console.log(`boot: first game frame ${(boot.firstFrame / 1000).toFixed(2)} s after navigation (${((Date.now() - tBoot) / 1000).toFixed(1)} s wall), long tasks ${boot.long.length} (max ${Math.round(Math.max(0, ...boot.long))} ms)`);
// the chapter 1 opening cutscene queues itself after the skipped tutorial: let it go so 'ocean' is the plain ocean
for (let i = 0; i < 40 && (await G('!!(g.quests && g.quests.cine && g.quests.cine.pending())')); i++) { await G('(g.quests.cine.skip(), true)'); await wait(500); }
await G(`(g.ui.close(), true)`);
if (bootProf) printProfile(bootProf);
if (process.env.PERF_EVAL) await G(process.env.PERF_EVAL); // experiments: e.g. PERF_EVAL='(g.drawScene = () => {}, 1)'
await wait(Number(process.env.PERF_SETTLE || 3000)); // PERF_SETTLE=ms: let the background builds finish first

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const results = [];
async function measure(name, setup, during) {
  if (ONLY && !ONLY.includes(name)) return;
  await page.evaluate(() => { const P = window.__perf; P.frames = []; P.long = []; P.cpu = []; });
  if (cdp) await cdp.send('Profiler.start');
  const m0 = await metrics();
  const t0 = Date.now();
  try { await setup?.(); } catch (e) { console.log(`  ${name}: setup failed ${e.message}`); }
  while (Date.now() - t0 < SECS * 1000) { try { await during?.(); } catch { /* best effort */ } await wait(250); }
  const m1 = await metrics();
  const prof = cdp ? (await cdp.send('Profiler.stop')).profile : null;
  const r = await page.evaluate(() => { const P = window.__perf; window.gc?.(); return { frames: P.frames, long: P.long, cpu: P.cpu, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 }; });
  const row = {
    name, frames: r.frames.length, fps: r.frames.length / SECS,
    frameAvg: avg(r.frames), frameP95: pct(r.frames, 0.95), frameMax: Math.max(0, ...r.frames),
    cpuAvg: avg(r.cpu), cpuP95: pct(r.cpu, 0.95), cpuMax: Math.max(0, ...r.cpu),
    longN: r.long.length, longMax: Math.max(0, ...r.long), longSum: r.long.reduce((a, b) => a + b, 0),
    heapMB: r.heap / 1048576,
    // main-thread task time (script + style + paint + canvas raster ...) per rendered frame, and its share of the run
    task: ((m1.TaskDuration - m0.TaskDuration) * 1000) / Math.max(1, r.frames.length), busy: (m1.TaskDuration - m0.TaskDuration) / ((Date.now() - t0) / 1000),
  };
  results.push(row);
  console.log(`${name.padEnd(10)} fps ${row.fps.toFixed(1).padStart(5)} | frame avg ${row.frameAvg.toFixed(1).padStart(6)} p95 ${row.frameP95.toFixed(1).padStart(6)} max ${row.frameMax.toFixed(0).padStart(5)} ms | cpu avg ${row.cpuAvg.toFixed(1).padStart(5)} p95 ${row.cpuP95.toFixed(1).padStart(5)} max ${row.cpuMax.toFixed(0).padStart(5)} ms | long ${String(row.longN).padStart(3)} max ${row.longMax.toFixed(0).padStart(5)} sum ${row.longSum.toFixed(0).padStart(6)} ms | task/frame ${row.task.toFixed(0).padStart(4)} ms busy ${(row.busy * 100).toFixed(0)}% | heap ${row.heapMB.toFixed(0)} MB`);
  if (prof) printProfile(prof);
}
function printProfile(p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dts = p.timeDeltas;
  for (let i = 0; i < p.samples.length; i++) {
    const n = byId.get(p.samples[i]);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} :${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dts[i] || 0));
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [k, v] of top) console.log(`      ${(v / 1000).toFixed(0).padStart(6)} ms ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
  // native canvas / GL calls (line 0) are charged to their JS callers
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const callers = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const n = byId.get(p.samples[i]);
    if (n.callFrame.lineNumber >= 0 || !n.callFrame.functionName || n.callFrame.functionName.startsWith('(')) continue;
    const pa = byId.get(parent.get(n.id));
    if (!pa) continue;
    const key = `${n.callFrame.functionName} <- ${pa.callFrame.functionName || '(anon)'} :${pa.callFrame.lineNumber + 1}`;
    callers.set(key, (callers.get(key) || 0) + (dts[i] || 0));
  }
  const topC = [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (topC.length) console.log('      native calls by caller:');
  for (const [k, v] of topC) console.log(`      ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  // PERF_SPIKES=ms: frames (rAF callbacks) longer than that, with the functions that took most of them
  if (process.env.PERF_SPIKES) {
    const lim = Number(process.env.PERF_SPIKES) * 1000, skip = /^(frame2|g\.draw|g\.update|draw|update|drawScene|safe|\(anon\)|b\.\w+|biome\.\w+)$/;
    let cur = null;
    const flush = () => {
      if (cur && cur.dur > lim) {
        const top = [...cur.fn.entries()].filter(([k]) => !skip.test(k.split(' :')[0])).sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.log(`      spike ${(cur.dur / 1000).toFixed(0)} ms: ${top.map(([k, v]) => `${k} ${(v / 1000).toFixed(0)}`).join(', ')}`);
      }
      cur = null;
    };
    for (let i = 0; i < p.samples.length; i++) {
      const fns = [];
      let inFrame = false;
      for (let id = p.samples[i]; id != null; id = parent.get(id)) {
        const cf = byId.get(id).callFrame;
        if (cf.functionName === 'frame2') inFrame = true;
        if (cf.lineNumber >= 0) fns.push(`${cf.functionName || '(anon)'} :${cf.lineNumber + 1}`);
      }
      if (!inFrame) { flush(); continue; }
      cur ||= { dur: 0, fn: new Map() };
      cur.dur += dts[i] || 0;
      for (const k of new Set(fns)) cur.fn.set(k, (cur.fn.get(k) || 0) + (dts[i] || 0));
    }
    flush();
  }
  // PERF_CALLERS=name: the call paths (5 frames up) that lead into that function
  if (process.env.PERF_CALLERS) {
    const want = process.env.PERF_CALLERS, paths = new Map();
    for (let i = 0; i < p.samples.length; i++) {
      for (let id = p.samples[i]; id != null; id = parent.get(id)) {
        const cf = byId.get(id).callFrame;
        if (cf.functionName !== want) continue;
        const chain = [];
        for (let q = parent.get(id), k = 0; q != null && k < 6; q = parent.get(q), k++) { const f = byId.get(q).callFrame; chain.push(`${f.functionName || '(anon)'}:${f.lineNumber + 1}`); }
        const key = chain.join(' < ');
        paths.set(key, (paths.get(key) || 0) + (dts[i] || 0));
        break;
      }
    }
    console.log(`      callers of ${want}:`);
    for (const [k, v] of [...paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`      ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  }
  // inclusive time per JS function (each sample counted once per function on its stack)
  if (process.env.PERF_INCL) {
    const incl = new Map();
    for (let i = 0; i < p.samples.length; i++) {
      const seen = new Set();
      for (let id = p.samples[i]; id != null; id = parent.get(id)) {
        const cf = byId.get(id).callFrame;
        if (cf.lineNumber < 0) continue;
        const key = `${cf.functionName || '(anon)'} :${cf.lineNumber + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        incl.set(key, (incl.get(key) || 0) + (dts[i] || 0));
      }
    }
    console.log('      inclusive:');
    for (const [k, v] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.PERF_INCL) || 30)) console.log(`      ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  }
}

// ---------------------------------------------------------------- scenarios
const W = await G('g.screen.W'), H = await G('g.screen.H');
await moveL(W * 0.5, H * 0.6);
await measure('ocean', null, async () => { await moveL(W * (0.45 + Math.random() * 0.1), H * (0.55 + Math.random() * 0.1), 4); });

await measure('fight', async () => {
  await moveL(W * 0.55, H * 0.62);
  await wait(500);
  await G(`(() => { const f = g.fishing, h = f.hook; let best = null, bd = 1e9; for (const x of g.school.fishes) { if (x.giant || x.boss || x.controlled) continue; const d = Math.hypot(x.x - h.x, x.y - h.y); if (d < bd) { bd = d; best = x; } } return !!(best && f.requestNibble(best)); })()`);
  await until(() => window.FISHTOP.fishing.state === 'bite', 8000);
  await G(`(g.fishing.state === 'bite' && g.fishing.setHook(), g.fishing.state)`);
}, async () => {
  // circle the mouse around the gear so the reel spins
  const [cx, cy] = await G('(() => { const L = g.fishing.gear.layout(g.screen.W, g.screen.H); return [L.cx, L.cy]; })()').catch(() => [W * 0.8, H * 0.7]);
  for (let a = 0; a < Math.PI * 2; a += 0.6) await moveL(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, 1);
});
await G(`(g.fishing.busy && g.fishing.releaseFish(false), true)`);
await wait(1500);

await measure('tank', async () => { await G(`g.setView('aquarium')`); });
await G(`g.setView('ocean')`);
await wait(1500);

await measure('lab', async () => { await G(`g.ui.open('lab')`); });
await G(`g.ui.close('lab')`);
await wait(800);

await measure('wardrobe', async () => { await G(`g.ui.open('wardrobe')`); });
await G(`g.ui.close('wardrobe')`);
await wait(800);

await G(`(() => { for (const b of ['shallows', 'fjord', 'junkyard', 'metropolis', 'volcano', 'abyss']) if (!g.state.unlockedBiomes.includes(b)) g.state.unlockedBiomes.push(b); return true; })()`);
await measure('voyage', async () => { await G(`g.travel('shallows')`); });
await until(() => !window.FISHTOP.ocean.travelState, 30000);
await wait(1500);

await measure('cutscene', async () => { await G(`(g.quests && g.quests.cine && g.quests.cine.replay('ch1', 'intro'), true)`); }, async () => { await page.keyboard.press('Enter'); });
await G(`(g.quests && g.quests.cine && g.quests.cine.skip(), g.ui.close('quests'), true)`);
await until(() => !window.FISHTOP.quests?.cine?.cur, 15000);
await wait(1000);

// End = the abyss floor (camera.scrollKeys), driven through the camera API so a focus hiccup cannot miss the key
await measure('deep', async () => { await moveL(W * 0.5, H * 0.5); await G(`g.camera.scrollKeys({ keyPressed: (k) => k === 'End' })`); });
await measure('deep2', null, async () => { await moveL(W * (0.45 + Math.random() * 0.1), H * (0.45 + Math.random() * 0.1), 4); });

const final = await page.evaluate(() => { window.gc?.(); return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0; });
console.log(`final heap ${final.toFixed(0)} MB, console errors: ${errors.length}${errors.length ? ' - ' + errors.slice(0, 3).join(' | ') : ''}`);
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify({ boot, results, final, errors }, null, 2));
await browser.close();
server.close();
