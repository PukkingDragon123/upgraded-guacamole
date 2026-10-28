// End-to-end test of the UNPACKED extension in Chromium (new headless, --load-extension):
// manifest checks, service worker, overlay injection, fishing mode, tab-to-tab hand-off, catch bucket,
// popup, and delivery to a FISHTOP game page through the bridge (stub game on localhost:5173).
//   node tools/build.mjs && node extension/test/run-ext.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm, access, cp } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
const { chromium } = req(process.env.PW_PATH || (() => { try { return req.resolve('playwright'); } catch { return '/opt/node22/lib/node_modules/playwright'; } })());
const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, '..');
const out = join(here, 'out');
await mkdir(out, { recursive: true });

let failures = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  - ' + info : ''}`);
  if (!ok) failures++;
}
const exists = (p) => access(join(extDir, p)).then(() => true, () => false);

// ---- static manifest validation
const man = JSON.parse(await readFile(join(extDir, 'manifest.json'), 'utf8'));
check('manifest v3', man.manifest_version === 3);
check('minimal permissions', JSON.stringify(man.permissions.slice().sort()) === JSON.stringify(['activeTab', 'scripting', 'storage']), man.permissions.join(','));
check('no required host permissions', !man.host_permissions);
check('host access optional only', JSON.stringify(man.optional_host_permissions) === JSON.stringify(['http://*/*', 'https://*/*']));
check('fishing shortcut Alt+Shift+F', man.commands?.['toggle-fishing']?.suggested_key?.default === 'Alt+Shift+F');
check('bridge limited to the game page', man.content_scripts.length === 1 && man.content_scripts[0].matches.every((m) => /localhost:5173|127\.0\.0\.1:5173|fishtop|FISHTOP/.test(m)), man.content_scripts[0].matches.join(' '));
const files = [man.background.service_worker, man.action.default_popup, 'popup.js', 'overlay.js', ...man.content_scripts.flatMap((c) => c.js), ...Object.values(man.icons), ...Object.values(man.action.default_icon)];
const missing = [];
for (const f of files) if (!(await exists(f))) missing.push(f);
check('all referenced files exist', !missing.length, missing.join(','));
check('no remote code / network APIs in extension sources', !(await Promise.all(['background.js', 'popup.js', 'bridge.js', 'overlay.js'].map((f) => readFile(join(extDir, f), 'utf8'))))
  .some((src) => /\bfetch\(|XMLHttpRequest|WebSocket\(|sendBeacon|EventSource\(|importScripts\(/.test(src)));

// ---- local servers: 5173 = the FISHTOP game origin (bridge match), 5174 = an ordinary website
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const handler = async (rq, res) => {
  const p = new URL(rq.url, 'http://x').pathname.replace(/^\/+/, '');
  if (p === 'favicon.ico') { res.writeHead(204).end(); return; }
  try {
    const body = await readFile(join(here, p));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
};
const servers = [];
for (const port of [5173, 5174]) {
  const sv = createServer(handler);
  await new Promise((ok, bad) => { sv.once('error', bad); sv.listen(port, '127.0.0.1', ok); });
  servers.push(sv);
}
const errors = [];
const watch = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${tag} ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(dir) {
  const profile = await mkdtemp(join(tmpdir(), 'fishtop-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1600, height: 900 },
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  return { ctx, sw, profile };
}

// ---- phase 1: the extension exactly as shipped
{
  const { ctx, sw, profile } = await launch(extDir);
  check('extension loaded (service worker running)', !!sw, sw?.url());
  if (sw) {
    const cmds = await sw.evaluate(() => chrome.commands.getAll());
    check('command registered', cmds.some((c) => c.name === 'toggle-fishing'), JSON.stringify(cmds.map((c) => [c.name, c.shortcut])));
    check('roaming refused without granted host access', (await sw.evaluate(() => setRoaming(true)))?.error === 'permission');
    const W = await ctx.newPage(); watch(W, 'site');
    await W.goto('http://localhost:5174/ext-test.html');
    const denied = await sw.evaluate(async () => {
      const out = [];
      for (const t of await chrome.tabs.query({})) out.push(await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => 1 }).then(() => 'ok', () => 'denied'));
      return out;
    });
    check('no access to ordinary sites until the user grants it', denied.every((d) => d === 'denied'), denied.join(','));
    check('no overlay on a site the user did not enable', !(await W.evaluate(() => !!document.querySelector('fishtop-overlay'))));
    const G0 = await ctx.newPage(); watch(G0, 'game0');
    await G0.goto('http://localhost:5173/ext-test.html?bridge');
    // the bridge keeps saying hello until a game answers; a page that never answers gets nothing else
    const seen = await G0.evaluate(() => new Promise((res) => { const got = []; window.addEventListener('message', (e) => { if (e.source === window && e.data?.type) got.push(e.data.type); }); setTimeout(() => res(got), 3500); }));
    check('bridge content script runs on the FISHTOP page', seen.includes('fishtop:bridge-hello') && seen.every((t) => t === 'fishtop:bridge-hello'), seen.join(','));
  }
  await ctx.close();
  await rm(profile, { recursive: true, force: true });
}

// ---- phase 2: a temp copy whose manifest grants the optional host access up front
// (stands in for the activeTab grant from clicking the toolbar button and for the roaming permission
// prompt, neither of which a headless test can click)
const grantedDir = await mkdtemp(join(tmpdir(), 'fishtop-ext-granted-'));
await cp(extDir, grantedDir, { recursive: true, filter: (src) => !src.includes(join('test', 'out')) });
await writeFile(join(grantedDir, 'manifest.json'), JSON.stringify({ ...man, host_permissions: man.optional_host_permissions }, null, 2));
const { ctx, sw, profile } = await launch(grantedDir);
if (!sw) { console.log('FAIL  granted copy did not load'); process.exit(1); }
const extId = sw.url().split('/')[2];
const SW = (fn, arg) => sw.evaluate(fn, arg);

const A = await ctx.newPage(); watch(A, 'A');
await A.goto('http://localhost:5173/ext-test.html?tab=a');
const B = await ctx.newPage(); watch(B, 'B');
await B.goto('http://localhost:5173/ext-test.html?tab=b');
// headless Chromium reports tabs without URLs, so ask each tab where it is (allowed by the bridge's host match)
const ids = await SW(async () => {
  const out = [];
  for (const t of await chrome.tabs.query({})) {
    try { const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => location.href }); out.push([t.id, r.result]); } catch { /* no access */ }
  }
  return out;
});
const idA = ids.find((t) => t[1].includes('tab=a'))?.[0], idB = ids.find((t) => t[1].includes('tab=b'))?.[0];
check('found both test tabs', idA && idB, JSON.stringify(ids));

// "Fish in this tab" (the popup calls enableTab; activeTab is replaced here by the bridge's host match)
const enA = await SW((id) => enableTab(id), idA);
const enB = await SW((id) => enableTab(id), idB);
check('overlay injected into tab A and B', enA?.ok && enB?.ok, JSON.stringify([enA, enB]));
await A.bringToFront();
await wait(6000);
const pA = await SW((id) => ping(id), idA), pB = await SW((id) => ping(id), idB);
check('fish swimming in tab A', pA?.alive && pA.count >= 1, JSON.stringify(pA));
check('overlay alive in tab B', pB?.alive, JSON.stringify(pB));
const reg = await SW(() => readReg());
check('both tabs registered with the worker', reg.tabs[idA] && reg.tabs[idB], Object.keys(reg.tabs).join(','));
await A.screenshot({ path: join(out, 'ext_01_tab_a.png') });

// tab-to-tab hand-off: fewer fish per tab makes the extras swim off the edge into the other tab
await SW(() => { self.__hand = []; const orig = handOff; handOff = async (...a) => { const r = await orig(...a); self.__hand.push({ from: a[0], ...r }); return r; }; });
await SW(() => patchSettings({ fishCount: 1 }));
let hands = [];
for (let i = 0; i < 40 && !hands.some((h) => h.ok); i++) { await wait(1000); hands = await SW(() => self.__hand); }
check('a fish swam off one tab and was handed to the other', hands.some((h) => h.ok), JSON.stringify(hands.slice(0, 4)));
const hop = hands.find((h) => h.ok);
const dest = hop?.to === idA ? A : B;
await dest.bringToFront();
let landed = null;
for (let i = 0; i < 30; i++) { await wait(250); landed = await SW((id) => ping(id), hop?.to); if (landed && !landed.queued) break; }
check('handed-over fish swims into the other tab', landed && landed.queued === 0 && landed.count >= 1, JSON.stringify({ visible: await dest.evaluate(() => document.visibilityState), ...landed }));
await SW(() => patchSettings({ fishCount: 3 }));
await A.bringToFront();

// fishing mode toggled through the worker (the popup switch and Alt+Shift+F take this path)
const f1 = await SW((id) => setFishing(id, true), idA);
const peOn = await A.evaluate(() => getComputedStyle(document.querySelector('fishtop-overlay')).pointerEvents === 'auto');
check('fishing mode on: overlay captures the mouse', f1?.fishing && peOn, JSON.stringify(f1));
await A.mouse.move(800, 600, { steps: 10 });
await wait(600);
await A.screenshot({ path: join(out, 'ext_02_fishing_mode.png') });
await A.keyboard.press('Escape');
await wait(200);
const afterEsc = await SW((id) => ping(id), idA);
const peOff = await A.evaluate(() => getComputedStyle(document.querySelector('fishtop-overlay')).pointerEvents === 'none');
check('Esc leaves fishing mode, page clickable again', !afterEsc.fishing && peOff);

// catch bucket: the overlay reports catches with ft:caught (simulated here; run.mjs covers real catches)
const thumb = await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 72; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#5ee8d0'; g.fillRect(20, 12, 30, 16); return c.toDataURL('image/png'); });
const mk = (i, sp, name) => ({ uid: `t${i}${Date.now().toString(36)}`, species: sp, sizeCm: 20 + i, weightKg: 0.5, sizeT: 0.4, giant: false, tiny: false, variant: i === 1 ? { shiny: true, shinyHue: 150 } : null, personality: 'bold', name, caughtAt: Date.now() - i * 60000, rarity: 'common', speciesName: sp === 'loafer' ? 'Loafer Minnow' : 'Spam Sardine', thumb });
for (const [i, sp, nm] of [[0, 'loafer', 'Bub'], [1, 'spam', 'Toast']]) await SW(([r, id]) => handle({ type: 'ft:caught', record: r }, { tab: { id } }), [mk(i, sp, nm), idA]);
const stored = await SW(async () => (await chrome.storage.local.get('catches')).catches);
check('catches stored in chrome.storage.local', stored?.length === 2 && stored.every((c) => !c.sent && c.thumb), `${stored?.length}`);

// popup
const P = await ctx.newPage(); watch(P, 'popup');
await P.setViewportSize({ width: 340, height: 760 });
await P.goto(`chrome-extension://${extId}/popup.html`);
await P.waitForSelector('#list li');
check('popup lists browser catches', (await P.$$eval('#list li img', (l) => l.length)) === 2);
check('popup toggles reflect settings', !(await P.isChecked('#roam')) && !(await P.isChecked('#sound')) && (await P.inputValue('#count')) === '3');
await P.screenshot({ path: join(out, 'ext_03_popup.png'), fullPage: true });

// send with no game open -> pending; opening FISHTOP delivers automatically through the bridge
await P.click('#send');
await P.waitForFunction(() => document.getElementById('status').textContent.length > 0);
const st1 = await P.textContent('#status');
check('send without game queues the catches', /Open FISHTOP/.test(st1) && (await SW(async () => (await chrome.storage.local.get('pendingSend')).pendingSend)) === true, st1);
const G = await ctx.newPage(); watch(G, 'game');
await G.goto('http://localhost:5173/game-stub.html');
await G.waitForFunction(() => window.received.length >= 2, null, { timeout: 15000 }).catch(() => {});
const got = await G.evaluate(() => window.received);
check('FISHTOP page received the catches', got.length === 2, `${got.length}`);
check('payload is rollIndividual + species/caughtAt only', got.every((r) => !('thumb' in r) && !('sent' in r) && r.uid && r.species && r.caughtAt && 'personality' in r), Object.keys(got[0] || {}).join(','));
let sentNow = [];
for (let i = 0; i < 20; i++) { sentNow = await SW(async () => (await chrome.storage.local.get('catches')).catches.map((c) => c.sent)); if (sentNow.every(Boolean)) break; await wait(200); }
check('game ack marks catches as sent', sentNow.length === 2 && sentNow.every(Boolean), JSON.stringify(sentNow));
await P.bringToFront();
await wait(300);
check('popup shows SENT', (await P.$$eval('.tag.sent', (l) => l.length)) === 2);
check('popup confirms the delivery', /arrived in FISHTOP/.test(await P.textContent('#status')), await P.textContent('#status'));
await P.screenshot({ path: join(out, 'ext_04_popup_sent.png'), fullPage: true });

// "Fish in this tab" off stops the overlay
await SW((id) => disableTab(id), idA);
await wait(200);
check('disabling the tab removes the overlay', !(await A.evaluate(() => !!document.querySelector('fishtop-overlay'))));

// roaming: with host access granted the content script is registered and new pages get fish by themselves
const ro = await SW(() => setRoaming(true));
const C = await ctx.newPage(); watch(C, 'C');
await C.goto('http://localhost:5174/ext-test.html?tab=c');
await C.waitForSelector('fishtop-overlay', { state: 'attached', timeout: 8000 }).catch(() => {});
check('roaming on: fish appear on newly opened sites', ro?.ok && await C.evaluate(() => !!document.querySelector('fishtop-overlay')), JSON.stringify(ro));
const reg2 = await SW(async () => [await chrome.scripting.getRegisteredContentScripts(), (await readSettings()).roaming]);
check('roaming content script registered (excluding the game page)', reg2[0].length === 1 && reg2[0][0].excludeMatches.includes('http://localhost:5173/*') && reg2[1] === true);
await SW(() => setRoaming(false));
await wait(300);
const reg3 = await SW(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
check('roaming off: script unregistered and roaming fish swim away', reg3 === 0 && !(await C.evaluate(() => !!document.querySelector('fishtop-overlay'))));

check('no console errors or warnings (pages, popup)', errors.length === 0, errors.slice(0, 6).join(' | '));
await ctx.close();
for (const sv of servers) sv.close();
await rm(profile, { recursive: true, force: true });
await rm(grantedDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
