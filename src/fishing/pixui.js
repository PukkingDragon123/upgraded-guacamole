// [fishui30] Square pixel-art kit for the fishing HUD (meter, catch tube, SHOCK button, banners, bite sign, depth
// gauge). Everything is square: stepped corners, 1 px ink outlines, banded (never gradient) shading, lit top-left and
// shaded bottom-right bevels. No arcs, no circles, no soft round glows: highlights are stepped square halos.
//
//   pxFrame(ctx, x, y, w, h, o)        a stepped-corner panel drawn with a handful of fillRects (cheap, no cache).
//                                      o: {u (pixel unit), step (corner steps 1..3), ink, rim [light, mid, dark],
//                                      fill [top, mid, bottom] bands, bevel (0 = none), alpha}
//   pxHalo(ctx, cx, cy, w, h, col, a)  a stepped square halo (3 nested rects, fading) instead of a round glow
//   pxDiamond(ctx, cx, cy, r, col, o)  a pixel diamond badge (rarity pips, charge pips)
//   pxCaret(ctx, x, y, s, dir, col)    a small stepped triangle pointer (dir 'down' | 'up' | 'left' | 'right')
//   pxStripes(ctx, x, y, w, h, a, b, s, t)   hazard stripes (diagonal steps), scrolling with t
//   PAL                                 the shared fishing-HUD palette
//   unitOf(S)                           the HUD pixel unit for a screen scale S

import { rgba } from '../core/color.js';

export const PAL = {
  ink: '#08203a',
  inkSoft: '#123a5c',
  rim: ['#b8ecff', '#4a9ccc', '#1f5a8a'], // steel-blue frame: light, mid, dark
  navy: ['#2a5f8c', '#174a74', '#0e3558'], // panel fill bands
  water: ['#a8f0ff', '#5fd0f4', '#2ea8e4', '#1a7cc8', '#0f569c', '#0a3c74'], // light -> deep
  calm: ['#e6fff4', '#aef6d8', '#6ee8bc', '#3ccc9c', '#21a07c'],
  coral: ['#ffc2b0', '#ff8a74', '#f0584a', '#c03440'],
  amber: ['#ffe2a0', '#ffb04a', '#f08428', '#b85818'],
  gold: ['#fffbd0', '#ffe46a', '#ffc81e', '#e8920a', '#a85a06'],
  steel: ['#f0f8ff', '#c2d6e6', '#8aa4bc', '#5a7490', '#3a5068'],
  lime: ['#f0ffc8', '#c8f56a', '#8ad83a', '#4fae2a', '#2e7a1e'],
  foam: '#f4fdff',
  kelp: ['#b8e860', '#6cc23a', '#3a8a2a', '#1f5a22'],
};

export const unitOf = (S) => Math.max(1, Math.round(S));

// A stepped-corner panel. Corner steps cut 1 unit per row (step 2 -> a 2-row staircase). Fill is three flat bands.
export function pxFrame(ctx, x, y, w, h, o = {}) {
  const u = o.u ?? 1, st = Math.max(1, o.step ?? 2), c = u * st;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const a0 = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = a0 * o.alpha;
  // ink silhouette: a staircase at each corner
  ctx.fillStyle = o.ink || PAL.ink;
  for (let i = 0; i <= st; i++) ctx.fillRect(x + (st - i) * u, y + i * u, w - 2 * (st - i) * u, h - 2 * i * u);
  // inside (inset one unit): three flat bands, then the inner corner staircase is re-inked
  const ix = x + u, iy = y + u, iw = w - 2 * u, ih = h - 2 * u, ic = st - 1;
  const fill = o.fill || PAL.navy;
  const bt = Math.max(u, Math.round(ih * (o.topK ?? 0.34))), bb = Math.max(u, Math.round(ih * (o.botK ?? 0.28)));
  ctx.fillStyle = fill[0]; ctx.fillRect(ix, iy, iw, bt);
  ctx.fillStyle = fill[1]; ctx.fillRect(ix, iy + bt, iw, ih - bt - bb);
  ctx.fillStyle = fill[2]; ctx.fillRect(ix, iy + ih - bb, iw, bb);
  if (o.bevel !== 0) {
    const rim = o.rim || PAL.rim;
    ctx.fillStyle = rim[0];
    ctx.fillRect(ix, iy, iw, u); ctx.fillRect(ix, iy, u, ih);
    ctx.fillStyle = rim[2];
    ctx.fillRect(ix, iy + ih - u, iw, u); ctx.fillRect(ix + iw - u, iy + u, u, ih - u);
  }
  if (ic > 0) {
    ctx.fillStyle = o.ink || PAL.ink;
    for (let r = 0; r < ic; r++) {
      const k = (ic - r) * u;
      ctx.fillRect(ix, iy + r * u, k, u); ctx.fillRect(ix + iw - k, iy + r * u, k, u);
      ctx.fillRect(ix, iy + ih - (r + 1) * u, k, u); ctx.fillRect(ix + iw - k, iy + ih - (r + 1) * u, k, u);
    }
    if (o.bevel !== 0) { // the staircase edge catches the light (top-left) / falls into shade (bottom-right)
      const rim = o.rim || PAL.rim;
      for (let r = 0; r < ic; r++) {
        const k = (ic - r) * u;
        ctx.fillStyle = rim[0]; ctx.fillRect(ix + k, iy + r * u, u, u); ctx.fillRect(ix + k - u, iy + (r + 1) * u, u, u);
        ctx.fillStyle = rim[2]; ctx.fillRect(ix + iw - k - u, iy + ih - (r + 1) * u, u, u); ctx.fillRect(ix + iw - k, iy + ih - (r + 2) * u, u, u);
      }
    }
  }
  ctx.globalAlpha = a0;
}

// A stepped square halo: three nested rectangles with cut corners, fading out. Replaces round glow sprites.
export function pxHalo(ctx, cx, cy, w, h, col, a = 0.5, u = 1) {
  if (a <= 0.01) return;
  const a0 = ctx.globalAlpha;
  ctx.fillStyle = col;
  for (let i = 3; i >= 1; i--) {
    const pw = Math.round(w / 2 + i * 3 * u), ph = Math.round(h / 2 + i * 3 * u), x = Math.round(cx - pw), y = Math.round(cy - ph);
    ctx.globalAlpha = a0 * a * (0.16 + (3 - i) * 0.1);
    ctx.fillRect(x + u * 2, y, pw * 2 - u * 4, ph * 2);
    ctx.fillRect(x, y + u * 2, pw * 2, ph * 2 - u * 4);
    ctx.fillRect(x + u, y + u, pw * 2 - u * 2, ph * 2 - u * 2);
  }
  ctx.globalAlpha = a0;
}

// A pixel diamond badge with an ink outline and a lit upper-left facet.
export function pxDiamond(ctx, cx, cy, r, col, o = {}) {
  cx = Math.round(cx); cy = Math.round(cy); r = Math.max(2, Math.round(r));
  const lite = o.lite || '#ffffff', dark = o.dark || PAL.ink;
  ctx.fillStyle = o.ink || PAL.ink;
  for (let i = -r - 1; i <= r + 1; i++) { const hw = r + 1 - Math.abs(i); ctx.fillRect(cx - hw, cy + i, hw * 2 + 1, 1); }
  for (let i = -r; i <= r; i++) {
    const hw = r - Math.abs(i);
    ctx.fillStyle = col; ctx.fillRect(cx - hw, cy + i, hw * 2 + 1, 1);
    if (i < 0) { ctx.fillStyle = lite; ctx.fillRect(cx - hw, cy + i, Math.max(1, hw), 1); }
    else if (i > 0 && hw > 0 && o.shade !== false) { ctx.fillStyle = rgba(dark, 0.35); ctx.fillRect(cx, cy + i, hw + 1, 1); }
  }
}

// A stepped triangle pointer: s rows, tip at (x, y), 1 px ink around it.
export function pxCaret(ctx, x, y, s, dir = 'down', col = '#ffffff', ink = PAL.ink) {
  x = Math.round(x); y = Math.round(y);
  const tri = (n, back, c) => {
    ctx.fillStyle = c;
    for (let i = 0; i < n; i++) { // i = 0 at the tip
      const hw = i, d = i + back;
      if (dir === 'down') ctx.fillRect(x - hw, y - d, hw * 2 + 1, 1);
      else if (dir === 'up') ctx.fillRect(x - hw, y + d, hw * 2 + 1, 1);
      else if (dir === 'left') ctx.fillRect(x + d, y - hw, 1, hw * 2 + 1);
      else ctx.fillRect(x - d, y - hw, 1, hw * 2 + 1);
    }
  };
  tri(s + 1, -1, ink);
  tri(s, 0, col);
}

// Diagonal hazard stripes in a rect (steps of s px), scrolling with t.
export function pxStripes(ctx, x, y, w, h, a, b, s = 4, t = 0) {
  x = Math.round(x); y = Math.round(y);
  const off = Math.floor(t) % (s * 2);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = -s * 2; xx < w; xx += s * 2) {
      const sx = xx + ((yy + off) % (s * 2));
      const x0 = Math.max(0, sx), x1 = Math.min(w, sx + s);
      if (x1 > x0) { ctx.fillStyle = a; ctx.fillRect(x + x0, y + yy, x1 - x0, 1); }
      const x2 = Math.max(0, sx + s), x3 = Math.min(w, sx + s * 2);
      if (x3 > x2) { ctx.fillStyle = b; ctx.fillRect(x + x2, y + yy, x3 - x2, 1); }
    }
  }
}
