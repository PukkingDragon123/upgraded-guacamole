// Dev: the full game without the other dev pages (builds even while an unrelated dev page is mid-edit).
//   node tools/build.mjs --dev labgame  ->  dist/dev/labgame.html?skipintro
import { startGame } from '../game/boot.js';

export function run(params) { startGame(params); }
