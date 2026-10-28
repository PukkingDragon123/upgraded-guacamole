// Entry point. ?dev=<name> runs a dev preview page from src/dev/<name>.js (export run(params)).
const params = new URLSearchParams(location.search);
const dev = params.get('dev') || (params.has('gallery') ? 'gallery' : null);

async function boot() {
  document.getElementById('boot')?.remove();
  if (dev) {
    const mod = await import(`./dev/${dev}.js`);
    mod.run(params);
    return;
  }
  const { startGame } = await import('./game/boot.js');
  startGame(params);
}
boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0">${e.stack}</pre>`);
});
