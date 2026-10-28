// Pointer state for the browser overlay, shaped like core/input.js (x, y, vx, vy, speed, down, pressed,
// released, clicks, rdown...) so the fishing controller and minigames can read it unchanged.
// Unlike the game's Input it never calls preventDefault on the page: the cursor position is observed
// passively, and buttons are only seen through the overlay canvas, which receives pointer events
// exclusively while fishing mode is on.

export class OverlayInput {
  constructor(canvas, toLogical) {
    this.canvas = canvas;
    this.toLogical = toLogical;
    this.x = -100; this.y = -100;
    this.px = -100; this.py = -100;
    this.vx = 0; this.vy = 0; this.speed = 0;
    this.down = false; this.rdown = false;
    this.pressed = false; this.released = false;
    this.rpressed = false; this.rreleased = false;
    this.dblclick = false;
    this.clicks = 0;
    this.inside = false;
    this.moved = false;
    this.time = 0;
    this.lastClickT = 0;
    this.keysPressed = new Set();
    this.subs = [];
    this.bind();
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.subs.push(() => target.removeEventListener(type, fn, opts));
  }

  pos(e) {
    const [x, y] = this.toLogical(e.clientX, e.clientY);
    this.x = x; this.y = y;
  }

  bind() {
    const c = this.canvas;
    const passive = { passive: true, capture: true };
    this.on(window, 'pointermove', (e) => { this.pos(e); this.inside = true; this.moved = true; }, passive);
    this.on(window, 'mouseout', (e) => { if (!e.relatedTarget) this.inside = false; }, passive);
    this.on(window, 'blur', () => { this.release(); }, passive);
    this.on(window, 'pointerup', (e) => {
      if (e.button === 2) { if (this.rdown) this.rreleased = true; this.rdown = false; return; }
      if (e.button !== 0) return;
      if (this.down) { this.pos(e); this.released = true; }
      this.down = false;
    }, passive);
    this.on(window, 'pointercancel', () => this.release(), passive);
    // the canvas only gets these while fishing mode makes it hit-testable
    this.on(c, 'pointerdown', (e) => {
      e.preventDefault();
      this.pos(e);
      this.inside = true;
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (e.button === 2) { this.rdown = true; this.rpressed = true; return; }
      if (e.button !== 0) return;
      this.down = true; this.pressed = true; this.clicks++;
      const now = performance.now();
      this.dblclick = now - this.lastClickT < 380;
      this.lastClickT = this.dblclick ? 0 : now;
    }, { passive: false });
    this.on(c, 'contextmenu', (e) => e.preventDefault(), { passive: false });
  }

  release() {
    if (this.down) this.released = true;
    this.down = false;
    this.rdown = false;
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
  }

  // Rescale the remembered position after the logical canvas size changes.
  rescale(kx, ky) {
    this.x *= kx; this.y *= ky; this.px *= kx; this.py *= ky;
  }

  keyPressed(k) { return this.keysPressed.has(k); }
  key() { return false; }

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
    this.clicks = 0;
    this.moved = false;
    this.keysPressed.clear();
  }

  destroy() {
    for (const off of this.subs) off();
    this.subs.length = 0;
  }
}
