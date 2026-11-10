// Hand-authored bitmap fonts. Glyph rows are separated by '|', '#' = ink.
// Faces: 'small' (5 px caps, uppercase), 'normal' (7 px caps), 'big' (phase 6: bold 9 px caps for the enlarged UI;
// pick faces through uiFont()/fitFont() in src/ui/aero.js so they follow the Settings > UI size choice).
// Inline sprite tokens like {aero} / {coin} (the Aero drop) are supported by drawText via registerInlineIcon.

import { makeCanvas, ctxOf } from '../core/canvas.js';

const NORMAL_DEF = {
  height: 7, descent: 2, lineHeight: 11, spacing: 1, space: 3,
  glyphs: {
    A: '.##.|#..#|#..#|####|#..#|#..#|#..#',
    B: '###.|#..#|#..#|###.|#..#|#..#|###.',
    C: '.##.|#..#|#...|#...|#...|#..#|.##.',
    D: '###.|#..#|#..#|#..#|#..#|#..#|###.',
    E: '####|#...|#...|###.|#...|#...|####',
    F: '####|#...|#...|###.|#...|#...|#...',
    G: '.##.|#..#|#...|#.##|#..#|#..#|.###',
    H: '#..#|#..#|#..#|####|#..#|#..#|#..#',
    I: '###|.#.|.#.|.#.|.#.|.#.|###',
    J: '..##|...#|...#|...#|#..#|#..#|.##.',
    K: '#..#|#..#|#.#.|##..|#.#.|#..#|#..#',
    L: '#...|#...|#...|#...|#...|#...|####',
    M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
    N: '#..#|##.#|##.#|#.##|#.##|#..#|#..#',
    O: '.##.|#..#|#..#|#..#|#..#|#..#|.##.',
    P: '###.|#..#|#..#|###.|#...|#...|#...',
    Q: '.##.|#..#|#..#|#..#|#..#|#.#.|.#.#',
    R: '###.|#..#|#..#|###.|#.#.|#..#|#..#',
    S: '.###|#...|#...|.##.|...#|...#|###.',
    T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
    U: '#..#|#..#|#..#|#..#|#..#|#..#|.##.',
    V: '#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..',
    W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
    X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
    Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
    Z: '####|...#|..#.|..#.|.#..|#...|####',
    a: '....|....|.##.|...#|.###|#..#|.###',
    b: '#...|#...|###.|#..#|#..#|#..#|###.',
    c: '...|...|.##|#..|#..|#..|.##',
    d: '...#|...#|.###|#..#|#..#|#..#|.###',
    e: '....|....|.##.|#..#|####|#...|.##.',
    f: '.##|#..|###|#..|#..|#..|#..',
    g: '....|....|.###|#..#|#..#|#..#|.###|...#|.##.',
    h: '#...|#...|###.|#..#|#..#|#..#|#..#',
    i: '#|.|#|#|#|#|#',
    j: '.#|..|.#|.#|.#|.#|.#|.#|#.',
    k: '#...|#...|#..#|#.#.|##..|#.#.|#..#',
    l: '#.|#.|#.|#.|#.|#.|.#',
    m: '.....|.....|####.|#.#.#|#.#.#|#.#.#|#.#.#',
    n: '....|....|###.|#..#|#..#|#..#|#..#',
    o: '....|....|.##.|#..#|#..#|#..#|.##.',
    p: '....|....|###.|#..#|#..#|#..#|###.|#...|#...',
    q: '....|....|.###|#..#|#..#|#..#|.###|...#|...#',
    r: '....|....|#.##|##..|#...|#...|#...',
    s: '....|....|.###|#...|.##.|...#|###.',
    t: '.#.|.#.|###|.#.|.#.|.#.|..#',
    u: '....|....|#..#|#..#|#..#|#..#|.###',
    v: '.....|.....|#...#|#...#|.#.#.|.#.#.|..#..',
    w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.',
    x: '....|....|#..#|#..#|.##.|#..#|#..#',
    y: '....|....|#..#|#..#|#..#|#..#|.###|...#|.##.',
    z: '....|....|####|...#|.##.|#...|####',
    0: '.##.|#..#|#..#|#..#|#..#|#..#|.##.',
    1: '.#.|##.|.#.|.#.|.#.|.#.|###',
    2: '.##.|#..#|...#|..#.|.#..|#...|####',
    3: '###.|...#|...#|.##.|...#|...#|###.',
    4: '#..#|#..#|#..#|####|...#|...#|...#',
    5: '####|#...|#...|###.|...#|...#|###.',
    6: '.##.|#...|#...|###.|#..#|#..#|.##.',
    7: '####|...#|...#|..#.|..#.|.#..|.#..',
    8: '.##.|#..#|#..#|.##.|#..#|#..#|.##.',
    9: '.##.|#..#|#..#|.###|...#|...#|.##.',
    '.': '.|.|.|.|.|.|#',
    ',': '.|.|.|.|.|.|#|#',
    '!': '#|#|#|#|#|.|#',
    '?': '.##.|#..#|...#|..#.|.#..|....|.#..',
    "'": '#|#|.|.|.|.|.',
    '"': '#.#|#.#|...|...|...|...|...',
    ':': '.|.|.|#|.|.|#',
    ';': '.|.|.|#|.|.|#|#',
    '-': '...|...|...|###|...|...|...',
    '+': '...|...|.#.|###|.#.|...|...',
    '=': '...|...|###|...|###|...|...',
    '/': '..#|..#|.#.|.#.|.#.|#..|#..',
    '\\': '#..|#..|.#.|.#.|.#.|..#|..#',
    '(': '.#|#.|#.|#.|#.|#.|.#',
    ')': '#.|.#|.#|.#|.#|.#|#.',
    '[': '##|#.|#.|#.|#.|#.|##',
    ']': '##|.#|.#|.#|.#|.#|##',
    '<': '...|..#|.#.|#..|.#.|..#|...',
    '>': '...|#..|.#.|..#|.#.|#..|...',
    '%': '##..#|##.#.|...#.|..#..|.#...|.#.##|#..##',
    '#': '.#.#.|#####|.#.#.|.#.#.|#####|.#.#.|.....',
    '*': '...|#.#|.#.|#.#|...|...|...',
    '_': '....|....|....|....|....|....|####',
    '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
    $: '.#.|###|#..|###|..#|###|.#.',
    '^': '.#.|#.#|...|...|...|...|...',
    '~': '....|....|.#.#|#.#.|....|....|....',
    '|': '#|#|#|#|#|#|#',
    '`': '#.|.#|..|..|..|..|..',
    '{': '.##|.#.|.#.|#..|.#.|.#.|.##',
    '}': '##.|.#.|.#.|..#|.#.|.#.|##.',
    '@': '.###.|#...#|#.###|#.#.#|#.###|#....|.###.',
    '×': '...|...|#.#|.#.|#.#|...|...',
    '•': '..|..|..|##|##|..|..',
  },
};

const SMALL_DEF = {
  height: 5, descent: 1, lineHeight: 7, spacing: 1, space: 2, upper: true,
  glyphs: {
    A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.',
    E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..', G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#',
    I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
    M: '#...#|##.##|#.#.#|#...#|#...#', N: '#..#|##.#|#.##|#..#|#..#', O: '.#.|#.#|#.#|#.#|.#.', P: '##.|#.#|##.|#..|#..',
    Q: '.#.|#.#|#.#|##.|.##', R: '##.|#.#|##.|#.#|#.#', S: '.##|#..|.#.|..#|##.', T: '###|.#.|.#.|.#.|.#.',
    U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#...#|#...#|#.#.#|#.#.#|.#.#.', X: '#.#|#.#|.#.|#.#|#.#',
    Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
    0: '###|#.#|#.#|#.#|###', 1: '.#.|##.|.#.|.#.|###', 2: '##.|..#|.#.|#..|###', 3: '##.|..#|.#.|..#|##.',
    4: '#.#|#.#|###|..#|..#', 5: '###|#..|##.|..#|##.', 6: '.##|#..|###|#.#|###', 7: '###|..#|.#.|.#.|.#.',
    8: '###|#.#|###|#.#|###', 9: '###|#.#|###|..#|##.',
    '.': '.|.|.|.|#', ',': '.|.|.|#|#', '!': '#|#|#|.|#', '?': '##.|..#|.#.|...|.#.', ':': '.|#|.|#|.',
    '-': '...|...|###|...|...', '+': '...|.#.|###|.#.|...', '/': '..#|..#|.#.|#..|#..', '%': '#.#|..#|.#.|#..|#.#',
    "'": '#|#|.|.|.', '(': '.#|#.|#.|#.|.#', ')': '#.|.#|.#|.#|#.', '"': '#.#|#.#|...|...|...',
    '#': '#.#|###|#.#|###|#.#', '*': '#.#|.#.|#.#|...|...', '<': '..#|.#.|#..|.#.|..#', '>': '#..|.#.|..#|.#.|#..',
    '=': '...|###|...|###|...', '_': '...|...|...|...|###', '&': '.#.|#.#|.#.|#.#|.##', $: '.##|##.|.#.|.##|##.',
    '×': '...|#.#|.#.|#.#|...', '[': '##|#.|#.|#.|##', ']': '##|.#|.#|.#|##',
  },
};

function buildFont(def) {
  const entries = [];
  let atlasW = 0;
  for (const [ch, src] of Object.entries(def.glyphs)) {
    const rows = src.split('|');
    const w = rows[0].length;
    entries.push({ ch, rows, w, x: atlasW });
    atlasW += w + 1;
  }
  const atlasH = def.height + def.descent;
  const canvas = makeCanvas(atlasW, atlasH);
  const g = ctxOf(canvas);
  g.fillStyle = '#fff';
  const glyphs = new Map();
  for (const e of entries) {
    e.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect(e.x + x, y, 1, 1);
    });
    glyphs.set(e.ch, { x: e.x, w: e.w, h: e.rows.length });
  }
  return { ...def, atlas: canvas, glyphs, tints: new Map(), atlasH };
}

// [phase6:ui] 'big': a bold 9 px cap-height face for the enlarged UI (x-height 6, 3 px descenders, 2 px stems).
// Derived from the normal glyphs (rows 1 and 5 doubled, a middle column inserted on 4-wide glyphs, emboldened one
// pixel to the right) plus hand-drawn overrides where diagonals would clog up.
const BIG_OVERRIDES = {
  M: '##...##|###.###|#######|##.#.##|##.#.##|##...##|##...##|##...##|##...##',
  N: '##...##|###..##|###..##|####.##|##.####|##..###|##..###|##...##|##...##',
  W: '##...##|##...##|##...##|##...##|##.#.##|##.#.##|#######|###.###|##...##',
  V: '##..##|##..##|##..##|##..##|##..##|##..##|.####.|.####.|..##..',
  m: '........|........|........|#######.|##.##.##|##.##.##|##.##.##|##.##.##|##.##.##',
  v: '......|......|......|##..##|##..##|##..##|##..##|.####.|..##..',
  w: '........|........|........|##....##|##....##|##.##.##|##.##.##|########|.##..##.',
  x: '......|......|......|##..##|.####.|..##..|..##..|.####.|##..##',
  c: '.....|.....|.....|.####|##...|##...|##...|##...|.####',
  7: '######|....##|....##|...##.|...##.|..##..|..##..|..##..|..##..',
  '+': '......|......|..##..|..##..|######|..##..|..##..|......|......',
  '*': '......|.#..#.|..##..|######|..##..|.#..#.|......|......|......',
  '%': '##...##|##..##.|...##..|...##..|..##...|..##...|.##..##|##...##|.......',
  $: '..##..|.#####|##....|##....|.####.|....##|....##|#####.|..##..',
  '#': '.##.##.|.##.##.|#######|.##.##.|.##.##.|#######|.##.##.|.##.##.|.......',
  '×': '......|......|##..##|.####.|..##..|.####.|##..##|......|......',
  '•': '....|....|....|.##.|####|####|.##.|....|....',
};
function bigGlyphs() {
  const ROWS = [0, 1, 1, 2, 3, 4, 5, 5, 6];
  const out = {};
  for (const [ch, src] of Object.entries(NORMAL_DEF.glyphs)) {
    if (BIG_OVERRIDES[ch]) { out[ch] = BIG_OVERRIDES[ch]; continue; }
    const rows = src.split('|');
    let r = ROWS.map((i) => rows[i]);
    if (rows.length === 9) r.push(rows[7], rows[7], rows[8]);
    else if (rows.length === 8) r.push(rows[7], rows[7]);
    const w = r[0].length;
    const cols = w === 4 ? [0, 1, 1, 2, 3] : [...Array(w).keys()];
    r = r.map((row) => cols.map((c) => row[c]).join(''));
    r = r.map((row) => { let s = ''; for (let x = 0; x <= row.length; x++) s += row[x] === '#' || row[x - 1] === '#' ? '#' : '.'; return s; });
    out[ch] = r.join('|');
  }
  return out;
}
const BIG_DEF = { height: 9, descent: 3, lineHeight: 14, spacing: 1, space: 4, glyphs: bigGlyphs() };

export const FONTS = {
  normal: buildFont(NORMAL_DEF),
  small: buildFont(SMALL_DEF),
  big: buildFont(BIG_DEF), // [phase6:ui]
};

function tintAtlas(font, color) {
  let c = font.tints.get(color);
  if (!c) {
    c = makeCanvas(font.atlas.width, font.atlas.height);
    const g = ctxOf(c);
    g.drawImage(font.atlas, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    font.tints.set(color, c);
  }
  return c;
}

// Inline icons: {name} inside text renders a sprite.
const inlineIcons = new Map();
export function registerInlineIcon(name, canvas, dy = 0) {
  inlineIcons.set(name, { canvas, dy });
}

function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      const j = text.indexOf('}', i);
      if (j > i) {
        const name = text.slice(i + 1, j);
        if (inlineIcons.has(name)) {
          out.push({ icon: name });
          i = j + 1;
          continue;
        }
      }
    }
    out.push({ ch });
    i++;
  }
  return out;
}

function glyphFor(font, ch) {
  if (font.upper) ch = ch.toUpperCase();
  return font.glyphs.get(ch) || (ch === ' ' ? null : font.glyphs.get('?'));
}

// [phase8:ui] Bigger text: while the bump is on (UI size Big / Huge), the tiny 5 px 'small' face is drawn with the 7 px
// 'normal' glyphs in capitals (the same look, ~40% larger). measureText / wrapText / lineHeight follow, so layouts
// that measure stay consistent. setTextBump(on), textBump() -> bool, faceOf(name) -> the face actually used.
let bump = true;
export function setTextBump(on) { bump = !!on; }
export function textBump() { return bump; }
export function faceOf(name = 'normal') { return bump && name === 'small' ? 'normal' : name; }
const upper = (name, text) => (bump && name === 'small' ? String(text).replace(/\{[^}]*\}|[^{]+/g, (m) => (m[0] === '{' ? m : m.toUpperCase())) : text);

export function measureText(text, fontName = 'normal', scale = 1) {
  text = upper(fontName, text);
  fontName = faceOf(fontName);
  const font = FONTS[fontName];
  let w = 0, maxW = 0;
  for (const t of tokenize(String(text))) {
    if (t.icon) { w += inlineIcons.get(t.icon).canvas.width + font.spacing; continue; }
    if (t.ch === '\n') { maxW = Math.max(maxW, w); w = 0; continue; }
    if (t.ch === ' ') { w += font.space + font.spacing; continue; }
    const g = glyphFor(font, t.ch);
    w += (g ? g.w : font.space) + font.spacing;
  }
  maxW = Math.max(maxW, w);
  return Math.max(0, maxW - font.spacing) * scale;
}

export function lineHeight(fontName = 'normal', scale = 1) {
  return FONTS[faceOf(fontName)].lineHeight * scale;
}

// Core glyph blitter. (x, y) = top-left of the cap height box.
// icons = false for shadow / outline passes: inline sprites only advance the pen there (no smeared copies).
function blit(ctx, text, x, y, font, color, scale, wave, time, icons = true) {
  const atlas = tintAtlas(font, color);
  let cx = x, cy = y, i = 0;
  for (const t of tokenize(text)) {
    if (t.icon) {
      const ic = inlineIcons.get(t.icon);
      const ih = ic.canvas.height;
      const oy = Math.round((font.height - ih) / 2) + ic.dy;
      if (icons) ctx.drawImage(ic.canvas, Math.round(cx), Math.round(cy + oy * scale), ic.canvas.width * scale, ih * scale);
      cx += (ic.canvas.width + font.spacing) * scale;
      continue;
    }
    if (t.ch === '\n') { cx = x; cy += font.lineHeight * scale; continue; }
    if (t.ch === ' ') { cx += (font.space + font.spacing) * scale; i++; continue; }
    const g = glyphFor(font, t.ch);
    if (!g) { cx += (font.space + font.spacing) * scale; continue; }
    const wy = wave ? Math.round(Math.sin(time * 6 + i * 0.7) * wave) : 0;
    ctx.drawImage(atlas, g.x, 0, g.w, g.h, Math.round(cx), Math.round(cy + wy), g.w * scale, g.h * scale);
    cx += (g.w + font.spacing) * scale;
    i++;
  }
}

/**
 * drawText(ctx, text, x, y, opts)
 * opts: color, font ('normal'|'small'|'big'), align ('left'|'center'|'right'), scale,
 *       shadow (color), outline (color), wave (px), time
 */
export function drawText(ctx, text, x, y, opts = {}) {
  text = upper(opts.font, String(text));
  const font = FONTS[faceOf(opts.font || 'normal')];
  const scale = opts.scale || 1;
  const color = opts.color || '#ffffff';
  if (opts.align && opts.align !== 'left') {
    const w = measureText(text, opts.font || 'normal', scale);
    x -= opts.align === 'center' ? Math.floor(w / 2) : w;
  }
  x = Math.round(x); y = Math.round(y);
  const time = opts.time || 0;
  if (opts.outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      blit(ctx, text, x + dx * scale, y + dy * scale, font, opts.outline, scale, opts.wave, time, false);
    }
  }
  if (opts.shadow) blit(ctx, text, x + scale, y + scale, font, opts.shadow, scale, opts.wave, time, false);
  blit(ctx, text, x, y, font, color, scale, opts.wave, time);
}

// Word wrap to a max pixel width; returns array of lines.
export function wrapText(text, maxW, fontName = 'normal') {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (measureText(test, fontName) > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function drawWrapped(ctx, text, x, y, maxW, opts = {}) {
  const lines = wrapText(text, maxW, opts.font || 'normal');
  const lh = (opts.lineHeight || lineHeight(opts.font || 'normal')) * (opts.scale || 1);
  lines.forEach((l, i) => drawText(ctx, l, x, y + i * lh, opts));
  return lines.length * lh;
}
