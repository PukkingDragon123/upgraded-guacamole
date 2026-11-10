// Recorded CC0 sound effects layered over the procedural synth (see assets/sfx/CREDITS.md).
// SAMPLE_MAP: game sound name -> clip ids (a random variant plays). Names without clips keep the synth.
//   playSample(ctx, dest, name, {vol, pitch, pan}) -> true when a decoded clip played; false = use the synth
//   (clips decode lazily on first use; the very first call for a name falls back to the synth while decoding).
import { SAMPLE_DATA } from './samples-data.js';

export const SAMPLE_MAP = {
  splash_small: ['splash_s1', 'splash_s2', 'splash_s3'], splash_big: ['splash_b1', 'splash_b2'],
  bubble: ['bubble1', 'bubble2', 'bubble3'], bubbles: ['bubble1', 'bubble3'], blub: ['bubble2', 'pop1'],
  puff: ['plop1', 'plop2'], mash_pop: ['pop1', 'plop1'], icon_drop: ['plop2'], gulp: ['gulp'],
  ui_click: ['click1', 'click2'], click: ['click1', 'click2'], ui_tab: ['tab1', 'tab2'], ui_page: ['tab2'],
  ui_toggle: ['toggle1'], ui_hover: ['hover1'], ui_close: ['close1'], ui_open: ['click2'],
  treasure_open: ['box_open'], box_open: ['box_open'], ice_crack: ['ice1'], vending: ['vending'],
  eruption_boom: ['boom'], train_ding: ['bell'], notify: ['bell'], chest_hit: ['hit1', 'hit2'], lock_open: ['key_open'],
};
const GAIN = { ui_hover: 0.35, ui_click: 0.7, click: 0.6, bubble: 0.8, eruption_boom: 0.8, splash_big: 0.9 };

const buffers = new Map(); // clip id -> AudioBuffer | 'pending' | 'failed'

function decode(ctx, id) {
  const b64 = SAMPLE_DATA[id];
  if (!b64) { buffers.set(id, 'failed'); return; }
  buffers.set(id, 'pending');
  try {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    ctx.decodeAudioData(u8.buffer).then((buf) => buffers.set(id, buf), () => buffers.set(id, 'failed'));
  } catch { buffers.set(id, 'failed'); }
}

// decode every mapped clip in the background once audio is unlocked, so first uses are not synth fallbacks
export function warmSamples(ctx) {
  for (const ids of Object.values(SAMPLE_MAP)) for (const id of ids) if (!buffers.has(id)) decode(ctx, id);
}

export function playSample(ctx, dest, name, { vol = 1, pitch = 1, pan = 0 } = {}) {
  const ids = SAMPLE_MAP[name];
  if (!ids || !ctx) return false;
  const id = ids[(Math.random() * ids.length) | 0];
  const buf = buffers.get(id);
  if (buf === undefined) { decode(ctx, id); return false; }
  if (!(buf instanceof AudioBuffer)) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.25, Math.min(4, pitch * (0.96 + Math.random() * 0.08)));
  const g = ctx.createGain();
  g.gain.value = Math.min(2, vol) * (GAIN[name] ?? 1);
  let node = g;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
  src.connect(g);
  node.connect(dest);
  src.start();
  return true;
}
