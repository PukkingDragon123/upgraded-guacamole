// Fallback aquarium view when WebGL2 is unavailable: a plain front-on 2D drawing of the same 3D simulation
// (orthographic, x across, y up, depth only fades things), so feeding, drops and the economy keep working.
//
//   drawFlat(ctx, aq, x, y, w, h)   also sets aq.view.project / ray so picking and drop popping still work

import { clamp } from '../core/math.js';
import { drawAeroCoin } from '../ui/aero.js';

export function drawFlat(ctx, aq, x, y, w, h) {
  const T = aq.shape;
  const sw = T.size[0] * 1.5, sh = T.top * 1.6;
  const s = Math.min(w / sw, h / sh);
  const cx = x + w / 2, by = y + h * 0.78;
  const P = (p) => [cx + p[0] * s, by - p[1] * s];
  const v = aq.view;
  // let the 3D view's picking work in this projection
  v.w = w; v.h = h;
  v.project = (p) => { const q = P(p); return [q[0] - x, q[1] - y, 100 + p[2]]; };
  v.ppu = () => s;
  v.ray = (sx, sy) => ({ o: [(sx + x - cx) / s, (by - (sy + y)) / s, 500], d: [0, 0, -1] });
  v.VP = v.VP || true;
  // room
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#7cc8ff'); g.addColorStop(0.6, '#d8f4ff'); g.addColorStop(0.61, '#e6f4fb'); g.addColorStop(1, '#cfe9f5');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e8c89a'; ctx.fillRect(x, by + 4, w, y + h - by - 4);
  ctx.fillStyle = '#f8fcff'; ctx.fillRect(cx - sw * s * 0.45, by, sw * s * 0.9, 5);
  // tank
  const hw = T.round ? T.R : T.size[0] / 2;
  const [x0, y1] = P([-hw, T.top]), [x1, y0] = P([hw, 0]);
  const wy = P([0, T.waterY])[1];
  const wg = ctx.createLinearGradient(0, wy, 0, y0);
  wg.addColorStop(0, '#7fdcf4'); wg.addColorStop(1, '#2a8cc8');
  ctx.save();
  ctx.beginPath();
  if (T.round) ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2 + 2, (x1 - x0) / 2, (y0 - y1) / 2, 0, 0, Math.PI * 2);
  else ctx.rect(x0, y1, x1 - x0, y0 - y1);
  ctx.clip();
  ctx.fillStyle = wg; ctx.fillRect(x0, wy, x1 - x0, y0 - wy);
  // gravel
  ctx.fillStyle = '#bff4ff';
  for (let i = 0; i <= 40; i++) {
    const X = -hw + (i / 40) * hw * 2, f = T.floorY(X, 0);
    const [px, py] = P([X, f]);
    ctx.fillRect(px - 1, py, (x1 - x0) / 40 + 2, y0 - py);
  }
  // plants, decor, fish, drops, bubbles (back to front by depth)
  const items = [];
  for (const d of aq.decor) items.push({ z: d.p[2], f: () => { const [px, py] = P(d.p); ctx.fillStyle = '#c8a8e0'; ctx.fillRect(px - d.r * s * 0.6, py - d.h * s, d.r * s * 1.2, d.h * s); } });
  for (const f of aq.fish) items.push({ z: f.p[2], f: () => {
    const [px, py] = P(f.p), L = f.len * s, dir = Math.cos(f.yaw) >= 0 ? 1 : -1;
    const col = f.sp.look?.col?.body || '#ff8a3a';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(px, py, L * 0.45, L * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - dir * L * 0.4, py); ctx.lineTo(px - dir * L * 0.7, py - L * 0.2); ctx.lineTo(px - dir * L * 0.7, py + L * 0.2); ctx.fill();
    ctx.fillStyle = '#141a26'; ctx.fillRect(Math.round(px + dir * L * 0.28), Math.round(py - L * 0.06), 2, 2);
  } });
  for (const c of aq.drops.list) items.push({ z: c.p[2], f: () => { const [px, py] = P(c.p); drawAeroCoin(ctx, px, py, clamp(c.r * s, 2.5, 8), aq.t); } });
  items.sort((a, b) => a.z - b.z);
  for (const it of items) it.f();
  ctx.fillStyle = 'rgba(230,252,255,0.8)';
  for (const b of aq.bubbles) { const [px, py] = P(b.p); ctx.fillRect(Math.round(px), Math.round(py), 1, 1); }
  for (const p of aq.food) { const [px, py] = P(p.p); ctx.fillStyle = p.c; ctx.fillRect(Math.round(px), Math.round(py), 2, 1); }
  ctx.restore();
  // glass
  ctx.strokeStyle = 'rgba(200,250,245,0.9)';
  ctx.lineWidth = 2;
  if (T.round) { ctx.beginPath(); ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2 + 2, (x1 - x0) / 2, (y0 - y1) / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
  else ctx.strokeRect(x0, y1, x1 - x0, y0 - y1);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x0 + (x1 - x0) * 0.1, y1 + 4, (x1 - x0) * 0.06, y0 - y1 - 8);
}
