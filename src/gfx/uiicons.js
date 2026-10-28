// Small inline UI icons (9-11 px incl. outline), hand-authored as ASCII interiors.
// A 1 px dark selective outline is added automatically around every opaque pixel;
// '_' marks pixels that must stay transparent (no outline), '.' is plain transparent.
// getUiIcon(name) -> cached canvas; registerUiIcons() makes every icon usable in text as {name}.
// Cursors ('cursor', 'cursor_hand', 'cursor_grab', 'cursor_reel') come from getUiIcon too;
// draw them at (mouseX - CURSOR_HOTSPOT[name][0], mouseY - CURSOR_HOTSPOT[name][1]).

import { makeCanvas } from '../core/canvas.js';
import { PixelBuffer } from './pixel.js';
import { pack, unpack, shade, mix, rgbToHex } from '../core/color.js';
import { registerInlineIcon } from './font.js';

const PAL = {
  h: '#ffffff', w: '#fff8ea', l: '#d3dae6', g: '#97a2b8', d: '#5d6781', x: '#2b2940',
  r: '#ee4b3f', R: '#a32a42', p: '#ffa58f',
  y: '#ffd84a', Y: '#e8922a', s: '#fff3b0', O: '#b05a22',
  t: '#a86a3c', T: '#6a3e26', u: '#e2aa6a',
  b: '#4aa8f0', B: '#2c62b8', a: '#b2ecff', c: '#58d0cc', C: '#2a8a9a',
  G: '#66cc54', n: '#2a7a42', e: '#c4f294',
  m: '#a476ea', M: '#5c3a9e', v: '#d8bcff',
  E: '#3d3050', F: '#5f4d74',
  f: '#ff7d6a', D: '#c23e5e', P: '#ffc4b0',
  1: '#245a4b', 2: '#3f8f73', 3: '#6cc79c', 4: '#c2f2d2', 5: '#c97c44',
  k: '#1e1628', z: '#ff9ec8', Z: '#d0507e',
};
// translucent fills (alpha 0-255)
const PAL_A = { q: ['#c8f4ff', 70], Q: ['#e8fcff', 150] };

const OUTLINE = '#1a1224';

const ICONS = {
  coin: [
    '..4433..',
    '.443332.',
    '44322221',
    '432xx321',
    '322xx321',
    '32233211',
    '.222151.',
    '..1111..',
  ],
  coin_big: [
    '..44433..',
    '.4433332.',
    '443222221',
    '4322x3221',
    '432xxx321',
    '3222x3221',
    '322233211',
    '.2211151.',
    '..11111..',
  ],
  heart: [
    '.hpr.rrr.',
    'hpprrrrrr',
    'prrrrrrrR',
    'rrrrrrrRR',
    '.rrrrrRR.',
    '..rrrRR..',
    '...rRR...',
    '....R....',
  ],
  heart_empty: [
    '.FFE.EEE.',
    'FFEEEEEEE',
    'FEEEEEEEE',
    'EEEEEEEEE',
    '.EEEEEEE.',
    '..EEEEE..',
    '...EEE...',
    '....E....',
  ],
  star: [
    '....s....',
    '...ssy...',
    '...syY...',
    'sssyyyyyY',
    '.syyyyyY.',
    '..yyyyY..',
    '..yyyYY..',
    '.yyY_YYO.',
    '.yY...YO.',
  ],
  star_empty: [
    '....F....',
    '...FFE...',
    '...FEE...',
    'FFFEEEEEE',
    '.FEEEEEE.',
    '..EEEEE..',
    '..EEEEE..',
    '.EEE_EEE.',
    '.EE...EE.',
  ],
  lock: [
    '..lll..',
    '.l...g.',
    '.l...g.',
    'ssyyyyY',
    'syyxyyY',
    'yyyxyYY',
    'YYYYYYO',
  ],
  unlock: [
    '..lll..',
    '.l...x.',
    '.l..___',
    '.l.____',
    'ssyyyyY',
    'syyxyyY',
    'yyyxyYY',
    'YYYYYYO',
  ],
  hook: [
    '....lw.',
    '....l.g',
    '.....g.',
    '.....l.',
    '.....l.',
    'w....l.',
    'lg...g.',
    '.lgggd.',
  ],
  line: [
    'uuuuuuuut',
    '.abBabBa.',
    '.bBabBab.',
    '.BabBabB.',
    '.abBabBa.',
    'tttttttTT',
  ],
  reel: [
    '..llg....',
    '.lwaag...',
    'lwabbag..',
    'labxbagdd',
    'lgabbag.u',
    '.lgaag..t',
    '..ggd....',
  ],
  net: [
    '....uuu..',
    '...ua.au.',
    '..u.a.a.u',
    '..ua.a.au',
    '..u.a.a.u',
    '...ua.au.',
    '..tuuuu..',
    '.t.......',
    't........',
  ],
  bait: [
    '.syyyY...',
    'syxyyYY.r',
    'yyyrrYYrr',
    '.YYYYYO.r',
    '..g..g...',
    '.g.gg.g..',
  ],
  worm: [
    '......zz.',
    '.....zzxz',
    '..zz.zZ..',
    '.zZZzzZ..',
    'zZ..ZZ...',
    'Z........',
  ],
  fish: [
    '....CCC...',
    'C..cccccc.',
    'CCcccccxcc',
    'CCcccaaaac',
    'C..caaaa..',
    '....aa....',
  ],
  book: [
    'RRrrrrrr.',
    'Rrrrrrrrw',
    'Rrrrssrrw',
    'Rrrsyysrw',
    'Rrrrsyrrw',
    'Rrrrrrrrw',
    'Rrrrrrrrw',
    'Rwwwwwwww',
    '.lllllll.',
  ],
  map: [
    'sssuuusss',
    'sGGuuurss',
    'sGsuurssr',
    'ssrrr.uss',
    'srsuurGsu',
    'sssuuuGGs',
    'uuuttttuu',
  ],
  shop: [
    'rwrwrwrwr',
    'rwrwrwrwr',
    '.R.R.R.R.',
    '.t.....t.',
    '.t.y.G.t.',
    'uuuuuuuuu',
    'ttttttttT',
    '.T.....T.',
  ],
  tank: [
    'ggggggggg',
    'laaaaaaal',
    'lccYYcccl',
    'lcYYxccbl',
    'lccYccbcl',
    'lnccccncl',
    'lnGcuGncl',
    'luuuuuuul',
    'ddddddddd',
  ],
  coral: [
    '.P...P.P.',
    '.ff.Pf.f.',
    'P.f.f.fD.',
    'ff.fff.f.',
    '.ffDf.fD.',
    '..fffDD..',
    '...fD....',
    '..uuuut..',
  ],
  gear: [
    '...wll...',
    '.w.lll.g.',
    '.wlllllg.',
    'wlll.lggd',
    'lll...ggd',
    'llgg.gggd',
    '.lggggdd.',
    '.g.gdd.d.',
    '...ddd...',
  ],
  music: [
    '...MMMMMM',
    '...mmmmmm',
    '...m....m',
    '...m....m',
    '.vvm..vvm',
    'mmmm.mmmm',
    '.mm...mm.',
  ],
  sound: [
    '...l...a.',
    '..ll.a..a',
    'wlll..a.a',
    'lggl..a.a',
    '..gd.a..a',
    '...d...a.',
  ],
  mute: [
    '...l.....',
    '..ll.r.r.',
    'wlll..r..',
    'lggl.r.r.',
    '..gd.....',
    '...d.....',
  ],
  check: [
    '.......eG',
    '......eGn',
    'e....eGn.',
    'GG..eGn..',
    '.GGeGn...',
    '..GGn....',
    '...n.....',
  ],
  cross: [
    'pr...pr',
    'rrr.rrR',
    '.rrrrR.',
    '..rrR..',
    '.rrRRR.',
    'rrR.RRR',
    'rR...RR',
  ],
  arrow_r: [
    '.....w...',
    '.....ll..',
    'wwwwwlll.',
    'lllllllll',
    'gggggggd.',
    '.....gd..',
    '.....d...',
  ],
  arrow_l: [
    '...w.....',
    '..wl.....',
    '.wllwwwww',
    'lllllllll',
    '.dggggggg',
    '..dg.....',
    '...d.....',
  ],
  arrow_u: [
    '...w...',
    '..wlg..',
    '.wllgd.',
    'wwllgdd',
    '..wlg..',
    '..wlg..',
    '..wlg..',
    '..wlg..',
    '..lgd..',
  ],
  arrow_d: [
    '..wlg..',
    '..wlg..',
    '..wlg..',
    '..wlg..',
    '..wlg..',
    'wwllgdd',
    '.lllgd.',
    '..lgd..',
    '...d...',
  ],
  mouse_l: [
    'sy.lg',
    'yY.lg',
    'yY.gg',
    '.....',
    'wllgg',
    'lllgg',
    'llggd',
    '.lgd.',
  ],
  mouse_r: [
    'wl.sy',
    'wl.yY',
    'll.YY',
    '.....',
    'wllgg',
    'lllgg',
    'llggd',
    '.lgd.',
  ],
  mouse_hold: [
    '.Y..pr.lg',
    '.Y..rR.lg',
    'YYY.RR.gg',
    '.Y.......',
    '....wllgg',
    '....lllgg',
    '....llggd',
    '.....lgd.',
  ],
  clock: [
    '..yyyyy..',
    '.yswwwwY.',
    'yswwxwwwY',
    'ywwwxwwlY',
    'ywwwxxwlY',
    'ywwwwwwlY',
    'ywwwwwllY',
    '.YllllgY.',
    '..YYYYO..',
  ],
  sun: [
    '....s....',
    '.s.....Y.',
    '...ssy...',
    '..ssyyY..',
    's.syyyY.Y',
    '..syyYY..',
    '...yYY...',
    '.Y.....Y.',
    '....Y....',
  ],
  moon: [
    '..ssy...',
    '.ssy....',
    'ssyy....',
    'syy.....',
    'syy.....',
    'syyY....',
    '.yyYY..Y',
    '..yYYYY.',
  ],
  cloud: [
    '..www....',
    '.hwwwlw..',
    'hwwwwwwll',
    'lllllllgg',
    '.ggggggg.',
  ],
  rain: [
    '..www....',
    '.hwwwlw..',
    'hwwwwwwll',
    '.ggggggg.',
    '.........',
    '.a..a..a.',
    'b..b..b..',
  ],
  storm: [
    '..ggg....',
    '.glgggd..',
    'glgggdddd',
    '.dddyddd.',
    '...yy....',
    '....sy...',
    '....y....',
  ],
  eye: [
    '...lll...',
    '.llwwwll.',
    'lwwbbBwwl',
    'lwwBxhwwg',
    '.ggwBBgg.',
    '...ggg...',
  ],
  sparkle: [
    '...s...',
    '...y...',
    '..sys..',
    'syyhyyY',
    '..yyY..',
    '...Y...',
    '...Y...',
  ],
  crown: [
    'y...s...y',
    'yy.syY.yY',
    'ysyyyyyyY',
    'yyrybyryY',
    'yyyyyyyYY',
    'YYYYYYYYO',
  ],
  food: [
    '.y..u..',
    '...Y..y',
    'lllllll',
    'rrrrrrR',
    'rwwwwrR',
    'rwbbwrR',
    'rwwwwrR',
    'RRRRRRR',
  ],
  bubble: [
    '..aaaa..',
    '.ahQqqa.',
    'ahQqqqqa',
    'aQqqqqqa',
    'aqqqqqqa',
    'aqqqqqwa',
    '.aqqqwa.',
    '..aaaa..',
  ],
  skull: [
    '..hwww..',
    '.hwwwwl.',
    'hwwwwwll',
    'wxxwxxll',
    'wxxwxxlg',
    '.wwlwlg.',
    '..wlwg..',
    '..l_g...',
  ],
  trophy: [
    '.ssyyyyY.',
    'y.syyyY.Y',
    'y.syyyY.Y',
    '.yyyyyYY.',
    '..yyyYY..',
    '...yYO...',
    '....Y....',
    '..yyYYY..',
    '..YYYYO..',
  ],
  pause: [
    'wlg.wlg',
    'wlg.wlg',
    'wlg.wlg',
    'wlg.wlg',
    'wlg.wlg',
    'wlg.wlg',
    'lgd.lgd',
  ],
  play: [
    'w......',
    'wll....',
    'wllll..',
    'wllllgg',
    'lllgg..',
    'lgg....',
    'g......',
  ],
  minimize: [
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    'wwwwwww',
    'ggggggg',
  ],
  expand: [
    'bbbbbbb',
    'BBBBBBB',
    'l_____g',
    'l_____g',
    'l_____g',
    'l_____g',
    'lgggggg',
  ],
  trash: [
    '..lll..',
    'wllllgg',
    '.......',
    '.wlglg.',
    '.wlglg.',
    '.wlglg.',
    '.wlglg.',
    '..lgg..',
  ],
  home: [
    '....p....',
    '...prr...',
    '..prrrR..',
    '.prrrrRR.',
    'RRRRRRRRR',
    '.wwwwwll.',
    '.wbwtwll.',
    '.wwwtwll.',
  ],
  plus: [
    '..eG...',
    '..eGn..',
    'eeeGGGn',
    'GGGGGGn',
    'nnnGnnn',
    '..GGn..',
    '..nnn..',
  ],
  minus: [
    'eeeeeee',
    'GGGGGGG',
    'nnnnnnn',
  ],
  info: [
    '..abbbb..',
    '.abbwbbB.',
    'abbbbbbbB',
    'abbwwbbbB',
    'bbbbwbbbB',
    'bbbbwbbBB',
    'bbbwwwbBB',
    '.bBBBBBB.',
    '..BBBBB..',
  ],
  camera: [
    '.dd.ggg..',
    'wwwwwwwrl',
    'wllxxxlll',
    'llxabxlgg',
    'llxbBxlgg',
    'lllxxxlgg',
    'ggggggggd',
  ],

  // ---- speech-bubble emotes
  zzz: [
    '.....waa.',
    '......a..',
    '.....waa.',
    'wwbbb....',
    '...b.....',
    '..b......',
    '.b.......',
    'bbbbB....',
  ],
  anger: [
    '..p...p..',
    '..r...r..',
    'prr...rrR',
    '.........',
    '.........',
    '.........',
    'prr...rRR',
    '..r...R..',
    '..R...R..',
  ],
  sweat: [
    '...a...',
    '..aab..',
    '..abb..',
    '.aabbb.',
    '.hbbbB.',
    'ahbbbbB',
    'abbbbbB',
    '.bbbBB.',
    '..BBB..',
  ],
  question: [
    '.ssyyY.',
    'sy...YY',
    '.....YY',
    '...yYY.',
    '..yY...',
    '..yY...',
    '.......',
    '..yY...',
    '..YO...',
  ],
  exclaim: [
    'prrR',
    'prrR',
    '.rR.',
    '.rR.',
    '.rR.',
    '.RR.',
    '....',
    '.rR.',
    '.RR.',
  ],
  dollar: [
    '...e...',
    '.eeGGG.',
    'eG.e...',
    '.eGGG..',
    '...GGn.',
    '...G.Gn',
    '.GGGGn.',
    '...n...',
  ],
};

// Mouse cursors: explicit outlines so the hotspot pixel is exact (see CURSOR_HOTSPOT).
const CURSORS = {
  cursor: [
    'k..........',
    'kk.........',
    'khk........',
    'khwk.......',
    'khwwk......',
    'khwwwk.....',
    'khwwwwk....',
    'khwwwwwk...',
    'khwwwwwlk..',
    'khwwwwllck.',
    'khwwwlkkkkk',
    'khwlkwlk...',
    'khlkkwlk...',
    'kkk..kwlk..',
    'k....kwck..',
    '......kk...',
  ],
  cursor_hand: [
    '...kk.........',
    '..khwk........',
    '..khwk........',
    '..khwk........',
    '..khwkkk......',
    '..khwkhwkkk...',
    '..khwkhwkhwkk.',
    'kkkhwkhwkhwkwk',
    'khkhwwwwwwwwwk',
    'khwkhwwwwwwwlk',
    '.khwwwwwwwwwlk',
    '..khwwwwwwwllk',
    '...khwwwwwwlk.',
    '....khwwwwllk.',
    '....kkkkkkkk..',
  ],
  cursor_grab: [
    '...kk.kk.kk..',
    '..khwkhwkhwk.',
    '..khwkhwkhwkk',
    '.kkhwwwwwwwwk',
    'khkhwwwwwwwlk',
    'khwwwwwwwwwlk',
    '.khwwwwwwwllk',
    '..khwwwwwwlk.',
    '...khwwwwllk.',
    '...kkkkkkkk..',
  ],
};
export const CURSOR_HOTSPOT = { cursor: [0, 0], cursor_hand: [3, 0], cursor_grab: [6, 4], cursor_reel: [6, 6] };

const pkCache = new Map();
function pk(hex, a = 255) {
  const k = hex + a;
  let v = pkCache.get(k);
  if (v === undefined) pkCache.set(k, (v = pack(hex, a)));
  return v;
}

const outCache = new Map();
function outlineFn(n) {
  let c = outCache.get(n);
  if (c === undefined) {
    const [r, g, b] = unpack(n);
    c = pk(mix(shade(rgbToHex(r, g, b), -0.85), OUTLINE, 0.55));
    outCache.set(n, c);
  }
  return c;
}

function build(rows, auto = true) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const m = auto ? 1 : 0;
  const buf = new PixelBuffer(w + 2 * m, h + 2 * m);
  const keep = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      if (ch === '_') { keep.push([x + m, y + m]); continue; }
      if (PAL_A[ch]) buf.set(x + m, y + m, pk(PAL_A[ch][0], PAL_A[ch][1]));
      else if (PAL[ch]) buf.set(x + m, y + m, pk(PAL[ch]));
    }
  }
  if (auto) buf.outline(outlineFn);
  for (const [x, y] of keep) buf.set(x, y, 0);
  return buf.toCanvas();
}

// Fight cursor: a little front-view fishing reel (spool of blue line, crank with a red knob).
function buildReelCursor() {
  const S = 13, c = 6.5;
  const buf = new PixelBuffer(S, S);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
      if (d > 5.4) continue;
      const lit = d > 0 ? (-dx - dy) / (d * 1.414) : 0;
      let ch;
      if (d > 4.1) ch = lit > 0.45 ? 'w' : lit > -0.1 ? 'l' : lit > -0.6 ? 'g' : 'd';
      else if (d > 1.9) ch = lit > 0.55 && d > 2.6 ? 'a' : (Math.floor(d * 1.7) % 2 ? 'b' : 'B');
      else ch = d < 0.8 ? 'x' : 'l';
      buf.set(x, y, pk(PAL[ch] || PAL_A.q[0]));
    }
  }
  buf.line(7, 6, 9, 4, pk(PAL.g));
  buf.fillCircle(10.5, 3.5, 1.5, pk(PAL.r));
  buf.set(10, 3, pk(PAL.p));
  buf.set(11, 4, pk(PAL.R));
  buf.outline(outlineFn);
  return buf.toCanvas();
}

const cache = new Map();
export const UI_ICON_NAMES = Object.keys(ICONS);
export const CURSOR_NAMES = [...Object.keys(CURSORS), 'cursor_reel'];

export function getUiIcon(name) {
  let c = cache.get(name);
  if (!c) {
    if (ICONS[name]) c = build(ICONS[name]);
    else if (CURSORS[name]) c = build(CURSORS[name], false);
    else if (name === 'cursor_reel') c = buildReelCursor();
    else c = makeCanvas(9, 9);
    cache.set(name, c);
  }
  return c;
}

let registered = false;
export function registerUiIcons() {
  if (registered) return;
  registered = true;
  for (const name of UI_ICON_NAMES) registerInlineIcon(name, getUiIcon(name));
}
