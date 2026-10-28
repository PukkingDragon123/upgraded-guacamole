// Page geometry for the browser fish. Finds the visible media elements (obstacles the fish swim around)
// and text blocks (places to hide behind) by hit-testing a coarse grid of viewport points.
// Privacy: only LAYOUT GEOMETRY is read (elementFromPoint, element tag names, getBoundingClientRect and
// the line boxes of a Range). Never text, attributes, URLs, form values or pixels.

const MEDIA = new Set(['img', 'video', 'canvas', 'svg', 'picture', 'iframe', 'embed', 'object']);
const TEXT = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'dd', 'dt',
  'figcaption', 'caption', 'td', 'th', 'summary', 'legend', 'label']);
const CLIMB = 7;          // ancestors walked up from the hit element
const KEEP_SCANS = 2;     // elements survive this many scans without being hit (alternating grids)
const MAX_ICONS = 48, MAX_WINDOWS = 72, MAX_LINES = 80;

export class PageScanner {
  constructor(host) {
    this.host = host;
    this.rects = new Map(); // element -> rect object (stable identity so fish can hold on to it)
    this.icons = [];
    this.windows = [];
    this.scanId = 0;
    this.ms = 0;
    this.k = 1;
  }

  classify(el) {
    for (let i = 0, e = el; e && i < CLIMB; i++, e = e.parentElement) {
      if (e === this.host || e === document.body || e === document.documentElement) return null;
      const n = e.localName;
      if (MEDIA.has(n)) return [e, 'media'];
      if (TEXT.has(n)) return [e, 'text'];
    }
    return null;
  }

  // cssW/cssH: overlay size in CSS px; k: logical px per CSS px.
  scan(cssW, cssH, k) {
    const t0 = performance.now();
    this.k = k;
    const id = ++this.scanId;
    const host = this.host;
    const wasHit = host.style.getPropertyValue('pointer-events') !== 'none';
    if (wasHit) host.style.setProperty('pointer-events', 'none', 'important');
    const cols = Math.max(6, Math.min(36, Math.ceil(cssW / 56)));
    const rows = Math.max(5, Math.min(24, Math.ceil(cssH / 48)));
    const off = id & 1 ? 0.25 : 0.75; // alternate the grid so small elements are found on the next pass
    const seen = new Map();
    for (let j = 0; j < rows; j++) {
      const y = ((j + off) / rows) * cssH;
      for (let i = 0; i < cols; i++) {
        const x = ((i + (j & 1 ? 1 - off : off)) / cols) * cssW;
        const hit = document.elementFromPoint(x, y);
        if (!hit || seen.has(hit)) continue;
        const c = this.classify(hit);
        seen.set(hit, true);
        if (c) seen.set(c[0], c[1]);
      }
    }
    if (wasHit) host.style.setProperty('pointer-events', 'auto', 'important');

    const area = cssW * cssH;
    const icons = [], windows = [];
    const consider = (el, kind) => {
      let r = this.rects.get(el);
      if (!r) { r = { x: 0, y: 0, w: 0, h: 0, kind, el, seen: id, lines: null }; this.rects.set(el, r); }
      const b = el.getBoundingClientRect();
      const ok = el.isConnected && b.width >= 24 && b.height >= (kind === 'text' ? 10 : 24) &&
        b.right > 0 && b.bottom > 0 && b.left < cssW && b.top < cssH &&
        b.width * b.height < area * (kind === 'text' ? 0.6 : 0.7);
      if (!ok) { this.rects.delete(el); return; }
      r.x = b.left * k; r.y = b.top * k; r.w = b.width * k; r.h = b.height * k;
      r.lines = null;
      (kind === 'media' ? icons : windows).push(r);
    };
    for (const [el, kind] of seen) {
      if (kind === true) continue;
      const r = this.rects.get(el);
      if (r) r.seen = id;
      consider(el, kind);
    }
    for (const [el, r] of this.rects) {
      if (r.seen === id) continue;
      if (id - r.seen > KEEP_SCANS) { this.rects.delete(el); continue; }
      consider(el, r.kind);
    }
    // nested matches (li > p, picture > img): keep the outer box once
    this.icons = dedupe(icons).sort(byArea).slice(0, MAX_ICONS);
    this.windows = dedupe(windows).sort(byArea).slice(0, MAX_WINDOWS);
    this.ms = performance.now() - t0;
  }

  // Scroll moved everything: shift cached geometry until the next scan.
  shift(dx, dy) {
    if (!dx && !dy) return;
    for (const r of this.rects.values()) {
      r.x -= dx; r.y -= dy;
      if (r.lines) for (const l of r.lines) { l.x -= dx; l.y -= dy; }
    }
  }

  // Line boxes of a text block (logical px), computed lazily and cached until the next scan.
  linesOf(r) {
    if (r.lines) return r.lines;
    const k = this.k;
    let out = [];
    try {
      const range = document.createRange();
      range.selectNodeContents(r.el);
      const list = Array.from(range.getClientRects()).filter((b) => b.width > 1 && b.height > 1 && b.height < 56);
      list.sort((a, b) => a.top - b.top);
      for (const b of list) {
        const last = out[out.length - 1];
        if (last && b.top < last.b - Math.min(b.height, last.b - last.t) * 0.5) {
          last.l = Math.min(last.l, b.left); last.r = Math.max(last.r, b.right);
          last.t = Math.min(last.t, b.top); last.b = Math.max(last.b, b.bottom);
        } else {
          if (out.length >= MAX_LINES) break;
          out.push({ l: b.left, r: b.right, t: b.top, b: b.bottom });
        }
      }
      out = out.map((q) => ({ x: q.l * k, y: q.t * k, w: (q.r - q.l) * k, h: (q.b - q.t) * k }));
    } catch {
      out = [];
    }
    if (!out.length) out = [{ x: r.x, y: r.y, w: r.w, h: r.h }];
    r.lines = out;
    return out;
  }

  clear() {
    this.rects.clear();
    this.icons = [];
    this.windows = [];
  }
}

function byArea(a, b) { return b.w * b.h - a.w * a.h; }

function dedupe(list) {
  return list.filter((r) => !list.some((o) => o !== r && o.el.contains(r.el) && o.kind === r.kind));
}
