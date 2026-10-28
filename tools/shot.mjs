// Screenshot helper: node tools/shot.mjs "<query>" out.png [waitMs] [width] [height] [jsToEvalBeforeShot]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const [query = '', out = 'tests/out/shot.png', wait = '800', w = '1280', h = '720', script = ''] = process.argv.slice(2);
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
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto(`http://localhost:${port}/${query.startsWith('?') || !query ? 'index.html' + query : query}`);
await page.waitForTimeout(Number(wait));
if (script) {
  for (const step of script.split(';;')) {
    const s = step.trim();
    if (!s) continue;
    if (s.startsWith('wait ')) await page.waitForTimeout(Number(s.slice(5)));
    else if (s.startsWith('mouse ')) { const [x, y] = s.slice(6).split(',').map(Number); await page.mouse.move(x, y, { steps: 8 }); }
    else if (s.startsWith('click ')) { const [x, y] = s.slice(6).split(',').map(Number); await page.mouse.click(x, y); }
    else if (s.startsWith('down')) await page.mouse.down();
    else if (s.startsWith('up')) await page.mouse.up();
    else if (s.startsWith('key ')) await page.keyboard.press(s.slice(4));
    else if (s.startsWith('shot ')) await page.screenshot({ path: s.slice(5) });
    else { const r = await page.evaluate(s); if (r !== undefined) console.log('eval:', JSON.stringify(r).slice(0, 2000)); }
  }
}
await page.screenshot({ path: out });
if (errors.length) console.log(errors.join('\n'));
await browser.close();
server.close();
