// Boots the full game onto #screen.
import { Game } from './game.js';

export function startGame(params) {
  const canvas = document.getElementById('screen'); // [phase4:shell] no transparent overlay mode any more
  const game = new Game(canvas, params);
  game.start();
  canvas.focus();
  return game;
}
