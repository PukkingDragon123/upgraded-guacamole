// TEMP scratch preview (duck26 agent): player face close-ups. dist/dev/zz_face26.html?s=2
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { drawCharacter, DEFAULT_CHARACTER, setCharacterBudget, warmCharacter } from '../gfx/character.js';
import { drawNPC, NPCS } from '../gfx/npcs.js';

export function run(params) {
  const sc0 = Number(params.get('s') || 2), W = Math.round(Math.max(480, (40 * sc0 + 40) * 5 + 20)), H = Math.round(Math.max(300, (80 * sc0 + 30) * 2 + 20));
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H; const Z = Number(params.get('z') || 4); cv.style.width = W * Z + 'px'; cv.style.height = H * Z + 'px';
  const g = ctxOf(cv);
  setCharacterBudget(1e9);
  const look = { ...DEFAULT_CHARACTER, ...(params.get('look') ? JSON.parse(params.get('look')) : {}) };
  const sc = Number(params.get('s') || 2);
  const view = params.get('v') || 'moods';
  const t = Number(params.get('t') || 0.3);
  g.fillStyle = '#3a7fb0'; g.fillRect(0, 0, W, H);
  const lab = (s, x, y) => drawText(g, s, x, y, { font: 'small', color: '#fff', align: 'center', shadow: '#0b1622' });
  if (view === 'moods') {
    const items = [['idle', null, null], ['blink', null, null, 1], ['happy', 'cheer', null], ['sad', 'sad', 'sad'], ['surprised', null, 'surprised'], ['angry', null, 'angry'], ['love', null, 'love'], ['excited', null, 'excited'], ['squint', 'pull', null], ['laugh', 'laugh', null]];
    items.forEach(([name, pose, mood, blink], i) => {
      const x = Math.round(30 * sc + 20 + (i % 5) * (40 * sc + 40)), y = Math.round((80 * sc + 30) * (1 + Math.floor(i / 5)));
      drawCharacter(g, x, y + 60 * (sc - 2) * 0, { pose: pose || 'idle', t: pose === 'cheer' ? 0.05 : t, facing: 1, scale: sc, look, id: 'f' + i, mood, blink, trail: false, shadow: false, rod: false });
      lab(name, x, y + 4);
    });
  } else if (view === 'styles') {
    const st = ['bean', 'sparkle', 'anime', 'happy', 'sleepy', 'star', 'heart', 'swirl', 'led', 'wink', 'dot', 'teary', 'derp'];
    st.forEach((e, i) => {
      const x = 36 + (i % 7) * 68, y = 120 + Math.floor(i / 7) * 130;
      drawCharacter(g, x, y, { pose: 'idle', t, facing: 1, scale: sc, look: { ...look, eyes: e }, id: 's' + i, trail: false, shadow: false, rod: false });
      lab(e, x, y + 4);
    });
  } else if (view === 'scales') {
    [0.45, 0.62, 1, 1.5, 2, 3].forEach((s, i) => {
      const x = [20, 50, 90, 150, 240, 380][i];
      drawCharacter(g, x, 240, { pose: 'idle', t, facing: 1, scale: s, look, id: 'k' + i, trail: false, shadow: false, rod: false });
      drawCharacter(g, x, 120, { pose: 'idle', t, yaw: 0, scale: s, look, id: 'kf' + i, trail: false, shadow: false, rod: false, mood: i % 2 ? 'happy' : null });
    });
  } else if (view === 'turn') {
    [0, -30, -60, -90, 30, 160].forEach((yw, i) => {
      drawCharacter(g, 40 + i * 80, 200, { pose: 'idle', t, yaw: yw, scale: sc, look, id: 't' + i, trail: false, shadow: false, rod: false });
      lab('yaw ' + yw, 40 + i * 80, 204);
    });
  } else if (view === 'npcs') {
    Object.keys(NPCS).forEach((id, i) => {
      const x = 40 + i * 80;
      drawNPC(g, id, { x, y: 200, t, scale: sc, facing: 1, pose: 'idle', mood: 'happy', id: 'n' + i });
      lab(id, x, 204);
    });
  }
}
