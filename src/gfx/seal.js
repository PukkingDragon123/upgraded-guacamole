// Compatibility names for the guide [grouper23]: Bubbles is now a floating wind-up talking TOY GROUPER
// (src/gfx/grouper.js). Every caller keeps the old seal API (drawSeal, SealGuide, SEAL_ANIMS ...) and the NPC id 'seal'.
export {
  drawGrouper as drawSeal, GrouperGuide as SealGuide, GROUPER_ANIMS as SEAL_ANIMS, GROUPER_ALIAS as SEAL_ALIAS,
  GROUPER_INFO as SEAL_INFO, grouperSize as sealSize, warmGrouper as warmSeal, grouperReady as sealReady,
  GROUPER_OUTLINE as SEAL_OUTLINE, GROUPER_VOXEL as SEAL_VOXEL, drawSoapBubble, drawPointStream, pointBucket,
} from './grouper.js';
