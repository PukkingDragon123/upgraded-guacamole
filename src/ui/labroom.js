// The Lab's backdrop: a plain, clean gradient with a soft vignette (no scenery, no light rays).
// Used behind the research tree and the Rods / Boats tabs. Cached per view size.
import { aeroCached } from './aero.js';

function plain(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0f3a6e'); g.addColorStop(0.55, '#0b2c58'); g.addColorStop(1, '#081f42');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const r = x.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.2, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  r.addColorStop(0, 'rgba(60,150,220,0.18)'); r.addColorStop(1, 'rgba(2,10,30,0.45)');
  x.fillStyle = r; x.fillRect(0, 0, w, h);
  return c;
}

export function drawLabRoom(ctx, v, t, cam, kind) {
  const w = Math.round(v.w), h = Math.round(v.h);
  ctx.drawImage(aeroCached(`labplain1|${w}|${h}`, () => plain(w, h)), v.x, v.y, v.w, v.h);
}

// Where the Boats tab lines its boats up (formerly the dock pool's waterline).
export function labRoomScene(v) { return { wl: Math.round(v.h * 0.3) }; }
