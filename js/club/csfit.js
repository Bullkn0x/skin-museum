// The room behind the tape: CSFIT, the owner's gym, still being built. Visitors stand at the
// tape and look in; they do not walk in, so nothing here needs to stop a visitor. Approved by
// the owner from three drawings on the club's concept canvas (2026-11-13).
//
// What is in it follows the plan drawing. Places are given the way the plan gives them:
//   u  metres from the left wall, as seen from the door (0 to 10.4)
//   v  metres from the far wall (0 to 9.5)
//   h  metres above the room's floor
//
// Three of the game's agents are at work. The game has no animation of lifting, packing or
// fitting, so each stands (or crouches) in one of the game's own clips and the page places the
// arms: a two-bone solve per arm (npcs.js has the same for the dancers' legs), hands on what
// they are holding. The dumbbells and the case follow the hands.
//
// The owner's own pictures (the logo, the sticker banner, the three giveaway cases) are used
// if they are in assets/csfit/; until then each is drawn as a stand-in in the same colours.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { swing } from './npcs.js';
import { stencil } from './textures.js';
// the case and the sign's letters as solids, and the painting of their labels and faces
import { CASE, LABEL, EMBLEM, LABEL_IN_PICTURE, caseGeometries, scuffCanvas, glyphOutline, MARK_PLATES, solidOf, traceOutline, paintLabel, paintEmblem, paintFace } from './csfit-models.js';

const ART = 'assets/csfit/';
const DISPLAY = 'Orbitron, Bahnschrift, "Arial Narrow", sans-serif', PLAIN = 'Jost, system-ui, sans-serif';
/** The three kinds. `crop` is where the case sits in the owner's square picture of it: read off the pictures as pasted, not measured from the files. */
const KINDS = {
  blue: { file: 'case-blue.png', seam: ['#2f9bff', '#2f9bff'], line: 'GUT CUT GIVEAWAY', mark: 'knife', crop: [0.07, 0.93, 0.255, 0.785] },
  green: { file: 'case-green.png', seam: ['#b6e21e', '#b6e21e'], line: 'SWEAT EQUITY DROP', mark: 'bell', crop: [0.07, 0.93, 0.26, 0.79] },
  violet: { file: 'case-violet.png', seam: ['#19d7ff', '#a970ff'], line: '“GUT CUT” Giveaway', mark: 'bell', crop: [0.07, 0.88, 0.245, 0.755] },
};
/**
 * The sign's five letters, each as the stretch of the logo picture it is cut from (shares of the
 * picture's width, at mid height) and where it goes on the wall. The whole logo with its
 * dumbbell mark is 6.4 m wide on the wall, which makes the letters 1.4 m tall. The shares and
 * the lean are read off the logo as pasted, to be set right once the file is here.
 */
const LOGO = { top: 0.395, bottom: 0.59, lean: 0.24, from: 0.06, wide: 0.889 };
const LETTERS = [['C', 0.060, 0.238, true], ['S', 0.232, 0.404, true], ['F', 0.398, 0.552, true], ['I', 0.548, 0.640, false], ['T', 0.630, 0.765, false]];      // the T stops short of the dumbbell mark, which starts under the end of its bar
const MARK = [0.757, 0.949];
const INK = ['#19d7ff', '#3f6dff', '#8a4bff', '#d12bff'];      // the logo's colours, left to right

/** Who does what. All three are agents the game ships and the club already has. */
const WORKERS = [
  { job: 'lift', file: 'assets/range/agents/tm_balkan.glb', clips: 'assets/club/', clip: 'stand_1', u: 2.4, v: 1.3, h: 0.012, face: [1, 0] },
  { job: 'pack', file: 'assets/range/agents/ctm_fbi.glb', clips: 'assets/range/', clip: 'crouch_idle', u: 5.93, v: 5.65, h: 0, face: [0, 1] },
  { job: 'fit', file: 'assets/range/agents/tm_phoenix.glb', clips: 'assets/club/', clip: 'stand_2', u: 0.76, v: 4.2, h: 1.785, face: [0, -1] },
];

const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const ease = (v) => v * v * (3 - 2 * v);
function canvasOf(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  return cv;
}
function textureOf(cv, aniso = 4) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
const spaced = (ctx, px) => { try { ctx.letterSpacing = `${px}px`; } catch { /* plain spacing */ } };
/** The logo's colours over one stretch of it (from share t0 to share t1), laid from x0 to x1. */
function inkAt(ctx, x0, x1, t0, t1) {
  const stops = [0, 0.45, 0.8, 1], rgb = INK.map((hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  const at = (t) => {
    const c = Math.min(1, Math.max(0, t));
    let i = 0;
    while (i < stops.length - 2 && c > stops[i + 1]) i++;
    const k = (c - stops[i]) / (stops[i + 1] - stops[i]);
    return `rgb(${rgb[i].map((v, j) => Math.round(v + (rgb[i + 1][j] - v) * k)).join(',')})`;
  };
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, at(t0));
  for (let i = 0; i < stops.length; i++) if (stops[i] > t0 && stops[i] < t1) g.addColorStop((stops[i] - t0) / (t1 - t0), INK[i]);
  g.addColorStop(1, at(t1));
  return g;
}

/**
 * @param c     the club's helpers (see buildClub): hall, mat, tex, box, plane, flat, lamp, additive, col
 * @param room  the room's measurements and the builders' materials, from rooms.js
 * Returns { update(t, dt, camera), workLight }.
 */
export function buildCsfit(c, room) {
  const { hall, mat, tex, box, plane, flat, lamp, additive, col } = c;
  const { HW, RX, RW, RH, YB, ZC, steel, timber, board } = room;
  const X = (v) => RX - v, Y = (h) => YB + h, Z = (u) => ZC - RW + u;
  /** A box given the plan's way: `du` across, `dh` high, `dv` deep, its middle at (u, h, v). Drawn with the room's other still boxes. */
  const bx = (m, du, dh, dv, u, h, v) => box(hall, m, dv, dh, du, X(v), Y(h), Z(u));
  /** Everything that is not a plain still box: hidden unless a visitor is upstairs, where the room can be seen from. */
  const live = new THREE.Group();
  live.visible = false;
  hall.add(live);
  const put = (mesh, u, h, v) => { mesh.position.set(X(v), Y(h), Z(u)); live.add(mesh); return mesh; };

  const iron = new THREE.MeshStandardMaterial({ color: 0x14151b, roughness: 0.5, metalness: 0.65 });
  const bright = new THREE.MeshStandardMaterial({ color: 0xaeb4c4, roughness: 0.3, metalness: 1 });
  const card = new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 0.9 });
  // The cases' black moulded plastic: scuffed, and dusty toward the edges of every part (each part
  // of the shape carries its own shade as well). It is matt on purpose: with a shine, the work
  // light's glare on it outweighed its own colour and the cases came out khaki.
  const shell = new THREE.MeshLambertMaterial({ color: 0x3a3b43, map: textureOf(scuffCanvas()), vertexColors: true });
  const foam = new THREE.MeshStandardMaterial({ color: 0x3a3c46, roughness: 1 });
  const film = new THREE.MeshStandardMaterial({ color: 0x8fa3b0, roughness: 0.5, metalness: 0.2 });
  const tape = new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.8 });
  const wrap = () => new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.3, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
  const cube = new THREE.BoxGeometry(1, 1, 1), sheetGeo = new THREE.PlaneGeometry(1, 1);
  const wrapped = (du, dh, dv, u, h, v) => { const m = new THREE.Mesh(cube, wrap()); m.scale.set(dv, dh, du); m.renderOrder = 4; return put(m, u, h, v); };

  // =============================================================================================
  // the builders' things, kept from before and moved to where the plan has them
  // =============================================================================================
  // the scaffold, against the left wall under the case wall, with one deck (the fitter stands on it)
  const DECK = 1.785;
  {
    const tower = new THREE.Group();
    tower.position.set(X(4.25), YB, Z(1.2));
    hall.add(tower);
    for (const x of [-0.95, 0.95]) for (const z of [-0.65, 0.65]) box(tower, steel, 0.05, 3.5, 0.05, x, 1.75, z);
    for (const y of [0.25, 1.7, 3.3]) {
      for (const z of [-0.65, 0.65]) box(tower, steel, 1.95, 0.045, 0.045, 0, y, z);
      for (const x of [-0.95, 0.95]) box(tower, steel, 0.045, 0.045, 1.35, x, y, 0);
    }
    box(tower, timber, 1.86, 0.05, 1.2, 0, DECK - 0.025, 0);
    const brace = new THREE.Group();
    brace.position.set(0, 0.98, 0.65); brace.rotation.z = 0.66;
    tower.add(brace);
    box(brace, steel, 2.4, 0.035, 0.035, 0, 0, 0);
  }
  {
    // a ladder against the far wall
    const ladder = new THREE.Group();
    ladder.position.set(RX - 0.75, YB, Z(8.5)); ladder.rotation.z = -0.2;
    hall.add(ladder);
    for (const z of [-0.22, 0.22]) box(ladder, timber, 0.05, 3.3, 0.05, 0, 1.65, z);
    for (let i = 0; i < 10; i++) box(ladder, timber, 0.04, 0.04, 0.44, 0, 0.3 + i * 0.31, 0);
  }
  for (let i = 0; i < 5; i++) box(hall, board, 2.4, 0.06, 1.2, X(6.2) + (i % 2) * 0.04, YB + 0.03 + i * 0.062, Z(9.2) - (i % 3) * 0.03);      // plasterboard
  // the trestle bench against the right wall, and on it the sign's dumbbell mark, still in its wrap
  for (const dv of [-0.7, 0.7]) {
    for (const s of [-1, 1]) bx(timber, 0.06, 0.8, 0.06, 9.6 + s * 0.42, 0.4, 3.7 + dv);
    bx(timber, 1.0, 0.08, 0.08, 9.6, 0.8, 3.7 + dv);
  }
  bx(timber, 0.32, 0.045, 2.2, 9.6, 0.87, 3.7);
  {
    // The mark is the same kind of solid as the letters on the wall, at the size it will hang at
    // (1.38 m across), lying on its back on the bench. It is wider than the bench and hangs over both edges.
    const wide = (MARK[1] - MARK[0]) * (6.4 / LOGO.wide), deep = 0.15;
    const solid = new THREE.Mesh(solidOf(MARK_PLATES.map(([x0, x1, y0, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [x, y / 0.52]))),
      new THREE.MeshStandardMaterial({ color: 0x3a2a78, roughness: 0.45, metalness: 0.45, emissive: 0x1c1146 }));
    solid.scale.set(wide, wide * 0.52, deep); solid.rotation.x = -Math.PI / 2;
    put(solid, 9.62, 0.8925 + deep / 2 + 0.004, 3.25);
    wrapped(wide * 0.52 + 0.05, deep + 0.03, wide + 0.06, 9.62, 0.8925 + deep / 2 + 0.012, 3.25);
    for (const dv of [-0.42, 0.42]) bx(tape, wide * 0.52 + 0.06, deep + 0.036, 0.05, 9.62, 0.8925 + deep / 2 + 0.014, 3.25 + dv);
  }
  // the first machine, in the far right corner under the dust sheet
  bx(mat.black, 0.6, 1.5, 1.1, 9.9, 0.75, 0.85);
  {
    const sheet = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.35, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false }));
    sheet.scale.set(2.82, RH - 0.5, 1); sheet.rotation.y = -2.662; sheet.renderOrder = 4;
    put(sheet, 9.75, RH / 2 + 0.2, 1.25);
  }
  // the work light on its stand, turned toward the middle of the room
  let workLight;
  {
    const stand = new THREE.Group();
    stand.position.set(X(7.0), YB, Z(8.0)); stand.rotation.y = -0.72;
    hall.add(stand);
    box(stand, steel, 0.04, 1.75, 0.04, 0, 0.875, 0);
    for (const a of [0, 2.1, 4.2]) box(stand, steel, 0.03, 0.03, 0.6, Math.sin(a) * 0.25, 0.03, Math.cos(a) * 0.25);
    box(stand, mat.black, 0.42, 0.3, 0.12, 0, 1.82, 0);
    box(stand, mat.lamp, 0.36, 0.24, 0.02, 0, 1.82, -0.07);
    workLight = lamp(X(6.6), YB + 1.85, Z(7.55), 0xffd9a0, 24, 11);
  }
  // COMING SOON, smaller now and off to one side: the sign is taking its place
  plane(hall, new THREE.MeshBasicMaterial({ map: stencil('COMING SOON'), color: 0xbdbdbd, transparent: true, depthWrite: false }), 2.5, 0.62, RX - 0.02, YB + 1.6, Z(6.95)).rotation.y = -Math.PI / 2;

  // =============================================================================================
  // the gym so far
  // =============================================================================================
  // rubber floor, laid over the far left only
  {
    const tile = textureOf(canvasOf(256, 256, (ctx, w) => {
      ctx.fillStyle = '#15161b'; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 520; i++) { ctx.fillStyle = `rgba(${90 + Math.random() * 60},${95 + Math.random() * 60},${120 + Math.random() * 70},${0.1 + Math.random() * 0.2})`; ctx.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
      ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = 3; ctx.strokeRect(0, 0, w, w);
    }));
    tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
    for (const [v0, v1, u0, u1] of [[0, 2.9, 0, 5.6], [2.9, 3.6, 0, 3.6]]) {
      const t = tile.clone();
      t.repeat.set(v1 - v0, u1 - u0); t.needsUpdate = true;
      flat(hall, new THREE.MeshStandardMaterial({ map: t, roughness: 0.94 }), v1 - v0, u1 - u0, X((v0 + v1) / 2), YB + 0.012, Z((u0 + u1) / 2));
    }
  }

  // dumbbells: a bar and two six-sided heads, the bar along the piece's own x
  const handleGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.15, 10).rotateZ(Math.PI / 2);
  const headGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.062, 6).rotateZ(Math.PI / 2);
  function dumbbell() {
    const g = new THREE.Group(), a = new THREE.Mesh(headGeo, iron), b = new THREE.Mesh(headGeo, iron);
    a.position.x = -0.095; b.position.x = 0.095;
    g.add(new THREE.Mesh(handleGeo, bright), a, b);
    return g;
  }
  // the rack in the far left corner: two shelves, the top one full, the bottom one barely started
  for (const u of [0.22, 1.68]) for (const v of [0.08, 0.46]) bx(iron, 0.04, 0.95, 0.04, u, 0.475, v);
  for (const h of [0.3, 0.72]) bx(iron, 1.5, 0.035, 0.4, 0.95, h, 0.27);
  for (const [n, h] of [[5, 0.8], [2, 0.38]]) for (let i = 0; i < n; i++) put(dumbbell(), 0.39 + i * 0.28, h, 0.27);
  bx(card, 0.34, 0.3, 0.27, 1.61, 0.15, 0.845);                 // a carton still to unpack
  bx(tape, 0.06, 0.302, 0.272, 1.61, 0.15, 0.845);

  // the squat rack: three uprights up, the fourth still on the floor beside it
  for (const [u, v] of [[4.9, 2.1], [6.1, 2.1], [4.9, 3.3]]) bx(iron, 0.07, 2.3, 0.07, u, 1.15, v);
  bx(iron, 1.27, 0.07, 0.07, 5.5, 0.035, 2.1); bx(iron, 0.07, 0.07, 1.27, 4.9, 0.035, 2.7); bx(iron, 0.07, 0.07, 1.27, 6.1, 0.035, 2.7);
  bx(iron, 1.27, 0.07, 0.07, 5.5, 2.265, 2.1); bx(iron, 0.07, 0.07, 1.27, 4.9, 2.265, 2.7);
  for (const u of [4.9, 6.1]) bx(bright, 0.09, 0.05, 0.16, u, 1.35, 2.19);            // the hooks the bar will rest on
  {
    const down = new THREE.Group();
    down.position.set(X(3.55), YB, Z(6.7)); down.rotation.y = -0.045;
    hall.add(down);
    box(down, iron, 0.07, 0.07, 2.2, 0, 0.035, 0);
  }
  // a bench still in its wrap, a stack of plates, a rolled mat
  bx(iron, 0.3, 0.09, 1.25, 4.6, 0.45, 3.91); bx(iron, 0.06, 0.4, 0.06, 4.6, 0.2, 3.42); bx(iron, 0.3, 0.4, 0.06, 4.6, 0.2, 4.4);
  wrapped(0.4, 0.56, 1.36, 4.6, 0.29, 3.91);
  bx(card, 0.41, 0.06, 1.37, 4.6, 0.3, 3.91);
  {
    const plateGeo = new THREE.CylinderGeometry(0.225, 0.225, 0.042, 28), hubGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 14);
    for (let i = 0; i < 5; i++) put(new THREE.Mesh(plateGeo, iron), 3.7 + (i % 2) * 0.012, 0.033 + i * 0.044, 2.3 + (i % 3) * 0.008);
    put(new THREE.Mesh(hubGeo, bright), 3.7, 0.033 + 4 * 0.044 + 0.005, 2.3);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2f7a, roughness: 0.85 }));
    put(roll, 2.6, 0.112, 3.2);
    for (const du of [-0.4, 0.4]) bx(mat.black, 0.04, 0.21, 0.21, 2.6 + du, 0.112, 3.2);
  }

  // =============================================================================================
  // the mirror: two panels up on the far wall, the third leaning beside them in its film
  // =============================================================================================
  // A real reflection costs a second picture of everything in view, so it is only made while a
  // visitor is by the doorway and looking in. From anywhere else the glass is a plain dark sheet.
  const mirror = new Reflector(new THREE.PlaneGeometry(2.4, 2.2), { textureWidth: 768, textureHeight: 704, color: 0xaebac2, clipBias: 0.003, multisample: 4 });
  mirror.rotation.y = -Math.PI / 2;
  put(mirror, 3.0, 1.4, 0.03);
  const dull = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial({ color: 0x1b2730, roughness: 0.12, metalness: 0.9 }));
  dull.scale.set(2.4, 2.2, 1); dull.rotation.y = -Math.PI / 2;
  put(dull, 3.0, 1.4, 0.03);
  {
    // The mirror looks back at the door, and so at the whole club beyond it: left alone, its
    // picture was four times the work of the visitor's own (1,200 more things to draw, measured).
    // All of that would show as a sliver through a doorway eight metres off, so for the mirror's
    // picture everything that lies wholly in the hall is left out, and so is the hall's floor,
    // which is a mirror itself and would make its own picture over again inside this one. The
    // lights stay, so the room is lit the same in the glass as out of it.
    const draw = mirror.onBeforeRender, bounds = new THREE.Box3();
    let leftOut = [], due = 0;
    const survey = (scene) => {
      leftOut = [];
      const look = (o) => {
        if (o === live || o === hall || o === mirror || o.isLight || o.isCamera || o.isInstancedMesh) return;      // the still boxes of the whole club are a few shared pieces: they stay
        if (o.isReflector) { leftOut.push(o); return; }
        bounds.setFromObject(o);
        if (!bounds.isEmpty() && bounds.max.x < HW - 0.6) leftOut.push(o);
      };
      scene.children.forEach(look); hall.children.forEach(look);
    };
    mirror.onBeforeRender = function (renderer, scene, camera, ...rest) {
      if (--due < 0) { survey(scene); due = 180; }          // things arrive as they load, so the list is made again every few seconds
      const shown = leftOut.map((o) => o.visible);
      for (const o of leftOut) o.visible = false;
      draw.call(this, renderer, scene, camera, ...rest);
      leftOut.forEach((o, i) => { o.visible = shown[i]; });
    };
  }
  for (const h of [0.29, 2.51]) bx(steel, 2.44, 0.025, 0.02, 3.0, h, 0.04);
  for (const u of [1.79, 4.21]) bx(steel, 0.025, 2.24, 0.02, u, 1.4, 0.04);
  bx(mat.black, 0.012, 2.2, 0.012, 3.0, 1.4, 0.036);
  {
    const lean = new THREE.Group();
    lean.position.set(X(0.36), YB + 0.02, Z(4.9)); lean.rotation.z = -0.146;
    hall.add(lean);
    box(lean, film, 0.03, 2.2, 1.2, 0, 1.1, 0);
    for (const y of [0.55, 1.65]) box(lean, tape, 0.034, 0.05, 1.2, 0, y, 0);
  }

  // =============================================================================================
  // the owner's pictures, or stand-ins for them
  // =============================================================================================
  const art = {};                    // name -> picture, once found
  const whenArt = [];                // things to do again once the pictures are in
  const pictures = (async () => {
    const list = await fetch(`${ART}manifest.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!list) return;
    let names = [...(list.files || [])];
    // the local server lists its folders, which says which of the files are really there without asking for each
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      const listing = await fetch(ART).then((r) => (r.ok ? r.text() : '')).catch(() => '');
      if (/<a href=/i.test(listing)) names = names.filter((n) => listing.includes(`href="${n}"`));
    }
    await Promise.all(names.map((name) => new Promise((done) => {
      const img = new Image();
      img.onload = () => { art[name] = img; done(); };
      img.onerror = () => done();
      img.src = ART + name;
    })));
    for (const fn of whenArt) fn();
  })();

  // ---- the giveaway cases -------------------------------------------------------------------------
  // Each is the solid from csfit-models.js: a moulded body and lid, a strip of light in the seam
  // between them, the label on the body's front and a small emblem on the lid's raised panel.
  const parts = caseGeometries();
  /** The label for a kind of case: cut from the owner's picture of that case, or painted here. */
  function labelOf(kind) {
    const K = KINDS[kind], img = art[K.file];
    if (img) {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const cw = K.crop[1] - K.crop[0], ch = K.crop[3] - K.crop[2], [left, right, top, bottom] = LABEL_IN_PICTURE;
      t.repeat.set(cw * (right - left), ch * (bottom - top));
      t.offset.set(K.crop[0] + cw * left, 1 - (K.crop[2] + ch * bottom));
      t.needsUpdate = true;
      return t;
    }
    return textureOf(canvasOf(920, 332, (ctx, w, h) => paintLabel(ctx, w, h, kind, K.line, K.mark)), 8);
  }
  const seamOf = (kind) => textureOf(canvasOf(64, 4, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, KINDS[kind].seam[0]); g.addColorStop(1, KINDS[kind].seam[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }));
  const labels = {}, seams = {}, emblems = {}, halos = {};
  for (const kind of Object.keys(KINDS)) {
    labels[kind] = new THREE.MeshBasicMaterial({ map: labelOf(kind), color: 0xcfcfcf });
    emblems[kind] = new THREE.MeshBasicMaterial({ map: textureOf(canvasOf(460, 340, (ctx, w, h) => paintEmblem(ctx, w, h, kind))), color: 0xb4b4b4 });
    seams[kind] = new THREE.MeshBasicMaterial({ map: seamOf(kind), color: col(0xffffff).multiplyScalar(1.9) });
    halos[kind] = additive(tex.glow, col(KINDS[kind].seam[0]).lerp(col(KINDS[kind].seam[1]), 0.5), 0.3);      // the seam's light, spilling forward
  }
  const relabel = () => { for (const kind of Object.keys(KINDS)) { labels[kind].map.dispose(); labels[kind].map = labelOf(kind); } };
  whenArt.push(relabel);
  if (document.fonts?.load) document.fonts.load(`600 20px ${DISPLAY}`).then(() => relabel()).catch(() => {});      // the line under the name is lettered in the display face
  const recess = new THREE.MeshBasicMaterial({ color: 0x0a0b0f });
  /** A case, its front toward its own +z. Returns the group; an open one has its lid swung back and its foam showing. */
  function makeCase(kind, open = false) {
    const g = new THREE.Group(), seamY = -CASE.h / 2 + CASE.h * (1 - CASE.lid);
    const body = new THREE.Mesh(parts.body, shell);
    const seam = new THREE.Mesh(cube, seams[kind]);
    seam.scale.set(CASE.w - 0.016, 0.011, CASE.d - 0.016); seam.position.y = seamY;
    const label = new THREE.Mesh(sheetGeo, labels[kind]);
    label.scale.set(LABEL.w, LABEL.h, 1); label.position.set(0, LABEL.y, LABEL.z);
    g.add(body, seam, label);
    // the lid turns about the back of the seam, and takes its emblem and its clasps with it
    const hinge = new THREE.Group();
    hinge.position.set(0, seamY, -CASE.d / 2);
    const lid = new THREE.Mesh(parts.lid, shell);
    lid.position.set(0, -seamY, CASE.d / 2);
    const emblem = new THREE.Mesh(sheetGeo, emblems[kind]);
    emblem.scale.set(EMBLEM.w, EMBLEM.h, 1); emblem.rotation.x = -Math.PI / 2; emblem.position.set(0, EMBLEM.y - seamY, CASE.d / 2);
    hinge.add(lid, emblem);
    g.add(hinge);
    if (open) {
      hinge.rotation.x = -1.85;
      // the foam stands a little proud of the seam, so the seam's light shows as a rim round it; a bed is cut in it for what the case will hold
      const bed = new THREE.Mesh(cube, foam);
      bed.scale.set(CASE.w - 0.05, 0.03, CASE.d - 0.05); bed.position.y = seamY - 0.003;
      const cut = new THREE.Mesh(sheetGeo, recess);
      cut.scale.set(0.34, 0.13, 1); cut.rotation.x = -Math.PI / 2; cut.position.set(0.04, seamY + 0.0125, 0.02);
      const lining = new THREE.Mesh(sheetGeo, foam);
      lining.scale.set(CASE.w - 0.06, CASE.d - 0.06, 1); lining.rotation.x = Math.PI / 2; lining.position.set(0, -0.002, CASE.d / 2);
      hinge.add(lining);
      g.add(bed, cut);
    } else {
      const halo = new THREE.Mesh(sheetGeo, halos[kind]);
      halo.scale.set(CASE.w * 1.2, 0.15, 1); halo.position.set(0, seamY, CASE.d / 2 + 0.03); halo.renderOrder = 3;
      g.add(halo);
    }
    return g;
  }
  const DOOR = -Math.PI / 2, ROOM = 0;        // which way a case's front looks: at the door, or out from the left wall
  const stand = (kind, u, h, v, turn, open) => { const g = put(makeCase(kind, open), u, h, v); g.rotation.y = turn; return g; };

  // a pallet of five finished ones
  bx(timber, 1.2, 0.03, 1.0, 7.7, 0.125, 5.3);
  for (const u of [7.2, 7.7, 8.2]) bx(timber, 0.1, 0.11, 1.0, u, 0.055, 5.3);
  {
    const y0 = 0.14 + CASE.h / 2;
    stand('blue', 7.7 - 0.315, y0, 5.52, DOOR); stand('green', 7.7 + 0.315, y0, 5.52, DOOR);
    stand('violet', 7.7 - 0.315, y0 + CASE.h, 5.52, DOOR); stand('blue', 7.7 + 0.315, y0 + CASE.h, 5.52, DOOR);
    stand('green', 7.7, y0 + CASE.h * 2, 5.52, DOOR);
  }
  // The one being packed, on a crate at the packer's right knee. It stands where his arms reach:
  // the game's crouch keeps the shoulders a metre up, the left knee forward and the right one
  // down, so a case on the floor straight ahead of him was 20 cm beyond both hands (measured).
  const OPEN = { u: 6.31, h: 0.36 + CASE.h / 2, v: 5.81 };
  bx(timber, 0.7, 0.36, 0.5, OPEN.u, 0.18, OPEN.v);
  for (const h of [0.09, 0.27]) bx(steel, 0.71, 0.02, 0.51, OPEN.u, h, OPEN.v);
  stand('violet', OPEN.u, OPEN.h, OPEN.v, DOOR, true);
  // the case wall: six brackets on the left wall, two cases up, a third being held to its place
  const ROWS = [1.25, DECK + 1.38], COLS = [3.35, 4.2, 5.05], WALL_U = CASE.d / 2 + 0.03;
  for (const h of ROWS) for (const v of COLS) for (const dv of [-0.2, 0.2]) {
    bx(steel, CASE.d + 0.04, 0.025, 0.04, WALL_U, h - CASE.h / 2 - 0.013, v + dv);
    bx(steel, 0.025, 0.28, 0.04, 0.013, h - CASE.h / 2 - 0.15, v + dv);
  }
  stand('blue', WALL_U, ROWS[0], COLS[0], ROOM);
  stand('green', WALL_U, ROWS[0], COLS[1], ROOM);
  const held = stand('violet', WALL_U, ROWS[1], COLS[1], ROOM);

  // ---- the sign --------------------------------------------------------------------------------------
  // Five letters, each a solid standing off the far wall on its mounts and leaning the way the
  // logo leans, so each can be lit or dark. A letter's outline is traced from the owner's logo
  // when that picture is here; until then it is this page's own drawing of the logo's letters.
  const SIGN = { u0: 2.2, perShare: 6.4 / LOGO.wide, h: 3.3, off: 0.06, deep: 0.15 };
  const tall = (LOGO.bottom - LOGO.top) * SIGN.perShare;          // the logo picture is square, so shares of its width and of its height are the same length
  const letters = [];
  const returns = new THREE.MeshStandardMaterial({ color: 0x0c0e18, roughness: 0.5, metalness: 0.6 });
  /** Where a letter is fixed to the wall, as places on its own square (across, up). */
  const MOUNTS = { C: [[0.16, 0.5], [0.5, 0.1], [0.5, 0.9]], S: [[0.5, 0.5], [0.5, 0.1], [0.5, 0.9]], F: [[0.18, 0.15], [0.18, 0.6], [0.5, 0.9]], I: [[0.5, 0.2], [0.5, 0.8]], T: [[0.5, 0.2], [0.5, 0.6], [0.2, 0.9], [0.8, 0.9]] };
  /** One letter's front, upright on a canvas of its own, and its outline on that canvas (0 to 1 both ways, y upward). */
  function frontOf(i) {
    const [ch, x0, x1] = LETTERS[i], cw = Math.round(((x1 - x0) / (LOGO.bottom - LOGO.top)) * 256), img = art['logo.png'];
    let outline = glyphOutline(ch);
    const cv = canvasOf(cw, 256, (ctx, w, h) => {
      if (img) {
        // straighten the lean while cutting, so the cut is a plain upright box; black becomes clear
        const k = h / ((LOGO.bottom - LOGO.top) * img.height), yc = ((LOGO.top + LOGO.bottom) / 2) * img.height;
        ctx.setTransform(k, 0, k * LOGO.lean, k, -k * (x0 * img.width + yc * LOGO.lean), -k * LOGO.top * img.height);
        ctx.drawImage(img, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const px = ctx.getImageData(0, 0, w, h), d = px.data;
        for (let p = 0; p < d.length; p += 4) d[p + 3] = Math.min(255, Math.max(d[p], d[p + 1], d[p + 2]) * 1.8);
        ctx.putImageData(px, 0, 0);
        // the letter's own edge, followed round on the picture
        outline = traceOutline(ctx, w, h) || outline;
        // a solid's front is a whole picture: the dark the logo stands on goes back under the letter
        ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        paintFace(ctx, w, h, outline, inkAt(ctx, 0, w, (x0 - LOGO.from) / LOGO.wide, (x1 - LOGO.from) / LOGO.wide), i);
      }
    });
    return { cv, outline };
  }
  /** The same front before it is wired: its colours all but out. */
  const unlit = (cv) => canvasOf(cv.width, cv.height, (ctx, w, h) => { ctx.drawImage(cv, 0, 0); ctx.fillStyle = 'rgba(14,15,21,.86)'; ctx.fillRect(0, 0, w, h); });
  LETTERS.forEach(([ch, x0, x1, lit], i) => {
    const wide = (x1 - x0) * SIGN.perShare, u = SIGN.u0 + ((x0 + x1) / 2 - LOGO.from) * SIGN.perShare;
    const made = frontOf(i);
    // a lit letter shines from its front and tints its own sides; a dark one is the same solid, taking the room's light
    const face = lit ? new THREE.MeshBasicMaterial({ map: textureOf(made.cv, 8), fog: false }) : new THREE.MeshStandardMaterial({ map: textureOf(unlit(made.cv), 8), roughness: 0.5, metalness: 0.35 });
    const side = lit ? new THREE.MeshStandardMaterial({ color: 0x0c0e18, roughness: 0.5, metalness: 0.6, emissive: col(INK[Math.min(3, i)]), emissiveIntensity: 0.035 }) : returns;
    const m = new THREE.Mesh(solidOf([made.outline], (LOGO.lean * tall) / wide), [face, side]);
    m.scale.set(wide, tall, SIGN.deep); m.rotation.y = -Math.PI / 2;
    put(m, u, SIGN.h, SIGN.off + SIGN.deep / 2);
    for (const [ax, ay] of MOUNTS[ch]) bx(steel, 0.035, 0.035, SIGN.off + 0.02, u + (ax - 0.5) * wide + (ay - 0.5) * tall * LOGO.lean, SIGN.h + (ay - 0.5) * tall, (SIGN.off + 0.02) / 2);
    let glow = null;
    if (lit) {
      glow = new THREE.Mesh(sheetGeo, additive(tex.glow, col(INK[Math.min(3, i)]), 0.5));          // its light on the wall behind
      glow.scale.set(wide * 2.1, tall * 1.9, 1); glow.rotation.y = -Math.PI / 2; glow.renderOrder = 1;
      put(glow, u, SIGN.h, 0.02);
    } else {
      bx(mat.black, 0.012, 0.35 + i * 0.07, 0.012, u + (i === 3 ? -0.08 : 0.16), SIGN.h - tall / 2 - 0.17 - i * 0.035, 0.05);          // its wire, hanging, not yet connected
    }
    letters.push({ m, face, side, glow, lit, i, wide });
  });
  // the logo's short streaks of light, over and under the letters that are on
  const streaks = [];
  {
    const a = LETTERS[0][1], b = LETTERS[2][2], span = (b - a) * SIGN.perShare, mid = SIGN.u0 + ((a + b) / 2 - LOGO.from) * SIGN.perShare;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(sheetGeo, additive(tex.glow, col(s < 0 ? INK[1] : INK[0]), 0.5));
      m.scale.set(span * (s < 0 ? 0.62 : 0.8), 0.075, 1); m.rotation.y = -Math.PI / 2; m.renderOrder = 1;
      streaks.push(put(m, mid + s * 0.35, SIGN.h + s * (tall / 2 + 0.12), 0.03));
    }
  }
  /** With the owner's logo in: each letter again, cut and traced from it. */
  whenArt.push(() => {
    if (!art['logo.png']) return;
    for (const l of letters) {
      const made = frontOf(l.i);
      l.m.geometry.dispose(); l.m.geometry = solidOf([made.outline], (LOGO.lean * tall) / l.wide);
      l.face.map.dispose(); l.face.map = textureOf(l.lit ? made.cv : unlit(made.cv), 8); l.face.needsUpdate = true;
    }
  });
  {
    // where the dumbbell mark will go, once it is out of its wrap
    const wide = (MARK[1] - MARK[0]) * SIGN.perShare;
    const outline = new THREE.Mesh(sheetGeo, new THREE.MeshBasicMaterial({
      map: textureOf(canvasOf(256, 128, (ctx, w, h) => { ctx.setLineDash([14, 10]); ctx.lineWidth = 4; ctx.strokeStyle = '#a970ff'; ctx.strokeRect(6, 6, w - 12, h - 12); })),
      transparent: true, opacity: 0.6, depthWrite: false, fog: false,
    }));
    outline.scale.set(wide, wide * 0.5, 1); outline.rotation.y = -Math.PI / 2;
    put(outline, SIGN.u0 + ((MARK[0] + MARK[1]) / 2 - LOGO.from) * SIGN.perShare, SIGN.h - tall * 0.05, 0.03);
  }
  const signLight = lamp(X(1.1), YB + 3.1, Z(4.0), 0x4b7bff, 12, 9);

  // ---- the sticker banner, leaning against the far wall under COMING SOON ------------------------------------------
  {
    const lean = new THREE.Group();
    lean.position.set(X(0.3), YB, Z(6.9)); lean.rotation.z = -0.34;
    hall.add(lean);
    box(lean, mat.black, 0.02, 0.84, 2.44, 0.012, 0.42, 0);
    const drawn = () => (art['banner.png']
      ? (() => { const t = new THREE.Texture(art['banner.png']); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; return t; })()
      : textureOf(canvasOf(1536, 512, (ctx, w, h) => {
        ctx.fillStyle = '#0d0d14'; ctx.fillRect(0, 0, w, h);
        ctx.lineWidth = 8; ctx.strokeStyle = '#ff2bd6'; ctx.strokeRect(10, 10, w - 20, h - 20);
        const tones = ['#b06cf0', '#c8ccd6', '#f4f4f4', '#c9a26a', '#2f8cff'];
        'CSFIT'.split('').forEach((ch, i) => {
          const x = 90 + i * 280, s = 240;
          ctx.fillStyle = rgba(tones[i], 0.9); ctx.fillRect(x, 96, s, s);
          ctx.fillStyle = '#0d0d14'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 150px ${DISPLAY}`; ctx.fillText(ch, x + s / 2, 96 + s / 2 + 8);
          ctx.fillStyle = '#cfd3dc'; ctx.font = `500 34px ${PLAIN}`; ctx.fillText(`sticker ${i + 1}`, x + s / 2, 400);
        });
      })));
    const face = new THREE.Mesh(sheetGeo, new THREE.MeshBasicMaterial({ map: drawn(), color: 0xc8c8c8 }));
    face.scale.set(2.4, 0.8, 1); face.rotation.y = -Math.PI / 2; face.position.set(-0.001, 0.42, 0);
    lean.add(face);
    whenArt.push(() => { if (art['banner.png']) { face.material.map.dispose(); face.material.map = drawn(); } });
  }

  // =============================================================================================
  // the three at work
  // =============================================================================================
  const workers = [];
  const _h = new THREE.Vector3(), _k = new THREE.Vector3(), _e = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3(), _j = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3();
  const at = (bone, out) => out.setFromMatrixPosition(bone.matrixWorld);
  /** Bend an arm so its hand is at `target`, the elbow toward `pole`. The hand keeps the turn it has against the forearm. */
  function place(l, target, pole) {
    const H = at(l.upper, _h), K = at(l.lower, _k), E = at(l.end, _e);
    const l1 = H.distanceTo(K), l2 = K.distanceTo(E);
    const D = Math.min(_u.subVectors(target, H).length(), (l1 + l2) * 0.999);
    if (!(D > 1e-4)) return;
    const u = _u.normalize();
    _p.copy(pole).addScaledVector(u, -pole.dot(u));
    if (_p.lengthSq() < 1e-8) return;
    _p.normalize();
    const along = (l1 * l1 - l2 * l2 + D * D) / (2 * D), out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    _j.copy(H).addScaledVector(u, along).addScaledVector(_p, out);
    swing(l.upper, _a.subVectors(K, H).normalize(), _b.subVectors(_j, H).normalize());
    l.upper.updateMatrixWorld(true);
    at(l.lower, K); at(l.end, E);
    swing(l.lower, _a.subVectors(E, K).normalize(), _b.subVectors(target, K).normalize());
    l.lower.updateMatrixWorld(true);
  }

  const curl = (p) => (p < 0.3 ? ease(p / 0.3) : p < 0.42 ? 1 : p < 0.78 ? 1 - ease((p - 0.42) / 0.36) : 0);
  const JOBS = {
    // one arm after the other: the elbow stays by the side, the forearm comes up and goes down
    lift(w, t) {
      w.arms.forEach((l, i) => {
        const side = i ? 1 : -1, up = curl((t / 3.4 + i * 0.5) % 1);
        const S = at(l.upper, _h), reach = l.l1, angle = 0.22 + up * 2.1;
        _t.copy(S).addScaledVector(w.up, -reach * 0.985).addScaledVector(w.fwd, -0.03).addScaledVector(w.right, side * 0.035);          // where the elbow hangs
        _t.addScaledVector(w.fwd, Math.sin(angle) * l.l2).addScaledVector(w.up, -Math.cos(angle) * l.l2).addScaledVector(w.right, side * 0.03 * (1 - up));
        place(l, _t, _pole.copy(w.fwd).negate());
        const hand = at(l.end, _e), fore = _a.subVectors(hand, at(l.lower, _k)).normalize();
        w.bells[i].position.copy(hand).addScaledVector(fore, 0.085);
        w.bells[i].quaternion.setFromUnitVectors(_b.set(1, 0, 0), w.right);
      });
    },
    // both hands in the open case, pressing the foam down and working along it
    pack(w, t) {
      w.arms.forEach((l, i) => {
        const side = i ? 1 : -1;
        const press = Math.max(0, Math.sin(t * 1.7 + i * 0.6)), slide = Math.sin(t * 0.55);
        _t.set(X(OPEN.v + (i ? 0.07 : -0.11)), Y(OPEN.h + 0.07 + 0.06 * (1 - press)), Z(OPEN.u - 0.14 + 0.06 * slide));
        place(l, _t, _pole.copy(w.up).multiplyScalar(-0.6).addScaledVector(w.right, side));
      });
    },
    // both hands on the ends of a case held to the wall, which shifts a little as it is lined up
    fit(w, t) {
      held.position.set(X(COLS[1] + 0.012 * Math.sin(t * 0.6 + 1)), Y(ROWS[1] + 0.012 * Math.sin(t * 0.9)), Z(WALL_U));
      held.rotation.z = 0.03 * Math.sin(t * 0.7);
      held.updateMatrixWorld(true);
      w.arms.forEach((l, i) => {
        const side = i ? 1 : -1;
        _t.set(side * (CASE.w / 2 + 0.015), -0.03, CASE.d / 2 - 0.12).applyMatrix4(held.matrixWorld);
        place(l, _t, _pole.copy(w.up).multiplyScalar(-1).addScaledVector(w.right, side * 0.5));
      });
    },
  };

  let started = false;
  async function start() {
    const loader = new GLTFLoader(), clips = {};
    for (const base of new Set(WORKERS.map((w) => w.clips))) clips[base] = loader.loadAsync(`${base}anims.glb`).catch(() => null);
    await Promise.all(WORKERS.map(async (spec) => {
      const [model, anims] = await Promise.all([loader.loadAsync(spec.file).catch(() => null), clips[spec.clips]]);
      const clip = anims?.animations.find((a) => a.name === spec.clip);
      if (!model || !clip) return;
      const root = SkeletonUtils.clone(model.scene);
      root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });          // a skinned mesh's bounds are its rest pose's
      root.userData.shotsPass = true;
      root.position.set(X(spec.v), Y(spec.h), Z(spec.u));
      root.rotation.y = Math.atan2(spec.face[0], spec.face[1]);
      live.add(root);
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      const arm = (s) => ({ upper: root.getObjectByName(`arm_upper_${s}`), lower: root.getObjectByName(`arm_lower_${s}`), end: root.getObjectByName(`hand_${s}`), was: [new THREE.Quaternion(), new THREE.Quaternion()] });
      const arms = [arm('L'), arm('R')];
      if (arms.some((l) => !l.upper || !l.lower || !l.end)) return;
      root.updateMatrixWorld(true);
      for (const l of arms) { l.l1 = at(l.upper, _h).distanceTo(at(l.lower, _k)); l.l2 = at(l.lower, _k).distanceTo(at(l.end, _e)); }
      const fwd = new THREE.Vector3(spec.face[0], 0, spec.face[1]).normalize(), up = new THREE.Vector3(0, 1, 0);
      const w = { ...spec, root, mixer, arms, bent: false, fwd, up, right: new THREE.Vector3().crossVectors(fwd, up), bells: [] };
      if (spec.job === 'lift') for (let i = 0; i < 2; i++) { const b = dumbbell(); live.add(b); w.bells.push(b); }
      workers.push(w);
    }));
  }

  const dir = new THREE.Vector3();
  function update(t, dt, camera) {
    const e = camera.position;
    // The room is seen through its doorway: from the gallery outside it, from the balcony across the hall, and (the top of
    // the far wall, where the sign is) from the dance floor below.
    const inSight = e.x > -HW - 0.5 && Math.abs(e.z - ZC) < 16;
    live.visible = inSight;
    if (!inSight) return;
    if (!started) { started = true; start(); }
    camera.getWorldDirection(dir);
    const looking = !api.plainGlass && e.y > YB - 1.2 && e.x > 1.5 && e.x < HW + 2 && Math.abs(e.z - ZC) < 5 && dir.x > 0.25;      // upstairs, by the doorway, facing in
    mirror.visible = looking; dull.visible = !looking;

    // the three letters that are wired flicker now and then; the last one wired does it most
    let glowing = 0;
    for (const l of letters) {
      if (!l.lit) continue;
      const blink = Math.sin(t * 13.7 + l.i * 2.1) * Math.sin(t * 7.3 + l.i) * Math.sin(t * 0.9 + l.i * 1.7);
      const on = blink > (l.i === 2 ? 0.55 : 0.8) ? 0.25 : 1;
      l.face.color.setScalar(1.05 * on);
      l.side.emissiveIntensity = 0.035 * on;
      l.glow.material.opacity = 0.5 * on;
      glowing += on;
    }
    signLight.intensity = 4 * glowing;
    for (const m of streaks) m.material.opacity = 0.5 * (glowing / 3);

    for (const w of workers) {
      // back to what the animation left: the mixer only writes a bone whose value has changed
      if (w.bent) for (const l of w.arms) { l.upper.quaternion.copy(l.was[0]); l.lower.quaternion.copy(l.was[1]); }
      w.mixer.update(dt);
      for (const l of w.arms) { l.was[0].copy(l.upper.quaternion); l.was[1].copy(l.lower.quaternion); }
      w.bent = true;
      w.root.updateMatrixWorld(true);
      JOBS[w.job](w, t);
    }
  }

  // plainGlass: true keeps the mirror from reflecting, to measure what it costs. redraw() makes
  // everything that uses the owner's pictures again from what is in `art`, so a picture can be
  // tried from the console (art['logo.png'] = an image, then redraw()) without a file in the folder.
  const api = { update, workLight, workers, mirror, dull, live, pictures, art, held, letters, plainGlass: false, redraw: () => { for (const fn of whenArt) fn(); } };
  if (new URLSearchParams(location.search).has('debug')) window.__csfit = api;      // for trying things from the console
  return api;
}
