// Day/night clock. Real local time by default; optional fast cycle or locked day/night.

import { clamp01, smoothstep } from '../core/math.js';

export class Clock {
  constructor(game) {
    this.game = game;
    this.fastStart = performance.now();
    this.override = null; // debug hour
  }

  realNow() { return Date.now(); }

  hour() {
    if (this.override !== null) return this.override;
    const mode = this.game.state.settings.dayCycle;
    if (mode === 'day') return 12;
    if (mode === 'night') return 23;
    if (mode === 'fast') return (((performance.now() - this.fastStart) / 1000 / 60) % 24 + 9) % 24; // 24 min day
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  // 0 = deep night, 1 = full day
  daylight() {
    const h = this.hour();
    const up = smoothstep(5, 8, h);
    const down = 1 - smoothstep(17.5, 20.5, h);
    return clamp01(Math.min(up, down));
  }

  // 0..1 strength of golden-hour tint
  dusk() {
    const h = this.hour();
    const a = 1 - Math.abs(h - 18.7) / 1.8;
    const b = 1 - Math.abs(h - 6.3) / 1.5;
    return clamp01(Math.max(a, b));
  }

  isNight() { return this.daylight() < 0.35; }
  isDusk() { return this.dusk() > 0.4; }
}
