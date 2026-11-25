// [wallet32] Hand-drawn 2D PIXEL-ART leaves for the UI chrome (window corners, hotbar ends, gear pod, quest cards,
// shop awning). Replaces the voxel 'leaves' decor and the rotated procedural leaf textures, which looked blurry.
// Every leaf is a fixed sprite (1 char = 1 art px = 1 logical px; the `.hi` twin is the same art scaled by nearest
// neighbour, so it stays crisp on the 2x UI layer). Nothing is rotated or stretched: the art comes in hand-drawn angles
// in three sizes (X 28 px, L 20 px, S 14 px long) and hand-drawn angles
// (15, 40, 65, 115, 140, 165, 200, 340 degrees, counter-clockwise from 'pointing right'), each shaded for light from the
// top-left: 1 px dark outline, 5 hue-shifted greens (teal shadows -> yellow-lime lights), a pale midrib, side veins on
// the shade half, a gloss streak + white glint on the lit half and a dew drop (white / aqua / teal pixels) on the big ones.
// Clusters (a little twig with 4-5 leaves) are composed from those sprites; they sway with 3 hand-placed frames.
//
//   drawPixLeaf(ctx, x, y, len, angleDeg, {tone})   one leaf, stem base at (x, y); angleDeg in SCREEN degrees (y down,
//                                                    like drawAeroLeaf: -30 = up-right); the nearest drawn angle is used
//   leafCluster(corner, size, frame) -> canvas      corner 'tr' | 'tl' (spill up and out) | 'br' | 'bl' (sideways,
//                                                    a little up),
//                                                    size 'L' | 'S', frame 0..2; canvas.ax/.ay = the twig base
//   drawLeafCluster(ctx, corner, x, y, o)           o: {size, scale (integer), t, phase, still, center (draw centred
//                                                    on x, y instead of anchoring the twig base there)}
//   clusterSize(corner, size) -> {w, h}
// Tones: 'leaf' (default), 'lime', 'deep'.

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { withHi, HI } from '../gfx/hires.js';

const BASE = { W: '#ffffff', q: '#c8f8ff', Q: '#4cb8cc', s: '#2c6a1c' };
const PAL = {
  leaf: { ...BASE, o: '#0b2e1c', 1: '#176038', 2: '#26903e', 3: '#4cbc3c', 4: '#90de4a', 5: '#d4f67a' },
  lime: { ...BASE, o: '#14321a', 1: '#287428', 2: '#42a634', 3: '#70ca3a', 4: '#ace852', 5: '#eaff9a' },
  deep: { ...BASE, o: '#072616', 1: '#0e4c32', 2: '#1b763e', 3: '#319c44', 4: '#5ec452', 5: '#a2e878' },
};

// a: the stem's end (the attach point), r: rows
const ART = {
  X15: { a: [0, 12], r: [
    '............oooooo.........',
    '.........ooo333333oooo.....',
    '........o3345554444444ooo..',
    '.......o34555554444444444oo',
    '......o4555554444445555544o',
    '.....o4555444445555111111oo',
    '....o44W4444555111122232o..',
    '....o444455511122Wq222oo...',
    '...o4445511123222qQ3oo.....',
    '...o455111222223223o.......',
    '...o5112233222233oo........',
    '...o1222222313ooo..........',
    'sssooo22111ooo.............',
    '......ooooo................',
  ] },
  X40: { a: [0, 19], r: [
    '..............oooooo',
    '.........ooooo44444o',
    '.......oo3444444541o',
    '.....oo34444445511o.',
    '....o345444455112o..',
    '...o3555544551222o..',
    '..o3555444511222o...',
    '.o3555444511332o....',
    '.o455445512Wq23o....',
    'o3554455122qQ3o.....',
    'oW55455133333o......',
    'o45445122223o.......',
    'o44451222233o.......',
    'o4451333333o........',
    'o45112221oo.........',
    'o5512221o...........',
    'o51222oo............',
    'oooooo..............',
    'ss..................',
    's...................',
  ] },
  X65: { a: [3, 24], r: [
    '...........ooo',
    '.........oo44o',
    '.......oo4451o',
    '......o444511o',
    '.....o4445512o',
    '....o4444513o.',
    '...o34445112o.',
    '..o344445122o.',
    '.o3554451223o.',
    '.o3554451Wq2o.',
    'o35554512qQ3o.',
    'o3554451222o..',
    'o4554511233o..',
    'o5544513223o..',
    'o5544512223o..',
    'o554512222o...',
    'oW54512231o...',
    'o44451322o....',
    'o44451221o....',
    'o4451222o.....',
    '.o45122o......',
    '.o4512oo......',
    '..oooo........',
    '...ss.........',
    '...s..........',
  ] },
  X115: { a: [14, 25], r: [
    '..oo...........',
    '.o4o...........',
    '.o41o..........',
    '.o451o.........',
    '.o4513o........',
    '.o45132o.......',
    'o4451223o......',
    'o44451233o.....',
    'o44451232o.....',
    'o44451Wq23o....',
    'o34445qQ223o...',
    'o3444512232o...',
    'o34544512323o..',
    '.o55545122223o.',
    '.o45544512221o.',
    '.o35554511232o.',
    '..o45544512321o',
    '..o35554551322o',
    '...o3555451122o',
    '...oo355445122o',
    '.....o3W444512o',
    '......oo444551o',
    '........ooo451o',
    '...........ooos',
    '..............s',
    '..............s',
  ] },
  X140: { a: [20, 19], r: [
    'oooooo...............',
    'o44444ooooo..........',
    'o1454444443oo........',
    '.o11554444443oo......',
    '..o211554444543o.....',
    '..o2221554455553o....',
    '...o2221154445553o...',
    '....o23Wq154445553o..',
    '....o32qQ215544554o..',
    '.....o3222215544553o.',
    '......o33333155455Wo.',
    '.......o32222154454o.',
    '.......o33222215444o.',
    '........o3333331544o.',
    '.........oo12221154o.',
    '...........o1222155o.',
    '............oo22215o.',
    '..............oooooo.',
    '...................ss',
    '....................s',
  ] },
  X165: { a: [26, 12], r: [
    '.........oooooo............',
    '.....oooo333333ooo.........',
    '..ooo4444444555433o........',
    'oo44444444445555543o.......',
    'o4455555444444555554o......',
    'oo1111115555444445554o.....',
    '..o2322211115554444W44o....',
    '...oo2223Wq21115554444o....',
    '.....oo32qQ223211155444o...',
    '.......o322322222111554o...',
    '........oo3322223322115o...',
    '..........ooo3132222221os..',
    '.............ooo11122ooo.ss',
    '................ooooo......',
  ] },
  X200: { a: [27, 3], r: [
    '.............ooooooo........',
    '...........oo3333444ooo.....',
    '.........oo3345555W4444o....',
    '........o335555555444455osss',
    '.......o3455554444455511o...',
    '.....oo44455444455511112o...',
    '....o344444445551113222o....',
    '...o344444555111222222o.....',
    '...o444455111222223221o.....',
    '..o44555111222322221oo......',
    '.o4551112Wq2222221oo........',
    'o44111322qQ2233ooo..........',
    'ooooooooooooooo.............',
  ] },
  X340: { a: [0, 2], r: [
    '........ooooooo.............',
    '.....ooo4443333oo...........',
    's...o4444W5555433oo.........',
    '.sso554444555555533o........',
    '...o1155544444555543o.......',
    '...o21111555444455444oo.....',
    '....o222311155544444443o....',
    '.....o222222111555444443o...',
    '.....o122322222111554444o...',
    '......oo12222322211155544o..',
    '........oo122222Wq22111554o.',
    '..........ooo332qQ222311144o',
    '.............ooooooooooooooo',
  ] },
  L15: { a: [0, 9], r: [
    '.......oooooooo.....',
    '.....oo35554444ooo..',
    '....o3555554444444oo',
    '....o5554445555511oo',
    '...o4W4455511Wq12o..',
    '...o455511132qQoo...',
    '..o4551122222oo.....',
    '..o51122332oo.......',
    'ssoo2222ooo.........',
    's...oooo............',
  ] },
  L40: { a: [0, 14], r: [
    '..........ooooo',
    '......oooo4454o',
    '....oo4444551o.',
    '...o355445511o.',
    '..o455445112o..',
    '.o3554551Wqo...',
    '.o5545513qQo...',
    '.oW4551222o....',
    'o44451222o.....',
    'o4451333o......',
    'o451222o.......',
    'o51122o........',
    '.ooooo.........',
    'ss.............',
    's..............',
  ] },
  L65: { a: [2, 17], r: [
    '.......ooo',
    '.....oo45o',
    '....o4451o',
    '...o44511o',
    '..o444512o',
    '.o5445122o',
    'o35545Wqo.',
    'o55451qQo.',
    'o5545122o.',
    'o5451122o.',
    'o545123o..',
    'oW45122o..',
    'o445121o..',
    'o45122o...',
    '.o512o....',
    '.oooo.....',
    '..ss......',
    '..s.......',
  ] },
  L115: { a: [10, 18], r: [
    '.oo........',
    '.o1o.......',
    'o451o......',
    'o4512o.....',
    'o4512o.....',
    'o45112o....',
    'o445Wq2o...',
    'o445qQ23o..',
    'o4545122o..',
    'o55451222o.',
    'o35545132o.',
    '.o5545112o.',
    '.o35545122o',
    '..o45W4512o',
    '...oo44551o',
    '.....ooo5o.',
    '........oos',
    '..........s',
    '..........s',
  ] },
  L140: { a: [15, 14], r: [
    'ooooo...........',
    'o4544oooo.......',
    '.o1554444oo.....',
    '.o115544553o....',
    '..o211544554o...',
    '...o2Wq554553o..',
    '...o3qQ155455o..',
    '....o2221554Wo..',
    '.....o22215444o.',
    '......o3331544o.',
    '.......o222154o.',
    '........o22115o.',
    '.........ooooo..',
    '..............ss',
    '...............s',
  ] },
  L165: { a: [20, 8], r: [
    '.....oooooooo........',
    '..ooo44445553oo......',
    'oo4444444555553o.....',
    'oo1155555444555o.....',
    '..o211Wq155544W4o....',
    '...oo2qQ31115554o....',
    '.....oo2222211554o...',
    '.......oo23322115o...',
    '.........ooo2222oosss',
    '............oooo.....',
  ] },
  L200: { a: [20, 1], r: [
    '........oooooooo.....',
    '......oo3555W444o...s',
    '.....o35555444455oss.',
    '....o445544455511o...',
    '...o444445551112o....',
    '..o4445551113222o....',
    '.o455511Wq2222oo.....',
    'o4551122qQ23oo.......',
    'oooooooooooo.........',
  ] },
  L340: { a: [0, 1], r: [
    '.....oooooooo........',
    'ss..o444W5553oo......',
    '..so55444455553o.....',
    '...o115554445544o....',
    '....o211155544444o...',
    '....o2223111555444o..',
    '.....oo22222Wq15554o.',
    '.......oo322qQ211554o',
    '.........oooooooooooo',
  ] },
  S15: { a: [0, 7], r: [
    '.......oo.....',
    '....ooo54ooo..',
    '...o55544455oo',
    '...oW4555511oo',
    '..o45511112o..',
    '..o511123oo...',
    '.soo22ooo.....',
    'ss..oo........',
  ] },
  S40: { a: [0, 10], r: [
    '......ooooo',
    '...ooo4455o',
    '..o454551o.',
    '.o454551o..',
    '.oW45512o..',
    '.o45513o...',
    '.o5512o....',
    '.o512o.....',
    '.oooo......',
    '.ss........',
    's..........',
  ] },
  S65: { a: [1, 13], r: [
    '.....oo',
    '...oo5o',
    '..o451o',
    '.o4451o',
    'o55512o',
    'o5451o.',
    'oW513o.',
    'o4512o.',
    'o4512o.',
    'o512o..',
    '.o1o...',
    '.oo....',
    '.ss....',
    '.s.....',
  ] },
  S115: { a: [7, 13], r: [
    'oo......',
    'oo......',
    'o5o.....',
    'o51o....',
    'o512o...',
    'o4513o..',
    'o5513o..',
    'o54512o.',
    'o55511o.',
    '.oW451o.',
    '..oo45o.',
    '....ooo.',
    '......ss',
    '.......s',
  ] },
  S140: { a: [11, 10], r: [
    'ooooo.......',
    'o5544ooo....',
    '.o155454o...',
    '..o155454o..',
    '..o21554Wo..',
    '...o31554o..',
    '....o2155o..',
    '.....o215o..',
    '......oooo..',
    '.........ss.',
    '...........s',
  ] },
  S165: { a: [13, 7], r: [
    '.....oo.......',
    '..ooo45ooo....',
    'oo55444555o...',
    'oo1155554Wo...',
    '..o21111554o..',
    '...oo321115o..',
    '.....ooo22ooss',
    '........oo...s',
  ] },
  S200: { a: [14, 1], r: [
    '......ooo......',
    '....oo55Woo...s',
    '...o5554455oss.',
    '..o44455511o...',
    '.o45551112o....',
    'o55111222o.....',
    'ooooooooo......',
  ] },
  S340: { a: [0, 1], r: [
    '......ooo......',
    'ss..ooW55oo....',
    '..so5544555o...',
    '...o11555444o..',
    '....o21115554o.',
    '.....o22211155o',
    '......ooooooooo',
  ] },
};
const ANGLES = [15, 40, 65, 115, 140, 165, 200, 340];

function nearestHi(c) {
  return withHi(c, () => {
    const hc = makeCanvas(c.width * HI, c.height * HI);
    const g = ctxOf(hc);
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, hc.width, hc.height);
    return hc;
  });
}

const cache = new Map();
function cached(key, build) {
  let c = cache.get(key);
  if (!c) { c = build(); cache.set(key, c); if (cache.size > 160) cache.delete(cache.keys().next().value); }
  return c;
}

// paint one leaf's art into g at (x, y) = its stem end
function paint(g, name, tone, x, y) {
  const A = ART[name], P = PAL[tone] || PAL.leaf;
  const x0 = x - A.a[0], y0 = y - A.a[1];
  for (let yy = 0; yy < A.r.length; yy++) {
    const row = A.r[yy];
    for (let xx = 0; xx < row.length; xx++) {
      const col = P[row[xx]];
      if (!col) continue;
      g.fillStyle = col; g.fillRect(x0 + xx, y0 + yy, 1, 1);
    }
  }
}

function leafSprite(name, tone) {
  return cached(`l|${name}|${tone}`, () => {
    const A = ART[name];
    const c = makeCanvas(A.r[0].length, A.r.length);
    paint(ctxOf(c), name, tone, A.a[0], A.a[1]);
    c.ax = A.a[0]; c.ay = A.a[1];
    return nearestHi(c);
  });
}

// screen angle (y down, as drawAeroLeaf) -> the nearest hand-drawn angle (counter-clockwise, y up)
function pickAngle(screenDeg) {
  const a = ((-screenDeg % 360) + 360) % 360;
  let best = ANGLES[0], bd = 999;
  for (const b of ANGLES) { const d = Math.min(Math.abs(a - b), 360 - Math.abs(a - b)); if (d < bd) { bd = d; best = b; } }
  return best;
}

export function drawPixLeaf(ctx, x, y, len, angleDeg, o = {}) {
  const name = (len >= 24 ? 'X' : len >= 15 ? 'L' : 'S') + pickAngle(angleDeg);
  const c = leafSprite(name, o.tone || 'leaf');
  const s = Math.max(1, Math.floor((len || 14) / (len >= 24 ? 28 : len >= 15 ? 20 : 14) + 0.25));
  ctx.drawImage(c, Math.round(x - c.ax * s), Math.round(y - c.ay * s), c.width * s, c.height * s);
}

// ---------------------------------------------------------------- clusters
// Hand-placed twigs. Coordinates are art px from the twig base; y grows downwards. Each leaf: [name, x, y, tone,
// sway] where sway lists its offset in frames 1 and 2 (frame 0 = rest). Leaves draw in order (back ones first).
const TWIG = {
  tr: [[0, 0], [1, 0], [2, -1], [3, -1], [4, -2], [5, -2], [6, -3], [7, -3], [8, -4], [9, -4], [10, -5], [11, -5], [12, -5]],
};
TWIG.tl = TWIG.tr.map(([x, y]) => [-x, y]);
TWIG.br = TWIG.tr;
TWIG.bl = TWIG.tl;
const CL = {
  tr: [
    ['L140', 2, -1, 'deep', [[0, 0], [-1, 0]]],
    ['S65', 7, -3, 'deep', [[0, -1], [0, -1]]],
    ['L40', 4, -2, 'leaf', [[1, 0], [1, -1]]],
    ['S340', 8, -4, 'lime', [[0, 1], [1, 1]]],
    ['L15', 12, -5, 'lime', [[1, 0], [1, 1]]],
  ],
  tl: [
    ['L40', -2, -1, 'deep', [[0, 0], [1, 0]]],
    ['S115', -7, -3, 'deep', [[0, -1], [0, -1]]],
    ['L140', -4, -2, 'leaf', [[-1, 0], [-1, -1]]],
    ['S200', -8, -4, 'lime', [[0, 1], [-1, 1]]],
    ['L165', -12, -5, 'lime', [[-1, 0], [-1, 1]]],
  ],
  // bottom corners: the twig runs out sideways and a little up (so a window low on the screen keeps its leaves)
  br: [
    ['L340', 3, -1, 'deep', [[1, 0], [1, 1]]],
    ['S40', 7, -3, 'deep', [[0, -1], [1, -1]]],
    ['L15', 12, -5, 'lime', [[1, 0], [1, 1]]],
    ['S65', 10, -4, 'leaf', [[0, -1], [0, -1]]],
  ],
  bl: [
    ['L200', -3, -1, 'deep', [[-1, 0], [-1, 1]]],
    ['S140', -7, -3, 'deep', [[0, -1], [-1, -1]]],
    ['L165', -12, -5, 'lime', [[-1, 0], [-1, 1]]],
    ['S115', -10, -4, 'leaf', [[0, -1], [0, -1]]],
  ],
};
// the layouts above are written for the 'S' cluster (L = 20 px leaves, S = 14 px); the 'L' cluster uses the 28 px
// leaves (X) for the big ones and spreads the twig 1.4x
const UP = { L: 'X', S: 'L' };
function clusterSpec(corner, size) {
  const big = size !== 'S', k = big ? 1.4 : 1;
  const leaves = (CL[corner] || CL.tr).map(([n, x, y, tone, sw]) => [big ? UP[n[0]] + n.slice(1) : n, Math.round(x * k), Math.round(y * k), tone, sw]);
  const tw = TWIG[corner] || TWIG.tr, twig = [];
  const sx = Math.sign(tw[tw.length - 1][0]), n = Math.round((tw.length - 1) * k);
  for (let i = 0; i <= n; i++) twig.push([i * sx, Math.round(tw[Math.min(tw.length - 1, Math.floor(i / k))][1] * k)]);
  return { leaves, twig };
}

function bounds(spec) {
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1;
  for (const [n, x, y] of spec.leaves) {
    const A = ART[n];
    x0 = Math.min(x0, x - A.a[0] - 1); y0 = Math.min(y0, y - A.a[1] - 1);
    x1 = Math.max(x1, x - A.a[0] + A.r[0].length + 1); y1 = Math.max(y1, y - A.a[1] + A.r.length + 1);
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

export function clusterSize(corner, size = 'L') { const b = bounds(clusterSpec(corner, size)); return { w: b.w, h: b.h }; }

export function leafCluster(corner = 'tr', size = 'L', frame = 0) {
  return cached(`c|${corner}|${size}|${frame}`, () => {
    const spec = clusterSpec(corner, size), b = bounds(spec);
    const c = makeCanvas(b.w, b.h), g = ctxOf(c);
    const ox = -b.x0, oy = -b.y0;
    // the twig: a 2 px stem, dark under a light top edge
    for (const [x, y] of spec.twig) { g.fillStyle = '#1e4a14'; g.fillRect(ox + x, oy + y, 1, 2); }
    for (const [x, y] of spec.twig) { g.fillStyle = '#6cb83a'; g.fillRect(ox + x, oy + y, 1, 1); }
    for (const [n, x, y, tone, sw] of spec.leaves) {
      const d = frame > 0 ? sw[frame - 1] : [0, 0];
      paint(g, n, tone, ox + x + d[0], oy + y + d[1]);
    }
    c.ax = ox; c.ay = oy;
    return nearestHi(c);
  });
}

// frame from time: rest, lean, lean more, lean (a slow ping-pong, ~2.6 s per cycle)
function frameAt(t, phase) {
  const i = Math.floor(((t || 0) * 1.55 + (phase || 0) * 3.1)) % 4;
  return i === 3 ? 1 : (i + 4) % 4;
}

export function drawLeafCluster(ctx, corner, x, y, o = {}) {
  const f = o.still ? 0 : frameAt(o.t ?? performance.now() / 1000, o.phase);
  const c = leafCluster(corner, o.size || 'L', f);
  const s = Math.max(1, Math.round(o.scale || 1));
  const w = c.width * s, h = c.height * s;
  const dx = o.center ? x - w / 2 : x - c.ax * s, dy = o.center ? y - h / 2 : y - c.ay * s;
  ctx.drawImage(c, Math.round(dx), Math.round(dy), w, h);
  return { x: Math.round(dx), y: Math.round(dy), w, h };
}
