// The two rooms off the top of the stairs. Through the left wall: the stream room, a small
// cinema whose screen shows the owner's Twitch channel. Through the right: a room still being built.
import * as THREE from 'three';
import { DIM as D } from './looks.js';
import { StreamWall } from './stream.js';
import { buildSubWall } from './subwall.js';
import { buildCsfit } from './csfit.js';
import { onAirSign, streamSlate, chatCard, hazardStripes, siteBoard, concrete, grille } from './textures.js';

const { HW, YB } = D;
/** The doorway in each side wall: where along the hall, how wide, how high. */
export const DOOR = { z: -27.2, w: 2.0, h: 2.6 };

// ---- the stream room, in metres ---------------------------------------------------------------
const ZC = DOOR.z;                 // the room is centred on its doorway
const COR = 2.5;                   // the corridor that keeps the club's light off the screen
const X0 = -(HW + COR);            // back wall
const DEPTH = 13.5, X1 = X0 - DEPTH;   // screen wall
const HALF = 7.8;                  // half the room's width
const XT = X0 - 2.0;               // rear edge of the back row; the landing is behind it
const TIER = 1.4, DROP = 0.3, ROWS = 4;
const XF = XT - ROWS * TIER;       // where the floor in front of the screen begins
const YF = YB - DROP * (ROWS + 1); // and its height
const CEIL = 8.3;
const SCREEN = { w: 9.6, h: 5.4 }, CHAT_W = 3.2, GAP = 0.4;
const GROUP_W = SCREEN.w + GAP + CHAT_W;      // the picture and the chat, side by side
const WALL_Y = YF + 0.75 + SCREEN.h / 2;      // their centre height
const XS = X1 + 0.12;                         // the face of the screen
const SEATS = 8, PITCH = 0.62, AISLE = 1.7;
const E = 0.4;                                // how far a visitor keeps from these walls

/** Height of the floor in the stream room and its corridor, or null where there is none. */
export function annexFloor(x, z) {
  const dz = Math.abs(z - ZC);
  // The corridor. It starts a good step inside the hall: the hall holds a visitor 0.45 m off its
  // walls, and a doorway that began any nearer the wall than that could never be reached.
  if (dz <= DOOR.w / 2 - 0.32 && x <= -HW + 1.0 && x >= X0 - E - 0.05) return YB;
  if (x > X0 - E || x < X1 + 0.7 || dz > HALF - E) return null;
  if (x > XT) return YB;                                                           // the landing behind the seats
  if (x <= XF) return YF;                                                          // in front of the screen
  return YB - DROP * (Math.floor((XT - x) / TIER) + 1);                            // a row
}

/**
 * One of the hall's long walls with a doorway cut through it. The wall is `len` by `height`;
 * the doorway runs from u0 to u1 along it and v0 to v1 up it, measured from the wall's centre.
 */
export function wallWithDoor(len, height, material, u0, u1, v0, v1) {
  const s = new THREE.Shape();
  s.moveTo(-len / 2, -height / 2); s.lineTo(len / 2, -height / 2); s.lineTo(len / 2, height / 2); s.lineTo(-len / 2, height / 2); s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(u0, v0); hole.lineTo(u0, v1); hole.lineTo(u1, v1); hole.lineTo(u1, v0); hole.closePath();
  s.holes.push(hole);
  const geo = new THREE.ShapeGeometry(s);
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / len + 0.5, pos.getY(i) / height + 0.5);   // as a plain wall would be papered
  return new THREE.Mesh(geo, material);
}

/**
 * Build both rooms. `c` carries the club's own helpers and materials (see buildClub).
 * Returns { usables, update, stream }.
 */
export function buildRooms(c) {
  const { hall, K, neon, mat, tex, box, plane, flat, sign, solid, lamp, additive, col, drape, drapeMat, cfg } = c;
  const yd = YB + DOOR.h;                                  // top of the doorways
  const aisleLight = new THREE.MeshBasicMaterial({ color: col(K.led).multiplyScalar(neon ? 1.1 : 0.75) });   // steady: nothing in here moves with the music
  const frame = (sx, material) => {
    const x = sx * (HW - 0.06);
    for (const s of [-1, 1]) box(hall, material, 0.16, DOOR.h + 0.12, 0.12, x, YB + DOOR.h / 2 + 0.06, ZC + s * (DOOR.w / 2 + 0.06));
    box(hall, material, 0.16, 0.12, DOOR.w + 0.24, x, yd + 0.06, ZC);
  };

  // =================================================================================================
  // the stream room
  // =================================================================================================
  frame(-1, mat.metal);
  {
    // corridor
    const cx = (X0 - HW) / 2;
    flat(hall, mat.carpet, COR, DOOR.w, cx, YB + 0.003, ZC);
    plane(hall, mat.wallDark, COR, DOOR.h, cx, YB + DOOR.h / 2, ZC - DOOR.w / 2);
    plane(hall, mat.wallDark, COR, DOOR.h, cx, YB + DOOR.h / 2, ZC + DOOR.w / 2).rotation.y = Math.PI;
    plane(hall, mat.ceiling, COR, DOOR.w, cx, yd, ZC).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) box(hall, aisleLight, COR - 0.3, 0.025, 0.02, cx, YB + 0.06, ZC + s * (DOOR.w / 2 - 0.012));
  }
  {
    // shell
    const zl = ZC + HALF, zr = ZC - HALF, mx = (X0 + X1) / 2, roomH = CEIL - YF, my = (CEIL + YF) / 2;
    plane(hall, mat.wallDark, DEPTH, roomH, mx, my, zr);
    plane(hall, mat.wallDark, DEPTH, roomH, mx, my, zl).rotation.y = Math.PI;
    plane(hall, mat.black, HALF * 2, roomH, X1, my, ZC).rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) plane(hall, mat.wallDark, HALF - DOOR.w / 2, CEIL - YB, X0, (CEIL + YB) / 2, ZC + s * (DOOR.w / 2 + (HALF - DOOR.w / 2) / 2)).rotation.y = -Math.PI / 2;
    plane(hall, mat.wallDark, DOOR.w, CEIL - yd, X0, (CEIL + yd) / 2, ZC).rotation.y = -Math.PI / 2;
    plane(hall, mat.ceiling, DEPTH, HALF * 2, mx, CEIL, ZC).rotation.x = Math.PI / 2;
    sign(hall, 'EXIT', 0.84, 0.28, X0 - 0.03, yd + 0.3, ZC, { color: '#57ff9a', w: 512, h: 170, font: 'Orbitron, Bahnschrift, "Arial Narrow", sans-serif', weight: 700 }).rotation.y = -Math.PI / 2;

    // floor: the landing, four rows each a step lower, and the flat in front of the screen
    box(hall, mat.carpet, X0 - XT, 0.3, HALF * 2, (X0 + XT) / 2, YB - 0.15, ZC);
    for (let i = 0; i < ROWS; i++) box(hall, mat.carpet, TIER, 0.3, HALF * 2, XT - TIER * (i + 0.5), YB - DROP * (i + 1) - 0.15, ZC);
    box(hall, mat.carpet, XF - X1, 0.3, HALF * 2, (XF + X1) / 2, YF - 0.15, ZC);
    // a line of light on every edge, and a half step in each aisle
    const aisles = [[ZC, AISLE], [zl - (HALF - AISLE / 2 - SEATS * PITCH) / 2, HALF - AISLE / 2 - SEATS * PITCH], [zr + (HALF - AISLE / 2 - SEATS * PITCH) / 2, HALF - AISLE / 2 - SEATS * PITCH]];
    for (let i = 0; i <= ROWS; i++) {
      const xr = XT - TIER * i, top = YB - DROP * i;
      box(hall, aisleLight, 0.03, 0.02, HALF * 2 - 0.1, xr + 0.02, top + 0.011, ZC);
      for (const [az, aw] of aisles) {
        box(hall, mat.carpet, 0.5, DROP / 2, aw, xr - 0.25, top - DROP * 0.75, az);
        box(hall, aisleLight, 0.03, 0.02, aw - 0.1, xr - 0.48, top - DROP / 2 + 0.011, az);
      }
    }
    // low lights along both walls: only where the walls are bare (the subscribers' plaques light them otherwise, see subwall.js)
    for (let i = 0; cfg.subs === false && i <= ROWS + 2; i++) {
      const x = X0 - 1.2 - i * 1.9, y = annexFloor(x, ZC + 3) + 0.5;
      for (const z of [zl - 0.03, zr + 0.03]) {
        if (neon) box(hall, aisleLight, 0.04, 1.5, 0.03, x, y + 1.3, z);
        else { box(hall, mat.metal, 0.12, 0.3, 0.06, x, y + 1.6, z); box(hall, mat.lamp, 0.09, 0.14, 0.08, x, y + 1.72, z); }
      }
    }
  }

  // the side walls: the channel's subscribers by tier, and the bits leaderboard ("subs": false in data/club.json leaves the walls bare)
  const subwall = cfg.subs === false ? null : buildSubWall(c, { X0, X1, XT, XF, YB, YF, ZC, HALF, TIER, DROP, ROWS, CEIL, HW });

  // seats: two blocks of eight either side of the centre aisle, in four rows
  const seats = [];
  for (let i = 0; i < ROWS; i++) {
    const xr = XT - TIER * i, h = YB - DROP * (i + 1);
    for (const side of [1, -1]) {
      const z0 = ZC + side * (AISLE / 2 + PITCH / 2);
      for (let n = 0; n < SEATS; n++) {
        const z = z0 + side * n * PITCH;
        box(hall, mat.seat, 0.12, 0.64, PITCH - 0.08, xr - 0.16, h + 0.74, z);    // back
        box(hall, mat.seat, 0.46, 0.1, PITCH - 0.1, xr - 0.47, h + 0.45, z);      // cushion
        box(hall, mat.black, 0.34, 0.4, PITCH - 0.2, xr - 0.42, h + 0.2, z);      // base
        seats.push({ x: xr, h, z });
      }
      for (let n = 0; n <= SEATS; n++) box(hall, mat.black, 0.5, 0.07, 0.07, xr - 0.42, h + 0.62, z0 + side * (n - 0.5) * PITCH);
      // the backs stop a visitor on this row and on the one behind it; the aisles are the way through
      solid(xr - 0.2, z0 + side * (SEATS - 1) * PITCH / 2, 0.2, SEATS * PITCH / 2, h - 0.05, h + 0.35);
    }
  }

  // the screen wall: the picture on the left, the chat on its right, as on the channel's own page
  const sc = cfg.stream || {};
  // ?stream=name in the address shows another channel instead: a way to see the room at work while your own is offline
  const asked = new URLSearchParams(location.search).get('stream');
  const stream = new StreamWall({ channel: asked && /^\w{2,25}$/.test(asked) ? asked : sc.channel, chat: sc.chat !== false });
  const slate = streamSlate();
  const screenMat = new THREE.MeshBasicMaterial({ map: slate.texture, fog: false });
  const chatMat = new THREE.MeshBasicMaterial({ map: chatCard(stream.channel || 'your-channel'), fog: false });
  const wall = new THREE.Group();          // its own left and right are the viewer's; z comes out into the room
  wall.position.set(X1 + 0.04, 0, ZC);
  wall.rotation.y = Math.PI / 2;
  hall.add(wall);
  const sx0 = -GROUP_W / 2 + SCREEN.w / 2, cx0 = GROUP_W / 2 - CHAT_W / 2;
  const glowMat = additive(tex.glow, col(K.palette[neon ? 0 : 1]), 0.2);
  {
    plane(wall, glowMat, SCREEN.w * 1.5, SCREEN.h * 1.8, sx0, WALL_Y, 0.02);
    box(wall, mat.black, GROUP_W + 0.5, SCREEN.h + 0.5, 0.05, 0, WALL_Y, 0.03);
    plane(wall, screenMat, SCREEN.w, SCREEN.h, sx0, WALL_Y, 0.08);
    if (stream.withChat) plane(wall, chatMat, CHAT_W, SCREEN.h, cx0, WALL_Y, 0.08);
    const edge = neon ? mat.ledA : mat.metal, t = 0.05;
    for (const [x, w] of stream.withChat ? [[sx0, SCREEN.w], [cx0, CHAT_W]] : [[sx0, SCREEN.w]]) {
      for (const s of [1, -1]) { box(wall, edge, w + t * 2, t, t, x, WALL_Y + s * (SCREEN.h / 2 + t / 2), 0.1); box(wall, edge, t, SCREEN.h, t, x + s * (w / 2 + t / 2), WALL_Y, 0.1); }
    }
    // the speaker under the picture
    const g = grille(neon); g.repeat.set(26, 2);
    box(wall, mat.black, 5.2, 0.44, 0.4, sx0, WALL_Y - SCREEN.h / 2 - 0.4, 0.24);
    plane(wall, new THREE.MeshStandardMaterial({ map: g, roughness: 0.8 }), 5.1, 0.36, sx0, WALL_Y - SCREEN.h / 2 - 0.4, 0.445);
    const side = HALF - GROUP_W / 2;       // the strip of wall either side of the group
    if (neon) {
      for (const s of [-1, 1]) for (const k of [0.3, 0.6]) box(wall, s < 0 ? mat.ledA : mat.ledB, 0.035, SCREEN.h + 0.6, 0.035, s * (GROUP_W / 2 + side * k), WALL_Y, 0.06);
    } else {
      // velvet curtains drawn back either side, under a brass rail
      const dw = side - 0.2, dh = SCREEN.h + 1.1;
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(drape(dw, dh, s * dw * 0.5), drapeMat);
        m.position.set(s * (GROUP_W / 2 + 0.12 + dw / 2), WALL_Y + 0.1, 0.22);
        wall.add(m);
      }
      box(wall, mat.metal, HALF * 2 - 0.2, 0.06, 0.06, 0, WALL_Y + 0.1 + (SCREEN.h + 1.1) / 2 + 0.03, 0.22);
    }
  }
  const screenLight = lamp(X1 + 3.4, WALL_Y, ZC + GROUP_W / 2 - SCREEN.w / 2, 0xa9baff, 8, 12);
  const houseLight = lamp(X0 - 3.6, CEIL - 0.7, ZC, K.warm, 22, 10);

  // over the door, on the hall's side: the room's name, and a studio light that is lit while the channel is live
  sign(hall, neon ? 'STREAM ROOM' : 'Stream Room', 2.8, 0.7, -HW + 0.05, yd + 1.12, ZC, { w: 1536, h: 384 }).rotation.y = Math.PI / 2;
  const onAirMat = new THREE.MeshBasicMaterial({ map: onAirSign(), fog: false });
  const onAirGlow = additive(tex.glow, col(0xff2233), 0);
  plane(hall, onAirGlow, 3.4, 1.7, -HW + 0.03, yd + 0.42, ZC).rotation.y = Math.PI / 2;
  box(hall, mat.black, 0.1, 0.48, 1.32, -HW + 0.05, yd + 0.42, ZC);
  plane(hall, onAirMat, 1.2, 0.4, -HW + 0.104, yd + 0.42, ZC).rotation.y = Math.PI / 2;

  const redraw = () => slate.draw({
    channel: stream.channel || 'No channel set', status: stream.status, frame: stream.frame, accent: K.sign,
    hint: !stream.channel ? 'ADD YOUR CHANNEL IN DATA/CLUB.JSON'
      : stream.failed ? 'TWITCH COULD NOT BE REACHED FROM HERE'
        : stream.status === 'live' ? 'PRESS E TO WATCH LIVE'
          : stream.status === 'offline' ? 'THE ON AIR LIGHT COMES ON WHEN THE STREAM IS LIVE' : '',
  });
  stream.addEventListener('change', redraw);
  redraw();

  // ---- sitting down and watching ---------------------------------------------------------------------
  // The view turns square to the wall and stays there: Twitch will only play in a player that
  // is flat on the page (see stream.js), so the picture cannot follow a turning head.
  const square = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'YXZ'));
  let watching = null, steady = 0, lastKey = '';
  const watchFrom = (seat) => ({
    /** Returns where the eye goes, which way it faces, and where the visitor stands up to afterwards. */
    begin(player, hooks) {
      const pos = seat ? new THREE.Vector3(seat.x - 0.42, seat.h + 1.18, seat.z)
        : new THREE.Vector3(Math.max(player.pos.x, X1 + 6.5), player.ground + 1.65, player.pos.z);
      watching = { pos };
      steady = 0; lastKey = '';
      stream.setWatching(true, hooks);
      return { pos, quat: square, stand: seat ? { x: seat.x - 0.9, z: seat.z, ground: seat.h } : null };   // on their feet in front of the seat
    },
    /** The lens for a page w by h: the picture and chat fill it, centred, with room for a line of help underneath. */
    view(w, h) {
      const e = watching.pos, d = e.x - XS;
      const padX = 20, padTop = 16, bar = 68;
      // Twitch will not play in a picture smaller than 400 by 300, so the picture is never drawn
      // smaller than that. Where the page is too small to hold the chat beside it at that size,
      // the picture has the page to itself and the chat is off to its right, out of view.
      const least = Math.max(400 / SCREEN.w, 300 / SCREEN.h) * 1.02;
      const fitTo = (wide) => Math.min((w - padX * 2) / wide, (h - padTop - bar) / SCREEN.h);
      const both = stream.withChat && fitTo(GROUP_W) >= least;
      watching.chat = both;
      const fit = Math.max(least, fitTo(both ? GROUP_W : SCREEN.w));
      const mid = both ? ZC : ZC + GROUP_W / 2 - SCREEN.w / 2;
      const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(h / (2 * fit * d))), 10, 110);
      const s = h / (2 * d * Math.tan(THREE.MathUtils.degToRad(fov / 2)));     // pixels to a metre, on the wall
      const top = Math.max(0, Math.min(padTop, (h - bar - s * SCREEN.h) / 2));  // on a short page the picture sits against the top
      return { fov, ox: s * (e.z - mid), oy: h / 2 - s * (WALL_Y - e.y) - (top + Math.max(s * SCREEN.h, h - top - bar) / 2) };
    },
    key(code) {
      if (code === 'ArrowUp') stream.nudgeVolume(0.1);
      else if (code === 'ArrowDown') stream.nudgeVolume(-0.1);
    },
    pointer(locked) { stream.setFree(!locked); },
    end() { watching = null; stream.setWatching(false); },
  });
  const usables = seats.map((s) => ({
    center: new THREE.Vector3(s.x - 0.3, s.h + 0.95, s.z), normal: new THREE.Vector3(-1, 0, 0), radius: 2.3, floor: s.h,
    label: 'Sit down', color: K.sign, anySide: true, aim: 0.82, rank: 1, watch: watchFrom(s),
  }));
  usables.push({
    center: new THREE.Vector3(XS, WALL_Y, ZC + GROUP_W / 2 - SCREEN.w / 2), normal: new THREE.Vector3(1, 0, 0), radius: 15.5,
    get label() { return stream.status === 'live' ? 'Watch the stream' : stream.status === 'offline' ? 'Stream is offline  ·  open the chat' : 'Watch the stream'; },
    color: K.sign, aim: 0.8, where: (p) => p.x < X0 - 0.3, watch: watchFrom(null),
  });

  // =================================================================================================
  // the room that is not finished: CSFIT, a gym taking shape behind the tape
  // =================================================================================================
  // Here: the bare room, the tape and barrier across its doorway, the paint and the cones. What
  // stands in it (the gym so far, the builders' things, the three at work) is js/club/csfit.js.
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.45, metalness: 0.85 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.86 });
  const board = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.9 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8641b, roughness: 0.6 });
  const stripes = hazardStripes();
  const striped = (rx, ry) => { const t = stripes.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return new THREE.MeshBasicMaterial({ map: t, color: 0xcfcfcf, side: THREE.DoubleSide }); };
  const conc = concrete();
  const poured = (w, h) => { const t = conc.clone(); t.repeat.set(w / 3, h / 3); t.needsUpdate = true; return new THREE.MeshStandardMaterial({ map: t, color: 0xa3a29d, roughness: 0.97 }); };
  const RX = HW + 9.5, RH = 4.3, RW = 5.2;      // far wall, height, half width
  frame(1, timber);
  {
    const mx = (HW + RX) / 2, len = RX - HW;
    flat(hall, poured(len, RW * 2), len, RW * 2, mx, YB + 0.002, ZC);
    plane(hall, poured(RW * 2, RH), RW * 2, RH, RX, YB + RH / 2, ZC).rotation.y = -Math.PI / 2;
    plane(hall, poured(len, RH), len, RH, mx, YB + RH / 2, ZC - RW);
    plane(hall, poured(len, RH), len, RH, mx, YB + RH / 2, ZC + RW).rotation.y = Math.PI;
    plane(hall, mat.ceiling, len, RW * 2, mx, YB + RH, ZC).rotation.x = Math.PI / 2;
    for (let z = ZC - RW + 0.6; z < ZC + RW; z += 1.15) box(hall, timber, len - 0.1, 0.22, 0.07, mx, YB + RH - 0.11, z);     // bare joists

    // across the doorway: hazard tape, and a barrier a step inside
    for (const a of [0.915, -0.915]) {
      const m = plane(hall, striped(13, 0.42), 3.3, 0.1, HW - 0.03, YB + DOOR.h / 2, ZC);
      m.rotation.y = -Math.PI / 2; m.rotateZ(a);
    }
    for (const y of [0.55, 1.0]) plane(hall, striped(7, 0.6), 1.9, 0.2, HW + 1.3, YB + y, ZC).rotation.y = -Math.PI / 2;
    for (const s of [-1, 1]) { box(hall, steel, 0.05, 1.15, 0.05, HW + 1.3, YB + 0.575, ZC + s * 0.9); box(hall, steel, 0.5, 0.04, 0.05, HW + 1.3, YB + 0.02, ZC + s * 0.9); }
    // the site board over the door, on the hall's side: it says what is coming now
    box(hall, mat.black, 0.06, 0.96, 2.72, HW - 0.04, yd + 0.72, ZC);
    plane(hall, new THREE.MeshBasicMaterial({ map: siteBoard('CSFIT', 'COMING SOON'), color: 0xd0d0d0, fog: false }), 2.6, 0.894, HW - 0.075, yd + 0.72, ZC).rotation.y = -Math.PI / 2;

    // paint and cones
    const tub = new THREE.CylinderGeometry(0.15, 0.13, 0.3, 16);
    for (const [x, z, color] of [[HW + 2.7, ZC - 1.9, 0xe9e7e0], [HW + 3.1, ZC - 2.2, 0xe9e7e0], [HW + 2.95, ZC - 1.6, 0x2a5bd7]]) {
      const m = new THREE.Mesh(tub, new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
      m.position.set(x, YB + 0.15, z); hall.add(m);
    }
    const cone = new THREE.ConeGeometry(0.16, 0.52, 16);
    for (const [x, z] of [[HW + 0.75, ZC - 0.75], [HW + 0.75, ZC + 0.75], [HW + 2.4, ZC + 0.3]]) {
      const m = new THREE.Mesh(cone, orange);
      m.position.set(x, YB + 0.29, z); hall.add(m);
      box(hall, orange, 0.36, 0.03, 0.36, x, YB + 0.015, z);
    }
  }
  const csfit = buildCsfit(c, { HW, RX, RW, RH, YB, ZC, steel, timber, board });
  const workLight = csfit.workLight;

  // =================================================================================================
  // every frame
  // =================================================================================================
  const fwd = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let lit = 0, duck = 1, muffle = 0, house = 22;
  const zLeft = ZC + GROUP_W / 2;      // the picture's left edge, as the viewer sees it

  /** Where the picture and the chat fall on the page, once the view is square to the wall. */
  function layWall(camera) {
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    if (fwd.x > -0.9999995) { steady = 0; return; }       // still turning
    const W = window.innerWidth, Hh = window.innerHeight;
    const rect = (z0, z1) => {
      a.set(XS, WALL_Y + SCREEN.h / 2, z0).project(camera);
      b.set(XS, WALL_Y - SCREEN.h / 2, z1).project(camera);
      return { x: (a.x + 1) / 2 * W, y: (1 - a.y) / 2 * Hh, w: (b.x - a.x) / 2 * W, h: (a.y - b.y) / 2 * Hh };
    };
    const video = rect(zLeft, zLeft - SCREEN.w), chat = rect(zLeft - SCREEN.w - GAP, zLeft - GROUP_W);
    const key = `${Math.round(video.x)},${Math.round(video.y)},${Math.round(video.w)},${Math.round(video.h)}`;
    steady = key === lastKey ? steady + 1 : 0;
    lastKey = key;
    if (steady >= 3 || stream.shown) stream.place(video, watching.chat ? chat : null);    // wait for the view to come to rest, then follow it
  }

  /** `beyond` is how far out of the hall's sound the visitor is by some other way than these rooms (the armory hallway and the range). */
  function update(t, dt, camera, audio, beyond = 0) {
    const p = camera.position;
    const live = stream.status === 'live';
    lit = THREE.MathUtils.damp(lit, live ? 1 : 0, 5, dt);
    onAirMat.color.setScalar(0.13 + lit * (1.7 + 0.1 * Math.sin(t * 2.6)));
    onAirGlow.opacity = lit * (0.5 + 0.05 * Math.sin(t * 2.6));
    // the wall is dark behind the real player, so nothing glows around its edges
    const covered = stream.shown ? 1 : 0;
    screenMat.color.setScalar(THREE.MathUtils.damp(screenMat.color.r, 1 - covered * 0.94, 8, dt));
    chatMat.color.setScalar(screenMat.color.r);
    glowMat.opacity = 0.08 + 0.2 * lit;
    screenLight.intensity = 6 + 26 * lit;
    house = THREE.MathUtils.damp(house, watching ? 5 : 22, 3, dt);
    houseLight.intensity = house;
    workLight.intensity = 24 * (0.93 + 0.07 * Math.sin(t * 31) * Math.sin(t * 7.3));

    // The music stays in the hall. Down the corridor it sinks and loses its highs, step by step;
    // in the room it is the thump of a club through a wall; and it fades right out for a visitor
    // who has sat down to a stream that is live.
    const away = Math.max(beyond, p.x < X0 || Math.abs(p.z - ZC) < DOOR.w / 2 + 0.3 ? THREE.MathUtils.clamp((-HW + 0.3 - p.x) / (COR + 0.6), 0, 1) : 0);
    const tuned = !!watching && (stream.playing || stream.status === 'live');
    duck = THREE.MathUtils.damp(duck, tuned ? 0 : 1 - 0.66 * away, tuned ? 1.8 : 4, dt);
    muffle = THREE.MathUtils.damp(muffle, away, 5, dt);
    audio.setDuck(duck < 0.006 ? 0 : duck);
    audio.setMuffle(muffle);

    // Twitch's player is fetched once the visitor comes upstairs; until then a small picture request says whether the channel is live
    if (!stream.layer && p.y > YB + 1.2) stream.prepare();
    if (watching) { layWall(camera); stream.tick(t); }
    subwall?.update(t, dt, camera);
    csfit.update(t, dt, camera);
  }

  return { usables, update, stream, subwall, csfit };
}
