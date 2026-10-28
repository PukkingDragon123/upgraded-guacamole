// Failure-tolerant wrapper around the extension APIs a content script may use.
// Every call degrades to a no-op when the extension context is gone (reload/update) or absent (tests).

export const DEFAULT_SETTINGS = { roaming: false, fishCount: 3, sound: false };
export const MAX_FISH = 6;

function api() {
  try {
    const c = globalThis.chrome;
    return c && c.runtime && c.runtime.id ? c : null;
  } catch {
    return null;
  }
}

export const ext = {
  get alive() { return !!api(); },

  send(msg) {
    const c = api();
    if (!c) return Promise.resolve(null);
    try {
      const p = c.runtime.sendMessage(msg);
      return p && p.then ? p.catch(() => null) : Promise.resolve(null);
    } catch {
      return Promise.resolve(null);
    }
  },

  // fn(msg) -> value | Promise<value>; returns an unsubscribe function.
  onMessage(fn) {
    const c = api();
    if (!c) return () => {};
    const listener = (msg, sender, reply) => {
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ft:')) return false;
      let r;
      try { r = fn(msg, sender); } catch { r = null; }
      if (r && r.then) { r.then(reply, () => reply(null)); return true; }
      reply(r ?? null);
      return false;
    };
    c.runtime.onMessage.addListener(listener);
    return () => { try { c.runtime.onMessage.removeListener(listener); } catch { /* context gone */ } };
  },

  async getLocal(keys) {
    const c = api();
    if (!c?.storage?.local) return {};
    try { return (await c.storage.local.get(keys)) || {}; } catch { return {}; }
  },

  onStorage(fn) {
    const c = api();
    if (!c?.storage?.onChanged) return () => {};
    const listener = (changes, area) => { if (area === 'local') { try { fn(changes); } catch { /* ignore */ } } };
    c.storage.onChanged.addListener(listener);
    return () => { try { c.storage.onChanged.removeListener(listener); } catch { /* context gone */ } };
  },
};
