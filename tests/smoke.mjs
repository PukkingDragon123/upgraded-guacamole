// End-to-end smoke test: boots the game in headless Chromium, plays through the intro with real
// mouse input (drag an icon into the bait box, hook the first fish, fight it by circling the mouse
// to crank the reel), checks the I GOT IT finale, the flood,
// the reveal, the aquarium coin and the first skill, then exercises panels and travel. Fails on any
// console error. Screenshots land in tests/out/.
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
    res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' });
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
const G = (expr) => page.evaluate(`(() => { const g = window.FISHTOP; return ${expr}; })()`);
const wait = (ms) => page.waitForTimeout(ms);
// logical -> page pixels
async function toPage(x, y) {
  return page.evaluate(([x, y]) => {
    const g = window.FISHTOP, r = g.canvas.getBoundingClientRect();
    return [r.left + (x / g.screen.W) * r.width, r.top + (y / g.screen.H) * r.height];
  }, [x, y]);
}
async function moveL(x, y, steps = 12) { const [px, py] = await toPage(x, y); await page.mouse.move(px, py, { steps }); }

await page.goto(`http://localhost:${port}/index.html?fresh`);
await wait(1500);
check('game booted', await G('!!g && g.screen.W > 0'), await G('g.screen.W + "x" + g.screen.H'));
await page.screenshot({ path: join(out, '01_desktop.png') });

// ---- intro
await page.mouse.click(5, 5);
await page.waitForFunction(() => window.FISHTOP.tutorial.step === 'crab', null, { timeout: 40000 }).catch(() => {});
check('intro reached the crab', await G('g.tutorial.step') === 'crab', await G('g.tutorial.step'));
await wait(1500);
await page.screenshot({ path: join(out, '02_crab.png') });
// drag the first visible icon into the bait box
const drag = await G(`(() => { const ic = g.desktop.icons.find((i) => i.state === 'normal' && i !== g.tutorial.hideIcon); const b = g.desktop.box; return [ic.x + ic.w / 2, ic.y + 14, b.x + b.w / 2, b.y + 14]; })()`);
await moveL(drag[0], drag[1]);
await page.mouse.down();
await moveL(drag[0] + 20, drag[1] + 20, 5);
await moveL(drag[2], drag[3], 20);
await page.mouse.up();
await wait(300);
check('icon stored in bait box', await G('g.state.baitBox.length') === 1);
check('bait equipped', await G('!!g.currentBait()'));

// ---- lure the intro fish: hold the hook still near it
const fishPos = await G('(() => { const f = g.school.fishes[0]; return f ? [f.x, f.y] : null; })()');
check('intro fish exists', !!fishPos);
await moveL(Math.max(fishPos[0] + 160, 360), fishPos[1] + 10, 30);
let bit = false;
for (let i = 0; i < 300 && !bit; i++) {
  await wait(100);
  bit = (await G('g.fishing.state')) === 'bite';
  if (!bit && i % 20 === 19) { const h = await G('[g.fishing.hook.x, g.fishing.hook.y]'); await moveL(h[0] + 3, h[1] + 2, 3); }
}
check('fish bit the bait', bit, await G('g.fishing.state'));
await page.screenshot({ path: join(out, '03_bite.png') });
await page.mouse.down();
await page.mouse.up();
await wait(100);
check('hook set -> fight', ['fight', 'landing'].includes(await G('g.fishing.state')), await G('g.fishing.state'));

// ---- fight: crank the reel by circling the mouse quickly, keeping the loop on the side opposite
// to the fish's pull (fishing.crankHint() = where the HUD's green pull zone is); ease off when the
// line gets too tight. One small step per mouse event (each event lands on its own frame).
const pxPerL = await page.evaluate(() => { const g = window.FISHTOP; return g.canvas.getBoundingClientRect().width / g.screen.W; });
let crankA = 0, fightShot = false;
const fightT0 = Date.now();
for (let i = 0; i < 2000 && Date.now() - fightT0 < 90000; i++) {
  const s = await G('(() => { const f = g.fishing; return { st: f.state, T: f.tension, hint: f.crankHint ? f.crankHint() : [g.input.x, g.input.y], W: g.screen.W, H: g.screen.H }; })()');
  if (s.st !== 'fight') break;
  if (s.T > 0.85) { await wait(80); continue; }
  const hx = Math.max(40, Math.min(s.W - 40, s.hint[0])), hy = Math.max(70, Math.min(s.H - 70, s.hint[1]));
  const [ox, oy] = await toPage(hx, hy);
  for (let k = 0; k < 4; k++) {
    crankA += 1.0;
    await page.mouse.move(ox + Math.cos(crankA) * 22 * pxPerL, oy + Math.sin(crankA) * 22 * pxPerL);
  }
  if (!fightShot && Date.now() - fightT0 > 2500) { fightShot = true; await page.screenshot({ path: join(out, '04_fight.png') }); }
}
check('fight won by cranking', ['landing', 'idle'].includes(await G('g.fishing.state')) && (await G('g.state.stats.escaped')) === 0, `${await G('g.fishing.state')} in ${((Date.now() - fightT0) / 1000).toFixed(1)}s`);
await wait(1800);
await page.screenshot({ path: join(out, '04b_igotit.png') });
await page.waitForFunction(() => ['flood', 'reveal', 'tank'].includes(window.FISHTOP.tutorial.step), null, { timeout: 15000 }).catch(() => {});
check('first fish caught -> flood', ['flood', 'reveal', 'tank'].includes(await G('g.tutorial.step')), await G('g.tutorial.step'));
await wait(2500);
await page.screenshot({ path: join(out, '05_flood.png') });
await page.waitForFunction(() => window.FISHTOP.ui.isOpen('reveal'), null, { timeout: 10000 }).catch(() => {});
check('catch reveal opened', await G('g.ui.isOpen("reveal")'));
await wait(1200);
await page.screenshot({ path: join(out, '06_reveal.png') });
await page.keyboard.press('Enter');
await wait(500);
check('fish kept', await G('g.state.fish.length') === 1);
await page.waitForFunction(() => window.FISHTOP.tutorial.step === 'coin', null, { timeout: 8000 }).catch(() => {});
await wait(2500);
await page.screenshot({ path: join(out, '07_tank.png') });
// collect the coin by sweeping over the tank window
const tr = await G('(() => { const r = g.aquarium.windowRect && g.aquarium.windowRect(); return r ? [r.x, r.y, r.w, r.h] : null; })()');
if (tr) {
  for (let k = 0; k < 4; k++) for (let x = tr[0] + 10; x < tr[0] + tr[2] - 10; x += 12) { await moveL(x, tr[1] + tr[3] - 14 - k * 10, 2); await page.mouse.down(); await page.mouse.up(); }
}
await page.waitForFunction(() => ['skill', 'done'].includes(window.FISHTOP.tutorial.step), null, { timeout: 8000 }).catch(() => {});
check('first coin collected', ['skill', 'done'].includes(await G('g.tutorial.step')), await G('g.tutorial.step'));
await wait(1800);
await page.screenshot({ path: join(out, '08_skilltree.png') });
await G('g.unlockSkill("hook1")');
await wait(800);
check('tutorial complete', await G('g.state.tutorialDone'));
await wait(3000);
await page.screenshot({ path: join(out, '09_ocean.png') });

// ---- panels & travel
for (const id of ['journal', 'shop', 'skills', 'map', 'settings', 'bait']) {
  await G(`g.ui.open('${id}')`);
  await wait(700);
  check(`panel ${id} opens`, await G(`g.ui.isOpen('${id}')`));
  await page.screenshot({ path: join(out, `10_panel_${id}.png`) });
  await G('g.ui.close()');
}
await G('(g.state.coins += 99999, g.state.skills.hook5 = g.state.skills.hook7 = true, g.state.unlockedBiomes.push("junkyard", "abyss"), g.recomputeStats())');
for (const b of ['junkyard', 'abyss']) {
  await G(`g.travel('${b}')`);
  await wait(2200);
  await page.screenshot({ path: join(out, `11_travel_${b}.png`) });
  await wait(4500);
  check(`travelled to ${b}`, await G('g.ocean.biome.id') === b);
  await page.screenshot({ path: join(out, `12_${b}.png`) });
}
await G('g.setView("aquarium")');
await wait(1500);
await page.screenshot({ path: join(out, '13_aquarium_full.png') });
await G('g.setView("ocean")');
await G('g.command("mini")');
await wait(1200);
await page.screenshot({ path: join(out, '14_mini.png') });
const fps = await G('g.fps');
check('runs at a playable frame rate', fps > 20, `${Math.round(fps)} fps (headless software rendering)`);

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
