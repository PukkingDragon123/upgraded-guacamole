// Low-poly 3D renderer (phase 6). OWNER: Fish agent (extends it); everyone builds on this API.
// Faceted, flat-shaded triangle meshes with vertex colours and/or a painted texture, lit with a soft key light,
// specular, rim light and fog - the look of the user's low-poly seal reference. One shared WebGL2 context renders
// either a single model into a 2D canvas sprite (fish, NPCs: cache the frames) or a whole 3D scene (aquarium, intro).
//
//   lpAvailable() -> bool                              WebGL2 is usable
//   new MeshBuilder()                                  .tri(a, b, c, col, uva?, uvb?, uvc?) / .quad(a, b, c, d, col)
//                                                      .build() -> LPMesh (flat normals per face)
//   LPMesh {count, bounds:{min, max, center, radius}}
//   renderMesh(mesh, o) -> HTMLCanvasElement | null    o: {w, h, yaw, pitch, roll (radians), scale (px per unit),
//       center?, light?:[x,y,z], ambient?, spec?, shine?, rim?, rimColor?, texture?: canvas, alpha?, tint?: [r,g,b,a]}
//   new LPScene(w, h)                                  .add(mesh, model4x4, {texture, alpha}) .clear()
//       .camera({eye, target, up, fov, near, far}) .render(opts) -> the scene's own canvas (draw it with drawImage)
//   M4 (re-exported mat4 helpers from voxgl.js) + T4 {trs(t, rx, ry, rz, s)} for model matrices
import { M4 } from './voxgl.js';

export { M4 };

let gl = null, glCanvas = null, prog = null, failed = false;
const texCache = new WeakMap();

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
uniform vec4 uTint; uniform vec3 uFogCol; uniform float uFog;
out vec4 frag;
void main() {
  vec3 n = normalize(vNrm);
  vec3 l = normalize(uLight);
  vec3 v = normalize(uEye - vWorld);
  vec3 base = vCol;
  float a = uAlpha;
  if (uUseTex > 0.5) { vec4 t = texture(uTex, vUv); base *= t.rgb; a *= t.a; }
  if (a < 0.02) discard;
  float d = max(dot(n, l), 0.0);
  float wrap = max((dot(n, l) + 0.35) / 1.35, 0.0);
  vec3 col = base * (uAmb + (1.0 - uAmb) * mix(d, wrap, 0.5));
  vec3 h = normalize(l + v);
  col += vec3(1.0) * uSpec * pow(max(dot(n, h), 0.0), uShine);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uRimCol * uRim * rim;
  col = mix(col, uTint.rgb, uTint.a);
  float fogK = clamp(uFog * length(uEye - vWorld) * 0.002, 0.0, 1.0);
  col = mix(col, uFogCol, fogK);
  frag = vec4(col * a, a);
}`;

function init() {
  if (gl || failed) return gl;
  try {
    glCanvas = document.createElement('canvas');
    glCanvas.width = glCanvas.height = 64;
    gl = glCanvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) { failed = true; return null; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    prog.u = {};
    for (const n of ['uMVP', 'uModel', 'uLight', 'uEye', 'uAmb', 'uSpec', 'uShine', 'uRim', 'uRimCol', 'uTex', 'uUseTex', 'uAlpha', 'uTint', 'uFogCol', 'uFog']) prog.u[n] = gl.getUniformLocation(prog, n);
    prog.a = { aPos: gl.getAttribLocation(prog, 'aPos'), aNrm: gl.getAttribLocation(prog, 'aNrm'), aCol: gl.getAttribLocation(prog, 'aCol'), aUv: gl.getAttribLocation(prog, 'aUv') };
  } catch (e) {
    console.warn('lowpoly: WebGL2 unavailable', e);
    gl = null; failed = true;
  }
  return gl;
}

export function lpAvailable() { return !!init(); }

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

const hexRgb = (c) => {
  if (Array.isArray(c)) return c;
  const h = String(c).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class MeshBuilder {
  constructor() { this.v = []; }
  // a, b, c: [x, y, z] counter-clockwise when seen from outside; col: '#hex' or [r, g, b] (0..1); uv*: [u, v]
  tri(a, b, c, col = '#ffffff', ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const k = hexRgb(col);
    for (const [p, uv] of [[a, ua], [b, ub], [c, uc]]) this.v.push(p[0], p[1], p[2], nx, ny, nz, k[0], k[1], k[2], uv[0], uv[1]);
    return this;
  }
  quad(a, b, c, d, col, uv = null) {
    this.tri(a, b, c, col, uv?.[0], uv?.[1], uv?.[2]);
    return this.tri(a, c, d, col, uv?.[0], uv?.[2], uv?.[3]);
  }
  build() {
    const data = new Float32Array(this.v);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 11) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], data[i + k]); max[k] = Math.max(max[k], data[i + k]); }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
    return new LPMesh(data, data.length / 11, { min, max, center, radius });
  }
}

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
};

function bindTexture(tex) {
  let t = texCache.get(tex);
  if (!t || tex._lpDirty) {
    t = t || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texCache.set(tex, t);
    tex._lpDirty = false;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, t);
}

function setCommon(o, eye) {
  const u = prog.u, L = o.light || [-0.45, 0.8, 0.55];
  gl.uniform3f(u.uLight, L[0], L[1], L[2]);
  gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
  gl.uniform1f(u.uAmb, o.ambient ?? 0.42);
  gl.uniform1f(u.uSpec, o.spec ?? 0.35);
  gl.uniform1f(u.uShine, o.shine ?? 24);
  gl.uniform1f(u.uRim, o.rim ?? 0.35);
  const rc = hexRgb(o.rimColor || '#bff4ff');
  gl.uniform3f(u.uRimCol, rc[0], rc[1], rc[2]);
  const fc = hexRgb(o.fogColor || '#2a7fc0');
  gl.uniform3f(u.uFogCol, fc[0], fc[1], fc[2]);
  gl.uniform1f(u.uFog, o.fog ?? 0);
  gl.uniform1i(u.uTex, 0);
}

function drawMesh(mesh, mvp, model, o) {
  const u = prog.u;
  mesh.upload();
  gl.uniformMatrix4fv(u.uMVP, false, mvp);
  gl.uniformMatrix4fv(u.uModel, false, model);
  gl.uniform1f(u.uAlpha, o.alpha ?? 1);
  const tint = o.tint || [0, 0, 0, 0];
  gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], tint[3]);
  if (o.texture) { bindTexture(o.texture); gl.uniform1f(u.uUseTex, 1); } else gl.uniform1f(u.uUseTex, 0);
  gl.bindVertexArray(mesh.vao);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  gl.bindVertexArray(null);
}

function prepare(w, h, clear = [0, 0, 0, 0]) {
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(prog);
}

// Render one mesh, orthographic, centred, into a fresh 2D canvas (cache the result: this is not free).
export function renderMesh(mesh, o = {}) {
  if (!init() || !mesh) return null;
  const w = Math.max(1, Math.round(o.w || 64)), h = Math.max(1, Math.round(o.h || 64));
  prepare(w, h);
  const c = o.center || mesh.bounds.center, s = o.scale || (Math.min(w, h) * 0.45) / mesh.bounds.radius;
  const model = T4.trs([0, 0, 0], o.pitch || 0, o.yaw || 0, o.roll || 0, 1);
  const shift = M4.ident(); shift[12] = -c[0]; shift[13] = -c[1]; shift[14] = -c[2];
  const M = M4.mul(model, shift);
  // orthographic projection in pixels: x right, y up, camera looking down -z
  const P = new Float32Array(16);
  P[0] = (2 * s) / w; P[5] = (2 * s) / h; P[10] = -1 / (mesh.bounds.radius * 4); P[15] = 1;
  if (o.offset) { P[12] = (2 * o.offset[0]) / w; P[13] = (-2 * o.offset[1]) / h; }
  setCommon(o, [0, 0, mesh.bounds.radius * 6]);
  drawMesh(mesh, M4.mul(P, M), M, o);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(glCanvas, 0, 0);
  return out;
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
  add(mesh, model = M4.ident(), o = {}) { if (mesh) this.items.push({ mesh, model, o }); return this; }
  camera(c) { Object.assign(this.cam, c); return this; }
  // opts: {light, ambient, spec, shine, rim, rimColor, fog, fogColor, background:[r,g,b,a]}
  render(opts = {}) {
    if (!init()) return null;
    prepare(this.w, this.h, opts.background || [0, 0, 0, 0]);
    const c = this.cam;
    const P = M4.persp((c.fov * Math.PI) / 180, this.w / this.h, c.near, c.far);
    const V = M4.look(c.eye, c.target, c.up);
    const VP = M4.mul(P, V);
    setCommon(opts, c.eye);
    // opaque first, then transparent back-to-front
    const opaque = this.items.filter((it) => (it.o.alpha ?? 1) >= 1);
    const trans = this.items.filter((it) => (it.o.alpha ?? 1) < 1);
    const depth = (it) => { const m = it.model; return Math.hypot(m[12] - c.eye[0], m[13] - c.eye[1], m[14] - c.eye[2]); };
    trans.sort((a, b) => depth(b) - depth(a));
    for (const it of opaque) drawMesh(it.mesh, M4.mul(VP, it.model), it.model, { ...opts, ...it.o });
    gl.depthMask(false);
    for (const it of trans) drawMesh(it.mesh, M4.mul(VP, it.model), it.model, { ...opts, ...it.o });
    gl.depthMask(true);
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, this.w, this.h);
    g.drawImage(glCanvas, 0, 0);
    return this.canvas;
  }
}

// ------------------------------------------------------------------------------------------------ shape helpers
// Lofted body: rings of `seg` vertices along x; ring(i) -> {x, ry, rz, cy} (half-height, half-width, centre y).
// colorAt(i, j, ring) -> colour for the quad between ring i..i+1, segment j..j+1. Closed nose/tail caps.
export function loft(mb, rings, seg, colorAt) {
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
