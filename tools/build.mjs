// Bundles the game (dist/) and the browser-extension overlay (extension/) with esbuild.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

mkdirSync(join(root, 'dist'), { recursive: true });
copyFileSync(join(root, 'web/index.html'), join(root, 'dist/index.html'));

const common = {
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify,
  legalComments: 'none',
  logLevel: 'info',
};

const targets = [
  { ...common, entryPoints: [join(root, 'src/main.js')], outfile: join(root, 'dist/fishtop.js') },
];
if (existsSync(join(root, 'src/overlay/main.js'))) {
  targets.push({ ...common, entryPoints: [join(root, 'src/overlay/main.js')], outfile: join(root, 'extension/overlay.js') });
}

// Isolated dev preview bundle: node tools/build.mjs --dev <name>  ->  dist/dev/<name>.html
const devIdx = process.argv.indexOf('--dev');
if (devIdx > 0) {
  const name = process.argv[devIdx + 1];
  mkdirSync(join(root, 'dist/dev'), { recursive: true });
  writeFileSync(join(root, `dist/dev/${name}.html`), readFileSync(join(root, 'web/index.html'), 'utf8').replace('fishtop.js', `${name}.js`));
  await esbuild.build({
    ...common,
    stdin: { contents: `import { run } from './src/dev/${name}.js'; document.getElementById('boot')?.remove(); run(new URLSearchParams(location.search));`, resolveDir: root },
    outfile: join(root, `dist/dev/${name}.js`),
  });
  process.exit(0);
}

const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching for changes...');
} else {
  for (const c of contexts) {
    await c.rebuild();
    await c.dispose();
  }
}
