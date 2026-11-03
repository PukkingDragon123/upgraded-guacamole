// Multiplayer transports (OWNER: Online & AppSea agent). Both speak the same tiny interface so the game never
// cares which one carried a message:
//   t.start(hooks) -> Promise<bool>     hooks: {presence(key, raw, meta), leave(key), event(key, topic, data, meta), status()}
//   t.setPresence(obj)                  absolute state (sent throttled + re-asserted on a heartbeat)
//   t.emit(topic, data)                 a moment
//   t.tick(now)                         flushes throttled presence / heartbeats
//   t.stop()                            says goodbye, unsubscribes
//   t.kind 'local'|'room', t.connected, t.dead, t.canEmit
// Keys: local peers are 'l:<sid>' (sid from their presence), room peers are 'r:<peer>' (the platform's unforgeable
// peer label), so a room peer can never overwrite someone else's entry.
//
// LocalTransport: BroadcastChannel between FISHTOP windows of the same browser (same origin only).
// RoomTransport: the claude.ai artifact `room` capability (await window.claude.use('room'); null = unavailable).
//   Presence lives under the single top-level key 'ft'; events use the topics in protocol.js TOPICS. Only
//   requested once the player opts in (going online), so an offline player never joins the room.

import { TOPICS, isSid } from './protocol.js';

const CHANNEL = 'fishtop-net-1';
const HEARTBEAT = 2000;
const MAX_JSON = 4000;

function sizeOk(v) {
  try { return JSON.stringify(v).length <= MAX_JSON; } catch { return false; }
}

export class LocalTransport {
  constructor(sid) {
    this.kind = 'local';
    this.sid = sid;
    this.ch = null;
    this.connected = false;
    this.dead = false;
    this.canEmit = true;
    this.pres = null;
    this.dirty = false;
    this.lastSent = 0;
  }

  async start(hooks) {
    this.hooks = hooks;
    if (typeof BroadcastChannel === 'undefined') { this.dead = true; return false; }
    try {
      this.ch = new BroadcastChannel(CHANNEL);
    } catch { this.dead = true; return false; }
    this.ch.onmessage = (e) => { try { this.recv(e.data); } catch (err) { /* a bad message never breaks the game */ } };
    this.onHide = () => this.post({ k: 'bye', sid: this.sid });
    window.addEventListener('pagehide', this.onHide);
    this.connected = true;
    this.post({ k: 'hi', sid: this.sid });
    hooks.status?.();
    return true;
  }

  post(m) {
    if (!this.ch) return;
    try { this.ch.postMessage(m); } catch { /* closed */ }
  }

  recv(m) {
    if (!m || typeof m !== 'object' || !isSid(m.sid) || m.sid === this.sid) return;
    const key = 'l:' + m.sid, meta = { src: 'local', isMe: false, guest: false };
    if (m.k === 'p') { if (sizeOk(m.p)) this.hooks.presence(key, m.p, meta); }
    else if (m.k === 'hi') { this.dirty = true; this.lastSent = 0; }
    else if (m.k === 'e') { if (typeof m.topic === 'string' && sizeOk(m.data)) this.hooks.event(key, m.topic, m.data, meta); }
    else if (m.k === 'bye') this.hooks.leave(key);
  }

  setPresence(p) {
    const json = JSON.stringify(p);
    if (json !== this.json) { this.json = json; this.dirty = true; }
    this.pres = p;
  }

  tick(now) {
    if (!this.ch || !this.pres) return;
    if ((this.dirty && now - this.lastSent > 100) || now - this.lastSent > HEARTBEAT) {
      this.post({ k: 'p', sid: this.sid, p: this.pres });
      this.lastSent = now;
      this.dirty = false;
    }
  }

  emit(topic, data) { this.post({ k: 'e', sid: this.sid, topic, data }); }

  stop() {
    if (!this.ch) return;
    this.post({ k: 'bye', sid: this.sid });
    try { this.ch.close(); } catch { /* ignore */ }
    window.removeEventListener('pagehide', this.onHide);
    this.ch = null;
    this.connected = false;
  }
}

export class RoomTransport {
  constructor(sid) {
    this.kind = 'room';
    this.sid = sid;
    this.room = null;
    this.connected = false;
    this.dead = false;
    this.canEmit = true;
    this.unsubs = [];
    this.pres = null;
    this.sentJson = '';
    this.lastSent = 0;
  }

  async start(hooks) {
    this.hooks = hooks;
    let room = null;
    try { room = (await window.claude?.use?.('room')) || null; } catch { room = null; }
    if (!room || this.stopped) { this.dead = true; return false; }
    this.room = room;
    const onErr = (e) => { if (['revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error'].includes(e?.code)) { this.dead = true; this.connected = false; hooks.status?.(); } };
    try {
      this.unsubs.push(room.onPeers((ch) => this.onPeers(ch), onErr));
      for (const topic of TOPICS) {
        this.unsubs.push(room.on(topic, (msg) => {
          if (!msg || msg.sameTab || typeof msg.peer !== 'string') return;
          if (!sizeOk(msg.data)) return;
          hooks.event('r:' + msg.peer, topic, msg.data, { src: 'room', isMe: !!msg.isMe, guest: !!msg.guest, kind: msg.kind });
        }, onErr));
      }
      this.unsubs.push(room.onConnection((c) => { this.connected = !!c; hooks.status?.(); }, onErr));
      this.connected = !!room.connected();
    } catch (e) {
      this.dead = true;
      return false;
    }
    hooks.status?.();
    return true;
  }

  onPeers(change) {
    if (!change) return;
    const h = this.hooks;
    for (const p of [...(change.joined || []), ...(change.updated || [])]) {
      if (!p || p.sameTab || typeof p.peer !== 'string' || p.kind === 'agent') continue;
      const raw = p.presence?.ft;
      const key = 'r:' + p.peer;
      if (raw && sizeOk(raw)) h.presence(key, raw, { src: 'room', isMe: !!p.isMe, guest: !!p.guest });
      else h.leave(key);
    }
    for (const p of change.left || []) if (p && typeof p.peer === 'string') h.leave('r:' + p.peer);
  }

  setPresence(p) { this.pres = p; }

  tick(now) {
    if (!this.room || !this.pres || this.dead) return;
    if (now - this.lastSent < 125) return;
    const json = JSON.stringify(this.pres);
    if (json === this.sentJson && now - this.lastSent < 15000) return;
    this.sentJson = json;
    this.lastSent = now;
    try { this.room.presence({ ft: this.pres }).catch(() => { this.sentJson = ''; }); } catch { /* ignore */ }
  }

  emit(topic, data) {
    if (!this.room || this.dead || !this.canEmit) return;
    try {
      this.room.emit(topic, data).catch((e) => { if (e?.code === 'not_permitted') this.canEmit = false; });
    } catch { /* ignore */ }
  }

  stop() {
    this.stopped = true;
    if (this.room && !this.dead) { try { this.room.presence({ ft: null }).catch(() => {}); } catch { /* ignore */ } }
    for (const u of this.unsubs) { try { u(); } catch { /* ignore */ } }
    this.unsubs = [];
    this.room = null;
    this.connected = false;
  }
}
