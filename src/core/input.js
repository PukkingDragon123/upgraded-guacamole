// Pointer + keyboard state in logical (low-res) pixel coordinates.
// Edge flags (pressed/released/clicked) are valid for one frame; call endFrame() after update.

export class Input {
  constructor(canvas, toLogical) {
    this.canvas = canvas;
    this.toLogical = toLogical;
    this.x = -100; this.y = -100;
    this.px = -100; this.py = -100;
    this.vx = 0; this.vy = 0; // smoothed velocity (px/s)
    this.speed = 0;
    this.down = false; this.rdown = false;
    this.pressed = false; this.released = false;
    this.rpressed = false; this.rreleased = false;
    this.dblclick = false;
    this.wheel = 0;
    this.inside = false;
    this.moved = false;
    this.keys = new Set();
    this.keysPressed = new Set();
    this.path = []; // recent [x, y, t] samples for gestures
    this.lastClickT = 0;
    this.lastClickX = 0; this.lastClickY = 0;
    this.clicks = 0; // clicks this frame
    this.time = 0;
    this.downX = 0; this.downY = 0; this.downT = 0;
    this.external = false; // cursor driven by host (click-through overlay)
    this.files = null; // dropped files this frame
    this.dropX = 0; this.dropY = 0;
    this._bind();
  }

  _pos(e) {
    const [x, y] = this.toLogical(e.clientX, e.clientY);
    this.x = x; this.y = y;
  }

  _bind() {
    const c = this.canvas;
    const opts = { passive: false };
    window.addEventListener('pointermove', (e) => { this._pos(e); this.inside = true; this.moved = true; });
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.focus();
      this._pos(e);
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (e.button === 2) { this.rdown = true; this.rpressed = true; return; }
      if (e.button !== 0) return;
      this.down = true; this.pressed = true; this.clicks++;
      this.downX = this.x; this.downY = this.y; this.downT = this.time;
      const now = performance.now();
      if (now - this.lastClickT < 380 && Math.abs(this.x - this.lastClickX) < 5 && Math.abs(this.y - this.lastClickY) < 5) {
        this.dblclick = true;
        this.lastClickT = 0;
      } else {
        this.lastClickT = now;
        this.lastClickX = this.x; this.lastClickY = this.y;
      }
    }, opts);
    window.addEventListener('pointerup', (e) => {
      this._pos(e);
      if (e.button === 2) { if (this.rdown) this.rreleased = true; this.rdown = false; return; }
      if (e.button !== 0) return;
      if (this.down) this.released = true;
      this.down = false;
    });
    window.addEventListener('pointercancel', () => { if (this.down) this.released = true; this.down = false; this.rdown = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60 + 0.5); }, opts);
    document.addEventListener('mouseleave', () => { this.inside = false; });
    window.addEventListener('blur', () => { this.down = false; this.rdown = false; this.keys.clear(); });
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!this.keys.has(k)) this.keysPressed.add(k);
      this.keys.add(k);
      if (['Tab', ' ', 'ArrowUp', 'ArrowDown', 'Backspace'].includes(e.key)) e.preventDefault();
      this.lastKeyEvent = e;
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
    });
    // Files dropped onto the window become virtual bait (names/types only, contents never read).
    window.addEventListener('dragover', (e) => { e.preventDefault(); this._pos(e); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      this._pos(e);
      const list = [];
      for (const f of e.dataTransfer?.files || []) list.push({ name: f.name, type: f.type, isDir: !f.type && f.size % 4096 === 0 });
      if (list.length) { this.files = list; this.dropX = this.x; this.dropY = this.y; }
    });
  }

  setExternalCursor(x, y) {
    this.external = true;
    this.x = x; this.y = y;
    this.inside = true;
  }

  update(dt) {
    this.time += dt;
    const ivx = (this.x - this.px) / Math.max(dt, 1e-3);
    const ivy = (this.y - this.py) / Math.max(dt, 1e-3);
    const k = 1 - Math.exp(-18 * dt);
    if (Math.abs(ivx) < 4000 && Math.abs(ivy) < 4000) {
      this.vx += (ivx - this.vx) * k;
      this.vy += (ivy - this.vy) * k;
    }
    this.speed = Math.hypot(this.vx, this.vy);
    this.path.push([this.x, this.y, this.time]);
    while (this.path.length > 2 && this.time - this.path[0][2] > 2.5) this.path.shift();
  }

  key(k) { return this.keys.has(k); }
  keyPressed(k) { return this.keysPressed.has(k); }

  // Consume the click so lower layers do not also react.
  consume() {
    this.pressed = false;
    this.released = false;
    this.dblclick = false;
    this.clicks = 0;
  }

  endFrame() {
    this.px = this.x; this.py = this.y;
    this.pressed = this.released = this.rpressed = this.rreleased = false;
    this.dblclick = false;
    this.wheel = 0;
    this.clicks = 0;
    this.moved = false;
    this.keysPressed.clear();
    this.files = null;
  }
}
