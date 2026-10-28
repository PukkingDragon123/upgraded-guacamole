// FISHTOP Browser Fish - background service worker (Manifest V3).
// Keeps a registry of tabs that show fish, hands fish from tab to tab, registers the roaming content
// script only after the user grants host access, handles the fishing shortcut, stores browser catches
// in chrome.storage.local and delivers them to an open FISHTOP game tab. It never uses the network.

const ROAM_ORIGINS = ['http://*/*', 'https://*/*'];
const GAME_MATCHES = ['http://localhost:5173/*', 'http://127.0.0.1:5173/*'];
const SCRIPT_ID = 'fishtop-roaming';
const DEFAULTS = { roaming: false, fishCount: 3, sound: false };
const MAX_FISH = 6;
const MAX_CATCHES = 250;
const REC_KEYS = ['uid', 'species', 'sizeCm', 'weightKg', 'sizeT', 'giant', 'tiny', 'variant', 'personality', 'name', 'caughtAt'];

// One queue for every read-modify-write of storage so concurrent messages never clobber each other.
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// ------------------------------------------------------------------ settings & registry
async function readSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

function patchSettings(patch) {
  return serial(async () => {
    const next = { ...(await readSettings()), ...patch };
    next.fishCount = Math.max(1, Math.min(MAX_FISH, Math.round(Number(next.fishCount) || DEFAULTS.fishCount)));
    next.roaming = !!next.roaming; next.sound = !!next.sound;
    await chrome.storage.local.set({ settings: next });
    return next;
  });
}

// Registry in storage.session so it survives service-worker restarts (cleared when the browser closes).
async function readReg() {
  const { reg } = await chrome.storage.session.get('reg');
  return { tabs: {}, manual: {}, optOut: {}, bridges: {}, ...(reg || {}) };
}

function editReg(fn) {
  return serial(async () => {
    const reg = await readReg();
    const out = await fn(reg);
    await chrome.storage.session.set({ reg });
    return out;
  });
}

// ------------------------------------------------------------------ tabs
async function ping(tabId) {
  try { return await chrome.tabs.sendMessage(tabId, { type: 'ft:ping' }); } catch { return null; }
}

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
    return true;
  } catch {
    return false;
  }
}

async function ensureOverlay(tabId) {
  if (await ping(tabId)) return true;
  return inject(tabId);
}

async function enableTab(tabId) {
  await editReg((r) => { r.manual[tabId] = true; delete r.optOut[tabId]; });
  if (!(await ensureOverlay(tabId))) return { ok: false, error: 'blocked' };
  try { await chrome.tabs.sendMessage(tabId, { type: 'ft:manual' }); } catch { /* ignore */ }
  return { ok: true };
}

async function disableTab(tabId) {
  const s = await readSettings();
  await editReg((r) => {
    delete r.manual[tabId];
    delete r.tabs[tabId];
    if (s.roaming) r.optOut[tabId] = true; // keep roaming fish away from this tab until it navigates
  });
  try { await chrome.tabs.sendMessage(tabId, { type: 'ft:stop' }); } catch { /* not running */ }
  return { ok: true };
}

async function setFishing(tabId, on) {
  if (on) {
    const live = await ping(tabId);
    if (!live) {
      const r = await enableTab(tabId);
      if (!r.ok) return r;
    }
  }
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'ft:set-fishing', on: !!on });
    return { ok: true, fishing: !!r?.fishing };
  } catch {
    return { ok: !on, fishing: false };
  }
}

// ------------------------------------------------------------------ roaming
async function setRoaming(on) {
  if (on) {
    if (!(await chrome.permissions.contains({ origins: ROAM_ORIGINS }))) return { ok: false, error: 'permission' };
    const have = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (!have.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID, matches: ROAM_ORIGINS, excludeMatches: GAME_MATCHES, js: ['overlay.js'],
        runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
      }]);
    }
    await patchSettings({ roaming: true });
    // already-open pages get fish lazily (when activated); the visible tab of each window right away
    const tabs = await chrome.tabs.query({ active: true, url: ROAM_ORIGINS });
    for (const t of tabs) if (!isGame(t.url)) inject(t.id);
    return { ok: true };
  }
  try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch { /* not registered */ }
  await patchSettings({ roaming: false });
  const reg = await editReg((r) => { r.optOut = {}; return JSON.parse(JSON.stringify(r)); });
  for (const id of Object.keys(reg.tabs)) {
    if (reg.manual[id]) continue;
    try { await chrome.tabs.sendMessage(Number(id), { type: 'ft:stop' }); } catch { /* gone */ }
  }
  await editReg((r) => { for (const id of Object.keys(r.tabs)) if (!r.manual[id]) delete r.tabs[id]; });
  return { ok: true };
}

function isGame(url) {
  return typeof url === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1):5173\//.test(url);
}

// ------------------------------------------------------------------ fish hand-off between tabs
// A fish that swims off the right edge prefers the next tab to the right in the tab strip (and the
// left edge the tab to the left); any other tab with fish works too.
async function handOff(fromId, fish) {
  const reg = await readReg();
  const ids = Object.keys(reg.tabs).map(Number).filter((id) => id !== fromId && (reg.tabs[id].count ?? 0) < MAX_FISH);
  if (!ids.length) return { ok: false };
  let order = ids.sort(() => Math.random() - 0.5);
  try {
    const from = await chrome.tabs.get(fromId);
    const strip = await chrome.tabs.query({ windowId: from.windowId });
    const idx = new Map(strip.map((t) => [t.id, t.index]));
    const n = strip.length, dir = fish.side === 'left' ? -1 : 1;
    const rank = (id) => (idx.has(id) ? (((idx.get(id) - from.index) * dir) % n + n) % n : n + 1);
    order = order.sort((a, b) => rank(a) - rank(b));
  } catch { /* tab info unavailable: random order */ }
  for (const id of order) {
    try {
      const r = await chrome.tabs.sendMessage(id, { type: 'ft:arrive', fish });
      if (r?.ok) {
        await editReg((g) => { if (g.tabs[id]) g.tabs[id].count = (g.tabs[id].count || 0) + 1; });
        return { ok: true, to: id };
      }
    } catch {
      await editReg((g) => { delete g.tabs[id]; });
    }
  }
  return { ok: false };
}

// ------------------------------------------------------------------ catches
function cleanRecord(r, keepLocal) {
  const out = {};
  for (const k of REC_KEYS) if (r[k] !== undefined) out[k] = r[k];
  if (keepLocal) {
    out.rarity = typeof r.rarity === 'string' ? r.rarity : 'common';
    if (typeof r.speciesName === 'string') out.speciesName = r.speciesName.slice(0, 40);
    out.source = 'browser';
    out.sent = !!r.sent;
    if (typeof r.thumb === 'string' && r.thumb.startsWith('data:image/png;base64,') && r.thumb.length < 24000) out.thumb = r.thumb;
  }
  return out;
}

function addCatch(rec) {
  if (!rec || typeof rec.uid !== 'string' || typeof rec.species !== 'string') return Promise.resolve({ ok: false });
  return serial(async () => {
    const { catches = [] } = await chrome.storage.local.get('catches');
    if (!catches.some((c) => c.uid === rec.uid)) {
      catches.push(cleanRecord({ ...rec, sent: false }, true));
      while (catches.length > MAX_CATCHES) {
        const i = catches.findIndex((c) => c.sent);
        catches.splice(i >= 0 ? i : 0, 1);
      }
      await chrome.storage.local.set({ catches });
    }
    return { ok: true, count: catches.length };
  });
}

async function deliver(tabId) {
  const { catches = [] } = await chrome.storage.local.get('catches');
  const fish = catches.filter((c) => !c.sent).map((c) => cleanRecord(c, false));
  if (!fish.length) return 0;
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'ft:deliver', fish });
    return r?.ok ? fish.length : 0;
  } catch {
    await editReg((g) => { delete g.bridges[tabId]; });
    return 0;
  }
}

async function sendCatches() {
  const { catches = [] } = await chrome.storage.local.get('catches');
  const unsent = catches.filter((c) => !c.sent).length;
  if (!unsent) return { ok: true, unsent: 0, delivered: 0, games: 0 };
  await chrome.storage.local.set({ pendingSend: true });
  const reg = await readReg();
  let delivered = 0, games = 0;
  for (const id of Object.keys(reg.bridges)) {
    const n = await deliver(Number(id));
    if (n) { delivered = n; games++; break; }
  }
  return { ok: true, unsent, delivered, games };
}

function markSent(uids) {
  const set = new Set((Array.isArray(uids) ? uids : []).filter((u) => typeof u === 'string'));
  return serial(async () => {
    const { catches = [] } = await chrome.storage.local.get('catches');
    let changed = 0;
    for (const c of catches) if (set.has(c.uid) && !c.sent) { c.sent = true; changed++; }
    const left = catches.filter((c) => !c.sent).length;
    // a successful delivery settles the "Send" request; newer catches wait for the next one
    if (changed) await chrome.storage.local.set({ catches, pendingSend: false });
    return { ok: true, marked: changed, left };
  });
}

function clearSent() {
  return serial(async () => {
    const { catches = [] } = await chrome.storage.local.get('catches');
    const keep = catches.filter((c) => !c.sent);
    await chrome.storage.local.set({ catches: keep });
    return { ok: true, removed: catches.length - keep.length };
  });
}

// ------------------------------------------------------------------ messages
async function handle(msg, sender) {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    // from overlays (content scripts)
    case 'ft:hello':
    case 'ft:status': {
      if (tabId == null) return null;
      return editReg((r) => {
        if (r.optOut[tabId]) return { ok: false };
        r.tabs[tabId] = { count: msg.count | 0, hidden: !!msg.hidden, fishing: !!msg.fishing, t: Date.now() };
        return { ok: true, manual: !!r.manual[tabId] };
      });
    }
    case 'ft:bye':
      if (tabId != null) await editReg((r) => { delete r.tabs[tabId]; });
      return { ok: true };
    case 'ft:leave':
      if (tabId == null || !msg.fish?.rec) return { ok: false };
      return handOff(tabId, msg.fish);
    case 'ft:caught':
      return addCatch(msg.record);

    // from the game bridge
    case 'ft:bridge-ready': {
      if (tabId == null) return null;
      await editReg((r) => { r.bridges[tabId] = true; });
      const { pendingSend } = await chrome.storage.local.get('pendingSend');
      const delivered = pendingSend ? await deliver(tabId) : 0;
      return { ok: true, delivered };
    }
    case 'ft:delivered':
      return markSent(msg.uids);

    // from the popup
    case 'ft:enable-tab': return enableTab(msg.tabId);
    case 'ft:disable-tab': return disableTab(msg.tabId);
    case 'ft:set-fishing': return setFishing(msg.tabId, msg.on);
    case 'ft:roaming': return setRoaming(!!msg.on);
    case 'ft:settings': return patchSettings(pick(msg.patch, ['fishCount', 'sound']));
    case 'ft:send-catches': return sendCatches();
    case 'ft:clear-sent': return clearSent();
    case 'ft:tab-state': {
      const live = await ping(msg.tabId);
      const reg = await readReg();
      return { active: !!live, fishing: !!live?.fishing, count: live?.count | 0, manual: !!reg.manual[msg.tabId], games: Object.keys(reg.bridges).length };
    }
    default:
      return null;
  }
}

function pick(o, keys) {
  const out = {};
  if (o && typeof o === 'object') for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ft:') || sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then((r) => reply(r ?? null), (e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});

// ------------------------------------------------------------------ browser events
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-fishing') return;
  const id = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (id == null) return;
  const live = await ping(id);
  await setFishing(id, !live?.fishing);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  editReg((r) => { delete r.tabs[tabId]; delete r.manual[tabId]; delete r.optOut[tabId]; delete r.bridges[tabId]; });
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // a new page load ends the old overlay (and the activeTab grant that came with "Fish in this tab")
  if (info.status === 'loading') editReg((r) => { delete r.tabs[tabId]; delete r.manual[tabId]; delete r.optOut[tabId]; delete r.bridges[tabId]; });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const s = await readSettings();
  if (!s.roaming) return;
  const reg = await readReg();
  if (reg.tabs[tabId] || reg.optOut[tabId]) return;
  try {
    const t = await chrome.tabs.get(tabId);
    if (/^https?:/.test(t.url || '') && !isGame(t.url)) inject(tabId);
  } catch { /* closed */ }
});

chrome.permissions.onRemoved.addListener(async (p) => {
  if ((p.origins || []).some((o) => ROAM_ORIGINS.includes(o))) {
    const s = await readSettings();
    if (s.roaming) setRoaming(false);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await readSettings();
  const granted = await chrome.permissions.contains({ origins: ROAM_ORIGINS });
  await patchSettings({ roaming: s.roaming && granted });
  if (!(s.roaming && granted)) {
    try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch { /* none */ }
  }
});
