// Overlay test with a stubbed chrome API: injects extension/overlay.js into extension/test/ext-test.html,
// checks fish swim around images and hide behind text, scrolls, then fishes with real mouse input
// (nibble -> click on the bite -> fight minigames -> net) and verifies the catch record.
// Fails on any console error/warning from the page.
//   node tools/build.mjs && node extension/test/run.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
const { chromium } = req(process.env.PW_PATH || (() => { try { return req.resolve('playwright'); } catch { return '/opt/node22/lib/node_modules/playwright'; } })());
const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, '..');
const out = join(here, 'out');
await mkdir(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (rq, res) => {
  const p = new URL(rq.url, 'http://x').pathname.replace(/^\/+/, '');
  try {
    const body = await readFile(join(extDir, p));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const port = server.address().port;

let failures = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  - ' + info : ''}`);
  if (!ok) failures++;
}

// Minimal chrome.* stub: records messages, keeps storage in memory, lets the test dispatch messages.
const STUB = () => {
  const ft = { sent: [], listeners: [], store: { settings: { fishCount: 4, roaming: false, sound: false }, catches: [] }, storeL: [] };
  window.__ft = ft;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  window.chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage(msg) {
        ft.sent.push(clone(msg));
        if (msg.type === 'ft:hello' || msg.type === 'ft:status') return Promise.resolve({ ok: true });
        if (msg.type === 'ft:caught') {
          ft.store.catches.push(msg.record);
          for (const l of ft.storeL) l({ catches: { newValue: clone(ft.store.catches) } }, 'local');
          return Promise.resolve({ ok: true });
        }
        if (msg.type === 'ft:leave') return Promise.resolve({ ok: false });
        return Promise.resolve(null);
      },
      onMessage: { addListener: (f) => ft.listeners.push(f), removeListener: (f) => { ft.listeners = ft.listeners.filter((x) => x !== f); } },
    },
    storage: {
      local: {
        get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in ft.store) o[k] = clone(ft.store[k]); return o; },
        set: async (o) => { Object.assign(ft.store, clone(o)); },
      },
      onChanged: { addListener: (f) => ft.storeL.push(f), removeListener: (f) => { ft.storeL = ft.storeL.filter((x) => x !== f); } },
    },
  };
  window.__ftDispatch = (msg) => new Promise((resolve) => {
    let got = false;
    for (const l of ft.listeners) l(msg, { id: 'test-extension' }, (r) => { got = true; resolve(r); });
    setTimeout(() => { if (!got) resolve(null); }, 300);
  });
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
await page.addInitScript(STUB);
await page.goto(`http://localhost:${port}/test/ext-test.html`);
await page.addScriptTag({ path: join(extDir, 'overlay.js') });

const O = (expr) => page.evaluate(`(() => { const o = window.__FISHTOP_OVERLAY__; return ${expr}; })()`);
const wait = (ms) => page.waitForTimeout(ms);
// time update+draw per frame
await O(`(() => { o.perf = { n: 0, ms: 0, max: 0 }; const u = o.update.bind(o), d = o.draw.bind(o);
  o.update = (dt) => { o._t0 = performance.now(); u(dt); }; o.draw = () => { d(); const ms = performance.now() - o._t0; o.perf.n++; o.perf.ms += ms; if (o.perf.n > 30) o.perf.max = Math.max(o.perf.max, ms); }; })()`);

check('overlay booted', await O('!!o && !o.destroyed'));
const host = await page.evaluate(() => { const h = document.querySelector('fishtop-overlay'); const s = getComputedStyle(h); return { pe: s.pointerEvents, pos: s.position, z: s.zIndex, parent: h.parentElement.localName }; });
check('overlay is click-through by default', host.pe === 'none' && host.pos === 'fixed' && host.parent === 'html', JSON.stringify(host));
check('page clicks reach the page', await page.evaluate(() => { const a = document.elementFromPoint(400, 300); return !!a && a.localName !== 'fishtop-overlay'; }));
check('hello sent to background', await page.evaluate(() => window.__ft.sent.some((m) => m.type === 'ft:hello')));
await page.mouse.move(960, 700);
await wait(7000);
const census = await O('({ n: o.fishes.length, W: o.W, H: o.H, icons: o.world.icons.length, windows: o.world.windows.length, scanMs: o.scanner.ms, species: o.fishes.map((f) => f.sp.id + "@" + f.z.toFixed(2) + ":" + f.state) })');
check('fish arrived (1..6)', census.n >= 1 && census.n <= 6, JSON.stringify(census.species));
check('logical canvas ~960 wide', census.W >= 900 && census.W <= 1400, `${census.W}x${census.H}`);
check('images found as obstacles', census.icons >= 2, `${census.icons} media rects`);
check('text blocks found as hiding spots', census.windows >= 5, `${census.windows} text rects, scan ${census.scanMs.toFixed(2)} ms`);

// ---- fish swim around images: send two near fish on a course straight through the hero image
await O(`(() => {
  const hero = o.world.icons.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
  o.testRuns = [];
  for (const [k, id] of [[0, 'loafer'], [1, 'pixel']]) {
    while (o.fishes.length >= 6) o.fishes.splice(o.fishes.findIndex((q) => !q.controlled && !o.testRuns.includes(q)), 1);
    const y = hero.y + hero.h * (0.35 + k * 0.3);
    const f = o.spawnSpecies(id, { x: hero.x - 40, y, z: 0 });
    f.z = 0; f.setState('wander'); f.target = { x: hero.x + hero.w + 60, y, z: 0 }; f.wanderT = 30; f.life = 999;
    o.testRuns.push(f);
  }
})()`);
let samples = 0, inside = 0;
for (let i = 0; i < 40; i++) {
  await O('o.testRuns.forEach((f) => { f.z = Math.min(f.z, 0.3); })');
  const r = await O(`(() => { let s = 0, n = 0; for (const f of o.fishes) { if (f.z >= 0.55 || f.controlled || f.style === 'crawl' || f.style === 'hop' || ['interest', 'sniff', 'enter'].includes(f.state)) continue; s++;
    for (const r of o.world.icons) if (f.x > r.x + 3 && f.x < r.x + r.w - 3 && f.y > r.y + 3 && f.y < r.y + r.h - 3) { n++; break; } } return [s, n]; })()`);
  samples += r[0]; inside += r[1];
  await wait(100);
}
check('front fish swim around images', samples > 0 && inside / samples < 0.08, `${inside}/${samples} samples on an image`);
await page.screenshot({ path: join(out, '01_swim.png') });

// ---- force the scenes for the screenshot: one fish hiding in a paragraph, one deep fish behind the hero image
await O(`(() => {
  const ws = o.world.windows.filter((w) => w.w > 300 && w.h > 60 && w.y > 40 && w.y + w.h < o.H);
  const f = o.fishes.find((q) => q.style !== 'crawl' && q.style !== 'hop') || o.spawnSpecies('loafer', { x: 300, y: 300 });
  const w = ws[0] || o.world.windows[0];
  f.x = w.x + w.w * 0.3; f.y = w.y + w.h / 2; f.z = 0.2; f.goHide(); f.hideRect = w; f.hideT = 6;
  const hero = o.world.icons.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
  while (o.fishes.length >= 6) o.fishes.splice(o.fishes.findIndex((q) => q !== f && !q.controlled), 1);
  const g = o.spawnSpecies('honk', { x: hero.x + hero.w + 2, y: hero.y + hero.h * 0.55, z: 0.9 });
  g.z = 0.9; g.facing = 1; g.setState('idle'); g.idleT = 8;
  o.testHide = f; o.testDeep = g;
})()`);
await wait(1200);
const hide = await O(`({ state: o.testHide.state, x: o.testHide.x, y: o.testHide.y, r: o.testHide.hideRect && { x: o.testHide.hideRect.x, y: o.testHide.hideRect.y, w: o.testHide.hideRect.w, h: o.testHide.hideRect.h }, lines: o.testHide.hideRect ? o.scanner.linesOf(o.testHide.hideRect).length : 0, k: o.k, deep: { x: o.testDeep.x, y: o.testDeep.y, z: o.testDeep.z } })`);
check('a fish hides behind a paragraph', hide.state === 'hide' && hide.lines >= 2, `${hide.state}, ${hide.lines} line boxes`);
await page.screenshot({ path: join(out, '02_hide_and_behind.png') });
if (hide.r) {
  const k = hide.k;
  await page.screenshot({ path: join(out, '02b_hide_crop.png'), clip: { x: Math.max(0, hide.r.x / k - 20), y: Math.max(0, hide.r.y / k - 20), width: Math.min(700, hide.r.w / k + 40), height: Math.min(400, hide.r.h / k + 40) } });
}

// ---- scrolling pushes the fish like a current
const before = await O('o.fishes.map((f) => f.y)');
await page.mouse.wheel(0, 500);
await wait(120);
const after = await O('o.fishes.map((f) => f.y)');
const moved = before.filter((y, i) => after[i] !== undefined && after[i] < y - 4).length;
check('scroll current carries fish', moved >= 1, `${moved}/${before.length} fish swept up`);
await wait(900);
await page.screenshot({ path: join(out, '03_scrolled.png') });
await page.mouse.wheel(0, -500);
await wait(800);

// ---- fishing with the mouse
const toPage = async (x, y) => { const k = await O('o.k'); return [x / k, y / k]; };
// sound on (exercises the audio path; it unlocks on the first real click)
await page.evaluate(() => { const ft = window.__ft; ft.store.settings = { ...ft.store.settings, sound: true }; for (const l of ft.storeL) l({ settings: { newValue: ft.store.settings } }, 'local'); });
await page.evaluate(() => window.__ftDispatch({ type: 'ft:set-fishing', on: true }));
const pe = await page.evaluate(() => getComputedStyle(document.querySelector('fishtop-overlay')).pointerEvents);
check('fishing mode captures the mouse', pe === 'auto' && await O('o.fishingMode'), pe);

async function fightBot(label) {
  const t0 = Date.now();
  let holding = false;
  let shot = false;
  while (Date.now() - t0 < 60000) {
    const s = await O(`(() => { const F = o.fishing, f = F.fish, P = F.fight?.phase; return { state: F.state, phase: F.fight?.phaseName, T: F.tension ?? 0, fx: f?.x, fy: f?.y, fvx: f?.vx, fvy: f?.vy, fs: f?.scale ?? 1,
      cx: o.input.x, cy: o.input.y, W: o.W, H: o.H, ring: P?.ring ? P.ring() : null, tgt: P?.target, pt: P?.t, dir: P?.dir, inside: P?.inside }; })()`);
    if (s.state !== 'fight') { if (holding) await page.mouse.up(); return s.state; }
    if (!shot && s.phase === 'tension' && Date.now() - t0 > 1500) { shot = true; await page.screenshot({ path: join(out, `04_fight_${label}.png`) }); }
    if (s.phase === 'tension' || s.phase === 'dodge') {
      const want = s.phase === 'dodge' ? true : holding ? s.T < 0.8 : s.T < 0.55;
      if (want !== holding) { holding = want; await (want ? page.mouse.down() : page.mouse.up()); }
      const sp = Math.hypot(s.fvx, s.fvy) || 1;
      let nx = s.cx - (s.fvx / sp) * 10, ny = s.cy - (s.fvy / sp) * 10;
      if (nx < 40 || nx > s.W - 40 || ny < 40 || ny > s.H - 40) { nx = s.cx + (s.W / 2 - s.cx) * 0.1; ny = s.cy + (s.H / 2 - s.cy) * 0.1; }
      const [px, py] = await toPage(nx, ny);
      await page.mouse.move(px, py, { steps: 2 });
    } else if (s.phase === 'net') {
      if (holding) { holding = false; await page.mouse.up(); }
      const R = Math.max(26, 26 * s.fs);
      const pts = [];
      for (let i = 0; i <= 30; i++) { const a = (i / 28) * Math.PI * 2; pts.push(await toPage(s.fx + Math.cos(a) * R, s.fy + Math.sin(a) * R * 0.8)); }
      await page.mouse.move(pts[0][0], pts[0][1], { steps: 3 });
      await page.mouse.down();
      for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 1 });
      await page.mouse.up();
      await page.waitForTimeout(150);
    } else if (s.phase === 'mash') {
      if (holding) { holding = false; await page.mouse.up(); }
      for (let i = 0; i < 4; i++) { await page.mouse.down(); await page.mouse.up(); }
    } else if (s.phase === 'timing') {
      if (holding) { holding = false; await page.mouse.up(); }
      if (s.pt > 0 && s.ring !== null && Math.abs(s.ring - s.tgt) < 2.5) { await page.mouse.down(); await page.mouse.up(); }
    } else if (s.phase === 'trace') {
      const [px, py] = await toPage(s.fx, s.fy);
      await page.mouse.move(px, py, { steps: 1 });
    } else if (s.phase === 'unwrap') {
      const a = Date.now() / 1000 * 6 * (s.dir || 1);
      const [px, py] = await toPage(s.W / 2 + Math.cos(a) * 30, s.H / 2 + Math.sin(a) * 30);
      await page.mouse.move(px, py, { steps: 1 });
    }
  }
  return 'timeout';
}

async function catchOne(species) {
  await O(`(() => { o.settings.fishCount = 1; o.spawnT = 999; for (const f of o.fishes) if (!f.controlled) f.dead = true; })()`);
  await wait(100);
  const spot = await O(`(() => { const ic = o.world.icons; let x = o.W * 0.5, y = o.H * 0.55;
    for (let i = 0; i < 40; i++) { const tx = 120 + Math.random() * (o.W - 240), ty = 120 + Math.random() * (o.H - 220);
      if (!ic.some((r) => tx > r.x - 50 && tx < r.x + r.w + 50 && ty > r.y - 40 && ty < r.y + r.h + 40)) { x = tx; y = ty; break; } }
    return [x, y]; })()`);
  const [hx, hy] = await toPage(spot[0], spot[1]);
  await page.mouse.move(hx, hy, { steps: 40 });
  await wait(400); // let the cursor settle so nothing gets spooked
  await O(`(() => { const f = o.spawnSpecies('${species}', { x: ${spot[0]} - 70, y: ${spot[1]}, z: 0 }); f.z = 0; f.setState('wander'); f.cooldown = 0; o.testFish = f; })()`);
  // wait for nibbles, then click right on the bite
  const t0 = Date.now();
  let st = 'idle';
  const trail = [];
  while (Date.now() - t0 < 25000) {
    const q = await O('[o.fishing.state, o.testFish.state, o.fishing.msg?.text || "", Math.round(o.input.speed), o.world.hook.active, Math.round(o.testFish.x), Math.round(o.testFish.y)]');
    st = q[0];
    const key = q.slice(0, 3).join('/');
    if (!trail.length || trail[trail.length - 1].k !== key) trail.push({ k: key, t: Date.now() - t0, v: q.slice(3).join(',') });
    if (st === 'bite') break;
    await page.waitForTimeout(25);
  }
  check(`${species}: nibble -> bite`, st === 'bite', st === 'bite' ? `after ${Date.now() - t0} ms` : JSON.stringify(trail.slice(-12)));
  if (st !== 'bite') return false;
  await page.mouse.down(); await page.mouse.up();
  await wait(60);
  check(`${species}: hook set by clicking the bite`, await O('o.fishing.state') === 'fight');
  const end = await fightBot(species);
  await wait(1200);
  const card = await O('o.card && { sp: o.card.sp.id, t: o.card.t }');
  check(`${species}: fight won and fish landed`, !!card && card.sp === species, `${end} ${JSON.stringify(card)}`);
  return !!card;
}

if (await catchOne('pixel')) {
  await wait(700);
  await page.screenshot({ path: join(out, '05_card.png') });
  const cr = await O('(() => { const k = o.k; return { x: (o.W - 230) / k, y: (o.H - 160) / k, width: 230 / k, height: 160 / k }; })()');
  await page.screenshot({ path: join(out, '05b_card_crop.png'), clip: cr });
}
await catchOne('guppy');
const rec = await page.evaluate(() => window.__ft.store.catches);
const r0 = rec[0] || {};
check('catch saved via background message', rec.length >= 1, `${rec.length} records`);
check('record shaped like rollIndividual + species/caughtAt', ['uid', 'species', 'sizeCm', 'weightKg', 'sizeT', 'personality', 'name', 'caughtAt'].every((k) => k in r0) && typeof r0.thumb === 'string' && r0.thumb.startsWith('data:image/png'),
  Object.keys(r0).join(','));

// Esc leaves fishing mode and the page is clickable again
await page.keyboard.press('Escape');
await wait(100);
const pe2 = await page.evaluate(() => getComputedStyle(document.querySelector('fishtop-overlay')).pointerEvents);
check('Esc exits fishing mode', pe2 === 'none' && !(await O('o.fishingMode')), pe2);

// hidden tab pauses the loop
const perf = await O('({ avg: o.perf.ms / Math.max(1, o.perf.n), max: o.perf.max, n: o.perf.n })');
console.log(`perf: ${perf.n} frames, avg ${perf.avg.toFixed(2)} ms, max ${perf.max.toFixed(1)} ms (update+draw)`);
check('stop message removes the overlay', await page.evaluate(async () => { await window.__ftDispatch({ type: 'ft:stop' }); await new Promise((r) => setTimeout(r, 50)); return !document.querySelector('fishtop-overlay'); }));

check('no console errors or warnings', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
