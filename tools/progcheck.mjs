// Progression graph check: Lab quest gates, ocean expeditions and the main story, with no dead ends.
//   node tools/progcheck.mjs [--quiet]
// Builds one dependency graph of Lab nodes (n:<id>) and quests (q:<id>):
//   node  -> the node(s) before it in its row, its quest gate (lab.js LAB_QUEST_GATE), its boss gate's quest (LAB_GATE)
//   quest -> its chapter being reached (every main quest of earlier chapters), the main quests that must be done before it
//            can enter the 3-quest active window, its side story `after`, and what its objectives ask for (research id,
//            tank / boat tier, visiting an ocean, sailing to the Workshop)
// and checks: every gate names a real node / quest, no gating quest is an order, milestone or online-only story, the graph
// has no cycle, every node and quest is reachable from a fresh save (ignoring prices), and every gating quest opens no
// later than the node is needed (a main quest asking for it) or, for optional nodes, one chapter after its price tier.
// [hot26] Hotbar unlocks (src/game/hotbar.js): every locked hotbar button is a graph key b:<id> (its prop is always
// buildable in the tank). Lab nodes and research / tank / boat goals need b:lab, sailing (visit / dest / Workshop rods)
// needs b:map, chests b:inventory, the Wardrobe b:wardrobe, online goals b:multiplayer; {t: 'hotbar', id} needs b:<id>.
// Each unlock prop must exist as tank decor, and a main quest that needs a locked button must come no later than a main
// quest asking to build it (same active window or earlier), so the story always guides the build first.
// Exits 1 on any failure. Prints the gate table and the ocean expeditions.

// ---- a tiny DOM stub so the data modules (which pull in art code) import under node
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'width' || k === 'height' || k === 'length' ? 0 : mk()), apply: () => mk(), construct: () => mk(), set: () => true });
const img = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
function ctx(c) {
  return new Proxy({ canvas: c }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createImageData') return (w, h) => img(typeof w === 'object' ? w.width : w, h);
      if (k === 'getImageData') return (x, y, w, h) => img(w, h);
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
function canvas() { const c = { width: 1, height: 1, style: {} }; c.getContext = () => ctx(c); c.toDataURL = () => ''; c.addEventListener = () => {}; return c; }
globalThis.document = new Proxy({ createElement: (t) => (t === 'canvas' ? canvas() : mk()), body: mk(), fonts: mk() }, { get: (t, k) => (k in t ? t[k] : mk()) });
globalThis.window = globalThis; globalThis.Image = function () { return mk(); };
globalThis.OffscreenCanvas = function (w, h) { const c = canvas(); c.width = w; c.height = h; return c; };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = () => 0; globalThis.FontFace = function () { return mk(); };

const quiet = process.argv.includes('--quiet');
const LAB = await import('../src/game/lab.js');
const Q = await import('../src/game/quests.js');
const BOSS = await import('../src/fish/bosses.js');
const HOT = await import('../src/game/hotbar.js'); // [hot26]
const { PROPS } = await import('../src/gfx/props.js');

const errors = [], warns = [];
const err = (s) => errors.push(s), warn = (s) => warns.push(s);
const { LAB_NODES, LAB_BY_ID, ROOT_ID, LAB_QUEST_GATE, LAB_GATE, TANK_ORDER, BOAT_ORDER, OCEAN_COST, nodeFor } = LAB;
const { CHAPTERS, QUEST_BY_ID } = Q;
const ACTIVE = 3; // quests.js ACTIVE_MAX
const STAGE_OF_TIER = [1, 1, 1, 2, 3, 4, 5, 6, 7, 7]; // the chapter a tier's price is balanced for (see the pacing estimate)
const chN = (chId) => Number(String(chId || '').replace(/\D/g, '')) || 0;

// ---------------------------------------------------------------- the graph
const deps = new Map(); // key -> Set(keys)
const need = (a, b) => { if (!deps.has(a)) deps.set(a, new Set()); if (b && b !== 'n:' + ROOT_ID) deps.get(a).add(b); };
const objNeeds = (o) => {
  switch (o.t) {
    case 'research': return o.id ? ['n:' + o.id] : [];
    case 'tank': return o.tier ? [nodeFor('tank', TANK_ORDER[o.tier])?.id].filter(Boolean).map((id) => 'n:' + id) : [];
    case 'boat': return o.tier ? [nodeFor('boat', BOAT_ORDER[o.tier])?.id].filter(Boolean).map((id) => 'n:' + id) : [];
    case 'visit': return o.biome && o.biome !== 'oscean' ? [nodeFor('biome', o.biome)?.id].filter(Boolean).map((id) => 'n:' + id) : [];
    case 'dest': return o.id === 'workshop' ? ['q:c2_workshop'] : [];
    case 'depth': return o.alt ? objNeeds(o.alt) : [];
    case 'boss': return ['line_len1', 'line_len2'].filter((id) => LAB_BY_ID[id]).map((id) => 'n:' + id); // [crate26] the abyss needs a longer line
    default: return [];
  }
};
// [hot26] the hotbar buttons an objective needs (keys b:<id>, only those that start locked)
const HOT_LOCKED = new Set(Object.keys(HOT.HOTBAR_UNLOCKS));
const btnNeeds = (o) => {
  const ids = [];
  switch (o.t) {
    case 'hotbar': ids.push(o.id); break;
    case 'research': case 'tank': case 'boat': case 'labDone': ids.push('lab'); break;
    case 'visit': if (o.biome && o.biome !== 'oscean') ids.push('map'); break;
    case 'dest': case 'craftRod': case 'rodUp': case 'tackle': ids.push('map'); break;
    case 'chest': ids.push('inventory'); break;
    case 'dress': ids.push('wardrobe'); break;
    case 'online': ids.push('multiplayer'); break;
    case 'depth': return o.alt ? btnNeeds(o.alt) : [];
    default: break;
  }
  return ids.filter((id) => HOT_LOCKED.has(id)).map((id) => 'b:' + id);
};
for (const id of HOT_LOCKED) need('b:' + id);
for (const [id, u] of Object.entries(HOT.HOTBAR_UNLOCKS)) {
  if (!PROPS[u.prop]?.decor) err(`hotbar ${id}: unlock prop ${u.prop} is not tank decor`);
  if (!(u.price > 0)) err(`hotbar ${id}: no unlock price`);
  if (HOT.HOTBAR_START.includes(id)) err(`hotbar ${id}: both a start button and an unlock`);
}
for (const nd of LAB_NODES) {
  if (nd.id === ROOT_ID) continue;
  const k = 'n:' + nd.id;
  need(k);
  for (const r of nd.req) need(k, 'n:' + r);
  if (HOT_LOCKED.has('lab')) need(k, 'b:lab'); // [hot26] research happens in The Lab
  if (nd.qgate) need(k, 'q:' + nd.qgate);
  if (nd.gate?.boss) { const b = BOSS.BOSS_BY_ID[nd.gate.boss]; if (b?.quest) need(k, 'q:' + b.quest); }
}
CHAPTERS.forEach((c, ci) => {
  const earlier = CHAPTERS.slice(0, ci).flatMap((x) => x.quests.map((q) => 'q:' + q.id));
  c.quests.forEach((q, i) => {
    const k = 'q:' + q.id;
    need(k);
    for (const e of earlier) need(k, e);
    for (let j = 0; j <= i - ACTIVE; j++) need(k, 'q:' + c.quests[j].id); // must be in the active window to complete
    for (const o of q.objectives) for (const d of [...objNeeds(o), ...btnNeeds(o)]) need(k, d); // [hot26] + buttons
  });
  for (const q of c.side) {
    const k = 'q:' + q.id;
    need(k);
    for (const e of earlier) need(k, e);
    if (q.after) need(k, 'q:' + q.after);
    for (const o of q.objectives) for (const d of [...objNeeds(o), ...btnNeeds(o)]) need(k, d); // [hot26] + buttons
  }
});

// ---------------------------------------------------------------- gate sanity
for (const [nid, qid] of Object.entries(LAB_QUEST_GATE)) {
  const nd = LAB_BY_ID[nid], q = QUEST_BY_ID[qid];
  if (!nd) { err(`gate on unknown node ${nid}`); continue; }
  if (!q) { err(`${nid}: gating quest ${qid} does not exist`); continue; }
  if (q.kind !== 'main' && q.kind !== 'side') err(`${nid}: gating quest ${qid} is a ${q.kind} (only story / side / boss quests may gate)`);
  if (q.online) err(`${nid}: gating quest ${qid} needs multiplayer (optional content)`);
  if (nd.qgate !== qid) err(`${nid}: node.qgate ${nd.qgate} != ${qid}`);
  if (!(q.reward?.opens || []).includes(nid)) err(`${qid}: reward.opens is missing ${nid}`);
}
for (const [t, b] of Object.entries(LAB_GATE)) if (!BOSS.BOSS_BY_ID[b]?.quest) err(`LAB_GATE tier ${t}: boss ${b} has no quest`);

// ---------------------------------------------------------------- cycles
const state = new Map();
const stack = [];
function dfs(k) {
  const s = state.get(k);
  if (s === 2) return;
  if (s === 1) { const i = stack.indexOf(k); err('cycle: ' + [...stack.slice(i), k].join(' -> ')); return; }
  state.set(k, 1); stack.push(k);
  for (const d of deps.get(k) || []) { if (!deps.has(d)) { err(`${k} needs unknown ${d}`); continue; } dfs(d); }
  stack.pop(); state.set(k, 2);
}
for (const k of deps.keys()) dfs(k);

// ---------------------------------------------------------------- reachability from a fresh save (prices ignored)
const done = new Set(), when = new Map(); // when: the step a key became reachable
for (let step = 0, grew = true; grew; step++) {
  grew = false;
  for (const [k, ds] of deps) if (!done.has(k) && [...ds].every((d) => done.has(d))) { done.add(k); when.set(k, step); grew = true; }
}
for (const k of deps.keys()) {
  if (done.has(k)) continue;
  const w = [...deps.get(k)].filter((d) => !done.has(d));
  err(`unreachable: ${k} (waits on ${w.slice(0, 4).join(', ')}${w.length > 4 ? ` +${w.length - 4} more` : ''})`);
}

// ---------------------------------------------------------------- timing: gates open before / alongside the need
const questCh = (qid) => chN(QUEST_BY_ID[qid]?.chapter);
// the earliest chapter whose main line asks for a node (directly or through what it needs)
const neededBy = {};
const markNeed = (k, ch, via, seen = new Set()) => {
  if (seen.has(k)) return; seen.add(k);
  if (k.startsWith('n:')) { const id = k.slice(2); if (!neededBy[id] || neededBy[id].ch > ch) neededBy[id] = { ch, via }; }
  for (const d of deps.get(k) || []) if (d.startsWith('n:')) markNeed(d, ch, via, seen);
};
CHAPTERS.forEach((c, ci) => c.quests.forEach((q) => { for (const o of q.objectives) for (const d of objNeeds(o)) markNeed(d, ci + 1, q.id); }));
const rows = [];
for (const [nid, qid] of Object.entries(LAB_QUEST_GATE)) {
  const nd = LAB_BY_ID[nid], q = QUEST_BY_ID[qid];
  if (!nd || !q) continue;
  const gch = questCh(qid), stage = STAGE_OF_TIER[nd.tier] || 7, nb = neededBy[nid];
  const limit = nb ? nb.ch : Math.min(7, stage + 1);
  if (gch > limit) err(`${nid} (tier ${nd.tier}${nb ? ', needed by ' + nb.via + ' in ch' + nb.ch : ''}) is gated by ${qid} from ch${gch}: too late`);
  rows.push({ nid, nd, qid, q, gch, stage, nb });
}

// ---------------------------------------------------------------- [hot26] the story guides each build before it is needed
const mainSeq = CHAPTERS.flatMap((c, ci) => c.quests.map((q, i) => ({ q, ci, i })));
const buildAt = {}; // btn -> {q, ci, i} of the first main quest asking to build it
for (const m of mainSeq) for (const o of m.q.objectives) if (o.t === 'hotbar' && !buildAt[o.id]) buildAt[o.id] = m;
const hotRows = [];
for (const m of mainSeq) {
  for (const o of m.q.objectives) {
    if (o.t === 'hotbar') continue;
    for (const b of btnNeeds(o)) {
      const id = b.slice(2), at = buildAt[id];
      if (!at) { err(`${m.q.id} needs the ${id} button but no main quest asks to build its ${HOT.HOTBAR_UNLOCKS[id].build}`); continue; }
      if (at.ci > m.ci || (at.ci === m.ci && at.i >= m.i + ACTIVE)) err(`${m.q.id} needs the ${id} button before ${at.q.id} asks to build its ${HOT.HOTBAR_UNLOCKS[id].build}`);
    }
  }
}
for (const [id, u] of Object.entries(HOT.HOTBAR_UNLOCKS)) {
  const at = buildAt[id];
  const side = at ? null : CHAPTERS.flatMap((c) => c.side).find((q) => q.objectives.some((o) => o.t === 'hotbar' && o.id === id));
  hotRows.push({ id, u, via: at ? `${at.q.id} (ch${at.ci + 1}, main)` : side ? `${side.id} (${side.chapter}, side)` : 'tips only' });
}

// ---------------------------------------------------------------- oceans: expensive, steep, boss-gated
const seas = LAB_NODES.filter((nd) => nd.ocean).sort((a, b) => a.tier - b.tier);
let prev = 0;
for (const nd of seas) {
  if (!OCEAN_COST[nd.id]) err(`${nd.id}: no OCEAN_COST`);
  const q = nd.qgate && QUEST_BY_ID[nd.qgate];
  if (!q || !q.objectives.some((o) => o.t === 'boss')) err(`${nd.id}: not gated by a boss quest`);
  if (prev && nd.cost.aero < prev * 2) err(`${nd.id}: ${nd.cost.aero} Aero is not a steep step from ${prev}`);
  prev = nd.cost.aero;
}
// chapter rewards must not hand out the next ocean any more
for (const c of CHAPTERS) for (const id of c.reward.lab || []) if (LAB_BY_ID[id]?.ocean) err(`${c.id} reward still grants the ocean node ${id}`);

// ---------------------------------------------------------------- report
if (!quiet) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n== Quest-gated Lab research (${rows.length} nodes) ==`);
  console.log(pad('node', 22) + pad('branch', 10) + pad('tier', 5) + pad('quest', 34) + pad('giver', 15) + pad('kind', 6) + pad('opens', 7) + 'needed by');
  for (const r of rows.sort((a, b) => a.gch - b.gch || a.nd.tier - b.nd.tier)) {
    const kind = r.q.objectives.some((o) => o.t === 'boss') ? 'boss' : r.q.kind;
    console.log(pad(r.nd.name, 22) + pad(r.nd.branch, 10) + pad(r.nd.tier, 5) + pad(`${r.qid} "${r.q.title}"`, 34) + pad(Q.NPC_NAMES[r.q.giver] || r.q.giver, 15) + pad(kind, 6) + pad('ch' + r.gch, 7) + (r.nb ? `${r.nb.via} (ch${r.nb.ch})` : `optional (priced for ch${r.stage})`));
  }
  console.log('\n== Hotbar unlocks (start: ' + HOT.HOTBAR_START.join(', ') + ' + ' + HOT.HOTBAR_ALWAYS.join(', ') + ') ==');
  for (const r of hotRows) console.log(pad(r.u.label, 13) + pad(r.u.build, 20) + pad(r.u.price + ' Aero', 9) + r.via);
  console.log('\n== Ocean expeditions ==');
  for (const nd of seas) {
    const it = Object.entries(nd.cost.items).map(([k, v]) => `${v} ${k}`).join(', ');
    const fi = Object.entries(nd.cost.fish).map(([k, v]) => `${v} ${k}`).join(', ');
    console.log(`${pad(nd.name, 18)} ${String(nd.cost.aero.toLocaleString('en-US')).padStart(7)} Aero  + ${it}${fi ? ' + fish: ' + fi : ''}  [after ${nd.qgate}]`);
  }
}
for (const w of warns) console.log('warn: ' + w);
for (const e of errors) console.log('FAIL: ' + e);
console.log(errors.length ? `\n${errors.length} problem(s)` : `\nprogression graph OK: ${deps.size} nodes + quests, no cycles, no dead ends`);
process.exit(errors.length ? 1 : 0);
