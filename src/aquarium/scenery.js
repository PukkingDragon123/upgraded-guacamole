// The thin white arc lines across the sky outside the aquarium room (2D light effect; all scenery itself is
// voxel, see roomvox.js).
//
//   paintArcs(P, w, h, u)    thin white arcs painted into a sky Paint

// ------------------------------------------------------------------ arcs

// Thin white concentric arcs sweeping across the middle of the sky.
export function paintArcs(P, w, h, u) {
  const c = P.c;
  const cx = w * 0.5, cy = h * 1.75;
  const n = 7;
  P.each(w * 0.22, 0, w * 0.8, h * 0.85, (x, y) => {
    const d = Math.hypot(x - cx, (y - cy) * 1.05);
    let a = 0;
    for (let i = 0; i < n; i++) {
      const R = h * (1.18 + i * 0.05);
      if (Math.abs(d - R) < 0.55 + u * 0.2) a = Math.max(a, 0.38 - i * 0.03);
    }
    if (!a) return 0;
    const fx = Math.min(1, (x - w * 0.22) / (w * 0.12), (w * 0.8 - x) / (w * 0.12));
    c[0] = 255; c[1] = 255; c[2] = 255;
    return a * fx;
  });
}

