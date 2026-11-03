// The opening and the first-session tutorial (phase 3, Intro agent).
// 1. The 3D opening (intro3d.js) plays over the live game: a sunny Aero room, a dolly into the monitor, the
//    desktop floods, the bubble person, the FISHTOP logo; it dissolves into the (OS)cean.
// 2. Goldie (gfx/npcs.js voxel NPC) guides the first session with short icon bubbles and bobbing arrows:
//    appsea (open the floating AppSea bubble) -> download (grab free bait) -> cast (hook into the water) ->
//    wait (the bite) -> fight (crank / Shock) -> reveal -> tank (the fish swims into the goldfish jar) ->
//    coin (collect the jar's Aero) -> lab (open The Lab) -> research (start the first research) -> done.
// The floating menu asks dockVisible(id) which bubbles to show while the tutorial runs. skip() ends everything.
//
// Used by game.js: start(), skip(), update(dt), drawWorld(ctx), drawUi(ctx), onCaught(fish, data) -> handled,
//   capturesInput(), boxVisible(), boxOffset(), dockVisible(id), active, step, allowFishing.

import { clamp, clamp01, lerp, damp, ease, TAU } from '../core/math.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { AERO, drawAeroSurface, drawAeroGlow, drawAeroBubble, drawSparkle } from '../ui/aero.js';
import { Intro3D, drawGoldie } from './intro3d.js';
import * as BAIT from '../store/bait.js';
import * as LAB from './lab.js';
import * as ITEMS from '../build/items.js';
import * as WORLD from '../world/biomes/index.js';
import * as STORE from '../store/index.js';

const START_BIOME = 'oscean';
const ALIAS = { skills: 'lab', tank: 'aquarium', store: 'appsea', shop: 'appsea' };
// menu bubbles revealed so far, per step
const SHOWN = {
  intro: [],
  appsea: ['appsea'], download: ['appsea'],
  cast: ['appsea', 'bait'], wait: ['appsea', 'bait'], fight: ['appsea', 'bait'],
  reveal: ['appsea', 'bait', 'aquarium'], tank: ['appsea', 'bait', 'aquarium'], coin: ['appsea', 'bait', 'aquarium'],
  lab: ['appsea', 'bait', 'aquarium', 'lab'], research: ['appsea', 'bait', 'aquarium', 'lab'],
};

// Bubble contents: very short, icon-led ({name} = inline UI icon).
const SAY = {
  appsea: ['{mouse_l} AppSea'],
  download: ['Free bait!', '{mouse_l} Lite'],
  downloading: ['{clock} 56k...', 'hehe'],
  cast: ['{hook} into the water', '{mouse_l} jiggle'],
  wait: ['Wait for {exclaim}'],
  bite: ['{mouse_l} NOW!'],
  fight: ['{mouse_l} circle = reel', 'Space = Shock'],
  again: ['Again!', '{hook} {mouse_l}'],
  tank: ['Into my jar!'],
  coin: ['{mouse_l} Aero!'],
  lab: ['{mouse_l} The Lab'],
  research: ['Start a research!'],
  done: ['Go fish! {fish}'],
};

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = null;
    this.t = 0;
    this.intro = null;
    this.guide = { x: -60, y: 120, show: 0, facing: 1, say: null, sayT: 0, talk: 0 };
    this.fishTries = 0;
    game.on('iconOpen', (ic) => { if (this.step === 'appsea' && ic?.id === 'appsea') this.go('download'); });
    game.on('baitDownloaded', () => { if (this.step === 'download' || this.step === 'appsea') this.go('cast'); });
    game.on('hooked', () => { if (['cast', 'wait'].includes(this.step)) this.go('fight'); });
    game.on('escaped', () => this.onEscape());
    game.on('revealDone', () => { if (this.step === 'reveal') this.go('tank'); });
    game.on('coinCollected', () => { if (this.step === 'coin' || this.step === 'tank') this.go('lab'); });
    game.on('labStarted', () => { if (this.step === 'lab' || this.step === 'research') this.go('done'); });
  }

  get tutorialActive() { return this.active && ['cast', 'wait', 'fight'].includes(this.step); }
  get allowFishing() { return this.active && !this.intro; }

  // ---------------------------------------------------------------- lifecycle
  start() {
    const g = this.game;
    this.active = true;
    g.tutorialActive = true;
    this.prepareOcean();
    this.intro = new Intro3D({
      W: g.screen.W, H: g.screen.H, input: g.input, audio: g.audio, look: g.state.character,
      music: g.ocean?.biome?.music || 'shallows',
      onHandoff: () => this.prepareOcean(),
      onDone: () => { this.intro = null; this.go('appsea'); },
    });
    this.go('intro');
  }

  // The live game under the opening: the flooded (OS)cean, fully revealed.
  prepareOcean() {
    const g = this.game, st = g.state;
    if (g.ocean) g.ocean.reveal = 1;
    if (g.world) g.world.spawning = true;
    const has = !!(WORLD.BIOMES && WORLD.BIOMES[START_BIOME]);
    if (!st.tutorialDone && has) {
      if (Array.isArray(st.unlockedBiomes) && !st.unlockedBiomes.includes(START_BIOME)) st.unlockedBiomes.unshift(START_BIOME);
      if (st.biome !== START_BIOME && !g.ocean?.travelState) {
        st.biome = START_BIOME;
        if (g.world) g.world.biome = START_BIOME;
        try { g.ocean.setBiome(START_BIOME); } catch (e) { console.warn('tutorial: biome', e); }
      }
    }
  }

  skip() {
    const g = this.game;
    if (this.intro) { this.intro.active = false; this.intro = null; }
    this.active = false;
    this.step = 'done';
    g.tutorialActive = false;
    this.prepareOcean();
    g.state.tutorialDone = true;
    try { BAIT.ensureBait(g.state); } catch (e) { /* bait module optional */ }
    if (g.ui) g.ui.stack = [];
    try { g.audio?.setMusic?.(g.musicFor?.()); } catch (e) { /* optional */ }
    g.save?.();
  }

  go(step) {
    const prev = this.step;
    this.step = step;
    this.t = 0;
    this.enter(step, prev);
  }

  say(key, opts = {}) {
    const lines = SAY[key] || [String(key)];
    const G = this.guide;
    if (G.key === key) return;
    G.key = key; G.say = lines; G.sayT = 0; G.talk = 0.9;
    if (!opts.silent) { try { this.game.audio?.babble?.(lines.join(' ').replace(/\{[a-z_]+\}/g, ''), 'fish'); } catch (e) { /* optional */ } }
  }

  // Which menu bubbles the floating menu may show (desktop.wants asks this).
  dockVisible(id) {
    if (!this.active) return this.game.state.tutorialDone ? true : !this.intro;
    if (this.step === 'done') return true;
    const set = SHOWN[this.step] || [];
    return set.includes(ALIAS[id] || id);
  }

  capturesInput() { return !!this.intro; }
  boxVisible() { return !this.intro; }
  boxOffset() { return 0; }

  // ---------------------------------------------------------------- step entry
  enter(step, prev) {
    const g = this.game;
    const st = g.state;
    switch (step) {
      case 'intro':
        break;
      case 'appsea':
        this.guide.show = 0;
        this.say('appsea');
        this.baitBase = this.baitCount();
        break;
      case 'download':
        this.say('download');
        this.baitBase = this.baitCount();
        // focus the store on a tiny free app (its Lite pack is free bait)
        try { if (STORE.TUTORIAL_APP && typeof STORE.openStore === 'function') STORE.openStore(g, { highlight: STORE.TUTORIAL_APP }); } catch (e) { /* the store draws its own highlight */ }
        break;
      case 'cast':
        this.castBase = st.stats?.casts || 0;
        // tidy up: the store window would sit over the water
        setTimeout(() => { if (this.step === 'cast') for (const w of (g.desktop?.windows || []).slice()) if (String(w.app).startsWith('appsea')) g.desktop.closeWindow?.(w); }, 1400);
        this.say(prev === 'fight' ? 'again' : 'cast');
        break;
      case 'wait':
        this.say('wait');
        break;
      case 'fight':
        this.say('fight');
        break;
      case 'reveal':
        this.guide.key = null; this.guide.say = null;
        break;
      case 'tank':
        g.setView?.('ocean');
        g.aquarium?.openWindow?.(true);
        this.say('tank');
        break;
      case 'coin':
        try { g.aquarium?.forceCoin?.(); } catch (e) { /* optional */ }
        this.say('coin');
        break;
      case 'lab':
        g.aquarium?.closeWindow?.();
        this.say('lab');
        break;
      case 'research': {
        const id = this.firstResearch();
        this.researchId = id;
        if (id) this.ensureAffordable(id);
        // (re)focus the tree on it; the player may already have opened the Lab from its bubble
        if (g.ui?.panels?.lab) g.ui.open('lab', { tab: 'tree', focus: id, highlight: id });
        this.say('research');
        break;
      }
      case 'done':
        st.tutorialDone = true;
        g.tutorialActive = false;
        this.say('done');
        g.audio?.play?.('ui_unlock', { vol: 0.6 });
        g.particles?.aeroConfetti?.(g.screen.W / 2, g.screen.H * 0.3, 40, { layer: 'ui' });
        g.save?.();
        break;
      default: break;
    }
  }

  baitCount() {
    try { return BAIT.totalBait(this.game.state); } catch (e) { return 0; }
  }

  // The cheapest research that is available right now (Aero first), defaulting to the Lab's sharper hook.
  firstResearch() {
    const st = this.game.state;
    try {
      const list = (LAB.LAB_NODES || []).filter((n) => LAB.labStatus(st, n.id) === 'available');
      list.sort((a, b) => (a.cost?.aero || 0) - (b.cost?.aero || 0));
      return list.find((n) => n.id === 'hook1')?.id || list[0]?.id || null;
    } catch (e) { return null; }
  }

  // A small welcome gift so the very first research can always start.
  ensureAffordable(id) {
    const g = this.game, st = g.state;
    try {
      const node = LAB.LAB_BY_ID?.[id];
      if (!node) return;
      const need = node.cost?.aero || 0;
      if ((st.coins || 0) < need) st.coins = need;
      for (const [mid, n] of Object.entries(node.cost?.items || {})) {
        const have = ITEMS.countItem?.(st, mid) || 0;
        if (have < n) ITEMS.addItem?.(st, mid, n - have);
      }
    } catch (e) { /* the Lab may still be in progress */ }
  }

  onCaught(fish, data) {
    if (!this.active || !['cast', 'wait', 'fight'].includes(this.step)) return false;
    const g = this.game;
    this.go('reveal');
    if (g.ui?.panels?.reveal) { g.ui.open('reveal', { ...data, tutorial: true }); return true; }
    // no reveal panel: keep it and move on
    try { g.keepFish?.(data.rec); } catch (e) { /* ignore */ }
    this.go('tank');
    return true;
  }

  onEscape() {
    if (!this.active || !['fight', 'wait'].includes(this.step)) return;
    this.fishTries++;
    setTimeout(() => { if (this.active && (this.step === 'fight' || this.step === 'wait')) this.go('cast'); }, 700);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    const G = this.guide;
    G.sayT += dt;
    G.talk = Math.max(0, G.talk - dt);
    if (this.intro) {
      const { W, H } = g.screen;
      if (this.intro.W !== W || this.intro.H !== H) this.intro.resize(W, H);
      this.intro.update(dt);
      return;
    }
    const f = g.fishing;
    switch (this.step) {
      case 'appsea':
        if (this.storeOpen()) this.go('download');
        else if (this.baitCount() > this.baitBase) this.go('cast');
        break;
      case 'download': {
        const busy = (g.state.apps?.downloads || []).length > 0;
        if (this.baitCount() > this.baitBase) this.go('cast');
        else if (busy) this.say('downloading', { silent: true });
        else if (this.t > 1.5 && !this.storeOpen()) this.go('appsea');
        break;
      }
      case 'cast':
        if ((g.state.stats?.casts || 0) > this.castBase || (f && f.state !== 'idle')) this.go('wait');
        break;
      case 'wait':
        if (f?.state === 'bite') this.say('bite', { silent: true });
        else if (G.key === 'bite') this.say('wait', { silent: true });
        if (f?.state === 'fight') this.go('fight');
        break;
      case 'fight':
        if (f && f.state === 'idle' && this.t > 2) this.go('cast');
        break;
      case 'reveal':
        if (this.t > 1 && !g.ui?.isOpen?.('reveal')) this.go('tank');
        break;
      case 'tank':
        if (this.t > 2.6) this.go('coin');
        break;
      case 'coin':
        if (this.t > 25) this.go('lab'); // never strand the player on a lost drop
        break;
      case 'lab':
        if (g.ui?.isOpen?.('lab')) this.go('research');
        break;
      case 'research':
        if (this.researchId && LAB.labStatus?.(g.state, this.researchId) === 'researching') this.go('done');
        else if (this.t > 1.2 && g.ui?.panels?.lab && !g.ui.isOpen('lab')) this.go('lab');
        break;
      case 'done':
        if (this.t > 3.6) { this.active = false; G.say = null; }
        break;
      default: break;
    }
  }

  storeOpen() {
    return (this.game.desktop?.windows || []).some((w) => String(w.app).startsWith('appsea') && !w.min);
  }

  // ---------------------------------------------------------------- targets
  target() {
    const g = this.game, { W, H } = g.screen;
    switch (this.step) {
      case 'appsea': return { rect: this.iconRect('appsea') };
      case 'download': { const w = (g.desktop?.windows || []).find((x) => String(x.app).startsWith('appsea') && !x.min); return { rect: w ? { x: w.x, y: w.y, w: w.w, h: Math.min(w.h, 60) } : null, noArrow: true, side: w ? 'left' : null }; }
      case 'cast': return { point: [W * 0.56, H * 0.58] };
      case 'wait': { const h = g.fishing?.hook; return h?.visible ? { point: [h.x, h.y], small: true } : { point: [W * 0.56, H * 0.58] }; }
      case 'fight': return { top: true };
      case 'tank': case 'coin': return { rect: g.aquarium?.windowRect?.() || null, noArrow: this.step === 'tank' };
      case 'lab': return { rect: this.iconRect('lab') };
      case 'research': return { top: true };
      default: return {};
    }
  }

  iconRect(id) {
    const d = this.game.desktop;
    try {
      const r = d?.iconRect?.(id);
      if (r) return r;
      const ic = d?.iconById?.(id);
      return ic ? { x: ic.x, y: ic.y, w: ic.w || 44, h: ic.h || 44 } : null;
    } catch (e) { return null; }
  }

  // Where Goldie floats for the current target.
  guideSpot(tg) {
    const { W, H } = this.game.screen;
    if (tg.rect) {
      const r = tg.rect;
      const right = tg.side !== 'left' && r.x + r.w + 140 < W;
      return [right ? r.x + r.w + 62 : r.x - 44, clamp(r.y + r.h * 0.6, 84, H - 60)];
    }
    if (tg.point) return [clamp(tg.point[0] - 120, 50, W - 50), clamp(tg.point[1] - 70, 80, H - 60)];
    if (tg.top) return [W * 0.5 - 150, 86];
    return [W * 0.32, H * 0.7];
  }

  // ---------------------------------------------------------------- drawing
  drawWorld() {}

  drawUi(ctx) {
    if (!this.active && !this.intro) return;
    if (this.intro) { this.intro.draw(ctx); return; }
    const g = this.game, G = this.guide, t = this.t;
    const tg = this.target();
    if (this.step === 'reveal') return;
    // pointer: a pulsing glossy ring and a bobbing arrow
    if (tg.rect && !tg.noArrow) this.drawPointer(ctx, tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2, Math.max(tg.rect.w, tg.rect.h) * 0.6, tg.rect.y < 50 ? 'side' : true);
    else if (tg.point) this.drawPointer(ctx, tg.point[0], tg.point[1], tg.small ? 10 : 18, !tg.small);
    // Goldie swims to her spot
    const [sx, sy] = this.guideSpot(tg);
    const dt = 1 / 60;
    if (G.show === 0) { G.x = sx - 60; G.y = sy + 20; }
    G.show = Math.min(1, G.show + dt * 2.5);
    const px = G.x;
    G.x = damp(G.x, sx, 4, dt); G.y = damp(G.y, sy + Math.sin(g.time * 2) * 3, 4, dt);
    if (Math.abs(G.x - px) > 0.3) G.facing = G.x > px ? 1 : -1;
    const fade = this.step === 'done' ? 1 - clamp01((t - 2.8) / 0.8) : 1;
    const a = G.show * fade;
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    drawAeroGlow(ctx, G.x, G.y, 32, '#bff4ff', 0.4);
    drawAeroBubble(ctx, G.x, G.y, 26, 0.9);
    try {
      drawGoldie(ctx, G.x, G.y + 2, { scale: 1, base: 1, facing: G.facing, t: g.time, mood: this.step === 'done' || this.step === 'tank' ? 'excited' : 'happy', talk: G.talk > 0 ? 0.5 + 0.5 * Math.sin(g.time * 18) : 0, lookAt: tg.rect ? [tg.rect.x + tg.rect.w / 2, tg.rect.y + tg.rect.h / 2] : tg.point || null, id: 'guide' });
    } catch (e) { /* optional */ }
    if (G.say) this.drawSay(ctx, G.x, G.y - 30, G.say);
    ctx.restore();
    if (Math.random() < 0.04) g.particles?.aeroBubbles?.(G.x + 8, G.y - 16, 1, { sizes: [2, 2, 3], speed: [12, 30], layer: 'ui' });
  }

  drawPointer(ctx, x, y, r, arrow) {
    const t = this.t;
    const k = (t * 1.1) % 1;
    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - k);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), r + k * 14, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5 * (1 - k);
    ctx.strokeStyle = '#7ff0ff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), r + k * 14 + 2, 0, TAU); ctx.stroke();
    ctx.restore();
    if (arrow === 'side') {
      const a = getUiIcon('arrow_l');
      if (a) ctx.drawImage(a, Math.round(x + r + 8 + Math.sin(t * 6) * 3), Math.round(y - a.height / 2));
    } else if (arrow) {
      const a = getUiIcon('arrow_d');
      if (a) ctx.drawImage(a, Math.round(x - a.width / 2), Math.round(y - r - 14 - a.height + Math.sin(t * 6) * 3));
    }
    if (Math.sin(t * 5) > 0.97) drawSparkle(ctx, x + r * 0.7, y - r * 0.7, 2, 1);
  }

  // A glossy speech bubble: one or two short lines with inline icons, popping in.
  drawSay(ctx, x, y, lines) {
    const g = this.game, G = this.guide;
    const w = Math.max(...lines.map((l) => measureText(l))) + 18;
    const h = lines.length * 12 + 10;
    const pop = ease.outBack(clamp01(G.sayT * 4));
    const bx = Math.round(clamp(x - w / 2, 4, g.screen.W - w - 4)), by = Math.round(y - h - 8);
    ctx.save();
    ctx.translate(x, by + h);
    ctx.scale(pop, pop);
    ctx.translate(-x, -(by + h));
    // tail
    ctx.fillStyle = 'rgba(240,252,255,0.95)';
    ctx.beginPath(); ctx.moveTo(clamp(x - 5, bx + 6, bx + w - 12), by + h - 1); ctx.lineTo(clamp(x + 5, bx + 12, bx + w - 6), by + h - 1); ctx.lineTo(x, by + h + 7); ctx.closePath(); ctx.fill();
    drawAeroSurface(ctx, bx, by, w, h, { tone: 'frost', r: 7, gloss: 0.55, glossH: Math.round(h * 0.42), rim: 0.85, glow: 0.4 });
    lines.forEach((l, i) => drawText(ctx, l, bx + Math.round((w - measureText(l)) / 2), by + 6 + i * 12, { color: AERO.ink }));
    ctx.restore();
    void lerp;
  }
}
