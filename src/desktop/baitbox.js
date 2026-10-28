// Procedural pixel-art wooden bait box (body + closed/open lid).

import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack, ramp } from '../core/color.js';
import { hash2, bayer } from '../core/math.js';
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';

const WOOD = ramp('#b8794a', 1.1).map((h) => pack(h));
const WOOD_D = ramp('#8a5532', 1).map((h) => pack(h));
const METAL = ramp('#8a96a8', 1.2).map((h) => pack(h));

function planks(buf, x0, y0, w, h, R, plankH = 6, seed = 1) {
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / plankH);
    const inRow = y % plankH;
    for (let x = 0; x < w; x++) {
      let light = 0.55 + 0.12 * Math.sin((x + row * 13) * 0.35 + hash2(row, 0, seed) * 6) + (hash2(x >> 2, row, seed) - 0.5) * 0.12;
      if (inRow === 0) light += 0.18;
      if (inRow === plankH - 1) light -= 0.3;
      const grain = Math.sin(x * 0.9 + Math.sin(y * 0.7 + row) * 2 + row * 5);
      if (grain > 0.85) light -= 0.15;
      const idx = Math.max(0, Math.min(4, Math.floor(light * 4.99 + (bayer(x, y) - 0.5) * 0.6)));
      buf.set(x0 + x, y0 + y, R[idx]);
    }
  }
}

function corners(buf, x0, y0, w, h) {
  for (const [cx, cy] of [[x0, y0], [x0 + w - 4, y0], [x0, y0 + h - 4], [x0 + w - 4, y0 + h - 4]]) {
    buf.rect(cx, cy, 4, 4, METAL[2]);
    buf.set(cx + 1, cy + 1, METAL[4]);
    buf.set(cx + 2, cy + 2, METAL[0]);
  }
}

export function makeBaitBoxSprites() {
  const W = 52, BH = 26;
  // body
  const body = new PixelBuffer(W, BH + 2);
  planks(body, 0, 0, W, BH, WOOD, 6, 3);
  corners(body, 0, 0, W, BH);
  // dark interior rim at top
  body.rect(2, 0, W - 4, 2, WOOD_D[0]);
  // rope handle
  for (let x = 18; x < 34; x++) body.set(x, 12 + Math.round(Math.sin((x - 18) / 16 * Math.PI) * 3), pack('#e8d2a0'));
  body.outline(selOut(0.75));
  const bodyC = body.toCanvas();
  const g = ctxOf(bodyC);
  drawText(g, 'BAIT', W / 2, 16, { font: 'small', align: 'center', color: '#5a3018' });
  drawText(g, 'BAIT', W / 2, 15, { font: 'small', align: 'center', color: '#f4d8a8' });

  // closed lid
  const lidC = new PixelBuffer(W + 4, 9);
  planks(lidC, 1, 1, W + 2, 7, WOOD, 7, 9);
  lidC.rect(W / 2 - 2, 6, 6, 3, METAL[2]);
  lidC.set(W / 2, 7, METAL[0]);
  lidC.outline(selOut(0.75));

  // open lid (tilted back, seen from the inside)
  const lidO = new PixelBuffer(W + 4, 16);
  for (let y = 0; y < 13; y++) {
    const inset = Math.round((13 - y) * 0.35);
    for (let x = 1 + inset; x < W + 3 - inset; x++) {
      const idx = Math.max(0, Math.min(4, Math.floor((0.35 + y * 0.02 + (hash2(x >> 2, y >> 2, 4) - 0.5) * 0.1) * 4.99 + (bayer(x, y) - 0.5) * 0.6)));
      lidO.set(x, y + 1, WOOD_D[idx]);
    }
  }
  lidO.outline(selOut(0.75));
  return { body: bodyC, lidClosed: lidC.toCanvas(), lidOpen: lidO.toCanvas() };
}
