// [seal19] Analytic BUBBLE renderer: sprites built from glossy, translucent soap-bubble spheres (plus a few opaque
// glossy parts: spheres, one striped cone and thin tori), ray-cast per pixel in a tiny WebGL2 fragment shader
// (orthographic, so every sphere hit is closed-form and cheap). Bubbles are shaded like Frutiger Aero soap film:
// a milky pearl volume (opacity from the path length through the cluster), wrapped soft lighting with cool
// hue-shifted shadows, an iridescent thin-film rim (fresnel), the rims of the bubbles behind showing through,
// a bright crease where two bubbles meet, a glossy window reflection, a sharp sun glint and a small inner glint
// on the far side. A second pass bakes a soft, anti-aliased dark ink outline around each cell's silhouette.
// Cells are packed into atlas pages (one GL pass + one readback per page) and copied into 2D canvases, so the
// callers only ever drawImage cached frames. Without WebGL2 the same shading runs in JS (single sample).
//
//   bubbleGLAvailable() -> bool
//   bubbleForceCPU(on)                        test the Canvas2D fallback
//   renderBubbleCells(cells, o) -> pages      cells: [{w, h, spheres: [{x, y, z, r, kind (0 bubble | 2 opaque
//       glossy), dens (bubble opacity per unit of depth), film (thin-film phase; opaque: gloss), tint (index)}],
//       cone: {apex: [x, y, z], dir (apex -> base, unit), h, r, e1 (unit, perpendicular to dir), tintA, tintB} |
//       null, tori: [{c: [x, y, z], n (axis, unit), R, rr, tint}]} in CELL PIXELS (x right, y down, z toward the
//       viewer). Sets cell.page (canvas), cell.sx, cell.sy. o: {U (px per model unit), outline (px), ink [r, g, b, a],
//       tints: [[r, g, b] 0..1]}
//   bubbleStats() -> {gl, cpu, ms, cells, px}

const MAXS = 64, MAXT = 4, MAXTINT = 16, PAGE = 2048;
const STATS = { gl: 0, cpu: 0, ms: 0, cells: 0, px: 0 };
export function bubbleStats() { return { ...STATS }; }

let forceCPU = false;
export function bubbleForceCPU(on) { forceCPU = !!on; }

// ------------------------------------------------------------------------------------------------ shaders
const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
#define MAXS ${MAXS}
#define MAXT ${MAXT}
uniform vec4 uS[MAXS];
uniform vec4 uM[MAXS];
uniform int uN;
uniform vec4 uCA; uniform vec4 uCD; uniform vec4 uCE; uniform vec2 uCT;
uniform vec4 uT[MAXT]; uniform vec4 uTN[MAXT]; uniform int uNT; uniform float uTT[MAXT];
uniform vec3 uTint[${MAXTINT}];
uniform vec2 uOrg;
uniform float uU;
out vec4 frag;
const vec3 LD = vec3(-0.4705, -0.6796, 0.5631);
const vec3 WIN = vec3(-0.5100, -0.6375, 0.5775);
const vec3 SUN = vec3(-0.3221, -0.4831, 0.8141);
const vec3 LR = vec3(0.5622, 0.6133, 0.5549);
vec3 tint(float i) { return uTint[int(i + 0.5)]; }
vec3 film(float f) { return 0.56 + 0.44 * cos(6.28318 * (f + vec3(0.0, 0.33, 0.67))); }
vec3 glossy(vec3 n, vec3 c, float g) {
  float ndl = dot(n, LD);
  vec3 col = c * (0.46 + 0.62 * max(ndl, 0.0)) + c * vec3(0.10, 0.18, 0.26) * max(n.y, 0.0);
  col = mix(col * vec3(0.78, 0.82, 1.0), col, clamp(0.5 + ndl, 0.0, 1.0));
  vec3 R = vec3(2.0 * n.z * n.x, 2.0 * n.z * n.y, 2.0 * n.z * n.z - 1.0);
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0);
  col += vec3(0.55, 0.88, 1.0) * rim * 0.4;
  col += vec3(1.0) * (pow(max(dot(R, SUN), 0.0), 40.0) * 1.1 + smoothstep(0.88, 0.93, dot(R, WIN)) * 0.5) * g;
  return min(col, vec3(1.0));
}
vec4 shade(vec2 p) {
  float zO = -1e9; vec3 nO = vec3(0.0, 0.0, 1.0); vec3 cO = vec3(0.0); float gO = 0.0;
  for (int i = 0; i < MAXS; i++) {
    if (i >= uN) break;
    vec4 m = uM[i];
    if (m.x < 1.5) continue;
    vec4 s = uS[i]; vec2 d = p - s.xy; float d2 = dot(d, d), r2 = s.w * s.w;
    if (d2 >= r2) continue;
    float h = sqrt(r2 - d2), z = s.z + h;
    if (z > zO) { zO = z; nO = vec3(d, h) / s.w; cO = tint(m.w); gO = m.z; }
  }
  if (uCE.w > 0.5) {
    vec3 A = uCA.xyz; float H = uCA.w; vec3 D = uCD.xyz; float R = uCD.w;
    float wx = p.x - A.x, wy = p.y - A.y;
    float c2 = H * H / (H * H + R * R);
    float a = D.z, b0 = wx * D.x + wy * D.y;
    float qa = a * a - c2, qb = 2.0 * a * b0, qc = b0 * b0 - c2 * (wx * wx + wy * wy);
    float best = -1e9; vec3 bn = D; vec3 bv = vec3(0.0); float bu = 1.0;
    if (abs(qa) > 1e-6) {
      float disc = qb * qb - 4.0 * qa * qc;
      if (disc >= 0.0) {
        float sq = sqrt(disc);
        for (int k = 0; k < 2; k++) {
          float s = (-qb + (k == 0 ? sq : -sq)) / (2.0 * qa);
          vec3 v = vec3(wx, wy, s); float hh = dot(v, D);
          if (hh > 0.0 && hh < H && A.z + s > best) {
            best = A.z + s; vec3 rad = v - D * hh; float rl = length(rad);
            vec3 ru = rl > 1e-4 ? rad / rl : vec3(0.0, 0.0, 1.0);
            bn = normalize(ru - D * (R / H)); bv = v; bu = hh / H;
          }
        }
      }
    }
    if (abs(a) > 1e-4) {
      float s = (H - b0) / a; vec3 v = vec3(wx, wy, s); vec3 B = v - D * H;
      if (dot(B, B) < R * R && A.z + s > best) { best = A.z + s; bn = D; bv = v; bu = 1.0; }
    }
    if (best > zO) {
      zO = best; nO = bn.z < 0.0 ? -bn : bn;
      vec3 e1 = uCE.xyz, e2 = cross(D, e1);
      vec3 rad = bv - D * dot(bv, D);
      float ang = atan(dot(rad, e2), dot(rad, e1));
      float st = fract(bu * 3.0 + ang / 6.28318 + 0.1);
      float band = smoothstep(0.47, 0.53, st) * (1.0 - smoothstep(0.94, 1.0, st));
      cO = mix(tint(uCT.x), tint(uCT.y), band); gO = 1.0;
    }
  }
  for (int i = 0; i < MAXT; i++) {
    if (i >= uNT) break;
    vec3 c = uT[i].xyz; float R = uT[i].w; vec3 ax = uTN[i].xyz; float rr = uTN[i].w;
    vec2 d = p - c.xy;
    if (dot(d, d) > (R + rr + 1.0) * (R + rr + 1.0)) continue;
    float z = c.z + R + rr; bool hit = false;
    for (int k = 0; k < 48; k++) {
      vec3 q = vec3(d, z - c.z); float h = dot(q, ax); vec3 pr = q - ax * h;
      float sd = length(vec2(length(pr) - R, h)) - rr;
      if (sd < 0.04) { hit = true; break; }
      z -= max(sd, 0.06);
      if (z < c.z - R - rr) break;
    }
    if (hit && z > zO) {
      vec3 q = vec3(d, z - c.z); float h = dot(q, ax); vec3 pr = q - ax * h;
      float pl = length(pr);
      vec3 ctr = pl > 1e-4 ? pr / pl * R : vec3(0.0);
      zO = z; nO = normalize(q - ctr + vec3(0.0, 0.0, 1e-4)); cO = tint(uTT[i]); gO = 1.0;
    }
  }
  float zF = -1e9, zF2 = -1e9; vec3 nF = vec3(0.0, 0.0, 1.0); int iF = -1;
  float L = 0.0, rims = 0.0, back = 0.0;
  for (int i = 0; i < MAXS; i++) {
    if (i >= uN) break;
    vec4 m = uM[i];
    if (m.x > 1.5) continue;
    vec4 s = uS[i]; vec2 d = p - s.xy; float d2 = dot(d, d), r2 = s.w * s.w;
    if (d2 >= r2) continue;
    float h = sqrt(r2 - d2), zf = s.z + h, zb = s.z - h;
    if (zf <= zO) continue;
    L += (zf - max(zb, zO)) * m.y;
    float nz = h / s.w, rim = pow(1.0 - nz, 3.0);
    rims += rim;
    if (zb > zO) back += rim * max(0.0, dot(d / max(sqrt(d2), 1e-3), vec2(0.6, 0.8)));
    if (zf > zF) { zF2 = zF; zF = zf; iF = i; nF = vec3(d, h) / s.w; }
    else if (zf > zF2) zF2 = zf;
  }
  vec4 op = zO > -1e8 ? vec4(glossy(nO, cO, gO), 1.0) : vec4(0.0);
  if (iF < 0) return op;
  vec4 m = uM[iF]; vec3 tn = tint(m.w);
  float ndl = dot(nF, LD);
  vec3 shadowC = tn * vec3(0.62, 0.68, 0.94);
  vec3 base = mix(shadowC, tn, clamp(0.5 + 0.62 * ndl, 0.0, 1.0));
  base += vec3(0.0, 0.07, 0.11) * max(nF.y, 0.0);
  float F = pow(1.0 - nF.z, 2.0);
  vec3 ir = film(m.z + 1.1 * F + 0.3 * nF.x - 0.2 * nF.y);
  vec3 c = mix(base, ir, F * 0.72);
  float frim = pow(1.0 - nF.z, 3.0);
  c += ir * clamp(rims - frim, 0.0, 1.5) * 0.3;
  c += vec3(0.62, 0.94, 1.0) * back * 0.3;
  float crease = zF2 > -1e8 ? 1.0 - smoothstep(0.0, uU * 0.045, zF - zF2) : 0.0;
  c = mix(c, min(ir * 1.12, vec3(1.0)), crease * 0.4);
  vec3 R = vec3(2.0 * nF.z * nF.x, 2.0 * nF.z * nF.y, 2.0 * nF.z * nF.z - 1.0);
  float win = smoothstep(0.865, 0.905, dot(R, WIN));
  float sun = pow(max(dot(R, SUN), 0.0), 140.0);
  float lr = smoothstep(0.95, 0.975, dot(R, LR)) * 0.5;
  float aV = 1.0 - exp(-L / uU);
  float a = clamp(min(0.3, m.y * 0.4) + 0.66 * aV + F * 0.5 + crease * 0.15, 0.0, 1.0);
  float hl = clamp(win * 0.78 + sun + lr, 0.0, 1.0);
  vec4 res = vec4(c * a, a);
  res.rgb = res.rgb * (1.0 - hl) + vec3(hl);
  res.a = res.a + hl * (1.0 - res.a);
  res.rgb += op.rgb * op.a * (1.0 - res.a); res.a += op.a * (1.0 - res.a);
  return res;
}
void main() {
  vec2 p = gl_FragCoord.xy - uOrg;
  vec4 acc = shade(p + vec2(-0.125, -0.375)) + shade(p + vec2(0.375, -0.125)) + shade(p + vec2(0.125, 0.375)) + shade(p + vec2(-0.375, 0.125));
  acc *= 0.25;
  frag = acc.a > 1e-4 ? vec4(min(acc.rgb / acc.a, vec3(1.0)), acc.a) : vec4(0.0);
}`;

const FSO = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec4 uBox; uniform float uW; uniform vec4 uInk;
out vec4 frag;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uTex, q, 0);
  float m = 0.0;
  for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) {
    float dist = length(vec2(float(dx), float(dy)));
    float w = clamp(uW + 1.0 - dist, 0.0, 1.0);
    if (w <= 0.0) continue;
    ivec2 qq = q + ivec2(dx, dy);
    if (float(qq.x) < uBox.x || float(qq.y) < uBox.y || float(qq.x) >= uBox.z || float(qq.y) >= uBox.w) continue;
    m = max(m, smoothstep(0.08, 0.45, texelFetch(uTex, qq, 0).a) * w);
  }
  float ia = m * uInk.a * (1.0 - smoothstep(0.02, 0.3, c.a));
  float a = c.a + ia * (1.0 - c.a);
  vec3 rgb = a > 1e-4 ? (c.rgb * c.a + uInk.rgb * ia * (1.0 - c.a)) / a : vec3(0.0);
  frag = vec4(rgb, a);
}`;

// ------------------------------------------------------------------------------------------------ GL setup
let G = null, glFailed = false;
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('bubble shader: ' + log); }
  return s;
}
function link(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('bubble link: ' + gl.getProgramInfoLog(p));
  return p;
}
function glInit() {
  if (G || glFailed) return G;
  try {
    if (typeof document === 'undefined') throw new Error('no document');
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no webgl2');
    const prog = link(gl, FS), progO = link(gl, FSO);
    const U = {}, UO = {};
    for (const n of ['uS', 'uM', 'uN', 'uCA', 'uCD', 'uCE', 'uCT', 'uT', 'uTN', 'uNT', 'uTT', 'uTint', 'uOrg', 'uU']) U[n] = gl.getUniformLocation(prog, n);
    for (const n of ['uTex', 'uBox', 'uW', 'uInk']) UO[n] = gl.getUniformLocation(progO, n);
    const vao = gl.createVertexArray();
    G = { gl, canvas, prog, progO, U, UO, vao, tA: null, tB: null, fA: null, fB: null, w: 0, h: 0 };
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault?.(); G = null; glFailed = true; });
  } catch (e) {
    glFailed = true; G = null;
  }
  return G;
}
export function bubbleGLAvailable() { return !forceCPU && !!glInit(); }

function targets(w, h) {
  const { gl } = G;
  if (G.w >= w && G.h >= h) return;
  const W = Math.min(PAGE, Math.max(G.w, 256, 1 << Math.ceil(Math.log2(w)))), H = Math.min(PAGE, Math.max(G.h, 256, 1 << Math.ceil(Math.log2(h))));
  for (const k of ['tA', 'tB']) if (G[k]) gl.deleteTexture(G[k]);
  for (const k of ['fA', 'fB']) if (G[k]) gl.deleteFramebuffer(G[k]);
  const mk = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return [t, f];
  };
  [G.tA, G.fA] = mk(); [G.tB, G.fB] = mk();
  G.w = W; G.h = H;
}

const fS = new Float32Array(MAXS * 4), fM = new Float32Array(MAXS * 4), fT = new Float32Array(MAXT * 4), fTN = new Float32Array(MAXT * 4), fTT = new Float32Array(MAXT);
function cellUniforms(gl, U, c) {
  fS.fill(0); fM.fill(0); fT.fill(0); fTN.fill(0); fTT.fill(0);
  const S = c.spheres || [];
  const n = Math.min(MAXS, S.length);
  for (let i = 0; i < n; i++) {
    const s = S[i];
    fS[i * 4] = s.x; fS[i * 4 + 1] = s.y; fS[i * 4 + 2] = s.z; fS[i * 4 + 3] = s.r;
    fM[i * 4] = s.kind || 0; fM[i * 4 + 1] = s.dens ?? 2; fM[i * 4 + 2] = s.film || 0; fM[i * 4 + 3] = s.tint || 0;
  }
  gl.uniform4fv(U.uS, fS); gl.uniform4fv(U.uM, fM); gl.uniform1i(U.uN, n);
  const C = c.cone;
  if (C) {
    gl.uniform4f(U.uCA, C.apex[0], C.apex[1], C.apex[2], C.h);
    gl.uniform4f(U.uCD, C.dir[0], C.dir[1], C.dir[2], C.r);
    gl.uniform4f(U.uCE, C.e1[0], C.e1[1], C.e1[2], 1);
    gl.uniform2f(U.uCT, C.tintA || 0, C.tintB || 0);
  } else gl.uniform4f(U.uCE, 0, 0, 0, 0);
  const T = c.tori || [];
  const nt = Math.min(MAXT, T.length);
  for (let i = 0; i < nt; i++) {
    const t = T[i];
    fT[i * 4] = t.c[0]; fT[i * 4 + 1] = t.c[1]; fT[i * 4 + 2] = t.c[2]; fT[i * 4 + 3] = t.R;
    fTN[i * 4] = t.n[0]; fTN[i * 4 + 1] = t.n[1]; fTN[i * 4 + 2] = t.n[2]; fTN[i * 4 + 3] = t.rr;
    fTT[i] = t.tint || 0;
  }
  gl.uniform4fv(U.uT, fT); gl.uniform4fv(U.uTN, fTN); gl.uniform1fv(U.uTT, fTT); gl.uniform1i(U.uNT, nt);
}

function glPage(cells, W, H, o) {
  const { gl, U, UO } = G;
  targets(W, H);
  gl.bindVertexArray(G.vao);
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.SCISSOR_TEST);
  // pass 1: the bubbles
  gl.bindFramebuffer(gl.FRAMEBUFFER, G.fA);
  gl.viewport(0, 0, G.w, G.h);
  gl.scissor(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(G.prog);
  const tints = new Float32Array(MAXTINT * 3);
  (o.tints || []).slice(0, MAXTINT).forEach((c, i) => { tints[i * 3] = c[0]; tints[i * 3 + 1] = c[1]; tints[i * 3 + 2] = c[2]; });
  gl.uniform3fv(U.uTint, tints);
  gl.uniform1f(U.uU, o.U || 64);
  for (const c of cells) {
    gl.scissor(c.sx, c.sy, c.w, c.h);
    gl.uniform2f(U.uOrg, c.sx, c.sy);
    cellUniforms(gl, U, c);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // pass 2: the ink outline
  gl.bindFramebuffer(gl.FRAMEBUFFER, G.fB);
  gl.scissor(0, 0, W, H);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(G.progO);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, G.tA);
  gl.uniform1i(UO.uTex, 0);
  gl.uniform1f(UO.uW, o.outline ?? 1);
  const ink = o.ink || [0.06, 0.1, 0.22, 0.92];
  gl.uniform4f(UO.uInk, ink[0], ink[1], ink[2], ink[3]);
  for (const c of cells) {
    gl.scissor(c.sx, c.sy, c.w, c.h);
    gl.uniform4f(UO.uBox, c.sx, c.sy, c.sx + c.w, c.sy + c.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return px;
}

// ------------------------------------------------------------------------------------------------ CPU fallback
const LD = [-0.4705, -0.6796, 0.5631], WIN = [-0.51, -0.6375, 0.5775], SUN = [-0.3221, -0.4831, 0.8141], LR = [0.5622, 0.6133, 0.5549];
const sst = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
const FILM_OFF = [0, 0.33, 0.67];
function filmJS(f, out) { for (let k = 0; k < 3; k++) out[k] = 0.56 + 0.44 * Math.cos(6.28318 * (f + FILM_OFF[k])); return out; }
function glossyJS(n, c, g, out) {
  const ndl = n[0] * LD[0] + n[1] * LD[1] + n[2] * LD[2];
  const R = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1];
  const rim = Math.pow(1 - cl(n[2], 0, 1), 3);
  const sp = (Math.pow(Math.max(0, R[0] * SUN[0] + R[1] * SUN[1] + R[2] * SUN[2]), 40) * 1.1 + sst(0.88, 0.93, R[0] * WIN[0] + R[1] * WIN[1] + R[2] * WIN[2]) * 0.5) * g;
  const k1 = 0.46 + 0.62 * Math.max(ndl, 0), sh = cl(0.5 + ndl, 0, 1), up = Math.max(n[1], 0);
  const add = [0.1, 0.18, 0.26], tintS = [0.78, 0.82, 1], rimC = [0.55, 0.88, 1];
  for (let k = 0; k < 3; k++) {
    let v = c[k] * k1 + c[k] * add[k] * up;
    v = v * tintS[k] + (v - v * tintS[k]) * sh;
    out[k] = Math.min(1, v + rimC[k] * rim * 0.4 + sp);
  }
  return out;
}
function shadeJS(px, py, c, tints, U, out) {
  let zO = -1e9, nO = [0, 0, 1], cO = null, gO = 0;
  const S = c.spheres || [];
  for (const s of S) {
    if ((s.kind || 0) < 1.5) continue;
    const dx = px - s.x, dy = py - s.y, d2 = dx * dx + dy * dy, r2 = s.r * s.r;
    if (d2 >= r2) continue;
    const h = Math.sqrt(r2 - d2), z = s.z + h;
    if (z > zO) { zO = z; nO = [dx / s.r, dy / s.r, h / s.r]; cO = tints[s.tint || 0]; gO = s.film || 0; }
  }
  const C = c.cone;
  if (C) {
    const A = C.apex, H = C.h, D = C.dir, R = C.r;
    const wx = px - A[0], wy = py - A[1], c2 = (H * H) / (H * H + R * R);
    const a = D[2], b0 = wx * D[0] + wy * D[1];
    const qa = a * a - c2, qb = 2 * a * b0, qc = b0 * b0 - c2 * (wx * wx + wy * wy);
    let best = -1e9, bn = D, bv = [0, 0, 0], bu = 1;
    if (Math.abs(qa) > 1e-6) {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const sgn of [1, -1]) {
          const s = (-qb + sgn * sq) / (2 * qa), hh = wx * D[0] + wy * D[1] + s * D[2];
          if (hh > 0 && hh < H && A[2] + s > best) {
            best = A[2] + s;
            const rad = [wx - D[0] * hh, wy - D[1] * hh, s - D[2] * hh], rl = Math.hypot(rad[0], rad[1], rad[2]) || 1;
            const nn = [rad[0] / rl - D[0] * (R / H), rad[1] / rl - D[1] * (R / H), rad[2] / rl - D[2] * (R / H)], nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
            bn = [nn[0] / nl, nn[1] / nl, nn[2] / nl]; bv = [wx, wy, s]; bu = hh / H;
          }
        }
      }
    }
    if (Math.abs(a) > 1e-4) {
      const s = (H - b0) / a, B = [wx - D[0] * H, wy - D[1] * H, s - D[2] * H];
      if (B[0] * B[0] + B[1] * B[1] + B[2] * B[2] < R * R && A[2] + s > best) { best = A[2] + s; bn = D; bv = [wx, wy, s]; bu = 1; }
    }
    if (best > zO) {
      zO = best; nO = bn[2] < 0 ? [-bn[0], -bn[1], -bn[2]] : bn;
      const e1 = C.e1, e2 = [D[1] * e1[2] - D[2] * e1[1], D[2] * e1[0] - D[0] * e1[2], D[0] * e1[1] - D[1] * e1[0]];
      const hd = bv[0] * D[0] + bv[1] * D[1] + bv[2] * D[2], rad = [bv[0] - D[0] * hd, bv[1] - D[1] * hd, bv[2] - D[2] * hd];
      const ang = Math.atan2(rad[0] * e2[0] + rad[1] * e2[1] + rad[2] * e2[2], rad[0] * e1[0] + rad[1] * e1[1] + rad[2] * e1[2]);
      let st = bu * 3 + ang / 6.28318 + 0.1; st -= Math.floor(st);
      const band = sst(0.47, 0.53, st) * (1 - sst(0.94, 1, st));
      const ta = tints[C.tintA || 0], tb = tints[C.tintB || 0];
      cO = [ta[0] + (tb[0] - ta[0]) * band, ta[1] + (tb[1] - ta[1]) * band, ta[2] + (tb[2] - ta[2]) * band]; gO = 1;
    }
  }
  for (const T of c.tori || []) {
    const cc = T.c, R = T.R, ax = T.n, rr = T.rr;
    const dx = px - cc[0], dy = py - cc[1];
    if (dx * dx + dy * dy > (R + rr + 1) * (R + rr + 1)) continue;
    let z = cc[2] + R + rr, hit = false;
    for (let k = 0; k < 48; k++) {
      const qz = z - cc[2], h = dx * ax[0] + dy * ax[1] + qz * ax[2];
      const pr = [dx - ax[0] * h, dy - ax[1] * h, qz - ax[2] * h];
      const sd = Math.hypot(Math.hypot(pr[0], pr[1], pr[2]) - R, h) - rr;
      if (sd < 0.04) { hit = true; break; }
      z -= Math.max(sd, 0.06);
      if (z < cc[2] - R - rr) break;
    }
    if (hit && z > zO) {
      const qz = z - cc[2], h = dx * ax[0] + dy * ax[1] + qz * ax[2];
      const pr = [dx - ax[0] * h, dy - ax[1] * h, qz - ax[2] * h], pl = Math.hypot(pr[0], pr[1], pr[2]) || 1;
      const nn = [dx - (pr[0] / pl) * R, dy - (pr[1] / pl) * R, qz - (pr[2] / pl) * R + 1e-4], nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
      zO = z; nO = [nn[0] / nl, nn[1] / nl, nn[2] / nl]; cO = tints[T.tint || 0]; gO = 1;
    }
  }
  let zF = -1e9, zF2 = -1e9, nF = [0, 0, 1], iF = null, L = 0, rims = 0, back = 0;
  for (const s of S) {
    if ((s.kind || 0) > 1.5) continue;
    const dx = px - s.x, dy = py - s.y, d2 = dx * dx + dy * dy, r2 = s.r * s.r;
    if (d2 >= r2) continue;
    const h = Math.sqrt(r2 - d2), zf = s.z + h, zb = s.z - h;
    if (zf <= zO) continue;
    L += (zf - Math.max(zb, zO)) * (s.dens ?? 2);
    const nz = h / s.r, rim = Math.pow(1 - nz, 3);
    rims += rim;
    if (zb > zO) { const dl = Math.sqrt(d2) || 1e-3; back += rim * Math.max(0, (dx / dl) * 0.6 + (dy / dl) * 0.8); }
    if (zf > zF) { zF2 = zF; zF = zf; iF = s; nF = [dx / s.r, dy / s.r, nz]; } else if (zf > zF2) zF2 = zf;
  }
  let op = null;
  if (zO > -1e8) op = glossyJS(nO, cO || [1, 1, 1], gO, [0, 0, 0]);
  if (!iF) { if (op) { out[0] = op[0]; out[1] = op[1]; out[2] = op[2]; out[3] = 1; } else out[3] = 0; return out; }
  const tn = tints[iF.tint || 0];
  const ndl = nF[0] * LD[0] + nF[1] * LD[1] + nF[2] * LD[2];
  const F = Math.pow(1 - nF[2], 2), frim = Math.pow(1 - nF[2], 3);
  const ir = filmJS((iF.film || 0) + 1.1 * F + 0.3 * nF[0] - 0.2 * nF[1], [0, 0, 0]);
  const sh = cl(0.5 + 0.62 * ndl, 0, 1), shk = [0.62, 0.68, 0.94], bo = [0, 0.07, 0.11];
  const crease = zF2 > -1e8 ? 1 - sst(0, U * 0.045, zF - zF2) : 0;
  const Rv = [2 * nF[2] * nF[0], 2 * nF[2] * nF[1], 2 * nF[2] * nF[2] - 1];
  const win = sst(0.865, 0.905, Rv[0] * WIN[0] + Rv[1] * WIN[1] + Rv[2] * WIN[2]);
  const sun = Math.pow(Math.max(0, Rv[0] * SUN[0] + Rv[1] * SUN[1] + Rv[2] * SUN[2]), 140);
  const lr = sst(0.95, 0.975, Rv[0] * LR[0] + Rv[1] * LR[1] + Rv[2] * LR[2]) * 0.5;
  const aV = 1 - Math.exp(-L / U);
  const a = cl(Math.min(0.3, (iF.dens ?? 2) * 0.4) + 0.66 * aV + F * 0.5 + crease * 0.15, 0, 1);
  const hl = cl(win * 0.78 + sun + lr, 0, 1);
  const bk = [0.62, 0.94, 1];
  let ra = a;
  const rc = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let base = tn[k] * shk[k] + (tn[k] - tn[k] * shk[k]) * sh + bo[k] * Math.max(nF[1], 0);
    let v = base + (ir[k] - base) * F * 0.72;
    v += ir[k] * cl(rims - frim, 0, 1.5) * 0.3 + bk[k] * back * 0.3;
    v += (Math.min(1, ir[k] * 1.12) - v) * crease * 0.4;
    rc[k] = v * a * (1 - hl) + hl;
  }
  ra = ra + hl * (1 - ra);
  if (op) { for (let k = 0; k < 3; k++) rc[k] += op[k] * (1 - ra); ra = 1; }
  out[3] = ra;
  for (let k = 0; k < 3; k++) out[k] = ra > 1e-4 ? Math.min(1, rc[k] / ra) : 0;
  return out;
}
function cpuPage(cells, W, H, o) {
  const px = new Uint8Array(W * H * 4), tints = o.tints || [[1, 1, 1]], U = o.U || 64, out = [0, 0, 0, 0];
  for (const c of cells) {
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      shadeJS(x + 0.5, y + 0.5, c, tints, U, out);
      if (out[3] <= 0.002) continue;
      const i = ((c.sy + y) * W + c.sx + x) * 4;
      px[i] = out[0] * 255; px[i + 1] = out[1] * 255; px[i + 2] = out[2] * 255; px[i + 3] = out[3] * 255;
    }
    // the ink outline (same rule as the GL pass)
    const wO = o.outline ?? 1, R = Math.ceil(wO), ink = o.ink || [0.06, 0.1, 0.22, 0.92];
    const src = new Float32Array(c.w * c.h);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) src[y * c.w + x] = px[((c.sy + y) * W + c.sx + x) * 4 + 3] / 255;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const ca = src[y * c.w + x];
      if (ca >= 0.3) continue;
      let m = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const w = cl(wO + 1 - Math.hypot(dx, dy), 0, 1);
        if (w <= 0) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= c.w || yy >= c.h) continue;
        m = Math.max(m, sst(0.08, 0.45, src[yy * c.w + xx]) * w);
      }
      const ia = m * ink[3] * (1 - sst(0.02, 0.3, ca));
      if (ia <= 0) continue;
      const i = ((c.sy + y) * W + c.sx + x) * 4;
      const a = ca + ia * (1 - ca);
      for (let k = 0; k < 3; k++) px[i + k] = ((px[i + k] / 255) * ca + ink[k] * ia * (1 - ca)) / a * 255;
      px[i + 3] = a * 255;
    }
  }
  return px;
}

// ------------------------------------------------------------------------------------------------ packing
export function renderBubbleCells(cells, o = {}) {
  const t0 = performance.now();
  const useGL = bubbleGLAvailable();
  const pages = [];
  let i = 0;
  while (i < cells.length) {
    // shelf-pack as many cells as fit one page
    const list = [];
    let x = 0, y = 0, rowH = 0, W = 0;
    for (; i < cells.length; i++) {
      const c = cells[i];
      c.w = Math.max(1, Math.min(PAGE, Math.ceil(c.w))); c.h = Math.max(1, Math.min(PAGE, Math.ceil(c.h)));
      if (x + c.w > PAGE) { x = 0; y += rowH + 1; rowH = 0; }
      if (y + c.h > PAGE) { if (list.length) break; }
      c.sx = x; c.sy = y;
      x += c.w + 1; rowH = Math.max(rowH, c.h); W = Math.max(W, x);
      list.push(c);
    }
    const H = Math.min(PAGE, y + rowH);
    W = Math.min(PAGE, Math.max(1, W));
    let px = null;
    if (useGL) { try { px = glPage(list, W, H, o); STATS.gl++; } catch (e) { px = null; glFailed = true; G = null; } }
    if (!px) { px = cpuPage(list, W, H, o); STATS.cpu++; }
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const img = g.createImageData(W, H);
    img.data.set(px.subarray(0, W * H * 4));
    g.putImageData(img, 0, 0);
    for (const c of list) c.page = canvas;
    pages.push(canvas);
    STATS.px += W * H;
  }
  STATS.cells += cells.length;
  STATS.ms += performance.now() - t0;
  return pages;
}
