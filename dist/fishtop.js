(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __glob = (map) => (path) => {
    var fn = map[path];
    if (fn) return fn();
    throw new Error("Module not found in bundle: " + path);
  };
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/core/canvas.js
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function ctxOf(canvas) {
    const g = canvas.getContext("2d", { willReadFrequently: false });
    g.imageSmoothingEnabled = false;
    return g;
  }
  var init_canvas = __esm({
    "src/core/canvas.js"() {
    }
  });

  // src/core/math.js
  function hashInt(x) {
    x |= 0;
    x = Math.imul(x ^ x >>> 16, 2146121005);
    x = Math.imul(x ^ x >>> 15, 2221713035);
    return (x ^ x >>> 16) >>> 0;
  }
  function hash2(x, y, seed = 0) {
    return hashInt(Math.floor(x) * 374761393 + Math.floor(y) * 668265263 + seed * 2246822519) / 4294967296;
  }
  function noise2(x, y, seed = 0) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }
  var TAU, clamp, clamp01, lerp, smoothstep, fract, smooth, BAYER4, bayer;
  var init_math = __esm({
    "src/core/math.js"() {
      TAU = Math.PI * 2;
      clamp = (v, a, b) => v < a ? a : v > b ? b : v;
      clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
      lerp = (a, b, t) => a + (b - a) * t;
      smoothstep = (a, b, v) => {
        const t = clamp01((v - a) / (b - a));
        return t * t * (3 - 2 * t);
      };
      fract = (v) => v - Math.floor(v);
      smooth = (t) => t * t * (3 - 2 * t);
      BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      bayer = (x, y) => BAYER4[(y & 3) * 4 + (x & 3)] / 16;
    }
  });

  // src/core/color.js
  function hexToRgb(hex) {
    let c = rgbCache.get(hex);
    if (c) return c;
    let h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    c = [n >> 16 & 255, n >> 8 & 255, n & 255];
    rgbCache.set(hex, c);
    return c;
  }
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = (h % 360 + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(h / 60 % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function hueToward(h, target, amount) {
    let d = (target - h + 540) % 360 - 180;
    const step = Math.sign(d) * Math.min(Math.abs(d), amount);
    return h + step;
  }
  function shade(hex, amount) {
    const [h, s, l] = hexToHsl(hex);
    if (amount < 0) {
      const a2 = -amount;
      return hslToHex(hueToward(h, 250, 28 * a2), clamp01(s + 0.08 * a2), clamp01(l * (1 - 0.75 * a2)));
    }
    const a = amount;
    return hslToHex(hueToward(h, 55, 22 * a), clamp01(s - 0.1 * a), clamp01(l + (1 - l) * 0.65 * a));
  }
  function ramp(hex, contrast = 1) {
    return [shade(hex, -0.62 * contrast), shade(hex, -0.3 * contrast), hex, shade(hex, 0.32 * contrast), shade(hex, 0.62 * contrast)];
  }
  function adjust(hex, { h = 0, s = 0, l = 0, sMul = 1, lMul = 1 } = {}) {
    const [H, S, L] = hexToHsl(hex);
    return hslToHex(H + h, clamp01(S * sMul + s), clamp01(L * lMul + l));
  }
  function invert(hex) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(255 - r, 255 - g, 255 - b);
  }
  function pack(hex, a = 255) {
    const [r, g, b] = hexToRgb(hex);
    return (a & 255) << 24 | b << 16 | g << 8 | r;
  }
  var rgbCache, toHex2, rgbToHex, hexToHsl, hslToHex;
  var init_color = __esm({
    "src/core/color.js"() {
      init_math();
      rgbCache = /* @__PURE__ */ new Map();
      toHex2 = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
      rgbToHex = (r, g, b) => "#" + toHex2(r) + toHex2(g) + toHex2(b);
      hexToHsl = (hex) => rgbToHsl(...hexToRgb(hex));
      hslToHex = (h, s, l) => rgbToHex(...hslToRgb(h, clamp01(s), clamp01(l)));
    }
  });

  // src/gfx/pixel.js
  var PixelBuffer;
  var init_pixel = __esm({
    "src/gfx/pixel.js"() {
      init_canvas();
      init_color();
      PixelBuffer = class {
        constructor(w, h) {
          this.w = Math.max(1, w | 0);
          this.h = Math.max(1, h | 0);
          this.data = new Uint32Array(this.w * this.h);
        }
        inBounds(x, y) {
          return x >= 0 && y >= 0 && x < this.w && y < this.h;
        }
        set(x, y, c) {
          x |= 0;
          y |= 0;
          if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
        }
        get(x, y) {
          x |= 0;
          y |= 0;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
          return this.data[y * this.w + x];
        }
        alpha(x, y) {
          return this.get(x, y) >>> 24;
        }
        rect(x, y, w, h, c) {
          for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
        }
        line(x0, y0, x1, y1, c) {
          x0 = Math.round(x0);
          y0 = Math.round(y0);
          x1 = Math.round(x1);
          y1 = Math.round(y1);
          const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
          const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
          let err = dx + dy;
          for (; ; ) {
            this.set(x0, y0, c);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) {
              err += dy;
              x0 += sx;
            }
            if (e2 <= dx) {
              err += dx;
              y0 += sy;
            }
          }
        }
        fillCircle(cx, cy, r, c) {
          const r2 = r * r;
          for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
              const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
              if (dx * dx + dy * dy <= r2) this.set(x, y, c);
            }
          }
        }
        fillEllipse(cx, cy, rx, ry, c) {
          for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
              const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
              if (dx * dx + dy * dy <= 1) this.set(x, y, c);
            }
          }
        }
        fillPoly(points, c) {
          let minY = Infinity, maxY = -Infinity;
          for (const p of points) {
            minY = Math.min(minY, p[1]);
            maxY = Math.max(maxY, p[1]);
          }
          for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
            const py = y + 0.5;
            const xs = [];
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
              const [xi, yi] = points[i], [xj, yj] = points[j];
              if (yi > py !== yj > py) xs.push(xi + (py - yi) * (xj - xi) / (yj - yi));
            }
            xs.sort((a, b) => a - b);
            for (let k = 0; k + 1 < xs.length; k += 2) {
              for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c);
            }
          }
        }
        // Outline every transparent pixel touching an opaque one. colorFn(neighbourColor) -> packed colour.
        outline(colorFn, diagonal = false) {
          const { w, h, data } = this;
          const src = data.slice();
          const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x];
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (src[y * w + x] >>> 24) continue;
              let n = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
              if (!n && diagonal) n = at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
              if (n && n >>> 24 > 40) data[y * w + x] = typeof colorFn === "function" ? colorFn(n) : colorFn;
            }
          }
        }
        toCanvas() {
          const c = makeCanvas(this.w, this.h);
          const g = ctxOf(c);
          const img = g.createImageData(this.w, this.h);
          new Uint32Array(img.data.buffer).set(this.data);
          g.putImageData(img, 0, 0);
          return c;
        }
      };
    }
  });

  // src/gfx/fishart.js
  function variantColor(hex, variant, role = "body") {
    if (!variant || !hex) return hex;
    let c = hex;
    if (variant.shiny) c = adjust(c, { h: variant.shinyHue ?? 150, sMul: 1.15 });
    switch (variant.mutation) {
      case "albino":
        c = role === "eye" ? "#ff5a7a" : mix(adjust(c, { sMul: 0.15 }), "#fff2f4", 0.7);
        break;
      case "melanistic":
        c = role === "eye" ? "#e8d26a" : adjust(c, { sMul: 0.55, lMul: 0.38 });
        break;
      case "neon":
        c = role === "eye" ? c : adjust(c, { sMul: 1.6, s: 0.25, lMul: 1.05, l: 0.05 });
        break;
      case "pastel":
        c = role === "eye" ? c : adjust(c, { sMul: 0.5, lMul: 0.55, l: 0.42 });
        break;
      case "golden": {
        const [, s, l] = hexToHsl(c);
        c = role === "eye" ? c : hslToHex(44 + (l - 0.5) * 20, 0.75 + s * 0.2, clamp(l * 0.9 + 0.12, 0.2, 0.9));
        break;
      }
      case "inverted":
        c = role === "eye" ? c : invert(c);
        break;
      case "ghost":
        c = role === "eye" ? "#9ef7ff" : mix(adjust(c, { sMul: 0.3 }), "#dff8ff", 0.55);
        break;
      case "crimson":
        c = role === "eye" ? c : adjust(c, { h: 0 - hexToHsl(c)[0] + 355, sMul: 1.2 });
        break;
      case "ocean":
        c = role === "eye" ? c : adjust(c, { h: 205 - hexToHsl(c)[0], sMul: 1 });
        break;
      default:
        break;
    }
    return c;
  }
  function compileLook(look, variant = null) {
    const b = look.body || {};
    const shape = { ...SHAPES[b.shape || "oval"], ...b };
    const col = look.col || {};
    const vc = (h, role) => variantColor(h, variant, role);
    const bodyHex = vc(col.body || "#ff9944");
    const backHex = vc(col.back || shade(col.body || "#ff9944", -0.25));
    const bellyHex = vc(col.belly || shade(col.body || "#ff9944", 0.45));
    const finHex = vc(col.fin || shade(col.body || "#ff9944", 0.1));
    const contrast = look.contrast ?? 1;
    const toRamp = (hex) => ramp(hex, contrast).map((h) => pack(h));
    const c = {
      kind: look.kind || "fish",
      look,
      variant,
      L: b.len ?? 16,
      H: b.h ?? 9,
      shape,
      hump: b.hump ?? 0,
      belly: b.belly ?? 0.05,
      wave: b.wave ?? 0.5,
      bodyR: toRamp(bodyHex),
      backR: toRamp(backHex),
      bellyR: toRamp(bellyHex),
      finR: toRamp(finHex),
      bodyHex,
      finHex,
      outline: col.outline ? pack(vc(col.outline)) : null,
      outlineHex: col.outline ? vc(col.outline) : shade(backHex, -0.75),
      alpha: look.translucent ? Math.round(255 * (look.translucent === true ? 0.5 : look.translucent)) : 255,
      finAlpha: look.finAlpha ?? 0.75,
      scales: look.scales ?? (b.len ?? 16) >= 18,
      shine: look.shine ?? true,
      patterns: (look.pattern || []).map((p) => ({ ...p, R: toRamp(vc(p.color || "#ffffff", "pattern")) })),
      tail: { type: "fork", len: (b.len ?? 16) * 0.38, spread: (b.h ?? 9) * 0.55, flap: 0.32, ...look.tail || {} },
      fins: [],
      eyes: [],
      mouth: { type: "small", v: 0.18, ...look.mouth || {} },
      extras: (look.extras || []).map((e) => ({ ...e })),
      glow: false
    };
    c.tail.R = toRamp(vc(look.tail?.color || finHex));
    c.mouth.R = toRamp(vc(look.mouth?.color || "#e86a7a"));
    const fin = (spec, slot) => {
      if (!spec || spec.type === "none") return;
      c.fins.push({
        slot,
        type: spec.type || "tri",
        from: spec.from ?? 0.3,
        to: spec.to ?? 0.65,
        h: spec.h ?? c.H * 0.4,
        lean: spec.lean ?? 0.6,
        R: toRamp(vc(spec.color || finHex)),
        rays: spec.rays ?? true,
        count: spec.count ?? 4
      });
    };
    fin(look.dorsal === void 0 ? { type: "tri" } : look.dorsal, "top");
    fin(look.anal === void 0 ? { type: "tri", from: 0.55, to: 0.78, h: c.H * 0.25 } : look.anal, "bottom");
    if (look.dorsal2) fin(look.dorsal2, "top");
    c.pectoral = look.pectoral === null ? null : {
      u: 0.34,
      v: 0.25,
      len: Math.max(2.5, c.H * 0.38),
      w: 0.42,
      angle: 0.5,
      ...look.pectoral || {}
    };
    if (c.pectoral) c.pectoral.R = toRamp(vc(look.pectoral?.color || finHex));
    const eye = { u: 0.17, v: -0.2, r: Math.max(1, c.H * 0.16), type: "normal", ...look.eye || {} };
    const eyeCol = vc(eye.color || "#1a1424", "eye");
    const irisCol = eye.iris ? vc(eye.iris, "eye") : null;
    c.eyes.push({ ...eye, pupil: pack(eyeCol), iris: irisCol ? pack(irisCol) : null, glowHex: eye.type === "glow" ? vc(eye.glow || "#9ffcff", "eye") : null });
    for (const e of look.moreEyes || []) {
      c.eyes.push({ type: "normal", ...e, pupil: pack(vc(e.color || eye.color || "#1a1424", "eye")), iris: e.iris ? pack(vc(e.iris, "eye")) : null, glowHex: e.type === "glow" ? vc(e.glow || "#9ffcff", "eye") : null });
    }
    for (const e of c.eyes) if (e.type === "glow") c.glow = true;
    for (const p of c.patterns) if (p.glow) c.glow = true;
    for (const e of c.extras) {
      if (e.color) e.P = pack(vc(e.color, "extra"));
      if (e.color2) e.P2 = pack(vc(e.color2, "extra"));
      if (e.glow) c.glow = true;
    }
    if (variant?.mutation === "neon") c.glow = true;
    if (variant?.mutation === "galaxy") {
      c.patterns.push({ type: "galaxy", R: toRamp("#2a1b55") });
    }
    if (variant?.pattern) {
      const pc = variant.patternColor || shade(bodyHex, variant.pattern === "spots" ? 0.5 : -0.45);
      c.patterns.push({ type: variant.pattern, color: pc, R: toRamp(pc), count: 3, size: 1.4, seed: variant.seed || 3 });
    }
    c.outlineP = c.outline ?? pack(c.outlineHex);
    return c;
  }
  function profile(c, u, inflate) {
    const s = c.shape;
    let peak = s.peak, nose = s.nose, tailW = s.tailW, taper = s.taper;
    if (inflate > 0) {
      peak = lerp(peak, 0.5, inflate);
      nose = lerp(nose, 2.4, inflate);
      tailW = lerp(tailW, 0.2, inflate);
      taper = lerp(taper, 1.6, inflate);
    }
    if (u < 0 || u > 1) return 0;
    if (u <= peak) {
      const t2 = u / peak;
      return Math.pow(1 - Math.pow(1 - t2, nose), 1 / nose);
    }
    const t = (u - peak) / (1 - peak);
    return tailW + (1 - tailW) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * t), taper);
  }
  function finShape(type, t, phase, count) {
    switch (type) {
      case "sail":
        return Math.pow(Math.sin(Math.PI * clamp01(t)), 0.6);
      case "spiky":
        return (0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * count))) * Math.sin(Math.PI * clamp01(t)) ** 0.3;
      case "long":
        return Math.min(1, t * 6, (1 - t) * 5);
      case "round":
        return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      case "wave":
        return Math.min(1, t * 6, (1 - t) * 5) * (0.75 + 0.25 * Math.sin(t * 9 - phase * TAU * 2));
      case "tri":
      default:
        return t < 0.28 ? t / 0.28 : Math.pow((1 - t) / 0.72, 0.85);
    }
  }
  function tailHit(type, a, b, TL, TS, base, phase) {
    if (a < -0.5) return false;
    const s = a / TL;
    if (s > 1.08) return false;
    const ab = Math.abs(b);
    switch (type) {
      case "none":
        return false;
      case "round": {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.sqrt(Math.max(0, s)) * 1.05;
        return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 2 * 0.25;
      }
      case "veil": {
        const edge = 1 + 0.1 * Math.sin(b * 1.3 + phase * TAU);
        if (s > edge) return false;
        const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.45) * 1.1;
        return ab <= outer;
      }
      case "truncate": {
        if (s > 1) return false;
        return ab <= base + (TS - base) * s;
      }
      case "lyre": {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.55);
        const inner = s < 0.35 ? -1 : (outer - 1.6) * smoothstep(0.35, 0.8, s);
        return ab <= outer && ab >= inner;
      }
      case "moon": {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.5);
        const inner = TS * 0.8 * Math.max(0, (s - 0.4) / 0.6) ** 1.4;
        return ab <= outer && ab >= inner;
      }
      case "pointed": {
        if (s > 1) return false;
        return ab <= base * (1 - s) + 0.4;
      }
      case "fan": {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.sqrt(Math.max(0, s));
        return ab <= outer && s <= 1 - (ab / (TS + 0.01)) ** 4 * 0.15;
      }
      case "fork":
      default: {
        if (s > 1) return false;
        const outer = base + (TS - base) * Math.pow(Math.max(0, s), 0.8);
        const inner = TS * 0.62 * Math.max(0, (s - 0.5) / 0.5);
        return ab <= outer && ab >= inner;
      }
    }
  }
  function rasterFish(c, p = {}) {
    switch (c.kind) {
      case "crab":
        return rasterCrab(c, p);
      case "jelly":
        return rasterJelly(c, p);
      case "pudding":
        return rasterPudding(c, p);
      case "seahorse":
        return rasterSeahorse(c, p);
      case "ray":
        return rasterRay(c, p);
      case "squid":
        return rasterSquid(c, p);
      case "isopod":
        return rasterIsopod(c, p);
      case "blob":
        return rasterBlob(c, p);
      case "iconfish":
        return rasterIconFish(c, p);
      default:
        return rasterGeneric(c, p);
    }
  }
  function makeXform(angle, scale, ox, oy) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    return {
      toLocal(px, py) {
        const dx = px + 0.5 - ox, dy = py + 0.5 - oy;
        return [(dx * ca + dy * sa) / scale, (-dx * sa + dy * ca) / scale];
      },
      toCanvas(lx, ly) {
        const x = lx * scale, y = ly * scale;
        return [ox + x * ca - y * sa, oy + x * sa + y * ca];
      }
    };
  }
  function boundsFor(extent, angle, scale) {
    const [x0, y0, x1, y1] = extent;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const X = (x * ca - y * sa) * scale, Y = (x * sa + y * ca) * scale;
      mnx = Math.min(mnx, X);
      mny = Math.min(mny, Y);
      mxx = Math.max(mxx, X);
      mxy = Math.max(mxy, Y);
    }
    const pad = 2;
    const w = Math.ceil(mxx - mnx) + pad * 2 + 1;
    const h = Math.ceil(mxy - mny) + pad * 2 + 1;
    return { w, h, ox: Math.floor(-mnx) + pad, oy: Math.floor(-mny) + pad };
  }
  function rampPick(R, b, x, y, dither = 0.85) {
    const idx = clamp(Math.floor(b * 4.999 + (bayer(x, y) - 0.5) * dither), 0, 4);
    return R[idx];
  }
  function rasterGeneric(c, p) {
    const phase = p.phase || 0;
    const scale = p.scale || 1;
    const angle = p.angle || 0;
    const inflate = p.inflate || 0;
    const L = c.L * (1 + 0.3 * inflate);
    const H = c.H * (1 + 1 * inflate);
    const halfL = L / 2;
    const TL = c.tail.type === "none" ? 0 : c.tail.len * (1 - 0.2 * inflate);
    const TS = c.tail.spread;
    const spikeLen = c.look.spikes ? c.look.spikes * inflate : 0;
    let maxFin = 0;
    for (const f of c.fins) maxFin = Math.max(maxFin, f.h);
    let exTop = 0, exFront = 0;
    for (const e of c.extras) {
      if (e.type === "lure") {
        exTop = Math.max(exTop, e.h ?? H * 0.9);
        exFront = Math.max(exFront, e.reach ?? L * 0.35);
      }
      if (e.type === "whiskers") exFront = Math.max(exFront, 2);
      if (e.type === "cap" || e.type === "antennae") exTop = Math.max(exTop, 4);
    }
    const extent = [
      -halfL - TL - 2,
      -H / 2 - maxFin - exTop - spikeLen - 2,
      halfL + exFront + 2,
      H / 2 + maxFin + spikeLen + 3
    ];
    if (c.pectoral) extent[3] = Math.max(extent[3], H / 2 + c.pectoral.len);
    const bb = boundsFor(extent, angle, scale);
    const buf = new PixelBuffer(bb.w, bb.h);
    const glow = c.glow ? new PixelBuffer(bb.w, bb.h) : null;
    const X = makeXform(angle, scale, bb.ox, bb.oy);
    const wave = c.wave * (p.still ? 0 : 1);
    const spine = (u) => wave * Math.sin(TAU * phase - u * 3.2) * u * u;
    const halfTop = (u) => H / 2 * profile(c, u, inflate) * (1 + c.hump * Math.sin(Math.PI * clamp01(u * 1.4)));
    const halfBot = (u) => H / 2 * profile(c, u, inflate) * (1 + c.belly * Math.sin(Math.PI * clamp01(u * 1.2)));
    const flapA = p.still ? 0 : Math.sin(TAU * phase + 0.7) * c.tail.flap;
    const fore = p.still ? 1 : 1 - 0.22 * Math.abs(Math.sin(TAU * phase + 0.7));
    const t0x = -halfL, t0y = spine(1);
    const tbx = -Math.cos(flapA), tby = Math.sin(flapA);
    const tpx = Math.sin(flapA), tpy = Math.cos(flapA);
    const tailBase = Math.max(0.8, halfTop(0.985) * 0.9);
    const pec = c.pectoral;
    let pecX = 0, pecY = 0, pecA = 0;
    if (pec) {
      pecX = halfL - pec.u * L;
      const hu = pec.u;
      pecY = spine(hu) + pec.v * halfBot(hu);
      pecA = pec.angle + (p.still ? 0 : Math.sin(TAU * phase * 2) * 0.45);
    }
    const eyes = c.eyes.map((e) => {
      const ex = halfL - e.u * L;
      const ey = spine(e.u) + e.v * (e.v < 0 ? halfTop(e.u) : halfBot(e.u));
      return { ...e, x: ex, y: ey, r: e.r * (1 + 0.15 * inflate) };
    });
    const mouthX = halfL, mouthY = spine(0) + c.mouth.v * (H / 2) * 0.6;
    const mouthOpen = p.mouth || 0;
    const alphaBody = c.alpha;
    const shiny = c.variant?.shiny;
    const blink = p.blink;
    const expr = p.expr || "normal";
    const sil = !!p.silhouette;
    for (let py = 0; py < bb.h; py++) {
      for (let px = 0; px < bb.w; px++) {
        const [lx, ly] = X.toLocal(px, py);
        let col = 0;
        let isBody = false;
        let glowCol = 0;
        const u = (halfL - lx) / L;
        if (u >= 0 && u <= 1) {
          const sy = spine(u);
          const top = halfTop(u), bot = halfBot(u);
          const ry = ly - sy;
          if (ry >= -top && ry <= bot) {
            isBody = true;
            const v = ry < 0 ? ry / Math.max(0.5, top) : ry / Math.max(0.5, bot);
            const d = bayer(px, py) - 0.5;
            let R = c.bodyR;
            if (v < -0.42 + d * 0.25) R = c.backR;
            else if (v > 0.3 + d * 0.25) R = c.bellyR;
            let light = 0.5 - v * 0.42 + (1 - u) * 0.06;
            if (v > 0.72) light -= 0.18;
            if (v < -0.8) light += 0.08;
            for (const pat of c.patterns) {
              const pr = patternHit(pat, u, v, lx, ly, L, H, phase, px, py);
              if (pr) {
                R = pat.R;
                if (pat.glow) glowCol = pat.R[3];
                if (pr === 2) light -= 0.25;
              }
            }
            if (c.scales && v > -0.6 && v < 0.55 && u > 0.22 && u < 0.92 && (px + (py >> 1) * 2 & 3) === 0 && (py & 1) === 0) light -= 0.2;
            col = rampPick(R, clamp01(light), px, py);
            if (c.shine && v > -0.78 && v < -0.5 && u > 0.18 && u < 0.5 && (px + py & 1) === 0) col = R[4];
            const gu = (eyes[0]?.u ?? 0.17) + 0.13;
            if (L >= 13 && Math.abs(u - gu - v * v * 0.04) < 0.5 / L && v > -0.55 && v < 0.6) col = R[1];
            if (alphaBody < 255) {
              col = col & 16777215 | alphaBody << 24;
            }
            if (c.look.organs) {
              const oc = organHit(c, u, v, phase, lx, ly, L, H);
              if (oc) col = oc;
            }
            if (Math.abs(ry - mouthY + sy) < 0.6 + mouthOpen * 1.2 && u < 0.05 + mouthOpen * 0.06 && c.mouth.type !== "none") {
              col = mouthOpen > 0.3 ? pack("#2a0f1c") : c.mouth.R[1];
              if (mouthOpen > 0.3 && Math.abs(ry - mouthY + sy) < 0.5 && u < 0.04) col = 0;
            }
            if (c.mouth.type === "beak" && u < 0.12 && v > -0.2) col = rampPick(c.mouth.R, 0.65 - v * 0.2, px, py);
            if (c.mouth.type === "lips" && u < 0.05 && Math.abs(ry - mouthY + sy) < 1.6) col = c.mouth.R[2];
            if (c.mouth.type === "big" && u < 0.32 && Math.abs(ry - (mouthY - sy) - u * 2) < 0.55) col = pack("#1b0c14");
            if (c.mouth.type === "fangs" && u < 0.2 && Math.abs(ry - (mouthY - sy)) < 0.55) col = pack("#1b0c14");
          }
        }
        if (isBody) {
          for (const e of c.extras) {
            const r = extraOnBody(e, u, ly - spine(u), lx, ly, L, H, halfTop(u), halfBot(u), px, py, phase);
            if (r) {
              col = r;
              if (e.glow) glowCol = r;
            }
          }
        }
        if (pec) {
          const dx = lx - pecX, dy = ly - pecY;
          const ca = Math.cos(pecA), sa = Math.sin(pecA);
          const a = -(dx * ca - dy * sa);
          const b = dx * sa + dy * ca;
          if (a >= -0.3 && a <= pec.len) {
            const s = a / pec.len;
            const wdt = pec.len * pec.w * Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2)) * (s < 0.5 ? 1 : 1);
            if (Math.abs(b) <= wdt + 0.3) {
              const ray = (Math.floor(b * 1.3 + s * 2) & 1) === 0;
              const fc = pec.R[ray ? 2 : 3];
              col = isBody ? blendPacked(col, fc, c.finAlpha) : fc & 16777215 | Math.round(255 * Math.min(1, c.finAlpha + 0.2)) << 24;
              if (!isBody) isBody = true;
            }
          }
        }
        for (const e of eyes) {
          const dx = lx - e.x, dy = ly - e.y;
          const d2 = dx * dx + dy * dy;
          const er = e.r;
          if (d2 > (er + 0.9) ** 2) continue;
          const ec = eyePixel(e, dx, dy, er, px, py, blink, expr, c);
          if (ec !== null) {
            col = ec;
            isBody = true;
            if (e.type === "glow" && ec) glowCol = ec;
          }
        }
        if (!col) {
          for (const f of c.fins) {
            const lean = f.lean;
            const top = f.slot === "top";
            const uu = (halfL - lx) / L;
            const edgeY0 = top ? spine(clamp01(uu)) - halfTop(clamp01(uu)) : spine(clamp01(uu)) + halfBot(clamp01(uu));
            const dist = top ? edgeY0 - ly : ly - edgeY0;
            if (dist < -1 || dist > f.h + 0.5) continue;
            const ue = uu - lean * Math.max(0, dist) / L;
            const t = (ue - f.from) / (f.to - f.from);
            if (t < 0 || t > 1) continue;
            const fh = f.h * finShape(f.type, t, phase, f.count) * (p.still ? 1 : 1 + 0.08 * Math.sin(TAU * phase * 2 - t * 6));
            if (dist <= fh) {
              const ray = f.rays && (Math.floor(t * f.count * 2.2) & 1) === 0;
              col = f.R[ray ? 2 : 3];
              if (dist > fh - 1.2) col = f.R[ray ? 3 : 4];
              col = col & 16777215 | Math.round(255 * Math.min(1, c.finAlpha + 0.25)) << 24;
              break;
            }
          }
        }
        if (!col && TL > 0) {
          const dx = lx - t0x, dy = ly - t0y;
          const a = (dx * tbx + dy * tby) / fore;
          const b = dx * tpx + dy * tpy;
          if (tailHit(c.tail.type, a + 0.6, b, TL, TS, tailBase, phase)) {
            const s = a / TL;
            const ang = Math.atan2(b, a + 2);
            const ray = (Math.floor(ang * 5) & 1) === 0;
            col = c.tail.R[ray ? 2 : 3];
            if (s > 0.82) col = c.tail.R[ray ? 3 : 4];
            if (s < 0.12) col = c.tail.R[1];
            col = col & 16777215 | Math.round(255 * Math.min(1, c.finAlpha + 0.25)) << 24;
          }
        }
        if (!col && spikeLen > 0.3) {
          const nx = lx / (L / 2), ny = ly / (H / 2);
          const rn = Math.hypot(nx, ny);
          const avgR = (L / 2 + H / 2) / 2;
          const d = (rn - 1) * avgR;
          if (d > -0.5 && d < spikeLen) {
            const ang = Math.atan2(ny, nx);
            const N = 14;
            const k = Math.round(ang / TAU * N);
            const da = Math.abs(ang - k * TAU / N) * avgR;
            if (da < (1 - d / spikeLen) * 1.1 + 0.2) col = c.bodyR[d > spikeLen * 0.6 ? 4 : 3];
          }
        }
        if (!col) {
          for (const e of c.extras) {
            const r = extraFree(e, lx, ly, L, H, halfL, phase, p);
            if (r) {
              col = r;
              if (e.glow) glowCol = r;
              break;
            }
          }
        }
        if (col) {
          if (sil) col = 4278190080 | 3350544;
          buf.data[py * bb.w + px] = col;
          if (glow && glowCol) glow.data[py * bb.w + px] = glowCol;
        }
      }
    }
    if (!sil) {
      const outlineAlpha = c.alpha < 255 ? Math.min(255, c.alpha + 90) : 255;
      const oc = c.outlineP & 16777215 | outlineAlpha << 24;
      buf.outline(() => oc);
      if (c.variant?.mutation === "neon" && glow) {
        const rim = pack(shade(c.bodyHex, 0.5));
        for (let i = 0; i < buf.data.length; i++) if (buf.data[i] === oc) glow.data[i] = rim;
      }
    } else {
      buf.outline(() => 4278190080 | 2233608);
    }
    const [mx, my] = X.toCanvas(mouthX + 0.5, mouthY);
    const [tx, ty] = X.toCanvas(-halfL - TL * 0.8, spine(1));
    const [hx, hy] = X.toCanvas(halfL * 0.2, -H / 2 - maxFin * 0.6);
    const [bx, by] = X.toCanvas(0, H / 2);
    const anchors = {
      mouth: [mx, my],
      tail: [tx, ty],
      top: [hx, hy],
      bottom: [bx, by],
      eyes: eyes.map((e) => {
        const [ex, ey] = X.toCanvas(e.x, e.y);
        return { x: ex, y: ey, r: e.r * scale, type: e.type };
      })
    };
    for (const e of c.extras) {
      if (e.type === "lure") {
        const [lx2, ly2] = lureTip(e, L, H, halfL, phase, p);
        const [cx2, cy2] = X.toCanvas(lx2, ly2);
        anchors.lure = [cx2, cy2];
      }
      if (e.type === "briefcase") {
        const [cx2, cy2] = X.toCanvas(halfL * 0.25, H / 2 + 0.5);
        anchors.hand = [cx2, cy2];
      }
    }
    if (shiny) anchors.shiny = true;
    return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, ox: bb.ox, oy: bb.oy, anchors, w: bb.w, h: bb.h };
  }
  function blendPacked(a, b, t) {
    const ar = a & 255, ag = a >>> 8 & 255, ab = a >>> 16 & 255;
    const br = b & 255, bg = b >>> 8 & 255, bb2 = b >>> 16 & 255;
    const r = ar + (br - ar) * t, g = ag + (bg - ag) * t, bl = ab + (bb2 - ab) * t;
    const al = Math.max(a >>> 24, b >>> 24);
    return (al << 24 | Math.round(bl) << 16 | Math.round(g) << 8 | Math.round(r)) >>> 0;
  }
  function patternHit(pat, u, v, lx, ly, L, H, phase, px, py) {
    switch (pat.type) {
      case "bands": {
        for (const at of pat.at || [0.4]) {
          const w = (pat.width ?? 0.08) * (1 - 0.15 * v * v);
          const wav = (pat.wavy ?? 0.02) * Math.sin(v * 4);
          if (Math.abs(u - at - wav) < w) {
            if (pat.edge && Math.abs(Math.abs(u - at - wav) - w) < 0.9 / L) return 2;
            return 1;
          }
        }
        return 0;
      }
      case "stripes": {
        for (const at of pat.at || [0]) if (Math.abs(v - at) < (pat.width ?? 0.15) && u > (pat.from ?? 0.1) && u < (pat.to ?? 0.95)) return 1;
        return 0;
      }
      case "spots": {
        const sz = pat.size ?? 1.5;
        const cell = sz * 3.2;
        const cx = Math.floor(lx / cell), cy = Math.floor(ly / cell);
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const hx = cx + i, hy = cy + j;
          if (hash2(hx, hy, pat.seed ?? 7) > (pat.density ?? 0.55)) continue;
          const ox = (hx + 0.2 + hash2(hx, hy, 11) * 0.6) * cell;
          const oy = (hy + 0.2 + hash2(hx, hy, 13) * 0.6) * cell;
          const r = sz * (0.7 + 0.5 * hash2(hx, hy, 17));
          if ((lx - ox) ** 2 + (ly - oy) ** 2 < r * r) return pat.only === "top" && v > 0.2 ? 0 : 1;
        }
        return 0;
      }
      case "patches": {
        const n = noise2(lx * (pat.freq ?? 0.22) + (pat.seed ?? 3) * 9.1, ly * (pat.freq ?? 0.22));
        return n > (pat.threshold ?? 0.58) ? 1 : 0;
      }
      case "gradient": {
        const t = pat.dir === "v" ? (v + 1) / 2 : u;
        return t + (bayer(px, py) - 0.5) * 0.15 > (pat.from ?? 0.55) ? 1 : 0;
      }
      case "checker": {
        const s = pat.size ?? 2;
        return (Math.floor(lx / s) + Math.floor(ly / s) & 1) === 0 && u > 0.2 ? 1 : 0;
      }
      case "mask":
        return Math.abs(u - (pat.at ?? 0.18)) < (pat.width ?? 0.09) && v < 0.35 ? 1 : 0;
      case "face":
        return u < (pat.to ?? 0.3) ? 1 : 0;
      case "tailend":
        return u > (pat.from ?? 0.8) ? 1 : 0;
      case "suit":
        return u < 0.42 && u > 0.08 && v > -0.05 + (u - 0.08) * 0.4 ? 1 : 0;
      case "lines": {
        const k = pat.count ?? 5;
        const t = fract(u * k + Math.sin(v * 3) * 0.08);
        return t < (pat.width ?? 0.18) && u > 0.15 ? 1 : 0;
      }
      case "circuit": {
        const gx = Math.floor(lx / 3), gy = Math.floor(ly / 3);
        const hx = hash2(gx, gy, 5);
        const onLine = Math.abs(ly - gy * 3 - 1.5) < 0.5 && hx < 0.45 || Math.abs(lx - gx * 3 - 1.5) < 0.5 && hx > 0.75;
        return onLine && u > 0.2 ? 1 : 0;
      }
      case "galaxy": {
        const st = hash2(Math.floor(lx * 1.3 + 50), Math.floor(ly * 1.3 + 50), 77);
        return st > 0.94 ? 0 : 1;
      }
      case "glowspots": {
        const k = pat.count ?? 5;
        for (let i = 0; i < k; i++) {
          const su = 0.2 + i / k * 0.7, sv = pat.v ?? 0.55;
          if (Math.abs(u - su) * L < 0.8 && Math.abs(v - sv) < 0.22) return 1;
        }
        return 0;
      }
      case "belt":
        return Math.abs(v - (pat.at ?? 0.3)) < (pat.width ?? 0.12) ? 1 : 0;
      case "rust": {
        const n = noise2(lx * 0.35 + 3.3, ly * 0.35 + 1.7);
        return n > (pat.threshold ?? 0.62) ? 1 : 0;
      }
      case "zigzag": {
        const t = fract(u * (pat.count ?? 4));
        return Math.abs(v - (Math.abs(t - 0.5) * 2 - 0.5) * 0.9) < (pat.width ?? 0.14) ? 1 : 0;
      }
      case "chevron": {
        const k = pat.count ?? 3;
        const t = fract(u * k - Math.abs(v) * 0.25);
        return t < (pat.width ?? 0.22) && u > 0.18 ? 1 : 0;
      }
      default:
        return 0;
    }
  }
  function organHit(c, u, v, phase, lx, ly, L, H) {
    const o = c.look.organs;
    if (Math.abs(v - 0.02) < 0.09 && u > 0.12 && u < 0.98) return pack(o.bone || "#f4f1ff", 230);
    if (u > 0.28 && u < 0.78 && Math.abs(fract(u * L / 2.2) - 0.5) < 0.18 && Math.abs(v) < 0.6 && Math.abs(v) > 0.12) return pack(o.bone || "#f4f1ff", 170);
    const pulse = 0.5 + 0.5 * Math.sin(phase * TAU * 2);
    if ((u - 0.27) ** 2 * L * L + (v - 0.42) ** 2 * H * H * 0.25 < 1.2 + pulse) return pack("#ff4466", 255);
    if ((u - 0.45) ** 2 * L * L * 0.4 + (v - 0.32) ** 2 * H * H * 0.25 < 2.2) return pack(o.stomach || "#9ad66b", 230);
    if ((u - 0.1) ** 2 * L * L + (v + 0.35) ** 2 * H * H * 0.25 < 0.9) return pack("#ffb3d0", 220);
    return 0;
  }
  function eyePixel(e, dx, dy, r, px, py, blink, expr, c) {
    const d = Math.hypot(dx, dy);
    if (e.type === "dot" || r < 1.2) {
      if (blink) return Math.abs(dy) < 0.5 && Math.abs(dx) < 1 ? c.bodyR[0] : null;
      if (d <= 0.75) return e.pupil;
      return null;
    }
    if (e.type === "glow") {
      if (d > r + 0.4) return null;
      if (blink) return Math.abs(dy) < 0.6 ? c.bodyR[0] : null;
      const g = e.glowHex;
      return d < r * 0.45 ? pack("#ffffff") : pack(g);
    }
    if (d > r + 0.45) return null;
    if (blink || expr === "sleep") {
      if (Math.abs(dy - (expr === "sleep" ? 0.4 : 0)) < 0.55 && Math.abs(dx) < r) return c.bodyR[0];
      return c.bodyR[1];
    }
    if (expr === "happy") {
      const yy = -Math.abs(dx) * 0.7 + 0.3;
      if (Math.abs(dy - yy) < 0.6 && Math.abs(dx) < r) return c.bodyR[0];
      return c.bodyR[2];
    }
    if (expr === "dizzy") {
      if ((Math.abs(dx - dy) < 0.6 || Math.abs(dx + dy) < 0.6) && d < r) return pack("#1a1424");
      return pack("#ffffff");
    }
    const sclera = pack(e.sclera || "#ffffff");
    const rimC = pack("#d8e4f0");
    if (e.type === "googly") {
      if (d > r - 0.55) return pack("#1a1424");
      return d > r - 1.4 && dy > 0 ? rimC : sclera;
    }
    let pr = r * (e.pupilSize ?? 0.55);
    let pxo = r * 0.28, pyo = r * 0.05;
    if (expr === "shock") {
      pr = Math.max(0.6, r * 0.25);
      pxo = 0;
      pyo = 0;
    }
    const pd = Math.hypot(dx - pxo, dy - pyo);
    if (e.iris && pd <= pr + 0.9 && expr !== "shock") {
      if (pd <= pr * 0.6) return e.pupil;
      if (Math.abs(dx - pxo + pr * 0.45) < 0.6 && Math.abs(dy - pyo + pr * 0.45) < 0.6) return pack("#ffffff");
      return e.iris;
    }
    if (pd <= pr) {
      if (r >= 2 && Math.abs(dx - pxo + pr * 0.5) < 0.55 && Math.abs(dy - pyo + pr * 0.5) < 0.55) return pack("#ffffff");
      return e.pupil;
    }
    if (expr === "angry" && dy < -r * 0.25 && dy < -dx * 0.6 - r * 0.1) return c.bodyR[1];
    if (d > r - 0.5 && r >= 2.4) return dy > 0 ? rimC : sclera;
    return sclera;
  }
  function extraOnBody(e, u, ry, lx, ly, L, H, top, bot, px, py, phase) {
    switch (e.type) {
      case "tie": {
        const cu = e.u ?? 0.24;
        const du = (u - cu) * L;
        const v = ry / Math.max(0.5, bot);
        if (ry > 0 && v < 1.05) {
          const t = v;
          const wdt = t < 0.25 ? 0.9 : 0.6 + (t - 0.25) * 1.6 * (t < 0.75 ? 1 : (1 - t) * 3);
          if (Math.abs(du) <= wdt) return t < 0.25 ? e.P2 || e.P : Math.abs(du) > wdt - 0.6 ? e.P2 || e.P : e.P;
        }
        return 0;
      }
      case "bolts": {
        const gx = Math.round(lx / 4) * 4, gy = Math.round(ly / 4) * 4;
        if (hash2(gx, gy, 9) > 0.55 && Math.abs(lx - gx) < 0.5 && Math.abs(ly - gy) < 0.5 && u > 0.18) return e.P || pack("#d8dde6");
        return 0;
      }
      case "scar": {
        if (Math.abs((u - (e.u ?? 0.5)) * L - ry * 0.6) < 0.5 && Math.abs(ry) < top * 0.7) return e.P || pack("#f3d6d0");
        return 0;
      }
      case "mustache": {
        const v = ry / Math.max(0.5, bot);
        if (u < 0.16 && u > 0.02 && Math.abs(v - (e.v ?? 0.15) - Math.sin(u * 40) * 0.05) < 0.16) return e.P || pack("#3a2410");
        return 0;
      }
      case "blush": {
        if (Math.abs(u - (e.u ?? 0.24)) * L < 1.1 && Math.abs(ry / Math.max(0.5, bot) - 0.15) < 0.18) return e.P || pack("#ff8fa8");
        return 0;
      }
      case "screen": {
        if ((py & 1) === 0) return e.P || pack("#0a3a1f", 200);
        return 0;
      }
      default:
        return 0;
    }
  }
  function lureTip(e, L, H, halfL, phase, p) {
    const sway = p.still ? 0 : Math.sin(phase * TAU) * 0.8;
    const reach = e.reach ?? L * 0.35;
    const h = e.h ?? H * 0.9;
    return [halfL - L * 0.12 + reach + sway * 0.4, -H / 2 - h * 0.55 + sway];
  }
  function extraFree(e, lx, ly, L, H, halfL, phase, p) {
    switch (e.type) {
      case "lure": {
        const sx = halfL - L * 0.15, sy = -H * 0.42;
        const [tx, ty] = lureTip(e, L, H, halfL, phase, p);
        const cx = sx - 1, cy = ty - 2;
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const bx = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t * t * tx;
          const by = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t * t * ty;
          if (Math.abs(lx - bx) < 0.55 && Math.abs(ly - by) < 0.55) return e.P || pack("#5a5f70");
        }
        return 0;
      }
      case "whiskers": {
        for (const side of [0, 1]) {
          for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            const bx = halfL - 0.5 - t * (e.len ?? 5) * 0.6;
            const by = H * 0.1 + t * (e.len ?? 5) * (0.5 + side * 0.25) + Math.sin(phase * TAU + t * 3) * t * 0.8;
            if (Math.abs(lx - bx) < 0.5 && Math.abs(ly - by) < 0.5) return e.P || pack("#3b2a22");
          }
        }
        return 0;
      }
      case "antennae": {
        for (const off of [0, 1.5]) {
          for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            const bx = halfL - L * 0.2 - off + t * 2.5;
            const by = -H * 0.4 - t * 4 + Math.sin(phase * TAU + off) * t * 0.6;
            if (Math.abs(lx - bx) < 0.5 && Math.abs(ly - by) < 0.5) return t > 0.85 ? e.P2 || pack("#ff5577") : e.P || pack("#333344");
          }
        }
        return 0;
      }
      case "cap": {
        const cx = halfL - L * (e.u ?? 0.3), cy = -H * 0.48;
        const dx = lx - cx, dy = ly - cy;
        if (dy < 0.5 && dy > -2.6 && Math.abs(dx) < 2.6 + (dy > -0.5 ? 0.6 : 0)) {
          if (dy > -0.5 && (Math.floor(lx) & 1) === 0) return e.P2 || pack("#c0c6d2");
          return e.P || pack("#d93a3a");
        }
        return 0;
      }
      default:
        return 0;
    }
  }
  function finish(buf, glow, ox, oy, anchors, outlineP) {
    buf.outline(() => outlineP);
    return { canvas: buf.toCanvas(), glowCanvas: glow ? glow.toCanvas() : null, ox, oy, anchors, w: buf.w, h: buf.h };
  }
  function rasterCrab(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const L = c.L, H = c.H;
    const w = Math.ceil(L * s + 10 * s), h = Math.ceil(H * s + 10 * s);
    const buf = new PixelBuffer(w, h);
    const ox = Math.floor(w / 2), oy = Math.floor(h * 0.55);
    const R = c.bodyR, F = c.finR, B = c.bellyR;
    const shell = c.look.shell || "round";
    const walk = p.still ? 0 : phase * TAU;
    const bob = Math.round(Math.sin(walk * 2) * 0.6 * s);
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const lx0 = ox + side * (L * 0.18 + i * L * 0.07) * s;
        const ph = walk + i * 1.3 + (side > 0 ? Math.PI : 0);
        const lift = Math.max(0, Math.sin(ph)) * 1.5 * s;
        const kx = lx0 + side * (L * 0.16) * s;
        const ky = oy - 1 * s - lift + bob;
        const fx = lx0 + side * (L * 0.28 + Math.cos(ph) * 1.2) * s;
        const fy = oy + H * 0.45 * s - lift * 0.5;
        buf.line(lx0, oy + bob, kx, ky, R[1]);
        buf.line(kx, ky, fx, fy, R[1]);
      }
    }
    const cx = ox, cy = oy - H * 0.15 * s + bob;
    const rx = L / 2 * s, ry = H / 2 * s;
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        let inside;
        if (shell === "mouse") inside = ny < 0.55 && nx * nx / 1 + ny * ny / (ny < 0 ? 1 : 0.35) <= 1;
        else if (shell === "mech") inside = Math.abs(nx) < 0.95 && ny > -0.95 && ny < 0.55 && !(Math.abs(nx) > 0.7 && ny < -0.6);
        else inside = ny < 0.55 && nx * nx + ny * ny <= 1;
        if (!inside) continue;
        const light = 0.55 - ny * 0.45 - nx * 0.08;
        let col = rampPick(R, clamp01(light), x, y);
        if (ny > 0.25) col = rampPick(B, clamp01(light), x, y);
        if (shell === "mouse") {
          if (Math.abs(nx - 0.25) < 0.6 / rx && ny < -0.15) col = R[0];
          if (Math.abs(nx - 0.25) < 1.2 / rx && Math.abs(ny + 0.55) < 0.22) col = pack("#555a66");
          if (ny > -0.15 && ny < -0.05) col = R[1];
        }
        if (shell === "mech") {
          if ((Math.abs(nx) > 0.82 || ny < -0.85) && hash2(x, y, 3) > 0.5) col = pack("#c9cfd8");
          if (Math.abs(ny + 0.3) < 0.08) col = R[0];
          if (Math.hypot(nx + 0.4, ny + 0.45) < 0.12 || Math.hypot(nx - 0.4, ny + 0.45) < 0.12) col = pack("#e6ebf2");
        }
        buf.set(x, y, col);
      }
    }
    if (shell === "mouse") {
      let tx = cx - rx, ty = cy + ry * 0.2;
      for (let i = 0; i < 9 * s; i++) {
        const nx2 = tx - 1, ny2 = ty + Math.sin(i * 0.7 + walk) * 0.8;
        buf.line(tx, ty, nx2, ny2, pack("#3d3f4a"));
        tx = nx2;
        ty = ny2;
      }
    }
    const clawOpen = p.mouth ? 1 : 0.3 + 0.3 * Math.sin(walk * 0.5);
    for (const side of [1, -0.6]) {
      const ax = cx + side * rx * 0.8, ay = cy + ry * 0.2;
      const hx = ax + side * 3 * s, hy = ay - 3 * s;
      buf.line(ax, ay, hx, hy, R[1]);
      const cr = (side > 0 ? 2.2 : 1.6) * s;
      buf.fillCircle(hx + side * cr * 0.6, hy - cr * 0.4, cr, F[3]);
      const gx = hx + side * cr * 1.2, gy = hy - cr * 0.4;
      buf.line(gx - side * cr * 0.8, gy, gx + side * 0.2, gy - clawOpen * 1.5 * s, 0);
      buf.set(Math.round(hx + side * cr * 0.4), Math.round(hy - cr * 0.9), F[4]);
    }
    const eyes = [];
    for (const side of [0.25, -0.05]) {
      const ex = cx + rx * side + rx * 0.3, ey = cy - ry - 2.5 * s;
      buf.line(ex, cy - ry * 0.8, ex, ey + 1, R[1]);
      if (p.blink) buf.line(ex - 1, ey, ex + 1, ey, R[0]);
      else {
        buf.fillCircle(ex + 0.5, ey + 0.5, 1.4 * s, pack("#ffffff"));
        buf.set(Math.round(ex + 0.5 * s), Math.round(ey), c.eyes[0].pupil);
      }
      eyes.push({ x: ex + 0.5, y: ey + 0.5, r: 1.4 * s, type: "stalk" });
    }
    if (c.look.mustache) {
      buf.line(cx + rx * 0.5, cy + ry * 0.05, cx + rx * 0.95, cy + ry * 0.1, pack("#2a1810"));
      buf.line(cx + rx * 0.45, cy + ry * 0.12, cx + rx * 0.2, cy + ry * 0.2, pack("#2a1810"));
    }
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    return finish(buf, null, ox, oy, { mouth: [cx + rx + 3 * s, cy - 2 * s], top: [cx, cy - ry - 5 * s], tail: [cx - rx, cy], bottom: [cx, oy + H * 0.45 * s], eyes }, c.outlineP);
  }
  function rasterJelly(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const L = c.L, H = c.H;
    const pulse = p.still ? 0 : Math.sin(phase * TAU);
    const bw = L / 2 * (1 + 0.12 * pulse) * s;
    const bh = H * 0.55 * (1 - 0.12 * pulse) * s;
    const tl = (c.look.tentacles ?? H * 1.3) * s;
    const w = Math.ceil(bw * 2 + 8), h = Math.ceil(bh + tl + 8);
    const buf = new PixelBuffer(w, h);
    const glow = new PixelBuffer(w, h);
    const ox = Math.floor(w / 2), oy = Math.ceil(bh + 3);
    const R = c.bodyR, F = c.finR;
    const a = c.alpha;
    const n = c.look.tentacleCount ?? 5;
    for (let i = 0; i < n; i++) {
      const tx0 = ox + ((i + 0.5) / n * 2 - 1) * bw * 0.8;
      let lx = tx0, ly = oy;
      for (let k = 1; k <= tl; k++) {
        const t = k / tl;
        const x = tx0 + Math.sin(phase * TAU + i * 1.7 + t * 4) * 2 * t * s;
        const y = oy + k;
        buf.line(lx, ly, x, y, F[t > 0.7 ? 3 : 2] & 16777215 | Math.round(a * (1 - t * 0.5)) << 24);
        lx = x;
        ly = y;
      }
    }
    for (let k = 0; k < tl * 0.6; k++) {
      const x = ox + Math.sin(phase * TAU * 1.3 + k * 0.5) * 1.5 * s;
      buf.set(x, oy + k, F[3]);
      buf.set(x + 1, oy + k, F[4] & 16777215 | 180 << 24);
    }
    for (let y = Math.floor(oy - bh - 1); y <= oy + 1; y++) {
      for (let x = Math.floor(ox - bw - 1); x <= ox + bw + 1; x++) {
        const nx = (x + 0.5 - ox) / bw, ny = (y + 0.5 - oy) / bh;
        if (ny > 0.05 || nx * nx + ny * ny > 1) continue;
        const rim = nx * nx + ny * ny > 0.72;
        let col = rampPick(R, clamp01(0.55 - ny * 0.25 - Math.abs(nx) * 0.2), x, y);
        if (rim) col = R[3];
        if (ny > -0.15) col = R[4];
        for (let k = 0; k < 4; k++) {
          const ang = k / 4 * Math.PI + Math.PI / 8;
          const cxk = Math.cos(ang) * 0.45, cyk = -0.35 - Math.sin(ang) * 0.1;
          if (Math.hypot(nx - cxk * 0.9, (ny - cyk) * 1.3) < 0.18) col = pack(c.look.gonad || "#ff9fd6");
        }
        const al = rim ? Math.min(255, a + 60) : a;
        buf.set(x, y, col & 16777215 | al << 24);
        if (rim || ny > -0.15) glow.set(x, y, R[4]);
      }
    }
    const ey = oy - bh * 0.45;
    if (!c.look.noFace) {
      if (p.blink) {
        buf.set(ox - 2 * s, ey, R[0]);
        buf.set(ox + 2 * s, ey, R[0]);
      } else {
        buf.rect(ox - 2 * s - 1, ey - 1, 1 * s, 2 * s, pack("#1a1424"));
        buf.rect(ox + 2 * s, ey - 1, 1 * s, 2 * s, pack("#1a1424"));
      }
      buf.set(ox - 3 * s, ey + 2, pack("#ff7aa8"));
      buf.set(ox + 3 * s, ey + 2, pack("#ff7aa8"));
    }
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    const outline = c.outlineP & 16777215 | Math.min(255, a + 80) << 24;
    return finish(buf, glow, ox, oy - bh * 0.4, { mouth: [ox, oy + 2], top: [ox, oy - bh - 2], tail: [ox, oy + tl], bottom: [ox, oy + tl * 0.5], eyes: [] }, outline);
  }
  function rasterPudding(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const L = c.L, H = c.H;
    const wob = p.still ? 0 : Math.sin(phase * TAU * 2);
    const sq = p.squash || 0;
    const w = Math.ceil(L * s * 1.5 + 10), h = Math.ceil(H * s * 1.6 + 10);
    const buf = new PixelBuffer(w, h);
    const ox = Math.floor(w / 2), base = Math.floor(h - 4);
    const hh = H * s * (1 - 0.08 * wob - sq * 0.2);
    const botW = L / 2 * s * (1 + 0.05 * wob + sq * 0.2);
    const topW = botW * 0.68;
    const R = c.bodyR;
    const caramel = c.finR;
    const skew = wob * 1.2 * s;
    for (let y = Math.floor(base - hh - 2); y <= base; y++) {
      const t = (base - y) / hh;
      if (t > 1.02) continue;
      const half = lerp(botW, topW, t) - (t > 0.9 ? (t - 0.9) * 8 : 0);
      const cxr = ox + skew * t;
      for (let x = Math.floor(cxr - half - 1); x <= cxr + half + 1; x++) {
        const nx = (x + 0.5 - cxr) / Math.max(1, half);
        if (Math.abs(nx) > 1) continue;
        let col = rampPick(R, clamp01(0.62 - nx * 0.3 + t * 0.15), x, y);
        if (t > 0.72 + Math.sin(nx * 5 + phase * TAU) * 0.05) col = rampPick(caramel, clamp01(0.55 - nx * 0.3 + (t - 0.72) * 0.8), x, y);
        if (nx < -0.55 && nx > -0.75 && t > 0.2 && t < 0.65) col = R[4];
        buf.set(x, y, col);
      }
    }
    if (c.look.cherry !== false) {
      const chx = ox + skew, chy = base - hh - 2 * s;
      buf.fillCircle(chx, chy, 1.8 * s, pack("#e8304a"));
      buf.set(Math.round(chx - 0.6 * s), Math.round(chy - 0.6 * s), pack("#ffd0d8"));
      buf.line(chx, chy - 1.5 * s, chx + 1.5 * s, chy - 3.5 * s, pack("#3f7a2a"));
    }
    const fy = base - hh * 0.42;
    const fx = ox + skew * 0.42;
    if (p.blink) {
      buf.line(fx - 3 * s, fy, fx - 2 * s, fy, pack("#3a1a10"));
      buf.line(fx + 2 * s, fy, fx + 3 * s, fy, pack("#3a1a10"));
    } else if (p.expr === "happy") {
      buf.set(fx - 3 * s, fy, pack("#3a1a10"));
      buf.set(fx - 2 * s, fy - 1, pack("#3a1a10"));
      buf.set(fx + 2 * s, fy - 1, pack("#3a1a10"));
      buf.set(fx + 3 * s, fy, pack("#3a1a10"));
    } else {
      buf.rect(Math.round(fx - 3 * s), Math.round(fy - 1), Math.max(1, s), 2 * s, pack("#3a1a10"));
      buf.rect(Math.round(fx + 2 * s), Math.round(fy - 1), Math.max(1, s), 2 * s, pack("#3a1a10"));
    }
    buf.set(fx - 4 * s, fy + 2, pack("#ff8a8a"));
    buf.set(fx + 4 * s, fy + 2, pack("#ff8a8a"));
    const mo = p.mouth ? 1 : 0;
    buf.line(fx - 1, fy + 2, fx + 1, fy + 2 + mo, pack("#3a1a10"));
    buf.line(ox - botW - 2, base + 1, ox + botW + 2, base + 1, pack("#e8f0f6"));
    buf.line(ox - botW, base + 2, ox + botW, base + 2, pack("#b9c6d2"));
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    return finish(buf, null, ox, base - hh / 2, { mouth: [fx, fy + 2], top: [ox, base - hh - 5 * s], tail: [ox - botW, base], bottom: [ox, base + 2], eyes: [] }, c.outlineP);
  }
  function rasterSeahorse(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const H = c.H;
    const w = Math.ceil(H * 0.9 * s + 8), h = Math.ceil(H * 1.25 * s + 8);
    const buf = new PixelBuffer(w, h);
    const ox = Math.floor(w * 0.45), oy = Math.floor(h * 0.45);
    const R = c.bodyR, B = c.bellyR, F = c.finR;
    const bob = Math.sin(phase * TAU) * 0.6;
    const pt = (t) => {
      const yy = (t * 1.05 - 0.45) * H * s;
      let xx = Math.sin(t * Math.PI * 1.2 + 0.2) * H * 0.18 * s;
      if (t > 0.72) {
        const k = (t - 0.72) / 0.28;
        const ang = k * Math.PI * 1.6;
        const r = H * 0.14 * s * (1 - k * 0.5);
        return [ox + xx - Math.sin(ang) * r * 0.8 + r * 0.2, oy + (0.72 * 1.05 - 0.45) * H * s + (1 - Math.cos(ang)) * r + bob];
      }
      return [ox + xx, oy + yy + bob];
    };
    const thick = (t) => (t < 0.12 ? 0.11 : t < 0.55 ? 0.17 - (t - 0.12) * 0.05 : 0.15 * (1 - (t - 0.55) / 0.55) + 0.025) * H * s;
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const [x, y] = pt(t);
      const r = thick(t);
      for (let yy = Math.floor(y - r - 1); yy <= y + r + 1; yy++) for (let xx = Math.floor(x - r - 1); xx <= x + r + 1; xx++) {
        const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
        if (dx * dx + dy * dy > r * r) continue;
        const nx = dx / Math.max(0.5, r);
        let col = rampPick(R, clamp01(0.55 - nx * 0.35), xx, yy);
        if (nx > 0.35 && t > 0.15 && t < 0.6) col = rampPick(B, clamp01(0.5 - nx * 0.2), xx, yy);
        if (t > 0.1 && t < 0.7 && (Math.floor(t * 30) & 1) === 0 && nx > 0.1) col = R[1];
        buf.set(xx, yy, col);
      }
    }
    const [hx, hy] = pt(0.06);
    for (let k = 0; k < 4 * s; k++) buf.rect(Math.round(hx + 2 * s + k), Math.round(hy + 1), 1, Math.max(1, s), R[2]);
    buf.set(hx - 1, hy - thick(0.05) - 1, R[3]);
    buf.set(hx, hy - thick(0.05) - 1.5, R[3]);
    const [dx0, dy0] = pt(0.45);
    for (let k = 0; k < 4 * s; k++) {
      const fl = Math.sin(phase * TAU * 4 + k) * 1;
      buf.set(dx0 - thick(0.45) - 1 - fl, dy0 - 2 + k, F[3]);
    }
    if (p.blink) buf.set(hx + 1, hy, R[0]);
    else {
      buf.set(hx + 1, hy - 0.5, pack("#ffffff"));
      buf.set(hx + 1, hy + 0.5, c.eyes[0].pupil);
    }
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    const [tx, ty] = pt(1);
    return finish(buf, null, ox, oy, { mouth: [hx + 5 * s, hy + 1], top: [hx, hy - 5], tail: [tx, ty], bottom: [tx, ty], eyes: [{ x: hx + 1, y: hy, r: 1, type: "dot" }] }, c.outlineP);
  }
  function rasterRay(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const L = c.L, H = c.H;
    const w = Math.ceil(L * s * 1.5 + 12), h = Math.ceil(H * s * 2.2 + 12);
    const buf = new PixelBuffer(w, h);
    const glow = c.glow ? new PixelBuffer(w, h) : null;
    const ox = Math.floor(w * 0.5), oy = Math.floor(h * 0.5);
    const R = c.bodyR, B = c.bellyR;
    const flap = p.still ? 0 : Math.sin(phase * TAU);
    const span = H * s;
    const len = L * 0.5 * s;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
        const u = dx / len;
        if (u > 1 || u < -1.1) continue;
        const wingRaise = flap * Math.abs(dy) * 0.35;
        const yy = dy;
        const half = span * (1 - Math.abs(u - 0.15) * 0.95) * (c.look.square ? 1.15 : 1);
        if (Math.abs(yy) > half) continue;
        const xxs = dx - wingRaise * Math.sign(dy) * 0;
        void xxs;
        const v = yy / Math.max(1, half);
        let light = 0.55 - flap * v * 0.25 - Math.abs(v) * 0.15;
        let col = rampPick(R, clamp01(light), x, y);
        if (c.look.square) {
          if (u > 0.2 && u < 0.75 && Math.abs(v) < 0.35) col = rampPick(B, 0.6, x, y);
          if (u < -0.15 && u > -0.65 && Math.abs(v) < 0.55) col = pack("#f2f2ea");
          if (u < -0.3 && u > -0.5 && Math.abs(v) < 0.4 && (y & 1) === 0) col = pack("#9aa4b8");
        }
        if (c.look.bsod) {
          if (Math.abs(u - 0.15) < 0.4 && Math.abs(v) < 0.6) col = rampPick(R, 0.6, x, y);
          if (Math.abs(dx - len * 0.35) < 0.6 && (Math.abs(dy + 2 * s) < 0.6 || Math.abs(dy - 2 * s) < 0.6)) col = pack("#ffffff");
          if (Math.abs(Math.hypot(dx - len * 0.05, dy) - 2.6 * s) < 0.6 && dx < len * 0.05 - 1 && Math.abs(dy) < 2.2 * s) col = pack("#ffffff");
          if (u < -0.05 && u > -0.8 && Math.abs(v) < 0.5 && y % 3 === 0 && hash2(x >> 1, y, 4) > 0.35) col = pack("#c8d8ff");
          if (glow) glow.set(x, y, R[3]);
        }
        buf.set(x, y, col);
      }
    }
    let tx = ox - len, ty = oy;
    for (let k = 0; k < L * 0.7 * s; k++) {
      const nx = tx - 1, ny = oy + Math.sin(phase * TAU + k * 0.25) * k * 0.08;
      buf.line(tx, ty, nx, ny, R[1]);
      tx = nx;
      ty = ny;
    }
    if (!c.look.bsod) {
      const ex = ox + len * 0.55;
      if (p.blink) {
        buf.set(ex, oy - 2 * s, R[0]);
        buf.set(ex, oy + 2 * s, R[0]);
      } else {
        buf.set(ex, oy - 2 * s, pack("#ffffff"));
        buf.set(ex + 1, oy - 2 * s, c.eyes[0].pupil);
        buf.set(ex, oy + 2 * s, pack("#ffffff"));
        buf.set(ex + 1, oy + 2 * s, c.eyes[0].pupil);
      }
    }
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    return finish(buf, glow, ox, oy, { mouth: [ox + len, oy], top: [ox, oy - span - 3], tail: [tx, ty], bottom: [ox, oy + span], eyes: [] }, c.outlineP);
  }
  function rasterSquid(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const L = c.L, H = c.H;
    const w = Math.ceil(L * s * 1.8 + 10), h = Math.ceil(H * s * 1.6 + 10);
    const buf = new PixelBuffer(w, h);
    const glow = c.glow ? new PixelBuffer(w, h) : null;
    const ox = Math.floor(w * 0.42), oy = Math.floor(h * 0.5);
    const R = c.bodyR, F = c.finR;
    const pulse = p.still ? 0 : Math.sin(phase * TAU);
    const ml = L * 0.55 * s, mh = H / 2 * s * (1 - 0.15 * pulse);
    for (let y = Math.floor(oy - mh - 2); y <= oy + mh + 2; y++) for (let x = ox; x <= ox + ml + 2; x++) {
      const u = (x + 0.5 - ox) / ml;
      const half = mh * Math.sqrt(Math.max(0, 1 - u * u)) * (u < 0.15 ? 0.9 + u : 1);
      if (Math.abs(y + 0.5 - oy) > half || u > 1) continue;
      const v = (y + 0.5 - oy) / Math.max(1, half);
      let col = rampPick(R, clamp01(0.58 - v * 0.35), x, y);
      if (hash2(x, y, 2) > 0.9 && u > 0.2) col = R[0];
      buf.set(x, y, col);
    }
    for (const side of [-1, 1]) {
      const fx = ox + ml * 0.85, fy = oy + side * mh * 0.6;
      buf.fillEllipse(fx, fy + side * (1 + pulse * 0.5) * s, 2.2 * s, 1.5 * s, F[3]);
    }
    const n = 6;
    for (let i = 0; i < n; i++) {
      const off = ((i + 0.5) / n - 0.5) * mh * 1.6;
      let lx = ox, ly = oy + off * 0.5;
      for (let k = 1; k <= L * 0.6 * s; k++) {
        const t = k / (L * 0.6 * s);
        const x = ox - k;
        const y = oy + off * (0.5 + t * (0.8 - pulse * 0.6)) + Math.sin(phase * TAU + i + t * 5) * t * 1.2 * s;
        buf.line(lx, ly, x, y, F[t > 0.8 ? 4 : 2]);
        lx = x;
        ly = y;
      }
    }
    if (c.look.cape) {
      for (let y = Math.floor(oy - mh); y <= oy + mh; y++) for (let x = Math.floor(ox - L * 0.35 * s); x < ox; x++) {
        const t = (ox - x) / (L * 0.35 * s);
        if (Math.abs(y - oy) < mh * (0.6 + t * 0.4) * (1 - pulse * 0.3)) {
          if (!buf.get(x, y)) buf.set(x, y, F[0] & 16777215 | 230 << 24);
        }
      }
    }
    const ex = ox + 1 * s, ey = oy - mh * 0.25;
    if (p.blink) buf.line(ex - 1, ey, ex + 1, ey, R[0]);
    else {
      buf.fillCircle(ex + 0.5, ey + 0.5, 1.6 * s, pack(c.look.eyeGlow ? "#b8fff2" : "#ffffff"));
      buf.set(ex + 1, ey, c.eyes[0].pupil);
      if (glow && c.look.eyeGlow) glow.fillCircle(ex + 0.5, ey + 0.5, 1.6 * s, pack("#7affea"));
    }
    if (glow && c.look.photophores) for (let k = 0; k < 6; k++) {
      const gx = ox + ml * (0.2 + k * 0.12), gy = oy + mh * 0.55;
      buf.set(gx, gy, pack("#8ff3ff"));
      glow.set(gx, gy, pack("#8ff3ff"));
    }
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    return finish(buf, glow, ox + ml * 0.3, oy, { mouth: [ox - 2, oy], top: [ox + ml * 0.5, oy - mh - 3], tail: [ox + ml, oy], bottom: [ox, oy + mh], eyes: [] }, c.outlineP);
  }
  function rasterIsopod(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const L = c.L, H = c.H;
    const w = Math.ceil(L * s + 10), h = Math.ceil(H * s + 10);
    const buf = new PixelBuffer(w, h);
    const ox = Math.floor(w / 2), oy = Math.floor(h * 0.62);
    const R = c.bodyR;
    const walk = p.still ? 0 : phase * TAU;
    const legs = 7;
    for (let i = 0; i < legs; i++) {
      const lx = ox - L * 0.4 * s + i / (legs - 1) * L * 0.8 * s;
      const ph = walk * 2 + i * 0.9;
      buf.line(lx, oy, lx + Math.cos(ph) * 1.5 * s, oy + 2.5 * s - Math.max(0, Math.sin(ph)) * s, R[0]);
    }
    const rx = L / 2 * s, ry = H * 0.6 * s;
    for (let y = Math.floor(oy - ry); y <= oy + 1; y++) for (let x = Math.floor(ox - rx - 1); x <= ox + rx + 1; x++) {
      const nx = (x + 0.5 - ox) / rx, ny = (y + 0.5 - oy) / ry;
      if (ny > 0.05 || nx * nx + ny * ny > 1) continue;
      let col = rampPick(R, clamp01(0.62 + ny * -0.1 - Math.abs(nx) * 0.25 + (ny < -0.6 ? 0.15 : 0)), x, y);
      if (Math.abs(fract((nx + 1) * 4.5) - 0.5) > 0.42 && Math.abs(nx) < 0.8) col = R[1];
      buf.set(x, y, col);
    }
    const hx = ox + rx * 0.95, hy = oy - ry * 0.35;
    buf.fillEllipse(hx, hy, 2.2 * s, 2 * s, R[2]);
    buf.line(hx + 1, hy - 1, hx + 4 * s, hy - 3 * s + Math.sin(walk) * 0.8, R[1]);
    buf.line(hx + 1, hy, hx + 5 * s, hy - 1 * s + Math.cos(walk) * 0.8, R[1]);
    if (!p.blink) {
      buf.set(hx + 1, hy - 1, pack("#111"));
      buf.set(hx + 1, hy - 2, pack("#ffffff"));
    }
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    return finish(buf, null, ox, oy - ry * 0.4, { mouth: [hx + 3, hy + 1], top: [ox, oy - ry - 3], tail: [ox - rx, oy], bottom: [ox, oy + 3], eyes: [] }, c.outlineP);
  }
  function rasterBlob(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const L = c.L, H = c.H;
    const w = Math.ceil(L * s * 1.4 + 10), h = Math.ceil(H * s * 1.5 + 10);
    const buf = new PixelBuffer(w, h);
    const ox = Math.floor(w / 2), oy = Math.floor(h / 2);
    const R = c.bodyR;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - ox) / (L / 2 * s), dy = (y + 0.5 - oy) / (H / 2 * s);
      const ang = Math.atan2(dy, dx);
      const rr = 1 + 0.12 * Math.sin(ang * 5 + phase * TAU) + 0.08 * Math.sin(ang * 3 - phase * TAU * 2);
      if (dx * dx + dy * dy > rr * rr) continue;
      let col = rampPick(R, clamp01(0.55 - dy * 0.3 - dx * 0.05), x, y);
      if (hash2(x >> 1, y >> 1, 5) > 0.88) col = c.finR[3];
      if (hash2(x >> 1, y >> 1, 9) > 0.94) col = pack("#c8b25a");
      buf.set(x, y, col);
    }
    buf.rect(ox - L / 2 * s * 0.6, oy - H / 2 * s * 0.9, 3 * s, 2 * s, pack("#b9c4cc"));
    const ex = ox + L * 0.18 * s, ey = oy - H * 0.12 * s;
    for (const k of [-1, 1]) {
      buf.fillCircle(ex + k * 2.2 * s, ey, 1.6 * s, pack("#f4f0d0"));
      if (!p.blink) buf.set(ex + k * 2.2 * s + 0.5, ey + 0.6 * s, pack("#1a1424"));
      buf.line(ex + k * 2.2 * s - 1.5 * s, ey - 1.2 * s, ex + k * 2.2 * s + 1.5 * s, ey - 0.6 * s, R[0]);
    }
    buf.line(ex - 2 * s, ey + 3 * s, ex + 2 * s, ey + 3.5 * s, pack("#2a1018"));
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    return finish(buf, null, ox, oy, { mouth: [ex + 2, ey + 3], top: [ox, oy - H * 0.6 * s], tail: [ox - L * 0.6 * s, oy], bottom: [ox, oy + H * 0.5 * s], eyes: [] }, c.outlineP);
  }
  function rasterIconFish(c, p) {
    const phase = p.phase || 0;
    const s = p.scale || 1;
    const size = c.L * s;
    const w = Math.ceil(size + 14), h = Math.ceil(size + 10);
    const buf = new PixelBuffer(w, h);
    const ox = Math.floor(w * 0.55), oy = Math.floor(h / 2);
    const R = c.bodyR;
    const posing = p.expr === "pose";
    const half = size / 2;
    if (!posing) {
      const fl = Math.sin(phase * TAU) * 2;
      buf.fillPoly([[ox - half, oy - 2], [ox - half - 6 * s, oy - 4 * s + fl], [ox - half - 5 * s, oy + fl * 0.3], [ox - half - 6 * s, oy + 4 * s + fl], [ox - half, oy + 2]], c.finR[3]);
    }
    for (let y = Math.floor(oy - half); y < oy + half; y++) for (let x = Math.floor(ox - half); x < ox + half; x++) {
      const dx = Math.abs(x + 0.5 - ox) - (half - 2.5), dy = Math.abs(y + 0.5 - oy) - (half - 2.5);
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > 6.25) continue;
      const t = (y - (oy - half)) / size;
      let col = rampPick(R, clamp01(0.8 - t * 0.6), x, y);
      buf.set(x, y, col);
    }
    const g = pack("#ffffff");
    buf.fillEllipse(ox + 1, oy, half * 0.45, half * 0.28, g);
    buf.fillPoly([[ox - half * 0.35, oy], [ox - half * 0.65, oy - half * 0.25], [ox - half * 0.65, oy + half * 0.25]], g);
    if (!posing) {
      const look = Math.sin(phase * TAU) > 0 ? 1 : 0;
      buf.set(ox + half * 0.25 + look, oy - 1, pack("#1a1424"));
    } else buf.set(ox + half * 0.25, oy - 1, R[0]);
    buf.rect(ox - half, oy + half - 4, 4, 4, pack("#ffffff"));
    buf.line(ox - half + 1, oy + half - 1, ox - half + 3, oy + half - 3, pack("#2a5aa8"));
    if (p.silhouette) {
      for (let i = 0; i < buf.data.length; i++) if (buf.data[i]) buf.data[i] = 4278190080 | 3350544;
    }
    return finish(buf, null, ox, oy, { mouth: [ox + half, oy + 1], top: [ox, oy - half - 3], tail: [ox - half - 5, oy], bottom: [ox, oy + half], eyes: [] }, c.outlineP);
  }
  var SHAPES;
  var init_fishart = __esm({
    "src/gfx/fishart.js"() {
      init_math();
      init_color();
      init_pixel();
      SHAPES = {
        oval: { nose: 2.2, peak: 0.4, tailW: 0.3, taper: 1 },
        torpedo: { nose: 1.6, peak: 0.35, tailW: 0.22, taper: 0.9 },
        round: { nose: 3.2, peak: 0.48, tailW: 0.35, taper: 1.3 },
        disc: { nose: 2.6, peak: 0.45, tailW: 0.25, taper: 1.1 },
        long: { nose: 1.8, peak: 0.25, tailW: 0.45, taper: 0.6 },
        box: { nose: 6, peak: 0.3, tailW: 0.4, taper: 1.6 },
        blunt: { nose: 4.5, peak: 0.3, tailW: 0.3, taper: 1 },
        pointy: { nose: 1.2, peak: 0.45, tailW: 0.25, taper: 1 }
      };
    }
  });

  // src/gfx/spritecache.js
  function compiled(look, variant = null, key = null) {
    const k = key ? key + "|" + variantKey(variant) : null;
    if (k && compiledCache.has(k)) return compiledCache.get(k);
    const c = compileLook(look, variant);
    c.id = nextId++;
    if (k) compiledCache.set(k, c);
    return c;
  }
  function variantKey(v) {
    if (!v) return "-";
    return [v.mutation || "", v.shiny ? "s" + (v.shinyHue ?? "") : "", v.pattern || "", v.patternColor || "", v.seed || ""].join(":");
  }
  function frame(c, opts = {}) {
    const f = Math.floor(((opts.phase || 0) % 1 + 1) % 1 * FRAMES) % FRAMES;
    const a = Math.max(-6, Math.min(6, Math.round((opts.angle || 0) / ANGLE_STEP)));
    const s = Math.max(1, Math.round((opts.scale || 1) * 8));
    const inf = Math.round((opts.inflate || 0) * 4);
    const sq = Math.round((opts.squash || 0) * 3);
    const key = `${c.id}|${f}|${a}|${s}|${opts.blink ? 1 : 0}${opts.mouth ? 1 : 0}${opts.silhouette ? 1 : 0}${opts.still ? 1 : 0}|${opts.expr || ""}|${inf}|${sq}`;
    let r = cache.get(key);
    if (r) {
      cache.delete(key);
      cache.set(key, r);
      return r;
    }
    r = rasterFish(c, {
      phase: f / FRAMES,
      angle: a * ANGLE_STEP,
      scale: s / 8,
      blink: !!opts.blink,
      mouth: opts.mouth ? 1 : 0,
      inflate: inf / 4,
      squash: sq / 3,
      expr: opts.expr,
      silhouette: !!opts.silhouette,
      still: !!opts.still
    });
    cache.set(key, r);
    if (cache.size > MAX) {
      const it = cache.keys();
      for (let i = 0; i < 200; i++) cache.delete(it.next().value);
    }
    return r;
  }
  var MAX, cache, nextId, FRAMES, ANGLE_STEP, compiledCache;
  var init_spritecache = __esm({
    "src/gfx/spritecache.js"() {
      init_fishart();
      MAX = 5e3;
      cache = /* @__PURE__ */ new Map();
      nextId = 1;
      FRAMES = 8;
      ANGLE_STEP = Math.PI / 12;
      compiledCache = /* @__PURE__ */ new Map();
    }
  });

  // src/gfx/font.js
  function buildFont(def) {
    const entries = [];
    let atlasW = 0;
    for (const [ch, src] of Object.entries(def.glyphs)) {
      const rows = src.split("|");
      const w = rows[0].length;
      entries.push({ ch, rows, w, x: atlasW });
      atlasW += w + 1;
    }
    const atlasH = def.height + def.descent;
    const canvas = makeCanvas(atlasW, atlasH);
    const g = ctxOf(canvas);
    g.fillStyle = "#fff";
    const glyphs = /* @__PURE__ */ new Map();
    for (const e of entries) {
      e.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === "#") g.fillRect(e.x + x, y, 1, 1);
      });
      glyphs.set(e.ch, { x: e.x, w: e.w, h: e.rows.length });
    }
    return { ...def, atlas: canvas, glyphs, tints: /* @__PURE__ */ new Map(), atlasH };
  }
  function tintAtlas(font, color) {
    let c = font.tints.get(color);
    if (!c) {
      c = makeCanvas(font.atlas.width, font.atlas.height);
      const g = ctxOf(c);
      g.drawImage(font.atlas, 0, 0);
      g.globalCompositeOperation = "source-in";
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      font.tints.set(color, c);
    }
    return c;
  }
  function tokenize(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "{") {
        const j = text.indexOf("}", i);
        if (j > i) {
          const name = text.slice(i + 1, j);
          if (inlineIcons.has(name)) {
            out.push({ icon: name });
            i = j + 1;
            continue;
          }
        }
      }
      out.push({ ch });
      i++;
    }
    return out;
  }
  function glyphFor(font, ch) {
    if (font.upper) ch = ch.toUpperCase();
    return font.glyphs.get(ch) || (ch === " " ? null : font.glyphs.get("?"));
  }
  function measureText(text, fontName = "normal", scale = 1) {
    const font = FONTS[fontName];
    let w = 0, maxW = 0;
    for (const t of tokenize(String(text))) {
      if (t.icon) {
        w += inlineIcons.get(t.icon).canvas.width + font.spacing;
        continue;
      }
      if (t.ch === "\n") {
        maxW = Math.max(maxW, w);
        w = 0;
        continue;
      }
      if (t.ch === " ") {
        w += font.space + font.spacing;
        continue;
      }
      const g = glyphFor(font, t.ch);
      w += (g ? g.w : font.space) + font.spacing;
    }
    maxW = Math.max(maxW, w);
    return Math.max(0, maxW - font.spacing) * scale;
  }
  function blit(ctx, text, x, y, font, color, scale, wave, time) {
    const atlas = tintAtlas(font, color);
    let cx = x, cy = y, i = 0;
    for (const t of tokenize(text)) {
      if (t.icon) {
        const ic = inlineIcons.get(t.icon);
        const ih = ic.canvas.height;
        const oy = Math.round((font.height - ih) / 2) + ic.dy;
        ctx.drawImage(ic.canvas, Math.round(cx), Math.round(cy + oy * scale), ic.canvas.width * scale, ih * scale);
        cx += (ic.canvas.width + font.spacing) * scale;
        continue;
      }
      if (t.ch === "\n") {
        cx = x;
        cy += font.lineHeight * scale;
        continue;
      }
      if (t.ch === " ") {
        cx += (font.space + font.spacing) * scale;
        i++;
        continue;
      }
      const g = glyphFor(font, t.ch);
      if (!g) {
        cx += (font.space + font.spacing) * scale;
        continue;
      }
      const wy = wave ? Math.round(Math.sin(time * 6 + i * 0.7) * wave) : 0;
      ctx.drawImage(atlas, g.x, 0, g.w, g.h, Math.round(cx), Math.round(cy + wy), g.w * scale, g.h * scale);
      cx += (g.w + font.spacing) * scale;
      i++;
    }
  }
  function drawText(ctx, text, x, y, opts = {}) {
    text = String(text);
    const font = FONTS[opts.font || "normal"];
    const scale = opts.scale || 1;
    const color = opts.color || "#ffffff";
    if (opts.align && opts.align !== "left") {
      const w = measureText(text, opts.font || "normal", scale);
      x -= opts.align === "center" ? Math.floor(w / 2) : w;
    }
    x = Math.round(x);
    y = Math.round(y);
    const time = opts.time || 0;
    if (opts.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        blit(ctx, text, x + dx * scale, y + dy * scale, font, opts.outline, scale, opts.wave, time);
      }
    }
    if (opts.shadow) blit(ctx, text, x + scale, y + scale, font, opts.shadow, scale, opts.wave, time);
    blit(ctx, text, x, y, font, color, scale, opts.wave, time);
  }
  var NORMAL_DEF, SMALL_DEF, FONTS, inlineIcons;
  var init_font = __esm({
    "src/gfx/font.js"() {
      init_canvas();
      NORMAL_DEF = {
        height: 7,
        descent: 2,
        lineHeight: 11,
        spacing: 1,
        space: 3,
        glyphs: {
          A: ".##.|#..#|#..#|####|#..#|#..#|#..#",
          B: "###.|#..#|#..#|###.|#..#|#..#|###.",
          C: ".##.|#..#|#...|#...|#...|#..#|.##.",
          D: "###.|#..#|#..#|#..#|#..#|#..#|###.",
          E: "####|#...|#...|###.|#...|#...|####",
          F: "####|#...|#...|###.|#...|#...|#...",
          G: ".##.|#..#|#...|#.##|#..#|#..#|.###",
          H: "#..#|#..#|#..#|####|#..#|#..#|#..#",
          I: "###|.#.|.#.|.#.|.#.|.#.|###",
          J: "..##|...#|...#|...#|#..#|#..#|.##.",
          K: "#..#|#..#|#.#.|##..|#.#.|#..#|#..#",
          L: "#...|#...|#...|#...|#...|#...|####",
          M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
          N: "#..#|##.#|##.#|#.##|#.##|#..#|#..#",
          O: ".##.|#..#|#..#|#..#|#..#|#..#|.##.",
          P: "###.|#..#|#..#|###.|#...|#...|#...",
          Q: ".##.|#..#|#..#|#..#|#..#|#.#.|.#.#",
          R: "###.|#..#|#..#|###.|#.#.|#..#|#..#",
          S: ".###|#...|#...|.##.|...#|...#|###.",
          T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
          U: "#..#|#..#|#..#|#..#|#..#|#..#|.##.",
          V: "#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..",
          W: "#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#",
          X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
          Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
          Z: "####|...#|..#.|..#.|.#..|#...|####",
          a: "....|....|.##.|...#|.###|#..#|.###",
          b: "#...|#...|###.|#..#|#..#|#..#|###.",
          c: "...|...|.##|#..|#..|#..|.##",
          d: "...#|...#|.###|#..#|#..#|#..#|.###",
          e: "....|....|.##.|#..#|####|#...|.##.",
          f: ".##|#..|###|#..|#..|#..|#..",
          g: "....|....|.###|#..#|#..#|#..#|.###|...#|.##.",
          h: "#...|#...|###.|#..#|#..#|#..#|#..#",
          i: "#|.|#|#|#|#|#",
          j: ".#|..|.#|.#|.#|.#|.#|.#|#.",
          k: "#...|#...|#..#|#.#.|##..|#.#.|#..#",
          l: "#.|#.|#.|#.|#.|#.|.#",
          m: ".....|.....|####.|#.#.#|#.#.#|#.#.#|#.#.#",
          n: "....|....|###.|#..#|#..#|#..#|#..#",
          o: "....|....|.##.|#..#|#..#|#..#|.##.",
          p: "....|....|###.|#..#|#..#|#..#|###.|#...|#...",
          q: "....|....|.###|#..#|#..#|#..#|.###|...#|...#",
          r: "....|....|#.##|##..|#...|#...|#...",
          s: "....|....|.###|#...|.##.|...#|###.",
          t: ".#.|.#.|###|.#.|.#.|.#.|..#",
          u: "....|....|#..#|#..#|#..#|#..#|.###",
          v: ".....|.....|#...#|#...#|.#.#.|.#.#.|..#..",
          w: ".....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.",
          x: "....|....|#..#|#..#|.##.|#..#|#..#",
          y: "....|....|#..#|#..#|#..#|#..#|.###|...#|.##.",
          z: "....|....|####|...#|.##.|#...|####",
          0: ".##.|#..#|#..#|#..#|#..#|#..#|.##.",
          1: ".#.|##.|.#.|.#.|.#.|.#.|###",
          2: ".##.|#..#|...#|..#.|.#..|#...|####",
          3: "###.|...#|...#|.##.|...#|...#|###.",
          4: "#..#|#..#|#..#|####|...#|...#|...#",
          5: "####|#...|#...|###.|...#|...#|###.",
          6: ".##.|#...|#...|###.|#..#|#..#|.##.",
          7: "####|...#|...#|..#.|..#.|.#..|.#..",
          8: ".##.|#..#|#..#|.##.|#..#|#..#|.##.",
          9: ".##.|#..#|#..#|.###|...#|...#|.##.",
          ".": ".|.|.|.|.|.|#",
          ",": ".|.|.|.|.|.|#|#",
          "!": "#|#|#|#|#|.|#",
          "?": ".##.|#..#|...#|..#.|.#..|....|.#..",
          "'": "#|#|.|.|.|.|.",
          '"': "#.#|#.#|...|...|...|...|...",
          ":": ".|.|.|#|.|.|#",
          ";": ".|.|.|#|.|.|#|#",
          "-": "...|...|...|###|...|...|...",
          "+": "...|...|.#.|###|.#.|...|...",
          "=": "...|...|###|...|###|...|...",
          "/": "..#|..#|.#.|.#.|.#.|#..|#..",
          "\\": "#..|#..|.#.|.#.|.#.|..#|..#",
          "(": ".#|#.|#.|#.|#.|#.|.#",
          ")": "#.|.#|.#|.#|.#|.#|#.",
          "[": "##|#.|#.|#.|#.|#.|##",
          "]": "##|.#|.#|.#|.#|.#|##",
          "<": "...|..#|.#.|#..|.#.|..#|...",
          ">": "...|#..|.#.|..#|.#.|#..|...",
          "%": "##..#|##.#.|...#.|..#..|.#...|.#.##|#..##",
          "#": ".#.#.|#####|.#.#.|.#.#.|#####|.#.#.|.....",
          "*": "...|#.#|.#.|#.#|...|...|...",
          "_": "....|....|....|....|....|....|####",
          "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
          $: ".#.|###|#..|###|..#|###|.#.",
          "^": ".#.|#.#|...|...|...|...|...",
          "~": "....|....|.#.#|#.#.|....|....|....",
          "|": "#|#|#|#|#|#|#",
          "`": "#.|.#|..|..|..|..|..",
          "{": ".##|.#.|.#.|#..|.#.|.#.|.##",
          "}": "##.|.#.|.#.|..#|.#.|.#.|##.",
          "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
          "\xD7": "...|...|#.#|.#.|#.#|...|...",
          "\u2022": "..|..|..|##|##|..|.."
        }
      };
      SMALL_DEF = {
        height: 5,
        descent: 1,
        lineHeight: 7,
        spacing: 1,
        space: 2,
        upper: true,
        glyphs: {
          A: ".#.|#.#|###|#.#|#.#",
          B: "##.|#.#|##.|#.#|##.",
          C: ".##|#..|#..|#..|.##",
          D: "##.|#.#|#.#|#.#|##.",
          E: "###|#..|##.|#..|###",
          F: "###|#..|##.|#..|#..",
          G: ".##|#..|#.#|#.#|.##",
          H: "#.#|#.#|###|#.#|#.#",
          I: "###|.#.|.#.|.#.|###",
          J: "..#|..#|..#|#.#|.#.",
          K: "#.#|#.#|##.|#.#|#.#",
          L: "#..|#..|#..|#..|###",
          M: "#...#|##.##|#.#.#|#...#|#...#",
          N: "#..#|##.#|#.##|#..#|#..#",
          O: ".#.|#.#|#.#|#.#|.#.",
          P: "##.|#.#|##.|#..|#..",
          Q: ".#.|#.#|#.#|##.|.##",
          R: "##.|#.#|##.|#.#|#.#",
          S: ".##|#..|.#.|..#|##.",
          T: "###|.#.|.#.|.#.|.#.",
          U: "#.#|#.#|#.#|#.#|###",
          V: "#.#|#.#|#.#|#.#|.#.",
          W: "#...#|#...#|#.#.#|#.#.#|.#.#.",
          X: "#.#|#.#|.#.|#.#|#.#",
          Y: "#.#|#.#|.#.|.#.|.#.",
          Z: "###|..#|.#.|#..|###",
          0: "###|#.#|#.#|#.#|###",
          1: ".#.|##.|.#.|.#.|###",
          2: "##.|..#|.#.|#..|###",
          3: "##.|..#|.#.|..#|##.",
          4: "#.#|#.#|###|..#|..#",
          5: "###|#..|##.|..#|##.",
          6: ".##|#..|###|#.#|###",
          7: "###|..#|.#.|.#.|.#.",
          8: "###|#.#|###|#.#|###",
          9: "###|#.#|###|..#|##.",
          ".": ".|.|.|.|#",
          ",": ".|.|.|#|#",
          "!": "#|#|#|.|#",
          "?": "##.|..#|.#.|...|.#.",
          ":": ".|#|.|#|.",
          "-": "...|...|###|...|...",
          "+": "...|.#.|###|.#.|...",
          "/": "..#|..#|.#.|#..|#..",
          "%": "#.#|..#|.#.|#..|#.#",
          "'": "#|#|.|.|.",
          "(": ".#|#.|#.|#.|.#",
          ")": "#.|.#|.#|.#|#.",
          '"': "#.#|#.#|...|...|...",
          "#": "#.#|###|#.#|###|#.#",
          "*": "#.#|.#.|#.#|...|...",
          "<": "..#|.#.|#..|.#.|..#",
          ">": "#..|.#.|..#|.#.|#..",
          "=": "...|###|...|###|...",
          "_": "...|...|...|...|###",
          "&": ".#.|#.#|.#.|#.#|.##",
          $: ".##|##.|.#.|.##|##.",
          "\xD7": "...|#.#|.#.|#.#|...",
          "[": "##|#.|#.|#.|##",
          "]": "##|.#|.#|.#|##"
        }
      };
      FONTS = {
        normal: buildFont(NORMAL_DEF),
        small: buildFont(SMALL_DEF)
      };
      inlineIcons = /* @__PURE__ */ new Map();
    }
  });

  // src/dev/testlooks.js
  var testlooks_exports = {};
  __export(testlooks_exports, {
    TEST_LOOKS: () => TEST_LOOKS
  });
  var TEST_LOOKS;
  var init_testlooks = __esm({
    "src/dev/testlooks.js"() {
      TEST_LOOKS = [
        { name: "clownfish", look: { body: { len: 16, h: 10, shape: "oval" }, col: { body: "#ff8a2a", belly: "#ffc070", back: "#e8641a", fin: "#ff9a3a" }, pattern: [{ type: "bands", color: "#ffffff", at: [0.2, 0.52, 0.85], width: 0.07, edge: true }], tail: { type: "round", len: 5, spread: 5 }, dorsal: { type: "round", from: 0.25, to: 0.75, h: 3 } } },
        { name: "guppy", look: { body: { len: 11, h: 6, shape: "torpedo" }, col: { body: "#ff7ab8", belly: "#ffd0e6", back: "#c2479a", fin: "#9f6bff" }, tail: { type: "veil", len: 9, spread: 7 }, dorsal: { type: "sail", from: 0.4, to: 0.8, h: 3 } } },
        { name: "puffer", look: { body: { len: 14, h: 11, shape: "round" }, col: { body: "#e8c95a", belly: "#fff3c4", back: "#9b8a3a", fin: "#f4dc7a" }, pattern: [{ type: "spots", color: "#6b5a24", size: 1, density: 0.5, only: "top" }], tail: { type: "fan", len: 4, spread: 3.5 }, dorsal: { type: "round", from: 0.6, to: 0.8, h: 2 }, spikes: 4, eye: { r: 2.4, u: 0.22, v: -0.25 } } },
        { name: "puffer inflated", look: { body: { len: 14, h: 11, shape: "round" }, col: { body: "#e8c95a", belly: "#fff3c4", back: "#9b8a3a", fin: "#f4dc7a" }, pattern: [{ type: "spots", color: "#6b5a24", size: 1, density: 0.5, only: "top" }], tail: { type: "fan", len: 4, spread: 3.5 }, dorsal: { type: "round", from: 0.6, to: 0.8, h: 2 }, spikes: 4, eye: { r: 2.4, u: 0.22, v: -0.25 } } },
        { name: "tang", look: { body: { len: 18, h: 12, shape: "disc" }, col: { body: "#2f6dff", belly: "#5aa0ff", back: "#1a3aa8", fin: "#2050d0" }, pattern: [{ type: "tailend", color: "#ffd23a", from: 0.88 }, { type: "zigzag", color: "#10163a", count: 1.2, width: 0.12 }], tail: { type: "moon", len: 6, spread: 6, color: "#ffd23a" }, dorsal: { type: "long", from: 0.2, to: 0.9, h: 3, color: "#1a3aa8" } } },
        { name: "googly", look: { body: { len: 13, h: 9, shape: "round" }, col: { body: "#7be08a", belly: "#d8ffc8", back: "#3da35a" }, eye: { type: "googly", r: 3.5, u: 0.3, v: -0.45 }, tail: { type: "fork", len: 5, spread: 4 } } },
        { name: "businessfish", look: { body: { len: 12, h: 7, shape: "torpedo" }, col: { body: "#5a6478", belly: "#8a94a8", back: "#3a4258", fin: "#4a5468" }, pattern: [{ type: "suit", color: "#f4f4f0" }], extras: [{ type: "tie", color: "#d8283a", color2: "#a01426", u: 0.26 }], eye: { r: 1.6 } } },
        { name: "glass", look: { body: { len: 18, h: 9 }, col: { body: "#bfe8ff", belly: "#e6f8ff", back: "#9fd4f0", fin: "#cdeeff" }, translucent: 0.42, organs: { bone: "#ffffff" }, tail: { type: "fork" } } },
        { name: "koi", look: { body: { len: 22, h: 9, shape: "torpedo" }, col: { body: "#fff8f0", belly: "#ffffff", back: "#f0e8e0", fin: "#fff0e8" }, pattern: [{ type: "patches", color: "#ff5a2a", threshold: 0.55, freq: 0.25 }], tail: { type: "veil", len: 8, spread: 6 }, extras: [{ type: "whiskers", len: 4 }] } },
        { name: "angler", look: { body: { len: 18, h: 13, shape: "blunt" }, col: { body: "#4a3f5a", belly: "#6a5a72", back: "#2e2638", fin: "#3a3048" }, mouth: { type: "fangs", v: 0.3 }, extras: [{ type: "lure", color: "#6a6078", glow: false }], eye: { r: 1.5, type: "glow", glow: "#7affea" }, tail: { type: "round" } } },
        { name: "parrot", look: { body: { len: 20, h: 11, shape: "oval" }, col: { body: "#3ac9b0", belly: "#a8f0d8", back: "#2a8aa0", fin: "#ff7ab8" }, mouth: { type: "beak", color: "#f0f4e8" }, pattern: [{ type: "chevron", color: "#ff8ac8", count: 4, width: 0.12 }], tail: { type: "moon" } } },
        { name: "flutterfin", look: { body: { len: 14, h: 12, shape: "disc" }, col: { body: "#ffd84a", belly: "#fff2a0", back: "#e8b030", fin: "#ffe070" }, pattern: [{ type: "mask", color: "#2a1a10", at: 0.17, width: 0.07 }, { type: "spots", color: "#2a2a50", size: 1.2, density: 0.15 }], tail: { type: "truncate", len: 4, spread: 4 }, dorsal: { type: "long", from: 0.2, to: 0.85, h: 3 } } },
        { name: "bitfish", look: { body: { len: 12, h: 7, shape: "box" }, col: { body: "#48e070", belly: "#a8ffb8", back: "#208a48" }, pattern: [{ type: "checker", color: "#30b058", size: 2 }], tail: { type: "truncate" }, scales: false, shine: false, contrast: 0.6 } },
        { name: "rusty grouper", look: { body: { len: 26, h: 14, shape: "oval", belly: 0.15 }, col: { body: "#7a6a58", belly: "#b8a890", back: "#4a3e34", fin: "#6a5a48" }, pattern: [{ type: "rust", color: "#c8642a", threshold: 0.6 }], extras: [{ type: "bolts", color: "#c8ccd4" }], mouth: { type: "lips", color: "#b88a7a" }, tail: { type: "round" } } },
        { name: "dragonfish", look: { body: { len: 26, h: 7, shape: "long" }, col: { body: "#1e1a2a", belly: "#2e2a3a", back: "#120e1a", fin: "#2a2238" }, pattern: [{ type: "glowspots", color: "#7ac8ff", glow: true, count: 7, v: 0.6 }], mouth: { type: "fangs", v: 0.2 }, eye: { type: "glow", r: 1.4, glow: "#ff6a8a" }, tail: { type: "fork", len: 5, spread: 3 }, dorsal: { type: "tri", from: 0.75, to: 0.9, h: 3 } } },
        { name: "crab", look: { kind: "crab", body: { len: 12, h: 8 }, col: { body: "#e8583a", belly: "#ff9a6a", fin: "#f06a4a" } } },
        { name: "click crab", look: { kind: "crab", shell: "mouse", body: { len: 12, h: 9 }, col: { body: "#e8ecf2", belly: "#c8ced8", fin: "#ff7a5a" } } },
        { name: "jelly", look: { kind: "jelly", body: { len: 12, h: 10 }, col: { body: "#c8a8ff", fin: "#e0c8ff" }, translucent: 0.65 } },
        { name: "pudding", look: { kind: "pudding", body: { len: 14, h: 11 }, col: { body: "#ffd870", fin: "#9a5a28" } } },
        { name: "seahorse", look: { kind: "seahorse", body: { len: 8, h: 20 }, col: { body: "#ff9a3a", belly: "#ffd08a", fin: "#ffe0a0" } } },
        { name: "floppy ray", look: { kind: "ray", square: true, body: { len: 18, h: 9 }, col: { body: "#3a4a8a", belly: "#a8b0c8" } } },
        { name: "vamp squid", look: { kind: "squid", cape: true, eyeGlow: true, body: { len: 14, h: 9 }, col: { body: "#b8283a", fin: "#7a1424" } } },
        { name: "isopod", look: { kind: "isopod", body: { len: 16, h: 8 }, col: { body: "#c8b8c8" } } },
        { name: "blob", look: { kind: "blob", body: { len: 16, h: 12 }, col: { body: "#8aa05a", fin: "#c85a8a" } } },
        { name: "iconfish", look: { kind: "iconfish", body: { len: 16, h: 16 }, col: { body: "#3a8aff", fin: "#5aa0ff" } } }
      ];
    }
  });

  // src/dev/gallery.js
  var gallery_exports = {};
  __export(gallery_exports, {
    run: () => run,
    runGallery: () => runGallery
  });
  function run(params2) {
    runGallery(TEST_LOOKS, { frozen: params2.has("frozen"), angle: Number(params2.get("angle") || 0), fs: Number(params2.get("fs") || 1) });
  }
  function runGallery(looks, opts = {}) {
    const W = opts.w || 640, H = opts.h || 360, S = opts.scale || 3;
    const cv = document.getElementById("screen");
    cv.width = W;
    cv.height = H;
    cv.style.width = W * S + "px";
    cv.style.height = H * S + "px";
    const g = ctxOf(cv);
    const items = looks.map((l) => ({ name: l.name, c: compiled(l.look, l.variant || null) }));
    let t = 0;
    function draw() {
      t += 1 / 60;
      g.fillStyle = opts.bg || "#2b6f8f";
      g.fillRect(0, 0, W, H);
      const cols = opts.cols || 6;
      const cw = W / cols, ch = opts.rowH || 60;
      items.forEach((it, i) => {
        const cx = i % cols * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch / 2 + 4;
        const f = frame(it.c, { phase: opts.frozen ? opts.phase || 0 : t * 1.5, angle: opts.angle || 0, scale: opts.fs || 1, inflate: it.name.includes("inflated") ? 1 : 0, blink: false });
        g.drawImage(f.canvas, Math.round(cx - f.ox), Math.round(cy - f.oy));
        drawText(g, it.name, cx, cy + 18, { font: "small", align: "center", color: "#ffffff", shadow: "#0b1622" });
      });
      if (!opts.frozen) requestAnimationFrame(draw);
    }
    draw();
    window.__galleryReady = true;
  }
  var init_gallery = __esm({
    "src/dev/gallery.js"() {
      init_canvas();
      init_spritecache();
      init_font();
      init_testlooks();
    }
  });

  // src/game/boot.js
  var boot_exports = {};
  __export(boot_exports, {
    startGame: () => startGame
  });
  function startGame() {
    console.log("game not built yet");
  }
  var init_boot = __esm({
    "src/game/boot.js"() {
    }
  });

  // import("./dev/**/*.js") in src/main.js
  var globImport_dev_js = __glob({
    "./dev/gallery.js": () => Promise.resolve().then(() => (init_gallery(), gallery_exports)),
    "./dev/testlooks.js": () => Promise.resolve().then(() => (init_testlooks(), testlooks_exports))
  });

  // src/main.js
  var params = new URLSearchParams(location.search);
  var dev = params.get("dev") || (params.has("gallery") ? "gallery" : null);
  async function boot() {
    document.getElementById("boot")?.remove();
    if (dev) {
      const mod = await globImport_dev_js(`./dev/${dev}.js`);
      mod.run(params);
      return;
    }
    const { startGame: startGame2 } = await Promise.resolve().then(() => (init_boot(), boot_exports));
    startGame2(params);
  }
  boot().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML("beforeend", `<pre style="color:#f88;position:fixed;top:0;left:0">${e.stack}</pre>`);
  });
})();
