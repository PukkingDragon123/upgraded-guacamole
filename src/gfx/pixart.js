// [pixicons26] Hand-drawn pixel maps for every UI icon (rendered by src/gfx/pixicons.js, which adds the 1 px selective
// outline, the drop shadow and integer scaling). Rows are drawn WITHOUT the outer outline: 18 x 18 for objects
// (20 x 20 final), 10 x 10 for glyphs (12 x 12 final), `<name>_s` = a small twin used when the big one would be
// shown below 2 device px per art pixel. Light from the top-left; every material is a 4-step hue-shifted ramp
// (shadows drift purple / blue, highlights warm) plus a few hand-placed white glints. '.' = empty, '_' = empty and
// never outlined, 'k' = ink line inside the art.
//   PAL       shared palette (per-sprite `pal` overrides add or replace chars)
//   SPRITES   {name: {rows, pal?, spin?, ol?} | {base, map?, pal?, rot?, flip?}}
//   ALIAS     {name: sprite name}
//   FAMILY    {prefix: (rest) -> def}   parametric sprites (rods, rarity gems, cut gems, globes, reels...)

import { ramp, mix } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { itemPixel } from '../build/itempix.js'; // the hand-drawn 24 x 24 material / sample art

export const PAL = {
  k: '#170e22', K: '#33264a', w: '#ffffff',
  1: '#2d3350', 2: '#56618a', 3: '#8b9bc0', 4: '#c3d1ea', 5: '#eef5ff',
  B: '#47241f', b: '#7d432b', n: '#b4703a', N: '#e3a35c', m: '#f9dba0',
  R: '#5e1336', r: '#b42a46', e: '#ee5550', E: '#ff9f86',
  O: '#7a2a1e', o: '#dc6228', p: '#ffa13e', P: '#ffd890',
  Y: '#7f431a', y: '#d48a22', g: '#ffcb3a', G: '#fff3a8',
  F: '#123a3e', f: '#23784a', v: '#52b848', V: '#ade86a',
  T: '#0d3d5c', t: '#1888a8', q: '#3fd0dc', Q: '#b6f7ef',
  D: '#1a2266', d: '#2a5bd0', c: '#4aa2f6', C: '#b2deff',
  U: '#2e165c', u: '#6638c0', x: '#a070f2', X: '#ddc4ff',
  H: '#63143f', h: '#cc4078', j: '#ff7ca8', J: '#ffc8dc',
  Z: '#7a5236', z: '#cfa676', s: '#f1deb2', S: '#fff8e6',
  // Bubbles the toy grouper: spots, back, flank, belly; lips mid / light
  L: '#2c1d0c', l: '#6b5424', i: '#b8893a', I: '#f3dc9c', M: '#e9805e', A: '#ffbe98',
  // translucent glass / water
  '~': '#c8f2ff59', '^': '#ffffffc0', '*': '#3ab0f0a8', '+': '#8ee0ffb0',
};

// grouper colours as their own little ramp names for readability in fish rows
const S = {};

// ================================================================ menu / hotbar objects (18 x 18 rows)
S.lab = { rows: [
  '.......mNNn.......',
  '.......NnnB.......',
  '......45555k......',
  '.......5~^3.......',
  '.......5~~3.......',
  '.......5^~3.......',
  '......45~~34......',
  '....445~~~~344....',
  '...45~~~~~~~~34...',
  '..45^VVVVVVVVV34..',
  '..5^VvVvvvvvvvf3..',
  '.45^vvvvwvvvvvf34.',
  '.5VvvvvvvvvvvvvfK.',
  '.5vvvvvvvvvVvvvf3.',
  '.3fvvVvvvvvvvvfF3.',
  '..3fvvvvvvvvvfF3..',
  '...3ffffvvfffF3...',
  '.....33FFFF33.....',
], spin: 'wobble' };

S.quests = { rows: [
  '..zsSSSSSSSSSSsz..',
  '.zsSSSSSSSSSSSSsZ.',
  '.ZzsssssssssssszZ.',
  '..ZzZZZZZZZZZZZZ..',
  '...sSSSSSSSSSSz...',
  '...sSkkkkkkSSSz...',
  '...sSSSSSSSSSSz...',
  '...sSkkkkkSSSsz...',
  '...sSSSSSSSSSsz...',
  '...sSkkkkkkkSsz...',
  '...sSSSSSSSSssz...',
  '...sSkkkkSSSssz...',
  '...sSSSSSSSerrz...',
  '...sSSSSSSSeErr...',
  '..zsssssssreEer...',
  '.zsSSSSSSSSrerR...',
  '.ZzssssssssRrRZ...',
  '..ZZZZZZZZZZRRZ...',
], spin: 'wobble' };

// a grouper (Bubbles' species) on its own: chunky head, big lips, spotted olive-gold flank, spiny dorsal
S.grouper_s = { rows: [
  '....g.g...',
  '..ylllll..',
  'gylLiiiwl.',
  'yYiiiLikiA',
  'gyiiiiiiMR',
  'yYIIiLiMAA',
  '..lIIIIil.',
  '....lyl...',
] };

S.aerobuck = { rows: [
  '........Cd........',
  '........cd........',
  '.......Cccd.......',
  '.......Cwcd.......',
  '......CcwcdD......',
  '......Ccwcdd......',
  '.....CcwccddD.....',
  '.....CwcccddD.....',
  '....CCwccccddD....',
  '...CCwcccccdddD...',
  '...CwCccccccddD...',
  '..CCwCcccccccddD..',
  '..CCCccccccccwdD..',
  '..CCccccccccccdD..',
  '..dCccccccccccdD..',
  '...dCcccccccddD...',
  '....ddcccccdDD....',
  '......DDDDDD......',
], spin: 'full' };
S.aerobuck_s = { rows: [
  '....cd....',
  '....cd....',
  '...Ccdd...',
  '...wcdd...',
  '..Cwccdd..',
  '.CwCcccdD.',
  '.CCcccwdD.',
  '.Ccccccdd.',
  '..dcccddD.',
  '...DDDD...',
], spin: 'full' };

S.gem = { rows: [
  '.....QQQQQQQq.....',
  '....QwQQQQQQqq....',
  '...QwQQqQqQqqqt...',
  '..QQQqQqQqQqqqtt..',
  '.QqqqqqqqqqqqqqtT.',
  '.tQQqqqqqqqqqttTT.',
  '..tQQqqqqqqqqtTT..',
  '...tQqqqqqqqtTT...',
  '....tQqqqqqtTT....',
  '.....tQqqqtTT.....',
  '......tQqtTT......',
  '.......tQTT.......',
  '........tT........',
], spin: 'full' };
S.gem_s = { rows: [
  '..QQQQQq..',
  '.QwQqQqqt.',
  'QQqqqqqqtT',
  'tQqqqqqtTT',
  '.tQqqqqtT.',
  '..tQqqtT..',
  '...tQtT...',
  '....tT....',
], spin: 'full' };

// fishbowl with Bubbles inside
S.aquarium = { rows: [
  '.....4555554......',
  '....455555554.....',
  '.....3~~~~~3......',
  '...4~^~~~~~~~4....',
  '..4~^^~~~~~~~~4...',
  '.4~^++++++++++~4..',
  '.4^+**YyYy****+4..',
  '4~+**lllll**C**+4.',
  '4~+*lliiiwl*****4.',
  '4~+yliLiikiM****4.',
  '4~+*lIiiiiAA**C*3.',
  '4~+**lIIIiMM****3.',
  '.4+***lyyl******3.',
  '.4+*****V*******3.',
  '..3*v***Vv**f**3..',
  '...3mmmmmmmmmmm3..',
  '....3NNmmmNNmN3...',
  '.....33333333.....',
], spin: 'wobble' };

// glass cube tank on a wooden stand (My Fish)
S.fishmgr = { rows: [
  '.4555555555555554.',
  '.5444444444444443.',
  '.4++++++++++++++3.',
  '.4^*************3.',
  '.4^**YyYy****C**3.',
  '.4^*lllll*******3.',
  '.4**liiiwl*C****3.',
  '.4*yiLiikiM*****3.',
  '.4**lIiiiAA*****3.',
  '.4**.lIIiMM**f**3.',
  '.4*v**lyyl**fv**3.',
  '.4*vf*******fv*v3.',
  '.4mmmmmmmmmmmmmmm.',
  '.3NNmNNmNNmNNmNN3.',
  'nNNNNNNNNNNNNNNNNb',
  'bnnnnnnnnnnnnnnnnB',
  '.Bb............bB.',
  '.BB............BB.',
], spin: 'wobble' };

// FishDex: blue book with a gold grouper emblem
S.journal = { rows: [
  '..dCCCCCCCCCCCCc..',
  '.DdccccccccccccdS.',
  '.DdcccccccccccdSS.',
  '.Ddcc.gGgGg.ccdSs.',
  '.Ddc.yggggggy.dSs.',
  '.Ddcygg.ggwgg.dSs.',
  '.DdcyggggggkgGdSs.',
  '.DdcygggggggGGdSs.',
  '.Ddc.yggggggg.dSs.',
  '.Ddcc.yyyy.cccdSs.',
  '.Ddcccccccccccdss.',
  '.Ddc.GGGGGGG.cdss.',
  '.Ddcccccccccccdss.',
  '.DdcccccccccccdsZ.',
  '.DdddddddddddddZ..',
  '.DDDDDDDDDDDDDD...',
  '..............r...',
  '..............R...',
], spin: 'wobble' };

// leather satchel with a buckle and a fish tail poking out
S.inventory = { rows: [
  '......BbbbbB......',
  '.....b......b.....',
  '....b........b....',
  '....b...ppo..b....',
  '..nNNNNNNpONNNn...',
  '.nNmmmmmmmmmmmNn..',
  '.nNmNNNNNNNNNNmnb.',
  '.NNNNNNNNNNNNNNnb.',
  '.Nnn.zzzzzzzz.nnb.',
  '.Nnn..zzzzzz..nnb.',
  '.Nnnn..yGGy..nnnb.',
  '.Nnnnn.gkkg.nnnnb.',
  '.Nnnnnn.yy.nnnnnb.',
  '.Nnnnnnnnnnnnnnnb.',
  '.nnnnnnnnnnnnnnbb.',
  '.bnnnnnnnnnnnnnbB.',
  '..bbbbbbbbbbbbbB..',
  '...BBBBBBBBBBBB...',
], pal: { z: '#f6d8a0' }, spin: 'wobble' };

// striped sailor tee on a hanger
S.wardrobe = { rows: [
  '........34........',
  '.......3..3.......',
  '..........3.......',
  '.........3........',
  '.....nNNNNNNNn....',
  '...nNN.......NNn..',
  '..cCCCCwSSwCCCCc..',
  '.cCCCCCCwwCCCCCCd.',
  'cCCcCCCCeeCCCCcCCd',
  'SSSScSSSeeSSScSSSS',
  'dccc.cccccccc.cccD',
  '.dD..CCCCCCCCd.DD.',
  '.....SSSSSSSSS....',
  '.....cccccccccd...',
  '.....CCCCCCCCCd...',
  '.....SSSSSSSSSs...',
  '.....cccccccccd...',
  '.....ddddddddDD...',
], spin: 'wobble' };

// hammer crossed with a wrench (Workshop)

// desk globe
S.map = { rows: [
  '.......CCcc.......',
  '.....CCvvccdd.....',
  '...4CcVvvcccdd....',
  '..4CwVvvvcccvd....',
  '..4CVvvccccvvdD...',
  '.4.CccccccvvvfD...',
  '.4.ccvccccvvffD...',
  '.4.cvvVvcccvfdD...',
  '.4.cvvvvvccccdD...',
  '..4dcvvvvccccD....',
  '..4.ddcvvvcdD.....',
  '...4.DddddDD......',
  '....44....3.......',
  '......4333........',
  '........4.........',
  '.......444........',
  '.....yggggGy......',
  '.....YyyyyyY......',
], spin: 'full' };

// market stall with a striped awning and goods
S.shop = { rows: [
  '.eEeSSeEeSSeEeSSe.',
  'eEeSSSeEeSSSeEeSSS',
  'rerSSSrerSSSrerSSS',
  'rerSsSrerSsSrerSsS',
  '.r.s..r.s..r.s..s.',
  '..b............b..',
  '..b.CCc.......Nb..',
  '..b.CJc..y....nb..',
  '..b.cjc.ggG.e.nb..',
  '.mmmmmmmmmmmmmmmm.',
  '.NNNNNNNNNNNNNNNn.',
  '.nNnnNnnNnnNnnNnb.',
  '.nnbnnbnnbnnbnnbb.',
  '.nNnnNnnNnnNnnNnb.',
  '.nnbnnbnnbnnbnnbb.',
  '.bnnnnnnnnnnnnnbB.',
  '.bbbbbbbbbbbbbbbB.',
  '..B............B..',
], spin: 'wobble' };

// a wriggly worm on a hook

// two toy groupers puckering up at a little heart

// a chunky cog with a little companion gear
S.settings = { rows: [
  '.......CCc........',
  '...Cc..CCc..Cc....',
  '..CCCcCCCccCCcd...',
  '...CcccccccccdD...',
  '...CccdDDDDcccd...',
  '.CCCcdD....Dccdcd.',
  '.CCccD......dcccd.',
  '..CccD......dccD..',
  '.CCccD......dccdd.',
  '.Cccccd....dcccdD.',
  '...Cccdddddcccd...',
  '...dcccccccccdd...',
  '..CcdddccdddcdDvV.',
  '...dD..dcd..dDvVfV',
  '.......ddD....Vf.f',
  '.............VfvfV',
  '..............fVf.',
  '..................',
], spin: 'full' };

// ---- desktop leftovers
S.mycomputer = { rows: [
  '.4555555555555553.',
  '.5444444444444443.',
  '.54TTTTTTTTTTTT33.',
  '.54TtqQqtttttTT32.',
  '.54TqQtttttttTT32.',
  '.54TtttttqttttT32.',
  '.54TttttttttttT32.',
  '.54TTTTTTTTTTTT32.',
  '.5333333333333332.',
  '.3222222e2v222222.',
  '......3442........',
  '.....344442.......',
  '..4555555555553...',
  '..5444444444443...',
  '..3222222222222...',
], spin: 'wobble' };
S.recycle = { rows: [
  '....455555543.....',
  '..45444444444332..',
  '..33333333333322..',
  '...4545454545432..',
  '...4545454545432..',
  '...45454v4545432..',
  '...4545vVv545432..',
  '...454v5v5v54432..',
  '...45454v4545432..',
  '...4545454545432..',
  '...4545454545432..',
  '....33333333332...',
], spin: 'wobble' };

// ---- chests (Satchel packages, fishing rewards)
S.chest_crate = { rows: [
  '..nNNNNNNNNNNNNn..',
  '.nNmmmmmmmmmmmmNb.',
  '.NmNNNNNNNNNNNNnb.',
  '.NNnnnnnnnnnnnnnb.',
  '.bbbbbbbbbbbbbbbB.',
  '.NNNNNNNmgNNNNNNb.',
  '.NnnnnnnggYnnnnnb.',
  '.nmNNNNNyYNNNNNnb.',
  '.nNnnnnnnnnnnnnnb.',
  '.bbbbbbbbbbbbbbbB.',
  '.NNNNNNNNNNNNNNnb.',
  '.nNnnnnnnnnnnnnnb.',
  '.bbbbbbbbbbbbbbbB.',
  '..BBBBBBBBBBBBBB..',
], spin: 'wobble' };
S.chest_iron = { base: 'chest_crate', map: { m: '5', N: '4', n: '3', b: '2', B: '1', g: 'g', Y: 'Y', y: 'y' } };
S.chest_golden = { rows: [
  '..ygGGGGGGGGGGgy..',
  '.yGNmmmmmmmmmmNgy.',
  '.gNnNNNNNNNNNNngY.',
  '.gnnnnnnnnnnnnngY.',
  '.YyyyyyyyyyyyyyyY.',
  '.gNNNNNNwGNNNNNgY.',
  '.gnnnnnnGgYnnnngY.',
  '.gnNNNNNyYNNNNNgY.',
  '.gnnnnnnnnnnnnngY.',
  '.gnnnnnnnnnnnnngY.',
  '.gNNNNNNNNNNNNNgY.',
  '.gnnnnnnnnnnnnngY.',
  '.YyyyyyyyyyyyyyyY.',
  '..YYYYYYYYYYYYYY..',
], spin: 'wobble' };
S.chest_orb = { rows: [
  '......XXXXxx......',
  '....XXwXXxxxxu....',
  '...XwwXXxxxxxuu...',
  '..XwXXxxxxxjxxuu..',
  '..XXXxxxxxxxxxuU..',
  '.XXxxxxxxJxxxxuuU.',
  '.Xxxxjxxxxxxxxuu U',
  '.xxxxxxxxxxxxuuuU.',
  '.uxxxxxxxxxxxuuUU.',
  '..uxxxxxxxxxuuuU..',
  '..uuxxxxxxxuuuUU..',
  '...UuuuuuuuuuUU...',
  '....yggggggggy....',
  '...YyyyyyyyyyyY...',
], spin: 'full' };

S.check = { rows: [
  '........VV',
  '.......VVv',
  '......VVvf',
  'VV...VVvf.',
  'vVV.VVvf..',
  'fvVVVvf...',
  '.fvVvf....',
  '..fvf.....',
  '...f......',
] };
S.cross = { rows: [
  'Ee......Ee',
  'eEe....eEr',
  '.eEe..eEr.',
  '..eEeeEr..',
  '...eEEr...',
  '...eEer...',
  '..eEreer..',
  '.eEr..err.',
  'eEr....err',
  'er......rR',
] };
S.plus = { rows: [
  '...Vvv....',
  '...Vvf....',
  '...Vvf....',
  'VVVVvvvvv.',
  'Vvvvvvvvf.',
  'fffvvffff.',
  '...vvf....',
  '...vvf....',
  '...ffF....',
] };
S.minus = { rows: [
  'CCCCCCCCc',
  'cccccccdd',
  'dddddddDD',
] };
S.star = { rows: [
  '....Gg....',
  '....Gg....',
  '...GGgy...',
  'GGGGwgggyy',
  '.Gggggggy.',
  '..Gggggy..',
  '..ggggyy..',
  '.ggyy.yyY.',
  '.gy....yY.',
], spin: 'full' };
S.sparkle = { rows: [
  '....w.....',
  '....G.....',
  '...GwG....',
  'GGGwwwGGg.',
  '...GwG....',
  '....G.....',
  '....g...G.',
  '.......GwG',
  '........G.',
], spin: 'full' };
S.heart = { rows: [
  '.EEe.eee..',
  'EwEeeeeer.',
  'EEeeeeeerr',
  'eeeeeeeerr',
  '.eeeeeerr.',
  '..eeeerr..',
  '...eerr...',
  '....rr....',
], spin: 'full' };
S.heart_empty = { base: 'heart', map: { 'e': 'J', 'E': 'j', 'r': 'j', 'w': 'S' }, spin: 'full' };
S.exclaim = { rows: [
  '.Pp.',
  'Pppo',
  'pppo',
  'pppo',
  '.po.',
  '.po.',
  '.oO.',
  '....',
  '.pp.',
  '.oO.',
] };
S.question = { rows: [
  '.Ccccd.',
  'Cc..cdD',
  '....cdD',
  '...cdD.',
  '..cdD..',
  '..cd...',
  '.......',
  '..cd...',
  '..dD...',
] };
S.info = { rows: [
  '...CCcc...',
  '.CCcwwccd.',
  '.Cccwwccd.',
  'Ccccccccdd',
  'Cccwwwccdd',
  'cccdwwcddD',
  'ccccwwcddD',
  '.cccwwddD.',
  '.ddcwwddD.',
  '...dddDD..',
], spin: 'full' };
S.arrow_r = { rows: [
  '.....C....',
  '.....Cc...',
  '.....Ccc..',
  'CCCCCcccc.',
  'Ccccccccdd',
  'dddddcccd.',
  '.....cdd..',
  '.....dD...',
  '.....D....',
] };
S.arrow_l = { base: 'arrow_r', flip: true };
S.arrow_u = { base: 'arrow_r', rot: 3 };
S.arrow_d = { base: 'arrow_r', rot: 1 };
S.play = { rows: [
  'Vv......',
  'Vvv.....',
  'Vvvv....',
  'Vvvvv...',
  'Vvvvvf..',
  'vvvvvff.',
  'vvvvff..',
  'vvvff...',
  'vvff....',
  'fF......',
] };
S.pause = { rows: [
  'Ccd.Ccd',
  'Ccd.Ccd',
  'Ccd.Ccd',
  'ccd.ccd',
  'ccd.ccd',
  'ccd.ccd',
  'cdD.cdD',
  'dDD.dDD',
] };
S.minimize = { rows: [
  'CCCCCCCCc',
  'dddddddDD',
] };
S.dollar = { rows: [
  '...GGgg...',
  '.GGggggyy.',
  '.GggYYggy.',
  'GggYgggyyY',
  'GgggYYgyyY',
  'gggggYgyyY',
  'gggYYggyyY',
  '.gyyYyyyY.',
  '.yyyyyyYY.',
  '...YYYY...',
], spin: 'full' };
S.hook = { rows: [
  '...454.',
  '...5.4.',
  '....4..',
  '....5..',
  '....5..',
  '4...4..',
  '54..4..',
  '.5..3..',
  '.53.3..',
  '..5332.',
] };
S.net = { rows: [
  '...NNnn...',
  '.Nn.5.5nb.',
  'N.5.5.5.b.',
  'N5555555b.',
  'n.5.5.5.b.',
  'n5555555B.',
  '.n.5.5.B..',
  '..nbbbB...',
  '.nb.......',
  'nb........',
] };
S.worm = { rows: [
  '......Jj..',
  '.....Jjjh.',
  '..Jj.jkjh.',
  '.JjjhJjh..',
  'Jjhhjjh...',
  'jh..hh....',
] };
S.coral = { rows: [
  'J..J...J..',
  'j..j..jJ..',
  'jJ.jJ.j...',
  '.jjjhjj...',
  '..jjhj....',
  '...jh.....',
  '...jh.....',
  '..jjhh....',
], spin: 'full' };
S.trash = { rows: [
  '.4555553..',
  '455555532.',
  '.3333332..',
  '.4545432..',
  '.4545432..',
  '.4545432..',
  '.4545432..',
  '..33332...',
] };
S.home = { rows: [
  '....ee....',
  '...eEer...',
  '..eEeeer..',
  '.eEeeeeer.',
  'eEeeeeeerr',
  '.SSSSSSsz.',
  '.SbbSSCcz.',
  '.SbnSSccz.',
  '.SbnSSSsz.',
  '.zbbzzzzZ.',
] };
S.lock = { rows: [
  '..4553..',
  '.45..32.',
  '.4....3.',
  'GGggggyY',
  'GgggggyY',
  'gggkkgyY',
  'ggggkgyY',
  'gggggyyY',
  'yyyyyyYY',
] };
S.unlock = { rows: [
  '.....4553',
  '....45..3',
  '....4....',
  'VVvvvvfF.',
  'VvvvvvfF.',
  'vvvkkvfF.',
  'vvvvkvfF.',
  'vvvvvffF.',
  'fffffffF.',
] };
S.camera = { rows: [
  '.233......',
  '3444444443',
  '343dddd243',
  '34dcCcd243',
  '34dCwcd243',
  '342dcd2242',
  '3442dd4442',
  '2222222221',
] };
S.trophy = { rows: [
  '..GGggyY..',
  'GyGwggyYyY',
  'G.GGggyY.Y',
  '.yGgggyYY.',
  '..yggyYY..',
  '...yyYY...',
  '....yY....',
  '...yyYY...',
  '..NnnnnB..',
  '..bbbbbB..',
], spin: 'full' };
S.crown = { rows: [
  'e...c...v',
  'G...G...G',
  'Gg.GgG.Gy',
  'GggGgggGy',
  'Gggeggggy',
  'gggggggyY',
  'yyyyyyyyY',
], spin: 'full' };
S.bubble = { rows: [
  '...CCCC...',
  '.CC~~~~cc.',
  '.C^^~~~~c.',
  'C^~~~~~~~c',
  'C~~~~~~~~c',
  'C~~~~~~~~d',
  'c~~~~~~~^d',
  '.c~~~~~~d.',
  '.dd~~~~dd.',
  '...dddd...',
], spin: 'full' };
S.skull = { rows: [
  '..55554..',
  '.5555544.',
  '555555443',
  '5kk55kk43',
  '5kk55kk43',
  '4555k5443',
  '.444444..',
  '.4k4k43..',
  '..3333...',
] };
S.clock = { rows: [
  '...CCcc...',
  '.CcSSSScd.',
  '.cSSkSSSd.',
  'CSSSkSSSSd',
  'cSSSkkkSSd',
  'cSSSSSSSSd',
  '.dSSSSSSD.',
  '.ddSSSSDD.',
  '...dddD...',
], spin: 'full' };
S.eye = { rows: [
  '..555544..',
  '.55CCcc43.',
  '55CcDDcd43',
  '5ccDkwDdd3',
  '.44cDDdd3.',
  '..443333..',
] };
S.music = { rows: [
  '...xxxxxx.',
  '...xuuuuu.',
  '...x....u.',
  '...x....u.',
  '.xxx..xxu.',
  'xXxu.xXxu.',
  'xxuU.xxuU.',
  '.uU...uU..',
] };
S.sound = { rows: [
  '...3......',
  '..43...c..',
  '3443.c..c.',
  '4443.c..c.',
  '4443.c..c.',
  '3443.c..c.',
  '..43...c..',
  '...3......',
] };
S.mute = { rows: [
  '...3......',
  '..43......',
  '3443.e..e.',
  '4443..ee..',
  '4443..ee..',
  '3443.e..e.',
  '..43......',
  '...3......',
] };
S.moon = { rows: [
  '...GGgy...',
  '.GGgy.....',
  'GGgy......',
  'Ggy.......',
  'Ggy.......',
  'ggyy......',
  'gggyy...y.',
  '.ggyyyyyy.',
  '...yyyyY..',
] };
S.cloud = { rows: [
  '....554...',
  '.55555544.',
  '5555555544',
  '5555555443',
  '4444444333',
  '.3333333..',
] };
S.rain = { rows: [
  '....554...',
  '.55555544.',
  '5555555544',
  '4444444333',
  '.3333333..',
  '.c..c..c..',
  'c..c..c...',
] };
S.storm = { rows: [
  '....443...',
  '.44444433.',
  '4444444433',
  '3333333222',
  '.2222g222.',
  '....gy....',
  '...gGgg...',
  '.....gy...',
  '....gy....',
] };
S.snow = { rows: [
  '....C.....',
  '.C..C..C..',
  '..C.C.C...',
  '...CwC....',
  'CCCCwwCCC.',
  '...CwC....',
  '..C.C.C...',
  '.C..C..C..',
  '....C.....',
], spin: 'full' };
S.bolt = { rows: [
  '....GGg.',
  '...GGgy.',
  '..GGgy..',
  '.GGgy...',
  'GGgggggy',
  '...ggyY.',
  '..ggyY..',
  '.gyY....',
  'gyY.....',
] };
S.bolt_off = { base: 'bolt', map: { 'G': '4', 'g': '3', 'y': '2', 'Y': '1' } };
S.battery = { rows: [
  '..43..',
  '455553',
  '4VVVf3',
  '4VVvf3',
  '4vvvf3',
  '4vvvf3',
  '4vvff3',
  '333332',
] };
S.zzz = { rows: [
  '....XXXx',
  '......x.',
  '.....x..',
  '....XXXx',
  'XXXx....',
  '..x.....',
  '.x......',
  'XXXx....',
] };
S.sweat = { base: 'aerobuck_s', map: { 'c': 'C', 'd': 'c', 'D': 'd', 'C': 'w' } };
S.magnet = { rows: [
  '55....54',
  '44....43',
  'eE....er',
  'ee....er',
  'ee....er',
  'eeE..eer',
  '.eeeeer.',
  '..rrrr..',
] };
S.sonar = { rows: [
  '..tqqqqt..',
  '.q......q.',
  'q..tqqt..q',
  'q.q....q.q',
  'q.q.Qw.q.q',
  'q.q.qq.q.q',
  'q.q....q.q',
  'q..tqqt..q',
  '.q......q.',
  '..tqqqqt..',
], spin: 'full' };
S.radar = { rows: [
  '4.......e.',
  '54.....3..',
  '554...3...',
  '.5543k....',
  '..55443...',
  '...55443..',
  '....3443..',
  '.....33...',
  '....3333..',
  '...222222.',
] };
S.lantern = { rows: [
  '...3333...',
  '..3....3..',
  '..222222..',
  '..2GGGy2..',
  '..2GwGy2..',
  '..2GGgy2..',
  '..2ggyy2..',
  '..222222..',
  '...1111...',
] };
S.engine = { rows: [
  '.4555553..',
  '45444443e.',
  '444kk4432.',
  '4444444432',
  '.3333332..',
  '...232....',
  '...232....',
  '..3222....',
  '.4.22.4...',
] };
S.compass = { rows: [
  '...NNnn...',
  '.NnSSSSnb.',
  '.nSSeSSSb.',
  'NSSSeSSSSb',
  'nSSSkSSSSb',
  'nSSSSdSSSb',
  '.bSSSdSSB.',
  '.bbSSSSBB.',
  '...bbbB...',
], spin: 'full' };
S.egg = { rows: [
  '...SSs...',
  '..SSSss..',
  '.SwSSSsz.',
  '.SSSSSsz.',
  'JjJjJjjh.',
  'SSSSSSsz.',
  'SSSSSSzz.',
  '.sssszz..',
  '..zzzZ...',
], spin: 'full' };
S.dna = { rows: [
  'q.....j.',
  '.q...j..',
  '..q5j...',
  '...qj...',
  '..j5q...',
  '.j...q..',
  'j.....q.',
  '.j...q..',
  '..j5q...',
  '...jq...',
], spin: 'full' };
S.clover = { rows: [
  '..VV.Vv...',
  '.VvvVvvf..',
  '..vvvvf...',
  'VVv.v.Vvf.',
  'Vvvvvvvvvf',
  '.vvf.f.vf.',
  '..vvvvf...',
  '.vvf.vvf..',
  '..f..ff...',
  '......fF..',
], spin: 'full' };
S.horseshoe = { rows: [
  '54....43',
  '4k....k3',
  '44....33',
  '4k....k3',
  '445..432',
  '.444332.',
  '..3322..',
] };
S.rainbow = { rows: [
  '..eeeeee..',
  '.eppppppe.',
  'epggggggpe',
  'epgvvvvgpe',
  'pgvc..cvgp',
  'gvc....cvg',
] };
S.wifi = { rows: [
  '..cccccc..',
  '.c......c.',
  'c..cccc..c',
  '..c....c..',
  '....cc....',
  '....cc....',
] };
S.decor = { rows: [
  '...V.V....',
  '..VvVvv...',
  '.Vvv.vvf..',
  '..vf.vf...',
  '...ff.....',
  '.nNNNNNb..',
  '..Nnnnb...',
  '..nnnnb...',
  '...bbB....',
] };
S.chest_crate_s = { rows: [
  '.NNNNNNNn.',
  'NmmmmmmmNb',
  'NNNNyNNNnb',
  'nnnnynnnnb',
  'Nnnngnnnnb',
  'nnnnynnnnb',
  'bbbbbbbbbB',
] };
S.snail = { rows: [
  '..JJjj....',
  '.Jjhhjh...',
  'Jjh.Jjh...',
  'JjhjjhhQ.Q',
  '.jjhhh.Qq.',
  'QQqqqqqqqk',
] };
S.crab = { rows: [
  'Ee......Ee',
  'ee.k..k.ee',
  '.e.e..e.e.',
  '..eeeeee..',
  '.eEEeeeer.',
  'eeeeeeeerr',
  '.r.r..r.r.',
] };
S.quests_s = { rows: [
  'zsSSSSSsz',
  'ZzzzzzzzZ',
  '.SkkkkSs.',
  '.SSSSSSs.',
  '.SkkkSSs.',
  '.SSSSerr.',
  'zsSSSreEr',
  'ZzzzzzRrR',
] };
S.fish_scale = { rows: [
  '..CCCc...',
  '.CwCccd..',
  'CCcccccd.',
  'Cccccccdd',
  '.cccccdd.',
  '..ccddd..',
  '...cdd...',
  '....d....',
] };
S.fin_ribbon = { rows: [
  'jJ......',
  '.jjJ....',
  '..hjjJ..',
  '...hhjj.',
  '..jjhh..',
  '.jJh....',
  'jJh.....',
  '.hh.....',
] };
S.glow_bulb = { rows: [
  '..QQQq..',
  '.QwQqqt.',
  'QQqqqqtT',
  'QqqqqqtT',
  '.qqqqtT.',
  '..tttT..',
  '..3443..',
  '..3443..',
  '...22...',
] };
S.ice_shard = { rows: [
  '...Cw...',
  '..CwCc..',
  '..CCcc..',
  '.CwCccd.',
  '.CCcccd.',
  'CCcccdd.',
  'Ccccddd.',
  '.ccddD..',
] };
S.spring_coil = { rows: [
  '.45553..',
  '...4532.',
  '.45553..',
  '...4532.',
  '.45553..',
  '...4532.',
  '.45553..',
] };
S.magnet_stone = { rows: [
  '..eE2cc..',
  '.eEe2cCc.',
  'eeee2cccd',
  'reee2cccd',
  '.rre2cdd.',
  '..rr2dd..',
] };
S.lava_glass = { rows: [
  '..2211...',
  '.23K1K1..',
  '23Kp1KK1.',
  '2KKopK1K1',
  '.1KKpoK1.',
  '..1KK111.',
] };
S.lure_spoon = { rows: [
  '..455...',
  '.45553..',
  '.45e53..',
  '.45553..',
  '..4532..',
  '...32...',
  '...3....',
  '..3.3...',
] };
S.lure_frog = { rows: [
  '.VV...Vv.',
  'VwkVvVwkf',
  'VvvvvvvvF',
  '.GGGGGgf.',
  '..GGggf..',
  '.v.....f.',
] };
S.lure_squid = { rows: [
  '...Jj...',
  '..JJjh..',
  '.JjJjjh.',
  '.jkjkjh.',
  '.jjjjjh.',
  '.j.j.h.h',
  'j.j.h.h.',
] };
S.charm_heart = { rows: [
  '...gg...',
  '..g..y..',
  '...yY...',
  '.Ee.ee..',
  'EwEeeer.',
  'eeeeerr.',
  '.eeerr..',
  '..err...',
  '...r....',
] };
S.charm_clover = { rows: [
  '...gg...',
  '..g..y..',
  '...yY...',
  '.Vv.Vv..',
  'VvvVvvf.',
  '.vvvvf..',
  'VvvfVvf.',
  '.vf.vf..',
  '....f...',
] };
S.charm_star = { rows: [
  '...gg...',
  '..g..y..',
  '...yY...',
  '...Gg...',
  'GGGggyy.',
  '.Gggyy..',
  '.ggyyy..',
  '.gy.yY..',
] };
S.charm_pearl = { rows: [
  '...gg...',
  '..g..y..',
  '...yY...',
  '..SSs...',
  '.SwSSs..',
  '.SSSsz..',
  '.SSszz..',
  '..zzz...',
] };
S.key = { rows: [
  '.GGy......',
  'Gw.gy.....',
  'G...ggggyy',
  'gy.yy..y.y',
  '.yyY...Y.Y',
] };
S.anvil = { rows: [
  '4555555543',
  '..444443..',
  '...4432...',
  '...4332...',
  '..443322..',
  '.22222221.',
] };
S.boat_hull = { rows: [
  'nNNNNNNNNb',
  'cCCCCCCCcd',
  '.cccccccd.',
  '..ddddddD.',
] };
S.boat_sail = { rows: [
  '...n......',
  '...nS.....',
  '...nSS....',
  '...nSSs...',
  '...nSSSs..',
  '...nSSSSs.',
  '...nzzzzz.',
  'nNNNNNNNb.',
  '.bbbbbbB..',
] };
S.boat_flag = { rows: [
  '4ee.....',
  '4eeEe...',
  '4eeeee..',
  '4eer....',
  '4.......',
  '4.......',
  '3.......',
] };
S.tank_filter = { rows: [
  '4555553',
  '4444443',
  '4k4k4k3',
  '4444443',
  '4k4k4k3',
  '3333332',
  '.c..c..',
  'c..c...',
] };
S.tank_heater = { rows: [
  '.455.',
  '.4e3.',
  '.453.',
  '.453.',
  '.453.',
  '.4e3.',
  '.eer.',
  '.rrR.',
  '..R..',
] };
S.tank_light = { rows: [
  '4555555553',
  '3444444442',
  '.GGGGGGgy.',
  '..........',
  '.g..g..g..',
] };
S.tank_air = { rows: [
  '...C.....',
  '..C.C....',
  '...C..C..',
  '......C..',
  '.3455553.',
  '.3444443.',
  '.3qq4kk2.',
  '.2222222.',
] };
S.tank_sand = { rows: [
  '...J.....',
  '..Jjh..q.',
  '.zssssQq.',
  'zssmsssz.',
  'sssssszzZ',
  'zzzzzzZZ.',
] };
S.mood_happy = { rows: [
  '...GGgg...',
  '.GGggggyy.',
  '.Ggkggkgy.',
  'Gggkggkgyy',
  'gEggggggEy',
  'ggkggggkyy',
  'gggkkkkyyY',
  '.gyyyyyyY.',
  '.yyyyyyYY.',
  '...YYYY...',
] };
S.mood_sad = { rows: [
  '...GGgg...',
  '.GGggggyy.',
  '.Ggkggkgy.',
  'Gggkggkgyy',
  'gggggggCyy',
  'gggggggCyy',
  'gggkkkkyyY',
  '.gkyyyykY.',
  '.yyyyyyYY.',
  '...YYYY...',
] , pal: { G: '#d8eeff', g: '#9ccaff', y: '#5a8ae0', Y: '#2a3a8a', C: '#ffffff' } };
S.mood_ok = { rows: [
  '...GGgg...',
  '.GGggggyy.',
  '.Ggkggkgy.',
  'Gggkggkgyy',
  'gggggggyyy',
  'gggggggyyy',
  'ggkkkkkyyY',
  '.gyyyyyyY.',
  '.yyyyyyYY.',
  '...YYYY...',
] , pal: { G: '#e8ffb0', g: '#b4ec6a', y: '#6cba3a', Y: '#2a6a2a' } };
S.mood_hungry = { rows: [
  '...GGgg...',
  '.GGggggyy.',
  '.Ggkggkgy.',
  'Gggkggkgyy',
  'gggggggyyy',
  'ggggkkgyyy',
  'gggkRRkyyY',
  '.gyykkyyY.',
  '.yyyyyyYY.',
  '...YYYY...',
] , pal: { G: '#ffe0a8', g: '#ffaa4a', y: '#d8682a', Y: '#7a2a1e' } };
S.mood_love = { rows: [
  '...GGgg...',
  '.GGggggyy.',
  '.Grrggrry.',
  'Gggrggrgyy',
  'gEggggggEy',
  'ggkggggkyy',
  'gggkkkkyyY',
  '.gyyyyyyY.',
  '.yyyyyyYY.',
  '...YYYY...',
] , pal: { G: '#ffd6e6', g: '#ff9ec8', y: '#e0609a', Y: '#8a2a5a', E: '#ff5f8a', r: '#e0304c' } };

S.lab_s = { rows: [
  '...Nn....',
  '..4553...',
  '...5~3...',
  '..45~34..',
  '.4^VVVV3.',
  '5Vvvwvvf3',
  '5vvvvvvf3',
  '3fvvvvfF3',
  '.3fffFF3.',
] };
S.aquarium_s = { rows: [
  '..455554..',
  '...3~~3...',
  '.4^~~~~~4.',
  '4^**lll**4',
  '4*lliikM*3',
  '4*ylIiAA*3',
  '.4**lyl*3.',
  '..3mmmmm3.',
] };
S.fishmgr_s = { rows: [
  '4555555553',
  '4^*******3',
  '4**lll***3',
  '4*lliikM*3',
  '4*ylIiAA*3',
  '4*v*lyl*f3',
  'mmmmmmmmmm',
  'NNNNNNNNNb',
  '.b......b.',
] };
S.journal_s = { rows: [
  '.dCCCCCCc.',
  'DdccccccdS',
  'Ddcyggg.dS',
  'DdcgggkgdS',
  'Ddc.yy.cds',
  'DdccccccdZ',
  'DDDDDDDDZ.',
] };
S.map_s = { rows: [
  '...CCcc...',
  '.CCvvccd..',
  '4CwVvccvd.',
  '4cVvccvfD.',
  '4cvvvccdD.',
  '.4dcvcdD..',
  '..4.DD....',
  '....3.....',
  '...yggy...',
  '...YyyY...',
], spin: 'full' };
S.shop_s = { rows: [
  'eSeSeSeSeS',
  'rSrSrSrSrS',
  '.b......b.',
  '.b.Cy.e.b.',
  'mmmmmmmmmm',
  'NnNnNnNnNb',
  'nbnbnbnbnB',
  '.B......B.',
] };
S.settings_s = { base: 'gear', map: { '5': 'C', '4': 'c', '3': 'd', '2': 'D' }, spin: 'full' };
S.inventory_s = { rows: [
  '...bbbb...',
  '..b....b..',
  '.nNNNNNNn.',
  'nNmmmmmmNb',
  'Nnn.yGy.nb',
  'Nnnn.k.nnb',
  'nnnnnnnnnb',
  'bnnnnnnnbB',
  '.BBBBBBBB.',
] };
S.wardrobe_s = { rows: [
  '....3.....',
  '...3.3....',
  '..nNNNn...',
  'cCCCeCCCd.',
  'SSSSeSSSS.',
  'dc.cccc.d.',
  '...SSSS...',
  '...cccd...',
  '...dddD...',
] };
S.bait_s = { base: 'worm' };
S.multiplayer_s = { rows: [
  '...jh.jh..',
  '....jjh...',
  '.lll..lll.',
  'lwiiMMiiwl',
  'liiiAAiiil',
  '.lII..IIl.',
] };
S.build_s = { rows: [
  '4555543',
  '3444332',
  '..Nn...',
  '..Nn...',
  '..Nn...',
  '..nb...',
  '..er...',
  '..rR...',
] };
S.space = { rows: [
  '45555555555553',
  '44444444444443',
  '44444444444442',
  '33333333333332',
] };
S.space_lit = { base: 'space', map: { '5': 'G', '4': 'g', '3': 'y', '2': 'Y' } };
S.mouse_lit = { base: 'mouse_l', map: { 'C': 'G', 'c': 'g', 'd': 'y' } };
S.chest_golden_s = { base: 'chest_crate_s', map: { 'N': 'g', 'm': 'G', 'n': 'y', 'b': 'Y', 'B': 'Y', 'y': 'n', 'g': 'w' } };
S.chest_iron_s = { base: 'chest_crate_s', map: { 'N': '4', 'm': '5', 'n': '3', 'b': '2', 'B': '1' } };
S.chest_orb_s = { rows: [
  '..XXxx..',
  '.XwXxxu.',
  'XXxxjxuu',
  'Xxxxxxuu',
  '.uxxxuuU',
  '..uuuuU.',
  '.yggggy.',
  'YyyyyyyY',
] };
S.reel_turbo = { base: 'reel', map: { 'C': 'p', 'c': 'o', 'd': 'O', 'D': 'O', '5': 'P', '4': 'p' } };
S.reel_gold = { base: 'reel', map: { 'C': 'G', 'c': 'g', 'd': 'y', 'D': 'Y' } };
S.line_braid = { base: 'line', map: { 'P': 'V', 'p': 'v', 'O': 'f' } };
S.line_glow = { base: 'line', map: { 'P': 'Q', 'p': 'q', 'O': 't' } };
S.line_titan = { base: 'line', map: { 'P': '5', 'p': '4', 'O': '3' } };

S.globe_ball = { rows: [
  '.....CCCccc.....',
  '...CCCVvvcccd...',
  '..CCwVvvvccccd..',
  '.CCwVVvvvccvvdd.',
  '.CwCVvvvccvvvfd.',
  'CCcccvvvccvvffdD',
  'CcVvccccccccfddD',
  'cVvvvcccccccdddD',
  'cvvvvvcccccvvddD',
  'cvvvvvvcccvvvfdD',
  '.cvvvvccccvvfdD.',
  '.ccvvvcccccfddD.',
  '..ccvvccccdddD..',
  '...ddccccdddD...',
  '.....DDDDDD.....',
], spin: 'full' };
S.cut_round = { rows: [
  '..QQqq..',
  '.QwQqqt.',
  'QQqqqqtT',
  'QqqqqqtT',
  'qqqqqttT',
  '.qqqttT.',
  '..ttTT..',
] };
S.cut_diamond = { rows: [
  '...Qq...',
  '..Qwqt..',
  '.QQqqtt.',
  'QQqqqqtT',
  '.qqqqtT.',
  '..qqtT..',
  '...tT...',
] };
S.cut_square = { rows: [
  'QQQQQqq',
  'QwQqqqt',
  'QQqqqqt',
  'Qqqqqqt',
  'qqqqqtt',
  'qttttTT',
] };
S.cut_drop = { rows: [
  '...Q....',
  '..Qwq...',
  '.QQqqt..',
  '.Qqqqt..',
  'QQqqqqt.',
  'Qqqqqqt.',
  '.qqqqt..',
  '..ttT...',
] };
S.cut_heart = { rows: [
  '.QQ.qq..',
  'QwQqqqt.',
  'Qqqqqqt.',
  '.qqqqt..',
  '..qqt...',
  '...t....',
] };
S.cut_clover = { rows: [
  '.Qq.qq..',
  'QwqQqqt.',
  '.qqqqt..',
  'Qqq.qqt.',
  '.qt.qt..',
] };
S.cut_oval = { rows: [
  '.QQq..',
  'QwQqt.',
  'QQqqt.',
  'Qqqqt.',
  'qqqtT.',
  '.ttT..',
] };
S.cut_hex = { rows: [
  '..QQqq..',
  '.QwQqqt.',
  'QQqqqqtt',
  'Qqqqqqtt',
  '.qqqqtT.',
  '..ttTT..',
] };
S.boat_raft = { rows: [
  '........e.........',
  '........eEe.......',
  '........n.SS......',
  '........nSSSs.....',
  '........nSSSSs....',
  '........nSSSSSs...',
  '........nSSSSSSs..',
  '........nzzzzzzz..',
  '...N.N.Nn.N.N.N...',
  '.NmNNmNNmNNmNNmNn.',
  'NmNNNNNNNNNNNNNNnb',
  'nnnnnnnnnnnnnnnnbB',
  '.bBbbBbbBbbBbbBbB.',
] };
S.boat_dinghy = { rows: [
  '........b.........',
  '.........b........',
  '..nNNNNNNNbNNNNn..',
  '.SSSSSSSSSSbSSSSSs',
  '.SSSSSSSSSSSbSSSs.',
  '..ccccccccccccccc.',
  '..SSSSSSSSSSSSSs..',
  '...44444444444433.',
  '.....3333333333...',
] };
S.boat_skiff = { rows: [
  '.........4CCc.....',
  '........4C^~c.....',
  '..4.....4~~~c.....',
  '.454SSSSSSSSSSSSS.',
  '.43ccCCCCCCCCCCcdd',
  '.43cccccccccccccd.',
  '...dccccccccccdd..',
  '....dddddddddD....',
] };
S.boat_hydrofoil = { rows: [
  '......CCCCCc......',
  '.....C^~~~~~c.....',
  '...SSSSSSSSSSSSS..',
  '..SqqqqqqqqqqqqqqS',
  '..SSSSSSSSSSSSSSs.',
  '...44444444444433.',
  '.....3.......3....',
  '.....3.......3....',
  '...cccc.....cccc..',
] };
S.boat_yacht = { rows: [
  '........3.........',
  '........3.........',
  '......SSSSs.......',
  '.....SCcCcSs......',
  '...SSSSSSSSSSs....',
  '...ScCcCcCcCcs....',
  '.SSSSSSSSSSSSSSSS.',
  'SSSSSSSSSSSSSSSSSs',
  '.cccccccccccccccd.',
  '..444444444444433.',
  '...33333333333333.',
] };
S.boat_catamaran = { rows: [
  '........3.........',
  '........3S........',
  '........3SS.......',
  '........3SSs......',
  '........3SqSs.....',
  '........3SSSSs....',
  '........3zzzzz....',
  '.SSSSSSSSSSSSSSSS.',
  'qqqqqqq...qqqqqqq.',
  'SSSSSSs...SSSSSSs.',
  '.3333.....3333....',
] };
S.boat_submarine = { rows: [
  '........3.........',
  '........33........',
  '.......gGGg.......',
  '......gGggy.......',
  '...GGGGggggggg....',
  '.GGgCcggCcggCcgy..',
  'GgggcDggcDggcDggy.',
  'ggggggggggggggggyY',
  '.yggggggggggggyyY.',
  '..yyyyyyyyyyyyyY..',
  '4...YYYYYYYYYYY...',
] };
S.tank_jar = { rows: [
  '....nNNNNNn....',
  '....nnnnnnb....',
  '...45555553....',
  '...4~~~~~~3....',
  '..4^*******3...',
  '..4^**lll**3...',
  '..4**lliikM3...',
  '..4**ylIiAA3...',
  '..4****lyl*3...',
  '..4*v**f***3...',
  '..4mmmmmmmm3...',
  '...33333333....',
] };
S.tank_smalltank = { rows: [
  '.4555555553.',
  '.4^*******3.',
  '.4^*lll***3.',
  '.4*lliikM*3.',
  '.4*ylIiAA*3.',
  '.4*v*lyl*f3.',
  '.4vf****vf3.',
  '.4mmmmmmmm3.',
  'nNNNNNNNNNNb',
  '.b........b.',
] };
S.tank_reeftank = { rows: [
  '45555555555555555553',
  '4^*****************3',
  '4^**lll*******C****3',
  '4**lliikM**********3',
  '4**ylIiAA*****lll**3',
  '4*****lyl****lliikM3',
  '4*jJ******g*ylIiAA*3',
  '4*jhJ*v**gyG**lyl**3',
  '4jJhj*vf*ygy**V*eE*3',
  '4mmmmmmmmmmmmmmmmmm3',
  'nNNNNNNNNNNNNNNNNNNb',
  '.b................b.',
] };
S.tank_wallaquarium = { rows: [
  '22222222222222222222',
  '24555555555555555532',
  '24^****************3',
  '24^*lll*****C******3',
  '24*lliikM**********3',
  '24*ylIiAA*****lll**3',
  '24***lyl*****lliikM3',
  '24*v***f****ylIiAA*3',
  '24vf*jJ**v****lyl*f3',
  '24mmmmmmmmmmmmmmmmm3',
  '22222222222222222222',
] };
S.shell = { rows: [
  '....J.....',
  '..JjJjh...',
  '.JjJjJjh..',
  'JjJjJjJjh.',
  'jJjJjJjhh.',
  '.hjhjhjh..',
  '..HHjHH...',
] };
S.starfish = { rows: [
  '....g.....',
  '....gg....',
  '...gGgy...',
  'ggggGgggyy',
  '.ygggggyy.',
  '..gggyyy..',
  '.ggy..yy..',
  '.gy....yY.',
], spin: 'full' };
S.bubbles = { ol: false, rows: [
  '....3c..',
  '...cw~c.',
  '...c~~d.',
  '.3c.dd..',
  'cw~c....',
  'c~~d.3c.',
  '.dd.cwd.',
  '.....d..',
], pal: { c: '#7fc8f0', d: '#3f8ed8', 3: '#d8f4ff', '~': '#d8f6ff80' } };
S.pearl = { rows: [
  '..SSs...',
  '.SwSSs..',
  'SSSSSsz.',
  'SSSSszz.',
  '.sssZz..',
  '..zzZ...',
], spin: 'full' };
S.coral_decor = { base: 'coral' };
S.bait_bread = { rows: [
  '.NNNNNN..',
  'NmmmmmmN.',
  'NmSSSSmNn',
  'nmSSSSSmn',
  'nmSzSSSmn',
  'nmSSSSzmn',
  'nmSSSSSmn',
  'nNmmmmmNb',
  '.bbbbbbb.',
] };
S.bait_crumbs = { rows: [
  '.Nn......',
  'NmNn..Nn.',
  '.nn..NmNn',
  '......nnb',
  '..Nn.....',
  '.NmNn.Nn.',
  '..nnb.nb.',
] };
S.bait_grub = { rows: [
  '...SSs....',
  '.SSmSms...',
  'SmSmSmSz..',
  'zSmSmSmzk.',
  '.zzmzmzzS.',
  '...zzZz...',
] };
S.bait_sugar = { rows: [
  '.5555554.',
  '5SSSSSS54',
  '5SwSSSS44',
  '5SSSSSS44',
  '5SSSSjS44',
  '5SSSSSS43',
  '.4444433.',
] };
S.bait_chip = { rows: [
  '.3.3.3.3.',
  '3K11111K3',
  '.1qQqQq1.',
  '31QkkkQ13',
  '.1qkkkq1.',
  '31QqQqQ13',
  '.1111111.',
  '.3.3.3.3.',
] };
S.bait_popup = { rows: [
  'dddddddee',
  'dCCCCCdEe',
  '455555553',
  '45jjjj553',
  '455555553',
  '45gggg553',
  '455555553',
  '333333332',
] };
S.bait_flood = { rows: [
  '...CCc....',
  '.CCwccd...',
  'Cww.ccdd..',
  'w...Ccddc.',
  '...CccddcC',
  'ccccccddcc',
  'dddddddddd',
] };
S.bait_lantern = { rows: [
  '...QQq...',
  '.QwwQqt..',
  'QwQQqqqt.',
  'QQqqqqtt.',
  '.qqqqtT..',
  '..ttTT...',
] };
S.bait_golden = { rows: [
  '....G.....',
  '..GGgG....',
  '.GwGgggy..',
  'GGgggggyy.',
  'ggggggyyY.',
  '.yyyyyYY..',
] };
S.bait_blackhole = { rows: [
  '...uuuu...',
  '.uxxUUxu..',
  'uxUKKKUxu.',
  'uUKkkkKUu.',
  'uUKkkkKUx.',
  '.xUKKKUxu.',
  '..uxxxxu..',
  '...uuuu...',
], spin: 'full' };
S.bait_relic = { rows: [
  '.344443.',
  '34555443',
  '45qQq543',
  '455q5443',
  '45qQq432',
  '45555432',
  '34444332',
  '.222222.',
] };


S.build = { rows: [
  '4..4..............',
  '45.54...555555554.',
  '.453....544444443.',
  '..453...544444432.',
  '...453..433333332.',
  '....453..2222222..',
  '.....453...Nn.....',
  '......453.Nn......',
  '.......45Nn.......',
  '........Nn3.......',
  '.......Nn453......',
  '......Nn..453.....',
  '.....Nn....453....',
  '....er......453...',
  '...er.........4553',
  '..er..........5..3',
  '.rR...........3..2',
  '...............22.',
] };
S.bait = { rows: [
  '...454............',
  '...5.4............',
  '...454........JJj.',
  '....4........JjJjh',
  '....4........jwkjh',
  '....5.........jjhh',
  '....4........jjh..',
  '....4......jJjh...',
  '....4.....jJjh....',
  '....4.....jjhh....',
  '4...4......hjJj...',
  '54..4........jJjh.',
  '45..3.........jjh.',
  '.4..3........jJh..',
  '.53.3......jJjh...',
  '..5332....jjhh....',
  '...........hh.....',
] };
S.multiplayer = { rows: [
  '......jJ.jh.......',
  '.....jJjjjjh......',
  '......jjjjh.......',
  '.......jjh........',
  '..g.g........g.g..',
  '.yYyYy......yYyYy.',
  '.llllll....llllll.',
  'lliiwwl....lwwiill',
  'liiiwkil..likwiiil',
  'liLiiiiAAAAiiiiLil',
  'liiliiMRRRRMiiliil',
  'lIIiiMAAAAAAMiiIIl',
  '.lIIIiMM..MMiIIIl.',
  '..llyll....llyll..',
] };
S.star_empty = { base: 'star', map: { 'G': '5', 'g': '4', 'y': '3', 'Y': '2', 'w': '5' }, spin: 'full' };
S.line = { rows: [
  'nNNNNNNNb.',
  '.PPPPPPpO.',
  '.pppppppO.',
  '.PPPPPPpOw',
  '.pppppppw.',
  '.PPPPPPpO.',
  '.pppppppO.',
  'nNNNNNNNb.',
  '.bbbbbbB..',
] };
S.expand = { rows: [
  'CCCCCCCCcc',
  'Cccccccccd',
  'c5555555cd',
  'c5555555cd',
  'c5555555cd',
  'c5555555cd',
  'dddddddddD',
] };

S.grouper = { rows: [
  '..........g.g.g.....',
  '........gyYyYyYy....',
  '......lllllllllll...',
  'gy..llliilliiiilll..',
  'yYy.llLLliiiiiliill.',
  'yYYlliLliiilliiwwil.',
  '.yYiiiiiiiiLliiwkiAA',
  '.yYiiilliiiiiiiiiMRR',
  'yYYiilLliiiiiiiiMAAA',
  'yYy.iIIiiiillIiiMMMM',
  'gy...lIIIIIIIIIiil..',
  '.......llyYYyllll...',
] };
S.reel = { rows: [
  '...CCcc...',
  '.CCccccd..',
  'Ccc5555cd.',
  'Cc54445cd.',
  'cc5434544e',
  'cc54445cEe',
  'dcc5555cdd',
  '.dcccccdd.',
  '..ddddDD..',
], spin: 'full' };
S.mouse = { rows: [
  '..45k3..',
  '.455k532',
  '4555k532',
  '45553332',
  '45555332',
  '45555332',
  '45555332',
  '.455332.',
  '..3332..',
] };
S.mouse_l = { rows: [
  '..CCk3..',
  '.CCck532',
  '4CCck532',
  '4ccd3332',
  '45555332',
  '45555332',
  '45555332',
  '.455332.',
  '..3332..',
] };
S.mouse_r = { rows: [
  '..45kc..',
  '.455kcd2',
  '4555kcd2',
  '4555ddd2',
  '45555332',
  '45555332',
  '45555332',
  '.455332.',
  '..3332..',
] };
S.mouse_hold = { rows: [
  '..PPk3..',
  '.PPpk532',
  '4PPpk532',
  '4ppo3332',
  '45555332',
  '45555332',
  '45555332',
  '.455332.',
  '..3332..',
] };
S.anger = { rows: [
  '.e....e.',
  'eEe..eEe',
  '.er..er.',
  '........',
  '.ee..ee.',
  'eEr..eEr',
  '.r....r.',
] };

S.gear = { rows: [
  '....54....',
  '.5.4444.3.',
  '..444443..',
  '.44444433.',
  '5444..4332',
  '4443..3322',
  '.44333332.',
  '..433322..',
  '.4.3332.2.',
  '....32....',
], spin: 'full' };
S.sun = { rows: [
  '....gg....',
  '.g......y.',
  '...GGgg...',
  '..GwGggy..',
  'g.GGgggy.y',
  'g.Ggggyy.y',
  '..ggggyy..',
  '...gyyy...',
  '.y......Y.',
  '....yY....',
], spin: 'full' };
S.food = { rows: [
  '..CCCCc..',
  '.Ccdcdcd.',
  '.DDDDDDD.',
  '.PSSSSpo.',
  '.PSjvSpo.',
  '.PSgjSpo.',
  '.PSSSSpo.',
  '.Ppppppo.',
  '.ooooooO.',
] };
S.leaves = { rows: [
  '........VVv.',
  '......VVVvvf',
  '.....VVvvvf.',
  '.VV.Vvvvff..',
  'VVvvfvvf....',
  'Vvvvff......',
  '.vvf.f......',
  '....f.......',
  '...f........',
  '..f.........',
] };
S.leaves_l = { base: 'leaves', flip: true };

export const SPRITES = S;

// ================================================================ aliases (old model ids / icons3d names -> sprites)
export const ALIAS = {
  skills: 'lab', research: 'lab', beaker: 'lab', crafting: 'build', workshop: 'build', hammer_wrench: 'build',
  tank: 'aquarium', fishdex: 'journal', book: 'journal', satchel: 'inventory', friends: 'multiplayer', people: 'multiplayer',
  globe: 'map', baitshop: 'shop', appsea: 'shop', store: 'shop', coin: 'aerobuck', aero: 'aerobuck', coins: 'aerobuck',
  coin_big: 'aerobuck', aero_big: 'aerobuck', aerobucks: 'aerobuck', fish: 'grouper', chest: 'chest_iron', chest_wood: 'chest_crate', crate: 'chest_crate',
  chest_crate_: 'chest_crate', chest_gold: 'chest_golden', golden: 'chest_golden', iron: 'chest_iron', orb: 'chest_orb',
  reel_spin: 'reel', clover_leaf: 'clover', boat_engine: 'engine', boat_decal: 'star', hammer: 'build', scroll: 'quests',
  cat_rods: 'hook', cat_tackle: 'reel', cat_upgrade: 'arrow_u', cat_bait: 'worm', cat_decor: 'decor', cat_boat: 'boat_hull',
  cat_tank: 'aquarium', cat_build: 'home', box: 'chest_crate', chest_iron_: 'chest_iron', snowflake: 'snow',
  gem_common: 'gem:#c9d4dc', gem_uncommon: 'gem:#7ee07a', gem_rare: 'gem:#5fb8ff', gem_epic: 'gem:#d27bff', gem_legendary: 'gem:#ffd04a',
  item_crate: 'chest_crate', item_iron: 'chest_iron', item_golden: 'chest_golden', item_orb: 'chest_orb',
};

// ---------------------------------------------------------------- parametric families
const R = (hex) => ramp(hex); // [deep, shadow, base, light, highlight]
const gemPal = (hex) => { const r = R(hex); return { Q: r[3], q: r[2], t: r[1], T: r[0] }; };
const BIOME_PAL = {
  oscean: ['#3fa8ff', '#5ccf4a'], shallows: ['#2fd3e8', '#f6dc9a'], fjord: ['#5aa6e8', '#f4fbff'], junkyard: ['#2a8aa8', '#c07a3a'],
  metropolis: ['#3a4ad8', '#ff6ad0'], volcano: ['#3a4a6a', '#ff7a2a'], abyss: ['#0c2a5a', '#7ef0ff'],
};
const BAIT_SHAPES = { worm: 'worm', grub: 'bait_grub', crumbs: 'bait_crumbs', bread: 'bait_bread', sugar: 'bait_sugar', chip: 'bait_chip',
  popup: 'bait_popup', flood: 'bait_flood', lantern: 'bait_lantern', golden: 'bait_golden', blackhole: 'bait_blackhole', relic: 'bait_relic' };
export function baitSpriteName(shape) { return BAIT_SHAPES[shape] || null; }

// A fishing rod from rod.look {kind: stick|wand|crystal|trident|coil|carbon, shaft, grip, reel, tip, glow}: cork-ish
// grip bottom-left, a little reel under the blank, a tapered blank to the top-right and the line + bobber hanging.
const ROD_ROWS = [
  '...............$..',
  '..............68w_',
  '.............68_w_',
  '............68._w_',
  '...........68.._w_',
  '..........68..._w_',
  '.........68...._w_',
  '........67....._w_',
  '.......67......_w_',
  '......778......Ee.',
  '.....778......Eer.',
  '....778.......wS4.',
  '...78!.........44.',
  '..90!...........',
  '.90.............',
  '90................',
];
export function rodDef(look = {}) {
  const sh = R(look.shaft || '#c8a070'), gr = R(look.grip || '#6a4a2a'), re = R(look.reel || '#c8c8c8');
  const tip = look.tip || '#ffffff', glow = look.glow || tip;
  const rows = ROD_ROWS.map((r) => [...r]);
  const put = (x, y, c) => { if (rows[y] && x >= 0 && x < rows[y].length) rows[y][x] = c; };
  const kind = look.kind || 'stick';
  if (kind === 'wand') { put(14, 0, '%'); put(15, 0, '%'); put(16, 0, '%'); put(15, 1, '%'); put(14, 1, '6'); put(15, 0, '^'); }
  else if (kind === 'crystal') { put(15, 0, '%'); put(16, 0, '^'); put(14, 0, '%'); put(15, 1, '%'); }
  else if (kind === 'trident') { put(13, 0, '$'); put(15, 0, '$'); put(16, 1, '$'); put(16, 2, '_'); put(14, 0, '6'); }
  else if (kind === 'coil') { for (const [x, y] of [[13, 2], [11, 4], [9, 6], [7, 8]]) put(x, y, '!'); }
  else if (kind === 'carbon') { for (const [x, y] of [[12, 3], [10, 5], [8, 7]]) put(x, y, '4'); }
  return {
    rows: rows.map((r) => r.join('')),
    pal: { 6: sh[3], 7: sh[2], 8: sh[1], 9: gr[3], 0: gr[1], '!': re[3], '@': re[1], $: tip, '%': mix(glow, '#ffffff', 0.15), '^': '#ffffff' },
    spin: 'wobble',
  };
}

// a canvas cropped to its opaque pixels
function trim(c) {
  const g = ctxOf(c), d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return c;
  const o = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  ctxOf(o).drawImage(c, -x0, -y0);
  return o;
}

export const FAMILY = {
  // materials / samples / eggs / scrolls from src/build/itempix.js: item_<id>
  'item_': (id) => { const p = itemPixel(id); return p ? { canvas: trim(p.canvas) } : null; },
  // rarity / colour gems: gem:<hex>[_s]
  'gem:': (rest) => { const small = rest.endsWith('_s'); const hex = small ? rest.slice(0, -2) : rest; return { base: small ? 'gem_s' : 'gem', pal: gemPal(hex), spin: 'full' }; },
  // Lab cut gems: cut:<hex>|<cut>
  'cut:': (rest) => { const [hex, cut = 'round'] = rest.split('|'); return { base: SPRITES_REF['cut_' + cut] ? 'cut_' + cut : 'cut_round', pal: gemPal(hex), spin: 'full' }; },
  // biome globes: globe:<biome>
  'globe:': (id) => {
    const P = BIOME_PAL[id] || BIOME_PAL.oscean; const a = R(P[0]), b = R(P[1]);
    return { base: 'globe_ball', pal: { C: a[3], c: a[2], d: a[1], D: a[0], V: b[3], v: b[2], f: b[1] }, spin: 'full' };
  },
  // rods registered from their look (bigicons.rodIcon): rod:<id> falls back to a plain stick
  'rod:': () => rodDef({}),
  // bait shapes: baitpix:<shape>
  // round glossy orbs for the chrome: orb:<hex>
  'orb:': (hex) => { const r = R(hex); return { base: 'pearl', pal: { S: r[3], s: r[2], z: r[1], Z: r[0] }, spin: 'full' }; },
  'baitpix:': (shape) => (BAIT_SHAPES[shape] ? { base: BAIT_SHAPES[shape] } : null),
};
const SPRITES_REF = S;
