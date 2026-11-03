// Far layers under the zoomed follow camera ("dolly zoom"): the sky, the sun and the horizon are far away, so when
// the camera moves in on the boat and the fish they barely grow and barely pan. Each biome's sky pass (drawAir /
// drawSky / drawAbove) and the Aero overlay's sky dressing (lens flare, corner branches) run under a sky transform:
//   zoom   zs = 1 + (z - 1) * SKY_ZOOM            (z = the camera's zoom)
//   pan    the sky centre follows the camera centre at SKY_PAN, clamped so the sky always covers the screen
//   lock   the horizon (the waterline) stays exactly where the near world draws it
// The sky gets an env copy with its own view rect and a scroll value that slides the sky composition down so the
// sun, clouds and arcs fit the shorter strip of sky above the zoomed waterline (the same parallax the old
// full-screen camera used while diving).

import { clamp } from '../core/math.js';

const SKY_ZOOM = 0.1;
const SKY_PAN = 0.3;
// oceans whose sky pass also paints near things that continue under the water (the fjord's cliff walls, the
// metropolis tower crowns): their sky stays locked to the world so above and below the waterline line up
const LOCKED = new Set(['fjord', 'metropolis']);

function horizonY(b) {
  const o = b.ocean;
  let y = null;
  try { y = o?.waterLevel?.(); } catch { y = null; }
  if (!Number.isFinite(y)) { try { y = b.surfY?.(); } catch { y = null; } }
  if (!Number.isFinite(y)) y = Number.isFinite(b.base) ? b.base : 0;
  return y;
}

// {xf: [zs, ox, oy], env} for biome b, or null when the camera is not zoomed (draw as before).
export function skyPass(b, env) {
  const g = b.game, cam = g?.camera;
  if (!cam?.open || !cam.xform || LOCKED.has(b.id) || b.zoomSky === false) return null;
  const [z, ox, oy] = cam.xform();
  if (z <= 1.001) return null;
  const W = g.screen.W, H = g.screen.H;
  const L = horizonY(b);
  const Ys = L * z + oy; // screen y of the horizon
  // dolly zoom, but never so little that the screen reaches above the top of the biome's sky
  const top = Number.isFinite(b.top) ? b.top : -Math.ceil(H * 0.74);
  const zs = Math.min(z, Math.max(1 + (z - 1) * SKY_ZOOM, Ys / Math.max(40, L - top - 2)));
  const vcx = (W / 2 - ox) / z; // world x at the screen centre
  const half = W / (2 * zs);
  const sx = clamp(W / 2 + (vcx - W / 2) * SKY_PAN, half, Math.max(half, W - half));
  const sox = Math.round(W / 2 - sx * zs + (cam.ox || 0)), soy = Math.round(Ys - L * zs);
  const view = { x0: -sox / zs, y0: -soy / zs, x1: (W - sox) / zs, y1: (H - soy) / zs, z: zs };
  const ref = Number.isFinite(env?.ref) ? env.ref : -Math.round(H * 0.62);
  // slide the sky down by what the old surface view showed above the waterline but this one cannot
  const slide = clamp(L - ref - Ys / zs, 0, -ref);
  return { xf: [zs, sox, soy], env: { ...env, view, scroll: ref + slide, ref, skyZoom: zs } };
}

// Run fn(skyEnv) under the sky transform (or fn(env) unchanged when the camera is not zoomed).
export function withSky(b, ctx, env, fn) {
  const S = skyPass(b, env);
  if (!S) return fn(env);
  const [zs, sox, soy] = S.xf;
  ctx.save();
  ctx.setTransform(zs, 0, 0, zs, sox, soy);
  try { return fn(S.env); } finally { ctx.restore(); }
}

// Wrap a biome's sky pass (idempotent). drawSky(ctx, env, y0) gets y0 recomputed for the sky view.
export function installZoomSky(b) {
  if (!b || b.__zoomSky) return;
  b.__zoomSky = true;
  for (const name of ['drawAir', 'drawSky', 'drawAbove']) {
    const fn = b[name];
    if (typeof fn !== 'function') continue;
    b[name] = function zoomSky(ctx, env, ...rest) {
      return withSky(b, ctx, env, (e) => {
        if (rest.length && Number.isFinite(rest[0]) && e !== env) rest[0] = Math.floor(e.view.y0) - 2;
        return fn.call(b, ctx, e, ...rest);
      });
    };
  }
}
