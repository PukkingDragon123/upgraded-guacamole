// Water physics + post-process shader for the world layer.
//
//   game.water = new WaterFX(game)
//   water.disturb(wx, wy, strength = 1, radius = 6)  ripple impulse at a world point (hook, fish, splashes, rain).
//                                                     Points near the surface also push the surface waves.
//   water.splash(wx, strength = 1, radius = 10)      push the 1D surface down at world x (waves the boat rides)
//   water.surfaceOffset(wx) -> px                    simulated surface lift at x (positive = up)
//   water.surfaceSlope(wx)                           d(lift)/dx
//   water.update(dt, {surfaceY, top, W, H, waveAt})  step the CPU surface sim (call once per frame)
//   water.render(srcCanvas, camera, look) -> canvas | null
//                                                     post-process the screen-space world layer; null = draw src as is
//   water.active                                     GPU path running (false -> plain 2D drawing)
//
// Two simulations run side by side:
//  - a 1D spring-chain along the surface on the CPU (cheap, readable by the boat and the 2D fallback);
//  - a 2D wave-equation heightfield on the GPU, ping-ponged between two RGBA8 textures (height and previous
//    height packed as 16-bit pairs so it works on every WebGL1/2 device), driven by queued impulses.
// The composite pass refracts the underwater scene along the ripple gradient, lifts the waterline by the surface
// sim, adds foam and a crest, caustics where ripples focus light, and a 1 px chromatic fringe on strong fronts.
// Every offset is rounded to whole logical pixels so the result stays crisp pixel art.

const SURF_RANGE = 32; // packed surface lift range (+-px)
const MAX_IMP = 24;

const VS = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const COMMON = `
precision highp float;
float dec(vec2 v) { return (floor(v.x * 255.0 + 0.5) * 256.0 + floor(v.y * 255.0 + 0.5)) / 65535.0 * 2.0 - 1.0; }
vec2 enc(float h) {
  float v = floor(clamp(h * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
`;

const SIM_FS = COMMON + `
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform vec4 u_imp[${MAX_IMP}];
uniform float u_nimp;
uniform float u_damp;
uniform float u_surf;
float H(vec2 p) { return dec(texture2D(u_tex, (p + 0.5) / u_size).rg); }
void main() {
  vec2 p = floor(gl_FragCoord.xy);
  vec4 c = texture2D(u_tex, (p + 0.5) / u_size);
  float h = dec(c.rg), hp = dec(c.ba);
  float s = H(p + vec2(1.0, 0.0)) + H(p - vec2(1.0, 0.0)) + H(p + vec2(0.0, 1.0)) + H(p - vec2(0.0, 1.0));
  float nh = (s * 0.5 - hp) * u_damp;
  for (int i = 0; i < ${MAX_IMP}; i++) {
    if (float(i) >= u_nimp) break;
    vec4 im = u_imp[i];
    vec2 d = (p + 0.5 - im.xy) / im.w;
    float q = dot(d, d);
    if (q < 1.0) { float k = 1.0 - q; nh += im.z * k * k; }
  }
  if (p.y < u_surf) nh = 0.0;
  gl_FragColor = vec4(enc(nh), enc(h));
}
`;

const FX_FS = COMMON + `
uniform sampler2D u_scene;
uniform sampler2D u_sim;
uniform sampler2D u_surfTex;
uniform vec2 u_screen;
uniform vec3 u_cam;      // zoom, offset x, offset y (screen = world * zoom + offset)
uniform vec4 u_dom;      // sim top (world y), cell size, sim w, sim h
uniform vec3 u_surf;     // still surface world y (< -9e4 none), surface texels, surface cell
uniform vec4 u_k;        // refraction px, caustic gain, chroma (0/1), foam gain
uniform float u_shine;   // ripple light/shadow banding
uniform vec3 u_foamCol;
uniform vec3 u_causCol;
uniform vec3 u_crestCol;

float simH(vec2 c) { return dec(texture2D(u_sim, (clamp(c, vec2(0.0), u_dom.zw - 1.0) + 0.5) / u_dom.zw).rg); }
vec4 surfAt(float wx) {
  float i = clamp(floor(wx / u_surf.z), 0.0, u_surf.y - 1.0);
  return texture2D(u_surfTex, vec2((i + 0.5) / u_surf.y, 0.5));
}
vec4 scene(vec2 sp) { return texture2D(u_scene, (clamp(sp, vec2(0.0), u_screen - 1.0) + 0.5) / u_screen); }

void main() {
  vec2 sp = vec2(floor(gl_FragCoord.x), u_screen.y - 1.0 - floor(gl_FragCoord.y));
  float z = u_cam.x;
  vec2 wp = (sp + 0.5 - u_cam.yz) / z;
  vec2 off = vec2(0.0);
  bool hasSurf = u_surf.x > -9.0e4;
  float line = -1.0e6;
  float foam = 0.0;
  float lift = 0.0;
  if (hasSurf) {
    vec4 st = surfAt(wp.x);
    lift = dec(st.rg) * ${SURF_RANGE.toFixed(1)};
    foam = st.b;
    float wave = floor(st.a * 255.0 + 0.5) - 128.0;
    line = u_surf.x + wave - lift;
    float dy = wp.y - u_surf.x - wave;
    float B = 12.0;
    if (abs(dy) < B) off.y = lift * (1.0 - abs(dy) / B);
  }
  bool water = !hasSurf || wp.y > line + 0.5;
  vec3 add = vec3(0.0);
  vec2 fr = vec2(0.0);
  float lit = 0.0;
  if (water) {
    vec2 c = floor((wp - vec2(0.0, u_dom.x)) / u_dom.y);
    float h = simH(c);
    float hl = simH(c - vec2(1.0, 0.0)), hr = simH(c + vec2(1.0, 0.0));
    float hu = simH(c - vec2(0.0, 1.0)), hd = simH(c + vec2(0.0, 1.0));
    vec2 g = vec2(hr - hl, hd - hu) * 0.5;
    off -= g * u_k.x;
    float lap = hl + hr + hu + hd - 4.0 * h;
    float depthK = hasSurf ? clamp(1.0 - (wp.y - line) / 420.0, 0.25, 1.0) : 0.6;
    float cs = clamp(-lap * u_k.y * depthK, 0.0, 1.0);
    cs = floor(cs * 3.0 + bayer4(sp)) / 3.0;
    add += u_causCol * cs;
    if (u_k.z > 0.5 && length(g) > 0.035) fr = vec2(g.x > 0.0 ? 1.0 : -1.0, 0.0);
    // ripple faces tilted toward the light (top-left) brighten, the others darken; quantised + dithered
    float sh = clamp((-g.x * 0.55 - g.y * 0.85) * u_shine, -1.0, 1.0);
    lit = (floor(abs(sh) * 3.0 + bayer4(sp + 1.0)) / 3.0) * sign(sh);
  }
  vec2 o = floor(off * z + 0.5);
  vec4 col = scene(sp + o);
  if (fr.x != 0.0) {
    col.r = scene(sp + o + fr).r;
    col.b = scene(sp + o - fr).b;
  }
  col.rgb += add * col.a;
  col.rgb *= 1.0 + (lit > 0.0 ? lit * 0.16 : lit * 0.12);
  if (hasSurf) {
    float ls = floor(line * z + u_cam.z);
    float d = sp.y - ls;
    if (d >= -1.0 && d <= 1.0) {
      float f = clamp(foam * u_k.w, 0.0, 1.0) * (d == 0.0 ? 1.0 : 0.55);
      if (f > bayer4(sp + vec2(0.0, floor(wp.x * 0.25)))) col.rgb = mix(col.rgb, u_foamCol * col.a, 0.85);
      else if (d == 0.0 && abs(lift) > 0.6) col.rgb = mix(col.rgb, u_crestCol * col.a, 0.5);
    }
  }
  gl_FragColor = col;
}
`;

// ------------------------------------------------------------------ CPU surface sim

class SurfaceSim {
  constructor() { this.resize(960); }

  resize(W) {
    this.cell = 2;
    this.n = Math.ceil(W / this.cell) + 2;
    this.h = new Float32Array(this.n);
    this.v = new Float32Array(this.n);
    this.foam = new Float32Array(this.n);
    this.acc = 0;
  }

  idx(wx) { return Math.max(0, Math.min(this.n - 1, Math.round(wx / this.cell))); }

  // velocity impulse (px/s, positive = up) with a smooth falloff
  impulse(wx, vel, radius = 10) {
    const c = this.cell, r = Math.max(c, radius);
    const i0 = Math.max(0, Math.floor((wx - r) / c)), i1 = Math.min(this.n - 1, Math.ceil((wx + r) / c));
    for (let i = i0; i <= i1; i++) {
      const d = (i * c - wx) / r;
      if (d * d >= 1) continue;
      const k = 1 - d * d;
      this.v[i] += vel * k * k;
      this.foam[i] = Math.min(1, this.foam[i] + Math.abs(vel) * 0.012 * k);
    }
  }

  step(dt) {
    this.acc = Math.min(0.1, this.acc + dt);
    const sub = 1 / 120;
    const { h, v, n, foam } = this;
    const c2 = (95 * 95) / (this.cell * this.cell);
    while (this.acc >= sub) {
      this.acc -= sub;
      for (let i = 0; i < n; i++) {
        const l = h[i > 0 ? i - 1 : 0], r = h[i < n - 1 ? i + 1 : n - 1];
        v[i] += ((l + r - 2 * h[i]) * c2 - h[i] * 6) * sub;
        v[i] *= 0.9935;
      }
      for (let i = 0; i < n; i++) {
        h[i] += v[i] * sub;
        if (h[i] > SURF_RANGE - 1) { h[i] = SURF_RANGE - 1; v[i] = 0; } else if (h[i] < 1 - SURF_RANGE) { h[i] = 1 - SURF_RANGE; v[i] = 0; }
      }
    }
    const fd = Math.exp(-dt * 1.8);
    for (let i = 0; i < n; i++) {
      const s = Math.abs(h[i < n - 1 ? i + 1 : i] - h[i > 0 ? i - 1 : i]) * 0.5;
      foam[i] = Math.min(1, Math.max(foam[i] * fd, s > 0.7 ? (s - 0.7) * 0.8 : 0, Math.abs(v[i]) > 55 ? 0.6 : 0));
    }
  }

  at(wx) {
    const f = Math.max(0, Math.min(this.n - 1.001, wx / this.cell));
    const i = Math.floor(f), k = f - i;
    return this.h[i] + (this.h[i + 1] - this.h[i]) * k;
  }

  slope(wx) { return (this.at(wx + 3) - this.at(wx - 3)) / 6; }
}

// ------------------------------------------------------------------ WebGL helpers

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('watergl shader: ' + gl.getShaderInfoLog(s));
  return s;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('watergl link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function texture(gl, w, h, data = null) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return t;
}

const hex3 = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ------------------------------------------------------------------ public

export class WaterFX {
  constructor(game, opts = {}) {
    this.game = game;
    this.surf = new SurfaceSim();
    this.queue = [];
    this.gl = null;
    this.kind = '2d';
    this.failed = false;
    this.software = false;
    this.force = !!opts.force;
    this.disabled = !!opts.disabled;
    this.active = false;
    this.W = 0; this.H = 0; this.top = 0;
    this.simAcc = 0;
    this.surfaceY = null;
    this.waveAt = null;
    this.perf = { t: 0, frames: 0, slow: 0, ms: 0 };
    this.surfBuf = null;
    if (!this.disabled) this.init();
  }

  init() {
    try {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      const attrs = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
      let gl = c.getContext('webgl2', attrs);
      this.kind = 'webgl2';
      if (!gl) { gl = c.getContext('webgl', attrs) || c.getContext('experimental-webgl', attrs); this.kind = 'webgl'; }
      if (!gl) { this.kind = '2d'; return; }
      let renderer = '';
      try {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      } catch { renderer = ''; }
      this.renderer = renderer;
      this.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
      if (this.software && !this.force) { this.kind = '2d'; return; }
      this.canvas = c;
      this.gl = gl;
      this.sim = program(gl, SIM_FS);
      this.fx = program(gl, FX_FS);
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.sceneTex = texture(gl, 1, 1);
      this.surfTex = texture(gl, 1, 1);
      this.impBuf = new Float32Array(MAX_IMP * 4);
      c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.fail('context lost'); });
    } catch (e) {
      this.fail(e.message);
    }
  }

  fail(why) {
    this.failed = true;
    this.active = false;
    this.gl = null;
    this.kind = '2d';
    this.why = why;
  }

  get available() { return !!this.gl && !this.failed && !this.disabled; }

  // (Re)allocate the GPU heightfield for a world of W x (H - top).
  layout(W, H, top) {
    if (W === this.W && H === this.H && top === this.top) return;
    this.W = W; this.H = H; this.top = top;
    this.surf.resize(W);
    this.surfBuf = new Uint8Array(this.surf.n * 4);
    const gl = this.gl;
    if (!gl) return;
    this.cell = 2;
    this.sw = Math.ceil(W / this.cell) + 1;
    this.sh = Math.ceil((H - top) / this.cell) + 1;
    const init = new Uint8Array(this.sw * this.sh * 4);
    for (let i = 0; i < init.length; i += 4) { init[i] = 127; init[i + 1] = 255; init[i + 2] = 127; init[i + 3] = 255; }
    if (this.simTex) for (const t of this.simTex) gl.deleteTexture(t);
    if (this.fbo) for (const f of this.fbo) gl.deleteFramebuffer(f);
    this.simTex = [texture(gl, this.sw, this.sh, init), texture(gl, this.sw, this.sh, init)];
    this.fbo = this.simTex.map((t) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return f;
    });
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) this.fail('framebuffer incomplete');
    this.cur = 0;
    gl.bindTexture(gl.TEXTURE_2D, this.surfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.surf.n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  // ---------------------------------------------------------------- events

  disturb(wx, wy, strength = 1, radius = 6) {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
    const s = this.surfaceY;
    if (s !== null && s !== undefined) {
      const d = wy - s;
      if (d < -6) return; // in the air
      if (d < 22) this.surf.impulse(wx, -strength * 26 * (1 - Math.max(0, d) / 22), radius * 1.6);
    }
    if (this.queue.length < 96) this.queue.push(wx, wy, strength, radius);
  }

  splash(wx, strength = 1, radius = 10) {
    this.surf.impulse(wx, -strength * 60, radius);
    if (this.surfaceY !== null && this.queue.length < 96) this.queue.push(wx, this.surfaceY + 3, strength * 0.6, radius * 0.8);
  }

  surfaceOffset(wx) { return this.surf.at(wx); }
  surfaceSlope(wx) { return this.surf.slope(wx); }
  foamAt(wx) { return this.surf.foam[this.surf.idx(wx)]; }

  update(dt, info) {
    this.surfaceY = info.surfaceY ?? null;
    this.waveAt = info.waveAt || null;
    this.layout(info.W, info.H, info.top);
    this.surf.step(dt);
    this.dt = dt;
    // performance governor: give up on the GPU path if it keeps the game well under 60 fps
    const p = this.perf;
    if (this.active) {
      p.t += dt; p.frames++;
      if (p.t >= 2) {
        const fps = p.frames / p.t;
        p.slow = fps < 32 && !this.force ? p.slow + 1 : 0;
        p.t = 0; p.frames = 0;
        if (p.slow >= 3) { this.disabled = true; this.active = false; console.info('[watergl] disabled: frame rate too low (' + Math.round(fps) + ' fps)'); }
      }
    }
  }

  // ---------------------------------------------------------------- GPU passes

  stepSim(steps) {
    const gl = this.gl;
    const P = this.sim;
    gl.useProgram(P.p);
    gl.viewport(0, 0, this.sw, this.sh);
    gl.uniform2f(P.u.u_size, this.sw, this.sh);
    gl.uniform1f(P.u.u_damp, 0.986);
    gl.uniform1f(P.u.u_surf, this.surfaceY === null ? -1e4 : Math.floor((this.surfaceY - 6 - this.top) / this.cell));
    gl.uniform1i(P.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    const q = this.queue;
    for (let s = 0; s < steps; s++) {
      let n = 0;
      if (s === 0) {
        const buf = this.impBuf;
        buf.fill(0);
        for (let i = 0; i + 3 < q.length && n < MAX_IMP; i += 4) {
          const r = Math.max(1, q[i + 3] / this.cell);
          buf[n * 4] = q[i] / this.cell;
          buf[n * 4 + 1] = (q[i + 1] - this.top) / this.cell;
          buf[n * 4 + 2] = Math.max(-0.9, Math.min(0.9, q[i + 2] * 0.45));
          buf[n * 4 + 3] = r;
          n++;
        }
        q.length = 0;
        gl.uniform4fv(P.u.u_imp, buf);
      }
      gl.uniform1f(P.u.u_nimp, n);
      const src = this.cur, dst = 1 - src;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]);
      gl.bindTexture(gl.TEXTURE_2D, this.simTex[src]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = dst;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  uploadSurface() {
    const gl = this.gl, s = this.surf, b = this.surfBuf, n = s.n;
    const sy = this.surfaceY, wave = this.waveAt;
    for (let i = 0; i < n; i++) {
      const v = Math.round((Math.max(-1, Math.min(1, s.h[i] / SURF_RANGE)) * 0.5 + 0.5) * 65535);
      b[i * 4] = v >> 8;
      b[i * 4 + 1] = v & 255;
      b[i * 4 + 2] = Math.round(Math.min(1, s.foam[i]) * 255);
      const w = wave && sy !== null ? Math.round(wave(i * s.cell) - sy) : 0;
      b[i * 4 + 3] = Math.max(0, Math.min(255, w + 128));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.surfTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
  }

  // look: {refract, caustic, chroma, foam, foamColor, causticColor, crestColor}
  render(src, camera, look = {}) {
    this.active = false;
    if (!this.available || !this.simTex) { this.queue.length = 0; return null; }
    const gl = this.gl;
    try {
      const W = src.width, H = src.height;
      const c = this.canvas;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      // fixed-rate sim steps (60 Hz)
      this.simAcc = Math.min(0.06, this.simAcc + (this.dt || 1 / 60));
      let steps = 0;
      while (this.simAcc >= 1 / 60 && steps < 3) { this.simAcc -= 1 / 60; steps++; }
      if (steps === 0 && this.queue.length) { steps = 1; this.simAcc = 0; }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);
      if (steps) this.stepSim(steps);
      this.uploadSurface();
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const P = this.fx;
      gl.useProgram(P.p);
      gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.simTex[this.cur]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.surfTex);
      gl.uniform1i(P.u.u_scene, 0); gl.uniform1i(P.u.u_sim, 1); gl.uniform1i(P.u.u_surfTex, 2);
      gl.uniform2f(P.u.u_screen, W, H);
      const [z, ox, oy] = camera ? camera.xform() : [1, 0, 0];
      gl.uniform3f(P.u.u_cam, z, ox, oy);
      gl.uniform4f(P.u.u_dom, this.top, this.cell, this.sw, this.sh);
      gl.uniform3f(P.u.u_surf, this.surfaceY === null ? -1e5 : this.surfaceY, this.surf.n, this.surf.cell);
      gl.uniform4f(P.u.u_k, (look.refract ?? 14) * 2.2, look.caustic ?? 9, look.chroma === false ? 0 : 1, look.foam ?? 1);
      gl.uniform1f(P.u.u_shine, look.shine ?? 9);
      gl.uniform3fv(P.u.u_foamCol, hex3(look.foamColor || '#f4fffc'));
      gl.uniform3fv(P.u.u_causCol, hex3(look.causticColor || '#2a3a30'));
      gl.uniform3fv(P.u.u_crestCol, hex3(look.crestColor || '#ffffff'));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      this.active = true;
      return c;
    } catch (e) {
      this.fail(e.message);
      return null;
    }
  }
}
