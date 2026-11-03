// Multiplayer panel (id 'multiplayer', phase 3 Aero; OWNER: Online & AppSea agent).
// Go-online toggle, display name (a real text field over the canvas), who is here, emotes, recent catches and
// a plain privacy line. Everything shown about other players comes from src/net (already validated) and is
// drawn as canvas text only (never HTML).

import { drawText, wrapText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { RARITY } from '../core/color.js';
import { drawAeroPanel, drawGlossOrb, drawSparkle } from './aero.js';
import { centerRect } from './ui.js';
import { pill, glassCard, button, orbButton, wordArt, toggle, tag, rrect, INK, INK_SOFT, GRASS } from '../store/aerokit.js';
import { installNet, EMOTES, NAME_MAX, randomName } from '../net/index.js';
import { OCEAN_NAMES } from '../game/lab.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import * as Character from '../gfx/character.js';
import { ecoBand, ecoCorners, ecoGlobe, ecoSky, splashButton } from '../store/ecoart.js';

const PRIVACY = 'Only your chosen name, look, boat, ocean and catches are shared, and only while you are online. No accounts, no chat, no files.';

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h';
}

export class MultiplayerPanel {
  constructor() {
    this.id = 'multiplayer';
    this.modal = true;
    this.sound = 'ui_open';
    this.t = 0;
    this.scroll = 0;
    this.edit = null;
  }

  get net() { return installNet(this.game); }

  open() { this.t = 0; }
  close() { this.endEdit(true); }

  draw(ctx, ui, dt) {
    const g = this.game, net = this.net;
    this.t += dt;
    const W = 456, H = 296;
    const r = centerRect(g, W, H);
    this.rect = r;
    drawAeroPanel(ctx, r.x, r.y, W, H, { tone: 'glass', radius: 12 });
    // eco header: sky band, green glass globe emblem, glossy title
    ecoBand(ctx, r.x + 3, r.y + 3, W - 6, 28, this.t, { sun: [0.55, 0.15] });
    ecoCorners(ctx, r.x, r.y, W, H, this.t, 0.72);
    ecoGlobe(ctx, r.x + 19, r.y + 17, 10, this.t);
    ctx.drawImage(wordArt('Multiplayer', { scale: 2, top: '#ffffff', bottom: '#8ee04a', edge: '#1d5a12' }), r.x + 34, r.y + 6);
    const n = net.list ? net.list().length : 0;
    const label = net.status === 'online' ? `ONLINE  ${n + 1} HERE` : net.status === 'connecting' ? 'CONNECTING' : 'OFFLINE';
    const sw = measureText(label, 'small') + 22;
    const sc = net.status === 'online' ? GRASS : net.status === 'connecting' ? '#ffb02e' : '#9aaab8';
    pill(ctx, r.x + W - 40 - sw, r.y + 10, sw, 14, { color: sc });
    drawGlossOrb(ctx, r.x + W - 40 - sw + 8, r.y + 17, 3, net.status === 'online' ? '#d8ffb0' : '#ffffff');
    drawText(ctx, label, r.x + W - 40 - sw + 14, r.y + 14, { font: 'small', color: '#ffffff' });
    if (orbButton(ui, ctx, r.x + W - 18, r.y + 17, 8, '#ff6a5a', { glyph: 'x', sound: 'ui_close' })) { ui.close(this.id); return; }
    this.drawLeft(ctx, ui, r.x + 10, r.y + 34, 156, H - 44);
    this.drawPlayers(ctx, ui, r.x + 174, r.y + 34, W - 184, 112);
    this.drawEmotes(ctx, ui, r.x + 174, r.y + 152, W - 184, 30);
    this.drawFeed(ctx, ui, r.x + 174, r.y + 188, W - 184, H - 198);
    if (!net.unlocked?.()) this.drawLocked(ctx, ui, r.x + 8, r.y + 32, W - 16, H - 40);
    if (this.edit) this.placeEdit();
  }

  // ---------------------------------------------------------------- left: switch, name, me, party, privacy
  drawLeft(ctx, ui, x, y, w, h) {
    const g = this.game, net = this.net, t = this.t;
    glassCard(ctx, x, y, w, h, { r: 8 });
    // go online
    drawText(ctx, 'Go online', x + 8, y + 9, { color: INK });
    const on = net.online;
    this.tk = (this.tk ?? (on ? 1 : 0)) + ((on ? 1 : 0) - (this.tk ?? 0)) * Math.min(1, 0.25);
    const tr = toggle(ctx, x + w - 44, y + 5, on, this.tk);
    if (ui.hover(tr)) ui.tip = on ? 'Go offline' : 'Show your boat to other players';
    if (ui.clicked(tr) && net.unlocked()) { g.audio?.play('ui_toggle'); net.toggle(); }
    drawText(ctx, on ? 'VIA ' + net.transportLabel().toUpperCase() : 'YOU ARE INVISIBLE', x + 8, y + 22, { font: 'small', color: on ? '#2a9a20' : INK_SOFT });
    // name
    drawText(ctx, 'NAME', x + 8, y + 36, { font: 'small', color: INK_SOFT });
    const fr = { x: x + 8, y: y + 43, w: w - 34, h: 16 };
    const editing = !!this.edit;
    rrect(ctx, fr.x, fr.y, fr.w, fr.h, 5);
    ctx.fillStyle = editing ? '#ffffff' : 'rgba(255,255,255,0.8)'; ctx.fill();
    ctx.strokeStyle = editing ? '#2fb8f0' : 'rgba(120,190,225,0.9)'; ctx.lineWidth = 1; ctx.stroke();
    const val = editing ? this.edit.el.value : net.name || '';
    const shown = val || (editing ? '' : 'Pick a name');
    drawText(ctx, shown, fr.x + 5, fr.y + 5, { color: val ? INK : '#9ab8c8' });
    if (editing && Math.floor(t * 2) % 2 === 0) {
      const sel = this.edit.el.selectionStart ?? val.length;
      const cx = fr.x + 5 + measureText(val.slice(0, sel));
      ctx.fillStyle = '#2fb8f0'; ctx.fillRect(cx, fr.y + 3, 1, 10);
    }
    if (!editing && ui.hover(fr)) ui.tip = `Your display name (max ${NAME_MAX})`;
    if (!editing && ui.clicked(fr)) this.startEdit(fr);
    this.fieldRect = fr;
    if (orbButton(ui, ctx, x + w - 15, y + 51, 7, '#ffb02e', { glyph: '?', tip: 'Random name' })) {
      this.endEdit(false);
      net.setName(randomName());
    }
    // me, standing on a little eco hill
    const px = x + w / 2, py = y + 126;
    ctx.save();
    rrect(ctx, x + 6, y + 64, w - 12, 70, 8); ctx.clip();
    ecoSky(ctx, x + 6, y + 64, w - 12, 70, t, { sun: [0.2, 0.2], clouds: true, grass: 16 });
    ctx.restore();
    rrect(ctx, x + 6.5, y + 64.5, w - 13, 69, 8); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1; ctx.stroke();
    if (!this.charErr) {
      try { Character.drawCharacter(ctx, px, py, { pose: on ? 'wave' : 'idle', t, facing: 1, look: g.state.character, scale: 0.62, id: 'mp-preview', shadow: false }); } catch (e) { this.charErr = true; }
    }
    if (on) {
      const nm = net.name;
      const nw = measureText(nm, 'small') + 16;
      pill(ctx, px - nw / 2, y + 68, nw, 10, { color: '#f4fbff', edge: '#2fb8f0', r: 5 });
      drawGlossOrb(ctx, px - nw / 2 + 6, y + 73, 2.6, '#2fb8f0');
      drawText(ctx, nm, px - nw / 2 + 11, y + 71, { font: 'small', color: INK });
    }
    // party luck
    const luck = net.partyLuck?.() || 1, k = Math.round((luck - 1) * 10);
    drawText(ctx, 'PARTY LUCK', x + 8, y + 140, { font: 'small', color: INK_SOFT });
    for (let i = 0; i < 3; i++) {
      drawGlossOrb(ctx, x + 66 + i * 13, y + 142, 4.5, i < k ? '#5cc832' : '#d4e4ec', t);
      if (i < k) drawSparkle(ctx, x + 68 + i * 13, y + 138, 1, 0.5 + 0.5 * Math.sin(t * 5 + i), '#ffffff');
    }
    drawText(ctx, `+${k * 10}%`, x + w - 8, y + 140, { font: 'small', align: 'right', color: k ? '#2a9a20' : INK_SOFT });
    drawText(ctx, 'EACH FRIEND IN YOUR OCEAN: +10%', x + 8, y + 151, { font: 'small', color: '#7aa6bc' });
    // privacy
    const lines = wrapText(PRIVACY, w - 24, 'small');
    const ly = y + h - 6 - lines.length * 7;
    ctx.fillStyle = 'rgba(12,58,82,0.08)';
    rrect(ctx, x + 4, ly - 4, w - 8, lines.length * 7 + 7, 5); ctx.fill();
    const lk = getUiIcon('lock');
    if (lk) ctx.drawImage(lk, x + 7, ly - 1);
    lines.forEach((l, i) => drawText(ctx, l, x + 17, ly + i * 7, { font: 'small', color: INK_SOFT }));
  }

  // ---------------------------------------------------------------- players
  drawPlayers(ctx, ui, x, y, w, h) {
    const g = this.game, net = this.net, t = this.t;
    glassCard(ctx, x, y, w, h, { r: 8, top: 'rgba(240,252,255,0.8)', bottom: 'rgba(200,236,250,0.75)' });
    const list = net.online ? net.list() : [];
    drawText(ctx, 'PLAYERS', x + 8, y + 6, { font: 'small', color: INK_SOFT });
    drawText(ctx, String(list.length), x + 44, y + 6, { font: 'small', color: INK });
    const rowH = 19, top = y + 15, rows = Math.floor((h - 18) / rowH);
    const maxS = Math.max(0, list.length - rows);
    if (ui.hover({ x, y, w, h }) && g.input.wheel) this.scroll = Math.max(0, Math.min(maxS, this.scroll + Math.sign(g.input.wheel)));
    this.scroll = Math.min(this.scroll, maxS);
    if (!list.length) {
      const msg = !net.online ? 'Go online to see who is fishing.' : 'Nobody else here yet.';
      drawText(ctx, msg, x + w / 2, y + h / 2 - 10, { align: 'center', color: INK });
      const tip = !net.online ? 'Your boat appears in their ocean, theirs in yours.' : 'Open FISHTOP in another window, or share the claude.ai link with a friend.';
      wrapText(tip, w - 30, 'small').forEach((l, i) => drawText(ctx, l, x + w / 2, y + h / 2 + 4 + i * 8, { align: 'center', font: 'small', color: INK_SOFT }));
      return;
    }
    list.slice(this.scroll, this.scroll + rows).forEach((p, i) => {
      const ry = top + i * rowH;
      const rr = { x: x + 4, y: ry, w: w - 8, h: rowH - 2 };
      if (ui.hover(rr)) { rrect(ctx, rr.x, rr.y, rr.w, rr.h, 6); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill(); }
      drawGlossOrb(ctx, x + 14, ry + 8, 6, p.color, t);
      drawText(ctx, (p.p.name[0] || '?').toUpperCase(), x + 14, ry + 5, { align: 'center', font: 'small', color: '#ffffff' });
      drawText(ctx, p.p.name + (p.isMe ? ' (you)' : ''), x + 24, ry + 2, { color: INK });
      const oc = OCEAN_NAMES?.[p.p.oc] || p.p.oc;
      let tx = x + 24;
      tx += tag(ctx, tx, ry + 10, p.here ? 'HERE' : oc.toUpperCase().slice(0, 18), p.here ? GRASS : '#7ab8e0') + 3;
      const st = p.p.st;
      if (st !== 'idle') tag(ctx, tx, ry + 10, st === 'fight' ? 'REELING!' : st === 'bite' || st === 'nibble' ? 'BITE!' : st === 'land' ? 'LANDING' : 'FISHING', st === 'fight' || st === 'bite' ? '#ff9d2e' : '#2fa8d8');
      // boat tier dots
      for (let k = 0; k <= Math.min(6, p.p.boat.t); k++) drawGlossOrb(ctx, x + w - 78 + k * 5, ry + 8, 1.8, '#2fb8f0');
      if (p.p.cn) drawText(ctx, String(p.p.cn), x + w - 52, ry + 5, { font: 'small', align: 'right', color: INK_SOFT });
      if (splashButton(ui, ctx, x + w - 46, ry + 1, 38, 14, 'Wave', { tone: 'aqua', tip: `Wave at ${p.p.name}` })) net.wave(p.key);
    });
    if (maxS > 0) {
      const sh = h - 20, th = Math.max(10, sh * (rows / list.length));
      pill(ctx, x + w - 5, top + (sh - th) * (this.scroll / maxS), 3, th, { color: '#7ad0f0', gloss: false });
    }
  }

  // ---------------------------------------------------------------- emotes
  drawEmotes(ctx, ui, x, y, w, h) {
    const net = this.net, t = this.t;
    glassCard(ctx, x, y, w, h, { r: 8, top: 'rgba(240,252,255,0.8)', bottom: 'rgba(200,236,250,0.75)' });
    drawText(ctx, 'EMOTES', x + 8, y + 12, { font: 'small', color: INK_SOFT });
    const on = net.online;
    EMOTES.forEach((e, i) => {
      const cx = x + 56 + i * 26, cy = y + h / 2;
      const rr = { x: cx - 11, y: cy - 11, w: 22, h: 22 };
      const hov = on && ui.hover(rr);
      const recent = net.myEm?.id === e.id && net.t - net.myEm.t0 < 0.6;
      drawGlossOrb(ctx, cx, cy - (hov ? 1 : 0), 10 + (recent ? 1.5 : 0), on ? e.color : '#c8d4dc', t);
      const ic = getUiIcon(e.icon);
      if (ic) { ctx.globalAlpha = on ? 1 : 0.5; ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(cy - ic.height / 2 - (hov ? 1 : 0))); ctx.globalAlpha = 1; }
      if (ui.hover(rr)) ui.tip = on ? e.label : 'Go online to use emotes';
      if (on && ui.clicked(rr)) net.emote(e.id);
    });
  }

  // ---------------------------------------------------------------- feed
  drawFeed(ctx, ui, x, y, w, h) {
    const net = this.net, t = this.t;
    glassCard(ctx, x, y, w, h, { r: 8, top: 'rgba(240,252,255,0.8)', bottom: 'rgba(200,236,250,0.75)' });
    drawText(ctx, 'RECENT CATCHES', x + 8, y + 6, { font: 'small', color: INK_SOFT });
    const feed = net.feed || [];
    if (!feed.length) { drawText(ctx, net.online ? 'Catches from everyone show up here.' : '-', x + w / 2, y + h / 2, { align: 'center', font: 'small', color: INK_SOFT }); return; }
    const rows = Math.floor((h - 16) / 11);
    feed.slice(0, rows).forEach((e, i) => {
      const ry = y + 16 + i * 11;
      drawGlossOrb(ctx, x + 11, ry + 3, 3, e.color || '#2fb8f0');
      let txt;
      if (e.kind === 'catch') {
        const sp = SPECIES_BY_ID[e.sp];
        const size = e.s > 0 ? (e.s >= 100 ? ` ${(e.s / 100).toFixed(1)}m` : ` ${Math.round(e.s)}cm`) : '';
        txt = `${e.me ? 'You' : e.name} caught ${sp?.name || 'a mystery fish'}${size}`;
        const col = RARITY[sp?.rarity || e.r]?.color || '#c9d4dc';
        drawGlossOrb(ctx, x + w - 26, ry + 3, 3, col, t);
      } else if (e.kind === 'join') txt = `${e.name} went online`;
      else txt = `${e.name} waved at you`;
      let s = txt;
      while (measureText(s) > w - 60 && s.length > 4) s = s.slice(0, -2);
      if (s !== txt) s = s.slice(0, -1) + '..';
      drawText(ctx, s, x + 18, ry, { color: INK });
      drawText(ctx, ago(e.at), x + w - 8, ry + 1, { font: 'small', align: 'right', color: '#7aa6bc' });
    });
  }

  drawLocked(ctx, ui, x, y, w, h) {
    const g = this.game;
    rrect(ctx, x, y, w, h, 10);
    ctx.fillStyle = 'rgba(225,245,255,0.86)'; ctx.fill();
    const cx = x + w / 2, cy = y + h / 2;
    ecoGlobe(ctx, cx, cy - 40, 22, this.t);
    drawGlossOrb(ctx, cx + 16, cy - 26, 8, '#ffd27a', this.t);
    const lk = getUiIcon('lock');
    if (lk) ctx.drawImage(lk, Math.round(cx + 16 - lk.width / 2), Math.round(cy - 26 - lk.height / 2));
    ctx.drawImage(wordArt('Friendly Seas', { scale: 2 }), Math.round(cx - wordArt('Friendly Seas', { scale: 2 }).width / 2), Math.round(cy - 10));
    drawText(ctx, 'FISH TOGETHER WITH FRIENDS. RESEARCH IT IN THE LAB!', cx, cy + 14, { align: 'center', font: 'small', color: INK_SOFT });
    if (splashButton(ui, ctx, cx - 50, cy + 26, 100, 20, 'The Lab', { tone: 'green' })) {
      if (g.ui.panels.lab) { g.ui.close(this.id); g.ui.open('lab', { focus: 'sea_multi' }); } else g.toast?.('The Lab is being built. Check back soon!', 'info');
    }
  }

  // ---------------------------------------------------------------- name field (a transparent DOM input on top of the canvas)
  startEdit(fr) {
    if (this.edit || typeof document === 'undefined') return;
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = NAME_MAX * 2;
    el.value = this.net.name || '';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('aria-label', 'Display name');
    Object.assign(el.style, { position: 'fixed', opacity: '0', zIndex: '50', border: '0', padding: '0', margin: '0', background: 'transparent', color: 'transparent', caretColor: 'transparent', outline: 'none' });
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.endEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); this.endEdit(false); }
    });
    el.addEventListener('input', () => { if (Array.from(el.value).length > NAME_MAX) el.value = Array.from(el.value).slice(0, NAME_MAX).join(''); });
    el.addEventListener('blur', () => this.endEdit(true));
    document.body.appendChild(el);
    this.edit = { el, fr };
    this.placeEdit();
    el.focus();
    el.select();
    this.game.audio?.play('ui_click');
  }

  placeEdit() {
    const e = this.edit, g = this.game;
    if (!e) return;
    if (!g.ui.isOpen(this.id)) { this.endEdit(true); return; }
    const cv = g.screen?.canvas || g.canvas;
    const b = cv.getBoundingClientRect();
    const sx = b.width / g.screen.W, sy = b.height / g.screen.H;
    const fr = this.fieldRect || e.fr;
    Object.assign(e.el.style, { left: b.left + fr.x * sx + 'px', top: b.top + fr.y * sy + 'px', width: fr.w * sx + 'px', height: fr.h * sy + 'px', fontSize: Math.max(8, Math.round(fr.h * sy * 0.6)) + 'px' });
  }

  endEdit(commit) {
    const e = this.edit;
    if (!e) return;
    this.edit = null;
    if (commit) this.net.setName(e.el.value);
    try { e.el.remove(); } catch { /* ignore */ }
  }
}
