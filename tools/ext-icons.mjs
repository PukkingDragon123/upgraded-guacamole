// Generates the browser-extension icons (extension/icons/icon{16,32,48,128}.png) from a hand-authored
// 16x16 pixel fish, upscaled with nearest-neighbour. No dependencies: PNGs are encoded with node:zlib.
//   node tools/ext-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'extension', 'icons');

const PAL = {
  k: '#14202c', // outline
  B: '#2a8aa0', // back
  b: '#4fd8c4', // body
  h: '#9af4e0', // body highlight
  l: '#e0fff4', // belly
  f: '#ffb35a', // fins / tail
  F: '#e0763a', // fin shade
  w: '#ffffff', // eye
  x: '#14202c', // pupil
  c: '#ff7a8a', // cheek
};

const ART = [
  '................',
  '................',
  '.......kkkk.....',
  '......kfffFk....',
  '.....kBBBBBBk...',
  '....kBBBBBBBBk..',
  '.kk.khhbbbbbwwk.',
  'kffkbhbbbbbwwxxk',
  'kfFkbbbbbbbwwxxk',
  'kfFFbbbbbbbbbbck',
  'kffklbbbbbbbbbk.',
  '.kk.kllllllllbk.',
  '.....kllllllkk..',
  '......kFfFkk....',
  '.......kkk......',
  '................',
];

function rgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const n = ART.length, s = size / n;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const ch = ART[Math.floor(y / s)][Math.floor(x / s)];
      const px = PAL[ch] ? rgba(PAL[ch]) : [0, 0, 0, 0];
      raw.set(px, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(out, `icon${size}.png`), png(size));
  console.log(`extension/icons/icon${size}.png`);
}
