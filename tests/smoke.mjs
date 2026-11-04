// End-to-end smoke test (phase 5). Boots the game in headless Chromium and plays the first session with real
// mouse input: the WebGL 3D opening (a few beats are screenshotted; at Clip's first beat a response bubble is
// clicked with the mouse and the name is picked with key 2 through the dialogue system, then the glossy Skip pill
// is clicked and the choices must reach the save), Clip's tutorial speech bubbles, the free
// starter bait at Dot's Bait Shop (the HUD's only button), casting into the (OS)cean, the hook-set, winning the
// reel fight (cranking by circling, a Shock, holding against surges), the catch card, the fish going into the
// goldfish jar, collecting the jar's Aero, opening The Lab and starting the first research, then asks Clip's hint
// helper for a tip. Then it opens every
// panel, travels to all seven oceans and checks that the console stayed clean. Optional systems are
// feature-detected so the test only fails on real breakage. Screenshots land in tests/out/.
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
// a HUD button rect (the Aero HUD, or the compat desktop stand-in)
const iconRect = (id) => G(`(() => { for (const s of [g.hud, g.desktop]) { try { const r = s && s.iconRect && s.iconRect('${id}'); if (r) return r; } catch (e) {} } return null; })()`);

await page.goto(`http://localhost:${port}/index.html?fresh`);
await until(() => !!window.FISHTOP, 20000);
check('game booted', await G('!!g && g.screen.W > 0'), await G('g.screen.W + "x" + g.screen.H'));
await G(`(window.__ev = {}, ['coinCollected', 'labStarted', 'baitBought', 'baitDownloaded', 'hooked', 'caught', 'escaped', 'revealDone', 'kept'].forEach((e) => g.on(e, () => { window.__ev[e] = (window.__ev[e] || 0) + 1; })), true)`);
const ev = (e) => G(`(window.__ev['${e}'] || 0)`);

// ---------------------------------------------------------------- the 3D opening
const hasIntro = await G('!!(g.tutorial && g.tutorial.intro)');
check('3D opening starts', hasIntro, String(await step()));
if (hasIntro) {
  const ready = await until(() => { const i = window.FISHTOP.tutorial.intro; return !i || i.ready; }, 60000);
  check('opening assets build', ready, `gl=${await G('g.tutorial.intro && g.tutorial.intro.gl')}`);
  check('the opening covers the frame', await G('!g.tutorial.intro || g.tutorial.intro.opaque'));
  note(`renderer: ${(await G('g.tutorial.intro && g.tutorial.intro.gl')) ? 'WebGL2 voxel scene' : '2D fallback'}`);
  // a few beats (seek is the opening's own scrubbing API; software GL in headless is slow, so wait generously)
  const IT = await G('g.tutorial.intro.T');
  for (const [t, name] of [[1.2, '01_intro_sweep.png'], [IT.cast + 0.2, '02_intro_boat.png'], [IT.under + 0.5, '03_intro_underwater.png'], [IT.shadow + 0.9, '04_intro_strike.png'], [IT.breach + 0.5, '05_intro_leap.png'], [IT.flare + 0.4, '06_intro_logo.png']]) {
    if (!(await G('!!g.tutorial.intro'))) break;
    await G(`g.tutorial.intro.seek(${t})`);
    await wait(2600);
    await shot(name);
  }
  // Clip's first beat: crash zoom, floating 3D text, typed lines; answer with real input
  await G(`g.tutorial.intro.seek(${IT.clip - 0.05})`);
  const choosing = async () => G('!!(g.tutorial.intro && g.tutorial.intro.dialogue.choosing)');
  const press = async (key, n = 40) => { for (let i = 0; i < n && !(await choosing()); i++) { await page.keyboard.press(key); await wait(700); } return choosing(); };
  check('Clip talks at the first beat', await until(() => { const i = window.FISHTOP.tutorial.intro; return i && i.holding === 'clip' && i.dialogue.active; }, 20000));
  check('response bubbles appear', await press('Enter'));
  await shot('02b_intro_choices.png');
  const rects = await G('g.tutorial.intro.choiceRects()');
  check('2-3 response bubbles', Array.isArray(rects) && rects.length >= 2 && rects.length <= 3, JSON.stringify(rects && rects.length));
  if (rects && rects[0]) { await clickL(rects[0].x + rects[0].w / 2, rects[0].y + rects[0].h / 2); await wait(400); }
  check('a response bubble picked by mouse', await until(() => window.FISHTOP.tutorial.intro && window.FISHTOP.tutorial.intro.picks.mood === 'happy', 15000), String(await G('g.tutorial.intro && g.tutorial.intro.picks.mood')));
  // the next question (the name): key 2
  await wait(800);
  if (await press('Enter')) await page.keyboard.press('2');
  check('name picked with key 2', await until(() => window.FISHTOP.state.angler && window.FISHTOP.state.angler.name === 'Reel Deal', 15000), String(await G('g.state.angler && g.state.angler.name')));
  await shot('02c_intro_name.png');
  // the glossy Skip pill (top right)
  const sr = await G('g.tutorial.intro && g.tutorial.intro.skipRect()');
  if (sr) await clickRect(sr);
  const skipped = await until(() => !window.FISHTOP.tutorial.intro, 15000);
  check('Skip pill ends the opening', skipped && (await step()) === 'bait', String(await step()));
  check('choices reach the save', (await G('g.state.clip && g.state.clip.mood')) === 'happy' && (await G('g.state.angler.name')) === 'Reel Deal');
}
check('starts in the (OS)cean', (await G('g.ocean.biome && g.ocean.biome.id')) === 'oscean', await G('g.ocean.biome && g.ocean.biome.id'));
await wait(900);
check('Clip guides the tutorial (dialogue)', !!(await G('g.tutorial.dialogue && g.tutorial.dialogue.line && g.tutorial.dialogue.line.text')), String(await G('g.tutorial.dialogue.line && g.tutorial.dialogue.line.text')));
check('HUD gated during the tutorial', !(await iconRect('lab')) && !(await iconRect('journal')) && !(await iconRect('map')));
await shot('07_tut_bait.png');

// ---------------------------------------------------------------- free starter bait (Dot's Bait Shop)
const hasShop = await G(`!!(g.ui.panels && g.ui.panels.baitshop)`);
if (hasShop) {
  const bs = await iconRect('baitshop');
  check('Bait Shop button visible', !!bs);
  await clickRect(bs);
  check('Bait Shop opens', await until(() => window.FISHTOP.ui.isOpen('baitshop'), 6000));
  await wait(900);
  await shot('08_tut_shop.png');
  // the free starter pack: click it on the shelf, then Take
  const offer = await G(`(() => { const p = g.ui.panels.baitshop; return p.offerRect ? p.offerRect('crumbs') : null; })()`);
  if (offer) { await clickRect(offer); await wait(400); }
  const buy = await G(`(() => { const p = g.ui.panels.baitshop; return p.buyRect || null; })()`);
  if (buy) { await clickRect(buy); await wait(600); }
  if (!(await ev('baitBought')) && !(await ev('baitDownloaded'))) { note('shop click missed; buying through the store API'); await G(`g.store && g.store.buy && g.store.buy('crumbs')`); }
} else {
  note('no bait shop panel: the tutorial hands out a gift');
}
check('free starter bait', await until(() => ['cast', 'wait'].includes(window.FISHTOP.tutorial.step), 10000), String(await step()));
await wait(1500); // the shop tidies itself away
check('more HUD buttons revealed', !!(await iconRect('bait')) || !!(await iconRect('baitshop')));
await shot('09_tut_cast.png');

// ---------------------------------------------------------------- cast, hook-set, fight (the Fishing agent may edit this section)
const W = await G('g.screen.W'), H = await G('g.screen.H');
const pxPerL = await page.evaluate(() => { const g = window.FISHTOP; return g.canvas.getBoundingClientRect().width / g.screen.W; });
const clampX = (x) => Math.max(30, Math.min(W - 30, x)), clampY = (y) => Math.max(60, Math.min(H - 60, y));
let shocked = false, held = 0;
async function fishOnce(attempt) {
  // hook into the water, where Clip points
  const spot = await G('g.tutorial.waterSpot ? g.tutorial.waterSpot() : null') || [W * 0.56, H * 0.62];
  await moveL(clampX(spot[0]), clampY(spot[1]), 20);
  await wait(600);
  if (attempt === 0) check('cast into the water', ['wait', 'hook', 'fight'].includes(await step()), String(await step()));
  // jiggle near the closest fish until one bites
  let bit = false;
  const t0 = Date.now();
  for (let i = 0; !bit && Date.now() - t0 < 60000; i++) {
    await wait(120);
    bit = ['bite', 'fight'].includes(await G('g.fishing.state')); // (the rod may set the hook by itself)
    if (!bit && i % 25 === 24) {
      const near = await G(`(() => { const h = g.fishing.hook, s = g.world.surfaceY ?? 0; let best = null, bd = 1e9; for (const f of g.school.fishes) { if (f.z > 0.6 || f.y < s + 12) continue; const d = Math.hypot(f.x - h.x, f.y - h.y); if (d < bd) { bd = d; best = f; } } if (!best) return null; const c = g.camera; return c && c.worldToScreen ? c.worldToScreen(best.x + (best.facing || 1) * 26, best.y) : [best.x, best.y]; })()`);
      if (near) await moveL(clampX(near[0]), clampY(near[1]), 10);
      await page.mouse.down(); await page.mouse.up(); // jiggle the lure
    }
  }
  if (!bit) return 'nobite';
  if ((await G('g.fishing.state')) === 'bite') {
    if (attempt === 0) { await shot('10_tut_hookset.png'); check('hook-set cue', (await step()) === 'hook', String(await step())); }
    await page.mouse.down(); await page.mouse.up(); await wait(120);
  }
  if (!['fight', 'landing'].includes(await G('g.fishing.state'))) return 'nohook';
  // crank the reel by circling the mouse, keeping the loop on the side opposite to the fish's pull
  // (fishing.crankHint()); hold + drag against surges; one Shock; ease off when the line gets too tight.
  let crankA = 0, fightShot = false;
  const ft0 = Date.now();
  for (let i = 0; i < 3000 && Date.now() - ft0 < 100000; i++) {
    const s = await G(`(() => { const f = g.fishing, B = f.battle; return { st: f.state, T: f.tension, hint: f.crankHint ? f.crankHint() : [g.input.x, g.input.y], mode: B && B.mode, pull: B && B.pullDir, ready: !!(B && B.shockReady) }; })()`);
    if (s.st !== 'fight') break;
    if (!shocked && s.ready && Date.now() - ft0 > 1500) { await page.keyboard.press('Space'); shocked = true; await wait(150); continue; }
    if (s.mode === 'surge' && typeof s.pull === 'number') {
      // hold the button and drag against the surge
      const [ox, oy] = await toPage(clampX(s.hint[0]), clampY(s.hint[1]));
      await page.mouse.move(ox, oy); await page.mouse.down();
      for (let k = 1; k <= 6; k++) await page.mouse.move(ox - Math.cos(s.pull) * k * 9 * pxPerL, oy - Math.sin(s.pull) * k * 9 * pxPerL);
      await page.mouse.up();
      held++;
      continue;
    }
    if (s.T > 0.85) { await wait(80); continue; }
    const [ox, oy] = await toPage(clampX(s.hint[0]), clampY(s.hint[1]));
    for (let k = 0; k < 4; k++) {
      crankA += 1.0;
      await page.mouse.move(ox + Math.cos(crankA) * 22 * pxPerL, oy + Math.sin(crankA) * 22 * pxPerL);
    }
    if (!fightShot && Date.now() - ft0 > 2500) { fightShot = true; await shot('11_fight.png'); }
  }
  const st = await G('g.fishing.state');
  note(`fight ended in ${((Date.now() - ft0) / 1000).toFixed(1)}s (${st}; shock ${shocked ? 'used' : 'not used'}, ${held} surge holds)`);
  return (await until(() => ['card', 'tank', 'coin'].includes(window.FISHTOP.tutorial.step), 15000)) ? 'caught' : 'lost';
}
let result = 'none';
for (let attempt = 0; attempt < 3 && result !== 'caught'; attempt++) {
  result = await fishOnce(attempt);
  if (result !== 'caught') { note(`attempt ${attempt + 1}: ${result}`); await wait(1500); }
}
check('hooked a fish', (await ev('hooked')) > 0);
check('fight won -> catch', result === 'caught', result);

// ---------------------------------------------------------------- catch card, the jar, Aero
const revealed = await until(() => window.FISHTOP.ui.isOpen('reveal') || window.FISHTOP.tutorial.step !== 'card', 10000);
check('catch card opens', revealed);
await wait(1200);
await shot('12_catch_card.png');
if (await G(`g.ui.isOpen('reveal')`)) { await page.keyboard.press('Enter'); await wait(600); }
if (await G(`g.ui.isOpen('reveal')`)) { await G(`g.ui.close('reveal')`); await wait(400); }
check('fish kept in the jar', (await G('g.state.fish.filter((f) => f.inTank).length')) >= 1, `${await G('g.state.fish.length')} fish`);
await until(() => window.FISHTOP.tutorial.step === 'coin', 8000);
await wait(2200);
await shot('13_jar.png');
// collect the jar's Aero drop by sweeping across the tank window
const tr = await G('(() => { const r = g.aquarium.windowRect && g.aquarium.windowRect(); return r ? [r.x, r.y, r.w, r.h] : null; })()');
if (tr) {
  for (let k = 0; k < 6 && !(await ev('coinCollected')); k++) {
    for (let x = tr[0] + 8; x < tr[0] + tr[2] - 8; x += 10) { await moveL(x, tr[1] + 18 + ((k * 0.17) % 1) * (tr[3] - 30), 2); await page.mouse.down(); await page.mouse.up(); }
  }
}
check('jar Aero collected', (await ev('coinCollected')) > 0, `step ${await step()}`);
await until(() => window.FISHTOP.tutorial.step === 'lab', 30000);

// ---------------------------------------------------------------- The Lab
await wait(700);
await shot('14_tut_lab.png');
const labR = await iconRect('lab');
check('Lab button revealed', !!labR);
await clickRect(labR);
check('Lab opens', await until(() => window.FISHTOP.ui.isOpen('lab'), 6000));
await wait(1200);
await shot('15_lab.png');
const rid = await G('g.tutorial.researchId');
const started = await G(`(() => { const p = g.ui.panels.lab; return p && p.research && g.tutorial.researchId ? p.research(g.tutorial.researchId) : false; })()`);
check('first research started', !!started && (await ev('labStarted')) > 0, String(rid));
check('tutorial complete', await until(() => window.FISHTOP.state.tutorialDone, 8000));
await G(`g.ui.close('lab')`);
await wait(3000);
check('full HUD after the tutorial', !!(await iconRect('lab')) && !!(await iconRect('journal')) && !!(await iconRect('map')));
// Clip's "keep me around?" question auto-answers yes; then the hint helper gives a tip on click
await until(() => !window.FISHTOP.tutorial.active, 20000);
const hr = await G('g.tutorial.helperRect && g.tutorial.helperRect()');
check('Clip hint helper available', !!hr);
if (hr) {
  await clickRect(hr);
  check('hint helper gives a tip', await until(() => { const d = window.FISHTOP.tutorial.dialogue; return !!(d && d.line && d.line.text); }, 6000), String(await G('g.tutorial.dialogue.line && g.tutorial.dialogue.line.text')));
}
await shot('16_ocean.png');

// ---------------------------------------------------------------- panels
for (const id of ['lab', 'journal', 'inventory', 'wardrobe', 'map', 'settings', 'bait', 'baitshop', 'multiplayer']) {
  if (!(await G(`!!g.ui.panels['${id}']`))) { if (id !== 'multiplayer') check(`panel ${id} registered`, false); continue; }
  await G(`g.ui.open('${id}')`);
  await wait(800);
  check(`panel ${id} opens`, await G(`g.ui.isOpen('${id}')`));
  await shot(`17_panel_${id}.png`);
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
  await shot(`18_travel_${b}.png`);
  await until((b) => window.FISHTOP.ocean.biome?.id === b && !window.FISHTOP.ocean.travelState, 20000, b);
  check(`travelled to ${b}`, ok !== false && (await G('g.ocean.biome.id')) === b, await G('g.ocean.biome.id'));
  await wait(1200);
  await shot(`19_${b}.png`);
}
if (await G('typeof g.setView === "function"')) {
  await G('g.setView("aquarium")');
  await wait(1500);
  await shot('20_aquarium_full.png');
  await G('g.setView("ocean")');
  await wait(600);
}
const fps = await G('g.fps');
check('runs at a playable frame rate', fps > 12, `${Math.round(fps)} fps (headless software rendering)`);

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
