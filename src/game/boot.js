// Boots the full game onto #screen.
import { Game } from './game.js';

export function startGame(params) {
  const canvas = document.getElementById('screen');
  if (params.get('host') === 'electron' && (params.get('mode') === 'overlay' || params.get('mode') === 'wallpaper')) {
    document.body.classList.add('transparent');
  }
  const game = new Game(canvas, params);
  game.start();
  canvas.focus();
  return game;
}
