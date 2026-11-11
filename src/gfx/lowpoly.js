// Low-poly 3D renderer (phase 6). OWNER: Creatures agent (extends it); everyone builds on this API.
// Faceted, flat-shaded triangle meshes with vertex colours and/or a painted texture, lit with a soft key light,
// specular, rim light and fog - the look of the user's low-poly seal reference. One shared WebGL2 context renders
// either a single model into a 2D canvas sprite (fish, NPCs: cache the frames) or a whole 3D scene (aquarium, intro).
//
//   lpAvailable() -> bool                              WebGL2 is usable
//   new MeshBuilder()                                  .tri(a, b, c, col, uva?, uvb?, uvc?) / .quad(a, b, c, d, col, uv4?)
//                                                      .build() -> LPMesh (flat normals per face) / .count (triangles)
//   LPMesh {count, bounds:{min, max, center, radius}}  .dispose() frees its GL buffer
//   renderMesh(mesh, o) -> HTMLCanvasElement | null    o: {w, h, yaw, pitch, roll (radians), scale (px per unit),
//       center?, light?:[x,y,z], ambient?, spec?, shine?, rim?, rimColor?, texture?: canvas, alpha?, tint?: [r,g,b,a],
//       matrix?: 4x4 rotation used instead of yaw/pitch/roll, offset?: [px, py],
//       env? (0..1 glossy sky reflection), iri? (0..1 iridescent sheen), emit? (0..1 unlit), emitTex? (texture alpha
//       = emissive mask instead of opacity), sky?, ground? (env colours),
//       cull? (false = two-sided), parts?: [{mesh, texture, alpha, spec, shine, rim, env, iri, emit, emitTex, tint,
//       depthWrite, cull}] drawn after
//       `mesh` (mesh may be null) in order; translucent parts (alpha < 1 or depthWrite: false) do not write depth}
//   renderSheet(cells, o) -> canvas                    many renders in ONE GL pass + ONE readback: cells laid out in
//       a grid of o.cols columns of o.w x o.h; cell = {mesh, parts, matrix | yaw/pitch/roll, offset, ...overrides}
//   lpProject(p, o, mesh?) -> [x, y]                   pixel position of model point p in a renderMesh/renderSheet cell
//   new LPScene(w, h)                                  .add(mesh, model4x4, {texture, alpha, ...part opts}) .clear()
//       .camera({eye, target, up, fov, near, far}) .render(opts) -> the scene's own canvas (draw it with drawImage)
//   M4 (re-exported mat4 helpers from voxgl.js) + T4 {trs(t, rx, ry, rz, s), rot(rx, ry, rz) (R = Rx * Ry * Rz:
//       roll, then yaw, then camera pitch)} for model matrices
//   Shape helpers: loft(mb, rings, seg, colorAt, o?), fin(mb, outline, z, col), ellipsoid(mb, c, r, seg, rings, col, o?),
//       tube(mb, pts, radius(t), sides, col, o?)   o: {smooth: true | crease degrees} = smooth-shaded (averaged normals)
// Phase 7 (smooth, additive; every default is unchanged):
//   new MeshBuilder(cap, {smooth: true | creaseDeg})   build() averages vertex normals of coincident vertices (smooth
//       shading instead of facets; with a crease angle, edges sharper than it stay hard). .triC(a, b, c, ca, cb, cc,
//       uva?, uvb?, uvc?) per-vertex colours; .smoothRange(fromTri, toTri?, crease?) smooths only those triangles;
//       build({smooth}) overrides. smoothNormals(data, crease?, from?, to?) does it on raw vertex floats.
//   LPMesh.smooth = true for smoothed meshes: the shader then trusts interpolated normals (front faces keep them, two-
//       sided back faces flip by gl_FrontFacing) instead of flipping per pixel, so silhouettes stay clean.
//   render option vivid (0..1, creature sprites): saturation lift of the painted colour, a brighter exposure, a glossy
//       reflection that keeps the body colour, and a rim / sheen tinted by the surface hue (0 = unchanged).
//   render options soft (0..1) + softColor: plush subsurface-ish shading (wrapped smooth diffuse, hemisphere sky /
//       ground ambient, a warm scatter band at the terminator, a soft velvet rim); 0 = the classic look.
// Textures: any canvas (uploaded premultiplied, filtered without fringes); emitTex reads texture alpha 0.5..1 as
// emissive 1..0 (opaque skins with glowing photophores). Set canvas._lpSmooth = true for linear + mipmapped filtering (painted skins), and
// canvas._lpDirty = true after repainting it. renderSheet batches many sprite renders into one GL pass / readback.
import { M4 } from './voxgl.js';

export { M4 };

let gl = null, glCanvas = null, prog = null, failed = false, copyMode = 'auto';
let GLW = 0, GLH = 0;
const T = { draw: 0, copy: 0, tex: 0, n: 0, rp: 0, put: 0 };
export function lpStats() { return { ...T, w: GLW, h: GLH }; }
const tnow = () => performance.now();
const texCache = new WeakMap();
const MAX_GL = 4096;

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec3 aCol; in vec2 aUv;
uniform mat4 uMVP; uniform mat4 uModel;
out vec3 vNrm; out vec3 vCol; out vec2 vUv; out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNrm = mat3(uModel) * aNrm;
  vCol = aCol; vUv = aUv;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vNrm; in vec3 vCol; in vec2 vUv; in vec3 vWorld;
uniform vec3 uLight; uniform vec3 uEye; uniform float uAmb; uniform float uSpec; uniform float uShine;
uniform float uRim; uniform vec3 uRimCol; uniform sampler2D uTex; uniform float uUseTex; uniform float uAlpha;
uniform vec4 uTint; uniform vec3 uFogCol; uniform float uFog; uniform float uOrtho;
uniform float uEnv; uniform float uIri; uniform float uEmit; uniform float uEmitTex; uniform vec3 uSky; uniform vec3 uGround;
uniform float uSmoothN; uniform float uSoft; uniform vec3 uSoftCol; uniform float uVivid;
out vec4 frag;
void main() {
  vec3 n = normalize(vNrm);
  vec3 l = normalize(uLight);
  vec3 v = uOrtho > 0.5 ? vec3(0.0, 0.0, 1.0) : normalize(uEye - vWorld);
  if (uSmoothN > 0.5) {
    // smooth meshes: interpolated normals graze the view at silhouettes; bend them back instead of flipping them
    if (!gl_FrontFacing) n = -n;
    float dv = dot(n, v);
    if (dv < 0.02) n = normalize(n - v * (dv - 0.02));
  } else if (dot(n, v) < 0.0) n = -n; // two-sided (thin fins, open shells)
  vec3 base = vCol;
  float a = uAlpha;
  float emit = uEmit;
  if (uUseTex > 0.5) {
    vec4 t = texture(uTex, vUv);
    vec3 trgb = t.a > 0.001 ? t.rgb / t.a : vec3(0.0);
    if (uEmitTex > 0.5) { base *= trgb; emit = max(emit, clamp((1.0 - t.a) * 2.0, 0.0, 1.0)); }
    else { base *= trgb; a *= t.a; }
  }
  if (a < 0.02) discard;
  // vivid (creature sprites): a saturation lift of the painted colour before lighting
  if (uVivid > 0.0) base = max(mix(vec3(dot(base, vec3(0.299, 0.587, 0.114))), base, 1.0 + 0.3 * uVivid), 0.0);
  float d = max(dot(n, l), 0.0);
  float wrap = max((dot(n, l) + 0.35) / 1.35, 0.0);
  vec3 col = base * (uAmb + (1.0 - uAmb) * mix(d, wrap, 0.5)) * (1.0 + 0.14 * uVivid);
  float nv = max(dot(n, v), 0.0);
  if (uSoft > 0.0) {
    // plush, subsurface-ish: a wide smooth wrap, sky / ground tinted ambient, warm light bleeding into the terminator
    float ndl = dot(n, l);
    float sd = clamp((ndl + 0.6) / 1.6, 0.0, 1.0);
    sd = sd * sd * (3.0 - 2.0 * sd);
    vec3 hemi = mix(uGround, uSky, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
    vec3 softC = base * (uAmb * mix(vec3(1.0), hemi, 0.55) + (1.0 - uAmb) * sd);
    float band = clamp(1.0 - abs(ndl + 0.05) * 2.4, 0.0, 1.0);
    softC += base * uSoftCol * band * 0.2;
    softC += uSoftCol * pow(1.0 - nv, 2.2) * 0.16 * clamp(0.65 - ndl * 0.5, 0.0, 1.0);
    col = mix(col, softC, clamp(uSoft, 0.0, 1.0));
  }
  if (uEnv > 0.0) {
    vec3 r = reflect(-v, n);
    vec3 env = mix(uGround, uSky, smoothstep(-0.25, 0.75, r.y));
    float fres = 0.12 + 0.88 * pow(1.0 - nv, 2.5);
    // vivid keeps the body colour under the glossy reflection instead of greying it toward the sky / ground
    col = mix(col, col * (0.55 + 0.33 * uVivid) + env * (0.6 - 0.32 * uVivid), uEnv * fres * (1.0 - 0.4 * uVivid));
    col += uSky * uEnv * 0.5 * (1.0 - 0.3 * uVivid) * pow(max(r.y, 0.0), 6.0);
  }
  if (uIri > 0.0) {
    vec3 iri = 0.5 + 0.5 * cos(6.2831 * (nv * 1.4 + vec3(0.0, 0.33, 0.67)));
    col += iri * uIri * 0.35 * (1.0 - nv * 0.6) * (0.4 + 0.6 * d);
  }
  vec3 h = normalize(l + v);
  col += vec3(1.0) * uSpec * pow(max(dot(n, h), 0.0), uShine);
  float rim = pow(1.0 - nv, 3.0);
  // vivid: the rim / sheen takes the surface's own hue (a coloured glossy edge, not a white haze)
  vec3 rimC = mix(uRimCol, clamp(base * 1.35 + vec3(0.1), 0.0, 1.0), 0.6 * clamp(uVivid, 0.0, 1.0));
  col += rimC * uRim * rim;
  col = mix(col, base * 1.15 + vec3(0.06), clamp(emit, 0.0, 1.0));
  col = mix(col, uTint.rgb, uTint.a);
  float fogK = clamp(uFog * length(uEye - vWorld) * 0.002, 0.0, 1.0);
  col = mix(col, uFogCol, fogK);
  frag = vec4(col * a, a);
}`;

const UNIFORMS = ['uMVP', 'uModel', 'uLight', 'uEye', 'uAmb', 'uSpec', 'uShine', 'uRim', 'uRimCol', 'uTex', 'uUseTex', 'uAlpha', 'uTint', 'uFogCol', 'uFog', 'uOrtho', 'uEnv', 'uIri', 'uEmit', 'uEmitTex', 'uSky', 'uGround', 'uSmoothN', 'uSoft', 'uSoftCol', 'uVivid'];

function init() {
  if (gl || failed) return gl;
  try {
    if (typeof document === 'undefined') { failed = true; return null; }
    // hardware GL: 4x MSAA + GPU-side copies; software GL (SwiftShader, llvmpipe): no MSAA + exact readbacks
    const make = (aa) => {
      glCanvas = document.createElement('canvas');
      glCanvas.width = glCanvas.height = 64;
      GLW = GLH = 64;
      return glCanvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: aa, preserveDrawingBuffer: true });
    };
    gl = make(true);
    if (!gl) { failed = true; return null; }
    const ri = gl.getExtension('WEBGL_debug_renderer_info');
    const rname = ri ? String(gl.getParameter(ri.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(rname)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      gl = make(false);
      if (!gl) { failed = true; return null; }
      if (copyMode === 'auto') copyMode = 'pixels';
    } else if (copyMode === 'auto') copyMode = 'draw';
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    prog.u = {};
    for (const n of UNIFORMS) prog.u[n] = gl.getUniformLocation(prog, n);
    prog.a = { aPos: gl.getAttribLocation(prog, 'aPos'), aNrm: gl.getAttribLocation(prog, 'aNrm'), aCol: gl.getAttribLocation(prog, 'aCol'), aUv: gl.getAttribLocation(prog, 'aUv') };
    glCanvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); failed = true; gl = null; });
  } catch (e) {
    console.warn('lowpoly: WebGL2 unavailable', e);
    gl = null; failed = true;
  }
  return gl;
}

export function lpAvailable() { return !!init(); }
/** True when sprites can be rendered at all (WebGL2, or the Canvas2D software fallback). */
export function lpCanRender() { return !!init() || (typeof document !== 'undefined' && softOn); }
let softOn = true;
export function lpSoftFallback(on) { softOn = !!on; }
/** Testing: behave as if WebGL2 were missing (software fallback only). */
export function lpDisableGL() { if (!gl) failed = true; }

// ------------------------------------------------------------------------------------------------ meshes
export class LPMesh {
  constructor(data, count, bounds) { this.data = data; this.count = count; this.bounds = bounds; this.vao = null; this.buf = null; }
  upload() {
    if (this.vao || !init()) return;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.STATIC_DRAW);
    const S = 11 * 4, a = prog.a;
    const at = (loc, n, off) => { if (loc < 0) return; gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S, off * 4); };
    at(a.aPos, 3, 0); at(a.aNrm, 3, 3); at(a.aCol, 3, 6); at(a.aUv, 2, 9);
    gl.bindVertexArray(null);
  }
  dispose() { if (gl && this.buf) { gl.deleteBuffer(this.buf); gl.deleteVertexArray(this.vao); } this.vao = this.buf = null; }
}

const hexCache = new Map();
const hexRgb = (c) => {
  if (Array.isArray(c)) return c;
  let k = hexCache.get(c);
  if (k) return k;
  const h = String(c).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16);
  k = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  if (hexCache.size < 4096) hexCache.set(c, k);
  return k;
};
export { hexRgb as lpColor };

export class MeshBuilder {
  // o.smooth: true (average the normals of coincident vertices: smooth shading) or a crease angle in degrees
  constructor(capTris = 256, o = {}) { this.buf = new Float32Array(capTris * 33); this.n = 0; this.smooth = o.smooth || false; this.ranges = null; }
  get count() { return this.n / 33; }            // triangles so far
  get v() { return this.buf.subarray(0, this.n); } // raw vertex floats (11 per vertex: pos, normal, colour, uv)
  // a, b, c: [x, y, z] counter-clockwise when seen from outside; col: '#hex' or [r, g, b] (0..1); uv*: [u, v]
  tri(a, b, c, col = '#ffffff', ua = Z2, ub = Z2, uc = Z2) {
    const k = hexRgb(col);
    return this.triC(a, b, c, k, k, k, ua, ub, uc);
  }
  // the same with one colour per vertex (painted gradients across a face)
  triC(a, b, c, ca, cb, cc, ua = Z2, ub = Z2, uc = Z2) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) return this; // degenerate
    nx /= l; ny /= l; nz /= l;
    const ka = hexRgb(ca), kb = hexRgb(cb), kc = hexRgb(cc);
    if (this.n + 33 > this.buf.length) { const nb = new Float32Array(this.buf.length * 2 + 33); nb.set(this.buf.subarray(0, this.n)); this.buf = nb; }
    const B = this.buf;
    let o = this.n;
    ua = ua || Z2; ub = ub || Z2; uc = uc || Z2;
    B[o] = a[0]; B[o + 1] = a[1]; B[o + 2] = a[2]; B[o + 3] = nx; B[o + 4] = ny; B[o + 5] = nz; B[o + 6] = ka[0]; B[o + 7] = ka[1]; B[o + 8] = ka[2]; B[o + 9] = ua[0]; B[o + 10] = ua[1]; o += 11;
    B[o] = b[0]; B[o + 1] = b[1]; B[o + 2] = b[2]; B[o + 3] = nx; B[o + 4] = ny; B[o + 5] = nz; B[o + 6] = kb[0]; B[o + 7] = kb[1]; B[o + 8] = kb[2]; B[o + 9] = ub[0]; B[o + 10] = ub[1]; o += 11;
    B[o] = c[0]; B[o + 1] = c[1]; B[o + 2] = c[2]; B[o + 3] = nx; B[o + 4] = ny; B[o + 5] = nz; B[o + 6] = kc[0]; B[o + 7] = kc[1]; B[o + 8] = kc[2]; B[o + 9] = uc[0]; B[o + 10] = uc[1]; o += 11;
    this.n = o;
    return this;
  }
  quad(a, b, c, d, col, uv = null) {
    this.tri(a, b, c, col, uv?.[0], uv?.[1], uv?.[2]);
    return this.tri(a, c, d, col, uv?.[0], uv?.[2], uv?.[3]);
  }
  // smooth-shade only triangles [fromTri, toTri) (e.g. one lofted body inside an otherwise faceted mesh)
  smoothRange(fromTri, toTri = this.count, crease = 180) {
    if (toTri > fromTri) (this.ranges ||= []).push([fromTri * 33, toTri * 33, crease === true ? 180 : crease]);
    return this;
  }
  build(o = {}) {
    const data = this.buf.slice(0, this.n);
    const sm = o.smooth ?? this.smooth;
    let smooth = false;
    if (sm) { smoothNormals(data, sm === true ? 180 : sm); smooth = true; }
    else if (this.ranges) for (const [a, b, cr] of this.ranges) { smoothNormals(data, cr, a, Math.min(b, data.length)); smooth = true; }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 11) for (let k = 0; k < 3; k++) { const q = data[i + k]; if (q < min[k]) min[k] = q; if (q > max[k]) max[k] = q; }
    if (!data.length) { min.fill(0); max.fill(0); }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
    const mesh = new LPMesh(data, data.length / 11, { min, max, center, radius });
    if (smooth) mesh.smooth = true;
    return mesh;
  }
}

/**
 * Smooth shading: replace the normals of vertex floats data[from, to) (11 floats per vertex, whole triangles) by the
 * corner-angle weighted average of the face normals of every triangle sharing that vertex position. Faces meeting
 * at more than `crease` degrees keep a hard edge. Works in place; returns data.
 */
export function smoothNormals(data, crease = 180, from = 0, to = data.length) {
  const nv = Math.floor((to - from) / 33) * 3;
  if (nv < 3) return data;
  const fn = new Float32Array(nv * 3), wt = new Float32Array(nv);
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < nv; t += 3) {
    const o = from + t * 11;
    const ax = data[o], ay = data[o + 1], az = data[o + 2], bx = data[o + 11], by = data[o + 12], bz = data[o + 13], cx = data[o + 22], cy = data[o + 23], cz = data[o + 24];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az, e3x = cx - bx, e3y = cy - by, e3z = cz - bz;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const l1 = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z) || 1, l2 = Math.sqrt(e2x * e2x + e2y * e2y + e2z * e2z) || 1, l3 = Math.sqrt(e3x * e3x + e3y * e3y + e3z * e3z) || 1;
    const angA = Math.acos(Math.max(-1, Math.min(1, (e1x * e2x + e1y * e2y + e1z * e2z) / (l1 * l2))));
    const angB = Math.acos(Math.max(-1, Math.min(1, (-e1x * e3x - e1y * e3y - e1z * e3z) / (l1 * l3))));
    const ang = [angA, angB, Math.max(0, Math.PI - angA - angB)];
    for (let k = 0; k < 3; k++) { const i = t + k; fn[i * 3] = nx; fn[i * 3 + 1] = ny; fn[i * 3 + 2] = nz; wt[i] = ang[k]; }
    for (const q of [ax, ay, az, bx, by, bz, cx, cy, cz]) { if (q < lo) lo = q; if (q > hi) hi = q; }
  }
  // weld coincident vertices: quantised position -> hash table of representatives
  const inv = 1 / (Math.max(1e-6, hi - lo) * 2e-6);
  const qx = new Int32Array(nv), qy = new Int32Array(nv), qz = new Int32Array(nv);
  let size = 1; while (size < nv * 2) size <<= 1;
  const mask = size - 1, table = new Int32Array(size).fill(-1), rep = new Int32Array(nv), first = new Int32Array(nv).fill(-1), next = new Int32Array(nv).fill(-1);
  for (let i = 0; i < nv; i++) {
    const o = from + i * 11;
    const x = Math.round((data[o] - lo) * inv), y = Math.round((data[o + 1] - lo) * inv), z = Math.round((data[o + 2] - lo) * inv);
    qx[i] = x; qy[i] = y; qz[i] = z;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const r = table[h];
      if (r < 0) { table[h] = i; rep[i] = i; break; }
      if (qx[r] === x && qy[r] === y && qz[r] === z) { rep[i] = r; break; }
      h = (h + 1) & mask;
    }
    const r = rep[i];
    next[i] = first[r]; first[r] = i;
  }
  const cosC = crease >= 180 ? -2 : Math.cos((crease * Math.PI) / 180);
  const acc = cosC < -1 ? new Float32Array(nv * 3) : null;
  if (acc) for (let i = 0; i < nv; i++) { const r = rep[i] * 3, w = wt[i]; acc[r] += fn[i * 3] * w; acc[r + 1] += fn[i * 3 + 1] * w; acc[r + 2] += fn[i * 3 + 2] * w; }
  for (let i = 0; i < nv; i++) {
    let sx, sy, sz;
    if (acc) { const r = rep[i] * 3; sx = acc[r]; sy = acc[r + 1]; sz = acc[r + 2]; }
    else {
      sx = sy = sz = 0;
      const fx = fn[i * 3], fy = fn[i * 3 + 1], fz = fn[i * 3 + 2];
      for (let j = first[rep[i]]; j >= 0; j = next[j]) {
        const gx = fn[j * 3], gy = fn[j * 3 + 1], gz = fn[j * 3 + 2];
        if (fx * gx + fy * gy + fz * gz < cosC) continue;
        sx += gx * wt[j]; sy += gy * wt[j]; sz += gz * wt[j];
      }
    }
    const l = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (l < 1e-9) continue;
    const o = from + i * 11;
    data[o + 3] = sx / l; data[o + 4] = sy / l; data[o + 5] = sz / l;
  }
  return data;
}
const Z2 = [0, 0];

// model matrix helpers
export const T4 = {
  trs(t = [0, 0, 0], rx = 0, ry = 0, rz = 0, s = 1) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    const S = Array.isArray(s) ? s : [s, s, s];
    // R = Ry * Rx * Rz (yaw, then pitch, then roll)
    const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
    const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
    const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
    const m = new Float32Array(16);
    m[0] = r00 * S[0]; m[1] = r10 * S[0]; m[2] = r20 * S[0];
    m[4] = r01 * S[1]; m[5] = r11 * S[1]; m[6] = r21 * S[1];
    m[8] = r02 * S[2]; m[9] = r12 * S[2]; m[10] = r22 * S[2];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    return m;
  },
  // R = Rx(rx) * Ry(ry) * Rz(rz): roll about the body axis first, then yaw, then a camera tilt about x
  rot(rx = 0, ry = 0, rz = 0) {
    const m = new Float32Array(16);
    const x = M4.ident(), y = M4.ident(), z = M4.ident();
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    x[5] = cx; x[6] = sx; x[9] = -sx; x[10] = cx;
    y[0] = cy; y[2] = -sy; y[8] = sy; y[10] = cy;
    z[0] = cz; z[1] = sz; z[4] = -sz; z[5] = cz;
    M4.mul(x, M4.mul(y, z), m);
    return m;
  },
};

function bindTexture(tex) {
  let t = texCache.get(tex);
  if (!t || tex._lpDirty) {
    const t0 = tnow();
    t = t || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // filtered premultiplied texels: no dark fringes
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
    if (tex._lpSmooth) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texCache.set(tex, t);
    tex._lpDirty = false;
    T.tex += tnow() - t0;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, t);
}

/** Free the GL copy of a texture canvas (call when dropping a painted skin from a cache). */
export function lpFreeTexture(tex) {
  const t = gl && texCache.get(tex);
  if (t) { gl.deleteTexture(t); texCache.delete(tex); }
}

function setCommon(o, eye, ortho = false) {
  const u = prog.u, L = o.light || [-0.45, 0.8, 0.55];
  gl.uniform3f(u.uLight, L[0], L[1], L[2]);
  gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
  gl.uniform1f(u.uAmb, o.ambient ?? 0.42);
  const rc = hexRgb(o.rimColor || '#bff4ff');
  gl.uniform3f(u.uRimCol, rc[0], rc[1], rc[2]);
  const fc = hexRgb(o.fogColor || '#2a7fc0');
  gl.uniform3f(u.uFogCol, fc[0], fc[1], fc[2]);
  gl.uniform1f(u.uFog, o.fog ?? 0);
  gl.uniform1f(u.uOrtho, ortho ? 1 : 0);
  gl.uniform1f(u.uVivid, o.vivid ?? 0);
  const sk = hexRgb(o.sky || '#eafcff'), gr = hexRgb(o.ground || '#1f5f8a');
  gl.uniform3f(u.uSky, sk[0], sk[1], sk[2]);
  gl.uniform3f(u.uGround, gr[0], gr[1], gr[2]);
  gl.uniform1i(u.uTex, 0);
}

function drawMesh(mesh, mvp, model, o) {
  const u = prog.u;
  mesh.upload();
  if (!mesh.vao) return;
  gl.uniformMatrix4fv(u.uMVP, false, mvp);
  gl.uniformMatrix4fv(u.uModel, false, model);
  gl.uniform1f(u.uAlpha, o.alpha ?? 1);
  gl.uniform1f(u.uSpec, o.spec ?? 0.35);
  gl.uniform1f(u.uShine, o.shine ?? 24);
  gl.uniform1f(u.uRim, o.rim ?? 0.35);
  gl.uniform1f(u.uEnv, o.env ?? 0);
  gl.uniform1f(u.uIri, o.iri ?? 0);
  gl.uniform1f(u.uEmit, o.emit ?? 0);
  gl.uniform1f(u.uEmitTex, o.emitTex ? 1 : 0);
  gl.uniform1f(u.uSmoothN, mesh.smooth ? 1 : 0);
  gl.uniform1f(u.uSoft, o.soft ?? 0);
  const sc = hexRgb(o.softColor || '#ffc9b8');
  gl.uniform3f(u.uSoftCol, sc[0], sc[1], sc[2]);
  const tint = o.tint || [0, 0, 0, 0];
  gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], tint[3]);
  if (o.texture) { bindTexture(o.texture); gl.uniform1f(u.uUseTex, 1); } else gl.uniform1f(u.uUseTex, 0);
  if (o.cull === false) gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(mesh.vao);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  gl.bindVertexArray(null);
  if (o.cull === false) gl.enable(gl.CULL_FACE);
}

// Size the GL canvas to exactly w x h: readbacks and the MSAA resolve cost scale with the canvas, so renders batch
// many sprites into one sheet instead of growing the canvas.
function ensureSize(w, h) {
  w = Math.min(MAX_GL, w); h = Math.min(MAX_GL, h);
  if (w !== GLW || h !== GLH) {
    GLW = w; GLH = h;
    glCanvas.width = GLW; glCanvas.height = GLH;
  }
}

// Bind a top-left based sub-rectangle of the GL canvas as the render target region and clear it.
function region(x, y, w, h, clear = [0, 0, 0, 0]) {
  gl.viewport(x, GLH - y - h, w, h);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, GLH - y - h, w, h);
  gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

function prepare(w, h, clear = [0, 0, 0, 0]) {
  ensureSize(w, h);
  region(0, 0, w, h, clear);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(prog);
}

const finish = () => gl.disable(gl.SCISSOR_TEST);

// Copy the top-left W x H of the GL canvas into a 2D canvas. 'pixels' = readPixels + putImageData (one exact
// readback; fast with software GL), 'draw' = drawImage (GPU-to-GPU on hardware GL).
export function lpCopyMode(m) { copyMode = m; }
let pixBuf = null;
function copyOut(out, W, H, ox = 0, oy = 0) {
  const mode = copyMode === 'pixels' ? 'pixels' : 'draw';
  const g = out.getContext('2d');
  if (mode === 'draw') { g.drawImage(glCanvas, 0, 0, W, H, ox, oy, W, H); return; }
  const n = W * H * 4;
  if (!pixBuf || pixBuf.length < n) pixBuf = new Uint8Array(n);
  const ta = tnow();
  gl.readPixels(0, GLH - H, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixBuf);
  T.rp += tnow() - ta;
  const img = g.createImageData(W, H);
  const d = img.data, row = W * 4;
  // GL rows are bottom-up and premultiplied: flip and un-premultiply
  for (let y = 0; y < H; y++) {
    const so = (H - 1 - y) * row, dO = y * row;
    for (let x = 0; x < row; x += 4) {
      const a = pixBuf[so + x + 3];
      if (!a) continue;
      if (a === 255) { d[dO + x] = pixBuf[so + x]; d[dO + x + 1] = pixBuf[so + x + 1]; d[dO + x + 2] = pixBuf[so + x + 2]; d[dO + x + 3] = 255; continue; }
      const k = 255 / a;
      d[dO + x] = pixBuf[so + x] * k; d[dO + x + 1] = pixBuf[so + x + 1] * k; d[dO + x + 2] = pixBuf[so + x + 2] * k; d[dO + x + 3] = a;
    }
  }
  const tb = tnow();
  g.putImageData(img, ox, oy);
  T.put += tnow() - tb;
}

// --- orthographic sprite projection shared by renderMesh / renderSheet / lpProject
function spriteMats(mesh, o, w, h) {
  const b = mesh?.bounds || o.bounds || { center: [0, 0, 0], radius: 1 };
  const c = o.center || b.center, R = o.radius || b.radius;
  const s = o.scale || (Math.min(w, h) * 0.45) / R;
  const rot = o.matrix || T4.trs([0, 0, 0], o.pitch || 0, o.yaw || 0, o.roll || 0, 1);
  const shift = M4.ident(); shift[12] = -c[0]; shift[13] = -c[1]; shift[14] = -c[2];
  const M = M4.mul(rot, shift);
  const P = new Float32Array(16);
  P[0] = (2 * s) / w; P[5] = (2 * s) / h; P[10] = -1 / (R * 4); P[15] = 1;
  if (o.offset) { P[12] = (2 * o.offset[0]) / w; P[13] = (-2 * o.offset[1]) / h; }
  return { M, MVP: M4.mul(P, M), s, R };
}

function drawCell(cell, o, w, h) {
  const first = cell.mesh || cell.parts?.[0]?.mesh;
  const { M, MVP, R } = spriteMats(first, o, w, h);
  setCommon(o, [0, 0, R * 6], true);
  if (cell.mesh) drawMesh(cell.mesh, MVP, M, o);
  for (const p of cell.parts || []) {
    if (!p || !p.mesh) continue;
    const po = { ...o, texture: undefined, tint: o.tint, ...p };
    const trans = (po.alpha ?? 1) < 1 || p.depthWrite === false;
    if (trans) gl.depthMask(false);
    drawMesh(p.mesh, MVP, M, po);
    if (trans) gl.depthMask(true);
  }
}

// Render one mesh, orthographic, centred, into a fresh 2D canvas (cache the result: this is not free).
export function renderMesh(mesh, o = {}) {
  if (!mesh && !o.parts) return null;
  if (!init()) return softRender([{ mesh, parts: o.parts }], o, 1);
  const w = Math.max(1, Math.round(o.w || 64)), h = Math.max(1, Math.round(o.h || 64));
  prepare(w, h);
  drawCell({ mesh, parts: o.parts }, o, w, h);
  finish();
  const out = o.out || document.createElement('canvas');
  if (!o.out) { out.width = w; out.height = h; }
  copyOut(out, w, h, o.outX || 0, o.outY || 0);
  return out;
}

/**
 * Render many sprite cells in one GL pass and copy them out with one readback (the expensive part).
 * cells: [{mesh, parts, matrix | yaw / pitch / roll, offset, center, scale, ...per-cell overrides}];
 * o: shared options of renderMesh plus {w, h (cell size), cols (default all in one row), out?: canvas to draw into
 * at (outX, outY)}. Returns the sheet canvas (cell i at ((i % cols) * w, floor(i / cols) * h)).
 */
export function renderSheet(cells, o = {}) {
  if (!cells.length) return null;
  if (!init()) return softRender(cells, o, o.cols || cells.length);
  const w = Math.max(1, Math.round(o.w || 64)), h = Math.max(1, Math.round(o.h || 64));
  let cols = Math.max(1, Math.min(cells.length, o.cols || cells.length));
  // keep inside the GL canvas limit
  cols = Math.max(1, Math.min(cols, Math.floor(MAX_GL / w)));
  const rows = Math.ceil(cells.length / cols);
  const W = cols * w, H = Math.min(MAX_GL, rows * h);
  const t0 = tnow();
  prepare(W, H);
  for (let i = 0; i < cells.length; i++) {
    const x = (i % cols) * w, y = Math.floor(i / cols) * h;
    if (y + h > MAX_GL) break;
    region(x, y, w, h);
    drawCell(cells[i], { ...o, ...cells[i] }, w, h);
  }
  finish();
  const t1 = tnow();
  const out = o.out || document.createElement('canvas');
  if (!o.out) { out.width = W; out.height = H; }
  copyOut(out, W, H, o.outX || 0, o.outY || 0);
  T.draw += t1 - t0; T.copy += tnow() - t1; T.n++;
  return out;
}

/** Pixel position (top-left origin) of model point p in a w x h sprite rendered with options o. */
export function lpProject(p, o = {}, mesh = null) {
  const w = Math.max(1, Math.round(o.w || 64)), h = Math.max(1, Math.round(o.h || 64));
  const b = mesh?.bounds || o.bounds || { center: [0, 0, 0], radius: 1 };
  const c = o.center || b.center, R = o.radius || b.radius;
  const s = o.scale || (Math.min(w, h) * 0.45) / R;
  const m = o.matrix || T4.trs([0, 0, 0], o.pitch || 0, o.yaw || 0, o.roll || 0, 1);
  const x = p[0] - c[0], y = p[1] - c[1], z = (p[2] || 0) - c[2];
  const qx = m[0] * x + m[4] * y + m[8] * z, qy = m[1] * x + m[5] * y + m[9] * z;
  return [w / 2 + qx * s + (o.offset?.[0] || 0), h / 2 - qy * s + (o.offset?.[1] || 0)];
}

// A whole 3D scene with a perspective camera (aquarium, intro, 3D gear ...). render() draws into the shared GL
// canvas and copies to this scene's own 2D canvas, which the caller draws wherever it likes.
export class LPScene {
  constructor(w, h) {
    this.w = w; this.h = h; this.items = [];
    this.cam = { eye: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 1000 };
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
  }
  resize(w, h) { this.w = w; this.h = h; this.canvas.width = w; this.canvas.height = h; }
  clear() { this.items.length = 0; return this; }
  // o: {texture, alpha, spec, shine, rim, env, iri, emit, emitTex, tint, depthWrite, cull} (per item)
  add(mesh, model = M4.ident(), o = {}) { if (mesh) this.items.push({ mesh, model, o }); return this; }
  camera(c) { Object.assign(this.cam, c); return this; }
  // opts: {light, ambient, spec, shine, rim, rimColor, fog, fogColor, sky, ground, background:[r,g,b,a]}
  render(opts = {}) {
    if (!init()) return null;
    prepare(this.w, this.h, opts.background || [0, 0, 0, 0]);
    const c = this.cam;
    const P = M4.persp((c.fov * Math.PI) / 180, this.w / this.h, c.near, c.far);
    const V = M4.look(c.eye, c.target, c.up);
    const VP = M4.mul(P, V);
    setCommon(opts, c.eye);
    // opaque first, then transparent back-to-front
    const isTrans = (it) => (it.o.alpha ?? 1) < 1 || it.o.depthWrite === false;
    const opaque = this.items.filter((it) => !isTrans(it));
    const trans = this.items.filter(isTrans);
    const depth = (it) => { const m = it.model; return Math.hypot(m[12] - c.eye[0], m[13] - c.eye[1], m[14] - c.eye[2]); };
    trans.sort((a, b) => depth(b) - depth(a));
    for (const it of opaque) drawMesh(it.mesh, M4.mul(VP, it.model), it.model, { ...opts, ...it.o });
    gl.depthMask(false);
    for (const it of trans) drawMesh(it.mesh, M4.mul(VP, it.model), it.model, { ...opts, ...it.o });
    gl.depthMask(true);
    finish();
    this.canvas.getContext('2d').clearRect(0, 0, this.w, this.h);
    copyOut(this.canvas, this.w, this.h);
    return this.canvas;
  }
}

// ------------------------------------------------------------------------------------------------ shape helpers
// Lofted body: rings of `seg` vertices along x; ring(i) -> {x, ry, rz, cy} (half-height, half-width, centre y).
// colorAt(i, j, ring) -> colour for the quad between ring i..i+1, segment j..j+1. Closed nose/tail caps.
// o.smooth: true | crease degrees -> smooth-shaded (averaged vertex normals) instead of faceted.
export function loft(mb, rings, seg, colorAt, o = {}) {
  const t0 = mb.count;
  const pts = rings.map((r) => {
    const out = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      out.push([r.x, (r.cy || 0) + Math.cos(a) * r.ry, Math.sin(a) * r.rz]);
    }
    return out;
  });
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    mb.quad(pts[i][j], pts[i][j2], pts[i + 1][j2], pts[i + 1][j], colorAt(i, j, rings[i]));
  }
  const capA = [rings[0].x, rings[0].cy || 0, 0], capB = [rings[rings.length - 1].x, rings[rings.length - 1].cy || 0, 0];
  for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    mb.tri(capA, pts[0][j2], pts[0][j], colorAt(0, j, rings[0]));
    mb.tri(capB, pts[pts.length - 1][j], pts[pts.length - 1][j2], colorAt(rings.length - 2, j, rings[rings.length - 2]));
  }
  if (o.smooth && mb.smoothRange) mb.smoothRange(t0, mb.count, o.smooth);
  return mb;
}

// A thin double-sided fin from a polygon outline in the x/y plane at depth z.
export function fin(mb, outline, z, col) {
  for (let i = 1; i < outline.length - 1; i++) {
    const a = [outline[0][0], outline[0][1], z], b = [outline[i][0], outline[i][1], z], c = [outline[i + 1][0], outline[i + 1][1], z];
    mb.tri(a, b, c, col); mb.tri(a, c, b, col);
  }
  return mb;
}

// Low-poly ellipsoid at c with radii r [rx, ry, rz]; col: colour or fn(nx, ny, nz) -> colour (face centre normal).
export function ellipsoid(mb, c, r, seg = 10, rings = 7, col = '#ffffff', o = {}) {
  const t0 = mb.count;
  const P = (i, j) => {
    const th = (i / rings) * Math.PI, ph = (j / seg) * Math.PI * 2;
    return [c[0] + Math.sin(th) * Math.cos(ph) * r[0], c[1] + Math.cos(th) * r[1], c[2] + Math.sin(th) * Math.sin(ph) * r[2]];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = P(i, j), b = P(i, j + 1), d = P(i + 1, j), e = P(i + 1, j + 1);
    let k = col;
    if (typeof col === 'function') {
      const th = ((i + 0.5) / rings) * Math.PI, ph = ((j + 0.5) / seg) * Math.PI * 2;
      k = col(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
    if (i > 0) mb.tri(a, b, e, k);
    if (i < rings - 1) mb.tri(a, e, d, k);
  }
  if (o.smooth && mb.smoothRange) mb.smoothRange(t0, mb.count, o.smooth);
  return mb;
}

// Low-poly tube through pts [[x,y,z], ...] with radius(t 0..1) and `sides` facets; col: colour or fn(t, side).
export function tube(mb, pts, radius = () => 0.1, sides = 6, col = '#ffffff', o = {}) {
  const n = pts.length;
  if (n < 2) return mb;
  const t0 = mb.count;
  const rings = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // a normal that rotates minimally along the tube
    let nx, ny, nz;
    if (prevN) { const d = prevN[0] * tx + prevN[1] * ty + prevN[2] * tz; nx = prevN[0] - d * tx; ny = prevN[1] - d * ty; nz = prevN[2] - d * tz; }
    else { const up = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const d = up[0] * tx + up[1] * ty + up[2] * tz; nx = up[0] - d * tx; ny = up[1] - d * ty; nz = up[2] - d * tz; }
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    prevN = [nx, ny, nz];
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const r = radius(i / (n - 1));
    const ring = [];
    for (let s = 0; s < sides; s++) {
      const a2 = (s / sides) * Math.PI * 2, ca = Math.cos(a2) * r, sa = Math.sin(a2) * r;
      ring.push([pts[i][0] + nx * ca + bx * sa, pts[i][1] + ny * ca + by * sa, pts[i][2] + nz * ca + bz * sa]);
    }
    rings.push(ring);
  }
  const cf = (t, s) => (typeof col === 'function' ? col(t, s) : col);
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    mb.quad(rings[i][s], rings[i + 1][s], rings[i + 1][s2], rings[i][s2], cf((i + 0.5) / (n - 1), s));
  }
  for (let s = 1; s < sides - 1; s++) {
    mb.tri(rings[0][0], rings[0][s + 1], rings[0][s], cf(0, s));
    mb.tri(rings[n - 1][0], rings[n - 1][s], rings[n - 1][s + 1], cf(1, s));
  }
  if (o.smooth && mb.smoothRange) mb.smoothRange(t0, mb.count, o.smooth);
  return mb;
}

// ------------------------------------------------------------------------------------------------ software fallback
// Without WebGL2, sprites are drawn with Canvas2D: flat-shaded triangles sorted back to front, the skin texture
// sampled once per face. Slower and coarser, but creatures stay visible (results are cached by the callers).
const texPix = new WeakMap();
function texel(tex, u, v) {
  let p = texPix.get(tex);
  if (!p) {
    try { p = { w: tex.width, h: tex.height, d: tex.getContext('2d').getImageData(0, 0, tex.width, tex.height).data }; } catch { p = { w: 1, h: 1, d: new Uint8ClampedArray([255, 255, 255, 255]) }; }
    texPix.set(tex, p);
  }
  const x = Math.min(p.w - 1, Math.max(0, Math.floor(u * p.w))), y = Math.min(p.h - 1, Math.max(0, Math.floor(v * p.h)));
  const i = (y * p.w + x) * 4;
  return [p.d[i] / 255, p.d[i + 1] / 255, p.d[i + 2] / 255, p.d[i + 3] / 255];
}

function softRender(cells, o, colsIn) {
  if (!softOn || typeof document === 'undefined') return null;
  const w = Math.max(1, Math.round(o.w || 64)), h = Math.max(1, Math.round(o.h || 64));
  const cols = Math.max(1, Math.min(cells.length, colsIn));
  const rows = Math.ceil(cells.length / cols);
  const out = o.out || document.createElement('canvas');
  if (!o.out) { out.width = cols * w; out.height = rows * h; }
  const g = out.getContext('2d');
  const L0 = o.light || [-0.45, 0.8, 0.55], ll = Math.hypot(L0[0], L0[1], L0[2]) || 1, L = [L0[0] / ll, L0[1] / ll, L0[2] / ll];
  const H = [L[0], L[1], L[2] + 1], hl = Math.hypot(H[0], H[1], H[2]); H[0] /= hl; H[1] /= hl; H[2] /= hl;
  cells.forEach((cell0, ci) => {
    const cell = { ...o, ...cell0 };
    const ox = (ci % cols) * w + (o.outX || 0), oy = Math.floor(ci / cols) * h + (o.outY || 0);
    const first = cell.mesh || cell.parts?.[0]?.mesh;
    const b = first?.bounds || { center: [0, 0, 0], radius: 1 };
    const c = cell.center || b.center, R = cell.radius || b.radius;
    const sc = cell.scale || (Math.min(w, h) * 0.45) / R;
    const m = cell.matrix || T4.trs([0, 0, 0], cell.pitch || 0, cell.yaw || 0, cell.roll || 0, 1);
    const tris = [];
    const add = (mesh, po) => {
      if (!mesh) return;
      const d = mesh.data, tex = po.texture;
      const alpha0 = po.alpha ?? 1, amb = po.ambient ?? 0.42, spec = po.spec ?? 0.35, shine = po.shine ?? 24, rim = po.rim ?? 0.35, emit0 = po.emit ?? 0;
      for (let i = 0; i < d.length; i += 33) {
        const P = [0, 11, 22].map((k) => {
          const x = d[i + k] - c[0], y = d[i + k + 1] - c[1], z = d[i + k + 2] - c[2];
          return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
        });
        let nx = m[0] * d[i + 3] + m[4] * d[i + 4] + m[8] * d[i + 5], ny = m[1] * d[i + 3] + m[5] * d[i + 4] + m[9] * d[i + 5], nz = m[2] * d[i + 3] + m[6] * d[i + 4] + m[10] * d[i + 5];
        if (nz < 0) { if (po.cull !== false) continue; nx = -nx; ny = -ny; nz = -nz; }
        let col = [d[i + 6], d[i + 7], d[i + 8]], a = alpha0, emit = emit0;
        if (tex) {
          const t = texel(tex, (d[i + 9] + d[i + 20] + d[i + 31]) / 3, (d[i + 10] + d[i + 21] + d[i + 32]) / 3);
          col = [col[0] * t[0], col[1] * t[1], col[2] * t[2]];
          if (po.emitTex) emit = Math.max(emit, Math.min(1, (1 - t[3]) * 2)); else a *= t[3];
        }
        if (a < 0.02) continue;
        const viv = po.vivid ?? 0;
        if (viv > 0) { const lu = col[0] * 0.299 + col[1] * 0.587 + col[2] * 0.114; col = col.map((v) => Math.max(0, lu + (v - lu) * (1 + 0.3 * viv))); }
        const dd = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]), wrap = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2] + 0.35) / 1.35);
        const k = (amb + (1 - amb) * (dd + wrap) / 2) * (1 + 0.14 * viv);
        const sp = spec * Math.pow(Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]), shine), rr = rim * Math.pow(1 - nz, 3) * 0.8;
        const lit = col.map((v) => v * k + sp + rr * 0.8);
        const fin = lit.map((v, j) => Math.min(1, v + (col[j] * 1.15 + 0.06 - v) * emit));
        tris.push({ z: (P[0][2] + P[1][2] + P[2][2]) / 3, P, col: fin, a });
      }
    };
    if (cell.mesh) add(cell.mesh, cell);
    for (const p of cell.parts || []) if (p?.mesh) add(p.mesh, { ...cell, texture: undefined, ...p });
    tris.sort((A, B) => A.z - B.z);
    g.save();
    g.beginPath(); g.rect(ox, oy, w, h); g.clip();
    for (const t of tris) {
      g.fillStyle = `rgba(${Math.round(t.col[0] * 255)},${Math.round(t.col[1] * 255)},${Math.round(t.col[2] * 255)},${t.a.toFixed(3)})`;
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const x = ox + w / 2 + t.P[k][0] * sc + (cell.offset?.[0] || 0), y = oy + h / 2 - t.P[k][1] * sc + (cell.offset?.[1] || 0);
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.fill();
      if (t.a >= 0.99) { g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke(); } // hide hairline seams
    }
    g.restore();
  });
  return out;
}
