// Small hand-authored sprites: the hook and special baits.

import { spriteFromAscii } from '../gfx/pixel.js';

const P = {
  k: '#14131c', d: '#5d6677', m: '#9aa6b8', l: '#d8e2ee', w: '#ffffff',
  r: '#e04a5a', R: '#ff8a9a', p: '#ff9ad0', P: '#c85a9a',
  g: '#ffd84a', G: '#b8860b', y: '#fff3a8',
  b: '#2a1a3a', v: '#7a4ad8', V: '#c8a8ff',
  c: '#4ac8ff', C: '#bff0ff', B: '#1a6ab8',
  n: '#c8945a', N: '#8a5a2a', s: '#f4e4c4',
  e: '#3a8a4a', E: '#7ad88a', o: '#2a6a3a',
  t: '#d8c8a0', T: '#8a7a5a', a: '#5affc8', A: '#c8fff0',
};

export const HOOK = spriteFromAscii(`
..kkk..
.kmlmk.
.kk.kk.
..kmk..
..kmk..
..kmk..
..kmk..
k.kmk..
kmkmk..
kmlmk..
.kmmk..
..kk...
`, P);

export const BAIT_SPRITES = {
  bread: spriteFromAscii(`
.kkkk.
knNNnk
knssnk
knssnk
.kkkk.
`, P),
  worm: [spriteFromAscii(`
...kk...
..kpPk..
.kpk.kk.
.kPk.kpk
..kpkpPk
...kPpk.
....kk..
`, P), spriteFromAscii(`
..kk....
.kpPk...
.kPk.kk.
..kpkpPk
..kPk.kk
.kpPk...
..kk....
`, P)],
  golden: spriteFromAscii(`
..kkk..
.kygyk.
kygggGk
kgggGGk
kgGGGGk
.kGGGk.
..kkk..
`, P),
  blackhole: spriteFromAscii(`
..kvvk..
.vVbbvk.
kVbkkbvk
vbkkkkbv
vbkkkkbv
kvbkkbVk
.kvbbVv.
..kvvk..
`, P),
  flood: spriteFromAscii(`
...k...
..kck..
.kcCck.
kcCCcck
kcCccBk
kccccBk
.kcBBk.
..kkk..
`, P),
  sugar: spriteFromAscii(`
kkkkk
kwwlk
kwlwk
klwwk
kkkkk
`, P),
  chip: spriteFromAscii(`
.k.k.k.
kkkkkkk
kEeeeEk
kkeoekk
kEeeeEk
kkkkkkk
.k.k.k.
`, P),
  popup: spriteFromAscii(`
kkkkkkkk
kBBBBrwk
kkkkkkkk
kwwwwwwk
kwgggwwk
kwwwwwwk
kkkkkkkk
`, P),
  lantern: spriteFromAscii(`
..kkk..
.kAAAk.
kAaaaAk
kaaAaak
kAaaaAk
.kAAAk.
..kkk..
`, P),
  relic: spriteFromAscii(`
..kkkk..
.kTttTk.
kTtaatTk
kttaAttk
kTtaatTk
.kTttTk.
..kkkk..
`, P),
};

export function baitSprite(type, t = 0) {
  const s = BAIT_SPRITES[type];
  if (Array.isArray(s)) return s[Math.floor(t * 4) % s.length];
  return s || BAIT_SPRITES.bread;
}
