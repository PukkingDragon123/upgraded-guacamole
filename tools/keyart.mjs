// Renders the itch.io page images from the dev page src/dev/keyart.js into release/itch/ (and copies them to
// assets/itch/).
//   node tools/build.mjs --dev keyart && PW_PATH=/opt/node-tools/node_modules/playwright node tools/keyart.mjs [only] [extra query]
//   only = comma list of presets: cover | banner | key | swimcover | swimbanner, or swimgif / swimbannergif for the
//   animated swim cover / banner (default: all); extra query is appended to every page URL (e.g. "&title=0")
// The GIF is a seamless loop: window.__ka.frame(u) draws loop time u in 0..1; the frames go through ffmpeg
// (palettegen / paletteuse, no dither, nearest-neighbour only).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = join(here, '..', 'release', 'itch');
const assetDir = join(here, '..', 'assets', 'itch');
const [only = '', extra = ''] = process.argv.slice(2);

// [preset, file, upscale, gif {frames, cs (centiseconds per frame)}, job name]
const JOBS = [
  ['cover', 'fishtop-cover-630x500.png', 1],
  ['cover', 'fishtop-cover-1260x1000.png', 2],
  ['banner', 'fishtop-banner-1920x480.png', 2],
  ['key', 'fishtop-keyart-1920x1080.png', 2],
  ['swimcover', 'fishtop-cover-swim-630x500.png', 1],
  ['swimcover', 'fishtop-cover-swim-1260x1000.png', 2],
  ['swimbanner', 'fishtop-banner-swim-1920x480.png', 2],
  ['swimcover', 'fishtop-cover-swim.gif', 1, { frames: 45, cs: 7 }, 'swimgif'],
  ['swimbanner', 'fishtop-banner-swim.gif', 2, { frames: 45, cs: 7 }, 'swimbannergif'],
].filter(([p, , , , name]) => !only || only.split(',').includes(name || p));

const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(dist, p));
    res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const port = server.address().port;
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const shots = new Map();
for (const [preset, file, k, gif] of JOBS) {
  const key = preset + (gif ? '#loop' : ''); // the loop freezes the scene: its own page
  let data = shots.get(key);
  if (!data) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    let failed = null;
    page.on('pageerror', (e) => { console.log('pageerror', preset, e.message); failed ||= e; });
    page.on('console', (m) => { if (m.type() === 'error') console.log('console', preset, m.text()); });
    await page.goto(`http://localhost:${port}/dev/keyart.html?preset=${preset}${extra}`);
    const t0 = Date.now();
    while (!(await page.evaluate(() => !!window.__ka?.ready))) {
      if (failed) throw failed;
      if (Date.now() - t0 > 240000) throw new Error('timed out waiting for ' + preset);
      await page.waitForTimeout(250);
    }
    data = { page };
    shots.set(key, data);
  }
  if (gif) {
    const tmp = await mkdtemp(join(tmpdir(), 'fishtop-gif-'));
    for (let i = 0; i < gif.frames; i++) {
      const url = await data.page.evaluate(([u, s]) => window.__ka.frame(u, s), [i / gif.frames, k]);
      await writeFile(join(tmp, `f${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(100 / gif.cs), '-i', join(tmp, 'f%03d.png'),
      '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', join(outDir, file)]);
    await rm(tmp, { recursive: true, force: true });
  } else {
    const url = await data.page.evaluate((s) => window.__ka.capture(s), k);
    await writeFile(join(outDir, file), Buffer.from(url.split(',')[1], 'base64'));
  }
  await mkdir(assetDir, { recursive: true });
  await copyFile(join(outDir, file), join(assetDir, file));
  console.log('wrote', join('release/itch', file), Math.round((await stat(join(outDir, file))).size / 1024) + ' KB', '(+ assets/itch)');
}
await browser.close();
server.close();
