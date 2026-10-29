// Frutiger Aero NPCs (phase 3). OWNER: Character agent (stub). All voxel, never 2D eyes.
//   NPCS: {id: {id, name, role, desc}}
//   drawNPC(ctx, id, {x, y /* feet */, t, scale, facing, talk /* 0..1 mouth */, mood, pose})
export const NPCS = {};
export function drawNPC(ctx, id, o = {}) {
  ctx.fillStyle = '#7fd8ff';
  ctx.fillRect(Math.round(o.x - 4), Math.round(o.y - 14), 8, 14);
}
