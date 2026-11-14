// The armory hallway and the shooting range, on the ground floor behind the hall.
//
// A door in the wall under the end gallery (the dead end of the left aisle) opens into a hallway
// that runs back under the gallery and out through the hall's rear wall. Its walls are a rack of
// the collection's guns. A side door at its far end leads into the range: a counter to shoot
// from, five lanes, and cover at 9, 16 and 24 metres for the bots to step out from.
// The game itself (bots, hits, score) is in js/range/game.js; this file is the building.
import * as THREE from 'three';
import { DIM as D } from './looks.js';
import { wallWithDoor } from './rooms.js';
import { createRangeGame } from '../range/game.js';
import { drawCrosshair } from '../crosshair.js';

const { ZG } = D;
/** The door from the hall: where across the hall, how wide, how high. */
export const GATE = { x: -5.4, w: 2.0, h: 2.6 };
const CX0 = -6.6, CX1 = -4.2;                 // the hallway's two walls
const CZ1 = -33.6;                            // its far end
const CH = 3.0;                               // its ceiling, just under the gallery's slab
/** The hallway's cross-section, for the hall to leave an opening in its rear wall. */
export const HALLWAY = { x0: CX0, x1: CX1, h: CH };
const RX0 = -4.0, RX1 = 8.0;                  // the range: left and right walls
const RZ0 = -31.0, RZ1 = -59.0;               // near and far walls
const RH = 4.6;
const LINE = -34.0;                           // the counter: nobody walks past it
const SIDE = { z0: -31.3, z1: -33.3, h: 2.6 };   // the doorway from the hallway into the range
const LANE = 2.4;
const E = 0.4;                                // how far a visitor keeps from these walls
/**
 * Where the bots' cover stands: metres across, metres back, and which row. The rows close in
 * like a funnel, the nearest cover against the walls and the farthest in the middle, so that
 * no cover hides a bot of a row behind it from a visitor at the middle of the counter. (With
 * cover spread evenly, half the far bots stepped out where nobody could see them.)
 */
const POSTS = [
  { x: -2.9, z: -43, row: 'near' }, { x: 6.9, z: -43, row: 'near' },
  { x: -1.2, z: -50, row: 'mid' }, { x: 5.2, z: -50, row: 'mid' },
  { x: 0.6, z: -58, row: 'far' }, { x: 3.4, z: -58, row: 'far' },
];
const COVER = { w: 1.0, h: 2.05, d: 0.5 };

/** Height of the floor in the hallway and the range (always the ground), or null where there is none. */
export function rangeFloor(x, z) {
  // The hallway. It starts a good step inside the hall: the hall holds a visitor off its walls,
  // and a doorway that began at the wall itself could never be reached.
  if (x >= CX0 + E && x <= CX1 - E && z <= ZG + 0.9 && z >= CZ1 + E) return 0;
  if (z <= SIDE.z0 - 0.3 && z >= SIDE.z1 + 0.3 && x > CX1 - E - 0.05 && x < RX0 + E + 0.05) return 0;   // the side door
  if (x >= RX0 + E && x <= RX1 - E && z <= RZ0 - E && z >= LINE + 0.7) return 0;                         // the range, up to the counter
  return null;
}

/** Which of these rooms a visitor's eye is in: 'range', 'hallway' or null. */
export function rangeZone(p) {
  if (p.y > 2.6) return null;                               // upstairs, on the gallery over the hallway
  if (p.x > RX0 && p.z < RZ0) return 'range';
  return rangeFloor(p.x, p.z) != null && p.z < ZG + 0.2 ? 'hallway' : null;
}

/** How far out of the hall's sound a visitor is: 0 in the hall, 1 from a few steps down the hallway on. */
export function rangeAway(p) {
  return rangeZone(p) ? THREE.MathUtils.clamp((ZG + 0.4 - p.z) / 3.2, 0, 1) : 0;
}

/**
 * Build the door, the hallway and the range. `c` carries the club's helpers and materials (see buildClub).
 * Returns { usables, update, attachEquip, attachHost }.
 */
export function buildRange(c) {
  const { hall, K, neon, mat, box, plane, flat, lamp, col, cfg, displays } = c;
  const steady = new THREE.MeshBasicMaterial({ color: col(K.led).multiplyScalar(neon ? 1.1 : 0.75) });      // these rooms keep still: nothing in them moves with the music
  const steadyB = new THREE.MeshBasicMaterial({ color: col(K.palette[1]).multiplyScalar(neon ? 1.0 : 0.7) });
  const dim = new THREE.MeshBasicMaterial({ color: col(K.led).multiplyScalar(neon ? 0.3 : 0.2) });
  const floorMat = new THREE.MeshStandardMaterial({ color: neon ? 0x0c0c26 : 0x1b1013, roughness: neon ? 0.78 : 0.92, metalness: neon ? 0.1 : 0 });   // matt: a glossy floor threw each lamp back as a glare
  const backstop = new THREE.MeshStandardMaterial({ color: neon ? 0x05050f : 0x0d0809, roughness: 0.96 });
  const font = 'Jost, "Helvetica Neue", Arial, sans-serif';

  // =================================================================================================
  // the hallway
  // =================================================================================================
  const CW = CX1 - CX0, CLEN = ZG - CZ1, cx = (CX0 + CX1) / 2, cz = (ZG + CZ1) / 2;
  flat(hall, mat.carpet, CW, CLEN, cx, 0.004, cz);
  plane(hall, mat.wallDark, CLEN, CH, CX0, CH / 2, cz).rotation.y = Math.PI / 2;
  {
    const w = wallWithDoor(CLEN, CH, mat.wallDark, SIDE.z1 - cz, SIDE.z0 - cz, -CH / 2 + 0.002, -CH / 2 + SIDE.h);
    w.position.set(CX1, CH / 2, cz); w.rotation.y = -Math.PI / 2;
    hall.add(w);
  }
  plane(hall, mat.wallDark, CW, CH, cx, CH / 2, CZ1);
  plane(hall, mat.ceiling, CW, CLEN, cx, CH, cz).rotation.x = Math.PI / 2;
  for (const x of [CX0 + 0.012, CX1 - 0.012]) box(hall, steady, 0.02, 0.025, CLEN - 0.5, x, 0.06, cz);
  for (let z = ZG - 1.2; z > CZ1; z -= 2.2) box(hall, steady, CW - 0.5, 0.02, 0.04, cx, CH - 0.012, z);
  lamp(cx, CH - 0.55, cz - 0.3, K.warm, 16, 8.5);
  // the door from the hall: a deep frame, edged with the hall's own light
  for (const s of [-1, 1]) {
    box(hall, mat.black, 0.2, GATE.h, 0.36, GATE.x + s * (GATE.w / 2 + 0.1), GATE.h / 2, ZG - 0.12);
    box(hall, mat.ledA, 0.03, GATE.h, 0.03, GATE.x + s * (GATE.w / 2 + 0.015), GATE.h / 2, ZG + 0.065);
  }
  box(hall, mat.black, GATE.w + 0.4, CH - GATE.h + 0.02, 0.36, GATE.x, (CH + GATE.h) / 2, ZG - 0.12);
  box(hall, mat.ledA, GATE.w, 0.03, 0.03, GATE.x, GATE.h + 0.015, ZG + 0.065);
  // and the one into the range
  {
    const mx = (CX1 + RX0) / 2, mz = (SIDE.z0 + SIDE.z1) / 2, t = RX0 - CX1;
    flat(hall, mat.carpet, t, SIDE.z0 - SIDE.z1, mx, 0.004, mz);
    for (const z of [SIDE.z0 + 0.03, SIDE.z1 - 0.03]) box(hall, mat.black, t + 0.06, SIDE.h + 0.06, 0.06, mx, SIDE.h / 2 + 0.03, z);
    box(hall, mat.black, t + 0.06, 0.06, SIDE.z0 - SIDE.z1, mx, SIDE.h + 0.03, mz);
    box(hall, steadyB, 0.03, 0.03, SIDE.z0 - SIDE.z1, CX1 - 0.02, SIDE.h + 0.09, mz);
  }

  // The sign over the door, on the hall's side: the room's name and the score to beat.
  const gateSign = canvasPlane(1536, 200, 2.3, 0.3);
  gateSign.mesh.position.set(GATE.x, GATE.h + 0.215, ZG + 0.068);
  hall.add(gateSign.mesh);
  function drawGateSign(top) {
    const { ctx, w, h } = gateSign;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#04040c'; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    const text = top ? `RANGE  ·  BEST ${top.score.toLocaleString('en-US')}  ${String(top.name).toUpperCase()}` : 'SHOOTING RANGE';
    let size = 120;
    do { ctx.font = `${K.signWeight} ${size}px ${neon ? K.signFont : font}`; size -= 4; } while (ctx.measureText(text).width > w * 0.92 && size > 30);
    ctx.textAlign = 'center';
    ctx.shadowColor = K.sign; ctx.shadowBlur = 26; ctx.fillStyle = K.sign;
    ctx.fillText(text, w / 2, h * 0.54); ctx.fillText(text, w / 2, h * 0.54);
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(text, w / 2, h * 0.54);
    gateSign.texture.needsUpdate = true;
  }

  // ---- the rack: every gun of the collection, to take from here as well as from its frame ----------
  const long = displays.filter((d) => /Rifle/.test(d.skin.category)), short = displays.filter((d) => d.skin.category === 'Pistol');
  const slots = [];
  const addSlot = (d, x, y, z, facing, w, h) => {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;      // its own +z is out of the wall
    hall.add(g);
    box(g, mat.black, w + 0.12, h + 0.3, 0.03, 0, -0.06, 0);
    box(g, steady, w + 0.12, 0.015, 0.02, 0, -h / 2 - 0.2, 0.02);
    const label = canvasPlane(768, 72, Math.min(w, 1.1), Math.min(w, 1.1) * 72 / 768);
    label.ctx.textAlign = 'center'; label.ctx.textBaseline = 'middle';
    let size = 44;
    do { label.ctx.font = `500 ${size}px ${font}`; size -= 2; } while (label.ctx.measureText(d.skin.name).width > 730 && size > 18);
    label.ctx.fillStyle = '#e9e6df'; label.ctx.fillText(d.skin.name, 384, 38);
    label.texture.needsUpdate = true;
    label.mesh.material.transparent = true; label.mesh.material.depthWrite = false;
    label.mesh.position.set(0, -h / 2 - 0.1, 0.02);
    g.add(label.mesh);
    slots.push({ d, g, w, h, copy: null, x, y, z, facing });
  };
  {
    const cols = Math.max(1, Math.ceil(long.length / 2)), z0 = ZG - 1.05, z1 = CZ1 + 1.05;
    long.forEach((d, i) => addSlot(d, CX0 + 0.03, i < cols ? 2.1 : 1.15, cols > 1 ? z0 + ((z1 - z0) * (i % cols)) / (cols - 1) : (z0 + z1) / 2, 1, 1.4, 0.46));
    const a = ZG - 0.75, b = SIDE.z0 + 0.75;
    short.forEach((d, i) => addSlot(d, CX1 - 0.03, 1.5, short.length > 1 ? a + ((b - a) * i) / (short.length - 1) : (a + b) / 2, -1, 0.62, 0.44));
  }
  // The crosshair chooser, on the hallway's end wall: the one in use, drawn large, and E to change it.
  const sight = canvasPlane(640, 480, 1.2, 0.9);
  sight.mesh.position.set(cx, 1.6, CZ1 + 0.035);
  hall.add(sight.mesh);
  box(hall, mat.black, 1.32, 1.02, 0.04, cx, 1.6, CZ1 + 0.012);
  for (const s of [-1, 1]) box(hall, steadyB, 1.32, 0.02, 0.02, cx, 1.6 + s * 0.52, CZ1 + 0.04);
  let xhair = null;
  function drawSight() {
    const { ctx, w, h } = sight;
    ctx.fillStyle = '#04051a'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = K.sign; ctx.font = `700 46px Orbitron, ${font}`;
    ctx.fillText('CROSSHAIR', w / 2, 52);
    const g = ctx.createLinearGradient(170, 100, 470, 380);
    g.addColorStop(0, '#2b3340'); g.addColorStop(0.55, '#6d6a5f'); g.addColorStop(1, '#1d2026');
    ctx.fillStyle = g; ctx.fillRect(170, 96, 300, 290);
    if (xhair) {
      // drawn on a canvas of its own, enlarged, then set into the panel
      const tile = document.createElement('canvas');
      tile.width = tile.height = 300;
      const c = xhair.current, reach = c.size + Math.max(0, 4 + c.gap) + c.thickness;      // how far it runs from its middle, in the game's units
      drawCrosshair(tile.getContext('2d'), 300, 300, c, Math.max(3, Math.min(12, 120 / reach)));      // a small one is shown larger, a wide one still fits
      ctx.drawImage(tile, 170, 91);
    }
    ctx.fillStyle = '#e9e6df'; ctx.font = `500 30px ${font}`;
    ctx.fillText(xhair ? 'PRESS E TO CHANGE' : 'SHOWN ONCE A WEAPON CAN BE CARRIED', w / 2, 432);
    sight.texture.needsUpdate = true;
  }
  drawSight();

  const measure = new THREE.Group(), bounds = new THREE.Box3(), size = new THREE.Vector3(), mid = new THREE.Vector3();
  /** A slot's own copy of its gun, once that gun's model has arrived in the hall: the same model, laid flat against the board. */
  function fillSlot(s) {
    const copy = s.d.model.holder.clone(true);
    copy.position.set(0, 0, 0); copy.rotation.set(0, 0, 0); copy.scale.setScalar(1);
    copy.visible = true;
    measure.add(copy); measure.updateMatrixWorld(true);
    bounds.setFromObject(copy); bounds.getSize(size); bounds.getCenter(mid);
    const k = Math.min(s.w / size.x, s.h / size.y);
    copy.scale.setScalar(k);
    copy.position.set(-mid.x * k, -mid.y * k, 0.05 + (size.z / 2 - mid.z) * k);
    copy.userData.isExhibitModel = true;        // takes no bullet marks
    s.g.add(copy);
    s.copy = copy;
  }

  // =================================================================================================
  // the range
  // =================================================================================================
  const RW = RX1 - RX0, RL = RZ0 - RZ1, rx = (RX0 + RX1) / 2, rz = (RZ0 + RZ1) / 2;
  flat(hall, floorMat, RW, RL, rx, 0.003, rz);
  plane(hall, mat.wallDark, RW, RH, rx, RH / 2, RZ0).rotation.y = Math.PI;
  plane(hall, backstop, RW, RH, rx, RH / 2, RZ1);
  plane(hall, mat.wallDark, RL, RH, RX1, RH / 2, rz).rotation.y = -Math.PI / 2;
  {
    const w = wallWithDoor(RL, RH, mat.wallDark, -(SIDE.z0 - rz), -(SIDE.z1 - rz), -RH / 2 + 0.002, -RH / 2 + SIDE.h);
    w.position.set(RX0, RH / 2, rz); w.rotation.y = Math.PI / 2;
    hall.add(w);
  }
  plane(hall, mat.ceiling, RW, RL, rx, RH, rz).rotation.x = Math.PI / 2;
  // the counter, with a low screen between each pair of lanes
  box(hall, mat.black, RW - 0.06, 1.0, 0.5, rx, 0.5, LINE);
  box(hall, backstop, RW - 0.06, 0.03, 0.56, rx, 1.015, LINE);            // a matt top: polished metal here threw the lamp overhead back as a white glare
  box(hall, steady, RW - 0.06, 0.025, 0.02, rx, 0.9, LINE + 0.262);
  for (let i = 1; i < 5; i++) {
    const x = RX0 + i * LANE;
    box(hall, mat.black, 0.04, 0.5, 0.5, x, 1.28, LINE);
    box(hall, dim, 0.03, 0.012, LINE - RZ1 - 0.6, x, 0.01, (LINE + RZ1) / 2);        // lane lines, down to the backstop
  }
  // light: two lines along the ceiling, a warm lamp over the counter and two down the lanes
  for (const x of [RX0 + 3, RX1 - 3]) box(hall, steady, 0.04, 0.02, RL - 1.5, x, RH - 0.012, rz);
  for (let z = LINE - 4; z > RZ1 + 1; z -= 6) box(hall, steadyB, RW - 1, 0.02, 0.04, rx, RH - 0.012, z);
  lamp(rx, RH - 0.7, RZ0 - 1.4, K.warm, 22, 9);
  lamp(rx, RH - 0.5, -42.5, K.warm, 52, 22);
  lamp(rx, RH - 0.5, -54, K.warm, 52, 22);
  // cover for the bots, and how far each row is, written on the right wall
  for (const p of POSTS) {
    box(hall, mat.black, COVER.w, COVER.h, COVER.d, p.x, COVER.h / 2, p.z);
    box(hall, p.row === 'mid' ? steadyB : steady, COVER.w, 0.03, 0.03, p.x, COVER.h + 0.015, p.z + COVER.d / 2 - 0.015);
    box(hall, p.row === 'mid' ? steadyB : steady, 0.03, COVER.h, 0.03, p.x - COVER.w / 2 + 0.015, COVER.h / 2, p.z + COVER.d / 2 + 0.005);
    box(hall, p.row === 'mid' ? steadyB : steady, 0.03, COVER.h, 0.03, p.x + COVER.w / 2 - 0.015, COVER.h / 2, p.z + COVER.d / 2 + 0.005);
  }
  for (const [z, text] of [[-43, '9 M'], [-50, '16 M'], [-58, '24 M']]) {
    c.sign(hall, text, 1.3, 0.43, RX1 - 0.04, 3.3, z, { w: 768, h: 256 }).rotation.y = -Math.PI / 2;
  }
  // chevrons on the backstop, so the far wall reads as the end of the lanes
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(RX0 + (i + 0.5) * LANE, 3.5, RZ1 + 0.03); g.rotation.z = s * 0.6;
    hall.add(g);
    box(g, dim, 0.5, 0.035, 0.02, s * 0.2, 0, 0);
  }

  // The console on the counter: what to do, and the clock while a round runs.
  const consoleX = RX0 + 1.2;                  // at the end of the counter by the door, out of every lane's line of fire
  box(hall, mat.black, 0.9, 0.22, 0.34, consoleX, 1.14, LINE + 0.05);
  const screen = canvasPlane(768, 384, 0.8, 0.4);
  screen.mesh.position.set(consoleX, 1.34, LINE + 0.12);
  screen.mesh.rotation.x = -0.55;
  hall.add(screen.mesh);
  function drawConsole(view) {
    const { ctx, w, h } = screen;
    ctx.fillStyle = '#04051a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = K.sign; ctx.lineWidth = 6; ctx.strokeRect(9, 9, w - 18, h - 18);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = K.sign; ctx.font = `700 ${view.big.length > 9 ? 84 : 124}px Orbitron, ${font}`;
    ctx.fillText(view.big, w / 2, h * 0.42);
    ctx.fillStyle = '#e9e6df'; ctx.font = `500 40px ${font}`;
    ctx.fillText(view.small, w / 2, h * 0.78);
    screen.texture.needsUpdate = true;
  }

  // The leaderboard, on the left wall just past the counter and turned a little toward it.
  const board = canvasPlane(1280, 720, 5.2, 2.925);
  {
    const g = new THREE.Group();
    g.position.set(RX0 + 0.75, 2.45, LINE - 3.9); g.rotation.y = Math.PI / 2 - 0.5;
    hall.add(g);
    box(g, mat.black, 5.4, 3.12, 0.08, 0, 0, -0.05);
    for (const s of [-1, 1]) box(g, steady, 5.4, 0.03, 0.03, 0, s * 1.575, 0);
    g.add(board.mesh);
  }
  const faces = new Map();        // avatar pictures by address, once they have arrived
  function face(url) {
    if (!url) return null;
    if (!faces.has(url)) {
      const img = new Image();
      img.crossOrigin = 'anonymous';           // or the picture could not be drawn onto the board
      img.onload = () => { faces.set(url, img); boardDirty = true; };
      img.onerror = () => faces.set(url, null);
      faces.set(url, undefined);
      img.src = url;
    }
    return faces.get(url) || null;
  }
  let boardRows = [], boardNote = '', boardDirty = true;
  function drawBoard() {
    const { ctx, w, h } = board;
    ctx.fillStyle = '#04051a'; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = K.sign; ctx.font = `700 58px Orbitron, ${font}`;
    ctx.fillText('LEADERBOARD', 48, 62);
    // beside it, what the board is: the month, the prize and the days left on the monthly one. Sized to fit.
    const room = w - 96 - ctx.measureText('LEADERBOARD').width - 44;
    ctx.textAlign = 'right'; ctx.fillStyle = /WINS/.test(boardNote) ? '#ffcf5a' : 'rgba(233,230,223,.6)';
    let noteSize = 28;
    do { noteSize -= 1; ctx.font = `600 ${noteSize}px ${font}`; } while (ctx.measureText(boardNote).width > room && noteSize > 15);
    ctx.fillText(boardNote, w - 48, 66);
    ctx.fillStyle = K.sign; ctx.fillRect(48, 104, w - 96, 3);
    if (!boardRows.length) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#e9e6df'; ctx.font = `500 44px ${font}`;
      ctx.fillText('No rounds yet. Yours could be the first.', w / 2, h * 0.55);
    }
    const two = boardRows.length > 5, colW = two ? (w - 96 - 40) / 2 : w - 96, rowH = two ? 112 : 112;
    boardRows.slice(0, 10).forEach((r, i) => {
      const x = 48 + (two && i >= 5 ? colW + 40 : 0), y = 172 + (i % 5) * rowH;
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(233,230,223,.55)'; ctx.font = `600 36px ${font}`;
      ctx.fillText(String(r.rank ?? i + 1), x, y);
      const img = face(r.avatar), ax = x + 58, ay = y - 38;
      ctx.save();
      ctx.beginPath(); ctx.arc(ax + 38, ay + 38, 38, 0, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = '#1a1c3f'; ctx.fill();
      if (img) { ctx.clip(); try { ctx.drawImage(img, ax, ay, 76, 76); } catch { /* a picture that cannot be drawn leaves the plain disc */ } } else {
        ctx.fillStyle = K.sign; ctx.font = `600 30px ${font}`; ctx.textAlign = 'center';
        ctx.fillText(String(r.name || '?').slice(0, 2).toUpperCase(), ax + 38, ay + 40);
      }
      ctx.restore();
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
      let s = 38;
      do { ctx.font = `600 ${s}px ${font}`; s -= 2; } while (ctx.measureText(r.name).width > colW - 340 && s > 20);
      ctx.fillText(r.name, x + 152, y - 14);
      ctx.fillStyle = 'rgba(233,230,223,.55)'; ctx.font = `400 24px ${font}`;
      let gun = String(r.weapon || '');
      while (gun && ctx.measureText(gun).width > colW - 340) gun = gun.slice(0, -2);
      ctx.fillText(gun, x + 152, y + 24);
      ctx.textAlign = 'right'; ctx.fillStyle = K.sign; ctx.font = `700 42px Orbitron, ${font}`;
      ctx.fillText(Number(r.score).toLocaleString('en-US'), x + colW, y);
    });
    board.texture.needsUpdate = true;
    boardDirty = false;
  }

  // =================================================================================================
  // the game, and what the visitor can press E on
  // =================================================================================================
  let equip = null;
  const game = createRangeGame({
    parent: hall, posts: POSTS, cover: COVER, line: LINE, walls: { x0: RX0, x1: RX1 }, config: cfg.range || {}, accent: K.sign,
    onConsole: drawConsole,
    onBoard(rows, note) { boardRows = rows; boardNote = note; boardDirty = true; drawGateSign(rows[0] && rows[0].score > 0 ? rows[0] : null); },
  });
  drawGateSign(null);
  drawBoard();

  const usables = slots.map((s) => ({
    center: new THREE.Vector3(s.x + s.facing * 0.1, s.y, s.z), normal: new THREE.Vector3(s.facing, 0, 0), radius: 2.3, floor: 0, aim: 0.93, color: s.d.skin.rarityColor,
    where: (p) => rangeZone(p) === 'hallway',
    get label() {
      if (!equip) return 'Guns cannot be carried yet';
      if (!s.d.model) return 'Its model is still loading';
      return equip.held && equip.held.display === s.d ? 'Hang it back' : `Take  ·  ${s.d.skin.name}`;
    },
    act() { if (equip && s.d.model) { if (equip.held && equip.held.display === s.d) equip.putBack(); else equip.take(s.d); } },
  }));
  usables.push({
    center: new THREE.Vector3(cx, 1.6, CZ1 + 0.06), normal: new THREE.Vector3(0, 0, 1), radius: 3.2, floor: 0, aim: 0.9, color: K.sign,
    where: (p) => rangeZone(p) === 'hallway',
    get label() { return xhair ? 'Choose your crosshair' : 'Crosshairs come with carrying a weapon'; },
    open(done) { if (xhair) xhair.open(done); else done(); },
    close() { xhair?.close(); },
  });
  usables.push({
    center: new THREE.Vector3(consoleX, 1.3, LINE + 0.1), normal: new THREE.Vector3(0, 0, 1), radius: 3.4, floor: 0, aim: 0.86, color: K.sign,
    where: (p) => rangeZone(p) === 'range',
    get label() { return game.running ? 'Stop the round' : 'Start a round  ·  3 minutes'; },
    act() { if (game.running) game.stop('Round stopped'); else game.start(); },
  });

  let zone = null;
  function update(t, dt, camera) {
    const now = rangeZone(camera.position);
    if (now !== zone) { zone = now; game.enter(zone); }
    if (zone) {
      for (const s of slots) {
        if (!s.copy && s.d.model) fillSlot(s);
        if (s.copy) s.copy.visible = s.d.model.holder.visible;       // a gun in the visitor's hands has left the rack too
      }
    }
    game.update(dt, camera, zone);
    if (boardDirty && zone === 'range') drawBoard();
  }

  return {
    usables, update, game,
    /** The equip system, once it is up: the rack hands guns out through it and the game hears every shot from it. */
    attachEquip(e) {
      equip = e; game.attachEquip(e);
      e.endless = () => zone === 'range';      // in the range itself rounds are not counted: the owner asked for no reloading there
      xhair = e.crosshair || null; if (xhair) { xhair.onChange(drawSight); drawSight(); }
    },
    /** The page's own way of opening a panel that needs the mouse (see main.js). */
    attachHost(host) { game.attachHost(host); },
  };
}

/** A flat panel whose picture is drawn by hand: { mesh, texture, ctx, w, h }. */
function canvasPlane(w, h, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, fog: false }));
  return { mesh, texture, ctx: canvas.getContext('2d'), w, h };
}
