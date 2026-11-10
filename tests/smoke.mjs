// End-to-end smoke test (phase 5 Intro agent, phase 6 Guide agent). Boots the game in headless Chromium and plays
// the first session with real mouse input: the WebGL 3D opening (a few beats are screenshotted; at the seal's first
// beat a response bubble is clicked with the mouse and the name is picked with key 2 through the dialogue system,
// then the glossy Skip pill is clicked and the choices must reach the save), Bubbles the low-poly seal guide
// swimming around the screen and pointing at things while it talks in (bigger) speech bubbles, the free starter
// bait at Dot's Bait Shop (the HUD's only button), casting into the (OS)cean, the hook-set (spinning the 3D gear
// into its band when the gear minigame is there, else a click), winning the fight (spinning / cranking by circling,
// a Shock, holding against surges), the catch card, the fish going into the goldfish jar, collecting the jar's Aero,
// opening The Lab and starting the first research, the 'tutorialDone' event (quest lines start), then asks the
// seal's hint helper for a tip. Then it opens every panel, travels to all seven oceans and checks that the console
// stayed clean. Optional systems are feature-detected so the test only fails on real breakage. Screenshots land in
// tests/out/. Ownership: Guide agent; the Fishing agent may edit the scripted fight (marked below).
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
// waits scale with SMOKE_SLOW (default 3): headless software GL on a shared, busy machine can run at a few fps
const SLOW = Math.max(1, Number(process.env.SMOKE_SLOW || 3));
const until = (fn, timeout, arg) => page.waitForFunction(fn, arg, { timeout: timeout * SLOW, polling: 100 }).then(() => true).catch(() => false);
// screenshots are best-effort: a busy machine (software GL) must not crash the run
const shot = (name) => page.screenshot({ path: join(out, name), timeout: 120000 }).catch((e) => note(`screenshot ${name} skipped: ${String(e.message).split('\n')[0]}`));
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
await G(`(window.__ev = {}, ['coinCollected', 'labStarted', 'baitBought', 'baitDownloaded', 'hooked', 'caught', 'escaped', 'revealDone', 'kept', 'tutorialDone'].forEach((e) => g.on(e, () => { window.__ev[e] = (window.__ev[e] || 0) + 1; })), true)`);
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
  // the seal's first beat: crash zoom, floating 3D text, typed lines; answer with real input
  await G(`g.tutorial.intro.seek(${(IT.seal ?? IT.clip) - 0.05})`);
  const choosing = async () => G('!!(g.tutorial.intro && g.tutorial.intro.dialogue.choosing)');
  const press = async (key, n = 40 * SLOW) => { for (let i = 0; i < n && !(await choosing()); i++) { await page.keyboard.press(key); await wait(700); } return choosing(); };
  check('Bubbles the seal talks at the first beat', await until(() => { const i = window.FISHTOP.tutorial.intro; return i && (i.holding === 'seal' || i.holding === 'clip') && i.dialogue.active; }, 20000), String(await G('g.tutorial.intro && g.tutorial.intro.dialogue.name')));
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
  // (a slow frame can swallow a click: try the pill up to three times until the skip starts)
  for (let k = 0; k < 3; k++) {
    const sr = await G('g.tutorial.intro && g.tutorial.intro.skipRect()');
    if (!sr) break;
    await clickRect(sr);
    if (await until(() => { const i = window.FISHTOP.tutorial.intro; return !i || i.skipT >= 0; }, 20000)) break;
    note('the Skip click did not register yet; clicking again');
  }
  const skipped = await until(() => !window.FISHTOP.tutorial.intro, 40000);
  check('Skip pill ends the opening', skipped && (await step()) === 'bait', String(await step()));
  check('choices reach the save', (await G('g.state.clip && g.state.clip.mood')) === 'happy' && (await G('g.state.angler.name')) === 'Reel Deal');
}
check('starts in the (OS)cean', (await G('g.ocean.biome && g.ocean.biome.id')) === 'oscean', await G('g.ocean.biome && g.ocean.biome.id'));
await wait(900);
check('Bubbles guides the tutorial (dialogue)', await until(() => { const d = window.FISHTOP.tutorial.dialogue; return !!(d && d.line && d.line.text); }, 20000), String(await G('g.tutorial.dialogue.line && g.tutorial.dialogue.line.text')));
check('bigger dialogue text', (await G('g.tutorial.dialogue.fontSize || 16')) >= 20, `Alagard ${await G('g.tutorial.dialogue.fontSize')}px`);
check('HUD gated during the tutorial', !(await iconRect('lab')) && !(await iconRect('journal')) && !(await iconRect('map')));
// Bubbles swims around the screen (smooth physics) to the Bait Shop button and points at it with a flipper
const hasSeal = await G('!!(g.tutorial.seal && g.tutorial.seal.update)');
check('the seal guide exists', hasSeal);
if (hasSeal) {
  await G(`(window.__seal = { anims: {}, xs: [] }, (function watch() { const S = window.FISHTOP.tutorial.seal; window.__seal.anims[S.anim] = 1; window.__seal.xs.push(S.x); if (window.__seal.xs.length < 4000) setTimeout(watch, 50); })(), true)`);
  const swam = await until(() => window.__seal.anims.swim, 15000);
  check('the seal swims around the screen', swam, JSON.stringify(await G('Object.keys(window.__seal.anims)')));
  const pointed = await until(() => { const S = window.FISHTOP.tutorial.seal; return S.anim === 'point' && !!S.pointP; }, 30000);
  const sp = await G('(() => { const S = g.tutorial.seal; return { x: Math.round(S.x), y: Math.round(S.y), p: S.pointP && S.pointP.map(Math.round), r: S.rect() }; })()');
  check('the seal points at the Bait Shop button', pointed, JSON.stringify(sp));
  const near = sp && sp.p && Math.hypot(sp.p[0] - sp.x, sp.p[1] - sp.y) < 260;
  check('the seal perches beside its target', !!near);
}
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
// [phase9:fishing] The simple fight: a CLICK sets the hook when the big "!" pops; circling the mouse reels; when the
// fish braces / pulls (battle.mode 'warn' | 'pull') the circling stops until the pull is over; one SHOCK: hold Space
// until the bolt is full (battle.charge.k >= 1), then let go.
const W = await G('g.screen.W'), H = await G('g.screen.H');
const pxPerL = await page.evaluate(() => { const g = window.FISHTOP; return g.canvas.getBoundingClientRect().width / g.screen.W; });
const clampX = (x) => Math.max(30, Math.min(W - 30, x)), clampY = (y) => Math.max(60, Math.min(H - 60, y));
let shocked = false, eased = 0;
// Circle the mouse. each(s) -> true (stop) | 'skip' (it handled this tick) | false. A background mover circles the
// mouse at a wall-clock angular speed scaled by how fast the game clock runs (slow headless frames), so the game
// sees a steady ~1.6 turns per second.
const spinCtl = { omega: 0, paused: false, dil: 0 };
const gameClock = () => G('g.fishing.t || 0');
async function spinGear(each, ms) {
  const [pcx, pcy] = await toPage(W * 0.42, H * 0.55);
  if (!spinCtl.dil) { // calibrate: how much game time passes per wall-clock second right now
    const g0 = await gameClock(), w0 = Date.now();
    await wait(700);
    const g1 = await gameClock();
    spinCtl.dil = g1 > g0 ? Math.max(0.8, Math.min(6, (Date.now() - w0) / 1000 / (g1 - g0))) : 2;
    note(`game clock: ${(1 / spinCtl.dil).toFixed(2)}x wall time`);
  }
  const t0 = Date.now();
  const R = 40 * pxPerL;
  let s = null, run = true, a = 0, last = Date.now(), prevW = 0, prevT = 0;
  const mover = (async () => {
    while (run) {
      const now = Date.now();
      a += (spinCtl.omega * (now - last)) / 1000; last = now;
      if (spinCtl.paused || spinCtl.omega <= 0) { await wait(25); continue; }
      await page.mouse.move(pcx + Math.cos(a) * R, pcy + Math.sin(a) * R);
      await wait(8);
    }
  })();
  try {
    while (Date.now() - t0 < ms) {
      s = await G(`(() => { const f = g.fishing, B = f.battle;
        return { st: f.state, T: f.tension, gt: f.t || 0, mode: B ? B.mode : null, ready: !!(B && B.shockReady), hold: !!(B && 'chargeDur' in B) }; })()`);
      const now = Date.now();
      if (prevW && s.gt > prevT) spinCtl.dil = spinCtl.dil * 0.8 + Math.max(0.7, Math.min(5, (now - prevW) / 1000 / (s.gt - prevT))) * 0.2;
      prevW = now; prevT = s.gt;
      const r = await each(s);
      if (r === true) return s;
      if (r === 'skip') { last = Date.now(); continue; }
      spinCtl.omega = (1.6 * Math.PI * 2) / spinCtl.dil;
      await wait(40);
    }
    return s;
  } finally {
    run = false;
    await mover;
    spinCtl.omega = 0;
  }
}
async function fishOnce(attempt) {
  // hook into the water, where the seal points
  const spot = await G('g.tutorial.waterSpot ? g.tutorial.waterSpot() : null') || [W * 0.56, H * 0.62];
  await moveL(clampX(spot[0]), clampY(spot[1]), 20);
  await wait(600);
  if (attempt === 0) check('cast into the water', ['wait', 'hook', 'fight'].includes(await step()), String(await step()));
  // jiggle near the closest fish until one bites
  let bit = false, assisted = false;
  const t0 = Date.now();
  for (let i = 0; !bit && Date.now() - t0 < 60000 * SLOW; i++) {
    await wait(120);
    bit = ['bite', 'fight'].includes(await G('g.fishing.state')); // (the rod may set the hook by itself)
    if (!bit && !assisted && Date.now() - t0 > 30000 * SLOW) {
      // a slow machine: invite the nearest fish to nibble through the fishing API (it still has to bite and be hooked)
      assisted = await G(`(() => { const f = g.fishing, h = f.hook, s = g.school; if (!s || !f.requestNibble || f.state !== 'idle') return false; let best = null, bd = 1e9; for (const x of s.fishes) { if (x.giant || x.boss || x.controlled) continue; const d = Math.hypot(x.x - h.x, x.y - h.y); if (d < bd) { bd = d; best = x; } } return !!(best && f.requestNibble(best)); })()`);
      if (assisted) note('test assist: the nearest fish was invited to nibble (slow machine)');
    }
    // jiggle / move toward fish only while nothing is already coming for the bait (a click while a fish nibbles
    // scares it off, and a quick mouse move on a slow machine reads as a frantic jerk)
    const keen = !bit && i % 25 === 24 && await G(`g.fishing.state !== 'idle' || g.school.fishes.some((f) => !f.controlled && (f.state === 'interest' || f.state === 'sniff'))`);
    if (!bit && i % 25 === 24 && !keen) {
      const near = await G(`(() => { const h = g.fishing.hook, s = g.world.surfaceY ?? 0; let best = null, bd = 1e9; for (const f of g.school.fishes) { if (f.z > 0.6 || f.y < s + 12) continue; const d = Math.hypot(f.x - h.x, f.y - h.y); if (d < bd) { bd = d; best = f; } } if (!best) return null; const c = g.camera; return c && c.worldToScreen ? c.worldToScreen(best.x + (best.facing || 1) * 26, best.y) : [best.x, best.y]; })()`);
      if (near) await moveL(clampX(near[0]), clampY(near[1]), 10);
      await page.mouse.down(); await page.mouse.up(); // jiggle the lure
    }
  }
  if (!bit) return 'nobite';
  if ((await G('g.fishing.state')) === 'bite') {
    if (attempt === 0) { await shot('10_tut_hookset.png'); check('hook-set cue', (await step()) === 'hook', String(await step())); }
    await page.mouse.down(); await page.mouse.up(); // one click sets the hook
    await until(() => window.FISHTOP.fishing.state !== 'bite', 3000);
  }
  if (!['fight', 'landing'].includes(await G('g.fishing.state'))) return 'nohook';
  // reel: circle the mouse; stop while the fish braces / pulls; one Shock (hold Space until full, then let go)
  const ft0 = Date.now();
  let fightShot = false;
  await spinGear(async (s) => {
    if (s.st !== 'fight') return true;
    if (!fightShot && Date.now() - ft0 > 2500) { fightShot = true; await shot('11_fight.png'); }
    if (!shocked && s.ready && Date.now() - ft0 > 1500) {
      await page.keyboard.down('Space');
      let k = -1;
      for (let i = 0; i < 300; i++) {
        const c = await G('(() => { const B = g.fishing.battle; return B && B.charge ? B.charge.k : null; })()');
        if (c === null) { if (i > 8) break; continue; }
        k = c;
        if (k >= 1) break;
      }
      await page.keyboard.up('Space');
      note(`shock released at charge ${k.toFixed(2)}`);
      shocked = true; await wait(150);
      return false;
    }
    const easing = s.mode === 'warn' || s.mode === 'pull';
    if (easing && !spinCtl.paused) eased++;
    spinCtl.paused = easing || s.T > 0.85;
    return false;
  }, 100000 * SLOW);
  spinCtl.paused = false;
  const st = await G('g.fishing.state');
  note(`fight ended in ${((Date.now() - ft0) / 1000).toFixed(1)}s (${st}; shock ${shocked ? 'used' : 'not used'}, eased off ${eased} pulls)`);
  return (await until(() => ['card', 'tank', 'coin'].includes(window.FISHTOP.tutorial.step), 15000)) ? 'caught' : 'lost';
}
let result = 'none';
for (let attempt = 0; attempt < 3 && result !== 'caught'; attempt++) {
  result = await fishOnce(attempt);
  if (result !== 'caught') { note(`attempt ${attempt + 1}: ${result}`); await wait(1500); }
}
check('hooked a fish', (await ev('hooked')) > 0);
check('fight won -> catch', result === 'caught', result);
if (result !== 'caught' && (await G(`g.fishing.state === 'fight' && !!g.fishing.battle`))) {
  // keep testing the rest of the first session: finish the fight through the battle's progress (reported above)
  note('test assist: landing the hooked fish so the rest of the session can be checked');
  await G(`(g.fishing.battle.progress = 1, true)`);
  await until(() => ['card', 'tank', 'coin'].includes(window.FISHTOP.tutorial.step), 60000);
}

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
if (hasSeal) check('the seal emoted along the way', (await G('Object.keys(window.__seal.anims).length')) >= 3, JSON.stringify(await G('Object.keys(window.__seal.anims)')));
await G(`g.ui.close('lab')`);
await wait(3000);
check('full HUD after the tutorial', !!(await iconRect('lab')) && !!(await iconRect('journal')) && !!(await iconRect('map')));
// the seal's "keep me around?" question auto-answers yes; then the hint helper gives a tip on click
await until(() => !window.FISHTOP.tutorial.active, 20000);
check("'tutorialDone' emitted (quests can start)", (await ev('tutorialDone')) === 1, String(await ev('tutorialDone')));
// the helper swims to its corner and settles on its bubble
await until(() => { const T = window.FISHTOP.tutorial; return !T.seal || (T.helperRect() && T.seal.settled); }, 20000);
const hr = await G('g.tutorial.helperRect && g.tutorial.helperRect()');
check('seal hint helper available', !!hr, JSON.stringify(hr && [Math.round(hr.x), Math.round(hr.y)]));
if (hr) {
  // click the seal (it may still drift a little on a slow machine: re-read its rect and retry)
  let tipped = false;
  for (let k = 0; k < 3 && !tipped; k++) {
    const r = await G('g.tutorial.helperRect && g.tutorial.helperRect()');
    if (!r) break;
    await clickRect(r);
    tipped = await until(() => { const d = window.FISHTOP.tutorial.dialogue; return !!(d && d.line && d.line.text); }, 5000);
  }
  check('hint helper gives a tip', tipped, String(await G('g.tutorial.dialogue.line && g.tutorial.dialogue.line.text')));
}
await shot('16_ocean.png');

// ---------------------------------------------------------------- panels
const OPTIONAL_PANELS = ['multiplayer', 'quests'];
for (const id of ['lab', 'journal', 'inventory', 'wardrobe', 'map', 'settings', 'bait', 'baitshop', 'multiplayer', 'quests']) {
  if (!(await G(`!!g.ui.panels['${id}']`))) { if (!OPTIONAL_PANELS.includes(id)) check(`panel ${id} registered`, false); continue; }
  await G(`g.ui.open('${id}')`);
  await wait(800);
  check(`panel ${id} opens`, await G(`g.ui.isOpen('${id}')`));
  await shot(`17_panel_${id}.png`);
  await G(`g.ui.close('${id}')`);
  await wait(200);
}

// ---------------------------------------------------------------- [phase8:prog] Workshop, chest minigame, destinations
if (await G('!!(g.ui.panels.workshop && g.ui.panels.crate && g.dest)')) {
  await G(`((g.state.workshop ||= {}).unlocked = true, g.ui.open('workshop', { cat: 'tackle' }))`);
  await wait(800);
  check('Workshop opens', await G(`g.ui.isOpen('workshop')`));
  await shot('17_panel_workshop.png');
  await G(`g.ui.close('workshop')`);
  await G(`(g.state.inventory.packages.push({ uid: 'smoke', tier: 'crate', from: null, at: 1 }), g.ui.open('crate', { uid: 'smoke' }))`);
  await until(() => window.FISHTOP.ui.panels.crate.phase === 'play', 6000);
  for (let i = 0; i < 16; i++) {
    const sp = await G(`(() => { const p = g.ui.panels.crate; const s = p.phase === 'play' && p.spots[0]; return s ? [Math.round(s.x), Math.round(s.y)] : null; })()`);
    if (!sp) break;
    await clickL(sp[0], sp[1]);
    await until((n) => window.FISHTOP.ui.panels.crate.hits > n || window.FISHTOP.ui.panels.crate.phase !== 'play', 3000, i);
  }
  check('chest cracked open by tapping its weak points', await until(() => window.FISHTOP.ui.panels.crate.phase === 'loot', 8000), `hits ${await G('g.ui.panels.crate.hits')}`);
  check('chest loot granted', (await G(`(g.ui.panels.crate.loot || []).length`)) > 0 && !(await G(`g.state.inventory.packages.some((p) => p.uid === 'smoke')`)));
  await shot('17_chest_open.png');
  await G(`g.ui.close('crate')`);
  await wait(300);
  await G(`g.dest.sail('workshop')`);
  check('sailed to the Workshop dock', await until(() => window.FISHTOP.dest.phase === 'docked' && window.FISHTOP.ui.isOpen('workshop'), 12000), String(await G('g.dest.phase')));
  await shot('17_dest_workshop.png');
  await G(`(g.ui.close('workshop'), g.dest.leave())`);
  check('set sail back to the ocean', await until(() => !window.FISHTOP.dest.active, 8000));
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
