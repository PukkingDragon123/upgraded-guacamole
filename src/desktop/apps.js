// Window contents for the simulated desktop apps.
// Renderer: { title, size:[w,h], init(win, game), draw(ctx, win, game, rect, t), input(win, game, inp, rect), scroll(win, rect) }

import { clamp, lerp, dist, damp, TAU, rectContains } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, RARITY } from '../core/color.js';
import { drawText, drawWrapped, wrapText, measureText } from '../gfx/font.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getAppIcon } from './icons.js';

const INK = '#1e2a38';
const PAPER = '#f4ecd8';

function paperBg(ctx, r, color = PAPER) {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

function textLines(ctx, lines, x, y, color = INK, lh = 11) {
  lines.forEach((l, i) => drawText(ctx, l, x, y + i * lh, { color }));
  return lines.length * lh;
}

// ------------------------------------------------------------------ notes
const NOTES = `Welcome to FISHTOP!

- Your mouse is a fishing hook. Move SLOWLY near fish.
- Drag desktop icons into the Bait Box (bottom-left).
- Different icons attract different fish!
- Wait for the "!" then CLICK to set the hook.
- Hold to reel. Pull AGAINST the fish.
- Draw a circle around tired fish to net them.
- Fish in your aquarium make Oxidized Coins.
- Spend coins on the Coral Skill Tree.
- P pauses fishing. M = mini mode.

Your files are never touched. Icons in the bait box
are just virtual copies - Restore All Icons anytime.`;

const notes = {
  title: 'Notes.txt',
  size: [270, 210],
  draw(ctx, w, g, r) {
    paperBg(ctx, r, '#fffbe8');
    for (let y = r.y + 14 - (w.scroll % 11); y < r.y + r.h; y += 11) { ctx.fillStyle = '#d8e6f4'; ctx.fillRect(r.x, y + 9, r.w, 1); }
    ctx.fillStyle = '#f4b8b8'; ctx.fillRect(r.x + 14, r.y, 1, r.h);
    const lines = wrapText(NOTES, r.w - 26);
    textLines(ctx, lines, r.x + 19, r.y + 5 - w.scroll, INK);
  },
  scroll: (w, r) => Math.max(0, wrapText(NOTES, r.w - 26).length * 11 - r.h + 10),
};

// ------------------------------------------------------------------ browser with its own little fish overlay
const PAGES = [
  { tab: 'FishPedia', url: 'fishpedia.web/home', title: 'The Ocean Behind Your Desktop',
    body: 'Scientists agree: every computer has an ocean behind its wallpaper. Most people never notice because fish are very good at hiding behind icons.\n\nTip: fish in this browser react to scrolling. Try it!', img: 'reef' },
  { tab: 'Bubble News', url: 'bubble.news/today', title: 'Local Crab Opens Bait Shop',
    body: 'Pinch the crab has opened a tiny merchant stall on the seabed. "Golden bait? Very shiny. Very expensive," he said, clacking.\n\nIn other news, a pufferfish inflated during a meeting. Again.', img: 'crab' },
  { tab: 'Kelp Recipes', url: 'kelp.recipes/pudding', title: 'How To Catch A Pudding',
    body: 'Step 1: Sugar Cube bait.\nStep 2: Be patient. Puddings wobble before they bite.\nStep 3: Time your clicks with the bounce.\n\nDo not eat the pudding. The pudding is a fish.', img: 'pudding' },
];

function pageImage(ctx, kind, x, y, w, h, t) {
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, kind === 'crab' ? '#ffd8a0' : '#7fe0f0');
  grad.addColorStop(1, kind === 'crab' ? '#e89a6a' : '#1f7aa8');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f0d8a0';
  for (let i = 0; i < w; i++) ctx.fillRect(x + i, y + h - 6 - Math.round(Math.sin(i * 0.2) * 2), 1, 8);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 10 + i * 22 + Math.round(Math.sin(t + i) * 3), y + 3, 8, h - 10);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

const browser = {
  title: 'FishNet Explorer',
  size: [330, 240],
  init(w, g) {
    w.data.tab = 0;
    w.data.fish = [];
    const ids = ['guppy', 'pixel', 'googly', 'clownfish', 'tang', 'butterfly'].filter((id) => SPECIES_BY_ID[id]);
    for (let i = 0; i < 3; i++) {
      const sp = SPECIES_BY_ID[rng.pick(ids.length ? ids : Object.keys(SPECIES_BY_ID))];
      if (sp) w.data.fish.push({ sp, c: compiled(sp.look, null, sp.id), x: rng.float(20, 280), y: rng.float(60, 200), vx: rng.float(-20, 20), vy: 0, tab: i % 3, facing: 1, ph: rng.next(), hide: 0, look: null, emo: 'neutral' });
    }
    w.data.scrollV = 0;
    w.data.prevScroll = 0;
  },
  scroll: () => 140,
  input(w, g, inp, r) {
    const d = w.data;
    if (inp.pressed) {
      for (let i = 0; i < PAGES.length; i++) {
        const tr = { x: r.x + 2 + i * 82, y: r.y + 1, w: 80, h: 12 };
        if (rectContains(tr, inp.x, inp.y) && d.tab !== i) {
          // fish in the old tab jump into the new one
          for (const f of d.fish) if (f.tab === d.tab && rng.chance(0.7)) { f.tab = i; f.y = r.y + 20; f.vy = 40; f.emo = 'surprised'; }
          d.tab = i;
          w.scroll = 0;
          g.audio.play('ui_tab');
        }
      }
      for (const f of d.fish) {
        if (f.tab === d.tab && dist(inp.x - r.x, inp.y - r.y + w.scroll, f.x, f.y) < 10) {
          f.vy -= 60; f.emo = 'happy'; g.audio.play('blub', { pitch: 1.3 });
          if (rng.chance(0.3)) g.addCoins(1, inp.x, inp.y);
        }
      }
    }
  },
  draw(ctx, w, g, r, t) {
    const d = w.data;
    const page = PAGES[d.tab];
    // tabs
    ctx.fillStyle = '#c8d4e4';
    ctx.fillRect(r.x, r.y, r.w, 28);
    PAGES.forEach((p, i) => {
      const x = r.x + 2 + i * 82;
      ctx.fillStyle = i === d.tab ? '#ffffff' : '#a8b8cc';
      ctx.fillRect(x, r.y + 1, 80, 12);
      drawText(ctx, p.tab, x + 5, r.y + 3, { color: INK });
    });
    // address bar
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.x + 4, r.y + 15, r.w - 8, 11);
    drawText(ctx, 'https://' + page.url, r.x + 8, r.y + 17, { font: 'small', color: '#4a6a8a' });
    const pr = { x: r.x, y: r.y + 28, w: r.w, h: r.h - 28 };
    ctx.save();
    ctx.beginPath(); ctx.rect(pr.x, pr.y, pr.w, pr.h); ctx.clip();
    paperBg(ctx, pr, '#ffffff');
    const sy = pr.y - w.scroll;
    // scrolling velocity pushes fish
    const sv = w.scroll - d.prevScroll;
    d.prevScroll = w.scroll;
    // layout: title, image, text blocks
    drawText(ctx, page.title, pr.x + 10, sy + 8, { color: '#1a4a8a', scale: 1 });
    const img = { x: pr.x + 10, y: sy + 24, w: 120, h: 70 };
    pageImage(ctx, page.img, img.x, img.y, img.w, img.h, t);
    const lines = wrapText(page.body, pr.w - 150);
    const textBlock = { x: pr.x + 140, y: sy + 24, w: pr.w - 150, h: lines.length * 11 };
    const lines2 = wrapText('Fish here hide behind text and swim around pictures. They are not really in your browser... unless you install the FISHTOP browser companion!', pr.w - 20);
    const textBlock2 = { x: pr.x + 10, y: sy + 104, w: pr.w - 20, h: lines2.length * 11 };
    // fish (behind text)
    const dt = 1 / 60;
    for (const f of d.fish) {
      if (f.tab !== d.tab) continue;
      f.ph = (f.ph + dt * 1.2) % 1;
      f.vy += sv * 6;
      f.vx += Math.sin(t * 0.7 + f.ph * 6) * 2 * dt * 60 * 0.05;
      const wx = pr.x + f.x, wy = pr.y + f.y - w.scroll;
      // swim around the image
      const ix = img.x + img.w / 2, iy = img.y + img.h / 2;
      if (rectContains({ x: img.x - 6, y: img.y - 6, w: img.w + 12, h: img.h + 12 }, wx, wy)) {
        f.vx += Math.sign(wx - ix) * 8; f.vy += Math.sign(wy - iy) * 8;
      }
      const c = g.world.cursor;
      if (dist(c.x, c.y, wx, wy) < 30) { f.vx += Math.sign(wx - c.x) * 6; f.emo = 'scared'; f.look = [c.x, c.y]; } else if (rng.chance(0.01)) f.emo = 'neutral';
      f.vx = clamp(f.vx * 0.98, -40, 40); f.vy = clamp(f.vy * 0.95, -60, 60);
      if (Math.abs(f.vx) < 6) f.vx += (rng.next() - 0.5) * 4;
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.x < 10 || f.x > pr.w - 10) { f.vx *= -1; f.x = clamp(f.x, 10, pr.w - 10); }
      if (f.y < 10 || f.y > 240) { f.vy *= -1; f.y = clamp(f.y, 10, 240); }
      if (Math.abs(f.vx) > 2) f.facing = Math.sign(f.vx);
      drawFishRig(ctx, f.c, { x: wx, y: wy, facing: f.facing, turn: f.facing, angle: 0, scale: 0.55, squash: 0, swimPhase: f.ph, tailPhase: (f.ph * 2) % 1, finPhase: (f.ph * 3) % 1, speed01: 0.5, inflate: 0, lookX: f.look?.[0] ?? null, lookY: f.look?.[1] ?? null, blink: 0, emotion: f.emo, mouth: 0.1, time: t });
    }
    // text drawn over fish with paper-coloured line backgrounds so fish "hide" behind text
    lines.forEach((l, i) => {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(textBlock.x - 2, textBlock.y + i * 11 - 1, measureText(l) + 4, 10);
      drawText(ctx, l, textBlock.x, textBlock.y + i * 11, { color: INK });
    });
    lines2.forEach((l, i) => {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(textBlock2.x - 2, textBlock2.y + i * 11 - 1, measureText(l) + 4, 10);
      drawText(ctx, l, textBlock2.x, textBlock2.y + i * 11, { color: '#4a5a6a' });
    });
    ctx.restore();
  },
};

// ------------------------------------------------------------------ music player
const music = {
  title: 'Tunes',
  size: [210, 110],
  draw(ctx, w, g, r, t) {
    ctx.fillStyle = '#1a1e2e'; ctx.fillRect(r.x, r.y, r.w, r.h);
    const track = g.musicTrackName?.() || 'Silence';
    drawText(ctx, 'Now playing:', r.x + 8, r.y + 6, { color: '#8aa0c8', font: 'small' });
    drawText(ctx, track, r.x + 8, r.y + 16, { color: '#e8f0ff' });
    for (let i = 0; i < 24; i++) {
      const hgt = g.muted ? 1 : 2 + Math.abs(Math.sin(t * 3 + i * 0.7) * Math.sin(t * 1.3 + i)) * 18;
      ctx.fillStyle = i % 2 ? '#5ad8c8' : '#3aa8b8';
      ctx.fillRect(r.x + 8 + i * 8, r.y + 56 - hgt, 6, hgt);
    }
    w.data.btn = { x: r.x + 8, y: r.y + 64, w: 60, h: 14 };
    ctx.fillStyle = '#2a3a5a'; ctx.fillRect(w.data.btn.x, w.data.btn.y, 60, 14);
    drawText(ctx, g.muted ? 'Unmute' : 'Mute', w.data.btn.x + 30, w.data.btn.y + 4, { align: 'center', color: '#ffffff' });
    drawText(ctx, 'Music changes with each ocean.', r.x + 76, r.y + 68, { font: 'small', color: '#8aa0c8' });
  },
  input(w, g, inp) {
    if (inp.pressed && w.data.btn && rectContains(w.data.btn, inp.x, inp.y)) g.command('mute');
  },
};

// ------------------------------------------------------------------ recycle bin
const JUNK = ['old_homework.doc', 'final_FINAL_v7.psd', 'ex_photos.zip', 'cursed_meme.png', 'tax_2019.pdf', 'virus_definitely.exe', 'banana.jpg', 'diary.txt'];
const trash = {
  title: 'Recycle Bin',
  size: [240, 170],
  draw(ctx, w, g, r) {
    paperBg(ctx, r, '#ffffff');
    drawText(ctx, 'Junk files (mutant fish LOVE trash bait)', r.x + 6, r.y + 5, { font: 'small', color: '#6a7a8a' });
    JUNK.forEach((n, i) => {
      const y = r.y + 18 + i * 17;
      const hot = w.data.hover === i;
      if (hot) { ctx.fillStyle = '#d8ecff'; ctx.fillRect(r.x + 2, y - 2, r.w - 4, 16); }
      ctx.drawImage(getUiIcon('trash'), r.x + 6, y);
      drawText(ctx, n, r.x + 20, y + 1, { color: INK });
      if (hot) drawText(ctx, 'click: use as bait', r.x + r.w - 6, y + 2, { font: 'small', color: '#2a6ab8', align: 'right' });
    });
  },
  input(w, g, inp, r) {
    const i = Math.floor((inp.y - r.y - 16) / 17);
    w.data.hover = i >= 0 && i < JUNK.length ? i : -1;
    if (inp.pressed && w.data.hover >= 0) {
      g.addFileBait(JUNK[w.data.hover], false, 'trash');
    }
  },
};

// ------------------------------------------------------------------ my computer (stats)
const computer = {
  title: 'My Computer',
  size: [250, 170],
  draw(ctx, w, g, r) {
    paperBg(ctx, r, '#eef3f8');
    const s = g.state.stats;
    const caught = Object.values(g.state.journal).filter((j) => j.caught).length;
    const rows = [
      ['Fish caught', s.caught], ['Species found', caught], ['Got away', s.escaped], ['Lines snapped', s.snapped],
      ['Coins earned', Math.floor(g.state.totalCoins)], ['Fish in tank', g.state.fish.filter((f) => f.inTank).length],
      ['Time fishing', Math.floor(s.playTime / 60) + ' min'], ['Ocean', g.biomeName()],
    ];
    drawText(ctx, 'Local Disk (C:) is 72% ocean', r.x + 8, r.y + 6, { color: '#2a4a6a' });
    ctx.fillStyle = '#c8d4e0'; ctx.fillRect(r.x + 8, r.y + 18, r.w - 16, 6);
    ctx.fillStyle = '#3aa8d8'; ctx.fillRect(r.x + 8, r.y + 18, Math.round((r.w - 16) * 0.72), 6);
    rows.forEach(([k, v], i) => {
      drawText(ctx, k, r.x + 10, r.y + 32 + i * 12, { color: '#4a5a6a' });
      drawText(ctx, String(v), r.x + r.w - 10, r.y + 32 + i * 12, { color: INK, align: 'right' });
    });
  },
};

// ------------------------------------------------------------------ terminal
const terminal = {
  title: 'Terminal',
  size: [300, 170],
  init(w) {
    w.data.lines = ['FISHTOP shell v1.0 - type "help"', ''];
    w.data.input = '';
  },
  draw(ctx, w, g, r, t) {
    ctx.fillStyle = '#0a1210'; ctx.fillRect(r.x, r.y, r.w, r.h);
    const lines = w.data.lines.slice(-12);
    lines.forEach((l, i) => drawText(ctx, l, r.x + 6, r.y + 5 + i * 11, { color: '#7dff9a' }));
    const cur = Math.floor(t * 2) % 2 ? '_' : '';
    drawText(ctx, '> ' + w.data.input + cur, r.x + 6, r.y + 5 + lines.length * 11, { color: '#c8ffd8' });
  },
  input(w, g, inp) {
    const e = inp.lastKeyEvent;
    if (!e || e === w.data.lastE || g.desktop.windows[g.desktop.windows.length - 1] !== w) return;
    w.data.lastE = e;
    if (e.key === 'Enter') {
      const cmd = w.data.input.trim();
      w.data.lines.push('> ' + cmd);
      w.data.lines.push(...runCommand(cmd, g));
      w.data.input = '';
    } else if (e.key === 'Backspace') w.data.input = w.data.input.slice(0, -1);
    else if (e.key.length === 1 && w.data.input.length < 34) w.data.input += e.key;
    g.audio.play('ui_type', { vol: 0.4 });
  },
};

function runCommand(cmd, g) {
  const [c, ...args] = cmd.toLowerCase().split(/\s+/);
  switch (c) {
    case 'help': return ['commands: help, ls, fish, coins, whoami,', 'weather, time, sudo, clear, crab'];
    case 'ls': return ['desktop/  ocean/  aquarium/  bait_box/', 'secrets.txt (access denied)'];
    case 'fish': g.debugSpawnRandom?.(); return ['a fish appears... probably.'];
    case 'coins': return [`you have ${Math.floor(g.state.coins)} oxidized coins`];
    case 'whoami': return ['a fisher of desktops'];
    case 'weather': return [`${g.biomeName()}: ${g.ocean?.weatherName?.() || 'calm'}`];
    case 'time': return [`ocean time ${g.clock.hour().toFixed(1)}h`];
    case 'sudo': return ['nice try. the crab is root.'];
    case 'crab': return ['(\\/)!_!(\\/)  click click'];
    case 'clear': return Array(12).fill('');
    case '': return [];
    default: return [`${c}: command not found (try "help")`];
  }
}

// ------------------------------------------------------------------ mail
const MAILS = [
  ['Pinch (Bait Shop)', 'Golden bait restocked!', 'Very shiny. Rare fish go WILD for it. Bring coins. Click click.'],
  ['Mr. Briefcase', 'RE: RE: RE: meeting', 'Per my last bubble, I will be swimming between 9 and 5. Do not hook me during office hours.'],
  ['Sir Puffington', 'complaint', 'Someone moved their mouse too fast near me. I have filed a puff.'],
  ['Unknown Sender', '...', 'Deep below, something with many eyes is waiting. Bring an Ancient Relic to the Deep Ocean.'],
];
const mail = {
  title: 'Mail',
  size: [300, 180],
  init(w) { w.data.sel = 0; },
  draw(ctx, w, g, r) {
    paperBg(ctx, r, '#ffffff');
    MAILS.forEach(([from, subj], i) => {
      const y = r.y + 2 + i * 22;
      ctx.fillStyle = w.data.sel === i ? '#d8ecff' : i % 2 ? '#f6f8fa' : '#ffffff';
      ctx.fillRect(r.x, y, 110, 21);
      drawText(ctx, from.slice(0, 18), r.x + 4, y + 2, { color: INK, font: 'small' });
      drawText(ctx, subj.slice(0, 18), r.x + 4, y + 11, { color: '#5a6a7a' });
    });
    ctx.fillStyle = '#c8d4e0'; ctx.fillRect(r.x + 111, r.y, 1, r.h);
    const m = MAILS[w.data.sel];
    drawText(ctx, m[1], r.x + 118, r.y + 6, { color: '#1a4a8a' });
    drawWrapped(ctx, m[2], r.x + 118, r.y + 22, r.w - 124, { color: INK });
  },
  input(w, g, inp, r) {
    if (inp.pressed && inp.x < r.x + 110) {
      const i = Math.floor((inp.y - r.y - 2) / 22);
      if (MAILS[i]) { w.data.sel = i; g.audio.play('ui_click'); }
    }
  },
};

// ------------------------------------------------------------------ calendar (real date + forecast)
const calendar = {
  title: 'Calendar',
  size: [220, 170],
  draw(ctx, w, g, r) {
    paperBg(ctx, r, '#fffaf0');
    const d = new Date();
    const month = d.toLocaleString('en', { month: 'long' });
    drawText(ctx, `${month} ${d.getFullYear()}`, r.x + r.w / 2, r.y + 6, { align: 'center', color: '#a83a3a' });
    const first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    'SMTWTFS'.split('').forEach((c, i) => drawText(ctx, c, r.x + 14 + i * 28, r.y + 20, { font: 'small', color: '#8a7a6a' }));
    for (let i = 0; i < days; i++) {
      const cell = first + i;
      const x = r.x + 10 + (cell % 7) * 28, y = r.y + 30 + Math.floor(cell / 7) * 16;
      if (i + 1 === d.getDate()) { ctx.fillStyle = '#ffd8a0'; ctx.fillRect(x - 2, y - 2, 20, 12); }
      drawText(ctx, String(i + 1), x, y, { font: 'small', color: INK });
    }
    drawText(ctx, `Forecast: ${g.ocean?.weatherName?.() || 'calm'}`, r.x + 8, r.y + r.h - 12, { font: 'small', color: '#3a6a8a' });
  },
};

// ------------------------------------------------------------------ simple fun ones
const generic = {
  title: 'App',
  size: [220, 120],
  draw(ctx, w, g, r) {
    paperBg(ctx, r, '#f4f6f8');
    drawWrapped(ctx, w.data.text || 'This app is busy watching fish.', r.x + 10, r.y + 10, r.w - 20, { color: INK });
  },
};

const paint = { ...generic, title: 'Paint', init(w) { w.data.text = 'Paint is out of ink. A squid borrowed it.'; } };
const calc = {
  title: 'Calculator', size: [160, 120],
  draw(ctx, w, g, r, t) {
    ctx.fillStyle = '#2a2e38'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#b8d8a8'; ctx.fillRect(r.x + 6, r.y + 6, r.w - 12, 20);
    const n = Math.floor(g.state.coins);
    drawText(ctx, String(n), r.x + r.w - 10, r.y + 12, { align: 'right', color: '#1a2a1a' });
    drawText(ctx, 'coins = ' + (n * 0.0001).toFixed(4) + ' fish-bucks', r.x + 8, r.y + 34, { font: 'small', color: '#c8d0e0' });
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = '#3e4452';
      ctx.fillRect(r.x + 8 + (i % 4) * 36, r.y + 46 + Math.floor(i / 4) * 20, 32, 16);
      drawText(ctx, '789456123.0='[i], r.x + 24 + (i % 4) * 36, r.y + 50 + Math.floor(i / 4) * 20, { align: 'center', color: '#e8ecf4' });
    }
  },
};
const chat = { ...generic, title: 'Chat', size: [240, 130], init(w) { w.data.text = 'Pinch: psst. fish like slow hands.\nPinch: and golden things.\nPinch: and my shop. buy stuff. click click.'; } };
const video = {
  title: 'FishTube', size: [240, 150],
  draw(ctx, w, g, r, t) {
    ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h - 20);
    const sp = SPECIES_BY_ID.puffer || Object.values(SPECIES_BY_ID)[0];
    if (sp) drawFishRig(ctx, compiled(sp.look, null, sp.id), { x: r.x + r.w / 2 + Math.sin(t) * 40, y: r.y + 55, facing: Math.cos(t) > 0 ? 1 : -1, turn: Math.cos(t) > 0 ? 1 : -1, angle: 0, scale: 1, squash: 0, swimPhase: t % 1, tailPhase: (t * 2) % 1, finPhase: (t * 3) % 1, speed01: 0.5, inflate: Math.max(0, Math.sin(t * 0.5)), lookX: null, lookY: null, blink: 0, emotion: Math.sin(t * 0.5) > 0.5 ? 'angry' : 'happy', mouth: 0.2, time: t });
    drawText(ctx, 'PUFFER INFLATES FOR 10 HOURS', r.x + 6, r.y + r.h - 14, { font: 'small', color: '#ffffff' });
  },
};
const photos = {
  title: 'Photos', size: [280, 180],
  draw(ctx, w, g, r, t) {
    paperBg(ctx, r, '#2a2e38');
    const best = g.state.fish.slice().sort((a, b) => (RARITY_RANK[b.rarity] || 0) - (RARITY_RANK[a.rarity] || 0) || b.sizeCm - a.sizeCm).slice(0, 6);
    if (!best.length) drawText(ctx, 'No catch photos yet. Go fishing!', r.x + r.w / 2, r.y + r.h / 2, { align: 'center', color: '#c8d0e0' });
    best.forEach((f, i) => {
      const x = r.x + 8 + (i % 3) * 90, y = r.y + 8 + Math.floor(i / 3) * 82;
      ctx.fillStyle = '#f4f0e8'; ctx.fillRect(x, y, 84, 76);
      ctx.fillStyle = '#5ab8d8'; ctx.fillRect(x + 4, y + 4, 76, 52);
      const sp = SPECIES_BY_ID[f.species];
      if (sp) drawFishRig(ctx, compiled(sp.look, f.variant, sp.id), { x: x + 42, y: y + 30, facing: 1, turn: 1, angle: 0, scale: Math.min(1, 60 / ((sp.look.body?.len || 30) * 1.4)), squash: 0, swimPhase: (t * 0.8) % 1, tailPhase: (t * 1.5) % 1, finPhase: (t * 2) % 1, speed01: 0.3, inflate: 0, lookX: null, lookY: null, blink: 0, emotion: 'happy', mouth: 0.1, time: t });
      drawText(ctx, (sp?.name || f.species).slice(0, 15), x + 42, y + 60, { align: 'center', font: 'small', color: INK });
      drawText(ctx, f.sizeCm + 'cm', x + 42, y + 67, { align: 'center', font: 'small', color: '#6a7a8a' });
    });
  },
};
const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

const folder = (title, text) => ({ ...generic, title, init(w) { w.data.text = text; } });

export const APP_RENDERERS = {
  notes, browser, music, trash, computer, terminal, mail, calendar, paint, calc, chat, video, photos, generic,
  documents: folder('Documents', 'resume_final.doc, fish_facts.txt, totally_not_bait.pdf\n\nFolders attract curious fish. Try dragging this folder into the Bait Box!'),
  games: folder('Games', 'FISHTOP is the only game you need right now.\n\nGame icons attract playful fish like the Honk Clownfish.'),
  settings: { ...generic, title: 'Settings', init(w, g) { w.data.text = 'Opening settings...'; g.ui.open('settings'); setTimeout(() => g.desktop.closeWindow(w), 30); } },
  fishtop: { ...generic, title: 'FISHTOP', init(w, g) { w.data.text = 'Opening your Fish Journal...'; g.ui.open('journal'); setTimeout(() => g.desktop.closeWindow(w), 30); } },
};
