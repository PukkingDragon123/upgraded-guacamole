// FISHTOP Browser Fish - popup. Talks to the background worker; reads settings and the catch bucket
// from chrome.storage.local. Host access is requested here (a user gesture) only for roaming fish.

const ROAM = ['http://*/*', 'https://*/*'];
const RARITY = { common: '#c9d4dc', uncommon: '#7ee07a', rare: '#5fb8ff', epic: '#d27bff', legendary: '#ffd04a' };
const $ = (id) => document.getElementById(id);
let tab = null;
let catches = [];
let awaiting = 0; // fish queued by the last Send, waiting for FISHTOP to confirm

async function bg(msg) {
  try { return await chrome.runtime.sendMessage(msg); } catch { return null; }
}

function status(text, warn = false) {
  const el = $('status');
  el.textContent = text || '';
  el.classList.toggle('warn', !!warn);
}

function blockedUrl(url) {
  if (!url) return false;
  return !/^(https?|file):/i.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

async function refreshTab() {
  if (!tab) return;
  const st = (await bg({ type: 'ft:tab-state', tabId: tab.id })) || {};
  $('tabFish').checked = !!st.active;
  $('fishing').checked = !!st.fishing;
}

async function refreshSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const granted = await chrome.permissions.contains({ origins: ROAM });
  $('roam').checked = !!settings.roaming && granted;
  $('sound').checked = !!settings.sound;
  const n = Math.max(1, Math.min(6, settings.fishCount || 3));
  $('count').value = n;
  $('countVal').textContent = n;
}

function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderCatches() {
  const list = $('list');
  list.textContent = '';
  const sorted = catches.slice().sort((a, b) => (b.caughtAt || 0) - (a.caughtAt || 0));
  const waiting = catches.filter((c) => !c.sent).length;
  $('summary').textContent = catches.length ? `${catches.length} caught · ${waiting} waiting` : 'No fish yet';
  $('clear').hidden = catches.length === waiting;
  $('send').disabled = waiting === 0;
  $('send').textContent = waiting ? `Send ${waiting} catch${waiting === 1 ? '' : 'es'} to FISHTOP` : 'Send catches to FISHTOP';
  if (!sorted.length) {
    list.append(el('li', 'empty', 'Turn on fishing mode and click when a fish bites!'));
    return;
  }
  for (const c of sorted.slice(0, 60)) {
    const li = el('li');
    const img = el('img');
    img.alt = '';
    if (typeof c.thumb === 'string' && c.thumb.startsWith('data:image/png;base64,')) img.src = c.thumb;
    const mid = el('div');
    const nm = el('div', 'nm', (c.variant?.shiny ? '★ ' : '') + (c.speciesName || c.species));
    nm.style.color = RARITY[c.rarity] || RARITY.common;
    mid.append(nm, el('div', 'sub', `"${c.name}" · ${c.sizeCm} cm · ${c.weightKg} kg`), el('div', 'sub', ago(c.caughtAt)));
    li.append(img, mid, el('span', c.sent ? 'tag sent' : 'tag wait', c.sent ? 'SENT' : 'NEW'));
    list.append(li);
  }
}

async function loadCatches() {
  const r = await chrome.storage.local.get('catches');
  catches = Array.isArray(r.catches) ? r.catches : [];
  renderCatches();
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const blocked = !tab || blockedUrl(tab.url);
  $('blocked').hidden = !blocked;
  $('tabFish').disabled = blocked;
  $('fishing').disabled = blocked;
  $('tabSection').classList.toggle('off', blocked);
  try {
    const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-fishing');
    $('shortcut').textContent = cmd?.shortcut || 'not set';
  } catch { /* ignore */ }
  await Promise.all([refreshTab(), refreshSettings(), loadCatches()]);

  $('tabFish').addEventListener('change', async (e) => {
    const on = e.target.checked;
    const r = await bg({ type: on ? 'ft:enable-tab' : 'ft:disable-tab', tabId: tab.id });
    if (on && !r?.ok) { e.target.checked = false; status("Fish can't swim on this page.", true); }
    else status(on ? 'A few fish are on their way.' : 'Fish swam off. This tab is fish-free.');
    await refreshTab();
  });

  $('fishing').addEventListener('change', async (e) => {
    const on = e.target.checked;
    const r = await bg({ type: 'ft:set-fishing', tabId: tab.id, on });
    if (on && !r?.ok) { e.target.checked = false; status("Can't fish on this page.", true); return; }
    await refreshTab();
    if (on) window.close(); // get out of the way: the mouse is a hook now
  });

  $('roam').addEventListener('change', async (e) => {
    if (e.target.checked) {
      let granted = false;
      try { granted = await chrome.permissions.request({ origins: ROAM }); } catch { granted = false; }
      if (!granted) { e.target.checked = false; status('Roaming needs access to all sites. Nothing changed.', true); return; }
      const r = await bg({ type: 'ft:roaming', on: true });
      status(r?.ok ? 'Roaming on: fish visit every tab and hop between them.' : 'Could not enable roaming.', !r?.ok);
    } else {
      await bg({ type: 'ft:roaming', on: false });
      try { await chrome.permissions.remove({ origins: ROAM }); } catch { /* ignore */ }
      status('Roaming off: site access removed.');
    }
    await refreshSettings();
    await refreshTab();
  });

  $('count').addEventListener('input', (e) => { $('countVal').textContent = e.target.value; });
  $('count').addEventListener('change', (e) => bg({ type: 'ft:settings', patch: { fishCount: Number(e.target.value) } }));
  $('sound').addEventListener('change', (e) => bg({ type: 'ft:settings', patch: { sound: e.target.checked } }));

  $('send').addEventListener('click', async () => {
    $('send').disabled = true;
    const r = await bg({ type: 'ft:send-catches' });
    if (!r?.ok) status('Something went wrong. Try again.', true);
    else if (!r.unsent) status('Nothing new to send.');
    else if (r.delivered) { awaiting = r.unsent; status(`${r.delivered} fish are swimming over to FISHTOP!`); }
    else { awaiting = r.unsent; status(`Open FISHTOP (localhost:5173) and your ${r.unsent} fish will swim over when it loads.`); }
    renderCatches();
  });

  $('clear').addEventListener('click', async () => {
    const r = await bg({ type: 'ft:clear-sent' });
    status(r?.removed ? `Cleared ${r.removed} sent fish from the bucket.` : '');
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.catches) {
      catches = Array.isArray(ch.catches.newValue) ? ch.catches.newValue : [];
      renderCatches();
      if (awaiting && !catches.some((c) => !c.sent)) { status(`${awaiting} fish arrived in FISHTOP. Check your aquarium!`); awaiting = 0; }
    }
    if (ch.settings) refreshSettings();
  });
}

init();
