// The opening: an ordinary desktop, a strange little fish, a hook from above, Pinch the crab,
// the first catch, and then the wallpaper floods into an ocean. Interactive, almost wordless.

import { clamp, clamp01, lerp, dist, damp, ease, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawBubble, drawButton } from '../ui/panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getAppIcon } from '../desktop/icons.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { SPECIES_BY_ID, SPECIES } from '../fish/species.js';
import { Fish } from '../fish/fish.js';
import { rollIndividual } from '../fish/traits.js';
import { PINCH_LOOK } from '../ui/dock.js';
import { HOOK } from '../fishing/baitart.js';

const STEPS = ['desktop', 'fishswim', 'hook', 'crab', 'bait', 'fight', 'flood', 'reveal', 'tank', 'coin', 'skill', 'done'];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = null;
    this.t = 0;
    this.crab = { x: -40, y: 0, show: 0, emo: 'neutral', talk: 0, face: 1, wave: 0 };
    this.bubble = null;
    this.pinch = compiled(PINCH_LOOK, null, 'pinch');
    this.hookDrop = 0;
    this.dockShown = new Set();
    game.on('iconBoxed', () => { if (this.step === 'crab') this.go('bait'); });
    game.on('hooked', () => { if (this.step === 'bait') this.go('fight'); });
    game.on('escaped', () => this.onEscape());
    game.on('revealDone', () => { if (this.step === 'reveal') this.go('tank'); });
    game.on('coinCollected', () => { if (this.step === 'coin') this.go('skill'); });
    game.on('skill', () => { if (this.step === 'skill') this.go('done'); });
  }

  get tutorialActive() { return this.active && (this.step === 'bait' || this.step === 'fight'); }

  start() {
    const g = this.game;
    this.active = true;
    g.ocean.reveal = 0;
    g.world.spawning = false;
    g.tutorialActive = true;
    this.go('desktop');
  }

  skip() {
    const g = this.game;
    this.active = false;
    g.tutorialActive = false;
    g.ocean.reveal = 1;
    g.world.spawning = true;
    g.state.tutorialDone = true;
    g.state.baits.bread = Math.max(g.state.baits.bread || 0, 5);
    if (this.fish) { g.school.remove(this.fish); this.fish = null; }
    g.ui.stack = [];
    g.audio.setMusic(g.musicFor());
    g.save();
  }

  go(step) {
    this.step = step;
    this.t = 0;
    this.enter(step);
  }

  say(text, opts = {}) {
    this.bubble = { text, t: 0, ...opts };
    this.crab.talk = Math.min(2.2, 0.4 + text.length * 0.04);
    if (!opts.silent) this.game.audio.babble(text, 'crab');
  }

  dockVisible(id) {
    if (!this.active && this.game.state.tutorialDone) return true;
    return this.dockShown.has(id);
  }

  capturesInput() { return false; }

  boxVisible() {
    if (!this.active) return true;
    return !['desktop', 'fishswim', 'hook'].includes(this.step);
  }

  boxOffset() {
    if (!this.active || this.step !== 'crab') return 0;
    return Math.round((1 - ease.outBounce(clamp01(this.boxDrop || 0))) * -this.game.screen.H);
  }

  // ---------------------------------------------------------------- step entry
  enter(step) {
    const g = this.game;
    const W = g.screen.W, H = g.screen.H;
    switch (step) {
      case 'desktop':
        g.audio.setMusic('desktop');
        break;
      case 'fishswim': {
        const sp = SPECIES_BY_ID.pixel || SPECIES.find((s) => s.quirks?.includes('intro')) || SPECIES[0];
        const rec = rollIndividual(sp, { mutationChance: 0, shinyChance: 0 });
        rec.name = 'Pixel';
        const f = new Fish(rec, sp, g.world, {});
        f.x = -30; f.y = H * 0.45; f.z = 0.2;
        f.facing = 1;
        f.setState('script');
        f.script = (fish, dt) => this.scriptFish(fish, dt);
        f.cooldown = 0;
        f.curiosity = 1; f.greed = 1; f.shyness = 0;
        g.school.fishes.push(f);
        this.fish = f;
        // pick an icon to hide behind
        const icons = g.desktop.icons.filter((i) => i.state === 'normal');
        this.hideIcon = icons[Math.min(icons.length - 1, 3)] || icons[0];
        g.audio.play('bubble');
        break;
      }
      case 'hook':
        this.hookDrop = 0;
        g.audio.play('reel', { vol: 0.6 });
        break;
      case 'crab':
        this.crab.x = g.desktop.box.x + 70;
        this.crab.y = H + 30;
        this.boxDrop = 0;
        g.audio.play('crab_scuttle');
        this.say('Psst!');
        break;
      case 'bait':
        this.crab.emo = 'happy';
        this.say('Ooh! Bait! Now hold your hook in open water... slowly...');
        g.audio.play('magic');
        if (this.fish) { this.fish.setState('wander'); this.fish.script = null; this.fish.cooldown = 0; this.fish.noticeT = 0.2; }
        break;
      case 'fight':
        this.say('Hold! Pull back!');
        break;
      case 'flood':
        g.audio.play('flood_rush');
        g.camera.shake(4);
        this.floodT = 0;
        break;
      case 'reveal':
        g.ui.open('reveal', { ...this.caught, tutorial: true });
        break;
      case 'tank':
        this.dockShown.add('tank');
        g.aquarium.openWindow?.(true);
        this.crab.emo = 'happy';
        this.say('Your first aquarium!');
        break;
      case 'coin':
        g.aquarium.forceCoin?.();
        this.say('Ooh, a coin! Grab it!');
        break;
      case 'skill':
        this.dockShown.add('skills');
        this.say('Now... grow your first skill!');
        setTimeout(() => { if (this.step === 'skill') g.ui.open('skills', { highlight: 'hook1' }); }, 1200);
        break;
      case 'done':
        for (const id of ['shop', 'journal', 'map', 'tank', 'skills']) this.dockShown.add(id);
        this.crab.emo = 'happy';
        this.say('Go fish! Click click!');
        g.state.tutorialDone = true;
        g.tutorialActive = false;
        g.world.spawning = true;
        g.state.baits.bread = Math.max(g.state.baits.bread || 0, 5);
        g.save();
        break;
      default: break;
    }
  }

  // Scripted intro fish: across the screen, behind an icon, peek, stare at the cursor.
  scriptFish(f, dt) {
    const g = this.game, ic = this.hideIcon;
    if (!ic) return [0, 0];
    const tx = ic.x + ic.w / 2, ty = ic.y + 16;
    const st = this.fishStage || (this.fishStage = { s: 'enter', t: 0 });
    st.t += dt;
    if (st.s === 'enter') {
      // swoop across the screen, then curve back to the icon
      const p = Math.min(1, st.t / 3.2);
      const x = lerp(-30, g.screen.W * 0.62, ease.inOutCubic(Math.min(1, p * 1.4)));
      const y = g.screen.H * 0.45 + Math.sin(p * Math.PI * 2) * 40;
      if (Math.random() < 0.3) g.particles.bubble(f.x - f.facing * 6, f.y, { size: 1, layer: 'fg' });
      if (p >= 1) { st.s = 'tohide'; st.t = 0; f.z = 0.5; }
      return [(x - f.x) * 3, (y - f.y) * 3];
    }
    if (st.s === 'tohide') {
      f.z = 0.5;
      if (dist(f.x, f.y, tx, ty) < 3) { st.s = 'hidden'; st.t = 0; g.audio.play('blub', { vol: 0.5 }); }
      return f.steer(tx, ty, 110, 30);
    }
    if (st.s === 'hidden') {
      if (st.t > 1.4) { st.s = 'peek'; st.t = 0; }
      return [(tx - f.x) * 4, (ty - f.y) * 4];
    }
    // peek out to the right, stare at the cursor
    f.lookAt(g.input.x, g.input.y);
    f.facing = g.input.x > f.x ? 1 : -1;
    if (st.t > 0.5 && !st.said) { st.said = true; f.say('!', 1.2); g.audio.play('squeak'); f.feel('surprised', 1.5); if (this.step === 'fishswim') this.go('hook'); }
    const px = tx + 14 + Math.sin(st.t * 1.5) * 2;
    return [(px - f.x) * 4, (ty - f.y) * 4];
  }

  onCaught(fish, data) {
    if (!this.active || this.step !== 'fight') return false;
    this.caught = data;
    this.fish = null;
    this.go('flood');
    return true;
  }

  onEscape() {
    if (!this.active) return;
    // the intro fish never truly leaves: it comes back for another try
    const f = this.game.school.fishes.find((x) => x.quirks.has('intro')) || this.lastFish;
    if (f) {
      setTimeout(() => {
        if (!this.active) return;
        f.setState('wander');
        f.cooldown = 1.5;
        f.cruise = 25;
        this.say(this.step === 'fight' ? 'Gentler! Let go when it pulls hard!' : 'Wait for the "!" then click!');
      }, 600);
      if (this.step === 'fight') this.go('bait');
    }
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    if (this.bubble) this.bubble.t += dt;
    this.crab.talk = Math.max(0, this.crab.talk - dt);
    const W = g.screen.W, H = g.screen.H;
    // keep the intro fish alive & close
    if (this.fish) { this.fish.life = 9999; this.lastFish = this.fish; }
    // fishing is allowed on the plain desktop during the tutorial
    g.world.surfaceY = g.ocean.reveal < 1 ? null : g.world.surfaceY;
    this.allowFishing = this.step === 'bait' || this.step === 'fight';
    switch (this.step) {
      case 'desktop':
        if (this.t > 2.2 || (g.input.pressed && this.t > 0.6)) this.go('fishswim');
        break;
      case 'hook':
        this.hookDrop = Math.min(1, this.hookDrop + dt * 0.9);
        if (this.t > 2.2) this.go('crab');
        break;
      case 'crab':
        this.crab.show = Math.min(1, this.crab.show + dt * 2);
        this.boxDrop = Math.min(1, this.boxDrop + dt * 1.6);
        if (this.boxDrop >= 1 && !this.thudded) { this.thudded = true; g.audio.play('box_close'); g.camera.shake(2); g.particles.burst(g.desktop.box.x + 26, g.desktop.box.y + 34, 14, { colors: ['#e8d8b8', '#c8b898'], speed: 40, g: 30, life: 0.6, up: 10 }); }
        if (this.t > 2 && !this.bubble?.drag) this.say('{mouse_l} Drag an icon into the box!', { drag: true, silent: true });
        if (g.state.baitBox.length && this.t > 0.8) this.go('bait');
        break;
      case 'tank':
        if (this.t > 3.2) this.go('coin');
        break;
      case 'flood': {
        this.floodT += dt;
        g.ocean.reveal = clamp01(ease.inOutCubic(clamp01(this.floodT / 5)));
        if (Math.random() < 0.8) g.particles.bubble(rng.float(0, W), g.wallpaper.waterline(rng.float(0, W)) + rng.float(5, 40), { layer: 'fg', size: rng.pick([1, 2, 3]) });
        if (this.floodT > 1 && !this.musicOn) { this.musicOn = true; g.audio.setMusic('shallows'); g.audio.setAmbience('shallows', { weather: g.ocean.weather }); }
        if (this.floodT >= 5.4) {
          g.ocean.reveal = 1;
          g.ocean.titleCard = { t: 0, title: 'Sunny Shallows', sub: 'Your desktop was an ocean all along.' };
          this.go('reveal');
        }
        break;
      }
      default: break;
    }
  }

  // Drawn behind the desktop icons (the hiding fish lives in the fish layers already).
  drawWorld(ctx) {}

  drawUi(ctx) {
    if (!this.active) return;
    const g = this.game;
    const W = g.screen.W, H = g.screen.H;
    // sound hint on the plain desktop
    if (this.step === 'desktop' || this.step === 'fishswim') {
      drawText(ctx, '(click anywhere to enable sound)', W - 10, H - 40, { align: 'right', font: 'small', color: '#ffffff', shadow: '#1a3a5a' });
    }
    // the hook dropping from the sky
    if (this.step === 'hook') {
      const k = ease.outBounce(this.hookDrop);
      const hx = W * 0.55, hy = lerp(-20, H * 0.32, k);
      ctx.fillStyle = 'rgba(230,244,255,0.85)';
      for (let y = 0; y < hy - 5; y++) ctx.fillRect(Math.round(hx + Math.sin(y * 0.05 + this.t * 2) * 0.6), y, 1, 1);
      ctx.drawImage(HOOK, Math.round(hx - 3), Math.round(hy - 5));
    }
    // crab + bait box drop
    if (['crab', 'bait', 'fight', 'tank', 'coin', 'skill', 'done'].includes(this.step) || (this.step === 'reveal' && false)) this.drawCrab(ctx);
    if (this.step === 'crab') this.drawDragDemo(ctx);
    // skip button
    if (!['done', 'reveal', 'flood', 'tank', 'coin', 'skill'].includes(this.step)) {
      const r = { x: W - 82, y: 32, w: 72, h: 16 };
      const hov = g.ui.hover(r);
      drawButton(ctx, r.x, r.y, r.w, r.h, { label: 'Skip intro', state: hov ? 'hover' : 'normal', style: 'glass' });
      if (hov && g.input.pressed) { g.input.consume(); this.skip(); }
    }
  }

  drawCrab(ctx) {
    const g = this.game, c = this.crab;
    const H = g.screen.H;
    const box = g.desktop.box;
    let tx = box.x + box.w + 30, ty = H - 40;
    if (this.step === 'tank' || this.step === 'coin') {
      const r = g.aquarium.windowRect?.();
      if (r) { tx = r.x - 26; ty = r.y + r.h - 6; }
    }
    if (this.step === 'skill') {
      const d = g.dock.items.find((i) => i.id === 'skills');
      if (d?.rect) { tx = d.rect.x - 30; ty = d.ground - 6; }
    }
    if (this.step === 'done') {
      const d = g.dock.items.find((i) => i.id === 'shop');
      if (d?.rect) { tx = d.rect.x + d.rect.w / 2; ty = d.ground - 14; }
      if (this.t > 3.5) { this.active = false; this.bubble = null; return; }
    }
    c.x = damp(c.x, tx, 3, 1 / 60);
    c.y = damp(c.y, ty, 4, 1 / 60);
    const moving = Math.abs(c.x - tx) > 2;
    const t = this.t;
    drawFishRig(ctx, this.pinch, {
      x: c.x, y: c.y, facing: tx < c.x - 1 ? -1 : 1, turn: tx < c.x - 1 ? -1 : 1, angle: 0, scale: 1, squash: Math.sin(t * 6) * 0.04,
      swimPhase: moving ? (t * 2) % 1 : (t * 0.3) % 1, tailPhase: 0, finPhase: (t * 1.2) % 1, speed01: moving ? 1 : 0, inflate: 0,
      lookX: g.input.x, lookY: g.input.y, blink: (t % 3.5) < 0.12 ? 1 : 0, emotion: c.emo, mouth: c.talk > 0 ? Math.abs(Math.sin(t * 14)) * 0.8 : 0.05, time: t,
    });
    if (this.bubble) {
      const b = this.bubble;
      const lines = wrapText(b.text, 160);
      const w = Math.max(...lines.map((l) => measureText(l))) + 16;
      const h = lines.length * 11 + 10;
      const bx = Math.round(clamp(c.x - w / 2, 4, g.screen.W - w - 4)), by = Math.round(c.y - 40 - h);
      const pop = ease.outBack(clamp01(b.t * 4));
      ctx.save();
      ctx.translate(c.x, by + h);
      ctx.scale(pop, pop);
      ctx.translate(-c.x, -(by + h));
      drawBubble(ctx, bx, by, w, h, { tailX: c.x, tailY: c.y - 18 });
      lines.forEach((l, i) => drawText(ctx, l, bx + 8, by + 6 + i * 11, { color: '#1e2a38' }));
      ctx.restore();
    }
  }

  drawDragDemo(ctx) {
    const g = this.game;
    if (this.t < 1.5) return;
    const ic = g.desktop.icons.find((i) => i.state === 'normal' && i !== this.hideIcon);
    if (!ic) return;
    const k = ((this.t - 1.5) % 2.4) / 2.4;
    const p = ease.inOutCubic(clamp01(k * 1.3));
    const x0 = ic.x + ic.w / 2, y0 = ic.y + 16;
    const box = g.desktop.box;
    const x1 = box.x + box.w / 2, y1 = box.y + 10;
    const x = lerp(x0, x1, p), y = lerp(y0, y1, p) - Math.sin(p * Math.PI) * 30;
    ctx.globalAlpha = 0.55 * (1 - Math.max(0, k - 0.8) * 5);
    const spr = getAppIcon(ic.icon, { size: 32 });
    if (spr) ctx.drawImage(spr, Math.round(x - 16), Math.round(y - 16));
    const hand = getUiIcon('cursor_grab') || getUiIcon('cursor');
    if (hand) ctx.drawImage(hand, Math.round(x), Math.round(y));
    ctx.globalAlpha = 1;
    // bobbing arrow over the box
    const a = getUiIcon('arrow_d');
    if (a) ctx.drawImage(a, Math.round(x1 - a.width / 2), Math.round(box.y - 22 + Math.sin(this.t * 6) * 3));
  }
}
