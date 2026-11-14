// Builds the night club: the same exhibits as the museum, in a two-storey club hall with a
// dance floor, a moving light rig, a jukebox and an upstairs VIP gallery for the top three.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  glowTexture, washTexture, backdropTexture, plaqueTexture, letteringTexture,
  shadowTexture, floorLightTexture, isCutout,
} from '../textures.js';
import { LOOKS, DIM as D } from './looks.js';
import { buildFloor } from './floor.js';
import { buildRig } from './lights.js';
import { ClubAudio } from './audio.js';
import { JukeboxPanel } from './jukebox-ui.js';
import { modelKit } from './models.js';
import { neonSign, ledPlaque, wallCovering, tufting, backBar, grille, upstairsFloor, jukeboxScreen } from './textures.js';
import { DOOR, annexFloor, wallWithDoor, buildRooms } from './rooms.js';
import { GATE, HALLWAY, rangeFloor, rangeAway, buildRange } from './range.js';
import { buildDjGear } from './dj.js';
import { buildNpcs } from './npcs.js';

const yAxis = new THREE.Vector3(0, 1, 0);
const VZ = -17.4;          // where the side VIP pieces hang, along the hall
const EDGE = 0.3;          // how far a visitor keeps from an edge

/** Decide where every skin goes and where a visitor can walk. Pure layout, no meshes. */
export function planClub(skins, cfg = {}) {
  const { HW, L, YB, BX, ZG, ZB, SX0, SX1, ZS } = D;
  const byId = new Map(skins.map((s) => [String(s.id), s]));

  // Upstairs: the three top skins. By default the first three featured items, as in the museum.
  let vip = cfg.vip ? [cfg.vip.centre, cfg.vip.left, cfg.vip.right].map((id) => byId.get(String(id))) : [];
  if (vip.length !== 3 || vip.some((s) => !s) || new Set(vip).size !== 3) vip = skins.filter((s) => s.display === 'hero').slice(0, 3);
  const [centre, left, right] = vip;
  const taken = new Set(vip);
  // Podiums out on the dance floor.
  const podium = (cfg.floorDisplays || []).map((id) => byId.get(String(id))).filter((s) => s && !taken.has(s)).slice(0, 6);
  podium.forEach((s) => taken.add(s));
  const rest = skins.filter((s) => !taken.has(s));
  const walls = rest.filter((s) => s.display !== 'pedestal');
  const cases = rest.filter((s) => s.display === 'pedestal');

  const displays = [];
  const v = (x, y, z) => new THREE.Vector3(x, y, z);

  // Wall bays run down both sides. The first bay on the right is the jukebox's.
  const rows = Math.max(2, Math.ceil((walls.length + 1) / 2));
  const pitch = Math.min(4.6, (-ZG - 8) / (rows - 1));
  walls.forEach((skin, i) => {
    const slot = i === 0 ? 0 : i + 1;
    const onLeft = slot % 2 === 0, z = -4.4 - Math.floor(slot / 2) * pitch;
    displays.push({
      skin, kind: 'wall', level: 0, pos: v(onLeft ? -HW : HW, 0, z), normal: v(onLeft ? 1 : -1, 0, 0),
      size: { w: 2.4, h: 1.6 }, cy: 1.92, viewDist: 3.0, radius: 4.4, stand: { x: (onLeft ? -1 : 1) * (HW - 2.6), z, ground: 0 },
    });
  });
  // Cases stand between the columns along both edges of the dance floor.
  const edgeZ = [-6.4, -10.8, -15.2, -19.6, -3.2];
  cases.forEach((skin, i) => {
    const onLeft = i % 2 === 0, z = edgeZ[Math.floor(i / 2) % edgeZ.length], x = (onLeft ? -1 : 1) * 3.75;
    displays.push({
      skin, kind: 'pedestal', level: 0, pos: v(x, 0, z), normal: v(onLeft ? 1 : -1, 0, 0),
      size: { w: 0.78, h: 0.585 }, cy: 1.5, viewDist: 1.7, radius: 3.0, stand: { x: x + (onLeft ? 1.6 : -1.6), z, ground: 0 },
    });
  });
  const mid = (D.DANCE.z0 + D.DANCE.z1) / 2;
  const marks = {
    1: [[0, 0]], 2: [[-1.7, 0], [1.7, 0]], 3: [[-1.7, 3.2], [1.7, 0], [-1.7, -3.2]],
    4: [[-1.7, 3], [1.7, 3], [-1.7, -3], [1.7, -3]], 5: [[-1.7, 3], [1.7, 3], [-1.7, -3], [1.7, -3], [0, 0]],
    6: [[-1.7, 4], [1.7, 4], [-1.7, 0], [1.7, 0], [-1.7, -4], [1.7, -4]],
  }[podium.length] || [];
  podium.forEach((skin, i) => {
    const [x, dz] = marks[i];
    displays.push({
      skin, kind: 'pedestal', podium: true, level: 0, pos: v(x, 0, mid + dz), normal: v(0, 0, 1),
      size: { w: 0.78, h: 0.585 }, cy: 1.45, viewDist: 1.7, radius: 3.0, stand: { x, z: mid + dz + 1.8, ground: 0 },
    });
  });
  // The VIP gallery: one piece on each side wall and the centrepiece on the end wall, over the DJ.
  if (left) displays.push({ skin: left, kind: 'hero', level: 1, pos: v(-HW, 0, VZ), normal: v(1, 0, 0), size: { w: 3.4, h: 2.2 }, cy: YB + 2.05, viewDist: 4.1, radius: 7, stand: { x: -HW + 2.4, z: VZ, ground: YB } });
  if (right) displays.push({ skin: right, kind: 'hero', level: 1, pos: v(HW, 0, VZ), normal: v(-1, 0, 0), size: { w: 3.4, h: 2.2 }, cy: YB + 2.05, viewDist: 4.1, radius: 7, stand: { x: HW - 2.4, z: VZ, ground: YB } });
  if (centre) displays.push({ skin: centre, kind: 'hero', centre: true, level: 1, pos: v(0, 0, -L), normal: v(0, 0, 1), size: { w: 4.3, h: 2.6 }, cy: YB + 2.3, viewDist: 5.0, radius: 7, stand: { x: 0, z: -L + 2.7, ground: YB } });

  // Exhibit numbers follow the walk: the ground floor from the entrance, then upstairs, the centrepiece last.
  const ground = displays.filter((d) => d.level === 0).sort((a, b) => b.pos.z - a.pos.z || a.pos.x - b.pos.x);
  const up = displays.filter((d) => d.level === 1).sort((a, b) => (a.centre ? 1 : 0) - (b.centre ? 1 : 0) || a.pos.x - b.pos.x);
  const ordered = [...ground, ...up];
  ordered.forEach((d, i) => {
    d.number = i + 1;
    d.rotY = Math.atan2(d.normal.x, d.normal.z);
    d.center = d.pos.clone().setY(d.cy).addScaledVector(d.normal, d.kind === 'pedestal' ? 0 : 0.2);
    d.floor = d.level ? YB : 0;          // the floor it stands on: a visitor on the other floor cannot reach it
  });

  // ---- where the floor is --------------------------------------------------------------
  // Three surfaces: the ground, the two staircases and the upstairs gallery. A visitor can
  // only move to a spot whose floor is within a step of the one they are standing on, which
  // is what keeps them on the stairs and behind the balustrades.
  const stairAt = (x, z) => {
    const ax = Math.abs(x);
    return ax > SX0 + EDGE && ax < SX1 - EDGE && z <= ZS && z >= ZG ? ((ZS - z) / (ZS - ZG)) * YB : null;
  };
  const upperAt = (x, z) => {
    const ax = Math.abs(x);
    if (ax > HW - EDGE || z < -L + EDGE) return false;
    if (z <= ZG - EDGE) return true;                         // the end gallery
    if (z <= ZG) return ax >= SX0 + EDGE - 0.05;             // its front edge, open at the stair heads
    return ax >= BX + EDGE && z <= ZB - EDGE;                // the side balconies
  };
  const groundAt = (x, z) => {
    const ax = Math.abs(x);
    if (z < ZG + 0.35) return false;                                             // the wall under the gallery
    if (ax > SX0 - EDGE && ax < SX1 + EDGE && z <= ZS && z >= ZG) return false;  // the flank of a staircase
    return true;
  };
  const floorNear = (x, z, g) => {
    let best = null, gap = 0.42;
    // the last two: the stream room, beyond the left wall, and the armory hallway and range, behind the hall
    for (const h of [groundAt(x, z) ? 0 : null, stairAt(x, z), upperAt(x, z) ? YB : null, annexFloor(x, z), rangeFloor(x, z)]) {
      if (h == null) continue;
      const dh = Math.abs(h - g);
      if (dh < gap) { gap = dh; best = h; }
    }
    return best;
  };
  // ---- over the rail ------------------------------------------------------------------
  // A visitor in the middle of a jump who pushes on past the edge of the floor they are on goes
  // over the balustrade and comes down on whatever is below: the ground, or the stairs.
  const VAULT = 0.35;        // how far off the floor the feet must be
  const CLEAR = 0.2;         // how far out from under the gallery they come down
  let solids = [];           // the hall's colliders, once it is built
  const underSlab = (x, z) => z <= ZG + CLEAR || (Math.abs(x) >= BX - CLEAR && z <= ZB + CLEAR);
  const blocked = (x, z, h) => solids.some((c) => (c.y1 === undefined || (h >= c.y0 && h <= c.y1))
    && Math.abs(x - c.x) < c.hx + 0.47 && Math.abs(z - c.z) < c.hz + 0.47);
  const landing = (x, z, g) => {
    const s = stairAt(x, z);
    if (s != null) return s < g - 0.42 && !blocked(x, z, s) ? s : null;
    return groundAt(x, z) && !underSlab(x, z) && !blocked(x, z, 0) ? 0 : null;
  };
  function vault(p, ox, oz, g) {
    // which way is out: straight across the edge being crossed, not along it
    const zAlone = floorNear(ox, p.z, g) != null, xAlone = floorNear(p.x, oz, g) != null;
    let dx = p.x - ox, dz = p.z - oz;
    if (zAlone && !xAlone) dz = 0; else if (xAlone && !zAlone) dx = 0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    dx /= len; dz /= len;
    // The nearest clear spot beyond the edge, within a leap: past the slab, and past or beside
    // a display case, a pillar or the DJ's desk if one is right below.
    for (let s = 0; s <= 3.2; s += 0.05) {
      const cx = p.x + dx * s, cz = p.z + dz * s;
      if (Math.abs(cx) > HW - EDGE || cz > -EDGE || cz < -L + EDGE) return null;
      if (floorNear(cx, cz, g) != null) return null;        // only a corner of the same floor: nothing to go over
      for (const side of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2]) {
        if (Math.abs(side) > s + 0.4) break;                // no further sideways than forwards
        const x = cx - dz * side, z = cz + dx * side;
        if (Math.abs(x) > HW - EDGE || z > -EDGE || z < -L + EDGE || floorNear(x, z, g) != null) continue;
        const h = landing(x, z, g);
        if (h != null) { p.x = x; p.z = z; return h; }
      }
    }
    return null;
  }

  /**
   * Called by the player after each move: slides along anything it cannot step onto. Returns the
   * floor height. `air` is how far the visitor's feet are off the floor (a jump).
   */
  function walk(p, ox, oz, g, air = 0) {
    let h = floorNear(p.x, p.z, g);
    if (h != null) return h;
    if (air > VAULT && g > 0.42) { h = vault(p, ox, oz, g); if (h != null) return h; }
    h = floorNear(p.x, oz, g); if (h != null) { p.z = oz; return h; }
    h = floorNear(ox, p.z, g); if (h != null) { p.x = ox; return h; }
    h = floorNear(ox, oz, g); if (h != null) { p.x = ox; p.z = oz; return h; }
    return g;
  }
  /**
   * After inspecting, the camera may be hanging in the air beyond a balcony. Bring the visitor
   * back onto the floor: toward where they stood, or toward the piece they stepped across to.
   */
  function settle(player, display, from) {
    const to = from && from.display === display ? from : display.stand;
    const x0 = player.pos.x, z0 = player.pos.z;
    for (let i = 0; i <= 16; i++) {
      const k = i / 16, x = x0 + (to.x - x0) * k, z = z0 + (to.z - z0) * k;
      const h = floorNear(x, z, to.ground);
      if (h != null) { player.pos.x = x; player.pos.z = z; player.ground = h; return; }
    }
    player.pos.x = to.x; player.pos.z = to.z; player.ground = to.ground;
  }

  return {
    displays: ordered, HW, H: D.H, length: L, zEnd: -L, chamferZ: -L, planes: [],
    spawn: v(0, 0, -2.4), walk, settle, podiums: ordered.filter((d) => d.podium),
    setSolids(list) { solids = list; },
    /** Whether a spot is in a room beyond the hall's own walls (or in its doorway), where the hall's bounds do not apply. */
    annex: (x, z) => annexFloor(x, z) != null || rangeFloor(x, z) != null,
  };
}

export async function buildClub(scene, data, images, renderer, { look = 'neon' } = {}) {
  const K = LOOKS[look] || LOOKS.neon, neon = K.neon;
  const { HW, H, L, YB, SLAB, BX, ZG, ZB, SX0, SX1, ZS } = D;
  const cfg = await fetch('data/club.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  await Promise.race([
    Promise.all([document.fonts.load('700 60px Orbitron'), document.fonts.load('400 60px Yellowtail')]),
    new Promise((r) => setTimeout(r, 2500)),
  ]).catch(() => {});

  const layout = planClub(data.skins, cfg);
  const { displays } = layout;
  scene.background = new THREE.Color(K.fog);
  scene.fog = new THREE.FogExp2(K.fog, K.fogDensity);
  const kit = modelKit(scene, data, renderer);

  // ---- shared resources -------------------------------------------------------
  const col = (hex) => new THREE.Color(hex);
  const palette = K.palette.map(col);
  const tex = { glow: glowTexture(), wash: washTexture(), wall: wallCovering(neon) };
  const wallMat = (w, h) => {
    const t = tex.wall.clone();
    t.repeat.set(w / 2.3, h / 2.3); t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color: K.wall, map: t, roughness: 0.93 });
  };
  const mat = {
    wallDark: new THREE.MeshStandardMaterial({ color: K.wallDark, roughness: 0.9 }),
    ceiling: new THREE.MeshStandardMaterial({ color: K.ceiling, roughness: 1 }),
    slab: new THREE.MeshStandardMaterial({ color: K.slab, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: K.metal, roughness: K.metalRough, metalness: 1, envMapIntensity: neon ? 1.6 : 0.9 }),
    black: new THREE.MeshStandardMaterial({ color: K.dark, roughness: 0.45, metalness: 0.45 }),
    step: new THREE.MeshStandardMaterial({ color: neon ? 0x0b0b2a : 0x100a0c, roughness: neon ? 0.25 : 0.4, metalness: neon ? 0.5 : 0.2 }),
    carpet: new THREE.MeshStandardMaterial({ color: K.carpet, roughness: 0.95 }),
    truss: new THREE.MeshStandardMaterial({ color: neon ? 0x30336e : 0x57452a, roughness: 0.5, metalness: 0.8 }),
    rope: new THREE.MeshStandardMaterial({ color: K.rope, roughness: 0.82 }),
    seat: new THREE.MeshStandardMaterial({ color: K.seat, roughness: neon ? 0.35 : 0.8, map: neon ? null : tufting() }),
    glass: new THREE.MeshPhysicalMaterial({ color: neon ? 0xbfe9ff : 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 2.2, depthWrite: false, clearcoat: 1 }),
    lamp: new THREE.MeshBasicMaterial({ color: col(K.warm).multiplyScalar(1.9) }),
    ledA: new THREE.MeshBasicMaterial({ color: col(K.led) }),     // these two change colour with the show
    ledB: new THREE.MeshBasicMaterial({ color: col(K.palette[1]) }),
  };
  if (mat.seat.map) mat.seat.map.repeat.set(3, 1.5);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  // Static boxes are batched: one instanced draw call per material.
  const boxes = new Map();
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const box = (parent, material, w, h, d, x, y, z) => {
    parent.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q.identity(), _s.set(w, h, d)).premultiply(parent.matrixWorld);
    if (!boxes.has(material)) boxes.set(material, []);
    boxes.get(material).push(m);
  };
  const flushBoxes = () => {
    for (const [material, list] of boxes) {
      const mesh = new THREE.InstancedMesh(boxGeo, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (material === mat.glass) mesh.renderOrder = 4;
      scene.add(mesh);
    }
  };
  const plane = (parent, material, w, h, x, y, z) => {
    const m = new THREE.Mesh(planeGeo, material);
    m.scale.set(w, h, 1); m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const additive = (map, color, opacity) => new THREE.MeshBasicMaterial({
    map, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sign = (parent, text, w, h, x, y, z, opts = {}) => plane(parent, new THREE.MeshBasicMaterial({
    map: neonSign(text, { color: K.sign, font: K.signFont, weight: K.signWeight, ...opts }), color: col(0xffffff).multiplyScalar(1.5), transparent: true, depthWrite: false, fog: false,
  }), w, h, x, y, z);
  const flat = (parent, material, w, d, x, y, z) => { const m = plane(parent, material, w, d, x, y, z); m.rotation.x = -Math.PI / 2; return m; };

  // Uniforms shared by everything that moves with the music.
  const show = { uTime: { value: 0 }, uBeat: { value: 0 }, uSpec: { value: new Float32Array(8) }, uA: { value: palette[0].clone() }, uB: { value: palette[1].clone() } };
  const flatVertex = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

  const hall = new THREE.Group();
  scene.add(hall);
  const colliders = [];
  const solid = (x, z, hx, hz, y0 = -1, y1 = 2.2) => colliders.push({ x, z, hx, hz, y0, y1 });
  layout.setSolids(colliders);

  // ---- floor --------------------------------------------------------------------
  const pools = [{ x: 0, z: -2.6, r: 6, color: K.warm, a: 0.2 }, { x: 0, z: ZG + 2.2, r: 4.6, color: K.palette[1], a: 0.3 }, { x: HW - 1.2, z: -4.4, r: 2.6, color: K.palette[0], a: 0.4 }];
  for (const d of displays) {
    if (d.level !== 0) continue;
    const p = d.pos.clone().addScaledVector(d.normal, d.kind === 'pedestal' ? 0 : 1.3);
    pools.push({ x: p.x, z: p.z, r: 2.7, color: K.warm, a: 0.3 }, { x: p.x, z: p.z, r: 1.9, color: d.skin.rarityColor, a: 0.3 });
  }
  const danceMid = (D.DANCE.z0 + D.DANCE.z1) / 2;
  const ballPos = neon ? null : new THREE.Vector3(0, 6.05, danceMid);
  const floor = buildFloor({
    neon, HW, L, dance: D.DANCE, lane: { x0: SX0, x1: SX1, z0: ZS, z1: ZS + 2.2 },
    lightTexture: floorLightTexture({ xMin: -HW, zMin: -L, width: HW * 2, length: L, pools }),
    fog: K.fog, fogDensity: K.fogDensity, ball: ballPos, shade: { x: BX + 0.3, z: ZB },
  });
  hall.add(floor.mesh);

  // ---- shell: walls, ceiling, the gallery and its two balconies ----------------------
  const ceiling = plane(hall, mat.ceiling, HW * 2, L, 0, H, -L / 2);
  ceiling.rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) {
    // each long wall has a doorway upstairs, at the top of the stairs: the stream room on the left, a room being built on the right
    const along = sx < 0 ? -L / 2 - DOOR.z : DOOR.z + L / 2;
    const w = wallWithDoor(L, H, wallMat(L, H), along - DOOR.w / 2, along + DOOR.w / 2, YB - H / 2, YB + DOOR.h - H / 2);
    w.position.set(sx * HW, H / 2, -L / 2);
    w.rotation.y = -sx * Math.PI / 2;
    hall.add(w);
  }
  plane(hall, wallMat(HW * 2, H), HW * 2, H, 0, H / 2, 0).rotation.y = Math.PI;
  {
    // The rear wall, and the wall that closes off the space under the gallery. The armory hallway
    // runs through both (see range.js): a door in the second, at the dead end of the left aisle,
    // and an opening the width of the hallway in the first.
    const under = YB - SLAB;
    const rear = wallWithDoor(HW * 2, H, wallMat(HW * 2, H), HALLWAY.x0, HALLWAY.x1, -H / 2 + 0.002, -H / 2 + HALLWAY.h);
    rear.position.set(0, H / 2, -L);
    const front = wallWithDoor(HW * 2, under, mat.wallDark, GATE.x - GATE.w / 2, GATE.x + GATE.w / 2, -under / 2 + 0.002, -under / 2 + GATE.h);
    front.position.set(0, under / 2, ZG);
    hall.add(rear, front);
  }
  box(hall, mat.slab, HW * 2, SLAB, L + ZG, 0, YB - SLAB / 2, (-L + ZG) / 2);
  const upMat = (w, d) => { const t = upstairsFloor(neon); t.repeat.set(w / 1.2, d / 1.2); return new THREE.MeshStandardMaterial({ map: t, roughness: neon ? 0.28 : 0.95, metalness: neon ? 0.35 : 0 }); };
  flat(hall, upMat(HW * 2, L + ZG), HW * 2, L + ZG, 0, YB + 0.004, (-L + ZG) / 2);
  for (const sx of [-1, 1]) {
    const w = HW - BX, len = ZB - ZG, cx = sx * (HW + BX) / 2, cz = (ZG + ZB) / 2;
    box(hall, mat.slab, w, SLAB, len, cx, YB - SLAB / 2, cz);
    flat(hall, upMat(w, len), w, len, cx, YB + 0.004, cz);
    // fascia: a metal lip and a line of light along every edge
    box(hall, mat.metal, 0.04, 0.06, len, sx * (BX - 0.02), YB - 0.03, cz);
    box(hall, mat.ledA, 0.03, 0.045, len, sx * (BX - 0.016), YB - SLAB + 0.05, cz);
    box(hall, mat.ledB, w, 0.045, 0.03, cx, YB - SLAB + 0.05, ZB + 0.016);
    // skirting, and a cove of light along the top of each side wall
    box(hall, mat.black, 0.08, 0.3, L, sx * (HW - 0.04), 0.15, -L / 2);
    box(hall, mat.black, 0.4, 0.26, L, sx * (HW - 0.2), H - 0.13, -L / 2);
    box(hall, mat.ledA, 0.035, 0.035, L, sx * (HW - 0.42), H - 0.25, -L / 2);
    // columns under the balcony edge
    for (const z of [-8.6, -13.0, -17.4, -21.8]) {
      const x = sx * 3.95;
      box(hall, mat.black, 0.3, YB - SLAB, 0.3, x, (YB - SLAB) / 2, z);
      if (neon) for (const dz of [-0.16, 0.16]) box(hall, dz < 0 ? mat.ledA : mat.ledB, 0.03, YB - SLAB - 0.2, 0.03, x - sx * 0.16, (YB - SLAB) / 2, z + dz);
      else for (const y of [0.18, YB - SLAB - 0.2]) box(hall, mat.metal, 0.34, 0.07, 0.34, x, y, z);
      solid(x, z, 0.16, 0.16);
    }
    // vertical accents on the upper walls, between the VIP piece and the booths
    for (const z of [VZ - 3.1, VZ + 3.1, -9.2, -25.6]) {
      if (neon) box(hall, z === VZ - 3.1 || z === -9.2 ? mat.ledB : mat.ledA, 0.035, H - YB - 1.3, 0.035, sx * (HW - 0.03), (H + YB) / 2 + 0.1, z);
      else box(hall, mat.metal, 0.03, H - YB - 0.9, 0.05, sx * (HW - 0.02), (H + YB) / 2, z);
    }
  }
  box(hall, mat.metal, SX0 * 2, 0.06, 0.04, 0, YB - 0.03, ZG + 0.02);
  box(hall, mat.ledA, SX0 * 2, 0.045, 0.03, 0, YB - SLAB + 0.05, ZG + 0.016);
  // ceiling: a grid of light lines (Neon Grid) or dark coffers edged in gold (Velvet)
  for (let z = -3; z > -L; z -= 4.4) {
    if (neon) box(hall, mat.ledB, HW * 2 - 1, 0.02, 0.03, 0, H - 0.012, z);
    else { box(hall, mat.wallDark, HW * 2, 0.34, 0.4, 0, H - 0.17, z); box(hall, mat.metal, HW * 2, 0.02, 0.44, 0, H - 0.35, z); }
  }
  for (const x of [-4.6, 4.6]) {
    if (neon) box(hall, mat.ledA, 0.03, 0.02, L - 1, x, H - 0.012, -L / 2);
    else { box(hall, mat.wallDark, 0.4, 0.3, L, x, H - 0.15, -L / 2); box(hall, mat.metal, 0.44, 0.02, L, x, H - 0.31, -L / 2); }
  }

  // ---- stairs either side of the DJ booth -----------------------------------------------
  const NST = 18, RISE = YB / NST, RUN = (ZS - ZG) / NST;
  for (const sx of [-1, 1]) {
    const xc = sx * (SX0 + SX1) / 2, w = SX1 - SX0;
    for (let i = 0; i < NST; i++) {
      const zc = ZS - (i + 0.5) * RUN, top = (i + 1) * RISE, nose = zc + RUN / 2;
      box(hall, mat.step, w, top, RUN, xc, top / 2, zc);
      if (neon) box(hall, i % 2 ? mat.ledB : mat.ledA, w - 0.08, 0.024, 0.03, xc, top - 0.013, nose + 0.008);     // lit nosing
      else {
        box(hall, mat.carpet, w - 0.44, 0.012, RUN + 0.02, xc, top + 0.006, zc);                                    // red carpet runner
        box(hall, mat.carpet, w - 0.44, RISE, 0.012, xc, top - RISE / 2, nose + 0.006);
        box(hall, mat.metal, w - 0.36, 0.018, 0.018, xc, top - RISE + 0.012, nose + 0.016);                         // brass stair rod
      }
    }
  }

  // ---- balustrades: glass along every upstairs edge, open at the stair heads -----------------
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    box(hall, mat.glass, alongX ? len : 0.02, 1.0, alongX ? 0.02 : len, cx, YB + 0.52, cz);
    box(hall, mat.metal, alongX ? len : 0.05, 0.04, alongX ? 0.05 : len, cx, YB + 1.05, cz);
    const n = Math.max(1, Math.round(len / 1.8));
    for (let i = 0; i <= n; i++) box(hall, mat.metal, 0.04, 1.05, 0.04, x0 + (x1 - x0) * i / n, YB + 0.525, z0 + (z1 - z0) * i / n);
  };
  for (const sx of [-1, 1]) { rail(sx * BX, ZG, sx * BX, ZB); rail(sx * BX, ZB, sx * HW, ZB); }
  rail(-SX0, ZG, SX0, ZG);

  // ---- red velvet ropes ------------------------------------------------------------------------
  const posts = [], ropeGeos = [];
  const post = (x, y, z) => { posts.push([x, y, z]); return new THREE.Vector3(x, y + 0.88, z); };
  const ropeRun = (points, sag = 0.17) => {
    let prev = null;
    for (const p of points) {
      const top = post(...p);
      if (prev) {
        const mid = prev.clone().add(top).multiplyScalar(0.5); mid.y -= sag * 2;
        ropeGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(prev, mid, top), 14, 0.027, 7));
      }
      prev = top;
    }
  };
  for (const sx of [-1, 1]) {
    // a roped lane to the foot of each stair
    for (const x of [sx * (SX0 - 0.1), sx * (SX1 + 0.12)]) { ropeRun([[x, 0, ZS + 0.3], [x, 0, ZS + 2.05]]); solid(x, ZS + 1.17, 0.06, 0.95, -1, 1.2); }
    // a rope handrail up the open side of the stair
    ropeRun([0, 5, 9, 14, 18].map((i) => [sx * (SX0 + 0.08), i * RISE, i === 0 ? ZS + 0.14 : i === NST ? ZG - 0.12 : ZS - i * RUN + RUN / 2]), 0.12);
  }
  for (const d of displays) {
    if (d.kind !== 'hero') continue;
    // across the front of each VIP piece
    const side = new THREE.Vector3(d.normal.z, 0, -d.normal.x), span = d.centre ? 2.7 : 2.25, at = d.pos.clone().addScaledVector(d.normal, 1.05);
    ropeRun([-1, -1 / 3, 1 / 3, 1].map((k) => [at.x + side.x * span * k, YB, at.z + side.z * span * k]));
    const c = d.pos.clone().addScaledVector(d.normal, 0.55);
    solid(c.x, c.z, Math.abs(side.x) * span + Math.abs(d.normal.x) * 0.55, Math.abs(side.z) * span + Math.abs(d.normal.z) * 0.55, YB - 0.6, YB + 2.5);
  }
  {
    const inst = (geo, material) => {
      const m = new THREE.InstancedMesh(geo, material, posts.length), mx = new THREE.Matrix4();
      posts.forEach((p, i) => m.setMatrixAt(i, mx.makeTranslation(p[0], p[1], p[2])));
      m.computeBoundingSphere();
      hall.add(m);
    };
    inst(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 10).translate(0, 0.45, 0), mat.metal);
    inst(new THREE.CylinderGeometry(0.15, 0.17, 0.035, 22).translate(0, 0.018, 0), mat.metal);
    inst(new THREE.SphereGeometry(0.05, 14, 10).translate(0, 0.93, 0), mat.metal);
    if (neon) inst(new THREE.TorusGeometry(0.19, 0.012, 6, 28).rotateX(Math.PI / 2).translate(0, 0.02, 0), mat.ledB);
    hall.add(new THREE.Mesh(mergeGeometries(ropeGeos), mat.rope));
  }

  // ---- VIP booths --------------------------------------------------------------------------------
  const booth = (x, z, rotY) => {
    const g = new THREE.Group();
    g.position.set(x, YB, z); g.rotation.y = rotY;
    hall.add(g);
    box(g, mat.black, 2.4, 0.12, 0.86, 0, 0.06, 0.45);
    box(g, mat.seat, 2.3, 0.34, 0.74, 0, 0.29, 0.47);
    box(g, mat.seat, 2.3, 0.86, 0.2, 0, 0.72, 0.12);
    for (const sx of [-1, 1]) box(g, mat.seat, 0.2, 0.6, 0.8, sx * 1.22, 0.42, 0.44);
    if (neon) box(g, mat.ledB, 2.4, 0.03, 0.03, 0, 0.03, 0.895);
    else for (const sx of [-1, 1]) box(g, mat.metal, 0.08, 0.1, 0.08, sx * 1.1, 0.05, 0.82);
    // a low table with an ice bucket, lit from within
    box(g, mat.metal, 0.06, 0.5, 0.06, 0, 0.25, 1.45); box(g, mat.black, 0.62, 0.04, 0.62, 0, 0.52, 1.45);
    box(g, mat.ledA, 0.3, 0.012, 0.3, 0, 0.546, 1.45);
    box(g, mat.metal, 0.2, 0.2, 0.2, 0.06, 0.65, 1.45);
    box(g, mat.black, 0.07, 0.3, 0.07, 0.06, 0.86, 1.45);
    g.updateWorldMatrix(true, false);
    const c = new THREE.Vector3(0, 0, 0.45).applyMatrix4(g.matrixWorld), tb = new THREE.Vector3(0, 0, 1.45).applyMatrix4(g.matrixWorld);
    const alongZ = Math.abs(Math.sin(rotY)) > 0.5;
    solid(c.x, c.z, alongZ ? 0.48 : 1.3, alongZ ? 1.3 : 0.48, YB - 0.6, YB + 2.5);
    solid(tb.x, tb.z, 0.3, 0.3, YB - 0.6, YB + 2.5);
  };
  for (const sx of [-1, 1]) {
    booth(sx * (HW - 0.02), -12.0, -sx * Math.PI / 2);
    booth(sx * (HW - 0.02), -23.2, -sx * Math.PI / 2);
    booth(sx * 5.0, -L + 0.02, 0);
    sign(hall, 'VIP', 1.5, 0.375, sx * (HW - 0.04), YB + 2.5, -12.0, { w: 768, h: 192 }).rotation.y = -sx * Math.PI / 2;
  }

  // ---- the DJ end: stage, booth, screen wall, speaker stacks -----------------------------------------
  const stageZ = ZG + 1.1;
  box(hall, mat.black, SX0 * 2, 0.4, 2.2, 0, 0.2, stageZ);
  box(hall, mat.ledB, SX0 * 2, 0.03, 0.03, 0, 0.385, ZG + 2.216);
  solid(0, stageZ, SX0, 1.1, -1, 1.2);
  box(hall, mat.black, 3.2, 1.05, 0.8, 0, 0.925, ZG + 1.2);
  box(hall, mat.metal, 3.26, 0.04, 0.86, 0, 1.47, ZG + 1.2);
  // on the desk: two turntables and a mixer (js/club/dj.js)
  // The gear sits at the DJ's edge of the desk, and the DJ on a low riser a little right of
  // centre: the pose the game's files offer (see npcs.js) holds one hand out at 1.1 m and the
  // other nearer in, and from there they come down on a turntable and on the mixer.
  const dj = buildDjGear({ hall, mat, box, neon, K, col, show }, { y: 1.49, z: ZG + 1.0 });
  box(hall, mat.black, 1.3, 0.1, 0.62, 0.08, 0.45, ZG + 0.52);
  // the people: a DJ behind the desk, three guests in front of the booth, and two about the room (js/club/npcs.js)
  const toDj = [0, ZG + 0.4];
  const npcs = buildNpcs({ hall, solid }, [
    { role: 'dj', x: 0.08, y: 0.5, z: ZG + 0.62, face: [0.08, 0], clips: ['dj_'] },
    { role: 'guest', x: -1.25, z: -22.7, face: toDj, clips: ['cheer_', 'stand_'] },
    { role: 'guest', x: 1.35, z: -22.95, face: toDj, clips: ['cheer_', 'stand_'] },
    { role: 'guest', x: 0.15, z: -22.1, face: toDj, clips: ['cheer_'] },
    { role: 'guest', x: -5.9, z: -20.2, face: [0, -15], clips: ['stand_'] },
    { role: 'guest', x: 4.7, z: -6.9, face: [0, -14], clips: ['stand_'] },
  ]);
  sign(hall, String(data.museum?.curator || 'club'), 2.9, 0.725, 0, 0.93, ZG + 1.61, neon ? { spacing: 10 } : {});
  if (neon) {
    // an LED wall: a synthwave sunset whose bars follow the music
    plane(hall, new THREE.ShaderMaterial({
      uniforms: show, vertexShader: flatVertex,
      fragmentShader: /* glsl */`
        uniform float uTime, uBeat; uniform float uSpec[8]; uniform vec3 uA, uB; varying vec2 vUv;
        void main() {
          float asp = 1.72;
          vec2 p = vec2((vUv.x - 0.5) * asp, vUv.y - 0.36);
          vec3 c;
          if (p.y > 0.0) {
            c = mix(vec3(0.55, 0.08, 0.46), vec3(0.03, 0.02, 0.2), smoothstep(0.0, 0.5, p.y));
            float sun = smoothstep(0.272, 0.262, length(p - vec2(0.0, 0.2)));
            float cut = step(0.5, fract(p.y * 24.0 - uTime * 0.35)) * smoothstep(0.26, 0.02, p.y);
            c = mix(c, mix(vec3(1.0, 0.2, 0.75), vec3(1.0, 0.92, 0.42), smoothstep(-0.05, 0.42, p.y)) * 1.3, sun * (1.0 - cut * 0.88));
            float bx = abs(p.x) * 15.0 - 5.0;
            if (bx > 0.0 && bx < 8.0) {
              float lvl = 0.03 + 0.52 * uSpec[int(floor(bx))];
              float bar = step(abs(fract(bx) - 0.5), 0.36) * step(p.y, lvl);
              c = mix(c, mix(uA, uB, clamp(p.y / 0.5, 0.0, 1.0)) * 1.35, bar);
            }
          } else {
            float z = 0.12 / (0.012 - p.y);
            float gx = abs(fract(p.x * z * 2.2) - 0.5), gz = abs(fract(z * 0.9 + uTime * 0.9) - 0.5);
            float grid = max(smoothstep(0.44, 0.49, gx), smoothstep(0.42, 0.49, gz));
            c = vec3(0.02, 0.01, 0.08) + uA * grid * (0.3 + 0.7 * smoothstep(0.0, 0.25, -p.y)) * (0.8 + 0.6 * uBeat);
          }
          vec2 g = vUv * vec2(asp, 1.0) * 92.0;
          c *= 0.45 + 0.55 * smoothstep(0.5, 0.2, length(fract(g) - 0.5));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }), 4.3, 2.5, 0, 1.68, ZG + 0.03);
  } else {
    plane(hall, new THREE.MeshBasicMaterial({ map: backBar() }), 4.3, 2.5, 0, 1.68, ZG + 0.03);
  }
  for (const sx of [-1, 1]) box(hall, neon ? mat.ledA : mat.metal, 0.05, 2.56, 0.05, sx * 2.175, 1.68, ZG + 0.05);
  box(hall, neon ? mat.ledB : mat.metal, 4.4, 0.05, 0.05, 0, 2.955, ZG + 0.05);
  // flown speaker stacks: this is where the sound comes from
  const speakers = [-1, 1].map((sx) => ({ x: sx * 3.4, y: 6.45, z: -20.3 }));   // high and clear of the view across the gallery
  const grilleTex = grille(neon);
  grilleTex.repeat.set(5, 2);
  const grilleMat = new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.8 });
  for (const sp of speakers) {
    for (let i = 0; i < 5; i++) {
      const y = sp.y - 0.68 + i * 0.34, back = Math.abs(i - 2) * 0.03;
      box(hall, mat.black, 0.82, 0.3, 0.46, sp.x, y, sp.z - back);
      plane(hall, grilleMat, 0.76, 0.25, sp.x, y, sp.z - back + 0.232);
    }
    for (const dx of [-0.3, 0.3]) box(hall, mat.truss, 0.02, H - sp.y - 0.83, 0.02, sp.x + dx, (H + sp.y + 0.83) / 2, sp.z);
  }

  // ---- entrance wall: doors and the name ------------------------------------------------------------------
  const entrance = new THREE.Group();
  entrance.rotation.y = Math.PI;
  hall.add(entrance);
  box(entrance, mat.metal, 3.5, 0.07, 0.1, 0, 3.62, 0.05);
  for (const sx of [-1, 1]) {
    box(entrance, mat.metal, 0.07, 3.62, 0.1, sx * 1.715, 1.81, 0.05);
    box(entrance, mat.black, 1.66, 3.56, 0.06, sx * 0.84, 1.78, 0.03);
    box(entrance, mat.metal, 0.03, 0.7, 0.05, sx * 0.14, 1.5, 0.085);
    box(entrance, neon ? mat.ledA : mat.wallDark, neon ? 0.03 : 1.2, neon ? 3.2 : 1.2, 0.02, sx * (neon ? 1.56 : 0.84), neon ? 1.75 : 2.6, 0.065);
  }
  const title = data.museum?.title || 'The Collection';
  if (neon) sign(entrance, title.toUpperCase(), 9, 1.5, 0, 4.9, 0.03, { w: 2048, h: 340, spacing: 14 });
  else plane(entrance, new THREE.MeshBasicMaterial({ map: letteringTexture(title, data.museum?.curator ? `Curated by ${data.museum.curator}` : null), transparent: true, depthWrite: false, fog: false }), 7.6, 1.9, 0, 4.9, 0.03);
  plane(entrance, additive(tex.wash, col(K.led), 0.2), 11, 4.4, 0, 3.9, 0.015);
  for (const sx of [-1, 1]) {
    // a hanging VIP sign marks each stair
    box(hall, mat.metal, 1.5, 0.03, 0.03, sx * 3.05, 2.99, ZS + 0.06);
    for (const dx of [-0.5, 0.5]) box(hall, mat.metal, 0.012, 0.18, 0.012, sx * 3.0 + dx, 2.89, ZS + 0.06);
    box(hall, mat.black, 1.34, 0.46, 0.04, sx * 3.0, 2.57, ZS + 0.06);
    sign(hall, 'VIP', 1.3, 0.433, sx * 3.0, 2.57, ZS + 0.085, { w: 768, h: 256 });
  }

  // ---- the jukebox ---------------------------------------------------------------------------------------------
  const juke = new THREE.Group();
  juke.position.set(HW - 0.04, 0, -4.4);
  juke.rotation.y = -Math.PI / 2;
  hall.add(juke);
  const jukeScreen = jukeboxScreen();
  {
    const arch = new THREE.Shape();
    arch.moveTo(-0.5, 0); arch.lineTo(-0.5, 1.12); arch.absarc(0, 1.12, 0.5, Math.PI, 0, true); arch.lineTo(0.5, 0); arch.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: 0.52, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 24 }),
      new THREE.MeshStandardMaterial({ color: neon ? 0x191a4a : 0x4a1c14, roughness: 0.32, metalness: 0.35 }));
    body.position.set(0, 0.12, 0.03);
    juke.add(body);
    box(juke, mat.black, 1.16, 0.12, 0.66, 0, 0.06, 0.33);
    // glowing tubes around the arch
    [[0.44, mat.ledA], [0.36, mat.ledB]].forEach(([r, m]) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 8, 40, Math.PI), m);
      t.position.set(0, 1.24, 0.595); juke.add(t);
      for (const sx of [-1, 1]) box(juke, m, 0.044, 1.0, 0.044, sx * r, 0.74, 0.595);
    });
    plane(juke, new THREE.MeshBasicMaterial({ map: jukeScreen.texture }), 0.56, 0.35, 0, 1.28, 0.578);
    box(juke, mat.metal, 0.62, 0.41, 0.02, 0, 1.28, 0.562);
    box(juke, mat.metal, 0.62, 0.05, 0.04, 0, 1.0, 0.585);
    for (let i = 0; i < 6; i++) box(juke, i % 2 ? mat.ledA : mat.ledB, 0.06, 0.03, 0.02, -0.25 + i * 0.1, 1.0, 0.61);
    const jg = grille(neon); jg.repeat.set(4, 4);
    plane(juke, new THREE.MeshStandardMaterial({ map: jg, roughness: 0.8 }), 0.6, 0.6, 0, 0.6, 0.578);
    box(juke, mat.metal, 0.66, 0.66, 0.02, 0, 0.6, 0.562);
    plane(juke, additive(tex.glow, palette[0], 0.5), 3.0, 3.2, 0, 1.15, 0.045);
    sign(juke, 'Jukebox', 1.6, 0.4, 0, 2.2, 0.06, { w: 1024, h: 256 });
    solid(HW - 0.4, -4.4, 0.42, 0.62);
  }

  // ---- lighting rig -------------------------------------------------------------------------------------------------
  const rig = buildRig({
    scene, hall, K, D, floor, box, mat, ballPos, podiums: layout.podiums.map((d) => ({ x: d.pos.x, z: d.pos.z })),
    washes: displays.filter((d) => d.kind === 'hero').map((d) => {
      const to = d.center.clone().addScaledVector(d.normal, -0.15);
      const from = d.centre ? new THREE.Vector3(0, 6.9, -19.6) : new THREE.Vector3(Math.sign(d.pos.x) * 3.4, 6.9, VZ + (d.pos.x < 0 ? 1.2 : -1.2));
      return { from, to, radius: d.centre ? 2.2 : 1.7 };
    }),
  });

  // The fixtures above are for show. These few lamps colour the architecture, and the skin
  // models ignore them (they take the studio environment only), so no finish is washed out.
  scene.add(new THREE.HemisphereLight(0x9aa0b4, 0x18130e, 0.5));
  const lamps = [];
  const lamp = (x, y, z, color, intensity, distance, cycle = -1) => {
    const l = new THREE.PointLight(color, intensity, distance, 1.8);
    l.position.set(x, y, z);
    scene.add(l);
    if (cycle >= 0) lamps.push({ l, cycle, base: intensity });
    return l;
  };
  lamp(0, H - 1.2, -3, K.warm, 46, 16);
  lamp(0, 5.4, -10, K.palette[0], 70, 20, 0); lamp(0, 5.4, -17, K.palette[1], 70, 20, 1);
  lamp(-5.5, 2.5, -15, K.palette[1], 20, 12, 2); lamp(5.5, 2.5, -15, K.palette[0], 20, 12, 3);
  lamp(0, 2.4, ZG + 3.2, K.palette[1], 34, 12, 1);
  lamp(-5.2, YB + 2.9, VZ, K.warm, 30, 12); lamp(5.2, YB + 2.9, VZ, K.warm, 30, 12); lamp(0, YB + 2.9, -L + 3.2, K.warm, 34, 13);

  // ---- displays ----------------------------------------------------------------------------------------------------------
  // Behind each wall piece: the music's spectrum, bass in the middle and treble at the edges.
  const BAND = /* glsl */`
      uniform float uSpec[8];
      float band(float i) {
        float f = clamp(i, 0.0, 7.0);
        return mix(uSpec[int(floor(f))], uSpec[int(min(7.0, floor(f) + 1.0))], fract(f));
      }`;
  // Neon Grid: an LED wall, the bars drawn in its own dots
  const ledScreen = (color, aspect, seed = 0) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uAspect: { value: aspect }, uSeed: { value: seed }, ...show }, vertexShader: flatVertex,
    fragmentShader: /* glsl */`
      uniform vec3 uColor, uA, uB; uniform float uAspect, uTime, uBeat, uSeed; varying vec2 vUv;
      ${BAND}
      void main() {
        vec2 res = vec2(uAspect, 1.0) * 46.0;
        vec2 g = vUv * res, c = (floor(g) + 0.5) / res;               // the LED this pixel belongs to
        float r = length((c - 0.5) * vec2(uAspect, 1.0));
        vec3 colr = uColor * (0.2 * exp(-r * r * 3.2) + 0.022);
        float cols = floor(res.x / 2.0);                               // one bar to every two LEDs
        float bx = c.x * cols, bi = floor(bx);
        float m = abs((bi + 0.5) / cols - 0.5) * 2.0;                  // 0 in the middle, 1 at either edge
        float lvl = 0.03 + 0.6 * band(m * 7.0) * (0.86 + 0.14 * sin(bi * 12.9898 + uSeed));
        float inBar = step(abs(fract(bx) - 0.5), 0.36);
        float bar = inBar * step(c.y, lvl);
        float cap = inBar * step(abs(c.y - lvl - 1.5 / res.y), 0.6 / res.y);
        float hang = inBar * step(1.0 - c.y, lvl * 0.3);               // a fainter echo hanging from the top edge
        vec3 grad = mix(uA, uB, clamp(c.y / 0.55, 0.0, 1.0));
        colr += grad * (bar * 0.34 + hang * 0.1) + uB * cap * 0.4;
        colr *= 0.35 + 0.65 * smoothstep(0.5, 0.2, length(fract(g) - 0.5));
        gl_FragColor = vec4(colr * (0.9 + 0.32 * uBeat), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // Velvet: footlights along the bottom of the frame, rising up the velvet with the music
  const footlights = (color) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color.clone() }, uWarm: { value: col(K.warm) }, uBeat: show.uBeat, uSpec: show.uSpec }, vertexShader: flatVertex,
    fragmentShader: /* glsl */`
      uniform vec3 uColor, uWarm; uniform float uBeat; varying vec2 vUv;
      ${BAND}
      void main() {
        float cols = 15.0, x = vUv.x * cols, bi = floor(x);
        float m = abs((bi + 0.5) / cols - 0.5) * 2.0;
        float lvl = 0.07 + 0.62 * band(m * 7.0);
        float beam = smoothstep(0.5, 0.12, abs(fract(x) - 0.5));       // a soft-edged column of light
        float reach = smoothstep(lvl, lvl * 0.2, vUv.y);                // brightest at the foot, gone at its top
        vec3 c = mix(uWarm, uColor, clamp(vUv.y / 0.5, 0.0, 1.0)) * beam * reach * (0.2 + 0.14 * uBeat);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const hologram = (color) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: color.clone() }, uTime: show.uTime },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float scan = 0.62 + 0.38 * sin(vUv.y * 80.0 - uTime * 3.0);
        gl_FragColor = vec4(uColor * (0.05 + 0.42 * rim) * scan * (0.25 + 0.75 * (1.0 - vUv.y)), 1.0);
      }`,
  });
  const drape = (w, h, gatherTo) => {
    // a pleated curtain, pulled in at a tie-back two thirds of the way down
    const geo = new THREE.PlaneGeometry(w, h, 18, 10), pos = geo.attributes.position, tie = -h * 0.16;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const k = 0.42 + 0.58 * Math.min(1, Math.abs(y - tie) / (h * 0.42));
      pos.setX(i, gatherTo + (x - gatherTo) * k);
      pos.setZ(i, 0.07 * Math.sin((x / w) * Math.PI * 9) * k);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const drapeMat = new THREE.MeshStandardMaterial({ color: 0x9a1433, roughness: 0.72, side: THREE.DoubleSide });
  const podiumGeo = new THREE.CylinderGeometry(0.78, 0.86, 0.34, 44).translate(0, 0.17, 0);
  const ringGeo = (r, t = 0.02) => new THREE.TorusGeometry(r, t, 8, 56).rotateX(Math.PI / 2);
  const tubeGeo = new THREE.CylinderGeometry(0.44, 0.44, 1.76, 44, 1, true).translate(0, 0.34 + 0.88, 0);
  const tubeMat = new THREE.MeshPhysicalMaterial({ color: neon ? 0xbfe9ff : 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.11, envMapIntensity: 2.4, depthWrite: false, clearcoat: 1, side: THREE.DoubleSide });
  const holoBase = new THREE.CylinderGeometry(0.4, 0.45, 0.56, 36).translate(0, 0.28, 0);
  const holoCone = new THREE.CylinderGeometry(0.52, 0.34, 1.66, 36, 1, true).translate(0, 0.56 + 0.83, 0);
  const glowDisc = (parent, color, size, y, opacity = 1) => flat(parent, new THREE.MeshBasicMaterial({ map: tex.glow, color, opacity, transparent: true, depthWrite: false }), size, size, 0, y, 0);

  for (const d of displays) {
    const image = images.get(d.skin.id);
    const group = new THREE.Group();
    group.position.copy(d.pos);
    group.rotation.y = d.rotY;
    hall.add(group);
    d.group = group;
    d.color = new THREE.Color(d.skin.rarityColor);
    d.phase = d.number * 1.7;

    const plaqueTex = neon ? ledPlaque(d.skin, d.number, K.sign) : plaqueTexture(d.skin, d.number);
    const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex });
    const plaqueRatio = plaqueTex.image.height / plaqueTex.image.width;
    const accentMat = new THREE.MeshBasicMaterial({ color: d.color.clone().multiplyScalar(1.6) });
    const glowMat = additive(tex.glow, d.color, 0.3);
    const img = image.image, aspect = img.width / img.height;
    const photo = !isCutout(img);      // a rectangular picture hangs like a photograph; a cut-out floats
    d.photo = photo;
    const cy = d.cy;
    let piece;

    if (d.kind === 'pedestal') {
      let w = d.size.w, h = w / aspect;
      const maxH = photo ? 0.5 : d.size.h;
      if (h > maxH) { h = maxH; w = h * aspect; }
      const pw = d.podium ? 0.7 : neon ? 0.74 : 0.78, ph = pw * plaqueRatio;

      if (d.podium) {
        // a low round stage out on the dance floor, lit at the rim, with a clear tube over the piece
        group.add(new THREE.Mesh(podiumGeo, mat.black));
        const rim = new THREE.Mesh(ringGeo(0.8, 0.024), accentMat); rim.position.y = 0.338; group.add(rim);
        const foot = new THREE.Mesh(ringGeo(0.9, 0.018), mat.ledA); foot.position.y = 0.025; group.add(foot);
        glowDisc(group, col(K.warm).multiplyScalar(0.5), 1.3, 0.345);
        const tube = new THREE.Mesh(tubeGeo, tubeMat); tube.renderOrder = 4; group.add(tube);
        for (const y of [0.36, 2.1]) { const r = new THREE.Mesh(ringGeo(0.445, 0.014), neon ? mat.ledB : mat.metal); r.position.y = y; group.add(r); }
        for (const s of [1, -1]) { const pl = plane(group, plaqueMat, pw, ph, 0, 0.18, s * 0.835); pl.rotation.y = s > 0 ? 0 : Math.PI; pl.rotation.x = -s * 0.11; }
        solid(d.pos.x, d.pos.z, 0.82, 0.82);
      } else if (neon) {
        // a hologram projector: the piece floats in a cone of light over a glowing base
        group.add(new THREE.Mesh(holoBase, mat.black));
        for (const [y, m] of [[0.14, mat.ledB], [0.42, mat.ledA]]) { const r = new THREE.Mesh(ringGeo(0.44, 0.016), m); r.position.y = y; group.add(r); }
        glowDisc(group, d.color.clone().multiplyScalar(1.2), 1.0, 0.565);
        const cone = new THREE.Mesh(holoCone, hologram(d.color)); cone.renderOrder = 2; group.add(cone);
        const top = new THREE.Mesh(ringGeo(0.52, 0.012), accentMat); top.position.y = 2.22; group.add(top);
        for (const s of [1, -1]) {
          box(group, mat.black, pw + 0.04, ph + 0.04, 0.03, 0, 0.3, s * 0.47);
          plane(group, plaqueMat, pw, ph, 0, 0.3, s * 0.487).rotation.y = s > 0 ? 0 : Math.PI;
        }
        solid(d.pos.x, d.pos.z, 0.5, 0.5);
      } else {
        // black marble plinth, glass case, brass edges
        box(group, mat.black, 0.9, 1.0, 0.9, 0, 0.5, 0);
        box(group, mat.wallDark, 1.0, 0.08, 1.0, 0, 0.04, 0);
        box(group, mat.metal, 0.93, 0.03, 0.93, 0, 0.985, 0);
        glowDisc(group, col(K.warm).multiplyScalar(0.42), 0.86, 1.002);
        for (const [bw, bd, x, z] of [[0.86, 0.016, 0, 0.43], [0.86, 0.016, 0, -0.43], [0.016, 0.86, 0.43, 0], [0.016, 0.86, -0.43, 0]]) box(group, accentMat, bw, 0.012, bd, x, 1.008, z);
        box(group, mat.glass, 0.84, 0.98, 0.84, 0, 1.5, 0);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.84, 0.98, 0.84)), new THREE.LineBasicMaterial({ color: 0xc9a45c, transparent: true, opacity: 0.75 }));
        edges.position.set(0, 1.5, 0); group.add(edges);
        box(group, mat.metal, 0.87, 0.02, 0.87, 0, 1.995, 0);
        for (const s of [1, -1]) plane(group, plaqueMat, pw, ph, 0, 0.66, s * 0.4515).rotation.y = s > 0 ? 0 : Math.PI;
        solid(d.pos.x, d.pos.z, 0.5, 0.5);
      }

      if (photo) {
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image }), w, h, 0, cy, 0);
        const mount = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color: neon ? 0x19e3ff : 0x9a7a45 }));
        mount.scale.set((w + 0.028) / w, (h + 0.028) / h, 1); mount.position.z = -0.004;
        const halo = new THREE.Mesh(planeGeo, glowMat);
        halo.scale.set(1.15 / w, 1.0 / h, 1); halo.position.z = -0.012; halo.renderOrder = 1;
        piece.add(mount, halo);
        d.billboard = [piece];
      } else {
        const halo = plane(group, glowMat, 1.0, 1.0, 0, cy, 0); halo.renderOrder = 1;
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image, transparent: true, depthWrite: false, alphaTest: 0.02 }), w, h, 0, cy, 0);
        d.billboard = [piece, halo];
      }
      piece.renderOrder = 3;
    } else {
      const hero = d.kind === 'hero';
      let W = d.size.w, Hh = d.size.h;
      if (photo) { if (W / aspect <= Hh) Hh = W / aspect; else W = Hh * aspect; }
      const t = hero ? 0.07 : 0.05, depth = 0.16;

      if (neon) {
        // an LED screen in a dark bezel, edged with a tube of light in the rarity colour
        box(group, mat.black, W + 0.22, Hh + 0.22, 0.05, 0, cy, 0.0);
        plane(group, additive(tex.glow, d.color, 0.2), W * 1.9, Hh * 2.3, 0, cy, 0.012);
        if (!photo) plane(group, ledScreen(d.color, W / Hh, d.number), W, Hh, 0, cy, 0.03);
        const tt = 0.035, tz = 0.07;
        for (const s of [1, -1]) { box(group, accentMat, W + tt * 2, tt, tt, 0, cy + s * (Hh / 2 + tt / 2), tz); box(group, accentMat, tt, Hh, tt, s * (W / 2 + tt / 2), cy, tz); }
        if (hero) {
          const o = 0.22;
          for (const s of [1, -1]) { box(group, mat.ledA, W + o * 2, 0.028, 0.028, 0, cy + s * (Hh / 2 + o), 0.05); box(group, mat.ledA, 0.028, Hh + o * 2, 0.028, s * (W / 2 + o), cy, 0.05); }
        }
      } else {
        // lit wall wash, velvet backdrop, brass frame and picture light
        plane(group, additive(tex.wash, col(K.warm), hero ? 0.26 : 0.3), W * (hero ? 1.45 : 2.1), Hh * (hero ? 1.9 : 2.5), 0, cy + Hh * (hero ? 0.2 : 0.28), 0.012);
        if (!photo) {
          plane(group, new THREE.MeshBasicMaterial({ map: backdropTexture(d.skin.rarityColor, W / Hh) }), W, Hh, 0, cy, 0.03);
          plane(group, footlights(d.color), W, Hh, 0, cy, 0.034).renderOrder = 1;
        }
        box(group, mat.metal, W + t * 2, t, depth, 0, cy + Hh / 2 + t / 2, depth / 2);
        box(group, mat.metal, W + t * 2, t, depth, 0, cy - Hh / 2 - t / 2, depth / 2);
        box(group, mat.metal, t, Hh, depth, -W / 2 - t / 2, cy, depth / 2);
        box(group, mat.metal, t, Hh, depth, W / 2 + t / 2, cy, depth / 2);
        box(group, accentMat, W * 0.6, 0.014, 0.02, 0, cy - Hh / 2 - t - 0.04, 0.03);
        const ly = cy + Hh / 2 + t + 0.24;
        for (const sx of [-1, 1]) box(group, mat.metal, 0.02, 0.02, 0.4, sx * W * 0.2, ly, 0.2);
        const lw = hero ? W * 0.4 : W * 0.62;
        box(group, mat.metal, lw, 0.05, 0.07, 0, ly, 0.4);
        box(group, mat.lamp, lw - 0.1, 0.012, 0.045, 0, ly - 0.03, 0.4);
        if (hero) {
          // velvet drapes drawn back either side
          for (const sx of [-1, 1]) {
            const dw = 1.0, dh = Hh + 1.5;
            const m = new THREE.Mesh(drape(dw, dh, sx * dw * 0.5), drapeMat);
            m.position.set(sx * (W / 2 + t + 0.16 + dw / 2), cy + 0.25, 0.12);
            group.add(m);
            box(group, mat.metal, 0.3, 0.07, 0.07, sx * (W / 2 + t + 0.5 + dw * 0.42), cy + 0.25 - dh * 0.16, 0.16);
          }
          box(group, mat.metal, W + 2.9, 0.06, 0.06, 0, cy + 0.25 + (Hh + 1.5) / 2 + 0.02, 0.12);
        }
      }

      if (photo) {
        const aura = plane(group, glowMat, W * 1.55, Hh * 1.8, 0, cy, 0.02); aura.renderOrder = 1;
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image }), W, Hh, 0, cy, 0.035);
        d.still = true;
      } else {
        let w = W * 0.84, h = w / aspect;
        if (h > Hh * 0.9) { h = Hh * 0.9; w = h * aspect; }
        const halo = plane(group, glowMat, W * 1.05, Hh * 1.05, 0, cy, 0.04); halo.renderOrder = 1;
        if (!neon) {
          const shadow = plane(group, new THREE.MeshBasicMaterial({ map: shadowTexture(img), transparent: true, opacity: 0.8, depthWrite: false }), w * 1.06, h * 1.06, w * 0.02, cy - h * 0.07, 0.05);
          shadow.renderOrder = 2;
          d.shadowMesh = shadow;
        }
        piece = plane(group, new THREE.MeshBasicMaterial({ map: image, transparent: true, depthWrite: false, alphaTest: 0.02 }), w, h, 0, cy, 0.2);
      }
      piece.renderOrder = 3;

      const pw = hero ? 1.9 : 1.4, ph = pw * plaqueRatio;
      const py = cy - Hh / 2 - t - (neon ? 0.2 : 0.1) - ph / 2;
      box(group, neon ? mat.black : mat.metal, pw + 0.03, ph + 0.03, 0.02, 0, py, 0.012);
      plane(group, plaqueMat, pw, ph, 0, py, 0.024);
      if (d.level === 0 && d.pos.z < ZB) box(hall, mat.lamp, 0.16, 0.012, 0.16, d.pos.x + d.normal.x * 0.9, YB - SLAB - 0.007, d.pos.z);   // downlight under the balcony
    }
    d.parts = { piece, accentMat, glowMat, baseY: cy, baseScale: piece.scale.clone() };
  }

  // ---- the two rooms off the top of the stairs ---------------------------------------------------------------------------------
  const rooms = buildRooms({ hall, K, neon, mat, tex, box, plane, flat, sign, solid, lamp, additive, col, drape, drapeMat, cfg, renderer });

  // ---- the armory hallway and the shooting range, behind the hall on the ground floor ------------------------------------------
  const range = buildRange({ hall, K, neon, mat, box, plane, flat, sign, lamp, col, cfg, displays });

  flushBoxes();

  // ---- haze: motes drifting through the beams --------------------------------------------------------------------------------
  const DUST = 700;
  const dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() * 2 - 1) * (HW - 0.4);
    dustPos[i * 3 + 1] = Math.random() * H;
    dustPos[i * 3 + 2] = -Math.random() * L;
    dustSeed[i] = Math.random();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uHeight: { value: H }, uScale: { value: 600 }, uColor: { value: neon ? new THREE.Color(0.7, 0.85, 1.0) : new THREE.Color(1.0, 0.86, 0.7) } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uHeight, uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.015 + aSeed * 0.03), uHeight);
        p.x += sin(uTime * 0.21 + aSeed * 40.0) * 0.3;
        p.z += cos(uTime * 0.17 + aSeed * 31.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.006 + aSeed * 0.012) * uScale / max(0.1, -mv.z);
        vA = (0.3 + 0.7 * aSeed) * smoothstep(0.4, 2.5, -mv.z) * (1.0 - smoothstep(12.0, 24.0, -mv.z));
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(uColor * a * vA * 0.5, 1.0);
      }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  hall.add(dust);

  // ---- music ---------------------------------------------------------------------------------------------------------------------
  const music = cfg.music || {};
  const audio = new ClubAudio({ speakers, tracks: music.tracks || [], volume: music.volume ?? 0.7, order: music.order, idleBpm: K.idleBpm });
  const panel = new JukeboxPanel(audio);
  const drawScreen = () => jukeScreen.draw({
    title: audio.current ? audio.current.title : 'Add your music',
    state: !audio.tracks.length ? 'JUKEBOX' : audio.playing ? (audio.muted ? 'MUTED' : 'NOW PLAYING') : 'PAUSED',
    accent: K.sign,
  });
  audio.addEventListener('change', drawScreen);
  drawScreen();
  const usables = [{
    center: new THREE.Vector3(HW - 0.9, 1.3, -4.4), normal: new THREE.Vector3(-1, 0, 0), radius: 3.6, floor: 0,
    label: 'Choose the music', color: K.sign,
    open: (done) => panel.open(done), close: () => panel.close(),
  }, ...rooms.usables, ...range.usables];

  // ---- per-frame life ----------------------------------------------------------------------------------------------------------------
  const q = new THREE.Quaternion(), fwd = new THREE.Vector3(), upv = new THREE.Vector3();
  const feet = { x: 0, z: 0, on: false }, lastStep = new THREE.Vector2(1e6, 0), tmp = new THREE.Color();
  let now = 0;
  const sweep = (u, out) => {      // a colour that travels round the look's palette
    const n = palette.length, f = (((u % 1) + 1) % 1) * n, i = Math.floor(f);
    return out.copy(palette[i % n]).lerp(palette[(i + 1) % n], f - i);
  };
  function update(t, dt, camera, target, inspected) {
    now = t;
    camera.getWorldDirection(fwd);
    upv.set(0, 1, 0).applyQuaternion(camera.quaternion);
    audio.update(dt, camera, fwd, upv);
    rooms.update(t, dt, camera, audio, rangeAway(camera.position));
    range.update(t, dt, camera);
    dj.update(dt, audio);
    const lv = audio.levels;
    npcs.update(dt, lv);

    // the dance floor feels the visitor: a glow underfoot, a ripple at each step
    feet.x = camera.position.x; feet.z = camera.position.z;
    feet.on = !inspected && camera.position.y < 2.3;
    if (feet.on && floor.inDance(feet.x, feet.z) && Math.hypot(feet.x - lastStep.x, feet.z - lastStep.y) > 0.8) {
      floor.step(feet.x, feet.z, t, 1);
      lastStep.set(feet.x, feet.z);
    }
    floor.update(t, dt, lv, feet);
    rig.update(t, dt, lv);

    show.uTime.value = t; show.uBeat.value = lv.beat; show.uSpec.value.set(lv.spectrum);
    dustMat.uniforms.uTime.value = t;
    if (neon) {
      sweep(t * 0.04, mat.ledA.color).multiplyScalar(1.5 + 0.9 * lv.beat);
      sweep(t * 0.04 + 0.5, mat.ledB.color).multiplyScalar(1.5 + 0.9 * lv.beat);
      sweep(t * 0.04, show.uA.value); sweep(t * 0.04 + 0.5, show.uB.value);
    } else {
      mat.ledA.color.set(K.led).multiplyScalar(1.25 + 0.5 * lv.beat);
      mat.ledB.color.set(0xff6a9a).multiplyScalar(1.1 + 0.5 * lv.beat);
    }
    for (const { l, cycle, base } of lamps) {
      sweep(t * 0.03 + cycle * 0.25, l.color);
      l.intensity = base * (0.8 + 0.45 * lv.beat);
    }

    for (const d of displays) {
      const p = d.parts;
      d.focus = THREE.MathUtils.damp(d.focus || 0, d === target ? 1 : 0, 7, dt);
      if (!d.still) {
        p.piece.position.y = p.baseY + Math.sin(t * 0.8 + d.phase) * (d.kind === 'pedestal' ? 0.012 : 0.018);
        p.piece.scale.copy(p.baseScale).multiplyScalar(1 + d.focus * 0.035);
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.3 + d.phase);
      // every piece's halo swells with the bass and its trim flashes on the beat
      p.glowMat.opacity = (d.kind === 'hero' ? 0.2 + pulse * 0.08 : 0.2) + d.focus * 0.22 + 0.16 * lv.bass;
      p.accentMat.color.copy(d.color).multiplyScalar((d.kind === 'pedestal' ? 1.05 : 1.4) + d.focus * 1.1 + (d.kind === 'hero' ? pulse * 0.5 : 0) + (neon ? 0.5 : 0.28) * lv.beat);
      if (d.model) kit.moveModel(d, t, dt, d === inspected);
      if (d.billboard) {
        const yaw = Math.atan2(camera.position.x - d.pos.x, camera.position.z - d.pos.z) - d.rotY;
        q.setFromAxisAngle(yAxis, yaw);
        for (const m of d.billboard) m.quaternion.slerp(q, 1 - Math.exp(-dt * 5));
      }
    }
  }

  function resize(w, h, pixelRatio) {
    floor.resize(w, h, pixelRatio);
    dustMat.uniforms.uScale.value = h * pixelRatio;
  }

  return {
    layout, displays, colliders, update, resize, usables, audio, stream: rooms.stream,
    attachModel: kit.attachModel, prepareModel: kit.prepareModel,
    post: K.bloom,
    /** The visitor clicked "enter": browsers allow sound from here on. */
    onEnter() { audio.unlock(); if (audio.tracks.length && music.autoplay !== false && !audio.playing) audio.play(); },
    toggleMusic() { panel.toggleSound(); },
    /** The equip system, once it is up: the range's rack hands guns out through it and its game hears every shot. */
    attachEquip(e) { range.attachEquip(e); },
    /** The page's own way of opening a panel that needs the mouse. */
    attachHost(h) { range.attachHost(h); },
    range,
    npcs,
    subwall: rooms.subwall,
    /** Landing from a jump on the dance floor sends out a bigger ripple than a step. */
    onLand(x, z, impact) { if (floor.inDance(x, z)) { floor.step(x, z, now, Math.min(3, 1.3 + impact * 0.3)); lastStep.set(x, z); } },
  };
}
