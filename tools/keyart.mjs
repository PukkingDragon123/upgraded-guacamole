// Renders the itch.io page images from the dev page src/dev/keyart.js into release/itch/.
//   node tools/build.mjs --dev keyart && PW_PATH=/opt/node-tools/node_modules/playwright node tools/keyart.mjs [only] [extra query]
//   only = cover | banner | key (default: all); extra query is appended to every page URL (e.g. "&title=0")
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = join(here, '..', 'release', 'itch');
const [only = '', extra = ''] = process.argv.slice(2);

// [preset, file, upscale]
const JOBS = [
  ['cover', 'fishtop-cover-630x500.png', 1],
  ['cover', 'fishtop-cover-1260x1000.png', 2],
  ['banner', 'fishtop-banner-1920x480.png', 2],
  ['key', 'fishtop-keyart-1920x1080.png', 2],
].filter(([p]) => !only || only.split(',').includes(p));

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
for (const [preset, file, k] of JOBS) {
  let data = shots.get(preset);
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
    shots.set(preset, data);
  }
  const url = await data.page.evaluate((s) => window.__ka.capture(s), k);
  await writeFile(join(outDir, file), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', join('release/itch', file));
}
await browser.close();
server.close();
