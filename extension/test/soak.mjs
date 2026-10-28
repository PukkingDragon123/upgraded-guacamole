// Soak / fuzz test for the overlay adapter: every species visits the page, random cursor and scroll,
// forced states (hide, flee, leave, curious), and every fight phase and trick runs through the real
// fishing controller with random input. Fails on any exception or console warning/error.
//   node tools/build.mjs && node extension/test/soak.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
const { chromium } = req(process.env.PW_PATH || (() => { try { return req.resolve('playwright'); } catch { return '/opt/node22/lib/node_modules/playwright'; } })());
const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, '..');
const { SPECIES } = await import('../../src/fish/species.js');
const ids = SPECIES.map((s) => s.id);

const server = createServer(async (rq, res) => {
  const p = new URL(rq.url, 'http://x').pathname.replace(/^\/+/, '');
  if (p === 'favicon.ico') { res.writeHead(204).end(); return; }
  try {
    const body = await readFile(join(extDir, p));
    res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => {
  const ls = [];
  window.chrome = {
    runtime: { id: 'soak', sendMessage: async (m) => (m.type === 'ft:hello' ? { ok: true } : null), onMessage: { addListener: (f) => ls.push(f), removeListener() {} } },
    storage: { local: { get: async () => ({ settings: { fishCount: 6 } }), set: async () => {} }, onChanged: { addListener() {}, removeListener() {} } },
  };
});
await page.goto(`http://localhost:${server.address().port}/test/ext-test.html`);
await page.addScriptTag({ path: join(extDir, 'overlay.js') });
await page.waitForTimeout(500);

let failed = 0;
const PHASES = ['tension', 'trace', 'mash', 'timing', 'dodge', 'unwrap', 'net'];
const TRICKS = ['dash', 'fake', 'dive', 'jump', 'wrap', 'hop', 'glitch'];
for (let i = 0; i < ids.length; i += 6) {
  const batch = ids.slice(i, i + 6);
  const r = await page.evaluate(([batch, PHASES, TRICKS, scrollY]) => {
    const o = window.__FISHTOP_OVERLAY__;
    window.scrollTo(0, scrollY);
    const R = Math.random;
    try {
      if (o.fishing.busy) o.fishing.releaseFish(false);
      o.fishes.length = 0;
      o.spawnT = 999;
      for (const id of batch) {
        const f = o.spawnSpecies(id, R() < 0.5 ? undefined : { x: 60 + R() * (o.W - 120), y: 60 + R() * (o.H - 120), z: R() * 0.9 });
        if (f && R() < 0.3) f.rec.variant = { shiny: true, shinyHue: 120 };
      }
      o.setFishing(R() < 0.7);
      const inp = o.input;
      let phaseIx = 0;
      for (let k = 0; k < 700; k++) {
        inp.x = Math.max(0, Math.min(o.W, inp.x + (R() - 0.5) * 30)); inp.y = Math.max(0, Math.min(o.H, inp.y + (R() - 0.5) * 30));
        if (k === 0) { inp.x = o.W / 2; inp.y = o.H / 2; }
        inp.inside = R() > 0.02;
        if (R() < 0.04) { inp.pressed = true; inp.clicks = 1; inp.down = true; }
        if (R() < 0.04 && inp.down) { inp.released = true; inp.down = false; }
        if (R() < 0.01) inp.rdown = !inp.rdown;
        if (R() < 0.02) o.scrollDY += (R() - 0.3) * 600;
        if (R() < 0.01) o.scrollInner += 200;
        const free = o.fishes.filter((f) => !f.controlled);
        const f = free[Math.floor(R() * free.length)];
        if (f && R() < 0.02) f.startle(inp.x, inp.y);
        if (f && R() < 0.02) f.goHide();
        if (f && R() < 0.005) f.setState('leave');
        if (f && R() < 0.01) f.setState('curious');
        if (o.fishingMode && o.fishing.state === 'idle' && f && R() < 0.05) o.fishing.requestNibble(f);
        if (o.fishing.state === 'bite' && R() < 0.3) { inp.pressed = true; inp.clicks = 1; }
        const F = o.fishing.fight;
        if (o.fishing.state === 'fight' && F && R() < 0.02) { F.phases.splice(F.pi, 1, PHASES[phaseIx++ % PHASES.length]); o.fishing.startPhase(); }
        if (F?.phase?.startTrick && R() < 0.03 && !F.phase.trick) F.phase.startTrick(TRICKS[Math.floor(R() * TRICKS.length)]);
        if (k % 90 === 0) o.scanner.scan(o.cssW, o.cssH, o.k), (o.world.icons = o.scanner.icons), (o.world.windows = o.scanner.windows);
        if (k === 350 && !o.card) o.card = { rec: o.fishes[0]?.rec || { name: 'x', sizeCm: 1, weightKg: 1 }, sp: o.fishes[0]?.sp, isNew: true, t: 0, emotion: 'happy', waiting: 3 };
        if (o.card && !o.card.sp) o.card = null;
        o.update(1 / 30);
        o.draw();
        inp.endFrame();
        for (const q of o.fishes) if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return { error: `non-finite position for ${q.sp.id} in state ${q.state}` };
      }
      return { ok: true, n: o.fishes.length, errs: o.errors, caught: o.game.state.stats.caught };
    } catch (e) {
      return { error: e.stack || String(e) };
    }
  }, [batch, PHASES, TRICKS, (i * 97) % 1400]);
  const bad = !r.ok || r.errs;
  if (bad) failed++;
  console.log(`${bad ? 'FAIL' : 'PASS'}  ${batch.join(', ')}  ${r.error ? '- ' + r.error.split('\n').slice(0, 3).join(' | ') : `(${r.n} fish left, ${r.caught} caught so far)`}`);
}
const ok = errors.length === 0;
console.log(`${ok ? 'PASS' : 'FAIL'}  no console errors or warnings  ${errors.slice(0, 4).join(' | ')}`);
await browser.close();
server.close();
process.exit(failed || !ok ? 1 : 0);
