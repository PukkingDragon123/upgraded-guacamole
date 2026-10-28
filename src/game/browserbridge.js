// Receives fish caught by the FISHTOP browser companion (extension/bridge.js) via window.postMessage.
// Records are untrusted: every field is sanitised before it touches the save.

import { SPECIES_BY_ID } from '../fish/species.js';
import { MUTATIONS, PATTERNS, PERSONALITIES } from '../fish/traits.js';
import { clamp } from '../core/math.js';

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

function sanitize(r) {
  const v = r.variant && typeof r.variant === 'object' ? r.variant : null;
  let variant = null;
  if (v) {
    variant = {};
    if (typeof v.mutation === 'string' && MUTATIONS[v.mutation]) variant.mutation = v.mutation;
    if (typeof v.pattern === 'string' && PATTERNS[v.pattern]) variant.pattern = v.pattern;
    if (Number.isInteger(v.seed)) variant.seed = v.seed;
    if (v.shiny === true) variant.shiny = true;
    if (Number.isFinite(v.shinyHue)) variant.shinyHue = v.shinyHue;
    if (!Object.keys(variant).length) variant = null;
  }
  return {
    uid: r.uid,
    species: r.species,
    sizeCm: num(r.sizeCm, 10),
    weightKg: num(r.weightKg, 0.2),
    sizeT: clamp(num(r.sizeT, 0.5), 0, 1),
    giant: r.giant === true,
    tiny: r.tiny === true,
    variant,
    personality: PERSONALITIES.some((p) => p.id === r.personality) ? r.personality : 'chill',
    name: typeof r.name === 'string' ? r.name.slice(0, 24) : 'Browser Fish',
    caughtAt: num(r.caughtAt, Date.now()),
  };
}

export function installBrowserBridge(game) {
  const target = () => (location.protocol === 'file:' ? '*' : location.origin);
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'fishtop:bridge-hello') {
      window.postMessage({ type: 'fishtop:game-hello', version: 1 }, target());
      return;
    }
    if (e.data.type !== 'fishtop:catches' || !Array.isArray(e.data.fish)) return;
    const st = game.state;
    st.browserImports ||= [];
    const known = new Set([...st.fish.map((f) => f.uid), ...st.browserImports]);
    const uids = [];
    let added = 0;
    for (const r of e.data.fish.slice(0, 100)) {
      if (!r || typeof r.uid !== 'string' || !SPECIES_BY_ID[r.species]) continue;
      uids.push(r.uid);
      if (known.has(r.uid)) continue;
      const sp = SPECIES_BY_ID[r.species];
      const rec = { ...sanitize(r), biome: sp.biome, rarity: sp.rarity, fromBrowser: true };
      const j = (st.journal[sp.id] ||= { seen: true, caught: 0, maxSize: 0, minSize: 9999, first: rec.caughtAt, variants: {} });
      j.caught++;
      j.maxSize = Math.max(j.maxSize, rec.sizeCm);
      j.minSize = Math.min(j.minSize, rec.sizeCm);
      if (rec.variant?.mutation) j.variants[rec.variant.mutation] = true;
      if (rec.variant?.shiny) j.variants.shiny = true;
      st.stats.caught++;
      const owned = { ...rec, inTank: game.tankCount() < game.stats.tankCap, happiness: 0.75, hunger: 0.3, coinT: 0 };
      st.fish.push(owned);
      if (owned.inTank) game.aquarium.addFish(owned);
      st.browserImports.push(rec.uid);
      known.add(rec.uid);
      added++;
    }
    if (st.browserImports.length > 500) st.browserImports = st.browserImports.slice(-500);
    if (added) {
      game.save();
      game.toast(`${added} fish swam in from your browser!`, 'fish');
      game.audio.play('splash_small');
    }
    window.postMessage({ type: 'fishtop:catches-ack', uids }, target());
  });
}
