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
S.grouper = { rows: [
  '.......g.g.g.g....',
  '......yYyYyYyYg...',
  '....YlllllllllllY.',
  'gY.YliLlliiLiilll.',
  'yYylliiiiiiiiiwwl.',
  'gyYliiiLiiiiiiwkl.',
  '.yYiiiiiiiiliiiiAA',
  '.yYiLiiiyyliiiiMRR',
  'gyYiiiiiyYyiiiMAAA',
  'yYlIIiiiiyIiiiMMMM',
  'gY.lIIIIIIIIIiiM..',
  '....liIIIIIIIIil..',
  '......lllyYYylll..',
  '........yY........',
], spin: 'wobble' };
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
S.build = { rows: [
  '4..4..............',
  '45.54..5554.......',
  '.453....5432......',
  '..453....5432.....',
  '...453....5432....',
  '....453....5432...',
  '.....453..Nn5432..',
  '......453Nn..5432.',
  '.......4Nn....5432',
  '.......Nn53....432',
  '......Nn.453......',
  '.....Nn...453.....',
  '....Nn.....453....',
  '...er.......453...',
  '..er.........4553.',
  '.er..........5..3.',
  'rR...........3..2.',
  '..............22..',
], spin: 'wobble' };

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
S.bait = { rows: [
  '..........454.....',
  '.........4...4....',
  '..........454.....',
  '...........4......',
  '...........4......',
  '...jJj.....4......',
  '..jJJJjjjjJjj.....',
  '..hjkJjhhhhjJj....',
  '...hh......4hJj...',
  '...........4.hj...',
  '......jjjjJjjjh...',
  '.....jJJhhhjhh....',
  '....jJh....4......',
  '..4.hJ.....4......',
  '.454.hh....4......',
  '.4.4.......3......',
  '.4..5....43.......',
  '..45.5443.........',
], spin: 'wobble' };

// two toy groupers puckering up at a little heart
S.multiplayer = { rows: [
  '......jJ.jh.......',
  '.....jJjjjjh......',
  '......jjjjh.......',
  '.......jjh........',
  '...g.g..h...g.g...',
  '.ylllll....llllly.',
  'gylLiiwl..lwiiLlyg',
  'yYiiiLikAAkiLiiiYy',
  'gyiiiiiMRRMiiiiiyg',
  'yYIIiLiMAAMiLiIIYy',
  '..lIIIil..liIIIl..',
  '....lyl....lyl....',
], spin: 'wobble' };

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

export const SPRITES = S;

// ================================================================ aliases (old model ids / icons3d names -> sprites)
export const ALIAS = {
  skills: 'lab', research: 'lab', beaker: 'lab', crafting: 'build', workshop: 'build', hammer_wrench: 'build',
  tank: 'aquarium', fishdex: 'journal', book: 'journal', satchel: 'inventory', friends: 'multiplayer', people: 'multiplayer',
  globe: 'map', baitshop: 'shop', appsea: 'shop', store: 'shop', coin: 'aerobuck', aero: 'aerobuck', coins: 'aerobuck',
  coin_big: 'aerobuck', aero_big: 'aerobuck', aerobucks: 'aerobuck', fish: 'grouper', chest: 'chest_crate', crate: 'chest_crate',
  chest_crate_: 'chest_crate', chest_gold: 'chest_golden', golden: 'chest_golden', iron: 'chest_iron', orb: 'chest_orb',
  item_crate: 'chest_crate', item_iron: 'chest_iron', item_golden: 'chest_golden', item_orb: 'chest_orb',
};

export const FAMILY = {};
