// Multiplayer fishing (OWNER: Online & AppSea agent). Opt-in and offline-first: nothing is sent or joined until the
// player switches "Go online" in the Multiplayer panel; the game is complete without it.
//
//   game.net = new Net(game)  (installNet in ./index.js)
//   net.update(dtReal)        every frame (cheap when offline)
//   net.draw(ctx, layer)      'boats': world space with the camera applied, drawn just before the player's boat
//                             'tags':  screen space, after the lighting pass (net applies the camera itself)
//   net.partyLuck() -> 1..1.3 +10% luck per other player in the same ocean (max +30%); 1 when offline
//   net.goOnline() / goOffline() / toggle(), net.setName(s), net.emote(id), net.wave(key)
//   net.list() -> visible peers [{key, p, color, isMe, guest, here}], net.feed -> recent catches/joins, net.status
//   net.transportLabel() -> 'claude.ai room' | 'local windows' | ...
// Shared: name (<= 16 chars, chosen by the player), bubble-person look, boat tier/paint/parts, ocean, boat x,
// fishing state + hook spot, emote, catches. Never shared: anything else in the save, account data, files.
// Save: state.net = {online, name}. Lab gate: feature 'multiplayer' ("Friendly Seas") when the Lab defines it.

import { cleanPresence, cleanEvent, cleanName, randomName, newSid, EMOTE_BY_ID, PROTO } from './protocol.js';
import { LocalTransport, RoomTransport } from './transport.js';
import { drawPeerBoats, drawPeerTags, drawPartyBadge, PEER_COLORS } from './render.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { LAB_NODES, unlocked } from '../game/lab.js';
import * as Character from '../gfx/character.js';

export const NET_NEEDS_LAB = true; // flip to false to make going online free from the start
const LOCAL_TTL = 7000;
const MAX_PEERS = 24;
const FEED_MAX = 14;

export function ensureNet(state) {
  const n = (state.net ||= { online: false, name: '' });
  if (typeof n.name !== 'string') n.name = '';
  n.online = !!n.online;
  return n;
}

export function netUnlocked(state) {
  if (!NET_NEEDS_LAB) return true;
  let gated = false;
  try { gated = (LAB_NODES || []).some((nd) => (nd.unlock || []).some((u) => u.kind === 'feature' && u.id === 'multiplayer')); } catch { gated = false; }
  if (!gated) return true;
  try { return !!unlocked(state, 'feature', 'multiplayer'); } catch { return true; }
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.sid = newSid();
    this.peers = new Map();
    this.feed = [];
    this.transports = [];
    this.status = 'offline';
    this.t = 0;
    this.n = { em: 0, catch: 0, wave: 0 };
    this.myEm = null;
    this.myCatch = null;
    this.catchesOnline = 0;
    ensureNet(game.state);
    game.on?.('caught', (d) => { try { this.onMyCatch(d); } catch (e) { console.error(e); } });
    if (this.st.online && netUnlocked(game.state)) setTimeout(() => this.goOnline(true), 400);
  }

  get st() { return ensureNet(this.game.state); }
  get online() { return this.status !== 'offline'; }
  get name() { return this.st.name || ''; }
  unlocked() { return netUnlocked(this.game.state); }

  transportLabel() {
    const live = this.transports.filter((t) => t.connected && !t.dead).map((t) => t.kind);
    if (live.includes('room') && live.includes('local')) return 'claude.ai room + local windows';
    if (live.includes('room')) return 'claude.ai room';
    if (live.includes('local')) return 'local windows';
    return this.online ? 'connecting...' : 'offline';
  }

  // ---------------------------------------------------------------- on / off
  async goOnline(quiet = false) {
    const g = this.game;
    if (this.online) return true;
    if (!this.unlocked()) { if (!quiet) g.toast?.('Research Friendly Seas in The Lab to fish with friends!', 'lock'); return false; }
    if (!this.st.name) this.st.name = randomName();
    this.st.online = true;
    this.status = 'connecting';
    this.onlineSince = this.t;
    this.peers.clear();
    const hooks = {
      presence: (key, raw, meta) => this.onPresence(key, raw, meta),
      leave: (key) => this.onLeave(key),
      event: (key, topic, data, meta) => this.onEvent(key, topic, data, meta),
      status: () => this.refreshStatus(),
    };
    const local = new LocalTransport(this.sid), room = new RoomTransport(this.sid);
    this.transports = [local, room];
    this.pushPresence();
    await local.start(hooks);
    this.refreshStatus();
    room.start(hooks).then((ok) => {
      if (!ok) this.transports = this.transports.filter((t) => t !== room);
      else this.pushPresence();
      this.refreshStatus();
    });
    if (!quiet) { g.toast?.(`Online as ${this.st.name}!`, 'sparkle'); g.audio?.play('ui_unlock'); }
    g.emit?.('netOnline', true);
    g.save?.();
    return true;
  }

  goOffline() {
    const g = this.game;
    for (const t of this.transports) { try { t.stop(); } catch { /* ignore */ } }
    this.transports = [];
    this.peers.clear();
    this.status = 'offline';
    this.st.online = false;
    g.toast?.('You are offline. Fishing solo.', 'info');
    g.emit?.('netOnline', false);
    g.save?.();
  }

  toggle() { return this.online ? (this.goOffline(), false) : this.goOnline(); }

  refreshStatus() {
    if (!this.online) return;
    this.transports = this.transports.filter((t) => !t.dead);
    this.status = this.transports.some((t) => t.connected) ? 'online' : 'connecting';
  }

  setName(s) {
    const n = cleanName(s);
    if (!n) return false;
    this.st.name = n;
    this.pushPresence();
    this.game.save?.();
    return true;
  }

  // ---------------------------------------------------------------- my actions
  emote(id) {
    const e = EMOTE_BY_ID[id];
    if (!e || !this.online) return false;
    const now = this.t;
    if (this.lastEmoteAt !== undefined && now - this.lastEmoteAt < 0.6) return false;
    this.lastEmoteAt = now;
    this.n.em++;
    this.myEm = { id, n: this.n.em, t0: now };
    this.emit('emote', { id, n: this.n.em });
    this.pushPresence();
    this.game.audio?.play('ui_click');
    return true;
  }

  wave(key) {
    const peer = this.peers.get(key);
    if (!peer || !this.online) return false;
    this.n.wave++;
    this.emit('wave', { to: peer.p.sid, n: this.n.wave });
    this.myEm = { id: 'wave', n: ++this.n.em, t0: this.t };
    this.pushPresence();
    this.game.toast?.(`You waved at ${peer.p.name}!`, 'sparkle');
    return true;
  }

  onMyCatch(d) {
    if (!this.online || !d?.sp) return;
    this.n.catch++;
    this.catchesOnline++;
    const c = { sp: String(d.sp.id || ''), r: d.sp.rarity || 'common', s: Math.round((d.rec?.sizeCm || 0) * 10) / 10, n: this.n.catch };
    this.myCatch = c;
    this.emit('caught', c);
    this.pushPresence();
    this.addFeed({ kind: 'catch', name: this.name, me: true, sp: c.sp, r: c.r, s: c.s, color: '#2fb8f0' });
  }

  emit(topic, data) {
    for (const t of this.transports) { try { t.emit(topic, data); } catch { /* ignore */ } }
  }

  // ---------------------------------------------------------------- my presence
  presence() {
    const g = this.game, st = g.state;
    const W = g.screen?.W || 960, H = g.screen?.H || 540;
    const b = g.boat;
    let hull = null, trim = null;
    try { const bp = Character.boatPaint?.(st.character); hull = bp?.hull || null; trim = bp?.trim || null; } catch { /* ignore */ }
    const f = g.fishing, h = f?.hook;
    let s = 'idle', hk = null;
    if (f && g.state.view === 'ocean') {
      const fs = f.state;
      if (fs === 'fight') s = 'fight';
      else if (fs === 'bite') s = 'bite';
      else if (fs === 'nibble') s = 'nibble';
      else if (fs === 'landing') s = 'land';
      else if (h?.visible && g.world?.hook?.inWater) s = 'wait';
      if (s !== 'idle' && s !== 'land' && h?.visible) {
        const surf = g.ocean?.waterLevel?.() ?? 0;
        hk = [Math.round((h.x / W) * 1000) / 1000, Math.round(((h.y - surf) / Math.max(40, H - surf)) * 1000) / 1000];
      }
    }
    const raw = {
      v: PROTO, sid: this.sid, name: this.name || 'Fisher',
      look: st.character || null,
      boat: { t: st.boat?.tier | 0, hull, trim, parts: st.boat?.parts || null },
      oc: g.ocean?.biome?.id || st.biome || 'oscean',
      x: b ? Math.round((b.x / W) * 1000) / 1000 : 0.3,
      dir: b?.dir === -1 ? -1 : 1,
      st: s, hk,
      em: this.myEm ? { id: this.myEm.id, n: this.myEm.n } : null,
      lc: this.myCatch,
      cn: this.catchesOnline,
    };
    return cleanPresence(raw); // what we send passes our own validation (and its size limits)
  }

  pushPresence() {
    if (!this.online) return;
    const p = this.presence();
    if (!p) return;
    for (const t of this.transports) t.setPresence(p);
  }

  // ---------------------------------------------------------------- what we hear
  onPresence(key, raw, meta) {
    if (!this.online) return;
    const p = cleanPresence(raw);
    if (!p) { this.onLeave(key); return; }
    if (p.sid === this.sid) return;
    let peer = this.peers.get(key);
    const now = Date.now();
    if (!peer) {
      if (this.peers.size >= MAX_PEERS) return;
      const h = hashStr(p.sid);
      peer = {
        key, src: meta.src, isMe: !!meta.isMe, guest: !!meta.guest, p, seen: now, joined: this.t,
        color: PEER_COLORS[h % PEER_COLORS.length], phase: (h % 1000) / 160, fade: 0,
        rx: null, hx: null, hy: null, pops: [], emote: null, lastEmN: p.em?.n ?? -1, lastCatchN: p.lc?.n ?? -1, lastWaveN: -1,
        bucket: 6,
      };
      this.peers.set(key, peer);
      if (!this.quietJoin()) {
        this.game.toast?.(`${p.name} is fishing online!`, 'fish');
        this.addFeed({ kind: 'join', name: p.name, color: peer.color });
      }
    }
    if (peer.p.st === 'idle' && (p.st === 'wait' || p.st === 'cast')) peer.castT0 = this.t;
    peer.p = p;
    peer.seen = now;
    peer.isMe = !!meta.isMe;
    peer.guest = !!meta.guest;
    if (p.em && p.em.n !== peer.lastEmN) { peer.lastEmN = p.em.n; this.showEmote(peer, p.em.id); }
    if (p.lc && p.lc.n !== peer.lastCatchN) { peer.lastCatchN = p.lc.n; this.showCatch(peer, p.lc); }
  }

  quietJoin() { return this.t - (this.onlineSince ?? this.t) < 1.5; }

  onLeave(key) {
    const peer = this.peers.get(key);
    if (!peer) return;
    this.peers.delete(key);
  }

  onEvent(key, topic, data, meta) {
    if (!this.online) return;
    const peer = this.peers.get(key);
    if (!peer) return;
    // per-peer rate limit: ~3 moments/s sustained, bursts of 6
    if (peer.bucket < 1) return;
    peer.bucket--;
    const d = cleanEvent(topic, data);
    if (!d) return;
    if (topic === 'caught' && d.n !== peer.lastCatchN) { peer.lastCatchN = d.n; this.showCatch(peer, d); }
    else if (topic === 'emote' && d.n !== peer.lastEmN) { peer.lastEmN = d.n; this.showEmote(peer, d.id); }
    else if (topic === 'wave' && d.n !== peer.lastWaveN) {
      peer.lastWaveN = d.n;
      this.showEmote(peer, 'wave');
      if (d.to === this.sid) {
        this.game.toast?.(`${peer.p.name} waved at you!`, 'sparkle');
        this.game.audio?.play('ui_unlock', { vol: 0.5 });
        this.addFeed({ kind: 'wave', name: peer.p.name, color: peer.color });
      }
    }
    void meta;
  }

  showEmote(peer, id) {
    if (!EMOTE_BY_ID[id]) return;
    peer.emote = { id, t0: this.t };
  }

  showCatch(peer, c) {
    const sp = SPECIES_BY_ID[c.sp];
    const name = sp?.name || 'Mystery Fish';
    const rar = sp?.rarity || c.r;
    const size = c.s > 0 ? (c.s >= 100 ? (c.s / 100).toFixed(1) + 'm' : Math.round(c.s) + 'cm') : '';
    peer.pops.push({ text: (name + (size ? ' ' + size : '')).slice(0, 34), r: rar, t0: this.t });
    if (peer.pops.length > 3) peer.pops.shift();
    peer.cheerT0 = this.t;
    this.addFeed({ kind: 'catch', name: peer.p.name, sp: c.sp, r: rar, s: c.s, color: peer.color });
  }

  addFeed(e) {
    e.at = Date.now();
    this.feed.unshift(e);
    if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
  }

  // ---------------------------------------------------------------- queries
  // Visible peers (a room peer wins over the same player heard through a local channel).
  list() {
    const roomSids = new Set();
    for (const p of this.peers.values()) if (p.src === 'room') roomSids.add(p.p.sid);
    const out = [];
    const oc = this.game.ocean?.biome?.id || this.game.state.biome;
    for (const p of this.peers.values()) {
      if (p.src === 'local' && roomSids.has(p.p.sid)) continue;
      p.here = p.p.oc === oc;
      out.push(p);
    }
    out.sort((a, b) => (b.here - a.here) || a.p.name.localeCompare(b.p.name));
    return out;
  }

  peersHere() { return this.list().filter((p) => p.here); }

  partyLuck() {
    if (!this.online) return 1;
    const n = this.peersHere().filter((p) => !p.isMe).length;
    return 1 + 0.1 * Math.min(3, n);
  }

  // ---------------------------------------------------------------- frame
  update(dtReal) {
    this.t += dtReal;
    if (!this.online) return;
    const now = Date.now();
    this.pushT = (this.pushT || 0) - dtReal;
    if (this.pushT <= 0) { this.pushT = 0.1; this.pushPresence(); }
    for (const t of this.transports) { try { t.tick(now); } catch { /* ignore */ } }
    const W = this.game.screen?.W || 960, H = this.game.screen?.H || 540;
    const surf = this.game.ocean?.waterLevel?.() ?? 0;
    for (const [key, p] of this.peers) {
      if (p.src === 'local' && now - p.seen > LOCAL_TTL) { this.peers.delete(key); continue; }
      p.bucket = Math.min(6, p.bucket + dtReal * 3);
      p.fade = Math.min(1, p.fade + dtReal * 2);
      const tx = p.p.x * W;
      p.rx = p.rx === null ? tx : p.rx + (tx - p.rx) * Math.min(1, dtReal * 6);
      if (p.p.hk) {
        const hx = p.p.hk[0] * W, hy = surf + p.p.hk[1] * Math.max(40, H - surf);
        p.hx = p.hx === null ? hx : p.hx + (hx - p.hx) * Math.min(1, dtReal * 10);
        p.hy = p.hy === null ? hy : p.hy + (hy - p.hy) * Math.min(1, dtReal * 10);
      } else { p.hx = null; p.hy = null; }
      p.pops = p.pops.filter((c) => this.t - c.t0 < 4.5);
    }
  }

  draw(ctx, layer) {
    if (!this.online || !this.peers.size) return;
    const g = this.game;
    if (g.state.view !== 'ocean' || g.ocean?.travelState || (g.ocean?.reveal ?? 1) < 1) return;
    const here = this.peersHere();
    try {
      if (layer === 'boats') drawPeerBoats(ctx, this, here);
      else if (layer === 'tags') {
        g.camera?.apply?.(ctx);
        drawPeerTags(ctx, this, here);
        drawPartyBadge(ctx, this, this.partyLuck(), g.boat);
        g.camera?.reset?.(ctx);
      }
    } catch (e) {
      if (!this.drawErr) { this.drawErr = true; console.error('net draw', e); }
    }
  }
}
