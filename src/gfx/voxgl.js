// WebGL2 voxel scene renderer (phase 5, Intro agent): a real perspective 3D camera through voxel worlds, with
// Frutiger Aero shaders. Used by the cinematic opening (src/game/intro3d.js).
//
//   const E = createVoxGL(W, H, {msaa, lowPower})   -> engine | null (no WebGL2)
//   E.mesh(voxelModel, {scale, origin})            -> GPU mesh (culled faces, per-vertex AO, per-voxel jitter)
//   E.sphere(), E.atlas(canvas, usedH)             unit sphere mesh / per-frame sprite atlas upload
//   E.render(scene)                                one frame into E.canvas (draw it onto the 2D game canvas)
//   E.project([x, y, z]) -> [sx, sy, depth] | null  E.ppu(depth) pixels per world unit at a depth
//
// World: X right, Y UP (0 = the sea surface, negative = underwater), Z toward the viewer (right handed).
// Passes: planar sea reflection (half res) -> MSAA HDR scene (sky, voxel meshes with sun + sky light, AO,
// Blinn gloss, Aero rim + chrome env reflection, haze / underwater absorption + caustics; camera-facing sprite
// billboards from the atlas (fish, people, Clip); the glossy sea (analytic waves, fresnel reflection, glitter,
// shore foam, Snell's window from below); glass shells; 3D droplet / bubble / sparkle particles; lines)
// -> resolve -> bloom (dual filter), god rays (radial blur toward the sun), DOF blur (half res)
// -> composite: depth-of-field on far layers, bloom, rays, analytic lens flares (sun + glints), zoom blur,
// chromatic aberration, refracting water drops and bubbles on the lens, filmic tone map, grade, vignette, dither.

const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------ mat4
export const M4 = {
  ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(a, b, o = new Float32Array(16)) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) * nf; m[11] = -1; m[14] = 2 * f * n * nf;
    return m;
  },
  look(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx; m[4] = xy; m[5] = yy; m[6] = zy; m[8] = xz; m[9] = yz; m[10] = zz;
    m[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); m[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); m[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); m[15] = 1;
    return m;
  },
  inv(m) {
    const o = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M4.ident();
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  // translate(pos) * rotY(yaw) * rotX(pitch) * rotZ(roll) * scale(s) * translate(-pivot); angles in radians
  model(pos = [0, 0, 0], o = {}) {
    const s = o.scale ?? 1, sx = (o.sx ?? 1) * s, sy = (o.sy ?? 1) * s, sz = (o.sz ?? 1) * s;
    const cy = Math.cos(o.yaw || 0), syw = Math.sin(o.yaw || 0), cp = Math.cos(o.pitch || 0), sp = Math.sin(o.pitch || 0);
    const cr = Math.cos(o.roll || 0), sr = Math.sin(o.roll || 0);
    // R = Ry * Rx * Rz
    const r00 = cy * cr + syw * sp * sr, r01 = -cy * sr + syw * sp * cr, r02 = syw * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -syw * cr + cy * sp * sr, r21 = syw * sr + cy * sp * cr, r22 = cy * cp;
    const m = new Float32Array(16);
    m[0] = r00 * sx; m[1] = r10 * sx; m[2] = r20 * sx;
    m[4] = r01 * sy; m[5] = r11 * sy; m[6] = r21 * sy;
    m[8] = r02 * sz; m[9] = r12 * sz; m[10] = r22 * sz;
    const p = o.pivot || [0, 0, 0];
    m[12] = pos[0] - (m[0] * p[0] + m[4] * p[1] + m[8] * p[2]);
    m[13] = pos[1] - (m[1] * p[0] + m[5] * p[1] + m[9] * p[2]);
    m[14] = pos[2] - (m[2] * p[0] + m[6] * p[1] + m[10] * p[2]);
    m[15] = 1;
    return m;
  },
};

// ------------------------------------------------------------------------------------------------ mesher
const hexRGB = (h) => {
  const s = String(h || '#ffffff').replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16) || 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const AO_K = [0.42, 0.62, 0.82, 1];
// face: normal axis a, sign s; tangents b, c; corners in (b, c)
const FACES = [];
for (const [a, s, n] of [[0, 1, 0], [0, -1, 1], [1, 1, 2], [1, -1, 3], [2, 1, 4], [2, -1, 5]]) {
  const b = (a + 1) % 3, c = (a + 2) % 3;
  const corners = s > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
  FACES.push({ a, s, n, b, c, corners });
}

// Mesh a VoxelModel: only exposed faces, smooth 4-level vertex AO, the palette's colour / gloss / emissive.
// o: {scale = 1, origin = [0,0,0] (model coords mapped to the world origin), jitter = 1, keep(x,y,z,c) filter}
export function meshVoxels(model, o = {}) {
  const { nx, ny, nz, data } = model;
  const pal = model.palette.map((p) => {
    if (!p) return null;
    const [r, g, b] = hexRGB(p.color);
    const spec = Math.min(1.5, p.spec ?? 0.35), pow = p.specPow ?? 10;
    return { r, g, b, spec: Math.round(Math.min(255, spec * 170)), gloss: Math.round(Math.min(255, (pow / 40) * 255)), em: Math.round(Math.min(255, (+p.emissive || 0) * 255)), jit: p.jitter ?? 0.04, glass: p.glass ? 1 : 0 };
  });
  const keep = o.keep || null;
  const S = o.scale ?? 1, org = o.origin || [0, 0, 0];
  const jk = o.jitter ?? 1;
  const NXY = nx * ny;
  const solid = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : data[x + nx * (y + ny * z)]);
  let cap = 4096, n = 0;
  let pos = new Float32Array(cap * 3), col = new Uint8Array(cap * 4), mat = new Uint8Array(cap * 4);
  const grow = () => {
    cap *= 2;
    const p2 = new Float32Array(cap * 3); p2.set(pos); pos = p2;
    const c2 = new Uint8Array(cap * 4); c2.set(col); col = c2;
    const m2 = new Uint8Array(cap * 4); m2.set(mat); mat = m2;
  };
  const idx = [];
  const P = [0, 0, 0], D = [0, 0, 0];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const row = nx * (y + ny * z);
    for (let x = 0; x < nx; x++) {
      const c = data[row + x];
      if (!c) continue;
      const pe = pal[c];
      if (!pe) continue;
      if (keep && !keep(x, y, z, c)) continue;
      // per-voxel brightness jitter (stable hash)
      let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const jr = ((((h ^ (h >>> 16)) >>> 0) / 4294967295) - 0.5) * 2 * pe.jit * jk;
      const k = 1 + jr * 0.9;
      const cr = Math.max(0, Math.min(255, pe.r * k)), cg = Math.max(0, Math.min(255, pe.g * k)), cb = Math.max(0, Math.min(255, pe.b * k));
      for (const F of FACES) {
        D[0] = D[1] = D[2] = 0; D[F.a] = F.s;
        if (solid(x + D[0], y + D[1], z + D[2])) continue;
        if (n + 4 > cap) grow();
        const base = n;
        const ao = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) {
          const [cu, cv] = F.corners[i];
          P[0] = x; P[1] = y; P[2] = z;
          P[F.a] += F.s > 0 ? 1 : 0;
          P[F.b] += cu; P[F.c] += cv;
          // AO: the three voxels around this corner in the layer outside the face
          const Q = [x, y, z]; Q[F.a] += F.s;
          const du = cu ? 1 : -1, dv = cv ? 1 : -1;
          const q1 = [...Q]; q1[F.b] += du;
          const q2 = [...Q]; q2[F.c] += dv;
          const q3 = [...Q]; q3[F.b] += du; q3[F.c] += dv;
          const s1 = solid(q1[0], q1[1], q1[2]) ? 1 : 0, s2 = solid(q2[0], q2[1], q2[2]) ? 1 : 0, s3 = solid(q3[0], q3[1], q3[2]) ? 1 : 0;
          const lvl = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
          ao[i] = lvl;
          const vi = n + i;
          pos[vi * 3] = (P[0] - org[0]) * S; pos[vi * 3 + 1] = (P[1] - org[1]) * S; pos[vi * 3 + 2] = (P[2] - org[2]) * S;
          col[vi * 4] = cr; col[vi * 4 + 1] = cg; col[vi * 4 + 2] = cb; col[vi * 4 + 3] = Math.round(AO_K[lvl] * 255);
          mat[vi * 4] = F.n; mat[vi * 4 + 1] = pe.spec; mat[vi * 4 + 2] = pe.gloss; mat[vi * 4 + 3] = pe.em;
        }
        n += 4;
        // flip the quad diagonal toward the brighter pair (no AO anisotropy)
        if (ao[0] + ao[2] >= ao[1] + ao[3]) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    }
  }
  void NXY;
  return { pos: pos.subarray(0, n * 3), col: col.subarray(0, n * 4), mat: mat.subarray(0, n * 4), idx: new Uint32Array(idx), verts: n, dims: [nx * S, ny * S, nz * S] };
}

// ------------------------------------------------------------------------------------------------ GLSL
const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const SCENE_UNI = `
uniform mat4 u_vp;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec3 u_cam;
uniform vec3 u_sun;       // the visible sun (sky, glitter, flares)
uniform vec3 u_light;     // the key light that shades voxels (a cinematographer's cheat: front-lit Aero look)
uniform vec3 u_sunCol;
uniform float u_time;
uniform float u_under;     // camera underwater
uniform vec2 u_clip;       // (sign, y): discard when sign * (y - clipY) < 0 (sea reflection pass)
uniform vec2 u_res;
uniform vec4 u_env;        // x haze density, y water density, z caustic strength, w exposure of sprites
uniform vec3 u_skyTop;
uniform vec3 u_skyHor;
uniform vec3 u_deep;
uniform vec3 u_shallow;
`;

const COMMON = `
vec3 srgb2lin(vec3 c) { return c * c * (c * 0.305306011 + 0.682171111) + c * 0.012522878 * 0.0; }
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec3 skyColor(vec3 d) {
  float y = d.y;
  vec3 c = mix(u_skyHor, mix(u_skyHor, u_skyTop, 0.55), smoothstep(0.0, 0.18, y));
  c = mix(c, u_skyTop, smoothstep(0.18, 0.85, y));
  if (y < 0.0) c = mix(u_skyHor * 0.92, u_deep * 1.6, smoothstep(0.0, -0.35, y));
  float s = max(dot(d, u_sun), 0.0);
  c += u_sunCol * (pow(s, 1400.0) * 12.0 + pow(s, 160.0) * 0.55 + pow(s, 10.0) * 0.06);
  return c;
}

vec3 hazeColor(vec3 d) {
  float s = max(dot(d, u_sun), 0.0);
  return mix(u_skyHor * vec3(0.92, 0.97, 1.0), vec3(1.0, 0.98, 0.9), pow(s, 8.0) * 0.3);
}

// underwater in-scatter colour along a view direction
vec3 waterFog(vec3 d, float depth) {
  float up = d.y * 0.5 + 0.5;
  vec3 c = mix(u_deep * 0.55, u_shallow * 1.05, smoothstep(0.1, 0.95, up));
  float s = pow(max(dot(d, normalize(u_sun * vec3(0.55, 1.0, 0.55))), 0.0), 6.0);
  c += vec3(0.55, 0.95, 1.0) * s * 0.55;
  return c * exp(min(depth, 0.0) * 0.0022);
}

float caustic(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

// volumetric light shafts underwater: a few samples along the view ray of a drifting pattern projected from the
// surface along the (refracted) sun
float shafts(vec3 a, vec3 b) {
  vec3 L = normalize(vec3(u_sun.x * 0.55, 1.0, u_sun.z * 0.55));
  float acc = 0.0;
  for (int i = 0; i < 7; i++) {
    vec3 q = mix(a, b, (float(i) + 0.5) / 7.0);
    if (q.y > 0.0) continue;
    vec2 s = (q.xz - L.xz / L.y * q.y) * 0.035;
    float n = sin(s.x * 1.7 + sin(s.y * 0.6 + u_time * 0.35) * 2.2) * sin(s.y * 1.3 - u_time * 0.22 + sin(s.x * 0.8) * 1.6);
    n = max(n, 0.0);
    acc += n * n * n * exp(q.y * 0.006);
  }
  return acc / 7.0 * length(b - a) / 140.0;
}

// fog / haze / water absorption between the camera and a world point
vec3 medium(vec3 col, vec3 p) {
  vec3 v = p - u_cam;
  float dist = length(v);
  vec3 d = v / max(dist, 1e-3);
  if (u_under > 0.5) {
    float f = 1.0 - exp(-dist * u_env.y);
    col *= exp(vec3(0.0042, 0.0012, 0.0008) * min(p.y, 0.0));
    col = mix(col, waterFog(d, p.y), f);
    return col + vec3(0.55, 0.92, 1.0) * shafts(u_cam, u_cam + d * min(dist, 320.0)) * u_env.z * 0.55;
  }
  if (p.y < -0.05) {
    float hc = max(u_cam.y, 0.5), dd = -p.y;
    float uw = dist * dd / (hc + dd);
    vec3 tr = exp(-vec3(0.034, 0.011, 0.0075) * uw);
    col = col * tr + u_shallow * 0.85 * (1.0 - tr);
  }
  float h = 1.0 - exp(-dist * u_env.x);
  h *= mix(1.0, 0.55, smoothstep(0.0, 0.5, d.y));
  return mix(col, hazeColor(d), h);
}

vec3 causticLight(vec3 p, vec3 n) {
  if (p.y > -0.5) return vec3(0.0);
  float c = caustic(p.xz * 0.0065 + vec2(p.y * 0.0012, 0.0), u_time * 0.55);
  float c2 = caustic(p.xz * 0.0065 + vec2(0.012, 0.004) + vec2(p.y * 0.0012, 0.0), u_time * 0.55);
  float k = u_env.z * exp(p.y * 0.0042) * clamp(n.y * 0.7 + 0.45, 0.0, 1.0);
  return vec3(c * 0.75, (c + c2) * 0.5, c2) * k;
}
`;

const VOX_VS = HEAD + SCENE_UNI + `
layout(location=0) in vec3 a_pos;
layout(location=1) in vec4 a_col;
layout(location=2) in vec4 a_mat;
uniform mat4 u_model;
out vec3 v_w;
out vec3 v_n;
out vec4 v_col;
out vec4 v_mat;
out vec3 v_lp;
const vec3 NRM[6] = vec3[6](vec3(1.0,0.0,0.0), vec3(-1.0,0.0,0.0), vec3(0.0,1.0,0.0), vec3(0.0,-1.0,0.0), vec3(0.0,0.0,1.0), vec3(0.0,0.0,-1.0));
void main() {
  vec4 w = u_model * vec4(a_pos, 1.0);
  v_w = w.xyz;
  v_lp = a_pos;
  v_n = normalize(mat3(u_model) * NRM[int(a_mat.x * 255.0 + 0.5)]);
  v_col = a_col;
  v_mat = a_mat;
  gl_Position = u_vp * w;
}`;

const VOX_FS = HEAD + SCENE_UNI + COMMON + `
in vec3 v_w;
in vec3 v_n;
in vec4 v_col;
in vec4 v_mat;
in vec3 v_lp;
uniform vec4 u_tint;   // rgb multiply, a = mix toward white (pop / flash)
uniform vec4 u_k;      // x spec mul, y rim mul, z chrome, w alpha
uniform vec4 u_sweep;  // x position (model x), y width, z strength, w emissive boost
uniform vec4 u_grad;   // text gradient: x y0, y y1, z strength
out vec4 o;
void main() {
  if (u_clip.x * (v_w.y - u_clip.y) < 0.0) discard;
  vec3 base = toLin(v_col.rgb) * u_tint.rgb;
  if (u_grad.z > 0.0) base *= mix(0.62, 1.25, clamp((v_lp.y - u_grad.x) / (u_grad.y - u_grad.x), 0.0, 1.0)) * u_grad.z + (1.0 - u_grad.z);
  float ao = v_col.a;
  vec3 N = normalize(v_n);
  vec3 V = normalize(u_cam - v_w);
  float ndl = max(dot(N, u_light), 0.0);
  vec3 amb = mix(vec3(0.30, 0.36, 0.46), vec3(0.62, 0.80, 1.05), N.y * 0.5 + 0.5);
  if (u_under > 0.5 || v_w.y < -1.0) amb = mix(vec3(0.10, 0.30, 0.45), vec3(0.35, 0.75, 0.95), N.y * 0.5 + 0.5);
  float sunK = (u_under > 0.5 || v_w.y < -1.0) ? 0.55 : 1.0;
  vec3 col = base * (amb * ao + u_sunCol * ndl * sunK * (0.55 + 0.45 * ao));
  float spec = v_mat.y * 1.5 * u_k.x;
  float gloss = mix(6.0, 140.0, v_mat.z);
  vec3 H = normalize(u_light + V);
  col += u_sunCol * spec * pow(max(dot(N, H), 0.0), gloss) * (gloss + 8.0) / 36.0 * ao * sunK;
  float nv = max(dot(N, V), 0.0);
  float fr = pow(1.0 - nv, 4.0);
  vec3 R = reflect(-V, N);
  col += skyColor(R) * fr * (0.08 + spec * 0.35) * u_k.y * ao;
  if (u_k.z > 0.0) {
    vec3 env = skyColor(normalize(R + vec3(0.0, 0.15, 0.0)));
    float band = smoothstep(0.02, 0.0, abs(R.y - 0.05)) * 1.5;
    vec3 chrome = base * 0.35 + env * (0.55 + 0.6 * fr) + vec3(band);
    col = mix(col, chrome * (0.65 + 0.35 * ao), u_k.z);
  }
  if (u_sweep.z > 0.0) {
    float s = exp(-pow((v_lp.x + v_lp.y * 0.6 - u_sweep.x) / max(u_sweep.y, 0.01), 2.0));
    col += vec3(1.0, 0.98, 0.9) * s * u_sweep.z * (0.4 + 0.6 * max(N.z, 0.0));
  }
  col += base * (v_mat.w * 2.6 + u_sweep.w);
  col += base * causticLight(v_w, N) * 2.2;
  col = mix(col, vec3(1.0), u_tint.a);
  col = medium(col, v_w);
  o = vec4(col * u_k.w, u_k.w);
}`;

const SKY_VS = HEAD + `
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 1.0, 1.0);
}`;

const SKY_FS = HEAD + SCENE_UNI + COMMON + `
in vec2 v_uv;
uniform mat4 u_ivp;
uniform vec4 u_arcs;   // xyz axis, w strength
out vec4 o;
void main() {
  vec4 w = u_ivp * vec4(v_uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w - u_cam);
  vec3 c;
  if (u_under > 0.5) {
    c = waterFog(d, u_cam.y);
    c = mix(c, waterFog(d, 0.0), 1.0 - exp(-320.0 * u_env.y));
    c += vec3(0.55, 0.92, 1.0) * shafts(u_cam, u_cam + d * 320.0) * u_env.z * 0.55;
  } else {
    c = skyColor(d);
    if (d.y > 0.0 && u_arcs.w > 0.0) {
      float a = acos(clamp(dot(d, normalize(u_arcs.xyz)), -1.0, 1.0));
      float k = 0.0;
      for (int i = 0; i < 9; i++) {
        float r = 0.86 + float(i) * 0.034;
        k += smoothstep(0.0028, 0.0, abs(a - r)) * (1.0 - float(i) / 10.0);
      }
      float fade = smoothstep(0.0, 0.12, d.y) * smoothstep(0.75, 0.3, d.y);
      c += vec3(0.9, 0.97, 1.0) * k * u_arcs.w * fade;
    }
    // horizon haze line
    c = mix(c, u_skyHor * 1.08, exp(-abs(d.y) * 60.0) * 0.6);
    // the sea reflection pass: no blown-out sun pool on the water
    if (u_clip.x > 0.5) c = min(c, vec3(1.05));
  }
  o = vec4(c, 1.0);
}`;

const WATER_VS = HEAD + SCENE_UNI + `
layout(location=0) in vec3 a_pos;
out vec3 v_w;
void main() {
  vec3 p = vec3(a_pos.x + u_cam.x, 0.0, a_pos.z + u_cam.z);
  v_w = p;
  gl_Position = u_vp * vec4(p, 1.0);
}`;

const WATER_FS = HEAD + SCENE_UNI + COMMON + `
in vec3 v_w;
uniform sampler2D u_refl;
uniform sampler2D u_hmap;
uniform vec4 u_hrect;   // heightmap world rect: x0, z0, w, d
uniform vec2 u_hmax;    // terrain height range (world) and offset: height = texel * x - y; x = 0: no map
uniform vec4 u_ripple;  // x, z, radius, age (one expanding ring)
out vec4 o;
vec2 wv(vec2 p, vec2 d, float k, float a, float s) { float ph = dot(p, d) * k + u_time * s; return d * (cos(ph) * k * a); }
vec3 waterN(vec2 p, float detail) {
  vec2 g = wv(p, vec2(0.96, 0.28), 0.018, 2.4, 1.0)
         + wv(p, vec2(-0.37, 0.93), 0.029, 1.5, 1.4)
         + wv(p, vec2(0.71, -0.71), 0.051, 0.8, 1.9)
         + wv(p, vec2(-0.86, -0.51), 0.083, 0.42, 2.4);
  g += detail * (wv(p, vec2(-0.98, -0.2), 0.14, 0.24, 3.1)
               + wv(p, vec2(0.2, 0.98), 0.23, 0.13, 3.8)
               + wv(p, vec2(0.89, 0.45), 0.37, 0.07, 5.1)
               + wv(p, vec2(-0.5, 0.86), 0.61, 0.035, 6.3));
  return normalize(vec3(-g.x, 1.0, -g.y));
}
float terrainH(vec2 xz) {
  if (u_hmax.x <= 0.0) return -999.0;
  vec2 uv = (xz - u_hrect.xy) / u_hrect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -999.0;
  float h = texture(u_hmap, uv).r;
  return h <= 0.0 ? -999.0 : h * u_hmax.x - u_hmax.y;
}
void main() {
  vec3 v = u_cam - v_w;
  float dist = length(v);
  vec3 V = v / dist;
  float detail = clamp(1.0 - dist / 2200.0, 0.0, 1.0);
  vec3 N = waterN(v_w.xz, detail);
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(1500.0, 9000.0, dist) * 0.7));
  // a ring ripple (splashes)
  if (u_ripple.z > 0.0) {
    vec2 rd = v_w.xz - u_ripple.xy;
    float rr = length(rd);
    float ring = sin((rr - u_ripple.z) * 0.35) * exp(-pow((rr - u_ripple.z) / 14.0, 2.0)) * exp(-u_ripple.w * 1.4);
    N = normalize(N + vec3(normalize(rd + 1e-4).x, 0.0, normalize(rd + 1e-4).y) * ring * 0.6);
  }
  if (u_under > 0.5) {
    // from below: Snell's window, total internal reflection outside it
    vec3 I = -V;
    vec3 T = refract(I, -N, 1.33);
    vec3 c;
    if (dot(T, T) < 0.01) {
      c = waterFog(reflect(I, -N), 0.0) * 0.9;
    } else {
      c = skyColor(normalize(T)) * 0.9 + vec3(0.4, 0.9, 1.0) * 0.25;
      float s = pow(max(dot(normalize(T), u_sun), 0.0), 50.0);
      c += u_sunCol * s * 3.0;
    }
    float sparkle = pow(max(dot(reflect(I, -N), -u_sun), 0.0), 120.0);
    c += vec3(sparkle) * 0.8;
    c = medium(c, v_w);
    o = vec4(c, 1.0);
    return;
  }
  float nv = max(dot(N, V), 0.0);
  float F = 0.03 + 0.97 * pow(1.0 - nv, 5.0);
  F = mix(0.16, 1.0, F);
  vec2 suv = gl_FragCoord.xy / u_res;
  vec2 off = N.xz * (14.0 / (dist * 0.02 + 6.0));
  vec3 refl = min(texture(u_refl, clamp(suv + vec2(off.x, -off.y) * 0.5, 0.001, 0.999)).rgb, vec3(1.6));
  vec3 R = reflect(-V, N);
  // the sun's glitter path
  float sd = max(dot(R, u_sun), 0.0);
  vec3 spec = u_sunCol * (pow(sd, 900.0) * 30.0 + pow(sd, 140.0) * 1.0 + pow(sd, 24.0) * 0.04);
  // a sparkle field: tiny twinkles on wave faces
  float tw = hash12(floor(v_w.xz * 0.35) + floor(u_time * 6.0));
  spec += vec3(1.0) * step(0.997, tw) * pow(sd, 30.0) * 9.0 * detail;
  // body colour: deep sea, lighter turquoise over the island shelf
  float th = terrainH(v_w.xz);
  float wd = th > -998.0 ? max(-th, 0.0) : 400.0;
  vec3 body = mix(u_shallow * 1.15, u_deep * 1.25, smoothstep(2.0, 90.0, wd));
  body = mix(body, u_deep * 0.9, smoothstep(0.2, 0.9, nv) * 0.3);
  float alphaBody = mix(0.0, 1.0, smoothstep(0.0, 70.0, wd));
  // foam where the sea laps the island
  float foam = 0.0;
  if (th > -998.0) {
    float sh = clamp(1.0 - abs(th) / 9.0, 0.0, 1.0);
    float lap = 0.5 + 0.5 * sin(th * 1.4 - u_time * 2.6 + hash12(floor(v_w.xz * 0.05)) * 3.0);
    foam = sh * (0.55 + 0.45 * lap) * step(-30.0, th);
    foam *= smoothstep(0.35, 0.6, hash12(floor(v_w.xz * 0.25)) * 0.5 + sh * 0.6);
  }
  vec3 col = refl * F + body * (1.0 - F) * alphaBody;
  float a = F + (1.0 - F) * alphaBody;
  col += spec;
  col = mix(col, vec3(1.15), foam);
  a = max(a, foam);
  col = medium(col, v_w);
  o = vec4(col, a);
}`;

const BB_VS = HEAD + SCENE_UNI + `
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 i_pos;    // xyz centre, w roll
layout(location=2) in vec4 i_size;   // w, h (world), anchor x, anchor y (0..1)
layout(location=3) in vec4 i_uv;     // u0 v0 u1 v1
layout(location=4) in vec4 i_k;      // alpha, wet tint, flash, depth bias
out vec2 v_uv;
out vec4 v_k;
out vec3 v_w;
void main() {
  vec4 c = u_view * vec4(i_pos.xyz, 1.0);
  vec2 q = (a_corner - i_size.zw) * i_size.xy;
  if (u_clip.x > 0.5) q.y = -q.y;   // the sea reflection shows sprites upside down
  float cr = cos(i_pos.w), sr = sin(i_pos.w);
  q = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
  c.xy += q;
  c.z += i_k.w;
  v_w = (inverse(u_view) * c).xyz;
  gl_Position = u_proj * c;
  v_uv = mix(i_uv.xw, i_uv.zy, a_corner);
  v_k = i_k;
}`;

const BB_FS = HEAD + SCENE_UNI + COMMON + `
in vec2 v_uv;
in vec4 v_k;
in vec3 v_w;
uniform sampler2D u_tex;
out vec4 o;
void main() {
  if (u_clip.x * (v_w.y - u_clip.y) < 0.0) discard;
  vec4 t = texture(u_tex, v_uv);
  if (t.a < 0.45) discard;
  vec3 c = toLin(t.rgb / t.a) * u_env.w;
  if (u_under > 0.5 || v_w.y < -1.0) c *= mix(vec3(1.0), vec3(0.7, 0.95, 1.05), 0.5 * v_k.y + 0.3);
  c += causticLight(v_w, vec3(0.0, 1.0, 0.0)) * c * 0.6;
  c = mix(c, vec3(1.0), v_k.z);
  c = medium(c, v_w);
  o = vec4(c * v_k.x, v_k.x);
}`;

const PT_VS = HEAD + SCENE_UNI + `
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 i_p;   // xyz, size
layout(location=2) in vec4 i_c;   // rgba
layout(location=3) in vec2 i_k;   // kind, spin
out vec2 v_q;
out vec4 v_c;
out float v_kind;
out vec3 v_w;
void main() {
  vec4 c = u_view * vec4(i_p.xyz, 1.0);
  vec2 q = a_corner * 2.0 - 1.0;
  float cr = cos(i_k.y), sr = sin(i_k.y);
  vec2 r = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
  c.xy += r * i_p.w;
  v_w = i_p.xyz;
  gl_Position = u_proj * c;
  v_q = q;
  v_c = i_c;
  v_kind = i_k.x;
}`;

const PT_FS = HEAD + SCENE_UNI + COMMON + `
in vec2 v_q;
in vec4 v_c;
in float v_kind;
in vec3 v_w;
out vec4 o;
void main() {
  if (u_clip.x * (v_w.y - u_clip.y) < 0.0) discard;
  float r = length(v_q);
  vec3 c = v_c.rgb;
  float a = 0.0;
  int k = int(v_kind + 0.5);
  if (k == 0) {          // water droplet: glossy bead
    a = smoothstep(1.0, 0.82, r);
    float hl = smoothstep(0.42, 0.0, length(v_q - vec2(-0.32, 0.34)));
    c = mix(c * 0.85, c * 1.3, smoothstep(1.0, 0.2, r)) + vec3(2.2) * hl;
    c += vec3(0.6) * smoothstep(0.75, 0.95, r) * a;
  } else if (k == 1) {   // bubble: rim + highlight
    a = smoothstep(1.0, 0.9, r) * (smoothstep(0.62, 0.95, r) * 0.9 + 0.1);
    float hl = smoothstep(0.3, 0.0, length(v_q - vec2(-0.38, 0.38)));
    c = c * 1.2 + vec3(2.0) * hl;
    a = max(a, hl);
  } else if (k == 2) {   // sparkle star
    vec2 q = abs(v_q);
    float s = max(0.0, 1.0 - (q.x * 7.0 + q.y * 0.9)) + max(0.0, 1.0 - (q.y * 7.0 + q.x * 0.9));
    s += smoothstep(0.35, 0.0, r);
    a = clamp(s, 0.0, 1.0);
    c *= 1.0 + s * 2.0;
  } else {               // foam / mist puff
    a = exp(-r * r * 3.0) * 0.85;
    c *= 1.0 + 0.3 * (1.0 - r);
  }
  a *= v_c.a;
  if (a < 0.003) discard;
  c = medium(c, v_w);
  o = vec4(c * a, a);
}`;

const LINE_VS = HEAD + SCENE_UNI + `
layout(location=0) in vec3 a_pos;
out vec3 v_w;
void main() { v_w = a_pos; gl_Position = u_vp * vec4(a_pos, 1.0); }`;

const LINE_FS = HEAD + SCENE_UNI + COMMON + `
in vec3 v_w;
uniform vec4 u_color;
out vec4 o;
void main() { o = vec4(medium(u_color.rgb, v_w) * u_color.a, u_color.a); }`;

const GLASS_VS = HEAD + SCENE_UNI + `
layout(location=0) in vec3 a_pos;
uniform mat4 u_model;
out vec3 v_w;
out vec3 v_n;
void main() {
  vec4 w = u_model * vec4(a_pos, 1.0);
  v_w = w.xyz;
  v_n = normalize(mat3(u_model) * a_pos);
  gl_Position = u_vp * w;
}`;

const GLASS_FS = HEAD + SCENE_UNI + COMMON + `
in vec3 v_w;
in vec3 v_n;
uniform vec4 u_tint;   // rgb, alpha
uniform float u_irid;
out vec4 o;
void main() {
  if (u_clip.x * (v_w.y - u_clip.y) < 0.0) discard;
  vec3 N = normalize(v_n);
  vec3 V = normalize(u_cam - v_w);
  if (dot(N, V) < 0.0) N = -N;
  float nv = max(dot(N, V), 0.0);
  float fr = pow(1.0 - nv, 3.0);
  vec3 R = reflect(-V, N);
  vec3 env = skyColor(R);
  vec3 H = normalize(u_light + V);
  float sp = pow(max(dot(N, H), 0.0), 220.0) * 14.0;
  vec3 irid = 0.5 + 0.5 * cos(6.28318 * (fr * 1.6 + vec3(0.0, 0.33, 0.67)));
  vec3 c = u_tint.rgb * (0.25 + 0.75 * fr) + env * fr * 0.9 + irid * fr * u_irid * 0.5 + u_sunCol * sp;
  float a = clamp(u_tint.a * (0.18 + 0.82 * fr) + sp * 0.4, 0.0, 1.0);
  c = medium(c, v_w);
  o = vec4(c * a, a);
}`;

// ---- post
const FS_VS = SKY_VS;

const DOWN_FS = HEAD + `
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_thresh;   // < 0: plain downsample
out vec4 o;
void main() {
  vec2 h = u_texel;
  vec3 c = texture(u_tex, v_uv).rgb * 4.0;
  c += texture(u_tex, v_uv + vec2(-h.x, -h.y)).rgb;
  c += texture(u_tex, v_uv + vec2(h.x, -h.y)).rgb;
  c += texture(u_tex, v_uv + vec2(-h.x, h.y)).rgb;
  c += texture(u_tex, v_uv + vec2(h.x, h.y)).rgb;
  c /= 8.0;
  if (u_thresh >= 0.0) {
    c = min(c, vec3(6.0));
    float l = max(c.r, max(c.g, c.b));
    float k = max(l - u_thresh, 0.0);
    k = k * k / (k + 0.6);
    c *= k / max(l, 1e-4);
  }
  o = vec4(c, 1.0);
}`;

const UP_FS = HEAD + `
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_add;
uniform vec2 u_texel;
uniform float u_mix;
out vec4 o;
void main() {
  vec2 h = u_texel;
  vec3 c = texture(u_tex, v_uv + vec2(-h.x * 2.0, 0.0)).rgb;
  c += texture(u_tex, v_uv + vec2(-h.x, h.y)).rgb * 2.0;
  c += texture(u_tex, v_uv + vec2(0.0, h.y * 2.0)).rgb;
  c += texture(u_tex, v_uv + vec2(h.x, h.y)).rgb * 2.0;
  c += texture(u_tex, v_uv + vec2(h.x * 2.0, 0.0)).rgb;
  c += texture(u_tex, v_uv + vec2(h.x, -h.y)).rgb * 2.0;
  c += texture(u_tex, v_uv + vec2(0.0, -h.y * 2.0)).rgb;
  c += texture(u_tex, v_uv + vec2(-h.x, -h.y)).rgb * 2.0;
  c /= 12.0;
  o = vec4(c + texture(u_add, v_uv).rgb * u_mix, 1.0);
}`;

const BLUR_FS = HEAD + `
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
out vec4 o;
void main() {
  vec3 c = texture(u_tex, v_uv).rgb * 0.227;
  c += (texture(u_tex, v_uv + u_dir * 1.385).rgb + texture(u_tex, v_uv - u_dir * 1.385).rgb) * 0.316;
  c += (texture(u_tex, v_uv + u_dir * 3.231).rgb + texture(u_tex, v_uv - u_dir * 3.231).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;

const RAYS_FS = HEAD + `
in vec2 v_uv;
uniform sampler2D u_tex;      // bright pass
uniform sampler2D u_depth;
uniform vec2 u_src;           // light position (uv)
uniform vec4 u_k;             // x density, y decay, z weight, w sky-only
out vec4 o;
void main() {
  vec2 d = (v_uv - u_src) * u_k.x / 40.0;
  vec2 uv = v_uv;
  float w = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    uv -= d;
    vec2 cuv = clamp(uv, 0.0, 1.0);
    vec3 s = texture(u_tex, cuv).rgb;
    if (u_k.w > 0.5) s *= step(0.99995, texture(u_depth, cuv).r);
    acc += s * w;
    w *= u_k.y;
  }
  o = vec4(acc * u_k.z / 40.0, 1.0);
}`;

const FINAL_FS = HEAD + `
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_depth;
uniform sampler2D u_bloom;
uniform sampler2D u_blur;
uniform sampler2D u_rays;
uniform vec2 u_res;
uniform vec2 u_nf;            // near, far
uniform vec4 u_dof;           // focus dist, range, max, near blur
uniform vec4 u_fx;            // bloom, rays, chroma, vignette
uniform vec4 u_fx2;           // exposure, saturation, zoom blur, grain
uniform vec4 u_flash;         // rgb, a
uniform vec4 u_flare[3];      // uv x, uv y, strength, size
uniform vec4 u_drops[14];     // uv x, uv y, radius (uv y units), alpha
uniform vec4 u_bubs[20];
uniform float u_time;
uniform float u_under;
out vec4 o;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * u_nf.x * u_nf.y / (u_nf.y + u_nf.x - z * (u_nf.y - u_nf.x)); }
vec3 flareCol(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
vec3 tonemap(vec3 c) {
  // keep the Aero colours as authored up to 0.75, then a soft shoulder into white (sun-bleached highlights)
  vec3 hi = 1.0 - 0.25 * exp(-(c - 0.75) / 0.25);
  vec3 o = mix(c, hi, step(0.75, c));
  float l = max(o.r, max(o.g, o.b));
  float over = max(max(c.r, max(c.g, c.b)) - 1.2, 0.0);
  return mix(o, vec3(l), clamp(over * 0.25, 0.0, 0.6));
}
void main() {
  float asp = u_res.x / u_res.y;
  vec2 uv = v_uv;
  vec3 extra = vec3(0.0);
  // water drops on the lens: refract the view, bright rim, specular dot
  for (int i = 0; i < 14; i++) {
    vec4 dr = u_drops[i];
    if (dr.w <= 0.0) continue;
    vec2 q = (v_uv - dr.xy) * vec2(asp, 1.0);
    float r = length(q) / dr.z;
    if (r < 1.0) {
      float h = sqrt(1.0 - r * r);
      // a bead of water: an inverted, minified view of the scene behind it
      vec2 inside = dr.xy - (v_uv - dr.xy) * (0.55 + 0.45 * h);
      uv = mix(uv, inside, dr.w * smoothstep(1.0, 0.8, r));
      extra += vec3(0.9, 1.0, 1.0) * smoothstep(0.78, 1.0, r) * 0.35 * dr.w;
      extra += vec3(2.4) * smoothstep(0.32, 0.0, length(q / dr.z - vec2(-0.35, 0.4))) * dr.w;
      extra -= vec3(0.12, 0.08, 0.02) * smoothstep(0.5, 1.0, r) * smoothstep(0.0, -1.0, q.y / dr.z) * dr.w;
    }
  }
  // screen-space bubbles drifting past the lens
  for (int i = 0; i < 20; i++) {
    vec4 b = u_bubs[i];
    if (b.w <= 0.0) continue;
    vec2 q = (v_uv - b.xy) * vec2(asp, 1.0);
    float r = length(q) / b.z;
    if (r < 1.0) {
      uv += q * 0.25 * b.w * (1.0 - r);
      extra += vec3(0.8, 0.98, 1.0) * (smoothstep(0.7, 0.97, r) * smoothstep(1.0, 0.97, r)) * 0.9 * b.w;
      extra += vec3(2.0) * smoothstep(0.26, 0.0, length(q / b.z - vec2(-0.38, 0.38))) * b.w;
      vec3 ir = flareCol(r * 1.3 + u_time * 0.2);
      extra += ir * smoothstep(0.6, 0.98, r) * 0.18 * b.w;
    }
  }
  // zoom blur (dramatic punch-ins)
  vec3 col;
  vec2 cdir = uv - 0.5;
  float ca = u_fx.z * (0.35 + length(cdir) * 1.6);
  if (u_fx2.z > 0.001) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++) {
      float k = 1.0 - float(i) / 10.0 * u_fx2.z * 0.12;
      vec2 su = 0.5 + cdir * k;
      acc += vec3(texture(u_scene, su + cdir * ca * 0.004).r, texture(u_scene, su).g, texture(u_scene, su - cdir * ca * 0.004).b);
    }
    col = acc / 10.0;
  } else {
    col = vec3(texture(u_scene, uv + cdir * ca * 0.004).r, texture(u_scene, uv).g, texture(u_scene, uv - cdir * ca * 0.004).b);
  }
  // depth of field: far layers blur toward the half-res blur
  float dl = lin(texture(u_depth, uv).r);
  float coc = clamp((dl - u_dof.x) / max(u_dof.y, 1.0), 0.0, 1.0) * u_dof.z;
  coc = max(coc, clamp((u_dof.x * 0.6 - dl) / max(u_dof.x * 0.5, 1.0), 0.0, 1.0) * u_dof.w);
  vec3 bl = texture(u_blur, uv).rgb;
  col = mix(col, bl, smoothstep(0.0, 1.0, coc));
  col += texture(u_bloom, uv).rgb * u_fx.x;
  col += texture(u_rays, uv).rgb * u_fx.y;
  // lens flares (sun + glints): starburst, halo, ghosts along the axis through the centre
  for (int i = 0; i < 3; i++) {
    vec4 f = u_flare[i];
    if (f.z <= 0.0) continue;
    vec2 p = (v_uv - f.xy) * vec2(asp, 1.0);
    float d = length(p);
    float ang = atan(p.y, p.x);
    float star = pow(abs(cos(ang * 4.0)), 60.0) * exp(-d * 6.0 / f.w) + pow(abs(cos(ang * 3.0 + 0.4)), 120.0) * exp(-d * 9.0 / f.w) * 0.6;
    float streak = exp(-abs(p.y) * 220.0 / f.w) * exp(-abs(p.x) * 2.5 / f.w);
    vec3 fc = vec3(1.0, 0.97, 0.88) * (star * 0.9 + exp(-d * 18.0 / f.w) * 1.2) + vec3(0.55, 0.85, 1.0) * streak * 0.7;
    float halo = smoothstep(0.03, 0.0, abs(d - 0.26 * f.w)) * 0.10;
    fc += flareCol(d * 3.0) * halo;
    vec2 axis = (vec2(0.5) - f.xy);
    for (int g = 0; g < 6; g++) {
      float t = 0.35 + float(g) * 0.33;
      vec2 gp = f.xy + axis * t * 1.9;
      float gs = (0.018 + 0.03 * fract(float(g) * 0.618)) * f.w;
      float gd = length((v_uv - gp) * vec2(asp, 1.0));
      float disc = smoothstep(gs, gs * 0.75, gd) * (0.4 + 0.6 * smoothstep(0.0, gs, gd));
      fc += flareCol(float(g) * 0.21 + 0.1) * disc * 0.10;
    }
    col += fc * f.z;
  }
  col += extra;
  col *= u_fx2.x;
  col = tonemap(col);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, u_fx2.y);
  // vignette
  vec2 vq = (v_uv - 0.5) * vec2(asp, 1.0);
  col *= 1.0 - u_fx.w * smoothstep(0.45, 1.05, length(vq));
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, u_flash.rgb, u_flash.a);
  // dither + grain
  float n = fract(sin(dot(gl_FragCoord.xy + u_time * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * (1.0 / 255.0 + u_fx2.w * 0.05);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ------------------------------------------------------------------------------------------------ engine
function compile(gl, vs, fs, name) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ' link: ' + gl.getProgramInfoLog(p));
  const U = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const key = info.name.replace(/\[0\]$/, '');
    U[key] = gl.getUniformLocation(p, info.name);
  }
  return { p, U, name };
}

export function createVoxGL(W, H, o = {}) {
  try {
    const E = new VoxGL(W, H, o);
    return E.ok ? E : null;
  } catch (e) {
    console.warn('voxgl unavailable', e);
    return null;
  }
}

class VoxGL {
  constructor(W, H, o) {
    this.ok = false;
    this.o = o;
    const cv = (this.canvas = document.createElement('canvas'));
    const gl = (this.gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
    if (!gl) return;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    // software rasterisers (headless tests, blocklisted GPUs) get the cheap path: no MSAA
    let renderer = '';
    try { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) { renderer = ''; }
    this.software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    this.samples = o.msaa === false || o.lowPower || this.software ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    const P = (this.P = {});
    P.vox = compile(gl, VOX_VS, VOX_FS, 'vox');
    P.sky = compile(gl, SKY_VS, SKY_FS, 'sky');
    P.water = compile(gl, WATER_VS, WATER_FS, 'water');
    P.bb = compile(gl, BB_VS, BB_FS, 'billboard');
    P.pt = compile(gl, PT_VS, PT_FS, 'particles');
    P.line = compile(gl, LINE_VS, LINE_FS, 'line');
    P.glass = compile(gl, GLASS_VS, GLASS_FS, 'glass');
    P.down = compile(gl, FS_VS, DOWN_FS, 'down');
    P.up = compile(gl, FS_VS, UP_FS, 'up');
    P.blur = compile(gl, FS_VS, BLUR_FS, 'blur');
    P.rays = compile(gl, FS_VS, RAYS_FS, 'rays');
    P.final = compile(gl, FS_VS, FINAL_FS, 'final');
    this.emptyVao = gl.createVertexArray();
    // quad corner buffer for instanced sprites
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    this.bbBuf = gl.createBuffer();
    this.bbVao = this.instVao(this.bbBuf, [[1, 4], [2, 4], [3, 4], [4, 4]]);
    this.ptBuf = gl.createBuffer();
    this.ptVao = this.instVao(this.ptBuf, [[1, 4], [2, 4], [3, 2]]);
    // the sea: a big quad following the camera
    this.waterVao = gl.createVertexArray();
    gl.bindVertexArray(this.waterVao);
    const wb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, wb);
    const R = 30000;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, -R, R, 0, R, -R, 0, R]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.lineVao = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.atlasTex = this.tex(4, 4, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.hmapTex = null;
    this.blackTex = this.tex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.resize(W, H);
    this.ok = true;
  }

  instVao(buf, attrs) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = attrs.reduce((s, a) => s + a[1], 0) * 4;
    let off = 0;
    for (const [loc, n] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
      off += n * 4;
    }
    gl.bindVertexArray(null);
    return vao;
  }

  tex(w, h, ifmt, fmt, type, filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  target(w, h, depth = false) {
    const gl = this.gl;
    const cf = this.hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    const t = { w, h, fb: gl.createFramebuffer(), tex: this.tex(w, h, cf[0], cf[1], cf[2], gl.LINEAR) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (depth) {
      t.depth = this.tex(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depth, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }

  freeTarget(t) {
    if (!t) return;
    const gl = this.gl;
    gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex);
    if (t.depth) gl.deleteTexture(t.depth);
    if (t.rb) for (const r of t.rb) gl.deleteRenderbuffer(r);
  }

  resize(W, H) {
    W = Math.max(16, Math.round(W)); H = Math.max(16, Math.round(H));
    if (W === this.W && H === this.H) return;
    const gl = this.gl;
    this.W = W; this.H = H;
    const s = this.o.lowPower ? 0.5 : 1;
    const RW = Math.max(16, Math.round(W * s)), RH = Math.max(16, Math.round(H * s));
    this.RW = RW; this.RH = RH;
    this.canvas.width = W; this.canvas.height = H;
    for (const k of ['scene', 'refl', 'h1', 'h2', 'q1', 'q2', 'e1', 'e2', 's1', 's2', 'dofA', 'dofB', 'raysT']) { this.freeTarget(this[k]); this[k] = null; }
    if (this.msaa) { this.freeTarget(this.msaa); this.msaa = null; }
    this.scene = this.target(RW, RH, true);
    if (this.samples > 1) {
      try {
        const fb = gl.createFramebuffer();
        const rc = gl.createRenderbuffer(), rd = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rc);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, this.hdr ? gl.RGBA16F : gl.RGBA8, RW, RH);
        gl.bindRenderbuffer(gl.RENDERBUFFER, rd);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, RW, RH);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rc);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rd);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (ok) this.msaa = { fb, rb: [rc, rd], w: RW, h: RH, tex: null };
        else { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rc); gl.deleteRenderbuffer(rd); }
      } catch (e) { this.msaa = null; }
    }
    const hw = (k) => Math.max(4, Math.round(RW / k)), hh = (k) => Math.max(4, Math.round(RH / k));
    this.refl = this.target(hw(2), hh(2), true);
    this.h1 = this.target(hw(2), hh(2)); this.h2 = this.target(hw(2), hh(2));
    this.q1 = this.target(hw(4), hh(4)); this.q2 = this.target(hw(4), hh(4));
    this.e1 = this.target(hw(8), hh(8)); this.e2 = this.target(hw(8), hh(8));
    this.s1 = this.target(hw(16), hh(16));
    this.dofA = this.target(hw(2), hh(2)); this.dofB = this.target(hw(2), hh(2));
    this.raysT = this.target(hw(4), hh(4));
  }

  // ---------------------------------------------------------------------------------- resources
  mesh(model, o = {}) {
    const M = model.verts !== undefined ? model : meshVoxels(model, o);
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [];
    const attr = (loc, data, n, type, normalized) => {
      const b = gl.createBuffer();
      bufs.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, type, normalized, 0, 0);
    };
    attr(0, M.pos, 3, gl.FLOAT, false);
    attr(1, M.col, 4, gl.UNSIGNED_BYTE, true);
    attr(2, M.mat, 4, gl.UNSIGNED_BYTE, true);
    const ib = gl.createBuffer();
    bufs.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, M.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: M.idx.length, bufs, dims: M.dims, verts: M.verts };
  }

  freeMesh(m) {
    if (!m) return;
    const gl = this.gl;
    gl.deleteVertexArray(m.vao);
    for (const b of m.bufs || []) gl.deleteBuffer(b);
  }

  sphere(seg = 24) {
    if (this.sph) return this.sph;
    const gl = this.gl;
    const p = [], idx = [];
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg * 2; i++) {
      const th = (j / seg) * Math.PI, ph = (i / (seg * 2)) * Math.PI * 2;
      p.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
    const row = seg * 2 + 1;
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg * 2; i++) { const a = j * row + i; idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1); }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.sph = { vao, count: idx.length };
    return this.sph;
  }

  // Upload the sprite atlas (top usedH rows of a 2D canvas).
  atlas(canvas, usedH = canvas.height) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (this.atlasW !== canvas.width || this.atlasH !== canvas.height) {
      this.atlasW = canvas.width; this.atlasH = canvas.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } else if (usedH > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, canvas.width, Math.min(canvas.height, Math.ceil(usedH)), gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  // Terrain heightmap for the sea shader (shore foam, shallow water colour): Uint8 heights (0 = no land).
  heightmap(data, w, h, rect, hmax) {
    const gl = this.gl;
    if (!this.hmapTex) this.hmapTex = this.tex(w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, this.hmapTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.hrect = rect; this.hmax = hmax;
  }

  // ---------------------------------------------------------------------------------- camera
  setCamera(c) {
    const asp = this.RW / this.RH;
    const fwd = [c.target[0] - c.eye[0], c.target[1] - c.eye[1], c.target[2] - c.eye[2]];
    const fl = Math.hypot(...fwd) || 1;
    const f = fwd.map((v) => v / fl);
    let up = [0, 1, 0];
    if (c.roll) {
      // rotate the up vector around the forward axis
      const r = c.roll, cs = Math.cos(r), sn = Math.sin(r);
      const right = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
      const rl = Math.hypot(...right) || 1;
      up = [0, 1, 0].map((v, i) => v * cs + (right[i] / rl) * sn);
    }
    this.near = c.near ?? 1; this.far = c.far ?? 40000;
    this.fov = (c.fov ?? 50) * DEG;
    this.view = M4.look(c.eye, c.target, up);
    this.proj = M4.persp(this.fov, asp, this.near, this.far);
    this.vp = M4.mul(this.proj, this.view);
    this.ivp = M4.inv(this.vp);
    this.eye = c.eye;
    this.fwd = f;
    // camera basis (world): right, up
    const v = this.view;
    this.right = [v[0], v[4], v[8]];
    this.upv = [v[1], v[5], v[9]];
  }

  // world point -> [screen x, y (pixels of W x H, y down), view depth] or null behind the camera
  project(p) {
    const m = this.vp;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.5) return null;
    return [(x / w * 0.5 + 0.5) * this.W, (1 - (y / w * 0.5 + 0.5)) * this.H, w];
  }

  // screen pixels per world unit at view depth d (output canvas pixels)
  ppu(d) { return (this.H / 2) / Math.tan(this.fov / 2) / Math.max(d, 0.01); }

  // ---------------------------------------------------------------------------------- frame
  sceneUniforms(pr, S, reflect = false) {
    const gl = this.gl, U = pr.U;
    const vp = reflect ? this.rvp : this.vp;
    if (U.u_vp) gl.uniformMatrix4fv(U.u_vp, false, vp);
    if (U.u_view) gl.uniformMatrix4fv(U.u_view, false, reflect ? this.rview : this.view);
    if (U.u_proj) gl.uniformMatrix4fv(U.u_proj, false, this.proj);
    if (U.u_cam) gl.uniform3fv(U.u_cam, reflect ? this.reye : this.eye);
    if (U.u_sun) gl.uniform3fv(U.u_sun, S.sunDir);
    if (U.u_light) gl.uniform3fv(U.u_light, S.lightDir || S.sunDir);
    if (U.u_sunCol) gl.uniform3fv(U.u_sunCol, S.sunCol);
    if (U.u_time) gl.uniform1f(U.u_time, S.time);
    if (U.u_under) gl.uniform1f(U.u_under, S.under ? 1 : 0);
    if (U.u_clip) gl.uniform2f(U.u_clip, reflect ? 1 : 0, 0);
    if (U.u_res) gl.uniform2f(U.u_res, reflect ? this.refl.w : this.RW, reflect ? this.refl.h : this.RH);
    if (U.u_env) gl.uniform4f(U.u_env, S.haze ?? 0.00011, S.waterDens ?? 0.0042, S.caustics ?? 1, S.spriteExp ?? 1);
    if (U.u_skyTop) gl.uniform3fv(U.u_skyTop, S.skyTop);
    if (U.u_skyHor) gl.uniform3fv(U.u_skyHor, S.skyHor);
    if (U.u_deep) gl.uniform3fv(U.u_deep, S.deep);
    if (U.u_shallow) gl.uniform3fv(U.u_shallow, S.shallow);
  }

  drawSky(S, reflect) {
    const gl = this.gl, pr = this.P.sky;
    gl.useProgram(pr.p);
    this.sceneUniforms(pr, S, reflect);
    gl.uniformMatrix4fv(pr.U.u_ivp, false, reflect ? this.rivp : this.ivp);
    const a = S.arcs || [0, 0, 0, 0];
    gl.uniform4f(pr.U.u_arcs, a[0], a[1], a[2], a[3]);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  drawMeshes(S, list, reflect, pass) {
    const gl = this.gl, pr = this.P.vox, U = pr.U;
    gl.useProgram(pr.p);
    this.sceneUniforms(pr, S, reflect);
    for (const it of list) {
      if (!it.mesh) continue;
      if (reflect && !it.reflect) continue;
      const translucent = (it.k?.[3] ?? 1) < 0.999;
      if ((pass === 'opaque') === translucent) continue;
      gl.uniformMatrix4fv(U.u_model, false, it.model);
      const t = it.tint || [1, 1, 1, 0];
      gl.uniform4f(U.u_tint, t[0], t[1], t[2], t[3] || 0);
      const k = it.k || [1, 1, 0, 1];
      gl.uniform4f(U.u_k, k[0], k[1], k[2], k[3] ?? 1);
      const sw = it.sweep || [0, 1, 0, 0];
      gl.uniform4f(U.u_sweep, sw[0], sw[1], sw[2], sw[3] || 0);
      const gr = it.grad || [0, 1, 0, 0];
      gl.uniform4f(U.u_grad, gr[0], gr[1], gr[2], 0);
      if (it.noDepth) gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(it.mesh.vao);
      gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
      if (it.noDepth) gl.enable(gl.DEPTH_TEST);
    }
  }

  drawWater(S) {
    const gl = this.gl, pr = this.P.water, U = pr.U;
    gl.useProgram(pr.p);
    this.sceneUniforms(pr, S, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.refl.tex);
    gl.uniform1i(U.u_refl, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hmapTex || this.blackTex);
    gl.uniform1i(U.u_hmap, 1);
    const hr = this.hrect || [0, 0, 1, 1];
    gl.uniform4f(U.u_hrect, hr[0], hr[1], hr[2], hr[3]);
    const hm = this.hmax || [0, 0];
    gl.uniform2f(U.u_hmax, this.hmapTex ? hm[0] : 0, hm[1]);
    const rp = S.ripple || [0, 0, 0, 0];
    gl.uniform4f(U.u_ripple, rp[0], rp[1], rp[2], rp[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.waterVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
  }

  drawBillboards(S, list, reflect) {
    if (!list || !list.length) return;
    const gl = this.gl, pr = this.P.bb;
    const arr = this.bbArr && this.bbArr.length >= list.length * 16 ? this.bbArr : (this.bbArr = new Float32Array(Math.max(64, list.length * 2) * 16));
    let n = 0;
    for (const b of list) {
      if (reflect && !b.reflect) continue;
      const o = n * 16;
      arr[o] = b.pos[0]; arr[o + 1] = b.pos[1]; arr[o + 2] = b.pos[2]; arr[o + 3] = b.roll || 0;
      arr[o + 4] = b.w; arr[o + 5] = b.h; arr[o + 6] = b.ax ?? 0.5; arr[o + 7] = b.ay ?? 0.5;
      arr[o + 8] = b.uv[0]; arr[o + 9] = b.uv[1]; arr[o + 10] = b.uv[2]; arr[o + 11] = b.uv[3];
      arr[o + 12] = b.alpha ?? 1; arr[o + 13] = b.wet || 0; arr[o + 14] = b.flash || 0; arr[o + 15] = b.bias || 0;
      n++;
    }
    if (!n) return;
    gl.useProgram(pr.p);
    this.sceneUniforms(pr, S, reflect);
    if (reflect) gl.uniform2f(pr.U.u_clip, 1, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(pr.U.u_tex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * 16), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(this.bbVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }

  drawParticles(S, list, reflect) {
    if (!list || !list.length) return;
    const gl = this.gl, pr = this.P.pt;
    const arr = this.ptArr && this.ptArr.length >= list.length * 10 ? this.ptArr : (this.ptArr = new Float32Array(Math.max(256, list.length * 2) * 10));
    let n = 0;
    for (const p of list) {
      if (reflect && p.y < 0) continue;
      const o = n * 10;
      arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z; arr[o + 3] = p.size;
      arr[o + 4] = p.r; arr[o + 5] = p.g; arr[o + 6] = p.b; arr[o + 7] = p.a;
      arr[o + 8] = p.kind || 0; arr[o + 9] = p.spin || 0;
      n++;
    }
    if (!n) return;
    gl.useProgram(pr.p);
    this.sceneUniforms(pr, S, reflect);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n * 10), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(this.ptVao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawLines(S, lines) {
    if (!lines || !lines.length) return;
    const gl = this.gl, pr = this.P.line;
    gl.useProgram(pr.p);
    this.sceneUniforms(pr, S, false);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const L of lines) {
      gl.bufferData(gl.ARRAY_BUFFER, L.pts, gl.DYNAMIC_DRAW);
      const c = L.color || [1, 1, 1, 1];
      gl.uniform4f(pr.U.u_color, c[0], c[1], c[2], c[3]);
      gl.drawArrays(gl.LINE_STRIP, 0, L.pts.length / 3);
    }
    gl.disable(gl.BLEND);
  }

  drawGlass(S, list, reflect) {
    if (!list || !list.length) return;
    const gl = this.gl, pr = this.P.glass, U = pr.U;
    const sph = this.sphere();
    gl.useProgram(pr.p);
    this.sceneUniforms(pr, S, reflect);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(sph.vao);
    for (const g of list) {
      if (reflect && !g.reflect) continue;
      gl.uniformMatrix4fv(U.u_model, false, g.model);
      const t = g.tint || [0.7, 0.95, 1, 0.5];
      gl.uniform4f(U.u_tint, t[0], t[1], t[2], t[3]);
      gl.uniform1f(U.u_irid, g.irid ?? 0.6);
      gl.drawElements(gl.TRIANGLES, sph.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  fsPass(pr, dst, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.W, dst ? dst.h : this.H);
    gl.useProgram(pr.p);
    let unit = 0;
    const bind = (name, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(pr.U[name], unit); unit++; };
    setup(pr.U, bind);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  // One frame. S: {cam {eye, target, fov, roll, near, far}, time, under, sunDir, sunCol, skyTop, skyHor, deep, shallow,
  //   haze, waterDens, caustics, arcs, water (bool), ripple, meshes [{mesh, model, reflect, tint, k, sweep, grad, noDepth}],
  //   glass [{model, tint, irid, reflect}], billboards [...], particles [...], lines [{pts Float32Array, color}],
  //   overlay [meshes drawn last without depth], post {...}}
  render(S) {
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    this.setCamera(S.cam);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const water = S.water !== false;
    // 1. planar reflection of the world above the sea (half res)
    if (water && !S.under && !this.o.lowPower) {
      // mirror the world across the sea plane: the reflected image lands in the main view's screen space
      const e = S.cam.eye;
      this.reye = [e[0], -e[1], e[2]];
      const Mr = M4.ident(); Mr[5] = -1;
      this.rview = M4.mul(this.view, Mr);
      this.rvp = M4.mul(this.vp, Mr);
      this.rivp = M4.inv(this.rvp);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.refl.fb);
      gl.viewport(0, 0, this.refl.w, this.refl.h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // the reflected camera is a real camera below the sea: reuse the main projection with its own view
      this.drawSky(S, true);
      this.drawMeshes(S, S.meshes || [], true, 'opaque');
      this.drawBillboards(S, S.billboards, true);
      this.drawGlass(S, S.glass, true);
    }
    // 2. the scene (MSAA HDR)
    const tgt = this.msaa || this.scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
    gl.viewport(0, 0, this.RW, this.RH);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawSky(S, false);
    this.drawMeshes(S, S.meshes || [], false, 'opaque');
    this.drawBillboards(S, S.billboards, false);
    if (water) this.drawWater(S);
    this.drawLines(S, S.lines);
    this.drawGlass(S, S.glass, false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawMeshes(S, S.meshes || [], false, 'translucent');
    gl.disable(gl.BLEND);
    this.drawParticles(S, S.particles, false);
    if (S.overlay && S.overlay.length) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.drawMeshes(S, S.overlay, false, 'opaque');
      this.drawMeshes(S, S.overlay, false, 'translucent');
      gl.disable(gl.BLEND);
      this.drawParticles(S, S.overlayParticles, false);
    }
    if (this.msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaa.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.scene.fb);
      gl.blitFramebuffer(0, 0, this.RW, this.RH, 0, 0, this.RW, this.RH, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    gl.disable(gl.DEPTH_TEST);
    this.post(S);
    return true;
  }

  post(S) {
    const P = this.P, po = S.post || {};
    const texel = (t) => [1 / t.w, 1 / t.h];
    const thr = this.hdr ? (po.threshold ?? 1.0) : 0.72;
    // bloom: bright pass (half) -> dual-filter down to 1/16 -> back up
    this.fsPass(P.down, this.h1, (U, bind) => { bind('u_tex', this.scene.tex); this.gl.uniform2fv(U.u_texel, texel(this.scene)); this.gl.uniform1f(U.u_thresh, thr); });
    this.fsPass(P.down, this.q1, (U, bind) => { bind('u_tex', this.h1.tex); this.gl.uniform2fv(U.u_texel, texel(this.h1)); this.gl.uniform1f(U.u_thresh, -1); });
    this.fsPass(P.down, this.e1, (U, bind) => { bind('u_tex', this.q1.tex); this.gl.uniform2fv(U.u_texel, texel(this.q1)); this.gl.uniform1f(U.u_thresh, -1); });
    this.fsPass(P.down, this.s1, (U, bind) => { bind('u_tex', this.e1.tex); this.gl.uniform2fv(U.u_texel, texel(this.e1)); this.gl.uniform1f(U.u_thresh, -1); });
    this.fsPass(P.up, this.e2, (U, bind) => { bind('u_tex', this.s1.tex); bind('u_add', this.e1.tex); this.gl.uniform2fv(U.u_texel, texel(this.s1)); this.gl.uniform1f(U.u_mix, 1); });
    this.fsPass(P.up, this.q2, (U, bind) => { bind('u_tex', this.e2.tex); bind('u_add', this.q1.tex); this.gl.uniform2fv(U.u_texel, texel(this.e2)); this.gl.uniform1f(U.u_mix, 1); });
    this.fsPass(P.up, this.h2, (U, bind) => { bind('u_tex', this.q2.tex); bind('u_add', this.h1.tex); this.gl.uniform2fv(U.u_texel, texel(this.q2)); this.gl.uniform1f(U.u_mix, 1); });
    // depth of field source: the scene at half res, blurred twice
    const dofOn = (po.dof?.[2] || 0) > 0.01 || (po.dof?.[3] || 0) > 0.01;
    if (dofOn) {
      this.fsPass(P.down, this.dofA, (U, bind) => { bind('u_tex', this.scene.tex); this.gl.uniform2fv(U.u_texel, texel(this.scene)); this.gl.uniform1f(U.u_thresh, -1); });
      for (let i = 0; i < 2; i++) {
        this.fsPass(P.blur, this.dofB, (U, bind) => { bind('u_tex', this.dofA.tex); this.gl.uniform2f(U.u_dir, (1.2 + i) / this.dofA.w, 0); });
        this.fsPass(P.blur, this.dofA, (U, bind) => { bind('u_tex', this.dofB.tex); this.gl.uniform2f(U.u_dir, 0, (1.2 + i) / this.dofA.h); });
      }
    }
    // god rays toward the light (sun above water; the bright surface from below)
    const rs = po.raysSrc;
    const raysOn = rs && (po.rays || 0) > 0.001;
    if (raysOn) {
      this.fsPass(P.rays, this.raysT, (U, bind) => {
        bind('u_tex', this.h1.tex); bind('u_depth', this.scene.depth);
        this.gl.uniform2f(U.u_src, rs[0], rs[1]);
        this.gl.uniform4f(U.u_k, po.raysDensity ?? 0.9, po.raysDecay ?? 0.965, 1.4, S.under ? 0 : 1);
      });
    }
    // composite to the canvas
    this.fsPass(P.final, null, (U, bind) => {
      const gl = this.gl;
      bind('u_scene', this.scene.tex); bind('u_depth', this.scene.depth); bind('u_bloom', this.h2.tex);
      bind('u_blur', dofOn ? this.dofA.tex : this.scene.tex); bind('u_rays', raysOn ? this.raysT.tex : this.blackTex);
      gl.uniform2f(U.u_res, this.W, this.H);
      gl.uniform2f(U.u_nf, this.near, this.far);
      const d = po.dof || [1000, 1000, 0, 0];
      gl.uniform4f(U.u_dof, d[0], d[1], d[2], d[3]);
      gl.uniform4f(U.u_fx, po.bloom ?? 0.6, raysOn ? po.rays : 0, po.chroma ?? 0.4, po.vignette ?? 0.35);
      gl.uniform4f(U.u_fx2, po.exposure ?? 1, po.saturation ?? 1.12, po.zoomBlur ?? 0, po.grain ?? 0.3);
      const fl = po.flash || [1, 1, 1, 0];
      gl.uniform4f(U.u_flash, fl[0], fl[1], fl[2], fl[3]);
      const flares = new Float32Array(12);
      (po.flares || []).slice(0, 3).forEach((f, i) => { flares[i * 4] = f[0]; flares[i * 4 + 1] = f[1]; flares[i * 4 + 2] = f[2]; flares[i * 4 + 3] = f[3] ?? 1; });
      gl.uniform4fv(U.u_flare, flares);
      const drops = new Float32Array(14 * 4);
      (po.drops || []).slice(0, 14).forEach((p, i) => drops.set(p, i * 4));
      gl.uniform4fv(U.u_drops, drops);
      const bubs = new Float32Array(20 * 4);
      (po.bubbles || []).slice(0, 20).forEach((p, i) => bubs.set(p, i * 4));
      gl.uniform4fv(U.u_bubs, bubs);
      gl.uniform1f(U.u_time, S.time);
      gl.uniform1f(U.u_under, S.under ? 1 : 0);
    });
  }

  dispose() {
    try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { /* ignore */ }
    this.ok = false;
  }
}
