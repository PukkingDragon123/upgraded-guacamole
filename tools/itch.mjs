// Packages the HTML5 build for itch.io: release/fishtop-itch.zip with index.html at the zip root.
// Upload it as an HTML5 game ("This file will be played in the browser"). Run `node tools/build.mjs` first.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'release', 'fishtop-itch.zip');
for (const f of ['index.html', 'fishtop.js']) {
  if (!existsSync(join(dist, f))) { console.error(`missing dist/${f}: run node tools/build.mjs first`); process.exit(1); }
}
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-9', '-X', '-q', out, 'index.html', 'fishtop.js'], { cwd: dist, stdio: 'inherit' });
console.log(`wrote ${out} (${(statSync(out).size / 1048576).toFixed(2)} MB)`);
