// FISHTOP Browser Fish - game bridge. Runs ONLY on the FISHTOP game page (see manifest matches).
// Protocol (window.postMessage on the game page, same window only):
//   bridge -> game   { type: 'fishtop:bridge-hello', version: 1 }           repeated until answered
//   game   -> bridge { type: 'fishtop:game-hello', version: 1 }
//   bridge -> game   { type: 'fishtop:catches', fish: [record, ...] }       after the user pressed "Send"
//   game   -> bridge { type: 'fishtop:catches-ack', uids: [uid, ...] }      imported (or already owned)
// A record is rollIndividual() output plus { species, caughtAt }. Nothing else is shared.
(() => {
  if (window.top !== window || window.__FISHTOP_BRIDGE__) return;
  window.__FISHTOP_BRIDGE__ = true;
  const target = location.protocol === 'file:' || location.origin === 'null' ? '*' : location.origin;
  let gameReady = false;
  let tries = 0;

  const send = (msg) => {
    try {
      const p = chrome.runtime.sendMessage(msg);
      return p && p.catch ? p.catch(() => null) : Promise.resolve(null);
    } catch {
      return Promise.resolve(null);
    }
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data.type !== 'string') return;
    const d = e.data;
    if (d.type === 'fishtop:game-hello' && !gameReady) {
      gameReady = true;
      send({ type: 'ft:bridge-ready', version: d.version | 0 });
    } else if (d.type === 'fishtop:catches-ack' && gameReady && Array.isArray(d.uids)) {
      send({ type: 'ft:delivered', uids: d.uids.filter((u) => typeof u === 'string').slice(0, 1000) });
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || sender.id !== chrome.runtime.id) return false;
    if (msg.type === 'ft:deliver' && Array.isArray(msg.fish)) {
      if (gameReady) window.postMessage({ type: 'fishtop:catches', fish: msg.fish }, target);
      reply({ ok: gameReady });
    } else if (msg.type === 'ft:bridge-ping') {
      reply({ ok: gameReady });
    }
    return false;
  });

  (function hello() {
    if (gameReady || tries++ > 24) return;
    window.postMessage({ type: 'fishtop:bridge-hello', version: 1 }, target);
    setTimeout(hello, 800 + tries * 300);
  })();
})();
