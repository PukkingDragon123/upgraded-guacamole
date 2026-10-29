// AppSea: a retro 2000s download website rendered as the content of a desktop window, plus the classic
// download dialog and two new "Weird" apps. Renderers follow the APP_RENDERERS contract
// {title, size, init, draw(ctx, win, game, rect, t), input(win, game, inp, rect), scroll(win, rect), close}.
// Hit regions are recorded while drawing (absolute coords) and resolved in input(), so drawing and clicking
// always agree. Pages: 'home', a category id, 'top', 'new', 'isp' (SlowNet ISP), 'downloads'.

import { clamp, clamp01, rectContains, formatCommas, hash1 } from '../core/math.js';
import { drawText, wrapText, measureText } from '../gfx/font.js';
import { getAppIcon, getMiniIcon } from '../desktop/icons.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { CATALOG, CATALOG_BY_ID, CATEGORIES, TIERS, MAX_TIER, appsIn, listing, downloadCount, formatSize, formatSpeed, formatTime, formatShortTime } from './catalog.js';
import { ISP_TIERS, ispTier } from './isp.js';
import { WARNINGS, installStore } from './downloads.js';
import * as A from './webart.js';

const TB = 15, SBAR = 11, SW = 10;
const HOST = 'www.appsea.sea';
const LINK = '#0000cc', LINK_HOT = '#e00000', TEXT = '#1a1a2a', GREY = '#5a6070';
const LOAD_TIME = [1.1, 0.7, 0.35, 0.15, 0.05, 0];
const PAGE_NAMES = { home: 'index.html', top: 'top10.html', new: 'new.html', isp: 'slownet/plans.asp', downloads: 'my_downloads.cgi' };
const MARQUEE = '  ***  WELCOME TO APPSEA  ***  100% FREE DOWNLOADS  ***  NO VIRUSES (ONLY FISH)  ***  BIGGER FILES = HUNGRIER FISH  ***  DRAG ANY APP INTO YOUR BAIT BOX  ***  TOO SLOW? UPGRADE YOUR SLOWNET TODAY  ***  NEW: DOWNLOAD MORE RAM!!!  ';
const ADS = ['visitor', 'ram', 'isp', 'boat', 'crab'];

const nowS = () => Date.now() / 1000;
const pageUrl = (p) => `http://${HOST}/${PAGE_NAMES[p] || 'category/' + p + '.html'}`;
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
  const c = hov ? hot : color;
  drawText(P.ctx, text, x, y, { font, color: c });
  P.ctx.fillStyle = c;
  P.ctx.fillRect(x, y + th + 1, tw, 1);
  return tw;
}

function box(ctx, x, y, w, h, title, { head = ['#000080', '#1084d0'], body = '#ffffff', border = '#000080' } = {}) {
  ctx.fillStyle = border;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = body;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  if (title) {
    A.drawGrad(ctx, x + 1, y + 1, w - 2, 10, head, 'h');
    drawText(ctx, title, x + 4, y + 3, { font: 'small', color: '#ffffff' });
  }
}

function sectionBar(ctx, x, y, w, title, t, colors = ['#c00000', '#ff6a00', '#ffcc00']) {
  A.drawGrad(ctx, x, y, w, 13, colors, 'h');
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y + 12, w, 1);
  drawText(ctx, title, x + 6, y + 3, { color: '#ffffff', outline: '#5a0000' });
  return y + 16;
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

// ------------------------------------------------------------------ app card
const CARD_H = 66;

function card(P, x, y, w, appId) {
  const { ctx, S, t, d } = P;
  const fam = CATALOG_BY_ID[appId];
  const cur = S.tierOf(appId), next = S.nextTier(appId), dl = S.downloadOf(appId);
  const show = dl ? dl.tier : next >= 0 ? next : cur;
  const L = listing(appId, show);
  const r = { x, y, w, h: CARD_H };
  if (!visible(P, r)) return y + CARD_H + 4;
  const hl = d.hl === appId;
  if (hl && d.hlScroll) { d.hlScroll = false; d.wantScroll = Math.max(0, y - P.view.y + P.w.scroll - 30); }
  // frame
  ctx.fillStyle = hl ? (Math.floor(t * 4) % 2 ? '#ff2a2a' : '#ffd23a') : '#8a9ac0';
  ctx.fillRect(x, y, w, CARD_H);
  ctx.fillStyle = cur >= 0 ? '#f2fff0' : '#ffffff';
  ctx.fillRect(x + 1, y + 1, w - 2, CARD_H - 2);
  if (hl) { ctx.fillStyle = Math.floor(t * 4) % 2 ? '#ff2a2a' : '#ffd23a'; ctx.fillRect(x + 1, y + 1, w - 2, 1); ctx.fillRect(x + 1, y + CARD_H - 2, w - 2, 1); }
  ctx.fillStyle = '#eef2fa';
  ctx.fillRect(x + 1, y + 1, 42, CARD_H - 2);
  // icon in a sunken frame + tier ladder
  A.bevel(ctx, x + 5, y + 5, 36, 36, { face: '#ffffff', inset: true, thin: true });
  const loading = d.loadingIcons;
  if (loading) {
    ctx.fillStyle = '#c0c0c0'; ctx.fillRect(x + 9, y + 9, 28, 28);
    drawText(ctx, 'x', x + 21, y + 19, { color: '#e00000' });
  } else {
    const bob = hl ? Math.round(Math.sin(t * 6) * 1.5) : 0;
    ctx.drawImage(getAppIcon(L.icon, { tier: show }), x + 7, y + 7 + bob);
  }
  for (let i = 0; i <= MAX_TIER; i++) {
    const px = x + 5 + i * 7, py = y + 45;
    const on = i <= cur, downloading = dl && dl.tier === i;
    ctx.fillStyle = '#20283a';
    ctx.fillRect(px, py, 6, 6);
    ctx.fillStyle = on ? TIERS[i].color : downloading ? (Math.floor(t * 4) % 2 ? TIERS[i].color : '#ffffff') : '#d8dce8';
    ctx.fillRect(px + 1, py + 1, 4, 4);
    if (on) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(px + 1, py + 1, 4, 1); }
  }
  drawText(ctx, cur >= 0 ? TIERS[cur].short : 'NONE', x + 22, y + 54, { font: 'small', color: cur >= 0 ? TIERS[cur].color : '#9aa0b0', align: 'center' });
  // text column
  const tx = x + 48, bx = x + w - 76;
  let nx = tx + link(P, fam.name, tx, y + 5, () => {}, { url: `http://${HOST}/apps/${appId}.html` }) + 4;
  nx += A.drawTag(ctx, nx, y + 4, `${TIERS[show].short} ${L.version}`, TIERS[show].color, show === 4 ? '#3a1e06' : '#ffffff') + 3;
  if (fam.isNew && nx < bx - 24) A.drawBurst(ctx, nx + 1, y + 4, 'NEW!', t);
  else if (fam.hot && nx < bx - 24) A.drawBurst(ctx, nx + 1, y + 4, 'HOT!', t + 0.2, { color: '#ff7a00' });
  const sx = tx + A.drawStars(ctx, tx - 1, y + 14, fam.stars) + 2;
  drawText(ctx, `${formatCommas(downloadCount(appId))} DOWNLOADS`, sx, y + 16, { font: 'small', color: GREY });
  // size / bait / power
  let ix = tx;
  drawText(ctx, 'SIZE:', ix, y + 25, { font: 'small', color: GREY });
  ix += 22;
  drawText(ctx, formatSize(L.kb).toUpperCase(), ix, y + 25, { font: 'small', color: '#c00000' });
  ix += measureText(formatSize(L.kb), 'small') + 6;
  ctx.drawImage(getMiniIcon(L.icon), ix - 2, y + 21);
  ix += 13;
  drawText(ctx, L.type.toUpperCase(), ix, y + 25, { font: 'small', color: '#2a6a2a' });
  ix += measureText(L.type, 'small') + 6;
  drawText(ctx, 'POWER', ix, y + 25, { font: 'small', color: GREY });
  ix += 23;
  const pw = clamp01((L.power - 1) / 2.6);
  ctx.fillStyle = '#20283a'; ctx.fillRect(ix, y + 24, 22, 7);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = pw * 5 > i + 0.15 ? ['#3ad040', '#9ad83a', '#ffd23a', '#ff8a1e', '#ff3a3a'][i] : '#4a5068';
    ctx.fillRect(ix + 1 + i * 4, y + 25, 3, 5);
  }
  drawText(ctx, 'x' + L.power.toFixed(2), ix + 25, y + 25, { font: 'small', color: '#8a3ad0' });
  // description
  const lines = wrapText(L.desc, bx - tx - 4);
  lines.slice(0, 2).forEach((l, i) => drawText(ctx, l, tx, y + 36 + i * 10, { color: '#3a4a5a' }));
  if (cur >= 0 && next >= 0 && !dl) drawText(ctx, `YOU HAVE ${TIERS[cur].name.toUpperCase()}. UPGRADE FOR MORE BAIT POWER!`, tx, y + 57, { font: 'small', color: '#2a8a2a' });
  else drawText(ctx, `BY ${fam.publisher.toUpperCase()}`, tx, y + 57, { font: 'small', color: '#9aa0b0' });
  // action area
  ctx.fillStyle = '#c8d0e4';
  ctx.fillRect(bx - 4, y + 4, 1, CARD_H - 8);
  cardAction(P, bx, y, appId, L, { cur, next, dl, hl });
  return y + CARD_H + 4;
}

function cardAction(P, bx, y, appId, L, { cur, next, dl, hl }) {
  const { ctx, S, t, g, d } = P;
  const bw = 72;
  if (dl) {
    if (dl.state === 'confirm') {
      drawText(ctx, 'AWAITING', bx + bw / 2, y + 10, { font: 'small', color: '#c06000', align: 'center' });
      drawText(ctx, 'YOUR OK...', bx + bw / 2, y + 18, { font: 'small', color: '#c06000', align: 'center' });
      if (hit(P, { x: bx + 4, y: y + 28, w: bw - 8, h: 14 }, () => S.openDialog(P.w), 'dialog')) ctx.fillStyle = '#ffe8a0';
      A.winButton(ctx, bx + 4, y + 28, bw - 8, 14, 'Show', { font: 'small' });
      return;
    }
    const active = S.active() === dl;
    const frac = dl.done / dl.kb;
    drawText(ctx, active ? 'DOWNLOADING' : 'QUEUED #' + (S.queued().indexOf(dl) + 1), bx + bw / 2, y + 7, { font: 'small', color: active ? '#1a58d0' : '#8a6a20', align: 'center' });
    A.drawPill(ctx, bx, y + 16, bw, 9, frac, active ? '#3a8af8' : '#c8a83a');
    drawText(ctx, Math.floor(frac * 100) + '%', bx + bw / 2, y + 29, { font: 'small', color: TEXT, align: 'center' });
    drawText(ctx, formatShortTime(S.eta(dl)).toUpperCase() + ' LEFT', bx + bw / 2, y + 37, { font: 'small', color: GREY, align: 'center' });
    link(P, 'cancel', bx + bw / 2 - 13, y + 49, () => S.cancel(dl.uid), { url: 'javascript:cancel()' });
    return;
  }
  if (next < 0) {
    A.glossButton(ctx, bx, y + 8, bw, 22, 'INSTALLED', { color: 'grey', disabled: true });
    drawText(ctx, 'MAX TIER!', bx + bw / 2, y + 35, { font: 'small', color: '#2a8a2a', align: 'center' });
    if (hit(P, { x: bx, y: y + 44, w: bw, h: 9 }, () => g.desktop?.openApp?.(appKey(appId)), 'open')) ctx.globalAlpha = 1;
    link(P, 'open', bx + bw / 2 - 9, y + 46, () => g.desktop?.openApp?.(appKey(appId)), { url: 'file:///C:/Desktop/' + appId });
    return;
  }
  const price = L.price, broke = price > (g.state.coins || 0);
  const upgrade = cur >= 0;
  const label = price ? (upgrade ? 'BUY UPGRADE' : 'BUY & GET') : upgrade ? 'UPGRADE\nNOW!' : 'DOWNLOAD\nNOW!';
  const r = { x: bx, y: y + 6, w: bw, h: 22 };
  const hov = hit(P, r, () => { if (d.hl === appId) d.hl = null; S.request(appId, { near: P.w }); }, `http://${HOST}/get.cgi?file=${L.file}`);
  const down = hov && g.input?.down;
  A.glossButton(ctx, r.x, r.y, r.w, r.h, price ? label : label, { color: price ? (broke ? 'red' : 'orange') : upgrade ? 'blue' : 'green', hover: hov, down, t });
  if (price) drawText(ctx, `{coin} ${price}`, bx + bw / 2, y + 32, { color: broke ? '#c00000' : '#8a5a00', align: 'center' });
  else if (Math.floor(t * 2) % 2 === 0) drawText(ctx, 'FREE!!', bx + bw / 2, y + 32, { color: '#e00000', align: 'center' });
  const eta = L.kb / S.speed();
  drawText(ctx, `~${formatShortTime(eta).toUpperCase()} ON ${S.isp().short.toUpperCase()}`, bx + bw / 2, y + 44, { font: 'small', color: eta > 300 ? '#c00000' : GREY, align: 'center' });
  if (eta > 120) link(P, 'go faster?', bx + bw / 2 - 20, y + 53, () => navigate(P.w, g, 'isp'), { font: 'small', url: pageUrl('isp') });
  if (hl) {
    const hand = getUiIcon('cursor_hand');
    const k = Math.abs(Math.sin(t * 5));
    if (hand) P.ctx.drawImage(hand, Math.round(bx + bw / 2 - 2), Math.round(y + 24 + k * 4));
    A.drawBurst(ctx, bx - 4, y - 3, 'CLICK HERE!', t, { color: '#ff2a2a' });
  }
}

function appKey(appId) {
  return { fishnet: 'browser', calculator: 'calc', videos: 'video' }[appId] || appId;
}

// ------------------------------------------------------------------ page sections
function header(P, x, y, W) {
  const { ctx, t, g } = P;
  A.drawGrad(ctx, x, y, W, 46, ['#06064a', '#1a32b0', '#2a86e8', '#62dcff']);
  for (let i = 0; i < 12; i++) {
    const bx = x + Math.round(hash1(i, 4) * (W - 4)), by = y + 44 - ((t * (8 + i % 4 * 3) + i * 11) % 44);
    ctx.fillStyle = 'rgba(220,250,255,0.55)';
    ctx.fillRect(bx, Math.round(by), 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(bx, Math.round(by), 1, 1);
  }
  // a fish swims through the banner
  const fx = x + ((t * 30) % (W + 40)) - 20, fy = y + 30 + Math.round(Math.sin(t * 3) * 2);
  ctx.fillStyle = '#ff8a2a'; ctx.fillRect(Math.round(fx), fy, 7, 4); ctx.fillRect(Math.round(fx) + 1, fy - 1, 5, 6);
  ctx.fillRect(Math.round(fx) - 3, fy - 1, 2, 6); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(fx) + 5, fy + 1, 1, 1);
  const logo = A.wordArt('AppSea', { scale: 3 });
  ctx.drawImage(logo, x + 4, y + 2);
  A.drawBurst(ctx, x + logo.width + 2, y + 5, 'WOW!', t);
  drawText(ctx, "THE OCEAN'S #1 DOWNLOAD SITE!!!", x + 10, y + 33, { font: 'small', color: '#ffffff', shadow: '#06064a', wave: 1, time: t });
  // visitor counter + guestbook
  const vx = x + W - 58;
  drawText(ctx, 'VISITORS:', vx, y + 6, { font: 'small', color: '#bff0ff' });
  A.drawCounter(ctx, vx - 1, y + 13, 1337000 + Math.floor(Date.now() / 3000) % 900000, 8);
  if (Math.floor(t * 1.5) % 2 === 0 || P.hot) link(P, 'GUESTBOOK', vx + 2, y + 27, () => g.toast?.('Guestbook entry #4,812: "nice site!!! - a fish"', 'book'), { font: 'small', color: '#ffff40', hot: '#ffffff', url: `http://${HOST}/guestbook.cgi` });
  return y + 46;
}

function marquee(P, x, y, W) {
  const { ctx, t } = P;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, W, 11);
  const tw = measureText(MARQUEE);
  const off = (t * 34) % tw;
  for (let k = 0; k < 3; k++) drawText(ctx, MARQUEE, Math.round(x - off + k * tw), y + 2, { color: Math.floor(t * 2) % 2 ? '#ffff00' : '#40ff40' });
  return y + 11;
}

function navbar(P, x, y, W) {
  const { ctx, g, S, d } = P;
  A.drawGrad(ctx, x, y, W, 13, ['#f4f4f8', '#c8ccd8', '#a4aabc']);
  ctx.fillStyle = '#6a7088';
  ctx.fillRect(x, y + 12, W, 1);
  const nq = S.st.downloads.length;
  const items = [['HOME', 'home'], ['TOP 10', 'top'], ['NEW!', 'new'], ['SLOWNET ISP', 'isp'], [`MY DOWNLOADS${nq ? ' (' + nq + ')' : ''}`, 'downloads'], ['BOATYARD', '@boat']];
  let nx = x + 6;
  for (const [label, page] of items) {
    const act = d.page === page;
    if (act) { ctx.fillStyle = '#ffffff'; ctx.fillRect(nx - 3, y + 1, measureText(label, 'small') + 6, 11); }
    nx += link(P, label, nx, y + 4, () => (page === '@boat' ? openBoatyard(g) : navigate(P.w, g, page)), { font: 'small', color: act ? '#c00000' : '#000080', url: page === '@boat' ? 'http://barnabys.boats/' : pageUrl(page) }) + 5;
    if (nx < x + W - 10) drawText(ctx, '|', nx - 1, y + 3, { color: '#7a8098' });
    nx += 6;
  }
  return y + 13;
}

function openBoatyard(g) {
  if (g.ui?.panels?.boatyard) g.ui.open('boatyard');
  else g.toast?.("Barnaby's Boatyard is closed today. (Gone fishing.)", 'info');
}

function sidebar(P, x, y) {
  const { ctx, g, S, t, d } = P;
  const W = 86;
  // categories
  const ch = 14 + (CATEGORIES.length + 1) * 11;
  box(ctx, x, y, W, ch, 'CATEGORIES');
  let ly = y + 15;
  for (const c of [{ id: 'home', name: 'Home' }, ...CATEGORIES]) {
    const act = d.page === c.id;
    drawText(ctx, '>', x + 4, ly, { color: act ? '#c00000' : '#ff7a00' });
    const n = c.id === 'home' ? '' : ` (${appsIn(c.id).length})`;
    link(P, c.name + n, x + 11, ly, () => navigate(P.w, g, c.id), { color: act ? '#c00000' : LINK, url: pageUrl(c.id) });
    if (c.id === 'weird' && Math.floor(t * 3) % 2) drawText(ctx, '!', x + W - 8, ly, { color: '#ff2a2a' });
    ly += 11;
  }
  y += ch + 5;
  // my stuff
  box(ctx, x, y, W, 47, 'MY COMPUTER', { head: ['#006000', '#30b030'], border: '#006000' });
  const inst = S.st.installed.length;
  drawText(ctx, `INSTALLED: ${inst}`, x + 4, y + 15, { font: 'small', color: TEXT });
  drawText(ctx, `NET: ${S.isp().short.toUpperCase()}`, x + 4, y + 23, { font: 'small', color: TEXT });
  drawText(ctx, formatSpeed(S.speed()).toUpperCase(), x + 4, y + 31, { font: 'small', color: '#2a8a2a' });
  link(P, `downloads (${S.st.downloads.length})`, x + 4, y + 38, () => navigate(P.w, g, 'downloads'), { font: 'small', url: pageUrl('downloads') });
  y += 52;
  // SlowNet ad
  const ar = { x, y, w: W, h: 44 };
  const hov = hit(P, ar, () => navigate(P.w, g, 'isp'), pageUrl('isp'));
  A.drawGrad(ctx, x, y, W, 44, hov ? ['#ffe08a', '#ff9a2a'] : ['#ffd23a', '#ff6a00']);
  ctx.fillStyle = '#5a2a00';
  ctx.fillRect(x, y, W, 1); ctx.fillRect(x, y + 43, W, 1); ctx.fillRect(x, y, 1, 44); ctx.fillRect(x + W - 1, y, 1, 44);
  A.drawSnail(ctx, x + 4 + ((t * 4) % 30), y + 4, t);
  drawText(ctx, 'TOO SLOW?', x + W / 2, y + 22, { align: 'center', color: '#5a1a00' });
  if (Math.floor(t * 2.5) % 2) drawText(ctx, 'GET SLOWNET!', x + W / 2, y + 33, { font: 'small', align: 'center', color: '#ffffff', outline: '#a02a00' });
  y += 49;
  // boatyard ad
  const br = { x, y, w: W, h: 30 };
  const bh = hit(P, br, () => openBoatyard(g), 'http://barnabys.boats/');
  ctx.fillStyle = bh ? '#d8f0ff' : '#bfe4ff';
  ctx.fillRect(x, y, W, 30);
  ctx.fillStyle = '#0a4a8a';
  ctx.fillRect(x, y, W, 1); ctx.fillRect(x, y + 29, W, 1);
  ctx.drawImage(getAppIcon('boat', { size: 32 }), x + 1, y - 1 + Math.round(Math.sin(t * 2) * 1));
  drawText(ctx, 'BIGGER', x + 34, y + 6, { font: 'small', color: '#0a2a6a' });
  drawText(ctx, 'BOAT =', x + 34, y + 13, { font: 'small', color: '#0a2a6a' });
  drawText(ctx, 'BIGGER FISH', x + 34, y + 20, { font: 'small', color: '#c00000' });
  y += 35;
  // 88x31 badges
  A.drawBadge88(ctx, x + 14, y, 'BEST VIEWED', 'FISHNET 5.0', { bg: '#003a8a', fg: '#ffd23a', accent: '#40c0ff' });
  y += 23;
  A.drawBadge88(ctx, x + 14, y, 'MADE WITH', 'NOTEPAD', { bg: '#4a0a4a', fg: '#40ff40', accent: '#ff40ff' });
  y += 23;
  return y;
}

function bannerAd(P, x, y, w) {
  const { ctx, t, g } = P;
  const h = 40;
  const kind = ADS[Math.floor(t / 7) % ADS.length];
  const r = { x, y, w, h };
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, h);
  const flash = Math.floor(t * 3) % 2;
  let act = null;
  if (kind === 'visitor') {
    A.drawGrad(ctx, x + 1, y + 1, w - 2, h - 2, flash ? ['#ff0000', '#ffcc00'] : ['#ffcc00', '#ff0000'], 'h');
    drawText(ctx, 'CONGRATULATIONS!!! YOU ARE VISITOR #1,000,000!', x + w / 2, y + 8, { align: 'center', color: '#ffffff', outline: '#600000' });
    drawText(ctx, 'CLICK HERE TO CLAIM YOUR FREE FISH!!!', x + w / 2, y + 22, { align: 'center', color: flash ? '#ffff00' : '#ffffff', outline: '#000000' });
    act = () => {
      if (!P.S.claimedFreeFish) { P.S.claimedFreeFish = true; g.state.coins = (g.state.coins || 0) + 1; g.toast?.('There is no free fish. Here is 1 coin for your trouble.', 'coin'); }
      else g.toast?.('You already claimed your free fish. It was a coin.', 'coin');
    };
  } else if (kind === 'ram') {
    A.drawGrad(ctx, x + 1, y + 1, w - 2, h - 2, ['#003000', '#00a000']);
    ctx.drawImage(getAppIcon('ram'), x + 6, y + 4);
    drawText(ctx, 'YOUR PC IS 87% SLOW!', x + 46, y + 7, { color: flash ? '#ff4040' : '#ffffff' });
    drawText(ctx, '>> DOWNLOAD MORE RAM <<', x + 46, y + 21, { color: '#40ff40', outline: '#002000' });
    act = () => navigate(P.w, g, 'weird', { highlight: 'moreram' });
  } else if (kind === 'isp') {
    A.drawGrad(ctx, x + 1, y + 1, w - 2, h - 2, ['#5a2a00', '#ff8a1e']);
    A.drawSnail(ctx, x + 8, y + 12, t);
    drawText(ctx, 'TIRED OF WAITING?', x + 50, y + 7, { color: '#ffffff', outline: '#5a2a00' });
    drawText(ctx, 'SlowNet DSL: 27x FASTER*', x + 50, y + 21, { color: '#ffff40' });
    drawText(ctx, '*THAN A SNAIL', x + w - 6, y + 32, { font: 'small', color: '#ffd8a0', align: 'right' });
    act = () => navigate(P.w, g, 'isp');
  } else if (kind === 'boat') {
    A.drawGrad(ctx, x + 1, y + 1, w - 2, h - 2, ['#bfe8ff', '#2a86e8', '#0a3a8a']);
    ctx.drawImage(getAppIcon('boat'), x + 8, y + 4 + Math.round(Math.sin(t * 2)));
    drawText(ctx, "BARNABY'S BOATYARD", x + 48, y + 7, { color: '#ffffff', outline: '#0a2a6a' });
    drawText(ctx, 'Bigger boat = bigger fish. Ask a walrus!', x + 48, y + 21, { color: '#ffff80' });
    act = () => openBoatyard(g);
  } else {
    A.drawGrad(ctx, x + 1, y + 1, w - 2, h - 2, ['#ffffff', '#c8f0ff']);
    const cx = x + 20 + Math.abs(((t * 70) % ((w - 60) * 2)) - (w - 60));
    A.drawCrab(ctx, cx, y + 18, t);
    drawText(ctx, 'POKE THE CRAB & WIN A PRIZE!!!', x + w / 2, y + 5, { align: 'center', color: '#c00000' });
    act = () => g.toast?.('The crab is offended. No prize. (Click click.)', 'anger');
  }
  hit(P, r, act, `http://ads.appsea.sea/click.cgi?ad=${kind}`);
  drawText(ctx, 'ADVERTISEMENT', x + w - 3, y + h - 7, { font: 'small', color: 'rgba(0,0,0,0.45)', align: 'right' });
  return y + h + 6;
}

function welcome(P, x, y, w) {
  const { ctx, t } = P;
  box(ctx, x, y, w, 52, 'WELCOME!!!', { head: ['#8000a0', '#ff40c0'], border: '#8000a0', body: '#fffff0' });
  drawText(ctx, 'Welcome to AppSea!!!', x + 6, y + 15, { color: '#c000a0', wave: 1, time: t });
  const txt = 'Every program here is 100% real and 100% bait. Download apps, drag them into your Bait Box and fish bite! Bigger files = hungrier fish.';
  wrapText(txt, w - 60).forEach((l, i) => drawText(ctx, l, x + 6, y + 26 + i * 9, { font: 'small', color: TEXT }));
  A.drawCrab(ctx, x + w - 40, y + 30, t);
  A.drawConstruction(ctx, x + w - 54, y + 15, 50, t);
  return y + 58;
}

function footer(P, x, y, W) {
  const { ctx, t, g } = P;
  ctx.fillStyle = '#8a9ac0';
  ctx.fillRect(x + 10, y, W - 20, 1);
  y += 5;
  const cx = x + W / 2;
  const prev = '<< PREV', ring = 'OCEAN WEBRING', nxt = 'NEXT >>';
  const total = measureText(prev, 'small') + measureText(ring, 'small') + measureText(nxt, 'small') + 24;
  let fx = Math.round(cx - total / 2);
  fx += link(P, prev, fx, y, () => g.toast?.('The previous site in the webring is a crab.', 'info'), { font: 'small', url: 'http://webring.sea/prev' }) + 12;
  drawText(ctx, ring, fx, y, { font: 'small', color: '#8000a0' });
  fx += measureText(ring, 'small') + 12;
  link(P, nxt, fx, y, () => g.toast?.('The next site in the webring is also a crab.', 'info'), { font: 'small', url: 'http://webring.sea/next' });
  y += 10;
  drawText(ctx, '(C) 2003 APPSEA INC. ALL RIGHTS RESERVED. NO FISH WERE HARMED.', cx, y, { font: 'small', color: GREY, align: 'center' });
  y += 8;
  drawText(ctx, 'BEST VIEWED IN FISHNET EXPLORER 5.0 AT 800X600', cx, y, { font: 'small', color: '#9aa0b0', align: 'center' });
  y += 8;
  drawText(ctx, `PAGE GENERATED IN ${(0.2 + (Math.sin(t) + 1) * 3).toFixed(2)} SECONDS`, cx, y, { font: 'small', color: '#b4b8c8', align: 'center' });
  return y + 12;
}

// ------------------------------------------------------------------ pages
function pageApps(P, page) {
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
  // the tutorial app first for brand new players
  if (!S.st.installed.length && !S.st.downloads.length && out.includes('notes')) return ['notes', ...out.filter((i) => i !== 'notes')].slice(0, 3);
  return out.slice(0, 3);
}

function mainHome(P, x, y, w) {
  const { ctx, t, S } = P;
  y = bannerAd(P, x, y, w);
  y = welcome(P, x, y, w);
  y = sectionBar(ctx, x, y, w, 'STAFF PICKS - QUICK ON YOUR CONNECTION', t);
  const picks = staffPicks(P);
  if (!picks.length) { drawText(ctx, 'You have EVERYTHING. Even the RAM.', x + 6, y + 2, { color: TEXT }); y += 14; }
  for (const id of picks) y = card(P, x, y, w, id);
  y = sectionBar(ctx, x, y + 2, w, 'NEW & HOT THIS WEEK', t, ['#0040c0', '#00a0ff', '#80ffff']);
  for (const id of ['videos', 'moreram'].filter((i) => !picks.includes(i))) y = card(P, x, y, w, id);
  void S;
  return y;
}

function mainList(P, x, y, w, page) {
  const { ctx, t, g } = P;
  const cat = CATEGORIES.find((c) => c.id === page);
  const title = cat ? cat.name : page === 'top' ? 'Top 10 Downloads' : 'New Releases';
  drawText(ctx, 'YOU ARE HERE:', x, y + 1, { font: 'small', color: GREY });
  const hx = x + 52 + link(P, 'HOME', x + 52, y + 1, () => navigate(P.w, g, 'home'), { font: 'small', url: pageUrl('home') });
  drawText(ctx, ` > ${title.toUpperCase()}`, hx, y + 1, { font: 'small', color: TEXT });
  y += 10;
  const ids = pageApps(P, page);
  y = sectionBar(ctx, x, y, w, `${title} (${ids.length} programs)`, t, cat ? ['#004080', '#0080c0', '#40c0e0'] : ['#c00000', '#ff6a00', '#ffcc00']);
  if (cat) { drawText(ctx, cat.blurb, x + 2, y, { color: '#5a3a8a' }); y += 12; }
  ids.forEach((id, i) => {
    if (page === 'top') drawText(ctx, '#' + (i + 1), x - 1, y + 2, { font: 'small', color: '#c00000' });
    y = card(P, x, y, w, id);
  });
  return y;
}

function mainDownloads(P, x, y, w) {
  const { ctx, t, S, g } = P;
  y = sectionBar(ctx, x, y, w, 'MY DOWNLOADS', t, ['#006000', '#30b030', '#a0ff80']);
  const list = S.st.downloads;
  if (!list.length) { drawText(ctx, 'Nothing downloading. Go get some bait!', x + 4, y + 2, { color: GREY }); y += 16; }
  for (const d of list) {
    const L = listing(d.app, d.tier);
    box(ctx, x, y, w, 26, null, { border: '#8a9ac0' });
    ctx.drawImage(getMiniIcon(L.icon), x + 4, y + 6);
    drawText(ctx, L.title, x + 22, y + 4, { color: TEXT });
    const active = S.active() === d;
    const frac = d.done / d.kb;
    A.drawPill(ctx, x + 22, y + 15, 130, 7, frac, d.state === 'confirm' ? '#ffb43a' : active ? '#3a8af8' : '#c8a83a');
    const msg = d.state === 'confirm' ? 'WAITING FOR YOUR OK' : active ? `${Math.floor(frac * 100)}% - ${formatShortTime(S.eta(d)).toUpperCase()} LEFT` : `QUEUED - STARTS IN ${formatShortTime(S.eta(d) - (d.kb - d.done) / S.speed()).toUpperCase()}`;
    drawText(ctx, msg, x + 158, y + 16, { font: 'small', color: GREY });
    link(P, 'cancel', x + w - 34, y + 4, () => S.cancel(d.uid), { font: 'small', url: 'javascript:cancel()' });
    y += 29;
  }
  y = sectionBar(ctx, x, y + 4, w, `INSTALLED PROGRAMS (${S.st.installed.length})`, t, ['#004080', '#0080c0', '#40c0e0']);
  if (!S.st.installed.length) { drawText(ctx, 'No programs yet. Notes Lite is tiny - try it!', x + 4, y + 2, { color: GREY }); y += 16; }
  for (const id of S.st.installed) {
    const fam = CATALOG_BY_ID[id];
    if (!fam) continue;
    const tier = S.tierOf(id);
    const L = listing(id, tier);
    ctx.drawImage(getMiniIcon(L.icon, { tier }), x + 2, y);
    drawText(ctx, `${fam.name} ${TIERS[tier].name}`, x + 20, y + 3, { color: TEXT });
    drawText(ctx, `POWER x${L.power.toFixed(2)}`, x + 150, y + 4, { font: 'small', color: '#8a3ad0' });
    drawText(ctx, formatSize(L.kb).toUpperCase(), x + 210, y + 4, { font: 'small', color: GREY });
    if (S.nextTier(id) >= 0 && !S.downloadOf(id)) link(P, 'upgrade', x + w - 36, y + 3, () => navigate(P.w, g, fam.cat, { highlight: id }), { font: 'small', url: pageUrl(fam.cat) });
    y += 15;
  }
  const s = S.st.stats;
  drawText(ctx, `TOTAL DOWNLOADED: ${formatSize(s.downloaded).toUpperCase()} IN ${s.completed} FILES`, x + 4, y + 6, { font: 'small', color: GREY });
  return y + 18;
}

function ispPage(P, x, y, W) {
  const { ctx, t, S, g } = P;
  A.drawGrad(ctx, x, y, W, 44, ['#2a0e00', '#8a3a00', '#ff8a1e', '#ffd23a']);
  A.drawSnail(ctx, x + 8, y + 14, t);
  const logo = A.wordArt('SlowNet', { scale: 2, top: '#ffffff', bottom: '#ffd23a', outline: '#3a1400' });
  ctx.drawImage(logo, x + 34, y + 4);
  drawText(ctx, 'MAKING THE INTERNET WAIT SINCE 1996', x + 38, y + 25, { font: 'small', color: '#fff0c0', shadow: '#3a1400' });
  drawText(ctx, 'PARTNER OF APPSEA', x + W - 6, y + 6, { font: 'small', color: '#ffe8a0', align: 'right' });
  link(P, '<< back to AppSea', x + W - 80, y + 32, () => navigate(P.w, g, 'home'), { font: 'small', color: '#ffffff', hot: '#ffff00', url: pageUrl('home') });
  y += 48;
  // current plan + gauge
  const cur = ispTier(g.state), plan = ISP_TIERS[cur];
  box(ctx, x + 4, y, W - 8, 44, 'YOUR CONNECTION', { head: ['#3a1400', '#c86a1e'], border: '#3a1400', body: '#fff8ec' });
  ctx.drawImage(getAppIcon('isp'), x + 10, y + 11);
  drawText(ctx, plan.name, x + 48, y + 15, { color: '#3a1400', scale: 1 });
  drawText(ctx, `${formatSpeed(S.speed()).toUpperCase()}${S.speed() !== plan.speed ? ' (BOAT SATELLITE BOOST!)' : ''}`, x + 48, y + 26, { font: 'small', color: '#2a8a2a' });
  drawText(ctx, plan.desc, x + 48, y + 34, { font: 'small', color: GREY });
  const gf = Math.log10(S.speed() / 7) / Math.log10(1048576 * 2 / 7);
  A.drawGauge(ctx, x + W - 34, y + 38, 22, gf, t);
  drawText(ctx, 'SPEED', x + W - 34, y + 30, { font: 'small', color: '#3a1400', align: 'center' });
  y += 50;
  // plans table
  const cols = [x + 4, x + 104, x + 160, x + 260, x + W - 74];
  A.drawGrad(ctx, x + 4, y, W - 8, 11, ['#3a1400', '#8a3a00'], 'h');
  ['PLAN', 'SPEED', 'NOTES STD / SEA MINES ULTRA', 'PRICE'].forEach((h, i) => drawText(ctx, h, (i === 3 ? cols[4] : cols[i]) + 4, y + 3, { font: 'small', color: '#ffffff' }));
  y += 12;
  const small = listing('notes', 1).kb, big = listing('games', 3).kb;
  ISP_TIERS.forEach((p, i) => {
    const rh = 26;
    ctx.fillStyle = i === cur ? '#fff0b0' : i % 2 ? '#fff8ec' : '#ffffff';
    ctx.fillRect(x + 4, y, W - 8, rh);
    ctx.fillStyle = p.color;
    ctx.fillRect(x + 4, y, 3, rh);
    ctx.fillStyle = '#e0c8a8';
    ctx.fillRect(x + 4, y + rh - 1, W - 8, 1);
    drawText(ctx, p.name, cols[0] + 6, y + 4, { color: '#3a1400' });
    wrapText(p.desc, 150, 'small').slice(0, 2).forEach((l, k) => drawText(ctx, l, cols[0] + 6, y + 13 + k * 6, { font: 'small', color: GREY }));
    drawText(ctx, formatSpeed(p.speed).toUpperCase(), cols[1] + 50, y + 5, { font: 'small', color: '#2a6a2a' });
    const sp = p.speed * (S.speed() / plan.speed);
    drawText(ctx, `${formatShortTime(small / sp).toUpperCase()} / ${formatShortTime(big / sp).toUpperCase()}`, cols[2] + 54, y + 5, { font: 'small', color: big / sp > 3600 ? '#c00000' : TEXT });
    const bx = cols[4], by = y + 4;
    if (i === cur) A.glossButton(ctx, bx, by, 68, 18, 'CURRENT\nPLAN', { color: 'grey', disabled: true });
    else if (i < cur) drawText(ctx, 'DOWNGRADE?', bx + 34, by + 3, { font: 'small', color: '#9aa0b0', align: 'center' }), drawText(ctx, 'NO.', bx + 34, by + 11, { font: 'small', color: '#9aa0b0', align: 'center' });
    else {
      const broke = p.price > (g.state.coins || 0);
      const hov = hit(P, { x: bx, y: by, w: 68, h: 18 }, () => S.buyIsp(i), `https://${'slownet.sea'}/order.asp?plan=${p.id}`);
      A.glossButton(ctx, bx, by, 68, 18, `UPGRADE!\n{coin} ${p.price}`, { color: broke ? 'red' : 'orange', hover: hov, down: hov && g.input?.down, t });
    }
    y += rh;
  });
  y += 4;
  ['*SPEEDS NOT GUARANTEED. SPEEDS NOT EVEN LIKELY.', '*SLOWNET IS NOT RESPONSIBLE FOR SCREAMING MODEMS, LOST FISH OR CRABS ON THE LINE.', '*A BIGGER BOAT WITH A SATELLITE DISH MAKES ANY PLAN FASTER.'].forEach((l) => {
    drawText(ctx, l, x + 6, y, { font: 'small', color: '#9a8070' });
    y += 8;
  });
  return y + 6;
}

function renderPage(P) {
  const { view, d, w } = P;
  const x = view.x, W = view.w;
  let y = view.y - w.scroll;
  if (d.page === 'isp') return footer(P, x, ispPage(P, x, y, W) + 4, W);
  y = header(P, x, y, W);
  y = marquee(P, x, y, W);
  y = navbar(P, x, y, W);
  y += 5;
  const sy = sidebar(P, x + 4, y);
  const mx = x + 96, mw = W - 100;
  let my;
  if (d.page === 'home') my = mainHome(P, mx, y, mw);
  else if (d.page === 'downloads') my = mainDownloads(P, mx, y, mw);
  else my = mainList(P, mx, y, mw, d.page);
  y = Math.max(sy, my) + 6;
  return footer(P, x, y, W);
}

// ------------------------------------------------------------------ browser chrome
function toolbar(P, r) {
  const { ctx, w, g, d } = P;
  ctx.fillStyle = A.WIN.face;
  ctx.fillRect(r.x, r.y, r.w, TB);
  ctx.fillStyle = A.WIN.shadow;
  ctx.fillRect(r.x, r.y + TB - 1, r.w, 1);
  const btn = (bx, label, enabled, fn) => {
    const br = { x: bx, y: r.y + 2, w: 18, h: 11 };
    const hov = enabled && P.hot2 && rectContains(br, P.mx, P.my);
    if (enabled) P.chrome.push({ ...br, fn });
    A.winButton(ctx, br.x, br.y, br.w, br.h, label, { hover: hov, disabled: !enabled, down: hov && g.input?.down, font: 'small' });
    return bx + 20;
  };
  let bx = r.x + 2;
  bx = btn(bx, '<', d.back.length > 0, () => { const p = d.back.pop(); if (p) { d.fwd.push({ page: d.page, scroll: w.scroll }); d.page = p.page; w.scroll = p.scroll; d.loadT0 = d.lastT; } });
  bx = btn(bx, '>', d.fwd.length > 0, () => { const p = d.fwd.pop(); if (p) { d.back.push({ page: d.page, scroll: w.scroll }); d.page = p.page; w.scroll = p.scroll; d.loadT0 = d.lastT; } });
  bx = btn(bx, 'H', true, () => navigate(w, g, 'home'));
  drawText(ctx, 'Address', bx + 2, r.y + 4, { color: '#000000' });
  const ax = bx + 36, aw = r.x + r.w - ax - 26;
  A.bevel(ctx, ax, r.y + 2, aw, 11, { face: '#ffffff', inset: true, thin: true });
  ctx.drawImage(getMiniIcon('browser'), ax + 1, r.y + 1, 11, 11);
  let url = pageUrl(d.page);
  while (measureText(url) > aw - 18 && url.length > 8) url = url.slice(0, -2);
  drawText(ctx, url, ax + 14, r.y + 4, { color: '#000000' });
  btn(r.x + r.w - 22, 'Go', true, () => { d.loadT0 = d.lastT; });
}

function statusBar(P, r, loading) {
  const { ctx, S, t } = P;
  const y = r.y + r.h - SBAR;
  ctx.fillStyle = A.WIN.face;
  ctx.fillRect(r.x, y, r.w, SBAR);
  A.bevel(ctx, r.x + 1, y + 1, r.w - 92, SBAR - 2, { face: null, inset: true, thin: true });
  A.bevel(ctx, r.x + r.w - 90, y + 1, 89, SBAR - 2, { face: null, inset: true, thin: true });
  let msg = 'Done';
  if (S.connecting) msg = 'Dialing SlowNet...';
  else if (loading) msg = `(${Math.max(1, Math.round((1 - loading) * 9))} items remaining) Downloading picture http://${HOST}/img/fish${Math.floor(t * 7) % 9}.gif...`;
  else if (P.url) msg = P.url;
  let m = msg;
  while (measureText(m, 'normal') > r.w - 100 && m.length > 4) m = m.slice(0, -4) + '...';
  drawText(ctx, m, r.x + 4, y + 2, { color: '#000000' });
  ctx.drawImage(getMiniIcon('browser'), r.x + r.w - 88, y, 11, 11);
  drawText(ctx, `Internet (${S.isp().short})`, r.x + r.w - 75, y + 2, { color: '#000000' });
}

function scrollbar(P, r, view, maxS) {
  const { ctx, w, g } = P;
  const x = r.x + r.w - SW, y0 = view.y, h = view.h;
  ctx.fillStyle = '#e8e6e0';
  ctx.fillRect(x, y0, SW, h);
  for (let yy = y0; yy < y0 + h; yy++) for (let xx = x + ((yy & 1) ? 1 : 0); xx < x + SW; xx += 2) { ctx.fillStyle = '#ffffff'; ctx.fillRect(xx, yy, 1, 1); }
  const up = { x, y: y0, w: SW, h: SW }, dn = { x, y: y0 + h - SW, w: SW, h: SW };
  A.winButton(ctx, up.x, up.y, up.w, up.h, '^', { font: 'small' });
  A.winButton(ctx, dn.x, dn.y, dn.w, dn.h, 'v', { font: 'small' });
  P.chrome.push({ ...up, fn: () => { w.scroll = clamp(w.scroll - 24, 0, maxS); } });
  P.chrome.push({ ...dn, fn: () => { w.scroll = clamp(w.scroll + 24, 0, maxS); } });
  const tr = { x, y: y0 + SW, w: SW, h: h - SW * 2 };
  if (maxS <= 0) return;
  const th = Math.max(14, Math.round(tr.h * (h / (h + maxS))));
  const ty = tr.y + Math.round((tr.h - th) * (w.scroll / maxS));
  A.bevel(ctx, x, ty, SW, th);
  for (let i = -2; i <= 2; i += 2) { ctx.fillStyle = A.WIN.shadow; ctx.fillRect(x + 2, ty + Math.floor(th / 2) + i, SW - 4, 1); }
  const thumb = { x, y: ty, w: SW, h: th };
  P.chrome.push({ ...tr, fn: (inp) => { w.scroll = clamp(w.scroll + (inp.y < ty ? -h : h) * 0.9, 0, maxS); } });
  P.chrome.push({ ...thumb, fn: (inp) => {
    const oy = inp.y - ty;
    if (g.desktop) g.desktop.drag = { kind: 'custom', move: (i2) => { w.scroll = clamp(((i2.y - oy - tr.y) / Math.max(1, tr.h - th)) * maxS, 0, maxS); }, end() {} };
  } });
}

function connectDialog(P, view) {
  const { ctx, S, g } = P;
  const c = S.connecting;
  const k = c ? clamp01((nowS() - c.t0) / c.dur) : 1;
  const w = 210, h = 86;
  const x = Math.round(view.x + (view.w - w) / 2), y = Math.round(view.y + (view.h - h) / 2 - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 3, y + 3, w, h);
  A.bevel(ctx, x, y, w, h);
  A.drawGrad(ctx, x + 3, y + 3, w - 6, 11, ['#0a246a', '#a6caf0'], 'h');
  drawText(ctx, 'Dial-up Connection', x + 6, y + 5, { color: '#ffffff' });
  ctx.drawImage(getAppIcon('isp'), x + 8, y + 20);
  const steps = ['Dialing 555-0199...', 'Verifying user name and password...', 'Registering your computer on the network...', 'Connected at 56,000 bps!'];
  const si = k < 0.3 ? 0 : k < 0.62 ? 1 : k < 0.92 ? 2 : 3;
  drawText(ctx, 'Connecting to SlowNet...', x + 46, y + 20, { color: '#000000' });
  wrapText(steps[si], w - 54).forEach((l, i) => drawText(ctx, l, x + 46, y + 32 + i * 10, { color: '#404040' }));
  A.drawBlocks(ctx, x + 46, y + 54, w - 56, 10, k, { t: P.t, color: '#3a8a3a', light: '#8aff8a' });
  const br = { x: x + w - 60, y: y + h - 18, w: 52, h: 13 };
  const hov = P.hot && rectContains(br, P.mx, P.my);
  A.winButton(ctx, br.x, br.y, br.w, br.h, 'Cancel', { hover: hov });
  P.chrome.push({ ...br, fn: () => { S.connecting = null; S.connected = true; g.toast?.('You cancelled the dial-up. It connected anyway.', 'info'); } });
}

// ------------------------------------------------------------------ the store window renderer
export const appsea = {
  title: 'AppSea - FishNet Explorer',
  size: [420, 300],
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
      if (rectContains(h, inp.x, inp.y)) { h.fn?.(inp); inp.consume?.(); return; }
    }
  },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    if (!d.back) this.init(w, g);
    const S = store(g);
    S.updateConnect(nowS());
    if (d.lastT === 0 && !d.loadT0) d.loadT0 = t;
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
    A.tileFill(ctx, view.x, view.y, view.w, view.h, w.scroll);
    const dur = LOAD_TIME[ispTier(g.state)];
    const loadK = !S.connected ? 0 : dur > 0 ? clamp01((t - d.loadT0) / dur) : 1;
    const loading = loadK < 1 ? loadK : 0;
    if (S.connected) {
      d.loadingIcons = loadK < 0.85;
      const end = renderPage(P);
      d.pageH = end - (view.y - w.scroll);
      if (loadK < 1) {
        const ry = view.y + Math.round(view.h * loadK * 1.15);
        P.hits = P.hits.filter((h) => h.y + h.h <= ry);
        A.tileFill(ctx, view.x, ry, view.w, view.y + view.h - ry, w.scroll);
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

// ------------------------------------------------------------------ download dialog (IE6 style)
function dlButtons(P, x, y, specs) {
  const { ctx, g } = P;
  let bx = x;
  for (const s of specs) {
    const r = { x: bx - s.w, y, w: s.w, h: 14 };
    const hov = !s.disabled && rectContains(r, P.mx, P.my) && P.hot;
    A.winButton(ctx, r.x, r.y, r.w, r.h, s.label, { hover: hov, disabled: s.disabled, down: hov && g.input?.down, bold: s.bold });
    if (!s.disabled) P.chrome.push({ ...r, fn: s.fn });
    bx -= s.w + 4;
  }
}

function labelRow(ctx, x, y, label, value, vx = 84, color = '#000000') {
  drawText(ctx, label, x, y, { color: '#404040' });
  drawText(ctx, value, x + vx, y, { color });
}

function flyAnim(ctx, x, y, w, icon, t, done) {
  ctx.drawImage(getAppIcon('browser'), x, y);
  ctx.drawImage(getAppIcon('documents'), x + w - 32, y);
  if (done) return;
  for (let k = 0; k < 2; k++) {
    const p = (t * 0.7 + k * 0.5) % 1;
    const fx = x + 26 + p * (w - 58), fy = y + 10 - Math.sin(p * Math.PI) * 12;
    ctx.globalAlpha = Math.min(1, Math.sin(p * Math.PI) * 3);
    ctx.drawImage(getMiniIcon(icon), Math.round(fx), Math.round(fy));
    ctx.globalAlpha = 1;
  }
}

export const appseaDl = {
  title: 'Downloads',
  size: [276, 164],
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
    ctx.fillStyle = A.WIN.face;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const pend = S.pending(), act = S.active(), last = S.recent[0];
    const x = r.x + 8, right = r.x + r.w - 6, by = r.y + r.h - 18;
    if (pend) {
      const L = listing(pend.app, pend.tier);
      w.title = 'File Download - Security Warning';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(r.x, r.y, r.w, 24);
      ctx.fillStyle = A.WIN.shadow;
      ctx.fillRect(r.x, r.y + 24, r.w, 1);
      drawText(ctx, 'Do you want to download this file?', x, r.y + 5, { color: '#000000' });
      drawText(ctx, 'APPSEA DOWNLOAD MANAGER', x, r.y + 15, { font: 'small', color: GREY });
      ctx.drawImage(getAppIcon(L.icon, { tier: pend.tier }), x, r.y + 32);
      labelRow(ctx, x + 40, r.y + 32, 'Name:', L.file, 36);
      labelRow(ctx, x + 40, r.y + 43, 'Type:', `Application, ${formatSize(L.kb)}`, 36);
      labelRow(ctx, x + 40, r.y + 54, 'From:', HOST, 36);
      const wy = r.y + 72;
      ctx.fillStyle = '#fff8c8';
      ctx.fillRect(r.x + 4, wy, r.w - 8, 34);
      ctx.fillStyle = '#c8a840';
      ctx.fillRect(r.x + 4, wy, r.w - 8, 1);
      ctx.fillRect(r.x + 4, wy + 33, r.w - 8, 1);
      // warning shield with a fish on it
      ctx.fillStyle = '#e8a020'; ctx.fillRect(x, wy + 6, 14, 14); ctx.fillRect(x + 2, wy + 20, 10, 3); ctx.fillRect(x + 5, wy + 23, 4, 2);
      ctx.fillStyle = '#ffd860'; ctx.fillRect(x + 1, wy + 7, 6, 12);
      drawText(ctx, '!', x + 6, wy + 9, { color: '#5a2a00' });
      const msg = WARNINGS[Math.max(0, pend.warn)];
      wrapText(msg, r.w - 40).forEach((l, i) => drawText(ctx, l, x + 22, wy + 6 + i * 10, { color: '#8a2a00' }));
      if (pend.paid) drawText(ctx, `YOU PAID ${pend.paid} COINS. "NO" REFUNDS THEM.`, x + 22, wy + 25, { font: 'small', color: GREY });
      dlButtons(P, right, by, [
        { label: 'No', w: 50, fn: () => S.confirm(pend.uid, false) },
        { label: 'Yes, fish me', w: 70, bold: true, fn: () => S.confirm(pend.uid, true) },
      ]);
    } else if (act) {
      const L = listing(act.app, act.tier);
      const frac = act.done / act.kb;
      const pct = Math.floor(frac * 100);
      w.title = `${pct}% of ${L.file} Completed`;
      flyAnim(ctx, x, r.y + 3, r.w - 16, L.icon, t, false);
      const more = S.queued().length - 1;
      drawText(ctx, 'Saving:', x, r.y + 39, { color: '#000000' });
      if (more > 0) drawText(ctx, `(+${more} MORE IN QUEUE)`, right, r.y + 40, { font: 'small', color: '#8a6a20', align: 'right' });
      let line = `${L.file} from ${HOST}`;
      while (measureText(line) > r.w - 16 && line.length > 6) line = line.slice(0, -4) + '...';
      drawText(ctx, line, x, r.y + 49, { color: '#000000' });
      A.drawBlocks(ctx, x, r.y + 61, r.w - 16, 11, frac, { t });
      const eta = S.eta(act);
      labelRow(ctx, x, r.y + 77, 'Estimated time left:', `${formatTime(eta)} (${formatSize(act.done)} of ${formatSize(act.kb)})`, 92);
      labelRow(ctx, x, r.y + 88, 'Download to:', `C:\\Desktop\\${L.file}`.slice(0, 34), 92);
      labelRow(ctx, x, r.y + 99, 'Transfer rate:', formatSpeed(S.shownSpeed()).replace('/s', '/Sec'), 92);
      // checkbox
      const cb = { x, y: r.y + 111, w: 10, h: 10 };
      A.bevel(ctx, cb.x, cb.y, 9, 9, { face: '#ffffff', inset: true, thin: true });
      if (d.closeWhenDone) drawText(ctx, 'v', cb.x + 2, cb.y + 1, { color: '#000000', font: 'small' });
      P.chrome.push({ x: cb.x, y: cb.y, w: 200, h: 10, fn: () => { d.closeWhenDone = !d.closeWhenDone; g.audio?.play('ui_toggle'); } });
      drawText(ctx, 'Close this dialog box when download completes', x + 13, r.y + 112, { color: '#000000' });
      dlButtons(P, right, by, [
        { label: 'Cancel', w: 50, fn: () => S.cancel(act.uid) },
        { label: 'Open Folder', w: 62, disabled: true },
        { label: 'Open', w: 40, disabled: true },
      ]);
      d.sawActive = true;
    } else if (last) {
      const L = listing(last.app, last.tier);
      w.title = 'Download complete';
      if (d.closeWhenDone && d.sawActive) { d.sawActive = false; setTimeout(() => g.desktop?.closeWindow?.(w), 900); }
      ctx.drawImage(getAppIcon(L.icon, { tier: last.tier }), x, r.y + 3);
      drawText(ctx, 'Download Complete', x + 40, r.y + 7, { color: '#000000', scale: 1 });
      drawText(ctx, `${L.title} is on your desktop!`, x + 40, r.y + 19, { color: '#2a6a2a' });
      drawText(ctx, 'Saved:', x, r.y + 39, { color: '#000000' });
      drawText(ctx, `${L.file} from ${HOST}`.slice(0, 44), x, r.y + 49, { color: '#000000' });
      A.drawBlocks(ctx, x, r.y + 61, r.w - 16, 11, 1, { t });
      labelRow(ctx, x, r.y + 77, 'Downloaded:', `${formatSize(last.kb)} in ${formatTime(last.secs)}`, 92);
      labelRow(ctx, x, r.y + 88, 'Download to:', `C:\\Desktop\\${L.file}`.slice(0, 34), 92);
      labelRow(ctx, x, r.y + 99, 'Bait power:', `x${L.power.toFixed(2)}  - drag it into the Bait Box!`, 92, '#8a3ad0');
      dlButtons(P, right, by, [
        { label: 'Close', w: 50, fn: () => g.desktop?.closeWindow?.(w) },
        { label: 'Open Folder', w: 62, fn: () => g.toast?.('Your desktop IS the folder. Look behind this window!', 'info') },
        { label: 'Open', w: 40, bold: true, fn: () => g.desktop?.openApp?.(appKey(last.app)) },
      ]);
    } else {
      w.title = 'Downloads';
      flyAnim(ctx, x, r.y + 3, r.w - 16, 'fishtop', t, true);
      drawText(ctx, 'No downloads in progress.', x, r.y + 44, { color: '#000000' });
      drawText(ctx, 'Visit AppSea to find bait for your hook!', x, r.y + 56, { color: '#404040' });
      dlButtons(P, right, by, [
        { label: 'Close', w: 50, fn: () => g.desktop?.closeWindow?.(w) },
        { label: 'Visit AppSea', w: 70, bold: true, fn: () => g.desktop?.openApp?.('appsea') },
      ]);
    }
    d.hits = P.chrome;
  },
};

// ------------------------------------------------------------------ two new Weird apps
const moreram = {
  title: 'Download More RAM',
  size: [230, 120],
  init(w) { w.data = { ram: 512, hits: [] }; },
  input(w, g, inp) { appsea.input(w, g, inp); },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    if (!d.hits) this.init(w);
    const P = makeP(ctx, w, g, t, r);
    P.chrome = [];
    A.drawGrad(ctx, r.x, r.y, r.w, r.h, ['#002000', '#006000']);
    ctx.drawImage(getAppIcon('ram'), r.x + 8, r.y + 8 + Math.round(Math.sin(t * 3)));
    drawText(ctx, 'RAM DOUBLER 3000', r.x + 48, r.y + 8, { color: '#40ff40' });
    drawText(ctx, `INSTALLED RAM: ${formatCommas(d.ram)} MB`, r.x + 48, r.y + 20, { font: 'small', color: '#c8ffc8' });
    A.drawBlocks(ctx, r.x + 48, r.y + 30, r.w - 58, 10, (t * 0.1) % 1, { color: '#20c020', light: '#a0ffa0', back: '#002000' });
    drawText(ctx, `YOUR PC IS ${(87 - Math.min(86.9, (d.ram - 512) * 0.0001)).toFixed(4)}% SLOW`, r.x + 48, r.y + 46, { font: 'small', color: '#ff8080' });
    const br = { x: r.x + 48, y: r.y + 60, w: 110, h: 22 };
    const hov = rectContains(br, P.mx, P.my) && P.hot;
    A.glossButton(ctx, br.x, br.y, br.w, br.h, 'DOWNLOAD MORE!', { color: 'green', hover: hov, t, down: hov && g.input?.down });
    P.chrome.push({ ...br, fn: () => { d.ram += 1; g.audio?.play('ui_click'); if (d.ram % 5 === 0) g.toast?.('Your PC is now 0.0001% faster. Fish are impressed.', 'sparkle'); } });
    d.hits = P.chrome;
  },
};

const VIRUS_LINES = ["Hi! I'm totally not a virus!", "I definitely didn't rename anything.", 'Want a fish? Go catch one!', 'Scanning... 0 viruses. 1 crab.', 'I am just a normal program. Beep boop.'];
const notavirus = {
  title: 'NotAVirus.exe',
  size: [230, 120],
  init(w) { w.data = { hits: [], i: 0 }; },
  input(w, g, inp) { appsea.input(w, g, inp); },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    if (!d.hits) this.init(w);
    const P = makeP(ctx, w, g, t, r);
    P.chrome = [];
    ctx.fillStyle = '#1a0a2a';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < 20; i++) { ctx.fillStyle = '#2a1a4a'; ctx.fillRect(r.x + Math.round(hash1(i, 9) * r.w), r.y + Math.round(((t * 20 + i * 13) % r.h)), 1, 3); }
    const icon = getAppIcon('virus', { size: 64 });
    ctx.drawImage(icon, r.x + 8, r.y + 20 + Math.round(Math.sin(t * 4) * 3));
    const line = VIRUS_LINES[Math.floor(t / 3) % VIRUS_LINES.length];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.x + 78, r.y + 16, r.w - 86, 34);
    ctx.fillRect(r.x + 74, r.y + 34, 4, 4);
    wrapText(line, r.w - 94).forEach((l, i) => drawText(ctx, l, r.x + 82, r.y + 20 + i * 10, { color: '#1a1226' }));
    const br = { x: r.x + 78, y: r.y + 62, w: 110, h: 18 };
    const hov = rectContains(br, P.mx, P.my) && P.hot;
    A.glossButton(ctx, br.x, br.y, br.w, br.h, 'SCAN FOR VIRUSES', { color: 'purple', hover: hov, t, down: hov && g.input?.down });
    P.chrome.push({ ...br, fn: () => { g.audio?.play('glitch'); g.toast?.('Scan complete: 0 viruses found. 1 crab found. The crab says hi.', 'skull'); } });
    d.hits = P.chrome;
  },
};

export const STORE_RENDERERS = { appsea, appsea_dl: appseaDl, moreram, notavirus };
