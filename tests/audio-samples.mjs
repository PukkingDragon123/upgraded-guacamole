// Audio check: every sound the game asks for must come from a recording, not the synth fallback.
//  1. static: every SFX name referenced in src/ (play('x'), sfx('x'), sound: 'x', tables of names) has a
//     SAMPLE_MAP entry whose clips are all embedded;
//  2. headless: boots dist/, unlocks audio, fires every SFX name, every loop, every music track and every
//     ambience/weather scene, then checks audio._stats(): no synth one-shots, recorded music playing, no errors.
// usage: node tools/build.mjs && PW_PATH=/opt/node-tools/node_modules/playwright node tests/audio-samples.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_MAP } from '../src/core/samples.js';
import { SAMPLE_DATA } from '../src/core/samples-data.js';
import { SFX_NAMES, LOOP_NAMES, MUSIC_TRACKS } from '../src/core/audio.js';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  - ' + info : ''}`); if (!ok) failures++; };

// ---- 1. static scan
const known = new Set([...SFX_NAMES, ...Object.keys(SAMPLE_MAP)]);
async function walk(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc); else if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
}
const files = (await walk(join(here, '..', 'src'))).filter((f) => !/core[\\/](audio|samples|samples-data)\.js$/.test(f));
const used = new Map();
for (const f of files) {
  const txt = await readFile(f, 'utf8');
  for (const m of txt.matchAll(/['"`]([a-z_]+)['"`]/g)) if (known.has(m[1])) used.set(m[1], (used.get(m[1]) || 0) + 1);
}
const unmapped = [...used.keys()].filter((n) => !SAMPLE_MAP[n]);
const missingClip = [];
for (const [n, vs] of Object.entries(SAMPLE_MAP)) for (const v of vs) { const id = typeof v === 'string' ? v : v.id; if (!SAMPLE_DATA[id]) missingClip.push(`${n}:${id}`); }
check(`every SFX name used in src has recordings (${used.size} names)`, !unmapped.length, unmapped.join(' '));
check('every mapped clip is embedded', !missingClip.length, missingClip.join(' '));
check('every synth SFX name has a recording', SFX_NAMES.every((n) => SAMPLE_MAP[n]), SFX_NAMES.filter((n) => !SAMPLE_MAP[n]).join(' '));

// ---- 2. headless run
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
const root = join(here, '..', 'dist');
const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  try { const body = await readFile(join(root, p)); res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' }); res.end(body); } catch { res.writeHead(404).end(); }
}).listen(0);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /audio|sound|clip/i.test(m.text()))) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
try {
  await page.goto(`http://localhost:${server.address().port}/index.html`);
  await page.waitForFunction(() => window.FISHTOP && window.FISHTOP.audio, null, { timeout: 120000 });
  const A = (expr) => page.evaluate(`(() => { const a = window.FISHTOP.audio; return ${expr}; })()`);
  check('audio unlocks', await A('a.unlock()'));
  await A('(a.setVolumes({ master: 0.8, sfx: 0.8, music: 0.5, ambience: 0.6 }), a.play("ui_click"))'); // kicks off the clip decodes
  await page.waitForTimeout(4000);
  const names = Object.keys(SAMPLE_MAP);
  const before = await A('a._stats()');
  for (const n of names) { await A(`a.play(${JSON.stringify(n)}, { vol: 0.2 })`); await page.waitForTimeout(25); }
  await page.waitForTimeout(500);
  const st = await A('a._stats()');
  const played = st.sample - before.sample;
  check(`all ${names.length} SFX names played from recordings`, st.synth === before.synth && played >= names.length - 2,
    `recorded ${played}, synth ${st.synth - before.synth} [${st.synthNames.join(' ')}], late/dropped ${st.dropped}`);
  for (const l of LOOP_NAMES) await A(`(() => { const h = a.loop(${JSON.stringify(l)}); h.set(0.7); setTimeout(() => h.stop(), 600); })()`);
  await page.waitForTimeout(800);
  for (const t of MUSIC_TRACKS) {
    await A(`a.setMusic(${JSON.stringify(t)})`);
    const ok = await page.waitForFunction((t) => { const m = window.FISHTOP.audio._stats().music; return m && m.name === t && m.playing; }, t, { timeout: 20000 }).then(() => true).catch(() => false);
    const m = await A('a._stats().music');
    check(`music "${t}" plays a recorded track`, ok && m.recorded, JSON.stringify(m));
  }
  const scenes = [['shallows', 'rain'], ['shallows', 'storm'], ['junkyard', 'static'], ['junkyard', 'datarain'], ['junkyard', 'oil'], ['abyss', 'snow'], ['abyss', 'current'],
    ['abyss', 'glowtide'], ['fjord', 'snowfall'], ['fjord', 'blizzard'], ['fjord', 'aurora'], ['volcano', 'eruption'], ['volcano', 'sulfur'], ['volcano', 'magma'],
    ['metropolis', 'neonstorm'], ['metropolis', 'rushhour'], ['metropolis', 'blackout'], ['aquarium', null], [null, null]];
  for (const [b, w] of scenes) { await A(`a.setAmbience(${JSON.stringify(b)}, { weather: ${JSON.stringify(w)} })`); await page.waitForTimeout(350); }
  const sc = await A('a._stats().scene');
  check('ambience scenes switch', !!sc, sc);
  await A('a.babble("Hello there, angler! Ready to fish?", "fish")');
  await page.waitForTimeout(1500);
  const final = await A('a._stats()');
  check('no synth fallback anywhere', final.synth === 0, final.synthNames.join(' '));
  check('no audio console errors', !errors.length, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} audio check(s) failed` : '\nall audio checks passed');
process.exit(failures ? 1 : 0);
