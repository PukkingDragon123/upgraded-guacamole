// STUB - replaced by the voxel character module. API per docs/ARCHITECTURE.md "Character".
export const DEFAULT_CHARACTER = { skin: '#5ccf4a', belly: '#d8f0a8', eyes: 'goofy', hat: 'bucket', outfit: 'overalls', boots: 'yellow', rod: 'bamboo', boat: '#c8583a' };
export const WARDROBE = [];
export function drawCharacter(ctx, x, y, o = {}) {
  ctx.fillStyle = '#5ccf4a';
  ctx.fillRect(Math.round(x - 5), Math.round(y - 22), 10, 22);
  return { rodTip: [x + 18, y - 26], hands: [x + 6, y - 12], head: [x, y - 24] };
}
