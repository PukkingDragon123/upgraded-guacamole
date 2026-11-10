// Realistic anatomy library (phase 4). Every species renders as a realistic voxel model of its base animal
// (src/fish/realvox.js); the meme names, rarities, biomes, bait and fight data stay in species*.js.
//
// ARCH: archetypes in body-length units (L = look.body.len, u 0 = snout tip .. 1 = caudal peduncle, y up).
//   body {D, up, at, atB, ped, pc, tip, fore, chin, back, backB, hump, sag, nose, W, atW, wTip, pw, xs, wy}
//        or knots body.top / body.bot / body.wid ([[u, y], ...])
//   eye {u, v (0 belly .. 1 back), r, iris, pupil, top, front, glow}, mouth {u, v, drop, curve, type, teeth, lips}
//   op {u, top, bot, bulge, pre, cover}, slits {n, u0, u1, v0, v1} (sharks), lateral {v0, v1, tone|color}
//   scales {size, k}, fins [{at: top|bot, from, to, h, shape, rake, rays, spiny, notch, adipose, finlets,
//   thick, col, edge, base, spots}], pec / pel {u, v, len, w, ang, spread, shape, col, edge, spots},
//   tail {type: fork|lunate|round|truncate|emarginate|hetero|pointed|fan|lyre, len, spread, fork, lobe, thick,
//   col, edge, base, upper, lower}, col {back, flank, belly, vb, vbel, soft, fin, head, headU}, pat [...]
//   (see realvox.applyPattern), barbels, lure, bill, ceph, spines, glassCore, flat {roll, blind}, mat
//   {gloss, iri, chrome, glass, finGlass, finTint, sheen, rim, vivid}, wave, stiff.
// SPEC: species id -> {base, ...overrides} (deep merged; arrays replace). Colours pass through the
// variant (mutation / shiny) transform of the compiled creature.

const A = {};

// ---------------------------------------------------------------- bony fishes (teleosts)

A.perch = {
  plan: 'fish',
  body: { D: 0.3, up: 0.55, at: 0.36, ped: 0.32, tip: -0.01, fore: 1.7, chin: 1.8, back: 0.95, W: 0.072, nose: 0.035, xs: 2, wy: 0.45 },
  eye: { u: 0.085, v: 0.66, r: 0.028, iris: '#d8b04a' },
  mouth: { u: 0.1, v: 0.42, drop: -0.006 },
  op: { u: 0.25, top: 0.84, bot: 0.12, bulge: 0.025, pre: 0.05 },
  lateral: { v0: 0.78, v1: 0.55, tone: -0.12 },
  scales: { size: 0.022, k: 0.07 },
  fins: [
    { at: 'top', from: 0.3, to: 0.56, h: 0.13, shape: 'spiny', spiny: true, rake: 0.35, rays: 11 },
    { at: 'top', from: 0.57, to: 0.8, h: 0.11, shape: 'round', rake: 0.5, rays: 12 },
    { at: 'bot', from: 0.62, to: 0.8, h: 0.09, shape: 'tri', rake: 0.45, rays: 9 },
  ],
  pec: { u: 0.265, v: 0.36, len: 0.15, w: 0.045, ang: -10, rays: 13 },
  pel: { u: 0.32, len: 0.11, w: 0.03, ang: -55, spread: 20 },
  tail: { type: 'emarginate', len: 0.2, spread: 0.15, fork: 0.12, rays: 15 },
  col: { back: '#4a6a3a', flank: '#c8c070', belly: '#f4f0dc', fin: '#c8a858', vb: 0.66, vbel: 0.3 },
  mat: { iri: 0.1, gloss: 0.82 },
  wave: 0.5,
};

A.salmon = {
  plan: 'fish',
  body: { D: 0.24, up: 0.52, at: 0.42, ped: 0.34, tip: -0.006, fore: 1.55, chin: 1.65, back: 0.95, W: 0.068, nose: 0.035, xs: 2.1, wy: 0.42 },
  eye: { u: 0.075, v: 0.64, r: 0.023, iris: '#cfc28a' },
  mouth: { u: 0.115, v: 0.4, drop: -0.012, curve: 0.006 },
  op: { u: 0.215, top: 0.84, bot: 0.1, bulge: 0.022, pre: 0.045 },
  lateral: { v0: 0.64, v1: 0.5, tone: -0.12 },
  scales: { size: 0.014, k: 0.05 },
  fins: [
    { at: 'top', from: 0.4, to: 0.53, h: 0.11, shape: 'tri', rake: 0.45, rays: 11 },
    { at: 'top', from: 0.79, to: 0.85, h: 0.035, adipose: true },
    { at: 'bot', from: 0.68, to: 0.79, h: 0.08, shape: 'tri', rake: 0.4, rays: 9 },
  ],
  pec: { u: 0.23, v: 0.22, len: 0.12, w: 0.035, ang: -15, rays: 12 },
  pel: { u: 0.52, len: 0.08, w: 0.025, ang: -40, spread: 18 },
  tail: { type: 'fork', len: 0.2, spread: 0.15, fork: 0.22, rays: 16 },
  col: { back: '#3a5872', flank: '#c4d0da', belly: '#f6f8fa', fin: '#8a9aa8', vb: 0.68, vbel: 0.32 },
  mat: { iri: 0.28, gloss: 0.86 },
  wave: 0.5,
};

A.tuna = {
  plan: 'fish',
  body: { D: 0.27, up: 0.52, at: 0.4, ped: 0.11, tip: -0.008, fore: 1.45, chin: 1.55, back: 1.25, W: 0.1, pw: 0.035, nose: 0.03, xs: 2, wy: 0.48 },
  eye: { u: 0.085, v: 0.6, r: 0.024, iris: '#b8c0c8' },
  mouth: { u: 0.1, v: 0.45, drop: -0.01 },
  op: { u: 0.25, top: 0.86, bot: 0.12, bulge: 0.03, cover: '#b8c8d8', coverAmt: 0.25 },
  lateral: { v0: 0.82, v1: 0.5, tone: -0.08 },
  scales: { size: 0.01, k: 0.02 },
  fins: [
    { at: 'top', from: 0.3, to: 0.46, h: 0.11, shape: 'spiny', spiny: true, notch: 0.15, rake: 0.6, rays: 12 },
    { at: 'top', from: 0.5, to: 0.6, h: 0.13, shape: 'sickle', rake: 0.9, rays: 9, col: '#e8c040' },
    { at: 'top', from: 0.62, to: 0.94, h: 0.03, finlets: 8, col: '#f8d838', rake: 0.3 },
    { at: 'bot', from: 0.54, to: 0.64, h: 0.12, shape: 'sickle', rake: 0.9, rays: 9, col: '#e8c040' },
    { at: 'bot', from: 0.66, to: 0.94, h: 0.03, finlets: 7, col: '#f8d838', rake: 0.3 },
  ],
  pec: { u: 0.27, v: 0.56, len: 0.2, w: 0.035, ang: -6, shape: 'long', spread: 22, rays: 14 },
  pel: { u: 0.31, len: 0.07, w: 0.022, ang: -45, spread: 18 },
  tail: { type: 'lunate', len: 0.26, spread: 0.26, fork: 0.62, rays: 18, focus: 0.03 },
  col: { back: '#10204a', flank: '#9aacc4', belly: '#eef2f6', fin: '#2a3450', vb: 0.6, vbel: 0.38, soft: 0.08 },
  pat: [{ type: 'band', at: 0.6, width: 0.1, color: '#3a5a9a', alpha: 0.6, fade: [0.1, 0.4] }],
  mat: { iri: 0.35, gloss: 0.92, silver: 0.4, finGlass: 0.9 },
  wave: 0.35, stiff: true,
};

A.mackerel = {
  ...A.tuna,
  body: { D: 0.19, up: 0.52, at: 0.4, ped: 0.14, tip: -0.005, fore: 1.4, chin: 1.5, back: 1.15, W: 0.062, pw: 0.022, nose: 0.03, xs: 2, wy: 0.48 },
  eye: { u: 0.085, v: 0.6, r: 0.026, iris: '#d0d8e0' },
  fins: [
    { at: 'top', from: 0.32, to: 0.44, h: 0.09, shape: 'tri', spiny: true, notch: 0.1, rake: 0.5, rays: 10 },
    { at: 'top', from: 0.56, to: 0.64, h: 0.07, shape: 'tri', rake: 0.6, rays: 8 },
    { at: 'top', from: 0.66, to: 0.92, h: 0.022, finlets: 5, rake: 0.3 },
    { at: 'bot', from: 0.58, to: 0.66, h: 0.06, shape: 'tri', rake: 0.6, rays: 8 },
    { at: 'bot', from: 0.68, to: 0.92, h: 0.022, finlets: 5, rake: 0.3 },
  ],
  pec: { u: 0.25, v: 0.6, len: 0.11, w: 0.03, ang: -8, rays: 12 },
  tail: { type: 'fork', len: 0.22, spread: 0.2, fork: 0.72, rays: 16 },
  col: { back: '#1a5a6a', flank: '#c8d8e0', belly: '#f6f9fb', fin: '#5a7280', vb: 0.6, vbel: 0.38, soft: 0.06 },
  pat: [{ type: 'lines', color: '#0a1e2a', vmin: 0.64, freq: 26, width: 0.35, slope: -1.2, wavy: 0.6 }],
  mat: { iri: 0.45, gloss: 0.92, finGlass: 0.75 },
  wave: 0.45,
};

A.sardine = {
  plan: 'fish',
  body: { D: 0.2, up: 0.48, at: 0.4, ped: 0.24, tip: 0.0, fore: 1.5, chin: 1.4, back: 1, W: 0.045, nose: 0.02, xs: 1.7, wy: 0.45 },
  eye: { u: 0.08, v: 0.6, r: 0.033, iris: '#d8dde4' },
  mouth: { u: 0.07, v: 0.55, drop: -0.006 },
  op: { u: 0.21, top: 0.82, bot: 0.1, bulge: 0.02, cover: '#e0e8f0', coverAmt: 0.3 },
  scales: { size: 0.03, k: 0.05 },
  fins: [
    { at: 'top', from: 0.42, to: 0.55, h: 0.1, shape: 'tri', rake: 0.35, rays: 10 },
    { at: 'bot', from: 0.78, to: 0.88, h: 0.05, shape: 'tri', rake: 0.4, rays: 8 },
  ],
  pec: { u: 0.23, v: 0.2, len: 0.1, w: 0.025, ang: -15, rays: 10 },
  pel: { u: 0.52, len: 0.06, w: 0.02, ang: -40 },
  tail: { type: 'fork', len: 0.24, spread: 0.18, fork: 0.65, rays: 16 },
  col: { back: '#1a4a8a', flank: '#c8d4e2', belly: '#f8fafc', fin: '#a8b8c8', vb: 0.7, vbel: 0.4, soft: 0.07 },
  pat: [{ type: 'spots', color: '#183050', size: 0.012, density: 0.9, vmin: 0.6, vmax: 0.7, seed: 4 }],
  mat: { iri: 0.6, gloss: 0.9 },
  wave: 0.6,
};

A.carp = {
  plan: 'fish',
  body: { D: 0.34, up: 0.56, at: 0.36, ped: 0.32, tip: -0.02, fore: 2.0, chin: 1.8, back: 0.9, hump: 0.04, W: 0.09, nose: 0.05, xs: 2, wy: 0.45 },
  eye: { u: 0.09, v: 0.6, r: 0.024, iris: '#d8b860' },
  mouth: { u: 0.065, v: 0.36, drop: -0.008, lips: '#e8b8a0' },
  op: { u: 0.235, top: 0.82, bot: 0.12, bulge: 0.03 },
  lateral: { v0: 0.58, v1: 0.5, tone: -0.1, dash: true },
  scales: { size: 0.04, k: 0.11 },
  fins: [
    { at: 'top', from: 0.36, to: 0.74, h: 0.12, shape: 'fall', rake: 0.35, rays: 16 },
    { at: 'bot', from: 0.72, to: 0.8, h: 0.1, shape: 'tri', rake: 0.35, rays: 7 },
  ],
  pec: { u: 0.25, v: 0.16, len: 0.14, w: 0.045, ang: -25, rays: 14 },
  pel: { u: 0.45, len: 0.12, w: 0.035, ang: -50, spread: 20 },
  tail: { type: 'fork', len: 0.24, spread: 0.18, fork: 0.42, rays: 18 },
  barbels: [{ u: 0.035, v: 0.36, len: 0.035, ang: -140, curl: 0.3, out: 0.2, col: '#b07858' }, { u: 0.065, v: 0.3, len: 0.045, ang: -150, curl: 0.4, out: 0.25, col: '#b07858' }],
  col: { back: '#5a4a1e', flank: '#b8983e', belly: '#f0e0b0', fin: '#a87840', vb: 0.66, vbel: 0.3 },
  mat: { iri: 0.15, gloss: 0.85 },
  wave: 0.45,
};

A.goldfish = {
  ...A.carp,
  body: { D: 0.46, up: 0.56, at: 0.4, ped: 0.24, tip: -0.03, fore: 2.4, chin: 2.2, back: 0.8, hump: 0.06, sag: 0.04, W: 0.13, nose: 0.06, xs: 2, wy: 0.45 },
  eye: { u: 0.11, v: 0.62, r: 0.04, iris: '#f0c040' },
  fins: [
    { at: 'top', from: 0.32, to: 0.7, h: 0.22, shape: 'trail', rake: 0.6, rays: 14 },
    { at: 'bot', from: 0.72, to: 0.82, h: 0.14, shape: 'trail', rake: 0.6, rays: 7 },
  ],
  pec: { u: 0.28, v: 0.22, len: 0.16, w: 0.06, ang: -30, rays: 12 },
  pel: { u: 0.48, len: 0.16, w: 0.05, ang: -60, spread: 20 },
  tail: { type: 'fan', len: 0.5, spread: 0.36, fork: 0.25, rays: 18 },
  barbels: [],
  col: { back: '#f08010', flank: '#ff9a1a', belly: '#ffd27a', fin: '#ffb040', vb: 0.66, vbel: 0.28 },
  mat: { iri: 0.3, gloss: 0.9, finGlass: 0.48 },
  wave: 0.4,
};

A.grouper = {
  plan: 'fish',
  body: { D: 0.32, up: 0.52, at: 0.38, ped: 0.36, tip: -0.03, fore: 1.6, chin: 2.2, back: 0.9, W: 0.11, wTip: 0.04, nose: 0.05, xs: 2.2, wy: 0.42 },
  eye: { u: 0.1, v: 0.74, r: 0.024, iris: '#c89048' },
  mouth: { u: 0.17, v: 0.36, drop: -0.04, curve: 0.012, lips: '#c8a888' },
  op: { u: 0.3, top: 0.84, bot: 0.14, bulge: 0.03, pre: 0.07 },
  lateral: { v0: 0.84, v1: 0.6, tone: -0.08 },
  scales: { size: 0.014, k: 0.05 },
  fins: [
    { at: 'top', from: 0.28, to: 0.6, h: 0.1, shape: 'spiny', spiny: true, rake: 0.3, rays: 11 },
    { at: 'top', from: 0.6, to: 0.82, h: 0.12, shape: 'round', rake: 0.45, rays: 14 },
    { at: 'bot', from: 0.64, to: 0.82, h: 0.11, shape: 'round', rake: 0.45, rays: 9 },
  ],
  pec: { u: 0.31, v: 0.4, len: 0.16, w: 0.06, ang: -10, rays: 16 },
  pel: { u: 0.33, len: 0.12, w: 0.035, ang: -60, spread: 20 },
  tail: { type: 'round', len: 0.2, spread: 0.16, rays: 16 },
  col: { back: '#5a4a32', flank: '#8a7a58', belly: '#d8cab0', fin: '#6a5a40', vb: 0.6, vbel: 0.26 },
  pat: [{ type: 'spots', color: '#3a2a1a', size: 0.022, density: 0.7, seed: 6 }],
  mat: { iri: 0.05, gloss: 0.78 },
  wave: 0.4,
};

A.snapper = {
  ...A.perch,
  body: { D: 0.36, up: 0.6, at: 0.36, ped: 0.26, tip: -0.025, fore: 1.25, chin: 1.9, back: 1, W: 0.075, nose: 0.03, xs: 1.9, wy: 0.45 },
  eye: { u: 0.13, v: 0.72, r: 0.03, iris: '#e05040' },
  mouth: { u: 0.12, v: 0.4, drop: -0.01, lips: '#e8a090' },
  fins: [
    { at: 'top', from: 0.3, to: 0.58, h: 0.12, shape: 'spiny', spiny: true, rake: 0.35, rays: 10 },
    { at: 'top', from: 0.58, to: 0.8, h: 0.1, shape: 'tri', rake: 0.6, rays: 12 },
    { at: 'bot', from: 0.64, to: 0.8, h: 0.1, shape: 'tri', rake: 0.5, rays: 8 },
  ],
  pec: { u: 0.3, v: 0.38, len: 0.22, w: 0.04, ang: -8, shape: 'long', rays: 14 },
  tail: { type: 'fork', len: 0.22, spread: 0.18, fork: 0.32, rays: 16 },
  col: { back: '#d02838', flank: '#f06070', belly: '#ffd8d8', fin: '#f05060', vb: 0.6, vbel: 0.3 },
};

A.cod = {
  plan: 'fish',
  body: { D: 0.23, up: 0.52, at: 0.32, ped: 0.24, tip: -0.006, fore: 1.6, chin: 1.9, back: 0.8, W: 0.08, nose: 0.04, xs: 2.1, wy: 0.42 },
  eye: { u: 0.09, v: 0.7, r: 0.027, iris: '#c8c090' },
  mouth: { u: 0.1, v: 0.38, drop: -0.012, curve: 0.01 },
  op: { u: 0.24, top: 0.84, bot: 0.14, bulge: 0.025 },
  lateral: { v0: 0.82, v1: 0.52, color: '#e8e4d0', w: 0.65 },
  scales: { size: 0.012, k: 0.03 },
  fins: [
    { at: 'top', from: 0.3, to: 0.42, h: 0.1, shape: 'round', rake: 0.3, rays: 12 },
    { at: 'top', from: 0.46, to: 0.63, h: 0.085, shape: 'round', rake: 0.35, rays: 16 },
    { at: 'top', from: 0.67, to: 0.83, h: 0.075, shape: 'round', rake: 0.35, rays: 16 },
    { at: 'bot', from: 0.44, to: 0.63, h: 0.075, shape: 'round', rake: 0.35, rays: 16 },
    { at: 'bot', from: 0.67, to: 0.83, h: 0.07, shape: 'round', rake: 0.35, rays: 14 },
  ],
  pec: { u: 0.26, v: 0.48, len: 0.13, w: 0.04, ang: -12, rays: 14 },
  pel: { u: 0.22, len: 0.09, w: 0.025, ang: -65, spread: 18 },
  tail: { type: 'truncate', len: 0.15, spread: 0.13, rays: 16 },
  barbels: [{ u: 0.06, v: 0.02, len: 0.05, ang: -95, curl: 0.3, out: 0 }],
  col: { back: '#5a6038', flank: '#a8a070', belly: '#f0ecd8', fin: '#7a7850', vb: 0.6, vbel: 0.34 },
  pat: [{ type: 'spots', color: '#3a3a20', size: 0.01, density: 0.85, vmin: 0.42, seed: 8 }],
  mat: { iri: 0.08, gloss: 0.78 },
  wave: 0.5,
};

A.clown = {
  plan: 'fish',
  body: { D: 0.44, up: 0.55, at: 0.4, ped: 0.34, tip: -0.035, fore: 2.8, chin: 2.4, back: 0.85, W: 0.11, nose: 0.1, xs: 2, wy: 0.45 },
  eye: { u: 0.14, v: 0.66, r: 0.046, iris: '#e86a10', pupil: 0.58 },
  mouth: { u: 0.075, v: 0.42, drop: -0.008 },
  op: { u: 0.25, top: 0.82, bot: 0.12, bulge: 0.03, dark: 0.12 },
  scales: { size: 0.03, k: 0.04 },
  fins: [
    { at: 'top', from: 0.3, to: 0.52, h: 0.12, shape: 'spiny', spiny: true, notch: 0.4, rake: 0.25, rays: 9, edge: '#141018', edgeW: 0.14 },
    { at: 'top', from: 0.53, to: 0.8, h: 0.15, shape: 'round', rake: 0.4, rays: 12, edge: '#141018', edgeW: 0.14 },
    { at: 'bot', from: 0.62, to: 0.82, h: 0.13, shape: 'round', rake: 0.45, rays: 9, edge: '#141018', edgeW: 0.14 },
  ],
  pec: { u: 0.3, v: 0.36, len: 0.16, w: 0.07, ang: -8, rays: 14, col: '#ff9030', edge: '#141018' },
  pel: { u: 0.36, len: 0.12, w: 0.04, ang: -60, spread: 22, edge: '#141018' },
  tail: { type: 'round', len: 0.24, spread: 0.2, rays: 14, edge: '#141018', edgeW: 0.1 },
  col: { back: '#f05a08', flank: '#ff7a14', belly: '#ff9a3a', fin: '#ff8020', vb: 0.66, vbel: 0.3 },
  pat: [
    { type: 'bars', at: [0.17, 0.5, 0.92], width: 0.11, color: '#fffaf4', wavy: 0.012, edge: true, edgeW: 0.014 },
  ],
  mat: { iri: 0.05, gloss: 0.9, finGlass: 0.7 },
  wave: 0.55,
};

A.damsel = {
  ...A.perch,
  body: { D: 0.4, up: 0.55, at: 0.36, ped: 0.24, tip: -0.01, fore: 1.8, chin: 1.8, back: 1.05, W: 0.07, nose: 0.04, xs: 1.9, wy: 0.45 },
  eye: { u: 0.11, v: 0.64, r: 0.045, iris: '#9ad8c0' },
  mouth: { u: 0.06, v: 0.52, drop: -0.006 },
  fins: [
    { at: 'top', from: 0.28, to: 0.58, h: 0.13, shape: 'spiny', spiny: true, rake: 0.3, rays: 11 },
    { at: 'top', from: 0.58, to: 0.8, h: 0.15, shape: 'tri', rake: 0.6, rays: 11 },
    { at: 'bot', from: 0.62, to: 0.82, h: 0.13, shape: 'tri', rake: 0.55, rays: 9 },
  ],
  pec: { u: 0.28, v: 0.42, len: 0.17, w: 0.05, ang: -8, rays: 14 },
  tail: { type: 'fork', len: 0.28, spread: 0.24, fork: 0.6, rays: 16 },
  col: { back: '#28b8a0', flank: '#8af0d0', belly: '#e0fff4', fin: '#a8f0dc', vb: 0.66, vbel: 0.3 },
  scales: { size: 0.035, k: 0.08 },
  mat: { iri: 0.4, gloss: 0.88 },
};

A.angelfw = {
  plan: 'fish',
  body: { D: 0.78, up: 0.5, at: 0.4, ped: 0.11, tip: 0.0, fore: 1.35, chin: 1.35, back: 1.0, W: 0.05, nose: 0.03, xs: 1.6, wy: 0.5 },
  eye: { u: 0.13, v: 0.6, r: 0.045, iris: '#e04838' },
  mouth: { u: 0.06, v: 0.55, drop: -0.004 },
  op: { u: 0.25, top: 0.72, bot: 0.26, bulge: 0.03, dark: 0.15 },
  scales: { size: 0.03, k: 0.05 },
  fins: [
    { at: 'top', from: 0.42, to: 0.86, h: 0.55, shape: 'rise', rake: 1.5, rays: 13 },
    { at: 'bot', from: 0.42, to: 0.86, h: 0.55, shape: 'rise', rake: 1.5, rays: 13 },
  ],
  pec: { u: 0.3, v: 0.48, len: 0.14, w: 0.04, ang: -5, rays: 10 },
  pel: { u: 0.34, len: 0.5, w: 0.012, ang: -72, spread: 12, shape: 'long', flap: 0.2 },
  tail: { type: 'lyre', len: 0.32, spread: 0.24, rays: 14 },
  col: { back: '#c8c8d0', flank: '#e8eaf0', belly: '#f6f6fa', fin: '#e0e4f0', vb: 0.66, vbel: 0.3 },
  pat: [{ type: 'bars', at: [0.15, 0.48, 0.82], width: 0.06, color: '#1a1a24', slant: -0.05 }],
  mat: { iri: 0.4, gloss: 0.88, finGlass: 0.45 },
  wave: 0.35,
};

A.butterfly = {
  plan: 'fish',
  body: { D: 0.68, up: 0.54, at: 0.46, ped: 0.2, tip: 0.02, fore: 1.25, chin: 1.4, back: 0.85, W: 0.055, wTip: 0.012, nose: 0.012, xs: 1.6, wy: 0.5 },
  eye: { u: 0.17, v: 0.6, r: 0.04, iris: '#c8a050' },
  mouth: { u: 0.025, v: 0.55, drop: 0 },
  op: { u: 0.28, top: 0.74, bot: 0.24, bulge: 0.03, dark: 0.12 },
  scales: { size: 0.025, k: 0.05 },
  fins: [
    { at: 'top', from: 0.32, to: 0.88, h: 0.2, shape: 'low', spiny: true, notch: 0.15, rake: 0.6, rays: 16 },
    { at: 'bot', from: 0.55, to: 0.88, h: 0.2, shape: 'low', rake: 0.6, rays: 12 },
  ],
  pec: { u: 0.33, v: 0.42, len: 0.13, w: 0.05, ang: -10, rays: 12 },
  pel: { u: 0.36, len: 0.12, w: 0.03, ang: -60, spread: 18 },
  tail: { type: 'truncate', len: 0.18, spread: 0.15, rays: 14 },
  col: { back: '#f0d020', flank: '#fff4b0', belly: '#ffffff', fin: '#f8e060', vb: 0.66, vbel: 0.3 },
  mat: { iri: 0.1, gloss: 0.9, finGlass: 0.66 },
  wave: 0.35,
};

A.tang = {
  ...A.butterfly,
  body: { D: 0.56, up: 0.55, at: 0.42, ped: 0.16, tip: 0.0, fore: 1.6, chin: 1.6, back: 0.9, W: 0.055, nose: 0.03, xs: 1.6, wy: 0.5 },
  eye: { u: 0.18, v: 0.68, r: 0.035, iris: '#3a3020' },
  mouth: { u: 0.03, v: 0.45, drop: 0 },
  fins: [
    { at: 'top', from: 0.28, to: 0.9, h: 0.16, shape: 'low', rake: 0.5, rays: 22 },
    { at: 'bot', from: 0.45, to: 0.9, h: 0.15, shape: 'low', rake: 0.5, rays: 16 },
  ],
  tail: { type: 'lunate', len: 0.24, spread: 0.24, fork: 0.5, rays: 16 },
  pat: [{ type: 'blotch', u: 0.93, v: 0.5, rx: 0.025, ry: 0.15, color: '#f0f0f0' }],
};

A.wrasse = {
  ...A.perch,
  body: { D: 0.27, up: 0.52, at: 0.38, ped: 0.4, tip: 0.0, fore: 1.5, chin: 1.6, back: 0.85, W: 0.06, nose: 0.03, xs: 1.9, wy: 0.45 },
  eye: { u: 0.1, v: 0.7, r: 0.03, iris: '#e05030' },
  mouth: { u: 0.06, v: 0.5, drop: -0.004, lips: '#f0a080' },
  fins: [
    { at: 'top', from: 0.24, to: 0.84, h: 0.08, shape: 'low', spiny: true, notch: 0.12, rake: 0.4, rays: 20 },
    { at: 'bot', from: 0.56, to: 0.84, h: 0.075, shape: 'low', rake: 0.4, rays: 12 },
  ],
  pec: { u: 0.25, v: 0.45, len: 0.14, w: 0.045, ang: -6, rays: 12 },
  tail: { type: 'round', len: 0.18, spread: 0.15, rays: 14 },
  scales: { size: 0.025, k: 0.08 },
  mat: { iri: 0.3, gloss: 0.88 },
};

A.parrot = {
  ...A.wrasse,
  body: { D: 0.34, up: 0.56, at: 0.38, ped: 0.36, tip: -0.02, fore: 2.4, chin: 1.8, back: 0.85, W: 0.085, nose: 0.06, xs: 2, wy: 0.44 },
  eye: { u: 0.13, v: 0.68, r: 0.026, iris: '#f0a020' },
  mouth: { u: 0.04, v: 0.4, drop: -0.004, lips: '#f0f0e0', dark: 0.3 },
  scales: { size: 0.05, k: 0.12 },
  tail: { type: 'lunate', len: 0.22, spread: 0.2, fork: 0.35, rays: 14 },
};

A.puffer = {
  // pufferfish (Arothron / Takifugu): a big blunt head with high eyes, a small beak mouth, a stubby body that tapers
  // to a narrow peduncle, small dorsal + anal fins set far back, little fan pectorals, a short rounded tail
  plan: 'fish',
  body: { D: 0.4, up: 0.52, at: 0.28, atB: 0.38, ped: 0.15, pc: 0.01, tip: -0.03, fore: 2.5, chin: 2.1, back: 1.35, backB: 1.15, W: 0.19, atW: 0.3, wTip: 0.08, pw: 0.032, wBack: 1.1, nose: 0.12, xs: 2.2, wy: 0.42, sag: 0.05 },
  eye: { u: 0.2, v: 0.74, r: 0.04, iris: '#40b878', bulge: 0.55 },
  mouth: { u: 0.028, v: 0.4, drop: 0, curve: 0.002, lips: '#f4efe0', dark: 0.45, gapeK: 0.6 },
  op: null, noGill: true, scales: null, lateral: null,
  fins: [
    { at: 'top', from: 0.66, to: 0.77, h: 0.12, shape: 'round', rake: 0.45, rays: 10 },
    { at: 'bot', from: 0.69, to: 0.79, h: 0.11, shape: 'round', rake: 0.45, rays: 9 },
  ],
  pec: { u: 0.29, v: 0.48, len: 0.1, w: 0.07, ang: 0, spread: 22, rays: 14, shape: 'fan', flap: 1.2 },
  pel: null,
  tail: { type: 'round', len: 0.19, spread: 0.12, rays: 11 },
  spines: { len: 0.045, gap: 0.07, col: '#f4f0e0' },
  col: { back: '#6a6a50', flank: '#a8a888', belly: '#fafaf2', fin: '#c8c098', vb: 0.6, vbel: 0.36, soft: 0.06 },
  pat: [{ type: 'speckle', tone: -0.12, density: 0.06 }],
  mat: { iri: 0.1, gloss: 0.88 },
  wave: 0.22, stiff: true,
};

A.boxfish = {
  plan: 'fish',
  body: { D: 0.42, up: 0.5, at: 0.4, ped: 0.12, tip: -0.03, fore: 3.2, chin: 3.2, back: 1.5, W: 0.17, pw: 0.03, nose: 0.06, xs: 4, wy: 0.5 },
  eye: { u: 0.18, v: 0.74, r: 0.04, iris: '#e8c040' },
  mouth: { u: 0.025, v: 0.3, drop: 0, lips: '#f8d8a0', dark: 0.3 },
  op: null,
  fins: [
    { at: 'top', from: 0.74, to: 0.82, h: 0.08, shape: 'round', rake: 0.4, rays: 8 },
    { at: 'bot', from: 0.76, to: 0.84, h: 0.07, shape: 'round', rake: 0.4, rays: 8 },
  ],
  pec: { u: 0.3, v: 0.46, len: 0.1, w: 0.05, ang: 0, spread: 45, shape: 'fan', rays: 10 },
  pel: null,
  tail: { type: 'round', len: 0.26, spread: 0.16, rays: 10 },
  col: { back: '#f0c010', flank: '#ffd820', belly: '#fff0a0', fin: '#f8d040', vb: 0.66, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#101014', size: 0.016, density: 0.6, seed: 7, umax: 0.8 }],
  mat: { iri: 0.08, gloss: 0.95 },
  wave: 0.2, stiff: true,
};

A.lionfish = {
  plan: 'fish',
  body: { D: 0.3, up: 0.54, at: 0.32, ped: 0.32, tip: -0.01, fore: 1.6, chin: 1.8, back: 0.9, W: 0.08, nose: 0.04, xs: 2, wy: 0.45 },
  eye: { u: 0.1, v: 0.7, r: 0.032, iris: '#d84030' },
  mouth: { u: 0.1, v: 0.4, drop: -0.016, curve: 0.01 },
  op: { u: 0.26, top: 0.8, bot: 0.16, bulge: 0.03, dark: 0.1 },
  scales: { size: 0.018, k: 0.04 },
  fins: [
    { at: 'top', from: 0.22, to: 0.56, h: 0.42, shape: 'tri', spiny: true, notch: 0.92, rake: 0.4, rays: 9, col: '#f8e4dc', clear: true, rayBands: ['#c01818', '#f8f0ec'] },
    { at: 'top', from: 0.6, to: 0.84, h: 0.13, shape: 'round', rake: 0.45, rays: 10, spots: '#5a1010', clear: true },
    { at: 'bot', from: 0.64, to: 0.82, h: 0.12, shape: 'round', rake: 0.45, rays: 8, spots: '#5a1010', clear: true },
  ],
  pec: { u: 0.28, v: 0.4, len: 0.42, w: 0.12, ang: -32, spread: 46, shape: 'fan', rays: 8, feather: 0.4, col: '#f0d8d0', rayBands: ['#b81818', '#f6ece8'] },
  pel: { u: 0.32, len: 0.18, w: 0.04, ang: -70, spread: 24, col: '#e8c8c0', rays: 4, rayBands: ['#b81818', '#f6ece8'] },
  tail: { type: 'round', len: 0.22, spread: 0.14, rays: 12, spots: '#3a1010' },
  barbels: [{ u: 0.08, v: 0.86, len: 0.04, ang: 70, curl: 0.2, top: false, col: '#f0e0d8' }],
  col: { back: '#c02020', flank: '#f4e8e0', belly: '#fff8f4', fin: '#f0d8d0', vb: 0.72, vbel: 0.25 },
  pat: [{ type: 'bars', at: [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], width: 0.045, color: '#b81818', slant: 0.06, wavy: 0.008 }],
  mat: { iri: 0.05, gloss: 0.85, finGlass: 0.5 },
  wave: 0.35,
};

// ---------------------------------------------------------------- sharks and kin

A.shark = {
  plan: 'fish',
  body: { D: 0.2, up: 0.52, at: 0.36, ped: 0.22, tip: 0.012, fore: 1.7, chin: 1.25, back: 1.0, W: 0.085, pw: 0.03, nose: 0.06, xs: 2, wy: 0.45 },
  eye: { u: 0.1, v: 0.66, r: 0.016, iris: '#283848', pupil: 0.62 },
  mouth: { type: 'inferior', u: 0.2, u0: 0.07, v: 0.2, lift: 0.006, dark: 0.45 },
  op: null, noGill: true, nostril: false, orbit: false,
  slits: { n: 5, u0: 0.2, u1: 0.27, v0: 0.3, v1: 0.72 },
  fins: [
    { at: 'top', from: 0.34, to: 0.48, h: 0.15, shape: 'sickle', rake: 0.7, rays: 1, thick: 0.012 },
    { at: 'top', from: 0.73, to: 0.78, h: 0.04, shape: 'tri', rake: 0.6, rays: 1, thick: 0.006 },
    { at: 'bot', from: 0.53, to: 0.6, h: 0.05, shape: 'tri', rake: 0.7, rays: 1, thick: 0.008 },
    { at: 'bot', from: 0.74, to: 0.79, h: 0.04, shape: 'tri', rake: 0.6, rays: 1, thick: 0.006 },
  ],
  pec: { u: 0.3, v: 0.25, len: 0.2, w: 0.055, ang: -32, spread: 34, shape: 'wing', rays: 1, opaque: true, flap: 0.4 },
  pel: { u: 0.56, len: 0.06, w: 0.025, ang: -45, spread: 20, opaque: true },
  tail: { type: 'hetero', len: 0.3, spread: 0.2, lobe: 0.7, y: 0.01, thick: 0.01, rays: 1 },
  col: { back: '#4a6078', flank: '#8aa0b4', belly: '#f4f6f8', fin: '#4a6078', vb: 0.55, vbel: 0.42, soft: 0.05 },
  mat: { iri: 0.05, gloss: 0.7, sheen: 0.5 },
  wave: 0.5,
};

A.hammerhead = {
  ...A.shark,
  body: { ...A.shark.body, D: 0.19, tip: 0.0, fore: 1.6 },
  ceph: { u0: 0.03, u1: 0.1, w: 0.13, h: 0.022, y: 0.01 },
  eye: { u: 0.035, v: 0.55, r: 0.014, iris: '#d0b060', front: true },
  fins: [
    { at: 'top', from: 0.3, to: 0.43, h: 0.2, shape: 'sickle', rake: 0.6, rays: 1, thick: 0.012 },
    { at: 'top', from: 0.73, to: 0.77, h: 0.045, shape: 'tri', rake: 0.6, rays: 1, thick: 0.006 },
    { at: 'bot', from: 0.54, to: 0.6, h: 0.06, shape: 'tri', rake: 0.7, rays: 1, thick: 0.008 },
    { at: 'bot', from: 0.73, to: 0.78, h: 0.05, shape: 'tri', rake: 0.6, rays: 1, thick: 0.006 },
  ],
  col: { back: '#6a7a82', flank: '#a0acb2', belly: '#f4f4f2', fin: '#6a7a82', vb: 0.55, vbel: 0.42, soft: 0.05 },
};

A.billfish = {
  plan: 'fish',
  body: { D: 0.22, up: 0.54, at: 0.3, ped: 0.1, tip: 0.0, fore: 1.6, chin: 1.5, back: 1.2, W: 0.075, pw: 0.025, nose: 0.02, xs: 1.9, wy: 0.48 },
  bill: { len: 0.32, h: 0.016, w: 0.012, y: 0.004 },
  eye: { u: 0.075, v: 0.55, r: 0.026, iris: '#c0c8d0' },
  mouth: { u: 0.1, v: 0.4, drop: -0.01 },
  op: { u: 0.22, top: 0.8, bot: 0.16, bulge: 0.03 },
  lateral: null,
  fins: [
    { at: 'top', from: 0.18, to: 0.6, h: 0.22, shape: 'sail', rake: 0.4, rays: 24 },
    { at: 'top', from: 0.88, to: 0.92, h: 0.03, shape: 'tri', rake: 0.4, rays: 4 },
    { at: 'bot', from: 0.62, to: 0.72, h: 0.12, shape: 'sickle', rake: 0.6, rays: 8 },
  ],
  pec: { u: 0.24, v: 0.3, len: 0.2, w: 0.035, ang: -25, shape: 'long', rays: 14 },
  pel: { u: 0.28, len: 0.12, w: 0.008, ang: -70, shape: 'long' },
  tail: { type: 'lunate', len: 0.3, spread: 0.3, fork: 0.62, rays: 18, focus: 0.03 },
  col: { back: '#0a2a6a', flank: '#5a8ac8', belly: '#f0f4fa', fin: '#1a3a7a', vb: 0.56, vbel: 0.36, soft: 0.06 },
  pat: [{ type: 'bars', at: [0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78], width: 0.025, color: '#8ac8ff', vmin: 0.35, alpha: 0.7 }],
  mat: { iri: 0.4, gloss: 0.92, finGlass: 0.86 },
  wave: 0.3, stiff: true,
};

// ---------------------------------------------------------------- flatfish & rays

A.flatfish = {
  // flounder / halibut lying on its blind side: an oval body, both eyes bulging on the up side near the front, a
  // continuous fringe of dorsal and anal fin all round, a rounded tail, mottled sandy skin
  plan: 'fish',
  flat: { roll: -46, blind: '#f6f4ef' },
  body: { D: 0.48, up: 0.5, at: 0.42, ped: 0.15, tip: 0.05, fore: 1.7, chin: 1.9, back: 1.1, W: 0.032, nose: 0.06, xs: 1.6, wy: 0.5 },
  eye: { u: 0.115, v: 0.6, r: 0.032, iris: '#a88440', second: [0.045, 0.17], bulge: 0.95, pupil: 0.62 },
  mouth: { u: 0.055, v: 0.5, drop: -0.016, curve: 0.012, dark: 0.4 },
  op: { u: 0.21, top: 0.72, bot: 0.24, bulge: 0.03, dark: 0.07 },
  lateral: { v0: 0.56, v1: 0.5, tone: -0.1 },
  scales: { size: 0.012, k: 0.035 },
  fins: [
    { at: 'top', from: 0.1, to: 0.95, h: 0.085, shape: 'low', rake: 0.3, rays: 46, thick: 0.012 },
    { at: 'bot', from: 0.22, to: 0.95, h: 0.085, shape: 'low', rake: 0.3, rays: 38, thick: 0.012 },
  ],
  pec: { u: 0.23, v: 0.5, len: 0.08, w: 0.03, ang: 0, spread: 8, rays: 8 },
  pel: null,
  tail: { type: 'round', len: 0.15, spread: 0.12, rays: 16, thick: 0.012 },
  col: { back: '#8a7050', flank: '#a08868', belly: '#b09a78', fin: '#9a8262', vb: 0.66, vbel: 0.3 },
  pat: [{ type: 'mottle', color: '#5a4430', scale: 12, thresh: 0.55, amt: 0.6 }],
  mat: { iri: 0.04, gloss: 0.7, finGlass: 0.35 },
  wave: 0.4,
};

// ---------------------------------------------------------------- deep sea

A.lantern = {
  ...A.sardine,
  body: { D: 0.22, up: 0.5, at: 0.36, ped: 0.26, tip: 0.0, fore: 2.2, chin: 1.8, back: 1, W: 0.055, nose: 0.05, xs: 1.9, wy: 0.45 },
  eye: { u: 0.1, v: 0.6, r: 0.055, iris: '#a8c8e8', pupil: 0.62 },
  mouth: { u: 0.16, v: 0.44, drop: -0.02 },
  op: { u: 0.25, top: 0.8, bot: 0.14, bulge: 0.02 },
  fins: [
    { at: 'top', from: 0.4, to: 0.54, h: 0.1, shape: 'tri', rake: 0.4, rays: 10 },
    { at: 'top', from: 0.8, to: 0.86, h: 0.03, adipose: true },
    { at: 'bot', from: 0.56, to: 0.74, h: 0.07, shape: 'tri', rake: 0.4, rays: 10 },
  ],
  col: { back: '#1a2a5a', flank: '#7a90b8', belly: '#c8d0e0', fin: '#5a6a8a', vb: 0.62, vbel: 0.34 },
  pat: [{ type: 'photophores', color: '#8affe0', glow: true, size: 0.012, rows: [{ u0: 0.2, u1: 0.85, n: 14, v: 0.12 }, { u0: 0.3, u1: 0.7, n: 6, v: 0.3, dv: 0.08 }] }],
  mat: { iri: 0.6, gloss: 0.9 },
  glow: true,
};

A.angler = {
  plan: 'fish',
  body: { top: [[0, 0.13], [0.04, 0.24], [0.14, 0.32], [0.34, 0.35], [0.58, 0.28], [0.8, 0.12], [1, 0.045]], bot: [[0, 0.01], [0.03, -0.13], [0.12, -0.25], [0.34, -0.31], [0.6, -0.23], [0.82, -0.1], [1, -0.045]], W: 0.24, pw: 0.04, nose: 0.05, xs: 2.2, wy: 0.45 },
  eye: { u: 0.2, v: 0.8, r: 0.022, iris: '#3a3a50', pupil: 0.6 },
  mouth: { u: 0.3, v: 0.62, drop: -0.18, curve: -0.02, dark: 0.7, teeth: { n: 12, len: 0.07, col: '#e8f0f8', out: 1.02 } },
  op: null, noGill: true, nostril: false,
  fins: [
    { at: 'top', from: 0.7, to: 0.84, h: 0.1, shape: 'round', rake: 0.4, rays: 8 },
    { at: 'bot', from: 0.74, to: 0.86, h: 0.09, shape: 'round', rake: 0.4, rays: 7 },
  ],
  pec: { u: 0.5, v: 0.4, len: 0.1, w: 0.05, ang: 0, spread: 30, shape: 'fan', rays: 10 },
  pel: null,
  tail: { type: 'round', len: 0.2, spread: 0.12, rays: 10 },
  lure: { u: 0.12, len: 0.36, ang: 105, curve: 2.2, bulb: 0.035, col: '#c8fff4', rod: '#3a3040' },
  col: { back: '#1a1420', flank: '#2a2232', belly: '#3a3040', fin: '#2a2030', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'speckle', tone: -0.2, density: 0.08 }],
  mat: { iri: 0.08, gloss: 0.7, sheen: 0.4 },
  wave: 0.3, stiff: true,
  glow: true,
};

// ---------------------------------------------------------------- more teleosts

const fin = (at, from, to, h, shape = 'tri', rake = 0.4, rays = 10, o = {}) => ({ at, from, to, h, shape, rake, rays, ...o });

A.arowana = {
  plan: 'fish',
  body: { D: 0.25, up: 0.42, at: 0.5, atB: 0.4, ped: 0.34, tip: 0.05, fore: 1.15, chin: 1.9, back: 1, W: 0.055, nose: 0.02, xs: 1.8, wy: 0.45 },
  eye: { u: 0.095, v: 0.68, r: 0.026, iris: '#e8c870' },
  mouth: { u: 0.14, v: 0.82, drop: -0.07, curve: -0.004 },
  op: { u: 0.24, top: 0.86, bot: 0.12, bulge: 0.025, cover: '#f0e0b0', coverAmt: 0.3 },
  lateral: { v0: 0.4, v1: 0.45, tone: -0.1 },
  scales: { size: 0.055, k: 0.12 },
  fins: [fin('top', 0.68, 0.88, 0.09, 'long', 0.3, 14), fin('bot', 0.55, 0.88, 0.11, 'rise', 0.3, 18)],
  pec: { u: 0.24, v: 0.14, len: 0.19, w: 0.04, ang: -15, shape: 'long', rays: 12 },
  pel: { u: 0.48, len: 0.07, w: 0.02, ang: -45 },
  tail: { type: 'round', len: 0.2, spread: 0.13, rays: 14 },
  barbels: [{ u: 0.01, v: 0.05, len: 0.07, ang: 30, curl: -0.2, fwd: true, out: 0.1 }],
  col: { back: '#2a3a6a', flank: '#b8c4e0', belly: '#eef0f6', fin: '#4a5a8a', vb: 0.72, vbel: 0.3 },
  pat: [{ type: 'scalenet', color: '#e8c060', size: 0.055, inner: 0.44, umin: 0.25, alpha: 0.7 }],
  mat: { iri: 0.5, gloss: 0.9 },
  wave: 0.5,
};

A.catfish = {
  plan: 'fish',
  body: { D: 0.22, up: 0.5, at: 0.3, ped: 0.3, tip: 0.0, fore: 1.5, chin: 1.2, back: 0.9, W: 0.12, atW: 0.16, wTip: 0.08, pw: 0.03, nose: 0.06, xs: 2.4, wy: 0.4 },
  eye: { u: 0.085, v: 0.62, r: 0.014, iris: '#c8b060' },
  mouth: { u: 0.08, v: 0.36, drop: -0.006, curve: 0.004, lips: '#e8d8c8' },
  op: { u: 0.2, top: 0.8, bot: 0.12, bulge: 0.02, dark: 0.18 },
  lateral: { v0: 0.6, v1: 0.5, tone: -0.1 },
  scales: null, nostril: false,
  fins: [fin('top', 0.26, 0.37, 0.16, 'tri', 0.35, 7), fin('top', 0.62, 0.84, 0.045, 'long', 0.2, 1, { adipose: true }), fin('bot', 0.64, 0.84, 0.085, 'round', 0.35, 12)],
  pec: { u: 0.19, v: 0.18, len: 0.15, w: 0.05, ang: -18, rays: 9, spines: true },
  pel: { u: 0.5, len: 0.08, w: 0.03, ang: -45 },
  tail: { type: 'emarginate', len: 0.2, spread: 0.15, fork: 0.25, rays: 16 },
  barbels: [
    { u: 0.03, v: 0.62, len: 0.42, ang: -8, curl: 0.9, out: 0.6, col: '#3a3632' },
    { u: 0.02, v: 0.05, len: 0.14, ang: -85, curl: 0.4, out: 0.2, col: '#d8d0c0' },
    { u: 0.04, v: 0.02, len: 0.11, ang: -95, curl: 0.3, out: 0.3, col: '#d8d0c0' },
  ],
  col: { back: '#2a2e34', flank: '#4a4e56', belly: '#f6f4ee', fin: '#3a3e44', vb: 0.6, vbel: 0.42, soft: 0.04 },
  mat: { iri: 0.04, gloss: 0.9 },
  wave: 0.55,
};

A.betta = {
  plan: 'fish',
  body: { D: 0.27, up: 0.5, at: 0.38, ped: 0.4, tip: 0.02, fore: 1.6, chin: 1.8, back: 0.8, W: 0.06, nose: 0.03, xs: 1.9, wy: 0.45 },
  eye: { u: 0.1, v: 0.6, r: 0.04, iris: '#4a3a40' },
  mouth: { u: 0.06, v: 0.7, drop: -0.02 },
  op: { u: 0.25, top: 0.8, bot: 0.15, bulge: 0.03, dark: 0.2 },
  scales: { size: 0.03, k: 0.1 },
  fins: [fin('top', 0.52, 0.8, 0.38, 'trail', 1.0, 12), fin('bot', 0.34, 0.92, 0.42, 'trail', 1.1, 22)],
  pec: { u: 0.26, v: 0.42, len: 0.12, w: 0.05, ang: -10, rays: 10 },
  pel: { u: 0.3, len: 0.36, w: 0.025, ang: -75, spread: 18, shape: 'long', flap: 0.3 },
  tail: { type: 'fan', len: 0.62, spread: 0.46, rays: 20, focus: 0.04 },
  col: { back: '#2a0a5a', flank: '#3a2aa8', belly: '#4a3ab0', fin: '#c01840', vb: 0.6, vbel: 0.3 },
  mat: { iri: 0.6, gloss: 0.9, finGlass: 0.62 },
  wave: 0.45,
};

A.gourami = {
  ...A.perch,
  body: { D: 0.44, up: 0.5, at: 0.4, ped: 0.24, tip: 0.02, fore: 1.6, chin: 1.8, back: 0.9, W: 0.055, nose: 0.03, xs: 1.7, wy: 0.48 },
  eye: { u: 0.11, v: 0.62, r: 0.035, iris: '#e05030' },
  mouth: { u: 0.05, v: 0.68, drop: -0.012 },
  fins: [fin('top', 0.58, 0.8, 0.12, 'round', 0.6, 9), fin('bot', 0.32, 0.92, 0.17, 'rise', 0.55, 30)],
  pec: { u: 0.27, v: 0.45, len: 0.12, w: 0.04, ang: -8, rays: 10 },
  pel: { u: 0.3, len: 0.65, w: 0.008, ang: -40, spread: 14, shape: 'long', flap: 0.5 },
  tail: { type: 'emarginate', len: 0.24, spread: 0.18, fork: 0.12, rays: 16 },
  scales: { size: 0.025, k: 0.06 },
  mat: { iri: 0.35, gloss: 0.88 },
};

A.tetra = {
  ...A.salmon,
  body: { D: 0.27, up: 0.52, at: 0.38, ped: 0.3, tip: 0.0, fore: 1.7, chin: 1.8, back: 0.9, W: 0.06, nose: 0.04, xs: 1.9, wy: 0.45 },
  eye: { u: 0.1, v: 0.6, r: 0.05, iris: '#c8c8b8' },
  mouth: { u: 0.06, v: 0.55, drop: -0.006 },
  fins: [fin('top', 0.44, 0.56, 0.13, 'tri', 0.45, 9), fin('top', 0.8, 0.85, 0.04, 'tri', 0.3, 1, { adipose: true }), fin('bot', 0.58, 0.82, 0.08, 'fall', 0.35, 14)],
  pec: { u: 0.25, v: 0.3, len: 0.1, w: 0.03, ang: -12, rays: 9 },
  pel: { u: 0.45, len: 0.08, w: 0.02, ang: -50 },
  tail: { type: 'fork', len: 0.24, spread: 0.18, fork: 0.5, rays: 16 },
  scales: { size: 0.035, k: 0.05 },
  mat: { iri: 0.55, gloss: 0.9 },
};

A.goby = {
  plan: 'fish',
  body: { D: 0.18, up: 0.5, at: 0.3, ped: 0.48, tip: 0.0, fore: 2.0, chin: 1.6, back: 0.7, W: 0.075, nose: 0.05, xs: 2.2, wy: 0.42 },
  eye: { u: 0.1, v: 0.84, r: 0.032, iris: '#e0b040' },
  mouth: { u: 0.08, v: 0.38, drop: -0.008, curve: 0.006 },
  op: { u: 0.22, top: 0.8, bot: 0.15, bulge: 0.02, dark: 0.16 },
  scales: { size: 0.03, k: 0.06 },
  fins: [fin('top', 0.32, 0.46, 0.13, 'round', 0.35, 6, { spiny: true, notch: 0.2 }), fin('top', 0.5, 0.82, 0.11, 'long', 0.35, 12), fin('bot', 0.55, 0.82, 0.09, 'long', 0.35, 10)],
  pec: { u: 0.22, v: 0.4, len: 0.15, w: 0.06, ang: -12, shape: 'fan', rays: 14 },
  pel: { u: 0.26, len: 0.1, w: 0.05, ang: -60, spread: 8 },
  tail: { type: 'round', len: 0.22, spread: 0.13, rays: 14 },
  col: { back: '#6a5a3a', flank: '#a89878', belly: '#e8e0d0', fin: '#a89878', vb: 0.66, vbel: 0.3 },
  mat: { iri: 0.1, gloss: 0.85 },
  wave: 0.6,
};

A.sculpin = {
  plan: 'fish',
  body: { D: 0.26, up: 0.52, at: 0.2, ped: 0.32, tip: -0.02, fore: 1.6, chin: 2.0, back: 0.65, W: 0.14, atW: 0.14, wTip: 0.07, pw: 0.025, nose: 0.06, xs: 2.4, wy: 0.4 },
  eye: { u: 0.11, v: 0.86, r: 0.032, iris: '#e0b048', top: false },
  mouth: { u: 0.13, v: 0.4, drop: -0.02, curve: 0.012 },
  op: { u: 0.26, top: 0.82, bot: 0.14, bulge: 0.03, dark: 0.2 },
  scales: null,
  fins: [fin('top', 0.26, 0.44, 0.13, 'round', 0.3, 8, { spiny: true, notch: 0.35 }), fin('top', 0.46, 0.82, 0.12, 'long', 0.35, 14), fin('bot', 0.52, 0.82, 0.09, 'long', 0.35, 12)],
  pec: { u: 0.25, v: 0.38, len: 0.22, w: 0.1, ang: -12, spread: 55, shape: 'fan', rays: 16 },
  pel: { u: 0.28, len: 0.08, w: 0.02, ang: -60 },
  tail: { type: 'round', len: 0.2, spread: 0.13, rays: 12 },
  col: { back: '#4a5a6a', flank: '#8a98a8', belly: '#e8eaee', fin: '#7a8898', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'mottle', color: '#2a3440', scale: 11, thresh: 0.54, amt: 0.8 }, { type: 'saddles', color: '#2a3440', at: [0.32, 0.55, 0.78], width: 0.07, from: 0.5 }],
  mat: { iri: 0.05, gloss: 0.8 },
  wave: 0.55,
};

A.wolffish = {
  plan: 'fish',
  body: { D: 0.21, up: 0.52, at: 0.24, ped: 0.24, tip: -0.02, fore: 2.2, chin: 2.0, back: 0.75, W: 0.08, nose: 0.07, xs: 2.1, wy: 0.45 },
  eye: { u: 0.1, v: 0.78, r: 0.022, iris: '#a8b050' },
  mouth: { u: 0.1, v: 0.38, drop: -0.012, curve: 0.012, lips: '#c8c0b8', teeth: { n: 4, len: 0.022, col: '#f4f0e0' } },
  op: { u: 0.22, top: 0.8, bot: 0.16, bulge: 0.02, dark: 0.15 },
  scales: null,
  fins: [fin('top', 0.24, 0.96, 0.08, 'low', 0.3, 40, { spiny: true, notch: 0.1 }), fin('bot', 0.5, 0.96, 0.07, 'low', 0.3, 26)],
  pec: { u: 0.24, v: 0.3, len: 0.16, w: 0.08, ang: -10, shape: 'fan', rays: 18 },
  pel: null,
  tail: { type: 'round', len: 0.1, spread: 0.08, rays: 12 },
  col: { back: '#4a5a72', flank: '#7a8aa0', belly: '#c8ccd4', fin: '#5a6a80', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'bars', at: [0.32, 0.42, 0.52, 0.62, 0.72, 0.82], width: 0.035, color: '#2a3446', vmin: 0.35, wavy: 0.01 }],
  mat: { iri: 0.04, gloss: 0.82 },
  wave: 0.7,
};

A.monkfish = {
  plan: 'fish',
  body: { top: [[0, 0.04], [0.08, 0.1], [0.2, 0.12], [0.35, 0.1], [0.55, 0.06], [0.8, 0.04], [1, 0.035]], bot: [[0, -0.02], [0.06, -0.08], [0.2, -0.1], [0.4, -0.07], [0.6, -0.045], [1, -0.03]], wid: [[0, 0.2], [0.12, 0.26], [0.3, 0.2], [0.55, 0.08], [1, 0.03]], nose: 0.05, xs: 3, wy: 0.35 },
  eye: { u: 0.17, v: 0.92, r: 0.018, iris: '#c8a050', top: true },
  mouth: { u: 0.2, v: 0.62, drop: -0.04, curve: -0.01, dark: 0.7, teeth: { n: 10, len: 0.035, col: '#f0ece0' } },
  op: null, noGill: true, nostril: false,
  fins: [fin('top', 0.5, 0.58, 0.07, 'tri', 0.3, 3, { spiny: true, notch: 0.8 }), fin('top', 0.66, 0.82, 0.07, 'round', 0.35, 10), fin('bot', 0.7, 0.84, 0.06, 'round', 0.35, 9)],
  pec: { u: 0.36, v: 0.2, len: 0.14, w: 0.07, ang: -20, spread: 40, shape: 'fan', rays: 14 },
  pel: { u: 0.25, len: 0.06, w: 0.03, ang: -70 },
  tail: { type: 'truncate', len: 0.14, spread: 0.1, rays: 10 },
  lure: { u: 0.03, len: 0.16, ang: 80, curve: 1.2, bulb: 0.018, col: '#e8d8b8', rod: '#6a5038' },
  barbels: [{ u: 0.05, v: 0.1, len: 0.04, ang: -100, curl: 0.4 }, { u: 0.12, v: 0.05, len: 0.05, ang: -90, curl: 0.4 }, { u: 0.2, v: 0.05, len: 0.04, ang: -90, curl: 0.3 }],
  col: { back: '#6a5038', flank: '#8a6a48', belly: '#e8dccc', fin: '#6a5038', vb: 0.5, vbel: 0.25 },
  pat: [{ type: 'mottle', color: '#3a2a1a', scale: 14, thresh: 0.5, amt: 0.8 }],
  mat: { iri: 0.03, gloss: 0.75 },
  wave: 0.35,
};

A.platax = {
  plan: 'fish',
  body: { D: 0.66, up: 0.52, at: 0.36, ped: 0.18, tip: 0.0, fore: 1.6, chin: 1.6, back: 1.0, W: 0.05, nose: 0.05, xs: 1.6, wy: 0.5 },
  eye: { u: 0.13, v: 0.62, r: 0.04, iris: '#3a3020' },
  mouth: { u: 0.05, v: 0.5, drop: -0.004 },
  op: { u: 0.26, top: 0.76, bot: 0.22, bulge: 0.03, dark: 0.1 },
  scales: { size: 0.02, k: 0.04 },
  fins: [fin('top', 0.32, 0.86, 0.72, 'rise', 0.9, 20), fin('bot', 0.38, 0.86, 0.7, 'rise', 0.9, 18)],
  pec: { u: 0.3, v: 0.48, len: 0.12, w: 0.04, ang: -8, rays: 10 },
  pel: { u: 0.32, len: 0.4, w: 0.04, ang: -80, spread: 12, shape: 'long' },
  tail: { type: 'fan', len: 0.26, spread: 0.18, rays: 14 },
  col: { back: '#141418', flank: '#1e1e26', belly: '#2a2a34', fin: '#1a1a22', vb: 0.6, vbel: 0.3 },
  mat: { iri: 0.1, gloss: 0.88, finGlass: 0.82 },
  wave: 0.3,
};

A.blobfish = {
  plan: 'fish',
  body: { top: [[0, 0.02], [0.05, 0.12], [0.18, 0.2], [0.32, 0.2], [0.5, 0.13], [0.75, 0.06], [1, 0.04]], bot: [[0, -0.12], [0.06, -0.2], [0.2, -0.24], [0.38, -0.2], [0.6, -0.11], [0.85, -0.05], [1, -0.04]], wid: [[0, 0.1], [0.15, 0.2], [0.35, 0.19], [0.65, 0.08], [1, 0.03]], nose: 0.1, xs: 2, wy: 0.4 },
  eye: { u: 0.13, v: 0.68, r: 0.028, iris: '#4a4040', pupil: 0.7 },
  mouth: { u: 0.17, v: 0.22, drop: -0.05, curve: -0.035, dark: 0.45, lips: '#e8a8a8' },
  op: null, noGill: true, nostril: false, orbit: false,
  fins: [fin('top', 0.5, 0.66, 0.05, 'round', 0.3, 6)],
  pec: { u: 0.34, v: 0.4, len: 0.12, w: 0.07, ang: -20, spread: 30, shape: 'fan', rays: 8 },
  pel: null,
  tail: { type: 'round', len: 0.12, spread: 0.08, rays: 8 },
  col: { back: '#e090a0', flank: '#f0a8b0', belly: '#f8c8c8', fin: '#e8a0a8', vb: 0.6, vbel: 0.3, soft: 0.2 },
  pat: [{ type: 'mottle', tone: 0.08, scale: 9, thresh: 0.5, amt: 1 }, { type: 'mottle', tone: -0.08, scale: 13, thresh: 0.6, amt: 1, seed: 3 }],
  mat: { iri: 0.05, gloss: 0.95, sheen: 0.9 },
  wave: 0.25, grain: 0.06,
};

A.lumpsucker = {
  plan: 'fish',
  body: { D: 0.72, up: 0.52, at: 0.42, ped: 0.16, tip: -0.04, fore: 2.8, chin: 2.6, back: 0.8, W: 0.3, pw: 0.05, nose: 0.12, xs: 2, wy: 0.45 },
  eye: { u: 0.16, v: 0.66, r: 0.06, iris: '#d8c048', pupil: 0.58 },
  mouth: { u: 0.05, v: 0.38, drop: 0, lips: '#a8c890' },
  op: null, noGill: true,
  fins: [fin('top', 0.62, 0.8, 0.09, 'round', 0.4, 8), fin('bot', 0.68, 0.84, 0.08, 'round', 0.4, 7)],
  pec: { u: 0.36, v: 0.4, len: 0.14, w: 0.07, ang: 0, spread: 45, shape: 'fan', rays: 12 },
  pel: null,
  tail: { type: 'round', len: 0.2, spread: 0.12, rays: 10 },
  col: { back: '#4a8a2a', flank: '#7ab83a', belly: '#c8e088', fin: '#8ac050', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'spots', tone: 0.28, size: 0.025, density: 0.75, seed: 12 }, { type: 'spots', tone: -0.2, size: 0.012, density: 0.5, seed: 19 }],
  spines: { len: 0.03, gap: 0.08, col: '#a8d070', always: 1 },
  mat: { iri: 0.05, gloss: 0.92 },
  wave: 0.2, stiff: true,
};

A.stargazer = {
  plan: 'fish',
  body: { D: 0.28, up: 0.55, at: 0.2, ped: 0.32, tip: 0.04, fore: 1.3, chin: 2.2, back: 0.7, W: 0.13, atW: 0.14, wTip: 0.09, pw: 0.03, nose: 0.05, xs: 3, wy: 0.35 },
  eye: { u: 0.1, v: 0.95, r: 0.024, iris: '#c8a860', top: true },
  mouth: { u: 0.08, v: 0.88, drop: -0.1, curve: -0.01, dark: 0.6, lips: '#e8d8c0', teeth: { n: 6, len: 0.015 } },
  op: { u: 0.25, top: 0.86, bot: 0.14, bulge: 0.03, dark: 0.2 },
  scales: null,
  fins: [fin('top', 0.32, 0.42, 0.08, 'tri', 0.3, 4, { spiny: true }), fin('top', 0.44, 0.84, 0.09, 'long', 0.35, 14), fin('bot', 0.46, 0.84, 0.08, 'long', 0.35, 14)],
  pec: { u: 0.26, v: 0.3, len: 0.18, w: 0.08, ang: -15, spread: 50, shape: 'fan', rays: 16 },
  pel: { u: 0.18, len: 0.07, w: 0.03, ang: -70 },
  tail: { type: 'truncate', len: 0.16, spread: 0.11, rays: 12 },
  col: { back: '#6a5a44', flank: '#8a7a5e', belly: '#ece6d8', fin: '#5a4a38', vb: 0.55, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#f4f0e4', size: 0.012, density: 0.85, vmin: 0.45, seed: 22 }],
  mat: { iri: 0.04, gloss: 0.78 },
  wave: 0.4,
};

A.trumpet = {
  plan: 'fish',
  body: { top: [[0, 0.008], [0.12, 0.013], [0.2, 0.03], [0.32, 0.042], [0.6, 0.042], [0.85, 0.03], [1, 0.02]], bot: [[0, -0.008], [0.12, -0.013], [0.2, -0.026], [0.32, -0.038], [0.6, -0.04], [0.85, -0.026], [1, -0.02]], wid: [[0, 0.008], [0.2, 0.024], [0.4, 0.034], [0.8, 0.026], [1, 0.012]], nose: 0.006, xs: 2, wy: 0.5 },
  eye: { u: 0.2, v: 0.68, r: 0.012, iris: '#b8a050' },
  mouth: { u: 0.02, v: 0.5, drop: 0 },
  op: { u: 0.26, top: 0.84, bot: 0.15, bulge: 0.005, dark: 0.15 },
  scales: { size: 0.008, k: 0.03 },
  fins: [fin('top', 0.38, 0.62, 0.012, 'low', 0.2, 10, { spiny: true, notch: 0.6 }), fin('top', 0.76, 0.86, 0.04, 'round', 0.4, 9), fin('bot', 0.77, 0.87, 0.04, 'round', 0.4, 9)],
  pec: { u: 0.28, v: 0.4, len: 0.035, w: 0.012, ang: -10, rays: 6 },
  pel: { u: 0.62, len: 0.03, w: 0.008, ang: -40 },
  tail: { type: 'round', len: 0.06, spread: 0.035, rays: 10 },
  barbels: [{ u: 0.03, v: 0.0, len: 0.02, ang: -90, curl: 0.1, out: 0 }],
  col: { back: '#e8b800', flank: '#ffd820', belly: '#fff0a0', fin: '#f8d840', vb: 0.65, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#2a2418', size: 0.006, density: 0.25, umin: 0.85, seed: 3 }],
  mat: { iri: 0.08, gloss: 0.9 },
  wave: 0.4,
};

A.needle = {
  plan: 'fish',
  body: { top: [[0, 0.01], [0.1, 0.03], [0.4, 0.045], [0.7, 0.04], [1, 0.022]], bot: [[0, -0.008], [0.1, -0.025], [0.4, -0.04], [0.7, -0.036], [1, -0.022]], wid: [[0, 0.01], [0.2, 0.03], [0.5, 0.034], [1, 0.012]], nose: 0.01, xs: 2, wy: 0.48 },
  bill: { len: 0.24, h: 0.012, w: 0.009, y: 0 },
  eye: { u: 0.08, v: 0.6, r: 0.022, iris: '#c0c8d0' },
  mouth: { u: 0.06, v: 0.48, drop: 0, dark: 0.3 },
  op: { u: 0.16, top: 0.8, bot: 0.15, bulge: 0.01 },
  scales: { size: 0.01, k: 0.03 },
  fins: [fin('top', 0.78, 0.9, 0.06, 'fall', 0.4, 12), fin('bot', 0.74, 0.9, 0.06, 'fall', 0.4, 12)],
  pec: { u: 0.18, v: 0.6, len: 0.06, w: 0.02, ang: -10, rays: 8 },
  pel: { u: 0.62, len: 0.04, w: 0.015, ang: -40 },
  tail: { type: 'fork', len: 0.12, spread: 0.07, fork: 0.4, lobe: -0.2, rays: 14 },
  col: { back: '#1a6a7a', flank: '#a8c8d4', belly: '#f2f8fa', fin: '#4a8a9a', bill: '#2a5a6a', vb: 0.62, vbel: 0.4, soft: 0.05 },
  pat: [{ type: 'band', at: 0.62, width: 0.08, color: '#3ab0e0', alpha: 0.8, hard: true }],
  mat: { iri: 0.45, gloss: 0.92 },
  wave: 0.45,
};

A.opah = {
  plan: 'fish',
  body: { D: 0.62, up: 0.54, at: 0.42, atB: 0.44, ped: 0.12, tip: 0.0, fore: 1.6, chin: 1.8, back: 1.15, W: 0.12, pw: 0.03, nose: 0.06, xs: 1.9, wy: 0.48 },
  eye: { u: 0.13, v: 0.62, r: 0.035, iris: '#f0c848' },
  mouth: { u: 0.06, v: 0.48, drop: -0.008, lips: '#e83a3a' },
  op: { u: 0.25, top: 0.78, bot: 0.2, bulge: 0.03, dark: 0.15 },
  scales: { size: 0.01, k: 0.02 },
  fins: [fin('top', 0.3, 0.88, 0.32, 'sickle', 0.9, 24, { col: '#e8282a' }), fin('bot', 0.6, 0.88, 0.08, 'low', 0.5, 14, { col: '#e8282a' })],
  pec: { u: 0.3, v: 0.5, len: 0.26, w: 0.05, ang: 10, spread: 22, shape: 'long', rays: 14, col: '#e8282a' },
  pel: { u: 0.4, len: 0.2, w: 0.04, ang: -55, spread: 20, shape: 'long', col: '#e8282a' },
  tail: { type: 'lunate', len: 0.2, spread: 0.22, fork: 0.5, rays: 16, col: '#e8282a' },
  col: { back: '#3a5a9a', flank: '#9ab0d8', belly: '#e8b8c8', fin: '#e8282a', vb: 0.58, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#f8fafc', size: 0.016, density: 0.8, seed: 31 }],
  mat: { iri: 0.55, gloss: 0.94 },
  wave: 0.25, stiff: true,
};

A.pineapple = {
  plan: 'fish',
  body: { D: 0.5, up: 0.52, at: 0.36, ped: 0.22, tip: -0.04, fore: 2.4, chin: 2.3, back: 0.85, W: 0.14, nose: 0.08, xs: 2.6, wy: 0.45 },
  eye: { u: 0.13, v: 0.66, r: 0.05, iris: '#e8d8a0', pupil: 0.55 },
  mouth: { u: 0.1, v: 0.32, drop: -0.02, curve: 0.01, lips: '#ff6a3a' },
  op: { u: 0.27, top: 0.82, bot: 0.12, bulge: 0.03, dark: 0.35 },
  fins: [fin('top', 0.32, 0.58, 0.16, 'spiny', 0.35, 6, { spiny: true, notch: 0.9, col: '#f8e8a0' }), fin('top', 0.64, 0.8, 0.09, 'round', 0.4, 10), fin('bot', 0.66, 0.8, 0.08, 'round', 0.4, 9)],
  pec: { u: 0.3, v: 0.4, len: 0.12, w: 0.05, ang: -10, rays: 12 },
  pel: { u: 0.36, len: 0.12, w: 0.03, ang: -65, spines: true },
  tail: { type: 'emarginate', len: 0.2, spread: 0.15, fork: 0.12, rays: 14 },
  col: { back: '#f0b818', flank: '#ffd838', belly: '#fff0a0', fin: '#f8d860', vb: 0.66, vbel: 0.3 },
  pat: [
    { type: 'scalenet', color: '#2a1a08', size: 0.075, inner: 0.4, umin: 0.25 },
    { type: 'blotch', u: 0.06, v: 0.2, rx: 0.025, ry: 0.06, color: '#ff4a2a', glow: true },
  ],
  mat: { iri: 0.08, gloss: 0.95 },
  wave: 0.25, stiff: true, glow: true,
};

A.mola = {
  // ocean sunfish: a tall, short, laterally flat disc that ends in the clavus (a rounded, scalloped rudder in place
  // of a tail), very tall swept-back dorsal and anal fins (fleshy, body coloured), a small pectoral, a tiny mouth
  plan: 'fish',
  body: { top: [[0, 0.03], [0.06, 0.14], [0.18, 0.26], [0.36, 0.33], [0.58, 0.33], [0.8, 0.28], [0.94, 0.24], [1, 0.22]], bot: [[0, -0.05], [0.07, -0.17], [0.2, -0.28], [0.4, -0.33], [0.62, -0.32], [0.82, -0.27], [0.94, -0.23], [1, -0.21]], wid: [[0, 0.03], [0.15, 0.085], [0.45, 0.095], [0.8, 0.06], [1, 0.03]], nose: 0.07, xs: 1.7, wy: 0.5 },
  eye: { u: 0.13, v: 0.6, r: 0.026, iris: '#4a4a52' },
  mouth: { u: 0.02, v: 0.46, drop: 0, lips: '#e4e8ec', dark: 0.5 },
  op: null, noGill: true, lateral: null, scales: null,
  fins: [
    fin('top', 0.6, 0.84, 0.56, [[0, 0.45], [0.2, 0.9], [0.42, 1], [0.7, 0.62], [1, 0.12]], 0.6, 1, { thick: 0.028 }),
    fin('bot', 0.62, 0.86, 0.52, [[0, 0.45], [0.2, 0.9], [0.42, 1], [0.7, 0.62], [1, 0.12]], 0.6, 1, { thick: 0.028 }),
  ],
  pec: { u: 0.3, v: 0.52, len: 0.09, w: 0.035, ang: 5, spread: 15, rays: 8, opaque: true, flap: 0.6 },
  pel: null,
  tail: { type: 'clavus', len: 0.085, spread: 0.27, rays: 1, focus: 0.04, thick: 0.028, lobes: 9 },
  col: { back: '#5e6c7c', flank: '#aab6c2', belly: '#e6ecf0', fin: '#66748a', vb: 0.7, vbel: 0.3, soft: 0.08 },
  pat: [{ type: 'mottle', color: '#dfe6ec', scale: 7, thresh: 0.56, amt: 0.5 }, { type: 'speckle', tone: -0.12, density: 0.05 }],
  mat: { iri: 0.12, gloss: 0.75 },
  wave: 0.08, stiff: true,
};

A.hatchet = {
  plan: 'fish',
  body: { top: [[0, 0.05], [0.15, 0.1], [0.45, 0.11], [0.75, 0.07], [1, 0.03]], bot: [[0, 0.0], [0.08, -0.25], [0.25, -0.4], [0.45, -0.36], [0.7, -0.14], [0.85, -0.04], [1, -0.02]], wid: [[0, 0.02], [0.2, 0.05], [0.5, 0.045], [1, 0.012]], nose: 0.03, xs: 1.4, wy: 0.6 },
  eye: { u: 0.13, v: 0.8, r: 0.07, iris: '#b8d0e8', pupil: 0.62 },
  mouth: { u: 0.06, v: 0.95, drop: -0.08, dark: 0.5 },
  op: { u: 0.25, top: 0.86, bot: 0.3, bulge: 0.03, dark: 0.12 },
  fins: [fin('top', 0.5, 0.62, 0.12, 'tri', 0.4, 8), fin('bot', 0.62, 0.78, 0.08, 'low', 0.4, 10)],
  pec: { u: 0.3, v: 0.5, len: 0.12, w: 0.03, ang: -5, rays: 9 },
  pel: null,
  tail: { type: 'fork', len: 0.22, spread: 0.16, fork: 0.4, rays: 14 },
  col: { back: '#3a4a7a', flank: '#d8e4f4', belly: '#f4f8fc', fin: '#a8b8d8', vb: 0.82, vbel: 0.35 },
  pat: [{ type: 'photophores', color: '#7affd8', glow: true, size: 0.016, rows: [{ u0: 0.1, u1: 0.62, n: 10, v: 0.06 }] }],
  mat: { iri: 0.5, gloss: 0.95, chrome: 0.45 },
  wave: 0.4, glow: true,
};

A.dragonfish = {
  plan: 'fish',
  body: { D: 0.1, up: 0.5, at: 0.28, ped: 0.5, tip: 0.0, fore: 1.6, chin: 1.4, back: 0.7, W: 0.04, nose: 0.02, xs: 2, wy: 0.45 },
  eye: { u: 0.06, v: 0.64, r: 0.014, iris: '#3a4a6a' },
  mouth: { u: 0.1, v: 0.5, drop: -0.012, dark: 0.7, teeth: { n: 8, len: 0.025, col: '#e8f4ff' } },
  op: { u: 0.14, top: 0.8, bot: 0.2, bulge: 0.01, dark: 0.1 },
  scales: null,
  fins: [fin('top', 0.84, 0.92, 0.05, 'tri', 0.4, 8), fin('bot', 0.82, 0.92, 0.05, 'tri', 0.4, 8)],
  pec: { u: 0.15, v: 0.3, len: 0.05, w: 0.012, ang: -15, rays: 6 },
  pel: { u: 0.6, len: 0.05, w: 0.012, ang: -50 },
  tail: { type: 'fork', len: 0.09, spread: 0.06, fork: 0.3, rays: 12 },
  barbels: [{ u: 0.04, v: 0.0, len: 0.18, ang: -100, curl: -1.2, out: 0, mid: true, col: '#1a1a24', tip: '#7affff', glowTip: true, bulb: 0.01 }],
  col: { back: '#0e0e16', flank: '#16161e', belly: '#1e1e28', fin: '#14141c', vb: 0.6, vbel: 0.3 },
  pat: [
    { type: 'photophores', color: '#5ac8ff', glow: true, size: 0.006, rows: [{ u0: 0.12, u1: 0.95, n: 30, v: 0.18 }, { u0: 0.12, u1: 0.8, n: 22, v: 0.42 }] },
    { type: 'blotch', u: 0.09, v: 0.45, rx: 0.012, ry: 0.12, color: '#ff7ad8', glow: true },
  ],
  mat: { iri: 0.25, gloss: 0.85 },
  wave: 0.75, glow: true,
};

A.gulper = {
  plan: 'fish',
  body: { top: [[0, 0.04], [0.1, 0.06], [0.28, 0.07], [0.45, 0.05], [0.7, 0.03], [1, 0.014]], bot: [[0, -0.1], [0.12, -0.16], [0.26, -0.15], [0.38, -0.07], [0.6, -0.03], [1, -0.014]], wid: [[0, 0.05], [0.2, 0.07], [0.4, 0.04], [1, 0.01]], nose: 0.02, xs: 1.8, wy: 0.5 },
  eye: { u: 0.025, v: 0.86, r: 0.008, iris: '#3a3a50' },
  mouth: { u: 0.36, v: 0.72, drop: 0.02, curve: -0.02, dark: 0.7 },
  op: null, noGill: true, nostril: false,
  fins: [fin('top', 0.4, 0.98, 0.012, 'low', 0.2, 30), fin('bot', 0.5, 0.98, 0.01, 'low', 0.2, 30)],
  pec: null, pel: null,
  tail: { type: 'whip', len: 0.5, taper: 1.2, col: '#1a1428', tip: '#ff6ab0', glowTip: true },
  col: { back: '#140e20', flank: '#1e1630', belly: '#2a2040', fin: '#1a1428', vb: 0.6, vbel: 0.3 },
  mat: { iri: 0.15, gloss: 0.88 },
  wave: 0.85, glow: true,
};

A.fangtooth = {
  plan: 'fish',
  body: { D: 0.45, up: 0.52, at: 0.26, ped: 0.2, tip: -0.02, fore: 1.6, chin: 1.4, back: 0.9, W: 0.13, nose: 0.06, xs: 2, wy: 0.45 },
  eye: { u: 0.13, v: 0.76, r: 0.022, iris: '#4a4a5a' },
  mouth: { u: 0.2, v: 0.4, drop: -0.04, curve: 0.02, dark: 0.75, teeth: { n: 6, len: 0.08, col: '#f0f4ff' } },
  op: { u: 0.32, top: 0.84, bot: 0.12, bulge: 0.03, dark: 0.3 },
  scales: { size: 0.03, k: 0.06 },
  fins: [fin('top', 0.4, 0.66, 0.08, 'low', 0.35, 14), fin('bot', 0.64, 0.8, 0.07, 'round', 0.4, 9)],
  pec: { u: 0.36, v: 0.4, len: 0.12, w: 0.04, ang: -10, rays: 10 },
  pel: { u: 0.42, len: 0.06, w: 0.02, ang: -55 },
  tail: { type: 'fork', len: 0.2, spread: 0.14, fork: 0.35, rays: 14 },
  col: { back: '#2a1e1e', flank: '#3a2a2a', belly: '#4a3636', fin: '#2e2222', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'mottle', tone: 0.06, scale: 18, thresh: 0.55, amt: 1 }],
  mat: { iri: 0.12, gloss: 0.82 },
  wave: 0.4,
};

A.barreleye = {
  plan: 'fish',
  body: { top: [[0, 0.03], [0.08, 0.13], [0.2, 0.16], [0.32, 0.12], [0.55, 0.08], [0.8, 0.055], [1, 0.04]], bot: [[0, -0.02], [0.1, -0.08], [0.3, -0.1], [0.55, -0.09], [0.8, -0.06], [1, -0.04]], wid: [[0, 0.03], [0.15, 0.07], [0.4, 0.06], [1, 0.02]], nose: 0.04, xs: 2, wy: 0.4 },
  eye: { u: 0.13, v: 0.66, r: 0.028, tube: true, lens: '#4aff9a', tubeCol: '#1a2a24' },
  mouth: { u: 0.035, v: 0.36, drop: 0 },
  op: { u: 0.3, top: 0.6, bot: 0.12, bulge: 0.02, dark: 0.15 },
  glassCore: { u0: 0, u1: 0.3, dome: { u1: 0.3, v0: 0.5 }, spineV: -9 },
  fins: [fin('top', 0.5, 0.62, 0.08, 'tri', 0.4, 9), fin('bot', 0.7, 0.8, 0.06, 'tri', 0.4, 8)],
  pec: { u: 0.36, v: 0.3, len: 0.18, w: 0.07, ang: -5, spread: 60, shape: 'fan', rays: 14 },
  pel: { u: 0.56, len: 0.08, w: 0.03, ang: -40 },
  tail: { type: 'emarginate', len: 0.18, spread: 0.12, fork: 0.1, rays: 12 },
  col: { back: '#2a2420', flank: '#3a3430', belly: '#5a524a', fin: '#c8d8e8', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#16120e', size: 0.02, density: 0.6, seed: 14 }],
  mat: { iri: 0.3, gloss: 0.9 },
  wave: 0.3, glow: true,
};

A.coelacanth = {
  plan: 'fish',
  body: { D: 0.27, up: 0.52, at: 0.42, ped: 0.32, tip: -0.02, fore: 1.8, chin: 2.0, back: 0.85, W: 0.09, nose: 0.05, xs: 2.1, wy: 0.45 },
  eye: { u: 0.1, v: 0.66, r: 0.026, iris: '#3a6a5a', glow: '#5aff9a', pupil: 0.55 },
  mouth: { u: 0.14, v: 0.36, drop: -0.02, curve: 0.01 },
  op: { u: 0.24, top: 0.82, bot: 0.14, bulge: 0.03, dark: 0.22 },
  scales: { size: 0.03, k: 0.07 },
  fins: [
    fin('top', 0.3, 0.38, 0.12, 'round', 0.3, 8, { spiny: true, notch: 0.2 }),
    fin('top', 0.6, 0.68, 0.1, 'round', 0.4, 8, { thick: 0.012 }),
    fin('bot', 0.62, 0.7, 0.09, 'round', 0.4, 8, { thick: 0.012 }),
  ],
  pec: { u: 0.27, v: 0.32, len: 0.16, w: 0.05, ang: -25, spread: 40, rays: 12, opaque: true },
  pel: { u: 0.48, len: 0.12, w: 0.04, ang: -55, spread: 25, opaque: true },
  tail: { type: 'round', len: 0.26, spread: 0.2, rays: 16, thick: 0.006 },
  col: { back: '#1a2a5a', flank: '#24386e', belly: '#3a4a7a', fin: '#1e2e60', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#e8f0fa', size: 0.018, density: 0.5, seed: 17 }, { type: 'spots', color: '#c8d8f0', size: 0.01, density: 0.35, seed: 23 }],
  mat: { iri: 0.15, gloss: 0.8 },
  wave: 0.35,
};

A.chimaera = {
  plan: 'fish',
  body: { top: [[0, 0.03], [0.06, 0.08], [0.18, 0.12], [0.3, 0.12], [0.55, 0.07], [0.8, 0.035], [1, 0.015]], bot: [[0, -0.02], [0.06, -0.06], [0.2, -0.08], [0.35, -0.075], [0.6, -0.04], [1, -0.012]], wid: [[0, 0.03], [0.15, 0.07], [0.35, 0.06], [1, 0.01]], nose: 0.05, xs: 1.9, wy: 0.45 },
  eye: { u: 0.1, v: 0.7, r: 0.04, iris: '#4ad8a0', pupil: 0.6 },
  mouth: { u: 0.06, v: 0.18, drop: 0, lips: '#e8e0f0', dark: 0.3 },
  op: { u: 0.2, top: 0.6, bot: 0.2, bulge: 0.02, dark: 0.12 },
  lateral: { v0: 0.6, v1: 0.45, u0: 0.04, tone: -0.2, w: 0.5 },
  fins: [fin('top', 0.22, 0.3, 0.2, 'sickle', 0.6, 4, { spiny: true, notch: 0.1 }), fin('top', 0.38, 0.9, 0.04, 'low', 0.3, 20), fin('bot', 0.85, 0.98, 0.03, 'low', 0.3, 6)],
  pec: { u: 0.22, v: 0.25, len: 0.24, w: 0.08, ang: -25, spread: 35, shape: 'wing', rays: 14 },
  pel: { u: 0.42, len: 0.08, w: 0.04, ang: -50 },
  tail: { type: 'whip', len: 0.4, taper: 1.6, col: '#a8a0b8' },
  col: { back: '#8a8098', flank: '#c8c0d4', belly: '#ecebf2', fin: '#b0a8c0', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'mottle', color: '#7a6a80', scale: 10, thresh: 0.58, amt: 0.7 }],
  mat: { iri: 0.55, gloss: 0.92 },
  wave: 0.45,
};

A.porpoise = {
  plan: 'fish',
  body: { D: 0.24, up: 0.54, at: 0.36, ped: 0.24, tip: -0.01, fore: 2.2, chin: 2.0, back: 1.0, W: 0.11, pw: 0.03, nose: 0.06, xs: 2.1, wy: 0.45 },
  eye: { u: 0.09, v: 0.5, r: 0.013, iris: '#3a3028' },
  mouth: { u: 0.08, v: 0.38, drop: -0.006, curve: -0.006, dark: 0.35 },
  op: null, noGill: true, nostril: false, scales: null,
  fins: [fin('top', 0.44, 0.58, 0.1, 'tri', 0.5, 1, { thick: 0.012 })],
  pec: { u: 0.22, v: 0.28, len: 0.14, w: 0.045, ang: -35, spread: 30, shape: 'wing', rays: 1, opaque: true, flap: 0.3 },
  pel: null,
  tail: null,
  flukes: { len: 0.14, span: 0.13 },
  vbend: 0.06,
  col: { back: '#2a3a4a', flank: '#5a6a7a', belly: '#e8eef2', fin: '#2a3a4a', vb: 0.58, vbel: 0.42, soft: 0.06 },
  mat: { iri: 0.1, gloss: 0.95, sheen: 1 },
  wave: 0,
};

A.frogfish = {
  plan: 'fish',
  body: { D: 0.6, up: 0.56, at: 0.38, ped: 0.24, tip: 0.06, fore: 1.6, chin: 1.8, back: 0.85, W: 0.22, pw: 0.05, nose: 0.06, xs: 2.2, wy: 0.45 },
  eye: { u: 0.16, v: 0.78, r: 0.028, iris: '#d8a030' },
  mouth: { u: 0.13, v: 0.72, drop: -0.1, curve: -0.01, dark: 0.55 },
  op: null, noGill: true, nostril: false,
  fins: [fin('top', 0.38, 0.74, 0.16, 'round', 0.3, 12), fin('bot', 0.64, 0.82, 0.12, 'round', 0.35, 8)],
  pec: { u: 0.42, v: 0.25, len: 0.2, w: 0.08, ang: -60, spread: 35, shape: 'fan', rays: 10, opaque: true },
  pel: { u: 0.34, len: 0.12, w: 0.05, ang: -85, spread: 20, opaque: true },
  tail: { type: 'round', len: 0.22, spread: 0.14, rays: 10 },
  lure: { u: 0.04, len: 0.12, ang: 80, curve: 0.4, bulb: 0.02, col: '#ffe8c0', rod: '#c87a28' },
  col: { back: '#e86a10', flank: '#f88a20', belly: '#ffc070', fin: '#f08020', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'spots', tone: -0.25, size: 0.018, density: 0.45, seed: 9 }, { type: 'spots', tone: 0.18, size: 0.01, density: 0.4, seed: 29 }],
  spines: { len: 0.02, gap: 0.06, col: '#f8a040', always: 1 },
  mat: { iri: 0.03, gloss: 0.75 },
  wave: 0.25, stiff: true,
};

A.football = {
  ...A.angler,
  body: { top: [[0, 0.15], [0.05, 0.3], [0.2, 0.4], [0.42, 0.42], [0.65, 0.31], [0.85, 0.13], [1, 0.045]], bot: [[0, -0.01], [0.04, -0.17], [0.18, -0.31], [0.42, -0.37], [0.66, -0.27], [0.86, -0.11], [1, -0.045]], W: 0.3, pw: 0.04, nose: 0.07, xs: 2.2, wy: 0.45 },
  mouth: { u: 0.26, v: 0.66, drop: -0.18, curve: -0.02, dark: 0.75, teeth: { n: 10, len: 0.05, col: '#e8f0f8', out: 1.02 } },
  lure: { u: 0.18, len: 0.42, ang: 95, curve: 1.6, bulb: 0.038, col: '#ffe8f0', rod: '#3a2830', filaments: 5 },
  spines: { len: 0.03, gap: 0.08, col: '#5a4048', always: 1 },
  col: { back: '#2a1a22', flank: '#3a2630', belly: '#4a3038', fin: '#2a1a22', vb: 0.6, vbel: 0.3 },
};

A.bigeye = {
  ...A.perch,
  body: { D: 0.38, up: 0.52, at: 0.36, ped: 0.24, tip: 0.02, fore: 1.6, chin: 1.6, back: 1.0, W: 0.07, nose: 0.03, xs: 1.9, wy: 0.45 },
  eye: { u: 0.13, v: 0.6, r: 0.065, iris: '#e8c040', pupil: 0.6 },
  mouth: { u: 0.08, v: 0.75, drop: -0.06, curve: -0.005 },
  fins: [fin('top', 0.3, 0.58, 0.12, 'spiny', 0.35, 10, { spiny: true }), fin('top', 0.58, 0.82, 0.12, 'round', 0.45, 12), fin('bot', 0.56, 0.82, 0.12, 'round', 0.45, 12)],
  pel: { u: 0.3, len: 0.16, w: 0.05, ang: -60, spread: 20 },
  tail: { type: 'truncate', len: 0.18, spread: 0.15, rays: 14 },
  scales: { size: 0.014, k: 0.05 },
};

A.mullet = {
  ...A.perch,
  body: { D: 0.22, up: 0.5, at: 0.4, ped: 0.34, tip: -0.01, fore: 2.0, chin: 1.6, back: 0.9, W: 0.08, wTip: 0.05, nose: 0.05, xs: 2.2, wy: 0.42 },
  eye: { u: 0.08, v: 0.66, r: 0.025, iris: '#d8d0b0' },
  mouth: { u: 0.05, v: 0.4, drop: -0.004 },
  fins: [fin('top', 0.38, 0.48, 0.1, 'tri', 0.3, 4, { spiny: true, notch: 0.15 }), fin('top', 0.62, 0.72, 0.09, 'fall', 0.4, 8), fin('bot', 0.6, 0.72, 0.08, 'fall', 0.4, 9)],
  pec: { u: 0.22, v: 0.62, len: 0.12, w: 0.035, ang: 0, rays: 14 },
  tail: { type: 'fork', len: 0.22, spread: 0.18, fork: 0.5, rays: 16 },
  lateral: null,
  scales: { size: 0.035, k: 0.08 },
  col: { back: '#3a4e64', flank: '#b8c4d0', belly: '#f2f4f6', fin: '#8a98a8', vb: 0.66, vbel: 0.36 },
  pat: [{ type: 'stripes', at: [0.5, 0.58, 0.66, 0.74], width: 0.022, tone: -0.22, fade: [0.2, 0.3] }],
  mat: { iri: 0.4, gloss: 0.88 },
};

A.snakehead = {
  plan: 'fish',
  body: { D: 0.19, up: 0.5, at: 0.3, ped: 0.6, tip: 0.0, fore: 2.0, chin: 1.8, back: 0.75, W: 0.085, nose: 0.05, xs: 2.2, wy: 0.45 },
  eye: { u: 0.075, v: 0.72, r: 0.022, iris: '#e8a040' },
  mouth: { u: 0.11, v: 0.4, drop: -0.01, curve: 0.006 },
  op: { u: 0.2, top: 0.82, bot: 0.15, bulge: 0.02 },
  scales: { size: 0.03, k: 0.08 },
  fins: [fin('top', 0.3, 0.95, 0.08, 'long', 0.3, 40), fin('bot', 0.55, 0.95, 0.07, 'long', 0.3, 26)],
  pec: { u: 0.22, v: 0.35, len: 0.14, w: 0.06, ang: -10, shape: 'fan', rays: 14 },
  pel: { u: 0.3, len: 0.06, w: 0.02, ang: -55 },
  tail: { type: 'round', len: 0.18, spread: 0.12, rays: 14 },
  col: { back: '#2a3a4a', flank: '#5a7088', belly: '#c8d0d8', fin: '#2a4a7a', vb: 0.6, vbel: 0.3 },
  mat: { iri: 0.3, gloss: 0.88 },
  wave: 0.6,
};

A.icefish = {
  plan: 'fish',
  body: { D: 0.16, up: 0.5, at: 0.35, ped: 0.36, tip: 0.0, fore: 0.9, chin: 0.9, back: 0.85, W: 0.06, wTip: 0.04, nose: 0.01, xs: 2.4, wy: 0.42 },
  eye: { u: 0.17, v: 0.78, r: 0.035, iris: '#c8d8e8', pupil: 0.6 },
  mouth: { u: 0.17, v: 0.52, drop: -0.01, dark: 0.3 },
  op: { u: 0.3, top: 0.8, bot: 0.18, bulge: 0.02, dark: 0.12 },
  scales: null,
  fins: [fin('top', 0.32, 0.42, 0.16, 'round', 0.3, 6, { col: '#2a3040' }), fin('top', 0.46, 0.85, 0.07, 'long', 0.3, 26), fin('bot', 0.5, 0.85, 0.06, 'long', 0.3, 22)],
  pec: { u: 0.32, v: 0.45, len: 0.16, w: 0.06, ang: -5, shape: 'fan', rays: 16 },
  pel: { u: 0.3, len: 0.16, w: 0.06, ang: -50, spread: 30, shape: 'fan' },
  tail: { type: 'truncate', len: 0.14, spread: 0.1, rays: 14 },
  col: { back: '#9ab0c4', flank: '#d4e2ec', belly: '#f4f8fb', fin: '#e4eef6', vb: 0.66, vbel: 0.3 },
  pat: [{ type: 'bars', at: [0.4, 0.52, 0.64, 0.76], width: 0.05, tone: -0.1, wavy: 0.01 }],
  mat: { iri: 0.35, gloss: 0.95, glass: 0.3 },
  wave: 0.5,
};

A.hawkfish = {
  ...A.perch,
  body: { D: 0.36, up: 0.56, at: 0.3, ped: 0.32, tip: -0.01, fore: 1.6, chin: 1.8, back: 0.9, W: 0.09, nose: 0.04, xs: 2.1, wy: 0.45 },
  eye: { u: 0.12, v: 0.76, r: 0.04, iris: '#e8c040' },
  mouth: { u: 0.08, v: 0.36, drop: -0.006, lips: '#ff6a5a' },
  fins: [fin('top', 0.28, 0.6, 0.15, 'spiny', 0.3, 10, { spiny: true, notch: 0.45 }), fin('top', 0.6, 0.82, 0.13, 'round', 0.4, 10), fin('bot', 0.64, 0.82, 0.11, 'round', 0.45, 7)],
  pec: { u: 0.28, v: 0.3, len: 0.17, w: 0.06, ang: -20, rays: 13, opaque: true },
  scales: { size: 0.025, k: 0.08 },
};

A.lingcod = {
  ...A.cod,
  body: { D: 0.2, up: 0.52, at: 0.28, ped: 0.26, tip: -0.01, fore: 1.5, chin: 1.9, back: 0.8, W: 0.08, nose: 0.04, xs: 2.1, wy: 0.45 },
  eye: { u: 0.1, v: 0.8, r: 0.022, iris: '#c8b070' },
  mouth: { u: 0.16, v: 0.4, drop: -0.03, curve: 0.012, teeth: { n: 5, len: 0.02 } },
  fins: [fin('top', 0.26, 0.5, 0.1, 'spiny', 0.3, 12, { spiny: true, notch: 0.3 }), fin('top', 0.52, 0.9, 0.09, 'long', 0.3, 22), fin('bot', 0.56, 0.9, 0.08, 'long', 0.3, 22)],
  pec: { u: 0.26, v: 0.36, len: 0.17, w: 0.07, ang: -10, shape: 'fan', rays: 16 },
  tail: { type: 'truncate', len: 0.15, spread: 0.12, rays: 14 },
  barbels: [],
  lateral: { v0: 0.82, v1: 0.55, tone: -0.15 },
};

A.squirrel = {
  ...A.perch,
  body: { D: 0.36, up: 0.55, at: 0.36, ped: 0.22, tip: 0.0, fore: 1.6, chin: 1.6, back: 1.0, W: 0.08, nose: 0.03, xs: 2, wy: 0.45 },
  eye: { u: 0.13, v: 0.66, r: 0.055, iris: '#e83a30' },
  fins: [fin('top', 0.28, 0.6, 0.15, 'spiny', 0.3, 11, { spiny: true, notch: 0.3 }), fin('top', 0.62, 0.8, 0.14, 'tri', 0.6, 10), fin('bot', 0.66, 0.82, 0.13, 'tri', 0.6, 8)],
  tail: { type: 'fork', len: 0.26, spread: 0.22, fork: 0.5, rays: 16 },
  scales: { size: 0.04, k: 0.12 },
};

// ---------------------------------------------------------------- rays (top view in the side map, rolled flat)

const rayKnots = (pts) => ({ top: pts, bot: pts.map(([u, v]) => [u, -v]) });
A.manta = {
  plan: 'fish',
  flat: { roll: -58, blind: '#f2f4f6' },
  body: { ...rayKnots([[0, 0.17], [0.05, 0.18], [0.12, 0.3], [0.25, 0.62], [0.38, 0.96], [0.45, 1.05], [0.52, 0.86], [0.64, 0.46], [0.78, 0.2], [0.9, 0.1], [1, 0.06]]), wid: [[0, 0.035], [0.15, 0.07], [0.4, 0.08], [0.75, 0.05], [1, 0.025]], nose: 0.02, xs: 1.15, wy: 0.5 },
  eye: { u: 0.06, v: 0.93, r: 0.018, iris: '#3a3a40', second: [0, -0.86] },
  mouth: null, op: null, noGill: true, nostril: false, orbit: false, lateral: null, scales: null,
  fins: [], pec: null, pel: null,
  tail: { type: 'whip', len: 0.32, taper: 1.3, w: 0.014, col: '#141c2c' },
  col: { back: '#14203a', flank: '#1c2c4c', belly: '#1c2c4c', fin: '#14203a', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'blotch', u: 0.24, v: 0.72, rx: 0.07, ry: 0.07, color: '#e8eef4' }, { type: 'blotch', u: 0.24, v: 0.28, rx: 0.07, ry: 0.07, color: '#e8eef4' }],
  flap: 0.32, flapK: 1.1,
  mat: { iri: 0.12, gloss: 0.85 },
  wave: 0,
};
A.eagleray = {
  ...A.manta,
  body: { ...rayKnots([[0, 0.05], [0.04, 0.07], [0.1, 0.11], [0.2, 0.42], [0.34, 0.86], [0.42, 1.0], [0.48, 0.78], [0.6, 0.38], [0.75, 0.14], [0.88, 0.07], [1, 0.05]]), wid: [[0, 0.04], [0.15, 0.08], [0.4, 0.08], [0.75, 0.05], [1, 0.025]], nose: 0.04, xs: 1.15, wy: 0.5 },
  eye: { u: 0.1, v: 0.94, r: 0.022, iris: '#3a3a40', second: [0, -0.88] },
  tail: { type: 'whip', len: 0.7, taper: 1.6, w: 0.016, col: '#101828' },
  col: { back: '#0e1a34', flank: '#16264a', belly: '#16264a', fin: '#0e1a34', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#f0f6ff', size: 0.02, density: 0.5, seed: 21, umin: 0.08 }],
  flap: 0.36,
};
A.skate = {
  ...A.manta,
  flat: { roll: -62, blind: '#f2f0ec' },
  body: { ...rayKnots([[0, 0.0], [0.06, 0.12], [0.18, 0.34], [0.36, 0.6], [0.46, 0.62], [0.58, 0.44], [0.72, 0.2], [0.82, 0.1], [1, 0.07]]), wid: [[0, 0.02], [0.2, 0.06], [0.45, 0.07], [0.8, 0.05], [1, 0.035]], nose: 0.03, xs: 1.15, wy: 0.5 },
  eye: { u: 0.16, v: 0.62, r: 0.02, iris: '#c8a860', second: [0, -0.24] },
  tail: { type: 'whip', len: 0.42, taper: 0.9, w: 0.03, col: '#5a6070' },
  col: { back: '#5a6070', flank: '#6a7080', belly: '#6a7080', fin: '#5a6070', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#a8acb8', size: 0.025, density: 0.35, seed: 25 }, { type: 'ocelli', color: '#2a2e3a', ring: '#e8d8a8', size: 0.05, density: 0.15, seed: 4 }],
  flap: 0.2, flapK: 1.6,
};
A.stingray = {
  ...A.manta,
  flat: { roll: -62, blind: '#f4f2ee' },
  body: { ...rayKnots([[0, 0.12], [0.06, 0.26], [0.2, 0.42], [0.45, 0.46], [0.7, 0.38], [0.88, 0.18], [1, 0.06]]), wid: [[0, 0.03], [0.25, 0.07], [0.6, 0.065], [1, 0.03]], nose: 0.03, xs: 1.2, wy: 0.5 },
  eye: { u: 0.2, v: 0.7, r: 0.032, iris: '#d8b050', second: [0, -0.4] },
  tail: { type: 'whip', len: 0.55, taper: 1.5, w: 0.022, col: '#b89a6a' },
  col: { back: '#b89a6a', flank: '#c8aa78', belly: '#c8aa78', fin: '#b89a6a', vb: 0.6, vbel: 0.3 },
  pat: [{ type: 'spots', color: '#1a8aff', size: 0.03, density: 0.45, seed: 33 }],
  flap: 0.14, flapK: 3,
};

export const ARCH = A;

// ---------------------------------------------------------------- per-species anatomy

const C = (back, flank, belly, fin, o = {}) => ({ back, flank, belly, fin, ...o });
const S = (id, base, o = {}) => { SPEC_IN[id] = { base, ...o }; };
const SPEC_IN = {};

// (OS)cean
S('pixel', 'carp', { col: C('#b8300c', '#f0601c', '#ffd890', '#f88a3a'), eye: { iris: '#f0c040', r: 0.03 }, scales: { size: 0.045, k: 0.12 }, pat: [{ type: 'scalenet', color: '#ffc070', size: 0.045, inner: 0.46, umin: 0.25, alpha: 0.35 }] });
S('loafer', 'sardine', { body: { D: 0.27, up: 0.52, W: 0.05 }, eye: { r: 0.04 }, col: C('#1446c8', '#4aa8ff', '#f4fbff', '#8ac8ff'), tail: { col: '#5ab0ff', upper: '#1a2a6a', lower: '#1a2a6a' }, pat: [{ type: 'stripes', at: [0.68], width: 0.05, color: '#e8fcff' }, { type: 'stripes', at: [0.6], width: 0.04, color: '#ffe040', fade: [0.35, 0.55] }], mat: { iri: 0.5 } });
S('honk', 'clown');
S('googly', 'bigeye', { col: C('#4a5a16', '#a8b83a', '#f4f6d8', '#c8d050'), eye: { iris: '#ffc820', r: 0.075 } });
S('grouper', 'grouper', { col: C('#2a4220', '#5a7a3a', '#d8e0b8', '#4a6a30'), pat: [{ type: 'spots', color: '#c8e090', size: 0.016, density: 0.75, seed: 6 }, { type: 'mottle', color: '#1e3018', scale: 9, thresh: 0.56, amt: 0.55 }], fins: [fin('top', 0.28, 0.6, 0.1, 'spiny', 0.3, 11, { spiny: true, edge: '#c8e090' }), fin('top', 0.6, 0.82, 0.12, 'round', 0.45, 14, { spots: '#c8e090' }), fin('bot', 0.64, 0.82, 0.11, 'round', 0.45, 9, { spots: '#c8e090' })] });
S('shortcut', 'boxfish', { col: C('#1c1820', '#3a58e0', '#3448c0', '#4a68e8', { vb: 0.72, vbel: 0.3, soft: 0.03 }), pat: [{ type: 'spots', color: '#f4f8ff', size: 0.02, density: 0.5, vmin: 0.72, seed: 3 }, { type: 'spots', color: '#ffb030', size: 0.018, density: 0.42, vmax: 0.7, seed: 8 }, { type: 'stripes', at: [0.72], width: 0.03, color: '#f8b838' }], eye: { iris: '#f8c040' } });
S('cookie', 'puffer', { body: { D: 0.4, W: 0.16 }, col: C('#9a6a30', '#d8b078', '#fbf6ec', '#d8b888'), pat: [{ type: 'spots', color: '#3a220e', size: 0.028, density: 0.55, vmin: 0.3, seed: 2 }], spines: { len: 0.045, gap: 0.08, col: '#f0e4c8', always: 1 }, eye: { iris: '#50a868', r: 0.05 } });
S('glassghost', 'perch', { body: { D: 0.36, W: 0.05, xs: 1.7 }, col: C('#9ac8e8', '#bfe2f6', '#e4f4fc', '#d8f0ff'), mat: { glass: 0.6, iri: 0.6, gloss: 1, finGlass: 0.35 }, lateral: null, scales: null, glassCore: { u0: 0.12, u1: 1, spineV: 0.56, bone: '#e8f2f8', ribs: true, ribU0: 0.28, ribU1: 0.62, ribGap: 0.035, gut: { u0: 0.2, u1: 0.42, v0: 0.12, v1: 0.5, col: '#d0dce8' } }, eye: { iris: '#c8d8e8' } });
S('bruce', 'shark', { body: { D: 0.17, tip: 0.014, fore: 1.5, W: 0.07 }, col: C('#1838b0', '#3a6ae0', '#f6f8fc', '#1838b0'), pec: { len: 0.32, w: 0.05 }, eye: { r: 0.018, iris: '#1a2440' } });
S('bubblepuff', 'puffer', { col: C('#4a8496', '#8ec4d2', '#f8fcfc', '#bfe4ee'), pat: [{ type: 'spots', color: '#f6feff', size: 0.016, density: 0.55, vmin: 0.25, seed: 13 }], eye: { iris: '#5ad8c0' }, bubbleSkin: true, mat: { iri: 0.3, gloss: 0.95 } });
S('sneakerhead', 'snakehead', { col: C('#24344e', '#4a6a96', '#d8e0ec', '#1a48b8'), pat: [{ type: 'spots', color: '#f08030', size: 0.01, density: 0.6, vmin: 0.3, seed: 7 }, { type: 'mottle', color: '#141e30', scale: 10, thresh: 0.58, amt: 0.6 }], fins: [fin('top', 0.3, 0.95, 0.08, 'long', 0.3, 40, { edge: '#f0f6ff', spots: '#f08030' }), fin('bot', 0.55, 0.95, 0.07, 'long', 0.3, 26, { edge: '#f0f6ff' })], tail: { col: '#1a48b8', edge: '#f0f6ff', spots: '#f08030' } });
S('hydrated', 'damsel', { col: C('#2ab890', '#7ae8c0', '#e4fff4', '#a0f4d8'), mat: { iri: 0.7, gloss: 0.92 }, bubbly: 2 });
S('porpoise', 'porpoise');

// Sunny Shallows
S('puffer', 'puffer', { col: C('#e8a800', '#ffd418', '#fff4b0', '#ffd860'), pat: [{ type: 'spots', color: '#3a2c10', size: 0.014, density: 0.22, vmin: 0.3, seed: 5 }], eye: { iris: '#3ab070' } });
S('briefcase', 'salmon', { body: { hump: 0.05, D: 0.25 }, col: C('#b81414', '#e02a22', '#f0a088', '#4a6a30', { head: '#3a5a26', headU: 0.24 }), mouth: { drop: -0.03, curve: -0.01 }, tail: { col: '#4a6a30' }, fins: [fin('top', 0.4, 0.53, 0.11, 'tri', 0.45, 11, { col: '#a82020' }), fin('top', 0.79, 0.85, 0.035, 'tri', 0.3, 1, { adipose: true, col: '#a82020' }), fin('bot', 0.68, 0.79, 0.08, 'tri', 0.4, 9, { col: '#4a6a30' })] });
S('flounder', 'flatfish', { col: C('#4c3c28', '#5c4932', '#5c4932', '#4a3a28'), op: { dark: 0.03 }, pat: [{ type: 'mottle', color: '#30241a', scale: 10, thresh: 0.53, amt: 0.7 }, { type: 'mottle', color: '#7a6646', scale: 20, thresh: 0.62, amt: 0.45 }, { type: 'ocelli', color: '#241a10', ring: '#806848', size: 0.03, density: 0.22, seed: 9 }, { type: 'spots', color: '#8a7656', size: 0.006, density: 0.18, seed: 4 }], fins: [fin('top', 0.1, 0.95, 0.085, 'low', 0.3, 46, { spots: '#2e2218', edge: '#2a2016', thick: 0.012 }), fin('bot', 0.22, 0.95, 0.085, 'low', 0.3, 38, { spots: '#2e2218', edge: '#2a2016', thick: 0.012 })], tail: { type: 'round', len: 0.15, spread: 0.12, thick: 0.012, col: '#4a3a28', edge: '#2a2016' } });
S('angel', 'angelfw', { col: C('#d8b8f0', '#f6e0fa', '#fff6fc', '#ecd4fc'), pat: [{ type: 'bars', at: [0.15, 0.48, 0.82], width: 0.06, color: '#5ad8f0', slant: -0.05, alpha: 0.55 }, { type: 'vgrad', v0: 0.7, v1: 1, color: '#ff9ad8', amt: 0.5 }], fins: [fin('top', 0.42, 0.86, 0.55, 'rise', 1.5, 13, { col: '#f0d0fa', edge: '#5ad8f0' }), fin('bot', 0.42, 0.86, 0.55, 'rise', 1.5, 13, { col: '#f0d0fa', edge: '#5ad8f0' })], mat: { iri: 0.7 } });
S('parrot', 'parrot', { col: C('#0e9a84', '#22d0a8', '#8ef0d4', '#ff78b0'), pat: [{ type: 'scalenet', color: '#ff8ac4', size: 0.05, inner: 0.5, umin: 0.25, alpha: 0.3 }, { type: 'lines', color: '#ff9ad0', umax: 0.22, freq: 30, width: 0.18, slope: 0.4, wavy: 0.2 }], fins: [fin('top', 0.24, 0.84, 0.08, 'low', 0.4, 20, { col: '#ff78b0', edge: '#3af0ff' }), fin('bot', 0.56, 0.84, 0.075, 'low', 0.4, 12, { col: '#ff78b0', edge: '#3af0ff' })], tail: { col: '#ff78b0', edge: '#3af0ff' } });
S('gourami', 'gourami', { col: C('#2e4e90', '#6c9ce0', '#d4e4f8', '#5a84c4'), pat: [{ type: 'mottle', color: '#2a3e78', scale: 12, thresh: 0.55, amt: 0.6 }, { type: 'blotch', u: 0.5, v: 0.5, rx: 0.03, ry: 0.07, color: '#141c3a' }, { type: 'blotch', u: 0.96, v: 0.5, rx: 0.03, ry: 0.12, color: '#141c3a' }] });
S('koi', 'carp', { col: C('#fbf8f2', '#fbf8f2', '#fdfcf8', '#f6f2ea'), pat: [{ type: 'patches', color: '#e8280e', scale: 7, thresh: 0.52, vmin: 0.3, seed: 41 }], scales: { size: 0.045, k: 0.09 }, mat: { iri: 0.2, gloss: 0.92 }, fins: [fin('top', 0.36, 0.74, 0.12, 'fall', 0.35, 16, { col: '#f8f4ee' }), fin('bot', 0.72, 0.8, 0.1, 'tri', 0.35, 7, { col: '#f8f4ee' })] });
S('betta', 'betta', { col: C('#1a1680', '#2a3ce0', '#4a2aa8', '#d8183c'), fins: [fin('top', 0.52, 0.8, 0.38, 'trail', 1.0, 12, { col: '#2a40e8', edge: '#3af0ff', base: '#d8183c' }), fin('bot', 0.34, 0.92, 0.42, 'trail', 1.1, 22, { col: '#d8183c', edge: '#3a58ff', base: '#2a3ce0' })], tail: { col: '#c81a50', base: '#2a3ce0', edge: '#3af0ff', upper: '#8a2aff', lower: '#ff3a3a' } });
S('sunfish', 'mola');
S('dragonkarp', 'arowana');
S('bananafish', 'trumpet');
S('catfish', 'catfish', { tail: { col: '#ff4a14', base: '#d84a1a' }, fins: [fin('top', 0.26, 0.37, 0.16, 'tri', 0.35, 7, { edge: '#ff7a3a' }), fin('top', 0.62, 0.84, 0.045, 'long', 0.2, 1, { adipose: true }), fin('bot', 0.64, 0.84, 0.085, 'round', 0.35, 12)] });
S('companioncube', 'boxfish');
S('heisenbass', 'perch', { body: { D: 0.27, tip: -0.015 }, mouth: { u: 0.16, drop: -0.03, curve: 0.01 }, col: C('#2e4a20', '#7a9a4a', '#eef0d8', '#6a8a48'), pat: [{ type: 'band', at: 0.52, width: 0.1, color: '#1e2e14', fade: [0.12, 0.3] }, { type: 'mottle', color: '#24381a', scale: 12, thresh: 0.6, amt: 0.6, vmin: 0.5 }], eye: { iris: '#d8a040' } });

// Junkyard Reef
S('spam', 'sardine');
S('zebrafish', 'sardine', { body: { D: 0.2, up: 0.5, W: 0.05 }, eye: { r: 0.045, iris: '#d8c890' }, mouth: { u: 0.05, v: 0.62, drop: -0.008 }, fins: [fin('top', 0.5, 0.62, 0.1, 'tri', 0.4, 8), fin('bot', 0.6, 0.8, 0.08, 'fall', 0.4, 12, { col: '#e8e0c8', bands: [{ at: 0.4, w: 0.18, col: '#2a3a8a' }, { at: 0.75, w: 0.15, col: '#2a3a8a' }] })], col: C('#6a7a5a', '#e8e4d0', '#f8f6ee', '#e8e0c8'), pat: [{ type: 'stripes', at: [0.3, 0.46, 0.62], width: 0.075, color: '#24348c', fade: [0.18, 0.26] }, { type: 'stripes', at: [0.38, 0.54], width: 0.05, color: '#f0e0a8', fade: [0.18, 0.26] }], tail: { type: 'fork', fork: 0.5, bars: [{ at: 0.4, w: 0.18, col: '#24348c' }, { at: 0.75, w: 0.14, col: '#24348c' }] }, barbels: [{ u: 0.03, v: 0.5, len: 0.03, ang: -150, curl: 0.2, out: 0.15 }], mat: { iri: 0.45 } });
S('bitfish', 'goby', { eye: { top: true, v: 0.95, r: 0.04 }, body: { D: 0.17, W: 0.07 }, col: C('#4a4a2a', '#8a8a5a', '#e0dcc8', '#6a6a48'), pat: [{ type: 'spots', color: '#5ad8ff', size: 0.007, density: 0.7, vmin: 0.3, seed: 16 }, { type: 'mottle', color: '#2e2e1a', scale: 12, thresh: 0.56, amt: 0.6 }], pec: { len: 0.17, w: 0.06, ang: -50, spread: 65, opaque: true }, fins: [fin('top', 0.28, 0.42, 0.22, 'round', 0.3, 7, { edge: '#3ab8ff', spots: '#5ad8ff' }), fin('top', 0.48, 0.84, 0.1, 'long', 0.35, 14, { edge: '#3ab8ff' }), fin('bot', 0.55, 0.84, 0.08, 'long', 0.35, 12)] });
S('glitchminnow', 'hawkfish', { col: C('#d81010', '#ff2a24', '#ff6a5a', '#ff3a30'), pat: [{ type: 'stripes', at: [0.93], width: 0.12, color: '#141010' }], eye: { iris: '#3a9aff' } });
S('binblob', 'lumpsucker');
S('floppyray', 'skate');
S('loadingangler', 'frogfish');
S('thief', 'tuna');
S('screendweller', 'stargazer');
S('usbfish', 'needle');
S('lionfish', 'lionfish');
S('bsod', 'manta', { col: C('#0e1c48', '#162a62', '#162a62', '#0e1c48') });
S('rockfish', 'perch', { body: { D: 0.31 }, col: C('#141a28', '#1e2638', '#3a4258', '#1e2638'), pat: [{ type: 'stripes', at: [0.82], width: 0.1, color: '#ffd020', slope: -0.4, fade: [0.25, 0.32] }, { type: 'spots', color: '#ffd858', size: 0.006, density: 0.5, seed: 18 }], eye: { iris: '#e0b040' }, fins: [fin('top', 0.3, 0.56, 0.14, 'spiny', 0.35, 13, { spiny: true, notch: 0.4 }), fin('top', 0.57, 0.8, 0.11, 'round', 0.5, 12), fin('bot', 0.62, 0.8, 0.09, 'tri', 0.45, 9)], tail: { type: 'truncate' } });
S('dogfish', 'shark', { body: { D: 0.13, up: 0.5, at: 0.34, tip: 0.0, fore: 2.0, W: 0.06 }, col: C('#c8a070', '#dcbc90', '#f4ecdc', '#c8a070', { vb: 0.5, vbel: 0.3, soft: 0.1 }), pat: [{ type: 'spots', color: '#5a3a1e', size: 0.014, density: 0.5, vmin: 0.3, seed: 27 }], eye: { r: 0.022, iris: '#d8c060', pupil: 0.4 }, fins: [fin('top', 0.56, 0.64, 0.08, 'tri', 0.6, 1, { thick: 0.008 }), fin('top', 0.72, 0.78, 0.06, 'tri', 0.6, 1, { thick: 0.006 }), fin('bot', 0.64, 0.72, 0.05, 'tri', 0.6, 1, { thick: 0.006 })], pec: { len: 0.12, w: 0.05 }, tail: { type: 'hetero', len: 0.24, spread: 0.08, lobe: 0.3, thick: 0.008 } });
S('seabass', 'perch', { body: { D: 0.26, tip: -0.008 }, col: C('#3a4e66', '#b4c2d0', '#f2f6f8', '#8a9cb0'), eye: { iris: '#d8d0b8' }, tail: { type: 'fork', fork: 0.3 }, pat: [{ type: 'blotch', u: 0.24, v: 0.78, rx: 0.012, ry: 0.06, color: '#2a3446' }], mat: { iri: 0.35 } });

// The Deep (abyss)
S('lanternfish', 'lantern');
S('hatchet', 'hatchet');
S('blobfish', 'blobfish');
S('angler', 'angler');
S('dragonfish', 'dragonfish');
S('gulper', 'gulper');
S('fangtooth', 'fangtooth');
S('barreleye', 'barreleye');
S('manyeyes', 'coelacanth');
S('moonfish', 'opah');
S('toadfish', 'sculpin', { body: { D: 0.22, W: 0.13 }, eye: { top: true, v: 0.92 }, col: C('#22243a', '#30344c', '#d8d8e0', '#2a2c44'), pat: [{ type: 'lines', color: '#f4f4fa', umax: 0.3, freq: 34, width: 0.25, slope: 0.6, wavy: 0.9 }, { type: 'stripes', at: [0.6, 0.72], width: 0.03, color: '#e8e8f0', umin: 0.3 }], fins: [fin('top', 0.26, 0.4, 0.1, 'round', 0.3, 4, { spiny: true, notch: 0.4 }), fin('top', 0.42, 0.88, 0.1, 'long', 0.35, 22, { edge: '#ffd020' }), fin('bot', 0.5, 0.88, 0.09, 'long', 0.35, 18, { edge: '#ffd020' })], pec: { col: '#2a2c44', edge: '#ffd020' }, tail: { edge: '#ffd020' }, barbels: [{ u: 0.03, v: 0.4, len: 0.03, ang: -100, curl: 0.2 }, { u: 0.08, v: 0.3, len: 0.03, ang: -100, curl: 0.2 }] });

// Frosty Fjord
S('icebabycod', 'cod', { body: { D: 0.2 }, col: C('#4a5a62', '#a8b8c0', '#f2f6f8', '#7a8a92'), pat: [{ type: 'spots', color: '#2a343a', size: 0.008, density: 0.7, vmin: 0.45, seed: 8 }], mat: { iri: 0.3 } });
S('wintercod', 'cod');
S('fishsticks', 'cod', { col: C('#4a4c2e', '#9a9a6a', '#f2f2e6', '#6a6a48'), barbels: [{ u: 0.06, v: 0.02, len: 0.02, ang: -95, curl: 0.3, out: 0 }], pat: [{ type: 'mottle', color: '#3a3a20', scale: 14, thresh: 0.58, amt: 0.5, vmin: 0.5 }], lateral: { v0: 0.82, v1: 0.5, color: '#d8d8c8' }, mat: { iri: 0.25 } });
S('nootfish', 'tetra', { col: C('#2a2e38', '#e8eef4', '#fbfcfe', '#d8e0e8'), pat: [{ type: 'stripes', at: [0.5], width: 0.12, color: '#0e1016', fade: [0.3, 0.45] }], tail: { lower: '#0e1016', col: '#e8eef4' }, mat: { iri: 0.4 } });
S('chillsculpin', 'sculpin');
S('letitgo', 'puffer', { col: C('#c8d4dc', '#e8eef2', '#fbfcfd', '#e0e8ee'), pat: [{ type: 'spots', color: '#1a2230', size: 0.012, density: 0.45, vmin: 0.2, seed: 9 }], eye: { iris: '#3a9aff' }, mat: { iri: 0.25 } });
S('unicod', 'lingcod', { col: C('#3a4a3a', '#7a8a6a', '#e8eadc', '#5a6a50'), pat: [{ type: 'mottle', color: '#24301e', scale: 11, thresh: 0.54, amt: 0.8 }, { type: 'spots', color: '#c8b070', size: 0.01, density: 0.4, seed: 5, vmin: 0.4 }] });
S('sealwrasse', 'wrasse', { col: C('#1a4ad0', '#ff8a2a', '#ffc070', '#ff7a2a', { vb: 0.74 }), pat: [{ type: 'stripes', at: [0.6, 0.86], width: 0.05, color: '#2a6aff' }, { type: 'lines', color: '#3a7aff', umax: 0.24, freq: 24, width: 0.2, slope: 0.8, wavy: 0.3 }], fins: [fin('top', 0.24, 0.84, 0.08, 'low', 0.4, 20, { col: '#ff8a2a', edge: '#2a6aff' }), fin('bot', 0.56, 0.84, 0.075, 'low', 0.4, 12, { col: '#ff8a2a', edge: '#2a6aff' })], tail: { col: '#ff8a2a', edge: '#2a6aff' } });
S('icekingfish', 'icefish');
S('badwolffish', 'wolffish');
S('auroraray', 'eagleray', { mat: { iri: 0.6, gloss: 0.9 }, col: C('#0e2a34', '#123a48', '#123a48', '#0e2a34'), pat: [{ type: 'spots', color: '#bff8e8', size: 0.02, density: 0.5, seed: 21, umin: 0.08, glow: true }] });
S('eldershark', 'shark', { body: { D: 0.19, up: 0.52, tip: 0.0, fore: 2.2, chin: 1.5, W: 0.09, ped: 0.26 }, col: C('#3a3a3c', '#56565a', '#8a8a8e', '#3a3a3c', { vb: 0.5, vbel: 0.3, soft: 0.15 }), pat: [{ type: 'mottle', color: '#2a2a2e', scale: 9, thresh: 0.55, amt: 0.6 }], fins: [fin('top', 0.44, 0.52, 0.06, 'round', 0.5, 1, { thick: 0.01 }), fin('top', 0.62, 0.68, 0.05, 'round', 0.5, 1, { thick: 0.008 }), fin('bot', 0.6, 0.66, 0.04, 'round', 0.5, 1, { thick: 0.008 })], pec: { len: 0.12, w: 0.05 }, tail: { lobe: 0.35, len: 0.24 }, eye: { r: 0.012, iris: '#5a7a8a' }, mat: { gloss: 0.6, iri: 0.02 } });
S('monkfish', 'monkfish');
S('ghostshark', 'chimaera');
S('crystalcarp', 'carp', { col: C('#8a94a8', '#d8e0ec', '#f4f6fa', '#c8d0e0'), mat: { iri: 0.6, gloss: 0.98, chrome: 0.35 }, pat: [{ type: 'scalenet', color: '#f8fbff', size: 0.07, inner: 0.42, umin: 0.25, vmin: 0.35, vmax: 0.8 }], scales: { size: 0.07, k: 0.12 } });

// Lava Rift (volcano)
S('fireflower', 'goby', { body: { D: 0.18, W: 0.06 }, eye: { top: false, v: 0.7, r: 0.045, iris: '#f8d060' }, col: C('#f8f0e8', '#fbf6f0', '#ffffff', '#ff6a2a'), pat: [{ type: 'grad', u0: 0.5, u1: 0.85, color: '#ff4a10' }, { type: 'grad', u0: 0, u1: 0.12, color: '#ffe040', amt: 0.8 }, { type: 'grad', u0: 0.16, u1: 0.04, color: '#ffe040', amt: 0.6 }], fins: [fin('top', 0.24, 0.32, 0.36, 'sail', 0.3, 3, { col: '#f8f0e8' }), fin('top', 0.4, 0.86, 0.11, 'long', 0.4, 18, { col: '#ff4a10', edge: '#1a0a0a' }), fin('bot', 0.5, 0.86, 0.1, 'long', 0.4, 16, { col: '#ff4a10', edge: '#1a0a0a' })], tail: { type: 'emarginate', fork: 0.2, col: '#ff3a10', edge: '#1a0a0a' } });
S('floorlava', 'goby', { col: C('#e8380e', '#ff5a1a', '#ff9a5a', '#ff6a2a'), pat: [{ type: 'bars', at: [0.2, 0.34, 0.48, 0.62, 0.76, 0.9], width: 0.022, color: '#3ab0ff' }], fins: [fin('top', 0.32, 0.46, 0.16, 'round', 0.35, 6, { spiny: true, notch: 0.2, edge: '#3ab0ff' }), fin('top', 0.5, 0.82, 0.11, 'long', 0.35, 12, { edge: '#3ab0ff' }), fin('bot', 0.55, 0.82, 0.09, 'long', 0.35, 10, { edge: '#3ab0ff' })] });
S('ashsnapper', 'snapper');
S('pumicepuffer', 'puffer', { col: C('#a87048', '#d8a878', '#f8ecdc', '#d8b088'), pat: [{ type: 'reticulate', color: '#3a1e10', scale: 11, width: 0.045 }], eye: { iris: '#e0a040' } });
S('jalapeno', 'wrasse', { body: { D: 0.22, tip: 0.0, fore: 0.9, nose: 0.005 }, col: C('#0a8a3a', '#1ac850', '#a8f070', '#1ac850'), mouth: { u: 0.05, v: 0.5 }, pat: [{ type: 'grad', u0: 0.2, u1: 0.0, color: '#0a6a3a', amt: 0.7 }, { type: 'stripes', at: [0.5], width: 0.04, color: '#5af0ff', fade: [0.05, 0.15] }], tail: { type: 'lunate', fork: 0.4, col: '#1ac850', edge: '#5af0ff' } });
S('blockcrafter', 'boxfish', { col: C('#e8a018', '#f8c030', '#fff0b0', '#f8c840'), pat: [{ type: 'spots', color: '#2a7aff', size: 0.012, density: 0.6, seed: 11 }, { type: 'hex', color: '#c88a10', size: 0.07, inner: 0.44, alpha: 0.6 }], barbels: [{ u: 0.06, v: 0.95, len: 0.1, ang: 15, curl: 0, fwd: true, out: 0.2, w: 1, col: '#e8a018' }, { u: 0.95, v: 0.02, len: 0.08, ang: -20, curl: 0, out: 0.3, w: 1, col: '#e8a018' }] });
S('chefsnapper', 'snapper', { col: C('#f4eeee', '#fbf8f8', '#ffffff', '#f06070'), pat: [{ type: 'bars', at: [0.12, 0.42], width: 0.1, color: '#d0182a', slant: 0.15 }, { type: 'stripes', at: [0.9], width: 0.16, color: '#d0182a', umin: 0.45 }], eye: { iris: '#e04838' } });
S('infernalangler', 'football');
S('ripandtear', 'grouper', { body: { D: 0.34, W: 0.12 }, col: C('#3a3220', '#6a5e3a', '#d8cca8', '#d8b030'), pat: [{ type: 'mottle', color: '#1e1a10', scale: 7, thresh: 0.52, amt: 0.8 }, { type: 'spots', color: '#e8d080', size: 0.012, density: 0.5, seed: 4 }], fins: [fin('top', 0.28, 0.6, 0.1, 'spiny', 0.3, 11, { spiny: true, col: '#e0b830', spots: '#2a2410' }), fin('top', 0.6, 0.82, 0.12, 'round', 0.45, 14, { col: '#e0b830', spots: '#2a2410' }), fin('bot', 0.64, 0.82, 0.11, 'round', 0.45, 9, { col: '#e0b830', spots: '#2a2410' })], pec: { col: '#e8c030' }, tail: { col: '#e0b830', spots: '#2a2410' } });
S('moltenleviathan', 'shark', { body: { D: 0.11, up: 0.5, at: 0.3, ped: 0.5, tip: 0.0, fore: 2.2, chin: 1.6, back: 0.7, W: 0.05, nose: 0.04 }, mouth: { type: 'terminal', u: 0.08, v: 0.45, drop: -0.01, dark: 0.7, teeth: { n: 8, len: 0.012, col: '#f4f0e8' } }, slits: { n: 6, u0: 0.1, u1: 0.18, v0: 0.1, v1: 0.85 }, col: C('#3a2218', '#5a3828', '#8a6a58', '#3a2218'), pat: [{ type: 'speckle', tone: -0.12, density: 0.1 }], fins: [fin('top', 0.72, 0.8, 0.05, 'round', 0.6, 1, { thick: 0.006 }), fin('bot', 0.66, 0.78, 0.05, 'round', 0.6, 1, { thick: 0.006 }), fin('bot', 0.5, 0.56, 0.035, 'round', 0.6, 1, { thick: 0.006 })], pec: { len: 0.06, w: 0.03, spread: 25 }, tail: { type: 'hetero', len: 0.2, spread: 0.07, lobe: 0.2, thick: 0.006 }, eye: { r: 0.012, iris: '#4ab890' }, wave: 0.8, mat: { gloss: 0.8, iri: 0.08 } });
S('trieye', 'butterfly', { col: C('#e0d8c0', '#f4f0e4', '#fbfaf6', '#f8e070'), pat: [{ type: 'lines', color: '#3a3a40', freq: 22, width: 0.2, slope: -1.0, wavy: 0.1, umin: 0.2 }, { type: 'bars', at: [0.17], width: 0.05, color: '#14141a', slant: 0 }, { type: 'blotch', u: 0.84, v: 0.72, rx: 0.06, ry: 0.11, color: '#14141a', ring: '#fbfaf6', ringW: 0.3 }], fins: [fin('top', 0.32, 0.88, 0.2, 'low', 0.6, 16, { spiny: true, notch: 0.15, col: '#f8e070' }), fin('bot', 0.55, 0.88, 0.2, 'low', 0.6, 12, { col: '#f8e070' })] });
S('pizzafish', 'pineapple');

// Sunken Metropolis
S('neonpunk', 'tetra', { col: C('#3a4a3a', '#8a98a8', '#e8eef2', '#d8e0e8'), pat: [{ type: 'stripes', at: [0.66], width: 0.14, color: '#20d8ff', fade: [0.06, 0.12], glow: false }, { type: 'stripes', at: [0.32], width: 0.3, color: '#ff1a3a', fade: [0.45, 0.55] }], mat: { iri: 0.7 } });
S('surfermullet', 'mullet');
S('conefish', 'butterfly', { body: { tip: 0.04, fore: 1.0, nose: 0.004 }, mouth: { u: 0.02, v: 0.55 }, col: C('#f8f6f0', '#fcfbf8', '#ffffff', '#f6f0e4'), pat: [{ type: 'bars', at: [0.14, 0.38, 0.6, 0.82], width: 0.1, color: '#ff7a10', edge: true, edgeW: 0.012, slant: 0.04 }, { type: 'blotch', u: 0.78, v: 0.82, rx: 0.04, ry: 0.06, color: '#14141a', ring: '#fcfbf8' }], body2: true });
S('pigeonfish', 'perch', { body: { D: 0.46, up: 0.55, at: 0.38, ped: 0.22, W: 0.06, xs: 1.7 }, col: C('#2a4a5a', '#7a98a8', '#f0d8a8', '#6a8a98'), pat: [{ type: 'bars', at: [0.3, 0.42, 0.54, 0.66, 0.78], width: 0.05, color: '#3a5a6a', alpha: 0.5 }, { type: 'grad', u0: 0.3, u1: 0.1, color: '#5a7ab8', amt: 0.6 }, { type: 'blotch', u: 0.25, v: 0.62, rx: 0.02, ry: 0.07, color: '#0e1418' }], mat: { iri: 0.6 } });
S('bettercallsole', 'flatfish', { body: { D: 0.42, at: 0.4, tip: 0.02, fore: 2.2 }, col: C('#4a3828', '#584432', '#584432', '#4a3828'), pat: [{ type: 'mottle', color: '#30241a', scale: 14, thresh: 0.54, amt: 0.7 }, { type: 'spots', color: '#2a1e14', size: 0.008, density: 0.4, seed: 2 }], tail: { type: 'round', thick: 0.012, col: '#4a3828', edge: '#1a1410' } });
S('mindthegap', 'catfish', { col: C('#3a4a5a', '#7a8a9a', '#eef0f2', '#5a6a7a', { vb: 0.6, vbel: 0.35, soft: 0.1 }), pat: [{ type: 'spots', color: '#1a2228', size: 0.008, density: 0.5, vmin: 0.35, seed: 6 }], tail: { type: 'fork', fork: 0.55, len: 0.22, spread: 0.18 }, barbels: [{ u: 0.03, v: 0.62, len: 0.2, ang: -12, curl: 0.6, out: 0.5, col: '#3a4048' }, { u: 0.02, v: 0.05, len: 0.08, ang: -85, curl: 0.4, out: 0.2, col: '#d8d8d8' }, { u: 0.04, v: 0.02, len: 0.07, ang: -95, curl: 0.3, out: 0.3, col: '#d8d8d8' }] });
S('adbreakray', 'stingray');
S('gottagofast', 'billfish', { bill: { len: 0.42, h: 0.012, w: 0.03 }, fins: [fin('top', 0.18, 0.3, 0.2, 'sickle', 0.5, 10), fin('top', 0.9, 0.93, 0.025, 'tri', 0.4, 3), fin('bot', 0.64, 0.72, 0.1, 'sickle', 0.6, 8)], pel: null, col: C('#2a1e3a', '#6a5a78', '#e4dce8', '#3a2e4a'), pat: [], mat: { iri: 0.5 } });
S('hadouken', 'cod', { col: C('#4a4058', '#a8a4b0', '#f4f2f6', '#5a5468'), lateral: { v0: 0.82, v1: 0.52, color: '#14121a', w: 0.7 }, pat: [{ type: 'blotch', u: 0.3, v: 0.7, rx: 0.025, ry: 0.07, color: '#1a1622' }], barbels: [{ u: 0.06, v: 0.02, len: 0.025, ang: -95, curl: 0.3, out: 0 }], fins: [fin('top', 0.3, 0.42, 0.13, 'tri', 0.4, 12), fin('top', 0.46, 0.63, 0.085, 'round', 0.35, 16), fin('top', 0.67, 0.83, 0.075, 'round', 0.35, 16), fin('bot', 0.44, 0.63, 0.075, 'round', 0.35, 16), fin('bot', 0.67, 0.83, 0.07, 'round', 0.35, 14)] });
S('mayorgrouper', 'billfish');
S('unicornfish', 'tang', { col: C('#6a8aa8', '#a8c0d4', '#d8e4ee', '#8aa8c4'), pat: [{ type: 'spots', color: '#2a3a4a', size: 0.006, density: 0.5, seed: 3 }], tail: { type: 'lyre', col: '#8aa8c4', edge: '#3a8aff' }, barbels: [{ u: 0.08, v: 0.92, len: 0.12, ang: 20, curl: 0.1, fwd: true, out: 0, mid: true, w: 1, col: '#8aa0b8' }], fins: [fin('top', 0.28, 0.9, 0.16, 'low', 0.5, 22, { edge: '#3a8aff' }), fin('bot', 0.45, 0.9, 0.15, 'low', 0.5, 16, { edge: '#3a8aff' })] });
S('hammerhead', 'hammerhead');
S('goldbar', 'goldfish', { col: C('#f09010', '#ffb020', '#ffe080', '#ffd070'), mat: { iri: 0.35, gloss: 0.95, finGlass: 0.42 }, fins: [fin('top', 0.32, 0.7, 0.22, 'trail', 0.6, 14, { col: '#e8f8ff' }), fin('bot', 0.72, 0.82, 0.14, 'trail', 0.6, 7, { col: '#e8f8ff' })], tail: { col: '#e8f8ff', base: '#ffb020' }, pec: { col: '#e8f8ff' }, pel: { col: '#e8f8ff' } });
S('batfish', 'platax', { pat: [{ type: 'vgrad', v0: 0.95, v1: 1.0, color: '#ff6a10' }, { type: 'vgrad', v0: 0.05, v1: 0.0, color: '#ff6a10' }], fins: [fin('top', 0.32, 0.86, 0.72, 'rise', 0.9, 20, { edge: '#ff6a10', edgeW: 0.1 }), fin('bot', 0.38, 0.86, 0.7, 'rise', 0.9, 18, { edge: '#ff6a10', edgeW: 0.1 })], tail: { edge: '#ff6a10', edgeW: 0.15 }, pel: { col: '#1a1a22', edge: '#ff6a10' } });
// ---- solid creatures (realvox SOLIDS) and eel heads for chain creatures
const solid = (kind, col, o = {}) => ({ plan: 'solid', kind, col, chunk: kind === 'jelly' ? 1.35 : 1.15, ...(kind === 'crab' ? { voxK: 1.2 } : null), ...o });
SPEC_IN.clickcrab = solid('crab', { back: '#e6dccb', flank: '#f0e8da', belly: '#faf6ee', leg: '#ece2d0', claw: '#f2e8d8', tip: '#c87a50', eye: '#141414' }, { stalk: 1.7, eyeR: 0.03, yawBase: 58 });
SPEC_IN.mechacrab = solid('crab', { back: '#e0300e', flank: '#ff5a22', belly: '#ffd2a8', leg: '#e8481a', claw: '#d4260c', tip: '#ffd040', spots: '#ffd040', eye: '#1a1418' }, { stalk: 1.4 });
SPEC_IN.snowcrab = solid('crab', { back: '#e07a3e', flank: '#eea062', belly: '#f8e8d2', leg: '#e88a50', claw: '#da7038', tip: '#3a2a20' }, { legLen: 0.85, wide: 0.42, claw: 0.7, stalk: 0.9 });
SPEC_IN.steamcrab = solid('crab', { back: '#9e3a26', flank: '#c46446', belly: '#f0d8c0', leg: '#b04a30', claw: '#c4462a', tip: '#141010' }, { claw: 1.35, wide: 0.52 });
SPEC_IN.taxicrab = solid('crab', { back: '#e6b424', flank: '#f0c844', belly: '#faf0d0', leg: '#e8bc38', claw: '#e0a820', tip: '#2a2024', spots: '#8a3a6a' }, { wide: 0.55 });
SPEC_IN.glowjelly = solid('jelly', { back: '#d07ac8', flank: '#f0a8e0', belly: '#f8d0f0', gonad: '#ff4aa8' }, { warts: true, glow: true, tentLen: 1.8, tentacles: 8, arms: 4, armLen: 1.2, armR: 0.035, glowColor: '#ff7ad8' });
SPEC_IN.purin = solid('jelly', { back: '#f6e6b0', flank: '#fbf1d4', belly: '#fff8e8', gonad: '#e8b860' }, { knob: '#f09a18', arms: 8, armLen: 0.55, armR: 0.05, armTip: '#6a58d0', tentacles: 12, tentLen: 1.0, bellH: 0.3, shell: 0.24 });
SPEC_IN.dumbo = solid('octopus', { back: '#f09ac4', flank: '#f6b6d6', belly: '#ffdcec', fin: '#f8b0d4', eye: '#2a1420' });
SPEC_IN.vampsquid = solid('squid', { back: '#a01426', flank: '#b42032', belly: '#c83446', fin: '#3a0812', eye: '#3a8aff' }, { photo: '#7affff', armTip: '#120608', glow: true });
SPEC_IN.starfish = solid('star', { back: '#d81e30', flank: '#ea3a4a', belly: '#f8c8b8', spots: '#ff8a70' });
SPEC_IN.isopod = solid('isopod', { back: '#c4b8c6', flank: '#a89cae', belly: '#e8e0e8', eye: '#2a2a24' });
SPEC_IN.seahorse = solid('seahorse', { back: '#c45a0c', flank: '#f08a1c', belly: '#ffc85a', fin: '#ffe6b8', eye: '#c88a20' }, { voxK: 2 });
SPEC_IN.guppy = solid('chomper', { back: '#1478d0', flank: '#38b8ff', belly: '#d8f6ff', fin: '#ff4ab0', dorsal: '#ffd23a', eye: '#e8a838' }, { chunk: 1.3 });

// eels (chain creatures): a realistic head model; the body segments follow the game's path
const eelHead = (o) => ({
  base: 'perch', chainHead: true, L: o.L ?? 22,
  body: { D: 0.4, up: 0.52, at: 0.62, ped: 1, tip: -0.02, fore: 1.7, chin: 1.6, back: 0.01, W: 0.14, pw: 0.14, wTip: 0.05, nose: 0.06, xs: 2, wy: 0.45, ...(o.body || {}) },
  eye: { u: 0.17, v: 0.72, r: 0.055, iris: '#e8c040', ...(o.eye || {}) },
  mouth: { u: 0.36, v: 0.4, drop: -0.02, curve: 0.02, dark: 0.6, ...(o.mouth || {}) },
  op: null, noGill: true, lateral: null, scales: null, pec: o.pec ?? null, pel: null, tail: null,
  fins: o.fins || [], barbels: o.barbels || [], col: o.col, pat: o.pat || [], seg: o.seg, mat: { iri: 0.2, gloss: 0.92, ...(o.mat || {}) },
  wave: 0,
});
SPEC_IN.cableeel = eelHead({ col: C('#0a58d8', '#1a6ef0', '#f8e020', '#f8e020', { vb: 0.5, vbel: 0.38, soft: 0.05 }), eye: { iris: '#f8e020' }, mouth: { lips: '#f8e020' }, fins: [fin('top', 0.55, 1, 0.12, 'long', 0.2, 10, { col: '#f8e020' })], barbels: [{ u: 0.01, v: 0.7, len: 0.16, ang: 50, curl: -0.3, fwd: true, out: 0.25, w: 1, col: '#f8e020', tip: '#f8e020' }], seg: { top: '#0a58d8', side: '#1a6ef0', belly: '#f8e020', fin: '#f8e020' } });
SPEC_IN.noodle = eelHead({ col: C('#8a98b0', '#d8e0ea', '#f4f6fa', '#ff3a3a'), eye: { iris: '#d8d8e0', r: 0.07 }, mouth: { u: 0.14, v: 0.5 }, fins: [fin('top', 0.3, 1, 0.5, 'fall', 0.3, 8, { col: '#ff3030' })], mat: { iri: 0.5, chrome: 0.3 }, seg: { top: '#8a98b0', side: '#dce4ee', belly: '#f4f6fa', fin: '#ff3a3a', pattern: 'dots', col2: '#4a5a78' } });
SPEC_IN.preciouseel = eelHead({ col: C('#2a1a1a', '#3a2622', '#5a3a2e', '#ff4a1a'), eye: { iris: '#ff8a2a' }, mouth: { u: 0.2, v: 0.45 }, body: { tip: 0.0, fore: 1.2 }, pat: [{ type: 'stripes', at: [0.38, 0.72], width: 0.07, color: '#ff4a10', glow: true }], seg: { top: '#2a1a1a', side: '#3a2622', belly: '#6a4434', fin: '#ff4a1a', pattern: 'stripes', col2: '#ff4a10', glow: true } });
SPEC_IN.kingconger = eelHead({ col: C('#e0580e', '#f07818', '#f8b050', '#e05010'), eye: { iris: '#f8d040' }, mouth: { teeth: { n: 6, len: 0.07, col: '#f8f4ec' } }, pat: [{ type: 'spots', color: '#fff8f0', size: 0.05, density: 0.55, seed: 3 }, { type: 'reticulate', color: '#5a1a08', scale: 9, width: 0.05 }], barbels: [{ u: 0.02, v: 0.78, len: 0.14, ang: 70, curl: 0, fwd: true, out: 0.25, w: 1, col: '#5a1a08' }, { u: 0.14, v: 0.92, len: 0.1, ang: 80, curl: 0, out: 0.2, w: 1, col: '#5a1a08' }], seg: { top: '#d8500c', side: '#f07818', belly: '#f8b050', fin: '#e05010', pattern: 'spots', col2: '#fff8f0' } });

export const SPEC = SPEC_IN;

// ---------------------------------------------------------------- species -> anatomy

// Fallback for looks without an explicit spec: pick an archetype from the look's kind / shape and keep its
// colours (natural-ised a little).
const SHAPE_BASE = { oval: 'perch', torpedo: 'salmon', round: 'puffer', disc: 'butterfly', long: 'salmon', box: 'boxfish', blunt: 'grouper', pointy: 'snapper' };
const SOLID_KIND = { crab: 'crab', jelly: 'jelly', pudding: 'jelly', octopus: 'octopus', squid: 'squid', star: 'star', isopod: 'isopod', seahorse: 'seahorse', chomper: 'chomper' };
const FISH_KIND = { ray: 'manta', blob: 'blobfish', iconfish: 'boxfish' };
function autoReal(look, kind) {
  const col = look.col || look.chain?.col || {};
  const c = { back: col.back || col.body || '#4a6a8a', flank: col.body || '#8aa0b8', belly: col.belly || '#f0f4f8', fin: col.fin || col.body || '#8aa0b8' };
  const k = kind || look.kind;
  if (SOLID_KIND[k]) return { plan: 'solid', kind: SOLID_KIND[k], col: { ...c, leg: c.flank, claw: c.back }, chunk: 1.2 };
  if (k === 'chain') return eelHead({ col: c, seg: { top: c.back, side: c.flank, belly: c.belly, fin: c.fin } });
  const base = FISH_KIND[k] || SHAPE_BASE[look.body?.shape || 'oval'] || 'perch';
  return { base, col: c };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  if (!isObj(a)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
}
function recolor(o, vc, role) {
  if (typeof o === 'string') return o[0] === '#' ? vc(o, role) : o;
  if (Array.isArray(o)) return o.map((v) => recolor(v, vc, role));
  if (!isObj(o)) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = recolor(v, vc, k === 'eye' ? 'eye' : role);
  return out;
}

/** Resolve a look into its full realistic anatomy spec (variant colours applied), or null. */
export function resolveReal(look, vc = (h) => h, kind = null) {
  let spec = look.real || null;
  if (!spec) spec = autoReal(look, kind);
  if (!spec) return null;
  const base = spec.base ? A[spec.base] || A.perch : {};
  let m = merge(base, spec);
  m = recolor(m, vc, 'body');
  m.plan = m.plan || 'fish';
  return m;
}
