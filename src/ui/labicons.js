// Lab icons: voxel rods, boats, aquarium tanks and ocean globes, voxel buildings / bait (from their own
// modules), and a set of hand-made pixel glyphs for stat nodes. Every icon is cached per (key, size).
//   labIcon(key, px) -> canvas (fits a px x px box) | null
//     key: 'rod:<id>' | 'boat:<id>' | 'tank:<id>' | 'biome:<id>' | 'bait:<id>' | 'bp:<buildingId>' | 'mat:<itemId>' | glyph name
//   labIconCached(key, px) -> canvas | undefined (only when already rendered; cheap)
//   GLYPHS: names of the pixel glyphs (hook, line, star, gear, reel, bolt, battery, eye, music, mouse, heart, ...)
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack, shade, mix } from '../core/color.js';
import { hash3 } from '../core/math.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { ROD_BY_ID } from '../game/rods.js';
import { buildingSprite } from '../build/buildingmodels.js';
import { itemIcon } from '../build/itemdraw.js';
import { baitIcon } from '../fishing/baitart.js';

// ---------------------------------------------------------------- pixel glyphs
const PAL = {
  w: '#ffffff', W: '#dcecf8', s: '#c4d6e6', S: '#8ea8c0', G: '#5a7690', k: '#1c2c44',
  b: '#5cc6ff', B: '#2486e0', a: '#7ef0ff', A: '#18aed0', y: '#ffe45a', Y: '#f2a81e', o: '#ff9d2e', O: '#d0640e',
  r: '#ff5f6e', R: '#c42c4c', p: '#ff9ed2', P: '#e0549c', l: '#d2f76e', e: '#6fd23f', E: '#2c9a2a',
  v: '#bc96ff', V: '#7448c8', n: '#cc9058', N: '#82542e', c: '#fff4c8', m: '#9a6ae0',
};
const GLYPH_ART = {
  hook: ['....kkk....', '...k...k...', '....kkk....', '.....s.....', '.....s.....', '.....s.....', '.....s.....', '.W...s.....',
    '.Ws..s.....', '.W.s.s.....', '..W.sW.....', '...WW......'],
  line: ['.........sw', '........sw.', '.......sw..', '......sw...', '.....sw....', '..ooosw....', '.oyyyoo....', '.oywyo.....',
    '.oyyyo.....', '..ooo......', '...........'],
  star: ['.....w.....', '....wy.....', '....yy.....', 'wwyyyyyyyY.', '.wyyyyyyY..', '..yyyyyyY..', '..yyyyyYY..', '.yyYY.YYY..', '.yY.....YO.'],
  gear: ['....SS....', '.SS.WW.SS.', '.SWWWWWWS.', '..WsSSsW..', 'SWWS..SWWS', 'SWWS..SWWS', '..WsSSsW..', '.SWWWWWWS.', '.SS.WW.SS.', '....SS....'],
  reel: ['...BBBB...', '..BbbbbB..', '.BbwWWbbB.', 'BbwW..WbbB', 'BbW.ss.WbB', 'BbW.ss.WbB', 'BbbW..WbbB', '.BbbWWbbB.', '..BbbbbB..', '...BBBB...'],
  bolt: ['......yyy', '.....yyY.', '....yyY..', '...yyY...', '..yyyyyy.', '.yyyyyyY.', '....yyY..', '...yyY...', '..yyY....', '.yY......', 'yY.......'],
  battery: ['...ss...', '.WWWWWW.', '.WllllW.', '.WllllW.', '.WeeeeW.', '.WeeeeW.', '.WEEEEW.', '.WEEEEW.', '.WEEEEW.', '.WWWWWW.'],
  eye: ['...........', '...WWWWW...', '.WWWbbbWWW.', 'WWWbBkBbWWW', 'WWWbkkkbWWW', 'WWWbBkBbWWW', '.WWWbbbWWW.', '...WWWWW...'],
  music: ['....vvvvv', '....VVVVv', '....v...v', '....v...v', '....v...v', '.vvvv.vvv', 'vvvvvvvvv', 'vvvv.vvvv', '.vv...vv.'],
  mouse: ['...wwwww...', '..wwwWsww..', '.wwwwWswww.', '.wwwwWswww.', '.WWWWWWWWW.', '.wwwwwwwww.', '.wwwwwwwww.', '.wwwwwwwww.', '..wwwwwww..', '...WWWWW...'],
  net: ['k........', '.k.......', '..k......', '...wWwWw.', '...WwWwW.', '...wWwWw.', '...WwWwW.', '....WwW..', '.....W...'],
  heart: ['.pp...pp.', 'pwpp.pppP', 'pwppppppP', 'pppppppPP', '.pppppPP.', '..pppPP..', '...pPP...', '....P....'],
  sparkle: ['....w....', '....w....', '...wyw...', 'wwwyyyww.', '...wyw...', '....w....', '....w..w.', '.......w.', '......www', '.......w.'],
  clock: ['...wwww...', '.wwWWWWww.', 'wwWWkWWWww', 'wWWWkWWWWw', 'wWWWkkkWWw', 'wWWWWWWWWw', 'wwWWWWWWww', '.wwWWWWww.', '...wwww...'],
  box: ['..nnnnnnn..', '.ncccccccN.', 'nnnnnnnnnNN', 'nnnyynnnnNN', 'NNNyyNNNNNN', 'nnnnnnnnnNN', 'nnnnnnnnnNN', 'NNNNNNNNNN.'],
  magnet: ['rr....rr', 'rr....rr', 'rr....rr', 'rr....rr', 'rR....Rr', 'rRr..rRr', '.rRRRRr.', '..rrrr..', 'ww....ww'],
  sonar: ['.....aa....', '...aa..aa..', '..a..aa..a.', '.a..a..a..a', '.a.a.ww.a.a', '.a.a.ww.a.a', '.a..a..a..a', '..a..aa..a.', '...aa..aa..', '.....aa....'],
  radar: ['........w..', '.......ww..', '...SSSSw...', '..SwwwSS...', '.SwwWSWS...', '.SwWWSWS...', '..SWWWS....', '...SSS.....', '....S......', '..SSSSS....'],
  lantern: ['...kkk...', '..k...k..', '.SSSSSSS.', '.Syyyyws.', '.Syyyyws.', '.SYyyyys.', '.SYYyyys.', '.SSSSSSS.', '..SSSSS..'],
  engine: ['..SSSSS....', '.SWWWWWS.ss', 'SWWbbbWWSsw', 'SWbaaabWSsw', 'SWbaaabWSss', 'SWWbbbWWS..', '.SWWWWWS...', '..SSSSS....'],
  compass: ['...SSSS...', '.SSwwwwSS.', 'SwwwrwwwwS', 'SwwwrrwwwS', 'SwwwrkwwwS', 'SwwwkbwwwS', 'SwwwbwwwwS', '.SSwwwwSS.', '...SSSS...'],
  people: ['..bb...pp..', '.bbbb.pppp.', '.bbbb.pppp.', '..bb...pp..', '.BBBB.PPPP.', 'BBbbBPPppPP', 'BBbbBPPppPP', 'BBBBBPPPPPP'],
  cloud: ['....www....', '..wwwwWw...', '.wwwwwwWww.', 'wwwwwwwwwWw', 'WwwwwwwwwWW', '.WWWWWWWWW.', '..b..b..b..', '.b..b..b...'],
  crown: ['y...y...y', 'yy.yyy.yy', 'yyyyyyyyy', 'yyryyybyy', 'yyyyyyyyY', 'YYYYYYYYY'],
  food: ['....rr...', '...rr....', '.ooooooo.', 'oywoyoyoO', 'oyyoyyyoO', '.ooooooO.', '..OOOOO..'],
  snail: ['.....k..k.', '......k.k.', '..ppp..aa.', '.pPPPp.aa.', 'pPpppPpaa.', 'pPpPpPpaa.', '.pPPPpaaa.', 'aaaaaaaaaa'],
  crab: ['r.......r', 'rr.k.k.rr', '.r.r.r.r.', '..rrrrr..', '.rrwrwrr.', 'rrrrrrrrr', '.R.R.R.R.'],
  egg: ['...www...', '..wwwWw..', '.wwpwwWw.', '.wwwwwWW.', 'wwwwpwwWW', 'wwwwwwWWW', 'Wwwpww WW'.replace(' ', 'W'), '.WWWWWWW.', '..WWWWW..'],
  dna: ['b......r', '.b....r.', '..wwww..', '...br...', '...rb...', '..wwww..', '.r....b.', 'r......b', '.r....b.', '..wwww..'],
  coin: ['...aaaa...', '.aaAAAAaa.', 'aawwAAAAAa', 'aawAAeAAAa', 'aaAAeeAAAa', 'aaAeeAAAAa', 'aaAAAAAAAa', '.aaAAAAaa.', '...aaaa...'],
  clover: ['..ee.ee..', '.eeeeeee.', '.elee eee'.replace(' ', 'e'), '..eeeee..', 'eeeeEeeee', 'eleeEeeee', '.eee.eee.', '....E....', '....E....', '...E.....'],
  horseshoe: ['.yy...yy.', 'yYy...yYy', 'yYy...yYy', 'yYy...yYy', 'yYy...yYy', 'yYYy.yYYy', '.yYYYYYy.', '..yyyyy..'],
  rainbow: ['...rrrrr...', '..rooooor..', '.royyyyyor.', 'roylllllyor', 'oylbbbbblyo', 'ylb.....bly', 'lb.......bl', 'w.........w'],
  wifi: ['..bbbbbbb..', '.b.......b.', 'b..bbbbb..b', '..b.....b..', '.b..bbb..b.', '...b...b...', '.....w.....', '....www....'],
  beaker: ['..WWWWW..', '...W.W...', '...W.W...', '...W.W...', '..WaaaW..', '.WaawaaW.', 'WaaaaawaW', 'WaAaaaaaW', '.WWWWWWW.'],
  moon: ['...yyy...', '..yyy....', '.yyy.....', '.yyy...w.', '.yyy.....', '.yyyy....', '..yyyyyY.', '...yyYY..'],
  decor: ['....p....', '...ppp...', '..ppppp..', '....e....', '.e..e..e.', '.ee.e.ee.', '..eeeee..', '.nnnnnnn.', 'nnnnnnnnN'],
  hammer: ['.SSSSS...', 'SWWWWWS..', 'SSSSSSS..', '...nn....', '...nn....', '...nn....', '...nn....', '...nN....', '...NN....'],
  globe: ['...bbbb...', '.bbeebbbb.', 'bbeeeebbbb', 'bbbeebbeeb', 'bbbbbbeeeb', 'beebbbbeeb', 'beeebbbbbb', '.beebbbbb.', '...bbbb...'],
  bubble: ['...aaa...', '.aa...aa.', 'a.w.....a', 'a.w.....a', 'a.......a', 'a.......a', '.aa...aa.', '...aaa...'],
  fish: ['.....ww....', '...wwbbw..w', '.wwbbbbbw.ww', 'wbkbbbbbbwbw', 'wbbbbbbbbbbw', '.wbbBbbbBw.w', '...wBBBBw..w', '.....ww....'],
  trophy: ['yyyyyyyyy', 'yYyyyyyYy', '.yyyyyyy.', '..yyyyy..', '...yyy...', '....y....', '...yyy...', '..YYYYY..'],
};
export const GLYPHS = Object.keys(GLYPH_ART);

function glyphCanvas(name) {
  const rows = GLYPH_ART[name];
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const b = new PixelBuffer(w + 2, h + 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
    const c = PAL[rows[y][x]];
    if (c) b.set(x + 1, y + 1, pack(c));
  }
  b.outline(selOut(0.8));
  return b.toCanvas();
}

// ---------------------------------------------------------------- voxel icons
function rodModel(rod) {
  const L = rod.look || {};
  const m = new VoxelModel(22, 22, 5);
  const shaft = m.color(L.shaft || '#c8a070', { jitter: 0.05, emissive: L.glow ? 0.15 : 0 });
  const grip = m.color(L.grip || '#6a4a2a', { jitter: 0.08 });
  const reel = m.color(L.reel || '#c8c8c8', { jitter: 0.04 });
  const tip = m.color(L.tip || '#ffffff', { emissive: L.glow ? 0.6 : 0 });
  const line = m.color('#ffffff', {});
  const hook = m.color('#b8c8d8', {});
  m.line(2, 2, 2, 19, 19, 2, shaft, 0.55);
  m.line(1, 1, 2, 6, 6, 2, grip, 1.1);
  m.cylinder(8, 5, 1, 3, 2.2, reel, 'z');
  m.set(8, 5, 4, grip);
  if (L.kind === 'wand') { m.sphere(19, 19, 2, 1.8, tip); }
  else if (L.kind === 'crystal') { m.ellipsoid(19, 19, 2, 1.4, 2.6, 1.4, tip); }
  else if (L.kind === 'trident') {
    m.line(17, 19, 2, 17, 21, 2, tip, 0.4); m.line(19, 17, 2, 21, 17, 2, tip, 0.4); m.line(19, 19, 2, 21, 21, 2, tip, 0.5);
  } else if (L.kind === 'coil') {
    for (let i = 6; i < 19; i += 3) m.sphere(i, i, 2, 1.1, tip);
  } else m.set(19, 19, 2, tip);
  // line + hook dangling from the tip
  m.line(20, 18, 3, 20, 7, 3, line, 0);
  m.line(20, 7, 3, 20, 5, 3, hook, 0); m.set(19, 5, 3, hook); m.set(18, 6, 3, hook);
  return { m, yaw: 8, pitch: 12 };
}

function boatModel(id) {
  const m = new VoxelModel(30, 22, 14);
  const white = m.color('#f4fbff', { jitter: 0.03 }), blue = m.color('#2486e0', { jitter: 0.04 }), aqua = m.color('#5cd6ff', { jitter: 0.04 });
  const wood = m.color('#c89058', { jitter: 0.1 }), woodD = m.color('#8a5a30', { jitter: 0.1 }), glass = m.color('#9eeaff', { emissive: 0.3 });
  const red = m.color('#ff5a6a', {}), yellow = m.color('#ffd23a', { jitter: 0.04 }), grey = m.color('#9aaabb', {}), green = m.color('#7ed957', {});
  const zc = 7;
  // generic hull: tapered at the bow (+x), keel depth d, beam b
  const hull = (x0, x1, y0, y1, beam, c, cTop) => {
    for (let x = x0; x <= x1; x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      const bw = beam * (u > 0.7 ? 1 - (u - 0.7) / 0.3 * 0.75 : u < 0.08 ? 0.85 : 1);
      const yb = y0 + Math.round((u > 0.75 ? (u - 0.75) * 10 : 0));
      for (let y = yb; y <= y1; y++) {
        const t = (y - y0) / Math.max(1, y1 - y0);
        const w = Math.max(0.6, bw * (0.55 + 0.45 * Math.sqrt(t)));
        for (let z = 0; z < 14; z++) if (Math.abs(z - zc) <= w) m.set(x, y, z, y === y1 ? cTop : c);
      }
    }
  };
  if (id === 'raft') {
    for (let i = 0; i < 4; i++) m.cylinder(zc - 4.5 + i * 3, 3, 4, 25, 1.5, i % 2 ? wood : woodD, 'x');
    m.line(14, 4, zc, 14, 17, zc, woodD, 0.5);
    for (let y = 8; y < 17; y++) for (let x = 15; x < 15 + Math.round((17 - y) * 0.8); x++) m.set(x, y, zc, white);
    m.set(14, 18, zc, red);
  } else if (id === 'dinghy') {
    hull(5, 24, 2, 7, 4, white, wood);
    for (let x = 6; x < 22; x++) m.set(x, 6, zc + 4, blue);
    m.line(10, 9, 1, 18, 7, 13, woodD, 0.4);
  } else if (id === 'skiff') {
    hull(3, 26, 2, 7, 4, blue, white);
    for (let x = 4; x < 24; x++) m.set(x, 5, zc + 4, white);
    m.box(9, 8, zc - 2, 12, 10, zc + 2, glass);
    m.box(1, 5, zc - 1, 3, 10, zc + 1, grey);
  } else if (id === 'hydrofoil') {
    hull(4, 26, 7, 11, 4, white, aqua);
    m.box(10, 12, zc - 2, 18, 14, zc + 2, glass);
    m.box(11, 15, zc - 1, 16, 15, zc + 1, white);
    for (const x of [8, 22]) { m.line(x, 2, zc - 3, x, 7, zc - 3, grey, 0.4); m.line(x, 2, zc + 3, x, 7, zc + 3, grey, 0.4); m.box(x - 2, 2, zc - 4, x + 2, 2, zc + 4, blue); }
  } else if (id === 'yacht') {
    hull(2, 27, 2, 8, 5, white, white);
    for (let x = 3; x < 25; x++) m.set(x, 5, zc + 5, blue);
    m.box(8, 9, zc - 3, 21, 12, zc + 3, white);
    m.box(9, 10, zc - 3, 20, 11, zc + 3, glass);
    m.box(11, 13, zc - 2, 18, 15, zc + 2, white);
    m.box(12, 14, zc - 2, 17, 14, zc + 2, glass);
    m.line(15, 15, zc, 15, 19, zc, grey, 0.3);
  } else if (id === 'catamaran') {
    hull(3, 26, 2, 6, 2, white, aqua);
    for (let x = 3; x <= 26; x++) for (let y = 2; y <= 6; y++) for (let z = 0; z < 14; z++) {
      const v = m.get(x, y, z);
      if (v) { m.set(x, y, z, 0); m.set(x, y, Math.max(0, z - 4), v); m.set(x, y, Math.min(13, z + 4), v); }
    }
    m.box(6, 7, 2, 23, 7, 12, white);
    m.line(14, 7, zc, 14, 21, zc, grey, 0.4);
    for (let y = 9; y < 21; y++) for (let x = 15; x < 15 + Math.round((21 - y) * 0.7); x++) m.set(x, y, zc, (y + x) % 5 === 0 ? aqua : white);
  } else if (id === 'submarine') {
    m.ellipsoid(15, 8, zc, 12, 5, 4.5, yellow);
    m.box(12, 12, zc - 2, 17, 16, zc + 2, yellow);
    m.line(15, 16, zc, 15, 19, zc, grey, 0.4); m.box(15, 19, zc, 17, 19, zc, grey);
    for (const x of [9, 15, 21]) m.cylinder(x, 8, zc + 3, zc + 5, 1.6, glass, 'z');
    m.box(1, 6, zc - 3, 3, 10, zc + 3, grey);
    m.box(2, 12, zc, 4, 13, zc, yellow);
  } else hull(4, 25, 2, 7, 4, white, wood);
  void green;
  return { m, yaw: 22, pitch: 16 };
}

function tankModel(id) {
  const m = new VoxelModel(28, 24, 12);
  const water = m.color('#4ac8f4', { jitter: 0.06 }), waterD = m.color('#2a96d8', { jitter: 0.05 }), rim = m.color('#f4fbff', { jitter: 0.02 });
  const frame = m.color('#c8dcec', {}), sand = m.color('#f2dc9a', { jitter: 0.12 }), fish = m.color('#ff8a2a', {}), fishT = m.color('#ffc04a', {});
  const plant = m.color('#5ccf4a', { jitter: 0.1 }), coralP = m.color('#ff74b4', {}), coralY = m.color('#ffd23a', {}), cork = m.color('#c89058', { jitter: 0.1 }), glass = m.color('#bff2ff', { emissive: 0.15 });
  const fishAt = (x, y, z) => { m.box(x, y, z, x + 2, y + 1, z, fish); m.set(x - 1, y, z, fishT); m.set(x - 1, y + 1, z, fishT); m.set(x + 2, y + 1, z, m.color('#1c2c44', {})); };
  if (id === 'jar' || id === 'bowl') {
    const r = id === 'jar' ? 6 : 8.5, cy = id === 'jar' ? 10 : 10;
    if (id === 'jar') { m.cylinder(14, 6, 2, 17, r, water, 'y'); m.cylinder(14, 6, 18, 19, r - 1, rim, 'y'); m.cylinder(14, 6, 20, 21, r - 1.5, cork, 'y'); m.cylinder(14, 6, 2, 3, r, sand, 'y'); }
    else { m.sphere(14, cy, 6, r, water); m.sub(() => m.box(0, 16, 0, 27, 23, 11, 1)); m.cylinder(14, 6, 15, 15, r - 2.5, rim, 'y'); m.paint(() => m.box(0, 0, 0, 27, 3, 11, sand)); }
    fishAt(12, 9, 11);
    m.paint(() => { for (let y = 2; y < 18; y++) m.set(8, y, 11, glass); });
  } else {
    const W = id === 'smalltank' ? [6, 21] : id === 'wallaquarium' ? [0, 27] : [2, 25];
    const H = id === 'smalltank' ? [3, 15] : id === 'wallaquarium' ? [3, 17] : [3, 17];
    m.box(W[0], H[0], 1, W[1], H[1], 10, water);
    m.box(W[0], H[0], 1, W[1], H[0] + 1, 10, sand);
    m.paint(() => { for (let x = W[0]; x <= W[1]; x++) m.set(x, H[1], 10, waterD); });
    // frame edges
    for (const y of [H[0] - 1, H[1] + 1]) m.box(W[0] - 1, y, 0, W[1] + 1, y, 11, id === 'wallaquarium' ? frame : rim);
    for (const x of [W[0] - 1, W[1] + 1]) m.box(x, H[0] - 1, 0, x, H[1] + 1, 0, rim), m.box(x, H[0] - 1, 11, x, H[1] + 1, 11, rim);
    // plants / coral
    const n = id === 'smalltank' ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const x = W[0] + 2 + Math.round((i + 0.5) * (W[1] - W[0] - 3) / n);
      const c = id === 'reeftank' ? [coralP, coralY, plant][i % 3] : plant;
      const hgt = 4 + ((i * 7) % 4);
      m.line(x, H[0] + 2, 10, x + (i % 2 ? 1 : -1), H[0] + 2 + hgt, 10, c, id === 'reeftank' ? 0.9 : 0.4);
    }
    fishAt(Math.round((W[0] + W[1]) / 2) - 1, Math.round((H[0] + H[1]) / 2) + 1, 11);
    if (id !== 'smalltank') fishAt(W[0] + 4, H[1] - 4, 11);
    if (id === 'wallaquarium') m.box(0, 1, 0, 27, 1, 11, frame);
  }
  return { m, yaw: 0, pitch: 14 };
}

const BIOME_PAL = {
  oscean: ['#3fa8ff', '#5ccf4a', '#9be86a', '#ffffff'], shallows: ['#2fd3e8', '#f6dc9a', '#7ed957', '#ffffff'],
  fjord: ['#5aa6e8', '#f4fbff', '#bfe4ff', '#8ea8c0'], junkyard: ['#2a8aa8', '#c07a3a', '#8a9aaa', '#ffd23a'],
  metropolis: ['#3a4ad8', '#a674f4', '#ff6ad0', '#7ef0ff'], volcano: ['#3a4a6a', '#e8452a', '#ffb22a', '#2a2030'], abyss: ['#0c2a5a', '#1a4a8a', '#7ef0ff', '#c8a8ff'],
};
function globeModel(id) {
  const P = BIOME_PAL[id] || BIOME_PAL.oscean;
  const m = new VoxelModel(19, 19, 19);
  const sea = m.color(P[0], { jitter: 0.05 }), land = m.color(P[1], { jitter: 0.08 }), land2 = m.color(P[2], { jitter: 0.08, emissive: id === 'volcano' || id === 'abyss' || id === 'metropolis' ? 0.6 : 0 }), ice = m.color(P[3], { jitter: 0.03 });
  m.sphere(9, 9, 9, 8.6, sea);
  m.paint(() => m.fill((x, y, z) => {
    const n = hash3(x >> 2, y >> 2, z >> 2, id.length * 7) * 0.6 + hash3(x >> 1, y >> 1, z >> 1, id.length) * 0.4;
    if (y >= 16) return ice;
    if (n > 0.66) return land2;
    if (n > 0.5) return land;
    return null;
  }));
  return { m, yaw: 30, pitch: 22 };
}

// ---------------------------------------------------------------- render + cache
const cache = new Map();
function fitVoxel(build, px) {
  const { m, yaw, pitch } = build();
  const one = renderVoxels(m, { scale: 1, yaw, pitch, outline: true, groundAO: false });
  const k = Math.min(px / one.w, px / one.h);
  if (Math.abs(k - 1) < 0.08) return one.canvas;
  return renderVoxels(m, { scale: Math.max(0.3, Math.floor(k * 20) / 20), yaw, pitch, outline: true, groundAO: false }).canvas;
}
function fitCanvas(src, px, upscale = true) {
  if (!src) return null;
  let k = Math.min(px / src.width, px / src.height);
  if (!upscale) k = Math.min(1, k);
  if (k >= 2) k = Math.floor(k);
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = makeCanvas(w, h);
  ctxOf(c).drawImage(src, 0, 0, w, h);
  return c;
}

export function labIconCached(key, px = 18) { return cache.get(key + '|' + Math.max(6, Math.round(px))); }

export function labIcon(key, px = 18) {
  px = Math.max(6, Math.round(px));
  const ck = key + '|' + px;
  if (cache.has(ck)) return cache.get(ck);
  let c = null;
  try {
    const [kind, id] = key.includes(':') ? key.split(':') : [null, key];
    if (kind === 'rod' && ROD_BY_ID[id]) c = fitVoxel(() => rodModel(ROD_BY_ID[id]), px);
    else if (kind === 'boat') c = fitVoxel(() => boatModel(id), px);
    else if (kind === 'tank') c = fitVoxel(() => tankModel(id), px);
    else if (kind === 'biome') c = fitVoxel(() => globeModel(id), px);
    else if (kind === 'bait') c = fitCanvas(baitIcon({ shape: id }, px).canvas, px, false);
    else if (kind === 'bp') {
      const s = buildingSprite(id, { scale: 0.2, force: true });
      if (s) {
        const k = Math.min(px / s.w, px / s.h) * 0.2;
        const b = buildingSprite(id, { scale: Math.max(0.05, Math.round(k * 100) / 100), force: true });
        c = b ? fitCanvas(b.canvas, px, false) : null;
      }
    } else if (kind === 'mat') c = itemIcon(id, px);
    else if (key === 'globe') c = fitVoxel(() => globeModel('oscean'), px);
    else if (GLYPH_ART[key]) {
      const g = glyphCanvas(key);
      const k = Math.max(1, Math.floor(px / Math.max(g.width, g.height)));
      c = k === 1 ? g : fitCanvas(g, Math.max(g.width, g.height) * k, true);
    }
  } catch (e) {
    console.error(e);
    c = null;
  }
  if (!c && GLYPH_ART[key] === undefined && key !== 'beaker') c = labIcon('beaker', px);
  cache.set(ck, c);
  return c;
}

// A little colour swatch of a key, for chips (branch accent / rarity).
export function accentOf(hex, k = 0.25) { return mix(hex, '#ffffff', k); }
export function deepOf(hex, k = -0.45) { return shade(hex, k); }
