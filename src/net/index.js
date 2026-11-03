// Multiplayer entry point (OWNER: Online & AppSea agent).
//   installNet(game) -> game.net (idempotent). See ./net.js for the API, ./protocol.js for the wire format.
// Published artifact capability declaration (claude.ai): { room: { topics: { caught: 'interact', emote: 'interact', wave: 'interact' } } }

import { Net } from './net.js';

export { Net, ensureNet, netUnlocked, NET_NEEDS_LAB } from './net.js';
export { EMOTES, EMOTE_BY_ID, NAME_MAX, cleanName, randomName } from './protocol.js';

export const ROOM_CAPABILITIES = { room: { topics: { caught: 'interact', emote: 'interact', wave: 'interact' } } };

export function installNet(game) {
  if (game.net) return game.net;
  try {
    game.net = new Net(game);
  } catch (e) {
    console.error('net: disabled', e);
    game.net = { update() {}, draw() {}, partyLuck: () => 1, online: false, list: () => [], feed: [] };
  }
  return game.net;
}
