// AppSea (phase 3): a glossy eco "Web 2.0" download site rendered inside a desktop window: sky-blue header
// with a sun flare, white arcs, glossy leaves and a green glass globe emblem, water-splash buttons, "beta"
// starbursts and reflections. The charming old flow stays: dial-up connect, pages that load slowly on slow
// internet, security warnings, a download dialog and real waiting. Downloads deliver BAIT PACKS to the bait box.
// Renderers follow the APP_RENDERERS contract {title, size, init, draw(ctx, win, game, rect, t), input(win, game,
// inp, rect), scroll(win, rect), close}. Hit regions are recorded while drawing and resolved in input().
// Pages: 'home', a category id ('bait' = Bait & Tackle), 'top', 'new', 'isp' (internet speed -> The Lab), 'downloads'.

import { clamp, clamp01, rectContains, formatCommas, hash1 } from '../core/math.js';
import { drawText, wrapText, measureText } from '../gfx/font.js';
import { getAppIcon } from '../desktop/icons.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { CATALOG, CATALOG_BY_ID, CATEGORIES, TIERS, MAX_TIER, appsIn, listing, downloadCount, formatSize, formatSpeed, formatTime, formatShortTime } from './catalog.js';
import { ISP_TIERS, ispTier, nextIsp } from './isp.js';
import { WARNINGS, installStore, specialAvailable, dlInfo } from './downloads.js';
import { BAITS, SPECIAL_SHOP, SPECIAL_ORDER, totalBait, currentBait } from './bait.js';
import { drawBaitGloss } from '../fishing/baitart.js';
import { drawAeroBar, drawAeroCoin, drawGlossOrb, drawAeroBubble, drawSparkle, fmtAero, CURRENCY } from '../ui/aero.js';
import { pill, glassCard, burst, tag, statBar, wordArt, reflect, rrect, INK, INK_SOFT, GRASS } from './aerokit.js';
import { ecoSky, leafSpray, ecoGlobe, ecoBubbles, drawSplashButton, splash, leaf } from './ecoart.js';

const TB = 18, SBAR = 12, SW = 8;
const HOST = 'www.appsea.sea';
const LINK = '#1668c8', LINK_HOT = '#ff7a10', GREY = '#5a7a8c';
const LOAD_TIME = [1.1, 0.6, 0.25, 0.08, 0];
const PAGE_NAMES = { home: 'index.html', top: 'top10.html', new: 'new.html', isp: 'faster-internet.html', downloads: 'my-downloads.html', bait: 'bait-and-tackle.html' };
const TYPE_LABEL = {
  docs: 'DOCS', folder: 'FOLDERS', calc: 'MATHS', calendar: 'DATES', music: 'MUSIC', image: 'PICS', video: 'VIDEO', paint: 'PAINT', game: 'GAMES',
  chat: 'CHAT', mail: 'MAIL', browser: 'WEB', terminal: 'CODE', settings: 'GEARS', computer: 'TECH', trash: 'JUNK',
};
const TICKER = 'NEW: DOWNLOAD MORE RAM  *  BIGGER FILES = HUNGRIER FISH  *  ONE BAIT PER FISH, SO STOCK UP  *  FASTER INTERNET? ASK THE LAB  *  100% FREE*  (*SOME BAIT COSTS AERO)  *  ';

const nowS = () => Date.now() / 1000;
const pageUrl = (p) => `http://${HOST}/${PAGE_NAMES[p] || 'apps/' + p + '/'}`;
const store = (g) => installStore(g);

// ------------------------------------------------------------------ page context helpers
function makeP(ctx, w, g, t, view) {
  const inp = g.input || { x: -1, y: -1 };
  const top = g.desktop?.windowAt ? g.desktop.windowAt(inp.x, inp.y) === w : true;
  return { ctx, w, g, S: store(g), t, view, hits: [], mx: inp.x, my: inp.y, hot: top && rectContains(view, inp.x, inp.y), url: null, d: w.data };
}

function visible(P, r) { return r.y + r.h > P.view.y && r.y < P.view.y + P.view.h && r.w > 0; }

// Registers a clickable rect (clipped to the viewport). Returns true while hovered.
function hit(P, r, fn, url) {
  if (!visible(P, r)) return false;
  const y0 = Math.max(r.y, P.view.y), y1 = Math.min(r.y + r.h, P.view.y + P.view.h);
  const cr = { x: r.x, y: y0, w: r.w, h: y1 - y0, fn, url };
  P.hits.push(cr);
  const hov = P.hot && rectContains(cr, P.mx, P.my);
  if (hov && url) P.url = url;
  return hov;
}

function link(P, text, x, y, fn, { font = 'normal', url = null, color = LINK, hot = LINK_HOT } = {}) {
  const tw = measureText(text, font), th = font === 'small' ? 5 : 7;
  const hov = hit(P, { x: x - 1, y: y - 2, w: tw + 2, h: th + 4 }, fn, url || 'javascript:void(0)');
  drawText(P.ctx, text, x, y, { font, color: hov ? hot : color });
  if (hov) { P.ctx.fillStyle = hot; P.ctx.fillRect(x, y + th + 1, tw, 1); }
  return tw;
}

function button(P, x, y, w, h, label, fn, o = {}) {
  const hov = !o.disabled && hit(P, { x, y, w, h }, o.disabled ? null : fn, o.url || 'javascript:void(0)');
  drawSplashButton(P.ctx, x, y, w, h, label, { tone: o.tone || 'green', hover: hov, down: hov && P.g.input?.down, disabled: o.disabled, t: P.t, icon: o.icon });
  return hov;
}

function heading(P, x, y, w, text, color = '#2fa8e8') {
  const { ctx } = P;
  const wa = wordArt(text, { scale: 1, top: '#ffffff', bottom: color, edge: '#0a4a7a' });
  ctx.drawImage(wa, x, y);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, color); g.addColorStop(0.6, 'rgba(120,220,90,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y + wa.height + 1, w, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x, y + wa.height + 1, w * 0.6, 1);
  return y + wa.height + 7;
}

function navigate(w, g, page, opts = {}) {
  const d = w.data;
  if (d.page !== page) { d.back.push({ page: d.page, scroll: w.scroll }); d.fwd = []; }
  d.page = page;
  d.hl = opts.highlight || null;
  d.hlScroll = !!opts.highlight;
  w.scroll = 0;
  d.loadT0 = d.lastT ?? 0;
  g.audio?.play('ui_click', { vol: 0.5 });
}

function openLab(g, focus) {
  if (g.ui?.panels?.lab) g.ui.open('lab', { focus });
  else g.toast?.('The Lab is being built. Check back soon!', 'info');
}

function openBaitBox(g) {
  if (g.ui?.panels?.bait) g.ui.open('bait');
}

function stars(ctx, x, y, n) {
  for (let i = 0; i < 5; i++) {
    const k = clamp01(n - i);
    drawGlossOrb(ctx, x + 3 + i * 7, y + 3, 2.5, k >= 0.75 ? '#ffc83a' : k >= 0.25 ? '#ffe49a' : '#d4e2ea');
  }
  return 36;
}

// ------------------------------------------------------------------ app card
const CARD_H = 64;

function card(P, x, y, w, appId) {
  const { ctx, S, t, d } = P;
  const fam = CATALOG_BY_ID[appId];
  const cur = S.tierOf(appId), next = S.nextTier(appId), dl = S.downloadOf(appId);
  const show = dl ? dl.tier : next >= 0 ? next : cur;
  const L = listing(appId, show);
  const bait = BAITS[L.bait];
  const r = { x, y, w, h: CARD_H };
  if (!visible(P, r)) return y + CARD_H + 5;
  const hl = d.hl === appId;
  if (hl && d.hlScroll) { d.hlScroll = false; d.wantScroll = Math.max(0, y - P.view.y + P.w.scroll - 30); }
  glassCard(ctx, x, y, w, CARD_H, { r: 8, edge: hl ? (Math.floor(t * 4) % 2 ? '#ff9d2e' : '#ffd23a') : cur >= 0 ? 'rgba(110,200,80,0.9)' : undefined, top: cur >= 0 ? 'rgba(248,255,240,0.95)' : undefined });
  if (hl) { rrect(ctx, x - 1.5, y - 1.5, w + 3, CARD_H + 3, 9); ctx.strokeStyle = 'rgba(255,170,40,0.8)'; ctx.lineWidth = 1; ctx.stroke(); }
  // icon with a glossy reflection + tier ladder
  const icon = d.loadingIcons ? null : getAppIcon(L.icon, { tier: show });
  if (icon) {
    const bob = hl ? Math.round(Math.sin(t * 6) * 1.5) : 0;
    ctx.drawImage(icon, x + 7, y + 5 + bob);
    reflect(ctx, icon, x + 7, y + 37, 8, 0.28);
  } else { rrect(ctx, x + 9, y + 7, 28, 28, 6); ctx.fillStyle = 'rgba(160,200,220,0.35)'; ctx.fill(); }
  for (let i = 0; i <= MAX_TIER; i++) {
    const on = i <= cur, now = dl && dl.tier === i;
    drawGlossOrb(ctx, x + 9 + i * 7, y + 54, 2.5, on ? TIERS[i].color : now && Math.floor(t * 4) % 2 ? TIERS[i].color : '#d8e4ec');
  }
  // text column
  const tx = x + 48, bx = x + w - 80;
  let nx = tx + link(P, fam.name, tx, y + 5, () => {}, { url: `http://${HOST}/apps/${appId}/` }) + 4;
  nx += tag(ctx, nx, y + 4, `${TIERS[show].short} ${L.version}`.slice(0, 16), TIERS[show].color) + 3;
  if (fam.isNew && nx < bx - 18) burst(ctx, nx + 9, y + 8, 9, 'NEW', t, { color: '#ff5a8a' });
  else if (fam.hot && nx < bx - 18) burst(ctx, nx + 9, y + 8, 9, 'HOT', t + 0.3, { color: '#ff8a1e' });
  const sx = tx + stars(ctx, tx, y + 15, fam.stars) + 2;
  drawText(ctx, `${formatCommas(downloadCount(appId))} downloads`.toUpperCase(), sx, y + 16, { font: 'small', color: GREY });
  // the bait you get
  if (bait) drawBaitGloss(ctx, bait.art, tx + 8, y + 30, 17, t, { bob: false });
  let ix = tx + 20;
  drawText(ctx, `x${L.qty}`, ix, y + 26, { color: '#2a9a20' });
  ix += measureText(`x${L.qty}`) + 4;
  drawText(ctx, (bait?.name || L.title).toUpperCase().slice(0, 22), ix, y + 27, { font: 'small', color: INK });
  ix += measureText((bait?.name || L.title).toUpperCase().slice(0, 22), 'small') + 5;
  if (ix < bx - 30) tag(ctx, ix, y + 25, TYPE_LABEL[L.type] || L.type.toUpperCase(), '#3ab0e0');
  // description + power meter
  const line = wrapText(L.desc, bx - tx - 6)[0] || '';
  drawText(ctx, line, tx, y + 38, { color: '#3a5a6a' });
  drawText(ctx, 'LURE', tx, y + 52, { font: 'small', color: GREY });
  statBar(ctx, tx + 20, y + 51, 46, 6, clamp01(((bait?.attract || 1) - 0.9) / 1.6), '#2fc0e8');
  drawText(ctx, 'RARE', tx + 72, y + 52, { font: 'small', color: GREY });
  statBar(ctx, tx + 92, y + 51, 40, 6, clamp01(((bait?.rarity || 1) - 1) / 1.2), '#b06aff');
  drawText(ctx, formatSize(L.kb).toUpperCase(), bx - 6, y + 52, { font: 'small', color: '#c05a20', align: 'right' });
  // action column
  ctx.fillStyle = 'rgba(120,180,210,0.35)';
  ctx.fillRect(bx - 3, y + 6, 1, CARD_H - 12);
  cardAction(P, bx, y, appId, L, { cur, next, dl, hl });
  return y + CARD_H + 5;
}

function dlProgress(P, bx, y, dl, bw) {
  const { ctx, S, t } = P;
  if (dl.state === 'confirm') {
    drawText(ctx, 'WAITING FOR', bx + bw / 2, y + 12, { font: 'small', color: '#c06a00', align: 'center' });
    drawText(ctx, 'YOUR OK...', bx + bw / 2, y + 20, { font: 'small', color: '#c06a00', align: 'center' });
    button(P, bx + 6, y + 30, bw - 12, 16, 'Show', () => S.openDialog(P.w), { tone: 'orange' });
    return;
  }
  const active = S.active() === dl;
  const frac = dl.done / dl.kb;
  drawText(ctx, active ? 'DOWNLOADING' : 'QUEUED #' + (S.queued().indexOf(dl) + 1), bx + bw / 2, y + 8, { font: 'small', color: active ? '#1a78d0' : '#a07a20', align: 'center' });
  drawAeroBar(ctx, bx + 2, y + 17, bw - 4, 9, frac, { color: active ? '#38c8f0' : '#ffc83a' });
  drawText(ctx, Math.floor(frac * 100) + '%', bx + bw / 2, y + 30, { font: 'small', color: INK, align: 'center' });
  drawText(ctx, formatShortTime(S.eta(dl)).toUpperCase() + ' LEFT', bx + bw / 2, y + 38, { font: 'small', color: GREY, align: 'center' });
  link(P, 'cancel', bx + bw / 2 - 13, y + 49, () => S.cancel(dl.uid), { font: 'small', url: 'javascript:cancel()' });
  if (active) for (let i = 0; i < 2; i++) drawAeroBubble(P.ctx, bx + 4 + ((t * 20 + i * 30) % (bw - 8)), y + 14 - ((t * 8 + i * 4) % 6), 1.5, 0.9);
}

function cardAction(P, bx, y, appId, L, { cur, next, dl, hl }) {
  const { ctx, S, t, g, d } = P;
  const bw = 76;
  if (dl) { dlProgress(P, bx, y, dl, bw); return; }
  if (next < 0) {
    drawSplashButton(ctx, bx + 4, y + 10, bw - 8, 18, 'MAXED', { disabled: true });
    drawText(ctx, 'ALL TIERS!', bx + bw / 2, y + 34, { font: 'small', color: '#2a9a20', align: 'center' });
    link(P, 'get more bait', bx + 8, y + 46, () => { if (d.hl === appId) d.hl = null; S.request(appId, { near: P.w, tier: MAX_TIER }); }, { font: 'small', url: `http://${HOST}/get?file=${L.file}` });
    return;
  }
  const price = L.price, broke = price > (g.state.coins || 0);
  const label = cur >= 0 ? 'Upgrade' : 'Download';
  button(P, bx + 4, y + 8, bw - 8, 18, label, () => { if (d.hl === appId) d.hl = null; S.request(appId, { near: P.w }); }, { tone: price ? (broke ? 'red' : 'orange') : cur >= 0 ? 'aqua' : 'green', url: `http://${HOST}/get?file=${L.file}` });
  if (price) {
    drawAeroCoin(ctx, bx + bw / 2 - measureText(fmtAero(price)) / 2 - 3, y + 36, 3.5, t);
    drawText(ctx, fmtAero(price), bx + bw / 2 + 3, y + 33, { color: broke ? '#d03030' : '#1a6a9a', align: 'center' });
  } else if (Math.floor(t * 2) % 2 === 0) drawText(ctx, 'FREE!', bx + bw / 2, y + 33, { color: '#2a9a20', align: 'center' });
  const eta = L.kb / S.speed();
  drawText(ctx, `${formatShortTime(eta).toUpperCase()} ON ${S.isp().short.toUpperCase()}`, bx + bw / 2, y + 44, { font: 'small', color: eta > 300 ? '#d04a20' : GREY, align: 'center' });
  if (eta > 120) link(P, 'go faster?', bx + bw / 2 - 20, y + 53, () => navigate(P.w, g, 'isp'), { font: 'small', url: pageUrl('isp') });
  if (hl) {
    const hand = getUiIcon('cursor_hand');
    const k = Math.abs(Math.sin(t * 5));
    if (hand) ctx.drawImage(hand, Math.round(bx + bw / 2 - 2), Math.round(y + 20 + k * 4));
    burst(ctx, bx + 4, y + 4, 12, 'CLICK!', t, { color: '#ff5a3a' });
  }
}

// Special bait (Bait & Tackle).
function baitCard(P, x, y, w, id) {
  const { ctx, S, t, g, d } = P;
  const b = BAITS[id], sh = SPECIAL_SHOP[id];
  const r = { x, y, w, h: CARD_H };
  if (!visible(P, r)) return y + CARD_H + 5;
  const open = specialAvailable(g.state, id);
  const hl = d.hl === id;
  glassCard(ctx, x, y, w, CARD_H, { r: 8, top: open ? 'rgba(255,253,240,0.95)' : 'rgba(236,242,246,0.9)', edge: hl ? '#ff9d2e' : undefined });
  drawBaitGloss(ctx, b.art, x + 24, y + 26, 34, t, { bob: open });
  if (!open) { drawGlossOrb(ctx, x + 36, y + 40, 7, '#ffd27a'); const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, x + 36 - Math.floor(lk.width / 2), y + 40 - Math.floor(lk.height / 2)); }
  const tx = x + 48, bx = x + w - 80;
  let nx = tx + link(P, sh.title, tx, y + 5, () => {}, { url: `http://${HOST}/bait/${id}/` }) + 4;
  nx += tag(ctx, nx, y + 4, 'v' + sh.version, '#7a9ab0') + 3;
  if (b.effect && nx < bx - 22) burst(ctx, nx + 12, y + 8, 11, 'SPECIAL', t, { color: '#b06aff' });
  drawText(ctx, `BY ${sh.publisher.toUpperCase()}`, tx, y + 16, { font: 'small', color: GREY });
  drawText(ctx, `x${b.pack}`, tx, y + 26, { color: '#2a9a20' });
  drawText(ctx, b.name.toUpperCase(), tx + measureText(`x${b.pack}`) + 4, y + 27, { font: 'small', color: INK });
  drawText(ctx, wrapText(b.desc, bx - tx - 6)[0] || '', tx, y + 38, { color: '#3a5a6a' });
  drawText(ctx, 'LURE', tx, y + 52, { font: 'small', color: GREY });
  statBar(ctx, tx + 20, y + 51, 46, 6, clamp01((b.attract - 0.9) / 1.6), '#2fc0e8');
  drawText(ctx, 'RARE', tx + 72, y + 52, { font: 'small', color: GREY });
  statBar(ctx, tx + 92, y + 51, 40, 6, clamp01((b.rarity - 1) / 1.2), '#b06aff');
  drawText(ctx, formatSize(b.kb).toUpperCase(), bx - 6, y + 52, { font: 'small', color: '#c05a20', align: 'right' });
  ctx.fillStyle = 'rgba(120,180,210,0.35)';
  ctx.fillRect(bx - 3, y + 6, 1, CARD_H - 12);
  const bw = 76;
  const dl = S.downloadOfBait(id);
  if (dl) { dlProgress(P, bx, y, dl, bw); return y + CARD_H + 5; }
  if (!open) {
    drawText(ctx, 'LOCKED', bx + bw / 2, y + 12, { font: 'small', color: GREY, align: 'center' });
    button(P, bx + 6, y + 22, bw - 12, 18, 'The Lab', () => openLab(g, 'bait_' + id), { tone: 'aqua', url: 'lab://bait/' + id });
    drawText(ctx, 'RESEARCH IT!', bx + bw / 2, y + 48, { font: 'small', color: GREY, align: 'center' });
    return y + CARD_H + 5;
  }
  const broke = b.price > (g.state.coins || 0);
  button(P, bx + 4, y + 8, bw - 8, 18, 'Get', () => { if (d.hl === id) d.hl = null; S.requestBait(id, { near: P.w }); }, { tone: broke ? 'red' : 'orange', url: `http://${HOST}/get?bait=${id}` });
  drawAeroCoin(ctx, bx + bw / 2 - measureText(fmtAero(b.price)) / 2 - 3, y + 36, 3.5, t);
  drawText(ctx, fmtAero(b.price), bx + bw / 2 + 3, y + 33, { color: broke ? '#d03030' : '#1a6a9a', align: 'center' });
  drawText(ctx, `${formatShortTime(b.kb / S.speed()).toUpperCase()} ON ${S.isp().short.toUpperCase()}`, bx + bw / 2, y + 44, { font: 'small', color: GREY, align: 'center' });
  return y + CARD_H + 5;
}

// ------------------------------------------------------------------ page sections
function header(P, x, y, W) {
  const { ctx, t, g } = P;
  const H = 74;
  ecoSky(ctx, x, y, W, H, t, { sun: [0.2, 0.3], grass: 16 });
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, W, H); ctx.clip();
  ecoBubbles(ctx, x, y, W, H, t, 10);
  leafSpray(ctx, x + W, y - 6, 'tr', 0.75, t);
  leafSpray(ctx, x, y + H + 8, 'bl', 0.55, t);
  // globe emblem + logo
  ecoGlobe(ctx, x + 30, y + 30, 17, t);
  splash(ctx, x + 30, y + 52, 40, t, 0.8);
  const logo = wordArt('AppSea', { scale: 3, top: '#ffffff', bottom: '#2fb8f0', edge: '#0a4a8a' });
  ctx.drawImage(logo, x + 54, y + 8);
  burst(ctx, x + 54 + logo.width + 14, y + 12, 12, 'beta', t, { color: '#ff8a1e' });
  drawText(ctx, 'Download bait. Catch fish. Share the love.', x + 57, y + 40, { color: '#ffffff', shadow: '#0a4a8a' });
  // visitor counter (glossy pill)
  const n = formatCommas(1337000 + (Math.floor(Date.now() / 3000) % 900000));
  const vw = measureText(n, 'small') + 18;
  pill(ctx, x + W - vw - 8, y + H - 13, vw, 10, { color: '#ffffff', edge: 'rgba(255,255,255,0.95)', alpha: 0.85 });
  drawGlossOrb(ctx, x + W - vw - 2, y + H - 8, 2.5, '#5cc832');
  drawText(ctx, n, x + W - vw + 3, y + H - 11, { font: 'small', color: INK });
  hit(P, { x: x + W - vw - 8, y: y + H - 13, w: vw, h: 10 }, () => g.toast?.('Guestbook entry #4,812: "nice site!!! - a fish"', 'book'), `http://${HOST}/guestbook`);
  ctx.restore();
  return y + H;
}

function navbar(P, x, y, W) {
  const { ctx, g, S, d, t } = P;
  const h = 20;
  const gr = ctx.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#e4f6ff'); gr.addColorStop(1, '#bfe6f8');
  ctx.fillStyle = gr; ctx.fillRect(x, y, W, h);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(x, y, W, 1);
  ctx.fillStyle = 'rgba(60,150,200,0.45)'; ctx.fillRect(x, y + h - 1, W, 1);
  const nq = S.st.downloads.length;
  const items = [['Home', 'home'], ['Bait & Tackle', 'bait'], ['Top 10', 'top'], ['New!', 'new'], [`Downloads${nq ? ' (' + nq + ')' : ''}`, 'downloads'], ['Faster internet', 'isp']];
  let nx = x + 6;
  for (const [label, page] of items) {
    const tw = measureText(label) + 14;
    if (nx + tw > x + W - 4) break;
    const act = d.page === page;
    const hov = hit(P, { x: nx, y: y + 3, w: tw, h: 14 }, () => navigate(P.w, g, page), pageUrl(page));
    if (act || hov) pill(ctx, nx, y + 3, tw, 14, { color: act ? (page === 'bait' ? '#ff9d2e' : '#38b8f2') : '#d8f2ff', edge: act ? undefined : 'rgba(120,190,225,0.9)' });
    drawText(ctx, label, nx + 7, y + 6, { color: act ? '#ffffff' : page === 'bait' ? '#c05a10' : '#1668c8', shadow: act ? 'rgba(0,40,80,0.5)' : null });
    if (page === 'downloads' && nq && !act) drawGlossOrb(ctx, nx + tw - 3, y + 4, 2.5, '#ff5a5a', t);
    nx += tw + 3;
  }
  return y + h;
}

function ticker(P, x, y, W) {
  const { ctx, t } = P;
  ctx.fillStyle = 'rgba(92,200,50,0.16)';
  ctx.fillRect(x, y, W, 10);
  const tw = measureText(TICKER, 'small');
  const off = (t * 26) % tw;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, W, 10); ctx.clip();
  for (let k = 0; k < 3; k++) drawText(ctx, TICKER, Math.round(x - off + k * tw), y + 3, { font: 'small', color: '#2a8a20' });
  ctx.restore();
  return y + 10;
}

function sidebar(P, x, y) {
  const { ctx, g, S, t, d } = P;
  const W = 96;
  // categories
  const cats = [{ id: 'home', name: 'Home' }, ...CATEGORIES];
  const ch = 16 + cats.length * 12;
  glassCard(ctx, x, y, W, ch, { r: 7 });
  drawText(ctx, 'CATEGORIES', x + 6, y + 5, { font: 'small', color: INK_SOFT });
  let ly = y + 15;
  for (const c of cats) {
    const act = d.page === c.id;
    if (act) pill(ctx, x + 3, ly - 2, W - 6, 11, { color: c.id === 'bait' ? '#ffb02e' : '#38b8f2', gloss: true });
    drawGlossOrb(ctx, x + 9, ly + 3, 2, act ? '#ffffff' : c.id === 'bait' ? '#ff9d2e' : '#5cc832');
    const n = c.id === 'home' ? '' : c.id === 'bait' ? ` (${SPECIAL_ORDER.filter((i) => SPECIAL_SHOP[i]).length})` : ` (${appsIn(c.id).length})`;
    link(P, c.name + n, x + 15, ly, () => navigate(P.w, g, c.id), { color: act ? '#ffffff' : LINK, hot: act ? '#ffffff' : LINK_HOT, url: pageUrl(c.id) });
    ly += 12;
  }
  y += ch + 6;
  // connection card
  const plan = S.isp();
  glassCard(ctx, x, y, W, 52, { r: 7, top: 'rgba(240,255,235,0.95)', bottom: 'rgba(200,240,190,0.9)', edge: 'rgba(110,200,80,0.9)' });
  drawText(ctx, 'MY INTERNET', x + 6, y + 5, { font: 'small', color: '#2a7a20' });
  drawGlossOrb(ctx, x + 10, y + 19, 5, plan.color, t);
  drawText(ctx, plan.name, x + 18, y + 15, { color: INK });
  drawText(ctx, formatSpeed(S.speed()).toUpperCase(), x + 18, y + 25, { font: 'small', color: '#2a9a20' });
  const nxt = nextIsp(g.state);
  if (nxt) link(P, 'go faster >', x + 6, y + 38, () => navigate(P.w, g, 'isp'), { font: 'small', url: pageUrl('isp') });
  else drawText(ctx, 'FASTEST PLAN!', x + 6, y + 38, { font: 'small', color: '#2a9a20' });
  y += 58;
  // bait box card
  const n = totalBait(g.state), cur = currentBait(g.state);
  const br = { x, y, w: W, h: 46 };
  const hov = hit(P, br, () => openBaitBox(g), 'fishtop://bait-box');
  glassCard(ctx, x, y, W, 46, { r: 7, top: hov ? '#ffffff' : 'rgba(255,250,236,0.95)', bottom: 'rgba(255,226,170,0.9)', edge: 'rgba(240,160,60,0.9)' });
  drawText(ctx, 'MY BAIT BOX', x + 6, y + 5, { font: 'small', color: '#b0601a' });
  if (cur) drawBaitGloss(ctx, cur.art, x + 16, y + 27, 22, t, { bob: hov });
  else drawGlossOrb(ctx, x + 16, y + 27, 9, '#e8f4fa');
  drawText(ctx, `${n}`, x + 32, y + 18, { color: INK, scale: 1 });
  drawText(ctx, n === 1 ? 'BAIT' : 'BAITS', x + 34 + measureText(String(n)), y + 19, { font: 'small', color: INK_SOFT });
  drawText(ctx, hov ? 'OPEN >' : 'ONE PER FISH', x + 32, y + 32, { font: 'small', color: hov ? '#e07010' : GREY });
  y += 52;
  // web 2.0 badges
  for (const [a, b, c] of [['WEB', '2.0', '#ff8a1e'], ['RSS', 'FEED', '#ff6a2a'], ['ECO', 'FRIENDLY', '#5cc832']]) {
    pill(ctx, x + 6, y, 26, 11, { color: c, r: 3 });
    drawText(ctx, a, x + 19, y + 3, { font: 'small', color: '#ffffff', align: 'center' });
    pill(ctx, x + 32, y, 46, 11, { color: '#eef6fa', r: 3 });
    drawText(ctx, b, x + 55, y + 3, { font: 'small', color: INK_SOFT, align: 'center' });
    y += 14;
  }
  return y;
}

const PROMOS = ['ram', 'visitor', 'bait', 'lab', 'crab'];
function promo(P, x, y, w) {
  const { ctx, t, g } = P;
  const h = 44;
  const kind = PROMOS[Math.floor(t / 7) % PROMOS.length];
  const k = (t / 7) % 1;
  const r = { x, y, w, h };
  ctx.save();
  rrect(ctx, x, y, w, h, 9); ctx.clip();
  let act = null;
  if (kind === 'ram') {
    ecoSky(ctx, x, y, w, h, t, { sun: [0.85, 0.2], clouds: false });
    ctx.drawImage(getAppIcon('ram'), x + 8, y + 6 + Math.round(Math.sin(t * 3)));
    drawText(ctx, 'YOUR PC IS 87% SLOW!', x + 48, y + 9, { color: '#ffffff', shadow: '#0a4a8a' });
    drawText(ctx, 'Download More RAM. It\'s free. Probably.', x + 48, y + 23, { color: '#e8ffd0', shadow: '#0a4a8a' });
    act = () => navigate(P.w, g, 'weird', { highlight: 'moreram' });
  } else if (kind === 'visitor') {
    const gr = ctx.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, '#ffb02e'); gr.addColorStop(1, '#ff5a8a');
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 6; i++) drawSparkle(ctx, x + hash1(i, 3) * w, y + hash1(i, 5) * h, 2, 0.5 + 0.5 * Math.sin(t * 6 + i));
    drawText(ctx, 'CONGRATULATIONS! YOU ARE VISITOR #1,000,000!', x + w / 2, y + 10, { align: 'center', color: '#ffffff', shadow: '#a02a40' });
    drawText(ctx, 'Click to claim your free fish!!!', x + w / 2, y + 25, { align: 'center', color: Math.floor(t * 3) % 2 ? '#fff6a0' : '#ffffff', shadow: '#a02a40' });
    act = () => {
      if (!P.S.claimedFreeFish) { P.S.claimedFreeFish = true; g.state.coins = (g.state.coins || 0) + 1; g.toast?.(`There is no free fish. Here is 1 ${CURRENCY} for your trouble.`, 'coin'); }
      else g.toast?.(`You already claimed your free fish. It was 1 ${CURRENCY}.`, 'coin');
    };
  } else if (kind === 'bait') {
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#fff6d8'); gr.addColorStop(1, '#ffc86a');
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
    drawBaitGloss(ctx, BAITS.golden.art, x + 24, y + 22, 34, t);
    drawText(ctx, 'BAIT & TACKLE', x + 48, y + 9, { color: '#b05a10' });
    drawText(ctx, 'Golden, glowing, black-hole bait. Fish go wild.', x + 48, y + 23, { color: '#7a4a10' });
    act = () => navigate(P.w, g, 'bait');
  } else if (kind === 'lab') {
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#e8fff0'); gr.addColorStop(1, '#8ee0b0');
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
    ecoGlobe(ctx, x + 22, y + 22, 14, t);
    drawText(ctx, 'TIRED OF WAITING?', x + 44, y + 9, { color: '#1a6a3a' });
    drawText(ctx, 'Research faster internet in The Lab.', x + 44, y + 23, { color: '#2a7a4a' });
    act = () => navigate(P.w, g, 'isp');
  } else {
    ecoSky(ctx, x, y, w, h, t, { sun: [0.1, 0.1], arcs: false, clouds: false, grass: 12 });
    const cx = x + 20 + Math.abs(((t * 50) % ((w - 50) * 2)) - (w - 50));
    drawGlossOrb(ctx, cx, y + h - 12, 6, '#ff6a4a', t);
    drawText(ctx, 'POKE THE CRAB AND WIN A PRIZE!', x + w / 2, y + 8, { align: 'center', color: '#ffffff', shadow: '#0a4a8a' });
    act = () => g.toast?.('The crab is offended. No prize. (Click click.)', 'anger');
  }
  // sweep shine
  const sx = x + ((k * 3) % 1) * (w + 60) - 30;
  const sg = ctx.createLinearGradient(sx - 20, 0, sx + 20, 0);
  sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.45)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg; ctx.fillRect(sx - 20, y, 40, h);
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x, y, w, Math.round(h * 0.4));
  ctx.restore();
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 9); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1; ctx.stroke();
  hit(P, r, act, `http://ads.appsea.sea/${kind}`);
  drawText(ctx, 'AD', x + w - 6, y + h - 8, { font: 'small', color: 'rgba(0,40,60,0.4)', align: 'right' });
  return y + h + 7;
}

function welcome(P, x, y, w) {
  const { ctx, t, S } = P;
  if (S.st.stats.completed > 2) return y;
  glassCard(ctx, x, y, w, 40, { r: 8, top: 'rgba(245,255,240,0.95)', bottom: 'rgba(214,246,200,0.9)', edge: 'rgba(110,200,80,0.9)' });
  leaf(ctx, x + 6, y + 30, 18, -50, { tone: 1 });
  drawText(ctx, 'Welcome to AppSea!', x + 22, y + 6, { color: '#2a8a20' });
  wrapText('Every app here downloads as a pack of BAIT. Each fish you hook eats one. Bigger files = hungrier fish!', w - 30, 'small')
    .slice(0, 3).forEach((l, i) => drawText(ctx, l, x + 22, y + 17 + i * 7, { font: 'small', color: INK }));
  return y + 46;
}

function footer(P, x, y, W) {
  const { ctx, t, g } = P;
  y += 4;
  const H = 34;
  ecoSky(ctx, x, y, W, H, t, { sun: [0.9, 0.1], arcs: false, clouds: false, grass: 18 });
  leafSpray(ctx, x, y + H, 'bl', 0.45, t);
  leafSpray(ctx, x + W, y + H, 'br', 0.45, t);
  const cx = x + W / 2;
  drawText(ctx, '(C) 2006 APPSEA WEB 2.0 BETA  *  NO FISH WERE HARMED', cx, y + 6, { font: 'small', color: '#ffffff', align: 'center', shadow: '#0a4a8a' });
  const a = '< prev', b = 'next >', ring = 'ECO OCEAN WEBRING';
  const total = measureText(a, 'small') + measureText(ring, 'small') + measureText(b, 'small') + 20;
  let fx = Math.round(cx - total / 2);
  fx += link(P, a, fx, y + 16, () => g.toast?.('The previous site in the webring is a crab.', 'info'), { font: 'small', color: '#ffffff', hot: '#fff27a', url: 'http://webring.sea/prev' }) + 10;
  drawText(ctx, ring, fx, y + 16, { font: 'small', color: '#e8ffd0' });
  fx += measureText(ring, 'small') + 10;
  link(P, b, fx, y + 16, () => g.toast?.('The next site in the webring is also a crab.', 'info'), { font: 'small', color: '#ffffff', hot: '#fff27a', url: 'http://webring.sea/next' });
  return y + H;
}

// ------------------------------------------------------------------ pages
function pageApps(page) {
  if (page === 'top') return CATALOG.slice().sort((a, b) => downloadCount(b.id) - downloadCount(a.id)).slice(0, 10).map((a) => a.id);
  if (page === 'new') return CATALOG.filter((a) => a.isNew || a.cat === 'weird').map((a) => a.id);
  return appsIn(page).map((a) => a.id);
}

function staffPicks(P) {
  const S = P.S;
  const avail = CATALOG.filter((a) => S.nextTier(a.id) >= 0).map((a) => ({ id: a.id, kb: listing(a.id, S.nextTier(a.id)).kb, price: listing(a.id, S.nextTier(a.id)).price }));
  avail.sort((a, b) => (a.price > 0) - (b.price > 0) || a.kb - b.kb);
  const ids = avail.map((a) => a.id);
  const hl = P.d.hl;
  const out = hl && CATALOG_BY_ID[hl] ? [hl, ...ids.filter((i) => i !== hl)] : ids;
  if (!S.st.installed.length && out.includes('notes') && hl !== 'notes') return [...(hl ? [hl] : []), 'notes', ...out.filter((i) => i !== 'notes' && i !== hl)].slice(0, 3);
  return out.slice(0, 3);
}

function mainHome(P, x, y, w) {
  const { S } = P;
  y = promo(P, x, y, w);
  y = welcome(P, x, y, w);
  y = heading(P, x, y, w, 'Staff picks', '#2fa8e8');
  const picks = staffPicks(P);
  if (!picks.length) { drawText(P.ctx, 'You have EVERYTHING. Even the RAM.', x + 6, y + 2, { color: INK }); y += 14; }
  for (const id of picks) y = card(P, x, y, w, id);
  y = heading(P, x, y + 2, w, 'Bait & Tackle', '#ff9d2e');
  const sp = SPECIAL_ORDER.filter((id) => SPECIAL_SHOP[id] && specialAvailable(P.g.state, id)).slice(0, 2);
  for (const id of sp) y = baitCard(P, x, y, w, id);
  y = heading(P, x, y + 2, w, 'New & hot', '#5cc832');
  for (const id of ['videos', 'moreram'].filter((i) => !picks.includes(i))) y = card(P, x, y, w, id);
  if (S.st.installed.length >= 3) y = card(P, x, y, w, 'notavirus');
  return y;
}

function crumbs(P, x, y, title) {
  const { g } = P;
  drawText(P.ctx, 'YOU ARE HERE:', x, y + 1, { font: 'small', color: GREY });
  const hx = x + 52 + link(P, 'HOME', x + 52, y + 1, () => navigate(P.w, g, 'home'), { font: 'small', url: pageUrl('home') });
  drawText(P.ctx, ` > ${title.toUpperCase()}`, hx, y + 1, { font: 'small', color: INK });
  return y + 11;
}

function mainList(P, x, y, w, page) {
  const cat = CATEGORIES.find((c) => c.id === page);
  const title = cat ? cat.name : page === 'top' ? 'Top 10 Downloads' : 'New Releases';
  y = crumbs(P, x, y, title);
  if (page === 'bait') {
    y = heading(P, x, y, w, 'Bait & Tackle', '#ff9d2e');
    drawText(P.ctx, cat?.blurb || 'Special bait.', x + 2, y, { color: '#8a5a20' }); y += 12;
    for (const id of SPECIAL_ORDER) if (SPECIAL_SHOP[id]) y = baitCard(P, x, y, w, id);
    drawText(P.ctx, 'MIX YOUR OWN BAIT IN THE BAIT BOX (LAB RECIPE: BAIT MIXER).', x + 2, y + 2, { font: 'small', color: GREY });
    return y + 12;
  }
  const ids = pageApps(page);
  y = heading(P, x, y, w, `${title} (${ids.length})`, cat ? '#2fa8e8' : '#ff8a1e');
  if (cat) { drawText(P.ctx, cat.blurb, x + 2, y, { color: '#3a6a8a' }); y += 12; }
  ids.forEach((id, i) => {
    if (page === 'top') burst(P.ctx, x + 2, y + 4, 7, String(i + 1), P.t + i * 0.2, { color: i < 3 ? '#ffb02e' : '#7ab8e0' });
    y = card(P, x, y, w, id);
  });
  return y;
}

function mainDownloads(P, x, y, w) {
  const { ctx, t, S, g } = P;
  y = heading(P, x, y, w, 'My downloads', '#5cc832');
  const list = S.st.downloads;
  if (!list.length) { drawText(ctx, 'Nothing downloading. Go get some bait!', x + 4, y + 2, { color: GREY }); y += 16; }
  for (const d of list) {
    const I = dlInfo(d);
    glassCard(ctx, x, y, w, 30, { r: 7 });
    if (I.art) drawBaitGloss(ctx, I.art, x + 14, y + 15, 20, t, { bob: false });
    drawText(ctx, I.title, x + 28, y + 5, { color: INK });
    const active = S.active() === d;
    const frac = d.done / d.kb;
    drawAeroBar(ctx, x + 28, y + 17, 130, 8, frac, { color: d.state === 'confirm' ? '#ffb43a' : active ? '#38c8f0' : '#ffd23a' });
    const msg = d.state === 'confirm' ? 'WAITING FOR YOUR OK' : active ? `${Math.floor(frac * 100)}% - ${formatShortTime(S.eta(d)).toUpperCase()} LEFT` : `QUEUED - ${formatShortTime(S.eta(d) - (d.kb - d.done) / S.speed()).toUpperCase()} TO START`;
    drawText(ctx, msg, x + 164, y + 18, { font: 'small', color: GREY });
    link(P, 'cancel', x + w - 34, y + 5, () => S.cancel(d.uid), { font: 'small', url: 'javascript:cancel()' });
    y += 34;
  }
  y = heading(P, x, y + 4, w, 'Delivered to your bait box', '#2fa8e8');
  if (!S.recent.length) { drawText(ctx, 'Finished downloads land here (and in your bait box).', x + 4, y + 2, { color: GREY }); y += 14; }
  for (const r of S.recent) {
    const b = BAITS[r.bait];
    if (b) drawBaitGloss(ctx, b.art, x + 9, y + 5, 14, t, { bob: false, bubble: false });
    drawText(ctx, `+${r.qty} ${b?.name || r.title}`, x + 20, y + 2, { color: INK });
    drawText(ctx, `${formatSize(r.kb).toUpperCase()} IN ${formatShortTime(r.secs).toUpperCase()}`, x + w - 4, y + 3, { font: 'small', color: GREY, align: 'right' });
    y += 13;
  }
  const s = S.st.stats;
  y += 4;
  drawText(ctx, `TOTAL: ${formatSize(s.downloaded).toUpperCase()} IN ${s.completed} DOWNLOADS`, x + 4, y, { font: 'small', color: GREY });
  link(P, 'open bait box >', x + w - 70, y, () => openBaitBox(g), { font: 'small', url: 'fishtop://bait-box' });
  return y + 14;
}

function ispPage(P, x, y, w) {
  const { ctx, t, S, g } = P;
  y = crumbs(P, x, y, 'Faster internet');
  y = heading(P, x, y, w, 'Faster internet', '#2fc8a0');
  const cur = ispTier(g.state);
  glassCard(ctx, x, y, w, 40, { r: 8, top: 'rgba(240,255,250,0.95)', bottom: 'rgba(200,244,226,0.9)', edge: 'rgba(60,190,150,0.9)' });
  ecoGlobe(ctx, x + 20, y + 20, 13, t);
  drawText(ctx, `You surf on ${ISP_TIERS[cur].name}: ${formatSpeed(S.speed())}`, x + 40, y + 8, { color: INK });
  wrapText('Faster plans are researched in The Lab (Luck & Idle branch). Every download finishes sooner, even ones already running.', w - 48, 'small')
    .slice(0, 3).forEach((l, i) => drawText(ctx, l, x + 40, y + 19 + i * 7, { font: 'small', color: INK_SOFT }));
  y += 46;
  const small = listing('notes', 1).kb, big = listing('games', 3).kb;
  ISP_TIERS.forEach((p, i) => {
    const rh = 28, have = i <= cur;
    glassCard(ctx, x, y, w, rh, { r: 7, top: i === cur ? 'rgba(240,255,230,0.98)' : undefined, edge: i === cur ? 'rgba(110,200,80,0.95)' : undefined, shadow: false });
    drawGlossOrb(ctx, x + 12, y + 14, 7, have ? p.color : '#c8d4dc', t);
    if (have) { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, x + 12 - Math.floor(ck.width / 2), y + 14 - Math.floor(ck.height / 2)); }
    drawText(ctx, p.name, x + 24, y + 5, { color: have ? INK : '#6a8a9a' });
    drawText(ctx, wrapText(p.desc, w - 150, 'small')[0] || '', x + 24, y + 16, { font: 'small', color: GREY });
    const sp = p.speed * (S.speed() / ISP_TIERS[cur].speed);
    drawText(ctx, formatSpeed(p.speed).toUpperCase(), x + w - 46, y + 5, { font: 'small', color: '#2a8a20', align: 'right' });
    drawText(ctx, `${formatShortTime(small / sp)} / ${formatShortTime(big / sp)}`.toUpperCase(), x + w - 46, y + 15, { font: 'small', color: big / sp > 3600 ? '#d04a20' : INK_SOFT, align: 'right' });
    if (i === cur) tag(ctx, x + w - 36, y + 9, 'NOW', GRASS);
    else if (i === cur + 1) button(P, x + w - 40, y + 6, 34, 15, 'Lab', () => openLab(g, p.node), { tone: 'aqua', url: 'lab://' + p.node });
    else if (i > cur) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, x + w - 26, y + 10); }
    y += rh + 3;
  });
  drawText(ctx, 'SPEEDS: SMALL APP / HUGE APP. A BOAT WITH A SATELLITE DISH MAKES ANY PLAN FASTER.', x + 2, y + 2, { font: 'small', color: GREY });
  return y + 12;
}

function renderPage(P) {
  const { view, d, w } = P;
  const x = view.x, W = view.w;
  let y = view.y - w.scroll;
  y = header(P, x, y, W);
  y = navbar(P, x, y, W);
  y = ticker(P, x, y, W);
  y += 6;
  const sy = sidebar(P, x + 4, y);
  const mx = x + 106, mw = W - 110;
  let my;
  if (d.page === 'home') my = mainHome(P, mx, y, mw);
  else if (d.page === 'downloads') my = mainDownloads(P, mx, y, mw);
  else if (d.page === 'isp') my = ispPage(P, mx, y, mw);
  else my = mainList(P, mx, y, mw, d.page);
  y = Math.max(sy, my) + 6;
  return footer(P, x, y, W);
}

function pageBg(ctx, x, y, w, h, scroll) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f4fcff'); g.addColorStop(1, '#dcf2fc');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // faint bubbles drifting with the page
  for (let i = 0; i < 8; i++) {
    const bx = x + hash1(i, 2) * w, by = y + ((hash1(i, 4) * 900 - scroll * 0.5) % (h + 40) + h + 40) % (h + 40) - 20;
    drawAeroBubble(ctx, bx, by, 2 + hash1(i, 6) * 4, 0.35);
  }
}

// ------------------------------------------------------------------ browser chrome (glossy Aero)
function toolbar(P, r) {
  const { ctx, w, g, d } = P;
  const gr = ctx.createLinearGradient(0, r.y, 0, r.y + TB);
  gr.addColorStop(0, '#f6fcff'); gr.addColorStop(0.5, '#d8f0fc'); gr.addColorStop(1, '#a8d8f2');
  ctx.fillStyle = gr; ctx.fillRect(r.x, r.y, r.w, TB);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(r.x, r.y, r.w, 1);
  ctx.fillStyle = 'rgba(40,120,170,0.5)'; ctx.fillRect(r.x, r.y + TB - 1, r.w, 1);
  const orb = (cx, glyph, enabled, fn, color = '#2f9ee8', rad = 6.5) => {
    const br = { x: cx - rad, y: r.y + TB / 2 - rad, w: rad * 2, h: rad * 2 };
    const hov = enabled && P.hot2 && rectContains(br, P.mx, P.my);
    if (enabled) P.chrome.push({ ...br, fn });
    drawGlossOrb(ctx, cx, r.y + TB / 2, rad + (hov ? 0.5 : 0), enabled ? color : '#b8c8d4');
    drawText(ctx, glyph, cx, r.y + TB / 2 - 3, { align: 'center', color: '#ffffff', shadow: 'rgba(0,40,80,0.5)' });
    return cx + rad * 2 + 3;
  };
  let bx = r.x + 10;
  bx = orb(bx, '<', d.back.length > 0, () => { const p = d.back.pop(); if (p) { d.fwd.push({ page: d.page, scroll: w.scroll }); d.page = p.page; w.scroll = p.scroll; d.loadT0 = d.lastT; } }, '#2f9ee8', 7);
  bx = orb(bx + 1, '>', d.fwd.length > 0, () => { const p = d.fwd.pop(); if (p) { d.back.push({ page: d.page, scroll: w.scroll }); d.page = p.page; w.scroll = p.scroll; d.loadT0 = d.lastT; } }, '#2f9ee8', 5.5);
  bx = orb(bx, 'H', true, () => navigate(w, g, 'home'), '#5cc832', 5.5);
  const ax = bx + 2, aw = r.x + r.w - ax - 30;
  pill(ctx, ax, r.y + 3, aw, TB - 6, { color: '#ffffff', edge: 'rgba(80,160,210,0.9)', gloss: false });
  ecoGlobe(ctx, ax + 7, r.y + TB / 2, 4, P.t);
  let url = pageUrl(d.page);
  while (measureText(url) > aw - 22 && url.length > 8) url = url.slice(0, -2);
  drawText(ctx, url, ax + 14, r.y + 6, { color: '#2a4a5a' });
  const gr2 = { x: r.x + r.w - 27, y: r.y + 3, w: 24, h: TB - 6 };
  const ghov = P.hot2 && rectContains(gr2, P.mx, P.my);
  pill(ctx, gr2.x, gr2.y, gr2.w, gr2.h, { color: ghov ? '#8ee04a' : '#5cc832' });
  drawText(ctx, 'Go', gr2.x + 12, gr2.y + 3, { align: 'center', color: '#ffffff', shadow: 'rgba(0,60,0,0.5)' });
  P.chrome.push({ ...gr2, fn: () => { d.loadT0 = d.lastT; } });
}

function statusBar(P, r, loading) {
  const { ctx, S, t } = P;
  const y = r.y + r.h - SBAR;
  const gr = ctx.createLinearGradient(0, y, 0, y + SBAR);
  gr.addColorStop(0, '#eaf8ff'); gr.addColorStop(1, '#c4e6f6');
  ctx.fillStyle = gr; ctx.fillRect(r.x, y, r.w, SBAR);
  ctx.fillStyle = 'rgba(40,120,170,0.4)'; ctx.fillRect(r.x, y, r.w, 1);
  let msg = 'Done';
  if (S.connecting) msg = 'Dialing your internet...';
  else if (loading) msg = `(${Math.max(1, Math.round((1 - loading) * 9))} items remaining) Loading http://${HOST}/img/bubble${Math.floor(t * 7) % 9}.png...`;
  else if (P.url) msg = P.url;
  let m = msg;
  while (measureText(m) > r.w - 104 && m.length > 4) m = m.slice(0, -4) + '...';
  drawText(ctx, m, r.x + 4, y + 3, { color: INK });
  const live = S.connected;
  drawGlossOrb(ctx, r.x + r.w - 92, y + SBAR / 2, 3, live ? '#5cc832' : S.connecting ? '#ffb02e' : '#c8d4dc', t);
  drawText(ctx, `Internet (${S.isp().short})`, r.x + r.w - 86, y + 3, { color: INK });
}

function scrollbar(P, r, view, maxS) {
  const { ctx, w, g } = P;
  const x = r.x + r.w - SW, y0 = view.y, h = view.h;
  ctx.fillStyle = 'rgba(200,232,248,0.9)'; ctx.fillRect(x, y0, SW, h);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x, y0, 1, h);
  if (maxS <= 0) return;
  const th = Math.max(16, Math.round(h * (h / (h + maxS))));
  const ty = y0 + Math.round((h - th) * (w.scroll / maxS));
  pill(ctx, x + 1, ty, SW - 2, th, { color: '#48b8ec' });
  P.chrome.push({ x, y: y0, w: SW, h, fn: (inp) => {
    if (inp.y >= ty && inp.y < ty + th) {
      const oy = inp.y - ty;
      if (g.desktop) g.desktop.drag = { kind: 'custom', move: (i2) => { w.scroll = clamp(((i2.y - oy - y0) / Math.max(1, h - th)) * maxS, 0, maxS); }, end() {} };
    } else w.scroll = clamp(w.scroll + (inp.y < ty ? -h : h) * 0.9, 0, maxS);
  } });
}

function connectDialog(P, view) {
  const { ctx, S, g, t } = P;
  const c = S.connecting;
  const k = c ? clamp01((nowS() - c.t0) / c.dur) : 1;
  const w = 220, h = 92;
  ecoSky(ctx, view.x, view.y, view.w, view.h, t, { sun: [0.25, 0.25], grass: 30 });
  leafSpray(ctx, view.x + view.w, view.y, 'tr', 0.8, t);
  const x = Math.round(view.x + (view.w - w) / 2), y = Math.round(view.y + (view.h - h) / 2 - 10);
  glassCard(ctx, x, y, w, h, { r: 10 });
  ecoGlobe(ctx, x + 24, y + 30, 14, t);
  // blinking modem lights
  for (let i = 0; i < 3; i++) drawGlossOrb(ctx, x + 14 + i * 9, y + 56, 2.5, (Math.floor(t * 8) + i) % 3 === 0 ? '#5cc832' : '#c8e0c0');
  const plan = S.isp();
  drawText(ctx, `Connecting to ${plan.name}...`, x + 46, y + 10, { color: INK });
  const steps = ['Dialing 555-0199...', 'Shaking hands (and fins)...', 'Registering your fishing rod on the network...', 'Connected! Bubbles: 56,000 per second.'];
  const si = k < 0.3 ? 0 : k < 0.62 ? 1 : k < 0.92 ? 2 : 3;
  wrapText(steps[si], w - 56).forEach((l, i) => drawText(ctx, l, x + 46, y + 23 + i * 10, { color: INK_SOFT }));
  drawAeroBar(ctx, x + 46, y + 50, w - 56, 9, k, { color: '#5cc832' });
  const br = { x: x + w - 64, y: y + h - 22, w: 56, h: 15 };
  const hov = P.hot && rectContains(br, P.mx, P.my);
  drawSplashButton(ctx, br.x, br.y, br.w, br.h, 'Cancel', { tone: 'glass', hover: hov, t });
  P.chrome.push({ ...br, fn: () => { S.connecting = null; S.connected = true; g.toast?.('You cancelled the dial-up. It connected anyway.', 'info'); } });
}

// ------------------------------------------------------------------ the store window renderer
export const appsea = {
  title: 'AppSea - FishNet Explorer',
  size: [480, 320],
  init(w, g) {
    w.data = { page: 'home', back: [], fwd: [], hits: [], pageH: 300, viewH: 260, loadT0: 0, lastT: 0, hl: null };
    w.scroll = 0;
    w.title = this.title;
    const S = store(g);
    S.connect(nowS());
    g.emit?.('storeOpened', w);
  },
  navigate(w, g, page, opts) { navigate(w, g, page, opts); },
  scroll(w) { return Math.max(0, (w.data.pageH || 0) - (w.data.viewH || 0)); },
  input(w, g, inp) {
    if (!inp.pressed) return;
    const hits = w.data.hits || [];
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (h.fn && rectContains(h, inp.x, inp.y)) { h.fn(inp); inp.consume?.(); return; }
    }
  },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    if (!d.back) this.init(w, g);
    const S = store(g);
    S.updateConnect(nowS());
    if ((d.lastT === 0 && !d.loadT0) || (S.connected && !d.wasConnected)) d.loadT0 = t;
    d.wasConnected = S.connected;
    d.lastT = t;
    const view = { x: r.x, y: r.y + TB, w: r.w - SW, h: r.h - TB - SBAR };
    d.viewH = view.h;
    const P = makeP(ctx, w, g, t, view);
    P.chrome = [];
    P.hot2 = (g.desktop?.windowAt ? g.desktop.windowAt(P.mx, P.my) === w : true) && rectContains(r, P.mx, P.my);
    const maxS0 = Math.max(0, d.pageH - view.h);
    if (d.wantScroll !== undefined) { w.scroll = Math.min(d.wantScroll, maxS0 || d.wantScroll); d.wantScroll = undefined; }
    w.scroll = clamp(w.scroll, 0, maxS0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.x, view.y, view.w, view.h);
    ctx.clip();
    pageBg(ctx, view.x, view.y, view.w, view.h, w.scroll);
    const dur = LOAD_TIME[ispTier(g.state)] ?? 0;
    const loadK = !S.connected ? 0 : dur > 0 ? clamp01((t - d.loadT0) / dur) : 1;
    const loading = loadK < 1 ? loadK : 0;
    if (S.connected) {
      d.loadingIcons = loadK < 0.85;
      const end = renderPage(P);
      d.pageH = end - (view.y - w.scroll);
      if (loadK < 1) {
        // slow internet: the page appears top to bottom behind a soft bubbly curtain
        const ry = view.y + Math.round(view.h * loadK * 1.15);
        P.hits = P.hits.filter((h) => h.y + h.h <= ry);
        pageBg(ctx, view.x, ry, view.w, view.y + view.h - ry, w.scroll);
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(view.x, ry, view.w, 1);
        for (let i = 0; i < 6; i++) drawAeroBubble(ctx, view.x + ((i * 61 + t * 40) % view.w), ry + 4 + (i % 3) * 3, 2 + (i % 2), 0.8);
      }
    } else {
      d.pageH = view.h;
      connectDialog(P, view);
    }
    ctx.restore();
    toolbar(P, r);
    scrollbar(P, r, view, Math.max(0, d.pageH - view.h));
    statusBar(P, r, loading);
    w.title = S.connecting ? 'Connecting... - FishNet Explorer' : loading ? 'Loading AppSea... - FishNet Explorer' : this.title;
    d.hits = [...P.hits, ...P.chrome];
  },
};

// ------------------------------------------------------------------ download dialog
function dlButtons(P, right, y, specs) {
  let bx = right;
  for (const s of specs) {
    const r = { x: bx - s.w, y, w: s.w, h: 16 };
    const hov = !s.disabled && rectContains(r, P.mx, P.my) && P.hot;
    drawSplashButton(P.ctx, r.x, r.y, r.w, r.h, s.label, { tone: s.tone || 'glass', hover: hov, down: hov && P.g.input?.down, disabled: s.disabled, t: P.t });
    if (!s.disabled) P.chrome.push({ ...r, fn: s.fn });
    bx -= s.w + 5;
  }
}

function row(ctx, x, y, label, value, vx = 84, color = INK) {
  drawText(ctx, label, x, y, { color: INK_SOFT });
  drawText(ctx, value, x + vx, y, { color });
}

// Bait bubbles flying from the AppSea globe into the bait box.
function flyAnim(ctx, x, y, w, art, t, done) {
  ecoGlobe(ctx, x + 14, y + 14, 12, t);
  glassCard(ctx, x + w - 30, y + 2, 28, 24, { r: 6, top: 'rgba(255,250,236,0.95)', bottom: 'rgba(255,220,160,0.9)', edge: 'rgba(240,160,60,0.9)' });
  drawText(ctx, 'BAIT', x + w - 16, y + 18, { font: 'small', color: '#b0601a', align: 'center' });
  if (done) { if (art) drawBaitGloss(ctx, art, x + w - 16, y + 10, 14, t, { bubble: false }); return; }
  for (let k = 0; k < 3; k++) {
    const p = (t * 0.6 + k / 3) % 1;
    const fx = x + 26 + p * (w - 58), fy = y + 12 - Math.sin(p * Math.PI) * 12;
    ctx.globalAlpha = Math.min(1, Math.sin(p * Math.PI) * 3);
    if (art) drawBaitGloss(ctx, art, fx, fy, 12, t, { bob: false });
    else drawAeroBubble(ctx, fx, fy, 4, 1);
    ctx.globalAlpha = 1;
  }
}

export const appseaDl = {
  title: 'Downloads',
  size: [280, 168],
  init(w) {
    w.data = { hits: [], closeWhenDone: false };
    w.title = 'File Download';
  },
  input(w, g, inp) { appsea.input(w, g, inp); },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    if (!d.hits) this.init(w);
    const S = store(g);
    const P = makeP(ctx, w, g, t, r);
    P.chrome = [];
    const bg = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    bg.addColorStop(0, '#f8fdff'); bg.addColorStop(1, '#d4eefa');
    ctx.fillStyle = bg; ctx.fillRect(r.x, r.y, r.w, r.h);
    leafSpray(ctx, r.x + r.w, r.y + r.h + 4, 'br', 0.4, t);
    const pend = S.pending(), act = S.active(), last = S.recent[0];
    const x = r.x + 8, right = r.x + r.w - 8, by = r.y + r.h - 22;
    if (pend) {
      const I = dlInfo(pend);
      w.title = 'File Download - Security Warning';
      ecoSky(ctx, r.x, r.y, r.w, 26, t, { sun: [0.9, 0.2], arcs: false, clouds: false });
      drawText(ctx, 'Do you want to download this file?', x, r.y + 6, { color: '#ffffff', shadow: '#0a4a8a' });
      drawText(ctx, 'APPSEA DOWNLOAD MANAGER  BETA', x, r.y + 16, { font: 'small', color: '#e8faff' });
      if (I.art) drawBaitGloss(ctx, I.art, x + 16, r.y + 46, 30, t);
      row(ctx, x + 38, r.y + 33, 'Name:', I.file.slice(0, 28), 34);
      row(ctx, x + 38, r.y + 44, 'Bait:', `x${I.qty} ${I.name}`.slice(0, 28), 34, '#2a8a20');
      row(ctx, x + 38, r.y + 55, 'Size:', formatSize(I.kb), 34);
      const wy = r.y + 70;
      glassCard(ctx, r.x + 4, wy, r.w - 8, 36, { r: 7, top: 'rgba(255,250,224,0.98)', bottom: 'rgba(255,232,170,0.95)', edge: 'rgba(230,160,40,0.9)', shadow: false });
      drawGlossOrb(ctx, x + 8, wy + 13, 7, '#ffb02e', t);
      drawText(ctx, '!', x + 8, wy + 10, { align: 'center', color: '#ffffff' });
      const msg = WARNINGS[Math.max(0, pend.warn)];
      wrapText(msg, r.w - 40).slice(0, 2).forEach((l, i) => drawText(ctx, l, x + 22, wy + 6 + i * 10, { color: '#8a4a00' }));
      if (pend.paid) drawText(ctx, `YOU PAID ${pend.paid} ${CURRENCY.toUpperCase()}. "NO" REFUNDS IT.`, x + 22, wy + 27, { font: 'small', color: GREY });
      dlButtons(P, right, by, [
        { label: 'No', w: 44, fn: () => S.confirm(pend.uid, false) },
        { label: 'Yes, fish me', w: 84, tone: 'green', fn: () => S.confirm(pend.uid, true) },
      ]);
    } else if (act) {
      const I = dlInfo(act);
      const frac = act.done / act.kb;
      w.title = `${Math.floor(frac * 100)}% of ${I.file} Completed`;
      flyAnim(ctx, x, r.y + 4, r.w - 16, I.art, t, false);
      const more = S.queued().length - 1;
      drawText(ctx, 'Saving:', x, r.y + 38, { color: INK_SOFT });
      if (more > 0) drawText(ctx, `(+${more} MORE IN QUEUE)`, right, r.y + 39, { font: 'small', color: '#a07a20', align: 'right' });
      let line = `${I.file} from ${HOST}`;
      while (measureText(line) > r.w - 16 && line.length > 6) line = line.slice(0, -4) + '...';
      drawText(ctx, line, x, r.y + 48, { color: INK });
      drawAeroBar(ctx, x, r.y + 60, r.w - 16, 11, frac, { color: '#38c8f0' });
      row(ctx, x, r.y + 77, 'Time left:', `${formatTime(S.eta(act))} (${formatSize(act.done)} of ${formatSize(act.kb)})`, 62);
      row(ctx, x, r.y + 88, 'Delivers:', `x${I.qty} ${I.name} to your bait box`.slice(0, 34), 62, '#2a8a20');
      row(ctx, x, r.y + 99, 'Transfer:', formatSpeed(S.shownSpeed()).replace('/s', '/Sec'), 62);
      const cb = { x, y: r.y + 112, w: 200, h: 10 };
      rrect(ctx, cb.x, cb.y, 9, 9, 3); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#5aa2cc'; ctx.lineWidth = 1; ctx.stroke();
      if (d.closeWhenDone) drawGlossOrb(ctx, cb.x + 4.5, cb.y + 4.5, 2.5, GRASS);
      P.chrome.push({ ...cb, fn: () => { d.closeWhenDone = !d.closeWhenDone; g.audio?.play('ui_toggle'); } });
      drawText(ctx, 'Close this dialog when the download completes', x + 13, r.y + 113, { color: INK });
      dlButtons(P, right, by, [{ label: 'Cancel', w: 54, fn: () => S.cancel(act.uid) }]);
      d.sawActive = true;
    } else if (last) {
      const b = BAITS[last.bait];
      w.title = 'Download complete';
      if (d.closeWhenDone && d.sawActive) { d.sawActive = false; setTimeout(() => g.desktop?.closeWindow?.(w), 900); }
      ecoSky(ctx, r.x, r.y, r.w, 40, t, { sun: [0.15, 0.3], grass: 10, clouds: false });
      if (b) drawBaitGloss(ctx, b.art, x + 18, r.y + 20, 32, t);
      drawText(ctx, 'Download complete!', x + 40, r.y + 8, { color: '#ffffff', shadow: '#0a4a8a' });
      drawText(ctx, `+${last.qty} ${b?.name || last.title}`, x + 40, r.y + 20, { color: '#f0ffd0', shadow: '#1a5a10' });
      for (let i = 0; i < 4; i++) drawSparkle(ctx, x + 6 + ((i * 47 + t * 20) % 60), r.y + 6 + ((i * 13) % 30), 2, 0.5 + 0.5 * Math.sin(t * 6 + i));
      row(ctx, x, r.y + 50, 'Saved:', `${last.file}`.slice(0, 34), 62);
      row(ctx, x, r.y + 61, 'Took:', `${formatSize(last.kb)} in ${formatTime(last.secs)}`, 62);
      row(ctx, x, r.y + 72, 'Lure:', b ? `x${b.attract.toFixed(2)}  Rare x${b.rarity.toFixed(2)}` : '-', 62, '#8a3ad0');
      drawText(ctx, 'ONE BAIT IS USED UP FOR EACH FISH YOU HOOK.', x, r.y + 88, { font: 'small', color: GREY });
      dlButtons(P, right, by, [
        { label: 'Close', w: 46, fn: () => g.desktop?.closeWindow?.(w) },
        { label: 'Bait box', w: 62, fn: () => openBaitBox(g) },
        { label: 'Use it!', w: 56, tone: 'green', fn: () => {
          const st = g.state.bait;
          if (st && b && ((st.inv?.[b.id] || 0) > 0)) { st.equipped = b.id; g.emit?.('baitEquipped', b.id); g.toast?.(`${b.name} is on your hook!`, 'bait'); }
          g.desktop?.closeWindow?.(w);
        } },
      ]);
    } else {
      w.title = 'Downloads';
      flyAnim(ctx, x, r.y + 4, r.w - 16, null, t, true);
      drawText(ctx, 'No downloads in progress.', x, r.y + 46, { color: INK });
      drawText(ctx, 'Visit AppSea to find bait for your hook!', x, r.y + 58, { color: INK_SOFT });
      dlButtons(P, right, by, [
        { label: 'Close', w: 46, fn: () => g.desktop?.closeWindow?.(w) },
        { label: 'Visit AppSea', w: 80, tone: 'green', fn: () => g.desktop?.openApp?.('appsea') },
      ]);
    }
    d.hits = P.chrome;
  },
};

// ------------------------------------------------------------------ two Weird apps
const moreram = {
  title: 'Download More RAM',
  size: [236, 124],
  init(w) { w.data = { ram: 512, hits: [] }; },
  input(w, g, inp) { appsea.input(w, g, inp); },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    if (!d.hits) this.init(w);
    const P = makeP(ctx, w, g, t, r);
    P.chrome = [];
    ecoSky(ctx, r.x, r.y, r.w, r.h, t, { sun: [0.85, 0.15], grass: 22 });
    ctx.drawImage(getAppIcon('ram'), r.x + 8, r.y + 10 + Math.round(Math.sin(t * 3)));
    drawText(ctx, 'RAM DOUBLER 3000', r.x + 48, r.y + 8, { color: '#ffffff', shadow: '#0a4a8a' });
    drawText(ctx, `INSTALLED RAM: ${formatCommas(d.ram)} MB`, r.x + 48, r.y + 20, { font: 'small', color: '#e8faff' });
    drawAeroBar(ctx, r.x + 48, r.y + 30, r.w - 58, 9, (t * 0.1) % 1, { color: '#5cc832' });
    drawText(ctx, `YOUR PC IS ${(87 - Math.min(86.9, (d.ram - 512) * 0.0001)).toFixed(4)}% SLOW`, r.x + 48, r.y + 45, { font: 'small', color: '#fff2a0' });
    const br = { x: r.x + 48, y: r.y + 62, w: 120, h: 20 };
    const hov = rectContains(br, P.mx, P.my) && P.hot;
    drawSplashButton(ctx, br.x, br.y, br.w, br.h, 'Download more!', { tone: 'green', hover: hov, t, down: hov && g.input?.down });
    P.chrome.push({ ...br, fn: () => { d.ram += 1; g.audio?.play('ui_click'); if (d.ram % 5 === 0) g.toast?.('Your PC is now 0.0001% faster. Fish are impressed.', 'sparkle'); } });
    d.hits = P.chrome;
  },
};

const VIRUS_LINES = ["Hi! I'm totally not a virus!", "I definitely didn't rename anything.", 'Want a fish? Go catch one!', 'Scanning... 0 viruses. 1 crab.', 'I am just a normal program. Beep boop.'];
const notavirus = {
  title: 'NotAVirus.exe',
  size: [236, 124],
  init(w) { w.data = { hits: [], i: 0 }; },
  input(w, g, inp) { appsea.input(w, g, inp); },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    if (!d.hits) this.init(w);
    const P = makeP(ctx, w, g, t, r);
    P.chrome = [];
    const bg = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    bg.addColorStop(0, '#5a3ab0'); bg.addColorStop(1, '#2a1a6a');
    ctx.fillStyle = bg; ctx.fillRect(r.x, r.y, r.w, r.h);
    ecoBubbles(ctx, r.x, r.y, r.w, r.h, t, 10);
    const icon = getAppIcon('virus', { size: 64 });
    ctx.drawImage(icon, r.x + 8, r.y + 20 + Math.round(Math.sin(t * 4) * 3));
    const line = VIRUS_LINES[Math.floor(t / 3) % VIRUS_LINES.length];
    glassCard(ctx, r.x + 78, r.y + 14, r.w - 86, 36, { r: 8, shadow: false });
    wrapText(line, r.w - 96).slice(0, 3).forEach((l, i) => drawText(ctx, l, r.x + 84, r.y + 19 + i * 10, { color: INK }));
    const br = { x: r.x + 78, y: r.y + 64, w: 120, h: 18 };
    const hov = rectContains(br, P.mx, P.my) && P.hot;
    drawSplashButton(ctx, br.x, br.y, br.w, br.h, 'Scan for viruses', { tone: 'purple', hover: hov, t, down: hov && g.input?.down });
    P.chrome.push({ ...br, fn: () => { g.audio?.play('glitch'); g.toast?.('Scan complete: 0 viruses found. 1 crab found. The crab says hi.', 'skull'); } });
    d.hits = P.chrome;
  },
};

export const STORE_RENDERERS = { appsea, appsea_dl: appseaDl, moreram, notavirus };
