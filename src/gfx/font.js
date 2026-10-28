// Hand-authored bitmap fonts. Glyph rows are separated by '|', '#' = ink.
// Inline sprite tokens like {coin} are supported by drawText via registerInlineIcon.

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

export const FONTS = {
  normal: buildFont(NORMAL_DEF),
  small: buildFont(SMALL_DEF),
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

export function measureText(text, fontName = 'normal', scale = 1) {
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
  return FONTS[fontName].lineHeight * scale;
}

// Core glyph blitter. (x, y) = top-left of the cap height box.
function blit(ctx, text, x, y, font, color, scale, wave, time) {
  const atlas = tintAtlas(font, color);
  let cx = x, cy = y, i = 0;
  for (const t of tokenize(text)) {
    if (t.icon) {
      const ic = inlineIcons.get(t.icon);
      const ih = ic.canvas.height;
      const oy = Math.round((font.height - ih) / 2) + ic.dy;
      ctx.drawImage(ic.canvas, Math.round(cx), Math.round(cy + oy * scale), ic.canvas.width * scale, ih * scale);
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
 * opts: color, font ('normal'|'small'), align ('left'|'center'|'right'), scale,
 *       shadow (color), outline (color), wave (px), time
 */
export function drawText(ctx, text, x, y, opts = {}) {
  text = String(text);
  const font = FONTS[opts.font || 'normal'];
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
      blit(ctx, text, x + dx * scale, y + dy * scale, font, opts.outline, scale, opts.wave, time);
    }
  }
  if (opts.shadow) blit(ctx, text, x + scale, y + scale, font, opts.shadow, scale, opts.wave, time);
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
