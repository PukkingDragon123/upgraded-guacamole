// Water physics + post-process shader for the world layer (phase 5: Water agent).
//
//   game.water = new WaterFX(game)
//   water.sim                                       the CPU surface sim (src/world/watersim.js WaterSim): swell, waves,
//                                                   foam, ripple rings; water.surf is the same object (older callers)
//   water.disturb(wx, wy, strength = 1, radius = 6) ripple impulse at a world point (hook, fish, splashes, rain);
//                                                   points near the surface also push surface waves and ring the sheet
//   water.splash(wx, strength = 1, radius = 10)     an impact on the surface at world x (waves + rings + ripples)
//   water.heightAt(wx), water.slopeAt(wx)           simulated lift (px, up) / slope at x
//   water.levelAt(wx)                               live waterline y at x (= ocean.waveAt: biome waves + sim lift)
//   water.surfaceOffset(wx) -> 0                    the lift is already folded into ocean.waveAt (kept for callers)
//   water.update(dt, {surfaceY, top, W, H, waveAt}) step everything (call once per frame)
//   water.render(srcCanvas, camera, look) -> canvas | null   post-process the screen-space world layer
//   water.drawLens(ctx)                             screen-space lens drops after the camera surfaces (call after
//                                                   the world, before the HUD)
//   water.active                                    GPU path running (false -> plain 2D drawing)
//
// The surface itself (the receding water sheet, reflections, the animated water texture, glints, rings, foam) is
// drawn in 2D by every ocean's back pass (src/world/watersheet.js), so both paths share it. The GPU pass adds the
// underwater look: refraction through a 2D wave-equation heightfield (ping-ponged RGBA8 textures, 16-bit packed
// height + previous height, driven by queued impulses) plus an ambient wobble under the surface, caustics where
// ripples focus light and a drifting caustic web on lit surfaces (seabed, fish), dancing god rays that brighten under
// rising crests, a per-ocean depth tint, a 1 px chromatic fringe on strong ripple fronts, twinkling sparkles and a
// cheap 12-tap bloom. Every offset is rounded to whole logical pixels and added light is quantised + dithered, so
// the result stays crisp pixel art. Per-ocean palettes: WATER_PALETTES / waterPalette in watersim.js.
// look (biome.waterLook): refract, caustic, chroma, causticColor, sparkle (0..2), bloom (0..1), pattern (procedural
// caustics 0..1), gloss, glossColor, rays (god-ray strength), deepColor, tint (depth tint 0..1).
// Phase 6 (Oceans): below the shelf lip (the deep zones, src/world/deepsea.js) the depth tint and sparkles fade out and
// the ripple heightfield reads flat (its domain ends at the shelf), so the zones keep their own colours.

import { WaterSim, waterPalette } from '../world/watersim.js';

const MAX_IMP = 24;
const TAU = Math.PI * 2;

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
uniform vec4 u_k;        // refraction px, caustic gain, chroma (0/1), ambient wobble
uniform float u_shine;   // ripple light/shadow banding
uniform vec3 u_causCol;
uniform float u_time;
uniform vec4 u_fx;       // sparkle, bloom, procedural caustics, god rays
uniform vec3 u_glossCol;
uniform vec3 u_rayCol;
uniform vec3 u_deepCol;
uniform float u_tint;
uniform float u_shelf;   // [phase6:oceans] world y where the deep column starts (its zones carry their own colour)

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float q4(float v, vec2 sp) { return floor(clamp(v, 0.0, 1.0) * 4.0 + bayer4(sp)) / 4.0; }
// Tileable 'light web' caustics (iterated warp), thin bright lines on dark.
float causticWeb(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 3; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.006), p.y / (cos(i.y + tt) / 0.006)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 7.0);
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.55, 0.15)); }

float simH(vec2 c) { if (c.y > u_dom.w - 1.0) return 0.0; return dec(texture2D(u_sim, (clamp(c, vec2(0.0), u_dom.zw - 1.0) + 0.5) / u_dom.zw).rg); }
vec4 surfAt(float wx) {
  float i = clamp(floor(wx / u_surf.z), 0.0, u_surf.y - 1.0);
  return texture2D(u_surfTex, vec2((i + 0.5) / u_surf.y, 0.5));
}
float waveAt(float wx) { return floor(surfAt(wx).a * 255.0 + 0.5) - 128.0; }
vec4 scene(vec2 sp) { return texture2D(u_scene, (clamp(sp, vec2(0.0), u_screen - 1.0) + 0.5) / u_screen); }
vec3 bright(vec2 sp) { vec4 c = scene(sp); return c.rgb * smoothstep(0.86, 1.0, lum(c.rgb)); }

// dancing light shafts: slanted stripes that sway, brightest under rising crests, fading with depth
float godRays(vec2 wp, float dd) {
  float xr = wp.x + dd * 0.34;
  float r = sin(xr * 0.043 + u_time * 0.31) * 0.5 + sin(xr * 0.107 - u_time * 0.53 + 1.3) * 0.32 + sin(xr * 0.021 + u_time * 0.17 + 4.0) * 0.42;
  float crest = clamp(-waveAt(xr) * 0.18, -0.3, 0.6);
  r = smoothstep(0.42, 1.05, r + crest * 0.5);
  return r * exp(-dd / 240.0) * smoothstep(2.0, 26.0, dd);
}

void main() {
  vec2 sp = vec2(floor(gl_FragCoord.x), u_screen.y - 1.0 - floor(gl_FragCoord.y));
  float z = u_cam.x;
  vec2 wp = (sp + 0.5 - u_cam.yz) / z;
  vec2 off = vec2(0.0);
  bool hasSurf = u_surf.x > -9.0e4;
  float line = -1.0e6;
  if (hasSurf) line = u_surf.x + waveAt(wp.x);
  bool water = !hasSurf || wp.y > line + 0.5;
  float dd = hasSurf ? wp.y - line : 140.0;   // world px below the live waterline
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
    // looking through moving water: a slow wobble that is strongest just under the surface
    float wk = u_k.w * (hasSurf ? 0.35 + 0.65 * exp(-dd / 46.0) : 0.4);
    off += vec2(sin(wp.y * 0.19 + u_time * 1.9 + wp.x * 0.031), cos(wp.x * 0.13 - u_time * 1.4 + wp.y * 0.05) * 0.5) * wk;
    float lap = hl + hr + hu + hd - 4.0 * h;
    float depthK = hasSurf ? clamp(1.0 - dd / 420.0, 0.25, 1.0) : 0.6;
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
  // ---- Frutiger Aero water light
  if (water) {
    float sun = hasSurf ? clamp(1.0 - dd / 360.0, 0.0, 1.0) : 0.35;
    // depth tint toward the ocean's deep colour (fading out in the deep zones below the shelf)
    float deepK = smoothstep(u_shelf, u_shelf + 160.0, wp.y);
    if (u_tint > 0.001) col.rgb = mix(col.rgb, u_deepCol * col.a, smoothstep(40.0, 520.0, dd) * u_tint * (1.0 - deepK));
    // god rays
    if (u_fx.w > 0.01 && hasSurf) col.rgb += u_rayCol * q4(godRays(wp, dd) * u_fx.w, sp) * 0.22 * col.a;
    // drifting caustic web, brightest on lit pixels in the upper water (seabed, rocks, fish)
    if (u_fx.z > 0.01) {
      vec2 cp = vec2(wp.x * 0.0085, wp.y * 0.015 - u_time * 0.02);
      float web = causticWeb(mod(cp * 6.2831, 6.2831) - 250.0, u_time * 0.35 + 23.0);
      float k = web * u_fx.z * sun * (0.35 + lum(col.rgb)) * smoothstep(4.0, 40.0, dd);
      col.rgb += u_glossCol * q4(k * 0.55, sp) * 0.32 * col.a;
    }
    // specular sparkles: twinkling crosses in the sunlit layer + glints on bright ripple faces
    if (u_fx.x > 0.01) {
      vec2 wpi = floor(wp);
      vec2 cell = floor(wpi / vec2(7.0, 4.0));
      float hs = hash(cell);
      float ph = fract(u_time * (0.45 + hs * 0.5) + hs * 7.13);
      float chance = u_fx.x * (hasSurf ? 0.004 + 0.05 * exp(-dd / 14.0) : 0.006) * (1.0 - deepK);
      if (hash(cell + floor(u_time * (0.45 + hs * 0.5) + hs * 7.13) * 3.1) < chance) {
        vec2 lp = wpi - cell * vec2(7.0, 4.0) - vec2(1.0 + floor(hs * 5.0), 1.0 + floor(fract(hs * 13.0) * 2.0));
        float tw = sin(ph * 3.14159);
        float cr = (abs(lp.x) < 0.5 && abs(lp.y) < 0.5) ? 1.0 : ((abs(lp.x) < 0.5 && abs(lp.y) < 1.5) || (abs(lp.y) < 0.5 && abs(lp.x) < 1.5)) ? (tw > 0.55 ? 0.6 : 0.0) : 0.0;
        col.rgb += u_glossCol * cr * tw * col.a;
      }
      if (lit > 0.6) col.rgb += u_glossCol * 0.25 * u_fx.x * sun * col.a;
    }
  }
  // cheap bloom: 12 taps of the bright parts of the scene
  if (u_fx.y > 0.01) {
    vec2 q = sp + o;
    vec3 b = bright(q + vec2(3.0, 0.0)) + bright(q - vec2(3.0, 0.0)) + bright(q + vec2(0.0, 3.0)) + bright(q - vec2(0.0, 3.0));
    b += bright(q + vec2(2.0, 2.0)) + bright(q - vec2(2.0, 2.0)) + bright(q + vec2(2.0, -2.0)) + bright(q - vec2(2.0, -2.0));
    b += (bright(q + vec2(6.0, 0.0)) + bright(q - vec2(6.0, 0.0)) + bright(q + vec2(0.0, 5.0)) + bright(q - vec2(0.0, 5.0))) * 0.6;
    b /= 10.4;
    float bl = q4(lum(b) * u_fx.y * 1.4 * (1.0 - lum(col.rgb) * 0.6), sp);
    col.rgb += mix(b, vec3(1.0), 0.3) * bl * 0.35 * col.a;
  }
  col.rgb = min(col.rgb, vec3(col.a));
  gl_FragColor = col;
}
`;

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

// ------------------------------------------------------------------ lens drops

const dropCache = new Map();
// rim + gloss for a lens drop of radius r (the refracted view is drawn live underneath)
function dropRim(r) {
  let c = dropCache.get(r);
  if (c) return c;
  const s = r * 2 + 3;
  c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d');
  const edge = 1.2 / r;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = x + 0.5 - s / 2, dy = y + 0.5 - s / 2, d = Math.hypot(dx, dy) / r;
    if (d > 1.04) continue;
    const ang = Math.atan2(dy, dx); // light from the top-left
    const lit = Math.cos(ang + 2.36);
    let col = null;
    if (d > 1 - edge) col = lit > 0.35 ? 'rgba(255,255,255,0.85)' : lit < -0.2 ? 'rgba(6,34,66,0.62)' : 'rgba(160,220,255,0.5)';
    else if (d > 1 - edge * 2.2 && lit < -0.3) col = 'rgba(10,50,90,0.28)'; // inner shadow on the far side
    else if (dy > r * 0.3 && d > 0.5) col = 'rgba(235,255,255,' + (0.18 + 0.3 * (d - 0.5)).toFixed(3) + ')'; // focused light
    else col = 'rgba(190,240,255,0.08)';
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  }
  // glossy highlight: a little curved window reflection at the top-left
  const hx = Math.round(s / 2 - r * 0.5), hy = Math.round(s / 2 - r * 0.5);
  g.fillStyle = '#ffffff';
  g.fillRect(hx + 1, hy, Math.max(1, Math.round(r * 0.35)), Math.max(1, Math.round(r * 0.14)));
  g.fillRect(hx, hy + 1, Math.max(1, Math.round(r * 0.14)), Math.max(1, Math.round(r * 0.3)));
  if (r >= 7) g.fillRect(Math.round(s / 2 + r * 0.25), Math.round(s / 2 + r * 0.45), 2, 1);
  dropCache.set(r, c);
  return c;
}

// ------------------------------------------------------------------ public

export class WaterFX {
  constructor(game, opts = {}) {
    this.game = game;
    this.sim = new WaterSim({ width: game?.screen?.W || 960 });
    this.surf = this.sim; // older callers: water.surf.impulse(x, vel, radius)
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
    this.time = 0;
    this.surfaceY = null;
    this.waveAt = null;
    this.perf = { t: 0, frames: 0, slow: 0, ms: 0 };
    this.surfBuf = null;
    this.lens = [];
    this.eyeSide = 0;
    this.prevCur = null;
    this.skimT = 0;
    if (game?.particles) game.particles.water = this; // splash particles ring the surface when they land
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
      this.simP = program(gl, SIM_FS);
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
    this.sim.resize(W);
    this.cell = 2;
    this.sn = Math.ceil(W / this.cell) + 2;
    this.surfBuf = new Uint8Array(this.sn * 4);
    const gl = this.gl;
    if (!gl) return;
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.sn, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  // ---------------------------------------------------------------- events

  levelAt(wx) {
    try { const v = this.game.ocean?.waveAt?.(wx); return Number.isFinite(v) ? v : this.surfaceY; } catch { return this.surfaceY; }
  }

  disturb(wx, wy, strength = 1, radius = 6) {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
    const s = this.surfaceY;
    if (s !== null && s !== undefined) {
      const d = wy - (this.levelAt(wx) ?? s);
      if (d < -6) return; // in the air
      if (d < 22) this.sim.disturb(wx, strength * 0.7 * (1 - Math.max(0, d) / 22), radius * 1.6, { ring: d < 8 && strength > 0.25 });
    }
    if (this.gl && this.queue.length < 96) this.queue.push(wx, wy, strength, radius);
  }

  splash(wx, strength = 1, radius = 10) {
    if (!Number.isFinite(wx)) return;
    this.sim.disturb(wx, strength * 1.6, radius);
    if (this.gl && this.surfaceY !== null && this.queue.length < 96) this.queue.push(wx, this.surfaceY + 3, strength * 0.6, radius * 0.8);
  }

  heightAt(wx) { return this.sim.heightAt(wx); }
  slopeAt(wx) { return this.sim.slopeAt(wx); }
  surfaceOffset() { return 0; }
  surfaceSlope(wx) { return this.sim.slopeAt(wx); }
  foamAt(wx) { return this.sim.foamAt(wx); }

  update(dt, info) {
    this.surfaceY = info.surfaceY ?? null;
    this.waveAt = info.waveAt || null;
    this.layout(info.W, info.H, info.top);
    this.dt = dt;
    this.time = (this.time + dt) % 3600;
    const g = this.game, oc = g?.ocean;
    const look = oc?.biome?.waterSim || null; // optional per-biome {swell, rain} multipliers
    this.sim.update(dt, { weather: oc?.weather || 'calm', swellMul: (look?.swell ?? 1) * (this.surfaceY === null ? 0 : 1), rainMul: look?.rain ?? 1 });
    if (this.surfaceY !== null) this.interact(dt);
    this.updateLens(dt);
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

  // The mouse playing with the water: skimming along the surface pushes waves and rings, pulling out of the water
  // lifts a little bump, dragging (button held) through the surface sprays.
  interact(dt) {
    const g = this.game, c = g?.world?.cursor;
    if (!c || !c.inWorld || g.state?.view !== 'ocean' || g.boat?.dragging) { this.prevCur = null; return; }
    const p = this.prevCur;
    this.prevCur = [c.x, c.y];
    if (!p || dt <= 0) return;
    const lv = this.levelAt(c.x), pl = this.levelAt(p[0]);
    if (lv === null || pl === null) return;
    const dx = c.x - p[0], dy = c.y - p[1];
    const sp = Math.hypot(dx, dy) / dt;
    const held = !!g.input?.down;
    const wasIn = p[1] > pl, isIn = c.y > lv;
    this.skimT -= dt;
    this.crossT = (this.crossT || 0) - dt;
    if (wasIn !== isIn && sp > 25 && this.crossT <= 0) {
      this.crossT = 0.3;
      const k = Math.min(1.4, sp / 500);
      // entering with the hook out is the cast plop (fishing makes it); pulling out lifts a bump
      if (!isIn) { this.sim.disturb(c.x, -0.35 - k * 0.4, 7); g.particles?.droplets?.(c.x, lv - 1, 2 + Math.round(k * 4), { dir: -Math.PI / 2, spread: 0.6, speed: [30, 60 + sp * 0.1], g: 300 }); }
      else if (held || !g.fishing?.hook?.visible) { this.sim.disturb(c.x, 0.5 + k, 7); g.particles?.splash?.(c.x, lv, 0.25 + k * 0.3); }
    } else if (Math.abs(c.y - lv) < 4 + (held ? 3 : 0) && Math.abs(dx) / dt > 30) {
      const v = Math.abs(dx) / dt;
      this.sim.impulse(c.x, -Math.min(36, v * 0.07) * (held ? 1.6 : 1), 8);
      if (this.skimT <= 0) {
        this.skimT = held ? 0.05 : 0.09;
        this.sim.ring(c.x - Math.sign(dx) * 3, 0.18 + Math.random() * 0.12, Math.min(1, 0.35 + v / 700), { speed: 12 + v * 0.02, life: 0.9, r0: 2, kind: 'wake' });
        if (held && v > 120) g.particles?.droplets?.(c.x, lv - 1, 2, { dir: -Math.PI / 2 - Math.sign(dx) * 0.5, spread: 0.5, speed: [40, 90], g: 320 });
        if (v > 200) g.particles?.foam?.(c.x, lv, 1, { spread: 3 });
      }
    }
  }

  // ---------------------------------------------------------------- lens drops / crossing the surface

  updateLens(dt) {
    const g = this.game, cam = g?.camera, s = this.surfaceY;
    for (const d of this.lens) {
      d.t += dt;
      if (d.t > d.stick) { d.vy = Math.min(70, d.vy + 40 * dt); d.y += d.vy * dt; }
      d.x += Math.sin(d.t * 3 + d.ph) * dt * 2;
    }
    if (this.lens.length) this.lens = this.lens.filter((d) => d.t < d.life && d.y - d.r < (g.screen?.H || 540));
    if (!cam?.open || s === null || !cam.xform || g.state?.view !== 'ocean' || g.ocean?.travelState) { this.eyeSide = 0; return; }
    const [z, , oy] = cam.xform();
    const H = g.screen.H, W = g.screen.W;
    const e = s - (H / 2 - oy) / z;
    const side = e > 3 ? 1 : e < -3 ? -1 : this.eyeSide;
    if (this.eyeSide === -1 && side === 1 && !g.state?.settings?.reducedMotion) {
      // surfacing: water beads on the lens
      const n = g.lowPower ? 6 : 14;
      for (let i = 0; i < n; i++) {
        const r = 4 + Math.floor(Math.random() * Math.random() * 15);
        this.lens.push({ x: Math.random() * W, y: Math.random() * H * 0.85, r, t: 0, stick: 0.2 + Math.random() * 0.8, vy: 0, life: 1.6 + Math.random() * 1.8, ph: Math.random() * TAU });
      }
      g.audio?.play?.('splash_small', { vol: 0.25, pitch: 1.5 });
    } else if (this.eyeSide === 1 && side === -1) {
      // diving: a burst of bubbles under the surface and a ring where we went through
      const cx = (W / 2 - cam.xform()[1]) / z;
      g.particles?.aeroBubbles?.(cx, s + 14, g.lowPower ? 6 : 14, { w: W / (2.5 * z), h: 8, speed: [20, 60], sizes: [2, 2, 3, 4] });
      this.sim.disturb(cx, 0.6, 18);
    }
    this.eyeSide = side;
  }

  drawLens(ctx) {
    if (!this.lens.length) return;
    const src = ctx.canvas;
    const W = src.width, H = src.height;
    if (!this.lensTmp || this.lensTmp.width !== W || this.lensTmp.height !== H) {
      this.lensTmp = document.createElement('canvas');
      this.lensTmp.width = W; this.lensTmp.height = H;
      this.lensG = this.lensTmp.getContext('2d');
      this.lensG.imageSmoothingEnabled = false;
    }
    this.lensG.clearRect(0, 0, W, H);
    this.lensG.drawImage(src, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const d of this.lens) {
      const a = Math.min(1, (d.life - d.t) / 0.5, d.t / 0.08);
      if (a <= 0.02) continue;
      const x = Math.round(d.x), y = Math.round(d.y), r = d.r;
      ctx.globalAlpha = a;
      // a drop is a tiny fisheye lens: the view behind it, magnified and upside down
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 0.5, y + 0.5, r, 0, TAU);
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(-1, -1);
      const k = r * 2.8;
      ctx.drawImage(this.lensTmp, x - k, y - k, k * 2, k * 2, -r - 1, -r - 1, r * 2 + 2, r * 2 + 2);
      ctx.restore();
      const rim = dropRim(r);
      ctx.drawImage(rim, x - r - 1, y - r - 1);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- GPU passes

  stepSim(steps) {
    const gl = this.gl;
    const P = this.simP;
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

  // live waterline (biome waves + sim lift, relative to the still level) and foam, one texel per 2 px
  uploadSurface() {
    const gl = this.gl, sim = this.sim, b = this.surfBuf, n = this.sn;
    const sy = this.surfaceY, wave = this.waveAt;
    for (let i = 0; i < n; i++) {
      const x = i * this.cell;
      b[i * 4] = 128; b[i * 4 + 1] = 0;
      b[i * 4 + 2] = Math.round(Math.min(1, sim.foamAt(x)) * 255);
      let w = 0;
      if (wave && sy !== null) { const v = wave(x); w = Number.isFinite(v) ? Math.round(v - sy) : 0; }
      b[i * 4 + 3] = Math.max(0, Math.min(255, w + 128));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.surfTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
  }

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
      gl.uniform3f(P.u.u_surf, this.surfaceY === null ? -1e5 : this.surfaceY, this.sn, this.cell);
      // per-ocean palette (daylight-aware) for rays, depth tint and caustic light
      const oc = this.game?.ocean, env = oc?.env || {};
      const pal = waterPalette(oc?.biome?.waterPaletteId || oc?.biome?.id || 'oscean', env.daylight ?? 1, env.dusk ?? 0);
      gl.uniform4f(P.u.u_k, (look.refract ?? 14) * 2.2, look.caustic ?? 9, look.chroma === false ? 0 : 1, look.wobble ?? 0.55);
      gl.uniform1f(P.u.u_shine, look.shine ?? 9);
      gl.uniform3fv(P.u.u_causCol, hex3(look.causticColor || '#2a3a30'));
      gl.uniform1f(P.u.u_time, this.time);
      const day = env.daylight ?? 1;
      gl.uniform4f(P.u.u_fx, look.sparkle ?? 0.8, look.bloom ?? 0.3, (look.pattern ?? 0.4) * (0.6 + pal.caustics * 0.6), (look.rays ?? pal.rays) * (0.3 + 0.7 * day));
      gl.uniform3fv(P.u.u_glossCol, hex3(look.glossColor || pal.caustic || '#ffffff'));
      gl.uniform3fv(P.u.u_rayCol, hex3(look.rayColor || pal.ray));
      gl.uniform3fv(P.u.u_deepCol, hex3(look.deepColor || pal.deep));
      gl.uniform1f(P.u.u_tint, look.tint ?? pal.tint);
      if (P.u.u_shelf) gl.uniform1f(P.u.u_shelf, oc?.biome?.deep?.L ? (this.game.screen?.H ?? 1e6) : 1e6); // [phase6:oceans]
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
