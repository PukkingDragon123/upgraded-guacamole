// Building system (game.build): blueprint mode over the 3D seabed, placed voxel buildings, construction
// animations, building interactions, package grants from catches and the hooks the orchestrator calls.
//
//   update(dt, inp, layer)     call before fishing; in blueprint mode it owns world clicks (consumes input).
//                              Outside blueprint mode a click on a building opens it (only while not fishing).
//   drawWorld(ctx, env, band)  world space. band 0 near / 1 mid / 2 far (z cuts 0.33 / 0.66), 'far' = 1+2,
//                              an array of bands, or undefined = all. Best: 'far' after drawSeabed, 0 after drawNear.
//   drawUi(ctx)                screen space: blueprint overlay + ghost, hover tooltips. Call after the HUD.
//   addLights(L)               push window / lighthouse lights into the ocean lighting list (world coords).
//   hit(wx, wy) -> building record | null (pixel-accurate)
//   toggle(on?) / active       blueprint mode (opens the 'buildtray' panel)
//   onCatch(fish, sp, rec) -> {pkg, items}   samples, eggs and the package the fish carried
//   decorateFish(fishes)       rolls a package for new wild fish (fish.pkg) so they visibly carry crates
//   drawFishPackage(ctx, fish, t)   draws the crate hanging under a fish (world space)
//   dockItems() -> [{id, label, w, action, draw}]  Blueprint + Inventory buttons for the seabed dock
//   bonus(key) -> buildingBonus(state, key)
// state.buildings = [{uid, id, x, z, flip, lvl, built, prod, on}] (x = screen-space x at depth z, z = seabed depth).

import { clamp, clamp01, lerp, ease, TAU, hash2 } from '../core/math.js';
import { rng, uid } from '../core/rng.js';
import { rgba, RARITY } from '../core/color.js';
import { tinted, drawWashed, makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { drawTooltip } from '../ui/panels.js';
import { ITEMS, addItem, removeItem, countItem, hasItems, takeItems, addPackage, rollPackage, drawPackage, TIERS, inventory } from './items.js';
import { BUILDINGS, BUILDING_ORDER, DECOR_BUILDS, buildingDef, buildingBonus, produceInfo, rollProduce, markCollected, levelOf, maxLevelFor, upgradeCost, vaultAccrue, MAX_LEVEL, ZMIN, ZMAX } from './buildings.js';
import { registerBuildPanels } from './panels.js';
import { buildingSprite, WORLD_SCALE, MODEL_IDS } from './buildingmodels.js';
import { researchState, researchStatus, readyCount, PROJECT_BY_ID } from './research.js';
import { itemSprite } from './itemart.js';
import { SPECIES } from '../fish/species.js';
import { rollIndividual } from '../fish/traits.js';

const BAND_PX = [4, 3, 2], BAND_PY = [1, 0.8, 0.6];

// alpha masks for pixel-accurate clicks
const masks = new WeakMap();
function alphaAt(canvas, x, y) {
  let m = masks.get(canvas);
  if (!m) {
    const d = ctxOf(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    m = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
    masks.set(canvas, m);
  }
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return 0;
  return m[(y | 0) * canvas.width + (x | 0)];
}

let gridTex = null;
function blueprintGrid() {
  if (gridTex) return gridTex;
  const c = makeCanvas(48, 48), g = ctxOf(c);
  g.fillStyle = 'rgba(200,236,255,0.07)';
  for (let i = 0; i < 48; i += 12) { g.fillRect(i, 0, 1, 48); g.fillRect(0, i, 48, 1); }
  g.fillStyle = 'rgba(220,244,255,0.16)';
  g.fillRect(0, 0, 1, 48); g.fillRect(0, 0, 48, 1);
  gridTex = c;
  return c;
}

export class Build {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.sel = null;          // selected blueprint item id (bp_*)
    this.mode = 'place';      // place | move | demolish
    this.depth = 0.5;
    this.flip = false;
    this.moving = null;       // uid of the building being moved
    this.ghost = null;
    this.hover = null;
    this.anims = new Map();   // uid -> {t, dur, kind}
    this.wrecks = [];         // demolition animations
    this.confirm = null;      // {uid, t} demolish confirmation
    this.t = 0;
    this.hits = 0;
    this.ensure();
    this.registerPanels();
  }

  // Registers the inventory / research / package / building / buildtray panels if the host has not.
  registerPanels() {
    const ui = this.game.ui;
    if (!ui?.register || this.panelsOk === ui) return;
    this.panelsOk = ui;
    try { registerBuildPanels(ui); } catch (e) { console.error(e); }
  }

  get state() { return this.game.state; }
  bonus(key) { return buildingBonus(this.state, key); }

  // Fills in save fields; starter kit (Research Lab blueprint + materials + a crate) on first run.
  ensure() {
    const st = this.state;
    if (!st || st === this.ensured) return;
    this.ensured = st;
    const inv = inventory(st);
    st.buildings ||= [];
    researchState(st);
    st.vault ||= { coins: 0, last: Date.now(), earned: 0 };
    if (!inv.starter) {
      inv.starter = 1;
      addItem(st, 'bp_research_lab', 1);
      addItem(st, 'driftwood', 6); addItem(st, 'kelp_fibre', 4); addItem(st, 'sea_glass', 2);
      addPackage(st, 'crate', { starter: true });
    }
    vaultAccrue(st);
  }

  // ------------------------------------------------------------------ geometry
  D() { return this.game.ocean?.biome?.D || null; }
  sAt(z) { const D = this.D(); return D ? D.s(z) : 1 - 0.5 * z; }
  bandOf(z) { const D = this.D(); return D ? D.band(z) : z < 0.33 ? 0 : z < 0.66 ? 1 : 2; }
  floorY(x, z) {
    try { const y = this.game.ocean?.floorAt?.(x, z); if (Number.isFinite(y)) return y; } catch { /* biome not ready */ }
    return this.game.screen.H - 60 + z * -80;
  }
  par(z) {
    const p = this.game.ocean?.biome?.par;
    if (!p) return [0, 0];
    const b = this.bandOf(z);
    return [p.x * BAND_PX[b], p.y * BAND_PY[b]];
  }
  fogOf(z) {
    const D = this.D(), b = this.game.ocean?.biome;
    const a = D ? D.fog(z) : clamp(z * (b?.fogAmount ?? 0.6), 0, 0.8);
    return { color: b?.fogColor || '#2a7aa0', alpha: Math.min(0.8, a) };
  }

  // Screen-space sprite placement for a record {id, x, z, flip}.
  layout(b) {
    const s = this.sAt(b.z);
    const scale = WORLD_SCALE * s * (BUILDINGS[b.id] ? 1 : 1.05);
    const spr = buildingSprite(b.id, { scale });
    if (!spr) return null;
    const k = spr.approx || 1;
    const [px, py] = this.par(b.z);
    const gx = Math.round(b.x + px), gy = Math.round(this.floorY(b.x, b.z) + 1 + py);
    const flip = !!b.flip;
    const canvas = flip ? spr.flipped() : spr.canvas;
    const ox = flip ? spr.w - spr.ox : spr.ox;
    const w = Math.round(spr.w * k), h = Math.round(spr.h * k);
    const dx = Math.round(gx - ox * k), dy = Math.round(gy - spr.oy * k);
    const anchor = (name) => {
      const a = spr.anchors?.[name];
      if (!a) return null;
      return [dx + (flip ? spr.w - a.x : a.x) * k, dy + a.y * k];
    };
    return { spr, canvas, glow: flip ? spr.glowFlipped?.() : spr.glow, k, gx, gy, dx, dy, w, h, s, anchor, hw: w * 0.36 };
  }

  sorted() { return this.state.buildings.slice().sort((a, b) => b.z - a.z); }
  byUid(u) { return this.state.buildings.find((b) => b.uid === u) || null; }

  hit(wx, wy) {
    const list = this.sorted().reverse();
    for (const b of list) {
      if (this.active && b.uid === this.moving) continue;
      const L = this.layout(b);
      if (!L) continue;
      if (wx < L.dx || wy < L.dy || wx >= L.dx + L.w || wy >= L.dy + L.h) continue;
      if (alphaAt(L.canvas, (wx - L.dx) / L.k, (wy - L.dy) / L.k) > 40) return b;
    }
    return null;
  }

  // ------------------------------------------------------------------ blueprint mode
  ownedBlueprints() {
    const items = this.state.inventory?.items || {};
    return Object.keys(items).filter((id) => ITEMS[id]?.kind === 'blueprint' && items[id] > 0);
  }

  toggle(on = !this.active) {
    const g = this.game;
    if (on === this.active) return;
    if (on) {
      if (g.fishing?.fighting) { g.toast?.('Finish the fight first!', 'hook'); return; }
      if (g.state.view !== 'ocean') g.setView?.('ocean');
      if (g.fishing?.busy) g.fishing.releaseFish?.(false);
      this.active = true;
      this.mode = 'place';
      if (!this.sel || !countItem(this.state, this.sel)) this.sel = this.ownedBlueprints().sort((a, b) => order(a) - order(b))[0] || null;
      g.ui?.open?.('buildtray');
      g.camera?.scrollTo?.(0);
      g.audio?.play('box_open', { vol: 0.6 });
      g.emit?.('buildMode', true);
    } else {
      this.active = false;
      this.moving = null;
      this.ghost = null;
      this.confirm = null;
      if (g.ui?.isOpen?.('buildtray')) g.ui.close('buildtray');
      g.audio?.play('box_close', { vol: 0.5 });
      g.emit?.('buildMode', false);
    }
  }

  select(itemId) {
    if (!ITEMS[itemId] || ITEMS[itemId].kind !== 'blueprint') return;
    this.sel = itemId;
    this.mode = 'place';
    this.moving = null;
  }

  // Opens blueprint mode with a blueprint picked (inventory "Place" action).
  startPlacing(itemId) {
    this.game.ui?.close?.();
    this.toggle(true);
    if (itemId) this.select(itemId);
  }

  startMove(b) {
    this.game.ui?.close?.();
    this.toggle(true);
    this.mode = 'move';
    this.moving = b.uid;
    this.depth = b.z;
    this.flip = !!b.flip;
  }

  costOf(itemId) {
    const id = ITEMS[itemId]?.builds;
    return buildingDef(id)?.cost || { coins: 0, items: {} };
  }

  canPay(cost) { return this.state.coins >= (cost.coins || 0) && hasItems(this.state, cost.items); }

  // Why a building of `id` can not stand at (x, z); null when it can.
  invalidReason(id, x, z, ignoreUid, newBuild) {
    const g = this.game, W = g.screen.W;
    if (x < 22 || x > W - 22) return 'Too close to the edge';
    if (z < ZMIN || z > ZMAX) return 'Out of the build zone';
    const me = this.layout({ id, x, z, flip: this.flip });
    const hw = me ? me.hw : 30;
    for (const o of this.state.buildings) {
      if (o.uid === ignoreUid) continue;
      if (Math.abs(o.z - z) > 0.2) continue;
      const L = this.layout(o);
      const ohw = L ? L.hw : 30;
      if (Math.abs(o.x - x) < (hw + ohw) * 0.82) return `Overlaps the ${buildingDef(o.id)?.name || 'building'}`;
    }
    if (z < 0.34) {
      for (const d of g.ui?.dock || []) {
        if (!d.rect) continue;
        if (x + hw > d.rect.x - 4 && x - hw < d.rect.x + d.rect.w + 4) return 'Too close to the seabed dock';
      }
    }
    if (newBuild) {
      const def = buildingDef(id);
      if (def?.unique && this.state.buildings.some((b) => b.id === id)) return `You already have a ${def.name}`;
      const cost = def?.cost || {};
      if (this.state.coins < (cost.coins || 0)) return `Needs ${cost.coins} coins`;
      for (const [iid, q] of Object.entries(cost.items || {})) if (countItem(this.state, iid) < q) return `Needs ${q} ${ITEMS[iid]?.name || iid}`;
    }
    return null;
  }

  place(itemId, x, z) {
    const g = this.game, st = this.state;
    const id = ITEMS[itemId]?.builds;
    const def = buildingDef(id);
    if (!def) return false;
    const reason = this.invalidReason(id, x, z, null, true);
    if (reason) { g.audio?.play('ui_error'); g.toast?.(reason + '.', 'cross'); return false; }
    if (def.cost.coins && !g.spendCoins(def.cost.coins)) return false;
    takeItems(st, def.cost.items);
    removeItem(st, itemId, 1);
    const now = Date.now();
    const b = { uid: uid(), id, x: Math.round(x), z: Math.round(z * 1000) / 1000, flip: this.flip, lvl: 1, built: now, prod: now, on: true };
    st.buildings.push(b);
    this.anims.set(b.uid, { t: 0, dur: def.decor ? 1.2 : 2.8, kind: 'build' });
    g.audio?.play('icon_drop', { vol: 0.7 });
    g.audio?.play('box_open', { vol: 0.4, pitch: 0.7 });
    g.camera?.shake?.(2);
    g.emit?.('built', b);
    g.save?.();
    if (!countItem(st, itemId)) {
      const next = this.ownedBlueprints().sort((a, c) => order(a) - order(c))[0];
      this.sel = next || null;
    }
    return b;
  }

  moveTo(b, x, z) {
    const reason = this.invalidReason(b.id, x, z, b.uid, false);
    if (reason) { this.game.audio?.play('ui_error'); this.game.toast?.(reason + '.', 'cross'); return false; }
    b.x = Math.round(x); b.z = Math.round(z * 1000) / 1000; b.flip = this.flip;
    this.anims.set(b.uid, { t: 0, dur: 0.6, kind: 'drop' });
    this.game.audio?.play('icon_drop', { vol: 0.6 });
    this.moving = null;
    this.mode = 'place';
    this.game.save?.();
    return true;
  }

  // Refund: the blueprint plus half the coins and materials.
  refundOf(b) {
    const def = buildingDef(b.id);
    const out = { coins: Math.floor((def?.cost?.coins || 0) * 0.5), items: {} };
    for (const [iid, q] of Object.entries(def?.cost?.items || {})) { const r = Math.floor(q * 0.5); if (r > 0) out.items[iid] = r; }
    return out;
  }

  demolish(b) {
    const g = this.game, st = this.state;
    const L = this.layout(b);
    const ref = this.refundOf(b);
    st.buildings = st.buildings.filter((q) => q.uid !== b.uid);
    addItem(st, 'bp_' + b.id, 1);
    for (const [iid, q] of Object.entries(ref.items)) addItem(st, iid, q);
    if (ref.coins) g.addCoins?.(ref.coins, ...(L ? this.toScreen(L.gx, L.gy - L.h / 2) : []));
    if (b.id === 'vault' && st.vault?.coins > 0) { g.addCoins?.(Math.floor(st.vault.coins)); st.vault.coins = 0; }
    if (L) this.wrecks.push({ L, t: 0, dur: 0.9 });
    g.audio?.play('splash_big', { vol: 0.5, pitch: 0.6 });
    g.camera?.shake?.(4);
    if (L) for (let i = 0; i < 24; i++) g.particles?.bubble(L.gx + rng.float(-L.hw, L.hw), L.gy - rng.float(0, L.h * 0.7), { layer: 'fg', size: rng.pick([1, 2, 3]) });
    g.toast?.(`${buildingDef(b.id)?.name} demolished. Blueprint and half the materials returned.`, 'trash');
    g.save?.();
  }

  upgrade(b) {
    const g = this.game, st = this.state;
    const def = BUILDINGS[b.id];
    if (!def) return false;
    if (levelOf(b) >= MAX_LEVEL) return false;
    if (levelOf(b) >= maxLevelFor(st)) { g.audio?.play('ui_error'); g.toast?.('Research better engineering in the Lab to upgrade further.', 'lock'); return false; }
    const cost = upgradeCost(b);
    if (!cost || !this.canPay(cost)) { g.audio?.play('ui_error'); g.toast?.('Not enough coins or materials.', 'coin'); return false; }
    if (cost.coins && !g.spendCoins(cost.coins)) return false;
    takeItems(st, cost.items);
    b.lvl = levelOf(b) + 1;
    this.anims.set(b.uid, { t: 0, dur: 2, kind: 'upgrade' });
    g.audio?.play('ui_unlock');
    g.save?.();
    return true;
  }

  // ------------------------------------------------------------------ interactions
  interact(b) {
    const g = this.game;
    const P = produceInfo(b);
    if (P && P.ready > 0) { this.collect(b); return; }
    if (b.id === 'research_lab') {
      const rd = readyCount(this.state);
      g.ui?.open?.('research');
      if (rd) g.audio?.play('notify');
      return;
    }
    g.ui?.open?.('building', { uid: b.uid });
  }

  collect(b) {
    const g = this.game;
    const P = produceInfo(b);
    if (!P || P.ready <= 0) return [];
    const got = rollProduce(b, P.ready);
    markCollected(b, P.ready);
    const L = this.layout(b);
    const [sx, sy] = L ? this.toScreen(L.gx, L.dy + 6) : [g.screen.W / 2, g.screen.H / 2];
    for (const it of got) {
      if (it.id === 'coins') g.addCoins?.(it.qty, sx, sy);
      else {
        addItem(this.state, it.id, it.qty);
        const spr = itemSprite(ITEMS[it.id]?.art || it.id, { frame: 0, force: true });
        if (spr) g.particles?.sprite(sx + rng.float(-10, 10), sy, spr.canvas, { layer: 'ui', vy: -30, life: 1.4 });
        g.particles?.text(sx, sy - 16, `+${it.qty} ${ITEMS[it.id]?.name || it.id}`, { color: RARITY[ITEMS[it.id]?.rarity || 'common'].color });
      }
    }
    g.particles?.bubbles?.(sx, sy, 8, { layer: 'ui' });
    g.audio?.play('coin_collect', { vol: 0.6 });
    g.audio?.play('bubbles', { vol: 0.4 });
    g.save?.();
    return got;
  }

  // Hatches a fish egg into a baby fish of the current ocean (sent to the aquarium / holding bucket).
  hatchEgg() {
    const g = this.game, st = this.state;
    if (!removeItem(st, 'fish_egg', 1)) return null;
    const biome = g.ocean?.biome?.id || 'shallows';
    const pool = SPECIES.filter((s) => s.biome === biome && s.look?.kind !== 'chain' && !s.spawn?.hidden && s.rarity !== 'legendary');
    const sp = rng.weighted(pool.length ? pool : SPECIES.slice(0, 5), (s) => RARITY[s.rarity]?.weight ?? 1);
    const rec = rollIndividual(sp, { ...(g.world?.rollMods || {}), sizeBonus: -0.3 });
    rec.hatched = Date.now();
    const j = (st.journal[sp.id] ||= { seen: true, caught: 0, maxSize: 0, minSize: 9999, first: Date.now(), variants: {} });
    j.seen = true;
    if (g.keepFish) g.keepFish(rec); else st.fish.push({ ...rec, inTank: false });
    g.audio?.play('new_species', { vol: 0.6 });
    g.audio?.play('bubbles', { vol: 0.5 });
    g.toast?.(`A baby ${sp.name} hatched! Say hi to ${rec.name}.`, 'heart', 5);
    g.save?.();
    return rec;
  }

  toScreen(wx, wy) { return this.game.camera?.worldToScreen ? this.game.camera.worldToScreen(wx, wy) : [wx, wy]; }
  toWorld(sx, sy) { return this.game.camera?.screenToWorld ? this.game.camera.screenToWorld(sx, sy) : [sx, sy]; }

  // ------------------------------------------------------------------ catches & packages
  decorateFish(fishes) {
    if (!fishes) return;
    const biome = this.game.ocean?.biome?.id;
    for (const f of fishes) {
      if (f._pkgRolled || !f.sp) continue;
      f._pkgRolled = true;
      f.pkg = rollPackage(f.sp, biome, this.bonus('luck'));
    }
  }

  drawFishPackage(ctx, f, t = this.t) {
    if (!f?.pkg) return;
    const a = f.anchors?.bottom || [f.x, f.y + 6 * (f.scale || 1)];
    drawPackage(ctx, a[0] - (f.facing || 1) * 2, a[1] - 1, f.pkg.tier, t + (f.x || 0) * 0.013, { scale: clamp(0.42 * (f.scale || 1) * (1 - (f.z || 0) * 0.4), 0.32, 0.6) });
  }

  onCatch(fish, sp, rec) {
    const st = this.state, g = this.game;
    this.ensure();
    sp ||= fish?.sp;
    const biome = g.ocean?.biome?.id;
    const items = [];
    const give = (id, q = 1) => { addItem(st, id, q); items.push({ id, qty: q }); };
    give('fish_sample', 1);
    const r = sp?.rarity || 'common';
    if ((r === 'rare' && rng.chance(0.35)) || (r === 'epic' && rng.chance(0.65)) || r === 'legendary') give('rare_specimen', 1);
    if (r === 'legendary' && rng.chance(0.4)) give('golden_scale', 1);
    if (rng.chance(this.bonus('eggChance'))) give('fish_egg', 1);
    let pkg = fish?.pkg;
    if (pkg === undefined && !fish?._pkgRolled) pkg = rollPackage(sp, biome, this.bonus('luck'));
    if (pkg) {
      const p = addPackage(st, pkg.tier, { species: sp?.id || null, biome });
      items.push({ id: 'pkg_' + p.tier, qty: 1, uid: p.uid });
      if (fish) fish.pkg = null;
      setTimeout(() => g.toast?.(`${sp?.name || 'The fish'} was carrying a ${TIERS[p.tier].name}! Open it in your Inventory.`, 'star', 5), 900);
      setTimeout(() => g.audio?.play(p.tier === 'orb' || p.tier === 'golden' ? 'golden_shimmer' : 'treasure_open', { vol: 0.6 }), 700);
    }
    if (rng.chance(this.bonus('baitSave'))) this.savedBait = true;
    return { pkg: pkg || null, items };
  }

  // ------------------------------------------------------------------ update
  update(dt, inp, layer) {
    const g = this.game;
    this.t += dt;
    this.ensure();
    this.registerPanels();
    for (const [u, a] of this.anims) {
      a.t += dt;
      if (a.kind === 'build') this.buildFx(u, a, dt);
      if (a.t >= a.dur) {
        this.anims.delete(u);
        if (a.kind === 'build' || a.kind === 'upgrade') this.finishFx(u, a);
      }
    }
    for (const w of this.wrecks) w.t += dt;
    this.wrecks = this.wrecks.filter((w) => w.t < w.dur);
    if (this.confirm && (this.confirm.t += dt) > 2.5) this.confirm = null;
    this.ambientFx(dt);
    if (!inp) return;
    if (!this.active) {
      this.ghost = null;
      const free = (layer === null || layer === undefined || layer === 'build') && g.state.view === 'ocean' && inp.inside && !g.fishing?.busy && !g.fishing?.fighting && !g.ocean?.travelState;
      if (free) {
        const [wx, wy] = this.toWorld(inp.x, inp.y);
        this.hover = this.hit(wx, wy);
        if (this.hover && inp.pressed) { inp.consume(); g.audio?.play('ui_click'); this.interact(this.hover); }
      } else this.hover = null;
      return;
    }
    // ---- blueprint mode
    if (g.state.view !== 'ocean' || g.ocean?.travelState || g.fishing?.fighting) { this.toggle(false); return; }
    if (inp.keyPressed?.('f') || inp.keyPressed?.('r')) { this.flip = !this.flip; g.audio?.play('ui_toggle'); }
    if (inp.keyPressed?.('w') || inp.keyPressed?.('ArrowUp')) this.setDepth(this.depth + 0.05);
    if (inp.keyPressed?.('s') || inp.keyPressed?.('ArrowDown')) this.setDepth(this.depth - 0.05);
    const overUi = layer === 'ui' || layer === 'tank' || layer === 'drag' || layer === 'tutorial' || layer === 'boat';
    if (overUi) { this.hover = null; if (this.ghost) this.ghost.show = false; return; }
    if (inp.wheel) { this.setDepth(this.depth + inp.wheel * 0.03); inp.wheel = 0; }
    const [wx, wy] = this.toWorld(inp.x, inp.y);
    this.hover = this.mode === 'place' && !this.moving ? null : this.hit(wx, wy);
    const mv = this.moving ? this.byUid(this.moving) : null;
    const id = mv ? mv.id : ITEMS[this.sel]?.builds;
    if (id && (this.mode === 'place' || mv)) {
      const x = clamp(Math.round(wx), 0, g.screen.W);
      const reason = this.invalidReason(id, x, this.depth, mv?.uid, !mv);
      this.ghost = { id, x, z: this.depth, reason, show: inp.inside };
    } else this.ghost = null;
    if (inp.rpressed) {
      if (this.moving) { this.moving = null; this.mode = 'place'; } else if (this.mode !== 'place') this.mode = 'place'; else this.sel = null;
      g.audio?.play('ui_close');
    }
    if (inp.pressed) {
      inp.consume();
      if (mv && this.ghost) this.moveTo(mv, this.ghost.x, this.ghost.z);
      else if (this.mode === 'place' && this.ghost) this.place(this.sel, this.ghost.x, this.ghost.z);
      else if (this.mode === 'move' && this.hover) { this.moving = this.hover.uid; this.flip = !!this.hover.flip; this.depth = this.hover.z; g.audio?.play('icon_pickup'); }
      else if (this.mode === 'demolish' && this.hover) {
        if (this.confirm?.uid === this.hover.uid) { this.confirm = null; this.demolish(this.hover); } else { this.confirm = { uid: this.hover.uid, t: 0 }; g.audio?.play('slack_warn', { vol: 0.5 }); }
      }
    }
    inp.dblclick = false;
  }

  setDepth(z) { this.depth = clamp(z, ZMIN, ZMAX); }

  // hammer sparks, dust and knocks while a building goes up
  buildFx(u, a, dt) {
    const b = this.byUid(u);
    if (!b) return;
    const k = a.t / a.dur;
    if (k < 0.12 || k > 0.86) return;
    const L = this.layout(b);
    if (!L) return;
    const g = this.game;
    const period = 0.2;
    const n = Math.floor(a.t / period);
    if (n !== a.lastHit) {
      a.lastHit = n;
      const reveal = clamp01((k - 0.12) / 0.74);
      const hx = L.gx + rng.float(-L.hw, L.hw), hy = L.gy - L.h * reveal * 0.95;
      for (let i = 0; i < 6; i++) g.particles?.add({ kind: 'dot', x: hx, y: hy, vx: rng.float(-50, 50), vy: rng.float(-70, -20), g: 160, drag: 1, life: rng.float(0.25, 0.5), color: rng.pick(['#fff6c8', '#ffd25a', '#ffffff']), add: true, layer: 'fg' });
      for (let i = 0; i < 2; i++) g.particles?.add({ kind: 'dot', x: hx, y: hy, vx: rng.float(-30, 30), vy: rng.float(-40, -10), g: 120, drag: 1.5, life: 0.7, size: 2, color: rng.pick(['#c8925a', '#9a6a3a']), layer: 'fg' });
      if (n % 2 === 0) g.audio?.play('click', { vol: 0.55, pitch: rng.float(0.55, 0.75) });
      else g.audio?.play('mash_pop', { vol: 0.25, pitch: rng.float(0.5, 0.7) });
      if (n % 3 === 0) g.particles?.bubble(hx, hy, { layer: 'fg' });
    }
    if (rng.chance(dt * 20)) g.particles?.add({ kind: 'dot', x: L.gx + rng.float(-L.hw * 1.3, L.hw * 1.3), y: L.gy - 1, vx: rng.float(-20, 20), vy: rng.float(-14, -4), g: -4, drag: 1.2, life: 1.2, size: 2, color: '#d8c8a8', layer: 'fg' });
  }

  finishFx(u, a) {
    const b = this.byUid(u);
    const g = this.game;
    if (!b) return;
    const L = this.layout(b);
    const def = buildingDef(b.id);
    if (L) {
      const cx = L.gx, cy = L.gy - L.h * 0.5;
      g.particles?.burst?.(cx, cy, 36, { colors: ['#fff6b0', '#ffd25a', '#9af0ff', '#ffffff'], speed: 110, g: 40, add: true, life: 1.1, layer: 'fg' });
      g.particles?.ring?.(L.gx, L.gy, 2.4, 'rgba(255,246,200,0.9)');
      for (let i = 0; i < 14; i++) g.particles?.sparkle(cx + rng.float(-L.hw, L.hw), cy + rng.float(-L.h * 0.4, L.h * 0.4), '#fff6b0');
      g.particles?.bubbles?.(cx, L.gy - 4, 14, { layer: 'fg' });
    }
    g.audio?.play(a.kind === 'upgrade' ? 'golden_shimmer' : 'ui_unlock', { vol: 0.8 });
    g.audio?.play('sparkle', { vol: 0.6 });
    g.camera?.shake?.(3);
    if (!def?.decor) g.toast?.(a.kind === 'upgrade' ? `${def?.name} upgraded to level ${levelOf(b)}!` : `${def?.name} built! Click it to use it.`, a.kind === 'upgrade' ? 'star' : 'home');
  }

  // chimney bubbles, bubble-tower coin bubbles, sparkles on ready buildings
  ambientFx(dt) {
    const g = this.game;
    if (!g.particles || g.state.view !== 'ocean' || g.lowPower) return;
    for (const b of this.state.buildings) {
      if (this.anims.has(b.uid)) continue;
      const L = this.layout(b);
      if (!L) continue;
      if (b.id === 'research_lab' && rng.chance(dt * 1.6)) { const a = L.anchor('smoke'); if (a) g.particles.bubble(a[0], a[1], { layer: 'bg', size: rng.pick([1, 1, 2]) }); }
      if (b.id === 'bubble_tower' && rng.chance(dt * 2.4)) { const a = L.anchor('top'); if (a) g.particles.bubble(a[0] + rng.float(-2, 2), a[1], { layer: 'bg', size: rng.pick([2, 3, 3]) }); }
      if (b.id === 'hatchery' && rng.chance(dt * 0.8)) g.particles.bubble(L.gx + rng.float(-L.hw, L.hw) * 0.5, L.dy + L.h * 0.3, { layer: 'bg', size: 1 });
      if (b.id === 'totem' && rng.chance(dt * 1.2)) g.particles.sparkle(L.gx + rng.float(-8, 8) * L.s, L.dy + rng.float(0, L.h * 0.6), '#9aff8a', { layer: 'bg' });
      const P = produceInfo(b);
      if (P?.ready > 0 && rng.chance(dt * 1.5)) g.particles.sparkle(L.gx + rng.float(-L.hw, L.hw), L.dy + rng.float(0, L.h * 0.5), '#fff6b0', { layer: 'bg' });
    }
  }

  // ------------------------------------------------------------------ drawing (world)
  drawWorld(ctx, env = this.game.ocean?.env || {}, band) {
    const g = this.game;
    if (g.state.view !== 'ocean') return;
    const want = band === undefined || band === null ? null : Array.isArray(band) ? band : band === 'far' ? [1, 2] : [band];
    for (const b of this.sorted()) {
      if (want && !want.includes(this.bandOf(b.z))) continue;
      if (this.active && b.uid === this.moving) continue;
      this.drawOne(ctx, b, env);
    }
    for (const w of this.wrecks) {
      if (want && !want.includes(0)) continue;
      const k = ease.inQuad(clamp01(w.t / w.dur)), L = w.L;
      const sink = Math.round(L.h * k);
      ctx.globalAlpha = 1 - k * 0.6;
      if (L.h - sink > 0) ctx.drawImage(L.canvas, 0, 0, L.canvas.width, Math.max(1, Math.round((L.h - sink) / L.k)), L.dx + Math.round(Math.sin(w.t * 60) * 2), L.dy + sink, L.w, L.h - sink);
      ctx.globalAlpha = 1;
    }
  }

  darkness() {
    const g = this.game;
    const d = g.world?.glowLevel;
    if (Number.isFinite(d)) return clamp01(d);
    return clamp01(1 - (g.ocean?.env?.daylight ?? 1));
  }

  drawOne(ctx, b, env) {
    const L = this.layout(b);
    if (!L) return;
    const t = this.t;
    const anim = this.anims.get(b.uid);
    const fog = this.fogOf(b.z);
    const hov = !this.active && this.hover?.uid === b.uid;
    const sel = this.active && this.hover?.uid === b.uid && this.mode !== 'place';
    if (hov || sel) {
      const oc = tinted(L.canvas, sel && this.mode === 'demolish' ? '#ff5a4a' : '#fff6c8');
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(oc, L.dx + ox, L.dy + oy, L.w, L.h);
    }
    if (anim && anim.kind === 'build') {
      const k = anim.t / anim.dur;
      const reveal = ease.outQuad(clamp01((k - 0.12) / 0.74));
      const vis = Math.round(L.canvas.height * reveal);
      // ground shadow footprint
      ctx.fillStyle = rgba('#1a2a3a', 0.25);
      ctx.fillRect(Math.round(L.gx - L.hw * 1.2), L.gy - 1, Math.round(L.hw * 2.4), 2);
      if (vis > 0) {
        const sy = L.canvas.height - vis;
        drawWashed(ctx, L.canvas, 0, sy, L.canvas.width, vis, L.dx, L.dy + Math.round(sy * L.k), L.w, Math.round(vis * L.k), fog.color, fog.alpha);
        // fresh-built shimmer on the newest row
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6;
        ctx.drawImage(tinted(L.canvas, '#fff6c8'), 0, sy, L.canvas.width, Math.min(2, vis), L.dx, L.dy + Math.round(sy * L.k), L.w, 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      this.drawScaffold(ctx, L, k, t);
      return;
    }
    let dy = 0, sq = 0;
    if (anim?.kind === 'drop') { const k = anim.t / anim.dur; dy = -Math.round((1 - ease.outBounce(k)) * 14); }
    if (anim?.kind === 'upgrade') sq = Math.sin(anim.t * 18) * (1 - anim.t / anim.dur) * 0.06;
    if (sq) {
      const w2 = Math.round(L.w * (1 + sq)), h2 = Math.round(L.h * (1 - sq));
      drawWashed(ctx, L.canvas, 0, 0, L.canvas.width, L.canvas.height, Math.round(L.gx - (L.gx - L.dx) * (1 + sq)), L.gy - Math.round((L.gy - L.dy) * (1 - sq)), w2, h2, fog.color, fog.alpha);
    } else drawWashed(ctx, L.canvas, 0, 0, L.canvas.width, L.canvas.height, L.dx, L.dy + dy, L.w, L.h, fog.color, fog.alpha);
    // emissive windows glow in the dark
    const dark = this.darkness();
    if (L.glow && dark > 0.05 && b.on !== false) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, dark * 1.2) * (0.75 + 0.1 * Math.sin(t * 3 + b.x));
      ctx.drawImage(L.glow, L.dx, L.dy + dy, L.w, L.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    this.drawExtras(ctx, b, L, t, dark);
  }

  drawScaffold(ctx, L, k, t) {
    const up = ease.outBack(clamp01(k / 0.15));
    const down = k > 0.86 ? ease.inQuad(clamp01((k - 0.86) / 0.14)) : 0;
    const x0 = Math.round(L.gx - L.hw * 1.25), x1 = Math.round(L.gx + L.hw * 1.25);
    const top = Math.round(L.gy - L.h * 0.95 * up);
    const off = Math.round(down * L.h * 0.6);
    ctx.globalAlpha = 1 - down;
    const pole = '#8a5a32', poleL = '#c8925a', plank = '#b07a48';
    const cols = Math.max(2, Math.round((x1 - x0) / 22));
    for (let i = 0; i <= cols; i++) {
      const x = Math.round(lerp(x0, x1, i / cols));
      ctx.fillStyle = pole; ctx.fillRect(x, top + off, 2, L.gy - top);
      ctx.fillStyle = poleL; ctx.fillRect(x, top + off, 1, L.gy - top);
    }
    for (let y = L.gy - 12; y > top; y -= 16) {
      ctx.fillStyle = plank; ctx.fillRect(x0 - 2, y + off, x1 - x0 + 6, 2);
      ctx.fillStyle = '#e0b07a'; ctx.fillRect(x0 - 2, y + off, x1 - x0 + 6, 1);
      ctx.fillStyle = 'rgba(40,20,10,0.5)';
      for (let i = 0; i < cols; i++) {
        const xa = Math.round(lerp(x0, x1, i / cols)), xb = Math.round(lerp(x0, x1, (i + 1) / cols));
        for (let s = 0; s < 14; s += 2) ctx.fillRect(Math.round(lerp(xa, xb, s / 14)), y + off + 2 + s, 1, 1);
      }
    }
    // a little crane hook swinging above
    const hx = Math.round(L.gx + Math.sin(t * 2) * 6), hy = top - 10 + off;
    ctx.fillStyle = '#5d6275'; ctx.fillRect(hx, hy - 24, 1, 24);
    ctx.fillStyle = '#e0a844'; ctx.fillRect(hx - 2, hy, 5, 2); ctx.fillRect(hx + 2, hy + 2, 1, 2);
    // hard-hat crab hammering on the top plank
    const cy = top + off - 2, cx = Math.round(L.gx - L.hw * 0.6);
    const hit = Math.sin(t * 31) > 0;
    ctx.fillStyle = '#3a1210'; ctx.fillRect(cx - 4, cy - 5, 9, 5);
    ctx.fillStyle = '#e8583a'; ctx.fillRect(cx - 3, cy - 5, 7, 4);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(cx - 3, cy - 8, 7, 3); ctx.fillRect(cx - 4, cy - 6, 9, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 2, cy - 4, 1, 1); ctx.fillRect(cx + 2, cy - 4, 1, 1);
    ctx.fillStyle = '#1a1020'; ctx.fillRect(cx - 2, cy - 3, 1, 1); ctx.fillRect(cx + 2, cy - 3, 1, 1);
    ctx.fillStyle = '#e8583a'; ctx.fillRect(cx - 5, cy - 2, 1, 2); ctx.fillRect(cx + 5, cy - 3, 1, 2);
    ctx.fillStyle = '#8a5a32'; ctx.fillRect(cx + 5, cy - (hit ? 4 : 8), 1, 5);
    ctx.fillStyle = '#7a8094'; ctx.fillRect(cx + 4, cy - (hit ? 5 : 9), 4, 2);
    ctx.globalAlpha = 1;
  }

  drawExtras(ctx, b, L, t, dark) {
    const g = this.game;
    // lighthouse beam
    if (b.id === 'lighthouse' && b.on !== false) {
      const lamp = L.anchor('lamp');
      if (lamp) {
        const str = (0.18 + dark * 0.6) * (this.bonus('light') || 1);
        const ang = Math.sin(t * 0.55) * 1.2 + (b.flip ? Math.PI : 0);
        const len = 300 * L.s, spread = 0.13;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createRadialGradient(lamp[0], lamp[1], 2, lamp[0], lamp[1], len);
        gr.addColorStop(0, rgba('#fff6b0', 0.5 * str));
        gr.addColorStop(0.4, rgba('#fff6b0', 0.18 * str));
        gr.addColorStop(1, rgba('#fff6b0', 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(lamp[0], lamp[1]);
        ctx.lineTo(lamp[0] + Math.cos(ang - spread) * len, lamp[1] + Math.sin(ang - spread) * len * 0.35 - len * 0.15);
        ctx.lineTo(lamp[0] + Math.cos(ang + spread) * len, lamp[1] + Math.sin(ang + spread) * len * 0.35 - len * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba('#ffffff', 0.5 * str + 0.3);
        ctx.fillRect(Math.round(lamp[0]) - 1, Math.round(lamp[1]) - 1, 3, 3);
        ctx.restore();
      }
    }
    // antenna tip blink
    if (b.id === 'research_lab') {
      const tip = L.anchor('tip');
      if (tip && Math.sin(t * 4) > 0.4) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#ff4a4a', 0.8);
        ctx.fillRect(Math.round(tip[0]) - 1, Math.round(tip[1]) - 1, 3, 3);
        ctx.fillStyle = rgba('#ff4a4a', 0.25);
        ctx.fillRect(Math.round(tip[0]) - 3, Math.round(tip[1]) - 3, 7, 7);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // arcade marquee chaser lights
    if (b.id === 'arcade') {
      ctx.globalCompositeOperation = 'lighter';
      const n = Math.floor(t * 8);
      ctx.fillStyle = rgba(n % 2 ? '#ff4ab8' : '#4af0ff', 0.25 + 0.15 * Math.sin(t * 9));
      ctx.fillRect(L.dx + Math.round(L.w * 0.1), L.dy + Math.round(L.h * 0.12), Math.round(L.w * 0.6), 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    // status badge: production ready / research progress
    const top = L.anchor('top') || [L.gx, L.dy];
    const bob = Math.round(Math.sin(t * 3 + b.x) * 2);
    const P = produceInfo(b);
    let icon = null;
    if (P?.ready > 0) icon = b.id === 'bubble_tower' ? 'coin' : b.id === 'hatchery' ? 'heart' : 'star';
    if (b.id === 'research_lab') {
      const R = researchState(this.state);
      if (R.active.some((a) => Date.now() >= a.end)) icon = 'exclaim';
      else if (R.active.length) {
        const a = R.active[0];
        const k = clamp01((Date.now() - a.start) / Math.max(1, a.end - a.start));
        const bx = Math.round(top[0] - 12), by = Math.round(top[1] - 10 + bob);
        ctx.fillStyle = '#0a1a2a'; ctx.fillRect(bx - 1, by - 1, 26, 5);
        ctx.fillStyle = '#2a4a6a'; ctx.fillRect(bx, by, 24, 3);
        ctx.fillStyle = '#7affc8'; ctx.fillRect(bx, by, Math.round(24 * k), 3);
        ctx.fillStyle = '#e8fff4'; ctx.fillRect(bx, by, Math.round(24 * k), 1);
        const gi = getUiIcon('gear');
        if (gi) ctx.drawImage(gi, bx - 12, by - 3);
      }
    }
    if (b.id === 'totem' && Date.now() - (b.blessed || 0) > 20 * 3600 * 1000) icon = 'crown';
    if (icon && !this.active) {
      const ic = getUiIcon(icon);
      const bx = Math.round(top[0]), by = Math.round(top[1] - 14 + bob);
      ctx.fillStyle = '#14202c'; ctx.fillRect(bx - 7, by - 7, 15, 14); ctx.fillRect(bx - 8, by - 6, 17, 12);
      ctx.fillStyle = '#fff6e2'; ctx.fillRect(bx - 6, by - 6, 13, 12); ctx.fillRect(bx - 7, by - 5, 15, 10);
      ctx.fillStyle = '#fff6e2'; ctx.fillRect(bx - 1, by + 6, 3, 2); ctx.fillRect(bx, by + 8, 1, 1);
      if (ic) ctx.drawImage(ic, bx - Math.floor(ic.width / 2) + 1, by - Math.floor(ic.height / 2));
    }
    void g;
  }

  addLights(L) {
    if (!L || !L.lights) return L;
    const dark = this.darkness();
    if (dark < 0.05) return L;
    for (const b of this.state.buildings) {
      if (b.on === false) continue;
      const Ly = this.layout(b);
      if (!Ly) continue;
      const lights = Ly.spr.lights || [];
      for (const l of lights.slice(0, 4)) L.lights.push({ x: Ly.dx + (b.flip ? Ly.spr.w - l.x : l.x) * Ly.k, y: Ly.dy + l.y * Ly.k, r: Math.max(18, l.r * 0.8), color: l.color, a: 0.55 });
      if (b.id === 'lighthouse') {
        const lamp = Ly.anchor('lamp');
        if (lamp) {
          const str = this.bonus('light') || 1;
          L.lights.push({ x: lamp[0], y: lamp[1], r: 120 * str * Ly.s, color: '#fff6b0', a: 0.9 });
          const ang = Math.sin(this.t * 0.55) * 1.2 + (b.flip ? Math.PI : 0);
          for (let i = 1; i <= 3; i++) L.lights.push({ x: lamp[0] + Math.cos(ang) * 70 * i * Ly.s, y: lamp[1] + Math.sin(ang) * 25 * i * Ly.s - 10 * i, r: (50 + i * 18) * str * Ly.s, color: '#fff6b0', a: 0.5 / i });
        }
      }
    }
    return L;
  }

  // ------------------------------------------------------------------ drawing (screen): blueprint overlay
  drawUi(ctx) {
    const g = this.game;
    if (!this.active) {
      if (this.hover && g.input?.inside && !g.ui?.blocking) {
        const def = buildingDef(this.hover.id);
        const P = produceInfo(this.hover);
        drawTooltip(ctx, g.input.x, g.input.y, `${def?.name || 'Building'}${BUILDINGS[this.hover.id] ? ` (Lv ${levelOf(this.hover)})` : ''} - ${P?.ready ? 'click to collect!' : this.hover.id === 'research_lab' ? 'click to enter' : 'click to open'}`, { maxW: 200 });
      }
      return;
    }
    const W = g.screen.W, H = g.screen.H, t = this.t;
    // blueprint wash + paper grid
    ctx.fillStyle = rgba('#0a3a7a', 0.42);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ctx.createPattern(blueprintGrid(), 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    g.camera?.apply?.(ctx);
    this.drawSeabedGrid(ctx, t);
    // existing buildings as chalk drawings
    for (const b of this.sorted()) {
      if (b.uid === this.moving) continue;
      const L = this.layout(b);
      if (!L) continue;
      const hot = this.hover?.uid === b.uid && this.mode !== 'place';
      const col = hot ? (this.mode === 'demolish' ? '#ff6a5a' : '#ffe27a') : '#e8f6ff';
      ctx.globalAlpha = hot ? 0.95 : 0.55;
      const oc = tinted(L.canvas, col);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(oc, L.dx + ox, L.dy + oy, L.w, L.h);
      ctx.globalAlpha = hot ? 0.3 : 0.6;
      ctx.drawImage(tinted(L.canvas, '#2a6ab8'), L.dx, L.dy, L.w, L.h);
      ctx.globalAlpha = 1;
      const name = buildingDef(b.id)?.name || '';
      drawText(ctx, name.toUpperCase(), L.gx, L.gy + 4, { font: 'small', align: 'center', color: col, outline: '#0a2a5a' });
      if (hot && this.mode === 'demolish') {
        const ref = this.refundOf(b);
        drawText(ctx, this.confirm?.uid === b.uid ? 'CLICK AGAIN TO DEMOLISH' : `DEMOLISH? REFUND ${ref.coins}c + BLUEPRINT`, L.gx, L.dy - 10, { font: 'small', align: 'center', color: '#ffb0a0', outline: '#3a0a0a' });
      }
      if (hot && this.mode === 'move') drawText(ctx, 'CLICK TO PICK UP', L.gx, L.dy - 10, { font: 'small', align: 'center', color: '#ffe27a', outline: '#3a2a0a' });
    }
    if (this.ghost?.show !== false && this.ghost) this.drawGhost(ctx, this.ghost, t);
    ctx.restore();
    // top hint + title block
    const mv = this.moving ? this.byUid(this.moving) : null;
    const hint = mv ? 'Click to set it down  -  F: flip  -  W/S or wheel: depth  -  Right-click: cancel'
      : this.mode === 'move' ? 'Click a building to move it  -  Right-click: back to placing'
        : this.mode === 'demolish' ? 'Click a building twice to demolish it (refunds the blueprint and half the cost)'
          : this.sel ? 'Click the seabed to build  -  F: flip  -  W/S or wheel: depth  -  Right-click: deselect' : 'Pick a blueprint from the tray below';
    const hw = measureText(hint) + 16;
    ctx.fillStyle = rgba('#06204a', 0.8);
    ctx.fillRect(Math.round(W / 2 - hw / 2), 30, hw, 15);
    ctx.fillStyle = rgba('#e8f6ff', 0.6);
    ctx.fillRect(Math.round(W / 2 - hw / 2), 30, hw, 1); ctx.fillRect(Math.round(W / 2 - hw / 2), 44, hw, 1);
    drawText(ctx, hint, W / 2, 34, { align: 'center', color: '#e8f6ff' });
    drawText(ctx, 'BLUEPRINT MODE', W / 2, 18, { align: 'center', color: '#ffffff', outline: '#0a2a5a', scale: 2, wave: 0.5, time: t });
    this.drawTitleBlock(ctx, W - 186, Math.round(g.ui?.panels?.buildtray?.rect?.y ?? H - 120) - 46, t);
  }

  // perspective chalk grid over the real seabed heightfield
  drawSeabedGrid(ctx, t) {
    const g = this.game, W = g.screen.W;
    const cx = W / 2;
    const chalk = (x, y, a) => { ctx.globalAlpha = a; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); };
    ctx.fillStyle = '#e8f6ff';
    for (let zi = 0; zi <= 13; zi++) {
      const z = ZMIN + (zi / 13) * (ZMAX - ZMIN);
      const [px, py] = this.par(z);
      for (let x = 0; x <= W; x += 2) {
        if (hash2(x >> 1, zi, 7) < 0.18) continue;
        chalk(x + px, this.floorY(x, z) + py, 0.32 - zi * 0.012);
      }
    }
    for (let k = -14; k <= 14; k++) {
      const X = cx + k * 44;
      for (let zz = 0; zz <= 1; zz += 0.012) {
        const z = ZMIN + zz * (ZMAX - ZMIN);
        const sx = cx + (X - cx) * this.sAt(z);
        if (sx < 0 || sx > W) continue;
        const [px, py] = this.par(z);
        if (hash2(k + 40, Math.floor(zz * 300), 3) < 0.2) continue;
        chalk(sx + px, this.floorY(sx, z) + py, 0.26);
      }
    }
    // the chosen depth line, bright and wobbling
    const z = this.depth;
    const [px, py] = this.par(z);
    ctx.fillStyle = '#ffe27a';
    for (let x = 0; x <= W; x += 1) {
      if ((x + Math.floor(t * 20)) % 6 > 3) continue;
      chalk(x + px, this.floorY(x, z) + py + 1, 0.9);
    }
    ctx.globalAlpha = 1;
    const ly = this.floorY(14, z) + py;
    drawText(ctx, `DEPTH ${Math.round(8 + z * 30)} M`, 6 + px, ly - 9, { font: 'small', color: '#ffe27a', outline: '#0a2a5a' });
  }

  drawGhost(ctx, gh, t) {
    const L = this.layout({ id: gh.id, x: gh.x, z: gh.z, flip: this.flip });
    if (!L) return;
    const ok = !gh.reason;
    const col = ok ? '#7ad8ff' : '#ff6a5a';
    // footprint ellipse on the seabed
    ctx.fillStyle = rgba(col, 0.35);
    for (let i = -L.hw * 1.2; i <= L.hw * 1.2; i += 1) {
      const e = Math.sqrt(Math.max(0, 1 - (i / (L.hw * 1.2)) ** 2));
      ctx.fillRect(Math.round(L.gx + i), Math.round(L.gy - 3 * e), 1, Math.max(1, Math.round(6 * e)));
    }
    // white chalk outline + tinted hologram body + scanline
    const oc = tinted(L.canvas, '#f4fbff');
    ctx.globalAlpha = 0.95;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(oc, L.dx + ox, L.dy + oy, L.w, L.h);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(L.canvas, L.dx, L.dy, L.w, L.h);
    ctx.globalAlpha = 0.5 + 0.1 * Math.sin(t * 5);
    ctx.drawImage(tinted(L.canvas, col), L.dx, L.dy, L.w, L.h);
    ctx.globalAlpha = 1;
    const row = Math.floor(((t * 0.8) % 1) * L.canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(oc, 0, row, L.canvas.width, 2, L.dx, L.dy + Math.round(row * L.k), L.w, 2);
    ctx.globalCompositeOperation = 'source-over';
    // dimension lines
    const by = L.gy + 8, x0 = L.dx, x1 = L.dx + L.w;
    ctx.fillStyle = '#e8f6ff';
    ctx.fillRect(x0, by, L.w, 1); ctx.fillRect(x0, by - 2, 1, 5); ctx.fillRect(x1 - 1, by - 2, 1, 5);
    ctx.fillRect(x0 + 1, by - 1, 2, 1); ctx.fillRect(x0 + 1, by + 1, 2, 1); ctx.fillRect(x1 - 3, by - 1, 2, 1); ctx.fillRect(x1 - 3, by + 1, 2, 1);
    const wm = `${(L.w / 8 / L.s).toFixed(1)} M`;
    const tw = measureText(wm, 'small');
    ctx.fillStyle = '#0a3a7a';
    ctx.fillRect(Math.round(L.gx - tw / 2 - 2), by - 3, tw + 4, 7);
    drawText(ctx, wm, L.gx, by - 2, { font: 'small', align: 'center', color: '#e8f6ff' });
    const vx = x1 + 5;
    ctx.fillStyle = '#e8f6ff';
    ctx.fillRect(vx, L.dy, 1, L.gy - L.dy); ctx.fillRect(vx - 2, L.dy, 5, 1); ctx.fillRect(vx - 2, L.gy - 1, 5, 1);
    drawText(ctx, `${(L.h / 8 / L.s).toFixed(1)} M`, vx + 4, Math.round((L.dy + L.gy) / 2) - 3, { font: 'small', color: '#e8f6ff', outline: '#0a3a7a' });
    // callout with name + status
    const def = buildingDef(gh.id);
    const label = (def?.name || '').toUpperCase();
    const lx = Math.round(L.gx), ly = Math.round(L.dy - 16);
    ctx.fillStyle = '#e8f6ff';
    ctx.fillRect(lx, ly + 7, 1, 8);
    drawText(ctx, label, lx, ly - 2, { align: 'center', color: '#ffffff', outline: '#0a2a5a' });
    drawText(ctx, ok ? (this.moving ? 'CLICK TO SET DOWN' : 'CLICK TO BUILD') : gh.reason.toUpperCase(), lx, ly + 8 - 16 + 16, { font: 'small', align: 'center', color: ok ? '#9affc8' : '#ffb0a0', outline: '#0a2a5a' });
  }

  drawTitleBlock(ctx, x, y, t) {
    const w = 178, h = 40;
    ctx.fillStyle = rgba('#06204a', 0.85);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#e8f6ff';
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    ctx.fillRect(x + 2, y + 2, w - 4, 1); ctx.fillRect(x + 2, y + h - 3, w - 4, 1);
    ctx.fillRect(x, y + 14, w, 1); ctx.fillRect(x + 110, y + 14, 1, h - 14);
    drawText(ctx, 'FISHTOP SEABED WORKS', x + 6, y + 5, { font: 'small', color: '#ffffff' });
    const n = this.state.buildings.length;
    drawText(ctx, `SHEET ${n + 1} OF ${n + 1}`, x + 6, y + 19, { font: 'small', color: '#bfe2ff' });
    drawText(ctx, 'DRAWN BY: YOU', x + 6, y + 28, { font: 'small', color: '#bfe2ff' });
    drawText(ctx, 'SCALE', x + 116, y + 19, { font: 'small', color: '#bfe2ff' });
    drawText(ctx, '1:20', x + 116, y + 28, { font: 'small', color: '#ffe27a' });
    void t;
  }

  // ------------------------------------------------------------------ dock buttons
  dockItems() {
    const g = this.game;
    const items = [
      { id: 'build', label: 'Blueprints - build on the seabed', w: 34, action: () => this.toggle() },
      { id: 'inventory', label: 'Inventory', w: 30, action: () => g.ui?.toggle?.('inventory') },
    ];
    for (const it of items) it.draw = (ctx, hover, t) => this.drawDockItem(ctx, it, hover, t);
    return items;
  }

  drawDockItem(ctx, it, hover, t) {
    if (!it.rect) return;
    const r = it.rect;
    this.drawButton(ctx, it.id, Math.round(r.x + r.w / 2), Math.round(it.ground ?? r.y + r.h), hover, t);
  }

  // Button art for the orchestrator's dock / HUD: kind 'build' (rolled blueprint) or 'inventory' (satchel).
  // (cx, by) = bottom centre.
  drawButton(ctx, kind, cx, by, hover = false, t = this.t) {
    const art = kind === 'build' ? 'scroll' : 'satchel';
    const frame = hover ? Math.floor(t * 8) : 0;
    const s = itemSprite(art, { frame, scale: 0.9, force: true });
    if (!s) return;
    const bob = hover ? Math.round(Math.sin(t * 6) * 1) - 1 : 0;
    if (hover && s.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(s.glow, cx - s.ox, by - s.oy + bob); ctx.globalCompositeOperation = 'source-over'; }
    if (hover) { const oc = tinted(s.canvas, '#fff6c8'); for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(oc, cx - s.ox + ox, by - s.oy + bob + oy); }
    ctx.drawImage(s.canvas, cx - s.ox, by - s.oy + bob);
    if (kind === 'build' && this.active) drawText(ctx, 'ON', cx, by - s.oy - 8, { font: 'small', align: 'center', color: '#9affc8', outline: '#0a2a5a' });
    if (kind === 'inventory') {
      const n = this.state.inventory?.packages?.length || 0;
      if (n) {
        const bx = cx + 8, byy = by - s.oy - 2;
        ctx.fillStyle = '#3a0a1a'; ctx.fillRect(bx - 1, byy - 1, 11, 9);
        ctx.fillStyle = '#ff4a6a'; ctx.fillRect(bx, byy, 9, 7);
        drawText(ctx, String(Math.min(9, n)), bx + 5, byy + 1, { font: 'small', align: 'center', color: '#ffffff' });
      }
    }
  }
}

function order(itemId) {
  const id = ITEMS[itemId]?.builds;
  const i = BUILDING_ORDER.indexOf(id);
  return i >= 0 ? i : 100 + Object.keys(DECOR_BUILDS).indexOf(id);
}

export { MODEL_IDS, ZMIN, ZMAX };
