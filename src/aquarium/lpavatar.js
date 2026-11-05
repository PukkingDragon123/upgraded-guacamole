// The player's bubble person as a low-poly swimmer for the aquarium's swim mode (phase 6): a glossy, tinted
// soap-bubble head with big cartoon eyes and a smile, a little body in the player's top and bottoms, kicking legs
// with aqua swim fins and paddling arms. Built lying along +x (head forward, back up), about 10 units long.
//
//   avatarKit(look) -> {body, head (transparent bubble), face, legL, legR, armL, armR, hip, shoulder, len, tint}
//   avatarItems(kit, pos, yaw, pitch, roll, scale, t, kick) -> [{mesh, model, o}] for the LPScene

import { Geo, rgb, shadec, mixc } from './lpkit.js';
import { M4, T4 } from '../gfx/lowpoly.js';
import { TINTS, normalizeLook } from '../gfx/character.js';

const TOPS = { tee: '#ffffff', hoodie: '#59c3ff', raincoat: '#9be84a', sailor: '#ffffff', jersey: '#2fd3e8', puffer: '#e8f6ff', labcoat: '#ffffff', leafy: '#5cc832', tux: '#1a3a6a', astro: '#f2f6fa', aquasuit: '#5ad0ff', coat: '#2a6ab0' };
const BOTTOMS = { shorts: '#2fb8e8', jeans: '#4a7ac8', skirt: '#8fd0ff', cargo: '#c8b48a', leggings: '#8be04a', aquasuit: '#5ad0ff', swim: '#ff8a4a', astro: '#f2f6fa', navy: '#1a3a6a' };

let KIT = null, KEY = '';
export function avatarKit(look) {
  let L;
  try { L = normalizeLook(look); } catch { L = {}; }
  const key = JSON.stringify([L.tint, L.top, L.bottom]);
  if (KIT && KEY === key) return KIT;
  const tint = TINTS?.[L.tint] || { tint: '#7fe0ff', deep: '#1a6aa8' };
  const top = TOPS[L.top] || '#ffffff', bot = BOTTOMS[L.bottom] || '#2fb8e8';
  // torso (lying along x: shoulders at x = 0, hips at x = -4)
  const body = new Geo();
  body.jit = 0.06;
  body.push(); body.rotZ(Math.PI / 2); body.at(0, 0, 0);
  body.lathe([[1.0, -4.4], [1.4, -3.6], [1.45, -2.6], [1.42, -1.4], [1.3, -0.4], [1.05, 0.2], [0.7, 0.6]], 9, (i) => (i < 3 ? bot : top), { capBot: bot, capTop: top });
  body.pop();
  // a glossy aqua Aero air tank on the back (reads as a little diver from behind)
  for (const z of [-0.5, 0.5]) {
    body.push(); body.at(-2.9, 1.55, z); body.rotZ(-Math.PI / 2);
    body.cyl(0.55, 0.55, 3.2, 8, '#3ac4f8', { capCol: '#bff4ff' });
    body.at(0, 3.2, 0); body.cyl(0.3, 0.2, 0.5, 6, '#dfe8f0');
    body.pop();
  }
  body.tube([[-0.6, 1.35, -0.5], [-0.2, 1.1, 0], [-0.6, 1.35, 0.5]], 0.14, 4, '#dfe8f0');
  // neck ring the bubble sits on
  body.push(); body.at(0.75, 0, 0); body.rotZ(Math.PI / 2);
  const ring = []; for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI * 2; ring.push([Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1]); }
  body.tube(ring, 0.28, 5, mixc(tint.tint, '#ffffff', 0.4), { caps: false });
  body.pop();
  // the face lives on the bubble's front (x+), looking slightly down-forward
  const face = new Geo();
  for (const s of [-1, 1]) {
    face.push(); face.at(4.0, 0.55, s * 0.95); face.scale(0.5, 1, 0.75);
    face.sphere(0.55, 1, '#141a26', { smooth: true });
    face.pop();
    face.push(); face.at(4.2, 0.85, s * 0.95 + 0.18); face.sphere(0.2, 0, '#ffffff', { smooth: true }); face.pop();
    face.push(); face.at(3.75, -0.25, s * 1.45); face.scale(0.3, 0.45, 0.6); face.sphere(0.5, 0, '#ff9ab4'); face.pop();
  }
  const sm = []; for (let i = 0; i <= 6; i++) { const a = -0.9 + (i / 6) * 1.8; sm.push([4.05 - Math.cos(a) * 0.05, -0.55 - Math.cos(a) * 0.35, Math.sin(a) * 0.75]); }
  face.tube(sm, 0.12, 4, '#3a1a2a');
  // bubble head
  const head = new Geo();
  head.push(); head.at(2.6, 0.3, 0); head.sphere(2.2, 2, mixc(tint.tint, '#ffffff', 0.25), { smooth: true }); head.pop();
  const headIn = new Geo();
  headIn.push(); headIn.at(2.6, 0.3, 0); headIn.sphere(2.15, 2, mixc(tint.tint, tint.deep || '#1a6aa8', 0.3), { smooth: true, inside: true }); headIn.pop();
  // a leg: thigh + shin + fin, pivot at the hip (origin), extending to -x
  const leg = new Geo();
  leg.tube([[0, 0, 0], [-1.8, -0.1, 0], [-3.4, 0, 0]], [0.62, 0.55, 0.45], 6, bot);
  leg.tube([[-3.4, 0, 0], [-3.6, 0, 0]], 0.5, 6, '#ffe0c8', { caps: false });
  leg.push(); leg.at(-3.6, 0, 0);
  leg.fan([[0.3, 0, 0], [-3.8, 0.2, 1.5], [-4.3, 0, 0], [-3.8, -0.2, -1.5]].map(([x, y, z]) => [x, y * 0.3, z]), '#ffd23a');
  leg.fan([[0.2, 0.05, 0], [-3.1, 0.1, 1.0], [-3.5, 0.05, 0], [-3.1, 0.1, -1.0]], '#fff08a');
  leg.pop();
  // an arm, pivot at the shoulder, reaching forward (+x) when stroking
  const mkArm = (s) => {
    const arm = new Geo();
    arm.tube([[0, 0, 0], [0.4, -0.3, 1.1 * s], [1.2, -0.4, 2.1 * s]], [0.42, 0.38, 0.34], 5, top);
    arm.push(); arm.at(1.3, -0.45, 2.2 * s); arm.sphere(0.48, 0, '#ffe0c8'); arm.pop();
    return arm.build();
  };
  KIT = {
    body: body.build(), face: face.build(), head: head.build(), headIn: headIn.build(), leg: leg.build(), armR: mkArm(1), armL: mkArm(-1),
    hip: [-4.0, 0, 0.62], shoulder: [-0.3, 0.2, 1.25], len: 13, tint: rgb(tint.tint),
  };
  KEY = key;
  return KIT;
}

// pos: world centre, yaw (around y, 0 = +x), pitch (nose up), scale = cm per unit; kick: swim intensity 0..1
export function avatarItems(kit, pos, yaw, pitch, roll, scale, t, kick = 0.3) {
  const root = T4.trs(pos, roll, yaw, pitch, scale);
  const out = [];
  const add = (mesh, local, o = {}) => out.push({ mesh, model: local ? M4.mul(root, local) : root, o });
  add(kit.body); add(kit.face);
  const sw = Math.sin(t * (4 + kick * 6));
  for (const s of [-1, 1]) {
    const hip = [kit.hip[0], kit.hip[1], kit.hip[2] * s];
    add(kit.leg, T4.trs(hip, 0, s * 0.12, sw * s * (0.25 + kick * 0.35), 1));
    const sh = [kit.shoulder[0], kit.shoulder[1], kit.shoulder[2] * s];
    const ang = t * (2.5 + kick * 3) + (s > 0 ? 0 : Math.PI);
    add(s > 0 ? kit.armR : kit.armL, T4.trs(sh, Math.sin(ang) * 0.5 * s, 0, Math.cos(ang) * 0.5, 1));
  }
  add(kit.headIn, null, { alpha: 0.18 });
  add(kit.head, null, { alpha: 0.3 });
  return out;
}

export { shadec };
