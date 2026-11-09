// The aquarium's 3D view (phase 6): one LPScene rendered once per frame into one canvas. Owns the camera (orbit /
// pan / zoom with smooth presets, the swimmer's follow camera), projection and picking, and assembles the frame:
// sky (2D light) -> room -> tank (substrate, equipment, plants, decor, fish, eggs, food, Aero drops, bubbles, the
// swimmer) -> caustics, light shafts, water volume, rippling surface, glass -> 2D overlays (drawn by aquarium.js).
//
//   new TankView(aq)          .rebuild() after tier / gear changes   .setPreset('front'|'top'|'close'|'side'|'room')
//   .orbit(dx, dy) .pan(dx, dy) .zoom(k)  .update(dt)  .render(ctx, x, y, w, h) -> bool (false = no WebGL)
//   .project([x, y, z]) -> [sx, sy, depth] | null (view-local px)   .ray(sx, sy) -> {o, d}
//   .eye, .fwd                 current camera

import { LPScene, M4, T4, lpAvailable } from '../gfx/lowpoly.js';
import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { DynMesh, rgb, mixc, template } from './lpkit.js';
import { buildTank, surfaceMesh, causticFrames, shaftTexture, shaftMesh } from './lptank.js';
import { buildRoom } from './lproom.js';
import { PlantField } from './lpplants.js';
import { decorModel, decorPartAlpha } from './lpdecor.js';
import { fishFor, addFish, beginFishFrame } from './lpfish.js';
import { avatarKit, avatarItems } from './lpavatar.js';
import { TANK_TIERS } from './tanks.js';

const FOV = 50;
// optional per-section timing (window.AQ.view.prof = true): PROF.t holds smoothed ms per section
export const PROF = {
  on: false, t: {}, last: 0, cur: null,
  mark(name) { if (!this.on) return; const n = performance.now(); if (this.cur) this.t[this.cur] = (this.t[this.cur] || 0) * 0.9 + (n - this.last) * 0.1; this.cur = name; this.last = n; },
  end() { if (!this.on) return; this.mark(null); this.cur = null; },
};
const ID = M4.ident();
const COIN_COL = [null, rgb('#3ad0f4'), rgb('#7ae8ff')], WHITE3 = [1, 1, 1], SHELL_COL = rgb('#d8faff'), BUB_COL = rgb('#e8fdff');
const easeOutElastic = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1);

export class TankView {
  constructor(aq) {
    this.aq = aq;
    this.ok = lpAvailable();
    this.scene = null;
    this.kit = null; this.room = null; this.plants = null;
    this.kitKey = '';
    this.dyn = { surf: new DynMesh(), plants: new DynMesh(), solid: new DynMesh(), clear: new DynMesh(), glowB: new DynMesh(), head: new DynMesh() };
    this.cam = { yaw: -0.38, pitch: 0.2, dist: 120, target: [0, 10, 0] };
    this.camT = { yaw: -0.38, pitch: 0.2, dist: 120, target: [0, 10, 0] };
    this.preset = 'front';
    this.eye = [0, 0, 100]; this.fwd = [0, 0, -1]; this.right = [1, 0, 0]; this.up = [0, 1, 0];
    this.w = 960; this.h = 540;
    this.VP = null;
    this.swimCam = null;
    this.t = 0;
  }

  // ------------------------------------------------------------------ build
  rebuild(force = false) {
    if (!this.ok) return;
    const aq = this.aq;
    const gear = aq.st.tank.gear || {};
    const key = aq.tier + '|' + JSON.stringify(gear);
    if (!force && key === this.kitKey && this.kit) return;
    const first = !this.kit;
    const oldKit = this.kit;
    if (this.oldKit && this.oldKit !== oldKit) disposeKit(this.oldKit);
    if (oldKit && !aq.growAnim) disposeKit(oldKit);
    if (this.shafts) this.shafts.dispose();
    this.kitKey = key;
    this.kit = buildTank(aq.tier, gear);
    this.shafts = shaftMesh(this.kit);
    if (!this.room || this.roomTier !== aq.tier) { if (this.room) disposeRoom(this.room); this.room = buildRoom(aq.tier, this.kit); this.roomTier = aq.tier; }
    this.plants = new PlantField(this.kit.shape, aq.tier, TANK_TIERS[aq.tier].plants + (gear.light | 0) * 2);
    this.plantMesh = null;
    this.oldKit = oldKit && aq.growAnim ? oldKit : null;
    if (first) this.setPreset('iso', true);
    else this.fitPreset();
  }

  dropOldKit() { if (this.oldKit) disposeKit(this.oldKit); this.oldKit = null; }

  // ------------------------------------------------------------------ camera
  // camera distance that fits the glass cube (its bounding sphere plus the plinth and the light above)
  frame() {
    const T = this.kit.shape;
    const s = T.size;
    const R = Math.hypot(s[0], s[1] * 1.15, s[2]) * 0.5;
    const asp = this.w / this.h;
    const tf = Math.tan((FOV * Math.PI / 180) / 2);
    const dist = Math.max(R / tf, R / (tf * asp)) * 1.12;
    return { dist, target: [0, T.top * 0.44, 0], max: Math.max(dist * 2.6, 220) };
  }

  // presets: 'iso' (default, a 3/4 view from above: two glass faces and the water surface), 'front', 'top',
  // 'close', 'side', 'room'
  setPreset(name, snap = false) {
    if (!this.kit) return;
    if (name === 'default') name = 'iso';
    this.follow = null;
    const f = this.frame();
    this.preset = name;
    const c = this.camT, T = this.kit.shape;
    if (name === 'top') Object.assign(c, { yaw: 0.35, pitch: 1.3, dist: f.dist * 1.02, target: [0, T.waterY * 0.4, 0] });
    else if (name === 'front') Object.assign(c, { yaw: 0, pitch: 0.12, dist: f.dist * 1.0, target: f.target.slice() });
    else if (name === 'close') Object.assign(c, { yaw: 0.42, pitch: 0.22, dist: f.dist * 0.55, target: [0, T.waterY * 0.42, 0] });
    else if (name === 'side') Object.assign(c, { yaw: 1.2, pitch: 0.2, dist: f.dist * 0.95, target: f.target.slice() });
    else if (name === 'room') Object.assign(c, { yaw: 0.8, pitch: 0.3, dist: f.dist * 2.2, target: [0, T.top * 0.6, 0] });
    else Object.assign(c, { yaw: 0.68, pitch: 0.5, dist: f.dist * 1.04, target: [0, T.top * 0.4, 0] });
    c.target = c.target.slice();
    this.limit(c);
    if (snap) { Object.assign(this.cam, c); this.cam.target = c.target.slice(); }
  }
  fitPreset() { this.setPreset(this.preset || 'iso'); }

  limit(c) {
    const f = this.frame();
    c.pitch = clamp(c.pitch, -0.2, 1.45);
    c.dist = clamp(c.dist, Math.max(8, this.kit.shape.minDim * 0.45), f.max);
    const lim = this.room?.yawLimit;
    if (lim) c.yaw = clamp(c.yaw, -lim, lim);
    const T = this.kit.shape;
    c.target[0] = clamp(c.target[0], -T.size[0] * 0.6, T.size[0] * 0.6);
    c.target[1] = clamp(c.target[1], -10, T.top * 1.1);
    c.target[2] = clamp(c.target[2], -T.size[2] * 0.6, T.size[2] * 0.6);
  }

  orbit(dx, dy) { this.camT.yaw -= dx * 0.008; this.camT.pitch += dy * 0.006; this.limit(this.camT); this.preset = null; }
  // keep the camera on a fish (the fish manager's "See in tank"): it glides in and follows until you orbit / pan
  focusFish(f) {
    if (!this.kit || !f) return;
    this.follow = f;
    this.preset = null;
    const c = this.camT, T = this.kit.shape;
    c.dist = clamp(f.len * 7 + T.minDim * 0.25, T.minDim * 0.45, this.frame().dist * 0.8);
    c.pitch = clamp(c.pitch, 0.18, 0.55);
    c.target = f.p.slice();
    this.limit(c);
  }
  pan(dx, dy) {
    this.follow = null;
    const k = this.camT.dist * 0.0022;
    const c = this.camT;
    for (let i = 0; i < 3; i++) c.target[i] += (-this.right[i] * dx + this.up[i] * dy) * k;
    this.limit(c);
    this.preset = null;
  }
  zoom(k) { this.camT.dist *= k; this.limit(this.camT); if (!this.follow) this.preset = null; }

  update(dt) {
    if (!this.kit) return;
    this.t += dt;
    const c = this.cam, T = this.camT;
    if (this.follow) {
      if (!this.aq.fish.includes(this.follow)) this.follow = null;
      else { const p = this.follow.p; for (let i = 0; i < 3; i++) T.target[i] = p[i]; this.limit(T); }
    }
    const k = 1 - Math.exp(-dt * (this.follow ? 4 : 7));
    let dy = ((T.yaw - c.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
    c.yaw += dy * k;
    c.pitch = lerp(c.pitch, T.pitch, k);
    c.dist = lerp(c.dist, T.dist, k);
    for (let i = 0; i < 3; i++) c.target[i] = lerp(c.target[i], T.target[i], k);
  }

  // camera basis from orbit params or the swim camera
  computeCamera() {
    const sc = this.aq.swim ? this.aq.swimCamera() : null;
    let eye, tgt;
    if (sc) { eye = sc.eye; tgt = sc.target; }
    else {
      const c = this.cam;
      const cp = Math.cos(c.pitch);
      eye = [c.target[0] + Math.sin(c.yaw) * cp * c.dist, c.target[1] + Math.sin(c.pitch) * c.dist, c.target[2] + Math.cos(c.yaw) * cp * c.dist];
      // stay inside the room
      const R = this.room?.bounds;
      if (R) { eye[0] = clamp(eye[0], R.x0 + 15, R.x1 - 15); eye[2] = clamp(eye[2], R.z0 + 15, R.z1 - 15); eye[1] = clamp(eye[1], (this.room.floorY || -76) + 12, R.y1 - 10); }
      tgt = c.target;
    }
    this.eye = eye;
    let f = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
    const fl = Math.hypot(...f) || 1; f = f.map((x) => x / fl);
    let r = [-f[2], 0, f[0]];
    const rl = Math.hypot(...r) || 1; r = r.map((x) => x / rl);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    this.fwd = f; this.right = r; this.up = u;
    this.target = tgt;
    const near = sc ? 0.4 : Math.max(1, this.cam.dist * 0.02);
    this.near = near;
    const P = M4.persp((FOV * Math.PI) / 180, this.w / this.h, near, 9000);
    const V = M4.look(eye, tgt, [0, 1, 0]);
    this.VP = M4.mul(P, V);
  }

  project(p) {
    const m = this.VP;
    if (!m) return null;
    const x = p[0], y = p[1], z = p[2];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.01) return null;
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    return [(cx * 0.5 + 0.5) * this.w, (1 - (cy * 0.5 + 0.5)) * this.h, cw];
  }
  // pixels per cm at a given depth
  ppu(depth) { return (this.h / 2) / (Math.tan((FOV * Math.PI / 180) / 2) * Math.max(0.01, depth)); }

  ray(sx, sy) {
    const nx = (sx / this.w) * 2 - 1, ny = 1 - (sy / this.h) * 2;
    const tf = Math.tan((FOV * Math.PI / 180) / 2), asp = this.w / this.h;
    const d = [0, 1, 2].map((i) => this.fwd[i] + this.right[i] * nx * tf * asp + this.up[i] * ny * tf);
    const l = Math.hypot(...d);
    return { o: this.eye.slice(), d: d.map((x) => x / l) };
  }

  // the tank root transform (the expansion animation swells it)
  rootScale() {
    const g = this.aq.growAnim;
    if (!g) return null;
    const k = easeOutElastic(clamp01((g.t - 0.25) / 1.6));
    return g.from.map((f) => lerp(f, 1, k));
  }

  // ------------------------------------------------------------------ render
  invalidate() { this.kitKey = ''; this.dirty = true; }

  render(ctx, x, y, w, h) {
    if (!this.ok) return false;
    if (!this.kit || this.dirty) { this.dirty = false; this.rebuild(true); if (!this.kit) return false; }
    if (!this.scene) this.scene = new LPScene(w, h);
    if (this.scene.w !== w || this.scene.h !== h) this.scene.resize(w, h);
    if (this.w !== w || this.h !== h) { this.w = w; this.h = h; }
    this.computeCamera();
    const aq = this.aq, kit = this.kit, T = kit.shape, t = this.t;
    const sc = this.scene;
    sc.clear();
    sc.camera({ eye: this.eye, target: this.target, up: [0, 1, 0], fov: FOV, near: this.near, far: 9000 });
    const swim = !!aq.swim;
    const night = aq.nightK || 0;
    const lampOff = !!aq.st.tank.lampOff;

    // ---- room
    PROF.mark('room');
    const room = this.room;
    sc.add(room.opaque, ID, { emit: 0.27, spec: 0.22 });
    for (const gw of room.glow) sc.add(gw.mesh, ID, { tint: [...gw.col, 1] });
    for (const r of room.rotors) sc.add(r.mesh, T4.trs(r.pos, 0, r.yaw, t * r.speed, 1));
    for (const c of room.clouds) { const p = c.pos; sc.add(c.mesh, T4.trs([p[0] + ((t * c.speed) % 1600) - 800, p[1], p[2]], 0, 0, 0, 1)); }
    for (const gl of room.glass) sc.add(gl.mesh, T4.trs(gl.pos, 0, 0, 0, 1), { alpha: gl.a, env: 0.7, spec: 0.6, shine: 60 });

    // ---- the tank (root scale animates during an expansion)
    PROF.mark('tank');
    const rs = this.rootScale();
    const root = rs ? T4.trs([0, 0, 0], 0, 0, 0, rs) : ID;
    const R = (m) => (rs ? M4.mul(root, m) : m);
    if (this.oldKit && aq.growAnim && aq.growAnim.t < 0.7) {
      const a = clamp01(1 - aq.growAnim.t / 0.7);
      const s = 1 + aq.growAnim.t * 0.5;
      const om = T4.trs([0, 0, 0], 0, 0, 0, s);
      sc.add(this.oldKit.opaque, om, { alpha: a * 0.8 });
      for (const gp of this.oldKit.glass) sc.add(gp.mesh, M4.mul(om, T4.trs(gp.pos, 0, 0, 0, 1)), { alpha: gp.a * a });
    }
    sc.add(kit.opaque, root);
    const lightOn = !lampOff;
    for (const gw of kit.glow) {
      let col = gw.col;
      if (gw.light) {
        if (kit.light.col === 'rainbow') col = rgb(hsl((t * 40) % 360, 0.85, 0.72));
        if (!lightOn) col = [0.15, 0.2, 0.28];
      }
      sc.add(gw.mesh, root, { tint: [...col, 1], alpha: gw.a ?? 1 });
    }
    // plants (swaying, pushed by the swimmer)
    PROF.mark('plants');
    const push = aq.swim ? [{ p: aq.swim.p, r: aq.swim.r }] : [];
    for (const f of aq.fish) if (f.len > 3) push.push({ p: f.p, r: f.len * 0.25 });
    this.plantTick = (this.plantTick || 0) + 1;
    if (!this.plantMesh || this.plantTick % 2 === 0 || aq.swim) this.plantMesh = this.plants.frame(this.dyn.plants, t, push.slice(0, 6));
    if (this.plantMesh) sc.add(this.plantMesh, root);
    // decor
    PROF.mark('decor');
    for (const d of aq.decor) {
      const m = d.model || (d.model = decorModel(d.rec.id, d.rec.v || 0));
      const q = d.squash || 0;
      const s = d.k;
      const hop = d.hop || 0;
      const M = R(T4.trs([d.p[0], d.p[1] + hop, d.p[2]], 0, d.yaw + (d.shake || 0) * Math.sin(t * 60) * 0.06, 0, [s * (1 + q * 0.5), s * (1 - q), s * (1 + q * 0.5)]));
      sc.add(m.mesh, M);
      for (const gw of m.glow) sc.add(gw.mesh, M, { tint: [...mixc(gw.col, '#ffffff', 0.2), 1] });
      if (m.part) {
        let pm2 = M;
        const pv = m.part.pivot;
        if (m.part.anim === 'spinY') pm2 = M4.mul(M, M4.mul(T4.trs(pv, 0, t * m.part.speed * 1.5, 0, 1), T4.trs(pv.map((v) => -v), 0, 0, 0, 1)));
        else if (m.part.anim === 'spinZ') pm2 = M4.mul(M, M4.mul(T4.trs(pv, 0, 0, t * m.part.speed * 1.5, 1), T4.trs(pv.map((v) => -v), 0, 0, 0, 1)));
        else if (m.part.anim === 'hover') pm2 = M4.mul(M, T4.trs([0, Math.sin(t * 1.6) * 0.8, 0], 0, t * 0.8, 0, 1));
        else if (m.part.anim === 'flicker') pm2 = M4.mul(M, M4.mul(T4.trs(pv, 0, t * 3, 0, [1, 0.85 + 0.25 * Math.sin(t * 17) * Math.sin(t * 5.3), 1]), T4.trs(pv.map((v) => -v), 0, 0, 0, 1)));
        const pa = decorPartAlpha(d.rec.id);
        if (m.part.anim === 'flicker') sc.add(m.part.mesh, pm2, { tint: [1, 0.62, 0.2, 1] });
        else if (pa < 1) { /* drawn with the clear batch below (sorted with the tank) */ }
        else sc.add(m.part.mesh, pm2);
        d.partModel = pm2;
      }
    }
    // fish
    PROF.mark('fish');
    beginFishFrame(this.aq.visibleKey === 'full' ? 7 : 4);
    for (const f of aq.fish) {
      if (f.alpha <= 0) continue;
      const it = fishFor(f.sp, f.rec, f.phase);
      const wig = f.wiggle * Math.sin(f.age * 40) * 0.5;
      addFish(sc, it, R(T4.trs(f.p, f.bank, f.yaw + wig, f.pitch, f.len / it.L)), f.rec.variant?.mutation === 'ghost' ? { alpha: 0.6 } : {});
    }
    // the swimmer
    PROF.mark('swimmer');
    let headItems = null;
    if (aq.swim) {
      const s = aq.swim;
      const kitA = avatarKit(aq.game.state.character);
      const items = avatarItems(kitA, s.p, s.yaw, s.pitch * 0.7, s.roll || 0, s.r / 5.5, t, s.kick);
      headItems = [];
      for (const it of items) { if (it.o.alpha) headItems.push(it); else sc.add(it.mesh, R(it.model)); }
    }
    // batches: food, drops (orb + coin), eggs  (opaque); bubbles + drop shells (clear)
    PROF.mark('batches');
    const sol = this.dyn.solid.begin(), clr = this.dyn.clear.begin(), glb = this.dyn.glowB.begin();
    const flake = template('flake'), coin = template('coin'), ball0 = template('ball0'), ball1 = template('ball1');
    for (const p of aq.food) sol.stamp(flake, p.p[0], p.p[1], p.p[2], p.r, p.wob, p.rgb || (p.rgb = rgb(p.c)));
    const shell = aq.drops.list.length > 24 ? ball0 : ball1;
    for (const c of aq.drops.list) {
      const r = c.r;
      sol.stamp(coin, c.p[0], c.p[1], c.p[2], r, c.ph * 0.7, c.d === 2 ? COIN_COL[2] : c.d === 1 ? COIN_COL[1] : null);
      clr.stamp(shell, c.p[0], c.p[1], c.p[2], r, 0, c.hint ? WHITE3 : SHELL_COL);
      glb.stamp(ball0, c.p[0] - r * 0.35, c.p[1] + r * 0.45, c.p[2] + r * 0.3, r * 0.16);
    }
    for (const e of aq.st.tank.eggs) {
      const p = T.floorPoint(e.x, e.z, 2);
      const k = clamp01(e.t / e.dur);
      for (let i = 0; i < e.n; i++) {
        const a = i * 2.4, rr = (i % 3) * 0.45 * (T.fishLen / 6);
        sol.push(); sol.at(p[0] + Math.cos(a) * rr, p[1] + 0.35 * (T.fishLen / 6) + (i > 4 ? 0.5 : 0), p[2] + Math.sin(a) * rr);
        sol.sphere(0.32 * (T.fishLen / 6) * (1 + k * 0.2 + Math.sin(t * 6 + i) * k * 0.05), 0, mixc(e.color || '#ffd8a8', '#ffffff', 0.35), { smooth: true });
        sol.pop();
      }
    }
    // arrange-mode ring under the selected decoration
    const sel = aq.arrange && (aq.drag?.d || aq.hoverDecor);
    if (sel) {
      const rr = sel.model ? sel.model.r * sel.k * 1.2 : 3;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU + t, b = a + 0.12;
        glb.tri([sel.p[0] + Math.cos(a) * rr, sel.p[1] + 0.25, sel.p[2] + Math.sin(a) * rr], [sel.p[0] + Math.cos(b) * rr, sel.p[1] + 0.25, sel.p[2] + Math.sin(b) * rr], [sel.p[0] + Math.cos(a) * rr * 0.86, sel.p[1] + 0.25, sel.p[2] + Math.sin(a) * rr * 0.86], '#ffffff');
        glb.tri([sel.p[0] + Math.cos(a) * rr, sel.p[1] + 0.25, sel.p[2] + Math.sin(a) * rr], [sel.p[0] + Math.cos(a) * rr * 0.86, sel.p[1] + 0.25, sel.p[2] + Math.sin(a) * rr * 0.86], [sel.p[0] + Math.cos(b) * rr, sel.p[1] + 0.25, sel.p[2] + Math.sin(b) * rr], '#ffffff');
      }
    }
    for (const b of aq.bubbles) clr.stamp(ball0, b.p[0], b.p[1], b.p[2], b.r, 0, BUB_COL);
    if (headItems) {
      // the bubble head, baked into the clear batch so it sorts with the tank water
      for (const it of headItems) bakeInto(clr, it.mesh, it.model);
    }
    // see-through decor parts (lava lamp glass, plasma globe, gumball dome)
    for (const d of aq.decor) if (d.model?.part && decorPartAlpha(d.rec.id) < 1 && d.partModel) bakeInto(clr, d.model.part.mesh, d.partModel);
    const solM = this.dyn.solid.end(); if (solM) sc.add(solM, root);
    const glbM = this.dyn.glowB.end(); if (glbM) sc.add(glbM, root, { tint: [0.9, 1, 1, 1] });

    // ---- transparent layers, in our own order (all share the tank origin, so insertion order holds)
    PROF.mark('trans');
    const nearPanes = [], farPanes = [];
    for (const gp of kit.glass) {
      if (gp.inner) { farPanes.push(gp); continue; }
      if (T.round) { nearPanes.push(gp); continue; }
      const n = gp.pos[2] > T.D / 2 - 0.1 ? [0, 0, 1] : gp.pos[2] < -T.D / 2 + 0.1 ? [0, 0, -1] : gp.pos[0] > 0 ? [1, 0, 0] : [-1, 0, 0];
      const e = this.eye;
      const near = !swim && (n[0] * (e[0] - gp.pos[0]) + n[2] * (e[2] - gp.pos[2])) > 0;
      (near ? nearPanes : farPanes).push(gp);
    }
    // panes have their own translation: bake it in so every tank layer shares the root origin
    const fi = Math.floor(t * 9) % causticFrames().length;
    const tankT = (o) => sc.add(o.mesh, root, o.o);
    for (const gp of farPanes) this.addOrigin(gp, root, gp.a);
    if (kit.caustic && lightOn) tankT({ mesh: kit.caustic, o: { texture: causticFrames()[fi], tint: [...mixc(kit.lightCol, '#ffffff', 0.5), 1], alpha: (0.42 - night * 0.22) } });
    if (this.shafts && lightOn) tankT({ mesh: this.shafts, o: { texture: shaftTexture(), tint: [...rgb(kit.light.shaft), 1], alpha: (swim ? 0.2 : 0.15) * (1 - night * 0.5) } });
    const clrM = this.dyn.clear.end(); if (clrM) tankT({ mesh: clrM, o: { alpha: 0.34, env: 0.8, iri: 0.6, spec: 0.9, shine: 50, rim: 0.6 } });
    const ga = aq.growAnim;
    const wk = ga ? clamp01((ga.t - 0.6) / 1.4) : 1;
    if (!swim && kit.water && wk > 0.02) {
      kit.water.baked ||= translateMesh(kit.water.mesh, kit.water.pos);
      sc.add(kit.water.baked, wk < 1 ? M4.mul(root, T4.trs([0, 0, 0], 0, 0, 0, [1, wk, 1])) : root, { alpha: 0.3, env: 0.25, spec: 0.2, rim: 0.5 });
    }
    const sm = wk > 0.02 ? surfaceMesh(this.dyn.surf, kit, aq.ripples, (wk - 1) * T.waterY) : null;
    if (sm) sc.add(sm, root, { alpha: swim ? 0.55 : 0.42, env: 0.75, spec: 0.9, shine: 70, rim: 0.3, cull: false });
    for (const gp of nearPanes) this.addOrigin(gp, root, gp.a);

    // ---- light: sky behind (2D), the scene, night grading
    PROF.mark('sky');
    this.drawSky(ctx, x, y, w, h, night);
    const L = norm([-0.36, 0.74, 0.6]);
    PROF.mark('gl');
    const out = sc.render({
      light: L, ambient: lerp(0.5, 0.32, night), spec: 0.38, shine: 26, rim: 0.32, rimColor: night > 0.5 ? '#8aa8ff' : '#cff6ff',
      fog: swim ? clamp(260 / Math.max(15, T.size[0]), 1.2, 9) : 0, fogColor: swim ? '#3aa8d8' : '#bfe8ff',
      sky: night > 0.5 ? '#8aa0e0' : '#eafcff', ground: '#3a8a5a',
    });
    if (!out) return false;
    PROF.mark('blit');
    ctx.drawImage(out, x, y);
    PROF.end();
    if (night > 0.02 || lampOff) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = mixHex('#ffffff', '#4a5ca8', night * 0.55 + (lampOff ? 0.12 : 0));
      ctx.fillRect(x, y, w, h);
      // at night the lit tank glows in the dim room (light only)
      if (night > 0.2 && !lampOff && !swim) {
        const c = this.project([0, T.waterY * 0.55, 0]);
        if (c) {
          const r = Math.max(30, T.size[0] * 0.75 * this.ppu(c[2]));
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createRadialGradient(x + c[0], y + c[1], 0, x + c[0], y + c[1], r);
          const lc = rgb(kit.lightCol);
          const col = `${Math.round(lc[0] * 120)},${Math.round(lc[1] * 200)},${Math.round(lc[2] * 255)}`;
          gr.addColorStop(0, `rgba(${col},${(0.32 * night).toFixed(3)})`); gr.addColorStop(0.55, `rgba(${col},${(0.12 * night).toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = gr;
          ctx.fillRect(x + c[0] - r, y + c[1] - r, r * 2, r * 2);
        }
      }
      ctx.restore();
    }
    return true;
  }

  // transparent mesh with its own offset baked so its sort origin is the tank origin
  addOrigin(gp, root, a) {
    if (!gp.baked) {
      if (gp.pos[0] === 0 && gp.pos[1] === 0 && gp.pos[2] === 0) gp.baked = gp.mesh;
      else gp.baked = translateMesh(gp.mesh, gp.pos);
    }
    this.scene.add(gp.baked, root, gp.streak ? { alpha: a, tint: [1, 1, 1, 1], cull: false } : { alpha: a, env: 0.85, spec: 0.7, shine: 80, rim: 0.5 });
  }
  drawSky(ctx, x, y, w, h, night) {
    // horizon height from the camera pitch
    const far = [this.eye[0] + this.fwd[0] * 3000, this.eye[1], this.eye[2] + this.fwd[2] * 3000];
    const hp = this.project(far);
    const hy = hp ? hp[1] : h * 0.5;
    const top = mixHex('#2a8cf0', '#0a1840', night), mid = mixHex('#7cc8ff', '#2a3a78', night), bot = mixHex('#d8f4ff', '#5a5aa0', night);
    const gr = ctx.createLinearGradient(0, y + hy - h * 1.1, 0, y + hy + 10);
    gr.addColorStop(0, top); gr.addColorStop(0.65, mid); gr.addColorStop(1, bot);
    ctx.fillStyle = gr;
    ctx.fillRect(x, y, w, h);
    // sun (or moon)
    const sd = this.room.sun;
    const sp = this.project([this.eye[0] + sd[0] * 5000, this.eye[1] + sd[1] * 5000, this.eye[2] + sd[2] * 5000]);
    if (sp && sp[0] > -200 && sp[0] < w + 200 && sp[1] > -200 && sp[1] < h + 200) {
      const sx = x + sp[0], sy = y + sp[1];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = h * 0.28;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      const c = night > 0.5 ? '200,215,255' : '255,250,225';
      g.addColorStop(0, `rgba(${c},0.95)`); g.addColorStop(0.08, `rgba(${c},0.8)`); g.addColorStop(0.25, `rgba(${c},0.25)`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      if (night < 0.5) {
        ctx.strokeStyle = 'rgba(255,255,240,0.18)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + this.t * 0.03;
          ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * 8, sy + Math.sin(a) * 8); ctx.lineTo(sx + Math.cos(a) * r * 0.9, sy + Math.sin(a) * r * 0.9); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
}

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
// free the GL buffers of a tank kit / room that is being replaced
function disposeKit(k) {
  const ms = [k.opaque, k.caustic, k.water?.mesh, k.water?.baked, ...k.glow.map((g) => g.mesh), ...k.glass.flatMap((g) => [g.mesh, g.baked])];
  for (const m of new Set(ms)) m?.dispose?.();
}
function disposeRoom(r) {
  for (const m of new Set([r.opaque, ...r.glow.map((g) => g.mesh), ...r.glass.map((g) => g.mesh), ...r.rotors.map((g) => g.mesh), ...r.clouds.map((g) => g.mesh)])) m?.dispose?.();
}
function hsl(h, s, l) {
  const f = (n) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}
function mixHex(a, b, t) { const c = mixc(a, b, clamp01(t)); return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`; }

// copy of a mesh with its vertices moved by off (used to give transparent meshes a shared sort origin)
function translateMesh(mesh, off) {
  const d = new Float32Array(mesh.data);
  for (let i = 0; i < d.length; i += 11) { d[i] += off[0]; d[i + 1] += off[1]; d[i + 2] += off[2]; }
  const b = mesh.bounds;
  return new mesh.constructor(d, mesh.count, { min: b.min.map((v, k) => v + off[k]), max: b.max.map((v, k) => v + off[k]), center: b.center.map((v, k) => v + off[k]), radius: b.radius });
}

// write a mesh transformed by a model matrix into a Geo batch (world space)
function bakeInto(g, mesh, m) {
  const s = mesh.data, n = s.length;
  g.grow(n);
  const d = g.d;
  let o = g.n;
  for (let i = 0; i < n; i += 11) {
    const x = s[i], y = s[i + 1], z = s[i + 2], nx = s[i + 3], ny = s[i + 4], nz = s[i + 5];
    d[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
    d[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    d[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    let ax = m[0] * nx + m[4] * ny + m[8] * nz, ay = m[1] * nx + m[5] * ny + m[9] * nz, az = m[2] * nx + m[6] * ny + m[10] * nz;
    const l = Math.hypot(ax, ay, az) || 1;
    d[o + 3] = ax / l; d[o + 4] = ay / l; d[o + 5] = az / l;
    d[o + 6] = s[i + 6]; d[o + 7] = s[i + 7]; d[o + 8] = s[i + 8]; d[o + 9] = s[i + 9]; d[o + 10] = s[i + 10];
    o += 11;
  }
  g.n = o;
}

export { ID };
