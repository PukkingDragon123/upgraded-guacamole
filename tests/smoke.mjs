// End-to-end smoke test (phase 3). Boots the game in headless Chromium and plays the first session with real
// mouse input: the 3D opening (a few beats are screenshotted, then the glossy Skip pill is clicked), the
// store-first start (open the floating AppSea bubble, download free bait), casting into the (OS)cean, hooking a
// fish and winning the fight by cranking the reel, the catch reveal, the fish going into the goldfish jar,
// collecting the jar's Aero, opening The Lab and starting the first research. Then it opens every panel, travels
// to all seven oceans and checks that the console stayed clean. Optional systems are feature-detected so the
// test only fails on real breakage. Screenshots land in tests/out/.
// Ownership: Intro agent; the Fishing agent may edit the scripted fight (marked below).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
await mkdir(out, { recursive: true });

const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : extname(p) === '.png' ? 'image/png' : 'text/html' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));

let failures = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  - ' + info : ''}`);
  if (!ok) failures++;
}
const note = (s) => console.log(`      ${s}`);
const G = (expr) => page.evaluate(`(() => { const g = window.FISHTOP; return ${expr}; })()`);
const wait = (ms) => page.waitForTimeout(ms);
const until = (fn, timeout, arg) => page.waitForFunction(fn, arg, { timeout, polling: 100 }).then(() => true).catch(() => false);
const shot = (name) => page.screenshot({ path: join(out, name) });
// logical -> page pixels
async function toPage(x, y) {
  return page.evaluate(([x, y]) => {
    const g = window.FISHTOP, r = g.canvas.getBoundingClientRect();
    return [r.left + (x / g.screen.W) * r.width, r.top + (y / g.screen.H) * r.height];
  }, [x, y]);
}
async function moveL(x, y, steps = 12) { const [px, py] = await toPage(x, y); await page.mouse.move(px, py, { steps }); }
async function clickL(x, y) { await moveL(x, y, 6); await wait(80); await page.mouse.down(); await wait(40); await page.mouse.up(); }
async function clickRect(r) { if (r) await clickL(r.x + r.w / 2, r.y + r.h / 2); return !!r; }
const step = () => G('g.tutorial && g.tutorial.step');

await page.goto(`http://localhost:${port}/index.html?fresh`);
await until(() => !!window.FISHTOP, 20000);
check('game booted', await G('!!g && g.screen.W > 0'), await G('g.screen.W + "x" + g.screen.H'));
await G(`(window.__ev = {}, ['coinCollected', 'labStarted', 'baitDownloaded', 'hooked', 'caught', 'escaped', 'revealDone'].forEach((e) => g.on(e, () => { window.__ev[e] = (window.__ev[e] || 0) + 1; })), true)`);

// ---------------------------------------------------------------- the 3D opening
const hasIntro = await G('!!(g.tutorial && g.tutorial.intro)');
check('3D opening starts', hasIntro, String(await step()));
if (hasIntro) {
  const ready = await until(() => { const i = window.FISHTOP.tutorial.intro; return !i || (i.ready && i.t > 2.2); }, 60000);
  check('opening assets build', ready, `t=${await G('g.tutorial.intro && g.tutorial.intro.t.toFixed(2)')}`);
  await shot('01_intro_room.png');
  // a few later beats (seek is the opening's own scrubbing API)
  for (const [t, name] of [[8.6, '02_intro_dolly.png'], [14.9, '03_intro_bubble_person.png'], [19.2, '04_intro_logo.png']]) {
    if (!(await G('!!g.tutorial.intro'))) break;
    await G(`g.tutorial.intro.seek(${t})`);
    await wait(700);
    await shot(name);
  }
  await G('g.tutorial.intro && g.tutorial.intro.seek(3)');
  await wait(400);
  // the glossy Skip pill (top right)
  const sr = await G('g.tutorial.intro && g.tutorial.intro.skipRect()');
  if (sr) { await clickRect(sr); }
  const skipped = await until(() => !window.FISHTOP.tutorial.intro, 8000);
  check('Skip pill ends the opening', skipped && (await step()) === 'appsea', String(await step()));
}
check('starts in the (OS)cean', (await G('g.ocean.biome && g.ocean.biome.id')) === 'oscean', await G('g.ocean.biome && g.ocean.biome.id'));
const menuGated = await G(`['lab', 'journal', 'map'].every((id) => !g.desktop.iconRect(id))`);
check('menu gated during the tutorial', menuGated);
await wait(800);
await shot('05_tut_appsea.png');

// ---------------------------------------------------------------- store-first start
const appsea = await G(`g.desktop.iconRect && g.desktop.iconRect('appsea')`);
check('AppSea bubble visible', !!appsea);
await clickRect(appsea);
check('AppSea opens', await until(() => window.FISHTOP.tutorial.step !== 'appsea', 6000), String(await step()));
await wait(600);
await shot('06_tut_appsea_open.png');
const hasStore = await G('!!(g.store && g.store.request)');
if (hasStore) {
  await G(`(() => { const d = g.store.request('notes', { tier: 0 }); if (d && d.state === 'confirm') g.store.confirm(d.uid, true); return !!d; })()`);
  await wait(400);
  for (let i = 0; i < 20 && (await step()) === 'download'; i++) { await G('g.store.tick(Date.now() + 600000)'); await wait(300); }
}
check('free bait downloaded', (await G('(window.__ev.baitDownloaded || 0)')) > 0 && (await step()) === 'cast', String(await step()));
await wait(1800); // the store window tidies itself away
await shot('07_tut_cast.png');

// ---------------------------------------------------------------- cast, bite, fight (the Fishing agent may edit this section)
const W = await G('g.screen.W'), H = await G('g.screen.H');
const pxPerL = await page.evaluate(() => { const g = window.FISHTOP; return g.canvas.getBoundingClientRect().width / g.screen.W; });
async function fishOnce(attempt) {
  // hook into the water
  await moveL(W * 0.56, H * 0.58, 20);
  await wait(500);
  if (attempt === 0) check('cast into the water', ['wait', 'fight'].includes(await step()), String(await step()));
  // jiggle near the closest fish until one bites
  let bit = false;
  const t0 = Date.now();
  for (let i = 0; !bit && Date.now() - t0 < 60000; i++) {
    await wait(120);
    bit = (await G('g.fishing.state')) === 'bite';
    if (!bit && i % 25 === 24) {
      const near = await G(`(() => { const h = g.fishing.hook, s = g.world.surfaceY ?? 0; let best = null, bd = 1e9; for (const f of g.school.fishes) { if (f.z > 0.6 || f.y < s + 12) continue; const d = Math.hypot(f.x - h.x, f.y - h.y); if (d < bd) { bd = d; best = f; } } return best ? [best.x + (best.facing || 1) * 26, best.y] : null; })()`);
      if (near) await moveL(Math.max(30, Math.min(W - 30, near[0])), Math.max(60, Math.min(H - 60, near[1])), 10);
      await page.mouse.down(); await page.mouse.up(); // jiggle the lure
    }
  }
  if (!bit) return 'nobite';
  await shot('08_bite.png');
  await page.mouse.down();
  await page.mouse.up();
  await wait(120);
  if (!['fight', 'landing'].includes(await G('g.fishing.state'))) return 'nohook';
  // crank the reel by circling the mouse, keeping the loop on the side opposite to the fish's pull
  // (fishing.crankHint()); ease off when the line gets too tight. One small step per mouse event.
  let crankA = 0, fightShot = false;
  const ft0 = Date.now();
  for (let i = 0; i < 3000 && Date.now() - ft0 < 100000; i++) {
    const s = await G('(() => { const f = g.fishing; return { st: f.state, T: f.tension, hint: f.crankHint ? f.crankHint() : [g.input.x, g.input.y] }; })()');
    if (s.st !== 'fight') break;
    if (s.T > 0.85) { await wait(80); continue; }
    const hx = Math.max(40, Math.min(W - 40, s.hint[0])), hy = Math.max(70, Math.min(H - 70, s.hint[1]));
    const [ox, oy] = await toPage(hx, hy);
    for (let k = 0; k < 4; k++) {
      crankA += 1.0;
      await page.mouse.move(ox + Math.cos(crankA) * 22 * pxPerL, oy + Math.sin(crankA) * 22 * pxPerL);
    }
    if (!fightShot && Date.now() - ft0 > 2500) { fightShot = true; await shot('09_fight.png'); }
  }
  const st = await G('g.fishing.state');
  note(`fight ended in ${((Date.now() - ft0) / 1000).toFixed(1)}s (${st})`);
  return (await until(() => ['reveal', 'tank', 'coin'].includes(window.FISHTOP.tutorial.step), 15000)) ? 'caught' : 'lost';
}
let result = 'none';
for (let attempt = 0; attempt < 3 && result !== 'caught'; attempt++) {
  result = await fishOnce(attempt);
  if (result !== 'caught') { note(`attempt ${attempt + 1}: ${result}`); await wait(1500); }
}
check('hooked a fish', (await G('(window.__ev.hooked || 0)')) > 0);
check('fight won -> catch', result === 'caught', result);

// ---------------------------------------------------------------- reveal, the jar, Aero
const revealed = await until(() => window.FISHTOP.ui.isOpen('reveal') || window.FISHTOP.tutorial.step !== 'reveal', 10000);
check('catch reveal opens', revealed);
await wait(1200);
await shot('10_reveal.png');
if (await G(`g.ui.isOpen('reveal')`)) { await page.keyboard.press('Enter'); await wait(600); }
if (await G(`g.ui.isOpen('reveal')`)) { await G(`g.ui.close('reveal')`); await wait(400); }
check('fish kept in the jar', (await G('g.state.fish.filter((f) => f.inTank).length')) >= 1, `${await G('g.state.fish.length')} fish`);
await until(() => window.FISHTOP.tutorial.step === 'coin', 8000);
await wait(2200);
await shot('11_jar.png');
// collect the jar's Aero drop by sweeping across the tank window
const tr = await G('(() => { const r = g.aquarium.windowRect && g.aquarium.windowRect(); return r ? [r.x, r.y, r.w, r.h] : null; })()');
if (tr) {
  for (let k = 0; k < 6 && !(await G('(window.__ev.coinCollected || 0)')); k++) {
    for (let x = tr[0] + 8; x < tr[0] + tr[2] - 8; x += 10) { await moveL(x, tr[1] + 18 + ((k * 0.17) % 1) * (tr[3] - 30), 2); await page.mouse.down(); await page.mouse.up(); }
  }
}
check('jar Aero collected', (await G('(window.__ev.coinCollected || 0)')) > 0, `step ${await step()}`);
await until(() => window.FISHTOP.tutorial.step === 'lab', 30000);

// ---------------------------------------------------------------- The Lab
await wait(600);
await shot('12_tut_lab.png');
const labR = await G(`g.desktop.iconRect('lab')`);
check('Lab bubble revealed', !!labR);
await clickRect(labR);
check('Lab opens', await until(() => window.FISHTOP.ui.isOpen('lab'), 6000));
await wait(1200);
await shot('13_lab.png');
const rid = await G('g.tutorial.researchId');
const started = await G(`(() => { const p = g.ui.panels.lab; return p && p.research && g.tutorial.researchId ? p.research(g.tutorial.researchId) : false; })()`);
check('first research started', !!started && (await G('(window.__ev.labStarted || 0)')) > 0, String(rid));
check('tutorial complete', await until(() => window.FISHTOP.state.tutorialDone, 8000));
await G(`g.ui.close('lab')`);
await wait(3000);
check('full menu after the tutorial', await G(`['lab', 'journal', 'map', 'settings'].every((id) => !!g.desktop.iconRect(id))`));
await shot('14_ocean.png');

// ---------------------------------------------------------------- panels
for (const id of ['lab', 'journal', 'inventory', 'wardrobe', 'map', 'settings', 'bait', 'multiplayer']) {
  if (!(await G(`!!g.ui.panels['${id}']`))) { if (id !== 'multiplayer') check(`panel ${id} registered`, false); continue; }
  await G(`g.ui.open('${id}')`);
  await wait(800);
  check(`panel ${id} opens`, await G(`g.ui.isOpen('${id}')`));
  await shot(`15_panel_${id}.png`);
  await G(`g.ui.close('${id}')`);
  await wait(200);
}

// ---------------------------------------------------------------- the seven oceans
const OCEANS = ['shallows', 'fjord', 'junkyard', 'metropolis', 'volcano', 'abyss', 'oscean'];
await G(`(g.state.coins += 99999, OCEANS => { for (const b of OCEANS) if (!g.state.unlockedBiomes.includes(b)) g.state.unlockedBiomes.push(b); })(${JSON.stringify(OCEANS)})`);
for (const b of OCEANS) {
  await until(() => !window.FISHTOP.ocean.travelState, 15000);
  const ok = await G(`g.travel('${b}')`);
  await wait(2200);
  await shot(`16_travel_${b}.png`);
  await until((b) => window.FISHTOP.ocean.biome?.id === b && !window.FISHTOP.ocean.travelState, 20000, b);
  check(`travelled to ${b}`, ok && (await G('g.ocean.biome.id')) === b, await G('g.ocean.biome.id'));
  await wait(1200);
  await shot(`17_${b}.png`);
}
await G('g.setView("aquarium")');
await wait(1500);
await shot('18_aquarium_full.png');
await G('g.setView("ocean")');
await G('g.command("mini")');
await wait(1200);
await shot('19_mini.png');
await G('g.command("mini")');
const fps = await G('g.fps');
check('runs at a playable frame rate', fps > 12, `${Math.round(fps)} fps (headless software rendering)`);

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
