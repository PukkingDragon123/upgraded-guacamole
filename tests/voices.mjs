// 8-bit voice check [voices23]: boots dist/ headless, unlocks audio and makes every character voice
// (src/core/audio.js CHIP: guide fizz marina bloat dot player boss default, plus the old aliases) say a whole line,
// type a few letters one by one and play the punctuation arpeggios. Checks: notes get scheduled for every voice,
// one reused channel per voice (no per-letter channels), the output is audible and below clipping, Voices: Off
// silences everything, idle channels are released, no console errors.
// usage: node tools/build.mjs && PW_PATH=/opt/node-tools/node_modules/playwright node tests/voices.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_IDS } from '../src/core/audio.js';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  - ' + info : ''}`); if (!ok) failures++; };
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
const root = join(here, '..', 'dist');
const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  try { const body = await readFile(join(root, p)); res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' }); res.end(body); } catch { res.writeHead(404).end(); }
}).listen(0);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /audio|voice/i.test(m.text()))) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
try {
  await page.goto(`http://localhost:${server.address().port}/index.html?fresh&skipintro`);
  await page.waitForFunction(() => window.FISHTOP && window.FISHTOP.audio, null, { timeout: 120000 });
  const A = (expr) => page.evaluate(`(() => { const a = window.FISHTOP.audio; return ${expr}; })()`);
  // keep the game's own dialogue (the chapter 1 opening cutscene) quiet so only the test speaks
  await page.evaluate(`(window.FISHTOP.state.settings.questCine = 'off', 0)`);
  check('audio unlocks', await A('a.unlock()'));
  await A('(a.setVolumes({ master: 0.8, sfx: 0.8, music: 0, ambience: 0 }), a.setMusic(null), a.setAmbience("off"), a.setVoices(true))');
  await page.waitForTimeout(600);
  check(`voice ids: ${VOICE_IDS.join(' ')}`, ['guide', 'fizz', 'marina', 'bloat', 'dot', 'player', 'boss', 'default'].every((v) => VOICE_IDS.includes(v)));
  await A('(window.__vm = a._meter(), 0)');
  const LINE = 'Hey there, angler! Ready to catch something huge? Let us go... ~';
  for (const v of VOICE_IDS) {
    const before = await A('a._chip()');
    await A(`a.babble(${JSON.stringify(LINE)}, ${JSON.stringify(v)})`);
    await A('window.__vm.read()');
    await page.waitForTimeout(700);
    const lvl = await A('window.__vm.read()');
    // typewriter path: single letters, then punctuation
    for (const c of 'hello!?.') { await A(`a.babble(${JSON.stringify(c)}, ${JSON.stringify(v)})`); await page.waitForTimeout(90); }
    const after = await A('a._chip()');
    const n = after.notes - before.notes;
    check(`voice "${v}" speaks a line + typed letters + arpeggios`, n >= 30 && after.channels.includes(v), `${n} notes, peak ${lvl.peak.toFixed(3)}, rms ${lvl.rms.toFixed(4)}`);
    check(`voice "${v}" is audible and does not clip`, lvl.peak > 0.01 && lvl.peak < 1.2, `peak ${lvl.peak.toFixed(3)}`);
  }
  const st = await A('a._chip()');
  check('one reused channel per voice (no per-letter channels)', st.made <= VOICE_IDS.length && st.channels.length <= 6, `built ${st.made}, live ${st.channels.join(' ')}`);
  const al = await A('(() => { const s0 = a._chip().notes; for (const v of ["seal", "fish", "tiny", "crab", "deep", "clip", "grouper", "shop", "nobody"]) a.babble("Alias check!", v); return [a._chip().notes - s0, a.voiceId("seal"), a.voiceId("nobody")]; })()');
  check('old voice names / NPC ids alias onto the character voices', al[0] > 20 && al[1] === 'guide' && al[2] === 'default', JSON.stringify(al));
  const off = await A('(() => { a.setVoices(false); const s0 = a._chip().notes; a.babble("Should be silent!", "guide"); a.babble("x", "fizz"); const r = [a.voicesOn, a._chip().notes - s0, a._chip().channels.length]; a.setVoices(true); return r; })()');
  check('Voices: Off silences every voice', off[0] === false && off[1] === 0 && off[2] === 0, JSON.stringify(off));
  await A('a.babble("Bye now.", "marina")');
  await page.waitForTimeout(6500);
  const idle = await A('a._chip()');
  check('idle channels are released', idle.channels.length === 0, idle.channels.join(' '));
  const ck = await page.evaluate(`window.FISHTOP.state.settings.voices`);
  check('settings default: 8-bit voices on', ck === 'chip', String(ck));
  await A('window.__vm.close()');
  check('no audio console errors', !errors.length, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} voice check(s) failed` : '\nall voice checks passed');
process.exit(failures ? 1 : 0);
