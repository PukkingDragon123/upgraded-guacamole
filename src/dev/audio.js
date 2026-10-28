// Dev preview for the procedural audio engine. Click the canvas (or call
// window.__audioTest()) to unlock and run every SFX, loop, music track, ambience and voice.
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { audio, SFX_NAMES, LOOP_NAMES, MUSIC_TRACKS, BABBLE_VOICES } from '../core/audio.js';

const W = 640, H = 360, S = 3;
const AMBIENCES = [
  ['desktop', null, {}], ['shallows', 'shallows', {}], ['shallows rain', 'shallows', { weather: 'rain' }],
  ['shallows storm', 'shallows', { weather: 'storm' }], ['shallows night', 'shallows', { night: true }],
  ['junkyard', 'junkyard', {}], ['junkyard static', 'junkyard', { weather: 'static' }],
  ['junkyard datarain', 'junkyard', { weather: 'datarain' }], ['abyss', 'abyss', {}],
  ['abyss current', 'abyss', { weather: 'current' }], ['abyss glowtide', 'abyss', { weather: 'glowtide' }],
  ['abyss snow', 'abyss', { weather: 'snow' }],
];
const LINE = 'Hello there, little fisher! Caught anything good today?';

function buildItems() {
  const items = [];
  const add = (kind, name, label = name) => items.push({ kind, name, label, res: null });
  for (const n of SFX_NAMES) add('sfx', n);
  for (const n of LOOP_NAMES) add('loop', n, 'loop ' + n);
  for (const n of MUSIC_TRACKS) add('music', n, 'music ' + n);
  for (const [label] of AMBIENCES) add('amb', label, 'amb ' + label);
  for (const v of BABBLE_VOICES) add('babble', v, 'babble ' + v);
  add('misc', 'night+muffle', 'night + muffle');
  return items;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function run(params) {
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  cv.style.cursor = 'pointer';
  const g = ctxOf(cv);
  const items = buildItems();
  let current = -1, running = false, status = 'click to unlock + run all';

  function draw() {
    g.fillStyle = '#10202e';
    g.fillRect(0, 0, W, H);
    drawText(g, 'FISHTOP audio test', 6, 4, { color: '#7fd6c8', shadow: '#05101a' });
    drawText(g, status, 634, 6, { font: 'small', align: 'right', color: '#c8d8e0' });
    const rows = 42, colW = 128, top = 18;
    items.forEach((it, i) => {
      const x = 4 + Math.floor(i / rows) * colW, y = top + (i % rows) * 8;
      if (i === current) { g.fillStyle = '#2c5a6e'; g.fillRect(x - 2, y - 1, colW - 4, 7); }
      const col = it.kind === 'sfx' ? '#e8f0f2' : it.kind === 'loop' ? '#ffd08a' : it.kind === 'music' ? '#9fe0ff' : it.kind === 'amb' ? '#a8f0b0' : '#f0b0e0';
      drawText(g, it.label.slice(0, 20), x, y, { font: 'small', color: it.res ? col : '#5d7380' });
      if (it.res) {
        const pk = it.res.peak, c = pk > 0.9 ? '#ff5a5a' : pk < 0.01 ? '#ffb040' : '#6fd08a';
        drawText(g, pk.toFixed(2), x + colW - 8, y, { font: 'small', align: 'right', color: c });
      }
    });
    requestAnimationFrame(draw);
  }
  draw();

  async function test(opts = {}) {
    if (running) return null;
    running = true;
    const gap = opts.gap ?? 160, hold = opts.hold ?? 1600;
    audio.unlock();
    for (let k = 0; k < 40 && !audio.isUnlocked(); k++) await wait(25);
    const m = audio._meter();
    const out = { unlocked: audio.isUnlocked(), results: {}, voices: [] };
    // measure: peak and max short-term (50 ms) RMS; in measure mode wait for silence
    const step = async (i, fn, ms, settle = opts.measure) => {
      current = i; status = items[i].label;
      if (m) m.read();
      await fn();
      const t0 = performance.now();
      let peak = 0, st = 0, el = 0;
      while (true) {
        await wait(50);
        el = performance.now() - t0;
        const r = m ? m.read() : { peak: 0, rms: 0 };
        peak = Math.max(peak, r.peak); st = Math.max(st, r.rms || 0);
        if (el >= ms && (!settle || r.peak < 0.002 || el > ms + 6000)) break;
      }
      const r = { peak, rms: st };
      items[i].res = r;
      out.results[items[i].kind + ':' + items[i].name] = { peak: +peak.toFixed(3), rms: +st.toFixed(4), ms: Math.round(el) };
      out.voices.push(audio._voices());
    };
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'sfx') await step(i, () => audio.play(it.name), gap);
        else if (it.kind === 'loop') {
          await step(i, async () => {
            const h = audio.loop(it.name);
            for (let k = 0; k <= 20; k++) { h.set(k / 20); await wait(hold / 20); }
            h.stop();
          }, 300, false);
        } else if (it.kind === 'music') await step(i, () => audio.setMusic(it.name), hold * 1.5, false);
        else if (it.kind === 'amb') {
          if (it.name === AMBIENCES[0][0]) audio.setMusic(null);
          const [, biome, o] = AMBIENCES.find((a) => a[0] === it.name);
          await step(i, () => audio.setAmbience(biome, o), hold, false);
        } else if (it.kind === 'babble') {
          audio.setAmbience('off');
          await step(i, () => audio.babble(LINE, it.name), 900);
        } else if (it.kind === 'misc') {
          await step(i, async () => {
            audio.setMusic('shallows'); audio.setNight(true); audio.setMuffle(0.8);
            for (const c of 'typing!') { audio.babble(c, 'tiny'); audio.play('ui_type'); await wait(70); }
            for (let k = 0; k < 6; k++) { audio.play('coin_collect'); await wait(110); }
            audio.setVolumes({ master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.6 });
            audio.setMuffle(0); audio.setNight(false); audio.setMusic(null);
          }, 500);
        }
      }
    } finally {
      audio.setMusic(null); audio.setAmbience('off');
      if (m) m.close();
      running = false; current = -1; status = 'done - click to run again';
    }
    return out;
  }

  window.__audioTest = test;
  window.__audio = audio;
  cv.addEventListener('pointerdown', () => { audio.unlock(); if (!running) test(); });
  if (params && params.has && params.has('auto')) test();
}
